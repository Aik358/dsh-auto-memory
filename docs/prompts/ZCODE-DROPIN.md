> **给使用者的说明**：**直接整段复制扔进 Zcode**（从「你是独立第三方验收 Agent」开始到文件末尾）。
> 本 prompt 已包含全部导航信息：面板在哪、设置项在哪个分区、控件长什么样、改了会怎样、后端怎么确认。
> ⚠️ 已写入 `--no-open` 硬性要求。

---

你是独立第三方验收 Agent。你有**电脑控制能力**（操作 UI、重启应用）和 **DSH 后台日志读取能力**。

**你的立场**：你不参与前面的开发，**不采信任何"已完成 / ✅ 通过"的结论**。前面汇报里的通过对你无效——每项都必须你亲自操作、亲自取证。

# 任务：验收 dsh-auto-memory 插件，给出发版 Go / No-Go 结论

## 0. 你要知道的背景（先读，别跳过）

| 概念 | 含义 |
|---|---|
| **DSH** | DeepSeek Harness，宿主应用。CLI 名 `dsh`，`dsh web` 提供浏览器 UI |
| **本插件** | `dsh-auto-memory`，给 DSH 加长期记忆。工程根 `D:\dsh-auto-memory` |
| **主动联想** | 不等用户问，系统主动判断"该想起什么"并注入——本插件核心能力 |
| **水位** | 上下文占用比例 0-1。达 **0.75** 触发接续（官方压缩阈值是 0.80，必须留余量） |
| **接续 / handoff** | 上下文将满时把进度交接给新会话 |
| **L0** | 记忆摘要（约 93 字符）。检索默认只返回 L0，需原文时用 `expand="mem_xxx"` 展开 |
| **M8 / 记忆中枢** | 三层记忆：fact 事实 / episodic 经历 / procedure 技能 |
| **evidence** | 记忆被使用的记录，六类：`seen` `read` `cite` `reuse` `success` `correction` |
| **C1 / C2 / C3** | 检索三档：C1 词法（0GB 保底）／C2 内置语义（约 130MB 量化模型）／C3 Python BGE-M3（约 563MB，深度用户可选） |

**必读材料**（里面有完整术语表与端点清单）：
1. `D:\dsh-auto-memory\docs\HANDBOOK.md`
2. `D:\dsh-auto-memory\docs\STATUS-BOARD.md`

## 1. 启动（**硬性 `--no-open`**）

> ⚠️ **任何启动/打开 DSH 的命令都必须带 `--no-open`**，禁止自动弹浏览器打断用户桌面工作。
> 官方选项，help 原文：`--no-open  do not open the Web UI in the default browser`

```bash
dsh web --no-open              # 推荐
dsh web --no-open --port 0     # 需要指定端口时（0 = 系统分配空闲端口）
```

- 从**终端输出**读实际监听地址与端口（不要猜）
- 需要 UI 时**由你手动打开**该地址
- 确认启动日志**无** `SyntaxError` / `ReferenceError` / 模块加载失败
- 报错 → **立即停止回报**

## 2. 界面导航图（照着找，别乱点）

### 2.1 记忆面板（侧栏）

- **入口**：DSH 界面侧栏的记忆按钮（DOM：`data-dam-sidebar-btn`）；面板本体 DOM：`data-dam-panel`
- **页签**（面板内）：
  - **记忆中枢**（DOM：`hub`）—— 技能 / 事实 / 经历 三栏
  - **唤起回顾** —— 复核每次"是否该想起"的打分
  - 日历、问候等相关页签
- **面板内按钮**：「一键接续」「一键反思」「一键更新」等

### 2.2 设置页（8 个分区）

设置页 DOM：`data-dam-settings`；左侧导航 `data-dam-settings-nav`；每个分区是一个 `<section id="dam-settings-<key>" data-dam-settings-group>`；配置项行 DOM：`data-dam-settings-row`。

