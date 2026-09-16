# P0 施工汇报 · 过夜托管运行结果（2026-09-15）

> **用途**：用户早上拿去给 GPT 验收。本文是**结论汇总**；逐步过程见 `RUN-P0-NIGHTLY.md`。
> **施工依据**：`KICKOFF-P0.md`（第一份指令）+ `MASTER-PLAN-3.0.md` v2 + `reviews/ROUND3-REVIEW-INTEGRATION-20260914.md`。
> **结论**：**P0 五步全部完成**，全量回归 **PASS 84 / FAIL 0 / TIMEOUT 0（153.7s）**。

---

## 1. 改动清单（`文件:函数名`）

### 新增模块（5 个）

| 文件 | 关键函数 | 作用 |
|---|---|---|
| `lib/tier-layer-inject-pre.js`（既有文件，新增） | `filterCurrentHitsPre` | **C8 修复**：注入侧 I5 状态过滤（import 检索侧 `isCurrentPre`，不复制） |
| 同上 | `selectReusableTierHitsPre` / `describeReuseReasonPre` / `TIER_HITS_REUSE_REASONS_PRE_V1` | **T0-2**：命中投影复用判定（五道门，fail closed） |
| **`lib/memory-envelope-pre.js`**（新） | `composeMemoryEnvelopePre` / `describeEnvelopeCharsPre` | **T0-3**：分项账本（E1/E2/E3 三条不变式） |
| **`lib/memory-mutation-pre.js`**（新） | `validateMutationBoundaryPre` / `mutationRefusalTextPre` / `validateProjectionPairPre` / `protectedRegionDigestPre` | **写入门**：共同提交与保护入口（只收规范化投影） |
| **`lib/wb-contract-pre.js`**（新） | `parseWhiteboardPre` / `computeWhiteboardCardIdPre` / `extractProtectedRegionsPre` / `toMutationProjectionPre` / `checkHandoffCriteriaPre` / `checkPlanCriteriaPre` / `criteriaRefusalTextPre` | **白板最小适配边界** + 判据门（格式只维护一份） |
| **`lib/rules-layer-pre.js`**（新） | `extractRulesLayerPre` / `renderRulesSectionPre` / `splitMemoryEntriesPre` / `ruleSummaryPre` | **P6A**：规则层抽取（规则 vs 参考） |

### 既有文件改动

