# dsh-auto-memory 接手与全量验证手册（自包含）

> **适用对象**：完全不了解本项目与插件背景的新 Agent。只凭本文件即可接手操作并完成全量验证。
> **版本基准**：插件 v2.2.6（BSD-3-Clause）／DSH v0.1.2-rc.1／Windows。
> **最后核对**：2026-09-10（以代码与 DSH CLI help 原文为准）。

---

## 0. 阅读约定与术语表（首次出现均已解释）

| 术语 | 全称 / 含义 |
|---|---|
| **DSH** | **DeepSeek Harness**，宿主应用。以 CLI `dsh` 启动，提供浏览器 UI（`dsh web`）与插件装载能力。本机安装在 `C:\Users\JH Z\AppData\Roaming\npm\node_modules\@deepseek-ai\dsh` |
| **Cordis** | DSH 使用的插件框架（`@deepseek-ai/cordis ^4.0.1`）。本插件是 Cordis 插件，通过 `cordis.patch.yml` 注入宿主 |
| **本插件** | `dsh-auto-memory`，包名同名，工程根目录 `D:\dsh-auto-memory` |
| **pre 线 / `-pre.js`** | 源码约定：新增模块一律命名为 `lib/xxx-pre.js`（纯函数、零 IO、IO 注入）。发布时由流水线剥去 `-pre` 生成同名 `lib/xxx.js`。**改源码改 `-pre.js`；`lib/xxx.js` 是产物，禁止手改** |
| **宿主侧 / 后端** | `lib/index.js`，运行在 Node 进程里，负责存储、检索、端点、工具、调度 |
| **浏览器侧 / 前端** | `lib/client.js`，注入到 DSH 浏览器 UI，负责面板与设置页 |
| **工具（tool）** | 供模型调用的函数（类似 MCP 工具）。本插件注册 10 个，统一以 `_pre` 结尾 |
| **水位（water level）** | 当前会话上下文占用比例（0–1）。用于决定何时触发接续 |
| **接续 / handoff** | 上下文将满时，把进度交接给一个新会话继续工作的机制 |
| **主动联想** | 不等用户询问，由系统主动判断"该想起什么"并注入上下文——本插件的核心差异化能力 |
| **L0 / L1 / L2** | 记忆的分层表示：L0 摘要（约 93 字符）／L1 概览／L2 原文 |
| **RRF** | Reciprocal Rank Fusion，倒数排名融合。本项目用 rank-space 形式 `1/(k + rank/divisor)`，`k=60` |
| **C1 / C2 / C3** | 三档检索引擎：C1 词法（BM25，零依赖）／C2 内置语义（e5-small 量化，约 129MB，JavaScript）／C3 Python 语义（bge-m3，深度用户可选） |
| **BM25** | 经典词法相关性算法 |
| **M8 / 记忆中枢** | 三层记忆存储（fact 事实／episodic 经历／procedure 技能）与编排器 memory-hub 的合称 |
| **evidence（证据）** | 记忆被使用情况的记录，六类：`seen`（曝光）／`read`（读到原文）／`cite`（回复引用）／`reuse`（跨会话复用）／`success`（任务成功）／`correction`（用户纠正） |
| **endpoint / 端点** | 后端 HTTP 接口，路径前缀统一为 `/api/dsh-auto-memory-pre/` |

---

## 1. 项目速览（30 秒）

本插件给 DSH 加一套**长期记忆系统**：记忆以 Markdown 文件存放在用户目录下，插件负责写入、检索、在合适时机主动提醒模型，并在上下文将满时把进度交给新会话。

- 工程根：`D:\dsh-auto-memory`
- 源码：`lib/index.js`（宿主侧，约 8000 行）、`lib/client.js`（浏览器侧）、`lib/*-pre.js`（各纯核心模块，58 个文件）
- 发布产物：`lib/`（含剥名后的 `.js`）、`python/`、`docs/`、`cordis.patch.yml`
- 运行时依赖：**零**。`dependencies` 为空；peer 为 cordis；optional 为 transformers

---

## 2. 启动与停止（**强制 `--no-open`**）

> ⚠️ **硬性要求：任何启动/打开 DSH 的命令都必须带 `--no-open`，禁止自动弹出浏览器窗口打断桌面工作。**
> 该参数是 DSH 官方选项，help 原文：`--no-open  do not open the Web UI in the default browser`。

