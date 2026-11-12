import path from 'node:path'
import { readPointerPre } from './event-pointer.js'

const EVENT_ID = /^evt_[0-9a-f]{8}$/
const SHA256 = /^(?:sha256:)?[0-9a-f]{64}$/
const asText = (value) => String(value == null ? '' : value)
const fail = (code, error, extra = {}) => ({ ok: false, code, error, ...extra })

/** Select exactly one checkpoint in an already selected event. No global ID is invented. */
export function selectEventCheckpointPre(store, options = {}) {
  const eventId = asText(options.eventId).trim()
  if (!EVENT_ID.test(eventId)) return fail('event-id-invalid', 'eventId must be evt_ plus eight lowercase hex characters')
  const hasIndex = options.checkpointIndex !== undefined && options.checkpointIndex !== null
  const hasIdem = options.idemKey !== undefined && options.idemKey !== null
  if (hasIndex === hasIdem) return fail('checkpoint-selector-invalid', 'provide exactly one of checkpointIndex or idemKey')
  const event = (Array.isArray(store?.events) ? store.events : []).find((item) => item?.id === eventId)
  if (!event) return fail('event-not-found', 'event not found in this workspace', { eventId })
  const checkpoints = Array.isArray(event.checkpoints) ? event.checkpoints : []
  let checkpointIndex = -1
  if (hasIndex) {
    if (!Number.isSafeInteger(options.checkpointIndex) || options.checkpointIndex < 0 || options.checkpointIndex >= checkpoints.length) return fail('checkpoint-not-found', 'checkpointIndex must be a non-negative safe integer in range', { eventId })
    checkpointIndex = options.checkpointIndex
  } else {
    const idemKey = asText(options.idemKey)
    if (!idemKey) return fail('checkpoint-selector-invalid', 'idemKey must not be empty', { eventId })
    const matches = []
    checkpoints.forEach((checkpoint, index) => { if (checkpoint?.idemKey === idemKey) matches.push(index) })
    if (matches.length !== 1) return fail(matches.length ? 'checkpoint-idem-ambiguous' : 'checkpoint-not-found', matches.length ? 'idemKey is not unique inside the selected event' : 'idemKey not found in the selected event', { eventId, idemKey })
    checkpointIndex = matches[0]
  }
  return { ok: true, event, eventId, checkpointIndex, idemKey: checkpoints[checkpointIndex]?.idemKey || null, checkpoint: checkpoints[checkpointIndex] }
}

function fullFingerprint(value) {
  if (typeof value !== 'string' || !SHA256.test(value.trim())) return null
  const normalized = value.trim()
  return normalized.startsWith('sha256:') ? normalized.slice(7) : normalized
}

/** Read only the same trusted handoff root from which the event was selected. */
export async function readEventCheckpointPre({ store, eventId, checkpointIndex, idemKey, handoffDir } = {}) {
  const selected = selectEventCheckpointPre(store, { eventId, checkpointIndex, idemKey })
  if (!selected.ok) return selected
  if (typeof handoffDir !== 'string' || !path.isAbsolute(handoffDir)) return fail('pointer-unsafe', 'trusted handoff root must be absolute', selected)
  const checkpoint = selected.checkpoint || {}
  const selector = { eventId: selected.eventId, checkpointIndex: selected.checkpointIndex, idemKey: selected.idemKey, kind: checkpoint.kind || 'handoff', sourceRef: checkpoint.sourceRef || null }
  const checkpointText = asText(checkpoint.text)
  if (!checkpoint.sourceRef) return { ok: true, verified: false, code: 'legacy-checkpoint', ...selector, text: checkpointText, source: 'checkpoint' }
  const expectedRawSha256 = fullFingerprint(checkpoint.rawSha256 ?? checkpoint.rawsha256 ?? checkpoint.sha256)
  const expectedNormalizedSha256 = fullFingerprint(checkpoint.normalizedSha256 ?? checkpoint.normalizedsha256)
  if (!expectedRawSha256 || !expectedNormalizedSha256) return { ok: true, verified: false, code: 'pointer-unverified', ...selector, text: checkpointText, source: 'checkpoint', reason: 'full raw and normalized fingerprints are required; sha16 and the current file cannot prove historical identity' }
  const pointer = await readPointerPre({ handoffDir }, {
    sourceRef: checkpoint.sourceRef,
    expectedRawSha256,
    expectedNormalizedSha256,
    eventId: selected.eventId,
    kind: checkpoint.kind || 'handoff',
    readCheckpoints: async () => selected.event.checkpoints,
  })
  if (pointer.ok || pointer.code === 'pointer-line-ending-changed') return { ...pointer, ok: true, verified: true, code: pointer.code || 'pointer', ...selector, source: 'trusted-handoff', formatWarning: pointer.warning === true }
  return { ...pointer, verified: false, ...selector, text: checkpointText, source: 'checkpoint' }
}

/** Human-readable result; fallback text is always the selected old checkpoint, never a substituted current PLAN. */
export function formatEventCheckpointPre(result) {
  if (!result || typeof result !== 'object') return '[检查点展开] pointer-read-failed'
  if (!result.ok) return '[检查点展开] ' + asText(result.code || 'pointer-read-failed') + ': ' + asText(result.error || 'checkpoint selection failed')
  const lines = ['[检查点展开] eventId=' + result.eventId + ' checkpointIndex=' + result.checkpointIndex + ' idemKey=' + asText(result.idemKey || '(none)')]
  if (result.verified) {
    lines.push('真源: ' + result.sourceRef + '（受信 handoff 根；已校验完整 raw/normalized SHA-256）')
    lines.push('bytes=' + result.bytes + ' rawSha256=' + result.rawSha256 + ' normalizedSha256=' + result.normalizedSha256)
    if (result.formatWarning) lines.push('⚠ 格式变化：规范化内容相同，实际字节不同；这不是内容 drift。')
  } else {
    lines.push('兼容全文: ' + result.code + '；以下为所选检查点原文，未把当前文件冒充历史真源。')
    if (result.reason) lines.push('原因: ' + result.reason)
    if (result.sourceRef) lines.push('真源状态: ' + asText(result.code) + '；sourceRef=' + result.sourceRef)
    if (Array.isArray(result.recent) && result.recent.length) lines.push('同 kind 最近指针: ' + JSON.stringify(result.recent))
  }
  lines.push(asText(result.text))
  return lines.join('\n')
}
