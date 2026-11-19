# 批次3 文档全量核对报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-33）
> 工作区 `D:/dsh-auto-memory`｜分支 `preview`｜开工 HEAD **`3db09940`**
> **性质：全量只读核对。不改生产代码、不启动 HOST、不 push/不发版。**

---

## 0. 结论速览

| 分类 | 数量 | 说明 |
|---|---|---|
| **必须修订（M）** | **13 项** | 任一项不修，施工者会读到互斥指令或按不可执行验收施工 |
| **可接受（A）** | **7 项** | 已核对为真实、自洽、可执行 |
| 核对文档 | 10 份 | 覆盖三份新文档 + 两份旧源文档 + 四份配套证据 |

**最高优先级 3 项**：

1. **M1 三份文档互不引用且各自宣称权威** —— 施工者读到任一份都以为它是最终依据。
2. **M2 同一代号 `B3-RC` 有两套完全不同范围的 API**（读全部注入源 vs 只读规则）。
3. **M3 profile 定义三方零字段重合**，无法同时满足。

---

## 1. 核对范围与取证指纹

| 文档 | 字节 | 行 | sha16 |
|---|---|---|---|
| 契约（`DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md`） | 7425 | 144 | `AB2BFF4933C47EB0` |
| 施工细则（`DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md`） | 15843 | 323 | `53A74D0C95BA5021` |
| 统一大纲（`DETAIL-BATCH3-UNIFIED-20261116.md`） | 21708 | 282 | `034183EAC6F53D6E` |
| 编号解耦（`REPORT-BATCH3-NUMBERING-DECOUPLING-20261116.md`） | 8712 | 161 | `B186393AC0133C00` |
| 旧施工细则（`DETAIL-BATCH3-IMPLEMENTATION-20261113.md`） | 19981 | 492 | `5AD237197333DCB7` |
| 旧进度报告（`REPORT-3.0-INJECTION-PROGRESS-20261113.md`） | 7357 | 78 | `AA4CA09661538919` |
| 依赖测绘（`REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md`） | 18050 | 215 | `7584EA8CFB9458BD` |
| 第二批复核（`RESULT-BATCH2-IMPLEMENTATION-REVIEW-20261116.md`） | 13625 | 251 | `6E593D04323BFBD9` |
| 注入准则（`CONSTRUCTION-GUIDELINE-INJECT-20261108.md`） | 35121 | 508 | `2F4A6548C6E7D647` |
| 模块化调查（`INVESTIGATION-BATCH3-MODULAR-API-20261113.md`） | 21942 | 356 | `ADB77D9B019769CB` |

**核对方法**：API 签名用正则从原文提取（`([a-z][A-Za-z]+Pre)\(\{([^}]*)\}\)`）；代码事实用当前源码可复算命中；「已裁定」项逐条对代码验。

---

## 2. 必须修订项（M1–M13）

### M1 🔴 三份文档互不引用，且**各自宣称自己是权威**

**证据（相互引用矩阵，本轮实测）**：

| 文档 | 提到 CONTRACT | 提到 SEQUENCE | 提到 UNIFIED |
|---|---|---|---|
| CONTRACT | — | ✗ | ✗ |
| SEQUENCE | ✓ | — | ✗ |
| UNIFIED | ✗ | ✗ | — |

**三处权威声明原文（互斥）**：

- CONTRACT：「本文件**内联到总体施工大纲，作为批次3重建的统一契约**」
- SEQUENCE：「本细则**更新并替代**原有3.0/3.1类分散施工内容…若旧文档与本细则冲突，施工对象**以本细则为准**」
- UNIFIED：「本文**取代**两套 3.0.x 编号作为施工依据」

**后果**：施工者按任意一份实施，在 API/profile 层面会与另两份冲突（见 M2–M7）。

**建议修法**：在 CONTRACT 顶部加「效力层级」表，明确：**CONTRACT（架构契约）> SEQUENCE（施工步骤）> UNIFIED（代号与依赖测绘）**，并让另两份回指 CONTRACT。

### M2 🔴 同一代号 `B3-RC` 两套**范围完全不同**的 API

