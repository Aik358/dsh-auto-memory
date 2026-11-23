import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'
import { LockedLedgerDocumentStore } from '../../lib/ledger-doc/locked-store.js'
import { LedgerWal } from '../../lib/ledger-doc/wal.js'
import { SyntheticEventSink } from '../../artifacts/_r4-p3-fixtures/event-sink.js'

let pass = 0
let fail = 0
const failures = []
const evidence = []
const root = path.resolve('artifacts', '_r4-p3-fixtures')
const cases = path.join(root, 'cases')
const sinkPath = path.join(root, 'events.json')
const selfPath = path.resolve('tests/smoke/smoke-test-r4-wal.mjs')
const ids = ['evt_a1b2c3d4', 'evt_b2c3d4e5']
const op = () => 'r4op_' + randomBytes(16).toString('hex')
const docId = 'synthetic-wal-261111-0001'
const fileFor = (dir) => path.join(dir, docId + '.md')
const count = (cps, phase) => cps.filter((item) => item.phase === phase).length
const inputs = (fixture, eventIds = [ids[0]], content = 'after', opId = op()) => ({
  documentId: docId, eventIds, expectedRevision: fixture.seed.revision, opId,
  changeSet: [{ regionId: 'content', beforeText: 'base', afterText: content }],
})
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}
async function fixture(name, options = {}, seedEventIds = ids) {
  const directory = path.join(cases, name)
  await fs.mkdir(directory, { recursive: true })
  // Reset only this synthetic case's known artifacts; never use a shared temp dir.
  for (const name of await fs.readdir(directory)) {
    if (name.startsWith(docId + '.md') || name.startsWith('.' + docId + '.md') || name === 'index.json') await fs.unlink(path.join(directory, name))
  }
  const sink = new SyntheticEventSink(sinkPath, options.sink)
  const base = new LedgerDocumentStore(directory, { eventsPath: sinkPath, fs: options.fs || fs, now: () => '2026-11-11T12:00:00.000Z' })
  const store = new LockedLedgerDocumentStore(base, { lockTimeoutMs: 1000 })
  const seed = await store.createDocument({ documentId: docId, title: 'Synthetic WAL', eventIds: seedEventIds, content: 'base' })
  assert.equal(seed.ok, true, JSON.stringify(seed))
  const wal = new LedgerWal(store, sink, { now: () => '2026-11-11T12:01:00.000Z' })
  return { directory, sink, store, base, wal, seed, file: fileFor(directory) }
}
async function removePhase(sink, opId, phase) {
  const state = await sink._read()
  for (const event of state.events) event.checkpoints = event.checkpoints.filter((item) => !(item.opId === opId && item.phase === phase))
  for (const key of Object.keys(state.appliedOps)) if (key.endsWith(':' + opId + ':' + phase)) delete state.appliedOps[key]
  await sink._write(state)
}
async function childKillProbe() {
  const current = await fixture('process-killed', {}, [ids[0]])
  const killedOpId = op()
  const worker = spawn(process.execPath, [selfPath, '--worker'], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stderr = ''
  worker.stderr.setEncoding('utf8')
  worker.stderr.on('data', (text) => { stderr += text })
  worker.send({ type: 'execute', directory: current.directory, input: inputs(current, [ids[0]], 'after', killedOpId) })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('child-prepared-timeout ' + stderr)), 10000)
    worker.on('message', (message) => { if (message.type === 'prepared') { clearTimeout(timer); resolve() } })
    worker.on('exit', () => { clearTimeout(timer); reject(new Error('child-exited-before-prepared ' + stderr)) })
  })
  worker.kill()
  const stopped = await new Promise((resolve) => worker.once('exit', (code, signal) => resolve({ code, signal })))
  assert.notEqual(stopped.code, 0)
  return { fixture: current, opId: killedOpId }
}
async function workerMain() {
  process.once('message', async (message) => {
    try {
      const base = new LedgerDocumentStore(message.directory, { eventsPath: sinkPath, now: () => '2026-11-11T12:00:00.000Z' })
      const store = new LockedLedgerDocumentStore(base)
      const sink = new SyntheticEventSink(sinkPath, { onAppend: async (checkpoint) => {
        if (checkpoint.phase === 'prepared') { process.send({ type: 'prepared' }); await new Promise(() => {}) }
      } })
      const wal = new LedgerWal(store, sink, { now: () => '2026-11-11T12:01:00.000Z' })
      await wal.execute(message.input)
    } catch (error) { console.error(error.stack); process.exitCode = 1; process.disconnect() }
  })
}

