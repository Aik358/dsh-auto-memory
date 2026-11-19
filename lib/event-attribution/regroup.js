/**
 * regroup.js —— 历史账本的**零写提案**适配：把现有 R1/R2/R3 接进本协议的 proposal 形状。
 *
 * 职责边界：
 *   · 把 R1（机械建议）/ R2（prompt）/ R3（严格解析）的产物映射成 event-attribution/v1 proposal
 *   · **只产提案**：不调 apply、不签发确认令牌、不写盘
 *
 * 禁止：调用 applyRegroupPre / writeCuratedEventsPre / applyRegroup；
 *       修改 engine._curateToken；写任何文件。
 *
 * ★本模块不可替代 R1/R2/R3 本身 —— 它们仍是唯一实现。
 *   本模块只做「把它们的输出投影成本协议 DTO」这一件事，不改它们的判据。
 */

import { DECISIONS, TRIGGERS, WARN_CODES, buildProposal, EVENT_ATTRIBUTION_PROFILE_V1 } from './contract.js'
import { callHostModelPre } from './host-model.js'
import { parseAiBatchPre } from '../event-regroup-propose.js'

/** 禁止调用的写侧方法名（供测试断言「调用 0 次」用）。 */
export const FORBIDDEN_APPLY_METHODS = Object.freeze([
  'applyRegroupPre', 'writeCuratedEventsPre', 'applyRegroup', 'curateUnarchivedPre',
])

/**
 * 把 R1 的机械建议映射成 proposal 候选。
 *
 * @param {Array<object>} groups R1 的 groupIntoCandidateEventsPre 输出
 * @returns {Array<object>} candidates（eventId 用 candidateId，score 用成员数归一）
 */
export function mapMechanicalGroupsPre(groups) {
  const arr = Array.isArray(groups) ? groups : []
  const maxN = arr.reduce((m, g) => Math.max(m, Number((g && g.memberCount) || 0)), 0) || 1
  return arr.map((g) => ({
    eventId: String((g && g.candidateId) || ''),
    score: Number((g && g.memberCount) || 0) / maxN,
    margin: null,
    evidence: [
      'members: ' + Number((g && g.memberCount) || 0),
      'goalKey: ' + String((g && g.goalKey) || '').slice(0, 120),
    ],
  })).filter((c) => c.eventId)
}

/**
 * 历史账本零写提案。
 *
 * @param {object} ports { modelPort?, clock? }
 * @param {object} input {
 *   groups:Array,        // R1 输出（机械建议）
 *   batchLedgerNames:Array<string>,  // 本批账本名（守恒基准）
 *   prompt:string,       // R2 产出的真实 AI 输入
 *   dryRun?:boolean,     // true ⇒ 只回 prompt 预览，不启动子代理
 *   timeoutMs?:number
 * }
 * @returns {Promise<object>} proposal
 */
export async function proposeRegroupPre(ports, input = {}) {
  const prof = EVENT_ATTRIBUTION_PROFILE_V1
  const groups = Array.isArray(input.groups) ? input.groups : []
  const names = Array.isArray(input.batchLedgerNames) ? input.batchLedgerNames : []
  const candidates = mapMechanicalGroupsPre(groups)
  const warnings = []
  const poolBase = {
    eligibleCount: candidates.length,
    visibleCount: candidates.length,
    omittedCount: 0,
    coverage: candidates.length ? 'complete' : 'none',
  }
  // dryRun：**只回 prompt 预览，不启动子代理**（任务书 §8.2）
  if (input.dryRun === true) {
    return buildProposal({
      trigger: TRIGGERS.HISTORICAL_REGROUP,
      decision: DECISIONS.NOT_APPLICABLE,
      candidates,
      rationale: 'dryRun：仅预览 prompt（' + String(input.prompt || '').length + ' 字符），未启动子代理、未写盘',
      warnings,
      pool: poolBase,
    })
  }
  if (!String(input.prompt || '').trim()) {
    warnings.push({ code: WARN_CODES.MODEL_UNAVAILABLE, message: '未提供 R2 prompt', eventIds: [] })
    return buildProposal({
      trigger: TRIGGERS.HISTORICAL_REGROUP,
      decision: DECISIONS.UNAVAILABLE,
      candidates, rationale: '缺少 prompt', warnings, pool: poolBase,
    })
  }
  const modelRes = await callHostModelPre(ports, String(input.prompt), {
    timeoutMs: input.timeoutMs || prof.timeoutMs,
    label: prof.hostJobLabel,
  })
  if (!modelRes.ok) {
    warnings.push({ code: WARN_CODES.MODEL_UNAVAILABLE, message: modelRes.code + ': ' + String(modelRes.error || ''), eventIds: [] })
    return buildProposal({
      trigger: TRIGGERS.HISTORICAL_REGROUP,
      decision: DECISIONS.UNAVAILABLE,
      candidates, rationale: '模型不可用，保留机械建议', warnings, pool: poolBase,
    })
  }
  // 用 R3 的**严格**校验（fail-closed：守恒/命名/批内任一项不合格即整批拒绝）
  const parsed = parseAiBatchPre(modelRes.text, names)
  if (!parsed.ok) {
    warnings.push({ code: WARN_CODES.MODEL_UNPARSEABLE, message: String(parsed.code) + ': ' + String(parsed.error || ''), eventIds: [] })
    return buildProposal({
      trigger: TRIGGERS.HISTORICAL_REGROUP,
      decision: DECISIONS.UNAVAILABLE,
      candidates, rationale: 'AI 提案未过严格校验（fail-closed），保留机械建议', warnings, pool: poolBase,
    })
  }
  // AI 提案通过 ⇒ 用其事件作为候选（eventId 用稳定派生键，不冒充真实事件 ID）
  const aiCands = parsed.events.map((e, i) => ({
    eventId: 'ai-group-' + (i + 1),
    score: null,
    margin: null,
    evidence: ['name: ' + String(e.name).slice(0, 80), 'members: ' + e.members.length],
  }))
  return buildProposal({
    trigger: TRIGGERS.HISTORICAL_REGROUP,
    decision: DECISIONS.AMBIGUOUS,
    candidates: aiCands.length ? aiCands : candidates,
    rationale: 'AI 归并提案通过严格校验：' + parsed.events.length + ' 组 / ' + names.length + ' 篇账本守恒通过（**仅提案，未写盘**）',
    counterHypothesis: '机械建议与 AI 提案可能不一致，人审时需逐组核对',
    warnings,
    pool: { eligibleCount: aiCands.length + candidates.length, visibleCount: aiCands.length + candidates.length, omittedCount: 0, coverage: 'complete' },
  })
}

export default { FORBIDDEN_APPLY_METHODS, mapMechanicalGroupsPre, proposeRegroupPre }
