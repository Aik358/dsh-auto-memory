# M7 Python Semantic Engine 完整实施契约

> 状态：M7-0 Contract Freeze 已完成；Python 运行时代码尚未实现
>
> 前置：M0-M6 全部 live verified；M6-4 已证明 Reference Tail 进入真实 model-visible messages，delivery ack 后 M5 seen 落盘
>
> 权威架构：docs/proactive-associative-memory-system-map.html
>
> 实施研究：docs/M7-PYTHON-IMPLEMENTATION-REPORT.md
>
> 执行交接：docs/M7-AGENT-HANDOFF-PROMPT.md
>
> 本会话禁止：启动 Python、安装模型或向量依赖、修改线上开关、commit/push/publish

## 1. 权威与兼容

本文件是 M7 的完整实施契约，取代此前 provisional 文字。M5/M6 live JavaScript validator、wire schema 和行为是最高事实；M7 只能增加 transport wrapper、index_sync 和可重建 derived state，不能静默改变 ContextPushEnvelopePre、ContextAckPre、ActivationRequestPre 或 ReferenceTailPacketPre 的嵌套语义。

权威顺序：

1. lib/context-bridge-pre.js、lib/evidence-store-pre.js、lib/context-host-pre.js。
2. lib/activation-inbox-pre.js、lib/activation-inbox-state-pre.js、lib/activation-host-pre.js。
3. docs/M5-CONTRACT.md 与 docs/M6-CONTRACT.md 的 live evidence。
4. 本文件。
5. docs/M7-PYTHON-IMPLEMENTATION-REPORT.md 与外部参考。

任何字段、预算、身份或时序变化都必须升级 protocol/schema/policy version，并留下迁移说明。

## 2. 总体目标

M7 实现一个默认关闭、长期运行、JSONL 通信的 Python Semantic Engine，以及最薄的 JS SidecarClient/index_sync 适配层。

~~~text
JS M5 ContextPushEnvelopePre + EvidenceAggregatePre
  -> JS 授权分页 index_sync
  -> Python embedding / dense / sparse / hybrid / rerank / graph
  -> Python per-session semantic threshold + hysteresis
  -> ActivationRequestPre
  -> JS M6 hard validator + Activation Inbox
  -> ReferenceTailPacketPre
  -> 下一请求 Reference Tail
  -> delivered ack -> JS M5 seen evidence
~~~

Python 决定“想起什么、何时建议激活”；JS 决定身份、授权、版本、新鲜度、TTL、风险、packet surface 和实际投递。

## 3. 所有权边界

### JS Host 永久拥有

- DSH lifecycle、Agent/session/workspace 身份和 reliable owner 判定。
- eventSeq、nativeSeq、callId、contextVersion 和请求边界。
- SourceCatalog、memoryId、anchorId、memoryIndexVersion 和全部 M3 provenance。
- index_sync 的记录选择、scope 授权、文本边界和分页预算。
- AccessEvidence 创建、持久化、撤销、聚合和 delivery seen。
- M6 ActivationRequest 校验、Activation Inbox、Reference Tail、TTL、cooldown、capability、delivery ack 和 safety gates。
- Python process start/stop、workerEpoch、request map、timeout、cancel、latest-wins、circuit breaker 和 fallback。

### Python 拥有

- 仅由 JS frames 构建的 derived semantic index。
- embedding provider、向量计算和 exact dense search。
- sparse/hybrid fusion、可选 bounded rerank、可选 bounded graph expansion。
- per-session semantic state、activation score、threshold、hysteresis 和建议 level。
- 消费 JS EvidenceAggregatePre 作为只读评分特征。
- 输出 candidate_result、ActivationRequestPre 和 judgement suggestion。

Python 是计算 sidecar，不是第二个记忆权威。

## 4. 明确不交付

- Python 不直接读取 DSH ctx、Agent、AbortSignal、Session JSONL、Markdown、sidecar 或任意本机文件。
- Python 不发现 workspace、scope、外部记忆源或凭据。
- Python 不分配或修改 memoryId、anchorId、sourceEpoch、sourceVersion、fileDigest、recordDigest。
- Python 不创建或修改 AccessEvidence。
- Python 不构建 ReferenceTailPacket，不写 prompt、Inbox、Session 或 request。
- M7 不自动持久化 Semantic/Profile 事实或晋升 active Procedure。
- M7-0 不引入 ANN、图数据库、HTTP server 或无 scope 的全局状态。
- 不持久化 reasoning trace。

## 5. Live M5 输入

### 5.1 ContextPushEnvelopePre

PythonContextSinkPre 必须消费完整 live M5 frame：

~~~text
schemaVersion=1
namespace=dsh-auto-memory-pre
kind=context_push
observationId=obs_pre_*
session{sessionId,agentId,workspaceKey,scope}
cursor{eventSeq,nativeSeq?,contextVersion}
index{memoryIndexVersion,sourceEpochs}
trigger / window / memoryRefs / evidence
policy{contextPolicyVersion,gatePolicyVersion,lexicalPolicyVersion,evidencePolicyVersion}
budget / observedAt / deadlineAt
~~~

冻结预算：8 segments、4096 input bytes、8 memory refs、16 evidence items、480-byte excerpt、64 KiB frame、5 秒 deadline、256 sent observation IDs。

memoryRefs 是 JS lexical_pre_v2 的 top refs，不是全库 corpus。

### 5.2 ContextAckPre

Python sink 必须在 deadlineAt 前返回兼容 ack：

~~~ts
interface ContextAckPre {
  observationId: string
  accepted: boolean
  workerEpoch?: string
  reason?: 'ok' | 'disabled' | 'busy' | 'unsupported' | 'oversize' | 'stale'
}
~~~

sink 异常不得冒泡到基础对话。

## 6. Live M6 输出

Python 输出的 activation 必须逐字段通过现有 M6 validator：

~~~text
schemaVersion=1 / namespace=dsh-auto-memory-pre / kind=activation_request
activationId / observationId(obs_pre_*) / workerEpoch
sessionId / agentId / workspaceKey / scope
contextVersion / memoryIndexVersion(idx_pre_+32hex)
threshold{policyVersion,score,threshold,reason<=160 chars}
level=index|hint|excerpt|checklist|resource|full
candidates=1..8
ttlSteps=1..10 / createdAt / expiresAt
~~~

Candidate 必须带：candidateId、memoryId、anchorId、Workspace 或 User scope、相对 sourceRef、sourceEpoch、sourceVersion、fileDigest、recordDigest、score；excerpt <=480 UTF-8 bytes；checklist <=8 条且每条 <=120 字符。

