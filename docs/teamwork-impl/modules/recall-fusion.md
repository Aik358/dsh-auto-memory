
## recall-fusion

- **规模**：8,988 B / 171 行 / 4 个导出符号
- **交付形态**：**完整版**

### 职责

`recall-fusion-pre` —— **rank-space 融合**（P3，2026-09-09；`rrf_fusion_pre_v1`）。
**背景（旧 `fuseD6Pre` 的三宗罪，文件头逐字）**：
1. 分数随候选集漂移（归一化域 = 当前候选集）；
2. 矮子里拔将军（零极差臂全员 0.5）；
3. 候选 ≤1 时退化为常数 0.5（排序失效）。
本模块提供 **rank-space RRF**（**并存实现，不替换 `fuseD6Pre`**，由调用方按需选用）：
`score = Σ_arms 1/(k + rank/divisor)`，`k=60`（Hindsight issue #3956 实测安全值）。
**决策/排序解耦（验收 1，文件头逐字）**：*"融合分数**只用于排序**；"是否注入"的决策必须使用绝对分数（如 rank.scores 的稠密余弦）与校准阈值比较 —— rank-space 分数本身仍是候选集内的相对量，**不承担决策职责**。"*

### 数据流

```
多臂检索结果（各自带 rank）
   │
   ▼
rankFusionRRFPre(arms, opts)   L55   ★ 融合
   ├─ FUSION_RRF_K_PRE_V1 L19           k = 60
   ├─ FUSION_RRF_DIVISOR_PRE_V1 L22     divisor
   ├─ FUSION_LAYER_ORDER_PRE_V1 L35     层顺序（**确定性**）
   ├─ 每臂：score += 1/(k + rank/divisor)
   └─ 产出：融合分数（**只用于排序**）
        │
        ▼
   调用方：
     · 排序 ⇒ 用融合分数
     · 决策（是否注入）⇒ 必须用**绝对分数** + 校准阈值
   RECALL_FUSION_VERSION L38
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L19 | `FUSION_RRF_K_PRE_V1` | k = 60（实测安全值） |
| L22 | `FUSION_RRF_DIVISOR_PRE_V1` | divisor |
| L35 | `FUSION_LAYER_ORDER_PRE_V1` | 层顺序（确定性） |
| L38 | `RECALL_FUSION_VERSION` | `rrf_fusion_pre_v1` |
| L55 | `rankFusionRRFPre(arms, opts)` | **融合主函数** |

### 内部关键实现

**1. rank-space 而非 score-space（文件头）**

用 **rank**（名次）而不是 **score**（分数）做融合 ⇒ 天然免疫"各臂分数尺度不同"的问题。⇒ 这是对旧 `fuseD6Pre` 三宗罪的根本修复。

**2. k=60 是实测安全值（L19）**

注释引用 Hindsight issue #3956 ⇒ **参数有出处**，不是拍脑袋。

**3. 并存而非替换（文件头）**

*"本模块提供 **rank-space RRF** 并存实现（**不替换 `fuseD6Pre`**，由调用方按需选用）"* ⇒ **渐进替换**：新旧并存，调用方切换。⇒ 团队化新增融合臂时也应遵循同一模式（新增而非替换）。

**4. "决策与排序解耦"是最关键的产品纪律（文件头）**

rank-space 分数是**候选集内的相对量** ⇒ "最高分"仍然只是"相对最好"。若用它决定"是否注入"，则**候选集变化会改变决策结果**（同一条记忆，在候选少时会被注入、候选多时不会）。⇒ **决策必须用绝对分数**。

### 与团队化的关系

**判定：S3 派生重算（融合完全由各臂结果派生）+ S2（层顺序语义）。**

理由：融合是**运行时计算**（每次检索临时算），不可能也不应该同步。
**但**：团队化会**新增一条臂**（团队记忆召回），而新增臂会**改变所有记忆的相对名次** ⇒ 这正是"决策必须用绝对分数"这条纪律在团队场景下最重要的原因。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| RF1 | `FUSION_LAYER_ORDER_PRE_V1` L35 | 本地层序 | 团队层**追加到最后**（不插队） | 顺序纪律 |
| RF2 | `rankFusionRRFPre` L55 | 多臂 | 新增 team 臂；**k / divisor 不变**（口径一致） | 兼容 |
| RF3 | 决策路径 | 已被文件头约束 | 团队臂**不得**让决策改用相对分 | 纪律 |
| RF4 | 新增臂可观察性导出 | 无 | 列出实际参与融合的臂 | 新增导出 |
| RF5 | 臂缺失处理 | 无 | 团队臂不可用时**如实标记**，不静默降级 | 接线 |

#### 可直接落地的代码片段

**片段 1**：团队臂追加（**参数不变**）。位置：`recall-fusion.js:35`（`FUSION_LAYER_ORDER_PRE_V1` 定义处）。

```js
// ★ Teamwork：新增 team 臂 —— **追加在最后，不改既有层序**。
//
// 为什么参数（k / divisor）必须沿用 FUSION_RRF_K_PRE_V1 L19 与 L22：
//   k 决定"名次衰减的平缓程度"。若团队臂用不同的 k，
//   同一名次在不同臂上贡献不同 ⇒ 融合结果不再可比，
//   表现为"团队记忆总是排前面/后面"，且**看不出是参数问题**。
//   ⇒ 口径统一：所有臂共用同一 k 与 divisor（本仓"单一真源"纪律）。
export const FUSION_LAYER_ORDER_PRE_V1 = Object.freeze(['user', 'project', 'log', 'reflection', 'whiteboard', 'team'])
```

**片段 2**：融合臂可观察性（新增导出，放文件末尾）。**这是团队化最重要的可观测点。**

```js
/**
 * 描述实际参与融合的臂 —— **可观察性出口**。
 *
 * 为什么需要它：RRF 的融合分数是**相对量**，一旦某条臂静默失效
 * （如团队记忆还没同步完、Python 引擎不在），排序结果会变，
 * 但**没有任何报错**——用户只会觉得"检索好像不太对"。
 * 这与 degrade.js:33 记录的 R2 事故完全同型（"检索链上四条臂各自独立降级、
 * 各自静默 ⇒ 可同时失效而使用者只感到检索不太对"）。
 * ⇒ 每次融合都把"实际用了几条臂、每条贡献多少"暴露出来。
 *
 * @param {Array<{name:string, hits:Array}>} arms 传入融合的臂
 * @returns {{arms:string[], counts:object, degraded:string[], total:number}}
 */
