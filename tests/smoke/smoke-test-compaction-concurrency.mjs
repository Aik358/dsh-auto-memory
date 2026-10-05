import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { auditTemp } from '../lib/audit-host-fixture.mjs'
const root = await auditTemp('dam-compaction-cas-')
process.env.DSH_HOME = path.join(root, '.dsh')
process.env.HOME = root
process.env.USERPROFILE = root
const { MemoryEngine } = await import('../lib/audit-engine.mjs')
const { MemoryDocumentStore } = await import('../../lib/memory-writer.js')
try {
  for (const external of [false, true]) {
    const engine = new MemoryEngine()
    const projectDir = path.join(root, external ? 'external' : 'append')
    await fs.mkdir(projectDir, { recursive: true })
    const file = path.join(projectDir, 'MEMORY.md')
    const store = new MemoryDocumentStore({ backupDir: path.join(root, 'backups') })
    assert.equal((await store.append(file, '## OLD_NOTE\nPrior reusable information.')).ok, true)
    assert.equal((await store.append(file, '## LATEST_NOTE\nLatest reusable information.')).ok, true)
    let enter, resume
    const entered = new Promise(resolve => { enter = resolve })
    const paused = new Promise(resolve => { resume = resolve })
    engine.foldTextToSummaryPre = async () => { enter(); await paused; return '' }
    const pending = engine.compactAnchoredLayer(store, file, 'note', '2026-10-05', { projectDir }, 1, null, true)
    await entered
    if (external) await fs.appendFile(file, '\nEXTERNAL_USER_EDIT\n')
    else assert.equal((await store.append(file, '## CONCURRENT_NEW_NOTE\nAccepted while folding.')).ok, true)
    resume()
    const result = await pending
    assert.equal(result.ok, false, 'stale compaction must return a visible conflict')
    assert.match(result.reason, /conflict/)
    const fresh = await fs.readFile(file, 'utf8')
    assert.ok(fresh.includes(external ? 'EXTERNAL_USER_EDIT' : 'CONCURRENT_NEW_NOTE'))
    assert.ok(fresh.includes('OLD_NOTE'), 'failed replacement leaves original records intact')
    const archive = await fs.readFile(path.join(projectDir, 'archive', 'notes-archived.md'), 'utf8')
    assert.ok(archive.includes('OLD_NOTE'))
    engine.foldTextToSummaryPre = async () => ''
    assert.equal((await engine.compactAnchoredLayer(store, file, 'note', '2026-10-05', { projectDir }, 1, null, true)).ok, true)
    assert.ok((await fs.readFile(file, 'utf8')).includes(external ? 'EXTERNAL_USER_EDIT' : 'CONCURRENT_NEW_NOTE'))
  }
  console.log('PASS compaction preserves accepted appends and external edits; safe retry succeeds')
} finally { await fs.rm(root, { recursive: true, force: true }) }
