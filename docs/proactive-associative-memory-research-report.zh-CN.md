# 面向异构大语言模型 Agent 的宿主侧主动联想记忆中间件

## 研究综述、原生 DSH 对照、架构设计与实施路线

- **项目**：dsh-auto-memory
- **文档类型**：正式研究与架构报告
- **版本**：1.0
- **日期**：2026-08-19
- **状态**：设计基线，尚未代表全部功能已经实现
- **研究范围**：长期记忆、工作记忆、上下文触发检索、程序性记忆、推理轨迹可监测性、DSH 原生 Agent 组合与 Host 侧上下文注入

## 摘要

现有大语言模型 Agent 记忆系统已经分别覆盖长期记忆存储、上下文分页、语义检索、事件反思、程序技能库和多类型记忆管理。然而，多数系统仍遵循以下模式：模型或 Agent 显式调用记忆工具，记忆服务接收查询后返回结果，再由 Agent 自行决定是否将结果放入上下文。

本报告研究另一种运行时边界：由模型外部的 Host 侧记忆中间件持续观察用户消息、工具调用与结果、可见助手输出、运行时事件以及可选 reasoning trace；中间件对滑动上下文窗口和记忆库做关联匹配，在模型下一次请求形成前主动生成并注入一个有预算、有来源、有生命周期的 memory packet。该机制旨在模拟人的联想性记忆：记忆不只在主体主动检索时出现，也可能由当前情境自动激活。

截至本报告检索范围和日期，尚未发现一个成熟系统同时实现以下完整组合：Host 外置持续观察、无需模型显式调用的自动预取、下一请求边界注入、跨 Provider 能力协商、公开与闭源模型的统一退化方案、会话隔离以及可解释、可撤销的记忆治理。因此，该方向具有明确的工程研究空间，但创新点应表述为**系统组合与运行时机制的原创设计**，不宜未经系统性检索而宣称世界首创。

## 1. 研究问题与判定口径

### 1.1 目标机制

本报告将“Host 主动联想注入”严格定义为：

> 记忆层位于模型和 Agent loop 外部；持续消费可观测运行时上下文；无需模型显式调用 memory 工具即可检索潜在相关记忆；并在下一次模型请求形成前，将受控的 memory packet 放入该请求。

目标数据流如下：

~~~text
action or context event
  -> ContextObserver
  -> sliding-window representation
  -> associative retrieval
  -> InjectionBroker
  -> next model request
~~~

### 1.2 三种容易混淆的能力

| 能力 | 触发者 | 是否属于完整 Host 主动能力 | 说明 |
|---|---|---:|---|
| 模型调用 memory_search | 模型或 Agent | 否 | 记忆层提供工具，但触发时机由模型决定 |
| 每轮结束后自动保存或召回 | SDK 或 Agent 框架 | 部分属于 | 可能自动化，但不一定观察模型运行中的上下文，也不一定主动注入 |
| Host 观察上下文并在下一请求前注入 | Host 中间件 | 是 | 本报告的目标机制 |

### 1.3 已发出请求的物理边界

模型请求发出后，Host 通常不能原地修改模型已经使用的隐藏状态。因而主动记忆应按介入时机分级：

1. **下一步注入**：在 pre-step 或下一次模型调用边界生成 memory packet。
2. **工具结果后注入**：工具返回成功、错误或新状态后，重新计算上下文，并在模型继续运行前注入。
3. **流式中断并续写**：在高置信度条件下取消当前生成，带记忆重新发起请求。

前两级适合默认实现。第三级会涉及重复工具调用、已展示文本无法撤回、额外 Token 成本、KV cache 不可恢复和副作用重放风险，只应作为高阈值实验能力。

## 2. 当前 dsh-auto-memory 基线

当前插件已经具备一个可用于演进的 Host 侧基础：

- 用户级记忆、项目笔记、每日日志和反思等持久化层。
- 系统提示词中的 memory_system 注入块。
- 每轮结束后的自动沉淀与长期记忆升格。
- 智能检索、外部 AI 工具记忆接入和日历上下文。
- agent/session-start、agent/turn-stopping 与 agent/pre-step 生命周期钩子。

当前代码中的关键位置包括：

- MemoryEngine 状态与持久化引擎：lib/index.js 第 123 行附近。
- renderMemory() 固定记忆块渲染：lib/index.js 第 611 行附近。
- consolidateTurn() 每轮自动沉淀：lib/index.js 第 1386 行附近。
- agent/turn-stopping 生命周期处理：lib/index.js 第 2134 行附近。
- agent/pre-step 首步和轮间刷新：lib/index.js 第 2148 行附近。

当前实现更接近“文件记忆加固定预算提示注入器”，还不是按当前任务动态选择记忆的调度器。演进时需要特别注意：进程级状态、最近 Agent 引用和全局沉淀队列可能在多个顶层会话并发时造成工作区或上下文串线。因此，主动联想层上线前应将运行时状态按 sessionId 隔离。

