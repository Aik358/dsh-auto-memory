/**
 * issue #113 / #114 / #115 / #116 回归锁 —— **行为级**守卫(不是文本 grep)。
 * 2026-11-04 扩测(同一批公网面加固):#531 匿名握手替业务回调签名 / #538 鉴权子串放行 / #537 反馈重复追加。
 *
 * 为什么必须行为级:这四条缺陷全是「默认值」型问题(不配就放行)。文本断言只能证明"源码长这样",
 * 证明不了"不配它就是拒绝";而它们又全在**公网可达面**上,一旦漂回开放态,代价是群聊原文外泄 +
 * 运维者 LLM key 被匿名刷。所以本套件真的把 `.github/cloud/qq-webhook/index.js` spawn 成子进程
 * (它就是 CommonJS + `server.listen`,公网跑的那个函数本体),用本机 HTTP 打它的每一道门,
 * 断言**状态码与响应体**。
 *
 * 零外部网络:LLM_BASE_URL 指向本进程内起的假端点(trap,只计数不代理),GIST_ID 留空
 * (报告/诊断分支因此不发任何出站请求),GH_DISPATCH_TOKEN 不配(定时入口不会真的 dispatch)。
 * trap 的命中数同时用来证明 #113 的资金路径:**未验签的请求一次都不会碰到 LLM_API_KEY**。
 *
 * 覆盖面(四个进程 × 若干请求):
 *   P1 全默认(人用凭据一律不配)… 无签名 POST→401 / ?report=→403 / ?diag=→403 / timer→403 / 超大 body→413 / LLM trap=0
 *   P2 只设 STRICT_VERIFY=0 …… 仍然 401(单个"我知道我在做什么"的开关不再能关掉验签)
 *   P3 STRICT_VERIFY=0 + ALLOW_INSECURE_VERIFY=1… 200,但**仍不花 LLM key**(trap=0)
 *   P4 配了 ROUTE_TOKEN + TIMER_SECRET … 人用端点要凭据;带凭据可读;diag 三布尔 + 身份只留尾 4 位;
 *                                        timer 要密钥且要触发名;QQ 回调(带真签名、不带 token)仍 200
 *   P1b 专配 GIST_ID + 假 GitHub … #531 攻击链:把业务正文当 plain_token 的握手必须 400 且不回签名,
 *                                        重放必须 401、假 gist 无新行、LLM trap 不增;非最小握手信封走正常验签
 *   P5 ROUTE_TOKEN 恰好等于查询参数名(report)… #538 三条明确通道:请求头 / ?token= / **路径段整段相等**;
 *                                        令牌只出现在 query(?report=1、?diag=1&x=令牌)一律 403
 *   P6 假 GitHub 在「PATCH 成功与回读之间」注入并发写者 … #537 回读只认「本行在不在」⇒ 不再重试追加;
 *                                        本行已存在时幂等跳过(0 次 PATCH)
 *
 * 运行:node tests/smoke/smoke-test-issue113-116-webhook-guards-pre.mjs
 * 退出码:有 FAIL 即 1。
 */
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
// QQWEBHOOK_ENTRY 只给变异测试用:指向一份被故意改坏的副本,验证本套件**真的会红**
// (守卫套件的价值等于它抓得住的错,不是它跑绿了)。默认打真身。
const ENTRY = process.env.QQWEBHOOK_ENTRY
  ? path.resolve(process.env.QQWEBHOOK_ENTRY)
  : path.join(ROOT, '.github', 'cloud', 'qq-webhook', 'index.js')
const SRC = readFileSync(ENTRY, 'utf8').replace(/\r\n/g, '\n') // 仓库多数文件是 CRLF,文本断言前先归一

// 被测函数是 CommonJS(云端 zip 里只有 index.js + scf_bootstrap,靠 .js 后缀走 CJS),而本仓
// package.json 是 "type":"module" ⇒ 直接 node index.js 会被当成 ESM 报 require is not defined。
// 因此把它**原样复制**到临时目录改后缀 .cjs 再 spawn,并先核对 SHA256 与源文件一致
// (保证跑的是提交态那几行字节,而不是我在这里改出来的另一份)。
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qqwebhook-guard-'))
const ENTRY_CJS = path.join(TMPDIR, 'index.cjs')
fs.copyFileSync(ENTRY, ENTRY_CJS)
const ENTRY_SHA = sha256(fs.readFileSync(ENTRY))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const eq = (actual, want, name) => ok(actual === want, name, `期望 ${JSON.stringify(want)},实得 ${JSON.stringify(actual)}`)
const has = (text, needle, name) => ok(String(text || '').includes(needle), name, `响应里找不到 ${JSON.stringify(needle)}: ${String(text || '').slice(0, 200)}`)

// ---------- 被测进程的环境矩阵 ----------
const APP_ID = '10000001'
const APP_SECRET = 'test-secret-0123456789abcdef'
const GROUP_ID = 'GROUPOPENIDFORTEST'
const GH_TOKEN = 'ghp_dummy0000000000zzzz'
const RAW_SECRET = 'route-token-for-test-9f3a'
const TIMER_SECRET = 'timer-secret-for-test-7b21'
const BOT_MENTION = '183DA99311014124CAB4E497F0AF5892'
const FEEDBACK_FILE = 'group-feedback.jsonl' // 与生产端同名的钉死文件(digest / report 同读此名)
const GIST_BASE_TS = 1700000000000 // 假 gist 的 Last-Modified 基准(只用于给出稳定版本头)

const BASE_ENV = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  QQ_APP_ID: APP_ID,
  QQ_APP_SECRET: APP_SECRET,
  QQ_GROUP_OPENID: GROUP_ID,
  GH_TOKEN,
  GIST_ID: '',
}

// 与服务端同一套 Ed25519 密钥派生(官方算法:bot secret 补齐/截断到 32 字节当 seed)
function keyPairFromSecret(secret) {
  let seed = Buffer.from(secret, 'utf8')
  while (seed.length < 32) seed = Buffer.concat([seed, seed])
  seed = seed.subarray(0, 32)
  const pkcs8 = Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed])
  const priv = crypto.createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' })
  return { priv, pub: crypto.createPublicKey(priv) }
}
const KEYS = keyPairFromSecret(APP_SECRET)

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
}

