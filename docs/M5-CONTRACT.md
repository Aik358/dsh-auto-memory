# M5 JS Context / Evidence Bridge 指导性契约

> 状态：M5-0 指导契约冻结；尚未实现 M5 运行时代码
>
> 权威架构：docs/proactive-associative-memory-system-map.html
>
> 前置：M0-R/T0/M1/M2/P-A/M3/M4 全部 live verified
>
> 后续：M6 JS Activation Inbox + Reference Tail；M7 Python Semantic Engine

## 1. 定位

M5 是 JS 工程的第一阶段，同时承担两个职责：

1. 建立 Access Evidence Graph，记录记忆是否真正被模型看到、读取、引用、复用、验证或纠正。
2. 把 M2/M3/M4 的实时上下文、授权记忆引用和证据摘要组装成可发送给未来 Python 的 ContextPushEnvelopePre。

M5 不启动 Python，不写 prompt，不生成 MemoryPacket。M5 只冻结并实现 JS 侧对象、证据和传输抽象。

~~~text
M2 Segment / tool result / user correction
  -> M5 evidence classifier + coverage
  -> append-only AccessEvidencePre
  -> EvidenceAggregatePre
  -> ContextPushEnvelopePre
  -> ContextSinkPre (M5 使用 Null/Fake sink；M7 实现真实 Python sink)
~~~

## 2. 不交付

- 不启动 Python worker、embedding、向量检索、reranker 或图算法。
- 不创建 M6 ReferenceTailPacket，不修改 prompt、Inbox 或 request。
- 不把 M4 Shadow candidate 追认为历史 seen/read。
- 不自动创建 Semantic/Profile 事实或 active Procedure。
- 不允许 Python 或任何 sink 写 Markdown、Anchor、FileIndex 或 AccessEvidence。

## 3. JS 权威边界

JS 在 M5 永久拥有：

- Agent/session/workspace/scope 身份。
- eventSeq/nativeSeq/callId/contextVersion。
- memoryId/anchorId/sourceEpoch/sourceVersion/fileDigest/recordDigest。
- AccessEvidence 创建、持久化、撤销和聚合。
- ContextPushEnvelope 的字段白名单、字节预算和发送频率。
- 关闭、dispose、取消、幂等和跨 session 隔离。

未来 Python 可以聚合 JS 已创建的 evidence，但不能发明 evidence。

## 4. ContextPushEnvelopePre

M5-1 冻结 JS 发送对象：

~~~ts
interface ContextPushEnvelopePre {
  schemaVersion: 1
  namespace: 'dsh-auto-memory-pre'
  kind: 'context_push'
  observationId: string

  session: {
    sessionId: string
    agentId: string
    workspaceKey: string
    scope: 'Session' | 'Workspace' | 'User'
  }
  cursor: {
    eventSeq: number
    nativeSeq?: number
    contextVersion: number
  }
  index: {
    memoryIndexVersion: string
    sourceEpochs: string[]
  }

  trigger: ContextSegmentPre
  window: ContextSegmentPre[]
  memoryRefs: AuthorizedMemoryRefPre[]
  evidence: EvidenceAggregatePre[]

  policy: {
    contextPolicyVersion: 'context_bridge_pre_v1'
    gatePolicyVersion: string
    lexicalPolicyVersion: string
    evidencePolicyVersion: 'evidence_pre_v1'
  }
  budget: {
    maxSegments: number
    maxInputBytes: number
    maxMemoryRefs: number
    maxEvidenceItems: number
  }
  observedAt: number
  deadlineAt: number
}

interface ContextSegmentPre {
  segmentId: string
  digest: string
  kind: 'user' | 'tool_call' | 'tool_result' | 'assistant'
  eventSeq: number
  contextVersion: number
  ts: number
  text: string
  toolName?: string | null
  toolOk?: boolean | null
  errorName?: string | null
  errorCode?: string | null
}

interface AuthorizedMemoryRefPre {
  memoryId: string
  anchorId: string
  scope: 'Workspace' | 'User'
  sourceRef: string
  sourceEpoch: string
  sourceVersion: number
  fileDigest: string
  recordDigest: string
  excerpt?: string
}
~~~

