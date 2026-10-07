// Shared cross-process acquisition protocol. Callers own scheduling/reentrancy.
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync, realpathSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function canonicalFilePath(file) {
  let target = path.resolve(file)
  const suffix = []
  for (;;) {
    try { return path.join(realpathSync(target), ...suffix) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(target)
      if (parent === target) throw e
      suffix.unshift(path.basename(target))
      target = parent
    }
  }
}

function claim(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); unlinkSync(file); throw e }
}

function removeDead(file) {
  try {
    const before = statSync(file)
    const owner = JSON.parse(readFileSync(file, 'utf8'))
    if (owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false
    try { process.kill(owner.pid, 0); return false } catch (e) { if (e.code !== 'ESRCH') return false }
    const after = statSync(file)
    if (before.ino !== after.ino || before.dev !== after.dev) return false
    unlinkSync(file)
    return true
  } catch (_) { return false }
}

// Serialize stale-owner recovery with new owners. An abandoned acquisition
// gate fails visibly; automatically unlinking it can race a new gate.
export function tryAcquireFileLock(file, { onContention } = {}) {
  const lock = file + '.lock', gate = lock + '.acquire'
  let acquisition, handle
  try {
    acquisition = claim(gate)
    try { handle = claim(lock) } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (removeDead(lock)) handle = claim(lock)
    }
  } catch (e) {
    if (e.code !== 'EEXIST') {
      // Windows can report delete-pending gate contention as access denied.
      // Scheduling callers retain their existing bounded wait/nonblocking policy.
      if (process.platform !== 'win32' || e.syscall !== 'open' || !['EPERM', 'EACCES'].includes(e.code)) throw e
      if (onContention) onContention(e)
    }
  }
  finally { if (acquisition !== undefined) { closeSync(acquisition); unlinkSync(gate) } }
  return handle === undefined ? null : () => { closeSync(handle); unlinkSync(lock) }
}
