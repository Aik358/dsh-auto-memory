import * as fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { apply, MemoryEngine } from '../lib/audit-engine.mjs'
import { computeRevision } from '../../lib/ledger-doc/protocol.js'
import { normalizeEventPre } from '../../lib/event-store.js'

// R4 P6/P7 A1-c：memory_note 的维护文档写入入口（documentId / expectedRevision / changeSet）。
// 全部真实执行：真 apply() → 真 tool.execute()。隔离 DSH_HOME + 合成文档，不读真实记忆。
const root = path.resolve('artifacts', '_r4-p6p7-a1-20261112', 'fixtures', 'write-suite')
await fs.rm(root, { recursive: true, force: true })
const home = path.join(root, 'dsh-home'), workspace = path.join(root, 'workspace')
const memoryRoot = path.join(home, 'memory', 'workspaces'), userMemoryDir = path.join(home, 'memory')
await fs.mkdir(memoryRoot, { recursive: true }); await fs.mkdir(userMemoryDir, { recursive: true }); await fs.mkdir(workspace, { recursive: true })
const prevHome = process.env.DSH_HOME
const prevSetTimeout = globalThis.setTimeout, prevSetInterval = globalThis.setInterval, prevFetch = globalThis.fetch
const prevLoad = MemoryEngine.prototype.loadConfigSync
process.env.DSH_HOME = home
globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
globalThis.fetch = async () => new Response('{}', { status: 503 })
const tools = []; let engine = null
const agent = { session: { id: 'session-a1write', header: { cwd: workspace } } }
MemoryEngine.prototype.loadConfigSync = function (...a) { engine = this; return prevLoad.apply(this, a) }
let pass = 0, fail = 0; const failures = []
async function test(name, action) {
  try { const d = await action(); pass++; console.log('  ok   - ' + name + (d ? ' :: ' + d : '')) }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log('  FAIL - ' + name + ' :: ' + e.stack) }
}
await fs.writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  ledgerDocEnabled: true, handoffEnabled: true, criteriaGate: false, boardMode: 'legacy',
  memoryRoot, userMemoryDir, teamEnabled: false, globalBriefEnabled: false, externalSources: {},
}))
try {
  apply({
    get: (k) => (k === 'agents' ? { get: (id) => (id === agent.session.id ? agent : null) } : undefined),
    on: () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: (t) => { tools.push(t); return () => {} } }, webServer: { register: () => () => {} }, effect: () => {},
  }, {})
} finally {
  globalThis.setTimeout = prevSetTimeout; globalThis.setInterval = prevSetInterval
}
const note = tools.find((t) => t.name === 'memory_note')
const P = await engine.resolvePaths(agent)
await fs.mkdir(path.join(P.handoffDir, 'documents'), { recursive: true })
await fs.mkdir(path.join(P.projectDir, 'logs'), { recursive: true })
await fs.mkdir(path.join(P.projectDir, 'archive'), { recursive: true })
const docId = 'a1-suite-261112-0001'
const now = new Date().toISOString()
const render = (rev) => ['# A1 suite doc', '<!-- r4-ledger-doc-v1 -->', 'documentId: ' + docId, 'eventIds: evt_a1b2c3d4', 'createdAt: ' + now, 'updatedAt: ' + now, 'revision: ' + rev, '', '## 任务状态', 'before', ''].join('\n')
const rev0 = computeRevision(render(''))
await fs.writeFile(path.join(P.handoffDir, 'documents', docId + '.md'), render(rev0))
const ev0 = { id: 'evt_a1b2c3d4', name: 'A1 write suite event', summary: 'synthetic for A1-c write suite', outcome: null, skillRef: null, status: 'active', pausedReason: null, sections: { goal: 'g', doing: 'd', deadend: '', next: 'n' }, checkpoints: [], userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [], createdAt: now, updatedAt: now, startMs: Date.now(), endMs: 0, members: [], rationale: '', kind: 'unknown', confidence: 'unknown', outcomes: [], ordinal: 0, skills: normalizeEventPre({}).skills, idemTag: null }
await fs.writeFile(path.join(P.handoffDir, 'event-store.json'), JSON.stringify({ schema: 'dsh-auto-memory-event-store-v1', events: [ev0] }))
const legacyNames = async () => (await fs.readdir(P.handoffDir)).filter((n) => /^handoff-\d{8}-\d{6}/.test(n))
const docPath = path.join(P.handoffDir, 'documents', docId + '.md')
const readDoc = async () => fs.readFile(docPath, 'utf8')
const revOf = (t) => (/revision: (sha256:[0-9a-f]{64})/.exec(t) || [])[1]

