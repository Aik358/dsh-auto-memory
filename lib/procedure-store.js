/**
 * M8-2 Procedural Store 纯核心(docs/proactive-associative-memory-system-map.html M-04 Procedural)。
 * 纯内存状态机,零 IO、零依赖(node:crypto 仅作确定性身份);持久化通过可注入 IO 接口,
 * Host 接线时才接真实文件(本模块自身不读写磁盘,测试用内存 IO)。
 *
 * ★ 这是「记忆中枢」的核心价值层:把多次使用的固定流程固化成 skill,
 *   让 M7 记忆召回系统在相似场景自动召回这些 skill,AI 按固定流程执行。
 *
 * 生命周期状态机(M-04 元代码逐行落地):
 *   observed → candidate → validated → active → deprecated
 *
 * 晋升规则(promote, 元代码原样):
 *   - sessionDiversity ≥ 3(跨独立会话)且 successCount ≥ 2 → 可晋升
 *   - correctionRate > MAX_CORRECTION 或 contradictions → 保持 candidate
 *   - 无 successCriteria 或 无 cross-session evidence → 保持 candidate
 *   - riskLevel=high 且未用户批准 → 返回 {action:'ask'} 等待批准
 *   - 一次成功或三次重复均不足以证明可靠(元代码铁律)
 *
 * 渐进激活(M6 六级 level):
 *   index → hint → excerpt → checklist → resource → full
 *   高风险工具(SSH/部署/删除)永不因相似度自动执行。
 *
 * 输出:active procedure 渲染成 checklist 注入包(M6 Reference Tail 的 checklist level),
 *       供 M7 召回系统在相似场景自动召回。
 *
 * 与 M5 evidence 衔接:promote 读 evidence stats(seen/read/cite/reuse/success/correction),
 *   由调用方传入(本模块不直接读 evidence store,保持纯核心)。
 *
 * 全部同输入确定; UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

// ========== 冻结常量 ==========

export const PROCEDURE_POLICY_VERSION = 'procedure_store_v1'
export const PROCEDURE_ID_PREFIX = 'proc_'
export const PROCEDURE_ID_RE = /^proc_[0-9a-f]{32}$/

/** 阶段枚举(M-04 元代码)。 */
export const PROCEDURE_STAGES_V1 = Object.freeze(['observed', 'candidate', 'validated', 'active', 'deprecated'])

/** 自动归档老化(Hermes curator 借鉴,2026-08-28):active 技能 lastUsedAt 超过
 *  PROCEDURE_ARCHIVE_AFTER_DAYS_V1 天未使用且未 pinned → 自动 deprecated
 *  (reason=auto-archive-inactive;deprecated 可恢复,永不物理删除)。
 *  observed/candidate/validated 不老化——它们由晋升门槛时间控。 */
export const PROCEDURE_ARCHIVE_AFTER_DAYS_V1 = 90

/** 风险等级枚举。 */
export const PROCEDURE_RISKS_V1 = Object.freeze(['low', 'medium', 'high'])

/** 激活等级(M6 六级契约)。 */
export const PROCEDURE_LEVELS_V1 = Object.freeze(['index', 'hint', 'excerpt', 'checklist', 'resource', 'full'])

/** 晋升门槛(可调参数,默认值来自 M-04 元代码): 跨会话多样性≥3, 成功≥2。 */
export const PROCEDURE_DEFAULT_GATES_V1 = Object.freeze({
  minSessionDiversity: 3,
  minSuccessCount: 2,
  maxCorrectionRate: 0.3,   // correction 占总证据比例上限
  maxContradictions: 0,     // 矛盾数上限(0=任何矛盾都阻止)
  highRiskRequiresApproval: true,
})

/** 一次成功或三次重复都不足以证明可靠 → 需要的最小成功数(元代码铁律)。 */
export const PROCEDURE_MIN_SUCCESS_V1 = 2

/** active 后可注入的默认 level(渐进激活;高风险降级为 hint)。 */
export const PROCEDURE_ACTIVE_LEVEL_V1 = 'checklist'

