# 语义引擎升级路线：可插拔模型接口契约 + BGE-M3 sparse / multilingual-e5 评估

> 基线：`D:\dsh-auto-memory`，分支 `dev`，**HEAD `a53560e`**。本文所有 `file:line` 均指 **HEAD 树**（`git show a53560e:<path>`）。
> 时刻：2026-10-24 14:31–15:05 (+08:00)。
> 只读纪律：本轮除本文件外**未写入任何文件**（自证见 §6.4）。未跑 GPU 训练、未下载模型、未跑 release。
> 标注约定：
> - **[实测]** = 本轮真跑，命令见 §6.1；
> - **[抄]** = 未验证，抄自 `<文件>:<行>`，逐条列在 §6.2；
> - **[推定]** = 由已读代码逻辑推出，未实跑，标注推理链。
>
> ⚠️ **并发改动说明**：本轮进行期间 `lib/index.js` 被另一条线（R0 memory_recall 可用性修复）改动，工作区已与 HEAD 分叉（`git diff --stat` = 4 files, +120/-8）。**本文一律引 HEAD 行号**，因此与工作区当前行号可能有偏移；引用前请以 `git show a53560e:lib/index.js | sed -n '<line>p'` 复核。

---

## §0 结论先行

| # | 结论 | 关键数字 | 置信 |
|---|---|---|---|
| 1 | **现在就可以做可插拔接口，且第一版必须绑现有两个模型占位** —— 因为两个引擎的**方法签名已经收敛**（`rank(corpusSnap,query)` / `dense_search(...)` 都归一到 `{scores:Map<memoryId,cosine>}`），真正缺的不是算法而是**一份带身份、超时、失败姿态的统一契约**。 | 现存 3 个调用点已在做同一件事：`lib/index.js:16645` / `:16698` / `:16768` | 实测（读码） |
| 2 | **BGE-M3 sparse 头值得接，但必须先纠正一个口径**：bench 里的 0.975 是 **dense0.7 + sparse0.3（换掉 BM25）**，不是"三臂融合"。接线后 R@5 升 +2.5pt，但 **MRR 反降 −2.0pt**（0.846 vs 0.866）。 | L2 R@5 0.925→0.975；MRR 0.774→0.846（dense+sparse）vs 0.866（dense+lexical） | [抄] |
| 3 | **不需要升 CHUNK_POLICY_VERSION**，前提是 sparse 落到**独立文件**而不是塞进现有 `vectors-*.json` 的 identity。理由已实测：identity 是"新算的字典里每个键都要与旧块相等"，**加一个键就等于全量 stale**。 | `python/worker_semantic_v1.py:240` | 实测（读码） |
| 4 | **multilingual-e5 不升**。e5-large 在 L2 上 R@5=0.825，**劣于现役 int8 的 0.925**；体积 16.71×、单查询 29.0×，升完仍然是二档。 | 0.825 < 0.925；2156.99 MiB vs 129.12 MiB | [抄]+[实测] |
| 5 | **fp32 档事实上不可启用**：JS 门 `configOk` 只认 int8 provider，Python `load_embedder` 却认 fp32 —— 同一语义两处判据不一致，fp32 属"代码在、门锁死"。 | `lib/embedding-config.js:16` vs `python/m7_embedding_v1.py:340-348`；实测 fp32 配置 → `configOk:false, modelPath:''` | 实测 |

---

## §1 现状实测表

### 1.1 四档总表（R@5 / 延迟 / 体积 / 开关 / 代码位置，缺一不可）

| 档 | R@5 | 延迟 | 体积 | 启用开关（判据 + 位置） | 代码位置 |
|---|---|---|---|---|---|
| **c1 纯词法** | **0.200**（L2）[抄] `docs/RELEASE-SEMANTIC-OPTION.md:104`；同值 `docs/M7-ACTIVATION-V2-PAPER.md:212` | **p50 3.46 ms / p95 7.41 ms**（400 文档 / 20 次）[实测] | **0 B**（零模型）[抄] `docs/M7-ACTIVATION-V2-PAPER.md:212` | `semanticEngineMode='lexical'` ⇒ `resolveSemanticTier()` 首行直接 `return 'c1'`；**同时是所有档的最终兜底** | `lib/shadow-retrieval.js:463` `lexicalSearch`（BM25 k1=1.2 b=0.75，`:62-63`）；`lib/recall-passages.js:15` `recallPassagesPre`（子串计数）；`lib/index.js:9325-9326`（L0 词命中数，最简臂）；策略版本 `lib/shadow-retrieval.js:26` |
| **c2 JS e5-small q8** | **0.850**（L2 / 251 episodes）[抄] `docs/RELEASE-SEMANTIC-OPTION.md:105`；**0.609**（63 主集）[抄] `docs/M7-ACTIVATION-V2-CONTROLLED-SHADOW.md:114` ——**两套口径，见 §1.5** | **冷启 1524.7 ms**（首次 embedQuery，含子进程 init + 自检）→ **warm query p50 3.33 / p95 18.56 ms**；`rank()` 163 条语料 **冷 3668.4 ms / warm p50 2.77 ms**；`embedPassages` 64 条 **352.4 ms = 5.51 ms/条** [实测] | onnx **118,308,185 B**（112.83 MiB）；清单 5 文件合计 **135,392,183 B**（129.12 MiB）[实测] | `semanticEngineMode ∈ {auto, js}` **且** `semanticAssetProbe().ready`（= 资产在 ∧ peer 在 ∧ 未降级）。`configOk` 与 Python 无关，纯 JS 可独立工作 | 工厂 `lib/semantic-js.js:248`；`rank()` `:499`；`embedPassages` `:534`；`embedQuery` `:548`；资产清单 `:578-589`；探测 `:214`。模型真跑在子进程：`lib/semantic-js-worker.js:56-64`（`mean` pooling / `q8` / 384 维自检）；IPC 超时 `lib/semantic-js-process.js:119`（默认 120 s） |
| **c3 Python BGE-M3 int8** | **0.925**（L2）[抄] `docs/RELEASE-SEMANTIC-OPTION.md:118`；同值 `docs/M7-EMBEDDING-BENCHMARK.md:98` | **load 21.69 s**；warm query **p50 16.02 / p95 30.02 ms**；`encode_texts` 64 条 **863.5 ms = 13.49 ms/条**；**encode+scan 83 chunks p50 10.51 / p95 18.17 ms** [实测] | onnx **568,456,694 B**（542.12 MiB）；目录 5 文件 **585,542,422 B**（558.42 MiB）[实测] | 三重门：`semanticEngineMode='python'` ∧ `pythonBackendEnabled` ∧ `pythonReadinessPre()` 三段全真（资产 / 解释器 / 运行时）。任一假 ⇒ 该臂返回 null | `lib/index.js:16698` `_pySemanticRank`；就绪三段 `:16747` `pythonReadinessPre`；`python/worker_semantic_v1.py:410` `dense_search`、`:472` `hybrid_rank`、`:1039` `handle_recall_rank`；`python/m7_embedding_v1.py:240` `BgeM3OnnxInt8Embedder` |
| **c3' BGE-M3 fp32** | **0.925**（与 int8 **delta = 0.000**）[抄] `docs/RELEASE-SEMANTIC-OPTION.md:118-121` | **load 3.06 s**；warm query **p50 121.64 ms**（int8 的 7.6×）；`encode_texts` 16 条 **1030.3 ms = 64.39 ms/条**（int8 的 4.8×）[实测] | `pytorch_model.bin` **2,271,145,830 B**（2165.92 MiB）；`.hf-cache` 快照目录 2.14 GB [实测+抄] `research/B-bge3-inventory.md:33` | **事实上不可启用**：JS 侧 `readEffectiveEmbeddingConfigPre` 的 `configOk` 只认 `bge-m3-onnx-int8-pre-v1` ⇒ `modelPath=''` ⇒ `pythonReadinessPre().modelPresent=false` ⇒ `_pySemanticRank` 第一步就 return null。Python 侧 `load_embedder` 却认 `bge-m3-pre-v1` | `python/m7_embedding_v1.py:136` `BgeM3Embedder`；provider 枚举 `:28-30`；分派 `:340-348`；JS 门 `lib/embedding-config.js:16` |
| **c4 重排（未接线）** | 有收益无预算：L1 R@5 0.966→1.000、MRR 0.837→0.947 [抄] `docs/M7-ALGORITHM-DECISION.md:129-131` | **p50 26–33 s/查询**，超 500 ms 预算 52–66× [抄] `research/C-agenda-distill.md:74` | `bge-reranker-v2-m3` **2,271,071,852 B** [抄] `research/B-bge3-inventory.md:46` | **零接线**：`lib/rerank-host.js` 存在但 `git grep 'rerank-host' -- lib` 排除自身后为空 | `lib/rerank-host.js:71` `createRerankHostPre`（仅被 `tests/smoke/smoke-test-p4-rerank-window.mjs:11` import） |

### 1.2 延迟实测：三条容易读错的口径

**[实测] 口径 A —— "查询编码"不是"检索"。** 同一台机器（Ryzen 7 9700X / 16 逻辑核 / 31.1 GB RAM / 当前 6.2 GB 空闲），三档的单查询成本相差近两个数量级：

