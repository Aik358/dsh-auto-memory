#!/usr/bin/env node
/**
 * smoke-test-v4-h10-curate-apply.mjs —— v4-H10-b：/event-curate 二次确认**真正写盘**。
 *
 * 背景（用户 2026-10-25 裁定）：
 *   「对于存量的未归档事件，可以有按钮来调用子代理进行归档，就是处理这个旧的这个流水账式的记忆，
 *     更新成事件类的记忆，方便以后的调用和语义唤回。」
 *
 * 改动前实测缺陷：
 *   ① `curateUnarchivedPre` 末尾恒 `wrote:false` —— **全仓没有任何写入实现**；
 *   ② 路由 handler 用 `confirmToken === expectToken` 自证 —— 客户端两个值填一样就过，等于没守卫。
 *
 * 本套件要证明的三件事：
 *   1. **真写盘**：apply 后 `listUnarchivedPre().unarchived` 从 3 降到 0（只看返回值不算数）；
 *   2. **真令牌**：服务端签发 + 候选集子集校验 + TTL，客户端自造相同 token 仍 409；
 *   3. **sourceRef 形状**：必须是 `handoff/<文件名>`（写成 `auto:x` 会被归档判定跳过 ⇒ 永远归不完）。
 *
 * 驱动方式：复用 `lib/state-engine.mjs` 的 apply/API/MemoryEngine 真起 engine + 真调 route.handler
 *   （与 smoke-test-v4-d2-unarchived 同款骨架，不自己造 driver）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { apply, API, MemoryEngine } from '../lib/state-engine.mjs'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  PASS ' + m) } else { fail++; console.log('  FAIL ' + m) } }

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-v4-h10-'))
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

  engine.state.ws = workspace
  const paths = await engine.resolvePaths(undefined)
  const handoffDir = paths.handoffDir
  fs.mkdirSync(handoffDir, { recursive: true })
  fs.writeFileSync(path.join(handoffDir, 'PLAN.md'), '# 白板\n\n## 是什么\n测试用。\n')
  // 3 篇同目标四段账本（会被聚成 1 个候选）+ 1 篇不同目标 + 1 篇非四段
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100001.md'), ledger('做事件检索'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100002.md'), ledger('做事件检索'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100003.md'), ledger('做事件检索'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100004.md'), ledger('完全不同的另一件事'))
  fs.writeFileSync(path.join(handoffDir, 'handoff-20261024-100005.md'), '# 一次性报告\n没有四段标题。\n')

  const storePath = path.join(handoffDir, 'event-store.json')
  const storeStat = () => { try { const st = fs.statSync(storePath); return { size: st.size, mtimeMs: st.mtimeMs, text: fs.readFileSync(storePath, 'utf8') } } catch (e) { return null } }
  const unarchivedCount = async () => { const r = await call(API['event-unarchived'], null, 'GET'); return r.value.unarchived }

  console.log('[H10-1] 前置：3 篇四段账本（同目标）+ 1 篇不同目标 + 1 篇非四段')
  {
    const r = await call(API['event-unarchived'], null, 'GET')
    ok(r.status === 200 && r.value.ok === true, 'GET /event-unarchived ⇒ 200')
    ok(r.value.total === 4, '★口径 A：total=4（5 篇 .md 里 4 篇是四段账本，实测 ' + r.value.total + '）')
    ok(r.value.unarchived === 4, '★前置：4 篇全未归档（实测 ' + r.value.unarchived + '）')
  }

  console.log('[H10-2] ★出草案：服务端签发 confirmToken（补丁 3）')
  let draftResp, token, candidateIds = []
  {
    const beforeStore = storeStat()
    draftResp = await call(API['event-curate'], { limit: 40 })
    ok(draftResp.status === 200, '★不带任何 token 出草案 ⇒ 200（出草案不需要令牌，实测 ' + draftResp.status + '）')
    ok(draftResp.value.ok === true, '返回 ok:true')
    ok(draftResp.value.wrote === false, '★★出草案**绝不写盘**：wrote === false（契约）')
    ok(Array.isArray(draftResp.value.drafts) && draftResp.value.drafts.length >= 1, '返回 drafts（实测 ' + (draftResp.value.drafts || []).length + ' 个）')
    token = draftResp.value.confirmToken
    ok(typeof token === 'string' && token.length >= 16, '★★补丁 3：响应 body 顶层带服务端签发的 confirmToken（实测长度 ' + String(token || '').length + '）')
    const afterStore = storeStat()
    ok(JSON.stringify(beforeStore) === JSON.stringify(afterStore), '★★负：出草案后 event-store 字节与 mtime **均未变**（真·只产草案）')
    // 取候选集（挑成员数最多的那个，保证 3 篇同目标账本都在里面）
    const best = draftResp.value.drafts.slice().sort((a, b) => (b.members || []).length - (a.members || []).length)[0]
    candidateIds = [best.candidateId]
    ok(best && Array.isArray(best.members) && best.members.length === 3, '★候选集含 3 篇同目标账本（实测 ' + (best ? best.members.length : 0) + '）')
  }

  console.log('[H10-3] ★★负：自证式守卫已废除（客户端自造相同 token 仍 409）')
  {
    const beforeStore = storeStat()
    const fake = await call(API['event-curate'], { candidateIds, confirmToken: 'x', expectToken: 'x' })
    ok(fake.status === 409, '★★★核心证据：客户端自造相同 confirmToken/expectToken ⇒ 仍 409（实测 ' + fake.status + '）')
    ok(fake.value.error === 'confirm-required', '★409 body.error === confirm-required（实测 ' + fake.value.error + '）')
    ok(fake.value.code === 'confirm-required', '★★补丁 2：409 body.code 也有 confirm-required（前端取 body 不取 status，实测 ' + fake.value.code + '）')
    ok(typeof fake.value.message === 'string' && fake.value.message.length > 0, '409 带可读 message');
    ok(!/[45][0-9][0-9]/.test(fake.value.message), '★补丁 2：message 里**不含数字状态码**（实测 ' + JSON.stringify(fake.value.message) + '）')
    const afterStore = storeStat()
    ok(JSON.stringify(beforeStore) === JSON.stringify(afterStore), '★★负：409 时 event-store 字节与 mtime **均未变**')
  }

  console.log('[H10-4] ★负：无 token / 假 token / 空 candidateIds ⇒ 409')
  {
    const b0 = storeStat()
    const r1 = await call(API['event-curate'], { candidateIds });
    ok(r1.status === 409, '缺 confirmToken ⇒ 409（实测 ' + r1.status + '）')
    const r2 = await call(API['event-curate'], { candidateIds, confirmToken: 'deadbeef'.repeat(4) });
    ok(r2.status === 409, '假 confirmToken ⇒ 409（实测 ' + r2.status + '）')
    const r3 = await call(API['event-curate'], { candidateIds: [], confirmToken: token });
    ok(r3.status === 409, '空 candidateIds ⇒ 409（实测 ' + r3.status + '）')
    const a0 = storeStat()
    ok(JSON.stringify(b0) === JSON.stringify(a0), '★★负：上述三次失败均未改动 event-store（字节 + mtime）')
  }

  console.log('[H10-5] ★★负-5（Lead 追加）：A 会话 token 写 B 会话候选集 ⇒ 409（子集校验）')
  {
    const b0 = storeStat()
    // 用同一个真 token，但换一个**未签发**的 candidateId
    const r = await call(API['event-curate'], { candidateIds: ['cand-NOT-ISSUED-xyz'], confirmToken: token });
    ok(r.status === 409, '★★负-5：候选集含未签发项 ⇒ 409（证明候选集是子集校验，不是「token 对就放行」，实测 ' + r.status + '）')
    ok(String(r.value.message || '').indexOf('未签发') >= 0, '★message 点明「未签发」（实测 ' + JSON.stringify(r.value.message) + '）')
    const a0 = storeStat()
    ok(JSON.stringify(b0) === JSON.stringify(a0), '★负-5：未改动 event-store')
  }

  console.log('[H10-6] ★★负-4（Lead 追加）：令牌过期（手动清空）⇒ 409 且 store 不变')
  {
    const b0 = storeStat()
    const saved = engine._curateToken
    engine._curateToken = null;
    const r = await call(API['event-curate'], { candidateIds, confirmToken: token });
    ok(r.status === 409, '★★负-4：令牌被清空（模拟过期）⇒ 409（实测 ' + r.status + '）')
    const a0 = storeStat()
    ok(JSON.stringify(b0) === JSON.stringify(a0), '★负-4：过期时未改动 event-store')
    engine._curateToken = saved;
  }

  console.log('[H10-7] ★★★正：带真 token ⇒ 真写盘，unarchived 从 4 降到 1')
  {
    const u0 = await unarchivedCount()
    ok(u0 === 4, '★写入前 unarchived = 4（实测 ' + u0 + '）')
    const applied = await call(API['event-curate'], { candidateIds, confirmToken: token });
    ok(applied.status === 200, '★★apply ⇒ 200（实测 ' + applied.status + '）')
    ok(applied.value.ok === true, '返回 ok:true')
    ok(applied.value.wrote === true, '★★★契约：wrote === true（真写盘）')
    ok(applied.value.created === 1, '★created === 1（3 篇同目标账本聚成 1 个事件，实测 ' + applied.value.created + '）')
    ok(Array.isArray(applied.value.events) && applied.value.events.length === 1, '返回 events 数组（1 条）')
    const ev = (applied.value.events || [])[0] || {}
    ok(/^evt_[0-9a-f]{8}$/.test(String(ev.id || '')), '★事件 id 合法（evt_<8hex>，实测 ' + ev.id + '）')
    ok(Array.isArray(ev.sourceRefs) && ev.sourceRefs.length === 3, '★sourceRefs 3 条（实测 ' + (ev.sourceRefs || []).length + '）')
    // ★★核心：sourceRef 必须是 handoff/<文件名>
    ok((ev.sourceRefs || []).every((r) => /^handoff\/handoff-\d{8}-\d{6}\.md$/.test(r)), '★★★sourceRef 形状 = handoff/<文件名>（实测 ' + JSON.stringify(ev.sourceRefs) + '）')
    ok((ev.sourceRefs || []).every((r) => r.indexOf('auto:') !== 0), '★★负：sourceRef **不带** auto: 前缀')
    // ★★★这才是「真的归档了」——不是只看返回值
    const u1 = await unarchivedCount()
    ok(u1 === 1, '★★★核心：apply 后 unarchived 从 4 降 **1**（3 篇聚成一事件归档，剩 1 篇不同目标未归档；实测 ' + u1 + '）')
    const st = storeStat()
    ok(st && st.size > 0, 'event-store.json 已落盘（' + (st ? st.size : 0) + ' B）')
  }

  console.log('[H10-8] 幂等：同 candidateIds 再 apply ⇒ created 0（不重复建事件）')
  {
    const r2 = await call(API['event-curate'], { candidateIds, confirmToken: token });
    ok(r2.status === 200, '重放 ⇒ 200（实测 ' + r2.status + '）')
    ok(r2.value.created === 0, '★幂等：重放 created === 0（实测 ' + r2.value.created + '）')
    ok(r2.value.skipped >= 1, '★重放 skipped >= 1（实测 ' + r2.value.skipped + '）')
    const u2 = await unarchivedCount()
    ok(u2 === 1, '★重放后 unarchived 仍为 1（未回退、未重复）')
  }

  console.log('[H10-9] 负：GET 该路由 ⇒ 405（只接受 POST）')
  {
    const r = await call(API['event-curate'], null, 'GET');
    ok(r.status === 405, 'GET ⇒ 405（实测 ' + r.status + '）')
  }

  console.log('[H10-10] dryRun 只读预览：不需要令牌、不写盘')
  {
    const b0 = storeStat()
    const r = await call(API['event-curate'], { dryRun: true, limit: 40 });
    ok(r.status === 200, '★dryRun 不带令牌 ⇒ 200（dryRun 是只读预览，凭什么要令牌，实测 ' + r.status + '）')
    ok(r.value.dryRun === true, '返回 dryRun:true')
    ok(r.value.wrote === undefined || r.value.wrote === false, 'dryRun 不返回 wrote:true')
    const a0 = storeStat()
    ok(JSON.stringify(b0) === JSON.stringify(a0), '★dryRun 未改动 event-store')
  }

  console.log('[H10-11] 结构守卫：路由未新增 + 代码里无 expectToken 自证')
  {
    const routesNow = routes.filter((r) => /event-/.test(String(r.path))).map((r) => r.path).sort()
    ok(routesNow.length === 4, '★事件路由仍是 4 条（未新增，实测 ' + routesNow.length + ': ' + routesNow.join(', ') + '）')
    ok(routesNow.indexOf(API['event-curate']) >= 0, 'event-curate 路由在场')
    // 源码级：expectToken 只应出现在注释里，不得出现在代码行
    const IX = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), '..', '..', 'lib', 'index.js'), 'utf8')
    const codeLines = IX.split(/\r?\n/).filter((l) => !/^\s*\/\//.test(l) && l.indexOf('expectToken') >= 0)
    ok(codeLines.length === 0, '★★自证式守卫已废除：**代码行**里 expectToken 出现 0 次（只在注释里，实测代码行 ' + codeLines.length + '）')
  }
} finally {
  // ★★2026-10-25 修（全量回归实测抓到 · 进程退出崩溃）：**必须在 finally 恢复被 patch 的全局定时器/fetch**。
  //   实测：全量并行时本套件概率 exit=3221226505（0xC0000409 / libuv `UV_HANDLE_CLOSING` 断言），
  //   而套件自身断言全绿 ⇒ 不是判据问题，是**进程退出时崩溃**。
  //   根因：本套件在 try **中间**恢复（`globalThis.setInterval = iv` 等），一旦 try 中途抛异常
  //   就**恢复不到** ⇒ 后续/libuv 内部拿到假的定时器 ⇒ 退出时句柄状态不一致 ⇒ 崩溃。
  //   ★这是全仓同类套件的**通病**，已一次性修 8 个（其余 6 个本来就把恢复写在 finally 里）。
  globalThis.setInterval = iv;
  globalThis.setTimeout = to;
  globalThis.fetch = fe;
  try { fs.rmSync(root, { recursive: true, force: true }) } catch (e) {}
}

console.log('')
console.log('[H10-curate-apply] ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail ? 1 : 0)