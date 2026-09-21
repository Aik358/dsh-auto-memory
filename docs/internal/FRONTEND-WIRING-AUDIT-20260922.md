# 前端接线审计 · 「后端已实现、前端零消费者」能力穷举

- 审计日期：2026-09-22
- 审计范围：`lib/index.js`（宿主，11 388 行 / 17 个模型工具 / **49 条路由**）↔ `lib/client.js`（浏览器，6 362 行，手写 `__ModuleLoader__`）
- 触发诉求（用户原话）：「有些后端功能已经改好了，但是前端没有加上，没有连，就没有相对应的窗口。」
- 纪律声明：本报告**只读**，未修改 `lib/` 下任何文件；未 commit / 未 push；未重启任何进程。
- 证据口径：每条结论均带 `file:line`；凡属推断均显式标注「推断」二字。
- 活跃文件纪律：仅 `-pre.js` 后缀模块为活文件；plain 同名文件（`lib/fact-store.js` 等）为陈旧发布产物，**未作为证据**。

---

## 结论总表

| 能力 | 宿主证据(file:line) | 前端现状(命中/未命中 + client.js 证据行号) | 用户实际看不到什么 | 建议落点(哪个页签/哪张卡) | 优先级(P0/P1/P2) |
|---|---|---|---|---|---|
| **高风险技能「人工批准」(approve 原语)** | `lib/index.js:11027`（action 白名单含 `approve`）、`lib/index.js:11031`（`procs.approve(pid, 'user')`）、`lib/procedure-store-pre.js:492`（`approve()` 原语）、`lib/index.js:11022-11026`（B-1 修复注释） | **未命中**。`lib/client.js:3316` 的 `hubAct(action, procedureId, v)` 是通用函数、本可传 `'approve'`，但全文件 `'approve'` **0 处调用**；且 `lib/client.js:3391` 把「晋升」按钮门控在 `p.promotion.decision === 'promote'`，`decision==='ask'` 时按钮**被隐藏**；`lib/client.js:3183` 只给出一句「高风险需确认」文案 | 高风险技能在面板上显示「需要你确认」，却**没有任何可点的按钮**。宿主已补好解门通路，UI 侧仍是死路——这是最贴合用户原话「改好了但没连」的一处 | 记忆中枢页签 · 技能卡片按钮行（`lib/client.js:3382-3395`），在 `decision==='ask'` 分支渲染「批准」按钮 → `hubAct('approve', p.procedureId)` | **P0** |
| **三层记忆落盘健康度（#110 hubIo）** | `lib/index.js:6847-6848`（`_hubIoViewSnapshot()`）、`lib/index.js:6959`（`hubIo:` 进 debugInfo）、`lib/hub-io-pre.js:186-215`（`hubIoHealthSnapshotPre`，含人话 `summary` 与 `verdict`） | **未命中**。`lib/client.js:4818` 确实 `apiGet(API.debug)` 取回了整包，但渲染段 `lib/client.js:4831-4855` 只读 `host` / `heartbeat` / `autoConsolidate` / `subagents` / `duplicateHeadings` / `memoryFiles`；全文件 `hubIo` **0 命中** | 「记忆到底写进磁盘没有」依然无从得知。`lib/index.js:6958` 自己写明此前「面板/日志/返回值三处都看不出来」——数据已送到客户端，面板仍未展示 | 诊断页签 · kv 列表（`lib/client.js:4835-4845` 同一 `kv()` 行样式），把 `verdict`/`summary`/`errors` 上屏 | **P0** |
| **facts 淘汰可观测性（prune 诊断）** | `lib/fact-store-pre.js:688`（`pruneIfNeeded()`）、`:716`（`stats.pruned`）、`:717`（`stats.pruneProtected`）、`:832`（`getLastPrune()`）、`:834`（`retentionLimit()`） | **未命中（双层）**。① 客户端全文件 `pruned|lastPrune|pruneProtected|retentionLimit` **0 命中**；`lib/client.js:3401-3408` 只读 `facts.recent` / `facts.size` / `facts.pendingConflicts`，**不读** `facts.stats`（该字段由 `lib/memory-hub-pre.js:245` 提供）。② `getLastPrune()` / `retentionLimit()` 在全 `lib/` 检索中**只有定义处、无任何调用方** ⇒ 连路由应答体都没进 | 从未显示「已淘汰 N 条 / 保护 M 条 / 上限是多少」。#110 的淘汰行为对用户完全静默 | 记忆中枢页签 · 事实层卡片（`lib/client.js:3400-3408`）加一行统计；`lastPrune` 时间与条数 | **P0** |
| **facts 保留上限可配置** | `lib/index.js:582`（`factRetentionMax: 1000`）、`lib/index.js:9236`（`createFactStorePre({ config: { maxFacts: ... } })`） | **✅ 已闭环（2026-09-22）——本条审计时点的判断已过时，勿再按「未接线」施工**：设置项 `lib/client.js:6113`（`fFactRetention` 数值输入框，`min:10`，`onChange: set('factRetentionMax', …)`）；i18n zh `lib/client.js:372` / en `lib/client.js:567`；宿主键 `lib/index.js:582` + 注入 `lib/index.js:9236`（两者审计时即正确，未变动）。审计时点的 client.js 行号取自 6362 行快照，现已整体漂移（复验时 6675 行）⇒ 复核一律用**锚点代码串**定位。<br>更正：sidecar-medic · 2026-09-22（依据独立复验；Lead 决策「就地在原报告更正，避免重复施工」） | 用户在 设置 → 自动记忆引擎 可读可改该上限；原「硬编码写死、改不了又看不见」的结论**已不成立** | 设置页 · 自动记忆引擎分组（**已落地**，无需新施工） | ~~P0~~ **已闭环** |
| **Python 侧车看门狗 + stderr 可见（#107/#108）** | `lib/python-sidecar-client-pre.js:114`（`watchdog: {kills, respawns, lastReason, lastAt, lastDetail}`）、`:118-119`（`lastStderrTail` / `stderrTailBytes`）、`:196-215`（stderr 原文入 diag）、`:592`（`debugView()` 暴露） | **未命中**。`lib/index.js:6946` 已把 `pythonBackend: ...c.debugView()` 放进 debugInfo，但客户端全文件 `watchdog|lastStderrTail|stderrTailBytes|exitKinds|respawns|lastExit|pythonBackend` **0 命中** | 引擎挂死被看门狗击杀/重生、以及 traceback 原文，用户一概看不到；现象只剩「语义唤回突然不好使了」 | 诊断页签（`lib/client.js:4831` 起）新增 `pythonBackend` 折叠块；或设置页 · 语义分组底部 | **P1** |
| **结论层状态 superseded / retracted 的界面呈现（G3）** | 写侧 `lib/index.js:6047`（`applyNoteStatusPre`）、`lib/index.js:10286`（由 `memory_note_pre` 调用）；读侧 `lib/index.js:6209-6213`、`:6440-6446`、`:6486`（`statusOf` 注入）；执行模块 `lib/note-status-apply-pre.js` | **未命中**。客户端全文件 `retract|supersede|已撤回|dsh-status|撤回` 仅 3 处命中（`lib/client.js:343`、`:530`、`:675`），**全部是 i18n 说明文字与注入纪律文本**，无任何徽章/状态渲染 | `MEMORY.md` 里的 `<!-- dsh-status: retracted ... -->` 只以**原始 HTML 注释**形态出现在文件视图里；用户看不出「这条结论已作废 / 已被取代」 | 记忆页签 · 文件内容视图与项目笔记卡片头部，加「⚠已撤回」「已被新版取代」徽章 | **P1** |
| **memory-hub 编排动作（consolidate / feed / render / crossfeed）** | `lib/index.js:11013`（`consolidate`）、`:11014`（`feed`）、`:11015`（`render`）、`:11016`（`crossfeed`），四支均已在 POST 分支实现 | **未命中**。客户端全文件 `'consolidate'` / `'feed'` / `'crossfeed'` **0 命中**；`hubAct` 在 UI 上只被传过 `promote` / `activate` / `deprecate` / `pin`（`lib/client.js:3346`、`:3392-3395`） | 手动巩固会话、喂 judgement 行、渲染 checklists、交叉喂养——四个后端能力**一个入口都没有** | 记忆中枢页签顶部动作行（`lib/client.js:3314` 注释所在的 hubTab） | **P1** |
| **手动「立即反思」** | `lib/index.js:178`（API key `reflect`）、`lib/index.js:11502`（路由 `/api/dsh-auto-memory-pre/reflect`） | **未命中**。`lib/client.js:1183` **声明了** `reflect: ROUTE_PREFIX + '/reflect'` 常量，但全文件 `API.reflect`（词边界）**0 命中**；对照组 `API.reflectAuto` 有消费者（`lib/client.js:2935`、`:3971`） | 反思只能等自动触发；面板上没有「现在给昨天生成一份反思」的按钮 | 记忆页签 · 反思列表页（`lib/client.js:3958` 所在列表组件）加动作按钮 | **P1** |
| **子代理痕迹回收动作与回执** | `lib/index.js:10768`（路由 `/subagent-gc`）、`lib/index.js:206`（API key）、`lib/subagent-gc-pre.js` | **未命中**。客户端 `subagent-gc` / `subagentGc` 仅命中配置项（`lib/client.js:6097-6099` 开关与保留天数），**无路由消费者**；`tests/smoke/smoke-test-api-paths-pre.mjs:28` 白名单注明其非界面消费者为 CLI `tools/subagent-gc.mjs` | 设置页能开关回收、能设保留天数，但**看不到回收结果**（回收了多少 / 最近一次何时 / 备份在哪） | 设置页 · 该开关旁加只读回执行（或诊断页签） | **P1** |

