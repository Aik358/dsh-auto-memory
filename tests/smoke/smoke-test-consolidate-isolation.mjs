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
const subagents = {
  list() { return ['spawn'] },
  async start(provider, options) {
    parentCalls.push({ provider, parent: options.parent, model: options.agentOptions ? options.agentOptions.model : undefined })
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
const { apply } = await import('../../lib/index.js')
apply(ctx, {})
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
// consolidateTurn;其被去重/冷却挡掉的原因会写进 diag 日志(<DSH_HOME>/dsh-auto-memory-diagnose.log)。
// 「没有第 3 次调用」是否定命题,无法轮询出结论;但可以轮询到肯定信号——去重判定确实发生过。
const diagLogPath = path.join(home, 'dsh-auto-memory-diagnose.log')
const readDiagLog = () => { try { return readFileSync(diagLogPath, 'utf8') } catch (e) { return '' } }

await Promise.all([
  stopping({ agent: agentA, turn: 1, signal: new AbortController().signal }),
  stopping({ agent: agentB, turn: 1, signal: new AbortController().signal }),
])
if (!await waitUntil(() => parentCalls.length >= 2)) {
  throw new Error('expected one subagent call per top-level session, got ' + parentCalls.length)
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
