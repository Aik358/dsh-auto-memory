# R2 外部资产调研：dsh-graph 与 MRAgent（只借鉴范式，不搬代码）

> 预研子代理 R2 产出 · 2026-09-13。配套任务书：`WB-GRAPH-RESEARCH-BRIEF.md`。
> 本文所有 dsh-graph 结论均附仓库内文件路径(:行号)证据；MRAgent 附 文件:行号 或论文段落。

---

## 获取方式与诚实声明

| 资产 | 获取方式 | 结果 | 缺口 |
| --- | --- | --- | --- |
| dsh-graph | `git clone --depth 50 https://github.com/miuzel/dsh-graph.git` 到临时目录 | 成功。`main` 分支，commit `6809942a9a8efa5a90b82bb90ebaeedd2cbce275`（2026-09-12），tag `v0.10.0`。含完整 TS 源码（`core/`）、编译产物（`dsh-graph-host/`）、`DESIGN.md`、`schema/SCHEMA.md`、60+ 测试文件 | 仓库根目录**无 LICENSE 文件**（MIT 许可文本在 `dsh-graph-host/LICENSE`，随 npm 包分发）；`package.json` 无 license 字段，host 包 package.json 有 `"license": "MIT"` |
| MRAgent | `git clone --depth 50 https://github.com/Ji-shuo/MRAgent.git` 到临时目录 | 成功。`main` 分支，commit `7441506db984b7c4da32e8dbeb2527f2e351270a`（2026-06-08）。32 个文件，Python 源码齐全，`data/dataset_LM.json` 经 Git LFS 正常拉取 | **仓库完全无 LICENSE 文件**，README 亦无任何许可声明 |
| 论文 arXiv:2606.06036 | WebFetch 摘要页 `https://arxiv.org/abs/2606.06036` + 全文 HTML `https://arxiv.org/html/2606.06036v1` | 成功。标题 *"Memory is Reconstructed, Not Retrieved: Graph Memory for LLM Agents"*，作者 Shuo Ji, Yibo Li, Bryan Hooi，提交 2026-06-04，Comments: **"Accepted at ICML 2026"**，cs.AI/cs.IR。全文（公式、算法、成本表）均可取，无需降级 | 论文为 v1 快照，与代码 commit（6-08）可能存在细微滞后；下文「与任务书描述的出入」第 6 条记录了论文与代码的一处命名不一致 |

两仓库均已完整克隆、逐文件核读；本报告未使用任何推测性内容。临时克隆目录位于 `C:\Users\JH Z\AppData\Local\Temp\wb-research\`（未触碰 dsh-auto-memory 仓库）。

---

## dsh-graph 范式提炼

dsh-graph 是 DeepSeek Harness 的"目标看板"插件（npm 包 `dsh-graph` v0.10.0），把工作组织成 Backlog → Version → Goal 三层图。设计源流是工业应急 SOP 图模型（`DESIGN.md:5-17`）。核心哲学：**"结构化的是生命周期与求值语义，非结构化的是内容"**（`DESIGN.md:22`）。

### 1. 判据机制："判据先于执行"

**判据定义——不是 JSON schema，是 Markdown 小节 + 纯文本行。** 判据存放在 goal.md 正文的 `## 质量判据` 小节中，每条是一行编号文本，两种形式可混合：自然语言判据（review 执行者对照产出判断）与检查脚本判据（`[script] scripts/check_xxx.sh` 约定）（`DESIGN.md:119-122`；`schema/SCHEMA.md:87-91`）。代码里"判据"的解析是按行过滤：`criteriaItems()` 取小节内非空、非 HTML 注释、非模板占位行（`core/model.ts:146-153`；占位符集合在 `core/model.ts:134-138`）。没有 criterion_type / evidence_required / confidence_level 之类的结构化字段——任务书 Q1 的猜想 schema 在 dsh-graph 中**不存在对应物**。

**判据如何校验——三条硬性门槛 + 一条软性确认路径。** 引擎在状态迁移时强制（`core/machine.ts:80-90`）：进入 `in_progress` 必须同时满足 ①`meta.rules_snapshot` 已记录（规则库版本快照）；②`## 质量判据` 小节非空（`criteriaPresent`）；③事件流中存在该目标的 `criteria.confirmed` 事件。`transition()` 在执行迁移前从事件流重放检查 `criteria.confirmed` 是否存在（`core/ops.ts:1770-1780`）。登记判据走 `setCriteria()`：覆盖写判据小节、快照规则库版本、追加 `criteria.confirmed` 事件（`core/ops.ts:1456-1486`）。

