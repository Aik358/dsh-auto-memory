import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const home = await fs.mkdtemp(path.join(tmpdir(), 'dam-physical-target-'))
Object.assign(process.env, { HOME: home, USERPROFILE: home, DSH_HOME: home })
const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const { MemoryEngine, DEFAULT_CONFIG } = await loadIsolatedEngine(home, repo)
const { MemoryDocumentStore } = await import(pathToFileURL(path.join(repo, 'lib/memory-writer.js')))
const { captureMemoryMutationPre } = await import(pathToFileURL(path.join(repo, 'lib/memory-mutation-transaction.js')))
const boundary = await import(pathToFileURL(path.join(repo, 'lib/file-boundary.js')))
const deferred = () => { let resolve; return { promise: new Promise(r => { resolve = r }), resolve: value => resolve(value) } }
const link = (target, alias) => fs.symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
const retarget = async (alias, target) => { await fs.unlink(alias); await link(target, alias) }
const originalText = '# Same original\n'
let sequence = 0

async function fixture(anchor = true) {
  const dir = path.join(home, 'case-' + ++sequence)
  const real = path.join(dir, 'admitted'), outside = path.join(dir, 'outside'), alias = path.join(dir, 'alias')
  await fs.mkdir(real, { recursive: true }); await fs.mkdir(outside); await link(real, alias)
  const engine = new MemoryEngine()
  engine._configPath = path.join(dir, 'settings.json')
  engine.config = { ...DEFAULT_CONFIG, memoryAnchorEnabled: anchor, memoryRoot: alias, userMemoryDir: path.join(dir, 'user'), boardMode: 'graph' }
  engine.configLoaded = true
  await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
  const project = engine.projectDirOf(path.join(dir, 'workspace'))
  const relative = path.relative(alias, project), physicalProject = path.join(real, relative), outsideProject = path.join(outside, relative)
  await fs.mkdir(project, { recursive: true }); await fs.mkdir(outsideProject, { recursive: true })
  const file = path.join(project, 'MEMORY.md'), physicalFile = path.join(physicalProject, 'MEMORY.md'), outsideFile = path.join(outsideProject, 'MEMORY.md')
  await fs.writeFile(file, originalText); await fs.writeFile(outsideFile, originalText)
  return { dir, real, outside, alias, engine, project, physicalProject, outsideProject, file, physicalFile, outsideFile }
}

test('same-byte root and auxiliary alias retarget cannot redirect document, backup, sidecar, temp or lock', { timeout: 10000 }, async () => {
  const f = await fixture(), snapshot = deferred(), release = deferred()
  const backup = path.join(f.dir, 'backup'), otherBackup = path.join(f.dir, 'other-backup'), backupAlias = path.join(f.dir, 'backup-alias')
  const sidecar = path.join(f.dir, 'sidecar'), otherSidecar = path.join(f.dir, 'other-sidecar'), sidecarAlias = path.join(f.dir, 'sidecar-alias')
  for (const p of [backup, otherBackup, sidecar, otherSidecar]) await fs.mkdir(p)
  await link(backup, backupAlias); await link(sidecar, sidecarAlias)
  const ioPaths = [], api = { ...fs }
  let intercepted = false
  for (const name of ['readFile', 'writeFile', 'mkdir', 'open', 'rename', 'copyFile', 'stat', 'unlink']) {
    api[name] = async (p, ...args) => {
      ioPaths.push(String(p))
      if (name === 'rename' || name === 'copyFile') ioPaths.push(String(args[0]))
      const value = await fs[name](p, ...args)
      // Match both spellings so this barrier also executes on the old code.
      if (name === 'readFile' && [f.file, f.physicalFile].includes(p) && !intercepted) {
        intercepted = true; snapshot.resolve(); await release.promise
      }
      return value
    }
  }
  f.engine._docStore = new MemoryDocumentStore({ fs: api, backupDir: backupAlias, sidecarDir: sidecarAlias,
    mutationAdmission: p => captureMemoryMutationPre(f.engine, p),
    mutationBoundary: (p, job, admission) => f.engine._withMemoryMutationPre(p, job, admission) })
  const pending = f.engine.appendText(f.file, 'Accepted physical target')
  try {
    await snapshot.promise
    assert.equal(await fs.stat(f.physicalFile + '.lock').then(() => true), true)
    await retarget(f.alias, f.outside); await retarget(backupAlias, otherBackup); await retarget(sidecarAlias, otherSidecar)
  } finally { release.resolve() }
  const receipt = await pending
  const written = await fs.readFile(f.physicalFile, 'utf8')
  assert.equal(await fs.readFile(f.outsideFile, 'utf8'), originalText)
  assert.match(written, /Accepted physical target/); assert.equal(receipt, written)
  const backups = await fs.readdir(backup), sidecars = await fs.readdir(sidecar)
  assert.equal(backups.length, 1); assert.equal(await fs.readFile(path.join(backup, backups[0]), 'utf8'), originalText)
  assert.equal(sidecars.length, 1)
  const metadata = JSON.parse(await fs.readFile(path.join(sidecar, sidecars[0]), 'utf8'))
  assert.equal(metadata.sourceFile, f.physicalFile)
  assert.deepEqual(await fs.readdir(otherBackup), []); assert.deepEqual(await fs.readdir(otherSidecar), [])
  assert(ioPaths.every(p => !p.startsWith(f.alias + path.sep) && !p.startsWith(backupAlias + path.sep) && !p.startsWith(sidecarAlias + path.sep)))
  assert.deepEqual((await fs.readdir(f.physicalProject)).filter(p => /\.lock|\.tmp/.test(p)), [])
  console.log(JSON.stringify({ sameByteOutsideUnchanged: true, physicalReceipt: receipt === written, backup: backups.length, sidecar: sidecars.length, sidecarPhysicalSource: metadata.sourceFile === f.physicalFile, lexicalIO: 0 }))
})

