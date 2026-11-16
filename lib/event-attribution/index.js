/**
 * index.js —— event-attribution 的**唯一**公共 facade / 冻结 API 形状。
 *
 * 分层（每层单一职责，禁止混写）：
 *   contract       形状与不变量（无 I/O）
 *   candidate-pool 候选与证据（无判定、无写）
 *   prompt         输入规范化与 prompt（确定性）
 *   parser         严格 JSON + 四态 + ID 白名单（fail-closed）
 *   reviewer       触发判定与编排
 *   receipt        proposal → 文本提醒（不改写入结果）
 *   host-model     宿主 runSubagent 适配（不新建网络通道）
 *   regroup        历史零写提案适配（不接 apply）
 *
 * ★分层纪律：领域核心**不依赖** lib/index.js、不依赖文件系统、不依赖宿主私有字段。
 *   全部外部能力经 ports 依赖注入（modelPort / clock）。
 *
 * ★调用方（lib/index.js）只做参数适配 + 调本 facade + 追加文本回执，
 *   不得自行复制协议、解析、候选或模型判定逻辑。
 */

import {
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
} from './contract.js'
import { isEligiblePre, evidenceOfPre, buildCandidatePoolPre } from './candidate-pool.js'
import { normalizeRecordPre, buildPromptPre } from './prompt.js'
import { extractJsonPre, parseModelOutputPre } from './parser.js'
import { decideTriggerPre, reviewPre, reviewExplicitPre } from './reviewer.js'
import { renderReceiptPre, appendReceiptPre } from './receipt.js'
import { MODEL_CODES, callHostModelPre, createHostModelPort } from './host-model.js'
import { FORBIDDEN_APPLY_METHODS, mapMechanicalGroupsPre, proposeRegroupPre } from './regroup.js'

/**
 * 创建归属服务实例。
 *
 * @param {object} [ports]
 * @param {{ call:(prompt:string, opts:object)=>Promise<string> }} [ports.modelPort] 模型端口
 * @param {()=>number} [ports.clock] 时钟端口（注入后才能确定性测试）
 * @returns {{
 *   review: Function,
 *   reviewExplicit: Function,
 *   proposeRegroup: Function,
 *   renderReceipt: Function,
 *   appendReceipt: Function,
 *   profile: object
 * }}
 */
export function createEventAttributionService(ports = {}) {
  const P = (ports && typeof ports === 'object') ? ports : {}
  return {
    /** 主路径：memory_log 写前复核。返回 proposal（永不抛错，失败归 unavailable）。 */
    async review(input = {}) {
      try {
        return await reviewPre(P, input)
      } catch (e) {
        // ★不得 fail-open：任何异常都归 unavailable，绝不当成 create-new
        return buildProposal({
          trigger: TRIGGERS.UNASSIGNED,
          decision: DECISIONS.UNAVAILABLE,
          rationale: 'review 内部异常：' + String((e && e.message) || e).slice(0, 200),
          warnings: [{ code: WARN_CODES.MODEL_UNAVAILABLE, message: String((e && e.message) || e).slice(0, 200), eventIds: [] }],
          pool: { eligibleCount: 0, visibleCount: 0, omittedCount: 0, coverage: 'none' },
        })
      }
    },
    /** memory_note 显式归属的只读复核。 */
    async reviewExplicit(input = {}) {
      try {
        return await reviewExplicitPre(P, input)
      } catch (e) {
        return buildProposal({
          trigger: TRIGGERS.EXPLICIT_REVIEW,
          decision: DECISIONS.UNAVAILABLE,
          rationale: 'reviewExplicit 内部异常：' + String((e && e.message) || e).slice(0, 200),
          warnings: [{ code: WARN_CODES.MODEL_UNAVAILABLE, message: String((e && e.message) || e).slice(0, 200), eventIds: [] }],
          pool: { eligibleCount: 0, visibleCount: 0, omittedCount: 0, coverage: 'none' },
        })
      }
    },
    /** 历史账本零写提案。 */
    async proposeRegroup(input = {}) {
      try {
        return await proposeRegroupPre(P, input)
      } catch (e) {
        return buildProposal({
          trigger: TRIGGERS.HISTORICAL_REGROUP,
          decision: DECISIONS.UNAVAILABLE,
          rationale: 'proposeRegroup 内部异常：' + String((e && e.message) || e).slice(0, 200),
          warnings: [{ code: WARN_CODES.MODEL_UNAVAILABLE, message: String((e && e.message) || e).slice(0, 200), eventIds: [] }],
          pool: { eligibleCount: 0, visibleCount: 0, omittedCount: 0, coverage: 'none' },
        })
      }
    },
    /** proposal → 提醒文本（空串表示无需追加）。 */
    renderReceipt(proposal, ctx) {
      try {
        return renderReceiptPre(proposal, ctx || {})
      } catch (_) {
        return ''
      }
    },
    /** 原文本 + 提醒。原文本逐字保留在前。 */
    appendReceipt(originalText, proposal, ctx) {
      const t = this.renderReceipt(proposal, ctx)
      return appendReceiptPre(originalText, t)
    },
    /** 冻结 profile（只读快照）。 */
    profile: EVENT_ATTRIBUTION_PROFILE_V1,
  }
}

/** 公共导出快照（供测试断言形状冻结）。 */
export const PUBLIC_API = Object.freeze({
  createEventAttributionService: 'function',
  SCHEMA_VERSION: 'string',
  STATUS_PROPOSAL_ONLY: 'string',
  TRIGGERS: 'object',
  DECISIONS: 'object',
  COVERAGES: 'object',
  WARN_CODES: 'object',
  HOST_ROUTE: 'string',
  HOST_JOB_LABEL: 'string',
  EVENT_ATTRIBUTION_PROFILE_V1: 'object',
  FORBIDDEN_APPLY_METHODS: 'object',
  buildProposal: 'function',
  validateProposalInvariants: 'function',
  isEligiblePre: 'function',
  evidenceOfPre: 'function',
  buildCandidatePoolPre: 'function',
  normalizeRecordPre: 'function',
  buildPromptPre: 'function',
  extractJsonPre: 'function',
  parseModelOutputPre: 'function',
  decideTriggerPre: 'function',
  renderReceiptPre: 'function',
  appendReceiptPre: 'function',
  callHostModelPre: 'function',
  createHostModelPort: 'function',
  mapMechanicalGroupsPre: 'function',
  MODEL_CODES: 'object',
})

export {
  SCHEMA_VERSION,
  STATUS_PROPOSAL_ONLY,
  TRIGGERS,
  DECISIONS,
  COVERAGES,
  WARN_CODES,
  HOST_ROUTE,
  HOST_JOB_LABEL,
  EVENT_ATTRIBUTION_PROFILE_V1,
  FORBIDDEN_APPLY_METHODS,
  buildProposal,
  validateProposalInvariants,
  isEligiblePre,
  evidenceOfPre,
  buildCandidatePoolPre,
  normalizeRecordPre,
  buildPromptPre,
  extractJsonPre,
  parseModelOutputPre,
  decideTriggerPre,
  renderReceiptPre,
  appendReceiptPre,
  callHostModelPre,
  createHostModelPort,
  mapMechanicalGroupsPre,
  MODEL_CODES,
}

export default {
  createEventAttributionService,
  PUBLIC_API,
  SCHEMA_VERSION,
  EVENT_ATTRIBUTION_PROFILE_V1,
}