## 3. 原生 DSH Agent 组合方式及其启发

本节不是外部论文综述，而是对当前安装的原生 DeepSeek Harness 实现的直接代码审阅。审阅对象位于：

~~~text
C:/Users/JH Z/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/
~~~

### 3.1 Host composition 与 Agent preset 的两平面模型

原生 DSH 的标准 Cordis preset 明确区分两个平面：

- **Host composition**：共享注册表、持久化、sandbox 与 approval 栈、模型路由、subagent 注册表及其后端等跨会话能力。
- **Agent preset**：单个会话贡献的 persona、工具、提示词 section，以及必要时由 isolate realm 拥有的会话级服务。

对应原生配置文件：

- cordis preset：config/agent-presets/cordis/agent.cordis.yml。
- minimal preset：config/agent-presets/minimal/agent.cordis.yml。
- preset 元数据：config/agent-presets/minimal/preset.yml。

这对主动记忆的直接启发是：

| 记忆能力 | 建议归属 |
|---|---|
| MemoryStore、事件总线、Embedding 索引、审计记录 | Host plane |
| SessionRuntime、Working Memory、冷却状态 | Agent 或 session scope |
| Provider capability adapter | Host plane，由每个请求读取当前模型能力 |
| MemoryPacket 生成与注入 | Host 生命周期层，在下一请求边界执行 |
| 面板配置与用户可见审计 | Host route 加 client UI |

如果把跨会话记忆状态放进单个 Agent preset，多个会话无法共享正确的用户级或项目级记忆；如果把所有工作状态做成进程级变量，又会产生会话串线。正确边界是 Host 持有共享服务，SessionRuntime 持有 per-session 状态。

### 3.2 Minimal preset 的工具设立方式

原生 minimal preset 的描述是“仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent”。其 persona 配置使用 complete: true，并设置 includeRuntimeContext: false。它通过两个隔离 group 设立模型可见能力：

1. persistent-shell group：注册 PTY、terminal-bash 和 persistent-bash。
2. filesystem group：注册 fs-local 和 str-replace-editor。

其中 persistent-bash 的配置明确了超时、持久 shell 状态和工具说明；str-replace-editor 使用独立配置并限制 maxOutputChars。Minimal 的关键语义是：persona 是完整 system prompt，后续全局身份、Web 方向、工具说明和后续 assembly listener 不能继续向其中添加文本；同时不启用 runtime context 和 compaction。

这对主动记忆有一个重要限制：记忆中间件不能假定所有 Agent preset 都允许通过传统 systemPrompt section 追加易变内容。稳定规则与动态快照必须分层，并且必须支持至少三种注入适配模式：

- **Native runtime-context projection**：当前维护路径。稳定规则保留在 systemPrompt.section()；工作区、日志、反思等易变快照注册到 systemPrompt.context()，由 DSH 在 assemble 后生成 RuntimeContextProjection，按完整快照文本去重、替换或清除。它受 preset 的 includeRuntimeContext 控制。
- **Next-step user/message**：未来主动 MemoryPacket 路径，像原生 workspace instruction 插件一样，将经过版本、预算和安全门校验的 packet 排入下一步消息 Inbox。它不是当前 runtime-context projection 的替代写法。
- **Opaque fallback**：preset 禁止 runtime context 且尚未提供独立 packet surface 时，只做 shadow retrieval、审计和下一轮可用的外部状态准备，不强行改写当前模型上下文。

### 3.3 原生 dsh-agent-instructions 的动态注入模式

原生 @deepseek-ai/dsh-agent-instructions 插件提供了一个与主动记忆高度相关的实现参照。其 README 描述的关键机制如下：

1. 每个实时会话第一次符合条件的 agent/pre-step 会组合基线。
2. 下游决策允许非空的第一步批次后，基线被折入最终批次，紧随已经领取的直接提示词，并共同进入第一次请求。
3. 如果第一步被拒绝或为空，基线会留在 Agent 的 next-step inbox，等待后续唤醒。
4. 插件观察第一方 read、write、edit 成功后的结构化 tools/result 事件。
5. 文件 scope 的新增、改变、移除通过带来源的 user/message 事件进入会话。
6. 路径、版本和 SHA-1 digest 未变化时不重复注入。
7. 动态 batch 如果没有可提交变更，则不注入，并在后续 touch 中重试。
8. pre-step 会等待已排队投影完成，再把新的上下文折入最终批次。
9. 没有文件 watcher，磁盘变化由下一次成功的结构化 fs touch、恢复对账或 pre-step 恢复边界感知。
10. 每个 scope 和整个渲染结果都有明确的 maxBytes 预算。

原生插件因此证明了一种重要的 DSH 运行时模式：

