# 分层语义唤回 · 外包 Prompt 包（PROMPT-PACK）

> 写于 2026-09-09。基于 v2.2.6 源码 + 本轮联网核实结论。
> 用途：把 T2–T12 拆成**自包含、可并行外包**的独立 prompt。每段一次对话可完成。
> 上位：[ROADMAP.md](ROADMAP.md)（总规划）、[S2-DEEP-ABSORPTION.md](S2-DEEP-ABSORPTION.md)（Hindsight 深挖）。
> **已完成无需再做**：T1（`lib/l0-extract-pre.js`，18 断言 + 153 条验证）、G1/G3（接续指令文案）。

---

## 0. 本轮联网核实结论（硬证据，非记忆）

### 0.1 来源清单

| 来源 | URL | 性质 |
|---|---|---|
| 火山引擎官方 API 概览 | https://volcengine.com/docs/84313/2595386 | 官方 |
| OpenViking 检索 API 参考 | https://raw.githubusercontent.com/drunkcoding/AgentSkillsArxiv/main/skills/openviking/references/api-retrieval.md | 社区整理的官方 skill 参考 |
| OpenViking 概念参考 | https://raw.githubusercontent.com/drunkcoding/AgentSkillsArxiv/main/skills/openviking/references/concepts.md | 同上 |
| 官方文档站 | https://openviking.ai/docs | 官方 |

> 说明：OpenViking 仓库本体为 **AGPLv3**。以下结论**全部来自公开文档与官方 API 描述**，未引用其源码实现。

### 0.2 检索流水线（官方原文）

```
Query → Intent Analysis → Vector Search (L0) → Rerank (L1) → Results
```

**这与我们的 T4/T5/T6 设计完全同构**，可作为实施依据。

### 0.3 分层（目录递归）检索算法 —— 核心

官方原文（api-retrieval.md §Hierarchical Retrieval）：

> 1. Determine root directories by context_type
> 2. Global vector search to locate starting directories
> 3. Merge starting points + Rerank scoring
> 4. Recursive search with score propagation: `final_score = 0.5 * embedding_score + 0.5 * parent_score`
> 5. Convergence detection (stops after top-k unchanged for 3 rounds)
>
> Key parameters:
> - `SCORE_PROPAGATION_ALPHA`: 0.5
> - `MAX_CONVERGENCE_ROUNDS`: 3
> - `GLOBAL_SEARCH_TOPK`: 3

**加权公式（此前未知，本轮核实获得）**：

```
final_score = α · embedding_score + (1-α) · parent_score,  α = 0.5
```

即**父目录分数向子节点传播**，使"位于高相关目录下的低分项"也能被召回。

### 0.4 接口签名与数据结构（官方原文）

```python
def find(query, target_uri="", limit=10, score_threshold=None, filter=None) -> FindResult
def search(query, target_uri="", session=None, limit=3, score_threshold=None, filter=None) -> FindResult
```

| find vs search | find | search |
|---|---|---|
| 意图分析 | 无 | 有（LLM，生成 0–5 TypedQueries） |
| 会话上下文 | 无 | 有 |
| 默认 limit | 10 | 3 |
| 延迟 | 低 | 较高 |

```python
class FindResult:
    memories: List[MatchedContext]
    resources: List[MatchedContext]
    skills:    List[MatchedContext]
    query_plan: Optional[QueryPlan]      # search only
    query_results: Optional[List[QueryResult]]
    total: int

class MatchedContext:
    uri: str
    context_type: ContextType   # "resource" / "memory" / "skill"
    is_leaf: bool
    abstract: str               # L0 内容，已在结果里
    category: str
    score: float                # 0-1
    match_reason: str
    relations: List[RelatedContext]
```

**渐进式加载（官方示例）**：

```python
for ctx in results.resources:
    print(ctx.abstract)          # L0 已在结果中
    if not ctx.is_leaf:
        overview = client.overview(ctx.uri)   # L1
    else:
        content = client.read(ctx.uri)        # L2
```

### 0.5 存储架构（官方原文）

**双层存储**：

| 层 | 内容 |
|---|---|
| **AGFS** | L0/L1/L2 全文、多媒体、关系 |
| **Vector Index** | URIs、向量、元数据（**不含文件内容**） |