| 文档 | API | 覆盖范围 |
|---|---|---|
| CONTRACT §4.1 / SEQUENCE §3 | `readInjectionSourcesPre({paths,state,policyVersion})` | **全部注入源**：rules, events, plan, handoff, reflections, logs, proofs, warnings |
| UNIFIED §4 B3-RC | `readRulesAggregatePre({userFile,notesPath})` | **只读规则**：user, project, counts, errors |

**后果**：「B3-RC 做完没有」无法判定——两套 API 的交付物规模差一个数量级；且 UNIFIED 版的实现无法满足 SEQUENCE §3 的验收（要求 events/plan/handoff 来源证明）。

**建议修法**：二选一并全库统一。建议采用 CONTRACT/SEQUENCE 的 `readInjectionSourcesPre`（范围大且与 B3-EV 的 consolidate 需求可合并），把 UNIFIED 的规则聚合降级为其**内部子步骤**，并把 UNIFIED §4 B3-RC 的验收改写为对 `readInjectionSourcesPre().rules` 的断言。

### M3 🔴 profile 定义三方**零字段重合**

| 文档 | 字段 |
|---|---|
| CONTRACT §4 / SEQUENCE §2 | `policyVersion`、来源身份、档位、预算单位、表示版本、降级策略（6 项） |
| UNIFIED §3.2 | `schemaVersion`、`promptVersion`、`inputNormalizationVersion`、`candidatePoolPolicy`、`budgetPolicy`（5 项） |

**实测重合数：0**。两套 profile 不能同时是「冻结的公共契约」。

**建议修法**：以 SEQUENCE 的 `policyVersion` 为**单一版本号**，把 UNIFIED 的五项降为 `policyVersion` 的组成部分（如 `policyVersion = {prompt, normalization, pool, budget}` 的结构化展开），而不是五个平级字段。

### M4 🟠 `composeFinalEnvelopePre` 参数不一致（缺 `tier`）

```text
UNIFIED:  composeFinalEnvelopePre({candidates, budgetPolicy})            ← 无 tier
CONTRACT: composeFinalEnvelopePre({candidates, tier, budgetPolicy})
SEQUENCE: composeFinalEnvelopePre({candidates, tier, budgetPolicy})
```

**后果**：UNIFIED 版实现拿不到档位，无法执行「不同档位不同预算」；与 B3-RP/B3-EV 的档位联验会失败。
**建议**：全部补齐 `tier`。

### M5 🟠 `commitNotificationPre` 第二参数名不一致

```text
UNIFIED:  commitNotificationPre({requestId, receipt})
CONTRACT: commitNotificationPre({requestId, finalizeReceipt})
SEQUENCE: commitNotificationPre({requestId, finalizeReceipt})
```

**后果**：直接落码会拿不到 receipt（`undefined`），且是**静默**的（解构不报错）。
**建议**：统一为 `finalizeReceipt`（与 `finalizeInjectionPre` 的返回字段同名，可追溯）。

### M6 🟠 `finalizeInjectionPre` 返回形状不一致（UNIFIED 缺 `finalizeReceipt`）

```text
UNIFIED:  → {text, selectedNotificationIds}
CONTRACT: → {text, finalizeReceipt, selectedNotificationIds}
SEQUENCE: → {text, finalizeReceipt, selectedNotificationIds}
```

**后果**：UNIFIED 版没有产出 commit 的输入 ⇒ **B3-NT 链条断开**（prepare → finalize → commit 无法串起来）。这是三处参数不一致里**最严重**的一处，因为它是**链路断点**而非单点错名。

### M7 🟠 `projectInjectionPre` 只在 CONTRACT 有，另两份**完全没有 Projection/Policy 层**

**实测**：`projectInjectionPre` 在 CONTRACT §4.2 定义（`{sources,tier,frame,config} → {candidates,notifications,policyVersion}`），SEQUENCE 与 UNIFIED **均 0 命中**。

**后果**：CONTRACT 把「档位/视角/特殊档策略只在此层决定」定为架构原则，但另两份没有这一层 ⇒ 策略仍会散落在 B3-RP / B3-BD / B3-EV 各处，**重建目标里的「拆成职责明确模块」在另两份施工文件中没有落实**。
**建议**：SEQUENCE 增一节 B3-PJ（或明确 Projection 并入 B3-RP）；UNIFIED 的代号表补 `B3-PJ`。

