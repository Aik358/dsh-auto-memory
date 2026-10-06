import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as syncFs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'
const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { createScopedHubIoPre } = await import(pathToFileURL(path.join(repo, 'lib/hub-io.js')))
const { createProcedureStorePre } = await import(pathToFileURL(path.join(repo, 'lib/procedure-store.js')))
const { withConfigLock } = await import(pathToFileURL(path.join(repo, 'lib/config-lock.js')))
const candidate = title => ({ title, steps: ['Perform ' + title], successCriteria: ['Verify ' + title], sourceMemoryIds: [], sourceEpisodes: [], origin: 'user', scope: 'global' })
const adapter = (dir, extra = {}) => createScopedHubIoPre({ globalDir: dir, resolveWorkspace: () => ({ dir: '', key: '' }), ...extra })
if (process.argv[2] === 'child') {
  const io = adapter(process.env.DSH_HOME), store = createProcedureStorePre({ io })
  const snapshot = io.load(); if (snapshot) store.restore(snapshot)
  process.send({ ready: true })
  process.on('message', message => {
    if (message.op === 'stop') return process.disconnect()
    let result
    if (message.op === 'observe') result = store.observe(candidate(message.title))
    if (message.op === 'reload') { const data = io.load(); result = store.restore(data || { schemaVersion: 1, procedures: [] }) }
    if (message.op === 'clear') result = store.clear()
    if (message.op === 'dispose') result = store.dispose('test')
    process.send(result)
  })
} else {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'dam-procedure-delta-'))
  const previous = process.env.DSH_HOME; process.env.DSH_HOME = home
  const children = []
  const start = () => {
    const child = fork(fileURLToPath(import.meta.url), ['child'], { env: { ...process.env, AUDIT_TEST_REPO: repo }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true }); children.push(child); return child
  }
  const call = async (child, message) => { const reply = once(child, 'message'); child.send(message); return (await reply)[0] }
  const file = path.join(home, 'procedures.json')
  let processFailure
  const disk = async () => JSON.parse(await fs.readFile(file, 'utf8').catch(e => { if (e.code === 'ENOENT') return '{"procedures":[]}'; throw e }))
  try {
    const a = start(); await once(a, 'message'); const b = start(); await once(b, 'message')
    for (const [child, title] of [[a, 'Skill A'], [b, 'Skill B']]) { const saved = await call(child, { op: 'observe', title }); assert(saved.ok && saved.persisted) }
    assert.deepEqual((await disk()).procedures.map(p => p.title).sort(), ['Skill A', 'Skill B'])
    console.log('PASS two real Node processes merge distinct acknowledged global procedure additions')
    assert.equal((await call(b, { op: 'clear' })).ok, false, 'stale whole-library clear must conflict before deleting peers')
    await call(b, { op: 'reload' }); assert.equal((await call(b, { op: 'clear' })).ok, true)
    assert((await call(a, { op: 'dispose' })).persisted)
    assert.deepEqual((await disk()).procedures, [])
    console.log('PASS stale clear rejects; fresh clear succeeds; older store disposal never resurrects deleted procedures')
    for (const child of children) { const exited = once(child, 'exit'); child.send({ op: 'stop' }); await exited }
  } catch (e) {
    processFailure = e
  } finally {
    // Stop messages have no reply: disconnect/killing is handled below.
    for (const child of children) if (child.exitCode === null) { child.kill(); await once(child, 'exit') }
    children.length = 0
  }
  if (processFailure) {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
    await fs.rm(home, { recursive: true, force: true }); throw processFailure
  }
  try {
    const seed = adapter(home), store = createProcedureStorePre({ io: seed }); seed.load()
    const p = store.observe(candidate('Shared skill')).procedure
    const left = adapter(home), right = adapter(home), leftBase = left.load(), rightBase = right.load()
    assert(left.save({ ...leftBase, procedures: leftBase.procedures.map(row => ({ ...row, title: 'Left edit' })) }).ok)
    const conflict = right.save({ ...rightBase, procedures: rightBase.procedures.map(row => ({ ...row, title: 'Right edit' })) })
    assert.equal(conflict.ok, false); assert.match(conflict.error, /procedure-conflict/)
    assert.equal((await disk()).procedures[0].title, 'Left edit')
    const deleting = adapter(home); const removalBase = deleting.load()
    assert(deleting.save({ ...removalBase, procedures: [] }).ok)
    assert(left.save({ ...leftBase, procedures: leftBase.procedures.map(row => ({ ...row, title: 'Left edit' })) }).ok)
    assert.deepEqual((await disk()).procedures, [])
    console.log('PASS same-ID overlapping edits fail visibly; unchanged stale snapshots preserve remote removals')

    const pendingIo = adapter(home), pendingStore = createProcedureStorePre({ io: pendingIo }); pendingIo.load()
    const remote = adapter(home); remote.load(); const remoteStore = createProcedureStorePre({ io: remote }); remoteStore.observe(candidate('Remote skill'))
    const { MemoryEngine } = await loadIsolatedEngine(home)
    const engine = new MemoryEngine(); engine._scopedProcedureIo = pendingIo; engine._memoryHub = { stores: { procedures: pendingStore } }; engine.state.ws = home
    assert(engine.rehydrateProcedureScopes().ok); assert.equal(pendingStore.snapshot().procedures[0].title, 'Remote skill')
    remoteStore.clear(); assert(engine.rehydrateProcedureScopes().ok); assert.deepEqual(pendingStore.snapshot().procedures, [])
    console.log('PASS production rehydration uses disk deltas and accepts authoritative empty libraries without cached resurrection')

    const scopedDir = path.join(home, 'scoped-global'), workspaceDir = path.join(home, 'scoped-workspace')
    const scoped = adapter(scopedDir, { resolveWorkspace: () => ({ dir: workspaceDir, key: 'ws' }) })
    scoped.load(); const scopedStore = createProcedureStorePre({ io: scoped })
    const movable = scopedStore.observe(candidate('Move this skill')).procedure
    const peer = adapter(scopedDir), peerBase = peer.load()
    const peerAddition = createProcedureStorePre().observe(candidate('Peer skill')).procedure
    const proposed = { ...peerBase, procedures: [...peerBase.procedures, peerAddition] }
    const moved = scoped.migrate([{ procedureId: movable.procedureId, scope: 'workspace', workspaceRef: 'ws' }], () => {
      assert.equal(peer.save(proposed).ok, false, 'nested adapter cannot bypass a live migration owner through ALS')
    })
    assert(moved.ok); assert(peer.save(proposed).ok)
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(scopedDir, 'procedures.json'), 'utf8')).procedures.map(p => p.title), ['Peer skill'])
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(workspaceDir, 'procedures.json'), 'utf8')).procedures.map(p => p.title), ['Move this skill'])
    const unknown = adapter(path.join(home, 'unknown-global')); unknown.load()
    const unknownStore = createProcedureStorePre({ io: unknown })
    assert.equal(unknownStore.observe({ ...candidate('Pending workspace skill'), scope: 'workspace', workspaceRef: 'unknown-ws' }).persisted, false)
    assert.equal(unknown.load({ pendingSnapshot: unknownStore.snapshot() }).procedures[0].title, 'Pending workspace skill')
    console.log('PASS scope migration excludes nested writers; peer retry preserves the moved row; unresolved workspace pending data survives reload')

    const busy = adapter(home); busy.load()
    await withConfigLock(file, async () => {
      const started = Date.now(), result = busy.save({ schemaVersion: 1, procedures: [p] })
      assert.equal(result.ok, false); assert.match(result.error, /lock-busy/); assert(Date.now() - started < 500)
    })
    let deny = true
    const fault = adapter(home, { fsApi: { renameSync: (from, to) => { if (deny) throw Object.assign(new Error('injected write denied'), { code: 'ENOSPC' }); return syncFs.renameSync(from, to) } } })
    fault.load(); assert.equal(fault.save({ schemaVersion: 1, procedures: [p] }).ok, false)
    for (const suffix of ['.lock', '.lock.acquire', '.tmp']) await assert.rejects(fs.access(file + suffix), { code: 'ENOENT' })
    deny = false; assert(fault.save({ schemaVersion: 1, procedures: [p] }).ok)
    const corrupt = adapter(home); corrupt.load(); await fs.writeFile(file, 'broken library')
    assert.equal(corrupt.save({ schemaVersion: 1, procedures: [p] }).ok, false)
    assert.equal(await fs.readFile(file, 'utf8'), 'broken library')
    console.log('PASS busy same-process owner fails promptly; failed commit cleans lock/tmp and retries; newly corrupt library bytes are preserved')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
    await fs.rm(home, { recursive: true, force: true })
  }
}
