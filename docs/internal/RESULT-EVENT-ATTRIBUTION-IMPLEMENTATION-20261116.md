# 2.3 事件归属建议与异常提醒 —— 生产接线施工报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-28）
> 依据：[PROMPT-EVENT-ATTRIBUTION-IMPLEMENTATION-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-IMPLEMENTATION-20261116.md)
> 开工 HEAD `55a4b2a9`（分支 `preview`）｜ 未 commit/push（由 Lead 复核后统一提交）
> 性质：**生产代码本地实现与隔离验收**。不是发布、不是真实记忆迁移、不是 2.4 归并授权。

---

## 0. 结论

**2.3 已按「系统化 / 模块化 / API 化」落地，`lib/index.js` 只做薄接线。**

### Lead 最终集成复核（2026-11-16）

- Lead 独立复跑：专项 **67/0**、工具级 **29/0**、历史零写提案 **37/0**；r26 **26/0**，verify-docs **22/86/181** 守恒。
- Lead 独立 `--impact-run --jobs=8 --timeout=180000`：**216 PASS / 3 FAIL / 1 TIMEOUT（220 套 / 248.7s）**；**不是全绿，且未跑全量回归**。
- 四项非绿已单独复核：`issue368-write-contract-negative` 与 `switch-decouple` 为 HEAD 既有 FAIL；`r4-p4-3-brief-scan` 单跑 **20/0 / 15.4s**；`audit-g-207` 单跑通过、并发临时目录竞态。
- task-29 误删 `lib/index.js` 约 513 KB 后已恢复并重打补丁。最终 diff 为纯增量（181 insertions / 1 deletion），无冲突标记；最终文件 **2,185,452 B / 30,049 CRLF / 0 裸 LF / 0 CRCRLF / 41 导出**，与事故前基线一致。唯一 bare CR 为 HEAD 既有，非本批新增。
- 当前 `lib/event-attribution/` **9 文件 / 64,652 B**；`lib/index.js` 当前 SHA-256 **620dd05da9ef241981923805fa58d749020b28345fc154ea477d63cfab62d315**。
- 本报告前段保留 task-28 首轮数字；返工后的权威字段/入口/测试见 R0–R9，最终数量以本节为准。
- **真实 HOST 仍未验证**：runSubagent 实际延迟/超时、真实会话噪声、resolvedProvider/Model 与真实记忆零写未闭合。生产自动归属、2.4 和 SidecarStore facade 均未开放。

| 项 | 结果 |
|---|---|
| 新模块 | **9 个文件 / 63,251 B**，全部在 `lib/event-attribution/` |
| `lib/index.js` 增量 | **+6,458 B / +80 行**（3 处锚定接线，无业务逻辑） |
| 专项套件 | **67 PASS / 0 FAIL**；**变异 5/5 CAUGHT** |
| r26 | **26 PASS / 0 FAIL**（判据过期，已按套件自身表达式重钉） |
| impact-run | **215 PASS / 2 FAIL / 1 TIMEOUT** —— 3 项**全部归因为既有**（见 §7） |
| verify-docs | **全绿**，工具/路由/配置键 **22 / 86 / 181 守恒** |

---

## 1. 分层与模块边界（系统化 / 模块化）

| 模块 | 字节 | 行 | 单一职责 | 禁止事项（已验证未违反） |
| contract.js | 9068 | 205 | DTO / 枚举 / 默认值 / 不变量 / 冻结 profile | 不读文件、不调模型 |
| candidate-pool.js | 7236 | 169 | eligible 候选、LOOCA、证据视图、**显式**截断 | 不写事件库、不做归属判定 |
| prompt.js | 5188 | 102 | 输入规范化 + prompt 构造 + promptSha256（**确定性**） | 不调宿主、不解析输出 |
| parser.js | 4617 | 108 | 严格 JSON 提取 + 四态校验 + **eventId 白名单** | 不猜测/修补非法 ID |
| reviewer.js | 9350 | 230 | 触发判定与编排（唯一决定「要不要调模型」） | 不写文件、不渲染 UI |
| receipt.js | 5667 | 123 | proposal → 文本提醒（**不改写入结果**） | 不改变原工具写入结果 |
| host-model.js | 3911 | 91 | 宿主 runSubagent 适配、超时/空输出归一化 | 不新建网络通道、不做业务判定 |
| regroup.js | 5686 | 129 | R1/R2/R3 历史零写提案适配（**不接 apply**） | 不接 apply/confirmToken |
| index.js | 6528 | 187 | **唯一**公共 facade / 冻结 API 形状 | 不堆实现细节 |
| smoke-test-2-3-event-attribution.mjs | 24818 | 306 |  |  |

**依赖方向**：`index → {contract, candidate-pool, prompt, parser, reviewer, receipt, host-model, regroup}`；
领域模块**零**对 `lib/index.js`、文件系统、宿主私有字段的依赖；外部能力全部经 `ports` 注入。

