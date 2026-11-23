# 批次 3 P3-A2 U3a Phase 0 测绘回执

日期：2026-11-20

阶段：只读测绘完成；按任务书 §1 发现前置假设冲突，暂停编码。

基线：HEAD `23646c04`；本轮仅新增本回执，没有修改生产代码、测试或生成源。

## 结论

任务书假设注入入口可直接取得六个 adapter 所需的结构化来源，并能把 shadow receipt 放进 renderer 内部的 diagnostic part。当前实现不满足这两项条件：入口拿到 per-agent runtime state 和 renderer 输出字符串；events 与 portrait 的结构化原料在已有刷新中只作为局部变量使用，规则聚合也是局部结果。Renderer 在内部组装诊断段，但入口调用后只取得最终 `snap` 字符串。

依照任务书 §1，**停止在 Phase 0，不实施 U3a**。不能用额外磁盘读取、重复 refresh、解析已渲染正文或在最终字符串后追加诊断行来掩盖来源和插入接口缺口。

## 1. 每轮注入入口

生产入口是 `lib/index.js:23994` 注册的 `ctx.systemPrompt.context({ text: (context) => ... })`。回调在 :23997 取得 `context.agent`；调用 `engine.withAgent(agent, ...)` 后，在 :24017 获取当前 agent 的 `st = engine.stateFor(agent)`。档位计算后，:24172 执行 `const snap = engine.renderMemoryDynamic(context)`。

当前可直接拿到 `context`、`agent`、per-agent runtime `st` 和 `engine.config`。`snap` 是 renderer 返回的最终字符串，不是来源 DTO。没有发现 `st.sources` 或含六类来源的统一对象。

## 2. 六源形状与实际数据

U1/U2 adapter 当前契约（`lib/injection/unit-adapters.js`）：`adaptEvents({events})`；`adaptRules({dtoKind:'RulesAggregate', rules, notes, candidates, references, retired, maintenance?})`；`adaptPlan({planSpec:{current,recent,constraints,todos}})` 或等价 sections；`adaptHandoff({sections:[{title,body}]})`；`adaptPortrait({portraitItems})`；`adaptCalendar({entries})`。定义位置分别为 :83、:152、:193、:241、:262、:286。

| 来源 | Adapter 需要的结构 | 生产刷新 / state 中当前形状 | 判断 |
|---|---|---|---|
| events | `events[]`，含 id/status/sections/checkpoints | `refreshEventStatePre()` 的 events 是 :10427 局部变量；保存的是 `eventCardsText`、`eventCatalogText`、`slimEventT1` 投影（:10430、:10442-10451、:10506）。源码 :10438-10440 明确不把完整事件对象长期放入 state，以免大量检查点常驻内存。 | 入口无原始 events。重读 store 或重复 refresh 违反限制。 |
| rules | `RulesAggregate` 五数组及可选 maintenance | `_rl = extractRulesLayerPre(...)` 在 :10523 起局部构造；state 只留 `_slimRuleCountPre` 等投影或最终文本，无 aggregate 字段。原料为 `userText` / `notesText`。 | 无现成 aggregate；重算可能不读盘，但会新增热路径解析成本，是否允许未裁定。 |
| plan | 四节 spec 或有 key/text 的 sections | runtime 持有 `planText` 字符串（赋值 :9692），不是 section DTO。 | 只有文本，无统一结构化 source。 |
| handoff | `sections[]`，含 title 与 body lines | runtime 持有 `latestHandoffText` 字符串（:9683、:9693-9697），不是 adapter 的四段数组。 | 只有文本，无统一结构化 source。 |
| portrait | `portraitItems[]`，含 kind/stage/text/identity | portrait 从局部 events 的 `userPercept` 汇总（:10553-10559），之后只存 `userPortraitText`、计数和排除数（:10560-10562）。 | 原始条目未留在 state，文本无法还原身份和阶段。 |
| calendar | `entries[]`，含 date/time/quadrant/title/note/done | runtime 有 `calendarText`（state 字段 :3104）；renderer 在 :13650-13653 调 `parseCalendar()` 生成当前注入条目。 | 无预组装 DTO；复用解析器作为 adapter 输入需裁定。 |

