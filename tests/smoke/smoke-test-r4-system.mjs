import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import * as api from '../../lib/ledger-doc/index.js'
import { SyntheticEventSink } from '../../artifacts/_r4-p3-fixtures/event-sink.js'

let pass = 0
let fail = 0
const failures = []
const evidence = []
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}
const fixtureRoot = path.resolve('artifacts', '_r4-m-fixtures')
const docId = 'synthetic-system-261111-0001'
const eventId = 'evt_a1b2c3d4'
const sourceName = 'handoff-20261111-120000.md'
const handoffText = [
  '# 交接账本 · synthetic facade',
  '',
  'eventId=evt_a1b2c3d4',
  '## 任务状态',
  'Synthetic current state.',
  '## 目标',
  'Exercise the unified facade.',
  '## 已试方案与失败原因',
  '',
  '## 进度与下一步',
  'Run the real WAL.',
  '',
].join('\n')
const protectedPaths = [
  'lib/index.js', 'lib/event-write.js', 'lib/event-store.js', 'lib/shared-state-lock.js',
  'lib/ledger-doc/protocol.js', 'lib/ledger-doc/document-store.js', 'lib/ledger-doc/locked-store.js',
  'lib/ledger-doc/material-stamp.js', 'lib/ledger-doc/history-query.js', 'lib/ledger-doc/coverage-audit.js', 'lib/ledger-doc/wal.js',
]
const initialHashes = new Map(await Promise.all(protectedPaths.map(async (file) => [file, createHash('sha256').update(await fs.readFile(file)).digest('hex')])))
async function reset(name) {
  const root = path.join(fixtureRoot, name)
  assert.equal(root.startsWith(fixtureRoot + path.sep), true)
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(root, { recursive: true })
  return root
}
async function fixture(name, SystemClass = api.LedgerDocSystem, enabled = true) {
  const root = await reset(name)
  const handoffDir = path.join(root, 'handoff')
  const eventsPath = path.join(handoffDir, 'event-store.json')
  await fs.mkdir(path.join(root, 'legacy'), { recursive: true })
  await fs.mkdir(handoffDir, { recursive: true })
  await fs.writeFile(path.join(root, 'legacy', sourceName), handoffText)
  const state = { schema: 'r4-synthetic-sink-v1', events: [{ id: eventId, status: 'active', checkpoints: [{ at: Date.now(), kind: 'handoff', text: handoffText, sourceRef: sourceName, goal: 'Exercise the unified facade.', state: 'Synthetic current state.', dead: '', next: 'Run the real WAL.' }] }], appliedOps: {} }
  await fs.writeFile(eventsPath, JSON.stringify(state, null, 2))
  const eventSink = new SyntheticEventSink(eventsPath)
  const system = new SystemClass({ rootDir: root, enabled, eventSink })
  return { root, handoffDir, eventsPath, eventSink, system }
}
async function seed(system) {
  const created = await system.documents.createDocument({ documentId: docId, title: 'Synthetic facade', eventIds: [eventId], content: 'before' })
  assert.equal(created.ok, true, JSON.stringify(created))
  return created
}
function update(created, after, opId) {
  return { documentId: docId, eventIds: [eventId], expectedRevision: created.revision, opId: 'r4op_' + opId, changeSet: [{ regionId: 'content', beforeText: created.content, afterText: after }] }
}
async function copyModuleTree(name, transform = (source) => source) {
  const root = path.resolve('artifacts', '_r4-m-mutation', name)
  const lib = path.join(root, 'lib')
  const moduleDir = path.join(lib, 'ledger-doc')
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(moduleDir, { recursive: true })
  for (const file of ['protocol.js', 'document-store.js', 'locked-store.js', 'material-stamp.js', 'history-query.js', 'coverage-audit.js', 'wal.js', 'index.js', 'system.js']) {
    const source = await fs.readFile(path.resolve('lib/ledger-doc', file), 'utf8')
    await fs.writeFile(path.join(moduleDir, file), file === 'system.js' || file === 'index.js' ? transform(source) : source)
  }
  for (const file of ['shared-state-lock.js', 'file-boundary.js']) await fs.copyFile(path.resolve('lib', file), path.join(lib, file))
  return { root, moduleDir }
}

