# dsh-auto-memory 主动联想记忆实施交接上下文

> 用途：将本文完整注入一个新的 DSH 编码会话，作为正式实现的起点。
>
> 工作区：D:\dsh-auto-memory
>
> DSH 原生实现只读参考：C:\Users\JH Z\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh

## 1. 你的任务

在现有 dsh-auto-memory 插件上，分阶段实现“Host 侧主动联想记忆中间件”。

目标不是让模型主动调用 memory_search，而是：

~~~text
Host 观察用户消息、工具调用/结果、可见输出和生命周期事件
→ 按 session 隔离形成滑动上下文
→ 主动检索可能相关的记忆
→ 经过排序、去重、预算、风险和版本校验
→ 生成 MemoryPacket
→ 在下一次 agent/pre-step 请求边界注入
→ 根据工具结果和用户纠正更新证据
→ 必要时把重复成功 Episode 固化为 Procedure candidate
~~~

不要一次实现全部架构。当前只实施本文第 8 节定义的“里程碑 0 + 里程碑 1”。

## 2. 开始前必须阅读

按顺序阅读：

1. docs/proactive-associative-memory-research-report.zh-CN.md
   - 正式研究报告、引用、原生 DSH 对照、风险和实施路线。
2. docs/proactive-associative-memory-system-map.html
   - 当前权威系统架构图。浏览器直接打开；点击模块可查看概览、实现、依据、Meta 代码和验收条件。
3. lib/index.js
   - 当前 Host 半：MemoryEngine、持久化、注入、工具、路由、自动沉淀。
4. lib/client.js
   - 当前 Web UI。
5. smoke-test.mjs、smoke-test-reflect.mjs、smoke-test-external.mjs
   - 现有测试和历史契约，注意部分断言可能已经陈旧，修改前先验证。
6. package.json、cordis.patch.yml
   - 插件入口和包结构。

阅读后再检查 git status。工作区可能已有用户改动和研究文件；不得回退或覆盖无关改动。

## 3. 当前已经完成的内容

以下是设计和研究成果，不代表运行时代码已经实现：

- 正式研究报告：docs/proactive-associative-memory-research-report.zh-CN.md
- 交互式整体系统地图：docs/proactive-associative-memory-system-map.html
- 早期长版架构页面：docs/proactive-associative-memory-architecture.html
- 关键引用已审计：
  - FLARE 正确编号为 arXiv:2305.06983。
  - CoALA=2309.02427
  - Generative Agents=2304.03442
  - MemoryBank=2305.10250
  - MemGPT=2310.08560
  - A-MEM=2502.12110
  - MemOS=2507.03724
  - HippoRAG=2405.14831
  - IRCoT=2212.10509
  - DRAGIN=2403.10081
  - Self-RAG=2310.11511
  - Reflexion=2303.11366
  - Voyager=2305.16291
  - LongMemEval=2410.10813
  - LoCoMo=2402.17753
  - Proteus=2608.16844，仅作为“渐进式记忆激活”的概念启发，不得声称复现其具体算法。

系统地图已经加入：

- 稳定 memoryId/anchorId
- MemoryFileIndex
- read 返回内容 coverage
- Access Evidence Graph：seen/read/cite/reuse/success/correction
- Procedure：sourceMemoryIds/sourceEpisodes + 跨 session 成功晋升门
- hesitation 滞回状态
- Python activation_request
- 渐进激活：index → hint → excerpt → checklist → resource → full
- JS Host 权威 Safety Gate

## 4. 原生 DSH 已确认事实

这些是从本机 DSH 0.1.0-rc.7 构建产物核对出的实现事实：

### 4.1 请求链

~~~text
claim
→ systemPrompt.assemble
→ runtime-context projection
→ agent/pre-step waterfall
→ step/start
→ user/message append
→ buildRequest
→ LLM dispatch
~~~

已发出的模型请求不能被后续事件原地改写。主动记忆只能影响下一 step 或下一 turn。

### 4.2 Session 与 Inbox

- Session 是 append-only、连续 seq、lossless JSON 的可重放事实源。
- Agent Inbox 是 durable projection，维护 next-turn 和 next-step。
- inject：写入 next-step，但不唤醒 Agent。
- steer：写入 next-step，并唤醒 Agent。
- Inbox 的 splice、claim、replace、remove 都有持久事件语义，不是临时内存。

