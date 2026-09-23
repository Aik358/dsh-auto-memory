/**
 * recall-fusion-pre —— rank-space 融合(P3, 2026-09-09; rrf_fusion_pre_v1)。
 *
 * 背景:旧 fuseD6Pre(semantic-js.js)为 minmax 加权融合,存在三宗罪:
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

/**
 * ★M2.5b：层次优先级序（与注入侧一致）。
 *
 * 出处：`tier-layer-inject.js:58 TIER_LAYER_ORDER_PRE_V1` —— **必须与之逐字相同**。
 *
 * 为什么不直接 import：本模块头注释承诺「**零依赖**、纯函数、零 IO」，
 *   引入跨模块依赖会破坏该契约（且 tier-layer-inject 自身还有依赖链）。
 * 为了既不破契约、又不产生「双源漂移」，此处**本地复刻**并由测试**断言两者相等**
 *   （见 smoke-test-m25b-layer-arm-pre.mjs 的「常量一致性」断言）——
 *   任何一侧改动而另一侧未同步，测试立刻红。
 */
export const FUSION_LAYER_ORDER_PRE_V1 = Object.freeze(['project', 'whiteboard', 'user', 'reflection', 'log'])

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
  // ★M2.5b：新增 `strMode` —— 层次臂的值是**字符串**，默认的「只收有限数」过滤会把它全部滤掉
  //   （实测踩坑：layer 臂曾因此静默恒为 0，套件 [3] 抓到）。strMode=true 时接受非空字符串。
  const rankArm = (key, cmp, strMode) => {
    const entries = []
    for (const p of list) {
      const v = p[key]
      if (strMode) {
        if (typeof v === 'string' && v) entries.push({ memoryId: p.memoryId, v })
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        entries.push({ memoryId: p.memoryId, v })
      }
    }
    const tie = (a, b) => (a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0)
    entries.sort(cmp || ((a, b) => (b.v !== a.v ? b.v - a.v : tie(a, b))))
    const ranks = new Map()
    entries.forEach((e, i) => ranks.set(e.memoryId, i + 1))
    return ranks
  }

  /**
   * ★M2.5b：层次臂的**序** = 注入侧的层次优先级序（二者必须一致）。
   * 出处：`tier-layer-inject.js:58 TIER_LAYER_ORDER_PRE_V1`
   *       = ['project','whiteboard','user','reflection','log']。
   * 语义：**rank 1 = 最高优先级层**。未列出的层（含新增层）排在已知层之后，按名称升序（确定性）。
   * 注意：这里只定义**偏好顺序**，不定义权重；权重问题走 rank-space（见下），
   *       需要调权重时应改分档/序，而不是给分数乘系数（Hindsight #3956）。
   */
  const layerRankOf = (name) => {
    const i = FUSION_LAYER_ORDER_PRE_V1.indexOf(name)
    return i >= 0 ? i : FUSION_LAYER_ORDER_PRE_V1.length
  }
  const cmpLayer = (a, b) => {
    const la = layerRankOf(String(a.v))
    const lb = layerRankOf(String(b.v))
    if (la !== lb) return la - lb
    const sa = String(a.v), sb = String(b.v)
    if (sa !== sb) return sa < sb ? -1 : 1
    return a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : 0
  }

  const denseRanks = rankArm('dense')
  const lexRanks = rankArm('lex')

  // ★M2.5b 层次臂（2026-09-18）：可选第四臂。layer 为层次名（'project'/'user'/'log'/
  // 'reflection'/'whiteboard'）或缺失。与时间臂同一条**退化安全**纪律：
  //   所有 pair 均缺 layer **或 layer 全相等** → 不构建 layer 秩，行为与三臂版**逐字节一致**
  //   （fused 不加 0 项、输出对象不含新字段）。
  // 为什么需要它（实测不一致，2026-09-18）：Tier-0 **注入**侧有层次优先级
  //   （tier-layer-inject.js:58 TIER_LAYER_ORDER_PRE_V1 = ['project','whiteboard','user','reflection','log']
  //    + tier0-catalog.js:419-455 的 caps/floors），而 **排序**侧对层次完全无感
  //   ⇒ 结论层（project）与流水层（log）在融合里**平等竞争**，笔记层常被日志挤掉。
  // rank-space（Hindsight #3956 禁止 score-space 加权）：层次只贡献**秩**，不乘分。
  const layers = []
  for (const p of list) { if (typeof p.layer === 'string' && p.layer) layers.push(p.layer) }
  const hasLayer = layers.length > 0 && layers.some((v) => v !== layers[0])
  const layerRanks = hasLayer ? rankArm('layer', cmpLayer, true) : null

  // 时间臂(P12 后新增,2026-09-09):可选第三臂。temp 为 1(命中时间范围)/0(未命中)/
  // 缺失(无时间臂或非日期来源)。所有 pair 均缺 temp **或 temp 全相等**(全 0/全 1)→
  // 不构建 temp 秩,行为与两臂版逐字节一致(fused 不加 0 项、输出对象不含新字段)——
  // 全 0 = 查询有时间表达但无候选命中,必须零扰动。rank-space,禁止 score-space 加权(#3956)。
  const temps = []
  for (const p of list) { if (typeof p.temp === 'number' && Number.isFinite(p.temp)) temps.push(p.temp) }
  const hasTemp = temps.length > 0 && temps.some((v) => v !== temps[0])
  const tempRanks = hasTemp ? rankArm('temp') : null

  return list
    .map((p) => {
      const rd = denseRanks.get(p.memoryId)
      const rl = lexRanks.get(p.memoryId)
      const rrfDense = rd === undefined ? 0 : 1 / (k + rd / divisor)
      const rrfLex = rl === undefined ? 0 : 1 / (k + rl / divisor)
      const base = {
        memoryId: p.memoryId,
        fused: rrfDense + rrfLex,
        rrfDense,
        rrfLex,
        denseRaw: typeof p.dense === 'number' && Number.isFinite(p.dense) ? p.dense : null,
        lexRaw: typeof p.lex === 'number' && Number.isFinite(p.lex) ? p.lex : null,
        rankDense: rd === undefined ? null : rd,
        rankLex: rl === undefined ? null : rl,
      }
      // 时间臂与层次臂**互不依赖**：各自独立判 has*，可单独生效、可同时生效。
      let out = base
      if (hasTemp) {
        const rt = tempRanks.get(p.memoryId)
        const rrfTemp = rt === undefined ? 0 : 1 / (k + rt / divisor)
        out = {
          ...out,
          fused: out.fused + rrfTemp,
          rrfTemp,
          tempRaw: typeof p.temp === 'number' && Number.isFinite(p.temp) ? p.temp : null,
          rankTemp: rt === undefined ? null : rt,
        }
      }
      if (hasLayer) {
        const rlay = layerRanks.get(p.memoryId)
        const rrfLayer = rlay === undefined ? 0 : 1 / (k + rlay / divisor)
        out = {
          ...out,
          fused: out.fused + rrfLayer,
          rrfLayer,
          layerRaw: typeof p.layer === 'string' && p.layer ? p.layer : null,
          rankLayer: rlay === undefined ? null : rlay,
        }
      }
      return out
    })
    .sort((x, y) => (y.fused !== x.fused ? y.fused - x.fused : (x.memoryId < y.memoryId ? -1 : x.memoryId > y.memoryId ? 1 : 0)))
}
