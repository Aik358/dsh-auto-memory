# 集成分析：本地仓库深度解读 × 四仓库可吸收性评估

> 写于 2026-09-09。基于**实际读到的代码与联网检索**，非推测。
> 上位：[ROADMAP.md](ROADMAP.md)（总规划）、[PROMPT-PACK-LAYERED-RECALL.md](PROMPT-PACK-LAYERED-RECALL.md)（外包 prompt 包）。

---

## 0. 前置声明：对前几轮判断的修正

前几轮我做结论时只读了 3 个文件（`shadow-retrieval-pre.js`、`semantic-js-pre.js`、`index.js` 片段），据此说过"没有分层""没有索引""没有 importance 维度""实现广度浅"。**本轮通读后必须修正——这些判断是错的：**

| 前几轮的错误判断 | 实际（本轮读到） |
|---|---|
| "没有 L0/L1/L2 分层" | `procedure-store-pre.js` 已有**六级渐进激活**：index→hint→excerpt→checklist→resource→full |
| "没有倒排索引" | `memory-index-pre.js` 已实现按标题切块 + **UTF-8 半开字节区间 [byteStart,byteEnd)** + recordDigest + stale 判定 |
| "没有 importance 维度" | `fact-store-pre.js` 的 `evidenceFor()` 聚合 **seen/read/cite/reuse/success/correction** 六类计数；`procedure-store` 的晋升规则直接基于它 |
| "recall 是全部" | 真正的记忆主体是 **M8 三层 store（fact/episodic/procedure）+ memory-hub 编排器**，且**全部已接线进 index.js** |
| "语义只是词法" | `semantic-decide-pre.js` 是 **LR + Platt 校准**的判定核，与 Python `decide_activation_v2` 逐字段对齐 |

**结论**：这个项目不是"草台班子"，是一套**已经跑通的、有状态机和证据系统的三层记忆架构**。我此前的改进建议需要重新定位——大部分不是"从无到有"，而是"在已有结构上补一层表示"。

---

## 1. 本地仓库深度解读

### 1.1 技术栈与依赖

来源：`package.json`（实际读取）

| 项 | 值 |
|---|---|
| name / version | `@a9i5k4/dsh-auto-memory` / **2.2.6** |
| type / main / license | `module` / `lib/index.js` / **BSD-3-Clause** |
| exports | `.` → `lib/index.js`；`./client` → `lib/client.js` |
| files（进 npm 包） | `lib`, `python`, `docs`, `cordis.patch.yml`（排除 `python/bench`、`python/__pycache__`） |
| peerDependencies | **`@deepseek-ai/cordis`: `^4.0.1`** |
| optionalDependencies | **`@huggingface/transformers`: `^3.7.6`**（C2 语义引擎） |
| **dependencies** | **无（零运行时依赖）** |

`dsh.client.inject` 注入多个 `@deepseek-ai/dsh-*` 宿主包（api-remotes / client-runtime / client-connection / ui-slots / ui-settings / client-ui-sidebar）。

Python 侧：`python/` 共 **5612 行**——`worker_semantic_pre_v1.py`（1344）、`worker_pre_v1.py`（623）、`verify_policy_artifact.py`（122），另有 `bench/`、`policies/`。

### 1.2 目录结构

```
lib/          58 个 .js，29669 行（含成对的 xxx-pre.js 与 xxx.js）
python/       3 个 .py + bench/ + policies/，5612 行
tests/smoke/  54 个 .mjs
tools/        release.mjs 等发布脚本
docs/         契约 + 规划（本轮新增 7 份）
```

**关于 `xxx-pre.js` 与 `xxx.js` 成对**：除 `l0-extract-pre.js`（本轮新建，尚无发布产物）外，其余模块均成对存在且多数行数相同——这是发布线（`release.mjs` 剥 `_pre`）产物的共存状态。**新增模块必须建 `*-pre.js`**，否则与既有惯例不一致。

### 1.3 架构分层（按 M 编号，实际接线）