### 4.3 dsh-agent-instructions 可借鉴骨架

~~~text
structured tools/result
→ per-agent serial projection
→ version/digest reconcile
→ pending inbox
→ pre-step await + compose
→ next request
~~~

可借鉴：

- WeakMap<agent, Promise> 串行 projection。
- desired 已在 claimed 或 visible surface 时删除 pending。
- 相同 pending 复用，旧 pending replace，多余 pending remove。
- version + digest + visible/pending 状态共同去重。
- UTF-8 byte budget 与模型 token budget 分开。

### 4.4 systemPrompt 与 Minimal

- systemPrompt section/context provider 是同步求值，不能在 section.text 内 await 异步检索。
- Minimal preset：complete: true、includeRuntimeContext: false，默认只含持久 bash 和 str_replace_editor，也不挂载 dsh-agent-instructions。
- complete persona 只限制 system-prompt sections，不等于禁止独立 user/message。
- 若未来覆盖 Minimal，需要 dsh-auto-memory 自己提供 pre-step user/message 路径；不能假设 Minimal 已有该能力。

### 4.5 tools/result

- tools/result 是 frozen、emit-only、可重放的最终观察点。
- Host 应抽取最小标量快照，不能保留或序列化整个 DSH 内部对象。
- read 工具参数/返回结构需要 adapter，不要硬编码所有工具都拥有同一字段。

## 5. 最终架构不变量

所有实现必须持续满足：

1. 跨 session 泄漏为零。
2. 已发出的请求不原地改写，主动记忆只在下一请求边界生效。
3. memoryId/anchorId 是稳定身份；行号仅是当前版本 UI/debug locator。
4. sourceVersion + recordDigest 用于确认内容身份和新鲜度。
5. open/read 不等于 citation；coverage=0 不形成记忆访问证据。
6. Procedure 必须来自跨 session 的 reuse/success Episode，而不是 read 次数。
7. activation_request 只是 Python 建议；最终由 JS Host 校验版本、scope、风险、冷却和 Procedure 状态。
8. 过期或 contextVersion/indexVersion 不匹配的结果必须丢弃，不标记 delivered。
9. 记忆是参考资料，不覆盖 system、developer 或当前用户指令。
10. 未验证 Procedure 不自动执行；SSH、发布、部署、删除、支付等副作用默认需要用户确认。
11. 检索中间态不写主 Session；只有实际注入的 packet 才进入可解释历史或审计。
12. Python、embedding、图检索不可用时，基础插件与 JS 关键词回退仍可工作。

## 6. 目标数据契约

这些契约目前主要存在于系统地图的 Meta 代码中。里程碑 0 可以先在 JS 中建立最小版本，但不要过度设计。

~~~ts
interface EventEnvelope {
  schemaVersion: 1
  sessionId: string
  agentId: string
  eventSeq: number
  turn?: number
  step?: number
  sourceKind: 'user' | 'tool' | 'agent' | 'lifecycle'
  callId?: string
  rootCallId?: string
  payloadDigest: string
}

interface SessionRuntime {
  sessionId: string
  contextVersion: number
  eventCursor: number
  pendingPacket?: MemoryPacket
  cooldownUntilStep?: number
  lastInjectionAt?: number
}

interface MemoryLocator {
  memoryId: string
  anchorId: string
  sourceFile: string
  sourceVersion: number
  lineStart: number
  lineEnd: number
  byteStart: number
  byteEnd: number
  recordDigest: string
}

type AccessKind = 'seen' | 'read' | 'cite' | 'reuse' | 'success' | 'correction'

interface AccessEvidence {
  kind: AccessKind
  memoryId: string
  anchorId?: string
  sessionId: string
  callId?: string
  sourceFile?: string
  coverage?: number
  contextVersion: number
  sourceVersion: number
  recordDigest: string
  timestamp: number
}

type ActivationLevel = 'index' | 'hint' | 'excerpt' | 'checklist' | 'resource' | 'full'
~~~

当前阶段不需要一次把所有接口正式导出，也不要引入 TypeScript 构建链；可以继续使用现有 ESM JavaScript，并用清晰的 JSDoc typedef 或内聚的小类表达。

## 7. 最终完整路线，但本轮不要全部实施

