# dsh-auto-memory 界面现状盘点(只读调查)

盘点对象:`lib/client.js`(4,493 行)、`lib/index.js`(8,067 行);行号一律写 `文件:行`。

## 1. 界面表层清单

| 类别 | 名称(中文原文) | 行 | 触发 |
|---|---|---|---|
| 注册面 | 侧栏入口「记忆 (pre)」`SidebarButton` | client.js:1295 / 注册 4462 | 常驻(侧栏 footer) |
| 注册面 | 记忆浮层面板 `MemoryPanel` | client.js:2886 / 注册 4465 | 点击侧栏入口开合 |
| 注册面 | 弹窗宿主 `DialogHost` | client.js:3076 / 注册 4468 | 状态驱动(7 种 kind) |
| 注册面 | 自动接续宿主 `AutoContinueHost` | client.js:3562 / 注册 4471 | 水位 ≥ 阈值且宿主 armed |
| 注册面 | 设置页「自动记忆 (pre)」`SettingsPage` | client.js:3667 / 注册 4474 | 从 DSH 设置面板进入 |
| 面板头 | 标题「自动记忆」+ 版本徽标 | client.js:2969-2970 | 常驻 |
| 面板头 | 悬浮钉 / ⤾ 重置位置 / ⟳ 刷新 / ✕ 关闭 / 页签条 `TabScroller` / 右下缩放手柄 | client.js:2973-2982、2840、2983、2985 | 常驻 |
| 概览页 | 时段总结卡 `GreetingCard`(含二级折叠) / 工作区概览折叠 / 展开技术细节 / 关系图 | client.js:1313、1397、1410、1574、1600、2383 | 有缓存摘要时 / 点击 |
| 日志页 | 「查看」/「返回」 | client.js:1774 / 1768 | 点击切换正文 |
| 唤起回顾页 | A / P / S / H / E 打分按钮 | client.js:1650-1652 | 点击提交 |
| 记忆中枢页 | 弃用 / 置顶 / 晋升 / 直接激活 / 取消置顶 | client.js:1839-1840、1853-1856 | 点击 |
| 存储管理页 | 重新扫描 / 修复 / 删除(下拉+输入+确认) | client.js:1947、1948、1954-1960 | 点击 |
| 笔记页 | 编辑框 + 保存 | client.js:2004 / 1995-2000 | 点击 |
| 白板页 | 一键接续 / 版本列表 / 账本时间线 / 自动接续开关+阈值 | client.js:2182、2225+、2215、2256、2258 | 点击 |
| 检索页 | 检索 / 智能检索 | client.js:2355 / 2361 | 点击 |
| 接续页 | 查看 / 导入 / 移除 | client.js:2732 / 2719 / 2744 | 点击 |
| 其余页 | 反思页 / 日历页 / 工作区页 | client.js:2283 / 2513 / 2462 | 页签切换 |
| 设置页 | 8 分组:自动记忆引擎/记忆中枢/外观/存储/记忆窗口/自动化/上下文管理/维护 | client.js:3952-3959、3970/4118/4133/4158/4175/4194/4218/4229 | 常驻(锚点跳转 3961) |
| 设置页 | 「🧩 安装向导」按钮 + `PySetupWizard` | client.js:3994-3995 / 1431 | 点击 |
| 设置页 | 环境检测面板 ⟳ / 引擎未就绪警告条 | client.js:4005-4006 / 4004 | 点击 / 仅资产缺失时 |
| 设置页 | 目录浏览器 / 模型抽屉 | client.js:4163 / 3754、4216 | 原生选择器不可用 / 点模型 |
| 设置页 | 保存栏 / 调试中心折叠 + `DebugCenter` | client.js:4239-4242 / 4245-4246、2989 | 有改动 / 点击 |
| 弹窗 | `update` / `welcomeTour`(内联开关 3196-3234)/ `modelDownload` / `notice` / `summary` / `welcomeBack` / `semSetup` | client.js:809-816、3319、4358(触发 4407、4330、4331、4426) | 版本变化 / 首启或手动重看 4140 / 状态驱动 |
| **补丁** | 「🧩 安装向导」+ 环境检测 ⟳ 都嵌在语义区块 semMode 同一行 | client.js:3994-3995、4005-4006 | 无独立入口,注释自称"美学对齐安装向导卡"(4005) |
| **补丁** | 调试中心挂在设置页最末、保存栏之后 | client.js:4244-4246 | 自带 borderTop,与设置分组体系并列 |
| **补丁** | 悬浮钉插在面板 header 四按钮之间 | client.js:2973-2979 | 注释标注"2026-09-08"后期追加 |
| **补丁** | 「接续」页签整块为后期模块 | client.js:2024-2147 | 4 个平级函数(`continueCreateArgs`/`refreshOldSession`/`waitForRefresh`/`executeContinue`)挂在页签外 |

