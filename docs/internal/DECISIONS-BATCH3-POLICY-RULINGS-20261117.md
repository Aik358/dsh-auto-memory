# 批次3 投递策略裁定（2026-11-17 · 终版）

性质：用户裁定 + 实测调查 + 前端交付要求。是 U0 契约 v2 与前端任务书的输入，**尚未改代码**。

## 0. 裁定一览

| # | 裁定 | 状态 |
|---|---|---|
| R1 | 账本 run_full 改走 slim 三段视图 | 定 |
| R2 | 双节奏翻倍：slim 8→15、full 20→40 | 定 |
| R3 | 日志/最近日志只保留一个（重合 100%） | 定 |
| R4 | 诊断段做成可选功能，**默认关闭**，设置里可开 | 定 |
| R5 | human_slim 可达（真人可 slim） | 定 |
| R6 | 前端任务包（3 skills + 契约 + 验收） | 已打包 |
| R7 | 设一个大「投递策略」模块替换零散投递设置，二级菜单 + 细节编辑 | 定 |
| R8 | 水位默认只保留 25 档（50 默认关闭）；显式自定义保留；旧默认残留一次性迁移 | 定 |

## 1. R1 账本 run_full → slim 视图

- 改动点：`lib/index.js:13130` `_LEDGER_FULL_TIERS` 移除 `'run_full'`。
- 效果：run_full 账本从四段全量 → slim 白名单：`goal` + `type:dead-end` + `type:progress`。
- 保留：human_full / post_compact / handoff_carry / hang_compensate / legacy 仍 full；legacy 有 `memLegacy` 截流优先（单节 800 / 总 2400）。
- 不变：`handoffLedgerChars` 默认 800 仍为硬预算，`_finish` 取较短者。
- 验收：run_full 账本不含「任务状态」段、含失败原因与下一步、≤800；human_full 逐字节不变；全仓检索 `_LEDGER_FULL_TIERS` 的测试与文档逐项更新。

## 2. R2 双节奏：slim 8→15，full 20→40

**实测配置（本机生产 `dsh-auto-memory.json`，180 键）**：`slimEveryRounds=8`、`snapshotMinGapRounds=20`；历史实测文档一致（精简帧约每 8 步、完整帧每 20 步）。

**裁定**：
- `DEFAULT_SLIM_EVERY_ROUNDS` 8 → **15**
- `DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS` 20 → **40**
- 两条迁移各自独立版本戳：`SLIM_EVERY_DEFAULTS_VERSION` +1、`SNAPSHOT_GAP_DEFAULTS_VERSION` +1；不得共用（历史事故：共用版本戳导致存量用户永久停在旧值）。
- 迁移保留显式意图：slim 显式 1（每步都发）保留；full 显式 0（每轮都发完整版）保留。

**必须同步**：前端设置文案/范围、`FEATURE-INVENTORY.md`、`DEFAULT_CONFIG` 注释、所有断言 8/20 的测试与文档（全仓检索，不靠手算）。
**验收**：模拟 100 步 —— slim 投递 ≤ ⌈100/15⌉=7、完整帧 ≤ ⌈100/40⌉=3；真人旁路与水位触发不受节流影响；两条迁移各自幂等、互不阻塞。

## 3. R3 日志 / 最近日志：重合 100%

- `projection.js:40` 与 `:44` 都映射 `'recent-logs'`；唯一生产者 `index.js:9632 recentLogTails(projectDir, recentDaysInjected)`，每天 `truncateTail(text, 700)`（:9473）。
- 本机 `recentDaysInjected=1`；今日日志 190,323B / 133,373 字符 ⇒ 注入尾部恰好 700 字符。
- 裁定：human_full 只开 `recentLogs`（tail），`logs` 标 `aliasOf` 并禁止同时启用；要拆真来源需先定义第二个数据源（当前不存在），不进本批。
- 验收：同一 policy 预览中 `recent-logs` 候选最多 1 个；双开被拒绝或自动合并。

## 4. R4 诊断：做成可选功能，默认关闭

**它是什么**：把插件内部异常（快照构建失败、写盘失败、迁移失败、WAL 异常）以「诊断摘要」注入给模型，让模型知道记忆链路坏了、别把缺失当事实。

**现状**：诊断只落 `diagLogFile()`（`lib/index.js:2622`，`dsh-auto-memory-diagnose.log`，单文件 2MB 轮转，保留 1 份历史）与面板「诊断」页；`projection.js:47` 映射 null，注入面**一个字都投不出去**。

**裁定**：实现 provider（选项 B），但：
- **默认关闭**（`diagnostics.enabled=false`）；关闭时**零读取、零字节**，不得为读日志付出 IO。
- 开启后仅注入**摘要**：最近窗口内错误条数与规范化 code（例如 `[记忆诊断] 最近 24h 错误 3 条：snapshot-build×2, wal-flush×1`），上限 5 行 / 300 字符，优先级 normal（可被预算裁掉）。
- **脱敏硬约束**：只允许 `[a-z0-9:_-]{1,40}` 的 code 与计数；禁止文件路径、记忆正文、会话 ID、查询词、模型名（遥测纪律同款）。
- 只在检测到错误时出现；无错误零字节。
- 不进入 human/run 四档默认预设，属于独立开关。
- 回执单独记 `diagnosticInjections`，不计入内容模块数。

**验收**：默认关闭时预览/注入零字节且不读日志文件；打开且有错误时只出现 code+计数；打开且无错误时零字节；变异验证（把脱敏正则放宽 ⇒ 必红）。

## 5. R5 human_slim 可达

