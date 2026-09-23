#!/usr/bin/env node
/** [continue-ws-attribution] 一键接续的「A 区会话接到 B 区」守卫（2026-09-23 两台 Windows 实证，issue #134）。
 *
 * 纯 Node、零依赖、不联网。真 apply(ctx) + 真临时 DSH_HOME + 两个真工作区目录，
 * 只经路由/事件入口驱动；断言对象是用户症状本身（材料来自哪个区、新会话绑哪个区）。
 *
 * 本套件即 #134 的回归网：**默认 STRICT**（三条链环修复已同批落地），`STRICT=0 node 本文件`
 * 才退回「KNOWN-DEFECT 打印但不翻红」的观察模式。三条链环：
 *   K1 接续源被自动沉淀子代理抢走：session-start 无条件写 _lastAgent，与 restoreLastAgent 口径不一致。
 *      （v3.1.7 已修：写入口径统一 isSubAgentSession()，本条钉住不回退）
 *   K2 取材走裸上下文：buildContinueCarry / buildPrevSessionPack 用 resolvePaths(undefined)
 *      ⇒ 即使 fromSessionId 正确，白板/账本/转写归档仍来自「最后活跃工作区」而非源会话工作区。
 *      （本 PR 修复：改用 resolvePathsForSession，重做被 53d20e7 回退的 #96）
 *   K3 残包回退越区：buildPrevSessionPack 返回无 cwd 的残包时回退全局区。
 *      （v3.1.7 起按源会话 id 反查 sessionWorkspaceFallback，真查不到才回退并留 wsFallback 痕迹）
 *
 * 另钉一条结构性防线（#134 建议⑤）：`resolvePaths(undefined)` 裸调调用点数量上限 ——
 * 53d20e7 式整片重写会让该数回升，数量一涨即红。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../lib/index.js'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })

const STRICT = process.env.STRICT !== '0'
let known = 0
const defect = (cond, name) => {
  if (cond) return true
  known++
  if (STRICT) assert.fail(name)
  console.log('  KNOWN-DEFECT - ' + name)
  return false
}

test('S0 结构防线:resolvePaths(undefined) 裸调调用点不得回升(53d20e7 式整片重写报警)', () => {
  const src = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const n = (src.match(/resolvePaths\(undefined\)/g) || []).length
  // 2026-09-23 基线 = 16（含 resolvePathsForSession 内部两处回落与 handoffMaterialStamp 保底）。
  // 接续链路（buildContinueCarry/buildPrevSessionPack）已按 #134 改用 resolvePathsForSession ——
  // 该数回升即有人又把「按会话解析」写回裸全局口径，必须翻红。
  assert.ok(n <= 16, 'resolvePaths(undefined) 调用点 ' + n + ' 个，超过基线 16 —— 检查是否又把按会话解析写回裸全局口径（issue #134）')
})

const root = mkdtempSync(path.join(tmpdir(), 'dam-contattr-'))
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

// A 区 = 插件「当前/最后活跃」工作区（用户没在续它）；B 区 = 被接续会话真正所属的工作区
const WS_A = path.join(root, 'go-checkin')
const WS_B = path.join(root, 'dispatch-order-sign-monitor')
mkdirSync(WS_A, { recursive: true }); mkdirSync(WS_B, { recursive: true })
const SID_A = 'session-a-live-0001'
const SID_B = 'session-b-source-0002'
const SUB_SID = 'session-subagent-sediment-9'

const sidBDir = path.join(home, 'sessions', 'wsb', SID_B)
mkdirSync(sidBDir, { recursive: true })
const MODEL = 'deepseek-v4.1-flash'
const lines = [JSON.stringify({ agentPreset: 'default', cwd: WS_B })]
lines.push(JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'deepseek-official', model: MODEL, reasoningEffort: 'low' } } } }))
for (let i = 0; i < 8; i++) {
  lines.push(JSON.stringify({ type: i % 2 === 0 ? 'user/message' : 'assistant/message', data: { message: { role: i % 2 === 0 ? 'user' : 'assistant', content: [{ type: 'text', text: (i % 2 === 0 ? '用户' : '模型') + '第' + i + '条：现在是否能把程序部署到xp机。' }] } } }))
}
writeFileSync(path.join(sidBDir, 'session.jsonl'), lines.join('\n') + '\n', 'utf8')

const registry = {
  list: () => [
    { id: 'ws-a-gocheckin', path: WS_A, sessionIds: [SID_A, SUB_SID] },
    { id: 'ws-b-dispatch', path: WS_B, sessionIds: [SID_B] },
  ],
}
const routes = []
const handlers = {}
const effects = []
const ctx = {
  get(name) { return name === 'workspaceRegistry' ? registry : undefined },
  on(ev, fn) { handlers[ev] = fn; return () => {} },
  effect(fn) { effects.push(fn); return () => {} },
  systemPrompt: { section() { return () => {} }, context() { return () => {} } },
  tools: { register() { return () => {} } },
  webServer: { register(route) { routes.push(route); return () => {} } },
}
apply(ctx, {})

const call = async (needle, q, method, body) => {
  const r = routes.find((x) => String(x.path).includes(needle))
  assert.ok(r, 'route not registered: ' + needle)
  const url = r.path + (q || '')
  const rq = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: method || (body ? 'POST' : 'GET'), url,
  })
  let out = null
  await r.handler(rq, { writeHead() {}, end(b) { out = JSON.parse(b) } })
  return out
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let dirA = '', dirB = ''

test('C0 前置：A 区成为插件「当前工作区」，两区各自有白板与账本', async () => {
  await call('/config', '', 'GET')
  handlers['agent/session-start']({ agent: { session: { id: SID_A, header: { cwd: WS_A } } }, source: 'test' })
  await sleep(700)
  const stA = await call('handoff-state', '')
  const stB = await call('handoff-state', '?sessionId=' + SID_B)
  assert.equal(stA.ws, WS_A, '裸上下文 = A 区（模拟用户当时在 A 区活跃）')
  assert.equal(stB.ws, WS_B, '★ 面板按 sessionId 解析能正确回到 B 区 —— 接续路径要用的是同一个现成能力')
  dirA = path.dirname(stA.planPath); dirB = path.dirname(stB.planPath)
  assert.notEqual(dirA, dirB, '两区 handoff 目录必须不同，否则本套件无效')
  mkdirSync(dirA, { recursive: true }); mkdirSync(dirB, { recursive: true })
  writeFileSync(path.join(dirA, 'PLAN.md'), '# 白板 A\n## 当前目标\n- PLAN-A-MARKER go-checkin 打卡机部署\n', 'utf8')
  writeFileSync(path.join(dirA, 'handoff-20260923-150000.md'), '# 账本 A\n## 任务状态\n- LEDGER-A-MARKER go-checkin\n## 目标\n- A\n## 已试方案与失败原因\n- A\n## 进度与下一步\n- A\n', 'utf8')
  writeFileSync(path.join(dirB, 'PLAN.md'), '# 白板 B\n## 当前目标\n- PLAN-B-MARKER 把程序部署到 XP 机\n', 'utf8')
  writeFileSync(path.join(dirB, 'handoff-20260923-151200.md'), '# 账本 B\n## 任务状态\n- LEDGER-B-MARKER dispatch-order-sign-monitor\n## 目标\n- 部署\n## 已试方案与失败原因\n- 无\n## 进度与下一步\n- 继续\n', 'utf8')
})

test('K1 接续源不得被自动沉淀子代理抢走（session-start 与 restoreLastAgent 同口径）', async () => {
  handlers['agent/session-start']({
    agent: { session: { id: SUB_SID, header: { cwd: WS_A, origin: 'subagent', delegationDepth: 1, parentSession: SID_A } } },
    source: 'test',
  })
  await sleep(300)
  const st = await call('handoff-state', '')
  const sid = st && st.refresh && st.refresh.sessionId
  // client.js 把 refresh.sessionId 当 lastRefreshSessionId，再当 fromSessionId 发给接续端点
  defect(sid !== SUB_SID, 'K1 refresh.sessionId 不该是被回收的子代理会话（实测 ' + sid + '，用户真实会话是 ' + SID_A + '）')
})

test('K2 源会话可读时：材料与转写归档必须同属源会话工作区', async () => {
  const r = await call('handoff-continue', '', 'POST', { fromSessionId: SID_B })
  assert.equal(r.ok, true, '硬守：接续材料必须构造成功')
  assert.equal(r.workspaceId, 'ws-b-dispatch', '硬守：workspaceId 按 sid 解析回 B 区')
  assert.equal(r.prevSessionId, SID_B, '硬守：源会话 = 显式传入的 fromSessionId')
  assert.ok(String(r.carryText || '').includes('【第0层 · 白板 PLAN.md'), '硬守：第0层材料在场')
  assert.ok(String(r.carryText || '').includes('【第1层 · 交接账本'), '硬守：第1层材料在场')
  defect(String(r.carryText || '').includes('PLAN-B-MARKER'), 'K2 第0层白板须取自 B 区 PLAN（实测读到 A 区）')
  defect(String(r.carryText || '').includes('LEDGER-B-MARKER'), 'K2 第1层账本须取自 B 区（实测读到 A 区）')
  defect(!String(r.carryText || '').includes('PLAN-A-MARKER') && !String(r.carryText || '').includes('LEDGER-A-MARKER'),
    'K2 材料里不得混入 A 区白板/账本')
  defect(String(r.transcriptPath || '').replace(/\\/g, '/').includes(dirB.replace(/\\/g, '/')),
    'K2 转写包须归档在 B 区 handoff 目录（实测落 A 区）')
})

test('K3 源会话日志被回收（残包无 cwd）时：不得回退到全局最后活跃区', async () => {
  const bak = path.join(root, 'subagent-gc-backup')
  mkdirSync(bak, { recursive: true })
  rmSync(sidBDir, { recursive: true, force: true })
  const r = await call('handoff-continue', '', 'POST', { fromSessionId: SID_B })
  assert.equal(r.ok, true, '硬守：残包仍要出材料（fail-soft，绝不阻塞接续）')
  assert.ok(!existsSync(sidBDir), '硬守：前置条件——源会话目录确实已不可读')
  defect(r.ws === WS_B, 'K3 pack.cwd 缺失时 ws 仍须归属 B（实测回退 ' + r.ws + '）')
  defect(!String(r.carryText || '').includes('PLAN-A-MARKER'), 'K3 回退时也不得读 A 区白板/账本')
})

if (!STRICT && known) console.log('[continue-ws-attribution] 已知缺陷 ' + known + ' 条未计入（STRICT=1 翻红），见 .bug-hunter/issues/ux-3-p2-continue-carry-cross-workspace.md')
for (const d of effects) { try { if (typeof d === 'function') d() } catch (e) {} }
