/**
 * recall-fusion-pre —— rank-space 融合(P3, 2026-09-09; rrf_fusion_pre_v1)。
 *
 * 背景:旧 fuseD6Pre(semantic-js-pre.js)为 minmax 加权融合,存在三宗罪:
 *   ① 分数随候选集漂移(归一化域=当前候选集) ② 矮子里拔将军(零极差臂全员 0.5)
 *   ③ 候选 ≤1 时退化为常数 0.5(排序失效)。
 * 本模块提供 **rank-space RRF** 并存实现(不替换 fuseD6Pre,由调用方按需选用):
 *   score = Σ_arms 1/(k + rank/divisor),k=60(Hindsight issue #3956 实测安全值)。
 *
 * 决策/排序解耦(验收 1):融合分数**只用于排序**;"是否注入"的决策必须使用
 * 绝对分数(如 rank.scores 的稠密余弦)与校准阈值比较 —— rank-space 分数本身
 * 仍是候选集内的相对量,不承担决策职责。
 *
 * 边界:纯函数、零依赖、零 IO;非法输入 fail closed 返回空数组;确定性
 * (同输入同输出;同分按 memoryId 升序)。无 score-space 加权(禁止项);无父分数传播。
 */

/** RRF 常数 k(Hindsight issue #3956 实测: k=60 时动态范围安全,加权会退化排序)。 */
export const FUSION_RRF_K_PRE_V1 = 60

/** rank 尺度常数:rank/divisor 把秩归到 (0,1] 量级(默认与 k 同值)。 */
export const FUSION_RRF_DIVISOR_PRE_V1 = 60

/** 版本标识。 */
export const RECALL_FUSION_VERSION = 'rrf_fusion_pre_v1'

/**
 * rank-space RRF 融合。
 *
 * @param {Array<{memoryId:string, dense?:number|null, lex?:number|null}>} pairs
 *   与 fuseD6Pre 同形:两臂分数可缺失(null/undefined/非有限数视为该臂缺席)。
 * @param {{k?:number, divisor?:number}} [opts] 可覆盖 k 与 divisor(默认均 60)。
 * @returns {Array<{memoryId:string, fused:number, rrfDense:number, rrfLex:number,
 *   denseRaw:number|null, lexRaw:number|null, rankDense:number|null, rankLex:number|null}>}
 *   按 fused 降序、平局 memoryId 升序(确定性)。原始分数逐条保留供审计。
 *
 * 性质:
 *   - 候选 <3(含单候选)不退化:每条 fused = 1/(k + rank/divisor),良定义非常数
 *   - 候选集增删只平移秩,不改既有条目的相对序(rank-space 关键性质,minmax 不具备)
 *   - 缺失臂贡献 0(不是 minmax 的 0.5)
 */
export function rankFusionRRFPre(pairs, opts = {}) {
  const k = Number.isFinite(opts.k) && opts.k >= 0 ? opts.k : FUSION_RRF_K_PRE_V1
  const divisor = Number.isFinite(opts.divisor) && opts.divisor > 0 ? opts.divisor : FUSION_RRF_DIVISOR_PRE_V1
  const list = Array.isArray(pairs) ? pairs.filter((p) => p && typeof p.memoryId === 'string') : []

  // 每臂独立排名:非空有限值按分数降序(平局 memoryId 升序)取秩(1 起);缺席者无秩。
  const rankArm = (key) => {
    const entries = []
    for (const p of list) {
      const v = p[key]
      if (typeof v === 'number' && Number.isFinite(v)) entries.push({ memoryId: p.memoryId, v })
    }
    entries.sort((a, b) => (b.v !== a.v ? b.v - a.v : (a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0)))
    const ranks = new Map()
    entries.forEach((e, i) => ranks.set(e.memoryId, i + 1))
    return ranks
  }
  const denseRanks = rankArm('dense')
  const lexRanks = rankArm('lex')

  return list
    .map((p) => {
      const rd = denseRanks.get(p.memoryId)
      const rl = lexRanks.get(p.memoryId)
      const rrfDense = rd === undefined ? 0 : 1 / (k + rd / divisor)
      const rrfLex = rl === undefined ? 0 : 1 / (k + rl / divisor)
      return {
        memoryId: p.memoryId,
        fused: rrfDense + rrfLex,
        rrfDense,
        rrfLex,
        denseRaw: typeof p.dense === 'number' && Number.isFinite(p.dense) ? p.dense : null,
        lexRaw: typeof p.lex === 'number' && Number.isFinite(p.lex) ? p.lex : null,
        rankDense: rd === undefined ? null : rd,
        rankLex: rl === undefined ? null : rl,
      }
    })
    .sort((x, y) => (y.fused !== x.fused ? y.fused - x.fused : (x.memoryId < y.memoryId ? -1 : x.memoryId > y.memoryId ? 1 : 0)))
}