**登记与编辑是两条不同信任级别的路径（值得借鉴的细节）：**
- `setCriteria`（agent 登记）：写 `criteria.confirmed`，触发执行门槛（`core/ops.ts:1477-1485`）；
- `updateCriteria`（GUI 人工编辑，g-170）：**始终只写 `criteria.updated`，"绝不自动记录 criteria.confirmed，不触碰 rules_snapshot"**（`core/ops.ts:1508-1509, 1569`）——人工改判据不等于确认判据，确认必须走显式路径；
- `updateCriteria` 还做乐观并发控制：`base_items` 与服务器当前判据不一致即抛 `GraphConflictError`（REST 409），force 覆盖时把 `conflicted=true` 记入事件可审计（`core/ops.ts:1536-1552`）；空判据列表在 `in_progress/review/delivered` 状态下拒绝清空（D3，`core/ops.ts:1532-1535`）。

**不通过时的行为——拒绝 + 零副作用，不降级不等待。** `assertTransition` 抛 `GraphError` 使迁移失败（`core/machine.ts:46-91`）；`graph_start_attempt` 工具描述明确"派发前先执行准入门禁（backlog/draft/blocked/delivered 及无判据/未确认判据/状态不允许的目标直接拒绝，零副作用：不建 attempt、不启动子代理）"（`dsh-graph-host/index.js:1521` 附近）。GUI 拖动是唯一旁路：`force=true` 跳过 in_progress 门槛，语义是"人工拖动视为授权"（`core/machine.ts:41-43`；`core/machine.ts:26-27` 注释）。

**判据的公平性用途（PK 模式）：** N 路并行 attempt 对同一份登记判据独立核验，"判据先于执行是 PK 公平性的保证"（`DESIGN.md:97-102`）。

### 2. 状态机

**真实阶段名与任务书一致：`draft → planning → collecting → ready → in_progress → review → delivered`，任意阶段可入 `blocked`**（`core/machine.ts:10-19`）。但实际迁移图远比线性链复杂（`core/machine.ts:24-33`）：

```
draft → planning, blocked
planning → collecting, ready, blocked, in_progress   # planning→ready 无收集需求直达；planning→in_progress 直接派发
collecting → ready, planning, blocked, in_progress   # collecting→in_progress 跳过 ready（人工拖动视为授权）
ready → in_progress, collecting, blocked
in_progress → review, blocked, collecting            # →collecting 中断回退重新收集
review → delivered, in_progress, blocked             # →in_progress 打回
delivered → review                                   # 交付后仍可回 review 补充/修 bug
blocked → (只能回 blocked_from)
```

**迁移条件（每条边不是都设防，只在关键门口设防）：**
- 唯一硬判据门是 `ready/collecting/planning → in_progress`：rules_snapshot + 判据非空 + criteria.confirmed 事件三者齐备（`core/machine.ts:80-90`）。其余阶段迁移无判据要求；
- 进 `blocked` 必须给 `reason`（`core/machine.ts:74-78`），且解除只能回 `blocked_from` 原状态（`core/machine.ts:64-69`，`blocked_from` 写入在 `core/ops.ts:1781-1784`）；
- backlog 中的草稿目标禁止阶段迁移，须先排期（`core/ops.ts:1766-1768`）；
- 完成声明 ≠ 完成："任何执行者都只是发起完成声明，触发 review。工作没实际做，review 自然不通过。**状态不是证据，产出物才是**"（`DESIGN.md:104`）。

**迁移由谁触发：模型/人发起，代码校验强制。** 迁移入口是 `graph_transition` 工具（模型调用）或看板 REST 端点（人工拖动）——两者都汇入核心层 `transition()` → `assertTransition()`，核心层不依赖模型自觉（`dsh-graph-host/index.js:1130-1135` 工具定义："状态机与不变式由核心层强制"；`core/ops.ts:1759-1797` 实现）。状态推进由事件流重放可重建：`goal.created→draft/planning、goal.transition→details.to`（`core/events.ts:163-194`）。

**回边语义（打回不清空）：** 打回时受影响的证据标记 `stale`（freshness 概念），未受影响的证据保留（`DESIGN.md:161`）。review 结论按预登记处置分支路由（完全实现/部分实现/遗留问题/未实现），"不是执行者临场决定"（`DESIGN.md:152-159`）。

### 3. 数据存储

`.dsh-graph/` 目录布局（`schema/SCHEMA.md:12-40`；骨架创建在 `core/ops.ts:234-252` `init()`）：

```
.dsh-graph/
├── project.yaml          # 项目配置（supervisor 自动化边界等）
├── rules.md              # 整体工作规则库（frontmatter 带 version）
├── backlog/<id>.md       # 草稿目标
├── goals/<id>/goal.md + attempts/   # 独立目标
├── versions/<slug>/version.md + goals/<id>/goal.md + attempts/<att>/attempt.md + delivery/
├── memory/long-term/<slug>.md       # 长期记忆条目（每条带 source_goal 引用）
├── memory/memory.jsonl   # 结构化记忆事件流（含文件锁，core/events.ts:215-253）
├── shared-cards/  attachments/
├── events.jsonl          # ★ 全系统唯一事实源（append-only）
└── index.json            # 派生缓存，可重建
```