test('raw documents use the frozen snapshot and return its committed bytes', { timeout: 10000 }, async () => {
  const f = await fixture(false), snapshot = deferred(), release = deferred()
  let intercepted = false
  f.engine._rawDocStore = new MemoryDocumentStore({ fs: { ...fs, async readFile(p, ...args) {
    const value = await fs.readFile(p, ...args)
    if ([f.file, f.physicalFile].includes(p) && !intercepted) { intercepted = true; snapshot.resolve(); await release.promise }
    return value
  } }, mutationAdmission: p => captureMemoryMutationPre(f.engine, p), mutationBoundary: (p, job, admission) => f.engine._withMemoryMutationPre(p, job, admission) })
  const pending = f.engine.appendText(f.file, '\nRaw accepted target')
  try { await snapshot.promise; await retarget(f.alias, f.outside) } finally { release.resolve() }
  const receipt = await pending
  assert.equal(await fs.readFile(f.outsideFile, 'utf8'), originalText)
  assert.equal(receipt, await fs.readFile(f.physicalFile, 'utf8')); assert.match(receipt, /Raw accepted target/)
})

test('retarget before lock admission rejects without starting document IO', async () => {
  const f = await fixture(), entered = deferred(), release = deferred()
  let reads = 0, writes = 0
  f.engine._docStore = new MemoryDocumentStore({ fs: { ...fs,
    async readFile(...args) { reads++; return fs.readFile(...args) },
    async open(...args) { writes++; return fs.open(...args) } },
    mutationAdmission: p => captureMemoryMutationPre(f.engine, p),
    mutationBoundary: async (p, job, admission) => { entered.resolve(); await release.promise; return f.engine._withMemoryMutationPre(p, job, admission) } })
  const pending = f.engine.appendText(f.file, 'must not write')
  try { await entered.promise; await retarget(f.alias, f.outside) } finally { release.resolve() }
  await assert.rejects(pending, { code: 'SETTINGS_ROOT_CHANGED' })
  assert.equal(reads, 0); assert.equal(writes, 0); assert.equal(await fs.readFile(f.outsideFile, 'utf8'), originalText)
})

test('failed rename preserves its complete recovery candidate only at the admitted physical target', async () => {
  const f = await fixture(false), snapshot = deferred(), release = deferred()
  let intercepted = false
  f.engine._rawDocStore = new MemoryDocumentStore({ fs: { ...fs,
    async readFile(p, ...args) {
      const value = await fs.readFile(p, ...args)
      if ([f.file, f.physicalFile].includes(p) && !intercepted) { intercepted = true; snapshot.resolve(); await release.promise }
      return value
    }, async rename() { throw Object.assign(new Error('injected unrecoverable rename'), { code: 'EIO' }) } },
    mutationAdmission: p => captureMemoryMutationPre(f.engine, p), mutationBoundary: (p, job, admission) => f.engine._withMemoryMutationPre(p, job, admission) })
  const pending = f.engine.appendText(f.file, '\nRecoverable candidate').then(() => null, error => error)
  try { await snapshot.promise; await retarget(f.alias, f.outside) } finally { release.resolve() }
  const error = await pending
  assert.equal(error.written, false); assert.equal(error.recoveryComplete, true)
  assert.equal(path.dirname(error.recoveryPath), f.physicalProject)
  assert.match(await fs.readFile(error.recoveryPath, 'utf8'), /Recoverable candidate/)
  assert.equal(await fs.readFile(f.physicalFile, 'utf8'), originalText)
  assert.equal(await fs.readFile(f.outsideFile, 'utf8'), originalText)
  assert.deepEqual(await fs.readdir(f.outsideProject), ['MEMORY.md'])
})

