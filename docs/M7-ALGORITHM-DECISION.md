# M7-2 算法决策(冻结)

> 冻结:2026-08-24 · 依据:docs/M7-EMBEDDING-BENCHMARK.md(L1+L2 双层)
> · artifacts/m7-benchmark-pre/results.{json,csv}
> 效力:本文档是 M7-3 production embedding/tokenizer/chunk 实现的唯一依据;
> 代码不得出现计划外模型或策略。变更需新 benchmark + 升 policyVersion。

## D1 默认 embedding provider

**BAAI/bge-m3 @ revision 5617a9f61b028005a4858fdac845db406aefb181(MIT)**

- L1:R@5=0.966(para-512)/0.989(fixed-256)、MRR 0.889/0.894、nDCG@10
  0.920/0.977、跨语言 20/20、代码类 10/10;p50/p95=122/189ms(≤500ms
  预算,5s deadline 余量 26x);峰值 RSS 2.05GB;加载 2.8s;corpus 编码
  41-48 chunks/s。
- L2(真实 251 episodes/40 查询):R@5=0.925、MRR 0.793、nDCG 0.837、
  hard-neg 0.074、p95 241ms——领先 qwen3/e5 12.5pt R@5。**确认 D1。**
- 淘汰 multilingual-e5-large:修正用法后跨语言仅 0.60、R@5 0.727;且 512
  token 硬上限与长 chunk 策略冲突。失败证据见 benchmark §4.3。
- qwen3-embedding-0.6b(Apache-2.0)列为**备选**:hard-negative 判别更优
  (0.074 vs 0.111)、R@10 略优;但 p50≈300ms/p95≈500ms 压线、RSS 峰值
  4.7GB。若 M7-4 rerank 后双子错误仍显著,可评估以 qwen3 换取判别力——
  届时需重跑本 benchmark 全套(M7-2 门槛不得跳过)。
- 裸 cosine 不优先 correction(supersede 4/8 失败)→ D4 融合层必须带
  supersede/时效特征;禁止靠换 embedding 模型解决(benchmark 证明三模型
  同病,是任务性质而非模型缺陷)。

## D2 tokenizer 与 chunk policy(冻结为 m7_chunk_pre_v1)

- **dense tokenizer**:bge-m3 自带 XLM-R sentencepiece BPE;禁止 jieba/
  任何外部预切(benchmark 语料即按此构建;jieba supersede 记录 r082 为
  契约层禁令)。
- **chunk 策略:para-512-noov**——模型 tokenizer id 空间段落贪心装包,
  上限 512 token;单段超限时该段内硬切窗(无重叠);special tokens(<s>
  </s>)由编码器在窗外交付。段落切分按记录内 `\n` 边界。
- 依据(双层):L2 真实分布最优(R@5 0.925/MRR 0.793/nDCG 0.837,
  hard-neg 0.074);L1 合成压力层次优(-2.3pt R@5 vs fixed-256)。
  真实 episode 的答案依赖上下文、双子靠细节区分,大窗占优;段落对齐
  与硬切同分(para=fixed@512),但保持标题/QA/列表语义单元完整,是零
  成本保险。L1 的 256 优势来自合成 gold 紧凑,不外推。
- 256 窗仅作为 L1 压力层的已知次选;overlap(ov64)无收益→不采用;
  1024 在 L1 劣化(-3.4pt)→禁用为默认(hard-neg 0.037 的收益交给
  M7-3 融合与 M7-4 rerank 追,不靠加大窗)。
- M7-1 占位 chunking(整记录单 chunk)就此作废:derived state 须按
  configHash 失配全量重建(契约 §10 已有该规则,M7-3 落实)。
- chunkId 仍是派生定位 chk_pre_=hash(memoryId+recordDigest+chunkOrdinal),
  **新增 chunkOrdinal 入 hash**(占位版无序数;避免同记录多 chunk 撞 id);
  chunkId 永不替代 memoryId。
- 聚合到父 memory:top-1 chunk 分数即 memory 分数(不平均);tie-break
  score 降序→memoryId 字典序→chunkOrdinal(契约 §11.2 保持)。

## D3 向量表示与检索(冻结)

- float32 NumPy 矩阵,行 L2 归一,cosine=点积;查询侧同 tokenizer 同归一。
- 查询无前缀/无 instruction(bge-m3 官方 FAQ);查询 token 上限 256。
- 检索前按 workspaceRef scope 过滤(宿主侧硬门,benchmark 镜像入侵证据);
  exact 全矩阵扫描,禁 ANN(规模门槛:>5 万 chunk 或 p95>500ms 才重开
  benchmark 评 FAISS IndexFlatIP——exact 等价升级优先,HNSW 仍需另证)。