M6 不重算 Python semantic score，但会硬拒绝 identity、scope、cursor、index、provenance、TTL、budget 或 risk 不合法的结果。

真实 Python activation 必须走 M6 自然 pre-step claim；fake-only 的 inject-and-pump 只是 live demo。旧 contextVersion 会被 stale-context 丢弃。

## 7. Transport framing

### 7.1 JSONL

- stdin/stdout 一行一个 UTF-8 JSON object。
- stdout 只输出协议；stderr 输出有界诊断。
- 不允许 multiline JSON、注释、二进制 stdout 或监听 HTTP 端口。
- M7-0 单行最大 256 KiB；超限在语义计算前拒绝。

### 7.2 Envelope

~~~ts
interface M7TransportFramePre {
  protocolVersion: 'm7_wire_pre_v1'
  frameId: string
  requestId: string
  workerEpoch: string
  type: 'health' | 'index_sync_begin' | 'index_sync_page' | 'index_sync_commit' | 'context_push' | 'evidence_sync' | 'cancel' | 'close_session' | 'health_result' | 'context_ack' | 'index_ack' | 'candidate_result' | 'activation_request' | 'judgement_suggestion' | 'error'
  payload: JsonValue
  sentAt: number
}
~~~

requestId 是 transport correlation；observationId 是 M5 context identity；activationId 是 M6 activation identity；syncId 是 index transaction identity，四者不得混用。

### 7.3 workerEpoch

JS 每次 Python 进程启动创建新的 opaque workerEpoch；Python 所有输出回显它；旧/未知 epoch 全部丢弃。重启清空 per-session semantic state；derived cache 只有通过 model/index identity 校验才能复用。

## 8. JS -> Python frames

### 8.1 health

返回 protocol、capability、模型/index 状态和 fallback readiness。health 响应必须有界。

### 8.2 context_push

payload 是完整 ContextPushEnvelopePre。Python 必须校验 deadline、observationId、scope、contextVersion、memoryIndexVersion；先返回 ContextAck，再做允许的异步语义工作；同 observationId 幂等；同 session 新 contextVersion latest-wins。

### 8.3 evidence_sync

~~~ts
interface EvidenceSyncPayloadPre {
  schemaVersion: 1
  syncId: string
  workspaceRef: string
  memoryIndexVersion: string
  aggregates: EvidenceAggregatePre[]
}
~~~

Evidence 是只读特征；missing/unknown 不是负证据。

### 8.4 index_sync：全库语义检索唯一输入

仅有 context_push.memoryRefs 会把 Python 限制为 BM25 rerank；M7 必须实现 index_sync。

~~~ts
interface IndexSyncBeginPre {
  schemaVersion: 1
  syncId: string
  workspaceRef: string
  scope: 'Workspace' | 'User'
  memoryIndexVersion: string
  sourceTuples: Array<{sourceRef:string;sourceEpoch:string;sourceVersion:number;fileDigest:string}>
  recordCount: number
  pageCount: number
  indexPolicyVersion: 'index_sync_pre_v1'
}

interface SemanticRecordPre {
  memoryId: string
  anchorId: string
  scope: 'Workspace' | 'User'
  workspaceRef: string
  sourceRef: string
  sourceEpoch: string
  sourceVersion: number
  fileDigest: string
  recordDigest: string
  heading?: string | null
  text: string
  occurredAt?: number | null
  chunkId: string
  chunkOrdinal: number
  chunkCount: number
}

interface IndexSyncPagePre {
  schemaVersion: 1
  syncId: string
  pageNo: number
  pageCount: number
  pageDigest: string
  records: SemanticRecordPre[]
}

interface IndexSyncCommitPre {
  schemaVersion: 1
  syncId: string
  memoryIndexVersion: string
  finalDigest: string
}
~~~

规则：JS 选择并限制 record text；Python 不打开源文件；同一 sync 的 workspaceRef/scope/memoryIndexVersion 一致；所有 page digest 和 final digest 通过后原子切换 derived index；版本变化淘汰旧 index；chunkId 不替代 memoryId；建议每页 <=64 records、<=256 KiB。

### 8.5 cancel/close_session

cancel 按 requestId 或 observationId 终止允许取消的工作；close_session 清除该 session 的 semantic state 和 pending activation，不影响其他 scope。

## 9. Python -> JS frames

### 9.1 candidate_result

~~~ts
interface CandidateResultPre {
  requestId: string
  workerEpoch: string
  sessionId: string
  workspaceRef: string
  memoryIndexVersion: string
  candidates: Array<{candidateId:string;memoryId:string;anchorId:string;scope:'Workspace'|'User';sourceRef:string;sourceEpoch:string;sourceVersion:number;fileDigest:string;recordDigest:string;score:number;method:'dense'|'sparse'|'hybrid'|'rerank'|'graph';rank:number}>
  policyVersion: string
}
~~~

candidate_result 只用于诊断/评测，不直接进入 M6。

### 9.2 activation_request

~~~ts
interface ActivationRequestFramePre {
  requestId: string
  workerEpoch: string
  activation: ActivationRequestPre
}
~~~

Python 只能复制 JS 输入中的 provenance；JS adapter 把 nested activation 交给现有 M6 validator。Python 不构建 ReferenceTailPacketPre。

### 9.3 judgement_suggestion

建议可以输出 noise、working_only、episodic_candidate、semantic_candidate、profile_candidate、procedure_candidate、resource_candidate、conflict_or_supersede_candidate 之一，以及 keep/link_suggest/merge_suggest/supersede_suggest/discard_suggest/promote_suggest 之一；必须引用 source IDs、contextVersion、memoryIndexVersion、supporting/counter evidence、confidence 和 policyVersion。仅 shadow audit，不写权威 memory。

## 10. Derived index 与 embedding identity

Python 只可写可重建 preview state，例如：

~~~text
<DSH_HOME>/memory/semantic-pre/
~~~

不得写 Markdown 旁。每个 vector/chunk 必须绑定 provider、model、modelRevision、dimension、normalization、configHash、embeddingVersion、sourceEpoch、sourceVersion、recordDigest、chunkId。模型、revision、dimension、normalization、configHash、source version 或 digest 不一致即 stale，禁止混用。

chunking 对 pinned tokenizer/config 必须确定；chunk 聚合到 parent memory 的方法必须显式并经过 benchmark。

## 11. 算法实施门

### 11.1 Embedding