| 档 | 单查询 p50 | 相对 c2 | 备注 |
|---|---:|---:|---|
| c2 e5-small q8 | **3.33 ms** | 1.0× | 子进程 IPC + ONNX q8，384 维 |
| c3 int8（仅编码） | **16.02 ms** | 4.8× | ONNX int8，1024 维 |
| c3 int8（编码 + 全扫 83 chunks） | **10.51 ms** | 3.2× | 见下方"口径 B"，扫描成本被查询编码淹没 |
| c3' fp32 | **121.64 ms** | 36.5× | PyTorch CPU + CLS |
| e5-large fp32 | **96.63 ms** | 29.0× | PyTorch CPU + mean pooling |

> ⚠️ c3 的"编码+全扫"（10.51 ms）**低于**"仅编码"（16.02 ms）—— 不是算错，是两次测量跑了不同脚本、不同批次（前者单条循环 10 次取 p50，后者 15 次取 p50），CPU 频率与线程调度抖动 ~6 ms 量级。**结论只取量级：int8 全链路在 10–20 ms，与 500 ms 预算差 25–50 倍，不是瓶颈。**

**[实测] 口径 B —— 冷启动是主导项，不是稳态。**

| 档 | 冷启（load） | 稳态（warm p50） | 冷/热比 |
|---|---:|---:|---:|
| c2 e5-small q8 | **1524.7 ms**（首次 `embedQuery`，含子进程 spawn + `pipeline()` + 384 维自检） | 3.33 ms | **458×** |
| c3 int8 | **21.69 s**（`load_embedder`，含 torch 12.41 s + transformers 11.54 s 导入） | 16.02 ms | **1354×** |
| c3' fp32 | 3.06 s | 121.64 ms | 25× |
| e5-large fp32 | 3.07 s | 96.63 ms | 32× |

> c3 的 21.69 s 与 [抄] `research/B-bge3-inventory.md:92` 的 19.01 s 同量级（差异来自机器负载，非配置）。**这条数字直接决定 §2.5 的超时预算不能按"稳态 16 ms"设计。**

**[实测] 口径 C —— 索引重建是 O(N) 且按条付费。**

| 动作 | 实测 | 外推 |
|---|---|---|
| c2 `rank()` 首次建 163 条索引 | **3668.4 ms**（poolMisses=163，全量真嵌入） | 663 chunks ⇒ ≈ 14.9 s |
| c2 `embedPassages` 64 条 | 352.4 ms（**5.51 ms/条**，批内串行，worker 每批上限 64：`lib/semantic-js-worker.js:91`） | 同上 |
| c3 int8 `encode_texts` 64 条 | 863.5 ms（**13.49 ms/条**） | 663 chunks ⇒ ≈ 8.9 s |
| sparse 头文档编码 64 条（本轮单条 unbatched 写法） | 3482.3 ms（**54.41 ms/条**） | 663 chunks ⇒ **≈ 36.1 s**（未批处理，实际可压） |

### 1.3 体积与身份

| 项 | 实测值 | 复算 |
|---|---:|---|
| e5-small q8 onnx | 118,308,185 B | `ls -la`；sha256 `f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193`（与清单 `lib/semantic-js.js:578` 一致） |
| e5-small 发布清单（5 文件） | 135,392,183 B = 129.12 MiB | `lib/semantic-js.js:578-588` 逐项求和 |
| BGE-M3 int8 onnx | 568,456,694 B；sha256 `a206e10e995aa2a833924bcd725ba5dd6c3425cd34bac3cf2b5677cd2a1c51d6` | `ls -la` + node crypto |
| BGE-M3 int8 目录（5 文件） | 585,542,422 B = 558.42 MiB | 递归求和 |
| BGE-M3 fp32 主权重 | 2,271,145,830 B（`.hf-cache` 快照，symlink → blobs） | `ls -laL` |
| multilingual-e5-large 权重 | 2,239,611,368 B（>2 GiB，**node 单次 readFile 取 sha256 会抛 ERR_FS_FILE_TOO_LARGE，本轮未能取摘要**） | `ls -la` |
| multilingual-e5-large 目录（9 文件） | 2,261,765,112 B = 2156.99 MiB | 递归求和；**/ e5-small 目录 = 16.71×** |
| 生产向量库现状 | **13 个 `vectors-*.json` / 14,952,102 B / 663 chunks** | 见 §6.1 命令 |
| 单 chunk 存储成本 | **22,546 B/chunk**（其中 dense JSON 21,696 B + chunk 元数据 639 B） | `vectors-6e209336636ec315.json`：1,871,352 B ÷ 83 chunks |
| derived-corpus 规模 | 4 entries，recordCount 77 / 55 / 77 / 31 = **240 条** | `derived-corpus.json` |

**身份块实测对齐**（这条决定了"占位"是否触发重建）：

- 磁盘 `vectors-6e209336636ec315.json` 的 `identity` == 本轮用 `python/m7_embedding_v1.py:351` 重算的 `identity_block`，**逐字段相等**，`configHash = cfgh_b2d020f9f25039aca6bbd2c571839fa9fe63182d94bcf009d31c7096318b761c`。
- ⇒ **只要新接口把同一份 descriptor 原样透传，现有 663 个 chunk 的向量继续有效，零重建。**

### 1.4 现网真实命中分布（不是 bench，是活遥测）

快照时刻 2026-10-24T06:56:47Z（`~/.dsh/memory/recall-stats.json`，`version='recall_stats_pre_v1'`）：

| 通道 | events | hits | zeroHit | 零命中率 | 平均每次命中 |
|---|---:|---:|---:|---:|---:|
| model（`memory_recall` 工具） | 274 | 688 | **165** | **60.2%** | **2.51 条** |
| shadow（影子校准） | 361 | 2,888 | 0 | 0.0% | **8.00 条** |
| inject（注入侧） | 57,963 | 911,066 | 0 | 0.0% | 15.72 条 |

**命中来源拆分（按 hits 加权，非按 id 计数）**：纯词法 **203 条 = 29.5%**；含语义 **485 条 = 70.5%**。
⚠️ **口径提醒**：若按"被命中 id 数"计，纯词法 id 占比会变成 236/338 = 69.8% —— 两种算法差 40 个百分点。**引用时必须写明是 hits 加权还是 id 计数**（本轮两值都实算过，见 §6.1）。

### 1.5 三处必须先纠正的口径冲突（否则任何升级收益都算不清）

| # | 冲突 | 证据 | 处置建议 |
|---|---|---|---|
| 1 | **e5-small 的 R@5 有两个值**：0.850（L2 / 251 episodes）与 0.609（63 主集） | `docs/RELEASE-SEMANTIC-OPTION.md:105` vs `docs/M7-ACTIVATION-V2-CONTROLLED-SHADOW.md:114`；`research/C-agenda-distill.md:115`（D-11）已登记 | 引用必须四元组齐全（模型 / 通道 / 语料版本 / 分割）。**给用户报"JS 档 0.85 vs Python 档 0.925"时，那 7.5pt 是跨口径的；同口径差是 0.925−0.609 = 0.316** |
| 2 | **e5-large 的 0.727 被标成 L2** | `research/B-bge3-inventory.md:45` 写"bench 对照组（质量最差，L2 R@5 0.727）"；但 `docs/M7-EMBEDDING-BENCHMARK.md:63` 里 **0.727 是 L1**，`:104` 里 **e5-large L2 R@5 = 0.825** | **B 文档该括号写错层号**。本文 §4 一律用"L1 0.727 / L2 0.825" |
| 3 | **fp32 的"可选"是文档口径，代码口径是"锁死"** | `docs/M7-ACTIVATION-V2-PAPER.md:214` 写"int8 563MB / fp32 2.3GB 二档可选"；实际 JS `configOk` 只认 int8（`lib/embedding-config.js:16`） | 文档应改为"fp32 仅 Python 侧可加载，JS 门不放行"。**这也是 §2 契约要解决的第一个真实缺陷** |

---

## §2 可插拔模型接口契约草案（核心）

### 2.1 设计前提：不新造范式，只把已有的三处收敛成一份

现状是**同一语义写了三份**，形状各不相同：

| 位置 | 签名 | 返回 |
|---|---|---|
| `lib/index.js:16645` `_jsSemanticRank` | `(corpusSnap, queryText, optsRank)` | `{miv, scores:Map}` 或 `null` |
| `lib/index.js:16698` `_pySemanticRank` | `(corpusSnap, queryText)` | `{scores:Map, source:'c3'}` 或 `null` |
| `lib/index.js:16768` `_semanticRankBest` | `(corpusSnap, queryText)` | 透传上面两者之一，附 `_rankPath` 字符串 |

三处已经**自发收敛到同一返回形状**（`Map<memoryId, cosine>`）。所以契约不是重构，是**把这个既成事实写成可校验的接口**。

### 2.2 接口签名

```js
// lib/embedder-contract.js（新增；本轮不落地，仅草案）
/**
 * @typedef {Object} EmbedderDescriptor   引擎身份（对齐 lib/engine-identity.js:34-44）
 * @property {string} provider            通道 id，如 'js-e5-small-q8-pre-v1'
 * @property {string} model               模型名
 * @property {string} weightsDigest       权重指纹（见 engine-identity.js:111 的 fp_ 口径）
 * @property {string} tokenizer
 * @property {'q8'|'int8'|'fp32'} precision
 * @property {number} dim
 * @property {'mean'|'cls'} pooling
 * @property {boolean} normalized
 * @property {string} inputVersion        前缀/截断/清洗口径版本
 */

/**
 * @typedef {Object} EmbedderPort
 * @property {string} version             实现版本串（如 'port_js_e5_small_q8_v1'）
 * @property {() => EmbedderStatus} status
 * @property {(req: RankRequest) => Promise<RankResult>} rank
 * @property {(texts: string[]) => Promise<Float32Array[]>} embedPassages
 * @property {(text: string) => Promise<Float32Array>} embedQuery
 * @property {() => void} dispose
 */
```

