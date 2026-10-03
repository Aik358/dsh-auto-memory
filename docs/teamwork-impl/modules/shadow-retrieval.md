
## shadow-retrieval

- **文件**：`lib/shadow-retrieval.js`
- **规模**：39,389 B / 674 行 / 30 个导出符号
- **职责一句话**：**M4-1 影子检索纯核心** —— 只读、纯函数地跑一遍检索，**只记录、不改变任何返回值**（`docs/M4-CONTRACT.md` §6-§16）。

> ## 铁律适用声明（本节优先于全文其他表述）
>
> **JS 端语义模型 = 默认形态；Python 端 = 发烧友进阶项。两者是两项相对独立、可互相替换的功能，严禁互相联动。**
>
> **本模块与主检索的关系（源码 L2-L5 逐字核实）**：*"只读、纯函数、零 IO、零依赖(除 `node:crypto`)；**不接入 `lib/index.js`**、不读真实文件、不写 audit、不产生任何模型可见副作用（**M4 唯一模型行为 = 不影响模型行为**）。"*
> ⇒ **影子检索与主检索是「并行观察」关系**：它**只记录**自己的结果，**不改变**主检索的返回值。
> ⚠️ **它不是任何一端的前置依赖**，也不是"第二套检索"—— **主检索不因它的存在或缺失而改变**。
> 文中出现的 `sidecar-missing` / `sidecar-invalid`（L93）指的是 **M3b 记忆文件 sidecar**（`memory-anchor.js:258` 的产物），**不是 Python sidecar** —— 二者同名不同物，见下方"术语辨析"。

### 术语辨析（**本模块最易误读的一点**）

| 术语 | 出现位置 | 实际含义 |
|---|---|---|
| `sidecar-missing` / `sidecar-invalid` | L93（`DROP_REASONS`） | **M3b 记忆文件 sidecar**（`memory-anchor.js:258 buildSidecarPre` 的产物，与 Markdown 同目录的派生索引） |
| "Python sidecar" | **本文件不出现** | Python worker 进程（由 `python-sidecar-client.js:76` 管理） |

⇒ **本模块与 Python 完全无关**。脚本搜索到的 L93 命中属**同名词**，不是联动。

### 数据流（影子检索如何并行观察）

| 方向 | 内容 |
|---|---|
| **上游输入** | 与主检索**相同的查询**（同一份输入，保证可比性） |
| **本模块职责** | 在旁路执行一份**影子检索**，记录其结果供对比分析 |
| **输出** | 影子结果 + 差异报告（与主检索的排名/命中差异） |
| **写回主链路？** | **❌ 不回写**。这是"影子"的定义——它**只观察、不干预** |
| **下游消费者** | 调优/评测工具（人工查看差异），**不是**主召回链路 |
| **副作用** | 只为观测而存在；不得改变主检索的返回值 |

**关键推论（铁律的正面样本 + 一条团队化纪律）**：
- 本模块与 Python **完全无关**（脚本搜到的同名命中属**同名词**，已由术语辨析表澄清）。
- **团队化纪律**：影子的"并行观察"性质**必须保持**——不得因为进了团队模式就把它接成主链路的依赖。
- 判据：影子检索的返回值**不得**出现在主检索的返回路径上（可写成静态断言：主链路函数体不引用影子模块）。

### 逐段精读（带真实行号）

**L1-L16 · 文件头：八大组成**

- **L2-L5**：*"只读、纯函数、零 IO、零依赖(除 `node:crypto`)；不接入 `lib/index.js`、不读真实文件、不写 audit、不产生任何模型可见副作用（**M4 唯一模型行为=不影响模型行为**）"*
- **L6-L14**：策略常量 / 快照校验 / `memoryIndexVersion` / GateSignals+GateDecision+`gate_pre_v1` / 确定性 tokenizer + QueryPlan + queryDigest / `lexical_pre_v1` / Candidate 身份 / replay pure core
- **L15**：*"全部函数对同输入逐字段确定"*

**L24-L30 · 词典与策略常量**

| 行号 | 符号 | 说明 |
|---|---|---|
| L24 | `STOPWORDS_HIT_PRE_V2` | 冻结停用词表（体积巨大，千词量级） |
| L25 | `GATE_POLICY_VERSION` | `gate_pre_v1` |
| L26 | `LEXICAL_POLICY_VERSION` | `lexical_pre_v2` |
| L27-L29 | `INDEX_PREFIX` / `RETRIEVAL_PREFIX` / `CANDIDATE_PREFIX` | 三类身份前缀 |
| L30 | `NAMESPACE` | `dsh-auto-memory-pre` |

**L33-L102 · 门策略与丢弃原因**

