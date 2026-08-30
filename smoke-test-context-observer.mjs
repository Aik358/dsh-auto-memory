// M2 ContextObserver smoke test(系统地图 C-01/C-02/N-01 验收门 + 2026-08-22 审查修复轮回归):
// 确定性回放 / seed+live 去重 / eventSeq 与 contextVersion 分工 / A/B 并发零串线 /
// root-nested tool call 关联 / 无 owner 不入任何 runtime(含匿名 agent-object:*) / dispose 清理 /
// 关闭时零行为差异且零 payload 留存 / 真实 ToolFailure 字段 / 原生 event.time 保留 /
// live→resume 同一 nativeSeq 的 Segment id 稳定 / seed replay 有界窗口。
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'

// 插件自带进程级 uncaughtException/unhandledRejection 兜底(生产防崩);测试必须先注册硬失败出口,
// 否则断言异常会被兜底吞掉、进程仍然 exit 0,测试失去意义。
process.on('uncaughtException', (e) => { console.error('\n[M2-TEST] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[M2-TEST] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

// P6 卫生基线: 运行前记录真实用户集中记忆目录中已有的 dam-* 条目(历史遗留);
// 结束后只断言"无新增"——既有泄漏由运维清理,不应让本测试对历史状态误报。
const realWorkspacesDir = path.join(homedir(), '.dsh', 'memory', 'workspaces')
const preExistingLeaks = (() => {
  try { return existsSync(realWorkspacesDir) ? readdirSync(realWorkspacesDir).filter((n) => n.includes('dam-')) : [] } catch (e) { return [] }
})()

let libCache
function requireLib() { if (!libCache) throw new Error('lib not primed'); return libCache }
{
  const ws0 = mkdtempSync(path.join(tmpdir(), 'dam-m2-prime-'))
  mkdirSync(path.join(ws0, '.dsh-home'), { recursive: true })
  process.env.DSH_HOME = path.join(ws0, '.dsh-home')
  libCache = await import('./lib/index.js')
}

function makeHarness(phaseLabel, configPatch) {
  const ws = mkdtempSync(path.join(tmpdir(), 'dam-m2-' + phaseLabel + '-'))
  const home = path.join(ws, '.dsh-home')
  mkdirSync(home, { recursive: true })
  // 显式覆盖集中记忆根与用户级目录到临时目录,杜绝任何写穿真实 ~/.dsh 的路径
  writeFileSync(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({
    memoryRoot: path.join(ws, '.memory-root'),
    userMemoryDir: path.join(ws, '.user-root'),
    projectMemoryDir: '.project-memory',
    externalSources: {},
    ...(configPatch || {}),
  }), 'utf8')
  process.env.DSH_HOME = home
  const { apply } = requireLib()
  const registeredTools = []
  const registeredRoutes = []
  const sections = []
  const contexts = []
  const eventHandlers = new Map()
  const effectSetups = []
  const ctx = {
    get() { return undefined },
    on(name, handler) { eventHandlers.set(name, handler); return () => eventHandlers.delete(name) },
    effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
    systemPrompt: { section(s) { sections.push(s); return () => {} }, context(c) { contexts.push(c); return () => {} } },
    tools: { register(def) { registeredTools.push(def); return () => {} } },
    webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
  }
  apply(ctx, {})
  // prime: 经由 config 路由 await engine.loadConfig(),保证 hook 触发前配置已生效(enabled 开关可靠)
  const prime = async () => {
    const route = registeredRoutes.find((r) => r.path === '/api/dsh-auto-memory-pre/config')
    let body
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/api/dsh-auto-memory-pre/config' }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
    return body.config
  }
  const settle = async () => {
    for (const setup of effectSetups) {
      try { const teardown = await setup(); if (typeof teardown === 'function') await teardown() } catch (e) {}
    }
  }
  const cleanup = () => { try { rmSync(ws, { recursive: true, force: true }) } catch (e) {} }
  return { ws, home, ctx, eventHandlers, registeredTools, registeredRoutes, contexts, prime, settle, cleanup }
}

const fire = (handlers, name, ...args) => {
  const h = handlers.get(name)
  if (typeof h !== 'function') throw new Error('handler missing: ' + name)
  return Promise.resolve(h(...args))
}
const makeAgent = (id, sessionId, cwd) => ({ id, session: { id: sessionId, header: { id: sessionId, cwd } } })

async function debugAssoc(routes) {
  let body
  const route = routes.find((r) => r.path === '/api/dsh-auto-memory-pre/debug')
  if (!route) throw new Error('debug route not registered')
  await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/api/dsh-auto-memory-pre/debug' }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
  return body.associativeMemory
}
const rowOf = async (routes, sessionId) => (await debugAssoc(routes)).runtimes.find((r) => r.sessionId === sessionId)

const userEvent = (seq, text, time, source) => ({ type: 'user/message', seq, time: time === undefined ? seq * 10 : time, data: { role: 'user', content: [{ type: 'text', text }], ...(source !== undefined ? { source } : {}) } })
const assistantEvent = (seq, turn, step, text, time) => ({ type: 'assistant/message', seq, time: time === undefined ? seq * 10 : time, data: { turn, step, message: { role: 'assistant', content: [{ type: 'text', text }] } } })
const toolCallEvent = (seq, turn, step, callId, name, args, time) => ({ type: 'tool/call', seq, time: time === undefined ? seq * 10 : time, data: { turn, step, callId, name, arguments: args } })
const toolResultEvent = (seq, turn, step, callId, text, isError, time) => ({
  type: 'tool/result', seq, time: time === undefined ? seq * 10 : time,
  data: { turn, step, message: { role: 'user', content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text }] }] }, ...(isError ? { error: { name: 'ToolError', code: 'E_TEST' } } : {}) },
})
const turnStartEvent = (seq, turn, time) => ({ type: 'turn/start', seq, time: time === undefined ? seq * 10 : time, data: { turn } })

