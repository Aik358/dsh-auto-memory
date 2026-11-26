# Auto Memory 接入 Kimi Code CLI

2026-11-26 核对了 npm 的 stable 版本。在隔离 Windows 环境安装 `@moonshot-ai/kimi-code@2.8.0`，实际 `kimi --version` 为 `2.8.0`，npm 包要求 Node.js `>=22.19.0`，验收使用 Node.js `24.18.0`。源码发布标签指向 `46d9085f37c1b145ccfc82a24387e26aa940e94f`。另用 uv 和 Python 3.14.6 安装 PyPI 的 `kimi-cli==1.52.0`，实际启动打印版本与停止维护提示。适配目标是 npm 版。  
来源: [MoonshotAI npm 包](https://www.npmjs.com/package/@moonshot-ai/kimi-code/v/2.8.0) · [2.8.0 源码](https://github.com/MoonshotAI/kimi-code/tree/46d9085f37c1b145ccfc82a24387e26aa940e94f) · [旧版 PyPI](https://pypi.org/project/kimi-cli/1.52.0/) · [迁移指南](https://moonshotai.github.io/kimi-code/en/guides/migration.html)

## 配置与作用域

使用 DSH 的显式绑定文件，指定 `version: 1`、`harness: "kimi"`、本机工作区绝对路径 `workspace`、已授权的 `dshSessionId` 和 `dsh.profile` / `dsh.instance`。外部项目与 DSH 工作区路径不同时，通过 `workspaceRef` 明确指定授权的 DSH 工作区。绑定文件放在操作者的私有配置目录。使用同包的以下入口查询状态。

~~~powershell
dam --harness kimi --binding D:/private/kimi-binding.json status --json
~~~

在受信的用户配置 `$KIMI_CODE_HOME/config.toml` 或默认 `~/.kimi-code/config.toml` 注册 hook。以下段落按事件分别添加，事件清单见 Kimi 适配模块。自动注入与 MCP 项目配置是两个授权面。用户级 hook 会在项目的 MCP 未获信任时照常执行，绑定的目录校验仍生效。  
来源: [Kimi Hooks](https://moonshotai.github.io/kimi-code/en/customization/hooks.html) · [Kimi 环境变量](https://moonshotai.github.io/kimi-code/en/configuration/env-vars.html)

~~~toml
[[hooks]]
event = "UserPromptSubmit"
command = 'node "D:/package/lib/harness/external-entry.js" kimi hook "D:/private/kimi-binding.json"'
timeout = 7
~~~

在工作区 `.kimi-code/mcp.json` 配置本机 stdio；也可以由操作者在用户级的 `mcp.json` 注册。为保留项目范围检查，子进程工作目录使用宿主实际工作区。在项目级注册后，交由 Kimi 的工作区信任流程审核命令和参数。工具名为 `mcp__auto_memory__status`、`mcp__auto_memory__memory_list`、`mcp__auto_memory__memory_recall`。需要预先授权时可对具体工具名配置 `[[permission.rules]]`。审批规则匹配工具名，检索始终由共享适配层锁定在当前绑定范围。  
来源: [Kimi MCP 与工具权限](https://moonshotai.github.io/kimi-code/en/customization/mcp.html) · [Kimi 配置文件](https://moonshotai.github.io/kimi-code/en/configuration/config-files.html#permission)

~~~json
{
  "mcpServers": {
    "auto_memory": {
      "command": "node",
      "args": ["D:/package/lib/harness/external-entry.js", "kimi", "mcp", "D:/private/kimi-binding.json"],
      "enabledTools": ["status", "memory_list", "memory_recall"]
    }
  }
}
~~~

## 生命周期接线

`KIMI_HOOK_EVENTS` 注册 `SessionStart`、`UserPromptSubmit`、`Stop`、`SessionEnd`、`PreCompact`、`PostCompact`。共享适配器在校验 hook 字段前调用 `normalizeKimiHookInput`，Kimi 的非负数字 `turn_id` 转为共享契约的字符串 ID。实际 `Stop` 首轮为数字 `0`，恢复后下一轮为数字 `1`，而 `UserPromptSubmit` 的实测负载没有 `turn_id`。转发到 DSH 的是既有生命周期字段。  
来源: [2.8.0 事件实现](https://github.com/MoonshotAI/kimi-code/blob/46d9085f37c1b145ccfc82a24387e26aa940e94f/packages/agent-core-v2/src/features/externalHooks/agent/agentExternalHooksService.ts)

`SessionStart` 只观察，由服务端保留注入机会。Kimi 的有效注入点为 `UserPromptSubmit`，入口用 `formatKimiHookOutput` 输出 `{"message":"…"}`。Kimi 将其作为 `hook_result` 加入用户提示。其余事件保持空 stdout。没有找到 Kimi 直接在启动或压缩 hook 中向模型附加上下文的正式接口。  
来源: [2.8.0 hook 输出解析](https://github.com/MoonshotAI/kimi-code/blob/46d9085f37c1b145ccfc82a24387e26aa940e94f/packages/agent-core-v2/src/features/externalHooks/internal/runHook.ts) · [2.8.0 提示处理](https://github.com/MoonshotAI/kimi-code/blob/46d9085f37c1b145ccfc82a24387e26aa940e94f/packages/agent-core-v2/src/features/externalHooks/internal/userPrompt.ts)

## 复跑

在 Windows 本地工作树运行。可用 `DAM_EXTERNAL_PLUGIN_DIR` 指向已解包的同包候选，否则使用工作树。脚本新建临时 Kimi 配置、项目和 DSH profile，通过官方 CLI 与本机 Desktop Host 运行。模型端点为 `127.0.0.1`，模型响应为合成 fixtures。脚本输出 JSON 回执和真正加载的插件构建 ID。测试本身会清理临时 profile。

~~~powershell
$KimiInstall = Join-Path $env:TEMP ('dam-auto-memory-kimi-npm-' + [guid]::NewGuid().ToString('N'))
npm.cmd install --prefix $KimiInstall --no-audit --no-fund --registry=https://registry.npmjs.org @moonshot-ai/kimi-code@2.8.0
$KimiEntry = Join-Path $KimiInstall 'node_modules/@moonshot-ai/kimi-code/dist/main.mjs'
$env:DAM_KIMI_TEST_SCRATCH = 'D:/'
node tests/live/auto-memory-kimi-host.mjs $KimiEntry 'G:/dsh_desktop/DeepSeek Harness.exe'
node --test tests/live/auto-memory-external-contract.mjs
~~~

旧版复核命令如下。

~~~powershell
$KimiLegacy = Join-Path $env:TEMP ('dam-auto-memory-kimi-python-' + [guid]::NewGuid().ToString('N'))
uv venv --python 3.14 $KimiLegacy
uv pip install --python (Join-Path $KimiLegacy 'Scripts/python.exe') --index-url https://pypi.org/simple kimi-cli==1.52.0
& (Join-Path $KimiLegacy 'Scripts/kimi.exe') --version
~~~

## Windows 实测回执

当前工作树的 Kimi 实测退出 0。DSH Desktop `0.2.2-rc.5` 的隔离 Cordis profile 加载 Auto Memory `3.4.4`，构建 ID 为 `3de0029cd6eeffa0b1b190aea1133f2f18409f30ada6085b320ce3c3e9d29fd3`，使用该 Desktop 安装自带的会话查询实现。共享外部适配契约测试 4 项通过。  
[当前工作树 Kimi 回执](../../tests/live/auto-memory-kimi-windows-evidence.json)

此前将数字回合 ID 转换接入隔离候选，候选目录与 `npm pack` 后的独立安装均实测退出 0。该轮加载的构建 ID 为 `dd464e19086d2ae2846b11e6046267b3db87e5b4f292716e9af5bd6ad30813d9`。独立安装包为 `a9i5k4-dsh-auto-memory-3.4.4.tgz`，npm 完整性为 `sha512-+GrkJKHcFE7pB/6TjMP/aJbc9vBIMK4RJog7/mxM8UamIGMyZnvzgp6dRoc7LO6HVESXqjPxGHai0bcm5QflYw==`，bin 的帮助包含 `kimi`。

| 场景 | 实际证据 |
| --- | --- |
| 绑定 | 同目录 CLI 状态退出 0。异目录 CLI 退出 1，异目录 hook 空输出并诊断 `scope-forbidden`。 |
| 未信任的项目 MCP | Kimi 退出 0，模型收到 1 次请求和用户级 hook 投递的笔记。项目配置中的三个 MCP 工具未进入模型工具列表。 |
| 已信任项目 | Kimi 退出 0，模型收到 4 次请求。状态绑定了同一 DSH 会话，目录列表报告已绑定和非空笔记，检索返回含项目标记的匹配行。 |
| `-p` 恢复 | Kimi 退出 0，报告 `SessionStart(resume)`，模型从会话历史读到笔记，当前提交没有再次注入。本次 headless 进程退出没有触发 `SessionEnd`。 |
| 工具许可 | headless 下精确的 `deny` 规则返回拒绝。ACP 下 `ask` 触发官方 `session/request_permission` 和宿主的 PermissionRequest / PermissionResult hooks，选择 `reject_once` 后工具结果没有返回项目笔记。 |
| 手动压缩 | 官方 `kimi acp` 的 `session/prompt` 提交 `/compact`，捕获 `PreCompact(manual)` 和 `PostCompact(manual)`，下一次真实提示重新注入项目笔记。 |
| 显式关闭 | ACP `session/close` 触发 `SessionEnd(exit)`。再以 `session/load` 恢复同一 ID，出现 `SessionStart(resume)`，首次提交重新取得笔记。一次回放中，最后一轮 `Stop` 晚于 `SessionEnd` 到达。 |

主线共享适配器已调用 `normalizeKimiHookInput`，DSH 在 `SessionEnd` 和恢复时清理开放回合。真实 DSH 服务的定序回放收到 `SessionEnd → 迟到 Stop → SessionStart(resume) → UserPromptSubmit`，迟到 Stop 返回 `out-of-order`，恢复后的提示返回 `accepted` 并获得笔记。

目前的实测范围为 Windows 本机、只读三工具、项目笔记和六种生命周期钩子。自动压缩、远程会话、终端交互界面、生产鉴权及外部宿主的写入与任务执行暂无实测。

## Cloud Teahouse Cloud Code CLI

Cloud Teahouse 的 `cloud-teahouse/cloud-code` 是基于 Kimi Code CLI 的独立项目。用隔离 npm 安装 `@cloud-teahouse/cloudcode-cli@0.2.0`，`cloud-code --version` 返回 `0.2.0`，对应发布标签 `v0.2.0` 和源码提交 `5e3bfcb43fcaf040045cfb88fb9b380dc98b3d70`。验收使用 npm 启动器安装的官方 `cloudcode.exe`，SHA-256 为 `bddf87d02796407c0f7183d1710c70156472d1e9fa66eeda768b0127fd9bc464`。Google Cloud Code 的官方文档列出 IDE 集成。  
来源: [Cloud Teahouse 版本与源码](https://github.com/cloud-teahouse/cloud-code/releases/tag/v0.2.0) · [Cloud Teahouse npm](https://www.npmjs.com/package/@cloud-teahouse/cloudcode-cli/v/0.2.0) · [Google Cloud Code](https://cloud.google.com/code/docs)

同一个回放脚本以 `--cloud-teahouse` 启动独立二进制，隔离 profile 使用 `CLOUD_CODE_HOME`，项目 stdio 配置使用 `.cloud-code/mcp.json`。该轮借用 DSH 侧的 `kimi` 模式验证协议兼容性。DSH 读到绑定的会话状态、已绑定的目录与项目笔记检索命中，三个工具皆获真实结果。为检索设置具名 `deny` 规则后，模型收到拒绝。启动、恢复、拒绝场景的退出码均为 0，绑定目录与异目录检查结果分别为 0 和 1。  
[Cloud Teahouse Windows 回执](../../tests/live/auto-memory-kimi-cloud-teahouse-windows-evidence.json)

| 实测项目 | Cloud Teahouse 0.2.0 |
| --- | --- |
| Hooks | `SessionStart(startup/resume)`、`UserPromptSubmit`、`Stop`、`SessionEnd(exit)`。提示 hook 的 `message` 出现在模型请求的 `hook_result`。 |
| `Stop` 和退出 | 实测 `Stop` 没有 `turn_id`。`-p` 的每次退出均发出 `SessionEnd(exit)`，因此恢复时首条提示重新注入。 |
| 项目 MCP | `.cloud-code/mcp.json` 的 stdio 配置在干净 profile 中直接加载，未设置项目授信覆盖变量。0.2.0 的源码说明项目 stdio 可在会话启动时执行。 |
| 独立模式 | `cloud-code` 使用独立宿主标识、四个已验证钩子及三工具。当前安装包已验目标工作区调用成功、跨工作区 CLI 和钩子被拒绝、恢复后重新读到项目笔记，以及 `memory_recall` 拒绝策略。 |
| 尚待验收 | Cloud 的手动及自动压缩、终端内交互许可。 |

Cloud Teahouse 的独立宿主注册复用三工具的作用域守卫与提示 hook 的 `message` 输出。`D:/dam-cli-delivery-20261126/verified/cloud-code.jsonl` 记录 SHA-256 为 `5f7660d7c9a3631113d91ad6ac5513e79ac99c67354229c2fe9c718632876378` 的 npm 安装包复跑结果。运行时构建 ID 为 `0bfe7dd89ffdc8fa78a06f369815e876603be13a96cf14745e3e27198a1bc8c5`。  
来源: [MCP 配置加载](https://github.com/cloud-teahouse/cloud-code/blob/5e3bfcb43fcaf040045cfb88fb9b380dc98b3d70/packages/agent-core/src/mcp/config-loader.ts) · [UserPromptSubmit 输出](https://github.com/cloud-teahouse/cloud-code/blob/5e3bfcb43fcaf040045cfb88fb9b380dc98b3d70/packages/agent-core/src/session/hooks/user-prompt.ts)

~~~powershell
$CloudTeahouse = Join-Path $env:TEMP ('dam-auto-memory-kimi-cloud-code-' + [guid]::NewGuid().ToString('N'))
npm.cmd install --prefix $CloudTeahouse --no-audit --no-fund --registry=https://registry.npmjs.org @cloud-teahouse/cloudcode-cli@0.2.0
& (Join-Path $CloudTeahouse 'node_modules/.bin/cloud-code.cmd') --version
$CloudEntry = Join-Path $CloudTeahouse 'node_modules/@cloud-teahouse/cloudcode-cli/npm/bin/cloudcode.exe'
$env:DAM_KIMI_TEST_SCRATCH = 'D:/'
$env:DAM_EXTERNAL_PLUGIN_DIR = 'D:/dam-cli-delivery-20261126/verified/win/node_modules/@a9i5k4/dsh-auto-memory'
node tests/live/auto-memory-kimi-host.mjs $CloudEntry 'G:/dsh_desktop/DeepSeek Harness.exe' --cloud-teahouse
~~~

## 任务书中的 ZCode 标识

维护者已澄清，任务书写的 `gcode` 实际指 ZCode。ZCode CLI `0.18.0` 和 Desktop `4.0.0.10870` 的真实宿主验收见 [外部宿主适配](auto-memory-external-hosts.md)。