| 文件:函数名 | 改动 |
|---|---|
| `lib/tier-layer-inject-pre.js:composeTieredInjectionPre` | 闸门**之前**插入 I5 过滤；`status-filtered` 降级项；返回体加 `hits` 过滤账；**总长门两处缺陷修复**（降级行先计入再裁、裁完真正回写、`headOverBudgetChars` 显式超额）；返回体加 `textChars/maxTotalChars/claimedTotalChars` |
| `lib/activation-host-pre.js:recordTierGateHits` | 投影补 `contextVersion / miv / observationId / requestKey / workspaceKey`（T0-2 版本四元组） |
| `lib/activation-inbox-pre.js:makeFakeActivationRequestPre` | fixture 支持候选 `status` 与请求 `requestKey` |
| `lib/index.js:buildTierLayerInjection` | 删掉旧的 `fresh`/`sameSession`（只查时间 + 身份缺失时 fail **open**）⇒ 改调 `selectReusableTierHitsPre`；不复用时输出**可见**降级行；`tier0Meta` 暴露 `reuse`/`statusFiltered` |
| `lib/index.js:tierCurrentMivPre`（新方法） | 当前 miv 的**零重读**实现（只用 `sourceFingerprint`，不调 `CorpusRegistry.get()`，避免热路径重建语料） |
| `lib/index.js:peekRuntime`（新方法）+ `SessionRuntimeStore.peek` | **只读**取 runtime，**绝不创建**（修一处我引入的真实回归，见 §5） |
| `lib/index.js:renderMemoryDynamic` | 由 `lines[]+join('\n')` 改为**边推边归位**的 `segs[]` + 分项账本（**字节等价**）；删掉 35% 封顶 `catalogCost` 与注水的 `used`；目录层按**实际注入全文长度**计入 `memoryReferences`；账本挂 `state.envelopeMeta`；超限降级行附尾部；新增 `otherDynamicBudgetChars` 派生逻辑 |
| `lib/index.js:renderRulesOnlySnapshotPre`（新方法） | P6A：只渲染规则段的最小外壳（节流期间仍随轮返回） |
| `lib/index.js:parseGapRoundsPre`（新函数） | P6A：零值安全的间隔解析（**0 可表达**） |
| `lib/index.js:DEFAULT_CONFIG` | `snapshotMinGapRounds: 5 → 1`；新增 `criteriaGate: true`、`rulesLayeringMode: 'off'` |
| `lib/index.js:DEFAULT_PROMPT_LAYERS` | 新增 `snapshotRulesTitle` / `snapshotRulesGuide`（约束语措辞） |
| `lib/index.js:checkMutationPre`（新方法） | 写入保护统一入口（判据门 → 保护门，顺序有意为之） |
| `lib/index.js:writePlanSnapshot` / `writeHandoffLedger` | 接入 `checkMutationPre`；签名加 `opts`（`skipCriteria`） |
| `lib/index.js:checkWaterLevel`（水位骨架路径） | A6 降级路径：`skipCriteria: true` **只跳判据门**；遇保护门拒绝**绝不绕过**并留痕 |
| `lib/index.js:memory_note_pre`（工具层） | 两类拒绝都返回**原始可执行文案**（不再是"白板写入失败(未知)"） |
| `lib/index.js`（注入调用方） | P6A：`parseGapRoundsPre` 替换 `Number(v) || 5`；节流分支由"跳过整份快照"改为 `rulesOnlyText + renderReflectionRequest()` |

### 新增/修改测试（5 新增 + 4 修改）

| 文件 | 断言数 | 覆盖 |
|---|---|---|
| `tests/smoke/smoke-test-i5-status-filter-pre.mjs`（新，原红证明转正） | 45 | C8 / I5；取值域、同函数对照、过滤在闸门之前、挡下不静默 |
| `tests/smoke/smoke-test-t0-2-version-gate-pre.mjs`（新） | 68 | T0-2；★A 快照候选不得用于 B、五道门 fail closed、原因码可读 |
| `tests/smoke/smoke-test-t0-3-budget-ledger-pre.mjs`（新） | 64 | T0-3；E1/E2/E3、无未计费尾巴、rules 不参与裁剪 |
| `tests/smoke/smoke-test-t0-8-mutation-gate-pre.mjs`（新） | 110 | T0-8 / **T0-8B** / **T0-8C** / 判据不张冠李戴 / 职责不混 |
| `tests/smoke/smoke-test-p6a-rules-layer-pre.mjs`（新） | 94 | **T7-1 / T7-3 / T7-4 修订 / T7-6 / T7-7**；零值解析；先规则后 gap |
| `smoke-test-c5-tier-inject-pre.mjs` | 90 | **改掉 3 条锁死错误现状的断言**（`superseded` 被当成"正确行为"） |
| `smoke-test-handoff-pre.mjs` / `smoke-test-p7-write-fix-pre.mjs` | 53 / 40 | 签名扩展同步 + `checkMutationPre` 桩 |
| `smoke-test-i5-status-filter-pre.mjs` | — | 接线断言由"写死单行文本"改为**参数语义** |

**总新增断言：381 条**（45+68+64+110+94）。

---

## 2. 每条新断言的编号 + 现状 + 它证明什么

