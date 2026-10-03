# FEATURE-INVENTORY · dsh-auto-memory 三层功能全量清单

> 生成：2026-09-20（ZCode 线，交接任务 §4-A）。枚举基准：本仓工作区 `lib/index.js`（11,463 行）、`lib/client.js`（5,706 行）及 `lib/*-pre.js` 生效模块，全部**机械枚举**（node 脚本 + grep），非手工抄录。
> 生效文件口径：宿主真正 import 的是 `lib/*-pre.js`（`lib/index.js:29-85` 的 import 表）与 `lib/index.js`、`lib/client.js`；同名无 `-pre` 后缀的 `lib/*.js` 是**陈旧副本，不生效**（本清单所有 file:line 均指向生效文件）。
> 本文 L3 的地位是**存档**：全量不删减，供后续决定哪些上首页、哪些进 README、哪些留后台。

---

## 0. 核对表（实际枚举数 vs 交接数字）

| 项 | 交接数字（HANDOFF-TO-ZCODE-20260920 §4-A） | 实际枚举数 | 结论 | 证据 |
|---|---|---|---|---|
| 模型工具 | 17 | **17** | 一致 | `defineTool(` 全仓 17 处调用（index.js:9982-10318）；14 个 `memory_*` + 3 个 `calendar_*`；其中 `memory_expand` / `memory_trace` 为 `boardMode=graph` 时的条件注册（index.js:10309-10317） |
| HTTP 路由 | 49 | **49** | 一致 | 常量表 `export const API = {`（index.js:161-206）恰 49 键；路由数组 `const routes = [`（index.js:10320）恰 49 个 `{kind,path,handler}` 条目，经 `ctx.webServer.register(route)` 挂载（index.js:11451） |
| 设置键 | 85 | **98**（顶层数） | **不符：+13** | `DEFAULT_CONFIG`（index.js:258-586）顶层键实数 98。旧 85 清单（UI-INVENTORY-RAW.md）之后新增 13 键：`boardMode`(L264)、`tier0CatalogEnabled`(L291)、`tier0MaxTokens`(L295)、`tier0BudgetShare`(L298)、`injectExcludeSources`(L308)、`capacityDefaultsVersion`(L331)、`slimPlanChars`(L368)、`slimLedgerChars`(L369)、`rulesLayeringMode`(L379)、`criteriaGate`(L385)、`snapshotTieredInject`(L441)、`l0IndexEnabled`(L536)、`hubMechanicalProcedureFeedEnabled`(L557)。85+13=98，逐键对得上。另：`externalSources`(L471) 含 13 个子键（L472-485）；`DEFAULT_PROMPT_LAYERS`（index.js:592-647）另有 23 个 prompt 层文案键（可被 `promptLayerOverrides` 覆盖），**不属于** DEFAULT_CONFIG，不计入顶层键数（2026-09-25 复测顶层键 **115**） |
| 插槽注册 | 6 | **6** | 一致 | `slots.inject(` 在 client.js 恰 6 处（L5664/5667/5670/5673/5676/5683）。旧文档（UI-INVENTORY-RAW §1）的「5 注册面」少的是 2026-09-16 新增的 `conversation.view` 白板看板（client.js:5683-5689） |
| 面板页签 | 12（旧文档） | **12** | 与旧文档一致 | client.js:4023（数组定义）/ 4011-4022（分派） |
| 设置分组 | 8（旧文档） | **8** | 一致 | `section(` 恰 8 处（client.js:5095/5249/5264/5289/5306/5337/5363/5396）；组名表 `sectionLabels`（client.js:5077-5084） |
| index.js 行数 | 约 11,460 | 11,463 | 一致 | `wc -l` |
| client.js 行数 | 约 5,701 | 5,706 | 一致（±5 行漂移） | `wc -l` |

> 注意：交接 §4-B 写的「61 个插槽清单」是**宿主侧插槽目录总量**（宿主提供的插槽位），插件实际注册的只有 6 个——两者不矛盾，别混用。旧 DESIGN-OVERHAUL §1.1 的「46 条路由 / 14 工具 / 69 套件」均为 2026-09-10 口径，已过时。**当前口径（2026-09-25 代码实测）：19 工具 / 56 路由 / 115 配置键。**

---

## L1 · 用户能力（一句话一条，面向宣传）

**记忆写入与沉淀**

1. **全自动记忆沉淀**：每轮对话结束自动把结论写进当日工作日志、把有长期价值的要点升格进项目笔记，寒暄轮自动跳过——用户零操作（`autoConsolidate`，默认开，index.js:337）。
2. **三层本地记忆**：用户级（跨项目规则/偏好）、项目级（约定/决策/架构）、每日日志，全部纯 Markdown 明文，看得见、改得了、带得走（index.js:2137-2147）。
3. **做梦式定时固化**：每天 09:30 读最近 7 天日志发散提炼长期要点（`consolidateSchedule*`，index.js:345-349）。
4. **30 天蒸馏**：每天 10:00 把 30 天前的旧日志蒸馏进项目笔记，原文保底归档，信息不丢（`maintainSchedule*`，index.js:351-353）。
5. **每日反思**：自动检测昨日反思缺口并提示模型生成，落盘反思目录，当天不重复打扰（`reflectEnabled`，index.js:463）。

**记忆检索与召回**

6. **跨会话记忆检索**：一句话找回"上周的决定/之前的做法"，覆盖全部工作区的日志、笔记、反思、白板（`memory_recall`，index.js:10130）。
7. **两段式省 token 检索**：先返回 L0 摘要列表（id/得分/匹配原因），看中哪条再按 id 展开全文（format=l0 + expand，index.js:10134-10135）。
8. **智能分层语义检索**：词法 + 内置 JS 语义模型（可选 130MB Python 引擎）双路召回，RRF 融合排序（`smartRecall`，index.js:6441；recall-fusion-pre.js:55）。
9. **历史会话全文检索**：搜过的不只是记忆文件，还有历史 DSH 会话转写（`scope=sessions`，index.js:2791,6007-6014）。
10. **外部 AI 工具记忆继承**：自动发现并接入 WorkBuddy/CodeBuddy/Claude Code/Codex/ZCode/Kimi Code/TRAE 的记忆与会话，纯链接模式不抄内容（`memory_external`，index.js:10159；外部源 13 子键，index.js:471-486）。

**注入与上下文管理**

11. **自动记忆注入**：每轮对话自动携带记忆快照（规则/日志/反思/用户记忆/笔记），预算与频率可调（`injectEnabled`/`injectBudgetChars`，index.js:272-310）。
12. **Tier-0 常驻目录**：注入首位的记忆索引（每条 1 行：标题·结论·层·状态·日期），零 LLM 成本，让模型知道"有什么、怎么取"（`tier0Catalog*`，index.js:291-306；生成器 tier0-catalog-pre.js，纯内存计算零 IO）。
13. **用户级硬性约束规则层**：日志里标 `kind=rule` 的条目自动识别为硬约束，每轮以「必须遵守」段注入，与背景参考内容分层措辞（rules-layer-pre.js:142,238；T7 措辞分层 `rulesLayeringMode`，index.js:379）。
14. **精简注入节奏**：完整快照每 N 轮一次、其余轮次只给规则+索引+日程，token 成本可控（`snapshotTieredInject`/`snapshotMinGapRounds`，index.js:441-447）。
15. **结论生命周期管理**：结论被取代标 superseded、做错了标 retracted（附原因）、标错可 restore——检索结果永远带状态标记（memory_note 的 `supersedes/retract/restore`，index.js:10014-10018）。

**白板与接续**

16. **项目白板**：模型维护的"项目全貌快照" PLAN.md，旧版自动归档，用户面板直接看（`memory_note kind=plan`，index.js:2248-2266）。
17. **四段式交接账本**：任务状态/目标/已试方案与失败原因/下一步，append-only，专供"换个窗口接着干"（`kind=handoff`，index.js:2355-2369）。
18. **白板看板（新版）**：白板/账本结构化为 5 泳道看板（目标/状态/死胡同/进度/版本归档），面板 440px 看泳道、会话页顶栏看整页矩阵（boardMode=graph 默认，index.js:264；wb-sidecar-pre.js:593,647,804）。
19. **白板溯源工具**：按 tag 正向展开所有同类条目、按 id 反向回溯结论来源与版本链（`memory_expand`/`memory_trace`，index.js:10310,10314）。
20. **自动接续**：上下文水位越阈自动写交接骨架→确认卡倒计时→刷新仪式→组装四层交接材料→新窗口无缝续命（water-window-pre.js:259；index.js:3375-3377,4021-4022）。
21. **上下文水位提示**：官方公式估算窗口占用，接近阈值时注入"该收尾了"的三步执行清单（`waterLevel*`，index.js:387-399）。

**技能库（procedure memory）**

22. **模型直写技能（T4，2026-09-14 后新增）**：模型把跑通的多步流程直接写成技能条目（工具 `memory_procedure`，工具数 16→17 的那一刀），含步骤/成功判据/回滚/风险级（index.js:10233-10241）。
23. **技能晋升门槛与审批**：observed→candidate→validated→active 五阶段，跨会话≥3、成功≥2、correction 占比≤0.3 的统计门 + 高风险人工批准（procedure-store-pre.js:41,56-68；设置页「记忆中枢」分组可调）。
24. **技能自动导出 SKILL.md**：激活的技能自动导出为 `<DSH_HOME>/skills/<目录>/SKILL.md`（DSH 四条技能发现路径之一，跨项目可迁移）（skill-export-host-pre.js:29-36；index.js:10284,10804）。
25. **审批界面人话化（R1-R6，2026-09-20）**：审批不再盲确认——阶段名中文化、晋升为什么不够用带具体数字的人话、reasonCodes 透出、可展开预览真实步骤（client.js:2596-2627 的 stageLabel/whyNotPromotable 辅助 + MemoryHubTab）。