事件刷新只读取一次 store（:10417-10427），但没有把 adapter 所需的完整事件/画像 DTO 保存到 state。`snapshotEvents()` 是会话事件流，并非记忆事件 store，不能替代。

## 3. `_injectTierPre` 到 U1 phase

`INJECT_TIERS` 在 `lib/index.js:1927` 定义，callback 在 :24160 写 `_injectTierPre`；U1 selector 允许值见 `lib/injection/unit-policy.js:5-8`。八个值直接同名映射：

| `_injectTierPre` | U1 phase |
|---|---|
| `human_full` | `human_full` |
| `human_slim` | `human_slim` |
| `run_full` | `run_full` |
| `run_slim` | `run_slim` |
| `post_compact` | `post_compact` |
| `handoff_carry` | `handoff_carry` |
| `hang_compensate` | `hang_compensate` |
| `legacy` | `legacy` |

未知或缺失 tier 没有单独映射裁定；`selectUnits()` 拒绝不在 phase 列表中的值。虽然 shadow 捕获可避免注入失败，fallback 与 degradation 口径仍需明确。时序方面，主 `snap` 在 :24172 生成；随后 :24195-24205 会将普通档 state 临时改为 slim 并生成 `slimText`。若要描述最终送出的候选帧，须明确按两个候选分别 shadow，或只按最终选中的候选计算，不能默认 :24160 的 tier 总等于最终帧 tier。

## 4. 预算来源与计量

| 值 | 位置 | 单位 / 说明 |
|---|---|---|
| `engine.config.injectBudgetChars` | callback 可读；默认值 `lib/index.js:920` = 8000 | 字符，是 `cost.jsChars` 的口径候选。 |
| 最终 `budgetChars` | renderer `lib/index.js:13716` | `Math.max(Number(cfg.injectBudgetChars) || 1600, 400)`；全帧 envelope 字符预算，但为 renderer 局部变量。 |
| `_slimBudget` | `lib/index.js:12980` | `fullInjectSlimBudgetChars` 字符预算，默认 3000。 |
| `_fullTierBudget` | `lib/index.js:12982` | 完整档白板预算，来源 `injectBudgetChars` 且不低于 slim；不在 callback scope。 |
| `_ledgerBudget` | `lib/index.js:13162` | 账本子段字符预算，不是全帧预算。 |
| Tier-0 | 例如 `lib/index.js:10399` | token 预算，不得传给 `cost.jsChars`。 |

callback 只能直接读配置，不能访问 renderer 的 `_slimBudget`、`_fullTierBudget` 或最终 `budgetChars` 局部变量。若 shadow 预算代表全帧 envelope，须明确由配置推导并说明锁定段是否计入，不能误用白板/账本子预算。

## 5. 诊断插入点

诊断正文在 `renderMemoryDynamic()` 的 :13702-13709 构造：digest 通过 `pushPart('otherDynamic', 'diagnostic', ...)` 加入 envelope。callback 在 :24172 调用 renderer 后只得到完整字符串 `snap`。

- 在 callback 对 `snap` 追加行会把它放在 diagnostic part 外，不符合 §3.3。
- 必须在 renderer 的 diagnostic `pushPart` 前提供 receipt；当前没有 receipt 入参/通道。
- 需定义同步、幂等、无持久副作用的 receipt 传递方式，以及 shadow 失败/两次 text callback 时的清理语义。

诊断传递缺口与结构化 source 缺口相互独立；只解决其中一个仍不足以实施。

## 6. 配置键与锁清单

只读实测：`node tools/verify-docs.mjs` 为 **22 工具 / 87 路由 / 182 配置键，五份文档全部一致**；`node tests/smoke/smoke-test-r26-cross-layer.mjs` 为 **PASS 26 / FAIL 0**。本轮没有新增 `unitPolicyMode`，当前仍为 182。

