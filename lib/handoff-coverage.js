import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileWithinRoots } from './file-boundary.js'
import { computeLegacyCheckpointKey, normalizeText } from './ledger-doc/protocol.js'
import { readPointerPre } from './event-pointer.js'
import {
  HANDOFF_NORMALIZATION_ALGORITHM,
  normalizeHandoffContentPre,
  parseHandoffCoveragePre,
} from './handoff-normalize.js'

export { normalizeHandoffContentPre, parseHandoffCoveragePre }
export const HANDOFF_COVERAGE_SCHEMA = 'batch2-handoff-coverage-assessment-v1'
export const HANDOFF_SOURCE_PROOF_SCHEMA = 'batch2-handoff-source-proof-v1'

const QUAD_FIELDS = Object.freeze(['goal', 'state', 'dead', 'next'])
const EVENT_ID = /^evt_[0-9a-f]{8}$/
const CHECKPOINT_ID = /^ckpt_[0-9a-f]{16}$/
const FULL_SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const hex = (value) => typeof value === 'string' && FULL_SHA256.test(value.trim())
  ? value.trim().replace(/^sha256:/, '')
  : null

function failure(status, code, extra = {}) {
  return { ok: false, status, code, reasonCodes: [code], ...extra, eligibleForPhysicalDelete: false, eventClaimed: false, writesPerformed: false }
}

function canonicalSourceRef(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return null
  const parts = value.replace(/\\/g, '/').split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  while (parts[0]?.toLowerCase() === 'handoff') parts.shift()
  if (!parts.length || parts.some((part) => part.includes('/'))) return null
  return parts.join('/')
}

function sourceInput(input, options) {
  if (typeof input === 'string' || Buffer.isBuffer(input) || input instanceof Uint8Array) return input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (input.documentText != null) return input.documentText
    if (input.text != null) return input.text
    if (input.bytes != null) return { bytes: input.bytes }
    if (input.document != null) return input.document
  }
  return options.documentText ?? ''
}


async function readTrustedSource(handoffDir, sourceRef, io = fs) {
  let rootStat
  try {
    rootStat = await io.lstat(handoffDir)
  } catch { return { ok: false, code: 'pointer-unsafe', sourceRef } }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return { ok: false, code: 'pointer-unsafe', sourceRef }
  const physical = fileWithinRoots(path.resolve(handoffDir, ...sourceRef.split('/')), [handoffDir], { strict: true, allowMissing: true })
  if (!physical) return { ok: false, code: 'pointer-unsafe', sourceRef }
  let stat
  try { stat = await io.lstat(physical) } catch (error) {
    return { ok: false, code: error?.code === 'ENOENT' ? 'pointer-missing' : 'pointer-read-failed', sourceRef }
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, code: 'pointer-unsafe', sourceRef }
  let bytes
  try { bytes = await io.readFile(physical) } catch (error) {
    return { ok: false, code: error?.code === 'ENOENT' ? 'pointer-missing' : 'pointer-read-failed', sourceRef }
  }
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return { ok: false, code: 'pointer-unsafe', sourceRef } }
  return { ok: true, text, bytes, rawSha256: sha256(bytes), normalizedSha256: sha256(normalizeText(text)), physicalPath: physical }
}

function proofSkeleton(sourceRef, code) {
  return {
    schemaVersion: HANDOFF_SOURCE_PROOF_SCHEMA,
    algorithm: HANDOFF_NORMALIZATION_ALGORITHM,
    documentNormalizationAlgorithm: 'r4-ledger-doc-v1/normalizeText',
    ok: false,
    verified: false,
    code,
    sourceRef: sourceRef || null,
    rel: sourceRef || null,
    rawSha256: null,
    sha256: null,
    normalizedSha256: null,
    documentNormalizedSha256: null,
    bytes: null,
    startLine: null,
    endLine: null,
    quoteLine: null,
    lineRange: { start: null, end: null },
    pointerRead: null,
    physicalPath: null,
    eligibleForPhysicalDelete: false,
    eventClaimed: false,
    writesPerformed: false,
  }
}