---

## 结论总表（续）

| 能力 | 宿主证据(file:line) | 前端现状(命中/未命中 + client.js 证据行号) | 用户实际看不到什么 | 建议落点(哪个页签/哪张卡) | 优先级(P0/P1/P2) |
|---|---|---|---|---|---|
| **memory-hub 拒绝计数（rejectedSemantic / rejectedProcedure）** | `lib/memory-hub-pre.js:73`（stats 初值含两键）、`:98`（`stats.rejectedSemantic++`）、`:116`（`stats.rejectedProcedure++`）、`:236`（`stats: { ...stats }` 进 overview） | **命中但以裸 JSON 呈现（未人话化）**。`lib/client.js:3309-3310` 取回并 `setData(j)`；`lib/client.js:3419` 用 `JSON.stringify(data.stats)` 整坨打印。前端**无任何中文标签、无卡片、无解释** | 只能看到 `{"judgedRows":…,"rejectedSemantic":3,…}` 这样的英文键名与数字，看不懂「被拒 3 条」意味着什么、去哪查原因 | 记忆中枢页签 · 统计块（`lib/client.js:3417-3419`）改为中文卡片：「本批判定 N 行 · 语义拒 M 条 · 流程拒 K 条 · 跳过 J 条」 | **P2** |
| **memory-hub 拒绝原因 code / message** | `lib/memory-hub-pre.js:77`（`reason: 'not-object'`）、`:80`（`'unknown-kind:'`）、`:88`（`'not-fact'`）、`:110`（`'not-procedure'`）、`:131`（`'no-import-episodes'`）、`:140`（`'duplicate-episode'` / `'rejected:'`）、`:145`（`'error'`）、`:148`（`'no-store'`）；随 `return { results: out }`（`:154`）与 POST `action='feed'` 应答返回 | **未命中**。`action:'feed'` 在客户端零调用（见上一行「编排动作」），这些 per-row `reason` 因此**根本到不了前端**；客户端也无任何 `reason`→中文映射表 | 每条 judgement 行**为什么**没被消费（不是对象 / 未知 kind / 不是事实 / 不是流程 / 重复 episode / 出错）完全不可见 | 与上一条同一卡片；建议「被拒」做成可展开列表，逐行显示中文原因 | **P2** |
| **hubIo 错误的人话映射（explainHubIoErrorPre）** | `lib/hub-io-pre.js:30`（`HUB_IO_ERRNO_MESSAGES_PRE_V1` 冻结表）、`:46-48`（`explainHubIoErrorPre(e)` 查表产出人话）、`:65`（内部调用产出 `human`）、经 `:186-215` 的 `summary` 输出 | **未命中**。客户端 `hubIo` 零命中（同 P0 第 2 条）。宿主已把 errno → 中文句子的映射写好，但**该句子只存在于 debugInfo 的 `summary` 字段里，前端不渲染** | 磁盘写入失败时，用户拿不到「权限被拒 / 磁盘满 / 文件被占用」这类可操作的人话结论 | 诊断页签 · `hubIo.summary` + `lastError`（红字告警态）；复用 `verdict === 'io-error'` 做颜色判据 | **P1** |
| **前端只显机器码 reasonCodes（操作回执行）** | `lib/procedure-store-pre.js:370`/`:375`/`:377`/`:379`/`:385`/`:389`（各分支 `reasonCodes`）、`:400`（promote 全通） | **部分命中**。主审批面**已有人话映射**：`lib/client.js:3173-3191`（`whyNotPromotable`，覆盖 8 类码，`:3179-3186`）；**但** 操作回执仍拼机器码：`lib/client.js:3324`（`actMsg` 直接拼 `reasonCodes.join(', ')`），未识别码还会回落裸码 `lib/client.js:3190`（`codes.join(' · ')`） | 点完按钮后顶部那行提示是 `promote: keep (success-below-3)` 这类混合机器码；用户得自己翻译 | 记忆中枢页签 · `actMsg` 行（`lib/client.js:3398`）复用 `whyNotPromotable` 做二次翻译 | **P2** |
| **debugInfo 其余最小投影（degrade / quota / indexSyncHost / shadowRetrieval / contextBridge / activationInbox / memoryIndex / runtimes）** | `lib/index.js:6938`（shadowRetrieval）、`:6940`（contextBridge）、`:6942`（activationInbox）、`:6948`（indexSyncHost）、`:6951`（degrade）、`:6955`（quota）、`:6936`（memoryIndex）、`:6960`（runtimes） | **未命中**。客户端全文件 `degrade|quota|shadowRetrieval|contextBridge|activationInbox|memoryIndex|runtimes|envelopeTail` 仅命中 i18n 文本与配置项（`lib/client.js:545`、`:737`、`:946`、`:5894`、`:5946`），**无一处读 `data.<同名键>`** | 降级台账（哪条注入被降级）、配额测量（配额太少还是多余）、索引重建状态、影子检索与上下文桥运行态——诊断页签全部看不到 | 诊断页签 · 按折叠块逐个补（优先级低于 hubIo / pythonBackend） | **P2** |
| **activation-inbox 注入回执** | `lib/index.js:11104`（路由 `/activation-inbox-pre`）、`lib/index.js:191`（API key）、`:11115`（`action:'status'` 返回 `host.debugView()`） | **未命中**。客户端 `activation-inbox|activationInbox` 零命中；`tests/smoke/smoke-test-api-paths-pre.mjs:27` 白名单注明其非界面消费者为「契约测试与注入入口」 | 本轮唤起包投递了什么、投没投出去，面板不可见 | 记忆页签 · 只读回执行（与「接续」页签相邻） | **P2** |
| **运行时信封剥离（intent-clean-safe-pre）** | `lib/index.js:57`（导入 `stripRuntimeIntentPre` / `looksRuntimeResiduePre`）、`:9411-9413`（三处剥离调用）、`:9418`（残留判据） | **未命中（UI 侧）**。客户端全文件 `residue|intentClean|信封|envelope|stripRuntime` **0 命中**；宿主侧已接线（模型注入路径），但**无任何计数/回执暴露到界面** | **推断**：清洗掉了几条信封噪音、有没有漏网，用户看不到。该模块 `lib/intent-clean-safe-pre.js:25-27` 自己声明「未知形态仍会漏」，漏网时无界面信号 | 记忆中枢页签 · 事实层卡片加一行「本轮因信封残留被拒 N 条」；或诊断页签 | **P2** |
| **note-status-pre 模块自述与实现不一致（文档级发现）** | `lib/note-status-pre.js:4-8` 模块头声明「⚠️ 状态：形态候选，**未接线**（2026-09-19）…本模块只提供判定与格式能力；**没有任何调用方**」；但实际写侧 `lib/index.js:6047`/`:10286` 与读侧 `:6209-6213`/`:6440-6446`/`:6486` 均已接线，经 `lib/note-status-apply-pre.js` 落地 | **不适用（非前端问题）** | 不直接影响用户，但会误导后续维护者以为该能力未启用，从而重复评估或误判优先级 | 更新 `lib/note-status-pre.js:4-8` 头注释（须用户授权后才动 lib/） | **P2** |

