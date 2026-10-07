/**
 * A6 / 车道 L-D 专项套件 —— 行为级,不是文本 grep。
 *
 *   #265 群摘要(group-digest.mjs)在打印模式 / 投递失败时仍清空反馈队列 ⇒ 消息丢失。
 *        修法:队列只读;消费位置(游标)只在**投递成功之后**的确认里推进;打印/未配置通道/投递失败一律不动。
 *   #266 QQ 监听器(group-listener.mjs)在建单成功之前就持久化 seen ⇒ 建单失败则事件永久丢失。
 *        修法:先建单成功、再写 seen(失败不写);pending 只做内存内的并发重入锁。
 *
 * 做法:把两个脚本**原样复制**到临时目录(先核对 sha256 与源文件一致)后真 import 执行 —— 真控制流、
 * 真 top-level await、真写状态文件;只把 fetch / WebSocket 换成受控替身,用于**注入失败**并记录调用序。
 * 断言对象是**副作用**:gist 请求体、状态文件字节、以及「建单那一刻状态文件里有没有该 id」。
 *
 * 负路径(变异必红、还原复绿):对副本做**锚定**变异(先断言锚串恰命中 1 次),三种旧写法各自必须
 * 让对应判据变红;green 段用的仍是未变异副本。
 *
 * 运行:node tests/smoke/smoke-test-a6-ci-group-queue.mjs(退出码:有 FAIL 即 1)
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const DIGEST_SRC = path.join(ROOT, '.github', 'scripts', 'group-digest.mjs')
const LISTENER_SRC = path.join(ROOT, '.github', 'scripts', 'group-listener.mjs')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-d-a6-'))

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}
const eq = (actual, want, name) => ok(actual === want, name, '期望 ' + JSON.stringify(want) + ',实得 ' + JSON.stringify(actual))
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const waitFor = async (pred, ms) => {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (pred()) return true
    await new Promise((r) => setTimeout(r, 25))
  }
  return !!pred()
}
let copySeq = 0
/** 复制副本;带 edits 时逐条锚定变异,锚串命中数必须恰为 1(否则负路径恒绿) */
function copyVariant(srcPath, edits) {
  let src = fs.readFileSync(srcPath, 'utf8')
  if (edits && edits.length) {
    for (const pair of edits) {
      const hits = src.split(pair[0]).length - 1
      if (hits !== 1) throw new Error('变异锚串命中 ' + hits + ' 次(必须恰为 1):' + pair[0].slice(0, 70))
      src = src.replace(pair[0], pair[1])
    }
  }
  const file = path.join(TMP, 'v' + (++copySeq) + '-' + path.basename(srcPath))
  fs.writeFileSync(file, src)
  return { file: file, sha: sha256(fs.readFileSync(file)), src: src }
}
function saveEnv(keys) {
  const saved = {}
  for (const k of keys) saved[k] = Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined
  return saved
}
function restoreEnv(saved) {
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
}

const okRes = (status, obj, text) => ({ ok: status >= 200 && status < 300, status: status, json: async () => obj, text: async () => (text !== undefined ? text : JSON.stringify(obj)) })

// ============================ #265 / group-digest.mjs ============================
function makeDigestFetch(ctx) {
  return async (url, init) => {
    init = init || {}
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    const body = init.body === undefined ? null : String(init.body)
    const rec = { url: u, method: method, body: body }
    ctx.calls.push(rec)
    if (u.indexOf('api.github.com/gists/') >= 0) {
      if (method === 'PATCH') {
        const parsed = JSON.parse(body)
        const status = typeof ctx.opts.gistPatchStatus === 'function' ? ctx.opts.gistPatchStatus(parsed) : (ctx.opts.gistPatchStatus || 200)
        rec.status = status
        if (status >= 200 && status < 300) {
          for (const name of Object.keys(parsed.files || {})) ctx.gist.files[name] = { content: parsed.files[name].content }
        }
        return okRes(status, {})
      }
      rec.status = 200
      return okRes(200, { files: ctx.gist.files })
    }
    if (u.indexOf('registry.npmjs.org') >= 0) { rec.status = 200; return okRes(200, { version: '9.9.9' }) }
    if (u.indexOf('api.github.com') >= 0) { rec.status = 200; return okRes(200, []) }
    const status = ctx.opts.sendStatus || 200
    rec.status = status
    return okRes(status, {}, status < 300 ? '{"ok":true}' : 'injected-delivery-failure')
  }
}