**面板与界面**

26. **12 页签记忆面板**：概览/日志/唤起回顾/记忆中枢/存储管理/笔记/白板/反思/接续/日历/检索/工作区，液态玻璃浮层 + 会话页整页看板（client.js:4023）。
27. **用户级硬性约束可视编辑（R7，2026-09-20）**：用户在日志页签直接增删改"每轮必注入的硬约束"，带预览与删除二次确认（RulesEditPanel，client.js:2628-2655，挂载于日志页签 client.js:2590）。
28. **主动联想记忆**：从思维链与对话中检测联想线索，相似记忆自动唤回注入（canary 档）或仅记录（shadow 档）（`associativeMemoryEnabled`，index.js:489；semantic-decide-pre.js:202）。
29. **唤起回顾与打分闭环**：每次自动唤起可打 A/P/S/H/E 分，反馈进 review-queue 反哺决策（RefineTab + `/review-feedback`，index.js:10702）。
30. **工作区地图**：全部工作区的记忆分布关系图 + 跨工作区 AI 总结（WorkspaceTab/WorkspaceGraph，client.js:3543）。
31. **用户级日历**：对话里提到 deadline/约定即入日历（四象限分类），跨对话有效（calendar_* 4 工具，index.js:10180-10215）。
32. **首启欢迎向导**：10 个内联开关一次配好（联想/固化/反思/定时总结/思维链监听/技能固化…），外部源批量勾选（DialogHost，client.js:4269-4399）。
33. **安装向导与环境检测**：JS 语义模型一键下载 / Python 引擎 venv+依赖+模型一条龙，深扫+热接入（PySetupWizard，client.js:2233；`/python-setup/*` 6 路由 + `/semantic-*` 3 路由）。
34. **存储管理**：全记忆文件扫描/修复/删除（删除有确认），脏 token 扫描（mojibake/裸 JSON/超长行）（StorageTab + `/storage-manage`，index.js:10832）。
35. **子代理痕迹回收**：插件标记的子代理会话按策略回收，兜底保留 N 天（`subagentGc*`，index.js:520/522；`lib/subagent-gc.js`）。**⚠️ 该能力已判废并停用**：`subagentGcEnabled` 用户配置为 `false`，`recycleSubagentSession` / `subagentGcSweep` 双早退 ⇒ 运行时不再搬移任何痕迹（判废理由：搬移不减轻前端渲染负担）。

**可靠性（2026-09-14 后新交付的工程面）**

36. **配置原子写入 + 损坏隔离（#82）**：保存中途崩溃不再无感重置全部配置——临时文件+rename 原子落盘（config-io-pre.js:72）；坏文件改名 `.corrupt-<ts>` 留存并返回结构化错误（config-io-pre.js:37,55,117；index.js:1890-1894,1943,1963）。
37. **DSH_HOME 统一（#86-3）**：7 处各写的家目录解析收敛为 `dsh-home-pre.js` 一处实现（resolveDshHomePre，dsh-home-pre.js:86），引擎侧 55 处调用统一走它（index.js:72）——跨平台路径不再打架。
38. **诊断留痕（#84）**：unhandledRejection 有 `{count, firstAt, lastAt, lastLine}` 统计（index.js:8968-8977）；思维链观察器丢弃分计数 noOwner/duplicate/ignored（index.js:1070,1582-1687）；降级台账 DEGRADE_RING（degrade-pre.js:65,159，容量 200）——所有 fail-soft 都有可观察信号。
39. **机械流程切片默认关闭（T10，2026-09-20）**：把情节意图机械截断成"技能"的旧通路默认关（`hubMechanicalProcedureFeedEnabled: false`，index.js:557,9063），技能库只保留模型直写+人工审批来源；向导里有标注「不推荐」的回退开关（client.js:4327）。

---

## L2 · 承载面（每个能力现在住在哪，面向前端搬家）

### L2.1 六处插槽注册（全部在 client.js，插件 UI 的物理入口）

| # | 插槽名 | 注册 id | order | 渲染组件 | 定义行 | 承载什么 |
|---|---|---|---|---|---|---|
| 1 | `sidebar.footer.action` | `auto-memory-pre` | 5 | SidebarButton | client.js:5664-5665 | 侧栏入口按钮「记忆 (pre)」 |
| 2 | `shell.overlay` | `auto-memory-pre` | 5 | MemoryPanel | client.js:5667-5668 | 浮层面板（12 页签全在这里面） |
| 3 | `shell.overlay` | `auto-memory-pre-dialogs` | 6 | DialogHost | client.js:5670-5671 | 7 种弹窗（更新/向导/模型下载/通知/总结/欢迎回来/语义安装） |
| 4 | `shell.overlay` | `auto-memory-pre-autocont` | 7 | AutoContinueHost | client.js:5673-5674 | 自动接续确认卡 |
| 5 | `settings.section` | `auto-memory-pre` | 25 | SettingsPage | client.js:5676-5677 | 设置页分区「自动记忆 (pre)」（8 分组 60+ 键） |
| 6 | `conversation.view` | `auto-memory-pre-kanban` | 80 | KanbanView | client.js:5683-5689 | 会话页顶栏「白板看板」整页视图（2026-09-16 双承载面设计） |

### L2.2 浮层面板 12 页签 → 组件 → 后端路由

页签数组 client.js:4023，分派 4011-4022。中文标签取自 i18n（client.js:167）。

| 页签 id | 中文 | 组件（定义行） | 主要数据路由 | 主要操作路由 |
|---|---|---|---|---|
| overview | 概览 | OverviewTab（2315）+ GreetingCard（2115） | `/state`、`/workspaces`、`/greet`、`/summarize` | `/reflect-auto` |
| logs | 日志 | LogsTab（2537） | `/list`、`/file`、`/state`（用户级记忆展示） | — ；**R7 RulesEditPanel 挂载在日志页签内**（client.js:2590） |
| refine | 唤起回顾 | RefineTab（2413） | `/shadow-recent` | `/review-feedback`（A/P/S/H/E 打分） |
| hub | 记忆中枢 | MemoryHubTab（2724） | `/memory-hub`（GET overview） | `/memory-hub`（POST promote/activate/deprecate/pin）；R1-R6 人话化辅助 2596-2627 |
| storage | 存储管理 | StorageTab（2850） | `/storage-manage`（GET 扫描） | `/storage-manage`（POST 修复/删除）、`/scan-dirty` |
| notes | 笔记 | NotesTab（2936） | `/state` | `/note` |
| plan | 白板 | PlanTab（3111） | `/handoff-state`（PLAN+账本+版本） | `/handoff-continue`（一键接续） |
| reflections | 反思 | ReflectionsTab（3364） | `/file`（反思正文） | `/reflect`、`/reflect-auto` |
| connect | 接续 | ConnectTab（3764） | `/external`、`/external-view` | `/external-import`、`/external-remove` |
| calendar | 日历 | CalendarTab（3594） | `/calendar`（GET） | `/calendar`（POST 增改） |
| search | 检索 | SearchTab（3420） | — | `/recall`、`/smart-recall`（均 POST） |
| workspaces | 工作区 | WorkspaceTab（3543）+ WorkspaceGraph | `/workspaces` | — |

面板外壳（MemoryPanel）自身还消费：`/config`（GET 读取）、`/notices`、`/update-check`、`/debug`（调试中心 DebugCenter，client.js:4070）。KanbanView（1852）消费 `/kanban-board`。

### L2.3 设置页 8 分组 → 可写配置键

分组定义 `section('…')`：client.js:5095/5249/5264/5289/5306/5337/5363/5396；组名 `sectionLabels`（5077-5084）。写入统一走 `set(key)`（SettingsPage 本地草稿）→「保存设置」→ `saveConfigPatch`（client.js:999-1200，唯一写入出口）→ `POST /config`。

| 分组 | 中文 | section 行 | 组内可写键（set() 枚举，共 60） |
|---|---|---|---|
| semantic | 自动记忆引擎 | 5095 | associativeMemoryEnabled, memoryAnchorEnabled, jsDecideCooldownRounds, jsDecideDeltaExp, jsDecideExcerptChars, jsDecideCandidateScheme, jsDecideCandidatesN, reasoningObserverEnabled, contextBridgeObserveChildSessions（9） |
| memoryHub | 记忆中枢 | 5249 | memoryHubEnabled, episodicMinSegments, episodicRetention, procedureMinSessions, procedureMinSuccess, procedureCorrectionCap, procedureHighRiskApproval, procedureActiveLevel（8） |
| appearance | 外观 | 5264 | welcomeTourEnabled, locale（2） |
| storage | 存储 | 5289 | userMemoryDir, projectMemoryDir, memoryRoot（3）；目录浏览器/模型抽屉另有 subagentModel、subagentProvider、subagentReasoningEffort 写入（client.js:4848,4911,4979 一带） |
| injection | 记忆窗口 | 5306 | injectEnabled, injectBudgetChars, injectExcludeSources, noteCapacityChars, userCapacityChars, recentDaysInjected, externalInjectionChars, snapshotMinGapRounds, snapshotReinjectOnCompact, promptLayerOverrides（10） |
| automation | 自动化 | 5337 | autoConsolidateMinChars, autoConsolidate, autoConsolidateCooldownMinutes, autoConsolidateDailyMax, autoPopupEnabled, unattendedMode, unattendedAuto, awayMinutes, autoSummaryTimes, dayBoundaryMinutes, reflectEnabled, consolidateScheduleEnabled, consolidateScheduleTime, consolidateScheduleDays, maintainScheduleEnabled, maintainScheduleTime, reflectStyle（17） |
| context | 上下文管理 | 5363 | handoffEnabled, autoContinueEnabled, handoffPlanChars, handoffLedgerChars, waterLevelWindowTokens, waterLevelThreshold, waterLevelAdvisory, waterLevelAutoHandoff, boardMode, subagentGcEnabled, subagentGcKeepDays（11） |
| maintenance | 维护 | 5396 | （版本/更新/调试中心，无配置键写入） |

