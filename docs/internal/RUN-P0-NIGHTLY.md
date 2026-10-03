# RUN-P0-NIGHTLY · 过夜施工运行日志

> **这是什么**：KICKOFF §6.2 要求的持续追加运行日志。压缩会吃掉思考过程，但吃不掉写进文件的结论。
> **读法**：接续/被压缩后，先读本文件恢复进度，再继续施工。
> **纪律**：客观陈述（第三人称中性句式），只留可复用的事实/决策/路径，不写思考腔。

---

## [00:20] 接续仪式 + 环境确认

- 目标：接续上一窗口（已按接续键），恢复上下文并按 KICKOFF 开工。
- 做了：
  - 读 `docs/internal/KICKOFF-P0.md`（254 行，第一份指令）。
  - 按 §2 找接续转写包：`~/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/prev-session-session--160615.md`（75497 字节，2026-09-15 00:06:15，最新一份）。
  - 读 `MASTER-PLAN-3.0.md`（§0.5 v2 修订 + §0–§3.5）与 `reviews/ROUND3-REVIEW-INTEGRATION-20260914.md`（230 行，全部三处我方错误 + 六处设计修正 + 断言编号）。
- 结果：确认工作区 `main` 分支、110 项未提交改动（含约 98 个用户工作状态文件）；全量基线待复测。
- 卡住：无。
- 下一步：跑红证明 → 修 C8。

## [00:26] 第一步 · C8 红证明复现（修复前）

- 目标：按 KICKOFF §3.1 先确认缺陷真实存在（不是推测）。
- 命令：`node tools/_redproof/red-proof-phase0-t01.mjs`
- 结果：**0 通过 / 4 报红，exit 1**。实测四条全红：
  - `superseded 条目不出现在 Tier-1 注入行` RED
  - `retracted 条目不出现在 Tier-1 注入行` RED
  - `非 current 正文不出现在最终文本` RED
  - `Tier-1 条数 = current 命中数(2) —— 实际 4` RED
- 判读：契约 I5（`THREE-LAYER-CONTRACT.md:183`）在**注入侧**从未实现；检索侧（C2）早已过滤。
- 根因（读码确认）：`lib/tier-layer-inject-pre.js:buildTier1SectionPre` 把 `h.status` 当**展示字段**渲染进 `- [layer/status]` 前缀，**从不做准入判断**。
- 卡住：无。
- 下一步：在装配器入口（闸门之前）加 current 过滤。

## [00:35] 第一步 · C8 修复完成（注入侧 I5 状态过滤）

- 目标：让非 current 条目在注入侧被挡下，并让红证明转绿。
- 改了：
  - `lib/tier-layer-inject-pre.js:filterCurrentHitsPre`（**新增导出**）—— 复用检索侧唯一权威
    `import { isCurrentPre } from './l0-extract-pre.js'`（**import 而非复制**：复制会让两侧漂移）。
  - `lib/tier-layer-inject-pre.js:composeTieredInjectionPre` —— 在**闸门之前**过滤（顺序关键：
    放闸门后会让"全是 superseded"仍下探并渲染空段）；新增 `status-filtered` 降级项；
    返回体新增 `hits`（过滤账：kept/dropped/total/current/droppedCount/droppedIds）。
  - `tests/smoke/smoke-test-c5-tier-inject-pre.mjs:127/133/137` —— **改掉锁死错误现状的断言**，
    并附注释说明原断言违反 I5、证据是红证明 4 报红。原 `lines[2].includes('0.55')` 用的是被挡下的
    superseded 条目，改为**真正乱序输入**独立验证降序。
- 结果：
  - `red-proof-phase0-t01.mjs` ⇒ **4 通过 / 0 报红，exit 0**。
  - `smoke-test-c5-tier-inject-pre.mjs` ⇒ pass=90 fail=0。
  - `smoke-test-three-layer-pre.mjs` ⇒ pass=122 fail=0（无连带破坏）。
- 卡住：无。
- 下一步：把红证明移进 `tests/smoke/` 成为正式套件。

## [00:45] 第一步 · 红证明入正式套件 + 演示变红

- 目标：KICKOFF §3.1 第 3/4 条 —— 转绿后移入 `tests/smoke/`，并遵守
  「新增守卫必须演示变红后再按字节还原」纪律。
