# 设置页缺口审计 · dsh-auto-memory（2026-09-22）

> 独立只读审计，**未修改 `lib/` 下任何文件**，未提交/推送，未重启任何进程。
> 审计对象：宿主 `lib/index.js`（DEFAULT_CONFIG，`index.js:260-606`，**实测 101 键**）∪ `lib/*-pre.js` 实际读取的配置键
> vs 浏览器端 `lib/client.js`（SettingsPage `5479-6120`、sectionLabels `5779-5786`、向导 TOUR_STEPS toggles `4971-5035`）。
> 证据纪律：每条结论带 file:line；无代码证据的判断显式标注「推断」。

## 0. 结论摘要（数字先行）

| 项 | 数字 | 说明 |
|---|---|---|
| 宿主侧配置键全集 | **101** | `index.js:260-606` 全部为 DEFAULT_CONFIG 一级键（提示中的「49 键」应为路由数，非键数；仓库文档 `docs/internal/ARCHITECTURE-FOR-ZCODE-20260920.md:346` 亦记「实测 98 键」，本次逐行点数为 101） |
| 方向 A：宿主有键、**设置页无对应设置行** | **31** | 见 §1 表（另含 1 条子键缺口：`externalSources` 下 5 个新源无勾选入口） |
| 方向 B：前端写键、宿主不认 = **死控件** | **1 真死** | `pythonGpu`（`client.js:5939`） |
| 方向 B 附加：**写盘成功但结构性无效**（灰控件） | **1** | `procedurePromotionEnabled`（`client.js:5023` 向导 toggle） |
| 缺失项中 **P0** | **7** | 表 A 内 5 条（`procedureInjectEnabled`/`tier0CatalogEnabled`/`tier0MaxTokens`/`criteriaGate`/`rulesLayeringMode`）+ 方向 B 的 2 条（`procedurePromotionEnabled` 向导行改键、`pythonGpu` 死控件）；见 §3 |
| 缺失项中 **P1** | **11** | 10 个键 + `externalSources` 子键组；见 §3 |
| 缺失项中 **P2（内部/实验/仅文件项）** | **16** | 见 §3；其中 `capacityDefaultsVersion` 建议不加 UI |
| `/config` 写入覆盖面 | 覆盖全部 DEFAULT_CONFIG 键 | 白名单 = `Object.keys(DEFAULT_CONFIG)`（`index.js:11342`）；反作用是**非 DEFAULT_CONFIG 键永远写不进去** |
| sectionLabels ↔ section 调用对应 | **8 : 8，一一对应，无空导航项** | 见 §4.2 |

## 1. 表 A：缺失设置（宿主有键，前端设置页无对应设置行）

判据：该键在 `lib/client.js` 全文**无** `set('<key>'` 调用、**无** `saveConfigPatch({ <key>` 写入、**无** SettingsPage 内绑定 `cfg.<key>` 的控件。命中数 0 即判定「缺失」。

