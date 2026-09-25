# 设置页信息架构（IA）改造方案 · 2026-09-22

> 目标（用户原话）：「让用户首先能看懂，知道怎么调设置。」
> 幅度：**A 档 = 大幅重排 + 人话化**。按「用户想做什么」重新分组，不按代码模块分组；每项配一句「改了会怎样（关了会怎样）」；就地内联说明 + 推荐值标记；**不动任何逻辑，纯前端**。
> 本文档只描述方案，不实施。所有行号取自 2026-09-22 当日 `lib/client.js`（该文件正被 Lead 并发修改，行号会漂移；**实施前必须重新取证行号**，见 §5 纪律）。
> 结论凡属推断一律标「推断」。

---

## 0. 取证方法与基线（先看这一节，避免把行号当常量）

| 事实 | 值 | 取证方式 |
| --- | --- | --- |
| 宿主可写配置键总数 | **101** | `lib/index.js` `DEFAULT_CONFIG`（起始 `index.js:247`）逐键解析 |
| `/config` 写入白名单 | **严格 = `Object.keys(DEFAULT_CONFIG)`** | `index.js:11342`；非此集合的键**永远写不进去** |
| 设置页分区数 | **8** | `SettingsPage()` @ `client.js:5718`；`section()` 调用共 8 处 |
| 设置页渲染出的行数 | **70 个 `field(...)` 行** | 逐行解析（本次实测，替换旧审计的 81） |
| 有行但只间接渲染的键 | **68** | 见 `docs/internal/SETTINGS-GAP-AUDIT-20260922.md` 基线 + 本次复算 |
| **完全没有行的键** | **24**（含 `capacityDefaultsVersion` 等 5 个内部键） | 见 §1.2 |
| 分区导航 | `nav[data-dam-settings-nav]` @ `client.js:6003`，由 `sectionLabels` 对象 `Object.keys()` 生成 | `sectionLabels` @ `client.js:5989` |
| 锚点 id | `section(id) = 'dam-settings-' + key` | `client.js` 内 `jumpToSection()` |

**四条必须记住的实现事实**（决定了改造的可行边界）：

1. **导航顺序 = `sectionLabels` 的键顺序**（`client.js:6003` 用 `Object.keys(sectionLabels).map`）。新增/重排分区**只需改这一个对象的键序**，DOM 会自动跟随。
2. **锚点 id 由 `section(key)` 的第一个参数拼成**（`'dam-settings-'+key`）。改 `key` 名字 = 改锚点 id = 老书签/深链失效（本项目内部无深链引用，风险低，但必须一次性改齐）。
3. **i18n 缺键不报错、静默回落中文**：`t(key)` 走 `I18N[locale][key] || I18N.zh[key]`；本次实测 `t()` 用到 **443 个键**，zh/en 各缺 **6 个**（`detecting`、`hubWhyHasCorrection`、`hubWhyDiversity`、`hubWhySuccess`、`hubWhyCorrectionRate`、`hubEvLine`）——这 6 个**不在设置页**，属记忆中枢卡片区，顺手一起补。
4. **一个下拉会同时改 3 个键**：`onEngineModeChange`（`client.js:5993-6006`）在改 `semanticEngineMode` 时**同时**改写 `activationSource` 与 `contextSinkMode`。用户规则「单一开关不得顺带改变其他功能的行为」在这条上**当前已被违反**（不是本次要修的逻辑，但分组文案必须如实说明，见 §3 的 `semMode` 行）。

---

## 1. 现状问题清单（逐条附 file:line）

### 1.1 分组层面：按代码模块分组，用户找不到东西

| # | 问题 | 证据 | 用户后果 |
| --- | --- | --- | --- |
| P1 | 8 个分区名是**内部模块名**，不是用户意图 | `sectionLabels` @ `client.js:5989`：`自动记忆引擎 / 记忆中枢 / 外观 / 存储 / 记忆窗口 / 自动化 / 上下文管理 / 维护` | 想「让记忆少占点 token」的人，得先猜到「记忆窗口」；想「关掉自动生成」的人，得先猜到「自动化」 |
| P2 | 同一件事的键**被拆到 3 个分区** | 注入预算 `injectBudgetChars` 在「记忆窗口」`client.js:6232`；容量上限 `noteCapacityChars`/`userCapacityChars` 也在「记忆窗口」`client.js:6249-6250`；但两者的**概念说明**在 `fNoteCapHint`（长文解释「与注入预算不是一回事」） | 用户在两个分区之间来回找，且必须读长文才知道区别 |
| P3 | 「维护」区只有版本信息，却占了 1/8 导航位 | `section('maintenance', ...)` @ `client.js:6327`，区内首行 `fVersion` | 导航里最显眼的位置之一只放了一个「插件版本」，而 24 个可调键没有任何入口 |
| P4 | 「语义引擎」（自动记忆引擎）区里混着**下游三件套**与**校准参数** | 同区 `client.js:6007-6162`：`associativeMemoryEnabled`、`activationSource`、`contextSinkMode`、`jsDecide*` 全在一起 | 「校准参数」是给调参的人用的，普通用户只想开/关；混在一起让人不敢动 |

### 1.2 覆盖层面：24 个键在设置页**完全没有入口**

以下键在 `SettingsPage()` 全span（`client.js:5718`–`6706`）内**零出现**（实测 `inSettings=false`），且客户端全文件零引用 ⇒ 只能手改 `dsh-auto-memory.json`：

| 键 | 宿主默认 | 宿主读取行 | 影响 |
| --- | --- | --- | --- |
| `tier0BudgetShare` | `0.25` | `index.js:289,300,5263,5282,5687` | 目录层占注入预算比例 |
| `slimPlanChars` | `400` | `index.js:370,5452,5456` | 精简版白板预算 |
| `slimLedgerChars` | `300` | `index.js:371,5452,5458` | 精简版账本预算 |
| `autoContinueConfirmSeconds` | `35` | `index.js:410,3504` | 接续确认卡倒计时 |
| `autoContinueCooldownMinutes` | `30` | `index.js:416,3495` | 接续冷却 |
| `snapshotTieredInject` | `true` | `index.js:443,10081,10142` | 快照分级注入 |
| `shadowRetrievalEnabled` | `false` | `index.js:493`（**仅定义，无读取**） | **疑似死键**（推断：可能已废弃） |
| `contextBridgeEnabled` | `false` | `index.js:495`（**仅定义**） | **疑似死键** |
| `activationInboxEnabled` | `false` | `index.js:499,11106` | 唤起收件箱 |
| `pythonBackendWorkerPath` | `''` | `index.js:524,9866` | Python worker 路径（发烧友） |
| `pythonBackendExecutable` | `''` | `index.js:526,9865` | Python 解释器路径（发烧友） |
| `l0IndexEnabled` | `true` | `index.js:538,9510,9547,9569` | L0 索引 |
| `softInjectionEnabled` | `false` | `index.js:540`（**仅定义**） | **疑似死键** |
| `pythonBackendEnabled` | `false` | `index.js:544,2076,2080,6946` | Python 端总开关 |
| `streamingInterruptionEnabled` | `false` | `index.js:597`（**仅定义**） | **疑似死键** |
| `maxPacketItems` | `2` | `index.js:599`（**仅定义**） | **疑似死键** |
| `maxPacketChars` | `800` | `index.js:601`（**仅定义**） | **疑似死键** |
| `packetTtlSteps` | `2` | `index.js:603`（**仅定义**） | **疑似死键** |
| `injectionCooldownSteps` | `3` | `index.js:605`（**仅定义**） | **疑似死键** |
| `autoContinueRefreshRitual` | `true` | `index.js:412,3886,4406` | 接续前刷新仪式；仅被控件提示提到（`client.js:3832`） |
| `autoContinueRefreshTimeoutSeconds` | `90` | `index.js:414,3928` | 同上超时；仅 `client.js:3761` |
| `unattendedAutoHours` | `['22:00-08:00']` | `index.js:431,437,4801,4810` | 免打扰时段；**被 `fUnattendedAutoHint` 点名**（`client.js:6272`）却无控件 |
| `autoContinueThreshold` | `0.75` | `index.js:408,3492,3678` | 接续水位阈值；只在浮层展示（`client.js:3893+`） |
| `capacityDefaultsVersion` | `24` | `index.js:333,1928-1990` | **内部迁移版本号，不应出现在界面** |

> **判断**：7 个「仅定义无读取」的键（`shadowRetrievalEnabled`/`contextBridgeEnabled`/`softInjectionEnabled`/`streamingInterruptionEnabled`/`maxPacketItems`/`maxPacketChars`/`packetTtlSteps`/`injectionCooldownSteps`，共 8 个）**不应新增 UI**——给不生效的开关加界面等于给用户制造假控制。应单独立项做死键清理（推断：属历史实验残留）。
> `capacityDefaultsVersion` **明确不应上界面**（内部版本号）。⇒ 真正需要补入口的是 **15 个**（24 − 8 死键 − 1 内部键）。

### 1.3 文案层面：三处「说的是默认关，实际默认开」