| 编号 | 现状 | 证明什么 |
|---|---|---|
| **T0-1 / C8** | ✅ **绿**（原 4/4 报红） | 非 `current` 条目在**注入侧**也被过滤（契约 I5 的两处要求都落地） |
| **T0-2** | ✅ **绿** | A 快照产生的候选**不会**进 B 快照的注入（I6 同版）；五道门任一不可证明即 fail closed |
| **T0-3** | ✅ **绿** | `chars.total === text.length`（逐字节）；分项之和 = 总计（**无未计费尾巴**）；分项上限是硬约束且裁剪可见 |
| **T0-8** | ✅ **绿** | 删卡无归档 → **拒写且文件字节不变**；合法归档 / 合法改名 / 加卡 / 重排 → 放行；用户区被吞或被改 → 拒 |
| **T0-8B** | ✅ **绿** | **三条写入路径都不能绕过共同保护**（工具 / 水位骨架直调 / 刷新仪式产物） |
| **T0-8C** | ✅ **绿** | **关掉质量门后仍拒绝丢卡**（`criteriaGate=false` 撤不掉共同保护） |
| **T7-1** | ✅ **绿**（范围内） | 连续 6 轮规则都在。**如实标注**：测的是**注入函数返回值**；"模型真收到"需宿主 U6 |
| **T7-3** | ✅ **绿** | 规则类与参考类引导语**不相同**（防改回统一措辞） |
| **T7-4（v2 修订）** | ✅ **绿** | 含「必须」但带引用/历史语境（`据文档写着`/`曾经`/`已取消`）**不自动升级为规则**，只作待确认候选 |
| **T7-6** | ✅ **绿**（措辞收紧） | 内容不变 ⇒ 前缀**字节稳定**。**不冒充**"缓存命中"或"按 1/10 计费" |
| **T7-7** | ✅ **绿**（部分） | 规则以 `rules` 分项进账本 + 代码里**不存在**对 rules 的裁剪调用。可机械判断的**执行结果**仅此；行为级遵守需 U6/U7 |
| **T4-4** | ❌ **未做** | 投影/快照/Tier-0 同一身份映射 —— 依赖 Phase 1 的 miv 单源，**不属 P0**（KICKOFF 未列入 P0 五步） |
| T0-6（数值守卫范围） | ❌ **未做** | `smoke-test-doc-code-consistency-pre.mjs` 现覆盖 7 字段，未扩到 `L1`/`K` —— KICKOFF 未列入 P0 五步 |

---

## 3. 实测数据

| 项 | 值 |
|---|---|
| **全量回归** | `node tools/run-smoke.mjs` ⇒ **PASS 84 / FAIL 0 / TIMEOUT 0，153.7s，exit 0** |
| 套件数变化 | **79 → 84**（+5 新套件；KICKOFF 预告"允许变成 80"，实际 84） |
| **红证明** | `red-proof-phase0-t01.mjs`：修复前 **0 通过 / 4 报红** ⇒ 修复后 **4/4 绿** |
| 守卫 | `verify-todo-graph` exit 0（47 卡）；`doc-code-consistency` 44/0 |
| 回归次数 | 全量跑 **4 次**（每步完成后 1 次 + 收尾 1 次），每次均 0 失败 |
| **变异演示** | i5 **12 红** / t0-2 **8 红** / t0-8 **15 红** / p6a **11 红**；每次均 SHA256 逐字节还原 |
| 字节卫生 | 全部改动文件 **无 BOM**；`lib/index.js` 保持 CRLF；新模块与新测试 LF |

---

## 4. 回滚方法（每步一个开关 / 一个还原动作）