**分组之外的特殊写入位**（搬家时别漏）：

- 引擎三联动：`semanticEngineMode` + `activationSource` + `contextSinkMode` 三键绑定写入（onEngineModeChange，client.js:5060-5064；向导「启用并继续」5237）。
- 首启向导内联开关（DialogHost，client.js:4269-4399）：autoSummaryTimes、reasoningObserverEnabled、activationEmitMode（伪键，映射 semantic-emit 档位）、autoConsolidate、procedurePromotionEnabled、hubMechanicalProcedureFeedEnabled（T10 回退开关，4327）、externalSources 13 子键勾选（4384-4396）等。
- 白板页 autoContinue 快捷写：PlanTab 内 autoSave 走同一 saveConfigPatch（client.js:5377 注释明确要求同源）。

### L2.4 能力 → 承载面速查（前端搬家工作单）

| 能力 | 现住承载面 | 若搬家建议的落点类型 |
|---|---|---|
| 记忆状态一览/问候/时段总结 | 面板「概览」页签 | 状态展示型（conversation.header 一行小状态） |
| 日志浏览 + 用户级硬性约束编辑（R7） | 面板「日志」页签 | 内容管理型（侧栏面板） |
| 唤起回顾打分 | 面板「唤起回顾」页签 | 对话内交互 |
| 三层记忆审批（含 R1-R6 人话化） | 面板「记忆中枢」页签 | 宽幅右侧文档页 |
| 存储/修复/删除 | 面板「存储管理」页签 | 宽幅右侧文档页 |
| 白板/账本 | 面板「白板」页签 + `conversation.view` 整页看板 | 双承载面（已是目标形态） |
| 接续材料/外部源管理 | 面板「接续」页签 | 侧栏面板 |
| 自动接续确认卡 | `shell.overlay` AutoContinueHost | 对话内弹卡 |
| 设置（60+ 键） | `settings.section` 8 分组 | 原生设置位 |
| 首启/安装向导 | `shell.overlay` DialogHost | 保留 overlay |
| 侧栏入口 | `sidebar.footer.action` | 保留 |

---

## L3 · 工程细节（存档层——全量枚举，不做取舍）

### L3-a · 全部 19 个模型工具

注册方式：`defineTool(name, description, parameters, execute)`（index.js:10467），在 mount 阶段集中注册；工具数随 `boardMode` 条件变化（graph 档 19，legacy 档 17）。启动日志：`ready: engine + N tools + injection + 56 routes`（index.js:14419）。

| # | 工具名 | 定义行 | 参数签名 | 用途（摘要自 description，全文在源码） |
|---|---|---|---|---|
| 1 | `memory_log` | index.js:9982 | `note`(string,必填)、`date`(string，缺省今天，可补记过去)、`kind`(enum rule\|preference\|fact\|todo，缺省 fact) | 向当前工作区今日日志追加一条工作记录（append-only）。kind=rule 的条目会被规则层识别为硬约束每轮注入。完成实质性工作后必须调用；顺带条件触发白板/账本维护 |
| 2 | `memory_note` | index.js:10007 | `content`(string,必填)、`action`(enum append\|replace)、`kind`(enum note\|handoff\|plan)、`supersedes`(array of mem_id)、`retract`(array of mem_id)、`retractReason`(string,≤120 字)、`restore`(array of mem_id) | 项目级写入口：note=项目笔记 MEMORY.md（容量上限 noteCapacityChars，超限先 AI 折叠、再归档 archive/、最后才拒绝）；handoff=四段式交接账本新篇（append-only）；plan=白板 PLAN.md 整体重写（唯一能覆盖旧结论的通道，旧版自动归档）。状态通道：superseded/retracted/restore |
| 3 | `memory_user` | index.js:10078 | `content`(string,必填)、`action`(enum append\|replace,必填) | 用户级记忆 ~/.dsh/memory/MEMORY.md（跨项目规则/偏好），容量上限 userCapacityChars，超限行为同上 |
| 4 | `memory_read` | index.js:10107 | `kind`(enum log\|reflection\|user\|notes\|calendar,必填)、`date`(string，log/reflection 用，缺省今天) | 按需读取记忆文件完整原文（注入只含摘要，要细节用本工具） |
| 5 | `memory_recall` | index.js:10130 | `query`(string,必填)、`limit`(integer,缺省 8)、`scope`(enum all\|handoff\|sessions)、`format`(enum l0\|full)、`expand`(string，mem_<32hex>) | 记忆检索主入口：本地多工作区 + 交接白板语料 + 历史会话。默认 L0 摘要列表；expand 为两段式第二段（提供时忽略 query 语义）。scope=handoff 只搜白板语料，scope=sessions 只搜历史会话 |
| 6 | `memory_maintain` | index.js:10138 | `days`(integer,缺省 30) | 30 天蒸馏：早于「今天−days」的日志交给 AI 蒸馏要点进 MEMORY.md，原文保底归档 archive/；AI 不可用降级为原样归档，不丢信息 |
| 7 | `memory_status` | index.js:10142 | （无参数） | 只读诊断：存储位置、各文件大小、今日日志条数、待反思、上次刷新时间 |
| 8 | `memory_reflect` | index.js:10154 | `date`(string,必填，被反思那天的日志日期)、`text`(string,必填) | 保存每日反思到 .dsh-memory/reflections/YYYY-MM-DD.md 并标记当日完成。触发条件严格：仅在框架提示+正文已呈现反思后调用 |
| 9 | `memory_external` | index.js:10159 | `action`(enum list\|import,必填)、`source`(string，import 必填)、`target`(enum project\|user) | 外部记忆源查看/接入。import 为**纯链接模式**：只写源文件绝对路径指针，不抄内容 |
| 10 | `calendar_add` | index.js:10180 | `date`(string,缺省今天)、`time`(string)、`quadrant`(enum 重要紧急\|重要不紧急\|紧急不重要\|不重要不紧急)、`title`(string,必填)、`location`、`reminder`、`note` | 向用户级日历 ~/.dsh/memory/CALENDAR.md 添加日程（跨对话有效） |
| 11 | `calendar_list` | index.js:10190 | `date`(string，过滤日期，缺省近 60 天) | 列出日历条目（含完成状态） |
| 12 | `calendar_done` | index.js:10204 | `date`/`time`/`title`(均必填，需与 list 结果一致) | 标记日历条目完成 |
| 13 | `calendar_remove` | index.js:10210 | `date`/`time`/`title`(均必填) | 删除日历条目 |
| 14 | `memory_consolidate` | index.js:10216 | `days`(integer,缺省 7,上限 30) | AI 主动固化（与自动沉淀互补）：读最近 N 天日志发散提炼，写入项目笔记+用户级记忆。阶段性收尾用，不替代每轮 memory_log |
| 15 | `memory_procedure` | index.js:10233 | `action`(enum write\|activate)、`title`(string,必填)、`steps`(string,必填，一行一步)、`successCriteria`(string,一行一条)、`preconditions`、`checks`、`rollback`、`riskLevel`(enum low\|medium\|high) | **T4 模型直写通路**（09-14 后新增）：把可复用流程写进 procedure memory。write=进审批列表（保守）；activate=跳统计门直接晋升+激活+自动导出 SKILL.md（authorizedBy:'model'，index.js:10275-10284）。无 successCriteria 的条目结构上无法晋升 |
| 16 | `memory_expand` | index.js:10310（条件注册：仅 `resolveBoardModePre(config.boardMode).graphEnabled` 为真时 push，index.js:10309） | `tag`(string，如 type:dead-end)、`limit`(integer,缺省 10,硬帽 20) | 白板结构化正向遍历（P3）：按 tag 展开全部匹配账本/白板条目，返回 id/标题/来源/判据状态。实现：engine.expandWhiteboardByTagPre → wb-sidecar-pre.js `expandByTagPre`(L453) |
| 17 | `memory_trace` | index.js:10314（条件注册：同上） | `id`(string，index.json 条目 id) | 白板结构化反向回溯（P3）：按条目 id 回溯 cue/tag/相邻条目/归档版本链。实现：engine.traceWhiteboardByIdPre → wb-sidecar-pre.js `traceByIdPre`(L492) |

> 历史口径：DESIGN-OVERHAUL §1.1 的「14 个 memory_* 工具」是 2026-09-10 冻结口径；14→16 是白板 graph 两工具（BUG-15 修复后真正注册成功，index.js:10306-10309 注释），16→17 是 T4，17→19 是 E 线新增的 `memory_procedure_list` / `memory_rules`。日历 4 工具（calendar_*）一直与 memory_* 并列存在。

### L3-b · 全部 56 条 HTTP 路由

- 前缀常量：宿主 `API` 表（index.js:221 起）；客户端独立维护同一批路径（`ROUTE_PREFIX='/api/dsh-auto-memory'`，client.js:1582；键表 client.js:1587-1642），两侧一致性由 tests/smoke 路径表锁保证。
- 挂载：`const routes = [...]`（index.js:13036-14329）→ `ctx.webServer.register(route)`（index.js:14409）。全部 `kind:'exact'`（实测 exact 56 / prefix 0）。
- **认证边界：全部 56 条 handler 第一行都是 `isLoopbackRequest(req)` 检查，非回环地址一律 `403 {error:'forbidden: loopback-only'}`**（如 index.js:10887）。无 token/签名机制——安全模型是「只听本机回环」。
- 方法纪律：读路由 `GET`（非 GET→405）；动作路由 `POST`（非 POST→405）；`/config` 同时接受 GET+POST/PUT（index.js:11096-11124）；少数探测类路由不检查方法（下表标「不限」）。
- 客户端消费符号：`API.<key>`（client.js:1587-1642）；「对不上界面」= client.js 无该键引用（现仅 1 条，见尾注）。

