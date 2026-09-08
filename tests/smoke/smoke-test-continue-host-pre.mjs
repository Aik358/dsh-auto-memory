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
writeFileSync(path.join(home, 'dsh-auto-memory-pre.json'), JSON.stringify({
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

const registryHolder = { reg: { list: () => [{ id: 'ws-continue-1', path: WS_PATH, sessionIds: [SID] }] } }
const routes = []
const handlers = {}
const effects = []
const ctx = {
  get(name) { return name === 'workspaceRegistry' ? registryHolder.reg : undefined },
  on(ev, fn) { handlers[ev] = fn; return () => {} },
  effect(fn) { effects.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})

const API = {
  config: '/api/dsh-auto-memory-pre/config',
  state: '/api/dsh-auto-memory-pre/handoff-state',
  cont: '/api/dsh-auto-memory-pre/handoff-continue',
}
const call = async (p, method) => {
  let body = null
  const route = routes.find((r) => r.path === p)
  if (!route) throw new Error('route not registered: ' + p)
  await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: p }, { writeHead() {}, end(b) { body = JSON.parse(b) } })
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
ok(!!(st0.refresh && /刷新仪式/.test(st0.refresh.prompt) && /memory_note_pre\(kind=plan/.test(st0.refresh.prompt) && /memory_note_pre\(kind=handoff/.test(st0.refresh.prompt)),
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
ok(tr.includes('tool_call**: read(') && tr.includes('tool_result**: 工具结果') && tr.includes('模型第23条'), 'H5 转写含工具标记与消息')
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

for (const d of effects) { try { if (typeof d === 'function') d() } catch (e) {} }
console.log('\n[continue-host] ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail > 0 ? 1 : 0)