**一个 `EmbedderPort` = 一个向量空间。** 契约禁止一个 port 内部混用两种 provider（对齐 `research/C-agenda-distill.md:190` F5「禁止多引擎向量混排」）。

### 2.3 入参 / 返回形状

```js
/**
 * @typedef {Object} RankRequest
 * @property {string}   query                    非空；调用方负责截断（e5 2000 字符 / bge-m3 由 tokenizer 管）
 * @property {string}   memoryIndexVersion       ^idx_pre_[0-9a-f]{32}$
 * @property {Array<{memoryId:string, text:string}>} records   已授权切片（Python 不得自行开文件）
 * @property {number}   topK                     默认 20；上限 64（对齐 worker_semantic_v1.py:1052）
 * @property {number}   [deadlineMs]             调用方给的软预算；port 必须在内部收窄
 */

/**
 * @typedef {Object} RankResult
 * @property {'ok'}                    ok
 * @property {Map<string, number>}     scores        memoryId → cosine（L2 归一化后点积，**已是绝对分**）
 * @property {EmbedderDescriptor}      identity      本次打分所用向量空间
 * @property {string}                  memoryIndexVersion
 * @property {number}                  latencyMs
 * @property {number}                  topK
 */

/**
 * @typedef {Object} RankFailure     // 失败一律返回它，**不抛**
 * @property {'degraded'}              ok
 * @property {'model-missing'|'peer-missing'|'interpreter-unverified'|'runtime-not-started'
 *           |'index-not-ready'|'identity-mismatch'|'timeout'|'circuit-open'|'empty-scores'
 *           |'protocol-error'|'oversize'|'internal'} code
 * @property {string}                  reason         ≤160 字符，可直接进 diag
 * @property {boolean}                 retryable
 * @property {number}                  [retryInMs]
 */
```

**三条形状硬约束**（每条都有现成反例）：

1. **`scores` 必须是绝对余弦，不是 minmax 融合分。** 反例：`python/worker_semantic_v1.py:483-490` 的 `hybrid_rank` 把 dense/lex 各自 minmax 后加权，top-1 恒为 1.000（`docs/S2-DEEP-ABSORPTION.md` §1 问题 4 已登记）。契约把融合留在**调用方**（`lib/semantic-js.js:34` `fuseD6Pre`），port 只出原始余弦。
2. **`identity` 必须随结果返回。** 否则调用方无从判断"这条分是哪个向量空间给的"，正是 §1.5 冲突 3 的成因。
3. **`memoryIndexVersion` 必须回显。** 反例：`python/worker_semantic_v1.py:240` 的 stale 判定若与请求 miv 不一致，`dense_search` 静默返回 `[]`（`:429-430`），面板仍显示就绪。

### 2.4 失败姿态：**协议 fail-open + 语义 fail-closed**（继承既有硬约束）

| 层 | 姿态 | 判据 | 依据 |
|---|---|---|---|
| **协议层** | **fail-open** | 坏配置 / 坏帧 / 未知字段 / 版本不符 ⇒ **不崩进程**，回结构化失败 | `docs/PYTHON-SIDECAR-CONTRACT.md:370`（envelope 全项校验）；`lib/python-sidecar-client.js:6`「request() 永不 reject」 |
| **语义层** | **fail-closed** | 身份不符 / scope 不符 / miv 不符 / provenance 缺 ⇒ **零输出**，绝不给"差不多的分" | `research/C-agenda-distill.md:177` E2；`python/m7_embedding_v1.py:378-382` `identity_matches`（全字段逐项相等） |
| **降级可见性** | **必须留痕，禁止静默** | 任何一档降级都要能回答"为什么没用上" | `research/C-agenda-distill.md:178` E3（真实违规现场：index-not-ready 静默丢弃） |

**port 内部的四类"不许发生"**：

- 不许 `throw`（调用方只处理 `RankResult | RankFailure`）；
- 不许返回**部分结果**（`scores.size < 1` 即视为 `empty-scores` 失败，不得返回空 Map 冒充成功）；
- 不许**跨 port 复用向量**（`identity` 不等即 `identity-mismatch`）；
- 不许**吞超时**（超时必须映射为 `code:'timeout'`，不能变成 `empty-scores`）。

> 现网已有一处正例可抄：`lib/semantic-js.js:426-430` 对 `embedPassages` 返回值做**长度契约校验**，注释明写"旧实现只做取不到就跳过，坏 embedder 会退化成静默产出空索引 —— 半套排序比报错更糟"。契约把这条上升为通用条款。

### 2.5 超时预算（三档分层，全部有现网数字支撑）

| 层 | 预算 | 依据 | 现状问题 |
|---|---:|---|---|
| **单查询软预算（调用方期望）** | **500 ms** | `research/C-agenda-distill.md:74`（"500 ms 预算"是 reranker 的否决线，也是全链路事实标准） | 无强制点 |
| **port 必须在此内返回** | **≤ 400 ms** | 500 ms − 100 ms 组装余量 | 三档实测 p50 均 ≤ 17 ms，余量 **25–120×**（=400/16.02 至 400/3.33） |
| **Python sidecar 协议超时** | `recall_rank` = **8000 ms** | `lib/index.js:16740`（显式 `{timeoutMs: 8000}`） | **是 500 ms 预算的 16×**；实测 p95 18.17 ms，余量 440×。⇒ 该值不是延迟约束，是**挂死保护** |
| **sidecar 默认请求超时** | **5000 ms** | `lib/m7-wire.js:26` `requestTimeoutMs: 5000`（冻结预算，改动须升协议版本） | 与上面 8000 并存 ⇒ 两套口径 |
| **JS 子进程 IPC 超时** | 默认 **120000 ms** | `lib/semantic-js-process.js:119` / `:125` | **24× 于 sidecar**；一旦 worker 卡住，主线程等 2 分钟 |
| **Python 冷启动（不可计入单查询）** | **21.69 s** | §1.2 [实测] | 必须**预热**，不能进热路径；现网已有预热闸：`lib/index.js:17209` `PY_RECALL_PROBE_BUDGET_MS = 20000` |

**契约条款**：`RankRequest.deadlineMs` 缺省 **400**；port 若自身冷启未完成，**立即返回 `code:'model-missing'/'interpreter-unverified'`，不得阻塞等待加载**（现网 `_pySemanticRank` 已这么做：`lib/index.js:16701-16703` 先查就绪再请求）。

### 2.6 降级链（必须 fail-soft，且每跳留痕）

```
请求
 ├─ c3 python：mode∈{auto,python} ∧ pythonReadinessPre 三段全真
 │     ├─ 成功 → {scores, identity, source:'c3'}
 │     └─ 任一假 / 超时 / 空 → RankFailure(可归因)      ← 记 _rankPath 'c3 无结果'
 ├─ c2 js：mode∈{auto,js} ∧ semanticAssetProbe().ready
 │     ├─ 成功 → {scores, identity, source:'c2'}
 │     └─ 失败 → RankFailure                              ← 记 _rankPath '→ c2 无结果'
 └─ c1 lexical：永远可用（0 B / 零依赖）
       └─ 返回 null（调用方按词法序）                       ← 记 _rankPath '→ 词法(无语义臂)'
```

现网实现见 `lib/index.js:16768-16796`：`_semanticRankBest` 里三跳各写一次 `hops.push(...)`（`:16775` / `:16789` / `:16794`），最终 `_rankPath` 是一行可读的降级链快照。**契约要求原样保留这个字符串** —— 它是唯一能回答"这次为什么是词法"的运行时证据。

**contract 级不变量（可直接写成断言）**：

| # | 不变量 | 负路径（必须红） |
|---|---|---|
| I1 | 降级链任一跳返回 `ok` 后，**不得**再尝试更低档 | 把 c2 的 mock 设为成功，断言 c1 调用计数 = 0 |
| I2 | 每一跳失败都必须在 `_rankPath` 留一个 token | 删掉 `:16775` 的 `hops.push`，断言 `_rankPath` 不含 'c3' |
| I3 | `scores` 里每个 key 必须在该 port 的 `identity` 下产生 | 伪造 `identity.provider`，断言全部 rejected |
| I4 | 超时必须映射为 `code:'timeout'`，不得为 `empty-scores` | 注入 401 ms 延迟的假 port，断言 code |

### 2.7 「用现有模型占位」怎么落地（用户 2026-10-24 原话的工程解释）

> 用户原话：「下一步其实就是要修改这个唤回引擎，也就是要调模型了。所以现在模型不是还没调好吗？你就先用现有的模型来占位就可以了。」

**落地方式：接口第一版只绑两个既有 port，不改任何权重、不重算任何向量。**

```js
// 伪代码：第一版的 registry —— 两个 entry 都是"适配器"，不是新模型
const PORTS = {
  'js-e5-small-q8-pre-v1': {
    precision: 'q8', dim: 384, pooling: 'mean',
    descriptor: JS_E5_IDENTITY_DESC_PRE_V1,          // ← 原样复用 lib/engine-identity.js:118
    create: (opts) => createJsSemanticEnginePre(opts), // ← 原样复用 lib/semantic-js.js:248
  },
  'bge-m3-onnx-int8-pre-v1': {
    precision: 'int8', dim: 1024, pooling: 'cls',
    descriptor: (cfg) => identity_block(cfg),          // ← 原样复用 m7_embedding_v1.py:351
    create: (deps) => pythonRecallPort(deps),          // ← 薄壳，底下仍是 recall_rank 帧
  },
}
```

