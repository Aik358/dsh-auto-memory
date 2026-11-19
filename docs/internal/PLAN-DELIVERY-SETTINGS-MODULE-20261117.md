# 投递策略设置模块：设计与迁移方案

日期：2026-11-17。状态：设计定稿，未改代码。执行者：GPT（P1 后端 → P2 前端），验收者：Lead。

## 0. 范围

**做**：一个「投递策略」大模块（替换零散投递设置）+ 后端最小支撑（Policy v2 契约/存储/预览路由/诊断 provider/双节奏默认与迁移/账本 run_full 降 slim）。
**不做**：不发布、不 push；不重写整个注入引擎（unit-policy 引擎按 U0/U1 另批）；不改 2.3/2.4；不重构皮肤；不引入第三方插件依赖；不新增遥测/网络请求。

## 1. 现状测绘（已核）

- 设置入口三处共用同一组件：`lib/client.js:25983-26010`（`settings.plugins.tab` / `plugins.detail.section`）、`:26065` 注释（`settings.section`）。
- 用户可关注入分区 **13 键**：`lib/index.js:1645 PROMPT_SECTION_KEYS_PRE_V1`；其中 must 段 2 个（`plan-update-request`、`water-advisory`，`:1666`）。前端文案镜像 `PROMPT_SECTION_TEXT`（`lib/client.js:24584`）。
- 节奏默认：`DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS = 20`（`:628`）、`slimEveryRounds = 8`（`:1177`）；迁移在 `:4147-4185`，两条各自独立版本戳。
- 账本档位：`_LEDGER_FULL_TIERS`（`:13130`）含 run_full。
- 日志唯一生产者：`recentLogTails`（`:9464`，每天 `truncateTail 700`）、注入点 `:9632`；`projection.js:40,44` 两段同映射 `recent-logs`。
- 诊断：`diagLogFile()`（`:2622`，`dsh-auto-memory-diagnose.log`，2MB 轮转、保留 1 份）、`diag()`（`:2649`）；`projection.js:47 diagnostic: null`，注入面零生产者。
- 散键：`DEFAULT_CONFIG` 区段实测 29 个与注入内容/预算/节奏直接相关；其中 `slimPlanChars`/`slimLedgerChars` 已被 `:1024` 注释标记废弃。

## 2. 旧设置处置表

| 键 | 默认 | 语义 | 处置 |
|---|---|---|---|
| snapshotMinGapRounds | 20 | 完整帧间隔 | 新模块·节奏，默认改 **40** |
| slimEveryRounds | 8 | 精简帧间隔 | 新模块·节奏，默认改 **15** |
| snapshotTieredInject | true | 分级注入开关 | 新模块·节奏 |
| snapshotReinjectOnCompact | true | 压缩后重注入 | 新模块·触发 |
| fullInjectWaterPct | "25"（50 档默认关闭） | 水位阈值；显式 "25,50" 保留 | 新模块·触发（字符串→数组；旧默认残留一次性迁移） |
| hangCompensateEnabled / hangCompensateTokens | false / 300000 | 挂机补偿 | 新模块·触发（高级） |
| injectEnabled | true | 注入总开关 | 新模块·总开关 |
| promptSectionToggles | {} | 13 段开关 | 新模块·模块（映射 13 键） |
| injectExcludeSources | [] | 排除来源 | 新模块·模块（高级） |
| injectBudgetChars | 8000 | 全局预算 | 新模块·预算 |
| fullInjectSlimBudgetChars | 3000 | slim 预算 | 新模块·预算 |
| handoffEnabled | true | 白板/账本总开关 | 新模块·模块 |
| handoffPlanChars / handoffPlanSections / handoffPlanSectionMax | 1200 / null / 2000 | 白板预算与选节 | 新模块·模块/预算；**handoffPlanChars 实测读入 `_fullBudget` 后无下游消费 ⇒ 只读兼容，不造可编辑控件** |
| handoffLedgerChars | 800 | 账本预算 | 新模块·预算 |
| eventMaxActiveInInject / eventCatalogChars / eventCatalogRecentClosedDays / slimCheckpointCount | 2 / 400 / 14 / 3 | 事件 | 新模块·模块·events；**slimCheckpointCount 仅定义无消费者 ⇒ 只读兼容** |
| fullInjectSemanticChars | 800 | 语义召回 | 新模块·模块·semantic |
| externalInjectionChars | 1400 | 外部记忆 | **实测配置对注入无效（`index.js:13579-13581`）⇒ 只读兼容展示** |
| tier0CatalogEnabled / tier0MaxTokens / tier0BudgetShare | true / 600 / 0.25 | Tier-0 目录 | 新模块·「内部段（只读/高级）」 |
| recentDaysInjected | 1 | 最近日志天数 | 新模块·模块·recentLogs |
| promptLayerOverrides | {} | 层级覆盖 | 保留原处（高级） |
| slimPlanChars / slimLedgerChars | 400 / 300 | 已废弃 | **从 UI 移除**（保留键值兼容） |
| procedureInjectEnabled / globalBriefChars / maxPacketItems / maxPacketChars / injectionCooldownSteps / softInjectionEnabled / teamInjectEnabled | — | 其他子系统 | 保留原处，不并入 |