| 步骤 | 回滚 |
|---|---|
| C8 状态过滤 | **无开关**（这是契约 I5 的正确行为）。还原 `lib/tier-layer-inject-pre.js` 的 `filterCurrentHitsPre` 调用即可回退 |
| T0-2 版本校验 | 还原 `lib/index.js:buildTierLayerInjection` 的 `selectReusableTierHitsPre` 调用（旧 `fresh`/`sameSession` 代码片段已作为注释留在原位） |
| T0-3 分项账本 | 还原 `lib/index.js:renderMemoryDynamic` 为 `lines[]` 版（**旧实现全文在 git 工作区未提交状态中存在**，本步改动集中在该函数）。`otherDynamicBudgetChars` 未配置时自动派生，无副作用 |
| **写入门** | **`criteriaGate: false`** 退掉**判据门**（质量门）。⚠️ **丢卡/用户区/重复 id 三条共同保护无开关可退**——这是设计（ROUND3 §3.7 第 4 条）。要完全回退需还原 `writePlanSnapshot` / `writeHandoffLedger` 两个函数体 |
| 水位骨架降级 | A6 行为由 `criteriaGate` + 该分支的 `skipCriteria` 共管；不改则为"照写 + 警示行" |
| **P6A** | **`rulesLayeringMode: 'off'`**（**默认已是 off**）⇒ 完全回到旧行为（统一措辞 + 原节奏）。`snapshotMinGapRounds` 默认值改回 5 即回退节奏部分 |

**⚠️ 关键提醒（回滚不等于零影响）**：P6A 的**措辞**部分在 `rulesLayeringMode='off'` 时**不生效**
（规则段根本不注入），但 `snapshotMinGapRounds` 默认值 5→1 是**全局默认值变更** ——
已保存配置的用户不受影响（配置覆盖默认值），**新装用户**会拿到 1。

---

## 5. 施工中发生的两处真实缺陷（含我引入的一处）

### 5.1 我引入的回归：`runtimeFor` 在 `await` 之后复活已 dispose 的 runtime

- **现象**：`smoke-test-context-observer.mjs` P3f 报 `Error: runtime B survived dispose`。
- **根因**：我在 `buildTierLayerInjection` 里用 `this.runtimeFor(agent)` 读 `contextVersion`；
  该方法底层 `SessionRuntimeStore.get()` **找不到时会 `createSessionRuntime()` 并重新登记**
  ⇒ 在 `await` 之后调用就**复活了已销毁的 runtime**。
  这正是本项目硬纪律写死的那条坑（"任何 `await` 之后再取 runtime/agent 句柄都可能复活已 dispose 的对象"）。
- **修法**：新增**只读**的 `MemoryEngine.peekRuntime` / `SessionRuntimeStore.peek`（绝不创建），
  注入路径改用它。
- **教训**：热路径读运行时状态必须用只读查询；`runtimeFor` 是"取或建"语义，不是 getter。

### 5.2 首跑抓到的真实实现缺陷：规则行只剩日期

- **现象**：`smoke-test-p6a-rules-layer-pre.mjs` 首跑，"连续 6 轮规则都在"报红（got=0）。
- **根因**：`ruleSummaryPre` 最初直接用 `firstLine`，而既有记忆条目结构是
  「锚点 → `## 日期` → 正文」⇒ 规则行渲染成 `- ## 2026-08-14`，**规则内容全丢**，
  而且**看起来还挺正常**（有内容、有格式）。
- **修法**：新增 `ruleSummaryPre` 跳过日期小节标题与锚点行，取第一条实质内容。

### 5.3 其它已留痕的踩坑

- **注释里的裸 ASCII 双花括号**会打断"花括号配平"式源码抽取（`smoke-test-handoff-pre.mjs:extractFn`
  报 `unbalanced`）⇒ 注释改为文字描述。
- **源码接线守卫不要写死单行调用文本**：T0-3 给 `composeTieredInjectionPre({...})` 补参数并改多行后，
  写死单行的断言变红，但接线仍在 ⇒ 改为断言**参数语义**。
- **源码抽取型测试必须注入该函数依赖的全部模块级符号**：`renderMemoryDynamic` 接入
  `composeMemoryEnvelopePre` 后，`smoke-test-handoff-pre.mjs` 需把该模块源码一并注入。
- **字节卫生事故**：`smoke-test-handoff-pre.mjs` 编辑后变 CRLF（原为 LF）⇒ 已逐字节转回并复跑确认。

