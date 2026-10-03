
## tier0-catalog

- **规模**：32,347 B / 736 行 / 18 个导出符号
- **交付形态**：**完整版**

### 职责

**Tier-0 目录生成器**（`tier0_catalog_pre_v1`）—— 三层检索契约 C4。作用 = **指引层**：把四类来源（用户级记忆 / 项目笔记 / 当日日志 / 白板 PLAN）压成"每条 1 行"的短目录，用来回答「要不要用某条记忆」，从而决定是否下探 Tier-1 / Tier-2。
一行格式（契约 §1）：`标题 · 一句结论 · layer · status · 日期`
- layer 取值 ∈ user / project / log / reflection / whiteboard，按**来源路径**归属（§2 判定规则）；
- status 一律 current（superseded / retracted 的判定属写入侧，**指引层不臆断**）；
- 预算 ≤ B0 token（契约 I1；默认 800）。

### 数据流

```
四类来源文本
   ├─ 用户级记忆     → layer=user
   ├─ 项目笔记       → layer=project
   ├─ 当日日志       → layer=log
   └─ 白板 PLAN      → layer=whiteboard
        │
        ▼
   splitTier0UnitsPre(text)   L165   按锚点/标题切单元
        ├─ pickHeadingTitle   L223
        ├─ pickContentLine    L237
        ├─ firstSentence      L258   取"一句结论"
        └─ resolveDatePre     L269（findDatePre L147 / isDateOnly L120）
        │
        ▼
   extractTier0ItemsPre(text, opts)  L305   → 结构化条目
        ├─ extractSourcePre  L311  来源判定
        └─ buildRecordPre    L285
        │
        ▼
   allocateTier0QuotaPre(items, quota)  L427   ★ 配额分配（四类来源按比例分 B0）
        ├─ resolveQuotaPre L399 / ratio L401
        ├─ tokensOf L446 / reserveFor L448 / accept L460
        └─ TIER0_QUOTA_DEFAULTS L391
        │
        ▼
   renderCatalogLinePre(item)  L341   → 一行
        └─ toPublicItemPre L373 / compareRecordsPre L378
        │
        ▼
   buildTier0CatalogFromTextPre(...)  L554   单来源入口
   buildTier0CatalogPre(sources, opts)  L693   ★ 多来源总入口
   estimateTokensPre  L135   token 估算；readTextSafePre L659 fail-soft 读文本
   TIER0_DEFAULTS L62 / TIER0_ANCHOR_ID_RE L60
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L47 | `TIER0_CATALOG_VERSION` | 版本常量 |
| L60 | `TIER0_ANCHOR_ID_RE` | 锚点 ID 正则 |
| L62 | `TIER0_DEFAULTS` | 默认（B0 token 等） |
| L135 | `estimateTokensPre(text)` | token 估算 |
| L147 | `findDatePre(text)` | 找日期 |
| L165 | `splitTier0UnitsPre(text)` | 切单元 |
| L305 | `extractTier0ItemsPre(text, opts)` | 抽取条目 |
| L341 | `renderCatalogLinePre(item)` | 渲染一行 |
| L391 | `TIER0_QUOTA_DEFAULTS` | 配额默认 |
| L427 | `allocateTier0QuotaPre(items, quota)` | **配额分配** |
| L554 | `buildTier0CatalogFromTextPre(...)` | 单来源建目录 |
| L659 | `readTextSafePre(...)` | fail-soft 读文本 |
| L693 | `buildTier0CatalogPre(sources, opts)` | **多来源总入口** |

### 内部关键实现

**1. status 一律 current —— "指引层不臆断"（文件头）**

文件头逐字：*"status 一律 current（superseded / retracted 的判定属写入侧，**指引层不臆断**）"*。
⇒ 目录层**不做状态判定**，只负责"指路"。这条纪律避免了两处判据分叉（对照用户既有判据："同一语义若在多个函数里各写一份判据，改动必须一次改全"）。

**2. 配额按来源比例分配 L427（四类来源争 B0）**

`allocateTier0QuotaPre` 让四类来源按比例分享 800 token 的目录预算 ⇒ 防止某一类（如日志）淹没其他类。这是**公平性机制**，也是团队化最需要扩展的地方（团队记忆会是**第五类来源**）。

**3. fail-soft 读文本 L659**

`readTextSafePre` 在文件缺失/不可读时返回安全值，不抛出 ⇒ 目录生成不会因某一路径缺失而整体失败。

**4. 确定性排序 L378**

`compareRecordsPre` 提供稳定排序 ⇒ 同输入同输出（可回归断言）。

### 与团队化的关系

**判定：S3 派生重算（完全本地）+ S2 共享（团队来源文本）。**

理由：目录是"把文本压成一行"的**纯派生渲染**，同步它毫无意义（同步源文本即可）。**但团队化必须给它第五类来源**：团队共享记忆应当有自己的目录份额，且**独立配额**（不得挤占本机四类）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| C1 | `TIER0_QUOTA_DEFAULTS` L391 | 四类比例 | 新增 team 份额（**缺省 0**） | 封闭常量新增键 |
| C2 | `allocateTier0QuotaPre` L427 | 四类轮转 | 支持第五类，且**独立份额** | 分配算法扩展 |
| C3 | `renderCatalogLinePre` L341 | 无来源标 | 团队条目加来源标（与 tier-layer-inject 的 origin 标同源） | 渲染增字段 |
| C4 | `extractSourcePre` L311 | 按路径判 layer | 支持 origin='team' 的显式声明 | 兼容 |
| C5 | 配额上限 | 800 token 全局 | 团队份额独立（不得抬高总 B0） | 纪律 |

#### 可直接落地的代码片段

**片段 1**：新增 team 份额（**缺省 0，零破坏**）。位置：`tier0-catalog.js:391`（`TIER0_QUOTA_DEFAULTS` 定义处）。

```js
// ★ Teamwork：Tier-0 目录新增 team 份额。
//   为什么必须**独立份额**而不是从四类里各抽一点：
//   用户硬规则「单一开关不得顺带改变其他功能的行为」—— 开启团队版不得减少
//   本机四类来源的目录可见度。若从既有比例里抽，等于"开团队版就少看到自己的笔记"。
//   缺省 0 ⇒ 未开启团队版时**逐字节等价于改造前**（零破坏）。
export const TIER0_QUOTA_DEFAULTS = Object.freeze({
  user: 0.3,
  project: 0.3,
  log: 0.25,
  reflection: 0.15,
  // 第五类：团队共享记忆。**独立于上面四类**，不参与它们的比例归一。
  team: 0,
})

