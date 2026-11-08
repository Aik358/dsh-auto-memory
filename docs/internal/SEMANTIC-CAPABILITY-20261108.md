# 仓内语义分析能力调查 + 事件归并可行性评估（只读）

- 工作区：`D:/dsh-auto-memory`（分支 `preview`，HEAD `a21f3b1c`，工作树 25 个未提交条目）
- 事件库真源：`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`
- 本轮全程只读：未改 `lib/` `tests/` `tools/` `skins/`，未改配置，未跑生成器，未调用任何 `memory_*` 写入工具。
- 唯一的写入是本文件。所有数字为本次实测，命令见 §6；无法实测的项在 §7 标注「未实测」。

## 0. 结论速览

1. **能借用，但借来的东西解决不了用户想解决的问题。** 仓内确有一套完整的端侧语义栈（C2：`lib/semantic-js.js` + transformers.js/onnx 子进程，模型 `Xenova/multilingual-e5-small` q8 已在本机磁盘上，135,392,183 B）。它是**检索排序臂**，输入是「查询 × 候选语料」，输出是逐条 cosine；把它换到事件归并门上做实测，**比纯规则差**（§4 给出可复算数字）。
2. **用户说的「内置 C2 检索」= `lib/semantic-js.js` 的 JS 语义引擎**，证据是模块自述 `lib/semantic-js.js:2`「C2 内置语义引擎宿主」+ 三份文档同口径（`docs/internal/ARCH-REVIEW-ROUND3.md:152`、`docs/DECISIONS-20260914-SESSION.md:153`、`docs/PROJECT-FREEZE-AND-ROADMAP.md:155`）。「multilingual 模型」= 同一模块 `:584` 的 `E5_SMALL_Q8_MANIFEST_PRE_V1`（`multilingual-e5-small` q8，384 维）。
3. **现有能力离「事件归并」最近的是 `engine._jsSemantic.rank(corpusSnap, queryText)`**（`lib/semantic-js.js:499`，绑定 `lib/index.js:22064`）：返回 `Map(memoryId → cosine)`。前置条件是「模型文件在位 + 语料有 `idx_pre_<32hex>` 形式的 miv」。本机全部满足，**冷启动 1,105–1,285 ms，单次查询 43.7 ms，离线可跑**。
4. **但写路径当前根本没有「在 N 个事件里挑一个」这个动作**：`lib/index.js:24470-24507` 的候选集大小是 **1**（只取 `updatedAt` 最新的那个 active 事件），再与它算词袋重合。换成 cosine 也只是「和唯一那个候选比一次」——**换度量不能修好候选集**。
5. **不该现在引入模型。** 27 个碎片上，纯规则（事件名 ∩ 事件名的高基数标识）得 20 簇 / 0 假合并；语义 cosine 要压到 20 簇必须接受 4 次与真值不符的挂接（`t=0.945`，其中 1 次人工判对、实错 3 次）；而要零假合并只能停在 25 簇，此时仅正确挂接 1 次（`t=0.95`）。模型唯一独立收益是抓到一对**逐字重复**事件（cos=1.000000，规则抓不到）。
## 1. Q1 · 现存语义能力全清单

### 1.1 「C2 检索」到底指什么（逐候选核对）

| 候选 | 是不是 C2 | 判据（file:line + 原文） |
|---|---|---|
| **`lib/semantic-js.js`（JS 语义引擎宿主）** | **是** | `lib/semantic-js.js:2`：`C2 内置语义引擎宿主(js_semantic_engine_pre_v1)+ 资产下载器(js_semantic_dl_pre_v1)`；`:3`：`2026-08-26 用户裁定:C2 是默认主路径` |
| `lib/context-bridge.js` 的 `ACCESS_KINDS_PRE_V1` | 不是 | `lib/context-bridge.js:45`：`export const ACCESS_KINDS_PRE_V1 = Object.freeze(['seen', 'read', 'cite', 'reuse', 'success', 'correction'])` —— 是「访问证据种类」，属 Context Bridge §5 契约，与检索/向量无关；`lib/index.js` 内对该常量命中 **0** 行 |
| `lib/l0-extract.js` / `lib/l0-index.js`（L0 层） | 不是 | `lib/l0-extract.js:2` 自述「L0 抽取纯核心…分层语义唤回的地基」，做分层归属与摘要抽取；`lib/l0-index.js:2` 是「L0 向量索引」，但见 1.4：无人自动维护、无消费者 |
| `lib/shadow-retrieval.js`（影子检索） | 不是 | `lib/shadow-retrieval.js:26`：`export const LEXICAL_POLICY_VERSION = 'lexical_pre_v2'`；`:2` 自述「只读、纯函数、零 IO、零依赖」——纯词法臂（C1），不含模型 |
| 文档里被编号为 C2 的设计项 | 是（同指） | `docs/internal/ARCH-REVIEW-ROUND3.md:152`：`实测：C2 = Xenova/multilingual-e5-small q8（端侧）；C3 = Xenova/bge-m3 int8（Python sidecar）`；`docs/PROJECT-FREEZE-AND-ROADMAP.md:155`：`C2=默认主路径/C1=永久保底/C3=高级可选` |

⇒ **C2 = `lib/semantic-js.js` 的端侧 JS 语义引擎，默认模型 `Xenova/multilingual-e5-small` q8（384 维，q8 onnx 118,308,185 B）。** C1 = `shadow-retrieval.js` 的词法臂；C3 = Python sidecar 的 `bge-m3` int8（1024 维；`~/.dsh/memory/semantic-pre/embedding-config.json` 实测 `"provider":"bge-m3-onnx-int8-pre-v1","dimension":1024`）。

### 1.2 15 个模块逐个查明