| # | 配置键 | 默认值 | 宿主证据(file:line) | 前端检索结果 | 用户影响 | 建议分区与文案建议 | 是否需重启 dsh web 生效 |
|---|---|---|---|---|---|---|---|
| 1 | `procedureInjectEnabled` | `true` | `index.js:554`（定义）· `index.js:547-553`（注释：**技能注入/唤起总闸**，旧键语义错配纠正）· 消费：`context-host-pre.js:543`、`activation-host-pre.js:333`、契约模块 `procedure-switch-pre.js:26-32` | **0 命中**（全文件无该键）。向导反而在写旧键：`client.js:5023` `key: 'procedurePromotionEnabled'` | **P0**。真总闸无任何 UI ⇒ 用户无法关/开「技能注入与主动唤起」这条臂；而向导里那个「技能固化与晋升」开关写的是旧键，**结构性无效**（见 §2） | 记忆中枢（`memoryHub`）：新行「技能注入与主动唤起」checkbox，hint「决定已激活的技能是否注入上下文、以及主动唤起这条臂是否开启。默认开；关闭后技能仅保留在审批列表，不影响写入与晋升。」 | 无需重启（宿主每次读 `this.config`，`index.js:2062-2067` 保存即替换内存配置） |
| 2 | `tier0CatalogEnabled` | `true` | `index.js:293` · 消费 `index.js:5270`（`cfg.tier0CatalogEnabled === false` → 目录层置空） | **0 命中** | **P0**。Tier-0 常驻目录是"规矩/索引每轮在场"的核心机制，关不掉也开不回来 | 记忆窗口（`injection`）：新行「Tier-0 常驻目录（指引层）」checkbox，hint「每轮注入『要不要用某条记忆』的索引行。默认开；关掉即回到旧快照（省 token，但记忆索引不在场）。」 | 无需重启 |
| 3 | `tier0MaxTokens` | `400` | `index.js:297`（含上限硬编码 800 的口径注释）· 消费 `index.js:5285` | **0 命中** | **P0**。`index.js:289` 注释直接把用户导向此键（「需要装下更多语料时应提高 Tier-0 目录的配额（tier0BudgetShare / tier0MaxTokens）」），但设置页没有 ⇒ 文档承诺可达的旋钮不存在 | 记忆窗口：「Tier-0 目录 token 预算」数字输入（min 100 / max 800，超出按上限封顶），hint「上限 800，默认 400（B0 的一半）。目录是索引层，调大挤的是证据段。」 | 无需重启 |
| 4 | `tier0BudgetShare` | `0.25` | `index.js:300` · 消费 `index.js:5282`；另 `index.js:5687` 注释写「tier0BudgetShare（默认 0.4）」——与该键定义 0.25 不一致，**注释陈旧，以 `index.js:300` 为准** | **0 命中** | **P1**。目录占注入预算的比例不可调；与第 3 项取小生效，单独调 token 上限可能被比例卡住 | 记忆窗口：「目录占注入预算比例」数字输入（0.05-0.5, step 0.05），hint「与 token 预算取小生效。目录越大，证据段（日志/笔记）越短。」 | 无需重启 |
| 5 | `criteriaGate` | `true` | `index.js:387`（注释含「关掉不会跳过丢卡/用户区/重复 id 三条共同保护」）· 消费 `index.js:2747`、`index.js:2785`（`strict`）· 边界保护在 `memory-mutation-pre.js:24` | **0 命中** | **P0**。账本 H1–H4/S1–S4 与白板 P-H1/P-H2 质量门**只能改配置文件**才能退；用户遇到"账本被拒"时在现场找不到开关 | 上下文管理（`context`）：新行「交接/白板判据门」checkbox，hint「开=按 target 校验账本与白板判据（默认）；关=退掉这道可选质量门。丢卡/用户区/重复 id 三条保护不受影响。」 | 无需重启 |
| 6 | `rulesLayeringMode` | `'self'` | `index.js:381`（注释含 2026-09-15 裁定默认 `self` 的理由） | **0 命中** | **P0**。规则段（每轮注入的硬约束）当前只能靠改配置文件切档/回退；`off` 这个"回退开关"用户不可达 | 记忆窗口：新行「规则分层模式」下拉（`self` 看用户级+工作区级 / `none` 只看工作区级 / `off` 不渲染规则段），hint「默认 self（跨工作区恒定 + 工作区级）。改 off 即回到旧行为：规则段完全不注入。」 | 无需重启 |
| 7 | `memoryFileIndexEnabled` | `false` | `index.js:335`（注释：M3a 只读记忆索引，开启后仅构建只读索引与调试快照，不改 Markdown）· 消费 `index.js:1444`、`index.js:1436` | **0 命中** | **P2**（只读诊断能力）。开启后才有只读索引/调试快照，当前只能改文件 | 自动记忆引擎（`semantic`，与 `memoryAnchorEnabled` 同区）：新行「只读记忆索引（快照）」checkbox，hint「开启后仅构建只读索引与调试快照，不修改任何 Markdown。默认关。」 | 无需重启 |
| 8 | `l0IndexEnabled` | `true` | `index.js:538`（注释：2026-09-14 用户裁定默认开；全流程 fail-soft，`enabled!==true` 才零 IO） | **0 命中** | **P2**。L0 向量索引开关不可见 ⇒ 用户无法按需彻底关掉"零 IO/零嵌入/零目录"档 | 自动记忆引擎：新行「L0 向量索引」checkbox，hint「默认开：工作区语料刷新后按层写 L0 摘要索引（端侧 e5-small，检索路径零 LLM 调用）。关=零 IO、零嵌入、零目录。」 | 无需重启（推断：消费点在索引刷新路径，非注册期） |
| 9 | `slimPlanChars` | `400` | `index.js:370`（注释：精简版白板额度，刻意小于 `handoffPlanChars`） | **0 命中** | **P1**。精简注入里"白板长什么样"的额度不可调；调不动它等于模型看不到白板现状 | 上下文管理：新行「精简版·白板额度（字符）」，hint「每 N 轮中的精简版注入里给 PLAN.md 的字符额。默认 400（完整版 handoffPlanChars 为 1200）。」 | 无需重启 |
| 10 | `slimLedgerChars` | `300` | `index.js:371` | **0 命中** | **P1**。同上，交接账本在精简版里的额度不可调 | 上下文管理：新行「精简版·账本额度（字符）」，hint「默认 300。精简版的目的不是看全文，而是『看到它长什么样、以及它旧了』；全文走 memory_read_pre。」 | 无需重启 |
| 11 | `autoContinueThreshold` | `0.75`（常量 `DEFAULT_AUTO_CONTINUE_THRESHOLD`，`index.js:258`） | `index.js:408`（注释：与 waterLevelThreshold 刻意不复用常量，避免两开关耦合）· 消费 `index.js:3492`、`index.js:3678` | **非 0 命中，但不在设置页**：仅接续面板 `client.js:3825`（`autoSave({ autoContinueThreshold: v })`）+ 读取 `3736/5392/5437` | **P1**。设置页「上下文管理」只有自动接续开关（`client.js:6069`）**没有阈值行** ⇒ 用户按"去设置里找"的路径找不到它 | 上下文管理：在 `autoContinueEnabled` 行下补「接续水位阈值」数字输入（0.5-0.95, step 0.05），hint「与接续面板同一配置键，两处双向。留 5% 余量给官方自动压缩（官方阈值 80%）。」 | 无需重启 |
| 12 | `autoContinueConfirmSeconds` | `35` | `index.js:410`（确认卡倒计时秒数 30-40s 无操作=挂机）· 消费 `index.js:3504` | **0 命中** | **P2**。倒计时时长不可调（担心误接续的用户无法加长/缩短） | 上下文管理：新行「接续确认卡倒计时（秒）」，hint「默认 35。无操作到点即自动接续兜底。」 | 无需重启 |
| 13 | `autoContinueRefreshRitual` | `true` | `index.js:412`（接续前刷新仪式）· 消费 `index.js:3886`、`index.js:4406`；前端只读不写：`client.js:3675` | **0 命中（无写入口）**；`client.js:3675` 仅读取该值决定是否跑仪式 | **P1**。刷新仪式（先让旧 Agent 刷 PLAN+账本再接续）关不掉；用户在接续行为异常时无从排查 | 上下文管理：新行「接续前刷新仪式」checkbox，hint「默认开：先用最新材料刷新白板与账本再接续。关掉=直接用现有材料组装（更快，材料可能旧）。」 | 无需重启 |
| 14 | `autoContinueRefreshTimeoutSeconds` | `90` | `index.js:414`（等待上限，超时 fail-soft 继续）· 前端只读：`client.js:3604` | **0 命中（无写入口）** | **P2**。仪式等待上限不可调（大仓库下 90s 常被超时截断） | 上下文管理：新行「刷新仪式等待上限（秒）」，hint「默认 90；超时用现有材料 fail-soft 继续接续。」 | 无需重启 |
| 15 | `autoContinueCooldownMinutes` | `30` | `index.js:416` · 消费 `index.js:3495` | **0 命中** | **P2**。一次接续后的冷却不可调（连续多次接续时会被静默挡下） | 上下文管理：新行「接续冷却（分钟）」，hint「默认 30；一次接续后多久内不再触发。」 | 无需重启 |