console.log('=== Unified import and complete API contract ===')
await test('M-01 single index exports every public symbol from all seven modules', async () => {
  const modules = ['protocol', 'document-store', 'locked-store', 'material-stamp', 'history-query', 'coverage-audit', 'wal']
  const expected = new Set()
  for (const name of modules) for (const key of Object.keys(await import('../../lib/ledger-doc/' + name + '.js'))) expected.add(key)
  expected.add('LedgerDocSystem')
  assert.deepEqual(Object.keys(api).sort(), [...expected].sort())
  assert.equal(expected.size, 40)
})
await test('M-02 API contract documents every public class method and pure helper', async () => {
  const contract = await fs.readFile('docs/internal/LEDGER-DOC-API-CONTRACT.md', 'utf8')
  const classes = [api.LedgerDocumentStore, api.LockedLedgerDocumentStore, api.HandoffMaterialStamp, api.MaterialInvalidationBus, api.LedgerHistoryQuery, api.LedgerCoverageAuditor, api.LedgerWal, api.LedgerDocSystem]
  for (const Type of classes) {
    for (const name of Object.getOwnPropertyNames(Type.prototype)) {
      if (name === 'constructor' || name.startsWith('_')) continue
      if (typeof Object.getOwnPropertyDescriptor(Type.prototype, name).value === 'function') assert.ok(contract.includes(name + '('), Type.name + '.' + name)
    }
  }
  for (const name of ['normalizeLedgerForAudit', 'parseLedgerForAudit', 'queryHistory', 'parseHistoryTime', 'publishCommittedDocument', 'canonicalize', 'computeRevision', 'computeOperationDigest', 'computeLegacyCheckpointKey']) assert.ok(contract.includes(name))
})
await test('M-03 default construction and lifecycle are disabled with zero directory writes', async () => {
  const root = path.join(fixtureRoot, 'disabled')
  await fs.rm(root, { recursive: true, force: true })
  const system = new api.LedgerDocSystem({ rootDir: root })
  assert.equal(system.enabled, false)
  assert.equal(system.started, false)
  const started = await system.start()
  assert.deepEqual(started, { ok: true, enabled: false, started: false, state: 'disabled', noop: true })
  assert.equal((await system.stop()).stopped, true)
  assert.equal(await fs.stat(root).then(() => true, (error) => error.code === 'ENOENT'), true)
  assert.equal((await system.queryHistory({ from: '2026-11-01', to: '2026-11-12' })).error, 'ledger-doc-system-disabled')
  assert.equal((await system.upsertDocument({})).error, 'ledger-doc-system-disabled')
  assert.equal((await system.auditCoverage()).error, 'ledger-doc-system-disabled')
})
await test('M-04 invalid configuration rejects; valid alternative shapes succeed', async () => {
  assert.throws(() => new api.LedgerDocSystem({ rootDir: 'relative' }), /ledger-doc-root-invalid/)
  assert.throws(() => new api.LedgerDocSystem({ rootDir: process.cwd() }), /ledger-doc-root-invalid/)
  assert.throws(() => new api.LedgerDocSystem({ rootDir: path.resolve('artifacts', '_r4-m-fixtures', 'bad-enabled'), enabled: 1 }), /ledger-doc-enabled-invalid/)
  const root = await reset('unlocked')
  const system = new api.LedgerDocSystem({ rootDir: root, useLocks: false })
  assert.ok(system.documents instanceof api.LedgerDocumentStore)
  assert.equal(system.wal, null)
})
await test('M-05 enabled but not started rejects every operation before reading or writing', async () => {
  const { system, root } = await fixture('not-started')
  for (const result of [await system.upsertDocument({}), await system.queryHistory({}), await system.auditCoverage(), await system.reconcile()]) {
    assert.equal(result.ok, false)
    assert.equal(result.error, 'ledger-doc-system-not-started')
  }
  await fs.rm(root, { recursive: true, force: true })
})