至少 benchmark：BGE-M3、Qwen3-Embedding-0.6B、multilingual-e5-large；运行层比较 Sentence Transformers 和 FlagEmbedding。记录 pinned revision、license、dimension、中英代码能力、CPU/GPU latency、memory、下载和离线策略。禁止把 CC-BY-NC 模型作为默认分发路径。

### 11.2 Dense

当前约 176 records，首版使用 NumPy float32 + L2 normalize + exact matrix dot。FAISS IndexFlatIP 是允许的 exact 等价升级；HNSW/hnswlib 只有规模或延迟 benchmark 证明必要时才引入。tie-break 固定 score/rank 后 memoryId 字典序。

### 11.3 Sparse/hybrid

lexical_pre_v2 是强制 baseline/fallback。比较 lexical、dense、bm25s/FTS5 sparse、BGE sparse、weighted fusion 和 RRF；RRF 初始研究 k=60，最终须由 Recall@K/MRR 消融冻结。

### 11.4 Rerank

候选可用 bge-reranker-v2-m3、Qwen3-Reranker-0.6B 或 FlashRank；只 rerank bounded top-K，例如 50 到 10；timeout/unavailable 保留 pre-rerank 顺序。

### 11.5 Graph

默认关闭。只有多跳 benchmark 证明收益才启用；优先小型、可重建、有 provenance 的 networkx/PPR。HippoRAG/A-MEM/Graphiti 只作研究参考，不起步引入图数据库。每条 edge 带 source IDs、scope、confidence、policyVersion、创建方法、支持和撤销信息。

禁止自行实现 embedding 模型、未验证 ANN 或凭直觉矩阵/图算法；优先成熟库并记录来源、revision、license、配置和 benchmark。

## 12. Active semantic policy

Per-session state key 为 sessionId + workspaceRef + scope，禁止无 scope 全局状态。特征分组：semantic/dense/hybrid/rerank、entity/graph、recency/salience/novelty、M5 evidence、unresolved/tool failure/repeated、ignored/correction/conflict/cooldown。

阈值、hysteresis、cooldown、activation level、fusion weights、model/tokenizer 全部 policyVersion 化。只有最新 contextVersion、index ready、fresh in-scope provenance、M6 budget 合规且 score 穿越校准阈值时才发 ActivationRequestPre。JS 保留 hard veto。

## 13. Process、回退与安全

- JS 只在显式 M7 enable 后 no-shell spawn Python。
- stdin/stdout JSONL；stderr diagnostics；无监听 server。
- JS 管理 timeout、AbortSignal、workerEpoch、request map、backpressure 和 circuit breaker。
- Python 默认不接收 secret；remote provider 需显式审计。
- Python 不执行记忆文本中的指令。
- frame、queue、CPU/time、batch、candidate、output bytes 全有硬预算。
- Python unavailable/crash/timeout/bad frame/stale：JS 回退 lexical_pre_v2；fallback 失败 suppress；无安全 surface shadow only。

### 13.1 M7 解锁配置

当前 JS 对非 fake source/sink 明确拒绝：contextSinkMode 只有 null/fake，activationSource 只有 fake。M7-1 的薄 JS SidecarClient 适配层必须在三重门下增加 python：

~~~text
associativeMemoryEnabled && pythonBackendEnabled && contextBridgeEnabled
contextSinkMode = 'python'
activationInboxEnabled && pythonBackendEnabled
activationSource = 'python'
~~~

默认值仍全部 false/fake/null。unlock 只开放真实 Python wire，不改变 M6 validator、claim、render、delivery 或 seen 语义。

## 14. 评测契约

必须 replay M5 frames 和 M6 fake fixtures，比较 lexical_pre_v2、dense、sparse、weighted、RRF、rerank、graph、active threshold 和 stale/fallback arms。指标包括 Recall@1/5/10、MRR、nDCG、activation precision/recall、false activation、helpful/harmful tail、stale/drop/fallback/timeout、p50/p95 latency、memory/cost、duplicate/contamination/delivery funnel、cross-session/workspace leakage=0。

使用 LongMemEval、LoCoMo 和自有 golden replay；事件时间与 ingestion time 分开；评测可断点续跑；CI 不联网调用模型，使用 configHash 锚定 fixture vectors。

## 15. 实施阶段

- M7-0：protocol validator、JSONL framing、health、workerEpoch、fake worker、坏帧/超时/过期/drop tests；无模型。
- M7-1：JS SidecarClient + index_sync begin/page/commit + Python atomic derived index。
- M7-2：一个 benchmark 通过的 embedding provider、config hash、dimension、revision、rebuild/stale。
- M7-3：exact dense、lexical baseline、weighted/RRF 对照。
- M7-4：bounded top-K rerank、timeout fallback。
- M7-5：benchmark 证明收益后才 graph。
- M7-6：per-session semantic state、threshold/hysteresis/cooldown、主动 activation_request。
- M7-7：Semantic/Profile/Procedure judgement shadow；只 audit，不写权威 memory。
- M7-8：用户控制的 live verification。

## 16. 测试矩阵

至少覆盖：JSONL partial/oversize/bad UTF-8/unknown type；workerEpoch restart/old response；四种 identity 区分；index_sync 缺页/重复/乱序/digest mismatch/atomic commit；provenance/scope/workspace/index fail closed；deadline/latest-wins/cancel/close；M6 validator compatibility；candidate/excerpt/checklist/TTL budget；exact dense tie-break；RRF properties；embedding stale/rebuild；rerank timeout；graph provenance/revoke；activation replay；Python unavailable/circuit breaker；disabled zero process/IO；A/B zero leakage；M6 tail/delivery/seen unchanged；M0-M6 20 项回归继续通过。

## 17. 完成门

M7 只能在 protocol/index_sync replay 确定、每个 activation 通过 M6 validator、Python absent/delayed/malformed/stale 正确回退/丢弃、embedding identity mismatch fail closed、cross-scope leakage=0、disabled zero process、算法来源/license/model revision/benchmark 完整、M6 delivery/seen 不回归、GUI 活体验证通过且用户批准后标记 live。

## 18. 外部 Agent 纪律

实现前读本文件与 docs/M7-PYTHON-IMPLEMENTATION-REPORT.md，先跑 git status 和 M0-M6 20 项基线；保留所有未提交/未跟踪文件；不得从 graph/ANN 开始，不得绕过 index_sync，不得让 Python 写 Host 权威状态；每阶段更新证据，未经 live 验证不得改 state。

## 19. 实施状态(M7-0/M7-1 完成,2026-08-24 tested —— 未 live)