| 模块（磁盘字节） | 入口函数 : 行 | 输入 → 输出 | 推理栈 | 是否在跑 |
|---|---|---|---|---|
| `semantic-js.js` 39,354 | `createJsSemanticEnginePre` :248；`rank` :499；`fuseD6Pre` :34 | `(corpusSnap{miv,records}, queryText)` → `{miv, scores:Map(memoryId→cosine)}`；失败返回 `null`（:518-520 fail-closed） | JS：fork 子进程 + transformers.js + onnxruntime | **在跑**：`lib/index.js:21835` 构造，`:22064` 绑定 `_jsSemanticRank`，`:14242` 作召回语义臂（C3 失败时回退）；`:21911` 作 L0 索引的 embedder |
| `semantic-js-process.js` 6,041 | `createJsSemanticProcessPre` :19 | `initialize()` / `embedQuery(text)` / `embedPassages(texts[])` → `Float32Array(384)`；>64 条自动分批（:135） | 进程边界：`fork`（:88），IPC `serialization:'advanced'` | **在跑**（仅经 `semantic-js.js:20`） |
| `semantic-js-worker.js` 5,608 | 无导出；`handle` :66 | `init` / `embedQuery` / `embedPassages`；校验 384 维有限值（:60） | onnx q8；`env.allowRemoteModels=false`（:71）⇒ 纯离线 | **在跑**（子进程） |
| `embedding-config.js` 6,867 | `normalizeConfigPathPre` :24；`readEffectiveEmbeddingConfigPre` :46；`updateEmbeddingConfigPre` :103 | 配置读写 + 路径规范化 → 有效 embedding 配置 | 纯算法 | **在跑**：`lib/index.js:118` 导入，`:22046` `:22103` `:22407` 读 |
| `semantic-decide.js` 15,384 | `decideActivationV2` :202；`loadAndVerifyPolicy` :276 | `features{text,denseTop,margin,…}` → `{lane,decision,reasonCodes}` | 纯算法（char_wb ngram + LR 权重 JSON） | **在跑但本机不生效**：`lib/index.js:22320` 调用；策略文件在 `lib/policies/`（`recall_intent_lr_v1.json` 95,069 B、`activation_policy_v2.json` 1,795 B）；本机 `semanticEngineMode='python'`、`activationSource='python'` ⇒ JS 判定核非主路 |
| `rerank-host.js` 8,715 | `createRerankHostPre` :71；`resolveRerankTierPre` :35 | 精排任务入队 → 有界 60s 窗口结果 | 外部 cross-encoder（bge-reranker / qwen3）；本地无 GPU torch ⇒ fail closed | **零生产调用**：全 `lib/` 内除自身外 **0** 处 import（仅 1 个测试文件引用） |
| `shadow-retrieval.js` 39,700 | `gatePreV1` :350；`lexicalSearch` :465；`replay` :643；`memoryIndexVersion` :147 | 快照 + QueryPlan → 候选 / 词法分 / 门决策 | **无模型**（tokenizer + coverage + recency） | **在跑**（5 个模块 import：`activation-inbox.js:16`、`context-bridge.js:19`、`context-host.js:29`、`m4-corpus.js:21`、`shadow-host.js:21`） |
| `shadow-host.js` 20,249 | `createShadowHost` :67 | accepted segment → gate→corpus→lexical→audit | 复用 shadow-retrieval（无模型） | **构造在跑、留痕未见**：`lib/index.js:20969` 构造；三开关 `:80-83` 全 true（配置 `associativeMemoryEnabled/shadowRetrievalEnabled/memoryAnchorEnabled` 均 true）；但 `~/.dsh/memory/retrieval-pre/audit/` 只有 `2026-09-20.jsonl`（6,053 B）一个文件，其后无新留痕（原因未实测） |
| `l0-extract.js` 26,408 | `extractL0Pre` :357；`buildL0IndexPre` :411；`parseMemoryItemsPre` :327；`classifyLayerPre` :139 | 记忆正文 → `{id,l0,source,layer,status}` | 纯算法 | **在跑**（11 处 import，召回主路径） |
| `l0-index.js` 18,439 | `createL0IndexPre` :83（`buildFull/update/remove/load/status`） | `entries[{id,vector,l0,…}]`，每条约 384 浮点 | 注入式 embedder（模块层零模型、零 fs） | **仅被 `l0-index-sync.js:38` 引用**，无直接调用方 |
| `l0-index-sync.js` 12,256 | `createL0IndexSyncPre` :73 | 工作区各层文本 → `<dshHome>/memory/semantic-pre/l0/l0-index-<wsHash12>-<layer>.json` | 注入 `engine._jsSemantic.embedPassages`（C2，384 维） | **「能跑但没人调」**：`lib/index.js:21898` 构造、`:21928` 定义 `syncL0IndexPre`，全文件**仅此 1 处出现**（无调用点）；磁盘上已有 12 个索引文件 / 8,237,383 B，为历史手动执行产物 |
| `recall-stats.js` 13,729 | `createRecallStatsPre` :50 | 三通道计数 → `<dshHome>/memory/recall-stats.json` | 纯算法（只记录、不参与排序，:2-7） | **在跑**：`lib/index.js:20965` 构造；落盘文件 124,301 B |
| `recall-fusion.js` 8,988 | `rankFusionRRFPre` :55 | `[{memoryId,dense,lex,tier}]` → RRF 融合分 | 纯算法（rank-space RRF，k=60） | **在跑**：`lib/index.js:14312` 动态 import，召回路径 |
| `recall-passages.js` 2,474 | `recallExcerptPre` :5；`recallPassagesPre` :15 | 正文 + 词 → 摘录 / 段落 | 纯算法 | **在跑**（7 处 import） |
| `event-recall.js` 10,573 | `collectEventHitsPre` :142；`eventToL0CorpusPre` :174；`textOfEventPre` :45 | 事件数组 + 词 → 命中；事件 → L0 语料条目 | 纯算法 | **在跑**：`lib/index.js:14212` / `:14391` |

与「归并」直接相关、但不在 15 个之内的四个模块：

| 模块 | 状态 | 证据 |
|---|---|---|
| `event-regroup-propose.js` 9,274 / `event-regroup-scan.js` 11,745 | **零生产调用** | 两者只被 `event-regroup.js` import；propose / scan 自身**无任何 import 方**（全 `lib/` 扫描） |
| `event-regroup.js` 11,486 / `event-regroup-apply.js` 10,334 | **只有快照工具被复用** | `event-regroup.js` 仅被上面两个死模块 import；`event-regroup-apply.js` 被 `upgrade-apply.js:48` import，但只取 `snapshotStorePre, rollbackFromSnapshotPre`（同一行），归并动作本身无人调用 |

