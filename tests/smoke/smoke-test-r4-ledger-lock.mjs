import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'
import { LockedLedgerDocumentStore } from '../../lib/ledger-doc/locked-store.js'
import { acquireSharedStateLock } from '../../lib/shared-state-lock.js'

let pass = 0
let fail = 0
const failures = []
const evidence = []
const children = new Set()
const root = path.resolve('artifacts', '_r4-p2a-fixtures')
const documents = path.join(root, 'documents')
const eventsPath = path.join(root, 'events.json')
const eventIds = ['evt_a1b2c3d4']
const selfPath = path.resolve('tests/smoke/smoke-test-r4-ledger-lock.mjs')
const sleep = (ms) => delay(ms)

async function test(name, action) {
  try {
    const detail = await action()
    pass++
    console.log('  ok   - ' + name + (detail ? ' :: ' + detail : ''))
  } catch (error) {
    fail++
    failures.push({ name, error: error.message })
    console.log('  FAIL - ' + name + ' :: ' + error.stack)
  }
}
function newStore(directory = documents, options = {}) {
  const base = new LedgerDocumentStore(directory, { eventsPath, ...options })
  return new LockedLedgerDocumentStore(base, { lockTimeoutMs: 8000, ...options })
}
async function seed(store, documentId, content = 'base') {
  const result = await store.createDocument({ documentId, title: 'Synthetic ' + documentId, eventIds, content })
  assert.equal(result.ok, true, JSON.stringify(result))
  return result
}
function edit(documentId, expectedRevision, beforeText, afterText) {
  return { documentId, expectedRevision, eventIds, changeSet: [{ regionId: 'content', beforeText, afterText }] }
}
function launch(args) {
  const child = spawn(process.execPath, [selfPath, '--worker', ...args], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  children.add(child)
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (s) => { stdout += s })
  child.stderr.on('data', (s) => { stderr += s })
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('worker-timeout: ' + args.join(' ') + ' stderr=' + stderr)) }, 15000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); children.delete(child); resolve({ code, signal, stdout, stderr }) })
  })
  return { child, exited, stdout: () => stdout, stderr: () => stderr }
}
async function updateWorker(modulePath, directory, input, barrier = null) {
  const worker = launch(['update', modulePath, directory, JSON.stringify(input), barrier ? JSON.stringify(barrier) : ''])
  const result = await worker.exited
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout.trim())
}
async function holdWorker(documentId, directory = documents) {
  const worker = launch(['hold', path.resolve('lib/ledger-doc/locked-store.js'), directory, documentId])
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('hold-not-acquired: ' + worker.stderr())), 10000)
    worker.child.on('message', (message) => {
      if (message.type === 'acquired') { clearTimeout(timer); resolve() }
    })
    worker.child.once('exit', () => { clearTimeout(timer); reject(new Error('holder-exited-before-acquired: ' + worker.stderr())) })
  })
  return worker
}
async function names(directory) { return (await fs.readdir(directory)).sort() }

async function workerMain(args) {
  const [mode, modulePath, directory, payload, barrierText] = args
  const { LockedLedgerDocumentStore: WorkerStore } = await import(pathToFileURL(modulePath).href)
  const options = {}
  let barrier = null
  if (barrierText) {
    barrier = JSON.parse(barrierText)
    options.fs = {
      ...fs,
      async rename(from, to) {
        // The barrier is before rename: both processes have already passed
        // the inner CAS against the same bytes, then both commit their temp.
        await fs.writeFile(path.join(barrier.directory, 'renamed-' + barrier.label), 'ready')
        const other = barrier.label === 'a' ? 'b' : 'a'
        const marker = path.join(barrier.directory, 'renamed-' + other)
        for (let i = 0; i < 500; i++) {
          try { await fs.stat(marker); break } catch (error) { if (error.code !== 'ENOENT') throw error }
          await sleep(10)
        }
        if (!(await fs.stat(marker).then(() => true, () => false))) throw new Error('mutation-rename-barrier-timeout')
        await fs.rename(from, to)
      },
    }
  }
  const base = new LedgerDocumentStore(directory, { eventsPath, ...options })
  const store = new WorkerStore(base, { lockTimeoutMs: barrier ? 500 : 6000 })
  if (mode === 'update') {
    const result = await store.updateDocument(JSON.parse(payload))
    process.stdout.write(JSON.stringify(result))
    return
  }
  if (mode === 'hold') {
    await store.withDocumentLock(payload, async () => {
      process.send({ type: 'acquired', pid: process.pid })
      await new Promise((resolve) => {
        process.once('message', (message) => { if (message.type === 'release') resolve() })
      })
    })
    if (process.connected) process.disconnect()
    return
  }
  throw new Error('unknown-worker-mode')
}

