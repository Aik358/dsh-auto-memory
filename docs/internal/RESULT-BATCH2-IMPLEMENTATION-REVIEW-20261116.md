# 第二批实现与隔离验收复核（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-31）
> 工作区 `D:/dsh-auto-memory`｜分支 `preview`｜开工 HEAD **`e181fa0a`**
> 依据：`PROMPT-BATCH2-REVIEW-AND-BATCH3-DECOUPLING-20261116.md` §二
> **性质：只读复核。不改生产代码、不改前端、不碰 2.4 归并、不 push/发版/迁移/删除。**

---

## 0. 结论速览

| 判定 | 内容 |
|---|---|
| 2.x 隔离套件 | **12 个套件全部真跑，335 PASS / 0 FAIL**（本轮实测，非转记） |
| **新发现的假绿** | **2 处**，在 `smoke-test-batch2-2.9-wiring.mjs`（L103、L179 含 `|| true`），**经变异确证恒真** |
| 实现状态 | 2.1/2.2/2.3/2.5/2.6/2.7/2.8/2.9 生产代码均真实存在且可达；**2.4 保持冻结**（`applyRegroupPre` 调用 **0 处**） |
| 与 2.3 冲突 | **无功能性冲突**；但存在**同名不同实现**的证据偏差（见 §4） |
| 生产默认 | 2.5 `planAutoRedrawEnabled: false`；R4 `ledgerDocEnabled` 默认 **false** |
| 最大未验 | **真实 HOST / 真实记忆 / 全量回归全部未做**；本报告不外推为生产通过 |

---

## 1. 取证指纹（本轮实测）