- 改了：新增 `tests/smoke/smoke-test-i5-status-filter-pre.mjs`（7 组 44 断言）。
  保留原红证明 4 条判据，另补：取值域（缺失/空放行、未知值 fail closed）、
  与检索侧同函数逐值对照、过滤在闸门之前、挡下不静默且**不回显被挡条目正文与 id**、
  接线可达性、以及「开关不能撤掉共同保护」（过滤在 `enabled` 开关**之前**执行）。
- **定向变异验证**：把 `isCurrentPre(h)` 改成 `true` ⇒ 套件 **12 条报红**；
  随后按字节还原，SHA256 `A1C0CF8A9630C4677764EB5CBA4138046A49D2063303C06921F8EEB620591CA3`
  前后一致（`RESTORED_BYTE_EXACT=True`）。
- 结果：新套件 pass=44 fail=0。
- 卡住：无。
- 下一步：跑全量回归确认基线（预期 80 套件）。

## [01:05] 全量回归（C8 修复后）

- 命令：`node tools/run-smoke.mjs`
- 结果：**PASS 80 / FAIL 0 / TIMEOUT 0，total 160.1s，exit 0**。
- 判读：套件数 79 → **80**（新增 `smoke-test-i5-status-filter-pre.mjs`），符合 KICKOFF §3.1 第 4 条预期。
- 卡住：无。
- 下一步：第二步 T0-2 版本校验。

## [01:25] 第二步 · T0-2 版本校验完成

- 目标：命中投影复用**不得只凭时间**（旧 `lib/index.js:3894` 只查 `Date.now()-at<30min`，
  且身份取不到时 **fail open**）。
- 改了：
  - `lib/tier-layer-inject-pre.js:selectReusableTierHitsPre`（新增）+ `describeReuseReasonPre`
    + `TIER_HITS_REUSE_REASONS_PRE_V1` —— 五道门：时间 / 会话 / 工作区 / **版本（contextVersion + miv）** /
    观测身份。凡不能证明同版同源 ⇒ fail closed 不复用；原因码全部有可读中文。
  - `lib/activation-host-pre.js:recordTierGateHits` —— 投影补 `contextVersion / miv / observationId /
    requestKey / workspaceKey`（T0-2 要求携带版本四元组）。
  - `lib/index.js:buildTierLayerInjection` —— 删掉旧的 `fresh` / `sameSession` 判定，改调版本门；
    不复用时追加**可见**降级行（I7），并把复用账写进 `tier0Meta.reuse`。
  - `lib/index.js:tierCurrentMivPre`（新增）—— 当前 miv 的**零重读**实现：只用 `sourceFingerprint`
    （`size:mtimeMs`）判变化，**不调 `CorpusRegistry.get()`**（后者在指纹变化时会整体重读重建语料，
    不能放在每轮热路径上）；60 秒缓存，异常一律返回 null（下游 fail closed）。
  - `lib/activation-inbox-pre.js:makeFakeActivationRequestPre` —— fixture 支持 `status` 与 `requestKey`。
- 结果：新增 `tests/smoke/smoke-test-t0-2-version-gate-pre.mjs` **pass=68 fail=0**。
  含核心场景「A 快照产生候选、B 快照准备输出 ⇒ 必须不复用（混装即失败）」。
- **定向变异验证**：把三道版本门改成恒假 ⇒ 套件 **8 条报红**；按字节还原后 SHA256 前后一致。
- 首跑踩坑（已留痕在测试注释）：两条接线断言**假红** —— 正则命中了注释里刻意保留的旧实现片段。
  修正方式：先剥注释再匹配（本文件成为"源码接线守卫 ≠ 行为断言"纪律的又一实例）。
- 卡住：无。
- 下一步：第三步 T0-3 预算单一口径。

## [01:55] 第三步 · T0-3 预算单一口径完成（模块层 + 接线）

