# M7 Python Semantic Engine 实施研究报告

> 日期：2026-08-23
>
> 项目：dsh-auto-memory
>
> 基线：M0-M6 全部 live verified；**M7-0/M7-1 已实现并 tested(2026-08-24,默认关闭零进程零 IO;未 live)**；M7-2 起待实施
>
> 用途：交给负责 Python 后端的外部 Agent
>
> 权威架构：docs/proactive-associative-memory-system-map.html
>
> 详细契约：docs/PYTHON-SIDECAR-CONTRACT.md

## 1. 执行结论

M7 是 Python Semantic Engine 阶段。Python 负责 embedding、精确 dense retrieval、hybrid fusion、可选 rerank、可选 graph expansion、每会话语义状态和主动 activation threshold。JS Host 继续负责身份、scope、MemoryId、Anchor/FileIndex、provenance、AccessEvidence、预算、TTL、风险和 Reference Tail 的最终投递。

目标链路：

~~~text
JS M5 ContextPushEnvelopePre + EvidenceAggregatePre
  -> JS 授权分页 index_sync
  -> Python embedding / dense / hybrid / rerank / graph
  -> Python semantic threshold + hysteresis
  -> ActivationRequestPre
  -> JS M6 validator + Activation Inbox
  -> ReferenceTailPacketPre
  -> 下一请求 Reference Tail
  -> delivered ack -> JS M5 seen evidence
~~~

关键接口结论：live ContextPushEnvelopePre 的 memoryRefs 最多 8 条，来自 lexical_pre_v2 预取。它适合即时上下文和 rerank，但不足以支撑 Python 全库主召回。因此 M7 必须增加 JS 授权、分页、版本化的 index_sync；Python 永远不能自行打开 Markdown、sidecar 或 session 文件。

## 2. M5/M6 live 基线

- ContextPushEnvelopePre：8 segments、4096 input bytes、8 refs、16 evidence items、480-byte excerpt、64 KiB frame、5 秒 deadline；observationId 是确定性 obs_pre_ identity。
- Evidence：JS 创建 seen/read/cite/reuse/success/correction，持久化使用 sesr_/wsr_ 隐私投影；Python 只读 aggregate。
- ActivationRequestPre：M6 硬校验 workerEpoch、session identity、scope、contextVersion、idx_pre_ memoryIndexVersion、candidate provenance、level、TTL 和预算。
- M6-4 活体验证证明 Reference Tail 进入 model-visible messages，delivery ack 后 seen 落盘；fake inject-and-pump 仅为演示，真实 Python 走自然 pre-step claim。

## 3. index_sync

Python 需要完整授权语料，不只是 context_push.memoryRefs top-8。JS 通过 index_sync begin/page/commit 分页发送带 memoryId、anchorId、scope、workspaceRef、sourceRef、sourceEpoch、sourceVersion、fileDigest、recordDigest、授权 text、chunk 元数据的 records。所有 page/final digest 和 memoryIndexVersion 通过后，Python 原子切换 derived index；Python 不发现文件。

## 4. 算法路线

Stage 1：176 records 到约 1 万 chunks，NumPy float32 exact cosine + bm25s/FTS5 或 BGE sparse + RRF(k=60) 研究初值 + optional bge-reranker-v2-m3 top50→top10，graph 默认关闭。

Stage 2：1 万到 10 万 chunks，根据 latency/持久化 benchmark 选择 FAISS IndexFlatIP/HNSW、hnswlib、sqlite-vec 或 usearch。

Stage 3：只有多跳 benchmark 证明收益后，才做 networkx/PPR 或 HippoRAG-style graph；Graphiti/LightRAG 不作为起步依赖。

Embedding 候选：BGE-M3（MIT/1024d/长上下文/dense+sparse 多表示）、Qwen3-Embedding-0.6B（Apache-2.0/1024d/多语言与代码）、multilingual-e5-large（MIT）。模型、revision、license、dimension、normalization、configHash 和 source provenance 必须随 vector 绑定；不匹配即 stale。

## 5. Memory judgement

Python 可输出 noise、working_only、episodic_candidate、semantic_candidate、profile_candidate、procedure_candidate、resource_candidate、conflict_or_supersede_candidate 以及 keep/link/merge/supersede/discard/promote suggestion；每条必须带 source IDs、context/index version、support/counter evidence、confidence、policyVersion。仅 shadow audit，不写权威 memory。

## 6. 评测

比较 lexical_pre_v2、dense、sparse、weighted、RRF、rerank、graph、active threshold 和 stale/fallback arms。指标包括 Recall@K、MRR、nDCG、activation precision/recall、helpful/harmful tail、stale/drop/fallback、p50/p95 latency、memory/cost、delivery funnel 和 cross-session/workspace leakage=0。使用 M5 replay、M6 fixtures、LongMemEval、LoCoMo；CI 不联网调用模型，使用 fixture vectors。

## 7. 必须复用的参考

- BGE-M3：https://huggingface.co/BAAI/bge-m3
- Qwen3 Embedding：https://huggingface.co/Qwen/Qwen3-Embedding-0.6B
- BGE reranker：https://huggingface.co/BAAI/bge-reranker-v2-m3
- Sentence Transformers：https://github.com/UKPLab/sentence-transformers
- FlagEmbedding：https://github.com/FlagOpen/FlagEmbedding
- FAISS：https://github.com/facebookresearch/faiss
- hnswlib：https://github.com/nmslib/hnswlib
- bm25s：https://github.com/bm777/bm25s
- ranx：https://github.com/AmenRa/ranx
- HippoRAG：https://github.com/OSU-NLP-Group/HippoRAG
- A-MEM：https://github.com/agiresearch/A-mem
- Graphiti：https://github.com/getzep/graphiti
- LongMemEval：https://github.com/xiaowu0162/LongMemEval
- LoCoMo：https://github.com/snap-research/locomo

