import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'

const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-facts-transaction-'))
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
const hubModule = pathToFileURL(path.join(repo, 'lib/hub-io.js')).href
const factModule = pathToFileURL(path.join(repo, 'lib/fact-store.js')).href
const worker = path.join(root, 'worker.mjs'), dir = path.join(root, 'hub'), file = path.join(dir, 'facts.json')
await fs.writeFile(worker, `
  import {createHubIoPre} from ${JSON.stringify(hubModule)}
  import {createFactStorePre} from ${JSON.stringify(factModule)}
  import {createMemoryHubPre} from ${JSON.stringify(pathToFileURL(path.join(repo, 'lib/memory-hub.js')).href)}
  import {renameSync} from 'node:fs'
  let writes=0
  const factory=createHubIoPre({dir:process.argv[2],fsApi:{renameSync:(...args)=>{writes++;return renameSync(...args)}}}),io=factory('facts.json'),store=createFactStorePre({io})
  const hub=createMemoryHubPre({stores:{facts:store},batch:factory})
  const initial=io.load();if(initial)store.restore(initial)
  process.send({ready:true})
  process.on('message',m=>{try{const result=m.op==='feed'?hub.ingestJudgementRows(m.args[0]):store[m.op](...(m.args||[]));process.send({id:m.id,result,writes,snapshot:store.snapshot({includeRevoked:true})})}catch(e){process.send({id:m.id,error:String(e.stack||e)})}})
`)
const children = []
async function child() {
  const proc = spawn(process.execPath, [worker, dir], { env: process.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true })
  children.push(proc)
  let sequence = 0, stderr = ''
  proc.stderr.on('data', d => { stderr += d })
  await new Promise((resolve, reject) => { proc.once('message', resolve); proc.once('error', reject); proc.once('exit', code => reject(Error('child exited ' + code + stderr))) })
  return (op, ...args) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { proc.off('message', onMessage); reject(Error('worker timeout')) }, 5000)
    const onMessage = msg => {
      if (msg.id !== id) return
      clearTimeout(timer); proc.off('message', onMessage)
      if (msg.error) reject(Error(msg.error)); else resolve(msg)
    }
    proc.on('message', onMessage); proc.send({ id, op, args })
  })
}
const candidate = (subject, object = 'A valid synthetic configuration', provenance = [subject]) => ({ scope: 'User', subject, predicate: 'uses', object, sourceKind: 'explicit', sourceClass: 'user-memory', provenance })
const disk = async () => JSON.parse(await fs.readFile(file, 'utf8'))
try {
  const a = await child(), b = await child() // both restore empty before either write
  const one = await a('upsert', candidate('Synthetic project A'))
  const two = await b('upsert', candidate('Synthetic project B'))
  assert.equal(one.result.persisted, true); assert.equal(two.result.persisted, true)
  assert.deepEqual((await disk()).facts.map(f => f.subject).sort(), ['Synthetic project A', 'Synthetic project B'])
  const revoked = await b('revokeBySource', 'Synthetic project A')
  assert.equal(revoked.result.revoked, 1)
  await a('upsert', candidate('Synthetic project C'))
  assert.equal((await disk()).facts.find(f => f.subject === 'Synthetic project A').revoked, true)
  const conflict = await a('upsert', candidate('Synthetic project B', 'Different explicit configuration'))
  assert.equal(conflict.result.outcome, 'conflict-added')
  const conflictId = (await disk()).conflicts[0].conflictId
  const resolved = await b('resolveConflict', conflictId, 'left')
  assert.equal(resolved.result.ok, true); assert.equal((await disk()).conflicts[0].resolved, true)
  await a('dispose') // stale process must reload; no revoked fact resurrected
  assert.equal((await disk()).facts.find(f => f.subject === 'Synthetic project A').revoked, true)
  const c = await child()
  const cleared = await b('clear'); assert.equal(cleared.result.cleared, true)
  const afterClear = await c('upsert', candidate('Synthetic project D'))
  assert.equal(afterClear.result.persisted, true)
  assert.deepEqual((await disk()).facts.map(f => f.subject), ['Synthetic project D'])
  const beforeBatchWrites = (await b('query')).writes
  const rows = ['E', 'F'].map(s => ({ kindCandidate: 'semantic_candidate', observationId: 'ordinary-' + s, scope: 'User', sourceIds: ['source-' + s], subject: 'Synthetic project ' + s, predicate: 'uses', object: 'Synthetic configuration ' + s, confidence: 0.7 }))
  const feed = await b('feed', rows)
  assert.equal(feed.writes - beforeBatchWrites, 1)
  assert.equal(feed.result.batch.written, 1); assert(feed.result.results.every(r => r.consumed === 'semantic'))
  assert.deepEqual((await disk()).facts.map(f => f.subject).sort(), ['Synthetic project D', 'Synthetic project E', 'Synthetic project F'])

  const { createHubIoPre } = await import(hubModule), { createFactStorePre } = await import(factModule)
  const { withConfigLockSync } = await import(pathToFileURL(path.join(repo, 'lib/config-lock.js')))
  const store = createFactStorePre({ io: createHubIoPre({ dir })('facts.json') })
  const before = await fs.readFile(file, 'utf8')
  const busy = withConfigLockSync(file, () => store.upsert(candidate('Synthetic blocked project')))
  assert.equal(busy.ok, false); assert.equal(busy.persisted, false)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  const { createMemoryHubPre: createBusyHub } = await import(pathToFileURL(path.join(repo, 'lib/memory-hub.js')))
  const busyFactory = createHubIoPre({ dir }), busyStore = createFactStorePre({ io: busyFactory('facts.json') })
  const busyHub = createBusyHub({ stores: { facts: busyStore }, batch: busyFactory })
  const busyBatch = withConfigLockSync(file, () => busyHub.ingestJudgementRows(rows))
  assert.equal(busyBatch.batch.ok, false)
  assert.equal(busyHub.getStats().judgedRows, 2); assert.equal(busyHub.getStats().rejectedSemantic, 2); assert.equal(busyHub.getStats().skipped, 2)
  assert(busyBatch.results.every(r => r.accepted === false && r.persisted === false))
  // right resolution is one logical transaction even though the state machine
  // internally calls upsert and persist before marking the conflict resolved.
  const conflictDir = path.join(root, 'right-conflict'), conflictFile = path.join(conflictDir, 'facts.json')
  const { renameSync } = await import('node:fs')
  let rightWrites = 0
  const rightIo = createHubIoPre({ dir: conflictDir, fsApi: { renameSync: (...args) => { rightWrites++; return renameSync(...args) } } })('facts.json')
  const rightStore = createFactStorePre({ io: rightIo })
  rightStore.upsert(candidate('Synthetic right-resolution project', 'Original configuration'))
  rightStore.upsert(candidate('Synthetic right-resolution project', 'Replacement configuration'))
  const rightId = rightStore.pendingConflicts()[0].conflictId
  const beforeRight = await fs.readFile(conflictFile, 'utf8')
  const beforeRightSnapshot = JSON.parse(beforeRight)
  const rejectRight = createFactStorePre({ io: createHubIoPre({ dir: conflictDir, fsApi: { writeFileSync: () => { throw Object.assign(Error('right commit failure'), { code: 'EACCES' }) } } })('facts.json') })
  assert.equal(rejectRight.resolveConflict(rightId, 'right').ok, false)
  assert.equal(await fs.readFile(conflictFile, 'utf8'), beforeRight)
  assert.deepEqual(rejectRight.snapshot({ includeRevoked: true }).facts, beforeRightSnapshot.facts)
  assert.deepEqual(rejectRight.snapshot({ includeRevoked: true }).conflicts, beforeRightSnapshot.conflicts)
  const countBeforeRight = rightWrites
  assert.equal(rightStore.resolveConflict(rightId, 'right').ok, true)
  assert.equal(rightWrites - countBeforeRight, 1)
  const afterRight = JSON.parse(await fs.readFile(conflictFile, 'utf8'))
  assert.equal(afterRight.conflicts[0].resolved, true)
  assert.equal(afterRight.facts.filter(f => !f.revoked)[0].object, 'Replacement configuration')
  assert.deepEqual(JSON.parse(JSON.stringify(rightStore.snapshot({ includeRevoked: true }).facts)), afterRight.facts)
  const { createMemoryHubPre } = await import(pathToFileURL(path.join(repo, 'lib/memory-hub.js')))
  const failingFactory = createHubIoPre({ dir, fsApi: { writeFileSync: () => { throw Object.assign(Error('batch write failure'), { code: 'EACCES' }) } } })
  const failingStore = createFactStorePre({ io: failingFactory('facts.json') })
  const failingHub = createMemoryHubPre({ stores: { facts: failingStore }, batch: failingFactory })
  const failedBatch = failingHub.ingestJudgementRows(rows.map(row => ({ ...row, subject: row.subject + ' batch candidate' })))
  assert.equal(failedBatch.batch.ok, false)
  assert(failedBatch.results.every(r => !r.consumed && r.accepted === false))
  assert.equal(failingHub.getStats().consumedSemantic, 0)
  assert.deepEqual(failingStore.snapshot({ includeRevoked: true }).facts.map(f => f.subject).sort(), ['Synthetic project D', 'Synthetic project E', 'Synthetic project F'])
  assert.equal(await fs.readFile(file, 'utf8'), before)
  const failing = createFactStorePre({ io: createHubIoPre({ dir, fsApi: { writeFileSync: () => { throw Object.assign(Error('ordinary write failure'), { code: 'EACCES' }) } } })('facts.json') })
  const failed = failing.upsert(candidate('Synthetic failed project'))
  assert.equal(failed.persisted, false); assert.equal(failing.query().some(f => f.subject === 'Synthetic failed project'), false)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  for (const shape of ['null', '[]', '1', 'true', '"original primitive"', '{}']) {
    await fs.writeFile(file, shape)
    assert.equal(store.upsert(candidate('Synthetic invalid shape')).persisted, false)
    assert.equal(await fs.readFile(file, 'utf8'), shape)
  }
  await fs.writeFile(file, '{corrupt original')
  assert.equal(store.upsert(candidate('Synthetic corrupt project')).persisted, false)
  assert.equal(await fs.readFile(file, 'utf8'), '{corrupt original')
  console.log('PASS #274: independent processes retain additions/revocation/conflicts/dispose/clear; actual hub batch commits once; failed batch rolls back data and receipts; busy/corrupt/write-failure preserve original')
} finally {
  await Promise.all(children.map(proc => new Promise(resolve => { if (proc.exitCode !== null) return resolve(); proc.once('exit', resolve); proc.kill() })))
  await fs.rm(root, { recursive: true, force: true })
}