function httpReq(port, method, pathname, { body, headers, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: pathname, headers: headers || {} }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch { /* 非 JSON(如 413 中途断开) */ }
        resolve({ status: res.statusCode, text, json })
      })
    })
    req.on('error', (e) => resolve({ status: 0, text: 'ERR:' + e.code, json: null })) // 连接层错误也当结果返回,便于断言"没挂"
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')) })
    if (body) req.write(body)
    req.end()
  })
}

/** 起一个 trap:记录命中次数,回一个类 OpenAI 的响应(证明"真的被调用了") */
// fail=true 时回 500:用来证明"请求确实走到了花钱的那条路",同时让 llmReply 抛错 ⇒ 不会继续去打
// 真实 QQ 接口(qqSend)。#531 的攻击链要证明"匿名流量能触达 LLM key",但也必须保持零外部网络。
function startTrap({ fail = false } = {}) {
  const hits = []
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      hits.push({ url: req.url, auth: String(req.headers.authorization || '') })
      res.writeHead(fail ? 500 : 200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(fail ? { error: 'trap-intentional-failure' } : { choices: [{ message: { content: 'TRAP-REPLY' } }] }))
    })
  })
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, port: srv.address().port, stop: () => new Promise((r) => srv.close(r)) }))
  })
}

/**
 * 起一个**本进程内的假 GitHub(gist)**:实现 ETag/If-Match/412 语义,零外部网络。
 * 只在需要「伪造反馈到底有没有入库」这类**存储侧副作用**的用例里使用(P1b / P6)。
 * injectAfterPatch:成功 PATCH 之后、客户端回读之前,由"并发写者 B"追加的一行 —— #537 的交错就是这么发生的。
 */
function startFakeGist({ initial = '', injectAfterPatch = '', omitVersionHeaders = false } = {}) {
  const state = { content: initial, version: 0, gets: 0, patches: [], conflicts: 0, injected: false }
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
        return send(200, { files: files() }, omitVersionHeaders ? {} : {
          ETag: '"v' + state.version + '"',
          'Last-Modified': new Date(GIST_BASE_TS + state.version * 1000).toUTCString(),
        })
      }
      if (req.method === 'PATCH') {
        const ifMatch = req.headers['if-match'] || ''
        state.patches.push({ ifMatch, ius: req.headers['if-unmodified-since'] || '' })
        if (!omitVersionHeaders && ifMatch !== '"v' + state.version + '"') { state.conflicts++; return send(412, { message: 'stale' }) }
        let parsed = null
        try { parsed = JSON.parse(body) } catch { parsed = null }
        const next = parsed && parsed.files && parsed.files[FEEDBACK_FILE] && typeof parsed.files[FEEDBACK_FILE].content === 'string'
          ? parsed.files[FEEDBACK_FILE].content : null
        if (next === null) return send(400, { message: 'bad-request' })
        state.content = next
        state.version++
        if (injectAfterPatch && !state.injected) {
          // ★并发写者 B:它的追加是**合法**的,客户端回读因此得到"别人也写过"的文件
          state.content = state.content + injectAfterPatch + '\n'
          state.version++
          state.injected = true
        }
        return send(200, { files: files() })
      }
      send(405, { message: 'method-not-allowed' })
    })
  })
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({
    state,
    content: () => state.content,
    port: srv.address().port,
    stop: () => new Promise((r) => srv.close(r)),
  })))
}