**12 个页签**(定义 client.js:2942,分派 2930-2941):概览 2930 / 日志 2931 / 唤起回顾 2932 / 记忆中枢 2933 / 存储管理 2934 / 笔记 2935 / 白板 2936 / 反思 2937 / 接续 2938 / 日历 2939 / 检索 2941 / 工作区 2940。

## 2. 配置键清单

来源 `DEFAULT_CONFIG`(index.js:197-425)。**总键数 85**(另有嵌套对象 `externalSources` 含 13 子键,index.js:331-346)。「界面可改」列写出写入点;"仅文件"= client.js 全文无该键写路径。

| 键 | 默认值 | 含义 | 界面可改 |
|---|---|---|---|
| userMemoryDir | `~/.dsh/memory` | 用户级记忆目录 | 存储 4158 |
| projectMemoryDir | `.dsh-memory` | 项目记忆目录名 | 存储 4159 |
| memoryRoot | `~/.dsh/memory/workspaces` | 集中式记忆根 | 存储 4161/4172/3738 |
| injectEnabled | true | 注入记忆上下文 | 记忆窗口 4175 |
| injectBudgetChars | 1600 | 注入总预算(字符) | 记忆窗口 4176 |
| recentDaysInjected | 1 | 注入最近日志天数 | 记忆窗口 4179 |
| subagentModel | `''` | 子代理模型 | 存储 3763/3768/3782 |
| subagentProvider | `''` | 子代理 provider | 存储 3763/3768/3782 |
| subagentReasoningEffort | `''` | 子代理推理强度 | 存储 3801 |
| noteCapacityChars | 12000 | 项目笔记容量上限 | 存储 4177 |
| userCapacityChars | 12000 | 用户级记忆容量上限 | 存储 4178 |
| memoryFileIndexEnabled | false | M3a 只读记忆索引 | 仅文件 |
| memoryAnchorEnabled | false | M3b Anchor 写入 | 自动记忆引擎 3972 |
| autoConsolidate | true | 每轮自动沉淀 | 自动化 4195 / 向导 3233 |
| autoConsolidateMinChars | 240 | 寒暄跳过门槛 | 自动化 4194 |
| autoConsolidateCooldownMinutes | 30 | 沉淀冷却(分钟) | 自动化 4196 |
| autoConsolidateDailyMax | 8 | 每日沉淀上限 | 自动化 4197 |
| consolidateScheduleEnabled | true | 定时做梦式固化 | 自动化 4205 |
| consolidateScheduleTime | `09:30` | 固化触发时刻 | 自动化 4206 |
| consolidateScheduleDays | 7 | 固化回看天数 | 自动化 4207 |
| maintainScheduleEnabled | true | 定时 30 天蒸馏 | 自动化 4208 |
| maintainScheduleTime | `10:00` | 蒸馏触发时刻 | 自动化 4209 |
| handoffEnabled | false | 交接白板总开关 | 自动化 4218 |
| handoffPlanChars | 1200 | PLAN.md 注入预算 | 自动化 4219 |
| handoffLedgerChars | 800 | 账本注入预算 | 自动化 4220 |
| waterLevelWindowTokens | 0 | 窗口 token(0=自动) | 上下文 4221 |
| waterLevelThreshold | 0.75 | 水位建议阈值 | 上下文 4222 |
| waterLevelAdvisory | true | 水位建议注入 | 上下文 4223 |
| waterLevelAutoHandoff | true | 越阈自动写骨架账本 | 上下文 4224 |
| autoContinueEnabled | true | 自动接续 | 白板页 2256 |
| autoContinueThreshold | 0.75 | 自动接续阈值 | 白板页 2258 |
| autoContinueConfirmSeconds | 35 | 确认卡倒计时秒 | 仅文件 |
| autoContinueRefreshRitual | true | 接续前刷新仪式 | 仅文件(2136 只读) |
| autoContinueRefreshTimeoutSeconds | 90 | 刷新仪式超时 | 仅文件(2065 只读) |
| autoContinueCooldownMinutes | 30 | 接续冷却 | 仅文件 |
| subagentGcEnabled | true | 子代理痕迹回收 | 自动化 4225 |
| subagentGcKeepDays | 3 | 痕迹兜底保留天数 | 自动化 4227 |
| awayMinutes | 60 | 暂离判定阈值 | 自动化 4201 |
| unattendedMode | false | 无人值守模式 | 自动化 4199 |
| unattendedAuto | false | 无人值守自动检测 | 自动化 4200 / 向导 3205 |
| unattendedAutoHours | `['22:00-08:00']` | 非工作时段窗 | 仅文件(266/417 只读) |
| snapshotMinGapRounds | 5 | 快照最小注入间隔轮数 | 记忆窗口 4181 |
| snapshotReinjectOnCompact | true | 压缩后强制重注入 | 记忆窗口 4182 |
| promptLayerOverrides | `{}` | 自定义 prompt 层覆盖 | 记忆窗口 4189/4192 |
| autoPopupEnabled | true | 暂离回来自动弹面板 | 自动化 4198 / 向导 3204 |
| welcomeTourEnabled | true | 首启欢迎向导 | 外观 4139 |
| autoSummaryTimes | `[]` | 定时总结时刻表 | 自动化 4202 / 向导 3213 |
| dayBoundaryMinutes | 450 | 日界(分钟) | 自动化 4203 |
| reflectEnabled | true | 每日反思 | 自动化 4204 / 向导 3212 |
| reflectStyle | `auto` | 反思风格 | 自动化 4210 |
| locale | `system` | UI 语言 | 外观 4149 |
| externalInjectionChars | 1400 | 外部记忆注入预算 | 记忆窗口 4180 |
| externalSources | 13 子键全 true | 外部记忆源开关 | 首启向导 3292-3300 |
| associativeMemoryEnabled | false | 主动联想记忆总开关 | 自动记忆引擎 3971 / 向导 3196 |
| shadowRetrievalEnabled | false | Shadow Retrieval | 仅文件 |
| contextBridgeEnabled | false | M5 上下文桥 | 仅文件 |
| contextSinkMode | `'null'` | M5 sink 类型 | 自动记忆引擎(引擎联动 3935-3937) |
| activationInboxEnabled | false | M6 Activation Inbox | 仅文件 |
| activationSource | `js` | M6 激活来源 | 自动记忆引擎(引擎联动 3935-3937) |
| jsDecideCooldownRounds | 1 | JS 判定冷却轮数 | 自动记忆引擎 3973 |
| jsDecideDeltaExp | 0.01 | JS 档 margin 阈值 | 自动记忆引擎 3974 |
| jsDecideExcerptChars | 40 | 唤起 excerpt 长度 | 自动记忆引擎 3975 |
| jsDecideCandidateScheme | `balanced` | 候选方案档位 | 自动记忆引擎 3980 |
| jsDecideCandidatesN | 4 | custom 档候选条数 | 自动记忆引擎 3984 |
| pythonBackendWorkerPath | `''` | Python worker 路径 | 仅文件 |
| pythonBackendExecutable | `''` | Python 可执行文件 | 仅文件 |
| semanticEngineMode | `auto` | 语义引擎档位 | 自动记忆引擎 3986 |
| softInjectionEnabled | false | pre-step 软注入 | 仅文件 |
| contextBridgeObserveChildSessions | true | 是否观测子会话 | 自动记忆引擎 4113 |
| pythonBackendEnabled | false | Python sidecar | 仅文件 |
| reasoningObserverEnabled | true | 思维链观察器 | 自动记忆引擎 4112 / 向导 3225 |
| procedurePromotionEnabled | false | Procedure 自动晋升 | 首启向导 3234 |
| memoryHubEnabled | true | 记忆中枢总开关 | 记忆中枢 4120 |
| episodicMinSegments | 2 | episode 最少段数 | 记忆中枢 4121 |
| episodicRetention | 256 | episode 保留上限 | 记忆中枢 4122 |
| procedureMinSessions | 3 | 晋升所需会话数 | 记忆中枢 4123 |
| procedureMinSuccess | 2 | 晋升所需成功次数 | 记忆中枢 4124 |
| procedureCorrectionCap | 0.3 | correction 占比上限 | 记忆中枢 4125 |
| procedureHighRiskApproval | true | 高风险需批准 | 记忆中枢 4126 |
| procedureActiveLevel | `checklist` | active 注入级别 | 记忆中枢 4127 |
| streamingInterruptionEnabled | false | 流式中断/恢复实验 | 仅文件 |
| maxPacketItems | 2 | MemoryPacket 条目上限 | 仅文件 |
| maxPacketChars | 800 | MemoryPacket 字符预算 | 仅文件 |
| packetTtlSteps | 2 | MemoryPacket 存活步数 | 仅文件 |
| injectionCooldownSteps | 3 | 注入冷却步数 | 仅文件 |

