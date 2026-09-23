/**
 * issue #113 / #114 / #115 / #116 回归锁 —— **行为级**守卫(不是文本 grep)。
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
 *
 * 运行:node tests/smoke/smoke-test-issue113-116-webhook-guards-pre.mjs
 * 退出码:有 FAIL 即 1。
 */
import { spawn } from 'node:child_process'
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
function startTrap() {
  const hits = []
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      hits.push({ url: req.url, auth: String(req.headers.authorization || '') })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'TRAP-REPLY' } }] }))
    })
  })
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => resolve({ srv, hits, port: srv.address().port, stop: () => new Promise((r) => srv.close(r)) }))
  })
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

  } finally {
    for (const s of servers) { try { s.stop() } catch { /* ignore */ } }
    await trap.stop()
    try { fs.rmSync(TMPDIR, { recursive: true, force: true }) } catch { /* ignore */ }
  }

  console.log('\n--- issue #113-#116 webhook fail-closed 行为守卫 ---')
  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})