### 1.3 `lib/index.js` 的 44 处 embedding 代码分层

（按 `/embedding/i` 计 44 行；任务书给的「33 处」是大小写敏感口径，两者不矛盾。）

| 用途 | 行号 | 说明 |
|---|---|---|
| 引擎 / 下载器构造 | 21835、21846、21873-21881 | C2 实例 + 资产下载后补建配置文件（#356） |
| 召回语义臂 | 22046、22064、22103、22243-22251、22320 | `_jsSemanticRank` 绑定、策略文件路径解析、JS 判定核调用 |
| 注入面 / 面板诊断 | 10386、14130、14231、14242、14308、14474-14516、15695-15700 | 语义臂就绪态、择优（python→C2→lexical） |
| Python sidecar 配置 | 1308、22407-22661、22718-22738、26048-26053、26817-26840 | health 帧、`embedding_view` 回报、`activationEmitMode` 同源写 |
| L0 索引 | 21911-21922 | `embedder: engine._jsSemantic.embedPassages` |

### 1.4 三套推理栈的真实存活状态

| 栈 | 组件 | 本机实测 |
|---|---|---|
| JS 端侧（C2） | `@huggingface/transformers` 3.8.1、`onnxruntime-web` 1.22.0-dev.20250409、`onnxruntime-node` 1.21.0（均在 `node_modules`） | **可用**：模型在位 `C:/Users/JH Z/.dsh/models/js-semantic/multilingual-e5-small/onnx/model_quantized.onnx`（118,308,185 B）+ `tokenizer.json`（17,082,730 B）；实测 init 1,105–1,285 ms，`cos` 计算正常 |
| Python sidecar（C3） | `python/` + `~/.dsh/memory/semantic-pre/embedding-config.json`（bge-m3 int8，1024 维） | 本机主路（`semanticEngineMode='python'`、`pythonBackendEnabled=true`、`pythonBackendWorkerPath=D:/dsh-auto-memory/python/worker_semantic_v1.py`）；配置指向 `D:/dsh-auto-memory/python/bench/models-xenova-bge-m3-int8` |
| 纯算法 | `shadow-retrieval` / `l0-extract` / `recall-fusion` / `semantic-decide` | 在跑；无模型、零下载、零冷启动 |

### 1.5 一句话回答 Q1

仓内有 4 类语义能力：**①端侧向量引擎（C2，可用且模型已在盘）**、**②服务端向量引擎（C3，本机主路）**、**③纯词法检索/门控（C1，在跑）**、**④L0 摘要与向量索引（摘要层在跑、向量层无人调）**。**没有一类是「判断两段工作是否同一件事」**——它们的输出都是「与查询的相似度分数」，不是「是否同一件事」的判定。
## 2. Q2 · 现有能力能不能直接拿来做「事件语义归并」

### 2.1 ① 离需求最近的模块

| 候选 | 与「新日志 × N 个已有事件 → 最相似那个」的距离 | 判定 |
|---|---|---|
| **`semantic-js.js` 的 `rank()`（`lib/semantic-js.js:499`）** | **最近**。它的输入就是「语料快照（任意多条 `{memoryId,text}`）+ 一段查询文本」，内部对每条算 `cosine` 并逐条返回 `Map(memoryId→score)`——把 `memoryId` 换成 `eventId`、`text` 换成事件名+summary，就是「N 个事件里比一遍」。**但它只给分数，不给阈值、不给「无匹配」的结论**（`rank` 从不返回 none；`scores` 空只表示语料空，`:507`） | **形状吻合，语义不吻合**：分数不能当判定 |
| `recall-fusion.js` 的 `rankFusionRRFPre`（`:55`） | 是「融合排序」，前提是已有多臂分数 | 不适用（要先有语义分） |
| `rerank-host.js`（`:71`） | cross-encoder 精排，理论上最贴合 | **不可用**：本地无 GPU torch、无量化产物（模块头 `:5-8` 自述 P95 37.4s / 8.8s、RSS 3.84–4.95GB），且全库零调用 |
| `shadow-retrieval.js` 的 `lexicalSearch`（`:465`） | 词法打分 | 已实测无效（A 线 §4.3：词袋在本质上是无区分力的度量） |
| `l0-index.js` / `l0-index-sync.js` | 已是「条目 → 向量」的持久化形态 | **不是为归并设计的**：索引条目来自「工作区各层文本」，与事件库无对应关系；且 `syncL0IndexPre` 无调用点（1.2） |

### 2.2 ② 直接调用它的前置条件（逐条实测）

| 前置条件 | 本机实测 | 用户机上的一般情形 |
|---|---|---|
| 模型文件已下载 | **满足**：`~/.dsh/models/js-semantic/multilingual-e5-small/` 下 5 个文件齐（onnx 118,308,185 B + tokenizer 17,082,730 B + 3 个小 json） | 需先走 `createSemanticDownloaderPre` 下载（`semantic-js.js:601`，双镜像 cn/intl，`SEMANTIC_DL_MIRRORS_PRE_V1` `:592`） |
| peer 依赖在位 | **满足**：`@huggingface/transformers` 3.8.1、`onnxruntime-web` 1.22.0-dev、`onnxruntime-node` 1.21.0 均在 `node_modules` | 否则 `JS_SEMANTIC_PEER_MISSING`（`semantic-js-worker.js:51`）⇒ 降级回词法 |
| 索引已建 | **不需要**：`rank()` 内部按 `miv` 增量建池（`:376-458`），池键是 `sha256(编码输入)`，`POOL_MAX=20000`（`:375`） | 首次要付全量嵌入成本（见 2.3） |
| Python 引擎已装 | **不需要**：C2 是纯 JS/onnx 路径，与 sidecar 互不依赖（`lib/index.js:22061` 明文「JS 与 Python 两套引擎仍互不依赖」） | — |
| 语料的 `miv` 格式 | **硬约束**：`rank()` 第一行 `if (!miv \|\| !/^idx_pre_[0-9a-f]{32}$/.test(miv)) return null`（`:503`）——miv 必须由 `shadow-retrieval.js:147` 的 `memoryIndexVersion()` 生成 | 事件库没有这种 miv，**要自己造一层** |