**文件格式三件套**（`schema/SCHEMA.md:3-7`）：
- 叙事内容：**Markdown + JSON frontmatter**（frontmatter 用 JSON——YAML 子集，零依赖可直接 `JSON.parse`，`core/model.ts:1-3, 45-83`）。goal.md 的 meta 受引擎管（status/version/depends_on…），正文小节里引擎只管 `## 质量判据`、`## 证据台账` 等受管小节，其余人/LLM 自由编辑（`schema/SCHEMA.md:48`）；
- 运行履历：**JSONL 事件流**。事件结构 `{ts, actor, event, goal?, details}`（`core/events.ts:8-14`），`appendFileSync` 单行追加（`core/events.ts:46-62`）。事件类型全集约 35 种（`schema/SCHEMA.md:284-292`）；
- 派生索引：JSON（`index.json`、看板缓存）。

**事件流是真相源，文件是投影：** "任何状态迁移必须伴随事件；events.jsonl 是唯一真相源，goal.md 的 frontmatter 状态可视为事件流的物化投影，允许从事件流重建"（`schema/SCHEMA.md:298-299`）。`graph_rebuild` 工具即从事件流重建状态并与 frontmatter 对账输出 drift（`dsh-graph-host/index.js:1385-1390`）；重放逻辑在 `core/events.ts:92-194`（版本泳道 + 目标状态两个 replay 函数）。

**写路径安全：** 一律原子写（`atomicWrite`，temp+rename），多写者叠加文件锁；`withTx` 事务模板"锁保护下读-改-写，事件先行"（`core/ops.ts:285-333` 注释及实现）；graph root 拒绝符号链接、限制路径逃逸（`core/ops.ts:102-118`；`core/root.ts:68-75`）。

**graph root 解析：** 默认 `<workspace>/.dsh-graph`，跟随会话 cwd 而非服务进程 cwd；git linked worktree 会归一到主工作树的 canonical root（`core/root.ts:220-300`）。

### 4. graph_handoff 交接

`generateHandoff()`（`core/ops.ts:339-443`）——任务书所述"三元结构"确认存在，实为四段组装，全部从磁盘数据生成、**不依赖会话上下文**（不读 session）：

1. **board 投影**：`boardProjection(root)` 产出目标看板，交接文档按"版本泳道 → 独立目标 → backlog"罗列每个目标一行（id、title、status、blocked_reason、最新 status_line），随后再按"进行中（下一步就干）→ 已交付 → 阻塞"重排一份行动视角摘要（`core/ops.ts:358-395`）；
2. **关键环境事实（固定段）**：硬编码的项目环境事实列表（executor 注册名、root 覆盖约定、冻结脚本规则等五条，`core/ops.ts:396-404`）——注意这是**该仓库自身 dogfood 的固定文案**，不是可配置的环境事实 API；
3. **长期记忆**：可选 `query` 参数触发 `recallMemory` 关键词检索，输出结构化记忆（`memory/memory.jsonl` 的条目，带 kind/importance/source_goal 标注，经 `safeMemory` 清洗控制字符/伪指令，4000 字符截断），另附 `memory/long-term/` 下文件清单（`core/ops.ts:406-439`）；
4. 落盘与归档：写 `<root>/HANDOFF.md`，旧版内容不同则先归档到 `handoffs/HANDOFF-<ts>.md`（`core/ops.ts:448-458`）。

配套 `claimSupervisor()`：新会话把 `project.yaml` 的 supervisor.session 换成自己的 sessionId、记 `supervisor.claimed` 事件、返回 HANDOFF 全文（`core/ops.ts:476-492`；`DESIGN.md:21`）。设计意图：交接文档是"新会话的启动上下文"，职责指南以 skill 形式另行注入（`core/ops.ts:357`）。

### 5. 图遍历工具

dsh-graph **没有通用的"图遍历"工具**——它的"图查询"是一组面向实体的 CRUD + 校验工具，39 个 `graph_*` 工具按功能分组（`README.md:44-63`；工具定义在 `dsh-graph-host/index.js`）。与"查询/遍历/对账"最相关的接口：

