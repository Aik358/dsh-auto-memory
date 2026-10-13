# P3 · 融合层改造 · rank-space + 绝对分数决策（已完工）

> **状态**：已完工 · 2026-09-09（原文记录的最后一次核实日）
> **性质**：派工任务书（存档）—— 本文为完成后的技术记录，不再作为待执行计划。
> **落点**：新增 `lib/recall-fusion.js`（原文记作 `lib/recall-fusion-pre.js`，P3 交付 commit `c917bbe`）；套件 `tests/smoke/smoke-test-p3-fusion.mjs`。
> **验收**：`smoke-test-p3-fusion.mjs` 通过；已并入全量回归。

## 摘要

该轮要解决的是 `fuseD6Pre` 的 minmax 归一化三宗罪：分数随候选集漂移、矮子里拔将军、候选 ≤1 时退化为常数 0.5 致排序失效。方案是新增 rank-space 融合函数并存、不改写既有 `fuseD6Pre` 行为，其中 k=60 的 RRF 参数沿用 Hindsight issue #3956 的实测结论。落地物为 `lib/recall-fusion.js`，其 `rankFusionRRFPre` 后续由 P8 接线进 `recall()`。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

> **投喂方式（存档）**：该轮要求本段与 `_COMMON.md` 一并投喂；该批次已执行完毕。


## 【P3】融合层改造（rank-space + 绝对分数决策）· 原任务书

**目标**：修复 `fuseD6Pre` 的 minmax 归一化三宗罪：① 分数随候选集漂移 ② 矮子里拔将军 ③ 候选 ≤1 时退化为常数 0.5（排序失效）。本项目核心是"是否注入"的决策，依赖分数与阈值比较，**相对量会腐蚀决策基础**。

**涉及功能模块**：`lib/semantic-js-pre.js` 的 `fuseD6Pre`。

**验收标准**：
1. 决策用**绝对分数 + 校准阈值**，排序用融合分数——两者解耦
2. 候选 < 3 时不退化（新增断言）
3. 提供 **rank-space** 融合：`score = Σ 1/(k + rank/divisor)`，**k=60**
4. 保留原始分数供审计

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/context-bridge-pre.js`
- 关键词：`fuseD6Pre`、`D6_FUSION_WEIGHTS_PRE_V1`、`normArm`、`flat`、`reciprocal_rank_fusion`、`rrf`
- 必须先确认：① `fuseD6Pre` 的所有调用点 ② 现有返回值结构被谁消费（哪些字段不能删）③ 是否已有 RRF 实现

**改动边界**：
- ✅ 允许：在 `lib/semantic-js-pre.js` **新增**融合函数（并存），由配置/参数切换；或新增 `lib/recall-fusion-pre.js`
- ❌ **禁止删除或改写 `fuseD6Pre` 既有行为**（并存优先，避免破坏调用方）
- ❌ **禁止 score-space 加权 RRF**：Hindsight issue #3956 实测——k=60 时动态范围仅 5.9 倍，加权会让排序退化为字典序，recall@20 从 **0.97 崩到 0.40**
- ❌ 禁止照搬 OpenViking 的 `α=0.5` 父分数传播（本地无深目录树；若实现须映射为「工作区/日志文件/主题块」三级父且默认关闭）

**回滚**：新增文件则删除；若改了 `semantic-js-pre.js` 则 `git checkout` 该文件。

---