`index.js`（7390 行）已 import **21 个 `-pre` 模块**，全部接线：

```
M3a  memory-index       只读记忆文件索引（按块 + 字节区间 + digest）
M3b1 memory-anchor      Anchor/Sidecar/Dry-run Planner
M3b2 memory-writer      原子写入基础设施
M4-1 shadow-retrieval   影子检索纯核心（674 行，27 导出）
M4-2 m4-corpus          Corpus Adapter
M4-3 shadow-host        Host Shadow Wiring
M5-1 context-bridge     Context/Evidence Bridge（619 行，34 导出）
M5-2 evidence-store     Evidence Store + Aggregate
M5-3 context-host       Context Bridge Host Wiring（712 行）
M6-1 activation-inbox   Activation Inbox / Reference Tail（426 行，25 导出）
M6-2 activation-inbox-state
M6-3 activation-host    Surface Adapter
M7-0 m7-wire / python-sidecar-client  Wire Protocol / JS SidecarClient
M7-1 index-sync
M7-6 python-setup
M7-8 m7-index-sync-host
M8-0 fact-store         ★ Fact 四元组 + supersede + 证据（419 行）
M8-1 episodic-store     ★ Episode 六元组 + consolidate（317 行）
M8-2 procedure-store    ★ 状态机 + 六级激活（407 行）
M8-3 memory-hub         ★ 三层编排器（260 行）
M10  storage-manage / ws-overview-rank
C2   semantic-js        内置语义引擎宿主 + 资产下载器（492 行）
     semantic-decide    JS 激活判定核（LR + Platt）
```

### 1.4 核心模块的接口约定（实际读到）

**M8-0 Fact Store**
- 数据结构：**`{scope, subject, predicate, object?}` + provenance + confirmedAt + ttl? + revoked?**
- `upsert(cand)`：冲突→**冲突集保留双方**；自动推断不覆盖已有规则；否则合并
- 原则：**用户明确声明 > 模型推断**；项目事实/用户画像/术语分开；冲突可见、可确认、可撤销
- `supersede`：同 subject+predicate 新事实显式取代旧事实，**旧 revoked=true 且保留 provenance**
- `evidenceFor(memoryId)`：聚合 **seen/read/cite/reuse/success/correction** 六类计数 + 去重 session 数
- 导出：`createFactStorePre`, `validateFactCandidatePre`, `isFactConflict`, `ingestJudgementRows`, …

**M8-1 Episodic Store**
- 数据结构：**`{intent, actions, entities, unresolved, outcome, provenance}`**
- `append(segment)` → 累积；`consolidate()` → 摘要固化，产出 `episodic_candidate` 供 M-03/M-04 消费
- **失败经验默认是 candidate，不直接是事实**（防错误自我解释污染长期层）

**M8-2 Procedural Store**
- 状态机：**observed → candidate → validated → active → deprecated**
- 晋升：`sessionDiversity ≥ 3` 且 `successCount ≥ 2`；correctionRate 超阈值或 contradictions → 保持 candidate；riskLevel=high 未批准 → `{action:'ask'}`
- **渐进激活六级**：`index → hint → excerpt → checklist → resource → full`
- 高风险（SSH/部署/删除）永不因相似度自动执行

**M8-3 Memory Hub**：纯内存编排，`{episodic, facts, procedures}` 三 store 即插即用；**任一 store 失败则该路静默跳过，不阻断其他路**；对外提供统一查询/统计/快照。

**semantic-decide-pre**：`decideActivationV2(features, policy)`，输入 `{text, denseTop, margin, containment, mark, nCand, candidateHit, hardGates, repetition, requiresRelayFlag, piiClass}`，输出 `{lane, decision, reasonCodes, features, advisoryOnly, ...}`；工件加载 **fail closed**（configHash 校验失败抛错，调用方回退）。

**recall 实现**：`index.js:3239` — `async recall(query, limit = 8, agent, scope = 'all')`；工具定义 `:6302`，参数 `{query, limit, scope: 'all'|'handoff'|'sessions'}`。