| 工具 | 输入 → 输出 | 实现要点 |
| --- | --- | --- |
| `graph_validate` | 无参 → `problems: string[]` | 全量不变式校验：状态合法性、文件位置与 version 字段一致性、判据（脚本路径必须在 scope 外）、依赖环（`depends_on` DFS）、卡片引用（`dsh-graph-host/index.js:1376-1383`；实现 `core/ops.ts:1816-1970`：`cycleProblems` DFS 环检测 + `locationProblems` 位置一致性） |
| `graph_rebuild` | 无参 → `drift: string[]` | 从 events.jsonl 重放各目标状态，与 frontmatter 对账（`dsh-graph-host/index.js:1384-1390`；`core/events.ts:163-194`） |
| `graph_memory_recall` | `query, kind?, limit?` → `{total, matches}` | 按关键词/类型检索持久记忆条目（`dsh-graph-host/index.js:1505-1522`） |
| `graph_transition` | `goal, to, reason?` → `{ok}` | 唯一的状态迁移入口，核心层强制校验（`dsh-graph-host/index.js:1130-1135`） |
| `graph_move_goal` | 排期移动 | 移动文件即改变归属（backlog ↔ goals ↔ versions），"git 历史天然记录全部排期变迁"（`schema/SCHEMA.md:44-47`） |

依赖边不是手工声明的图 API：目标 B 声明"需要 A 的产出"时边 A→B 自然诞生，门控语义是"逐规则部分匹配"——B 只等它实际声明的 A 的结论（`DESIGN.md:86-91`）。

### 可迁移范式清单（→ 单对话白板场景）

**① 判据集 schema 结构。** dsh-graph 的判据 = "命名小节内的一行文本列表 + 确认事件"。可迁移的最小范式：(a) 判据是**写操作的前置门槛**而非事后检查——白板场景即"交接笔记写入前，state/goals/dead ends/progress 四部分各自有非空且非占位的判据行"；(b) **登记与确认分离**——模型生成判据只产生 `updated` 事件，`confirmed` 必须由显式动作产生，这防止"自评自确认"；(c) 判据条目天然支持两种形态：自然语言（LLM review 判定）+ 脚本（确定性判定），白板场景可以先用"自然语言判据 + LLM 自检一次"的轻量版。简化方向：不需要 rules_snapshot / 乐观并发 token / PK 公平性那一整套——单对话单写者，保留"小节非空 + 占位符过滤 + 确认事件"三点即可；占位符过滤（`CRITERIA_PLACEHOLDERS`）是防"形式主义判据"的关键小技巧，值得照搬。

**② 状态迁移强制逻辑。** 迁移范式 = "枚举合法边表 + 迁移函数内联校验 + 每次迁移必须伴随事件"。白板场景若引入状态机（如 `draft → filled → reviewed → handed_off`），简化要点：(a) dsh-graph 只有 in_progress 一个判据门——白板同理只在"写入/交付"一个门上设防，其余边放开；(b) blocked 的 `blocked_from` 记忆原状态的模式可复用于白板的"暂停/恢复"；(c) 迁移触发者是模型但校验者是代码（`assertTransition` 抛错拒绝），模型永远不能直接改状态字段。更进一步：单对话白板可能连显式状态机都不需要，只需要"事件行 + 从事件重放当前状态"这一半范式（append-only JSONL 为真相源，Markdown 文件为投影，可 rebuild 对账）——这是比状态机更低成本、对前缀缓存更友好的部分。

**③ 图存储持久化方式。** 范式 = "Markdown(人读) + JSONL(机读真相源) + 派生索引(可丢弃)"三层分工，git 友好。白板场景简化：dsh-graph 为多目标/多版本/多写者设计了目录树 + 文件锁 + 原子写 + canonical root；单对话白板是单写者，可以砍掉锁与 canonical root，保留 (a) 每次写先追加一行事件再更新投影文件；(b) 投影文件允许损坏——可从事件流重建；(c) 事件结构固定为 `{ts, actor, event, target, details}` 五字段。若白板后续接入 Cue–Tag–Content 图（见下），事件流可以承载全部图变更（node.added/edge.added…），使"图重建"与"白板重建"共用同一机制。

---

## MRAgent 机制提炼

MRAgent（arXiv:2606.06036，ICML 2026）是面向 LoCoMo/LongMemEval 长对话 QA 的记忆系统：Phase 1 把对话建成为"联想记忆图"，Phase 2 用 LLM 工具调用循环在图上**主动重建**（而非一次检索）答案。

### 1. Cue–Tag–Content 图

**论文形式化**：异构图 ℳ=(𝒞,𝒱,ℛ)。**Cue 节点**=细粒度关键词（实体、属性、时间、地点）；**Content 节点**=记忆条目（情节事件、语义事实、主题摘要）；**Tag 不是节点，是边的属性**——三元组 (c, g, v)∈ℛ 表示"cue c 经语义桥 g 连到 content v"（论文 HTML v1，Section 3；⚠ 任务书把它当成三种节点，见出入第 5 条）。

