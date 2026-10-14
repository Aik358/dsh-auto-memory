import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'

const { MemoryEngine } = await loadPrivateEngine()
const engine = Object.create(MemoryEngine.prototype)
engine.resolvePaths = async (agent) => ({ ws: agent.session.header.cwd })
const pending = []
engine._smartRecallCore = (query, agent) => new Promise((resolve) => pending.push({ query, agent, resolve }))
const a = { session: { id: 'A', header: { cwd: '/fixture/A' } } }
const b = { session: { id: 'B', header: { cwd: '/fixture/B' } } }
const work = [engine.smartRecall('query-A', a), engine.smartRecall('query-B', b)]
await new Promise((resolve) => setImmediate(resolve))
assert.equal(pending.length, 2, 'different questions and workspaces must never share answers')
pending.forEach((p) => p.resolve(p.query))
assert.deepEqual(await Promise.all(work), ['query-A', 'query-B'])
const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-380-'))
const file = path.join(dir, 'MEMORY.md'), id = 'mem_' + '1'.repeat(32)
try {
  engine.config = { handoffEnabled: false }
  engine.resolvePaths = async () => ({ projectDir: dir, reflectDir: dir, notesPath: file, userFile: path.join(dir, 'absent') })
  engine.listDailyLogs = engine.listReflections = async () => []
  for (const newline of ['\n', '\r\n']) {
    const content = '<!-- memory:' + id + ' -->' + newline + '## 中文 🙂' + newline + '正文应逐字保持。'
    const values = []
    for (const bom of ['', '\ufeff']) {
      await fs.writeFile(file, bom + content)
      const original = await fs.readFile(file)
      values.push(await engine.expandMemoryRecordPre(id, a))
      assert.deepEqual(await fs.readFile(file), original)
    }
    assert.equal(values[0], values[1], 'BOM must not shift the expansion byte range')
    assert.match(values[1], /正文应逐字保持。$/)
  }
  console.log('PASS #378/#380 concurrent answers and BOM expansion preserve source identity')
} finally { await fs.rm(dir, { recursive: true, force: true }) }