- 每 vector 绑定 provider/model/revision/dimension/normalization/
  configHash/sourceEpoch/sourceVersion/recordDigest/chunkId;任一不匹配=
  整个 derived index stale→全量重建,禁止混用(契约 §10)。

## D4 交给 M7-3 的明确输入

1. production provider:bge-m3 pinned revision(见 model-manifest.json,
   sha256 逐文件);离线部署=按 manifest 下载核验(hf-mirror 通道已验证)。
2. worker:python/worker_semantic_pre_v1.py(新增,不改动已 tested 的
   worker_pre_v1.py);复用其协议层(canonical/digest/拒绝矩阵),在
   index_sync commit 后做 tokenizer chunking+embedding,derived 目录结构
   <DSH_HOME>/memory/semantic-pre/{derived-corpus.json, vectors.f32,
   vectors-meta.json(identity block)};health 回 embed 能力;context_push
   时 dense 检索 top-8 产出 candidate_result(仍不直接激活)。
3. 对照 arms(全部跑 L1+L2):lexical(复刻 lexical_pre_v2:NFKC+CJK 2-gram
   +哈工大停用词+BM25 k1=1.2 b=0.75)、dense、bm25s sparse(MIT,自定义
   splitter 复刻同款分词)、weighted fusion、RRF(k 消融 {10,20,40,60,100});
   模型 sparse(bge-m3 sparse_linear.pt)为可选 arm,若引入需补下载+核验。
4. supersede/时效特征进入融合(基准证据:裸 cosine 4/8 失败);具体权重
   由 M7-3 消融冻结。
5. CI:fixture vectors 已冻结(smoke-test-m72-pre.mjs);M7-3 新增的检索/
   融合测试同样用 fixture,不联网。

## D5 已驳回的路线(留档)

- e5-large(跨语言失败+512 上限)· jieba 预切(违反分层+supersede r082)
  · overlap chunking(无收益)· 1024 长窗(R@5 -3.4pt)· ANN/图数据库
  (规模未到,契约 §11.5)· 以换模型解决 supersede(三模型同病)。
- qwen3-0.6b 暂不采用(延迟/内存),保留为 M7-4 后的条件备选。

## D6 融合 policy(冻结为 hybrid_fusion_pre_v1,M7-3)

- **默认融合:weighted min-max 归一线性融合,dense 权重 0.7 + lexical 0.3**;
  lexical arm = lexical_pre_v2 的 Python 对齐复刻(NFKC+CJK 2-gram+哈工大 507
  停用词+BM25 k1=1.2 b=0.75,停用词表运行时从 lib/shadow-retrieval-pre.js
  提取,零拷贝漂移)。lexical_pre_v2 仍是强制 baseline/fallback。
- 依据(artifacts/m7-hybrid-pre/results.csv):L2 真实分布 weighted w=0.7
  R@5=0.950/MRR=0.866/hardneg=0.074,全面优于 dense-only(0.925/0.774)与
  lexical-only(0.825/0.787);L1 压力层 w=0.7 R@5=0.966 与 dense 持平
  (MRR 0.837 vs 0.882,可接受代价)。
- RRF:k∈{10,20,40,60,100} 结果完全一致(不敏感),保留 k=60 为文档化备选,
  不作默认(MRR 劣于 weighted:0.813 vs 0.866)。
- bm25s 库(0.3.10,Lucene)与自研复刻 R@5 完全一致(L1 0.773/L2 0.825)
  ——**库交叉验证通过,生产不引入 bm25s 依赖**(零新运行时依赖)。
- supersede 惩罚 γ∈{0.02,0.05} 无可测效果(L1 sup 保持 0.5)→ 不冻结;
  correction 排序问题移交 M7-6 特征层(supersede 边+时效+evidence)。
- tie-break 恒定:融合分降序→memoryId 字典序→chunkOrdinal。

## D8 Clustering Shadow 结论(M7 任务集 §七,shadow-only)

- 基准(artifacts/m7-cluster-pre/):对象=memory record(块向量均值→L2),
  真值=手写主题(双子共题/其余单题/distractor 小组)。
- **结论:agglomerative(cosine,average linkage,thr≈0.3)为 shadow 参考实现**
  ——NMI 0.916/B-cubed 0.782/125 簇,bootstrap 稳定性 0.995(5×80% 子采样);
  thr 0.5+ 粗簇化质量崩塌(B-cubed 0.44→0.07)。
- **HDBSCAN 不适用本语料形态**:单例主题为主 → 噪声率 62-100%
  (mcs=3 时 known-topic 噪声 0.68);"噪声"即真实语义形态,soft membership
  无处着力。留档不采用。