const DIGEST_ENV_KEYS = ['REPO', 'GITHUB_TOKEN', 'GH_TOKEN', 'SINCE_HOURS', 'MAX_WINDOW_HOURS', 'DIGEST_CHANNEL', 'FEEDBACK_GIST_ID', 'FEEDBACK_GH_PAT', 'FEEDBACK_FILE', 'GENERIC_WEBHOOK_URL', 'LLM_API_KEY', 'GITHUB_EVENT_NAME', 'EXTRA_NOTE', 'NPM_PACKAGE']
const RAW_LINES = ['{"t":"2026-10-07T01:00:00Z","u":"u1","m":"反馈:导出按钮点了没反应"}']

async function runDigest(opts) {
  opts = opts || {}
  const copy = copyVariant(DIGEST_SRC, opts.mut)
  const gist = { files: {} }
  const gistLines = opts.gistLines || RAW_LINES
  gist.files['group-feedback.jsonl'] = { content: gistLines.join('\n') + '\n' }
  gist.files['group-issues.json'] = { content: JSON.stringify(opts.gistState || { issues: [], updatedAt: '2026-10-07T00:00:00.000Z' }) }
  const raw0 = gist.files['group-feedback.jsonl'].content
  const ctx = { calls: [], gist: gist, opts: opts }
  const cap = []
  const savedEnv = saveEnv(DIGEST_ENV_KEYS)
  const savedArgv = process.argv
  const savedFetch = globalThis.fetch
  const savedLog = console.log, savedErr = console.error, savedWarn = console.warn
  for (const k of DIGEST_ENV_KEYS) delete process.env[k]
  process.env.REPO = 'Aik358/dsh-auto-memory'
  process.env.SINCE_HOURS = '1'
  process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
  process.env.DIGEST_CHANNEL = opts.channel || 'generic'
  process.env.GENERIC_WEBHOOK_URL = 'https://example.invalid/hook'
  process.env.FEEDBACK_GIST_ID = 'GIST1'
  process.env.FEEDBACK_GH_PAT = 'pat1'
  process.argv = ['node', 'group-digest.mjs'].concat(opts.argv || [])
  process.exitCode = 0
  globalThis.fetch = makeDigestFetch(ctx)
  console.log = (...a) => cap.push(a.join(' '))
  console.error = (...a) => cap.push(a.join(' '))
  console.warn = (...a) => cap.push(a.join(' '))
  let importError = null
  try { await import(pathToFileURL(copy.file).href) } catch (e) { importError = e }
  const exitCode = process.exitCode
  console.log = savedLog; console.error = savedErr; console.warn = savedWarn
  globalThis.fetch = savedFetch
  process.argv = savedArgv
  process.exitCode = 0
  restoreEnv(savedEnv)
  const rawNow = gist.files['group-feedback.jsonl'].content
  const patches = ctx.calls.filter((c) => c.method === 'PATCH')
  const rawPatches = patches.filter((c) => String(c.body || '').indexOf('group-feedback.jsonl') >= 0)
  const cursorPatches = patches.filter((c) => String(c.body || '').indexOf('feedbackCursor') >= 0)
  let cursorCount = null
  let writtenState = null
  try { writtenState = JSON.parse(gist.files['group-issues.json'].content) } catch (e) { writtenState = null }
  cursorCount = writtenState && writtenState.feedbackCursor ? writtenState.feedbackCursor.count : null
  return {
    copy: copy, calls: ctx.calls, patches: patches, rawPatches: rawPatches, cursorPatches: cursorPatches,
    gist: gist, raw0: raw0, rawNow: rawNow, rawUnchanged: raw0 === rawNow,
    cursorCount: cursorCount, writtenState: writtenState, cap: cap.join('\n'),
    exitCode: exitCode, importError: importError,
  }
}
// ============================ #266 / group-listener.mjs ============================
const LISTENER_ENV_KEYS = ['REPO', 'TRIGGER', 'STATE_FILE', 'QQ_APP_ID', 'QQ_APP_SECRET', 'QQ_GROUP_OPENID', 'GH_TOKEN', 'QQ_API_BASE']

/** 一个够用的 WebSocket 替身:记录实例,手动投递事件 */
function makeFakeWS(reg) {
  return class FakeWS {
    constructor(url) { this.url = url; this.sent = []; reg.push(this) }
    send(s) { this.sent.push(s) }
    close() { }
  }
}

