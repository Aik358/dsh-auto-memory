#!/usr/bin/env node
/** [continue-host] 接续 host 半边真机回归(2026-09-08,2.2.4 修A/修B + 四条改进)。
 * 用真 apply(ctx) + 真实临时 DSH_HOME/session.jsonl 驱动真实 engine,验证:
 *   H1 handoff-state 暴露 planMtime 与 refresh{sessionId,prompt}(③刷新仪式入口)
 *   H2 修A:buildContinueCarry 经 workspaceRegistry 解析旧会话 workspaceId 并返回(官方 create 只有 workspaceId 才 attachSession)
 *   H3 修B:provider/model/reasoningEffort 取自 request/header 的 data.header.config(取最后一条)
 *   H4 ④分层材料:第0/1/2/3 层齐全;第2层=最近 20 条 × 700 字,保留角色+工具标记
 *   H5 旧会话转写文件落盘且含工具标记(第3层按需 read)
 *   H6 接续序号 contSeq / wsBase / agentPreset
 *   H7 白板比账本旧 → 过期提示
 *   H8 归属解析不到 → workspaceId=''(client 回退 cwd)
 *   H9 无 workspaceRegistry 服务 → 不抛错、workspaceId=''
 */
import { apply } from '../../lib/index.js'
import { continuedSourceFile, releaseContinuedSource } from '../../lib/continuation-state.js'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
process.on('uncaughtException', (e) => { console.error('\n[continue-host] FATAL uncaughtException:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('\n[continue-host] FATAL unhandledRejection:', (r && (r.stack || r.message)) || r); process.exit(1) })

let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok -', n) } else { fail++; console.error('  FAIL -', n) } }

const root = mkdtempSync(path.join(tmpdir(), 'dam-continue-host-'))
const home = path.join(root, '.dsh-home')
mkdirSync(home, { recursive: true })
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(root, '.memory-root'),
  userMemoryDir: path.join(root, '.user-root'),
  projectMemoryDir: '.project-memory',
  handoffEnabled: true,
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home

const WS_PATH = 'D:\\dam-continue-proj'
const SID = 'session-continue-live-0001'
const sidDir = path.join(home, 'sessions', 'wsA', SID)
mkdirSync(sidDir, { recursive: true })
const MODEL = 'deepseek-v4.1-flash-expires-on-0910'
const lines = [JSON.stringify({ agentPreset: 'default', cwd: WS_PATH })]
lines.push(JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: 'stale-model', reasoningEffort: 'low' } } } }))
for (let i = 0; i < 24; i++) {
  lines.push(JSON.stringify({ type: i % 2 === 0 ? 'user/message' : 'assistant/message', data: { message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: (i % 2 === 0 ? '用户第' : '模型第') + i + '条:分层压缩需要保留结构与角色标记。' }] } } }))
}
lines.push(JSON.stringify({ type: 'tool/call', data: { name: 'read', arguments: { file_path: 'lib/index.js' } } }))
lines.push(JSON.stringify({ type: 'tool/result', data: { message: { role: 'tool', content: [{ type: 'tool-result', content: [{ type: 'text', text: '工具结果:文件已读取' }] }] } } }))
lines.push(JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: MODEL, reasoningEffort: 'max' } } } }))
writeFileSync(path.join(sidDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8')

const controllerHolder = { sc: undefined }
const registryHolder = { reg: { list: () => [{ id: 'ws-continue-1', path: WS_PATH, sessionIds: [SID] }] } }
const routes = []
const handlers = {}
const effects = []
const ctx = {
  get(name) { return name === 'workspaceRegistry' ? registryHolder.reg : name === 'sessionController' ? controllerHolder.sc : undefined },
  on(ev, fn) { handlers[ev] = fn; return () => {} },
  effect(fn) { effects.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})

const API = {
  config: '/api/dsh-auto-memory/config',
  state: '/api/dsh-auto-memory/handoff-state',
  cont: '/api/dsh-auto-memory/handoff-continue',
}
const call = async (p, method, bodyObj) => {
  let body = null
  const route = routes.find((r) => r.path === p)
  if (!route) throw new Error('route not registered: ' + p)
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: p }
  // H10(2026-09-28):需要喂 fromSessionId —— readJsonBody 走 `for await (const chunk of req)`,
  // 故用异步可迭代对象模拟请求体;不传 bodyObj 时保持原形态(readJsonBody 拒绝非迭代 → {})。
  if (bodyObj !== undefined) req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(bodyObj)) }
  await route.handler(req, { writeHead() {}, end(b) { body = JSON.parse(b) } })
  return body
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('[continue-host] H1 配置与刷新仪式入口')
await call(API.config, 'GET')   // 先加载配置(隔离路径),避免 '~' 竞态
handlers['agent/session-start']({ agent: { session: { id: SID, header: { cwd: WS_PATH } } }, source: 'test' })
await sleep(600)
const st0 = await call(API.state, 'GET')
ok(st0 && st0.enabled === true, 'H1 handoff-state enabled')
ok('planMtime' in st0, 'H1 planMtime exposed for refresh detection')
ok(st0.refresh && st0.refresh.sessionId === SID, 'H1 refresh.sessionId = 旧会话 id')
ok(!!(st0.refresh && /刷新仪式/.test(st0.refresh.prompt) && /memory_note\(kind=plan/.test(st0.refresh.prompt) && /memory_note\(kind=handoff/.test(st0.refresh.prompt)),
  'H1 refresh.prompt 要求旧 Agent 刷 PLAN + 账本')

// 写入白板与账本(白板 mtime 故意早于账本 → 过期提示)
const handoffDir = path.dirname(st0.planPath)
mkdirSync(handoffDir, { recursive: true })
const planPath = st0.planPath
const ledgerPath = path.join(handoffDir, 'handoff-20260908-190000.md')
writeFileSync(planPath, '# 白板\n## 当前目标\n- 验证接续链路(第0层)\n', 'utf8')
writeFileSync(ledgerPath, '# 交接账本\n## 任务状态\n- 已修两处根因\n## 目标\n- 继续四条改进\n## 已试方案与失败原因\n- create({cwd})→未分组\n## 进度与下一步\n- node tests/smoke/smoke-test-continue-host-pre.mjs\n', 'utf8')
const old = new Date(Date.now() - 3600 * 1000)
utimesSync(planPath, old, old)

console.log('[continue-host] H2/H3/H4/H5/H6/H7 接续材料')
const st1 = await call(API.state, 'GET')
ok(Number(st1.planMtime) > 0, 'H1 写盘后 planMtime > 0(刷新仪式用它判断材料是否更新)')
const r = await call(API.cont, 'POST')
ok(r && r.ok === true, 'H2 handoff-continue ok')
ok(r.workspaceId === 'ws-continue-1', 'H2 修A: workspaceId 由 registry.sessionIds 命中返回(' + String(r.workspaceId) + ')')
ok(r.provider === 'deepseek-official' && r.model === MODEL && r.reasoningEffort === 'max',
  'H3 修B: request/header 末条 config 生效(' + r.model + '/' + r.reasoningEffort + ')')
ok(r.carryText.includes('【第0层 · 白板 PLAN.md(节选)】') && r.carryText.includes('【第1层 · 交接账本 '),
  'H4 第0层白板 + 第1层账本')
ok(r.carryText.includes('【第2层 · 近期线程') && r.carryText.includes('【第3层 · 完整转写与检索(按需)】'),
  'H4 第2层近期线程 + 第3层按需转写')
const layer2 = r.carryText.split('【第2层 · 近期线程')[1].split('【第3层')[0]
ok((layer2.match(/\n---\n/g) || []).length === 19, 'H4 第2层 = 最近 20 条(19 个分隔符),共 ' + String(r.msgCount) + ' 条')
ok(layer2.includes('tool_call: read(') && layer2.includes('tool_result: 工具结果'), 'H4 第2层保留工具标记')
ok(r.carryText.includes('(白板比账本旧——以账本为准)'), 'H7 过期提示(白板早于账本)')
ok(!!r.transcriptPath && existsSync(r.transcriptPath), 'H5 旧会话转写文件落盘')
const tr = readFileSync(r.transcriptPath, 'utf8')
// ★L3.6(2026-09-17): 转写**瘦身**后只留用户输入与助手最终输出, 工具事件压成一行计数 ⇒
//   "转写含工具标记"这条旧判据已**随设计作废**(实测工具事件是正文的 3 倍以上)。
//   新判据: ①正文消息在 ②如实自述省略了多少工具事件 ③工具标记**不得**再进转写正文
//   (注意: 第2层"近期线程"仍保留工具标记, 见上方 H4 —— 两者分层不同, 不是矛盾)。
ok(tr.includes('模型第23条'), 'H5 转写含正文消息')
ok(/省略了 \d+ 次工具调用与 \d+ 条工具结果/.test(tr), 'H5 转写如实自述省略了多少工具事件')
ok(!tr.includes('tool_call**: read(') && !tr.includes('tool_result**: 工具结果'),
  'H5 ★ 工具标记不再进转写正文(瘦身生效;层2 仍保留, 见 H4)')
ok(r.wsBase === 'dam-continue-proj' && Number(r.contSeq) >= 1 && r.agentPreset === 'default',
  'H6 contSeq/wsBase/agentPreset(' + r.contSeq + ' / ' + r.wsBase + ')')
ok(r.reasoningEffort === 'max' && r.carryText.includes('思考档位 max'), 'H6 材料内声明沿用模型+思考档位')

console.log('[continue-host] H8/H9 归属解析失败回退')
const origList = registryHolder.reg.list
registryHolder.reg.list = () => [{ id: 'ws-other', path: 'D:\\elsewhere', sessionIds: [] }]
const r8 = await call(API.cont, 'POST')
ok(r8 && r8.ok === true && r8.workspaceId === '', 'H8 无归属 => workspaceId=\'\'(client 回退 cwd), 仍能出材料')
registryHolder.reg.list = origList

// H9:另一个实例没有 workspaceRegistry 服务(ctx.get 全 undefined)→ 不抛错、workspaceId=''
const routes2 = [], handlers2 = []
const ctx2 = {
  get() { return undefined },
  on(ev, fn) { handlers2[ev] = fn; return () => {} },
  effect(fn) { effects.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes2.push(route); return () => {} } },
}
apply(ctx2, {})
const call2 = async (p, method) => {
  let body = null
  const route = routes2.find((x) => x.path === p)
  if (!route) throw new Error('route not registered (instance 2): ' + p)
  await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: p }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
  return body
}
await call2(API.config, 'GET')
handlers2['agent/session-start']({ agent: { session: { id: SID, header: { cwd: WS_PATH } } }, source: 'test' })
await sleep(400)
const r9 = await call2(API.cont, 'POST')
ok(r9 && r9.ok === true && r9.workspaceId === '', 'H9 无 workspaceRegistry 服务 => 不抛错、workspaceId=\'\'')