### 1.5 编码风格（新增代码必须遵守）

1. **纯函数核心**：逻辑放 `lib/xxx-pre.js`，**零 IO**（IO 注入），零依赖（仅 `node:crypto` 允许）
2. **文件头注释**：`/** … */` 块，写模块定位、契约出处（`docs/XXX-CONTRACT.md §n`）、设计目标、边界、fail 策略，末行常写"全部同输入确定; UTF-8 无 BOM"
3. **版本常量**：`export const XXX_POLICY_VERSION = 'xxx_pre_v1'`；策略对象 `Object.freeze`
4. **枚举驱动**：drop reason / outcome / scope 一律用冻结数组，禁止自由文本驱动逻辑
5. **确定性**：同输入逐字段确定；ID 用 sha256 前 32 位
6. **fail-closed / fail-soft 明确声明**：能降级的一律降级，绝不阻断主链路
7. **测试**：`tests/smoke/smoke-test-xxx-pre.mjs`，`node --check` + 断言计数输出
8. **文件编码**：UTF-8 无 BOM；仓库为 CRLF

---

## 2. 四个参考仓库：系统性梳理

### 2.1 OpenViking（volcengine）

| 项 | 内容 |
|---|---|
| 协议 | **AGPLv3**（强传染，禁复制/翻译源码） |
| 形态 | 上下文数据库，`viking://` 虚拟文件系统 |
| 顶层 | Rust + Python + 多语言 SDK；`src/`, `crates/`, `sdk/`, `docs/` |
| 核心模块 | Client / **Retrieve**（意图分析+分层检索+rerank）/ Session / Parse / Compressor / Storage |
| 存储 | 双层：**AGFS**（L0/L1/L2 全文+多媒体+关系）+ **Vector Index**（URIs+向量+元数据，**不含文件内容**） |
| 关键算法 | 流水线 `Query → Intent Analysis → Vector Search(L0) → Rerank(L1)`；分层检索 `final_score = 0.5*embedding + 0.5*parent`，收敛 3 轮，`GLOBAL_SEARCH_TOPK=3` |
| 数据结构 | `MatchedContext{uri, context_type, is_leaf, abstract, category, score(0-1), match_reason, relations}` |
| 接口 | `find(query, target_uri, limit=10, score_threshold, filter)`；`search(…, session, limit=3)` |
| 适用场景 | 大规模资源/知识库 + Agent 技能统一管理的**服务端上下文库** |
| **复用价值** | ★★★★☆ **仅算法与接口设计**（已核实并提炼进 PROMPT-PACK §0）。实现必须独立，不得引用源码 |

### 2.2 Hindsight（vectorize-io）

| 项 | 内容 |
|---|---|
| 协议 | **MIT**（可安全参考） |
| 形态 | monorepo：`hindsight-api` / `-api-slim` / `-all` / `-cli`(Rust) / `-clients` / `-control-plane`(Next.js) / `-embed` / `-extensions` / `-integrations` / `-docs` |
| 核心引擎 | `hindsight-api-slim/hindsight_api/engine/`：`memory_engine.py`(1MB)、`entity_resolver.py`(75KB)、`embeddings.py`(105KB)、`chinese_temporal_periods.py`(86KB)、`cross_encoder.py`(77KB)、`consolidation/consolidator.py`(**157KB**) |
| 检索 | `search/`：`retrieval.py`(42KB)、`reranking.py`(20KB)、`fusion.py`(RRF)、`recall_boost.py`(rank-space)、`bm25_term_selection.py`、`temporal_extraction.py` |
| 关键算法 | 四路并行（semantic/BM25/graph-MPFP/temporal）+ RRF(k=60) + cross-encoder；**rank-space boost `1/(k+rank/d)`**；consolidation CREATE/UPDATE/DELETE + 时间标记双态；时间三价（occurred/mentioned/ingested） |
| 数据结构 | 单表 `memory_units` + `fact_type` 列（world/experience/observation，opinion 已废弃）；`entities`、`entity_links`、`memory_links`（semantic/temporal/causal/entity） |
| 依赖 | Python ≥3.11；**PostgreSQL + pgvector**（必需）；可选 TEI / 本地 sentence-transformers；heavy |
| 适用场景 | 需要高精度长期记忆、有多会话时序推理、可接受数据库运维的**服务端部署** |
| **复用价值** | ★★★★★ 算法与工程教训（踩坑注释极有价值）；**★★☆☆☆ 代码可用性——依赖 Postgres，与本项目零依赖/本地文件架构根本冲突，不可直接引入** |