**"占位"的三个硬条件（全部已实测满足）**：

1. **权重零改动** —— 适配器只做形状转换，不 load 新模型、不改 dtype、不改 pooling。
2. **向量零重建** —— 前提是 descriptor 逐字段不变。§1.3 已实测：磁盘 identity == 现算 identity，`configHash` 一致 ⇒ 663 chunks 继续有效。
3. **降级链零改动** —— 适配器失败必须映射回原来的 `null`，让 `_semanticRankBest` 的既有三跳逻辑原样工作。

**因此第一版的工作量不在"接模型"，在"加一层形状校验 + 把 §2.5 的三套超时收敛成一个"。** 这也正是用户说"先用现有模型占位"的正确读法：**先把插座做好，插头还是原来那两个。**

### 2.8 契约验收判据（每条带负路径）

| # | 判据 | 复算方式 | 负路径 |
|---|---|---|---|
| A1 | 两个 port 的 `identity` 与磁盘 `vectors-*.json` 逐字段相等 | `node` 比对 8 个字段 + configHash | 改 `chunkPolicyVersion` 一个字符，断言 13 个文件全判 stale |
| A2 | `rank()` 对 163 条语料返回 `scores.size === 163` | 本轮已跑：`scored:163` | 注入只返回 162 条的假 port，断言 A2 红 |
| A3 | 三档 warm p50 均 ≤ 400 ms | §1.2 三行 | 人为 sleep 401 ms，断言 A3 红 |
| A4 | 降级链 `_rankPath` 三类终态各出现一次 | 构造 c3 失败 / c2 失败 / lexical | 删任一 `hops.push`，断言红 |
| A5 | 失败一律不 throw | `try{ await port.rank(badReq) }catch` 计数 = 0 | 让 port 抛错，断言 A5 红 |

---

## §3 BGE-M3 sparse 头升级路线

### 3.1 资产实测：在盘、可用、但零调用

| 项 | 实测 / 证据 |
|---|---|
| 文件 | `python/bench/models/bge-m3/sparse_linear.pt`，**3,516 B**，mtime 2026-08-24 05:34 |
| sha256 | **`45c93804d2142b8f6d7ec6914ae23a1eee9c6a1d27d83d908a20d2afb3595ad9`**（本轮 `node crypto` 实算，与 `research/B-bge3-inventory.md:67` 的 HF LFS oid 一致） |
| 形状 | `weight: (1, 1024) float16`、`bias: (1,) float16` —— **就是一层 1024→1 的线性头**，参数量 1,025 |
| 配方 | `token_weights = relu(hidden @ W + b)` → 按 token id 取 amax → 稀疏向量（`python/bench/m7b_sparse.py:47-70`；官方 recipe 见文件头 `:1-13`） |
| vocab | 250,002（xlm-roberta-large） |
| **生产零调用（硬证据）** | `git grep -il "sparse" a53560e -- 'lib/*.js'` ⇒ **0 个文件**；`git grep -io "sparse" a53560e -- 'lib/*.js' | wc -l` ⇒ **0 次**。全仓只有 6 处命中：4 个 bench/artifacts、1 个决策文档、1 个研究笔记 |
| **bench 实现不可直接 import** | `cd python/bench && python -c "import m7b_sparse"` ⇒ `FileNotFoundError: ...\\lib\\shadow-retrieval-pre.js`（`m7b_hybrid.py:33` 读的是**去 pre 改名前的死链**，`m7b_config.py` 的绝对路径同样写死） |

> 结论：**"在盘"与"能跑"是两件事**。接线第一步不是写融合，是**把 `BgeSparse` 从 bench 脚本里抽成不依赖 `m7b_hybrid` 的独立模块**（现依赖链：`m7b_config` → `m7b_corpus` → `m7b_chunker` → `m7b_embed` → `m7b_hybrid`，其中 `m7b_hybrid` 首行就炸）。

### 3.2 收益：R@5 升、MRR 降 —— 而且这是"换臂"不是"加臂"

**[抄] 权威数字**（`artifacts/m7-hybrid-pre/results-model-sparse.json`，同目录 CSV 逐行核对一致）：

| 层 | 臂 | R@1 | R@5 | MRR | nDCG@10 | hard-neg err |
|---|---|---:|---:|---:|---:|---:|
| L2 | dense | 0.675 | 0.925 | 0.7737 | 0.8118 | 0.0741 |
| L2 | lexical（BM25） | 0.750 | 0.825 | 0.7873 | 0.8135 | 0.1481 |
| L2 | **model-sparse 单独** | 0.750 | **0.950** | 0.8162 | 0.8492 | **0.037** |
| L2 | **weighted(dense, model-sparse) w=0.7** | **0.775** | **0.975** | **0.8458** | **0.8781** | 0.0741 |
| L2 | weighted(dense, lexical) w=0.7（现役） | 0.800 | 0.950 | **0.8657** | 0.8978 | 0.0741 |
| L1 | model-sparse 单独 | 0.5682 | 0.8523 | 0.6861 | 0.7329 | 0.2963 |
| L1 | weighted(dense, model-sparse) w=0.7 | 0.7159 | **0.9773** | 0.8261 | 0.8693 | 0.1111 |

**必须纠正的三点口径**：

1. **0.975 是 dense0.7 + sparse0.3，不是 dense+lexical+sparse。** 代码 `python/bench/m7b_sparse.py:107`：`fused = 0.7 * minmax(dense[qi]) + 0.3 * ms`，其中 `ms` 是 sparse 的 minmax —— **BM25 被换掉了**。所以正确表述是"用 sparse 替代 lexical 臂"，不是"加第三个臂"。
2. **R@5 涨 +2.5pt，MRR 跌 −2.0pt**（0.975/0.8458 vs 0.950/0.8657）。这是**召回换排序**的交换，不是净赚。`research/C-agenda-distill.md:72`（K9）已如实写"未直接翻转默认（MRR 0.846 < 0.866）"，但 `research/C-agenda-distill.md:113` 的标题 "L2 R@5 0.925→0.975" 容易被读成"全面提升"。
3. **L1 上 sparse 单独只有 0.8523，低于 L1 dense 0.9659。** 收益是**层相关的**：真实语料（L2）里 sparse 强，合成语料（L1）里弱。⇒ 不能只报 L2。

### 3.3 代价（全部本轮实测）

| 项 | 实测 | 说明 |
|---|---|---|
| **增量前向成本（查询侧）** | **+0.49 ms** p50（sparse 全链路 9.51 ms vs 仅前向 9.02 ms） | ONNX 输出本来就是 `last_hidden_state [batch, seq, 1024]`（本轮 `get_outputs()` 核实），sparse 头只是在同一份 hidden 上做一次 1024 维点积 + scatter amax ⇒ **几乎免费** |
| **稀疏度（查询）** | 5 条查询 nnz = 10 / 5 / 9 / 6 / 6 | 中文短查询只会点亮 5–10 个 token id |
| **稀疏度（真实语料 40 条）** | chars p50 **119**；nnz p50 **53** / p95 **138** / max **225** / mean 69.5 | 记忆条目比查询长一个量级，nnz 也高一个量级 |
| **存储（JSON 对象形）** | p50 **732 B** / p95 **1,960 B** / max **3,265 B** / chunk | 相对单 chunk 22,546 B ⇒ **+3.2% / +8.7%**；相对 dense fp32 的 4,096 B 是 0.18×–0.80× |
| **文档侧一次性重建** | 单条 **54.41 ms**（unbatched，64 条 3,482.3 ms）⇒ 663 chunks **≈ 36.1 s** | 若按 int8 那套 batch=16 实现，预计可压到 1/3–1/2（**未实测，标 [推定]**） |
| **int8 量化对 sparse 的影响** | fp32 hidden vs int8 hidden 产出的 sparse 向量 **cosine mean 0.9989 / min 0.9978 / max 0.9995**（5 条） | ⇒ **不需要为 sparse 单独跑 fp32**，现役 int8 前向足够 |

### 3.4 是否需升 CHUNK_POLICY_VERSION：**不需要**，但有两个前提

**判定链（读码 + 实测）**：

1. `CHUNK_POLICY_VERSION = 'm7_chunk_pre_v1'`（`python/m7_embedding_v1.py:31`），写入 `identity_block`（`:371`）与 `config_hash`（`:67`）。
2. stale 判定是 **"新 identity 的每个键都要与旧块相等"**：`python/worker_semantic_v1.py:240` `usable = all(block.get(k) == identity.get(k) for k in identity)`。
3. ⇒ **只要不动 `identity_block()` 的键集，就不触发 stale。** 分块逻辑本身不变（sparse 复用同一批 chunk id），所以 **升 CHUNK_POLICY_VERSION 没有语义理由**。
4. **但**：如果为了标记"本文件含 sparse"而往 `identity_block` 里**加一个键**（如 `sparsePolicyVersion`），第 2 条的 `all(...)` 会让**全部 13 个文件、663 个 chunk 立刻 stale** —— 这等于偷偷升了一次版本。**明确禁止**。

