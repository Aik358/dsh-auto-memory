/**
 * contract.js —— event-attribution/v1 共享协议：DTO、枚举、默认值、不变量。
 *
 * 职责边界（本模块只做「形状」，不做任何 I/O）：
 *   · 定义 schemaVersion / trigger / decision 枚举与合法组合
 *   · 定义 proposal DTO 的构造与规范化（字段裁剪、类型归一）
 *   · 定义 EVENT_ATTRIBUTION_PROFILE_V1（promptVersion / 归一化版本 / 候选池策略 / 路由 / 预算）
 *
 * 禁止：读文件、调模型、写事件库、渲染 UI。
 *
 * ★为什么把 profile 冻结在这里：模型或 prompt 变更后不得隐式复用旧证据/向量/结论。
 *   每次调用把 promptSha256 + 各版本号写进 modelIdentity，事后可审计「这次结果出自哪一版协议」。
 */

/** 协议版本号。任何 DTO 形状变化都必须同时改这里。 */
export const SCHEMA_VERSION = 'event-attribution/v1'

/** 提案状态：本模块永远只产提案，不产写入指令。 */
export const STATUS_PROPOSAL_ONLY = 'proposal-only'

/** 触发来源枚举。 */
export const TRIGGERS = Object.freeze({
  UNASSIGNED: 'unassigned',
  SUSPECT_AUTO_ATTACH: 'suspect-auto-attach',
  EXPLICIT_REVIEW: 'explicit-review',
  HISTORICAL_REGROUP: 'historical-regroup',
})
const TRIGGER_SET = new Set(Object.values(TRIGGERS))

/** 四态 + unavailable。unavailable 表示模型不可用，**不**等于 create-new。 */
export const DECISIONS = Object.freeze({
  ATTACH_EXISTING: 'attach-existing',
  CREATE_NEW: 'create-new',
  AMBIGUOUS: 'ambiguous',
  NOT_APPLICABLE: 'not-applicable',
  UNAVAILABLE: 'unavailable',
})
const DECISION_SET = new Set(Object.values(DECISIONS))

/** 候选池覆盖度。partial 必须同时满足 omittedCount > 0。 */
export const COVERAGES = Object.freeze({ COMPLETE: 'complete', PARTIAL: 'partial', NONE: 'none' })
const COVERAGE_SET = new Set(Object.values(COVERAGES))

/** 警告码。全部为机器可判定的小写连字符串。 */
export const WARN_CODES = Object.freeze({
  SUSPECT_AUTO_ATTACH: 'suspect-auto-attach',
  MODEL_DISAGREES: 'model-disagrees',
  POOL_TRUNCATED: 'pool-truncated',
  MODEL_UNAVAILABLE: 'model-unavailable',
  MODEL_UNPARSEABLE: 'model-unparseable',
  INVALID_EVENT_ID: 'invalid-event-id',
  MULTIPLE_REASONABLE: 'multiple-reasonable',
  SCORE_UNAVAILABLE: 'score-unavailable',
  EXPLICIT_TARGET_NOT_IN_POOL: 'explicit-target-not-in-pool',
})

/** 模型路由标识（仅复用宿主既有 subagent，不新建网络通道）。 */
export const HOST_ROUTE = 'host-subagent'
export const HOST_JOB_LABEL = 'auto-memory-event-attr'

/**
 * 冻结 profile v1。
 *
 * ★改任何一个版本号都必须有对应理由，并在报告中记录——它是「同一次实验可复现」的锚。
 */
