import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { withCalendarLock } from '../../lib/calendar-lock.js'
import { planRevisionPre } from '../../lib/plan-store.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-settings-plan-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
let releaseLock, holder, writer, migration
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
} finally {
  if (releaseLock) releaseLock()
  await Promise.allSettled([holder, writer, migration].filter(Boolean))
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await rm(root, { recursive: true, force: true })
}
