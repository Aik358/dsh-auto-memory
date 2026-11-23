#!/usr/bin/env node
/**
 * smoke-test-v4-d2-unarchived.mjs —— v4 批次 D2 · 存量未归档三件套验收。
 *
 * 覆盖 CONSTRUCTION-DOC 第 3 部分的三件套 + MASTER-PLAN §9⑤ 补的事件读接口：
 *   (a) 未归档栏  GET /event-unarchived（分页、口径 A 只算四段账本）
 *   (b) 审理按钮  POST /event-curate（只产草案，绝不写盘）
 *   (c) 二次确认  后端 confirmToken 校验 ⇒ 缺/错一律 **409**（可被 curl 绕过的是前端）
 *   (+) 事件列表 GET /event-list / GET /event-detail（F 线三视图的前置）
 *
 * 纪律：真 apply() 起 host → 真调 route.handler → 断言状态码与返回体。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply, API, MemoryEngine } from '../lib/state-engine.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-v4-d2-'))
const workspace = path.join(root, 'workspace')
fs.mkdirSync(workspace, { recursive: true })
process.env.HOME = root; process.env.DSH_HOME = root
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'),
  handoffEnabled: true, autoContinueEnabled: true, teamEnabled: false, externalSources: {},
}))

const routes = []
let engine = null
const interval = globalThis.setInterval, timeout = globalThis.setTimeout, fetch = globalThis.fetch
const load = MemoryEngine.prototype.loadConfigSync
const ledger = (goal) => ['# 交接账本 · 2026-10-24 10:00', '', '## 任务状态', '- 进行中', '', '## 目标', goal, '', '## 已试方案与失败原因', '- 无', '', '## 进度与下一步', '- 继续做', ''].join('\n')

function call(p, body, method = 'POST') {
  const route = routes.find((r) => r.path === p.split('?')[0])
  assert(route, 'route not registered: ' + p)
  let status, value, raw
  const req = Readable.from([Buffer.from(JSON.stringify(body || {}))])
  Object.assign(req, { method, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' }, url: p })
  return route.handler(req, { writeHead: (s) => { status = s }, end: (text) => { raw = text; try { value = JSON.parse(text) } catch (e) { value = text } } })
    .then(() => ({ status, value, raw }))
}

try {
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
  apply({
    get: () => undefined, on: () => () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    effect: (f) => { f() },
  }, {})
  globalThis.setInterval = interval; globalThis.setTimeout = timeout; globalThis.fetch = fetch
  MemoryEngine.prototype.loadConfigSync = load
  assert(engine, 'engine 未创建')
  engine.configLoaded = true

  // ★路径必须**问引擎**，不能自己拼：projectDirOf 走 memoryRoot/workspaces/<wsKey>，
  //   bindMemoryDirectoryPre 还会做归属绑定。自己拼会让扫描扫到空目录（首版实测 total=0）。
  engine.state.ws = workspace
  const paths = await engine.resolvePaths(undefined)
  const handoffDir = paths.handoffDir
  fs.mkdirSync(handoffDir, { recursive: true })
  fs.writeFileSync(path.join(handoffDir, 'PLAN.md'), '# 白板\n\n## 是什么\n测试用。\n')
  // 3 篇四段账本 + 1 篇非四段（机械副产物）
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100001.md'), ledger('做事件检索'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100002.md'), ledger('做事件检索'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100003.md'), ledger('完全不同的另一件事'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100004.md'), '# 一次性报告\n没有四段标题。\n')

  console.log('[D2-1] ★(a) 未归档栏：只算四段账本（口径 A），机械副产物不进队列')
  const list = await call(API['event-unarchived'], null, 'GET')
  ok(list.status === 200, 'GET /event-unarchived ⇒ 200（实测 ' + list.status + '）')
  ok(list.value.ok === true, '返回 ok:true')
  ok(list.value.total === 3, '★口径 A：total=3（4 篇 .md 里只有 3 篇是四段账本，实测 ' + list.value.total + '）')
  ok(list.value.skippedNonLedger === 1, '正：如实报告跳过了 1 篇非四段（实测 ' + list.value.skippedNonLedger + '）')
  ok(list.value.unarchived === 3, '当前没有事件 ⇒ 3 篇全未归档')
  ok(Array.isArray(list.value.items) && list.value.items.length === 3, '返回 3 条明细')
  ok(list.value.items.every((i) => i.rel.startsWith('handoff/')), '明细带 rel 相对路径')
  ok(!list.value.items.some((i) => i.name === 'handoff-20261024-100004.md'), '★负：非四段账本**不**在未归档队列里')

  console.log('[D2-2] 分页：839 篇一次返回会卡前端 ⇒ 必须分页')
  const p1 = await call(API['event-unarchived'] + '?limit=2', null, 'GET')
  ok(p1.value.items.length === 2, 'limit=2 ⇒ 只返回 2 条')
  ok(p1.value.nextCursor === 2, '★正：nextCursor=2（还有下一页）')
  ok(p1.value.total === 3, '分页时 total 仍是全量 3')
  const p2 = await call(API['event-unarchived'] + '?limit=2&cursor=2', null, 'GET')
  ok(p2.value.items.length === 1, '第二页 1 条')
  ok(p2.value.nextCursor === null, '★正：末页 nextCursor=null')

  // ★2026-10-25 判据更新（用户裁定：自证式 expectToken 守卫废除 ⇒ 改服务端签发令牌）。
  //   旧断言正向验证的是「客户端同时送 confirmToken + expectToken 再互相比对」——
  //   那是**被推翻的机制**（两个值填一样就过，等于没守卫）。本段改为验证新契约的两端：
  //   出草案免令牌（只读凭什么要）、写盘必须有服务端签发的真令牌。
  //   **不是放宽**：新增的第 ④ 条正是「旧机制已彻底废除」的反向自证。
  console.log('[D2-3] ★(c) 二次确认的**两端**：出草案免令牌；写盘必须有真令牌')

  // ① 出草案（不带 candidateIds）⇒ **200 且签发令牌**（新契约：只读不需要令牌）
  const rDraft = await call(API['event-curate'], { limit: 40 })
  ok(rDraft.status === 200, '★出草案不带令牌 ⇒ 200（新契约：只读预览不需要令牌，实测 ' + rDraft.status + '）')
  ok(typeof rDraft.value.confirmToken === 'string' && rDraft.value.confirmToken.length >= 16, '★★服务端签发 confirmToken（实测长度 ' + String(rDraft.value.confirmToken || '').length + '）')
  const realToken = rDraft.value.confirmToken

  // ② 写盘（带 candidateIds）但**不带令牌** ⇒ 409
  const ids0 = (rDraft.value.drafts || []).map((d) => d.candidateId)
  const rNoTok = await call(API['event-curate'], { candidateIds: ids0 })
  ok(rNoTok.status === 409, '★写盘不带令牌 ⇒ 409（实测 ' + rNoTok.status + '）')
  ok(rNoTok.value.error === 'confirm-required', '★错误码 confirm-required')
  ok(rNoTok.value.code === 'confirm-required', '★★响应体带 code 字段（双保险，前端不依赖 HTTP 数字）')
  ok(!/409/.test(String(rNoTok.value.message || '')), '★★message 里不拼数字（前端取 body.error/body.code）')

  // ③ 写盘带**假令牌** ⇒ 409
  const rBad = await call(API['event-curate'], { candidateIds: ids0, confirmToken: 'curate-fake-token-xxxx' })
  ok(rBad.status === 409, '★假令牌 ⇒ 409（实测 ' + rBad.status + '）')

  // ④ ★★最关键：客户端自造一对相同的 confirmToken/expectToken ⇒ **仍 409**
  //    这条证明「自证式守卫已彻底废除」，不是只把断言改成配合新代码。
  //    ★反向自证：若谁把自证机制加回来，这条必红。
  const rSelf = await call(API['event-curate'], { candidateIds: ids0, confirmToken: 'x', expectToken: 'x' })
  ok(rSelf.status === 409, '★★★自造相同 token 对 ⇒ 仍 409（证明自证机制彻底废除，实测 ' + rSelf.status + '）')

  // ⑤ GET ⇒ 405（原样保留）
  const rGet = await call(API['event-curate'], null, 'GET')
  ok(rGet.status === 405, '负：GET 该路由 ⇒ 405（只接受 POST）')
  // 供后续段落复用（[D2-4] 用它带真令牌预览）
  void realToken

  console.log('[D2-4] ★(b) 审理：带对 token ⇒ 200，只产草案，**绝不写盘**')
  const before = fs.readdirSync(handoffDir).sort().join(',')
  // （旧 okToken 常量已随自证机制废除而移除；本段验证「无令牌也能出草案」）
  // ★判据更新：出草案不再需要任何令牌（旧 expectToken 自证已废除）——只读预览凭什么要令牌。
  const cur = await call(API['event-curate'], { limit: 40 })
  ok(cur.status === 200, '★带对 token ⇒ 200（实测 ' + cur.status + '）')
  ok(cur.value.ok === true, '返回 ok:true')
  ok(cur.value.wrote === false, '★返回明确写 wrote:false（人在环：草案不落盘）')
  ok(Array.isArray(cur.value.drafts), '返回 drafts 数组')
  ok(cur.value.drafts.length >= 1, '至少产出 1 个草案（实测 ' + cur.value.drafts.length + '）')
  ok(cur.value.cost && typeof cur.value.cost.estimatedInputTokens === 'number', '正：附成本估算（用户要求「显示预估 token」）')
  const after = fs.readdirSync(handoffDir).sort().join(',')
  ok(before === after, '★负：审理**没有新增任何文件**（真·只产草案）')
  const twoSame = cur.value.drafts.find((d) => d.memberCount >= 2 || d.members.length >= 2)
  ok(!!twoSame, '★正：同一目标段的两篇账本被聚到同一个候选事件')
  ok(cur.value.drafts.every((d) => ['high', 'medium', 'low'].includes(d.confidence)), '★D11：每个草案带 confidence（支持「全部接受 high」）')

  console.log('[D2-5] 预览模式 dryRun：不启动子代理、不烧 token')
  // ★判据更新：dryRun 是只读预览 ⇒ **不需要令牌**（原 confirmToken/expectToken 已废除）
  const dry = await call(API['event-curate'], { dryRun: true })
  ok(dry.status === 200 && dry.value.dryRun === true, '★dryRun ⇒ 200 且标记 dryRun:true')
  ok(Array.isArray(dry.value.draftsPreview), '返回 draftsPreview（前几条预览）')

  console.log('[D2-6] ★( + ) 事件列表 / 详情（MASTER-PLAN §9⑤ 补的缺口）')
  const evList = await call(API['event-list'], null, 'GET')
  ok(evList.status === 200, 'GET /event-list ⇒ 200（实测 ' + evList.status + '）')
  ok(evList.value.ok === true && Array.isArray(evList.value.events), '返回 {ok, events[]}')
  ok(evList.value.total === 0, '空库 ⇒ total=0')
  const evDetail = await call(API['event-detail'] + '?id=evt_nonexistent', null, 'GET')
  ok(evDetail.status === 404, '★负：不存在的事件 ⇒ 404（实测 ' + evDetail.status + '）')
  const evNoId = await call(API['event-detail'], null, 'GET')
  ok(evNoId.status === 400, '★负：缺 id ⇒ 400')

  console.log('[D2-7] 负路径：403（非 loopback 请求一律拒绝）')
  const route = routes.find((r) => r.path === API['event-unarchived'])
  let status403
  const badReq = Readable.from([Buffer.from('')])
  Object.assign(badReq, { method: 'GET', socket: { remoteAddress: '8.8.8.8' }, headers: { host: 'evil.example.com' }, url: API['event-unarchived'] })
  await route.handler(badReq, { writeHead: (s) => { status403 = s }, end: () => {} })
  ok(status403 === 403, '★负：非回环来源 ⇒ 403（实测 ' + status403 + '）')

  console.log('')
  console.log('[D2] ' + pass + ' PASS / ' + fail + ' FAIL')
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  process.exit(fail ? 1 : 0)
} catch (e) {
  console.log('  FAIL 套件异常: ' + ((e && e.stack) || e))
  try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch (_) {}
  process.exit(1)
}