### 1.2 表 A 续（16-31）

| # | 配置键 | 默认值 | 宿主证据(file:line) | 前端检索结果 | 用户影响 | 建议分区与文案建议 | 是否需重启 dsh web 生效 |
|---|---|---|---|---|---|---|---|
| 16 | `unattendedAutoHours` | `['22:00-08:00']` | `index.js:437` · 消费 `index.js:4810`（`Array.isArray` 校验）· 与 `unattendedAuto` 联动 `index.js:4807` | **0 命中（仅文案提及）**：`client.js:355`、`client.js:542` 的 hint 明说「默认 22:00-08:00，可在配置中调 unattendedAutoHours」——**指向了一个界面上不存在的键** | **P1**。文案把用户导向配置文件；非工作时间窗不可调 | 自动化（`automation`）：在「夜间/批量自动托管」下补「非工作时间窗」文本输入（逗号分隔，如 `22:00-08:00`；跨午夜支持），hint「空=不按时间自动（仅托管任务触发）。手动开关优先于自动。」 | 无需重启 |
| 17 | `snapshotTieredInject` | `true` | `index.js:443`（注释：2026-09-15 裁定分级注入；false=回退旧行为）· 消费 `index.js:10081`、`index.js:10142` | **0 命中** | **P1**。分级注入（精简版）是"规矩每轮在场"的关键，一旦用户遇到精简注入遮挡问题，无回退开关 | 记忆窗口：新行「分级注入（完整/精简）」checkbox，hint「默认开：完整快照每 N 轮一次，其间各轮给精简版（规则+目录+日程）。关=回退旧行为：节流期间不注入精简版。」 | 无需重启 |
| 18 | `shadowRetrievalEnabled` | `false` | `index.js:493` · 消费 `shadow-host-pre.js:58`、`shadow-host-pre.js:199`（与 `associativeMemoryEnabled ∧ memoryAnchorEnabled` 三门） | **0 命中** | **P2**。只记录候选不注入的观测试验开关不可见 | 自动记忆引擎：新行「Shadow Retrieval（只记录候选）」checkbox，hint「需『自动联想注入』开启；开启后只记账不注入，用于评估召回质量。默认关。」 | 无需重启 |
| 19 | `contextBridgeEnabled` | `false` | `index.js:495`（注释：需 associativeMemoryEnabled 同时开启；默认关闭零 IO）· 消费 `context-host-pre.js:129`、`context-host-pre.js:300` | **0 命中** | **P2** | 自动记忆引擎：新行「上下文/证据桥（M5）」checkbox，hint「需先开『自动联想注入』；关闭时零 IO。开启后实时组装上下文并记录 Access Evidence。」 | 无需重启 |
| 20 | `activationInboxEnabled` | `false` | `index.js:499` · 消费 `activation-host-pre.js:63-69`（`assoc ∧ inbox` 双门）· 路由面 `index.js:11106` | **0 命中** | **P2**。主动唤起（M6 Activation Inbox）总门不可见 | 自动记忆引擎：新行「激活收件箱（主动唤起）」checkbox，hint「需先开『自动联想注入』；开启后按判定结果产出 Reference Tail 注入。默认关。」 | 无需重启 |
| 21 | `softInjectionEnabled` | `false` | `index.js:540`（注释：pre-step 软注入） | **0 命中** | **P2**（实验能力，无任何 UI 与文档入口） | 记忆窗口：新行「pre-step 软注入（实验）」checkbox，hint「实验特性；默认关。」若确认已废弃，建议**删键**而非补 UI（见 §5 待决） | 无需重启（推断） |
| 22 | `streamingInterruptionEnabled` | `false` | `index.js:597`（注释：流式中断/恢复实验） | **0 命中** | **P2**（实验） | 上下文管理：新行「流式中断/恢复（实验）」checkbox，hint「实验特性；默认关。」若已废弃建议删键 | 无需重启（推断） |
| 23 | `maxPacketItems` | `2` | `index.js:599`（MemoryPacket 最大条目数） | **0 命中** | **P2**（MemoryPacket 三键整族无 UI） | 记忆窗口（实验折叠组）：「Packet 最大条目数」，建议与 24/25 同组展示并标注「实验」 | 无需重启（推断） |
| 24 | `maxPacketChars` | `800` | `index.js:601` | **0 命中** | **P2** | 记忆窗口（实验折叠组）：「Packet 字符预算（800）」 | 无需重启（推断） |
| 25 | `packetTtlSteps` | `2` | `index.js:603` | **0 命中** | **P2** | 记忆窗口（实验折叠组）：「Packet 存活步数（TTL）」 | 无需重启（推断） |
| 26 | `injectionCooldownSteps` | `3` | `index.js:605` | **0 命中** | **P2** | 记忆窗口（实验折叠组）：「注入冷却步数」 | 无需重启（推断） |
| 27 | `pythonBackendExecutable` | `''` | `index.js:526`（留空='python'，PATH 解析，no-shell spawn）· 消费 `index.js:9865`（惰性 `() =>`） | **0 命中** | **P1**（高级 Python 引擎用户）。Python 解释器路径不可配 ⇒ 非 PATH 安装（conda/venv）的用户只能改配置文件 | 自动记忆引擎（「高级 Python 引擎」折叠区，仅 `semanticEngineMode==='python'` 时展开）：「Python 可执行文件（留空=python）」，hint「留空按 PATH 解析 python；conda/venv 请填绝对路径。仅影响高级引擎。」 | 无需重启（推断：访问点是惰性函数，`index.js:9865-9866`） |
| 28 | `pythonBackendWorkerPath` | `''` | `index.js:524` · 消费 `index.js:9866`（惰性） | **0 命中** | **P2** | 同上折叠区：「Python worker 脚本路径（留空=捆绑脚本）」 | 无需重启（推断） |
| 29 | `factRetentionMax` | `1000` | `index.js:582`（注释 #110 用户拍板 1000；撤销优先→最旧优先淘汰）· 传给 store：`index.js:9236`（`{ config: { maxFacts: Number(engine.config.factRetentionMax) || 1000 } }`）· store 侧 `fact-store-pre.js:677-679`（`opts.config.maxFacts`，`<=0` 视为不限） | **0 命中** | **P1**。事实保留上限是#110 刚落地的拍板项，用户既看不到现值也无法按数据量调（`<=0`=不限这个合法语义也无入口） | 记忆中枢：新行「事实保留上限（条）」数字输入（min 0），hint「默认 1000。超出按『撤销优先 → 最旧优先』淘汰，重要项（pinned/user-memory/explicit/confidence≥0.8）最后删。0 或负数=不限。」 | 无需重启（推断：store 在构造期取一次值，改后需重建 hub ——**若不做重建，改值可能要下次启动才生效**；建议实现时按需重建或标注「重启生效」） |
| 30 | `workspaceDiscoverMax` | `200` | `index.js:585`（注释 #102：旧硬编码 30 会把第 31 个工作区静默丢弃）· 消费 `index.js:6654`（`Number(this.config && this.config.workspaceDiscoverMax)`） | **0 命中** | **P1**。同上，是#110/#102 批次新键，界面完全没有 | 存储（`storage`）：新行「工作区发现上限」数字输入（min 1），hint「默认 200，按最近会话 mtime 降序截断。过小会让跨工作区检索/索引/总览静默少项。」 | 无需重启（每次 `discoverWorkspaces()` 调用读 `this.config`，`index.js:6654`） |
| 31 | `capacityDefaultsVersion` | `24`（常量 `CAPACITY_DEFAULTS_VERSION`，`index.js:233`） | `index.js:333` · 迁移逻辑 `index.js:1941-1954`（只升一次；守卫读磁盘原文） | **0 命中** | **无用户影响（建议不加 UI）**：它是容量默认值的迁移哨兵，改它等于伪造"已迁移" | 不建议出现在设置页（如需排查，放「维护→调试中心」只读展示） | 不适用 |
| 32 | `externalSources.{zcode-memory, zcode-sessions, kimi-global, kimi-sessions, trae-rules}`（子键） | 均 `true`（`index.js:483-487`） | `index.js:473-488`（13 个源）· 向导可勾选集合写死 8 个：`client.js:5058` `EXT_SOURCE_KEYS = [...8 项]`（**缺 zcode/kimi/trae 共 5 键**）· 写盘 `client.js:5094` `saveConfigPatch({ externalSources: cur })` | 主键 `externalSources` 命中（仅向导 `5090-5094`）；**5 个新源 0 命中** | **P1**。设置页**完全没有**「外部记忆源」分组；向导能勾的只有 8 个旧源。zcode/kimi/trae 默认开、且用户无法逐个关（只能靠删目录或改配置文件）——与"扫描到即出源"的新增能力不匹配 | 外观（`appearance`）或存储：新增「外部记忆源」分组，逐源 checkbox（13 项全列），hint「只存路径指针、不复制内容；关闭即不再扫描与注入该源」；并同步扩建 `EXT_SOURCE_KEYS` | 无需重启 |

