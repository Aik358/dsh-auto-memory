/**
 * issue #310 回归锁 —— **行为级**（真起假 GitHub + 真 spawn 云函数 + 真并发打两次反馈）。
 *
 * 缺陷形态：gistAppend 每次 GET 后 PATCH 整份反馈文件，无并发协调。两个调用（两个云函数实例，
 * 或冷启动期的两个并发请求）从**同一份快照**读出后各自 PATCH ⇒ 后写者整行覆盖前者 ⇒ 群反馈静默丢失。
 *
 * 为什么非得这么测：这是**读-改-写交错**缺陷。源码里 grep 到 "If-Match" 只是恒真守卫，证明不了
 * 「两个真并发请求都不会丢行」。所以本套件：
 *   ① 在本进程内起一个**真的 HTTP 假 GitHub**（实现 ETag / If-Match / 412 语义，并记录每个请求
 *      带的版本头）—— 用真网络把并发交错固定下来（GET 侧加 25ms 延迟，保证两次读必在任一次写之前完成）；
 *   ② 把 .github/cloud/qq-webhook/index.js 原样复制成 .cjs 真 spawn（它就是公网跑的那个 CJS 本体），
 *      用**带正确 Ed25519 签名**的两次 POST 并发触发反馈收集；
 *   ③ 断言假 GitHub 上**两行都在**（旧实现只剩后写者那行），并断言 PATCH 确实带了条件头；
 *   ④ 反向：把「条件请求」这一步变异掉（PATCH 不带 If-Match）后重跑本套件 ⇒ 必红。
 *
 * 零外部依赖、零真实 GitHub 流量：GITHUB_API_BASE 指向本进程假服务。
 * 运行：node tests/smoke/smoke-test-c310-gist-cas.mjs
 * 退出码：有 FAIL 即 1（变异子进程的红由父进程断言，父进程自身应为绿）。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_ENTRY = path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'index.js')
// QQWEBHOOK_ENTRY 只给变异子进程用：指向一份「把条件请求去掉」的副本，验证本套件真的会红。
const ENTRY = process.env.QQWEBHOOK_ENTRY ? path.resolve(process.env.QQWEBHOOK_ENTRY) : REAL_ENTRY
const CHILD = process.env.QQ310_CHILD === '1'

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

/**
 * 最小 ZIP 读取器（只用 node:zlib，不引任何依赖）：取指定条目的**解压后字节**。
 * 只为「源文件 ↔ index.zip 同步」这条漂移锁服务，不追求覆盖 zip64/加密等特性。
 */
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qq310-cas-'))
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
// Deployment/Git text uses LF; Windows checkouts may transparently use CRLF.
const deployBytes = (file) => Buffer.from(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'))
const ENTRY_CJS = path.join(TMP, 'index.cjs')
fs.copyFileSync(ENTRY, ENTRY_CJS)
const ENTRY_SHA = sha256(fs.readFileSync(ENTRY))

const APP_ID = '10000001'
const APP_SECRET = 'test-secret-0123456789abcdef'
const GROUP_ID = 'GROUPOPENIDFORTEST'
const GH_TOKEN = 'ghp_dummy0000000000zzzz'
const GIST_ID = 'gist-for-test'
const BOT_ID = '183DA99311014124CAB4E497F0AF5892'
const FEEDBACK_FILE = 'group-feedback.jsonl'
const BASE_TS = 1700000000000

// ---------- 假 GitHub：实现 gist 读取、ETag/If-Match/412、以及请求取证 ----------
function startFakeGist({ initial = '', omitVersionHeaders = false, getDelayMs = 25 } = {}) {
  const state = { content: initial, version: 0, gets: 0, patches: [], conflicts: 0, statuses: [] }
  const lastModifiedOf = (v) => new Date(BASE_TS + v * 1000).toUTCString()
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const send = (status, obj, headers) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...(headers || {}) })
        res.end(obj === null ? '' : JSON.stringify(obj))
      }
      const files = () => ({ [FEEDBACK_FILE]: { filename: FEEDBACK_FILE, content: state.content } })
      if (req.method === 'GET') {
        state.gets++
        const h = omitVersionHeaders ? {} : { ETag: '"v' + state.version + '"', 'Last-Modified': lastModifiedOf(state.version) }
        // ★把「读」拖慢一点：保证两个并发调用**都在任一次写之前**完成读，把交错固定下来
        setTimeout(() => send(200, { files: files() }, h), getDelayMs)
        return
      }
      if (req.method === 'PATCH') {
        const ifMatch = req.headers['if-match'] || null
        const ius = req.headers['if-unmodified-since'] || null
        state.patches.push({ ifMatch, ius })
        if (!omitVersionHeaders) {
          // ★冲突取证：固定实现下这里**必须**命中至少一次，否则"两行都在"可能只是运气（没真并发）
          state.statuses.push(0)
          if (ifMatch && ifMatch !== '"v' + state.version + '"') { state.conflicts++; state.statuses[state.statuses.length - 1] = 412; return send(412, { message: 'stale' }) }
          if (!ifMatch && ius && Date.parse(ius) < BASE_TS + state.version * 1000) { state.conflicts++; state.statuses[state.statuses.length - 1] = 412; return send(412, { message: 'stale' }) }
          state.statuses[state.statuses.length - 1] = 200
        }
        let parsed = null
        try { parsed = JSON.parse(body) } catch (e) { parsed = null }
        const next = parsed && parsed.files && parsed.files[FEEDBACK_FILE] && typeof parsed.files[FEEDBACK_FILE].content === 'string'
          ? parsed.files[FEEDBACK_FILE].content : null
        if (next === null) return send(400, { message: 'bad-request' })
        state.content = next
        state.version++
        return send(200, { files: files() })
      }
      send(405, { message: 'method-not-allowed' })
    })
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    state, port: srv.address().port, stop: () => new Promise((r) => srv.close(r)),
  })))
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}
function httpReq(port, method, pathname, { body, headers, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: headers || {} }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', (e) => resolve({ status: 0, text: 'ERR:' + e.code }))
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')))
    if (body) req.write(body)
    req.end()
  })
}
function keyPairFromSecret(secret) {
  let seed = Buffer.from(secret, 'utf8')
  while (seed.length < 32) seed = Buffer.concat([seed, seed])
  seed = seed.subarray(0, 32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  return { priv, pub: crypto.createPublicKey(priv) }
}
const KEYS = keyPairFromSecret(APP_SECRET)

async function startServer(gistPort, extraEnv) {
  const port = await freePort()
  const child = spawn(process.execPath, [ENTRY_CJS], {
    cwd: TMP,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      QQ_APP_ID: APP_ID, QQ_APP_SECRET: APP_SECRET, QQ_GROUP_OPENID: GROUP_ID,
      GH_TOKEN, GIST_ID, PORT: String(port),
      GITHUB_API_BASE: 'http://127.0.0.1:' + gistPort,   // ★#310 新增的可覆盖基址：让真身打假 GitHub
      ...(extraEnv || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', (d) => { log += d.toString() })
  child.stderr.on('data', (d) => { log += d.toString() })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const r = await httpReq(port, 'GET', '/?__probe=1', { timeoutMs: 800 })
    if (r.status > 0) return { port, child, log: () => log, stop: () => child.kill() }
    await new Promise((r2) => setTimeout(r2, 120))
  }
  child.kill()
  throw new Error('云函数未在 10s 内 listen：' + log.slice(0, 400))
}

/** 带正确 Ed25519 签名的反馈事件（内容各不相同 ⇒ 不会被平台重复推送去重吃掉）。 */
function feedbackEvent(id, text) {
  return JSON.stringify({
    op: 0, t: 'GROUP_AT_MESSAGE_CREATE',
    d: { id, content: '<@!' + BOT_ID + '> ' + text, author: { member_openid: 'user-' + id }, timestamp: new Date().toISOString() },
  })
}
const signedPost = (port, raw) => {
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = crypto.sign(null, Buffer.from(ts + raw), KEYS.priv).toString('hex')
  return httpReq(port, 'POST', '/', {
    body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': ts },
  })
}

async function main() {
  // =====================================================================
  // #310 部署面：index.zip 必须与源文件同步（zlib 直接解 zip，不引依赖）
  //   任务的「部署时保证源文件与 index.zip 同步生成」在本仓的落点 = 一条**会红的漂移锁**：
  //   只要有人改了源文件忘了重新打包，这里立刻红（而不是等线上跑的是旧字节）。
  // =====================================================================
  {
    const zipPath = path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'index.zip')
    const zip = readZipEntry(zipPath, 'index.js')
    const srcBytes = deployBytes(REAL_ENTRY)
    ok(!!zip, '#310 index.zip 可解析且含 index.js 条目', zipPath)
    if (zip) {
      ok(zip.length === srcBytes.length && zip.equals(srcBytes),
        '★#310 index.zip 与 LF 部署源码逐字节一致(源改了必须重新打包)',
        'zip=' + zip.length + 'B src=' + srcBytes.length + 'B sha(zip)=' + sha256(zip).slice(0, 16) + ' sha(src)=' + sha256(srcBytes).slice(0, 16))
      const bootZip = readZipEntry(zipPath, 'scf_bootstrap')
      const bootSrc = deployBytes(path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'scf_bootstrap'))
      ok(!!bootZip && bootZip.equals(bootSrc), '#310 index.zip 里的 scf_bootstrap 也与源同步', bootZip ? 'zip=' + bootZip.length : 'missing')
    }
    console.log('  [物理量] 源 index.js ' + srcBytes.length + 'B sha256=' + sha256(srcBytes))
  }

  console.log('=== issue #310 群反馈并发写 gist 行为级回归(假 GitHub + 真并发)' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')
  const servers = []
  const gists = []
  try {
    // =====================================================================
    // ① 核心：两个并发反馈 ⇒ 两行都必须留在 gist 上
    // =====================================================================
    {
      const g = await startFakeGist(); gists.push(g)
      const s = await startServer(g.port); servers.push(s)
      ok(sha256(fs.readFileSync(ENTRY_CJS)) === ENTRY_SHA, '被 spawn 的副本与源文件逐字节一致(.cjs 只改后缀)', ENTRY_SHA)
      const [r1, r2] = await Promise.all([
        signedPost(s.port, feedbackEvent('M-A', '反馈 甲:启动很慢')),
        signedPost(s.port, feedbackEvent('M-B', '反馈 乙:面板空白')),
      ])
      ok(r1.status === 200 && r2.status === 200, '#310 两次反馈事件都被受理(200)', JSON.stringify([r1.status, r2.status]))
      const c = g.state.content
      const hasA = c.includes('甲')
      const hasB = c.includes('乙')
      ok(hasA && hasB, '★#310 并发写后**两行都在** gist 上(旧实现:后写者把前者整行覆盖掉)',
        'has甲=' + hasA + ' has乙=' + hasB + ' content=' + JSON.stringify(c).slice(0, 300))
      ok(c.split('\n').filter(Boolean).length === 2, '#310 两条反馈各自成行,不重不漏',
        JSON.stringify(c.split('\n').filter(Boolean).length))
      // ★这条是整套件最关键的证据之一：证明并发**真的发生**了（有 412），
      //   而"两行都在"是**靠重读重试收敛**得来的，不是两次请求恰好被串行化。
      ok(g.state.conflicts >= 1, '★#310 本次真的发生了版本冲突(服务端回了 412)并靠重读+重算收敛 —— 不是"碰巧没撞上"',
        'conflicts=' + g.state.conflicts + ' statuses=' + JSON.stringify(g.state.statuses))
      console.log('  [并发取证] 假 GitHub: GET=' + g.state.gets + ' PATCH=' + g.state.patches.length + ' 412=' + g.state.conflicts)
      ok(g.state.patches.length >= 2, '#310 两次 PATCH 都到过服务端', 'patches=' + g.state.patches.length)
      ok(g.state.patches.every((p) => p.ifMatch || p.ius),
        '★#310 每次 PATCH 都带**版本前置条件**(If-Match / If-Unmodified-Since) —— 冲突检测真的开着',
        JSON.stringify(g.state.patches))
      ok(g.state.patches.some((p) => p.ifMatch), '★#310 用的是 ETag 强校验(If-Match)', JSON.stringify(g.state.patches.slice(0, 3)))

      // 顺序追加：新行不丢旧的
      const r3 = await signedPost(s.port, feedbackEvent('M-C', '反馈 丙:导出失败'))
      ok(r3.status === 200, '#310 第三次反馈受理', String(r3.status))
      const c3 = g.state.content
      ok(c3.includes('甲') && c3.includes('乙') && c3.includes('丙'), '★#310 顺序追加后三条都在(读-改-写没吃掉历史行)',
        JSON.stringify(c3).slice(0, 300))
    }

    // =====================================================================
    // ② 有界：超过 400 行丢最旧（旧契约不能被并发修法改坏）
    // =====================================================================
    {
      const lines = []
      for (let i = 0; i < 400; i++) lines.push(JSON.stringify({ t: new Date(BASE_TS).toISOString(), u: 'old' + i, m: '历史行' + i }))
      const g = await startFakeGist({ initial: lines.join('\n') + '\n', getDelayMs: 0 }); gists.push(g)
      const s = await startServer(g.port); servers.push(s)
      const r = await signedPost(s.port, feedbackEvent('M-D', '反馈 丁:第 401 条'))
      ok(r.status === 200, '#310 满队列下追加受理', String(r.status))
      const out = g.state.content.split('\n').filter(Boolean)
      ok(out.length === 400, '★#310 仍是有界 400 行(老的只保留最近 400 条契约未被改坏)', 'len=' + out.length)
      ok(out[out.length - 1].includes('丁') && !g.state.content.includes('历史行0\n'), '★#310 保留的是最新一条、丢的是最旧一条',
        'tail=' + JSON.stringify(out[out.length - 1]).slice(0, 120))
    }

    // =====================================================================
    // ③ 负路径：服务端不给版本号(既无 ETag 也无 Last-Modified) ⇒ **拒绝盲写**
    //    这是 fail-closed 的核心:拿不准版本时宁可本次不记,也不覆盖别人的新行。
    // =====================================================================
    {
      const g = await startFakeGist({ initial: JSON.stringify({ u: 'pre', m: '既有行' }) + '\n', omitVersionHeaders: true, getDelayMs: 0 }); gists.push(g)
      const s = await startServer(g.port); servers.push(s)
      const before = g.state.content
      const r = await signedPost(s.port, feedbackEvent('M-E', '反馈 戊:无版本号场景'))
      ok(r.status === 503, '#324 无版本号不能持久保存时返回 503,允许平台重试', String(r.status))
      ok(g.state.patches.length === 0, '★#310 负路径:没有版本号时**一个 PATCH 都没发**(拒绝盲写)', 'patches=' + JSON.stringify(g.state.patches))
      ok(g.state.content === before, '★#310 负路径:既有内容逐字节未变(没有被覆盖)', JSON.stringify(g.state.content).slice(0, 200))
      ok(/收集失败/.test(s.log()), '#310 负路径:失败被写成可读日志,不是静默吞掉', s.log().slice(-300))
    }

    // =====================================================================
    // ④ 变异反向验证（只在父进程做一次；子进程模式跳过）
    //   变异 = 把「条件请求」这一步去掉（PATCH 不再带 If-Match）——这正是 #310 的旧形态。
    // =====================================================================
    if (!CHILD) {
      const real = fs.readFileSync(REAL_ENTRY, 'utf8').replace(/\r\n/g, '\n')
      const ANCHOR = "    if (r0.etag) headers['If-Match'] = r0.etag\n"
        + "    else if (r0.lastModified) headers['If-Unmodified-Since'] = r0.lastModified\n"
        + "    else throw new Error('gist 响应既无 ETag 也无 Last-Modified:无法判定版本,拒绝盲写(宁可丢本次记录也不覆盖别人的新行)')"
      const hits = real.split(ANCHOR).length - 1
      ok(hits === 1, '变异定位:#310 条件头锚点恰命中 1 次', 'hits=' + hits)
      const mutated = path.join(TMP, 'mutated-310.cjs')
      fs.writeFileSync(mutated, real.replace(ANCHOR, "    // [变异取证] 去掉条件请求:退回 #310 旧形态(无条件 PATCH)"))
      const syn = spawnSyncCheck(mutated)
      ok(syn === 0, '变异文件语法可用', 'node --check exit=' + syn)
      const r = spawnSyncRun(mutated)
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, '★变异必红(#310 去掉条件请求):子进程退出码非 0', 'status=' + r.status)
      ok(/FAIL - /.test(out), '★变异必红(#310 去掉条件请求):是断言红(有 FAIL 行),不是崩溃退出', out.slice(-400))
      ok(!!m && Number(m[2]) > 0, '★变异必红(#310 去掉条件请求):fail>0', m ? m[0] : '(未取到计数)')
      console.log('  [变异取证] #310 无条件 PATCH -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
    }
  } finally {
    for (const s of servers) { try { s.stop() } catch (e) {} }
    for (const g of gists) { try { await g.stop() } catch (e) {} }
    try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
  }
  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

const { spawnSync } = await import('node:child_process')
function spawnSyncCheck(file) { return spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status }
function spawnSyncRun(mutatedEntry) {
  return spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, QQWEBHOOK_ENTRY: mutatedEntry, QQ310_CHILD: '1' },
    encoding: 'utf8', maxBuffer: 1 << 26,
  })
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})
