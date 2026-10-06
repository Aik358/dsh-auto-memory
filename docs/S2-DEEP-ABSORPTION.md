# S2：深度吸收 —— 从 Hindsight / OpenViking 源码挖出的实现细节

> 写于 2026-09-06。上位：[S1-SCIENTIFIC-RIGOR.md](S1-SCIENTIFIC-RIGOR.md)（含许可证分级）。
> **本文性质**：全部内容来自**实读源码**（非文档复述），标注了文件与行号。每条都附"他们踩过什么坑"，因为**教训比代码更值钱**。
> 许可证纪律：Hindsight（MIT）可放心深挖；OpenViking（AGPLv3）只取论文/公开文档中的架构层结论，不读其源码。

---

## 1. 先说你的代码：不是"浅"，是**分层不均**

实读 `lib/shadow-retrieval-pre.js`（673 行）后的判断：**你的决策层设计比 Hindsight 精细，基础设施层比他们薄。**

### 你做得比他们好的

| 你的实现 | 位置 | 对比 |
|---|---|---|
| 门控三级：硬抑制顺序 → 权重滞回 → cooldown | `gatePreV1` §347-395 | Hindsight 没有"是否该检索"这一层，它假设查询已存在 |
| 滞回防抖（hysteresisOn 0.65 / hysteresisOff 0.42） | §382 | 避免阈值抖动，Hindsight 无对应机制 |
| `DROP_REASONS` 版本化枚举，禁止自由文本驱动逻辑 | §85-101 | **比 Hindsight 严格**——他们用 Python 异常和日志字符串 |
| 真 Okapi BM25（idf + k1=1.2 饱和 + b=0.75 长度归一） | §519-524 | 很多人只做词频，你做对了 |
| 确定性重放（retrievalId/candidateId 全 sha256，可逐字段复现） | §404-414 | Hindsight 依赖数据库状态，重放困难 |
| 哈工大停用词表 + CJK 2-gram + NFKC + locale 无关 lowercase | §171-210 | 中文处理是对的 |

**结论**：Decision Layer 你已经赢了。差距在底下三层。

### 三个真实问题（读代码发现，非文档推测）

#### 问题 1：`queryTerms` 按**字典序**截断 —— 系统性丢词

```js
// shadow-retrieval-pre.js:246
const terms = [...seenTerms.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
// :248
if (terms.length > SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms) {
  terms.length = SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms   // ← 保留字典序最小的 32 个
```

按字典序排序是为了确定性（对），但**截断也按字典序**就错了：保留的是 a-z 靠前的词，而**专有名词、错误码、版本号、中文 2-gram 往往排在后面**。长查询下会系统性丢掉最高信号的词。

→ **修法见 §2.2**（Hindsight 的 df-selective 选择），而且**你的 DF 已经算好了**（`:485-491`），直接复用即可，零额外成本。

#### 问题 2：BM25 无倒排，每次查询全量 tokenize

```js
// :486-492 —— 每次 lexicalSearch 都遍历全部 records 重新 tokenize 算 df
for (const rec of records) {
  const toks = tokenize((rec.heading ? rec.heading + ' ' : '') + String(rec.text || ''))
  totalTokens += toks.length; docTokensList.push(toks)
  for (const tk of new Set(toks)) DF.set(tk, (DF.get(tk) || 0) + 1)
}
```

`corpusRecords: 512` 意味着每次检索 tokenize 512 条全文。你设了 `deadlineCoreMs: 50`，规模一大必然超。
→ 增量倒排（term → posting list）+ 持久化 df，写入时更新而非查询时重算。

#### 问题 3：`recency` 只认 `workspace-log`，其他一律 0.5

```js
// :537-547
let recency = 0.5
if (/workspace-log/.test(srcRef)) { /* 用文件名日期算 2^(-ageDays/30) */ }
```

项目笔记、用户级记忆、技能、反思**全部拿固定 0.5**。等于时间维度在这些层完全不存在。

