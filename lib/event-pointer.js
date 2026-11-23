import fs from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { TextDecoder } from 'node:util'
import { fileWithinRoots } from './file-boundary.js'
import { normalizeText } from './ledger-doc/protocol.js'

const utf8 = new TextDecoder('utf-8', { fatal: true })

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function failure(code, details = {}) {
  return { ok: false, code, ...details }
}

const FULL_SHA256 = /^[0-9a-f]{64}$/

function fingerprint(expected) {
  if (expected === undefined || expected === null || expected === '') return null
  if (typeof expected !== 'string') return { error: 'pointer-fingerprint-invalid' }
  let value = expected.trim()
  if (value.startsWith('sha256:')) value = value.slice(7)
  if (FULL_SHA256.test(value)) return { value }
  return { error: 'pointer-fingerprint-invalid' }
}

function recentMetadata(checkpoints, kind = 'handoff', eventId) {
  const rows = Array.isArray(checkpoints) ? checkpoints : []
  return rows
    .map((checkpoint, checkpointIndex) => ({ checkpoint, checkpointIndex }))
    .filter(({ checkpoint }) => checkpoint && checkpoint.kind === kind && typeof checkpoint.sourceRef === 'string' && checkpoint.sourceRef)
    .sort((a, b) => {
      const left = Number.isFinite(Number(a.checkpoint.at)) ? Number(a.checkpoint.at) : Number.NEGATIVE_INFINITY
      const right = Number.isFinite(Number(b.checkpoint.at)) ? Number(b.checkpoint.at) : Number.NEGATIVE_INFINITY
      if (right !== left) return right - left
      if (a.checkpointIndex !== b.checkpointIndex) return a.checkpointIndex - b.checkpointIndex
      return String(a.checkpoint.idemKey || '').localeCompare(String(b.checkpoint.idemKey || ''))
    })
    .slice(0, 3)
    .map(({ checkpoint, checkpointIndex }) => ({
      eventId: typeof eventId === 'string' && eventId ? eventId : checkpoint.eventId ?? null,
      checkpointIndex,
      idemKey: checkpoint.idemKey ?? null,
      at: checkpoint.at,
      kind: checkpoint.kind,
      sourceRef: checkpoint.sourceRef,
      sha16: checkpoint.sha16 ?? checkpoint.sha256?.slice?.(0, 16) ?? null,
    }))
}

async function recentOrError(options) {
  if (typeof options.readCheckpoints !== 'function') return []
  const checkpoints = await options.readCheckpoints(options.eventId)
  return recentMetadata(checkpoints, options.kind, options.eventId)
}

function failureWithRecent(code, sourceRef, options, error = null) {
  return recentOrError(options).then((recent) => failure(code, {
    sourceRef, recent,
    ...(error ? { error: String(error?.message || error), errorCode: error?.code || 'pointer-read-failed' } : {}),
  }))
}

function legacyText(options) {
  if (typeof options.legacyText === 'string') return options.legacyText
  if (options.checkpoint && typeof options.checkpoint.text === 'string') return options.checkpoint.text
  return undefined
}

/**
 * Read a real source behind a relative sourceRef. Never reads a legacy PLAN as history.
 * deps = { fs?, handoffDir }; options = { sourceRef, expectedNormalizedSha256,
 * expectedRawSha256?, checkpoint?, legacyText?, readCheckpoints? }.
 * expectedNormalizedSha256 requires a full 64-hex normalized fingerprint.
 * expectedSha256 is raw-only; sha16 is advisory and never proves equivalence.
 * A current PLAN path identifies only the current file, never historical contents.
 * Missing/legacy fingerprints never authorize guessing or substituting old history.
 */