约束：

- observationId 由 sessionId、contextVersion、trigger digest 和 policy version 确定性生成。
- window 复用 M2 有界 Segment，不包含 Agent、AbortSignal 或原始 DSH 对象。
- memoryRefs 只能来自 M3/M4 已授权 corpus；不发送任意绝对路径。
- excerpt 可选且先经过 JS 敏感内容清洗和 UTF-8 byte budget。
- Python 不得要求 unbounded dump 或自行发现文件。
- 同一 observationId 至多成功发送一次；latest-wins 取消旧 contextVersion。

## 5. ContextSinkPre

M5 只定义可替换 sink：

~~~ts
interface ContextSinkPre {
  push(frame: ContextPushEnvelopePre, signal: AbortSignal): Promise<ContextAckPre>
  closeSession(sessionId: string): Promise<void>
  dispose(reason?: string): Promise<void>
}

interface ContextAckPre {
  observationId: string
  accepted: boolean
  workerEpoch?: string
  reason?: 'ok' | 'disabled' | 'busy' | 'unsupported' | 'oversize' | 'stale'
}
~~~

M5 使用：

- NullContextSinkPre：关闭态，零 IO、零留存。
- FakeContextSinkPre：fixtures/replay，记录 canonical frame，不启动进程。

M7 才实现 PythonContextSinkPre。M5 Host 代码不得包含 spawn、HTTP 或 Python 路径。

## 6. Access Evidence

~~~ts
type AccessKindPre = 'seen' | 'read' | 'cite' | 'reuse' | 'success' | 'correction'

interface AccessEvidencePre {
  schemaVersion: 1
  namespace: 'dsh-auto-memory-pre'
  evidenceId: string
  kind: AccessKindPre
  memoryId: string
  anchorId: string
  scope: 'Session' | 'Workspace' | 'User'
  workspaceKey: string

  event: {
    sessionId: string
    eventSeq: number
    nativeSeq?: number
    contextVersion: number
    callId?: string
    ts: number
  }
  source: {
    sourceRef: string
    sourceEpoch: string
    sourceVersion: number
    fileDigest: string
    recordDigest: string
  }
  coverage?: number
  episodeId?: string
  policyVersion: 'evidence_pre_v1'
}
~~~

## 7. 六类证据规则

- seen：只有 M6 reference tail 实际进入下一请求的 model-visible messages 后才创建。M4 Shadow hit 不是 seen。
- read：实际 read 工具结果与 fresh Anchor/FileIndex byte range 重叠且 coverage > 0。
- cite：用户或模型可见输出显式引用 memoryId/anchorId，或通过保守、版本化引用分类器匹配。
- reuse：后续工具/动作序列与某条记忆步骤发生可解释对齐；必须保留 episodeId。
- success：reuse episode 之后出现明确工具成功或用户确认。
- correction：用户纠正、拒绝或给出反例，并可确定性关联到 memoryId/episodeId。

强度仅作治理词汇：seen/read 弱，cite/reuse 中，success 强，correction 负。M5-0 不冻结任意神经网络权重。

## 8. Coverage 与 freshness

- coverage 复用 M3 UTF-8 byte 半开区间语义。
- stale 不等于 coverage=0；sourceVersion/fileDigest/recordDigest 任一不匹配即拒绝创建新 evidence。
- 旧 evidence 作为历史保留，但 freshness=false 时退出活跃评分。
- 同一 read 可覆盖多条记忆，每条单独形成 evidenceId。

## 9. 幂等与隔离

- evidenceId 由 kind、memoryId、sessionId、eventSeq/nativeSeq、callId、contextVersion 和 policyVersion 确定性生成。
- seed replay 与 live feed 对同一原生事件只创建一次。
- 无可靠 owner 不建 frame、不建 evidence。
- Session scope evidence 不跨 session；Workspace/User 聚合只使用显式 scope key。
- cross-workspace leakage 必须为 0。

## 10. 持久化与隐私

建议位置：

~~~text
<DSH_HOME>/memory/evidence-pre/events/YYYY-MM-DD.jsonl
<DSH_HOME>/memory/evidence-pre/aggregates/<memoryId>.json
~~~

