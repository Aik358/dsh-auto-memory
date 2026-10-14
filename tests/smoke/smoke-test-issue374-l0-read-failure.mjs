import assert from 'node:assert/strict'
import { createL0IndexSyncPre } from '../../lib/l0-index-sync.js'

const files = new Map()
let failed = false, removed = false
const sync = createL0IndexSyncPre({ io: { readJson: (p) => files.get(p), writeJson: (p, obj) => files.set(p, structuredClone(obj)) },
  embedder: { embedPassages: async (texts) => texts.map(() => [1, 0]) },
  readText: async (p) => {
    if (failed && p === 'b') throw Object.assign(new Error('denied'), { code: 'EACCES' })
    if (removed && p === 'b') throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    return '<!-- memory:mem_' + (p === 'a' ? 'a' : 'b').repeat(32) + ' -->\n## important memory\n- long enough content for indexing and retention'
  } })
const opts = { enabled: true, dir: 'index', workspaceKey: 'fixture', sources: [{ layer: 'project', path: 'a' }, { layer: 'project', path: 'b' }] }
assert.equal((await sync.sync(opts)).ok, true)
const before = JSON.stringify([...files])
failed = true
assert.equal((await sync.sync(opts)).ok, false)
assert.equal(JSON.stringify([...files]), before)
failed = false
assert.equal((await sync.sync(opts)).ok, true)
removed = true
const deletion = await sync.sync(opts)
assert.equal(deletion.ok, true)
assert.equal(deletion.files[0].removed, 1)
console.log('PASS #374 unreadable source preserves the complete prior layer; confirmed deletion still updates')
