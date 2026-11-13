# 批次 2 · 2.7 正文形态：检查点摘要与真实指针 —— 交付报告

> 日期：2026-11-13（Asia/Hong_Kong）｜执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-17）
> 基线：`preview` / `1cbc0ce7`｜**未 commit / 未 push / 未启用生产 / 未重启 19387**
> 依据：[PROMPT-BATCH2-2.7-2.9-WIRING-20261113.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-BATCH2-2.7-2.9-WIRING-20261113.md) §3.1 / §3.2 / §6

---

## 1. 结论

2.7 的**核心能力**（纯摘要 + 摘要路径落盘 + 真实 raw/normalized 指纹保留）已实现并**真实隔离验收通过**。
**生产接线未做** —— 旧 `memory_note` 仍写全文，摘要路径目前只有 task-18 的共享入口会调用（见 §6 未验边界）。

| 硬门（定稿 §6） | 结果 |
|---|---|
| 6.1 真 import → 真调用 → 真实隔离文件/事件库读回 | **PASS**（B 组 13 条全部真落盘真读回） |
| 6.2 `text.length ≤ 300`；四段来自真实原文；磁盘字节/raw SHA/指针 normalize SHA/bytes/sourceRef 逐项复算 | **PASS**（B1/B2/B4） |
| 6.3 用真实 `readEventCheckpointPre` 还原真实来源；缺指纹/漂移不误判 | **PASS**（B3/B12/B13） |
| 6.4 幂等：相同意图不重复追加；摘要之外内容改变仍产生新检查点 | **PASS**（B5/B6） |
| 6.7 至少三类隔离变异 | **4 类全 CAUGHT / 0 MISSED** |
| 6.8 不宣称生产 HOST / 全仓回归已完成 | 见 §6 |

**实测读数**：`SUMMARY PASS 30 / FAIL 0`；`MUTATION CAUGHT 4 / MISSED 0`；共享工作树变异后逐字节未变（R1）。

---

## 2. 交付文件（仅 §5 写域内）

| 文件 | 字节 | 行 | CRLF | sha256 前 16 | 性质 |
|---|---|---|---|---|---|
| `lib/handoff-checkpoint.js` | 8,269 | 159 | 0 | `ABBD94D84D78F24E` | **新增** |
| `lib/event-write.js` | 57,349 | 983 | 0 | `839F5116189387AB` | 改（+115 / −1） |
| `lib/event-store.js` | 78,093 | 1,190 | 0 | `20BDD8282C3F6396` | 改（+14） |
| `tests/smoke/smoke-test-batch2-2.7-checkpoint.mjs` | 33,340 | 596 | 0 | `215FEC80A9599D77` | **新增** |
| `docs/internal/RESULT-BATCH2-2.7-CHECKPOINT-20261113.md` | 本文件 | — | 0 | — | **新增** |

**导出数守恒**：`lib/event-write.js` 20 → 20、`lib/event-store.js` 28 → 28（均为 HEAD 实测，未增删导出）。
`lib/handoff-checkpoint.js` 新增 4 个 export（`HANDOFF_CHECKPOINT_SUMMARY_CHARS` / `HANDOFF_CHECKPOINT_KINDS` / `buildHandoffCheckpointSummaryPre` / `default`）。

**未触碰**：`lib/index.js`、`lib/handoff-write.js`（task-18 独占）、`lib/plan-*`、`lib/wb-sidecar.js`、任何真实记忆目录。

---

## 3. 实现要点（含三处必须写明的取舍）

### 3.1 `lib/handoff-checkpoint.js`（新模块，零 IO 纯函数）

```js
buildHandoffCheckpointSummaryPre({ kind:'plan'|'handoff', text, quad })
  → { ok:true, kind, text:≤300, truncated:boolean, sectionsOverride:{goal,state,dead,next}, chars }
  → { ok:false, code:'input-invalid'|'kind-invalid'|'text-required'|'text-empty'|'quad-invalid'|'quad-required'|'summary-empty' }
```

**输出形态**：`目标：… / 现状：… / 失败：… / 下一步：…`（短标签 + 单行分隔）。

**★取舍一：超长时用均分配额，不是直接截断。**
首版是「把四段拼起来，超 300 就截」。实测本机真实账本正是 goal 段最长 ⇒ 直接截会让后面三段整段消失，
摘要读起来只有「目标」。改为超限时按 `(300 − 标签与分隔符开销) / 段数` 均分，四段各留一截。
短正文**不进这条分支** ⇒ 输出与均分逻辑引入前逐字节相同（A8 断言守这条）。

**★取舍二：`truncated` 必须表示「原文有内容没进摘要」，不是「最终串超了上限」。**
这是本轮抓到的**真缺陷**（首版实现即错）：均分后长度必然 ≤300，若拿「超限」当判据，`truncated` 恒为 `false`，
调用方会误以为什么都没丢 —— 直接违反定稿「超长必须可观测」。实测证据：`repeat` 从 40 加到 200（正文 911→4,271 字），
摘要恒为 298 字符，首版 `truncated` 一直 `false`。现改为由均分分支显式传 `true`。