~~~text
M0 基线开关与数据契约
M1 SessionRuntime / per-agent isolation
M2 ContextObserver / 结构化事件
M3 Markdown Anchor + MemoryFileIndex
M4 Shadow Retrieval
M5 Access Evidence Graph
M6 InjectionBroker + pre-step Soft Injection
M7 Python sidecar / embedding / graph
M8 Semantic/Profile candidates
M9 Procedure promotion
M10 Provider reasoning adapter
M11 Streaming abort/resume experiment
~~~

## 8. 本次新会话只实施的范围

### 里程碑 0：基线、配置与内部契约

目标：为后续功能建立可关闭、可测试、不会改变现有行为的骨架。

必须完成：

1. 扩展 DEFAULT_CONFIG，新增默认关闭的实验配置：

~~~json
{
  "associativeMemoryEnabled": false,
  "shadowRetrievalEnabled": false,
  "softInjectionEnabled": false,
  "pythonBackendEnabled": false,
  "reasoningObserverEnabled": false,
  "procedurePromotionEnabled": false,
  "streamingInterruptionEnabled": false,
  "maxPacketItems": 2,
  "maxPacketChars": 800,
  "packetTtlSteps": 2,
  "injectionCooldownSteps": 3
}
~~~

注意：配置全部关闭时，现有插件行为必须逐字节兼容当前逻辑。

2. 在 lib/index.js 内新增最小、内聚的运行时结构：

~~~text
SessionRuntimeStore
  Map 或 WeakMap 管理 per-agent/session 状态
  get(agent)
  dispose(agent)
  disposeAll()
~~~

3. 定义内部的 EventEnvelope、SessionRuntime、ContextSegment、MemoryPacket 最小契约。
4. 加入只记录、不检索、不注入的调试状态字段，供后续 smoke test 检查。
5. 将所有新状态初始化和清理挂入 Cordis 生命周期；插件 dispose 时清空。
6. 不添加 Python、不添加 embedding、不修改 Markdown 格式、不注入新消息。

### 里程碑 1：会话隔离

目标：消除当前进程级状态在并发会话下串线的风险。

重点检查并逐步替换这些进程级状态：

- engine.state 中与当前 workspace/agent 强耦合的动态状态
- engine._lastAgent
- engine._consolidating
- engine._pendingConsolidations
- engine._lastTurnByAgent
- 自动沉淀和刷新路径中的 agent fallback

本阶段不要求一次重写整个 MemoryEngine。优先做最小安全改造：

1. SessionRuntimeStore 以 Agent 或 sessionId 为键。
2. agent/session-start 时建立 runtime。
3. agent/pre-step 和工具执行时通过当前 agent 精确取 runtime。
4. agent/turn-stopping payload 不保证有 agent，不能继续依赖全局 _lastAgent 推断当前会话。
   - 需要核对 DSH 可用的 agent/session 生命周期和当前插件监听上下文。
   - 若该 hook 无法可靠获得 agent，设计显式的 per-agent turn tracking 或换用拥有 agent 的邻近事件。
   - 不允许在并发会话下猜测最近 Agent。
5. 自动沉淀队列按 session 隔离。
6. agent dispose / session dispose / plugin dispose 时清理 runtime 和异步任务。
7. 添加至少两个并发顶层 agent/session 的隔离测试。

## 9. 本次明确禁止实现的内容

在里程碑 0/1 验收前，不要实现：

- Python worker 或虚拟环境初始化
- embedding / vector database
- MemoryFileIndex 和 Markdown anchor 写入
- read coverage 解析
- Access Evidence Graph
- Procedure 自动抽取或 skill 文件生成
- reasoning trace 观察器
- 自动 pre-step MemoryPacket 注入
- 流式中断、steer 或 abort/resume
- UI 大改
- npm 发布、GitHub 推送、tag 或版本发布

这些属于后续阶段，先保证会话隔离和关闭时零行为变化。

## 10. 测试和验收

至少需要：

1. 当前功能回归：
   - 现有 memory 工具仍可注册和执行。
   - renderMemory 行为不变。
   - 自动沉淀在单会话下保持当前结果。
   - 路由和 GUI state/config 返回仍兼容。