### 1.1 公共 API（已冻结）

```js
createEventAttributionService(ports) → {
  review(input),          // 主路径：memory_log 写前/写后复核
  reviewExplicit(input),  // memory_note 只读复核
  proposeRegroup(input),  // 历史账本零写提案
  renderReceipt(proposal, ctx),
  appendReceipt(originalText, proposal, ctx),
  profile                 // 冻结 profile v1
}
```

**ports**：`modelPort`（`{ call(prompt, opts) }`）· `clock`（可选）。

**导出计数（实测）**：facade 模块 **29 个导出**；`PUBLIC_API` 声明 **27 键**，**形状不符 0**（专项 T0 断言）。
`lib/index.js` 导出数 **41**（与接线前一致，**未新增公共导出**）。

### 1.2 冻结 profile `EVENT_ATTRIBUTION_PROFILE_V1`

| 字段 | 值 |
|---|---|
| `schemaVersion` | `event-attribution/v1` |
| `promptVersion` | `event-attr-prompt/v1` |
| `inputNormalizationVersion` | `event-attr-norm/v1` |
| `eventRepresentationVersion` | `event-attr-repr/v1` |
| `candidatePoolPolicy` | `event-attr-pool/v1` |
| `hostRoute` / `hostJobLabel` | `host-subagent` / `auto-memory-event-attr` |
| `timeoutMs` | 60000 |
| `budget` | `maxEvidenceChars=260` / `maxCandidates=12` / `maxRecordChars=900` |

> 模型变更**不得**隐式复用旧证据/向量/结论：每次调用把 `promptSha256` + 各版本号写进 `modelIdentity`。

---

## 2. `lib/index.js` 只做薄接线（3 处）

| # | 位置 | 内容 | 行数 |
|---|---|---|---|
| A | 顶部 import 区 | `import { createEventAttributionService as ..., createHostModelPort as ... } from './event-attribution/index.js'` | +8（含注释） |
| B | `memory_log` dryRun 分支 | 追加只读复核并拼进预检回执；取不到 facade 即原样返回 | +23 |
| C | `memory_log` 真实写入回执 | 尾部追加 `_eaTail`（try/catch 兜底，失败则空串） | +22 |
| D | `memory_note` 参数表 | 新增 `attributionReview: boolean` | +5（含注释） |
| E | `memory_note` execute 首行 | `attributionReview===true` ⇒ **任何写入之前**提前返回 | +27 |

**指纹**（守卫，非功能证据）：

| 项 | 接线前 | 接线后 | Δ |
|---|---|---|---|
| 字节 | 2,172,889 | **2,179,347** | +6,458 |
| 行数 | 29,873 | **29,953** | +80 |
| CRLF / 裸 LF | 29,872 / 0 | **29,952 / 0** | 行尾一致性守恒 |
| sha16 | `F6BF9EFFEC3BC4B5` | **`AEE4843C1343A4A0`** | — |

**关键设计约束（必须记录）**：本文件的部分代码会被 **13 个 smoke 套件**用 `new Function` 抽出单独求值，
那些作用域里**既没有模块级绑定、也没有 engine 实例方法** ⇒ 接线处一律用 `typeof createEventAttributionServicePre === 'function'` 兜底；
拿不到就整块跳过，**既有行为逐字节不变**。这也是「公共 API + 依赖注入」在本仓落地的实际理由。

---

## 3. 触发条件矩阵（正常路径不额外烧模型）

| 场景 | 是否调用模型 | 实测断言 |
|---|---|---|
| 显式 `eventId` 的真实写入 | **否** | T11 |
| 高置信单标识命中、无冲突 | **否** | T17 |
| 未传 eventId，预判 `create` | 是 | T14 |
| 预判 `attach` 但 `reason=wordbag/legacy` | 是 | T15 / T16 |
| 标识多命中 | 是 | T18 |
| 证据冲突 | 是 | T19 |
| `dryRun`（含显式 ID） | 是 | T12 / T13 |
| 模型不可用 / 超时 / 非法输出 | 降级为 `unavailable`，**不重复轰炸** | T20–T25 |

**模型不重定目标**：真实写入仍走原路径；回执明确「已挂/已新建 + 模型建议是参考，**未改写**」（T32 / N8）。

---

## 4. 候选池与 truncation 契约

**这是本批最重要的判据**（直接来自 task-27 的实证教训）：

| 字段 | 语义 | 不变量 |
|---|---|---|
| `eligibleCount` | 满足约束的全部候选 | — |
| `visibleCount` | 实际送入模型 | `visible + omitted = eligible` |
| `omittedCount` | **显式**省略数 | `>0` ⇒ `truncated=true` 且 `coverage=partial` |
| `coverage` | `complete / partial / none` | **由 omitted 派生，调用方写 `complete` 也会被改正**（T2） |