状态:**M7-0 Protocol + Fake Worker 与 M7-1 Authorized index_sync 已实现并通过专项测试**;M7-2 起未动(零 embedding/零向量检索/零 reranker/零聚类/零图算法)。默认关闭(pythonBackendEnabled=false)时零 Python process、零协议 IO、零 semantic-pre 目录。按 §17 完成门,**本阶段只标 tested,不标 live**(无 3080 活体验证;live 属 M7-8 且需用户控制)。

### 19.1 交付物(M7-0)

| 交付 | 说明(契约 §) |
| --- | --- |
| lib/m7-wire-pre.js | 纯协议核心:m7_wire_pre_v1 常量+传输预算冻结(maxLineBytes 256KiB/requestTimeoutMs 5000/pending 64/breaker 3 次·30s);JS_TO_PY 与 PY_TO_JS 帧类型两个不相交集合+RESPONSE_TYPE 映射(cancel/close_session 无响应);canonicalJson+sha256Canonical(与 Python worker 逐字节一致:排序键/无空白/UTF-8);envelope validator 七字段全检+方向门;SemanticRecordPre/IndexSyncBegin/Page/Commit/IndexAck payload validators;chunkId(chk_pre_)/syncId(syn_pre_)/pageDigest/finalDigest canonical identity |
| python/worker_pre_v1.py | 确定性 fake worker(纯标准库 argparse/hashlib/json/os/re/sys/tempfile):stdin/stdout 一行一 JSON,stdout 只出协议、stderr 有界诊断(≤64 条);同 fixture 输入两进程输出逐字节相同(测试实证);不监听 HTTP、不读任何 DSH 文件,唯一写路径=显式 --dsh-home 下 memory/semantic-pre/(tempfile+os.replace 原子切换);context_push 幂等(obs_pre_ 二次 busy)、health 回显 corpus 视图、cancel/close_session 无响应帧;index_sync 状态机(begin/page/commit 全拒绝语义:任一终局失败即作废整次 sync);deterministic fake activation 从 memoryRefs 复制 provenance(miv 非 idx_pre_ 或身份缺失则静默不发,fail closed) |
| lib/python-sidecar-client-pre.js | SidecarClient:no-shell spawn(lazy start,仅显式启用路径触达);每次启动新 workerEpoch(wk_pre_+32hex),入站 epoch 不符即丢;request() 永不 reject——结构化 {ok:false,code}(timeout/aborted/crashed/unavailable/circuit-open/backpressure/protocol/worker-error/disposed);JSONL partial 重组/multi-lines 单 chunk 多请求各自关联/单行超限 fatal(清残留 buffer 防污染重生流)+crash 自动重生;error 帧=终局答复(先于类型匹配关联);AbortSignal→aborted+向 worker 发 cancel 帧;circuit breaker 连续失败≥3 打开 30s,冷却后半开探测成功归零;四种身份(requestId req_pre_/observationId obs_pre_/activationId act_pre_/syncId syn_pre_)不混用 |
| lib/context-sink-python-pre.js | PythonContextSinkPre 实现 M5 ContextSinkPre:payload=完整 ContextPushEnvelopePre 原样透传(零字段增删);deadlineAt 前预算内返回 ContextAckPre(validateContextAckPre+observationId 回显校验);失败映射 reason 枚举(timeout/aborted→busy,其余不可用→unsupported,过期 deadline→stale);activation_request 经 onActivation 上抛给现有 M6 host,本模块不构建 Packet |
| lib/index-sync-pre.js | (M7-1)buildIndexSyncPlansPre:corpus snapshot→按 scope 分组(Workspace→User 固定序)的 begin/pages/commit 计划;分页 ≤64 条且 ≤256KiB(JSON 字节,单条超限 record-oversize fail closed);toSemanticRecordPre 授权投影(15 字段全量,occurredAt=null,text=快照已授权切片);sendIndexSyncPlanPre 顺序执行任一 ack 拒绝即中止 |
| index.js/context-host/activation-host 接线 | DEFAULT_CONFIG 新增 pythonBackendWorkerPath=''/pythonBackendExecutable=''(pythonBackendEnabled=false 既有);engine._pythonSidecar 共享客户端(对象构造零副作用);debug 新增 pythonBackend 投影(enabled+started+stats);disposer 清理;三重门解锁:assoc∧bridge∧pythonBackend→sinkMode='python',assoc∧inbox∧pythonBackend→sourceMode='python';activation-host 新增 offerExternalActivation(python 来源入箱走既有 validator/inbox 门,**不做注入即泵**,pre-step 自然 claim 保留) |

### 19.2 交付物(M7-1 index_sync 行为)

- happy path:begin→pages→commit 全 accepted;commit 后 derived-corpus.json 仅存在于 `<DSH_HOME>/memory/semantic-pre/`(tempfile+os.replace,目录无 .tmp 残留);重放同一快照落盘字节逐字节一致(完全可重建·确定性)。
- 整次拒绝矩阵(全部实测):缺页 missing-page / 重复页 page-duplicate / 乱序 page-out-of-order / pageDigest 篡改 digest-mismatch / finalDigest 不符 final-digest-mismatch / commit 版本不一致 version-mismatch / 记录 workspaceRef 中途不一致 record-scope-mismatch;每次失败派生态字节不变、active sync 作废(后续同 syncId → no-active-sync)。
- 版本替换:v2 sync commit 后旧 memoryIndexVersion 零残留(落盘内容不含旧 miv;health corpus 视图仅呈现当前版本;记录数整体替换)。
- chunkId 是派生定位(chk_pre_=hash(memoryId+recordDigest)),永不替代 memoryId;占位 chunking=整记录单 chunk,M7-2 tokenizer 落地前冻结此规则。

### 19.3 测试证据

| 套件 | 结果 |
| --- | --- |
| smoke-test-m70-pre.mjs | G1-G9 共 **90 断言 exit 0**:常量冻结/canonical JSON 已知向量/envelope 正反例+方向门/framing(partial·multi-line·bad JSON·oversize·epoch 门·type 混用)/ack 过 validateContextAckPre(M5 兼容)/worker activation 过 validateActivationRequestPre+候选逐条复制(M6 兼容)/obs 幂等/determinism 两进程逐字节/epoch 重启旧响应丢弃/SIGKILL crash 结构化 crashed/timeout·cancel·breaker·half-open/身份不混用/Python 缺失结构化 unavailable+lexical_pre_v2 结果不变/A-B 会话零串线/harness 默认零进程零 IO 零目录+三重门矩阵(fake-only 注入路由不变) |
| smoke-test-m71-pre.mjs | H1-H9 共 **90 断言 exit 0**:15 字段投影/chunk 派生/syncId 确定/64 条与 256KiB 边界+单条超限 fail closed/E2E happy path+原子落盘无 tmp 残留+重放字节一致/七类失败全拒且派生态零变化/v2 整体替换旧版零残留/内存模式 persisted=false/身份格式分离/M5-M6 兼容复assert/同步失败后 lexical_pre_v2 不变 |
| 全量回归 | **22 项串行全绿**(M0-M6 原 20 项+m70+m71;含 smoke-test.mjs 与 m3b3 凌晨窗口修复后复跑) |
| 卫生 | node --check×11 文件=0;py_compile=0;git diff --check=0;12 个触碰文件 BOM 扫描净;`_dev` 扫描净;UTF-8 无 BOM |