**数据流**：
- 写入：`Input → Parser → TreeBuilder → AGFS → SemanticQueue → Vector Index`
- 检索：`Query → Intent Analysis → Hierarchical Retrieval → Rerank → Results`

**Viking URI**：`viking://{scope}/{path}`，scope = `resources` / `user` / `agent` / `session` / `queue` / `temp`

### 0.6 与本地代码的嵌合性判断（诚实评估）

| OpenViking 机制 | 本地对应 | 嵌合度 |
|---|---|---|
| Vector Index 只存 URI+向量，内容另取 | **我们有 `mem_xxx` 锚点 ID** = URI 等价物 | ✅ **天然吻合**，无需新造 |
| L0 用于向量检索 | T1 已产出 L0（93 字符） | ✅ 直接可用 |
| L0 已在结果里返回 | recall 当前返回全文 | ⚠️ 需改造（P4） |
| 分数传播 `0.5·emb + 0.5·parent` | 我们**无父目录概念** | ⚠️ **收益有限，见下** |
| 3 轮收敛停止 | 我们无递归检索 | ⚠️ 仅在下钻时才有意义 |
| find/search 双接口 | 我们的 `memory_recall` ≈ find | ✅ 意图分析已有（AI 扩关键词） |

**关于分数传播的重要判断**：OpenViking 有深目录树（resources/docs/api/auth.md），父传播意义重大。**我们是浅层扁平结构**——177 条记忆中大部分是游离条目（不落在 `## 主题块` 下），"父"概念薄弱。

因此：**α 传播不要照搬**。建议映射为**工作区 / 日志文件 / 主题块**三级父，且仅在"候选过少需要扩展召回"时启用，默认关闭。这一判断写进 P3 的禁止事项。

---

## 1. 全局前置约定（每段 prompt 都适用，执行 Agent 必读）

1. **项目根**：`D:\dsh-auto-memory`（pre 线，所有 `_pre` 标识）。
2. **发布纪律**：`tools/release.mjs` 的 DEV 源就是当前工作区，**脏工作区会直接进包**。改动完成后必须 `git status` 确认范围，未 commit 不发布。
3. **纯函数惯例**：新逻辑一律写成 `lib/xxx-pre.js`，纯函数、零 IO（IO 注入），配 `tests/smoke/smoke-test-xxx-pre.mjs`。
4. **测试基线**：改动后必须跑——`node --check` 涉及文件 + `smoke-test-handoff-pre`（51）、`smoke-test-continue-chain-pre`（58）、`smoke-test-l0-extract-pre`（18）。**已有断言不得回退。**
5. **五条不变量**（破坏即打回）：
   - I1 前缀缓存字节级稳定（静态纪律层字节不碰）
   - I2 不替 host 决定压缩（阈值 0.75 早于官方 0.80）
   - I3 凭证永不进提示词（写入过 `sanitizeForWrite`）
   - I4 绝不阻塞接续（新增环节必须 fail-soft）
   - I5 水位测量在 pre-step
6. **许可证纪律**：
   - OpenViking 为 **AGPLv3**——**禁止复制、翻译、逐行改写其源码**。只可借鉴公开文档描述的算法思路与接口设计（本文档 §0 已提炼）。
   - Hindsight 为 **MIT**——可参考实现，但仍建议独立实现。
   - 若执行者选择"联网复用"，**必须在产出中注明来源 URL**，且不粘贴其代码块。

---

## 2. 任务编号、依赖与执行顺序

| 编号 | 对应 | 任务 | 依赖 | 可并行 |
|---|---|---|---|---|
| **P1** | T2 | L0 向量索引 + 增量更新 | 无（T1 已完成） | 与 P5、P8 并行 |
| **P2** | T4 | 语义臂接入 recall | P1 | — |
| **P3** | T5 | 双臂融合 + 绝对性修复 | P2 | — |
| **P4** | T6 | 返回 L0 + 按 id 展开 | P3 | — |
| **P5** | T7 | 接续锚点表注入 | 无（T1 已完成） | 与 P1 并行 |
| **P6** | T8 | 账本权重化截断 | P5 | — |
| **P7** | T9 | 结构化 sidecar | P5 | 可选，可延后 |
| **P8** | T11/T12 | 写入侧缺陷修复 | 无 | 随时 |
| **P9** | T10 | 三组对照实验 | P4 + P5 | 最后 |