/** procedure 校验(固化/读回)。 */
export function validateProcedurePre(p) {
  const q = []
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'not-object' }
  if (typeof p.procedureId !== 'string' || !PROCEDURE_ID_RE.test(p.procedureId)) q.push('procedureId')
  if (!PROCEDURE_STAGES_V1.includes(p.stage)) q.push('stage')
  if (!PROCEDURE_RISKS_V1.includes(p.riskLevel)) q.push('riskLevel')
  if (typeof p.title !== 'string' || !p.title.trim()) q.push('title')
  if (!Array.isArray(p.sourceMemoryIds)) q.push('sourceMemoryIds')
  if (!Array.isArray(p.sourceEpisodes)) q.push('sourceEpisodes')
  if (!Array.isArray(p.steps) || !p.steps.length) q.push('steps')
  if (!Array.isArray(p.checks)) q.push('checks')
  if (!Array.isArray(p.successCriteria)) q.push('successCriteria')
  if (!Array.isArray(p.rollback)) q.push('rollback')
  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) q.push('createdAt')
  if (p.requiresApproval !== undefined && typeof p.requiresApproval !== 'boolean') q.push('requiresApproval')
  // 2026-08-28 Hermes 借鉴字段(可选,向后兼容旧快照):lastUsedAt/pinned/origin
  if (p.lastUsedAt !== undefined && (typeof p.lastUsedAt !== 'number' || !Number.isFinite(p.lastUsedAt))) q.push('lastUsedAt')
  if (p.pinned !== undefined && typeof p.pinned !== 'boolean') q.push('pinned')
  if (p.origin !== undefined && !['agent', 'user'].includes(p.origin)) q.push('origin')
  if (q.length) return { ok: false, reason: 'invalid:' + q.join(',') }
  return { ok: true, procedure: p }
}

/** ProcedureCandidate 校验(observe/candidate 输入)。 */
export function validateProcedureCandidatePre(c) {
  const p = []
  if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, reason: 'not-object' }
  if (typeof c.title !== 'string' || !c.title.trim()) p.push('title')
  if (!PROCEDURE_RISKS_V1.includes(c.riskLevel || 'low')) p.push('riskLevel')
  if (!Array.isArray(c.steps) || !c.steps.length) p.push('steps')
  if (c.successCriteria !== undefined && !Array.isArray(c.successCriteria)) p.push('successCriteria')
  if (c.sourceMemoryIds !== undefined && !Array.isArray(c.sourceMemoryIds)) p.push('sourceMemoryIds')
  if (c.sourceEpisodes !== undefined && !Array.isArray(c.sourceEpisodes)) p.push('sourceEpisodes')
  if (c.preconditions !== undefined && !Array.isArray(c.preconditions)) p.push('preconditions')
  if (c.checks !== undefined && !Array.isArray(c.checks)) p.push('checks')
  if (c.rollback !== undefined && !Array.isArray(c.rollback)) p.push('rollback')
  if (p.length) return { ok: false, reason: 'invalid:' + p.join(',') }
  return { ok: true, candidate: c }
}

/**
 * Procedural Store 工厂。
 * @param {object} opts
 * @param {object} opts.io      可选持久化 { save(snapshot), load() → snapshot, clear() }
 * @param {function} opts.now   可选时钟
 * @param {function} opts.approve 可选用户批准回调(high-risk 时调用;测试注入)
 * @param {object} opts.gates   { minSessionDiversity, minSuccessCount, maxCorrectionRate, maxContradictions, highRiskRequiresApproval }
 */
