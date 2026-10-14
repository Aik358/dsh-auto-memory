import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { buildPackPre } from '../../lib/migrate-pack.js'

const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-migration-receipts-'))
const oldHome = process.env.DSH_HOME; process.env.DSH_HOME = dir
try {
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  const engine = new MemoryEngine()
  const project = path.join(dir, 'project'), user = path.join(dir, 'user')
  await fs.mkdir(path.join(project, 'blocked'), { recursive: true }); await fs.mkdir(user)
  await fs.writeFile(path.join(project, 'MEMORY.md'), 'fixture memory')
  await fs.writeFile(path.join(project, 'blocked', 'hidden.md'), 'fixture unenumerated file')
  engine.projectDirOf = () => project; engine.userDirOf = () => user; engine._wsSummaryRecord = async () => null
  const defaultExport = await engine.migrateExport({ ws: '/fixture/workspace', compress: false })
  assert.equal(defaultExport.ok, true, 'the empty output form must have a real controlled default')
  assert.ok(defaultExport.path.startsWith(path.join(dir, 'exports')))
  const originalReadDir = fs.readdir
  fs.readdir = async (p, ...args) => { if (p === path.join(project, 'blocked')) throw Object.assign(Error('fixture denied'), { code: 'EACCES' }); return originalReadDir(p, ...args) }
  syncBuiltinESMExports()
  let partial
  try { partial = await engine.migrateExport({ ws: '/fixture/workspace', outPath: path.join(dir, 'chosen'), compress: false }) }
  finally { fs.readdir = originalReadDir; syncBuiltinESMExports() }
  assert.equal(partial.incomplete, true)
  assert.ok(partial.skipped.some((item) => item.includes('blocked') && item.includes('EACCES')))
  const pack = buildPackPre({ ws: '/fixture/source', files: { 'MEMORY.md': 'fixture imported memory' } }).pack
  for (const compressed of [false, true]) {
    const bytes = compressed ? gzipSync(Buffer.from(JSON.stringify(pack))) : Buffer.from(JSON.stringify(pack))
    const uploaded = await engine.migrateUploadPre(Readable.from([bytes.subarray(0, 11), bytes.subarray(11)]), 'fixture.dam-pack' + (compressed ? '.gz' : ''))
    assert.equal(uploaded.ok, true); assert.equal((await engine._readPack(uploaded.path)).ok, true)
  }
  await assert.rejects(engine.migrateUploadPre(Readable.from([Buffer.from('not a pack')]), 'fixture.dam-pack'), /pack/)
  await assert.rejects(engine.migrateUploadPre(Readable.from([]), 'directory'), /file name/)
  console.log('PASS #395/#396/#398 migration defaults, read-failure receipts and real pack-file upload')
} finally { if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome; await fs.rm(dir, { recursive: true, force: true }) }
