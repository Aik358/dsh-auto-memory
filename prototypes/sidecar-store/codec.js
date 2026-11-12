import { createHash } from 'node:crypto'

/** Storage errors deliberately remain observable at the API boundary. */
export class IndexStorageError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'IndexStorageError'
    this.code = code
    Object.assign(this, details)
  }
}

export const sha256 = value => createHash('sha256').update(value).digest('hex')

/** Convert lower-level lock and filesystem failures at the public storage edge. */
export function storageFailure(cause) {
  if (cause instanceof IndexStorageError) return cause
  const message = cause instanceof Error ? cause.message : String(cause)
  const code = message.startsWith('state-lock-timeout:') ? 'INDEX_LOCK_TIMEOUT' : 'INDEX_PATH'
  return new IndexStorageError(code, message, { cause })
}

export function encodeEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.hasOwn(value, 'checksum')) {
    throw new IndexStorageError('INDEX_INVALID_ARGUMENT', 'A checksum envelope requires an object without a checksum property')
  }
  const core = JSON.stringify(value)
  return JSON.stringify({ ...value, checksum: sha256(core) })
}

/** Check exact JSON values, not an independently reordered representation. */
export function decodeEnvelope(raw, label = 'index data') {
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: true }).decode(raw)
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required')
    const { checksum, ...core } = value
    if (typeof checksum !== 'string' || !/^[a-f0-9]{64}$/.test(checksum) || sha256(JSON.stringify(core)) !== checksum) {
      throw new Error('checksum mismatch')
    }
    return value
  } catch (cause) {
    throw new IndexStorageError('INDEX_CORRUPT', `Invalid ${label}: ${cause.message}`, { cause })
  }
}