~~~text
structured runtime event
  -> scoped state and digest comparison
  -> per-agent pending inbox
  -> pre-step await and merge
  -> next model request
~~~

这不是主动联想记忆，因为它监听的是工作区 instruction 文件，不做语义匹配；但它已经提供了未来 packet 路径需要的 Host 注入骨架。当前 M0/M1 动态维护不复制这条 Inbox 消息，而使用 DSH 原生 systemPrompt.context() projection。后续主动联想层才可将“文件 scope 对账器”替换为“上下文滑窗观察器和关联检索器”，并保留 per-agent inbox、版本校验、预算、去重和 pre-step 合并边界。

### 3.4 原生模式对本项目的实现约束

基于原生 DSH 结构，主动记忆插件应遵守以下约束：

- 记忆观察器和索引服务必须注册在 Host plane。
- 运行时上下文、packet 冷却和 contextVersion 必须按 sessionId 隔离。
- 动态 packet 不能依赖模型主动调用 memory 工具才出现。
- 已经发出的请求不能原地修改，必须排队到下一请求边界。
- 每次注入都需要有界预算、来源、版本、去重键和过期策略。
- 对 complete persona 或禁止 runtime context 的 preset，必须安全降级。
- 稳定记忆纪律和高频变化的 runtime-context snapshot 应分离；未来 MemoryPacket 也应单独预算，以减少提示缓存击穿。

## 4. 相关理论与学术工作

### 4.1 CoALA：认知类型的基础骨架

Cognitive Architectures for Language Agents（CoALA）将语言 Agent 的记忆划分为 working、episodic、semantic 和 procedural memory，并讨论相应的读取、写入、更新和行动接口。[1]

这为本项目提供了最清晰的类型骨架：

| CoALA 类型 | 在本项目中的建议映射 |
|---|---|
| Working memory | 当前会话的滑动上下文、目标、未解决事项和待处理记忆包 |
| Episodic memory | 带时间、来源、结果和工具轨迹的会话事件 |
| Semantic memory | 去重后的项目事实、决策、环境约束和稳定偏好 |
| Procedural memory | 经多次成功验证的步骤、检查清单和技能 |

CoALA 是架构设计空间，不是已经验证的 Host 主动注入实现。它定义“记忆是什么”，没有替本项目决定“何时自动唤回”和“如何治理冲突”。

### 4.2 Generative Agents：联想召回和反思的经典原型

Generative Agents 使用 memory stream 记录观察，以相关性、近期性和重要性进行检索，并定期通过 reflection 将事件压缩为更高层的语义记忆。[2] 其工程启发可以概括为：

~~~text
activation = relevance + recency + importance
~~~

这与本项目的“情境触发联想”高度相关，但原始系统运行在定制的社会模拟 Agent 循环内，尚未解决通用 Host 事件总线、跨会话隔离、来源和权限、记忆删除、冲突处理以及误注入伤害评测。

### 4.3 MemoryBank：衰减、强化和长期巩固

MemoryBank 对长期对话记忆进行抽取、存储、检索和更新，并借鉴 Ebbinghaus 遗忘曲线设计记忆衰减与强化机制。[3] 可借鉴的不是某个固定衰减参数，而是三个原则：

- 记忆的可用性应随时间变化，而不是永久固定。
- 成功复用和独立会话中的重复确认可以强化记忆。
- 事件记忆需要经过后台整合，才适合升格为长期语义事实。

### 4.4 MemGPT 与 Letta：上下文分页和外部记忆

MemGPT 将有限的主上下文与 core、recall、archival memory 组织成类似虚拟内存的分页系统。[4] Letta 延续了状态化 Agent 和分层记忆运行时的思路。[5]

这组工作最适合借鉴到本项目的上下文预算和 memory packet 管理中。差异在于：MemGPT 和 Letta 的主要控制路径仍是 Agent 显式调用记忆函数或由其运行时管理内存；本项目希望把“是否值得想起某条记忆”的第一判断移到 Host 侧，并且不要求模型先调用 memory 工具。

### 4.5 Reflexion：结果驱动的情景经验

Reflexion 在一次试验结束后依据反馈生成 verbal reflection，并将其保存为 episodic memory，供后续尝试使用。[6] 对本项目而言，测试失败、工具错误、用户纠正和任务成功结果都可以成为情景记忆的证据来源。

但反思文本不能直接被视为事实或程序。错误的自我解释可能被持久化，因此需要 provenance、结果证据和候选技能生命周期。

### 4.6 A-MEM：动态关联记忆图

A-MEM 受 Zettelkasten 启发，为新记忆生成摘要、标签和上下文，并与相关旧记忆建立链接，允许邻居节点继续演化。[7] 它为本项目的关联图提供了有价值的参考：记忆不是互相独立的向量条目，而可以形成语义邻居、因果关系、时间关系和替代关系。

