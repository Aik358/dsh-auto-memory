
## tier-layer-inject

- **规模**：34,432 B / 651 行 / 19 个导出符号
- **交付形态**：**完整版**

### 职责

**三层注入装配**（`tier_layer_inject_pre_v1`）—— 契约 C5。职责 = **把三层按闸门装成一段可注入文本**：
- **Tier-0 常驻目录**（每轮都进，不依赖命中）：调 `tier0-catalog.js` 的目录生成器，≤ `B0`=800 token；
- **闸门下探 Tier-1**：仅当本轮有语义命中（或问题含深挖语义）时，给 top-`K`=8 条 L0 摘要，每条 ≤ `L1`=140 字符；**未命中只给目录层**（省 token 的关键）；
- **按需下探 Tier-2**：问题带"要证据"语义（原文/逐字/行号/命令/复现）时，给命中块原文。

### 数据流

```
输入：命中列表 + 查询文本 + 降级信息
   │
   ▼
filterCurrentHitsPre(hits)      L96    过滤（status 非 current 的）
   ├─ isCurrentStatusPre(...)   L115
   └─ filterExcludedSourcesPre(hits, pats)  L137   （来源排除，含目录模式 isDirPat L145）
        │
        ▼
selectReusableTierHitsPre(...)  L236   ← 跨轮复用判定
   TIER_HITS_REUSE_REASONS_PRE_V1 L192 / describeReuseReasonPre L206
        │
        ▼
decideTierGatePre(...)  L394   ★ 闸门：本轮下探到 Tier-1 还是 Tier-2
        │
        ├─ buildTier1SectionPre(...)  L426   每条 ≤ L1=140 字符
        └─ buildTier2SectionPre(...)  L456   命中块原文
        │
        ▼
composeTieredInjectionPre(...)  L497   ★ 总装配
   ├─ collectDegradationsPre(...)  L330
   ├─ tierLayerAccountLinePre(...) L312   账本行
   └─ TIER_BUDGET_PRE_V1 L39 / TIER_MARK_PRE_V1 L50 / TIER_LAYER_ORDER_PRE_V1 L58
        │
        ▼
estimateTierTokensPre(...)  L646    token 估算
   SKIP_REASON_TEXT_PRE_V1 L288 / describeReasonPre L301
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L36 | `TIER_INJECT_VERSION` | 版本常量 |
| L39 | `TIER_BUDGET_PRE_V1` | 预算（B0 / K / L1） |
| L50 | `TIER_MARK_PRE_V1` | 层级标记 |
| L58 | `TIER_LAYER_ORDER_PRE_V1` | 层顺序 |
| L96 | `filterCurrentHitsPre(hits)` | 过滤非 current |
| L115 | `isCurrentStatusPre(status)` | 状态判据 |
| L137 | `filterExcludedSourcesPre(hits, pats)` | 来源排除 |
| L192/206 | 复用原因枚举与文案 | 跨轮复用 |
| L236 | `selectReusableTierHitsPre(...)` | 选出可复用命中 |
| L288/301 | 跳过原因枚举与文案 | 诊断 |
| L312 | `tierLayerAccountLinePre(...)` | 账本行 |
| L330 | `collectDegradationsPre(...)` | 收集降级说明 |
| L394 | `decideTierGatePre(...)` | **闸门决策** |
| L426 | `buildTier1SectionPre(...)` | Tier-1 段 |
| L456 | `buildTier2SectionPre(...)` | Tier-2 段 |
| L497 | `composeTieredInjectionPre(...)` | **总装配** |
| L646 | `estimateTierTokensPre(...)` | token 估算 |

### 内部关键实现

**1. 闸门是"省 token 的关键"（文件头）**

未命中时**只给目录层** ⇒ 绝大多数轮次只花 Tier-0 的 800 token。这是三层架构的成本基础。

**2. 状态过滤先于装配 L96 / L115**

`filterCurrentHitsPre` 在装配前剔除状态非 current 的命中 ⇒ 与用户裁定"superseded 返回但标记"**不矛盾**：标记发生在**渲染层**（附 supersededBy 指针），过滤发生在**下探准入层**（不值得为一条作废结论花 Tier-1 预算）【推断，需核对 `isCurrentStatusPre` 的实际语义】。

**3. 来源排除 L137-145**

`filterExcludedSourcesPre` 支持**目录级模式**（`isDirPat`）⇒ 可按目录整体排除（如排除临时工作区）。

**4. 跨轮复用 L236**

`selectReusableTierHitsPre` + `TIER_HITS_REUSE_REASONS_PRE_V1`：同一批命中在多轮之间可复用，避免重复计算。**这是"同一份内容被反复注入"的抑制机制**。

**5. 降级可见 L330**

`collectDegradationsPre` 把降级说明**收集起来统一装配** —— 注意 `memory-envelope.js` 指出的缺陷①正是"降级说明在裁剪之后才追加，导致超长"。本模块的收集点必须与长度门协同。

### 关联行号索引

- lib/tier-layer-inject.js:394
- lib/tier-layer-inject.js:426
- lib/tier-layer-inject.js:497

### 与团队化的关系

**判定：S3 派生重算（装配结果）+ S2 共享（团队记忆的命中来源）。**

理由：装配结果是每轮的运行时产物，不可能同步。
**但团队化会给这个模块带来最大压力**：团队共享记忆意味着**命中集合变大**、多来源、多状态。⇒ Tier-1 的 top-K=8 与 L1=140 字符预算在团队场景下**很可能不够**，需要独立的团队预算（与 `memory-envelope` 的 team 桶协同）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| T1 | `decideTierGatePre` L394 | 单一闸门 | 增加"团队记忆是否单独占 Tier-1 名额"的判定 | 闸门逻辑扩展 |
| T2 | `buildTier1SectionPre` L426 | top-K=8 全局 | 支持**分段配额**：本机 K1 + 团队 K2 | 渲染分段 |
| T3 | `filterExcludedSourcesPre` L137 | 本地来源模式 | 支持按 origin 排除（如"只看本机"） | 新增模式 |
| T4 | `composeTieredInjectionPre` L497 | 单预算 | 团队预算独立（不能挤本机） | 新增配置 |
| T5 | 团队来源标注 | 无 | 每条命中标注来源（本机 / 团队成员） | 渲染增字段 |

#### 可直接落地的代码片段

**片段 1**：分段配额渲染（扩展 `buildTier1SectionPre`）。位置：`tier-layer-inject.js:426`。

```js
/**
 * Tier-1 段：本机命中与团队命中**分段配额**，互不挤占。
 *
 * 为什么必须分段而不是"统一按分数排 top-K"：
 *   团队记忆天然比本机记忆多（N 个成员 vs 1 个），统一排序会让团队记忆**淹没**本机记忆 ——
 *   而本机记忆才是"当前这个人正在做的事"。⇒ 分段配额保证本机记忆永远有位置。
 *   这与 memory-envelope 的 team 桶独立预算是**同一设计原则**。
 *
 * @param {Array} hits 全部命中（每项可带 origin: 'local' | 'team'）
 * @param {{k?:number, teamK?:number, l1?:number}} [opts]
 */
