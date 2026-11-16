/**
 * reviewer.js —— 触发后的复核编排：模型结果 + pool/DTO 合并。
 *
 * 职责边界：
 *   · 决定「这一次要不要真的调模型」（触发判定）
 *   · 编排 candidate-pool → prompt → host-model → parser
 *   · 把模型结果与池元数据合并成 proposal（形状收口仍交给 contract）
 *
 * 禁止：写文件/事件库、渲染回执、直接调用宿主 engine（只经 ports.modelPort）。
 *
 * ★触发规则来自任务书 §5 ——正常路径不额外烧模型：
 *   · 显式 eventId 的真实写入            ⇒ 不调用（不事后质疑用户）
 *   · 高置信单标识命中、无冲突            ⇒ 不调用
 *   · 未传 eventId 且预判 create          ⇒ 调用（可用时）
 *   · 预判 attach 但 reason 弱/多命中/冲突 ⇒ 调用
 *   · dryRun（含显式 eventId）            ⇒ 调用
 *   · 模型不可用                          ⇒ 不重复轰炸，降级
 */

import {
  DECISIONS, TRIGGERS, WARN_CODES, EVENT_ATTRIBUTION_PROFILE_V1, buildProposal,
} from './contract.js'
import { buildCandidatePoolPre } from './candidate-pool.js'
import { buildPromptPre, normalizeRecordPre } from './prompt.js'
import { parseModelOutputPre } from './parser.js'
import { callHostModelPre, MODEL_CODES } from './host-model.js'

/** 弱归属理由：这些 reason 下模型复核有增益（词袋/旧行为/主题兜底都不是硬证据）。 */
const WEAK_ATTACH_REASONS = new Set(['wordbag', 'legacy', 'topic'])

/**
 * 判断是否需要模型复核。
 *
 * @param {{ explicitEventId?:string|null, dryRun?:boolean, attrDecision?:string,
 *           attrReason?:string, identifierHits?:number, conflict?:boolean }} ctx
 * @returns {{ needed:boolean, trigger:string, why:string }}
 */
export function decideTriggerPre(ctx = {}) {
  const hasExplicit = !!(ctx.explicitEventId && String(ctx.explicitEventId))
  const dry = ctx.dryRun === true
  if (hasExplicit && !dry) {
    return { needed: false, trigger: TRIGGERS.EXPLICIT_REVIEW, why: '显式 eventId 真实写入，不事后质疑用户' }
  }
  if (dry) {
    return { needed: true, trigger: hasExplicit ? TRIGGERS.EXPLICIT_REVIEW : TRIGGERS.UNASSIGNED, why: 'dryRun 预检' }
  }
  const dec = String(ctx.attrDecision || '')
  const reason = String(ctx.attrReason || '')
  if (dec === 'create') {
    return { needed: true, trigger: TRIGGERS.UNASSIGNED, why: '未自动归属（将新建）' }
  }
  if (dec === 'attach') {
    if (WEAK_ATTACH_REASONS.has(reason)) {
      return { needed: true, trigger: TRIGGERS.SUSPECT_AUTO_ATTACH, why: '弱证据 attach（' + reason + '）' }
    }
    if (Number(ctx.identifierHits) > 1) {
      return { needed: true, trigger: TRIGGERS.SUSPECT_AUTO_ATTACH, why: '标识多命中（' + Number(ctx.identifierHits) + '）' }
    }
    if (ctx.conflict === true) {
      return { needed: true, trigger: TRIGGERS.SUSPECT_AUTO_ATTACH, why: '证据冲突' }
    }
    return { needed: false, trigger: TRIGGERS.EXPLICIT_REVIEW, why: '高置信单标识命中，无冲突' }
  }
  return { needed: false, trigger: TRIGGERS.UNASSIGNED, why: '无可复核的归属判定' }
}

/**
 * 执行一次归属复核。
 *
 * @param {object} ports { modelPort?, clock? }
 * @param {object} input {
 *   record:{ text, kind, at },
 *   events:Array,                 // 事件库快照
 *   explicitEventId?:string|null,
 *   dryRun?:boolean,
 *   attrDecision?:string, attrReason?:string, identifierHits?:number, conflict?:boolean,
 *   scoreOf?:(ev)=>number|null,
 *   timeoutMs?:number
 * }
 * @returns {Promise<object>} proposal（已过 contract 规范化）
 */