| # | 路径（前缀 `/api/dsh-auto-memory-pre` 省略） | API 键 | 注册行 | 方法 | 用途 | 消费方（client.js 侧） |
|---|---|---|---|---|---|---|
| 1 | /python-setup/status | py-setup-status | 10322 | 不限(轮询) | Python 安装进度 | PySetupWizard 轮询 |
| 2 | /python-setup/detect | py-setup-detect | 10330 | 不限 | 检测 Python 环境 | PySetupWizard |
| 3 | /python-setup/venv | py-setup-venv | 10338 | POST | 建 venv | PySetupWizard |
| 4 | /python-setup/deps | py-setup-deps | 10348 | POST | 装依赖 | PySetupWizard |
| 5 | /python-setup/model | py-setup-model | 10358 | POST | 下载模型 | PySetupWizard |
| 6 | /python-setup/cancel | py-setup-cancel | 10367 | POST | 取消下载 | PySetupWizard |
| 7 | /semantic-status | semantic-status | 10376 | 不限 | 语义资产就绪状态 | 设置页语义区块/向导 |
| 8 | /semantic-deep-detect | semantic-deep-detect | 10439 | 不限 | 快检+深扫+热接入 | 设置页环境检测 ⟳ |
| 9 | /handoff-state | handoff-state | 10448 | 不限 | 白板 PLAN+账本+版本数据 | PlanTab |
| 10 | /kanban-board | kanban-board | 10460 | 不限 | 新版看板矩阵/段视图数据（graph 档） | KanbanView（conversation.view） |
| 11 | /handoff-continue | handoff-continue | 10473 | POST | 构造接续材料（四层） | PlanTab 一键接续 |
| 12 | /handoff-permission | handoff-permission | 10489 | POST | 接续权限预设继承 | 接续流程（无独立 UI） |
| 13 | /auto-continue-state | auto-continue-state | 10510 | 不限 | 自动接续宿主状态（armed/edgeAt） | AutoContinueHost 轮询 |
| 14 | /auto-continue-decide | auto-continue-decide | 10522 | POST | 同意/拒绝接续 | AutoContinueHost 确认卡 |
| 15 | /subagent-gc | subagent-gc | 13250 | GET | 子代理痕迹回收（dryRun 参数）——**消费方已停用**：`subagentGcEnabled` 用户配置为 `false`，双早退 gate ⇒ 路由仍注册但不再产生搬移 | **client.js 零引用**（UI 只有 `subagentGc*` 两个开关键，client.js:7662-7664） |
| 16 | /semantic-download | semantic-download | 10570 | POST | 下载 JS 语义模型 | 设置页/向导 |
| 17 | /semantic-emit | semantic-emit | 10590 | POST | 唤起注入档位（canary/shadow 等） | 设置页 emit 下拉/向导 |
| 18 | /shadow-recent | shadow-recent | 10616 | 不限 | shadow 观测记录（供回顾打分） | RefineTab |
| 19 | /review-feedback | review-feedback | 10702 | POST | 唤起决策打分（A/P/S/H/E）写入 review-queue.jsonl | RefineTab |
| 20 | /memory-hub | memory-hub | 10770 | GET 读 / POST 动作 | 三层记忆中枢：GET overview；POST consolidate/feed/render/crossfeed/promote/activate/deprecate/pin（10782-10825） | MemoryHubTab（hubAct，client.js:2747-2759） |
| 21 | /storage-manage | storage-manage | 10832 | GET 扫描 / POST 修复删除 | 存储扫描/修复/删除 | StorageTab |
| 22 | /activation-inbox-pre | activation-inbox-pre | 10866 | POST | M6 激活收件箱 | **client.js 零引用**（能力在、UI 未接；沿旧盘点口径保留标注） |
| 23 | /state | state | 10884 | GET | 记忆状态快照（注入文本/各文件正文/日历/暂离） | OverviewTab/LogsTab/NotesTab/调试中心 |
| 24 | /list | list | 10899 | GET | 日志文件列表 | LogsTab |
| 25 | /file | file | 10920 | GET | 读单个记忆文件（path 参数） | LogsTab「查看」/ReflectionsTab |
| 26 | /recall | recall | 10940 | POST | 本地记忆检索（engine.recall） | SearchTab「检索」 |
| 27 | /smart-recall | smartRecall | 10951 | POST | 分层语义检索（engine.smartRecall，单飞防抖 index.js:6441-6445） | SearchTab「智能检索」 |
| 28 | /workspaces | workspaces | 10966 | POST | 工作区清单+关系图+跨工作区总结 | OverviewTab/WorkspaceTab |
| 29 | /debug | debug | 10978 | GET | 诊断信息（运行时状态/丢弃计数） | 调试中心 DebugCenter |
| 30 | /scan-dirty | scanDirty | 10987 | GET | 扫描脏 token（mojibake/裸 JSON/超长行） | StorageTab 脏扫描 |
| 31 | /browse-dir | browseDir | 11008 | POST | 列目录（目录浏览器数据） | 设置页存储（目录浏览器） |
| 32 | /pick-dir | pickDir | 11031 | POST | 原生目录选择器（不可用时回退 browse-dir） | 设置页存储 |
| 33 | /update-check | updateCheck | 11053 | GET | 版本检查（npm registry 对比） | 面板头徽标/维护组 |
| 34 | /update | update | 11066 | POST | 执行一键更新（pnpm up） | 维护组「一键更新」 |
| 35 | /config | config | 11092 | GET+POST/PUT | 读写全部配置（GET 返回外壳 `{config,path}`；POST 为 patch 合并）。#82：读经 readJsonQuarantinePreSync、写经 writeTextAtomicPre | 设置页保存/白板页/向导（唯一写出口 saveConfigPatch，client.js:1187） |
| 36 | /note | note | 11129 | POST | 保存项目笔记（容量折叠事务在引擎侧 appendText） | NotesTab |
| 37 | /rules | rules-list | 11159 | GET | **R7**：列出用户级硬性约束条目（listRuleItemsPre） | RulesEditPanel（client.js:2639） |
| 38 | /rules/apply | rules-apply | 11178 | POST | **R7**：条目级操作（op=update/remove/append/preview） | RulesEditPanel（client.js:2647） |
| 39 | /external | external | 11207 | GET | 外部记忆源清单 | ConnectTab/向导 |
| 40 | /external-view | external-view | 11216 | GET | 查看外部源内容 | ConnectTab |
| 41 | /external-remove | external-remove | 11236 | POST | 移除已导入内容（从记忆 prompt 移除段落） | ConnectTab |
| 42 | /external-import | external-import | 11250 | POST | 导入外部源（纯链接） | ConnectTab/向导批量 |
| 43 | /reflect | reflect | 11264 | POST | 手动写反思 | ReflectionsTab |
| 44 | /reflect-auto | reflect-auto | 11275 | POST | AI 一键反思（拉日志生成） | OverviewTab/ReflectionsTab |
| 45 | /calendar | calendar | 11284 | GET 读 / POST 写 | 日历读写 | CalendarTab |
| 46 | /summarize | summarize | 11308 | POST | 生成时段总结 | OverviewTab 总结卡 |
| 47 | /greet | greet | 11324 | POST | 生成问候语（落盘 greetings/） | OverviewTab GreetingCard |
| 48 | /notices | notices | 11338 | GET | 拉取动态通知（notices.json） | 通知弹窗 |
| 49 | /models | models | 11353 | GET | provider/模型目录（子代理模型抽屉数据） | 设置页模型抽屉 |

尾注：客户端「表外裸路径」纪律——client.js:1104-1108 声明路径只能出自 API 表；旧盘点列出的 20 处裸 fetch 已收敛进表（现表含全部在用路径）。**client.js 零引用的宿主路由共 2 条**：`/subagent-gc`（引擎内部动作，无 UI 按钮；**其回收动作已判废停用**）与 `/activation-inbox`（能力在、UI 未接）。

### L3-c · 全部设置键（DEFAULT_CONFIG 115 键 · index.js:328-715）

> 口径：**顶层键 115**（2026-09-25 实测；98 → 115 为后续新增 17 键。含 `externalSources` 容器 1 个 + 其 13 子键单独列）。**下表键区仍为 98 键快照，未补录其后新增的 17 键。**与旧 85 清单的差异 = 此快照期内的 13 个新增键（核对表已列）。默认值里的具名常量：`DEFAULT_NOTE_CAPACITY_CHARS`/`DEFAULT_USER_CAPACITY_CHARS`（24000，v3.0.0 由 12000 上调）、`CAPACITY_DEFAULTS_VERSION`、`DEFAULT_WATER_LEVEL_THRESHOLD`(0.75)、`DEFAULT_AUTO_CONTINUE_THRESHOLD`(0.75)。
> 「UI 分组」列 = 设置页承载分组（client.js section 名）；「—」= 该键当前无设置页控件（仅文件/联动写入）。行号 = DEFAULT_CONFIG 内定义行。