- 目标：把注入预算改成**分项账本**（v2 §3.3 选 (ii)），消灭两处实测缺陷。
- 改了：
  - **新增 `lib/memory-envelope-pre.js`**：`composeMemoryEnvelopePre` + `describeEnvelopeCharsPre`。
    三条不变式各有能红断言：E1 `chars.total === text.length`（逐字节）、
    E2 分项之和 = 总计（**不允许未计费尾巴**）、E3 分项上限是硬约束且**裁剪永远可见**。
    `rules` 不参与裁剪（显式传上限也会被忽略并留痕）；`over-budget-total` 如实记录代价
    （v2 要求"不许用记账写法掩盖"）。
  - `lib/tier-layer-inject-pre.js:composeTieredInjectionPre` —— 修总长门两处：降级行**先计入 head
    长度**再裁、裁完**真正回写** headParts、head 自身超预算时输出 `headOverBudgetChars` 显式超额行；
    新增 `textChars / maxTotalChars / claimedTotalChars / headOverBudgetChars` 四个可审计字段。
    第一版实现漏了回写（降级行没进文本），靠 `claimed === len` 自检抓到 —— 已写进代码注释。
  - `lib/index.js:renderMemoryDynamic` —— 从 `lines[] + join('\n')` 改为**边推边归位**的 `segs[]`，
    交给分项账本计量与序列化；删掉 35% 封顶的 `catalogCost` 与注水的 `used`；
    目录层按**实际注入全文长度**计入 `memoryReferences`；`otherDynamicBudgetChars` 按 v2
    "未配置时以 `Bm` 作派生初值、不另设魔数"实现；账本挂 `state.envelopeMeta`；
    超限降级行附在快照尾部（不静默）。
    **字节等价**：`join('\n')` ≡「首段无前缀 + 其余各加 `\n`」拼接；`neutralizePromptTemplateVars`
    改为逐段施加（`{{`→`｛｛` 是 1:1 等长替换，逐段与整篇结果相同）。
- 结果：新增 `tests/smoke/smoke-test-t0-3-budget-ledger-pre.mjs` **pass=64 fail=0**；
  `smoke-test-c5-tier-inject-pre.mjs` 90/90（旧的总长门断言由红转绿）。
- 连带修正（两条，非行为回归，已留注释）：
  - `smoke-test-i5-status-filter-pre.mjs` 的接线断言原写死**单行**调用文本，T0-3 给该调用补了
    `extraDegradations` 并改多行 ⇒ 改为断言**参数语义**（hits 确实作为实参传入）。
  - `smoke-test-t0-3-budget-ledger-pre.mjs` 的 `envelope.chars.total` 断言改为 `envelope.chars`
    （`total` 在同一表达式里，断言更贴实现）。
- **连带回归（我引入的，已修）**：
  1. `error: runtime B survived dispose`（`smoke-test-context-observer.mjs` P3f）——
     我在 `buildTierLayerInjection` 里对 `runtimeFor(agent)` 取值；该方法底层
     `SessionRuntimeStore.get()` **找不到时会新建并重新登记**，于是在 `await` 之后
     **复活了已 dispose 的 runtime**。这正是本项目硬纪律写死的那条坑。
     修法：新增**只读**的 `MemoryEngine.peekRuntime` / `SessionRuntimeStore.peek`（绝不创建），
     注入路径改用它。
  2. `ReferenceError: composeMemoryEnvelopePre is not defined`（`smoke-test-handoff-pre.mjs` G4）——
     `renderMemoryDynamic` 现在依赖分项账本模块，而该套件用 `new Function` **抽源码跑**，
     作用域里没有这个符号。修法：把 `lib/memory-envelope-pre.js` 源码一并注入（剥 `export `）。
     这不是"测试迁就实现"——抽取式测试本来就要显式提供该函数依赖的全部模块级符号。
  3. `Error: unbalanced: renderMemoryDynamic(context) {` —— 我在注释里写了裸 ASCII **双花括号**，
     而该套件的 `extractFn` 靠**花括号配平**切函数体。修法：注释改为文字描述
     （不写裸双花括号），并把这条坑写进注释本身。
- 卡住：无。
- 下一步：第三步完成后跑全量；然后第四步（写入门 + 白板最小适配边界）。

## [02:05] 第四步 · 写入门 + 白板最小适配边界完成（T0-8 / T0-8B / T0-8C）

- 目标：把 `WB-FORMAT-CONVENTION.md` §4 的写入门与 §5 的人机分区**真正实现**
  （事故根因是"规范已批准、代码从未实现"：实际 `PLAN.md` 一个锚点、一个分区标记都没有）。