**统计:总键数 85 / 界面可改 67 / 仅文件 18。**
界面可改 67 = `SettingsPage.set()` 60(client.js:3971-4227)+ 白板页 `autoSave` 2(2256/2258)+ 引擎联动草稿 3(`semanticEngineMode`/`activationSource`/`contextSinkMode`,3935-3937)+ 首启向导 2(`externalSources` 3299、`procedurePromotionEnabled` 3234)。
仅文件 18 = 全文零引用 15(memoryFileIndexEnabled、autoContinueConfirmSeconds、autoContinueCooldownMinutes、shadowRetrievalEnabled、contextBridgeEnabled、activationInboxEnabled、pythonBackendWorkerPath、pythonBackendExecutable、softInjectionEnabled、pythonBackendEnabled、streamingInterruptionEnabled、maxPacketItems、maxPacketChars、packetTtlSteps、injectionCooldownSteps)+ 仅只读引用 3(autoContinueRefreshRitual 2136、autoContinueRefreshTimeoutSeconds 2065、unattendedAutoHours 266/417)。
另注:client.js:4106 会写 `pythonGpu`,该键**不在** DEFAULT_CONFIG 中。

## 3. HTTP 端点清单

常量表 `API`(index.js:129-176,46 条);路由注册 `const routes = [`(index.js:7052-7990)。**端点数 46,常量与注册 1:1**,全部 loopback-only。