---

## 对照项：这些**已接线**，避免误判为缺失

以下必查清单项经检索确认**前端已有真实消费者**，记录在此以防后续重复排查：

| 能力 | 宿主证据(file:line) | 前端现状(命中 + client.js 证据行号) |
|---|---|---|
| `successCriteria` 渲染 | `lib/procedure-store-pre.js:237`（入库）、`:379` / `:446`（晋升门）；`lib/memory-hub-pre.js:272`（overview 投影 `successCriteria: ...slice(0, 6)`） | **命中**。`lib/client.js:3372-3379`（`details` 折叠预览 steps + criteria，i18n 键 `hubInjectCriteria`）；无 criteria 时 `lib/client.js:3381` 给 `hubNoSteps` 提示 |
| `promotion.decision` 只读投影消费 | `lib/memory-hub-pre.js:260-266`（`evaluatePromotion` 只读投影）、`lib/procedure-store-pre.js:454` | **命中**。`lib/client.js:3368`（`decision === 'promote'` 决定告警色）、`:3391`（按钮门控）、`:3389` 注释明示设计意图 |
| `reasonCodes` 中文映射 | `lib/procedure-store-pre.js:353-389` | **命中**。`lib/client.js:3173-3191`（`whyNotPromotable`，覆盖 observation-only / deprecated / no-success-criteria / has-correction / high-risk-awaiting-approval / diversity-below-* / success-below-* / correction-rate-*） |
| `stage` 枚举中文 | `lib/procedure-store-pre.js` 各 stage 分支 | **命中**。`lib/client.js:3167-3170`（`stageLabel`，5 个 stage 全覆盖） |
| `pinned` / `observationOnly` / `riskLevel` 呈现 | `lib/memory-hub-pre.js:269` | **命中**。`lib/client.js:3355-3361`（徽标与 ⚠ 高风险标） |
| `hubIoHealthSnapshotPre` 之外的 `beginBatch` 批控制 | `lib/hub-io-pre.js:170-171`、`lib/index.js:9356`（`ioFactory.beginBatch()`） | **命中（宿主内部机制，按设计无需 UI）**。该能力是批内合并落盘的性能优化，不产生用户可见状态，**不属于「未接线」缺陷** |
| `keyword` 语义降级提示 | — | **命中**。`lib/client.js:5894`（`sem.degraded` → 引擎降级文案） |