### 2.3 MetaMem（OpenBMB）

| 项 | 内容 |
|---|---|
| 协议 | 论文 ACL 2026 Findings；仓库极简 |
| 形态 | 研究代码：`src/` 六文件——`train_metamem.py`(**38KB**，核心)、`eval_metamem.py`(23KB)、`infer_metamem.py`(14KB)、`construct_memory.py`(6.9KB)、`split_data.py`、`process_train_data.py` |
| 关键算法 | 四阶段：① 采样候选 + Judge 二值打分 ② 自反思（哪些碎片用了/忽略了、时序是否错、矛盾是否漏）③ 符号动作 `ADD/MOD/DEL` ④ **动作过滤消解冲突** → `E_{t+1} = Execute(E_t, Õ_t)` |
| 数据结构 | 事实记忆由 **LightMem** 构建；meta-memory 为**自然语言规则库**（符号，非权重） |
| 依赖 | 需部署大模型（Qwen3-30B/235B、Llama3.1-70B）+ SGLang + GPU |
| 适用场景 | 有 ground-truth 标注数据、追求"用得对"而非"存得多"的研究/离线优化 |
| **复用价值** | ★★★★☆ **思想层面**（符号化规则库、自反思循环、防冗余）；★★☆☆☆ 代码——依赖重型模型栈，与零依赖冲突。但**规则库可手工初始化**，不需训练即可用 |

### 2.4 MemOS（MemTensor）

| 项 | 内容 |
|---|---|
| 协议 | **Apache-2.0**（可安全参考） |
| 形态 | Python 工程：`src/memos/` 下 **28 个子模块** |
| 关键模块 | `mem_cube`（MemCube 抽象）、`mem_scheduler`、`mem_reader`、`memories`、`graph_dbs`、`vec_dbs`、`embedders`、`chunkers`、`search`、`reranker`、`mem_feedback`、`dream`、`multi_mem_cube`、`plugins`、`context` |
| 核心抽象 | **MemCube** = 元数据头（描述性/治理属性/行为指标）+ 三类载荷（plaintext / activation / parametric） |
| 关键算法 | 记忆分层调度（MemScheduler，Redis Stream）；明文→激活→参数的跨类型转换；知识图谱关联检索 |
| 数据结构 | MemCube 结构化对象（provenance / version / governance） |
| 依赖 | Python；可选 **Neo4j / PolarDB / PostgreSQL、Milvus / Qwench** 等重量级存储；`torch` 可选 |
| 适用场景 | 企业级多租户、需要治理/权限/版本/审计的记忆基础设施 |
| **复用价值** | ★★★☆☆ **治理模型**（MemCube 的 provenance/版本/过期/权限字段设计）；★★☆☆☆ 代码——依赖图数据库/向量库，与零依赖冲突。**参数化记忆（LoRA）至今仍为 placeholder，不可借鉴** |

---

## 3. 对比分析（逐一比对）

### 3.1 记忆表示

| | 本地 | Hindsight | MemOS | 差异与优势 |
|---|---|---|---|---|
| 基本单元 | Markdown 块 + `mem_xxx` 锚点；Fact 四元组 / Episode 六元组 / Procedure | `memory_units` 行 + `fact_type` | MemCube 对象 | **本地 Fact 四元组（subject/predicate/object）比 Hindsight 的自由文本更结构化**，利于精确 supersede；但 Hindsight 的 `occurred/mentioned` 时间三价**本地完全没有** |
| 索引 | `memory-index`：标题切块 + 字节区间 + digest | pgvector HNSW + tsvector + 图 | 图库 + 向量库 | 本地轻量但**无向量索引**；Hindsight 重但有语义 |
| 分层 | Procedure 六级激活（index→full） | L0/L1/L2（无） | 明文/激活/参数 | **本地已有分层范式（六级），只是未推广到记忆检索**——这是低成本切入点 |

