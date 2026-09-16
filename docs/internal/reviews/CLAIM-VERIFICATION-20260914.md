# 主张核实结论表 · 2026-09-14

> **用途**：第一轮外部评审（`docs/internal/reviews/REVIEW-gpt6astra-20260914.md`）A 节列出的 12 条「文件:行号」主张，逐条对照**当前代码**核实后的结论。
> **这是第二轮投喂的输入之一**：告诉对方哪些主张**已被证实**（可当前提）、哪些**行号有误但实质成立**、哪些是**架构级必改项**。
> **核实方式**：只读核实（读文件 + grep），未修改/创建/删除任何文件，未运行任何测试，未执行 git 写操作。
> **我方独立复核**：C8（最严重的一条）已由本会话自行打开 `tests/smoke/smoke-test-c5-tier-inject-pre.mjs:115-137` 与 `docs/internal/THREE-LAYER-CONTRACT.md:178-189` 逐行复核确认。

---

## 结论摘要

**12 / 12 条成立**（真 10 + 部分真 2），**假 0 条，无法判定 0 条。**

- **行号有误但实质成立**：C5（`125` 是函数签名行，实际行为在 `126–127`；`138` 正确）、C10（`323` 是注释行，实际行为在 `327–335`）。
- **行号在可接受范围**（指向路径首行/字面量首行，非错引）：C9（`3894` 守卫首行，复用赋值在 `3896`、拼装在 `3901`）、C12（`149` 为 `FIELDS` 字面量首行，条目在 `150–157`）。
- 其余 8 条行号与当前文件逐一一致。

**因此：第一轮评审不是「看着像真」，是真的。其 A1–A3 应按事实指控处置，而非按意见讨论。**

---

## 逐条核实表

| 编号 | 判定 | 证据（当前文件:行号） | 说明 |
|---|---|---|---|
| **C1** | 真 | `lib/semantic-js-pre.js:60` | `fused: D6_FUSION_WEIGHTS_PRE_V1.dense * denseN + D6_FUSION_WEIGHTS_PRE_V1.lexical * lexN`；`denseN`/`lexN` 由 `normOf` 归一化（:46–51）⇒ 确为**归一化分数空间加权**，与 S3.2「禁止分数空间加权」相悖。 |
| **C2** | 真 | `python/worker_semantic_pre_v1.py:486`；调用点 `:907` | `:486 \| c['fusedScore'] = round(w * dn + (1 - w) * ln, 6)`（`dn`/`ln` 来自 `:479–481` 的 `_minmax`）；`:907 \| candidates = self.hybrid_rank(candidates, query, …)`。两行号均准。 |
| **C3** | 真 | `lib/context-host-pre.js:378` | `keptList = fuseD6Pre([...poolMap.values()].map((k) => ({ …`）—— JS 侧 D6 加权的唯一生产调用点。 |
| **C4** | 真 | `lib/activation-inbox-pre.js:255` | `const sorted = [...items].sort((a, b) => b.score - a.score \|\| …)`；`items` 的 `score` 源自 `c.score`（`:357`），JS 路径＝裸稠密分（`context-host-pre.js:505`）、Python 路径＝裸 `c['score']`（worker `:637`）⇒ **融合序在尾注渲染时被重排覆盖**。 |
| **C5** | **部分真** | `lib/l0-index-pre.js:126–127`（主张写 125，实为函数签名行）；`:138` 正确 | `:126 texts = items.map(it => it.l0)`、`:127 await embedder.embedPassages(texts)` ⇒ **先全量嵌入**；`:138 const reused = prev && prev.l0Hash === l0Hash` 才判复用（`:141` 应用）。「增量不省嵌入算力」**实质成立**；`update → assemble(:213)` 对全部 items 嵌入。 |
| **C6** | 真 | `lib/l0-index-pre.js:219` | `recomputed: changed,`；`changed` 在 `:204–210` 按 `l0Hash` 分类计数（新增/变化），**与实际嵌入次数（`items.length`）不同**。（`:179` 的 `buildFull` 路径才是 `recomputed: entries.length`。） |
| **C7** | 真 | `python/m7_embedding_pre_v1.py:75` | `def chunk_id_for(memory_id, record_digest, ordinal)`，哈希串含 `record_digest`（`:77`）；调用处 worker `:317`/`:338` 传入整条 `rec['recordDigest']`（来源 `memory-anchor-pre.js:131`/`:211`）⇒ **改一个块则整条记录所有块 ID 全变**，块级复用无从谈起。 |
| **C8** | 真 | `tests/smoke/smoke-test-c5-tier-inject-pre.mjs:127,133`；契约 `docs/internal/THREE-LAYER-CONTRACT.md:183` | `:127` 放入 `status: 'superseded'` 候选；`:133 eq(lines.length, 3, 'Tier-1 条数=命中数(≤K)')` 断言三条**全留**；`:137` 更显式断言 `lines[2]`（即那条 superseded）带 `0.55` 分。I5 原文（契约 `:183`）：**「非 `current` 的条目在检索结果与注入内容两处都被过滤」** ⇒ **我方测试把违反 I5 的现状锁成了正确行为**。本会话已逐行独立复核确认。 |
| **C9** | 真 | `lib/index.js:3894`（守卫首行）、`:3895`、`:3896`、`:3901` | `:3894 fresh = !!gh && Date.now() - gh.at < 30*60000`（**只查时间**）、`:3895` 只查 session、`:3896` 直接复用 `gh.hits`、`:3901` 与**当前** sources 拼装；`_tierGateHits` 投影本身不含 `miv`（`activation-host-pre.js:151–165`）⇒ 全路径**无处比对 `miv`**，I6（契约 `:184`「三层来自同一份快照（同一 `miv`），混版视为错误」）失守。（若按"复用赋值行"口径，正确行号是 `:3896`。） |
| **C10** | **部分真** | `lib/tier-layer-inject-pre.js:327–335`（主张写 323，实为注释行） | `:323` 只是注释「只裁下探段，目录层与降级行永不裁」；实际裁剪循环在 `:329` 仅 `lines.pop()`（`drillParts`），`headParts`（目录＋降级行）从不动；`:332–334` 在裁剪**之后**把 `[降级] 下探段超注入预算，已裁剪 N 行…` push 进 `headParts`，`:336` 拼入 `text` ⇒ **最终长度可超 `maxTotal`**。 |
| **C11** | 真 | `lib/index.js:3986` | `const catalogCost = s.tier0LayerText ? Math.min(String(s.tier0LayerText).length + 2, Math.floor(budget * 0.35)) : 0` —— 封顶的是 **35% 的扣账成本**（供 `:3987` 的 `sub` 计算）；实际注入用全文 `s.tier0LayerText`（`:3957`），**不参与 `used` 记账** ⇒ 账面与实际双口径。 |
| **C12** | 真 | `tests/smoke/smoke-test-doc-code-consistency-pre.mjs:149–157` | `const FIELDS = [` 下恰好 **7 项**：`l0IndexEnabled` / `tier0CatalogEnabled` / `injectBudgetChars` / `tier0MaxTokens` / `tier0BudgetShare` / `B0` / `B2`（`:150–157`；`TRACKED_NAMES:89` 同七项）；`TIER_BUDGET_PRE_V1`（`tier-layer-inject-pre.js:32–40`）里的 **`L1` / `K` / `projectRatio` / `floorRatio` / `maxTier2Blocks` 均未覆盖**。 |