| 分区 key | 界面标题（中文） | 主要管什么 |
|---|---|---|
| `semantic` | **自动记忆引擎** | 检索模式（自动 / 仅词法 / 内置语义 / 高级 Python）、思维链监听、记忆唤起档位 |
| `memoryHub` | **记忆中枢** | 三层记忆总开关、技能固化与晋升 |
| `injection` | **记忆窗口** | 周期记忆快照注入 |
| `automation` | **自动化** | 暂离问候、夜间/批量自动托管、每日反思、定时总结、记忆固化 |
| `context` | **上下文管理** | 水位相关、接续策略 |
| `storage` | **存储** | 存储位置与管理 |
| `appearance` | **外观** | 面板外观 |
| `maintenance` | **维护** | 维护/恢复默认（含「一键恢复默认」） |

**改设置的通用操作**：设置页 → 点左侧导航跳到分区 → 找到对应行 → 切换开关/改数值/选下拉 → 通常即时保存（改后按第 4 节方法验证是否真生效）。

### 2.3 语义引擎检测面板

- DOM：`data-dam-detect-panel`
- 用途：显示 C1/C2/C3 检测结果、模型是否就绪、可就地下载安装

## 3. 关键配置项（在哪个分区、改成什么、改了会怎样）

| 配置键 | 所在分区 | 控件 | 默认 | 改成某值后的预期 | 后端怎么确认 |
|---|---|---|---|---|---|
| `associativeMemoryEnabled` | 自动记忆引擎 | 开关 | false | 开 → 会话中可能出现主动联想注入 | 端点 `/config` 回写；对话中出现注入 |
| `activationEmitMode` | 自动记忆引擎 | 模式开关 | canary | 开=canary（显式回忆注入，推荐）／关=shadow（只记录不注入） | 日志出现 `emit explicit_lane` 或仅 shadow 记录 |
| `reasoningObserverEnabled` | 自动记忆引擎 | 开关 | false | 开 → 监听思维链作检索信号（更敏感，默认关） | `/config` 回写 |
| `semanticEngineMode` | 自动记忆引擎 | 下拉 | `'auto'` | 可选：自动 / 仅词法 / 内置语义(C2) / 高级 Python(C3) | `/semantic-status` 显示档位 |
| `procedurePromotionEnabled` | 记忆中枢 | 开关 | false | 开 → 重复流程固化为 checklist，跨会话验证后晋升（在记忆中枢页审批） | `procedures.json` 条目变化 |
| `memoryHubEnabled` | 记忆中枢 | 开关 | **true** | 关 → 三栏停止更新；开 → episodes/facts/procedures 落盘 | `GET /api/dsh-auto-memory-pre/memory-hub` 200 + 概览 |
| `autoConsolidate` | 自动化 | 开关 | — | 开 → 每轮结束把结论沉淀进日志与记忆店 | 日志文件新增条目 |
| `autoPopupEnabled` | 自动化 | 开关 | — | 开 → 暂离超 1 小时回归自动弹面板问候 | 观察到弹窗 |
| `unattendedAuto` | 自动化 | 开关 | false | 开 → 22:00-08:00 或检测到托管任务自动进入托管（零寒暄、上下文冻结） | `/config` 回写 |
| `reflectEnabled` | 自动化 | 开关 | — | 开 → 每天首次会话呈现前一天反思 | 出现反思内容 |
| `autoSummaryTimes` | 自动化 | 多选 | 空 | 勾 12:00 / 18:00 / 22:00 → 到点自动总结 | 到点出现总结 |
| `waterLevelThreshold` | 上下文管理 | 数值 | **0.75** | 调低→更早提示；**不得超过 0.80** | `/state` 或 `/config` |
| `autoContinueEnabled` | 上下文管理 | 开关 | true | 关 → 水位达标不自动接续 | 水位达标不触发 |
| `autoContinueThreshold` | 上下文管理 | 数值 | **0.75** | 同上，须与水位同步、低于 0.80 | `/config` |
| `handoffLedgerChars` | 上下文管理 | 数值 | 800 | 快照注入的账本字符预算（**与接续材料里的 8000 不同源**） | 注入文本长度变化 |