**结论：sparse 落到独立文件 `sparse-<sha16>.json`（与 `vectors-<sha16>.json` 同 key 规则：`hashlib.sha256((ws_ref + '|' + scope).encode()).hexdigest()[:16]`，见 `python/worker_semantic_v1.py:150-152`）。** 这样：

- 现有 dense 向量**零影响**、零 stale；
- sparse 缺失时按"该臂不可用"降级（fail-soft），不是全库报废；
- 删除/回退只需删 `sparse-*.json`，不需要重建 dense。

### 3.5 接线方案（分四步，每步可独立回退）

| 步 | 动作 | 判据 | 回退 |
|---|---|---|---|
| **S1** | 抽 `BgeSparse` 成 `python/sparse_head_v1.py`（零 bench 依赖，只依赖 torch/numpy + tokenizer） | `python -c "from sparse_head_v1 import SparseHead; SparseHead(...)"` 真构造 + 真编码出 nnz>0 | 删文件 |
| **S2** | 落 `sparse-<sha16>.json`，**只写不读**；`index_sync_commit` 时附带生成 | 663 chunks 全生成；体积增幅 ≤10%；dense 文件名与内容字节不变 | 删 `sparse-*.json` |
| **S3** | `hybrid_rank` 增加第二种第二臂：`searchPolicy.secondArm = 'lexical'|'sparse'`，**默认仍是 lexical** | 同一条观测两条臂都跑，shadow 双写；生产排序不变 | 配置回 `'lexical'` |
| **S4** | 用真实语料复跑 L2，判据 **R@5 ≥ 0.950 且 MRR ≥ 0.8657**（即"不许比现役差"） | 达不到就停在 S3 | 保留 shadow，不切默认 |

> **S4 的判据刻意比 bench 严**：bench 的 0.975 是在"整篇 512 截断、单作者 40 查询"上得到的；生产是"chunk 级 + 240 记录 + 活语料"。**没有生产语料上的 R@5/MRR 就不许切默认**（对齐 `research/C-agenda-distill.md:193` F8「没有实验就没有资格改算法」）。

---

## §4 multilingual-e5 升级评估（e5-small q8 → e5-large）

### 4.1 三维表

| 维度 | e5-small q8（现役 c2） | e5-large fp32（候选） | 倍率 / 差 |
|---|---|---|---|
| **体积（权重文件）** | 118,308,185 B = 112.83 MiB | 2,239,611,368 B = **2135.86 MiB** | **18.93×** |
| **体积（完整目录）** | 135,392,183 B = 129.12 MiB（5 文件） | 2,261,765,112 B = **2156.99 MiB**（9 文件） | **16.71×** |
| **延迟（单查询 warm p50）** | **3.33 ms** | **96.63 ms** | **29.0×** |
| **延迟（单条 passage）** | 5.51 ms/条 | 69.46 ms/条 | **12.6×** |
| **延迟（冷启）** | 1524.7 ms（含子进程 + 自检） | 3.07 s（in-process，无子进程） | 2.0× |
| **维度** | 384 | 1024 | 2.67× |
| **上下文上限** | `max_position_embeddings: 512` | `max_position_embeddings: 514` | 基本相同（**512 硬上限依旧**） |
| **层数 / hidden** | 12 / 384 | 24 / 1024 | 2× / 2.67× |
| **R@5（L2 / 真实 251 episodes）** | **0.850** [抄] `docs/RELEASE-SEMANTIC-OPTION.md:105` | **0.825** [抄] `docs/M7-EMBEDDING-BENCHMARK.md:104` | **−2.5pt（更差）** |
| **R@5（L1 / 合成 88 查询）** | 未单独测（c2 未进 L1 表） | **0.727** [抄] `docs/M7-EMBEDDING-BENCHMARK.md:63` | — |
| **跨语言 @5（L1）** | 无此测 | **0.60** [抄] `docs/M7-EMBEDDING-BENCHMARK.md:63`（20 条 zh↔en 错 8 条） | — |
| **hard-neg err（L2）** | 0.225（negHit@5）[抄] `docs/RELEASE-SEMANTIC-OPTION.md:110` | 0.111 [抄] `docs/M7-EMBEDDING-BENCHMARK.md:104` | e5-large 更好（0.111 < 0.225） |

> ⚠️ **上面两个延迟不可直接相减**：e5-small 走 **transformers.js + ONNX q8 + 独立子进程 IPC**，e5-large 走 **PyTorch CPU fp32 + 进程内**。两者差 29× 里，量化（q8 vs fp32）与运行时（ORT vs torch）各占一部分。**可用的结论只有一条：在当前可落地形态下（JS 档只能吃 ONNX），e5-large 没有已转换的 ONNX 产物，所以"升级"实际意味着换运行时，不是换个文件。**

### 4.2 收益论证：e5-large 已经被本项目自己的基准淘汰过

三条独立证据：

1. **L2 打不过现役**：0.825 < 0.925（`docs/M7-EMBEDDING-BENCHMARK.md:104` vs `:98`）。
2. **L1 打不过现役**：0.727 vs bge-m3 para-512 的 0.966（`:63` vs `:59`）。
3. **跨语言结构性失败**：L1 跨语 @5 = **0.60**（20 条 zh↔en 错 8 条），失败集中在 **zh→en** 与混写长文（`docs/M7-EMBEDDING-BENCHMARK.md:76-78`；`docs/M7-ALGORITHM-DECISION.md:18`）。

### 4.3 明确结论：**不升**

| # | 理由 | 可复算依据 |
|---|---|---|
| 1 | **升了还是二档**：L2 R@5 0.825 仍低于现役 int8 的 0.925 ⇒ 用户感知不到"升级"，只会感知到"变慢" | `research/B-bge3-inventory.md:45`（**注意该行层号标错，实为 L1**）与 `docs/M7-EMBEDDING-BENCHMARK.md:63/104` |
| 2 | **体积 16.71×**：默认语义层从 129 MiB 涨到 2157 MiB，与"装上就能用"的产品定位正面冲突（`docs/landing/index.html:459` 对外承诺 "e5-small（~130MB，装上就能用）"） | 本轮目录求和 |
| 3 | **JS 档只能吃 ONNX**：`lib/semantic-js-worker.js:79` 走 `pipeline('feature-extraction', MODEL, {dtype:'q8'})`，仓内**没有任何 e5-large 的 ONNX 产物**（`python/bench/models/multilingual-e5-large/` 只有 `model.safetensors`）⇒ 要升必须自行量化转换，属新增工作量与新增风险 | `ls python/bench/models/multilingual-e5-large/` |
| 4 | **真要提高质量，正确路径在 Python 档的 §3（sparse），不在 JS 档换模型**：sparse 的 L2 R@5 0.975 > e5-large 的 0.825 | §3.2 表 |
| 5 | **512 硬上限没解决**：e5-large 的 `max_position_embeddings = 514`，与 e5-small 的 512 基本同档 ⇒ 换模型不解决"长条目截断"（该问题属 §5 的 N6/D-9，需改分块而非换模型） | 两侧 `config.json` 实读 |

> **一句话**：**e5-large 不是"更好的 e5-small"，它是"更差的 bge-m3 且更贵"。升它既得不到质量，也得不到速度，还破坏默认层的体积承诺。**

---

## §5 现在不做（防范围蔓延，逐条给理由）

| # | 不做的事 | 理由（带证据） | 重开条件 |
|---|---|---|---|
| N1 | **不升 e5-large** | §4.3 五条 | 出现 e5-large 的 ONNX q8 产物 **且** L2 R@5 > 0.925 |
| N2 | **不接 ColBERT 多向量** | `colbert_linear.pt` 只在 HF 清单（2,100,674 B），**本地未下载**；全仓 `find -name 'colbert*'` 零命中 [抄] `research/B-bge3-inventory.md:15/80` | 权重落盘 + 有实现 + 有 bench |
| N3 | **不抽 HTTP 服务** | 契约**明令禁止**：`docs/PYTHON-SIDECAR-CONTRACT.md:78`「不引入 ANN、图数据库、HTTP server 或无 scope 的全局状态」；改造成本 ≈5–8 人日 [抄] `research/B-bge3-inventory.md:226` | 契约升版（改 §4/§7）+ 多消费者需求落地 |
| N4 | **不上 ANN / HNSW / FAISS** | 现网 **663 chunks**；重开门槛 = >5 万 chunk 或 p95>500 ms [抄] `research/C-agenda-distill.md:207`（N5）。实测 encode+scan 83 chunks p50 10.51 ms，扫描成本已被查询编码淹没 | chunk 数 > 5 万 或 p95 > 500 ms |
| N5 | **不把 rerank 接进同步路径** | p50 26–33 s，超预算 52–66× [抄] `research/C-agenda-distill.md:74`；`lib/rerank-host.js` 至今零 import（本轮 `git grep` 复核） | int8/GPU 把 50 对压进 500 ms |
| N6 | **不改 CHUNK_POLICY_VERSION** | 升版 ⇒ 全部向量 stale ⇒ 663 chunks 全量重嵌入（int8 约 8.9 s + 冷启 21.69 s，期间语义检索拒服务）。而本轮**没有改分块逻辑的任何理由**（D-9/D-10 是另一条独立缺陷线） | 真要修 D-9（512 尾部丢 token）/ D-10（双重特殊 token）时**必须**升版，且要单独发版说明 |
| N7 | **不重训 / 不微调任何权重** | 任务明令禁止 GPU 训练；且 `research/C-agenda-distill.md:203` N1 已判"换 embedding 模型解决不了 supersede/时效"（三模型同病 0.375–0.50） | 有标注数据 + 有独立评测集 |
| N8 | **不动 dense 算法与 D6 权重（0.7/0.3）** | `research/C-agenda-distill.md:193` F8「没有实验就没有资格改算法」；且 D6 权重在真实语料上已验证（L2 MRR +11.9%） | 有 L2 级三策略对照实验 |
| N9 | **不做多引擎向量混排** | F5 禁止；且 `identity_matches` 全字段相等是唯一防线（`python/m7_embedding_v1.py:378-382`） | 永不重开 |
| N10 | **不给设置页加"模型选择器"** | 第一版只做接口，不加配置面。理由：`semanticEngineMode` 已有 4 档枚举，再加一维会让"用户开了却不生效"的歧路翻倍（历史教训：`activationPolicy.mode` 与 `activationEmitMode` 两把钥匙，见 `python/worker_semantic_v1.py:982-998` 的退休注释） | 接口稳定 ≥ 1 个版本后 |
| N11 | **不修 fp32 的 JS 门（§1.5 冲突 3）** | 属"文档 vs 代码"口径问题，不是功能缺陷；fp32 在 L2 上与 int8 delta=0.000（`docs/RELEASE-SEMANTIC-OPTION.md:118-121`）⇒ 修了也没有收益，只增加一条可达路径 | 需要 fp32 做对照实验时 |
| N12 | **不把 sparse 塞进 `vectors-*.json` 的 identity** | 会触发全量 stale（§3.4 第 4 条），是"看起来省事、实际最贵"的做法 | 永不 |