export const EVENT_ATTRIBUTION_PROFILE_V1 = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  promptVersion: 'event-attr-prompt/v1',
  inputNormalizationVersion: 'event-attr-norm/v1',
  eventRepresentationVersion: 'event-attr-repr/v1',
  candidatePoolPolicy: 'event-attr-pool/v1',
  hostRoute: HOST_ROUTE,
  hostJobLabel: HOST_JOB_LABEL,
  /** 模型调用超时上限（毫秒）。0 表示用调用点默认。 */
  timeoutMs: 60000,
  /** 模型输入预算：单候选证据字符上限 / 送入模型的候选上限。 */
  budget: Object.freeze({
    /** 单条候选证据（name+summary+goal/state）截断字符数。 */
    maxEvidenceChars: 260,
    /** 送入模型的候选条数上限。必须与 pool.visibleCount 一致，且必须有 omittedCount。 */
    maxCandidates: 12,
    /** 记录正文送入模型的字符上限。 */
    maxRecordChars: 900,
  }),
})

/**
 * 规范化 proposal DTO。
 *
 * ★这是**唯一**允许构造 proposal 的入口 —— 各领域模块返回半成品，由本函数收口形状，
 *   因此下游（回执/测试/报告）见到的字段集恒定。
 *
 * @param {object} p 半成品
 * @returns {object} 规范化后的 proposal
 */
export function buildProposal(p = {}) {
  const trigger = TRIGGER_SET.has(p.trigger) ? p.trigger : TRIGGERS.UNASSIGNED
  const decision = DECISION_SET.has(p.decision) ? p.decision : DECISIONS.UNAVAILABLE
  const selectedEventId = (typeof p.selectedEventId === 'string' && p.selectedEventId) ? p.selectedEventId : null
  const candidates = (Array.isArray(p.candidates) ? p.candidates : []).map((c) => ({
    eventId: String((c && c.eventId) || ''),
    score: (c && typeof c.score === 'number' && Number.isFinite(c.score)) ? c.score : null,
    margin: (c && typeof c.margin === 'number' && Number.isFinite(c.margin)) ? c.margin : null,
    evidence: (Array.isArray(c && c.evidence) ? c.evidence : []).map(String).slice(0, 8),
  })).filter((c) => c.eventId)
  const rawPool = (p.pool && typeof p.pool === 'object') ? p.pool : {}
  const eligibleCount = Math.max(0, Number(rawPool.eligibleCount) || 0)
  const visibleCount = Math.max(0, Number(rawPool.visibleCount) || 0)
  const omittedCount = Math.max(0, Number(rawPool.omittedCount) || 0)
  let coverage = COVERAGE_SET.has(rawPool.coverage) ? rawPool.coverage : COVERAGES.NONE
  // 不变量：omittedCount>0 ⇒ coverage 必为 partial；omittedCount===0 且 visible>0 ⇒ complete
  if (omittedCount > 0) coverage = COVERAGES.PARTIAL
  else if (visibleCount > 0 && coverage === COVERAGES.NONE) coverage = COVERAGES.COMPLETE
  const mi = (p.modelIdentity && typeof p.modelIdentity === 'object') ? p.modelIdentity : {}
  const strOrNull = (v) => (typeof v === 'string' && v) ? v : null
  return {
    schemaVersion: SCHEMA_VERSION,
    status: STATUS_PROPOSAL_ONLY,
    trigger,
    decision,
    selectedEventId,
    candidates,
    rationale: String(p.rationale == null ? '' : p.rationale).slice(0, 600),
    counterHypothesis: String(p.counterHypothesis == null ? '' : p.counterHypothesis).slice(0, 400),
    warnings: (Array.isArray(p.warnings) ? p.warnings : []).map((x) => ({
      code: String((x && x.code) || 'unknown'),
      message: String((x && x.message) || '').slice(0, 300),
      eventIds: (Array.isArray(x && x.eventIds) ? x.eventIds : []).map(String).slice(0, 8),
    })),
    pool: {
      eligibleCount,
      visibleCount,
      omittedCount,
      truncated: omittedCount > 0 || rawPool.truncated === true,
      coverage,
      // ★task-29 阻断二：focus 三态必须**穿透到 DTO**（否则 reviewer 无法区分
      //   「模型真否决」与「目标没被看到」；旧版在这里被白名单过滤掉 ⇒ 误报无法根治）。
      focusEventId: strOrNull(rawPool.focusEventId),
      focusInEligible: rawPool.focusInEligible === true,
      focusReserved: rawPool.focusReserved === true,
      focusVisible: rawPool.focusVisible === true,
    },
    modelIdentity: {
      route: strOrNull(mi.route) || HOST_ROUTE,
      job: strOrNull(mi.job) || HOST_JOB_LABEL,
      promptVersion: strOrNull(mi.promptVersion) || EVENT_ATTRIBUTION_PROFILE_V1.promptVersion,
      promptSha256: strOrNull(mi.promptSha256) || '',
      requestedProvider: strOrNull(mi.requestedProvider),
      requestedModel: strOrNull(mi.requestedModel),
      // ★runSubagent 不返回实际 provider/model ⇒ 这两个字段只能为 null，**不得猜测**。
      resolvedProvider: strOrNull(mi.resolvedProvider),
      resolvedModel: strOrNull(mi.resolvedModel),
      embeddingIdentity: (mi.embeddingIdentity && typeof mi.embeddingIdentity === 'object') ? mi.embeddingIdentity : null,
    },
  }
}