console.log('[continue-host] H10 材料跟源会话工作区走(修「工作目录不正确」,2026-09-28)')
// ★旧实现(2.2.1 起,此前无人动过):buildContinueCarry/buildPrevSessionPack 按插件**当前工作区**
//   (resolvePaths(undefined) → state.ws/process.cwd())取 PLAN/账本/锚点表、落转写包 —— 多工作区时
//   把别的工作区材料当成交接材料(真机实证 2026-09-28:aik 会话 f49ace38 的包落进
//   --D--dsh-auto-memory-- 桶,包内「工作区:」一行与落盘桶自相矛盾)。修后一律跟**源会话**走:
//   此处构造「state.ws 仍指向 A(H1 的 session-start 所设)、源会话在 B」的场景对拍。
{
  const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(/async buildPrevSessionPack\(preferSid\) \{[\s\S]{0,3000}?const p = await this\.resolvePathsForSession\(sid\)/.test(SRC),
    'S-guard 包落盘目录按源会话解析(resolvePathsForSession(sid))')
  ok(/async buildContinueCarry\(preferSid\) \{[\s\S]{0,1600}?const p = await this\.resolvePathsForSession\(String\(preferSid \|\| this\.currentSessionId\(\) \|\| ''\)\)/.test(SRC),
    'S-guard 材料 PLAN/账本按源会话解析(resolvePathsForSession(preferSid…))')
}
const WS_B = 'D:\\dam-continue-proj-b'
const SID_B = 'session-continue-live-000b'
const sidBDir = path.join(home, 'sessions', 'wsB', SID_B)
mkdirSync(sidBDir, { recursive: true })
const linesB = [JSON.stringify({ agentPreset: 'default', cwd: WS_B })]
linesB.push(JSON.stringify({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'B 工作区唯一消息' }] } } }))
writeFileSync(path.join(sidBDir, 'session.jsonl'), linesB.join('\n') + '\n', 'utf8')
const bucketBHandoff = path.join(root, '.memory-root', '--D--dam-continue-proj-b--', 'handoff')
mkdirSync(bucketBHandoff, { recursive: true })
writeFileSync(path.join(bucketBHandoff, 'PLAN.md'), '# 白板B\n## 当前目标\n- WSB-ONLY-MARKER\n', 'utf8')
registryHolder.reg.list = () => [
  { id: 'ws-continue-1', path: WS_PATH, sessionIds: [SID] },
  { id: 'ws-b', path: WS_B, sessionIds: [SID_B] },
]
const r10 = await call(API.cont, 'POST', { fromSessionId: SID_B })
ok(r10 && r10.ok === true, 'H10 接续材料 ok')
ok(r10.carryText.includes('WSB-ONLY-MARKER'), 'H10 第0层 PLAN 取自源会话工作区 B 桶(不再读当前工作区)')
ok(!r10.carryText.includes('验证接续链路'), 'H10 不再把工作区 A 的 PLAN 混进材料')
ok(!!r10.transcriptPath && r10.transcriptPath.includes('--D--dam-continue-proj-b--') && existsSync(r10.transcriptPath),
  'H10 转写包落盘到源会话工作区 B 桶(' + String(r10.transcriptPath).split('.memory-root').pop() + ')')