**代码中的实现**（`memory/system.py`）：
- **Cue** = `KeyNode`（`memory/system.py:16-35`）：`key_id`（关键词原文）、`tag_list`（该 key 出现过的所有 tag）、`tag_dict: tag → [episode_id]`——即 Cue→Tag 的**倒排索引**；
- **Content** = `EpisodeEvent`（情节事件，`memory/system.py:78-96`）：`event_id`（如 `D1:1-1`）、`text`、`origin`（原始对话轮 id）、`time`（绝对日期）、`embedding`、`conversation_time`；另有 `Topic`（主题摘要节点，`memory/system.py:38-43`：`topic_id` 如 `D1:t1`、`text`、`event_list`）和 `Persona`（按人聚合的个人事实，`memory/system.py:54-75`：`person → tag(aspect) → PersonalEvent[]`）——对应论文的"情节层 / 抽象层 / 语义层"；
- **Tag** = 字符串属性，挂在 `Link(key_id, event_id, event_type, tag)` 上（`memory/system.py:99-104`），同时冗余索引到 `by_tag: tag → [edge_id]`、`event_to_keys`、`key_to_values`（`memory/system.py:112-119`）。

**边类型与语义**：
- **Cue→Tag→Content（正向）**：`key_to_values[key] = {(episode_id, origin)}` + `KeyNode.tag_dict[tag]=[episode_id]`——"实体 c 的 g 方面体现在事件 v"；由 `store_event_new` 建（`agent/agent.py:848-861`）；
- **Content→(Cue,Tag)（反向）**：`event_to_keys[event_id] = {key_id}` + `EpisodeEvent.tag_dict`——事件 v 上可以反查它涉及哪些 cue 与 tag；这是 reverse traversal 的数据基础；
- **Topic→Content**：`topic_to_event` / `Topic.event_list`（`memory/system.py:119, 273-279`）——主题节点挂它辖下的情节事件；
- **Timeline**：`timeline: date → [event_id]`（`memory/system.py:118, 132-134`）——统一时间轴，temporal 工具的数据基础；
- **Persona 边**：`Persona.tag_dict[aspect] = [PersonalEvent]`（`memory/system.py:59-66`）。

图本身是**纯内存 Python 对象**，不落盘；持久化靠 Phase 1 的中间产物（rewrite JSONL / keyword JSONL / embedding pkl），每次运行从缓存重建图（`run.py:165, 184-205`）。

### 2. 主动重建循环

**论文算法**（Algorithm 1，HTML v1）：维护重建状态 𝒮⁽ᵗ⁾=(𝒵⁽ᵗ⁾, ℋ⁽ᵗ⁾)——活动集（当前激活的 cue/tag/content）+ 累积上下文。每步四操作：①从问题抽取 cue，匹配库存 cue 得初始 𝒵⁽⁰⁾；②LLM 选动作 𝒜⁽ᵗ⁾=f_select(x, ℋ, 𝒵)；③受控遍历（应用映射算子）；④LLM 路由剪枝 f_route 丢弃无关候选，ℋ ∪= 新证据。Stop(x, ℋ) 由 LLM 判断证据是否足够——**"累积证据"不是数值分数，是 LLM 的模式判定**（answer 模式输出 answer/supports/confidence；否则 navigate 模式继续调工具）。

**遍历动作集（论文三算子 → 代码落地）**：
- **forward Cue→Tag**：`edges_by_tag(key, tag, note)`——从一个 cue 沿指定 tag 展开其下事件（`agent/tools.py:5-31`；实现 `memory/controller.py:29-48`）；论文的 Π_{c→g}；
- **forward (Cue,Tag)→Content**：即 edges_by_tag 的返回值（事件文本+origin+id）；超过 `RERANK_LIMIT=20` 条时用问题 embedding 余弦取 top-K2（`memory/controller.py:33-47`）；
- **reverse Content→(Cue,Tag)**：`query_event_keywords(event_id)`——从一个事件反查它的全部 keyword 与 tags（`memory/system.py:309-310` → `{"key": k, "tags": [...]}`）；prompt 明示"Often followed by query_event_context"（`agent/tools.py:51-53`）。论文的 Π_{v→(c,g)}，即"检索到的内容派生新 cue/tag 以便转向"；
- 辅助动作：`query_event_context`（事件前后原文轮）、`query_conversation_time`（事件发生的会话时间）、`query_topic_events`（主题下辖事件）、`query_personal_information` / `query_personal_aspect`（人物 aspect 两级下钻）。

