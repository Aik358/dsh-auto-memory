import { createHash } from 'node:crypto'

/** Episode-only rows cannot earn memory-ID evidence. Do not fabricate provenance or gates. */
export function isObservationOnlyPre(p) {
  if (!p || typeof p !== 'object') return false
  if (p.observationOnly === true) return true
  // Already validated/active, user-authored and deprecated history keeps its existing semantics.
  if (p.origin === 'user' || (p.stage && !['observed', 'candidate'].includes(p.stage))) return false
  return Array.isArray(p.sourceEpisodes) && p.sourceEpisodes.length > 0 &&
    (!p.sourceMemoryIds || p.sourceMemoryIds.length === 0) &&
    (!p.successCriteria || p.successCriteria.length === 0)
}

/** Additive metadata migration only; no change to identity, text, risk, evidence or stage. */
export function normalizeProcedureObservationPre(p) {
  if (!p || p.pinned || p.observationOnly !== undefined || !isObservationOnlyPre(p)) return p
  return { ...p, observationOnly: true }
}

/** A title is not an identity. Rich and observation-only candidates must not contaminate each other. */
export function procedureFingerprintPre(p) {
  return JSON.stringify([p.title, p.origin === 'user' ? 'user' : 'agent', p.riskLevel || 'low',
    isObservationOnlyPre(p), p.steps || [], p.preconditions || [], p.checks || [],
    p.successCriteria || [], p.rollback || []])
}

export function matchingProcedurePre(rows, candidate) {
  const fingerprint = procedureFingerprintPre(candidate)
  return rows.find(p => p.stage !== 'deprecated' && procedureFingerprintPre(p) === fingerprint)
}

export function mergeProcedureSourcesPre(existing, candidate) {
  // These are the only mergeable fields. In particular, never inherit a lower risk or approval.
  existing.sourceMemoryIds = [...new Set([...(existing.sourceMemoryIds || []), ...(candidate.sourceMemoryIds || [])])]
  existing.sourceEpisodes = [...new Set([...(existing.sourceEpisodes || []), ...(candidate.sourceEpisodes || [])])]
}

export function newProcedureIdentityPre(candidate, now, rows, idPrefix = 'proc_pre_') {
  const used = new Set(rows.map(p => p.procedureId))
  for (let sequence = 0; sequence <= rows.length; sequence++) {
    // 前缀必须与 procedure-store-pre.js 的 PROCEDURE_ID_PREFIX(`proc_pre_`)一致 ——
    // 发布线为 `proc_`,由 tools/release.mjs 反向转换,故此处字面量按 pre 线写。
    const digest = createHash('sha256').update(JSON.stringify(['procedure-v2', procedureFingerprintPre(candidate), now, sequence])).digest('hex')
    const id = idPrefix + digest.slice(0, 32)
    if (!used.has(id)) return id
  }
  throw new Error('procedure-id-exhausted')
}