export function buildTier1SectionPre(hits, opts) {
  const o = opts || {}
  const K = Number.isFinite(o.k) ? Number(o.k) : 8            // 本机名额（保持既有缺省的语义）
  const teamK = Number.isFinite(o.teamK) ? Number(o.teamK) : 0 // 团队名额**缺省 0** ⇒ 未开启团队版零变化
  const L1 = Number.isFinite(o.l1) ? Number(o.l1) : 140

  const list = Array.isArray(hits) ? hits : []
  const local = list.filter((h) => String((h && h.origin) || 'local') !== 'team')
  const team = list.filter((h) => String(h && h.origin) === 'team')

  const pick = (arr, n) => arr.slice(0, Math.max(0, n))
  const lines = []
  for (const h of pick(local, K)) lines.push(clip(String(h.summary || ''), L1))
  // 团队段：加**显式来源标**，让模型知道这条来自团队共享（而非用户自己说过）
  for (const h of pick(team, teamK)) {
    lines.push('[团队] ' + clip(String(h.summary || ''), Math.max(0, L1 - 5)))
  }
  return lines
}
```

**片段 2**：来源标注常量。位置：`tier-layer-inject.js` 文件末尾（新增导出）。

```js
// ★ Teamwork：命中来源标注 —— 模型必须能区分"用户自己说的"与"团队共享的"。
//   理由：团队记忆的可信度与个人记忆不同（可能来自他人上下文、可能已过时），
//   若不标注，模型会把团队结论当作用户的直接陈述。这与既有"superseded 必须标记"同源。
export const TIER_HIT_ORIGIN_TEAM_PRE_V1 = '[团队]'
export const TIER_HIT_ORIGIN_LOCAL_PRE_V1 = '[本机]'

/**
 * 给命中打来源标 —— 供渲染层统一使用（**不要各处自己拼字符串**）。
 * @param {object} hit
 * @returns {{mark:string, origin:'local'|'team', actorId:string|null}}
 */
export function originMarkOfHitPre(hit) {
  const h = hit || {}
  const isTeam = String(h.origin || 'local') === 'team'
  return {
    mark: isTeam ? TIER_HIT_ORIGIN_TEAM_PRE_V1 : TIER_HIT_ORIGIN_LOCAL_PRE_V1,
    origin: isTeam ? 'team' : 'local',
    actorId: h.actorId ? String(h.actorId) : null,
  }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队记忆淹没本机记忆** | 统一按分数排 top-K | 片段 1 分段配额；teamK 缺省 0 |
| **未开启团队版时注入变化** | 新增标记无条件渲染 | teamK 缺省 0 ⇒ 团队段不渲染；本机段逻辑不变 |
| **与 memory-envelope 预算冲突** | 两处各自算预算 | 两处的 team 预算必须**同源同配置**（建议都读同一个 `teamBudgetRatio`） |
| **降级说明超长** | 收集点与长度门脱节 | 沿用 memory-envelope 的统一长度门（缺陷①的修复点） |

**既有测试/守卫**：三层装配用例（闸门命中/未命中、预算上限、降级说明）。本模块与 `memory-envelope` / `tier0-catalog` 有联合断言，改动需三者同步验证。
