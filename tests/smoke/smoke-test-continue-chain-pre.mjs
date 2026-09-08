#!/usr/bin/env node
/** [continue-chain] 一键接续 / 自动接续链路防回归(2026-09-08;2.2.4 扩展 G8-G12)。
 * 守卫随包发布的真实代码:lib/client.js(浏览器半边) + lib/index.js(host 半边)。
 *   G1 exports.inject 声明 remote/remote.session(06fbd10:只加 package.json dsh.client.inject 不够,
 *      client 模块自身导出的 inject 数组也必须声明,否则 ctx.remote.session 不被接线)
 *   G2 extractSessionId 对官方 create 的多种返回形态(裸字符串 / {sessionId} / {id} / {value} /
 *      {ok,value:{sessionId}})都能正确取到会话 id(f475321/6a94794)
 *   G3 接续链路收敛到共用执行器:两个入口(oneClickContinue + 自动接续 runAuto)都走 runContinueFlow,
 *      create 返回值只经 extractSessionId 提取一次(防未来重构恢复成对象直取 created.sessionId)
 *   G4 两处 session.prompt 都携带 clientTimeZone(6a94794:缺它被 host 校验拒绝 'rejected request')
 *   G5 create 参数经 continueCreateArgs,带 agentPreset(沿用旧会话预设)
 *   G6 selectModel 带 reasoningEffort(保留模型思考能力)
 *   G7 新会话 rename 为接续序号标题(接续 #N · wsBase;每站点含 zh+en 两个字面量,只数 zh)
 *   —— 2.2.4 实测修复与四条改进 ——
 *   G8 修B:模型/思考档位取自 request/header 的 data.header.config(官方投影同源),request/context 仅回退
 *   G9 修A:workspaceId 归属解析(sessionIds 命中 → 路径兜底 → '' 回退 cwd)
 *   G10 修A:create 传 {workspaceId, agentPreset},不同时传 cwd;解析不到才回退 cwd
 *   G11 ①触发:running true→false 轮次边界(取代"两轮水位持平")
 *   G12 ②确认卡三分支 + ③刷新仪式 + ④材料分层压缩
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { foldSessionLogEvents, workspaceIdForSession } from '../../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'client.js'), 'utf8')
const HSRC = readFileSync(path.resolve(HERE, '..', '..', 'lib', 'index.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.log('  FAIL -', n) } }
const count = (s, re) => (s.match(re) || []).length

// —— 真实抽取器(花括号配平,同 smoke-test-extract-chunk-flood / handoff-pre)——
function extractFn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0, end = -1
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) throw new Error('unbalanced: ' + header)
  return src.slice(start, end + 1)
}
const bodyOf = (src, header) => extractFn(src, header)

// —— G1:客户端模块自身导出声明 remote/remote.session ——
ok(SRC.includes("exports.inject = ['slots', 'sessions', 'remote', 'remote.session']"),
  'G1 exports.inject declares remote + remote.session (06fbd10)')

// —— G2:真实抽取 extractSessionId 并驱动 ——
const extractSessionId = new Function('return (' + extractFn(SRC, 'function extractSessionId(created) {') + ')')()
const cases = [
  [null, null, 'null'],
  ['sess-abc', 'sess-abc', 'bare string (官方实际形态)'],
  [{ sessionId: 's1' }, 's1', '{sessionId}'],
  [{ id: 's2' }, 's2', '{id}'],
  [{ value: 's3' }, 's3', '{value}'],
  [{ ok: true, value: { sessionId: 's4' } }, 's4', '{ok,value:{sessionId}}'],
  [{ ok: true, value: { id: 's5' } }, 's5', '{ok,value:{id}}'],
  [{ ok: true, value: { value: 's6' } }, null, '{ok,value:{value}} 不越界解析'],
  [42, null, 'number'],
]
for (const [input, expect, name] of cases) {
  ok(extractSessionId(input) === expect, 'G2 extractSessionId(' + name + ') => ' + String(expect))
}

// —— G3:接续链路收敛到共用执行器(create 返回值只经 extractSessionId 提取一次)——
ok(count(SRC, /runContinueFlow\(/g) >= 2, 'G3 both entry points (oneClickContinue + runAuto) call the shared runContinueFlow')
ok(count(SRC, /newId = extractSessionId\(created\)/g) === 1, 'G3 create result extracted once via extractSessionId (shared executor)')
ok(SRC.includes('async function runContinueFlow(') && SRC.includes('async function executeContinue('),
  'G3 shared executor present (runContinueFlow + executeContinue)')

// —— G4:两处 session.prompt 都携带 clientTimeZone ——
ok(count(SRC, /clientTimeZone: amCtzValue\(\)/g) === 2 && count(SRC, /session\.prompt\(/g) === 2,
  'G4 both session.prompt calls carry clientTimeZone (6a94794)')

// —— G5:create 参数经 continueCreateArgs,带 agentPreset ——
ok(SRC.includes('rf.session.create(continueCreateArgs(d))') && SRC.includes('agentPreset: d.agentPreset || undefined'),
  'G5 create args via continueCreateArgs with agentPreset')

// —— G6:selectModel 带 reasoningEffort(保留模型思考能力)——
ok(bodyOf(SRC, 'async function executeContinue(d, onMsg) {').includes('reasoningEffort: d.reasoningEffort || undefined'),
  'G6 selectModel passes reasoningEffort (bffe105)')

// —— G7:新会话 rename 接续序号标题(接续#N · wsBase)——
ok(bodyOf(SRC, 'async function executeContinue(d, onMsg) {').includes("'接续 #'"),
  'G7 new session renamed with numbered title 接续#N (bffe105)')

// —— G8(修B):模型/思考档位取自 request/header 的 data.header.config ——
const J = (o) => JSON.stringify(o)
const hdr = (provider, model, effort) => J({ type: 'request/header', data: { header: { config: { provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) } } } })
const folded = foldSessionLogEvents([
  J({ agentPreset: 'default', cwd: 'D:\\proj' }),
  hdr('p1', 'm1', 'max'),
  J({ type: 'request/context', data: { provider: 'p0', model: 'm0' } }),
  J({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: '用户提问' }] } } }),
  J({ type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '模型回答' }] } } }),
  J({ type: 'tool/call', data: { name: 'read', arguments: { file_path: 'a.md' } } }),
  J({ type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'tool-result', content: [{ type: 'text', text: '文件内容' }] }] } } }),
  hdr('p2', 'm2'),
])
ok(folded.provider === 'p2' && folded.model === 'm2', 'G8 request/header wins & last one wins (p2/m2), not request/context (p0/m0)')
ok(folded.reasoningEffort === '', 'G8 header without reasoningEffort => empty (不思考, 不被旧值残留)')
ok(folded.preset === 'default' && folded.cwd === 'D:\\proj', 'G8 header line still yields agentPreset/cwd')
ok(folded.msgs.some((m) => m.role === 'tool_call' && m.text.indexOf('read(') === 0) && folded.msgs.some((m) => m.role === 'tool_result'),
  'G8 tool calls/results kept as structured markers (第2层保留工具标记)')
ok(folded.msgs.filter((m) => m.role === 'user' || m.role === 'assistant').length === 2, 'G8 user/assistant messages preserved')
const legacy = foldSessionLogEvents([J({ agentPreset: 'x' }), J({ type: 'request/context', data: { provider: 'lp', model: 'lm', reasoningEffort: 'high' } })])
ok(legacy.model === 'lm' && legacy.provider === 'lp' && legacy.reasoningEffort === 'high', 'G8 legacy log (request/context only) still falls back')
ok(HSRC.includes("t === 'request/header'") && HSRC.includes("t === 'request/context'"),
  'G8 host reads request/header first, request/context only as fallback (source guard)')
ok(HSRC.includes('data.header.config') || HSRC.includes('ev.data && ev.data.header && ev.data.header.config'),
  'G8 host reads data.header.config (source guard)')
ok(HSRC.includes('msgs.slice(-20)') && HSRC.includes('m.text.slice(0, 700)'),
  'G8 第2层加量:最近 20 条 × 700 字(改进④)')

// —— G9(修A):workspaceId 归属解析 ——
const WSS = [
  { id: 'ws-a', path: 'D:\\proj-a', sessionIds: ['s1', 's2'] },
  { id: 'ws-b', path: 'D:\\proj-b', sessionIds: [] },
]
ok(workspaceIdForSession(WSS, 's2', 'D:\\other') === 'ws-a', 'G9 direct sessionIds match wins (官方 forkWorkspace 同款)')
ok(workspaceIdForSession(WSS, 's-unknown', 'D:\\proj-b\\') === 'ws-b', 'G9 path fallback (trailing slash/case tolerant)')
ok(workspaceIdForSession(WSS, 's-unknown', 'D:\\nope') === '', 'G9 no match => empty (client 回退 cwd)')
ok(workspaceIdForSession(null, 's1', 'D:\\proj-a') === '' && workspaceIdForSession(WSS, '', 'D:\\proj-a') === '', 'G9 null/no-id safe')
ok(HSRC.includes("ctx.get('workspaceRegistry')") && HSRC.includes('resolveWorkspaceIdForSession(') && HSRC.includes('workspaceId: workspaceId'),
  'G9 host resolves workspaceId via workspaceRegistry and returns it')

// —— G10(修A):create 传 {workspaceId, agentPreset},不同时传 cwd ——
const continueCreateArgs = new Function('return (' + extractFn(SRC, 'function continueCreateArgs(d) {') + ')')()
const argsWs = continueCreateArgs({ workspaceId: 'ws-x', ws: 'D:\\proj', agentPreset: 'default' })
ok(argsWs.workspaceId === 'ws-x' && argsWs.agentPreset === 'default' && argsWs.cwd === undefined,
  'G10 workspaceId branch: {workspaceId, agentPreset}, never cwd (官方同传报 bad-request)')
const argsCwd = continueCreateArgs({ workspaceId: '', ws: 'D:\\proj', agentPreset: 'default' })
ok(argsCwd.cwd === 'D:\\proj' && argsCwd.workspaceId === undefined, 'G10 fallback to cwd when workspaceId unresolved')
const argsNone = continueCreateArgs({ agentPreset: 'default' })
ok(argsNone.agentPreset === 'default' && argsNone.cwd === undefined && argsNone.workspaceId === undefined, 'G10 neither => agentPreset only')
ok(bodyOf(SRC, 'async function executeContinue(d, onMsg) {').includes('rf.session.create(continueCreateArgs(d))'),
  'G10 executor creates with continueCreateArgs(d)')

// —— G11(①):running true→false 轮次边界,弃"两轮水位持平" ——
ok(SRC.includes('function currentRunningInfo()') && SRC.includes('s.byId[sessionId]') === false || SRC.includes('snap.byId && snap.byId[id]'),
  'G11 reads authoritative running bit from sessions.list snapshot')
ok(SRC.includes('autoState.lastRunning === true && info.running === false'), 'G11 triggers on the running true→false edge')
ok(SRC.includes('setTimeout(function () { verifyEdge(edgeAt) }, 3000)'), 'G11 3s short-confirm before treating it as a turn boundary')
ok(!SRC.includes('wl.tokens === autoState.lastTokens'), 'G11 old "two polls flat tokens = idle" heuristic removed')
ok(SRC.includes('sessions.list.subscribe(observe)') && SRC.includes('setInterval(function () { observe(); maybePrompt(autoState.edgeAt) }, 20000)'),
  'G11 edge subscription + 20s fallback poll (挂机/水位后到)')

// —— G12(②③④):确认卡三分支 + 刷新仪式 + 材料分层 ——
ok(SRC.includes('autoContAgree') && SRC.includes('autoContReject') && SRC.includes('autoContTimeout'),
  'G12 confirm card has agree / reject / timeout branches')
ok(SRC.includes('autoState.rejectedEdgeAt === edgeAt') && SRC.includes('autoState.rejectedEdgeAt = edgeAt'),
  'G12 rejection recorded per boundary (同一边界不重复提示)')
ok(SRC.includes('autoState.promptVisible = true') && SRC.includes('runAuto()   // ③超时 = 挂机 → 自动接续兜底'),
  'G12 timeout auto-continues (unattended fallback)')
ok(SRC.includes('async function refreshOldSession(') && SRC.includes('async function waitForRefresh(') && SRC.includes('await refreshOldSession(onMsg)'),
  'G12 ③refresh ritual before material assembly (PLAN+ledger, fail-soft)')
ok(HSRC.includes('refreshRitualPrompt()') && HSRC.includes('autoContinueRefreshRitual === false') && HSRC.includes('refresh: this.config.autoContinueRefreshRitual'),
  'G12 host exposes refresh ritual (config-gated) via handoff-state')
for (const layer of ['【第0层 · 白板 PLAN.md(节选)】', '【第1层 · 交接账本 ', '【第2层 · 近期线程', '【第3层 · 完整转写与检索(按需)】']) {
  ok(HSRC.includes(layer), 'G12 layered material: ' + layer)
}
ok(HSRC.includes('planMtime: planMt') && HSRC.includes('(白板比账本旧——以账本为准)'), 'G12 staleness hint + planMtime for refresh detection')
ok(/autoContinueConfirmSeconds: 35/.test(HSRC) && /autoContinueRefreshRitual: true/.test(HSRC) && /autoContinueCooldownMinutes: 30/.test(HSRC),
  'G12 host config defaults (35s timeout / ritual on / 30min cooldown)')

// —— G13(①读取面):真实驱动 currentRunningInfo/runningOfSession(sessions 服务快照) ——
const makeRunningFns = new Function('sessions', extractFn(SRC, 'function currentRunningInfo() {') + '\n' + extractFn(SRC, 'function runningOfSession(sessionId) {') + '\nreturn { currentRunningInfo, runningOfSession }')
const fnsIdle = makeRunningFns({ list: { getSnapshot: () => ({ current: 's1', byId: { s1: { id: 's1', running: false }, s2: { id: 's2', running: true } } }) } })
ok(JSON.stringify(fnsIdle.currentRunningInfo()) === JSON.stringify({ sessionId: 's1', running: false }), 'G13 currentRunningInfo reads current session running bit')
ok(fnsIdle.runningOfSession('s2') === true && fnsIdle.runningOfSession('s1') === false, 'G13 runningOfSession per-session bit')
ok(fnsIdle.runningOfSession('missing') === null, 'G13 unknown session => null (不误判空闲)')
const fnsBroken = makeRunningFns(null)
ok(fnsBroken.currentRunningInfo() === null && fnsBroken.runningOfSession('s1') === null, 'G13 no sessions service => null (不抛错)')
ok(makeRunningFns({ list: { getSnapshot: () => ({ current: undefined, byId: {} }) } }).currentRunningInfo() === null,
  'G13 no current session => null (不触发接续)')

console.log('\n[smoke-test-continue-chain] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exit(1)