if (process.argv[2] === '--worker') {
  await workerMain(process.argv.slice(3))
} else {
await fs.mkdir(documents, { recursive: true })
await fs.writeFile(eventsPath, JSON.stringify({ schema: 'r4-synthetic-events-v1', synthetic: true, events: [{ id: eventIds[0], status: 'active', name: 'Synthetic lock event' }] }), 'utf8')
for (const name of await fs.readdir(documents)) {
  if (name.startsWith('synthetic-lock-') && (name.endsWith('.md') || name.endsWith('.tmp') || name.includes('.lock'))) await fs.unlink(path.join(documents, name))
}

const mainId = 'synthetic-lock-main-261111-0001'
const otherId = 'synthetic-lock-other-261111-0002'
const store = newStore()
const original = await seed(store, mainId)
await seed(store, otherId)

console.log('=== P2A real wrapper, lock identity, and positive controls ===')
await test('P2A-01 real create/update/read calls and full critical section', async () => {
  const result = await store.updateDocument(edit(mainId, original.revision, 'base', 'local-control'))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.content, 'local-control')
  const states = store.lockSequence.filter((x) => x.resource === 'document').map((x) => x.state)
  assert.deepEqual(states.slice(-3), ['acquired', 'released', 'unlocked'])
  evidence.push({ kind: 'local-update', revision: result.revision, bytes: result.bytes })
  return result.revision
})
await test('P2A-02 lock argument equals MemoryDocumentStore filePath+.lock', async () => {
  const calls = []
  const adapted = new LockedLedgerDocumentStore(new LedgerDocumentStore(documents, { eventsPath }), {
    withLock: async (file, job) => { calls.push(file); return acquireSharedStateLock(file, { timeoutMs: 1000 }).then((release) => Promise.resolve(job()).finally(release)) },
  })
  const current = await adapted.store.readDocument(mainId)
  const result = await adapted.updateDocument(edit(mainId, current.revision, 'local-control', 'adapter-control'))
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(calls[0], path.join(documents, mainId + '.md') + '.lock')
  assert.equal(calls[0].endsWith('.md.lock'), true)
  return calls[0]
})
await test('P2A-03 nested document/index locks reject; sequential locks succeed', async () => {
  let innerRan = false
  const outer = await store.withDocumentLock(mainId, async () => {
    const inner = await store.withIndexLock(path.join(root, 'index.json'), async () => { innerRan = true })
    assert.equal(inner.error, 'lock-nesting-forbidden')
    return 'outer-ok'
  })
  assert.equal(outer, 'outer-ok')
  assert.equal(innerRan, false)
  const indexed = await store.withIndexLock(path.join(root, 'index.json'), async () => ({ ok: true }))
  assert.equal(indexed.ok, true)
  assert.equal(store.lockContext.getStore(), undefined)
})

console.log('')
console.log('=== Two real Node processes ===')
const concurrentId = 'synthetic-lock-concurrent-261111-0003'
const concurrent = await seed(store, concurrentId)
await test('P2A-04 same document/same revision: one winner and one conflict', async () => {
  const modulePath = path.resolve('lib/ledger-doc/locked-store.js')
  const results = await Promise.all([
    updateWorker(modulePath, documents, edit(concurrentId, concurrent.revision, 'base', 'writer-a')),
    updateWorker(modulePath, documents, edit(concurrentId, concurrent.revision, 'base', 'writer-b')),
  ])
  const winners = results.filter((x) => x.ok)
  const conflicts = results.filter((x) => x.error === 'document-version-conflict')
  assert.equal(winners.length, 1, JSON.stringify(results))
  assert.equal(conflicts.length, 1, JSON.stringify(results))
  const final = await store.store.readDocument(concurrentId)
  assert.equal(final.revision, winners[0].revision)
  assert.equal(final.content, winners[0].content)
  evidence.push({ kind: 'same-document', results: results.map((x) => ({ ok: x.ok, error: x.error, revision: x.revision })), bytes: final.bytes })
  return winners[0].revision
})
await test('P2A-05 different documents both succeed and retain both updates', async () => {
  const a = await store.store.readDocument(mainId)
  const b = await store.store.readDocument(otherId)
  const modulePath = path.resolve('lib/ledger-doc/locked-store.js')
  const results = await Promise.all([
    updateWorker(modulePath, documents, edit(mainId, a.revision, 'adapter-control', 'parallel-a')),
    updateWorker(modulePath, documents, edit(otherId, b.revision, 'base', 'parallel-b')),
  ])
  assert.deepEqual(results.map((x) => x.ok), [true, true], JSON.stringify(results))
  assert.equal((await store.store.readDocument(mainId)).content, 'parallel-a')
  assert.equal((await store.store.readDocument(otherId)).content, 'parallel-b')
  evidence.push({ kind: 'different-documents', results: results.map((x) => ({ revision: x.revision, bytes: x.bytes })) })
})

