import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryEngine, apply, flushDiagnostics } from '../lib/audit-engine.mjs'
import { withCalendarLock } from '../../lib/calendar-lock.js'
import { planRevisionPre } from '../../lib/plan-store.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-settings-plan-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let releaseLock, holder, writer, migration, releaseSeed, seeder
try {
  const oldRoot = path.join(root, 'old'), nextRoot = path.join(root, 'next'), user = path.join(root, 'user')
  await mkdir(user, { recursive: true })
  const engine = new MemoryEngine()
  Object.assign(engine.config, { memoryRoot: oldRoot, userMemoryDir: user, criteriaGate: false, boardMode: 'legacy', teamEnabled: false })
  engine.configLoaded = true
  engine.refresh = async () => {}
  await mkdir(path.dirname(engine._configPath), { recursive: true })
  await writeFile(engine._configPath, JSON.stringify(engine.config))
  const project = engine.projectDirOf(path.join(root, 'workspace'))
  const file = path.join(project, 'handoff', 'PLAN.md')
  const created = await engine.writePlanSnapshot(project, '# Shared plan\n## Knowledge\nOriginal production PLAN contents sufficiently describe the project.\n')
  assert.equal(created.ok, true, created.error)
  const original = await readFile(file, 'utf8')
  const updated = original.replace('Original production', 'Updated production')
  let entered
  const locked = new Promise(resolve => { entered = resolve })
  const release = new Promise(resolve => { releaseLock = resolve })
  holder = withCalendarLock(file, async () => { entered(); await release })
  await locked
  writer = engine.writePlanSnapshot(project, updated, { expectedRevision: planRevisionPre(original) })
  let migrated = false
  migration = engine.saveConfig({ memoryRoot: nextRoot }).then(result => { migrated = true; return result })
  // Native PLAN.lock is still held: the production writer is admitted but cannot commit.
  for (let attempt = 0; attempt < 100 && !engine._settingsMigrationActive && !migrated; attempt++) await wait(5)
  const during = await engine.writePlanSnapshot(project, updated, { expectedRevision: planRevisionPre(original) })
  assert.equal(during.ok, false)
  assert.equal(during.error, 'settings-migration-active')
  assert.equal((await engine.ensurePlanBoardForAgentPre({ session: { id: 'migration-test', header: { cwd: path.join(root, 'workspace') } } })).error, 'settings-migration-active')
  assert.equal(migrated, false, 'migration must await the writer already queued on PLAN.lock')
  assert.equal(engine.config.memoryRoot, oldRoot)
  releaseLock(); releaseLock = undefined
  await holder
  const committed = await writer
  assert.equal(committed.ok, true, committed.error)
  await migration
  const migratedFile = path.join(engine.projectDirOf(path.join(root, 'workspace')), 'handoff', 'PLAN.md')
  assert.equal(await readFile(file, 'utf8'), updated)
  assert.equal(await readFile(migratedFile, 'utf8'), updated, 'active root must contain the acknowledged PLAN revision')
  assert.equal(engine._settingsPlanFlights.size, 0)
  console.log('PASS admitted PLAN writer drains before migration and its committed revision is copied')
  console.log('PASS new PLAN writer during migration fails explicitly without modifying the old root')

  // A caller waiting on the native lock must not use its captured root after it changes.
  let enteredAgain
  const lockedAgain = new Promise(resolve => { enteredAgain = resolve })
  const releaseAgain = new Promise(resolve => { releaseLock = resolve })
  holder = withCalendarLock(migratedFile, async () => { enteredAgain(); await releaseAgain })
  await lockedAgain
  writer = engine.writePlanSnapshot(path.dirname(path.dirname(migratedFile)), updated.replace('Updated production', 'Stale production'), { expectedRevision: planRevisionPre(updated) })
  engine.config = { ...engine.config, memoryRoot: path.join(root, 'changed-binding') }
  releaseLock(); releaseLock = undefined
  await holder
  const stale = await writer
  assert.equal(stale.ok, false)
  assert.equal(stale.error, 'settings-root-changed')
  assert.equal(await readFile(migratedFile, 'utf8'), updated)
  assert.equal(engine._settingsPlanFlights.size, 0)
  console.log('PASS queued PLAN writer rejects a changed root binding before reading or archiving')

  const broken = path.join(root, 'broken')
  await mkdir(path.join(broken, 'handoff', 'PLAN.md'), { recursive: true })
  assert.equal((await engine.writePlanSnapshot(broken, updated)).ok, false)
  assert.equal(engine._settingsPlanFlights.size, 0)
  await assert.rejects(engine.writePlanSnapshot(undefined, updated))
  assert.equal(engine._settingsPlanFlights.size, 0)
  console.log('PASS failed PLAN writes and invalid arguments do not leak migration flights')

  // The actual automatic seed chain resolves an old root before its PLAN read await.
  engine.config.memoryRoot = nextRoot
  const seedWs = path.join(root, 'empty-seed-workspace')
  const seedAgent = { session: { id: 'seed-migration-test', header: { cwd: seedWs } } }
  const seedOldFile = path.join(engine.projectDirOf(seedWs), 'handoff', 'PLAN.md')
  await mkdir(path.dirname(seedOldFile), { recursive: true })
  const read = engine.readTextSafe.bind(engine)
  let seedEntered
  const seedRead = new Promise(resolve => { seedEntered = resolve })
  const seedGate = new Promise(resolve => { releaseSeed = resolve })
  engine.readTextSafe = async file => { const result = await read(file); if (file === seedOldFile) { seedEntered(); await seedGate } return result }
  seeder = engine.ensurePlanBoardForAgentPre(seedAgent)
  await seedRead
  await engine.saveConfig({ memoryRoot: path.join(root, 'seed-migrated') })
  releaseSeed(); releaseSeed = undefined
  const staleSeed = await seeder
  assert.equal(staleSeed.ok, false)
  assert.equal(staleSeed.error, 'settings-root-changed')
  const seedActiveFile = path.join(engine.projectDirOf(seedWs), 'handoff', 'PLAN.md')
  await assert.rejects(access(seedOldFile), { code: 'ENOENT' })
  await assert.rejects(access(seedActiveFile), { code: 'ENOENT' })
  engine.readTextSafe = read
  const retry = await engine.ensurePlanBoardForAgentPre(seedAgent)
  assert.equal(retry.seeded, true, retry.error)
  assert.match(await readFile(seedActiveFile, 'utf8'), /自动建立/)
  console.log('PASS actual automatic seeder rejects a root changed during its PLAN read; retry seeds the active root')

  // ResolvePaths itself can yield before the automatic seed wrapper sees its result.
  const resolvePaths = engine.resolvePaths.bind(engine)
  let resolved
  const pathsReady = new Promise(resolve => { resolved = resolve })
  const pathsGate = new Promise(resolve => { releaseSeed = resolve })
  engine.resolvePaths = async agent => { const result = await resolvePaths(agent); resolved(result); await pathsGate; return result }
  const resolveAgent = { session: { id: 'resolve-migration-test', header: { cwd: path.join(root, 'unseeded-resolve-workspace') } } }
  seeder = engine.ensurePlanBoardForAgentPre(resolveAgent)
  const oldPaths = await pathsReady
  await engine.saveConfig({ memoryRoot: path.join(root, 'resolve-migrated') })
  releaseSeed(); releaseSeed = undefined
  const stalePaths = await seeder
  assert.equal(stalePaths.ok, false)
  assert.equal(stalePaths.error, 'settings-root-changed')
  await assert.rejects(access(oldPaths.planPath), { code: 'ENOENT' })
  engine.resolvePaths = resolvePaths
  const resolveRetry = await engine.ensurePlanBoardForAgentPre(resolveAgent)
  assert.equal(resolveRetry.seeded, true, resolveRetry.error)
  assert.match(await readFile((await engine.resolvePaths(resolveAgent)).planPath, 'utf8'), /自动建立/)
  console.log('PASS automatic seed wrapper preserves the root identity across actual path resolution')

  const boundFile = (await engine.resolvePaths(resolveAgent)).planPath
  const boundText = await readFile(boundFile, 'utf8')
  let boundEntered
  const boundReady = new Promise(resolve => { boundEntered = resolve })
  const boundGate = new Promise(resolve => { releaseLock = resolve })
  holder = withCalendarLock(boundFile, async () => { boundEntered(); await boundGate })
  await boundReady
  writer = engine.writePlanSnapshot(path.dirname(path.dirname(boundFile)), boundText, { expectedRevision: planRevisionPre(boundText) })
  let rebound = false
  migration = engine.saveConfig({ projectMemoryDir: path.join(root, 'absolute-project-binding') }).then(result => { rebound = true; return result })
  for (let attempt = 0; attempt < 100 && !engine._settingsMigrationActive && !rebound; attempt++) await wait(5)
  assert.equal(engine._settingsMigrationActive, true)
  assert.equal(rebound, false, 'projectMemoryDir publication also drains the admitted PLAN writer')
  releaseLock(); releaseLock = undefined
  await holder
  assert.equal((await writer).ok, true)
  await migration
  assert.equal(engine.config.projectMemoryDir, path.join(root, 'absolute-project-binding'))
  assert.equal(engine._settingsPlanFlights.size, 0)
  console.log('PASS absolute projectMemoryDir changes drain PLAN flights without expanding the copy contract')

  const writeIndex = engine.writeSidecarEntryPre.bind(engine)
  let indexEntered
  const indexReady = new Promise(resolve => { indexEntered = resolve })
  const indexGate = new Promise(resolve => { releaseSeed = resolve })
  engine.writeSidecarEntryPre = async (...args) => { const result = await writeIndex(...args); indexEntered(); await indexGate; return result }
  const absoluteProject = engine.projectDirOf(resolveAgent.session.header.cwd)
  writer = engine.writePlanSnapshot(absoluteProject, boundText)
  await indexReady
  await access(path.join(absoluteProject, 'handoff', 'PLAN.md.lock'))
  let reboundInside = false
  migration = engine.saveConfig({ projectMemoryDir: path.join(root, 'second-absolute-binding') }).then(result => { reboundInside = true; return result })
  for (let attempt = 0; attempt < 100 && !engine._settingsMigrationActive && !reboundInside; attempt++) await wait(5)
  assert.equal(engine._settingsMigrationActive, true)
  assert.equal(reboundInside, false, 'binding publication must wait after the lock callback root check too')
  assert.equal(engine.config.projectMemoryDir, absoluteProject)
  releaseSeed(); releaseSeed = undefined
  assert.equal((await writer).ok, true)
  await migration
  engine.writeSidecarEntryPre = writeIndex
  assert.equal(engine._settingsPlanFlights.size, 0)
  console.log('PASS binding changes drain writers already inside the native lock callback and awaiting real sidecar completion')

  // Real apply registration and tool callback; only background/provider activity is disabled.
  const toolHome = path.join(root, 'tool-home'), toolOld = path.join(toolHome, 'tool-old'), toolNext = path.join(toolHome, 'tool-next')
  await mkdir(toolHome, { recursive: true })
  await writeFile(path.join(toolHome, 'dsh-auto-memory.json'), JSON.stringify({ criteriaGate: false, boardMode: 'legacy', memoryRoot: toolOld, userMemoryDir: user, teamEnabled: false, globalBriefEnabled: false, externalSources: {}, l0IndexEnabled: false, greetingEnabled: false, pythonBackendEnabled: false }))
  const originals = Object.fromEntries(['loadConfigSync', 'refresh', 'checkUpdate', 'fetchNotices'].map(key => [key, MemoryEngine.prototype[key]]))
  const timers = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }, previousFetch = globalThis.fetch
  const listeners = new Map(['uncaughtException', 'unhandledRejection', 'exit'].map(key => [key, new Set(process.listeners(key))]))
  let toolEngine, cleanup, releaseTool, writing
  try {
    process.env.DSH_HOME = toolHome
    MemoryEngine.prototype.loadConfigSync = function () { toolEngine = this; return originals.loadConfigSync.call(this) }
    MemoryEngine.prototype.refresh = async () => {}
    MemoryEngine.prototype.checkUpdate = async () => ({})
    MemoryEngine.prototype.fetchNotices = async () => []
    globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
    globalThis.fetch = async () => new Response('{}', { status: 503 })
    const tools = []
    apply({ get: () => undefined, on: () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: tool => { tools.push(tool); return () => {} } }, webServer: { register: () => () => {} }, effect: effect => { cleanup = effect() } }, {})
    Object.assign(globalThis, timers)
    const toolAgent = { session: { id: 'tool-migration-test', header: { cwd: path.join(root, 'tool-workspace') } } }
    const originalResolve = toolEngine.resolvePaths.bind(toolEngine)
    let toolEntered
    const toolReady = new Promise(resolve => { toolEntered = resolve })
    const toolGate = new Promise(resolve => { releaseTool = resolve })
    // Inject the resolver-completion scheduling boundary, retaining its actual path result.
    toolEngine.resolvePaths = async agent => { const result = await originalResolve(agent); toolEntered(result); await toolGate; return result }
    const note = tools.find(tool => tool.name === 'memory_note')
    assert.ok(note)
    const content = '# Shared project\n## Knowledge\nActual registered tool contents describe the project architecture and operation.\n'
    writing = note.execute({ kind: 'plan', content }, { agent: toolAgent })
    const oldPaths = await toolReady
    await toolEngine.saveConfig({ memoryRoot: toolNext })
    releaseTool(); releaseTool = undefined
    const reply = await writing
    assert.match(reply, /settings-root-changed/)
    assert.doesNotMatch(reply, /已更新/)
    await assert.rejects(access(oldPaths.planPath), { code: 'ENOENT' })
    await assert.rejects(access(path.join(toolEngine.projectDirOf(oldPaths.ws), 'handoff', 'PLAN.md')), { code: 'ENOENT' })
    assert.equal(toolEngine._settingsPlanFlights?.size || 0, 0)
    toolEngine.resolvePaths = originalResolve
    const retried = await note.execute({ kind: 'plan', content }, { agent: toolAgent })
    assert.match(retried, /已更新/)
    assert.match(await readFile((await originalResolve(toolAgent)).planPath, 'utf8'), /Actual registered tool/)
    await assert.rejects(access(oldPaths.planPath), { code: 'ENOENT' })
    console.log('PASS actual registered PLAN tool rejects stale resolver completion and retries only in the active root')
  } finally {
    if (releaseTool) releaseTool()
    if (writing) await Promise.allSettled([writing])
    Object.assign(globalThis, timers)
    globalThis.fetch = previousFetch
    if (cleanup) cleanup()
    await flushDiagnostics()
    for (const [key, value] of Object.entries(originals)) MemoryEngine.prototype[key] = value
    for (const [key, previous] of listeners) for (const handler of process.listeners(key)) if (!previous.has(handler)) process.removeListener(key, handler)
    process.env.DSH_HOME = root
  }
} finally {
  if (releaseLock) releaseLock()
  if (releaseSeed) releaseSeed()
  await Promise.allSettled([holder, writer, migration, seeder].filter(Boolean))
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true })
}
