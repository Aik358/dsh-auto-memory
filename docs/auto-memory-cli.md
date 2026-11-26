# Auto Memory 命令行和终端工作台

`dam` 随 `@a9i5k4/dsh-auto-memory` 同包安装。它连接已经加载插件的 DeepSeek Harness 实例，读取该实例的记忆、白板、设置与任务。宿主重载插件后，`dam doctor` 会显示重新加载的构建指纹和实例 ID。

## 安装候选包

Windows PowerShell

```powershell
npm install --global --prefix "$env:TEMP/dam-cli-install" --omit=optional .\a9i5k4-dsh-auto-memory-3.4.4.tgz
$env:Path = "$env:TEMP/dam-cli-install;" + $env:Path
dam.cmd --version --json
dam.cmd --help
```

Bash

```bash
prefix="$(mktemp -d)"
npm install --global --prefix "$prefix" --omit=optional ./a9i5k4-dsh-auto-memory-3.4.4.tgz
export PATH="$prefix/bin:$PATH"
dam --version --json
dam --help
```

先在目标 DSH profile 中安装同一候选包并按宿主流程启动。以上命令把客户端入口装入独立的 PATH 前缀。配置、模型资产和记忆继续由宿主的插件管理。

## 连接和选择范围

在交互式终端直接运行 `dam`，连接成功后会打开工作区选择器，列出实例已登记的工作区和会话。用方向键和 Enter 选择浏览目标，随时可按 `w` 切换。传入 `--workspace`、`--workspace-ref` 或 `--session` 可直接打开指定范围。

PowerShell 中也可以把下面的函数加入当前用户的 profile，用 `auto memory` 启动。示例使用 PATH 上的 `dam.cmd`。

```powershell
function auto {
    param([string] $Product)
    if ($Product -ne 'memory') { throw 'Usage: auto memory [dam arguments]' }
    & dam.cmd @args
}
```

```text
dam doctor --json
dam api call system.workspaces --json
dam --profile desktop --workspace-ref WORKSPACE_ID status --watch
dam --profile desktop --workspace-ref WORKSPACE_ID
```

运行实例同账号发现使用 DSH_HOME、profile 和实例 ID 筛选。两份 profile 同时运行时，可从错误输出选出实例 ID 后传给 `--instance`。隔离 profile 用 `--dsh-home` 指向对应目录。

无目标时可查看实例状态和设置。用 `--workspace` 或 `--workspace-ref` 浏览已登记的工作区，刚建好且还没有对话的工作区也可以选。显式工作区优先于进程继承的 `DSH_SESSION_ID`。查看投递回执、启动蒸馏等会话操作时，用 `--session` 指定目标。项目笔记追加用工作区地址、现行笔记路径及显式确认，可在没有对话的项目中完成。浏览器可以独立切换项目或对话。

显式连接支持通过进程环境变量 `DSH_CONNECT_URL` 提供同机 DSH 官方启动 URL。客户端经 `/connect` 换取 owner Peer 的 API Cookie。凭据应留在短命的 shell 环境中。已知 loopback 地址也可传给 `--url` 检查旧插件、插件缺失或授权问题。

## 查找数据和操作

```text
dam api list --session SESSION_ID --json
dam api describe memory.recall --workspace-ref WORKSPACE_ID --json
dam memory list --workspace-ref WORKSPACE_ID --json
dam board events --workspace-ref WORKSPACE_ID --input-file filters.json --json
dam board event --workspace-ref WORKSPACE_ID --input-file event.json --json
```

`api describe` 提供输入、结果、范围、审批和执行来源。工作区级项目操作以 `--workspace` 或 `--workspace-ref` 确定目标，会话级操作再用 `--session` 明确来源对话。项目笔记追加提供 `expectedNotesPath` 并确认写入。需要现行修订、路径或预览令牌的操作应先运行其对应的读取命令。将参数保存为 UTF-8 JSON 文件可在 Bash 和 PowerShell 使用同一份参数。

Bash

```bash
printf '%s\n' '{"query":"release checklist","scope":"current"}' |
  dam memory recall --session "$dam_session" --input-file - --json
```

PowerShell

```powershell
'{"query":"release checklist","scope":"current"}' |
  dam.cmd memory recall --session $damSession --input-file - --json
```

确认写入前核对操作、范围和参数。保存设置的请求带 `settings.get` 返回的 `revision`。笔记追加的请求带项目 `expectedNotesPath`。发起后台维护后用返回的 job ID 查询状态和结果。

```text
dam memory note --session SESSION_ID --workspace WORKSPACE --yes --request-id IDENTIFIER --input-file note.json --json
dam api receipt IDENTIFIER --session SESSION_ID --workspace WORKSPACE --instance INSTANCE_ID --json
dam jobs get --session SESSION_ID --input-file job.json --json
```

收到超时、断线或中断时先查询写入回执。用同一实例、目标、参数和请求 ID 重试可取回同一结果。宿主重载后在 WebUI 或读取命令核对业务状态。终端命令退出后，已受理的插件任务仍可在原实例查询。

## 键盘和自动化

双页用 `1`、`2` 切换，方向键导航，Enter 打开，Esc 返回。用 `/` 查找，`w` 更换浏览工作区，也可选择具体会话。用 `r` 刷新所选目标，`?` 查看帮助。窄屏在列表和详情之间切换，宽屏同时显示两栏。长正文使用方向键或 Page Up 和 Page Down 阅读。白板事件流使用 `n`、`p` 翻页。泳道和工作流使用所选范围的快照。

工作区列表以绿点和「处理中」标记活跃的宿主回合、记忆检索和已受理任务。无色终端保留同样的文字。切换工作区期间，已经提交的检索和写入继续使用提交时的目标。在原工作区可打开「最近一次检索」，用 `/` 查找上次写入的回执。

`--json` 在 stdout 输出 JSON，`status --watch` 在修订变更时输出一行。诊断写到 stderr。退出码 2 对应参数问题，3 对应权限或确认，4 对应缺项或实例未启动，5 对应冲突，6 对应连接和服务故障。Ctrl+C 对应 130。退出后可再查询中断请求的回执。

## Codex 和 ZCode

`--harness` 支持 `codex`、`zcode`、`claude`、`kimi`、`cloud-code`、`opencode` 和 `antigravity`。使用 `--binding PATH` 或 `DAM_HARNESS_BINDING` 指定绑定文件。宿主模型工具的读取范围由绑定与运行中的 DSH 插件共同检查。OpenCode 已验证只读 MCP、单次批准与拒绝、新建与恢复会话，以及手动和自动压缩后注入。Antigravity 的真实模型会话待验。参见 [宿主适配与验收](internal/auto-memory-external-hosts.md)。