| 行号 | 符号 | 说明 |
|---|---|---|
| L33 | `SHADOW_GATE_POLICY_PRE_V1` | 门策略（硬抑制顺序 + 权重滞回 + cooldown） |
| L64 | `SHADOW_LEXICAL_BUDGET_PRE_V1` | 词法预算 |
| L85 | `DROP_REASONS` | **丢弃原因枚举**（含 L93 的 `sidecar-missing` / `sidecar-invalid` = **M3b sidecar**） |
| L102 | `DROP_REASON_SET` | 集合形态 |

**L105-L145 · 快照校验与索引版本**

| 行号 | 符号 | 说明 |
|---|---|---|
| L105 | `validateSnapshot` | `RetrievalContextSnapshot` 校验 |
| L145 | `memoryIndexVersion` | canonical corpus tuples → `idx_pre_ + sha256`（**与 `state-commit.js:31` 的 `MIV_PREFIX_PRE` 同口径**） |

**L171-L221 · 确定性 tokenizer**

| 行号 | 符号 | 说明 |
|---|---|---|
| L171 | `normalizeText` | NFKC / lowercase / 词形保留 |
| L178 | `cjkGrams` | CJK 2-gram |
| L186 | `tokenize` | 分词 |
| L214 | `isStopWord` | 停用词判定 |
| L221 | `buildQueryPlan` | QueryPlan + `queryDigest` |

**L289-L450 · 信号、门、身份与脱敏**

| 行号 | 符号 | 说明 |
|---|---|---|
| L289 | `computeSignals` | GateSignals 计算 |
| L348 | `gatePreV1` | **门决策（硬抑制顺序 + 滞回 + cooldown）** |
| L404 / L411 | `buildRetrievalId` / `buildCandidateId` | **确定性身份** |
| L417 / L424 | `canonicalPlugDate` / `logDateFromSourceRef` | 日期规范化 |
| L431 / L437 / L438 | `phraseHit` / `isAlnum` / `isCjk` | 词法辅助 |
| L450 | `sanitizeExcerpt` | **摘录脱敏** |

**L463-L634 · 词法检索与候选构造**

| 行号 | 符号 | 说明 |
|---|---|---|
| L463 | `lexicalSearch` | `lexical_pre_v1`（term/heading coverage、phrase、recency、total、排序/去重/预算/drop） |
| L610 | `buildCandidates` | ShadowCandidate 构造 |
| L634 | `replay` | **replay pure core**（canonical 结果排除 recordedAt/latency/runtimeTag） |

### 对外接口（导出符号表）

| 组 | 行号 | 符号 |
|---|---|---|
| 策略常量 | L24–L102 | `STOPWORDS_HIT_PRE_V2` / `GATE_POLICY_VERSION` / `LEXICAL_POLICY_VERSION` / `INDEX_PREFIX` / `RETRIEVAL_PREFIX` / `CANDIDATE_PREFIX` / `NAMESPACE` / `SHADOW_GATE_POLICY_PRE_V1` / `SHADOW_LEXICAL_BUDGET_PRE_V1` / `DROP_REASONS` / `DROP_REASON_SET` |
| 快照校验 | L105 / L145 | `validateSnapshot` / `memoryIndexVersion` |
| tokenizer | L171–L221 | `normalizeText` / `cjkGrams` / `tokenize` / `isStopWord` / `buildQueryPlan` |
| 门 | L289 / L348 | `computeSignals` / `gatePreV1` |
| 身份与脱敏 | L404–L450 | `buildRetrievalId` / `buildCandidateId` / `canonicalPlugDate` / `logDateFromSourceRef` / `phraseHit` / `isAlnum` / `isCjk` / `sanitizeExcerpt` |
| 词法与候选 | L463–L634 | `lexicalSearch` / `buildCandidates` / `replay` |

### 与团队化的关系

**判定：S3 派生重算（影子结果是纯派生）+ S0（影子状态是 runtime 级）。**

理由：本模块**只读、纯函数、零副作用**（文件头 L2-L5 逐字）⇒ 它的输出完全由输入决定，**不可能也不应该同步**。
**铁律约束（正面）**：影子检索是**并行观察**，**不得**成为任何一端的前置依赖。团队化**不得**让"团队侧影子检索就绪"成为"本地主检索生效"的条件。

### Teamwork 改造点（附可直接复制的代码）

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| SR1 | L2-L5 文件头 | "不产生任何模型可见副作用" | **保持不变**（团队化不得让影子结果回流主检索） | 纪律 |
| SR2 | `gatePreV1` L348 | 门策略 | 团队**新增门**须追加到枚举末尾，**不改既有硬抑制顺序** | 顺序纪律 |
| SR3 | `buildRetrievalId` L404 / `buildCandidateId` L411 | 确定性身份 | **不得掺入 actorId**（否则跨端无法比对同一批结果） | 纪律 |
| SR4 | `DROP_REASONS` L85 | 封闭枚举 | 团队新增丢弃原因**只追加**；注意 L93 的 `sidecar-*` 指 **M3b sidecar** | 命名歧义 |
| SR5 | 新增 `describeShadowParityPre` | 无 | 描述影子结果与主检索的**一致性**（并行观察的证据） | 新增导出 |