安装前必须按 pinned revision 重新核验 license、依赖、模型元数据和复现方式。

## 8. 实施进度(2026-08-24 更新)

- **M7-0 完成(tested)**:m7_wire_pre_v1 协议冻结并实现——lib/m7-wire-pre.js(纯核心)+python/worker_pre_v1.py(纯标准库确定性 fake worker)+lib/python-sidecar-client-pre.js(no-shell spawn/epoch/JSONL framing/timeout/AbortSignal/crash recovery/circuit breaker,结构化失败永不抛出)+lib/context-sink-python-pre.js(消费 ContextPushEnvelopePre 原样字段,deadline 内回 ContextAckPre)。smoke-test-m70-pre.mjs G1-G9 共 90 断言 exit 0。
- **M7-1 完成(tested)**:JS 授权分页 index_sync——lib/index-sync-pre.js(snapshot→scope 分组 begin/pages/commit,≤64 条·≤256KiB,page/final digest=canonical SHA-256);worker 原子切换 derived corpus 到 `<DSH_HOME>/memory/semantic-pre/`(可完全重建);缺页/重复/乱序/digest/版本不一致整次拒绝。smoke-test-m71-pre.mjs H1-H9 共 90 断言 exit 0。
- **解锁面**:contextSinkMode='python' 与 activationSource='python' 仅在三重门(assoc∧对应开关∧pythonBackendEnabled)下生效;默认 false/null/fake 时零 Python process、零协议 IO、零 semantic-pre 目录。fake 激活逐字段过现有 validateActivationRequestPre;Python 不构建 ReferenceTailPacketPre。
- **未做(明确)**:真实 embedding、向量检索、BM25/RRF、reranker、聚类、图算法;未标 live(无 3080 活体验证)。
- **M7-2 完成(tested,2026-08-24)**:Embedding/Tokenizer/Chunking 双层 benchmark(合成 L1 152 记录/88 查询 + 真实 L2 251 episodes/40 查询)→ **冻结 BAAI/bge-m3(pinned revision,MIT)+ m7_chunk_pre_v1=para-512-noov + NumPy exact cosine**;qwen3-0.6B 条件备选,multilingual-e5-large 淘汰(zh→en 失败)。产物:docs/M7-EMBEDDING-BENCHMARK.md、docs/M7-ALGORITHM-DECISION.md、artifacts/m7-benchmark-pre/results.{json,csv}、CI fixture(42 docs×8 queries 真实向量,smoke-test-m72-pre.mjs 21 断言零联网)。外部真实语料只读脱敏入 artifacts/m7-corpus-pre/。未接生产 activation,未标 live。三处偏差与 m70 harness 顺手修复见 PYTHON-SIDECAR-CONTRACT §19.6。
- **M7-3 完成(tested,2026-08-24)**:python/m7_embedding_pre_v1.py(冻结 policy 生产实现,可插拔 provider)+python/worker_semantic_pre_v1.py(继承 worker_pre_v1 零协议回退;commit 建向量+identity stale/重建;context_push 影子候选不发新帧)+smoke-test-m73-pre.mjs 55 断言+hybrid 对照(lexical 复刻/bm25s/dense/weighted/RRF 消融)→**冻结 hybrid_fusion_pre_v1=weighted dense0.7+lexical0.3**(L2 R@5 0.950>MRR 0.866 全面胜 dense-only;bm25s 交叉验证=自研复刻,生产零新依赖);全量回归 24 项全绿。未接生产 activation,未标 live。详见 PYTHON-SIDECAR-CONTRACT §19.7。
- **M7-4..M7-7 完成(tested,2026-08-24,未 live)**:Clustering Shadow(agglomerative NMI 0.916/稳定性 0.995,HDBSCAN 不适用,零 M6 接线);M7-4 rerank(双 reranker 质量显著——L1 R@5→1.0——但 CPU p50 26-33s 超 500ms 预算 50-90 倍→D9 deferred-optional 不接生产);M7-5 graph 门(6/8 多跳双端点已覆盖→**skipped-by-benchmark**,任务集视为正确完成);M7-6 双阈值激活(worker_semantic:shadow 校准默认;active 帧**逐字段过 M6 validator**,m76 33 断言);M7-7 judgement shadow(m77 15 断言,零权威写入);model-sparse 补测(L2 单独胜 dense,dense+ms 融合 R@5=0.975 全研究最高→D6 修正案记录不改默认)。**全量回归 26 项全绿;M7-2..M7-7 全部默认关闭/shadow;已停在 M7-8 人工门,用户操作步骤见 PYTHON-SIDECAR-CONTRACT §19.8。****M7-7.5 Hardening 完成(审阅 P0/P1/P2 全部闭环:真 BGE 建库修复/D6 hybrid 进生产/三重过滤/correction 硬抑制/gitignore 隔离),回归 26/26 复跑全绿;二轮自查补 specials 预算与 chunkId 差异说明。详见 §19.9。**
- 完整证据/偏差/进程生命周期/M7-2 输入:见 docs/PYTHON-SIDECAR-CONTRACT.md §19。
