import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
import {
  PROTOCOL_VERSION, computeLegacyCheckpointKey, computeOperationDigest, computeRevision,
  normalizeText, validateChangeSet, validateCheckpointId, validateDocumentId,
  validateEventIds, validateOpId, validateRevision,
} from '../../lib/ledger-doc/protocol.js'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'

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
    failures.push({ name, error: error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.message)
  }
}
const root = path.resolve('artifacts', '_r4-p1-fixtures')
const documents = path.join(root, 'fixtures', 'documents')
const eventsPath = path.join(root, 'fixtures', 'events.json')
const target = path.join(documents, 'synthetic-main-261110-0001.md')
const other = path.join(documents, 'synthetic-other-261110-0002.md')
for (const file of [target, other]) {
  try { await fs.unlink(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
}
for (const name of await fs.readdir(documents)) {
  if (/^\.synthetic-(?:main|other)-.*\.tmp$/.test(name)) await fs.unlink(path.join(documents, name))
}
const input = {
  documentId: 'synthetic-main-261110-0001',
  title: 'Synthetic maintenance document',
  eventIds: ['evt_b2c3d4e5', 'evt_a1b2c3d4', 'evt_a1b2c3d4'],
  content: '## Synthetic state\nInitial synthetic content.\n',
}
let clock = 0
const store = new LedgerDocumentStore(documents, {
  eventsPath,
  now: () => new Date(Date.UTC(2026, 10, 11, 1, clock++)).toISOString(),
})
let created
let updated

console.log('=== P0 protocol: real calls and return values ===')
await test('P0-01 documentId accepts exact stable ID', () => {
  assert.deepEqual(validateDocumentId('synthetic-main-261110-0001'), { ok: true, value: 'synthetic-main-261110-0001' })
})
await test('P0-02 documentId rejects traversal, absolute path, and wrong type', () => {
  for (const id of ['../synthetic-main-261110-0001', 'synthetic/../../main-261110-0001', 'D:/main-261110-0001', '', null]) {
    assert.deepEqual(validateDocumentId(id), { ok: false, error: 'document-id-invalid' })
  }
})
await test('P0-03 eventIds trims, deduplicates, and sorts', () => {
  assert.deepEqual(validateEventIds([' evt_b2c3d4e5 ', 'evt_a1b2c3d4', 'evt_b2c3d4e5']), { ok: true, value: ['evt_a1b2c3d4', 'evt_b2c3d4e5'] })
})
await test('P0-04 eventIds rejects empty and malformed values', () => {
  assert.equal(validateEventIds([]).error, 'event-ids-required')
  assert.equal(validateEventIds([null]).error, 'event-ids-required')
  assert.equal(validateEventIds(['evt_latest']).error, 'event-id-unavailable')
})
await test('P0-05 opId accepts only the 32-hex form', () => {
  assert.equal(validateOpId('r4op_' + 'a1'.repeat(16)).ok, true)
  for (const id of ['r4op_abc', 'R4OP_' + 'a1'.repeat(16), 'ckpt_' + 'a1'.repeat(16)]) assert.equal(validateOpId(id).error, 'op-id-invalid')
})
await test('P0-06 checkpointId accepts only the 16-hex form', () => {
  assert.equal(validateCheckpointId('ckpt_0123456789abcdef').ok, true)
  assert.equal(validateCheckpointId('ckpt_0123456789abcdeG').error, 'checkpoint-id-invalid')
  assert.equal(validateCheckpointId('evt_a1b2c3d4').error, 'checkpoint-id-invalid')
})
await test('P0-07 normalizeText removes BOM, unifies newlines, and trims line endings', () => {
  assert.equal(normalizeText('\ufeffa  \r\nb\t\rc\n'), 'a\nb\nc\n')
  assert.equal(normalizeText(''), '')
  assert.throws(() => normalizeText(Buffer.from('x')), /text-must-be-string/)
})
await test('P0-08 revision ignores only the revision metadata value', () => {
  const a = '# T\n<!-- r4-ledger-doc-v1 -->\ndocumentId: synthetic-main-261110-0001\neventIds: evt_a1b2c3d4\ncreatedAt: 2026-11-10T00:00:00.000Z\nupdatedAt: 2026-11-10T00:00:00.000Z\nrevision: sha256:' + '0'.repeat(64) + '\nbody\nrevision: this-is-body'
  assert.equal(computeRevision(a), computeRevision(a.replace('0'.repeat(64), 'f'.repeat(64))))
  assert.match(computeRevision(a), /^sha256:[0-9a-f]{64}$/)
  assert.notEqual(computeRevision(a), computeRevision(a + '!'))
  assert.notEqual(computeRevision(a), computeRevision(a.replace('documentId: ', 'documentId:  ')))
  assert.equal(validateRevision(computeRevision(a)).ok, true)
  assert.equal(validateRevision('sha256:not-a-digest').error, 'revision-invalid')
})
await test('P0-09 operationDigest canonicalizes recursively and rejects cycles', () => {
  const left = { schema: 's', changeSet: [{ afterText: 'B', regionId: 'content', beforeText: 'A' }] }
  const right = { changeSet: [{ beforeText: 'A', afterText: 'B', regionId: 'content' }], schema: 's' }
  assert.equal(computeOperationDigest(left), computeOperationDigest(right))
  assert.notEqual(computeOperationDigest(left), computeOperationDigest({ ...left, schema: 'different' }))
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(() => computeOperationDigest(cyclic), /cyclic/)
})
await test('P0-10 legacyCheckpointKey is stable and field-sensitive', () => {
  const cp = { eventId: 'evt_a1b2c3d4', checkpointIndex: 0, at: 1, kind: 'log', text: 'synthetic', sourceRef: 'synthetic.md', idemKey: 'k', quad: { state: 'A' } }
  assert.equal(computeLegacyCheckpointKey(cp), computeLegacyCheckpointKey({ quad: { state: 'A' }, ...cp }))
  assert.notEqual(computeLegacyCheckpointKey(cp), computeLegacyCheckpointKey({ ...cp, checkpointIndex: 1 }))
})
await test('P0-11 changeSet rejects duplicate or incomplete regions', () => {
  assert.equal(validateChangeSet([{ regionId: 'content', beforeText: 'A', afterText: 'B' }]).ok, true)
  assert.equal(validateChangeSet([{ regionId: 'content', beforeText: 'A', afterText: 'B' }, { regionId: 'content', beforeText: 'A', afterText: 'C' }]).error, 'changeset-invalid')
  assert.equal(validateChangeSet([{ regionId: 'content', beforeText: 'A' }]).error, 'changeset-invalid')
})
await test('P0-12 protocol identity and all nine required functions are live', async () => {
  assert.equal(PROTOCOL_VERSION, 'r4-ledger-doc-v1')
  const protocol = await import("../../lib/ledger-doc/protocol.js")
  for (const name of ['validateDocumentId', 'validateEventIds', 'validateOpId', 'validateCheckpointId', 'normalizeText', 'computeRevision', 'computeOperationDigest', 'computeLegacyCheckpointKey', 'validateChangeSet']) assert.equal(typeof protocol[name], 'function')
})

console.log('')
console.log('=== P1 real storage, negative paths, and positive controls ===')
await test('P1-01 constructor permits isolated root and rejects other roots', () => {
  assert.equal(store.rootDir, documents)
  assert.throws(() => new LedgerDocumentStore('artifacts/relative'), /document-root-invalid/)
  assert.throws(() => new LedgerDocumentStore(process.cwd()), /document-root-invalid/)
})
await test('P1-02 create returns identity/revision and writes the file', async () => {
  created = await store.createDocument(input)
  assert.equal(created.ok, true, JSON.stringify(created))
  assert.equal(created.documentId, input.documentId)
  assert.equal(created.revision, computeRevision(created.text))
  assert.equal(created.noop, false)
  assert.deepEqual(created.eventIds, ['evt_a1b2c3d4', 'evt_b2c3d4e5'])
  assert.equal(await fs.readFile(target, 'utf8'), created.text)
  evidence.push({ kind: 'create', revision: created.revision, bytes: created.bytes })
})
await test('P1-03 duplicate create conflicts without byte or file-count change', async () => {
  const before = await fs.readFile(target)
  const count = (await fs.readdir(documents)).length
  assert.equal((await store.createDocument(input)).error, 'document-already-exists')
  assert.equal((await fs.readdir(documents)).length, count)
  assert.ok(before.equals(await fs.readFile(target)))
  assert.equal(created.ok, true)
})
await test('P1-04 traversal and absolute IDs create no file', async () => {
  const count = (await fs.readdir(documents)).length
  for (const documentId of ['../synthetic-main-261110-0001', 'D:/synthetic-main-261110-0001', '..', 'synthetic-main-261110-0001.md']) {
    assert.equal((await store.createDocument({ ...input, documentId })).error, 'document-id-invalid')
  }
  assert.equal((await fs.readdir(documents)).length, count)
  assert.equal((await store.readDocument(input.documentId)).ok, true)
})
await test('P1-05 missing eventIds rejects; two valid events succeed', async () => {
  const count = (await fs.readdir(documents)).length
  assert.equal((await store.createDocument({ ...input, documentId: 'synthetic-empty-261110-0001', eventIds: [] })).error, 'event-ids-required')
  assert.equal((await fs.readdir(documents)).length, count)
  assert.equal(created.eventIds.length, 2)
})
await test('P1-06 unknown/malformed/closed event rejects; available event succeeds', async () => {
  for (const eventIds of [['evt_00000000'], ['evt_UNKNOWN'], ['evt_c3d4e5f6']]) {
    assert.equal((await store.createDocument({ ...input, documentId: 'synthetic-bad-event-261110-0001', eventIds })).error, 'event-id-unavailable')
  }
  assert.equal((await store.readDocument(input.documentId)).eventIds[0], 'evt_a1b2c3d4')
})
await test('P1-07 compatibility eventId mismatch rejects; match succeeds', async () => {
  assert.equal((await store.createDocument({ ...input, documentId: 'synthetic-conflict-261110-0001', eventId: 'evt_b2c3d4e5' })).error, 'event-ids-conflict')
  const result = await store.createDocument({ ...input, documentId: 'synthetic-other-261110-0002', eventIds: ['evt_a1b2c3d4'], eventId: 'evt_a1b2c3d4', content: 'Other synthetic document.' })
  assert.equal(result.ok, true, JSON.stringify(result))
})
await test('P1-08 normal update changes revision and content', async () => {
  updated = await store.updateDocument({
    documentId: input.documentId, expectedRevision: created.revision, eventIds: created.eventIds,
    changeSet: [{ regionId: 'content', beforeText: input.content, afterText: '## Synthetic state\nUpdated synthetic content.\n' }],
  })
  assert.equal(updated.ok, true, JSON.stringify(updated))
  assert.notEqual(updated.revision, created.revision)
  assert.equal(updated.noop, false)
  assert.match(await fs.readFile(target, 'utf8'), /Updated synthetic content/)
  evidence.push({ kind: 'update', revision: updated.revision, bytes: updated.bytes })
})
await test('P1-09 stale expectedRevision conflicts and preserves bytes', async () => {
  const before = await fs.readFile(target)
  const result = await store.updateDocument({
    documentId: input.documentId, expectedRevision: created.revision, eventIds: created.eventIds,
    changeSet: [{ regionId: 'content', beforeText: updated.content, afterText: 'Must not be written.' }],
  })
  assert.equal(result.error, 'document-version-conflict')
  assert.ok(before.equals(await fs.readFile(target)))
  assert.equal(updated.ok, true)
})
await test('P1-10 old revision cannot replay after commit', async () => {
  assert.equal((await store.updateDocument({ documentId: input.documentId, expectedRevision: created.revision, eventIds: created.eventIds })).error, 'document-version-conflict')
})
await test('P1-11 identical update is noop without byte, revision, or mtime change', async () => {
  const before = await fs.readFile(target)
  const mtime = (await fs.stat(target)).mtimeMs
  const result = await store.updateDocument({
    documentId: input.documentId, expectedRevision: updated.revision, eventIds: updated.eventIds,
    changeSet: [{ regionId: 'content', beforeText: updated.content, afterText: updated.content }],
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.noop, true)
  assert.equal(result.revision, updated.revision)
  assert.equal((await fs.stat(target)).mtimeMs, mtime)
  assert.ok(before.equals(await fs.readFile(target)))
})
await test('P1-12 empty changeSet with same association is noop; changed one succeeds', async () => {
  const noop = await store.updateDocument({ documentId: input.documentId, expectedRevision: updated.revision, eventIds: updated.eventIds, changeSet: [] })
  assert.equal(noop.noop, true)
  assert.equal(updated.noop, false)
})
await test('P1-13 stale region base rejects; matching region succeeds', async () => {
  const before = await fs.readFile(target)
  assert.equal((await store.updateDocument({ documentId: input.documentId, expectedRevision: updated.revision, eventIds: updated.eventIds, changeSet: [{ regionId: 'content', beforeText: 'Not current', afterText: 'Wrong.' }] })).error, 'changeset-base-mismatch')
  assert.ok(before.equals(await fs.readFile(target)))
  assert.equal(updated.ok, true)
})
await test('P1-14 missing update rejects and does not create; explicit create succeeds', async () => {
  const documentId = 'synthetic-missing-261110-0001'
  assert.equal((await store.updateDocument({ documentId, expectedRevision: 'sha256:' + '0'.repeat(64), eventIds: ['evt_a1b2c3d4'], changeSet: [] })).error, 'document-not-found')
  assert.equal(await fs.stat(path.join(documents, documentId + '.md')).then(() => true, (e) => e.code === 'ENOENT'), true)
  assert.equal(created.ok, true)
})
await test('P1-15 readback detects inconsistent persisted revision; restored bytes pass', async () => {
  const before = await fs.readFile(target)
  await fs.writeFile(target, before.toString('utf8').replace('Updated synthetic content.', 'Tampered synthetic content.'), 'utf8')
  try { assert.equal((await store.readDocument(input.documentId)).error, 'document-revision-mismatch') } finally { await fs.writeFile(target, before) }
  assert.equal((await store.readDocument(input.documentId)).ok, true)
})
await test('P1-16 rename failure preserves old bytes and cleans temporary file', async () => {
  const before = await fs.readFile(target)
  const failing = Object.create(fs)
  failing.rename = async () => { throw Object.assign(new Error('synthetic rename failure'), { code: 'EIO' }) }
  const failingStore = new LedgerDocumentStore(documents, { eventsPath, fs: failing })
  const result = await failingStore.updateDocument({ documentId: input.documentId, expectedRevision: updated.revision, eventIds: updated.eventIds, changeSet: [{ regionId: 'content', beforeText: updated.content, afterText: 'Failure candidate.' }] })
  assert.equal(result.error, 'document-write-failed')
  assert.equal(result.documentMayHaveChanged, false)
  assert.ok(before.equals(await fs.readFile(target)))
  assert.equal((await fs.readdir(documents)).filter((name) => name.endsWith('.tmp')).length, 0)
  assert.equal(updated.ok, true)
})
await test('P1-17 readback failure is explicit and never reported as success', async () => {
  const failing = Object.create(fs)
  let failRead = false
  failing.readFile = async (...args) => {
    if (failRead && path.resolve(String(args[0])) === target) throw Object.assign(new Error('synthetic readback failure'), { code: 'EIO' })
    return fs.readFile(...args)
  }
  failing.rename = async (...args) => {
    await fs.rename(...args)
    failRead = true
  }
  const failingStore = new LedgerDocumentStore(documents, { eventsPath, fs: failing })
  const result = await failingStore.updateDocument({ documentId: input.documentId, expectedRevision: updated.revision, eventIds: updated.eventIds, changeSet: [{ regionId: 'title', beforeText: updated.title, afterText: 'Synthetic readback failure title' }] })
  assert.equal(result.error, 'document-readback-failed')
  assert.equal(result.documentMayHaveChanged, true)
  const restored = await store.updateDocument({ documentId: input.documentId, expectedRevision: computeRevision(await fs.readFile(target, 'utf8')), eventIds: updated.eventIds, changeSet: [{ regionId: 'title', beforeText: 'Synthetic readback failure title', afterText: updated.title }] })
  assert.equal(restored.ok, true, JSON.stringify(restored))
  updated = restored
  assert.equal((await failingStore.readDocument(input.documentId)).error, 'document-read-failed')
})
await test('P1-18 list uses descending updatedAt, not lexicographic filename order', async () => {
  const result = await store.listDocuments()
  assert.equal(result.ok, true)
  assert.deepEqual(result.documents.map((document) => document.documentId).slice(0, 2), ['synthetic-main-261110-0001', 'synthetic-other-261110-0002'])
  assert.ok(result.documents.some((document) => document.documentId === 'synthetic-alpha-261110-0001'))
  assert.ok(!result.documents.some((document) => 'content' in document || 'text' in document))
})
await test('P1-19 file symlink outside artifacts rejects create/read/update', async () => {
  const outside = path.join(root, 'synthetic-outside.md')
  const link = path.join(documents, 'synthetic-link-261110-0001.md')
  await fs.writeFile(outside, '# Synthetic outside\n', 'utf8')
  let linked = false
  try {
    await fs.symlink(outside, link, 'file')
    linked = true
    assert.equal((await store.createDocument({ ...input, documentId: 'synthetic-link-261110-0001' })).error, 'document-id-invalid')
    assert.equal((await store.readDocument('synthetic-link-261110-0001')).error, 'document-id-invalid')
    assert.equal((await store.updateDocument({ documentId: 'synthetic-link-261110-0001', expectedRevision: updated.revision, eventIds: updated.eventIds, changeSet: [] })).error, 'document-id-invalid')
    assert.equal(await fs.readFile(outside, 'utf8'), '# Synthetic outside\n')
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error
    console.log('       symlink creation unavailable; not counted as proof of symlink coverage')
  } finally {
    if (linked) await fs.unlink(link)
    await fs.unlink(outside)
  }
})
await test('P1-20 returned bytes and readback revision agree with disk', async () => {
  assert.equal(updated.bytes, Buffer.byteLength(await fs.readFile(target), 'utf8'))
  assert.equal((await store.readDocument(input.documentId)).revision, updated.revision)
})
await test('P1-21 title and eventIds regions both participate in committed revision', async () => {
  const result = await store.updateDocument({
    documentId: input.documentId, expectedRevision: updated.revision, eventIds: ['evt_a1b2c3d4'],
    changeSet: [
      { regionId: 'title', beforeText: updated.title, afterText: 'Synthetic title and association update' },
      { regionId: 'eventIds', beforeText: updated.eventIds.join(','), afterText: 'evt_a1b2c3d4' },
    ],
  })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.notEqual(result.revision, updated.revision)
  assert.equal(result.title, 'Synthetic title and association update')
  assert.deepEqual(result.eventIds, ['evt_a1b2c3d4'])
  updated = result
  const conflict = await store.updateDocument({
    documentId: input.documentId, expectedRevision: updated.revision, eventIds: ['evt_a1b2c3d4', 'evt_b2c3d4e5'],
    changeSet: [{ regionId: 'eventIds', beforeText: 'evt_a1b2c3d4', afterText: 'evt_a1b2c3d4' }],
  })
  assert.equal(conflict.error, 'event-ids-conflict')
  const before = await fs.readFile(target)
  const invalid = await store.updateDocument({ documentId: input.documentId, expectedRevision: updated.revision, eventIds: ['evt_a1b2c3d4'], changeSet: [{ regionId: 'title', beforeText: updated.title, afterText: '' }] })
  assert.equal(invalid.error, 'document-title-invalid')
  assert.ok(before.equals(await fs.readFile(target)))
})
await test('P1-22 new process computes exactly the same canonical revision', async () => {
  const protocolUrl = pathToFileURL(path.resolve('lib/ledger-doc/protocol.js')).href
  const script = 'import {computeRevision} from ' + JSON.stringify(protocolUrl) + '; console.log(computeRevision(' + JSON.stringify(updated.text) + '))'
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], { cwd: process.cwd(), windowsHide: true })
  assert.equal(stdout.trim(), updated.revision)
  assert.notEqual(computeRevision(updated.text.replace('Synthetic title', 'Different title')), updated.revision)
})
await test('P1-23 directory alias outside artifacts fails closed; regular root succeeds', async () => {
  const alias = path.join(root, 'synthetic-root-alias')
  try { await fs.unlink(alias) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fs.symlink(process.cwd(), alias, 'junction')
  try {
    const escaped = new LedgerDocumentStore(alias, { eventsPath })
    assert.equal((await escaped.readDocument(input.documentId)).error, 'document-root-invalid')
  } finally { await fs.unlink(alias) }
  assert.equal((await store.readDocument(input.documentId)).ok, true)
})
await test('P1-24 malformed UTF-8 is a read error, not a blank document', async () => {
  const malformed = path.join(documents, 'synthetic-invalid-utf8-261110-0001.md')
  await fs.writeFile(malformed, Buffer.from([0x23, 0x20, 0xff, 0x0a]))
  try { assert.equal((await store.readDocument('synthetic-invalid-utf8-261110-0001')).error, 'document-read-failed') } finally { await fs.unlink(malformed) }
  assert.equal((await store.readDocument(input.documentId)).ok, true)
})
await test('P1-25 blank title create rejects without file; nonempty title succeeds', async () => {
  const id = 'synthetic-title-261110-0001'
  const file = path.join(documents, id + '.md')
  try { await fs.unlink(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
  assert.equal((await store.createDocument({ documentId: id, title: ' ', eventIds: ['evt_a1b2c3d4'], content: 'Synthetic.' })).error, 'document-title-invalid')
  assert.equal(await fs.stat(file).then(() => true, (e) => e.code === 'ENOENT'), true)
  assert.equal(created.title.length > 0, true)
})
await test('P1-26 delivered new files have LF endings without mixed CRLF/bare LF', async () => {
  for (const file of ['lib/ledger-doc/protocol.js', 'lib/ledger-doc/document-store.js', 'tests/smoke/smoke-test-r4-ledger-doc.mjs']) {
    const text = (await fs.readFile(file)).toString('latin1')
    assert.equal(/\r\n/.test(text) && /(?<!\r)\n/.test(text), false, file)
  }
})

try {
console.log('')
console.log('=== Isolated mutation: red mutant, restored green ===')
const mutationRoot = path.resolve('artifacts', '_r4-p1-mutation')
await fs.mkdir(mutationRoot, { recursive: true })
const productionStore = await fs.readFile(path.resolve('lib/ledger-doc/document-store.js'), 'utf8')
const casAnchor = 'return currentRevision === expectedRevision'
const noopAnchor = 'return { ...current, noop: true }'
assert.equal(productionStore.split(casAnchor).length - 1, 1, 'CAS anchor exactly once')
assert.equal(productionStore.split(noopAnchor).length - 1, 1, 'noop anchor exactly once')

async function isolatedMutation(name, source) {
  const directory = path.join(mutationRoot, name)
  const caseDirectory = path.join(directory, 'case')
  await fs.mkdir(caseDirectory, { recursive: true })
  try { await fs.unlink(path.join(caseDirectory, 'synthetic-mutant-261110-0001.md')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  await fs.copyFile(path.resolve('lib/ledger-doc/protocol.js'), path.join(directory, 'protocol.js'))
  await fs.writeFile(path.join(directory, 'document-store.js'), source, 'utf8')
  const module = await import(pathToFileURL(path.join(directory, 'document-store.js')).href)
  return {
    directory,
    store: new module.LedgerDocumentStore(path.join(directory, 'case'), { eventsPath }),
    documentId: 'synthetic-mutant-261110-0001',
  }
}
async function seed(fixture) {
  return fixture.store.createDocument({ documentId: fixture.documentId, title: 'Synthetic mutant', eventIds: ['evt_a1b2c3d4'], content: 'Before mutation.' })
}
for (const [name, mutantSource] of [
  ['cas-removed', productionStore.replace(casAnchor, 'return true')],
  ['cas-inverted', productionStore.replace(casAnchor, 'return currentRevision !== expectedRevision')],
]) {
  const fixture = await isolatedMutation(name, mutantSource)
  const original = await seed(fixture)
  assert.equal(original.ok, true)
  const before = await fs.readFile(path.join(fixture.directory, 'case', fixture.documentId + '.md'))
  let red = false
  try {
    const result = await fixture.store.updateDocument({ documentId: fixture.documentId, expectedRevision: 'sha256:' + '0'.repeat(64), eventIds: ['evt_a1b2c3d4'], changeSet: [{ regionId: 'content', beforeText: 'Before mutation.', afterText: 'MUTANT COMMITTED.' }] })
    assert.equal(result.error, 'document-version-conflict', 'mutant accepted stale revision: ' + JSON.stringify(result))
    assert.ok(before.equals(await fs.readFile(path.join(fixture.directory, 'case', fixture.documentId + '.md'))))
  } catch (_) { red = true }
  await test('MUT-' + name + ' stale-CAS negative control becomes red', () => assert.equal(red, true))
  evidence.push({ kind: 'mutation', name, result: red ? 'CAUGHT' : 'MISSED' })
}
{
  const fixture = await isolatedMutation('noop-removed', productionStore.replace(noopAnchor, 'return { ...current, noop: false }'))
  const original = await seed(fixture)
  assert.equal(original.ok, true)
  const result = await fixture.store.updateDocument({ documentId: fixture.documentId, expectedRevision: original.revision, eventIds: ['evt_a1b2c3d4'], changeSet: [] })
  await test('MUT-noop-removed noop positive control becomes red', () => assert.notEqual(result.noop, true))
  evidence.push({ kind: 'mutation', name: 'noop-removed', result: result.noop !== true ? 'CAUGHT' : 'MISSED' })
}
{
  const fixture = await isolatedMutation('restored', productionStore)
  const original = await seed(fixture)
  assert.equal(original.ok, true)
  const stale = await fixture.store.updateDocument({ documentId: fixture.documentId, expectedRevision: 'sha256:' + '0'.repeat(64), eventIds: ['evt_a1b2c3d4'], changeSet: [] })
  const noop = await fixture.store.updateDocument({ documentId: fixture.documentId, expectedRevision: original.revision, eventIds: ['evt_a1b2c3d4'], changeSet: [] })
  await test('MUT-restored clean copy passes CAS and noop', () => {
    assert.equal(stale.error, 'document-version-conflict')
    assert.equal(noop.noop, true)
  })
  evidence.push({ kind: 'restored', name: 'restored', result: stale.error === 'document-version-conflict' && noop.noop === true ? 'GREEN' : 'RED' })
}
} finally {
  await test('CLEANUP removes only generated documents and preserves seed fixtures', async () => {
    for (const file of [target, other]) await fs.unlink(file)
    for (const file of [target, other]) assert.equal(await fs.stat(file).then(() => true, (e) => e.code === 'ENOENT'), true)
    assert.equal(await fs.stat(path.join(documents, 'synthetic-alpha-261110-0001.md')).then((s) => s.isFile()), true)
    assert.equal(await fs.stat(path.join(documents, 'synthetic-beta-261110-0002.md')).then((s) => s.isFile()), true)
  })
}
const results = { pass, fail, failures, evidence }
await fs.writeFile(path.join(root, 'test-results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((x) => x.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((x) => x.result === 'MISSED').length)
console.log('RESTORED ' + (evidence.find((x) => x.kind === 'restored')?.result || 'MISSING'))
process.exitCode = fail === 0 ? 0 : 1
