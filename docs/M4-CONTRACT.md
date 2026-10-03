# M4 Shadow Retrieval 契约

> 状态：M4-0 契约冻结；M4 运行时代码尚未实施
>
> 工作区：D:\dsh-auto-memory（preview 分支）
>
> 唯一架构权威：docs/proactive-associative-memory-system-map.html
>
> 详细前置契约：docs/M3B-CONTRACT.md
>
> 后续 Python 契约：docs/PYTHON-SIDECAR-CONTRACT.md
>
> 前置状态：M0-R / T0 / M1 / M2 / P-A / M3a / M3b-1/2/3/4 均已 live verified；M3 整体完成
>
> 下一实施范围：只实施 M4-1 C-03 Retrieval Gate + 确定性词法检索纯核心；不得接入真实 Host 或持久审计

## 1. 本阶段目标

M4 在 M2 的会话级 ContextObserver 和 M3 的稳定 MemoryId/Anchor/Sidecar 之上，建立第一条可回放、可解释、默认关闭的主动检索链路：

~~~text
accepted ContextSegment
  -> bounded RetrievalContextSnapshot + QueryPlan (pure, no IO)
  -> C-03 Retrieval Gate
  -> current-scope anchored corpus (retrieve/prefetch only)
  -> deterministic lexical recall
  -> C-05 rank / dedupe / candidate budget
  -> ShadowAuditEvent
  -> discard from model-visible path
~~~

本阶段交付：

1. C-03 Retrieval Gate：在检索前决定 retrieve / prefetch / suppress。
2. 无模型、无 Python、零依赖的确定性词法检索基线。
3. 只从 M3b 稳定 anchored Markdown 与 fresh sidecar 构建候选。
4. 明确 User / 当前 Workspace / External / 跨工作区边界。
5. 每个候选都有 MemoryId、版本、digest、scope、分数组件和丢弃原因。
6. per-runtime Shadow 状态、取消、去重、过期校验和 dispose 清理。
7. 最小化 Shadow 审计、离线回放和召回质量评测入口。
8. 默认关闭与关闭态零行为、零敏感内容留存、零新增 IO。

M4 的唯一模型行为是“不影响模型行为”。无论候选分数多高，本阶段都不得产生 MemoryPacket、不得写 Agent Inbox、不得修改 systemPrompt、不得推进 delivered cursor。

## 2. 明确不交付

M4 不交付：

- M5 Access Evidence Graph。
- seen / read / cite / reuse / success / correction 证据。
- M6 InjectionBroker、SafetyVerdict、MemoryPacket 或 pre-step Soft Injection。
- Python worker、embedding、向量检索、reranker、图扩散或 activation_request。
- Semantic/Profile 自动抽取或冲突合并。
- Procedure candidate、晋升、checklist 或执行。
- reasoning trace 采集或把可见思维链作为硬依赖。
- 流式中断、取消当前模型请求或原地改写已发请求。
- 跨工作区自动召回、外部原文件自动读取或 Calendar 检索。
- 新增设置页 UI、模型调用、subagent 调用或网络访问。
- 修改真实记忆 Markdown、Anchor、MemoryId 或 M3 sidecar 身份。

候选被 Shadow 检索命中不等于模型已看到该记忆；内部为打分读取记录切片也不等于 memory read evidence。

## 3. 不可协商约束

1. 唯一架构权威仍是 system-map；本文件细化 C-03、C-04 的 M4 词法切片、C-05 的候选预算、G-04 的回放入口和 G-05 的基础回退。
2. JS Host 始终拥有 session、scope、index、候选校验、审计和未来注入裁决权。
3. M4 只消费 M2/M3 事实，不创建第二套 session identity、MemoryId 或 sourceVersion。
4. 所有 session 派生状态必须在现有 SessionRuntime 内；不得按 _lastAgent、cwd 或 default workspace 猜归属。
5. M4 v1 不建立跨 runtime 的共享语料缓存；runtime 内的不可变 CorpusSnapshot 不得保存 query、gate、Agent 或候选归属之外的会话状态。
6. 只有稳定 anchored 记录可成为候选；legacy、conflict、oversized 或 stale 记录 fail closed。
7. memoryId 是长期身份；candidateId 和 retrievalId 只是一次 Shadow 尝试的身份，不得替代 memoryId。
8. 每个候选必须携带 sourceEpoch + sourceVersion + fileDigest + recordDigest；任一不匹配即 stale。
9. scope 先过滤、后打分。不能用高相似度绕过 scope。
10. 当前 Workspace 由受信任的 runtime 路径解析确定；不得由模型文本、记忆内容或 sidecar sourceFile 自行授权。
11. External 原文件、其他工作区和任意路径不进入 M4 v1 corpus。
12. Gate 不依赖 reasoning；可选 reasoning/monitor 信号缺失时按 0 处理，不得改变基础可用性。
13. Shadow 候选不得进入 prompt、context projection、Inbox、Session event、工具结果或任何模型可见位置。
14. 检索中间态不得写主 Session；持久化只能写最小化 audit-pre 元数据。
15. Shadow 命中不得产生 M5 AccessEvidence，不得标记 delivered，不得更新 Procedure 状态。
16. 关闭功能时不构造 Shadow ring/cache/job，不读 sidecar/Markdown，不建 audit 文件，不改变 prompt、工具、路由或记忆写入。
17. 真实文件、sidecar 或 contextVersion 在异步检索期间变化时，整份结果过期丢弃，不做部分接纳。
18. 所有输入、候选、审计、队列和文件扫描都有条数、字节、时间与保留上限。
19. 对外或持久化的新 preview 名称必须使用 _pre 或 -pre；禁止 _dev 或可能与正式版碰撞的裸名。
20. 所有新文本文件使用 UTF-8 无 BOM；不改变既有文件编码或换行。

## 4. 功能闸门与关闭语义

### 4.1 有效开关

M4 的有效启用条件为：

~~~js
const enabled =
  config.associativeMemoryEnabled === true &&
  config.shadowRetrievalEnabled === true &&
  config.memoryAnchorEnabled === true
~~~

说明：

- associativeMemoryEnabled 是主动关联主开关，并保证 M2 Segment ring 可用。
- shadowRetrievalEnabled 是 M4 专用开关。
- memoryAnchorEnabled 保证候选拥有稳定身份和 live sidecar。
- memoryFileIndexEnabled 是 M3a 调试快照开关，不是 M4 授权条件；M4 直接消费 M3b sidecar/corpus snapshot。
- softInjectionEnabled、pythonBackendEnabled、reasoningObserverEnabled、procedurePromotionEnabled 和 streamingInterruptionEnabled 在 M4 中不产生任何效果。

### 4.2 默认关闭

仓库默认值继续保持：

~~~js
associativeMemoryEnabled: false
shadowRetrievalEnabled: false
~~~

当 M4 effective enabled 为 false：

- 不构造 Gate 状态、candidate cache、audit ring 或 AbortController。
- 不扫描 sidecar，不 stat/read 记忆 Markdown，不创建 retrieval-pre 目录。
- 不保存 query、term、candidate 或 memory excerpt。
- 仅允许已有 M0/M2 的最小关闭态计数语义；不得为 M4 增加敏感标量。

### 4.3 热切换与清理

true -> false 时必须立即：

1. abort 全部 M4 in-flight work。
2. 清空每个 runtime 的 Gate latch、query/candidate、dedupe cursor 与 volatile audit ring。
3. 清空含记忆文本或 token 的 CorpusSnapshot 缓存；纯文件版本统计可一并丢弃以简化证明。
4. 停止并结算 audit append queue；切换后不得再写新行。
5. 不删除历史 audit 文件，不修改 Markdown/sidecar。
6. 不清除 M2 ring，除非 associativeMemoryEnabled 同时从 true 切到 false；该情形沿用 M2 purgeObserverStorage。

## 5. 运行时所有权与处理时机

### 5.1 所有权

每个 SessionRuntime 增加惰性 Shadow 状态，概念形状为：

~~~ts
interface ShadowRuntimeState {
  gate: {
    latched: boolean
    state: 'normal' | 'prefetch' | 'armed' | 'cooldown'
    lastRawScore: number
    lastDecisionContextVersion: number
    processedSegmentCount: number
    cooldownUntilSegment: number
    enableEpoch: number
  }
  lastScheduledKey?: string
  lastCompletedKey?: string
  recentHits: BoundedRing<{ queryDigest: string; contextVersion: number }>(64)
  completedKeys: BoundedSet<string>(256)
  ignoredDigests: BoundedSet<string>(64)
  inFlight?: {
    retrievalId: string
    contextVersion: number
    memoryIndexVersion: string
    abortController: AbortController
  }
  auditRing: BoundedRing<ShadowAuditEvent>
  stats: ShadowRuntimeStats
}
~~~

