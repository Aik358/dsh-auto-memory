import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { LedgerDocBriefScanner } from '../../lib/ledger-doc/brief-scan.js'
import { diffBriefPre, buildDraftPre, renderBriefPre } from '../../lib/global-brief.js'
import { scanUnarchivedLedgersPre } from '../../lib/event-plan.js'
import {
  P43_DOC_ID, P43_MUTATION_ROOT, createP43Fixture, makeP43Engine, updateP43Document,
} from './_r4-p4-3-fixtures.mjs'

let pass = 0
let fail = 0
const failures = []
const mutations = []
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}
const keyOf = (engine) => engine.wsKey(engine.state.ws)

console.log('=== Revision fingerprints and bounded scanner ===')
const base = await createP43Fixture('base')
const scanner = new LedgerDocBriefScanner({ handoffDir: base.handoffDir })
const scanned = scanner.scan()
await test('S-01 scanner returns protocol metadata without正文 and physically bound paths', () => {
  assert.equal(scanned.ok, true, JSON.stringify(scanned.readErrors))
  assert.equal(scanned.documents.length, 1)
  const document = scanned.documents[0]
  assert.equal(document.documentId, P43_DOC_ID)
  assert.equal(document.revision, base.document.revision)
  assert.equal(document.relativePath, 'handoff/documents/' + P43_DOC_ID + '.md')
  assert.equal(Object.hasOwn(document, 'text'), false)
  assert.ok(document.path.startsWith(base.handoffDir + path.sep))
})
const entries = scanned.documents.map((document) => ({ path: document.path, size: document.size, mtimeMs: document.mtimeMs, documentId: document.documentId, revision: document.revision, source: 'workspace' }))
const baseline = diffBriefPre({ previous: null, entries, isSelfWrite: () => false })
await test('S-02 mtime-only change with identical revision produces no external change', () => {
  const touched = entries.map((entry) => ({ ...entry, mtimeMs: entry.mtimeMs + 9999 }))
  const result = diffBriefPre({ previous: baseline.next, entries: touched, isSelfWrite: () => false })
  assert.equal(result.changed.length, 0)
})
const externallyUpdated = await updateP43Document(base, 'external revision with preserved mtime', { preserveMtime: true })
const updatedEntries = [{ ...entries[0], revision: externallyUpdated.revision }]
const changed = diffBriefPre({ previous: baseline.next, entries: updatedEntries, isSelfWrite: () => false })
await test('S-03 same-mtime content update emits documentId and current revision metadata', () => {
  assert.equal(changed.changed.length, 1)
  assert.equal(changed.changed[0].documentId, P43_DOC_ID)
  assert.equal(changed.changed[0].revision, externallyUpdated.revision)
  const draft = buildDraftPre({ changed: changed.changed })
  assert.equal(draft.headlines[0].revision, externallyUpdated.revision)
  assert.ok(draft.headlines[0].text.includes(P43_DOC_ID))
  assert.ok(draft.headlines[0].text.includes(base.documentsDir))
  assert.ok(renderBriefPre({ draft }).includes('维护文档按 revision 比较'))
})
await test('S-04 committed revision is suppressed, later external revision is still detected', () => {
  const self = diffBriefPre({ previous: baseline.next, entries: updatedEntries, isSelfWrite: (p, entry) => entry.revision === externallyUpdated.revision })
  assert.equal(self.changed.length, 0)
  assert.equal(self.counts.skippedSelf, 1)
  const later = diffBriefPre({ previous: self.next, entries: [{ ...updatedEntries[0], revision: 'sha256:' + 'f'.repeat(64) }], isSelfWrite: (p, entry) => entry.revision === externallyUpdated.revision })
  assert.equal(later.changed.length, 1)
})
await test('S-05 first read error is explicit instead of an empty/no-change result', () => {
  const errorEntry = [{ path: path.join(base.documentsDir, 'bad.md'), size: 0, mtimeMs: 0, errorCode: 'document-id-invalid', source: 'workspace' }]
  const result = diffBriefPre({ previous: null, entries: errorEntry, isSelfWrite: () => false })
  assert.equal(result.changed.length, 1)
  assert.equal(result.changed[0].kind, 'error')
  assert.ok(buildDraftPre({ changed: result.changed }).headlines[0].text.includes('读取失败'))
})
await test('S-06 invalid ID, bounded list, and symlink escape become readErrors', async () => {
  await fs.writeFile(path.join(base.documentsDir, 'invalid.md'), '# invalid id\n')
  const second = await base.store.createDocument({ documentId: 'r4p43-second-261111-0002', title: 'Second synthetic', eventIds: base.document.eventIds, content: 'second' })
  assert.equal(second.ok, true)
  const outside = path.join(base.root, 'outside.md')
  await fs.writeFile(outside, '# outside\n')
  const link = path.join(base.documentsDir, 'r4p43-escape-261111-0003.md')
  await fs.symlink(outside, link, 'file')
  const result = new LedgerDocBriefScanner({ handoffDir: base.handoffDir, limit: 3 }).scan()
  assert.equal(result.ok, false)
  assert.equal(result.truncated >= 1, true)
  assert.ok(result.readErrors.some((item) => item.code === 'document-id-invalid'))
  assert.ok(result.readErrors.some((item) => item.code === 'document-path-invalid'))
  assert.ok(result.documents.every((document) => !document.path.includes('outside.md')))
  assert.equal(new LedgerDocBriefScanner({ handoffDir: base.handoffDir }).scan().documents.every((document) => Object.hasOwn(document, 'text') === false), true)
})

