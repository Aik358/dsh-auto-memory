# M7 接口契约摘要（上下文压缩恢复用速查）

> 生成:2026-08-24,来源:主 Agent 派发的只读研究(精读 lib/*.js + M5/M6-CONTRACT
> + python/worker_pre_v1.py)。恢复会话时读本文件即可获得接线所需全部接口事实,
> 不必重读全部源文件。权威仍以源码为准,本文件是精确摘要不是替代。

## A. ContextPushEnvelopePre(JS→Python context_push payload,原样透传)

```
schemaVersion:1 | namespace:'dsh-auto-memory-pre' | kind:'context_push'
observationId:'obs_pre_'+32hex
session{sessionId, agentId, workspaceKey(已canonicalize), scope:'Session'|'Workspace'|'User'}
cursor{eventSeq≥0, nativeSeq?, contextVersion≥0}
index{memoryIndexVersion:'idx_pre_'+32hex(空语料=32个0), sourceEpochs[]}
trigger/window: ContextSegmentPre[](≤8, UTF-8总字节≤4096)
memoryRefs: AuthorizedMemoryRefPre[](≤8)
evidence: EvidenceAggregatePre[](≤16)
policy{contextPolicyVersion:'context_bridge_pre_v1', gatePolicyVersion, lexicalPolicyVersion(默认'lexical_pre_v2'), evidencePolicyVersion:'evidence_pre_v1'}
budget{maxSegments:8, maxInputBytes:4096, maxMemoryRefs:8, maxEvidenceItems:16}
observedAt(ms) | deadlineAt=observedAt+5000
```
ContextSegmentPre: segmentId,digest(≥16ch),kind:'user'|'tool_call'|'tool_result'|'assistant',eventSeq,contextVersion,ts,text,toolName?,toolOk?,errorName?,errorCode?
AuthorizedMemoryRefPre: memoryId='mem_'+32hex小写, anchorId, scope:'Workspace'|'User', sourceRef=^(user|workspace|workspace-log):[A-Za-z0-9._\u4e00-\u9fff-]+$, sourceEpoch, sourceVersion≥1, fileDigest/recordDigest=64hex小写, excerpt≤480B(UTF-8 字节)。
帧>64KiB 时 JS 先裁 window 再整体不发。

## B. EvidenceAggregatePre

memoryId(mem_+32hex), scope, freshness:'fresh'|'stale'|'unknown',
distinctSessions, seen, read, cite, reuse, success, correction(全 int≥0),
lastEvidenceAt(ms), policyVersion:'evidence_pre_v1'。
AccessKind 六种:seen/read/cite/reuse/success/correction。Python 只读。

## C. validateActivationRequestPre 硬校验(按序,失败='invalid:字段,字段')

1 schemaVersion==1; 2 namespace; 3 kind=='activation_request';
4 activationId 非空str; 5 observationId 必须前缀'obs_pre_';
6 workerEpoch 非空str; 7 sessionId/agentId/workspaceKey 非空str;
8 scope∈三值; 9 contextVersion int≥0; 10 miv==^idx_pre_[0-9a-f]{32}$;
11 threshold{policyVersion非空, score有限, threshold有限, reason非空≤160ch};
12 level∈['index','hint','excerpt','checklist','resource','full'];
13 candidates 数组 1..8 条; 14 ttlSteps int 1..10;
15 createdAt 有限; 16 expiresAt≥createdAt。
candidate: candidateId非空, memoryId=mem_+32hex, anchorId非空,
scope∈'Workspace'|'User', sourceRef白名单正则, sourceEpoch非空,
sourceVersion int≥1, fileDigest/recordDigest=64hex小写,
score有限∈[0,1]; excerpt≤480 UTF-8字节(超=硬拒'excerpt-budget');
checklist≤8项×≤120字符。

## D. natural pre-step claim(激活全链路)

worker 输出帧 type='activation_request', payload={activation:{...}}(嵌套一层!)。
client: epoch 门→activationId 存在→256 环去重→activationHandlers。
context-host 注册 onActivation→activation-host.offerExternalActivation(activation)。
offer 门:assoc∧inbox(enabled) ∧ sourceMode=='python'(assoc∧inbox∧pythonBackend)
→ inbox.offerActivation:validator→身份三元组逐字一致→duplicate→suppress 名单
(命中=整单拒'suppressed-candidate')→cursor 门(cv<当前=stale-context)→
index 门(miv≠当前=stale-index)→构建 pending ReferenceTailPacketPre。
消费:下一次 agent/pre-step→stepFor 自增→setCursor→claim 四重门:
①cooldown(nowStep≤cooldownUntilStep 拒,投递后 cooldown=2 步)
②TTL(nowStep≥expiresAtStep=offer步+ttlSteps→expired 丢)
③cv 精确不等→stale-context 丢 ④miv 不等→stale-index 丢。
渲染 systemPrompt.context 组件 'dsh:m6-reference-tail-pre'→digest 复核→
markDelivered→异步按 references 建 kind='seen' evidence。
latest-wins:同 packetId=duplicate-packet;新 pending 顶旧(replaced)。
offer reason 全集:pending,replaced,duplicate-packet,duplicate-activation,
duplicate-observation,stale-context,stale-index,identity-mismatch,
suppressed-candidate,invalid-request,disabled,source-not-python,no-activation-id,disposed。

## E. SidecarClient API

createPythonSidecarClientPre({command='python', scriptPath, dshHome='',
requestTimeoutMs=5000, maxLineBytes=256KiB, breakerFailureThreshold=3,
breakerCooldownMs=30000, maxPendingRequests=64})——值或()=>值惰性。
request(type,payload,{timeoutMs,signal}): type∈health|context_push|
index_sync_begin|index_sync_page|index_sync_commit。永不 reject:
{ok:true,frame} | {ok:false,code,reason?,retryInMs?,timeoutMs?,detail?}。
code 全集:disposed,unsupported-frame,circuit-open,unavailable,crashed,
backpressure,protocol,timeout,aborted,worker-error。
notify(type,payload)(cancel/close_session 无响应帧), health(), restart(),
dispose(), ensureStarted(), isStarted(), currentEpoch()='wk_pre_'+32hex/次启动,
onActivation(h)→unbind。帧七字段:protocolVersion='m7_wire_pre_v1',frameId,
requestId,workerEpoch,type,payload,sentAt。

## F. PythonContextSinkPre 映射

deadlineAt 已过→ack{accepted:false,reason:'stale'};否则 timeoutMs=
min(requestTimeoutMs, deadline-now)。ack 校验 validateContextAckPre+
observationId 逐字回显;失败→'unsupported'。code→reason: timeout/aborted/
backpressure→busy;其余→unsupported。close_session→notify。异常永不冒泡。

## G. worker_pre_v1.py 关键事实(M7-3 扩展基础)

- 纯标准库;JSONL;MAX_LINE_BYTES=256KiB(超限=fatal 'line-oversize' 后 break);
  stderr 预算 64 条。
- canonical():键排序+无空白+UTF-8,与 JS canonicalJson 逐字节一致;
  pageDigest=sha256(canonical(records));finalDigest=sha256(canonical(
  {kind:'index_sync_final_pre_v1',syncId,miv,workspaceRef,scope,
  recordCount,pageCount,pageDigests}))。
- 拒绝矩阵:no-active-sync/unknown-sync/page-duplicate/page-out-of-order/
  count-mismatch/page-size/record-count-mismatch/record-scope-mismatch/
  page-oversize/digest-mismatch/missing-page/final-digest-mismatch/
  version-mismatch;任一终局失败→active_sync=None 整次作废。
- derived[(workspaceRef,scope)]→entry{miv,recordCount,pageDigests,
  finalDigest,records};persist_derived→<dsh-home>/memory/semantic-pre/
  derived-corpus.json(tempfile+os.replace 原子,fsync)。policyVersion=
  'semantic_derived_pre_v1'。
- context_push:幂等(seen_obs→busy);ack 先行;activation 帧 ack 后同批输出;
  obs 幂等键随 close_session 清。
- 帧 frameId='res_'+sha(rid+':'+type)[:32];activation 帧 payload 嵌套
  {activation:...},fid_prefix='act_'。error 帧 payload={code,reason}。
- epoch 不符='epoch-mismatch' 错误帧;未知 type='unknown-type';
  任何帧异常→'internal-error' 永不死循环。

## H. Python 侧激活雷区(from validator 反推)

1. observationId 只能来自收到的 envelope;同 inbox 重复=硬拒。
2. miv 两时刻(offer+claim)都必须与 host 当前一致。
3. claim 时 cv 精确相等;响应要快,cv 用最新 envelope 的。
4. offer 本身耗一步;ttlSteps=1 下一步立即过期,实用值≥2。
5. 投递成功后 cooldown 2 步,别每步连发。
6. score∈[0,1] 有限;excerpt 480 UTF-8 字节(中文≈160字)。
7. candidates 1..8;跨 memoryId 同 recordDigest JS 去重保最高分。
8. digest 全小写 hex;sourceVersion≥1;sourceRef 正则严格(禁空格/斜杠/第二冒号)。
9. 身份三元组逐字一致;workspaceKey 用 envelope 的 canonicalize 值。
10. workerEpoch 逐帧回显;activationId client 侧 256 环去重(重发静默吞)。
11. payload 必须嵌套 {activation:{...}}。
12. 渲染预算 4096B;checklist 压成'; '单行;provenance 三行永不截断。
13. suppressMemories(correction/revoked)命中任一候选=整单拒。
14. Python 管语义分,JS 管身份/时序/预算;threshold 不能替代用户授权。

## I. M7 阶段门(来自任务集 docs/M7-TASKSET-DISPATCH.md)

M7-2 benchmark(本阶段)→M7-3 dense/sparse/hybrid(bm25s/FTS5/weighted/RRF,
RRF k=60 研究初值需消融冻结)→M7-4 bounded rerank(bge-reranker-v2-m3/
Qwen3-Reranker-0.6B/FlashRank;timeout 保序)→M7-5 graph 条件门(LongMemEval/
LoCoMo/自有多跳集证明不足且 graph 显著改善才做;networkx/PPR;不过=记录
skipped-by-benchmark 视为正确)→M7-6 双阈值激活(suppress/prefetch/activate,
T_on>T_off 滞回,shadow calibration 先行)→M7-7 judgement shadow→M7-8 人工门
(唯一:严禁自行重启 3080)。
Clustering Shadow 是任务集第七节:M7-3 之后 M7-4 之前的独立 shadow 阶段
(ARI/NMI/B-cubed/noise recall/跨语言同簇率/bootstrap stability)。
纪律:每阶段 checkpoint 按 configHash 跳过已完成 run;一时刻一模型;
有限重试;状态文件每阶段备份;不删不识别旧 artifact(标 orphaned);
每阶段回写 5 份文档;全量回归串行。
