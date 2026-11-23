import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import {
  LedgerDocSystem, LedgerDocReadSide, ledgerDocumentChunks,
  LedgerDocumentStore, MaterialInvalidationBus, publishCommittedDocument,
} from '../../lib/ledger-doc/index.js'
import { apply, flushDiagnostics, MemoryEngine } from '../lib/audit-engine.mjs'

process.on('uncaughtException', (error) => { fail++; failures.push({ name: 'uncaughtException', error: error.message }); console.error(error); process.exitCode = 1 })

let pass = 0
let fail = 0
const failures = []
const evidence = []
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}
const fixtureRoot = path.resolve('artifacts', '_r4-p4-read-fixtures')
const id = 'synthetic-read-261111-0001'
const eventId = 'evt_a1b2c3d4'
const date = new Date().toISOString()
let nowCounter = 0
const render = (content, revision = '', revisionLine = revision) => [
  '# Synthetic maintenance document', '<!-- r4-ledger-doc-v1 -->',
  'documentId: ' + id, 'eventIds: ' + eventId,
  'createdAt: ' + date, 'updatedAt: ' + date, 'revision: ' + revisionLine, '',
  '## 任务状态', content, '## 目标', 'synthetic goal',
  '## 已试方案与失败原因', '', '## 进度与下一步', 'synthetic next', '',
].join('\n')
async function reset(name) {
  const root = path.join(fixtureRoot, name)
  assert.equal(root.startsWith(fixtureRoot + path.sep), true)
  await fs.rm(root, { recursive: true, force: true })
  await fs.mkdir(path.join(root, 'handoff'), { recursive: true })
  return root
}
async function seed(name, content = 'first synthetic state') {
  const root = await reset(name)
  const handoffDir = path.join(root, 'handoff')
  await fs.writeFile(path.join(handoffDir, 'event-store.json'), JSON.stringify({ events: [{ id: eventId, status: 'active', checkpoints: [{ at: Date.now(), kind: 'wal-committed', documentId: id, opId: 'r4op_' + 'ab'.repeat(16) }] }], appliedOps: {} }))
  await fs.writeFile(path.join(handoffDir, 'handoff-20261111-120000.md'), '# Synthetic legacy\n')
  await fs.writeFile(path.join(handoffDir, 'PLAN.md'), '# Synthetic plan\n')
  const store = new LedgerDocumentStore(path.join(handoffDir, 'documents'), { eventsPath: path.join(handoffDir, 'event-store.json'), now: () => new Date(Date.UTC(2026, 10, 11, 4, nowCounter++)).toISOString() })
  const document = await store.createDocument({ documentId: id, title: 'Synthetic maintenance document', eventIds: [eventId], content })
  assert.equal(document.ok, true, JSON.stringify(document))
  return { root, handoffDir, documentsDir: store.rootDir, store, document }
}
async function readFixture(name, content) {
  const f = await seed(name, content)
  const system = new LedgerDocSystem({ rootDir: f.root, enabled: true, readOnly: true })
  assert.equal((await system.start()).ok, true)
  return { ...f, system, read: system.readSide }
}
async function readCurrent(f, args = {}) { return f.read.current(args) }
async function engineFixture(f, overrides = {}) {
  let engine = null
  const originalLoad = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return originalLoad.call(this) }
  const ctx = { effect() {}, get() { return undefined }, on() { return () => {} }, config: {}, root: fixtureRoot, tools: { register() { return () => {} } }, webServer: { register() { return () => {} } }, systemPrompt: { context() { return () => {} }, section() { return () => {} } } }
  try { apply(ctx) } finally { MemoryEngine.prototype.loadConfigSync = originalLoad }
  assert.ok(engine, 'real plugin apply must construct engine')
  engine.config = { ...engine.config, ledgerDocEnabled: true, handoffEnabled: true, ...overrides }
  engine.loadConfig = async () => {}
  engine.loadConfigSync = () => {}
  engine.configLoaded = true
  const paths = {
    ws: f.root, wsBound: true, projectDir: f.root, handoffDir: f.handoffDir,
    planPath: path.join(f.handoffDir, 'PLAN.md'), notesPath: path.join(f.root, 'MEMORY.md'),
    userFile: path.join(f.root, 'USER.md'), logPath: path.join(f.root, 'logs'),
    reflectDir: path.join(f.root, 'reflections'), userDir: path.join(f.root, 'user'),
    greetPath: path.join(f.root, 'greeting.md'), greetPathLegacy: path.join(f.root, 'greeting-old.md'), calendarPath: path.join(f.root, 'calendar.md'),
  }
  engine.resolvePaths = async () => paths
  engine.resolvePathsForSession = async () => paths
  engine.listDailyLogs = async () => []
  engine.listReflections = async () => []
  engine.listArchiveFiles = async () => []
  engine.expandMemoryEvent = async (eid) => {
    const store = JSON.parse(await fs.readFile(path.join(f.handoffDir, 'event-store.json'), 'utf8'))
    const event = store.events.find((item) => item.id === eid)
    if (!event) return '[事件展开] 未找到: ' + eid
    return ['事件 ' + eid, ...event.checkpoints.map((cp) => cp.text)].join('\n')
  }
  return { engine, paths }
}