ok(r10.workspaceId === 'ws-b', 'H10 workspaceId 按 B 会话归属解析')
ok(r10.wsBase === 'dam-continue-proj-b', 'H10 wsBase 取源会话 cwd 基名')
registryHolder.reg.list = origList

console.log('[continue-host] H11 源会话文件缺失时拒绝 _lastAgent 顶替(修「A区点接续、新会话在B区」,2026-09-30)')
// ★2026-09-30 三条漂移通道的行为级守卫:
//   通道② buildPrevSessionPack:显式传入了源会话(want)但它没有持久化文件时,旧实现会**静默改用**
//     _lastAgent(最近活跃会话)的转写包 —— cwd/模型/转写整体换成别的会话的,且 pack.cwd 存在 ⇒
//     wsFallback 警告都不触发,新会话静默落进别的工作区。通道③ buildContinueCarry:pack=null 时
//     prevSid 落全局 currentSessionId(),同样漂。
//   本用例构造:把「最近活跃会话」换成 other(带独有标记文本与独立 cwd),然后用一个盘上不存在的
//     ghost 会话 id 调 handoff-continue —— 旧代码在此必然把 other 的材料/模型顶替进来(本组断言全红),
//     新代码必须:身份=ghost、无 other 材料/模型、wsFallback=true、workspaceId=''。
{
  const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  ok(SRC.includes('if (want && cand !== want) break'),
    'H11 源码守卫:want 显式给出时只找 want 的文件(不再静默扫 lastSid)')
  ok(SRC.includes("const prevSid = (pack && pack.sessionId) || String(preferSid || '') || this.currentSessionId()"),
    'H11 源码守卫:pack=null 时 prevSid 仍沿用显式 preferSid(不落全局最近活跃)')
  const OTHER_SID = 'session-other-live-0002'
  const GHOST_SID = 'session-ghost-99999999'
  const OTHER_WS = 'D:\\dam-continue-other-proj'
  const otherDir = path.join(home, 'sessions', 'wsA', OTHER_SID)
  mkdirSync(otherDir, { recursive: true })
  const otherLines = [JSON.stringify({ agentPreset: 'default', cwd: OTHER_WS })]
  otherLines.push(JSON.stringify({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'H11OTHER-ONLY-MARKER 其他会话的独有正文,绝不允许漂进接续材料' }] } } }))
  otherLines.push(JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'other-provider', model: 'other-model', reasoningEffort: 'low' } } } }))
  const NL = String.fromCharCode(10)
  writeFileSync(path.join(otherDir, 'session.jsonl'), otherLines.join(NL) + NL, 'utf8')
  // 把「最近活跃会话」切成 other(_lastAgent=other;旧实现正是拿它顶替 want)
  handlers['agent/session-start']({ agent: { session: { id: OTHER_SID, header: { cwd: OTHER_WS } } }, source: 'test' })
  await sleep(300)
  const r11 = await call(API.cont, 'POST', { fromSessionId: GHOST_SID })
  ok(r11 && r11.ok === false && r11.error === 'source workspace unavailable',
    'H11 未知源工作区明确拒绝材料，不把其他任务或启动目录当源')
  ok(!String(r11.carryText || '').includes('H11OTHER-ONLY-MARKER'), 'H11 不混入别人的线程')
}