/** spawn 被测函数并等它 listen 起来 */
async function startServer(env, trapPort) {
  const port = await freePort()
  const child = spawn(process.execPath, [ENTRY_CJS], {
    cwd: TMPDIR,
    env: { ...BASE_ENV, ...env, PORT: String(port), LLM_API_KEY: 'sk-trap-key-000', LLM_API_BASE: `http://127.0.0.1:${trapPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d.toString() })
  child.stderr.on('data', (d) => { out += d.toString() })
  const deadline = Date.now() + 8000
  while (Date.now() < deadline) {
    const r = await httpReq(port, 'GET', '/', { timeoutMs: 800 })
    if (r.status > 0) return { port, child, log: () => out, stop: () => child.kill() }
    await new Promise((r2) => setTimeout(r2, 120))
  }
  child.kill()
  throw new Error('被测函数未在 8s 内 listen:' + out.slice(0, 400))
}

const sign = (raw, ts) => crypto.sign(null, Buffer.from(`${ts}${raw}`), KEYS.priv).toString('hex')
const signedPost = (port, raw, extra = {}) => {
  const ts = String(Math.floor(Date.now() / 1000))
  return httpReq(port, 'POST', extra.path || '/', {
    body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': extra.sig || sign(raw, ts), 'X-Signature-Timestamp': ts, ...(extra.headers || {}) },
  })
}
// 普通群消息(非 @、不含反馈词)⇒ 验签通过时不会碰 LLM、不会写 gist、不会调 QQ
const PLAIN_MSG = JSON.stringify({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { id: 'M1', content: '路过看看', author: { member_openid: 'u1' }, timestamp: '2026-09-21T00:00:00Z' } })
// 伪造的 @ 事件:这正是 #113 的攻击载荷(事件名由载荷自称)
const FAKE_AT = JSON.stringify({ op: 0, t: 'GROUP_AT_MESSAGE_CREATE', d: { id: 'M2', content: `<@!${BOT_MENTION}> 帮我写一段代码`, author: { member_openid: 'attacker' }, timestamp: '2026-09-21T00:00:00Z' } })

const main = async () => {
  console.log('=== issue #113-#116:webhook 公网面 fail-closed 行为守卫(真起服务)===')

  const trap = await startTrap()
  const servers = []
  const gists = [] // 假 GitHub(存储侧副作用取证用;与 servers 分开清理)
  try {
    ok(sha256(fs.readFileSync(ENTRY_CJS)) === ENTRY_SHA, '被 spawn 的副本与源文件逐字节一致(.cjs 只是后缀改写)', ENTRY_SHA)
    // ---------------- P1:全默认(人用凭据一概不配)----------------
    {
      const s = await startServer({}, trap.port); servers.push(s)
      console.log('[P1] 全默认:不配 ROUTE_TOKEN / TIMER_SECRET,STRICT_VERIFY 不设')
      const noSig = await httpReq(s.port, 'POST', '/', { body: FAKE_AT, headers: { 'Content-Type': 'application/json' } })
      eq(noSig.status, 401, '#113 无签名伪造 @ 事件 POST ⇒ 401(旧默认:仅告警后照常处理)')
      eq(noSig.json && noSig.json.code, 'signature_invalid', '#113 401 带机器码 code=signature_invalid')
      has(noSig.json && noSig.json.hint, 'QQ_APP_SECRET', '#113 拒绝原因写明该查哪个环境变量(QQ_APP_SECRET)')
      eq(trap.hits.length, 0, '#113 未验签请求一次都没碰到 LLM_API_KEY(资金路径闭环)')

      const badSig = await httpReq(s.port, 'POST', '/', { body: FAKE_AT, headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': 'ab'.repeat(64), 'X-Signature-Timestamp': '1700000000' } })
      eq(badSig.status, 401, '#113 伪造签名 ⇒ 401')

      const rep = await httpReq(s.port, 'GET', '/?report=12')
      eq(rep.status, 403, '#115 未配 ROUTE_TOKEN 时 ?report= ⇒ 403(旧实现:匿名可读群聊原文)')
      eq(rep.json && rep.json.code, 'route_token_unconfigured', '#115 report 403 用 route_token_unconfigured 区分"没配"')
      has(rep.json && rep.json.hint, 'ROUTE_TOKEN', '#115 403 说明写明要配 ROUTE_TOKEN')

      const dg = await httpReq(s.port, 'GET', '/?diag=1')
      eq(dg.status, 403, '#115 未配 ROUTE_TOKEN 时 ?diag=1 ⇒ 403')
      const dgW = await httpReq(s.port, 'GET', '/?diag=1&write=1')
      eq(dgW.status, 403, '#115 匿名 write=1 写探针 ⇒ 403(旧实现:真写一行进 gist)')

      const tm = await httpReq(s.port, 'POST', '/', { body: '{"Type":"Timer","TriggerName":"digest_dispatch"}', headers: { 'Content-Type': 'application/json' } })
      eq(tm.status, 403, '#114 未配 TIMER_SECRET 的 POST timer ⇒ 403(旧实现:POST 分支完全不查 key)')
      eq(tm.json && tm.json.code, 'timer_secret_unconfigured', '#114 403 用 timer_secret_unconfigured 说明原因')
      has(tm.json && tm.json.hint, 'TIMER_SECRET', '#114 403 说明写明要配 TIMER_SECRET')

      const big = await httpReq(s.port, 'POST', '/', { body: 'x'.repeat(1024 * 1024 + 8), headers: { 'Content-Type': 'application/json', 'Content-Length': String(1024 * 1024 + 8) } })
      eq(big.status, 413, '#116 超过 1MB 的入站 body ⇒ 413(旧实现:无界累积后 concat)')
      ok(big.text.includes('body_too_large') || (big.json && big.json.code === 'body_too_large'), '#116 413 带 body_too_large 标记', big.text.slice(0, 160))

      // QQ 平台回调:带正确签名、不带任何自定义 token ⇒ 必须 200(新门不许锁死回调)
      const cb = await signedPost(s.port, PLAIN_MSG)
      eq(cb.status, 200, '#113/#115 QQ 回调路径(有效 Ed25519 签名、**不带** token)仍 200 —— 新门没锁死平台回调')
      ok(cb.json && cb.json.v, '回调响应对非 op=13 事件带版本标记 v', JSON.stringify(cb.json))
      eq(trap.hits.length, 0, 'P1 全程 LLM trap 命中 0 次')

      // op=13 URL 验证握手:平台侧不要求我们先验签,响应里的签名必须能被我方公钥验证
      const raw13 = JSON.stringify({ op: 13, d: { plain_token: 'pt-123', event_ts: '1700000000' } })
      const h13 = await httpReq(s.port, 'POST', '/', { body: raw13, headers: { 'Content-Type': 'application/json' } })
      eq(h13.status, 200, 'op=13 握手无需验签 ⇒ 200(平台侧要求)')
      eq(h13.json && h13.json.plain_token, 'pt-123', 'op=13 回传 plain_token')
      const sigOk13 = h13.json && h13.json.signature && crypto.verify(null, Buffer.from('1700000000pt-123'), KEYS.pub, Buffer.from(h13.json.signature, 'hex'))
      ok(sigOk13, 'op=13 应答签名可用 QQ_APP_SECRET 派生的公钥验证(密钥派生未跑偏)')
    }
    // ---------------- P1b:#531 攻击链(匿名握手替业务回调签名 → 重放)----------------
    // 链条:无签名回调 401 → 匿名 op=13 把业务事件原串当 plain_token → 换回一个与回调**互用**的签名
    //       → 重放业务回调 200 → 伪造反馈入库 + verified 被伪造后匿名流量走到烧 LLM_API_KEY 的路。
    // 这里专配 GIST_ID(指向假 GitHub):「伪造反馈有没有入库」必须在存储侧看,不能只看状态码。
    {
      const gist = await startFakeGist(); gists.push(gist)
      const failTrap = await startTrap({ fail: true }) // 回 500:证明触达了 LLM,同时不让它继续去打真实 QQ
      const s = await startServer({ GIST_ID: 'gist-attack-test', GITHUB_API_BASE: 'http://127.0.0.1:' + gist.port }, failTrap.port)
      servers.push(s)
      console.log('[P1b] #531 攻击链:握手不能再替任意正文签名')
      const evilText = '反馈 你们的插件把数据弄丢了(伪造)'
      const evilRaw = JSON.stringify({
        op: 0, t: 'GROUP_AT_MESSAGE_CREATE',
        d: { id: 'EVIL-1', timestamp: '2026-11-03T00:00:00Z', author: { member_openid: 'attacker', username: 'attacker' }, content: '<@!' + BOT_MENTION + '> ' + evilText },
      })
      const stealTs = '1700000000'

      // ① 攻击链起点:同一个业务正文不带签名 ⇒ 401
      const noSig = await httpReq(s.port, 'POST', '/', { body: evilRaw, headers: { 'Content-Type': 'application/json' } })
      eq(noSig.status, 401, '#531 攻击链起点:伪造 @ 事件不带签名 ⇒ 401')
      eq(gist.state.patches.length, 0, '#531 起点:被拒请求一次 gist 写都没发生')
      const trapBefore = failTrap.hits.length

      // ② 匿名 op=13,plain_token = 业务正文原串 ⇒ 必须 400 且**不回签名**
      //    (修前:200 + sign(event_ts + 业务正文),正是重放要用的那把钥匙)
      const hs = await httpReq(s.port, 'POST', '/', {
        body: JSON.stringify({ op: 13, d: { plain_token: evilRaw, event_ts: stealTs } }),
        headers: { 'Content-Type': 'application/json' },
      })
      eq(hs.status, 400, '★#531 把业务正文当 plain_token 的握手 ⇒ 400(修前:200 + 与回调互用的签名)')
      eq(hs.json && hs.json.code, 'bad_handshake', '#531 400 带机器码 bad_handshake(可判、可监控)')
      ok(!(hs.json && hs.json.signature), '★#531 拒绝时**不交出**任何签名(修前:把可用签名直接交给匿名者)', JSON.stringify(hs.json).slice(0, 200))

      // ③ 用(修前会拿到的)那把签名重放业务回调 ⇒ 401 / 不写 gist / 不碰 LLM
      const forged = (hs.json && hs.json.signature) || 'ab'.repeat(64)
      const replay = await httpReq(s.port, 'POST', '/', {
        body: evilRaw,
        headers: { 'Content-Type': 'application/json', 'X-Signature-Ed25519': forged, 'X-Signature-Timestamp': stealTs },
      })
      eq(replay.status, 401, '★#531 重放握手签名当业务回调签名 ⇒ 401')
      eq(gist.state.patches.length, 0, '★#531 伪造反馈没有入库(假 gist 上 0 次 PATCH)')
      eq(gist.content(), '', '★#531 假 gist 的 group-feedback.jsonl 仍为空(修前会多一行伪造反馈)')
      await new Promise((r) => setTimeout(r, 300))
      eq(failTrap.hits.length - trapBefore, 0, '★#531 匿名流量一次都没走到花 LLM_API_KEY 的路(LLM trap 命中不增)')

      // ④ 握手载荷校验:形状不对一律 400 且不签名(修前只判"缺字段",其余全部照签)
      const hsBad = [
        ['event_ts 不是纯数字串', { op: 13, d: { plain_token: 'pt-abc', event_ts: '1700000000x' } }],
        ['event_ts 是对象(修前被模板串静默 stringify)', { op: 13, d: { plain_token: 'pt-abc', event_ts: { evil: 1 } } }],
        ['plain_token 是对象(修前同样被 stringify)', { op: 13, d: { plain_token: { a: 1 }, event_ts: '1700000000' } }],
        ['plain_token 为空串', { op: 13, d: { plain_token: '', event_ts: '1700000000' } }],
        ['plain_token 超 256 字符', { op: 13, d: { plain_token: 'p'.repeat(257), event_ts: '1700000000' } }],
        ['plain_token 含左花括号', { op: 13, d: { plain_token: '{"op":0}', event_ts: '1700000000' } }],
        ['plain_token 含双引号', { op: 13, d: { plain_token: 'a"b', event_ts: '1700000000' } }],
      ]
      for (const [label, body] of hsBad) {
        const r = await httpReq(s.port, 'POST', '/', { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
        eq(r.status, 400, '#531 握手校验:' + label + ' ⇒ 400')
        ok(!(r.json && r.json.signature), '#531 握手校验:' + label + ' 不回签名')
      }

      // ⑤ 免验签只留给**最小握手信封**:多一个字段 / d 多一个键 / d 是数组 ⇒ 走正常验签(无签名 ⇒ 401)
      const envBad = [
        ['顶层多一个字段', JSON.stringify({ op: 13, d: { plain_token: 'pt-ok', event_ts: '1700000000' }, extra: 1 })],
        ['d 多一个键', JSON.stringify({ op: 13, d: { plain_token: 'pt-ok', event_ts: '1700000000', extra: 1 } })],
        ['d 是数组', JSON.stringify({ op: 13, d: [{ plain_token: 'pt-ok', event_ts: '1700000000' }] })],
        ['d 不是普通对象(字符串)', JSON.stringify({ op: 13, d: 'x' })],
        ['顶层只有 op、没有 d', JSON.stringify({ op: 13 })],
      ]
      for (const [label, raw] of envBad) {
        const r = await httpReq(s.port, 'POST', '/', { body: raw, headers: { 'Content-Type': 'application/json' } })
        eq(r.status, 401, '★#531 非最小握手信封(' + label + ')⇒ 401(修前:整段跳过验签并回 200)')
        ok(!(r.json && r.json.signature), '#531 非最小握手信封(' + label + ')不回签名')
      }

      // ⑥ 正路径:合法最小握手仍 200 且签名可验;合法签名回调仍 200
      const pt = 'pt-legit-531'
      const hsOk = await httpReq(s.port, 'POST', '/', { body: JSON.stringify({ op: 13, d: { plain_token: pt, event_ts: '1700000000' } }), headers: { 'Content-Type': 'application/json' } })
      eq(hsOk.status, 200, '#531 合法握手(最小信封)⇒ 200 —— 收窄没有锁死平台握手')
      eq(hsOk.json && hsOk.json.plain_token, pt, '#531 合法握手原样回传 plain_token')
      ok(hsOk.json && crypto.verify(null, Buffer.from('1700000000' + pt), KEYS.pub, Buffer.from(hsOk.json.signature, 'hex')),
        '#531 合法握手签名可用派生公钥验证(签名口径未变:event_ts+plain_token)')
      const cbOk = await signedPost(s.port, PLAIN_MSG)
      eq(cbOk.status, 200, '#531 合法签名回调仍 200(修法没有波及平台回调)')
      eq(gist.state.patches.length, 0, '#531 正路径不产生任何伪造写入')
    }
    // ---------------- P2:只设 STRICT_VERIFY=0(单个开关)----------------
    {
      const s = await startServer({ STRICT_VERIFY: '0', ROUTE_TOKEN: RAW_SECRET }, trap.port); servers.push(s)
      console.log('[P2] 只设 STRICT_VERIFY=0:验签不应被单个开关关掉')
      const noSig = await httpReq(s.port, 'POST', '/', { body: FAKE_AT, headers: { 'Content-Type': 'application/json' } })
      eq(noSig.status, 401, '#113 单个 STRICT_VERIFY=0 不再能关掉验签(需同时 ALLOW_INSECURE_VERIFY=1)')
      const dg = await httpReq(s.port, 'GET', '/?diag=1&token=' + RAW_SECRET)
      eq(dg.status, 200, '[P2] 带 ROUTE_TOKEN 可读 diag(凭据通道生效)')
      eq(dg.json && dg.json.strictVerify, true, '#113 diag 自报 strictVerify=true —— 单个开关无效')
      eq(dg.json && dg.json.insecureMode, false, '#113 diag 自报 insecureMode=false')
    }
    // ---------------- P3:两个开关都设(显式联调模式)----------------
    {
      const s = await startServer({ STRICT_VERIFY: '0', ALLOW_INSECURE_VERIFY: '1' }, trap.port); servers.push(s)
      console.log('[P3] STRICT_VERIFY=0 + ALLOW_INSECURE_VERIFY=1:显式放行,但资金路径仍要拦')
      const before = trap.hits.length
      const noSig = await httpReq(s.port, 'POST', '/', { body: FAKE_AT, headers: { 'Content-Type': 'application/json' } })
      eq(noSig.status, 200, '#113 显式联调模式下未验签请求被处理(明确写下的选择,不再是"漏配的默认")')
      await new Promise((r) => setTimeout(r, 300))
      eq(trap.hits.length - before, 0, '#113 ★ 即便显式关掉验签,未验签的 @ 事件也**不会**花 LLM_API_KEY(第二道门)')
      has(s.log(), '已跳过 LLM 答疑', '#113 跳过 LLM 时会写一条可读日志(便于线上排查)')
    }
    // ---------------- P4:人用凭据 + 定时密钥都配齐 ----------------
    {
      const s = await startServer({ ROUTE_TOKEN: RAW_SECRET, TIMER_SECRET }, trap.port); servers.push(s)
      console.log('[P4] ROUTE_TOKEN + TIMER_SECRET 配齐:人用端点走凭据,timer 走密钥+触发名')
      const dgNo = await httpReq(s.port, 'GET', '/?diag=1')
      eq(dgNo.status, 403, '#115 diag 无凭据 ⇒ 403')
      eq(dgNo.json && dgNo.json.code, 'route_token_mismatch', '#115 区分"配了但没带"(route_token_mismatch)')
      const dgBad = await httpReq(s.port, 'GET', '/?diag=1&token=' + RAW_SECRET.slice(0, -1))
      eq(dgBad.status, 403, '#115 凭据错一位 ⇒ 403')

      const dg = await httpReq(s.port, 'GET', '/?diag=1&token=' + RAW_SECRET)
      eq(dg.status, 200, '#115 带对凭据 ⇒ 200')
      // ★ 方针「人看得懂」:一眼核对部署 = 版本号 + 三个布尔
      eq(dg.json && dg.json.deployCheck && dg.json.deployCheck['严格验签'], true, 'diag.deployCheck.严格验签 = true')
      eq(dg.json && dg.json.deployCheck && dg.json.deployCheck['原始调试'], false, '#116 diag.deployCheck.原始调试 = false(默认关)')
      eq(dg.json && dg.json.deployCheck && dg.json.deployCheck['密钥已配'], true, 'diag.deployCheck.密钥已配 = true')
      ok(dg.json && typeof dg.json.verdict === 'string' && dg.json.verdict.includes('部署核对') && dg.json.verdict.includes(dg.json.v), 'diag.verdict 一行写清版本 + 三布尔', dg.json && dg.json.verdict)
      eq(dg.json && dg.json.rawDebug, false, '#116 diag.rawDebug = false')
      eq(dg.json && dg.json.routeTokenConfigured, true, 'diag.routeTokenConfigured = true')
      eq(dg.json && dg.json.timerSecretConfigured, true, '#114 diag.timerSecretConfigured = true')
      eq(dg.json && dg.json.ghDispatchTokenConfigured, false, '#114 未配 GH_DISPATCH_TOKEN 时定时入口仍拒绝 dispatch(diag 可见)')
      // ★ #115:身份标识只留尾 4 位;密钥形状不再外显
      eq(dg.json && dg.json.identity && dg.json.identity.appIdTail, '…' + APP_ID.slice(-4), '#115 appId 只留尾 4 位')
      eq(dg.json && dg.json.identity && dg.json.identity.groupIdTail, '…' + GROUP_ID.slice(-4), '#115 groupId 只留尾 4 位')
      ok(!dg.text.includes(APP_ID), '#115 diag 响应体不含完整 appId')
      ok(!dg.text.includes(GROUP_ID), '#115 diag 响应体不含完整 groupId')
      ok(!dg.text.includes('ghp_'), '#115 diag 响应体不含 ghToken 任何前缀')
      ok(!dg.text.includes(RAW_SECRET) && !dg.text.includes(TIMER_SECRET), '#115 diag 不回显 ROUTE_TOKEN / TIMER_SECRET 本身')
      ok(dg.json && dg.json.gistProbe && dg.json.gistProbe.skipped, 'diag 在未配 GIST_ID 时跳过 gist 探针(测试与线上都不发无意义出站请求)')
      ok(dg.json && dg.json.rejects && typeof dg.json.rejects.count === 'number', 'diag.rejects 暴露拒绝计数(部署后用它判断有没有匿名流量在敲门)')
      const dgHdr = await httpReq(s.port, 'GET', '/?diag=1', { headers: { 'x-route-token': RAW_SECRET } })
      eq(dgHdr.status, 200, '#115 x-route-token 请求头通道也认(便于脚本调用)')

      const rep = await httpReq(s.port, 'GET', '/?report=12&token=' + RAW_SECRET)
      eq(rep.status, 200, '#115 带凭据的 ?report= ⇒ 200')
      eq(rep.json && rep.json.total, 0, '#115 report 正常返回结构(window 内 0 条)')
      const repNo = await httpReq(s.port, 'GET', '/?report=12')
      eq(repNo.status, 403, '#115 无凭据读群聊原文 ⇒ 403')
      ok(!SRC.includes('tail=${CFG.llm.key.slice(-4)}'), '#115 源码里已无"回显 LLM key 尾 4 位"的写法(只回布尔)')

      // ---- timer(#114)----
      const tOk = await httpReq(s.port, 'POST', '/', { body: '{"Type":"Timer","TriggerName":"digest_dispatch"}', headers: { 'Content-Type': 'application/json', 'x-timer-secret': TIMER_SECRET } })
      eq(tOk.status, 200, '#114 持密钥 + 触发名正确的 POST timer ⇒ 200 受理')
      ok(tOk.json && tOk.json.accepted === true, '#114 受理响应对调用方是明确的 accepted')
      const tBad = await httpReq(s.port, 'POST', '/', { body: '{"Type":"Timer","TriggerName":"digest_dispatch"}', headers: { 'Content-Type': 'application/json', 'x-timer-secret': 'wrong' } })
      eq(tBad.status, 403, '#114 POST 分支密钥错 ⇒ 403(旧实现:完全不查 key)')
      eq(tBad.json && tBad.json.code, 'timer_secret_mismatch', '#114 用 timer_secret_mismatch 区分"带错"')
      const tNoName = await httpReq(s.port, 'POST', '/', { body: '{"Type":"Timer"}', headers: { 'Content-Type': 'application/json', 'x-timer-secret': TIMER_SECRET } })
      eq(tNoName.status, 403, '#114 密钥对但载荷省略 TriggerName ⇒ 403(旧实现:省略即跳过校验)')
      eq(tNoName.json && tNoName.json.code, 'timer_trigger_mismatch', '#114 用 timer_trigger_mismatch 说明是触发名问题')
      has(tNoName.json && tNoName.json.hint, 'TriggerName', '#114 拒绝原因写清"TriggerName 缺失不再等于跳过"')
      const tWrongName = await httpReq(s.port, 'POST', '/', { body: '{"Type":"Timer","TriggerName":"someone_else"}', headers: { 'Content-Type': 'application/json', 'x-timer-secret': TIMER_SECRET } })
      eq(tWrongName.status, 403, '#114 触发名不匹配 ⇒ 403')
      const tQ = await httpReq(s.port, 'GET', '/?timer=1&key=' + TIMER_SECRET + '&trigger=digest_dispatch')
      eq(tQ.status, 200, '#114 手动 GET ?timer=1&key=…&trigger=… 持密钥 ⇒ 200')
      const tQB = await httpReq(s.port, 'GET', '/?timer=1&key=' + TIMER_SECRET + '&trigger=nope')
      eq(tQB.status, 403, '#114 手动 GET 触发名错 ⇒ 403')

      // ---- QQ 平台回调:配了 ROUTE_TOKEN 也**不**要求 token ----
      const cb = await signedPost(s.port, PLAIN_MSG)
      eq(cb.status, 200, '★ 配了 ROUTE_TOKEN 后,未带 token 的 QQ 回调(签名有效)仍 200 —— 回调路径不受新门影响')
      eq(trap.hits.length, 0, 'P4 全程 LLM trap 命中 0 次(用非 @ 消息验证回调路径,不触发任何出站调用)')
    }
    // ---------------- P5:#538 人用端点准入 = 三条明确通道(请求头 / ?token= / 路径段整段相等)----------------
    // 复现形态:ROUTE_TOKEN 恰好是 "report" 这种**在 URL 里必然出现**的词时,旧的
    //   `String(req.url).includes(tok)` 直接放行 ⇒ 匿名 GET /?report=1 读出群聊原文。
    // 用户裁定:不删兼容分支(老文档的 /<ROUTE_TOKEN>/?report=N 要照常可用),收窄成三条明确通道。
    {
      const s = await startServer({ ROUTE_TOKEN: 'report' }, trap.port); servers.push(s)
      console.log('[P5] #538 ROUTE_TOKEN=report(令牌值恰好是查询参数名):子串放行必须收窄成三条通道')
      const repAnon = await httpReq(s.port, 'GET', '/?report=1')
      eq(repAnon.status, 403, '★#538 令牌=report 时无凭据 GET /?report=1 ⇒ 403(修前:子串放行,匿名读出群聊原文)')
      eq(repAnon.json && repAnon.json.code, 'route_token_mismatch', '#538 403 用 route_token_mismatch 区分"配了但没带"')
      ok(!/"items"/.test(repAnon.text), '#538 被拒响应里没有任何反馈正文')

      const dgX = await httpReq(s.port, 'GET', '/?diag=1&x=report')
      eq(dgX.status, 403, '★#538 令牌只出现在**别的查询参数值**里(?diag=1&x=report)⇒ 403(该分支不得再看 query)')

      const segContain = await httpReq(s.port, 'GET', '/xreport/?report=1')
      eq(segContain.status, 403, '★#538 路径段只是**包含**令牌(xreport)⇒ 403(要求整段完全等于)')

      const segOk = await httpReq(s.port, 'GET', '/report/?report=12')
      eq(segOk.status, 200, '#538 兼容:路径段整段等于令牌 /report/?report=12 仍 200(老文档的部署形态不被破坏)')

      const qOk = await httpReq(s.port, 'GET', '/?diag=1&token=report')
      eq(qOk.status, 200, '#538 通道②:?token= 精确匹配仍 200')

      const hOk = await httpReq(s.port, 'GET', '/?diag=1', { headers: { 'x-route-token': 'report' } })
      eq(hOk.status, 200, '#538 通道①:请求头 x-route-token 精确匹配仍 200')

      const wrong = await httpReq(s.port, 'GET', '/?diag=1&token=repor')
      eq(wrong.status, 403, '#538 令牌错一个字符 ⇒ 403(精确比较,不是子串/前缀)')
    }
    // ---------------- P6:#537 写成功后不再误判失败而重复追加 ----------------
    // 实测形态:A PATCH 成功 → 写者 B 并发追加 → A 回读到的整份文件 ≠ A 自己写的那份 ⇒ 判失败
    //          → 重试再追加一遍 → 最终 A/B/A(而 POST 却回 200)。
    // 交错由假 GitHub 在「PATCH 成功之后、回读之前」严格注入,不靠时序碰运气。
    {
      const B_LINE = JSON.stringify({ u: 'B', m: '并发写者 B 追加的一条' })
      const gist = await startFakeGist({ injectAfterPatch: B_LINE }); gists.push(gist)
      const s = await startServer({ GIST_ID: 'gist-537-test', GITHUB_API_BASE: 'http://127.0.0.1:' + gist.port }, trap.port); servers.push(s)
      console.log('[P6] #537 回读只认「本行在不在」:并发写者的行不再让本次写入被判失败')
      const textA = '反馈 并发:A 的这条记录'
      const r = await signedPost(s.port, JSON.stringify({
        op: 0, t: 'GROUP_MESSAGE_CREATE',
        d: { id: 'msg-537-a', content: textA, author: { member_openid: 'u-537-a' }, timestamp: '2026-11-04T00:00:00Z' },
      }))
      eq(r.status, 200, '#537 并发改写场景下本次反馈仍 200(它确实写成功了)')
      const lines = gist.content().split('\n').filter(Boolean)
      eq(lines.filter((l) => l.includes('A 的这条记录')).length, 1, '★#537 A 的那条记录只出现 **1** 次(修前:PATCH 成功→回读不等→重试→A/B/A 两份)')
      ok(lines.some((l) => l.includes('并发写者 B 追加的一条')), '#537 并发写者 B 的行没有被覆盖丢(修法不是靠"独占"解决)', JSON.stringify(lines))
      // 稳定身份 k 必须真的落盘:它是幂等与回读判据唯一认的字段,不能只是注释里写着
      const aLine = lines.find((l) => l.includes('A 的这条记录')) || '{}'
      let aObj = {}
      try { aObj = JSON.parse(aLine) } catch { aObj = {} }
      const wantKey = crypto.createHash('sha1').update('msg-537-a|' + textA, 'utf8').digest('hex').slice(0, 12)
      eq(aObj.k, wantKey, '★#537 落盘的反馈行带稳定身份 k = sha1(d.id|正文) 前 12 位(幂等与回读只认它)')
      ok(/^[0-9a-f]{12}$/.test(String(aObj.k || '')), '#537 k 是 12 位十六进制(不是空串/随机值)', String(aObj.k))
      eq(gist.state.patches.length, 1, '★#537 只发一次 PATCH(修前:被判失败后再发一次 —— 那一次就是重复的来源)')
      ok(gist.state.patches.every((p) => p.ifMatch), '★#537 条件请求头没被放宽(If-Match 仍在,修法只动回读判据)', JSON.stringify(gist.state.patches))
    }
    {
      // 幂等追加:本行已在文件里(例如上一次 PATCH 成功但响应丢失,平台重投同一条)⇒ 一次 PATCH 都不发
      const textB = '反馈 幂等:这条已经在文件里了'
      const keyB = crypto.createHash('sha1').update('msg-537-b|' + textB).digest('hex').slice(0, 12)
      const seed = JSON.stringify({ t: '2026-11-04T00:00:00Z', k: keyB, u: 'u-537-b', w: '反馈', m: textB })
      const gist = await startFakeGist({ initial: seed + '\n' }); gists.push(gist)
      const s = await startServer({ GIST_ID: 'gist-537-idem', GITHUB_API_BASE: 'http://127.0.0.1:' + gist.port }, trap.port); servers.push(s)
      const r = await signedPost(s.port, JSON.stringify({
        op: 0, t: 'GROUP_MESSAGE_CREATE',
        d: { id: 'msg-537-b', content: textB, author: { member_openid: 'u-537-b' }, timestamp: '2026-11-04T00:00:00Z' },
      }))
      eq(r.status, 200, '#537 同一事件重投(本行已在文件里)⇒ 200 幂等')
      eq(gist.state.patches.length, 0, '★#537 本行已在 ⇒ 一次 PATCH 都不发(修前:再追加一份重复行)')
      eq(gist.content(), seed + '\n', '★#537 文件内容逐字节未变(没有第二份)')
      eq(gist.content().split('\n').filter(Boolean).length, 1, '#537 文件仍是 1 行')
    }

  } finally {
    for (const s of servers) { try { s.stop() } catch { /* ignore */ } }
    for (const g of gists) { try { await g.stop() } catch { /* ignore */ } }
    await trap.stop()
    try { fs.rmSync(TMPDIR, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  // =====================================================================
  // P7 变异反向验证(父进程):把 #531 / #538 / #537 的三处修复分别改回去 ⇒ 本套件**必须变红**;
  //   还原 ⇒ 必须复绿。守卫的价值等于它抓得住的错,不是它跑绿了。
  //   变异只写临时副本(QQWEBHOOK_ENTRY 指过去),**不碰源文件**。
  // =====================================================================
  if (!process.env.QQWEBHOOK_CHILD) {
    const SRC_LF = SRC
    const hits = (s, a) => s.split(a).length - 1
    const Q = String.fromCharCode(39)
    const ANCHOR_HANDSHAKE_GUARD = '    if (!hs.ok) {\n'
    const ANCHOR_HANDSHAKE_VALIDATE = '  if (hasJsonStructCharsPre(plainToken)) {\n'
    const ANCHOR_ENVELOPE = '      if (isHandshakeEnvelopePre(payload)) {\n'
    const ANCHOR_SEGMENT = '  const segs = String(url.pathname || ' + Q + Q + ').split(' + Q + '/' + Q + ')\n'
    const ANCHOR_READBACK = '      const lineLanded = !!key && after.split(' + Q + '\\n' + Q + ').some((l) => l.includes(key))\n'
    const ANCHOR_IDEMPOTENT = '    if (key && prev.some((l) => l.includes(key))) return cur // 本行已在 ⇒ 目标状态已达成,不再追加\n'
    eq(hits(SRC_LF, ANCHOR_HANDSHAKE_GUARD), 1, '变异定位:#531 握手校验分支锚点恰命中 1 次')
    eq(hits(SRC_LF, ANCHOR_HANDSHAKE_VALIDATE), 1, '变异定位:#531 结构字符判据锚点恰命中 1 次')
    eq(hits(SRC_LF, ANCHOR_ENVELOPE), 1, '变异定位:#531 最小信封锚点恰命中 1 次')
    eq(hits(SRC_LF, ANCHOR_SEGMENT), 1, '变异定位:#538 路径段锚点恰命中 1 次')
    eq(hits(SRC_LF, ANCHOR_READBACK), 1, '变异定位:#537 回读判据锚点恰命中 1 次')
    eq(hits(SRC_LF, ANCHOR_IDEMPOTENT), 1, '变异定位:#537 幂等追加锚点恰命中 1 次')

    const MUT = [
      ['m1-handshake-not-validated', ANCHOR_HANDSHAKE_GUARD, '    if (false) {\n', '#531 把业务正文当 plain_token 的握手'],
      ['m2-no-struct-char-rule', ANCHOR_HANDSHAKE_VALIDATE, '  if (false) {\n', '#531 握手校验:plain_token 含左花括号'],
      ['m3-envelope-op-only', ANCHOR_ENVELOPE, '      if (payload.op === 13) {\n', '★#531 非最小握手信封(顶层多一个字段)'],
      ['m4-url-substring-legacy', ANCHOR_SEGMENT, '  if (String(req.url || \'\').includes(tok)) return { ok: true, legacy: true }\n', '★#538 令牌=report 时无凭据 GET /?report=1'],
      ['m6-no-idempotent-append', ANCHOR_IDEMPOTENT, '', '★#537 本行已在 ⇒ 一次 PATCH 都不发'],
    ]
    // ★#537 是**双层**防线:①回读只认本行 ②幂等追加。单撤任一层,另一层仍能挡住重复 ——
    //   这是刻意的纵深防御,不是判据失效。下面把「单撤一层仍绿 / 两层全撤才红」分别量出来,
    //   免得把「单层变异没红」误报成缺陷,也免得把「两层全撤才红」漏成没测。
    const LAYERED = [
      ['m5-readback-only-reverted', [[ANCHOR_READBACK, '      const lineLanded = false\n']], false],
      ['m7-both-537-layers-reverted', [[ANCHOR_READBACK, '      const lineLanded = false\n'], [ANCHOR_IDEMPOTENT, '']], true],
    ]
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qqwebhook-mut-'))
    for (const [label, anchor, replacement, redNeedle] of MUT) {
      const mutated = SRC_LF.split(anchor).join(replacement)
      ok(mutated !== SRC_LF, '变异(' + label + ')真的改到了源(不是替换失败的假变异)')
      // 被测函数是 CJS(require + server.listen),故变异副本落成 .cjs 再由套件 spawn
      const file = path.join(dir, label + '.cjs')
      fs.writeFileSync(file, mutated)
      const syn = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      ok(syn.status === 0, '变异(' + label + ')文件语法可用', 'node --check exit=' + syn.status + ' ' + String(syn.stderr || '').slice(0, 200))
      const rr = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, QQWEBHOOK_ENTRY: file, QQWEBHOOK_CHILD: '1' },
        encoding: 'utf8', maxBuffer: 1 << 26,
      })
      const out = String(rr.stdout || '') + String(rr.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '(未取到计数)') + ' exit=' + rr.status)
      ok(rr.status !== 0, '★变异(' + label + ')必红:子进程退出码非 0', 'status=' + rr.status)
      ok(!!m && Number(m[2]) > 0, '★变异(' + label + ')必红:fail>0', m ? m[0] : '(未取到计数)')
      ok(out.includes('FAIL - ') && out.includes(redNeedle),
        '★变异(' + label + ')红的是**对应那条**断言(有鉴别力),不是别的巧合',
        (out.match(/FAIL - [^\n]*/g) || []).slice(0, 4))
    }
    for (const [label, edits, expectRed] of LAYERED) {
      let mutated = SRC_LF
      for (const [anchor, replacement] of edits) mutated = mutated.split(anchor).join(replacement)
      ok(mutated !== SRC_LF, '变异(' + label + ')真的改到了源')
      const file = path.join(dir, label + '.cjs')
      fs.writeFileSync(file, mutated)
      const syn = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
      ok(syn.status === 0, '变异(' + label + ')文件语法可用', 'node --check exit=' + syn.status + ' ' + String(syn.stderr || '').slice(0, 160))
      const rr = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
        env: { ...process.env, QQWEBHOOK_ENTRY: file, QQWEBHOOK_CHILD: '1' },
        encoding: 'utf8', maxBuffer: 1 << 26,
      })
      const out = String(rr.stdout || '') + String(rr.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '(未取到计数)') + ' exit=' + rr.status)
      if (expectRed) {
        ok(rr.status !== 0 && !!m && Number(m[2]) > 0,
          '★变异(' + label + ')必红:#537 两层防线全撤 ⇒ 重复追加复现', m ? m[0] : '(未取到计数)')
        ok(out.includes('FAIL - ') && out.includes('★#537 A 的那条记录只出现'),
          '★变异(' + label + ')红的是「A 那条记录出现 2 次」这条断言(有鉴别力)',
          (out.match(/FAIL - [^\n]*/g) || []).slice(0, 4))
      } else {
        ok(rr.status === 0 && !!m && Number(m[2]) === 0,
          '★变异(' + label + ')应为绿:只撤回读判据时,幂等追加这一层**独立**挡住了重复(纵深防御,非同层冗余)',
          m ? m[0] : '(未取到计数)')
      }
    }
    // 还原基线:源码原字节落成 .cjs 再跑一次 ⇒ 必绿
    const restored = path.join(dir, 'restored-baseline.cjs')
    fs.writeFileSync(restored, SRC_LF)
    const rr0 = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, QQWEBHOOK_ENTRY: restored, QQWEBHOOK_CHILD: '1' },
      encoding: 'utf8', maxBuffer: 1 << 26,
    })
    const out0 = String(rr0.stdout || '') + String(rr0.stderr || '')
    const m0 = out0.match(/pass=(\d+) fail=(\d+)/)
    console.log('  [变异取证] restored-baseline -> ' + (m0 ? m0[0] : '(未取到计数)') + ' exit=' + rr0.status)
    ok(rr0.status === 0, '★还原必绿(源码原字节重跑)', 'status=' + rr0.status + ' ' + (m0 ? m0[0] : ''))
    ok(!!m0 && Number(m0[2]) === 0, '★还原必绿:fail=0', m0 ? m0[0] : '(未取到计数)')
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  console.log('\n--- issue #113-#116 webhook fail-closed 行为守卫 ---')
  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})