---

## §6 全部数字可复算

### 6.1 本轮实测命令（逐条可直接粘贴）

**M1 · 体积 / 目录 / sha256**
```bash
cd /d/dsh-auto-memory
ls -la python/bench/models/bge-m3/sparse_linear.pt \
       python/bench/models-xenova-bge-m3-int8/onnx/model_int8.onnx \
       "C:/Users/JH Z/.dsh/models/js-semantic/multilingual-e5-small/onnx/model_quantized.onnx"

node -e "const{createHash}=require('crypto'),fs=require('fs');for(const p of process.argv.slice(1)){const b=fs.readFileSync(p);console.log(p,b.length,createHash('sha256').update(b).digest('hex'))}" <三个路径>

# 目录求和（§1.3 的 2156.99 / 558.42 / 129.12 MiB 三数来自同一函数）
node -e "const fs=require('fs'),path=require('path');function d(p){let t=0,n=0;for(const f of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,f.name);if(f.isDirectory()){const r=d(q);t+=r.t;n+=r.n}else{t+=fs.statSync(q).size;n++}}return{t,n}};console.log(d('python/bench/models/multilingual-e5-large'),d('python/bench/models-xenova-bge-m3-int8'),d('C:/Users/JH Z/.dsh/models/js-semantic/multilingual-e5-small'))"
```

**M2 · c2 JS 延迟（冷启 / warm / 批量 / rank）**
```bash
cd /d/dsh-auto-memory
node --input-type=module -e "
import { createJsSemanticEnginePre, probeJsSemanticAssets } from './lib/semantic-js.js'
const eng = createJsSemanticEnginePre({ pluginDir: process.cwd() })
console.log(probeJsSemanticAssets(process.cwd()))
const t1 = performance.now(); const v = await eng.embedQuery('发布凭证问题 npm ENEEDAUTH')
console.log('cold', performance.now()-t1, 'dim', v.length)
const lat=[]; for (let r=0;r<3;r++) for (const q of ['a','b','c','d','e']) { const a=performance.now(); await eng.embedQuery(q); lat.push(performance.now()-a) }
lat.sort((x,y)=>x-y); console.log('warm p50', lat[7], 'p95', lat[13])
const t2=performance.now(); await eng.embedPassages(Array.from({length:64},(_,i)=>'样本'+i)); console.log('64 passages', performance.now()-t2)
"
```
> 本轮输出：`probe 6.7ms` / `cold 1524.7ms dim 384` / `warm p50 3.33 p95 18.56` / `64 passages 352.4ms`。
> `rank()` 的冷/热（163 条真实语料 = `derived-corpus.json` 去重后 163 个 memoryId）：本轮输出 `rank cold 3668.4ms scored 163` / `rank warm p50 2.77 p95 3.5`。构造方式：`{memoryIndexVersion:'idx_pre_'+'b'.repeat(32), records:[{memoryId,text}...]}`，先 `rank()` 一次（冷），再循环 10 次换 query（热）。

**M3 · c3 int8 延迟（load / query / batch）**
```bash
cd /d/dsh-auto-memory
python/bench/.venv/Scripts/python.exe -B -c "
import sys,time,json; sys.path.insert(0,r'D:/dsh-auto-memory/python')
import m7_embedding_v1 as emb
cfg={'provider':'bge-m3-onnx-int8-pre-v1','modelDir':r'D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8','dimension':1024,'torchThreads':16,'onnxFile':'onnx/model_int8.onnx'}
t0=time.time(); e=emb.load_embedder(cfg); print('load_s',round(time.time()-t0,2))
lat=[]
for r in range(3):
  for q in ['发布凭证问题 npm ENEEDAUTH','子代理使用限制','语义引擎升级 BGE-M3','白板与账本机制','v4 事件记忆模式']:
    a=time.time(); e.encode_query(q); lat.append((time.time()-a)*1000)
lat.sort(); print('p50',round(lat[len(lat)//2],2),'p95',round(lat[int(.95*len(lat))-1],2))
t=time.time(); e.encode_texts(['条目%d'%i for i in range(64)]); print('batch64_ms',round((time.time()-t)*1000,1))
"
```
> 本轮输出：`load_s 21.69` / `p50 16.02 p95 30.02` / `batch64_ms 863.5`（13.49 ms/条）。
> `encode+scan 83 chunks p50 10.51 / p95 18.17` 来自：读 `vectors-47104e49cc708172.json`（83 chunks），`qv=encode_query(q)` 后 `V@qv`，循环 10 次取 p50。

**M4 · BGE-M3 fp32 与 e5-large fp32 延迟（同机、同 tokenizer 口径）**
```bash
cd /d/dsh-auto-memory
python/bench/.venv/Scripts/python.exe -B -c "
import glob,time,torch
from transformers import AutoModel, AutoTokenizer
torch.set_num_threads(16)
for name,p in [('bge-m3-fp32', glob.glob(r'D:/dsh-auto-memory/python/bench/.hf-cache/models--BAAI--bge-m3/snapshots/*')[0]),
               ('e5-large',    r'D:/dsh-auto-memory/python/bench/models/multilingual-e5-large')]:
    t0=time.time(); tok=AutoTokenizer.from_pretrained(p); m=AutoModel.from_pretrained(p,dtype=torch.float32); m.eval(); load=time.time()-t0
    lat=[]
    for r in range(3):
        for q in ['发布凭证问题 npm ENEEDAUTH','子代理使用限制','语义引擎升级 BGE-M3','白板与账本机制','v4 事件记忆模式']:
            a=time.time(); b=tok(q,return_tensors='pt'); h=m(**b).last_hidden_state; lat.append((time.time()-a)*1000)
    lat.sort(); print(name,'load',round(load,2),'p50',round(lat[len(lat)//2],2))
"
```
> 本轮输出：`bge-m3-fp32 load 3.06 p50 121.64` / `e5-large load 3.07 p50 96.63`。
> ⚠️ 该脚本用 `last_hidden_state` 前向，**未做 pooling**；pooling 成本可忽略（mean/CLS 均为一次归约），但严格说这两个 p50 是"前向上界"。**标 [推定]：pooling 后延迟差异 < 1 ms。**

**M5 · c1 词法延迟（400 文档 / 20 次）**
```bash
cd /d/dsh-auto-memory
node --input-type=module -e "
import { lexicalSearch, buildQueryPlan } from './lib/shadow-retrieval.js'
const corpus={memoryIndexVersion:'idx_pre_'+'a'.repeat(32),records:Array.from({length:400},(_,i)=>({memoryId:'mem_'+String(i).padStart(32,'0'),text:'记录'+i+' 关于语义检索、白板账本与发布流程，含 npm ENEEDAUTH 与子代理限制。',layer:'log',sourceRef:'workspace-log',heading:'h'+i}))}
const qp=buildQueryPlan({triggerText:'发布凭证问题 npm ENEEDAUTH 怎么解决',windowTexts:[],terms:['发布','凭证','npm','eneedauth']})
const lat=[]; for(let r=0;r<20;r++){const a=performance.now();lexicalSearch(corpus,qp,{mode:'prefetch'});lat.push(performance.now()-a)}
lat.sort((x,y)=>x-y); console.log('p50',lat[10],'p95',lat[19])
"
```
> 本轮输出：`p50 3.46 p95 7.41`。