if (process.argv[2] === '--worker') {
  await workerMain()
} else {
await fs.mkdir(cases, { recursive: true })
await fs.writeFile(sinkPath, JSON.stringify({ schema: 'r4-synthetic-sink-v1', events: ids.map((id) => ({ id, status: 'active', checkpoints: [] })), appliedOps: {} }), 'utf8')

console.log('=== P3 normal WAL and auditable multi-event results ===')
const normal = await fixture('normal', {}, [ids[0]])
const normalOp = op()
await test('P3-01 single event executes Phase 0 through 3', async () => {
  const result = await normal.wal.execute(inputs(normal, [ids[0]], 'single', normalOp))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.phase, 3)
  assert.equal(result.document.content, 'single')
  assert.equal(result.operation.candidateRevision, result.document.revision)
  assert.equal(result.prepared.length, 1)
  assert.equal(result.committed.length, 1)
  assert.match(result.prepared[0].checkpointId, /^ckpt_[0-9a-f]{16}$/)
  const cps = await normal.sink.listCheckpoints(normalOp)
  assert.equal(count(cps, 'prepared'), 1)
  assert.equal(count(cps, 'committed'), 1)
  assert.equal(cps[0].storageOpId, normalOp + ':prepared')
  assert.equal(cps[1].storageOpId, normalOp + ':committed')
  assert.equal(cps[1].preparedCheckpointId, cps[0].checkpointId)
  assert.equal(cps.some((item) => item.documentText || item.text), false)
  const repeat = await normal.wal.replay(normalOp)
  assert.equal(repeat.ok, true, JSON.stringify(repeat))
  assert.equal((await normal.sink.listCheckpoints(normalOp)).length, 2)
  evidence.push({ kind: 'single', bytes: result.document.bytes, candidateRevision: result.document.revision })
  return result.document.revision
})
const multi = await fixture('multi-event')
await test('P3-02 two events share opId, each gets prepared and committed, one document write', async () => {
  const writes = []
  const originalWrite = multi.base._writeCandidate.bind(multi.base)
  multi.base._writeCandidate = async (...args) => { writes.push(args); return originalWrite(...args) }
  const result = await multi.wal.execute(inputs(multi, ids, 'multi'))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(writes.length, 1)
  assert.equal(result.prepared.length, 2)
  assert.equal(result.committed.length, 2)
  assert.equal(new Set(result.events.map((item) => item.eventId)).size, 2)
  assert.equal(new Set(result.events.map((item) => item.checkpoint.opId)).size, 1)
  assert.equal(result.document.content, 'multi')
  const cps = await multi.sink.listCheckpoints(result.operation.opId)
  assert.equal(cps.length, 4)
  assert.equal(result.document.content, 'multi')
})
await test('P3-03 exact same content is noop and appends no WAL', async () => {
  const result = await normal.wal.execute({
    documentId: docId, eventIds: [ids[0]], expectedRevision: (await normal.store.store.readDocument(docId)).revision,
    changeSet: [], opId: op(),
  })
  assert.equal(result.noop, true, JSON.stringify(result))
  assert.equal((await normal.sink.listCheckpoints(result.operation?.opId || '')).length, 0)
  assert.equal((await normal.sink.listCheckpoints(normalOp)).length, 2)
})