### 3.2 检索

| | 本地 | Hindsight | OpenViking |
|---|---|---|---|
| 臂数 | 词法（BM25）+ 语义（C2/C3，仅联想侧） | 四路并行 | 向量 + 目录递归 |
| 融合 | `fuseD6Pre` **minmax**（丧失绝对性，候选≤1 退化） | **RRF(k=60) + rank-space boost** | 分数传播 + rerank |
| 重排 | 无独立 rerank | cross-encoder | L1 rerank |
| 结论 | 本地融合层是**明确短板**，Hindsight 的 rank-space 是**已验证的正确解**（有 issue#3956 反例支撑） |

### 3.3 巩固

| | 本地 | Hindsight |
|---|---|---|
| 机制 | 自动沉淀子代理 + `memory_consolidate` + 30 天蒸馏 | `consolidator.py` 157KB，CREATE/UPDATE/DELETE + 9 条规则 |
| 矛盾处理 | `fact-store` supersede（旧 revoked=true 保留） | "used to X, now Y" 时间标记双态 |
| 差异 | **本地 supersede 已接近 Hindsight 语义**（保留旧+provenance），缺的是：① NO COMPUTATION 显式约束 ② CASCADE 到所有受影响事实 ③ 趋势分类（STABLE/WEAKENING/STALE） |

### 3.4 潜在冲突（命名 / 接口 / 依赖）

| 冲突类型 | 说明 | 处理 |
|---|---|---|
| **依赖（最严重）** | Hindsight 需 PostgreSQL+pgvector；MemOS 需图库/向量库；MetaMem 需 GPU 大模型 | **一律不引入**。算法用纯 JS 重新实现（项目零依赖承诺 + BSD-3） |
| **命名**：`store` | 本地 `fact-store`/`episodic-store`/`procedure-store` 是**内存状态机**；Hindsight 的 "store" 指数据库 | 不引入其命名，沿用本地 `-store-pre.js` |
| **命名**：`memory` | 本地 `mem_xxx` 是记忆条目 ID；Hindsight `memory_units` 是表 | 无冲突（不同语境），但新增字段避免用 `unit` |
| **接口**：`recall` 签名 | 本地 `recall(query, limit=8, agent, scope)` | 新增能力**不得改此签名**，用可选参数或新函数 |
| **数据结构**：evidence | 本地已有 `evidenceFor()` 六类计数 | 直接复用，**不要另造一套 importance**（避免双源冲突） |
| **许可证** | OpenViking AGPLv3 | 只借鉴公开文档算法，实现独立 |

---

## 4. 集成方案

### 4.1 总体原则

**不引入任何新依赖；新增模块一律 `lib/xxx-pre.js` 纯函数；默认不接线，接线需配置开关可回退。**

### 4.2 需要新增/改动的文件

| 阶段 | 文件 | 动作 | 来源 | 风险 |
|---|---|---|---|---|
| **0（已完成）** | `lib/l0-extract-pre.js` | 新增 | 自研 | 无（未接线） |
| **1** | `lib/l0-index-pre.js` | 新增（L0 向量索引，增量） | OpenViking「向量索引只存 URI+向量」 | 无（未接线） |
| **2** | `lib/recall-fusion-pre.js` | 新增（rank-space 融合 + 绝对分数决策） | Hindsight `fusion.py` / `recall_boost.py` | 无（未接线） |
| **3** | `lib/index.js` 的 `recall()` | 改动：接入语义臂 + 新融合，**用配置开关** | — | 中（需回归） |
| **4** | `lib/handoff-anchor-pre.js` | 新增（四段解析 + 权重分配） | 自研 | 无 |
| **5** | `lib/index.js` 的 `buildContinueCarry()` | 改动：锚点表注入 | OpenViking 渐进加载 | 中 |
| **6** | `fact-store-pre.js` | 可选增强：加 NO COMPUTATION / CASCADE / 趋势字段 | Hindsight 巩固 9 规则 | 中高（动状态机） |
| **7** | `lib/metamem-rules-pre.js` | 新增（元记忆规则库，手工初始化） | MetaMem | 无（未接线） |