**这是本轮最影响信任的问题**：用户判定「这功能默认关着」而实际在跑。

| # | 键 | 提示原文（zh） | 宿主真实默认 | 证据 |
| --- | --- | --- | --- | --- |
| C1 | `memoryHubEnabled` | `fMemoryHubHint`：「…关闭则只保留已有记忆，不再沉淀新内容。**默认关。**」 | **`true`（默认开）** | 提示 `client.js:161` 区块 / 默认 `index.js:575` |
| C2 | `injectBudgetChars` | `fBudgetHint`：「记忆块总预算，超出部分截断。**默认 1600**(≈400-600 token/轮)…」 | **`8000`** | 默认 `index.js:290` |
| C3 | `waterLevelWindowTokens` | `fWaterWindowHint`：「…**默认 65536**(128K 窗口的保守半量)…」 | **`0`（关闭）** | 默认 `index.js:389` |

> C2/C3 尤其严重：C2 让用户以为预算比真实值小 5 倍（实际每轮注入的上下文比用户以为的多得多）；C3 让用户以为水位/交接功能在工作，**实际该键为 0 时按提示语义等于关闭**（`fWaterWindowHint` 自述「0=关闭」）。
> 反过来 `fAssocEngineHint`「默认关」与 `associativeMemoryEnabled=false` **一致**（`index.js:491`），无需修。

### 1.4 文案层面：内部术语直接暴露给用户

| # | 位置 | 原文 | 问题 |
| --- | --- | --- | --- |
| J1 | `fProcSessionsHint`（`client.js:6168` 行提示） | 「默认 3(**M-04 元代码**)」 | `M-04` 是内部里程碑编号，用户不可能知道 |
| J2 | `fTier0Catalog` / `fTier0Max`（`client.js:6234-6235`） | 「**目录层(Tier-0 摘要)**」「**目录层 token 上限**」 | `Tier-0` 是内部层级名；同义反复两行都带它 |
| J3 | `fCriteriaGate`（`client.js:6296`） | 「账本判据门」+ 提示里的「判据(**H1-H4 / S1-S4**)」 | `H1-H4/S1-S4` 是内部判据编号 |
| J4 | `fEmitMode`（`client.js:6013` 附近） | 选项文案 `shadow 只记录` / `canary-explicit` / `active` | 三个英文档位名直接进入选项 |
| J5 | `fCandScheme`（`client.js:6017` 附近） | `balanced 3×40` / `dense` / `custom` | 同上 |
| J6 | `fProcInjectHint` | 大段解释「设置页此前的旧键『技能固化与晋升』宿主已不再读取」 | 迁移说明写进了常驻提示，新用户读不懂，老用户才需要 |
| J7 | `unattendedAutoHours`（键名） | 出现在 `fUnattendedAutoHint` 正文里 | 把**配置键名**当用户可见文案，且该键没有控件（§1.2） |

### 1.5 结构层面：提示文本本身的缺口

| # | 问题 | 位置 | 后果 |
| --- | --- | --- | --- |
| S1 | **5 行没有任何提示文字** | `fEmitMode`、`fCandScheme`、`semMode`、`fProcLevel`、`fPanelPos`（后三者的 Hint 键存在但未挂到行上/仅部分挂） | 用户只能靠标签猜，恰恰这几个是英文档位/术语最重的 |
| S2 | 提示过长（最长 4 行） | `fExcludeHint`、`fNoteCapHint`、`fPanelPosHint` | 长文挤占版面，反而没人读；应先给一句结论，细节折叠 |
| S3 | 「关了会怎样」缺失或含糊 | `fInjectHint`「自动注入 `<memory_system>` 块。」 | 没说什么情况下该关、关了会失去什么 |

### 1.6 与既有断言的耦合（决定实施风险）

设置页相关**会被文案/结构改动打红**的既有断言共 **4 条 / 3 个文件**（全库扫 `tests/` 的 `data-dam-*`、`sectionLabels`、`dam-settings`、`SettingsPage`、`f*Hint` 实测命中）：

| 断言位置 | 断言内容 | 被什么改动打红 |
| --- | --- | --- |
| `tests/smoke/smoke-test-graph-mode-pre.mjs:275` | `CLI_SRC.includes("'data-dam-key': 'boardMode'")` | 改 `boardMode` 的 `data-dam-key` 或删除浮层切换按钮 |
| `tests/smoke/smoke-test-switch-decouple-pre.mjs:279` | 统计 `'data-dam-key': 'handoffEnabled'` 出现次数 | 同上（`handoffEnabled` 的 data 属性） |
| `tests/smoke/smoke-test-switch-decouple-pre.mjs:280` | 统计 `'data-dam-key': 'autoContinueEnabled'` 出现次数 | 同上 |
| `tests/smoke/smoke-test-panel-position-pre.mjs:77` | `['fPanelPos','fPanelPosHint','posBottomLeft','posPage','posBoth']` 五个 i18n 键必须存在 | **重命名任一 i18n 键即打红** |

> 关键结论：**这些断言锁的是 `data-dam-key` 字面量与 i18n 键名，不是分区结构**。因此「重排分区 + 改 `sectionLabels` 键序」**零断言风险**；风险集中在「改 i18n 键名」与「动 `data-dam-key` 字面量」。⇒ 实施策略见 §5：**保留 `data-dam-key` 字面量与 i18n 键名，只改键值（文案内容）与新增键**。

---

## 2. 新分组方案（9 个意图分区 · 覆盖全部 101 键）

### 2.1 设计原则

1. **按「用户想做什么」命名，不按模块名命名**。每种用户意图 = 一个分区：想少花 token → 「记忆窗口」；想让它自动干活 → 「自动化」；只想改外观 → 「外观与交互」。
2. **分区按「你多半会来调它的概率」排序**：开关类在最前，参数类居中，路径/调试类靠后，版本收尾。
3. **「核心 / 高级」两级**：核心 = 普通用户会碰（每区前 1-3 行，默认展开）；高级 = 需要理解机制才会调（区内**折叠**，标题写成「高级设置」）。
4. **一个键只出现在一个分区**（消除 §1.1 P2 的跨区找键）。

### 2.2 分区表（新 → 覆盖键 → 来源）

| # | 分区 id（锚点后缀） | 建议名（zh / en） | 一句话定位 | 键数 | 核心/高级 | 覆盖键 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `engine` | 语义记忆总开关 / Memory engine | 「记忆检索这套东西，开不开、用哪套引擎」 | 7 | 核心=2，其余高级 | `associativeMemoryEnabled`、`memoryAnchorEnabled`、`semanticEngineMode`、`activationSource`、`contextSinkMode`、`jsDecideCandidateScheme`、`jsDecideCandidatesN` |
| 2 | `window` | 记忆窗口（注入什么）/ Memory window | 「每次对话自动塞给它什么背景、最多塞多少」 | 12 | 核心=4 | `injectEnabled`、`injectBudgetChars`、`recentDaysInjected`、`tier0CatalogEnabled`、`tier0MaxTokens`、`tier0BudgetShare`、`rulesLayeringMode`、`externalInjectionChars`、`promptLayerOverrides`、`snapshotMinGapRounds`、`snapshotReinjectOnCompact`、`snapshotTieredInject` |
| 3 | `capacity` | 记忆容量与归档 / Capacity & retention | 「记太多会不会撑爆、超了怎么办」 | 11 | 核心=4 | `noteCapacityChars`、`userCapacityChars`、`capacityDefaultsVersion`※、`autoConsolidate`、`autoConsolidateMinChars`、`autoConsolidateCooldownMinutes`、`autoConsolidateDailyMax`、`memoryFileIndexEnabled`、`l0IndexEnabled`、`episodicRetention`、`factRetentionMax` |
| 4 | `skills` | 自动沉淀成技能 / Skills & promotion | 「它自己总结的经验，什么条件下值得固化成技能」 | 11 | 核心=3 | `memoryHubEnabled`、`procedureInjectEnabled`、`episodicMinSegments`、`procedureMinSessions`、`procedureMinSuccess`、`procedureCorrectionCap`、`procedureHighRiskApproval`、`procedureActiveLevel`、`procedurePromotionEnabled`、`hubMechanicalProcedureFeedEnabled`、`memoryFileIndexEnabled`（跨区重复，见注） |
| 5 | `handoff` | 长会话接续 / Handoff & continuation | 「上下文快满时，怎么把工作交接给新会话」 | 18 | 核心=4 | `handoffEnabled`、`handoffPlanChars`、`handoffLedgerChars`、`criteriaGate`、`autoContinueEnabled`、`autoContinueThreshold`、`autoContinueConfirmSeconds`、`autoContinueCooldownMinutes`、`autoContinueRefreshRitual`、`autoContinueRefreshTimeoutSeconds`、`waterLevelWindowTokens`、`waterLevelThreshold`、`waterLevelAdvisory`、`waterLevelAutoHandoff`、`slimPlanChars`、`slimLedgerChars`、`subagentGcEnabled`、`subagentGcKeepDays` |
| 6 | `auto` | 自动化与免打扰 / Automation | 「定时自己做什么、什么时候别打扰我」 | 12 | 核心=5 | `consolidateScheduleEnabled`、`consolidateScheduleTime`、`consolidateScheduleDays`、`maintainScheduleEnabled`、`maintainScheduleTime`、`awayMinutes`、`unattendedMode`、`unattendedAuto`、`unattendedAutoHours`、`autoPopupEnabled`、`autoSummaryTimes`、`welcomeTourEnabled`△ |
| 7 | `store` | 存储与外部记忆 / Storage | 「记忆存在哪、要不要接别的 AI 工具的记忆」 | 11 | 核心=3 | `memoryRoot`、`userMemoryDir`、`projectMemoryDir`、`workspaceDiscoverMax`、`externalSources`、`reflectEnabled`、`reflectStyle`、`dayBoundaryMinutes`、`pythonBackendEnabled`、`pythonBackendExecutable`、`pythonBackendWorkerPath` |
| 8 | `look` | 外观与交互 / Appearance | 「界面长什么样、在哪显示、说什么语言」 | 14 | 核心=8 | `locale`、`panelPos`、`welcomeTourEnabled`、`subagentModel`+`subagentProvider`+`subagentReasoningEffort`（合成 1 行）、`injectExcludeSources`、`activationInboxEnabled`、`pythonBackendEnabled`※、`memoryFileIndexEnabled`※ |
| 9 | `about` | 关于与诊断 / About | 「版本、更新、死键说明」 | 5 | 核心=1 | `boardMode`、`softInjectionEnabled`、`streamingInterruptionEnabled`、`maxPacketItems`+`maxPacketChars`+`packetTtlSteps`+`injectionCooldownSteps`（合成 1 行「已停用的历史实验开关」） |