console.log('')
console.log('=== Protocol section 2.3 failure matrix ===')
await test('P3-04 invalid ID, incomplete changeSet, and Phase 0 CAS add no events', async () => {
  const f = await fixture('phase-zero', {}, [ids[0]])
  const initial = await f.sink._read()
  for (const input of [
    { documentId: '../invalid', eventIds: ids, expectedRevision: f.seed.revision, opId: op(), changeSet: [] },
    { ...inputs(f), changeSet: [{ regionId: 'content', beforeText: 'base', afterText: 'bad' }, { regionId: 'content', beforeText: 'base', afterText: 'again' }] },
    { ...inputs(f), expectedRevision: 'sha256:' + '0'.repeat(64) },
  ]) {
    const result = await f.wal.execute(input)
    assert.equal(result.ok, false)
    assert.equal(result.phase, 0)
    assert.ok(['document-id-invalid', 'changeset-invalid', 'document-version-conflict'].includes(result.error), JSON.stringify(result))
  }
  assert.ok((await fs.readFile(f.file)).equals(Buffer.from(f.seed.text)))
  assert.deepEqual((await f.sink._read()).events.map((item) => item.checkpoints.length), initial.events.map((item) => item.checkpoints.length))
  const good = await f.wal.execute(inputs(f, [ids[0]], 'phase-zero-positive'))
  assert.equal(good.ok, true)
})
await test('P3-05 first prepared failure aborts before document', async () => {
  const f = await fixture('prepared-first', {}, [ids[0]])
  f.sink.failAppend({ eventId: ids[0], phase: 'prepared' })
  const result = await f.wal.execute(inputs(f))
  assert.equal(result.error, 'aborted-before-document', JSON.stringify(result))
  assert.equal(result.prepared.length, 0)
  assert.equal(result.events[0].error, 'synthetic-prepared-failure')
  assert.equal((await f.store.store.readDocument(docId)).revision, f.seed.revision)
})
await test('P3-06 partial prepared is visible and document is untouched', async () => {
  const f = await fixture('prepared-partial')
  f.sink.failAppend({ eventId: ids[1], phase: 'prepared' })
  const result = await f.wal.execute(inputs(f, ids))
  assert.equal(result.error, 'aborted-before-document', JSON.stringify(result))
  assert.equal(result.prepared.length, 1)
  assert.equal(result.events[0].ok, true)
  assert.equal(result.events[1].ok, false)
  assert.equal((await f.store.store.readDocument(docId)).revision, f.seed.revision)
  assert.equal(count(await f.sink.listCheckpoints(result.operation.opId), 'prepared'), 1)
})
await test('P3-07 Phase 2 CAS competition preserves winner and leaves prepared', async () => {
  const f = await fixture('phase-two-cas', {}, [ids[0]])
  let raced = false
  f.sink.onAppend = async () => {
    if (raced) return
    raced = true
    const winner = await f.store.store.updateDocument({ documentId: docId, eventIds: [ids[0]], expectedRevision: f.seed.revision, changeSet: [{ regionId: 'content', beforeText: 'base', afterText: 'competitor' }] })
    assert.equal(winner.ok, true)
  }
  const result = await f.wal.execute(inputs(f))
  assert.equal(result.error, 'document-version-conflict', JSON.stringify(result))
  assert.equal(result.phase, 2)
  assert.equal(result.prepared.length, 1)
  assert.equal((await f.store.store.readDocument(docId)).content, 'competitor')
  assert.equal(count(await f.sink.listCheckpoints(result.operation.opId), 'committed'), 0)
})
for (const [name, targetCommitted] of [['write-old', false], ['write-target', true]]) {
  await test('P3-08 ' + name + ' atomic exception records actual revision and preserves changeSet', async () => {
    const f = await fixture(name, {}, [ids[0]])
    let failRead = false
    const fault = Object.assign({}, fs, {
      rename: targetCommitted ? async (from, to) => { await fs.rename(from, to); failRead = true } : async () => { throw Object.assign(new Error('synthetic-rename'), { code: 'EIO' }) },
      readFile: targetCommitted ? async (file, ...args) => { if (file === f.file && failRead) throw Object.assign(new Error('synthetic-readback'), { code: 'EIO' }); return fs.readFile(file, ...args) } : fs.readFile,
    })
    const store = new LockedLedgerDocumentStore(new LedgerDocumentStore(f.directory, { eventsPath: sinkPath, fs: fault }))
    const wal = new LedgerWal(store, f.sink, { now: () => '2026-11-11T12:01:00.000Z' })
    const result = await wal.execute(inputs(f))
    assert.ok(['document-write-failed', 'document-readback-failed'].includes(result.error), JSON.stringify(result))
    assert.equal(result.actualRevision, targetCommitted ? result.operation.candidateRevision : f.seed.revision)
    assert.equal(result.documentCommitted, targetCommitted)
    assert.deepEqual(result.changeSet, result.operation.changeSet)
    assert.equal(result.failed.length, 1)
    const cps = await f.sink.listCheckpoints(result.operation.opId)
    assert.equal(count(cps, 'failed'), 1)
    const failed = cps.find((item) => item.phase === 'failed')
    assert.equal(failed.revision, result.actualRevision)
    assert.equal(failed.errorCode, result.error)
    assert.equal(failed.preparedCheckpointId, result.prepared[0].checkpointId)
    evidence.push({ kind: name, actualRevision: result.actualRevision, targetCommitted })
  })
}
await test('P3-09 committed partial failure retains target and exposes partial events', async () => {
  const f = await fixture('committed-partial')
  f.sink.failAppend({ eventId: ids[1], phase: 'committed' })
  const result = await f.wal.execute(inputs(f, ids))
  assert.equal(result.error, 'event-commit-failed', JSON.stringify(result))
  assert.equal(result.documentCommitted, true)
  assert.equal(result.eventComplete, false)
  assert.equal(result.committed.filter((item) => item.ok).length, 1)
  assert.equal(result.committed.filter((item) => !item.ok).length, 1)
  assert.equal((await f.store.store.readDocument(docId)).revision, result.operation.candidateRevision)
  assert.equal(count(await f.sink.listCheckpoints(result.operation.opId), 'committed'), 1)
})
await test('P3-10 index failure marks stale without changing document or committed', async () => {
  const f = await fixture('index-failure', {}, [ids[0]])
  const result = await f.wal.execute(inputs(f), { reindex: async () => { throw new Error('synthetic-index') } })
  assert.equal(result.error, 'index-write-failed', JSON.stringify(result))
  assert.equal(result.indexStale, true)
  assert.equal(result.committed.length, 1)
  assert.equal((await f.store.store.readDocument(docId)).revision, result.operation.candidateRevision)
  assert.equal(count(await f.sink.listCheckpoints(result.operation.opId), 'committed'), 1)
})
await test('P3-11 cache refresh failure is stale only; subsequent read uses disk', async () => {
  const f = await fixture('cache-failure', {}, [ids[0]])
  const result = await f.wal.execute(inputs(f), { refreshCache: async () => { throw new Error('synthetic-cache') } })
  assert.equal(result.error, 'cache-refresh-failed', JSON.stringify(result))
  assert.equal(result.cacheStale, true)
  assert.equal(result.indexStale, false)
  assert.equal((await f.store.store.readDocument(docId)).revision, result.operation.candidateRevision)
  assert.equal(count(await f.sink.listCheckpoints(result.operation.opId), 'committed'), 1)
})
await test('P3-12 killed child after prepared reconciles to committed with no partial file', async () => {
  const { fixture: f, opId: killedOpId } = await childKillProbe()
  const operation = { opId: killedOpId, checkpoints: await f.sink.listCheckpoints(killedOpId) }
  assert.equal(operation.checkpoints.length, 1)
  assert.equal(operation.checkpoints[0].phase, 'prepared')
  const before = await f.store.store.readDocument(docId)
  assert.equal(before.revision, f.seed.revision)
  assert.deepEqual((await fs.readdir(f.directory)).filter((item) => item.endsWith('.tmp')), [])
  const replay = await f.wal.replay(operation.opId)
  assert.equal(replay.ok, true, JSON.stringify(replay))
  assert.equal(replay.document.content, 'after')
  const cps = await f.sink.listCheckpoints(operation.opId)
  assert.equal(count(cps, 'prepared'), 1)
  assert.equal(count(cps, 'committed'), 1)
  evidence.push({ kind: 'killed-child', checkpoints: cps.length, bytes: replay.document.bytes })
})