该对象只在 effective enabled 且首个可评估 Segment 到达时创建。

### 5.2 Per-runtime Corpus

M4 v1 不建立跨 workspace 的 engine 级共享 CorpusRegistry。每个 runtime 按调度时捕获的 workspaceKey 惰性构建自己的不可变 CorpusSnapshot；User 文件只在该 snapshot 内作为明确的 User scope 源加入。这样 shadow 阶段不承担跨工作区缓存共享的隔离与失效复杂度。

CorpusSnapshot 至少包含：

~~~ts
interface SourceFingerprint {
  size: number
  mtimeMs: number
  ino?: number
}

interface CorpusSnapshot {
  workspaceKey: string
  memoryIndexVersion: string
  sourceFingerprints: Record<string, SourceFingerprint>
  sources: CorpusRecord[]
  totalBytes: number
}
~~~

要求：

- snapshot 不引用 Agent、SessionRuntime、AbortSignal 或 query。
- key 至少包含 session runtime identity 与 canonical workspaceKey；不能由 process.cwd 或 default runtime 补全。
- stat fingerprint 只用于快速判断缓存是否仍可复用；fingerprint 变化时必须重新读取并以 fileDigest/recordDigest 作权威校验。
- M4 v1 的实时语料只有 3 个受控源；未来扩展的 source/record 上限不能改变当前 v1 的 scope。
- 配置关闭、enableEpoch 变化或源 fingerprint 变化时，丢弃该 runtime snapshot；不做跨 workspace 共享淘汰。

### 5.3 触发边界

M4 观察 M2 ingestEnvelope 已接受并生成的 ContextSegment。推荐接线点是 Segment 入 ring 之后排入 per-runtime 异步队列；不得阻塞 session/event、tools/result 或 agent/pre-step。调度瞬间必须从同一 SessionRuntime 捕获 sessionId、agentId、workspaceKey、sessionClass、enableEpoch 和当前 Segment 计数；异步 tick 不得再裸调 resolvePaths()、currentRuntime()、_lastAgent 或 process.cwd() 推断语料归属。

处理顺序：

1. 验证调度时捕获的 runtime identity 仍有效，且 runtime 未 disposed。
2. 克隆 bounded RetrievalContextSnapshot，并将 workspaceKey 作为不可变语料键。
3. 先用无 IO 的 deterministic tokenizer 构建 bounded QueryPlan（用于 queryDigest 和 empty-query-signal），再由 C-03 决策；Gate 仍然先于 corpus IO 和候选检索。suppress 时不加载 corpus。
4. retrieve/prefetch 才按捕获的 workspaceKey 获取该 runtime 的 CorpusSnapshot。
5. 词法召回、scope/time filter、rank/dedupe/budget。
6. 完成时复核 sessionId、agentId、workspaceKey、enableEpoch、contextVersion、memoryIndexVersion 和每条 source identity。
7. 写 volatile audit；M4-3 后再写最小 durable audit。
8. 丢弃候选内容，不创建 pendingPacket。

## 6. RetrievalContextSnapshot

异步工作不得持有 live runtime 对象的可变投影。快照契约：

~~~ts
interface RetrievalContextSnapshot {
  schemaVersion: 1
  sessionId: string
  agentId: string
  workspaceKey: string
  sessionClass: 'top-level' | 'child'
  contextVersion: number
  eventSeq: number
  trigger: {
    segmentId: string
    segmentDigest: string
    kind: 'user' | 'tool_call' | 'tool_result' | 'assistant'
    eventType: string
    nativeSeq?: number
    ts: number
    inputSource?: string | null
    sourcePlugin?: string | null
    toolName?: string | null
    toolOk?: boolean | null
    errorName?: string | null
    errorCode?: string | null
    callId?: string | null
    rootCallId?: string | null
  }
  window: Array<{
    segmentId: string
    digest: string
    kind: string
    eventSeq: number
    contextVersion: number
    ts: number
    text: string
    toolName?: string | null
    toolOk?: boolean | null
    errorName?: string | null
    errorCode?: string | null
  }>
}
~~~

边界：

- window 最多取触发 Segment 加前 7 个 Segment，总计不超过 8 条。
- window 文本总计最多 4096 字符；从最新向前保留，单条仍受 M2 的 1200 字符上限。
- 快照必须深拷贝最小字段，不保存 envelope payload 对象。
- user/message 的 inputSource/sourcePlugin，以及 tool 的 name/ok/error/call 标量，从同 eventSeq 的 envelope 最小投影补入；找不到时为 null，不从 Segment.text 反向猜测结构化结果。
- trigger.ts 使用 M2 保存的原生事实时间；排序/回放不得用 observedAt 替代。
- sessionClass 从受信任的 session.header.parentSession 是否存在得出；M4 v1 对 child session hard suppress，避免后台子代理产生检索风暴，后续若开放必须单独评估。
- plugin 生成的 user/message 可进入 window 作为低权重上下文，但不得单独触发 retrieve；仅当 sourcePlugin 非空或 inputSource 命中版本化 plugin allowlist 时判定 plugin-generated，未知来源不得凭空归类。

## 7. Corpus 与 scope

### 7.1 M4 v1 允许的源