主要风险是写入、链接和重写高度依赖 LLM，可能产生较高延迟和成本，并造成图漂移或错误传播。第一版应采用追加式证据和可撤销边，避免直接重写大量旧记忆。

### 4.7 MemOS、MIRIX 与系统化控制面

MemOS 将记忆抽象为独立于模型的系统资源，强调记忆对象、生命周期、调度和跨应用管理。[8] 这与 Host control plane 的目标最接近，但需要区分架构愿景和已经在任意闭源 Provider 上验证的能力。对于闭源 API，Host 能可靠控制的主要仍是 plaintext/context memory，不能假设可以直接操作模型激活或参数记忆。

MIRIX 通过 Memory Manager 协调多种专门记忆 Agent，覆盖 core、episodic、semantic、procedural、resource 和 knowledge-vault 等类型。[9] 它适合借鉴类型路由和多 Agent 管理，但应注意额外 LLM 调用成本、路由误差、隐私边界以及正式发表状态。本报告将 MIRIX 按公开 arXiv 预印本和开源项目参考，不将未核实的会议状态表述为正式同行评审成果。

### 4.8 LongMem、HippoRAG 与关联检索

LongMem 研究将 memory bank 与生成模型解耦，以处理超出上下文窗口的长期依赖。[10] 它支持“记忆后端与生成模型分离”的方向，但更偏模型结构与训练，不是包裹任意闭源 Agent 的中间件。

HippoRAG 将实体关系图与 Personalized PageRank 结合，用关联传播实现多跳检索。[11] 该思想可用于本项目的 semantic memory graph，但原始目标是知识库检索，不直接处理会话滑窗、事件时间性、程序验证和注入时机。

### 4.9 Voyager：程序技能库

Voyager 在开放式 Minecraft Agent 中将经过环境验证的代码技能保存为可检索的 skill library。[12] 它说明程序性记忆不能只靠语言描述判断，应尽可能拥有可执行的成功标准。通用 Host 中间件需要把这一点转化为候选、验证、启用和回滚机制。

## 5. 开源项目能力对比

| 项目 | 主要能力 | 是否等同于 Host 主动联想注入 | 本项目可借鉴部分 |
|---|---|---:|---|
| Mem0 | 长期记忆抽取、更新、向量和图检索 | 否 | 事实更新、来源和生产化存储 |
| Letta | 状态化 Agent、core、archival、recall memory | 否 | 上下文分页与状态化运行时 |
| Graphiti | 时间知识图谱与关系变化 | 否 | 时间关系、实体和冲突检索 |
| LangMem | 语义记忆、程序记忆、异步管理 | 否 | 后台抽取与类型化记忆 |
| Hindsight | retain、recall、reflect 生命周期 | 否 | 记忆生命周期与反思分层 |
| A-MEM | 动态记忆节点与语义链接 | 部分接近 | 关联图和邻居传播 |
| MIRIX | 多 Agent、多类型长期记忆 | 否 | Memory Manager 与类型路由 |
| MemoryOS | 个性化 Agent 的 Memory OS | 否 | 控制面、资源和生命周期 |
| NeuroMem | 位于客户端与上游模型之间的记忆中间件 | 部分接近 | 请求级中间件边界和结构化上下文 |

核心判定是：这些项目大多提供记忆后端、SDK 或 Agent 内部运行时；“持续观察滑动上下文并在模型未显式调用时预取”仍不是它们共同具备的能力。

## 6. 推理轨迹与监测信号

### 6.1 可见 CoT 不是完整内部状态

以下研究对“把公开思维链当作 EEG”这一设想提出了必要限制：

- Language Models Don't Always Say What They Think 发现模型可能不披露真正影响答案的因素。[13]
- Measuring Faithfulness in Chain-of-Thought Reasoning 通过干预和截断等方法评估 CoT 忠实性，显示忠实性依赖任务和模型。[14]
- Anthropic 的 Reasoning Models Don't Always Say What They Think 发现推理模型并不总是报告真正影响其答案的线索。[15]
- OpenAI 的 Detecting Misbehavior in Frontier Reasoning Models 展示了可读 CoT 对独立监视器的潜在价值，同时说明监视和训练压力可能改变模型的表达行为。[16]
- Monitoring Monitorability 将 monitorability 本身视为需要持续测量的系统属性，而非稳定假设。[17]

因此，公开 reasoning trace 应被建模为：

- 可选的上下文片段。
- 低到中等可信度的触发特征。
- 临时信号，默认不直接写入长期记忆。
- 需要按 Provider、模型版本和输出协议进行能力协商与校准。

它不应单独用于写入事实、授权工具或外部副作用、判断模型真实意图，或将某个流程晋升为 active procedure。

### 6.2 闭源模型的退化方案

当 Provider 不暴露 reasoning trace 时，ContextObserver 仍可以消费：

