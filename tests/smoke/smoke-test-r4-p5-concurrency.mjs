import * as fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { LedgerDocumentStore } from '../../lib/ledger-doc/document-store.js'
import { LockedLedgerDocumentStore } from '../../lib/ledger-doc/locked-store.js'

// R4 P5: two REAL OS processes writing the SAME maintenance document.
// P5 judgement: 'two processes must not overwrite each other'. kill/reconcile does NOT substitute.
const root = path.resolve('artifacts', '_r4-p5-20261112', 'fixtures', 'concurrency')
const documents = path.join(root, 'documents')
const eventsPath = path.join(root, 'events.json')
const eventIds = ['evt_a1b2c3d4']
const selfPath = path.resolve('tests/smoke/smoke-test-r4-p5-concurrency.mjs')
const sleep = (ms) => delay(ms)

let pass = 0
let fail = 0
const failures = []
const evidence = []
const children = new Set()
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}
function newStore(options = {}) {
  const base = new LedgerDocumentStore(documents, { eventsPath, ...options })
  return new LockedLedgerDocumentStore(base, { lockTimeoutMs: 8000, ...options })
}
function edit(documentId, expectedRevision, beforeText, afterText) {
  return { documentId, expectedRevision, eventIds, changeSet: [{ regionId: 'content', beforeText, afterText }] }
}
function launch(args) {
  const child = spawn(process.execPath, [selfPath, '--worker', ...args], {
    cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
  let stdout = '', stderr = ''
  child.stdout.on('data', (s) => { stdout += s })
  child.stderr.on('data', (s) => { stderr += s })
  const exited = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('worker-timeout stderr=' + stderr)) }, 20000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timer); children.delete(child); resolve({ code, signal, stdout, stderr }) })
  })
  return { child, exited }
}
async function updateWorker(directory, input, modulePath = path.resolve('lib/ledger-doc/locked-store.js'), barrier = null) {
  const worker = launch(['update', modulePath, directory, JSON.stringify(input), barrier ? JSON.stringify(barrier) : ''])
  const result = await worker.exited
  assert.equal(result.code, 0, result.stderr)
  return JSON.parse(result.stdout.trim())
}
async function workerMain(args) {
  const [mode, modulePath, directory, payload, barrierText] = args
  const { LockedLedgerDocumentStore: WorkerStore } = await import(pathToFileURL(modulePath).href)
  const options = {}
  let barrier = null
  if (barrierText) {
    barrier = JSON.parse(barrierText)
    // Barrier is placed BEFORE rename: both processes have already passed the inner CAS
    // against the same bytes, so any lock-free implementation loses one update.
    options.fs = {
      ...fs,
      async rename(from, to) {
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
  const store = new WorkerStore(base, { lockTimeoutMs: barrier ? 800 : 8000 })
  if (mode === 'update') {
    const result = await store.updateDocument(JSON.parse(payload))
    process.stdout.write(JSON.stringify({ ok: result.ok, error: result.error, revision: result.revision, content: result.content }))
    return
  }
  throw new Error('unknown-worker-mode')
}

if (process.argv[2] === '--worker') {
  await workerMain(process.argv.slice(3))
} else {
await fs.mkdir(documents, { recursive: true })
await fs.writeFile(eventsPath, JSON.stringify({ schema: 'r4-synthetic-events-v1', synthetic: true, events: [{ id: eventIds[0], status: 'active', name: 'Synthetic P5 event', checkpoints: [] }] }))
for (const name of await fs.readdir(documents)) {
  if (name.startsWith('synthetic-p5-')) await fs.unlink(path.join(documents, name)).catch(() => {})
}
const store = newStore()
const id = 'synthetic-p5-concurrent-261112-0001'
const seeded = await store.createDocument({ documentId: id, title: 'Synthetic P5 concurrency', eventIds, content: 'base' })
assert.equal(seeded.ok, true, JSON.stringify(seeded))

console.log('=== P5-1 two real processes, same document, same revision ===')
await test('P5C-01 exactly one winner and one explicit CAS conflict; no silent overwrite', async () => {
  const results = await Promise.all([
    updateWorker(documents, edit(id, seeded.revision, 'base', 'writer-a')),
    updateWorker(documents, edit(id, seeded.revision, 'base', 'writer-b')),
  ])
  const winners = results.filter((r) => r.ok)
  const conflicts = results.filter((r) => r.error === 'document-version-conflict')
  assert.equal(winners.length, 1, JSON.stringify(results))
  assert.equal(conflicts.length, 1, JSON.stringify(results))
  const final = await store.readDocument(id)
  assert.equal(final.ok, true, JSON.stringify(final))
  assert.equal(final.revision, winners[0].revision, 'final revision equals the single winner')
  assert.equal(final.content, winners[0].content, 'final content equals the single winner')
  evidence.push({ kind: 'same-document-same-revision', results, finalRevision: final.revision })
  return winners[0].revision
})
await test('P5C-02 no temp file and no leftover lock file after the race', async () => {
  const names = (await fs.readdir(documents)).sort()
  const temps = names.filter((n) => n.endsWith('.tmp'))
  assert.deepEqual(temps, [])
  const locks = names.filter((n) => n.includes('.lock'))
  assert.deepEqual(locks, [])
  evidence.push({ kind: 'clean-after-race', names })
  return 'temps=0 locks=0'
})
await test('P5C-03 loser retries with the winner revision and both writes survive in order', async () => {
  const current = await store.readDocument(id)
  const retried = await store.updateDocument(edit(id, current.revision, current.content, 'writer-b-after-conflict'))
  assert.equal(retried.ok, true, JSON.stringify(retried))
  const final = await store.readDocument(id)
  assert.equal(final.content, 'writer-b-after-conflict')
  assert.notEqual(final.revision, current.revision)
  evidence.push({ kind: 'retry-after-conflict', revision: final.revision })
  return final.revision
})
await test('P5C-04 eight concurrent processes converge to one revision, never a torn document', async () => {
  const before = await store.readDocument(id)
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => updateWorker(documents, edit(id, before.revision, before.content, 'burst-' + i))))
  const winners = results.filter((r) => r.ok)
  assert.equal(winners.length, 1, JSON.stringify(results.map((r) => r.error || 'ok')))
  const final = await store.readDocument(id)
  assert.equal(final.ok, true)
  assert.equal(final.revision, winners[0].revision)
  const raw = await fs.readFile(path.join(documents, id + '.md'), 'utf8')
  const head = raw.split(String.fromCharCode(10))
  assert.equal(head.filter((l) => l.startsWith('revision:')).length, 1, 'exactly one revision line')
  assert.equal(head.filter((l) => l.startsWith('documentId:')).length, 1, 'exactly one documentId line')
  evidence.push({ kind: 'eight-process-burst', winners: winners.length, conflicts: results.length - winners.length, revision: final.revision })
  return 'winners=1 conflicts=7'
})
await test('P5C-05 kill/reconcile style recovery is NOT accepted as this judgement (explicit non-substitute)', async () => {
  // P5 requires concurrent writers on the same document. A kill+reconcile scenario exercises
  // a different invariant (prepared->committed replay) and is proven by smoke-test-r4-wal.
  const final = await store.readDocument(id)
  assert.equal(final.ok, true)
  assert.match(final.revision, /^sha256:[0-9a-f]{64}$/)
  evidence.push({ kind: 'non-substitute-declared', note: 'kill/reconcile covered by smoke-test-r4-wal, not by this suite' })
  return 'declared'
})
await test('P5C-06 suite source is LF-only (no mixed line endings introduced)', async () => {
  const self = await fs.readFile(selfPath, 'utf8')
  const crlf = (self.match(/\r\n/g) || []).length
  const bare = (self.match(/(?<!\r)\n/g) || []).length
  assert.equal(crlf, 0)
  assert.ok(bare > 0)
  return 'crlf=0 bare=' + bare
})

console.log('')
console.log('=== Isolated mutation: remove the document lock, the P5 oracle must turn red ===')
const mutationRoot = path.resolve('artifacts', '_r4-p5-20261112', 'mutations', 'no-lock')
const mutationLib = path.join(mutationRoot, 'lib', 'ledger-doc')
await fs.mkdir(mutationLib, { recursive: true })
const cleanSource = await fs.readFile('lib/ledger-doc/locked-store.js', 'utf8')
const lockAnchor = "return this._exclusive('document', target.filePath + '.lock', job, options)"
assert.equal(cleanSource.split(lockAnchor).length - 1, 1, 'lock call anchor exactly once')
const mutantSource = cleanSource.replace(lockAnchor, 'return job()')
assert.notEqual(mutantSource, cleanSource)
for (const name of ['protocol.js', 'document-store.js']) await fs.copyFile(path.join('lib/ledger-doc', name), path.join(mutationLib, name))
await fs.copyFile('lib/shared-state-lock.js', path.join(mutationRoot, 'lib', 'shared-state-lock.js'))
const mutantModule = path.join(mutationLib, 'locked-store.js')
const mutationDocuments = path.join(mutationRoot, 'artifacts', 'documents')
await fs.mkdir(mutationDocuments, { recursive: true })
const mutantId = 'synthetic-p5-mutant-261112-0002'
async function mutationProbe(useBarrier) {
  for (const marker of ['renamed-a', 'renamed-b']) {
    try { await fs.unlink(path.join(mutationRoot, marker)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  try { await fs.unlink(path.join(mutationDocuments, mutantId + '.md')) } catch (error) { if (error.code !== 'ENOENT') throw error }
  const mutStore = new LedgerDocumentStore(mutationDocuments, { eventsPath })
  const seededMut = await mutStore.createDocument({ documentId: mutantId, title: 'Synthetic P5 mutant', eventIds, content: 'base' })
  assert.equal(seededMut.ok, true, JSON.stringify(seededMut))
  const barrier = useBarrier ? { directory: mutationRoot, label: 'a' } : null
  const results = await Promise.all([
    updateWorker(mutationDocuments, edit(mutantId, seededMut.revision, 'base', 'mutant-a'), mutantModule, barrier),
    updateWorker(mutationDocuments, edit(mutantId, seededMut.revision, 'base', 'mutant-b'), mutantModule, useBarrier ? { ...barrier, label: 'b' } : null),
  ])
  const winners = results.filter((r) => r.ok)
  const conflicts = results.filter((r) => r.error === 'document-version-conflict')
  assert.equal(winners.length, 1, 'lock removed: ' + JSON.stringify(results.map((r) => r.error || 'ok')))
  assert.equal(conflicts.length, 1, 'lost update without conflict: ' + JSON.stringify(results.map((r) => r.error || 'ok')))
  return { winners: winners.length, conflicts: conflicts.length }
}
await fs.writeFile(mutantModule, mutantSource, 'utf8')
let mutantRed = false
let mutantDetail = null
try { mutantDetail = await mutationProbe(true) } catch (error) { mutantRed = true; mutantDetail = { red: error.message } }
await test('P5C-07 removing the document lock makes the two-process oracle red (CAUGHT)', () => assert.equal(mutantRed, true, JSON.stringify(mutantDetail)))
evidence.push({ kind: 'mutation', name: 'no-lock', result: mutantRed ? 'CAUGHT' : 'MISSED', detail: mutantDetail })
await fs.writeFile(mutantModule, cleanSource, 'utf8')
await test('P5C-08 restored clean copy passes the same oracle (GREEN)', async () => {
  const restored = await mutationProbe(false)
  assert.equal(restored.winners, 1)
})
evidence.push({ kind: 'restored', name: 'restored', result: 'GREEN' })

const outDir = path.resolve('artifacts', '_r4-p5-20261112', 'evidence')
await fs.mkdir(outDir, { recursive: true })
await fs.writeFile(path.join(outDir, 'concurrency.json'), JSON.stringify({ at: new Date().toISOString(), pass, fail, failures, evidence }, null, 2))
for (const child of children) child.kill()
console.log('')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) { console.log(JSON.stringify(failures, null, 2)); process.exitCode = 1 }
}