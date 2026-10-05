import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { MemoryEngine } from '../lib/audit-engine.mjs'

const root = await mkdtemp(path.join(os.tmpdir(), 'dam-migration-runtime-names-'))
const previous = process.env.DSH_HOME
process.env.DSH_HOME = root
try {
  const engine = new MemoryEngine()
  engine.configLoaded = true
  engine.loadConfig = async () => {}
  engine.refresh = async () => {}
  const source = path.join(root, 'user-old'), target = path.join(root, 'user-new')
  const durable = ['MEMORY.md', 'report.tmp.md', 'report.tmp.notes.md', 'report.tmp-final.md', 'report.tmp-1.md']
  const managedOnly = typeof engine._saveConfigChecked === 'function'
  const destination = name => managedOnly && name !== 'MEMORY.md' ? path.join('summaries', name) : name
  const runtime = ['writer.lock', 'writer.lock.acquire', 'writer.tmp', 'writer.tmp-1', 'writer.tmp-123-2', 'writer.tmp.1', 'writer.tmp.123.2', 'writer.tmp-11111111-2222-4333-8444-555555555555']
  await mkdir(source)
  if (managedOnly) await mkdir(path.join(source, 'summaries'))
  for (const name of [...durable, ...runtime]) await writeFile(path.join(source, destination(name)), 'original ' + name)
  engine.config = { memoryRoot: path.join(root, 'memory'), userMemoryDir: source }
  engine._configPath = path.join(root, 'config.json')
  await writeFile(engine._configPath, JSON.stringify(engine.config))
  await engine.saveConfig({ userMemoryDir: target })
  assert.equal(engine.config.userMemoryDir, target)
  assert.equal(JSON.parse(await readFile(engine._configPath, 'utf8')).userMemoryDir, target)
  for (const name of durable) assert.equal(await readFile(path.join(target, destination(name)), 'utf8'), 'original ' + name)
  for (const name of runtime) await assert.rejects(stat(path.join(target, destination(name))), { code: 'ENOENT' })
  for (const name of [...durable, ...runtime]) assert.equal(await readFile(path.join(source, destination(name)), 'utf8'), 'original ' + name)
  if (managedOnly) {
    await writeFile(path.join(source, 'unmanaged.tmp.md'), 'unmanaged source')
    const separate = path.join(root, 'unmanaged-target')
    await engine.saveConfig({ userMemoryDir: source })
    await engine.saveConfig({ userMemoryDir: separate })
    await assert.rejects(stat(path.join(separate, 'unmanaged.tmp.md')), { code: 'ENOENT' })
    assert.equal(await readFile(path.join(source, 'unmanaged.tmp.md'), 'utf8'), 'unmanaged source')
  }
  console.log('PASS actual saveConfig preserves durable .tmp names and excludes only terminal writer suffixes')

  const legacy = path.join(root, 'legacy.tmp.project'), copied = path.join(root, 'copied.tmp.project')
  const directories = ['archive.lock', 'archive.lock.acquire', 'archive.tmp', 'archive.tmp.1', 'archive.tmp-1']
  await mkdir(legacy)
  for (const name of [...durable, ...runtime]) await writeFile(path.join(legacy, name), 'legacy ' + name)
  for (const name of directories) {
    await mkdir(path.join(legacy, name))
    await writeFile(path.join(legacy, name, 'MEMORY.md'), 'directory ' + name)
  }
  await engine.copyDir(legacy, copied, true)
  for (const name of durable) assert.equal(await readFile(path.join(copied, name), 'utf8'), 'legacy ' + name)
  for (const name of runtime) await assert.rejects(stat(path.join(copied, name)), { code: 'ENOENT' })
  for (const name of directories) assert.equal(await readFile(path.join(copied, name, 'MEMORY.md'), 'utf8'), 'directory ' + name)
  console.log('PASS actual legacy copy traverses runtime-looking durable directories and preserves source files')
} finally {
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  await rm(root, { recursive: true, force: true })
}