2. 新配置：
   - 缺省全部实验开关为 false。
   - 配置保存/加载只接受 DEFAULT_CONFIG 白名单。
   - 关闭时不产生新的 model-visible 文本。
3. SessionRuntime：
   - A/B 两个 session 使用不同 runtime。
   - A 的 cwd、contextVersion、pending 状态不出现在 B。
   - 清理 A 不影响 B。
4. 自动沉淀：
   - A/B turn 去重独立。
   - A 的沉淀任务不会读取 B 的 Agent 或 workspace。
5. 编码：
   - 所有改动保持 UTF-8 无 BOM。
   - 完成后检查修改文件头不是 EF BB BF。

建议先运行：

~~~powershell
node --check lib/index.js
node --check lib/client.js
node smoke-test.mjs
node smoke-test-reflect.mjs
node smoke-test-external.mjs
~~~

如果旧 smoke test 因历史数量断言过时，先说明并只修正与当前真实注册契约一致的断言，不要为了让测试绿而倒退当前功能。

## 11. 实施方式要求

1. 先检查 git status 和现有改动，不回退任何用户文件。
2. 先读代码，再决定最小修改面；不要重写整个 2,000+ 行文件。
3. 优先抽出小型内部 helper/class，但不要过度抽象。
4. 每完成一个子步骤立即运行相关测试。
5. 新功能默认关闭，先验证关闭路径。
6. 修改后检查无 BOM。
7. 不启动替代 dsh web 服务。
8. 如需要在现有 Web GUI 验证：修改 apps/web shell 以外的插件代码后，按当前 DSH 运行规则重建/重载并刷新 http://127.0.0.1:3080；不要承诺 HMR，除非确认同一 checkout 的 pnpm run dev:web watcher 正在运行。
9. 未经用户明确要求，不发布 npm、不推 GitHub、不创建 tag。

## 12. 子代理纪律

可以使用子代理，但必须受控：

- 研究/审查默认最多并行 2 个一级子代理。
- 每个子代理提示必须明确：禁止创建 subagent、subagent_fork、workflow 或 Ralph。
- 必须等待同一批返回并提炼后，才决定是否继续下一批。
- 不允许递归套娃。

本次 M0/M1 实现范围较集中，优先由主 Agent 直接完成；若委派，只委派“原生生命周期核对”或“并发隔离测试审查”中的一个独立任务。

## 13. 完成后汇报格式

最终回复必须说明：

- 改了哪些文件
- M0/M1 分别实现了什么
- 哪些风险仍未解决
- 跑了哪些测试及结果
- 是否验证无 BOM
- 是否更改了 model-visible 行为
- 下一里程碑建议

## 14. 新会话的第一条执行指令

请按以下顺序开始：

1. 读取本文和两份架构文档。
2. 运行 git status。
3. 阅读 lib/index.js 中 MemoryEngine state、refresh、consolidateTurn、session-start、turn-stopping、pre-step 和 dispose 部分。
4. 输出一段不超过 12 行的实施计划。
5. 直接实施里程碑 0，然后测试。
6. 里程碑 0 通过后实施里程碑 1，然后测试。
7. 不实施第 9 节禁止的后续阶段。

## 15. M0/M1 后维护改动

- 已完成缓存稳定性维护：稳定记忆纪律保留在 `systemPrompt.section()`，动态工作区记忆迁移到原生 `systemPrompt.context()` runtime-context projection。
- 动态快照由 DSH 原生 projection 按完整文本比较；相同快照不重复创建 user-context，变化快照替换之前的 projection。
- 本维护改动没有启用主动检索、Python、embedding、MemoryPacket 生成、流式中断或自动阈值注入；这些仍属于后续里程碑。
- 开发版 prompt 注册名继续使用 `dsh:auto-memory-dev` 与 `dsh:auto-memory-dev-rules`，发布脚本负责去除 `_dev`。
- 三份架构 HTML 已同步区分当前 native `systemPrompt.context()` runtime-context projection 与未来 `MemoryPacket → Agent Inbox` 主动注入；研究报告保留后续检索、Python 和 packet 为未实现阶段。
- 三份架构 HTML 已同步区分当前 native `systemPrompt.context()` runtime-context projection 与未来 `MemoryPacket → Agent Inbox` 主动注入；研究报告保留后续检索、Python 和 packet 为未实现阶段。