| Source class | Scope | 是否允许 | 说明 |
| --- | --- | --- | --- |
| 用户级 MEMORY.md | User | 是 | 对当前用户的所有 workspace 可检索 |
| 当前 workspace MEMORY.md | Workspace | 是 | 必须匹配 runtime 的 canonical workspaceKey |
| 当前 workspace YYYY-MM-DD.md 日志 | Workspace | 是 | 使用文件名日期做 recency，不改变身份 |
| 当前 workspace reflections/*.md | Workspace | 否（M4 v1） | M3 已建立稳定身份，但 M4 v1 暂不纳入；后续 flag/契约单独开启 |
| Session 临时记忆 | Session | 否 | M4 没有独立持久 Session memory source |
| 其他 workspace 的笔记/日志/反思 | Workspace | 否 | cross-workspace 自动召回为零 |
| 外部 AI 工具原文件/历史会话 | External | 否 | 不自动读取、跟随链接或索引 |
| CALENDAR.md | User/Workspace | 否 | M3 明确排除，M4 继续排除 |
| archive、cache、config、heartbeat、notices、Session JSONL | - | 否 | 不是 M4 memory corpus |

M4 v1 的 live SourceCatalog 严格限制为三类文件：用户级 MEMORY.md、当前 workspace MEMORY.md、当前 workspace 的今日日志 YYYY-MM-DD.md；这与现有 memoryIndexSnapshot() 的可验证范围一致。反思、其他日期日志、其他 workspace、外部原文件和历史 Session JSONL 均不自动检索，后续扩大语料必须单独升级契约与测试。

已经以链接块写入本地 MEMORY.md 的 external import 只被视为本地投影中的引用文本；M4 不解引用链接、不读取目标文件，也不把目标内容升级为 User/Workspace 事实。

### 7.2 SourceCatalog

SourceCatalog builder 必须接收调度时从同一 SessionRuntime 捕获的 canonical workspaceKey 与受控 source paths；不得在异步 tick 内裸调 resolvePaths()、currentRuntime()、_lastAgent 或 process.cwd()。sidecar 自报的 sourceFile 只能作为待校验字段，不能产生路径授权。

要求：

- 所有路径先 canonicalize；Windows 比较采用稳定的大小写与分隔符规则。
- sidecar.sourceFile 必须与 catalog 中该 canonical source 完全一致。
- symlink/reparse 后的真实路径不得逃逸允许的 User 或当前 Workspace 根。
- 用户文件、workspace MEMORY.md 和当前日志按固定 sourceRef 顺序纳入；M4 v1 不枚举反思目录。
- 当前日志使用受控 YYYY-MM-DD 文件名；不因目录中存在其他日期日志而扩大 corpus。
- 文件总数必须有硬上限；M4 v1 建议 128 个 source file，超出者以 source-budget 记录。
- 单文件继续沿用 M3 的 5 MiB 上限；超限整文件不检索。

### 7.3 Sidecar 与实际文件校验

Corpus loader 对每个源执行：

1. parseSidecar 校验 schemaVersion、namespace、source identity 和 record fields。
2. stat/read 实际 Markdown，校验不超过 5 MiB、无不受支持编码。
3. SHA-256 必须等于 sidecar.fileDigest。
4. 每个 record 的 byte range 必须在文件内，切片 digest 必须等于 recordDigest。
5. anchored record 必须有合法 memoryId/anchorId；legacy/conflict 不产候选。
6. sourceEpoch/sourceVersion/fileDigest/recordDigest 复制进 CorpusRecord。

缺失、损坏或 stale sidecar 的 M4 行为是 fail closed 并记录原因。M4 检索路径不得偷偷修改 Markdown。是否调用 M3 的显式 reconcile/rebuild 并持久化 sidecar属于 M3 维护入口；M4-2 可在内存中重建夹具用于诊断，但不得把未经事务验证的结果当作 live 候选。

## 8. MemoryIndexVersion

M4 为一次 corpus snapshot 计算确定性版本：

~~~text
source tuple = [scope, sourceRef, sourceEpoch, sourceVersion, fileDigest]
canonical tuple = JSON.stringify(source tuple)
canonical corpus = canonical tuples sorted by (scope, sourceRef) and joined with '\n'
memoryIndexVersion = idx_pre_ + first32hex(sha256(UTF-8(canonical corpus)))
~~~

规则：

- sourceRef 是 catalog 生成的稳定相对引用，不使用未经清洗的任意绝对路径。
- canonical tuple 排序只按 scope、sourceRef，完全相同时再按 sourceEpoch、sourceVersion、fileDigest；不得依赖目录枚举顺序。
- updatedAt、mtime、wall clock 和 candidate count 不进入版本 digest。
- 任一源增删、epoch/version/digest 变化都产生新 memoryIndexVersion。
- 空 corpus 仍有确定版本，但 Gate 结果为 suppress/no-corpus。
- 该版本将来直接作为 M7 请求和 M6 Packet 的 freshness precondition；preview 形式使用 idx_pre_ 前缀，正式发布转换时再统一为 idx_；M4 不得定义另一种同名语义。

## 9. C-03 Retrieval Gate

### 9.1 决策契约

~~~ts
type GateAction = 'retrieve' | 'prefetch' | 'suppress'
type GateState = 'normal' | 'prefetch' | 'armed' | 'cooldown'

type GateReason =
  | 'no-owner' | 'disposed' | 'child-session' | 'no-segment'
  | 'unsupported-trigger' | 'plugin-generated-trigger'
  | 'empty-query-signal' | 'duplicate-context' | 'user-ignored'
  | 'cooldown' | 'below-threshold' | 'armed' | 'warm'

interface GateSignals {
  explicitRecall: number
  novelty: number
  unresolved: number
  phaseShift: number
  toolFailure: number
  conflict: number
  historical: number
  repeated: number
  unresolvedAge: number
  goalDrift: number
  monitor: number
}

interface GateDecision {
  schemaVersion: 1
  policyVersion: 'gate_pre_v1'
  action: GateAction
  state: GateState
  reason: GateReason
  rawScore: number
  hesitation: number
  latched: boolean
  cooldownRemaining: number
  signals: GateSignals
  contextVersion: number
}
~~~

Gate 必须是同步、纯计算、无 IO。它在 corpus 加载和候选检索之前执行。

### 9.2 硬抑制顺序

以下条件按顺序优先于分数：

1. no-owner
2. disposed
3. child-session
4. no-segment
5. unsupported-trigger
6. plugin-generated-trigger
7. empty-query-signal
8. duplicate-context
9. user-ignored（M4 v1 数据集为空，仅保留接口）
10. cooldown

config-disabled 与 anchors-disabled 在 Host effective-enabled 闸门外直接短路：不调用 Gate、不创建状态、不写 audit。纯 fixture validator 可返回这两个诊断 reason，但 live 关闭态必须保持零留存。no-segment 与 unsupported-trigger 仅作为防御性 reserved reason：live tick 的唯一输入是 M2 已接受且 kind 属于白名单的 ContextSegment，其他输入在 ingest 层拒绝，不得扩展 M4 触发面。其余硬抑制在 effective enabled 时进入 volatile audit/counter。

### 9.3 基础信号

system-map 的信号分成三类：

**M4 v1 必须实现且可由 M2 事实确定：**

- novelty：触发 digest 是否未出现在前序 bounded window。
- toolFailure：触发或最近相关 tool_result 是否失败。
- repeated：bounded window 内同 tool name、同失败码或同动作模式的重复度。
- unresolved：版本化保守词典识别未解决/待办/失败/仍需等表达；不能调用模型推断。
- phaseShift：用户在一段 tool/assistant 序列后提出新阶段指令；只用事件种类和版本化转折词。
- conflict：用户纠正、否定旧结论或工具结果互相冲突的保守显式信号。

**M4 v1 只允许使用已存在的本 session Shadow 元数据：**

- historical：同 session 之前相同 queryDigest 有 fresh Shadow hit；不能先做候选检索再反向提高本次 Gate。
- unresolvedAge：只从 bounded window 的事实时间计算，缺失时为 0。

**M4 v1 缺失即为 0，不得猜测：**

- goalDrift 的语义模型。
- reasoning uncertainty / full CoT。
- dsh-anchored-monitor 强度。
- M5 conflict/evidence aggregate。
- Python activation suggestion。

锚定监控未来只能作为可选弱信号，不能成为硬依赖、授权或唯一触发器。

M4 v1 信号计算必须固定为以下纯函数（输入仅为 snapshot.window、trigger、QueryPlan、recentHits 和当前 Segment 计数）：

- explicitRecall = 1 仅当 trigger.kind='user' 且命中 lexical_pre_v1 的明确回忆意图短语（例如“回忆/查找之前的记录/上次如何处理/remember what we decided”）；仅出现“memory/记忆”等名词不算，其他情况为 0。它只要求执行 Shadow 检索，不是注入或动作授权。
- novelty = 1 if trigger.segmentDigest 不在前序 window，否则 0。
- repeated = min(1, max(0, sameToolNameCount - 1) / 2)，sameToolNameCount 只统计 window 内相同非空 toolName 的 tool_call；缺少 toolName 为 0。
- phaseShift = 1 仅当 trigger.kind='user'、版本化转折词典命中，且 trigger 之前 window 存在至少一个 tool_call/tool_result；否则 0。
- unresolved = 1 仅当最近 user Segment 命中版本化未决词典，且其后没有针对性的 tool_result；否则 0。
- unresolvedAge = min(1, max(0, trigger.ts - oldestUnresolvedUserTs) / 300000)，没有未决 user Segment 或事实时间缺失时为 0。
- historical = 1 if recentHits 中存在相同 queryDigest 且其对应 source identities 仍 fresh，否则 0。
- toolFailure = 1 if trigger.toolOk=false 或最近相关 tool_result 的 error 标量非空，否则 0。
- conflict 在 M4 v1 仅识别当前 window 内明确的用户纠正/否定词与失败结果并存，未实现时固定 0；不得读取 M5 evidence。

每个词典都必须带 lexical_pre_v1 版本并由 fixture 锁定；相同 window、trigger、recentHits、enableEpoch 输入必须逐字段得到相同 GateDecision。

### 9.4 v1 权重与滞回

M4-1 必须导出不可变 SHADOW_GATE_POLICY_PRE_V1，包含每个信号权重、词典版本和阈值，并由 fixture snapshot 锁定。不得把未审计的魔法数字散落在 Host 代码。v1 权重冻结为：

~~~text
explicitRecall  0.30
toolFailure     0.16
unresolved      0.16
repeated        0.12
novelty         0.08
phaseShift      0.08
historical      0.05
conflict        0.03
unresolvedAge   0.02
--------------------
sum              1.00
~~~

goalDrift、monitor 和 reasoning 在 v1 权重为 0；conflict 只有 M4 可计算的保守显式冲突信号，不能读取 M5 evidence。explicitRecall 只提升 Shadow 检索需要，不构成注入、工具执行或安全授权。任何权重、词典、explicitRecall 下限或阈值变化都必须升级 policyVersion。

阈值按最新 system-map 固定：

~~~text
hysteresis on  = 0.65
hysteresis off = 0.42
retrieve       = hesitation >= 0.80
prefetch       = hesitation >= 0.55
suppress       = hesitation < 0.55
~~~

要求：

- weightedRaw = clamp(sum(weight * clamp(signal, 0, 1)), 0, 1)；rawScore = explicitRecall === 1 ? Math.max(weightedRaw, 0.82) : weightedRaw。
- latchedNext = previous.latched ? rawScore >= 0.42 : rawScore >= 0.65。
- hesitation = clamp(latchedNext ? Math.max(rawScore, 0.55) : rawScore, 0, 1)。
- cooldownRemaining > 0 且 explicitRecall !== 1 时 action=suppress、state=cooldown、reason=cooldown；显式回忆请求可绕过 Shadow cooldown，但仍受 no-owner/disposed/child/plugin/user-ignored 等硬抑制。否则 hesitation >= 0.80 为 retrieve/armed，hesitation >= 0.55 为 prefetch/prefetch，其余为 suppress/normal。
- GateDecision.latched 是 latchedNext；cooldownRemaining 以尚未处理的 Segment 数量计，不使用 M2 的 eventSeq 或 native step 作为冷却单位。
- retrieve 后进入固定的 Shadow cooldown；gate_pre_v1 常量为 SHADOW_GATE_COOLDOWN_SEGMENTS=2，不复用 injectionCooldownSteps。
- 冷却单位是本 runtime 已处理的 accepted Segment 数量，不是 M2 contextVersion/eventSeq/native step；cooldownUntilSegment 只在当前 enableEpoch 内有效。
- cooldown 只影响 Shadow 调度，不修改 M2 contextVersion。
- associativeMemoryEnabled 或 shadowRetrievalEnabled 从 false 再启用时递增 enableEpoch，并清零 processedSegmentCount、cooldown、latch、recentHits、completedKeys 与 ignoredDigests。
- 同输入、同前态必须得到同 GateDecision。
- M4-1 在纯 fixture 中冻结具体权重；权重若改变必须升级 policyVersion，旧 audit 仍可解释。

### 9.5 retrieve 与 prefetch 在 M4 的差别

- retrieve：执行完整 bounded lexical rank，并允许在内存中物化 top candidate 的 bounded excerpt 用于校验；仍不注入。
- prefetch：执行相同词法索引命中，但只保留 candidate metadata，不物化 excerpt。
- suppress：不加载 corpus、不扫描候选。

两种命中都只产 ShadowAuditEvent。prefetch 不是 delivered，也不是 M5 seen。

## 10. Query 与词法规范化

### 10.1 QueryPlan

~~~ts
interface QueryPlan {
  schemaVersion: 1
  policyVersion: 'lexical_pre_v1'
  contextVersion: number
  queryDigest: string
  terms: Array<{
    term: string
    weight: number
    origin: 'trigger' | 'recent-user' | 'tool-result' | 'tool-call' | 'assistant'
  }>
  phrases: string[]
  truncated: boolean
}
~~~

限制：

- 最多 32 个去重 term、8 个 phrase。
- 单 term 最多 96 UTF-8 bytes；超限丢弃并记录 query-term-oversize。
- term 总 UTF-8 bytes 最多 2048。
- 当前 trigger 至少贡献一个有效 term，否则 Gate/Query suppress empty-query。
- queryDigest 由 policyVersion + canonical weighted terms/phrases 计算，不包含 sessionId 或 wall clock。

### 10.2 确定性 tokenizer

M4 v1 tokenizer 必须：

1. Unicode NFKC normalize。
2. Latin 做 locale-independent lowercase；不得依赖系统 locale。
3. 保留路径段、包名、版本号、错误码、snake_case、kebab-case、camelCase 和数字组合的可检索子词。
4. CJK 连续文本只在每个连续 run 内生成 2-gram，每个 Segment 最多保留 64 个 CJK gram，超出部分丢弃并计 query-term-oversize；同时保留长度合适的完整词串，不引入第三方分词器。
5. 移除版本化的中英文 stop words，但不能移除错误码、文件名或长度大于 1 的标识符。
6. 同一 term 多次出现时取最高来源权重，不通过重复堆高到无界。
7. 不执行 Markdown、HTML、shell、URL 或记忆中的任何指令；只把它们当文本 token。

phraseMatch 的边界规则：NFKC 后对 canonical phrase 做子串匹配；Latin/数字/标识符要求两端不是字母数字，CJK 不要求空格但要求匹配不被同一 CJK run 的相邻字符扩展。命中任一 phrase 即为 1。

初版窗口来源建议权重必须固化在 lexical_pre_v1：trigger > recent-user > tool-result > tool-call > assistant。具体数值由 M4-1 fixture 冻结；变更必须升级版本。

## 11. Candidate 契约

~~~ts
interface ShadowCandidate {
  schemaVersion: 1
  candidateId: string
  retrievalId: string
  memoryId: string
  anchorId: string

  scope: 'User' | 'Workspace'
  sourceClass: 'user-memory' | 'workspace-notes' | 'workspace-log'
  sourceRef: string

  sourceEpoch: string
  sourceVersion: number
  fileDigest: string
  recordDigest: string
  lineStart: number
  lineEnd: number
  byteStart: number
  byteEnd: number
  heading?: string | null

  scores: {
    termCoverage: number
    headingCoverage: number
    phraseMatch: number
    recency: number
    total: number
  }
  matchedTermDigests: string[]
  reasonCodes: string[]
  estimatedBytes: number
  excerpt?: string
}
~~~

身份规则：

~~~text
sessionIdHash = first32hex(sha256(UTF-8('retrieval-pre-v1\u0000' + sessionId)))
retrievalIdParts = ['retrieval-pre-v1', sessionIdHash, contextVersion, trigger.segmentId, memoryIndexVersion, gatePolicyVersion, lexicalPolicyVersion]
retrievalId = ret_pre_ + first32hex(sha256(UTF-8(JSON.stringify(retrievalIdParts))))
candidateIdParts = ['candidate-pre-v1', retrievalId, memoryId, sourceEpoch, sourceVersion, recordDigest]
candidateId = cand_pre_ + first32hex(sha256(UTF-8(JSON.stringify(candidateIdParts))))
~~~

- retrievalId/candidateId 可确定性重放，但不是长期内容身份。
- 同一个 memoryId 内容变化后仍是同一记忆，但 candidateId 因版本/digest 改变。
- durable audit 不保存 matched term 明文，只保存 term digest；volatile debug 也默认不返回 excerpt。
- excerpt 只允许 retrieve 模式在内存中持有，按 UTF-8 bytes 截断到 480 bytes，并经过既有敏感内容清洗；audit 与 /debug 不持久化全文。

## 12. 词法评分、排序、去重与预算

### 12.1 v1 分数

M4-1 的 lexical_pre_v1 使用可解释线性分数：

~~~text
total = 0.72 * termCoverage
      + 0.15 * headingCoverage
      + 0.08 * phraseMatch
      + 0.05 * recency
~~~

所有组件范围为 [0,1]：

- termCoverage：命中的 query term 权重 / query term 总权重。
- headingCoverage：标题中命中的 query term 权重 / query term 总权重；无标题为 0。
- phraseMatch：按 §10.2 的 NFKC/边界规则，任一 canonical phrase 命中则为 1，否则 0。
- recency：只对带可信 YYYY-MM-DD 文件名的 workspace-log 按 trigger.ts 计算 30 天半衰期：2^(-ageDays/30)；User/notes 没有可靠事件日期时取中性值 0.5，不从 mtime 猜语义时间。

候选必须至少命中一个 term 或 phrase，且 total >= 0.10；否则分别以 no-lexical-match 或 below-score 丢弃。scope 是硬过滤，不进入加权分数。salience、confidence、embedding similarity 在 M4 v1 不可用，不得用固定高值伪装。

### 12.2 时间规则

- 日期来自受控 YYYY-MM-DD 文件名；标题中的日期只作显示，不覆盖文件分类。
- trigger.ts 是回放事实时间。
- 日志文件日期必须先按 DEFAULT_CONFIG.dayBoundaryMinutes=450 的插件日界换算 trigger.ts，再比较 future-dated；00:00-07:30 的事件归入插件前一日。
- 明显晚于经插件日界换算后的 trigger date 且超过 24 小时容差的当前日志以 future-dated 丢弃。
- 老记录只衰减不自动过期；M4 不发明 TTL。
- 时间解析失败时 recency 为 0.5 并记录 date-unknown，不以当前 wall clock 猜测。

### 12.3 确定排序

排序键依次为：

1. total 降序。
2. termCoverage 降序。
3. headingCoverage 降序。
4. scope：当前 Workspace 先于 User，仅作完全同分 tie-break，不改变授权。
5. memoryId 字典序。

不得使用文件枚举顺序、mtime、随机数或对象插入偶然顺序。

### 12.4 去重

依次执行：

- 同 memoryId：只保留当前 fresh 版本；出现多个来源/版本视为 index-conflict 并 fail closed，不静默择一。
- 同 recordDigest：保留排序更高者，其余 duplicate-content；不同 memoryId 仍保留 drop provenance。
- 同 retrieval key：同 session/context/index/policy 不重复执行或重复写 durable audit。

### 12.5 预算

M4 v1 硬预算：

| 项目 | 上限 |
| --- | --- |
| Context window | 8 segments / 4096 chars |
| Query terms | 32 terms / 2048 UTF-8 bytes |
| Source files | 3（M4 v1：user MEMORY.md、workspace MEMORY.md、当前日志；未来扩展硬上限 128） |
| Corpus records | 512（M4 v1；未来扩展硬上限 4096） |
| Corpus resident bytes | 64 MiB |
| 单文件 | 5 MiB（继承 M3） |
| 单记录评分扫描 | 标题 + 内容前 16 KiB |
| 初筛命中 | 64 |
| Ranked kept | 8 |
| 单 excerpt | 480 UTF-8 bytes，仅 retrieve volatile |
| fingerprint 未变化时 Gate/query/rank deadline | 50 ms，fixture 可注入 clock |
| source reload/hash IO deadline | 500 ms，超时整次 deadline |
| 单个 durable audit event | 32 KiB |
| per-runtime volatile audit ring | 64 events |
| recentHits | 64 entries |
| completedKeys | 256 entries |
| ignoredDigests | 64 entries |

超限必须有 drop reason，不得截断后伪装完整候选。deadline 超时整次结果状态为 deadline，不产生 future-deliverable candidate。

## 13. Drop reason 词典

M4 v1 reason 必须来自版本化枚举，禁止自由文本驱动逻辑。至少包括：

### Gate

- config-disabled（仅 pure validator；live Host 在 Gate 外零留存短路）
- anchors-disabled（仅 pure validator；live Host 在 Gate 外零留存短路）
- no-owner
- disposed
- child-session
- no-segment
- unsupported-trigger
- plugin-generated-trigger
- empty-query-signal
- duplicate-context
- user-ignored
- cooldown
- below-threshold

### Corpus/scope

- no-corpus
- source-budget
- record-budget
- corpus-byte-budget
- record-scan-budget
- source-fingerprint-changed
- source-out-of-scope
- cross-workspace
- external-disabled
- calendar-excluded
- sidecar-missing
- sidecar-invalid
- source-mismatch
- stale-source
- record-stale
- index-conflict
- oversized
- future-dated

### Query/rank

- empty-query
- query-term-oversize
- no-lexical-match
- below-score
- duplicate-memory
- duplicate-content
- candidate-budget
- excerpt-budget
- date-unknown

### Async/audit

- cancelled
- disposed-before-complete
- stale-context
- stale-index
- deadline
- audit-write-failed
- internal-error

Drop entry 至少包含 stage、reason、可选 memoryId/sourceRef 和 bounded scalar detail；不得保存原文、异常堆栈、凭据或完整绝对路径。

## 14. Freshness、并发与取消

### 14.1 调度 key

~~~text
sessionIdHash = first32hex(sha256(UTF-8('retrieval-pre-v1\u0000' + sessionId)))
retrievalKey = JSON.stringify(['retrieval-key-pre-v1', sessionIdHash, contextVersion, memoryIndexVersion, gatePolicyVersion, lexicalPolicyVersion])
~~~

同 key 最多执行一次。seed replay 与 live feed 对同一 Segment 必须得到相同 key，不能双计。

### 14.2 latest-wins

每个 runtime 最多一个 in-flight retrieval：

- 新 contextVersion 到达时 abort 更旧任务。
- retrieve 可替换同版本尚未开始的 prefetch。
- 不同 runtime 可并行；每个 runtime 只读自己的 CorpusSnapshot，不跨 workspace 共享。
- dispose/关闭开关/plugin dispose 必须 abort。
- 不使用无界 Promise 队列；只保留 latest pending snapshot。

### 14.3 完成校验

候选完成后、写 audit 前再次检查：

1. runtime 未 disposed 且 sessionId/agentId/workspaceKey/enableEpoch 未变。
2. runtime.contextVersion 等于 snapshot.contextVersion。
3. 对每个 source 比较调度时捕获的 stat fingerprint；未变化时复用 snapshot 的 memoryIndexVersion，变化时只重载该 source 并重新计算其 fileDigest/records，再整体替换 snapshot。
4. 每个 candidate 的 sourceEpoch/sourceVersion/fileDigest/recordDigest 仍匹配当前 corpus；recordDigest 是最终记录级权威。
5. retrievalKey 未被 completedKeys 成功提交。

M4 v1 不在每个已缓存 tick 上重读全部文件。Gate/query/rank 的缓存核心预算与 corpus IO/哈希预算分开：fingerprint 未变化时核心路径目标 <=50 ms；fingerprint 变化后的 source reload/hash 受独立 IO deadline（建议 <=500 ms），超时整次 outcome=deadline。

失败时整次结果变为 stale/cancelled；不得更新 lastCompletedKey、candidate cache、delivered cursor 或任何 evidence。

## 15. Shadow 审计

### 15.1 与 M5/G-02 的边界

M4 Shadow audit 是“检索算法发生了什么”的最小元数据，不是：

- M5 AccessEvidence。
- G-02 Injection Audit 的 packet delivery/result。
- 用户可见引用。
- 模型读取证明。

M4 audit 必须显式写：

~~~text
shadowOnly = true
injected = false
packetId = null
delivered = false
accessEvidenceCreated = false
~~~

### 15.2 事件 schema

~~~ts
interface ShadowAuditEvent {
  schemaVersion: 1
  namespace: 'dsh-auto-memory-pre'
  retrievalId: string
  recordedAt: number
  triggerTs: number

  contextVersion: number
  eventSeq: number
  triggerSegmentId: string
  triggerSegmentDigest: string
  triggerKind: string

  memoryIndexVersion: string | null
  gatePolicyVersion: string
  lexicalPolicyVersion: string
  queryDigest?: string
  gate: GateDecision

  outcome: 'suppressed' | 'completed' | 'empty' | 'stale' | 'cancelled' | 'error'
  candidates: Array<{
    candidateId: string
    memoryId: string
    anchorId: string
    scope: string
    sourceClass: string
    sourceRef: string
    sourceEpoch: string
    sourceVersion: number
    fileDigest: string
    recordDigest: string
    score: number
    reasonCodes: string[]
  }>
  dropped: Array<{ stage: string; reason: string; memoryId?: string; sourceRef?: string }>
  counts: { sources: number; records: number; legacyConflicts: number; rawHits: number; kept: number; dropped: number }
  latencyMs: { gate: number; corpus: number; search: number; audit: number; total: number }

  shadowOnly: true
  injected: false
  packetId: null
  delivered: false
  accessEvidenceCreated: false
}
~~~

### 15.3 隐私投影

Durable audit：

- retrievalId/retrievalKey 使用不含 salt 的 sessionIdHash；session id 是 DSH 生成的不透明高熵标识，salt 不参与确定性身份。
- durable audit 不保存 sessionRef、agentRef 或 workspace 的绝对路径；runtimeTag 仅允许作为 volatile/debug 字段，持久化投影必须省略。
- sourceRef 只使用 catalog 相对引用，例如 user:MEMORY.md、workspace:MEMORY.md、workspace-log:2026-08-22.md。
- 不保存 Segment text、query term 明文、memory excerpt、完整错误堆栈、凭据或绝对路径。
- M4 不创建 salt 文件；删除/重建 audit 不影响 retrievalId、retrievalKey 或 replay 确定性。
- matched terms 只保存不可逆 digest 或 aggregate count。

Volatile /debug 也默认返回相同最小投影；只有测试注入的纯 fixture API 可查看规范化 term/excerpt。

### 15.4 Durable audit 位置与保留

M4-3 才允许创建：

~~~text
<DSH_HOME>/memory/retrieval-pre/audit/YYYY-MM-DD.jsonl
<DSH_HOME>/memory/retrieval-pre/state-pre.json
~~~

规则：

- 每行一个完整 JSON object，append-only，UTF-8 无 BOM。
- 写入由 engine 级串行队列保证不交错；失败不重试写主 Session。
- 单事件最大 32 KiB；超限按 candidate/drop 尾部裁剪并标记 audit-truncated。
- 默认保留 14 天且总上限 32 MiB；按最旧日期清理，只清 audit，不动 Markdown/sidecar。日期只是存储分片，跨午夜的 retrieval 由 retrievalId/retrievalKey 关联，replay 必须读取涉及的多个日期分片。
- replay 模式默认 persist=false，不污染 live audit。
- effective enabled=false 时目录不存在或不发生任何新增写入。

## 16. Replay 与评测

### 16.1 Pure replay

M4 core 必须支持：

~~~ts
replay({
  contextSnapshots,
  corpusSnapshot,
  gatePolicy,
  lexicalPolicy,
  labels?
}) -> CanonicalShadowResult[]
~~~

Canonical 结果排除 recordedAt、latency 和 volatile runtimeTag，只比较：

- Gate action/state/reason/signals。
- queryDigest。
- retrievalId 的 deterministic core。
- candidate memoryId/version/digest/score/order。
- drop reasons。

相同输入必须逐字段一致。

### 16.2 历史 Session 回放

M4-3 可提供 tools/replay-m4-shadow.mjs，但必须：

- 由用户显式给出 session fixture/export；不后台扫描全部会话。
- 使用 M2 的原生 seq 去重和事实时间。
- 默认读取冻结 corpus fixture；使用 live corpus 时在报告中标记非历史快照。
- 输出到显式临时/报告路径，不写主 Session，不写 live audit。
- 不启动 Python、不调用模型或网络。

### 16.3 M4 可评估指标

M4 可直接评估：

- Gate action distribution。
- 有标签 fixture 的 Trigger Precision / Trigger Recall。
- Recall@K、MRR、candidate drop distribution。
- duplicate candidate rate。
- stale/cancel/deadline rate。
- latency overhead 和 audit bytes。
- cross-session/cross-workspace leakage，必须为 0。

M4 不能声称 Helpful Injection Gain、Harmful Injection Rate、Token Overhead 或 delivered success；这些需要 M6 之后的 A/B。

## 17. Host Debug 契约

M4-3 在既有 /debug 的 associativeMemory 下增加 shadowRetrieval：

关闭时严格为：

~~~json
{ "enabled": false }
~~~

开启时可包含：

~~~json
{
  "enabled": true,
  "shadowOnly": true,
  "gatePolicyVersion": "gate_pre_v1",
  "lexicalPolicyVersion": "lexical_pre_v1",
  "memoryIndexVersion": "idx_pre_...",
  "corpus": { "sources": 0, "records": 0, "legacyConflicts": 0, "staleSources": 0 },
  "stats": { "evaluated": 0, "retrieved": 0, "prefetched": 0, "suppressed": 0, "stale": 0, "errors": 0 },
  "runtimes": []
}
~~~

每个 runtime 只显示 runtimeTag（不含盐 sessionIdHash 的前 8 hex，仅 volatile/debug）、contextVersion、Gate 标量、inFlight 布尔和最近 audit metadata；corpus 统计另显示 legacyConflicts。不得暴露 query/excerpt/full path。M4 不新增公开 Agent 工具和设置页。

## 18. 失败与降级

~~~text
Gate suppress
  -> no corpus IO, audit/counter only

Corpus missing/stale/invalid
  -> suppress retrieval for affected source or whole snapshot
  -> reasoned audit
  -> never fall back to arbitrary Markdown scan outside SourceCatalog

Deadline/internal error
  -> cancel/drop
  -> base conversation unchanged

Python disabled/unavailable
  -> irrelevant in M4; JS lexical core is the primary implementation

Any stale/scope mismatch
  -> drop/suppress
  -> never inject
~~~

M4 的失败不得影响既有记忆工具、自动沉淀、当前维护快照或基础对话。

## 19. 测试矩阵

实现 M4 时至少覆盖：

1. DEFAULT_CONFIG 两个相关开关仍默认 false。
2. associative=false/shadow=false：零 Shadow object、零 corpus IO、零 audit 文件、prompt/工具/路由/Markdown 字节不变。
3. associative=true/shadow=false：M2 观察可运行，M4 仍零状态/零 IO。
4. shadow=true 但 master/anchor 任一 false：hard suppress，不检索。
5. Gate 无 reasoning/monitor 仍对 fixture 确定可用。
6. Gate on/off 滞回、retrieve/prefetch/suppress 阈值、2 accepted-Segment cooldown、explicitRecall 绕过 Shadow cooldown，以及 disable→enable 后 enableEpoch/状态清零。
7. child session 与 plugin-generated user trigger 不启动检索；普通 top-level user source 可触发。
8. 同事件 seed replay + live feed 不重复 Gate/audit。
9. tokenizer 覆盖中文、英文、NFKC、camel/snake/kebab、路径、版本号、错误码和多字节预算。
10. Query term/phrase 数量、bytes、来源权重和 digest 确定。
11. M4 v1 仅 User MEMORY.md、当前 Workspace MEMORY.md 与当前日志可见；反思、其他日期日志、其他 Workspace、External、Calendar、archive、Session JSONL 不可见。
12. canonical path、Windows 大小写/分隔符、symlink/reparse 逃逸拒绝。
13. sidecar missing/corrupt/sourceFile mismatch/fileDigest stale/recordDigest stale 全部 fail closed。
14. >5 MiB 文件、>3 v1 sources、>512 records、>64 MiB corpus、>16 KiB record scoring slice 的预算行为与 reason；未来扩展上限另测。
15. memoryIndexVersion 对同 snapshot 稳定；源 tuple 任一变化即改变。
16. candidate 携带完整 M3 provenance；候选版本变化不改变 memoryId。
17. total 分数组件、tie-break 和顺序在重复运行中完全一致。
18. duplicate memoryId 触发 index-conflict；duplicate content 有明确 dropped provenance。
19. retrieve 可物化 bounded sanitized excerpt；prefetch 无 excerpt；两者均不注入。
20. contextVersion 在异步完成前变化 -> stale-context 整次丢弃。
21. source stat fingerprint 变化触发 affected-source reload；fileDigest/recordDigest 变化 -> stale-index/record-stale 丢弃；未变化时不全量重哈希。
22. A/B 并发 runtime 的 Gate latch、query、candidate、audit、cancel 零串线；tick 无 Agent/ALS 上下文时仍使用调度瞬间捕获的 workspaceKey。
23. dispose/关闭/plugin dispose 中止任务且队列自然结算；插件日界 00:00-07:30 的 future-dated/recency 计算正确。
24. durable audit 无原文、无绝对路径、无 sessionId、无凭据、无 BOM，单行可独立 JSON.parse；legacy/conflict 只进入 legacyConflicts 统计，不产候选。
25. audit append 并发不交错；失败只记 audit-write-failed，不污染 Session/Markdown。
26. retention/size cap 只清 audit，不触碰 M3 sidecar/backups/plans 或记忆。
27. replay 同输入 canonical result 一致；persist=false 零 live 污染。
28. Shadow hit 不创建 pendingPacket、AccessEvidence、delivered cursor 或 Session event。
29. softInjection/Python/reasoning/procedure/streaming 开关即使误开也不改变 M4 输出。
30. 既有 M0-M3 全量回归继续通过，真实记忆 SHA-256 在测试前后不变。
31. 全部新增 JS/JSON/MD/fixture UTF-8 无 BOM，git diff --check 干净。

## 20. 实施分段

### M4-0：Contract Freeze（本轮）

交付：

- docs/M4-CONTRACT.md。
- system-map currentScope/M4 row/nextBrief 回写。
- PREVIEW-NEXT-STEPS 与 handoff/Python 恢复入口更新。

禁止：运行时代码、真实检索、audit 目录、真实记忆修改。

### M4-1：C-03 Gate + Deterministic Lexical Core

只实现纯模块和 fixtures：

- GateSignals/GateDecision + gate_pre_v1。
- RetrievalContextSnapshot validator。
- deterministic tokenizer/QueryPlan + lexical_pre_v1。
- Candidate schema、词法 score、排序、去重、预算和 drop reason。
- 纯内存 CorpusSnapshot fixture；不读真实文件。
- replay pure core。

建议模块：lib/shadow-retrieval-pre.js。

禁止：lib/index.js Host 接线、真实 sidecar/Markdown IO、durable audit、GUI、M5-M7。

### M4-2：M3 Corpus Adapter + Scope/Freshness

交付：

- SourceCatalog 与 canonical scope guard。
- M3b sidecar/Markdown slice adapter。
- memoryIndexVersion、CorpusRegistry/invalidation。
- 仅临时 DSH_HOME 与 shadow-copy 文件测试。

禁止：真实 Host 事件接线、live 开关、durable audit、注入。

### M4-3：Host Shadow Wiring + Audit/Replay

交付：

- 复用现有 SessionRuntime 的 lazy Shadow state。
- accepted Segment 后异步 latest-wins 调度。
- config 热切换、abort/dispose、/debug 最小视图。
- retrieval-pre durable audit、retention、显式 replay CLI。
- 全量回归和真实记忆零修改证明。

仍保持默认关闭；不得构建 Packet 或 Evidence。

### M4-4：Live Shadow Verification

需用户明确启动：

1. 重启现有 127.0.0.1:3080 加载 Host 改动；不得启动替代 server。
2. 先验证关闭态 /debug={enabled:false}、零 retrieval-pre 新写入。
3. 临时开启 associativeMemoryEnabled + shadowRetrievalEnabled，保持 softInjection/Python 等关闭。
4. 用可控用户输入、tool failure、重复动作和低信号输入验证 retrieve/prefetch/suppress。
5. 复核 audit 无原文、候选 provenance fresh、cross-workspace leakage=0。
6. 对比 prompt/runtime projection/Session 事件，证明零注入。
7. 关闭 shadow 后验证任务 abort、volatile 状态清理、无后续 audit。
8. 回写本契约实施证据与 system-map；默认配置仍 false。

## 21. M4 完成门

只有以下全部成立，M4 才能标记 live verified：

- M4-1/2/3 自动测试和全量 M0-M3 回归通过。
- M4-4 在现有 GUI 实际进程完成 on/off 验证。
- 默认关闭零行为/零 IO 成立。
- 所有候选都有稳定 MemoryId 和完整 fresh provenance。
- cross-session/cross-workspace leakage 为 0。
- durable audit 不含原文、绝对路径或凭据。
- prompt、Inbox、Session、pendingPacket、delivered cursor、AccessEvidence 全部零变化。
- 真实 Markdown 和 M3 sidecar 身份未被 M4 修改。
- 无 Python worker、embedding、Procedure 或注入代码偷跑。

M4 完成后下一里程碑是 M5 Access Evidence Graph。M5 必须单独冻结契约，不能把 Shadow hit 追认成历史 seen/read 证据。

## 22. 压缩恢复入口

上下文压缩后按以下顺序恢复：

1. 读取 docs/proactive-associative-memory-system-map.html 的 progressLedger、C-03、C-04、C-05、M-06、G-01/G-02/G-04/G-05。
2. 读取 docs/M4-CONTRACT.md 全文。
3. 读取 docs/M3B-CONTRACT.md §19，确认 M3b-4 live 与 sidecar/备份状态。
4. 读取 lib/index.js 的 DEFAULT_CONFIG、ContextSegment、SessionRuntime、ingestEnvelope、dispose 与 /debug。
5. 读取 lib/memory-anchor-pre.js 的 parseSidecar/buildAnchoredIndex 和 lib/memory-writer-pre.js 的 sidecar 事务边界。
6. 运行 git status --short --branch，保留全部既有改动与未跟踪文件。
7. M4-4 已 live verified；当前下一阶段只冻结 M5 Access Evidence Graph 契约，不新增 M5 运行时代码、不启动 Python。
8. M5 契约冻结后回写 system-map、docs/M5-CONTRACT.md 与 PREVIEW-NEXT-STEPS；不 commit、不 push、不 tag、不发布。

恢复时以 system-map 为唯一架构/进度权威；本契约是 M4 细化规范，代码和测试是实现事实。

## 23. 实施状态（M4-1 完成，2026-08-23）

状态：**M4-1 C-03 Gate + Deterministic Lexical Core 已完成并通过 fixture 测试**；纯模块 `lib/shadow-retrieval-pre.js`（588 行,零 IO,零依赖 node:crypto）；**未接入 lib/index.js**（grep 零新增引用）；未读真实文件、未建 audit。

| 交付 | 说明 |
| --- | --- |
| SHADOW_GATE_POLICY_PRE_V1 | 冻结权重(explicitRecall .30/toolFailure .16/unresolved .16/repeated .12/novelty .08/phaseShift .08/historical .05/conflict .03/unresolvedAge .02;goalDrift/monitor/reasoning=0)+滞回 0.65/0.42+retrieve 0.80/prefetch 0.55+cooldownSegments=2+explicitRecallFloor 0.82+版本化词典(Object.freeze) |
| SHADOW_LEXICAL_BUDGET_PRE_V1 | §12.5 全预算(window 8/4096、terms 32/2048B、records 512、64MiB、sources 3、16KiB 切片、rawHits 64、kept 8、excerpt 480B) |
| DROP_REASONS | §13 版本化枚举(Gate/Corpus/Query/Async 全集) |
| validateSnapshot | §6 字段/window≤8/4096 校验 |
| memoryIndexVersion | §8 canonical tuples 排序→idx_pre_+first32(sha256);顺序无关/变化敏感 |
| tokenize/buildQueryPlan | §10 NFKC+locale-independent lowercase+CJK 2-gram(≤64/run)+词形保留(camel/snake/kebab/版本/错误码)+stop words;terms≤32/2048B/digest 确定/oversize 计账 |
| computeSignals/gatePreV1 | §9.3 纯信号公式+§9.2 硬抑制顺序(8级)+§9.4 滞回/cooldown=2/explicitRecall floor 与绕过;同输入同决策 |
| lexicalSearch | §11-§13 termCoverage/headingCoverage/phrase(NFKC 边界)/recency(log 30 天半衰+插件日界 future-dated)/total≥0.10;rawHits 64→排序(total/tc/hc/Workspace 先/memoryId)→跨 memoryId recordDigest 去重(duplicate-content)→同 memoryId 多版本 index-conflict fail closed→kept 8;record-budget/corpus-byte-budget/source-budget fail closed |
| buildRetrievalId/buildCandidateId/sanitizeExcerpt | ret_pre_/cand_pre_ 确定性身份;excerpt 480B UTF-8 截断+控制符清洗(retrieve volatile) |
| replay | §16 pure core:canonical 排除 recordedAt/latency/runtimeTag;latch/cooldown 跨快照序列;suppress 零 IO |

测试 smoke-test-m4-pre.mjs F1-F12 全绿(策略冻结/validator/indexVersion/tokenizer/QueryPlan/硬抑制/滞回冷却绕过/child-plugin 抑制/lexicalSearch 排序与 future-dated/去重两语义/三预算/replay 确定性+excerpt)。全量回归 **11 项**(M0-M3 十项+M4)全部 exit 0。

**实现注记**：
1. snapshot.trigger 扩展可选 text 字段供 explicitRecall/phaseShift 词典匹配(validator 不强制;Host 接线时从 Segment.text 最小投影传入)。
2. E9 式教训同步:smoke-test-memory-index-pre.mjs B5 原硬编码 '2026-08-22.md' 在跨天后失效(memoryIndexSnapshot 的 logPath=memToday().md)——已改为插件日界动态日期 plugToday(),该测试对当前日期的隐式依赖消除。
3. 下一步 M4-2:M3 Corpus Adapter + SourceCatalog canonical scope guard + memoryIndexVersion live 化(临时 DSH_HOME shadow-copy 测试)。

## 24. 实施状态（M4-2 完成，2026-08-23）

状态：**M4-2 Corpus Adapter 已完成并通过 shadow-copy 测试**；纯模块 `lib/m4-corpus-pre.js`(157 行)；仍未接入 lib/index.js、未建 durable audit、未读真实记忆。

| 交付 | 说明(契约 §7/§8/§14.3) |
| --- | --- |
| canonicalize | resolve+正斜杠+小写(Windows 大小写不敏感稳定规则) |
| buildSourceCatalog | §7.2 三源固定顺序(user/workspace/workspace-log)+canonicalFile+sourceRef 稳定相对引用(user:/workspace:/workspace-log:) |
| canonicalScopeGuard | sidecar.sourceFile 与 catalog canonical 完全一致(mismatch 拒绝);realpath 解析 symlink/reparse 后不得逃逸声明目录(cross-workspace 拒绝);文件不存在=sidecar-invalid |
| loadCorpusSnapshot | §7.3 六步校验链:sidecar-missing/sidecar-invalid/source-mismatch/stale-source(fileDigest)/record-stale(range 越界或切片 digest)/oversized 全部带原因 fail closed;预算(sources≤3/records≤512/corpusBytes≤64MiB)fail closed;产出 CorpusRecord(完整 M3 provenance)+memoryIndexVersion(idx_pre_) |
| sourceFingerprint | stat size+mtimeMs(§14.3 分层 deadline 的复用依据) |
| CorpusRegistry.get | fingerprint 未变化→fromCache 复用零重读;变化→整体重建并报告 reloaded sources;invalidate 强制重建 |

测试 smoke-test-m42-corpus.mjs G1-G6 exit 0(shadow-copy fixture:三源 catalog/provenance 链/fail closed 四原因/stale-source/record-stale/scope guard 三态/fingerprint 缓存与失效)。全量回归 **12 项**(M0-M3 十项+M4 两项)7.4s 全部 exit 0。

**实现注记**：
1. loader 的 record 校验顺序:byte range 越界→切片 digest,均以 record-stale 丢弃;guard(source-mismatch/cross-workspace)先于文件读取。
2. 测试教训:G5 断言方向写反(把 guard 的正确拒绝当失败)、G6 变量名 sideDir/sidecarDir 不一致——均为测试侧问题,引擎行为经探针证实正确。
3. 下一步 M4-3:Host Shadow Wiring(lazy Shadow state/latest-wins 调度/config 热切换/retrieval-pre durable audit+replay CLI),仍默认关闭。

## 25. 实施状态（M4-3 完成，2026-08-23）

状态：**M4-3 Host Shadow Wiring 已完成并通过 H1-H6 测试**；durable audit 落盘路径已实现并验证隐私投影；仍默认关闭、零注入；M4-4 live 验证待用户启动。

| 交付 | 说明 |
| --- | --- |
| lib/shadow-host-pre.js | Host 接线层:createShadowHost({engine})——per-runtime WeakMap state(enableEpoch/processed/cooldown/latch/recentHits≤64/completedKeys≤256)、latest-wins abort、volatile ring ≤64 |
| index.js 三处最小接线 | ingestEnvelope segment accept 后 fire-and-forget 钩子;debug 视图 shadowRetrieval 字段(关闭=严格 {enabled:false});runtime dispose 与 plugin disposeAll 的 shadow 清理 |
| paths 捕获 | refreshAll 完成后 capturePaths(engine.state 快照;§7.2 合规——异步任务只用捕获值,不裸调 resolvePaths);userFile 由 state.userDir/MEMORY.md 推导(state 无该字段) |
| payload 标量投影 | trigger 的 inputSource/sourcePlugin 从 envelope.payload 最小投影(plugin-generated user trigger 抑制依据);child session 经 parentSession 检测 hard suppress |
| durable audit | retrieval-pre/audit/YYYY-MM-DD.jsonl append-only(串行链);32KiB truncateAuditEvent 尾部裁剪+audit-truncated 标记;retention 14 天/32MiB sweep |
| 隐私投影验证 | audit 无原文/无绝对路径/无 sessionId/excerpt 不落盘;sourceRef 仅相对引用;shadowOnly/injected=false/delivered=false/accessEvidenceCreated=false |

测试 smoke-test-m43-pre.mjs H1-H6 exit 0(默认关闭零留存/开关矩阵/三开 retrieve 链路含 audit 卫生与 provenance/cooldown/child-plugin 抑制/dispose)。全量 **13 项**回归(M0-M3 十项+M4 三项)10.3s 全部 exit 0。

**调试过程发现(修复闭环)**：
1. CorpusRegistry.get 成功返回缺 ok 字段 → runRetrieval 误判 corpus 失败(补 ok:true)。
2. engine.refresh 的 _doRefresh 未返回 p 且 state 无 userFile → capturePaths 改由 state.userDir 推导用户级路径。
3. trigger 标量(inputSource/sourcePlugin)在 envelope.payload 内而非顶层 → host 改读 payload。
4. plugin-generated user trigger 曾触发完整 retrieve → 补 payload 投影检测后正确抑制。

下一步：**M4-4 Live Shadow Verification**(需用户重启现有 3080 加载 Host 改动;按契约 §20 分八步验证 on/off;默认配置保持 false→验证后再决定线上开关状态)。

## 26. 实施状态（M4-4 Live Verification 通过，2026-08-23）

状态：**M4-4 八步 live 验证全部通过，M4 整体完成并已回滚到默认关闭**。anchor 保持 true（M3b-4 迁移成果），assoc/shadow 恢复 false。

| 步骤 | 结果 |
| --- | --- |
| 重启加载 | 用户重启现有 3080（无替代 server）✓ |
| 关闭态基线 | debug shadowRetrieval={enabled:false} 严格投影；retrieval-pre 目录不存在（零 IO）；真实记忆 SHA 基线记录 ✓ |
| 三开临时 | assoc/shadow/anchor=true；softInjection/Python/reasoning/procedure/streaming 全程关闭 ✓ |
| 自然流量 suppress | 3 个工具 segments → below-threshold suppress（hesitation=0）；suppress 不加载 corpus(sources=0/miv=null,§9.5) ✓ |
| plugin 误杀发现与修复 | GUI 用户输入 data.source 非空被误判 plugin-generated → 按 §6「未知来源不得凭空归类」修复为仅 sourcePlugin 非空判定 + policy.pluginInputAllowlist=[] 固化（需重启生效）|
| dshHome 缺陷发现与修复 | host 的 dshHome() 漏拼 .dsh 后缀 → audit 写到 <home>/memory 错误位置；修正后 auditDirPath=C:\Users\JH Z\.dsh\memory\retrieval-pre\audit ✓；错位目录已清理 |
| explicit recall retrieve | 用户发"回忆一下之前的部署流程记录"→ outcome=completed、gate=retrieve/armed、hesitation=0.82(floor)、explicitRecall=1；corpus 三源 sources=3/records=88/rawHits=50/kept=8(预算上限)；候选 8 条全带 provenance(memoryId/scope/sourceRef/version/digest/score)，User+Workspace 授权正确；dropped=80 带 reason(below-score/no-lexical-match) |
| audit 卫生 | 单行可 JSON.parse；shadowOnly=true/injected=false/delivered=false/accessEvidenceCreated=false；无原文/无绝对路径/无 sessionId/excerpt 不落盘 |
| 零注入证明 | candidates 仅存于 audit；prompt/runtime projection/Session 事件/pendingPacket/delivered cursor 零变化；injected=false 显式断言 ✓ |
| 关闭恢复 | assoc=false/shadow=false POST 后 debug={enabled:false}；audit 行数 before=1 after=1（零新增写入）；anchor=true 保持（M3 迁移成果） |

**Live 发现并修复（2 项,均已进代码）**：
1. plugin-generated 判定违反 §6（inputSource 非空即判）→ 只认 sourcePlugin + policy.pluginInputAllowlist=[]。
2. host dshHome() 漏拼 .dsh → audit 错位写入 <home>/memory；修正并对错位目录清理。

**M4 完成门对照（§21）**：默认关闭零行为/零 IO ✓；候选稳定 MemoryId+完整 fresh provenance ✓；cross-workspace leakage=0 ✓；durable audit 无原文/绝对路径/sessionId ✓；prompt/Inbox/Session/pendingPacket/delivered/AccessEvidence 零变化 ✓；真实 Markdown 与 sidecar 身份未被 M4 修改 ✓；无 Python/embedding/Procedure/注入偷跑 ✓。

## 27. lexical_pre_v2 检索质量升级（2026-08-23，用户批准 C 轻量版）

背景：M4-4 live 验证通过后复审确认——v1 的朴素 termCoverage（子串命中权重占比）缺少词稀有度与频度饱和考量。经用户批准执行「C 轻量版」：只做有公开依据的加固（BM25 + 权威停用词表），不引入第三方库、不改架构分工。

**升级内容**：

1. **BM25 相关性替换朴素覆盖率**（termCoverage/headingCoverage 内部实现）：
   - IDF 公式：`IDF(t) = ln(1 + (N - df + 0.5)/(df + 0.5))`（Lucene BM25Similarity 同式，保证非负）
   - tf 饱和：`tf*(k1+1)/(tf + k1*(1 - b + b*dl/avgdl))`，k1=1.2 b=0.75（经典默认），除以 (k1+1) 归一到 [0,1]
   - termCoverage = 命中词 Σ(idf × sat × weight) / 查询词 Σ(idf × weight)
   - DF 表在 loader 统计循环一次构建；效果：常见词贡献下降、稀有关键词（错误码/配置项）贡献上升、单文档内重复堆词无收益
2. **中文停用词表扩充**：哈工大停用词表（github leiyusi123/stopwords，过滤符号后 507 词）以 STOPWORDS_HIT_PRE_V2 固化，isStopWord 合并查旧表兜底
3. policyVersion 升级 **lexical_pre_v1 → lexical_pre_v2**；bm25 参数与 stopwordsSource 固化进 SHADOW_GATE_POLICY_PRE_V1.dictionaries

**明确不变**：total 公式结构（0.72/0.15/0.08/0.05）、门槛 0.10、排序五键、三层去重、全部预算——v2 只替换相关性内核与停用词数据。

**与 Python 分工的关系（重申架构定位）**：JS 词法核心是「Python sidecar 不可用时的安全回退 + M4 可解释基线」；最终检索主力（embedding/向量/rerank/hybrid）按 PYTHON-SIDECAR-CONTRACT.md 由 M7 承担。lexical_pre_v2 提升的是回退层下限，不改变 M7 定位。

验证：F1-F12 全绿（digest 因词典变化自然更新，断言同步 v2）；全量 13 项测试 exit 0；diff-check 干净；无 BOM。