- 真人可 slim：生产四象限 `isHuman × isFull` 保留；CA 输出 `isHuman`；PJ resolver 映射 8 档 → 4 内容档。
- 表示策略：`human_full` 仅 `full` 或整单元 `omit`；`human_slim` 允许 `full / summary / preview / pointer`。
- 验收：真人触发但配额/传输不足 ⇒ human_slim；回执不得把 summary/pointer 计入完整检查点。
- **写域（已批准）**：`lib/injection/cadence.js`（返回体加 `isHuman`、fallback 20→40/8→15、修过期注释）与 `lib/injection/dto.js`（CadenceDecision 加 `isHuman`，缺省 false 兼容）。不改 tier 判定、不回退 r3 真人旁路、不增删导出。

## 6. R6 前端任务包

路径 `docs/internal/TASKPACK-FRONTEND-SETTINGS-20261117/`：README + 3 个前端 skills + `03-SETTINGS-CONTRACT.md` + `04-ACCEPTANCE.md` + MANIFEST。详见包内文件；最终执行提示词见 `PROMPT-GPT-DELIVERY-SETTINGS-20261117.md`。

## 7. R7 设置整合：一个大「投递策略」模块

**目标**：在现有插件设置内做一个大模块，替换当前零散的投递设置；入口卡片 → 二级菜单 → 细节编辑。

**入口卡片摘要**：当前预设、启用模块数、slim/full 节奏、总预算、诊断开/关。

**二级页面（7 个 tab/子页）**：
1. 预设与节奏：4 内容档选择（human_full/human_slim/run_full/run_slim）；8 档映射只读表；slim 15 / full 40 / 水位 25（50 可选，默认关）/ 压缩后重注入 / 挂机补偿。
2. 模块：11 个生产者表格（rules 含 maintenance、recentLogs 吸收 logs、diagnostic 独立开关、user-memory/project-notes 锁定不可关）；每行展开可编辑：启用 / 视图 / 数量配额 / 单段预算 / 优先级。
3. 预算与超额：全局传输（字符/字节；token 无计量器时置灰）、hard/soft、fallback 顺序、装不下时的行为（压缩表示 / 指针 / 省略 / 明确失败）。
4. 触发：真人、压缩后首轮、水位阈值、slim 间隔、full 间隔、首帧/交接。
5. 诊断：默认关闭开关；开启后选择窗口与条数；脱敏说明；「打开本地诊断日志」只读链接（走面板，不发网络）。
6. 预览与回执：选场景 → 预览最终文本长度、模块/事件/检查点计数、full/summary/pointer 分账、omitted、violations。
7. 兼容：旧散键只读映射表 + 迁移状态 + 「迁移到策略」（幂等）。

**旧设置处置**（详见 PLAN 文档 §2）：节奏/内容/预算三类迁入新模块；`slimPlanChars`/`slimLedgerChars` 已废弃（`index.js:1024` 注释）从 UI 移除；other-subsystem 键（team/procedure/globalBrief/softInjection）不并入。
- **实测无消费者的键只做只读兼容**：`handoffPlanChars`（读入未用）、`externalInjectionChars`（配置对注入无效）、`slimCheckpointCount`（无消费者）、`slimPlanChars`/`slimLedgerChars`（已废弃）。P2 不得为这些键新造可编辑却无效的控件。
**兼容原则**：新键 `deliveryPolicy` 为唯一写入源；旧键本批保留为只读影子（可回滚），设置页不双写；等 U3 完成迁移适配器后再决定删除。
**验收**：旧控件从原分组消失或折叠为「兼容（只读）」；新模块可完整读写 policy；两处不出现同一语义的两个可编辑控件。

## 8. 对 U0 契约的增量要求

1. 预设模型（4 内容档 + 8 档映射 + override；legacy 锁定）。
2. 段身份：logs alias、maintenance 子单元、diagnostic 独立开关、user-memory/project-notes 锁定。
3. 四档表示（full/summary/preview/pointer）与模块视图分离。
4. 触发参数进 policy（human/postCompact/waterPct 默认 [25]/slimEveryRounds=15/fullGapRounds=40）。
5. 诊断 provider 契约（默认关、脱敏、上限、回执字段）。
6. 预览 API（纯函数、只读、byte-equal）。
7. 迁移映射：旧散键 → policy 适配器；单一写入源。
8. 13 段可关清单与 14 段 ContentSpec 对齐表（含 2 个 must 段警示文案）。

## 9. R8 水位默认裁定（2026-11-17 追加）

- 默认 `fullInjectWaterPct = '25'`：只保留 25% 档，**50% 档默认关闭**（与 2026-11-17 CA-AD1 及 CONSTRUCTION-PLAN 3.0.3 一致）。
- 显式配置一律保留：`'25,50'` → 双档，`'off'/'0'` → 禁用，`'25'` → 单档，自定义列表原样。
- 旧默认残留迁移：新增独立版本戳 `waterPctDefaultsVersion`；未打戳且磁盘值恰为旧默认 `'25,50'` → 迁为 `'25'`，回执记录 `waterPct-old-default-migrated`；不打戳的其他值不动。
- 前端同步（CA-AD1 遗留漂移）：`lib/client.js` 三处 fallback/placeholder（18399 / 22072 / 25298）、`skins/legacy/iter5-325.js.frozen:1684`、`skins/iter5/settings-copy.js:71` 文案「默认 25,50」全部改为 `'25'`（可填 `'25,50'` 开启 50 档），生成器重跑至 SYNC-OK。
- 验收：缺省 `[25]`；显式 `'25,50'` → `[25,50]`；`'off'/'0'` → `[]`；迁移只命中旧默认一次；前后端默认与文案一致。
