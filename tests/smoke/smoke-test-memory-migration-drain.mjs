import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { withConfigLock } from '../../lib/config-lock.js'

const workerMode = ['--migrate-first', '--migrate-after'].includes(process.argv[2]) ? process.argv[2] : null
const anchored = process.argv.includes('--anchored')
const previousHome = process.env.DSH_HOME
const home = workerMode ? process.env.DSH_HOME : await fs.mkdtemp(path.join(tmpdir(), 'dam-migration-drain-'))
process.env.DSH_HOME = home
const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
async function barrier(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('barrier not reached: ' + label)), 3000)
    })])
  } finally { clearTimeout(timer) }
}
if (workerMode) {
  const engine = new MemoryEngine()
  engine._configPath = path.join(home, 'settings.json')
  engine.config = JSON.parse(await fs.readFile(engine._configPath, 'utf8'))
  engine.configLoaded = true
  engine.refresh = async () => {}
  const migrate = () => engine.saveConfig({ memoryRoot: path.join(home, 'child-next') })
  if (workerMode === '--migrate-first') {
    await withConfigLock(engine._configPath, async () => {
      process.send({ state: 'locked' })
      await new Promise(resolve => process.once('message', resolve))
      await migrate()
    })
  } else { process.send({ state: 'started' }); await migrate() }
  process.send({ state: 'done' })
  await flushDiagnostics()
  process.disconnect()
} else {
const tasks = []
const children = []
let release
const track = task => { task.catch(() => {}); tasks.push(task); return task }
function child(mode) {
  const proc = fork(fileURLToPath(import.meta.url), [mode], { env: { ...process.env, DSH_HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  children.push(proc)
  let output = '', state = ''
  proc.stdout.on('data', data => { output += data }); proc.stderr.on('data', data => { output += data })
  const waiters = new Map()
  proc.on('message', message => { state = message.state; waiters.get(state)?.resolve() })
  const finished = track(new Promise((resolve, reject) => {
    proc.once('error', reject)
    proc.once('exit', code => {
      for (const waiter of waiters.values()) waiter.reject(new Error('worker exited before its barrier: ' + output))
      code === 0 ? resolve() : reject(new Error('worker exit ' + code + ': ' + output))
    })
  }))
  return { proc, finished, wait: wanted => state === wanted ? Promise.resolve() : new Promise((resolve, reject) => { waiters.set(wanted, { resolve, reject }) }), get state() { return state } }
}
try {
  const engine = new MemoryEngine()
  engine.configLoaded = true
  engine._configPath = path.join(home, 'settings.json')
  Object.assign(engine.config, { memoryRoot: path.join(home, 'old'), userMemoryDir: path.join(home, 'user'), memoryAnchorEnabled: anchored, associativeMemoryEnabled: false, teamEnabled: false, pythonBackendEnabled: false })
  engine.refresh = async () => {}
  await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
  const p = await engine.resolvePaths(null)
  await fs.mkdir(p.projectDir, { recursive: true })
  await fs.writeFile(p.notesPath, '## Original\n- initial-record\n')
  const store = engine.docStore || engine.rawDocStore, read = store._readState.bind(store)
  await engine.appendText(p.notesPath, '\n- normal-before-migration\n')
  assert.match(await fs.readFile(p.notesPath, 'utf8'), /normal-before-migration/)
  console.log('PASS normal control, anchored=' + anchored)
  {
    const peer = path.join(p.projectDir, 'independent.md')
    await fs.writeFile(peer, '# Independent original\n')
    const arrivals = [deferred(), deferred()], resumes = [deferred(), deferred()]
    release = () => resumes.forEach(gate => gate.resolve())
    const files = [p.notesPath, peer]
    store._readState = async file => {
      const state = await read(file), index = files.indexOf(file)
      if (index >= 0) { arrivals[index].resolve(); await resumes[index].promise }
      return state
    }
    const writes = files.map((file, index) => track(engine.appendText(file, '\n- independent-write-' + index + '\n')))
    let timer
    try {
      await Promise.race([Promise.all(arrivals.map(gate => gate.promise)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('different physical documents were globally serialized')), 3000)
      })])
    } finally { clearTimeout(timer) }
    resumes.forEach(gate => gate.resolve()); release = undefined
    await Promise.all(writes)
    for (const [index, file] of files.entries()) assert.match(await fs.readFile(file, 'utf8'), new RegExp('independent-write-' + index))
    store._readState = read
    assert.equal(engine._memoryMutationFlights.size, 0)
    console.log('PASS two independent Engine documents reach their real read barriers concurrently')
  }
  const entered = deferred(), resume = deferred()
  release = resume.resolve
  let gated = false
  store._readState = async file => {
    const state = await read(file)
    if (!gated && path.resolve(file) === path.resolve(p.notesPath)) { gated = true; entered.resolve(); await resume.promise }
    return state
  }
  const writer = track(engine.appendText(p.notesPath, '\n- accepted-before-migration\n'))
  await entered.promise
  const queued = track(engine.appendText(p.notesPath, '\n- queued-before-migration\n'))
  assert.equal(engine._memoryMutationFlights.size, 2, 'running and queued writes register at admission')
  let migrated = false
  const migration = track(engine.saveConfig({ memoryRoot: path.join(home, 'next') }).then(result => { migrated = true; return result }))
  for (let i = 0; i < 100 && !engine._settingsMigrationActive && !migrated; i++) await delay(5)
  // Let the baseline copy + publish finish. A fixed migration remains blocked on the read gate.
  await delay(100)
  assert.equal(migrated, false, 'migration must drain an admitted ordinary writer before copying')
  assert.equal(engine._settingsMigrationActive, true)
  await assert.rejects(engine.appendText(p.notesPath, '\n- rejected-during-migration\n'), /settings-migration-active/)
  resume.resolve(); release = undefined
  await writer
  await queued
  await migration
  const active = path.join(engine.projectDirOf(p.ws), path.basename(p.notesPath))
  assert.match(await fs.readFile(active, 'utf8'), /accepted-before-migration/)
  assert.match(await fs.readFile(active, 'utf8'), /queued-before-migration/)
  assert.doesNotMatch(await fs.readFile(active, 'utf8'), /rejected-during-migration/)
  assert.equal(engine._memoryMutationFlights.size, 0)
  await engine.appendText(active, '\n- normal-after-migration\n')
  assert.match(await fs.readFile(active, 'utf8'), /normal-after-migration/)
  console.log('PASS admitted ordinary writer drains before migration; new writes reject; active-root retry succeeds')

  // One route's pending request must never authorize an unrelated request.
  engine._settingsNoteFlights = new Set([Promise.resolve()])
  engine._settingsPlanFlights = new Set([Promise.resolve()])
  engine._settingsMigrationActive = true
  await assert.rejects(engine.appendText(active, '\n- unrelated-request\n'), /settings-migration-active/)
  engine._settingsMigrationActive = false
  engine._settingsNoteFlights.clear(); engine._settingsPlanFlights.clear()
  const lateGate = deferred()
  let lateWrite
  await engine._withMemoryAdmissionScopePre(async () => {
    lateWrite = track(lateGate.promise.then(() => engine.appendText(active, '\n- expired-request-scope\n')))
  })
  engine._settingsMigrationActive = true
  lateGate.resolve()
  await assert.rejects(lateWrite, /settings-migration-active/)
  engine._settingsMigrationActive = false
  await assert.rejects(engine.appendText(p.notesPath, '\n- stale-old-path\n'), /settings-root-changed/)
  assert.equal(engine._memoryMutationFlights.size, 0)
  console.log('PASS unrelated route flights grant no admission; stale resolved paths reject without leaked flights')

  const boundary = store.mutationBoundary
  store.mutationBoundary = () => { throw new Error('injected boundary rejection') }
  await assert.rejects(engine.appendText(active, '\n- failed-boundary\n'), /injected boundary rejection/)
  store.mutationBoundary = boundary
  assert.equal(engine._memoryMutationFlights.size, 0)
  store._readState = async () => { throw new Error('injected read failure') }
  await assert.rejects(engine.appendText(active, '\n- failed-read\n'), /injected read failure/)
  store._readState = read
  assert.equal(engine._memoryMutationFlights.size, 0)
  const validConfig = await fs.readFile(engine._configPath, 'utf8')
  const beforeCorruption = await fs.readFile(active, 'utf8')
  await fs.writeFile(engine._configPath, '{broken config')
  await assert.rejects(engine.appendText(active, '\n- must-not-write-with-broken-config\n'), SyntaxError)
  assert.equal(await fs.readFile(active, 'utf8'), beforeCorruption)
  assert.equal(engine._memoryMutationFlights.size, 0)
  await fs.writeFile(engine._configPath, validConfig)
  await engine.saveConfig({ userMemoryDir: path.join(home, 'other-user') })
  await engine.appendText(active, '\n- project-still-active\n')
  console.log('PASS failed writes release admission; changing userMemoryDir preserves the active project binding')

  // Exercise the production nested source/archive shape with upstream locks.
  {
    const source = path.join(path.dirname(active), 'source.md')
    const archive = path.join(path.dirname(active), 'archive.md')
    await fs.writeFile(source, 'source awaiting archival\n')
    await fs.writeFile(archive, 'initial archive\n')
    const held = deferred(), continueArchive = deferred(), peerEntered = deferred(), resumePeer = deferred(), nestedQueued = deferred()
    release = () => { continueArchive.resolve(); resumePeer.resolve() }
    const admission = store.mutationAdmission, commit = store._commit.bind(store)
    let archiveAdmissions = 0, peerHeld = false, peerCommitted = false, published = false
    store.mutationAdmission = file => {
      const admitted = admission(file)
      if (path.resolve(file) === archive && ++archiveAdmissions === 2) nestedQueued.resolve()
      return admitted
    }
    store._readState = async file => {
      const state = await read(file)
      if (path.resolve(file) === archive && !peerHeld) { peerHeld = true; peerEntered.resolve(); await resumePeer.promise }
      return state
    }
    store._commit = async (file, content, opts) => {
      const result = await commit(file, content, opts)
      if (file === archive && String(content).includes('concurrent-archive-append') && result.ok) {
        // Verify the receipt while the peer still owns its real document lock.
        assert.match(await fs.readFile(archive, 'utf8'), /concurrent-archive-append/)
        peerCommitted = true
      }
      return result
    }
    try {
      // #319 queues the source before acquiring its shared root lease.
      const archiving = track(store._queue(source, async file => {
        const original = await fs.readFile(file, 'utf8')
        held.resolve(); await continueArchive.promise
        await engine.writeFull(archive, original)
        published = true
      }))
      await barrier(held.promise, 'source transaction')
      const waitingArchive = track(engine.appendText(archive, '\n- concurrent-archive-append\n'))
      await barrier(peerEntered.promise, 'archive predecessor read while source lease is held')
      continueArchive.resolve()
      await barrier(nestedQueued.promise, 'nested full replacement queued behind the held predecessor')
      assert.equal(published, false)
      assert.equal(engine._memoryMutationFlights.size, 3, 'source, held archive predecessor and queued nested write are all admitted')
      resumePeer.resolve()
      await Promise.all([archiving, waitingArchive])
      assert.equal(peerCommitted, true)
      const finalArchive = await fs.readFile(archive, 'utf8')
      assert.match(finalArchive, /source awaiting archival/)
      // Explicit writeFull comes second and intentionally replaces the first
      // append. FIFO and successful completion, not permanent append retention.
      assert.doesNotMatch(finalArchive, /concurrent-archive-append/)
      assert.equal(engine._memoryMutationFlights.size, 0)
      console.log('PASS held archive predecessor then nested full replacement follow FIFO without a root-lease wait cycle')
    } finally {
      release(); release = undefined
      store.mutationAdmission = admission; store._readState = read; store._commit = commit
    }
  }

  // A writer exceeding the drain budget keeps its active root and can finish
  // there after the migration rejects. No config publication or copying occurs.
  {
    const held = deferred(), resumeTimeout = deferred()
    release = resumeTimeout.resolve
    const beforeConfig = await fs.readFile(engine._configPath, 'utf8')
    const refusedRoot = path.join(home, 'must-not-publish')
    store._readState = async file => { const state = await read(file); held.resolve(); await resumeTimeout.promise; return state }
    const slowWriter = track(engine.appendText(active, '\n- retained-after-drain-timeout\n'))
    await held.promise
    await assert.rejects(engine.saveConfig({ memoryRoot: refusedRoot }), error => error.code === 'SETTINGS_MIGRATION_TIMEOUT' && error.statusCode === 409)
    assert.equal(await fs.readFile(engine._configPath, 'utf8'), beforeConfig)
    assert.equal(engine.config.memoryRoot, path.join(home, 'next'))
    assert.equal(engine._settingsMigrationActive, false)
    await assert.rejects(fs.stat(refusedRoot), { code: 'ENOENT' })
    resumeTimeout.resolve(); release = undefined
    await slowWriter
    store._readState = read
    assert.match(await fs.readFile(active, 'utf8'), /retained-after-drain-timeout/)
    assert.equal(engine._memoryMutationFlights.size, 0)
    console.log('PASS drain timeout rejects migration before copying; the admitted writer finishes at the unchanged active root')
  }

  // Writer already inside the production read/commit transaction owns a root lease.
  const reached = deferred(), resumeCross = deferred()
  release = resumeCross.resolve
  store._readState = async file => { const state = await read(file); reached.resolve(); await resumeCross.promise; return state }
  const crossWriter = track(engine.appendText(active, '\n- cross-process-before-migration\n'))
  await reached.promise
  const migrator = child('--migrate-after')
  await migrator.wait('started')
  await delay(100)
  assert.notEqual(migrator.state, 'done', 'other-process migration must await the root-leased document transaction')
  assert.equal(JSON.parse(await fs.readFile(engine._configPath, 'utf8')).memoryRoot, path.join(home, 'next'))
  resumeCross.resolve(); release = undefined
  await crossWriter
  await migrator.finished
  const crossActive = path.join(home, 'child-next', engine.wsKey(p.ws), path.basename(active))
  assert.match(await fs.readFile(crossActive, 'utf8'), /cross-process-before-migration/)
  store._readState = read
  console.log('PASS cross-process migration copies the acknowledged write after its full transaction')

  // Hold config-lock in another process, admit a stale writer, then publish a
  // migration before that writer can enter its boundary. Durable roots must win.
  engine.config = JSON.parse(await fs.readFile(engine._configPath, 'utf8'))
  engine.config.memoryRoot = path.join(home, 'next')
  await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
  const first = child('--migrate-first')
  await first.wait('locked')
  const before = await fs.readFile(active, 'utf8')
  const staleWriter = track(engine.appendText(active, '\n- stale-cross-process-write\n'))
  first.proc.send({ resume: true })
  await first.finished
  await assert.rejects(staleWriter, /settings-root-changed/)
  assert.equal(await fs.readFile(active, 'utf8'), before)
  assert.doesNotMatch(await fs.readFile(crossActive, 'utf8'), /stale-cross-process-write/)
  assert.equal(engine._memoryMutationFlights.size, 0)
  console.log('PASS admitted writer waiting on config-lock rejects a changed durable root before IO')
} finally {
  if (release) release()
  for (const proc of children) if (proc.connected) proc.send({ resume: true })
  await Promise.allSettled(tasks)
  await flushDiagnostics()
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome
  await fs.rm(home, { recursive: true, force: true })
}
}