| # | 键 | 默认（index.js 行号） | 含义 | UI 分组 |
|---|---|---|---|---|
| 1 | boardMode | 'graph'（264） | 白板形态总开关：graph=新版结构化看板/sidecar/遍历工具；legacy=旧文字白板。非法值 fail-closed 按 legacy | context |
| 2 | userMemoryDir | '~/.dsh/memory'（266） | 用户级记忆目录 | storage |
| 3 | projectMemoryDir | '.dsh-memory'（268） | 项目记忆目录名 | storage |
| 4 | memoryRoot | '~/.dsh/memory/workspaces'（270） | 集中式记忆根（旧分散结构自动迁移，index.js:2078-2082） | storage |
| 5 | injectEnabled | true（272） | 记忆注入总开关 | injection |
| 6 | injectBudgetChars | 8000（288） | 注入总预算（字符；v3.0.0 由 1600 上调，280 行注释说明 Tier-0 证据段变长的代价） | injection |
| 7 | tier0CatalogEnabled | true（291） | Tier-0 常驻目录层 | injection |
| 8 | tier0MaxTokens | 400（295） | 目录 token 硬帽 | injection |
| 9 | tier0BudgetShare | 0.25（298） | 目录占注入预算的份额上限 | injection |
| 10 | injectExcludeSources | []（308） | 注入排除来源（glob 模式） | injection |
| 11 | recentDaysInjected | 1（310） | 注入最近日志天数 | injection |
| 12 | subagentModel | ''（312） | 子代理模型 | storage（模型抽屉） |
| 13 | subagentProvider | ''（314） | 子代理 provider | storage（模型抽屉） |
| 14 | subagentReasoningEffort | ''（320） | 子代理推理强度 | storage（模型抽屉） |
| 15 | noteCapacityChars | 24000（327） | 项目笔记容量上限（字符） | injection |
| 16 | userCapacityChars | 24000（328） | 用户级记忆容量上限 | injection |
| 17 | capacityDefaultsVersion | CAPACITY_DEFAULTS_VERSION（331） | 容量默认值版本号（迁移判定） | — |
| 18 | memoryFileIndexEnabled | false（333） | M3a 只读记忆索引（旧） | — |
| 19 | memoryAnchorEnabled | false（335） | M3b anchor 写入事务（mem_ 锚点 sidecar；开启后写路径经 memory-anchor-pre.js） | semantic |
| 20 | autoConsolidate | true（337） | 每轮自动沉淀总开关 | automation |
| 21 | autoConsolidateMinChars | 240（339） | 寒暄跳过门槛 | automation |
| 22 | autoConsolidateCooldownMinutes | 30（341） | 沉淀冷却 | automation |
| 23 | autoConsolidateDailyMax | 8（343） | 每日沉淀上限 | automation |
| 24 | consolidateScheduleEnabled | true（345） | 定时做梦式固化 | automation |
| 25 | consolidateScheduleTime | '09:30'（347） | 固化触发时刻 | automation |
| 26 | consolidateScheduleDays | 7（349） | 固化回看天数 | automation |
| 27 | maintainScheduleEnabled | true（351） | 定时 30 天蒸馏 | automation |
| 28 | maintainScheduleTime | '10:00'（353） | 蒸馏触发时刻 | automation |
| 29 | handoffEnabled | true（358） | 交接白板总开关（v3.0.0 由 false 改默认开） | context |
| 30 | handoffPlanChars | 1200（360） | PLAN.md 注入预算 | context |
| 31 | handoffLedgerChars | 800（362） | 账本注入预算 | context |
| 32 | slimPlanChars | 400（368） | 精简注入时 PLAN 截断预算（新增） | context |
| 33 | slimLedgerChars | 300（369） | 精简注入时账本截断预算（新增） | context |
| 34 | rulesLayeringMode | 'self'（379） | 规则/参考分层措辞模式（off=完全回旧行为） | — |
| 35 | criteriaGate | true（385） | 白板判据门（criteria 不满足即拒绝写入，wb-contract-pre.js） | — |
| 36 | waterLevelWindowTokens | 0（387） | 窗口 token（0=自动探测） | context |
| 37 | waterLevelThreshold | 0.75（395） | 水位建议阈值 | context |
| 38 | waterLevelAdvisory | true（397） | 水位建议注入 | context |
| 39 | waterLevelAutoHandoff | true（399） | 越阈自动写骨架账本 | context |
| 40 | autoContinueEnabled | false（404） | 自动接续总开关（v3.0.0 由 true 改默认关） | context |
| 41 | autoContinueThreshold | 0.75（406） | 自动接续阈值 | context |
| 42 | autoContinueConfirmSeconds | 35（408） | 确认卡倒计时秒 | — |
| 43 | autoContinueRefreshRitual | true（410） | 接续前刷新仪式 | — |
| 44 | autoContinueRefreshTimeoutSeconds | 90（412） | 刷新仪式超时 | — |
| 45 | autoContinueCooldownMinutes | 30（414） | 接续冷却 | — |
| 46 | subagentGcEnabled | true（520，**代码默认；本机用户配置为 `false`**） | 子代理痕迹回收开关——**已判废停用**（搬移不减轻前端渲染负担） | context |
| 47 | subagentGcKeepDays | 3（522） | 痕迹兜底保留天数——**已停用**（仅 `subagentGcSweep` 读取，而该函数首行早退） | context |
| 48 | awayMinutes | 60（421） | 暂离判定阈值 | automation |
| 49 | unattendedMode | false（427） | 无人值守模式 | automation |
| 50 | unattendedAuto | false（432） | 无人值守自动检测 | automation |
| 51 | unattendedAutoHours | ['22:00-08:00']（435） | 非工作时段窗 | — |
| 52 | snapshotTieredInject | true（441） | 分层快照注入（完整/精简节奏，新增） | injection |
| 53 | snapshotMinGapRounds | 5（446） | 快照最小注入间隔轮数 | injection |
| 54 | snapshotReinjectOnCompact | true（447） | 压缩后强制重注入 | injection |
| 55 | promptLayerOverrides | {}（453） | 自定义 prompt 层覆盖（23 层清单见 L3-c.3） | injection |
| 56 | autoPopupEnabled | true（455） | 暂离回来自动弹面板 | automation |
| 57 | welcomeTourEnabled | true（457） | 首启欢迎向导 | appearance |
| 58 | autoSummaryTimes | []（459） | 定时总结时刻表 | automation |
| 59 | dayBoundaryMinutes | 450（461） | 日界（分钟） | automation |
| 60 | reflectEnabled | true（463） | 每日反思 | automation |
| 61 | reflectStyle | 'auto'（465） | 反思风格 | automation |
| 62 | locale | 'system'（467） | UI 语言 | appearance |
| 63 | externalInjectionChars | 1400（469） | 外部记忆注入预算 | injection |
| 64 | externalSources | 13 子键全 true（471-486） | 外部记忆源开关（见 L3-c.2） | 向导勾选 |
| 65 | associativeMemoryEnabled | false（489） | 主动联想记忆总开关（M7） | semantic |
| 66 | shadowRetrievalEnabled | false（491） | Shadow Retrieval（只记录不注入的观测档） | — |
| 67 | contextBridgeEnabled | false（493） | M5 上下文桥 | — |
| 68 | contextSinkMode | 'null'（495） | M5 sink 类型（引擎三联动） | （引擎联动写入） |
| 69 | activationInboxEnabled | false（497） | M6 Activation Inbox | — |
| 70 | activationSource | 'js'（500） | M6 激活来源（js/python；引擎三联动） | （引擎联动写入） |
| 71 | jsDecideCooldownRounds | 1（504） | JS 判定冷却轮数 | semantic |
| 72 | jsDecideDeltaExp | 0.01（510） | JS 档 margin 阈值 | semantic |
| 73 | jsDecideExcerptChars | 40（514） | 唤起 excerpt 长度 | semantic |
| 74 | jsDecideCandidateScheme | 'balanced'（518） | 候选方案档位 | semantic |
| 75 | jsDecideCandidatesN | 4（520） | custom 档候选条数 | semantic |
| 76 | pythonBackendWorkerPath | ''（522） | Python worker 路径 | — |
| 77 | pythonBackendExecutable | ''（524） | Python 可执行文件 | — |
| 78 | semanticEngineMode | 'auto'（526） | 语义引擎档位（auto/lex/js/python；引擎三联动主键） | semantic（下拉） |
| 79 | l0IndexEnabled | true（536） | L0 摘要检索索引开关（新增） | — |
| 80 | softInjectionEnabled | false（538） | pre-step 软注入 | — |
| 81 | contextBridgeObserveChildSessions | true（540） | 观测子会话 | semantic |
| 82 | pythonBackendEnabled | false（542） | Python sidecar 总开关 | — |
| 83 | reasoningObserverEnabled | true（544） | 思维链观察器 | semantic |
| 84 | procedurePromotionEnabled | false（546） | Procedure 自动晋升总开关 | 向导开关 |
| 85 | hubMechanicalProcedureFeedEnabled | false（557） | **T10**：机械流程切片（episode intent 截断成技能候选）解耦开关，默认关（新增，2026-09-20） | 向导开关（标「不推荐」） |
| 86 | memoryHubEnabled | true（561） | 记忆中枢总开关 | memoryHub |
| 87 | episodicMinSegments | 2（563） | episode 巩固最少段数 | memoryHub |
| 88 | episodicRetention | 256（565） | episode 保留上限 | memoryHub |
| 89 | procedureMinSessions | 3（567） | 晋升所需跨会话数 | memoryHub |
| 90 | procedureMinSuccess | 2（569） | 晋升所需成功次数 | memoryHub |
| 91 | procedureCorrectionCap | 0.3（571） | correction 占比上限 | memoryHub |
| 92 | procedureHighRiskApproval | true（573） | 高风险需人工批准 | memoryHub |
| 93 | procedureActiveLevel | 'checklist'（575） | active 注入级别 | memoryHub |
| 94 | streamingInterruptionEnabled | false（577） | 流式中断/恢复实验 | — |
| 95 | maxPacketItems | 2（579） | MemoryPacket 条目上限 | — |
| 96 | maxPacketChars | 800（581） | MemoryPacket 字符预算 | — |
| 97 | packetTtlSteps | 2（583） | MemoryPacket 存活步数 | — |
| 98 | injectionCooldownSteps | 3（585） | 注入冷却步数 | — |

#### L3-c.1 与旧 85 清单的默认值变化（键名不变、值变了的）

| 键 | 旧默认（UI-INVENTORY-RAW 时代） | 现默认 | 证据 |
|---|---|---|---|
| injectBudgetChars | 1600 | **8000** | index.js:288 及 280 行注释 |
| handoffEnabled | false | **true** | index.js:358（356-357 注释） |
| autoContinueEnabled | true | **false** | index.js:404 |
| noteCapacityChars / userCapacityChars | 12000 | **24000** | index.js:327-328 引用具名常量 |
| boardMode | （键不存在） | 'graph'（默认新版） | index.js:264（260-263 注释：2026-09-17 用户裁定） |

