import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'

const root = await fs.mkdtemp(path.join(tmpdir(), 'dam-host-recovery-'))
const prior = process.env.DSH_HOME
process.env.DSH_HOME = root
try {
  const { MemoryEngine } = await loadPrivateEngine()
  const engine = new MemoryEngine()
  engine.config = { subagentGcEnabled: true, l0IndexEnabled: true }
  engine.configLoaded = true
  const cacheFile = path.join(root, 'storages', 'session_projcache_archive_manager_v2', 'sessions', 'session_hash.json')
  await fs.mkdir(path.dirname(cacheFile), { recursive: true })
  await fs.mkdir(path.join(root, 'subagent-gc-backup', 'workspace', 'gone-child'), { recursive: true })
  await fs.writeFile(cacheFile, JSON.stringify({ record: { rows: { subagentCatalog: { val: { head: { values: [{ childId: 'gone-child' }] } } } } } }))
  const swept = await engine.subagentGcSweep(true)
  assert.equal(swept.ok, true)
  assert.equal(swept.recycled, 0)
  assert.equal(swept.catalogPurged, 1)

  const blocked = path.join(root, 'not-a-directory')
  await fs.writeFile(blocked, 'not a directory')
  assert.deepEqual(await engine.listDailyLogs(blocked), [])
  await assert.rejects(engine.listDailyLogs(blocked, 14, true))
  await assert.rejects(engine.listReflections(blocked, 14, true))
  assert.deepEqual(await engine.listReflections(path.join(root, 'absent'), 14, true), [])
  const source = (await fs.readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
  const start = source.indexOf('    engine.syncL0IndexPre = async')
  const end = source.indexOf('    // Persistent L0', start)
  const { createL0IndexSyncPre } = await import('../../lib/l0-index-sync.js')
  const indexes = new Map([['prior', { entries: ['keep-existing-index'] }]])
  engine._l0IndexSync = createL0IndexSyncPre({ io: { readJson: (p) => indexes.get(p), writeJson: (p, o) => indexes.set(p, o) }, embedder: { embedPassages: async (texts) => texts.map(() => [1, 0]) }, readText: (p) => fs.readFile(p, 'utf8') })
  engine.l0IndexDir = () => path.join(root, 'l0')
  engine.resolvePaths = async () => ({ projectDir: blocked, reflectDir: path.join(root, 'absent') })
  vm.runInNewContext(source.slice(start, end), { engine, path, diag() {} })
  const sync = await engine.syncL0IndexPre()
  assert.equal(sync.ok, false)
  assert.equal(indexes.size, 1)
  assert.deepEqual(indexes.get('prior').entries, ['keep-existing-index'])
  console.log('PASS #358 backup-only ghosts are purged; #374 actual host refuses incomplete directory enumeration')
} finally {
  if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior
  await fs.rm(root, { recursive: true, force: true })
}