```bash
# 推荐：启动 Web UI 但不自动打开浏览器
dsh web --no-open

# 等价写法（profile 形式）
dsh --profile web --no-open

# 需要固定端口时（0 = 让系统分配空闲端口）
dsh web --no-open --port 0
```

- 启动后，**在终端输出里读取实际监听地址与端口**（不要猜）。若需浏览器验证，由你**手动**打开对应地址。
- 停止：结束该终端中的 dsh 进程（Ctrl+C，或结束对应的 node 进程）。
- 插件生效前提：本插件已安装到 web profile（通过 `dsh plugin add` 或 junction 方式指向 `D:\dsh-auto-memory`）。

---

## 3. 架构与职责边界

```
┌─ 浏览器侧（前端）lib/client.js ────────────────────────────┐
│  · 记忆窗格（侧栏面板）                                     │
│  · 记忆中枢页签（技能/事实/经历 三栏）                       │
│  · 设置分组（开关与数值配置）                                │
│  · 悬浮钉（快捷入口）                                        │
│  · 语义引擎环境检测面板                                      │
│  仅负责「展示 + 收集用户操作」，通过 DSH 远程 API 调用后端    │
└───────────────┬───────────────────────────────────────────┘
                │ HTTP /api/dsh-auto-memory-pre/*
┌───────────────▼───────────────────────────────────────────┐
│ 宿主侧（后端）lib/index.js + lib/*-pre.js                   │
│  · 端点路由（39 个）                                         │
│  · 工具（10 个，供模型调用）                                  │
│  · 存储：记忆文件、M8 三层 JSON、evidence 事件 JSONL          │
│  · 检索：C1 词法 / C2 语义 / C3 Python 语义                  │
│  · 决策：主动联想门控、接续调度、水位监测                      │
└───────────────┬───────────────────────────────────────────┘
                │ 读写
┌───────────────▼───────────────────────────────────────────┐
│ 磁盘 C:\Users\JH Z\.dsh\memory\                             │
│  · workspaces\<工作区>\*.md       记忆日志/笔记/白板/账本     │
│  · hub-pre\episodes|facts|procedures.json   M8 三层          │
│  · evidence-pre\events\YYYY-MM-DD.jsonl     证据事件（按日）  │
│  · dsh-auto-memory-pre-diagnose.log         诊断日志         │
└────────────────────────────────────────────────────────────┘
```

**数据流向（一次典型记忆检索）**：

1. 模型调用工具 `memory_recall_pre`（或前端点选）→ 宿主侧 `recall()`
2. `recall()` 构建 L0 语料（从日志/反思/笔记抽取摘要）
3. 词法臂（C1）打 L0、语义臂（C2）打 L0；若查询含时间表达，追加时间臂
4. 三臂经 `rankFusionRRFPre`（rank-space，k=60）融合排序
5. 默认只返回 L0 列表（含 `id`/`score`/`match_reason`）；需要原文时用 `expand="mem_xxx"` 按锚点 ID 展开
6. 结果返回模型 / 前端渲染

**职责边界要点**：

- 前端**不持有**任何记忆数据，所有读写都经后端端点
- 后端**不直接操作 DOM**；UI 相关只提供数据与状态
- 模型侧（工具调用）与前端侧（UI）是**两条独立入口**，最终都落到同一批宿主侧函数

---

## 4. 前端可操作入口

> 前端 DOM 钩子（在 `lib/client.js` 中定义，可用于定位/断言）：
> `data-dam-panel`（记忆窗格）、`data-dam-sidebar-btn`（侧栏按钮）、`data-dam-settings`（设置容器）、`data-dam-settings-group`（设置分组）、`data-dam-settings-nav`（设置导航）、`data-dam-settings-row`（配置行）、`data-dam-detect-panel`（语义引擎检测面板）、`hub`（记忆中枢页签）

### 4.1 记忆窗格（侧栏面板）

- **打开**：启动 dsh web（`--no-open`）后手动打开 UI → 侧栏记忆按钮（`data-dam-sidebar-btn`）
- **内容**：当前工作区记忆、日志、记忆中枢页签、语义引擎状态
- **可观察**：记忆条目、版本号、水位显示、语义引擎档位（C1/C2/C3）

### 4.2 记忆中枢页签（`hub`）

- **位置**：记忆窗格内的「记忆中枢」页签
- **内容**：技能（procedure）／事实（fact）／经历（episodic）三栏
- **预期**：有内容时显示条目；无内容显示正确空态；数据来自 `hub-pre\*.json`

### 4.3 设置分组（`data-dam-settings-group`）