| 文件 | 字节 | 行 | sha16 |
|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` |
| `lib/event-write.js` | 57349 | 984 | `839F5116189387AB` |
| `lib/event-render.js` | 30769 | 524 | `221D12C898D32B5D` |
| `lib/event-attribution/index.js` | 6528 | 187 | `125D4599647E0302` |
| `lib/rules-layer.js` | 44899 | 740 | `CF946F54D7D2643F` |
| `tests/smoke/smoke-test-batch2-2.9-wiring.mjs` | 26905 | 433 | `4F6E33E140C16588` |
| `tests/smoke/smoke-test-batch2-2.6-note-integration.mjs` | 8704 | 111 | `E9EFFE1A56A8439D` |
| `tests/smoke/smoke-test-batch2-2.7-pointer.mjs` | 21137 | 312 | `2F04ADB4DA5E3FFE` |

---

## 2. 逐项复核（2.1–2.9）

### 2.1 创建事件时填 goal 首段 — ✅ 实现存在 / 隔离通过

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `createEventForWorkPre` 在 `lib/event-write.js` **10 处**；`sections.goal` 落地于 `:733`（`name: (sections.goal \|\| '交接账本')`） |
| 隔离验收 | 无独立 2.1 套件；由 `2.6-note-integration`（22 PASS）与 `2.7-*` 间接覆盖 |
| 恒真检查 | 相关套件扫描 **可疑 0** |
| 未验 | 真实写入 3 次断言 3 个 goal 非空 —— 本轮**未做真实事件库写入**，只在隔离套件中覆盖 |

### 2.2 kind 推断 — ✅ 实现存在 / 间接覆盖

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `inferKindPre` 存在（全仓命中） |
| 隔离验收 | 无独立 2.2 套件；由下游套件间接覆盖 |
| 未验 | 三条判据（members→ledger / outcome+起止→project / 不足→unknown）**本轮未逐条真调断言** |

### 2.3 归属建议与异常提醒 — ✅ 已交付 / 隔离最强

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `lib/event-attribution/` **9 文件**；`createEventAttributionServicePre` 在 `lib/index.js` **9 处**；`proposeRegroupPre` **3 处** |
| 隔离验收 | 三个专项套件本轮复跑：**67 / 29 / 37 PASS，0 FAIL** |
| 恒真检查 | 三套件均可疑 **0** |
| 未验 | 真实 HOST 模型调用、真实会话噪声体验、全量回归 |

### 2.4 存量碎片归并 — 🔴 **保持冻结（本轮未触碰）**

| 维度 | 本次实测 |
|---|---|
| `applyRegroupPre` 调用 | **0 处**（`git grep` 级确认为 0） |
| 结论 | **冻结状态成立**；本轮未执行任何归并、未迁移、未删除 |

### 2.5 白板随事件自动重绘 — ✅ 实现存在 / 默认关闭 / 隔离通过

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `fromEvents` **24 处**、`writePlanSnapshot` **14 处** |
| 生产默认 | `planAutoRedrawEnabled: false` —— **默认关闭已确认** |
| 隔离验收 | 三个套件：**13 + 18 + 9 = 40 PASS / 0 FAIL**；变异 **3/2 CAUGHT、0 MISSED** |
| 未验 | 生产启用未验（默认关闭，符合既定边界） |

### 2.6 写入口归属统一 — ⚠ **实现存在但入口与文档记载不同**

| 维度 | 本次实测 |
|---|---|
| `resolveActiveEventPre` | 在 `event-write.js` **7 处**、`lib/index.js` **3 处** |
| **`memory_note` 内** | **`resolveActiveEventPre` 0 处**，实际走 **Phase 0 `assertWritableEventTargetPre`**（`:328`，只判显式 eventId 是否可写） |
| 隔离验收 | `2.6-attribution` 7 PASS、`2.6-note-integration` **22 PASS**，均 0 FAIL；变异 2/0 与 phase1-eventId-removed CAUGHT |
| **与文档的偏差** | 施工细则/项目记忆记为「Phase 1 WAL 走 `resolveActiveEventPre`，按 `updatedAt` 取最大」，**当前实现并非如此**：`memory_note` 对「未传 eventId」不自动归属，只校验显式 id。⇒ 这是**更强的保守姿态**（不猜），但**与文档描述不一致**，须在后续任务中对齐记载 |

### 2.7 整篇正文不进检查点（摘要+指针） — ✅ 实现存在 / 隔离通过

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `MaterialStamp` 相关 **4 处**；三口径分离（真源 raw / 指针 normalize / 覆盖 normalize / 摘要自身） |
| 隔离验收 | `2.7-checkpoint` 30、`2.7-drilldown` 25、`2.7-pointer` 46 = **101 PASS / 0 FAIL**；变异 **4/3 CAUGHT、0 MISSED** |
| 未验 | 真实存量 200 条整篇快照的**真实迁移**未做（本批不迁移） |

### 2.8 失败标记不进事件 — ✅ 实现存在 / 隔离通过

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `idemKey` 在 `event-write.js` **16 处**；`memory_note` 内 **3 处** |
| 隔离验收 | `2.8-integration` 17、`2.8-preflight` 19 = **36 PASS / 0 FAIL**；变异 **3/0 CAUGHT** |

### 2.9 统一写入口显式四段校验 + 覆盖证明 — ✅ 实现存在 / 隔离通过（**但含 2 处假绿**）

| 维度 | 本次实测 |
|---|---|
| 代码可达 | `sourceProof/buildProof` **9 处**；`appendHandoffCheckpointPre` 4 处；`memory_note` 内 2 处 |
| 隔离验收 | `2.9-handoff-coverage` 39 PASS（变异 3/0）、`2.9-wiring` **90 PASS**，均 0 FAIL |
| **假绿** | 见 §3 —— `2.9-wiring` 有 **2 处恒真断言** |

---

## 3. ⚠ 新发现的假绿：`smoke-test-batch2-2.9-wiring.mjs` 两处恒真断言

这是本轮复核**最重要的发现**——与 task-30 测绘出的 p6a / h5 属**同一家族**（`|| true` 恒真、工厂/变量未真验）。

### 3.1 位置与形态

```js
// L103
ok(a.fingerprintScopes.sourceDocumentNormalizedSha256 !== a.fingerprintScopes.sourceCoverageNormalizedSha256 || true,
   'A24g 两个 normalized 口径都已单列')