### 4.3 要适配的接口与数据结构

```js
// 新增：L0 索引条目（对齐 OpenViking「向量索引不含内容」）
{ id: 'mem_<32hex>', vector: Float32Array, l0: string, source: 'heading'|'firstSentence'|'truncate',
  l0Hash: string, updatedAt: number, scope: string }

// 新增：融合决策（对齐 Hindsight rank-space，且决策用绝对量）
{ decision: boolean,            // 绝对分数 >= 校准阈值
  ranking: Array<{id, score}>,  // 1/(k + rank/divisor)
  raw: { cosine: number, bm25: number } }   // 保留原值供审计

// 复用（不新造）：
factStore.evidenceFor(memoryId)   // seen/read/cite/reuse/success/correction
```

**不改动的既有接口**：`recall(query, limit, agent, scope)` 签名、`buildL0IndexPre` 输出、`fact-store` 的 upsert/supersede 语义。

### 4.4 依赖冲突处理

1. **Hindsight 的 Postgres**：不引入。其算法（RRF、rank-space、BM25 词选择）**不依赖数据库**，可纯 JS 实现。
2. **Hindsight 的 cross-encoder**：不引入（需模型）。本地无重排——**接受这个能力缺失**，或用 C2 的 cosine 做轻量替代。
3. **MemOS 的图数据库**：不引入。其 MemCube **治理字段设计**（provenance/version/ttl/access）是纯数据结构，可吸收进 Fact 的 provenance。
4. **MetaMem 的模型栈**：不引入。但**规则库是自然语言文本**，可手工初始化，零成本。

### 4.5 分阶段实施顺序（优先不破坏现有功能）

| 阶段 | 内容 | 接线状态 | 可回退性 |
|---|---|---|---|
| **A** | 阶段 1（L0 索引）+ 阶段 4（handoff 解析） | **不接线**，仅新增模块 + smoke | 删除文件即回退 |
| **B** | 阶段 2（融合） | 不接线 | 同上 |
| **C** | 阶段 3（recall 接线） | **配置开关默认关**，验证后开 | 关开关即回退 |
| **D** | 阶段 5（接续锚点表） | 配置开关默认关（沿用 `handoffEnabled` 模式） | 同上 |
| **E** | 阶段 6（fact-store 增强） | 后置，需独立验证 | 需备份记忆文件 |
| **F** | 阶段 7（元记忆规则库） | 不接线，实验性质 | 同上 |

**顺序理由**：A/B 零风险可并行；C/D 涉及主链路，必须开关化且做过回归再默认开；E 动状态机风险最高，放最后且需备份。

---

## 5. 风险与验证

### 5.1 回归风险

| 风险 | 触发环节 | 影响 | 缓解 |
|---|---|---|---|
| **前缀缓存失效（I1）** | 改动静态纪律层或注入内容 | 成本上升、缓存命中率下降 | 只动动态快照层；断言注入内容 hash 稳定 |
| **接续时序被破坏** | 为生成锚点新增 LLM 轮次 | 0.75 抢不过官方 0.80，助产失效 | 锚点生成必须纯解析、零额外轮次 |
| **记忆写入污染** | 巩固规则改动 | 错误事实进入长期记忆 | 阶段 E 前备份 `~/.dsh/memory`；Fact 保留 provenance 可撤销 |
| **recall 行为变化** | 阶段 C | 模型召回内容变化 | 配置开关默认关，灰度开启 |
| **凭证泄露** | 任何写入 | 违反 README 承诺 | 所有写入过 `sanitizeForWrite`；新增模块不得绕过 |
| **`xxx.js` 与 `xxx-pre.js` 不一致** | 新增模块未建 `-pre` 版 | 发布线剥名后找不到模块 | 新增即建 `-pre.js`；发布前核对 |

