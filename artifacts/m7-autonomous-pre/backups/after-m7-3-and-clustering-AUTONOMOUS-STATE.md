# M7 Autonomous State（自主推进状态文件）

> 生成：2026-08-24 01:40 (Asia/Shanghai)；最近更新 01:55
> **最高执行依据：docs/M7-TASKSET-DISPATCH.md（DeepSeek harness 总派发 Agent
> 任务集逐字副本，2026-08-24 01:51 粘贴）。本文件与其冲突时以任务集为准。**
> 接口速查：docs/M7-INTERFACE-DIGEST.md（M5/M6/SidecarClient/worker 全部
> 字段级契约摘要，恢复会话先读它可省大量重读）。
> 用途：长期自治的唯一人类可读状态。上下文压缩/进程恢复后,先读
> system-map、M7 contract/report、本文件、artifacts/m7-autonomous-pre/state.json
> 和 git status,然后从 nextExactAction 继续,不得从头重新规划。
> 纪律：不 commit/push/tag/publish;不碰 127.0.0.1:3080 宿主(只读 GET 也不改状态);
> M7-8 live 是唯一人工门,到点暂停。

## immutableObjective

在 D:\dsh-auto-memory preview 分支上,自主完成 M7-2(embedding benchmark)至
M7-7(judgement shadow)的代码、artifact、测试与文档;不回退 M7-0/M7-1 协议与
index_sync 语义;不接生产 activation(默认关闭零副作用);到 M7-8 停止并输出
需要用户执行的精确步骤。全部产物保持未提交。

## capabilityMatrix(2026-08-24 审计,全部只读探针)

| capability | 值 | 证据 |
| --- | --- | --- |
| repoRead | true | git status/docs/lib 读取正常 |
| repoWrite | true | Write/Edit 工具可用 |
| shell | true | Git Bash,后台任务可用 |
| pythonExecutable | true | 独立 venv D:\dsh-auto-memory\python\bench\.venv (3.10.11);系统 3.14.6 无 torch |
| networkAccess | partial | hf-mirror.com 可达(~0.4-4MB/s);huggingface.co/google 直连失败(用户已关代理);github 200;pip/pytorch.org 可达 |
| externalMemoryRead | true | 契约 §4 全部 8 路径存在(workbuddy/projects 104M、codex/sessions 46M、md 文件 4-12K) |
| loopbackReadOnly | partial | 127.0.0.1:3080 有 HTTP 响应,/debug/state 404(宿主在跑,路径未暴露;仅 GET,零写入) |
| dshLifecycleControl | true(能力)/false(授权) | dsh 命令存在;本轮用户明令禁止停止/重启 3080 → 视为 false |
| subagents | true | ZCode Agent 工具可用(仅只读研究/复核,主 Agent 唯一 writer) |

不假设存在 memory_recall_pre/memory_external_pre/goal/calendar 等 DeepSeek
Harness 工具;未暴露即不模拟。无 dshLifecycleControl 授权不构成离线 M7 阻断:
M7-2~M7-7 照常推进,M7-8 人工门停止。

## currentPhase / currentSubtask

- currentPhase: M7-4 Rerank(进行中,2026-08-24 06:30)
- currentSubtask: m7b_rerank.py 对照运行中(bge-reranker-v2-m3 @953dc6f6f85a
  Apache-2.0 已下载核验 2.29GB;fusion top50→top10 vs 不重排,L1+L2)。
  已完成:Clustering Shadow(D8:agglomerative thr=0.3 胜出 NMI 0.916/
  稳定性 0.995;HDBSCAN 不适用;shadow-only 不接 M6)。

## M7-3 已完成(全量回归 24 项全绿)

- python/m7_embedding_pre_v1.py + python/worker_semantic_pre_v1.py
  (继承 worker_pre_v1 零协议回退;影子候选本地日志;stale/重建)。
- smoke-test-m73-pre.mjs N1-N8 **55 断言**全绿。
- hybrid 对照→**D6 冻结 hybrid_fusion_pre_v1=weighted dense0.7+lexical0.3**
  (L2 R@5 0.950/MRR 0.866 胜 dense-only;bm25s 交叉验证一致→零新依赖;
  RRF k 不敏感;supersede γ 无效→移交 M7-6)。
- artifacts/m7-hybrid-pre/results.{json,csv}。

## M7-2 最终结果(全部完成,23 项回归全绿)

- **冻结(docs/M7-ALGORITHM-DECISION.md)**:bge-m3 @5617a9f61b02(MIT)+
  m7_chunk_pre_v1=para-512-noov + NumPy float32 exact cosine;
  qwen3-0.6B 备选;e5-large 淘汰。
