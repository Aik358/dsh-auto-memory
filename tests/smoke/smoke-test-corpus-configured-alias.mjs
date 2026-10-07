import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'
import { directoryLink, probeFileSymlinks, unprovenFileLink } from '../lib/link-fixture.mjs'

const home = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'dam-corpus-alias-')))
const previous = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(key => [key, process.env[key]]))
Object.assign(process.env, { HOME: home, USERPROFILE: home, DSH_HOME: home })
let passed = 0, failed = 0
const check = async (label, job) => {
  try { await job(); passed++; console.log('PASS ' + label) }
  catch (error) { failed++; console.error('FAIL ' + label + ': ' + error.stack) }
}
try {
  const { MemoryEngine, DEFAULT_CONFIG } = await loadIsolatedEngine(home)
  const { MemoryDocumentStore } = await import('../../lib/memory-writer.js')
  const { buildSourceCatalog, loadCorpusSnapshot, canonicalScopeGuard, canonicalize } = await import('../../lib/m4-corpus.js')
  const { buildSidecar } = await import('../../lib/memory-anchor.js')
  const user = path.join(home, 'user'), project = path.join(home, 'project')
  const userAlias = path.join(home, 'user-alias'), projectAlias = path.join(home, 'project-alias')
  for (const dir of [user, project]) fs.mkdirSync(dir)
  directoryLink(user, userAlias); directoryLink(project, projectAlias)
  const engine = new MemoryEngine()
  engine.config = { ...DEFAULT_CONFIG, userMemoryDir: userAlias, projectMemoryDir: projectAlias, memoryRoot: path.join(home, 'workspaces') }
  engine.configLoaded = true
  fs.writeFileSync(engine._configPath, JSON.stringify(engine.config))
  const agent = { session: { id: 'alias-session', header: { cwd: path.join(home, 'workspace') } } }
  const paths = await engine.resolvePaths(agent)
  const sidecarDir = path.join(home, 'sidecars'), store = new MemoryDocumentStore({ sidecarDir })
  const inputs = [[paths.userFile, 'USER-ALIAS'], [paths.notesPath, 'PROJECT-ALIAS'], [paths.logPath, 'TODAY-ALIAS']]
  for (const [file, label] of inputs) {
    fs.writeFileSync(file, '<!-- memory:mem_' + createHash('sha256').update(label).digest('hex').slice(0, 32) + ' -->\n' + label + '\n')
    assert.equal((await store.rebuildSidecar(file)).ok, true)
  }
  await check('actual engine + production writer sidecars load all three configured alias sources', () => {
    const catalog = buildSourceCatalog({ workspaceKey: paths.ws, userMemoryPath: paths.userFile, workspaceMemoryPath: paths.notesPath, todayLogPath: paths.logPath })
    const result = loadCorpusSnapshot(catalog, { sidecarDir })
    assert.equal(result.ok, true)
    assert.equal(result.snapshot.counts.sources, 3, JSON.stringify(result.dropped))
    assert.deepEqual(result.snapshot.records.map(record => record.text.trim()), inputs.map(([, label]) => label))
    assert.equal(paths.userDir, user)
    assert.equal(paths.projectDir, project)
  })
  await check('approved directory alias with missing descendants remains creatable by actual engine writer', async () => {
    const fresh = new MemoryEngine()
    fresh._configPath = path.join(home, 'missing-settings.json')
    fresh.config = { ...DEFAULT_CONFIG, userMemoryDir: path.join(userAlias, 'missing', 'deep'), projectMemoryDir: path.join(projectAlias, 'missing', 'deep') }
    fresh.configLoaded = true
    fs.writeFileSync(fresh._configPath, JSON.stringify(fresh.config))
    const missing = await fresh.resolvePaths(agent)
    assert.equal(missing.userDir, path.join(user, 'missing', 'deep'))
    assert.equal(missing.projectDir, path.join(project, 'missing', 'deep'))
    await fresh.appendText(missing.userFile, '## Created user through configured alias')
    await fresh.appendText(missing.notesPath, '## Created project through configured alias')
    assert.match(fs.readFileSync(missing.userFile, 'utf8'), /Created user/)
    assert.match(fs.readFileSync(missing.notesPath, 'utf8'), /Created project/)
  })
  await check('retargeted configured User and absolute Workspace aliases reject previously captured destinations', async () => {
    for (const [alias, field, file] of [[userAlias, 'userMemoryDir', paths.userFile], [projectAlias, 'projectMemoryDir', paths.notesPath]]) {
      const outside = path.join(home, field + '-outside'); fs.mkdirSync(outside)
      const physicalFile = fs.realpathSync(file), original = fs.readFileSync(physicalFile, 'utf8')
      fs.unlinkSync(alias); directoryLink(outside, alias)
      try {
        await assert.rejects(engine.appendText(file, 'must not append stale alias output'), { code: 'SETTINGS_ROOT_CHANGED' })
        assert.equal(fs.readFileSync(physicalFile, 'utf8'), original)
        assert.deepEqual(fs.readdirSync(outside), [])
      } finally {
        fs.unlinkSync(alias); directoryLink(field === 'userMemoryDir' ? user : project, alias)
      }
    }
  })
  const negativeSidecars = path.join(home, 'negative-sidecars'); fs.mkdirSync(negativeSidecars)
  const fileLinks = probeFileSymlinks(home)
  const snapshotFor = file => {
    const built = buildSidecar({ sourceFile: file, content: fs.readFileSync(file) })
    assert.equal(built.ok, true)
    fs.writeFileSync(path.join(negativeSidecars, createHash('sha256').update(canonicalize(file)).digest('hex') + '.json'), JSON.stringify(built.sidecar))
    const catalog = buildSourceCatalog({ workspaceKey: 'independent-lexical-boundary', workspaceMemoryPath: file })
    return { guard: canonicalScopeGuard(catalog.sources[0], built.sidecar.sourceFile), result: loadCorpusSnapshot(catalog, { sidecarDir: negativeSidecars }) }
  }
  await check('unapproved escaped parent cannot promote its own physical target into an allowed root', () => {
    for (const name of ['project-other', 'outside']) {
      const outside = path.join(home, name), escaped = path.join(project, 'escape-' + name)
      fs.mkdirSync(outside)
      fs.writeFileSync(path.join(outside, 'MEMORY.md'), '<!-- memory:mem_' + 'b'.repeat(32) + ' -->\nOUTSIDE-CONTENT\n')
      directoryLink(outside, escaped)
      const { guard, result } = snapshotFor(path.join(escaped, 'MEMORY.md'))
      assert.equal(guard.reason, 'cross-workspace')
      assert.equal(result.snapshot.records.length, 0)
      assert.doesNotMatch(JSON.stringify(result.snapshot.records), /OUTSIDE-CONTENT/)
    }
  })
  if (fileLinks.available) {
    await check('legal internal file link is readable; external file link and sidecar source mismatch are rejected', () => {
      const inside = path.join(project, 'inside.md'), legal = path.join(project, 'legal.md'), outsideLink = path.join(project, 'outside.md')
      fs.writeFileSync(inside, '<!-- memory:mem_' + 'c'.repeat(32) + ' -->\nINTERNAL-LINK\n')
      fs.symlinkSync(inside, legal, 'file')
      const valid = snapshotFor(legal)
      assert.equal(valid.guard.ok, true)
      assert.equal(valid.result.snapshot.records[0].text.trim(), 'INTERNAL-LINK')
      fs.symlinkSync(path.join(home, 'outside', 'MEMORY.md'), outsideLink, 'file')
      const denied = snapshotFor(outsideLink)
      assert.equal(denied.guard.reason, 'cross-workspace')
      assert.equal(denied.result.snapshot.records.length, 0)
      const catalog = buildSourceCatalog({ workspaceKey: 'mismatch', workspaceMemoryPath: inside })
      assert.equal(canonicalScopeGuard(catalog.sources[0], outsideLink).reason, 'source-mismatch')
    })
  } else unprovenFileLink(fileLinks, 'corpus internal/external file-link controls (directory-link controls executed)')
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
  fs.rmSync(home, { recursive: true, force: true })
}
console.log('RESULT ' + passed + ' PASS / ' + failed + ' FAIL')
if (failed) process.exitCode = 1
