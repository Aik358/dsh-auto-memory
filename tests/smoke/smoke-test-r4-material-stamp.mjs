import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'
import { computeRevision } from '../../lib/ledger-doc/protocol.js'
import {
  HandoffMaterialStamp, MATERIAL_INVALIDATION_SCHEMA, MATERIAL_STAMP_SCHEMA,
  MaterialInvalidationBus, publishCommittedDocument,
} from '../../lib/ledger-doc/material-stamp.js'

let pass = 0
let fail = 0
const failures = []
const evidence = []
async function test(name, action) {
  try {
    const detail = await action()
    pass++
    console.log('  ok   - ' + name + (detail ? ' :: ' + detail : ''))
  } catch (error) {
    fail++
    failures.push({ name, error: error.stack || error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.message)
  }
}
const sha = (value) => createHash('sha256').update(value).digest('hex')
const artifacts = path.resolve('artifacts')
const root = path.join(artifacts, '_r4-p2c-fixtures')
const fixtureRoot = path.join(root, 'main')
const docsDir = path.join(fixtureRoot, 'handoff', 'documents')
const handoffDir = path.dirname(docsDir)
const eventsPath = path.join(handoffDir, 'event-store.json')
const planPath = path.join(handoffDir, 'PLAN.md')
const mutationRoot = path.resolve('artifacts', '_r4-p2c-mutation')
assert.equal(root, path.join(process.cwd(), 'artifacts', '_r4-p2c-fixtures'))
assert.equal(mutationRoot, path.join(process.cwd(), 'artifacts', '_r4-p2c-mutation'))
await fs.rm(root, { recursive: true, force: true })
await fs.rm(mutationRoot, { recursive: true, force: true })
const documentId = 'synthetic-main-261111-0001'
const docPath = path.join(docsDir, documentId + '.md')
await fs.mkdir(docsDir, { recursive: true })
for (const name of await fs.readdir(docsDir)) {
  if (/^synthetic-.*\.md$/.test(name)) await fs.unlink(path.join(docsDir, name))
}
await fs.writeFile(eventsPath, JSON.stringify({ events: [
  {
    id: 'evt_a1b2c3d4', name: 'Synthetic event A', summary: 'Synthetic summary A', status: 'active',
    sections: { goal: 'G', doing: 'D', deadend: '', next: 'N' }, updatedAt: 1, outcome: null,
    checkpoints: [{ kind: 'progress', text: 'synthetic checkpoint' }],
  },
  { id: 'evt_b2c3d4e5', name: 'Synthetic event B', summary: 'Synthetic summary B', status: 'paused', sections: {}, updatedAt: 2, checkpointCount: 4, outcome: 'synthetic outcome' },
] }), 'utf8')
let tick = 0
const store = new LedgerDocumentStore(docsDir, { eventsPath, now: () => new Date(Date.UTC(2026, 10, 11, 3, tick++)).toISOString() })
const bus = new MaterialInvalidationBus()
const readerOptions = { handoffDir, planPath, eventsPath, enabled: true, invalidation: bus }
const reader = new HandoffMaterialStamp(readerOptions)
let created
let current
async function writeSynthetic(content, id = documentId) {
  const result = await store.createDocument({ documentId: id, title: 'Synthetic material ' + id, eventIds: ['evt_a1b2c3d4'], content })
  assert.equal(result.ok, true, JSON.stringify(result))
  if (id === documentId) current = result
  return result
}
async function updateSynthetic(content) {
  const result = await store.updateDocument({ documentId, expectedRevision: current.revision, eventIds: current.eventIds, changeSet: [{ regionId: 'content', beforeText: current.content, afterText: content }] })
  assert.equal(result.ok, true, JSON.stringify(result))
  current = result
  return result
}
function validDocumentText(text) {
  return text.replace(/^revision:.*$/m, 'revision: ' + computeRevision(text))
}
async function stampOf(target) {
  const result = await target.read()
  assert.equal(result.ok, true, JSON.stringify(result))
  return result
}
async function mutationReader(name, source) {
  const directory = path.join(mutationRoot, name)
  await fs.mkdir(directory, { recursive: true })
  await fs.copyFile(path.resolve('lib/file-boundary.js'), path.join(directory, 'file-boundary.js'))
  await fs.copyFile(path.resolve('lib/ledger-doc/protocol.js'), path.join(directory, 'protocol.js'))
  const file = path.join(directory, 'material-stamp.js')
  await fs.writeFile(file, source.replace("from '../file-boundary.js'", "from './file-boundary.js'").replace("from './protocol.js'", "from './protocol.js'"), 'utf8')
  const module = await import(pathToFileURL(file).href)
  return new module.HandoffMaterialStamp(readerOptions)
}
const moduleSource = await fs.readFile(path.resolve('lib/ledger-doc/material-stamp.js'), 'utf8')
const documentRevisionAnchor = 'material.documents.push({ documentId, revision: this._documentRevision(result.text, documentId) })'
const legacyRevisionAnchor = "revision: result.state === 'present' ? computeRevision(result.text) : null"
assert.equal(moduleSource.split(documentRevisionAnchor).length - 1, 1, 'document revision mutation anchor exactly once')
assert.equal(moduleSource.split(legacyRevisionAnchor).length - 1, 2, 'legacy and plan anchors; mutate the exact legacy object')

created = await writeSynthetic('## Synthetic state\nInitial fixture body\n')

console.log('=== Defaults, root isolation, and committed-only invalidation ===')
await test('I-01 new reader defaults off; explicit enabled reader constructs and reads', async () => {
  const disabled = new HandoffMaterialStamp({ ...readerOptions, enabled: undefined })
  assert.deepEqual(await disabled.readStamp(), '')
  const result = await disabled.read()
  assert.equal(result.ok, false)
  assert.equal(result.error, 'r4-material-stamp-disabled')
  assert.equal(reader.enabled, true)
  assert.equal(reader.handoffDir, handoffDir)
})
await test('I-02 relative/foreign roots reject; isolated root succeeds', () => {
  assert.throws(() => new HandoffMaterialStamp({ handoffDir: 'artifacts/relative', enabled: true }), /handoff-root-invalid/)
  assert.throws(() => new HandoffMaterialStamp({ handoffDir: process.cwd(), enabled: true }), /handoff-root-invalid/)
  assert.throws(() => new HandoffMaterialStamp({ ...readerOptions, eventsPath: path.join(root, 'outside-events.json') }), /material-path-invalid/)
})
await test('I-03 missing, empty, and populated document roots are distinct', async () => {
  const missingRoot = path.join(root, 'missing')
  await fs.mkdir(missingRoot, { recursive: true })
  const emptyRoot = path.join(root, 'empty')
  await fs.mkdir(path.join(emptyRoot, 'handoff', 'documents'), { recursive: true })
  const missing = await new HandoffMaterialStamp({ handoffDir: path.join(missingRoot, 'handoff'), eventsPath: path.join(missingRoot, 'handoff', 'event-store.json'), enabled: true }).read()
  const empty = await new HandoffMaterialStamp({ handoffDir: path.join(emptyRoot, 'handoff'), eventsPath: path.join(emptyRoot, 'handoff', 'event-store.json'), enabled: true }).read()
  const present = await stampOf(reader)
  assert.equal(missing.material.documentsState, 'missing')
  assert.equal(empty.material.documentsState, 'empty')
  assert.equal(present.material.documentsState, 'present')
  assert.notEqual(missing.stamp, empty.stamp)
  assert.notEqual(empty.stamp, present.stamp)
})
await test('I-04 failed and noop writes do not invalidate; readback commit does', async () => {
  const version = bus.version(handoffDir)
  const failed = await store.updateDocument({ documentId, expectedRevision: 'sha256:' + '0'.repeat(64), eventIds: current.eventIds, changeSet: [] })
  assert.equal(failed.error, 'document-version-conflict')
  assert.throws(() => publishCommittedDocument(bus, handoffDir, failed), /committed-write-required/)
  const noop = await store.updateDocument({ documentId, expectedRevision: current.revision, eventIds: current.eventIds, changeSet: [] })
  assert.equal(noop.noop, true)
  assert.throws(() => publishCommittedDocument(bus, handoffDir, noop), /committed-write-required/)
  assert.equal(bus.version(handoffDir), version)
})
await test('I-05 only the committed workspace receives a synchronous signal; unsubscribe stops delivery', async () => {
  const signals = []
  const unsubscribe = bus.subscribe(handoffDir, (signal) => signals.push(signal))
  const beforeVersion = bus.version(handoffDir)
  const otherRoot = path.join(root, 'signal-other', 'handoff')
  await fs.mkdir(otherRoot, { recursive: true })
  let otherSignals = 0
  bus.subscribe(otherRoot, () => otherSignals++)
  const committed = await updateSynthetic('## Synthetic state\nCommitted body A\n')
  const signal = publishCommittedDocument(bus, handoffDir, committed)
  assert.equal(signal.schema, MATERIAL_INVALIDATION_SCHEMA)
  assert.equal(signal.committed, true)
  assert.equal(signal.documentId, documentId)
  assert.equal(signal.revision, committed.revision)
  assert.equal(signal.handoffVersion, beforeVersion + 1)
  assert.equal(signals.length, 1)
  assert.equal(otherSignals, 0)
  unsubscribe()
  const second = await updateSynthetic('## Synthetic state\nCommitted body B\n')
  publishCommittedDocument(bus, handoffDir, second)
  assert.equal(signals.length, 1)
  evidence.push({ kind: 'invalidation', signal: { schema: signal.schema, documentId, revision: signal.revision, version: signal.handoffVersion } })
})
await test('I-06 listener failure is visible; another listener and fresh disk read still succeed', async () => {
  const offError = bus.subscribe(handoffDir, () => { throw new Error('synthetic listener failure') })
  let received = false
  const offGood = bus.subscribe(handoffDir, () => { received = true })
  const committed = await updateSynthetic('## Synthetic state\nListener failure body\n')
  const signal = publishCommittedDocument(bus, handoffDir, committed)
  assert.equal(received, true)
  assert.deepEqual(signal.listenerErrors, [{ message: 'synthetic listener failure' }])
  const result = await stampOf(reader)
  assert.equal(result.material.documents.find((item) => item.documentId === documentId).revision, committed.revision)
  offError()
  offGood()
})
await test('I-07 forged identity/revision notifications reject; valid event does not replace disk authority', async () => {
  const version = bus.version(handoffDir)
  assert.throws(() => bus.publishCommitted({ handoffDir, documentId: '../bad', revision: current.revision }), /document-id-invalid/)
  assert.throws(() => bus.publishCommitted({ handoffDir, documentId, revision: 'sha256:bad' }), /revision-invalid/)
  const signal = bus.publishCommitted({ handoffDir, documentId, revision: current.revision })
  assert.equal(signal.handoffVersion, version + 1)
  const result = await stampOf(reader)
  assert.equal(result.material.documents[0].revision, current.revision)
  assert.equal(result.invalidationVersion, version + 1)
})
await test('I-08 events project all required fields and every field changes the digest', async () => {
  const before = await stampOf(reader)
  const parsed = JSON.parse(await fs.readFile(eventsPath, 'utf8'))
  const required = ['id', 'name', 'summary', 'status', 'sections', 'updatedAt', 'checkpointCount', 'outcome']
  const variations = {
    id: 'evt_c3d4e5f6', name: 'Changed name', summary: 'Same-time changed summary',
    status: 'paused', sections: { goal: 'Changed goal' }, updatedAt: 999, checkpointCount: 999,
    outcome: 'changed synthetic outcome',
  }
  for (const field of required) {
    const changed = JSON.parse(JSON.stringify(parsed))
    changed.events[0][field] = variations[field]
    const variantPath = path.join(handoffDir, 'events-' + field + '.json')
    await fs.writeFile(variantPath, JSON.stringify(changed))
    const after = await stampOf(new HandoffMaterialStamp({ ...readerOptions, eventsPath: variantPath }))
    assert.notEqual(after.stamp, before.stamp, field + ' must participate')
    assert.equal(after.material.events.digest !== before.material.events.digest, true)
  }
  assert.equal(parsed.events[0].checkpoints.length, 1)
  evidence.push({ kind: 'events-projection', requiredFields: required, changedFields: required.length })
})

console.log('')
console.log('=== F-1～F-8: real fixture operations and assertions ===')
await test('F-01 same ID and same mtime body A to B changes document revision and stamp', async () => {
  const before = await stampOf(reader)
  const beforeMtime = (await fs.stat(docPath)).mtime
  await fs.writeFile(docPath, validDocumentText(current.text.replace('Listener failure body', 'Same-mtime body B')), 'utf8')
  await fs.utimes(docPath, beforeMtime, beforeMtime)
  const after = await stampOf(reader)
  assert.notEqual(after.stamp, before.stamp)
  assert.equal((await fs.stat(docPath)).mtimeMs, beforeMtime.getTime())
  assert.notEqual(after.material.documents[0].revision, current.revision)
  current = await store.readDocument(documentId)
  assert.equal(current.ok, true)
  evidence.push({ kind: 'F-1', before: before.stamp, after: after.stamp, sameMtime: true })
})
await test('F-02 unchanged content reads the exact same stamp', async () => {
  const before = await stampOf(reader)
  const after = await stampOf(reader)
  assert.equal(after.stamp, before.stamp)
  assert.equal(await reader.readStamp(), before.stamp)
  assert.match(before.stamp, /^sha256:[0-9a-f]{64}$/)
})
await test('F-03 updatedAt-only change changes revision and stamp', async () => {
  const before = await stampOf(reader)
  const original = current.text
  const changed = original.replace(/^updatedAt:.*$/m, 'updatedAt: 2026-11-11T03:59:59.000Z')
  assert.notEqual(changed, original)
  await fs.writeFile(docPath, validDocumentText(changed))
  const after = await stampOf(reader)
  assert.notEqual(after.material.documents[0].revision, current.revision)
  assert.notEqual(after.stamp, before.stamp)
  await fs.writeFile(docPath, original)
  current = await store.readDocument(documentId)
  assert.equal(current.ok, true)
  assert.equal((await stampOf(reader)).stamp, before.stamp)
})
await test('F-04 add, delete, and rename each change the stamp', async () => {
  const original = (await stampOf(reader)).stamp
  const extraId = 'synthetic-extra-261111-0002'
  const extra = await writeSynthetic('## Synthetic extra\nExtra body\n', extraId)
  const added = await stampOf(reader)
  assert.notEqual(added.stamp, original)
  await fs.unlink(path.join(docsDir, extraId + '.md'))
  const deleted = await stampOf(reader)
  assert.notEqual(deleted.stamp, added.stamp)
  assert.equal(deleted.stamp, original)
  const originalId = current.documentId
  const originalText = current.text
  const renamedId = 'synthetic-renamed-261111-0003'
  await fs.rename(docPath, path.join(docsDir, renamedId + '.md'))
  const renamed = await stampOf(reader)
  assert.notEqual(renamed.stamp, original)
  assert.equal(renamed.material.documents.length, 0)
  assert.equal(renamed.material.readErrors[0].code, 'MATERIAL_DOCUMENT_FORMAT_INVALID')
  await fs.writeFile(path.join(docsDir, renamedId + '.md'), validDocumentText(originalText.replaceAll(originalId, renamedId).replace('Synthetic material ' + originalId, 'Synthetic material ' + renamedId)))
  const renamedValid = await stampOf(reader)
  assert.equal(renamedValid.complete, true)
  assert.notEqual(renamedValid.stamp, original)
  assert.equal(renamedValid.material.documents[0].documentId, renamedId)
  await fs.unlink(path.join(docsDir, renamedId + '.md'))
  await fs.writeFile(docPath, originalText)
  current = await store.readDocument(documentId)
  assert.equal(current.ok, true)
  const restored = await stampOf(reader)
  assert.equal(restored.stamp, original)
})
await test('F-05 coexisting legacy ledger body changes stamp independently of documents', async () => {
  const legacyPath = path.join(handoffDir, 'handoff-20261111-120000.md')
  await fs.writeFile(legacyPath, '# Synthetic legacy A\n\n## 任务状态\nLegacy A\n', 'utf8')
  const before = await stampOf(reader)
  assert.equal(before.material.legacyLatest.name, 'handoff-20261111-120000.md')
  assert.equal(before.material.documents.length, 1)
  const mtime = (await fs.stat(legacyPath)).mtime
  await fs.writeFile(legacyPath, '# Synthetic legacy B\n\n## 任务状态\nLegacy B\n', 'utf8')
  await fs.utimes(legacyPath, mtime, mtime)
  const after = await stampOf(reader)
  assert.notEqual(after.stamp, before.stamp)
  assert.equal(after.material.legacyLatest.name, before.material.legacyLatest.name)
  assert.notEqual(after.material.legacyLatest.revision, before.material.legacyLatest.revision)
  assert.equal(after.material.documents[0].revision, current.revision)
  evidence.push({ kind: 'F-5', before: before.stamp, after: after.stamp, legacyName: after.material.legacyLatest.name })
})
await test('F-06 changing workspace A leaves workspace B byte-state and stamp unchanged', async () => {
  const otherDocs = path.join(root, 'workspace-b', 'handoff', 'documents')
  const otherEvents = path.join(root, 'workspace-b', 'handoff', 'event-store.json')
  await fs.mkdir(otherDocs, { recursive: true })
  await fs.copyFile(eventsPath, otherEvents)
  const otherStore = new LedgerDocumentStore(otherDocs, { eventsPath: otherEvents, now: () => '2026-11-11T03:00:00.000Z' })
  const otherCreated = await otherStore.createDocument({ documentId, title: 'Synthetic B', eventIds: ['evt_a1b2c3d4'], content: current.content })
  assert.equal(otherCreated.ok, true)
  const other = new HandoffMaterialStamp({ handoffDir: path.dirname(otherDocs), eventsPath: otherEvents, enabled: true })
  const beforeA = await stampOf(reader)
  const beforeB = await stampOf(other)
  await updateSynthetic('## Synthetic state\nWorkspace A only change\n')
  const afterA = await stampOf(reader)
  const afterB = await stampOf(other)
  assert.notEqual(afterA.stamp, beforeA.stamp)
  assert.equal(afterB.stamp, beforeB.stamp)
})
await test('F-07 EACCES and corruption are explicit error-state changes, then recovery is exact', async () => {
  const before = await stampOf(reader)
  const failingFs = Object.create(fs)
  failingFs.readFile = async (file, ...args) => {
    if (path.resolve(String(file)) === docPath) throw Object.assign(new Error('synthetic EACCES'), { code: 'EACCES' })
    return fs.readFile(file, ...args)
  }
  const deniedReader = new HandoffMaterialStamp({ ...readerOptions, fs: failingFs })
  const denied = await stampOf(deniedReader)
  assert.notEqual(denied.stamp, before.stamp)
  assert.equal(denied.complete, false)
  assert.equal(denied.material.documentsState, 'present')
  assert.equal(denied.material.documents.length, 0)
  assert.deepEqual(denied.material.readErrors, [{ source: 'document', code: 'EACCES', documentId }])
  const bytes = await fs.readFile(docPath)
  try {
    await fs.writeFile(docPath, Buffer.from([0x23, 0x20, 0xff, 0x0a]))
    const damaged = await stampOf(reader)
    assert.notEqual(damaged.stamp, before.stamp)
    assert.equal(damaged.material.readErrors[0].code, 'MATERIAL_INVALID_UTF8')
    await fs.writeFile(docPath, current.text.replace('documentId: ' + documentId, 'documentId: synthetic-mismatch-261111-0009'))
    const mismatched = await stampOf(reader)
    assert.equal(mismatched.material.readErrors[0].code, 'MATERIAL_DOCUMENT_FORMAT_INVALID')
    assert.notEqual(mismatched.stamp, before.stamp)
  } finally { await fs.writeFile(docPath, bytes) }
  assert.equal((await stampOf(reader)).stamp, before.stamp)
  evidence.push({ kind: 'F-7', deniedCode: 'EACCES', corruptCode: 'MATERIAL_INVALID_UTF8', formatCode: 'MATERIAL_DOCUMENT_FORMAT_INVALID' })
})

console.log('')
console.log('=== F-8 isolated mutants and restored copy ===')
await test('F-08a removing document revision makes the F-1 discriminant red; restored copy is green', async () => {
  const mutant = await mutationReader('document-revision-removed', moduleSource.replace(documentRevisionAnchor, 'material.documents.push({ documentId, revision: null })'))
  const before = await stampOf(mutant)
  const bytes = await fs.readFile(docPath)
  const mtime = (await fs.stat(docPath)).mtime
  let red = false
  try {
    await fs.writeFile(docPath, validDocumentText(current.text.replace('Workspace A only change', 'F1 mutant must change')))
    await fs.utimes(docPath, mtime, mtime)
    assert.notEqual((await stampOf(mutant)).stamp, before.stamp)
  } catch (_) { red = true } finally { await fs.writeFile(docPath, bytes); await fs.utimes(docPath, mtime, mtime) }
  assert.equal(red, true)
  const restored = await mutationReader('document-revision-restored', moduleSource)
  assert.equal((await stampOf(restored)).stamp, (await stampOf(reader)).stamp)
  evidence.push({ kind: 'mutation', name: 'document-revision-removed/F-1', result: 'CAUGHT' })
})
await test('F-08b removing legacy revision makes the F-5 discriminant red; restored copy is green', async () => {
  const legacyObject = "material.legacyLatest = { state: result.state, name: latest.name, revision: result.state === 'present' ? computeRevision(result.text) : null }"
  assert.equal(moduleSource.split(legacyObject).length - 1, 1, 'legacy revision anchor exactly once')
  const mutant = await mutationReader('legacy-revision-removed', moduleSource.replace(legacyObject, "material.legacyLatest = { state: result.state, name: latest.name, revision: null }"))
  const before = await stampOf(mutant)
  const legacyPath = path.join(handoffDir, before.material.legacyLatest.name)
  const bytes = await fs.readFile(legacyPath)
  const mtime = (await fs.stat(legacyPath)).mtime
  let red = false
  try {
    await fs.writeFile(legacyPath, bytes.toString('utf8').replace('Legacy B', 'F5 mutant must change'))
    await fs.utimes(legacyPath, mtime, mtime)
    assert.notEqual((await stampOf(mutant)).stamp, before.stamp)
  } catch (_) { red = true } finally { await fs.writeFile(legacyPath, bytes); await fs.utimes(legacyPath, mtime, mtime) }
  assert.equal(red, true)
  const restored = await mutationReader('legacy-revision-restored', moduleSource)
  assert.equal((await stampOf(restored)).stamp, (await stampOf(reader)).stamp)
  evidence.push({ kind: 'mutation', name: 'legacy-revision-removed/F-5', result: 'CAUGHT' })
})

console.log('')
console.log('=== Additional negative paths, isolation, and physical evidence ===')
await test('N-01 documents are sorted by ID, not mtime or manifest order', async () => {
  const extra = await writeSynthetic('## Sorted extra\nBody\n', 'synthetic-aaa-261111-0004')
  assert.equal(extra.ok, true)
  const result = await stampOf(reader)
  const ids = result.material.documents.map((item) => item.documentId)
  assert.deepEqual(ids, [...ids].sort())
  assert.deepEqual(ids, ['synthetic-aaa-261111-0004', documentId])
  await fs.unlink(path.join(docsDir, 'synthetic-aaa-261111-0004.md'))
})
await test('N-02 out-of-root document link is a read error; a regular document is readable', async () => {
  const outside = path.join(fixtureRoot, 'synthetic-outside.md')
  const link = path.join(docsDir, 'synthetic-link-261111-0005.md')
  await fs.writeFile(outside, '# Synthetic outside\n')
  let linked = false
  try {
    await fs.symlink(outside, link, 'file')
    linked = true
    const before = await stampOf(reader)
    const result = await stampOf(reader)
    assert.ok(result.material.readErrors.some((item) => item.documentId === 'synthetic-link-261111-0005'))
    assert.equal(result.material.documents.some((item) => item.documentId === 'synthetic-link-261111-0005'), false)
    assert.notEqual(result.stamp, '')
    assert.ok(before.material.documents.some((item) => item.documentId === documentId))
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error
    console.log('       symlink creation unavailable; not counted as symlink proof')
  } finally {
    if (linked) await fs.unlink(link)
    await fs.unlink(outside)
  }
})
await test('N-03 damaged event JSON and missing event store are different stamp states', async () => {
  const damagedPath = path.join(handoffDir, 'events-damaged.json')
  await fs.writeFile(damagedPath, '{synthetic invalid json', 'utf8')
  const damaged = await stampOf(new HandoffMaterialStamp({ ...readerOptions, eventsPath: damagedPath }))
  assert.equal(damaged.material.events.state, 'error')
  assert.ok(damaged.material.readErrors.some((item) => item.source === 'events' && item.code === 'MATERIAL_EVENTS_JSON_INVALID'))
  const missing = await stampOf(new HandoffMaterialStamp({ ...readerOptions, eventsPath: path.join(handoffDir, 'events-missing.json') }))
  assert.equal(missing.material.events.state, 'missing')
  assert.equal(missing.material.readErrors.length, 0)
  assert.notEqual(missing.stamp, damaged.stamp)
  await fs.unlink(damagedPath)
})
await test('N-04 plan content participates; legacy name selection still follows mtime', async () => {
  await fs.writeFile(planPath, '# Synthetic plan A\n\n## Goal\nSynthetic plan body A\n')
  const before = await stampOf(reader)
  await fs.writeFile(planPath, '# Synthetic plan B\n\n## Goal\nSynthetic plan body B\n')
  const after = await stampOf(reader)
  assert.notEqual(after.stamp, before.stamp)
  const older = path.join(handoffDir, 'handoff-20261110-000000.md')
  await fs.writeFile(older, '# Older synthetic ledger\n')
  const oldTime = new Date(Date.UTC(2026, 10, 10, 0, 0, 0))
  await fs.utimes(older, oldTime, oldTime)
  const stillLatest = await stampOf(reader)
  assert.equal(stillLatest.material.legacyLatest.name, 'handoff-20261111-120000.md')
  await fs.unlink(older)
  await fs.unlink(planPath)
})
await test('N-05 a file in place of the documents directory fails explicitly, without hiding healthy plan/events', async () => {
  const filesRoot = path.join(root, 'documents-as-file')
  await fs.mkdir(path.join(filesRoot, 'handoff'), { recursive: true })
  await fs.writeFile(path.join(filesRoot, 'handoff', 'documents'), 'synthetic not a directory')
  await fs.writeFile(path.join(filesRoot, 'handoff', 'event-store.json'), '{"events":[]}')
  const result = await new HandoffMaterialStamp({ handoffDir: path.join(filesRoot, 'handoff'), eventsPath: path.join(filesRoot, 'handoff', 'event-store.json'), enabled: true }).read()
  assert.equal(result.material.documentsState, 'error')
  assert.equal(result.material.plan.state, 'missing')
  assert.equal(result.material.events.state, 'empty')
  assert.ok(result.material.readErrors.some((item) => item.source === 'documents'))
})
await test('N-06 independent process computes the same stamp from the same fixture', async () => {
  const moduleUrl = pathToFileURL(path.resolve('lib/ledger-doc/material-stamp.js')).href
  const script = `import {HandoffMaterialStamp} from ${JSON.stringify(moduleUrl)}; const r=new HandoffMaterialStamp(${JSON.stringify({ ...readerOptions, invalidation: null })}); const result=await r.read(); console.log(JSON.stringify({stamp:result.stamp,complete:result.complete,documents:result.material.documents}));`
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script], { cwd: process.cwd(), windowsHide: true })
  const child = JSON.parse(stdout.trim())
  assert.equal(child.stamp, (await stampOf(reader)).stamp)
  assert.equal(child.complete, true)
})
await test('N-07 LF endings and real SHA-256 structure; production store API untouched', async () => {
  for (const file of ['lib/ledger-doc/material-stamp.js', 'tests/smoke/smoke-test-r4-material-stamp.mjs']) {
    const bytes = await fs.readFile(file)
    const text = bytes.toString('latin1')
    assert.equal(/\r\n/.test(text) && /(?<!\r)\n/.test(text), false, file)
    evidence.push({ kind: 'file', path: file, bytes: bytes.length, sha256: sha(bytes) })
  }
  assert.equal(new LedgerDocumentStore(docsDir, { eventsPath }).invalidation, undefined)
  assert.equal(MATERIAL_STAMP_SCHEMA, 'r4-material-stamp-v2')
})
const results = { pass, fail, failures, evidence }
await fs.writeFile(path.join(root, 'test-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((item) => item.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((item) => item.result === 'MISSED').length)
process.exitCode = fail === 0 ? 0 : 1
