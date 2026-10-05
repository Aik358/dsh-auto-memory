import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { withCalendarLock } from '../../lib/calendar-lock.js'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-calendar-process-'))
const file = path.join(root, 'CALENDAR.md')
const module = new URL('../../lib/calendar-lock.js', import.meta.url).href
function child(script) { return spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] }) }
try {
  await writeFile(file, 'old\n')
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    const proc = child(`import { withCalendarLock } from ${JSON.stringify(module)}; import { readFile, writeFile } from 'node:fs/promises'; await withCalendarLock(${JSON.stringify(file)}, async () => { const text = await readFile(${JSON.stringify(file)}, 'utf8'); await new Promise(r=>setTimeout(r,10)); await writeFile(${JSON.stringify(file)}, text + ${JSON.stringify(i + '\n')}); });`)
    const [code] = await once(proc, 'exit'); assert.equal(code, 0)
  }))
  assert.equal((await readFile(file, 'utf8')).trim().split('\n').length, 9)
  const owner = child(`import { withCalendarLock } from ${JSON.stringify(module)}; await withCalendarLock(${JSON.stringify(file)}, async () => { console.log('locked'); await new Promise(r=>setTimeout(r,60000)); });`)
  await once(owner.stdout, 'data')
  const heldOwner = JSON.parse(await readFile(file + '.lock', 'utf8'))
  assert.equal(heldOwner.pid, owner.pid)
  owner.kill('SIGKILL'); await once(owner, 'exit')
  await withCalendarLock(file, async () => {})
  await assert.rejects(readFile(file + '.lock'))
  // Unknown/foreign ownership is never stolen by age.
  await writeFile(file + '.lock', JSON.stringify({ pid: 1, host: 'another-host' }))
  await assert.rejects(withCalendarLock(file, async () => assert.fail(), { timeoutMs: 1 }), /calendar-lock-timeout/)
  console.log('PASS F31: cross-process serialization, killed-owner recovery, foreign-owner preservation')
} finally { await rm(root, { recursive: true, force: true }) }
