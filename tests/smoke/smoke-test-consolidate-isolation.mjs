// M1 auto-consolidation concurrency and per-agent parent test.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ws = mkdtempSync(path.join(tmpdir(), 'dam-consolidate-'))
const home = path.join(ws, '.dsh-home')
mkdirSync(home, { recursive: true })
// 审查修复轮2:配置文件名必须是 _pre 版(dsh-auto-memory.json);
// 旧名 dsh-auto-memory.json 会让 loadConfig ENOENT→默认 '~'(真实 homedir) 根,沉淀写穿真实用户记忆。
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(ws, '.memory-root'),
  userMemoryDir: path.join(ws, '.user-root'),
  projectMemoryDir: '.project-memory',
  externalSources: {},
  subagentModel: 'probe-model-x', // 设置页「总结/问候默认模型」端到端回归(复审后新增功能)
}), 'utf8')
process.env.DSH_HOME = home
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
const parentCalls = []
const pathHits = []
/**
 * ★★2026-11-05 假绿审计（FAKE-GREEN-AUDIT）· 夹具修正，非产品缺陷。
 *
 * 【原缺陷】本夹具只 mock 了 `subagents.start(provider, options)`（DSH 0.1.x 旧 API）。
 *   而产线适配层 `callSubagentStartPre`（lib/index.js:2681）**先检测 `startActivation`**：
 *   `if (subagents && typeof subagents.startActivation === "function") { …走 0.2.x… }`，
 *   只有它不存在时才回落到旧 `start`。DSH 0.2.1 的 SubagentRuntime 公开方法就是
 *   `startActivation`（旧 `start` 已不存在）⇒ 产线永远走新路 ⇒ 本夹具的 `start` 从不被调用
 *   ⇒ `parentCalls` 恒 0 ⇒ 断言「expected one subagent call per top-level session, got 0」必红。
 *
 * 【修法】同时提供两个 API（**保留旧 start**，以继续覆盖 0.1.x 回落分支），
 *   并记录**实际走了哪条路**，由下面的断言证明「确实走新路」——否则本条会退化成恒真。
 */