console.log('')
console.log('=== Dead owner, live owner, and failure boundaries ===')
await test('P2A-06 killed lock owner is reclaimed; committed document remains whole', async () => {
  const before = await store.store.readDocument(mainId)
  const holder = await holdWorker(mainId)
  const lockFile = path.join(documents, mainId + '.md.lock.lock')
  const owner = JSON.parse(await fs.readFile(lockFile, 'utf8'))
  assert.equal(owner.pid, holder.child.pid)
  holder.child.kill()
  const stopped = await holder.exited
  assert.notEqual(stopped.code, 0)
  const recovered = await store.updateDocument(edit(mainId, before.revision, 'parallel-a', 'after-dead-owner'))
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
  assert.equal(recovered.content, 'after-dead-owner')
  assert.equal(recovered.revision, computeRevisionForEvidence(recovered.text))
  const temporary = (await names(documents)).filter((x) => x.endsWith('.tmp'))
  assert.deepEqual(temporary, [])
  evidence.push({ kind: 'dead-owner', killedPid: owner.pid, recoveredRevision: recovered.revision, bytes: recovered.bytes })
})
function computeRevisionForEvidence(text) {
  const match = text.match(/^revision: (sha256:[0-9a-f]{64})$/m)
  assert.ok(match)
  return match[1]
}
await test('P2A-07 live lock owner causes bounded timeout and zero document change', async () => {
  const before = await fs.readFile(path.join(documents, mainId + '.md'))
  const current = await store.store.readDocument(mainId)
  const holder = await holdWorker(mainId)
  const started = Date.now()
  const blocked = await store.updateDocument(edit(mainId, current.revision, 'after-dead-owner', 'must-not-write'), { timeoutMs: 150 })
  assert.equal(blocked.error, 'lock-unavailable', JSON.stringify(blocked))
  assert.match(blocked.cause, /state-lock-timeout/)
  assert.ok(Date.now() - started < 5000)
  assert.ok(before.equals(await fs.readFile(path.join(documents, mainId + '.md'))))
  holder.child.send({ type: 'release' })
  const stopped = await holder.exited
  assert.equal(stopped.code, 0, stopped.stderr)
  const after = await store.updateDocument(edit(mainId, current.revision, 'after-dead-owner', 'after-live-owner'))
  assert.equal(after.ok, true, JSON.stringify(after))
  evidence.push({ kind: 'live-owner', blocked: blocked.error, elapsedMs: Date.now() - started })
})
await test('P2A-08 write failure before rename cleans temp and releases lock; retry succeeds', async () => {
  const current = await store.store.readDocument(mainId)
  const fault = Object.assign({}, fs, {
    async rename() { throw Object.assign(new Error('synthetic-rename-failure'), { code: 'EIO' }) },
  })
  const failing = newStore(documents, { fs: fault })
  const failed = await failing.updateDocument(edit(mainId, current.revision, 'after-live-owner', 'must-not-commit'))
  assert.equal(failed.error, 'document-write-failed', JSON.stringify(failed))
  assert.equal(failed.documentMayHaveChanged, false)
  assert.equal((await store.store.readDocument(mainId)).content, 'after-live-owner')
  assert.deepEqual((await names(documents)).filter((x) => x.endsWith('.tmp')), [])
  const retry = await store.updateDocument(edit(mainId, current.revision, 'after-live-owner', 'retry-after-write-failure'))
  assert.equal(retry.ok, true, JSON.stringify(retry))
})
await test('P2A-09 exception after in-lock direct write does not roll back; pre-write exception preserves bytes', async () => {
  const id = 'synthetic-lock-failure-261111-0004'
  await seed(store, id)
  const file = path.join(documents, id + '.md')
  const originalBytes = await fs.readFile(file)
  await assert.rejects(store.withDocumentLock(id, async () => { throw new Error('before-write') }), /before-write/)
  assert.ok(originalBytes.equals(await fs.readFile(file)))
  await assert.rejects(store.withDocumentLock(id, async () => {
    await fs.writeFile(file, 'synthetic-half-document')
    throw new Error('after-write-no-rollback')
  }), /after-write-no-rollback/)
  assert.equal(await fs.readFile(file, 'utf8'), 'synthetic-half-document')
  const lockStillHeld = await fs.stat(file + '.lock.lock').then(() => true, (e) => e.code === 'ENOENT' ? false : Promise.reject(e))
  assert.equal(lockStillHeld, false)
  evidence.push({ kind: 'no-rollback', bytes: Buffer.byteLength('synthetic-half-document') })
})

