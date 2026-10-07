import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createTeamOutbox } from '../../lib/team-outbox.js'
import { createTeamPuller } from '../../lib/team-pull.js'
import { createHubIoPre } from '../../lib/hub-io.js'
import { createFactStorePre } from '../../lib/fact-store.js'
import { createTeamMerge } from '../../lib/team-merge.js'
import { withConfigLockSync } from '../../lib/config-lock.js'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-team-retry-'))
const env = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
let child
try {
  const { MemoryEngine } = await loadIsolatedEngine(root)
  const box = createTeamOutbox({ dir: path.join(root, 'team') })
  assert(box.load().ok)
  const makeEngine = () => {
    const engine = new MemoryEngine()
    engine.state.ws = root
    engine.userDirOf = () => path.join(root, 'user')
    engine.projectDirOf = () => path.join(root, 'project')
    Object.assign(engine.config, { globalBriefEnabled: true, teamEnabled: true, globalBriefWatchDocs: true, globalBriefWatchMemory: false, globalBriefWatchExternal: false, globalBriefWatchTeam: true })
    engine._teamOutbox = box
    return engine
  }
  let engine = makeEngine()
  const readme = path.join(root, 'README.md')
  await fs.writeFile(readme, 'baseline')
  assert.equal(engine.external.briefDetectSyncPre(), '')
  await fs.writeFile(readme, 'changed synthetic document')
  const locker = path.join(root, 'locker.mjs')
  const lockUrl = new URL('../../lib/config-lock.js', import.meta.url).href
  await fs.writeFile(locker, `import { withConfigLock } from ${JSON.stringify(lockUrl)}; await withConfigLock(process.argv[2], async () => { process.stdout.write('ready\\n'); await new Promise(r => process.stdin.once('data', r)) }); process.exit(0)`)
  child = spawn(process.execPath, [locker, box.file], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  await new Promise((resolve, reject) => {
    child.stdout.once('data', resolve)
    child.once('error', reject)
    child.once('exit', code => reject(Error('locker exited before ready: ' + code)))
  })
  assert(engine.external.briefDetectSyncPre())
  const wmFile = path.join(root, 'user', 'global-brief', engine.wsKey(root) + '.json')
  const pending = () => fs.readFile(wmFile, 'utf8').then(JSON.parse).then(data => data.teamPending)
  assert.equal((await pending()).length, 1, 'failed enqueue is durable')
  assert.equal(engine.external.briefDetectSyncPre(), '', 'retry does not repeat brief')
  assert.equal((await pending()).length, 1)
  engine = makeEngine()
  engine.config.teamEnabled = false
  assert.equal(engine.external.briefDetectSyncPre(), '')
  assert.equal(box.size(), 0, 'team off does not enqueue')
  assert.equal((await pending()).length, 1)
  child.stdin.write('release')
  await new Promise(resolve => child.once('exit', resolve))
  child = null
  engine.config.teamEnabled = true
  assert.equal(engine.external.briefDetectSyncPre(), '', 'restart recovers pending without repeating brief')
  assert(box.load().ok)
  assert.equal(box.size(), 1)
  assert.equal((await pending()).length, 0)
  assert.equal(engine.external.briefDetectSyncPre(), '')
  await box.flush(async () => ({ ok: true }))
  assert.equal(box.size(), 0)
  // Migration from the original plain path -> fingerprint watermark.
  const saved = JSON.parse(await fs.readFile(wmFile, 'utf8'))
  await fs.writeFile(wmFile, JSON.stringify(saved.watermarks))
  engine = makeEngine()
  assert.equal(engine.external.briefDetectSyncPre(), '')
  assert.equal(box.size(), 0)
  await fs.unlink(readme)
  assert(engine.external.briefDetectSyncPre(), 'deletion with an empty watch set still detects')
  assert.equal(box.size(), 1)
  await box.flush(async () => ({ ok: true }))

  const fact = { scope: 'Workspace', subject: 'fixture project', predicate: 'uses', object: 'synthetic compiler', sourceKind: 'explicit', provenance: ['mem_' + '1'.repeat(32)] }
  const changes = [
    { kind: 'handoff', key: 'brief:fixture', payload: { path: 'fixture', change: 'changed', source: 'workspace' } },
    { kind: 'fact', key: 'fixture-fact', payload: fact },
  ]
  const io = createHubIoPre({ dir: path.join(root, 'facts') })('facts.json')
  let store = createFactStorePre({ io })
  const requests = [], center = createTeamMerge()
  const puller = createTeamPuller({ engine: { config: { teamEnabled: true } }, conflictCenter: center, appliers: { fact: (p, ch, id) => store.upsertRemote(p, id) }, fetchJson: async url => {
    requests.push(url)
    const since = Number(url.split('=')[1])
    return { ok: true, data: { cursor: Math.min(since + 1, 2), changes: since < 2 ? [changes[since]] : [] } }
  } })
  assert.equal((await puller.pullOnce()).since, 1)
  assert.equal((await puller.pullOnce()).since, 2)
  assert.equal(store.size, 1)
  assert.deepEqual(requests, ['/v1/changes?since=0', '/v1/changes?since=1'])
  assert.equal(center.rejected().total, 1, 'unsupported kind rejection is visible')

  const mixedFile = path.join(root, 'facts', 'facts.json')
  const batch = [
    { kind: 'fact', key: 'same-fact', revision: 10, payload: { ...fact, object: 'different compiler' } },
    { kind: 'fact', key: 'other-fact', revision: 11, payload: { ...fact, subject: 'another fixture' } },
  ]
  let failSecond = true, appliedCallbacks = 0
  const makePuller = () => createTeamPuller({ engine: { config: { teamEnabled: true } }, onApplied: () => appliedCallbacks++, appliers: { fact: (p, ch, id) => {
    if (failSecond && ch.key === 'other-fact') return withConfigLockSync(mixedFile, () => store.upsertRemote(p, id), { reentrant: false })
    return store.upsertRemote(p, id)
  } }, fetchJson: async () => ({ ok: true, data: { cursor: 12, changes: batch } }) })
  const mixed = makePuller()
  assert.equal((await mixed.pullOnce()).since, 0)
  assert.equal(store.snapshot().conflicts.length, 1)
  assert.equal((await mixed.pullOnce()).since, 0)
  assert.equal(store.snapshot().conflicts.length, 1, 'same instance skips successes')
  assert.equal(appliedCallbacks, 1)
  // Recreate both stores and puller, then change JSON property order in replay.
  store = createFactStorePre({ io })
  assert(store.restore(io.load()).ok)
  batch[0] = Object.fromEntries(Object.entries(batch[0]).reverse())
  failSecond = false
  const retry = await makePuller().pullOnce()
  assert.equal(retry.since, 12)
  assert.equal(retry.applied, 1)
  assert.equal(store.snapshot().conflicts.length, 1, 'restart does not duplicate durable conflicts')
  assert.equal(appliedCallbacks, 2, 'duplicate does not repeat attribution callback')
  batch[0] = { ...batch[0], revision: 13 }
  assert.equal((await makePuller().pullOnce()).ok, true)
  assert.equal(store.snapshot().conflicts.length, 2, 'new remote revision remains a new event')
  delete batch[0].revision
  delete batch[1].revision
  failSecond = true
  assert.equal((await makePuller().pullOnce()).since, 0)
  assert.equal(store.snapshot().conflicts.length, 3)
  store = createFactStorePre({ io })
  assert(store.restore(io.load()).ok)
  failSecond = false
  assert.equal((await makePuller().pullOnce()).since, 12)
  assert.equal(store.snapshot().conflicts.length, 3, 'legacy same-page replay survives restart without event IDs')
  // Receipt and data roll back together when the atomic save itself fails.
  let denySave = true, disk = null
  const failing = createFactStorePre({ io: { load: () => disk, save: data => { if (denySave) throw Error('synthetic disk failure'); disk = data } } })
  const id = 'a'.repeat(64)
  assert.equal(failing.upsertRemote(fact, id).persisted, false)
  assert.equal(failing.size, 0)
  assert.equal(failing.snapshot().teamReceipts, undefined)
  denySave = false
  assert(failing.upsertRemote(fact, id).ok)
  assert.equal(disk.teamReceipts.length, 1)
  assert.equal(failing.upsertRemote(fact, id).outcome, 'remote-duplicate')
  // Different processes must observe the same durable receipt under the
  // canonical facts lock, rather than each creating its own conflict.
  const parallelDir = path.join(root, 'parallel')
  const parallelIo = createHubIoPre({ dir: parallelDir })('facts.json')
  assert(createFactStorePre({ io: parallelIo }).upsert(fact).ok)
  const worker = path.join(root, 'remote-worker.mjs')
  await fs.writeFile(worker, `
    import { createHubIoPre } from ${JSON.stringify(new URL('../../lib/hub-io.js', import.meta.url).href)}
    import { createFactStorePre } from ${JSON.stringify(new URL('../../lib/fact-store.js', import.meta.url).href)}
    const store = createFactStorePre({io:createHubIoPre({dir:process.argv[2]})('facts.json')})
    for(let i=0;i<200;i++) {
      const r=store.upsertRemote(JSON.parse(process.argv[3]),process.argv[4])
      if(r.ok) { process.stdout.write(r.outcome); process.exit(0) }
      if(!String(r.error).includes('config-lock-busy')) throw Error(JSON.stringify(r))
      await new Promise(resolve=>setTimeout(resolve,10))
    }
    throw Error('receipt transaction never acquired lock')
  `)
  const outcomes = await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve, reject) => {
    const workerChild = spawn(process.execPath, [worker, parallelDir, JSON.stringify({ ...fact, object: 'parallel compiler' }), 'b'.repeat(64)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = '', stderr = ''
    workerChild.stdout.on('data', data => { stdout += data })
    workerChild.stderr.on('data', data => { stderr += data })
    workerChild.once('error', reject)
    workerChild.once('exit', code => code === 0 ? resolve(stdout) : reject(Error(stderr)))
  })))
  const parallelState = parallelIo.load()
  assert.equal(parallelState.conflicts.length, 1)
  assert.equal(parallelState.teamReceipts.length, 1)
  assert.equal(outcomes.filter(outcome => outcome === 'conflict-added').length, 1)
  assert.equal(outcomes.filter(outcome => outcome === 'remote-duplicate').length, 5)
  console.log('PASS team retry: production brief/cross-process lock/restart, paginated unsupported kind, durable conflict receipts/rollback/new revisions')
} finally {
  if (child) { child.kill(); await new Promise(resolve => child.once('exit', resolve)) }
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 })
}