### M8 🟠 UNIFIED 的「待 Lead 拍板」已被 CONTRACT **明确裁定**

| 文档 | 关于 `parseWaterPctThresholdsPre` 的表述 |
|---|---|
| CONTRACT §4.1 | 「…进入明确内部模块；**通过真实回调验证最终行为**，只有确实需要外部调用才纳入公共 facade」 |
| UNIFIED §3.3 / §4 B3-CB | 「**必须二选一，且必须由 Lead/用户拍板**…实现者不得默默二选一」 |

**事实核对**：`parseWaterPctThresholdsPre` 是 `lib/index.js:2153` 内部 `const`；导出表 **24 项不含它**（task-32 真 import 探针确认 `typeof` 为 false）。

**判定**：CONTRACT 已选择**「间接验证、不加导出」**。⇒ UNIFIED 该处**已过时**，仍在让施工者等一个已作出的裁定。
**建议**：UNIFIED §3.3 改为「已由 CONTRACT §4.1 裁定：走真实回调间接验证，不新增导出（导出数保持 24）」；§4 B3-CB 的前置行同步删除。

### M9 🟠 旧事实误用：`lib/inject-tier.js` **不存在**

> ⚠ 本节出现的 `lib/inject-tier.js` 是**被证伪的引用对象**（进度报告声称其存在），**不是可执行路径**；引用校验器不应把它当作缺失文件。

| 出处 | 原文 | 实测 |
|---|---|---|
| 进度报告 §4「已存在的正确模块化方向」 | 「`lib/inject-tier.js` 等档位/节奏既有模块」**可以复用，不需重做** | `lib/inject-tier.js` **文件不存在**（`lib/` 下无此文件） |

**旁证**：`lib/index.js:1837` 注释提到「下面这 13 个声明（INJECT_TIERS / decideInjectTierPre / …）」——这些符号在 `index.js` **内部**，不是独立模块。
**后果**：若施工者按「复用 inject-tier.js」去找，会找不到入口；实际档位逻辑内联在 `lib/index.js`。
**建议**：进度报告该行改为「档位/节奏逻辑当前**内联在 `lib/index.js`**（INJECT_TIERS / decideInjectTierPre 等），本批若模块化需新建 `lib/inject-tier.js`」；SEQUENCE §10.2 的复用边界同步注明。

### M10 🟡 SEQUENCE 的 B3-BD **无独立 API**

| 文档 | B3-BD 交付物 |
|---|---|
| UNIFIED §4 | `projectHandoffPre({planText,latestHandoffText,tier,policy}) → {planPart,ledgerPart,sourceIdentity,degradations}` |
| SEQUENCE §5.2 | 只有过程描述（去 2000 预截断、按节选择、保尾部），**无 API 签名** |

**后果**：B3-BD 无法与 B3-FM 做接口联验（FM 需要 `ProjectionCandidate[]`，而 SEQUENCE 版没有产出形状）。
**建议**：SEQUENCE §5.2 补 API 签名，与 UNIFIED 对齐。

### M11 🟡 2.6 / 2.7 / 2.8 跨批关系只被 UNIFIED 覆盖

| 项 | CONTRACT | SEQUENCE | UNIFIED |
|---|---|---|---|
| 2.6 | ✗ | ✗ | ✓ |
| 2.7 | ✗ | ✗ | ✓ |
| 2.8 | ✗ | ✗ | ✓ |

而 SEQUENCE §12「施工包必须产出的内容」与 §13「停止条件」都要求施工者知道与前批的边界。2.7 的摘要/指针是 **B3-NT 的数据来源**（进度报告 §0 已注明），SEQUENCE 未写这一接口关系。
**建议**：SEQUENCE 第 10.1 节证据包补一句「2.6/2.7/2.8 的写入口与摘要指针不属本批修改范围，B3-NT 只消费其产物」。

### M12 🟡 Prototype/Sidecar 关系只被 SEQUENCE 覆盖

| 项 | CONTRACT | SEQUENCE | UNIFIED |
|---|---|---|---|
| Prototype / SidecarStore | ✗ | ✓（§10.2） | ✗ |

CONTRACT §3「非目标」没有提到 SidecarStore 的边界（只写了不改 2.4/不训练/不改前端）。而 SEQUENCE §10.2 明确「Prototype 只负责派生索引持久化，不负责归属、档位或预算」。
**建议**：CONTRACT §3 非目标补一条「不改 SidecarStore / R4 文档存储边界」。

