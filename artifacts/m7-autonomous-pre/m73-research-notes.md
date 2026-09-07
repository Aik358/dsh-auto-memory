# M7-3 Sparse/Hybrid 研究笔记(2026-08-24,主 Agent 调研)

## bm25s(github.com/xhluca/bm25s)

- MIT;纯 Python + NumPy 稀疏矩阵;预计算 per-token 分数,查询期快(声称比
  rank-bm25 快两个数量级;numba 后端再 ~2x)。
- API:bm25s.tokenize(corpus, stopwords, stemmer) → BM25().index() →
  retrieve(query_tokens, k) 返回 (results, scores);retriever.save/load,
  大索引 mmap。变体:method='lucene'(默认)/robertson/atire/bm25l/bm25+,
  k1/b 可调(lucene 默认近似 k1≈1.2? 需实测对齐 lexical_pre_v2 的 k1=1.2/b=0.75)。
- CJK:官方无中文 splitter,需自定义——计划复刻 JS lexical_pre_v2 的
  NFKC + CJK 2-gram + 哈工大停用词 507 词(与生产回退层同分布,对照才公平)。
- pip install bm25s(pypi 可达,无需 [core] extras 即可跑基础)。

## sqlite3 FTS5(stdlib)

- 本机 venv 实测:Cpython 3.10.11 / sqlite 3.40.1,FUTS5 可用
  (CREATE VIRTUAL TABLE t USING fts5(text) 成功)。
- 零第三方依赖;unicode61 tokenizer 默认,中文按字符处理差;
  trigram tokenizer 可用但索引大。候选定位:FTS5 作为 bm25s 的备选 arm,
  不是首选(分布与 lexical_pre_v2 对齐优先)。

## 模型 sparse(bge-m3 专用,条件项)

- 需要 sparse_linear.pt(下载时被 allow_patterns 排除,需补下载,~几 MB)
  + FlagEmbedlation 或手工实现(token logits 线性层 → token id→weight 稀疏
  表示,Query/doc 稀疏分 = 权重点积)。
- 仅当 dense benchmark 胜者是 bge-m3 时才值得做 M7-3 的 'model sparse' arm;
  qwen3/e5 无官方 sparse。

## RRF 与融合

- RRF 初值 k=60(研究值,必须消融:计划 k∈{10,20,40,60,100} 在 L1+L2 上扫)。
- weighted fusion:归一化 min-max per-arm 后加权,计划 dense 权重
  w∈{0.3,0.5,0.7} × sparse 1-w 网格。
- tie-break 恒定:score/rank 后 memoryId 字典序(契约 §11.2)。

## lexical baseline

- JS lexical_pre_v2 = BM25(idf=ln(1+(N-df+0.5)/(df+0.5)) + tf 饱和 k1=1.2
  b=0.75 + 长度归一)+ termCoverage idf 加权 + NFKC + CJK 2-gram + 哈工大
  停用词 507。Python 侧为对照复刻同款打分(不是调用 JS)。

## Qwen3-Embedding-0.6B 官方用法核验(hf-mirror 模型卡,2026-08-24)

- 查询模板 f'Instruct: {task}\nQuery:{query}';文档侧明确"无需 instruction"。
- last_token_pool:左填充直接取末位;右填充按 attention_mask.sum-1 索引
  (本 bench 用右填充 else 分支,数学等价)。
- F.normalize(p=2) 归一;retrieval 建议 max_length 8192;dim 1024;
  MRL 支持 32..1024 维;Apache-2.0;需 transformers>=4.51(本机 5.15.1 ✓)。

## bge-m3 官方用法核验(模型卡 + 本地 1_Pooling/config.json)

- 无查询 instruction(FAQ 明确);dense 1024d;上下文 8192;MIT。
- pooling 权威=仓库自带 1_Pooling/config.json:cls_token=true(其余 false)
  ——本 bench CLS 实现与之一致;qwen3 仓库 lasttoken=true、e5 仓库
  mean_tokens=true,三模型 pooling 均有官方配置佐证。
