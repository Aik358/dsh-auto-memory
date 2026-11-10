import { createHash } from 'node:crypto'

export const PROTOCOL_VERSION = 'r4-ledger-doc-v1'
export const DOCUMENT_MARKER = '<!-- r4-ledger-doc-v1 -->'
export const DOCUMENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}-[0-9]{6}-[0-9]{4}$/
export const EVENT_ID_RE = /^evt_[0-9a-f]{8}$/
export const OP_ID_RE = /^r4op_[0-9a-f]{32}$/
export const CHECKPOINT_ID_RE = /^ckpt_[0-9a-f]{16}$/
export const REVISION_RE = /^sha256:[0-9a-f]{64}$/
const LF = String.fromCharCode(10)

export function validateDocumentId(id) {
  return typeof id === 'string' && DOCUMENT_ID_RE.test(id)
    ? { ok: true, value: id }
    : { ok: false, error: 'document-id-invalid' }
}

export function validateEventIds(ids) {
  if (ids == null || (Array.isArray(ids) && ids.length === 0)) return { ok: false, error: 'event-ids-required' }
  if (!Array.isArray(ids)) return { ok: false, error: 'event-id-unavailable' }
  const value = [...new Set(ids.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean))].sort()
  if (!value.length) return { ok: false, error: 'event-ids-required' }
  return value.every((id) => EVENT_ID_RE.test(id))
    ? { ok: true, value }
    : { ok: false, error: 'event-id-unavailable' }
}

export function validateOpId(opId) {
  return typeof opId === 'string' && OP_ID_RE.test(opId)
    ? { ok: true, value: opId }
    : { ok: false, error: 'op-id-invalid' }
}

export function validateCheckpointId(id) {
  return typeof id === 'string' && CHECKPOINT_ID_RE.test(id)
    ? { ok: true, value: id }
    : { ok: false, error: 'checkpoint-id-invalid' }
}

export function validateRevision(revision) {
  return typeof revision === 'string' && REVISION_RE.test(revision)
    ? { ok: true, value: revision }
    : { ok: false, error: 'revision-invalid' }
}

export function validateChangeSet(changeSet) {
  if (!Array.isArray(changeSet)) return { ok: false, error: 'changeset-invalid' }
  const regions = new Set()
  for (const change of changeSet) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) return { ok: false, error: 'changeset-invalid' }
    if (typeof change.regionId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/i.test(change.regionId)) return { ok: false, error: 'changeset-invalid' }
    if (regions.has(change.regionId) || typeof change.beforeText !== 'string' || typeof change.afterText !== 'string') return { ok: false, error: 'changeset-invalid' }
    regions.add(change.regionId)
  }
  return { ok: true, value: changeSet.map(({ regionId, beforeText, afterText }) => ({ regionId, beforeText, afterText })) }
}

export function normalizeText(text) {
  if (typeof text !== 'string') throw new TypeError('text-must-be-string')
  const withoutBom = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const lines = withoutBom.split(String.fromCharCode(13) + LF).join(LF).split(String.fromCharCode(13)).join(LF).split(LF)
  return lines.map((line) => line.replace(/[ \t]+$/g, '')).join(LF)
}

export function canonicalize(value) {
  const ancestors = new Set()
  function encode(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item)
    if (typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (typeof item !== 'object') throw new TypeError('canonical-value-must-be-json')
    if (ancestors.has(item)) throw new TypeError('canonical-value-cyclic')
    ancestors.add(item)
    let result
    if (Array.isArray(item)) {
      result = '[' + item.map(encode).join(',') + ']'
    } else {
      const prototype = Object.getPrototypeOf(item)
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('canonical-value-must-be-plain-object')
      result = '{' + Object.keys(item).sort().map((key) => JSON.stringify(key) + ':' + encode(item[key])).join(',') + '}'
    }
    ancestors.delete(item)
    return result
  }
  return encode(value)
}

function sha256(text) {
  return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex')
}

export function computeRevision(docText) {
  const normalized = normalizeText(docText)
  const lines = normalized.split(LF)
  if (lines[6]?.startsWith('revision:')) lines[6] = 'revision:'
  return sha256(lines.join(LF))
}

export function computeOperationDigest(payload) {
  return sha256(canonicalize(payload))
}

export function computeLegacyCheckpointKey(cp) {
  const source = cp && typeof cp === 'object' ? cp : {}
  return sha256(canonicalize({
    eventId: source.eventId ?? null,
    checkpointIndex: source.checkpointIndex ?? null,
    at: source.at ?? null,
    kind: source.kind ?? null,
    text: source.text ?? null,
    sourceRef: source.sourceRef ?? null,
    idemKey: source.idemKey ?? null,
    quad: source.quad ?? null,
  }))
}
