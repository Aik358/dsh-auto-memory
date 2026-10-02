import { mkdir, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Exclusive lock covers the whole read/modify/write transaction. A crashed
// owner's lock is retained: fail visibly rather than guess and overwrite data.
export async function withCalendarLock(file, job, { timeoutMs = 10000 } = {}) {
  await mkdir(path.dirname(file), { recursive: true })
  const lock = file + '.lock'
  const deadline = Date.now() + timeoutMs
  let handle
  while (!handle) {
    try { handle = await open(lock, 'wx') } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (Date.now() >= deadline) throw new Error('calendar-lock-timeout: ' + lock)
      await delay(20)
    }
  }
  try { return await job() } finally {
    await handle.close()
    await unlink(lock)
  }
}
