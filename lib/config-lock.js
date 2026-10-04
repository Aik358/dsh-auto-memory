// One transaction boundary for settings saves and startup migrations.
import { AsyncLocalStorage } from 'node:async_hooks'
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync, lstatSync, realpathSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

const context = new AsyncLocalStorage()

function canonical(file) {
  let target = path.resolve(file)
  try {
    if (lstatSync(target).isSymbolicLink()) throw new Error('config-file-symlink refused')
  } catch (e) { if (e.code !== 'ENOENT') throw e }
  const suffix = []
  for (;;) {
    try { return path.join(realpathSync(target), ...suffix) } catch (e) {
      if (e.code !== 'ENOENT') throw e
      const parent = path.dirname(target)
      if (parent === target) throw e
      suffix.unshift(path.basename(target)); target = parent
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

// The acquisition gate serializes stale-owner recovery with new owners.
// An abandoned gate fails visibly rather than racing an automatic unlink.
function tryAcquire(file) {
  const lock = file + '.lock', gate = lock + '.acquire'
  let acquisition, handle
  try {
    acquisition = claim(gate)
    try { handle = claim(lock) } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (removeDead(lock)) handle = claim(lock)
    }
  } catch (e) { if (e.code !== 'EEXIST') throw e }
  finally { if (acquisition !== undefined) { closeSync(acquisition); unlinkSync(gate) } }
  return handle === undefined ? null : () => { closeSync(handle); unlinkSync(lock) }
}

function owned(file) {
  return context.getStore()?.some(token => token.active && token.file === file)
}

function run(file, job, release, async) {
  const token = { file, active: true }
  const tokens = [...(context.getStore() || []), token]
  const finish = () => { token.active = false; release() }
  if (async) return context.run(tokens, async () => { try { return await job() } finally { finish() } })
  return context.run(tokens, () => { try { return job() } finally { finish() } })
}

export function withConfigLockSync(file, job) {
  file = canonical(file)
  if (owned(file)) return job()
  mkdirSync(path.dirname(file), { recursive: true })
  const release = tryAcquire(file)
  // Never block the event loop: it may be running the asynchronous owner.
  if (!release) throw Object.assign(new Error('config-lock-busy: startup migration deferred'), { code: 'CONFIG_LOCK_BUSY' })
  return run(file, job, release, false)
}

export async function withConfigLock(file, job, { timeoutMs = 10000 } = {}) {
  file = canonical(file)
  if (owned(file)) return job()
  mkdirSync(path.dirname(file), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let release
  while (!(release = tryAcquire(file))) {
    if (Date.now() >= deadline) throw new Error('config-lock-timeout')
    await delay(20)
  }
  return run(file, job, release, true)
}

// A busy synchronous loader may read the last complete atomic snapshot, but
// must neither quarantine it nor perform migrations outside the transaction.
export function readConfigSnapshot(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config must be a JSON object')
    return value
  } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}
