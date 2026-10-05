import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { validateSettingsPaths } from '../../lib/settings-safety.js'
import { canonicalScopeGuard, canonicalize, buildSourceCatalog, loadCorpusSnapshot } from '../../lib/m4-corpus.js'
import { buildSidecar } from '../../lib/memory-anchor.js'

let failed = 0
async function check(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-path-boundaries-'))
  try { await fn(root); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}
const directoryLink = process.platform === 'win32' ? 'junction' : 'dir'
function fileLink(target, file) {
  try { fs.symlinkSync(target, file); return true }
  catch (e) {
    if (process.platform !== 'win32' || e.code !== 'EPERM') throw e
    console.log('SKIP file symlink: Windows permission unavailable'); return false
  }
}
function load(source, sidecarDir) {
  const content = fs.readFileSync(source)
  const { sidecar } = buildSidecar({ sourceFile: source, content })
  const hash = createHash('sha256').update(canonicalize(source)).digest('hex')
  fs.writeFileSync(path.join(sidecarDir, hash + '.json'), JSON.stringify(sidecar))
  return loadCorpusSnapshot(buildSourceCatalog({ workspaceKey: path.dirname(source), workspaceMemoryPath: source }), { sidecarDir })
}
const content = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->\n## Entry\nSOURCE_TEXT\n'

await check('F4 existing and missing target suffixes accept a physical DSH_HOME alias', async root => {
  const real = path.join(root, 'real-home'), alias = path.join(root, 'alias-home')
  fs.mkdirSync(real); fs.symlinkSync(real, alias, directoryLink)
  fs.mkdirSync(path.join(real, 'existing'))
  for (const key of ['memoryRoot', 'userMemoryDir', 'workbenchRoot']) {
    for (const suffix of ['existing', 'not-created/child']) {
      assert.deepEqual(await validateSettingsPaths({ [key]: path.join(real, suffix) }, alias, path.resolve), {})
      assert.deepEqual(await validateSettingsPaths({ [key]: path.join(alias, suffix) }, real, path.resolve), {})
    }
  }
  assert.equal(fs.existsSync(path.join(real, 'not-created')), false, 'validation must not create directories')
  assert.ok((await validateSettingsPaths({ memoryRoot: real }, alias, path.resolve)).memoryRoot, 'the home root itself remains forbidden')
})

await check('F4 reject outside aliases, traversal, root itself and file-occupied ancestors', async root => {
  const home = path.join(root, 'home'), outside = path.join(root, 'home-other')
  fs.mkdirSync(home); fs.mkdirSync(outside)
  fs.symlinkSync(outside, path.join(home, 'outside'), directoryLink)
  fs.writeFileSync(path.join(home, 'file'), 'occupied')
  for (const target of [outside, path.join(home, '..', 'home-other', 'child'), path.join(home, 'outside', 'missing'), path.join(home, 'file', 'child'), home]) {
    assert.ok((await validateSettingsPaths({ workbenchRoot: target }, home, path.resolve)).workbenchRoot)
  }
})

await check('F7 real loader rejects a symlink to the adjacent prefix directory', root => {
  const declared = path.join(root, 'workspace'), other = path.join(root, 'workspace-other'), side = path.join(root, 'side')
  for (const dir of [declared, other, side]) fs.mkdirSync(dir)
  const target = path.join(other, 'MEMORY.md'), source = path.join(declared, 'MEMORY.md')
  fs.writeFileSync(target, content)
  if (!fileLink(target, source)) return
  assert.deepEqual(canonicalScopeGuard({ file: source }, source), { ok: false, reason: 'cross-workspace' })
  const result = load(source, side)
  assert.equal(result.snapshot.records.length, 0)
  assert.ok(result.dropped.some(x => x.reason === 'cross-workspace'))
})

await check('F7 preserve real internal files, links and declared-root aliases', root => {
  const home = path.join(root, 'workspace'), alias = path.join(root, 'alias'), side = path.join(root, 'side')
  fs.mkdirSync(home); fs.mkdirSync(side); fs.symlinkSync(home, alias, directoryLink)
  const target = path.join(home, 'MEMORY.md'); fs.writeFileSync(target, content)
  for (const source of [target, path.join(alias, 'MEMORY.md')]) assert.equal(load(source, side).snapshot.records.length, 1)
  const internal = path.join(home, 'linked.md')
  if (fileLink(target, internal)) assert.equal(load(internal, side).snapshot.records.length, 1)
})

await check('F7 POSIX source identity distinguishes case-only directory names', root => {
  if (process.platform === 'win32') return
  const upper = path.join(root, 'Project'), lower = path.join(root, 'project')
  fs.mkdirSync(upper); fs.mkdirSync(lower)
  const source = path.join(upper, 'MEMORY.md'), other = path.join(lower, 'MEMORY.md')
  fs.writeFileSync(source, content); fs.writeFileSync(other, content)
  assert.deepEqual(canonicalScopeGuard({ file: source }, other), { ok: false, reason: 'source-mismatch' })
})
if (failed) process.exitCode = 1