**合计 101 键**（`memoryFileIndexEnabled`、`pythonBackendEnabled` 各在表中出现两次，实施时**只落一处**：前者落 3，后者落 7）。

> **`capacityDefaultsVersion`（分区 3）与 8 个死键（分区 9）的处理**：
> - `capacityDefaultsVersion` = 内部迁移版本号，**不要给控件**；分区 9 用一行纯文本说明「容量上限的默认值曾于 2026-09-18 由 12000 上调至 24000，老配置会自动抬一次」，让读了文档来对账的用户能对上号。
> - 8 个死键（`shadowRetrievalEnabled`/`contextBridgeEnabled`/`softInjectionEnabled`/`streamingInterruptionEnabled`/`maxPacketItems`/`maxPacketChars`/`packetTtlSteps`/`injectionCooldownSteps`）**不要给控件**；分区 9 一行汇总说明「以下历史开关已停用，改了不会生效」并列出键名，避免用户手改 JSON 后困惑。
> - `unattendedAutoHours`（分区 6）**必须给控件**（它被 `fUnattendedAutoHint` 点名却无入口）。

### 2.3 旧 → 新 映射（实施时按此搬运，不要按旧区整块搬）

| 旧分区（`sectionLabels` 键） | 旧名 | 拆到的新分区 |
| --- | --- | --- |
| `semantic` | 自动记忆引擎 | → `engine`（校准参数）+ `look`（排除来源）+ `skills`（中枢总闸与经历层）+ `store`（Python 路径） |
| `memoryHub` | 记忆中枢 | → `skills`（全部 11 键） |
| `appearance` | 外观 | → `look` |
| `storage` | 存储 | → `store` |
| `injection` | 记忆窗口 | → `window`（注入类）+ `capacity`（容量类） |
| `automation` | 自动化 | → `auto`（定时/免打扰） |
| `context` | 上下文管理 | → `handoff` |
| `maintenance` | 维护 | → `look`（外观细节）+ `about`（版本/模式） |

**导航顺序建议（最终 `sectionLabels` 键序）**：
`engine` → `window` → `capacity` → `skills` → `handoff` → `auto` → `store` → `look` → `about`

> 顺序理由：前 4 个是「记忆本体」（是否开、注入什么、存多少、沉淀什么），中间 2 个是「时间维度」（会话太长怎么办、什么时候自动干），后 3 个是「配置与外壳」。用户 90% 的诉求落在前三项。

---

## 3. 逐键文案表（本方案优先级最高的一节）

**列含义**

- **现文案（若有）**：取自当前 zh 字典的 `f*` / `f*Hint` 实际值；「—」= 当前无该行/无提示。
- **建议标题 / 建议一行说明**：**人话口径**，规则 = ①先说「改了会怎样」 ②若「关掉」有意义，必须写明**关了会失去什么** ③不出现 `Tier-0`、`budgetShare`、`criteriaGate`、`M-04`、`H1-H4` 等内部术语。
- **推荐值/默认**：`默认` 列 = 宿主 `DEFAULT_CONFIG` 实测值；`推荐` 列 = 建议在界面上标注的档位（`★` 表示建议加「推荐」标记）。
- **类型**：`开关` / `数字` / `文本` / `路径` / `下拉(n)` / `多行` / `时间`。
- **需重启 dsh web**：`是` = 代码内有明证（见 §3.1）；`否（实测）` = 本次逐键追踪宿主读取点，值在每轮/每次请求时读取；`需实测` = 本轮**无证据**，实施时必须开机验证后在界面上标注——**不得照抄猜测**。

### 3.1 「需重启 = 是」的证据（其余键不写「是」的依据）

| 键 | 证据 |
| --- | --- |
| `boardMode` | `client.js:6356` 注释「切换需重启 dsh web 生效(工具注册在启动期)」；`client.js:3991` 切换后 `window.alert('…重启 dsh web 后生效。')` |
| `reasoningObserverEnabled` | `fReasoningHint` 自述「（重启后生效）」`client.js:234` |
| `pythonBackendEnabled` / `pythonBackendExecutable` / `pythonBackendWorkerPath` | 侧车进程在启动期 spawn；`python-sidecar-client-pre.js:563-575` 有显式 `restart()` 换代语义 ⇒ **推断**需要重启（实施前实测一次） |
| 其余 97 键 | 未发现「启动期注册/一次性读取」证据 ⇒ 标 `需实测`，**不得直接写「否」** |

> 界面上「需重启」的正确呈现方式：**不要**做成每行一个小标签（会变成噪声），而是在分区底部放一条提示「本区改动重启 dsh web 后生效」，或在改动后于顶部出现一条一行横幅「有 2 项改动需重启 → 点这里看怎么重启」。后者对普通用户更友好（推断：符合用户既有偏好「开关类改动必须即时回显」）。

### 3.2 分区 1 · `engine` 语义记忆总开关（7 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `associativeMemoryEnabled` | 标题「启用自动记忆引擎」；提示「总开关。开启后自动观测上下文、语义检索并适时唤起记忆注入(消费少量 token)。关闭则整个引擎不运行——不检索、不判定、不注入、不生成唤起记录。介意 token 消耗或担心动作跑偏的用户可关闭。默认关。」 | **自动找回相关记忆** | 开：聊到相关话题时它自己把过去的记忆找出来给你（每轮多花少量 token）。关：整套检索停止，**不会自动回忆任何东西**。 | 默认关；建议标注「介意 token 的可以一直关着」 | 开关 | 需实测 |
| `memoryAnchorEnabled` | 标题「记忆锚定索引(语料健康/存储管理)」；提示「…关闭时这些动作不可用(修复会提示 no-doc-store)，但不影响记忆读写与检索。默认关。」 | **记忆体检与删除** | 开：存储管理页能做「语料健康对比 / 修复失效记录 / 删除某条记忆」。关：这三个按钮会报错不可用，**但记和查不受影响**。 | 默认关 | 开关 | 需实测 |
| `semanticEngineMode` | 标题「检索模式」；提示「自动=内置语义就绪即用，否则词法保底；高级 Python 需另行安装。」 | **用哪套检索** | 自动（推荐）：内置引擎能用就用，不能用就退回关键词。改成 Python 需要自己另外装环境。 | 默认 `auto`；推荐 `auto` ★ | 下拉(4)：自动 / 仅关键词 / 内置引擎 / Python | 需实测 |
| `activationSource` | — | **（隐藏，跟随上方）** | 由「用哪套检索」自动决定：选内置引擎 = `js`，选 Python = `python`，其余 = `js`。 | 默认 `js` | 隐藏只读 | 需实测 |
| `contextSinkMode` | — | **（隐藏，跟随上方）** | 同上：选 Python = `python`，其余 = `null`。 | 默认 `null` | 隐藏只读 | 需实测 |
| `jsDecideCandidateScheme` | 标题「唤起候选方案」（**无提示**）；选项 `balanced 3×40` / `dense` / `custom` | **每次候选几条、每条多长** | 平衡（推荐）：3 条 × 40 字（省 token）；密集：6 条 × 20 字（联想更广、更费 token）；自定义：自己定条数。 | 默认 `balanced`；推荐 `balanced` ★ | 下拉(3) | 需实测 |
| `jsDecideCandidatesN` | 标题「自定义候选条数」；提示「custom 档的候选条数(1-8)。」 | **自定义档的条数** | 只在上一条选「自定义」时生效，范围 1-8。 | 默认 `4` | 数字(1-8) | 需实测 |

