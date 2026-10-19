// Cross-process transactions with dead-owner recovery.
import { mkdir, realpath, lstat } from 'node:fs/promises'
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

export async function canonicalSharedStatePath(file) {
  let target = path.resolve(file)
  const suffix = []
  for (;;) {
    try { return path.join(await realpath(target), ...suffix) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(target)
      if (parent === target) return path.resolve(file)
      suffix.unshift(path.basename(target)); target = parent
    }
  }
}
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

const GATE_STALE_MS_PRE = 30000

export function reclaimDeadGate(gate, staleMs = GATE_STALE_MS_PRE) {
  if (removeDead(gate)) return true
  try {
    const before = statSync(gate)
    let parsed = null
    try { parsed = JSON.parse(readFileSync(gate, 'utf8')) } catch (_) { parsed = null }
    if (parsed !== null) return false
    if (!Number.isFinite(staleMs) || staleMs < 0) return false
    if (Date.now() - before.mtimeMs < staleMs) return false
    const after = statSync(gate)
    if (before.ino !== after.ino || before.dev !== after.dev) return false
    unlinkSync(gate)
    return true
  } catch (_) { return false }
}
function claim(file) {
  const fd = openSync(file, 'wx')
  try { writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })); return fd }
  catch (e) { closeSync(fd); unlinkSync(file); throw e }
}
export async function acquireSharedStateLock(file, { timeoutMs = 10000, gateStaleMs = GATE_STALE_MS_PRE } = {}) {
  try { if ((await lstat(file)).isSymbolicLink()) throw Object.assign(new Error('state-file-symlink refused: ' + file), { statePersistence: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
  file = await canonicalSharedStatePath(file)
  await mkdir(path.dirname(file), { recursive: true })
  const lock = file + '.lock', gate = lock + '.acquire'
  const deadline = Date.now() + timeoutMs
  let handle
  while (handle === undefined) {
    let acquisition
    let gateReclaimed = false
    try {
      acquisition = claim(gate)
      try { handle = claim(lock) } catch (e) {
        if (e.code !== 'EEXIST') throw e
        if (removeDead(lock)) handle = claim(lock)
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      gateReclaimed = reclaimDeadGate(gate, gateStaleMs)
    } finally {
      if (acquisition !== undefined) {
        try { closeSync(acquisition) } catch (_) {}
        try { unlinkSync(gate) } catch (_) {}
      }
    }
    if (handle === undefined) {
      if (Date.now() >= deadline) throw new Error('state-lock-timeout: ' + lock)
      if (!gateReclaimed) await delay(20)
    }
  }
  return () => { closeSync(handle); unlinkSync(lock) }
}

export async function withSharedStateLock(file, job, options) {
  const release = await acquireSharedStateLock(file, options)
  try { return await job() } finally { release() }
}