**★取舍三：`sectionsOverride` 原样回传，不压行不裁剪。**
它是「原始四段」，必须与真源解析结果逐字一致（含换行与尾空格，A10 断言）。摘要里出现字段标签，四段里**绝不出现**标签。

### 3.2 `lib/event-write.js` 扩展 `appendHandoffCheckpointPre`

新可选参数：```ledgerText```（完整正文，作幂等身份）+ ```summary``` + ```sourceProof``` + ```sectionsOverride``` + ```quoteRef/rel```。

摘要路径落盘：

| 字段 | 来源 | 说明 |
|---|---|---|
| `text` | `summary.text` | 再过一道 `cutSummaryTextPre` 硬上限（公开 API 兜底） |
| `sourceRef` | `proof.sourceRef` | 相对 handoff 根的路径 |
| `bytes` | `proof.bytes` | 真实磁盘字节 |
| `rawSha256` | `proof.rawSha256` | 完整 64 hex |
| `normalizedSha256` | **`proof.documentNormalizedSha256`** | `normalizeText` 口径 |
| `goal/state/dead/next` | `sectionsOverride` ‖ 真源解析 | **绝不取摘要** |
| `idemKey` | `sha1Hex12(ledgerPath + 完整 ledgerText)` | **与旧路径同源** |

返回值新增 `checkpointIndex`（真实落库后按 idemKey 读回）、`summaryChars`、`sourceBytes`、`sectionsSource`。
**旧调用者零影响**：不传 `summary`/`sourceProof` 时走原样旧路径，返回值形状逐字段不变（B10 断言 `checkpointIndex` 键存在性为 false）。

**★`normalizedSha256` 与 `documentNormalizedSha256` 绝不互换**（定稿 §2 明令）：前者是覆盖规范化口径（2.9 `assessHandoffCoveragePre` 用），
后者是 `normalizeText` 口径（`readPointerPre`/`readEventCheckpointPre` 用）。检查点里存的是**后者**，因为消费方是指针读回。

### 3.3 `lib/event-store.js` 指纹白名单

在检查点字段白名单处新增 ```rawSha256``` / ```normalizedSha256``` 的显式保留（只收完整 64 hex，可带 ```sha256:``` 前缀；不合格抛 ```checkpoint-fingerprint-invalid```）。
不登记就会被白名单直接丢弃 ⇒ 摘要检查点永远只能降级成「兼容全文」，指针白写。

---

## 4. 验收证据（可复算）

**运行**：`node tests/smoke/smoke-test-batch2-2.7-checkpoint.mjs` → `SUMMARY PASS 30 / FAIL 0`，`MUTATION CAUGHT 4 / MISSED 0`。

| 组 | 条数 | 覆盖 |
|---|---|---|
| A（纯函数） | 10 | 常量值、4 类非法入参、handoff 必给四段、plan 无四段合法、确定性、输入不可变、超长四段不漏、短正文逐字节、锚点不外泄、四段原样回传 |
| B（真实落盘→真读回） | 13 | ≤300、四项溯源复算、`verified=true` 且逐字节还原、四段来自原文、幂等去重、摘要外改动产生新检查点、缺 proof 拒绝且库字节不变、半截指纹拒绝、store 白名单再拦、旧路径零回归、plan 同契约、跨事件不串、漂移不冒充真源 |
| M（隔离变异） | 4+1 | 见下表 |
| R/Z | 2 | 共享工作树未被污染、交付物理量 |

### 4.1 隔离变异（全部 CAUGHT）

| 变异 | 改法 | 变异体实测 | 结论 |
|---|---|---|---|
| `full-text-backfill` | 摘要路径 `text` 改回 `ledgerText` | 落盘 651 字 vs 基线 298 字 | **CAUGHT** |
| `quad-from-summary` | 四段改用 `summaryText` | 四段全等于摘要（goal=298 字 vs 原文 140 字） | **CAUGHT** |
| `idem-by-summary` | `idemKey` 改用摘要哈希 | 正文尾部改了仍 `deduped=true`、count=1（应为 2） | **CAUGHT** |
| `quad-required-removed` | 删掉 handoff 必须给四段的判据 | 缺四段返回 `ok:true`（干净实现返回 `quad-required`） | **CAUGHT** |

变异全部在 `artifacts/_batch2-2.7-checkpoint-mutations/<name>/` 的**副本**里做，共享工作树全程只读；
每条变异先断言锚串**恰命中 1 次**（锚没命中 = 变异体没变 = 恒绿假 MISSED）。

### 4.2 本轮实测到并修正的三处假判据（含首版自己写错的）