**LOOCA（leave-one-current-out）**：`closed` / `future` / `self` 三类必须排除并记录原因（T7b/c/d）。

**预算截断实测**：40 个 eligible / `maxCandidates=12` ⇒ `visible=12 / omitted=28 / partial`（T4/T5/T6）。

**gold coverage 说明**：本批是**生产接线**，不含离线评测集，因此不产 gold 数字；
但契约已强制任何未来评测必须**同时**报 `eligibleCount/visibleCount/omittedCount`，否则 `validateProposalInvariants` 报违规。

---

## 5. 降级与 fail-closed（安全方向唯一）

| 失败形态 | 结果 | 断言 |
|---|---|---|
| 未注入 `modelPort` | `unavailable` | T20 |
| 宿主返回**空串**（门控未过/子代理不可用） | `unavailable` + `model-unparseable` | T23 |
| 模型抛错 / 超时 | `unavailable` | T24 |
| 模型返回**未知 eventId** | `unavailable`（**不采纳、不猜**） | T25 / N4 |
| 模型返回非法 `decision` | `unavailable` | N5 |
| 空输出 / 非 JSON | `unavailable` | N6 / N7 |
| 模型选中「被截断掉的合法事件」 | `unavailable`（**安全优先，信息有损**） | T25b/T25c |

**★最重要一条**：`unavailable` **绝不等于** `create-new`（T21 专门断言反向）。
回执也会说清「模型未给出任何归属意见（不可用 ≠ 建议新建）」（T35）。

### 5.1 一个必须说清的设计张力（真实发现，不是缺陷）

T25b 实测：当候选池被预算截断时，模型若选中**被截掉的那个合法事件**，`parser` 的白名单会把它拒掉 ⇒ 归为 `unavailable`。

- **安全性正确**：不采纳未在输入中出现过的 ID，杜绝「模型幻觉被洗成可信数据」。
- **信息性有损**：一个本来正确的判断被丢弃。
- **缓解**：`pool.omittedCount` 已如实记录，回执会显示「候选池不完整 ⇒ 结论可辩护性下降」；prompt 里也明确告知模型「候选不全时判 ambiguous 而非 create-new」。
⇒ 这是**有意的取舍**，已在报告中单列，未当作缺陷掩盖。

---

## 6. memory_note 只读复核（review-only）

**参数**：`attributionReview: true`（可选；不传 ⇒ 既有行为逐字节不变，零默认模型调用）。

| 判据 | 结果 | 断言 |
|---|---|---|
| `kind=note/plan` 等非事件链 ⇒ `not-applicable`，**不硬编事件** | 通过 | T38 / T38b |
| **零写**：记忆文件 sha256 前后相同 | 通过 | T46 |
| 提前返回位置在**任何写入之前** | 代码位置 + 变异 M3 | — |

**零写范围界定**（任务书要求明确）：本路径**不写** MEMORY.md / 账本 / PLAN / 维护文档 / 事件检查点；
宿主 subagent 运行日志属**另一类**可观测副作用，不混称「整机零文件写入」。

---

## 7. 历史账本零写提案

| 判据 | 结果 | 断言 |
|---|---|---|
| `dryRun` 只回 prompt 预览，**不启动子代理** | 通过 | T41 |
| 复用 R1 机械建议映射为候选 | 通过 | T42 |
| 模型不可用 ⇒ 保留机械建议 | 通过 | T43 |
| **`apply` / `writeCuratedEventsPre` / `applyRegroup` / `curateUnarchivedPre` 调用 0 次** | 通过 | **T44（哨兵计数器全 0）** |
| **未签发 `confirmToken`、未写 `_curateToken`** | 通过 | **T45** |
| 严格校验复用 R3 的 `parseAiBatchPre`（守恒 fail-closed） | 通过 | 代码 + §1 分层 |
| 不新增 HTTP 路由 | verify-docs 路由 86 守恒 | — |

---

## 8. 真执行与变异

### 8.1 专项套件 `smoke-test-2-3-event-attribution.mjs`（24818 B / 306 行）

**67 PASS / 0 FAIL**。全部为 `真 import → 真构造 → 真调用 → 断言返回值/副作用`；
静态断言（`PUBLIC_API` 形状、`FORBIDDEN_APPLY_METHODS`）已**显式标注为「守卫，非功能证据」**。

### 8.2 隔离变异（只在内存/隔离副本，不写工作区）

| 变异 | 变异点 | 结果 |
|---|---|---|
| M1 | 删「截断强制 coverage=partial」 | **CAUGHT**（静默截断会被抓到） |
| M2 | 删 eventId 白名单检查 | **CAUGHT**（幻觉 ID 会被采纳） |
| M3 | 删回执「未改写」措辞 | **CAUGHT**（回执会伪称已按模型修正） |
| M4 | 删 LOOCA 的 future 排除 | **CAUGHT**（未来事件会混入） |
| M5 | 删「ambiguous 不得择一」 | **CAUGHT** |