#### L3-c.2 externalSources 13 子键（全 true，index.js:472-485）

`workbuddy-user`、`workbuddy-profile`、`codebuddy-memory`、`claude-global`、`project-conventions`、`workbuddy-sessions`、`claude-sessions`、`codex-sessions`、`zcode-memory`、`zcode-sessions`、`kimi-global`、`kimi-sessions`、`trae-rules`。写入点：向导单源勾选（client.js:4384-4396）。

#### L3-c.3 DEFAULT_PROMPT_LAYERS 23 层文案键（index.js:592-647，非 DEFAULT_CONFIG，经 promptLayerOverrides 逐层覆盖）

动态快照层（renderMemoryDynamic 用）：`snapshotHead`(594)、`snapshotMeta`(595)、`snapshotRulesTitle`(600)、`snapshotRulesGuide`(601)、`snapshotTier0Title`(604)、`snapshotLogsTitle`(605)、`snapshotReflectionTitle`(606)、`snapshotUserTitle`(607)、`snapshotNotesTitle`(608)、`snapshotPlanTitle`(609)、`snapshotHandoffTitle`(610)、`snapshotWaterTitle`(611)、`snapshotWaterBody`(612)、`snapshotExternalTitle`(613)、`snapshotCalendarTitle`(614)、`snapshotWelcomeTitle`(615)、`snapshotWelcomeBody`(616)、`snapshotInscription`(628，每轮收尾自检，T5 恢复)、`snapshotSlimNote`(639)、`snapshotSlimRecallNote`(642)、`snapshotTail`(643)；静态纪律层（renderMemoryStatic 用，system prompt 前置）：`staticHead`(645)、`staticWriteDiscipline`(646)。规则段的标题/引导语另有独立常量 RULES_SECTION_TITLE_PRE_V1 / RULES_SECTION_GUIDE_PRE_V1（rules-layer-pre.js:252,258），与 snapshot 层措辞**必须不相同**（T7-3 断言锁定）。

### L3-d · 全部 6 处插槽注册（工程细节）

注册 API 语义：`slots.inject(name, () => slots.register({name,id,order,label}, render))` 是通用两段式——`inject` 声明要占用的插槽名并返回注册函数，`register` 提交条目（含 id 去重、order 排序、label）。插件侧 6 处全部集中在 `registerSurfaces()`（client.js:5662-5691），外层有 try/catch 留痕（注册失败打 `console.warn('[dsh-auto-memory] slot registration failed')`，client.js:5690-5692），并支持整体刷新：`refreshSurfaces()` 先依次 dispose 旧句柄再重注册（client.js:5693-5699）——语言切换/主题变化时全量重建承载面。

| # | 插槽名 | 注册 id | order | 组件 | 注册行 | 备注 |
|---|---|---|---|---|---|---|
| 1 | sidebar.footer.action | auto-memory-pre | 5 | SidebarButton（2097） | 5664-5665 | label 用 i18n t('memory') + ' (pre)'；侧栏 footer 动作位 |
| 2 | shell.overlay | auto-memory-pre | 5 | MemoryPanel（3967） | 5667-5668 | 浮层面板；位置/尺寸存 localStorage（440×560 默认） |
| 3 | shell.overlay | auto-memory-pre-dialogs | 6 | DialogHost（4157） | 5670-5671 | 7 种弹窗 + 首启向导状态机；同一插槽多 id 共存（order 6） |
| 4 | shell.overlay | auto-memory-pre-autocont | 7 | AutoContinueHost（4653） | 5673-5674 | 轮询 /auto-continue-state，armed 时出确认卡 |
| 5 | settings.section | auto-memory-pre | 25 | SettingsPage（4777） | 5676-5677 | label「自动记忆 (pre)」；接收宿主 props.close |
| 6 | conversation.view | auto-memory-pre-kanban | 80 | KanbanView（1852） | 5683-5689 | 2026-09-16「双承载面」新增；label 中英切换；与 boardMode 闸门解耦（组件内部自己取数，非 graph 档显示提示，5680-5682 注释） |

> 「one handle one scope」约束：每个 inject 返回的句柄只负责自己那次注册（dispose 不影响兄弟条目）——这就是同一 `shell.overlay` 能挂 3 个不同 id 条目的前提。宿主侧插槽目录总量（≈58-61 个，DESIGN-OVERHAUL §4.2 / 交接 §4-B）是宿主提供的可注册位集合；插件当前只占其中 4 个插槽名（sidebar.footer.action / shell.overlay / settings.section / conversation.view）。

### L3-e · 数据文件清单（生产者 → 消费者）

路径基准：`DSH_HOME` = dsh-home-pre.js 单点解析（`resolveDshHomePre`，默认 `~/.dsh`，可被环境变量 `DSH_HOME` 覆盖，DSH_HOME_ENV_PRE_V1，dsh-home-pre.js:52-114；引擎侧 index.js:72 import，55 处 `dshHome()` 调用）。项目侧根 = `<memoryRoot>/<工作区键>/`（集中式；`projectDirOf`，index.js:2060-2076；旧分散结构 `<工作区>/.dsh-memory` 首次访问自动复制迁移，index.js:2078-2082）。`<projectDir>` 默认即集中式项目目录，内部布局与旧 `.dsh-memory/` 相同。

#### L3-e.1 记忆正文（Markdown）

| 文件/目录 | 生产者 | 消费者 |
|---|---|---|
| `<projectDir>/MEMORY.md` | memory_note(kind=note)、memory_consolidate、30 天蒸馏、hub flush（hubFlushTick 治理式写入 index.js:9098）、外部源导入（target=project） | 注入快照、memory_read、/state、NotesTab、R7 规则解析（rules-layer-pre.js:142 真源）、m4 语料 |
| `<projectDir>/<YYYY-MM-DD>.md`（每日日志） | memory_log、自动沉淀 | 注入快照（recentDaysInjected）、memory_recall/read、蒸馏/固化输入、m4 语料 |
| `<projectDir>/reflections/YYYY-MM-DD.md` | memory_reflect、/reflect、/reflect-auto | 注入快照（最近反思）、memory_read、ReflectionsTab |
| `<projectDir>/handoff/PLAN.md` | memory_note(kind=plan)（重写前旧版归档，index.js:2248-2266） | 注入快照首位、/handoff-state、PlanTab、接续材料第 0 层（index.js:4022）、白板语料 |
| `<projectDir>/handoff/handoff-*.md`（交接账本） | memory_note(kind=handoff)（append-only，index.js:2355-2369） | 注入快照、/handoff-state、PlanTab、接续材料、白板语料 |
| `<projectDir>/handoff/archive/PLAN-<ts>.md` 等 | PLAN 重写/账本流程的自动归档 | PlanTab 历史版本、memory_trace 版本链、白板语料（archive 目录也进检索语料，index.js:2622） |
| `~/.dsh/memory/MEMORY.md`（用户级） | memory_user、memory_consolidate、外部源导入（target=user） | 注入快照（跨项目必须遵守）、LogsTab 用户画像卡（client.js:2581）、R7 规则编辑（rules-edit-pre.js 直接编辑此文件，rules-edit-pre.js:7） |
| `~/.dsh/memory/CALENDAR.md` | calendar_add/done/remove_pre、/calendar、CalendarTab | 注入快照（未完成日程）、calendar_list；**anchor 事务豁免文件**（index.js:334 注释） |
| `<projectDir>/greetings/<date>.json`（旧 .md） | /greet 问候生成 | OverviewTab GreetingCard（index.js:2145-2147） |
| `<projectDir>/archive/` | 容量折叠与蒸馏的原文保底归档（memory_note/maintain 超限链路） | 「信息不丢」承诺的落地；不再注入 |

#### L3-e.2 白板结构化（graph 档 sidecar）

| 文件/目录 | 生产者 | 消费者 |
|---|---|---|
| `<projectDir>/handoff/index.json` | writeSidecarEntryPre / rebuildSidecarIndexPre（index.js:2411-2455；缺失即重建） | /kanban-board（看板矩阵 buildKanbanPre/buildKanbanMatrixPre）、memory_expand/trace_pre、wbTagMap |
| `<projectDir>/handoff/events.jsonl` | appendSidecarEventPre（append-only，index.js:2436-2443；criteria.passed/warned 事件链） | 看板面板直读（P2-5 白名单放行 sidecar 产物，index.js:4215）；缺失时退化为「以文件存在为准」（index.js:2422） |
| `DSH_HOME/memory/index-pre/files/`（anchor sidecar 库） | memory-anchor-pre.js 事务（buildSidecar/planMigration，memory-anchor-pre.js:258,364；memoryAnchorEnabled=true 时启用，index.js:5838-5843,9081） | mem_<32hex> 按 id 展开原文（expandMemoryRecordPre）、memory_read/expand 的字节区间定位、CorpusRegistry 语料（index.js:9130,9504） |

#### L3-e.3 记忆中枢三店 + 影子管线（JSON/JSONL）