await test('A1W-01 五个新参数真实注册在 memory_note 上', () => {
  const props = note.parameters.properties
  for (const k of ['documentId', 'expectedRevision', 'changeSet', 'createDocument', 'eventId']) if (!props[k]) throw new Error('missing param ' + k)
  if (props.changeSet.type !== 'array') throw new Error('changeSet type=' + props.changeSet.type)
  if (props.createDocument.type !== 'boolean') throw new Error('createDocument type=' + props.createDocument.type)
  return Object.keys(props).length + ' params'
})
await test('A1W-02 R4-on + documentId + 匹配 revision ⇒ 就地写入维护文档（不新增旧快照）', async () => {
  const before = (await legacyNames()).length
  const r = await note.execute({ content: '## 任务状态\nAFTER\n## 目标\nG', kind: 'handoff', documentId: docId, expectedRevision: rev0 }, { agent })
  if (!String(r).includes('维护文档已更新')) throw new Error('receipt=' + String(r).slice(0, 120))
  const after = await readDoc()
  if (!after.includes('AFTER')) throw new Error('content not applied')
  if (revOf(after) === rev0) throw new Error('revision not advanced')
  const legacyAfter = (await legacyNames()).length
  if (legacyAfter !== before) throw new Error('legacy snapshot created: ' + before + ' -> ' + legacyAfter)
  return 'rev ' + rev0.slice(7, 15) + ' -> ' + revOf(after).slice(7, 15)
})
await test('A1W-03 CAS 冲突：旧 revision ⇒ document-version-conflict 且不写', async () => {
  const before = await readDoc()
  const r = String(await note.execute({ content: 'X', kind: 'handoff', documentId: docId, expectedRevision: rev0 }, { agent }))
  if (!r.includes('document-version-conflict')) throw new Error('r=' + r.slice(0, 120))
  if ((await readDoc()) !== before) throw new Error('document changed on conflict')
  return 'conflict reported, bytes unchanged'
})
await test('A1W-04 缺 expectedRevision ⇒ 拒绝并回报当前 revision', async () => {
  const cur = revOf(await readDoc())
  const r = String(await note.execute({ content: 'X', kind: 'handoff', documentId: docId }, { agent }))
  if (!r.includes('必须带 expectedRevision')) throw new Error('r=' + r.slice(0, 120))
  if (!r.includes(cur)) throw new Error('current revision not echoed')
  return 'echoes current revision'
})
await test('A1W-05 非法 documentId 形状 ⇒ 拒绝（不能凭猜测写入）', async () => {
  const r = String(await note.execute({ content: 'X', kind: 'handoff', documentId: 'BAD ID!!', expectedRevision: rev0 }, { agent }))
  if (!r.includes('形状非法')) throw new Error('r=' + r.slice(0, 120))
  return 'shape rejected'
})
await test('A1W-06 不存在的 documentId ⇒ 明确要求首建参数，不静默新建', async () => {
  const before = (await fs.readdir(path.join(P.handoffDir, 'documents'))).length
  const r = String(await note.execute({ content: 'X', kind: 'handoff', documentId: 'nope-261112-0001', expectedRevision: rev0 }, { agent }))
    const after = (await fs.readdir(path.join(P.handoffDir, 'documents'))).length
  if (after !== before) throw new Error('document silently created')
  return 'not-found, no create'
})
await test('A1W-07 二次合法 CAS 写入 ⇒ 生效（链路可重复）', async () => {
  const cur = revOf(await readDoc())
  const r = String(await note.execute({ content: '## 任务状态\nSECOND\n## 目标\nG2', kind: 'handoff', documentId: docId, expectedRevision: cur }, { agent }))
  if (!r.includes('维护文档已更新')) throw new Error('r=' + r.slice(0, 120))
  const after = await readDoc()
  if (!after.includes('SECOND')) throw new Error('second write not applied')
  if (revOf(after) === cur) throw new Error('revision not advanced')
  return 'second write ok'
})
await test('A1W-08 changeSet 走区域级改动（只改 content，title/eventIds 保留）', async () => {
  const cur = revOf(await readDoc())
  const r = String(await note.execute({ content: '## 任务状态\nREGION\n', kind: 'handoff', documentId: docId, expectedRevision: cur, changeSet: [{ regionId: 'content', afterText: '## 任务状态\nREGION\n' }] }, { agent }))
  if (!r.includes('维护文档已更新')) throw new Error('r=' + r.slice(0, 120))
  const after = await readDoc()
  if (!after.includes('REGION')) throw new Error('changeSet not applied')
  if (!after.includes('# A1 suite doc')) throw new Error('title lost')
  return 'region write ok'
})
await test('A1W-09 R4-off + 无 documentId ⇒ 原样旧路径（字节级旧账本）', async () => {
  const savedEnabled = engine.config.ledgerDocEnabled
  engine.config.ledgerDocEnabled = false
  const before = (await legacyNames()).length
  const r = String(await note.execute({ content: '## 任务状态\nLEGACY\n## 目标\nG', kind: 'handoff' }, { agent }))
  engine.config.ledgerDocEnabled = savedEnabled
  if (!r.includes('交接账本已写入')) throw new Error('r=' + r.slice(0, 120))
  const after = (await legacyNames()).length
  if (after !== before + 1) throw new Error('legacy snapshot missing: ' + before + ' -> ' + after)
  return 'legacy path intact'
})
await test('A1W-10 R4-off 却传 documentId ⇒ 明确拒绝（不静默降级成旧账本）', async () => {
  const savedEnabled = engine.config.ledgerDocEnabled
  engine.config.ledgerDocEnabled = false
  const before = (await legacyNames()).length
  const r = String(await note.execute({ content: 'X', kind: 'handoff', documentId: docId, expectedRevision: revOf(await readDoc()) }, { agent }))
  engine.config.ledgerDocEnabled = savedEnabled
  if (!r.includes('维护文档写入未启用')) throw new Error('r=' + r.slice(0, 140))
  if ((await legacyNames()).length !== before) throw new Error('silently degraded to legacy write')
  return 'explicit refusal, no legacy write'
})
await test('A1W-11 plan 分支不受影响（writePlanSnapshot 原样）', async () => {
  const before = (await legacyNames()).length
  const r = String(await note.execute({ content: '# 白板\n\n## 状态\nok\n', kind: 'plan' }, { agent }))
  if (!r.includes('白板')) throw new Error('r=' + r.slice(0, 140))
  if ((await legacyNames()).length !== before) throw new Error('plan wrote a handoff snapshot')
  return 'plan branch unaffected'
})