**推荐执行批次**：
- 批次 A（并行）：P1 ∥ P5 ∥ P8
- 批次 B：P2 → P3 → P4（串行主链）
- 批次 C：P6 →（可选 P7）
- 批次 D：P9

---

## 3. Prompt 正文

### 通用模板说明

每段 prompt 可直接复制给独立 Agent。执行者二选一：
- **(a) 联网检索复用**：先检索业界已有实现，注明出处 URL，再落地（不得粘贴其代码）。
- **(b) 按既定算法实现**：直接按文末伪代码与算法说明逐步实现并迭代。

---

#### 【P1】L0 向量索引与增量更新

**背景**：项目已有 `lib/l0-extract-pre.js`（T1 已完成），可从 Markdown 记忆中抽出每条记忆的 L0 摘要（实测 153 条：L0 平均 93 字符，压缩比 6.78:1）与稳定 ID（`mem_<32hex>`）。当前**没有任何向量索引**，检索仍是全文词法匹配。本任务要建 L0 向量索引，为后续语义检索提供输入。

OpenViking 的对应设计（官方，已核实）：Vector Index **只存 URIs + 向量 + 元数据，不存文件内容**，内容按 URI 从 AGFS 取。我们的 `mem_xxx` 锚点即 URI 等价物。

**前置约定**：遵守 §1 全部约定。已有 `lib/semantic-js-pre.js` 提供 C2（e5-small q8）引擎与 `fuseD6Pre`，不要重复实现 embedding 调用。

**要改的文件/模块**：
- 新建 `lib/l0-index-pre.js`（纯函数核心：索引结构定义、增删改查的纯逻辑、一致性校验）
- 新建 `tests/smoke/smoke-test-l0-index-pre.mjs`
- 需要持久化时，落盘位置与格式自行设计，但必须在 `memoryRoot` 内且可整体删除

**验收标准**：
1. 177 条真实记忆可全量建索引，每条含 `{id, vector, l0, source, updatedAt}`，**零丢失**
2. 增量：改一条记忆 → 仅重算该条（提供可断言的"重算条数"）
3. 删除/失效记忆可从索引移除
4. 索引非法或缺失时 fail-soft，回退到无索引状态，**不阻塞任何调用方**
5. `node --check` 通过；新增 smoke 全绿；已有 handoff/continue-chain/l0-extract 三套不回退

**禁止事项**：
- 不得修改 `lib/l0-extract-pre.js`（T1 已锁定）
- 不得修改 `lib/index.js` 的检索调用路径（那是 P2 的事）
- 不得引入新的运行时依赖（项目零依赖承诺）
- 不得在索引里存记忆原文（参照 OpenViking：向量索引不含文件内容）

**实施依据（二选一）**：

(a) 联网检索方向：查询 "incremental vector index persistence local-first"、"embedding cache invalidation by content hash"，注明来源 URL。

(b) 既定算法伪代码：

```
INDEX = Map<id, {vector: Float32Array, l0: string, source: 'heading'|'firstSentence'|'truncate', l0Hash: string, updatedAt: number}>

buildOrUpdate(memoryFileText):
    items = buildL0IndexPre(memoryFileText)        # T1 已有，返回 [{id, l0, source, chars, bodyChars}]
    for it in items:
        h = sha256(it.l0)
        if INDEX.has(it.id) and INDEX.get(it.id).l0Hash == h:
            continue                                # 未变更，跳过（增量核心）
        INDEX.set(it.id, {vector: embed('passage: ' + it.l0), l0: it.l0, source: it.source, l0Hash: h, updatedAt: now()})
    for id in INDEX.keys() not in items:
        INDEX.delete(id)                            # 失效清理

embed(text):
    return C2 引擎输出（复用 semantic-js-pre.js，pooling=mean, normalize=true, truncation=true）
    # 注意：必须带 'passage: ' 前缀（e5 模型约定），与查询侧 'query: ' 对应

query(q):
    v = embed('query: ' + q)
    return topK(cosine(v, each.vector), k)
```

