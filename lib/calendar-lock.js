import { mkdir } from 'node:fs/promises'
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

// Recovery is serialized with acquisition: no process may install a new owner
// while another is checking/removing a dead owner's transaction lock.
function isDead(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false
  try { process.kill(owner.pid, 0); return false } catch (e) { return e.code === 'ESRCH' }
}
function removeDead(file) {
  try {
    const before = statSync(file)
    const owner = JSON.parse(readFileSync(file, 'utf8'))
    if (!isDead(owner)) return false
    const after = statSync(file)
    if (before.ino !== after.ino || before.dev !== after.dev) return false
    unlinkSync(file); return true
  } catch (_) { return false }
}
function claim(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); unlinkSync(file); throw e }
}
export async function withCalendarLock(file, job, { timeoutMs = 10000 } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  const lock = file + '.lock', gate = lock + '.acquire'
  const deadline = Date.now() + timeoutMs
  let handle
  while (handle === undefined) {
    let acquisition
    try {
      acquisition = claim(gate)
      try { handle = claim(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claim(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      // An abandoned acquisition gate fails visibly. Remove it only after
      // stopping all instances; automatically unlinking it can race a new gate.
    } finally {
      if (acquisition !== undefined) { closeSync(acquisition); unlinkSync(gate) }
    }
    if (handle === undefined) {
      if (Date.now() >= deadline) throw new Error('calendar-lock-timeout: ' + lock)
      await delay(20)
    }
  }
  try { return await job() } finally { closeSync(handle); unlinkSync(lock) }
}
