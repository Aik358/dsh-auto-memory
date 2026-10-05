import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'
import { migrateSettingsTree } from '../../lib/settings-safety.js'

const home = await fs.mkdtemp(path.join(tmpdir(), 'dsh-settings-migration-names-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const {MemoryEngine, DEFAULT_CONFIG} = await loadPrivateEngine()
  const engine = new MemoryEngine()
  const source = path.join(home, 'old'), target = path.join(home, 'new')
  const workspace = path.join(home, 'workspace.tmp.project')
  engine.config = {...DEFAULT_CONFIG, memoryRoot:source, userMemoryDir:path.join(home, 'user')}
  engine.configLoaded = true
  engine.refresh = async () => {}
  const workspaceKey = engine.wsKey(workspace)
  const durable = [
    'MEMORY.md', 'research.tmp.md', 'research.tmp.notes.md',
    'archive.lock/MEMORY.md', 'archive.lock.acquire/PLAN.md',
    'archive.tmp/MEMORY.md', 'archive.tmp.1/MEMORY.md', 'archive.tmp-1/MEMORY.md',
  ]
  for (const relative of durable) {
    const file = path.join(source, workspaceKey, relative)
    await fs.mkdir(path.dirname(file), {recursive:true})
    await fs.writeFile(file, 'durable ' + relative)
  }
  const artifacts = ['writer.lock', 'writer.lock.acquire', 'writer.tmp', 'writer.tmp-1', 'writer.tmp-123-2', 'writer.tmp.1', 'writer.tmp.123.2']
  for (const name of artifacts) await fs.writeFile(path.join(source, workspaceKey, name), 'writer artifact')
  await fs.mkdir(path.join(target, workspaceKey), {recursive:true})
  await fs.writeFile(path.join(target, workspaceKey, 'research.tmp.md'), 'existing destination notes')
  await fs.mkdir(engine.userDirOf(), {recursive:true})
  await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
  await engine.saveConfig({memoryRoot:target})
  assert.equal(engine.config.memoryRoot, target)
  assert.equal(JSON.parse(await fs.readFile(engine._configPath, 'utf8')).memoryRoot, target)
  for (const relative of durable) {
    assert.equal(await fs.readFile(path.join(source, workspaceKey, relative), 'utf8'), 'durable ' + relative)
    assert.equal(await fs.readFile(path.join(target, workspaceKey, relative), 'utf8'), relative === 'research.tmp.md' ? 'existing destination notes' : 'durable ' + relative)
  }
  for (const name of artifacts) await assert.rejects(fs.stat(path.join(target, workspaceKey, name)), {code:'ENOENT'})
  console.log('PASS actual MemoryEngine: .tmp. workspace and durable filenames/directories migrate; sources and existing targets preserved; regular writer artifacts excluded')

  // An excluded artifact can become a data directory during the copy. The final
  // rescan must use entry types too and reject the newly introduced subtree.
  const changingSource = path.join(home, 'changing-old'), changingTarget = path.join(home, 'changing-new')
  await fs.mkdir(changingSource)
  await fs.writeFile(path.join(changingSource, 'MEMORY.md'), 'original notes')
  await fs.writeFile(path.join(changingSource, 'writer.tmp'), 'temporary')
  const changingIO = {...fs, copyFile:async (from, to, flags) => {
    await fs.copyFile(from, to, flags)
    await fs.unlink(path.join(changingSource, 'writer.tmp'))
    await fs.mkdir(path.join(changingSource, 'writer.tmp'))
    await fs.writeFile(path.join(changingSource, 'writer.tmp', 'MEMORY.md'), 'new durable notes')
  }}
  await assert.rejects(migrateSettingsTree(changingSource, changingTarget, {io:changingIO}), /source directory changed/)
  await assert.rejects(fs.stat(path.join(changingTarget, 'MEMORY.md')), {code:'ENOENT'})
  assert.equal(await fs.readFile(path.join(changingSource, 'writer.tmp', 'MEMORY.md'), 'utf8'), 'new durable notes')
  console.log('PASS final rescan detects artifact-to-directory changes and rolls back its own copies')
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  await fs.rm(home, {recursive:true, force:true})
}
