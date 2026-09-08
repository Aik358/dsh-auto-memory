# dsh-auto-memory 用户文档

> 无问自忆:记忆不靠你吩咐,该想起的自己浮现;每条都有出处,可查、可改、可删。
> 适用版本:**2.2.4** · 更新日志见插件内「设置 → 外观 → 查看更新日志」。

---

## 目录

1. [安装与入口](#1-安装与入口)
2. [第一次启动](#2-第一次启动)
3. [设置页逐组详解](#3-设置页逐组详解)
   - [自动记忆引擎](#31-自动记忆引擎semantic)
   - [记忆中枢](#32-记忆中枢memoryhub)
   - [外观](#33-外观appearance)
   - [存储](#34-存储storage)
   - [记忆窗口](#35-记忆窗口injection)
   - [自动化](#36-自动化automation)
   - [上下文管理](#37-上下文管理context)
   - [维护](#38-维护maintenance)
4. [上下文管理专题](#4-上下文管理专题)
5. [语义引擎专题](#5-语义引擎专题)
6. [记忆工具(对话中直接可用)](#6-记忆工具)
7. [常见问题排查](#7-常见问题排查)
8. [数据位置与回滚](#8-数据位置与回滚)

---

## 1. 安装与入口

- 安装:`pnpm add @a9i5k4/dsh-auto-memory`(或在 DSH 插件市场搜索 dsh-auto-memory)。
- **装完必须重启 dsh web**:插件的注入面(manifest)在启动时加载;改完 host 代码同理。
- 浏览器端更新后需**硬刷新**(Ctrl+Shift+R)才会加载新 client.js。
- 入口:左侧栏底部 **记忆** 按钮 → 记忆面板,含页签 **概览 / 白板 / 语料精修 / 设置**。
- 数据全在本机:`~/.dsh/memory/`(记忆文件)、`~/.dsh/dsh-auto-memory-pre.json`(配置,发布版为 `dsh-auto-memory.json`)。

## 2. 第一次启动

- 首次启动播放**欢迎向导**,每项功能当场可开关;想重看:设置 → 外观 →「重新播放向导」。
- 向导会提示下载**内置语义模型**(约 130MB,multilingual-e5-small,本地离线运行)。不下载也能用,召回退化为词法排序。
- 之后随时到 设置 逐组调整。**所有设置改动即时保存**(写配置文件),无需重启;仅"注入面/工具清单"类改动需要重启宿主。

---

## 3. 设置页逐组详解

> 左侧分组导航顺序:**自动记忆引擎 → 记忆中枢 → 外观 → 存储 → 记忆窗口 → 自动化 → 上下文管理 → 维护**。
> 下表默认值即出厂设置;`(重启生效)` 标注的项需要重启 dsh web。

### 3.1 自动记忆引擎(semantic)

| 项 | 默认 | 怎么调 |
|---|---|---|
| 总开关(associativeMemoryEnabled) | 开 | 关闭即整插件休眠(不注入、不沉淀),已存记忆保留 |
| 注入模式(activationEmitMode) | `shadow` | **shadow**=只记录不打扰(最稳,先跑几天看效果);**canary-explicit**=命中可信度高的回忆才显式注入;**active**=全部注入 |
| 候选方案(candidateScheme) | `balanced` | balanced 3×40 / dense 6×20 / custom;查询越复杂越适合 dense,日常 balanced |
| 语义引擎模式(semanticEngineMode) | `auto` | auto / lexical / js / python,详见 §5 |
| 思考链观察(reasoningObserverEnabled) | 开 | 是否把思维链/分支纳入观测面(开源模型为主时建议保持开) |
| 子会话观测(contextBridgeObserveChildSessions) | 开 | 是否观测子代理会话的事件 |
| 唤起阈值 | 固定 | 校准值 tauHi 0.45 / tauLo 0.35,只读展示;旁边显示当前发射模式 |

### 3.2 记忆中枢(memoryHub)

记忆中枢把对话蒸馏成三类长期记忆(情景 / 语义 / 程序),**默认关闭**,打开后才开始蒸馏。

| 项 | 默认 | 怎么调 |
|---|---|---|
| 记忆中枢总开关(memoryHubEnabled) | 关 | 打开即启用三层记忆蒸馏;关闭保留已有记忆但停止新增 |
| 情景记忆最小段落数(episodicMinSegments) | 2 | 一段对话至少跨 N 个段落才成一条情景记忆,调大更保守 |
| 情景记忆保留条数(episodicRetention) | 256 | 上限;超出按时间淘汰 |
| 程序记忆最小会话数(procedureMinSessions) | 3 | 同一套操作至少出现 N 个会话才固化为"程序" |
| 程序记忆最小成功数(procedureMinSuccess) | 2 | 至少成功 N 次才算可靠程序 |
| 纠错上限(procedureCorrectionCap) | 0.3 | 纠正比例超过该值即降权/淘汰该程序 |
| 高风险需审批(procedureHighRiskApproval) | 开 | 涉及高风险动作的程序在使用前要求确认 |
| 激活层级(procedureActiveLevel) | checklist | checklist 完整步骤 / excerpt 摘要 / hint 仅提示 |

### 3.3 外观(appearance)

| 项 | 默认 | 说明 |
|---|---|---|
| 欢迎向导(welcomeTourEnabled) | 开 | 首启是否自动播放;旁边可「重新播放」「查看更新日志」 |
| 界面语言(locale) | 跟随系统 | 中文 / English / 跟随系统 |
| 字号(fontScale) | 标准 | 面板与卡片缩放 |
| 强调色(accentTheme) | DeepSeek 蓝 | DeepSeek 蓝 / 石墨灰 / 雾紫;日历与状态色保持语义色 |
| 关系图密度(graphDensity) | 舒展 | 影响工作区关系图的节点间距与显示数量 |

### 3.4 存储(storage)

| 项 | 默认 | 说明 |
|---|---|---|
| 用户级记忆目录(userMemoryDir) | `~/.dsh/memory/MEMORY.md` | 跨项目规则 |
| 项目记忆目录(projectMemoryDir) | `<工作区>/.dsh-memory/` | 项目笔记与每日日志 |
| 记忆根目录(memoryRoot) | `~/.dsh/memory` | 可点「浏览」换位置 |

### 3.5 记忆窗口(injection)

| 项 | 默认 | 怎么调 |
|---|---|---|
| 注入总开关(injectEnabled) | 开 | 关掉即完全不往对话里注入记忆 |
| 注入预算(injectBudgetChars) | 2400 | 觉得 AI 总被记忆打扰就调小;想不起事就调大 |
| 注入近期天数(recentDaysInjected) | 1 | 最近 N 天日志参与注入 |
| 外部记忆预算(externalInjectionChars) | 1400 | 其他 AI 工具(WorkBuddy/Claude Code 等)记忆的注入上限 |
| 快照最小间隔轮数(snapshotMinGapRounds) | 5 | 同一快照至少间隔 N 轮才重复注入 |
| 压缩后重注入(snapshotReinjectOnCompact) | 开 | 上下文被压缩后重新注入记忆快照 |
| prompt 层编辑(promptLayerOverrides) | 空 | 逐层覆盖注入文案;可一键恢复默认 |

### 3.6 自动化(automation)

| 项 | 默认 | 怎么调 |
|---|---|---|
| 自动沉淀最小字数(autoConsolidateMinChars) | 240 | 本轮对话短于该长度不触发沉淀 |
| 自动沉淀开关(autoConsolidate) | 开 | 每轮结束自动评估并写今日日志 |
| 沉淀冷却(分钟)(autoConsolidateCooldownMinutes) | 30 | 夜间(22:00–08:00)自动翻倍 |
| 每日沉淀上限(autoConsolidateDailyMax) | 8 | 防止额度被短时间耗尽 |
| 自动弹窗(autoPopupEnabled) | 开 | 重要状态是否弹面板提示 |
| 无人值守(unattendedMode) | 关 | 开启后静默一切主动打扰(建议挂机时开) |
| 无人值守自动接续(unattendedAuto) | 关 | 挂机时水位到阈值即自动接续(无需点确认卡) |
| 暂离问候(awayMinutes) | 60 | 距上次活动超过 N 分钟后回归时注入一次欢迎;0=关闭 |
| 时段总结时间(autoSummaryTimes) | 空 | 逗号分隔的 HH:MM 列表,到点跑一次时段总结 |
| 日界(分钟)(dayBoundaryMinutes) | 450 | 凌晨归前一天的分界线(450=07:30) |
| 每日反思(reflectEnabled) | 关 | 是否自动生成昨日反思 |
| 定时固化(consolidateScheduleEnabled/Time/Days) | 开 / 09:30 / 7 | 每天到点读最近 N 天日志发散提炼长期要点 |
| 定时蒸馏(maintainScheduleEnabled/Time) | 开 / 10:00 | 每天到点把超过 30 天的旧日志蒸馏归档 |
| 反思风格(reflectStyle) | 由内容决定 | 生活化 / 专业性 / 由内容决定 |
| 总结/问候默认模型(subagentModel) | 跟随路由默认 | 时段总结、问候、自动沉淀等子代理用的模型;留空即跟随 |

### 3.7 上下文管理(context)

| 项 | 默认 | 怎么调 |
|---|---|---|
| 交接白板(handoffEnabled) | 开 | PLAN.md + 四段式账本,注入到动态快照首位 |
| 白板注入预算(handoffPlanChars) | 1200 | 字符硬截断 |
| 账本注入预算(handoffLedgerChars) | 800 | 字符硬截断 |
| 水位窗口覆盖(waterLevelWindowTokens) | 0=自动 | 0 表示自动:优先官方路由容量,其次按当前模型查 settings.yaml。**除非特殊模型,保持 0** |
| 水位阈值(waterLevelThreshold) | 0.8 | 越阈值即注入交接建议并自动补写账本 |
| 水位建议注入(waterLevelAdvisory) | 开 | 无人值守时静默 |
| 越阈值自动写账本(waterLevelAutoHandoff) | 开 | 每会话一次,给 AI 一个骨架,正式账本仍由 AI 写 |
| **子代理痕迹回收**(subagentGcEnabled) | 开 | 见 §4.5 |
| **兜底回收保留天数**(subagentGcKeepDays) | 3 | 每天巡检一次,回收超过该天数仍残留的痕迹;0=只靠任务结束即删 |

> 「自动接续」的开关与阈值**不在设置页**,在**记忆面板 → 白板页签**顶部的「自动接续」卡片(见 §4.4)。

### 3.8 维护(maintenance)

| 项 | 说明 |
|---|---|
| 版本 / 检查更新 / 立即更新 | 显示当前与最新版本;registry 安装可直接一键更新 |
| 诊断日志 | `~/.dsh/dsh-auto-memory-pre-diagnose.log`(子代理熔断、跳过、回收等事件都在内) |
| 交流群 | 反馈问题比 GitHub issue 更快 |

---

## 4. 上下文管理专题

### 4.1 水位感知(上下文水位)

记忆面板 → 白板页签顶部显示:**已用 token / 窗口 token · 百分比**,后面标注两个来源:

- **计量**:`官方计量(usage)` = 与聊天框 context ring 同源(token-meter 的 `totalTokens`,即**当前上下文占用**);不可用时降级为启发式估算。
- **窗口**:`官方路由容量` = 取自会话日志 `request/context` 的 `contextWindow`(最权威);`自动检测: provider/model` = 按当前模型查 `settings.yaml` 的 `contextWindow`;`回退默认值` = 前两条都拿不到时的保守值(128K)——看到这个标签说明模型窗口没识别出来,可到设置页手动填 `waterLevelWindowTokens`。

达到阈值后:AI 收到交接建议,并自动补写一篇骨架账本(正式账本仍由 AI 写)。

> **2.2.4 修复**:此前窗口解析有两条路同时失效(settings.yaml 的 flow 风格 YAML 解析不出、官方 contextWindow 事件只在会话开头出现而旧代码只扫最近 256 条),导致 1M 窗口被当成 128K、水位虚高显示 150%+。现已修复并如实标注来源。
>
> **比例如实上报**:旧版还把百分比硬截断到 150%,任何超额都显示成同一个数(例如 761,692 / 131,072 真实为 581%,却显示 150%)。现在显示真实百分比,进度条仍按 100% 封顶。注意:宿主代码不会热重载,**升级后必须重启 dsh web**(浏览器再 Ctrl+Shift+R),否则读到的仍是旧窗口解析。

### 4.2 交接白板

- **PLAN.md**:项目全貌快照(项目全貌 / 当前目标 / 关键约定 / 下一步),AI 在有实质变化时重写,旧版自动归档。
- **四段式交接账本**:任务状态 / 目标 / 已试方案与失败原因 / 进度与下一步,每段 ≤5 行,下一步必须是可直接执行的第一步。
- 两者都会注入到每轮对话的动态快照首位,是跨窗口续命的核心。

### 4.3 一键接续(手动)

白板页签 →「**一键接续到新会话**」。流程与提示顺序:

1. `刷新仪式:请旧 Agent 更新白板 PLAN 与交接账本…`(旧 Agent 先刷新材料,可在设置页关掉)
2. `正在构造交接材料(含旧会话转写)…`
3. `正在创建新会话(沿用旧工作区与模型)…` → `正在沿用旧模型 …` → `✓ 已创建新会话…`

新会话**沿用**旧会话的工作区、模型、思考档位与预设,标题为 `接续 #N · <工作区名>`,首条消息是**分层交接材料**:

| 层 | 内容 |
|---|---|
| 第0层 | 指令 + 白板 PLAN.md 节选 |
| 第1层 | 最新交接账本全文 |
| 第2层 | 近期线程(最近 20 条 × 700 字,保留角色与工具标记) |
| 第3层 | 旧会话完整转写文件路径(新会话 AI 可随时 read 回读) |

材料带时间戳,并会提示「白板比账本旧」这类过期风险。

### 4.4 自动接续(免按钮,推荐)

白板页签 →「自动接续」卡片:开关(默认开)+ 阈值(默认 0.8)。

- **触发条件**:水位 ≥ 阈值 **且** harness 权威 `running` 位在轮次边界转为 `false`(会话真的空闲了)。长工具调用不会误触发。
- **确认卡三分支**:点「同意接续」= 立即接续;点「拒绝」= 本轮跳过,同一边界不再提示;**30–40 秒无操作** = 视为挂机,自动接续。
- 接续前先跑刷新仪式;触发后默认 30 分钟内不重复。
- 挂机无人值守:设置页 → 自动化 →「无人值守自动接续」打开后,不再弹确认卡,直接接续。

### 4.5 子代理痕迹回收(2.2.4 新增)

**问题**:DSH 会为每个子代理创建一个持久化会话(`~/.dsh/sessions/<工作区>/<裸 uuid>/`)。本插件的自动沉淀 / 时段总结 / 问候 / 蒸馏都会 spawn 一次性子代理,实测全机 686 个子代理会话里 **638 个来自本插件**;积累上千后会拖慢会话列表加载。

**做法**(设置 → 上下文管理):

- **子代理痕迹回收**(默认开):子代理一结束,就把它的会话目录与投影缓存**移动**到 `~/.dsh/subagent-gc-backup/`(只移动不删除,可整体回滚),不影响子代理结果。
- **兜底回收保留天数**(默认 3):每天巡检一次,回收超过该天数仍残留的痕迹(例如任务异常中断没删掉的);填 0 表示只靠"任务结束即删"。
- 手动预览/执行:`node tools/subagent-gc.mjs`(预览,不移动任何文件)、`node tools/subagent-gc.mjs --apply`。
- HTTP 自查:`GET /api/dsh-auto-memory-pre/subagent-gc`(只预览统计),`POST` 同路径即执行回收。
- 回滚:把 `~/.dsh/subagent-gc-backup/<工作区>/<会话 id>/` 移回 `~/.dsh/sessions/<工作区>/` 即可。

> 清理只针对 `origin=subagent` 且 label 以 `auto-memory-` 开头、mode 为 `one-shot` 的会话;可续聊(continuable)的子代理一律保留。

---

## 5. 语义引擎专题

下拉四档(设置 → 自动记忆引擎 →「语义引擎模式」):

- **auto(默认)**:内置 JS 语义就绪即用,否则词法保底——最省心。
- **lexical**:强制词法(不下载模型也能选)。
- **js**:内置 JS 引擎(multilingual-e5-small,约 130MB)。选了但没下载会提示「实际生效:词法兜底」,点旁边 **⟳ 检测** 按引导下载。
- **python**:高级引擎(BGE-M3 int8,约 563MB,本地 Python sidecar),召回质量最高,需要引导式安装(创建 venv + 下载模型)。装不上不影响其他档位。

不确定时:**auto + shadow** 是最稳组合;看到「词法兜底」就说明语义资产没就绪。

---

## 6. 记忆工具

AI 在对话中可直接调用(你不需要记,但了解一下有好处):

| 工具 | 作用 |
|---|---|
| `memory_log_pre` | 追加今日日志(append-only) |
| `memory_note_pre` | 项目笔记 / 交接账本 / 白板重写 |
| `memory_user_pre` | 跨项目长期规则 |
| `memory_recall_pre` | 跨工作区检索记忆 + 历史会话全文检索 |
| `memory_read_pre` | 按需读取某天日志 / 反思 / 笔记全文 |
| `memory_external_pre` | 查看并接入其他 AI 工具的记忆(WorkBuddy/Claude Code/Codex/ZCode 等) |
| `memory_consolidate_pre` | 做梦式固化:读日志发散提炼长期要点 |
| `memory_maintain_pre` | 30 天蒸馏:旧日志提炼进笔记,原文归档 |
| `memory_reflect_pre` | 保存每日反思 |
| `memory_status_pre` | 查看记忆系统状态 |
| `calendar_add/list/done/remove_pre` | 日程管理——AI 会主动从对话里提取截止日期并后续提醒 |

自动沉淀:每轮对话结束,插件自动评估并把有长期价值的内容写进日志——**永远不需要说「记一下」**。

---

## 7. 常见问题排查

| 现象 | 处理 |
|---|---|
| 水位显示 `xxx / 131,072 token · 150%` 之类 | ①先确认**宿主已重启**(host 代码不热重载,只刷新页面没用)②窗口解析已在 2.2.4 修复;若标签仍是「回退默认值」,说明该模型不在 settings.yaml 里,手动填 `waterLevelWindowTokens` ③百分比已不再截断到 150%(旧版任何超额都显示 150%,真实值可能是 581%),进度条仍按 100% 封顶 |
| 提示「词法兜底 / 未就绪」 | 设置 → 自动记忆引擎 → ⟳ 检测,按引导下载 JS 模型或装 Python |
| 一键接续报「harness 未提供 remote.session」 | 重启 dsh web(注入面需重启加载);仍不行检查版本 ≥ 2.2.2 |
| 新会话落到「未分组工作区」/ 没沿用模型与思考档位 | 2.2.4 已修复(create 传 workspaceId、模型取自 request/header);升级后需**重启 dsh web + 硬刷新页面** |
| 自动接续没触发 | ①开关是否开 ②水位是否到阈值(白板页签看) ③会话是否真的空闲(running 已转 false) ④是否在 30 分钟冷却内 ⑤宿主是否已重启 |
| 确认卡没等到回复就跑了 | 这是挂机兜底(30–40 秒无操作视为无人值守);不想被带走就点「拒绝」 |
| 会话列表越用越卡 / 子代理一堆 | 设置 → 上下文管理 →「子代理痕迹回收」保持开;手动清一次:`node tools/subagent-gc.mjs --apply` |
| 设置页整体消失 | 旧版 bug,升级 2.2.2+ |
| 侧栏插件按钮消失 | 可能与其它往侧栏注入按钮的插件冲突(如 dsh-mobile 桌面浮层),到插件管理停用嫌疑插件 |
| 记忆乱码 / 重复 | 写入口有卫生闸门;仍异常可到 存储 分组清理对应文件(先备份) |
| 想反馈 / 拿日志 | `~/.dsh/dsh-auto-memory-pre-diagnose.log`;QQ 群见 README |

---

## 8. 数据位置与回滚

| 内容 | 路径 |
|---|---|
| 插件配置 | `~/.dsh/dsh-auto-memory-pre.json`(发布版 `dsh-auto-memory.json`) |
| 用户级记忆 | `~/.dsh/memory/MEMORY.md` |
| 工作区记忆 | `~/.dsh/memory/workspaces/<工作区>/`(MEMORY.md、每日日志、handoff/) |
| 项目内记忆 | `<工作区>/.dsh-memory/` |
| 白板与账本 | `~/.dsh/memory/workspaces/<工作区>/handoff/`(旧版在 `archive/`) |
| 子代理痕迹备份 | `~/.dsh/subagent-gc-backup/`(移回 `~/.dsh/sessions/` 即回滚) |
| 诊断日志 | `~/.dsh/dsh-auto-memory-pre-diagnose.log` |

---

*BSD-3-Clause · 仓库:github.com/Aik358/dsh-auto-memory · 更多截图与宣传:README*
