import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
if (process.argv[2] === 'child') {
  const extract = path.join(process.env.DSH_HOME, 'extract-' + process.pid)
  await fs.mkdir(extract)
  const { MemoryEngine } = await loadIsolatedEngine(extract)
  const engine = new MemoryEngine()
  engine.config = JSON.parse(await fs.readFile(engine._configPath, 'utf8')); engine.configLoaded = true
  const file = path.join(engine.projectDirOf(process.env.TEST_WS), 'MEMORY.md')
  process.send({ ready: true, file })
  process.on('message', async message => {
    if (message === 'stop') return process.disconnect()
    const attempts = []
    // First request refreshes this stale process's config; the second still
    // carries the old resolver receipt despite the now-current engine config.
    for (let i = 0; i < 2; i++) {
      try { await engine.appendText(file, '## stranded-' + i); attempts.push('accepted') }
      catch (e) { attempts.push(e.code) }
    }
    process.send({ attempts })
  })
} else {
  const home = await fs.mkdtemp(path.join(tmpdir(), 'dam-mutation-gate-'))
  const before = process.env.DSH_HOME; process.env.DSH_HOME = home
  let child, release
  try {
    const { MemoryEngine, DEFAULT_CONFIG } = await loadIsolatedEngine(home)
    const engine = new MemoryEngine(), user = path.join(home, 'memory'), oldRoot = path.join(user, 'workspaces'), nextRoot = path.join(user, 'next-workspaces'), ws = path.join(home, 'workspace')
    engine.config = { ...DEFAULT_CONFIG, userMemoryDir: user, memoryRoot: oldRoot }; engine.configLoaded = true
    engine.refresh = async () => {}
    await fs.writeFile(engine._configPath, JSON.stringify(engine.config))
    const oldFile = path.join(engine.projectDirOf(ws), 'MEMORY.md')
    await fs.mkdir(path.dirname(oldFile), { recursive: true }); await fs.writeFile(oldFile, '# Original\n')
    child = fork(fileURLToPath(import.meta.url), ['child'], { env: { ...process.env, TEST_WS: ws }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true })
    const [ready] = await once(child, 'message'); assert.equal(ready.file, oldFile)
    await engine.saveConfig({ memoryRoot: nextRoot })
    const response = once(child, 'message'); child.send('write'); const [result] = await response
    assert.deepEqual(result.attempts, ['SETTINGS_ROOT_CHANGED', 'SETTINGS_ROOT_CHANGED'])
    for (const write of [() => engine.appendText(oldFile, '## stranded-parent'), () => engine.writeFullRaw(oldFile, 'stranded raw')]) await assert.rejects(write(), { code: 'SETTINGS_ROOT_CHANGED' })
    const activeFile = path.join(engine.projectDirOf(ws), 'MEMORY.md')
    assert.equal(await fs.readFile(oldFile, 'utf8'), '# Original\n')
    assert.equal(await fs.readFile(activeFile, 'utf8'), '# Original\n')
    console.log('PASS two actual processes: nested user ancestor cannot authorize stale workspace writes; refreshed engine still rejects old receipt')
    child.send('stop'); await once(child, 'exit'); child = null

    // Detached refresh descendants inherit ALS, start under the settings gate,
    // then cross an await. The gate cannot release until their admitted IO ends.
    const readyWrite = deferred(), resume = deferred(); release = resume.resolve
    let descendant
    engine.refresh = async () => {
      descendant = engine._withMemoryMutationPre(activeFile, async () => {
        readyWrite.resolve(); await resume.promise
        await engine.appendText(activeFile, '## Accepted detached refresh\n- keep it')
      })
    }
    let firstDone = false
    const first = engine.saveConfig({ locale: 'en' }).then(value => { firstDone = true; return value })
    await readyWrite.promise
    const other = new MemoryEngine(); other.config = { ...engine.config }; other.configLoaded = true; other.refresh = async () => {}
    let migrated = false
    const finalRoot = path.join(user, 'final-workspaces')
    const migration = other.saveConfig({ memoryRoot: finalRoot }).then(value => { migrated = true; return value })
    await new Promise(r => setTimeout(r, 40))
    assert.equal(firstDone, false); assert.equal(migrated, false)
    await fs.access(engine._configPath + '.lock')
    resume.resolve(); release = null
    await Promise.all([first, descendant, migration])
    const finalFile = path.join(other.projectDirOf(ws), 'MEMORY.md')
    assert.match(await fs.readFile(finalFile, 'utf8'), /Accepted detached refresh/)
    console.log('PASS admitted detached refresh write drains before lock release and next engine migration copies its accepted bytes')

    // Canonical config identity is shared through junction/symlink aliases.
    const alias = path.join(home, 'home-alias')
    await fs.symlink(home, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const aliased = new MemoryEngine(); aliased._configPath = path.join(alias, path.basename(engine._configPath)); aliased.config = { ...other.config }; aliased.configLoaded = true; aliased.refresh = async () => {}
    const aliasedFile = path.join(alias, path.relative(home, finalFile))
    aliased.projectDirOf(ws) // physical receipt can be consumed through an alias
    await aliased.appendText(aliasedFile, '## Through physical alias')
    assert.match(await fs.readFile(finalFile, 'utf8'), /Through physical alias/)
    await fs.unlink(alias)
    const userFile = path.join(other.userDirOf(), 'MEMORY.md')
    await other.appendText(userFile, '## User original')
    const nextUser = path.join(home, 'next-user')
    await other.saveConfig({ userMemoryDir: nextUser })
    await assert.rejects(other.appendText(userFile, 'stale user output'), { code: 'SETTINGS_ROOT_CHANGED' })
    assert.match(await fs.readFile(path.join(other.userDirOf(), 'MEMORY.md'), 'utf8'), /User original/)

    const memoryAlias = path.join(home, 'workspace-root-alias')
    await fs.symlink(finalRoot, memoryAlias, process.platform === 'win32' ? 'junction' : 'dir')
    await other.saveConfig({ memoryRoot: memoryAlias })
    const aliasResolvedFile = path.join(other.projectDirOf(ws), 'MEMORY.md')
    await fs.unlink(memoryAlias)
    const redirected = path.join(home, 'redirected-workspaces'); await fs.mkdir(redirected)
    await fs.symlink(redirected, memoryAlias, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(other.appendText(aliasResolvedFile, 'output based on old physical root'), { code: 'SETTINGS_ROOT_CHANGED' })
    await assert.rejects(fs.access(path.join(redirected, other.wsKey(ws), 'MEMORY.md')), { code: 'ENOENT' })
    await fs.unlink(memoryAlias)
    await fs.writeFile(other._configPath, 'broken durable config')
    await assert.rejects(other.appendText(finalFile, 'must not write'))
    assert.doesNotMatch(await fs.readFile(finalFile, 'utf8'), /must not write/)
    console.log('PASS canonical alias identity, physical retarget refusal, userDir migration, corrupt durable config refusal preserve original documents')
  } finally {
    if (release) release()
    if (child) { child.kill(); await once(child, 'exit') }
    if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before
    await fs.rm(home, { recursive: true, force: true })
  }
}