| 路径(前缀 `/api/dsh-auto-memory-pre/`) | 注册行 | 用途 | 服务界面 |
|---|---|---|---|
| `/state` | 7554 | 记忆状态快照 | 概览 / 日志 / 笔记页 |
| `/list` | 7569 | 日志文件列表 | 日志页 |
| `/file` | 7590 | 读单个记忆文件 | 日志页「查看」 |
| `/recall` | 7610 | 检索本地记忆 | 检索页 |
| `/smart-recall` | 7621 | 分层语义检索 | 检索页「智能检索」 |
| `/workspaces` | 7636 | 工作区清单+关系图 | 概览 / 工作区页 |
| `/debug` | 7648 | 诊断信息 | 设置页调试中心 |
| `/scan-dirty` | 7657 | 扫描脏文件 | 设置页(裸 fetch) |
| `/browse-dir` | 7678 | 列目录 | 设置页目录浏览器 |
| `/pick-dir` | 7701 | 原生目录选择器 | 设置页存储 |
| `/update-check` | 7723 | 版本检查 | 面板头徽标 / 设置页维护 |
| `/update` | 7736 | 执行更新 | 设置页维护「立即更新」 |
| `/config` | 7762 | 读写全部配置 | 设置页保存 / 白板页 / 首启向导 |
| `/reflect` | 7871 | 手动写反思 | 反思页 |
| `/reflect-auto` | 7882 | AI 一键反思 | 概览页 1564 / 反思页 2314 |
| `/note` | 7791 | 保存项目笔记 | 笔记页 |
| `/external` | 7814 | 外部源清单 | 接续页 / 首启向导 |
| `/external-view` | 7823 | 查看外部源内容 | 接续页 |
| `/external-import` | 7857 | 导入外部源 | 接续页 / 向导批量 2764 |
| `/external-remove` | 7843 | 移除已导入内容 | 接续页 |
| `/calendar` | 7891 | 日历读写 | 日历页 |
| `/summarize` | 7915 | 生成时段总结 | 概览页总结卡 |
| `/greet` | 7931 | 生成问候语 | 概览页 |
| `/notices` | 7945 | 拉取动态通知 | 通知弹窗 |
| `/activation-inbox-pre` | 7536 | M6 激活收件箱 | **对不上界面**(client.js 零引用) |
| `/semantic-status` | 7109 | 语义资产就绪状态 | 设置页语义区块 / 首启向导 |
| `/semantic-deep-detect` | 7154 | 快检+深扫+热接入 | 设置页环境检测面板 |
| `/semantic-download` | 7264 | 下载 JS 语义模型 | 设置页 / 向导 |
| `/semantic-emit` | 7284 | 唤起注入档位 | 设置页 emit 下拉 / 向导 3286 |
| `/python-setup/detect` | 7063 | 检测 Python 环境 | 安装向导 |
| `/python-setup/venv` | 7071 | 建 venv | 安装向导 |
| `/python-setup/deps` | 7081 | 装依赖 | 安装向导 |
| `/python-setup/model` | 7091 | 下载模型 | 安装向导 |
| `/python-setup/cancel` | 7100 | 取消下载 | 安装向导 |
| `/python-setup/status` | 7055 | 安装进度 | 安装向导轮询 |
| `/handoff-state` | 7163 | 白板+账本数据 | 白板页 |
| `/handoff-continue` | 7175 | 构造接续材料 | 白板页一键接续 |
| `/handoff-permission` | 7191 | 权限预设继承 | 接续流程(无独立 UI) |
| `/auto-continue-state` | 7207 | 接续宿主状态 | 自动接续宿主轮询 |
| `/auto-continue-decide` | 7216 | 同意/拒绝接续 | 自动接续确认卡 |
| `/subagent-gc` | 7230 | 子代理痕迹回收 | **对不上界面**(client.js 零引用) |
| `/shadow-recent` | 7309 | shadow 观测记录 | 唤起回顾页 |
| `/review-feedback` | 7395 | 唤起决策打分 | 唤起回顾页 A/P/S/H/E |
| `/memory-hub` | 7463 | 三层记忆中枢数据 | 记忆中枢页 |
| `/storage-manage` | 7502 | 存储扫描/修复/删除 | 存储管理页 |
| `/models` | 7960 | provider/模型目录 | 设置页模型抽屉 |