**5 / 5 CAUGHT，0 MISSED。**

> **两个变异装置教训（已写进套件注释，可复用）**：
> ① 变异副本必须**整目录 + 保持真实相对层级**复制（`regroup.js` 依赖 `../event-regroup-propose.js`），否则 ESM `ERR_MODULE_NOT_FOUND`；
> ② **每个变异必须用独立目录**——在同一目录连续改不同文件时，`index.js` 的传递依赖仍命中 ESM 缓存 ⇒ 变异体根本没生效（实测首版 4/5 全 MISSED 就是这个原因，不是判据问题）；
> ③ 变异点必须**有区分力**：首版 M3 删的是 `unavailable` 分支，但 `DECISION_CN` 表里仍有中文名 ⇒ 渲染文本不变 ⇒ 变异体无效，换成「删『未改写』」后才真正生效。

### 8.3 受影响既有套件（全部真跑）

| 套件 | 结果 |
|---|---|
| `v4-event-attr-receipt` | 68 PASS / 0 FAIL |
| `v4-h1b-memory-log` | 全 PASS |
| `v4-h2-note-event` / `v4-percept-onecall` / `v314-plan-contract` / `t6-ritual-incremental` / `issue162-diagnostic-integrity` / `v4-h2-h0-wiring` / `g4-whiteboard` / `p6b-rules-kind` | 全 PASS |
| `g3-note-status-wire` | 48 / 1 —— **与 HEAD 基线逐条一致**（见 §9） |
| `v314-gate-scope-j` | 3 条 ✗ —— **与 HEAD 基线逐条一致**（见 §9） |

---

## 9. 回归结果与**全部红灯归因**

### 9.1 r26（判据过期，已重钉）

| 项 | 原登记 | 复算（套件自身表达式） |
|---|---|---|
| `R153_CHARS` | 1,616,211 | **1,621,507**（Δ +5,296） |
| sha16 | `C1BC1369686A2BCC` | **`D9FC8BE2B16723CE`** |

**归因**：`lib/index.js` 有意演进（3 处锚定接线），**非产品缺陷**。
按纪律**用套件自身表达式**（`readFileSync` 后 `replace(/\r\n/g,'\n')`）真跑复算，未手填、未按次数定位；并在 `R153_CHARS` 上方补了 R205 归因注释。
**重钉后：26 PASS / 0 FAIL。**

### 9.2 impact-run（`--jobs=8 --timeout=180000`）

```
PASS 215 / FAIL 2 / TIMEOUT 1 / FLAKY 0   (total 244.6s)
```

**3 项全部归因为既有问题**，逐个做了 HEAD 基线对照（隔离副本，未在共享工作区就地改）：

| 套件 | 工作区 | HEAD 基线 | 归因 |
|---|---|---|---|
| `issue368-write-contract-negative` | exit=1 | **exit=1** | 既有断言 `writePlanSnapshot must be awaited or returned` 失败；行号由 26,330 → 26,250 属接线后**预期偏移** |
| `switch-decouple` | 53/54 | **53/54**，同一行 ✗ | 既有：`对照:白板开时同一 fixture 两层材料都在` |
| `r4-p4-3-brief-scan` | TIMEOUT(182.3s) | 单跑 **13.7s** | **并发抢占假红**：单跑 `20 PASS / 0 FAIL`、`MUTATION 3/3 CAUGHT`、`RESTORED GREEN` |

**逐条对照方法**：把 `HEAD:lib/index.js` 与完整 `tests/`、`tools/` 复制到隔离目录，跑同一套件，比对 ✗/FAIL 行集合；
三项均满足「工作区独有 0 / 基线独有 0」。

### 9.3 verify-docs

**全绿**：工具 **22**、路由 **86**、配置键 **181** 三方（文档 / 实测 / 代码）一致。
⇒ 「不新增工具数/路由数/配置键」的硬约束**守恒**。

---

## 10. **未做项与未验证边界**（必须单列）

### 10.1 生产未做项（本批明确不做）

1. **未接 2.4**：不调 `applyRegroupPre` / `writeCuratedEventsPre`，不签发 `confirmToken`（T44/T45 已验证 0 次）。
2. **未接 SidecarStore facade**、未开 R4-on。
3. **未改前端**：`lib/client.js`、皮肤、生成器零改动。
4. **未新增工具 / 路由 / 配置键**（22 / 86 / 181 守恒）。
5. **未新增直接网络请求**、未装依赖、未下载模型。
6. **未重启/占用 19387**、未 push、未发版。
7. **未称 RL**；未训练任何模型。