⇒ **调用门槛不高，但它要求调用方先把「事件」转成「带 miv 的语料快照」**——这一步在现有代码里只存在于「记忆条目」语境（`l0-index.js` / 召回），事件库侧完全没有。

### 2.3 ③ 冷启动成本（全部实测，非估算）

| 项 | 实测值 | 来源 |
|---|---|---|
| 模型总体积 | **135,392,183 B（129.1 MiB）** | 5 个文件实测字节求和（`semantic-js.js:577-583` 的 manifest 冻结值逐字一致） |
| 其中最大单文件 | 118,308,185 B（onnx q8） | 同上 |
| 是否要联网 | **首次要**（下载器双镜像）；**之后就绪后完全离线**：`env.allowRemoteModels=false`（`semantic-js-worker.js:71`） | 实测：断网状态下 init 成功 |
| 冷启动（子进程 fork + onnx 加载 + 自检推理） | **1,105 ms / 1,285 ms**（两次独立实测） | 见 §6 命令 3 |
| 单次查询嵌入 | **43.7 ms**（10 次均值，1200 字符截断） | 见 §6 命令 4 |
| 27 条 passages 一次性嵌入 | **1,737 ms**（≈64 ms/条，含首批开销） | 见 §6 命令 4 |
| 27 条「事件名+summary」一次性嵌入 | **211 ms**（≈7.8 ms/条） | 见 §6 命令 4 |
| 46 个事件的「名+summary」全库嵌入 | **483 ms** | 见 §6 命令 4 |

### 2.4 ④ 有没有现成索引可复用（`l0-index` 是不是就干这个的？）

**不是。** 三条证据：

1. **目录结构对不上**：`l0-index-sync.js:73` 的 `sync` 只吃「工作区各层的文本文件」（`lib/index.js:21933-21935` 逐个 push `p.notesPath` 等），产物的 key 是 `l0-index-<wsHash12>-<layer>.json`；磁盘上现存 12 个这样的文件（8,237,383 B），条目数分别是 3 / 3 / 1 …——**是日志/笔记/反思/白板四个层的条目，不是事件**。
2. **没有调用方**：`engine.syncL0IndexPre` 全 `lib/index.js` 只有定义（`:21928`），无调用点；模块头也写明「不接后台刷新，当前召回不消费此磁盘向量」（`:21925`）。
3. **事件侧另有通道**：事件进检索走的是 `event-recall.js`（纯词法，`collectEventHitsPre`），与向量无关。

⇒ **事件归并没有任何现成的向量索引可复用**；要复用的是「引擎」而不是「索引」。

### 2.5 一句话回答 Q2

**能接，但只是「接一个算相似度的函数」，不是「接一个归并器」**：`rank()` 给分数，阈值、「无匹配」语义、候选集构造（当前候选集大小是 1，见 `lib/index.js:24470-24478`）、事件文本口径（name 被截到 40 字，见 A 线 §5）全都要自己补——而这些恰恰是 0.34 门失败的地方。**把度量换成语义，不改变「候选集只有一个」这个结构性缺陷。**
## 3. Q3 · 三个候选方案对比

### 3.1 候选 A：复用已有 C2（e5-small q8）+ Xenova

| 项 | 值 | 实测/来源 |
|---|---|---|
| 模型体积 | **135,392,183 B（129.1 MiB）**，其中 onnx 118,308,185 B | 本机磁盘实测（`~/.dsh/models/js-semantic/multilingual-e5-small/`，5 文件） |
| 是否已在 cache | **是（本机）**；用户机需一次性下载 | 同上 |
| 下载源 | `hf-mirror.com`（cn）/ `huggingface.co`（intl），SHA256 冻结清单 5 条 | `lib/semantic-js.js:577-595` |
| 冷启动 | **1,105–1,285 ms** | 实测 |
| 单次推理 | 查询 43.7 ms；事件侧 27 条批量 211 ms；46 条 483 ms | 实测 |
| 离线可用性 | **完全离线**（`allowRemoteModels=false`） | `semantic-js-worker.js:71` |
| 与现状的增量 | **零新依赖**：引擎已在宿主里构造（`lib/index.js:21835`）；只需新增一次 `rank()` 调用与一个阈值 | 代码实测 |
| 致命短板 | 输出是分数不是判定；**在本数据上分数无法分离**（§4.2） | 实测 |

### 3.2 候选 B：更小的模型

下表体积与维度为**公开型号参数**（来自模型卡，未在本机下载实测 ⇒ 标「未实测」）；**唯一在仓内可查证的是 e5-small 一项**（manifest 冻结值，实测字节一致）。

| 型号 | 参数量 | 维度 | 体积（q8/量化） | 出处 | 备注 |
|---|---|---|---|---|---|
| `Xenova/multilingual-e5-small`（**现状**） | 118M | 384 | **118,308,185 B**（实测） | `lib/semantic-js.js:578` | 已是仓内默认；无需再引入 |
| `Xenova/paraphrase-multilingual-MiniLM-L12-v2` | 118M | 384 | ≈ 118 MB（未实测，来源：HuggingFace 模型卡） | 外部 | 与现状同量级，**无收益** |
| `intfloat/multilingual-e5-small`（非 Xenova 打包） | 118M | 384 | ≈ 118 MB（未实测） | 外部 | 与现状同一模型，仅打包不同 |
| `BAAI/bge-small-zh-v1.5` | 24M | 512 | ≈ 95 MB fp32 / ≈ 24 MB int8（未实测，来源：BAAI 模型卡） | 外部 | 中文单语，**不支持中英混排**，而本仓事件名中英混排（实测 27 条里 14 条含英文/编号） |
| `Xenova/bge-small-zh-v1.5` | 24M | 512 | ≈ 24–95 MB（未实测） | 外部 | 同上，且需新增下载清单 + SHA256 冻结 |

**结论**：候选 B 相对候选 A **没有量级收益**——最小的 bge-small-zh 也只把 118 MB 降到 ~24 MB（省 94 MB），却丢掉多语支持，且要新增一份下载清单/校验/降级链。而 §4 的结论是：**瓶颈不是模型大小，是「cosine 的绝对水平不携带「是否同一件事」的信息」**（同组最小 cos=0.9061 < 异组最大 cos=0.9661，区间完全重叠）。**换小模型不改变这一点**——这是 e5 系列在中文短文本上的固有性质，不是模型质量的函数。