> **实施注记（必读）**：`activationSource` 与 `contextSinkMode` 在界面上是**衍生字段**——`client.js:5993-6006` 的 `onEngineModeChange` 会在切换引擎时同时改写这三个键。把它们做成隐藏只读行（或干脆不显示但在「高级」里展示当前值）才符合「一个开关只干一件事」的用户规则。**若要让它们变成真正独立可调的项，那属于改逻辑，不在本轮 A 档范围内**。

### 3.3 分区 2 · `window` 记忆窗口（12 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `injectEnabled` | 标题「注入记忆上下文」；提示「每次组装提示词时自动注入 `<memory_system>` 块。」 | **每次对话带上记忆** | 关：模型看不到任何你的记忆，**它不会再「记得」你之前说过什么**（记忆本身不会丢，只是这一轮不给它看）。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `injectBudgetChars` | 标题「注入预算(字符)」；提示「记忆块总预算，超出部分截断。**默认 1600**(≈400-600 token/轮)…」← **与实际默认 8000 不符，必改** | **每轮最多塞多少记忆** | 这一块每轮都进上下文：**调高 = 它记得更多但每轮都更贵**，调低 = 省钱但容易忘事。默认 8000 字（约 2000 token）。 | 默认 **8000**（现文案误写 1600） | 数字 | 需实测 |
| `recentDaysInjected` | 标题「注入最近日志天数」；提示「会话开始时注入最近 N 天的工作日志尾部。默认 1。」 | **带上最近几天的日志** | 开新会话时，把最近 N 天的日志结尾一起给它。设 0 就不带日志，只带记忆条目。 | 默认 `1` | 数字 | 需实测 |
| `tier0CatalogEnabled` | 标题「目录层(Tier-0 摘要)」；提示「开启时每轮注入一段「记忆目录」摘要(条目名 + 一句话结论)…默认开。」 | **先给一份记忆目录** | 开：每轮先给它一张「有什么记忆」的清单（标题 + 一句结论），需要细节时它自己再取。关：完全不注入目录，**省 token 但可能漏掉该用的记忆**。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `tier0MaxTokens` | 标题「目录层 token 上限」；提示「…默认 400。需要装下更多语料时提高这里，而不是把注入预算整体推高。」 | **目录最多占多少** | 目录这一份的硬上限。想让清单更全就只抬这一项，**别去抬总预算**（总预算抬上去会把别的东西一起放进来）。 | 默认 `400` | 数字 | 需实测 |
| `tier0BudgetShare` | **—（当前无任何入口）** | **目录占总预算的比例** | 目录最多吃掉总预算的百分之几，与上面 400 取**小的那个**生效。 | 默认 `0.25` | 数字(0-1) | 需实测 |
| `rulesLayeringMode` | 标题「规则段分层」；提示「开启后规则类记忆单独成段、每轮在场且不参与裁剪…默认开。」 | **规则永远在场** | 开（推荐）：你定的规则单列一段，每轮都在、**永远不会被挤掉**。关：退回旧行为，规则混在记忆里一起被裁剪，**长会话里可能被裁没**。 | 默认 `self`；推荐 `self` ★ | 开关（注意：值为 `self`/`off` 字符串，见注） | 需实测 |
| `externalInjectionChars` | 标题「外部记忆注入预算(字符)」；提示「外部记忆来源在上下文中的注入预算。默认 1400(路径模式下影响有限)。」 | **别家工具记忆占多少** | 只在你接入了「外部记忆来源」时才有意义；纯路径模式下影响很小。 | 默认 `1400` | 数字 | 需实测 |
| `promptLayerOverrides` | 标题「自定义记忆注入 prompt」；提示「可覆盖各层提示文案(小众功能)。支持占位符 {date} {ws} {budget} {n}。改坏了可一键恢复默认。」 | **高级：改写注入文案** | 给会改提示词的人用。改坏了点「恢复默认」即可回滚。**普通用户不需要动**。 | 默认 `{}` | 高级（折叠） | 需实测 |
| `snapshotMinGapRounds` | 标题「快照最小间隔(轮)」；提示「动态记忆快照内容变化后，至少隔 N 轮才重新注入…默认 5;0=每轮都尝试。」 | **记忆快照至少隔几轮再发** | 调小 = 更新更及时但历史膨胀快；调大 = 更省，但新写入的记忆要等更久才进上下文。 | 默认 `5` | 数字 | 需实测 |
| `snapshotReinjectOnCompact` | 标题「压缩后立即重注入快照」；提示「上下文被压缩/截断后，快照会被清掉；开启后强制立即重注入一次…默认开。」 | **压缩后自动补回记忆** | 开（推荐）：上下文被压缩后立刻把记忆背景补回去。关：压缩后短期内它会「失忆」，要靠自然轮次慢慢恢复。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `snapshotTieredInject` | **—（当前无入口）** | **高级：快照分级注入** | 按重要性分层注入快照，减少一次性塞满。**普通用户不用动**。 | 默认开 | 高级（折叠） | 需实测 |

> **`rulesLayeringMode` 实施注记**：该键的值域是字符串 `'self'`（开）/ `'off'`（关），但界面上现在是一个 **checkbox**（`client.js:6236`：`checked: String(cfg.rulesLayeringMode||'self').toLowerCase() !== 'off'`）。这是「字符串枚举被塞进布尔控件」的既有设计，**本轮不改逻辑，只改文案**：建议标题写「规则永远在场」，提示里补一句「底层有两个值 self/off，界面用开关表示」。**若要让界面显示三档，属改逻辑，需单独立项。**

### 3.4 分区 3 · `capacity` 记忆容量与归档（11 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `noteCapacityChars` | 标题「项目笔记容量上限(字符)」；提示（长文）「…默认 24000。超出时自动整理…**注意与上面的「注入预算」不是一回事**：这个管文件本体大小，注入预算管每轮往上下文塞多少摘要。」 | **项目笔记最多存多少字** | 这是**文件本身**的大小上限（不是每轮注入的量）。超了它会自动把老内容压成要点；压不动就把原文整条归档，**新记忆不会被堵在外面**。 | 默认 `24000`（= `DEFAULT_NOTE_CAPACITY_CHARS`，`index.js` 常量） | 数字 | 需实测 |
| `userCapacityChars` | 标题「用户级记忆容量上限(字符)」；提示「用户级 MEMORY.md(跨项目规则)的容量上限，默认 24000。整理方式与项目笔记相同…」 | **跨项目规则最多存多少字** | 同上，管的是「所有项目共用」那份。 | 默认 `24000` | 数字 | 需实测 |
| `capacityDefaultsVersion` | **—（内部键，勿给控件）** | **（不显示；仅在说明里提一句）** | 内部迁移版本号：容量默认值 2026-09-18 由 12000 上调到 24000 时用它保证老配置只自动抬一次。 | 默认 `24` | 隐藏（不渲染） | 否 |
| `autoConsolidate` | 标题「自动沉淀(每轮对话结束AI评估)」；提示「关闭后每轮对话结束不再自动调用 AI 评估与写入今日日志。」 | **每轮结束自动记一笔** | 开（推荐）：每轮聊完它自己判断有没有值得记的，写进今日日志。关：**什么都不记**，长期记忆要靠你手动让它记。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `autoConsolidateMinChars` | 标题「自动沉淀内容门槛(字符)」；提示「本轮 user+assistant 总字符低于此值视为寒暄跳过。默认 240。」 | **太短的闲聊就别记** | 这一轮你和它加起来不到 N 字就当寒暄跳过。调高 = 更省但容易漏记短而有用的内容。 | 默认 `240` | 数字 | 需实测 |
| `autoConsolidateCooldownMinutes` | 标题「自动沉淀间隔(分钟)」；提示「两轮自动沉淀之间的最短间隔。默认 30;非工作时间(22:00-08:00)自动翻倍…」 | **两次自动记录至少隔多久** | 防止连续几轮都触发、把每日额度烧光。非工作时间会自动翻倍。 | 默认 `30` | 数字 | 需实测 |
| `autoConsolidateDailyMax` | 标题「自动沉淀每日额度(次)」；提示「每天最多触发自动沉淀的次数，到点后当天不再调用。默认 8。」 | **每天最多自动记几次** | 到点后当天不再自动记。想更省 token 就调小。 | 默认 `8` | 数字 | 需实测 |
| `memoryFileIndexEnabled` | 标题「记忆文件索引快照」；提示「开启后额外维护一份只读的记忆文件索引快照(供外部查询)，有少量 IO 开销；默认关，关时零额外开销。」 | **给外部工具一份索引** | 开：多维护一份只读索引供别的工具查，有一点磁盘开销。关：零额外开销（推荐保持关，除非有外部工具要读）。 | 默认关 | 开关 | 需实测 |
| `contextBridgeObserveChildSessions` | 标题「分支会话观测」；提示「跨天续接的会话会被标记为分支;开启后同样纳入记忆观测。默认开。」 | **接续出来的会话也要观测** | 开（推荐）：跨天接续的会话同样被算进记忆观测，不会被当成「外来会话」漏掉。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `l0IndexEnabled` | **—（当前无入口）** | **高级：L0 摘要索引** | 记忆检索的摘要层索引，关掉会让检索退化为关键词匹配。**普通用户不用动**。 | 默认开 | 高级（折叠） | 需实测 |
| `episodicRetention` | 标题「经历保留上限(条)」；提示「保留的最近经历条数,超出按时间淘汰最旧的。默认 256。」 | **保留多少条「经历」** | 超出的按时间淘汰最旧的。调大 = 记得更久但检索慢；调小 = 更轻快但老经历会丢。 | 默认 `256` | 数字 | 需实测 |
| `factRetentionMax` | 标题「事实条数上限」；提示「事实层最多保留多少条,超出时自动淘汰:先淘汰已撤销的,再按写入时间从旧到新,重要项(置顶/用户级/显式写入/高置信度)最后淘汰。默认 1000。」 | **保留多少条「事实」** | 超了自动淘汰：先删被撤销的，再按写入时间从旧到新删，**重要项最后才删**。 | 默认 `1000` | 数字 | 需实测 |