/**
 * Build a DTO only after reading the actual relative Markdown behind trusted handoffDir.
 * normalizedSha256 is the 2.9 ledger-coverage hash. documentNormalizedSha256 is the
 * distinct normalizeText hash consumed by readPointerPre/event-drilldown; never swap them.
 */
export async function buildHandoffSourceProofPre(input, options = {}) {
  const suppliedRef = input && typeof input === 'object' && !Array.isArray(input) && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)
    ? input.sourceRef ?? options.sourceRef
    : options.sourceRef
  const sourceRef = canonicalSourceRef(suppliedRef)
  if (!sourceRef) return proofSkeleton(typeof suppliedRef === 'string' ? suppliedRef : null, 'source-ref-invalid')
  if (typeof options.handoffDir !== 'string' || !options.handoffDir) return proofSkeleton(sourceRef, 'source-root-required')
  let pointer
  let normalized
  let documentNormalizedSha256
  try {
    // Read the trusted root first: proof describes actual disk bytes, not a caller's
    // assertion that an in-memory document has already been persisted at that path.
    const initial = await readTrustedSource(options.handoffDir, sourceRef)
    if (!initial.ok) return { ...proofSkeleton(sourceRef, initial.code || 'source-proof-unverified'), pointerRead: { ...initial } }
    normalized = normalizeHandoffContentPre(initial.text, { maxBytes: options.maxBytes })
    pointer = await readPointerPre({ handoffDir: options.handoffDir }, {
      sourceRef,
      expectedRawSha256: initial.rawSha256,
      expectedNormalizedSha256: sha256(normalizeText(initial.text)),
    })
    if (!pointer.ok) return { ...proofSkeleton(sourceRef, pointer.code || 'source-proof-unverified'), pointerRead: { ...pointer } }
    documentNormalizedSha256 = sha256(normalizeText(pointer.text))
  } catch (error) {
    return { ...proofSkeleton(sourceRef, error.code || 'source-invalid'), error: String(error.message || error) }
  }
  if (pointer.rawSha256 !== normalized.rawSha256 || pointer.normalizedSha256 !== documentNormalizedSha256) {
    return { ...proofSkeleton(sourceRef, 'source-proof-fingerprint-mismatch'), pointerRead: { ...pointer } }
  }
  if (input && typeof input === 'object' && !Array.isArray(input) && !Buffer.isBuffer(input) && !(input instanceof Uint8Array)) {
    const expectDiskText = input.expectDiskText === true || options.expectDiskText === true
    if (expectDiskText && input.documentText != null && input.documentText !== pointer.text) return { ...proofSkeleton(sourceRef, 'source-text-mismatch') }
    if (expectDiskText && input.text != null && input.text !== pointer.text) return { ...proofSkeleton(sourceRef, 'source-text-mismatch') }
    const suppliedRaw = input.rawSha256 ?? input.rawsha256 ?? input.sha256
    const suppliedNormalized = input.normalizedSha256 ?? input.normalizedsha256
    const suppliedDocumentNormalized = input.documentNormalizedSha256 ?? input.documentnormalizedsha256
    if (suppliedRaw != null && hex(suppliedRaw) !== normalized.rawSha256) return { ...proofSkeleton(sourceRef, 'source-raw-fingerprint-mismatch') }
    if (suppliedNormalized != null && hex(suppliedNormalized) !== normalized.normalizedSha256) return { ...proofSkeleton(sourceRef, 'source-normalized-fingerprint-mismatch') }
    if (suppliedDocumentNormalized != null && hex(suppliedDocumentNormalized) !== documentNormalizedSha256) return { ...proofSkeleton(sourceRef, 'source-document-fingerprint-mismatch') }
  }
  const lineCount = normalized.lineCount
  const quoteLine = options.quoteLine ?? 1
  if (!Number.isSafeInteger(quoteLine) || quoteLine < 1 || quoteLine > Math.max(1, lineCount)) return { ...proofSkeleton(sourceRef, 'source-line-invalid') }
  return {
    schemaVersion: HANDOFF_SOURCE_PROOF_SCHEMA,
    algorithm: HANDOFF_NORMALIZATION_ALGORITHM,
    documentNormalizationAlgorithm: 'r4-ledger-doc-v1/normalizeText',
    ok: true,
    verified: true,
    code: 'source-proof-verified',
    sourceRef,
    rel: sourceRef,
    rawSha256: normalized.rawSha256,
    sha256: normalized.rawSha256,
    normalizedSha256: normalized.normalizedSha256,
    documentNormalizedSha256,
    bytes: normalized.rawBytes,
    startLine: 1,
    endLine: lineCount,
    quoteLine,
    lineRange: { start: 1, end: lineCount },
    pointerRead: {
      ok: true,
      sourceRef: pointer.sourceRef,
      rawSha256: pointer.rawSha256,
      normalizedSha256: pointer.normalizedSha256,
      bytes: pointer.bytes,
      physicalPath: pointer.physicalPath,
      rawEqual: pointer.rawEqual === true,
      normalizedEqual: pointer.normalizedEqual === true,
    },
    physicalPath: pointer.physicalPath,
    eligibleForPhysicalDelete: false,
    eventClaimed: false,
    writesPerformed: false,
  }
}