### 3.3 候选 C：不用模型（高基数标识 + 时间窗）

**A 线已实测的判据**（`docs/internal/EVENT-FRAGMENTATION-20261108.md:431-451`）：从新日志正文抽 `#\d{2,4}` / `task-\d+`，与**候选事件的 name**（不是累积检查点）求交，非空即 append。

本次独立复算（口径见 §6 命令 5，**必须逐字复现 A 线口径才能得到同一结论**）：

| 变体 | 事件数 | 合并组 | 假合并 |
|---|---|---|---|
| 不做任何归并（现状） | **27** | — | — |
| **判据 1：`ids(事件名) ∩ ids(事件名)`** | **20** | `#557`×3、`#560`×2、`task-37`×5 | **0** |
| 判据 1 变体：`ids(首条检查点正文) ∩ ids(事件名)` | 17 | 上述三组 + `#522`(8+21) + `task-38`(20 并入 `#557` 组) + 17 并入 task-37 组 | **3 次与真值不符**（21→8：PR 流水线正文提到 #522；20→13：正文提到 task-38；17→16：P0-2 正文提到 task-37）。其中 20 从人工阅读看可能是对的（它就是 task-37 B-1/A-2 的落地记录）⇒ 实错至少 2 条 |
| 只按通用文件路径（A 线实测，本文件未复算） | 19 | — | 有（task-34 被并进 task-33） |
| 主题词重叠（A 线实测，本文件未复算） | — | — | 极高（相邻对中位数 0.330） |

⇒ **候选 C 在本数据上达到「27→20 且零假合并」，与语义方案的最好情况打平或更好（§4.2）。**

关键约束（两条，均可复算验证）：
1. **判据必须锚在「事件名」上**，不能与累积检查点比——否则标识传递性扩散，实测会把 8、21 两个事件吸进不相干的组（上表第二行）。
2. **语言无关、零依赖、零 IO**：`ids()` 只做两次正则（`#\d{2,4}` / `task-\d+`），本仓 27 条实测耗时 < 1 ms（未计时，量级由正则规模决定 ⇒ 标「未实测」）。

### 3.4 三候选横评

| 维度 | A · 复用 C2 | B · 更小模型 | C · 纯规则 |
|---|---|---|---|
| 新增依赖 | 无 | 要新下载清单 + SHA256 + 镜像 + 降级链 | 无 |
| 新增磁盘 | 0（本机已下载） | +24–95 MB（用户机） | 0 |
| 冷启动 | 1.1–1.3 s（每次宿主进程一次） | 同量级 | 0 |
| 单次开销 | 44 ms（查询）/ 8–64 ms·条（事件） | 略低（未实测） | < 1 ms（未实测） |
| 离线 | 是 | 是 | 是 |
| 27 碎片上的效果 | 25 簇 / 1 次正确挂接（t=0.95），或 20 簇 / 4 次与真值不符的挂接（t=0.945，其中 1 次人工判对） | 未实测（无法在不下载的前提下测） | **20 簇 / 0 假合并** |
| 可解释性 | 低（0.93 与 0.94 无人类语义差别） | 低 | **高**（「因为都提到 task-37」） |
| 误判可逆性 | 阈值型误判，不可解释、不可申诉 | 同 | 可解释、可申诉、可加白名单 |

⇒ **按「收益/增量」排序：C > A ≫ B。B 可以直接排除。**
## 4. Q4 · 真实数据上的收益与代价（实测）

### 4.1 数据集（实测口径）

| 项 | 值 | 说明 |
|---|---|---|
| 事件库文件 | `event-store.json`，2,974,577 B，schema `v4_event_store_v2` | 本次读数 |
| 事件总数 | **46**（任务书给 45，因本机期间新增 1 条） | 见 §7 差异说明 |
| `kind='unknown'`（碎片） | **28** | —— |
| 扣除**本调查自身创建的那条**（`evt_a409342c`，2026-11-07 22:38 UTC，在本次测量之后） | **27** | 与 A 线口径一致 |
| 检查点总数 | 700 | —— |

**片段的文本口径**（三套实测，结果分别列出）：
- `full`：全部检查点正文拼接后截 1,200 字符（与 `semantic-js-worker.js:21` 的 `clean()` 上限一致）；
- `name+summary`：事件名 + summary（**现实中 summary 是空的**：27 条 summary 全部为空字符串）；
- `first`：首条检查点正文。

### 4.2 语义相似度能不能把 27 个碎片分到正确的簇

**真值（ground truth）**：按「事件名里的高基数标识」给出的 20 组，其中 3 组含多个成员——`task-37`×5、`#557`×3、`#560`×2；其余 17 组各 1 条。这是**独立于 cosine** 的分组，来自名字里显式的任务号 / issue 号。

#### (a) 分数分布：两组区间完全重叠

| 口径 | 同组对（14 对）最小 / 中位 / 最大 | 异组对（337 对）中位 / 最大 | 能否用单一阈值分开 |
|---|---|---|---|
| `full` | **0.9061 / 0.9325 / 0.9547** | 0.9159 / **0.9661** | **不能**：同组最小 0.9061 低于异组最大 0.9661 |
| `name+summary` | **0.9102 / 0.9335 / 0.9749** | 0.8969 / **1.0000** | **不能**：异组最大 1.0000（见 (d)） |

⇒ **同一模型的 cosine 在「同一件事」与「不同的事」上取值范围完全相同。** 这不是阈值没调好，是度量本身没有区分力——与 A 线对词袋的结论同构（`docs/internal/EVENT-FRAGMENTATION-20261108.md:469-472`）。
#### (b) 阈值扫描：单链接聚类

`full` 口径（27 条互相 cosine，≥t 即并簇）：

| 阈值 | 簇数 | 最大簇 | 合并掉的条数 |
|---|---|---|---|
| 0.999 / 0.99 / 0.98 / 0.97 | **27** | 1 | 0 |
| 0.96 | 26 | 2 | 1 |
| 0.95 | 25 | 2 | 2 |
| 0.94 | 18 | 6 | 9 |
| 0.93 | 8 | 20 | 19 |
| 0.92 | 2 | 26 | 25 |
| 0.91 / 0.906 / 0.90 | 1 | 27 | 26 |

