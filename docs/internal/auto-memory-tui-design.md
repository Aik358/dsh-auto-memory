# Auto Memory 终端设计与验证

2026-11-26 · `feat/auto-memory-cli` · Windows ConPTY

## 设计来源

| 参考 | 产品核对与采用内容 | 来源 |
| --- | --- | --- |
| Codex CLI | 本机 `codex-cli 0.171.0`，Apache-2.0。采用 `/` 发现命令和输入时筛选的交互。 | [Codex CLI](https://github.com/openai/codex) · [许可证](https://github.com/openai/codex/blob/main/LICENSE) |
| Cloud Code CLI | Google Cloud Code 官方文档描述的是 IDE 集成。将任务书中的终端参考候选核对为本机 `Claude Code 2.1.152`，以其公开的交互指南核对键盘帮助、命令提示和取消。 | [Google Cloud Code](https://cloud.google.com/code/docs) · [Claude Code 交互指南](https://code.claude.com/docs/en/interactive-mode) · [Claude Code 许可条款](https://code.claude.com/docs/en/legal-and-compliance) |
| CoCC | GitHub 搜索 `CoCC "Claude Code"` 未找到可确认的同名终端项目。产品、版本和许可证待确认。 | [GitHub 仓库搜索](https://github.com/search?q=CoCC+%22Claude+Code%22&type=repositories) |
| switch | 本机 `D:/CCswitch` 可见 CC Switch 3.15.0 便携包。按 MIT 仓库核对为多宿主管理桌面应用，参考切换时保持当前宿主身份可见。 | [CC Switch](https://github.com/farion1231/cc-switch) · [许可证](https://github.com/farion1231/cc-switch/blob/main/LICENSE) |
| dsh-tui | 公开仓库存在多个独立实现，核对了 `ccch1mneyyy/dsh-TUI` 与 `tomowang/dsh-tui` 的 MIT 文档。采用窄屏保留必要反馈、显示当前工作区和上下文帮助的做法。 | [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) · [tomowang/dsh-tui](https://github.com/tomowang/dsh-tui) |

列表、命令搜索、确认和正文翻页均即时更新。实现使用 Node 自带的按键解码、字素分段和终端能力探测，横向调整按终端单元格计算。页面切换保留各自的阅读位置，窄屏按 `Tab` 切换列表和正文。终端使用当前主题的前景和背景，焦点同时以 `>`、方括号和文字标记。

## 交互和调用

| 入口 | 路径 |
| --- | --- |
| 记忆总览 | `1` → `状态与连接`。可读工作区、会话、引擎、索引状态、实际投递、后台任务、实例和契约。首页按需读三条最近事件。 |
| 读取和修改 | `/` 输入标题、分组或操作 ID。`Enter` 选择，JSON 参数编辑区支持嵌套结构、枚举和长正文。`Tab` 看完整参数 schema。`Ctrl+A` 全选，`Ctrl+S` 提交。读取返回数据可完整翻阅。 |
| 检索和来源 | `/` → `memory.recall` → 参数提交。结果页可阅完整命中或进入已授权回读。`/` → `memory.source` 也可直接传入来源定位。 |
| 白板看板 | `2` → 第一项进入事件列表。`v` 在事件流、当前结果的状态分组和工作流分组之间切换。`n/p` 使用服务声明和返回游标翻页，`e` 修改筛选参数。`Enter` 获取事件详情，`c` 选择检查点，`s` 回读检查点的来源文件。独立泳道入口钻取到卡片，正文由 `board.card` 读取。 |
| 范围与审批 | `w` 选择后端返回的工作区和会话，或填写两项。发现与状态请求验证新目标，成功后清理旧作用域快照。写时显示操作、目标和原参数，经 `y` 后提交 `approved` 与请求编号。`/` → `receipt request` 在支持 `client.receipt` 的客户端回读宿主回执。 |
| 状态与取消 | 常驻循环只请求轻量 `status`。连接中断可保留旧快照，同实例恢复时重新发现。`r` 重新发现并按需回读当前只读视图。`Esc` 取消前台等待，已有后端任务继续经正式任务操作管理。 |
| 长正文 | `↑/↓`、`PgUp/PgDn`、`Home/End`。Markdown 标题层级、代码围栏、原始换行和完整长路径可读。清除不可信 CSI、OSC、控制字符串及定向格式字符。 |

`NO_COLOR=1` 禁用样式。`DAM_TUI_ALT_SCREEN=0` 使用当前缓冲。`DAM_TUI_ASCII=1` 使用 ASCII 分隔符，中文和其他正文仍按 UTF-8 输出。`TERM=dumb` 按帧输出纯文本。TUI 模块在非 TTY 输入或输出时返回 `2`，CLI 的非交互入口由 CLI 提供。

## Windows 复跑

在仓库根目录安装隔离的截图装置依赖。正式 TUI 运行使用 Node 内置模块。

```powershell
$damTuiPtyDeps = Join-Path $env:TEMP 'dam-tui-pty-deps'
python -m pip install --target $damTuiPtyDeps pywinpty==3.1.2 pyte==0.8.2 pillow==12.3.0
$env:PYTHONPATH = $damTuiPtyDeps
python -B tests/live/auto-memory-tui-pty.py
```

隔离 Desktop 基线要求安装的 `DeepSeek Harness.exe` 和解包后的 v3.4.6 对照包路径。脚本沿用 Desktop 基线测试启动和清理临时 profile，在主工作区种子写入后驱动真实 CLI。

```powershell
node tests/live/auto-memory-tui-desktop.mjs $damDesktopExe $damV346PackageDir
```

用 `DAM_TUI_INSTALLED_ENTRY` 指向隔离 npm 安装下的 `node_modules/@a9i5k4/dsh-auto-memory/lib/terminal/cli.js`，可让 Desktop 加载同一份安装包并从其 `dam` 的 Node 入口运行按键测试。用 `DAM_SESSION_QUERY_BUILD_DIR` 指向包含编译产物的宿主修复工作树根目录，可在隔离 Electron 进程中加载编译的会话查询模块和 SQLite 实现。

```powershell
$env:DAM_TUI_INSTALLED_ENTRY = Join-Path $damIsolatedNpmInstall 'node_modules/@a9i5k4/dsh-auto-memory/lib/terminal/cli.js'
$env:DAM_SESSION_QUERY_BUILD_DIR = 'D:/dsh-committed-session-query-20261126'
node tests/live/auto-memory-tui-desktop.mjs $damDesktopExe $damV346PackageDir
```

也可连接仍在运行的已播种隔离 profile。保持与该实例相同的账户发现目录，分别填写 profile 根目录、已验证会话和工作区。

```powershell
python -B tests/live/auto-memory-tui-pty.py --expect 'Baseline checkpoint 端到端' --checkpoint 'Checkpoint checked the source note' --recall 'tungstenwren' -- node lib/terminal/cli.js --dsh-home $damIsolatedHome --profile desktop --session $damSession --workspace $damWorkspace
```

### 实测画面

PNG 是真实 Windows ConPTY 输出在终端模拟器中的逐单元格截图。画面使用合成事件或隔离 Desktop profile 的种子数据。

- 装置 120×29 使用真彩能力，覆盖两页、240 条事件、游标翻页、页内分组和长正文。[记忆](../../tests/live/auto-memory-tui-pty/wide-memory-dark.png) · [白板](../../tests/live/auto-memory-tui-pty/wide-board-dark.png)
- 装置 53×24 使用亮色背景、无色、ASCII 分隔符和主缓冲。路径覆盖中文、emoji、超长 Windows 路径、恶意控制字符串过滤和最终段落。[正文](../../tests/live/auto-memory-tui-pty/narrow-detail-light-no-color.png) · [正文末尾](../../tests/live/auto-memory-tui-pty/narrow-body-end-light-no-color.png) · [搜索](../../tests/live/auto-memory-tui-pty/narrow-search-light-no-color.png)
- 同一装置用 79×24 核对 16 色焦点。回归路径还验证了嵌套契约、写入确认和查询回执、权限拒绝、不可用操作、断开恢复、取消和切换后的空态。
- 隔离真实 Desktop 使用 `0.2.2-rc.5` 和宿主修复 `3e2e895e65ed3644c26c3eb3051eb5ae5b9935d2` 的编译模块，运行时报告 `committedSearchVersion: 1`。实测候选来自 `npm pack` 后的隔离 npm 安装，归档 SHA-256 为 `fa4c423af810024a0fe1cbb905b0722ee9b41a86d31e073413f92b2df3589faf`。Windows `.bin/dam.cmd --version --json` 返回 `3.4.4`，ConPTY 从该 shim 指向的安装包入口启动。宿主在测试时公布 98 项操作。[真实记忆](../../tests/live/auto-memory-tui-pty/wide-desktop-memory.png) · [真实白板](../../tests/live/auto-memory-tui-pty/wide-desktop-board.png)
- `2` → `Enter` → `Enter` → `c` → `Enter` → `s` 回读同一隔离事件的检查点四段、引文、行号、文件指纹和原文。实机测试尺寸为 120×29 及 53×24。[宽屏检查点](../../tests/live/auto-memory-tui-pty/wide-desktop-checkpoint.png) · [窄屏检查点](../../tests/live/auto-memory-tui-pty/narrow-desktop-checkpoint-light-no-color.png) · [原文](../../tests/live/auto-memory-tui-pty/wide-desktop-source.png)
- 实测 `settings.get` → `settings.set` → 宿主回执 → 回读设置。TUI 轮询看到状态修订变化，随后恢复测试前的设置值。`w` 选择项目 B 后，该范围的白板为空，回读项目 A 的事件被宿主拒绝。[设置回执](../../tests/live/auto-memory-tui-pty/wide-desktop-settings-refresh.png) · [跨范围拒绝](../../tests/live/auto-memory-tui-pty/wide-desktop-scope-denied.png)
- 真实 Desktop 退出后，运行中的 TUI 保留最后的白板快照并提示重新选择实例。宿主重新启动后，基础回归确认新实例代次和持久化数据。[断开快照](../../tests/live/auto-memory-tui-pty/wide-desktop-disconnected.png)