| # | 首版写法 | 为什么不成立 | 改成 |
|---|---|---|---|
| 1 | `assert(summary.truncated === true)`，实现里 `truncated = 最终串超限` | 均分后恒 ≤300 ⇒ 恒 false，等于**永不告警内容被丢** | 实现改为「原文有内容没进摘要」；断言保留 |
| 2 | `assert(cp.state.length >= summary.chars)` | 真源某一节**本来就可能比整条摘要短**（实测 state=200 vs summary=298），拿长度比大小是假判据 | 改为「四段逐字等于真源解析值，且不等于摘要文本、不含标签」 |
| 3 | `assert(cp.goal === cp.state)` 验 M2 变异；变异锚打在 `: _quad` | 该分支在**传了 `sectionsOverride` 时不可达** ⇒ 变异体仍产出正确四段，M2 被误判 MISSED | 变异锚改打整个 `quad` 构造；断言改为「四段全等于摘要」 |

第 3 条是「变异锚落在不可达分支」的典型陷阱：判据绿不代表没缺陷，可能是**变异根本没生效**。

### 4.3 漂移检测的真实语义（实测，非推理）

真源被改写后 `readEventCheckpointPre` 返回 `ok=false / verified=false / code=pointer-drift / source=checkpoint`，
`text` 是**落盘的摘要正文**，绝不是被改写后的当前文件。要守的不变量是「不把当前文件冒充历史」，不是「ok 仍为 true」。

---

## 5. 与既有机制的交互

| 机制 | 影响 | 处置 |
|---|---|---|
| `smoke-test-batch2-2.6-attribution` 的隔离变异夹具 | **被我引入的依赖打破过**：它复制 event-write 到隔离目录时只带 `event-store.js` / `shared-state-lock.js` / `ledger-doc/protocol.js`；新增对 `handoff-checkpoint.js` 的依赖后副本缺文件 ⇒ `ERR_MODULE_NOT_FOUND`，该套件由绿转红 | 改为**受限惰性加载**：Try 取真常量，缺文件时降级为同值 300（生产必有该文件）。修复后该套件恢复 `EXIT=0`（MUTATION 2/0） |
| `smoke-test-batch2-2.7-drilldown` | 不受影响 | `EXIT=0` / PASS 25/0 |
| `smoke-test-batch2-2.7-pointer` | 不受影响 | `EXIT=0` / PASS 46/0 / MUT 3/0 |
| `smoke-test-batch2-2.9-handoff-coverage` | 不受影响 | `EXIT=0` / PASS 39/0 / MUT 3/0 |
| `smoke-test-t5-plan-section-order` / `v4-h2-note-event` / `v4-percept-onecall` | 不受影响 | 18/18、48/48、19/0 全绿 |
| `smoke-test-i332-write-contract` / `v4-h2-h0-wiring` | **红，但不是本轮引入**：两者断言的 `memory_note` 回执行为依赖 `lib/index.js` 的 2.9 接线。实测工作区 `lib/index.js` 有 **39+/31− 未提交改动**、`lib/handoff-write.js` 为**未跟踪新文件**，均属 task-18 写域。我在本轮**未修改**这两个文件 | 归 task-18；本轮已静态确认 i332 只 import `plan-preflight.js` + 检测 `lib/index.js`，不 import 我改的任何模块 |

---

## 6. 未验边界（如实列出，不当作已完成）

1. **生产接线未做**：旧 `memory_note` 的 plan/handoff 仍写全文。摘要路径要等 task-18 的共享入口落地后才真正生效。**本轮未开启生产、未重启 19387。**
2. **未跑全仓回归**：只跑了 8 个相邻套件（2.7/2.9 三条 + 5 个引用 `appendHandoffCheckpointPre` 的套件）。全量回归归 Lead。
3. **未做真实 HOST 验证**：没有在真实宿主里跑过 `memory_note`，也没有向真实记忆目录写入任何东西。
4. **未验证跨设备/跨时区**：摘要含 `…`（U+2026）与中文标签，未在非 UTF-8 默认环境验证。
5. **`i332` / `h2-h0-wiring` 的红未由我修复**：它们属 task-18 的接线范围，我无权也不应改 `lib/index.js`。需要 Lead 在两条线收口后复跑。
6. **摘要的语义质量未评**：均分配额保证四段都在，但「每段留多少字最可读」没有做过人工评审。300 是用户裁定的上限，不是最优值。
7. **`quoteRef`/`quoteLine`/`rel` 透传未单独验收**：代码路径已写（可选字段），但本套件没有为它们单独建断言。

---

## 7. 回滚

回滚 = 恢复旧 plan/handoff 的写入顺序（即 task-18 的接线回退）。**已写下的摘要检查点不删除、不改写** —— 原文仍在，
`sourceRef` + `rawSha256` + `normalizedSha256` 足以逐字节还原（B3 已证明）。

本轮三个文件的回滚：`git checkout -- lib/event-write.js lib/event-store.js` + 删除 `lib/handoff-checkpoint.js` 与新套件。