在设置页中本插件有独立分组（文案含"记忆中枢""设置"）。可修改的关键配置项（默认值取自 `lib/index.js`）：

| 配置项 | 默认 | 修改后预期表现 |
|---|---|---|
| `memoryHubEnabled` | **true** | 关闭 → 记忆中枢三栏不再更新、相关端点返回未启用；开启 → episodes/facts/procedures 开始落盘 |
| `associativeMemoryEnabled` | false | 开启 → 会话中可能出现主动联想注入 |
| `shadowRetrievalEnabled` | false | 开启 → 影子检索与调试视图可用 |
| `activationInboxEnabled` | false | 开启 → 激活收件箱相关端点有数据 |
| `waterLevelThreshold` | **0.75** | 调低 → 更早提示水位；调高 → 更晚（**不要超过 0.80**，官方压缩阈值，必须留余量） |
| `autoContinueEnabled` | true | 关闭 → 水位达 0.75 不自动接续 |
| `autoContinueThreshold` | **0.75** | 同上，须与水位阈值保持同步、低于 0.80 |
| `handoffLedgerChars` | 800 | 快照注入的账本字符预算（与接续材料里的 8000 不同源，勿混淆） |
| `autoConsolidateCooldownMinutes` | 30 | 自动巩固/冷却间隔（分钟） |
| `semanticEngineMode` | `'auto'` | 切换 C1/C2/C3 的选择策略 |
| `pythonBackendEnabled` | false | 开启并配置好 Python → 可用 C3（bge-m3） |
| `procedurePromotionEnabled` | false | 开启 → 技能晋升可用 |
| `unattendedMode` / `awayMinutes` | false / 60 | 无人值守相关（**设置页 UI 尚未核实，属待办**） |

> ⚠️ 修改设置后需要**重载/重启 dsh web**才生效的场景，以实际观察为准；若改完无变化，先查 `/api/dsh-auto-memory-pre/config` 是否已回写。

### 4.4 语义引擎环境检测面板（`data-dam-detect-panel`）

- 用途：快检 / 深扫 / 热接入语义引擎环境
- 可观察：当前档位（C1/C2/C3）、模型是否存在、是否可热切换

### 4.5 悬浮钉

- 快捷入口（线描图标），用于快速打开记忆相关操作

---

## 5. 后端状态来源（如何确认前端操作已生效）

### 5.1 主要端点（`lib/index.js` 注册，共 39 个，前缀 `/api/dsh-auto-memory-pre/`）

| 端点 | 用途 | 关键返回字段 |
|---|---|---|
| `memory-hub` | M8 三层总览 | `policyVersion`、`stats`、`episodic`、`facts`、`procedures` |
| `config` | 读写配置 | 各配置键的当前值 |
| `state` | 运行状态总览 | 水位、启用状态等 |
| `debug` | 调试视图 | 含 `shadowRetrieval` 等 |
| `semantic-status` / `semantic-emit` / `semantic-download` | 语义引擎状态/发射/下载 | 档位、模型状态 |
| `activation-inbox-pre` | 激活收件箱 | 候选与投递记录 |
| `auto-continue-state` / `auto-continue-decide` / `handoff-continue` | 接续状态与决策 | 水位、是否触发、材料层 |
| `smart-recall` | 智能检索 | 命中列表 |
| `storage-manage` | 存储管理 | 文件/统计 |
| `workspaces` | 工作区列表 | 工作区标识 |
| `update` / `update-check` | 更新 | 版本信息 |
| `calendar`、`file`、`browse-dir`、`external*`、`summarize`、`shadow-recent`、`subagent-gc`、`greet` | 其余辅助端点 | — |

> 端点名以代码为准：`grep -oE "'/api/dsh-auto-memory-pre/[a-z0-9-]+'" lib/index.js | sort -u`

### 5.2 日志

- **诊断日志**：`C:\Users\JH Z\.dsh\memory\dsh-auto-memory-pre-diagnose.log`
  - 关键线索：插件加载异常、`diag(...)` 输出的降级与状态（如 `hub success evidence: +N`、`p9a correction attribution: ...`）
- **证据事件**：`C:\Users\JH Z\.dsh\memory\evidence-pre\events\YYYY-MM-DD.jsonl`
  - 单行结构（实测）：顶层 `kind` / `memoryId` / `recordedAt` / `anchorId` …，**时间戳在 `event.ts`**（顶层无 `ts`/`createdAt`）