- 用户输入和会话目标。
- 工具名称、参数、结果和错误。
- 可见助手输出。
- 重试、重复调用和工具调用顺序。
- 用户纠正、拒绝或追加约束。
- 未解决事项持续时间。
- Agent 生命周期事件。
- 现有锚定监控插件提供的波段、强度和趋势等外部运行时信号。

这意味着公开 reasoning 是增强器，不是主动联想系统的前提。

### 6.3 Provider capability negotiation

不要按模型名称硬编码“GPT 不公开、DeepSeek 公开”等固定假设。建议由 Provider adapter 声明能力：

~~~json
{
  "reasoningVisibility": "none | summary | full | unknown",
  "toolEvents": true,
  "streamChunks": true,
  "runtimeContext": "native | none",
  "packetPatch": "pre-step | user-message | none",
  "abortAndResume": false
}
~~~

能力协商必须按 Provider、模型、版本和具体会话生效。runtimeContext 表示原生 systemPrompt.context() 是否可用，packetPatch 表示未来 MemoryPacket 的 next-step surface；二者不是同一注入通道。reasoning trace 即使可见，也应被标记为模型生成的观察信号，而不是完整内部状态。

## 7. 建议的目标架构

### 7.1 组件分层

建议把现有文件记忆引擎逐步演进为以下组件：

~~~text
ContextObserver
  观察用户、工具、可见输出、运行时事件和可选 reasoning

SessionRuntime
  按 sessionId 保存 working memory、上下文环、版本号和冷却状态

AssociationEngine
  对上下文片段和记忆索引做关键词、实体、向量和图关联检索

InjectionBroker
  根据相似度、置信度、风险、预算和认知状态决定是否注入

ProviderCapabilityAdapter
  描述 reasoning 可见性、工具事件、流式能力和中断续写能力

EvidenceUpdater
  根据工具结果、用户纠正和任务成败更新记忆证据

MemoryStore
  保存结构化 sidecar，并继续生成 Markdown 可读投影
~~~

### 7.2 正交的记忆维度

认知类型、持久范围和生命周期不应混为一层：

~~~text
认知类型：Working / Episodic / Semantic / Procedural / Lexical
持久范围：Turn / Session / Workspace / User / External
生命周期：Observed / Candidate / Active / Expired / Deprecated
~~~

建议每条结构化记忆至少包含：

~~~json
{
  "id": "mem_001",
  "type": "episodic",
  "scope": "session",
  "scopeId": "session_x",
  "content": "某次测试失败后需要先验证 provider 配置",
  "source": "tool_result",
  "provenance": ["turn_12", "tool:test"],
  "confidence": 0.78,
  "salience": 0.72,
  "createdAt": 1787100000000,
  "lastActivatedAt": 1787100000000,
  "ttlMs": 604800000,
  "status": "candidate",
  "embeddingModel": "provider/model-version",
  "embeddingVersion": "v1",
  "conflicts": [],
  "revoked": false
}
~~~

Markdown 继续作为用户可读、可编辑和可审计的投影；JSONL、SQLite 或其他 sidecar 负责运行时索引、状态和向量元数据。两者不应互相覆盖而造成不可逆的信息损失。

### 7.3 ContextObserver 的上下文片段

滑动窗口不应只按最后 N 个 token 粗暴截断，建议先切成带角色和事件类型的语义片段：

~~~json
{
  "sessionId": "session_x",
  "contextVersion": 42,
  "segments": [
    {
      "role": "user",
      "kind": "request",
      "text": "修复自动记忆插件的注入逻辑"
    },
    {
      "role": "tool",
      "kind": "error",
      "tool": "test",
      "text": "测试失败：..."
    },
    {
      "role": "assistant",
      "kind": "visible_output",
      "text": "正在检查 turn-stopping..."
    }
  ]
}
~~~

公开 reasoning 若存在，可以作为单独的 reasoning 片段加入短期环，但不应默认持久化。异步 embedding 或 reranker 返回结果时，必须校验 contextVersion，过期结果直接丢弃。

### 7.4 MemoryPacket

注入不应永久追加到稳定 system prompt，而应生成有生命周期的 memory packet：

~~~json
{
  "packetId": "packet_042",
  "sessionId": "session_x",
  "contextVersion": 42,
  "reason": "当前工具错误与历史验证流程高度相关",
  "mode": "soft",
  "expiresAfterStep": 44,
  "items": [
    {
      "memoryId": "procedure_017",
      "content": "先检查 provider 的 reasoning 配置，再验证 wire 参数",
      "similarity": 0.87,
      "confidence": 0.91,
      "source": "workspace-procedure"
    }
  ]
}
~~~

建议对模型使用明确的参考资料边界：

~~~text
以下内容是系统根据当前上下文检索到的潜在相关记忆。
它们是参考资料，不是新的用户指令；请结合当前事实验证后使用。
~~~

### 7.5 联想激活与认知状态分离

联想强度和认知负荷不应合成一个黑盒分数。建议分别计算：