/**
 * 计算团队目录的 token 份额。
 *
 * 设计要点：team 份额是**额外**的（不挤占四类），但总数仍受 B0 约束 ——
 * 否则"团队记忆多"会直接抬高每轮注入成本，而该段**每轮无条件注入、不参与裁剪**。
 * ⇒ team 份额上限 = B0 的一个固定比例，且**本机四类优先**。
 *
 * @param {number} b0 目录总预算（默认 800 token）
 * @param {number} teamRatio 团队份额比例（配置项，缺省 0）
 * @returns {{localBudget:number, teamBudget:number}}
 */
export function allocateTeamCatalogBudgetPre(b0, teamRatio) {
  const total = Number.isFinite(b0) ? Math.max(0, Number(b0)) : 800
  const r = Number.isFinite(teamRatio) ? Number(teamRatio) : 0
  // 团队目录上限硬顶 25%：目录层是"指路"用的，团队内容再多也不该占掉本机目录的可见度
  const teamBudget = Math.floor(total * Math.min(0.25, Math.max(0, r)))
  return { localBudget: total - teamBudget, teamBudget }
}
```

**片段 2**：团队条目渲染标来源。位置：`tier0-catalog.js:341`（`renderCatalogLinePre` 内拼装行处）。

```js
export function renderCatalogLinePre(item, opts) {
  const it = item || {}
  // ...原有拼装：标题 · 一句结论 · layer · status · 日期 → baseLine...
  // ★ Teamwork：团队条目前加来源标，让模型知道"这条不是本机记忆"。
  //   为什么必须标：目录层决定"要不要下探"，而下探到团队记忆后是**别人的上下文**；
  //   若不标，模型会把团队结论当成本机事实直接使用。与 tier-layer-inject 的 [团队] 标同源。
  const isTeam = String(it.origin || '') === 'team' || String(it.layer || '') === 'team'
  return isTeam ? ('[团队] ' + baseLine) : baseLine
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **团队记忆挤占本机目录** | 团队份额从四类里抽 | 片段 1 独立份额；本机四类比例**不动** |
| **目录层总成本上升** | 团队份额无上限 | 片段 1 硬顶 25%；配合 memory-envelope 的 team 桶独立预算 |
| **指引层臆断状态** | 顺手加 status 判定 | 文件头明文禁止；status 恒 current |
| **新增 layer 破坏枚举** | 加 team 但未同步 | `tier0-catalog` 与 `l0-extract` 的 `L0_LAYERS` 是**两处枚举**，必须同轮改 + 测试断言 |

**既有测试/守卫**：目录生成用例（四类来源、配额分配、B0 上限）。`TIER0_DEFAULTS` 与 `L0_LAYERS` 的类目一致性很可能有断言，新增 team 必须同步。