const subagents = {
  list() { return ['spawn'] },
  // 0.2.x 正路：参数形状 { provider, label, request, signal, delivery }
  async startActivation(arg) {
    pathHits.push('startActivation')
    const req = (arg && arg.request) || {}
    const ao = req.agentOptions
    parentCalls.push({ provider: arg && arg.provider, parent: req.parent, model: ao ? ao.model : undefined, via: 'startActivation' })
    await new Promise((resolve) => setTimeout(resolve, 15))
    return {
      childId: 'child-' + parentCalls.length,
      result: Promise.resolve({ output: [{ type: 'text', text: '[TOPIC] isolated\n[LOG]\n- session-specific consolidation' }] }),
      dispose() {},
    }
  },
  // 0.1.x 回落分支：保留（产线只在没有 startActivation 时用它）
  async start(provider, options) {
    pathHits.push('start')
    parentCalls.push({ provider, parent: options.parent, model: options.agentOptions ? options.agentOptions.model : undefined, via: 'start' })
    await new Promise((resolve) => setTimeout(resolve, 15))
    return { result: Promise.resolve({ output: [{ type: 'text', text: '[TOPIC] isolated\n[LOG]\n- session-specific consolidation' }] }) }
  },
}
const registeredTools = []
const eventHandlers = new Map()
const disposers = []
const ctx = {
  get(service) { return service === 'subagents' ? subagents : undefined },
  on(name, handler) { eventHandlers.set(name, handler); return () => eventHandlers.delete(name) },
  effect(fn) { disposers.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register() { return () => {} } },
}
// ★★2026-11-05 假绿审计（FAKE-GREEN-AUDIT）· 夹具补依赖（B 类），**不是产品缺陷**。
//
// 【为什么需要这一段】子代理 spawn 前有两道依赖**宿主工作台**的门：
//   ① 工作台就绪门（lib/index.js:16710 附近）：_workbenchReady 为假即 return ''；
//   ② **E2 归属门**（lib/index.js:16768 附近）：wbOwnerOf(sid, st) 必须 === 'current'，
//      即工作台状态文件 <DSH_HOME>/memory/workbench.json 的 current.sessionId 必须等于
//      发起会话的 session id；否则 diag 'rejected: owner=orphan' 并 return ''。
//   本套件的 ctx.get() 只提供 subagents、**不提供工作台**，也没有预置 workbench.json
//   ⇒ 实测诊断原文：`subagent auto-memory-consolidate rejected: owner=orphan sid=agent-a-session`
//   ⇒ 子代理一次都不会被 spawn ⇒ parentCalls 恒 0。
//   **「got 0」的根因是夹具缺工作台归属，不是「子代理没被调用」的产品缺陷。**
//
// 【修法】预置一份合法的 workbench.json（current.sessionId = 两个 agent 的会话 id 之一），
//   并置 _workbenchReady = true。本套件测的是**并发隔离 / 父代理归属 / 同轮去重**，
//   工作台建立与归属门本身由 workbench-* 系列套件负责。
//   ⚠️ apply 与 MemoryEngine 必须来自同一个模块实例，否则 patch 挂在副本原型上无效
//   ⇒ 统一改走 tests/lib/state-engine.mjs（抽取的正是同一份产线源码）。
const { apply, MemoryEngine } = await import('../../tests/lib/state-engine.mjs')
let capturedEngine = null
{
  const proto = MemoryEngine.prototype
  const origLoadSync = proto.loadConfigSync
  proto.loadConfigSync = function (...a) { capturedEngine = this; return origLoadSync.apply(this, a) }
  try { apply(ctx, {}) } finally { proto.loadConfigSync = origLoadSync }
}
if (!capturedEngine) throw new Error('fixture: failed to capture engine instance from apply()')
// 预置工作台归属：E2 归属门只放行 owner==='current'，而 current 是**单一权威**会话。
//   本套件要两个 top-level 会话**都**能派单，所以让 current 跟随「当前发起会话」变化 ——
//   用一个极薄的桩替换 _readWorkbench：把**当前正在执行的那个会话**认作 current。
//   ★这不是放宽产品判据：归属门逻辑（wbOwnerOf / 期牌比对）原样保留，只是把
//   「从磁盘读哪个会话是 current」换成「本轮发起者即 current」，从而把测试焦点
//   收回本套件真正要测的**并发隔离 / 父代理归属 / 同轮去重**。
const WB_DIR = path.join(home, 'memory')
mkdirSync(WB_DIR, { recursive: true })
//   ★为什么不能用「一个全局变量在两个 stopping 之间切换」：consolidate 是
//     「turn-stopping + 600ms 延迟」后才调 runSubagent（见 lib/index.js:21790），
//     两次触发都在 600ms 之前完成 ⇒ 第二个赋值必然覆盖第一个，后到的调用永远读到别人的 sid。
//   ⇒ 改为**按 ALS 当前 runtime 的 agent** 判定（runSubagent 在 withAgent 内执行，
//     `this.currentRuntime().agent` 就是发起者），时序无关、并发也正确。
const _origReadWorkbench = capturedEngine._readWorkbench.bind(capturedEngine)
capturedEngine._readWorkbench = async function () {
  try {
    const raw = await _origReadWorkbench()
    const st = (raw && typeof raw === 'object') ? raw : {}
    let sid = ''
    try {
      const a = capturedEngine.currentRuntime() && capturedEngine.currentRuntime().agent
      sid = String((a && a.session && (a.session.id || (a.session.header && a.session.header.id))) || '')
    } catch (_eA) { sid = '' }
    if (!sid) sid = 'agent-a-session'
    return Object.assign({}, st, {
      version: 2, phase: 'active', previous: null,
      sessionId: sid,
      current: { sessionId: sid, openedAt: Date.now() },
    })
  } catch (_eWb) { return null }
}
capturedEngine._workbenchReady = true
capturedEngine._workbenchParent = null
capturedEngine._workbenchReason = 'test-fixture'
const makeAgent = (id, cwd) => ({
  id,
  ctx: { get: () => undefined },
  session: {
    id: id + '-session',
    header: { id: id + '-session', cwd },
    surface: { nodes: [0, 1] },
    events: [
      { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'user work for ' + id + ' with a sufficiently detailed implementation task that must be consolidated. This task involves several sub-steps, debugging failures with concrete logs, and final verification notes that should be recorded into today memory log for later reference and reuse' }] } },
      { type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'assistant result for ' + id + ' with the completed implementation details and verification summary. The fix was confirmed by tests, the root cause documented, and the follow-up actions recorded so the next session can continue without redoing the investigation' }] } } },
    ],
  },
})
const agentA = makeAgent('agent-a', path.join(ws, 'a'))
const agentB = makeAgent('agent-b', path.join(ws, 'b'))
const stopping = eventHandlers.get('agent/turn-stopping')
if (typeof stopping !== 'function') throw new Error('turn-stopping hook missing')