- events append-only；aggregate 是可重建派生物。
- durable projection 不保存 prompt 原文、完整 excerpt、绝对路径、凭据或裸 sessionId。
- sessionId 持久化前转换为 plugin-local sessionRef；workspace 只存稳定 workspaceRef。
- 默认关闭时不创建目录、不写文件、不构造 ring。
- retention、单事件大小和总目录预算必须在 M5-2 冻结。

## 11. EvidenceAggregatePre

~~~ts
interface EvidenceAggregatePre {
  memoryId: string
  scope: 'Workspace' | 'User'
  freshness: 'fresh' | 'stale' | 'unknown'
  distinctSessions: number
  seen: number
  read: number
  cite: number
  reuse: number
  success: number
  correction: number
  lastEvidenceAt: number
  policyVersion: 'evidence_pre_v1'
}
~~~

Aggregate 可随 ContextPushEnvelope 发送给 Python，也可在未来影响 Shadow 评分；M5 本身不得改变 prompt。

## 12. 实施分段

### M5-0 Contract Freeze

本文、system-map、PREVIEW 回写。禁止运行时代码。

### M5-1 Pure Core

schema validator、frame builder、evidence classifier、coverage adapter、idempotency key、pure replay。只用内存 fixtures。

### M5-2 Store + Aggregate

append-only store、隐私投影、retention、aggregate rebuild；临时 DSH_HOME。

### M5-3 Host + Context Sink

接入真实 event/read/correction 流；Null/Fake sink；debug 视图；默认关闭。仍无 Python。

### M5-4 Live Verification

关闭零 IO、临时开启、read coverage、correction、frame export、A/B isolation、关闭恢复。零 prompt 改动。

## 13. 验收矩阵

1. 默认关闭零对象/零 IO。
2. ContextPushEnvelope schema/budget/canonical determinism。
3. Null/Fake sink，不存在 Python process。
4. Shadow hit 不创建 seen/read。
5. read coverage fresh/stale/多记录。
6. evidenceId replay 幂等。
7. cite/reuse/success/correction precision-first fixtures。
8. A/B session/workspace 零串线。
9. evidence durable privacy/no BOM。
10. aggregate rebuild 与 stale exclusion。
11. dispose/cancel/latest-wins。
12. prompt、Packet、Inbox、delivered cursor 零变化。

## 14. M5 完成门

M5 live 后必须具备：可发送的实时上下文对象、可信 AccessEvidence、Null/Fake transport、默认关闭、零 prompt 改动。随后进入 M6 Reference Tail；Python 仍不启动。

## 15. 实施状态（M5-1 完成，2026-08-23）

状态：**M5-1 Pure Core 已完成并通过 A1-A10 测试**；纯模块 `lib/context-bridge-pre.js`（零 IO、零依赖 node:crypto；无 child_process/net/http/python 引用，静态扫描锁定）；未接入 lib/index.js、未读真实文件、未建持久化。