export function describeFusionArmsPre(arms) {
  const list = Array.isArray(arms) ? arms : []
  const names = []
  const counts = Object.create(null)
  const degraded = []
  let total = 0
  for (const a of list) {
    if (!a) continue
    const n = String(a.name || 'unnamed')
    const hits = Array.isArray(a.hits) ? a.hits : []
    names.push(n)
    counts[n] = hits.length
    total += hits.length
    // 空臂 = 该臂没有贡献。团队臂为空通常意味着"索引还没同步完"，
    // 必须显式列出，否则会被误读成"团队里没有相关记忆"。
    if (hits.length === 0) degraded.push(n)
  }
  return { arms: names, counts: counts, degraded: degraded, total: total }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队臂用不同 k/divisor** | 为"团队更重要"调参 | 片段 1 强制共用；口径统一 |
| **臂静默失效** | 团队索引未同步完 | 片段 2 可观察性；进 degrade 台账 |
| **决策改用相对分** | 图省事用融合分判"是否注入" | 文件头明文禁止（验收 1）；回归须有"候选集变化不改决策"用例 |
| **层序插队** | 把 team 插到中间 | RF1 追加到最后 |
| **替换而非并存** | 直接改写 fuseD6Pre | 文件头纪律：并存、由调用方选用 |

**既有测试/守卫**：`recall-fusion` 的 RRF 排序用例、确定性用例、k 值用例。**"决策与排序解耦"很可能被守卫断言**（验收 1 是文件头明文）。