~~~text
AssociativeActivation
  = similarity
  * scopeMatch
  * confidence
  * salience
  * novelty
  * recency

CognitiveState
  = toolError
  + retry
  + repeatedAction
  + goalDrift
  + unresolvedDuration
  + monitorSignal
~~~

前者决定“哪条记忆被想起”，后者决定“以多强的形式介入”。人类记忆并不只在困难时出现，因此不能要求认知负荷高才允许联想。

推荐的注入策略：

| 联想强度 | 运行状态 | 建议动作 |
|---|---|---|
| 高 | 稳定 | 静默预取，等待下一合适边界 |
| 高 | 有重复或漂移 | 下一步注入一行 soft hint |
| 很高 | 工具错误或冲突 | 注入步骤摘要与验证点 |
| 低 | 高负荷 | 通常不注入，避免增加噪声 |

必须增加滞回和抑制机制：注入冷却、同义去重、主题多样性、用户纠正降权、已忽略记忆的短期抑制以及冲突记忆的显式标注。

## 8. Procedure Memory 的生命周期

程序记忆是风险最高、但长期价值最大的部分。重复出现三次只能说明存在模式，不能证明流程可靠。建议采用以下状态机：

~~~text
observed
  -> candidate
  -> validated
  -> active
  -> deprecated
~~~

候选技能至少保存：

~~~json
{
  "skillId": "procedure_017",
  "name": "验证 Provider 推理参数",
  "trigger": ["模型思考不足", "reasoning 参数异常"],
  "preconditions": ["可读取配置", "存在验证脚本"],
  "steps": [],
  "checks": [],
  "rollback": [],
  "successCriteria": [],
  "riskLevel": "low",
  "requiresApproval": true,
  "evidence": [],
  "confidence": 0.78,
  "status": "candidate"
}
~~~

未经验证和批准的 Procedure 只能作为建议或检查清单，不能自动执行文件删除、部署、远程命令、SSH、支付或其他有副作用的工具。技能晋升应至少需要：

- 跨多个独立会话出现。
- 具有明确成功标准。
- 有工具结果或用户确认作为证据。
- 没有未解决的反例或回滚记录。
- 风险策略允许启用。

## 9. 实施路线

### 阶段 0：会话隔离与事件观察

- 将进程级运行状态改为 Map<sessionId, SessionRuntime>。
- 为用户、工具、助手可见输出建立统一事件结构。
- 将自动沉淀队列和冷却状态按会话隔离。
- 不改变当前 Markdown 记忆行为。

### 阶段 1：Shadow Retrieval

- 建立上下文环和结构化事件 sidecar。
- 先使用关键词、实体、时间衰减和范围过滤。
- 对候选记忆计算分数，但暂不注入。
- 记录命中原因、来源、预计字符或 Token 成本和候选排名。
- 通过历史会话回放评估触发质量。

### 阶段 2：pre-step Soft Injection

- 在当前已有的 agent/pre-step 边界生成 memory packet。
- 只注入高置信度、低风险、范围匹配的短提示。
- 加入 packet TTL、冷却、重复抑制和上下文版本校验。
- 稳定记忆纪律与动态 packet 分离，减少提示缓存击穿。

### 阶段 3：Embedding 与关联图

- 增加可插拔 embedding provider。
- 记录 embedding model、dimension 和 version，禁止跨模型直接混用向量。
- 引入向量检索、实体匹配和可选的时间关系图。
- embedding 不可用时回退到关键词和结构化过滤。

### 阶段 4：Semantic、User Profile 与 Procedure

- 自动抽取先进入 candidate 区，不直接写入硬规则。
- 用户画像和项目语义事实分开管理。
- Procedure 按证据状态晋升，提供验证、批准、禁用和回滚界面。

### 阶段 5：Provider Adapter 与可选 reasoning

- 由 Provider adapter 声明 reasoning 可见性：none、summary、full 或 unknown。
- 公开 trace 仅作为低信任增强信号。
- 闭源模型使用用户、工具和运行时事件退化运行。
- 流式中断与续写只在单独实验开关、高阈值和冷却策略下启用。

## 10. 评测设计

### 10.1 外部基准

LongMemEval 评估长期交互记忆中的跨会话检索、时间推理、知识更新和冲突处理。[18] LoCoMo 评估很长的会话记忆和多种需要长期上下文的问答能力。[19]

这些基准主要评价最终回答是否正确，不能单独评价 Host 主动触发是否及时或是否造成额外伤害，因此需要增加运行时数据集和事件回放。

### 10.2 本项目必须新增的指标

