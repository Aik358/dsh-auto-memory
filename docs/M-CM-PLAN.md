# M-CM 集成规划：上下文管理系统（对标 Codex history-notes / new_context）

> 2026-09-06 源码级调查后产出。目标：把"上下文管理"有机接入现有 M1–M7 架构，而不是另起炉灶。
> 功能事实对账以 [NEXT-MAJOR-VISION.md](NEXT-MAJOR-VISION.md) §2 为准；本文件是实施蓝图（路标非权威，实现以代码与测试为准）。

---

## 0. 情报摘要

### 0.1 Codex 真实机制（openai/codex 源码证据，2026-09-06 抓取）

`features.context_management.experimental_mode`（v0.153.0，2026-09-03，默认关）激活三件套：**token 预算上下文 + history notes + `new_context` 工具**。源码事实：

- **笔记是服务端存储**：`codex-rs/ext/history-notes/src/backend.rs` 把 `alpha/notes/v2/write_file`、`append_to_file`、`search_contents`、`alpha/history/v2/search_contents` 全部 POST 到 OpenAI 后端（加密参数头 `x-openai-encrypted-tool-arguments`）。**笔记不在用户机器上。**
- **门槛校验在源码里**：`extension.rs` 要求 `token_budget.use_history_notes_extension && provider.is_openai() && auth_uses_codex_backend()`——API-key 会话、自定义 provider 全部排除。
- **窗口续命 = thread_hint 片段**：`ContextContributor` 在线程启动时调 `alpha/notes/v2/thread_hint`，取回 **≤4KB** 文本，以 `PromptSlot::ContextWindow` + 内容类型 `notes.thread_hint` 注入新窗口。超 4KB 直接判失败不注入。
- **new_context 工具只有一行**：`handlers/new_context_window.rs` → `session.request_new_context_window()`，回执文案 "A new context window will start without summarizing conversation history."——**开新窗是 host 的领地，工具只是触发器**（与我们"插件只助产"的边界判断完全一致）。
- **实现形态 = 扩展 + 四种 contributor**（thread lifecycle / config / context / tools）——OpenAI 自己也把这一层做成插件式扩展，验证了我们在 DSH 插件层做这件事的架构正确性。
- 传统压缩仍在：`model_auto_compact_token_limit`（默认 200K 阈值）、`/compact`、`compact_prompt`；0.154.0-alpha 在 TUI 加"实时压缩状态"。

### 0.2 Anthropic 路线（对照）

[Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)（Agent 在本地 memory 目录 CRUD 文件）+ [Compaction](https://platform.claude.com/docs/en/build-with-claude/compaction)（2026-01 beta，API 级自动压缩）+ context editing。模式 = **有损压缩 + 无损旁路（文件笔记）双轨**。痛点：Claude Agent SDK 的压缩边界对调用方不可见（[SDK issue #772](https://github.com/anthropics/claude-agent-sdk-python/issues/772)）——印证"压缩预告事件"是行业缺口。

### 0.3 Letta/MemGPT 路线（开源先例）

OS 式记忆分层：core memory（上下文内的 self-edited memory blocks，"RAM"）vs archival memory（上下文外的外存，"磁盘"，按需检索拉入）——[Agent Memory](https://www.letta.com/blog/agent-memory/) / [Memory Blocks](https://www.letta.com/blog/memory-blocks/)。开源、本地、Agent 自编辑记忆——与本插件同宗，但其为独立框架，我们为宿主内插件。

### 0.4 命名澄清（2026-09-06 boss 纠正）

"Extra"是误传——boss 所指即 **Astra 本身**：GPT-6 Astra（2026-09-03 发布，9/4–9/5 铺开 Business/Pro）带来的**一套新的上下文机制**（中文媒体口径："上下文窗口填满时不再只靠压缩摘要，而是跨上下文窗口的笔记保留，可检索此前的需求/测试结果/工具输出"，另有 105 万 token 窗口、12.8 万最大输出）。机制挂 Astra 名下，Codex 侧配置键 `context_management.experimental_mode`，将成 Astra 默认。本文 §0.1 的源码级机制调查即该机制的实现细节。

## 1. 对账：现有架构 vs 三家机制

| 能力 | Codex | Anthropic | Letta | 本插件现状 |
|---|---|---|---|---|
| 任务态笔记 | 服务端 alpha/notes（厂商托管） | 本地 memory tool 文件 | core memory blocks | 四层记忆+治理式写回（本地已有；**缺任务态四段结构**） |
| 新窗续命注入 | thread_hint ≤4KB 片段 | —（SDK 压缩黑盒） | core memory 常驻 | 固定边界注入动态快照（**已 live，缺 handoff 专用片段**） |
| 归档可搜索 | 服务端 search_contents | context editing 清理 | archival+检索 | evidence store+词法/语义双臂（已 live）；**会话帧未索引** |
| 开新窗 | new_context 工具触发 | 自动压缩 | 自动分层 | DSH host 领地（**未接**） |
| 水位感知 | session/token_budget.rs | SDK 阈值 | 自动 | M2 ContextObserver 可投影（**未接**） |

结论：四件套里**两件半已存在**，且两处比 Codex 强（本地所有权、语义双臂）。缺的是四件事——正是 M-CM1..4。

## 2. M-CM1 四段式交接笔记（结构化 ledger）

- **存储**：`workspaces/{workspace}/handoff/YYYY-MM-DD-HHMM-{slug}.md`。四段 schema：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`，头部 front-matter（workspace、触发原因、关联会话 id）。
- **白板层（PLAN.md，2026-09-06 启发新增）**：模型随任务推进理解全貌后，用**人能理解的方式**重写 `workspaces/{ws}/handoff/PLAN.md`——整个项目的规划图（"白板"）；后续交接只在此快照上增改，每次重写旧版自动移入 `handoff/archive/PLAN-<ts>.md` 保留更改历史。与四段式 ledger 的关系=git 的树与提交日志：PLAN.md 是当前树，ledger 是 commit 历史。PLAN.md 注入优先级高于单篇 ledger。
- **白板的用户面（HCI 联动，同日补）**：白板不只给模型——**用户（尤其探索中/思路混乱的用户）靠它实时看见自己**：做了什么（ledger 时间线）、走错了哪些路（"已试方案与失败原因"段）、改了哪些东西（PLAN 版本 diff）。这是外化认知/共享 grounding 工件：用户与 Agent 对照同一张图对齐。落点：①面板新增「白板」视图（PLAN 当前版+版本切换+ledger 时间线，复用 notes/logs 渲染管道）；②写入者与**回合末固化 prompt 同源同钩**（见上条——主模型每轮固化时一次产出两份：流水→日志/项目记忆，全貌增改→PLAN.md）；③与每日反思互补：反思是回顾（昨天），白板是并发（现在）。
- **写入者三入口（2026-09-06 二次修正，术语钉准）**：①**回合末固化 prompt**——主大模型每轮对话结束时亲自把内容固化进项目记忆，PLAN.md 增改挂进同一时刻同一 prompt（理解全貌的正是主模型，白板由它写才是第一手理解）；②`memory_note` 工具显式写（M-CM2）；③水位触发自动写（M-CM4）。**子代理层（晋升判断：每日→长期、画像内容）是另一层，不写白板**——它是 PLAN/ledger 的消费方：晋升判断时读白板作为依据。全部过 `sanitizeForWrite` 门禁（34 特征 + 8000 字/条）。
- **生命周期**：最近一篇进入注入快照首位（见下）；90 天归档复用 Hermes 规则；**用户可直接读改**——这是与 Codex 服务端加密笔记的根本差异。
- **注入（我们的 thread_hint）**：动态快照首位加"接续摘要"片段——handoff 最新一篇的压缩版（对齐 Codex 4KB 上限教训，设硬预算并给 evidence 引用），内容类型 `handoff.hint`，走既有 M6 固定边界，前缀缓存纪律不破。

## 3. M-CM2 主动检索工具（2026-09-06 质询后修订：扩展现有工具面，不新增平行工具）

> **质询记录**：`memory_note`/`memory_recall` 已存在（前者写项目笔记、后者 AI 扩展关键词的会话式检索）。原计划"新增两个同名工具"属冗余设计，工具面污染会让模型选择混乱。修订如下。

**与现有工具的真实差异（三维度）**：
1. **语料**：现有工具只能搜四层记忆（用户级/项目笔记/日志/反思）；handoff ledger（M-CM1）与会话帧归档（M-CM3）是**任何现有工具都摸不到的新地面**——尤其会话帧=记忆化之前的原始材料。
2. **调用语义**：`memory_recall` 是重型路径（AI 扩展关键词→会话式回答），面向"回答问题"；Agent 在工作循环里自用需要**轻量直返**——它就是查询的发出者，不需要别人替它扩展关键词，要的是结构化命中（条目+引用+预算截断）。
3. **归宿**：检索结果是 advisory 素材，进 M6 固定边界仍受治理——权限分立不因新工具改变。

**修订后的落点（扩展现有工具，收敛工具数）**：
- `memory_recall` 增 `scope` 参数：`notes|logs|reflections|handoff|sessions|all`（默认 `all`，行为向后兼容）；scope=handoff/sessions 时走轻量直返（不做 AI 扩展，直接 BM25/语义命中），返回带 evidence 引用（复用 M5 cite 规范）与硬预算截断（对齐 Codex 4KB 教训）。
- `memory_note` 增 `kind: handoff` 参数：写四段式 ledger（§2 schema）；缺省行为不变（写项目笔记）。
- 门控代理注册不变（CUA 先例；**ctx.get() 坑**规避）；**未命中必须可见**并进审计页（§8.4.3）。
- 例外条款：若实测发现"轻量直返"与"会话式回答"在同工具内语义打架（参数爆炸/模型误用），再拆独立 `memory_search`——拆分是后备，不是起点。

## 4. M-CM3 会话帧索引（可搜索归档，零复制）

- **不新建存储**：DSH 已把会话持久化为 `session.jsonl.zstd` 帧（v0.1.29 已解压读 cwd）。M-CM3 做**索引而非复制**——增量为王。
- 索引器：增量扫描 profiles 会话目录 → digest 去重 → 按 user/assistant/tool 分条 → 词法倒排（复用 lexical_pre_v2）；语义向量仅对 C2/Python 档启用（复用 M7 index_sync 的 digest/分页思路）。
- 入口：`memory_search scope=sessions`，结果带时间戳与帧位置引用——"笔记没捕获的细节"由此可寻。
- 边界：凭证段过滤**先于**入索引；脏 token 拒入；索引元数据落 memoryRoot 独立目录，可整体删除。

## 5. M-CM4 水位感知与压缩联动

- 水位估计：M2 ContextObserver 已投影上下文——先做回合 token 估算的启发式 fill ratio；若 DSH 暴露真实 token 计数则直连。
- 行为：fill ≥ 80% → 注入 advisory 尾注（"上下文将满，建议开新会话——交接笔记已就绪"）+ 自动写/刷新 handoff；无人值守模式下 advisory 静默（不打断批处理）。
- 压缩预告事件：若 DSH host 有则订阅，压缩发生前自动落 handoff；若无 → **向 DSH 提 feature request**（Anthropic SDK #772 同款痛点=行业缺口，提案有据）。
- 边界重申：开新窗/压缩是 host 领地，插件只提示与助产（与 Codex new_context 设计同理）。

## 6. 差异化事实（宣传可直接引用，全部有源码/文档依据）

1. **本地优先**：Codex 笔记在厂商侧加密存储；我们在用户盘上的纯 Markdown。
2. **模型无关**：Codex 源码硬校验 ChatGPT backend；我们任何模型、任何 provider（含自定义代理）。
3. **可读可改**：Codex thread_hint 服务端生成、只读；我们的 handoff 用户直接编辑。
4. **检索更强**：词法/语义双臂 + 67 条人工金标（actPrecision 0.917、有害注入 0）。

## 7. 排期与验收

| 顺序 | 里程碑 | 依赖 | 验收 |
|---|---|---|---|
| 1 | M-CM1 交接笔记 | 无（纯插件侧） | schema+PLAN 白板层+三写入者+注入片段；smoke（真实函数抽取驱动）+ 复放 precision 不回退 |
| 2 | M-CM2 检索扩展 | CM1 存储 | memory_recall scope 扩展+memory_note kind=handoff；门控代理 E2E：调用/回执/审计；检索复放 |
| 3 | M-CM3 会话帧索引 | 双臂就绪 | 索引覆盖率+增量正确性；scope=sessions 复放召回 |
| 4 | M-CM4 水位联动 | CM1 自动写 | 模拟水位→advisory+handoff 自动落盘；无人值守静默 |

宣传联动：CM1+CM2 live 后，README「她怎么交接」占位章换实装说明，摘除三处"即将上线"标注（位置清单见记忆存档）。

## 8. 批判性分析：理论依据、局限与设计修正（2026-09-06）

### 8.1 机制还原——它不玄幻，是"压缩时点搬家"

三种机制都是信息的投影，区别只在**投影时机与投影函数的输入**：

| | 压缩（compaction） | 笔记（notes） | 检索（search） |
|---|---|---|---|
| 时机 | 事中，窗口将满时盲压 | 写入时（当时有全量上下文） | 读出时（带着未来查询） |
| 输入 | 仅历史 | 历史+写作时的任务理解 | 查询本身 |
| 损失 | 固定、不可追回 | 有损但经策展 | 对被查询的切片近似无损 |

"不再压缩"是话术：hint 是摘要、笔记是写时压缩、检索结果是读时压缩。**压缩没有消失，是搬到了信息更充分的时点，且原始数据保底可查。** 查询分布不可知时，懒惰求值（检索）优于预计算（摘要）——但仅对"知道要找什么"的信息成立。

### 8.2 两个诚实的"不能"

1. **"切了比压缩保留得全"不无条件成立。** 对定向问题（"那个测试为什么失败"）检索完胜摘要；对弥散性知觉（"还有哪些没说但相关的"），一条好摘要可能优于空档案馆——**模型不知道自己不知道**：hint 没提 X、模型又没想到搜 X，X 就等于丢了，这点上甚至不如压缩（摘要可能顺嘴提过 X）。对策=双层：hint/四段式管弥散层，检索管定向层，缺一不可。
2. **"能力一条直线"不存在。** 没有任何系统让单窗能力恒定；长程（如 Anthropic 1-2 天跑大项目）的真相是把**工作**做成可恢复，让多个窗口串联表现得像一条线：环境即状态（文件/git/测试），上下文只是工作集。已知配方：子代理隔离（每子任务新窗）+ 文件状态 + 压缩 + memory tool + 验证回路 + 为长程任务训练的模型（Anthropic 公开了 compaction/memory tool 文档，比 OpenAI 透明）。断线风险清单：冷启动缺默会状态、重议已决事项、hint 锚定偏差、笔记腐烂与矛盾累积、检索静默失败。

### 8.3 Astra 机制的隐藏依赖（源码推断，批判点）

- **笔记由 Agent 自觉书写**——质量押注在模型自编辑纪律上，"机制成功"与"模型够强"未解耦；弱模型同机制可能不如好压缩。
- **hint 服务端生成、只读、≤4KB**——用户不可审计，超限直接不注入。
- **仅 ChatGPT backend**——排除自定义 provider，等于只在自家受控栈内开闸。
- 推论：它玄幻，部分因为把难度藏进了"模型够强+自家后端"两个前提里。**我们的机会=把质量从模型自觉中解耦**：host 侧触发（里程碑/水位）+ 固定 schema（弱模型也能填表）+ 本地可审计。

### 8.4 设计修正（批判 → M-CM 决策）

1. hint 不做黑盒：本地四段式 handoff，用户可读改（§2）——checklist 化对抗 unknown unknowns。
2. 笔记不押模型自觉：三入口触发含 host 侧强制（里程碑判定+水位），固定 scaffold 填空（§2/§5）。
3. 检索失败必须可见：memory_search 未命中也回报并进审计页——**静默失败是 handoff 路线的头号隐患**（§3）。
4. 防笔记腐烂：handoff 带 supersede 语义（新交接标注取代旧交接），旧篇并入 30 天蒸馏泵（§2）。
5. 防重议已决事项：注入片段含"目标与已决"段（四段式承担），advisory 口吻。
6. 漂移自检（P2 可选）：新会话首轮 advisory 建议模型对照 handoff 复述当前计划——廉价 drift check，不做硬拦截。
7. 期望管理：fill-ratio 是启发式，advisory-only；evidence 链与固定边界纪律不动摇。
8. 宣传口径对齐：对外不承诺"比压缩更全"，承诺"该全的地方全（定向检索）、该连的地方连（结构化交接）、且全程你可审计"。

## 9. 风险与开放问题

- **子代理派生（2026-09-06 更新：可行性升级）**：DSH 一切皆插件、自由度高（boss 确认），派生子代理可行性高——长任务在水位高+任务可分解时派子代理=上下文隔离的天然单元（Anthropic 配方核心件）。仍需调查：具体派生 API/事件形态。插件侧三件事不变：①子代理产出自动沉淀为 handoff/PLAN 增改（M1 会话隔离 + `_ownSubagents` 识别已有底子）；②子代理注入策略适配（吃不吃记忆注入、吃哪层——实测定）；③"何时值得派"的 advisory。派生决策权在 host+模型，插件助产不夺权。
- **memoryRoot git 化（可选增强）**：历史保留当前用 archive 副本；若环境有系统 git 可对 memoryRoot 做轻量自动提交（零依赖约束→git 存在才启用，缺失降级副本）。
- DSH 是否暴露 token 计数/压缩事件——**待验证**；无则 M-CM4 降级为启发式 + feature request。
- 会话帧索引隐私边界：凭证段过滤必须先于索引器上线，顺序不可倒。
- 工具返回的 token 预算：对齐 Codex 教训设硬上限（hint ≤4KB 的同款纪律），超出部分给 evidence 引用让模型按需 `memory_search` 深查。
- 工具调用的用户可见性：复用唤起回顾审计页，避免"黑箱工具"观感。