function compareQuad(source, checkpoint) {
  const comparison = {}
  const differences = []
  const emptyVsExplicitNone = []
  for (const key of QUAD_FIELDS) {
    const checkpointEmptyList = Array.isArray(checkpoint[key]) && checkpoint[key].length === 0
    const checkpointPresent = (hasOwn(checkpoint, key) && checkpoint[key] != null && typeof checkpoint[key] !== 'object') || checkpointEmptyList
    const checkpointValue = checkpointEmptyList ? '' : checkpointPresent ? String(checkpoint[key]) : ''
    const sourceValue = source.quad[key]
    const sourcePresent = source.quadPresence[key]
    const normalizedSource = source.normalizedQuad[key]
    const normalizedCheckpoint = checkpointPresent ? normalizeHandoffContentPre(checkpointValue).normalizedContent : ''
    const equal = sourcePresent && checkpointPresent && normalizedSource === normalizedCheckpoint
    const sourceEmpty = normalizedSource === ''
    const checkpointEmpty = normalizedCheckpoint === ''
    const sourceExplicitNone = source.completeness.explicitNoneFields.includes(key)
    const checkpointExplicitNone = /^(?:无已确认失败|暂无已确认失败)[。！!]?$/.test(checkpointValue.trim())
    const reasons = []
    if (!sourcePresent) reasons.push('source-region-missing')
    if (!checkpointPresent) reasons.push('checkpoint-region-missing')
    if (sourcePresent && checkpointPresent && !equal) reasons.push('value-diff')
    if ((sourceEmpty && checkpointExplicitNone) || (checkpointEmpty && sourceExplicitNone)) {
      reasons.push('empty-vs-explicit-none')
      emptyVsExplicitNone.push({ regionId: key, sourceEmpty, checkpointEmpty, sourceExplicitNone, checkpointExplicitNone })
    }
    // Empty string is the current storage protocol's no-failure representation.
    // It is equal only to another present empty value; explicit-none is not folded into it.
    comparison[key] = {
      equal, sourcePresent, checkpointPresent, sourceEmpty, checkpointEmpty, sourceExplicitNone, checkpointExplicitNone,
      sourceSha256: sha256(Buffer.from(normalizedSource, 'utf8')),
      checkpointSha256: sha256(Buffer.from(normalizedCheckpoint, 'utf8')),
      reasonCodes: reasons,
    }
    if (reasons.length) differences.push({ regionId: key, reasonCodes: reasons, sourceSha256: comparison[key].sourceSha256, checkpointSha256: comparison[key].checkpointSha256 })
  }
  return { comparison, differences, emptyVsExplicitNone }
}