> 注：`:549` 的 `0.72/0.15/0.08/0.05` 是 **M4 shadow 纯核心**（评估通路）的加权；**生产通路的融合在别处**，见下。

#### 问题 4（关键）：生产融合层用 minmax 归一化，分数丧失绝对性

`lib/semantic-js-pre.js:33-63` `fuseD6Pre()` 是 C2 生产通路的融合：

```js
const normOf = (v, arm) => { /* ... */ return (v - a.lo) / (a.hi - a.lo) }   // minmax
fused = 0.7 * denseN + 0.3 * lexN
```

设候选集 $C$，原始分数 $d_i$（dense）/ $l_i$（lexical），归一化后 $\hat d_i = (d_i - d_{\min})/(d_{\max} - d_{\min})$。三个结构性缺陷：

1. **估计量依赖样本构成（non-stationary）**：$\hat d_i$ 是 $C$ 的函数而非 $d_i$ 的函数。同一条记忆在不同候选集中取值不同 → 门控阈值 $\tau$ 在 $\hat d$ 空间上**不具备跨查询稳定性**。
2. **矮子里拔将军（rank-preserving, relevance-destroying）**：当 $\max_C d$ 本身低于语义相关下界时，$\hat d_{\max}$ 仍为 1.0。一组全不相关的候选仍会被拉满至 $[0,1]$，绝对相关性信息被完全抹除。
3. **退化条件（degenerate case）**：$|C| \le 1$ 或极差为 0 时走 `flat` 分支记 0.5（`:48`），此时 $\forall i,\ \text{fused}_i = 0.7\times0.5 + 0.3\times0.5 = 0.5$，**排序完全失效**。

**为何对本插件尤其致命**：我们的核心命题是**注入决策（whether to inject）**，决策依赖分数与阈值的比较。若分数是相对量，则阈值只能表示"在本批候选中相对靠前"，无法表达"确实相关"。这会直接腐蚀 M7 门控的语义基础，并使 held-out 上的阈值标定不可迁移。

**对照组**：Hindsight 在融合中**保留原始 cosine 相似度**（绝对量），仅在秩空间做 RRF（见 §2.1），再由 cross-encoder 给出绝对相关性分数量供重排与截断——三层均不破坏绝对性。

**建议解法**（按推荐度）：
- **决策与排序解耦**：门控/截断用**绝对分数 + 校准阈值**（如 $\text{cosine} \ge \tau_{\text{abs}}$），融合分数仅用于批内排序。
- 若必须归一化，改用**对离群值稳健且不依赖批构成**的映射（如基于历史分数分布的分位数校准，或固定尺度 sigmoid）。
- 增补 $|C| < 3$ 的专门分支（当前会退化）。
- 验证：在既有 67 条 held-out 上，比较"minmax 融合 + 现阈值"与"绝对分数 + 校准阈值"的 precision / recall，配对 bootstrap（B=2000）给差值 CI。

---

## 2. Hindsight 深挖：六项可吸收的实现细节

### 2.1 RRF 的陷阱 —— **修正我上一轮的错误建议**

我在 S1 里说"加权融合通常优于 RRF，做对照即可"。实读后要更正：**他们踩过一个更深的坑，值得直接吸收。**

`engine/search/recall_boost.py` 模块 docstring 完整记录了这个决策：

> **问题**：加权 RRF（score space）在 `k=60` 时会崩。RRF 分数在 300 候选窗口内只跨 `1/61 → 1/360`，**动态范围仅 5.9 倍**。任何 `w > 5.9` 的权重都超过秩项的全部动态范围，排序退化为**字典序**——被加权的臂填满全部槽位。
> **实测（issue #3956）**：`recall@20` 从 **0.97 掉到 0.40**。

**正确做法（rank-space boost）**：不要 `w * 1/(k+rank)`，改为 `1/(k + rank/divisor)`。

原因是代数上的：分数空间位移 `r_max = w*(k+s) - k`，头部被常数 `w*k` 支配，被加权臂的第 360 名能压过另一臂的第 1 名。改成除秩后 **k 项被消掉**，位移变成严格比例（`r < divisor*s`），永不反转头部，且**不依赖候选池大小**。

