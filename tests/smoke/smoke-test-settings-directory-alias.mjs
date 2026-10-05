import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'dam-settings-alias-'))
const previous = process.env.DSH_HOME
process.env.DSH_HOME = root
try {
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  const { migrateSettingsTree } = await import('../../lib/settings-safety.js')
  const engine = new MemoryEngine({})
  const user = path.join(root, 'user'), memory = path.join(root, 'workspaces')
  await mkdir(user); await mkdir(memory)
  const note = 'original memory bytes', calendar = '## 2026-10-05\n- --:-- retained calendar'
  await writeFile(path.join(user, 'MEMORY.md'), note)
  await writeFile(path.join(user, 'CALENDAR.md'), calendar)
  await writeFile(path.join(memory, 'workspace.json'), '{"retained":true}')
  engine._configPath = path.join(root, 'settings.json')
  engine.config = { ...engine.config, userMemoryDir: user, memoryRoot: memory }
  engine.refresh = async () => {}
  await writeFile(engine._configPath, JSON.stringify(engine.config))
  const userAlias = path.join(root, 'user-alias'), memoryAlias = path.join(root, 'memory-alias')
  for (const [source, alias] of [[user, userAlias], [memory, memoryAlias]]) {
    await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await engine.saveConfig({ userMemoryDir: userAlias, memoryRoot: memoryAlias })
  const saved = JSON.parse(await readFile(engine._configPath, 'utf8'))
  assert.equal(saved.userMemoryDir, userAlias); assert.equal(saved.memoryRoot, memoryAlias)
  assert.equal(engine.config.userMemoryDir, userAlias)
  assert.equal(await readFile(path.join(user, 'MEMORY.md'), 'utf8'), note)
  assert.equal(await readFile(path.join(userAlias, 'CALENDAR.md'), 'utf8'), calendar)
  assert.deepEqual((await readdir(user)).sort(), ['CALENDAR.md', 'MEMORY.md'])
  assert.deepEqual(await readdir(memory), ['workspace.json'])
  // The copy operation itself still refuses alias equality and nested overlap.
  await assert.rejects(migrateSettingsTree(user, userAlias), /must not overlap/)
  await assert.rejects(engine.saveConfig({ userMemoryDir: path.join(userAlias, 'nested') }), /must not overlap/)
  assert.equal(engine.config.userMemoryDir, userAlias)
  assert.equal(JSON.parse(await readFile(engine._configPath, 'utf8')).userMemoryDir, userAlias)
  console.log('PASS actual config saves: user/memory aliases preserve bytes; real overlapping migrations remain rejected')
} finally {
  previous === undefined ? delete process.env.DSH_HOME : process.env.DSH_HOME = previous
  await rm(root, { recursive: true, force: true })
}
