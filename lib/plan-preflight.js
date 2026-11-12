import { planCardsPre, planRevisionPre } from './plan-store.js'
import { checkPlanCriteriaPre, criteriaRefusalTextPre, extractProtectedRegionsPre, parseWhiteboardPre } from './wb-contract.js'
import { validateMutationBoundaryPre, mutationRefusalTextPre } from './memory-mutation.js'

export const PLAN_PREFLIGHT_VERSION = 'batch2-2.8-preflight-v1'
const USER_REGION_RE = /<!--\s*user\s*-->[\s\S]*?<!--\s*\/user\s*-->/g

function failure(message, code, extra = {}) {
  return { ok: false, error: message, code, finalCheckRequired: true, ...extra }
}

// Pure equivalents of preparePlanPre rejection branches. No conflict file.
export function preflightPlanCasPre({ existing = '', incoming = '', createOnly = false, expectedRevision, cardId, expectedCardRevision } = {}) {
  existing = String(existing == null ? '' : existing)
  incoming = String(incoming == null ? '' : incoming)
  if (createOnly && existing) return { ok: true, skipped: 'exists', text: existing, finalCheckRequired: true }
  if (cardId) {
    const cards = planCardsPre(existing)
    const card = cards.find((item) => item.id === cardId)
    const duplicateCount = cards.filter((item) => item.id === cardId).length
    if (duplicateCount > 1) return failure(
      'plan-card-duplicate-id: ' + duplicateCount + ' cards share id ' + String(cardId)
        + '; repair the plan file so every card id is unique before editing a single card',
      'PLAN_CARD_DUPLICATE_ID', { duplicateId: String(cardId), duplicateCount },
    )
    if (!card || card.revision !== expectedCardRevision) return failure(
      'plan-card-conflict: read the current card and retry with its revision',
      'PLAN_CARD_CONFLICT', { conflictRecorded: false },
    )
    if (card.end < existing.length && !incoming.endsWith('\n')) return failure('plan-card-format: retain the final line ending before the next card', 'PLAN_CARD_FORMAT')
    const replacement = planCardsPre(incoming)
    if (replacement.length !== 1 || replacement[0].id !== card.id || replacement[0].start !== 0) {
      return failure('plan-card-format: supply one complete heading/card retaining its anchor', 'PLAN_CARD_FORMAT')
    }
    for (const match of card.text.matchAll(USER_REGION_RE)) {
      if (!incoming.includes(match[0])) return failure('plan-user-region-protected', 'PLAN_USER_REGION_PROTECTED')
    }
    return { ok: true, text: existing.slice(0, card.start) + incoming + existing.slice(card.end), finalCheckRequired: true }
  }
  if ((existing || expectedRevision !== undefined) && expectedRevision !== planRevisionPre(existing)) {
    return failure('plan-version-conflict: memory_read(kind=plan) before rewriting; retain both candidates', 'PLAN_VERSION_CONFLICT', { conflictRecorded: false })
  }
  return { ok: true, text: incoming, finalCheckRequired: true }
}

// Exact whole-text protected-user multiplicity check from writePlanSnapshot.
export function preflightPlanUserRegionsPre(existing, incoming) {
  existing = String(existing == null ? '' : existing)
  incoming = String(incoming == null ? '' : incoming)
  const protectedUsers = new Set([...existing.matchAll(USER_REGION_RE)].map((match) => match[0]))
  for (const user of protectedUsers) {
    if (incoming.split(user).length < existing.split(user).length) return failure('plan-user-region-protected', 'PLAN_USER_REGION_PROTECTED')
  }
  return { ok: true, finalCheckRequired: true }
}

// Same planCardsPre identity universe as the final duplicate guard.
export function preflightPlanDuplicateIdsPre(text) {
  const seen = new Map()
  for (const card of planCardsPre(String(text == null ? '' : text))) {
    if (card.id) seen.set(card.id, (seen.get(card.id) || 0) + 1)
  }
  for (const [duplicateId, duplicateCount] of seen) {
    if (duplicateCount > 1) return failure(
      'plan-card-duplicate-id: ' + duplicateCount + ' cards share id ' + duplicateId + '; refuse to persist a plan with duplicate card identities',
      'PLAN_CARD_DUPLICATE_ID', { duplicateId, duplicateCount },
    )
  }
  return { ok: true, finalCheckRequired: true }
}