### 5.2 性能影响

| 项 | 预期 | 依据 |
|---|---|---|
| 索引构建 | 编码量从 ~100k token 降到 ~15k（**快约 7 倍**） | 实测 177 条，L0 平均 93 字符 vs 原文 633 |
| 查询点积 | **不变**（384 维 × 177 条，维度条数相同） | 向量维度与条数决定，与文本长度无关 |
| 返回 prefill | **快约 7 倍** | 590 字符 vs 4070 字符（5 条场景） |
| 长条目 | **不再被截断** | 最长 9822 字符原文，L0 仅 13 字符，远低于 e5 512 上限 |
| 额外开销 | L0 抽取为纯解析，**无 LLM 成本** | `l0-extract-pre.js` 零依赖纯函数 |

### 5.3 验证方式（集成是否成功）

**必跑（每次改动）**：
```bash
node --check <涉及的 lib 文件>
node tests/smoke/smoke-test-l0-extract-pre.mjs      # 18
node tests/smoke/smoke-test-handoff-pre.mjs         # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs  # 58
node tests/smoke/smoke-test-water-step-pre.mjs      # 12
node tests/smoke/smoke-test-autocont-host-pre.mjs   # 29
```
（仓库共 **54 个** smoke 文件，改动影响面大时应全跑）

**行为级断言（新增）**：
1. **字节稳定性**：相同输入两次，`buildContinueCarry()` 注入内容 hash 一致
2. **不退化**：候选数 < 3 时融合结果不全等（防 minmax flat 分支复现）
3. **零丢失**：L0 索引条目数 == 解析出的记忆条目数（177 条全量回填验证）
4. **不阻塞**：语义引擎/索引缺失时，recall 与接续**仍能返回**（fail-soft）

**人工验证清单**：
- [ ] 重启 dsh web，触发一次接续，确认材料注入正常、新会话能接上
- [ ] 触发一次 `memory_recall`，确认返回 L0 列表且可展开原文
- [ ] 检查 `~/.dsh/memory` 无意外写入
- [ ] `git status` 确认改动范围，未 commit 不发布

---

## 6. 信息不足说明（需要什么才能下更硬的结论）

以下内容本轮**未验证，不做结论**：

1. **Hindsight 完整依赖树**：只读到 `hindsight-api/pyproject.toml`（指向 `hindsight-api-slim[all]`），未展开 slim 包的依赖清单。若将来要评估"能否抽取其中纯算法部分"，需读 `hindsight-api-slim/pyproject.toml`。
2. **MetaMem 训练核心**：`train_metamem.py` 38KB 未按行读，四阶段细节来自 README 与 alphaxiv 摘要。若要落地元记忆，需精读其自反思 prompt 与动作过滤实现。
3. **MemOS 各子模块**：只列到 `src/memos/` 的 28 个目录名，未读 `mem_cube`/`mem_scheduler` 实现。若要吸收治理模型，需读 `mem_cube` 的数据结构定义。
4. **OpenViking 源码**：因 AGPLv3 主动未读。算法结论全部来自公开 API 文档与官方 skill 参考，**其源码中可能有未公开的优化细节**。
5. **本地性能实测缺失**：
   - C2（e5-small q8）在本机 CPU 上的实际编码速度（token/s）——7 倍提升是**按 token 量推算**，非实测
   - 177 条全量回填的实际耗时
   - 索引文件的实际磁盘占用
6. **L0 质量未做人工评估**：93 字符的 L0 能否支撑召回，只有召回率实验（P9/T10）能证明，目前**只有长度指标，没有质量指标**。

> 以上任一项缺失都可能导致结论偏差。**建议在执行 P9（对照实验）前，先补 5 的性能实测**——它决定"分层是否真的更省"这个核心论点是否成立。