### 1.3 归类小结（P0 / P1 / P2）

- **表 A 内 P0（5）**：`procedureInjectEnabled`、`tier0CatalogEnabled`、`tier0MaxTokens`、`criteriaGate`、`rulesLayeringMode`。
- **表 A 内 P1（11）**：`tier0BudgetShare`、`slimPlanChars`、`slimLedgerChars`、`autoContinueThreshold`（设置页无行，仅接续面板有）、`autoContinueRefreshRitual`、`unattendedAutoHours`、`snapshotTieredInject`、`pythonBackendExecutable`、`factRetentionMax`、`workspaceDiscoverMax`、`externalSources` 子键（5 个新源，第 32 行）。
- **表 A 内 P2（16）**：`memoryFileIndexEnabled`、`l0IndexEnabled`、`autoContinueConfirmSeconds`、`autoContinueRefreshTimeoutSeconds`、`autoContinueCooldownMinutes`、`shadowRetrievalEnabled`、`contextBridgeEnabled`、`activationInboxEnabled`、`softInjectionEnabled`、`streamingInterruptionEnabled`、`maxPacketItems`、`maxPacketChars`、`packetTtlSteps`、`injectionCooldownSteps`、`pythonBackendWorkerPath`、`capacityDefaultsVersion`（建议不加 UI）。

> 计数口径：表 A 共 **32 条**（31 个键 + 1 组子键）= 5 + 11 + 16，与 §0 的「方向 A：31 键 + 1 子键组」一致。§3 的 P0 合计为 **7 条** = 表 A 的 5 条 + 2 条不在表 A 的项（`procedurePromotionEnabled` 向导行改键、`pythonGpu` 死控件），二者不矛盾：后两条属方向 B（§2）。


### 1.4 只出现在向导、设置页无行的键（不算"前端完全没有"，但设置页缺失）