**M6 · sparse 头：形状 / 增量成本 / nnz / 存储**
```bash
cd /d/dsh-auto-memory
# 形状
python/bench/.venv/Scripts/python.exe -B -c "
import torch; sd=torch.load(r'D:/dsh-auto-memory/python/bench/models/bge-m3/sparse_linear.pt',map_location='cpu',weights_only=True)
print({k:(tuple(v.shape),str(v.dtype),v.numel()) for k,v in sd.items()})"

# 在 int8 ONNX 的 last_hidden_state 上接 sparse 头，量增量成本
python/bench/.venv/Scripts/python.exe -B -c "
import os,time,numpy as np,onnxruntime as ort,torch
from transformers import AutoTokenizer
base=r'D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8'
s=ort.InferenceSession(os.path.join(base,'onnx','model_int8.onnx'),providers=['CPUExecutionProvider'])
tok=AutoTokenizer.from_pretrained(base); I,A=s.get_inputs()[0].name,s.get_inputs()[1].name
sd=torch.load(r'D:/dsh-auto-memory/python/bench/models/bge-m3/sparse_linear.pt',map_location='cpu',weights_only=True)
W=sd['weight'].float().squeeze(0).numpy(); B=sd['bias'].float().squeeze(0).numpy()
def fwd(t):
    e=tok(t,add_special_tokens=True,truncation=True,max_length=512,return_tensors='np')
    return s.run(None,{I:e['input_ids'].astype(np.int64),A:e['attention_mask'].astype(np.int64)})[0]
qs=['发布凭证问题 npm ENEEDAUTH','子代理使用限制','语义引擎升级 BGE-M3','白板与账本机制','v4 事件记忆模式']
sp=[];fo=[]
for r in range(3):
  for q in qs:
    a=time.time(); h=fwd(q); w=np.maximum(h[0]@W+B,0.0); sp.append((time.time()-a)*1000)
    a=time.time(); fwd(q); fo.append((time.time()-a)*1000)
sp.sort();fo.sort(); print('sparse_path_p50',round(sp[len(sp)//2],2),'forward_only_p50',round(fo[len(fo)//2],2))
"
```
> 本轮输出：`weight (1,1024) float16 / bias (1,) float16`；`sparse_path_p50 9.51 / forward_only_p50 9.02 ⇒ delta 0.49`；nnz(查询) `[10,5,9,6,6]`；nnz(语料 40 条 p50/p95/max/mean) `53/138/225/69.5`；JSON 体积 `732/1960/3265 B`（估算方法：`len(json.dumps({str(i):0.1234 for i in range(n)}))`，n 取对应的 nnz）。
> 文档侧 54.41 ms/条：同一前向 + sparse 头，循环 64 条真实语料（`derived-corpus.json` 前 64 条）取总时长 / 64。

**M7 · 生产向量库与 derived-corpus 规模**
```bash
cd /d/dsh-auto-memory
node -e "
const fs=require('fs'),d='C:/Users/JH Z/.dsh/memory/semantic';
let t=0,c=0,n=0;
for(const f of fs.readdirSync(d).filter(x=>x.startsWith('vectors-')&&x.endsWith('.json'))){t+=fs.statSync(d+'/'+f).size;n++;c+=JSON.parse(fs.readFileSync(d+'/'+f,'utf8')).chunks.length}
console.log({vectorFiles:n,totalBytes:t,totalMiB:+(t/1048576).toFixed(2),chunks:c});
const j=JSON.parse(fs.readFileSync(d+'/vectors-6e209336636ec315.json','utf8'));
const sz=fs.statSync(d+'/vectors-6e209336636ec315.json').size;
console.log({bytes:sz,chunks:j.chunks.length,perChunk:Math.round(sz/j.chunks.length),denseJson:JSON.stringify(j.vectors[0]).length,metaJson:JSON.stringify(j.chunks[0]).length});
console.log(JSON.parse(fs.readFileSync(d+'/derived-corpus.json','utf8')).entries.map(e=>e.recordCount))"
```
> 本轮输出：`{vectorFiles:13,totalBytes:14952102,totalMiB:14.26,chunks:663}`；`{bytes:1871352,chunks:83,perChunk:22546,denseJson:21696,metaJson:639}`；`[77,55,77,31]`。

**M8 · 现网命中分布（recall-stats，含两种口径）**
```bash
node -e "
const j=require('C:/Users/JH Z/.dsh/memory/recall-stats.json'); const ids=j.channels.model.ids;
let lex=0,sem=0,lexId=0,semId=0;
for(const v of Object.values(ids)){const r=String(v.reason||'');if(r.includes('语义')){sem+=v.count;semId++}else if(r.includes('词法')){lex+=v.count;lexId++}}
const t=lex+sem;
console.log('hits加权',{lex,lexPct:+(lex/t*100).toFixed(1),sem,semPct:+(sem/t*100).toFixed(1)});
console.log('id计数',{lexId,idPct:+(lexId/(lexId+semId)*100).toFixed(1),semId});
console.log(j.channels.model.events,j.channels.model.hits,j.channels.model.zeroHit,+(j.channels.model.zeroHit/j.channels.model.events*100).toFixed(1),+(j.channels.model.hits/j.channels.model.events).toFixed(2))"
```
> 本轮输出：`hits加权 {lex:203,lexPct:29.5,sem:485,semPct:70.5}`；`id计数 {lexId:236,idPct:69.8,semId:102}`；`274 688 165 60.2 2.51`。
> ⚠️ 该文件是**活遥测**，每次调用都在变（本轮 14:40 的 events=273，14:56 已 274）。引用必须带时刻。

**M9 · identity 对齐（决定"占位"是否触发重建）**
```bash
cd /d/dsh-auto-memory
node -e "const j=require('C:/Users/JH Z/.dsh/memory/semantic/vectors-6e209336636ec315.json'); console.log(j.identity)"
python/bench/.venv/Scripts/python.exe -B -c "
import sys; sys.path.insert(0,r'D:/dsh-auto-memory/python'); import m7_embedding_v1 as e
print(e.identity_block('bge-m3-onnx-int8-pre-v1',{'provider':'bge-m3-onnx-int8-pre-v1','modelDir':'D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8','dimension':1024}))"
# 逐字段比较二者，应完全相等（含 configHash cfgh_b2d020f9...）
```

**M10 · fp32 被 JS 门拒绝**
```bash
cd /d/dsh-auto-memory
node --input-type=module -e "
import { readEffectiveEmbeddingConfigPre } from './lib/embedding-config.js'
import fs from 'node:fs'
const p=process.cwd()+'/artifacts/.probe-fp32.json'
fs.writeFileSync(p,JSON.stringify({provider:'bge-m3-pre-v1',modelDir:'D:/dsh-auto-memory/python/bench/.hf-cache/models--BAAI--bge-m3/snapshots/5617a9f61b028005a4858fdac845db406aefb181',dimension:1024}))
const r=readEffectiveEmbeddingConfigPre('C:/Users/JH Z/.dsh',{DSH_M7_EMBEDDING_CONFIG:p})
console.log({provider:r.config.provider,configOk:r.configOk,modelPath:r.modelPath})
fs.unlinkSync(p)"
```
> 本轮输出：`{provider:'bge-m3-pre-v1', configOk:false, modelPath:''}`。
> ⚠️ 本轮该探针写在 `/tmp`（系统临时目录），**未落进仓库**；上面给的复算版本改成 `artifacts/.probe-fp32.json` 并在末尾 `unlinkSync`，**跑完请确认文件已消失**。

**M11 · 双重特殊 token / 512 尾部丢 token（两个已登记缺陷的现场复核）**
```bash
cd /d/dsh-auto-memory
python/bench/.venv/Scripts/python.exe -B -c "
import sys; sys.path.insert(0,r'D:/dsh-auto-memory/python'); import m7_embedding_v1 as emb
e=emb.load_embedder({'provider':'bge-m3-onnx-int8-pre-v1','modelDir':r'D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8','dimension':1024,'onnxFile':'onnx/model_int8.onnx'})
ids=e.tokenizer('测试文本 abc',add_special_tokens=False)['input_ids']; doc=e.build_doc_ids(ids)
pre,suf=e._specials(); final=list(pre)+list(doc)+list(suf)
print('content',len(ids),'build_doc_ids',len(doc),'final',len(final),'head',final[:4])
ch=emb.chunk_record_token_ids(e.tokenizer,'测试句子用于凑满令牌数量。'*200)
print('chunk_lens',[len(c) for c in ch][:4],'build_doc_ids_len',len(e.build_doc_ids(ch[0])))"
```
> 本轮输出：`content 5 / build_doc_ids 7 / final 9 / head [0,0,6,49125]`（**两个 [CLS] 连排**）；`chunk_lens [512,512,512,465] / build_doc_ids_len 512`（**512 token 的块只剩 510 正文，尾部 2 个 token 被 `build_doc_ids` 的 budget 截掉**）。
> ⇒ 这两条是 §5 N6 里"不改 CHUNK_POLICY_VERSION"的**代价说明**：缺陷真实存在，但修它必须单独走一次全量重嵌入，不在本路线内夹带。

### 6.2 抄用数字的来源表（逐条 file:line）