`name+summary` 口径：0.99 → 26 簇（最大 2）；0.97 / 0.96 → 24（最大 3）；0.95 / 0.94 → 21（最大 5）；0.93 → 15（最大 11）；0.92 → 11（最大 15）；0.91 → 2（最大 26）。

⇒ **没有任何阈值给出 20 簇。** 目标 20 簇落在 25 簇（t=0.95）与 18 簇（t=0.94）之间的断崖上——阈值稍低就一次塌成 18 簇、9 条被并。

#### (c) 真实门控模拟（按 createdAt 顺序重放，逐条与「历史全部事件」比）

`full` 口径：

| 阈值 | 产出事件数 | 正确挂接 | **假挂接** | 假挂接明细（i→j@cos） |
|---|---|---|---|---|
| 0.99 / 0.97 | 27 | 0 | 0 | —（等于什么都不做） |
| 0.96 | 26 | 0 | 1 | `20→19@0.966` |
| 0.95 | 25 | 1 | 1 | `20→19@0.966` |
| **0.945 / 0.94** | **20** | 3 | **4** | `4→2@0.948`、`17→13@0.945`、`20→19@0.966`、`23→22@0.946` |
| 0.935 | 15 | 4 | 8 | 另含 `6→4@0.937`、`7→6@0.939`、`16→13@0.937` |
| 0.93 | 12 | 4 | 11 | `1→0@0.935` 等继续塌 |
| 0.925 | 7 | 4 | 16 | `3→2` 等 |
| 0.91 | 2 | 5 | 20 | 几乎全并 |

`name+summary` 口径：0.99 → 26 事件 / 0 正确 / 1 假（`26→25@1.000`）；0.95 → 21 / 2 / 4；0.93 → 18 / 4 / 5；0.91 → 6 / 4 / 17。

⇒ **要达到 A 线的 20 簇，语义必须吞下 4 次与真值不符的挂接。** 其中 `20→19` 从人工阅读看是**对的**（两者是同一件事的重复记录），因此**实际错 3 次**——仍不是零假合并。四例明细（均可对照事件名复核）：

| 假挂接 | 后果 | 为什么错 |
|---|---|---|
| `4→2`（`v3.4.0-alpha.7 施工批次` 挂到 `v3.4.0-alpha.6 发布`） | 两个不同版本批次合并 | 同属「版本发布」语义，cos 0.948 |
| `17→13`（`P0-2（#548+#549+#556）` 挂到 `task-38 / #557`） | 两个独立任务合并 | 都写了「本地提交 + 文件数」，cos 0.945 |
| `20→19`（`B-1/A-2 落地 + 全量回归…` 挂到 `task-37 B-1+A-2 完成`） | 实际是同一件事的重复记录（见 (d)） | 语义判对，但说明它区分不了「同一事」与「同一事的重复」 |
| `23→22`（`Lead 三条裁决收口` 挂到 `P0-3（#558①②+#554）`） | 两个不同批次合并 | 都是「本地提交 6 files / +N −M」句式，cos 0.946 |

#### (d) 语义的唯一独立收益：抓到一对逐字重复

`evt_0127b3f9`（2026-11-07 21:45:15，**0 条检查点**）与 `evt_6e6497f7`（同日 21:45:25，2 条检查点）事件名**完全相同**：`name+summary` 口径 cos = **1.000000**，`full` 口径 cos = 0.9221。

这是真实缺陷（同一句话建了两个事件，间隔 10 秒），但：
- 高基数标识规则**抓不到**（两条名字里都没有 `#` 号或 `task-` 号）⇒ 确属语义的独立收益；
- 用「事件名逐字相等」一条字符串比较即可抓住，**不需要模型**。

### 4.3 语义作为「候选排序器」（而非门控）的表现

只让语义**排序**、由别的判据做决定时（7 个有同组前驱的碎片）：

| 口径 | top-1 命中 | top-3 命中 |
|---|---|---|
| `full` | **5/7** | 7/7 |
| `name+summary` | 4/7 | 6/7 |

失手样例：`q=12`（`task-35 / #560` 被 `v3.4.0-alpha.6 发布` 抢到首位，0.922）、`q=13` / `q=16`（task-37 组内互抢）。
⇒ **排序器可用（top-3 全中），判定器不可用。** 这是语义在本仓唯一站得住的位置。
### 4.4 代价：每次 `memory_log` 都要算 embedding 吗

事件归并发生在写路径上（`lib/index.js:24470-24507`，每次 `memory_log` 触发一次）。

| 方案 | 每次写入的额外开销 | 依据 |
|---|---|---|
| 每条都调 `rank()`（与召回同路径） | **43.7 ms**（单次查询）+ 语料变动后的增量重建 | 实测：`embedQuery` 10 次均值 |
| 只在语料变化时批量重算 | 46 个事件全库 **483 ms**（首次）；之后按 `sha256` 池增量，通常 0–20 条 | 实测 + `semantic-js.js:364-375` 的增量设计 |
| 纯规则 | **< 1 ms** | 未精度计时（仅两次正则），量级由正则规模决定 |

三条**结构性成本**（不是性能，是架构）：
1. **冷启动 1.1–1.3 s 会落在首个 `memory_log` 上**（子进程 spawn + onnx 加载 + 自检推理）。当前唯一的预热路径在召回侧；若首次 `memory_log` 早于首次召回，这 1.3 s 就要由写路径承担。
2. **子进程是串行队列**：`semantic-js-worker.js:18` 的 `queue` 把请求串起来；`semantic-js-process.js:71` 队列满 64 条即 `JS_SEMANTIC_WORKER_BUSY`。写路径与召回路径共用同一个子进程 ⇒ **两者互相排队**。
3. **一次超时会杀掉整个子进程**：`semantic-js-process.js:74` 任一请求超时即 `stop()` 并 `SIGKILL`（`:42`），此后所有语义调用一起降级。写路径接进来等于把该风险引入「每条日志都要走」的关键路径。

### 4.5 一句话回答 Q4