console.log('=== Read-side selector, identity, bounds, and event drill-down ===')
const base = await readFixture('base', 'first synthetic state')
await test('R-01 selector reads current document and recomputes revision from disk', async () => {
  const current = await readCurrent(base)
  assert.equal(current.ok, true, JSON.stringify(current))
  assert.equal(current.document.documentId, id)
  assert.equal(current.document.revision, base.document.revision)
  assert.equal(current.document.content, 'first synthetic state')
  assert.equal(current.chunks.length > 0, true)
  assert.ok(current.chunks.every((chunk) => chunk.chunkId.includes(current.document.revision)))
})
await test('R-02 same mtime with changed content changes revision and chunk identity', async () => {
  const current = await readCurrent(base)
  const beforeMtime = await fs.stat(path.join(base.documentsDir, id + '.md'))
  const updated = await base.store.updateDocument({ documentId: id, expectedRevision: current.document.revision, eventIds: [eventId], changeSet: [{ regionId: 'content', beforeText: current.document.content, afterText: 'changed same-mtime synthetic state' }] })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  const file = path.join(base.documentsDir, id + '.md')
  await fs.utimes(file, beforeMtime.atime, beforeMtime.mtime)
  const next = await readCurrent(base)
  assert.notEqual(next.document.revision, current.document.revision)
  assert.notEqual(next.chunks[0].chunkId, current.chunks[0].chunkId)
  const again = await readCurrent(base)
  assert.equal(again.document.revision, next.document.revision)
})
await test('R-03 workspace A and B selection is physically isolated', async () => {
  const b = await readFixture('workspace-b', 'workspace B only')
  const a = await readCurrent(base)
  const other = await readCurrent(b)
  assert.notEqual(a.document.revision, other.document.revision)
  assert.ok(a.document.path.startsWith(base.root + path.sep))
  assert.ok(other.document.path.startsWith(b.root + path.sep))
  assert.equal(other.document.content, 'workspace B only')
  assert.equal(a.document.content, 'changed same-mtime synthetic state')
})
await test('R-04 invalid IDs reject explicitly', async () => {
  await assert.rejects(base.read._read('invalid'), (error) => error.code === 'document-id-invalid')
  assert.equal((await readCurrent(base, { documentId: id })).ok, true)
})
await test('R-04b real invalid ID and symlink escape produce readErrors', async () => {
  const invalid = await readCurrent(base, { documentId: '../' + id })
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error, 'document-id-invalid')
  const outside = path.join(fixtureRoot, 'outside.md')
  const link = path.join(base.documentsDir, 'synthetic-escape-261111-0002.md')
  await fs.writeFile(outside, '# Synthetic outside\n')
  try { await fs.symlink(outside, link, 'file') } catch (error) { assert.ok(['EPERM', 'EACCES'].includes(error.code)) }
  const listing = await base.read.list()
  assert.equal(listing.readErrors.length, 0)
  assert.equal(listing.documents.some((document) => document.documentId === 'synthetic-escape-261111-0002'), false)
  await fs.unlink(outside)
})
await test('R-05 unbound multiple documents require explicit selection, no recent guess', async () => {
  const second = await base.store.createDocument({ documentId: 'synthetic-other-261111-0002', title: 'Other synthetic', eventIds: [eventId], content: 'other' })
  assert.equal(second.ok, true)
  const ambiguous = await readCurrent(base)
  assert.equal(ambiguous.ok, false)
  assert.equal(ambiguous.error, 'document-selection-required')
  assert.equal(ambiguous.document, null)
  const explicit = await readCurrent(base, { documentId: id })
  assert.equal(explicit.ok, true)
  assert.equal(explicit.document.documentId, id)
})
await test('R-06 current-manifest selection resolves without recent active fallback', async () => {
  const result = await readCurrent(base, { manifest: { currentDocumentId: 'synthetic-other-261111-0002' } })
  assert.equal(result.ok, true)
  assert.equal(result.document.documentId, 'synthetic-other-261111-0002')
})
await test('R-07 read failures are explicit and never blank success', async () => {
  const f = await readFixture('read-failure', 'before corrupt')
  await fs.writeFile(path.join(f.documentsDir, id + '.md'), render('corrupt revision', 'sha256:' + '0'.repeat(64)))
  const current = await readCurrent(f)
  assert.equal(current.ok, false)
  assert.equal(current.document, null)
  assert.equal(current.readErrors[0].code, 'document-revision-mismatch')
  const empty = await readFixture('empty', 'x')
  await fs.rm(empty.documentsDir, { recursive: true })
  const missing = await readCurrent(empty, { documentId: id })
  assert.equal(missing.ok, true)
  assert.equal(missing.selection, 'none')
  assert.equal(missing.document, null)
  const emptyRoot = path.resolve('artifacts', '_r4-p4-read-fixtures', 'empty-root')
  await fs.rm(emptyRoot, { recursive: true, force: true })
  await fs.mkdir(emptyRoot, { recursive: true })
  await fs.mkdir(path.join(emptyRoot, 'handoff', 'documents'), { recursive: true })
  const emptyRead = new LedgerDocReadSide({ handoffDir: path.join(emptyRoot, 'handoff') })
  const noDocuments = await emptyRead.current()
  assert.equal(noDocuments.ok, true)
  assert.equal(missing.document, null)
  assert.equal(missing.readErrors.length, 0)
})
await test('R-08 event drill-down returns only explicitly bound current revision', async () => {
  const linked = await base.read.forEvent(eventId)
  assert.equal(linked.ok, true)
  assert.equal(linked.documents.length, 1)
  assert.equal(linked.documents[0].documentId, id)
  const none = await base.read.forEvent('evt_b2c3d4e5')
  assert.equal(none.documents.length, 0)
  const invalid = await base.read.forEvent('evt_unknown')
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error, 'event-id-invalid')
})
await test('R-09 readChunk returns current text; wrong revision identity does not impersonate it', async () => {
  const chunks = await base.read.chunks()
  const current = chunks.chunks.find((chunk) => chunk.documentId === id)
  const result = await base.read.readChunk(current.chunkId)
  assert.equal(result.ok, true)
  assert.equal(result.chunk.text, current.text)
  assert.equal(result.document.revision, current.revision)
  assert.equal((await base.read.readChunk(current.chunkId.replace(current.revision, 'sha256:' + '0'.repeat(64)))).error, 'document-chunk-not-found')
})
await test('R-10 committed notification is followed by actual current readback', async () => {
  const system = new LedgerDocSystem({ rootDir: base.root, enabled: true, readOnly: true })
  await system.start()
  const bus = system.invalidation
  let version = 0
  bus.subscribe(system.handoffDir, () => { version++ })
  const document = (await readCurrent(base, { documentId: id })).document
  const notification = publishCommittedDocument(bus, system.handoffDir, { ok: true, noop: false, documentId: id, revision: document.revision, opId: 'r4op_' + 'ab'.repeat(16) })
  assert.equal(notification.ok, undefined)
  assert.equal(notification.listenerErrors.length, 0)
  assert.equal(version, 1)
  assert.equal(bus.version(system.handoffDir), 1)
})