console.log('=== Real MemoryEngine brief assembly ===')
const engineFixture = await createP43Fixture('engine')
const engine = await makeP43Engine(engineFixture)
await test('B-01 first baseline exposes current revision metadata without external-change noise', () => {
  assert.equal(engine.external.briefDetectSyncPre(), '')
  const snapshot = engine._briefSnapshots.get(keyOf(engine))
  assert.equal(snapshot.maintenanceDocuments.length, 1)
  assert.equal(snapshot.maintenanceDocuments[0].revision, engineFixture.document.revision)
  assert.equal(snapshot.changed.length, 0)
  assert.equal(snapshot.readErrors.length, 0)
})
await test('B-02 external mtime-only touch remains silent', async () => {
  const file = path.join(engineFixture.documentsDir, P43_DOC_ID + '.md')
  const stat = await fs.stat(file)
  await fs.utimes(file, stat.atime, new Date(stat.mtimeMs + 5000))
  assert.equal(engine.external.briefDetectSyncPre(), '')
})
let committed
await test('B-03 same-process committed uses invalidation readback and is not external', async () => {
  committed = await updateP43Document(engineFixture, 'same-process committed content')
  const system = engine.ledgerDocSystemForPre(engineFixture.handoffDir)
  assert.equal((await system.start()).ok, true)
  const result = await system._notificationOptions('r4op_' + 'cd'.repeat(16)).refreshCache(committed)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(system.lastCommittedDocument.revision, committed.revision)
  assert.equal(engine.external.briefDetectSyncPre(), '')
  const snapshot = engine._briefSnapshots.get(keyOf(engine))
  assert.equal(snapshot.maintenanceDocuments[0].revision, committed.revision)
  assert.equal(snapshot.changed.length, 0)
})
let external
await test('B-04 later external content change refreshes revision and brief metadata', async () => {
  external = await updateP43Document(engineFixture, 'other-process content with same mtime', { preserveMtime: true })
  const text = engine.external.briefDetectSyncPre()
  assert.ok(text.includes(P43_DOC_ID), text)
  assert.ok(text.includes('维护文档按 revision 比较'), text)
  assert.notEqual(external.revision, committed.revision)
  const snapshot = engine._briefSnapshots.get(keyOf(engine))
  assert.equal(snapshot.maintenanceDocuments[0].revision, external.revision)
  assert.equal(snapshot.changed[0].revision, external.revision)
  assert.equal(snapshot.changed[0].documentId, P43_DOC_ID)
  assert.ok(!text.includes('other-process content with same mtime'))
})
await test('B-05 invalid maintenance document emits bounded readErrors and failure headline', async () => {
  await fs.writeFile(path.join(engineFixture.documentsDir, 'invalid.md'), '# invalid id\n')
  const text = engine.external.briefDetectSyncPre()
  const snapshot = engine._briefSnapshots.get(keyOf(engine))
  assert.ok(text.includes('读取失败'), text)
  assert.ok(snapshot.readErrors.some((item) => item.code === 'document-id-invalid'))
})
await test('B-06 unbound workspace and default-disabled R4 produce zero new scanner/output', async () => {
  const disabledFixture = await createP43Fixture('disabled')
  const disabled = await makeP43Engine(disabledFixture, { ledgerDocEnabled: false })
  assert.equal(disabled.external.briefDetectSyncPre(), '')
  assert.equal(disabled.external.briefDetectSyncPre(), '')
  assert.equal(disabled._ledgerDocBriefScanners, undefined)
  const snap = disabled._briefSnapshots.get(keyOf(disabled))
  assert.equal(Object.hasOwn(snap, 'maintenanceDocuments'), false)
  assert.equal(Object.hasOwn(snap, 'readErrors'), false)
  disabled.state.ws = ''
  assert.equal(disabled.external.briefDetectSyncPre(), '')
})
await test('B-07 another workspace has independent baseline and revision', async () => {
  const otherFixture = await createP43Fixture('workspace-b', { content: 'workspace B body' })
  const other = await makeP43Engine(otherFixture)
  assert.equal(other.external.briefDetectSyncPre(), '')
  const snapshot = other._briefSnapshots.get(keyOf(other))
  assert.equal(snapshot.maintenanceDocuments[0].revision, otherFixture.document.revision)
  assert.notEqual(snapshot.maintenanceDocuments[0].revision, external.revision)
  assert.equal(snapshot.changed.length, 0)
})