---

## 证据方法

### 检索命令（全部用 grep 工具的 ripgrep 语法，未使用 shell find/grep）

1. **宿主动能面枚举**
   - `grep lib/index.js` → `dsh-auto-memory`（88 命中，取路由前缀真相）
   - `grep lib/index.js` → `^\s+path:\s`（**50 命中**：49 条真实路由 + `lib/index.js:11406` 的 `path: p.userFile` 为 settings 文件路径，非路由）
   - `grep lib/index.js` → `kind:\s*'(exact|prefix)'`（**49 命中**，与上条 49 条路由互证）
   - `grep lib/index.js` → `defineTool\('memory_`（13 命中）+ `defineTool\(`（19 命中，含 `lib/index.js:8118` 定义处与 `:10537` 注释）⇒ 去重后 **17 个模型工具**
   - `read lib/index.js:163-214`（API 常量表）⇒ **49 个 key**

2. **前端消费面反向检索**
   - `grep lib/client.js` → `API\.[a-zA-Z]+`（**102 命中**）——这是核心检索：逐一核对每个 API 常量在**声明表（`lib/client.js:1169-1218`）之外**是否还有调用点
   - `grep lib/client.js` → `apiGet\('|apiPost\('`（**0 命中**）⇒ 证明客户端**不使用字面量路径**，全部经 `ROUTE_PREFIX`（`lib/client.js:1165`）拼出的 `API` 表，故「反向检索字面路径」对本仓无效，必须改为检索常量名
   - `grep lib/client.js` → `dsh-auto-memory`（66 命中，其中 `lib/client.js:8` 仅为注释）

