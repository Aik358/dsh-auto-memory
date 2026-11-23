# 批次3 P3-A1 复核：工程通过，A1b 条件收紧（2026-11-18）

性质：Lead 对 P3-A1 回执的独立复核与追加裁定。**A1 主体工程与证据通过；A1b 三项收紧完成后才放行 P3-B。**

## 0. 结论

| 项 | 结论 |
|---|---|
| A1 主体 | **通过**。触发器接管、水位数组、整帧硬顶/软预算、账本选段优先、回滚物理删除、跨档回落均已核实；我复跑 16 套件退出 0；新运行时套件 11/0（含 11 条负路径/变异）。 |
| R-F 旧控件冻结 | **需要 A1b 立即补**。现在「保存策略后旧节奏/水位控件仍可写」= 假开关，与本项目既有纪律冲突。裁定与写域见 §2。 |
| 第二套 fallback | **需要 A1b 清理**。`policy-runtime.effectiveTriggers` 的 legacy 分支在生产无 saved 时并不被 index 使用（index 走旧 `parseGapRoundsPre`），等于第二份 40/15 实现。 |
| 两个红套件 | **不是 A1 引入，但必须归因落账**：`batch3-cadence-projection` 84/13 是 P1 契约变更后的判据过期；`batch3-final-frame` 的 TypeError 属既存套件缺陷。A1b 一并更新/修复。 |
| 真实宿主 | 仍未验证，A1b 完成后进 P3-B。 |

## 1. Lead 独立核实（本轮）

- 形态：`lib/index.js` 30,415 行 / 2,214,027 B / sha256 f71d8ece… / 纯 CRLF；`lib/client.js` 27,089 行 / 3,019,831 B / sha256 e21eef1b…；`policy-runtime.js` 81 行 / 3,541 B / LF；`policy-v2.js` 444 行 / 27,759 B；`cadence.js` 336 LF 行（原末行无换行 → 计数 337）；生成器 `SYNC-OK`。
- 计数：verify-docs **22 / 87 / 182**；`lib/index.js` 导出 **41**；客户端 14 factory 导出（loadable 34/0）。
- 我复跑退出 0：`delivery-policy-runtime`、`delivery-settings-ui`、`delivery-settings-backend`、`delivery-cadence-contract`、`delivery-policy-v2`、`delivery-diagnostics`、`tiered-branches`（26/0）、`inj4-slim-throttle`、`inj5-step-cadence`（15/0）、`batch3-bd/ca/rp-adapter`、`t1-prompt-sections`（59/0）、`v5-p2-water-pct`（47/0）、`gap-rounds-three-surface`（56/0）、`r26-cross-layer`（26/0）。
- 独立探针：`parseWaterThresholds([]) === []`、`undefined === [25]`；`legacyToPolicy({fullInjectWaterPct:'25.5'})` 得 `[25.5]` 不抛错；saved `human_slim(summary)` 下 `human_full` 解析成功且 representation 回落 `full/omit`，显式 `human_full+summary` 仍拒绝；`_grantByHuman` 仍为 false（24862 行）。
- 787 夹具：原文 1,679 → 三段投影 1,625（无 state）；我按「选段后预算」复算确认 state 不会回流，生产新闭包返回 731 字符 / 793 字节且保留 FAILURE-END / NEXT-STEP（回执 + 套件 04 一致）。
- A1 未夹带模块接线：`lib/index.js` 中 `policy.modules.*` 只出现 diagnostics 与能力回显；模块/视图/配额仍未消费。UI 分页标注已核实（policy-settings.js:194-208）。

## 2. R-F 裁定：条件冻结旧控件（A1b 必做）

**触发条件**：磁盘上存在有效 `deliveryPolicy`（saved 源）时，A1 已接管的旧控件必须**只读冻结**；删除策略后恢复可编辑。

**冻结集合（恰好这 7 个，A1 已接管）**：
`injectEnabled`、`snapshotMinGapRounds`、`slimEveryRounds`、`fullInjectWaterPct`、`snapshotTieredInject`、`hangCompensateEnabled`、`hangCompensateTokens`。

**冻结表现**：只读显示当前旧值 + 「已由投递策略接管」，并提供跳转到策略页与「删除策略恢复旧设置」入口（用现有删除回滚），不得可编辑、不得调用 `set()` 写旧键。

**不冻结**：13 个 `promptSectionToggles`（仍是唯一权威）、模块/事件/白板/账本等 A2 未接管键、两个死键（保持只读历史行）。

