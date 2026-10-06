import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { loadSecurityEngine } from '../lib/security-engine.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sec259-'))
const prior = process.env.DSH_HOME
const priorHome = process.env.HOME, priorProfile = process.env.USERPROFILE
process.env.DSH_HOME = root
process.env.HOME = root; process.env.USERPROFILE = root
try {
  const { MemoryEngine } = await loadSecurityEngine()
  const project = path.join(root, 'project'), user = path.join(root, 'user'), outside = path.join(root, 'project-neighbor')
  for (const dir of [project, user, outside]) await fs.mkdir(dir)
  await fs.writeFile(path.join(project, 'ordinary.md'), 'ORDINARY_INSIDE')
  await fs.writeFile(path.join(user, 'CALENDAR.md'), 'ORDINARY_CALENDAR')
  await fs.writeFile(path.join(outside, 'secret.md'), 'SYNTHETIC_OUTSIDE_SECRET')
  const engine = new MemoryEngine()
  engine.projectDirOf = () => project; engine.userDirOf = () => user
  engine._wsSummaryRecord = async () => null
  const output = path.join(root, 'export.dam-pack')
  const exportNow = () => engine.migrateExport({ ws: 'synthetic-workspace', outPath: output, compress: false })
  const normal = await exportNow(); assert(normal.ok)
  let pack = JSON.parse(await fs.readFile(output, 'utf8'))
  assert.equal(pack.files['ordinary.md'], 'ORDINARY_INSIDE')
  assert.equal(pack.userFiles['CALENDAR.md'], 'ORDINARY_CALENDAR')
  // Creating file links may be unavailable on Windows; report that gap explicitly.
  let linksAvailable = true
  try { await fs.symlink(path.join(outside, 'secret.md'), path.join(project, 'outside.md'), 'file') }
  catch (error) {
    if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error
    linksAvailable = false
    console.log('UNPROVEN file-symlink matrix: ' + error.code + ' on ' + process.platform)
    if (process.env.DSH_REQUIRE_FILE_SYMLINK === '1') throw error
  }
  if (linksAvailable) {
    await fs.symlink(path.join(project, 'ordinary.md'), path.join(project, 'inside.md'), 'file')
    await fs.symlink(path.join(outside, 'missing.md'), path.join(project, 'dangling.md'), 'file')
    await fs.unlink(path.join(user, 'CALENDAR.md'))
    await fs.symlink(path.join(outside, 'secret.md'), path.join(user, 'CALENDAR.md'), 'file')
    const result = await exportNow(); assert(result.ok)
    pack = JSON.parse(await fs.readFile(output, 'utf8'))
    assert.equal(pack.files['inside.md'], 'ORDINARY_INSIDE', 'tree-local alias must remain supported')
    assert(!Object.hasOwn(pack.files, 'outside.md'))
    assert(!Object.hasOwn(pack.files, 'dangling.md'))
    assert(!Object.hasOwn(pack.userFiles, 'CALENDAR.md'))
    assert(!JSON.stringify(pack).includes('SYNTHETIC_OUTSIDE_SECRET'))
    for (const rel of ['outside.md', 'dangling.md', 'user:CALENDAR.md']) assert(result.skipped.includes(rel + '(outside-memory-root)'), rel + ' silent skip')
    console.log('PASS #259 actual file-symlink outside/inside/dangling/calendar matrix and explicit skipped reasons on ' + process.platform)
  }
  // Directory aliases retain the existing no-traversal behavior.
  await fs.symlink(outside, path.join(project, 'directory-link'), process.platform === 'win32' ? 'junction' : 'dir')
  const directory = await exportNow(); assert(directory.ok)
  pack = JSON.parse(await fs.readFile(output, 'utf8'))
  assert(!JSON.stringify(pack).includes('SYNTHETIC_OUTSIDE_SECRET'))
  console.log('PASS #259 ordinary project/calendar export and directory-link non-traversal controls')
} finally {
  if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior
  if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome
  if (priorProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = priorProfile
  await fs.rm(root, { recursive: true, force: true })
}