| 配置键 | 前端唯一入口 | 设置页状态 | 建议 |
|---|---|---|---|
| `procedurePromotionEnabled` | 向导 `client.js:5023` | **无行** | 见 §2：把向导行改成写 `procedureInjectEnabled`，并在记忆中枢补新行；旧键保留为兼容别名 |
| `hubMechanicalProcedureFeedEnabled` | 向导 `client.js:5029` | **无行** | 记忆中枢：新行「机械流程切片（不推荐）」checkbox，hint 文案可直接复用向导的 `sub`（`client.js:5029`），并加「关=只保留模型自己写的技能」 |
| `autoConsolidate` / `reflectEnabled` / `autoSummaryTimes` / `autoPopupEnabled` / `unattendedAuto` / `reasoningObserverEnabled` / `associativeMemoryEnabled` / `injectEnabled` | 向导 toggles（`client.js:4985-5022`） | **设置页均有行**（6011/6042-6052/5945/5798） | 无需处理（向导与设置页同键，双向联动，符合既有设计） |
| `activationEmitMode` | 设置页 `client.js:5803` + 向导 `5021` | 有行（但走 `semantic-emit` 路由写 `embedding-config.json`，不是 `DEFAULT_CONFIG` 键） | 无需处理；注意它**不属于** `/config` 白名单（`index.js:11342`），是另一套存储（`index.js:10825-10838`） |

## 2. 表 B：死控件（前端写键、宿主不认 / 写盘无效）

| # | 配置键 | 前端写入证据(file:line) | 宿主检索结果 | 为什么是死控件（机制） | 用户影响 | 建议处置 | 是否需重启 dsh web 生效 |
|---|---|---|---|---|---|---|---|
| 1 | `pythonGpu` | `client.js:5939`（引擎向导「启用并继续」：`var n2 = Object.assign({}, cfg); … n2.pythonGpu = true; setCfg(n2); setDirty(true)`）；值来自 `localStorage['dsh-auto-memory-pre.pyGpu']`（`client.js:2812`、`2816`） | **宿主 `lib/` 全文 0 读取**：`grep pythonGpu` 仅命中 `lib/client.js` 与 `docs/` | 「保存更改」只提交与远端**不同**的键（`client.js:5713-5715`）⇒ `pythonGpu` 进入 patch ⇒ `POST /config` 按 `Object.keys(DEFAULT_CONFIG)` 白名单过滤（`index.js:11342-11344`，非白名单键既不报错也不落盘）⇒ **被静默丢弃** | **P0（死控件）**：用户以为"启用 Python 引擎 + 带上 GPU 偏好"已保存；GPU 偏好实际只走 `embedding-config.json` 那条通路（`python-setup-pre.js:215`），本键是历史残留 | **删掉 `client.js:5939` 的 `n2.pythonGpu = true`**（仓库已有同一结论：`docs/internal/TODO-BACKLOG.md:172`、`docs/UI-REFACTOR-PRE-RESEARCH.md:97`、`docs/internal/DESIGN-OVERHAUL-PRE-RESEARCH.md:46`）。若确需把 GPU 偏好放进配置，应同时加 `DEFAULT_CONFIG` 键 + 让消费端读它，否则不要写 | 删除前端那一行**无需重启**（刷新页面即消失）；若改成真配置键，则宿主侧需重启才注册新键语义 |
| 2 | `procedurePromotionEnabled`（**灰控件：写盘成功但结构性无效**） | `client.js:5023`（向导 TOUR_STEPS `key: 'procedurePromotionEnabled'`）→ `5075` 组 patch → `5083` `saveConfigPatch(patch)` | 键**在** `DEFAULT_CONFIG`（`index.js:560`），`/config` **接受**写入；但宿主解析走 `procedure-switch-pre.js:26-32` | `resolveProcedureInjectEnabledPre` 第 28 行 `if (typeof c.procedureInjectEnabled === 'boolean') return c.procedureInjectEnabled` **先命中**；而 `_mergeConfigPre` 是 `{...DEFAULT_CONFIG, ...parsed}`（`index.js:1912`），`DEFAULT_CONFIG.procedureInjectEnabled === true`（`index.js:554`）⇒ 合并结果里该键**恒为布尔** ⇒ 第 30 行的旧键别名**结构性不可达** | **P0**：向导那个「技能固化与晋升」开关点击后 UI 会翻面（乐观更新 `5076-5077`）、写盘也成功，但**宿主永远读不到新值**——开关是摆设 | ① `client.js:5023` 的 `key` 改为 `procedureInjectEnabled`，同时改 `sub` 文案（它管的是**注入/唤起总闸**，不是"晋升"）；② 设置页记忆中枢补 `procedureInjectEnabled` 行（§1 第 1 行）；③ 旧键保留在 `DEFAULT_CONFIG`（兼容老配置）但 UI 不再写它 | 改向导键**无需重启**（宿主每次读 `this.config`）；前端改动需刷新页面 |

### 2.1 反向确认：除 `pythonGpu` 外无其它"写了宿主不认"的键

逐类核对了 `lib/client.js` 全部写入口：