#### 片段 1：影子结果**只记录、不回流**（铁律边界的代码体现）。位置：`shadow-retrieval.js:634`（`replay` 返回处）

```js
/**
 * 铁律边界：影子检索的结果**只用于观察与审计，绝不回流主检索**。
 *
 * 本模块文件头 L2-L5 明文："只读、纯函数、零 IO、零依赖……不产生任何模型可见副作用
 *（M4 唯一模型行为 = 不影响模型行为）"。
 *
 * 为什么在团队化下更要说清：团队化会新增"团队记忆参与检索"的诉求，
 *   最省事的实现就是"让影子检索的结果直接进主检索排序"—— 这恰恰是本模块禁止的：
 *   ① 影子结果一旦影响返回值，就不再是"观察"，而是**第二套主检索**；
 *   ② 它会与主检索形成**两条可独立影响同一行为的输入**（本仓判据：未真正合并）；
 *   ③ 团队侧的影子索引若未就绪，会**静默改变**本地主检索结果。
 * ⇒ 团队化新增的团队召回必须走**主检索链路**，而不是借影子通道。
 *
 * @param {object} canonical replay 的 canonical 结果
 * @returns {{observational:true, result:object}} 明确标注"仅观察"
 */
function replayForObservationPre(canonical) {
  // 返回值刻意包一层 observational 标记：任何消费方都必须显式解包，
  // 从而在代码评审时一眼可见它被当成了观察数据还是主检索数据。
  return { observational: true, result: canonical }
}
```

#### 片段 2：影子一致性描述（新增导出，放文件末尾）。**这是"并行观察"可被验证的方式**

```js
/**
 * 描述"影子结果 vs 主检索结果"的一致度 —— **并行观察的证据出口**。
 *
 * 铁律口径：本函数**不判断谁更权威**，只报告两组结果的差异。
 *   影子检索是**并行观察者**，它的价值是"提供一套独立观测"，不是"正确的那个"。
 *
 * 为什么需要它：影子结果若与主检索长期大幅不一致，
 *   说明其中一侧的口径漂移了（如 tokenizer 版本、预算、门策略）。
 *   没有这个出口，差异会**静默存在**——与 degrade.js:33 记录的 R2 事故同型
 *   （"四条臂各自独立降级、各自静默 ⇒ 可同时失效而使用者只感到检索不太对"）。
 *
 * @param {{ids:Array<string>}} shadow 影子侧命中 id
 * @param {{ids:Array<string>}} main 主检索侧命中 id
 * @returns {{shadowCount:number, mainCount:number, overlap:number, jaccard:number, note:string}}
 */
export function describeShadowParityPre(shadow, main) {
  const s = new Set((Array.isArray(shadow && shadow.ids) ? shadow.ids : []).map(String))
  const m = new Set((Array.isArray(main && main.ids) ? main.ids : []).map(String))
  let overlap = 0
  for (const id of s) if (m.has(id)) overlap++
  const union = s.size + m.size - overlap
  const jaccard = union > 0 ? Number((overlap / union).toFixed(4)) : 1
  const note = (s.size === 0 || m.size === 0)
    ? '一侧为空，无法比对（空结果与"无命中"不可区分，需结合 DROP_REASONS L85 诊断）'
    : ('shadow=' + s.size + ' main=' + m.size + ' overlap=' + overlap + ' jaccard=' + jaccard)
  return { shadowCount: s.size, mainCount: m.size, overlap: overlap, jaccard: jaccard, note: note }
}
```

### 风险与守卫

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **影子结果回流主检索** | 团队化"复用影子算力" | 片段 1 的 observational 包装 + 文件头 L2-L5 纪律 |
| **影子成为前置依赖** | 主检索等影子就绪才跑 | 铁律 + SR1：影子不得成为任何一端的前提 |
| **身份掺入 actor** | 为区分来源改 id | SR3 纪律（跨端比对同一批结果需要同 id） |
| **sidecar 术语被误读成 Python** | L93 枚举名 | 术语辨析表；SR4 提示 |
| **口径漂移静默** | tokenizer/预算版本不一致 | 片段 2 一致性出口 |

**既有守卫**：`shadow-retrieval` 的纯函数确定性用例（同输入逐字段相同）、门策略用例、tokenizer 用例、`replay` canonical 用例（排除 recordedAt/latency/runtimeTag）。**"零 IO / 不接入 index.js"很可能被静态守卫断言**（文件头明文）。
**建议补的铁律守卫**：断言"影子检索关闭时，主检索返回值与开启时逐字节相同"—— 把"并行观察、不影响模型行为"钉成可验证事实。