// ---------- P1: M0-R 配置兼容(旧配置缺字段时使用默认值;白名单接受新键) ----------
{
  const h = makeHarness('cfg', {})
  try {
    if (h.registeredTools.length !== 14) throw new Error('tool count drifted: ' + h.registeredTools.length)
    if (h.registeredRoutes.length !== 33) throw new Error('route count drifted: ' + h.registeredRoutes.length)
    const cfg = await h.prime()
    // 2026-08-26 裁定:reasoningObserverEnabled/contextBridgeObserveChildSessions 默认 true
    // (开源模型为主,思维链/分支是主要观测面);其余实验开关仍默认 false
    for (const key of ['associativeMemoryEnabled', 'shadowRetrievalEnabled', 'softInjectionEnabled', 'pythonBackendEnabled', 'procedurePromotionEnabled', 'streamingInterruptionEnabled']) {
      if (cfg[key] !== false) throw new Error(key + ' default must be false, got ' + cfg[key])
    }
    if (cfg.reasoningObserverEnabled !== true) throw new Error('reasoningObserverEnabled default must be true (2026-08-26 ruling), got ' + cfg.reasoningObserverEnabled)
    if (cfg.contextBridgeObserveChildSessions !== true) throw new Error('contextBridgeObserveChildSessions default must be true (2026-08-26 ruling), got ' + cfg.contextBridgeObserveChildSessions)
    if (cfg.subagentModel !== '') throw new Error('subagentModel default must be empty string')
    if (cfg.memoryFileIndexEnabled !== false) throw new Error('memoryFileIndexEnabled default must be false')
    if (cfg.maxPacketItems !== 2 || cfg.maxPacketChars !== 800 || cfg.packetTtlSteps !== 2 || cfg.injectionCooldownSteps !== 3) {
      throw new Error('packet budget defaults drifted')
    }
    console.log('P1 config-compat ✓ (defaults off + packet budgets)')
  } finally { await h.settle(); h.cleanup() }
}