function compareRegions(source, checkpoint) {
  const missingRegions = []
  const extraRegions = []
  const regionDiffs = []
  const keys = new Set([...Object.keys(source.regionDigests), ...Object.keys(checkpoint.regionDigests)])
  for (const key of keys) {
    const sourceHash = source.regionDigests[key] ?? null
    const checkpointHash = checkpoint.regionDigests[key] ?? null
    if (sourceHash && !checkpointHash) missingRegions.push(key)
    else if (!sourceHash && checkpointHash) extraRegions.push(key)
    else if (sourceHash !== checkpointHash) regionDiffs.push({ regionId: key, sourceSha256: sourceHash, checkpointSha256: checkpointHash })
  }
  return { missingRegions, extraRegions, regionDiffs }
}

function checkpointIdentity(input, checkpoint, event) {
  const eventId = input.eventId ?? event?.id ?? checkpoint.eventId ?? null
  const checkpointId = checkpoint.checkpointId ?? null
  const legacyCheckpointKey = checkpoint.legacyCheckpointKey ?? null
  const checkpointIndex = checkpoint.checkpointIndex ?? input.checkpointIndex ?? (Array.isArray(event?.checkpoints) && event.checkpoints.includes(checkpoint) ? event.checkpoints.indexOf(checkpoint) : null)
  const member = Array.isArray(event?.checkpoints) && event.checkpoints.some((item) => item === checkpoint || (item?.checkpointId && item.checkpointId === checkpoint.checkpointId) || (item?.legacyCheckpointKey && item.legacyCheckpointKey === checkpoint.legacyCheckpointKey))
  const storedCheckpointId = member && checkpointId === event.checkpoints[event.checkpoints.indexOf(checkpoint)]?.checkpointId
  const persistedIdentity = storedCheckpointId && CHECKPOINT_ID.test(String(checkpointId || ''))
  const legacyDerived = member && typeof legacyCheckpointKey === 'string' && FULL_SHA256.test(legacyCheckpointKey) && Number.isSafeInteger(checkpointIndex) && checkpointIndex >= 0
    ? legacyCheckpointKey === computeLegacyCheckpointKey({
      eventId,
      checkpointIndex,
      at: checkpoint.at ?? null,
      kind: checkpoint.kind ?? null,
      text: checkpoint.text ?? null,
      sourceRef: checkpoint.sourceRef ?? null,
      idemKey: checkpoint.idemKey ?? null,
      quad: Object.fromEntries(QUAD_FIELDS.map((key) => [key, checkpoint[key] ?? null])),
    })
    : false
  const identityMode = persistedIdentity
    ? 'persisted'
    : legacyDerived
      ? 'legacy-derived'
      : null
  return { eventId, checkpointId: CHECKPOINT_ID.test(String(checkpointId || '')) ? checkpointId : null, legacyCheckpointKey: identityMode === 'legacy-derived' ? legacyCheckpointKey : null, checkpointIndex, identityMode }
}

function checkpointTextFingerprint(checkpoint) {
  if (typeof checkpoint.text !== 'string' || checkpoint.text === '') return { present: false }
  const rawSha256 = checkpoint.rawSha256 ?? checkpoint.rawsha256 ?? checkpoint.sha256
  const normalizedSha256 = checkpoint.normalizedSha256 ?? checkpoint.normalizedsha256
  return {
    present: true,
    rawSha256: hex(rawSha256),
    documentNormalizedSha256: hex(normalizedSha256),
    rawFieldPresent: rawSha256 != null,
    normalizedFieldPresent: normalizedSha256 != null,
    rawValid: hex(rawSha256) === sha256(Buffer.from(checkpoint.text, 'utf8')),
    documentNormalizedValid: hex(normalizedSha256) === sha256(normalizeText(checkpoint.text)),
  }
}

function proofMatchesProof(left, right) {
  if (!left) return { present: false, equal: false }
  const fields = ['sourceRef', 'rawSha256', 'normalizedSha256', 'documentNormalizedSha256', 'bytes', 'startLine', 'endLine']
  return { present: true, equal: fields.every((key) => left[key] === right[key]) }
}

/**
 * Assess exactly the supplied source and checkpoint. No event search, latest-active
 * fallback, apply/merge/archive, source mutation, or permission grant exists here.
 * Async because sourceRef verification must read the caller's explicit trusted root.
 */
