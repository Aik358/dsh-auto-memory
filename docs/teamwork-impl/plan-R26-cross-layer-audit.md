# R26 · 跨层对账审计（宿主能力 ↔ 前端消费）· 已完工

> **状态**：已完工 · 2026-10-13（原文记录的最后一次执行日）
> **性质**：派工任务书（存档）—— 该轮已完工，本文保留为任务书原文，不再作为待执行计划。
> **落点**：`lib/client.js`（`KanbanBoardRail` 展开时同时置 `includeArchive: true`）；新增套件 `tests/smoke/smoke-test-r26-cross-layer.mjs`；**不改 `lib/index.js`**（宿主早已就绪）。
> **验收**：R26 新套件 **PASS 21 / FAIL 0**；加载守卫 **PASS 17 / FAIL 0**；全量回归 **PASS 212 / FAIL 0 / TIMEOUT 0**；已并入全量回归。

## 摘要

该轮把 R25 的偶然发现（宿主已就绪但前端未接线）系统化为常设判据：**宿主 `searchParams.get(X)` 的每个参数，前端都必须有消费者**。审计 12 个宿主查询参数后发现唯一真缺口是 `includeArchive`——46 卷 §四 B2 所指的「版本归档」恒空即由此而来。修法为展开时同时置 `includeArchive: true`，不新增开关、不改默认路径，故折叠态行为零变化。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「本轮 / 待办 / 计划」等计划态措辞**是当时的任务描述**，不代表当前待办；**该轮已完工**，实际结果以页首「状态 / 落点 / 验收」为准，过程留痕见同目录对应轮工程记录。

---

> **过程留痕**：`100-R26跨层对账审计.md`（含交付物物理量、CR-10 验收与变异反向验证）。


## 〇、依据（开工前全量读）

| 卷 | 行数 | 本轮取用 |
|---|---:|---|
| **70 卷** | **144 全文** | §二 每轮四步 + **八项复核一条不省**；§三 工程量；§五 关键路径与重启预算 |
| **46 卷** | **158 全文** | ★§四 **B2：「版本归档」泳道恒空 —— 泳道按 `kind==='archive'` 匹配，而 `_collectWhiteboardDocsPre` 传 `includeArchive:false` ⇒ 结构性死泳道**；§〇「后端给 17 项前端画 2 项」 |

## 一、审计方法（R25 教训的推广）

> R25 抓到「宿主已就绪但前端未接线」的真缺口。本轮**系统性**扫描同一模式：
> 宿主 `searchParams.get(X)` 的**每个**参数 ⇒ 前端是否真传。

## 二、审计实测（12 个宿主查询参数）

| 参数 | 前端 | 判定 |
|---|---|---|
| key / file / sessionId / id / foldDays / actor / ws / path / force / source | ✓ 有 | 已通 |
| **reset** | ✓ **有**（`client.js` L6144 `fetch(API.recallStats + '?reset=1', { method: 'POST' })`） | **首轮正则漏检带后缀写法 ⇒ 修正为已实现** |
| **includeArchive** | ★**无** | ★**真缺口** |

## 三、★includeArchive 缺口取证（三处硬证据）

| # | 证据 |
|---:|---|
| 1 | 宿主 L3336：`wantArchive = (opts && opts.includeArchive === true) || String(config.boardArchive || '') === 'on'` ⇒ **参数确实存在且带配置回退** |
| 2 | 宿主 L13880：`includeArchive: url.searchParams.get('includeArchive') === '1'` ⇒ **路由已接** |
| 3 | **46 卷 §四 B2 逐字**：「泳道按 `kind==='archive'` 匹配，而 `_collectWhiteboardDocsPre` 传 `includeArchive:false` ⇒ **结构性死泳道**」 |

**⇒ 结论**：默认路径下「版本归档」泳道**恒空**（不是没数据，是没取数）。前端折叠条/工具栏从未传 `includeArchive` ⇒ 与 R25 同型缺口。

## 四、修法（最小、解耦、可回退）

1. `KanbanBoardRail` 已有 `foldOpen`（R25 建）。**展开时同时置 `includeArchive: true`** —— 语义一致：
   「展开更早」= 要看更早的（含已归档）内容，正是 46 卷 §四 B2 所指的那条路。
2. **不新增开关、不改默认路径**（宿主注释 L3335 逐字：「默认路径读盘量与耗时**逐字节不变**」）⇒ 不展开时行为**零变化**。
3. 折叠条文案从「展开更早的 N 天」→ 展开后**消失**（`hasMore=false`），与 R25 已验一致。

## 五、判据（可脚本化）

| # | 判据 |
|---:|---|
| P1 | 前端 rail 取数同时含 `foldDays` 与 `includeArchive` 两个参数 |
| P2 | **真 import 真调用**：`includeArchive:true` 时归档卡进结果、`false` 时不进（正/负两路） |
| P3 | 默认（折叠态）**不传** true ⇒ 行为与 R25 前逐字节等价 |
| P4 | 既有守卫不降级（graph-mode / r15 / r10 / 面板 / 加载守卫） |
| P5 | ★**反向验证**：变异 ⇒ 精确报红；还原 ⇒ 复绿 |
| P6 | 零新增路由 / 零新增开关 / 零新增定时器 |

## 六、零改动约束

不改 `lib/index.js`（宿主已就绪）；只改 `lib/client.js` + 新增套件与卷。