### 19.4 偏差与顺手修复(全部披露)

1. **页级一致性检查位置**(契约对齐):IndexSyncPagePre payload 按 §8.4 不含 scope/workspaceRef/memoryIndexVersion 字段,worker 不做页级三查;一致性由 syncId 绑定 begin+逐条 records 的 scope/workspaceRef 检查+commit 的版本/finalDigest 校验共同承担。测试相应覆盖 record-scope-mismatch 与 commit version-mismatch。
2. **error 帧关联顺序**(client 修正):worker error 帧类型恒 ≠ expectedType,必须先于 type-mismatch 分支按 requestId 关联为终局失败;否则 commit-before-begin 类错误表现为 timeout。
3. **fatal 后缓冲清理**(client 修正):line-oversize fatal 时丢弃残留半帧缓冲,防止污染重生进程解析流。
4. **fake 注入即泵不变**:python 来源经 offerExternalActivation 入箱,不做 pump;真实 Python 推送与 fake 泵并存但路径隔离(M6-4 偏差仍限 fake)。
5. **顺手修复(非 M7 范围,阻塞回归基线,凌晨窗口实测)**:①lib/index.js maintain():归档 cutoff 取日期零点(setHours(0,0,0,0))——原实现含时分秒,00:00-日界窗口内会把当天日志误判为旧日志归档掉(smoke-test-m3b3 E8 实证:当天 anchored 日志被 archive/);②smoke-test.mjs smkToday 改用与引擎 memToday 相同的 450 分钟日界(原用裸本地日期,凌晨窗口必挂)。两项均已回归验证。

### 19.5 进程生命周期(实现事实)

- 关闭(默认):pythonBackendEnabled=false → 三重门恒假 → null sink/fake source;engine._pythonSidecar 仅构造空对象,stats.starts=0,无 process/IO/目录。
- 开启:门全开+首条流量 → ensureStarted() no-shell spawn `python worker_pre_v1.py --expect-epoch <wk> [--dsh-home <home>]`;epoch 随进程绑定;exit/error → pendings 结构化失败+允许重生(新 epoch);dispose(plugin disposer)→ kill+清 pending。
- Python 不可用:spawn 失败计 breaker;上层 sink 得 unsupported ack;lexical_pre_v2 本地回退结果逐项不变(G8/H9 实测)。

### 19.6 M7-2 完成(tested,2026-08-24 —— 未 live)

状态:**Embedding/Tokenizer/Chunking Benchmark 完成并冻结默认 policy**;报告=docs/M7-EMBEDDING-BENCHMARK.md,决策=docs/M7-ALGORITHM-DECISION.md,机器可读=artifacts/m7-benchmark-pre/results.{json,csv}(L1 合成+L2 真实双层 30 行),模型 manifest=python/bench/results/model-manifest.json(三模型逐文件 sha256)。

| 决策 | 冻结值 |
| --- | --- |
| embedding provider | BAAI/bge-m3 @ 5617a9f61b028005a4858fdac845db406aefb181(MIT,2.29GB,1024d,CLS 池化=仓库 1_Pooling 权威) |
| chunk policy | **m7_chunk_pre_v1 = para-512-noov**(tokenizer id 空间段落贪心装包 ≤512,超长段内硬切无重叠);占位整记录单 chunk 作废,chunkOrdinal 入 chunkId hash |
| 检索 | NumPy float32+L2+精确点积;查询无前缀、≤256 token;tie-break score→memoryId→chunkOrdinal |
| 备选 | qwen3-emb-0.6B(hard-neg 判别优,延迟/内存劣势,条件备选) |
| 淘汰 | multilingual-e5-large(zh→en xlang@5=0.60,512 硬上限) |

关键证据:L1(152 记录/88 查询)bge-m3 para-512 R@5=0.966/MRR 0.889/跨语 1.0/p95 189ms;L2(251 真实 episodes/40 手写查询)R@5=0.925/MRR 0.793/hard-neg err 0.074/p95 241ms。supersede 裸 cosine 4/8 失败→三模型同病→交 M7-3 融合(supersede/时效特征)与 M7-6 多特征阈值,禁止靠换模型解决。scope 门证据:6 镜像查询 scoped 泄漏=0,无 scope 时镜像可入侵 top5→scope 过滤必须在宿主侧。

交付物:python/bench/(独立 venv+9 个模块:L1/L2 语料、tokenizer chunker、三模型 canonical pooling、双层 benchmark、fixture 导出、hf-mirror 分段下载器、产物汇编);artifacts/m7-corpus-pre/(251 episodes+40 queries+10 hard-neg 对+8 activation scenarios+隐私报告,外部语料只读脱敏);smoke-test-m72-pre.mjs(K1-K7 共 21 断言,fixture vectors 零联网)+tests/m7-2-fixtures/embedding-fixture.json(42 docs×8 queries 真实向量)。

偏差披露:①M7-BENCHMARK-PLAN.md 于模型下载后补写(自主模式接管前顺序,方法一致);②e5 首轮两处实现 bug(doc 前缀未入 chunk 流/512 上限越界)已修复并全量复跑,报告数字均为修复后;③顺手修复 smoke-test-m70-pre.mjs G7 harness 的 effect 空桩——真实宿主会在卸载时执行 effect 清理,空桩丢失 heartbeatTimer 的 clearInterval 导致进程无法自然退出(90 断言本身全过;仅测试 harness 修复,零生产代码改动)。

M7-3 输入:决策 D4(worker_semantic_pre_v1.py 新文件复用 worker_pre_v1 协议层;arms=lexical 复刻/bm25s/weighted/RRF k 消融;supersede/时效特征进融合;fixture-only CI)。

### 19.7 M7-3 完成(tested,2026-08-24 —— 未 live)

