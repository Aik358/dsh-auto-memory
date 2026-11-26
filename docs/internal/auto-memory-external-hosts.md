# Auto Memory 的外部宿主适配

验收环境为 Windows、Codex CLI `0.171.0`、ZCode CLI `0.18.0`、ZCode Desktop 文件版本 `4.0.0.10870`、Claude Code `2.1.152`、Kimi Code `2.8.0`、Cloud Teahouse Cloud Code `0.2.0`、Antigravity CLI `1.5.18` 和 DSH Desktop `0.2.2-rc.5`。插件工作树起于 `f3b4fa2c48d5bfea072674f7c34899e13b2c9d94`。旧版 ZCode 原型用于核对 hooks、插件清单和 MCP 注册方式。 [Codex 0.171.0](https://github.com/openai/codex/releases/tag/rust-v0.171.0) · [ZCode 插件](https://zcode.z.ai/en/docs/plugin) · [本机 ZCode 原型验证](/D:/zcode-auto-memory/docs/INSTALL-AND-VERIFY.md)

## CLI 和绑定

`lib/harness/external-dsh-proxy.js` 导出 `connectExternalDsh({ harness, bindingFile, cwd, signal })`。它接收绝对路径的 JSON，校验宿主和当前目录，返回 `discover({signal,scope})`、`call(id,args,{signal,scope,instanceId})`、`handleHook(payload,{signal})`。适配器和发现结果都提供 `mode` 和 `boundHost: { harness, workspace }`。`identity.harness` 来自实际 DSH 插件，供实例校验使用。用户在绑定中固定 DSH 实例、profile、DSH 会话和授权工作区。host 的会话 ID 只作为生命周期事件字段传递。

```json
{
  "version": 1,
  "harness": "codex",
  "workspace": "D:/example/project",
  "dshSessionId": "operator-selected-dsh-session",
  "dsh": {
    "profile": "desktop",
    "instance": "operator-selected-dsh-plugin-instance-id"
  }
}
```

每个项目按宿主提供绑定文件。`harness` 可设为 `codex`、`zcode`、`claude`、`kimi`、`cloud-code`、`opencode` 或 `antigravity`。若 DSH 与外部宿主的项目目录不同，显式增加 `workspaceRef` 指向已获授权的 DSH 工作区。默认通过 DSH 的本机发现握手选择实例。绑定的 `dsh` 对象接受客户端支持的 `home`、`url`、`connectUrl` 和 `timeout`。使用含启动凭据的 `connectUrl` 时，绑定保存在操作者自己的私有目录。 [DSH 客户端](/D:/dam-cli-20261126/lib/terminal/client.js)

```powershell
dam --harness codex --binding D:/example/private/codex.json status --json
dam --harness zcode --binding D:/example/private/zcode.json api list --json
dam --harness claude --binding D:/example/private/claude.json doctor --json
```

`status`、`memory.list` 和 `memory.recall` 由 live manifest 和审批属性共同控制。检索固定使用 `scope=current`。MCP 用 `status`、`memory_list`、`memory_recall` 导出可用项。模型参数无法改绑定、写入、确认其他工作区或调用任何整理执行器。启动和提示提交的注入在当前工作区经 `external.lifecycle` 取得。桥接层只提交事件名、宿主、宿主会话及可用的来源、回合或压缩标记。去重由插件实例管理。MCP 和 hooks 共享绑定，记忆数据来自插件的现有存储。 [MCP stdio 传输](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

## 宿主注册

`lib/harness/external-entry.js` 随插件安装。在宿主工作区运行该入口，参数依次是宿主、`hook` 或 `mcp`、绑定文件绝对路径。

Codex 的受信配置中注册 MCP。下面的路径用实际安装路径替换。

```toml
[mcp_servers.auto_memory]
command = "node"
args = ["D:/package/lib/harness/external-entry.js", "codex", "mcp", "D:/example/private/codex.json"]
cwd = "D:/example/project"
```

在 Codex 的 `hooks.json` 中将相同命令注册到 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd`、`PreCompact` 和 `PostCompact`。每个事件使用相同配置，通过 stdin 的事件名分发。使用 Codex 的 hooks 信任界面审阅并信任配置。回放脚本用目标版本 `hooks/list` 核对命令和 hash，只写入临时 profile 的信任状态。 [Codex hooks 配置与 schema](https://github.com/openai/codex/tree/rust-v0.171.0/codex-rs/hooks) · [Codex hooks 信任实现](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/tui/src/hooks_rpc.rs) · [Codex MCP 配置](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/config/src/mcp_types.rs)

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"D:/package/lib/harness/external-entry.js\" codex hook \"D:/example/private/codex.json\"",
        "timeout": 5
      }]
    }]
  }
}
```

ZCode 使用插件清单 `.zcode-plugin/plugin.json` 的 `mcpServers` 声明，同级插件根目录下的 `hooks/hooks.json` 声明 `SessionStart`、`UserPromptSubmit` 和 `Stop`。hook 命令将示例中的 `codex` 替换为 `zcode`。交给 ZCode 插件安装、启用与权限机制。命令回放使用 `guarded` 模式，宿主仍处理工具调用许可。 [ZCode Hooks](https://zcode.z.ai/en/docs/hooks) · [ZCode MCP](https://zcode.z.ai/en/docs/mcp-services)

```json
{
  "name": "dam-external",
  "version": "1.0.0",
  "description": "Read the bound Auto Memory instance",
  "mcpServers": {
    "auto-memory": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/package/lib/harness/external-entry.js", "zcode", "mcp", "D:/example/private/zcode.json"],
      "cwd": "${ZCODE_PROJECT_DIR}"
    }
  }
}
```

配置读取或 DSH 握手失败时，hook 返回空对象，MCP 返回连接错误。宿主发生目录切换后需要该目录对应的绑定。外部宿主的蒸馏执行、写入、白板和记忆管理使用 DSH 模式。

Claude Code `2.1.152` 使用受信的 Claude 配置文件注册 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd` 和 `PreCompact`。hook 注册结构与上面的命令示例一致，参数改为 `claude hook` 和对应的绑定文件。会话恢复和手动压缩后的上下文分别从 `SessionStart` 的 `resume` 和 `compact` 来源进入。默认压缩配置使用 `PreCompact` 和 `SessionStart(source=compact)`。通过 Claude 的 `--mcp-config` 提供本机 stdio server。在运行目录中执行会话，使用 Claude 自己的工具审批。 [Claude Code Hooks](https://code.claude.com/docs/en/hooks) · [Claude Code MCP](https://code.claude.com/docs/en/mcp)

```json
{
  "mcpServers": {
    "auto_memory": {
      "type": "stdio",
      "command": "node",
      "args": ["D:/package/lib/harness/external-entry.js", "claude", "mcp", "D:/example/private/claude.json"]
    }
  }
}
```

## 可复跑的验收

```powershell
node --test tests/live/auto-memory-external-contract.mjs
$env:DAM_EXTERNAL_TEST_SCRATCH = 'D:/'
$env:DAM_EXTERNAL_DSH_DESKTOP = 'G:/dsh_desktop/DeepSeek Harness.exe'
$env:DAM_EXTERNAL_PLUGIN_DIR = 'D:/dam-cli-delivery-20261126/verified/workspace-final-v9/win/node_modules/@a9i5k4/dsh-auto-memory'
$damCodex = Get-ChildItem -LiteralPath 'C:/Users/JH Z/AppData/Roaming/npm/node_modules/@openai/codex' -Filter codex.exe -Recurse | Select-Object -First 1
$env:DAM_EXTERNAL_TEST_COMPACT = '1'
$env:DAM_EXTERNAL_TEST_CODEX_AUTO_COMPACT = '1'
node tests/live/auto-memory-external-host.mjs codex $damCodex.FullName
$env:DAM_EXTERNAL_TEST_ZCODE_RESUME = '1'
$env:DAM_EXTERNAL_TEST_ZCODE_COMPACT = '1'
node tests/live/auto-memory-external-host.mjs zcode D:/nodejs/node.exe E:/zcode/resources/glm/zcode.cjs
node tests/live/auto-memory-external-host.mjs claude (Get-Command claude.exe).Source
```

脚本启动真实 Desktop Host、真实 Cordis 插件加载和两个实际安装的外部 CLI。它通过官方浏览器和操作端登录链路，为本轮生成的 DSH 会话写一条合成项目笔记。回环模型端点记录本轮请求，验证笔记、MCP 工具名和插件结果到达模型输入。合成回执验证乱序拒绝、注入领取、回合去重与 Stop。临时宿主配置和凭据随脚本退出清理。Windows 下用 `D:/` 作为测试父目录，避开 ZCode 的文件监视器在用户临时路径遇到的 libuv 断言。

可通过 `DAM_EXTERNAL_PLUGIN_DIR` 指向已解包的候选。未设置该变量时，DSH 和外部命令使用工作树。2026-11-26，Codex 和 ZCode 的复跑均从修复后的工作树加载插件 `3.4.4`，两项测试进程均退出 0。初次联验的 `buildId` 为 `c2692325d2f63c95630534f27a7d271032bb6e441e11386f6dc021b9490b8e96`。Claude 接入期间，Codex 和 ZCode 分别从构建 `2c860f9f0e271b7bb11a680ac2095ec38922dddb05dfd0d8eac9d2aee3f084f6` 和 `11dae87d8e023c5c7e4a83587ee6d6db3c24326857dedd89d8d8cddce228ebf5` 再次通过。

| 项目 | Codex 0.171.0 | ZCode 0.18.0 |
| --- | --- | --- |
| 宿主调用 | 启动、恢复、提交、Stop、SessionEnd、手动 PreCompact 与 PostCompact | 启动、恢复、提交与 Stop，插件 manifest 校验通过，恢复退出 0 |
| 模型输入 | 6 次回环请求，启动和恢复取得同一绑定的项目笔记 | 5 次回环请求，启动取得项目笔记，恢复 hook 未重复投递 |
| MCP | 状态、列表与检索三项均读到真实插件结果 | 状态、列表与检索三项均读到真实插件结果 |
| CLI | 同一绑定状态查询退出 0，异目录拒绝退出 1 | 同一绑定状态查询退出 0，异目录拒绝退出 1 |
| 生命周期回执 | 乱序 → 受理启动 → 受理提示 → 重复 → 受理 Stop | 同一序列通过 |

两份 stdout 都报告 `sawProjectNotes: true`，三个 `toolResults` 均为 `true`，生命周期序列为 `UserPromptSubmit:out-of-order`、`SessionStart:accepted`、`UserPromptSubmit:accepted`、`UserPromptSubmit:duplicate`、`Stop:accepted`。服务端在当前工作树的读取回调使用 `Number.MAX_SAFE_INTEGER`。

安装构建 `7be1e8f8332c87fcee4ff95fdfbcea6123622780b7598e936bca3a89c1da8266` 通过 Codex 手动与自动 `PreCompact`、`PostCompact`，压缩后最终模型请求仍含项目记忆。ZCode 的 `/compact` 利用宿主实际发出的 `SessionStart(source=compact)` 交付项目记忆。后续恢复发送的模型请求含相同项目记忆，重复压缩回调返回 `duplicate`。证据为本机回环模型请求、真实 hooks 和工具协议。 [ZCode Hooks](https://zcode.z.ai/en/docs/hooks) · [Codex 压缩事件实现](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/hooks/src/events/compact.rs)

Claude Code `2.1.152` 通过正式 `external-entry.js` 和 `external-dsh-proxy.js` 连接真实 DSH Desktop。验证进程、绑定目录 CLI 和 `/compact` 分别退出 0，异目录 CLI 退出 1。在 5 次回环模型请求中验证了真实项目笔记和三项 MCP 回读。`SessionStart` 的 `startup`、`resume` 和 `compact` 各投递了项目笔记，提示提交和 Stop 本身只记录事件。手动 `PreCompact` 与后续 `SessionStart(compact)` 均获服务端 `accepted` 回执。该轮加载 `buildId` 为 `2c860f9f0e271b7bb11a680ac2095ec38922dddb05dfd0d8eac9d2aee3f084f6` 的插件。测试用 `dontAsk` 和显式工具授权运行 Claude，发现结果为 `mode: "claude"` 与 `identity.harness: "dsh"`。 [Claude Code Hooks](https://code.claude.com/docs/en/hooks)

## Antigravity

Google Antigravity CLI `1.5.18` 已在隔离目录下载，SHA-512 与官方 Windows x64 清单匹配。CLI 支持打包式插件、stdio MCP 和 hooks。插件包提供 `plugin.json`、`mcp_config.json` 和 `hooks.json`，当前 npm 候选构建会把外部桥接运行时一并放进插件目录。来源 [Antigravity 插件](https://antigravity.google/docs/build-plugins) · [Antigravity Hooks](https://antigravity.google/docs/hooks) · [Antigravity CLI](https://antigravity.google/docs/cli)

适配器只注册 `SessionStart`、`PreInvocation` 和 `Stop`。宿主以 `conversationId` 标识会话，以单元素 `workspacePaths` 声明项目。桥接器要求该路径与绑定工作区一致，只把规范化后的生命周期字段发送给 DSH，不传递 `lastUserInput` 或 `transcriptPath`。`PreInvocation` 保留为独立宿主事件，因为它在每次模型调用前运行，包含工具执行后的调用。DSH 的生命周期去重会话中的初始上下文，避免重复写入持久对话轨迹。需要注入时，hook 输出使用 `injectSteps` 中的 `systemMessage`。`Stop` 以 `decision: stop` 保留宿主默认结束行为。外部工具仍受宿主 MCP 信任配置控制，提供的工具仅为已授权实例的只读操作。

每个项目在 `.agents/auto-memory-antigravity.json` 保存绑定，示例结构沿用本页的通用绑定 JSON，只将 `harness` 改为 `antigravity`。插件的 MCP server 将工作目录绑定到所选项目，并读取该文件。hooks 从宿主的 `workspacePaths` 推导同一个文件。插件目录随 npm 包提供，可用下面的命令验结构。

```powershell
agy plugin validate --strict D:/path/to/npm-package/integrations/antigravity
agy plugin install D:/path/to/npm-package/integrations/antigravity
```

本轮用 `agy plugin validate --strict` 校验了 release staging 中的插件，并在隔离用户目录执行 plugin install。`agy plugin list --json` 识别 `auto-memory`，提示填入 `WORKSPACE_ROOT` 后启用。没有启动 Antigravity 模型会话。官方 hook 契约没有 session-end 或 compaction 事件，因此这两类生命周期尚不支持。真实应用会话、MCP 工具调用及 Gemini 模型请求仍待实际宿主验收。

已安装候选插件 bridge 另用真实 DSH Desktop 和隔离项目执行 hook、MCP 初始化、三只读工具列表、项目召回和错工作区拒绝。该路径不启动 Gemini 请求。复跑命令如下。

```powershell
$env:DAM_EXTERNAL_PLUGIN_DIR = 'D:/path/to/installed/node_modules/@a9i5k4/dsh-auto-memory'
$env:DAM_EXTERNAL_TEST_SCRATCH = 'D:/'
node tests/live/auto-memory-antigravity-plugin.mjs 'G:/dsh_desktop/DeepSeek Harness.exe' $env:DAM_EXTERNAL_PLUGIN_DIR
```

## 额外宿主

Kimi Code CLI 的官方文档提供 stdio MCP 安装和工具审批，生命周期与注入扩展点已通过真实宿主验证。Cloud Teahouse Cloud Code 已作为独立产品模式验证。维护者澄清任务书中的 `gcode` 指 ZCode，已有 ZCode `0.18.0` 实测。Antigravity 的官方 CLI 严格校验和隔离安装通过，实际 agent 会话仍待验。 [Kimi Code CLI MCP](https://moonshotai.github.io/kimi-cli/en/customization/mcp.html)

## OpenCode 1.19.6

OpenCode 在项目目录加载 `opencode.json`，本地 stdio MCP 默认从当前工作区启动。配置使用套件中的正式桥接入口与项目的独立 DSH 绑定文件。保留原有权限规则，按需为 `auto_memory_*` 配置 `ask`、`allow` 或 `deny`。 [OpenCode MCP](https://opencode.ai/docs/mcp-servers/) · [OpenCode 权限](https://opencode.ai/docs/permissions/) · [1.19.6 的本地 MCP 加载器](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/mcp/index.ts)

```json
{
  "plugin": [
    ["D:/package/lib/harness/opencode.js", { "bindingFile": "D:/private/opencode-binding.json" }]
  ],
  "mcp": {
    "auto_memory": {
      "type": "local",
      "command": [
        "node", "D:/package/lib/harness/external-entry.js",
        "opencode", "mcp", "D:/private/opencode-binding.json"
      ]
    }
  },
  "permission": { "auto_memory_*": "ask" }
}
```

绑定文件沿用通用 JSON，将 `harness` 设置为 `opencode`。从项目根运行 `dam --harness opencode --binding D:/private/opencode-binding.json status --json` 查看实例。项目配置的原生插件在 `chat.message` 观察用户回合，在模型请求前将项目上下文附加到系统消息，并观察会话空闲和压缩事件。Windows 正式 CLI 实测新会话和恢复会话收到 DSH 项目笔记，`mcp list` 显示连接且模型读到了 `auto_memory_memory_recall` 的结果。宿主设置 `deny` 后工具从模型请求消失，异目录启动桥接进程退出 1。 [1.19.6 的插件类型](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/plugin/src/index.ts)

安装版在 OpenCode 的真实本机服务进程上验证了 `ask`。工具等待宿主批准，`once` 交付真实 DSH 召回，`reject` 返回宿主拒绝且没有召回内容。手动压缩与 64,020 token 用量触发的自动压缩均保存摘要，DSH 实例收到压缩前后事件，两次压缩后的模型请求都继续接收项目上下文。测试以 OpenCode HTTP 权限接口答复，宿主 TUI 权限弹窗待验。 [1.19.6 SDK](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/sdk/js/src/v2/gen/sdk.gen.ts) · [1.19.6 压缩实现](https://github.com/anomalyco/opencode/blob/v1.19.6/packages/opencode/src/session/processor.ts)

```powershell
$env:DAM_EXTERNAL_TEST_SCRATCH = 'D:/'
$env:DAM_EXTERNAL_PLUGIN_DIR = 'D:/dam-cli-delivery-20261126/verified/compact-refresh/win/node_modules/@a9i5k4/dsh-auto-memory'
node tests/live/auto-memory-opencode.mjs (Get-Command opencode.exe).Source 'G:/dsh_desktop/DeepSeek Harness.exe'
```
