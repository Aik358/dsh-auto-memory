import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { purgeSubagentCatalog } from '../../lib/subagent-gc.js'

const root = await fs.mkdtemp(path.join(tmpdir(), 'dam-358-'))
try {
  const storageRoot = path.join(root, 'storages')
  const file = path.join(storageRoot, 'session_projcache_archive_manager_v2', 'sessions', 'session_hash.json')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const doc = { record: { rows: { subagentCatalog: { val: { head: { values: [{ childId: 'gone' }, { childId: 'live' }] } } } } } }
  await fs.writeFile(file, JSON.stringify(doc))
  const result = await purgeSubagentCatalog({ storageRoot, removedIds: ['gone'], onDiskIds: ['live'], backupRoot: path.join(root, 'backup'), apply: true })
  assert.equal(result.purged, 1)
  assert.deepEqual(JSON.parse(await fs.readFile(file)).record.rows.subagentCatalog.val.head.values, [{ childId: 'live' }])
  const logs = []
  await purgeSubagentCatalog({ storageRoot, removedIds: ['absent'], diag: (s) => logs.push(s), apply: true })
  assert.ok(logs.some((s) => s.includes('no catalog match')))
  console.log('PASS #358 nondefault hashed cache catalog is purged; zero hits are diagnosed')
} finally { await fs.rm(root, { recursive: true, force: true }) }
