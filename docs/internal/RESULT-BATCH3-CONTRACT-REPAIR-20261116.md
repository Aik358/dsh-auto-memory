# 批次3 文档契约修订报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-34）
> 工作区 `D:/dsh-auto-memory`｜分支 `preview`｜开工 HEAD **`9dc6e3fe`**
> 依据：`REVIEW-BATCH3-DOCUMENTS-20261116.md`（task-33 核对报告，13 项必须修订 / 7 项可接受）
> **性质：只改文档。未改生产代码、未启动 HOST、未改前端、未 push/发版。**
> 后续范围说明：本报告仅闭合task-33十份文档的M1–M13，不代表批次3全量内容审核完成。2026-11-17 Lead扩大至42份文档后发现SR/RC职责、CA节奏层、CO consolidate、事件指针与宿主交付仍需订正，见 `REVIEW-BATCH3-LEAD-FULL-AUDIT-20261117.md`。

---

## 0. 结论

**13 项必须修订（M1–M13）全部闭合，逐项复验通过。**

| 类别 | 数量 | 状态 |
|---|---|---|
| M1–M13 必须修订 | 13 | **全部已修** |
| A1–A7 可接受项 | 7 | 核对后**保持不动**（已确认正确） |
| 改动文件 | **4 份** | L1/L2/L3 三份批次3文档 + 施工总表 |

---

## 1. 改动文件与指纹

| 文件 | 层级 | 改前 | 改后 | Δ | sha16 |
|---|---|---|---|---|---|
| `DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md` | L1 架构契约 | 7425B | **10818B** | **+3393** | `23B6076237A48D26` |
| `DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md` | L2 施工细则 | 15843B | **19135B** | **+3292** | `CDA6A5813F4231A1` |
| `DETAIL-BATCH3-UNIFIED-20261116.md` | L3 测绘大纲 | 21708B | **24843B** | **+3135** | `E87FF65906934E7C` |
| `CONSTRUCTION-PLAN-20261108.md` | 施工总表 | 113359B | **114515B** | **+1156** | `FE885DC98FC1453A` |

**全部为纯 LF（CRLF=0，无混用）**；四份均为 Markdown，沿用 `docs/internal/` 既有行尾格式。

---

## 2. 逐项修订记录（M1–M13）

### M1 🔴 统一权威层级

**修法**：在 L1 契约顶部新增「效力层级」表，L2/L3 与施工总表各自回指。

| 层级 | 文件 | 管什么 | 不得越界 |
|---|---|---|---|
| **L1 架构契约** | CONTRACT | 模块划分、**公共 API 签名**、DTO/profile、已裁定约束、非目标 | 不写施工步骤与验收清单 |
| **L2 施工细则** | SEQUENCE | 施工顺序、每单位实施/验收/回滚、停止条件 | **API/DTO 必须逐字引用 L1**，不得自创 |
| **L3 测绘大纲** | UNIFIED | 代号溯源、依赖图、现状实测、3.0-B 未决边界 | **API/profile 一律以 L1 为准** |

**裁决规则**：①API/profile/DTO 冲突 ⇒ **L1 为准**；②施工顺序冲突 ⇒ L2 为准；③现状事实冲突 ⇒ **以当前代码实测为准**。

**复验**：C/S/U/施工总表 四份**均含 L1/L2/L3 三级名与「效力层级」表** ✅

### M2 🔴 统一 B3-RC 范围与 API

| 文档 | 修前 | 修后 |
|---|---|---|
| L1 / L2 | `readInjectionSourcesPre` | **不变**（L1 为准） |
| L3 | `readRulesAggregatePre({userFile,notesPath})`（只读规则） | **改为** `readInjectionSourcesPre({paths,state,policyVersion})`；旧 API 标注「**已被取代**，降为 `.rules` 的内部实现细节」 |

**新增范围澄清**（L2 §3）：「B3-RC 的范围是**全部注入源**，不是只读规则；规则聚合是其内部子步骤，**不是独立代号**」。

**复验**：三份均以 `readInjectionSourcesPre` 为 B3-RC 公共 API ✅

### M3 🔴 统一 profile

**修前**：L1/L2 用 `policyVersion` + 五要素；L3 用五个平级字段 —— **零重合**。

**修后（L3 §3.2 重写）**：统一为 L1 口径的 6 字段（`policyVersion` 为**单一版本号** + 来源身份/档位/预算单位/表示版本/降级策略）；早期五字段**降为 `policyVersion` 的组成**，不再作平级公共字段。

**复验**：L3 主表字段为 `policyVersion`；旧五字段仅出现在「早期草案」说明句中 ✅

### M4 🟠 FM 补 `tier`

`text
修前 L3: composeFinalEnvelopePre({candidates, budgetPolicy})
修后三份: composeFinalEnvelopePre({candidates, tier, budgetPolicy})
`

**复验**：L1/L2/L3 三处签名均含 `tier` ✅

### M5 + M6 🟠🔴 `finalizeReceipt` 与 commit 参数