// ── task-2：事件零副作用断言（旧检查点不得与 R4 WAL 并存 / 可预期拒绝不得写事件）──
const evPath = path.join(P.handoffDir, 'event-store.json')
const ckStats = async () => {
  const raw = await fs.readFile(evPath, 'utf8')
  const store = JSON.parse(raw)
  const ev = (store.events || []).find((x) => x.id === 'evt_a1b2c3d4') || { checkpoints: [] }
  const cps = ev.checkpoints || []
  return {
    bytes: Buffer.byteLength(raw, 'utf8'),
    total: cps.length,
    legacyHandoff: cps.filter((c) => c.kind === 'handoff').length,
    walPrepared: cps.filter((c) => c.kind === 'wal-prepared').length,
    walCommitted: cps.filter((c) => c.kind === 'wal-committed').length,
    failedKinds: cps.filter((c) => /-write-failed$/.test(String(c.kind))).length,
  }
}
await test('A1W-12 合法 documentId 更新：只产生 R4 WAL 对，**无** kind=handoff 旧全文检查点', async () => {
  const before = await ckStats()
  const cur = revOf(await readDoc())
  const r = String(await note.execute({ content: '## 任务状态\nWAL-ONLY\n## 目标\nG', kind: 'handoff', documentId: docId, expectedRevision: cur }, { agent }))
  if (!r.includes('维护文档已更新')) throw new Error('r=' + r.slice(0, 120))
  if (!(await readDoc()).includes('WAL-ONLY')) throw new Error('content not applied')
  const after = await ckStats()
  if (after.legacyHandoff !== before.legacyHandoff) throw new Error('legacy handoff checkpoint leaked: ' + before.legacyHandoff + ' -> ' + after.legacyHandoff)
  if (after.walPrepared !== before.walPrepared + 1) throw new Error('wal-prepared != +1: ' + before.walPrepared + ' -> ' + after.walPrepared)
  if (after.walCommitted !== before.walCommitted + 1) throw new Error('wal-committed != +1: ' + before.walCommitted + ' -> ' + after.walCommitted)
  if (after.failedKinds !== before.failedKinds) throw new Error('failure marker written on success path')
  return 'handoff=' + after.legacyHandoff + ' wal+' + (after.walPrepared - before.walPrepared) + '/' + (after.walCommitted - before.walCommitted)
})
await test('A1W-13 可预期拒绝（CAS / shape / 缺 revision / 不存在 / R4-off）事件字节与检查点数零增量', async () => {
  const cases = []
  const savedEnabled = engine.config.ledgerDocEnabled
  const snap = async () => ckStats()
  const cur = revOf(await readDoc())
  cases.push(['cas', { content: 'X', kind: 'handoff', documentId: docId, expectedRevision: rev0 }])
  cases.push(['shape', { content: 'X', kind: 'handoff', documentId: 'BAD ID!!', expectedRevision: cur }])
  cases.push(['no-rev', { content: 'X', kind: 'handoff', documentId: docId }])
  cases.push(['missing-doc', { content: 'X', kind: 'handoff', documentId: 'nope-261112-0001', expectedRevision: cur }])
  cases.push(['dup-region', { content: 'X', kind: 'handoff', documentId: docId, expectedRevision: cur, changeSet: [{ regionId: 'content', afterText: 'a' }, { regionId: 'content', afterText: 'b' }] }])
  const details = []
  for (const [name, args] of cases) {
    const b = await snap()
    await note.execute(args, { agent })
    const a = await snap()
    if (a.bytes !== b.bytes) throw new Error(name + ': event-store bytes changed ' + b.bytes + ' -> ' + a.bytes)
    if (a.total !== b.total) throw new Error(name + ': checkpoint count changed ' + b.total + ' -> ' + a.total)
    details.push(name + ':' + a.total)
  }
  // R4-off 拒绝也要零增量
  engine.config.ledgerDocEnabled = false
  try {
    const b = await snap()
    const rr = String(await note.execute({ content: 'X', kind: 'handoff', documentId: docId, expectedRevision: cur }, { agent }))
    if (!rr.includes('维护文档写入未启用')) throw new Error('R4-off not refused')
    const a = await snap()
    if (a.bytes !== b.bytes || a.total !== b.total) throw new Error('R4-off refusal wrote events')
    details.push('r4off:' + a.total)
  } finally { engine.config.ledgerDocEnabled = savedEnabled }
  return details.join(' ')
})
await test('A1W-14 默认退出：R4-on 且无 documentId/maintenanceTopic ⇒ 拒绝，**不再新增旧时间戳快照**', async () => {
  const before = (await legacyNames()).length
  const ck0 = await ckStats()
  const r = String(await note.execute({ content: '## 任务状态\nDEFAULT-EXIT\n## 目标\nG', kind: 'handoff' }, { agent }))
  if (!r.includes('maintenanceTopic')) throw new Error('r=' + r.slice(0, 160))
  const after = (await legacyNames()).length
  if (after !== before) throw new Error('legacy snapshot still written on R4-on default: ' + before + ' -> ' + after)
  const ck1 = await ckStats()
  if (ck1.total !== ck0.total) throw new Error('default refusal wrote events')
  return 'refused, legacy=' + after + ' (no new handoff-*.md)'
})
await test('A1W-14b maintenanceTopic ⇒ 确定性 documentId，首建后再次写入可 CAS 更新', async () => {
  const slug = 'project-handoff-000000-0001'
  const docPathT = path.join(P.handoffDir, 'documents', slug + '.md')
  try { await fs.unlink(docPathT) } catch (_) {}
  const r1 = String(await note.execute({ content: '## 任务状态\nTOPIC-1\n## 目标\nG', kind: 'handoff', maintenanceTopic: 'Project Handoff', eventId: 'evt_a1b2c3d4' }, { agent }))
  if (!r1.includes('维护文档')) throw new Error('r1=' + r1.slice(0, 140))
  const t1 = await fs.readFile(docPathT, 'utf8')
  if (!t1.includes('TOPIC-1')) throw new Error('topic doc missing content')
  const rev1 = revOf(t1)
  const r2 = String(await note.execute({ content: '## 任务状态\nTOPIC-2\n## 目标\nG', kind: 'handoff', maintenanceTopic: 'Project Handoff', expectedRevision: rev1 }, { agent }))
  if (!r2.includes('维护文档已更新')) throw new Error('r2=' + r2.slice(0, 140))
  const t2 = await fs.readFile(docPathT, 'utf8')
  if (!t2.includes('TOPIC-2') || t2.includes(rev1)) throw new Error('CAS update failed')
  return 'deterministic id=' + slug + ', CAS ok'
})
// ── task-2 边界：真实形态根（**不在 artifacts 内**）的可写授权通道 ──
//   PROTOCOL §9.4 允许「测试专用工作区目录」；这里用 <cwd>/_a1-realform 模拟真实工作区形态，
//   而不是把 cwd 指到 fixture 造伪证据。
const realFormRoot = path.resolve('_a1-realform')
const realMemoryRoot = path.join(realFormRoot, 'memory', 'workspaces')
const realWs = path.join(realMemoryRoot, '--D--dsh-auto-memory--')
await fs.rm(realFormRoot, { recursive: true, force: true })
await fs.mkdir(path.join(realWs, 'handoff', 'documents'), { recursive: true })
await test('A1W-15 真实形态根（非 artifacts）+ 显式 trustedMemoryRoot ⇒ 可构造、可写、可更新既有文档', async () => {
  const { createLedgerDocSystemPre } = await import('../../lib/index.js')
  const sys = createLedgerDocSystemPre({ rootDir: realWs, storePath: path.join(realWs, 'handoff', 'event-store.json'), enabled: true, readOnly: false, stampEnabled: false, trustedMemoryRoot: realMemoryRoot })
  if (sys.readOnly !== false) throw new Error('should be writable')
  if (sys.trustedMemoryRoot !== path.resolve(realMemoryRoot)) throw new Error('trusted=' + String(sys.trustedMemoryRoot))
  const started = await sys.start()
  if (!started.ok) throw new Error('start failed: ' + JSON.stringify(started).slice(0, 120))
  const docId = 'a1-real-261112-0001'
  const now = new Date().toISOString()
  const { computeRevision } = await import('../../lib/ledger-doc/protocol.js')
  const render = (rev) => ['# real-form doc', '<!-- r4-ledger-doc-v1 -->', 'documentId: ' + docId, 'eventIds: evt_a1b2c3d4', 'createdAt: ' + now, 'updatedAt: ' + now, 'revision: ' + rev, '', '## 任务状态', 'before', ''].join('\n')
  const rev0 = computeRevision(render(''))
  await fs.writeFile(path.join(realWs, 'handoff', 'documents', docId + '.md'), render(rev0))
  await fs.writeFile(path.join(realWs, 'handoff', 'event-store.json'), JSON.stringify({ schema: 'dsh-auto-memory-event-store-v1', events: [ev0] }))
  const cur = await sys.documents.readDocument(docId)
  if (!cur || cur.ok !== true) throw new Error('readDocument failed: ' + JSON.stringify(cur).slice(0, 140))
  const r = await sys.upsertDocument({ opId: 'r4op_' + 'ab'.repeat(16), documentId: docId, eventIds: ['evt_a1b2c3d4'], expectedRevision: cur.revision, changeSet: [{ regionId: 'content', beforeText: String(cur.content || ''), afterText: '## 任务状态\nAFTER-REAL\n' }] })
  if (!r || r.ok !== true) throw new Error('upsert failed: ' + JSON.stringify(r).slice(0, 160))
  const after = await fs.readFile(path.join(realWs, 'handoff', 'documents', docId + '.md'), 'utf8')
  if (!after.includes('AFTER-REAL')) throw new Error('content not applied')
  if (after.includes(rev0)) throw new Error('revision not advanced')
  return 'real-form root writable, revision advanced'
})
await test('A1W-16 负路径：无授权 / sibling / 相对路径 / 嵌套伪造 一律 ledger-doc-root-invalid', async () => {
  const { createLedgerDocSystemPre } = await import('../../lib/index.js')
  const mk = (o) => createLedgerDocSystemPre({ storePath: path.join(String(o.rootDir || realWs), 'handoff', 'event-store.json'), enabled: true, readOnly: false, stampEnabled: false, ...o })
  const cases = []
  const OKCODES = ['ledger-doc-root-invalid', 'event-store-sink-path-invalid']
  const tryIt = (name, o) => { try { mk(o); cases.push(name + ':ACCEPTED') } catch (e) { const m = String(e.message); cases.push(name + ':' + (OKCODES.some((c) => m.includes(c)) ? 'rejected' : 'other:' + m)) } }
  tryIt('no-auth', { rootDir: realWs })
  tryIt('sibling', { rootDir: realWs, trustedMemoryRoot: path.join(realFormRoot, 'other-memory-root') })
  tryIt('relative', { rootDir: realWs, trustedMemoryRoot: 'relative/path' })
  tryIt('nested', { rootDir: path.join(realMemoryRoot, 'a', 'b'), trustedMemoryRoot: realMemoryRoot })
  tryIt('trusted-self', { rootDir: realMemoryRoot, trustedMemoryRoot: realMemoryRoot })
  const bad = cases.filter((c) => !c.endsWith(':rejected'))
  if (bad.length) throw new Error(cases.join(' | '))
  return cases.join(' | ')
})
await test('A1W-17 被拒的越界根不产生任何写盘副作用', async () => {
  const evil = path.join(realFormRoot, 'evil-root')
  await fs.mkdir(path.join(evil, 'handoff', 'documents'), { recursive: true })
  const { createLedgerDocSystemPre } = await import('../../lib/index.js')
  let threw = false
  try { createLedgerDocSystemPre({ rootDir: evil, storePath: path.join(evil, 'handoff', 'event-store.json'), enabled: true, readOnly: false, stampEnabled: false, trustedMemoryRoot: path.join(realFormRoot, 'another-memory-root') }) } catch (_) { threw = true }
  if (!threw) throw new Error('evil root accepted')
  const n = (await fs.readdir(path.join(evil, 'handoff', 'documents'))).length
  const st = (await fs.readdir(path.join(evil, 'handoff'))).sort().join(',')
  if (n !== 0) throw new Error('evil root wrote files: ' + n)
  if (st !== 'documents') throw new Error('evil root created extra entries: ' + st)
  return 'rejected before any write'
})
await test('A1W-18 engine.ledgerDocWriteSystemForPre 对真实形态根仍按三重约束授权', async () => {
  const savedRoot = engine.config.memoryRoot
  try {
    engine.config.memoryRoot = realMemoryRoot
    const sys = engine.ledgerDocWriteSystemForPre(path.join(realWs, 'handoff'))
    if (sys.trustedMemoryRoot !== path.resolve(realMemoryRoot)) throw new Error('trusted=' + String(sys.trustedMemoryRoot))
    // 嵌套伪造：不满足「恰好一层」，应回落到无授权 ⇒ 构造即拒
    const nested = path.join(realMemoryRoot, 'x', 'y')
    await fs.mkdir(path.join(nested, 'handoff'), { recursive: true })
    let nestedRejected = false
    try { engine.ledgerDocWriteSystemForPre(path.join(nested, 'handoff')) } catch (e) { const m = String(e.message); nestedRejected = m.includes('ledger-doc-root-invalid') || m.includes('event-store-sink-path-invalid') }
    if (!nestedRejected) throw new Error('nested workspace wrongly authorized')
    return 'authorized real ws; nested rejected'
  } finally { engine.config.memoryRoot = savedRoot }
})
await fs.rm(realFormRoot, { recursive: true, force: true })