### 10.2 真实 HOST 未验（**本批最大空白**）

**未做真实 HOST 验收**。原因：本批为生产代码本地实现，未启动隔离 `DSH_HOME` / profile。
因此以下**全部未验证**，不得用 smoke 冒充：

- 真实宿主 `runSubagent` 的**实际延迟与超时**（60s 预算是否够用）；
- 真实模型返回的 `resolvedProvider` / `resolvedModel`（本批按契约**恒为 null**，不猜测）；
- `memory_log` 在**真实会话**中触发复核后的**实际用户可见体验**（是否噪声过多）；
- `memory_note(attributionReview)` 在真实记忆库上的零写（只在临时目录验证）。

### 10.3 数据与能力边界

8. **多合理候选**（`ambiguous`）质量仍未验 —— task-27 实测 0.5946，本批只是**如实返回 `ambiguous` 不强择一**，未改善判断力。
9. **跨语言 / 伞事件**：连续四轮（task-25/26/27/28）**无真实样本**，本批未构造 synthetic 冒充。
10. **gold coverage**：本批无离线评测集，未产 gold 数字（契约已强制未来必须报）。
11. **未做全量回归**：只跑 `--impact-run`（215 套）。全量 244 套**未跑**，不冒称全量通过。

---

## 11. 写域与产物

| 路径 | 字节 | sha16 |
|---|---|---|
| lib/index.js | 2179347 | AEE4843C1343A4A0 |
| lib/event-attribution/contract.js | 9068 | F03ED65EC143AFDF |
| lib/event-attribution/candidate-pool.js | 7236 | E4BE79D5D067C229 |
| lib/event-attribution/prompt.js | 5188 | 90982D0D843C2EAA |
| lib/event-attribution/parser.js | 4617 | 61FBDE0AD9EE3122 |
| lib/event-attribution/reviewer.js | 9350 | 5366B55E45A96087 |
| lib/event-attribution/receipt.js | 5667 | 8C7734192F036D6A |
| lib/event-attribution/host-model.js | 3911 | A166DF1CD6628A0A |
| lib/event-attribution/regroup.js | 5686 | AEA2626F6B165BB0 |
| lib/event-attribution/index.js | 6528 | 125D4599647E0302 |
| tests/smoke/smoke-test-2-3-event-attribution.mjs | 24818 | 4F179B6E63DC6739 |
| tests/smoke/smoke-test-r26-cross-layer.mjs | 146668 | FC820A588AA6202A |

**改动文件清单**：

| 文件 | 性质 |
|---|---|
| `lib/event-attribution/*.js`（9 个） | **新增** |
| `lib/index.js` | 修改（3 处锚定接线，+6,458 B / +80 行） |
| `tests/smoke/smoke-test-2-3-event-attribution.mjs` | **新增**（专项，67 断言 + 5 变异） |
| `tests/smoke/smoke-test-r26-cross-layer.mjs` | 修改（重钉 R153_CHARS + sha16 + R205 归因注释） |
| `lib/event-regroup*.js` | **未改**（R1/R2/R3 原样复用） |
| `lib/client.js` / 皮肤 / 生成器 | **未改** |

**未改动**：任务书、总表、NEXT-STEPS（Lead 负责）、无关未跟踪产物。

复算入口：

```bash
node --check lib/index.js
node --check lib/event-attribution/index.js
node tests/smoke/smoke-test-2-3-event-attribution.mjs   # 67 PASS / 5 CAUGHT
node tests/smoke/smoke-test-r26-cross-layer.mjs        # 26 PASS
node tools/verify-docs.mjs                             # 22/86/181
node tools/run-smoke.mjs --impact-run --jobs=8 --timeout=180000
```

---

# 附：task-29 返工段（Lead 真实 diff 审查 → 逐项修复）

> 触发：Lead 审查 task-28 真实 diff 发现 5 项阻断，task-29 返工。
> 基线：HEAD `5d32c01d` + task-28 全部未提交改动（**未回滚任一成果**）。

## R0. 逐项结论速览