export function createProcedureStorePre(opts = {}) {
  const io = opts.io || { save() {}, load() { return null }, clear() {} }
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const approveFn = typeof opts.approve === 'function' ? opts.approve : null
  // 2026-08-30:gates 保留调用方对象引用(支持 getter 活读配置);缺省才用冻结默认。
  // 注意:不可 Object.assign 展开——会立即求值 getter 并冻结挂载时的配置快照。
  const gates = opts.gates || PROCEDURE_DEFAULT_GATES_V1
  const activeLevel = opts.activeLevel || PROCEDURE_ACTIVE_LEVEL_V1

  let procedures = []      // 全部 procedure(各 stage)
  let disposed = false
  const stats = { observed: 0, candidates: 0, validated: 0, activated: 0, deprecated: 0, approvalAsked: 0 }

  function defaultProcedureId(title, createdAt) {
    const h = createHash('sha256').update(['procedure-pre-v1', String(title), String(createdAt)].join('\u0000')).digest('hex')
    return PROCEDURE_ID_PREFIX + h.slice(0, 32)
  }

  // ---- 观察: 从 episode 或 judgement-shadow 的 procedure_candidate 进入 observed/candidate ----
  function observe(cand) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const v = validateProcedureCandidatePre(cand)
    if (!v.ok) return { ok: false, reason: v.reason }
    const c = v.candidate
    const now = nowFn()
    // 去重: 同 title 已存在 → 返回 existing(不重复 observe)
    const existing = procedures.find((p) => p.title === c.title && p.stage !== 'deprecated')
    if (existing) {
      // 合并证据源
      const seen = new Set(existing.sourceMemoryIds)
      for (const id of c.sourceMemoryIds || []) if (!seen.has(id)) existing.sourceMemoryIds.push(id)
      const seenEp = new Set(existing.sourceEpisodes)
      for (const id of c.sourceEpisodes || []) if (!seenEp.has(id)) existing.sourceEpisodes.push(id)
      void persist()
      return { ok: true, procedure: existing, merged: true }
    }
    const p = {
      procedureId: defaultProcedureId(c.title, now),
      title: c.title,
      stage: 'observed',
      riskLevel: c.riskLevel || 'low',
      requiresApproval: c.riskLevel === 'high' && gates.highRiskRequiresApproval,
      sourceMemoryIds: c.sourceMemoryIds || [],
      sourceEpisodes: c.sourceEpisodes || [],
      preconditions: c.preconditions || [],
      steps: c.steps,
      checks: c.checks || [],
      successCriteria: c.successCriteria || [],
      rollback: c.rollback || [],
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      pinned: false,
      origin: c.origin === 'user' ? 'user' : 'agent',
      evidence: { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, sessions: 0 },
      approved: c.riskLevel !== 'high',
    }
    const pv = validateProcedurePre(p)
    if (!pv.ok) return { ok: false, reason: 'procedure-invalid:' + pv.reason }
    procedures.push(pv.procedure)
    stats.observed++
    void persist()
    return { ok: true, procedure: pv.procedure, merged: false }
  }

  /**
   * 证据喂入(由调用方在 M5 evidence 落盘后调)。
   * @param {string} procedureId
   * @param {object} ev  { kind: 'seen'|'read'|'cite'|'reuse'|'success'|'correction', sessionRef? }
   */
  function addEvidence(procedureId, ev) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (!ev || typeof ev !== 'object' || !['seen', 'read', 'cite', 'reuse', 'success', 'correction'].includes(ev.kind)) {
      return { ok: false, reason: 'bad-evidence' }
    }
    if (p.evidence[ev.kind] !== undefined) p.evidence[ev.kind]++
    // session 去重
    if (ev.sessionRef) {
      if (!p._sessions) p._sessions = new Set()
      p._sessions.add(String(ev.sessionRef))
      p.evidence.sessions = p._sessions.size
    }
    p.updatedAt = nowFn()
    p.lastUsedAt = p.updatedAt // 任何真实证据都算活动(Hermes: last_activity_at 驱动老化)
    void persist()
    return { ok: true, evidence: { ...p.evidence } }
  }

  /** 活动触点(act.skill 命中注入/用户手动调用时):驱动自动归档老化的时钟。 */
  function touch(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    p.lastUsedAt = nowFn()
    void persist()
    return { ok: true, lastUsedAt: p.lastUsedAt }
  }

  /** 置顶/取消置顶(pinned 豁免自动归档与 agent 改写——Hermes curator 不变量)。 */
  function setPinned(procedureId, v) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    p.pinned = v === true
    p.updatedAt = nowFn()
    void persist()
    return { ok: true, pinned: p.pinned }
  }

  /** 确定性老化(Hermes apply_automatic_transitions 移植):active 且未 pinned 且
   *  lastUsedAt 超过 ARCHIVE_AFTER_DAYS → deprecated(auto-archive-inactive)。
   *  只归档不删除;返回变更计数。 */
  function applyAutomaticTransitions(nowTs) {
    const now = Number.isFinite(nowTs) ? nowTs : nowFn()
    const cutoff = now - PROCEDURE_ARCHIVE_AFTER_DAYS_V1 * 86400000
    const counts = { checked: 0, archived: 0 }
    for (const p of procedures) {
      counts.checked++
      if (p.stage !== 'active' || p.pinned) continue
      const last = Number.isFinite(p.lastUsedAt) ? p.lastUsedAt : (p.updatedAt || p.createdAt)
      if (last < cutoff) {
        p.stage = 'deprecated'
        p.deprecatedAt = now
        p.deprecateReason = 'auto-archive-inactive'
        stats.deprecated++
        counts.archived++
      }
    }
    if (counts.archived) void persist()
    return counts
  }

  /**
   * 晋升判定(M-04 元代码 promote 逐行)。
   * 返回 { decision: 'promote'|'keep'|'ask', procedure, reasonCodes }
   */
  function promote(procedureId, extraEvidence = {}) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (p.stage === 'deprecated') return { ok: true, decision: 'keep', reasonCodes: ['deprecated'] }

    const ev = p.evidence
    const reason = []
    // 跨会话多样性
    const diversity = extraEvidence.distinctSessions != null ? extraEvidence.distinctSessions : ev.sessions
    const successCount = extraEvidence.successCount != null ? extraEvidence.successCount : ev.success
    if (diversity < gates.minSessionDiversity) { reason.push('diversity-below-' + gates.minSessionDiversity); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
    if (successCount < gates.minSuccessCount) { reason.push('success-below-' + gates.minSuccessCount); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
    // correction 率
    const total = ev.seen + ev.read + ev.cite + ev.reuse + ev.success + ev.correction
    const corrRate = total > 0 ? ev.correction / total : 0
    if (corrRate > gates.maxCorrectionRate) { reason.push('correction-rate-' + corrRate.toFixed(2)); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
    // contradictions
    if (gates.maxContradictions === 0 && ev.correction > 0) { reason.push('has-correction'); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
    // successCriteria 必须有(元代码: 无 successCriteria → keepCandidate)
    if (!p.successCriteria.length) { reason.push('no-success-criteria'); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
    // 高风险需批准
    if (p.requiresApproval && !p.approved) {
      if (approveFn) {
        const apr = approveFn(p)
        if (apr && apr.approved) p.approved = true
        else { stats.approvalAsked++; reason.push('high-risk-awaiting-approval'); return { ok: true, decision: 'ask', procedure: p, reasonCodes: reason } }
      } else {
        stats.approvalAsked++
        reason.push('high-risk-awaiting-approval')
        return { ok: true, decision: 'ask', procedure: p, reasonCodes: reason }
      }
    }
    // 晋升
    p.stage = 'validated'
    p.updatedAt = nowFn()
    stats.validated++
    void persist()
    return { ok: true, decision: 'promote', procedure: p, reasonCodes: reason }
  }

  /** 激活: validated → active(可被召回)。 */
  function activate(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (p.stage !== 'validated') return { ok: false, reason: 'stage-' + p.stage }
    p.stage = 'active'
    p.activatedAt = nowFn()
    stats.activated++
    void persist()
    return { ok: true, procedure: p }
  }

  /** 降级/禁用: 任何 stage → deprecated(用户手动或 correction 爆表)。 */
  function deprecate(procedureId, reason = 'user-disabled') {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    p.stage = 'deprecated'
    p.deprecatedAt = nowFn()
    p.deprecateReason = String(reason)
    stats.deprecated++
    void persist()
    return { ok: true, procedure: p }
  }

  // ---- 查询 ----
  function query(q = {}) {
    if (disposed) return []
    return procedures
      .filter((p) =>
        (q.stage === undefined || p.stage === q.stage) &&
        (q.riskLevel === undefined || p.riskLevel === q.riskLevel) &&
        (q.title === undefined || p.title.includes(q.title)))
      .map((p) => ({ ...p, evidence: { ...p.evidence } }))
  }
  function activeProcedures() {
    return procedures.filter((p) => p.stage === 'active').map((p) => ({ ...p, evidence: { ...p.evidence } }))
  }
  function get(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    return p ? { ...p, evidence: { ...p.evidence } } : null
  }

  /**
   * ★ 渲染成可注入的 checklist(M6 六级 level 的 checklist 形态)。
   * 输出给 M7 召回系统:相似场景召回 active procedure → 注入 checklist 提示 AI 按固定流程走。
   * 高风险 → 降级为 hint(仅提示"可参考流程",不自动给步骤)。
   */
  function renderChecklist(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p || p.stage !== 'active') return null
    if (p.riskLevel === 'high') {
      return {
        procedureId: p.procedureId, title: p.title, level: 'hint', riskLevel: p.riskLevel,
        text: '[技能提示] 场景匹配「' + p.title + '」(高风险流程,已确认可参考)。如需执行请先向用户确认,再按记忆中的固定步骤操作。',
      }
    }
    const lines = []
    lines.push('[技能] ' + p.title)
    if (p.preconditions.length) lines.push('前置: ' + p.preconditions.join('; '))
    p.steps.forEach(function (s, i) { lines.push((i + 1) + '. ' + s) })
    if (p.checks.length) lines.push('检查: ' + p.checks.join('; '))
    if (p.successCriteria.length) lines.push('完成标准: ' + p.successCriteria.join('; '))
    if (p.rollback.length) lines.push('回滚: ' + p.rollback.join('; '))
    return {
      procedureId: p.procedureId, title: p.title, level: activeLevel, riskLevel: p.riskLevel,
      text: lines.join('\n').slice(0, 2000), // 预算内
    }
  }

  // ---- 持久化 ----
  function snapshot() {
    return {
      schemaVersion: 1, namespace: 'dsh-auto-memory', policyVersion: PROCEDURE_POLICY_VERSION,
      savedAt: nowFn(),
      procedures: procedures.map((p) => ({ ...p, _sessions: p._sessions ? [...p._sessions] : undefined, evidence: { ...p.evidence } })),
    }
  }
  function restore(data) {
    if (!data || data.schemaVersion !== 1) return { ok: false, reason: 'bad-schema' }
    if (!Array.isArray(data.procedures)) return { ok: false, reason: 'bad-procedures' }
    procedures = []
    for (const p of data.procedures) {
      const v = validateProcedurePre(p)
      if (!v.ok) continue
      if (p._sessions) { p._sessions = new Set(p._sessions); p.evidence.sessions = p._sessions.size }
      procedures.push(v.procedure)
    }
    return { ok: true, restored: procedures.length }
  }
  function clear() {
    procedures = []
    try { io.clear() } catch (_) {}
    return { ok: true }
  }
  function dispose(reason) {
    if (disposed) return
    disposed = true
    try { io.save(snapshot()) } catch (_) {}
  }
  function persist() {
    try { io.save(snapshot()) } catch (_) {}
  }

  return {
    observe, addEvidence, promote, activate, deprecate,
    touch, setPinned, applyAutomaticTransitions,
    query, activeProcedures, get, renderChecklist,
    snapshot, restore, clear, dispose,
    getStats: () => ({ ...stats }),
    get size() { return procedures.length },
  }
}