console.log('')
console.log('=== Sequential D/E/D/E/I and per-resource failure results ===')
await test('P2A-10 D-read/release, E-prepared, D-write/release, E-committed, I-reindex', async () => {
  const current = await store.store.readDocument(otherId)
  const phases = []
  const lockFile = path.join(documents, otherId + '.md.lock.lock')
  const absent = async () => !(await fs.stat(lockFile).then(() => true, (e) => e.code === 'ENOENT' ? false : Promise.reject(e)))
  const result = await store.runOperation({
    documentId: otherId, expectedRevision: current.revision, eventIds,
    changeSet: [{ regionId: 'content', beforeText: 'parallel-b', afterText: 'ordered-operation' }],
    prepareEvents: async () => { assert.equal(await absent(), true); phases.push('E-prepared'); return { ok: true, status: 'prepared', synthetic: true } },
    commitEvents: async (prepared) => { assert.equal(await absent(), true); assert.equal(prepared.status, 'prepared'); phases.push('E-committed'); return { ok: true } },
    reindex: async (written) => { assert.equal(written.ok, true); phases.push('I-reindex'); return { ok: true } },
  }, { indexPath: path.join(root, 'index.json') })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.deepEqual(phases, ['E-prepared', 'E-committed', 'I-reindex'])
  const acquired = store.lockSequence.filter((x) => x.state === 'acquired').map((x) => x.resource)
  assert.deepEqual(acquired.slice(-3), ['document', 'document', 'index'])
})
await test('P2A-11 index failure preserves winner and marks stale; positive reindex succeeds', async () => {
  const current = await store.store.readDocument(otherId)
  const input = {
    documentId: otherId, expectedRevision: current.revision, eventIds,
    changeSet: [{ regionId: 'content', beforeText: 'ordered-operation', afterText: 'winner-despite-index' }],
    reindex: async () => { throw new Error('synthetic-index-failure') },
  }
  const result = await store.runOperation(input, { indexPath: path.join(root, 'index.json') })
  assert.equal(result.error, 'index-write-failed', JSON.stringify(result))
  assert.equal(result.indexStale, true)
  assert.equal(result.document.ok, true)
  assert.equal((await store.store.readDocument(otherId)).content, 'winner-despite-index')
  const latest = await store.store.readDocument(otherId)
  const rebuilt = await store.withIndexLock(path.join(root, 'index.json'), async () => ({ ok: true, revision: latest.revision }))
  assert.equal(rebuilt.ok, true)
  assert.equal(rebuilt.revision, latest.revision)
})
await test('P2A-12 committed failure preserves winner and prepared; prepared failure preserves original', async () => {
  const current = await store.store.readDocument(otherId)
  const failedCommit = await store.runOperation({
    documentId: otherId, expectedRevision: current.revision, eventIds,
    changeSet: [{ regionId: 'content', beforeText: 'winner-despite-index', afterText: 'winner-despite-commit' }],
    prepareEvents: async () => ({ ok: true, status: 'prepared', marker: 'synthetic-prepared' }),
    commitEvents: async () => { throw new Error('synthetic-commit-failure') },
  })
  assert.equal(failedCommit.error, 'event-commit-failed', JSON.stringify(failedCommit))
  assert.equal(failedCommit.resources.events, 'prepared')
  assert.equal(failedCommit.prepared.marker, 'synthetic-prepared')
  assert.equal(failedCommit.document.ok, true)
  const latest = await store.store.readDocument(otherId)
  assert.equal(latest.content, 'winner-despite-commit')
  const failedPrepare = await store.runOperation({
    documentId: otherId, expectedRevision: latest.revision, eventIds,
    changeSet: [{ regionId: 'content', beforeText: latest.content, afterText: 'must-not-write' }],
    prepareEvents: async () => { throw new Error('synthetic-prepare-failure') },
  })
  assert.equal(failedPrepare.error, 'event-prepare-failed')
  assert.match(failedPrepare.cause, /synthetic-prepare-failure/)
  assert.equal((await store.store.readDocument(otherId)).content, 'winner-despite-commit')
})