export async function assessHandoffCoveragePre(input = {}, options = {}) {
  const objectInput = input && typeof input === 'object' && !Array.isArray(input) && !Buffer.isBuffer(input) && !(input instanceof Uint8Array) ? input : {}
  const checkpoint = objectInput.checkpoint ?? options.checkpoint ?? {}
  const event = objectInput.event ?? options.event ?? null
  const sourceProof = objectInput.sourceProof ?? options.sourceProof ?? null
  let source
  let checkpointParsed = null
  try {
    source = parseHandoffCoveragePre(sourceInput(input, options), { maxBytes: options.maxBytes })
    if (typeof checkpoint.text === 'string' && checkpoint.text) checkpointParsed = parseHandoffCoveragePre(checkpoint.text, { maxBytes: options.maxBytes })
  } catch (error) {
    return failure('ineligible', error.code || 'handoff-input-invalid', { error: String(error.message || error) })
  }
  const kind = checkpoint.kind ?? 'handoff'
  if (kind !== 'handoff') return failure('ineligible', 'checkpoint-kind-ineligible', { kind })
  if (!source.normalization.rawBytes) return failure('ineligible', 'source-empty')
  const writeIntent = objectInput.intent === 'write' || options.intent === 'write'
  const memberIndex = Array.isArray(event?.checkpoints) ? event.checkpoints.findIndex((item) => item === checkpoint || (item?.checkpointId && item.checkpointId === checkpoint.checkpointId) || (item?.legacyCheckpointKey && item.legacyCheckpointKey === checkpoint.legacyCheckpointKey)) : -1
  const eventVerified = memberIndex >= 0
  if (writeIntent && event?.status === 'closed') return failure('ineligible', 'event-target-closed', { eventId: event.id ?? null })
  const identity = checkpointIdentity(objectInput, checkpoint, event)
  const comparisonCheckpoint = { ...checkpoint, sourceRef: objectInput.sourceRef ?? options.sourceRef ?? checkpoint.sourceRef }
  const quad = compareQuad(source, comparisonCheckpoint)
  const content = {
    mode: checkpointParsed ? 'checkpoint-full-text' : 'current-pointer',
    fullTextEqual: false,
    normalizedTextSha256: checkpointParsed?.normalization.normalizedSha256 ?? null,
    sourceNormalizedSha256: source.normalization.normalizedSha256,
    missingRegions: [],
    extraRegions: [],
    regionDiffs: [],
    notesPreserved: false,
    anchorsPreserved: false,
    extraSectionsPreserved: false,
  }
  if (checkpointParsed) {
    Object.assign(content, compareRegions(source, checkpointParsed))
    content.fullTextEqual = source.normalization.normalizedSha256 === checkpointParsed.normalization.normalizedSha256
    const noteDigest = (note) => [note.kind, note.mode, note.heading, note.closed, note.text]
    content.notesPreserved = JSON.stringify(source.notes.map(noteDigest)) === JSON.stringify(checkpointParsed.notes.map(noteDigest))
    content.anchorsPreserved = JSON.stringify(source.anchors.map((item) => [item.kind, item.value, item.line])) === JSON.stringify(checkpointParsed.anchors.map((item) => [item.kind, item.value, item.line]))
    content.extraSectionsPreserved = source.extraSections.every((region) => !content.missingRegions.includes(region.id) && !content.regionDiffs.some((item) => item.regionId === region.id))
  }
  const textFingerprint = checkpointTextFingerprint(checkpoint)
  const reasons = new Set(source.completeness.reasonCodes)
  const mismatchReasons = new Set()
  const reviewReasons = new Set()
  const mismatch = (code) => { mismatchReasons.add(code); reasons.add(code) }
  const review = (code) => { reviewReasons.add(code); reasons.add(code) }
  const suppliedRef = objectInput.sourceRef ?? options.sourceRef ?? checkpoint.sourceRef
  const sourceRef = canonicalSourceRef(suppliedRef)
  if (suppliedRef != null && !sourceRef) return failure('ineligible', 'source-ref-invalid', { eventId: identity.eventId })
  if (!sourceRef) review('source-proof-required')
  if (!EVENT_ID.test(String(identity.eventId || ''))) review('event-id-required')
  if (!identity.identityMode) review('checkpoint-identity-required')
  if (!eventVerified) review('event-binding-unverified')
  if (writeIntent && (!event || !['active', 'paused'].includes(event.status))) review('event-status-unverified')
  if (event?.id && identity.eventId && event.id !== identity.eventId) review('event-id-mismatch')
  if (checkpoint.eventId && identity.eventId && checkpoint.eventId !== identity.eventId) review('event-id-mismatch')
  if (source.declaredEventIds.length === 1 && identity.eventId && source.declaredEventIds[0] !== identity.eventId) review('declared-event-id-mismatch')
  if (source.invalidDeclaredEventIdLines) review('invalid-declared-event-id')
  if (source.declaredEventIds.length > 1) review('multiple-declared-events-require-separate-evidence')
  if (source.unknownFields.length) review('unknown-input-fields-not-provable')
  for (const field of QUAD_FIELDS) {
    const item = quad.comparison[field]
    if (item.reasonCodes.includes('value-diff') || item.reasonCodes.includes('empty-vs-explicit-none')) mismatch('quad-value-mismatch:' + field)
    if (!source.quadPresence[field] || (field !== 'dead' && item.sourceEmpty)) review('source-quad-incomplete:' + field)
    if (!item.checkpointPresent) review('checkpoint-quad-missing:' + field)
    if (field !== 'dead' && item.checkpointPresent && item.checkpointEmpty) review('checkpoint-quad-empty:' + field)
  }
  if (source.duplicateQuadRegions.length) review('duplicate-quad-region')
  if (checkpointParsed) {
    if (!content.fullTextEqual) mismatch('normalized-content-mismatch')
    if (content.missingRegions.length) mismatch('source-region-not-covered')
    if (content.regionDiffs.length) mismatch('region-content-mismatch')
    if (!content.notesPreserved) mismatch('notes-not-preserved')
    if (!content.anchorsPreserved) mismatch('anchors-not-preserved')
    if (!textFingerprint.rawFieldPresent || !textFingerprint.normalizedFieldPresent) review('checkpoint-full-fingerprint-required')
    if (textFingerprint.rawFieldPresent && !textFingerprint.rawSha256) mismatch('checkpoint-raw-fingerprint-invalid')
    if (textFingerprint.normalizedFieldPresent && !textFingerprint.documentNormalizedSha256) mismatch('checkpoint-normalized-fingerprint-invalid')
    if (textFingerprint.rawSha256 && !textFingerprint.rawValid) review('checkpoint-raw-fingerprint-mismatch')
    if (textFingerprint.documentNormalizedSha256 && !textFingerprint.documentNormalizedValid) review('checkpoint-normalized-fingerprint-mismatch')
  } else if (typeof checkpoint.text === 'string' && checkpoint.text) review('checkpoint-text-unreadable')
  else review('checkpoint-full-text-not-present')
  let proof = null
  if (sourceRef) {
    const requestedProof = await buildHandoffSourceProofPre({ documentText: sourceInput(input, options), expectDiskText: true, sourceRef }, options)
    if (!requestedProof.ok) {
      if (['pointer-drift', 'pointer-line-ending-changed', 'source-proof-fingerprint-mismatch', 'source-text-mismatch', 'source-raw-fingerprint-mismatch', 'source-normalized-fingerprint-mismatch', 'source-document-fingerprint-mismatch'].includes(requestedProof.code)) {
        proof = requestedProof
        mismatch('source-proof-content-mismatch')
      } else return failure('ineligible', requestedProof.code || 'source-proof-unverified', { sourceRef, sourceProof: requestedProof, eventId: identity.eventId })
    } else proof = requestedProof
    const suppliedProof = proofMatchesProof(sourceProof, proof)
    if (suppliedProof.present && !suppliedProof.equal) mismatch('source-proof-stale-or-mismatched')
    if (proof.rawSha256 !== source.normalization.rawSha256 || proof.normalizedSha256 !== source.normalization.normalizedSha256) mismatch('source-proof-content-mismatch')
    if (textFingerprint.rawSha256 && textFingerprint.rawSha256 !== proof.rawSha256) mismatch('raw-sha256-mismatch')
    if (textFingerprint.documentNormalizedSha256 && textFingerprint.documentNormalizedSha256 !== proof.documentNormalizedSha256) mismatch('document-normalized-sha256-mismatch')
    if (!checkpointParsed) {
      content.fullTextEqual = proof.normalizedSha256 === source.normalization.normalizedSha256
      content.notesPreserved = true
      content.anchorsPreserved = true
      content.extraSectionsPreserved = true
    }
  }
  const identityPass = EVENT_ID.test(String(identity.eventId || '')) && !!identity.identityMode && eventVerified && !reviewReasons.has('event-id-mismatch') && !reviewReasons.has('declared-event-id-mismatch') && source.invalidDeclaredEventIdLines === 0 && source.declaredEventIds.every((id) => id === identity.eventId)
  const quadPass = QUAD_FIELDS.every((key) => quad.comparison[key].equal) && !quad.emptyVsExplicitNone.length && source.completeness.complete
  const contentPass = content.fullTextEqual && !content.missingRegions.length && !content.extraRegions.length && !content.regionDiffs.length && content.notesPreserved && content.anchorsPreserved && content.extraSectionsPreserved
  const fingerprintPass = !!proof && proof.ok === true && proof.verified === true && (!checkpointParsed || (textFingerprint.rawSha256 === proof.rawSha256 && textFingerprint.documentNormalizedSha256 === proof.documentNormalizedSha256))
  const sourceProofPass = !!proof && fingerprintPass && !source.unknownFields.length
  const gates = { identity: identityPass, content: contentPass, quad: quadPass, binding: identityPass, sourceProof: sourceProofPass }
  let status
  if (mismatchReasons.size || reviewReasons.has('event-id-mismatch') || reviewReasons.has('declared-event-id-mismatch')) status = 'mismatched'
  else if (Object.values(gates).every(Boolean) && reviewReasons.size === 0) status = 'covered'
  else if (source.completeness.complete && (content.fullTextEqual || QUAD_FIELDS.some((key) => quad.comparison[key].equal && !quad.comparison[key].sourceEmpty))) status = 'partial'
  else status = 'needs-review'
  const reasonCodes = [...reasons].sort()
  return {
    schemaVersion: HANDOFF_COVERAGE_SCHEMA,
    auditRulesVersion: HANDOFF_NORMALIZATION_ALGORITHM,
    ok: status === 'covered',
    status,
    disposition: status,
    code: status,
    reasonCodes,
    review: { required: status !== 'covered', reasonCodes },
    gates,
    identity: { pass: identityPass, ...identity, declaredIdsCovered: source.declaredEventIds.every((id) => id === identity.eventId) },
    event: { id: identity.eventId, status: event?.status ?? null, bindingVerified: eventVerified, writableTarget: writeIntent && eventVerified && !!event && ['active', 'paused'].includes(event.status), claim: 'not-performed' },
    content,
    quad,
    source: {
      bytes: source.normalization.rawBytes,
      rawSha256: source.normalization.rawSha256,
      normalizedBytes: source.normalization.normalizedBytes,
      normalizedSha256: source.normalization.normalizedSha256,
      lineCount: source.normalization.lineCount,
      sectionNames: source.sectionNames,
      extraSectionNames: source.extraSectionNames,
      regionDigests: source.regionDigests,
      declaredEventIds: source.declaredEventIds,
      notes: source.notes.map(({ kind, mode, startLine, endLine, bytes, sha256 }) => ({ kind, mode, startLine, endLine, bytes, sha256 })),
      anchors: source.anchors,
      unknownFields: source.unknownFields,
      completeness: source.completeness,
    },
    sourceProof: proof,
    historicalContentCovered: status === 'covered' && !!checkpointParsed && textFingerprint.rawSha256 === proof?.rawSha256,
    currentContentCovered: contentPass && sourceProofPass,
    scope: 'content-coverage-only',
    eventClaimed: false,
    writesPerformed: false,
    eligibleForPhysicalDelete: false,
    eligibleForArchive: false,
    eligibleForMerge: false,
  }
}