console.log('=== Facade delegates to real modules and preserves shapes ===')
const active = await fixture('active')
await test('M-06 getters expose exact real module instances and start reconciles/preheats', async () => {
  const { system } = active
  assert.ok(system.documents instanceof api.LockedLedgerDocumentStore)
  assert.ok(system.stamp instanceof api.HandoffMaterialStamp)
  assert.ok(system.history instanceof api.LedgerHistoryQuery)
  assert.ok(system.audit instanceof api.LedgerCoverageAuditor)
  assert.ok(system.wal instanceof api.LedgerWal)
  assert.ok(system.invalidation instanceof api.MaterialInvalidationBus)
  const started = await system.start()
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.reconciliation.ok, true)
  assert.equal(started.stamp.complete, true)
  assert.equal(system.status().started, true)
  assert.equal((await system.start()).noop, true)
})
await test('M-07 upsertDocument executes real WAL and emits committed invalidation', async () => {
  const { system } = active
  active.seed = await seed(system)
  const notices = []
  system.invalidation.subscribe(system.handoffDir, (notice) => notices.push(notice))
  const result = await system.upsertDocument(update(active.seed, 'after', 'ab'.repeat(16)))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.phase, 3)
  assert.equal(result.documentCommitted, true)
  assert.equal(result.eventComplete, true)
  assert.equal(result.document.content, 'after')
  assert.equal(result.prepared.length, 1)
  assert.equal(result.committed.length, 1)
  assert.equal(notices.length, 1)
  assert.equal(notices[0].documentId, docId)
  assert.equal(notices[0].revision, result.document.revision)
  assert.equal(system.invalidation.version(system.handoffDir), 1)
  active.updated = result.document
})
await test('M-08 noop preserves document and CAS conflict can be reconciled explicitly', async () => {
  const { system } = active
  const noop = await system.upsertDocument({ documentId: docId, eventIds: [eventId], expectedRevision: active.updated.revision, opId: 'r4op_' + 'cd'.repeat(16), changeSet: [] })
  assert.equal(noop.ok, true, JSON.stringify(noop))
  assert.equal(noop.noop, true)
  assert.equal(noop.phase, 0)
  const current = await fixture('cas-conflict')
  assert.equal((await current.system.start()).ok, true)
  const created = await seed(current.system)
  const bad = update(created, 'must-not-write', 'ef'.repeat(16))
  bad.expectedRevision = 'sha256:' + '0'.repeat(64)
  const conflict = await current.system.upsertDocument(bad)
  assert.equal(conflict.ok, false)
  assert.equal(conflict.error, 'document-version-conflict')
  assert.equal(conflict.phase, 0)
  assert.equal((await current.system.documents.readDocument(docId)).revision, created.revision)
  const interrupted = update(created, 'recover-prepared-intent', '0123456789abcdef'.repeat(2))
  current.eventSink.failAppend({ eventId, phase: 'committed' })
  const partial = await current.system.upsertDocument(interrupted)
  assert.equal(partial.ok, false)
  assert.equal(partial.error, 'event-commit-failed')
  assert.equal(partial.documentCommitted, true)
  assert.equal((await current.system.documents.readDocument(docId)).content, 'recover-prepared-intent')
  await current.system.stop()
})
await test('M-09 queryHistory sees persisted committed checkpoint and raw fields', async () => {
  const day = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const result = await active.system.queryHistory({ from, to, eventId, kinds: ['wal-committed'], includeQuad: true })
  assert.equal(result.ok, true, JSON.stringify(result.readErrors))
  assert.equal(result.items.length, 1)
  assert.match(result.items[0].checkpointId, /^ckpt_[0-9a-f]{16}$/)
  assert.equal(result.items[0].kind, 'wal-committed')
  assert.equal(result.items[0].opId, 'r4op_' + 'ab'.repeat(16))
  assert.ok(result.items[0].at >= Date.parse(from + 'T00:00:00Z'))
  assert.ok(result.items[0].at < Date.parse(to + 'T00:00:00Z'))
  assert.equal(result.range.timeZone, 'UTC')
  assert.ok(day)
})
await test('M-10 auditCoverage runs real audit and returns summary/report shapes', async () => {
  const result = await active.system.auditCoverage({ relPaths: [sourceName] })
  assert.equal(result.ok, true, JSON.stringify(result.summary.errors))
  assert.equal(result.summary.inputFileCount, 1)
  assert.equal(result.summary.reportCount, 1)
  assert.equal(result.reports.length, 1)
  assert.equal(result.reports[0].source.relPath, sourceName)
  assert.equal(result.summary.eligibleForPhysicalDeleteCount, 0)
  assert.equal((await active.system.auditCoverage({ relPaths: [] })).summary.inputFileCount, 0)
})
await test('M-11 reconcile replays real sink without duplicating checkpoints', async () => {
  const before = await active.eventSink.listCheckpoints('r4op_' + 'ab'.repeat(16))
  const result = await active.system.reconcile()
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.count, 1)
  assert.equal(result.recovered, 1)
  assert.equal(result.attention, 0)
  assert.equal((await active.eventSink.listCheckpoints('r4op_' + 'ab'.repeat(16))).length, before.length)
})
await test('M-12 stop waits for pending WAL; restart is idempotent', async () => {
  const { system } = active
  const original = system._baseDocuments._writeCandidate.bind(system._baseDocuments)
  system._baseDocuments._writeCandidate = async (...args) => {
    await new Promise((resolve) => setTimeout(resolve, 40))
    return original(...args)
  }
  const pending = system.upsertDocument(update(active.updated, 'after-stop', '0123456789abcdef'.repeat(2)))
  const stopped = await system.stop()
  const result = await pending
  assert.equal(stopped.stopped, true)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.document.content, 'after-stop')
  assert.equal(system.started, false)
  active.updated = result.document
  const restarted = await system.start()
  assert.equal(restarted.ok, true, JSON.stringify(restarted))
  assert.equal(system.invalidation.version(system.handoffDir), 2)
  await system.stop()
})
await test('M-13 listener failure is visible as cache failure without document rollback', async () => {
  const current = await fixture('listener-failure')
  assert.equal((await current.system.start()).ok, true)
  const created = await seed(current.system)
  current.system.invalidation.subscribe(current.system.handoffDir, () => { throw new Error('synthetic listener failure') })
  const result = await current.system.upsertDocument(update(created, 'committed-despite-cache', 'bc'.repeat(16)))
  assert.equal(result.ok, false)
  assert.equal(result.error, 'cache-refresh-failed')
  assert.equal(result.documentCommitted, true)
  assert.equal(result.eventComplete, true)
  assert.equal((await current.system.documents.readDocument(docId)).content, 'committed-despite-cache')
  await current.system.stop()
})
await test('M-14 absent sink fails explicitly while other enabled modules remain usable', async () => {
  const root = await reset('no-sink')
  const system = new api.LedgerDocSystem({ rootDir: root, enabled: true })
  await fs.mkdir(path.join(root, 'handoff'), { recursive: true })
  await fs.writeFile(path.join(root, 'handoff', 'event-store.json'), JSON.stringify({ events: [], appliedOps: {} }))
  assert.equal(system.wal, null)
  assert.equal((await system.start()).ok, true)
  assert.equal((await system.upsertDocument({})).error, 'wal-not-configured')
  assert.equal((await system.reconcile()).error, 'wal-not-configured')
  const history = await system.queryHistory({ from: '2026-11-01', to: '2026-11-12' })
  assert.equal(history.ok, true, JSON.stringify(history.readErrors))
  assert.equal(history.items.length, 0)
  assert.equal((await system.auditCoverage({ relPaths: [] })).summary.inputFileCount, 0)
  await system.stop()
})
await test('M-15 start failure returns structured failure rather than false success', async () => {
  const root = await reset('start-failure')
  const failing = Object.create(fs)
  failing.mkdir = async () => { throw new Error('synthetic mkdir EACCES') }
  const system = new api.LedgerDocSystem({ rootDir: root, enabled: true, fs: failing })
  const result = await system.start()
  assert.equal(result.ok, false)
  assert.equal(result.error, 'ledger-doc-start-failed')
  assert.match(result.cause, /synthetic mkdir EACCES/)
  assert.equal(system.started, false)
  assert.equal((await system.stop()).stopped, true)
})