**语义方案在本数据上不比规则好，且更贵、更难解释。** 规则 27→20 零假合并；语义要么不动作（t≥0.96），要么一动作就假合并（t≤0.945 时有 4 次与真值不符的挂接，其中 1 次人工判对、实错 3 次）。语义唯一的独立收益是抓到一对「事件名逐字重复」——而这一条用字符串相等就能抓。

## 5. Q5 · 落地建议

### 5.1 接在哪一环：**不要接在写路径**

| 位置 | 现状 | 建议 |
|---|---|---|
| 写路径（`memory_log` 归属判定，`lib/index.js:24470-24507`） | 候选集大小 1（`_best` 只取 `updatedAt` 最新），词袋 0.34 门 | **换成规则判据**：先遍历**全部 active 事件**（不是只取最新），用「高基数标识 ∩ 事件名」判定；命中即 append，否则新建。零模型、零延迟、可解释 |
| 批量归组（`now` 之类的一次性动作） | `event-regroup-*` 四模块零调用 | 若确实要引入语义，**放在这里**：离线批量、不影响写路径延迟、可人工复核后再落盘 |

理由：写路径是**同步阻塞模型调用**的位置——`memory_log` 每轮都会触发（事件库 11-07 单日新增 21 个事件，本次按 createdAt + 日界 450 分钟复算；剔除本次调查自身创建的 1 条后为 20），把 44 ms + 1.3 s 冷启动 + 子进程串行队列 + kill-on-timeout 放到这条路上，代价与风险都远大于收益。

### 5.2 是否应该先不上模型：**是**

三条理由，按强度排序：
1. **规则已经够用**：27→20 零假合并，与语义最好情况打平、优于语义可实现情况（§4.2）。
2. **语义在本质量上不可分**：同组最小 0.9061 < 异组最大 0.9661，**区间完全重叠**。这不是参数问题——换阈值只会换来「不动作」或「假合并」二选一。
3. **先把「候选集只有 1 个」修好**：当前门控连「和哪几个候选比」都没做对（`lib/index.js:24470-24478` 只取 `updatedAt` 最新的一个 active 事件）。在候选集是 1 的前提下讨论「用词袋还是用向量」，等于在错误的问题上选方法。

**建议顺序**：
- **P0（止血）**：写路径判据换成「高基数标识 ∩ 事件名」，候选集从 1 扩到全部 active 事件。不改 schema、不引入模型、不改工具契约。
- **P1（接线）**：把 `event-regroup-*` 四模块接上（它们已写好、已有 2 个 smoke 套件），让人工/离线可办事后归并。
- **P2（可选）**：若 P0 上线后仍有大量无标识碎片（27 条里有 **10** 条 `name` 无任何高基数标识，其中 **5** 条连首条检查点正文也没有），再考虑用 **C2 做「候选排序器」而非判定器**（§4.3 top-3=7/7），并把判定权留给人或规则。**此时也不需要新模型——C2 已在宿主里。**

### 5.3 如果要上，最小侵入路径（不改 schema、不改已知契约）

| 步骤 | 落点 | 侵入性 |
|---|---|---|
| ① 用现成引擎，不加依赖 | `engine._jsSemantic.embedPassages`（`lib/semantic-js.js`，已在 `lib/index.js:21835` 构造） | **零新增依赖** |
| ② 事件文本口径不新增字段 | 用现有 `name + summary`（`event-store.js` 26 字段之一） | 不改 schema |
| ③ 只在批量归组时算，不在写路径算 | 复用 `event-regroup-*`（已有 `event-regroup.js:11` 的 `propose` 契约） | 不改工具签名 |
| ④ 阈值不写死 | 走 `embedding-config.js`（已有 `activationPolicy` 同型结构） | 不改配置键名 |
| ⑤ 降级链 | 语义不可用 → 规则；规则无标识 → 新建（现状） | 与现有 fail-soft 一致 |

**明令不要做的三件事**（都有实测依据）：
- **不要**把 `rank()` 挂进 `memory_log` 的归属判定（4.4 的三条结构性成本）。
- **不要**用「语义阈值」单独决定合并（4.2(a)：区间重叠）。
- **不要**把 `l0-index` 当事件索引复用（2.4：它的条目是工作区各层文本，与事件库无映射）。
## 6. 复算命令清单

全部命令在 `D:/dsh-auto-memory` 下用 `node` 直接执行（Node 20+，ESM）。第 3–5 条会真加载 C2 模型（本机已下载），第 1、2 条为纯文件读取。

**命令 1 · 15 个模块的字节数**

```powershell
Get-ChildItem lib -Filter *.js | Where-Object { $_.Name -match 'semantic|shadow|l0-|recall|embedding|rerank|event-' } | Sort-Object Length -Descending | ForEach-Object { '{0} | {1}' -f $_.Name, $_.Length }
```

**命令 2 · import 图（判「零调用」用）**

```js
const fs=require('fs'),path=require('path');
const mods=['semantic-js.js','shadow-retrieval.js','shadow-host.js','l0-index.js','l0-index-sync.js','rerank-host.js','event-regroup.js','event-regroup-scan.js','event-regroup-propose.js','event-regroup-apply.js'];
for(const m of mods){const hit=[];for(const f of fs.readdirSync('lib').filter(x=>x.endsWith('.js'))){if(f===m)continue;
  const re=new RegExp('["'"'./]'+m.replace('.','\\.')+'["'"']');
  fs.readFileSync(path.join('lib',f),'utf8').split(/\r?\n/).forEach((l,i)=>{if(re.test(l))hit.push(f+':'+(i+1))})}
  console.log(m, hit.length, hit.slice(0,5).join(','))}
```

**命令 3 · 冷启动与单次嵌入（真跑模型）**

```js
const {pathToFileURL}=require('node:url');
const m=await import(pathToFileURL('D:/dsh-auto-memory/lib/semantic-js-process.js').href);
const p=m.createJsSemanticProcessPre({pluginDir:'D:/dsh-auto-memory',
  modelsDir:'C:/Users/JH Z/.dsh/models/js-semantic',peerDirs:['D:/dsh-auto-memory'],
  localWasmPaths:'auto',startupTimeoutMs:180000,requestTimeoutMs:180000});
let t=Date.now(); await p.initialize(); console.log('initMs',Date.now()-t);
t=Date.now(); for(let i=0;i<10;i++) await p.embedQuery('测试文本 '+i); console.log('perQueryMs',(Date.now()-t)/10);
p.dispose();
```