- L1:R@5 0.966/MRR 0.889/nDCG 0.920/跨语 1.0/hardneg 0.111/p95 189ms。
- L2:R@5 0.925/MRR 0.793/nDCG 0.837/hardneg 0.074/p95 241ms(领先 12.5pt)。
- supersede 裸 cosine 4/8 失败→M7-3 融合必须带 supersede/时效特征。
- 测试:smoke-test-m72-pre.mjs K1-K7=21 断言;**全量回归 23 项串行全绿**
  (M0-M6 20+m70+m71+m72);node --check/py_compile/git diff --check/
  BOM/_dev 扫描全净。
- 顺手修复(披露):smoke-test-m70-pre.mjs G7 harness 的 ctx.effect 空桩
  丢失 heartbeatTimer 清理→进程无法自然退出(90 断言本全过;仅测试
  harness,零生产代码改动)。修复后 m70 自然 exit 0。
- 回写完成:contract §19.6/report §8/system-map(currentScope→M7-3,
  M7 行 evidence+reviewRound+nextBrief)/PREVIEW-NEXT-STEPS/本文件/state.json。

## M7-3 输入(docs/M7-ALGORITHM-DECISION.md D4)

1. python/worker_semantic_pre_v1.py:复用 worker_pre_v1 协议(canonical/
   digest/拒绝矩阵),commit 后 tokenizer chunking(para-512)+bge-m3
   embedding;derived=semantic-pre/{derived-corpus.json,vectors.f32,
   vectors-meta.json(identity block)};context_push 时 dense top-8 产
   candidate_result(不激活);health 回 embed 能力。
2. 对照 arms(L1+L2 全跑):lexical 复刻(NFKC+CJK 2-gram+哈工大 507 停用词
   +BM25 k1=1.2 b=0.75)/bm25s(自定义 splitter 同款分词)/weighted/RRF
   k∈{10,20,40,60,100}消融;supersede/时效特征进融合。
3. vector 绑 provider/model/revision/dim/normalization/configHash/
   sourceEpoch/sourceVersion/recordDigest/chunkId;失配=stale 全量重建。
4. CI fixture-only;不接生产 activation;默认关闭零进程零 IO 断言不变。

## L2 外部真实语料(已完成,artifacts/m7-corpus-pre/)

- episodes.jsonl:251 条(94 profile 块 + 128 DSH 锚定记录 + 29 去重后真实会话
  episode);按 sessionRef hash 切分 train190/dev32/test29;脱敏 secret97/
  phone2/abspath85/email0;只读原文件,未回写任何 MEMORY.md。
- multilingual-queries.jsonl:40 条手写查询(zh/en/mixed/code,含跨语言与
  hard-negative 标注);hard-negatives.jsonl:10 对;activation-scenarios.jsonl:
  8 条(M7-6 校准输入);privacy-report.json + split-manifest.json +
  raw-manifest.json 齐全;查询源码 l2-queries-authored.py 可审。
- 卫生:重复会话跨文件去重;"Please continue with the conversation" 续接产物
  剔除;正反斜杠用户主目录均已脱敏。

## M7-2 已修 bug(全部回归验证中)

1. transformers 5.15.1 无 build_inputs_with_special_tokens → 探针法定位
   special 前后缀(bge-m3=[bos,eos];qwen3=[eos];跨样本稳定性断言)。
2. multilingual-e5-large max_position_embeddings=512 → doc_max_tokens=512
   (内容截断至 510);fixed-512 崩溃根因即 512 内容+2 special=514 越界。
3. e5 doc 侧 "passage: " 前缀此前未进 chunk 文本流 → 现并入 record 文本
   再 tokenizer 切分(首轮 e5 xlang@5=0.55 的主因,属实现 bug 非模型弱点)。
4. PeakRss 跨模型串扰 → 每模型 reset_baseline()。
5. 新增 nDCG@10 与 per-query top10 明细(离线指标可重算)。

## completedArtifacts

- python/bench/ 独立实验环境:.venv(3.10.11, torch 2.13.0+cpu, transformers
  5.15.1, numpy 2.0.2, huggingface_hub 1.28.0, psutil, sentencepiece, requests)
- python/bench/m7b_config.py:三模型 pinned revision/license/dimension/
  normalization/pooling/instruction + 5 chunk policies + 预算常量
- python/bench/download_models.py + m7b_fetch.py:下载与校验(hf 直连 +
  hf-mirror 分段并行两条路径,后者带 LFS sha256 核验)
