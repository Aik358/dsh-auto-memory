# dsh-auto-memory · RAG + Karpathy 实施方案与架构说明（v1）

> **归档说明**：本文是第二轮投喂的产出（GPT-6 Astra），承接第一轮评审（`REVIEW-gpt6astra-20260914.md`）与核实表（`CLAIM-VERIFICATION-20260914.md`）。
> 投喂操作件见 `ARCH-REVIEW-ROUND2.md`。**本会话此前已压缩过一次，本文落盘前仅存在于对话中，是唯一持久副本。**
> **性质**：待施工设计，不表示代码已修改或验收已通过；对方声明本轮未修改文件、未执行测试或 Git 写操作。
> **新增文件、函数、字段和配置均明确作为拟议接口。**

本文承接第一轮评审，直接采用核实表 C1–C12，不重新论证。以下内容是**待施工设计**，不表示代码已修改或验收已通过；本轮未修改文件、未执行测试或 Git 写操作。

新增文件、函数、字段和配置均明确作为拟议接口。S1–S10、I1–I7 保持原文；涉及解释冲突的地方，在第三部分给出推荐裁决、影响范围和相反裁决的调整办法。

## 目录

1. [① 目标态架构说明](#目标态)
2. [② 分阶段实施方案](#实施阶段)
3. [③ 准入与分档](#准入分档)
4. [④ 上一轮 A1–A3 的处置](#问题处置)
5. [⑤ 不需要做的事](#不需要做)

<a id="目标态"></a>
## ① 目标态架构说明

### 1.1 目标与组件边界

**目标：最优档使用完整的本地混合检索能力，并可启用经过对照实验的查询改写和本地精排；所有档位经过同一套状态校验、快照校验、排序结果传递和最终预算组装。**

将“生成检索结果”和“把结果交给模型”分开。检索组件不能自行注入，渲染组件不能重新排序或把摘录冒充原文。Python 与 JS 负责可替换的计算实现，宿主负责共同的流程和契约校验。

```text
                       [用户配置 / 预算 / 增强授权]
                                      |
                                      v
[记忆工具 / 自动沉淀 / 白板操作]   [查询调度器：push + pull]
             |                         |
             v                         v
      [统一写入提交门] --------> [不可变 MemorySnapshot]
             |                    |     |      |
       Markdown / 状态记录         |     |      +--> [原文块读取]
             |                    |     +---------> [Tier-0 目录]
             v                    v
      [后台增量索引调度]     [词法臂 + 一个稠密引擎]
             |                    |
     [L0 / 原文块缓存]       [共同排名融合]
             |                    |
     [JS 或 Python 引擎]     [可选本地精排]
                                  |
                            [fv2 决策 / 硬门]
                                  |
                            [Tier-1 / Tier-2]
                                  |
                         [状态、版本二次校验]
                                  |
                         [唯一动态预算组装器]
                                  |
                      [宿主输出 / 一次交付记账]
```

逐组件落点如下。表中的新增模块只承担列出的职责，不另建通用框架。

| 组件 | 现有接点或拟新增模块 | 职责与禁止跨界事项 | 档位 |
|---|---|---|---|
| 写入提交 | [memory-writer-pre.js](D:/dsh-auto-memory/lib/memory-writer-pre.js)：`MemoryDocumentStore._queue/_commit/append/replace`；拟新增 `D:/dsh-auto-memory/lib/memory-mutation-pre.js` | 预期 digest 校验、事务恢复、状态提交、写后通知；不执行嵌入 | 两档共用 |
| 统一语料与快照 | [m4-corpus-pre.js](D:/dsh-auto-memory/lib/m4-corpus-pre.js)：`buildSourceCatalog/loadCorpusSnapshot/CorpusRegistry`；拟新增 `D:/dsh-auto-memory/lib/memory-snapshot-pre.js` | 五层来源统一枚举；目录、词法、摘要、原文定位来自同一快照 | 两档共用 |
| 身份计算 | [shadow-retrieval-pre.js](D:/dsh-auto-memory/lib/shadow-retrieval-pre.js)：`memoryIndexVersion`；[memory-anchor-pre.js](D:/dsh-auto-memory/lib/memory-anchor-pre.js)：`buildSidecar` | 区分内容身份、文件版本和请求版本；不比较哈希大小 | 两档共用 |
| 索引调度 | [m7-index-sync-host-pre.js](D:/dsh-auto-memory/lib/m7-index-sync-host-pre.js)：`createIndexSyncHostPre/ensureIndexReady`；[l0-index-sync-pre.js](D:/dsh-auto-memory/lib/l0-index-sync-pre.js)：`sync` | 合并待办、保证同步前进、发布完整索引版本；查询不等待全库重建 | 两档共用 |
| 嵌入缓存 | [l0-index-pre.js](D:/dsh-auto-memory/lib/l0-index-pre.js)：`assemble/update`；[semantic-js-pre.js](D:/dsh-auto-memory/lib/semantic-js-pre.js)：`buildIndexIfStale`；[worker_semantic_pre_v1.py](D:/dsh-auto-memory/python/worker_semantic_pre_v1.py)：`build_vectors` | 只编码实际缓存未命中的输入；出处与缓存对象分离 | 两档共用 |
| 检索流程 | 拟新增 `D:/dsh-auto-memory/lib/retrieval-pipeline-pre.js`；接入 [context-host-pre.js](D:/dsh-auto-memory/lib/context-host-pre.js)：`onSegmentAccepted` 和 [index.js](D:/dsh-auto-memory/lib/index.js)：`recall` | 同一流程处理 push/pull；候选集宽度独立于注入 K | 两档共用 |
| 融合与决策 | [recall-fusion-pre.js](D:/dsh-auto-memory/lib/recall-fusion-pre.js)：`rankFusionRRFPre`；[semantic-decide-pre.js](D:/dsh-auto-memory/lib/semantic-decide-pre.js)：`decideActivationV2` | 融合负责排名，fv2 负责注入决策；保留可复算特征 | 两档共用 |
| 增强适配器 | 拟新增 `D:/dsh-auto-memory/lib/retrieval-enhancement-pre.js`；Python worker 增加精排请求处理 | 一次查询改写、本地 cross-encoder；不拥有注入出口 | 最优档 |
| 三层装配 | [tier-layer-inject-pre.js](D:/dsh-auto-memory/lib/tier-layer-inject-pre.js)：`composeTieredInjectionPre/buildTier1SectionPre/buildTier2SectionPre` | 输出完整条目，保留身份、状态、出处；不自行查盘 | 两档共用 |
| 最终预算与交付 | 拟新增 `D:/dsh-auto-memory/lib/memory-injection-budget-pre.js`；[index.js](D:/dsh-auto-memory/lib/index.js)：`renderMemoryDynamic/apply`；[activation-host-pre.js](D:/dsh-auto-memory/lib/activation-host-pre.js)：`renderTailFor` | 计量所有动态注入出口；只为实际输出的内容记交付 | 两档共用 |
| 白板闭环 | 拟新增 `D:/dsh-auto-memory/lib/wb-contract-pre.js`；[index.js](D:/dsh-auto-memory/lib/index.js)：`writePlanSnapshot/writeHandoffLedger`；[client.js](D:/dsh-auto-memory/lib/client.js)：`PlanTab/SearchTab` | 写入门、用户区保护、索引派生、lint、答案归档；不新增白板状态机 | 两档共用；矛盾检测为最优档手动增强 |

### 1.2 写入路径

```text
记忆工具 / 自动沉淀 / 白板保存
    |
    v
准备 Mutation：txId、expectedDigest、正文变化、状态变化
    |
    v
唯一提交队列
    |
    +--> 白板结构校验 / 用户区校验 / 容量检查
    |
    v
持久化恢复记录
    |
    v
原子写正文 --> 更新 sidecar --> 提交记录状态与事务结果
    |
    v
发布新的 MemorySnapshot，计算新的 miv
    |
    +--> 立即使旧候选失效
    +--> 新快照的目录、词法立即可用
    |
    v
后台索引队列：合并待办，但不反复取消正在执行的版本
    |
    v
L0 / 分块 --> 查缓存 --> 只编码 miss --> 校验完整性
    |
    v
原子发布该 miv + engineIdentity 的索引 manifest
```

**［两档共用］** 写入成功不等待嵌入完成。成功只表示正文、状态和事务结果已形成可恢复的提交；语义就绪另有状态。这样能将“记忆已保存”和“该版本的语义索引可查询”分别验收，避免把索引延迟变成写入失败。

状态提交必须先于新快照对查询可见。发生“正文已写、状态未提交”的中间故障时，受影响记录进入恢复检查，不能以默认 `current` 参与检索；其他完整来源仍可显式降级运行。

### 1.3 查询路径

```text
push：接收 observation             pull：memory_recall(query)
             \                         /
              +----> 构造 QueryRequest
                             |
                             v
                   固定一个 MemorySnapshot
                             |
                             v
              原查询 + 可选一次改写（最多两条）
                             |
                             v
           独立词法召回 + 当前选定引擎的稠密召回
                             |
                             v
                current / scope / miv 校验
                             |
                             v
                  共同 RRF 排名与去重
                             |
                             v
                 可选 cross-encoder 精排
                             |
                             v
              fv2 / echo / correction / 冷却门
                             |
                 +-----------+-----------+
                 |                       |
              无需下探                需要下探
                 |                       |
              Tier-0          Tier-1 或经校验的 Tier-2
                 \                       /
                  +--> 最终状态与版本校验
                             |
                             v
                  完整条目选择 + 全局预算
                             |
                   +---------+---------+
                   |                   |
             自动注入及交付         pull 工具返回
```

**［两档共用］** Python 在目标态提供稠密查询和可选精排服务，主查询路径的融合、决策、最终排序在宿主统一执行。其余已有观察、证据等功能不随此次迁移删除；只解除 Python 对主路径激活决策的重复所有权。

**［两档共用］** 自动注入采用 `Tier-0 + Tier-1` 或 `Tier-0 + Tier-2`。进入 Tier-2 后，不再重复灌入同一条的完整 Tier-1 摘要正文；摘要仍用于内部选取。原文读取是一次检索结果的展开，不构成多轮检索。

**［两档共用］** 原文读取放在可等待的 pre-step 准备阶段，同步渲染回调只消费准备结果。现有等待接点在 [index.js:7386](D:/dsh-auto-memory/lib/index.js:7386)；现有动态出口在 [index.js:7437](D:/dsh-auto-memory/lib/index.js:7437) 和 [index.js:7515](D:/dsh-auto-memory/lib/index.js:7515)。这三处共同接线，不能只修中间装配函数。

### 1.4 层间数据结构

以下类型记法用于说明设计，实施仍使用 JavaScript ESM 与 JSDoc，不引入 TypeScript 构建依赖。

```typescript
type Layer = 'user' | 'project' | 'log' | 'reflection' | 'whiteboard';
type Status = 'current' | 'superseded' | 'retracted';

type SnapshotRef = {
  workspaceKey: string;
  miv: string;
  recordStateVersion: number;
};

type SourceVersion = {
  sourceRef: string;
  sourceEpoch: string;
  sourceVersion: number;
  fileDigest: string;
};

type RecordView = {
  memoryId: string;
  layer: Layer;
  status: Status;
  sourceRef: string;
  recordDigest: string;
  l0: string;
  byteStart: number;
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
};

type ChunkRef = {
  chunkId: string;
  memoryId: string;
  recordDigest: string;
  chunkDigest: string;
  byteStart: number;   // 源文件中的 UTF-8 字节区间
  byteEnd: number;
  lineStart: number;
  lineEnd: number;
};

type MemorySnapshot = SnapshotRef & {
  sourceVersions: SourceVersion[];
  records: RecordView[];
  chunks: ChunkRef[];
  degradations: string[];
};

type QueryRequest = {
  requestKey: string;
  observationId: string | null;
  sessionId: string;
  contextVersion: number;
  step: number;
  workspaceKey: string;
  scope: string;
  query: string;
  snapshot: SnapshotRef;
  deadlineAt: number;
};

type RankedHit = {
  memoryId: string;
  chunkId: string | null;
  miv: string;
  layer: Layer;
  status: Status;
  sourceRef: string;
  recordDigest: string;
  excerpt: string;
  denseScore: number | null;
  lexicalScore: number | null;
  fusionScore: number;
  fusionRank: number;
  rerankScore: number | null;
  finalRank: number;
};

type RetrievalResult = {
  requestKey: string;
  snapshot: SnapshotRef;
  engineIdentity: string | null;
  hits: RankedHit[];
  ordering: 'rrf' | 'cross-encoder';
  featureVersion: string;
  decision: object;
  degradations: string[];
};
```

**［两档共用］** 缺失稠密分使用 `null`，不补成相似度零。`finalRank` 是排序结果，不能替代相似度；渲染次序与 S5.4 的关系依照第三部分 R1 执行。

`sourceRef` 必须经快照解析到允许的来源文件。候选携带的任意路径不能直接传给文件读取函数；块内容键也不能作为权限或出处身份。

### 1.5 函数接口签名

下列均为目标签名；现有公共记忆工具名称保持不变，内部返回结构统一扩展到两档。

| 接口 | 目标签名与返回值 | 落点 |
|---|---|---|
| 提交记忆变更 | `commitMemoryMutationPre({txId, expectedMiv, writes, stateChanges}) -> Promise<{ok, written, miv?, txId, reason?}>` | 拟新增 `memory-mutation-pre.js`；调用 `MemoryDocumentStore` |
| 捕获快照 | `captureMemorySnapshotPre({workspaceKey, sources, recordStates}) -> MemorySnapshot` | 拟新增 `memory-snapshot-pre.js` |
| 检验候选 | `validateHitSnapshotPre({hit, snapshot}) -> {ok, reason?}` | 同上；召回和注入两处调用 |
| 规划编码增量 | `planEmbeddingDeltaPre({engineIdentity, previousAliases, vectorPool, inputs}) -> {aliases, missingInputs, removedAliases, stats}` | 拟新增 `D:/dsh-auto-memory/lib/embedding-cache-plan-pre.js` |
| L0 更新 | `update({path, items, snapshot, engineIdentity}) -> Promise<{miv, encoded, aliasReused, contentReused, removed}>` | `l0-index-pre.js:createL0IndexPre` |
| 入队同步 | `enqueueSnapshotPre({snapshot, reason}) -> {ticket, queuedMiv}` | `m7-index-sync-host-pre.js:createIndexSyncHostPre` |
| 查询就绪状态 | `getSnapshotReadinessPre({snapshot, engineIdentity}) -> {ready, reason, buildingMiv?}` | 同上；不得触发同步等待 |
| 执行检索 | `retrieveMemoryPre(request, {snapshot, lexical, dense, rewrite, rerank, policy}) -> Promise<RetrievalResult>` | 拟新增 `retrieval-pipeline-pre.js` |
| 排名融合 | 保留 `rankFusionRRFPre(pairs, opts)`；新增 `rankFusionListsPre({lists, k, divisor}) -> RankedHit[]` | `recall-fusion-pre.js` |
| 读原文块 | `readVerifiedMemoryChunkPre({snapshot, chunk, signal}) -> Promise<{ok, text?, chunk?, miv, reason?}>` | `memory-snapshot-pre.js`；由 `index.js` 接入 |
| 保存激活投影 | `recordTierGateHits(req, result) -> {requestKey, miv, contextVersion, observationId, hits}` | `activation-host-pre.js` |
| 准备注入 | `prepareMemoryInjectionPre(agent, {step, deadlineAt, signal}) -> Promise<PreparedInjection>` | `index.js` 新增方法 |
| 三层内容装配 | `composeTieredInjectionPre({snapshot, hits, verifiedBlocks, question, limits}) -> {items, level, degradations}` | `tier-layer-inject-pre.js` 替换内部接口 |
| 最终动态组装 | `composeMemoryEnvelopePre({requestKey, snapshot, items, dynamicSections, tailPacket, limits}) -> FinalEnvelope` | 拟新增 `memory-injection-budget-pre.js` |
| 检查待交付尾注 | `peekClaimedPre(agent, {miv, step}) -> {ok, packet?, text?, exactDigest?, reason?}` | `activation-host-pre.js` 新增，无 seen 副作用 |
| 确认交付 | `commitClaimedDeliveryPre(agent, {packetId, exactDigest, requestKey, step}) -> {ok, duplicate}` | 同上；幂等 |
| 白板写入检查 | `validateWhiteboardWritePre({before, after, changes, actor, expectedDigest}) -> {ok, cards, errors}` | 拟新增 `wb-contract-pre.js` |
| 白板 lint | `lintWhiteboardPre({cards, links, glossary, now, staleDays}) -> {findings, coverage}` | 同上；只报告 |
| 归档结论 | `archiveAnswerPre({requestId, target, title, conclusion, evidenceRefs}, agent) -> Promise<{ok, memoryId?, path?, miv?, reason?}>` | `index.js` 新增方法，进入统一提交门 |

最终返回结构至少包含：

```typescript
type FinalEnvelope = {
  requestKey: string;
  miv: string;
  text: string;
  chars: number;
  bytes: number;
  estimatedTokens: number;
  actualTokens: number | null;
  includedIds: string[];
  omitted: Array<{memoryId: string; reason: string}>;
  deliveredPacketId: string | null;
  degradations: string[];
};
```

内部诊断信息不必全部塞入模型上下文；身份、状态、出处和必要降级说明必须随保留内容输出。计数由最终文本和实际保留条目计算。

### 1.6 状态、版本与持久化所有权

| 对象 | 存在哪里 | 谁更新 | 谁校验 |
|---|---|---|---|
| 正文 | 现有 Markdown 文件 | 统一提交门调用现有 writer | writer 重读 digest；快照加载器 |
| `sourceEpoch/sourceVersion` | 现有 sidecar | `buildSidecar`；内容变化增加文件版本，重建身份按既有规则处理 | 快照加载器、原文块读取器 |
| `status/supersededBy` | 拟新增、按原始 `memoryId` 保存的状态清单；sidecar 可含派生投影 | `commitMemoryMutationPre` 是唯一写入者 | 召回、展开、注入 |
| `recordStateVersion` | 状态清单 | 状态事务成功时递增；无变化不递增 | 快照生成与失效判断 |
| `miv` | 快照对象、索引 manifest、查询结果、激活投影 | 由排序后的来源身份及状态清单摘要计算 | 查询、索引发布、原文读取、最终注入 |
| `contextVersion` | 现有会话 runtime | 现有会话观察机制 | 查询归属、激活投递；不能替代 `miv` |
| `requestKey` | 当前 runtime 的准备结果 | 每次 pre-step/查询分配 | 异步完成时、最终渲染时 |
| `engineIdentity` | 缓存 manifest 与查询诊断 | 引擎适配器根据模型及处理配置产生 | 查缓存、索引加载、查询 |
| `chunkId` | 当前快照的块清单 | 保留现有 `chunk_id_for` 规则 | 原文定位与一级缓存引用 |
| `vectorKey` | 引擎独立的向量对象池 | 对实际编码输入计算摘要 | 嵌入缓存，不用于来源授权 |

`miv` 是哈希身份，**不递增、不做大小比较**。先后顺序由事务序号、调度 ticket 和当前请求键决定。状态单独改变也必须改变 `miv`，否则撤回后仍可能命中旧结果。

**［两档共用］** 新索引写入新命名空间，先形成完整 bundle，再原子替换 manifest 指针。保留旧完整 bundle 用于恢复，但查询只有在 `miv` 与引擎身份匹配时才能使用它。新快照的语义索引未就绪时，使用新快照自己的词法和目录，不混入旧快照命中。

### 1.7 保留块身份，增加计算复用

按照第一轮结论，不能只把现有 `chunkId` 塞进缓存就宣称完成细粒度增量。推荐使用两级引用：

```text
一级：engineIdentity + chunkId
          |
          v
      当前块的 alias
          |
          v
二级：engineIdentity + hash(exactEncoderInput)
          |
          v
       实际向量对象
```

**［两档共用］** 一级仍包含 S1.1/S1.2 要求的引擎身份和块 ID；二级依据块的实际编码输入复用向量。记录改变导致未改块重新编号时，只更新 alias，不重新编码相同输入。

`exactEncoderInput` 必须包含实际 passage 前缀、预处理结果或 token ID 序列；模型、tokenizer、池化、归一化及处理版本进入引擎身份。对展示摘录做哈希不足以证明编码输入一致。

该设计兑现核实表要求的“按块内容复用”，不修改现有 `chunkId` 公式，也不把缓存对象误当作记忆条目。

---

<a id="实施阶段"></a>
## ② 分阶段实施方案

### 2.1 依赖顺序与验收方式

```text
Phase 0：注入边界和数值口径
    |
    v
Phase 1：状态提交与统一快照
    |
    +--------------------> Phase 4：白板闭环
    |
    v
Phase 2：真增量缓存与同步
    |
    v
Phase 3：共同检索、融合与决策
    |                         |
    +----------+--------------+
               v
Phase 5：对照实验与最优档增强
               |
               v
Phase 6：分档运行验收与发布
```

- **［两档共用］** Phase 0 未通过，不接入新的在线算法。
- **［两档共用］** Phase 1 未通过，不发布差量索引或启用白板状态写入。
- **［两档共用］** Phase 2、3 的纯模块与 Phase 4 的纯校验模块可以并行开发；涉及同一个 `index.js` 的接线串行合并。
- **［最优档］** Phase 5 的增强适配器可用替身提前开发，但真实启用依赖 Phase 2、3、4 的稳定语料和结果。
- **［两档共用］** Phase 6 不以“测试数量”作为指标，以指定断言、失败注入与真实运行记录作为发布材料。

拟新增套件统一命名为：

`D:/dsh-auto-memory/tests/smoke/smoke-test-rag-phase<N>-pre.mjs`

全部由 Node 启动，使用 `node:assert/strict`、替身 IO 和可注入时钟，零第三方测试依赖。涉及持久化的测试只使用隔离临时目录；涉及 Python 的测试由 Node 串行启动标准库测试入口并检查退出码和 JSON 结果。缺少真实 Python 运行环境时，标记该档“未执行”，不得当作通过。

以下断言编号用于第四部分索引。

### Phase 0：修复实际注入边界

**1. 目标［两档共用］：** 最终输出同时守住状态、版本、完整条目和总预算约束。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| [activation-host-pre.js](D:/dsh-auto-memory/lib/activation-host-pre.js)：`recordTierGateHits` | 替换 | 使用 1.5 签名，投影携带 `miv/contextVersion/observationId/requestKey`；不得仅凭时间复用 |
| [tier-layer-inject-pre.js](D:/dsh-auto-memory/lib/tier-layer-inject-pre.js)：`composeTieredInjectionPre/buildTier1SectionPre/buildTier2SectionPre` | 替换 | 先验证 current 与快照归属，再组装完整条目；删除逐行裁剪方案 |
| 拟新增 `D:/dsh-auto-memory/lib/memory-injection-budget-pre.js`：`composeMemoryEnvelopePre` | 新增 | 统一计算正文、目录、白板、账本、reflection request、尾注、标题及分隔符 |
| [activation-host-pre.js](D:/dsh-auto-memory/lib/activation-host-pre.js)：`renderTailFor` | 拆分 | 新增 `peekClaimedPre/commitClaimedDeliveryPre`，将读取与交付副作用分开 |
| [index.js](D:/dsh-auto-memory/lib/index.js)：`apply/renderMemoryDynamic/buildTierLayerInjection` | 替换、仅接线 | pre-step 先刷新与校验，再准备；统一动态出口，原独立尾注出口退出 |
| 拟新增 `D:/dsh-auto-memory/lib/memory-budget-pre.js`：`resolveMemoryLimitsPre(config)` | 新增 | 集中默认值、硬上限、单位、配置合法性；返回 `{ok, limits, errors}` |
| [smoke-test-doc-code-consistency-pre.mjs](D:/dsh-auto-memory/tests/smoke/smoke-test-doc-code-consistency-pre.mjs)：字段检查 | 替换 | 覆盖全部预算字段与相互约束；只生成或校验数值附表，不改条款正文 |

C10 的施工位置采用核实后的 [tier-layer-inject-pre.js:327](D:/dsh-auto-memory/lib/tier-layer-inject-pre.js:327)；C11 对应 [index.js:3986](D:/dsh-auto-memory/lib/index.js:3986)。直接按核实结果修复，不再重新取证。

组装器先保留最小目录、边界标记和有界降级说明，再选证据和其他动态内容。删除完整条目后重新计算说明及计数，直至最终序列化长度达标；不允许在最后一次计量后追加未计费文本。

Phase 0 将已封装尾注视为不可拆包：整体放得下才输出。不能在 `exactDigest` 封装后截断尾注；后续精细分配必须发生在封包前。

**3. 能失败断言：**

- **T0-1 状态：** 混合 current、superseded、retracted 候选直接进入实际注入入口；只保留 current 及其正文通过，旧条目出现或全部清空冒充成功失败。
- **T0-2 版本：** A 快照产生候选、B 快照准备输出；A 正文不出现且包含版本降级原因通过，A/B 混装失败。
- **T0-3 预算：** 同时启用所有动态段，遍历条目边界前后各一字符的预算；`text.length <= limit`、计数匹配、UTF-8 完整通过，超限或半条出处失败。
- **T0-4 交付：** 被预算排除的尾注 `seen=0`，重复渲染同一请求 `seen=1`，原尾注出口为空；任一不满足失败。
- **T0-5 异步：** 新请求先完成、旧请求后完成；最终 runtime 保留新 `requestKey` 通过，旧结果覆盖失败。
- **T0-6 数值：** 分别改变默认值、硬上限、单位或文档声明；不一致必须非零退出，数值一致但实际超限也必须失败。
- **T0-7 常驻：** 寒暄、日志冷却、无命中、索引未就绪均有受预算约束的 Tier-0 或明确空目录；整个目录被旧冷却分支跳过失败。

**4. 回滚动作：** 新增 `memoryInjectionMode='catalog-only'`，关闭 `memoryEvidenceBlocksEnabled`，保留新预算组装器及状态、版本检查。还原范围仅限本阶段的深层准备和尾注接线，不恢复已认证有缺陷的双出口扣账。若预算组装器本身故障，停用自动注入并记录停用原因，不把旧实现称作合规回退。

**5. 成本：** 额外 LLM 调用 token 为 0；增加一次最终计量和校验，时间与输出长度、候选数有关，具体延迟待测。每 runtime 只保留一个当前准备结果；无新增模型或第三方依赖。保留元数据会占用原注入额度。

**6. 风险与未决项：** 唯一动态出口可能改变宿主去重及交付时机，必须通过 T0-4 和 Phase 6 验证。推荐预算边界见 R3。Phase 0 不声称已经补齐持久撤回写入，后者由 Phase 1 完成。

### Phase 1：统一状态提交与快照

**1. 目标［两档共用］：** 每次成功写入形成一个可恢复、可检索且状态一致的快照。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| 拟新增 `D:/dsh-auto-memory/lib/memory-mutation-pre.js`：`commitMemoryMutationPre/recoverMemoryMutationsPre` | 新增 | 全插件提交队列、恢复记录、状态清单与写后通知 |
| [memory-writer-pre.js](D:/dsh-auto-memory/lib/memory-writer-pre.js)：`MemoryDocumentStore._commit` | 扩展 | 提交后回调携带 `txId/digest/dirty/sourceVersion`；dirty 不得伪装完整状态提交 |
| [index.js](D:/dsh-auto-memory/lib/index.js)：`appendText/writeFull/writeFullSingle/writePlanSnapshot` | 仅接线 | 所有相关写入进入共同提交门，工具不自行发布半更新的内存状态 |
| [m4-corpus-pre.js](D:/dsh-auto-memory/lib/m4-corpus-pre.js)：`buildSourceCatalog/loadCorpusSnapshot/CorpusRegistry` | 替换、扩展 | 五层来源统一；损坏来源显式隔离；其他来源仍可读 |
| [shadow-retrieval-pre.js](D:/dsh-auto-memory/lib/shadow-retrieval-pre.js)：`memoryIndexVersion` | 扩展 | 纳入状态清单摘要及快照格式版本；仍返回哈希身份 |
| 拟新增 `D:/dsh-auto-memory/lib/memory-snapshot-pre.js`：`captureMemorySnapshotPre/validateHitSnapshotPre` | 新增 | 形成只读快照，提供 membership、状态及来源校验 |

事务恢复记录必须在修改正文前持久化，包含预期旧 digest、目标 digest、待提交状态和恢复所需内容。恢复时以实际 digest 判断继续完成或报告冲突；不能把已经成功写入的正文直接恢复成旧副本，覆盖作者后续修改。

supersede 由“新增声明＋旧 ID 状态变化”组成，原记录保持可审计。普通撤回不物理删除原文。状态清单是原始记忆状态的唯一持久所有者，fact/procedure 等派生存储不得反向充当其状态真源。

**3. 能失败断言：**

- **T1-1 提交：** 成功提交后重启读取，正文、状态和 `miv` 同时可见通过，成功返回但状态丢失失败。
- **T1-2 故障：** 在每个持久化步骤注入异常后恢复；得到完整旧提交或完整新提交通过，半提交被当作 current 失败。
- **T1-3 撤回：** 先召回后撤回再注入；撤回 ID 在检索和注入两处均消失、审计仍可定位通过。
- **T1-4 并发：** 两个插件内写入并发，加一次外部 digest 冲突；内部写入不丢失、外部冲突拒绝覆盖通过。
- **T1-5 版本：** 仅状态变化时 `miv` 必变；完全不变提交时 `miv` 不变；按哈希字典序决定新旧失败。
- **T1-6 来源：** 五层各放一条合法记录并破坏其中一个来源；四层可检索且报告损坏来源通过，整链空白失败。

**4. 回滚动作：** 设置 `memoryMutationMode='readonly'`，保留状态读取、恢复和 Phase 0 校验；恢复本阶段 writer 接线前的代码必须同时禁止写入。不得回滚已提交 tombstone，也不得让旧代码忽略状态清单继续注入。

**5. 成本：** 额外 LLM token 为 0；每次写入增加恢复记录、状态提交和快照构建 IO。常驻增加有界快照及状态索引；磁盘增加事务记录和状态清单，无新增第三方依赖。成功写入不等待语义模型。

**6. 风险与未决项：** 是否存在多个宿主进程共享同一记忆目录属于 U2。推荐初版只允许一个写入 owner，第二个 owner 进入只读；进程内队列不能被宣称为跨进程锁。损坏状态清单必须恢复，不能用全体 current 兜底。

### Phase 2：兑现真增量与同步前进

**1. 目标［两档共用］：** 实际编码量随变化输入增长，持续写入不再反复作废已开工同步。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| [l0-index-pre.js](D:/dsh-auto-memory/lib/l0-index-pre.js)：`assemble/update/buildFull` | 替换 | 先分类缓存命中，再调用 embedder；返回真实 `encoded` 等计数 |
| 拟新增 `D:/dsh-auto-memory/lib/embedding-cache-plan-pre.js`：`planEmbeddingDeltaPre/materializeEmbeddingDeltaPre` | 新增 | 一级 alias、二级内容向量池、缺失输入去重与结果校验 |
| [semantic-js-pre.js](D:/dsh-auto-memory/lib/semantic-js-pre.js)：`buildIndexIfStale/embedPassages` | 替换、接线 | 使用同一 miss 计划，不在查询入口全量编码 |
| [worker_semantic_pre_v1.py](D:/dsh-auto-memory/python/worker_semantic_pre_v1.py)：`build_vectors/handle_index_commit` | 替换 | Python 采用相同缓存语义，发布完整 bundle |
| [m7_embedding_pre_v1.py](D:/dsh-auto-memory/python/m7_embedding_pre_v1.py)：`chunk_id_for` 及分块辅助函数 | 保留、新增 | 保留 ID 公式；新增块原文字节区间、`chunkDigest`、实际输入摘要 |
| [m7-index-sync-host-pre.js](D:/dsh-auto-memory/lib/m7-index-sync-host-pre.js)：`ensureIndexReady/ensureWorkspaceIndexReady` | 替换 | worker 级单飞、每工作区最新 pending、公平调度、最大合并等待 |
| [index-sync-pre.js](D:/dsh-auto-memory/lib/index-sync-pre.js)：`buildIndexSyncPlansPre/sendIndexSyncPlanPre` | 扩展 | 后半阶段增加 `baseMiv/targetMiv/upserts/tombstones` |
| [worker_pre_v1.py](D:/dsh-auto-memory/python/worker_pre_v1.py)：`handle_index_begin/page/commit` | 扩展 | 差量 base 校验、暂存、幂等提交；不匹配时请求完整快照 |
| [l0-index-sync-pre.js](D:/dsh-auto-memory/lib/l0-index-sync-pre.js)：`sync` | 仅接线 | 共用快照和调度，不再独立决定语料身份 |

C5 按修正位置 [l0-index-pre.js:126](D:/dsh-auto-memory/lib/l0-index-pre.js:126) 和 `:127` 施工；计数调整落在核实表 C6 对应返回结构。

按三个小步交付：**2A L0 真增量 → 2B 原文缓存与完整 manifest → 2C 差量传输**。2B 可以仍传完整快照，但只编码 miss；这样先验证计算增量，再承担传输协议变化。

调度时间取：

```text
开工时间 = min(lastDirtyAt + debounceMs, firstDirtyAt + maxWaitMs)
```

后续写入更新 pending，不重置 `firstDirtyAt`。正在执行的版本只因明确超时、关闭、引擎 epoch 变化或数据损坏终止，不因新 `miv` 到来反复取消。缓存切换沿用 OR，引擎失败当轮直接词法降级，不在同一轮偷偷再跑另一个向量空间。

**3. 能失败断言：**

- **T2-1 L0：** 记录真实 embedder 输入；不变更新为 0，单新增为新增输入数，状态变化为 0；只看返回计数不算通过。
- **T2-2 块复用：** 固定三块记录只改末块；前两块即使新 `chunkId`，alias 仍指向旧向量对象，实际只编码一个变化输入通过。
- **T2-3 输入身份：** 模型、tokenizer、前缀、归一化任一变化必须缓存 miss；不同引擎共享向量失败。
- **T2-4 删除：** 删除或撤回只移除有效 membership/alias，实际 encode 为 0，且旧内容不可检索。
- **T2-5 调度：** 虚拟时间每 50ms 写入，设测试参数 debounce=200ms、maxWait=1000ms；首次任务不晚于 1000ms 开工、后续写入不 abort active、worker active 数不超过 1 才通过。
- **T2-6 发布：** 每个 bundle 写入步骤故障后重启；不得出现 records 与 vectors 分属两个 `miv` 的 ready 状态。
- **T2-7 差量：** base 不匹配拒绝差量并完成一次完整同步；同一 tx 重放无重复，缺页不得发布。
- **T2-8 真适配器：** Node 串行调用 Python 标准库替身编码器，核对实际输入与 JS planner 的同组 fixture；仅 Node 协议替身通过不能代替此项。

**4. 回滚动作：** 先设 `indexDeltaSyncEnabled=false` 回到完整快照传输；必要时设 `embeddingCacheV2Enabled=false`，使用同快照词法路径。还原本阶段索引、worker、缓存文件的调用代码，保留 Phase 1 状态和 Phase 0 校验；旧、新缓存目录均不就地覆盖。

**5. 成本：** 额外 LLM token 为 0。首次建新缓存编码所有唯一输入，后续仅 miss；规划仍需遍历摘要或块清单，不能宣称全部处理均为 O(变化量)。内存包括当前与构建中 manifest、一个有界编码批次；磁盘包括 alias 和向量对象池。无新增模型依赖。

**6. 风险与未决项：** 前部插入可能改变真实分块边界，此时变化输入必须重新编码，T2-2 不承诺任意编辑都只重嵌一个块。生产 debounce、maxWait、缓存容量待 U1 实测；上述毫秒数仅是确定性测试参数。初版不做激进 GC，只回收不被已发布或在读快照引用的对象。

### Phase 3：统一召回、融合与决策

**1. 目标［两档共用］：** push/pull 共用候选与排名流程，排序结果不会在后续投影或预算中丢失。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| 拟新增 `D:/dsh-auto-memory/lib/retrieval-pipeline-pre.js`：`retrieveMemoryPre` | 新增 | 固定快照、独立召回、状态过滤、融合、决策、结果封装 |
| [context-host-pre.js](D:/dsh-auto-memory/lib/context-host-pre.js)：`onSegmentAccepted` | 替换 | 调共同流程，不再调用生产 D6 分数加权 |
| [index.js](D:/dsh-auto-memory/lib/index.js)：`recall/_jsDecide` | 替换、接线 | pull 使用同一结果；公共工具继续渲染既有返回形式 |
| [recall-fusion-pre.js](D:/dsh-auto-memory/lib/recall-fusion-pre.js)：`rankFusionRRFPre` | 保留核心、扩展输入 | 复用既有 `k/divisor`；补多列表入口、稳定去重与 rank 元数据 |
| [semantic-js-pre.js](D:/dsh-auto-memory/lib/semantic-js-pre.js)：`fuseD6Pre` | 删除生产引用 | 只作为对照 fixture 保留，后续清理导出另行机械检查 |
| [worker_semantic_pre_v1.py](D:/dsh-auto-memory/python/worker_semantic_pre_v1.py)：`handle_recall_rank/_handle_context_push_impl/hybrid_rank` | 扩展、解除主路径调用 | 宿主拥有主路径融合和激活；worker 返回稠密候选与来源身份 |
| [semantic-decide-pre.js](D:/dsh-auto-memory/lib/semantic-decide-pre.js)：`decideActivationV2` | 保留决策核、扩展外围 | 新增共同 `buildDecisionFeaturesPre(result, context)`，输出带版本的快照 |
| [activation-inbox-pre.js](D:/dsh-auto-memory/lib/activation-inbox-pre.js)：`dedupeCandidates/renderReferenceTail` | 替换 | 传递排名元数据，不按裸稠密分重新决定候选选择 |
| [tier-layer-inject-pre.js](D:/dsh-auto-memory/lib/tier-layer-inject-pre.js)：两层渲染函数 | 替换 | 按约定顺序消费完整条目；实施 R1 后由 `finalRank` 决定展示 |

词法臂必须独立扫描允许语料，不能只给稠密 top-K 打词法分，否则词法独有候选无法进入融合。初始试验设每臂最多 32 个候选，最终 Tier-1 仍受 K 限制；32 是可调整的候选预算，不是修改 K。

多查询先在每个臂内融合，再融合词法与稠密两臂。原查询和改写查询不能通过重复命中同一个 ID 无限叠加票数。无改写时直接走现有双臂排名核心。

决策同时记录 `denseTop/denseMargin/fusionMargin`，明确它们的来源；策略消费哪个 margin 必须带 `featureVersion/policyVersion`。不把新分布直接套进旧阈值。校准与上线按 R2、Phase 5 执行。

**3. 能失败断言：**

- **T3-1 秩不变性：** 每臂排名不变、分数间距改变；融合 ID 顺序不变通过，否则失败。
- **T3-2 顺序贯穿：** 输入融合序与稠密序相反的 fixture；在 R1 模式下，选取、封包、裁剪、最终输出保留同一相对顺序通过。
- **T3-3 臂独立：** 词法独有候选能进入融合；关闭稠密后仍返回它且标注降级通过。
- **T3-4 决策一致：** 两适配器提供同一候选、纠正证据和上下文；共同特征与硬门结果一致通过，任一端漏掉纠正门失败。
- **T3-5 数据含义：** 缺稠密分保持 `null`；RRF 分不写成相似度；feature 版本与策略不兼容时拒绝在线启用。
- **T3-6 所有权：** 同一 observation 只能形成一个主路径 activation；宿主和 worker 同时 emit 失败。
- **T3-7 重复查询：** 同一列表重复同一 ID 不增加其贡献；原查询＋两改写的 ID 及 rank 可复算通过。

**4. 回滚动作：** 将新增 `retrievalPipelineMode='shadow'` 或 `'off'`，关闭在线增强，Phase 0 使用目录或同快照词法降级。还原 `context-host/index/worker` 的主路径接线时，不恢复 D6 作为“合规基线”；保持排名诊断和状态校验。

**5. 成本：** 基础路径额外 LLM token 为 0；融合主要为各列表排序与合并，内存随候选上限有界。Python 路径增加宿主接收候选的传输及处理成本，具体延迟待测。无新增本地模型。

**6. 风险与未决项：** R1 决定在线展示次序，R2 决定决策特征校准。两项未确认不阻止纯函数、投影和 shadow 实验，但禁止宣布新排序已符合 S5.4 或直接放量。worker 接口须有能力协商；旧 worker 不支持时退词法，不能同时保留双激活来源。

### Phase 4：完成白板的写入、检索与归档闭环

**1. 目标［两档共用］：** 白板经过同一个写入门进入记忆语料，结论可以一次操作归档并再次检索。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| 拟新增 `D:/dsh-auto-memory/lib/wb-contract-pre.js`：`parseWhiteboardPre/validateWhiteboardWritePre/deriveWhiteboardIndexPre/lintWhiteboardPre` | 新增 | 锚点、卡片集合、用户区、索引、lint 的确定性处理 |
| [index.js](D:/dsh-auto-memory/lib/index.js)：`writePlanSnapshot` | 替换 | 所有预处理完成后比对最终待写版本；通过 Phase 1 提交 |
| [index.js](D:/dsh-auto-memory/lib/index.js)：`writeHandoffLedger` | 仅接线 | 账本保持历史追加，状态段只引用白板 |
| [m4-corpus-pre.js](D:/dsh-auto-memory/lib/m4-corpus-pre.js)：`buildSourceCatalog` | 仅接线 | 使用 Phase 1 的白板来源，不另造白板索引身份 |
| [index.js](D:/dsh-auto-memory/lib/index.js)：`archiveAnswerPre` | 新增 | 按目标保存卡片、记忆或 handoff；使用 `requestId` 防重复点击 |
| [client.js](D:/dsh-auto-memory/lib/client.js)：`SearchTab/PlanTab` | 新增局部控件 | 对已有分析结果提供归档操作；手动 lint 入口；不重做看板界面 |

新增写入签名：

```typescript
writePlanSnapshot(projectDir, content, {
  expectedDigest,
  actor: 'model' | 'user',
  changes: {
    renamed: Array<{oldId: string; newId: string}>;
    archived: Array<{id: string; reason: string; at: number}>;
  }
})
// -> Promise<{ok, path?, addedIds?, changedIds?, miv?, errors?}>
```

模型提交必须原样带回用户区，缺失或改动就拒绝；不能在拒绝后自动补一段“看起来相同”的文本。改标题需新 ID 与旧 ID supersede 同事务提交；同页重名导致 ID 冲突时拒绝写入。

现有白板历史搬移也必须作为显式 archive 操作接受检查，不能绕过最终卡片集合比较。`archived` 是位置与审计记录，不增加第四种记忆状态。

确定性 lint 的操作定义见 R5。语义矛盾检测只手动触发，在 Phase 5 接入模型；模型不可用时明确返回该项未检查，不能显示“无矛盾”。

**3. 能失败断言：**

- **T4-1 写入门：** 少一张卡且无 archive/rename 记录时拒写，正文和用户区字节均不变。
- **T4-2 身份：** 同页重排 ID 不变；改名产生新 ID、旧 ID 状态变更与留痕同时可见。
- **T4-3 人机边界：** 模型更改用户区一个字节即拒写；合法模型区修改不改变用户区。
- **T4-4 同源索引：** 白板派生项与进入快照的记录身份一致；Tier-0 输出是经过状态、配额和预算选择后的同源子集。
- **T4-5 lint：** 给每条确定性规则一正一负 fixture，输出准确 finding；缺少语义检查显示 `notChecked`，不返回假阴性结论。
- **T4-6 回流：** 同一个归档 `requestId` 点击两次只新增一条；随后 recall 与展开能定位其结论和证据引用。
- **T4-7 写入冲突：** 用户在模型读后修改白板，旧 `expectedDigest` 的提交拒绝覆盖。

**4. 回滚动作：** 设置 `whiteboardWriteEnabled=false`、关闭新增归档按钮和矛盾检查入口；还原 `client.js` 局部控件以及 `writePlanSnapshot` 新入口调用。保留已提交状态及只读白板检索，不能重新允许绕过写入门整篇覆盖。

**5. 成本：** 确定性解析、校验、归档新增 LLM token 为 0；时间随页面长度与引用数增长。常驻只缓存当前白板解析结果，持久数据复用正文、状态和审计记录。矛盾检测成本单列 H3。

**6. 风险与未决项：** 老白板缺锚点或用户区时，先生成迁移预览，再由作者确认应用；不能把未分区文字自动认作可由模型覆盖。R5 定义 lint 的确定性范围；全文语义关系判断不在零 token 规则验收中。

### Phase 5：实验、最优档改写与精排

**1. 目标［最优档优先；两档共用实验框架］：** 用可复现对照决定增强与预算是否启用，而不是以方案存在代替收益验收。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| 拟新增 `D:/dsh-auto-memory/tools/evaluate-retrieval-pre.mjs`：`runEvaluationPre/evaluateCasePre` | 新增 | 固定语料、题集、策略、引擎及版本；输出逐题证据与汇总 |
| 拟新增 `D:/dsh-auto-memory/lib/retrieval-enhancement-pre.js`：`rewriteQueryPre/rerankCandidatesPre/checkWhiteboardConflictsPre` | 新增 | 有界、可取消、可替换的模型适配器 |
| 拟新增检索流程：`retrieveMemoryPre` | 仅接线 | 原查询保留；改写最多一次；精排后统一重新过滤 |
| [worker_semantic_pre_v1.py](D:/dsh-auto-memory/python/worker_semantic_pre_v1.py)：新增 `handle_rerank` | 新增 | 本地 cross-encoder 服务；模型缺失或超时返回结构化降级 |
| [semantic-decide-pre.js](D:/dsh-auto-memory/lib/semantic-decide-pre.js)：策略加载外围 | 扩展 | 校验特征版本、策略版本、校准记录 |

目标增强签名：

```typescript
rewriteQueryPre({request, budget, signal})
// -> Promise<{queries: string[], usage, elapsedMs, degradedReason?}>

rerankCandidatesPre({request, candidates, budget, signal})
// -> Promise<{orderedIds: string[], scores, modelId, elapsedMs, degradedReason?}>

checkWhiteboardConflictsPre({cardA, cardB, budget, signal})
// -> Promise<{findings, usage, checked: boolean, degradedReason?}>
```

实施顺序为 **5A 基线与预算扫描 → 5B 单次改写实验 → 5C 本地精排实验 → 5D 二者组合实验**。每个增强先单独对照，不能只比较“全关”和“全开”，否则无法判断成本与收益来自哪一步。

保留 S7 的 A/B/C 三策略，并在同一策略内比较增强开关。12 题作为已知事实验收集；增加无关查询、撤回、纠正、改名、失效索引等负例。调参集与最终验收集分离，不用同一批 12 题反复调参后再宣称泛化有效。

最优档预算扫描以现有默认 2000 为基线，推荐试验 4000、6000 字符两个可配置总预算；这些是实验点，不修改冻结的分层上限，也不预设预算越大越好。

**3. 能失败断言：**

- **T5-1 复现：** 固定输入、模型输出替身和版本，重复运行得到相同逐题结果及排名；缺少语料/策略身份的报告失败。
- **T5-2 原查询：** 改写超时、抛错、空结果、越预算时，原查询候选仍存在并有降级原因。
- **T5-3 限额：** 每个 request 最多一次改写、两条改写结果；超限输入跳过增强；超时后的迟到结果不能覆盖当前结果。
- **T5-4 精排：** 精排只能重排允许候选 ID；新增未知 ID、遗漏元数据、产生非有限分数均拒绝并回退 RRF。
- **T5-5 费用：** 故障、超时、重复触发也不突破预留预算；缺少可执行费用上限时不能启用在线改写。
- **T5-6 质量：** 相同预算下，增强组答案可达率高于对照、噪声比不升且所有契约断言通过，才进入作者试用；否则保持关闭。
- **T5-7 白板矛盾：** 替身检测器返回一对冲突证据时，UI/API 准确报告且不改白板；模型故障时标 `checked=false`。
- **T5-8 准入门：** 实验门要求 `top-5 ≥10/12`、答案可达 `≥10/12`；采用契约预算校准门 `≥0.9` 时，12 题必须至少 `11/12`，不得混用两个门。

**4. 回滚动作：** 分别关闭 `queryRewriteEnabled/crossEncoderEnabled/whiteboardConflictCheckEnabled`；恢复增强适配器的接线，保留 Phase 3 RRF、原查询和共同组装器。回滚不撤销已归档的作者确认结论。

**5. 成本：** H1–H3 的 token、延迟、内存、依赖和降级预算见第三部分，作为本阶段成本表。离线真实模型实验也会消耗 token，执行前计算“题数×策略数×开关组合×重复次数”的总预算。

**6. 风险与未决项：** 真实题集、计费接口、cross-encoder 模型资产分别依赖 U3/U4/U5。可以完成替身接口和可失败测试，但缺少这些材料不能把真实增强标记为可用。小题集通过只是本项目准入，不是普遍质量保证。

### Phase 6：分档运行验收与发布

**1. 目标［最优档优先、兼容档降级保障］：** 作者可以稳定使用最优路径，组件失败时仍有经过实测的降级。

**2. 改动点：**

| 文件：函数 | 改动类型 | 施工内容 |
|---|---|---|
| [index.js](D:/dsh-auto-memory/lib/index.js)：`loadConfig/saveConfig/debugInfo` | 扩展 | 校验档位、预算、增强授权与 manifest 能力；显示实际有效配置 |
| [client.js](D:/dsh-auto-memory/lib/client.js)：现有设置与诊断控件 | 仅接线 | 展示实际引擎、降级原因、费用和资源结果，不另建配置体系 |
| [tools/run-smoke.mjs](D:/dsh-auto-memory/tools/run-smoke.mjs)：`main/runSuite` | 原样复用 | 串行、超时、非零失败；不以此阶段重写测试运行器 |
| 拟新增 `D:/dsh-auto-memory/tests/smoke/smoke-test-rag-phase6-pre.mjs` | 新增 | 宿主接线、故障切换、回滚、资源限额整体验证 |

按顺序运行：全部零依赖 smoke → Python 适配器 fixture → 作者设备真实 BGE 路径 → 兼容设备本地小模型与纯词法 → 持续写入与重启恢复 → 发行包隔离安装。发行包验收导入打包后的产物，不能把开发树通过直接转述为发行包通过。

**3. 能失败断言：**

- **T6-1 零 LLM：** 兼容配置拦截所有生成式模型调用，调用数必须为 0，同时目录、词法和展开通过。
- **T6-2 故障降级：** 依次关闭 LLM、稠密 worker、索引文件和精排模型，均在登记期限内返回对应降级；无限等待或整轮静默空白失败。
- **T6-3 资源：** 指定设备、语料规模和负载下，P95 延迟、常驻/峰值内存、磁盘、索引积压年龄均不超过事前登记界限。
- **T6-4 切引擎：** 切换期间不混用向量；重建完成前明确词法降级；重启后状态与引擎身份仍一致。
- **T6-5 宿主：** 最终动态文本全量计费、Tier-0 常驻、尾注不重复、交付幂等；仅测中间字符串通过不算通过。
- **T6-6 回滚：** 按各阶段开关退回基础路径后，撤回项仍不出现，预算仍守住；回滚使旧状态复活失败。
- **T6-7 打包：** 在隔离目录从发行产物运行入口测试，禁止依赖开发树相对导入路径。

**4. 回滚动作：** 先关闭三个增强开关，再将 `memoryInjectionMode='catalog-only'`；索引问题关闭差量同步及新缓存读取。还原设置 UI 和发布接线时保留 Phase 0/1 的安全底座、已提交记忆和状态。

**5. 成本：** 基础验收不新增生成式调用；真实质量实验按 H1/H3 计费。性能测试增加临时运行成本，运行期诊断采用有界计数与环形记录，不无限追加常驻内存。无新增通用监控依赖。

**6. 风险与未决项：** U1 未完成时不能填写“兼容已验收”；宿主是否提供最终请求提交确认依赖 U6。当前交付记账边界只能明确为“文本已返回宿主回调”，不能等同于模型实际阅读。

---

<a id="准入分档"></a>
## ③ 准入与分档

### 3.1 开关与档位

下表是拟新增配置，不替换现有引擎选择项。最优档是目标预设；增强先通过 Phase 5，再由作者启用。

| 配置 | 用途 | 最优档 | 兼容降级 |
|---|---|---|---|
| `retrievalProfile` | 成本和能力预设 | `optimal` | `compatible` |
| `memoryInjectionMode` | 共同注入器模式 | `full` | 正常亦可 `full`，故障退 `catalog-only` |
| `memoryMutationMode` | 写入事故回退 | `readwrite` | 同左；事故退 `readonly` |
| `memoryEvidenceBlocksEnabled` | 有界原文读取 | 开 | 可开；超时保留摘要并标注 |
| `embeddingCacheV2Enabled` | 内容向量缓存 | 开 | 有模型时开 |
| `indexDeltaSyncEnabled` | 差量传输 | Phase 2C 后开 | 同左 |
| `retrievalPipelineMode` | 新流程放量 | `shadow` 验收后进入 `candidate` | 同一流程和规则 |
| `whiteboardWriteEnabled` | 受保护白板写入 | Phase 4 后开 | 同左 |
| `queryRewriteEnabled` | 生成式查询改写 | Phase 5 后作者显式开 | 强制关 |
| `crossEncoderEnabled` | 本地精排 | Phase 5 后作者显式开 | 默认关，降级用 RRF |
| `whiteboardConflictCheckEnabled` | 手动矛盾检测入口 | 可开 | 无模型时明确未检查 |

关闭增强不改变用户档位。引擎选择在一次查询开始时固定，失败当轮退词法；改选另一引擎是显式切换及重建流程，不是同轮混排。

### 3.2 最优档重方案三件套

下列数值是**建议的初始试验控制上限**，不是已测性能，也不是新规范常量。允许作者调高；调高后重新通过成本及质量门。

| 方案 | 成本与依赖 | 门控 | 无 LLM／不可用时降级 |
|---|---|---|---|
| **H0：BGE-M3 本地语义主线** | 生成式 token 0；首次编码全部唯一输入，增量编码 miss；常驻内存和耗时由 U1 测量；复用现有 Python 引擎资产 | 引擎身份、manifest 与请求 `miv` 一致，模型及设备预算就绪 | 无 LLM 不影响本地语义；引擎或索引不可用时，同快照词法＋目录 |
| **H1：一次查询改写** | 每次总输入 ≤512、输出 ≤128，最多640个生成式 token；额外等待≤1.5秒；无新增本地模型，需服务适配器；作者付费 | 最优档、显式开启、复杂查询集合命中、当轮和累计费用有余额；最多一次、无重试 | 保留原查询及本地规范化；错误、超时、超额均标注；迟到结果丢弃 |
| **H2：本地 cross-encoder** | 生成式 token 0；每批≤32对、每对模型输入≤512 token；建议额外等待≤750ms、模型驻留上限2048MiB；需兼容现有推理运行时的模型资产 | 模型预热完成、候选至少2条、预算充足、已过单独对照；同一 worker 有界并发 | 无生成式 LLM 不影响它；精排模型缺失、超时或结果非法时完整回退 RRF |
| **H3：手动白板矛盾检测** | 每次输入≤1024、输出≤256，最多1280个生成式 token；建议等待≤5秒；复用 H1 服务适配器 | 用户明确点击、指定两张卡、费用有余额；一次调用，不自动扫描整库 | 确定性 lint 仍返回；矛盾项 `checked=false`，不生成“无矛盾”结论 |

H1 的输入上限包含提示模板等全部计费输入；无法在上限内提交时直接跳过，不能只计算查询正文。超时请求仍可能计费，费用账本先预留上限，收到实际 usage 后结算；没有实际 usage 时保守保留预留值。

H2 的模型输入 token 是本地计算量，不是生成式 API 费用。冷加载不放在自动注入的等待链上；后台预热未完成时回退 RRF。U5 未提供真实模型资产前，只能完成适配器与替身测试。

### 3.3 推荐裁决及相反选择的影响

以下均标为**待作者确认**。推荐路线已写入阶段设计，不要求作者先回答才能开展不依赖裁决的工作。

| 编号 | 推荐裁决 | 理由与影响阶段 | 若作者选择相反裁决 |
|---|---|---|---|
| **R1 排序展示** | **最终选取、预算优先级和展示由 `finalRank` 决定，相似度独立呈现。待作者确认。** | 避免精排结果被渲染撤销；影响 Phase 3、5。该推荐与 S5.4/C7 若被严格解释为“按裸相似度排序”存在冲突，本文不宣称二者已兼容，也不改写条款 | 若坚持裸相似度展示，Phase 3 保留显式展示重排，精排只能影响入选集合；T3-2 改测选取序，不能继续承诺融合序贯穿展示；在线最优排序路线需重新评估 |
| **R2 margin** | **同时保存独立稠密间隔和融合间隔，新策略消费带版本的融合间隔，必须重新校准。待作者确认。** | 融合后的前两名不一定是稠密前两名；影响 Phase 3 特征构造、Phase 5 策略实验 | 若保留原策略，旧 `margin` 的定义和阈值冻结，新特征只 shadow；不能把新分布直接交给旧阈值 |
| **R3 预算边界** | **`injectBudgetChars` 覆盖一次请求中本插件全部动态注入，静态纪律与显式工具返回另记账。待作者确认。** | 消除独立出口各自取得完整预算的问题；影响 Phase 0、6 | 若只约束 `<memory_system>`，需为尾注等分别定义硬预算，并另设总动态上限；T0-3/T6-5 同时测分项与总项 |
| **R4 共用契约** | **两档共用流程、字段和判据，允许适配器、数量和预算不同；自动注入采用目录＋当前所需的摘要或原文层。待作者确认。** | 落实 S9.2/S9.3，避免把“同路径”解释为相同模型调用；影响所有阶段 | 若要求逐字节相同或完全相同调用，Phase 5 只能成为独立显式工具，不能进入自动注入主路径 |
| **R5 lint 范围** | **首版只对显式 ID、标题、术语表和链接关系执行确定性 lint，报告覆盖范围。待作者确认。** | “重要概念”“相关卡片”没有天然确定性判据；影响 Phase 4、H3 | 若要求任意自然语言概念与关系，增加最优档语义检查实验，不能仍以零 token 四类检查的名义验收 |
| **R6 白板迁移** | **保留原文，先预览锚点和分区迁移；同页重排保留 ID，跨页移动按新身份＋supersede 处理。待作者确认。** | 现有 ID 公式包含页面路径，不能同时保证跨页移动 ID 不变；影响 Phase 4 | 若要求跨页移动保持 ID，需要单独处理身份规则变更及迁移；本方案不通过偷偷更改公式实现 |
| **R7 数值与计量** | **定义源记录已批准数值，行为测试独立验证；字符估计只标估计，真实 tokenizer 计量另报。待作者确认。** | 防止“文档与代码一致”被当作“真实 token 上限成立”；影响 Phase 0、5、6 | 若只接受现有估计口径，仍可验收契约估计预算，但不得把报告中的 estimatedTokens 写成真实计费 token |

R5 的初始可执行规则为：精确 ID/标题无入站引用报孤立；状态非 current 或日期超过配置阈值报陈旧；术语表中的词在至少两张卡出现却无对应卡时报缺卡；正文精确提到已有卡标题但没有其链接时报缺引用。建议陈旧阈值先设30天，均作为试验配置，不作为事实有效期，不自动撤回条目。

### 3.4 需要补充的信息与不阻塞的施工范围

| 编号 | 缺失输入 | 如何取得 | 阻塞什么；仍可做什么 |
|---|---|---|---|
| **U1** | 作者与最低兼容设备配置、语料规模、写入负载、性能预算 | Phase 6 前登记设备与固定负载，测冷启动、P95、RSS、峰值、磁盘、积压年龄 | 阻塞性能认证；不阻塞 Phase 0–4 功能开发 |
| **U2** | 是否多宿主共享同一记忆根目录 | 检查部署拓扑并登记支持范围 | 未确认时按单写 owner 设计；多进程写支持不得宣称通过 |
| **U3** | 12题原始题集、证据块、负例、独立调参集 | 固定为只读实验 fixture，记录 corpus digest | 阻塞真实质量准入；不阻塞替身实验框架 |
| **U4** | LLM 服务的计费输入、输出上限、usage、取消语义 | 用服务适配器验证能力并记录 | 阻塞 H1/H3 在线启用；原查询和确定性 lint 可用 |
| **U5** | cross-encoder 模型、tokenizer、模型文件摘要与资源实测 | 按 H2 预算选择现有运行时支持的资产，实测 | 阻塞 H2 真模型启用；接口、回退和异常断言可做 |
| **U6** | 宿主最终请求确认、去重和尾注交付语义 | 使用 Phase 6 宿主消息夹具及真实请求记录核对 | 阻塞“模型请求确实含该内容”的发布声明；可先验证回调输出与幂等 |
| **U7** | 真实生成模型 tokenizer 的本地计量入口 | 提供计量适配器或真实 usage 对照 | 阻塞真实 token 硬上界声明；字符和契约估计预算仍可测 |

---

<a id="问题处置"></a>
## ④ 上一轮 A1–A3 的处置

本节只建立施工追踪，不重述已认证问题。

| 上轮条目／核实编号 | Phase 与排序理由 | 接口改动 | 断言索引 |
|---|---|---|---|
| **A1：C1/C2/C3，融合实现** | **Phase 3**；先有 Phase 0/1 边界及 Phase 2 可用索引，才能建立可信算法基线 | `retrieveMemoryPre` 共同入口；`rankFusionRRFPre/rankFusionListsPre` 返回 `fusionScore/fusionRank`；worker 主路径改为计算适配器 | T3-1、T3-3、T3-6、T3-7 |
| **A1：C4，排序传递** | **Phase 3，R1 控制在线启用**；在此之前不叠加精排 | 激活候选、packet 内部投影增加排名元数据；`dedupeCandidates/renderReferenceTail` 消费约定顺序，`denseScore` 独立保留 | T3-2、T3-5 |
| **A2：C5/C6，L0 实际编码量** | **Phase 2A**；先兑现最容易单独证明的增量计算 | `assemble/update` 先查缓存；返回 `encoded/aliasReused/contentReused/removed`；修改点使用 `l0-index-pre.js:126–127` | T2-1 |
| **A2：C7，原文块复用** | **Phase 2B**；缓存计算身份与块出处分离后再做差量传输 | 保留 `chunk_id_for`；新增 `chunkDigest/vectorKey`、一级 alias 与二级内容池；`planEmbeddingDeltaPre` 返回实际 miss | T2-2、T2-3、T2-4 |
| **A3：C8，双层状态过滤** | **Phase 0 修入口，Phase 1 补持久提交**；先阻止已知非 current 输入，再建立撤回闭环 | `validateHitSnapshotPre`；三层装配接收已固定快照；状态提交返回新的 `miv` | T0-1、T1-1、T1-3 |
| **A3：C9，快照归属** | **Phase 0 透传和拒混版，Phase 1 统一快照所有权** | `recordTierGateHits` 增加 `miv/contextVersion/requestKey`；`composeTieredInjectionPre` 增加 snapshot；异步准备校验请求身份 | T0-2、T0-5、T1-5 |
| **A3：C10/C11，预算统一** | **Phase 0**；后续成本和质量实验均依赖真实计量 | `composeMemoryEnvelopePre -> FinalEnvelope`；尾注拆分 peek/commit；修改裁剪采用修正位置 `tier-layer-inject-pre.js:327–335` | T0-3、T0-4、T6-5 |
| **补充：C12，数值守卫范围** | **Phase 0**；为各阶段配置提供共同定义 | `resolveMemoryLimitsPre` 返回有效上限及单位；守卫检查完整字段与关系 | T0-6 |

没有提出对核实表的反驳，也没有重新改变第一轮的成因判断。两级缓存是对第一轮“仅加入现有块 ID 不足以兑现细粒度复用”的施工补全。

---

<a id="不需要做"></a>
## ⑤ 不需要做的事

- **［两档共用］** 不重写 S1–S10、I1–I7；本轮交付负责实现、接口和验收，解释冲突按 R1–R7 留痕处理。
- **［两档共用］** 不另建两套检索流程；共享调度、融合、决策和注入，计算能力通过适配器替换。
- **［两档共用］** 不改现有 `chunkId` 来掩盖缓存问题；两级引用已能在保留身份规则的同时复用相同输入。
- **［两档共用］** 不把旧向量结果与新目录拼装成“不断供”；新快照词法降级才保持 I6。
- **［最优档］** 不把多轮检索、自省循环设为默认；先完成一次检索中的查询加工和精排对照。
- **［两档共用］** 不在渲染末尾随意截字符串；出处、状态、计数和交付 digest 都依赖完整条目。
- **［两档共用］** 不为“测试更容易通过”预先过滤 fixture 或只检查返回计数；验收直接挑战真实入口和实际编码调用。
- **［两档共用］** 不新建白板任务状态机、跨目标依赖图或重做看板 UI；Phase 4 只补契约和归档闭环。
- **［两档共用］** 不用自动语义判断改写用户区、撤回记忆或修复 lint；模型检查只报告，写入仍走唯一提交门。
- **［最优档］** 不同时启用改写和精排后只测组合效果；先单独归因，再验证组合收益。
- **［两档共用］** 不迁移缺少可信引擎身份的旧向量；一次重建新缓存比错误复用更可验证。
- **［两档共用］** 不把关闭增强、降低能力或缺少测试环境写成“已验收”；发布材料逐项记录通过、失败和未执行。
