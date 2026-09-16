/** Bounded rename retries for transient file-handle contention (Issue #48).
 * Delays are waits BEFORE attempts, not absolute timestamps. No unlink/copy
 * fallback: callers retain their own atomicity and failure policy.
 */
import { promises as fsDefault } from 'node:fs'
import { setTimeout as sleepDefault } from 'node:timers/promises'

export const RENAME_RETRY_DELAYS = Object.freeze([0, 50, 150, 400, 1000])
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

export async function retryRename(from, to, opts = {}) {
  const fsApi = opts.fs || fsDefault
  const configuredDelays = opts.delays || RENAME_RETRY_DELAYS
  const delays = Array.isArray(configuredDelays) ? configuredDelays.slice() : configuredDelays
  const sleep = opts.sleep || sleepDefault
  if (!Array.isArray(delays) || !delays.length || delays[0] !== 0 ||
      delays.some((ms) => !Number.isFinite(ms) || ms < 0)) {
    throw new TypeError('retryRename: delays must start with 0 and contain finite nonnegative waits')
  }
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await sleep(delays[attempt])
    try {
      await fsApi.rename(from, to)
      return
    } catch (error) {
      if (!TRANSIENT_RENAME_CODES.has(error && error.code) || attempt === delays.length - 1) throw error
    }
  }
}