他们的分级（含模拟验证）：

| level | rank_divisor | additive | 效果 |
|---|---|---|---|
| low | 2.0 | 0.05 | 留 100 槽给其他臂，被加权臂保护到 rank 200 |
| medium | 4.0 | 0.2 | 留 60 槽，保护到 rank 240 |
| high | 8.0 | 0.5 | 留 33 槽，保护到 rank 267 |

**对你的直接意义**：
- 你现在是**加权分数融合**（`0.72*term + 0.15*heading + 0.08*phrase + 0.05*recency`，`:549`），**不是**加权 RRF，所以不崩。
- 但权重有真问题：四个特征量纲不同（coverage 是 [0,1]、phraseMatch 是 0/1、recency 是指数衰减），`0.72/0.15/0.08/0.05` 缺乏标定依据，且 recency 0.05 太小。
- **吸收点**：若将来引入多臂（语义/图/时间），**必须用 rank-space boost，绝不能用 score-space 加权**。这个坑你现在知道，可以一次做对。

### 2.2 长查询 BM25：保留 df 最低的词，不是前 N 个

`engine/search/bm25_term_selection.py` 的 docstring：

> 长查询 tokenize 后 OR 连接成一个 `tsquery`，`@@` 门会命中库中很大一部分，`ts_rank_cd` 无 IDF 且非索引支撑，**必须对每个命中行计算**，`ORDER BY ... LIMIT` 无法在排序前剪枝 → **生产环境 +60s 超时**。
> 盲目前 N 截断是错的切法：保留的往往是常见低信号词（正是它们驱动发散），丢掉的恰是有判别力的词。
> 正解：保留 **df 最低（最有选择性）** 的 N 个 token —— 这正是 BM25 的 IDF 所偏好的。

巧思在 df 的来源：**直接从 `pg_stats.most_common_elems` 读**，PostgreSQL 的 `ANALYZE` 免费维护，无需新表、无需改索引、无需重建。

降级设计也干净：读不到统计（新表/权限/目录形状异常）→ 退回前 N，**绝不让统计问题阻塞召回**。

**对你的落地（直接修问题 1）**：
```js
// 现状：terms 按字典序排 → 截前 32
// 改：按 DF 升序排（df 低=有选择性），取前 32，再按字典序排回以保证确定性
// DF 已在 :485-491 算好，零额外成本
```
注意保留"确定性"这个你已有的好性质：先按 df 选，再按字典序稳定输出。

### 2.3 时间的**三价语义** —— 最重要的一项

`engine/consolidation/prompts.py` 里对字段的定义，是整个 Hindsight 时间设计的精髓：

```
occurred_start / occurred_end：所描述的事件何时发生。
  这可以远早于事实被陈述的时间 —— 今天记录的事实可能描述 2019 年的事件。
mentioned_at：陈述该事实的源材料何时被写下。
  这是事实的"新鲜度"：陈述有多新，而不是它何时入库。
  从旧文档提取的事实，即使刚刚才被处理，也保留其旧的 mentioned_at。
```

**三个不同的时间轴**：事件发生时间 / 陈述时间 / 入库时间。混用会出真 bug——比如"用户 2019 年毕业"这条昨天才入库的记忆，按入库时间算"很新"是错的，按 mentioned_at 算才对。

**对你的落地**（当前完全缺失，`fact-store-pre.js` 无任何 occurredAt 类字段）：

| 字段 | 含义 | 你已有 | 建议 |
|---|---|---|---|
| `occurredStart/End` | 事件实际发生时间 | ✗ | 抽取时抓，抽不到留空 |
| `mentionedAt` | 陈述时间（=新鲜度） | 部分（日志文件名日期） | 全记忆层统一 |
| `ingestedAt` | 入库时间 | 有 | 保留，但**不用于新鲜度** |

配套的，他们有独立迁移 `b3c4d5e6f7g8_add_temporal_date_indexes.py`——**时间字段要建索引**，否则时间臂检索全表扫。