console.log('=== Isolated facade mutations and protected hashes ===')
{
  const copy = await copyModuleTree('history-disconnected', (source) => source.replace('get history() { return this._history }', 'get history() { return null }'))
  const current = await fixture('mutation-history', (await import(pathToFileURL(path.join(copy.moduleDir, 'system.js')).href)).LedgerDocSystem)
  let caught = false
  try { assert.ok(current.system.history instanceof api.LedgerHistoryQuery) } catch (_) { caught = true }
  await test('MUT-history-disconnected makes module reachability red', () => assert.equal(caught, true))
  evidence.push({ kind: 'mutation', name: 'history-disconnected', result: caught ? 'CAUGHT' : 'MISSED' })
}
{
  const copy = await copyModuleTree('wal-bypassed', (source) => source.replace('return this._track(() => this._wal.execute(args, this._notificationOptions(args?.opId ?? null)))', "return this._track(() => ({ ok: true, bypassed: true }))"))
  const current = await fixture('mutation-wal', (await import(pathToFileURL(path.join(copy.moduleDir, 'system.js')).href)).LedgerDocSystem)
  assert.equal((await current.system.start()).ok, true)
  const created = await seed(current.system)
  const result = await current.system.upsertDocument(update(created, 'mutant-not-written', 'de'.repeat(16)))
  let caught = false
  try { assert.equal(result.phase, 3); assert.equal(result.documentCommitted, true) } catch (_) { caught = true }
  await test('MUT-wal-bypassed makes real WAL operation red', () => assert.equal(caught, true))
  evidence.push({ kind: 'mutation', name: 'wal-bypassed', result: caught ? 'CAUGHT' : 'MISSED' })
  await current.system.stop()
}
{
  const copy = await copyModuleTree('index-omits-wal', (source) => source.replace("export { LedgerWal } from './wal.js'", ''))
  const mutant = await import(pathToFileURL(path.join(copy.moduleDir, 'index.js')).href)
  await test('MUT-index-omits-wal makes unified export red', () => assert.equal('LedgerWal' in mutant, false))
  evidence.push({ kind: 'mutation', name: 'index-omits-wal', result: 'LedgerWal' in mutant ? 'MISSED' : 'CAUGHT' })
}
{
  const copy = await copyModuleTree('restored')
  const { LedgerDocSystem: RestoredSystem, ...restoredApi } = await import(pathToFileURL(path.join(copy.moduleDir, 'index.js')).href)
  const current = await fixture('mutation-restored', RestoredSystem)
  assert.equal((await current.system.start()).ok, true)
  const created = await seed(current.system)
  const result = await current.system.upsertDocument(update(created, 'restored', 'fa'.repeat(16)))
  await test('MUT-restored unified index and real facade are green', async () => {
    assert.equal(result.ok, true)
    assert.equal(result.phase, 3)
    assert.equal(current.system.history instanceof restoredApi.LedgerHistoryQuery, true)
    assert.equal(Object.keys(restoredApi).length, 39)
    assert.equal((await current.system.stop()).stopped, true)
  })
  evidence.push({ kind: 'restored', result: result.ok ? 'GREEN' : 'RED' })
}
await test('M-16 every protected source hash is unchanged; new files use LF', async () => {
  for (const [file, hash] of initialHashes) assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash, file)
  for (const file of ['lib/ledger-doc/index.js', 'lib/ledger-doc/system.js', 'docs/internal/LEDGER-DOC-API-CONTRACT.md', 'tests/smoke/smoke-test-r4-system.mjs']) {
    const text = (await fs.readFile(file)).toString('latin1')
    assert.equal(/\r\n/.test(text) && /(?<!\r)\n/.test(text), false, file)
  }
})
const result = { pass, fail, failures, evidence }
await fs.mkdir(fixtureRoot, { recursive: true })
await fs.writeFile(path.join(fixtureRoot, 'test-results.json'), JSON.stringify(result, null, 2) + '\n')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((item) => item.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((item) => item.result === 'MISSED').length)
console.log('RESTORED ' + (evidence.find((item) => item.kind === 'restored')?.result || 'MISSING'))
process.exitCode = fail === 0 ? 0 : 1