- python/bench/m7b_corpus.py:152 records / 88 queries 合成语料(zh→en、en→zh、
  混写、代码/路径/错误码、hard-negative 双子、supersede 新旧、跨 workspace
  镜像、多 chunk 长文、60 distractors)
- python/bench/m7b_chunker.py:tokenizer-id 空间 chunking(fixed 256/512/1024、
  para-512、para-512-ov64;无 jieba/外部预切)
- python/bench/m7b_embed.py:三模型 canonical pooling(CLS/mean/last-token)+L2
  归一 + RSS 追踪
- python/bench/m7b_run.py:编排器(指标、tie-break、scope 门、延迟、内存、
  索引体积、configHash)
- python/bench/m7b_export_fixture.py + smoke-test-m72-pre.mjs(K1-K7 离线 CI,
  fixture vectors 不联网)
- bge-m3 快照已下载并本地 sha256 全文件校验(2.29GB)

## exactDecisions

- 三模型 pinned revision(bge-m3 5617a9f61b028005a4858fdac845db406aefb181 /
  MIT;qwen3 97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3 / Apache-2.0;
  e5-large 3d7cfbdacd47fdda877c5cd8a79fbcc4f2a574f3 / MIT)——下载前经 HF API
  核验,license 标签来自模型卡。
- Dense 输入一律各模型自带 tokenizer(id 空间切分),qwen3 查询走模型卡
  Instruct/Query 模板,e5 加 query:/passage: 前缀,bge-m3 无前缀。
- 检索 = NumPy float32 + L2 归一 + 精确点积;无 ANN/FAISS/HNSW/图。
- tie-break:score 降序 → memoryId 字典序 → chunkOrdinal。
- 偏差披露:M7-BENCHMARK-PLAN.md 在模型已 pinned/下载之后补写(进入自主模式
  前的既有顺序);计划内容与已执行步骤一致,不构成方法学改变。

## modelRevisions 与 licenses

见 python/bench/results/model-manifest.json(逐文件 sha256/bytes/本地路径)。
bge-m3 2.29GB;qwen3 ~1.2GB;e5-large ~2.24GB;缓存 D:\dsh-auto-memory\
python\bench\(.hf-cache 与 models\),均在未跟踪目录,不进 git。

## activeProcesses

| PID | 命令 | 用途 | 日志 |
| --- | --- | --- | --- |
| (bg) | m7b_fetch.py qwen3,e5 | hf-mirror 分段下载+校验 | sess .../call_44237d7d320d477ca7091eeb-stdout.log |

无其他无主进程;所有后台任务由 ZCode exec 登记。

## testCommands / exitCodes

- node --check(新 JS 测试)待跑;python -m py_compile 全部 bench 模块通过
  (m7b_corpus/m7b_chunker/m7b_embed/m7b_run/m7b_config/m7b_fetch/
  download_models/m7b_export_fixture)。
- 完整回归(M0-M6 22 项 + m70/m71 + m72)在 M7-2 收尾时统一串行执行。

## benchmarkResults

(进行中——benchmark 跑完后回填 results.json/csv 摘要与 runIds。)

## knownRisks

- hf 直连失效:靠 hf-mirror;若镜像也被断,下载类任务 blocked:network,
  已完整下载的 bge-m3 仍可完成单模型 benchmark(降级方案记录于 decision doc)。
- 系统 RAM 31GB 但空闲仅 ~10GB(其他应用占用);embedding 峰值内存按模型
  顺序逐个加载,一个时刻只载一个模型。
- transformers 5.15.1 是较新主版本:Qwen3/e5 加载路径需实测(已预留
  pytorch_model.bin/safetensors 双通道)。
- 3080 宿主正在运行:绝不触碰;所有实验只写 python/bench、artifacts/、
  docs/、tests/。

## blockedItems

- 无(下载进行中不算 blocked)。

## nextExactAction

1. M7-3:写 python/worker_semantic_pre_v1.py(纯协议复用+embedding provider
   接口,模型按 manifest 加载)+ smoke-test-m73-pre.mjs(protocol 兼容+
   stale/rebuild+scope 门+候选 provenance 复制)。
2. M7-3 对照 benchmark(独立脚本,不进生产路径):lexical 复刻/bm25s/
   dense/weighted/RRF 消融→artifacts/m7-hybrid-pre/;冻结融合 policy。
3. 之后按任务集顺序:Clustering Shadow(§七)→M7-4 rerank→M7-5 graph 门
   →M7-6 双阈值激活→M7-7 judgement shadow→M7-8 人工门暂停。
4. 每阶段:专项测试+全量回归+五文档回写+state.json 原子更新。