export async function reviewPre(ports, input = {}) {
  const prof = EVENT_ATTRIBUTION_PROFILE_V1
  const trig = decideTriggerPre(input)
  const at = Number(input.record && input.record.at) || 0
  const clockPort = (ports && typeof ports.clock === 'function') ? ports.clock : null
  const nowMs = clockPort ? Number(clockPort()) : at
  if (!trig.needed) {
    // 未触发：返回一个「不适用」提案，让调用方可以无脑 appendReceipt（空串）
    return buildProposal({
      trigger: trig.trigger,
      decision: DECISIONS.NOT_APPLICABLE,
      rationale: '未触发模型复核：' + trig.why,
      pool: { eligibleCount: 0, visibleCount: 0, omittedCount: 0, coverage: 'none' },
    })
  }

  const norm = normalizeRecordPre(input.record && input.record.text, prof.budget.maxRecordChars)
  const poolRes = buildCandidatePoolPre({
    events: input.events,
    at: at || nowMs,
    // ★task-29 阻断二：exclude 与 focus 是**两个不同语义**
    //   excludeEventId = 「别把自己算成候选」（LOOCA 自引用，通常是本次记录已挂的事件）
    //   focusEventId   = 「我是来复核它的，必须让它可见」（防 top-K 把复核目标截掉）
    excludeEventId: input.excludeEventId || null,
    focusEventId: input.focusEventId || input.attrEventId || input.explicitEventId || null,
    maxCandidates: prof.budget.maxCandidates,
    scoreOf: input.scoreOf,
  })
  const pool = poolRes.pool
  const visible = poolRes.visible
  const warnings = []
  if (pool.omittedCount > 0) {
    warnings.push({
      code: WARN_CODES.POOL_TRUNCATED,
      message: '候选池被预算截断：eligible ' + pool.eligibleCount + ' / 展示 ' + pool.visibleCount,
      eventIds: [],
    })
  }
  const recordForPrompt = {
    atIso: at ? new Date(at).toISOString() : '',
    kind: input.record && input.record.kind,
    text: norm.text,
  }
  const built = buildPromptPre({ record: recordForPrompt, candidates: visible, trigger: trig.trigger, pool })
  const modelRes = await callHostModelPre(ports, built.prompt, {
    timeoutMs: input.timeoutMs || prof.timeoutMs,
    label: prof.hostJobLabel,
  })
  // ★task-29 阻断五：**requested 与 resolved 分开**
  //   requested = 我们**请求**的配置（来自 modelPort.describe() ← engine.config.subagentProvider|subagentModel）
  //   resolved  = runSubagent 实际观测到的身份；未观测到就**保持 null，不猜测**
  const req = (ports && ports.modelPort && typeof ports.modelPort.describe === 'function')
    ? (ports.modelPort.describe() || {}) : {}
  const reqStr = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null
  const modelIdentity = {
    route: prof.hostRoute,
    job: prof.hostJobLabel,
    promptVersion: built.promptVersion,
    promptSha256: built.promptSha256,
    requestedProvider: reqStr(req.provider),
    requestedModel: reqStr(req.model),
    resolvedProvider: null,
    resolvedModel: null,
    embeddingIdentity: null,
  }
  if (!modelRes.ok) {
    warnings.push({
      code: modelRes.code === MODEL_CODES.EMPTY ? WARN_CODES.MODEL_UNPARSEABLE : WARN_CODES.MODEL_UNAVAILABLE,
      message: modelRes.code + ': ' + String(modelRes.error || ''),
      eventIds: [],
    })
    return buildProposal({
      trigger: trig.trigger,
      decision: DECISIONS.UNAVAILABLE,
      candidates: visible.map((c) => ({ eventId: c.eventId, score: c.score, margin: c.margin, evidence: c.evidence })),
      rationale: '模型不可用：' + trig.why,
      warnings,
      pool,
      modelIdentity,
    })
  }
  const parsed = parseModelOutputPre(modelRes.text, visible.map((c) => c.eventId))
  if (!parsed.ok) {
    warnings.push({
      code: WARN_CODES.MODEL_UNPARSEABLE,
      message: String(parsed.code) + ': ' + String(parsed.error || ''),
      eventIds: [],
    })
    return buildProposal({
      trigger: trig.trigger,
      decision: DECISIONS.UNAVAILABLE,
      candidates: visible.map((c) => ({ eventId: c.eventId, score: c.score, margin: c.margin, evidence: c.evidence })),
      rationale: '模型输出不可用：' + trig.why,
      warnings,
      pool,
      modelIdentity,
    })
  }
  // ★★task-29 阻断二：疑似错误归属**必须建立在「模型确实看到了目标」之上**。
  //   旧缺陷：只要 attrDecision=attach 且模型选择不同就打 suspect-auto-attach；
  //   但若 attrEventId 被 maxCandidates 截掉，模型根本没看到它 ⇒ **误报**。
  //   判据：只有 focusVisible===true（模型输入里确实含目标）且模型明确选了**另一个**事件，
  //   才是「模型否决」；否则打 EXPLICIT_TARGET_NOT_IN_POOL，且决策降级为 ambiguous。
  const focusVisible = !!pool.focusVisible
  const targetId = input.attrEventId ? String(input.attrEventId)
    : (input.focusEventId ? String(input.focusEventId) : null)
  const modelSawTarget = !targetId || focusVisible
  if (targetId && !modelSawTarget) {
    warnings.push({
      code: WARN_CODES.EXPLICIT_TARGET_NOT_IN_POOL,
      message: '复核目标 ' + targetId + ' 不在本次可见候选中（eligible='
        + Number(pool.eligibleCount) + ' / visible=' + Number(pool.visibleCount)
        + '，inEligible=' + String(!!pool.focusInEligible) + '）⇒ 无法据此判断模型是否否决',
      eventIds: [targetId],
    })
  }
  if (input.attrDecision === 'attach' && targetId && modelSawTarget
      && (parsed.decision !== DECISIONS.ATTACH_EXISTING || String(parsed.selectedEventId) !== targetId)) {
    warnings.push({
      code: WARN_CODES.SUSPECT_AUTO_ATTACH,
      message: '既有规则挂到 ' + targetId + '（模型已看到该候选），模型判定为 ' + parsed.decision,
      eventIds: [targetId],
    })
  }
  if (parsed.decision === DECISIONS.AMBIGUOUS) {
    warnings.push({ code: WARN_CODES.MULTIPLE_REASONABLE, message: '多个合理候选，未强行择一', eventIds: [] })
  }
  if (visible.some((c) => c.score == null) && visible.length) {
    warnings.push({ code: WARN_CODES.SCORE_UNAVAILABLE, message: '本次无可用打分器，score/margin 为 null', eventIds: [] })
  }
  // 目标不可见 ⇒ 模型的选择**不能**用于否决当前归属，降级为 ambiguous（理由写清）
  const finalDecision = (targetId && !modelSawTarget && parsed.decision !== DECISIONS.UNAVAILABLE)
    ? DECISIONS.AMBIGUOUS : parsed.decision
  const finalSelected = (finalDecision === parsed.decision) ? parsed.selectedEventId : null
  const finalRationale = (finalDecision === parsed.decision)
    ? parsed.rationale
    : ('复核目标 ' + targetId + ' 不在可见候选中，模型无法判断当前归属是否正确；本条判为待人工确认。'
       + (parsed.rationale ? (' 模型原话：' + parsed.rationale) : ''))
  return buildProposal({
    trigger: trig.trigger,
    decision: finalDecision,
    selectedEventId: finalSelected,
    candidates: visible.map((c) => ({ eventId: c.eventId, score: c.score, margin: c.margin, evidence: c.evidence })),
    rationale: finalRationale,
    counterHypothesis: parsed.counterHypothesis,
    warnings,
    pool,
    modelIdentity,
  })
}