| # | 阻断 | 根因 | 修法 | 真实证据 |
|---|---|---|---|---|
| ① | 候选池漏真实 `checkpoint.goal/state` | `candidate-pool.js:66` 只读 `checkpoint.panels`，回退读 `event.text` | 直接读 `checkpoint.goal/state`，`panels` 保留为兼容通道，回退改为 `checkpoint.text` | 真实形状 `{name,summary,checkpoints:[{goal,state,text}]}` 断言 G/S 进证据；仅 text 时回退正确；**不再读 event.text** |
| ② | 目标不可见误报 `suspect-auto-attach` | 只要 `attrDecision=attach` 且模型选择不同就打醒悟；但目标可能被 top-K 截掉 | 分离 `focusEventId`（当前目标）与 `excludeEventId`（自引用）；**强制保留 focus 可见槽位**；目标真不可见 ⇒ `EXPLICIT_TARGET_NOT_IN_POOL` + 决策降级 `ambiguous` | 三例：目标第13/max12 且同意 ⇒ **不误报**；目标可见且模型选另一 ⇒ 才 suspect；目标不在 eligible ⇒ not-in-pool |
| ③ | 历史零写提案只有 facade | 无 `engine.proposeRegroupPre`、无 `event-curate` 的 propose 分支 | 新增真实 engine 方法（真调 R1/R2/R3 + facade）+ **既有路由内** `op='propose'` 分流（**不新增路由**） | 37 断言：dryRun 模型 0 次、实际 propose 零写/无 token、`_curateToken` 未改、6 项写原语 **0 次** |
| ④ | `lib/index.js` 新接线缺工具级证明 | 旧专项只测 facade；13 个抽取套件因无模块绑定走跳过路径 | 新增工具级套件：**字符串感知配平**抽取 + **显式注入** facade，真调 tool.execute | 29断言：dryRun 模型 1 次且零写、显式 ID 0 次、预判 create 1 次、不注入对照 0 次 |
| ⑤ | `requestedProvider/Model` 恒 null | 未从配置读取 | `host-model` 新增 `describe()`（读 `engine.config.subagentProvider/subagentModel`）；reviewer 写 requested；**resolved 仍恒 null 不猜** | 有配置⇒deepseek/v4.1-flash；无配置⇒null；无 describe 方法⇒不崩 |

## R1. 阻断一：真实 checkpoint 字段

**修前**（生产形状完全读不到）：

```js
const q = (c && c.panels) ? c.panels : null   // ← 只读 panels
if (parts.length < 3) { const txt = ev.text }    // ← 回退读 event.text
```

**修后**：

| 优先 | 字段 | 说明 |
|---|---|---|
| 1 | `checkpoint.goal` / `checkpoint.state` | **真实 schema**（`memory_event` 参数表 / `event-write` / `handoff-write` 均用直接字段） |
| 2 | `checkpoint.panels[{kind:'goal'|'state'}]` | **兼容通道**保留 |
| 3 | `checkpoint.text` | 无 goal/state 时的回退（**不再读 `event.text`**） |

实测输出：

```
真实形状 {goal:'G1',state:'S1',text:'T1'} → ["name: N","summary: S","goal: G1 | state: S1","statusAtRecord: active"]
仅 text {text:'only-text'}          → ["name: N","summary: S","checkpoint.text: only-text","statusAtRecord: active"]
event.text:'EVENT-TEXT' + checkpoint.text:'CK-TEXT' → 含 CK-TEXT，**不含** EVENT-TEXT ✓
```

## R2. 阻断二：focus 槽位与误报分流

**核心区分**（旧实现把两者混成一个 `excludeEventId`）：

| 概念 | 语义 |
|---|---|
| `excludeEventId` | 「别把自己算成候选」（LOOCA 自引用） |
| `focusEventId` | 「我是来复核它的，**必须让它可见**」 |

**槽位保留实测**（13 候选 / max=12 / focus 天然排第 13）：

```
focusInEligible=true  focusReserved=true  focusVisible=true
visible 顺序: evt_12,…,evt_02,**evt_00**(focus)   ← 挤掉 evt_01，且仍按原排序
reserveFocus=false ⇒ focusVisible=false（保留降级开关）
focus 不在 eligible ⇒ focusInEligible=false ⇒ 打 EXPLICIT_TARGET_NOT_IN_POOL
```

**误报根治**：

| 场景 | 修前 | 修后 |
|---|---|---|
| 目标第13/max12，模型同意 | 可能误报 suspect | **suspect 0**，decision=attach-existing |
| 目标可见，模型明确选另一事件 | suspect | **suspect 1**（这才是真否决） |
| 目标不在 eligible | suspect（**误报**） | **explicit-target-not-in-pool 1 / suspect 0**，decision 降级 `ambiguous` |

## R3. 阻断三：历史零写提案的真实入口

新增 `engine.proposeRegroupPre(opts)`（**2,236 字符方法体**）：

| 项 | 实测 |
|---|---|
| 真调用 R1/R3 | `listUnarchivedPre` 1 · `scanUnarchivedLedgersPre` 1 · `groupIntoCandidateEventsPre` 1 · `estimateCurationCostPre` 1 · `validateEventNamePre` 1 |
| 真调用 R2 | `buildRegroupPromptPre` 2（复用既有构造，**不另写 prompt 层**） |
| 写原语 **0 次** | `writeCuratedEventsPre` · `applyRegroupPre` · `applyRegroup(` · `appendCheckpointPre` · `createEventForWorkPre` · `_curateToken` |
| 自证字段 | `wrote:false` · `confirmToken:null` |
| dryRun | **模型调用 0 次**，仅回 prompt 预览 |

