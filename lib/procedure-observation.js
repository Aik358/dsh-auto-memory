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
  // ★ 内容寻址（2026-09-26 B1-1 修复）：id 只由**内容指纹**决定。
  //
  // 旧实现在哈希里掺了 now 与 sequence:
  //   ['procedure-v2', fingerprint, now, sequence]
  // ⇒ **同内容在两台机器/两个时刻得到不同 id** ⇒ 同步后变重复条目。
  // 这是身份级缺陷：不修则团队库里的同名技能会不断增殖。
  //
  // 修法：去掉时间与序号，只用 procedureFingerprintPre（纯内容字段：
  //   title / origin / riskLevel / observationOnly / steps / preconditions /
  //   checks / successCriteria / rollback）。跨机一致：同内容 ⇒ 同 id。
  //
  // 退化情形：若内容寻址 id 已被占用，用**确定性递增序号**消歧 ——
  // 仍不含时间戳，故同输入必得同输出（幂等）。
  // 前缀必须与 procedure-store.js 的 PROCEDURE_ID_PREFIX 一致 ——
  // 发布线会由 tools/release.mjs 反向转换，故此处字面量按 pre 线写。
  const used = new Set(rows.map(p => p.procedureId))
  const fingerprint = procedureFingerprintPre(candidate)
  for (let sequence = 0; sequence <= rows.length + 1; sequence++) {
    const seed = sequence === 0
      ? ['procedure-v3', fingerprint]
      : ['procedure-v3', fingerprint, sequence]
    const digest = createHash('sha256').update(JSON.stringify(seed)).digest('hex')
    const id = idPrefix + digest.slice(0, 32)
    if (!used.has(id)) return id
  }
  throw new Error('procedure-id-exhausted')
}
