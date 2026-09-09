/**
 * memory-importance-pre —— evidence → importance 纯核心(M8-2, 2026-09-09; memory_importance_pre_v1)。
 *
 * 背景(M8-2 任务书):六类证据 seen/read/cite/reuse/success/correction 已由 M5 写入
 * (lib/context-bridge-pre.js:45 枚举),消费侧聚合为 fact-store-pre.js:341 evidenceFor(memoryId)
 * → {memoryId, total, distinctSessions, seen, read, cite, reuse, success, correction},
 * 但此前只用于 M-04 技能晋升(procedure-store-pre.js promote),从未接入记忆检索排序。
 *
 * 口径纪律(禁止项):correctionRate **逐字复用** procedure-store-pre.js:268-269 的口径——
 *   total = seen+read+cite+reuse+success+correction
 *   correctionRate = total > 0 ? correction / total : 0
 * 不另立纠正口径。
 *
 * 公式(确定性,∈[0,1]):
 *   neutral(无任何证据)        → importance = 0.5(中性,不置顶不垫底)
 *   pos = 0.5×min(1, distinctSessions/3) + 0.5×min(1, (success+reuse)/4)   // 正向:跨会话多样性 + 成功/复用饱和
 *   importance = clamp01(0.5 + 0.3×pos − 0.5×correctionRate)               // correction 负向,权重最大
 *   值域:正向满格 → 0.8;correctionRate=1 → 0;cite/seen/read 仅稀释 correctionRate(与 promote 口径一致)。
 *
 * 边界:纯函数、零依赖、零 IO;非法输入 fail closed(按全零处理 → 中性);同输入逐字节确定。
 * 本段(2026-09-09)只交付纯函数与测试,不接线——接线点检索结论:现役融合 fuseD6Pre 位于
 * _jsDecide 的 fv2 决策 margin(非检索排序),P3 rankFusionRRFPre 未接线,shadow 管线 evidence
 * 数据不可达;待 P3 RRF 实际接线时作为加权因子之一落点(importance 禁止作为唯一排序依据)。
 */

export const MEMORY_IMPORTANCE_VERSION = 'memory_importance_pre_v1'

/** 中性值:无 evidence 记录时返回,保证不因此置顶或垫底。 */
export const IMPORTANCE_NEUTRAL_PRE_V1 = 0.5

/** 权重常数(冻结;调整即新版本)。 */
export const IMPORTANCE_WEIGHTS_PRE_V1 = Object.freeze({
  diversityDivisor: 3, // distinctSessions 饱和点:≥3 个不同会话记满
  successReuseDivisor: 4, // success+reuse 饱和点:合计 ≥4 次记满
  posGain: 0.3, // 正向增益上限(0.5 + 0.3 = 0.8)
  negGain: 0.5, // correctionRate 惩罚权重(负向,口径复用 promote)
})

const num0 = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
const clamp01 = (x) => Math.min(1, Math.max(0, x))

/**
 * evidence 聚合 → importance ∈ [0,1]。
 * @param {{distinctSessions?:number, seen?:number, read?:number, cite?:number,
 *          reuse?:number, success?:number, correction?:number}} agg evidenceFor() 形状的聚合(缺字段按 0)。
 * @returns {{importance:number, correctionRate:number, neutral:boolean, total:number}}
 */
export function computeImportancePre(agg) {
  const a = agg && typeof agg === 'object' ? agg : {}
  const seen = num0(a.seen)
  const read = num0(a.read)
  const cite = num0(a.cite)
  const reuse = num0(a.reuse)
  const success = num0(a.success)
  const correction = num0(a.correction)
  const distinctSessions = num0(a.distinctSessions)
  const total = seen + read + cite + reuse + success + correction
  // 无任何证据 → 中性(0.5):既不置顶也不垫底(验收 3)
  if (total === 0 && distinctSessions === 0) {
    return { importance: IMPORTANCE_NEUTRAL_PRE_V1, correctionRate: 0, neutral: true, total: 0 }
  }
  // correctionRate 口径与 procedure-store-pre.js:268-269 逐字一致(禁止另立)
  const correctionRate = total > 0 ? correction / total : 0
  const w = IMPORTANCE_WEIGHTS_PRE_V1
  const diversity = Math.min(1, distinctSessions / w.diversityDivisor)
  const successReuse = Math.min(1, (success + reuse) / w.successReuseDivisor)
  const pos = 0.5 * diversity + 0.5 * successReuse
  const importance = clamp01(IMPORTANCE_NEUTRAL_PRE_V1 + w.posGain * pos - w.negGain * correctionRate)
  return { importance, correctionRate, neutral: false, total }
}
