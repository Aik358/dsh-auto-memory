import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'
const home = await fs.mkdtemp(path.join(tmpdir(), 'dam-note-cas-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = home
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
const failures = []
try {
  const { MemoryEngine, DEFAULT_CONFIG } = await loadIsolatedEngine(home)
  for (const anchored of [false, true]) {
    const engine = new MemoryEngine()
    engine.config = { ...DEFAULT_CONFIG, memoryAnchorEnabled: anchored }
    const file = path.join(home, 'notes-' + anchored, 'MEMORY.md')
    await fs.mkdir(path.dirname(file), { recursive: true })
    const id = 'mem_' + 'a'.repeat(32)
    const initial = '<!-- memory:' + id + ' -->\n## Original\n- Keep accepted notes.\n'
    await fs.writeFile(file, initial)
    const ready = deferred(), resume = deferred(), write = engine.writeFull.bind(engine)
    engine.writeFull = async (p, text, opts) => {
      if (p === file) { ready.resolve(); await resume.promise }
      return write(p, text, opts)
    }
    const status = engine.applyNoteStatusPre(file, { retract: [id] }, initial)
    await ready.promise
    const appended = await engine.appendText(file, '## Accepted concurrently\n- Keep this addition.')
    assert(appended.includes('Accepted concurrently'))
    resume.resolve()
    const result = await status, final = await fs.readFile(file, 'utf8')
    try {
      assert(final.includes('Accepted concurrently'))
      assert(!final.includes('dsh-status: retracted'))
      assert(!result.includes('状态已更新'))
      console.log('PASS status CAS preserves accepted append; anchor=' + anchored)
    } catch (e) { failures.push('status anchor=' + anchored + ': ' + e.message) }
  }
  for (const layer of ['note', 'user']) {
    const engine = new MemoryEngine()
    engine.config = { ...DEFAULT_CONFIG, memoryAnchorEnabled: false }
    const projectDir = path.join(home, 'compact-' + layer), file = path.join(projectDir, 'MEMORY.md')
    await fs.mkdir(projectDir, { recursive: true })
    const initial = '## Older\n- Historical original.\n\n## Latest\n- Preserve latest.'
    await fs.writeFile(file, initial)
    engine.state[layer === 'user' ? 'userText' : 'notesText'] = initial
    const ready = deferred(), resume = deferred(), write = engine.writeFull.bind(engine)
    engine.writeFull = async (p, text, opts) => {
      if (p === file) { ready.resolve(); await resume.promise }
      return write(p, text, opts)
    }
    const compact = engine.compactLegacyLayer(null, layer, { projectDir, notesPath: file, userFile: file }, 0, false)
      .then(value => ({ value }), error => ({ error }))
    await ready.promise
    await engine.appendText(file, '## Accepted during compaction\n- Keep this addition.')
    resume.resolve(); const outcome = await compact
    try {
      assert(outcome.error, 'stale compaction must report a conflict')
      assert((await fs.readFile(file, 'utf8')).includes('Accepted during compaction'))
      const archive = await fs.readFile(path.join(projectDir, layer === 'user' ? 'archived-user.md' : 'archive/notes-archived.md'), 'utf8')
      assert(archive.includes('Historical original'))
      console.log('PASS legacy compaction rejects stale replacement and preserves archive; layer=' + layer)
    } catch (e) { failures.push('legacy ' + layer + ': ' + e.message) }
  }
  assert.deepEqual(failures, [])
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
  await fs.rm(home, { recursive: true, force: true })
}