console.log('=== Legacy regroup-only scan and physical read errors ===')
const scanFixture = await createP43Fixture('scan')
const scanEngine = await makeP43Engine(scanFixture)
await test('L-01 maintenance document is independent; legacy handoff remains sole candidate', async () => {
  const result = await scanEngine.listUnarchivedPre({ paths: { handoffDir: scanFixture.handoffDir }, limit: 50 })
  assert.equal(result.ok, true, JSON.stringify(result.readErrors))
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].name, 'handoff-20261111-120000.md')
  assert.equal(result.maintenanceDocuments.length, 1)
  assert.equal(result.maintenanceDocuments[0].documentId, P43_DOC_ID)
  assert.ok(result.items.every((item) => !item.rel.includes('/documents/')))
  assert.equal(result.maintenanceState, 'present')
})
await test('L-02 default-disabled return shape and legacy scan behavior stay unchanged', async () => {
  const off = await makeP43Engine(scanFixture, { ledgerDocEnabled: false })
  const result = await off.listUnarchivedPre({ paths: { handoffDir: scanFixture.handoffDir }, limit: 50 })
  assert.equal(result.items.length, 1)
  assert.equal(Object.hasOwn(result, 'maintenanceDocuments'), false)
  assert.equal(Object.hasOwn(result, 'readErrors'), false)
  const scan = await scanUnarchivedLedgersPre({ dir: scanFixture.handoffDir })
  assert.equal(scan.total, 1)
  assert.equal(Object.hasOwn(scan, 'readErrors'), false)
})
await test('L-03 invalid document and both document/legacy symlink escapes are visible', async () => {
  await fs.writeFile(path.join(scanFixture.documentsDir, 'invalid.md'), '# invalid\n')
  const outside = path.join(scanFixture.root, 'outside.md')
  await fs.writeFile(outside, '# outside\n')
  await fs.symlink(outside, path.join(scanFixture.documentsDir, 'r4p43-escape-261111-0003.md'), 'file')
  await fs.symlink(outside, path.join(scanFixture.handoffDir, 'handoff-20261111-120001.md'), 'file')
  const result = await scanEngine.listUnarchivedPre({ paths: { handoffDir: scanFixture.handoffDir }, limit: 50 })
  assert.equal(result.ok, false)
  assert.ok(result.readErrors.some((item) => item.code === 'document-id-invalid'))
  assert.ok(result.readErrors.some((item) => item.code === 'document-path-invalid'))
  assert.ok(result.readErrors.some((item) => item.code === 'ledger-path-invalid'))
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].name, 'handoff-20261111-120000.md')
  assert.equal(result.maintenanceDocuments.length, 1)
})