**命令 4 · 27 个碎片的 cos 分布与门控模拟**（本文件 §4.2 的数字全部由它产出）

```js
const fs=require('fs'),{pathToFileURL}=require('node:url');
const Store=JSON.parse(fs.readFileSync('C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json','utf8'));
const frags=Store.events.filter(e=>e.kind==='unknown'&&e.id!=='evt_a409342c').sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
const ids=s=>{const o=new Set();for(const m of String(s).matchAll(/#\d{2,4}/g))o.add(m[0]);for(const m of String(s).matchAll(/task-\d+/g))o.add(m[0]);return o};
const F=frags.map((e,i)=>({i,name:String(e.name||''),
  ids:[...ids(e.name)],
  full:((e.checkpoints||[]).map(c=>String(c.text||'').replace(/^- \d{2}:\d{2} \[[^\]]*\]\s*/,'').trim()).join('\n')||String(e.name||'')).slice(0,1200)}));
const keyOf=F.map(f=>f.ids.length?f.ids[0]:'S'+f.i);
console.log('frags',F.length,'clusters(rule)',new Set(keyOf).size);
const m=await import(pathToFileURL('D:/dsh-auto-memory/lib/semantic-js-process.js').href);
const p=m.createJsSemanticProcessPre({pluginDir:'D:/dsh-auto-memory',modelsDir:'C:/Users/JH Z/.dsh/models/js-semantic',peerDirs:['D:/dsh-auto-memory'],localWasmPaths:'auto'});
await p.initialize(); const V=await p.embedPassages(F.map(f=>f.full)); p.dispose();
const cos=(a,b)=>{let d=0;for(let i=0;i<a.length;i++)d+=a[i]*b[i];return d};
for(const t of [0.99,0.97,0.96,0.95,0.945,0.94,0.935,0.93,0.92,0.91]){
  let n=0,ok=0,bad=0;
  for(let i=0;i<F.length;i++){let bi=-1,bs=-1;for(let j=0;j<i;j++){const c=cos(V[i],V[j]);if(c>bs){bs=c;bi=j}}
    if(bi>=0&&bs>=t){keyOf[i]===keyOf[bi]?ok++:bad++}else n++}
  console.log('t='+t,'events='+n,'ok='+ok,'false='+bad)}
```

**命令 5 · 规则回放（必须用「名字 ∩ 名字」口径）**

```js
// 承接命令 4 的 F / keyOf：
// 变体 A（=A 线判据 1）：ids(事件名) ∩ ids(事件名)
console.log('name×name clusters', new Set(F.map(f=>f.ids.length?f.ids[0]:'S'+f.i)).size);
// 变体 B（本文件 §3.3 第二行）：ids(首条检查点正文) ∩ ids(事件名)
// 把 F[i].ids 换成 ids(首条检查点正文) 重跑同一段即得 17 簇 / 2 次假合并
```

**命令 6 · 模型文件与依赖**

```powershell
Get-ChildItem 'C:/Users/JH Z/.dsh/models/js-semantic/multilingual-e5-small' -Recurse -File | ForEach-Object { '{0} {1}' -f $_.Length, $_.FullName }
node -e "for(const p of ['@huggingface/transformers','onnxruntime-web','onnxruntime-node']){console.log(p,require('./node_modules/'+p+'/package.json').version)}"
```

**命令 7 · L0 索引产物实测**

```powershell
Get-ChildItem 'C:/Users/JH Z/.dsh/memory/semantic-pre/l0' | ForEach-Object { '{0} {1}' -f $_.Length, $_.Name }
```

## 7. 未验证 / 边界

| # | 项 | 状态 |
|---|---|---|
| 1 | 任务书称「45 事件 / 27 碎片」，本次实测 **46 / 28**（多出的 1 条是 `evt_a409342c`，创建于 2026-11-07 22:38 UTC，即 A 线 05:50 测量之后）。剔除它后与 A 线口径完全一致（45 / 27） | **已解释，非矛盾** |
| 2 | 任务书称 index.js 有「33 处 embedding」；本次按 `/embedding/i` 实测 **44 行** | **口径差异**（大小写敏感与否），两者都可复算 |
| 3 | 候选 B 各型号的参数量/维度/体积 | **未实测**（未下载），来源为 HuggingFace / BAAI 模型卡 |
| 4 | 「事件名逐字重复」那一对（`evt_0127b3f9` / `evt_6e6497f7`）为何会产生 | **未查明**（0 检查点的那条不排除是某次工具调用超时重试） |
| 5 | `shadow-host` 的 audit 目录自 2026-09-20 起无新文件，而三开关全 true | **未查明**；只记录现象，不下结论 |
| 6 | 纯规则的单次耗时「< 1 ms」 | **未精度计时**，只做量级判断 |
| 7 | 语义方案的**真实写入延迟**（含子进程排队、IPC） | **未实测**；本文件测的是单次 `embedQuery` 44 ms 与批量嵌入，未在 `memory_log` 真实路径上打点 |
| 8 | bge-m3（C3）在同一 27 条上的表现 | **未实测**（本机 Python sidecar 需起 worker；本文件只测了 C2） |
| 9 | 27 条里 7 条 `name` 无任何高基数标识、5 条正文也无标识 | 说明**纯规则无法覆盖全部碎片**；这 7 条需要别的判据（会话标识 / 人工归并） |
| 10 | 「同一件事」的人工真值 | 本文件用「名字里的任务号/issue 号」当代理真值；若某两条真属同一件事但名字里标识不同，会被算成「异组」，从而**低估**语义、**也低估**规则 |

### 关于本文件自身的边界

- 只测了 C2（JS e5-small q8），未测 C3（Python bge-m3 int8）。C3 需要起 Python worker，本次未做（与「只读、不启动额外进程」的边界冲突最小化处理）。
- 归并实验是**离线重放**（按 createdAt 顺序把 27 条喂给判据），不是真实 `memory_log` 路径——因为任务书要求只读、不得写事件库。
- 所有 `file:line` 均为 HEAD `a21f3b1c` 下实测；行号会随代码演进漂移。