// ── task-2：显式首建（create-only）与默认退出边界 ──
await test('A1W-19 首建：createDocument:true + 真实 eventId ⇒ 新建维护文档，且**不写旧账本**', async () => {
  const newId = 'a1-created-261112-0001'
  const evPathNew = path.join(P.handoffDir, 'documents', newId + '.md')
  try { await fs.unlink(evPathNew) } catch (_) {}
  const ck0 = await ckStats(); const lg0 = (await legacyNames()).length
  const r = String(await note.execute({ content: '## 任务状态\nCREATED\n## 目标\nG', kind: 'handoff', documentId: newId, createDocument: true, eventId: 'evt_a1b2c3d4' }, { agent }))
  if (!/维护文档/.test(r)) throw new Error('r=' + r.slice(0, 140))
  const after = await fs.readFile(evPathNew, 'utf8')
  if (!after.includes('CREATED')) throw new Error('content missing')
  if ((await legacyNames()).length !== lg0) throw new Error('legacy snapshot written on create')
  const ck1 = await ckStats()
  if (ck1.legacyHandoff !== ck0.legacyHandoff) throw new Error('legacy checkpoint leaked on create')
  return 'created=' + newId
})
await test('A1W-20 首建负路径：已存在 / 缺 eventId / 假 eventId / 缺 createDocument ⇒ 全部拒绝且零副作用', async () => {
  const details = []
  const run = async (label, args) => {
    const b = await ckStats(); const lb = (await legacyNames()).length
    const r = String(await note.execute(args, { agent }))
    const a = await ckStats(); const la = (await legacyNames()).length
    if (a.bytes !== b.bytes || a.total !== b.total) throw new Error(label + ': event side effect')
    if (la !== lb) throw new Error(label + ': legacy write')
    details.push(label + ':' + (r.includes('memory_note') ? 'rejected' : 'ACCEPTED'))
  }
  await run('exists', { content: 'X', kind: 'handoff', documentId: 'a1-created-261112-0001', createDocument: true, eventId: 'evt_a1b2c3d4' })
  await run('no-ev', { content: 'X', kind: 'handoff', documentId: 'a1-created-261112-0002', createDocument: true })
  await run('fake-ev', { content: 'X', kind: 'handoff', documentId: 'a1-created-261112-0003', createDocument: true, eventId: 'evt_deadbeef' })
  await run('r4off-no-doc', { content: 'X', kind: 'handoff', documentId: 'a1-created-261112-0004' })
  const bad = details.filter((d) => d.endsWith(':ACCEPTED'))
  if (bad.length) throw new Error(details.join(' | '))
  return details.join(' | ')
})
await test('A1W-21 首建真实落盘：documents/ 里只多这一个文件，旧账本目录不新增 handoff-*.md', async () => {
  const docs = (await fs.readdir(path.join(P.handoffDir, 'documents'))).filter((n) => n.endsWith('.md')).sort()
  if (!docs.includes('a1-created-261112-0001.md')) throw new Error('created doc missing: ' + docs.join(','))
  const stray = docs.filter((n) => n.startsWith('a1-created-261112-000') && n !== 'a1-created-261112-0001.md')
  if (stray.length) throw new Error('rejected creates left files: ' + stray.join(','))
  return 'docs=' + docs.length
})