export async function readPointerPre(deps = {}, options = {}) {
  const sourceRef = options.sourceRef
  if (sourceRef === undefined || sourceRef === null || sourceRef === '') {
    const text = legacyText(options)
    if (text !== undefined) return { ok: false, code: 'pointer-legacy', text, sourceRef: null }
    return failure('pointer-legacy', { sourceRef: null })
  }
  if (typeof sourceRef !== 'string' || path.isAbsolute(sourceRef) || path.win32.isAbsolute(sourceRef) || path.posix.isAbsolute(sourceRef)) {
    return failure('pointer-unsafe', { sourceRef })
  }
  const parts = sourceRef.replace(/\\/g, '/').split('/')
  if (parts.some((part) => part === '..' || part === '' || part === '.')) return failure('pointer-unsafe', { sourceRef })
  const handoffDir = deps.handoffDir
  if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) return failure('pointer-unsafe', { sourceRef })
  const io = deps.fs || fs
  try {
    const rootStat = io === fs ? lstatSync(handoffDir) : await io.lstat(handoffDir)
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return failure('pointer-unsafe', { sourceRef })
  } catch (error) { return failure('pointer-unsafe', { sourceRef, cause: String(error?.message || error) }) }
  // There is exactly one trust domain: the caller-declared handoff root.
  // A sourceRef may retain its handoff/ prefix; PLAN.md is the same current file,
  // never an alternate root or a historical snapshot.
  let relativeParts = parts.slice()
  while (relativeParts[0]?.toLowerCase() === 'handoff') relativeParts = relativeParts.slice(1)
  if (relativeParts.length === 0) return failure('pointer-unsafe', { sourceRef })
  if (relativeParts[0].toLowerCase() === 'archive') return failure('pointer-unsafe', { sourceRef, reason: 'archive-not-current-handoff' })
  const candidate = path.resolve(handoffDir, ...relativeParts)
  const physical = fileWithinRoots(candidate, [handoffDir], { strict: true, allowMissing: true })
  if (!physical) return failure('pointer-unsafe', { sourceRef })
  const missing = async () => {
    try { return await failureWithRecent('pointer-missing', sourceRef, options) }
    catch (error) { return failure('pointer-read-failed', { sourceRef, error: String(error?.message || error), errorCode: error?.code || 'pointer-read-failed' }) }
  }
  let stat
  try {
    stat = await io.lstat(physical)
  } catch (error) {
    if (error?.code === 'ENOENT') return missing()
    return failure('pointer-read-failed', { sourceRef, error: String(error?.message || error), errorCode: error?.code || 'pointer-read-failed' })
  }
  if (stat.isSymbolicLink()) return failure('pointer-unsafe', { sourceRef })
  if (stat.isDirectory()) return missing()
  if (!stat.isFile()) return failure('pointer-unsafe', { sourceRef })
  let bytes
  try {
    bytes = await io.readFile(physical)
  } catch (error) {
    if (error?.code === 'ENOENT') return missing()
    return failure('pointer-read-failed', { sourceRef, error: String(error?.message || error), errorCode: error?.code || 'pointer-read-failed' })
  }
  if (!Buffer.isBuffer(bytes)) bytes = Buffer.from(bytes)
  let text
  try { text = utf8.decode(bytes) } catch (error) { return failure('pointer-unsafe', { sourceRef, cause: String(error?.message || error) }) }
  const rawSha256 = digest(bytes)
  const normalizedSha256 = digest(normalizeText(text))
  const normalizedInput = options.expectedNormalizedSha256 ?? options.checkpoint?.normalizedSha256 ?? options.checkpoint?.normalizedsha256
  const normalizedExpected = fingerprint(normalizedInput)
  const rawInput = options.expectedRawSha256 ?? options.checkpoint?.rawSha256 ?? options.checkpoint?.rawsha256 ?? options.expectedSha256 ?? options.checkpoint?.sha256
  const rawExpected = fingerprint(rawInput)
  if (normalizedExpected?.error || rawExpected?.error) return failure('pointer-fingerprint-invalid', {
    sourceRef,
    field: normalizedExpected?.error ? 'normalizedSha256' : 'rawSha256',
    expected: normalizedExpected?.error ? normalizedInput : rawInput,
  })
  const expectedNormalized = normalizedExpected?.value || null
  const expectedRaw = rawExpected?.value || null
  if (!expectedNormalized && !expectedRaw) return failure('pointer-unverified', {
    sourceRef,
    bytes: bytes.length,
    rawSha256,
    normalizedSha256,
    sha16: normalizedSha256.slice(0, 16),
    physicalPath: physical,
  })
  if (expectedNormalized && expectedNormalized !== normalizedSha256) {
    return failure('pointer-drift', {
      sourceRef,
      expectedNormalizedSha256: expectedNormalized,
      actualNormalizedSha256: normalizedSha256,
      expectedRawSha256: expectedRaw,
      actualRawSha256: rawSha256,
      bytes: bytes.length,
      normalizedEqual: false,
    })
  }
  if (expectedRaw && expectedRaw !== rawSha256) {
    return failure('pointer-line-ending-changed', {
      sourceRef, text, bytes: bytes.length, rawSha256, normalizedSha256,
      expectedRawSha256: expectedRaw,
      actualRawSha256: rawSha256,
      normalizedEqual: true,
      warning: true,
    })
  }
  return {
    ok: true,
    sourceRef,
    text,
    bytes: bytes.length,
    rawSha256,
    normalizedSha256,
    sha16: normalizedSha256.slice(0, 16),
    physicalPath: physical,
    normalizedEqual: true,
    ...(expectedRaw ? { rawEqual: true } : {}),
  }
}

export default { readPointerPre }