### 2.4 巩固引擎的 9 条规则（157KB 代码 + 138KB 测试的浓缩）

`engine/consolidation/prompts.py` 的 `_PROCESSING_RULES`，每一条背后都是一个真实 bug：

| # | 规则 | 它在防什么 |
|---|---|---|
| 1 | **PREFER UPDATE OVER CREATE** | 近重复兄弟条目爆炸。"一条规范化观察挂多个源事实，永远优于多个兄弟各挂一条" |
| 2 | **ONE OBSERVATION PER DISTINCT FACET** | 把不相关侧面揉进一条（"有 3 个东西"+"有只叫 Rex 的狗"不该合并） |
| 3 | **MATCH BY ENTITY/FACET, NOT TOPIC** | 按主题泛匹配导致错误更新 |
| 4 | **STATE CHANGES — UPDATE CONCISELY** | 状态变化（卖掉/去世/搬家）要更新并带日期 |
| 5 | **CASCADE TO ALL AFFECTED OBSERVATIONS** | 实体从组里移除时，**个体观察和列表观察都要更新**（只改一个是经典 bug） |
| 6 | **RESOLVE REFERENCES** | 新事实给模糊占位符赋具体值（"祖国"→"瑞典"）时回填 |
| 7 | **PRESERVE HISTORY** | 重要历史事件**永不删除**；只在同一事实被完全重写或真正无意义时才删 |
| 8 | **NO COMPUTATION** ⭐ | **绝不计算、推导、调整数值**。用户说"我有 2 只狗"+"有只狗叫 Rex" → **不能更新成 3**（不知道 Rex 是不是那 2 只之一）。说"我卖掉了 X" → **不能递减计数**。只在用户明确说出新数值时才更新 |
| 9 | **KEEP DISTINCT TOPICS DISTINCT** | 不同人/实体的观察不合并 |

**第 8 条是防幻觉的命门**，值得单独说：LLM 巩固最大的失败模式就是"自作聪明做算术"。你的自动沉淀子代理如果有类似行为，会在用户记忆里种下编造的数字。建议立刻检查你的固化 prompt。

**语言规则**（同一文件 `_DEFAULT_LANGUAGE_RULE`）也很实用：
> 每条观察用它自己源事实的语言，绝不翻译（按观察粒度，不是按批次）。
> 当现有观察与新事实语言不同时，**不要就地编辑措辞**——那会产生"英文句子上接一个中文细节"。丢弃旧措辞，用新事实的语言从头重组。

这条说明他们遇到过"多语言模型漂移：中文源事实间歇性产出英文观察"。

### 2.5 中文时间解析要单开规则文件

`engine/chinese_temporal_periods.py` **86KB**，独立成文件。原因写在 `temporal_periods.py` docstring：

> 中文规则集**大得多**，且与基于空格的语言有**不同的边界行为**。

踩过的坑（issue #3250，注释里有）：
> 孤立的四位数字是歧义的——dateparser 把每个孤立整数都当年份，于是**端口号和工单号变成了时间约束**（"port 2019"）。
> 消除歧义的是**引导词**："in 2019" 是年份，"port 2019" 不是。dateparser 无法做这个判断（两者返回相同的 span "2019"），所以规则必须写在**还能拿到完整 query** 的地方。
> 且**刻意排除 "since"/"from"**——它们开启的是截止到现在的区间，而非闭合区间。

**对你的意义**：你要做时间检索，中文时间解析（"上周三""前天下午""上个月底""春节前"）是绕不开的硬活，而且**必须用规则而非纯 LLM**（成本+确定性）。这是 86KB 的工作量，但可以先覆盖高频 20% 表达式。

### 2.6 一个反直觉的性能实测：线程池 1 个 worker 最快

`engine/search/temporal_extraction.py` 的注释里有完整 benchmark：

```
16 个并发提取，文档规模文本：
inline              total= 1318ms   loop stall max=1318ms
max_workers=1       total= 1438ms   loop stall max=   2.8ms
max_workers=2       total= 2091ms   loop stall max=   4.5ms
max_workers=4       total= 4751ms   loop stall max=   6.3ms
unbounded           total=16688ms   loop stall max=  33.8ms
```