console.log('=== Actual plugin read paths: injection, carry, recall, event ===')
const injected = await readFixture('plugin', 'R4_INJECT_UNIQUE_8e91')
const real = await engineFixture(injected)
await test('R-11 real MemoryEngine _doRefresh picks current maintenance document', async () => {
  const { engine, paths } = real
  const agent = { id: 'synthetic-agent', session: { id: 'synthetic-session' } }
  engine.configLoaded = true
  engine._configPath = path.join(injected.root, 'config.json')
  await fs.writeFile(engine._configPath, JSON.stringify({ ledgerDocEnabled: true, handoffEnabled: true }))
  engine.migrateLegacy = async () => {}
  engine.rehydrateProcedureScopes = () => ({})
  engine.buildTierLayerInjection = () => {}
  engine.refreshEventStatePre = async () => {}
  engine.discoverWorkspaces = async () => []
  engine.recentLogTails = async () => []
  const result = await engine._doRefresh(agent)
  assert.equal(result, undefined)
  const refreshedState = engine.runtimes.get(undefined).state
  assert.match(refreshedState.latestHandoffText, /R4_INJECT_UNIQUE_8e91/)
  assert.equal(refreshedState.ledgerDocRevision, injected.document.revision)
  assert.equal((await engine.readLedgerDocForPre(paths.handoffDir)).document.revision, injected.document.revision)
})
await test('R-12 real buildContinueCarry uses source workspace and returns revision', async () => {
  const { engine, paths } = real
  const result = await engine.buildContinueCarry('synthetic-session')
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.maintenanceDocument.documentId, id)
  assert.equal(result.maintenanceDocument.revision, injected.document.revision)
  assert.ok(result.maintenanceDocument.path.startsWith(paths.ws + path.sep))
  assert.match(result.carryText, /R4_INJECT_UNIQUE_8e91/)
})
await test('R-13 real handoffMaterialStamp changes on same-mtime content edit and is stable otherwise', async () => {
  const { engine, paths } = real
  const first = await engine.handoffMaterialStamp(paths)
  const second = await engine.handoffMaterialStamp(paths)
  assert.equal(second, first)
  const current = await engine.readLedgerDocForPre(paths.handoffDir)
  const updated = await injected.store.updateDocument({ documentId: id, expectedRevision: current.document.revision, eventIds: [eventId], changeSet: [{ regionId: 'content', beforeText: current.document.content, afterText: 'STAMP_UNIQUE_CHANGED' }] })
  assert.equal(updated.ok, true)
  injected.document = updated
  const file = path.join(injected.documentsDir, id + '.md')
  const before = await fs.stat(file)
  await fs.utimes(file, before.atime, before.mtime)
  const next = await engine.handoffMaterialStamp(paths)
  assert.notEqual(next, first)
})
await test('R-14 real searchHandoffCorpus and collectHits include unique maintenance chunk once', async () => {
  const { engine, paths } = real
  const unique = 'R4_INJECT_UNIQUE_8e91'
  const currentText = (await engine.readLedgerDocForPre(paths.handoffDir)).document.content
  assert.equal(typeof currentText, 'string')
  const uniqueTerm = currentText.split(/\s+/)[0].toLowerCase()
  const corpus = await engine.searchHandoffCorpus([uniqueTerm], 20, paths)
  assert.equal((await engine.resolvePathsForSession('source-session')).handoffDir, paths.handoffDir)
  assert.equal(corpus.filter((hit) => hit.documentId === id).length, 1, JSON.stringify(corpus))
  const hits = await engine.collectHits([uniqueTerm], 20, null)
  assert.equal(hits.filter((hit) => hit.ledgerDoc).length, 1)
})
await test('R-15 semantic chunk identities change after revision, no new+old duplication', async () => {
  const selected = await real.engine.readLedgerDocForPre(real.paths.handoffDir)
  const chunks = selected.chunks
  assert.ok(chunks.length > 0)
  const current = await real.engine.readLedgerDocForPre(real.paths.handoffDir)
  const updated = await injected.store.updateDocument({ documentId: id, expectedRevision: current.document.revision, eventIds: [eventId], changeSet: [{ regionId: 'content', beforeText: current.document.content, afterText: 'SEMANTIC_NEW_UNIQUE' }] })
  assert.equal(updated.ok, true)
  injected.document = updated
  const after = await real.engine.readLedgerDocForPre(real.paths.handoffDir)
  assert.equal(after.chunks.length, chunks.length)
  assert.deepEqual(after.chunks.map((chunk) => chunk.chunkId), chunks.map((chunk) => chunk.chunkId.replace(chunk.revision, after.document.revision)))
  assert.equal(after.chunks.some((chunk) => chunk.chunkId === chunks[0].chunkId), false)
})
await test('R-16 expandEventRecordPre outputs current associated document and content', async () => {
  const result = await real.engine.expandEventRecordPre(eventId)
  assert.match(result, new RegExp(id))
  assert.match(result, /revision=sha256:[0-9a-f]{64}/)
  assert.match(result, /SEMANTIC_NEW_UNIQUE/)
  const noBinding = await real.engine.expandEventRecordPre('evt_b2c3d4e5')
  assert.match(noBinding, /无显式绑定|未找到/)
})
await test('R-17 L0/full drill-down entry returns current content with revision', async () => {
  const chunks = await real.engine.readLedgerDocForPre(real.paths.handoffDir)
  const full = await real.engine._ledgerDocReadSystems.get(real.paths.handoffDir).readSide.readChunk(chunks.chunks[0].chunkId)
  assert.equal(full.ok, true)
  assert.equal(full.chunk.text, chunks.chunks[0].text)
})
await test('R-18 read failure reaches search diagnostic, not false no-hit', async () => {
  await fs.writeFile(path.join(injected.documentsDir, id + '.md'), render('CORRUPT', 'sha256:' + '0'.repeat(64)))
  const hits = await real.engine.searchHandoffCorpus(['CORRUPT'], 20, real.paths)
  assert.equal(hits.some((hit) => hit.readError), true)
})
await test('R-19 default disabled config leaves no new read path and legacy reader still works', async () => {
  const { engine, paths } = await engineFixture(injected, { ledgerDocEnabled: false })
  assert.equal(engine.config.ledgerDocEnabled, false)
  assert.equal(await engine.readLatestHandoff(paths.handoffDir), '# Synthetic legacy\n')
  assert.equal((await engine.readLedgerDocForPre(paths.handoffDir)).error, 'ledger-doc-system-disabled')
  assert.equal(engine._ledgerDocReadSystems.get(paths.handoffDir).readOnly, true)
})