---

## 6. 未完成项与原因

| 项 | 状态 | 原因 |
|---|---|---|
| **T4-4**（投影/快照/Tier-0 同一身份映射） | 未做 | KICKOFF §3 未列入 P0 五步；其前提（miv 单源）属 **Phase 1** |
| **T0-6**（数值守卫范围扩到 `L1`/`K`） | 未做 | KICKOFF §3 未列入 P0 五步（总纲 Phase 0 提到，但施工顺序表未含） |
| **白板锚点实装** | 未做（**刻意**） | 锚点完备性属白板线 **P1/P2**。P0 若硬判锚点，**现存 `PLAN.md` 一个锚点都没有 ⇒ 所有既有白板立刻写不进去**（会把"保护"变成"锁死"）。故写入门在"能证明丢卡"时才生效（before 侧解析出了卡片集合） |
| **UI 侧**（记忆窗格"当前受什么约束"页） | 未做 | 总纲归"UI 提质排期"，非 P0 |
| **规则分类持久化 / 规则修改撤回 / 跨窗口失效** | 未做 | 这是 **P6B**（接在 P1 上），v2 明确"不能绕过状态提交" |

---

## 7. 预授权默认值的实际使用情况

| 编号 | 预授权决定 | 实际使用 | 我认为该改的地方 |
|---|---|---|---|
| **B1**（丢卡风险） | **做**：前后卡片集合对比，只能移动/完成，不能消失 | ✅ **完全按此实现**（M1） | 无 |
| **B5**（双状态源） | 看板=现在时（唯一事实）；账本=过去时，其"任务状态"段只指路 | ⚠️ **P0 只做了写入门侧的引用**（B5 的 miv 语义属 P1，KICKOFF 如此规定） | 无 |
| **B4**（人机冲突） | 从选项 (c) 起步：每卡分「模型维护区 / 用户备注区」 | ✅ 适配器实现分区解析 + M2 保护 | **建议**：`<!-- model -->` 为可选（未加标记的卡片不报错），但**一旦用了就严格校验闭合**。这个宽容度是我加的，需 GPT 确认是否过宽 |
| **A8**（条目锚点） | 做：`mem_` + sha256(workspaceKey + 页面相对路径 + 卡片标题) 前 32 位 | ✅ `computeWhiteboardCardIdPre` 按此实现 | 无 |
| **A6**（水位骨架硬判据失败策略） | 照写 + 警示行 | ✅ 按此实现，且**收紧了一处**：遇**保护门**拒绝时**不绕过**（A6 只覆盖判据门） | **建议 GPT 审**：我把 A6 的"照写"限定在判据门内，这是我的判断（依据 ROUND3 §3.7 第 4 条"开关不能撤掉共同保护"）。若 GPT 认为 A6 也应覆盖保护门，则该处需改 |
| 其余 A1–A7 / B2/B3/B6/B7 | 按方案建议 | 未触及（P1/P2 范围） | — |
| **Q3b 的 `Bo`** | 新增为独立配置；未配置时以 `Bm` 作派生初值，不另设魔数 | ✅ `otherDynamicBudgetChars`，未配置时 = `injectBudgetChars` | 无 |
| **P6A 的"改默认值"** | 默认 5 → 1 | ✅ 已改；并**额外实现**了"先规则后 gap"（v2 要求，光改默认值不足以声称"规则每轮在场"） | 无 |
| **P6A 的规则真源** | 既有用户级 `MEMORY.md`，不新增 `RULES.md` | ✅ 严格遵守 | 无 |
| **`rulesLayeringMode` 默认值** | KICKOFF 未指定（新配置项） | ⚠️ **我选了 `'off'`（默认关）** | **建议 GPT 审**：按"新旧并存 + 开关回退"纪律，默认关是对的；但**用户的痛正是"规矩不在场"**，默认关意味着新用户**仍然**拿不到收益。这是一个纪律与疗效的张力点 |

