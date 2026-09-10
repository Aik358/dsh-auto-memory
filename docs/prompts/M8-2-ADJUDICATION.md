# M8-2 目标裁决（规划侧回应执行汇报）

> 日期：2026-09-09 · 裁决人：规划侧 · 依据：**实读代码**（非汇报文字转述）

## 一、事实核实（四条，全部可复现）

| # | 核实项 | 命令 | 结果 |
|---|---|---|---|
| F1 | P3 产物是否接线 | `grep -rn "recall-fusion" lib/ --include="*.js"`（排除自身） | **零引用**。`lib/recall-fusion-pre.js` 导出 `rankFusionRRFPre` / `FUSION_RRF_K_PRE_V1=60` / `FUSION_RRF_DIVISOR_PRE_V1=60` / `RECALL_FUSION_VERSION='rrf_fusion_pre_v1'`，**无调用方** ✅ 执行侧属实 |
| F2 | `recall()` 当前如何融合 | `sed -n '3301,3420p' lib/index.js` | **不是融合，是字典序排序**：`.sort((a,b) => b.lex - a.lex \|\| (b.sem\|\|0) - (a.sem\|\|0) \|\| id)` —— 词法分主导，语义分**仅在词法完全相等时打破平局** |
| F3 | evidence 数据是否存在 | `ls ~/.dsh/memory/evidence-pre/events` | **存在**：按日 JSONL（`2026-08-23.jsonl` 2491B、`2026-08-25.jsonl` 18102B…），行结构含 `{kind, memoryId, ts/event.ts}`；`lib/index.js:6861-6876` 已有读取范式（读最近 2 个文件、每文件末 400 行） |
| F4 | evidence 消费链 | `grep -rn "evidenceFor" lib/` | **仅注释引用**（`fact-store.js` 为构建产物），**真实调用方为零**；`lib/memory-importance-pre.js` 同样**未接线**；`lib/index.js` 无 evidence store 实例 |

**F2 是本次核实新增的发现，比"未接线"更严重**：P2 接进来的语义臂在排序中几乎不起作用，`recall()` 实质仍是纯词法。**P3 的 RRF 交付物是对的，只是没人调用。**

## 二、结论：**不降级，拆两段补做**

**理由**：M8-2 的目标（evidence → importance → 参与候选排序）本身成立且数据基础真实存在（F3 证明事件已落盘），失败原因是**规划缺口**而非目标错误。降等于把正确目标砍掉。

**规划缺口认领（三条，全部是我的责任）**：

1. **开关判据设错** —— `M8-2-importance-wiring.md` 把"是否接线"挂在"P3 是否完成"上。真实判据是"**RRF 是否已接入检索路径**"。P3 完成 ≠ P3 接线，我当时默认了"交付即接线"。
2. **缺一段"RRF 接线进检索"** —— P3 的改动边界写的是"新增融合函数（并存），由配置/参数切换"，**没有一段 prompt 负责把它接进 `recall()`**。并存交付了，切换永远没发生。
3. **缺"evidence → 检索"数据管道段** —— 我假设 `evidenceFor()` 可直接被检索侧调用，实际它零调用方且依赖外部传入 evidence list；events 目录的读取范式当时也未纳入 prompt。

## 三、补做方案

| 新段 | 内容 | 依赖 | 风险 | 价值 |
|---|---|---|---|---|
| **P8** | RRF 接线进 `recall()`：替换 F2 的字典序排序，lex/sem 双输入经 `rankFusionRRFPre` 融合；保留 `legacy` 回退开关 | P1/P3（已完成） | 中（改排序行为） | **立即激活 P2 语义臂**，这是当前最大的质量缺口 |
| **M8-2b** | evidence 聚合层 + importance 加权接入：新增 `lib/evidence-agg-pre.js` 按 `memoryId` 聚合 events（有界读取），经 `memory-importance-pre.js` 转 importance，作为加权因子进入 P8 的融合 | **P8** | 中 | 完成 M8-2 原始目标 |

**执行顺序**：P8 → M8-2b（串行，M8-2b 需要 P8 建好的融合入口）。两段均可排在现有 10 轮之后，作为**轮次 11、轮次 12**。

## 四、规划级事实修正（已采纳执行侧汇报）

1. **白板误载更正**：`P5 已建 lib/handoff-anchor-pre.js` 为误载——P5 是内联实现，P6（`7285675`）才首建该文件。
2. **预算口径分离**：`handoffLedgerChars`（快照注入预算，默认 800）与 carry 层 8000 **不同源**，后续 prompt 引用时必须区分。
3. **m73 失败归因**：修正为沙箱 spawn EPERM 假失败，旧账本归因作废。
4. **M8-2 状态**：正式记为「**纯核心已交付（311e2e8），排序接线待 P8/M8-2b**」，不再是"已完成"。