**循环骨架**（`llm/controller.py:92-234` `chat_with_tools_once`）：assistant→批量执行 tool_calls→assistant 多轮，直到消息解析出 `{"mode":"answer", answer, supports, confidence}`；**防爆炸的硬约束**：`MAX_ROUNDS=8` 轮（最后一轮强制切换为"只准回答"的 FINAL prompt，`llm/controller.py:140-143`）、`MAX_TOOL_CALLS=50` 总调用安全帽（`llm/controller.py:186-190`）、温度 0（`agent/agent.py:37`）。工具描述里内嵌剪枝纪律："Do NOT repeat the same key–tag combination"、"When exploring, choose at least one tag from each related keyword"（`agent/tools.py:9, 15`）；已查过的 keyword 记入 `queried_keyword` 集合去重（`memory/controller.py:60-64`）。

**剪枝条件总结**：①LLM 自判证据充分（answer/navigate 二选一，confidence 自报）；②同 (key,tag) 不可重复查询 + 已查 keyword 集合去重；③单工具返回超阈值走 embedding rerank 截断（RERANK_LIMIT=20 → K2=20）；④tag 过多时 LLM 给 tag 打 0-1 相关分取前 TAG_LIMIT=10（`EVENT_KEYWORDS_SYSTEM_PROMPT`，`prompts/prompts.py:6-13`；`memory/controller.py:66-92`）；⑤轮数与调用数硬帽。

### 3. 工具集（agent/tools.py 的 schema）

7 个工具（README "Tool inventory (7 tools)"；另有一个被注释禁用的 `score_event_relevance`，`agent/tools.py:135-153`）：

| 工具 | 参数（required 加粗） | 返回 |
| --- | --- | --- |
| `edges_by_tag`（工具面只此一个"遍历"工具） | **tag, key**, note(8-80字决策注记，防跳步) | 该 (key,tag) 下事件 `[id:text]`、origin、ids；>20 条时 rerank 取 top-20（`tools.py:5-31` + `controller.py:29-48`） |
| `query_conversation_time`（temporal） | **event_id** | `Conversation_time:{id}:{date}`（`system.py:303-307`） |
| `query_event_keywords`（keyword，反向遍历入口） | **event_id** | `[{"key","tags":[...]}]`，tags>15 时 LLM 打分选前 10（`controller.py:97-116`） |
| `query_event_context`（context） | **event_id** | 该事件前后各一轮的原始对话文本 JSON（`system.py:319-351`） |
| `query_personal_information`（personal 一级） | **person** | `{"person", "aspects":[tag...]}`（`system.py:312-313`） |
| `query_personal_aspect`（personal 二级） | **person, aspect** | 该 aspect 下 `[origin:text]` 列表（`system.py:315-316`） |
| `query_topic_events`（topic） | **topic** | 主题下辖 `[id:text]` + origins（`system.py:355-367`） |

问题侧入口不在 tools.py 而在 agent 主循环：`extract_question_keys`（LLM 抽问题关键词+同义词/时态变体+时间窗，`prompts/prompts.py:206-219`）→ `evaluate_relations_over_graph`（纯文本匹配把问题 key 映射到图 KeyNode：规范化相等 / token 子集 / Jaccard≥0.6，`memory/controller.py:213-260`）→ AND/OR 分组求值 full/partial match（`memory/controller.py:263-370`）→ 种子证据 + keys_candidates + 相似 topic 一起塞进首轮 user 消息（`agent/agent.py:539-545`）。

### 4. 图构建流程（Phase 1）

编排（`run.py:184-205`；`agent/agent.py:623-744`）：**rewrite → embed → extract_keyword → store**，各阶段产物按 `data/<ds>/rewrite_<model>/<id>_rewrite.json` 等路径缓存、存在即跳过（README §4/§7）。

- **rewrite**（`agent/agent.py:592-621`，`REWRITE_SYSTEM_PROMPT` `prompts/prompts.py:18-55`）：逐句改写为自足句。prompt 原文要点（摘录）：*"1. Replace ALL pronouns … with explicit entities … 3. Use a short concrete noun to describe what the speaker is talking about in 'tag', e.g. Movie Preference, Hobbies. No more than two words. 4. If a sentence uses a relative time … compute the absolute calendar date based on conversation_time and output 'YYYY-MM-DD'. … - Topics: derive at least ten concrete topics overall (short sentences). Assign topic IDs (t1..tn) …"*——**tag 与 topic 都在这一步附加**；输出 schema 含 `sentence[]`（id/text/tag/origin/topic[]/time）、`topics{}`、`personal_sentences[]`（人/事实/aspect）。校验失败带错误信息重试至 3 次（`agent/agent.py:601-619`）；
- **extract_keyword**（`agent/agent.py:669-744`，`KEYWORD_SYSTEM_PROMPT` `prompts/prompts.py:69-87`）：*"For each input sentence, extract 2–30 keywords DIRECTLY from the original text … Do not invent, paraphrase, or generalize … Keyword types: entity | topic | verb | time | location | task | event | people … 'sentence_id' must be same with 'id' in TEXT"*。输入刻意只喂 `{id, text}`，防 rewrite 的 tag/topic 泄漏进关键词（`agent/agent.py:734-743` 注释）；
- **store**（`agent/agent.py:772-862` `store_event_new`）：为每个 keyword 建/取 `KeyNode`，`Link(k, sentence_id, "episode", tag)` 记边，双向写 `key_to_values` / `event_to_keys` / 双侧 tag_dict；**speaker 自动追加为 keyword**（`agent/agent.py:845-848`）；topics 与 personal sentences 分别入 `add_topics` / `add_personal_information`。语义层（summary→semantic memory）代码中已被移除并注明原因"summary is never queried"（`agent/agent.py:780-781`）——论文描述的 Cue–Tag–Semantic 层在当前代码里由 Persona 部分事实承载。