### M13 🟡 「已裁定」清单未标注**代码尚未实现**（旧事实误用风险）

CONTRACT §6「已裁定，直接作为施工约束」列了 6 条。本轮对代码逐条核实：

| 已裁定约束 | 代码现状（实测） | 是否一致 |
|---|---|---|
| 摘要档规则只投一行指针 | 精简版已不投规则段，但 `ruleSummaryPre` 仍 `max=200` | ⚠ 部分 |
| human_full 给完整正文、不逐条 200 | **`rules-layer.js:446 ruleSummaryPre(text, max = 200)` 仍在** | ❌ **未实现** |
| **50% 水位默认关闭** | **`DEFAULT_CONFIG.fullInjectWaterPct = '25,50'`**（25 与 50 都开） | ❌ **未实现** |
| 总量上限必须生效、不新增预算键 | `injectBudgetChars: 8000` 存在，但 `composeFinalEnvelopePre` 未实现 | ❌ 未实现 |
| legacy 少给；snapshotSlimMaintain 只在 human_slim | 未逐条实测（本轮未覆盖） | ? 未验 |
| handoff_carry/hang_compensate 保留 | 沿用既有，未改 | ✓ 一致 |

**问题**：CONTRACT 用「已裁定」表述是对的（这是**约束**不是**现状**），但**没有一句声明「以下多条当前代码尚未符合」**。施工者若把「已裁定」读成「已实现」，会漏做 50% 水位与 200 截断两项（这两项恰是最核心的规则项）。

**建议**：CONTRACT §6 表加一列「代码现状」，逐条标注 `已实现 / 未实现 / 未验`。本报告 §3 已给出可直接引用的实测值。

---

## 3. 可接受项（A1–A7）

| # | 项 | 核对依据 |
|---|---|---|
| **A1** | **新语义代号三方一致** | CONTRACT / SEQUENCE / UNIFIED **均使用** B3-RC/RP/FM/NT/BD/CB/EV，且均声明「旧 3.0.x 仅作溯源」。编号解耦结论未被推翻。 |
| **A2** | **4 个 DTO 三方字段完全一致** | SourceProof / ProjectionCandidate / PreparedNotification / DeliveryReceipt 在三份文档中**均出现且字段名一致**（DeliveryReceipt 六字段 `requestId/finalizedText/selectedNotificationIds/committed/skipped/errors` 三处逐字相同）。 |
| **A3** | 2.3 / 2.4 / 2.9 / 5.1 三方均覆盖 | 三份文档都写明 2.4 冻结、2.3 proposal-only、5.1 最后。 |
| **A4** | `global-brief.js` 复用建议成立 | 实测 `lib/global-brief.js` **11999B 存在**，`diffBriefPre` / `buildDraftPre` / `renderBriefPre` **各 1 处**，SEQUENCE §10.2 的复用边界可执行。 |
| **A5** | SEQUENCE §15.6「已修/未修」区分与实测一致 | 3.2 四段消费主体已存在（`event-render.js:331 CHECKPOINT_QUAD_KEYS`）✓；3.3 单向截断仍在（`:333 cutPre(rawText, CHECKPOINT_ITEM)`，`:75 CHECKPOINT_ITEM=300`）✓；3.1 目标 API 缺（`collectConsolidationSourcesPre` **0 命中**）✓。**这三条与文档描述完全吻合**。 |
| **A6** | CONTRACT §3 非目标清晰且可执行 | 不改 2.4 / 不训练模型 / 不改前端 / 不用静态命中或空输出冒充验收 —— 四条均可机械判定。 |
| **A7** | SEQUENCE §13「停止条件」可执行 | 6 条停止条件（改未授权真源 / 新增未列入契约的导出·工具·路由·配置键 / 文档与代码语义冲突 / 测试无法证明真调用 / 改动 2.4·2.3·5.1·前端边界 / 共享文件非本任务改动无法归因）**均可观测**，且与项目既有纪律一致。 |

---

## 4. 12 个目标 API 的当前实现状态（供施工者定位，防旧事实误用）

本轮对三份文档提到的全部目标 API 做当前源码命中：