## 五、给执行侧的一句话

P8 做完之前，P2 的语义臂处于"接了但没用"状态——**P8 不是新增能力，是修复 P2 的实效性**，应作为缺陷修复默认开启（保留 `legacy` 回退）。

---

## 六、M8-2b 验收结论（2026-09-09 20:16，规划侧独立复核）

**结论：验收通过，全链路闭环。** 但复核过程中发现并修复了一个会让整条管道静默失效的缺陷。

### 6.1 复核通过项（独立验证，非采信汇报）

| 项 | 验证方式 | 结果 |
|---|---|---|
| 提交真实 | `git show --stat 344af80` | 4 文件 +187/-3 ✅ |
| 模块形态 | `lib/evidence-agg-pre.js` 81 行，导出 `scanEvidenceEventsPre` / `aggregateEvidenceEventsPre` / `EVIDENCE_AGG_DEFAULTS_PRE_V1` | ✅ |
| 只读守卫 | grep 写 API（writeFile/appendFile/rename/mkdir/rm/unlink） | **零命中** ✅ |
| 融合形态 | diff 显示仅改 `dense` 臂输入值，`rankFusionRRFPre` 内部未动 | rank-space 未被破坏 ✅ |
| 冒烟 | evidence-agg 14/14、memory-importance 18/18、p4 34/34、p8 14/14 | ✅ |
| **真实数据端到端** | 13 个 events 文件 → 有界扫描 1268 事件 → 聚合 148 个 memoryId，importance ∈ [0.30, 0.65]，**148 条全部偏离中性** | ✅ 管道确实产出差异化权重 |

### 6.2 🐛 发现并修复：静默失效（P0 级）

**现象**：新增代码 `lib/index.js:3399` 使用裸 `readdirSync(...)`，但顶层 `node:fs` 导入（`:21`）**不含该符号**；`fsMod` 仅在 6018/6050/6684 的函数局部定义。

**后果**：调用即抛 `ReferenceError` → 被 `catch (eImp) {}` 静默吞掉 → `impMap` 恒空 → **全体取中性 0.5 → 因子统一 0.75 → 排序完全不变 → 整条管道在生产中毫无作用**。

**为什么测试没抓到**：冒烟测的是**纯函数 + 注入 IO**，从不执行 `index.js` 里的接线代码；而"全部中性"与"正常工作但恰好都中性"在结果上不可区分。

**实证**：复现脚本输出 `impMap.size = 0`。

**修复**：`lib/index.js:21` 导入清单补入 `readdirSync`（唯一改动，1 行，脚本精确替换，CRLF 保持、无 BOM）。全量审计确认**此类问题仅此一处**，其余 fs 符号均已导入。

**复验**：`node --check` 通过；审计脚本报告"全部已导入"；四套相关冒烟全绿。

### 6.3 ⚠️ 新发现：evidence 写入侧覆盖率不足（下一个瓶颈）

真实 kind 分布（全量 / 近 7 天）：

| kind | 全量 | 近 7 天 |
|---|---|---|
| seen | 4930 | 4828 |
| cite | 286 | 199 |
| read | 82 | 33 |
| correction | **2** | 1 |
| **reuse** | **0** | **0** |
| **success** | **0** | **0** |

**含义**：`reuse` 与 `success` **从未落盘**（`createSuccessEvidencePre` 有 5 处调用点，但零事件产出）；`correction` 全量仅 2 条。因此当前 importance **实质由 `seen`（曝光次数）驱动 ≈ 曝光度，而非有用性**；负向下压机制（correction）几乎不存在。

这不是 M8-2b 的问题（它的职责是管道），而是**数据源的问题**，但它决定了 M8-2 最终能兑现多少价值。

### 6.4 三条后续建议

1. **补 P9：evidence 写入侧覆盖率排查** —— 查清 `reuse`/`success` 为何零产出、`correction` 为何近乎为零（是触发条件未满足，还是调用点未被接线）。见 `P9-evidence-write-coverage.md`。
2. **静默 catch 增加可观测性** —— `catch (eImp) {}` 是本次缺陷未被发现的根本原因。建议至少 `diag('m8-2b importance unavailable: ' + eImp.message)`，让"降级"可观测（仍需保持 fail-soft，不影响 I4）。
3. **效应强度标定留作旋钮** —— 当前 `factor = 0.5 + 0.5 × importance`，实测 importance ∈ [0.30, 0.65] → factor ∈ [0.65, 0.825]，**最大摆幅 1.27×**。即只有 dense 分差小于约 27% 的候选对才可能被翻转——偏保守。建议 P9 之后用真实查询测量"翻转率"再决定是否放大（如 `0.3 + 0.7×imp`）。