console.log('')
console.log('=== Recovery, digest binding, and ledger eviction ===')
const recovery = await fixture('recovery', {}, [ids[0]])
const recoveryOp = op()
const recoveredExecution = await recovery.wal.execute(inputs(recovery, [ids[0]], 'reconstructed', recoveryOp))
assert.equal(recoveredExecution.ok, true)
await test('P3-13 prepared changeSet reconstructs byte-equivalent target after restoring baseline', async () => {
  const target = recoveredExecution.document.text
  await removePhase(recovery.sink, recoveryOp, 'committed')
  await fs.writeFile(recovery.file, recovery.seed.text)
  const result = await recovery.wal.replay(recoveryOp)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.document.text, target)
  assert.equal(result.document.revision, recoveredExecution.document.revision)
  assert.equal(result.noop, false)
})
await test('P3-14 incomplete prepared changeSet is rejected, not silently reconstructed', async () => {
  const f = await fixture('missing-region', {}, [ids[0]])
  const result = await f.wal.execute(inputs(f))
  assert.equal(result.ok, true, JSON.stringify(result))
  await removePhase(f.sink, result.operation.opId, 'committed')
  const state = await f.sink._read()
  state.events[0].checkpoints.find((item) => item.opId === result.operation.opId && item.phase === 'prepared').changeSet = []
  await f.sink._write(state)
  await fs.writeFile(f.file, f.seed.text)
  const replay = await f.wal.replay(result.operation.opId)
  assert.equal(replay.error, 'op-payload-mismatch', JSON.stringify(replay))
  assert.equal((await f.store.store.readDocument(docId)).revision, f.seed.revision)
})
await test('P3-15 reconcile fills committed only when disk already holds target', async () => {
  await removePhase(recovery.sink, recoveryOp, 'committed')
  const result = await recovery.wal.reconcile({ opIds: [recoveryOp] })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.count, 1)
  const replayed = result.results[0]
  assert.equal(replayed.noop, true)
  assert.equal(replayed.document.revision, recoveredExecution.document.revision)
  assert.equal(count(await recovery.sink.listCheckpoints(recoveryOp), 'committed'), 1)
})
await test('P3-16 replay is idempotent and evicted ledgers recover from checkpoints', async () => {
  const before = (await recovery.sink.listCheckpoints(recoveryOp)).length
  const again = await recovery.wal.replay(recoveryOp)
  assert.equal(again.ok, true)
  assert.equal(again.noop, true)
  assert.equal((await recovery.sink.listCheckpoints(recoveryOp)).length, before)
  await recovery.sink.evictLedger()
  await removePhase(recovery.sink, recoveryOp, 'committed')
  const rebuilt = await recovery.wal.replay(recoveryOp)
  assert.equal(rebuilt.ok, true, JSON.stringify(rebuilt))
  const committed = (await recovery.sink.listCheckpoints(recoveryOp)).find((item) => item.phase === 'committed')
  await recovery.sink.evictLedger()
  const deduped = await recovery.sink.append(ids[0], {
    phase: 'committed', opId: recoveryOp, operationDigest: committed.operationDigest,
    checkpoint: { kind: committed.kind, documentId: committed.documentId, revision: committed.revision, candidateRevision: committed.candidateRevision, preparedCheckpointId: committed.preparedCheckpointId, operationDigest: committed.operationDigest, changeSet: committed.changeSet, errorCode: committed.errorCode, documentCommitted: committed.documentCommitted },
  })
  assert.equal(deduped.deduped, true, JSON.stringify(deduped))
  assert.equal(count(await recovery.sink.listCheckpoints(recoveryOp), 'committed'), 1)
})
await test('P3-17 same opId with different payload rejects; positive replay dedupes', async () => {
  const prepared = (await normal.sink.listCheckpoints(normalOp)).find((item) => item.opId === normalOp && item.phase === 'prepared')
  assert.ok(prepared)
  const committedBefore = await normal.sink.listCheckpoints(normalOp)
  const committed = committedBefore.find((item) => item.opId === normalOp && item.phase === 'committed')
  assert.ok(committed)
  const again = await normal.sink.append(ids[0], { phase: 'committed', opId: normalOp, operationDigest: committed.operationDigest, checkpoint: { kind: committed.kind, documentId: committed.documentId, revision: committed.revision, candidateRevision: committed.candidateRevision, preparedCheckpointId: committed.preparedCheckpointId, operationDigest: committed.operationDigest, changeSet: committed.changeSet, errorCode: committed.errorCode, documentCommitted: committed.documentCommitted } })
  assert.equal(again.deduped, true, JSON.stringify(again))
  const bad = await normal.sink.append(ids[0], { phase: 'prepared', opId: normalOp, operationDigest: prepared.operationDigest, checkpoint: { kind: 'wal-prepared', ...Object.fromEntries(Object.entries(prepared).filter(([key]) => ['schema', 'documentId', 'eventIds', 'baseRevision', 'expectedRevision', 'candidateRevision', 'operationDigest', 'changeSet', 'updatedAt', 'sections', 'summary'].includes(key))), summary: 'different payload' } })
  assert.equal(bad.error, 'op-payload-mismatch')
  const replay = await normal.wal.replay(normalOp)
  assert.equal(replay.ok, true, JSON.stringify(replay))
  assert.equal(count(await normal.sink.listCheckpoints(normalOp), 'committed'), 1)
})
await test('P3-18 legacy numeric ledger is unverifiable, new object ledger is valid', async () => {
  const committed = (await normal.sink.listCheckpoints(normalOp)).find((item) => item.opId === normalOp && item.phase === 'committed')
  const payload = { kind: committed.kind, documentId: committed.documentId, revision: committed.revision, candidateRevision: committed.candidateRevision, preparedCheckpointId: committed.preparedCheckpointId, operationDigest: committed.operationDigest, changeSet: committed.changeSet, errorCode: committed.errorCode, documentCommitted: committed.documentCommitted }
  await normal.sink.setLegacyAppliedOp(ids[0], normalOp + ':committed', 12345)
  const legacy = await normal.sink.append(ids[0], { phase: 'committed', opId: normalOp, operationDigest: committed.operationDigest, checkpoint: payload })
  assert.equal(legacy.error, 'op-payload-unverifiable')
  const state = await normal.sink._read()
  state.appliedOps[ids[0] + ':' + normalOp + ':committed'] = { at: 12345, operationDigest: committed.operationDigest, payloadDigest: committed.payloadDigest }
  await normal.sink._write(state)
  const valid = await normal.sink.append(ids[0], { phase: 'committed', opId: normalOp, operationDigest: committed.operationDigest, checkpoint: payload })
  assert.equal(valid.deduped, true, JSON.stringify(valid))
})