/**
 * memory_note 显式归属的**只读**复核。
 *
 * ★与 reviewPre 的差别：不产出 attach/create 决策倾向，只回答「这个显式归属看起来对吗」。
 *   not-applicable 用于 kind=note/user/plan 等非事件链场景，**不硬编事件**。
 *
 * @param {object} ports
 * @param {object} input { kind, eventId?, events, record, at }
 * @returns {Promise<object>} proposal
 */
export async function reviewExplicitPre(ports, input = {}) {
  const kind = String(input.kind || 'note')
  // 仅 handoff（事件链）或显式 eventId 才有意义
  if (kind !== 'handoff' && !input.eventId) {
    return buildProposal({
      trigger: TRIGGERS.EXPLICIT_REVIEW,
      decision: DECISIONS.NOT_APPLICABLE,
      rationale: 'kind=' + kind + ' 不属事件归属链（未传 eventId），无需复核',
      pool: { eligibleCount: 0, visibleCount: 0, omittedCount: 0, coverage: 'none' },
    })
  }
  // ★★task-29 阻断二（第 4 条）：**必须传入当前目标的复核上下文**。
  //   旧实现只把显式 ID 当 excludeEventId 排除掉，然后做「无目标」的通用判断
  //   ⇒ 模型看不到被复核的那个事件，复核结论无意义。
  //   现在：attrDecision=attach + attrEventId=当前目标 ⇒ reviewer 会走 focus 槽位保留 +
  //   「目标不可见」与「真否决」分流。
  return await reviewPre(ports, {
    record: input.record,
    events: input.events,
    attrDecision: input.eventId ? 'attach' : (input.attrDecision || undefined),
    attrReason: input.attrReason || 'explicit',
    attrEventId: input.eventId || null,
    focusEventId: input.eventId || null,
    // 注意：**不**把 eventId 当 excludeEventId —— 那是「排除自己」，会把复核目标排除掉
    excludeEventId: input.excludeEventId || null,
    dryRun: true,
    timeoutMs: input.timeoutMs,
    scoreOf: input.scoreOf,
  })
}

export default { decideTriggerPre, reviewPre, reviewExplicitPre, WEAK_ATTACH_REASONS }