- `set('<key>'` **66 行 / 63 个唯一键**（`client.js:5550, 5613, 5798-5811, 5945-5960, 5972, 5982, 5994-6058, 6068-6075, 6086, 6097, 6099`）——**全部**存在于 `DEFAULT_CONFIG`。
- `saveConfigPatch({...})` 直接调用 —— `client.js:3753`（`autoContinue*`）、`3816`（`handoffEnabled`）、`3822`（`boardMode`）、`5083`（向导 patch，键来自 TOUR_STEPS toggles `4971-5035`）、`5094`（`externalSources`）、`6087`（`boardMode`）；键集合亦全在 `DEFAULT_CONFIG`（含 `externalSources` 子键，`index.js:473-488`）。
- `setCfg` 派生写入 —— `semanticEngineMode` / `activationSource` / `contextSinkMode` / `pythonBackendEnabled`（`client.js:5761-5765`、`5939`）中前四个在 `DEFAULT_CONFIG`；**只有 `pythonGpu` 不在**（上表第 1 行）。
- 非配置类 UI 状态（`fontScale` `5984`、`panelPos` `5987`、`accentTheme` `5727-5731`、`graphDensity` `5732-5736`、`mirror` `5652-5654`）走 `localStorage` / `controller`，不经 `/config`，**不算死控件**。
- 另有 `activationEmitMode`（`client.js:5803`、`5021`）走 `semantic-emit` 路由落 `embedding-config.json`（`index.js:10825-10838`），**不属于** `/config` 白名单但**有真实消费者**（`index.js:9795`、`10622-10645`）⇒ 不是死控件，只是"另一套存储"。

## 3. 优先级清单

**P0（7 条，每条一行：键 → 建议分区）**

1. `procedureInjectEnabled` → **记忆中枢**（真总闸无 UI；所有 procedure 注入/唤起行为不可控）。
2. `procedurePromotionEnabled` 向导行改键 → **记忆中枢**（灰控件：写盘不生效，用户被骗）。
3. `tier0CatalogEnabled` → **记忆窗口**（Tier-0 目录整块不可开/关）。
4. `tier0MaxTokens` → **记忆窗口**（宿主注释直接把用户导向此键，界面却不存在）。
5. `criteriaGate` → **上下文管理**（判据门只能改文件才能退）。
6. `rulesLayeringMode` → **记忆窗口**（规则段分层/回退无 UI）。
7. `pythonGpu` → **删除死键**（引擎向导区域，`client.js:5939`）。

**P1（11 条）**：`tier0BudgetShare`（记忆窗口）· `slimPlanChars`（上下文管理）· `slimLedgerChars`（上下文管理）· `autoContinueThreshold`（上下文管理，设置页缺行、仅接续面板有）· `autoContinueRefreshRitual`（上下文管理）· `unattendedAutoHours`（自动化）· `snapshotTieredInject`（记忆窗口）· `pythonBackendExecutable`（自动记忆引擎·高级折叠区）· `factRetentionMax`（记忆中枢）· `workspaceDiscoverMax`（存储）· `externalSources` 的 5 个新源（`zcode-memory`/`zcode-sessions`/`kimi-global`/`kimi-sessions`/`trae-rules` → 外观/存储，新增「外部记忆源」分组）。

**P2（16 条）**：`memoryFileIndexEnabled`（自动记忆引擎）· `l0IndexEnabled`（自动记忆引擎）· `autoContinueConfirmSeconds`（上下文管理）· `autoContinueRefreshTimeoutSeconds`（上下文管理）· `autoContinueCooldownMinutes`（上下文管理）· `shadowRetrievalEnabled`（自动记忆引擎）· `contextBridgeEnabled`（自动记忆引擎）· `activationInboxEnabled`（自动记忆引擎）· `softInjectionEnabled`（记忆窗口·实验）· `streamingInterruptionEnabled`（上下文管理·实验）· `maxPacketItems`（记忆窗口·实验）· `maxPacketChars`（记忆窗口·实验）· `packetTtlSteps`（记忆窗口·实验）· `injectionCooldownSteps`（记忆窗口·实验）· `pythonBackendWorkerPath`（自动记忆引擎·高级折叠区）· `capacityDefaultsVersion`（**建议不加 UI**，仅调试中心只读展示）。

## 4. 额外核对

### 4.1 `/config` 路由的写入覆盖面

- 写入白名单 = **`Object.keys(DEFAULT_CONFIG)`**（`index.js:11342`），逐键比对 `body[key] !== undefined` 后组 patch（`index.js:11344-11356`），再 `engine.saveConfig(patch)`（`index.js:11357`）。
- `saveConfig` 语义 = `{ ...this.config, ...patch }`（`index.js:2067`）⇒ **单键合并**，不会整份覆盖；落盘会写入**整个合并后的 config**（`index.js:1918-1923` 注释：「实测某实例 95 个键全部在盘上」）。
- 特例门（都在白名单内，只是值校验）：`semanticEngineMode` 枚举 fail-closed（`index.js:11346`）；`injectExcludeSources` 必须是非空字符串数组且逐项 trim（`index.js:11349-11353`）。
- **结论**：DEFAULT_CONFIG 的 101 键**全部可写**；反之**任何不在 DEFAULT_CONFIG 的键永远写不进去**——这正是 `pythonGpu` 成为死控件的根因（§2）。`activationEmitMode` 不在白名单，但它有专用路由与专用存储，不属缺陷。
- 另注意副作用耦合：`saveConfig` 在 `semanticEngineMode` 变更时**顺带**改写 `activationSource` / `contextSinkMode` / `pythonBackendEnabled`（`index.js:2071-2082`），前端也复刻了同一联动（`client.js:5761-5765`）⇒ 这四键**没有独立设置行是有意为之**（不是缺口），但排障时要知道它们会被连动改写。

### 4.2 左侧导航 sectionLabels ↔ section 调用：8 : 8，一一对应，无空导航项