> **分区 3 的关键收益**：把「容量上限」（文件多大）与「注入预算」（每轮塞多少）放进**同一屏但不同小节**，并在两处各写一句「不是同一回事」，直接消灭 §1.1 P2 的来回找键。

### 3.5 分区 4 · `skills` 自动沉淀成技能（11 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `memoryHubEnabled` | 标题「启用记忆中枢」；提示「…开启后三层记忆(episodic 经历 / semantic 事实 / procedural 技能)开始运行；关闭则只保留已有记忆，不再沉淀新内容。**默认关。**」← **与实际默认 true 不符，必改** | **自动整理成三层记忆** | 开：把经历/事实/技能分开沉淀。关：**只保留已有记忆，不再沉淀新内容**（不会删掉旧的）。 | 默认 **开**（现文案误写「默认关」） | 开关 | 需实测 |
| `procedureInjectEnabled` | 标题「流程记忆注入(总闸)」；提示「★流程记忆(技能固化)的总闸:关闭后既不写入流程记忆，也不把它注入提示词…注意:设置页此前的旧键「技能固化与晋升」宿主已不再读取，要改请改这一项。」 | **把总结出的技能用起来** | 总闸。关：**既不写新的技能，也不把已有技能给模型看**。提示里的迁移说明建议移到「关于」区的一行小字，别常驻在行内。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `episodicMinSegments` | 标题「经历最少对话段数」；提示「一次经历至少积累多少段对话才巩固为记忆。太少=噪声多,太多=小对话被丢弃。默认 2。」 | **聊多久才算一段经历** | 太短 = 记一堆噪声；太长 = 短对话直接被丢掉不记。 | 默认 `2` | 数字 | 需实测 |
| `procedureMinSessions` | 标题「技能晋升跨会话数」；提示「一个流程至少出现在 N 个独立会话中才考虑晋升为技能。默认 3(**M-04 元代码**)。」← 术语必删 | **同一步骤要在几个会话里出现过** | 避免只出现过一次的操作就被当成「标准流程」。 | 默认 `3` | 数字 | 需实测 |
| `procedureMinSuccess` | 标题「技能晋升成功次数」；提示「流程至少成功 N 次才可晋升。一次成功不足以证明可靠。默认 2。」 | **同一步骤要成功过几次** | 一次成功不算数，防止把偶然成功固化成技能。 | 默认 `2` | 数字 | 需实测 |
| `procedureCorrectionCap` | 标题「技能纠正容忍度」；提示「纠正/错误占该流程总证据的比例上限。超过则保持候选,不晋升。默认 0.3(30%)。」 | **纠错超过多少就不算标准做法** | 该流程的历史里「被纠正/出错」占比超过这个数，就一直停留在候选、不晋升为技能。 | 默认 `0.3` | 数字(0-1) | 需实测 |
| `procedureHighRiskApproval` | 标题「高风险流程需批准」；提示「高风险流程(SSH/部署/删除等)晋升需用户明确批准,且永不因相似度自动执行。默认开。」 | **危险操作必须我点头** | 开（**强烈建议保持开**）：涉及 SSH/部署/删除的流程要你明确批准；即使批准过，也不会仅凭「相似」就自动执行。 | 默认开；推荐开 ★（关闭有风险） | 开关 | 需实测 |
| `procedureActiveLevel` | 标题「技能注入形式」（**无提示**） | **技能以什么形式给模型** | 完整步骤（推荐）：连完成标准一起给；摘要：只给概要；提示：只说「可以参考这个技能」。高风险技能会自动降级为「提示」。 | 默认 `checklist`；推荐 `checklist` ★ | 下拉(3) | 需实测 |
| `procedurePromotionEnabled` | **—（仅向导里可设，设置页无行）** | **允许自动晋升技能** | 关：不自动把流程升格成技能，只在候选里堆着让你看。 | 默认关 | 开关（向导已有，设置页补一行） | 需实测 |
| `hubMechanicalProcedureFeedEnabled` | **—（无入口）** | **高级：机械式喂入技能候选** | 按规则机械收集候选（不靠模型判断）。**普通用户不用动**。 | 默认关 | 高级（折叠） | 需实测 |
| `factRetentionMax` / `episodicRetention` | 见分区 3 | 此处**不重复出现** | 容量类键统一放分区 3，避免跨区重复。 | — | — | — |

### 3.6 分区 5 · `handoff` 长会话接续（18 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `handoffEnabled` | 标题「交接白板」；提示「PLAN.md 全貌快照 + 四段式交接账本:模型在理解全貌/阶段完成时写入,注入动态快照首位,面板「白板」页签可实时查看,跨上下文窗口续命。」 | **白板与交接账本** | 开（推荐）：它会把「现在做到哪、下一步做什么」写下来，换新会话时接得上。关：白板不更新，**新会话要从零重新讲**。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `handoffPlanChars` | 标题「白板注入预算(字符)」；提示「PLAN.md 全貌注入动态快照的硬截断预算;全文可经 memory_read 或面板白板页查看。默认 1200。」 | **白板摘要最多多长** | 只是「塞进上下文的摘要长度」，**不删原文**，全文在面板「白板」页随时能看。 | 默认 `1200` | 数字 | 需实测 |
| `handoffLedgerChars` | 标题「账本注入预算(字符)」；提示「最新一篇交接账本注入动态快照的硬截断预算。默认 800。」 | **账本摘要最多多长** | 同上，只截摘要不删原文。 | 默认 `800` | 数字 | 需实测 |
| `criteriaGate` | 标题「账本判据门」；提示「开启时白板/账本小节必须满足判据(**H1-H4 / S1-S4**)才被采纳，防止把思考过程当结论固化。关闭只退掉这道质量门，骨架 fail-soft 仍无条件生效。默认开。」← 内部编号必删 | **只记结论，不记思考过程** | 开（推荐）：不满足质量判据的内容不会被写成结论，**避免把「它正在想什么」当成「结论」存下来**。关：质量门取消，可能存进半成品。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `autoContinueEnabled` | 标题「自动接续」；提示「水位达到阈值时弹出确认卡，同意即接续到新会话…出厂默认关闭(功能仍在测试期)；本开关独立于交接白板——关白板不影响水位测量与接续资格。」 | **快满了就提示开新会话** | 开：上下文快满时弹一张确认卡，同意就把工作接到新会话（沿用当前工作区/模型/思考档位）。关（出厂默认）：**不提示，你得自己记得开新窗口**。 | 默认关（测试期） | 开关 | 需实测 |
| `autoContinueThreshold` | **—（设置页无行，浮层可见）** | **水位到多少算「快满」** | 占模型窗口的比例。默认 0.75；官方自动压缩在 80%，所以低于它才来得及从容交接。 | 默认 `0.75` | 数字(0.1-1.5) | 需实测 |
| `autoContinueConfirmSeconds` | **—（无入口）** | **确认卡等你几秒** | 弹卡后多久自动按默认处理，避免无人值守时卡住。 | 默认 `35` | 数字 | 需实测 |
| `autoContinueCooldownMinutes` | **—（无入口）** | **两次提示至少隔多久** | 防止会话末尾反复弹卡。 | 默认 `30` | 数字 | 需实测 |
| `autoContinueRefreshRitual` | **—（无入口，浮层用过）** | **高级：接续前先刷新交接材料** | 接续前强制刷新一次账本/白板，材料更新但不增加额外步骤时更快。 | 默认开 | 高级（折叠） | 需实测 |
| `autoContinueRefreshTimeoutSeconds` | **—（无入口）** | **高级：刷新最多等多久** | 超时就直接用现有材料接续，不卡死。 | 默认 `90` | 高级（折叠） | 需实测 |
| `waterLevelWindowTokens` | 标题「水位估计窗口(token)」；提示「…达到该值即视为上下文将满;0=关闭。**默认 65536**(128K 窗口的保守半量),按所用模型调整。」← **与实际默认 0 不符，必改** | **上下文窗口按多少 token 算** | 填 0 = **整套水位判断关闭**（默认就是 0）；填一个数才按它估算「快满了」。按你实际模型的窗口填，比如 128K 模型填 65536 是保守值。 | 默认 **`0`（关闭）**（现文案误写「默认 65536」） | 数字 | 需实测 |
| `waterLevelThreshold` | 标题「水位建议阈值」；提示「水位比例 = 上下文实占 ÷ 官方声明窗口…超过该值(0.1-1.5)即触发交接建议/骨架账本；默认 0.75——官方自动压缩阈值是 80%…」 | **占满多少比例就建议交接** | 默认 0.75。调低 = 更早提示（更安全但更快结束会话）；调高 = 撑更久但可能来不及交接。 | 默认 `0.75` | 数字(0.1-1.5) | 需实测 |
| `waterLevelAdvisory` | 标题「水位交接建议」；提示「水位越阈时在动态快照注入交接建议(写账本/刷新白板/建议开新窗);无人值守时静默。」 | **快满时提醒它写账本** | 关：不提醒，模型可能一直写下去直到被压缩掉。 | 默认开 | 开关 | 需实测 |
| `waterLevelAutoHandoff` | 标题「水位自动骨架账本」；提示「越阈时自动写一篇系统骨架账本(每会话一次)…」 | **快满时自动兜底写一份** | 开（推荐）：模型忘了写就自动补一份骨架账本，防止交接材料缺失。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `slimPlanChars` | **—（无入口）** | **高级：精简版白板预算** | 空间紧张时用的更短摘要长度。 | 默认 `400` | 高级（折叠） | 需实测 |
| `slimLedgerChars` | **—（无入口）** | **高级：精简版账本预算** | 同上。 | 默认 `300` | 高级（折叠） | 需实测 |
| `subagentGcEnabled` | 标题「子代理回收」（若已渲染）；提示「…」 | **清理残留的接续子代理** | **已停用**：该能力已判废（搬移会话痕迹**不减轻**前端渲染负担），本机配置为 `false`。控件若仍渲染，文案须写「已停用」，不得再称「避免越积越多」。 | 代码默认开／本机 `false` | 开关 | 需实测 |
| `subagentGcKeepDays` | 标题「回收保留天数」 | **已停用**（仅 `subagentGcSweep` 读取，而该函数首行早退） | 本机无效果 | 代码默认 `3`／**已停用** | 数字 | 需实测 |

