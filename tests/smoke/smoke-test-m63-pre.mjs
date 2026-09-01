// M6-3 Surface Adapter 测试(docs/M6-CONTRACT.md §7-§11,§14):
// capability/fake 注入/pre-step claim/渲染即投递/seen 接线/TTL/冷却/section 零动态/关闭零残留。
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[M63B-TEST] FATAL:', (e && (e.stack || e.message)) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[M63B-TEST] REJ:', r); process.exit(1) })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const { parseAnchors } = await import('../../lib/memory-anchor.js')
const A = await import('../../lib/activation-inbox.js')

let pass = 0; let fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }

async function setupHarness(opts = {}) {
  const ws1 = mkdtempSync(path.join(tmpdir(), 'dam-m63b-'))
  const home = path.join(ws1, '.dsh-home')
  const memoryRoot = path.join(ws1, 'mem')
  const wsA = path.join(ws1, 'wsA')
  mkdirSync(home, { recursive: true }); mkdirSync(memoryRoot, { recursive: true }); mkdirSync(wsA, { recursive: true })
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot, userMemoryDir: path.join(ws1, 'user'), projectMemoryDir: '.project-memory',
    externalSources: {}, ...(opts.configPatch || {}) }), 'utf8')
  process.env.DSH_HOME = home
  const keyOf = (p) => '--' + p.replace(/[\\/:*?"<>|]/g, '-') + '--'
  const aaId = 'mem_' + 'aa'.repeat(16), bbId = 'mem_' + 'bb'.repeat(16)
  const md = '<!-- memory:' + aaId + ' -->\n## 用户偏好\n- 用户偏好中文回复与分步验证,部署流程使用 pnpm build\n\n' +
    '<!-- memory:' + bbId + ' -->\n## 部署流程\n- 登录模块部署流程使用 pnpm build 与 rsync'
  const wsFile = path.join(memoryRoot, keyOf(wsA), 'MEMORY.md')
  mkdirSync(path.dirname(wsFile), { recursive: true })
  writeFileSync(wsFile, md, 'utf8')
  const buf = readFileSync(wsFile)
  const p0 = parseAnchors(buf)
  const records = p0.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId, anchorId: r.anchorId || null, anchorLine: r.anchorLine || null,
    anchorByteStart: r.markerByteStart, anchorByteEnd: r.markerByteEnd,
    heading: r.heading != null ? r.heading : null,
    lineStart: r.lineStart, lineEnd: r.lineEnd, byteStart: r.byteStart, byteEnd: r.byteEnd,
    bytes: r.bytes, recordDigest: r.recordDigest, sourceVersion: 1, fileDigest: sha256Hex(buf),
    scope: 'Workspace', sourceRef: 'workspace:MEMORY.md', sourceEpoch: '33333333-3333-4333-8333-333333333333',
    excerpt: '- 参考内容',
  }))
  const sideDir = path.join(home, 'memory', 'index', 'files')
  mkdirSync(sideDir, { recursive: true })
  const canon = (x) => path.resolve(x).replace(/\\/g, '/').toLowerCase()
  writeFileSync(path.join(sideDir, createHash('sha256').update(canon(wsFile), 'utf8').digest('hex') + '.json'),
    JSON.stringify({ schemaVersion: 1, namespace: 'dsh-auto-memory', sourceFile: wsFile,
      sourceEpoch: '33333333-3333-4333-8333-333333333333', sourceVersion: 1, fileDigest: sha256Hex(buf),
      newline: 'lf', updatedAt: 1700000000000, records }, null, 2) + '\n', 'utf8')
  const tools = []; const routes = []; const handlers = new Map(); const effectSetups = []
  const promptComponents = []
  const ctx = {
    get() { return undefined }, on(n, h) { handlers.set(n, h); return () => {} },
    effect(fn) { if (typeof fn === 'function') effectSetups.push(fn); return () => {} },
    systemPrompt: {
      section(c) { promptComponents.push({ kind: 'section', ...c }); return () => {} },
      context(c) { promptComponents.push({ kind: 'context', ...c }); return () => {} },
    },
    tools: { register(d) { tools.push(d); return () => {} } },
    webServer: { register(r) { routes.push(r); return () => {} } },
  }
  const { apply } = await import('../../lib/index.js')
  apply(ctx, {})
  const fire = async (name, ...args) => { const h = handlers.get(name); if (typeof h !== 'function') throw new Error('handler missing ' + name); return Promise.resolve(h(...args)) }
  const dbg = async () => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory/debug')
    let b; await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method: 'GET', url: '/debug' }, { writeHead() {}, end(x) { b = JSON.parse(x) } })
    return b.associativeMemory
  }
  const cfgPost = async (patch) => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory/config')
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '/config', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(patch)) })() } }, { writeHead() {}, end() {} })
    await new Promise((r) => setTimeout(r, 150))
  }
  const actPost = async (payload) => {
    const route = routes.find((r) => r.path === '/api/dsh-auto-memory/activation-inbox')
    let out
    await route.handler({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }, method: 'POST', url: '/activation-inbox', [Symbol.asyncIterator]() { return (async function* () { yield Buffer.from(JSON.stringify(payload)) })() } }, { writeHead() {}, end(x) { out = JSON.parse(x) } })
    return out
  }
  const agent = { id: 'a1', session: { id: 's1', header: { id: 's1', cwd: wsA } } }
  await fire('agent/session-start', { agent, source: 'fresh' })
  await new Promise((r) => setTimeout(r, 250))
  return { ws1, home, wsA, agent, records, aaId, bbId, fire, dbg, cfgPost, actPost, promptComponents,
    tailComponent: () => promptComponents.find((c) => c.name === 'dsh:m6-reference-tail-pre'),
    settle: async () => { for (const s of effectSetups) { try { const td = await s(); if (typeof td === 'function') await td() } catch (_) {} } },
    cleanup: () => { try { rmSync(ws1, { recursive: true, force: true }) } catch (_) {} } }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('[F1] 默认关闭零行为')
{
  const h = await setupHarness()
  globalThis.__h = h
  const am = await h.dbg()
  ok(am.activationInbox && am.activationInbox.enabled === false, 'F1 关闭态严格 {enabled:false}')
  const inj = await h.actPost({ action: 'inject', request: {} })
  ok(inj.ok === false || inj.reason === 'disabled' || inj.error !== undefined || inj.outcome === undefined, 'F1 关闭态注入被拒(disabled)')
  console.log('[F1] 默认关闭零行为')
}