- `sectionLabels` 键（`client.js:5779-5786`）：`semantic` / `memoryHub` / `appearance` / `storage` / `injection` / `automation` / `context` / `maintenance`（8 个）。
- 实际 `section('<key>', …)` 调用（`client.js:5797` semantic、`5951` memoryHub、`5966` appearance、`5994` storage、`6011` injection、`6042` automation、`6068` context、`6101` maintenance）——**8 个，键名与导航完全一致**。
- 导航渲染由 `Object.keys(sectionLabels)` 驱动（`client.js:5793-5795`），点击 `jumpToSection` 滚动到 `#dam-settings-<key>`（`5788-5791`、`5787`）⇒ 不存在"点进去是空的"分区。
- 唯一"内容最薄"的是 `maintenance`（`6101-6110`）：只有版本检查/一键更新/交流群，**无任何配置键行**——但它不是空分区，且按本审计结论它是"实验/内部键"的合理归属地（可作为 P2 折叠组的落点）。
- 设置页共 **66 行 `set('…')`**，覆盖面见 §2.1；`field()`/`section()` 定义在 `client.js:5722-5726`、`5787`。

### 4.3 已知待确认项：逐条结论 + file:line 证据

| # | 待确认项 | 结论 | 证据 |
|---|---|---|---|
| 1 | `procedurePromotionEnabled` 这一行是否应改成 `procedureInjectEnabled` | **是，且是 P0 双缺**：① 向导行 `client.js:5023` 必须改键（现写成旧键=结构性无效，见 §2 第 2 行）；② 设置页必须**新增** `procedureInjectEnabled` 行（当前 0 命中）。B 批结论成立：`procedureInjectEnabled` 才是宿主真读的注入/唤起总闸 | 宿主：`index.js:547-560`（两键定义与注释）、`procedure-switch-pre.js:26-32`（解析顺序）、消费点 `context-host-pre.js:543`、`activation-host-pre.js:333`；前端：`client.js:5023`（唯一写入点，旧键） |
| 2 | `procedureHighRiskApproval` | **前端已有，不是缺口**（记忆中枢区 `client.js:5959`） | 宿主 `index.js:593`（默认 true）+ 消费 `index.js:9246`（`get highRiskRequiresApproval()` 惰性读 `engine.config`）⇒ 保存即时生效 |
| 3 | `factRetentionMax` | **缺失（P1）**，前端 0 命中 | 宿主 `index.js:582`；传 store `index.js:9236`（`maxFacts`）；store 侧 `fact-store-pre.js:677-679`（`<=0`=不限）。**注意**：值在 hub/store 构造期注入，改配置后若 hub 不重建，**可能要到下次启动才生效**（推断，已在表 A 第 29 行标注） |
| 4 | `workspaceDiscoverMax` | **缺失（P1）**，前端 0 命中 | 宿主 `index.js:585`；消费 `index.js:6654`（每次 `discoverWorkspaces()` 现读）⇒ 无需重启 |
| 5 | `memoryFileIndexEnabled` | **缺失（P2）**，前端 0 命中 | 宿主 `index.js:335`；消费 `index.js:1444`（`{ enabled: this.config.memoryFileIndexEnabled === true }`）。与同区的 `memoryAnchorEnabled`（前端有，`client.js:5799`）不同，M3a 这一半没做 UI |
| 6 | `tier0MaxTokens` | **缺失（P0）**，前端 0 命中；同族 `tier0CatalogEnabled` / `tier0BudgetShare` 也全缺 | 宿主 `index.js:297`、`300`、`293`；消费 `index.js:5270`、`5282`、`5285`；**注释自证缺口**：`index.js:289`「需要装下更多语料时应提高 Tier-0 目录的配额（`tier0BudgetShare` / `tier0MaxTokens`）」——文档指着界面里不存在的旋钮 |
| 7 | `injectExcludeSources` | **前端已有，不是缺口**（记忆窗口区 textarea `client.js:6015-6024`，每行一条、空行过滤） | 宿主定义 `index.js:310`（四种写法口径）；写入校验 `index.js:11349-11353`（非字符串数组直接丢弃，绝不静默转空）；注入侧消费 `index.js:5333-5334` |
| 8 | `criteriaGate` | **缺失（P0）**，前端 0 命中（仅注释与被拒文案里出现） | 宿主 `index.js:387`；消费 `index.js:2747`（写入口校验）、`index.js:2785`（`strict`）；未被开关覆盖的保护在 `memory-mutation-pre.js:24`、`wb-contract-pre.js:502` |

### 4.4 前端写入但**不在**设置页面的三处（供交叉验证，非缺口）

| 入口 | 行 | 键 |
|---|---|---|
| 白板/接续面板（`HandoffHost` 区） | `client.js:3746-3753`（`autoSave`）、`3816`、`3822`、`3825` | `autoContinueEnabled` / `autoContinueThreshold` / `handoffEnabled` / `boardMode` |
| 欢迎向导 TOUR_STEPS toggles | `client.js:4971-5035` 定义，`5067-5085` 写盘 | `associativeMemoryEnabled`、`injectEnabled`、`autoPopupEnabled`、`unattendedAuto`、`reflectEnabled`、`autoSummaryTimes`、`reasoningObserverEnabled`、`autoConsolidate`、`procedurePromotionEnabled`、`hubMechanicalProcedureFeedEnabled`、`externalSources`（`5094`）；`activationEmitMode` 走 `5081` 另一路由 |
| 引擎向导「启用并继续」 | `client.js:5939` | `semanticEngineMode`、`activationSource`、`contextSinkMode`、`pythonGpu`（死键） |

## 5. 证据方法（检索命令与命中/未命中判据）

### 5.1 工具与路径

全部检索使用工作区内置 `grep` / `read` / `glob` 工具，路径写死为 `D:\dsh-auto-memory\lib\...`（未用 shell `find`/`grep`）。`lib/client.js` 6449 行、`lib/index.js` 11700 行（末行编号以工具输出为准）。

### 5.2 宿主侧键全集