- **边界（总纲 §0.5 / ROUND3 §3.1 定案）**：3.0 主体拥有共同提交与保护入口；白板线拥有白板格式及适配器。
- 改了：
  - **新增 `lib/memory-mutation-pre.js`**：`validateMutationBoundaryPre`（**只收规范化投影**
    `{beforeIds, afterIds, protectedRegions, afterProtectedRegions, archivedIds}`，**零白板格式知识**）
    + `validateProjectionPairPre` + `mutationRefusalTextPre` + `protectedRegionDigestPre`。
    三条**无条件**保护：**M1** 丢卡（消失必须显式归档，否则拒写并报差异清单）/ **M2** 用户区
    （摘要逐字节比对；**省略 afterProtectedRegions = fail closed**）/ **M3** 重复 id。
  - **新增 `lib/wb-contract-pre.js`**：`parseWhiteboardPre`（锚点 / 卡片 / 人机分区 / 状态解析）
    + `computeWhiteboardCardIdPre`（A8 预授权默认值：`mem_` + sha256(wsKey+NUL+页路径+NUL+标题) 前 32 位）
    + `extractProtectedRegionsPre` + `toMutationProjectionPre`（唯一桥）
    + **同模块内置判据门** `checkHandoffCriteriaPre`（H1–H4/S1–S4）/ `checkPlanCriteriaPre`
    （P-H1/P-H2/P-S1）+ `criteriaRefusalTextPre`（格式只维护一份）。
  - `lib/index.js`：新增 `checkMutationPre`（**判据门在前、保护门在后**，顺序有意为之：
     质量门可退、保护门不可退）；`writePlanSnapshot` / `writeHandoffLedger` 各加 `opts` 并接入；
     水位骨架降级路径（A6 预授权默认值 = **照写 + 警示行**）走 `skipCriteria:true`，
     **只跳判据门、遇保护门拒绝时绝不绕过**；工具层对两类拒绝都返回**原始可执行文案**；
     新增配置 `criteriaGate: true`。
- 结果：新增 `tests/smoke/smoke-test-t0-8-mutation-gate-pre.mjs` **pass=110 fail=0**。
  含 T0-8B（三条写入路径都不能绕过共同保护，源码接线守卫）、T0-8C（**关掉质量门后仍拒绝丢卡**）、
  以及"判据不能张冠李戴"的反证（把账本判据套给 PLAN 会误拒 ⇒ 证明归属必须分开）。
- **定向变异验证**：把 M1/M2 改成恒通过（＝回到"写入门从未实现"的旧行为）⇒ **15 条报红**；
  按字节还原后 SHA256 前后一致。
- 连带修正（签名扩展，非行为回归）：`smoke-test-handoff-pre.mjs` 与 `smoke-test-p7-write-fix-pre.mjs`
  用**签名字符串**抽取函数 ⇒ 同步为 `(projectDir, content, opts)`；并给假引擎补
  `checkMutationPre` 恒过桩（门本身由 T0-8 套件专测，接线由 T0-8B 锁）。
- 中途一次**操作失误**（已留痕）：变异演示脚本里第二处替换目标写错了文件，
  脚本以 `!!! MUT2 NOT APPLIED` 退出并留下一个未还原的 `.bak-mut`。已立即还原两文件并按 SHA256
  确认无残留，随后重做变异演示（这次先在 `memory-mutation-pre.js` 内精确定位字符串）。
- 卡住：无。
- 下一步：第五步 P6A。

## [02:40] 第五步 · P6A 注入表达与节奏完成