状态:**Production dense provider + versioned derived vectors + hybrid 对照完成并冻结融合 policy(D6=hybrid_fusion_pre_v1)**;对照数据=artifacts/m7-hybrid-pre/results.{json,csv}。

| 交付 | 说明 |
| --- | --- |
| python/m7_embedding_pre_v1.py | 冻结 policy 生产实现:可插布 provider(hash-pre-v1 纯标准库确定性[CI/离线]/bge-m3-pre-v1 transformers 真模型)、para-512-noov chunk、identity block+configHash、canonical JSON(与 worker_pre_v1 逐字节一致) |
| python/worker_semantic_pre_v1.py | 语义 worker:**继承 worker_pre_v1.Worker,零协议改动**(复用全部 validator/rejection 矩阵/原子落盘);commit 成功后建向量写 semantic-pre/vectors-{hash}.json(identity block 绑定);启动时 identity/版本失配=stale 拒用,commit 重建;context_push 后 dense top-8 影子候选写有界 candidates-shadow.jsonl(不发新帧——冻结 client 只关联 ack/activation,candidate_result 帧类型保留至 M7-6);fake activation 抑制;无 embedding 配置→纯协议降级;模型缺失→enabled+error 不崩。provider 选择=DSH_M7_EMBEDDING_CONFIG env(零 CLI/JS 改动) |
| smoke-test-m73-pre.mjs | N1-N8 共 **55 断言 exit 0**:health embedding 视图/vectors identity(chunkOrdinal 入 hash)/影子候选(observationId+miv+provenance 五元组+memoryId 聚合)/miv 跨 wsRef 零串线+未知 miv fail closed/stale 拒用+重建/rejection 矩阵零回退/无配置降级/真 provider 缺模型不崩 |
| python/bench/m7b_hybrid.py | 对照 arms:lexical 复刻(停用词运行时提取自 lib/shadow-retrieval-pre.js 防漂移)/bm25s 0.3.10(Lucene,自管 vocab)/dense(冻结 D1/D2)/weighted w∈{.3,.5,.7}/RRF k∈{10,20,40,60,100}/supersede γ∈{.02,.05} |
| 决策 D6 | **hybrid_fusion_pre_v1=weighted minmax,dense 0.7+lexical 0.3**(L2 R@5 0.950/MRR 0.866/hardneg 0.074 全面优于 dense-only 0.925/0.774;L1 0.966 持平);RRF k 不敏感(k=60 文档化备选);bm25s 与自研复刻 R@5 完全一致→生产零新依赖;supersede γ 无效果→不冻结,移交 M7-6 |

偏差披露:①worker_semantic 的 run-loop 从 base.main() 复制(worker_pre_v1 无可注入入口;不修改已 tested 文件);②candidate_result 帧不发(M7-0 client 只关联 ack/activation,unsolicited 帧会 type-mismatch 触发 breaker——协议面零扩展是本轮正确选择,M7-6 接 activation 时一并处理);③全量回归 **24 项全绿**(23+m73)。

### 19.8 M7-4..M7-7 完成(tested,2026-08-24 —— 未 live,等待 M7-8 人工门)

| 阶段 | 交付与结论 |
| --- | --- |
| Clustering Shadow(任务集 §七) | artifacts/m7-cluster-pre/:agglomerative(cosine/average/thr=0.3)NMI 0.916/B-cubed 0.782/bootstrap 稳定性 0.995;HDBSCAN 不适用(单例语料噪声 62-100%);UMAP/BERTopic skipped-by-scope;clusters.json 簇 artifact 全字段;**shadow-only,零 M6 接线**。决策 D8 |
| M7-4 Rerank | bge-reranker-v2-m3 @953dc6f6f85a(Apache-2.0)全量:top50→10 使 L1 R@5 0.966→**1.0**/MRR 0.947/supersede 0.625,L2 hardneg 减半;qwen3-reranker-0.6b @e61197ed4502 探针(质量同档,hardneg 劣);FlashRank 跳过(托管不可达)。**CPU 延迟 p50 26-33s/50 对,超预算 50-90 倍→D9=deferred-optional,不接生产同步路径**(量化/GPU 后重评)。artifacts/m7-rerank-pre/ |
| M7-5 Graph 门 | 8 条多跳探针:hybrid top-10 双端点覆盖 6/8,缺口由 M7-6 supersede/时效特征在融合层补;**skipped-by-benchmark(任务集 §九定义为正确完成)**;零图服务。artifacts/m7-graph-pre/gate.json。决策 D10 |
| M7-6 自动激活 | worker_semantic:per-session 状态(sessionId+workspaceKey+scope,close_session 清)、双阈值 suppress/prefetch/emit+T_on>T_off 滞回+cooldown、特征分组(denseTop/margin/evidence 三类/toolFailures/recency)逐次落 activation-shadow.jsonl;**shadow 校准默认(tOn=0.62/tOff=0.52 初值)**;active 模式 activation_request 帧**逐字段过 M6 validateActivationRequestPre**(smoke-test-m76-pre.mjs Q2 实证:33 断言全绿含 provenance 七字段复制/ttlSteps≥2/excerpt 预算/滞回与冷却序列/close_session 状态清除/未知 miv fail closed)。决策 D11 |
| M7-7 Judgement Shadow | worker_semantic:8 类 kindCandidate(marker+启发式)+keep/merge/supersede 建议;每条 sourceIds/contextVersion/miv/support+counter evidence/confidence/policyVersion=judgement_shadow_pre_v1;只写 judgement-shadow.jsonl;**零 MEMORY.md/evidence/Procedure 写入**(m77 15 断言全绿,含唯一写路径结构性断言) |
| model-sparse 补测 | handoff §六缺口补齐:bge-m3 sparse(relu 线性层+token-id amax+点积,官方 recipe 核验)——L2 单独 R@5=0.950/hardneg=0.037(胜 dense 单独),dense+model-sparse w=0.7 L2 R@5=**0.975**(全研究最高)但 MRR 0.846<D6 默认 0.866→**D6 修正案:默认不变(dense+lexical),model-sparse 记录为最优 R@5 备选,M7-6 校准期重评**(同编码器零边际模型成本是显著优势) |

- 测试:**全量回归 26 项串行全绿**(M0-M6 20+m70/m71/m72/m73/m76/m77);专项断言累计 21+55+33+15=124;node --check/py_compile/git diff --check/BOM/_dev 全净。
- handoff 自查(2026-08-24 05:28 粘贴版):合规项/已修缺口(42 条人工审查清单、质心说明、状态备份)/披露偏差(benchmark plan 事后补写、rerank bench 双模型常驻)记录于 artifacts/m7-autonomous-pre/state.json handoffAudit。
- **安全状态:全部默认关闭/shadow;默认安装零 Python 进程零协议 IO 零 semantic-pre 目录(M7-0 G7 语义未被触碰);M7-8 前唯一激活路径=显式 activationPolicy.mode='active' 且三重门全开且过 M6 validator。**