| 锁 / 写入面 | 当前证据 | 获批实施后的动作 |
|---|---|---|
| `DEFAULT_CONFIG` | `lib/index.js:807`；当前实测 182 | 新增 `unitPolicyMode:'off'` 后预计 +1，以实际计数确认。 |
| `/config` 白名单 | `lib/index.js:29328` 使用 `Object.keys(DEFAULT_CONFIG)` | 新键会自动放行；枚举值校验需另加。 |
| settings patch validator | `lib/settings-safety.js:16` 起；无 `unitPolicyMode` 校验 | 明确拒绝未知值及 `on`，返回任务书指定错误消息。 |
| r26 | `tests/smoke/smoke-test-r26-cross-layer.mjs:1065-1074` 锁 `lib/index.js` CRLF→LF 长度 **1,652,347**；:1090 锁路由 **87**。本次 **26/0**。 | index 有意改动后按套件实际值重钉长度；r26 长度锁不等于配置键数锁。 |
| `verify-docs` | `tools/verify-docs.mjs:49` 从源码实数；校验 `docs/WHITEPAPER.md`、`docs/HOMEPAGE-CONTENT-FOR-GM53.md`、`docs/FRONTEND-CO-CREATION.md`、`README.md`、`README.zh-CN.md` | 随实际总数同步所核的五份文档。 |
| 固定快照 | `docs/internal/FEATURE-INVENTORY.md:11` 写死 182 | 新键获批后更新当前快照，保留历史数字。 |
| README 总览 | `README.md:688`、`README.zh-CN.md:684` 写 182，且由 `verify-docs` 校验 | 随实际总数更新。 |

`r26` 当前锁 index 归一化长度和路由等判据，不是 182 配置键断言。未检出单独硬编码 182 的 smoke 配置计数测试；若要新增，应确认是否与 `verify-docs` 重复。

## 阻塞项与待裁定事项

| 事项 | 事实 A | 事实 B | 需先裁定 |
|---|---|---|---|
| sources 生命周期 | U3a 要每轮调用六 adapter，且禁止重复 IO/refresh。 | 当前入口无六源 DTO；原始 events 与 portrait items 在刷新后已丢弃。 | 哪一层在既有 refresh 中提供有界 DTO，或是否调整 source/adapter 契约；同时定内存上限、保留周期、agent 隔离和 refresh 失败语义。 |
| diagnostic 传递 | 诊断行只能进 renderer 的 diagnostic part。 | part 在 renderer 内部生成，callback 只拿最终字符串。 | 定义同步、幂等、无持久副作用的 receipt 接口和接入点。 |
| shadow phase | selector 接受八个 phase，入口有 full/slim 候选生成时序。 | 单次读 `_injectTierPre` 可能不等于最终选中候选的 phase。 | 明确对两个候选分别 shadow，还是只对最终送出的候选计算。 |
| 配置/锁更新 | 新键会使配置数由 182 增加，index 改动会影响 r26 长度锁。 | §1 要求发现假设冲突即停手。 | source 与诊断接口裁定后再开工并同步锁，本轮不预先更改。 |

在裁定前不运行 U3a S-01..S-09、MV-01..MV-04 或全量回归，因为 `unit-shadow.js` 和入口接线未实现；不把 U1/U2 测试结果冒充 U3a 验收。

## 本轮范围与验证

- 新增：本回执。
- 未改：`lib/index.js`、`lib/injection/**`、`lib/client.js`、`skins/**`、测试、生成器与计数锁。
- 实测：`node tools/verify-docs.mjs` → **22/87/182，全部一致**。
- 实测：`node tests/smoke/smoke-test-r26-cross-layer.mjs` → **PASS 26 / FAIL 0**。
- 未执行：U3a 单测、变异、完整 smoke 回归、`build-iter5-skin`；当前停止于 Phase 0。
- 未验证：真实 DSH 宿主 a11y / 截图；U3a 无 UI，且本轮未做宿主验证。
- 未实现：`on` 接管与 `deliveryModule` 实产，留待后续任务。