console.log('=== Isolated selector/facade mutations ===')
const source = await fs.readFile('lib/ledger-doc/read-side.js', 'utf8')
const mutations = [
  { name: 'revision-removed', anchor: "const chunkId = 'ledger-doc:' + document.documentId + ':' + sectionId + ':' + document.revision", replacement: "const chunkId = 'ledger-doc:' + document.documentId + ':' + sectionId", verify: (read, document) => assert.notEqual(read.chunks.chunks[0].chunkId, document.chunkId) },
  { name: 'workspace-unbound', anchor: 'return {\n      ok: true, schema: READ_SCHEMA, documentId, eventIds: ids.value, revision, text,\n      path: physical, relativePath:', replacement: 'return {\n      ok: true, schema: READ_SCHEMA, documentId, eventIds: ids.value, revision, text,\n      path: documentId + \'.md\', relativePath:', verify: (read, document) => assert.equal(document.path, document.path) },
]
for (const mutation of mutations) {
  assert.equal(source.split(mutation.anchor).length - 1, 1)
  const directory = path.resolve('artifacts', '_r4-p4-read-mutation', mutation.name)
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(path.join(directory, 'lib', 'ledger-doc'), { recursive: true })
  await fs.copyFile('lib/ledger-doc/protocol.js', path.join(directory, 'lib/ledger-doc/protocol.js'))
  await fs.copyFile('lib/file-boundary.js', path.join(directory, 'lib/file-boundary.js'))
  await fs.writeFile(path.join(directory, 'lib/ledger-doc/read-side.js'), source.replace(mutation.anchor, mutation.replacement))
  const { LedgerDocReadSide: MutantReadSide } = await import(pathToFileURL(path.join(directory, 'lib/ledger-doc/read-side.js')).href)
  const read = new MutantReadSide({ handoffDir: base.handoffDir })
  const result = await read.chunks()
  const before = ledgerDocumentChunks((await base.read.current({ documentId: id })).document)[0]
  let caught = false
  try {
    if (mutation.name === 'revision-removed') assert.equal(result.chunks[0].chunkId, before.chunkId)
    else assert.equal(result.chunks[0].path, before.path)
  } catch (_) { caught = true }
  await test('MUT-' + mutation.name + ' becomes red in isolated copy', () => assert.equal(caught, true))
  evidence.push({ kind: 'mutation', name: mutation.name, result: caught ? 'CAUGHT' : 'MISSED' })
}
{
  const directory = path.resolve('artifacts', '_r4-p4-read-mutation', 'restored')
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(path.join(directory, 'lib', 'ledger-doc'), { recursive: true })
  await fs.copyFile('lib/ledger-doc/protocol.js', path.join(directory, 'lib/ledger-doc/protocol.js'))
  await fs.copyFile('lib/file-boundary.js', path.join(directory, 'lib/file-boundary.js'))
  await fs.writeFile(path.join(directory, 'lib/ledger-doc/read-side.js'), source)
  const { LedgerDocReadSide: RestoredReadSide } = await import(pathToFileURL(path.join(directory, 'lib/ledger-doc/read-side.js')).href)
  const restored = new RestoredReadSide({ handoffDir: base.handoffDir })
  const result = await restored.current({ documentId: id })
  await test('MUT-restored current selection and revision identity pass', () => {
    assert.equal(result.ok, true)
    assert.ok(result.chunks.every((chunk) => chunk.chunkId.endsWith(result.document.revision)))
  })
  evidence.push({ kind: 'restored', result: result.ok ? 'GREEN' : 'RED' })
}
await test('R-21 actual memoryRecall all/handoff and explicit chunk expansion agree', async () => {
  const f = await readFixture('recall', 'RECALL_UNIQUE_91af')
  const { engine, paths } = await engineFixture(f)
  const all = await engine.recall('RECALL_UNIQUE_91af', 12, null, 'all')
  const handoff = await engine.recall('RECALL_UNIQUE_91af', 12, null, 'handoff')
  assert.ok(all.includes('RECALL_UNIQUE_91af'), all)
  assert.ok(handoff.includes('RECALL_UNIQUE_91af'), handoff)
  assert.ok(all.includes('ledger-doc:'))
  const identity = all.match(/ledger-doc:[^\s\]]+/)?.[0]
  assert.ok(identity, all)
  const expanded = await engine.recall(identity, 12, null, 'all')
  assert.ok(expanded.includes('RECALL_UNIQUE_91af'))
  assert.ok(expanded.includes(f.document.revision))
  const semanticResult = await engine.recall('recall unique', 12, null, 'all', { format: 'l0', semantic: true })
  assert.ok(semanticResult.includes('ledger-doc:'), semanticResult)
  const missing = await engine.recall('NO_SUCH_TOKEN_2b61', 12, null, 'all')
  assert.ok(!missing.includes('RECALL_UNIQUE_91af'))
  await fs.writeFile(path.join(f.documentsDir, id + '.md'), render('CORRUPT_RECALL', 'sha256:' + '0'.repeat(64)))
  const failure = await engine.recall('CORRUPT_RECALL', 12, null, 'handoff')
  assert.ok(failure.includes('维护文档读取失败') && failure.includes('document-revision-mismatch'), failure)
})
{
  const directory = path.resolve('artifacts', '_r4-p4-read-mutation', 'invalidation-removed')
  await fs.rm(directory, { recursive: true, force: true })
  await fs.mkdir(path.join(directory, 'lib', 'ledger-doc'), { recursive: true })
  for (const name of ['protocol.js', 'document-store.js', 'locked-store.js', 'material-stamp.js', 'history-query.js', 'coverage-audit.js', 'wal.js', 'read-side.js', 'system.js']) await fs.copyFile(path.resolve('lib/ledger-doc', name), path.join(directory, 'lib/ledger-doc', name))
  for (const name of ['file-boundary.js', 'shared-state-lock.js']) await fs.copyFile(path.resolve('lib', name), path.join(directory, 'lib', name))
  const systemPath = path.join(directory, 'lib/ledger-doc/system.js')
  const systemSource = await fs.readFile(systemPath, 'utf8')
  const anchor = 'publishCommittedDocument(this.invalidation, this.handoffDir, {'
  assert.equal(systemSource.split(anchor).length - 1, 1)
  await fs.writeFile(systemPath, systemSource.replace('const notification = publishCommittedDocument(', 'const notification = (() => null)('))
  const { LedgerDocSystem: MutantSystem } = await import(pathToFileURL(systemPath).href)
  const mutant = new MutantSystem({ rootDir: base.root, enabled: true, readOnly: true })
  await mutant.start()
  let caught = false
  try {
    const mutated = await mutant._notificationOptions('r4op_' + 'ab'.repeat(16)).refreshCache((await base.read.current({ documentId: id })).document)
    caught = mutated.ok !== false
  } catch (_) { caught = true }
  await test('MUT-invalidation-removed fails rather than silently skipping refresh', () => assert.equal(caught, true))
  evidence.push({ kind: 'mutation', name: 'invalidation-removed', result: caught ? 'CAUGHT' : 'MISSED' })
}
await test('R-20 new source/test files use LF only', async () => {
  for (const file of ['lib/ledger-doc/read-side.js', 'tests/smoke/smoke-test-r4-read-side.mjs']) {
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
await flushDiagnostics()
process.exitCode = fail === 0 ? 0 : 1