> **分区 5 的排序建议**：把 4 个核心行放最前（`handoffEnabled` → `autoContinueEnabled` → `criteriaGate` → `waterLevelAdvisory`），其余 14 项折叠进「高级」。`waterLevelWindowTokens` 必须在 `autoContinueEnabled` **下方紧邻**出现，并在其提示里直接写「默认 0 = 水位功能关闭，所以自动接续目前不会触发」——这是当前最容易被误解的一组（现文案让人以为它默认开着）。

### 3.7 分区 6 · `auto` 自动化与免打扰（12 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `consolidateScheduleEnabled` | 标题「定时做梦式固化」；提示「每天到点自动读最近日志发散提炼长期要点,写入项目笔记/用户级记忆(等价 memory_consolidate)。」 | **每天定时提炼一次长期记忆** | 到点它自己翻这两天的日志，把有长期价值的挑出来写成规则/结论。关：只靠每轮结束的自动沉淀。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `consolidateScheduleTime` | 标题「固化触发时间」；提示「HH:MM,插件日界内每天一次;默认 09:30。命中时刻需宿主在线。」 | **几点提炼** | 到点的那一瞬 dsh web 必须开着，否则这次跳过。 | 默认 `09:30` | 时间 | 需实测 |
| `consolidateScheduleDays` | 标题「固化回看天数」；提示「定时固化读取最近 N 天日志;默认 7。」 | **回看几天的日志** | 天数越多挑得越全、成本越高。 | 默认 `7` | 数字 | 需实测 |
| `maintainScheduleEnabled` | 标题「定时 30 天蒸馏」；提示「每天到点自动把超过 30 天的旧日志蒸馏归档(等价 memory_maintain);无旧日志时零成本跳过。」 | **定期把老日志压成要点** | 老日志不会删，原文归档到 `.dsh-memory/archive/`，要点进项目笔记。 | 默认开；推荐开 ★ | 开关 | 需实测 |
| `maintainScheduleTime` | 标题「蒸馏触发时间」；提示「HH:MM,默认 10:00(与固化时间错开)。」 | **几点做蒸馏** | 建议与上面的提炼时间错开，避免同一时刻并发。 | 默认 `10:00` | 时间 | 需实测 |
| `awayMinutes` | 标题「暂离阈值(分钟)」；提示「距上次活动超过该值视为暂离,回归时自动弹出记忆窗口。默认 60,设 0 关闭暂离检测与欢迎问候…」 | **多久没说话算「离开」** | 回来时自动弹出记忆窗并欢迎。设 0 = 关闭暂离检测与欢迎问候。 | 默认 `60` | 数字 | 需实测 |
| `unattendedMode` | 标题「无人值守模式」；提示「面向无人值守批量任务(托管/夜间)。开启后不注入欢迎回来指令、行为指令、暂离/回归提示、日历提醒——只注入纯事实记忆…默认关。」 | **别寒暄，只给事实** | 开：跑批量任务时不注入欢迎语/行为指令/日历提醒，**只给纯事实记忆**，省 token 也不打扰。 | 默认关 | 开关 | 需实测 |
| `unattendedAuto` | 标题「夜间/非工作时间自动托管」；提示「开启后,本地时间处于非工作时间窗(默认 22:00-08:00,可在配置中调 **unattendedAutoHours**)或检测到自动托管任务时,自动进入无人值守模式…手动开关优先;默认关。」 | **到点自动进入「别寒暄」** | 到非工作时间或检测到托管任务时自动切到上面的模式。手动开关优先级更高。 | 默认关 | 开关 | 需实测 |
| `unattendedAutoHours` | **—（无入口；被上一行提示点名）** | **免打扰时段** | 上面的「非工作时间」具体是哪一段，默认 22:00-08:00，可加多段。 | 默认 `['22:00-08:00']` | 多段文本 | 需实测 |
| `autoPopupEnabled` | 标题「自动弹出记忆窗口」；提示「暂离/回归时自动弹出记忆窗口(corner)并欢迎;关闭后只能手动打开。默认开。」 | **回来时自动弹记忆窗** | 关：只能自己点开。 | 默认开 | 开关 | 需实测 |
| `autoSummaryTimes` | 标题「自动总结时间点(HH:MM,逗号分隔)」；提示「到点自动生成本时段总结并弹窗展示,如 12:00,18:00,22:00。空=关闭。」 | **每天固定时段做小结** | 到点自动生成这段时间的总结并弹窗。留空 = 关闭。 | 默认 `[]`（关闭） | 文本 | 需实测 |
| `welcomeTourEnabled` | 标题「欢迎向导」；提示「首次启动后自动播放分步功能引导（含语义引擎检测/下载）；关闭后仅可从此处手动打开。」 | **首次使用看一遍引导** | 关：不再自动播，需要时从这里手动打开。（本项同时列在分区 8 的外观区，实施时**只落一处**——建议落本区。） | 默认开 | 开关 | 需实测 |

### 3.8 分区 7 · `store` 存储与外部记忆（11 键）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `memoryRoot` | 标题「记忆根目录」；提示「集中式存储:所有工作区记忆统一放在此目录下(每工作区一个子目录),旧版分散的记忆会自动迁移。」 | **记忆集中存放位置** | 每个工作区一个子目录。**改这里会触发旧记忆迁移**，改前建议备份。 | 默认 `~/.dsh/memory/workspaces` | 路径（带目录浏览） | 需实测 |
| `userMemoryDir` | 标题「用户记忆目录」；提示「跨项目规则存放处,支持 ~ 开头;需有文件写权限。」 | **跨项目规则放哪** | 所有项目共用的规则文件位置。需要写权限。 | 默认 `~/.dsh/memory` | 路径 | 需实测 |
| `projectMemoryDir` | 标题「项目记忆目录」；提示「相对各工作区的目录名(默认 .dsh-memory)。」 | **每个项目里的记忆目录名** | 相对各工作区根目录的名称，默认 `.dsh-memory`。 | 默认 `.dsh-memory` | 文本 | 需实测 |
| `workspaceDiscoverMax` | 标题「工作区发现上限」；提示「扫描本机会话时最多识别多少个工作区(按最近会话时间降序取前 N 个)。默认 200;机器上历史工作区很多时可调小以缩短扫描时间。」 | **最多认多少个工作区** | 机器上历史项目很多、扫描很慢时调小。 | 默认 `200` | 数字 | 需实测 |
| `externalSources` | **—（设置在别处：记忆面板里的单源勾选，`client.js:5325-5337`）** | **接入其他 AI 工具的记忆** | 勾选要接入的来源（WorkBuddy / Claude Code / Codex 等）。这里是**唯一入口**，设置页只需显示「去记忆面板选择 →」的跳转按钮，避免两处重复实现。 | 默认 `{…}` 对象 | 跳转按钮 | 需实测 |
| `reflectEnabled` | 标题「每日反思」；提示「昨天有工作日志时,会话首轮主动呈现昨日反思。」 | **第二天先说昨天做了什么** | 开：有昨天日志时，会话第一轮先给一段昨日反思。 | 默认开 | 开关 | 需实测 |
| `reflectStyle` | 标题「反思风格」（**无提示**） | **反思用什么口吻** | 生活化 / 专业性 / 由内容决定（推荐自动）。 | 默认 `auto`；推荐 `auto` ★ | 下拉(3) | 需实测 |
| `dayBoundaryMinutes` | 标题「日界(分钟)」；提示「从 0 点起算:凌晨在此之前的活儿归前一天。默认 450=早上 7:30 进入新一天;改 480=8:00;0=按午夜切日。」 | **几点算「新的一天」** | 熬夜到凌晨的工作算前一天。默认 450 分钟 = 早上 7:30 换日；0 = 按午夜切。 | 默认 `450` | 数字 | 需实测 |
| `pythonBackendEnabled` | **—（无入口）** | **高级：安装 Python 语义引擎** | 发烧友项。**与内置引擎是两套可互换的独立方案**，不要与分区 1 的开关混为一谈。 | 默认关 | 高级（折叠） | 是（推断，见 §3.1） |
| `pythonBackendExecutable` | **—（无入口）** | **高级：Python 解释器路径** | 留空 = 自动查找。 | 默认 `''` | 高级（折叠，路径） | 是（推断） |
| `pythonBackendWorkerPath` | **—（无入口）** | **高级：Python worker 路径** | 留空 = 用内置 worker。 | 默认 `''` | 高级（折叠，路径） | 是（推断） |