// 截止时间轮询(替代固定睡眠):条件满足即刻继续,只在超时后失败。
// 旧写法是硬等 setTimeout(900):一旦断言失败,事件循环被插件的三个定时器占住,整套件忙等卡死
// (插件侧已改 unref,这里同步改成有界轮询,两侧都不再依赖"睡够时间"这种猜测)。
const waitUntil = async (predicate, { timeoutMs = 8000, stepMs = 20 } = {}) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try { if (predicate()) return true } catch (e) {}
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}
// 插件的每轮沉淀并非在处理器内同步执行,而是「turn-stopping 处理器 + 600ms 延迟」后才调
// consolidateTurn;其被去重/冷却挡掉的原因会写进 diag 日志(<DSH_HOME>/dsh-auto-memory-pre-diagnose.log)。
// 「没有第 3 次调用」是否定命题,无法轮询出结论;但可以轮询到肯定信号——去重判定确实发生过。
// ★2026-11-05（FAKE-GREEN-AUDIT）：诊断日志的真实文件名是 dsh-auto-memory-diagnose.log。
//   旧夹具写的是 -pre- 变体（去 pre 改名前的历史名），文件根本不存在 ⇒ readDiagLog() 恒空
//   ⇒ 「重复 turn 的 consolidate 判定从未发生」恒红。实测该目录下只有 diagnose.log。
const diagLogPath = path.join(home, 'dsh-auto-memory-diagnose.log')
const readDiagLog = () => { try { return readFileSync(diagLogPath, 'utf8') } catch (e) { return '' } }

await Promise.all([
  stopping({ agent: agentA, turn: 1, signal: new AbortController().signal }),
  stopping({ agent: agentB, turn: 1, signal: new AbortController().signal }),
])
if (!await waitUntil(() => parentCalls.length >= 2)) {
  throw new Error('expected one subagent call per top-level session, got ' + parentCalls.length + ' (paths=' + pathHits.join(',') + ')')
}
// ★2026-11-05（FAKE-GREEN-AUDIT）：证明**走的确实是 0.2.x 新路**，而不是旧 start 回落分支。
//   否则本夹具两边都 mock 了，将来产线若退化回 `start` 也能绿 ⇒ 判据失去区分力。
if (!pathHits.every((p) => p === 'startActivation')) {
  throw new Error('production should use startActivation (0.2.x), got: ' + pathHits.join(','))
}
if (pathHits.indexOf('start') >= 0) {
  throw new Error('legacy subagents.start() must not be reached while startActivation exists')
}
if (parentCalls.some((call) => !call.parent)) throw new Error('subagent parent missing')
if (parentCalls[0].parent === parentCalls[1].parent) throw new Error('subagent parent crossed sessions')
// 设置页「总结/问候默认模型」端到端:config.subagentModel 必须透传为 agentOptions.model
if (parentCalls.some((call) => call.model !== 'probe-model-x')) throw new Error('subagentModel not passed through: ' + JSON.stringify(parentCalls.map((c) => c.model)))

// Same turn emitted twice for A must not create a second call.
const diagBefore = readDiagLog()
await stopping({ agent: agentA, turn: 1, signal: new AbortController().signal })
let dedupLine = ''
const decided = await waitUntil(() => {
  const fresh = readDiagLog().slice(diagBefore.length)
  const line = fresh.split('\n').find((l) => l.includes('consolidate skip:'))
  if (!line) return false
  dedupLine = line.trim()
  return true
})
if (!decided) throw new Error('重复 turn 的 consolidate 判定从未发生:既没执行也没被跳过(检查 600ms 延迟链)')
if (parentCalls.length !== 2) throw new Error('same-session turn was not deduplicated')

for (const dispose of disposers) { try { const teardown = dispose(); if (typeof teardown === 'function') teardown() } catch (e) {} }
rmSync(ws, { recursive: true, force: true })
console.log('M1 consolidation isolation test passed: A/B locks, parent agents, and turn deduplication are isolated (' + dedupLine + ')')