// L165 / L174 / L179
let linkTested = false
// …try { … linkTested = true } catch { console.log('SKIP C4 …') }
ok(linkTested || true, 'C5 链接段已处置（真测或显式 SKIP）')
```

**两处都在断言末尾拼 `|| true`** ⇒ 无论左侧真假，`ok()` 恒收到 `true`。

### 3.2 隔离变异确证（不是靠读代码推断）

在 `.tmp-review/mut29/` 隔离副本中做两步变异：

| 变异 | 动作 | 结果 | 结论 |
|---|---|---|---|
| **M1** | 去掉 L179 的 `|| true`（改为 `ok(linkTested, …)`） | **仍 PASS** | 说明当前 `linkTested` 恰为 `true`（本平台能建 junction，C4 真跑了） |
| **M2** | 把断言直接换成 `ok((false) || true, …)` | **仍 PASS** | ⇒ **该断言恒真，永远无法失败** —— 假绿确证 |

**判定**：

- **L179 当前不是「假通过」**（M1 证明 C4 确实执行并置位了 `linkTested`），但**写法是恒真的**，一旦将来 C4 被 SKIP（非 Windows 平台 / symlink 权限不足），这条断言**不会报警**，会静默变成「链路段没测也绿」。
- **L103 同理**：两个 normalized 口径本应「都不相同」（不同口径），但 `|| true` 使其无法失败；真正的判据应是「两者**都已单列且非 undefined**」。

### 3.3 建议修法（本次不实施，属后续任务）

```js
// L103：改为真判据（存在 + 互不混用）
ok(typeof a.fingerprintScopes.sourceDocumentNormalizedSha256 === 'string' &&
   typeof a.fingerprintScopes.sourceCoverageNormalizedSha256 === 'string' &&
   a.fingerprintScopes.sourceDocumentNormalizedSha256 !== a.fingerprintScopes.sourceCoverageNormalizedSha256,
   'A24g 两个 normalized 口径都已单列且互不相同')

