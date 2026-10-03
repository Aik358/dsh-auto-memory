# ③ Hermes 遗留修复 · 现状核查结论（2026-09-19）

> **本文档的结论会改变排期判断**，故单独立档。
> 触发：按 `PRE-FRONTEND-CHECKLIST-20260919.md` 执行序推进 ③ 时的实施前核查。
> 方法：直读 `lib/procedure-*.js` 真实代码 + `artifacts/_probe-procedure-promotion.mjs`（**25/25**，执行真实 store，不 mock）。

---

## 1. 一句话结论

**③「Hermes 遗留修复」所指的 issue #30 三处缺陷，在本仓 pre 线已经全部修复，且晋升链路端到端可达。**
⇒ **③ 不应再作为「待修的 bug」排期**；它的真实形态是**「验证 + 决定是否打开开关」**。

---

## 2. 证据链

### 2.1 三处修复均已落地（代码 + 行为双证）

| # | issue #30 的原始缺陷（ZCode 2026-09-13 审计） | 本仓现状 | 证据 |
|---|---|---|---|
| 1 | **按 `title` 去重** ⇒ 同名富候选被合并进观察行，`steps`/`successCriteria` **整体丢失** ⇒ promote 永久卡死 | ✅ **已修**：改按**指纹**匹配（指纹含 steps/preconditions/checks/successCriteria/rollback/isObservationOnly） | `procedure-observation-pre.js:21-30`；注释原文「**A title is not an identity**」 |
| 2 | **观察行与富候选互相污染** | ✅ **已修**：`observe()` 先归一化历史行再指纹匹配；入参数组深拷（防调用方改脏） | `procedure-store-pre.js:153-174` |
| 3 | **失败原因码不可区分**（都报 `no-success-criteria` ⇒ 误导"补判据就能晋升"） | ✅ **已修**：观察行**短路**返回 `observation-only` | `procedure-store-pre.js:270-273` |

**行为级验证**（探针 Q1，8/8）：同名观察行与富候选**各自独立成行**（`procedureId` 不同）、富候选 `successCriteria` **未丢失**（长度 2）、原因码为 `observation-only` 而非 `no-success-criteria`。

### 2.2 ★ 澄清一处易误判的代码

`memory-hub-pre.js:145` 的 `sourceMemoryIds: []` **不是** issue #30 的旧 bug，而是**修复的一部分**：

- 它出现在 `crossFeed()`（episode 自动喂）里，**配套** `observationOnly: true`（`:143`）。
- 该通路产出的**本就只能是「观察行」**——episode 只提供"观察到一件事"的线索，不足以构成可晋升技能。
- 硬编码空数组是**刻意的**：观察行**结构上**不该有 memoryId 证据（不得凭空造 provenance）。

> ⚠️ **判据（可复用）**：看到「硬编码空数组」先别判 bug —— 先查它是否**与一个显式的语义标记配套**（此处 `observationOnly`）。
> 与「看到配置是关的，先查是不是有意关闭」是同一条纪律的变体。

### 2.3 富候选有真实通路（探针 Q3b，7/7 端到端）

两条通路职责分离：

| 通路 | 来源 | 产出 | 能否晋升 |
|---|---|---|---|
| ① `crossFeed()` | episode 成功 | **观察行**（`observationOnly:true`，`sourceMemoryIds:[]`） | ❌ 结构上不可（设计如此） |
| ② `ingestJudgement()` → `procedureCandidateFromRow()` | judgement 行 | **富候选**（`sourceMemoryIds` 非空、`successCriteria` 透传） | ✅ **可** |

**端到端实证**：构造合法 judgement 行 → `procedureCandidateFromRow` 产出候选（`sourceMemoryIds` 非空、带 `successCriteria`、**无** `observationOnly`）→ `observe()` 入账 → `promote({distinctSessions:3, successCount:2})` ⇒ **`decision:'promote'`，`stage:'validated'`**。

---

## 3. 那么「真待办」是什么

ZCode 审计另有一条**未在本仓验证过**的事实：**全机 7 个工作区均无 `procedures.json`，"固化成 skill 再注入"从未真正发生过。**

结合本次核查，真实待办**不是**「修引擎」，而是下面两件（**均需用户裁定或观测**）：

| 项 | 问题 | 性质 |
|---|---|---|
| **H-1** | **上游是否真的产出富候选？** 通路②可达 ≠ 有东西走它。需确认 judgement 行的真实产出率（本机 0 个 `procedures.json` 提示**可能为 0**） | **观测项**，非代码缺陷 |
| **H-2** | **`procedurePromotionEnabled` 打开后会发生什么？** 引擎已就绪，但开关一开即改变所有用户行为 | **需用户拍板** |

> **与用户原话的关系**：用户说「所以才先关掉的，**改完自然就能打开了**」——本次核查表明**引擎侧已经改完**。
> ⇒ 因此「能否打开」的判据应从**代码就绪**转为**观测 H-1**：若上游长期产不出富候选，打开开关也只是让观察行持续堆积（无收益但无害）；反之则有真实收益。

---

## 4. agent 的建议（不自行决定）

1. **③ 从「待修」降级为「待观测」**：先加一个**只读探针**统计本机/目标用户的 judgement 行产出率与 `procedure_candidate` 命中数（零风险，属 R 系列观测面）。
2. **开关保持 `false` 不动**，直到 H-1 有数据（与 ⑤ R4-C 的「等观察结果」同一处置逻辑）。
3. **不在本轮改任何 `procedure-*.js`** —— 用户 2026-09-13 明确「**任何 procedure 记忆引擎改动必须等用户拍板整体方案，别顺手修**」，且「两个小改点已并入统一重构，**不单独做（动了也是白改）**」。

> 上述 3 条是**建议**，不是结论；H-2 属用户拍板项。
