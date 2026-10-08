// One transaction boundary for settings saves and startup migrations.
import { AsyncLocalStorage } from 'node:async_hooks'
import { openSync, closeSync, writeFileSync, readFileSync, unlinkSync, statSync, lstatSync, realpathSync, mkdirSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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

// Readers register under the existing acquisition gate. Exclusive owners check
// these durable leases under that same gate before entering their transaction.
// A busy reader makes the exclusive attempt release immediately: retaining an
// exclusive lock while waiting would block a reader's queued nested archive.
function hasReaders(file) {
  const prefix = path.basename(file) + '.reader-'
  for (const name of readdirSync(path.dirname(file))) {
    if (!name.startsWith(prefix) || !name.endsWith('.lock')) continue
    const lease = path.join(path.dirname(file), name)
    try { lstatSync(lease) } catch (e) { if (e.code === 'ENOENT') continue; throw e }
    if (!removeDead(lease)) return true
  }
  return false
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
    if (handle !== undefined && hasReaders(file)) { closeSync(handle); handle = undefined; unlinkSync(lock) }
  } catch (e) {
    if (handle !== undefined) { closeSync(handle); handle = undefined; unlinkSync(lock) }
    if (e.code !== 'EEXIST') throw e
  }
  finally { if (acquisition !== undefined) { closeSync(acquisition); unlinkSync(gate) } }
  return handle === undefined ? null : () => { closeSync(handle); unlinkSync(lock) }
}

function tryAcquireRead(file) {
  const gate = file + '.lock.acquire', lock = file + '.lock'
  const lease = file + '.reader-' + process.pid + '-' + randomUUID() + '.lock'
  let acquisition, handle
  try {
    acquisition = claim(gate)
    try { lstatSync(lock); if (!removeDead(lock)) return null }
    catch (e) { if (e.code !== 'ENOENT') throw e }
    handle = claim(lease)
  } catch (e) { if (e.code !== 'EEXIST') throw e }
  finally { if (acquisition !== undefined) { closeSync(acquisition); unlinkSync(gate) } }
  return handle === undefined ? null : () => { closeSync(handle); unlinkSync(lease) }
}

// ★B-1 偏差（对 PR#221 原文此处 mkdirSync 的替换，已实测归因，共一处语义差异）：
//   原写法在 mkdir 失败时直接抛出，而这里的失败**不代表锁的问题**，代表
//   「配置文件的父目录根本不可用」（如父路径被一个普通文件占位）。
//   实测：smoke-test-settings-safety 把 _configPath 指到 <home>/block/settings.json
//   （block 是文件），原写法先抛 EEXIST、修 mkdir 后又在 .lock.acquire 上抛 ENOENT，
//   两种都把调用方真正的「ENOTDIR / save failed」**掩盖**成一条无从理解的错误。
//   锁不该替写盘决定错误面 ⇒ 目录不可用时**跳过加锁**，把控制权交回真实的写盘路径报错。
//   安全性：该路径本就不可能写入任何字节，故此处不存在「两个写者互不互斥」的风险。
function ensureLockDir(file) {
  try { mkdirSync(path.dirname(file), { recursive: true }); return true } catch (_) { return false }
}

function owned(file) {
  return context.getStore()?.some(token => token.active && token.file === file && token.mode !== 'read')
}

function readOwned(file) {
  return context.getStore()?.some(token => token.active && token.file === file && token.mode === 'read')
}

function rejectUpgrade(file) {
  if (readOwned(file) && !owned(file)) throw Object.assign(new Error('config-lock-upgrade refused inside a memory write'), { code: 'CONFIG_LOCK_UPGRADE' })
}

function run(file, job, release, async, mode = 'write') {
  const token = { file, active: true, mode }
  const tokens = [...(context.getStore() || []), token]
  const finish = () => { token.active = false; release() }
  if (async) return context.run(tokens, async () => { try { return await job() } finally { finish() } })
  return context.run(tokens, () => { try { return job() } finally { finish() } })
}

export function withConfigLockSync(file, job) {
  file = canonical(file)
  if (owned(file)) return job()
  rejectUpgrade(file)
  if (!ensureLockDir(file)) return job()
  const release = tryAcquire(file)
  // Never block the event loop: it may be running the asynchronous owner.
  if (!release) throw Object.assign(new Error('config-lock-busy: startup migration deferred'), { code: 'CONFIG_LOCK_BUSY' })
  return run(file, job, release, false)
}

export async function withConfigLock(file, job, { timeoutMs = 10000 } = {}) {
  file = canonical(file)
  if (owned(file)) return job()
  rejectUpgrade(file)
  if (!ensureLockDir(file)) return job()
  const deadline = Date.now() + timeoutMs
  let release
  while (!(release = tryAcquire(file))) {
    if (Date.now() >= deadline) throw new Error('config-lock-timeout')
    await delay(20)
  }
  return run(file, job, release, true)
}

/** Shared durable root lease: independent documents keep their own IO ordering. */
export async function withConfigReadLock(file, job, { timeoutMs = 10000 } = {}) {
  file = canonical(file)
  if (owned(file) || readOwned(file)) return job()
  if (!ensureLockDir(file)) return job()
  const deadline = Date.now() + timeoutMs
  let release
  while (!(release = tryAcquireRead(file))) {
    if (Date.now() >= deadline) throw new Error('config-read-lock-timeout')
    await delay(20)
  }
  return run(file, job, release, true, 'read')
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