// L179：区分「真测」与「显式 SKIP」，SKIP 要显式可见而非静默绿
if (linkTested) ok(true, 'C5 链接段真测通过'
else console.log('SKIP C5 链接段（平台不支持 symlink）—— 本项未验证')
```

---

## 4. 与 2.3 的冲突面核查

### 4.1 功能性冲突：**无**

| 检查点 | 结果 |
|---|---|
| `memory_note` 是否同时被 2.3 与 2.6/2.8/2.9 改动 | **是**（`attributionReview` 5 处 / `idemKey` 3 处 / `appendHandoffCheckpointPre` 2 处），**但改动点不重叠** |
| 2.3 是否越权写入 | 否 —— `attributionReview` 走**写入前提前返回**，只读 |
| 2.3 是否破坏 2.7 摘要/指针 | 否 —— 2.7 三口径断言（A24b–A24e）全部 PASS |
| 2.3 是否破坏 2.9 来源证明 | 否 —— `2.9-handoff-coverage` 39 PASS、`2.9-wiring` 90 PASS |

### 4.2 记载偏差（**须在后续任务对齐，本报告不改代码**）

| 项 | 文档/项目记忆记载 | 当前代码实测 | 影响 |
|---|---|---|---|
| 2.6 写入口 | 「`memory_note` 的 Phase 1 WAL 走 `resolveActiveEventPre`，只按 `updatedAt` 取最大」 | `memory_note` 内 `resolveActiveEventPre` **0 处**；实际是 Phase 0 `assertWritableEventTargetPre`（`:328`），**未传 eventId 时不自动归属** | 实现**比记载更保守**（不猜），但记载会误导后续施工 |
| 2.6/2.7/2.8 共同解法 | 项目记忆记为「给写入口收 1 层 API（`appendEventNotePre`）」 | `appendEventNotePre` 全仓**仅 5 个 docs 命中，生产代码 0 处** | 该「统一入口」**从未落地**；现状是各走既有函数。不能据此宣称已收口 |

> 这两条按「矛盾记忆条目处置纪律」处理：**并存标注**，以代码事实为判据，后续任务决定是补实现还是改记载。

---

## 5. 隔离验收汇总（本轮真跑）

| 套件 | PASS | FAIL | 变异 |
|---|---|---|---|
| 2.5-derived-plan | 13 | 0 | 3/0 CAUGHT |
| 2.5-redraw-integration | 18 | 0 | — |
| 2.5-redraw-lock | 9 | 0 | 2/0 CAUGHT, RESTORED |
| 2.6-attribution | 7 | 0 | 2/0 CAUGHT, RESTORED |
| 2.6-note-integration | 22 | 0 | phase1-eventId-removed CAUGHT |
| 2.7-checkpoint | 30 | 0 | 4/0 CAUGHT |
| 2.7-drilldown | 25 | 0 | — |
| 2.7-pointer | 46 | 0 | 3/0 CAUGHT, RESTORED |
| 2.8-integration | 17 | 0 | — |
| 2.8-preflight | 19 | 0 | 3/0 CAUGHT |
| 2.9-handoff-coverage | 39 | 0 | 3/0 CAUGHT, CLEAN |
| 2.9-wiring | 90 | 0 | —（**含 2 处恒真**） |
| **合计** | **335** | **0** | 变异捕获合计 **20+** |

另：2.3 三专项套件本轮复跑 **67 / 29 / 37 = 133 PASS / 0 FAIL**。

**恒真扫描**：对 12 个套件做 4 类可疑形态扫描（`|| ''`、裸 `typeof===function`、`catch{return ''}`、`|| true`），**仅 2.9-wiring 命中 2 处**，其余 11 个套件均可疑 0。

---

## 6. 生产默认与真实 HOST 边界（**未被误写成已完成**）

| 项 | 实测 |
|---|---|
| 2.5 白板重绘 | `planAutoRedrawEnabled: false` —— **默认关闭** |
| R4 文档存储 | `ledgerDocEnabled` 存在 `true` 与 `false` 两种字面，**默认分支为 false**（`ledgerDocEnabled: false` / `=false` 各一处）；与既定「未完成 HOST 前不接管生产」一致 |
| 2.4 归并 | 冻结，`applyRegroupPre` 0 调用 |
| 真实 HOST | **未做**：未启隔离 `DSH_HOME`、未访问 19387、未改生产配置或真实记忆 |
| 全量回归 | **未跑**：本报告只跑 12 个 2.x 套件 + 3 个 2.3 专项；未跑 `--impact-run` 或全量 |

---

## 7. 建议（供 Lead 排期，本次不实施）

| # | 建议 | 优先级 |
|---|---|---|
| R1 | 修 `2.9-wiring` L103 / L179 两处 `\|\| true` 恒真断言（改法见 §3.3） | **高** —— 与 p6a/h5 同族，属「验收基础」欠账 |
| R2 | 对齐 2.6 的**记载与实现**：要么补 `resolveActiveEventPre` 自动归属，要么把文档改为「当前只校验显式 id、不自动归属」 | 中 —— 影响后续施工理解 |
| R3 | 明确 `appendEventNotePre` 是**补实现**还是**撤记载**（当前生产 0 处） | 中 |
| R4 | 2.1 / 2.2 补独立隔离套件（当前只被下游间接覆盖） | 低 |

---

## 8. 未验边界（如实）

1. **未改任何生产代码**：`lib/`、`lib/client.js`、皮肤、生成器**零改动**；本轮只读 + 隔离副本变异。
2. **未做真实 HOST**、未启隔离 `DSH_HOME`、未访问 19387、未改真实记忆。
3. **未跑全量回归 / `--impact-run`** —— 只跑 15 个相关套件（12 个 2.x + 3 个 2.3 专项）。
4. **2.1 / 2.2 无独立套件**，其验收为下游间接覆盖，不构成逐条断言。
5. **2.4 未验证任何归并行为**（按裁定冻结）。
6. **2.7 未做真实存量迁移**（200 条整篇快照仍在原处，本批不迁移）。
7. **变异验证在 `.tmp-review/` 隔离副本**内进行，未在共享工作区就地改生产文件。
8. 未 push / 未发版 / 未迁移 / 未删除。

---

## 9. 一句话结论

**第二批 2.1–2.9 的实现与隔离验收总体成立（335 PASS / 0 FAIL，20+ 变异捕获，2.4 确认冻结）**；
但 `2.9-wiring` 有 **2 处 `|| true` 恒真断言**（变异已确证），且 2.6 的实际入口与文档记载不一致、`appendEventNotePre` 生产 0 处 —— **这三条须在「验收基础修复」任务里一并收口，不能带进第三批施工**。