3. **必查清单逐项检索**（宿主机能 → 前端反向）
   - `grep lib` → `pruneIfNeeded|getLastPrune|retentionLimit|pruneProtected|stats\.pruned`（9 命中，**全部在 `lib/fact-store-pre.js`**）⇒ 证明这两个访问器宿主侧也无调用方
   - `grep lib` → `explainHubIoErrorPre|HUB_IO_ERRNO_MESSAGES_PRE_V1|hubIoHealthSnapshotPre|beginBatch`（13 命中）
   - `grep lib` → `rejectedSemantic|rejectedProcedure`（3 命中，**全部在 `lib/memory-hub-pre.js`**）
   - `grep lib` → `watchdog|stderrTail|stderr`（45 命中，全在 `lib/python-sidecar-client-pre.js`）
   - `grep lib/client.js` → `watchdog|lastStderrTail|stderrTailBytes|exitKinds|respawns|lastExit`（**0 命中**）
   - `grep lib/client.js` → `pruned|lastPrune|pruneProtected|retentionLimit|factRetention`（**0 命中**）
   - `grep lib/client.js` → `hubAct\(|'approve'|"approve"|decision|reasonCode|successCriteria`（29 命中；**`'approve'` 零命中**）
   - `grep lib/client.js` → `retract|supersede|已撤回|dsh-status|撤回`（3 命中，均为 i18n/纪律文本）
   - `grep lib/index.js` → `intent-clean-safe-pre|note-status|applyNoteStatusPre|stripStatusLinePre|statusOf`（17 命中）
   - `grep lib/client.js` → `residue|intentClean|信封|envelope|stripRuntime`（**0 命中**）
   - `grep lib/client.js` → `action: '(consolidate|feed|render|crossfeed)'|'consolidate'|'crossfeed'`（**0 命中**）
   - `grep lib/client.js` → `hubIo|degrade|quota|shadowRetrieval|contextBridge|activationInbox|memoryIndex|runtimes|envelopeTail`（5 命中，全部是 i18n 文本/配置项，**无一处读 `data.<键>`**）
   - `grep lib/index.js` → `factRetentionMax`（2 命中：`:582` 默认值、`:9236` 注入 store）