async function runListener(opts) {
  opts = opts || {}
  const copy = copyVariant(LISTENER_SRC, opts.mut)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-d-listener-'))
  const stateFile = path.join(tmpDir, 'listener-state.json')
  if (opts.initialSeen) fs.writeFileSync(stateFile, JSON.stringify({ seen: opts.initialSeen }))
  const ctx = {
    calls: [], sockets: [], createdAtCount: 0, labelCalls: 0,
    // 形状必须与脚本内 gh() 的消费面一致:它读 r.ok 与 r.json()(不是 .body)
    createIssue: opts.createIssue || function () { return { ok: true, status: 201, json: async () => ({ number: 101 }) } },
    qqSendStatus: opts.qqSendStatus || 200,
    saveCountAtFirstCreate: null,
    stateAtFirstCreate: null,
    sigAtFirstCreate: null,
  }
  const fetchStub = async (url, init) => {
    init = init || {}
    const method = (init.method || 'GET').toUpperCase()
    const u = String(url)
    ctx.calls.push({ url: u, method: method })
    if (u.indexOf('getAppAccessToken') >= 0) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'tok-test' }) }
    }
    if (u.indexOf('/labels') >= 0) { ctx.labelCalls++; (ctx.onLabel || function () {})(); return { ok: true, status: 200, json: async () => ({}) } }
    if (u.indexOf('/issues') >= 0 && method === 'POST') {
      ctx.createdAtCount++
      if (ctx.createdAtCount === 1) {
        // ★#266 关键取样点:建单**请求发出那一刻**,状态文件里到底有没有这个 id
        try { ctx.stateAtFirstCreate = JSON.parse(fs.readFileSync(stateFile, 'utf8')).seen || [] } catch (e) { ctx.stateAtFirstCreate = [] }
      }
      return ctx.createIssue()
    }
    if (u.indexOf('/messages') >= 0) {
      return { ok: ctx.qqSendStatus >= 200 && ctx.qqSendStatus < 300, status: ctx.qqSendStatus, json: async () => ({}) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }
  const savedEnv = saveEnv(LISTENER_ENV_KEYS)
  const savedFetch = globalThis.fetch
  const savedWS = globalThis.WebSocket
  const savedLog = console.log, savedErr = console.error, savedWarn = console.warn
  const cap = []
  for (const k of LISTENER_ENV_KEYS) delete process.env[k]
  process.env.REPO = 'Aik358/dsh-auto-memory'
  process.env.STATE_FILE = stateFile
  process.env.QQ_APP_ID = '10000001'
  process.env.QQ_APP_SECRET = 'secret'
  process.env.QQ_GROUP_OPENID = 'GROUP1'
  process.env.GH_TOKEN = 'ghp_test'
  process.env.TRIGGER = '反馈,问题,bug'
  globalThis.fetch = fetchStub
  globalThis.WebSocket = makeFakeWS(ctx.sockets)
  console.log = (...a) => cap.push(a.join(' '))
  console.error = (...a) => cap.push(a.join(' '))
  console.warn = (...a) => cap.push(a.join(' '))
  let importError = null
  try { await import(pathToFileURL(copy.file).href) } catch (e) { importError = e }
  // ★必须立刻交还 console:否则本套件随后的 ok/FAIL 都会被吞进 cap,判据静默失守。
  console.log = savedLog; console.error = savedErr; console.warn = savedWarn
  // ★不投递 op=10 握手:那会注册心跳定时器并让进程一直活着;本套件只需要事件入口。
  // 因此也**不调用** ws.onclose(它会排一个 3s 后的重连定时器)。
  const ws = ctx.sockets[0]
  const push = (payload) => ws.onmessage({ data: JSON.stringify({ op: 0, t: 'GROUP_AT_MESSAGE_CREATE', d: payload }) })
  const readSeen = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')).seen || [] } catch (e) { return null } }
  return { copy: copy, ctx: ctx, ws: ws, cap: cap, push: push, readSeen: readSeen, stateFile: stateFile, importError: importError,
    restore: () => {
      // 不触发 onclose(避免排入重连);心跳定时器根本没注册(见上:未投 op=10)。
      // 替身一律换成「惰性」实现,任何迟到调用都只在本进程内静默失败,绝不出网。
      globalThis.WebSocket = class { constructor() { } send() { } close() { } }
      globalThis.fetch = async () => { throw new Error('lane-d harness: fetch 已在场景结束后停用') }
      void savedFetch; void savedWS
      restoreEnv(savedEnv)
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (e) { }
    } }
}
// ============================ 主流程 ============================
const DIGEST_SHA0 = sha256(fs.readFileSync(DIGEST_SRC))
const LISTENER_SHA0 = sha256(fs.readFileSync(LISTENER_SRC))
// #265 判定:队列(原始反馈文件)是否被这次 run 改动过
const digestWroteQueue = (r) => r.rawPatches.length > 0 || !r.rawUnchanged
// #266 判定:这次「建单失败」的 run 之后,状态文件里是否记下了该事件
const listenerSeenHas = (r, id) => Array.isArray(r.readSeen()) && r.readSeen().indexOf(id) >= 0

