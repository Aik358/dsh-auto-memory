import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = await mkdtemp(path.join(tmpdir(), 'dam-diagnostics-rotation-'))
const prior = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, DSH_HOME: process.env.DSH_HOME }
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
const { diag, flushDiagnostics, MemoryEngine } = await import('../lib/audit-engine.mjs')
const file = path.join(root, 'dsh-auto-memory-diagnose.log')
const cap = 2 * 1024 * 1024
const rename = fs.renameSync
try {
  fs.writeFileSync(file, Buffer.alloc(cap + 1, 65))
  diag('first rotation')
  await flushDiagnostics()
  assert.equal(fs.statSync(file + '.1').size, cap + 1)
  for (let i = 0; i < 2400; i++) diag('second rotation ' + 'B'.repeat(1000))
  await flushDiagnostics()
  assert(fs.statSync(file).size <= cap, 'second threshold must still rotate')
  assert(fs.readFileSync(file + '.1', 'utf8').includes('second rotation'))
  assert.deepEqual(fs.readdirSync(root).sort(), ['dsh-auto-memory-diagnose.log', 'dsh-auto-memory-diagnose.log.1'])

  fs.writeFileSync(file, Buffer.alloc(cap, 67))
  let blocked = true
  fs.renameSync = function (...args) {
    if (blocked && args[0] === file) throw Object.assign(new Error('fixture rename denied'), { code: 'EACCES' })
    return rename.apply(this, args)
  }
  syncBuiltinESMExports()
  diag('rotation failed but append survives')
  await flushDiagnostics()
  assert(fs.readFileSync(file, 'utf8').includes('append survives'))
  blocked = false
  diag('rotation recovers')
  await flushDiagnostics()
  assert(fs.statSync(file).size < cap)
  assert(fs.readFileSync(file + '.1', 'utf8').includes('append survives'))
  assert.equal(fs.readdirSync(root).length, 2)

  const before = fs.statSync(file).size
  diag('多字节\r\n'.repeat(100000))
  await flushDiagnostics()
  const added = fs.readFileSync(file).subarray(before)
  assert(added.length <= 8192, 'one line must be byte bounded')
  assert.equal(added.toString('utf8').split('\n').length, 2, 'multiline payload is one physical line')
  assert(added.toString('utf8').includes('[truncated]'))
  assert.equal(new MemoryEngine()._logsViewSnapshot().rotatedNow, true)
  console.log('PASS audit diagnostics rotation: repeated threshold, rename recovery, bounded UTF-8 line and file count')
} finally {
  fs.renameSync = rename; syncBuiltinESMExports()
  await flushDiagnostics()
  for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await rm(root, { recursive: true, force: true })
}