test('all managed/raw/PLAN/sidecar gate callers consume their admitted physical target', async () => {
  for (const kind of ['managed', 'raw', 'plan', 'index', 'events', 'rebuild', 'entry']) {
    const f = await fixture(false)
    const method = f.engine._withMemoryMutationPre.bind(f.engine)
    let switched = false
    f.engine._withMemoryMutationPre = (file, job, admission) => method(file, async physicalFile => {
      if (!switched) { switched = true; await retarget(f.alias, f.outside) }
      return job(physicalFile)
    }, admission)
    const handoff = path.join(f.physicalProject, 'handoff'), outsideHandoff = path.join(f.outsideProject, 'handoff')
    await fs.mkdir(handoff); await fs.mkdir(outsideHandoff)
    if (kind === 'managed') await f.engine._writeManagedFilePre(f.file, 'Managed physical')
    if (kind === 'raw') await f.engine.writeFullRaw(f.file, 'Raw physical')
    if (kind === 'plan') {
      const result = await f.engine.writePlanSnapshot(f.project, f.engine.skeletonPlanTextPre(), { createOnly: true })
      assert.equal(result.ok, true); assert.equal(result.path, path.join(handoff, 'PLAN.md'))
    }
    if (kind === 'index') await f.engine._writeSidecarIndexPre(f.project, { entries: [] })
    if (kind === 'entry') assert.equal((await f.engine.writeSidecarEntryPre(f.project, 'handoff/PLAN.md', '# Preview physical\n', 'Preview', '')).ok, true)
    if (kind === 'events') await f.engine.appendSidecarEventPre(f.project, { event: 'physical' })
    if (kind === 'rebuild') assert.notEqual((await f.engine.rebuildSidecarIndexPre(f.project)).persisted, false)
    assert.equal(await fs.readFile(f.outsideFile, 'utf8'), originalText, kind)
    assert.deepEqual(await fs.readdir(outsideHandoff), [], kind)
    if (kind === 'managed' || kind === 'raw') assert.match(await fs.readFile(f.physicalFile, 'utf8'), /physical/i)
    if (kind === 'index' || kind === 'rebuild' || kind === 'entry') JSON.parse(await fs.readFile(path.join(handoff, 'index.json'), 'utf8'))
    if (kind === 'events') assert.match(await fs.readFile(path.join(handoff, 'events.jsonl'), 'utf8'), /physical/)
  }
})

test('directory aliases share the actual file lock and do not lose concurrent append', async () => {
  const f = await fixture(false), alias2 = path.join(f.dir, 'second-alias')
  await link(f.real, alias2)
  const secondFile = path.join(alias2, path.relative(f.alias, f.file))
  const a = new MemoryDocumentStore(), b = new MemoryDocumentStore()
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).appendRaw(i % 2 ? f.file : secondFile, '\nrow-' + i + '\n')))
  assert(results.every(result => result.ok))
  const written = await fs.readFile(f.physicalFile, 'utf8')
  for (let i = 0; i < 20; i++) assert.equal(written.split('\nrow-' + i + '\n').length, 2)
})

test('strict missing suffix resolution supports parent junctions and refuses dangling and ENOTDIR', async () => {
  const f = await fixture()
  assert.equal(boundary.resolvePhysicalTarget(path.join(f.alias, 'missing', 'deep', 'file.md')), path.join(f.real, 'missing', 'deep', 'file.md'))
  assert.throws(() => boundary.resolvePhysicalTarget(path.join(f.file, 'child')), { code: 'ENOTDIR' })
  const dangling = path.join(f.dir, 'dangling')
  await link(path.join(f.dir, 'does-not-exist'), dangling)
  assert.throws(() => boundary.resolvePhysicalTarget(path.join(dangling, 'child.md')), { code: 'ENOENT' })
})

test('final file symlink remains refused before document IO', async t => {
  const f = await fixture()
  const fileLink = path.join(f.project, 'file-link.md')
  try { await fs.symlink(f.outsideFile, fileLink, 'file') } catch (e) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(e.code)) { t.skip('Windows privilege required; Linux counterpart exercises final file symlink'); return }
    throw e
  }
  await assert.rejects(f.engine.rawDocStore.replaceRaw(fileLink, 'must not write'), { code: 'MEMORY_FILE_SYMLINK' })
  assert.equal(await fs.readFile(f.outsideFile, 'utf8'), originalText)
})

test.after(async () => { await fs.rm(home, { recursive: true, force: true }) })