function missingCardsExcerpt(beforeText, report) {
  const missing = []
  for (const hard of Array.isArray(report && report.hard) ? report.hard : []) {
    if (hard && hard.pass === false && Array.isArray(hard.missing)) for (const id of hard.missing) if (typeof id === 'string' && id) missing.push(id)
  }
  if (!missing.length) return ''
  const lines = String(beforeText).split(/\r?\n/)
  const starts = []
  for (let i = 0; i < lines.length; i++) if (/^#{3,}\s+\S/.test(lines[i].replace(/\r$/, ''))) starts.push(i)
  const parts = []
  let total = 0
  for (const id of missing) {
    const index = starts.findIndex((line, position) => {
      const end = position + 1 < starts.length ? starts[position + 1] : lines.length
      for (let i = line; i < end; i++) if (lines[i].includes(id)) return true
      return false
    })
    if (index < 0) continue
    const text = lines.slice(starts[index], index + 1 < starts.length ? starts[index + 1] : lines.length).join('\n').replace(/\s+$/, '').slice(0, 1200)
    if (total + text.length > 6000) break
    parts.push(text)
    total += text.length
  }
  return parts.length ? '\n\n为便于一轮补齐，以下是消失卡片的原文块（请原样带回，含其用户备注区）：\n\n' + parts.join('\n\n') : ''
}

// Default checkMutationPre semantics, with no engine, config or disk state.
export function checkPlanMutationPre(input = {}) {
  const options = input && typeof input === 'object' ? input : {}
  const afterText = String(options.afterText == null ? '' : options.afterText)
  const beforeText = String(options.beforeText == null ? '' : options.beforeText)
  try {
    if (options.skipCriteria !== true) {
      const criteria = checkPlanCriteriaPre(afterText)
      if (!criteria.ok) return { ok: false, gate: 'criteria', error: criteriaRefusalTextPre(criteria), report: criteria, criteria }
    }
    if (!beforeText.trim()) return { ok: true }
    const before = parseWhiteboardPre(beforeText, { kind: 'plan' })
    const after = parseWhiteboardPre(afterText, { kind: 'plan' })
    const beforeIds = before.cardIds
    if (!beforeIds.length && !extractProtectedRegionsPre(before).length) return { ok: true }
    const result = validateMutationBoundaryPre({
      target: 'plan', beforeIds, afterIds: after.cardIds,
      protectedRegions: extractProtectedRegionsPre(before),
      afterProtectedRegions: extractProtectedRegionsPre(after),
      archivedIds: Array.isArray(options.archivedIds) ? options.archivedIds : [],
      strict: true,
    })
    let warning = ''
    if (!result.ok && result.hard.every((hard) => hard.pass || hard.id === 'M1')) {
      const unarchived = Array.isArray(result.report && result.report.unarchived) ? result.report.unarchived : []
      warning = '⚠ 【白板丢卡警示 · 已照写】本次重写丢了 ' + unarchived.length + ' 张卡片且未显式归档：'
        + unarchived.slice(0, 8).join('、') + (unarchived.length > 8 ? ' 等' : '')
        + '。预检放行不代表可提交；正式写入仍须执行原 M1 警示与终检。'
      result.ok = true
      result.m1Downgraded = true
    }
    if (!result.ok) return { ok: false, gate: 'mutation', error: mutationRefusalTextPre(result) + missingCardsExcerpt(beforeText, result), report: result }
    return { ok: true, report: result, m1Downgraded: result.m1Downgraded === true, error: warning }
  } catch (cause) {
    return { ok: false, gate: 'mutation', error: '写入保护门内部错误：' + String(cause && cause.message || cause) + '（为避免静默丢卡，本次已拒绝写入；请重试或关闭该目标的重写）' }
  }
}

// Pure preflight: checkMutationPre receives exactly production option names.
// fromEvents supplies already-rendered incoming text plus its archivedIds.
// Urgent handoff writes do not enter this PLAN-only API.
export function preflightPlanMutationPre(input = {}) {
  const options = input && typeof input === 'object' ? input : {}
  const existing = String(options.beforeText ?? options.existing ?? '')
  const incoming = String(options.afterText ?? options.incoming ?? '')
  const checkMutationPre = options.checkMutationPre || checkPlanMutationPre
  if (typeof checkMutationPre !== 'function') return failure('check-mutation-invalid', 'CHECK_MUTATION_INVALID')
  const prepared = preflightPlanCasPre({
    existing, incoming,
    createOnly: options.createOnly === true,
    expectedRevision: options.expectedRevision,
    cardId: options.cardId,
    expectedCardRevision: options.expectedCardRevision,
  })
  if (!prepared.ok || prepared.skipped) return prepared
  const text = prepared.text
  const userRegions = preflightPlanUserRegionsPre(existing, text)
  if (!userRegions.ok) return userRegions
  const mutationInput = {
    target: 'plan', beforeText: existing, afterText: text,
    projectDir: options.projectDir,
    relPath: options.relPath || 'handoff/PLAN.md',
    skipCriteria: options.skipCriteria === true,
    archivedIds: Array.isArray(options.archivedIds) ? options.archivedIds : [],
  }
  const mutation = checkMutationPre(mutationInput)
  if (!mutation || typeof mutation.then === 'function') return failure('check-mutation-must-be-synchronous', 'CHECK_MUTATION_NOT_SYNC')
  if (!mutation.ok) return { ...mutation, finalCheckRequired: true }
  const duplicates = preflightPlanDuplicateIdsPre(text)
  if (!duplicates.ok) return duplicates
  return {
    ...mutation,
    ok: true,
    text,
    m1Downgraded: mutation.m1Downgraded === true,
    warn: mutation.m1Downgraded ? String(mutation.error || '') : '',
    finalCheckRequired: true,
    version: PLAN_PREFLIGHT_VERSION,
  }
}

// Urgent handoff is append-only: retain skipCriteria and not-applicable semantics.
// This helper does not write the ledger and is not a production call-site replacement.
export function preflightUrgentHandoffPre(input = {}) {
  const options = input && typeof input === 'object' ? input : {}
  const checkMutationPre = options.checkMutationPre || checkPlanMutationPre
  if (typeof checkMutationPre !== 'function') return failure('check-mutation-invalid', 'CHECK_MUTATION_INVALID')
  const mutationInput = {
    target: 'handoff',
    beforeText: '',
    afterText: String(options.afterText == null ? '' : options.afterText),
    skipCriteria: true,
    archivedIds: [],
  }
  const result = checkMutationPre(mutationInput)
  if (!result || typeof result.then === 'function') return failure('check-mutation-must-be-synchronous', 'CHECK_MUTATION_NOT_SYNC')
  if (!result.ok) return { ...result, finalCheckRequired: true }
  return {
    ...result,
    ok: true,
    gate: 'not-applicable',
    reason: 'ledger-append-only-no-before-side',
    finalCheckRequired: true,
  }
}