> **外部记忆铁律提示（分区 7 顶部常驻一行）**：内置 JS 引擎与 Python 端是**两套可互相替换的独立方案**，界面文案不得写成「装了 Python 才能用」或「开了这个才生效另一项」。

### 3.9 分区 8 · `look` 外观与交互（核心 8 行，其余折叠）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `locale` | 标题「界面语言」；提示「默认跟随 DSH 系统语言;也可手动指定中文 / English。」 | **界面语言** | 默认跟随系统。 | 默认 `system` | 下拉(3) | 需实测 |
| `panelPos` | 标题「记忆承载面」；提示（长文）「记忆内容的呈现方式:左下角浮层(可拖动缩放)/ 会话页(与「对话轨迹」「上下文」并列的一页,在会话页顶栏切换)/ 两者共存…仅本机生效。」 | **记忆内容显示在哪** | 左下角浮层 / 会话页里的一页 / 两者共存。两处共享同一份内容，实时同步。**仅本机生效**（不写进配置）。 | 默认 `both` | 下拉(3) | 否（即时生效，代码注释明证 `client.js:142`） |
| `welcomeTourEnabled` | 见分区 6 | 见分区 6 | 见分区 6 | 默认开 | 开关 | 需实测 |
| `subagentModel` + `subagentProvider` + `subagentReasoningEffort` | 当前为多行（`subagentModel` 在 `client.js:5828` 附近被设置） | **自动总结用哪个模型** | 让插件自己的后台总结走便宜模型，省主模型的额度。留空 = 用默认。 | 默认 `''`（全部留空） | 3 控件合成 1 行 | 需实测 |
| `injectExcludeSources` | 标题「排除来源(每行一条)」；提示（最长提示，4 行）「这些来源不再进注入,避免坏记忆反复灌入把结果一路带偏。四种写法:记忆 id(mem_xxx)、整层(log/whiteboard/project/user/reflection)、目录前缀(以 / 或 \\ 结尾)、精确文件路径。…被挡下的条数会在注入里以 [降级] 如实标注。」 | **哪些来源永不进上下文** | 写进来的来源「永不注入」，防止一条坏记忆反复带偏结果。四种写法：`mem_xxx` / 层名 / 目录 / 文件路径。被挡下的会在注入里以 `[降级]` 标出来。 | 默认 `[]` | 多行 | 需实测 |
| `activationInboxEnabled` | **—（无入口）** | **唤起记录收件箱** | 把每次「自动唤起」的记录存下来供你回看与校准。 | 默认关 | 开关 | 需实测 |
| `jsDecideCooldownRounds` | 标题「唤起冷却(分钟)」；提示「自动唤起注入后,N 分钟内不再判定…默认 1;0=不冷却。」← **单位误导：键名是 rounds（轮），文案写「分钟」，必改** | **两次自动唤起至少隔几轮** | 调大 = 更克制、更省 token；0 = 每轮都判定。 | 默认 `1` | 数字 | 需实测 |
| `jsDecideDeltaExp` | 标题「唤起margin阈值(e5档)」；提示「候选第1/2名分差须超过此值才注入(e5 余弦分布紧,默认 0.01;bge-m3 校准值为 0.03)。调小=更容易唤起,调大=更保守。0=不过滤。」 | **它得多确定才敢回忆** | 调大 = 更保守（只在高置信时插话）；调小 = 更容易主动回忆。默认 0.01。 | 默认 `0.01` | 数字 | 需实测 |
| `jsDecideExcerptChars` | 标题「唤起注入内容长度(字符)」；提示「Reference Tail 的 Reference 行内容上限…默认 40=几个字/关键词级(省 token…);范围 20-480。」 | **每次回忆带多少原文** | 默认只带几个关键词（省 token），需要细节时模型会自己去取全文。 | 默认 `40` | 数字(20-480) | 需实测 |

> 分组 8 说明：`jsDecide*` 三个「校准参数」从原「自动记忆引擎」区搬到外观区/高级折叠区，理由是它们属于**调参**而非**开关**；若审阅时认为应留在 `engine` 区亦合理（两者都满足「一个键只出现一次」的硬约束），推荐落 `engine` 的高级折叠层，**与 `jsDecideCandidateScheme`/`jsDecideCandidatesN` 相邻**，本表把它列在 8 只是备选。

### 3.10 分区 9 · `about` 关于与诊断（5 行）

| 配置键 | 现文案（若有） | 建议标题 | 建议一行说明（人话：改了会怎样） | 推荐/默认 | 类型 | 需重启 |
| --- | --- | --- | --- | --- | --- | --- |
| `boardMode` | 标题「白板形态」（`client.js:6348-6349` 两个按钮，`data-dam-key='boardMode'` / `'boardModeGraph'`） | **白板样式** | 旧版白板 = 一切照旧；新版看板 = 图形化看板 + 两个遍历工具。**切换后必须重启 dsh web**；切回即完全回滚。 | 默认 `graph` | 分段按钮(2) | **是**（有明证，§3.1） |
| `softInjectionEnabled` | — | **已停用（4 个历史实验开关）** | 以下键已停用，改了不生效：`softInjectionEnabled`、`streamingInterruptionEnabled`、`maxPacketItems`、`maxPacketChars`、`packetTtlSteps`、`injectionCooldownSteps`。保留说明是为避免你手改 JSON 后困惑。 | 默认 `false` 等 | 纯文本说明（不给控件） | 否 |
| `maxPacketItems` / `maxPacketChars` / `packetTtlSteps` / `injectionCooldownSteps` | — | **（合并进上一行的说明文本）** | 同上，**不给控件**。 | — | — | — |
| `fVersion`（非配置键） | 标题「插件版本」；提示无 | **插件版本与更新** | 显示当前版本 + 「检查更新」按钮；更新完成后提示重启 dsh web。 | — | 只读 + 按钮 | 是（更新后） |

---

## 4. 迁移与兼容（什么会坏、什么不会）

### 4.1 `sectionLabels` 键名（导航键）

- **机制**：`sectionLabels` 对象（`client.js:5989`）的**键**同时充当 ① 导航顺序（`Object.keys()` @ `client.js:6003`）② 锚点 id 后缀（`'dam-settings-' + key`）。
- **改名后果**：老锚点 id 失效。本项目内部**无深链引用**（全库扫 `dam-settings-` 仅命中 `client.js` 自身），故风险=「用户浏览器书签」这一外部面，**可接受**。
- **必须一次性改齐的三处**：① `sectionLabels` 的键与文案 ② 每处 `section('旧key', ...)` 的第一个参数 ③ 导航渲染处的 `sectionLabels[key]` 取值（自动跟随，无需改）。
- **建议**：新键名用 §2.2 的 9 个 id；`semantic` → `engine`、`injection` → `window`、`context` → `handoff`、`maintenance` → 拆为 `look` + `about`。

### 4.2 `data-dam-key` 字面量（**改动禁区**）

以下 `data-dam-key` 值被**既有冒烟断言字面量锁定**，改动即打红（§1.6）：