1. `grep pattern=DEFAULT_CONFIG path=lib/index.js` → 定位到 10 处命中，取字面量块：`index.js:260-606`（`read` 分 3 段读全 255-632 行）。
2. 逐行点数该块内的 `key:` 行 → **101 键**（含 `externalSources` 一个对象键，其下 13 个子键另计）。仓库文档记「98 键」（`docs/internal/ARCHITECTURE-FOR-ZCODE-20260920.md:346`）——**以本次逐行点数为准**，98/101 的差额来自 09-20 之后新增的 `hubMechanicalProcedureFeedEnabled`、`factRetentionMax`、`workspaceDiscoverMax` 等。
3. 模块侧实际读取键：`grep pattern='\bconfig\.[a-zA-Z_][A-Za-z0-9_]*' include='*-pre.js' path=lib` → 43 命中（含 `config.json` 文件名这类假阳性 3 处，如 `python-setup-pre.js:44/134`、`semantic-js-pre.js:413`）；`grep pattern='\bcfg\.[a-zA-Z_][A-Za-z0-9_]*|\}\s*=\s*[a-zA-Z_.]*\.config\b' include='*-pre.js'` → 26 命中（`tier0-catalog-pre.js`、`water-window-pre.js`、`episodic-store-pre.js`、`python-setup-pre.js` 的参数对象）。
4. 核心宿主读取：`grep pattern='this\.config\.[a-zA-Z_][A-Za-z0-9_]*' include=index.js path=lib` → **89 命中**（<250 上限，结果完整）；`grep pattern='\bcfg\.[a-zA-Z_]' include=index.js` 另补充方法内别名（如 `index.js:5270-5334`）。
5. **判据**：模块侧实际读取的键，逐个人工比对 `DEFAULT_CONFIG` —— **未发现"模块读、DEFAULT_CONFIG 没有"的键**（唯一疑似 `fact-store-pre.js:679` 的 `opts.config.maxFacts` 是 `index.js:9236` 现传的选项对象字段，不是插件配置键；`water-window-pre.js:102-105`、`python-setup-pre.js:127-130`、`tier0-catalog-pre.js:429-431` 的 `cfg.*` 均为**入参选项对象**，非插件配置）。⇒ 本报告的"宿主键全集"= `DEFAULT_CONFIG` 的 101 键。

### 5.3 前端侧键全集与命中判据

1. `grep pattern="set\('[a-zA-Z0-9_]+'" path=lib/client.js` → **66 命中**（逐条列出，唯一键 63 个）——**这是"有设置控件"的强判据**。
2. `grep pattern='saveConfigPatch|configPatch|\bsetConfig\b|api\.config|/config' path=lib/client.js` → 12 命中，其中 6 处为真实写入（`3753/3816/3822/5083/5094/6087`），其余为定义与注释（`1182/1243/1260/3812/5716/6082`）。
3. `grep pattern='section\(|\x27data-dam-settings-group' path=lib/client.js` → 12 命中，取下 8 个 `section('<key>'` 调用与 `sectionLabels`（`5779-5786`）比对。
4. **缺失判据（未命中 = 缺失）**：对每个候选键，用一次合并 alternation 检索 `grep pattern='<key1>|<key2>|…' include=client.js`：
   - 返回 **0 命中** ⇒ 前端完全没有该键（进表 A）。
   - 返回命中但**仅出现在 hint 文案里** ⇒ 同样进表 A，并在"前端检索结果"列注明「仅文案提及」（例：`unattendedAutoHours` 命中 `client.js:355/542`，是文案而非控件）。
   - 命中且是**只读引用**（读 `cfg.X` 决定行为，无写入口）⇒ 进表 A 并注明「无写入口」（例：`autoContinueRefreshRitual` `client.js:3675`、`autoContinueRefreshTimeoutSeconds` `client.js:3604`）。
   - 命中且**有其它页面入口**（白板/接续面板、向导）⇒ 进表 A 并注明"不在设置页，另有入口"（例：`autoContinueThreshold` `client.js:3825`）。
5. 本轮合并检索涉及 31 个候选键，**未命中 26 个**、仅文案提及 1 个（`unattendedAutoHours`）、只读引用 2 个（`autoContinueRefreshRitual` / `autoContinueRefreshTimeoutSeconds`）、另有入口 1 个（`autoContinueThreshold`）、子键缺口 1 组（`externalSources` 的 5 个新源，主键命中但子键未在 `EXT_SOURCE_KEYS` 出现，`client.js:5058`）。
6. 「死控件」判据：把前端所有写入口的键名与 `DEFAULT_CONFIG` 求差集 ⇒ 仅 `pythonGpu`（`client.js:5939`）。另用 `grep pattern='pythonGpu|pyGpu' path=D:\dsh-auto-memory`（全仓）复核：宿主 `lib/*.js` **0 命中**，仅 `lib/client.js:2812/2816/5939` 与 5 处文档命中。

### 5.4 修正的两处既有说法（硬证据优先）

1. 「DEFAULT_CONFIG 49 个键」→ **实测 101 键**（`index.js:260-606`）。49 是**路由**数（插件 ready 日志 `index.js:11696` 打印 routes 数；白板 PLAN 亦记「49 条路由」）。
2. 文档 `docs/UI-REFACTOR-PRE-RESEARCH.md:97` / `DESIGN-OVERHAUL-PRE-RESEARCH.md:46` 称 `pythonGpu` 写在 `client.js:4106/4154` —— **行号已漂移**，当前实际写入点是 **`client.js:5939`**（另 `2812/2816` 为 `localStorage` 读写）。结论不变（宿主零引用）。

### 5.5 本审计未做的事（边界声明）

- **只读**：未修改 `lib/` 下任何文件；未提交/未推送；未重启/未停止任何进程（含 3080 端口的 dsh web）。
- 未运行测试套件（本任务不要求，且宿主代码未改）。
- 「是否需要重启 dsh web 生效」列中标注「推断」的项，依据是消费点的取值时机（每次读 `this.config` vs 构造期读一次）；未经运行时验证。