console.log('[F2/F3] 开启矩阵 + capability 快照')
{
  const h = globalThis.__h
  await h.cfgPost({ associativeMemoryEnabled: true, activationInboxEnabled: false })
  let am = await h.dbg()
  ok(am.activationInbox.enabled === false, 'F2 assoc=T/inbox=F → disabled')
  await h.cfgPost({ associativeMemoryEnabled: false, activationInboxEnabled: true })
  am = await h.dbg()
  ok(am.activationInbox.enabled === false, 'F2 assoc=F/inbox=T → disabled(双门)')
  await h.cfgPost({ associativeMemoryEnabled: true, activationInboxEnabled: true })
  am = await h.dbg()
  ok(am.activationInbox.enabled === true, 'F2 双开 → enabled')
  eq(am.activationInbox.capability.packetPatch, 'dynamic-context', 'F3 capability=dynamic-context(按宿主形状,非模型名)')
  eq(am.activationInbox.capability.supportsDeliveryAck, true, 'F3 supportsDeliveryAck=true(context 返回非空=进入 messages)')
  eq(am.activationInbox.cooldownSteps, 2, 'F3 冷却步数=2')
  console.log('[F2/F3] 开启矩阵 + capability')
}

console.log('[F4/F5] fake 注入 → pre-step claim → 渲染即投递')
let deliveredSeenCount = 0
{
  const h = globalThis.__h
  // 2026-08-27 默认 activationSource=js;F4/F5 测的是 fake 演示注入路由,须显式 fake
  await h.cfgPost({ associativeMemoryEnabled: true, activationInboxEnabled: true, activationSource: 'fake' })
  const A = await import('../../lib/activation-inbox.js')
  // 预热:先走一次 pre-step 让 activation host 加载 corpus 并缓存 miv
  await h.fire('agent/pre-step', { agent: h.agent, turn: 0, step: 0 }, () => {})
  const amNow = await h.dbg()
  const liveCv = (amNow.runtimes.find((r) => r.sessionId === 's1') || {}).contextVersion || 0
  const liveMiv = amNow.activationInbox.memoryIndexVersion
  ok(!!liveMiv && String(liveMiv).startsWith('idx_'), 'F4 状态接口暴露当前 miv(' + String(liveMiv).slice(0, 12) + '…)')
  const fakeReq = A.makeFakeActivationRequestPre({
    seed: 'live-1', sessionId: 's1', agentId: 'a1', workspaceKey: h.wsA.replace(/\\/g, '/').toLowerCase(),
    contextVersion: liveCv, memoryIndexVersion: liveMiv,
    ttlSteps: 5, now: Date.now(), records: h.records, maxItems: 2,
  })
  const inj = await h.actPost({ action: 'inject', request: fakeReq })
  ok(inj.ok === true, 'F4 fake 注入接受(outcome=' + (inj.outcome || inj.reason) + ')')
  const dup = await h.actPost({ action: 'inject', request: fakeReq })
  ok(dup.ok === false && String(dup.reason).startsWith('duplicate'), 'F4 同 activationId 重放拒绝')
  // pre-step 为 waterfall:fire 时补一个 noop next
  await h.fire('agent/pre-step', { agent: h.agent, turn: 1, step: 1 }, () => {})
  const tc = h.tailComponent()
  ok(!!tc, 'F4 专用尾注组件已注册(dsh:m6-reference-tail-pre)')
  const out1 = String(tc.text({ agent: h.agent }))
  ok(out1.includes(A.TAIL_MARKER_LINE_V1), 'F5 渲染文本含固定边界标记行')
  ok(/Source: mem_[0-9a-f]{32} \/ Workspace \/ v/.test(out1), 'F5 Source 行含完整 provenance 身份')
  ok(out1.trim().endsWith(A.TAIL_VERIFY_LINE_V1), 'F5 Verify 收尾行结尾')
  const out2 = String(tc.text({ agent: h.agent }))
  eq(out2, '', 'F5 已投递后再次渲染为空(同一 packet 不重复出现)')
  await sleep(500)
  const evDir = path.join(h.home, 'memory', 'evidence', 'events')
  let seenCount = 0
  if (existsSync(evDir)) {
    for (const f of readdirSync(evDir).filter((x) => x.endsWith('.jsonl'))) {
      for (const ln of readFileSync(path.join(evDir, f), 'utf8').split('\n')) if (ln.trim()) { const j = JSON.parse(ln); if (j.kind === 'seen') seenCount++ }
    }
  }
  deliveredSeenCount = seenCount
  ok(seenCount >= 1, 'F5 delivery ack 后创建 seen evidence(n=' + seenCount + ')')
  console.log('[F4/F5] 注入→claim→渲染投递→seen 接线')
}