| 值 | 出现位置（2026-09-22 实测） | 谁在断言 |
| --- | --- | --- |
| `handoffEnabled` | `client.js:3973`（接续浮层）、`client.js:6321`（设置页） | `smoke-test-switch-decouple-pre.mjs:279` 统计出现次数 |
| `autoContinueEnabled` | `client.js:3981`、`client.js:6322` | `smoke-test-switch-decouple-pre.mjs:280` 统计出现次数 |
| `boardMode` / `boardModeGraph` | `client.js:3976`、`client.js:6348-6349` | `smoke-test-graph-mode-pre.mjs:275` |
| `procedureInjectEnabled` | `client.js:6203` | 无断言（可安全保留） |
| `memoryFileIndexEnabled` | `client.js:6259` | 无断言 |
| `tier0CatalogEnabled` | `client.js:6263` | 无断言 |
| `rulesLayeringMode` | `client.js:6265` | 无断言 |
| `criteriaGate` | `client.js:6325` | 无断言 |

> **纪律**：本轮重排**只搬 DOM 位置，不改这些字面量，也不改它们的出现次数**（`smoke-test-switch-decouple-pre.mjs` 数的是次数，搬动时不要顺手加第二个开关）。

### 4.3 i18n 键名（**改动禁区**）

`smoke-test-panel-position-pre.mjs:77` 硬锁 5 个键存在：`fPanelPos`、`fPanelPosHint`、`posBottomLeft`、`posPage`、`posBoth`。
⇒ **只改键的「值」（文案内容），不改键名**；需要新文案的一律**新增键**（如 `fEmitModeHint2`）或直接复用现有 Hint 键补内容。
另外：`t()` 用到 443 个键，zh/en 字典**各缺 6 个**（`detecting`、`hubWhyHasCorrection`、`hubWhyDiversity`、`hubWhySuccess`、`hubWhyCorrectionRate`、`hubEvLine`）——它们属记忆中枢卡片，不在设置页，顺手补齐即可（**补齐不会打红任何断言**）。

### 4.4 会因此变红的既有断言清单（共 **4 条 / 3 个文件**）

> **判据说明（避免夸大）**：本方案按 §5 的纪律实施（**不改 `data-dam-key` 字面量、不改 i18n 键名、不改出现次数**）时，**实际变红 0 条**；下面 4 条是「一旦违反上述三条纪律就会变红」的护栏清单，用于实施时的自检与「哪些改动必须 Lead 批准」。

| # | 断言 | 变红条件 | 规避方式 |
| --- | --- | --- | --- |
| 1 | `tests/smoke/smoke-test-graph-mode-pre.mjs:275` | 把 `'data-dam-key': 'boardMode'` 从源码里删掉或改写 | 保留该字面量（分区 9 的白板按钮继续带它） |
| 2 | `tests/smoke/smoke-test-switch-decouple-pre.mjs:279` | `'data-dam-key': 'handoffEnabled'` 出现次数变化 | 搬动时保持次数不变 |
| 3 | `tests/smoke/smoke-test-switch-decouple-pre.mjs:280` | `'data-dam-key': 'autoContinueEnabled'` 出现次数变化 | 同上 |
| 4 | `tests/smoke/smoke-test-panel-position-pre.mjs:77` | 5 个 i18n 键任一不存在 | 保留键名，只改值 |

**若必须改这 4 条断言**：改动它们属于「降低既有守卫强度」，需 Lead 明确批准并在批次的验收项里逐条写明「哪条断言、为什么必须改、改后等价强度是什么」。

### 4.5 不需要迁移的部分（明确免除）

- **配置数据本身**：分区重排是纯前端 DOM 重排，**键名与存储格式完全不变**，用户现有 `dsh-auto-memory.json` 无需迁移（`/config` 白名单 = `DEFAULT_CONFIG` 键集合，未变）。
- **写入通路**：`saveConfigPatch` → `POST/PUT /config`（`index.js:11328-11349`）不变；`onEngineModeChange` 的三键联动行为不变。
- **宿主侧**：本轮**零 `lib/index.js` 改动**（除可选「补 15 个键的读取接线」属另一批次，见 §5）。

---

## 5. 实施切分建议（4 批 · 每批可独立验收与回滚）

> **通用纪律（每批都适用）**：① 改前备份 `lib/client.js`（`Copy-Item lib/client.js lib/client.js.bak-<ts>-<批名>`）② 每批结束跑 `node --check lib/client.js` ③ 跑 `tests/smoke/smoke-test-graph-mode-pre.mjs`、`smoke-test-switch-decouple-pre.mjs`、`smoke-test-panel-position-pre.mjs` 三条（共 4 条断言）确认未打红 ④ 不提交、不推送、不重启宿主（**宿主重启只能由用户操作**）⑤ 大文件/大区块以 `edit` 分段改，禁止一次性整文件覆写。

| 批次 | 内容 | 触及范围 | 风险 | 验收（必须全绿才进下一批） |
| --- | --- | --- | --- | --- |
| **B1 · 分区骨架** | 只做「搬运」：`sectionLabels` 换成 9 键新键序；把现有 70 个 `field(...)` 行**逐行原地搬到新分区**（不新增/不删除任何键、不改任何文案与字面量） | `client.js` 只在设置页区段（约 `5718-6706`） | **低**（纯位移） | `node --check` 0；4 条既有断言全绿；手动开设置页确认 9 个导航项可点、锚点滚动正常、每个键只出现一次 |
| **B2 · 文案人话化** | 逐键替换 zh/en 的 `f*` 与 `f*Hint` **值**：① 修 §1.3 的三处「默认值说错」（必做）② 删 §1.4 的内部术语 ③ 补 §1.5 S1 的 5 处空缺提示 ④ 长提示拆成「一句结论 + 折叠细节」 | `client.js` 的 I18N 两块（zh 起 `203`、en 起 `403`，**只改值不改键名**） | **中**（面广但机械；漏改 en 会中英不一致） | `node --check` 0；4 条断言全绿；**逐键对账**：写一个只读脚本比对「zh/en 键集合一致」与「每个 `f*` 都有对应 Hint」，输出 0 缺失 |
| **B3 · 补 15 个缺失入口** | 新增 15 个键的行（§1.2：`tier0BudgetShare`、`slimPlanChars`、`slimLedgerChars`、`autoContinueConfirmSeconds`、`autoContinueCooldownMinutes`、`snapshotTieredInject`、`activationInboxEnabled`、`l0IndexEnabled`、`pythonBackendEnabled`、`pythonBackendExecutable`、`pythonBackendWorkerPath`、`autoContinueRefreshRitual`、`autoContinueRefreshTimeoutSeconds`、`unattendedAutoHours`、`autoContinueThreshold`）；**8 个死键与 `capacityDefaultsVersion` 不给控件**，只在 `about` 区给一段说明 | `client.js` + 新增 i18n 键（约 30 个新键 × zh/en） | **中高**（新增控件 = 新增写入面；须确认每个新键都在 `DEFAULT_CONFIG` 白名单内，否则写不进去——§5 注） | `node --check` 0；4 条断言全绿；**逐个新控件点击一次**并确认写盘（`POST /config` 返回 200 且刷新后值保持） |
| **B4 · 高级折叠 + 重启提示** | 每区加「高级设置」折叠容器（`data-dam-disclosure` 若已有则复用）；重启提示横幅（"有 N 项改动需重启"） | `client.js` CSS + 分区渲染 | **低** | `node --check` 0；4 条断言全绿；折叠展开/收起状态在切分区后保持（避免"点了就没了"） |

**B3 的关键前置检查（不可跳过）**：新增控件只能写 `DEFAULT_CONFIG` 里的键（`index.js:11342` 白名单）。上列 15 个键**全部已在 `DEFAULT_CONFIG` 内**（实测），故可写；但 `semanticEngineMode` 另有枚举门（`index.js:11346`，只接受 `auto/lexical/js/python`），`injectExcludeSources` 另有「非空字符串数组」门（`index.js:11347-11348`）——新控件必须遵守这两个门，否则值会被静默丢弃。

**批次规模建议**：B1 与 B2 可合并为一次提交（约 1 个 `client.js` 区段 + I18N 两块）；B3 单独一次（风险最高）；B4 单独一次。**总计 3-4 次改动**，每次都能独立回滚。

---

## 6. 本方案的已知边界

1. **「需重启 dsh web」列有 97 项标 `需实测`**：本轮未逐键做运行时验证，**不编造结论**。B2 实施时必须先跑一次开机验证（改一个键 → 看是否即时生效 → 记录），再把该列落实成界面文案。
2. **8 个死键的判定是「仅定义无读取」的静态证据**（§1.2），**不是官方废弃声明**。B3 前建议先与 Lead 确认是否立项清理；本方案对它们**不给控件**是保守选择。
3. **行号会漂移**：`lib/client.js` 正被 Lead 并发修改，本文所有行号均为 2026-09-22 实测快照。实施前**重新取证**（本文档 §0 的 |表| 即取证口径）。
4. **`activationSource` / `contextSinkMode` 的三键联动**是既有逻辑（`client.js:5993-6006`），本方案只做文案说明，**不改逻辑**；若要拆解需单独立项。
5. **未做浏览器实机验证**：`SettingsPage` 是运行时渲染的 DOM，本方案的分区效果需在刷新后实机确认（尤其是导航 sticky 布局与折叠容器）。**本方案未执行任何 `lib/` 改动**，故无回归风险。