| 数字 | 值 | 来源 | 备注 |
|---|---|---|---|
| c1 词法 R@5（L2） | 0.200 | `docs/RELEASE-SEMANTIC-OPTION.md:104` | 同值见 `docs/M7-ACTIVATION-V2-PAPER.md:212` |
| c2 e5-small R@5（L2） | 0.850 | `docs/RELEASE-SEMANTIC-OPTION.md:105` | 同口径 251 episodes / 40 查询 |
| c2 e5-small R@5（63 主集） | 0.609（zh 0.706） | `docs/M7-ACTIVATION-V2-CONTROLLED-SHADOW.md:114` | **不同口径，勿与上行混比** |
| c3 int8 R@5（L2） | 0.925 | `docs/RELEASE-SEMANTIC-OPTION.md:118`；`docs/M7-EMBEDDING-BENCHMARK.md:98` | 与 fp32 delta = 0.000 |
| c3' fp32 编码 | 44 s（int8）vs 262 s（fp32），6× | `docs/RELEASE-SEMANTIC-OPTION.md:118-123` | 全量 251 条口径 |
| int8 单查询 p50 | 16 ms | `docs/RELEASE-SEMANTIC-OPTION.md:123` | 本轮复现 16.02 ms（同一台机） |
| int8 load | 19.01 s | `research/B-bge3-inventory.md:92` | 本轮 21.69 s（机器负载差异） |
| e5-small 加载/查询/重建 | 679 ms / 3.8 ms / 5.5 s（251 条） | `docs/M7-ACTIVATION-V2-PAPER.md:216` | 本轮回测冷启 1524.7 ms 含子进程+自检，不可直接比 |
| e5-large L1 R@5 | 0.727 | `docs/M7-EMBEDDING-BENCHMARK.md:63` | **`research/B-bge3-inventory.md:45` 误标为 L2** |
| e5-large L2 R@5 | 0.825 | `docs/M7-EMBEDDING-BENCHMARK.md:104` | 同表 R@1 0.600 / MRR 0.700 |
| e5-large 跨语 @5 | 0.60 | `docs/M7-EMBEDDING-BENCHMARK.md:63` | 20 条 zh↔en 错 8 条（`:76-78`） |
| sparse 各臂 L2/L1 全表 | 见 §3.2 | `artifacts/m7-hybrid-pre/results-model-sparse.json` | 同目录 `results-model-sparse.csv` 逐行一致（本轮核对） |
| weighted(dense,lexical) L2 | R@5 0.950 / MRR 0.866 | `docs/M7-ALGORITHM-DECISION.md:96-97`；`artifacts/m7-hybrid-pre/results.csv` 的 `weighted,w=0.7` 行 | 本轮核 CSV：0.95 / 0.8657 |
| reranker 收益与延迟 | R@5 0.966→1.000；p50 26–33 s；52–66× | `docs/M7-ALGORITHM-DECISION.md:129-131`；`research/C-agenda-distill.md:74` | 未接线 |
| bge-reranker 权重 | 2,271,071,852 B | `research/B-bge3-inventory.md:46` | 未下载校验（本轮只验 `ls`） |
| ColBERT 权重 | 2,100,674 B（仅 HF 清单） | `research/B-bge3-inventory.md:15/80` | 本地无文件 |
| ANN 重开门槛 | >5 万 chunk 或 p95>500 ms | `research/C-agenda-distill.md:207`（N5） | 现网 663 chunks |
| 500 ms 预算 | — | `research/C-agenda-distill.md:74` | reranker 的否决线，沿用为全链路事实标准 |
| HTTP 禁令 | 契约 §4 | `docs/PYTHON-SIDECAR-CONTRACT.md:78` | 原文「不引入 ANN、图数据库、HTTP server」 |
| 抽 HTTP 成本 | ≈5–8 人日 | `research/B-bge3-inventory.md:226` | 含 31 个 python 相关 smoke |
| D-9 / D-10 | 512 尾部丢 token / 双重特殊 token | `research/C-agenda-distill.md:113-114` | 本轮已在生产代码上复核（§6.1 M11） |
| 代码规模基线 | semantic-js.js 738 行 / embedding-config.js 65 行 / python-runtime.js 198 行 / python-sidecar-client.js 1043 行 / m7_embedding_v1.py 382 行 / worker_semantic_v1.py 1441 行 / index.js 21232 行（HEAD） | `wc -l` 实测（工作区）；index.js 用 `git show a53560e:lib/index.js \| wc -l` | ⚠️ 用户任务书写 "semantic-js.js 739 行"、"embedding-config.js 66 行"，**实测为 738 / 65**（差 1 行，疑为末尾换行计法）；python/m7_embedding_v1.py 与 worker_semantic_v1.py 与任务书写法一致 |

### 6.3 未验证项（**不得当事实引用**）

| # | 项 | 为什么没验 | 影响 |
|---|---|---|---|
| U1 | **e5-large 权重 sha256** | 文件 2,239,611,368 B > 2 GiB，`node fs.readFileSync` 抛 `ERR_FS_FILE_TOO_LARGE`；未用流式重算 | §4 只给字节数，不给摘要 |
| U2 | **`BgeM3Embedder`（fp32 类）真构造** | 本轮用 `AutoModel.from_pretrained` 等价路径测延迟，未直接 `load_embedder({'provider':'bge-m3-pre-v1'})` | §1.1 fp32 行的"可构造"是 [推定] |
| U3 | **sparse 批处理后的文档重建时间** | 只测了单条 unbatched（54.41 ms/条），未按 batch=16 复测 | §3.3 的"≈36.1 s"是**上界**；批处理预计 1/3–1/2 属 [推定] |
| U4 | **sparse 接线后的生产 R@5/MRR** | 需先做 S1–S3（本轮只读，不落地） | §3.5 S4 的判据未执行 |
| U5 | **e5-large 的 ONNX q8 产物** | 仓内不存在，未下载/未转换（任务禁止下载模型） | §4.3 理由是"不存在"而非"试过不行" |
| U6 | **fp32 档的端到端可用性** | 只验证 JS 门拒绝（M10），未尝试绕过门后实跑 sidecar | §1.5 冲突 3 的结论限于"JS 门不放行" |
| U7 | **三档在 500 ms 预算下的 p99** | 本轮只测 p50/p95，样本量 15，p99 无统计意义 | §2.5 用 p50/p95，未断言 p99 |
| U8 | **`_rankPath` 三类终态的实际取值** | 需真跑三条降级路径（要构造失败态） | §2.6 不变量 I2 是设计条款，非实测 |
| U9 | **`configOk` 之外的 Python 侧 fp32 路径** | `readEffectiveEmbeddingConfigPre` 是 JS 侧唯一入口；Python worker 自己读同一份 JSON（不经 JS 门），理论上可跑 | §4.3 的"不升"不依赖这条；但 N11 的"无收益"依赖 fp32 与 int8 同质（[抄] delta=0.000） |
| U10 | **sparse 在 int8 hidden 上 vs fp32 上的检索质量差** | 只测了向量 cosine（0.9989），未跑检索 | §3.3 结论限"向量层面近似" |

### 6.4 只读自证（本轮副作用边界）

| 项 | 结果 | 复算 |
|---|---|---|
| 本轮唯一写入 | `artifacts/SEMANTIC-UPGRADE-PATH-2026-10-24.md`（本文件） | — |
| 是否改过 `lib/` `tests/` `python/` `docs/` `tools/` `skins/` | **未改**。`git diff --stat` 的 4 个文件全部来自并行的 R0 线，与本轮无关（本轮结束时仍为 +120/−8） | `git status --porcelain` |
| 是否删过文件 | **未删仓库内任何文件**。`/tmp` 下写过 3 个临时文件（`dam-probe/fp32.json`、`idx.js`、`h.js`，均为探针/快照），在 win_bash 的系统临时目录，**不在仓库内** | — |
| 是否下载模型 | **未下载**（零网络请求；`env.allowRemoteModels=false` 是现网既有设置，见 `lib/semantic-js-worker.js:71`） | — |
| 是否跑 GPU 训练 / release | **均未** | — |
| 是否读生产记忆文件 | 只读：`~/.dsh/memory/semantic/{derived-corpus,vectors-*,recall-stats.json,embedding-config.json}` 与 `~/.dsh/dsh-auto-memory.json` | — |
| 工作区临时文件 | 本轮写过 `artifacts/.su_part1..7.md` 作为拼装中间件，**已在合并后删除**（见 §6.5 的合并命令） | `ls artifacts/.su_part*` 应为空 |

### 6.5 本文件的拼装方式（可复算"我读到的就是它"）

```bash
# 本文件由 7 段 heredoc 拼装而成（避免 PowerShell/Node 对 CJK + 反引号的转义差异）
cd /d/dsh-auto-memory/artifacts
cat .su_part1.md .su_part2.md .su_part3.md .su_part4.md .su_part5.md .su_part6.md .su_part7.md > SEMANTIC-UPGRADE-PATH-2026-10-24.md
rm -f .su_part*.md
wc -l SEMANTIC-UPGRADE-PATH-2026-10-24.md
```

---

## 附：本轮给用户的三个要点（供 lead 直接摘用）

1. **接口第一版不需要"新模型"** —— 两个引擎的返回形状已经收敛成 `Map<memoryId,cosine>`，缺的是一份带 identity / deadline / 失败码的契约；把现有 e5-small 与 bge-m3 int8 包成两个 port 即可，**权重零改动、663 个 chunk 向量零重建**（identity 已实测逐字段相等）。
2. **sparse 是真正的免费升级，但口径要纠正**：3,516 B 的权重在盘、查询侧只加 0.49 ms、存储 +3.2%，**但 bench 的 0.975 是"换掉 BM25"而不是"加第三臂"，且 MRR 会从 0.866 掉到 0.846**。建议按 §3.5 的 S1–S3 先双写 shadow、**不许直接切默认**。
3. **e5-large 明确不升**：体积 16.71×、单查询 29.0×、L2 R@5 0.825 还低于现役 0.925 —— 它是"更差的 bge-m3 且更贵"，升它得不到质量也得不到速度。