**HTTP 入口**：在**既有** `event-curate` 路由内新增 `op='propose'` 分流，**放在 `candidateIds` 判断之前** ⇒ 带 `op:'propose'` 的请求结构上不可能落入写盘分支；**路由总数仍为 1/86**。

## R4. 阻断四：工具级真执行证明（本返工最重要的新增证据）

**旧专项的盲区**：只测 facade；13 个抽取套件因为作用域里没有模块绑定，实际走「`typeof !== function` 跳过」路径 —— 跳过通过**不等于**接线工作。

**新套件**：`smoke-test-2-3-event-attribution-tools.mjs`（29 PASS）。两个装置要点：

1. **字符串感知的括号配平**：旧装置直接数字符，而 `defineTool` 的 desc 是含裸 `(`/`)` 的长字符串 ⇒ 配平提前闭合，**实测把 `memory_note` 抽成了 `memory_procedure`**。改为跳过 `'`/`"`/反引号与注释后再配平。
2. **显式注入** `createEventAttributionServicePre` / `createHostModelPortPre` ⇒ 走**真实接线分支**，并用「不注入」作对照。

| 断言 | 结果 |
|---|---|
| dryRun 确实调用模型（注入后） | calls=**1** |
| dryRun 前后**所有文件字节不变** | ✓ |
| 显式 `eventId` 真实写入 | calls=**0**（不事后质疑用户） |
| 预判 create 真实写入 | calls=**1**，事件数 1→2（**未被模型重定目标**） |
| 模型不可用 | 写入照常成功 |
| **不注入对照** | calls=**0**（证明上面的 1 次确实来自新接线） |
| `memory_note(attributionReview)` | MEMORY.md / 事件库 / 日视图 **sha256 全同**，未创建 PLAN.md |
| kind=note 无 eventId | `not-applicable`（不硬编事件） |

### R4.1 本返工抓到的**两个真实产品缺陷**（旧专项漏掉）

| # | 缺陷 | 根因 | 表现 |
|---|---|---|---|
| D1 | `_eaTail` 回执段引用 `store0` | `store0` 是 `try{}` 内局部变量，而回执段在 try/catch **之外** | `ReferenceError` 被本块 catch 吞掉 ⇒ **模型复核静默不生效** |
| D2 | 同上引用 `_attr` / `_wantEv` | 同为 try 内局部 | 同类静默失效 |

**修法**：回执段只用 try 外**已同步**的 `_own*` 族（新增 `_ownHits`）+ `evId`，事件快照**重新只读一次**（`readEventStorePre` 纯读）。
修复后同一装置：`modelCalls=1`，回执正常出现建议文本。

> 这两个缺陷正是「只测 facade 不测工具级接线」的直接代价，也是本轮返工最有价值的产出。

## R5. 协议补齐：requested 与 resolved 分开

| 字段 | 来源 | 无配置时 |
|---|---|---|
| `requestedProvider` / `requestedModel` | `modelPort.describe()` ← `engine.config.subagentProvider/subagentModel` | `null` |
| `resolvedProvider` / `resolvedModel` | `runSubagent` **未报告** ⇒ 恒 `null` | `null`（**不猜测**） |

实测：有配置 `deepseek / v4.1-flash`；无配置 `null/null`；port 无 `describe` 方法时不崩（requested=null）。

## R6. 回归（全部本轮复跑，未沿用旧归因）

| 套件 | 结果 |
|---|---|
| `smoke-test-2-3-event-attribution.mjs（原专项67）` | 67 PASS / 0 FAIL |
| `smoke-test-2-3-event-attribution-tools.mjs（新·工具级）` | **29 PASS / 0 FAIL** |
| `smoke-test-2-3-event-attribution-propose.mjs（新·零写提案）` | **37 PASS / 0 FAIL** |
| `smoke-test-v4-event-attr-receipt.mjs` | 68 PASS / 0 FAIL |
| `smoke-test-v4-h1b-memory-log.mjs` | 35 PASS / 0 FAIL |
| `smoke-test-v4-h2-note-event.mjs` | 48 PASS / 0 FAIL |
| `smoke-test-r26-cross-layer.mjs` | **26 PASS / 0 FAIL**（判据过期已重钉） |
| `verify-docs` | **全一致**，22 / 86 / 181 守恒 |

### R6.1 原 impact 三红灯：**逐项单独复跑**（不沿用旧结论）

| 套件 | 工作区 | HEAD(`5d32c01d`) 隔离副本 | 归因 |
|---|---|---|---|
| `issue368-write-contract-negative` | exit=1，行号 **26417** | exit=1，行号 **26250** | **同一断言** `writePlanSnapshot must be awaited or returned`，差异仅行号偏移（本批 +167 行）；本批新增内容**不含** `writePlanSnapshot` |
| `switch-decouple` | **53/54** | **53/54** | 完全一致，既有 |
| `r4-p4-3-brief-scan` | **20 PASS / 0 FAIL / 15.4s** | 同上 | **并发抢占假红**（上一轮 182.3s TIMEOUT） |