原因：工作是纯 Python、持 GIL，加宽线程池**不增加并行度，只增加 GIL 争抢**。1 个 worker 吞吐 +9%，事件循环停顿改善 **470 倍**。

**对你的意义**：你的 Python sidecar（`worker_semantic_pre_v1.py`）如果在做 CPU 密集的 embedding/解析，**不要盲目加并发**。另外：纯 CPU 工作必须移出 asyncio 事件循环，否则会 stall 整个进程（他们实测 1.3 秒只有一次调度 tick）。

---

## 3. OpenViking：取架构，不取代码

按 S1 §0 的纪律，AGPLv3 项目不读源码。但其架构价值在**论文与公开文档**中已完整可得：

| 机制 | 公开可得的结论 | 我们的映射 |
|---|---|---|
| L0/L1/L2 分层 | L0 ~100 tok / L1 ~2k / L2 原文；目录本身也带 L0/L1 | 已有 checklist/excerpt/hint 三级，**缺 token 账本量化** |
| 目录递归检索 | 向量先定位目录 → 逐层下钻；结果自带周围上下文 | 我们的 scope 分层可借鉴"先定位分组再下钻" |
| 检索轨迹可观测 | 保留完整目录浏览轨迹，错了可回溯 | **我们已有更强的 evidence 链 + 五档复核** |
| session → memory 异步抽取 | commit 后异步抽取，可按用户配 `memory_policy` | 已有自动沉淀子代理；缺"按类型限定抽取"的策略层 |
| Context Compilation | LLM Wiki / 知识图谱 / 日报 / 知识蒸馏等复用工作流 | 与我们的每日反思、30 天蒸馏同源 |

**结论**：OpenViking 对我们最有价值的是 **token 账本这个指标口径**（把分层节省量化成可对外引用的数字），其余我们基本已有或更强。

---

## 4. 落地优先级（按 ROI 排序）

| # | 事项 | 依据 | 成本 | 依赖 |
|---|---|---|---|---|
| **1** | **检查固化 prompt 是否违反 NO COMPUTATION**（§2.4#8） | 防幻觉，错了会污染用户记忆 | 极低 | 无 |
| **2** | **修 queryTerms 字典序截断 → df-selective**（§2.2） | DF 已算好，改动约 10 行 | 极低 | 无 |
| **3** | **融合层绝对性**：先加 $\|C\|<3$ 退化分支（防御性，立即），再做绝对阈值标定（§1 问题 4） | 门控阈值建立在相对量上，标定不可迁移 | 低 → 中 | 无 |
| **4** | **建 token 账本**（S1 §3.1） | 把已做对的事变成可对外引用的数字 | 低 | 无 |
| **4** | **时间三价字段**（§2.3） occurredStart/End + mentionedAt + 索引 | 时间维度是一切时序推理的地基 | 中 | 无 |
| **5** | **增量倒排索引**（§1 问题 2） | 规模一大会超 50ms deadline | 中 | 无 |
| **6** | **巩固规则吸收**（§2.4 九条，改写为我们自己的表达） | 直接提升记忆质量 | 中 | 4 |
| **7** | **中文时间解析**（§2.5，先覆盖高频 20%） | 硬活，但无它时间检索是空谈 | 高 | 4 |
| **8** | **多臂融合**（引入时用 rank-space boost，§2.1） | 现在做会踩坑，等有多臂再做 | 高 | 4/5 |

**1 和 2 今天就该做**——都是几十行改动，一个是防灾难，一个是修系统性 bug。

---

## 5. 一句话

**他们的深度不在算法，在"踩过的坑都写进了注释"。** issue #3956 的 recall@20 崩塌、#3250 的 port 2019、GIL 线程池的 470 倍差距、NO COMPUTATION 的算术幻觉——这些是免费的经验，且全部不受版权保护。**把这些吸收了，比抄一万行代码值钱。**