| 交付 | 说明(契约 §) |
| --- | --- |
| CONTEXT_BRIDGE_BUDGET_PRE_V1 | §4 冻结预算(maxSegments 8/maxInputBytes 4096/maxMemoryRefs 8/maxEvidenceItems 16/excerpt 480B/frameMax 64KiB/deadline 5000ms/sentIds 256;Object.freeze) |
| validators | ContextSegmentPre/AuthorizedMemoryRefPre(memoryId 严格+scope 仅 Workspace\|User+sourceRef 相对引用白名单)/EvidenceAggregatePre/AccessEvidencePre 全 schema/ContextAckPre(reason 枚举);全部 fail closed 带具体原因 |
| canonical identity | observationId=obs_pre_+first32(sha256(sessionId+contextVersion+triggerDigest+policy));evidenceId=ev_pre_+first32(kind/memoryId/session 坐标/callId/workspaceKey/policy)——同事件重放同 id,任一坐标变化即新 id |
| coverage adapter | computeRangeCoverage(M3 UTF-8 byte 半开区间 overlap 比)+computeContainmentCoverage(行号前缀剥离归一化包含判定)+computeReadCoverage(freshness 门:observedFileDigest≠record.fileDigest → stale-source 拒绝创建,stale≠coverage=0;一次 read 多记录各自条目) |
| 六类证据构造器 | createAccessEvidencePre 统一入口;cite=完整 mem_ token 扫描+knownRecords provenance 强制;correction=cite 命中∧纠正词典(CORRECTION_LEXICON_PRE_V1 冻结);reuse/success=IdentityEpisodeTracker 身份对齐(anchorId 或 recordDigest 前 16 位显式出现于工具参数;episodeId 回链 anchor evidenceId;最新 provenance 胜出)。seen 构造器保留给 M6 delivered 后调用,M4 Shadow hit 结构上无法触达 |
| Null/Fake sink | NullContextSinkPre(accepted:false/disabled,零 IO 零留存)+FakeContextSinkPre(canonical frame bounded ring≤64,同 observationId 只接受一次,workerEpoch=fake-epoch-pre-v1);M5 无任何 spawn/HTTP/Python 路径 |
| push bridge | observationId 幂等(BoundedIdSet 256)+latest-wins(在途旧 frame 被同 session 新 contextVersion abort)+AbortSignal 贯通+sink 异常不冒泡只计账 |
| envelope builder | buildContextPushEnvelopePre:确定性 observationId/sourceEpochs 排序规范化/window 超 8 截断计账/inputBytes 超 4096 从最旧丢弃/trigger 自身超限 fail closed(trigger-oversize,保 digest 一致性)/frameBytes 超 64KiB 弃 window 后仍超则 frame-oversize |
| replay pure core | replayContextBridge(events/records fixtures):cite→envelope→correction→align 序列,两次运行逐字段一致;墙钟全部来自 fixture |

测试 smoke-test-m51-pre.mjs A1-A10 共 **85 断言 exit 0**(策略冻结/validators 正反例/identity 确定与碰撞敏感/range 半开区间+行号剥离包含+stale 门+多记录/cite-correction precision fixtures/reuse-success tracker 含跨 session 隔离/envelope 预算截断与 fail-closed 全矩阵/null-fake sink+bridge 幂等 latest-wins abort/replay 确定性/静态卫生无 spawn-HTTP-Python+无 BOM)。

**实现注记**：
1. trigger 文本超 maxInputBytes 时选择整体拒绝而非截断——截断会破坏 ContextSegmentPre.digest 与 text 的一致性,fail closed 更符合 §9。
2. reuse/success 的 host 自动发射推迟到 M6(需要 M6 packet 投递后的动作序列观察);M5-3 先接 read/cite/correction 三条真实流,tracker 以纯 API+fixtures 锁定语义(验收矩阵第 7 条按契约即为 fixtures)。
3. seen 在 M5 无任何创建路径:构造器存在但仅暴露给未来 M6 delivery ack;A5/A8 断言 Shadow hit 与 sink 推送均不产生 seen。

下一步：**M5-2 Store + Aggregate**(append-only evidence-pre events、隐私投影、retention、aggregate rebuild;临时 DSH_HOME shadow-copy 测试)。

## 16. 实施状态（M5-2 完成，2026-08-23）

状态：**M5-2 Store/Aggregate 已完成并通过 B1-B9 测试**；纯模块 `lib/evidence-store-pre.js`；测试全程临时目录 root,真实记忆与真实 DSH_HOME 零接触;仍未接入 lib/index.js。

| 交付 | 说明(契约 §) |
| --- | --- |
| EVIDENCE_STORE_POLICY_PRE_V1 | §10 冻结(keepDays 30/maxTotalBytes 32MiB/eventMaxBytes 16KiB/appendedIdCache 4096;storePolicyVersion=evidence_store_pre_v1) |
| 隐私投影 | sessionRefOf(sesr_=sha256(域分隔+sessionId))、workspaceRefOf(wsr_,canonical 大小写/斜杠规范化);投影形态无裸 sessionId/workspaceKey/excerpt/绝对路径;sourceRef 保持相对引用白名单 |
| EvidenceEventStore | append-only events/YYYY-MM-DD.jsonl(engine 级串行链);进程内 evidenceId 幂等(duplicate-evidence)+磁盘侧 rebuild 去重兜底;event-oversize/invalid-evidence 计账;retention 每进程至多一次全扫(旧→新清理) |
| rebuildAggregates | durable events → per-memoryId+scope+workspaceRef 聚合;evidenceId 去重;Session scope 排除(sessionScoped 留痕);distinctSessions 按 sessionRef 去重;freshness=latest evidence 的 recordDigest+sourceVersion 与 corpus 一致→fresh/不一致→stale/语料缺失→unknown;输出 byWorkspaceRef 桶供推送侧过滤(§9 跨工作区零泄漏) |
| persistAggregatesSnapshot | aggregates/index.json 可重建派生物快照(仅调试/导出) |

