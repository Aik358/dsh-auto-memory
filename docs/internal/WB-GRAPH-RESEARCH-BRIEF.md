# 预研任务书：白板接续 + dsh-graph 范式 + MRAgent 主动重建的整合方案

> 来源：用户 2026-09-13 指定的调查 Prompt（原文收录，作为唯一任务书）。
> 执行方式：R1（本地代码审计）+ R2（外部资产调研）并行 → R3（综合成方案）。
> 产出：`WB-GRAPH-RESEARCH-LOCAL.md` / `WB-GRAPH-RESEARCH-EXTERNAL.md` / **`WB-GRAPH-INTEGRATION-PLAN.md`（最终交付）**。

---

调查任务：dsh-auto-memory 白板接续 + dsh-graph 范式 + MRAgent 主动重建的整合方案

## 背景

dsh-auto-memory 是 DSH（DeepSeek Harness）的主动联想记忆插件（BSD-3-Clause）。其核心能力包括三层自动记忆、固定边界注入（前缀缓存友好）、外部记忆继承，以及 PLAN 白板跨窗口续命。

白板接续是本文调查的焦点：上下文窗口填满后，当前工作状态以"交接账本 + PLAN 白板"的形式写入本地 Markdown，新窗口据此续命。当前问题：

1. 交接笔记是描述性的自由文本——state / goals / dead ends / progress 四部分没有结构约束，生成质量完全依赖模型自觉性。
2. 检索端是扁平的无结构匹配——新窗口只能靠语义相似度"猜"哪部分相关，没有可导航的路径。
3. 用户反馈"看不明白"——因为交接笔记本身没有可导航的结构，检索也没有判据约束。

## 调查目标

设计一个三层结合方案，让白板接续从"自由文本 + 语义匹配"升级为"判据约束生成 + 结构化存储 + 主动重建检索"，且不搬 dsh-graph 的代码，只借鉴其范式。

---

## 一、需要调查的技术资产

### A. dsh-auto-memory（本地已有，重点审查白板相关代码）

| 调查项 | 具体要求 |
| --- | --- |
| 白板数据模型 | 当前 PLAN 白板在磁盘上的存储格式（Markdown 文件路径、结构、是否有 schema） |
| 交接账本 | 交接笔记的生成路径、四部分（state/goals/dead ends/progress）在代码中的映射 |
| 检索路径 | 新窗口唤醒时，白板内容如何被注入上下文（直接全文注入？分段注入？有无检索逻辑？） |
| 前缀缓存约束 | 固定边界注入的具体实现——哪些内容放在固定位置，哪些动态变化 |
| 写入路径 | 白板写入的触发条件、写入前是否有校验逻辑 |

关键产出：标注出最小改动点——哪些函数/模块需要修改，哪些可以完全不动。

### B. dsh-graph（MIT，只借鉴范式，不搬代码）

| 调查项 | 具体要求 |
| --- | --- |
| 判据机制 | "判据先于执行"的具体实现——判据如何定义、如何校验、不通过时的行为 |
| 状态机 | 目标生命周期阶段（draft→planning→collecting→ready→in_progress→review→delivered）的迁移条件，每个阶段是否有强制判据 |
| 数据存储 | .dsh-graph 目录的目录结构、文件格式、事件流记录方式 |
| graph_handoff | 交接文档的生成逻辑——"board 投影 + 长期记忆 + 环境事实"三元结构的具体实现 |
| 图遍历工具 | 是否有可复用的图查询/遍历逻辑（不搬代码，只理解接口） |

关键产出：提炼出可迁移的范式——判据集的 schema 结构、状态迁移的强制逻辑、图存储的持久化方式。

### C. MRAgent（ICML 2026，论文 + 代码）

| 调查项 | 具体要求 |
| --- | --- |
| Cue–Tag–Content 图 | 三种节点类型的具体定义；Cue→Tag、Tag→Content、Content→(Cue,Tag) 的边关系类型 |
| 主动重建循环 | 从入口 Cue 出发的遍历动作集（forward traversal / reverse traversal）的具体操作；剪枝条件是什么 |
| 工具集 | 代码仓库中 tools.py 定义的工具 schema（keyword / topic / personal / temporal / context 工具）的具体接口 |
| 图构建流程 | Phase 1 中 rewrite → extract_keyword → store 的具体实现——特别是 keyword 提取和 topic tag 附加的 prompt 设计 |
| 计算成本 | 论文声称减少 token 和耗时——具体在哪个环节节省（遍历剪枝 vs 图规模控制） |