**纪律**：迁移前对每个键做「读写点普查」（`grep -n "keyName"`），标记 dead/effective；dead 键在文档中列明，不得静默搬进 UI 造成假开关。

## 3. 目标 IA（入口 + 7 个子页）

**入口卡片**（一级）：预设名、启用模块数、slim/full 节奏、总预算、诊断开/关；点击进入。
**子页**：
1. **预设与节奏**：4 内容档（human_full / human_slim / run_full / run_slim）；8 档映射只读表（post_compact/handoff_carry 复用 human_full + override；hang_compensate 复用 run_full；legacy 锁定）；slim 15 / full 40 / 水位 / 压缩后重注入。
2. **模块**：11 生产者表格 + 2 锁定段；行内展开编辑：启用 / 视图 / 数量配额 / 单段预算 / 优先级。
3. **预算与超额**：全局传输（jsChars / utf8Bytes；token 无计量器时置灰并提示）、hard/soft、fallback 顺序、装不下时行为。
4. **触发**：真人、压缩后首轮、水位阈值、slim/full 间隔、首帧/交接。
5. **诊断**：默认关闭；开启后选窗口（24h/7d）与条数（≤5）；脱敏说明；「打开本地诊断日志」只读入口（走面板，不发网络）。
6. **预览与回执**：选场景 → 文本长度、模块/事件/检查点计数、full/summary/pointer 分账、omitted、violations。
7. **兼容**：旧散键只读映射 + 迁移状态 + 「迁移到策略」（幂等，可回滚）。

## 4. Policy v2 数据模型

```js
{
  schemaVersion: 2,
  presetId: "human_full",
  modules: {
    rules:  { enabled: true, view: "full", priority: 100,
              quotas: [{ unit: "rule", scope: "delivery", max: 50, strength: "hard" }],
              transport: { jsChars: 2000 } },
    events: { enabled: true, view: "cards+catalog", priority: 70,
              quotas: [{ unit: "event", scope: "delivery", max: 2, strength: "hard" },
                       { unit: "checkpoint", scope: "event", max: 3, strength: "hard" }] },
    recentLogs: { enabled: true, view: "tail", priority: 20, aliases: ["logs"] },
    // ... 11 生产者
    diagnostics: { enabled: false, windowHours: 24, maxLines: 5 }
  },
  lockedModules: ["user-memory", "project-notes"],
  transport: { jsChars: 16000, utf8Bytes: 48000 },
  representation: { preferred: "full", fallback: ["summary", "preview", "pointer", "omit"] },
  triggers: { human: "always", postCompact: "always", waterPct: [25],  // 默认只 25；显式 "25,50" 保留
              slimEveryRounds: 15, fullGapRounds: 40 },
  presetOverrides: { post_compact: { notice: true }, handoff_carry: {}, hang_compensate: {} }
}
```

校验：未知字段/unit/view/preset 拒绝；非负安全整数；`hard` 不得带 `overflowAllowance`；`human_full` 下检查点表示只允许 `full|omit`。

水位默认：`triggers.waterPct` 缺省 `[25]`（50 档默认关闭，依据 2026-11-17 CA-AD1 裁定与 CONSTRUCTION-PLAN 3.0.3）；显式 `'25,50'` → `[25,50]`，`'off'/'0'` → `[]`，自定义列表保留。旧默认残留迁移见 §6-6。

## 5. 后端最小支撑（文件布局）