**一致性校验（必须实现）**：`verify()` 断言 `INDEX.size == 解析出的条目数`，且每条 `l0Hash` 与当前文件重算一致。

---

#### 【P2】语义臂接入 memory_recall

**背景**：`memory_recall_pre`（`lib/index.js:6302`）当前是**纯词法关键词匹配**，工具描述自己写着"关键词匹配"。语义引擎（C2 e5-small q8 / C3 bge-m3）只用在主动联想注入，recall 这条完全没接。本任务把语义臂接进来，**输入用 L0 而非全文**（全文超 e5 512 token 上限会被截断，实测最长条目 11046 字符）。

**前置约定**：依赖 P1 完成（有 L0 向量索引）。不改动激活决策层（那是原创核心，与本任务无关）。

**要改的文件/模块**：
- `lib/index.js` 中 `memory_recall_pre` 的处理逻辑（约 `:6302` 附近）
- 语义调用复用 `lib/semantic-js-pre.js`，不新写引擎

**验收标准**：
1. recall 支持语义匹配：用主题性查询（如"发布踩坑"）能召回到词法不重合但语义相关的记忆
2. **词法臂必须保留**且继续打全文（错误码/变量名/路径在 L0 里没有，丢了会漏召回）
3. 语义引擎不可用时 fail-soft，退回纯词法，**不报错、不阻塞**
4. `score_threshold` 类参数可配置（参照官方 `find()` 有 `score_threshold`）
5. 已有三套 smoke 不回退 + `node --check` 通过

**禁止事项**：
- 不得替换或删除词法臂（必须双���共存）
- 不得修改激活决策层逻辑
- 不得把全文送进 embedding（会截断且慢 7 倍）

**实施依据**：

(a) 联网检索："hybrid retrieval dense + sparse combination best practice"、"BM25 + embedding hybrid search"，注明 URL。

(b) 既定算法：

```
recall(query, scope):
    v    = embed('query: ' + query)
    sem  = topK(cosine(v, INDEX.vectors), k=20)     # L0 语义臂
    lex  = bm25Search(query, FULL_TEXT, k=20)       # 全文词法臂（保留现有）
    return {sem, lex}                                # 交给 P3 融合
```

---

#### 【P3】双臂融合 + 绝对性修复

**背景**：现有 `fuseD6Pre`（`lib/semantic-js-pre.js:33-63`）用 **minmax 归一化**融合，导致三个问题：①分数依赖候选集构成、阈值随批次漂移；②矮子里拔将军（全不相关候选也被拉满到 [0,1]）；③候选 ≤1 时走 flat 分支记 0.5，**所有候选分数相同，排序失效**。本项目核心是"是否注入"的决策，依赖分数与阈值比较，相对量会腐蚀决策基础。

**前置约定**：依赖 P2。这是**风险最高**的一段，改动后必须全量回归。

**要改的文件/模块**：
- `lib/semantic-js-pre.js` 的 `fuseD6Pre`（或新增融合函数并存，由配置切换）
- 新增 `tests/smoke/` 对应断言（必须含"候选≤1 不退化"用例）

**验收标准**：
1. 决策用**绝对分数 + 校准阈值**，排序才用融合分数——两者解耦
2. 候选数 < 3 时不退化（不再出现全 0.5）
3. 提供 `rank-space` 融合选项：`score = Σ 1/(k + rank/divisor)`，**不提供 score-space 加权 RRF**
4. 已有断言不回退

**禁止事项（重要）**：
- **禁止 score-space 加权 RRF**。Hindsight 实测（issue #3956）：RRF k=60 时动态范围仅 5.9 倍（1/61→1/360），加权会让排序退化为字典序，recall@20 从 **0.97 崩到 0.40**。
- **禁止照搬 OpenViking 的 α=0.5 父分数传播**。理由是本地结构浅（177 条多为游离条目，无深目录树），父概念薄弱。若确需实现，必须：映射为「工作区 / 日志文件 / 主题块」三级父，且**默认关闭**，仅在候选过少时启用。
- 不得改动 T1 与 P1 的产物