console.log('')
console.log('=== Isolated mutation: four named oracles must turn red ===')
const mutationRoot = path.resolve('artifacts', '_r4-p3-mutation')
const mutationLib = path.join(mutationRoot, 'lib', 'ledger-doc')
await fs.mkdir(mutationLib, { recursive: true })
for (const name of ['protocol.js', 'document-store.js', 'locked-store.js']) await fs.copyFile(path.join('lib/ledger-doc', name), path.join(mutationLib, name))
await fs.copyFile('lib/shared-state-lock.js', path.join(mutationRoot, 'lib', 'shared-state-lock.js'))
const clean = await fs.readFile('lib/ledger-doc/wal.js', 'utf8')
const sinkSource = await fs.readFile('artifacts/_r4-p3-fixtures/event-sink.js', 'utf8')
const preparedAnchor = "if (!result.ok) return fail('aborted-before-document'"
const committedAnchor = "const committed = await this._terminal(operation, prepared, 'committed', committedDocument.document)"
const digestAnchor = "if (!existing || existing.operationDigest !== operationDigest || existing.payloadDigest !== payloadDigest)"
for (const [source, anchor] of [[clean, preparedAnchor], [clean, committedAnchor], [sinkSource, digestAnchor]]) assert.equal(source.split(anchor).length - 1, 1, anchor)
const mutants = {
  'prepared-removed': clean.replace(preparedAnchor, "if (false) return fail('aborted-before-document'").replace('if (!prepared.length)', 'if (false)'),
  'committed-removed': clean.replace(committedAnchor, 'const committed = []'),
  'phase-key-removed': sinkSource.replace("opId + ':' + phase", 'opId'),
  'digest-removed': sinkSource.replace(digestAnchor, 'if (false)'),
}
for (const [name, source] of Object.entries(mutants)) {
  const dir = path.join(mutationRoot, name, 'lib', 'ledger-doc')
  const target = path.join(dir, 'wal-' + name + '.js')
  await fs.mkdir(dir, { recursive: true })
  for (const dependency of ['protocol.js', 'document-store.js', 'locked-store.js']) await fs.copyFile(path.join('lib/ledger-doc', dependency), path.join(dir, dependency))
  await fs.copyFile('lib/shared-state-lock.js', path.join(mutationRoot, name, 'lib', 'shared-state-lock.js'))
  const isSink = name === 'phase-key-removed' || name === 'digest-removed'
  await fs.writeFile(target, isSink ? clean : source)
  const sinkFile = path.join(dir, 'event-sink-' + name + '.js')
  await fs.writeFile(sinkFile, isSink ? source : sinkSource)
  const module = await import(pathToFileURL(target).href)
  const sinkModule = await import(pathToFileURL(sinkFile).href)
  const f = await fixture('mutation-' + name, {}, [ids[0]])
  const wal = new module.LedgerWal(f.store, new sinkModule.SyntheticEventSink(sinkPath), { now: () => '2026-11-11T12:01:00.000Z' })
  const operation = inputs(f, [ids[0]], 'mutation-' + name)
  let red = false
  let detail
  try {
    const result = await wal.execute(operation)
    if (name === 'prepared-removed') {
      assert.equal(result.ok, true)
      const replay = await wal.replay(operation.opId)
      assert.equal(replay.error, 'wal-prepared-missing', 'missing prepared must make recovery red')
    } else if (name === 'committed-removed') {
      assert.equal(result.ok, true)
      const cps = await wal.eventSink.listCheckpoints(operation.opId)
      assert.equal(count(cps, 'committed'), 1, 'committed missing')
    } else {
      const prepared = (await wal.eventSink.listCheckpoints(operation.opId)).find((item) => item.phase === 'prepared')
      assert.ok(prepared)
      assert.equal(count(await wal.eventSink.listCheckpoints(operation.opId), 'committed'), 1)
      const changed = await wal.eventSink.append(ids[0], { phase: 'prepared', opId: operation.opId, operationDigest: prepared.operationDigest, checkpoint: { kind: 'wal-prepared', ...Object.fromEntries(Object.entries(prepared).filter(([key]) => ['schema', 'documentId', 'eventIds', 'baseRevision', 'expectedRevision', 'candidateRevision', 'operationDigest', 'changeSet', 'updatedAt', 'sections', 'summary'].includes(key))), summary: 'MUTATED PAYLOAD' } })
      assert.equal(changed.error, 'op-payload-mismatch', 'different payload accepted: ' + JSON.stringify(changed))
    }
  } catch (error) { red = true; detail = error.message }
  await fs.writeFile(target, clean)
  await fs.writeFile(sinkFile, sinkSource)
  await test('MUT-' + name + ' required oracle becomes red', () => assert.equal(red, true, detail || 'MISSED'))
  evidence.push({ kind: 'mutation', name, result: red ? 'CAUGHT' : 'MISSED', detail })
}
await test('MUT-restored clean WAL and sink remain green', async () => {
  assert.equal(clean.includes(preparedAnchor), true)
  assert.equal(clean.includes(committedAnchor), true)
  assert.equal(sinkSource.includes(digestAnchor), true)
  const f = await fixture('mutation-restored', {}, [ids[0]])
  const result = await f.wal.execute(inputs(f))
  assert.equal(result.ok, true)
  const replay = await f.wal.replay(result.operation.opId)
  assert.equal(replay.ok, true)
  assert.equal((await f.sink.listCheckpoints(result.operation.opId)).length, 2)
})
evidence.push({ kind: 'restored', result: 'GREEN' })
await test('P3-19 delivered source and fixture files use LF without mixed endings', async () => {
  for (const file of ['lib/ledger-doc/wal.js', 'artifacts/_r4-p3-fixtures/event-sink.js', 'tests/smoke/smoke-test-r4-wal.mjs']) {
    const bytes = await fs.readFile(file)
    const text = bytes.toString('latin1')
    const crlf = String.fromCharCode(13, 10)
    assert.equal(text.includes(crlf) && text.split(crlf).join('').includes(String.fromCharCode(10)), false, file)
    evidence.push({ kind: 'file', file, bytes: bytes.length })
  }
})
await fs.writeFile(path.join(root, 'test-results.json'), JSON.stringify({ pass, fail, failures, evidence }, null, 2) + String.fromCharCode(10))
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((item) => item.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((item) => item.result === 'MISSED').length)
console.log('RESTORED ' + (evidence.find((item) => item.kind === 'restored')?.result || 'MISSING'))
process.exitCode = fail === 0 ? 0 : 1
}
