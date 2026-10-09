/**
 * issue #324 回归锁 —— **行为级**(真跑完整生产模块 + 模拟 HTTP/模拟 Gist 传输)。
 *
 * 缺陷形态:handleEvent 在 await gistAppend **之前**就落了去重标记(seen.add / recentByContent.set),
 * 而 gistAppend 失败只记 lastError 就继续往下走 ⇒ 接口照常回 200。平台因此不再重推,而重推也会被
 * 那两个缓存挡住 ⇒ 这条群反馈**只尝试过一次写入,事件永久未保存**。
 *
 * 为什么非得这么测:
 *   · 源码里 grep 到「publishSeen 在 try 之后」只是恒真守卫,证明不了"失败后真的还能重试";
 *   · 必须**真执行** HTTP 路由 + handleEvent + 真地走 gistCasAppend(CAS/412/回读确认)整条链。
 *
 * 本套件把 .github/cloud/qq-webhook/index.js **原字节**载进 vm,只替换两样东西:
 *   ① node:http → 捕获真 createServer 回调(拿到生产路由 handleEvent);
 *   ② 全局 fetch → 模拟 Gist 传输(实现 ETag/If-Match/412 语义,并可注入持久失败)。
 *   并注入可控时钟(60s 语义去重窗口必须能被推进,否则窗口类断言测不了)。
 * 打真签名(Ed25519 由 QQ_APP_SECRET 派生),断言**真实 HTTP 状态码**与**去重缓存的副作用**。
 *
 * 覆盖:
 *   ① 前提断言:先跑一次成功的收集(200 且真写入),证明后面注入失败时确实进了被测分支;
 *   ② #324 核心:持久失败 ⇒ **503**(不是 200),且**这次事件没落盘、去重标记也没发布**;
 *      恢复存储后**同一条事件**必须被重新受理(200)并真落盘 —— 这正是旧实现丢事件的那一步;
 *   ③ 语义窗口恢复:不同 id、同作者+同内容 ⇒ 首次失败后第二次不得被 recentByContent 吃掉;
 *   ④ 失败矩阵 read 503 / PATCH 503 / PATCH 网络异常 / read 网络异常 一律 503 且可重试;
 *   ⑤ 反向:成功后才发布标记 ⇒ id 去重、60s 语义窗口、越窗后放行,**一个都不能被这修法弄坏**;
 *   ⑥ 旁路不变:无需收集的消息 0 次出站、未配 GIST_ID 仍 200 且 0 次出站、未验签 401、op=13 握手;
 *   ⑦ 部署面漂移锁:index.zip 里的 index.js / scf_bootstrap 与源**逐字节一致**;
 *   ⑧ 变异反向验证(父进程):把去重标记移回持久化**之前** ⇒ 必红;把 503 改回 200 ⇒ 必红;
 *      还原 ⇒ 必绿。三次数值写进输出。
 *
 * 运行:node tests/smoke/smoke-test-issue324-webhook-feedback-retry.mjs
 * 退出码:有 FAIL 即 1(变异子进程的红由父进程断言,父进程自身应为绿)。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import vm from 'node:vm'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_ENTRY = path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'index.js')
const ENTRY = process.env.QQ324_ENTRY ? path.resolve(process.env.QQ324_ENTRY) : REAL_ENTRY
const CHILD = process.env.QQ324_CHILD === '1'
const SRC = fs.readFileSync(ENTRY)
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')

const APP_ID = '10000001'
const APP_SECRET = 'test-secret-0123456789abcdef'
const GROUP_ID = 'GROUPOPENIDFORTEST'
const GH_TOKEN = 'ghp_dummy0000000000zzzz'
const GIST_ID = 'gist-for-test'
const FEEDBACK_FILE = 'group-feedback.jsonl'
const BASE_TS = 1700000000000

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const eq = (actual, want, name) => ok(actual === want, name, '期望 ' + JSON.stringify(want) + ',实得 ' + JSON.stringify(actual))

// ---------- 与服务端同一套 Ed25519 密钥派生(secret 补齐/截断到 32 字节当 seed) ----------
function keyPairFromSecret(secret) {
  let seed = Buffer.from(secret, 'utf8')
  while (seed.length < 32) seed = Buffer.concat([seed, seed])
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed.subarray(0, 32)])
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  return { priv, pub: crypto.createPublicKey(priv) }
}
const KEYS = keyPairFromSecret(APP_SECRET)

// ---------- 模拟 Gist 传输:实现 ETag/If-Match/412 + 可注入持久失败,并记全部取证 ----------
function createGist({ initial = '', omitVersionHeaders = false } = {}) {
  const state = { content: initial, version: 0, gets: 0, patches: 0, conflicts: 0, failRead: false, throwRead: false, failWrite: false, throwWrite: false, urls: [] }
  const reply = (status, text, etag = '') => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'etag' ? etag : '') },
    json: async () => ({ files: { [FEEDBACK_FILE]: { filename: FEEDBACK_FILE, content: text } } }),
  })
  const fetch = async (url, opts = {}) => {
    state.urls.push(String(url))
    if (String(url) !== 'https://api.github.com/gists/' + GIST_ID) throw new Error('套件只允许打模拟 Gist,实得 URL=' + url)
    const method = opts.method || 'GET'
    if (method === 'GET') {
      state.gets++
      if (state.throwRead) throw new Error('fixture read network failure')
      if (state.failRead) return reply(503, '')
      return reply(200, state.content, omitVersionHeaders ? '' : '"v' + state.version + '"')
    }
    if (method !== 'PATCH') throw new Error('模拟 Gist 只支持 GET/PATCH,实得 ' + method)
    state.patches++
    if (state.throwWrite) throw new Error('fixture write network failure')
    if (state.failWrite) return reply(503, '')
    const ifMatch = (opts.headers || {})['If-Match']
    if (!ifMatch || ifMatch !== '"v' + state.version + '"') { state.conflicts++; return reply(412, '') }
    state.content = JSON.parse(opts.body).files[FEEDBACK_FILE].content
    state.version++
    return reply(200, '')
  }
  return { state, fetch, content: () => state.content, networkCalls: () => state.gets + state.patches }
}

// ---------- 载入生产模块:真跑 createServer 回调,只换 http / fetch / 时钟 ----------
function makeInstance(gist, envExtra = {}) {
  const logs = []
  const clock = { now: BASE_TS }
  let route = null
  const env = {
    QQ_APP_ID: APP_ID, QQ_APP_SECRET: APP_SECRET, QQ_GROUP_OPENID: GROUP_ID,
    GH_TOKEN, GIST_ID, PORT: '0', ...envExtra,
  }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  const record = (...v) => logs.push(v.map((x) => (x && x.stack) || String(x)).join(' '))
  vm.runInNewContext(SRC.toString('utf8'), {
    require: (name) => {
      if (name === 'node:http') {
        return { createServer: (cb) => { route = cb; return { listen: (p, ready) => { if (typeof ready === 'function') ready() } } } }
      }
      // 验签/派生用真 crypto(不可桩:套件自己也要用它算签名)
      if (name === 'node:crypto') return crypto
      throw new Error('生产模块引入了套件未预期的依赖:' + name)
    },
    process: { env, exit: () => { throw new Error('生产模块意外调用 process.exit') } },
    fetch: gist.fetch,
    Buffer, URL, Date: ClockDate, setTimeout, clearTimeout,
    console: { log: record, error: record, warn: record, info: record },
  }, { filename: ENTRY })
  assert.ok(typeof route === 'function', '生产模块必须注册 HTTP 路由(否则套件根本没测到它)')

  const deliver = async (payload, { signed = true } = {}) => {
    const raw = JSON.stringify(payload)
    const ts = '1700000000'
    const req = new EventEmitter()
    req.method = 'POST'
    req.url = '/'
    req.headers = signed
      ? { 'Content-Type': 'application/json', 'x-signature-timestamp': ts, 'x-signature-ed25519': crypto.sign(null, Buffer.from(ts + raw), KEYS.priv).toString('hex') }
      : { 'Content-Type': 'application/json' }
    let resolveDone = null
    let settled = false
    const done = new Promise((r) => { resolveDone = r })
    const res = {
      writableEnded: false,
      status: 0,
      writeHead(code) { res.status = code },
      end(body) {
        res.writableEnded = true
        if (!settled) { settled = true; resolveDone({ status: res.status, body: body === undefined ? '' : String(body) }) }
      },
    }
    route(req, res)
    req.emit('data', Buffer.from(raw))
    req.emit('end')
    return await done
  }
  const event = (id, content = '反馈 ' + id, user = 'u-' + id) => deliver({
    op: 0, t: 'GROUP_MESSAGE_CREATE',
    d: { id, content, author: { member_openid: user, username: user }, timestamp: new Date(clock.now).toISOString() },
  })
  const plain = (id, content = '路过看看', user = 'u-' + id) => deliver({
    op: 0, t: 'GROUP_MESSAGE_CREATE',
    d: { id, content, author: { member_openid: user, username: user }, timestamp: new Date(clock.now).toISOString() },
  })
  return { clock, deliver, event, plain, logs: () => logs.join('\n') }
}

// ---------- 最小 ZIP 读取器(只用 node:zlib,不引依赖):取指定条目的解压后字节 ----------
function readZipEntry(zipPath, wanted) {
  try {
    const buf = fs.readFileSync(zipPath)
    let eocd = -1
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
    }
    if (eocd < 0) return null
    const count = buf.readUInt16LE(eocd + 10)
    let off = buf.readUInt32LE(eocd + 16)
    for (let i = 0; i < count; i++) {
      if (buf.readUInt32LE(off) !== 0x02014b50) return null
      const method = buf.readUInt16LE(off + 10)
      const compSize = buf.readUInt32LE(off + 20)
      const fnLen = buf.readUInt16LE(off + 28)
      const exLen = buf.readUInt16LE(off + 30)
      const cmLen = buf.readUInt16LE(off + 32)
      const localOff = buf.readUInt32LE(off + 42)
      const name = buf.toString('utf8', off + 46, off + 46 + fnLen)
      if (name === wanted) {
        if (buf.readUInt32LE(localOff) !== 0x04034b50) return null
        const lfn = buf.readUInt16LE(localOff + 26)
        const lex = buf.readUInt16LE(localOff + 28)
        const dataStart = localOff + 30 + lfn + lex
        const raw = buf.subarray(dataStart, dataStart + compSize)
        return method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw)
      }
      off += 46 + fnLen + exLen + cmLen
    }
    return null
  } catch (e) { return null }
}

async function main() {
  console.log('=== issue #324 群反馈持久失败必须可重试(真跑生产模块 + 模拟 Gist) ===' + (CHILD ? ' [变异子进程模式]' : ''))
  console.log('  source=' + ENTRY + ' bytes=' + SRC.length + ' sha256=' + sha256(SRC))
  ok(SRC.indexOf(13) === -1, '被测源为 LF(仓库部署文本约定;CRLF 会让 index.zip 漂移锁与线上字节不一致)', 'CR 位置=' + SRC.indexOf(13))

  // =====================================================================
  // ⑦ 部署面漂移锁:index.zip 必须与源逐字节一致(源改了没重打包 ⇒ 这里立刻红)
  //   只在父进程对**真源**生效:变异子进程的源是故意改坏的副本,与 index.zip 无关,
  //   若在子进程也判,变异红就混进了"副本不同=漂移"这种与 #324 无关的噪声。
  // =====================================================================
  if (!CHILD) {
    const zipPath = path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'index.zip')
    const zip = readZipEntry(zipPath, 'index.js')
    const bootZip = readZipEntry(zipPath, 'scf_bootstrap')
    const bootSrc = fs.readFileSync(path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'scf_bootstrap'))
    ok(!!zip, '#324 index.zip 可解析且含 index.js 条目', zipPath)
    if (zip) {
      ok(zip.length === SRC.length && zip.equals(SRC),
        '★#324 index.zip 里的 index.js 与源**逐字节一致**(源改了必须重新打包)',
        'zip=' + zip.length + 'B src=' + SRC.length + 'B sha(zip)=' + sha256(zip).slice(0, 16) + ' sha(src)=' + sha256(SRC).slice(0, 16))
    }
    ok(!!bootZip && bootZip.equals(bootSrc), '#324 index.zip 里的 scf_bootstrap 与源同步', bootZip ? 'zip=' + bootZip.length + 'B' : 'missing')
    console.log('  [物理量] index.zip ' + fs.statSync(zipPath).size + 'B sha256=' + sha256(fs.readFileSync(zipPath)) + ' / 源 ' + SRC.length + 'B sha256=' + sha256(SRC))
  }

  // =====================================================================
  // ① 前提断言:先跑一次**成功**的收集 ⇒ 证明请求真的进了被测分支(200 且真写入)
  // =====================================================================
  {
    const g = createGist()
    const i = makeInstance(g)
    const r = await i.event('premise-1', '反馈 前提:这次必须真写进去')
    eq(r.status, 200, '① 前提:普通反馈事件 ⇒ 200(验签通过、分支命中)')
    eq(g.state.patches, 1, '① 前提:确实发生了一次 PATCH(真的走了 gistCasAppend)')
    ok(g.content().includes('前提:这次必须真写进去'), '① 前提:内容真的落到 Gist 上(不是静默跳过)', JSON.stringify(g.content()).slice(0, 160))
  }

  // =====================================================================
  // ② #324 核心:PATCH 持久失败 ⇒ 503;恢复后**同一条事件**必须被重新受理并真落盘
  //    旧实现:首次回 200 + 标记已落 ⇒ 恢复后重推被去重挡住 ⇒ 事件永久丢失。
  // =====================================================================
  {
    const g = createGist()
    const i = makeInstance(g)
    g.state.failWrite = true
    const bad = await i.event('retry-same-id', '反馈 核心:存储坏了这一次')
    eq(bad.status, 503, '★#324 持久失败必须回**可重试的 503**,不得回 200(旧实现回 200 ⇒ 平台不再重推)')
    ok(/feedback_persistence_failed/.test(bad.body), '★#324 503 响应体带 feedback_persistence_failed 机器码', bad.body.slice(0, 200))
    ok(g.state.patches >= 1, '★#324 失败时确实尝试过写入(不是"根本没进分支")', 'patches=' + g.state.patches)
    eq(g.content(), '', '★#324 失败时 Gist 内容逐字节未变(既没落盘也没覆盖别人)')
    ok(/收集失败/.test(i.logs()), '#324 失败被写成可读日志(不是静默吞掉)', i.logs().slice(-200))
    ok(/503/.test(i.logs()), '#324 日志写明将回 503 让平台重试', i.logs().slice(-200))

    // 恢复存储:**同一条事件**(同 id)重推 —— 旧实现被 seen 挡住 ⇒ patches 停在 1、内容仍为空
    g.state.failWrite = false
    const first = g.state.patches
    const good = await i.event('retry-same-id', '反馈 核心:存储坏了这一次')
    eq(good.status, 200, '★#324 存储恢复后**同一条事件**被重新受理 ⇒ 200')
    ok(g.state.patches === first + 1, '★#324 恢复后真的**再写了一次**(旧实现被 seen 挡住,patches 不再增长)',
      'patches ' + first + ' -> ' + g.state.patches)
    ok(g.content().includes('核心:存储坏了这一次'), '★#324 重试后事件真的落盘了(旧实现:永久未保存)', JSON.stringify(g.content()).slice(0, 200))

    // 成功之后才发布去重标记 ⇒ 再推同一条必须被去重(不能变成"同一条写两遍")
    const before = g.state.patches
    const dup = await i.event('retry-same-id', '反馈 核心:存储坏了这一次')
    eq(dup.status, 200, '★#324 成功后才发布的 id 去重:第三次重推仍 200')
    eq(g.state.patches, before, '★#324 成功之后同 id 必须被去重(没被这修法弄成重复记录)', 'patches=' + g.state.patches)
  }

  // =====================================================================
  // ③ 语义窗口恢复:不同 id、同作者+同内容(平台重推的真实形态是两次 d.id 不同)
  //    首次失败后第二次**不得**被 recentByContent 吃掉
  // =====================================================================
  {
    const g = createGist()
    const i = makeInstance(g)
    g.state.failWrite = true
    eq((await i.event('semantic-a', '反馈 语义:同一句话')).status, 503, '③ 首次(存储故障)⇒ 503')
    const patchesAfterFail = g.state.patches
    g.state.failWrite = false
    const r2 = await i.event('semantic-b', '反馈 语义:同一句话')
    eq(r2.status, 200, '★#324 首次失败后,同作者+同内容的**新 id** 必须被重新受理(旧实现被 recentByContent 挡住)')
    eq(g.state.patches, patchesAfterFail + 1, '★#324 第二次真的写了(不是"受理但跳过")', 'patches=' + g.state.patches)
    ok(g.content().includes('语义:同一句话'), '★#324 第二次的内容真的落盘', JSON.stringify(g.content()).slice(0, 200))
  }

  // =====================================================================
  // ④ 失败矩阵:读失败 / 写失败 / 读网络异常 / 写网络异常 —— 一律 503 且恢复后可重试
  // =====================================================================
  for (const key of ['failWrite', 'failRead', 'throwWrite', 'throwRead']) {
    const g = createGist()
    const i = makeInstance(g)
    g.state[key] = true
    const bad = await i.event('matrix-' + key, '反馈 矩阵:' + key)
    eq(bad.status, 503, '④ 持久环节故障(' + key + ')⇒ 503 可重试')
    if (key === 'failWrite' || key === 'throwWrite') ok(g.state.patches >= 1, '④ ' + key + ':确实尝试过 PATCH', 'patches=' + g.state.patches)
    g.state[key] = false
    const good = await i.event('matrix-' + key, '反馈 矩阵:' + key)
    eq(good.status, 200, '④ ' + key + ' 恢复后同 id 重推 ⇒ 200')
    ok(g.content().includes('矩阵:' + key), '④ ' + key + ' 恢复后内容真的落盘', JSON.stringify(g.content()).slice(0, 200))
  }

  // =====================================================================
  // ⑤ 反向:去重标记照旧生效 —— id 去重 / 60s 语义窗口 / 越窗放行
  // =====================================================================
  {
    const g = createGist()
    const i = makeInstance(g)
    eq((await i.event('dedup-1', '反馈 去重:第一句')).status, 200, '⑤ 首条受理')
    eq(g.state.patches, 1, '⑤ 首条写了一次')
    eq((await i.event('dedup-1', '反馈 去重:第一句')).status, 200, '⑤ 同 id 重推 ⇒ 200(幂等)')
    eq(g.state.patches, 1, '★#324 同 id 在**成功之后**仍被去重(去重不能被修法弄丢)', 'patches=' + g.state.patches)

    eq((await i.event('dedup-2', '反馈 去重:另一句', 'u-other')).status, 200, '⑤ 不同作者/内容 ⇒ 受理')
    eq(g.state.patches, 2, '⑤ 不同事件各写一行')

    const beforeWindow = g.state.patches
    // 语义去重的键是「作者 + 内容」⇒ 必须复用首条的作者 openid(平台重推的真实形态)
    eq((await i.event('dedup-3', '反馈 去重:第一句', 'u-dedup-1')).status, 200, '⑤ 同作者同内容、新 id、窗口内 ⇒ 200(仍受理)')
    eq(g.state.patches, beforeWindow, '★#324 60s 语义去重窗口仍生效(成功事件不被重复记录)', 'patches=' + g.state.patches)

    i.clock.now += 60000
    eq((await i.event('dedup-4', '反馈 去重:第一句', 'u-dedup-1')).status, 200, '⑤ 越窗后新 id ⇒ 200')
    eq(g.state.patches, beforeWindow + 1, '★#324 越过 60s 窗口后必须放行(窗口语义没被改坏)', 'patches=' + g.state.patches)
  }

  // =====================================================================
  // ⑥ 旁路不变:无需收集 / 未配 GIST_ID / 未验签 / op=13 握手 / 400 条保留策略
  // =====================================================================
  {
    const g = createGist()
    const i = makeInstance(g)
    eq((await i.plain('plain-1')).status, 200, '⑥ 普通消息(无触发词)⇒ 200')
    eq((await i.plain('plain-1')).status, 200, '⑥ 普通消息重推 ⇒ 200')
    eq(g.networkCalls(), 0, '★#324 无需收集的消息 0 次出站(修法没有把旁路变成写 gist)', 'calls=' + g.networkCalls())

    const unconfigured = createGist()
    const i2 = makeInstance(unconfigured, { GIST_ID: '' })
    eq((await i2.event('nogist-1', '反馈 没有配 gist')).status, 200, '⑥ 未配 GIST_ID:命中触发词仍 200(既有保留行为)')
    eq(unconfigured.networkCalls(), 0, '⑥ 未配 GIST_ID:0 次出站')

    const unsigned = await i.deliver({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { id: 'unsigned', content: '反馈 未验签', author: { member_openid: 'u' } } }, { signed: false })
    eq(unsigned.status, 401, '⑥ 未验签 ⇒ 401(默认 fail-closed 未被这次修法动到)')
    eq(g.networkCalls(), 0, '⑥ 未验签请求不产生任何 gist 出站')

    const handshake = await i.deliver({ op: 13, d: { plain_token: 'pt-324', event_ts: '1700000000' } }, { signed: false })
    eq(handshake.status, 200, '⑥ op=13 URL 验证握手 ⇒ 200(平台侧不要求先验签)')
    const hs = JSON.parse(handshake.body)
    eq(hs.plain_token, 'pt-324', '⑥ op=13 回传 plain_token')
    ok(crypto.verify(null, Buffer.from('1700000000pt-324'), KEYS.pub, Buffer.from(hs.signature, 'hex')), '⑥ op=13 应答签名可用派生公钥验证')

    const ignored = await i.deliver({ op: 0, t: 'IGNORED_EVENT' })
    eq(ignored.status, 200, '⑥ 无关事件 ⇒ 200')
    eq(g.networkCalls(), 0, '⑥ 无关事件 0 次出站')
  }
  {
    // 400 条保留策略(#310 契约)不能被 #324 改坏
    const lines = []
    for (let n = 0; n < 400; n++) lines.push(JSON.stringify({ t: new Date(BASE_TS).toISOString(), u: 'old' + n, m: '历史行' + n }))
    const g = createGist({ initial: lines.join('\n') + '\n' })
    const i = makeInstance(g)
    eq((await i.event('cap-1', '反馈 上限:第 401 条')).status, 200, '⑥ 满队列下追加 ⇒ 200')
    const out = g.content().split('\n').filter(Boolean)
    eq(out.length, 400, '★#324 仍是 400 行上界(既有保留策略未被改坏)', 'len=' + out.length)
    ok(out[out.length - 1].includes('上限:第 401 条') && !g.content().includes('历史行0\n'), '★#324 保留最新一条、丢最旧一条')
  }

  // =====================================================================
  // ⑧ 变异反向验证(父进程):三种形态各自必须红,还原必须绿
  // =====================================================================
  if (!CHILD) {
    const ANCHOR_LATE = '\n    publishSeen(id, dedupKey, nowMs)\n'
    const ANCHOR_ID_GUARD = '    if (seen.has(id)) return\n'
    const ANCHOR_MENTIONS = '    const mentions = [...String(d.content || '
    const ANCHOR_503 = '      res.writeHead(e.feedbackPersistence ? 503 : 200, { ' + String.fromCharCode(39) + 'Content-Type' + String.fromCharCode(39) + ': ' + String.fromCharCode(39) + 'application/json' + String.fromCharCode(39) + ' })\n'
    const hits = (s, a) => s.split(a).length - 1
    const base = SRC.toString('utf8')
    eq(hits(base, ANCHOR_LATE), 1, '变异定位:延后发布锚点恰命中 1 次')
    eq(hits(base, ANCHOR_ID_GUARD), 1, '变异定位:id 去重判定锚点恰命中 1 次')
    eq(hits(base, ANCHOR_MENTIONS), 1, '变异定位:mentions 行锚点恰命中 1 次')
    eq(hits(base, ANCHOR_503), 1, '变异定位:503 回执锚点恰命中 1 次')

    const Q = String.fromCharCode(39)
    const dir = path.join(os.tmpdir(), 'qq324-mut-' + process.pid)
    fs.mkdirSync(dir, { recursive: true })
    const runChild = (label, source) => {
      const file = path.join(dir, label + '.cjs')
      fs.writeFileSync(file, source)
      const syn = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      ok(syn.status === 0, '变异(' + label + ')文件语法可用', 'node --check exit=' + syn.status + ' ' + String(syn.stderr || '').slice(0, 200))
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, QQ324_ENTRY: file, QQ324_CHILD: '1' },
        encoding: 'utf8', maxBuffer: 1 << 26,
      })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '(未取到计数)') + ' exit=' + r.status)
      return { r, out, m }
    }

    // 变异①(报告人判据的旧形态):把去重标记移回持久化**之前**
    const restoreId = ANCHOR_ID_GUARD + '    seen.add(id)\n    if (seen.size > 500) seen.delete(seen.values().next().value)\n'
    const restoreContent = '    recentByContent.set(dedupKey, nowMs)\n    if (recentByContent.size > 500) recentByContent.delete(recentByContent.keys().next().value)\n'
    const mutatedOrder = base
      .replace(ANCHOR_LATE, '\n')
      .replace(ANCHOR_ID_GUARD, restoreId)
      .replace(ANCHOR_MENTIONS, restoreContent + ANCHOR_MENTIONS)
    ok(mutatedOrder !== base, '变异①真的改到了源(不是替换失败的假变异)')
    const m1 = runChild('markers-before-persist', mutatedOrder)
    ok(m1.r.status !== 0, '★变异①必红:去重标记移回持久化之前 ⇒ 子进程退出码非 0', 'status=' + m1.r.status)
    ok(/FAIL - /.test(m1.out), '★变异①必红:是**断言红**(有 FAIL 行),不是崩溃退出', m1.out.slice(-500))
    ok(!!m1.m && Number(m1.m[2]) > 0, '★变异①必红:fail>0', m1.m ? m1.m[0] : '(未取到计数)')
    // 红必须是「事件永久未保存」这个原因,不是别的巧合
    ok(/重试后事件真的落盘了|恢复后真的\*\*再写了一次/.test(m1.out),
      '★变异①必红:红的正是「失败后事件再也写不进去」这条 #324 断言(有鉴别力)', m1.out.match(/FAIL - [^\n]*/g) || [])

    // 变异②:持久失败回 200(旧回执形态)⇒ 状态码断言必红
    const mutated200 = base.replace(ANCHOR_503, '      res.writeHead(200, { ' + Q + 'Content-Type' + Q + ': ' + Q + 'application/json' + Q + ' })\n')
    ok(mutated200 !== base, '变异②真的改到了源')
    const m2 = runChild('failure-returns-200', mutated200)
    ok(m2.r.status !== 0, '★变异②必红:持久失败仍回 200 ⇒ 子进程退出码非 0', 'status=' + m2.r.status)
    ok(!!m2.m && Number(m2.m[2]) > 0, '★变异②必红:fail>0', m2.m ? m2.m[0] : '(未取到计数)')
    ok(/持久失败必须回\*\*可重试的 503\*\*,不得回 200/.test(m2.out),
      '★变异②必红:红的正是「失败回执必须是 503」这条 #324 断言(有鉴别力)', m2.out.match(/FAIL - [^\n]*/g) || [])

    // 还原(用源文件原字节重跑一次)⇒ 必绿
    const m0 = runChild('restored-baseline', base)
    ok(m0.r.status === 0, '★还原必绿(pass 全过,fail=0)', 'status=' + m0.r.status + ' ' + (m0.m ? m0.m[0] : ''))
    ok(!!m0.m && Number(m0.m[2]) === 0, '★还原必绿:fail=0', m0.m ? m0.m[0] : '(未取到计数)')
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* ignore */ }
  }

  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})