---

## 8. 🎯 我认为最值得让 GPT 审的三个点

### ① 写入门在「before 侧没有卡片集合」时 fail-soft 放行，是否留下了一个长期缺口？

**我的判断**：P0 若硬判锚点，**现存 `PLAN.md` 一个锚点都没有** ⇒ 所有既有白板立刻写不进去。
故我的实现是：**当 before 侧解析出卡片集合时**才做丢卡比对；解析不出（无锚点）则不放行丢卡检查
（但用户区检查仍跑，若 before 有受保护区域）。
**风险**：这意味着**在用户给白板加锚点之前，丢卡事故仍然拦不住** —— 也就是"规范已批准、代码从未实现"
这个事故根因**只是部分关闭**。
**请审**：这个过渡策略对不对？有没有更安全又不会锁死既有白板的做法（例如"首次重写时自动补锚点 + 建档基线"）？

### ② 「规则每轮在场」的可验证边界在哪里？我是否把 U6 依赖标注得够诚实？

**我的实现**：`rulesLayeringMode='off'` 时规则段不注入；开启后规则段**每轮**随注入函数返回
（节流只作用于参考内容），进 `rules` 分项且**代码里不存在对 rules 的裁剪**。
**我没有声称的**：模型**真的收到了**规则 —— 那需要宿主最终请求 messages 的确认（**U6**，未具备）。
T7-7 要求"可机械判断的执行结果"，我只能给到"规则进了最终注入文本的分项账本"。
**请审**：这个边界够不够？在 U6 之前，是否还有**其他**可机械判断、且能证明"规则确实在场"的证据？

### ③ A6（水位骨架照写）与"共同保护不可绕过"的边界，我划对了吗？

**背景**：A6 预授权决定的水位骨架失败策略 = **照写 + 警示行**（优先保证接续材料存在）。
ROUND3 §3.7 第 4 条要求"新旧开关不能撤掉共同保护"。
**我的划法**：`skipCriteria: true` **只跳判据门**（质量门）；遇**保护门**拒绝时
**放弃本次写入并留痕**（绝不绕过）。即"宁可这次没有接续材料，也不静默丢卡"。
**请审**：这与 A6 的原意（"优先保证接续材料存在"）是否冲突？两个原则（I4 绝不阻塞接续 vs 保护不可绕过）
在这里谁优先？我的选择是**保护优先**，但这使 A6 的"照写"承诺在我实现里**打了折扣**，需要 GPT 明确裁定。

---

## 9. 附：本次施工的文件清单（供验收时逐个打开）

**新增源码**：`lib/memory-envelope-pre.js`、`lib/memory-mutation-pre.js`、`lib/wb-contract-pre.js`、`lib/rules-layer-pre.js`
**改动源码**：`lib/index.js`、`lib/tier-layer-inject-pre.js`、`lib/activation-host-pre.js`、`lib/activation-inbox-pre.js`
**新增测试**：`tests/smoke/smoke-test-i5-status-filter-pre.mjs`、`smoke-test-t0-2-version-gate-pre.mjs`、`smoke-test-t0-3-budget-ledger-pre.mjs`、`smoke-test-t0-8-mutation-gate-pre.mjs`、`smoke-test-p6a-rules-layer-pre.mjs`
**改动测试**：`smoke-test-c5-tier-inject-pre.mjs`、`smoke-test-handoff-pre.mjs`、`smoke-test-p7-write-fix-pre.mjs`
**过程留痕**：`docs/internal/RUN-P0-NIGHTLY.md`（逐步记录，含每次变异演示与踩坑）

**未提交改动**：本工作区仍有约 98+ 个用户的未提交文件。**全程未执行任何 git 写操作**
（无 commit / push / checkout / stash / reset），未触碰 `~/.dsh/` 配置，未重启任何宿主进程。