| API | 出现文档 | 当前命中 |
|---|---|---|
| `readInjectionSourcesPre` | C+S | **0 处（未实现）** |
| `readRulesAggregatePre` | U | **0 处（未实现）** |
| `collectConsolidationSourcesPre` | U(B3-EV-1) | **0 处（未实现）** |
| `projectInjectionPre` | C | **0 处（未实现）** |
| `projectHandoffPre` | U | **0 处（未实现）** |
| `renderRulesForTierPre` | S+U | **0 处（未实现）** |
| `composeFinalEnvelopePre` | C+S+U | **0 处（未实现）** |
| `prepareNotificationPre` | C+S+U | **0 处（未实现）** |
| `finalizeInjectionPre` | C+S+U | **0 处（未实现）** |
| `commitNotificationPre` | C+S+U | **0 处（未实现）** |
| `renderCheckpointPreviewPre` | U | **0 处（未实现）** |
| `selectEventProjectionPre` | U | **0 处（未实现）** |

**结论**：B3 的全部目标 API **一个都没有落地**，不存在「已完成」误判风险；但也意味着**任何 PASS 都不能外推到这些 API 已可用**。

---

## 5. 模块 / API 边界核对

### 5.1 真实存在的可复用模块（SEQUENCE §10.2 逐条核实）

| 文档所指 | 实测 | 判定 |
|---|---|---|
| `rules-layer.js` | **44899B 存在** | ✓ |
| `event-render.js` | **30769B 存在** | ✓ |
| `event-write.js` | **57349B 存在** | ✓ |
| `event-pointer.js` | **8877B 存在** | ✓ |
| `plan-derived.js` | **15095B 存在** | ✓ |
| `global-brief.js` | **11999B 存在**，三函数各 1 处 | ✓ |
| `memory-envelope.js` | **14987B 存在** | ✓ |
| `plan-render.js` | **10687B 存在** | ✓ |
| `wb-sidecar.js` | **70315B 存在** | ✓ |
| **`inject-tier.js`** | **文件不存在**（档位逻辑内联于 `lib/index.js`） | ❌ **见 M9** |

**9/10 真实存在**，唯一误用是 `inject-tier.js`。

### 5.2 纯函数 vs facade 边界

CONTRACT §4.1 的原则「纯函数进内部模块、只有确实需要外部调用才纳入公共 facade」**与项目既有纪律一致**（本项目此前已因「为测试方便加导出」付出过重钉计数锁的代价）。
**判定：可接受**（A 类），本条不构成修订项；但它与 UNIFIED §3.3 的冲突已由 M8 覆盖。

---

## 6. 与 prototype / 2.3 / 2.5–2.9 的关系核对

| 关系 | 文档覆盖 | 实测一致性 |
|---|---|---|
| **Prototype / SidecarStore** | 仅 SEQUENCE §10.2 | SEQUENCE 的表述（只负责派生索引持久化、不负责归属/档位/预算）与项目既有结论一致 ✓；但另两份缺（M12） |
| **2.3 归属建议** | 三份均覆盖 | 三份都写「2.3 proposal-only、B3 不自动 attach/merge/archive」，与 task-31 复核结论（2.3 无功能性冲突、只读）一致 ✓ |
| **2.4 冻结** | 三份均覆盖 | 实测 `applyRegroupPre` **0 调用**，冻结成立 ✓ |
| **2.5 白板重绘** | 三份均覆盖 | 三份都写「2.5 生成/更新、B3 只选择与投递」，边界清晰 ✓；实测 `planAutoRedrawEnabled: false`（默认关闭）✓ |
| **2.6/2.7/2.8** | **仅 UNIFIED** | 见 M11 |
| **2.9 来源证明** | 三份均覆盖 | 实测 `appendHandoffCheckpointPre` 存在、`sourceProof/buildProof` 9 处 ✓ |
| **4.1 / 4.5** | CONTRACT + UNIFIED | 二份都写「4.1 负责来源、B3 负责帧/档位」「4.5 定内容身份、B3-FM 定预算」✓；SEQUENCE 缺（非阻塞） |
| **5.1 铭文** | 三份均覆盖 | 三份都写「最后实施、B3 只落实维护块投递位置」✓ |

---

## 7. 不可执行验收清单