### 命中/未命中判据（逐条可复现）

- **「未命中」判定**：该能力的**唯一可辨识标识串**（API 常量名 / 应答体字段名 / 函数名）在 `lib/client.js` 全文检索结果为 **0 命中**；或虽命中但命中行**位于声明表内**（`lib/client.js:1169-1218`）或**属于 i18n 文本/配置项**，即**无消费者**。
- **「命中但未人话化」判定**：字段确实被读取，但呈现形态为 `JSON.stringify(...)` 或 `reasonCodes.join(...)` 裸拼接，无中文标签/映射表。
- **「宿主也无消费者」判定**：函数在 `lib/` 全域检索中仅有**定义处**命中、无调用点 ⇒ 该能力**连路由应答体都没进**，属最严重一档。
- **白名单排除**：`tests/smoke/smoke-test-api-paths-pre.mjs:26-28` 的 `HOST_ONLY_WHITELIST` 显式声明 `activation-inbox-pre`（契约测试与注入入口）与 `subagent-gc`（CLI `tools/subagent-gc.mjs`）**按设计无界面消费者**；本报告对这两条不判为「遗漏」，但**仍记录其用户可见后果**（无回执）。
- **路由级差集校验**：宿主 49 key vs 客户端 47 key，差集恰为 `activation-inbox-pre`（`lib/index.js:191`）、`subagent-gc`（`lib/index.js:206`），与白名单**逐条吻合**；另有 1 条客户端**已声明但零调用**（`API.reflect`，`lib/client.js:1183`）。
- **活跃文件纪律**：所有证据行均取自 `-pre.js` 后缀模块与 `lib/index.js` / `lib/client.js`；`lib/fact-store.js`、`lib/memory-hub.js`、`lib/procedure-store.js`、`lib/python-sidecar-client.js`、`lib/note-status.js`、`lib/intent-clean.js` 等 plain 副本**未采信**。

### 未能取证的边界（如实声明）

- 本次为**静态源码审计**，未实际启动浏览器点击验证，也未重启宿主（遵守用户硬性规则）。因此「未命中」= **源码层面无消费者**；「推断」标记处（运行时信封清洗的界面回执）未取得运行时证据。
- 客户端 `lib/client.js` 为手写 `__ModuleLoader__` bundle，不存在构建产物与源码的差异问题，静态检索结论可直接采信。
- 本次未覆盖：宿主 17 个**模型工具**（`memory_*` / `calendar_*`）本身不是界面能力，故不列入「未接线」；但其中 `memory_expand_pre` / `memory_trace_pre`（P3 白板遍历，`lib/index.js:10541`/`:10545`）的**结果**在面板上是否可视化，未在本轮范围内（推断：白板看板已承接，未单独取证）。