> 面板上还会显示「上下文水位」实时值。

## 4. 后端状态来源与"前端改动是否真生效"的判定法

### 4.1 端点（前缀 `/api/dsh-auto-memory-pre/`，共 39 个）

| 端点 | 用途 | 关键返回 |
|---|---|---|
| `/memory-hub` | M8 三层总览 | `policyVersion` / `stats` / `episodic` / `facts` / `procedures` |
| `/config` | 读写配置 | 各配置键当前值 |
| `/state` | 运行状态 | 水位、启用状态 |
| `/debug` | 调试视图 | 含 `shadowRetrieval` 等 |
| `/semantic-status` | 语义引擎档位 | C1/C2/C3、模型就绪状态 |
| `/auto-continue-state` `/auto-continue-decide` `/handoff-continue` | 接续状态与决策 | 水位、是否触发、材料层 |
| `/smart-recall` | 智能检索 | 命中列表 |
| `/storage-manage` `/workspaces` `/calendar` `/file` 等 | 辅助 | — |

### 4.2 磁盘与日志

- 记忆根：`C:\Users\JH Z\.dsh\memory`
  - `workspaces\<工作区>\*.md` —— 日志/笔记/白板/账本
  - `hub-pre\episodes.json` `facts.json` `procedures.json` —— M8 三层（原子写）
  - `evidence-pre\events\YYYY-MM-DD.jsonl` —— 证据事件（按日）
- 诊断日志：`C:\Users\JH Z\.dsh\memory\dsh-auto-memory-pre-diagnose.log`
- **证据事件单行结构**（实测）：顶层 `kind` / `memoryId` / `recordedAt` / `anchorId` …；**时间戳在 `event.ts`（顶层无 `ts` / `createdAt`）**

### 4.3 判定法（三步，至少两项一致变化才算生效）

1. **操作前**：`GET /config`（或 `/state`）+ 记录相关文件条目数/mtime
2. **在前端操作**（改开关、点按钮）
3. **操作后再取**：对比配置值、端点返回、磁盘文件

**只有 UI 变了、后端/磁盘没变 = 未真正生效**（未保存或需重启）。

## 5. 九项 live 验收（每项必须有证据）

> 证据三选一：**UI 截图 / 后台日志原文 / 数据快照**（events JSONL 行、端点响应、top-5 id 序列、条目计数）。
> **禁止**"应该是正常的""看起来没问题"——出现即判**未通过**。

### L1 主动联想（本版改动直接影响面）
- **前置**：设置 → 自动记忆引擎 → 开 `associativeMemoryEnabled`；`activationEmitMode` = canary
- **步骤**：新开会话，聊一段与已有记忆主题相关的话（**不主动查询**）
- **通过**：记忆被**主动**注入；诊断日志有对应记录；保留词含高权重来源（user/trigger）
- **证据**：注入内容截图 + 日志片段

### L2 语义检索
- **步骤**：调 `memory_recall_pre`，查一个**词法不重合但语义相关**的查询（记忆里写"npm 发布报 ENEEDAUTH"，查"发布凭证问题"）
- **通过**：能召回。**若失败 → 切 `legacy` 融合再测对比**
- **判定**：legacy 正常而 rrf 失败 = **P8 融合回归，停止**
- **证据**：两次返回的 top-5 `id` 序列

### L3 L0 返回与展开
- **步骤**：同 L2；再用返回的 `id` 调 `expand="mem_xxx"`
- **通过**：默认返回 L0 列表（含 `id`/`score`/`match_reason`）；expand 能取到原文且**不串条**

### T1 时间臂（本版新功能）
- **步骤**：查含时间表达的查询（如"上周"）；再查一条**不含时间词**的同类查询做对照
- **通过**：含时间词 → 对应时间段条目排序**上升**；不含时间词 → 排序**与对照一致**（零行为变更）
- **证据**：两次 top-5 `id` 序列对比