- **M8 数据**：`C:\Users\JH Z\.dsh\memory\hub-pre\{episodes,facts,procedures}.json`（原子写）

### 5.3 「前端操作 → 后端确认」判定方法（通用三步）

1. **操作前**取基线快照：`GET /api/dsh-auto-memory-pre/config`（或 `state`）+ 记录相关文件条目数/修改时间
2. **在前端执行操作**（改开关、点按钮）
3. **操作后再取**：对比配置值是否变化、端点返回是否变化、磁盘文件 mtime/条数是否变化

**判定成立的条件**：三者至少两项一致变化。只有 UI 变了而后端/磁盘没变 = 未真正生效（可能未保存或未重启）。

**示例（改 `memoryHubEnabled`）**：

```
改前：GET /config → memoryHubEnabled=false；hub-pre\*.json 无新写入
前端：开启「记忆中枢」开关
改后：GET /config → memoryHubEnabled=true；对话若干轮后 hub-pre\*.json mtime 更新、条目增加
```

---

## 6. 工具（模型可调用，10 个）

| 工具 | 作用 |
|---|---|
| `memory_recall_pre` | 记忆检索（默认返回 L0，`expand` 展开原文） |
| `memory_read_pre` | 按锚点读取记忆原文 |
| `memory_note_pre` | 写入记忆（含 `kind` 区分日志/笔记/白板 `plan`/账本 `handoff` 等） |
| `memory_log_pre` | 记录日志条目 |
| `memory_reflect_pre` | 生成反思 |
| `memory_consolidate_pre` | 记忆巩固 |
| `memory_maintain_pre` | 存储维护 |
| `memory_status_pre` | 状态查询 |
| `memory_user_pre` | 用户级记忆读写 |
| `memory_external_pre` | 外部记忆源管理 |

---

## 7. 全量验证清单

> **通用前置**：`dsh web --no-open` 已启动；插件已装载；已确认端口并手动打开 UI。
> **通用通过标准**：每一步都要有**证据**（截图 / 日志原文 / 数据快照）。禁止"看起来正常"这类无证据结论。

### A. 启动与装载

| # | 前置 | 步骤 | 通过标准 |
|---|---|---|---|
| A1 | — | `dsh web --no-open` | 终端打印监听地址；**没有自动弹出浏览器** |
| A2 | A1 | 查看诊断日志与终端输出 | 无 `SyntaxError` / `ReferenceError` / 模块加载失败 |
| A3 | A2 | `GET /api/dsh-auto-memory-pre/state` | 返回 200 且含状态字段 |

### B. 记忆检索主流程

| # | 步骤 | 通过标准 |
|---|---|---|
| B1 | 调用 `memory_recall_pre` 查一个常见主题 | 返回 L0 列表，含 `id`/`score`/`match_reason` |
| B2 | 用返回的 `id` 调 `expand="mem_xxx"`（或 `memory_read_pre`） | 能取到对应原文，且**不串条** |
| B3 | **语义验证**：查一个词法不重合但语义相关的查询（如记忆里写"npm 发布报 ENEEDAUTH"，查"发布凭证问题"） | 能召回。若失败，切 `legacy` 融合再测对比；legacy 正常而 rrf 失败 = **P8 回归，停止** |
| B4 | **时间臂验证**：查含时间表达的查询（如"上周"），再查一条不含时间词的同类查询做对照 | 含时间词 → 对应时间段条目排序上升；不含时间词 → 排序与对照一致（**零行为变更**） |
| B5 | 异常：查一个明显不存在的主题 | 不报错，返回空或弱命中，不阻塞 |

### C. 主动联想

| # | 步骤 | 通过标准 |
|---|---|---|
| C1 | 确认 `associativeMemoryEnabled=true` 并重载 | 配置端点回写为 true |
| C2 | 新开会话，聊一段与已有记忆主题相关的话（不主动查询） | 记忆被主动注入；诊断日志有对应记录 |

### D. M8 记忆中枢

| # | 步骤 | 通过标准 |
|---|---|---|
| D1 | `GET /api/dsh-auto-memory-pre/memory-hub` | 200，含 `policyVersion`/`stats`/三栏数据 |
| D2 | 打开记忆窗格 → 记忆中枢页签 | 三栏有内容或正确空态 |
| D3 | 关闭 `memoryHubEnabled` → 重载 → 对话若干轮 | 无新落盘；端点反映未启用 |
| D4 | 重新开启 → 对话若干轮 | `hub-pre\*.json` 有新条目 |

### E. 证据链

