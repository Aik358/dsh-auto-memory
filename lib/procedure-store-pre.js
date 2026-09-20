import { isObservationOnlyPre, normalizeProcedureObservationPre, matchingProcedurePre, mergeProcedureSourcesPre, newProcedureIdentityPre } from './procedure-observation-pre.js'
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

export const PROCEDURE_POLICY_VERSION = 'procedure_store_pre_v1'
export const PROCEDURE_ID_PREFIX = 'proc_pre_'
export const PROCEDURE_ID_RE = /^proc_pre_[0-9a-f]{32}$/

/** 阶段枚举(M-04 元代码)。 */
export const PROCEDURE_STAGES_PRE_V1 = Object.freeze(['observed', 'candidate', 'validated', 'active', 'deprecated'])

/** 自动归档老化(Hermes curator 借鉴,2026-08-28):active 技能 lastUsedAt 超过
 *  PROCEDURE_ARCHIVE_AFTER_DAYS_PRE_V1 天未使用且未 pinned → 自动 deprecated
 *  (reason=auto-archive-inactive;deprecated 可恢复,永不物理删除)。
 *  observed/candidate/validated 不老化——它们由晋升门槛时间控。 */
export const PROCEDURE_ARCHIVE_AFTER_DAYS_PRE_V1 = 90

/** 风险等级枚举。 */
export const PROCEDURE_RISKS_PRE_V1 = Object.freeze(['low', 'medium', 'high'])

/** 激活等级(M6 六级契约)。 */
export const PROCEDURE_LEVELS_PRE_V1 = Object.freeze(['index', 'hint', 'excerpt', 'checklist', 'resource', 'full'])

/** 晋升门槛(可调参数,默认值来自 M-04 元代码): 跨会话多样性≥3, 成功≥2。 */
export const PROCEDURE_DEFAULT_GATES_PRE_V1 = Object.freeze({
  minSessionDiversity: 3,
  minSuccessCount: 2,
  maxCorrectionRate: 0.3,   // correction 占总证据比例上限
  maxContradictions: 0,     // 矛盾数上限(0=任何矛盾都阻止)
  highRiskRequiresApproval: true,
})

/** 一次成功或三次重复都不足以证明可靠 → 需要的最小成功数(元代码铁律)。 */
export const PROCEDURE_MIN_SUCCESS_PRE_V1 = 2

/** active 后可注入的默认 level(渐进激活;高风险降级为 hint)。 */
export const PROCEDURE_ACTIVE_LEVEL_PRE_V1 = 'checklist'