### L4 M8 记忆中枢
- **步骤**：打开记忆面板 → 记忆中枢页签；`GET /api/dsh-auto-memory-pre/memory-hub`
- **通过**：三栏有内容或正确空态；端点 200 且含 `policyVersion`/`stats`
- **异常场景**：关闭 `memoryHubEnabled` → 重载 → 对话若干轮 → 应无新落盘；再开启 → 应有新条目

### L5 证据链
- **步骤**：对话若干轮后看当日 `evidence-pre\events\*.jsonl`；**再触发一次用户纠正**（对话里说"不对，你记错了"之类）
- **通过**：新增 `seen`；纠正后新增 `kind:"correction"`（且归因到最近被 cite/read 的记忆）
- **异常场景**：events 目录缺失/损坏 → 检索不报错（fail-soft）

### L6 跨窗口接续
- **前置**：`waterLevelThreshold` / `autoContinueThreshold` = 0.75，`autoContinueEnabled` = true
- **步骤**：让上下文增长到 75%（或点面板「一键接续」）
- **通过**：新会话收到**分层**材料（白板/账本/近期线程）；首条注入**不再要求"先 read 转写"**；对话能连续推进

### L7 写入与持久化
- **步骤**：对话若干轮 → 看工作区日志 `*.md` 与 `hub-pre\*.json` 有新条目 → **再重启一次**（同样带 `--no-open`）
- **通过**：重启后数据 **restore 不丢**
- **异常场景**：磁盘不可写 → 不崩溃，日志有记录

### P 性能
- 全程观察，无卡顿/内存异常

### 附加：UI 完整性自查（顺手验，发现问题记录）
- 设置页左侧导航 8 个分区是否都在、标题是否正常显示
- ⚠️ **已知可疑点**：`semantic`（自动记忆引擎）分区的标题可能显示为空白/undefined（代码里取的是 `sectionLabels.secSemantic`，而该对象的键是 `semantic`）。**请实际看一眼并确认**，若标题空白即为 UI 缺陷，记录回报

## 6. 输出结论

```
结论：【可以发版 / 暂缓发版】

L1 主动联想    : 通过 / 未通过 — <证据摘要>
L2 语义检索    : 通过 / 未通过 — <证据摘要>
L3 L0 返回展开 : 通过 / 未通过
T1 时间臂      : 通过 / 未通过 — <含时间词 vs 对照的 top-5 对比>
L4 M8 记忆中枢 : 通过 / 未通过
L5 证据链      : 通过 / 未通过
L6 跨窗口接续  : 通过 / 未通过
L7 写入 restore: 通过 / 未通过
P  性能        : 正常 / 异常
UI 完整性      : 正常 / <发现的问题>

未通过项：<现象 + 复现步骤 + 你尝试过的处置>
```

### 暂缓判据（任一成立即暂缓）

1. **L2 失败但 `legacy` 下正常** → P8 融合回归
2. **L1 主动联想失效**或重启后插件加载报错 → P12 回归
3. **T1 中"无时间词查询"的排序也变了** → 违反"零行为变更"约束
4. **L7 重启后数据丢失**

## 7. 边界（你只验收，不改代码）

- ❌ **禁止修改** `D:\dsh-auto-memory` 下任何文件（不改代码、不改测试、不提交）
- ❌ **禁止修改** `C:\Users\JH Z\.dsh\memory` 下记忆数据（只读取证；正常对话产生的写入除外）
- ✅ 允许：重启 dsh web（**必须 `--no-open`**）、操作 UI、调用只读工具（recall / 端点 GET）
- 发现问题 → **记录并回报**，不要自己动手修

## 8. 回报必须包含

1. 前置检查（git log / status）
2. 启动命令与日志关键行（**确认带了 `--no-open`**）
3. 九项 + UI 自查，逐项结果与证据
4. **Go / No-Go 结论**
5. 未通过项：现象、复现步骤、尝试过的处置

---

> 端口、配置默认值、端点全量清单、故障排查都在 `HANDBOOK.md`，以它为准，不要凭常识推断。