| 文件/目录 | 生产者 | 消费者 |
|---|---|---|
| `DSH_HOME/memory/hub-pre/episodes.json` | episodic store（hubIo 原子写：tmp+rename，index.js:9030-9043）；episodic.append/consolidate | 启动 restore（index.js:9067-9072）；/memory-hub overview |
| `DSH_HOME/memory/hub-pre/facts.json` | fact store（crossFeed fact 分支、ingestJudgementRows） | 同上；checklist 渲染 |
| `DSH_HOME/memory/hub-pre/procedures.json` | procedure store（memory_procedure 直写、promote/activate/deprecate） | 同上；/memory-hub 审批动作；SKILL.md 导出源 |
| `DSH_HOME/memory/hub-pre/flush-state.json` | hub flush 去重账（index.js:9101-9102） | 同上（幂等 flush） |
| `DSH_HOME/memory/semantic-pre/judgement-shadow.jsonl` | Python/JS 语义引擎影子判定 | hub 60s 轮询喂数（index.js:9093-9098）；T10 关闭时机械切片支路不消费 |
| `DSH_HOME/memory/semantic-pre/activation-shadow-v2.jsonl` | 激活影子观测 | /shadow-recent（RefineTab 展示，index.js:10624） |
| `DSH_HOME/memory/semantic-pre/review-queue.jsonl` | /review-feedback 打分写入（index.js:10713） | 反哺唤起决策 |
| `DSH_HOME/memory/semantic-pre/l0/`（l0-index-<hash>-<layer>.json） | l0-index-sync-pre.js（L0_INDEX_FILE_PREFIX，l0-index-sync-pre.js:43,59；l0IndexEnabled 门，index.js:9334-9353） | L0 摘要列表检索（memory_recall format=l0） |
| `DSH_HOME/memory/evidence-pre/events/<date>.jsonl` | evidence-store-pre.js append（evidence-store-pre.js:135-136；success evidence 驱动晋升，index.js:7523-7530） | evidence 聚合（aggregates/index.json，evidence-store-pre.js:274-278） |
| `DSH_HOME/memory/cont-seq.json` | 接续序号分配器（全局单调，index.js:3271-3276；写入失败降级内存计数，3296） | 交接账本命名/接续材料序号 |

#### L3-e.4 配置与诊断