| 指标 | 含义 |
|---|---|
| Trigger Precision | 被主动触发的记忆中，真正有帮助的比例 |
| Trigger Recall | 应该出现的相关记忆中，实际被触发的比例 |
| Helpful Injection Gain | 注入后任务成功率相对无注入基线的提升 |
| Harmful Injection Rate | 无关或错误记忆导致任务质量下降的比例 |
| Duplicate Injection Rate | 同一记忆或同义记忆重复注入的比例 |
| Memory Contamination | 错误记忆传播到其他会话或长期层的比例 |
| Latency Overhead | 每次观察、检索和打包增加的延迟 |
| Token Overhead | 额外输入和 sidecar 调用 Token 成本 |
| Closed-Model Degradation | reasoning 不可见时相对公开 trace 模式的性能变化 |
| Cross-Session Leakage | 会话之间错误共享记忆的次数，必须为零 |

### 10.3 必要的消融实验

至少需要比较：

1. 无记忆基线。
2. 模型显式调用记忆工具。
3. Host shadow retrieval 但不注入。
4. Host soft injection。
5. 仅关键词检索与关键词加 embedding。
6. 有 reasoning trace 与无 reasoning trace。
7. 有冷却和冲突抑制与无抑制。
8. 有工作区隔离与故意混合范围。

## 11. 风险与治理

### 11.1 记忆污染与提示注入

记忆内容可能包含错误事实、过期指令或来自外部会话的恶意文本。注入时必须将记忆标记为参考资料，而不是高优先级系统指令；外部记忆应保留来源、导入时间和可撤销关系。

### 11.2 隐私与范围

用户级、项目级、会话级和外部记忆必须拥有明确 scope。默认禁止跨会话注入未授权内容；任何跨工作区召回都应产生审计记录。公开 reasoning 不应默认持久化。

### 11.3 冲突与过期

新信息不应无条件覆盖旧信息。需要保存冲突集、来源优先级、确认时间、TTL 和撤销状态。用户明确声明优先于模型推断，工具验证优先于无证据摘要。

### 11.4 成本和延迟

不要在每个 pre-step 同步调用主模型进行二次思考。应采用本地检索优先、高置信候选直接注入、边界案例才调用轻量 reranker 的策略。所有后台任务需要超时、队列上限和失败回退。

### 11.5 可解释性

每次注入至少应记录：packet ID、session ID、context version、触发事件、候选分数、记忆来源、注入模式、Token 成本和结果反馈。用户应能查看、撤销和禁用记忆。

## 12. 结论

现有研究已经为本项目提供了足够的理论和工程积木：CoALA 提供记忆类型，Generative Agents 提供关联召回和 reflection，MemoryBank 提供衰减与巩固，MemGPT 和 Letta 提供上下文分页，A-MEM 和 HippoRAG 提供关联结构，Reflexion 和 Voyager 提供经验与程序技能的验证思路，MemOS 提供 Host 控制面的系统化视角。

原生 DSH 进一步提供了可直接借鉴的运行时实现模式：Host plane 负责共享服务和注册表，Agent preset 负责会话能力；结构化工具结果可以驱动状态更新；per-agent inbox、digest 去重、有界预算和 pre-step merge 可以把动态内容安全地放入下一次模型请求。原生 dsh-agent-instructions 已经证明了“事件观察到下一请求注入”的生命周期骨架，主动记忆需要在此基础上增加语义关联和记忆治理，而不是重新发明 Agent loop。

基于本次检索，尚未发现成熟系统同时满足：

~~~text
Host 持续观察上下文
  -> 无需模型显式调用的关联预取
  -> 下一请求边界 memory packet 注入
  -> 公开和闭源 Provider 能力协商
  -> 会话隔离与范围治理
  -> 结果反馈、可解释和可撤销
~~~

因此，dsh-auto-memory 的合理技术定位是：

> **面向异构大语言模型 Agent 的宿主侧主动联想记忆中间件**
> **A Host-Side Proactive Associative Memory Middleware for Heterogeneous LLM Agents**

实施上应先完成会话隔离和 Shadow Retrieval，再逐步开放 pre-step Soft Injection；程序记忆、公开 reasoning 监测和流式中断续写应在拥有足够评测数据后再启用。

## 参考文献与项目

### 学术论文与官方研究