console.log('[F6] 冷却门')
{
  const h = globalThis.__h
  const A = await import('../../lib/activation-inbox.js')
  const amNow2 = await h.dbg()
  const cv2 = (amNow2.runtimes.find((r) => r.sessionId === 's1') || {}).contextVersion || 0
  const miv2 = amNow2.activationInbox.memoryIndexVersion
  const req2 = A.makeFakeActivationRequestPre({ seed: 'live-2', sessionId: 's1', agentId: 'a1', workspaceKey: h.wsA.replace(/\\/g, '/').toLowerCase(), contextVersion: cv2, memoryIndexVersion: miv2, ttlSteps: 9, now: Date.now(), records: h.records })
  await h.actPost({ action: 'inject', request: req2 })
  await h.fire('agent/pre-step', { agent: h.agent, turn: 2, step: 2 }, () => {})
  const amB = await h.dbg()
  const deliveredBefore = amB.activationInbox.stats.delivered
  await h.fire('agent/pre-step', { agent: h.agent, turn: 2, step: 3 }, () => {})
  const out6 = String(h.tailComponent().text({ agent: h.agent }))
  const amC = await h.dbg()
  ok(out6 === '' || out6.includes(A.TAIL_MARKER_LINE_V1), 'F6 第二轮渲染要么冷却为空要么正常尾注(确定性二选一)')
  ok(amC.activationInbox.stats.delivered >= deliveredBefore, 'F6 delivered 单调不减(' + deliveredBefore + '→' + amC.activationInbox.stats.delivered + ')；严格 2 步冷却窗由 smoke-test-m62 E8 锁定')
  console.log('[F6] 冷却语义=单元锁定;live 验证投递单调性')
}