// ---------- P2: associativeMemoryEnabled=false → 零行为差异 + 零 payload 留存(方案 B) ----------
{
  const h = makeHarness('off', {})
  try {
    const agent = makeAgent('agent-off', 'session-off', h.ws)
    await fire(h.eventHandlers, 'agent/pre-step', { agent, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    const provider = h.contexts[0].text
    const before = provider({ agent })
    const session = agent.session
    fire(h.eventHandlers, 'session/event', session, userEvent(1, 'zero diff probe user message with enough text', 1724200000001))
    fire(h.eventHandlers, 'session/event', session, toolCallEvent(2, 1, 1, 'call-z', 'bash', 'echo SECRET_TOKEN=abc'))
    fire(h.eventHandlers, 'session/event', session, toolResultEvent(3, 1, 1, 'call-z', 'result containing SECRET_TOKEN=abc'))
    fire(h.eventHandlers, 'session/event', session, assistantEvent(4, 1, 1, 'done', 1724200000004))
    fire(h.eventHandlers, 'tools/result', { callId: 'call-z', name: 'bash', agent }, { isError: false, value: 'SECRET_TOKEN=abc', content: [] })
    const after = provider({ agent })
    if (before !== after) throw new Error('prompt changed while disabled')
    if (!after.includes('<memory_system>')) throw new Error('dynamic memory snapshot missing in baseline render')
    const row = await rowOf(h.registeredRoutes, 'session-off')
    if (!row) throw new Error('runtime should still register in disabled mode')
    // 方案 B 核心断言:关闭时不建立任何 ring、不保存任何 payload/segment
    if (row.envelopes !== 0 || row.segments !== 0) throw new Error('disabled mode must not store rings: ' + JSON.stringify(row))
    if (!Array.isArray(row.envelopeTail) || row.envelopeTail.length !== 0) throw new Error('envelopeTail must be empty when disabled')
    if (row.contextVersion !== 0) throw new Error('contextVersion must not advance when disabled')
    if (row.eventCursor < 5) throw new Error('minimal counters should still count observations')
    const assoc = await debugAssoc(h.registeredRoutes)
    if (assoc.observer.observationStorage !== 'counters-only') throw new Error('observationStorage contract flag wrong')
    if (!(assoc.observer.disabledObservations >= 5)) throw new Error('disabledObservations not tracked')
    console.log('P2 disabled-zero-diff ✓ (prompt stable, rings empty, payloads zero-retained, storage=counters-only)')
  } finally { await h.settle(); h.cleanup() }
}

// ---------- P3: 行为主实例(启用观察器;seed/live、双游标、A/B 强隔离、nested、no-owner、dispose) ----------
const ENABLED = { associativeMemoryEnabled: true }
{
  const h = makeHarness('main', ENABLED)
  try {
    await h.prime()
    const wsA = path.join(h.ws, 'ws-a')
    const wsB = path.join(h.ws, 'ws-b')
    const agentA = makeAgent('agent-a', 'session-a', wsA)
    const agentB = makeAgent('agent-b', 'session-b', wsB)

    agentA.session.events = [
      userEvent(1, 'seeded user requirement about implementing feature X with detailed acceptance criteria'),
      toolCallEvent(2, 1, 1, 'seed-call', 'read', 'notes.md'),
      toolResultEvent(3, 1, 1, 'seed-call', 'file contents here'),
    ]
    await fire(h.eventHandlers, 'agent/session-start', { agent: agentA, source: 'resume' })
    let dbgA = await rowOf(h.registeredRoutes, 'session-a')
    if (!dbgA) throw new Error('runtime A missing after session-start')
    if (dbgA.eventCursor !== 4) throw new Error('seed replay cursor wrong: ' + dbgA.eventCursor)
    if (dbgA.contextVersion !== 3) throw new Error('contextVersion should count only segments: ' + dbgA.contextVersion)
    if (dbgA.nativeCursor !== 3) throw new Error('nativeCursor after seed wrong: ' + dbgA.nativeCursor)

    fire(h.eventHandlers, 'session/event', agentA.session, toolCallEvent(2, 1, 1, 'seed-call', 'read', 'notes.md'))
    fire(h.eventHandlers, 'session/event', agentA.session, userEvent(1, 'seeded user requirement about implementing feature X with detailed acceptance criteria'))
    fire(h.eventHandlers, 'session/event', agentA.session, toolResultEvent(4, 1, 1, 'seed-call', 'duplicate result suppressed by cursor'))
    fire(h.eventHandlers, 'session/event', agentA.session, assistantEvent(5, 1, 2, 'final answer for seeded task'))
    dbgA = await rowOf(h.registeredRoutes, 'session-a')
    if (dbgA.eventCursor !== 6) throw new Error('live dedup cursor wrong: ' + dbgA.eventCursor)
    if (dbgA.contextVersion !== 5) throw new Error('contextVersion after live wrong: ' + dbgA.contextVersion)
    if (dbgA.nativeCursor !== 5) throw new Error('nativeCursor after live wrong: ' + dbgA.nativeCursor)
    console.log('P3a seed/live dedup ✓ (cursor 4→6, contextVersion 3→5, nativeCursor=5)')

    const cursorBefore = dbgA.eventCursor, versionBefore = dbgA.contextVersion
    await fire(h.eventHandlers, 'agent/pre-step', { agent: agentA, turn: 2, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    fire(h.eventHandlers, 'session/event', agentA.session, turnStartEvent(6, 2))
    const dbgA2 = await rowOf(h.registeredRoutes, 'session-a')
    if (dbgA2.eventCursor !== cursorBefore + 2) throw new Error('lifecycle envelopes must advance eventSeq')
    if (dbgA2.contextVersion !== versionBefore) throw new Error('lifecycle events must NOT advance contextVersion')
    if (dbgA2.lastEventSeq !== dbgA2.eventCursor) throw new Error('debug lastEventSeq out of sync')
    console.log('P3b eventSeq/contextVersion division ✓')

    await fire(h.eventHandlers, 'agent/session-start', { agent: agentB, source: 'fresh' })
    fire(h.eventHandlers, 'session/event', agentB.session, userEvent(1, 'workspace B private task about quantum calibration', 1724210000001))
    fire(h.eventHandlers, 'session/event', agentB.session, assistantEvent(2, 1, 1, 'B-only conclusion', 1724210000002))
    const rowA = await rowOf(h.registeredRoutes, 'session-a')
    const rowB = await rowOf(h.registeredRoutes, 'session-b')
    if (!rowA || !rowB) throw new Error('A/B runtime rows missing')
    if (rowB.eventCursor !== 3 || rowB.nativeCursor !== 2) throw new Error('B counters polluted')
    if (rowA.nativeCursor !== 6 || rowB.nativeCursor !== 2) throw new Error('native cursors crossed sessions')
    // 强隔离断言(审查意见):内容级 digest 集合零交集
    const digestsA = new Set(rowA.segmentTail.map((s) => s.digest).concat(rowA.envelopeTail.map((e) => e.payloadDigest)))
    const digestsB = new Set(rowB.segmentTail.map((s) => s.digest).concat(rowB.envelopeTail.map((e) => e.payloadDigest)))
    for (const d of digestsB) if (digestsA.has(d)) throw new Error('cross-session digest collision detected')
    console.log('P3c A/B concurrency isolation ✓ (counters + digest sets disjoint)')

    fire(h.eventHandlers, 'session/event', agentA.session, toolCallEvent(7, 2, 1, 'root-call', 'bash', 'run build'))
    fire(h.eventHandlers, 'tools/result', { callId: 'nested-call', rootCallId: 'root-call', name: 'str_replace_editor', agent: agentA }, { isError: false, value: { ok: true }, content: [] })
    fire(h.eventHandlers, 'session/event', agentA.session, toolResultEvent(8, 2, 1, 'nested-call', 'nested persisted result'))
    const dbgNested = await rowOf(h.registeredRoutes, 'session-a')
    const frozenEnv = dbgNested.envelopeTail.find((e) => e.channel === 'tools' && e.callId === 'nested-call')
    if (!frozenEnv || frozenEnv.rootCallId !== 'root-call') throw new Error('frozen envelope root linkage broken')
    const persistedNested = dbgNested.envelopeTail.find((e) => e.channel === 'session' && e.callId === 'nested-call' && e.eventType === 'tool/result')
    if (!persistedNested) throw new Error('persisted nested envelope missing')
    if (persistedNested.payloadDigest === frozenEnv.payloadDigest) throw new Error('channels must keep distinct payloads/digests')
    console.log('P3d root/nested correlation ✓')

    const beforeNoOwner = await debugAssoc(h.registeredRoutes)
    const defBefore = beforeNoOwner.runtimes.find((r) => r.key === 'default')
    const runtimeCountBefore = beforeNoOwner.runtimes.length
    fire(h.eventHandlers, 'session/event', { id: 'ghost-session' }, userEvent(1, 'orphan event with no runtime'))
    fire(h.eventHandlers, 'session/event', undefined, userEvent(2, 'no session at all'))
    fire(h.eventHandlers, 'tools/result', { callId: 'x', name: 'bash' }, { isError: false, value: 1, content: [] })
    fire(h.eventHandlers, 'tools/result', { callId: 'y', name: 'bash', agent: { /* no identity */ } }, { isError: false, value: 1, content: [] })
    // 仅 agent.id、无 session 身份:同样不得成立(审查修复轮要求 sessionId 必需)
    fire(h.eventHandlers, 'tools/result', { callId: 'z', name: 'bash', agent: { id: 'only-agent-id' } }, { isError: false, value: 1, content: [] })
    const afterNoOwner = await debugAssoc(h.registeredRoutes)
    const defAfter = afterNoOwner.runtimes.find((r) => r.key === 'default')
    if ((defAfter ? defAfter.eventCursor : 0) !== (defBefore ? defBefore.eventCursor : 0)) throw new Error('ownerless event leaked into default runtime')
    if (!(afterNoOwner.observer.droppedNoOwner >= 4)) throw new Error('droppedNoOwner not tracked: ' + JSON.stringify(afterNoOwner.observer))
    const anonRuntime = afterNoOwner.runtimes.find((r) => r.key.startsWith('agent-object:') || (r.key !== 'default' && !r.sessionId))
    if (anonRuntime) throw new Error('anonymous runtime created by ownerless event: ' + anonRuntime.key)
    if (afterNoOwner.runtimes.length !== runtimeCountBefore) throw new Error('ownerless events changed runtime population')
    console.log('P3e no-owner exclusion ✓ (no default leak, no anonymous runtime, droppedNoOwner=' + afterNoOwner.observer.droppedNoOwner + ')')

    fire(h.eventHandlers, 'agent/pre-step', { agent: agentB, turn: 3, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    const disposedHandler = h.eventHandlers.get('agent/disposed')
    disposedHandler({ agent: agentB })
    const postDispose = await rowOf(h.registeredRoutes, 'session-b')
    if (postDispose) throw new Error('runtime B survived dispose')
    const agentB2 = makeAgent('agent-b2', 'session-b', wsB)
    await fire(h.eventHandlers, 'agent/pre-step', { agent: agentB2, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    const reborn = await rowOf(h.registeredRoutes, 'session-b')
    if (!reborn || reborn.eventCursor !== 1 || reborn.envelopes > 2 || reborn.nativeCursor !== 0) throw new Error('reborn runtime not fresh')
    disposedHandler({ agent: agentA })
    const statusTool = h.registeredTools.find((t) => t.name === 'memory_status_pre')
    const st = await statusTool.execute({}, { agent: agentB2 })
    if (String(st).includes('workspace-a')) throw new Error('dispose cross-talk detected')
    console.log('P3f dispose cleanup ✓')

    // ---------- P4: 相同事件流确定性回放(两独立引擎,envelope 全字段含原生 timestamp) ----------
    const streamFor = () => [
      ['s', userEvent(1, 'identical replay probe with a fairly descriptive task sentence', 1724200001001)],
      ['s', toolCallEvent(2, 1, 1, 'rc', 'bash', 'ls -la', 1724200001002)],
      ['t', { callId: 'rc', name: 'bash' }],
      ['s', toolResultEvent(3, 1, 1, 'rc', 'replay result payload', false, 1724200001003)],
      ['s', assistantEvent(4, 1, 2, 'replay final visible output', 1724200001004)],
      ['s', turnStartEvent(5, 2, 1724200001005)],
    ]
    const runReplay = async (label) => {
      const hh = makeHarness('replay-' + label, ENABLED)
      try {
        await hh.prime()
        const ag = makeAgent('ag-' + label, 'session-replay', path.join(hh.ws, 'ws'))
        ag.session.events = []
        await fire(hh.eventHandlers, 'agent/session-start', { agent: ag, source: 'fresh' })
        for (const [kind, ev] of streamFor()) {
          if (kind === 's') fire(hh.eventHandlers, 'session/event', ag.session, ev)
          else fire(hh.eventHandlers, 'tools/result', { ...ev, agent: ag }, { isError: false, value: 'ok', content: [] })
        }
        await new Promise((r) => setTimeout(r, 20))
        const d = await rowOf(hh.registeredRoutes, 'session-replay')
        return {
          counters: { eventCursor: d.eventCursor, contextVersion: d.contextVersion, envelopes: d.envelopes, segments: d.segments, nativeCursor: d.nativeCursor },
          // session 通道的 timestamp 是原生事实时间(必须跨引擎一致);
          // tools/lifecycle 无原生时间,timestamp 为采集时间,属预期差异,不参与确定性比较
          envelopeTail: d.envelopeTail.map(({ eventSeq, channel, eventType, nativeSeq, sourceKind, payloadDigest, timestamp }) => ({ eventSeq, channel, eventType, nativeSeq, sourceKind, payloadDigest, timestamp: channel === 'session' ? timestamp : null })),
          segmentTail: d.segmentTail,
        }
      } finally { await hh.settle(); hh.cleanup() }
    }
    const ra = await runReplay('ra')
    const rb = await runReplay('rb')
    if (JSON.stringify(ra) !== JSON.stringify(rb)) throw new Error('non-deterministic replay')
    if (ra.counters.envelopes !== 7 || ra.counters.segments !== 4) throw new Error('replay counts unexpected: ' + JSON.stringify(ra.counters))
    // 原生事实时间断言只针对 session 通道(tools/lifecycle 为采集时间,已置 null 不参与比较)
    const sessionEnvs = ra.envelopeTail.filter((e) => e.channel === 'session')
    if (!sessionEnvs.length || !sessionEnvs.every((e) => Number.isFinite(e.timestamp) && e.timestamp > 1700000000000)) throw new Error('native timestamps missing in tail')
    console.log('P4 deterministic replay ✓ (ids/order/digests/native-timestamps identical across engines)')

    // ---------- P5: 审查修复轮回归 ----------
    // P5a 真实 DSH ToolFailure 形状:{ message, info:{ name, code } }
    fire(h.eventHandlers, 'tools/result', { callId: 'real-fail', name: 'bash', agent: agentB2 }, { isError: true, error: { message: 'command failed with exit code 1', info: { name: 'ToolError', code: 'E_REAL' } }, content: [] })
    const p5a = (await rowOf(h.registeredRoutes, 'session-b')).envelopeTail.find((e) => e.channel === 'tools' && e.callId === 'real-fail')
    if (!p5a || p5a.ok !== false || p5a.errorName !== 'ToolError' || p5a.errorCode !== 'E_REAL') throw new Error('real failure shape not captured: ' + JSON.stringify(p5a))
    console.log('P5a real ToolFailure fields ✓ (error.message/info.name/info.code)')

    // P5b 原生 event.time 保留为 envelope.timestamp
    fire(h.eventHandlers, 'session/event', agentB2.session, userEvent(10, 'native time probe', 1724200099999))
    const p5b = (await rowOf(h.registeredRoutes, 'session-b')).envelopeTail.find((e) => e.channel === 'session' && e.nativeSeq === 10)
    if (!p5b || p5b.timestamp !== 1724200099999) throw new Error('native time not preserved: ' + JSON.stringify(p5b))
    console.log('P5b native event.time preserved ✓ (timestamp=1724200099999)')

    // P5c live → dispose → resume:同一 nativeSeq 的 Segment id/digest/顺序稳定
    const resumeSession = 'session-resume-stab'
    const liveAgent = makeAgent('live-agent', resumeSession, path.join(h.ws, 'ws-r'))
    await fire(h.eventHandlers, 'agent/pre-step', { agent: liveAgent, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    fire(h.eventHandlers, 'session/event', liveAgent.session, userEvent(101, 'stability probe user task one with enough words', 1724200020101))
    fire(h.eventHandlers, 'session/event', liveAgent.session, toolCallEvent(102, 1, 1, 'sc', 'read', 'x.md', 1724200020102))
    fire(h.eventHandlers, 'session/event', liveAgent.session, toolResultEvent(103, 1, 1, 'sc', 'stable content', false, 1724200020103))
    fire(h.eventHandlers, 'session/event', liveAgent.session, assistantEvent(104, 1, 1, 'stable answer', 1724200020104))
    const liveRow = await rowOf(h.registeredRoutes, resumeSession)
    const liveSegs = liveRow.segmentTail.slice(-4).map((s) => ({ id: s.id, digest: s.digest }))
    if (liveSegs.length !== 4) throw new Error('live stability setup wrong: ' + liveSegs.length)
    disposedHandler({ agent: liveAgent })
    const resumeAgent = makeAgent('resume-agent', resumeSession, path.join(h.ws, 'ws-r'))
    resumeAgent.session.events = [
      userEvent(101, 'stability probe user task one with enough words', 1724200020101),
      toolCallEvent(102, 1, 1, 'sc', 'read', 'x.md', 1724200020102),
      toolResultEvent(103, 1, 1, 'sc', 'stable content', false, 1724200020103),
      assistantEvent(104, 1, 1, 'stable answer', 1724200020104),
    ]
    await fire(h.eventHandlers, 'agent/session-start', { agent: resumeAgent, source: 'resume' })
    const resumeRow = await rowOf(h.registeredRoutes, resumeSession)
    const resumeSegs = resumeRow.segmentTail.slice(-4).map((s) => ({ id: s.id, digest: s.digest }))
    if (JSON.stringify(liveSegs) !== JSON.stringify(resumeSegs)) {
      throw new Error('live/resume segment identity unstable:\nlive=' + JSON.stringify(liveSegs) + '\nresume=' + JSON.stringify(resumeSegs))
    }
    console.log('P5c live/resume segment identity ✓ (same nativeSeq → same id+digest+order)')

    // P5d 长会话 seed 上限:700 条种子只回放尾部窗口
    const capAgent = makeAgent('cap-agent', 'session-cap', path.join(h.ws, 'ws-cap'))
    capAgent.session.events = Array.from({ length: 700 }, (_, i) => userEvent(i + 1, 'bulk seeded event number ' + i + ' padding text', 1724200030000 + i))
    await fire(h.eventHandlers, 'agent/session-start', { agent: capAgent, source: 'resume' })
    const capRow = await rowOf(h.registeredRoutes, 'session-cap')
    if (!capRow) throw new Error('cap runtime missing')
    if (capRow.envelopes > 512 + 1) throw new Error('seed window exceeded bound: ' + capRow.envelopes)
    if (capRow.nativeCursor !== 700) throw new Error('tail window should consume up to last seq, got ' + capRow.nativeCursor)
    const assocCap = await debugAssoc(h.registeredRoutes)
    if (assocCap.observer.seedTruncatedEvents < 188) throw new Error('truncation counter wrong: ' + JSON.stringify(assocCap.observer))
    console.log('P5d bounded seed replay ✓ (700→tail window ≤512, truncated=' + assocCap.observer.seedTruncatedEvents + ')')

    // P5e 匿名生命周期(复审轮2;复审轮3强化时序):session-start / pre-step / turn-stopping 对
    // 无 session 身份的 agent 不得创建任何 runtime,也不得把匿名 cwd 写进 default runtime state。
    // 必须等待 >600ms(turn-stopping 的延迟 consolidation 窗口)后再断言,否则假绿。
    const beforeAnon = await debugAssoc(h.registeredRoutes)
    const anonCountBefore = beforeAnon.runtimes.length
    const defRowAnon0 = beforeAnon.runtimes.find((r) => r.key === 'default')
    const defWsBefore = defRowAnon0 ? defRowAnon0.ws : undefined
    const anonAgent = { id: 'anon-only', session: { header: { cwd: path.join(h.ws, 'anon-cwd') } } } // 有 session 对象但无身份
    await fire(h.eventHandlers, 'agent/session-start', { agent: anonAgent, source: 'fresh' })
    await fire(h.eventHandlers, 'agent/pre-step', { agent: anonAgent, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
    await fire(h.eventHandlers, 'agent/turn-stopping', { agent: anonAgent, turn: 1 })
    await new Promise((r) => setTimeout(r, 800)) // 越过 600ms 延迟 consolidation 窗口
    const afterAnon = await debugAssoc(h.registeredRoutes)
    if (afterAnon.runtimes.length !== anonCountBefore) throw new Error('anonymous lifecycle created runtimes (delayed): ' + JSON.stringify(afterAnon.runtimes.map((r) => r.key)))
    const badKey = afterAnon.runtimes.find((r) => r.key.startsWith('agent-object:') || (r.key.startsWith('agent:') && !r.sessionId))
    if (badKey) throw new Error('anonymous runtime key present: ' + badKey.key)
    const defRowAnon1 = afterAnon.runtimes.find((r) => r.key === 'default')
    if ((defRowAnon1 ? defRowAnon1.ws : undefined) !== defWsBefore) throw new Error('default runtime ws polluted by anonymous cwd: ' + JSON.stringify({ before: defWsBefore, after: defRowAnon1 && defRowAnon1.ws }))
    console.log('P5e anonymous lifecycle exclusion ✓ (delayed window included; default.ws unchanged; no anon runtimes)')

    // P5f 配置切换清理(复审轮2):full → counters-only 必须清零既有观察数据;重新启用后从切换点重新开始
    const hp = makeHarness('purge', ENABLED)
    try {
      await hp.prime()
      const pa = makeAgent('purge-agent', 'session-purge', path.join(hp.ws, 'ws'))
      await fire(hp.eventHandlers, 'agent/session-start', { agent: pa, source: 'fresh' })
      fire(hp.eventHandlers, 'session/event', pa.session, userEvent(1, 'pre-disable sensitive payload probe text', 1724200040001))
      fire(hp.eventHandlers, 'session/event', pa.session, assistantEvent(2, 1, 1, 'pre disable answer', 1724200040002))
      let prow = await rowOf(hp.registeredRoutes, 'session-purge')
      if (!(prow.envelopes >= 3 && prow.segments >= 2 && prow.contextVersion >= 2)) throw new Error('purge setup wrong: ' + JSON.stringify(prow))
      const configRoute = hp.registeredRoutes.find((r) => r.path === '/api/dsh-auto-memory-pre/config')
      let lastBody
      const res = { writeHead() {}, end(b) { lastBody = JSON.parse(b) } }
      await configRoute.handler({
        socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
        method: 'POST', url: '/api/dsh-auto-memory-pre/config',
        [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ associativeMemoryEnabled: false })) })() },
      }, res)
      if (lastBody.config.associativeMemoryEnabled !== false) throw new Error('disable POST failed')
      fire(hp.eventHandlers, 'session/event', pa.session, userEvent(3, 'post-disable event must not be stored anywhere', 1724200040003))
      prow = await rowOf(hp.registeredRoutes, 'session-purge')
      if (prow.envelopes !== 0 || prow.segments !== 0 || prow.contextVersion !== 0) throw new Error('disable did not purge storage: ' + JSON.stringify(prow))
      if ((await debugAssoc(hp.registeredRoutes)).observer.observationStorage !== 'counters-only') throw new Error('storage flag not counters-only after switch')
      await configRoute.handler({
        socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' },
        method: 'POST', url: '/api/dsh-auto-memory-pre/config',
        [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify({ associativeMemoryEnabled: true })) })() },
      }, res)
      if ((await debugAssoc(hp.registeredRoutes)).observer.observationStorage !== 'full') throw new Error('storage flag not full after re-enable')
      fire(hp.eventHandlers, 'session/event', pa.session, userEvent(4, 'post-enable fresh observation', 1724200040004))
      prow = await rowOf(hp.registeredRoutes, 'session-purge')
      if (prow.envelopes < 1 || !prow.envelopeTail.some((x) => x.nativeSeq === 4)) throw new Error('re-enabled observation broken')
      if (prow.envelopeTail.some((x) => x.nativeSeq === 1 || x.nativeSeq === 2)) throw new Error('pre-disable payloads resurrected')
      console.log('P5f config-switch purge ✓ (true→false zeroed, false→true fresh start, no resurrection)')
    } finally { await hp.settle(); hp.cleanup() }
  } finally { await h.settle(); h.cleanup() }
}

// ---------- P6: 反思类测试卫生——真实用户集中记忆目录不被本测试工作区污染 ----------
{
  if (existsSync(realWorkspacesDir)) {
    const now = readdirSync(realWorkspacesDir).filter((n) => n.includes('dam-'))
    const fresh = now.filter((n) => !preExistingLeaks.includes(n))
    if (fresh.length) throw new Error('test workspaces leaked into real user memory this run: ' + fresh.join(', '))
  }
  console.log('P6 real-user-memory hygiene ✓ (no new dam-* leakage; pre-existing=' + preExistingLeaks.length + ')')
}

console.log('\n✅ M2 ContextObserver smoke test passed (incl. review-round regressions)')