console.log('[continue-host] H12 真实插件路由：未知投递保留pending、核实后恢复并幂等')
{
  const ctlCalls = []
  let rejectDelivery = true, created = 0
  controllerHolder.sc = {
    cancel: async r => ctlCalls.push(['cancel', r.sessionId]),
    create: async r => { ctlCalls.push(['create', r]); return { sessionId: 'session-integration-new-' + (++created) } },
    rename: async () => {}, selectModel: async () => {},
    prompt: async r => {
      ctlCalls.push(['prompt', r.sessionId])
      if (rejectDelivery && r.sessionId !== SID) throw new Error('integration delivery rejected')
      return { accepted: true }
    },
  }
  await call(API.config, 'POST', { handoffEnabled: false, autoContinueEnabled: false })
  const decidePath = '/api/dsh-auto-memory/auto-continue-decide'
  const first = await call(decidePath, 'POST', { action: 'manual', sessionId: SID })
  ok(first && !first.ok && first.error.includes('integration delivery rejected'), 'H12 投递拒绝透出真实错误')
  const doneFile = path.join(home, 'memory', 'auto-continue-done.json')
  const sourceKey=SID.replace(/^session-/, ''), recordFile=continuedSourceFile(doneFile,sourceKey)
  ok(!existsSync(doneFile) && JSON.parse(readFileSync(recordFile,'utf8')).status === 'pending', 'H12 保留独立pending记录，不修改旧闩锁文件')
  const blocked=await call(decidePath,'POST',{action:'manual',sessionId:SID})
  ok(blocked && !blocked.ok && blocked.continuationPending && blocked.sessionId==='session-integration-new-1' && created===1, 'H12 未核实的投递错误不能盲目再建会话')
  // The fake controller conclusively rejected delivery. Operator recovery is
  // explicit; production never infers this from an arbitrary exception string.
  await releaseContinuedSource(doneFile,sourceKey,JSON.parse(readFileSync(recordFile,'utf8')).token)
  rejectDelivery = false
  const retried = await call(decidePath, 'POST', { action: 'manual', sessionId: SID })
  ok(retried && retried.ok && retried.sessionId === 'session-integration-new-2', 'H12 源会话仍可成功重试')
  ok(JSON.parse(readFileSync(recordFile,'utf8')).status==='done' && JSON.parse(readFileSync(recordFile,'utf8')).to==='session-integration-new-2', 'H12 接受材料后才持久化真实后继')
  const replay = await call(decidePath, 'POST', { action: 'manual', sessionId: SID })
  ok(replay && replay.ok && replay.sessionId === retried.sessionId && created === 2, 'H12 重复请求返回已有后继，不再建第三个会话')
  ok(ctlCalls[0][0] === 'cancel' && ctlCalls[0][1] === SID, 'H12 手动入口也停止指定旧回合')
}

for (const d of effects) { try { if (typeof d === 'function') d() } catch (e) {} }
console.log('\n[continue-host] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