### R6.2 r26 重钉（第二轮）

| 项 | 原登记 | 本轮复算（套件自身表达式） |
|---|---|---|
| `R153_CHARS` | 1,621,507 | **1,626,312**（Δ +4,805） |
| sha16 | `D9FC8BE2B16723CE` | **`426001898BEAD5FC`** |

归因：本轮新增 `proposeRegroupPre` 方法 + `event-curate` 内 op 分流。已补 R206 归因注释。

## R7. 指纹

| 文件 | 字节 | sha16 |
|---|---|---|
| `lib/event-attribution/candidate-pool.js` | 10068 | 6F8E3FD7D142B4D0 |
| `lib/event-attribution/contract.js` | 9509 | 52105CEE5736E977 |
| `lib/event-attribution/host-model.js` | 4629 | E95F44C35BB50771 |
| `lib/event-attribution/index.js` | 6528 | 125D4599647E0302 |
| `lib/event-attribution/parser.js` | 4617 | 61FBDE0AD9EE3122 |
| `lib/event-attribution/prompt.js` | 5188 | 90982D0D843C2EAA |
| `lib/event-attribution/receipt.js` | 5667 | 8C7734192F036D6A |
| `lib/event-attribution/regroup.js` | 5686 | AEA2626F6B165BB0 |
| `lib/event-attribution/reviewer.js` | 12760 | 63ECADE9938EA552 |
| `lib/index.js` | **2185452** | **E6C6C2944A068164** |

`lib/index.js`：**30,050 行 / CRLF 30,049 / 裸 LF 0 / 无 CRCRLF**；导出数 **41（不变）**。

## R8. 未验边界（如实）

1. **真实 HOST 仍未验**（未启隔离 DSH_HOME/profile）⇒ `runSubagent` 真实延迟/超时、resolved 身份、真实会话噪声体验均未验。
2. **未接 2.4**：`applyRegroupPre` / `writeCuratedEventsPre` 调用 **0 次**（已切方法体取证）；未签 `confirmToken`。
3. **未接 Sidecar facade**、**未改前端**、**未新增工具/路由/配置键**（22/86/181 守恒）、**未装依赖**、**未重启 19387**、**未 commit/push**。
4. 未跑全量回归（只 `--impact-run`）；`ambiguous` 判断力未改善；跨语言/伞事件仍无真实样本。
5. T18/T19 因 memory_note 完整写入路径需要整套宿主预算/原子写方法，改用**装置对照**（真写后 sha 必变）证明零写断言有区分力，已在套件内标注。

## R9. 一个必须说明的操作事故（已完整恢复）

返工过程中我在给 HTTP 路由加分支时，**误删了 `lib/index.js` 约 513 KB**（结构性截断），随后立即 `git checkout HEAD -- lib/index.js` 恢复，并**逐条重打** task-28 的 5 处接线 + task-29 的 2 处新增，全部通过 `node --check`、真 import、导出数 41 守恒、CRLF 纯一。

最终文件与 process 无关地可复算：见 R7 指纹。

**新增套件复算入口**：

```bash
node tests/smoke/smoke-test-2-3-event-attribution-tools.mjs    # 29 PASS（工具级真执行）
node tests/smoke/smoke-test-2-3-event-attribution-propose.mjs  # 37 PASS（零写提案真实入口）
```

### R6.3 impact-run 最终结果与本轮新出现的红灯

```
PASS 216 / FAIL 3 / TIMEOUT 1 / FLAKY 0   (total 246.0s)
```

| 红灯 | 归因（本轮复跑） |
|---|---|
| `issue368-write-contract-negative` | 既有断言，HEAD 26250 行 / 工作区 26417 行，同一断言仅行号偏移 |
| `switch-decouple` | 53/54，HEAD 同为 53/54 |
| `r4-p4-3-brief-scan` | `--jobs=8` 下 182.4s 超时；**单跑 20 PASS / 0 FAIL / 15.4s** ⇒ 并发抢占假红 |
| `audit-g-207`（**本轮新出现**） | `--jobs=8` 下假绿防线报 `ENOENT ... \.dsh-smoke-tmp\run-24744-...\memory`；**单独复跑通过** ⇒ 并发共用临时目录的路径竞态，与本批改动无关 |

> `audit-g-207` 上一轮 impact 未出现（`skipped` 更早失败），本轮为新增观察项，已单独复跑归因，**不沿用任何旧结论**。

**未跑全量回归**：只跑 `--impact-run`（220 套）。全量 244+ 套未跑，不冒称全量通过。