| # | 步骤 | 通过标准 |
|---|---|---|
| E1 | 对话若干轮后查看当日 `evidence-pre\events\*.jsonl` | 新增 `seen` 事件 |
| E2 | 触发一次用户纠正（对话里说"不对，你记错了"之类） | 新增 `kind:"correction"` 事件（且归因到最近被 cite/read 的记忆） |
| E3 | 异常：events 目录缺失/损坏 | 检索不报错（fail-soft），重要性取中性 |

### F. 接续（handoff）

| # | 步骤 | 通过标准 |
|---|---|---|
| F1 | 确认 `waterLevelThreshold` / `autoContinueThreshold` = 0.75 | 配置端点一致 |
| F2 | 让上下文增长到 75%（或手动一键接续） | 触发接续；新会话收到**分层**材料 |
| F3 | 检查新会话首条注入文案 | **不再要求"先 read 转写"**；按锚点按需取用 |
| F4 | 接续后继续对话 | 能连续推进，进度未丢失 |

### G. 写入与持久化

| # | 步骤 | 通过标准 |
|---|---|---|
| G1 | 对话若干轮 | 工作区日志 `*.md` 有新条目；`hub-pre\*.json` 更新 |
| G2 | **重启 dsh web**（带 `--no-open`） | 数据 restore 不丢 |
| G3 | 异常：磁盘不可写 | 不崩溃，日志有记录 |

### H. 语义引擎档位

| # | 步骤 | 通过标准 |
|---|---|---|
| H1 | 打开检测面板（`data-dam-detect-panel`） | 显示当前档位与模型状态 |
| H2 | 切换 `semanticEngineMode` / 启用 Python 后端 | 状态端点反映档位变化；检索仍可用（失败则回退 C1） |

### I. 回归基线（静态，每次改动后必跑）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory
node tests/smoke/smoke-test-m4-pre.mjs                          # m4
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs               # 14
node tests/smoke/smoke-test-p4-l0-response-pre.mjs              # 34
node tests/smoke/smoke-test-evidence-agg-pre.mjs                # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs           # 18
node tests/smoke/smoke-test-p9a-correction-attribution-pre.mjs  # 26
node tests/smoke/smoke-test-p9d-recent-evidence-ts-pre.mjs      # 13
node tests/smoke/smoke-test-handoff-pre.mjs                     # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs              # 58
```

**任一数字下降 → 停止，回报**。

---

## 8. 常见故障与处置

| 现象 | 排查 |
|---|---|
| 启动后 UI 空白/无插件入口 | 检查插件是否装载到 web profile；看诊断日志加载错误 |
| 改了设置没效果 | 查 `/config` 是否回写；确认是否需要重载 |
| recall 返回空 | 确认记忆目录有内容；确认 `semanticEngineMode` 与引擎可用；看日志降级记录 |
| 证据不落盘 | 检查 `evidence-pre\events` 目录权限；确认相关开关 |
| 接续不触发 | 确认水位确实到 0.75；`autoContinueEnabled` 为 true |
| 检索很慢 | 当前词法检索为全量扫描（无倒排索引，属已知待办） |

---

## 9. 边界与禁止事项

- 改源码只改 `lib/*-pre.js`；**禁止手改 `lib/*.js` 同名产物**（由流水线重建）
- **禁止引入运行时依赖**（项目承诺零依赖）
- 禁止删除既有测试断言；禁止整文件重写
- 涉及用户隐私：日志与诊断输出**不得包含用户原文**
- 若作为验收方：**只验证不改码**，发现问题记录回报

---

## 10. 速查表

| 项 | 值 |
|---|---|
| 启动命令 | `dsh web --no-open`（**必须带**） |
| 工程根 | `D:\dsh-auto-memory` |
| 宿主侧入口 | `lib/index.js` |
| 浏览器侧入口 | `lib/client.js` |
| 端点前缀 | `/api/dsh-auto-memory-pre/`（39 个） |
| 工具 | 10 个，`memory_*_pre` |
| 记忆根 | `C:\Users\JH Z\.dsh\memory` |
| 证据事件 | `...\evidence-pre\events\YYYY-MM-DD.jsonl`（时间戳在 `event.ts`） |
| 诊断日志 | `...\dsh-auto-memory-pre-diagnose.log` |
| M8 数据 | `...\hub-pre\{episodes,facts,procedures}.json` |
| 水位/接续阈值 | 0.75 / 0.75（**须低于官方压缩 0.80**） |