async function digestGreen() {
  console.log('\n=== #265 正向:未投递/打印/未配置通道 ⇒ 反馈队列必须原样保留 ===')
  for (const sc of [
    { name: '--print(只打印不投递)', channel: 'generic', argv: ['--print'] },
    { name: 'DIGEST_CHANNEL=none(未配置通道)', channel: 'none', argv: [] },
  ]) {
    const r = await runDigest({ channel: sc.channel, argv: sc.argv, sendStatus: 200 })
    eq(r.importError, null, '[' + sc.name + '] 脚本本身执行完毕(无未捕获异常)', r.importError && r.importError.message)
    ok(!digestWroteQueue(r), '[' + sc.name + '] 没有写 group-feedback.jsonl(' + r.rawPatches.length + ' 次)', JSON.stringify(r.rawPatches).slice(0, 300))
    eq(r.rawUnchanged, true, '[' + sc.name + '] 队列文件内容逐字节未变(sha 对比)')
    eq(r.cursorPatches.length, 0, '[' + sc.name + '] 没有推进消费游标')
    eq(r.cursorCount, null, '[' + sc.name + '] group-issues.json 里仍无 feedbackCursor(未确认)')
  }

  console.log('\n=== #265 负路径:注入投递失败(HTTP 503) ⇒ 队列不得被清空、游标不得推进 ===')
  {
    const r = await runDigest({ channel: 'generic', argv: [], sendStatus: 503 })
    eq(r.importError, null, '[投递失败] 脚本捕获了失败并正常收尾', r.importError && r.importError.message)
    ok(!digestWroteQueue(r), '[投递失败] ★队列未被清空/改写(' + r.rawPatches.length + ' 次 PATCH 命中队列文件)', JSON.stringify(r.rawPatches).slice(0, 300))
    eq(r.rawUnchanged, true, '[投递失败] 队列文件逐字节未变', r.rawNow && r.rawNow.slice(0, 80))
    eq(r.cursorPatches.length, 0, '[投递失败] 游标没有推进')
    eq(r.cursorCount, null, '[投递失败] 状态文件里仍无 feedbackCursor')
    eq(r.exitCode, 1, '[投递失败] process.exitCode=1(Actions 记为失败,下轮重试)')
  }

  console.log('\n=== #265 正向:投递成功后**才**推进游标(且游标可复算回当前队列) ===')
  {
    const r = await runDigest({ channel: 'generic', argv: [], sendStatus: 200 })
    eq(r.importError, null, '[投递成功] 脚本正常收尾', r.importError && r.importError.message)
    const sends = r.calls.filter((c) => c.method === 'POST' && c.url.indexOf('example.invalid') >= 0)
    eq(sends.length, 1, '[投递成功] 真的调用了投递通道一次')
    eq(r.cursorPatches.length, 1, '[投递成功] 恰好一次带 feedbackCursor 的确认 PATCH(调用点计数)')
    const ackIdx = r.calls.findIndex((c) => c.method === 'PATCH' && String(c.body || '').indexOf('feedbackCursor') >= 0)
    const sendIdx = r.calls.findIndex((c) => c.method === 'POST' && c.url.indexOf('example.invalid') >= 0)
    ok(sendIdx >= 0 && ackIdx > sendIdx, '[投递成功] ★调用序:投递(#' + sendIdx + ')在前,游标确认(#' + ackIdx + ')在后')
    eq(r.cursorCount, 1, '[投递成功] 游标 count = 本批末尾(1 条)')
    eq(r.writtenState && r.writtenState.feedbackCursor && r.writtenState.feedbackCursor.version, 2, '[投递成功] 游标带版本号(可演进)')
    ok(!digestWroteQueue(r), '[投递成功] 仍然没有清空队列(改为游标推进)', JSON.stringify(r.rawPatches).slice(0, 200))
    eq(r.rawUnchanged, true, '[投递成功] 生产者持有的队列文件保持原样(只追加语义,不再被消费者截断)')
  }

  console.log('\n=== #265 正向:已有确认游标 ⇒ 不重复投递,也不重复确认 ===')
  {
    const first = await runDigest({ channel: 'generic', argv: [], sendStatus: 200 })
    const r = await runDigest({ channel: 'generic', argv: [], sendStatus: 200, gistState: first.writtenState })
    eq(r.cursorPatches.length, 0, '[已确认] 没有新批次 ⇒ 不写游标')
    eq(r.cursorCount, 1, '[已确认] 游标保持原值(未被抹掉、未被回退)')
  }

  console.log('\n=== #265 正向:超过单批上限(120)时分批推进,一条都不能丢 ===')
  {
    const many = []
    for (let i = 1; i <= 130; i++) many.push(JSON.stringify({ t: '2026-10-07T01:00:00Z', u: 'u' + i, m: '反馈第 ' + i + ' 条' }))
    const r1 = await runDigest({ channel: 'generic', argv: [], sendStatus: 200, gistLines: many })
    eq(r1.cursorCount, 120, '[分批] 第 1 批推进到 120(单批上限),而不是「取最后 120 条」')
    eq(r1.rawUnchanged, true, '[分批] 队列文件仍未被消费者改写')
    const r2 = await runDigest({ channel: 'generic', argv: [], sendStatus: 200, gistLines: many, gistState: r1.writtenState })
    eq(r2.cursorCount, 130, '[分批] 第 2 批补齐剩余 10 条(130),无跳条')
    const r3 = await runDigest({ channel: 'generic', argv: [], sendStatus: 200, gistLines: many, gistState: r2.writtenState })
    eq(r3.cursorCount, 130, '[分批] 第 3 批无新消息 ⇒ 游标停在 130')
    eq(r3.cursorPatches.length, 0, '[分批] 第 3 批无新批次 ⇒ 不写游标')
  }

  console.log('\n=== #265 负路径:游标复算不通过(队列被生产者环形截断/篡改) ⇒ 退回 0 重发,绝不跳消息 ===')
  {
    const bad = { version: 2, count: 1, prefixHash: 'f'.repeat(64) }
    const r = await runDigest({ channel: 'generic', argv: [], sendStatus: 200, gistState: { issues: [], feedbackCursor: bad } })
    eq(r.cursorCount, 1, '[游标失配] 仍确认本批(count=1,即从 0 重发后推进到 1)')
    ok(cursorPatchCount(r) === 1, '[游标失配] 复算不通过 ⇒ 不信任旧游标,重新投递并写回新游标')
  }

  console.log('\n=== #265 负路径(变异必红):恢复旧写法「collect 内取走即 PATCH 清空/覆盖」 ⇒ 上面的判据必须变红 ===')
  {
    const mut = [[
      "        const start = feedbackQueueStart(lines, out.feedbackCursor)",
      "        const start = 0; await fetch(\u0060https://api.github.com/gists/\u0024{env.FEEDBACK_GIST_ID}\u0060, { method: 'PATCH', headers: { Accept: 'application/vnd.github+json', Authorization: \u0060Bearer \u0024{env.FEEDBACK_GH_PAT}\u0060, 'User-Agent': 'group-digest' }, body: JSON.stringify({ files: { [fname]: { content: '\\n' } } }) })",
    ]]
    const bad = await runDigest({ channel: 'none', argv: [], sendStatus: 200, mut: mut })
    eq(bad.importError, null, '[变异:旧写法] 变异副本仍可执行(证明变异有效而非语法错)', bad.importError && bad.importError.message)
    const wouldFail = digestWroteQueue(bad) || !bad.rawUnchanged
    ok(wouldFail, '[变异:旧写法] ★green 判据确实变红(' + (bad.rawPatches.length ? bad.rawPatches.length + ' 次 PATCH 命中队列' : '队列内容被改写') + ')', JSON.stringify(bad.rawPatches).slice(0, 200))
    eq(bad.cursorCount, null, '[变异:旧写法] 且旧写法根本不写游标(所以恢复旧写法还会额外触发 green 段断言)')
  }
  {
    const mut = [[
      "    await acknowledgeFeedback()",
      "    // await acknowledgeFeedback()  // 变异:确认被摘掉(旧写法:只清空、不推进游标)",
    ]]
    const bad = await runDigest({ channel: 'generic', argv: [], sendStatus: 200, mut: mut })
    eq(bad.importError, null, '[变异:确认摘除] 变异副本仍可执行', bad.importError && bad.importError.message)
    eq(bad.cursorPatches.length, 0, '[变异:确认摘除] green 段「恰好一次确认 PATCH」判据变红')
    eq(bad.cursorCount, null, '[变异:确认摘除] green 段「游标 count=1」判据变红')
  }
  {
    const mut = [[
      "      await qqSend(\u0060收到 ✅(建单通道抖了一下,管理员会人工补记)「\u0024{clip(text, 24)}」\u0060).catch(() => {})",
      "      seen.add(id); saveSeen(); await qqSend(\u0060收到 ✅(建单通道抖了一下,管理员会人工补记)「\u0024{clip(text, 24)}」\u0060).catch(() => {})  // 变异:#266 旧写法(建单失败也标记已见)",
    ]]
    const bad = await runListener({ mut: mut, createIssue: () => ({ ok: false, status: 500, json: async () => ({ message: 'injected' }) }) })
    bad.push({ id: 'M-fail-mut', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' })
    await waitFor(() => bad.ctx.createdAtCount >= 1, 3000)
    const seenIds = bad.readSeen() || []
    ok(seenIds.indexOf('M-fail-mut') >= 0, '[变异:#266 旧写法] 旧写法确实把失败事件写进了 seen(判据靶点真实存在)', JSON.stringify(seenIds))
    bad.restore()
  }
}

function cursorPatchCount(r) { return r.cursorPatches.length }

async function listenerGreen() {
  console.log('\n=== #266 正向:建单成功 ⇒ seen 落盘,且是**建单之后**才落 ===')
  {
    const r = await runListener({})
    eq(r.importError, null, '[建单成功] 监听器 import 成功', r.importError && r.importError.message)
    r.push({ id: 'M-ok-1', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' })
    await waitFor(() => r.ctx.createdAtCount >= 1, 3000)
    await waitFor(() => (r.readSeen() || []).indexOf('M-ok-1') >= 0, 3000)
    eq(r.ctx.createdAtCount, 1, '[建单成功] 真的发起了建单请求')
    eq((r.readSeen() || []).indexOf('M-ok-1') >= 0, true, '[建单成功] seen 里有该事件(已消费)')
    ok(!!r.ws, '[建单成功] 监听器已启动到建连阶段(WebSocket 实例已构造)')
    r.restore()
  }
  {
    const r = await runListener({})
    r.push({ id: 'M-hit-1', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' })
    await waitFor(() => r.ctx.createdAtCount >= 1, 3000)
    const atCreate = r.ctx.stateAtFirstCreate || []
    eq(atCreate.indexOf('M-hit-1') >= 0, false, '[建单成功] ★建单请求发出那一刻,状态文件里还没有这个 id(先建单、后持久化)')
    await waitFor(() => (r.readSeen() || []).indexOf('M-hit-1') >= 0, 3000)
    eq((r.readSeen() || []).indexOf('M-hit-1') >= 0, true, '[建单成功] 建单完成后 seen 才落盘')
    r.restore()
  }
  {
    const r = await runListener({})
    r.push({ id: 'M-ign-1', content: '今天天气不错', author: { openid: 'u2' }, timestamp: '2026-10-07T01:00:01Z' })
    await waitFor(() => (r.readSeen() || []).indexOf('M-ign-1') >= 0, 3000)
    eq(r.ctx.createdAtCount, 0, '[不命中触发词] 不建单')
    eq((r.readSeen() || []).indexOf('M-ign-1') >= 0, true, '[不命中触发词] 无需外部副作用 ⇒ 仍可记住(避免重连重复刷日志)')
    r.restore()
  }
  {
    const r = await runListener({ initialSeen: ['M-old-1'] })
    r.push({ id: 'M-old-1', content: '反馈:老事件重放', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:02Z' })
    await new Promise((res) => setTimeout(res, 200))
    eq(r.ctx.createdAtCount, 0, '[已见事件] 重放不再建单')
    r.restore()
  }

  console.log('\n=== #266 负路径:注入建单失败(HTTP 500) ⇒ seen 不得包含该事件(重放仍能处理) ===')
  {
    const r = await runListener({ createIssue: () => ({ ok: false, status: 500, json: async () => ({ message: 'injected create failure' }) }) })
    eq(r.importError, null, '[建单失败] 监听器 import 成功', r.importError && r.importError.message)
    const ev = { id: 'M-fail-1', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' }
    r.push(ev)
    await waitFor(() => r.ctx.createdAtCount >= 1, 3000)
    await new Promise((res) => setTimeout(res, 300))
    const seenAfter = r.readSeen() || []
    eq(listenerSeenHas(r, 'M-fail-1'), false, '[建单失败] ★seen 不含该事件(判据 #266)', JSON.stringify(seenAfter))
    eq(r.ctx.stateAtFirstCreate && r.ctx.stateAtFirstCreate.indexOf('M-fail-1') >= 0, false, '[建单失败] 建单那一刻状态里也没有它')
    r.restore()
  }
  console.log('\n=== #266 负路径:同一事件重放(建单仍失败)必须仍然被试处理,不被永久吞掉 ===')
  {
    const r = await runListener({ createIssue: () => ({ ok: false, status: 500, json: async () => ({ message: 'injected create failure' }) }) })
    const ev = { id: 'M-replay-1', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' }
    r.push(ev)
    await waitFor(() => r.ctx.createdAtCount >= 1, 3000)
    r.push(ev)
    await waitFor(() => r.ctx.createdAtCount >= 2, 3000)
    eq(r.ctx.createdAtCount, 2, '[重放] ★重放仍走完整流程(再建单一次);旧写法第二次会被 seen 短路')
    r.restore()
  }
  console.log('\n=== #266 负路径(变异必红):恢复旧写法「建单前即持久化 seen」 ⇒ 上面的判据必须变红 ===')
  {
    const mut = [[
      "  if (seen.has(id) || pending.has(id)) return",
      "  if (seen.has(id) || pending.has(id)) return\n  seen.add(id); saveSeen()  // 变异:#266 旧写法(建单前就持久化)",
    ]]
    const bad = await runListener({ mut: mut, createIssue: () => ({ ok: false, status: 500, json: async () => ({ message: 'injected create failure' }) }) })
    eq(bad.importError, null, '[变异:旧写法] 变异副本仍可执行', bad.importError && bad.importError.message)
    bad.push({ id: 'M-fail-mut2', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' })
    await waitFor(() => bad.ctx.createdAtCount >= 1, 3000)
    const seenIds = bad.readSeen() || []
    ok(seenIds.indexOf('M-fail-mut2') >= 0, '[变异:旧写法] ★旧写法把失败事件写进了 seen ⇒ green 段「建单失败的 seen 不含该事件」判据变红', JSON.stringify(seenIds))
    bad.restore()
  }
  {
    const mut = [[
      "    seen.add(id); saveSeen()\n    await qqSend(",
      "    await qqSend(",
    ]]
    const bad = await runListener({ mut: mut })
    eq(bad.importError, null, '[变异:成功不落盘] 变异副本仍可执行', bad.importError && bad.importError.message)
    bad.push({ id: 'M-ok-mut', content: '反馈:导出点了没反应', author: { openid: 'u1' }, timestamp: '2026-10-07T01:00:00Z' })
    await waitFor(() => bad.ctx.createdAtCount >= 1, 3000)
    await new Promise((res) => setTimeout(res, 300))
    ok((bad.readSeen() || []).indexOf('M-ok-mut') < 0, '[变异:成功不落盘] green 段「建单成功后 seen 落盘」判据变红', JSON.stringify(bad.readSeen()))
    bad.restore()
  }
  ok(sha256(fs.readFileSync(DIGEST_SRC)) === DIGEST_SHA0, '收官:被测源文件 group-digest.mjs 未被本套件改动')
  ok(sha256(fs.readFileSync(LISTENER_SRC)) === LISTENER_SHA0, '收官:被测源文件 group-listener.mjs 未被本套件改动')
}

const main = async () => {
  console.log('=== A6 / L-D:#265 群摘要反馈队列 + #266 监听器 seen 时序(真执行行为守卫)===')
  await digestGreen()
  await listenerGreen()
  console.log('\n--- A6 / L-D 专项套件 ---')
  console.log('pass=' + pass + ' fail=' + fail)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) { }
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})