| 文件 | 职责 |
|---|---|
| `lib/injection/policy-v2.js` | PRESETS / MODULE_REGISTRY / DEFAULT_POLICY / validatePolicy / resolvePolicy({tier,isHuman,isFull,overrides}) / legacyToPolicy(config)（幂等、纯函数） |
| `lib/injection/preview.js` | `previewDelivery({policy, sources, tier, isHuman, isFull})` → `{text, chars, receipt:{retained, counts, omitted, violations}, partial}`；只读、不消费状态；unit 引擎未接前可基于现有 PJ+FM 组合，`partial:true` 明示 |
| `lib/injection/diagnostics.js` | `readDiagnosticDigest({enabled, file, now, windowHours, maxLines, readFile})`；关闭时**不读文件**、返回零；开启时只输出 code+count，脱敏正则 `[a-z0-9:_-]{1,40}` |
| `lib/index.js`（薄接线） | DEFAULT_CONFIG 增 `deliveryPolicy`；保存时校验；预览路由；诊断注入（normal 优先级、上限 300 字符）；`_LEDGER_FULL_TIERS` 移除 run_full；双节奏默认与迁移版本戳 |
| `lib/injection/cadence.js`（有限写域） | 返回体增 `isHuman`；内部 fallback 20→40、8→15；修正 41-43 过期注释。不改 tier 判定、不回退真人旁路 |
| `lib/injection/dto.js`（有限写域） | `makeCadenceDecision` 增 `isHuman` 布尔（缺省 false 兼容旧调用）；不新增 DTO/导出 |
| 路由 | 新增 `POST /api/dsh-auto-memory/delivery-preview`（沿用现有鉴权与错误协议），注册处与计数锁同步 |

**不改**：`renderMemoryDynamic` 的既有内容算法（除诊断一行与档位默认值）；不重写 EV/RP/BD/FM；不碰 `lib/client.js` 生成器逻辑本身。

## 6. 迁移与兼容

1. `deliveryPolicy` 是**唯一写入源**；旧键保留为只读影子（本批不删，可回滚）。
2. 读取优先级：`deliveryPolicy` 存在 → 用它；不存在 → `legacyToPolicy(config)` 派生（内存中，不落盘）。
3. 首次保存才写 `deliveryPolicy`；**禁止双写**；兼容页展示「当前值来自旧键」。
4. 回滚：删除 `deliveryPolicy` 即回到旧键生效。
5. 计数锁：配置键 +1、路由 +1；更新 `docs/internal/FEATURE-INVENTORY.md`、`PROMPT_SECTION_TEXT`（若涉及）与校验文档；以校验器报出的 actual 为准，不手算。
6. 水位旧默认迁移：新增独立版本戳 `waterPctDefaultsVersion`；未打戳且磁盘值恰为旧默认 `'25,50'` → 迁移为 `'25'` 并记录 degradation `waterPct-old-default-migrated`；`'25'`、`'off'`、`'0'`、自定义列表一律不动。兼容页展示迁移结果。

## 7. 施工顺序

| 阶段 | 内容 | 出口 |
|---|---|---|
| P1 后端 | policy-v2 / preview / diagnostics / cadence+dto 有限补字段 / DEFAULT_CONFIG+路由+迁移+账本降级 | 单元与契约测试绿；预览纯函数确定性 |
| P2 前端 | 大模块 IA + 7 子页 + 预览 UI + 旧控件移除/折叠 | `build-iter5-skin --check --strict` → SYNC-OK；真 factory |
| P3 验收 | 设置往返、预览一致、诊断默认关、负路径、a11y、真宿主 | A1–A14 全过 + 截图 |

## 8. 验收（A1–A14）

1. `node tools/build-iter5-skin.mjs --check --strict` → SYNC-OK。
2. 真执行 factory（vm 最小宿主）并断言新分区注册。
3. 设置往返：开关/视图/数字各一，保存→重载→值一致。
4. 非法值拒绝：未知字段/unit/view、负值、小数、hard+allowance。
5. 预览 byte-equal 与确定性；预览不写状态。
6. 节奏：模拟 100 步 slim ≤7、full ≤3；真人旁路/水位不受影响。
7. 账本：run_full 不含「任务状态」段、≤800；human_full 不变。
8. 日志：预览中 `recent-logs` 至多 1 个候选；双开被拒/合并。
9. 诊断：默认关闭 → 零字节且**不读**诊断文件；开启有错误 → 只含 code+计数；开启无错误 → 零字节。
10. 旧键不双写：保存后磁盘只多 `deliveryPolicy`，旧键值不变。
11. 旧控件消失或折叠为只读；同一语义无两个可编辑控件。
12. 无网络：除本地预览路由外无请求；无遥测。
13. 行尾/体积/导出面：按目标文件基线；`node --check` + 真 import。
14. 真实宿主：a11y 树 + 截图（设置页三个入口至少各看一次）。

## 9. 风险与回滚

- 预览 `partial:true` 时 UI 必须显式标注「部分结果」，不得冒充完整验收。
- 旧键影子期最长一个批次；U3 迁移完成后单独提案删除。
- 若前端生成器与手写区冲突，以 skill 02 的锁清单为准，不得绕过生成器。