/**
 * 不变量校验（供测试与 reviewer 自检）。返回违规列表，空数组 = 通过。
 *
 * ★这是可被真调用的判据，不是源码静态断言。
 *
 * @param {object} p proposal
 * @returns {string[]} 违规描述
 */
export function validateProposalInvariants(p) {
  const bad = []
  if (!p || typeof p !== 'object') return ['proposal 不是对象']
  if (p.schemaVersion !== SCHEMA_VERSION) bad.push('schemaVersion 必须是 ' + SCHEMA_VERSION)
  if (p.status !== STATUS_PROPOSAL_ONLY) bad.push('status 必须是 ' + STATUS_PROPOSAL_ONLY)
  if (!TRIGGER_SET.has(p.trigger)) bad.push('trigger 非法：' + p.trigger)
  if (!DECISION_SET.has(p.decision)) bad.push('decision 非法：' + p.decision)
  // selectedEventId 必须是候选之一（attach-existing 时）
  if (p.decision === DECISIONS.ATTACH_EXISTING) {
    if (!p.selectedEventId) bad.push('attach-existing 必须有 selectedEventId')
    else if (!(p.candidates || []).some((c) => c.eventId === p.selectedEventId)) {
      bad.push('selectedEventId 不在候选集内：' + p.selectedEventId)
    }
  }
  // ambiguous 允许且应当为 null
  if (p.decision === DECISIONS.AMBIGUOUS && p.selectedEventId) {
    bad.push('ambiguous 不得强行择一（selectedEventId 应为 null）')
  }
  if (p.decision === DECISIONS.UNAVAILABLE && p.selectedEventId) {
    bad.push('unavailable 不得带 selectedEventId')
  }
  const pool = p.pool || {}
  if (pool.omittedCount > 0 && pool.coverage !== COVERAGES.PARTIAL) {
    bad.push('omittedCount>0 时 coverage 必须是 partial（禁止静默截断）')
  }
  if (pool.omittedCount > 0 && pool.truncated !== true) bad.push('omittedCount>0 时 truncated 必须为 true')
  if (pool.visibleCount + pool.omittedCount !== pool.eligibleCount) {
    bad.push('候选池守恒失败：visible+omitted != eligible')
  }
  return bad
}

export default {
  SCHEMA_VERSION,
  STATUS_PROPOSAL_ONLY,
  TRIGGERS,
  DECISIONS,
  COVERAGES,
  WARN_CODES,
  HOST_ROUTE,
  HOST_JOB_LABEL,
  EVENT_ATTRIBUTION_PROFILE_V1,
  buildProposal,
  validateProposalInvariants,
}