- UMAP(仅可视化)与 BERTopic(标注层)skipped-by-scope(任务集定位即非门)。
- L2 真实语料结构参考:thr=0.5 仅 5 簇——真实记忆高度单例化,聚类在
  M7-6 中的价值应是"簇支持特征"而非主召回,维持 shadow,不接 M6。
- 簇 artifact 形状已按任务集落盘(clusters.json:clusterId/members/centroid
  前 8 维/medoid/radius/softMembership(HDBSCAN 时)/noise/keywords/
  policyVersion=cluster_shadow_pre_v1)。

## D9 Rerank 决策(M7-4,冻结为 rerank_policy_pre_v1 = deferred-optional)

- 候选(全部 pinned+核验):bge-reranker-v2-m3 @953dc6f6f85a(Apache-2.0,
  2.29GB,load 1.7s);qwen3-reranker-0.6b @e61197ed4502(Apache-2.0,1.21GB,
  load 0.8s)。FlashRank 跳过:模型托管在代理外网络不可达(记录)。
- **质量证据(bge-reranker top50→10 全量)**:L1 R@5 0.966→1.0、MRR
  0.837→0.947、supersede 0.5→0.625;L2 MRR 0.866→0.892、hardneg 0.074→
  0.037。qwen3 探针(10 查询×10 对):R@5=1.0 双层,但 hardneg 劣于 bge
  (0.33/0.125 vs 0.11/0.04)。
- **延迟证据(CPU,生产形态)**:bge p50 26-33s/查询(50 对);qwen3 探针
  0.8-0.95s/对→外推 40-48s/50 对。两者超 500ms 预算 **50-90 倍**。
- **决策:rerank 不接生产同步路径**。冻结为 deferred-optional:仅允许
  异步/batch 场景或 activation 非关键链路使用;重开条件=量化(int8 ONNX)
  或 GPU 推理把 50 对压进 500ms,届时须重跑本消融。timeout/unavailable
  保序语义在接线时实现(M7-4 未接线,无生产影响)。
- 若未来启用:默认 bge-reranker-v2-m3(质量+hardneg 全面占优)。

## D10 Graph 条件门(M7-5,结论=skipped-by-benchmark)

- 8 条多跳探针(supersede 双端点问题):hybrid top-10 已在 **6/8** 同时
  覆盖双端点;剩余 2 条的 hop2 缺口可由 M7-6 的 supersede/时效特征在
  融合层补(JS provenance 已携带边,零图存储成本)。
- 语料仅 7 条 supersede 边——不足以证明 networkx/PPR 的维护成本合理。
- **按任务集 §九:skipped-by-benchmark 视为正确完成**;重开条件=
  LongMemEval/LoCoMo 或自有大规模多跳集证明 hybrid+特征仍不足。
- 零重型服务(Neo4j/Graphiti)引入,与契约 §11.5 一致。

## D11 M7-6/M7-7 状态

- M7-6 已实现(worker_semantic_pre_v1):per-session 语义状态
  (sessionId+workspaceKey+scope,close_session 清除)、双阈值
  suppress/prefetch/emit(T_on>T_off 滞回)、cooldownObs 冷却、特征
  分组落日志(denseTop/margin/evidence seen·cite·correction/tool
  failures/recency)、**shadow 校准默认**;active 模式的 activation_request
  帧逐字段过 M6 validateActivationRequestPre(smoke-test-m76 Q2 实证)。
  阈值默认 tOn=0.62/tOff=0.52 为初值,生产启用前须用 shadow 日志校准
  (activation-shadow.jsonl 即校准数据源)。
- M7-7 已实现:judgement shadow(8 类 kindCandidate+keep/merge/supersede
  建议,marker+启发式分类),只写 judgement-shadow.jsonl;每条带
  sourceIds/contextVersion/miv/support+counter evidence/confidence/
  policyVersion;零 MEMORY.md/evidence/Procedure 写入(m77 断言)。
- 两者均为 shadow,不触发任何 M6 注入(除 active 模式显式开启)。

## D7 状态

- **M7-2..M7-7 全部 tested(2026-08-24)**:D1-D11 冻结齐全;回归 26 项
  (M0-M6 20+m70/m71/m72/m73/m76/m77)全绿;全部默认关闭/影子态,未接
  生产 activation(唯一例外=worker activationPolicy.mode='active' 显式
  开启,且需三重门+M6 validator 双重把关)。
- **M7-8(唯一人工门)未执行**:等待用户重启/开关授权;步骤见
  PYTHON-SIDECAR-CONTRACT §19.8。未经 live 验证不标 live。