### 5. 计算成本

论文报告（LongMemEval 每 sample，含构建+检索，HTML v1 成本表）：
- **Token**：MRAgent 118k，对比 Mem0 245k、MemoryOS 273k、A-Mem 632k、LangMem 3,268k——最低；
- **运行时间**：MRAgent 586s，Mem0 533s（唯一比它快的），A-Mem 1122s、LangMem 1210s、MemoryOS 3136s——第二快；
- **精度**：LoCoMo Gemini 骨干 84.21 vs 最强基线 Mem0 68.31（相对提升 23.3%，摘要的"up to 23%"即此）；LongMemEval 72.95 vs MemoryOS 54.92（相对 32%）。

**节省的具体环节分解**（论文 + 代码对照）：
1. **遍历剪枝**（最大头）：一次只展开一个 (key,tag) 面，>20 条即 embedding 截断返回 top-20——避免整库 top-k 检索把大量无关文本塞进上下文；
2. **图规模控制 / 结构化注入**：首轮注入的是"种子证据句子 + key/tag 候选 + 相似主题"（`agent/agent.py:539-545`），而非全文；8 轮上限保证上下文线性增长受限；
3. **构建期缓存**：rewrite/keyword/embedding 三阶段产物落盘复用，多轮实验零重复构建（README §7）；
4. 代价：token 省了但轮数多（最多 8 轮 × 多工具调用），所以**墙钟时间并没有比最简单的 Mem0 快**——精度换时间，token 是靠"只注入相关子图"省的。

### 最小机制集（→ 白板场景）

- **节点 schema（简化）**：白板只需两种 Content（state 条目 / dead-end 条目，可加 goals 作第三种）+ 一种 Cue（关键词/文件路径/组件名）。Tag 保留为**字符串边属性**而非节点（任务书的"三种节点"提法需要修正）——tag 用确定性映射：dead-end 条目自动挂 tag `dead-end:<方案名>`，state 条目挂 `topic:<主题>`，文件/模块名自动成 Cue。MRAgent 的 speaker 自动入 keyword（`agent/agent.py:845-848`）对应白板里"涉及文件路径自动入 Cue"。
- **两个遍历动作（简化）**：`expand_tag(tag) → [Content]`（对应 edges_by_tag 的 Cue→Tag→Content 正向，但白板可省去 note 参数与 LLM 打分，直接返回该 tag 全部条目）；`trace_back(content_id) → {cues, tags, 邻接条目}`（对应 query_event_keywords + query_event_context 的反向，返回该条目关联的 cue/tag 及同 tag 邻居）。工具描述里写死剪枝纪律（"不要重复同一 tag"）照搬——这是 MRAgent 防爆炸最便宜的一招。
- **剪枝信号（简化）**：白板是单图小规模（几十条），不需要 embedding rerank 与 8 轮循环；最小信号集 = ①LLM 自判"已能续上工作"即停（answer/navigate 二分，对应 MRAgent 的 Stop 判定）；②已展开 tag 集合去重；③每轮返回条目数硬帽（如 ≤10）。前缀缓存约束下：首轮只注入"白板投影 + 入口 Cue 命中的固定边界段"，遍历结果全部进动态尾部。

---

## 许可证核对

| 仓库 | LICENSE 实况 | 结论 |
| --- | --- | --- |
| miuzel/dsh-graph | 仓库根**无** LICENSE 文件；MIT 许可全文位于 `dsh-graph-host/LICENSE`（"MIT License, Copyright (c) 2026 miuzel"，21 行标准文本），且 `dsh-graph-host/package.json:5` 声明 `"license": "MIT"`；README.md:99 亦写 "MIT（Copyright © 2026 miuzel）"。npm 包（含 LICENSE）即此目录 | MIT 属实，可合法借鉴；但注意许可文本挂在发布子包而非仓库根 |
| Ji-shuo/MRAgent | **无任何 LICENSE 文件**（根目录及全部子目录均无），README/requirements 无许可声明，package.json 不适用（Python 项目） | 默认版权保留：**代码不可复制/再分发**；论文（arXiv）思想与范式借鉴不受限。这也与"只借鉴范式不搬代码"的既定约束一致——对 MRAgent 是硬约束而非偏好 |