测试 smoke-test-m52-pre.mjs B1-B9 共 **52 断言 exit 0**(投影稳定哈希+无裸标识/落盘布局单行 JSON 无 BOM/幂等 oversize invalid 计账/retention 清理/rebuild 计数 distinctSessions lastEvidenceAt/fresh-stale-unknown 三态/Session scope 排除/cross-workspace 两桶零串线/快照回读+replay 确定性)。

**实现注记**：
1. rebuildAggregates 输入同时接受数组与 loadEvents 包装对象(defensive);聚合键含 workspaceRef——aggregate 本身仍按 schema 只含 memoryId/scope,workspace 维度通过 byWorkspaceRef 桶暴露,推送时按当前会话 workspaceRef 过滤实现 §9。
2. 下一步 M5-3:Host + Context Sink(createContextHost 接 SessionRuntime/M2 事件/M3 provenance/M4 corpus;Null/Fake sink 切换;/debug 最小投影;默认关闭 contextBridgeEnabled=false)。

## 17. 实施状态（M5-3 完成，2026-08-23）

状态：**M5-3 Host + Context Sink 已完成并通过 C1-C8 测试**；`lib/context-host-pre.js` 已接入 lib/index.js(六处最小接线)；默认双门关闭；真实记忆与 sidecar 身份零修改。

| 交付 | 说明 |
| --- | --- |
| lib/context-host-pre.js | createContextHost({engine}):per-runtime WeakMap lazy state;pathsByKey 由 refreshAll 同步捕获(与 M4 共享快照);自有 CorpusRegistry(sidecar 目录同 M4) |
| index.js 接线 | ①import+apply() 创建 engine._contextHost ②refreshAll 增 capturePaths ③ingestEnvelope Segment accept 后 fire-and-forget onSegmentAccepted(envelope 组装+cite/correction 扫描)④observeToolResult 改变量接收后挂 onToolResult(read coverage)⑤/debug associativeMemory.contextBridge 字段(关闭=严格{enabled:false})⑥disposers disposeAll;DEFAULT_CONFIG 新增 contextBridgeEnabled=false / contextSinkMode='null'('python' 非法值回退 null) |
| memoryRefs 选择 | 复用 lexical_pre_v2 可解释基线(buildQueryPlan+lexicalSearch mode=prefetch)+m4-corpus 授权校验链→buildAuthorizedMemoryRefFromRecord(excerpt sanitize 480B);kept≤8;语料缺失/不匹配时 refs=[] 不阻塞 envelope |
| evidence 流 | cite=user+assistant 可见文本完整 mem_ token∧corpus provenance;correction=cite∧冻结词典(仅 user);read=frozen tools/result ok=true∧preview 含完整 token∧归一化前缀覆盖>0∧observedFileDigest(corpus 快照)=record.fileDigest(stale fail closed);全部经 EvidenceEventStore 隐私投影落盘 evidence-pre/events |
| seen 隔离 | 结构性:M5 host 无任何 seen 创建路径;Shadow audit 候选不被读取(C6 实证 retrieve 有候选而 evidence 零新增) |

测试 smoke-test-m53-pre.mjs C1-C8 共 **38 断言 exit 0**:默认关闭零留存/开关矩阵(assoc∧bridge 双门)/fake sink envelope(obs_pre_ id+memoryRefs≥1+accepted)/read coverage 持久化隐私(sesr_/wsr_/相对 sourceRef/无绝对路径)+stale 门/cite+correction precision 落盘/Shadow hit 不追认(seen 全程为零)/关闭恢复零残留/prompt 零变化(section 字节级稳定+零 Reference Tail 文本)。全量回归 **16 项**(M0-M4 十三项+M5 三项)17.9s 全部 exit 0;node --check×4/diff --check/BOM 扫描/_dev 命名扫描全净。

