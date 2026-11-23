# 设置页契约与信息架构

> ★P2 范围与守卫补充（2026-11-18）：`docs/internal/DECISIONS-BATCH3-P2-SCOPE-20261118.md`（三副本一致性、单一实现 + props 挂载、新增 10 条守卫）。冲突时以该文件为准。

## 1. 现状事实（已核）

- 插件设置组件同一份注册三处：`settings.section`、`settings.plugins.tab`、`plugins.detail.section`（`lib/client.js:25983-26010`、`:26065`）。
- 用户可关分区 **13 键**，真源 `lib/index.js:1645 PROMPT_SECTION_KEYS_PRE_V1`；前端 `PROMPT_SECTION_TEXT`（`lib/client.js:24584`）只是文案镜像，**不得自造键**；must 段 2 个（`:1666`）。
- 节奏：`snapshotMinGapRounds` 20→40、`slimEveryRounds` 8→15（迁移由 P1 负责）。
- 诊断：`diagLogFile()`（`lib/index.js:2622`，2MB 轮转保留 1 份）；注入面当前 `diagnostic: null`（`projection.js:47`），本批由 P1 提供 provider，**默认关闭**。
- 废弃键：`slimPlanChars`/`slimLedgerChars`（`:1024` 注释），从 UI 移除。

## 2. IA：入口 + 7 个子页

**入口卡片**：预设名、启用模块数、slim/full 节奏、总预算、诊断开/关。

1. **预设与节奏**：4 内容档（human_full / human_slim / run_full / run_slim）；8 档映射只读表（post_compact / handoff_carry = human_full + override；hang_compensate = run_full；legacy 锁定）；slim 15 / full 40 / 水位 25（50 可选，默认关）/ 压缩后重注入。
2. **模块**：11 生产者（rules 含 maintenance、recentLogs 吸收 logs、semantic、events、portrait、plan、handoff、calendar、externalMemory、workspaceMap、reflection）+ 锁定段（user-memory / project-notes，显示不可关）。每行展开：启用 / 视图 / 数量配额 / 单段预算 / 优先级。
3. **预算与超额**：全局传输（jsChars / utf8Bytes；token 无计量器置灰）、hard/soft、fallback 顺序、装不下时行为（压缩表示 / 指针 / 省略 / 明确失败）。
4. **触发**：真人、压缩后首轮、水位阈值、slim 15 / full 40、首帧/交接、挂机补偿。
5. **诊断**：**默认关闭**；开启后窗口（24h/7d）与条数（≤5）；脱敏说明（只显示 code+计数，不显示路径/正文）；「打开本地诊断日志」只读入口。
6. **预览与回执**：选场景 → 文本长度、模块/事件/检查点计数、full/summary/preview/pointer 分账、omitted、violations；`partial:true` 时必须显示「部分结果」。
7. **兼容**：旧散键只读映射 + 迁移状态 + 「迁移到策略」（幂等）+ 回滚说明。

## 3. Policy v2 数据模型（前端只读写这个形状）

```js
{
  schemaVersion: 2,
  presetId: "human_full",
  modules: {
    rules:    { enabled: true, view: "full", priority: 100,
                quotas: [{ unit: "rule", scope: "delivery", max: 50, strength: "hard" }],
                transport: { jsChars: 2000 } },
    events:   { enabled: true, view: "cards+catalog", priority: 70,
                quotas: [{ unit: "event", scope: "delivery", max: 2, strength: "hard" },
                         { unit: "checkpoint", scope: "event", max: 3, strength: "hard" }] },
    recentLogs: { enabled: true, view: "tail", priority: 20, aliases: ["logs"] },
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

校验：未知字段/unit/view/preset 拒绝；非负安全整数；hard 不得带 overflowAllowance；human_full 下检查点表示只允许 full|omit。

## 4. 预览 API

`POST /api/dsh-auto-memory/delivery-preview`（沿用现有鉴权）：
请求 `{ policy, tier?, isHuman?, isFull? }` → `{ text, chars, receipt:{retained, counts, omitted, violations}, partial }`。
纯函数、只读、确定性；相同输入 byte-equal；不消费水位/通知/压缩状态。

水位默认要求：policy 缺省 `triggers.waterPct = [25]`；前端编辑器初始值、placeholder、说明文案必须与后端 `'25'` 一致；旧默认 `'25,50'` 只按版本戳迁移一次。
路由未就绪时用 mock 并显式标注「预览为模拟数据」。

## 5. 旧键处置与迁移

| 类别 | 键 | 处置 |
|---|---|---|
| 节奏 | snapshotMinGapRounds / slimEveryRounds / snapshotTieredInject / snapshotReinjectOnCompact | 迁入新模块 |
| 内容 | injectEnabled / promptSectionToggles / handoffEnabled / tier0CatalogEnabled | 迁入新模块 |
| 预算 | injectBudgetChars / fullInjectSlimBudgetChars / handoffPlanChars / handoffLedgerChars / handoffPlanSectionMax / eventMaxActiveInInject / eventCatalogChars / slimCheckpointCount / fullInjectSemanticChars / externalInjectionChars / recentDaysInjected | 迁入新模块 |
| 废弃 | slimPlanChars / slimLedgerChars | 从 UI 移除，键值保留 |
| 水位 | fullInjectWaterPct | 迁入新模块；默认 '25'，显式 '25,50' 保留；旧默认残留一次性迁移（waterPctDefaultsVersion） |
| 其他子系统 | procedureInjectEnabled / globalBriefChars / maxPacketItems / maxPacketChars / injectionCooldownSteps / softInjectionEnabled / teamInjectEnabled / promptLayerOverrides | 保留原处，不并入 |

单一写入源：`deliveryPolicy`；旧键只读影子；首次保存才写 policy；删除 policy 即回滚。
- **实测无消费者/无效的键只读展示**：`handoffPlanChars`（读入未用）、`externalInjectionChars`（配置对注入无效）、`slimCheckpointCount`（无消费者）、`slimPlanChars`/`slimLedgerChars`（已废弃）。不得新造可编辑却无效的控件；兼容页标注「当前无效（历史键）」。