- 目标：修**用户最痛的病**——「规矩不在场 / 规矩被降格为"只是参考"」。
- 改了：
  - **新增 `lib/rules-layer-pre.js`**：`extractRulesLayerPre`（两级判定：结构化前缀=高置信 /
    约束语汇=中置信）+ `renderRulesSectionPre` + `splitMemoryEntriesPre` + `ruleSummaryPre`。
    **遵守 v2 的真源纪律**：规则真源＝**既有用户级记忆**里的类型化规则，**不新增 `RULES.md`**。
    **遵守 T7-4 的 v2 修订**：含「必须」但带引用/历史语境（`据文档写着` / `曾经` / `已取消`…）
    **不得自动升级为规则**，只产生「待确认候选」——GPT 给的两个反例已写成断言。
  - `lib/index.js`：`DEFAULT_PROMPT_LAYERS` 新增 `snapshotRulesTitle` / `snapshotRulesGuide`
    （**约束语**措辞，与参考段的"参考"语义**不同**）；新增 `renderRulesOnlySnapshotPre`；
    `renderMemoryDynamic` 把规则段以 `rules` 分项**排在最前**（在开场白/状态行之后、一切参考内容之前）；
    新增配置 `rulesLayeringMode: 'off'`（**默认关** = 新旧并存 + 一键回退）。
  - **节奏三处**（ROUND3 §3.3 Q3c，逐条落实）：
    ① `snapshotMinGapRounds` 默认 **5 → 1**；
    ② **新增 `parseGapRoundsPre`** 修零值解析（旧 `Number(v) || 5` 让 **0 无法表达**）；
    ③ **节流分支不再跳过整份快照** —— 改为 `return rulesOnlyText + renderReflectionRequest()`，
       即"**先提供规则段，再对参考内容应用 gap**"。
- 结果：新增 `tests/smoke/smoke-test-p6a-rules-layer-pre.mjs` **pass=94 fail=0**。
  含 T7-1（连续 6 轮规则都在 —— 在**能测的范围内**测注入函数返回值，并如实标注"模型真收到"需 U6）、
  T7-3（规则与参考引导语**必须不同**）、T7-4 修订（两个反例 + 反面：真规则仍要认）、
  T7-6（前缀字节稳定；**不冒充**缓存命中）、T7-7（规则以 `rules` 分项进账本 + 代码里不存在对 rules 的裁剪）。
- **首跑抓到一个真实实现缺陷**：`ruleSummaryPre` 最初直接用 `firstLine`，而既有记忆条目结构是
  「锚点 → `## 日期` → 正文」⇒ 规则行被渲染成 `- ## 2026-08-14`（**规则内容全丢，只剩日期**）。
  修法：新增 `ruleSummaryPre` 跳过日期小节标题与锚点行。
- **定向变异验证**：三点变异（取消引用语境降级 / 引导语改回"只是参考" / 摘要退回读首行）
  ⇒ **11 条报红**；按字节还原后 SHA256 前后一致。
  期间发现断言不够健壮（`candidates[0].confidence` 在变异后会抛 TypeError 让套件崩掉、
  只剩一条红报告）⇒ 改为防御式取值，让"能红"不退化成"能崩"。
- 卡住：无。
- 下一步：全量回归 + 收尾汇报。

## [03:00] 全量回归 + 字节卫生 + 收尾

- 命令：`node tools/run-smoke.mjs`
- 结果：**PASS 84 / FAIL 0 / TIMEOUT 0，total 154.0s，exit 0**。
  套件数 79 → **84**（新增 i5 / t0-2 / t0-3 / t0-8 / p6a 五个套件）。
- 守卫：`node artifacts/verify-todo-graph.mjs` exit 0（47 卡）；
  `smoke-test-doc-code-consistency-pre.mjs` 44/0；`red-proof-phase0-t01.mjs` 4/4 绿。
- **字节卫生事故与修复**：`tests/smoke/smoke-test-handoff-pre.mjs` 在编辑后变成 **CRLF**
  （KICKOFF §8 第 6 条要求 `lib/*-pre.js` 与测试为 LF）⇒ 已逐字节转回 LF（315 bareLF / 0 CRLF）
  并复跑套件（53/0）确认内容未损。
  全仓复核：`lib/index.js` CRLF ✓、新模块（memory-envelope / memory-mutation / wb-contract /
  rules-layer）均为 LF ✓、新测试均 LF ✓、**全部改动文件无 BOM** ✓。
  （备注：本仓换行实际是**混合**的——`lib/index.js`、`lib/client.js`、`activation-*`、
  `context-*` 等为 CRLF，`handoff-anchor-pre.js`、`tier-layer-inject-pre.js` 等为 LF；
  纪律的实质是"**不改变既有文件的换行形态**"，本次未对任何既有文件改换行。）
- 卡住：无。
- 下一步：按 KICKOFF §7 输出完整汇报（含"最值得让 GPT 审的三个点"）。