**实施依据**：

(a) 联网检索："Reciprocal Rank Fusion k=60"、"weighted RRF failure"、"rank fusion vs score fusion"，注明 URL。

(b) 既定算法：

```
# 决策（绝对量）
decision = cosine_similarity >= calibrated_threshold

# 排序（rank-space，多臂）
rrf(d) = Σ_arms  1 / (k + rank_arm(d) / divisor_arm)      # k=60
# 提升某臂优先级用 divisor（2.0 low / 4.0 medium / 8.0 high），
# 不要用乘性权重 w —— 乘性会在 k 项上放大成字典序

# 单臂或候选极少时
if candidates < 3: 直接按原始相似度排序，不做归一化
```

---

#### 【P4】返回 L0 + 按 id 按需展开

**背景**：recall 当前返回整条原文（平均 814 字符）。官方 OpenViking 的做法是：**L0 abstract 已在检索结果里返回**，调用方按 `is_leaf` 决定取 L1（overview）还是 L2（read）。本任务把这条渐进式加载落地。

**前置约定**：依赖 P3。不改动注入/前缀缓存相关逻辑。

**要改的文件/模块**：
- recall 返回结构（默认返回 L0 列表）
- 提供按 `mem_xxx` 取原文的能力（可能复用现有 `memory_read` 或新增参数）

**验收标准**：
1. 默认返回 L0 列表（每条 ~93 字符），附 `uri/id/score/match_reason`
2. 提供按 id 展开原文的入口，一次可取 1–多条
3. 同场景 token 对比：5 条结果从约 4070 字符降到约 590 字符（降 ~85%）
4. 展开原文正确，不串条

**禁止事项**：不得改变静态纪律层内容（I1）；不得破坏现有 `memory_recall` 的参数兼容性（旧调用方式仍可用）。

**实施依据**：官方渐进式加载示例见 §0.4。伪代码：

```
results = recall(query)
for ctx in results:
    emit(ctx.id, ctx.l0, ctx.score)        # L0 已在结果中
    # 模型需要细节时再调：expand([id1, id2]) → 返回原文
```

---

#### 【P5】接续锚点表注入

**背景**：`buildContinueCarry()`（`lib/index.js:2126`）把材料四层平铺后用**机械截断**（白板 3000 / 账本 8000 / 总 18000 字符）。指令文案 G1/G3 已改成"按需取用"，但**没有锚点表可供下钻**，模型只能整段读。本任务用 T1 的 L0 抽取为交接材料生成锚点表。

**前置约定**：不依赖 P1–P4，可与它们并行。**不得破坏前缀缓存字节级稳定（I1）**——锚点表必须固定内容注入，不随当前任务变化。

**要改的文件/模块**：
- `lib/index.js` 的 `buildContinueCarry()`（`:2126`）

**验收标准**：
1. 注入内容包含锚点表（每条 ~20–30 token），材料仍可达
2. **字节稳定性**：相同输入两次生成的注入内容完全一致（可断言 hash）
3. 锚点表缺失/生成失败时 fail-soft，退回现有平铺注入，**绝不阻塞接续**
4. 满足 0.75 时序约束：锚点生成**不得引入新的 LLM 轮次**（纯解析）
5. handoff 51 / continue-chain 58 不回退

**禁止事项**：
- 不得为生成锚点新增独立 LLM 调用（会破坏 0.75 抢在官方 0.80 前的时序）
- 不得改动静态纪律层
- 不得让注入内容随查询/任务动态变化

**实施依据**：OpenViking 官方做法是目录本身带 `.abstract/.overview`；我们退化为"材料旁生成锚点表"。伪代码：

```
carry = buildContinueCarry()
anchors = buildL0IndexPre(planText + ledgerText)   # 复用 T1，纯解析
inject = renderAnchorTable(anchors) + carry        # 锚点表在前，固定内容
```

---

#### 【P6】账本权重化截断

**背景**：`buildContinueCarry` 中 `ledger.slice(0, 8000)` 是位置截断。实测账本**段内异质**——「已试方案与失败原因」段里三条全是**成功解法**；「进度与下一步」混了已完成项、真待办、元指令。按位置截断可能把高价值段整体截掉。