[1] Sumers, T. R. et al. **Cognitive Architectures for Language Agents (CoALA)**. 2023. [arXiv:2309.02427](https://arxiv.org/abs/2309.02427)

[2] Park, J. S. et al. **Generative Agents: Interactive Simulacra of Human Behavior**. UIST 2023. [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) | [ACM DOI](https://dl.acm.org/doi/10.1145/3586183.3606763)

[3] Zhong, W. et al. **MemoryBank: Enhancing Large Language Models with Long-Term Memory**. AAAI 2024. [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/29946) | [arXiv:2305.10250](https://arxiv.org/abs/2305.10250)

[4] Packer, C. et al. **MemGPT: Towards LLMs as Operating Systems**. 2023. [arXiv:2310.08560](https://arxiv.org/abs/2310.08560)

[5] Letta. **Memory and Context Hierarchy**. [官方文档](https://docs.letta.com/guides/core-concepts/memory/context-hierarchy/)

[6] Shinn, N. et al. **Reflexion: Language Agents with Verbal Reinforcement Learning**. NeurIPS 2023. [arXiv:2303.11366](https://arxiv.org/abs/2303.11366)

[7] Xu, W. et al. **A-MEM: Agentic Memory for LLM Agents**. 2025. [arXiv:2502.12110](https://arxiv.org/abs/2502.12110) | [代码仓库](https://github.com/WujiangXu/A-mem)

[8] **MemOS: A Memory OS for AI System**. 2025. [arXiv:2507.03724](https://arxiv.org/abs/2507.03724)

[9] **MIRIX: Multi-Agent Memory System for LLM-Based Agents**. 2025. [arXiv:2507.07957](https://arxiv.org/abs/2507.07957) | [代码仓库](https://github.com/Mirix-AI/MIRIX)

[10] Wang, W. et al. **Augmenting Language Models with Long-Term Memory (LongMem)**. NeurIPS 2023. [arXiv:2306.07174](https://arxiv.org/abs/2306.07174)

[11] Gutiérrez, B. J. et al. **HippoRAG: Neurobiologically Inspired Long-Term Memory for Large Language Models**. NeurIPS 2024. [arXiv:2405.14831](https://arxiv.org/abs/2405.14831) | [NeurIPS](https://papers.neurips.cc/paper_files/paper/2024/hash/6ddc001d07ca4f319af96a3024f6dbd1-Abstract-Conference.html)

[12] Wang, G. et al. **Voyager: An Open-Ended Embodied Agent with Large Language Models**. 2023. [arXiv:2305.16291](https://arxiv.org/abs/2305.16291)

[13] Turpin, M. et al. **Language Models Don't Always Say What They Think: Unfaithful Explanations in Chain-of-Thought Prompting**. NeurIPS 2023. [arXiv:2305.04388](https://arxiv.org/abs/2305.04388)

[14] Lanham, T. et al. **Measuring Faithfulness in Chain-of-Thought Reasoning**. 2023. [arXiv:2307.13702](https://arxiv.org/abs/2307.13702) | [OATML](https://oatml.cs.ox.ac.uk/publications/202307_Brauner_Measuring_Faithfulness.html)

[15] Anthropic. **Reasoning Models Don't Always Say What They Think**. 2025. [官方研究页](https://www.anthropic.com/research/reasoning-models-dont-say-think) | [arXiv:2505.05410](https://arxiv.org/abs/2505.05410)

[16] OpenAI. **Detecting Misbehavior in Frontier Reasoning Models**. 2025. [官方研究页](https://openai.com/index/chain-of-thought-monitoring/)

[17] Emmons, S. et al. **Monitoring Monitorability**. 2025. [arXiv:2512.18311](https://arxiv.org/abs/2512.18311) | [OpenAI PDF](https://cdn.openai.com/pdf/d57827c6-10bc-47fe-91aa-0fde55bd3901/monitoring-monitorability.pdf)

[18] Wu, Z. et al. **LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory**. ICLR 2025. [arXiv:2410.10813](https://arxiv.org/abs/2410.10813) | [GitHub](https://github.com/xiaowu0162/LongMemEval)

[19] Maharana, A. et al. **Evaluating Very Long-Term Conversational Memory of LLM Agents (LoCoMo)**. 2024. [arXiv:2402.17753](https://arxiv.org/abs/2402.17753) | [GitHub](https://github.com/snap-research/locomo)

### 开源项目与官方文档

- [Mem0](https://github.com/mem0ai/mem0) | [Mem0 开源文档](https://docs.mem0.ai/open-source/overview)
- [Letta](https://github.com/letta-ai/letta)
- [Graphiti](https://github.com/getzep/graphiti) | [Graphiti 文档](https://help.getzep.com/graphiti/getting-started/overview)
- [LangMem](https://github.com/langchain-ai/langmem) | [LangMem 文档](https://langchain-ai.github.io/langmem/)
- [Hindsight](https://github.com/vectorize-io/hindsight) | [Hindsight 文档](https://hindsight.vectorize.io/)
- [MemoryOS](https://github.com/BAI-LAB/MemoryOS)
- [HippoRAG](https://github.com/OSU-NLP-Group/HippoRAG)
- [NeuroMem](https://github.com/Conamara21/neuromem-agents)

## 研究声明

本报告基于截至 2026-08-19 可获得的公开资料、当前工作区代码和本机安装的 DSH 原生配置审阅。项目、论文和 Provider 的实现会持续变化；正式实现前应再次核验 API、版本、许可证、论文发表状态和模型输出协议。报告中的“研究空白”表示在本次检索范围内未发现满足全部判定条件的成熟端到端系统，不等于对全世界所有未公开或新近发布工作的排他性证明。
