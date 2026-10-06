# M7-2 Benchmark Plan(冻结版)

> 冻结:2026-08-24(自主模式接管时补写;模型 pinned/下载发生在本文件落笔前,
> 方法与已执行步骤一致,顺序偏差已披露于 AUTONOMOUS-STATE exactDecisions)
> 上位契约:docs/PYTHON-SIDECAR-CONTRACT.md §11.1/§14、§4 外部语料规则
> 产物:docs/M7-EMBEDDING-BENCHMARK.md、docs/M7-ALGORITHM-DECISION.md、
> artifacts/m7-benchmark-pre/results.{json,csv}、CI fixture vectors(不联网)

## 1. 研究问题

RQ1 模型:BAAI/bge-m3、Qwen/Qwen3-Embedding-0.6B、intfloat/multilingual-e5-large
在中文→英文、英文→中文、中英混写、代码/路径/错误码、同主题 hard negative、
correction/supersede、跨 workspace 禁止命中七类查询上的质量/延迟/内存差异,
谁应成为默认 embedding provider?

RQ2 chunk 策略:各模型自带 tokenizer 的 id 空间内,fixed-256/512/1024 硬窗口、
para-512 段落对齐、para-512-ov64(64 token overlap)五种策略对长文 deep-answer
检索与索引体积的影响?默认 chunk policy 冻结为什么?

RQ3 资源:CPU(生产 sidecar 真实形态)下 p50/p95 查询延迟、corpus 编码吞吐、
模型加载时间、峰值内存、索引体积是否满足 5s deadline×10 余量预算?

## 2. 语料(两层)

L1 合成可控层(python/bench/m7b_corpus.py):152 records / 88 queries,七类
覆盖 + 60 distractors + 多 chunk 长文长尾(256-token 下 8 条多 chunk)。所有
gold/hard-negative/supersede 关系显式标注,可解释每一分差异。

L2 真实语料层(artifacts/m7-corpus-pre/,契约 §4 规则):外部记忆/会话 →
100-300 高质量 episode,heading-block 切分、session+时间合并、脱敏(token/
secret/手机号/凭据/绝对路径)、hashed sourceRef/sessionRef、按 sessionId 分
train/dev/test。只读原文件,不导入不回写。L2 用于验证 L1 结论不过拟合合成
分布;人工待审查清单 >=30 条。

## 3. 方法

- 每模型 pinned revision 下载前核 license;逐文件 sha256 入
  model-manifest.json;缓存于未跟踪目录 python/bench/(不进 git)。
- Dense 输入 = 模型自带 tokenizer(add_special_tokens 按模型约定);
  禁止 jieba/JS lexical 预切。chunker(段落/窗口)与 dense tokenizer 分层,
  不混用。
- 指令遵循模型卡:bge-m3 无前缀;qwen3 查询 Instruct/Query 模板;
  e5 query:/passage: 前缀。pooling=CLS/last-token/mean,全部 L2 归一。
- 检索:NumPy float32 + L2 normalize + 精确点积。无 ANN/FAISS/HNSW/图。
- tie-break:score 降序 → memoryId 字典序 → chunkOrdinal(与契约 §11.2 一致)。
- 每次查询先按 workspaceRef scope 过滤再排序(跨 workspace 泄漏=0 是硬断言);
  另跑无 scope 诊断组,量化"为什么 scope 门必须在宿主侧"。

## 4. 指标

Recall@1/5/10、MRR、nDCG@10(supersede 高于 old 计高相关)、跨语言 Recall@5
(zh→en + en→zh 子集)、code Recall@5、hard-negative error(neg 严格高于
gold 的比例)、supersede correct(new 排在 old 前)、xws mirror 无 scope 干扰
率(诊断)+ scoped leak(必须 0)、p50/p95 查询延迟(单查询编码+全矩阵点积)、
corpus 编码吞吐、模型加载时间、峰值 RSS、向量索引体积(bytes 与 per-chunk)。
每个 (model × policy) 一个 configHash;结果含 runId 可复现。

## 5. 决策规则

- 质量(Recall@5/MRR/xlang/hardneg)权重最高;同分差内(<=2 点)资源优者胜。
- 延迟硬门:p95 查询(编码+检索)< 500ms(参考 CPU);corpus 重建 1000
  records < 10 分钟。
- license 硬门:默认分发路径禁 CC-BY-NC/MIT 之外需复核的许可。
- 冻结产物:默认 provider、tokenizer 约定、chunk policy(含 policyVersion=
  m7_chunk_pre_v1)、dimension/normalization/configHash 绑定规则 → 全部写入
  docs/M7-ALGORITHM-DECISION.md,M7-3 按此实现,不允许代码里出现计划外模型。

## 6. CI

fixture vectors 从胜出 (model × policy) 导出(真实向量、float64 JSON);
smoke-test-m72-pre.mjs 在纯 Node 重算 exact cosine 排序断言一致 + 维度/
归一化/scope 门/identity 契约断言;不联网、不下载、不调 Python。

## 7. 不做(本阶段)

不接生产 activation;不改 M7-0/M7-1 协议与 index_sync 语义;不做 ANN/图/
聚类/reranker(M7-3+ 阶段按各自 benchmark 门推进);不 commit/push/tag/
publish;不触碰 3080 宿主。
