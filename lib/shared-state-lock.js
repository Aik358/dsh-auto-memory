// Async shared-state scheduling over the common cross-process protocol.
import { mkdir, lstat } from 'node:fs/promises'
import { canonicalFilePath, tryAcquireFileLock } from './process-file-lock.js'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export async function canonicalSharedStatePath(file) {
  try { return canonicalFilePath(file) } catch (e) {
    if (e.code !== 'ENOENT') throw e
    return path.resolve(file)
  }
}

export async function acquireSharedStateLock(file, { timeoutMs = 10000 } = {}) {
  try { if ((await lstat(file)).isSymbolicLink()) throw Object.assign(new Error('state-file-symlink refused: ' + file), { statePersistence: true }) } catch (e) { if (e.code !== 'ENOENT') throw e }
  file = await canonicalSharedStatePath(file)
  await mkdir(path.dirname(file), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let release
  while (!(release = tryAcquireFileLock(file))) {
    if (Date.now() >= deadline) throw new Error('state-lock-timeout: ' + file + '.lock')
    await delay(20)
  }
  return release
}

export async function withSharedStateLock(file, job, options) {
  const release = await acquireSharedStateLock(file, options)
  try { return await job() } finally { release() }
}