**M6 是链路断点**（最严重）：L3 的 `finalizeInjectionPre` 原返回 `{text, selectedNotificationIds}`，**缺 `finalizeReceipt`** ⇒ commit 无输入。

`text
修前 L3 finalize: → {text, selectedNotificationIds}                    ← 断链
修前 L3 commit  : commitNotificationPre({requestId, receipt})            ← 参数名错
修后（三份统一）: → {text, finalizeReceipt, selectedNotificationIds}
修后（三份统一）: commitNotificationPre({requestId, finalizeReceipt})
`

**复验**：L1/L2/L3 三份 finalize 均出 `finalizeReceipt`、commit 均用 `finalizeReceipt` ✅

### M7 🟠 新增 B3-PJ（Projection / Policy）层

**修前**：`projectInjectionPre` 只在 L1 有，L2/**L3 完全没有这一层**。

**修后**：

- **L1**：§4.2 标题标注「代号 **B3-PJ**」；新增 **§4.6 代号总表**（8 行，含 B3-PJ）。
- **L2**：新增 **§2.5 B3-PJ** 完整施工节（目标/API/约束/验收/回滚）。
- **L3**：代号总表新增 B3-PJ 行；**依赖图与依赖边表**加入 `B3-RC → B3-PJ → B3-RP` 硬依赖。
- **施工总表**：施工顺序补 B3-PJ，并声明「B3-PJ 是独立代号，不是 B3-RP/BD 的子步骤」。

**复验**：**四份文档均含 B3-PJ** ✅

### M8 🟠 `parseWaterPctThresholdsPre` 现状（已裁定，不再待决）

**修前 L3**：「必须二选一，**且必须由 Lead/用户拍板**」。
**修后 L3 §3.3**：改为「**已由 L1 §4.1 裁定：走真实回调间接验证，不新增导出**（导出数保持 24，**无需重钉计数锁**）」，并明确「不得再等裁定」。L3 B3-CB 卡片同步改写。

**复验**：L3 §3.3 含「已由 L1 §4.1 裁定」；**「拍板/二选一」措辞已从该节删除** ✅

### M9 🟠 旧事实误用：`lib/inject-tier.js` 不存在

**L3 新增 §9.5「旧事实更正」**：

| 检查 | 结果 |
|---|---|
| `lib/inject-tier.js` 文件 | **不存在** |
| 档位逻辑实际位置 | **内联在 `lib/index.js`**（`:1837` 注释所列 13 个声明：`INJECT_TIERS`/`decideInjectTierPre`/`parseWaterPctThresholdsPre` 等） |

⇒ 结论：本批若做档位模块化，**是新建** `lib/inject-tier.js`，**不是复用**。

**复验**：L3 含「不存在」更正节 ✅

### M10 🟡 补 L2 的 B3-BD API

**L2 §5.2 补**：`projectHandoffPre({planText,latestHandoffText,tier,policy}) → {planPart,ledgerPart,sourceIdentity,degradations}`（逐字引用 L1 §4.5），并补**验收**与**接口联验**（产出须能作为 `composeFinalEnvelopePre` 的 `candidates`，形状对齐 `ProjectionCandidate`）。

**复验**：L2 与 L3 均含 `projectHandoffPre` ✅

### M11 🟡 补 2.6–2.9 边界（L2 原缺失）

**L2 新增 §10.2b**：四行表格，逐条写明「本批不修改、只消费其产物」。

| 第二批项 | 本批关系 | 不得做 |
|---|---|---|
| 2.6 写入口归属 | B3-NT 消费其归属结果；Phase 0 `assertWritableEventTargetPre` 不改 | 不改写入口、不搬 `#543` 话题门 |
| 2.7 摘要+指针 | **B3-NT 的数据来源**；三口径不改 | 不改指纹口径、不回退整篇快照 |
| 2.8 失败标记 | 不改其 Phase 0 前置拦截与留痕 | 不改 `idemKey`、不改失败留痕协议 |
| 2.9 四段+覆盖证明 | B3-BD 复用其 sourceRef 与指纹 | 不改四段语义、不改 `appendHandoffCheckpointPre` |

并附实测佐证：`appendEventNotePre` 在生产代码 **0 处**（仅 5 个 docs 提及）⇒ **不得当作已存在的基础设施**。

**复验**：L2 含 §10.2b ✅

### M12 🟡 补 Prototype / Sidecar 边界（L1 原缺失）

**L1 §3 非目标补三条**：

- 不改 SidecarStore / R4 文档存储边界：Prototype 只负责派生索引持久化，不负责归属、档位或预算，不写 Markdown 正文；
- 不改 2.6/2.7/2.8 的写入口；
- 不改 2.9 的来源证明语义。

**复验**：L1 非目标含 `SidecarStore` ✅

### M13 🟡 「已裁定」未标代码现状（最危险：会导致核心两项漏做）

**L1 §6 重写**：原标题「已裁定，直接作为施工约束」→ **「已裁定 ≠ 已实现（必读）」**，并为 7 条约束各加「代码现状（实测）」列：

| # | 已裁定约束 | 代码现状（实测） | 判定 |
|---|---|---|---|
| 1 | 摘要档只投一行指针 | 精简版已不投规则段；但 `ruleSummaryPre` 仍 `max=200` | ⚠ 部分 |
| 2 | human_full 给完整正文、不逐条200 | **`rules-layer.js:446 ruleSummaryPre(text, max = 200)` 仍在** | ❌ **未实现** |
| 3 | **50%水位默认关闭** | **`DEFAULT_CONFIG.fullInjectWaterPct = '25,50'`** | ❌ **未实现** |
| 4 | 总量上限生效、不新增预算键 | `injectBudgetChars: 8000` 存在；`composeFinalEnvelopePre` 未实现 | ❌ 未实现 |
| 5 | legacy少给；snapshotSlimMaintain | 本轮未逐条实测 | ? **未验** |
| 6 | handoff_carry/hang_compensate 保留 | 沿用既有未改 | ✓ 一致 |
| 7 | 2.4冻结；5.1最后 | `applyRegroupPre` **0 调用**；5.1 未动 | ✓ 一致 |

**施工总表**同步加警示：「已裁定 ≠ 已实现：截至 2026-11-16，50% 水位仍 `'25,50'`、`ruleSummaryPre` 仍 `max=200`」。

**复验**：L1 含「代码现状（实测）」列与 `❌ **未实现**` 标记 ✅

---

## 3. 未改动的可接受项（A1–A7）

核对报告判定为可接受的 7 项，**本轮一律不动**：

| # | 项 | 不动的原因 |
|---|---|---|
| A1 | 语义代号三方一致 | 编号解耦结论正确，无需改 |
| A2 | 4 个 DTO 三方字段逐字一致 | 已一致，无需改 |
| A3 | 2.3/2.4/2.9/5.1 三方覆盖 | 已覆盖 |
| A4 | `global-brief.js` 复用建议 | 实测文件存在（11999B），建议可执行 |
| A5 | SEQUENCE §15.6 已修/未修区分 | 与当前代码完全吻合，**保留原文** |
| A6 | CONTRACT §3 非目标可判定 | 保留，仅**追加**三条（M12） |
| A7 | SEQUENCE §13 停止条件 | 六条均可观测，保留原文 |

---

## 4. 一致性复验（修订后全量交叉校验）

| 项 | C | S | U | 施工总表 | 判定 |
|---|---|---|---|---|---|
| M1 效力层级 + L1/L2/L3 | ✅ | ✅ | ✅ | ✅ | **闭合** |
| M2 `readInjectionSourcesPre` | ✅ | ✅ | ✅ | — | **闭合** |
| M4 FM 含 `tier` | ✅ | ✅ | ✅ | — | **闭合** |
| M5/M6 `finalizeReceipt` | ✅ | ✅ | ✅ | — | **闭合** |
| M7 `B3-PJ` | ✅ | ✅ | ✅ | ✅ | **闭合** |
| M8 parseWater 已裁定 | ✅（原判） | — | ✅ | — | **闭合** |
| M9 inject-tier 更正 | — | — | ✅ | — | **闭合** |
| M10 `projectHandoffPre` | — | ✅ | ✅ | — | **闭合** |
| M11 2.6–2.9 边界 | — | ✅ | — | — | **闭合** |
| M12 SidecarStore 边界 | ✅ | — | — | — | **闭合** |
| M13 代码现状列 | ✅ | — | — | ✅（警示） | **闭合** |

**行尾**：四份 **CRLF=0，无混用**。

---

## 5. 本轮边界与未验项

1. **只改文档**：`lib/`、`tests/`、`lib/client.js`、皮肤、生成器**零改动**。
2. **未运行任何测试**：本报告不发 PASS/FAIL 断言；文中「实测」均指 **task-30/31/33 的只读测绘结论**（本轮未重跑代码）。
3. **未做真实 HOST**、未启隔离 `DSH_HOME`、未访问 19387、未改真实记忆。
4. **未验证** M13 表中标 `?` 的一条（`legacy 少给` / `snapshotSlimMaintain` 的代码现状）——仍为未验。
5. **未核对** 15 份历史调查文档（`INJECT-TIER-DEFECTS-*`、`AUDIT-*`、`MASTER-PLAN-3.0` 等），与 task-33 边界一致。
6. 不 push / 不发版 / 不迁移 / 不删除。

---

## 6. 修订前后对比（一句话）

**修订前**：三份文档互不引用且各自宣称权威，`B3-RC` 有两套规模差一个数量级的 API，profile 零字段重合，`finalizeInjectionPre` 断链，且「已裁定」被误读为「已实现」——施工者会在互斥指令中做选择，并把最核心的两项（50% 水位、逐条 200）漏做。

**修订后**：**L1/L2/L3 效力层级明确且四份回指一致**；公共 API 三方逐字统一（含新增 `B3-PJ` 与 `finalizeReceipt` 链路）；profile 收为 `policyVersion` 单版本号；`parseWater` 从「待拍板」变为「已裁定不新增导出」；`inject-tier.js` 误引用已更正为「需新建」；**「已裁定」表新增代码现状列并明标两项未实现**。