console.log('')
console.log('=== Isolated no-lock mutation: real lost update must turn red ===')
const mutationRoot = path.resolve('artifacts', '_r4-p2a-mutation')
const mutationLib = path.join(mutationRoot, 'lib', 'ledger-doc')
await fs.mkdir(mutationLib, { recursive: true })
const cleanSource = await fs.readFile('lib/ledger-doc/locked-store.js', 'utf8')
const anchor = "return this._exclusive('document', target.filePath + '.lock', job, options)"
assert.equal(cleanSource.split(anchor).length - 1, 1, 'lock call anchor exactly once')
const mutantSource = cleanSource.replace(anchor, 'return job()')
assert.notEqual(mutantSource, cleanSource)
for (const name of ['protocol.js', 'document-store.js']) await fs.copyFile(path.join('lib/ledger-doc', name), path.join(mutationLib, name))
await fs.copyFile('lib/shared-state-lock.js', path.join(mutationRoot, 'lib', 'shared-state-lock.js'))
const mutantModule = path.join(mutationLib, 'locked-store.js')
const mutationDocuments = path.join(mutationRoot, 'artifacts', 'documents')
const mutationEvents = path.join(mutationRoot, 'artifacts', 'events.json')
await fs.mkdir(mutationDocuments, { recursive: true })
await fs.copyFile(eventsPath, mutationEvents)
const mutantId = 'synthetic-lock-mutant-261111-0005'
async function mutationProbe(useBarrier) {
  for (const marker of ['renamed-a', 'renamed-b']) {
    try { await fs.unlink(path.join(mutationRoot, marker)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  try { await fs.unlink(path.join(mutationDocuments, mutantId + '.md')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const seeded = await seed(newStore(mutationDocuments), mutantId)
  const barrier = { directory: mutationRoot, label: 'a' }
  const results = await Promise.all([
    updateWorker(mutantModule, mutationDocuments, edit(mutantId, seeded.revision, 'base', 'mutant-a'), useBarrier ? barrier : null),
    updateWorker(mutantModule, mutationDocuments, edit(mutantId, seeded.revision, 'base', 'mutant-b'), useBarrier ? { ...barrier, label: 'b' } : null),
  ])
  const final = await newStore(mutationDocuments).store.readDocument(mutantId)
  const winners = results.filter((x) => x.ok)
  const conflicts = results.filter((x) => x.error === 'document-version-conflict')
  const lostUpdate = results.some((x) => !x.ok && x.error !== 'document-version-conflict') && winners.length === 1 && winners[0].revision === final.revision
  assert.equal(winners.length, 1, JSON.stringify(results))
  assert.equal(conflicts.length, 1, 'lost update without conflict: ' + JSON.stringify(results))
  return { results: results.map((x) => ({ ok: x.ok, error: x.error, revision: x.revision })), finalRevision: final.revision, lostUpdate }
}
await fs.writeFile(mutantModule, mutantSource, 'utf8')
let mutant
let mutantRed = false
try { mutant = await mutationProbe(true) } catch (error) { mutantRed = true; mutant = { red: error.message } }
await test('MUT-no-lock concurrent lost-update oracle becomes red', () => assert.equal(mutantRed, true, JSON.stringify(mutant)))
evidence.push({ kind: 'mutation', name: 'no-lock', result: mutantRed ? 'CAUGHT' : 'MISSED', detail: mutant })
await fs.writeFile(mutantModule, cleanSource, 'utf8')
let restored
await test('MUT-restored clean copy passes the same two-process oracle', async () => {
  restored = await mutationProbe(false)
  assert.equal(restored.lostUpdate, false)
})
evidence.push({ kind: 'restored', name: 'restored', result: restored?.lostUpdate === false ? 'GREEN' : 'RED', detail: restored })

await test('P2A-13 new source/test files do not mix CRLF and bare LF', async () => {
  for (const file of ['lib/ledger-doc/locked-store.js', 'tests/smoke/smoke-test-r4-ledger-lock.mjs']) {
    const bytes = await fs.readFile(file)
    const text = bytes.toString('latin1')
    const crlf = String.fromCharCode(13, 10)
    const hasMixed = text.includes(crlf) && text.split(crlf).join('').includes(String.fromCharCode(10))
    assert.equal(hasMixed, false, file)
  }
})
const results = { pass, fail, failures, evidence }
await fs.writeFile(path.join(root, 'test-results.json'), JSON.stringify(results, null, 2) + String.fromCharCode(10), 'utf8')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + evidence.filter((x) => x.result === 'CAUGHT').length + ' / MISSED ' + evidence.filter((x) => x.result === 'MISSED').length)
console.log('RESTORED ' + (evidence.find((x) => x.kind === 'restored')?.result || 'MISSING'))
process.exitCode = fail === 0 ? 0 : 1
for (const child of children) child.kill()
}