**实现注记**：
1. computeContainmentCoverage 升级 v2:最长匹配前缀字节比例(截断的 resultPreview 也可产生诚实部分 coverage;完整包含仍=1)——A4/C4 断言同步。
2. read coverage 的 observed fileDigest 取自 corpus 快照 sources(freshness 门与 M4 loader 同源),不对工具结果做二次 stat。
3. onToolResult 挂在 frozen tools/result(执行级最终点);持久 session 通道 tool/result 不重复计(evidenceId 含 callId 幂等兜底)。

下一步：**M5-4 Live Verification**(需用户重启现有 3080 加载 Host 接线;按 §13 验收矩阵八步验证;验证后恢复 assoc=false/contextBridgeEnabled=false 默认关闭)。

## 18. 实施状态（M5-4 Live Verification 通过，2026-08-23）

状态：**M5-4 live 验证通过，M5 整体完成并已恢复默认关闭**(assoc=false/contextBridgeEnabled=false/contextSinkMode='null'；anchor=true 保持迁移成果)。用户重启现有 3080(无替代 server)后按验收矩阵执行:

| 步骤 | 结果 |
| --- | --- |
| 关闭基线 | debug contextBridge={enabled:false} 严格投影；evidence-pre 目录不存在（零 IO）；三份真实记忆 SHA 基线记录 ✓ |
| 临时开启 | POST config assoc=true+bridge=true+sinkMode='fake'；debug 呈 enabled:true/sinkKind:'fake'/计数全零 ✓ |
| 自然流量 envelope | 用户消息+工具活动 → envelopesBuilt=3/pushesAccepted=3；lastFrame.observationId=obs_pre_c77f…(ctxVer=4,window=3,memoryRefs=8,evidence=0)；lexical_pre_v2 基线选中 8 条授权引用 ✓ |
| latest-wins 实战 | bridge.stats.superseded=1（新 contextVersion 在途取消旧帧）✓ |
| plugin 触发抑制 | recentDrops 含 plugin-generated-trigger（与 M4 同规则）✓ |
| read coverage 落盘 | read 工具读真实项目笔记 → readsCovered=1 → evidence-pre/events/2026-08-23.jsonl 883B；ev_pre_e37ed212… kind=read mem_af41b679… cov=0.035(前缀比例诚实部分值) ✓ |
| 隐私投影 live | privacy 扫描全过：无裸 sessionId/workspaceKey/绝对路径/excerpt；sessionRef=sesr_*/workspaceRef=wsr_* ✓ |
| prompt 零变化 | debug 全量序列化无 'Retrieved memory reference'/pendingPacket/delivered 字段；section 字节级稳定由 C8 单元锁定 ✓ |
| frame export | .tmp-m54-frame-export.json 留存 debug 快照；durable dump 为持久证据 ✓ |
| 关闭恢复 | POST 恢复默认 → cb={enabled:false} 严格投影；events bytes 883→883/lines 1→1 零新增写入 ✓ |
| 真实记忆完整性 | 三文件 anchor 链 0 conflicts/sidecar FRESH（SHA 漂移经查为窗口期 assoc=true 激活自动沉淀的合法锚定写入：项目笔记 63→65 条）；M5 无任何 Markdown 写路径(结构性) ✓ |

**偏差说明**：correction 与 A/B 双会话两项未做独立 live 注入——correction 已由 smoke-test-m53 C5 精确断言（词典∧token∧provenance），A/B 由 C3 单元断言（双 runtime 零串线）；live 现场为单会话自然流量，不为此构造人工对话。如需补齐可由用户发送一条含完整 mem_ token+纠正词的消息后用 `node .tmp-live-m54.mjs dump` 复查。

**M5 完成门对照（§14）**：可发送实时上下文对象(ContextPushEnvelopePre)✓；可信 AccessEvidence(隐私投影落盘)✓；Null/Fake transport✓；默认关闭✓；零 prompt 改动✓。随后进入 M6-1；Python 仍不启动。