**前置约定**：依赖 P5。

**要改的文件/模块**：`lib/index.js`（四段解析 + 权重分配），建议解析部分抽成 `lib/handoff-anchor-pre.js` 纯函数。

**验收标准**：
1. 正确解析四段：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`
2. 权重：失败原因 .35 ＞ 下一步 .30 ＞ 目标 .20 ＞ 任务状态 .15
3. 预算不足时**从最低权重段开始截**，不得截高权重段
4. 纯函数 + fixture 锁定解析与排序

**禁止事项**：不得把"成功解法"误标为"失败原因"（实测过，账本里这段常混装）；不得删除任何原文（只影响注入，不动文件）。

**实施依据**：伪代码

```
sections = parseLedger(text)                 # 四段
budgets  = allocate(8000, {failures:.35, next:.30, goal:.20, status:.15})
out = ''
for s in orderByWeightDesc(sections):
    out += truncate(s.text, budgets[s.type])  # 低权重段先被截
```

---

#### 【P7】结构化 sidecar（可选，可延后）

**背景**：账本/白板是"给人读的自然语言文档"，从中解析锚点质量有限。改进方向是在 refreshRitual 同一轮产出结构化索引。

**前置约定**：依赖 P5。**必须在 0.75 前完成，不得新增 LLM 轮次**（与 P5 同时序约束）。

**要改的文件/模块**：`refreshRitualPrompt()`（`lib/index.js:2049`）

**验收标准**：
1. 同轮产出 `{id, type, w, text, refs, st}` 结构（type: solution/failure/todo/meta/status/goal）
2. sidecar 非法或缺失 → fail-soft 回退，**绝不阻塞接续**
3. 不新增 LLM 轮次

**禁止事项**：不得因 sidecar 生成失败影响接续；不得改动已有的 PLAN/账本写入语义。

**实施依据**：伪代码见 ROADMAP §阶段 2 T9。

---

#### 【P8】写入侧缺陷修复（T11/T12）

**背景**：两个独立小缺陷——①账本标题重复（最近 6 个中 3 个含两个 `# 交接账本` 标题行，时间戳不一致，纯解析会取到错的）；②`PLAN.md` 退化为日志（并列堆积 2.2.5/2.2.6 状态与历史踩坑，无老化）。

**前置约定**：无依赖，随时可做。

**要改的文件/模块**：
- 账本写入逻辑（`memory_note_pre` 的 `kind=handoff` 分支）
- 白板归档逻辑（复用现有 PLAN archive 机制）

**验收标准**：
1. 追加写入前检测已存在标题则跳过；或解析时取**最后一个**标题（二者选一并实现断言）
2. 白板区分「当前状态」与「历史」，历史在版本收敛后移入 `handoff/archive/`
3. 不丢失任何既有内容

**禁止事项**：不得删除用户已有账本/白板内容；不得改动注入预算。

**实施依据**：直接修复，无需联网。

---

#### 【P9】三组对照实验

**背景**：验证改造成效。必须在 P4 与 P5 完成后进行。

**前置约定**：依赖 P4 + P5。复用 M7 的 held-out 评估通路（67 条人工金标、pairId 聚类 bootstrap B=2000）。

**要做的**：
1. 三组对照：①现状固定截断 ②全量 read ③分层唤回
2. 指标：衔接成功率、**死路继承率**（能否复述已试过的失败方案）、下钻率、注入 token、总 token
3. 配对 bootstrap（B=2000）给差值 CI

**验收标准**：五指标均有数据 + 差值 CI；结论明确（分层是否更优、优多少）。

**禁止事项**：不得为了让数据好看而调整权重或阈值（预注册式：指标与方法先定，零重调参）。

**实施依据**：ROADMAP §阶段 3 T10；统计口径沿用 M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md。

---

## 4. 执行者交接检查清单

每段完成后必须交付：
1. 改动文件清单 + `git status` 范围确认
2. `node --check` 通过证据
3. 新增/已有 smoke 全绿数字
4. 若联网复用过外部实现：来源 URL 列表 + 说明"仅借鉴思路，未粘贴代码"
5. 未违反各段"禁止事项"的逐条确认