#### M7-8 用户操作步骤(唯一人工门,Agent 已停止在此)

> **前置:M7-7.5 Hardening 已完成(2026-08-24,审阅意见全部落实),本节步骤方可执行。**

1. 前置确认:`git status --short --branch`(应见本文件所列全部未提交产物,无丢失)。
2. 复核开关现状(改前留证):GET http://127.0.0.1:3080/api/dsh-auto-memory-pre/debug → associativeMemory(应 assoc/inbox/bridge/pythonBackend 全 false,anchor=true)。
3. 准备 embedding 配置文件(任选):
   A. 离线确定性:{"provider":"hash-pre-v1","dimension":64}(零模型,验证协议链路);
   B. 真模型:{"provider":"bge-m3-pre-v1","modelDir":"D:/dsh-auto-memory/python/bench/.hf-cache/models--BAAI--bge-m3/snapshots/5617a9f61b028005a4858fdac845db406aefb181","modelRevision":"5617a9f61b028005a4858fdac845db406aefb181","dimension":1024,"torchThreads":16}
   可选键:"search":{"mode":"hybrid","wDense":0.7}(默认即 D6 融合)、"lexicalStopwords":[…](宿主拥有的词法停用词策略注入点)、"activationPolicy":{…}(mode/tOn/tOff/cooldownObs;**M7-8 首轮必须 mode='shadow'**,校准后再切 active)。
   并设置宿主进程环境变量 DSH_M7_EMBEDDING_CONFIG=<该文件路径>;worker 路径指向 python/worker_semantic_pre_v1.py(config pythonBackendWorkerPath)。
4. **重启 3080 宿主**(用户手动;Agent 全程不碰)。
5. 开启链路(config POST,一次一项观察):associativeMemoryEnabled=true→contextBridgeEnabled=true→pythonBackendEnabled=true→contextSinkMode='python'→activationInboxEnabled=true→activationSource='python'(激活帧消费需 activationPolicy.mode='active';首轮保持 shadow 仅观察影子日志)。
6. 自然流量验证:进行一段包含记忆命中话题的对话;依次核验(全部 GET/读文件):
   a. <DSH_HOME>/memory/semantic-pre/ 出现 derived-corpus.json+vectors-*.json+三类影子 jsonl;
   b. debug 投影 pythonBackend.started=true 且 stats 无 breaker 连开;
   c. candidates-shadow.jsonl 有 hybrid 候选(denseScore/lexicalScore/fusedScore 三分量,provenance 齐);
   d. activation-shadow.jsonl 决策序列合理(emit/cooldown/prefetch/suppress/conflict 抑制);
   e. (mode='active' 校准后)尾注进入 model-visible messages(delivered)且 M5 seen 落盘;
   f. judgement-shadow.jsonl 仅审计,无任何 MEMORY.md/evidence 新写。
7. stale/fallback 抽测:改 embedding 配置 dimension(如 1024→128)重启 worker→health embedding.staleEntries≥1→重推 corpus→重建 ready;停掉 DSH_M7_EMBEDDING_CONFIG→lexical_pre_v2 回退结果不变。
8. 跨 scope 零泄漏:A/B 两 workspace 会话并发(**同 memoryIndexVersion 场景必须覆盖**)——worker 端 workspaceRef+scope+miv 三重过滤已由 smoke-test-m73 N9 实证,宿主端复测同款。
9. **验证后全部恢复默认关闭**(assoc/inbox/bridge/pythonBackend=false,sinkMode='null',source='fake',anchor=true 不动);删除 semantic-pre 目录即完全回退。
10. 全部通过后由用户宣布 M7 live;任一步失败→恢复默认→把 debug/日志交回 Agent 分析。

### 19.9 M7-7.5 Hardening 完成(2026-08-24,审阅意见全部落实;仍未 live)

审阅结论(M7-8 前置 hardening 清单)逐项闭环:

| 级别 | 审阅发现 | 修复 | 证明 |
| --- | --- | --- | --- |
| P0 | 真实 BGE 建库路径调用不存在的 encode_texts/build_doc_ids,commit 即 AttributeError | BgeM3Embedder 补 build_doc_ids(prefix/suffix 包裹+512 上限截断)与 encode_texts(经 _encode_texts_via_ids 单一模板);worker build_vectors 分支派发:真 provider=tokenizer id 直通(build_doc_ids→encode_ids),hash=字符窗 | m7b_real_smoke.py **12 断言全过**:真模型建库落盘/L2 归一/identity block/**zh→en 与 en→zh 双向 gold top1**/hybrid 三分量/health ready,全程 19.2s |
| P1 | 生产路径 dense-only,与 D6 冻结(hybrid 0.7/0.3)不一致 | worker 实现 weighted minmax 融合(dense 0.7+lexical 0.3,BM25 k1=1.2 b=0.75 对齐公式,全量授权文本来自 derived entry);影子候选携带 denseScore/lexicalScore/fusedScore;search.mode/wDense 可配,默认 hybrid | m73 N3 method=hybrid;m76 分数=特征重算逐位一致;qwen 探针与 real-smoke 双语 top1 |
| P1 | 检索仅按 miv 过滤,workspace/scope 隔离靠间接 | dense_search 显式三重过滤(workspaceRef+scope+miv);workspaceRef 由请求 workspaceKey 经 JS published pure function 的 Python 逐字节镜像(wsref_of)推导,与 evidence-store-pre.js 对拍一致('D:/tmp/m76' 双侧 wsr_f9cc3f5a…) | m73 **N9 同 miv 跨工作区泄漏用例**:同一快照同步两工作区后互查零串线(此前该场景不可达) |
| P1 | activation 特征方向错误(correction 正向 +0.08;toolFailures 未入分;occurredAt 断链致 recency 恒 0) | correction 改负向(−0.20/次)且命中候选**硬抑制**(pre-rank 剔除+conflictDropped 落日志);toolFailures 权重 +0.05·min(1,n·0.5);occurredAt 经 chunk 行→dense_search 候选→features 全链传递 | m76 Q6 新增 11 断言全过(correction 命中=决策行零 emit+conflictDropped 记录;指向他者时正常 emit;分数=特征重算含 toolFail 正向项)。**契约事实固化:index_sync 投影 occurredAt=null(语料无时间概念),recency 特征已接线但休眠,待 M3 语料携带时间后自动生效** |
| P1 | BGE query 双重 special tokens(add_special_tokens=True 后 encode_ids 再包一次) | encode_query/_encode_texts_via_ids 统一 add_special_tokens=False,由 encode_ids 单点包裹;查询/语料共享单一模板 | real-smoke 双向跨语言 top1 即模板一致性证明;build_doc_ids 含上限截断 |
| P2(二轮复核修正) | 首次修复把规则写进了嵌套 python/bench/.gitignore 且用根相对路径——嵌套语义解析为 python/bench/python/bench/...,实际零命中(check-ignore exit=1,审阅者实测正确) | 规则移入根 .gitignore 并删除错误嵌套文件;git check-ignore 逐项验证:.hf-cache/(2.29G)、models/(9.7G)、.venv/、bench 日志、artifacts/m7-corpus-pre/*.jsonl(episodes/queries/review-queue/hard-negatives/activation-scenarios 全部含真实会话派生内容)均 IGNORED;论文/汇总 results.csv·json/model-manifest.json/privacy-report 保持可提交。原始 corpus jsonl 保留于本地供 M7-8 shadow 标定使用(仓库不入库) | git check-ignore -v 输出留存于本轮日志;若未来迁移语料至私有目录,同步删除对应规则即可 |

- 回归:**26 项串行全绿**(hardening 后复跑);专项断言现为 m72=21/m73=59(+N9 泄漏用例)/m76=44(+Q6 六断言)/m77=15;另 real-smoke 12 断言(带模型手跑)。**顺手修复(审阅外发现):smoke-test-f1-pre.mjs 三处硬编码日期(2026-08-19/20/23)跨 450 分钟日界后触发 G2/G3 flake——改为与引擎 memToday 同款动态日期,20 断言全过;零生产代码改动。**
- 已确认保留的原有结论(审阅"已确认合理的决策"清单):BGE-M3 默认/para-512-noov/e5 淘汰/qwen3 备选/rerank 不进同步路径/graph skipped-by-benchmark/M7-6 双阈值体系/M7-7 影子纪律——全部不变。
- **M7-8 判定更新:hardening 完成后,§19.8 十步流程的前置条件已满足;执行与否仍由用户决定。**

**二轮自查补充(2026-08-24 14:30)**:①`_encode_texts_via_ids` 截断预算未预留 specials 位(包裹后 514)——bge-m3(8192 位)无害但与 e5 越界同类,已改为预算内截断;query_cap 同步预留。②chunkId 派生差异显式化:worker 向量块的 chunkId 一律含 chunkOrdinal(D2 冻结口径),而宿主 index_sync 占位投影为无序数公式——两者仅在影子日志/诊断出现(chunkId 永不替代 memoryId+provenance),M7-3 生产接线时宿主侧须同步升级公式并升 policyVersion。③临时调试文件已清理。

### 19.10 M7-8 Phase E Host Orchestration Fix(2026-08-24 —— JS Host 编排修复,未 live)

**根因修正(替换此前 blocker 假设)**:live 仅观察到 child-session Segment(observer ingested=49/segments=19 但 bridge envelopesBuilt=0,recentDrops=child-session)——**不能证明 observer 接线缺失**;onSegmentAccepted 回调实际到达(child-session drop 即证据)。**唯一静态确认的缺口=生产 Host 从未调用 buildIndexSyncPlansPre/sendIndexSyncPlanPre** → Python 收不到全库语料,无法建库。live-parity 测试证实:顶层 session user Segment 会正常触发 envelope 构建+worker lazy start+index_sync 编排(m78 P1),原 live 观察到的"无 envelope"是测试流量落在子代理(child-session 抑制)所致。

**修改点(全部 JS Host,未动 Python/算法/M6)**:
1. **lib/m7-index-sync-host-pre.js(新增)**:Host Index Sync Orchestrator——四门全开(assoc∧bridge∧pythonBackend∧sink='python')才启用;输入=已授权 M4 CorpusSnapshot;每 (wsRef,scope,miv,epoch) 幂等同步一次;epoch 变化重同步;miv latest-wins(abort 旧 in-flight);Workspace→User 固定序;失败结构化记录可重试;dispose 清理 in-flight/ready/abort 不删 derived cache。
2. **lib/context-host-pre.js**:onSegmentAccepted 时序修正——python sink 才等 index-ready(fake/null 不阻塞),ready 后才 push context_frame;旧 frame 由 cancelStale 作废;sync 失败不 push 并记 drop(下一 Segment 重试)。新增 live-parity 诊断:capturedPathKeys(≤8)/lastSegmentRuntimeKey/lastSegmentSessionRef(最小投影,无路径/文本)。
3. **lib/index.js**:创建 engine._indexSyncHost;debug 投影 indexSyncHost;disposer 清理。

**index sync 状态机**:idle →(Segment+四门)→ ensureIndexReady[empty-corpus/bad-miv 早退] → buildPlans[plan:reason 早退] → send begin/pages/commit → readyCache{wsRef|scope → {miv,epoch}} →(后续同 miv/epoch)readyHits 幂等;epoch 变→重同步;miv 变→abort+重同步;失败→不缓存可重试。

**测试(smoke-test-m78-host-pre.mjs,33 断言)**:
- P1 live-parity:已有 runtime+开三重门+顶层 user Segment → envelope≥1+worker lazy start+indexSyncHost 参与+capturedPathKeys/lastSegment 诊断。
- P2 child-session 抑制不建 envelope(child 正确 drop)。
- P3 编排器:首同步/同 miv 幂等(readyHits)/epoch 重同步/miv 替换(latest-wins)。
- P4 sync 失败→ready=false 不入缓存(可重试)。
- P5 A/B 同 miv 零串线(wsr 独立键)。
- P6 dispose→in-flight abort+ready 清空+零后续 IO。
- P7 activation 回流:index ready 后 context_push 到达→hash worker 建向量+影子候选落盘;门关闭→indexSyncHost disabled+sink 回退 null(零新流量;lazy 常驻进程留待 dispose)。
- 回归:全量 27 项(m0-m6 20+m70/71/72/73/76/77+m78)串行全绿;node --check/py_compile/diff-check/BOM/_dev 全净。

**后续 live 提示**:宿主默认 spawn worker_pre_v1.py(fake);真语义链路须 config POST 设 pythonBackendWorkerPath=worker_semantic_pre_v1.py(+pythonBackendExecutable=venv 解释器)。M7-8 需用户重启 3080 以加载新 Host 编排接线。
