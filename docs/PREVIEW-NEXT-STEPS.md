# dsh-auto-memory 预览版 · 模块化实施交接（2026-08-23）

> 工作区：D:\dsh-auto-memory（preview 分支）
>
> **全局蓝图/收尾路线（2026-08-25 固化，压缩后先读）**：docs/PROJECT-FREEZE-AND-ROADMAP.md
>
> **目标架构与实施进度唯一权威**：docs/proactive-associative-memory-system-map.html
>
> 本文只作为下一编程模型的执行入口。若本文、研究报告、其他 HTML 或旧记忆与系统地图冲突，以系统地图的架构不变量、progressLedger 和模块验收门为准；当前实现事实仍以代码、DSH 类型和测试结果为准。

## 0. 当前现场（2026-08-23）

- 当前 HEAD：aa7d6f0；preview 工作树包含 M0-R/T0/M1/M2/P-A/M3a/M3b/M4、M5/M6 全部 live、lexical_pre_v2、M7 研究报告/完整契约/Agent handoff、**M7-0/M7-1 实现与测试**与既有并行改动，尚未 commit。
- Web profile 两级链接均指向 D:\dsh-auto-memory，现有 http://127.0.0.1:3080 已加载 preview；C 盘稳定副本保留，回滚说明见 .tmp-pa-rollback.txt。
- M0-R/T0/M1/M2/P-A/M3a/M3b/M4/M5/M6 全部 live verified；JS 阶段收官。**M7-0 Protocol+Fake Worker 与 M7-1 Authorized index_sync 已实现并 tested(2026-08-24)**：默认 pythonBackendEnabled=false 时零 Python process、零协议 IO、零 semantic-pre 目录；fake activation 逐字段过现有 M6 validator；smoke-test-m70/m71 各 90 断言 exit 0，全量 22 项回归全绿；未标 live(live 属 M7-8 且需用户控制)。证据:docs/PYTHON-SIDECAR-CONTRACT.md §19。下一权威范围=M7-2 embedding benchmark(未开始)。
- M3b-4 已迁移 31/31 个真实记忆文件、176 条 anchored 记录并落盘 31 份 sidecar；memoryAnchorEnabled=true 在线；可回滚备份为 mig_20260822141900_0695b3。M3b 历史契约与收尾证据见 docs/M3B-CONTRACT.md。
- M4 全部四阶段完成并 live 验证通过：纯核心(shadow-retrieval-pre.js)+Corpus Adapter(m4-corpus-pre.js)+Host 接线(shadow-host-pre.js 已接入 lib/index.js)+Live Verification（live retrieve completed、audit 隐私投影验证、plugin 判定与 dshHome 两处 live 缺修复）；契约证据 docs/M4-CONTRACT.md §23-§27。M4-4 现场证据见 §26。
- **M5-1 Pure Core 完成(2026-08-23)**：lib/context-bridge-pre.js(envelope/identity/coverage/六类证据构造器/Null-Fake sink/push bridge/replay)；smoke-test-m51-pre.mjs 85 断言 exit 0；无 Python 路径。契约证据 docs/M5-CONTRACT.md §15。
- **M5-2 Store/Aggregate 完成(2026-08-23)**：lib/evidence-store-pre.js(sessionRef/workspaceRef 哈希隐私投影、append-only events+retention、rebuildAggregates fresh/stale/unknown+workspace 桶)；smoke-test-m52-pre.mjs 52 断言 exit 0。契约证据 docs/M5-CONTRACT.md §16。
- **M5-3 Host 接线完成(2026-08-23)**：lib/context-host-pre.js 已接入 lib/index.js(config 新增 contextBridgeEnabled=false/contextSinkMode='null'，双门默认关闭零 IO)；cite/correction/read-coverage 三条 evidence 流+envelope 推送(Null/Fake sink)；smoke-test-m53-pre.mjs C1-C8 38 断言 exit 0，全量 16 项回归 17.9s 全绿，四项卫生扫描全净。契约证据 docs/M5-CONTRACT.md §17。
- **M5-4 Live Verification 通过、M5 整体完成(2026-08-23)**：重启后 live 实测——envelope 组装推送(obs_pre_*/memoryRefs=8/latest-wins superseded=1)、read coverage 落盘(ev_pre_* cov=0.035)、隐私投影扫描全过(sesr_/wsr_/无裸标识/无绝对路径)、prompt 零变化(无 tail/pendingPacket/delivered 字段)、关闭恢复零新增写入(883B→883B)；真实记忆 anchor 链 0 conflicts/sidecar FRESH(SHA 漂移=窗口期自动沉淀合法写入,项目笔记 63→65 条)。开关已恢复 assoc=false/bridge=false/sink='null'/anchor=true。偏差:correction 与 A/B 由单元测试 C5/C3 覆盖,未做 live 人工注入。契约证据 docs/M5-CONTRACT.md §18。
- **M6-1 Pure Core 完成(2026-08-23)**：lib/activation-inbox-pre.js——ActivationRequest/Candidate validator(JS 硬校验矩阵,不重算语义分)、recordDigest 去重、固定边界 Reference Tail 渲染器+guard v1、pkt_pre_ packetId/exactDigest identity、TTL、fake activation fixtures；smoke-test-m61-pre.mjs D1-D9 53 断言 exit 0；全量 17 项回归 18.4s 全绿；四项卫生扫描全净。契约证据 docs/M6-CONTRACT.md §16。
- **M6-2 Per-runtime Inbox 完成(2026-08-23)**：lib/activation-inbox-state-pre.js——createActivationInboxPre 状态机(offer 门序:身份→重复→抑制→cursor/index stale;latest-wins 替换+同 activationId 重放硬拒)、claim 四重门(cooldown=2 步/TTL/cursor/index)、markDelivered 为 seen 唯一接线点、严格身份键 registry(无 default 桶)；smoke-test-m62-pre.mjs E1-E9 36 断言 exit 0；全量 18 项回归 18.5s 全绿；四项卫生扫描全净。契约证据 docs/M6-CONTRACT.md §17。
- **M6-3 Surface Adapter 完成(2026-08-23)**：lib/activation-host-pre.js 接入 index.js 八处——capability 快照(dynamic-context 按宿主形状)、pre-step claim、专用 'dsh:m6-reference-tail-pre' context 面板渲染即投递(exactDigest 校验)、delivery ack 后 seen 落盘、activation-inbox-pre 注入路由；smoke-test-m63-pre.mjs F1-F9 23 断言 exit 0(seen n=2)；基线同步路由 26/组件 3；全量 19 项回归 20.7s 全绿。契约证据 docs/M6-CONTRACT.md §18。
- **compactLayer×anchor 兼容修复(F1)完成(2026-08-23)**：index.js 新增 compactAnchoredLayer 记录级压缩(今天记录无条件保留+字节配额从尾回溯+整条原文入归档 writeFullRaw+store.replace 原子重组,永不字符切片;无 sidecar 回退旧路径)；根因与证据见 docs/M3B-CONTRACT.md §20；smoke-test-f1-pre.mjs G1-G4 20 断言 exit 0；全量 20 项回归 23.3s 全绿。当前权威范围原为 M6-4，现已完成，见下条。
- **M6-4 Live Verification 通过、M6 整体完成(2026-08-23)**：重启后 fake 注入即泵(pkt_pre_a602f2aa…)→**下一步 compose 尾注字面渲染进本 agent 的 model-visible messages**(两条引用块 mem_af41…/mem_6667…+Verify 收尾直接可见)→delivered=1/**seen 落盘 n=2**(ev_pre_168c…/ev_pre_522b…)→隐私扫描全过(sesr_/wsr_/无裸标识/无绝对路径)→关闭恢复零新增写入(2491B→2491B)；真实记忆 anchor 链 conflicts=0/FRESH(SHA 漂移=窗口期自动沉淀合法写入)。开关恢复 assoc=false/inbox=false/anchor=true。时序偏差:fake 来源=注入即泵(确定性演示),真实 Python 推送走 pre-step 自然 claim(代码保留)。契约证据 docs/M6-CONTRACT.md §19。**JS 阶段(M0-M6)全部完成**；M7 完整契约/研究报告/Agent handoff 已冻结。
- **M7-0/M7-1 完成(2026-08-24, tested 未 live)**：五新模块——lib/m7-wire-pre.js(m7_wire_pre_v1 协议/canonical JSON 跨语言一致/envelope validator)、python/worker_pre_v1.py(纯标准库确定性 fake worker:stdout 只协议·stderr 有界诊断·不读任何 DSH 文件·唯一写路径 semantic-pre 原子替换·fake activation 从 memoryRefs 复制 provenance)、lib/python-sidecar-client-pre.js(no-shell lazy spawn/workerEpoch/partial·multi-line framing/256KiB 上限/timeout·AbortSignal·crash recovery·circuit breaker/结构化失败永不抛出/四身份不混用)、lib/context-sink-python-pre.js(M5 envelope 原样透传+deadline ack+失败映射 reason 枚举)、lib/index-sync-pre.js(scope 分组 begin/pages/commit·≤64 条·≤256KiB·page/final digest)。接线：engine._pythonSidecar 共享客户端+debug pythonBackend 投影+三重门解锁(contextSinkMode='python'、activationSource='python',后者经 offerExternalActivation 自然 claim 不做 pump)+disposer；DEFAULT_CONFIG 新增 pythonBackendWorkerPath=''/pythonBackendExecutable=''。顺手修复两处凌晨窗口 flake：①index.js maintain() 归档 cutoff 取日期零点(原含时分秒,00:00-日界窗口把当天日志误归档,m3b3 E8 实证)；②smoke-test.mjs smkToday 对齐引擎 450min 日界。测试：m70 G1-G9=90 断言、m71 H1-H9=90 断言均 exit 0；全量 22 项回归全绿；node --check×11/py_compile/diff-check/BOM/_dev 扫描全净。证据:docs/PYTHON-SIDECAR-CONTRACT.md §19。
- **M7-2 Embedding Benchmark 完成(2026-08-24, tested 未 live)**：3 模型×5 chunk 策略×双层语料(L1 合成 152 记录/88 查询 + L2 真实 251 episodes/40 手写查询,外部存储只读脱敏)。**冻结:BAAI/bge-m3 @5617a9f61b02(MIT/1024d/CLS) + m7_chunk_pre_v1=para-512-noov + NumPy float32 L2 exact cosine**;qwen3-0.6B 备选(hard-neg 判别优但 p95≈500ms/RSS 峰值 4.7GB);multilingual-e5-large 淘汰(zh→en xlang@5=0.60+512 硬上限)。关键证据:L1 R@5=0.966/MRR 0.889/跨语 1.0/p95 189ms,L2 R@5=0.925/MRR 0.793/hard-neg 0.074/p95 241ms;supersede 裸 cosine 4/8 失败(三模型同病)→交 M7-3 融合(supersede/时效特征);scope 门 6 镜像泄漏=0。产物:docs/M7-EMBEDDING-BENCHMARK.md+docs/M7-ALGORITHM-DECISION.md+artifacts/m7-benchmark-pre/results.{json,csv}+artifacts/m7-corpus-pre/(episodes/queries/privacy)+tests/m7-2-fixtures/embedding-fixture.json+smoke-test-m72-pre.mjs(K1-K7 21 断言零联网);模型缓存在 python/bench/(独立 venv 3.10.11+torch cpu+transformers 5.15.1,未跟踪目录,manifest 逐文件 sha256,hf-mirror 通道核验)。顺手修复 m70 G7 harness effect 空桩(heartbeatTimer clearInterval 丢失致进程不退出;90 断言本全过,零生产代码改动)。全量回归 **23 项**全绿。**未接生产 activation、未标 live**。下一权威范围=M7-3(worker_semantic_pre_v1.py+lexical/bm25s/weighted/RRF 对照,见 ALGORITHM-DECISION D4)。
- **M7-3..M7-7 完成(2026-08-24, tested 未 live)**:①M7-3 生产 dense——python/m7_embedding_pre_v1.py(冻结 policy,可插拔 provider:hash-pre 确定性/bge-m3 真模型)+python/worker_semantic_pre_v1.py(继承 worker_pre_v1 零协议回退;commit 建 versioned vectors+identity stale/重建;影子候选本地日志;DSH_M7_EMBEDDING_CONFIG env 选 provider,零 CLI/JS 改动)+smoke-test-m73 55 断言;hybrid 对照→**D6 冻结 hybrid_fusion_pre_v1=weighted dense0.7+lexical0.3**(L2 R@5 0.950/MRR 0.866 胜 dense-only;bm25s 交叉验证一致零新依赖)。②Clustering Shadow:agglomerative thr=0.3(NMI 0.916/稳定性 0.995)参考实现;HDBSCAN 不适用;零 M6 接线(D8)。③M7-4 rerank:双 reranker 质量显著(L1 R@5→1.0)但 CPU p50 26-33s/50 对超预算 50-90 倍→**D9 deferred-optional 不接生产**(bge-reranker-v2-m3/qwen3-reranker-0.6B 双 pinned)。④M7-5 graph 门:6/8 多跳双端点 hybrid 已覆盖→**skipped-by-benchmark**(D10)。⑤M7-6 双阈值激活:suppress/prefetch/emit+滞回+cooldown+特征分组,shadow 校准默认(tOn 0.62/tOff 0.52);active 帧逐字段过 M6 validateActivationRequestPre(m76 33 断言,D11)。⑥M7-7 judgement shadow:8 类候选+keep/merge/supersede 建议,只写 judgement-shadow.jsonl,零权威写入(m77 15 断言)。⑦model-sparse 补测:dense+ms 融合 L2 R@5=0.975 全研究最高,MRR 略低→D6 修正案记录不改默认。**全量回归 26 项全绿(M0-M6 20+m70/71/72/73/76/77);全部默认关闭/shadow;Agent 已停在 M7-8 人工门——用户操作十步=docs/PYTHON-SIDECAR-CONTRACT.md §19.8 末节。**
- **M7-7.5 Hardening 完成(2026-08-24 下午,审阅意见全部闭环)**:P0 真 BGE 建库(build_doc_ids/encode_texts 补齐+单一模板)、D6 hybrid 进生产 worker(三分量影子)、workspaceRef+scope+miv 三重过滤(同 miv 跨 ws 泄漏用例)、correction 负向+硬抑制、toolFailures 权重、query 双 special 修复、gitignore 隔离模型缓存与原始语料 jsonl;真模型 real-smoke 12 断言(双向跨语言 top1);f1 硬编码日期 flake 顺手修复;回归 26/26 全绿。详见 contract §19.9。 M7-8 Phase E Host Orchestration Fix 完成(2026-08-24):新增 lib/m7-index-sync-host-pre.js 编排器+context-host index-ready 门时序修正+live-parity 诊断;根因修正=生产 Host 从未接线 index_sync(非 observer 缺失);smoke-test-m78-host-pre.mjs 33 断言+全量 27 项回归全绿。详见 contract §19.10。
- M3 收官时全量 10 项测试 8.5s 全绿；M4 四阶段完成后全量 13 项测试 7-10s 全绿；真实 Markdown 已完成 M3b-4 迁移（31/31 文件、176 anchored 记录、31 sidecar、备份 mig_20260822141900_0695b3 可回滚）。
- **当前线上开关**：associativeMemoryEnabled=false / shadowRetrievalEnabled=false / memoryAnchorEnabled=true（M4-4 验证后恢复默认关闭；anchor=true 保持迁移成果）。注意 assoc=false 期间自动沉淀实际不生效。
- 检索质量升级：lexical_pre_v1→v2（BM25 idf/tf 饱和/长度归一 + 哈工大停用词表 507 词）；架构定位重申——JS 词法核心是 Python sidecar(M7) 主检索的安全回退层。
- 工作树存在既有未跟踪文件；下一模型必须先运行 git status，不能删除、修改、add 或提交无关文件。

## 1. 下一编程模型的唯一实施范围

M5/M6 已完成 live 验证；M7 完整研究报告、契约和 Agent handoff 已冻结，当前只交接 M7，不启动 Python。

M7 当前范围（完整边界见 docs/PYTHON-SIDECAR-CONTRACT.md）：

- 阅读 docs/M7-PYTHON-IMPLEMENTATION-REPORT.md、docs/PYTHON-SIDECAR-CONTRACT.md、docs/M7-AGENT-HANDOFF-PROMPT.md；先实现 protocol/index_sync，再按 benchmark 选择 embedding/dense/hybrid。
- M7-0 先实现 JSONL protocol/health/workerEpoch/deterministic fake worker，无真实模型。
- M7-1 必须实现 JS 授权分页 index_sync；context_push.memoryRefs top-8 不能冒充全库召回。
- 再按 benchmark 实现 embedding、NumPy exact dense、sparse/RRF，可选 bounded rerank；graph 默认关闭。
- Python 不读 DSH 文件、不创建 evidence、不写 prompt/Packet；所有 activation 走现有 M6 validator 与自然 pre-step claim。
- 默认关闭、Python 尚未启动；外部 Agent 执行入口为 docs/M7-AGENT-HANDOFF-PROMPT.md。

### 预览命名空间隔离硬约束

预览版必须能与已安装稳定版同时存在。所有会对外注册或写入持久状态的 preview 标识统一使用 `_pre` 或 `-pre`，绝不能使用 `_dev`，也不能复用会与稳定版碰撞的无后缀标识。覆盖范围至少包括：

- Agent 可见工具名：`memory_*_pre`、`calendar_*_pre`。
- Cordis/plugin id、systemPrompt section/context 注册名。
- API namespace、配置文件、cache、heartbeat、diagnose log。
- client localStorage key、UI/plugin slot 或其他跨实例持久化键。
- smoke test mock、断言、发布转换输入。

内部局部函数、类方法和纯内存变量不需要机械添加后缀；隔离对象是可能与稳定版共享 Host 注册表或持久存储的命名空间。验收必须扫描 `_dev`、`auto-memory-dev` 和误用的稳定版裸标识。

## 2. M0-R · 实验基线回归修复

恢复以下 DEFAULT_CONFIG，保持默认关闭：

~~~js
associativeMemoryEnabled: false
shadowRetrievalEnabled: false
softInjectionEnabled: false
pythonBackendEnabled: false
reasoningObserverEnabled: false
procedurePromotionEnabled: false
streamingInterruptionEnabled: false
maxPacketItems: 2
maxPacketChars: 800
packetTtlSteps: 2
injectionCooldownSteps: 3
~~~

验收门：

- 旧配置文件缺少字段时正常使用默认值。
- 所有实验开关关闭时，现有 prompt、14 个 _pre 工具、24 条路由、Markdown、自动沉淀和 GUI 数据接口行为不变。
- 不为这些开关新增 UI；当前任务只恢复 Host 基线契约。

## 3. T0 · 测试进程可结算

目标：让 smoke mock host 正确执行 effect/disposer，清理 interval、runtime 和异步任务；测试通过后自然 exit 0。

验收门：

- node --check lib/index.js exit 0。
- smoke-test.mjs、smoke-test-reflect.mjs、smoke-test-external.mjs、smoke-test-isolation.mjs、smoke-test-consolidate-isolation.mjs 均输出通过且自然 exit 0。
- 不用 process.exit(0) 掩盖泄漏，不因测试方便删除生产 timer。

## 4. M2 · ContextObserver 模块拆分

### M2.1 Event adapters

接入真实入口：

- session/event：user/message、tool/call、tool/result、assistant/message、turn/step 边界。
- frozen tools/result：执行级最终结果、失败和 nested tool call。
- agent/session-start、agent/pre-step、agent/turn-stopping、agent/disposed、session/disposed。

只抽取有界、可序列化的最小 payload。禁止保存 Agent、AbortSignal 或整个 DSH 对象。

### M2.2 EventEnvelope 与双游标

EventEnvelope 至少包含：

~~~text
schemaVersion / sessionId / agentId / eventSeq
channel / eventType / timestamp / nativeSeq?
turn? / step? / sourceKind
messageId? / callId? / rootCallId?
payloadDigest / bounded normalized payload
~~~

语义：

- eventSeq：每个 accepted envelope 在该 runtime 内递增。
- contextVersion：只有 observer 接受有效 Segment、实际改变检索上下文时递增。
- 二者不得机械同步。
- tools/result 与持久 tool/result 用 callId/rootCallId 关联，但保留 channel/eventType 差异。
- 没有可靠 agent/sessionId 的事件不得落入 default runtime。

### M2.3 Semantic Segmenter + bounded ring

按语义边界切片：

- 一条用户消息一个 Segment。
- 一次工具调用参数摘要一个 Segment。
- 一次最终工具结果摘要一个 Segment。
- 一条最终可见 assistant 输出一个 Segment。
- 必要生命周期边界可以形成无文本事件，但不应无意义推进 contextVersion。

不得粗暴取最后 N token；assistant/chunk 和 reasoning 默认不形成持久 Segment。ring 必须有明确、有测试的容量和字符上限，但本轮不增加设置页 UI。

### M2.4 Replay / audit / lifecycle

- session-start 对 session.events seed 按原生 seq 补放。
- live session/event 从已消费 native seq 继续，不能双计。
- 相同事件流回放得到相同 Segment id、顺序和 digest。
- envelope/segment debug 数据按 runtime 隔离；dispose 后清空并 abort 挂起任务。
- 检索中间态不写主 Session。

### M2.5 Tests

至少新增：

- 相同事件流确定性回放。
- seed replay + live feed 去重续接。
- eventSeq/contextVersion 分工。
- A/B 并发 session 的 envelope、segment、cursor 零串线。
- root/nested tool call 关联。
- 无 owner 事件不进入 default runtime。
- dispose 后 ring、pending 和任务清理。
- associativeMemoryEnabled=false 时零行为差异。

## 5. M1 不可破坏项

- context.text 必须在 engine.withAgent(agent, ...) 内执行。
- turn-stopping 不得通过 _lastAgent 猜当前会话；GUI 路由 fallback 不得扩散到 Agent 路径。
- this.state 和 autoStats 保持 getter；不得重新加入 this.state = {...}。
- 自动沉淀锁、队列、cooldown、lastTurn 和 abortController 保持 per-runtime；每日额度仍全局。
- 所有 Agent 可见工具继续使用 _pre；所有写入 UTF-8 无 BOM。

## 6. M7 Python Semantic Engine 外部 Agent 交接

前置里程碑 M0-R / T0 / M1 / M2 / P-A / M3a / M3b / M4 / M5 / M6 已全部 live verified。M7 完整契约与实施研究报告位于 docs/PYTHON-SIDECAR-CONTRACT.md 与 docs/M7-PYTHON-IMPLEMENTATION-REPORT.md。

外部 Python Agent 的第一件事是阅读 docs/M7-AGENT-HANDOFF-PROMPT.md，并先实现 M7-0 protocol/fake worker 与 M7-1 index_sync；不得先做 graph/ANN。

1. M7-0：JSONL framing、health、workerEpoch、fake worker、坏帧/超时/过期/drop tests。
2. M7-1：JS 授权分页 index_sync，page/final digest 和 Python atomic derived index。
3. M7-2/3：按 benchmark 选择 embedding，先 NumPy exact dense，再与 lexical_pre_v2、sparse、RRF 做消融。
4. M7-4/5：有界 rerank；graph 只有 benchmark 证明多跳收益才启用。
5. M7-6/8：主动 ActivationRequest、M6 natural pre-step claim 与 live verification。

开始前必须阅读：

- docs/proactive-associative-memory-system-map.html
- docs/M7-PYTHON-IMPLEMENTATION-REPORT.md
- docs/PYTHON-SIDECAR-CONTRACT.md
- docs/M7-AGENT-HANDOFF-PROMPT.md
- M5/M6 live JS modules 与 smoke tests

M7 实施期间：不读 DSH 文件、不创建 AccessEvidence、不写 prompt/Packet；默认开关保持 false；Python 不可用必须回退 lexical_pre_v2。

## 7. 完成后的进度回写

每个模块只有在证据成立后才能变更状态：

- implemented：代码已经落地。
- tested：自动测试自然 exit 0。
- live verified：现有 DSH Web GUI 实际加载并人工验证。
- blocked：写明具体依赖或失败条件。

每个 M7 阶段完成后必须更新：

1. system-map progressLedger.currentScope、M7 evidence/gate 和 nextBrief。
2. docs/PYTHON-SIDECAR-CONTRACT.md 与 docs/M7-PYTHON-IMPLEMENTATION-REPORT.md 的实施证据。
3. 本文件的当前现场与测试结果。

## 9. 已完成里程碑的快速索引（交接速查）

| 里程碑 | 状态 | 关键产物 | 契约/证据 |
| --- | --- | --- | --- |
| M0-R 实验基线 | live verified | DEFAULT_CONFIG 七开关+四预算 | §2 |
| T0 测试可结算 | live verified | effect/disposer 纪律+fetch stub | §3 |
| M1 会话隔离 | live verified | SessionRuntimeStore/WeakMap/per-runtime 锁 | §5 |
| M2 ContextObserver | live verified | EventEnvelope/Segment/ring/latest-wins | §4 |
| P-A D 盘预览 | live verified | 双 junction + package.json link | .tmp-pa-rollback.txt |
| M3a FileIndex | live verified | memory-index-pre.js/memoryIndexSnapshot | §19(M3B) |
| M3b-1..4 Anchor 迁移 | live verified | memory-anchor-pre.js/memory-writer-pre.js/31 文件迁移+备份 | §23-§26(M3B) |
| M4-1 纯核心 | tested→live 链路已证 | shadow-retrieval-pre.js(gate/tokenizer/lexical/replay) | §23(M4) |
| M4-2 Corpus Adapter | tested→live 链路已证 | m4-corpus-pre.js(catalog/guard/loader/registry) | §24(M4) |
| M4-3 Host Wiring | tested→live 链路已证 | shadow-host-pre.js+durable audit+debug 视图 | §25(M4) |
| M4-4 Live Verification | **通过(2026-08-23)** | live retrieve completed+audit 卫生+零注入证明 | §26(M4) |

全量回归基线：13 项 smoke test 全绿（约 7-10s）；node --check 五个 lib 文件；git diff --check 干净；全部 UTF-8 无 BOM。

不得只在聊天或记忆中声称完成。未经用户明确要求，不 commit、不 push、不发布、不创建 tag。

## 8. Python 后端长期恢复入口

Python sidecar 的完整职责边界、JSONL 请求/响应、requestId/workerEpoch/contextVersion/memoryIndexVersion 校验、超时/崩溃回退、安全边界和 M7 开工顺序见 `docs/PYTHON-SIDECAR-CONTRACT.md`。

当前不得启动 Python worker。M7 必须等待 M5 evidence tested 与 M6 Packet/Broker 契约完成；JS Host 始终是版本、scope、风险、冷却、Packet 与注入的最终裁决者。当前 lexical_pre_v2 是 Python 主检索的安全回退层。