## 4. 代码结构体感

**最长 5 个函数/组件**(client.js,按行跨度;全文具名函数 125 个):`SettingsPage` 582 行(3667-4248)、`DialogHost` 478 行(3076-3553)、`apply` 237 行(4251-4487)、`CalendarTab` 168 行(2513-2680)、`PlanTab` 134 行(2148-2281)。

**重复实现**
1. 两套 HTTP 常量表手工同步:index.js:129-176(46 条)与 client.js:858-897(40 条,键名风格不同)各维护一份同一批路径;另有 20 处裸字符串 `fetch('/api/dsh-auto-memory-pre/...')` 绕过常量表(client.js:1626、1629、1635、1804、1812、1906、1914、1924、3092、3105、3110、3117、3127、3855、3865、3891、3924、3944、3976、4079)。
2. RefineTab 内 `badge`/`reasonChip`/`apeRow` 逐字重复两份:client.js:1644-1662 与 1682-1699。
3. 写配置有 4 条互不相同的路径:`SettingsPage.save()` 3888-3893(整对象 POST)、`PlanTab.autoSave` 2178-2181(patch 直发)、向导 `tourToggleClick` 3272-3290、向导 `tourExtToggle` 3292-3300。

**巨型函数**:`SettingsPage`(582 行)单函数装下 8 个设置分组、目录浏览器、模型抽屉、环境检测面板、安装向导挂载、更新检查、调试中心;`DialogHost`(478 行)单组件装下 7 种弹窗 + 首启向导状态机(含 10 个内联开关定义 3196-3234)。

本次盘点读取的文件:`D:\dsh-auto-memory\lib\client.js`(全文 4,493 行)、`D:\dsh-auto-memory\lib\index.js`(API 常量表 120-176、`DEFAULT_CONFIG` 190-425、`DEFAULT_PROMPT_LAYERS` 427-454、路由注册 7052-7990)。未读取其他文件,未修改除本文件外的任何文件。