关键产出：可直接映射到白板场景的最小机制集——不需要完整的 QA 系统，只需要遍历动作 + 剪枝逻辑 + 节点 schema。

---

## 二、需要回答的核心问题

**Q1：判据集如何定义？**（参照 dsh-graph 的"判据先于执行"，为白板四部分笔记定义判据）
- 判据的 schema 结构是什么（criterion_type + evidence_required + confidence_level？）
- 每条判据是硬性（不通过则拒绝写入）还是软性（标记警告但允许写入）？
- 判据校验发生在写入前还是生成过程中（模型一边生成一边校验）？

**Q2：Cue–Tag–Content 图如何映射到白板？**
- Cue：什么充当入口线索？（当前对话的初始上下文？用户重新提起的关键词？打开的文件路径？）
- Tag：从哪里来？确定性映射（如 dead ends 自动打"已排除方案" tag）还是模型抽取？模型抽取的 prompt 怎么写？
- Content：一条 state 条目是 Content，还是一条 dead end 也是 Content？不同类型 Content 的 tag 集合如何区分？

**Q3：主动重建的遍历如何落地？**
- 新窗口唤醒时，模型如何拿到入口 Cue？自动提取还是用户/系统提供？
- 遍历动作集能否简化为两个工具：expand_tag（给定 tag 展开其下所有 Content）和 trace_back（给定 Content 回溯关联 Cue 和 Tag）？
- 剪枝条件是什么？（MRAgent 用"累积证据"剪枝；白板场景的剪枝信号是什么？）

**Q4：最小可行改动的优先级排序**
- P0（零代码或极小改动）：判据 schema 的文档定义——先约定"什么算一份合格的交接笔记"。
- P1（小改动）：判据校验中间件——在白板写入路径上增加校验函数。
- P2（中等改动）：存储格式从 Markdown 改为 Cue–Tag–Content 的 JSON 或轻量图结构。
- P3（检索端）：主动重建循环——新增工具（expand_tag / trace_back），修改新窗口唤醒逻辑。

**Q5：不做的事（边界约束）**
- 不引入跨目标依赖图：每个对话一个白板，只记录进度，不承担全局调度。
- 不搬 dsh-graph 代码：只借鉴判据范式和事件流结构。
- 不做复杂 NLP 抽取：Tag 生成优先用确定性映射，模型抽取作为补充。
- 不破坏前缀缓存：固定边界注入的约束必须保留——图中哪些部分放在固定位置，哪些动态变化？

---

## 三、预期产出

一份可执行的整合方案文档，包含：

1. **判据 Schema**：白板四部分笔记的判据定义（JSON Schema 或表格形式）。
2. **图数据模型**：白板从 Markdown 到 Cue–Tag–Content 图的映射表——当前字段 → 节点类型 → 边关系。
3. **遍历工具接口**：expand_tag 和 trace_back 的输入输出 schema，以及它们与 MRAgent 工具集的对齐关系。
4. **改动清单**：按 P0–P3 优先级排序的具体改动项，每项标注涉及的文件/模块和改动量估计。
5. **前缀缓存影响评估**：新方案下哪些内容仍在固定边界、哪些变为动态注入，对前缀缓存的破坏程度。
6. **风险与回退**：如果主动重建循环导致延迟或 token 消耗增加，回退方案是什么。

---

## 四、参考资料

- dsh-auto-memory：github.com/Aik358/dsh-auto-memory（BSD-3-Clause）——本地 `D:\dsh-auto-memory`
- dsh-graph：github.com/miuzel/dsh-graph（MIT，npm 包 dsh-graph）
- MRAgent 论文：ICML 2026，arXiv:2606.06036
- MRAgent 代码：github.com/Ji-shuo/MRAgent

> 特别提醒：dsh-graph 许可证已确认为 MIT（Snyk 页面 Licenses: MIT），可以合法借鉴代码。但本方案建议只借鉴范式不搬代码——它的状态机为目标管理设计，白板场景是单对话进度快照，直接复用会引入不必要的复杂度。