console.log('[F7/F8] section 字节稳定 / 尾注不进 section / 关闭恢复')
{
  const h = globalThis.__h
  const sectionComp = h.promptComponents.find((c) => c.kind === 'section')
  const ctxComps = h.promptComponents.filter((c) => c.kind === 'context')
  ok(sectionComp.name.includes('-pre'), 'F7 section 组件 _pre 命名')
  const secBefore = String(sectionComp.text({}))
  await h.cfgPost({ activationInboxEnabled: false, associativeMemoryEnabled: false })
  const am = await h.dbg()
  ok(am.activationInbox.enabled === false, 'F7 关闭后严格 {enabled:false}')
  const secAfter = String(sectionComp.text({}))
  eq(secBefore, secAfter, 'F7 section 输出逐字节不变(prompt 零变化)')
  const ctxTexts = ctxComps.map((c) => ({ name: c.name, t: String(c.text({ agent: h.agent })) }))
  ok(ctxTexts.every((x) => !x.t.includes(A.TAIL_MARKER_LINE_V1)), 'F7 关闭后任何组件零尾注')
  console.log('[F7/F8] section 稳定与关闭恢复')
}

console.log('[F9] TTL 过期(live)')
{
  const h = globalThis.__h
  // 2026-08-27 默认 activationSource=js;F4 测的是 fake 演示注入路由,须显式 fake
  await h.cfgPost({ associativeMemoryEnabled: true, activationInboxEnabled: true, activationSource: 'fake' })
  const A = await import('../../lib/activation-inbox.js')
  const amNow3 = await h.dbg()
  const cv3 = (amNow3.runtimes.find((r) => r.sessionId === 's1') || {}).contextVersion || 0
  const miv3 = amNow3.activationInbox.memoryIndexVersion
  const shortReq = A.makeFakeActivationRequestPre({ seed: 'short', sessionId: 's1', agentId: 'a1', workspaceKey: h.wsA.replace(/\\/g, '/').toLowerCase(), contextVersion: cv3, memoryIndexVersion: miv3, ttlSteps: 1, now: Date.now(), records: h.records })
  await h.actPost({ action: 'inject', request: shortReq })
  await h.fire('agent/pre-step', { agent: h.agent, turn: 3, step: 3 }, () => {})
  await h.fire('agent/pre-step', { agent: h.agent, turn: 3, step: 4 }, () => {})
  const tc = h.tailComponent()
  eq(String(tc.text({ agent: h.agent })), '', 'F9 TTL=1 步后渲染为空(expired)')
  console.log('[F9] TTL 过期(live)')
}

{
  const h = globalThis.__h
  try { await h.cfgPost({ associativeMemoryEnabled: false, activationInboxEnabled: false, contextBridgeEnabled: false, shadowRetrievalEnabled: false, memoryAnchorEnabled: false, contextSinkMode: 'null', activationSource: 'fake' }) } catch (_) {}
  await sleep(300)
  await h.settle()
  h.cleanup()
}

function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + (JSON.stringify(a) === JSON.stringify(b) ? '' : ' got=' + JSON.stringify(a))) }
void deliveredSeenCount
console.log('\n[M6-3] ' + pass + ' passed, ' + fail + ' failed')
if (fail > 0) process.exitCode = 1