/** procedure 校验(固化/读回)。 */
export function validateProcedurePre(p) {
  const q = []
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, reason: 'not-object' }
  if (typeof p.procedureId !== 'string' || !PROCEDURE_ID_RE.test(p.procedureId)) q.push('procedureId')
  if (!PROCEDURE_STAGES_PRE_V1.includes(p.stage)) q.push('stage')
  if (!PROCEDURE_RISKS_PRE_V1.includes(p.riskLevel)) q.push('riskLevel')
  if (typeof p.title !== 'string' || !p.title.trim()) q.push('title')
  if (!Array.isArray(p.sourceMemoryIds)) q.push('sourceMemoryIds')
  if (!Array.isArray(p.sourceEpisodes)) q.push('sourceEpisodes')
  if (!Array.isArray(p.steps) || !p.steps.length) q.push('steps')
  if (!Array.isArray(p.checks)) q.push('checks')
  if (!Array.isArray(p.successCriteria)) q.push('successCriteria')
  if (!Array.isArray(p.rollback)) q.push('rollback')
  if (typeof p.createdAt !== 'number' || !Number.isFinite(p.createdAt)) q.push('createdAt')
  if (p.requiresApproval !== undefined && typeof p.requiresApproval !== 'boolean') q.push('requiresApproval')
  // issue #30:observationOnly 可选字段,类型必须显式校验(否则脏值会静默通过校验层)。
  if (p.observationOnly !== undefined && typeof p.observationOnly !== 'boolean') q.push('observationOnly')
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
  if (!PROCEDURE_RISKS_PRE_V1.includes(c.riskLevel || 'low')) p.push('riskLevel')
  if (!Array.isArray(c.steps) || !c.steps.length) p.push('steps')
  if (c.successCriteria !== undefined && !Array.isArray(c.successCriteria)) p.push('successCriteria')
  if (c.sourceMemoryIds !== undefined && !Array.isArray(c.sourceMemoryIds)) p.push('sourceMemoryIds')
  if (c.sourceEpisodes !== undefined && !Array.isArray(c.sourceEpisodes)) p.push('sourceEpisodes')
  if (c.preconditions !== undefined && !Array.isArray(c.preconditions)) p.push('preconditions')
  if (c.checks !== undefined && !Array.isArray(c.checks)) p.push('checks')
  if (c.rollback !== undefined && !Array.isArray(c.rollback)) p.push('rollback')
  if (c.observationOnly !== undefined && typeof c.observationOnly !== 'boolean') p.push('observationOnly')
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
  const gates = opts.gates || PROCEDURE_DEFAULT_GATES_PRE_V1
  const activeLevel = opts.activeLevel || PROCEDURE_ACTIVE_LEVEL_PRE_V1

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
    // issue #30 根因:旧实现按 `title` 去重 —— episode 自动观察出的"仅观察行"通常先建,
    // 之后带真实步骤/成功判据的富候选**同名**时会被合并进观察行,而合并只拷贝证据源字段,
    // 富候选的 steps/successCriteria **整体丢失** ⇒ promote() 永远卡在 `no-success-criteria`,
    // 技能永远无法晋升。修法:① 先把历史行归一化出 observationOnly 标记;
    // ② 用**指纹**(含 steps/criteria/rollback 等全部实质字段)匹配,仅观察行与富候选
    // 指纹不同 ⇒ 各自独立成行,互不污染(标题不是身份)。
    procedures = procedures.map(normalizeProcedureObservationPre)
    const existing = matchingProcedurePre(procedures, c)
    if (existing) {
      mergeProcedureSourcesPre(existing, c)
      existing.updatedAt = now
      void persist()
      return { ok: true, procedure: existing, merged: true }
    }
    const p = {
      procedureId: newProcedureIdentityPre(c, now, procedures, PROCEDURE_ID_PREFIX),
      title: c.title,
      stage: 'observed',
      riskLevel: c.riskLevel || 'low',
      requiresApproval: c.riskLevel === 'high' && gates.highRiskRequiresApproval,
      // issue #30:入参数组一律深拷一层,避免调用方后续改动把已入账记录改脏(与 PR#36 口径一致)。
      sourceMemoryIds: [...new Set(c.sourceMemoryIds || [])],
      sourceEpisodes: [...new Set(c.sourceEpisodes || [])],
      preconditions: (c.preconditions || []).slice(),
      steps: c.steps.slice(),
      checks: (c.checks || []).slice(),
      successCriteria: (c.successCriteria || []).slice(),
      rollback: (c.rollback || []).slice(),
      createdAt: now,
      updatedAt: now,
      lastUsedAt: now,
      pinned: false,
      origin: c.origin === 'user' ? 'user' : 'agent',
      // issue #30:纯 episode 观察行显式打标 —— 它没有 successCriteria,永远不该晋升,
      // 也不该与富候选互相污染(此前无标记,只能靠 title 撞车后丢字段)。
      ...(isObservationOnlyPre(c) ? { observationOnly: true } : {}),
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
    const cutoff = now - PROCEDURE_ARCHIVE_AFTER_DAYS_PRE_V1 * 86400000
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
   *
   * ★ T4（2026-09-19 用户拍板「让大模型来介入」）：新增第三个参数 `opts`。
   *   `opts.authorizedBy`（如 'model'）= **模型显式授权**，用于跳过两条**统计证据门**
   *   （`minSessionDiversity` / `minSuccessCount`）。
   *
   *   为什么需要它：这两条门是给**机械生成**的观察行用的防污染护栏 —— 它们靠"反复出现"累积证据。
   *   但机械路径产出的条目 13/14 是空壳（`actions=['user','user','user']` 切出来的），
   *   而**模型主动写出的技能**（带真 steps + successCriteria）**天生没有历史证据**，
   *   若不放行则永远卡在 `diversity-below-3` ⇒ 模型通路等于白建。
   *
   *   **仍然保留的护栏（授权也不放行）**：
   *     · `deprecated` 短路 —— 已弃用的不得复活；
   *     · `isObservationOnlyPre` 短路 —— 结构上不该晋升的行，授权也拦；
   *     · **`no-success-criteria` 必须有**（在下方）—— 没写验收标准的不算技能；
   *     · `correction-rate` / `has-correction` —— 有纠正记录说明这流程是错的。
   *   并**留痕**：`p.authorizedBy` + reasonCodes 追加 `model-authorized`，供审计与前端展示。
   */
  function promote(procedureId, extraEvidence = {}, opts = {}) {
    if (disposed) return { ok: false, reason: 'disposed' }
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (p.stage === 'deprecated') return { ok: true, decision: 'keep', reasonCodes: ['deprecated'] }
    // issue #30:纯 episode 观察行没有 successCriteria,本来就无法晋升;
    // 显式短路并给出 `observation-only` 原因码,而不是让它落到下面报 `no-success-criteria`
    // (后者会让使用者误以为"缺判据、补上就能晋升",其实是这行**结构上**不该晋升)。
    // ★ T4:此短路**不受授权影响** —— 结构上不该晋升的行,模型授权也不放行。
    if (isObservationOnlyPre(p)) return { ok: true, decision: 'keep', procedure: p, reasonCodes: ['observation-only'] }

    const ev = p.evidence
    const reason = []
    const authorizedBy = opts && opts.authorizedBy ? String(opts.authorizedBy) : ''
    if (authorizedBy) reason.push('model-authorized')
    // 跨会话多样性
    const diversity = extraEvidence.distinctSessions != null ? extraEvidence.distinctSessions : ev.sessions
    const successCount = extraEvidence.successCount != null ? extraEvidence.successCount : ev.success
    // ★ T4:两条**统计证据门**在模型授权下跳过(见上方函数注释);未授权时行为逐字节不变。
    if (!authorizedBy) {
      if (diversity < gates.minSessionDiversity) { reason.push('diversity-below-' + gates.minSessionDiversity); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
      if (successCount < gates.minSuccessCount) { reason.push('success-below-' + gates.minSuccessCount); return { ok: true, decision: 'keep', procedure: p, reasonCodes: reason } }
    }
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
    // ★ T4:授权晋升留痕 —— 前端与审计面必须能看出「这条是模型授权跳门进来的」,
    //   否则日后无法区分「统计证据充分」与「模型判断值得」两种来源。
    if (authorizedBy) p.authorizedBy = authorizedBy
    stats.validated++
    void persist()
    return { ok: true, decision: 'promote', procedure: p, reasonCodes: reason }
  }

  /**
   * ★R2（2026-09-20 用户要求「晋升原因必须看得见」）：**纯只读**晋升判定投影。
   *
   * 与 `promote()` 的关系：**逐行复制其门限判定，但不改任何状态**。
   * 为什么不能直接调 `promote()`：它含真实副作用
   * （`stats.approvalAsked++` / `p.stage='validated'` / `stats.validated++` / `persist()` 写盘），
   * 在 `overview()` 这类只读轮询路径里调用会**污染统计并把候选悄悄提升**。
   * ⇒ 只读面必须走本函数（用户 2026-09-18 冻结纪律）。
   *
   * ⚠️ 维护约定：改 `promote()` 的门限时**必须同步改这里**，否则前端会展示过时的判据。
   * 两者的一致性由测试 `smoke-test-r2-promotion-pre.mjs` 用变异兜底。
   *
   * @returns {{ok:boolean, decision?:string, reasonCodes?:string[], detail?:object}}
   */
  function evaluatePromotion(procedureId) {
    const p = procedures.find((x) => x.procedureId === procedureId)
    if (!p) return { ok: false, reason: 'not-found' }
    if (p.stage === 'deprecated') return { ok: true, decision: 'keep', reasonCodes: ['deprecated'] }
    if (isObservationOnlyPre(p)) return { ok: true, decision: 'keep', reasonCodes: ['observation-only'] }
    const ev = p.evidence || { seen: 0, read: 0, cite: 0, reuse: 0, success: 0, correction: 0, sessions: 0 }
    const reason = []
    const diversity = Number(ev.sessions) || 0
    const successCount = Number(ev.success) || 0
    const total = (Number(ev.seen) || 0) + (Number(ev.read) || 0) + (Number(ev.cite) || 0)
      + (Number(ev.reuse) || 0) + successCount + (Number(ev.correction) || 0)
    const corrRate = total > 0 ? (Number(ev.correction) || 0) / total : 0
    // ⚠️ 顺序必须与 promote() **完全一致**（先返回的那个才决定前端文案）
    if (diversity < gates.minSessionDiversity) {
      reason.push('diversity-below-' + gates.minSessionDiversity)
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { diversity, need: gates.minSessionDiversity } }
    }
    if (successCount < gates.minSuccessCount) {
      reason.push('success-below-' + gates.minSuccessCount)
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { successCount, need: gates.minSuccessCount } }
    }
    if (corrRate > gates.maxCorrectionRate) {
      reason.push('correction-rate-' + corrRate.toFixed(2))
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { corrRate, cap: gates.maxCorrectionRate } }
    }
    if (gates.maxContradictions === 0 && (Number(ev.correction) || 0) > 0) {
      reason.push('has-correction')
      return { ok: true, decision: 'keep', reasonCodes: reason, detail: { corrections: Number(ev.correction) || 0 } }
    }
    if (!p.successCriteria || !p.successCriteria.length) {
      reason.push('no-success-criteria')
      return { ok: true, decision: 'keep', reasonCodes: reason }
    }
    if (p.requiresApproval && !p.approved) {
      reason.push('high-risk-awaiting-approval')
      return { ok: true, decision: 'ask', reasonCodes: reason }
    }
    return { ok: true, decision: 'promote', reasonCodes: reason, detail: { diversity, successCount } }
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
      schemaVersion: 1, namespace: 'dsh-auto-memory-pre', policyVersion: PROCEDURE_POLICY_VERSION,
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
      // issue #30:旧快照里没有 observationOnly 字段,恢复时按同一判据补齐
      // (纯增量元数据迁移:不改身份/文本/风险/证据/阶段)。
      procedures.push(normalizeProcedureObservationPre(v.procedure))
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
    // ★R2：只读判定投影（供 overview() 展示「为什么不能晋升」）
    evaluatePromotion,
    observe, addEvidence, promote, activate, deprecate,
    touch, setPinned, applyAutomaticTransitions,
    query, activeProcedures, get, renderChecklist,
    snapshot, restore, clear, dispose,
    getStats: () => ({ ...stats }),
    get size() { return procedures.length },
  }
}