| 文件/目录 | 生产者 | 消费者 |
|---|---|---|
| `DSH_HOME/dsh-auto-memory-pre.json`（引擎配置文件，`_configPath`，index.js:1213） | /config POST（patch 合并→writeTextAtomicPre 原子写，index.js:1943,1963）；损坏隔离 `.corrupt-<ts>`（readJsonQuarantinePreSync，index.js:1890-1894；#82 状态透出 index.js:7926） | 引擎启动加载、GET /config、/debug（含 corrupt 状态） |
| `DSH_HOME/skills/<dirName>/SKILL.md` | exportSkillForPre（skill-export-host-pre.js:66-70；根目录 resolveSkillsRootPre 29-36） | DSH 技能发现路径（跨项目迁移）；<dirName>=skillDirNamePre（如 mem-skill-untitled-<hash>） |
| `DSH_HOME/subagent-gc-backup/` | `lib/subagent-gc.js`（痕迹移动不删除）——**回收已判废停用，该目录只存量不增量** | 旧回收备份（client.js:1164/1171 文案） |
| 通知 `notices.json`（仓库分发面） | 发布链维护 | /notices → 通知弹窗 |
| 语义资产（JS 模型 `E5_SMALL_Q8_MANIFEST_PRE_V1`、Python venv/模型） | python-setup-pre.js / createSemanticDownloaderPre（/python-setup/*、/semantic-download） | semantic-js-pre.js / python-sidecar-client-pre.js 推理；`embedding-config.json`（语义引擎配置，index.js:6754 提及） |

#### L3-e.5 只读外部数据

| 数据 | 生产者 | 消费者 |
|---|---|---|
| 历史 DSH 会话 `session.v3.jsonl(.zstd)` 等（~/.dsh/sessions） | DSH 宿主 | 候选名匹配（index.js:2885）、会话全文检索 searchSessionHistory（engine._sessionQuery 宿主服务，index.js:9666-9667）、subagent-gc 扫描 |
| 外部 AI 工具记忆/会话（WorkBuddy/CodeBuddy/Claude/Codex/ZCode/Kimi/TRAE 的既有文件） | 各外部工具 | memory_external list/import（纯链接）；/external* 路由 |

### L3-f · 关键调用链（函数级）

#### f.1 写入链（每轮自动沉淀 → episode → crossFeed → 三店）

1. 会话轮次结束 → 引擎自动沉淀评估（`autoConsolidate` 门 + 寒暄门槛 `autoConsolidateMinChars` + 冷却/每日额度，核心方法体在 index.js:7490-7495：`combined.length < minChars` 跳过、`runtime.lastConsolidateAt` 记账、`this._autoCallCount` 计数）。
2. 日志/笔记写入：`memory_log` 工具与自动沉淀共用 `engine.appendText`（append-only；容量折叠事务在 memory-writer-pre.js 的 MemoryDocumentStore，index.js:29 import）。
3. 记忆中枢支路（`memoryHubEnabled` 门，index.js:7499-7522）：`hub.stores.episodic.append({sessionRef,userText,assistantText,kind,eventSeq})`（7502）→ 本地计数 `_hubEpBuffer` 攒够 `episodicMinSegments`（7511-7514）→ `episodic.consolidate()` 巩固成 episode（7515，段数不足即丢弃缓冲）→ **`hub.crossFeed(sessionRef)`**（7517；memory-hub-pre.js:145）。
4. crossFeed 举一反三（memory-hub-pre.js:145-）：success episode → procedure 观察条目（`procedure_candidate`）；未决事实 → fact 候选（`semantic_candidate`/`profile_candidate` 映射表 memory-hub-pre.js:34）。写入前必须过清洗器（intent-clean-safe-pre.js `stripRuntimeIntentPre`，memory-hub-pre.js:175-183,290-312 的「未清洗 intent 不得进 facts.json」纪律）。
5. success evidence 支路（M9，index.js:7523-7530）：`contextHost.recentEvidenceForSuccess(5min)` 检测本轮记忆被 read/cite → `procs.addEvidence(success)`（evidence 事件经 context-bridge-pre.js `createSuccessEvidencePre`，index.js:37）→ 累积到 `procedureMinSuccess` 门槛后可晋升。
6. 持久化：三店 io = `hubIo('<name>.json')` 原子写（tmp+rename，index.js:9032-9035），启动时逐条校验 restore、坏记录跳过（9066-9072）。
7. 影子喂数支路（60s 轮询，index.js:9093-9098）：`semantic-pre/judgement-shadow.jsonl` 增量行 → heading 富化（语料来自 sidecar）→ fact store 治理式写回 MEMORY.md（hubFlushTick，去重账 flush-state.json）；**T10**：机械 procedure 切片支路受 `hubMechanicalProcedureFeedEnabled` 门（默认 false，index.js:9063），关闭时只保留模型直写来源。

#### f.2 召回链（检索 → 融合 → 注入）

**工具检索（memory_recall → engine.recall，index.js:5989-6210+）**：

1. 入口分派：`expand` 指定 mem_id → `expandMemoryRecordPre`（按 anchor sidecar 字节区间直取原文，5990-5991）；`scope=handoff` → `searchHandoffCorpus`（白板语料词法直返，6000-6005）；`scope=sessions` → `searchSessionHistory`（宿主 sessionQuery 服务，6007-6014）。
2. 本地扫描：`scanFile` 逐层词法打分（6025-6033，任一词命中 OR、按命中词数排序）；读侧状态解析统一走 note-status-apply-pre.js（`readRecordStatusPre` 动态 import，6024——**单一解析点**纪律：与写侧 note-status-pre.js 共用语法，防读写口径漂移）。
3. L0 模式（format=l0，默认）：`buildL0IndexPre`（l0-extract-pre.js）构建候选 + `isRetrievablePre` 过滤 superseded/retracted + `groupL0ByLayerPre` 分层（6068-6078）。
4. 语义臂（语义引擎可用且非 l0Mode）：embedding 召回 → 重要性加权（evidence 聚合 `scanEvidenceEventsPre`+`aggregateEvidenceEventsPre` → `computeImportancePre`，动态 import 6162-6163）→ 时间衰减（`temporal-parse-pre.js`，6183）→ **RRF 融合 `rankFusionRRFPre`**（recall-fusion-pre.js:55，K=60，层序 project→whiteboard→user→reflection→log，动态 import 6200-6205）。
5. 智能检索（/smart-recall）：`engine.smartRecall` → `_smartRecallCore`（单飞防抖 `_smartRecallFlight`，index.js:6441-6449），分层语义管线，供检索页「智能检索」。

**注入链（每轮 prompt 组装）**：

1. `buildTierLayerInjection(agent)`（index.js:5141）预计算 Tier-0 目录（tier0-catalog-pre.js 纯内存生成，`tier0CatalogEnabled`/`tier0MaxTokens`/`tier0BudgetShare` 三重预算，5145,5206 调 `composeTieredInjectionPre`（tier-layer-inject-pre.js:497））→ 挂 `state.tier0LayerText`。
2. `renderMemoryDynamic(context)`（index.js:5447）组装动态快照：规则段（`extractRulesLayerPre` 从 MEMORY.md 解析规则/参考两层措辞，5483；`renderRulesSectionPre` rules-layer-pre.js:238）→ Tier-0 目录（5530）→ 日志/反思/用户记忆/笔记/白板/账本/水位/外部/日历/欢迎回来（各段标题即 DEFAULT_PROMPT_LAYERS 的 snapshot* 键）→ 铭文收尾自检（snapshotInscription）→ 精简档替换说明（snapshotSlim*）。预算封顶 `injectBudgetChars`，防止击穿前缀缓存的设计说明在 index.js:5194 一带。
3. `renderMemoryStatic`（静态纪律层，system prompt 最前，index.js:644-646 两键）每轮固定注入写入纪律。
4. 状态标记透出：superseded/retracted 记录带「⚠已作废/⚠已撤回」标记进检索与注入（l0-extract-pre.js:278 等）。

#### f.3 水位/接续链（水位测量 → arm → 确认卡 → 交接）

1. 水位测量：water-window-pre.js——`parseModelWindowsPre`(19)/`pickWindowPre`(62) 从模型窗口表取窗口，`findOfficialContextWindowPre`(176) 从会话事件找官方上下文声明，`scanPressureSignalsPre`(132) 压力信号，`findSessionModelPre`(92)；结果带 5 分钟 TTL 缓存 `reusableWindowCachePre`(220)。窗口 token 显式配置（waterLevelWindowTokens）或模型未知时**永不测量**（fail-closed，index.js:2939,3068）。
2. arm 判定：`shouldArmAutoContinuePre(wl)`（water-window-pre.js:259；调用点 index.js:3375-3377——不满足即不出确认卡）。
3. 确认卡：AutoContinueHost（client.js:4653）轮询 `GET /auto-continue-state`（index.js:10510-10520，`engine.autoContinueState(sessionId)`）→ 用户点同意/拒绝 → `POST /auto-continue-decide`（10522-10534，`engine.decideAutoContinue(action, edgeAt)`）→ 越阈同时自动写骨架账本（`waterLevelAutoHandoff`）。
4. 刷新仪式（`autoContinueRefreshRitual`，默认开）：接续前让旧 Agent 刷新 PLAN+账本（提示词模板 index.js:3721 一带；超时 `autoContinueRefreshTimeoutSeconds`=90）。
5. 材料组装：`POST /handoff-continue`（index.js:10473-10487）→ 四层材料：第 0 层白板 PLAN 节选（3000 字符，4022）→ 第 1 层最近账本 → 第 2 层近期线程 → 第 3 层完整转写；`handoffEnabled=false` 时明确告知模型不要找 PLAN（4021）。权限预设继承走 `POST /handoff-permission`（10489-10508，客户端在接续时带 attempts 重试节奏调用，client.js:3074,3081）。
6. 接续序号：`contSeqFile()`（`DSH_HOME/memory/cont-seq.json`，全局单调防重号，index.js:3271-3357）。

#### f.4 技能审批链（T4/R1-R6/晋升/SKILL 导出）

1. 模型直写：`memory_procedure`（index.js:10242-10298）→ 校验（procedure-store-pre.js `validateProcedureCandidatePre`，L97）→ `procs.add(...)` 入 observed/candidate（action=write，10272 前段）。
2. 模型直通：action=activate → `procs.promote(pid, {}, {authorizedBy:'model'})`（10275，跳统计门）→ `procs.activate(pid)`（10276-10290）→ `exportSkillForPre` 导出 SKILL.md（10284，skill-export-host-pre.js）。
3. 用户审批：MemoryHubTab（client.js:2724）→ `hubAct(action, procedureId)`（2747-2759）→ `POST /memory-hub {action: promote|activate|deprecate|pin}`（index.js:10791-10825，走 store 门槛判定不绕 gate）→ 返回 `{decision, reason, reasonCodes}` → UI 显示人话（R2：reasonCodes→人话映射 whyNotPromotable，client.js:2604-2627；R3：stage 中文 stageLabel，2598；issue #30 注释 2753-2754）。
4. 晋升门：`PROCEDURE_DEFAULT_GATES_PRE_V1`（procedure-store-pre.js:56：minSessions=3、minSuccess=2、correctionCap=0.3）+ 高风险（riskLevel=high）需 `procedureHighRiskApproval` 人工批准；无 successCriteria 结构性无法晋升。
5. 注入：active 技能按 `procedureActiveLevel`（checklist 完整步骤 / 高风险自动降 hint）在相似场景自动附上（memory-hub render checklists，/memory-hub POST action=render，index.js:10784）。

#### f.5 配置链（#82 原子写入 + 损坏隔离）

1. UI 草稿：SettingsPage `set(key,value)`（本地 state，dirty 标记）→「保存设置」→ `saveConfigPatch(patch)`（client.js:1187，**唯一写出口**；白板页/向导同源，client.js:5377 注释）。
2. 宿主：`POST /config`（index.js:11092-11127，method=POST/PUT）→ patch 合并进 engine.config → `writeTextAtomicPre`（config-io-pre.js:72：tmp 文件 + rename 原子替换；同步版 72 行导出，index.js:1943,1963 调用）。
3. 读取：`readJsonQuarantinePreSync`（config-io-pre.js:117）——解析失败先 `quarantineFilePreSync`(55) 把坏文件改名 `<name>.corrupt-<ts>` 留存（CORRUPT_QUARANTINE_PREFIX_PRE_V1，37），再返回 `{ok:false,corrupted:true,quarantined,reason}`（index.js:1890-1894,1917-1921）；截断判活 `looksTruncatedJsonPre`(140)。corrupt 状态经 /debug 与 /config 暴露（index.js:7926）。
4. 出厂值合并：DEFAULT_CONFIG（index.js:258-586）+ 用户落盘值；`capacityDefaultsVersion`（331）驱动容量默认值的版本迁移。

#### f.6 外部记忆链（发现 → 链接导入 → 注入）

1. 发现：引擎扫描各外部工具的已知路径（memory_external action=list；/external GET，index.js:11207-11214）。
2. 导入：action=import（`/external-import` POST，11250）→ **纯链接模式**：只在 MEMORY.md/用户记忆写一条源文件绝对路径指针（不抄内容，防脏数据与过期）。
3. 注入：`externalInjectionChars`（1400）预算下注入源清单/指针段（snapshotExternalTitle 段）；`externalSources` 13 子键控制哪些源参与。
4. 管理：ConnectTab（/external-view 查看原文、/external-remove 从记忆 prompt 移除已导入段落）。

### L3-g · 生效模块清单与「陈旧副本」对照

宿主静态 import（index.js:29-85）+ 动态 import（运行期 `await import(...)`）的模块才是生效代码；同名无 `-pre` 的 `lib/*.js` 是陈旧副本**不生效**（只有 `ws-overview-rank.js` 本身无 `-pre` 同名问题，是生效的）。

**生效模块（静态 import，index.js:29-85）**：memory-writer-pre、fs-retry-pre、memory-anchor-pre、shadow-host-pre、context-host-pre、degrade-pre、context-bridge-pre、m7-index-sync-host-pre、activation-host-pre、semantic-js-pre、semantic-decide-pre、l0-index-sync-pre、engine-identity-pre、python-sidecar-client-pre、python-setup-pre、episodic-store-pre、fact-store-pre、procedure-store-pre、skill-export-host-pre、memory-hub-pre、intent-clean-pre、intent-clean-safe-pre、storage-manage-pre、ws-overview-rank、subagent-gc-pre、water-window-pre、m4-corpus-pre、tier-layer-inject-pre、memory-envelope-pre、memory-mutation-pre、wb-contract-pre、board-mode-pre、dsh-home-pre、rules-edit-pre、config-io-pre、wb-sidecar-pre、rules-layer-pre、memory-index-pre。
**生效模块（二跳静态 import）**：evidence-store-pre（context-host-pre.js:26 引）、context-sink-python-pre（context-host-pre.js:27）、m7-wire-pre（context-sink-python-pre.js:10 与 index-sync-pre.js:17）、index-sync-pre（m7-index-sync-host-pre.js:23）、note-status-pre（note-status-apply-pre.js:21）、skill-export-pre（skill-export-host-pre.js:20）、l0-index-pre（l0-index-sync-pre.js:38）。
**生效模块（动态 import，index.js 运行期）**：note-status-apply-pre（5924,6024）、l0-extract-pre（4065,6068-6078,6302-6307）、evidence-agg-pre（6162）、memory-importance-pre（6163）、temporal-parse-pre（6183）、recall-fusion-pre（6200）。
**协议库（自包含、有 smoke 套件但未被 index.js 引用）**：acceptance-pre（smoke-test-p5-acceptance-pre.mjs）、ledger-criteria-pre（smoke-test-p1-ledger-criteria-pre.mjs）、state-commit-pre（smoke-test-state-commit-pre.mjs）。
**client.js**：手写 `__ModuleLoader__` bundle（单文件、无构建链、依赖仅宿主 seed 表），浏览器半边；与宿主通过 HTTP 路由 + 插槽两个契约面连接（client.js:1,11）。

> 提醒（交接 §3.3 纪律 3 的工程依据）：「PR merge 成功 ≠ 修复落地」——PR 常改 `lib/*.js` 陈旧副本。核对任何行为的 file:line 时，若目标在无 `-pre` 后缀文件里，先确认它是否被 index.js import（见上表）。

---

## 附 · 枚举方法与本文边界

- **枚举方式**：临时 node 脚本（OS 临时目录，未落仓库）对 lib/index.js / lib/client.js / lib/*-pre.js 做结构化提取——`defineTool(` 调用逐个解析参数块；`const routes = [` 数组按花括号配对逐条提取 kind/path/handler 行号与方法分支；`DEFAULT_CONFIG`/`DEFAULT_PROMPT_LAYERS` 按行号区间提取顶层键；`slots.inject(`/`section('`/页签数组逐一 grep 定位；`set('key'` 按分组区间归类。未采用手工抄录。
- **本文不做的事**：未运行任何服务、未跑测试套件、未启动宿主、未写 lib/。所有结论来自源码静态读取。
- **行号时效**：file:line 以 2026-09-20 工作区状态为准（index.js=11,463 行、client.js=5,706 行）。`lib/` 归 DSH 线持续演进，行号会漂移——引用时建议连同符号名（函数/常量名）一起定位。
- **与三份上位文档的关系**：DESIGN-OVERHAUL-PRE-RESEARCH.md §2 的量化数据（三套设计语言、样式审计、冷启动断点）本文未重做、未复述；UI-INVENTORY-RAW.md 的 85 键清单已被本文 L3-c（**当前实测 115 键**，快照期记 98 键）取代，差异在核对表与 L3-c.1；交接文档 §4-A 的 17/49/85/6 四个数字已在核对表逐一核销。
- **给 4-B（架构文档）与 4-C（首页）的接力提示**：插槽全表见 L2.1/L3-d；路由认证边界（loopback-only 403，无 token）见 L3-b 表头；能力宣传素材的数字口径以本文核对表为准（尤其「85 键」应更新为 **115 键**；2026-09-25 代码实测）。