**实现与写域（A1b 批准）**：
- 单一冻结清单常量（前端共享源，三面共用）；`skins/iter5/policy-settings.js`（生效状态与跳转/回滚 UI）、`lib/client.js` 手写 `SettingsPage` 区、`skins/legacy/iter5-325.js.frozen`；经生成器重建到 `SYNC-OK`。
- 判定用「策略是否存在」这一个状态源：`/config` 外层 `deliveryPolicy !== null`（或与 saved 源等价的稳定字段），不得在前端另造状态。
- 测试（真执行 + 负路径）：saved 策略下 7 键不可编辑且无 `set()`；删除策略后 7 键恢复可编辑；无策略时仍可编辑；冻结清单与后端接管集合**同源**（在套件中静态比对两处常量，失配必红）。

## 3. A1b 第二项：删除第二套 fallback

`effectiveTriggers` 的 legacy 分支（`policy-runtime.js:40-49` 的 40/15/[25] 解析）在生产 `index.js` 的无策略路径**没有被使用**（index 走旧 `parseGapRoundsPre` 以保持逐字节等价）。保留即第二份默认值实现，后续必然漂移。

**裁定**：把 `effectiveTriggers` 收窄为 **saved-only**（无 saved 返回 null 或抛明确错误），legacy 兜底由生产旧解析独占；如需给兼容/预览页展示派生值，用单独命名函数（如 `legacyTriggersForDisplay`）并明确标注「仅供展示，不参与生产」。不得两份实现都叫 effective。

## 4. 两个红套件的归因与处置（A1b 一并）

**4.1 `smoke-test-batch3-cadence-projection.mjs` 84/13**
- 归因：**判据过期**，不是 A1、也不是新缺陷。我把同一组用例补上 `signals:{isHumanTurn:true}` 后：`'25,50'` 得 `water-50`、`'abc'` 回落 `water-25`、自定义 70 得 `water-custom`——全部通过。P1 已把 CA 水位改为「必须真人信号才授予」（与生产 `:24634-24646` 一致），该套件的 CA 段仍按旧契约构造（无 human 信号）。
- 处置：A1b 更新 CA 段夹具到当前契约（加真实 human 信号；负路径改为「无 human 信号不得授予」），**不得回退生产行为**；更新后的断言必须仍覆盖 R5/水位语义。
- 责任记录：P1 验收时我只跑了 cadence-contract/adapter 等，未跑此套件，属 Lead 验收缺口；本次补跑并归因。

**4.2 `smoke-test-batch3-final-frame.mjs` 80/4 后 TypeError**
- 事实：`lib/injection/final-frame.js` 与 `dto.js` 在 A1 未变（sha `0468ce420cdcba17`、`5405094cc458c01b`）；`batch3-final-frame` 首个失败与 A 批 r2 复审记录同一行（line 69）；我复跑同一 `TypeError: Cannot read properties of undefined (reading 'versions')`（line 248，`store.mem['r-1']` 未建立）。
- 归因：**既存套件缺陷**（fixture 依赖旧 commit 形状），不在 A1 修复范围，但不得长期红着。A1b 修复套件或按新契约重建 fixture，并在回执写明根因；若判定为产品缺陷则单独升级。

## 5. 其他清理（A1b 顺手，不阻塞行为）

- 仓库内残留临时物：`artifacts/._p1i.mjs.99768.*.tmpdir/`、`artifacts/probe_classiclf.mjs`、`cases/`。按既有清理纪律先 grep 引用 + `git cat-file -e HEAD:<path>`，再删/移；不得把临时目录带进提交。
- `git diff --check`：默认 1,255 条为 CRLF 在 `eol=lf` 下的 CR 假红；`core.whitespace=...,cr-at-eol` 退出 0。回执已写明口径，接受。

## 6. A1b 验收与放行

A1b 完成后 Lead 复跑：生成器 SYNC-OK、22/87/182/41/14；runtime 11/0；UI（含冻结/解冻正负路径）全绿；`batch3-cadence-projection` 更新后全绿；`batch3-final-frame` 修复后全绿或明确降级为「已知产品缺陷」并附证据；r26 按 actual 重钉；`effectiveTriggers` 无双实现（源码/契约断言）。

**A1b 通过后放行 P3-B**：真实 DSH 宿主重启、三入口 a11y/截图、真实会话注入、全量回归（--jobs=8 --timeout=180000）。
