# M7 Python Backend Agent 执行 Prompt

工作区：D:/dsh-auto-memory

你只负责 M7。M0-M6 已 live verified。按顺序阅读：

1. docs/proactive-associative-memory-system-map.html
2. docs/M5-CONTRACT.md
3. docs/M6-CONTRACT.md
4. docs/M7-PYTHON-IMPLEMENTATION-REPORT.md
5. docs/PYTHON-SIDECAR-CONTRACT.md
6. lib/context-bridge-pre.js
7. lib/evidence-store-pre.js
8. lib/context-host-pre.js
9. lib/activation-inbox-pre.js
10. lib/activation-inbox-state-pre.js
11. lib/activation-host-pre.js
12. lib/index.js 与 smoke-test-m51-pre.mjs、m52、m53、m61、m62、m63

先运行 git status --short --branch。保留全部既有未提交和未跟踪文件；禁止 reset、checkout、clean、add 或提交无关文件。

目标：实现默认关闭的 Python Semantic Engine。JS M5 通过 context_push、evidence_sync 和新增分页 index_sync 提供实时上下文、可信 evidence 和完整授权语料；Python 负责 embedding、dense/hybrid retrieval、可选 rerank/graph、per-session semantic state 和主动 ActivationRequestPre；JS M6 继续独占 validator、Reference Tail、delivery、seen 和 model-visible 投递。

关键事实：context_push.memoryRefs 只有 top-8 lexical refs。没有 index_sync 就没有全库主召回。Python 不得自己发现或读取文件。

绝对约束：

- Python 不读 DSH 文件、Markdown、sidecar、ctx、Agent、AbortSignal、Session JSONL 或任意路径。
- Python 不分配或修改 memoryId、anchorId、source version/digest；不创建 AccessEvidence；不写 prompt/Inbox/Packet。
- stdin/stdout 一行一 JSON；stdout 仅协议；stderr 诊断；不启动 HTTP server。
- 校验 workerEpoch、requestId、observationId、activationId、sessionId、workspaceRef、scope、contextVersion、memoryIndexVersion 和全部 provenance。
- Python unavailable/timeout/bad response 回退 lexical_pre_v2；stale/scope mismatch 直接丢弃。
- 默认关闭时零 Python process、零协议 IO、零 semantic-pre 目录。
- 不从 ANN 或图数据库开始；当前 corpus 约 176 records。

按阶段执行：

M7-0：protocol validator、JSONL framing、health、workerEpoch、deterministic fake worker、坏帧/超时/过期/drop tests，无模型。
M7-1：JS SidecarClient；在三重门下解锁 contextSinkMode=python 和 activationSource=python；实现 index_sync begin/page/commit、page/final digest、Python atomic derived index。
M7-2：benchmark 后选一个 embedding provider；绑定 provider/model/revision/dimension/normalization/configHash/source provenance；rebuild/stale tests。
M7-3：NumPy exact normalized cosine；对比 lexical_pre_v2、sparse、weighted fusion、RRF；保留 fallback。
M7-4：bounded top-K reranker；timeout fallback。
M7-5：只有多跳 benchmark 证明收益才实现 graph；edge 带 provenance/scope/version/revoke。
M7-6：per-session semantic state、threshold/hysteresis/cooldown；针对最新 contextVersion 主动返回 ActivationRequestPre，走现有 M6 natural pre-step claim。
M7-7：Semantic/Profile/Procedure judgement suggestion 只做 shadow audit，不写权威 memory。
M7-8：用户控制的 live verification。

算法研究是强制门：至少比较 BGE-M3、Qwen3-Embedding-0.6B、multilingual-e5-large、Sentence Transformers/FlagEmbedding、NumPy/FAISS/hnswlib、bm25s/FTS5/RRF、bge/Qwen/FlashRank reranker、HippoRAG/A-MEM/Graphiti。记录 pinned URL/revision、license、dimension、依赖、语言/代码质量、latency、memory、privacy、离线准备和 benchmark。禁止手写 embedding 模型、未经验证 ANN 或凭直觉矩阵/图算法。

推荐研究起点而非强制默认：BGE-M3 1024d + NumPy exact cosine + bm25s/BGE sparse + RRF 初值 k=60 + optional bge-reranker-v2-m3 top50→top10；Qwen3-Embedding-0.6B 做多语言/代码对比；graph 默认关闭。

评测必须包含 lexical_pre_v2、dense、sparse、weighted、RRF、rerank、graph、active threshold arms；Recall@K/MRR/nDCG、activation precision/recall、helpful/harmful tail、stale/drop/fallback、p50/p95、memory/cost、cross-scope leakage=0。使用 M5 replay、M6 fake fixtures、LongMemEval、LoCoMo；CI 使用固定 fixture vectors，不联网调用模型。

完成前必须：

- 运行 M0-M6 现有 20 项回归和全部 M7 tests；
- 运行 JS node --check、Python syntax/type/lint/test、git diff --check、BOM/namespace scans；
- 验证每个 Python activation 通过现有 M6 validator；
- 验证 wrong epoch/session/scope/context/index/digest fail closed；
- 验证 disabled zero process/IO；
- 验证 real context_push -> index_sync -> Python activation -> M6 next-request tail -> delivered/seen；
- 每阶段更新 M7 contract/report/system-map/PREVIEW；未经 live 验证不标 live；
- 不 commit、push、tag、publish 或 preview-to-formal conversion。