---

## 必须进施工方案的 5 项（架构级，非测试写法）

1. **C5 + C6 ·「增量索引」名实不符**：`assemble` 每次全量 `embedPassages`，`recomputed` 又是"变化计数"而非真实编码次数 ⇒ 要么做**真增量**（只嵌入 hash 变化的条目），要么把指标改成诚实口径。**否则 3.0 的「增量索引」是空头承诺。**
2. **C7 · 块 ID 含整条 `recordDigest`** ⇒ **块级向量缓存必须先改成按「块内容摘要」做键**，否则 3.0 目标④「块级向量缓存」根本无法兑现。
3. **C9 · I6 失守**：命中投影不带 `miv`，跨版本复用旧命中并与当前 sources 拼装 ⇒ 投影需带 `miv`，并在 compose 处比对（**属接口改动**）。
4. **C11 + C10 · 预算账本双口径**：扣账成本被 35% 封顶、目录却按全文注入；裁剪之后又追加降级行 ⇒ **`injectBudgetChars` 目前不是硬上限**，需收敛为单一口径记账。
5. **C1 / C2 / C4 · 排序语义未定**：minmax 分数空间融合（D6）＋ 尾注按裸 `score` 重排 ⇒ 必须先裁定「**融合分是否决定展示顺序**」，并与 `lib/recall-fusion-pre.js` 的 rank-space RRF **存并取舍**一并解决。

---

## 第二轮如何使用本表（纪律）

- 本表中判**真 / 部分真**的条目，在第二轮提示词里**直接认证为事实**，要求对方**不必再论证**，只需给出落地方案——省下的篇幅全部用于 Phase 设计与验收断言。
- 判**部分真**的两条（C5、C10），第二轮须显式给出**修正后的行号**，并要求对方按修正后的位置写改动点。
- 对方在第二轮若**重新引用已被本表修正的行号**或**把本表已认证的事实重新论证一遍**，视为未承接，退回。
- 对方若**指出本表某条核实有误**，必须写明"我方哪一步错了"（读了哪个文件的哪一行、得出什么相反结论）；接受反驳，但反驳同样要落到 `文件:行号`。
