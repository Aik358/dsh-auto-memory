# ZCode 宿主扩展面调研（研究线 A）

> 目标：评估把 `dsh-auto-memory`（DSH 记忆插件）移植到 ZCode 的可行性，**只出方案、不改代码**。
> 调研对象：本机 ZCode Desktop **v3.16.2**（用户提供）+ 随包 CLI **0.17.0**。
> 证据分级：**【实测】**=本机真跑并留输出；**【源码】**=随包发行物字节级检索；**【文档】**=仓库文档；**【推断】**/**「未验证」**=无一手证据。
> 取证时间：2026-10-22 10:13–10:50（Asia/Hong_Kong）。

---

## 0. 结论摘要（先看这 10 条）

1. **ZCode 的插件贡献面只有 5 类**：`skills` / `commands` / `hooks` / `mcpServers` / `agents`（+ `ui.surfaces` 做前端面板）。**没有插件级 HTTP 路由、没有进程内工具注册**——工具只能走 MCP。【源码+实测】
2. **每轮上下文注入可行**：`UserPromptSubmit` hook 的 `additionalContext` 会被包成 `<system-reminder>` 附件（kind=`hook_context`、生命周期 `per_current_turn`），**但总长截断 24,000 字符**。【源码】
3. **hook 是串行阻塞**：同一事件下多个 hook 顺序 await，实测两个各 sleep 1200ms 的 hook 共阻塞约 2.45s，B 在 A 结束后才启动（A 结束 02:40:00.786 → B 开始 02:40:01.040）。**记忆插件每轮注入必须把耗时压到几十毫秒级**。【实测】
4. **hook stdin 是"双份字段"**：同一份 JSON 同时给 camelCase + snake_case（`sessionId`/`session_id`、`hookEventName`/`hook_event_name`、`permissionMode`/`permission_mode`…），并**额外落一个临时 transcript.jsonl**（只含当前这一条消息）。实测 SessionStart stdin **745 字节**、UserPromptSubmit **738 字节**——体积很小。【实测】
5. **MCP 客户端不声明 sampling**（capabilities 只有 `extensions["io.modelcontextprotocol/ui"]` + 可选 `elicitation.form`）⇒ **插件不能借宿主模型做后台固化**；`elicitation`（向用户要输入）反而可用。【源码】
6. **MCP stdio server 真能连上并常驻**：实测 spawn 后收到 `server/discover` → `initialize` → `notifications/initialized` → `tools/list`；工具命名 `mcp__plugin_<pluginName>_<serverKey>__<tool>`。【实测+源码】
7. **AGENTS.md 单文件上限 100 KiB**（`maxBytes=100*1024`），超出按字节截断；加载顺序 = `~/.zcode/AGENTS.md`（用户级）+ 从 cwd 向上找到的第一个工作区 AGENTS.md，拼接顺序 user → workspace。【源码】
8. **UI Plugin 能做出"记忆面板"侧栏页签**，但**只在 Desktop 本地工作区生效**（Web/手机/远程工作区退化为普通 MCP 工具记录），且页面**没有 Node 权限**，一切读写必须经插件自己的 MCP server。【文档+源码】
9. **ZCode 自带原生 memory 子系统**（`features.memory` / `memory.use` 默认 **true**，桌面 `setting.json` 里 `memoryEnabled: true`），会与本插件抢同一批语义 ⇒ 必须做「关掉原生 / 共存」的显式决策。【源码+本机配置】
10. **最大阻塞**：①无 token 用量、无会话事件流、无插件 HTTP 路由（面板只能走 UI Plugin）；②hook 串行阻塞直接决定注入预算；③原生 memory 冲突。

---

## 1. 取证环境与方法

### 1.1 本机安装位置【实测】

| 项 | 路径 / 值 | 证据 |
| --- | --- | --- |
| 桌面主程序 | `E:\zcode\ZCode.exe`（222,866,328 B，2026-10-19） | `ls -la /e/zcode` |
| Electron 包 | `E:\zcode\resources\app.asar`（341,334,118 B） | 同上 |
| **Agent 运行时（CLI+内核）** | `E:\zcode\resources\glm\zcode.cjs`（15,243,891 B，15,677 行，已压缩单行 bundle） | `wc -c` 实测 |
| 内置 provider 配置 | `E:\zcode\resources\config\provider\zcode-builtin.json` | `ls` |
| 用户数据根 | `C:\Users\JH Z\.zcode`（`backup/ cli/ plugin-workspace/ tmp/ v2/ workspace/`） | `ls -la` |
| 用户配置 | `C:\Users\JH Z\.zcode\cli\config.json`（39,245 B） | 见 §2.5 |
| 插件根 | `C:\Users\JH Z\.zcode\cli\plugins\{cache,data,marketplaces,installed_plugins.json,known_marketplaces.json}` | `ls -laR` |
| 桌面设置 | `C:\Users\JH Z\.zcode\v2\setting.json`（含 `memoryEnabled: true`） | 读文件 |
| **CLI 版本** | `zcode 0.17.0`（`node "E:/zcode/resources/glm/zcode.cjs" --version`） | 【实测】 |
| **zcode 是否在 PATH** | 否（`command -v zcode` 无结果）；npm 全局 bin 里也没有 `zcode` | 【实测】 |

**可用 CLI 的真身**：没有独立 CLI 安装，但 `zcode.cjs` 可直接用系统 Node（v24.18.0）执行，等同 CLI。实测可跑通：

    node "E:/zcode/resources/glm/zcode.cjs" --version        -> 0.17.0
    node "E:/zcode/resources/glm/zcode.cjs" doctor           -> version/platform/node/sea/default artifact
    node "E:/zcode/resources/glm/zcode.cjs" plugins list --json
    node "E:/zcode/resources/glm/zcode.cjs" skills list --json
    node "E:/zcode/resources/glm/zcode.cjs" commands list
    node "E:/zcode/resources/glm/zcode.cjs" plugins validate <path> [--json]

⇒ **"只有桌面端、没装 CLI"时仍可做只读校验**，因为 CLI 就是桌面包内的 `zcode.cjs`。【实测】

> 注意：`zcode.cjs` 是 minified 单行 bundle，**行号无意义**。本文引用它的证据一律给 **符号名 + 字符偏移**（`Buffer.indexOf` 实测），可复算。

### 1.2 证据方法

- 随包 bundle 用 Node `fs.readFileSync(...).indexOf()` 定位符号，打印上下文窗口（脚本见 `artifacts/_zcode-port/{x.cjs,find2.cjs}`）。
- 真实行为验证：在 `artifacts/_zcode-port/` 下建临时插件 + 临时工作区 + **隔离 storage 根**（`ZCODE_STORAGE_DIR`），**全程没有写 `C:\Users\JH Z\.zcode\cli\config.json`，也没安装任何用户级插件**。
- 临时插件源码保留在 `artifacts/_zcode-port/zcode-port-probe/`（可复跑），探针输出在 `artifacts/_zcode-port/sandbox-storage/cli/plugins/data/zcode-port-probe@inline/`。

---

## 2. 插件系统

### 2.1 plugin.json 完整 schema【源码 + 实测】

**位置**：插件根下 `.zcode-plugin/plugin.json`。**兼容回退**依次为 `.claude-plugin/plugin.json` → `.codex-plugin/plugin.json` → `.cursor-plugin/plugin.json`（`AKs`，偏移 ~4261613）。

**实测被接受的最小完整清单**（`artifacts/_zcode-port/zcode-port-probe/.zcode-plugin/plugin.json`，`plugins validate` 返回 `{"ok":true,"diagnostics":[]}`）：

    {
      "name": "zcode-port-probe",        // 稳定标识；小写连字符；实测正则 /^[a-z0-9][a-z0-9._-]{0,127}$/
      "version": "0.0.1",
      "description": "...",
      "author": { "name": "..." },       // 也可为字符串；读 author.name / author.url
      "license": "MIT",
      "skills": "./skills",              // 目录（相对插件根）
      "commands": "./commands",          // 目录
      "hooks": "./hooks/hooks.json",     // 文件路径 或 内联对象 或 数组
      "mcpServers": { },                 // 对象 或 指向 .mcp.json 的字符串 或 数组
      "ui": { "surfaces": [ ] },         // 仅 UI Plugin，见 §7
      "userConfig": {                    // 声明式用户配置，被模板变量引用
        "sdk_path": { "type": "string", "default": "", "description": "...", "sensitive": false }
      }
    }

字段语义与约束（逐条源码证据）：

| 字段 | 语义 | 约束 / 证据 |
| --- | --- | --- |
| `name` | 插件 ID 主键，最终 ID = `<name>@<marketplace>` | `dta` 正则；目录名建议同名（非强制，实测目录名与 name 不同也能被发现） |
| `version` | 版本 | 缺失时 `cta="0.0.0"` |
| `skills` | 技能根目录 | 相对插件根；必须存在，否则出 `plugin_component_path_invalid` 类诊断 |
| `commands` | 命令目录（`*.md`） | 同上 |
| `hooks` | 见 §3 | 文件必须含 `{"hooks":{...}}` 包装；内联则直接是 `{事件: [...]}` |
| `mcpServers` | 见 §4 | 值必须是对象；非对象条目被静默丢弃 |
| `ui.surfaces` | 见 §7 | 仅桌面本地工作区生效 |
| `userConfig.<k>` | 配置项元数据 | `type/default/description/sensitive`；`sensitive:true` 的值**禁止**出现在 mcp 的 command/args/url 等非敏感字段（会抛 `Sensitive plugin user_config value cannot be used in this field`） |
| 被忽略的字段 | `channels`/`lspServers`/`outputStyles`/`settings` | `pta` 里列出但**无实现**（`warnUnsupportedComponents`） |

**组件路径校验规则**（`resolveInside`/`CT`，偏移 ~4275817）：
- 绝对路径 ⇒ **直接判非法**（`if(isAbsolute(t)) return null`）。
- `resolve(root, p)` 后 `relative(root, resolved)` 若是 `""` 或**不以 `..` 开头** ⇒ 合法；否则 `plugin_component_path_invalid`（error）。
- 指向不存在的路径 ⇒ `plugin_hook_read_failed` / `plugin_component_path_invalid`（error）。
- 同一真实路径（realpath）被声明两次 ⇒ `Duplicate plugin hooks file ignored`（warning，后者丢弃）。
- `mcpServers` 里的字符串同样走这条校验 ⇒ 不能 `../../` 逃出插件根。

### 2.2 marketplace 机制【源码 + 本机落盘文件】

**磁盘状态（本机实测）** `C:\Users\JH Z\.zcode\cli\plugins\known_marketplaces.json`：

    { "version": 1, "marketplaces": [
      { "id": "zcode-plugins-official",
        "source": { "source": "url", "url": "https://cdn-zcode.z.ai/zcode/official-plugin/marketplace.json" },
        "name": "...", "description": "...", "addedAt": "...", "pluginCount": 48, "lastUpdated": "..." },
      { "id": "claude-plugins-official",
        "source": { "source": "github", "repo": "anthropics/claude-plugins-official" },
        "pluginCount": 291, "cacheTransactionId": "..." } ] }

`installed_plugins.json`：`{version:1, plugins:[{id,name,marketplace,version,installPath,installedAt,updatedAt,scope:"user",source:{source,type,url,sha256,path},cacheTransactionId}]}`（本机 3 条：video-agent-kit / github / disk-cleaner）。

**marketplace 清单位置**（`plugin-creator` 参考文档 `references/plugin-json-spec.md:19-53`）：
- 本地市场用 **`.claude-plugin/marketplace.json`**（根级 `marketplace.json` 也支持）；
- `source` 相对**市场根目录**解析（不是 `.claude-plugin/` 内部）；
- 条目字段：`name/source/version/description/displayName/displayName_i18n/description_i18n/category`；
- 默认本地来源名 `zcode-plugins-local`（UI_PLUGIN.md:228）。

**marketplace source 类型**（`uJs` Zod，偏移 ~4216140）：`url`(url+headers) / `github`(repo+ref+path+sparsePaths) / `git`(url+ref+path+sparsePaths) / `npm`(package) / `file`(path) / `directory`(path)。

**插件安装 = 复制到 cache**：`installPath` 形如 `.../plugins/cache/<marketplace>/<name>/<version>`，装好后**源码改动不会热更新**（UI_PLUGIN.md:242）。

### 2.3 不经 GUI 直接安装/启用本地插件【实测可行路径 + 一条重要否定结论】

**(A) 项目级 plugins.dirs（推荐给开发/共存场景）** —— 在**工作区根**放 `zcode.json`：

    {
      "plugins": {
        "dirs": ["D:/dsh-auto-memory/artifacts/_zcode-port/zcode-port-probe"],
        "enabled": true,
        "enabledPlugins": { "zcode-port-probe@inline": true }
      },
      "hooks": { "enabled": true }
    }

实测输出（cwd = 该工作区）：

    Plugins (16)
    - zcode-port-probe@inline [enabled]
      inline/inline: D:\dsh-auto-memory\artifacts\_zcode-port\zcode-port-probe
      skills: 1, commands: 1, hooks: 3, mcp: plugin:zcode-port-probe:probe-mcp

同时 `skills list` 出现 `zcode-port-probe:probe-skill (user/plugin; alias probe-skill)`，`commands list` 出现 `/probe-command`。**`plugins.dirs` 的每一项就是"插件根目录"本身，不是父目录**（实测传父目录 `_zcode-port` 时发现 0 个插件，传插件根才命中）。

**(B) CLI 命令（等价 GUI 动作）**（UI_PLUGIN.md:221-224 官方序列；本机用 `node "E:/zcode/resources/glm/zcode.cjs" plugins ...` 等价）：

    zcode plugins marketplace add <market-root> --scope user
    zcode plugins install <name>@<market>  --scope user
    zcode plugins enable  <name>@<market>  --scope user
    zcode plugins list --json

【实测 CLI 命令本身都能跑，但 install/enable 会写用户级 inventory，按用户约束**未在本机执行**】

**配置键形状（plugins）** —— 默认值与 Zod 校验（`Bm.plugins` 偏移 1392485；`dJs` Zod 偏移 4217000）：

    "plugins": {
      "enabled": true,          // bool
      "dirs": [],               // string[]  本地插件根目录
      "enabledPlugins": {},     // Record<pluginId, boolean>  pluginId = "<name>@<marketplace>"
      "extraKnownMarketplaces": {},  // Record<id, { source: <url|github|git|npm|file|directory> }>
      "options": {},            // Record<pluginId, Record<key, string|number|boolean>>，即 user_config 值
      "suppressedBuiltins": []  // string[]  屏蔽内置插件
    }
    "hooks": { "enabled": true }   // 注意：顶层 hooks.enabled 默认 false

> **重要否定结论【实测】**：`ZCODE_STORAGE_DIR` **只改 storage（session db / plugin cache / plugin data），不改用户配置路径**。用户配置固定 `~/.zcode/cli/config.json`（`D4()` = `join("~/.zcode/cli","config.json")`，`Rso="~/.zcode/cli"`，偏移 ~4223834）。我把 `plugins.dirs` 写进沙箱 storage 的 `cli/config.json` 后 `plugins list` **完全无变化**（连 `enabledPlugins:false` 都没生效）⇒ 那条路是无效配置，不是 bug。
> ⇒ **要在用户级启用，必须动真实 `~/.zcode/cli/config.json`（本次按约束未动）**；不想动它就改用项目级 `zcode.json`（已实测可行）。

### 2.4 插件数据目录（plugin data dir）【实测】

- 默认：`~/.zcode/cli/plugins/data/<pluginId>`（如 `C:\Users\JH Z\.zcode\cli\plugins\data\visualize@zcode-plugins-official`，来自 `plugins list --json` 的 `dataPath`）。
- 推导链（源码）：`storage.dir`（默认 `~/.zcode`）→ `getCliStorageRoot`（basename 不是 `cli` 则 `join(e,"cli")`）→ `join(e,"plugins")`（`Hke`）→ `join(pluginsRoot,"data", sanitize(id))`。
- 环境变量：`ZCODE_PLUGIN_DATA`（= dataPath）、`ZCODE_PLUGIN_ROOT`（= 插件根）、`ZCODE_PLUGIN_ID`、`ZCODE_PLUGIN_NAME`、`ZCODE_PROJECT_DIR`（= cwd）、`ZCODE_SESSION_ID`。**六个变量在 hook 里实测均有值**【实测】。
- 实测路径：`D:\...\sandbox-storage\cli\plugins\data\zcode-port-probe@inline`（因我改过 storage 根）。

### 2.5 本机用户配置现状【实测】

`C:\Users\JH Z\.zcode\cli\config.json` 顶层只有两个键：`plugins`、`provider`。

    { "plugins": { "enabledPlugins": {
        "video-agent-kit@zcode-plugins-official": true,
        "computer-use@zcode-plugins-official": true,
        "github@zcode-plugins-official": true,
        "disk-cleaner@zcode-plugins-official": true } } }

**没有** `hooks` / `features` / `memory` / `mcp` / `skills` 键 ⇒ 全部走默认值（`hooks.enabled=false`、`features.memory=true`、`memory.use=true`）。

---

## 3. Hooks（本轮最关键的契约）

### 3.1 事件集合：确实是 7 种【源码】

`Tl` 枚举（偏移 ~1399738，对应 `packages/contracts/src/hooks/index.ts`）：

    SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest,
    PostToolUse, PostToolUseFailure, Stop

另有 `p3` 结果枚举：`success / blocked / failed / cancelled / timed_out`。
**没有** `PreCompact` / `Notification` / `SessionEnd` / `SubagentStop` 作为 hook 事件（`PreCompact` 命中 0）。插件若声明未知事件 ⇒ `plugin_hook_unsupported_event`（warning，不报错）。

### 3.2 声明形状与默认值【源码】

    // hooks/hooks.json（必须这层 "hooks" 包装）
    { "hooks": {
      "UserPromptSubmit": [
        { "matcher": "*",                 // 可选；仅对带 toolName 的事件有意义
          "hooks": [
            { "type": "process",          // process = argv 直跑；command = shell 字符串
              "command": "node",
              "args": ["<pluginRoot>/hooks/x.cjs", "UserPromptSubmit"],
              "enabled": true,            // false 可单独禁用
              "timeoutMs": 15000,         // 单条覆盖
              "statusMessage": "...",     // 可选，UI 展示
              "async": false              // 仅 type=command 有效
            } ] } ] } }

- 顶层默认：`hooks: { enabled:false, events:{}, maxOutputBytes:32768, timeoutMs:60000 }`（`Bm` 偏移 1392485）。
- 单条 `timeoutMs` 覆盖默认；`command` 类型还可用 `timeout`（**秒**）×1000（`MFe`，偏移 4230447）。
- `maxOutputBytes` 默认 **32,768**；stdout/stderr 超出按此上限截断（不报错）。
- **插件自带 hooks 不受 `hooks.enabled` 影响**：`hooks.enabled` 管的是配置里手写的 hooks（`Kma` 用 `e.config.enabled`）；插件 hooks 走 `listPluginHookSources`/`loadPluginHookSource` 独立链路。实测第一次跑时用户配置无 `hooks` 键，SessionStart/UserPromptSubmit 都被调用。【实测+源码】

### 3.3 stdin JSON 精确 schema【实测抓包 + 源码】

**实测抓包**（`artifacts/_zcode-port/sandbox-storage/cli/plugins/data/zcode-port-probe@inline/*.json`，由探针 hook 原样落盘）：

SessionStart（stdin **745 字节**，单行 JSON）：

    {"cwd":"D:\\...\\testws","hookEventName":"SessionStart","mode":"yolo",
     "model":"7147a8a0-.../minimax-m3","sessionId":"sess_2a6a8a55-...","source":"startup",
     "timestamp":"2026-10-22T02:39:05.508Z","traceId":"e7305633-...","turnId":"turn_5f52e111-...",
     "hook_event_name":"SessionStart","permission_mode":"yolo",
     "session_id":"sess_2a6a8a55-...",
     "transcript_path":"C:\\Users\\JHZ~1\\AppData\\Local\\Temp\\...\\zcode-hook-9KLQKp\\transcript.jsonl",
     "transcriptPath":"...同上..."}

UserPromptSubmit（stdin **738 字节**）：在 SessionStart 字段基础上**多一个 prompt**（无 source/model）：

    {"cwd":"...","hookEventName":"UserPromptSubmit","mode":"yolo",
     "prompt":"Say exactly: PROBE-PROMPT-OK. Do not use any tool.",
     "sessionId":"...","timestamp":"...","traceId":"...","turnId":"...",
     "hook_event_name":"UserPromptSubmit","permission_mode":"yolo","session_id":"...",
     "transcript_path":"...","transcriptPath":"..."}

**各事件字段全表**（源码 `Axn`/`createCompatibleHookStdin`，偏移 ~5225070；与实测一致）：

| 事件 | 专有字段 | 公共字段 |
| --- | --- | --- |
| `SessionStart` | `source`（startup/resume…）、`model` | `cwd, hookEventName, mode, sessionId, timestamp, traceId, turnId, agentName?(有则), hook_event_name, permission_mode, session_id, transcript_path, transcriptPath` |
| `UserPromptSubmit` | `prompt`、`attachmentsSummary`（无附件时缺省） | 同上（无 source/model） |
| `PreToolUse` | `tool_name, tool_input, tool_use_id, riskLevel, sideEffectScope, artifactRefs?` | 同上 |
| `PermissionRequest` | `tool_name, tool_input, tool_use_id, requestId, reason, riskLevel, sideEffectScope, permission_suggestions?` | 同上 |
| `PostToolUse` | `tool_name, tool_input, tool_use_id, tool_response（原始结果对象）, toolResultPreview` | 同上 |
| `PostToolUseFailure` | `tool_name, tool_input, tool_use_id, error_details（结构化）, error（message 字符串）, is_interrupt` | 同上 |
| `Stop` | `last_assistant_message（= responseText ?? responsePreview）, stop_hook_active, toolCallCount` | 同上 |

**transcript_path 的真相（实测）**：每次 hook 调用都会 `mkdtemp()` 新建 `zcode-hook-XXXXXX/`，写一个 **transcript.jsonl 只含当前这一条消息**，hook 结束即 `rm -rf`。
- Stop：一行 `{"message":{"content":[{"text":<assistant 全文>,"type":"text"}],"role":"assistant"}}`
- UserPromptSubmit：同上但 `role:"user"`、text=prompt
- **其它事件（SessionStart/PreToolUse/PostToolUse*）：文件是空字符串**（`Bma` 只处理 Stop 与 UserPromptSubmit）。
⇒ **不能当作"会话转录"用**；要历史必须自己落盘。

### 3.4 stdout JSON schema 与 additionalContext 的精确语义【源码】

**顶层 schema**（`OPr`，偏移 ~1401649）：

    { additionalContext?: string, additional_context?: string,   // 两种写法都收
      continue?: boolean,
      decision?: "approve" | "block",
      hookSpecificOutput?: <按事件判别>,
      reason?: string, stopReason?: string,
      suppressOutput?: boolean, systemMessage?: string }

**hookSpecificOutput 按事件判别**（`P0s`）：

| 事件 | 允许字段 |
| --- | --- |
| `PreToolUse` | `additionalContext`, `hookEventName`, `permissionDecision: "allow"|"ask"|"deny"`, `permissionDecisionReason`, `updatedInput` |
| `PermissionRequest` | `hookEventName`, `decision: {behavior:"allow"|"deny", message?, permissionUpdates?, updatedInput?}` |
| `UserPromptSubmit` / `SessionStart` / `PostToolUse` / `PostToolUseFailure` / `Stop` | `additionalContext`, `hookEventName` |

**"strict schema 拒绝哪些键"的准确回答**：**不拒绝**。`OPr` 是普通 `z.object(...)`（非 `.strict()`）⇒ Zod 默认 **strip**，未知键被**静默丢弃**，不报错。
但有两条硬失败：
1. `hookSpecificOutput.hookEventName` 必须**等于**当前事件，否则抛 `Hook returned wrong event name`（`ToolExecutionFailed`，recoverable）——源码 `Mvo`，偏移 ~5228649。
2. stdout 不是以 `{` 开头的合法 JSON 时 ⇒ **当作"无输出"**，静默忽略（`Gma`: `if(!n||!n.startsWith("{"))return;`）。JSON 解析失败同样静默忽略。

**退出码语义**（`Uvo`，偏移 ~5238000 附近）：
- `exit 0` ⇒ 解析 stdout。
- `exit 2` ⇒ **阻塞语义**（`Jma`）：PreToolUse → `permissionDecision:"deny"`；PermissionRequest → deny；Stop → `decision:"block"`；其它 → `continue:false`。错误消息取 stderr || stdout || "Hook blocked execution"。
- 其它非 0 ⇒ `Hook process failed`（`ToolExecutionFailed`，**非阻塞**，只记 `hook.run.failed`）。
- 超时 ⇒ `Hook timed out after <ms>ms`（`ToolTimeout`，recoverable）。

**additionalContext 变成什么**（`b5o` / `M6a`，偏移 ~13274952）：
1. 所有 hook 的 `additionalContext` 收集进 `additionalContexts: string[]`（按 hook 声明顺序）。
2. 拼成一条附件（换行分隔，带 `#1`/`#2` 序号，前缀 `<事件> hook additional context: `）。
3. 以 `Sy("hook_context", body)` 写入 messageHistory ⇒ 附件 **kind = `hook_context`**，被 `pla` 表登记为 `ch("current_turn","per_current_turn",true,"sr.hook_context")`（偏移 ~4955590）⇒ **channel=current_turn、生命周期=per_current_turn、provider_visible、isMeta=true**。
   - 含义：**注入到"当前轮"的 system-reminder 通道，每轮重新产生**；不是 system prompt，也不是 user message。
4. **截断**：总长上限 `HOOK_CONTEXT_MAX_CHARS = 24_000`（`D6a=24e3`），超出 `slice(0,24000)+"..."`。
   ⇒ 记忆注入的可用预算上限就是 24k 字符，且**同一事件链路上所有 hook 共享**。
5. **Stop 续跑规则**（`S5o`）：`stopShouldContinue===true && additionalContexts.length>0 && 次数 < 3`（`R6a=3`）才继续下一轮。即 **Stop 最多触发 3 次续跑**，且必须同时满足"要续跑"和"有内容"。

### 3.5 并行还是串行？超时？stdin 可能多大？【实测+源码】

**(a) 串行，逐条 await**【实测】`InMemoryHookRunner.run`（`Tbe` 类，偏移 ~5233878）核心循环：

    for (let [h,{hook:_}] of c.entries()) { ... await this.runCallbackWithTimeout(_,t,h,n.signal) ... }

实测证据（`timing.log`）：

    {"label":"UPS-A","startIso":"2026-10-22T02:39:59.579Z","endIso":"2026-10-22T02:40:00.786Z","elapsedMs":1207}
    {"label":"UPS-B","startIso":"2026-10-22T02:40:01.040Z","endIso":"2026-10-22T02:40:02.252Z","elapsedMs":1212}

⇒ B 的开始时间比 A 的结束晚 254ms（期间 B 完全没跑）⇒ **严格串行**；同事件下 N 个 hook 的延迟**相加**，并**直接串在 turn 开始前**（UserPromptSubmit 是阻塞点，用户感知为"发出去后先卡住"）。
⇒ **单次 UserPromptSubmit 的额外延迟 ≈ Σ(各 hook 耗时)**。实测 2×1200ms 的 hook ⇒ ~2.45s 纯增加。

**(b) 超时上限**
- 每条默认 `60_000 ms`（`Bm.hooks.timeoutMs`），可被条目 `timeoutMs` / `command.timeout`(秒) 覆盖。
- 超时**不会**中止整个 turn，只判该条 `timed_out` 并继续下一条（`Bxn` 映射）。
- `async:true`（**仅 `type:"command"`**）⇒ `runBackgroundHook` 后台跑、不阻塞、**输出完全不参与本轮**（`continue` 分支直接跳过 await）。`type:"process"` 写 `async:true` 无效。

**(c) stdin 体积**
- 实测：SessionStart 745 B、UserPromptSubmit 738 B。
- 结构上：`prompt`（整段用户输入）+ `tool_input`（PreToolUse 的完整工具入参，可能极大，例如写 100KB 文件）+ `tool_response`（PostToolUse 的完整工具结果）。
- **没有独立于 maxOutputBytes 的 stdin 上限**（未发现 `maxStdinBytes` 类常量）⇒ **PreToolUse/PostToolUse 的 stdin 可能达到 MB 级**（取决于工具入参/结果大小）。
- 对记忆插件的含义：**只订阅 UserPromptSubmit / Stop / SessionStart 可把 stdin 稳定压到 <2KB**；订阅 PreToolUse/PostToolUse 会拿到大包，需自己限流。

### 3.6 hook 环境变量【实测】

每次 hook 进程都能拿到（实测探针打印）：

    ZCODE_SESSION_ID / CLAUDE_CODE_SESSION_ID     = sess_...
    ZCODE_PROJECT_DIR  / CLAUDE_PROJECT_DIR        = <cwd>
    ZCODE_PLUGIN_ROOT  / CLAUDE_PLUGIN_ROOT        = <插件根>
    ZCODE_PLUGIN_DATA  / CLAUDE_PLUGIN_DATA        = <dataPath>
    ZCODE_PLUGIN_ID, ZCODE_PLUGIN_NAME

模板变量在 command/args/env/cwd 里都被展开（`expandPluginVariables`，偏移 ~5225300）；`ZCODE_SKILL_DIR` 在 hook 上下文**会抛错**（`Hook variable requires a skill context`）。

---

## 4. MCP

### 4.1 stdio server 启动方式【实测跑通】

清单声明（`plugin.json.mcpServers`，或指向 `.mcp.json`）：

    "mcpServers": {
      "probe-mcp": {
        "type": "stdio",                        // 省略时按有无 command 推断（_Zs）
        "command": "node",
        "args": ["<pluginRoot>/mcp/server.cjs"],
        "cwd": "<ZCODE_PROJECT_DIR>",
        "env": { "PROBE_DATA": "<ZCODE_PLUGIN_DATA>",
                 "ZCODE_PLUGIN_ID": "zcode-port-probe@dev" },
        "timeoutMs": 30000,                     // 可选，工具默认超时
        "alwaysLoad": true                      // 可选，跳过 ToolSearch 懒加载
      }
    }

支持传输：`"stdio" | "http" | "sse"`（`lZs=new Set(["stdio","http","sse"])`，偏移 ~4282146）。`http` 支持 `url/headers/oauth/auth`。

**实测生命周期日志**（`mcp-lifecycle.log`）：

    02:39:04.207Z spawn pid=3168  cwd=...\testws
    02:39:04.302Z recv server/discover              <-- 现代协议探测
    02:39:05.506Z spawn pid=33528 cwd=...\testws    <-- 协商后重启一次
    02:39:05.513Z recv initialize
    02:39:05.813Z recv notifications/initialized
    02:39:05.815Z recv tools/list

⇒ ①**先探测 server/discover，再真正 initialize**（协议版本协商，含 2025-11-25 / 2025-06-18 / 2025-03-26 / 2024-11-05 等 `cmt` 列表，偏移 ~4469338）；②**server 进程在会话期间常驻**（同一 pid 后续服务 tools/list、tools/call）；③**不支持 server/discover 也能降级成功**（我的探针 server 对该方法回 -32601，仍完成 initialize）。

### 4.2 工具命名规则【源码】

    function HSn(e,t,n,o,i){ ... name: "mcp__" + oho(e) + "__" + oho(u) ... }   // 偏移 4849260
    function oho(e){ return e.replace(/[^a-zA-Z0-9_-]/g,"_").replace(/_+/g,"_") || "unknown"; }
    function pZs(e,t){ return "plugin:" + e.manifest.name + ":" + t }             // 偏移 ~4282146 附近

- 内部 serverName 被命名空间化为 `plugin:<pluginName>:<mcpKey>`。
- 模型可见名 = `mcp__` + 净化后的 serverName + `__` + 净化后的 toolName。
- 实测：我的插件 `zcode-port-probe` + server key `probe-mcp` + tool `probe_echo` ⇒ 模型侧应为 `mcp__plugin_zcode-port-probe_probe-mcp__probe_echo`（`plugins list` 里 server 名显示为 `plugin:zcode-port-probe:probe-mcp`，已实测确认命名空间形态）。
- **工具名会被规范化**：非 `[A-Za-z0-9_-]` 全替换成 `_`，连续 `_` 折叠成一个。

### 4.3 超时

- 连接超时：`openServerConnection` 用 `timeoutMs`（未显式配置时取网络默认 180s / 调用方传入值）。
- 工具超时：优先读工具 `_meta.timeoutMs`（`uaa`，钳在 `[ZEr, YEr]` 区间），否则用 server 的 `timeoutMs`（`HSn` 第 3 参）。
- 连接期 `listTools` 也有独立超时（`qve(b.listTools(), f, ...)`）。

### 4.4 模板变量【源码】

`resolveTemplate`（`cE`，偏移 ~4282146 附近）支持：

| 变量 | 值来源 | 备注 |
| --- | --- | --- |
| `ZCODE_PLUGIN_ROOT` / `CLAUDE_PLUGIN_ROOT` | 插件根 | 实测有值 |
| `ZCODE_PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA` | dataPath | 实测有值 |
| `ZCODE_PROJECT_DIR` / `CLAUDE_PROJECT_DIR` | 工作目录 | 实测有值 |
| `ZCODE_SESSION_ID` / `CLAUDE_SESSION_ID` / `CLAUDE_CODE_SESSION_ID` | 会话 id | **在 MCP 配置里会抛错**（`Plugin variable requires a runtime session context`）——这些配置在会话建立前就解析好了 |
| `ZCODE_SKILL_DIR` | 技能目录 | 仅技能上下文 |
| `user_config.<key>` | 清单声明 + `plugins.options` | `sensitive:true` 的键在非敏感字段（command/args/url）会**抛错** |
| `ZCODE_*`（其它） | 进程环境变量 | 找不到抛 `Missing environment variable` |
| `SOME_UPPER_VAR` | 进程环境变量 | 仅 env/headers 等 allowSensitive 字段允许 |

### 4.5 MCP 客户端能力（决定"能不能借宿主模型"）【源码，关键】

连接时声明的 capabilities（`openServerConnection`，偏移 ~4927878）：

    capabilities: { ...buildMcpAppsClientCapabilities(),   // { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }
                    ...(this.elicitation ? { elicitation: { form: {} } } : {}) }

⇒ **没有 sampling，没有 roots**。
- **sampling/createMessage 不可用** ⇒ 插件无法请宿主模型补全文本。**后台固化不能借宿主模型**（这是对需求 ⑦ 的硬否决）。
- `elicitation/create` **可用**（`installElicitationHandler`，偏移 4921058）：server 可向用户弹表单，host 侧通过 `requestElicitation` 转发，返回 `{action:"accept"|"decline"|"cancel", content?}`。仅 `mode:"form"` 支持，其它 mode decline。
- `notifications/*` 日志/进度/资源更新通知可用（`installNotificationHandlers`）。
- **UI Plugin 页面内的 createSamplingMessage() 是另一条链路**（MCP Apps 扩展，只在 Desktop 的 sandboxed page 里）；文档说"需要 sampling 能力"（UI_PLUGIN.md:352），实测未验证。

### 4.6 长驻进程与状态

- **可以**：stdio server 进程在会话期间常驻（实测同 pid 服务多次请求），可持有内存状态、定时器、文件句柄。
- 共享状态落 `ZCODE_PLUGIN_DATA`（跨会话持久）；`plugins list --json` 的 `dataPath` 就是它。
- 生命周期：随连接建立/销毁（会话或工作区关闭即终止）。**跨会话常驻的"守护进程"不是插件模型的一部分** ⇒ 定时任务只能：①MCP server 内定时器（随会话死）②hook 里 `async:true` 起的短命后台进程 ③外部自起进程（推断可行，未验证）。

---

## 5. Skills / Commands / Agents

### 5.1 目录结构【源码+实测】

    <pluginRoot>/
      skills/<skill-name>/SKILL.md      # 每个技能一个目录，文件名固定 SKILL.md
      commands/<command-name>.md        # 每个命令一个 .md
      agents/<agent-name>.md            # 子代理定义（官方 documents 插件有 agents/ 目录）
      hooks/hooks.json
      .mcp.json                          # 可选，等价 manifest.mcpServers
      .zcode-plugin/plugin.json

### 5.2 SKILL.md frontmatter【源码】

解析器 `parseSkill`（偏移 ~4261613 附近）只认 5 个键：`IKs=new Set(["name","description","when_to_use","license","metadata"])`。
- `name`：**必填**（缺失 → `skill_missing_name`，error）；回退目录名仅在**无 frontmatter** 时。
- `description`：**有 frontmatter 时必填**（缺失 → `skill_missing_description`，error）；**上限 1024 字符**（`TKs=1024`，超出 → `skill_description_too_long`，error）。
- 支持 YAML 折叠/字面块标量（`|-` / `>-`）。
- 技能正文读取上限 `CKs=1e5`（100KB），超出 `truncated:true`。
- 技能根发现：`<pluginRoot>/skills` 下**每个子目录**里的 SKILL.md（不跟随符号链接：`followSymbolicLinks:false`）。

**实测**：`skills list` 输出 `- zcode-port-probe:probe-skill (user/plugin; alias probe-skill)`，并列出描述与绝对路径 ⇒ 技能可被宿主枚举，可作为静态指令载体（模型通过 Skill 工具按需加载）。

### 5.3 commands【源码+实测】

- 文件：`commands/<name>.md`，正文即 prompt。
- 模板变量：`$ARGUMENTS`（全部参数）、`$1`/`$2`…（按空格/引号切分，`j0s` 支持单双引号与反斜杠转义）。
- **动态执行语法（感叹号 + 反引号包裹命令，以及对应的代码块形态）不支持**：命中直接抛 `Custom command /<name> uses unsupported <expansion>. Dynamic expansion is not available yet.`（`B0s`/`rit`，偏移 ~1402634）。
- 无参数时自动在正文末尾追加 `\n\nUser arguments:\n<args>`。
- 实测：`commands list` → `Custom commands (1)` / `- /probe-command` / `Probe Command` / `user/plugin: <path>`。

### 5.4 agents

- `agents/*.md`，frontmatter 解析器 `parseAgentProfileFromMarkdown`（`dre`，偏移 ~1064363）支持 `name/description/tools/model/color/permissionMode/memory` 等（`zps` 颜色集、`$ps` 权限模式集、`qps` 作用域集）。
- **对记忆插件的价值**：可定义"后台固化子代理"的角色与工具白名单，但**它是给宿主 Agent 用的定义，不是可编程 spawn API**（见 §9-⑦）。

### 5.5 能否作为"静态指令注入"载体？

- **Skills**：需要模型主动调 Skill 工具加载，**不是每轮自动注入**；且 `skills.metadataBudget=20000`（技能列表元数据预算）。
- **Commands**：仅用户 `/command` 触发。
- ⇒ **都不能替代"每轮注入"**；每轮注入只能靠 `UserPromptSubmit` hook 的 `additionalContext`。

---

## 6. AGENTS.md 注入机制

### 6.1 加载与合并顺序【源码】

`NodeContextSourceAdapter`（`rks`，偏移 ~2208113）：
1. **用户级**：`~/.zcode/AGENTS.md`（`lks`: `join(homedir(),".zcode","AGENTS.md")`，仅当 `priorityFiles` 含 AGENTS.md）。
2. **工作区级**：从 `cwd` 逐级向上，找到**第一个**存在的 AGENTS.md（`cks` 循环到 projectRoot/dirname）。
3. 去重（按 resolve 后绝对路径）后，**拼接顺序 = user → workspace**，分隔符两个换行（`aks`）。
4. `projectRoot` 的确定：向上找第一个含 `.git` 的目录（`n4r`）。

### 6.2 规模上限【源码】

- `nks = 100 * 1024` ⇒ **每个文件最多读 100 KB**，超出 `truncated:true`（`sizeBytes > maxBytes`）。
- 截断是**按字节 `subarray(0,100*1024)`**，可能切断多字节 UTF-8 字符（`oks`）。
- 合并后结构：`{filePath, fileName, content, bytesRead, sizeBytes, truncated, sources[]}`，每源带 `scope:"user"|"workspace"`。
- **没有"合并后再截断"**：两个 100KB 文件会全量拼成 200KB 进上下文（推断：注入侧是否再截断未验证）。

### 6.3 对记忆插件的含义

- AGENTS.md 是**最稳的静态指令载体**（每会话必注、不进 hook 延迟预算、无 24k 限制、随仓库走）。
- ⇒ **推荐组合**：AGENTS.md 放"记忆插件使用规则/工具清单"（静态、可版本化），hook 只放"本轮记忆内容"（动态、24k 内）。

---

## 7. UI Plugin（前端面板）

### 7.1 能力边界【文档 + 源码】

清单声明（UI_PLUGIN.md:300-331；解析器 `vZs`，偏移 4282146-4284434 已源码核对）：

    "mcpServers": { "app": { "type":"stdio", "command":"node",
                             "args":["<pluginRoot>/dist/server.mjs"],
                             "cwd":"<ZCODE_PROJECT_DIR>",
                             "env": { "ZCODE_PLUGIN_DATA":"<ZCODE_PLUGIN_DATA>" } } },
    "ui": { "surfaces": [ {
      "id": "memory-panel",                              // ^[A-Za-z0-9][A-Za-z0-9_.-]*$，≤128
      "title": { "en":"Memory", "zh-CN":"记忆" },         // string 或 locale→string，≤200
      "server": "app",                                    // 必须是 mcpServers 里声明过的 key
      "resourceUri": "ui://my-panel/memory.html",         // 必须以 ui:// 开头，≤2048
      "availability": "session",                          // 只接受 "session"
      "icon": "https://..."                               // 可选，≤2048
    } ] }

服务端必须**真的注册** `ui://...` 资源并返回 `text/html;profile=mcp-app`；让工具结果带上页面则设 `_meta.ui.resourceUri` + `_meta.ui.surface` + `_meta.ui.visibility`（UI_PLUGIN.md:331）。

### 7.2 能否做"记忆面板"页签 —— **可以**【文档+源码】

- **会话侧栏面板**：`ui.surfaces` 就是"手动打开编辑器/面板"的机制（UI_PLUGIN.md:20：会话侧栏面板 / 清单 ui.surfaces，工具 _meta.ui.surface）。
- 面板能力（页面 API，UI_PLUGIN.md:341-361）：
  - `callServerTool`（调自己插件的 MCP 工具）、`readServerResource`/`listServerResources`
  - `updateModelContext({content, structuredContent})`（**给下一轮附加选区，不立即发消息**）
  - `sendMessage({role:"user", content})`（**发主对话后续消息**，无手势时走确认）
  - `createSamplingMessage`（App 内调当前任务模型，不读主聊天历史）
  - `registerTool` / `onlisttools`+`oncalltool`（页面提供可被模型调用的工具）
  - `requestDisplayMode`（inline / fullscreen，**fullscreen = 侧栏**）
  - `downloadFile`、`openLink`、`sendLog`
  - `ui/set-widget-state`（仅宿主内存，会话内重建可恢复，**应用重启不保证**）
- **能力边界（硬约束）**：
  - **只在 Desktop 本地工作区生效**；Web / 手机 / 远程工作区只保留普通 MCP 工具记录（UI_PLUGIN.md:32）。
  - 页面**没有 Node / 任意文件系统访问权**，一切业务读写必须经插件 MCP server（UI_PLUGIN.md:438、333）。
  - 资源上限：HTML **16 MiB**、页面资源读 **8 MiB**；初始结果 `structuredContent` **64 KiB**、页面元数据 **16 KiB**、`content` **32 KiB**，超限字段被省略并标记（UI_PLUGIN.md:441）。
  - CSP 默认禁外网；`unsafeEval`/`wasmUnsafeEval` 需资源 `_meta["zcode/csp"]` 声明 + 宿主能力标记。
  - **没有插件 HTTP 路由** ⇒ 不能用"宿主端口 + fetch"做面板，只能 MCP 资源。

### 7.3 桌面端支持情况【源码（间接）+ 文档】

- 本机 `app.asar` 字符串检索命中：`uiSurfaces`(14)、`resourceUri`(105)、`ext-apps`(33)、`getHostCapabilities`(10)、`zcode/widgetState`(3)、`zcode/surface`(1)、`zcode/csp`(2)、`MCP Apps`(30) ⇒ **v3.16.2 桌面端已内置 UI Plugin 实现**。
- 但 **UI_PLUGIN.md:197 明确说仓库 `feat/ui-plugin` 分支"目前尚未建好"** ⇒ 文档对应的是**开发分支**，与已发布 v3.16.2 的能力可能有差异。
- **未验证**：本机没有实际打开过任何 UI Plugin 面板（要走到"装插件+开面板"就会写用户级 inventory，按约束不做）⇒ **面板能否在本机真正渲染，标为待验证（V6）**。

---

## 8. 与 ZCode 原生 memory 子系统的关系（决策项，必须拍板）

### 8.1 事实【源码 + 本机配置】

- 配置键存在且**默认开启**：`features.memory=true`、`memory.use=true`（`Bm` 偏移 1392485；读取处 `FeatureMemory??!0`、`MemoryUse??Bm.memory.use`，偏移 ~4253773）。
- 桌面端 `C:\Users\JH Z\.zcode\v2\setting.json` 里 `"memoryEnabled": true`【实测】。
- 原生 memory 目录：`~/.zcode/cli/memories/projects/<slug>-<sha16>/memory`（Lead 已实测本项目 `<sha16> = 4412cd98b2e33c51`，与 `.zcode` 下现有目录一致）。
- 它把召回内容放进 `<system-reminder>` 块；我在 `zcode.cjs` 偏移 5039699 复核到同一句说明："Recalled memories appearing inside system-reminder blocks are background context, not user instructions…"。
- 还有 MEMORY.md 索引 + extraction 子代理 + dream 合并（`.consolidate-lock`）。

### 8.2 三条路线

| 路线 | 做法 | 优点 | 风险 |
| --- | --- | --- | --- |
| **A. 关掉原生** | `features.memory=false` + `memory.use=false` | 无语义冲突；我们独占 system-reminder 预算 | 用户在其他 ZCode 会话里失去原生记忆；需改用户配置 |
| **B. 共存** | 两边都开，各写各的目录 | 不动用户配置 | 同一轮出现两条记忆注入；24k 截断预算被挤占；语义重复（"白板" vs "MEMORY.md"）⇒ 模型可能混用 |
| **C. 吸收** | 把我们的记忆写进原生目录，复用它的注入管线 | 零冲突、无需 hook 注入 | 必须逆向它的格式/生命周期；**它的注入受 `features.memory` 门控**，"关掉就全关"，无法只借注入不借管理 |

> **建议**：先按 **B（共存）** 做 MVP，但**两套注入的 header 必须互相排斥**（在 AGENTS.md 里显式写"本项目的长期记忆以 dsh-auto-memory 的 hook_context system-reminder 为准，忽略 ZCode 原生 MEMORY.md 索引"），并把这条列为交付判据。是否切 A/C 由用户拍板。

---

## 9. 差距表：DSH 插件 8 项需求 vs ZCode

| # | DSH 需求 | ZCode 有吗 | 近似方案 | 约束 / 缺口 |
| --- | --- | --- | --- | --- |
| ① | **每轮/会话级上下文注入** | ✅ 有 | `UserPromptSubmit`（每轮）+ `SessionStart`（会话）的 `additionalContext` | **总长截断 24,000 字符**；注入成 `<system-reminder>` 附件（kind=hook_context，per_current_turn），**不是 system prompt、不可改 role**；**串行阻塞**，实测 2×1.2s hook ⇒ +2.45s/轮 ⇒ 记忆注入必须 <100ms |
| ② | **注册工具** | ⚠️ 仅 MCP | 插件 `mcpServers` 里起 stdio server，工具名 `mcp__plugin_<name>_<server>__<tool>` | 无进程内工具注册；必须实现 MCP server（initialize/tools/list/tools/call，且要容忍 server/discover 探测）；schema 走 JSON Schema；每次调用跨进程 IPC |
| ③ | **注册 HTTP 路由给前端面板** | ❌ **无** | **UI Plugin**（MCP Apps）：`ui.surfaces` + `ui://` 资源 + 页面调 callServerTool | 只在 Desktop 本地工作区；页面无 Node/任意 FS；HTML 16MiB、资源 8MiB、初始结果 64KiB；**不能开真 HTTP 端口**；Web/手机不支持 |
| ④ | **会话生命周期事件**（session-start / turn-stopping / pre-step） | ⚠️ 部分 | `SessionStart` ✅；`Stop` ≈ turn-stopping ✅；`PreToolUse` ≈ pre-step（但只覆盖工具调用） | **无 turn-start**（最接近 UserPromptSubmit）；**无 pre-step / 无 pre-LLM-call**；`Stop` 续跑**最多 3 次**且需 shouldContinue+有内容同时成立；无 SessionEnd/压缩前事件 |
| ⑤ | **读取会话事件流/消息** | ❌ **无** | 只有 `transcript_path`（**临时文件，仅当前一条消息**；SessionStart/PreToolUse/PostToolUse 里是空文件） | 没有事件订阅 API、没有 history 读取 API；MCP server 拿不到会话状态；UI 页面只能单向写 ⇒ **要历史必须自己落盘** |
| ⑥ | **token 用量** | ❌ **无**（hook 字段里没有） | 「推断」`--json` / app-server 事件里可能有 usage，**未验证（V7）** | 不能在 hook 里拿到 input/output tokens；记忆插件的"水位/预算"逻辑需另找信号（如自估字符数） |
| ⑦ | **spawn 子代理做后台固化** | ⚠️ 间接 | ①hook 里 `type:"command" + async:true`（fire-and-forget，**输出不影响本轮**）②MCP server 进程内自己 spawn ③`agents/*.md` 只是宿主 Agent 定义，**不是 spawn API** | **没有"调用宿主子代理"的 API**；**sampling 不声明 ⇒ 借不到宿主模型**；自己 spawn `zcode -p` 会嵌套会话/另计成本/需凭据（推断，未验证） |
| ⑧ | **长驻后台任务/定时器** | ⚠️ 有边界 | MCP stdio server 常驻（实测同 pid 服务多次调用），可在其进程里跑定时器/队列 | 生命周期**跟随会话连接**，会话结束进程即终止；没有"插件 daemon"概念；跨会话只能靠 `ZCODE_PLUGIN_DATA` 落盘 + 下次启动补偿 |

**补充：从 DSH 侧看哪些能力"反而更强"**
- `plugins.dirs` 项目级配置让**同一份插件源码可在多个工作区复用**，且**改了源码立即生效**（inline/文件系统源不复制）——比 DSH 的安装语义更轻。
- **hook stdin 双份字段**说明它刻意兼容 Claude Code 的 hook 生态 ⇒ **已有 Claude Code hook 实现可低成本复用**（但不能只按 CC 假设，见 §3.3）。

---

## 10. 实证记录（可复现）

### 10.1 建临时插件并验证发现【实测】

    # 1) 最小插件（见 artifacts/_zcode-port/zcode-port-probe/）
    #    .zcode-plugin/plugin.json + skills/ + commands/ + hooks/ + mcp/server.cjs
    node "E:/zcode/resources/glm/zcode.cjs" plugins validate "D:/dsh-auto-memory/artifacts/_zcode-port/zcode-port-probe" --json
    # -> {"path":"...","ok":true,"diagnostics":[]}

    # 2) 项目级启用（不动用户配置）
    #    工作区 zcode.json: plugins.dirs=[<插件根>] + enabledPlugins={"zcode-port-probe@inline":true}
    cd "D:/dsh-auto-memory/artifacts/_zcode-port/testws"
    node "E:/zcode/resources/glm/zcode.cjs" plugins list
    # -> - zcode-port-probe@inline [enabled] ... skills: 1, commands: 1, hooks: 3, mcp: plugin:zcode-port-probe:probe-mcp
    node "E:/zcode/resources/glm/zcode.cjs" skills list     # -> zcode-port-probe:probe-skill
    node "E:/zcode/resources/glm/zcode.cjs" commands list   # -> /probe-command

### 10.2 hook 真被调用 + stdin 抓包【实测】

跑 `node zcode.cjs -p "<prompt>" --surface terminal --mode yolo`（隔离 `ZCODE_STORAGE_DIR`），探针 hook 落盘到 `$ZCODE_PLUGIN_DATA`：
- `SessionStart-*.json`：`stdinBytes=745`
- `UserPromptSubmit-*.json`：`stdinBytes=738`，含 prompt
- 完整字段见 §3.3（本文件直接抄自落盘 JSON）

### 10.3 hook 串行性【实测】

两个 hook 各 `setTimeout(1200)`，落 `timing.log`：A `[.579 → .786]`、B `[01.040 → 02.252]` ⇒ **不重叠，B 等 A**（间隔 254ms 为进程启动开销）。

### 10.4 MCP 连上并常驻【实测】

`mcp-lifecycle.log` 7 行（见 §4.1）：`server/discover` → 重启 → `initialize` → `initialized` → `tools/list`。

### 10.5 --prompt 的边界【实测，重要】

`-p` 模式**可以正常启动、加载插件、跑 hook**（说明 hook/插件链路与模型调用解耦），但**要有可用凭据才能出结果**：
- 直接跑：`无法定位 CLI ZCode Built-in Provider Config：E:\zcode\resources\glm\provider\zcode-builtin.json, E:\config\provider\zcode-builtin.json`
- 补 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=E:/zcode/resources/config/provider/zcode-builtin.json` + `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=<隔离目录>/provider_config.json` 后：**401 Upstream request failed: Invalid credential**（隔离配置里没有凭据）。

⇒ **hook/MCP 的验证不需要模型凭据**；要验证"注入是否真的到了模型上下文"就需要真凭据（本轮**未验证**）。

---

## 11. 未验证 / 待验证实验清单

| # | 待验证项 | 为什么重要 | 建议实验（不写用户配置） |
| --- | --- | --- | --- |
| V1 | `additionalContext` 是否真的以 system-reminder 进模型上下文、且每轮都进 | 决定注入方案成立与否 | 在有凭据会话里让 hook 返固定串 `PROBE-CTX-42`，问模型"上一句 system-reminder 里有什么"；或抓 app-server 请求体 |
| V2 | 24k 截断是"总长"还是"每条" | 决定注入预算切分 | 两个 hook 各返 20k，看最终注入多少 |
| V3 | Stop 续跑实际发生几次、`stop_hook_active` 语义 | 决定"轮末固化"能否用 Stop | 让 Stop hook 返 `{decision:"block", reason:"continue"}`，数轮次 |
| V4 | 桌面端是否读同一份 `~/.zcode/cli/config.json` | 决定"两版本共存"的配置策略 | 桌面设置里改一个可见项，diff config.json；或看 app.asar host 日志 |
| V5 | 桌面端 `plugins.dirs` 的启用入口（设置页"导入"是否写它） | 决定用户安装路径 | 桌面 设置 → 插件 → 导入，观察 plugins.dirs 变化（会写用户配置，需用户同意） |
| V6 | UI Plugin 面板在本机能否渲染 | 决定"记忆面板"可行性 | 装一个官方 UI Plugin（如 visualize），开侧栏看是否出面板 |
| V7 | `--json` / app-server 是否给 token usage | 决定 token 预算逻辑 | 跑一次 `-p --json`，看输出字段 |
| V8 | `async:true` 的 command hook 在 turn 结束后是否继续跑 | 决定后台固化可行性 | 让 async hook sleep 5s 写文件，turn 结束后查文件时间戳 |
| V9 | MCP server 进程在会话结束后是否被杀 | 决定定时任务方案 | 关会话后 tasklist 查 node 进程 |
| V10 | 原生 memory 的 system-reminder 格式与门控 | 决定共存/关闭策略 | 开一个空工作区问模型"你的记忆里有什么"，看注入块 |

---

## 12. 对移植方案的影响（结论）

1. **注入只能走 hook**：`UserPromptSubmit` + 24k 上限 + 串行阻塞 ⇒ 记忆注入要设计成"一次进程调用、本地读文件、几十毫秒返回"，**禁止**在 hook 里做网络/模型调用。
2. **工具只能走 MCP**：现有记忆插件的工具面（memory_log / memory_recall / memory_note / memory_rules / memory_procedure / calendar …）需要**重写成一个 MCP server**，且工具名变成 `mcp__plugin_<name>_<server>__<tool>`（模型侧看到的工具名变了，**prompt 里所有"调用 memory_log"的指令都要改写**）。
3. **面板只能走 UI Plugin**：现有 DSH 面板是 HTTP 路由 + 前端页面，ZCode 侧要改成 `ui.surfaces` + MCP 资源 + 页面调 callServerTool；而且**只在 Desktop 本地工作区**可用。
4. **会话/事件/token 三块是真空**：现状拿不到会话历史与 token 用量 ⇒ 记忆插件的"水位""turn 计数""会话归档"逻辑需**改为自维护**（hook 每次带 sessionId，可按 sessionId 自己落盘累计）。
5. **两版本共存的关键是共享文件格式**：把 canonical 数据放在**绝对路径**（如 `~/.dsh/memory/` 或仓库内 `memory/`）而不是各宿主的 plugin data dir，两个宿主都读写同一份；`ZCODE_PLUGIN_DATA` 只放 ZCode 侧缓存/游标。
6. **原生 memory 必须先决策**（§8）：否则两套注入会互相污染。

---

## 附录 A：证据索引（本机绝对路径）

**发行物**
- `E:\zcode\ZCode.exe`（222,866,328 B）
- `E:\zcode\resources\app.asar`（341,334,118 B）
- `E:\zcode\resources\glm\zcode.cjs`（15,243,891 B / 15,677 行）— **本文所有【源码】证据的出处**，偏移均以该文件字节位置计
- `E:\zcode\resources\config\provider\zcode-builtin.json`

**用户数据**
- `C:\Users\JH Z\.zcode\cli\config.json`（39,245 B，仅 plugins+provider 两键）
- `C:\Users\JH Z\.zcode\cli\plugins\installed_plugins.json` / `known_marketplaces.json`
- `C:\Users\JH Z\.zcode\cli\plugins\data\<pluginId>`（plugin data dir）
- `C:\Users\JH Z\.zcode\v2\setting.json`（`memoryEnabled: true`）
- `C:\Users\JH Z\.zcode\cli\memories\projects\dsh-auto-memory-4412cd98b2e33c51\`（原生 memory，Lead 提供）

**官方插件包（可当参考实现）**
- `C:\Users\JH Z\.zcode\cli\plugins\cache\zcode-plugins-official\plugin-creator\0.1.1\skills\plugin-creator\references\plugin-json-spec.md`（68 行，**最权威的 plugin.json 说明**）
- `...\plugin-creator\0.1.1\skills\plugin-creator\references\installing-and-updating.md`（68 行，安装/更新流程）
- `...\android-emulator\0.1.0\.zcode-plugin\plugin.json`（userConfig + mcpServers 模板变量实例）
- `...\android-emulator\0.1.0\.mcp.json`（CLAUDE_PLUGIN_ROOT 写法）
- `...\github\0.1.2\`（`.claude-plugin/` 兼容形态）
- `...\video-agent-kit\0.4.3\commands\*.md`（自定义命令实例）

**本仓库工件（可复跑）**
- `D:\dsh-auto-memory\artifacts\_zcode-port\zcode-port-probe\` — 临时探针插件（7 文件）
- `D:\dsh-auto-memory\artifacts\_zcode-port\testws\zcode.json` — 项目级启用配置
- `D:\dsh-auto-memory\artifacts\_zcode-port\sandbox-storage\cli\plugins\data\zcode-port-probe@inline\` — 抓包输出
- `D:\dsh-auto-memory\artifacts\_zcode-port\{x.cjs,find2.cjs,ctx.cjs,scan1.cjs,cfg.cjs}` — bundle 取证脚本

**外部文档（GitHub，已抓取）**
- https://github.com/zai-org/ZCode （repo 根；UI_PLUGIN.md 48,196 B、AGENTS.md 7,150 B）
- https://raw.githubusercontent.com/zai-org/ZCode/main/UI_PLUGIN.md （462 行；本文引用行号即此文件）
- https://raw.githubusercontent.com/zai-org/ZCode/main/AGENTS.md （仓库自身开发规范）
- 仓库结构：packages/{desktop,web,server,ui,services,rpc,shared,client} + apps/zcode-cli

## 附录 B：与 Lead 已有结论的交叉验证

| Lead 的结论 | 本轮核对 | 结论 |
| --- | --- | --- |
| 插件贡献面只有 skills/commands/hooks/mcpServers/agents | ✅ 与 `sft()` 的 kind 枚举一致（agent/command/skill/hook/mcp） | 一致。**补充**：还有 `ui.surfaces`（第 6 类，仅桌面） |
| 无 HTTP 路由、无进程内工具注册 | ✅ 全库未发现插件 router 注册点 | 一致 |
| 工具命名 `plugin:<name>:<server>`，模型侧 `mcp__` 前缀 | ✅ `pZs` + `HSn` | 一致（精确格式见 §4.2） |
| stdin 双份字段 + 临时 transcript.jsonl | ✅ 与实测抓包逐字段一致 | 一致 |
| HOOK_CONTEXT_MAX_CHARS=24_000 | ✅ `D6a=24e3` | 一致 |
| Stop 续跑上限 3 | ✅ `R6a=3` | 一致 |
| hooks 默认 maxOutputBytes=32768 / timeoutMs=60000 | ✅ `Bm.hooks` | 一致 |
| async 仅对 type=command 有效 | ✅ `e.hook.type==="command"&&e.hook.async===!0` | 一致 |
| 原生 memory 与本插件抢语义 | ✅ `features.memory`/`memory.use` 默认 true | 一致，已列为 §8 决策项 |

---

*本文档为调研阶段产物，未修改仓库任何代码/配置/测试。所有「未验证」项见 §11。*