// ── task-2 追加：提示词与真实默认分流一致（Lead 复核项）──
await test('A1W-22 schema/GUIDANCE/memory_log 三处提示与真实 R4-on 默认分流一致（无过时表述）', async () => {
  const G = String((await import('../../lib/index.js')).GUIDANCE || '')
  if (!G) throw new Error('GUIDANCE not exported')
  const mn = tools.find((t) => t.name === 'memory_note')
  const ml = tools.find((t) => t.name === 'memory_log')
  if (!mn || !ml) throw new Error('tools not registered')
  const docDesc = String(mn.parameters.properties.documentId.description || '')
  const logDesc = String(ml.description || '')
  const bad = ['本批未改', '不传即走旧账本', '仍走旧路径新开一篇 handoff-*.md(append-only、不追改旧账本;这条**本批未改**)']
  for (const [name, text] of [['GUIDANCE', G], ['memory_log', logDesc], ['documentId schema', docDesc]]) {
    for (const b of bad) if (text.includes(b)) throw new Error(name + ' still says: ' + b)
  }
  // 三处都必须同时提到 maintenanceTopic 与「拒绝」，否则模型无法得知真实分流
  for (const [name, text] of [['GUIDANCE', G], ['memory_log', logDesc], ['documentId schema', docDesc]]) {
    if (!text.includes('maintenanceTopic')) throw new Error(name + ' missing maintenanceTopic')
    if (!/拒绝/.test(text)) throw new Error(name + ' missing explicit refusal wording')
  }
  // schema 必须显式区分「R4 开启」与「R4 关闭」
  if (!docDesc.includes('R4 开启') || !docDesc.includes('R4 关闭')) throw new Error('documentId schema lacks R4 on/off split')
  return 'three surfaces aligned'
})
await test('A1W-23 行为对照：R4-on 默认不新增旧账本；R4-off 才走旧路径（参数不静默改道）', async () => {
  const saved = engine.config.ledgerDocEnabled
  try {
    engine.config.ledgerDocEnabled = true
    const l0 = (await legacyNames()).length
    const d0 = (await fs.readdir(path.join(P.handoffDir, 'documents'))).filter((n) => n.endsWith('.md')).length
    const r1 = String(await note.execute({ content: '## 任务状态\nX\n', kind: 'handoff' }, { agent }))
    const l1 = (await legacyNames()).length
    const d1 = (await fs.readdir(path.join(P.handoffDir, 'documents'))).filter((n) => n.endsWith('.md')).length
    if (!r1.includes('maintenanceTopic')) throw new Error('R4-on default not refused: ' + r1.slice(0, 120))
    if (l1 !== l0) throw new Error('R4-on default added legacy snapshot')
    if (d1 !== d0) throw new Error('R4-on refusal created a document')
    engine.config.ledgerDocEnabled = false
    const r2 = String(await note.execute({ content: '## 任务状态\nY\n## 目标\nG', kind: 'handoff' }, { agent }))
    const l2 = (await legacyNames()).length
    if (!r2.includes('交接账本已写入')) throw new Error('R4-off no longer writes legacy: ' + r2.slice(0, 120))
    if (l2 !== l1 + 1) throw new Error('R4-off did not add exactly one legacy snapshot')
    return 'on=refused+0 legacy, off=legacy+1'
  } finally { engine.config.ledgerDocEnabled = saved }
})

process.env.DSH_HOME = prevHome
globalThis.fetch = prevFetch
console.log('')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
if (fail) { for (const f of failures) console.log('  - ' + f.name + ': ' + f.error); process.exitCode = 1 }