console.log('=== Isolated production-source mutations ===')
const productionIndex = (await fs.readFile('lib/index.js', 'utf8')).replace(/\r\n/g, '\n')
const entriesAnchor = "source: 'workspace', documentId: document.documentId, revision: document.revision"
const itemsAnchor = 'items: page.items.map((l) => ({'
for (const anchor of [entriesAnchor, itemsAnchor]) assert.equal(productionIndex.split(anchor).length - 1, 1, 'mutation anchor exactly once: ' + anchor)
const cases = [
  { name: 'brief-revision-not-updated', replacement: "source: 'workspace', documentId: document.documentId, revision: null" },
  { name: 'mtime-only-false-positive', replacement: "source: 'workspace', documentId: document.documentId, revision: document.revision + ':' + document.mtimeMs" },
  { name: 'maintenance-listed-as-legacy', replacement: "items: page.items.concat(maintenanceScan ? maintenanceScan.documents.map((document) => ({ name: document.documentId + '.md', mtime: document.mtimeMs, bytes: document.size })) : []).map((l) => ({" },
]
for (const item of cases) {
  const directory = path.join(P43_MUTATION_ROOT, item.name, 'lib')
  await fs.mkdir(directory, { recursive: true })
  const anchor = item.name === 'maintenance-listed-as-legacy' ? itemsAnchor : entriesAnchor
  const mutant = path.join(directory, 'index.js')
  await fs.writeFile(mutant, productionIndex.replace(anchor, item.replacement), 'utf8')
  const run = spawnSync(process.execPath, ['tests/smoke/_r4-p4-3-mutation-worker.mjs', item.name], { cwd: process.cwd(), env: { ...process.env, DAM_AUDIT_ENGINE_SOURCE: mutant }, encoding: 'utf8', timeout: 120000 })
  const output = String(run.stdout || '') + String(run.stderr || '')
  const caught = output.includes('EXPECTED_RED')
  await test('MUT-' + item.name + ' must become red', () => assert.equal(caught, true, output.slice(-1000)))
  mutations.push({ name: item.name, result: caught ? 'CAUGHT' : 'MISSED', output: output.trim().split('\n').slice(-2).join(' | ') })
}
const cleanRun = spawnSync(process.execPath, ['tests/smoke/_r4-p4-3-mutation-worker.mjs', 'clean'], { cwd: process.cwd(), env: { ...process.env, DAM_AUDIT_ENGINE_SOURCE: path.resolve('lib/index.js') }, encoding: 'utf8', timeout: 120000 })
const cleanOutput = String(cleanRun.stdout || '') + String(cleanRun.stderr || '')
await test('MUT-restored clean production source passes all three controls', () => assert.equal(cleanOutput.includes('CLEAN_GREEN'), true, cleanOutput.slice(-1000)))

const results = { pass, fail, failures, mutations, restored: cleanOutput.includes('CLEAN_GREEN') ? 'GREEN' : 'RED' }
await fs.mkdir(P43_MUTATION_ROOT, { recursive: true })
await fs.writeFile(path.join(P43_MUTATION_ROOT, 'test-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + mutations.filter((item) => item.result === 'CAUGHT').length + ' / MISSED ' + mutations.filter((item) => item.result === 'MISSED').length)
console.log('RESTORED ' + results.restored)
process.exitCode = fail === 0 ? 0 : 1