| # | 验收要求 | 不可执行原因 | 处置 |
|---|---|---|---|
| 1 | 「真调 `parseWaterPctThresholdsPre` 断言返回值」 | 该函数**未导出**（`index.js:2153` 内部 `const`；导出表 24 项不含它） | **CONTRACT 已裁定走间接验证**；UNIFIED 需按 M8 更新 |
| 2 | UNIFIED B3-RC 要求「两层完整正文可取回」 | 其 API `readRulesAggregatePre` 尚未实现，且与 SEQUENCE 的 `readInjectionSourcesPre` 不是同一个东西 | 见 M2，先统一 API 再写验收 |
| 3 | UNIFIED B3-BD 要求「与 3.0-B 联验」 | 3.0-B **八项边界全部未定**（本轮确认未变） | 非缺陷，但验收须标「待边界明示」；已在大纲 §6 标注 |

其余验收项（含 SEQUENCE §15.2–15.4 的硬不变式、§15.3 的 8 条通知反例）**经核对均为可执行**：它们依赖的都是既有可观测行为（`briefDetectSyncPre` 调用点、`planUpdatePending` 清零点、文件字节、PASS/FAIL），不依赖新导出。

---

## 8. 旧事实误用清单（汇总）

| # | 声称 | 实测 | 出处 |
|---|---|---|---|
| 1 | `lib/inject-tier.js` 是既有可复用模块 | **文件不存在** | 进度报告 §4 |
| 2 | B3-CB 需等 Lead 拍板「加导出 vs 间接验证」 | **CONTRACT 已裁定间接验证** | UNIFIED §3.3/§4 |
| 3 | CONTRACT §6「已裁定」隐含已实现 | **50% 水位仍 `'25,50'`；`ruleSummaryPre` 仍 `max=200`** | CONTRACT §6 |

第 3 条不是文档格式错误，而是**最危险的误用**：它是「已裁定」与「已实现」两个语义被混读，恰好落在本批最核心的两个规则项上。

---

## 9. 修订优先级建议

| 档 | 项 | 理由 |
|---|---|---|
| **P0（施工前必改）** | M1、M2、M3、M6 | 前三条会导致施工者按错的对象/契约施工；M6 是链路断点 |
| **P1（B3-CB 开工前）** | M8、M9、M13 | M8 让施工者空等；M9 让人找不存在的模块；M13 会让最核心两项漏做 |
| **P2（B3-NT/BD 开工前）** | M4、M5、M7、M10 | 参数/层级不一致，落码即错 |
| **P3（可随后）** | M11、M12 | 跨批覆盖缺口，不影响当前单位开工 |

---

## 10. 本轮边界与未验项

1. **未改任何文档与代码**：本轮只读，`docs/`、`lib/`、`tests/`、前端**零改动**（本报告是唯一新增文件）。
2. **未运行任何测试**：全部结论来自源码命中、文档原文比对与真 import 探针（探针脚本已删）。
3. **未做真实 HOST**、未启隔离 `DSH_HOME`、未访问 19387。
4. **未逐条核对**以下文档（本轮按相关性排除）：`INJECT-TIER-DEFECTS-20261028.md`、`AUDIT-PROMPT-INJECT-REFACTOR-20261108.md`、`MASTER-PLAN-3.0.md`、`DESIGN-20261006-INJECTION-ASYMMETRY-FIX.md`、`DOUBLE-CHECK-INJECT-TIERS-20261103.md` 等 15 份历史调查文档。**若 Lead 认为其中仍有施工效力，需另派核对**。
5. **未验证** `legacy 少给` / `snapshotSlimMaintain 只在 human_slim` 两条「已裁定」的代码现状（M13 表标 `?`）。
6. 不 push / 不发版 / 不迁移 / 不删除。

---

## 11. 一句话结论

**三份新文档在「用语义代号取代旧编号」上已达成一致（A1），4 个 DTO 也完全一致（A2）；但它们在效力层级、`B3-RC` 的 API 范围、profile 字段三者上互斥，且 UNIFIED 已过时于 CONTRACT 的一处裁定、进度报告引用了一个不存在的模块。**
**=> 必须先修 M1–M3、M6 再开工，否则 B3-CB 之后的每一步都会在互斥指令中做选择。**