---

## 与任务书描述的出入

1. **dsh-graph 判据不是结构化 schema。** 任务书 Q1 猜想"schema 结构是 criterion_type + evidence_required + confidence_level？"——实际判据只是 `## 质量判据` 小节里的编号文本行（自然语言 + `[script]` 脚本约定），无任何字段化 schema（`core/model.ts:146-153`、`schema/SCHEMA.md:87-91`）。R3 设计白板判据时应以"小节 + 行列表 + 占位过滤 + 确认事件"为参照，而非字段级 schema。
2. **"每个阶段是否有强制判据"——实际只有一个门。** 任务书状态机调查项暗示逐阶段检查；实际只有进入 `in_progress` 一处设判据门（rules_snapshot + 小节非空 + criteria.confirmed 三条件，`core/machine.ts:80-90`），其余迁移只查边表合法性。另外真实迁移图含大量非线性边（planning→ready、planning→in_progress、collecting→in_progress、in_progress→collecting、review→in_progress、delivered→review，`core/machine.ts:24-33`），与任务书书写的中断式线性链 `draft→planning→collecting→ready→in_progress→review→delivered`（§B 表格）不完全一致。
3. **graph_handoff 的"环境事实"段是硬编码文案。** 任务书说"board 投影 + 长期记忆 + 环境事实"三元结构——结构属实（`core/ops.ts:339-443`），但"关键环境事实"是写死在代码里的五条本项目 dogfood 事实（executor 注册名、root 覆盖约定等，`core/ops.ts:396-404`），不是可配置或自动采集的机制；长期记忆注入也有 4000 字符截断与 `safeMemory` 防注入清洗这两处任务书未提的细节。
4. **dsh-graph 没有独立"图遍历工具"。** 任务书调查项问"是否有可复用的图查询/遍历逻辑"——实际没有通用遍历 API；最接近的是 `graph_validate`（全量不变式校验 + 依赖环 DFS）与 `graph_rebuild`（事件流对账），以及 `depends_on` 的"声明即建边 + 部分匹配门控"。白板的 expand_tag/trace_back 设计只能借鉴 MRAgent，不能借鉴 dsh-graph。
5. **MRAgent 的 Tag 不是节点。** 任务书 C 项写"三种节点类型的具体定义；Cue→Tag、Tag→Content 的边关系"——论文与代码中 Tag 均为**边属性**（三元组 (cue, tag, content)，代码中为 `Link` 的 tag 字段 + KeyNode/Event 的 tag 倒排），图里真实存在的第三类节点是 **Topic**（主题摘要）与 Persona 事实，而非 Tag。R3 的"当前字段 → 节点类型 → 边关系"映射表应按 cue/tag-边/content/topic 四元修正。
6. **论文与代码的工具命名不一致。** 论文 HTML 列举的工具含 `query_tag_events`，代码实际是 `edges_by_tag`（`agent/tools.py:8`）；论文称"up to 10 tool invocations per turn"，代码是每会话总量 `MAX_TOOL_CALLS=50`（`common/config.py:67`），无 per-turn 限制；论文的 Cue–Tag–Semantic 语义层在代码里已部分移除（summary→semantic 块被删，`agent/agent.py:780-781`），由 Persona 承载。以代码为准。
7. **成本数字有反例需要如实转述。** 任务书 C 项问"论文声称减少 token 和耗时"——token 确实全场最低（118k vs 245k~3268k），但**运行时间不是最低**：Mem0 比它快（533s vs 586s），MRAgent 仅第二快（论文成本表）。节省主要来自遍历剪枝 + 结构化注入，代价是推理轮数增加。
8. **MRAgent 许可风险任务书未覆盖。** 任务书仅确认了 dsh-graph 的 MIT（经核属实，但 LICENSE 文件在 `dsh-graph-host/` 子包而非仓库根）；MRAgent 仓库无任何许可证——本轮新增确认，R3 方案中对 MRAgent 必须保持"零代码复制"。
9. **（核实无误项）** 任务书对 dsh-graph 状态机阶段名、`.dsh-graph` 目录/事件流描述、MRAgent 的 7 工具分组（keyword/topic/personal/temporal/context 五类 + 遍历工具）、"rewrite→extract_keyword→store"三段式流程，均与代码一致，无出入。
