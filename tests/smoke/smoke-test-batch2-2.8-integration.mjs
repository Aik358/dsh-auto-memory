import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MemoryEngine, apply } from '../lib/audit-engine.mjs'
import { eventStorePre } from '../../lib/event-store.js'
import { planRevisionPre, planCardsPre } from '../../lib/plan-store.js'
import { renderPlanFromEventsPre } from '../../lib/plan-render.js'

const root = path.resolve('artifacts', '_batch2-2.8-integration')
const workspace = path.join(root, 'workspace')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(workspace, { recursive: true })
await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), ledgerDocEnabled: false, handoffEnabled: true, criteriaGate: true, autoContinueEnabled: false, teamEnabled: false, externalSources: {} }))
const agent = { session: { id: 'synthetic-preflight-integration', header: { cwd: workspace } } }
const originalHome = process.env.DSH_HOME, interval = globalThis.setInterval, timeout = globalThis.setTimeout, fetch0 = globalThis.fetch, load = MemoryEngine.prototype.loadConfigSync
let engine, note
let pass = 0
process.on('uncaughtException', (e) => { console.error(e); process.exitCode = 1 })
const check = (x, m) => { assert.ok(x, m); pass++ }
const snapshot = async (dir) => {
  const out = []
  const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else out.push([path.relative(dir, p), await fs.readFile(p)]) } }
  await walk(dir); return out
}
try {
  process.env.DSH_HOME = root
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: (t) => { if (t.name === 'memory_note') note = t; return () => {} } }, webServer: { register: () => () => {} }, effect: () => {} }, {})
  const p = await engine.resolvePaths(agent)
  const store = path.join(p.handoffDir, 'event-store.json')
  const ev = await eventStorePre.create(store, { name: 'synthetic preflight target' })
  await fs.mkdir(p.handoffDir, { recursive: true })
  const planPath = path.join(p.handoffDir, 'PLAN.md')
  const card = (id, title) => '### ' + title + '\n<!-- memory:mem_' + id + ' -->\n- 足够的项目正文内容\n'
  const original = '# Synthetic plan\n## 目标\n- 足够长的项目目标内容\n' + card('a'.repeat(32), '保留甲') + card('b'.repeat(32), '保留乙')
  await fs.writeFile(planPath, original)
  const before = await snapshot(p.handoffDir)
  const rejected = await note.execute({ kind: 'plan', content: '# Synthetic plan\n## 目标\n短', eventId: ev.id, expectedRevision: planRevisionPre(original) }, { agent })
  check(rejected.includes('预检拒绝'), 'criteria rejection reported before WAL')
  check((await eventStorePre.detail(store, ev.id)).event.checkpoints.length === 0, 'criteria rejection event +0')
  check(JSON.stringify(await snapshot(p.handoffDir)) === JSON.stringify(before), 'criteria rejection changes zero bytes and no conflicts')
  const stale = await note.execute({ kind: 'plan', content: original, eventId: ev.id, expectedRevision: 'stale' }, { agent })
  check(stale.includes('预检拒绝') && stale.includes('plan-version-conflict'), 'stale revision rejected before WAL')
  check((await eventStorePre.detail(store, ev.id)).event.checkpoints.length === 0, 'CAS rejection event +0')
  check(JSON.stringify(await snapshot(p.handoffDir)) === JSON.stringify(before), 'CAS rejection no conflict artifact')
  const write = await note.execute({ kind: 'plan', content: original, eventId: ev.id, expectedRevision: planRevisionPre(original) }, { agent })
  check(write.includes('PLAN.md 已更新'), 'valid whole plan write')
  const successCps = (await eventStorePre.detail(store, ev.id)).event.checkpoints
  check(successCps.length === 1 && successCps[0].kind === 'plan', 'valid plan write exactly one plan checkpoint')
  const m1 = await note.execute({ kind: 'plan', content: '# Synthetic plan\n## 目标\n- 足够长的项目目标内容\n' + card('a'.repeat(32), '保留甲'), eventId: ev.id, expectedRevision: planRevisionPre(await fs.readFile(planPath, 'utf8')) }, { agent })
  check(m1.includes('丢卡警示') && m1.includes('PLAN.md 已更新'), 'M1 remains pass-through warning')
  const failed = (await eventStorePre.detail(store, ev.id)).event.checkpoints
  check(failed.length === 2 && failed.every((cp) => cp.kind === 'plan'), 'M1 success adds one plan checkpoint without false failure')
  const latestM1 = await fs.readFile(planPath, 'utf8')
  const m1Revision = planRevisionPre(latestM1)
  const race = await note.execute({ kind: 'plan', content: '# Synthetic plan\n## 目标\n- 足够长的项目目标内容\n' + card('a'.repeat(32), '保留甲'), eventId: ev.id, expectedRevision: m1Revision }, { agent })
  check(race.includes('PLAN.md 已更新'), 'post-preflight no-op follows existing final gates')
  const raceCps = (await eventStorePre.detail(store, ev.id)).event.checkpoints
  check(raceCps.length === 2 && raceCps[1].kind === 'plan' && raceCps[1].text === '# Synthetic plan\n## 目标\n- 足够长的项目目标内容\n' + card('a'.repeat(32), '保留甲'), 'identical no-op append is deduped by actual event store')
  const forced = engine.writePlanSnapshot.bind(engine)
  engine.writePlanSnapshot = async () => ({ ok: false, error: 'plan-external-edit-conflict' })
  const staleAfter = await note.execute({ kind: 'plan', content: latestM1 + '\n不同正文避免与已有检查点同幂等键', eventId: ev.id, expectedRevision: m1Revision }, { agent })
  engine.writePlanSnapshot = forced
  check(staleAfter.includes('plan-external-edit-conflict'), 'formal final-gate failure still surfaced')
  const afterRace = (await eventStorePre.detail(store, ev.id)).event.checkpoints
  check(afterRace.length === 4 && afterRace[2].kind === 'plan' && afterRace[3].kind === 'plan-write-failed', 'formal failure retains WAL compensation')
  const fromEvents = await note.execute({ kind: 'plan', fromEvents: true, eventId: ev.id, expectedRevision: planRevisionPre(await fs.readFile(planPath, 'utf8')) }, { agent })
  check(fromEvents.includes('PLAN.md 已更新'), 'real fromEvents write remains compatible')
  const rendered = await fs.readFile(planPath, 'utf8')
  check(rendered.includes('synthetic preflight target'), 'real renderer output committed')
  const cps = (await eventStorePre.detail(store, ev.id)).event.checkpoints
  check(cps.filter((cp) => cp.kind === 'plan').length === 4 && cps.filter((cp) => cp.kind === 'plan-write-failed').length === 1, 'fromEvents adds one plan checkpoint without new failure')
  console.log('SUMMARY PASS ' + pass + ' / FAIL 0')
  console.log('PHYSICAL eventCheckpoints=' + cps.length + ' planBytes=' + Buffer.byteLength(rendered) + ' revision=' + planRevisionPre(rendered))
} finally {
  process.env.DSH_HOME = originalHome; globalThis.setInterval = interval; globalThis.setTimeout = timeout; globalThis.fetch = fetch0; MemoryEngine.prototype.loadConfigSync = load
}
