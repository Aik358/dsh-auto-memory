# dsh-auto-memory 移植到 ZCode 总方案（00 · 主计划）

> 立项日期：2026-10-22 ｜ 阶段：**调研完成、方案待拍板、未写一行实现代码**
> 调研对象：DSH 侧 D:\dsh-auto-memory（工作树 HEAD `ef581df`，v3.3.16）；ZCode 侧本机 Desktop **v3.16.2**（`E:\zcode`）+ 随包 CLI **0.17.0**（`E:\zcode\resources\glm\zcode.cjs`）
> 证据文档：`01-zcode-host-surface.md`（ZCode 扩展面，713 行）、`02-dsh-coupling-map.md`（DSH 耦合测绘，640 行）、`03-shared-store-coexist.md`（共享存储与共存设计，660 行）
> 纪律：本方案**只出设计**。用户既有裁定「对自研插件的改动须等统一指示后一并执行，调查阶段只出方案、不得先行改代码」仍然有效——§5 的 DSH 侧改动全部是「待批准后执行」。

---

## 0. 一页结论

**能移植。但不是把插件改成 ZCode 插件，而是把引擎抽出来做成本机服务，两个宿主各配一个薄适配器。**

| 结论 | 一句话 |
|---|---|
| 可移植比例 | `lib/` 下 113 个模块 / 75,210 行中，**94 个模块 / 27,475 行（36.5%）零改动可 import**；再加 13 个模块 / 4,930 行加适配层可用 ⇒ **引擎层 45.6% 可移植** |
| 必须重写 | `lib/index.js`（21,141 行，DSH 宿主壳）+ `lib/client.js`（19,740 行，DSH 浏览器 bundle）= 40,881 行，**54.4% 与 DSH 宿主强绑定** |
| ZCode 侧新增 | 约 **1,400–2,000 行**（hook 注入器 + MCP server + AGENTS 片段 + 少量胶水），不含复用部分 |
| 共存方式 | **一套记忆文件（沿用 `~/.dsh/memory`，不搬家）+ 单写者租约（leader）+ 写代理**；非 leader 只读 + 代理写 |
| 最大硬阻塞 | ZCode 插件**无 HTTP 路由、无进程内工具注册、读不到会话历史、拿不到 token 用量** ⇒ 面板须重做（UI Plugin，仅 Desktop）、工具只能走 MCP、会话历史须自落盘 |
| 最大隐藏坑 | DSH 文档锁实际落在 `<doc>.lock.lock`（双后缀，已复核：`memory-writer.js:478` 传 `filePath + '.lock'`，`shared-state-lock.js:94` 再拼 `.lock`），而 PLAN / 日历 / 配置 / 状态锁是单后缀 `.lock` ⇒ **两种后缀并存**，ZCode 照注释实现就会绕过互斥 |
| 建议节奏 | **P0 只读共存 → P1 引擎单实例 + 写代理 → P2 面板 → P3 清理**；P0 就能让 ZCode 用上同一套记忆，且**不写一个字节** |

**架构一句话**：DSH 与 ZCode 共享同一套记忆文件；同一时刻只有一个「引擎宿主」持 leader 租约、负责全部写与后台任务；另一个宿主降级为只读 + 代理写。

```text
    ┌─────────────── 共享记忆库（唯一真源，文件） ───────────────┐
    │  ~/.dsh/memory/  MEMORY.md CALENDAR.md workspaces/ index/ hub/ ... │
    └──────────────▲────────────────────────────▲──────────────┘
                   │ 读写（leader）               │ 只读（client）
    ┌──────────────┴───────────┐   ┌────────────┴───────────────┐
    │ 引擎宿主 engine-host      │   │ ZCode 薄适配器              │
    │ (独立 node 进程 / DSH 进程内)│◄──┤ hook 注入器 / MCP stdio     │
    │ 持 leader 租约 + tick 循环 │HTTP│ / AGENTS.md 静态纪律        │
    └──────────────▲───────────┘   └────────────▲───────────────┘
                   │                            │
              DSH Web/桌面                  ZCode Desktop/CLI
```

---

## 1. 需求还原：要移植的六块能力

用户原话三要素：**① 移植到 ZCode；② 两版本共存；③ 两宿主可同时运行、互不干扰、共享一套记忆文件。**

| # | 能力 | DSH 现状 | ZCode 可行性 | 结论 |
|---|---|---|---|---|
| C1 | 每轮上下文注入（规则段 / 目录层 / 今日日志 / 白板账本摘要） | `ctx.systemPrompt.section()`（静态字节稳定）+ `ctx.systemPrompt.context()`（动态快照）+ `agent/pre-step` waterfall | `SessionStart` hook `additionalContext`（每会话）+ `UserPromptSubmit` hook `additionalContext`（每轮，进 `<system-reminder>` 附件） | 可做。**总长硬截 24,000 字符**；hook **严格串行阻塞**（实测两个 1.2s hook = +2.45s/轮）⇒ 注入必须 <100ms |
| C2 | 工具面（**19 个**：15 `memory_*` + 4 `calendar_*`） | `ctx.tools.register` 进程内注册 | 只能 MCP stdio server；模型侧名 `mcp__plugin_<plugin>_<server>__<tool>` | 可做，但**全部工具须重打包成 MCP**（`defineTool` 的参数描述已是 JSON-Schema 风格，转换成本低） |
| C3 | 面板（记忆 / 接续 / 看板 / 设置，19,740 行） | 73 条 loopback HTTP 路由 + `__ModuleLoader__` bundle | 无插件 HTTP 路由；只能 UI Plugin（MCP Apps：`ui.surfaces` + `ui://` 资源 + 页面调 MCP 工具），**仅 Desktop 本地工作区** | 可做但**整块重写**（推断 ≈19,700 行）；Web / 手机 / 远程工作区无面板 |
| C4 | 会话生命周期（session-start / turn-stopping / pre-step） | `ctx.on('agent/*')` + `session/event` + `tools/result` | `SessionStart` 有；`Stop` ≈ turn-stopping；`PreToolUse` 部分替代 pre-step；**无 turn-start / 无 pre-LLM-call / 无 SessionEnd / 无压缩前事件** | 需重组语义 |
| C5 | 会话内容与 token 用量 | `session/event` 事件流 + `tokenMeter` | **都没有**。hook 只给当前一条消息（`transcript.jsonl` 只含当前消息，且除 Stop / UPS 外是空文件）；`Stop` 给 `last_assistant_message` | 必须**自己落盘**：hooks 写事件 JSONL → 自建 session 视图；token 改自估或砍掉水位 |
| C6 | 后台固化 / 索引维护 / 子代理 | `ctx.subagents.startActivation` + 6 个 `setInterval` | MCP stdio server 可常驻但**随会话死**；`async:true` 仅对 `type:command` 且输出不参与本轮；**MCP 客户端不声明 sampling ⇒ 借不到宿主模型** | 后台 AI 提炼须由**独立进程 + 自己的模型凭据**跑，或降级为确定性沉淀 |

**⇒ 第一条硬决策**：ZCode 侧不能做成「插件内自带全部逻辑」（会随会话死、借不到模型）。必须把引擎做成**本机常驻进程**，插件只做薄适配。这同时是 DSH 侧唯一不需要重写引擎的形态。

---

## 2. 目标架构：一套引擎、两个宿主、一个真源

### 2.1 五层模型

| 层 | 内容 | 归属 | 改动量 |
|---|---|---|---|
| **L0 记忆库** | `<DSH_HOME>/memory/`（用户级 MEMORY.md / CALENDAR.md / workspaces/<wsKey>/ …）+ `<ws>/.dsh-memory/`（可配置为绝对路径） | 两宿主共享 | **零改动**（沿用现有布局） |
| **L1 引擎核心** | 94 个 A 模块（无宿主耦合）+ 13 个 B 模块（路径 / 接缝适配） | DSH 仓库 `lib/`，两宿主共用同一份源码 | A 堆**零改动**；B 堆 13 个模块改为可注入根路径 |
| **L2 引擎宿主** | 持有 `MemoryEngine`、跑 tick 循环、持 leader 租约、暴露本机 HTTP JSON-RPC | 新模块（DSH 仓库内新增，DSH / ZCode 共用） | **新增 ~600–900 行**；DSH 侧 `apply()` 改为调用它（接线，非重写） |
| **L3 宿主适配器** | DSH：现有 `apply()`（73 路由 + 19 工具 + 3 注入面）基本不动；ZCode：`zcode-plugin/`（plugin.json + hooks + MCP） | 各自 | DSH ≈0；ZCode **新增 1,400–2,000 行** |
| **L4 界面** | DSH 面板不动；ZCode 可选 UI Plugin（P2） | 各自 | ZCode 面板重写（P2，非 MVP） |

### 2.2 进程模型（推荐：守护进程 + 薄适配）

```text
ZCode Desktop / CLI
  ├─ hooks/UserPromptSubmit → node hook.cjs（<100ms：读注入缓存文件 → 打印 additionalContext）
  ├─ hooks/SessionStart      → node hook.cjs（静态纪律 + 目录层，进会话历史）
  ├─ hooks/Stop              → node hook.cjs（落盘本轮 prompt+assistant，异步触发沉淀）
  ├─ MCP stdio server        → node mcp-server.cjs（tools/list、tools/call → 转发引擎宿主 HTTP）
  └─ AGENTS.md 片段（可选）   → 静态使用纪律（无 24k 限制、可版本化）

引擎宿主 engine-host（独立 node 进程，单例）：
  ├─ import lib/ 的 A+B 模块，new MemoryEngine()
  ├─ 15s tick：沉淀队列 / 索引维护 / 归档巡检 / 团队 outbox / 蒸馏调度
  ├─ 持 memory/lease.json 的 leader 租约（TTL 45s、抢占 135s、epoch、优雅交接）
  └─ 监听 127.0.0.1:<随机端口>，token 鉴权：/health /inject /recall /tool/<name> /state

DSH 侧：apply() 里的引擎实例若先启动即为 leader；否则降级 client（读文件 + 代理写）。
```

**为什么 hook 不能直接跑引擎**：hook 每轮被 spawn（每次 `mkdtemp` 建临时目录、冷启动实测 ~100–250ms 起），若在 hook 内 import 引擎并计算注入，单轮延迟会到数百毫秒甚至秒级，且严格串行、直接卡在用户发消息之后。⇒ **hook 只做「读缓存 + 打印」**，缓存由引擎宿主预生成。

### 2.3 一轮对话的数据流

1. 用户发消息 → ZCode 触发 `UserPromptSubmit` hook（stdin 实测 738 B，含 `prompt` / `session_id` / `cwd` / `turnId`）
2. `hook.cjs` 读 `<cacheDir>/inject/<sessionId>.json`（引擎宿主预生成：Tier-0 目录 + 今日日志 + 白板账本摘要 + 规则段），缺失则冷算一次并写回；输出 `hookSpecificOutput.additionalContext`（**≤24,000 字符**）
3. ZCode 把 `additionalContext` 作为 `<system-reminder>`（kind=`hook_context`，per_current_turn）注入本次请求
4. 模型调用 `mcp__<plugin>__memory_recall` 等 → MCP server → 引擎宿主 HTTP → 返回
5. 轮次结束 `Stop` hook：追加本轮事件到 `<cacheDir>/sessions/<sessionId>.jsonl`，并 fire-and-forget 触发 `consolidate(sessionId, turn)`（幂等键去重）
6. 引擎宿主异步：自动沉淀（写今日日志）→ 更新笔记 / 技能 / 白板候选 → 重建索引 → **预生成下一轮注入缓存**

> DSH 侧完全不变：`agent/pre-step` + `systemPrompt` 三注入面照旧，只是引擎实例由 L2 提供。
---

## 3. 两版本共存机制（核心）

### 3.1 一号风险：锁文件路径必须逐字节对齐

| 调用方 | 传给 acquire 的路径 | 实际锁文件 | 实际门 |
|---|---|---|---|
| `memory-writer._withDocLock`（`:478`，记忆文档 append / replace） | `filePath + '.lock'` | **`<doc>.lock.lock`** | `<doc>.lock.lock.acquire` |
| `engine._withDocumentLockPre`（`index.js:8824`） | `file + '.lock'` | **`<doc>.lock.lock`** | 同上 |
| PLAN / CALENDAR / 配置 / 状态文件 | 文件本身 | `<doc>.lock` | `<doc>.lock.acquire` |

⇒ **ZCode 侧必须照抄这张表**（而不是照注释）。中期建议 DSH 侧修双后缀（`:478` / `:8824` 去掉 `+ '.lock'`），并做**兼容期双锁**（先锁 `.lock`，再试 `.lock.lock`，两者都拿到才写，释放逆序），否则新旧版本会互相绕过。

### 3.2 单写者租约（leader lease）

- 文件：`<DSH_HOME>/memory/lease.json`。**不复用** `polling-heartbeat.json` 的读写路径（后者无锁、非原子写），但**复用其 `{pid, startedAt}` 身份口径与 `ACTIVE_MS = 90s`**。
- 字段：`schemaVersion / leaseId / role(leader|client|released) / host{kind,hostname,pid,startedAt,instanceId} / epoch / acquiredAt / renewedAt / ttlMs=45000 / stealAfterMs=135000`。
- 规则：15s 续期（**锁内**「重读 → 校验仍是 leader → 写」）；`now - renewedAt > 135s` 或本机 pid `ESRCH` ⇒ 抢占并 `epoch+1`；SIGTERM / dispose 写 `role=released` 优雅交接。
- 必须收进 leader 的 10 项后台动作：自动沉淀、hubFeed、语义引擎 / 索引同步、子代理 GC、自动接续、团队同步 flush + pull、定时蒸馏固化、索引重建、workbench 轮换、会话归档巡检。

### 3.3 幂等去重（两宿主对同一 turn 都可能触发沉淀）

```text
idemKey = sha256( 'consolidate/v1\0' + hostKind + '\0' + sessionId + '\0' + turn
                  + '\0' + sha256(userText) + '\0' + sha256(assistantText) + '\0' + version )
```

- 认领：`openSync('<DSH_HOME>/memory/consolidation-ledger/<idemKey>.json', 'wx')`；抢到写 `{status:'writing', host, pid, at}` → 写完改 `done` → 失败 `failed`（10min 后可重试）。
- 抢不到：读状态，`writing` 且未过期 ⇒ 让行；`done` ⇒ 让行。
- **只由 leader 执行**；client 把待固化内容投 `memory/consolidation-inbox/<idemKey>.json`（`wx` 天然去重）。
- 人可读留痕：日志段追加 `<!-- dsh-am:idem=<前16hex> -->`。

### 3.4 配置分层

| 文件 | 内容 | 写者 |
|---|---|---|
| `<DSH_HOME>/dsh-auto-memory.json`（**现有，不动**） | 现有 160 键配置，逐字节兼容 | leader（走 DSH `saveConfig` 事务） |
| `<DSH_HOME>/memory/config/core.json`（新增，可选） | 共享核心键白名单：`memoryRoot / userMemoryDir / projectMemoryDir / noteCapacityChars / userCapacityChars / autoConsolidate* / consolidateSchedule* / handoffEnabled / boardMode` | 只 leader |
| `<DSH_HOME>/memory/config/hosts/<hostId>.json`（新增） | 宿主私有：`kind / instanceId / skin* / layout / subagentModel / waterLevel* / panelAllowedHosts / externalSources / team*` | 各写各的（`config-lock`） |
| `<DSH_HOME>/memory/.store-version`（新增） | `{schemaVersion, storeId, hosts, roots}` | 只 leader；解析不一致 ⇒ **拒绝写，只读降级** |

优先级：`core` < `hosts/<id>` < 环境变量 < 命令行 override。**不做一次性迁移**（迁移会撞 `migrateSettingsTree` 根变更窗口，风险大于收益）。

### 3.5 记忆根目录：沿用现有，不搬家

**推荐 A：`~/.dsh/memory` 为唯一真源。** 理由：
1. 存量 770 个工作区目录 + 用户级文件**零迁移**；
2. ZCode 原生记忆根是 `~/.zcode/cli/memories/projects/<slug>-<sha16>/memory`（本机实测本项目 `sha16 = 4412cd98b2e33c51`），目录名有损且不可逆 ⇒ **两套命名无法对齐，禁止双写**；
3. **B 方案（中立根 `~/.auto-memory` + junction / symlink）不可行**：DSH 三处显式拒绝 symlink（`shared-state-lock.js:91`、`config-lock.js:19`、`settings-safety.js:150`），junction 一旦指过去所有写入 fail-closed。

---

## 4. ZCode 侧适配面（要写的代码）

### 4.1 插件骨架

```text
zcode-plugin/
  .zcode-plugin/plugin.json      # name / version / skills / commands / hooks / mcpServers（+ 可选 ui.surfaces）
  hooks/hooks.json               # SessionStart / UserPromptSubmit / Stop 三个事件，各 1 条 process hook
  hooks/hook.cjs                 # 薄注入器（<250 行）
  mcp/server.cjs                 # MCP stdio server（~300–500 行）
  skills/memory-usage/SKILL.md   # 使用纪律（按需加载，长文放这里，不占 24k 注入预算）
  commands/memory.md             # /memory 快捷指令（可选）
  AGENTS.snippet.md              # 可选：静态纪律片段
```

**免 GUI 启用的实测路径（不写用户配置）**：工作区根 `zcode.json`：

```json
{ "plugins": { "enabled": true,
               "dirs": ["D:/path/to/zcode-plugin"],
               "enabledPlugins": { "<pluginName>@inline": true } } }
```

> `dirs` 的每一项是**插件根本身**，不是父目录（实测传父目录发现 0 个插件）。已在 `artifacts/_zcode-port/testws/zcode.json` 实测 plugins / skills / commands 三处都认出。

### 4.2 三个 hook 的职责与预算

| 事件 | stdin 实测 | 职责 | 延迟预算 |
|---|---|---|---|
| `SessionStart`（source = startup / resume / clear / compact） | 745 B | 输出**静态纪律**（工具名映射后的使用规则）+ 目录层；每会话一次 | <100ms |
| `UserPromptSubmit` | 738 B | 输出**动态记忆**：Tier-0 目录 + 今日日志 + 白板 / 账本摘要 + 规则段（**总长 ≤24,000 字符**，建议压 6–8k，与 DSH `injectBudgetChars=8000` 对齐） | **<100ms（硬指标）** |
| `Stop` | 含 `last_assistant_message`、`stop_hook_active`、`toolCallCount` | ① 落盘本轮事件 ② fire-and-forget 触发沉淀 ③ **不要**返回 `decision:block`（那会触发 Stop 续跑，最多 3 次） | <200ms（不阻塞下一轮） |

**注意**：ZCode hook **严格串行**（实测 B 等 A 结束），所以每个事件**只能注册一条 hook**，且热路径禁止网络调用。

### 4.3 MCP server（工具面）

- JSON-RPC stdio；必须容忍启动时的 `server/discover` 探测（不认就回 `-32601`，实测可降级继续 `initialize`）
- 工具名映射：DSH `memory_log` → 模型侧 `mcp__plugin_<pluginName>_<serverKey>__memory_log`（净化规则：非 `[A-Za-z0-9_-]` → `_`）
- **所有提示词 / AGENTS.md / skill 里提到工具名的地方都要改成新名**，否则模型会调不存在的 `memory_log`
- 工具 schema：`defineTool(name, description, params, fn)` 的 `params` 已是 JSON-Schema 风格，转换成本很低
- 执行：转发到引擎宿主 HTTP `POST /tool/<name>`，由 leader 执行 ⇒ **ZCode 侧不需要复制一套写入逻辑**
- 无 sampling ⇒ 需要「模型参与」的功能（AI 提炼、语义判定）要么由引擎宿主用**自己的模型配置**跑，要么降级 / 关闭

### 4.4 面板（P2，可选）

- `ui.surfaces` + `ui://` 资源 + `text/html;profile=mcp-app`
- 页面能力：`callServerTool` / `readServerResource` / `updateModelContext` / `sendMessage` / `createSamplingMessage` / `requestDisplayMode(fullscreen = 侧栏)`
- 硬约束：**仅 Desktop 本地工作区**；页面无 Node / FS；HTML ≤16 MiB、初始 structuredContent ≤64 KiB
- 结论：P2 只做「记忆浏览 + 接续查看 + 白板账本只读」三面，**设置页不做**（改配置文件或由 DSH 面板改）

---

## 5. DSH 侧最小改造集（待批准后执行）

| # | 改动 | 规模 | 风险 | 说明 |
|---|---|---|---|---|
| D1 | `export { MemoryEngine }`（`lib/index.js:2364` 类当前 module-private） | 1 行 | 极低 | 让 ZCode 侧 / 独立 daemon 能 import |
| D2 | 抽出 `lib/engine-boot.js`：`createEngineHost({ dshHome, config })` = `new MemoryEngine()` + `loadConfig` + tick 循环 + lease；`apply()` 改为调用它 | 新增 ~600–900 行；`apply()` 内 ~80 行改为接线 | **中高** | 必须保持 DSH 行为逐字节不变，需全量回归 |
| D3 | `lib/host-shim.js`：伪造 `ctx` 形状（`get / on / effect / systemPrompt / tools`），6 个服务返回 `undefined` 即降级不崩 | ~200–400 行 | 中 | 让引擎在无 DSH 服务时跑核心链路 |
| D4 | 修 `.lock.lock` 双后缀 + 兼容期双锁 | ~30 行 | **高（数据安全）** | 必须配两进程并发 append 400 条的跨进程回归 |
| D5 | 补锁：`writeFullRaw` 非 CALENDAR 支、`hub/episodes.json`、`team/pull-cursor.json`、`recall-stats.json` 固定 tmp 名、心跳读-合并-写 | ~120 行 | 中 | 双宿主最先出事的一批 |
| D6 | 新增 1–2 条受控写路由（若走 A 形态代理写） | ~80 行 | 低 | 现有 73 路由无「写任意记忆文件」入口 |

> **原则**：D1–D6 全部是「让引擎可被第二个宿主复用」的必要条件，**不改任何现有功能语义**。按用户裁定，等统一指示后一次性执行，并跑全量回归（当前基线 PASS 442 / FAIL 0 / TIMEOUT 0）。

---

## 6. 功能保留 / 降级 / 砍掉（ZCode 侧）

| 功能 | ZCode 处置 | 说明 |
|---|---|---|
| 三层注入（规则段 / 目录 / 日志 / 白板账本） | **保留（P0）** | SessionStart 静态 + UserPromptSubmit 动态；总长 ≤24k |
| 19 个工具 | **保留（P0，包装成 MCP）** | 工具名变化，提示词须同步改写 |
| memory_recall 检索（词法 / 三层） | **保留** | 引擎宿主执行 |
| 语义检索（JS / Python 引擎） | **P1，仅 leader 跑** | 客户端不跑，避免双开截断 |
| 自动沉淀（turn-stopping） | **P1**（需自建 session 事件落盘） | Stop hook + 幂等键 |
| 每日反思 / 蒸馏 / 固化调度 | **P1**（leader 侧定时器） | ZCode 侧无常驻定时器，由引擎宿主承担 |
| 白板 / 交接账本 / 技能库 | **保留**（工具 + 注入） | |
| 看板 / 面板 | **P2**（UI Plugin 重写，仅 Desktop） | DSH 面板不动 |
| 团队同步（outbox / pull） | **P1**（leader 单写） | 需补 `pull-cursor` 锁 |
| 自动接续（water level + 建新会话） | **砍掉** | 依赖 `sessionController`，ZCode 无对应；token 用量也拿不到 |
| 工作台（会话 / 轮换 / 接管） | **砍掉** | 依赖 `sessionController + workspaceRegistry + permissionPresets` 三服务 |
| 子代理后台固化（spawn DSH subagent） | 替换为「引擎宿主自己的模型调用」或降级为确定性沉淀 | ZCode 无 spawn API、MCP 无 sampling |
| 皮肤 / 布局 | P2（若做面板） | 宿主私有配置 |
| 外部记忆继承（WorkBuddy / Claude / ZCode 等） | **保留**（引擎内纯逻辑） | 顺带可读 ZCode 自己的 memories 目录 |
---

## 7. 分阶段路线与验收

| 阶段 | 交付 | 验收（含负路径） |
|---|---|---|
| **P0 只读共存** | ZCode 插件骨架 + 三个 hook + MCP（**只读工具**：`memory_recall` / `memory_read` / `memory_status` / `memory_procedure_list`）+ AGENTS 片段 | ① 在 ZCode 会话里注入到同一份目录层 / 今日日志（与 DSH 面板显示逐字节一致）<br>② `memory_recall` 返回与 DSH 相同命中<br>③ **负路径**：断开写入后，ZCode 任何工具都不得产生新文件（mtime 不变）<br>④ hook 延迟 P95 < 100ms（真测 20 轮）<br>⑤ 注入长度 < 24k 且**不被截断**（对比 cache 文件字节数） |
| **P1 引擎单实例 + 写代理** | `engine-host` daemon + `lease.json` + 幂等 ledger + MCP 写工具代理 | ① 双宿主同时运行 ⇒ 恰 1 个 leader（`lease.json` 的 `role`）<br>② `kill -9` leader ⇒ 135s 内接管，期间**无双 leader**<br>③ 同一 session/turn 在两宿主各触发一次 ⇒ 日志只多 1 段<br>④ 两进程各 append 200 条 ⇒ 读回 400 条（含 `.lock.lock` 对齐）<br>⑤ **负路径**：故意只锁 `.lock` ⇒ 断言丢条目（证伪保护） |
| **P2 ZCode 面板** | UI Plugin：记忆浏览 / 接续 / 白板账本只读 | ① Desktop 本地工作区能打开侧栏并渲染（本机未验证，见 §10 V5）<br>② Web / 手机打开退化不报错<br>③ **负路径**：页面不得直读文件系统（尝试 fetch 本地路径必失败） |
| **P3 清理与收口** | D4 / D5 修锁、core+hosts 配置分层、`.store-version` 闸 | ① 双宿主并发写无丢条目 ② 根迁移窗口内客户端收到 409 且不落旧根 ③ **负路径回滚**：删除 `.store-version` 回到现状 |

> **P0 的商业价值最高、风险为零**：ZCode 只读同一套记忆（注入 + 检索），不写一个字节。建议先只做 P0，跑一周观察，再决定是否进 P1。

---

## 8. 风险登记册（Top 10）

| # | 风险 | 触发条件 | 后果 | 对策 |
|---|---|---|---|---|
| R1 | 锁后缀不匹配（`.lock` vs `.lock.lock`） | ZCode 侧照注释实现 | 记忆文档并发覆盖、丢条目 | 照 §3.1 表逐条对齐；P3 修 DSH 双后缀 |
| R2 | hook 阻塞导致体验崩 | 注入路径做网络 / 模型调用 | 每轮 +数百 ms 到数秒 | 只读缓存；P95 < 100ms 硬指标；热路径禁止 await 网络 |
| R3 | 24k 截断吃掉规则段 | 注入预算超限 | 规则不完整 → 模型不遵守 | 静态纪律走 SessionStart / AGENTS.md；动态注入自限 6–8k；截断检测告警 |
| R4 | 自动沉淀双写 | 两宿主都触发 turn-stopping | 日志重复段、笔记覆盖 | leader 租约 + 幂等键 + 只 leader 写 |
| R5 | 引擎身份跨宿主不一致 | `weightsDigestOfFilePre` 用 `size:mtime:name` | L0 索引反复重建 | ZCode 复用 leader 算的 engineIdentity，不自己算 |
| R6 | 原生 memory 与本插件抢语义 | `features.memory` / `memory.use` 默认 true | 两套 system-reminder 挤 24k、模型混用 | 待拍板（Q2）：装插件时关原生；AGENTS.md 声明权威来源 |
| R7 | 工具名变化导致提示词失效 | 提示词里仍写 `memory_log` | 模型调不存在的工具 | 全量改写提示词 + skill 统一用新名；MCP 侧工具名尽量保持不变（只变命名空间） |
| R8 | 面板重建体量爆炸 | 一次性重写 19,700 行 | 长期无法交付 | 只做 P2 三个面；设置项不做；分页签增量 |
| R9 | DSH 重构破坏现网 | D2 抽 `engine-boot` 改动 `apply()` | 442 用例回归可能红 | 分步：先 export + shim，再抽 boot；每步全量回归 + 变异验证 |
| R10 | ZCode 版本升级打碎契约 | 桌面自动更新（本机已见 3.16.2） | hook / MCP 契约漂移 | 契约探测写进 `/health`；插件里记录实测到的 ZCode 版本；文档标注契约来源版本 |

---

## 9. 待用户拍板（决策清单）

| # | 决策 | 选项 | 建议 |
|---|---|---|---|
| **Q1** | 共存形态 | A：两宿主各跑一套引擎、只共享文件（简单但双写风险）<br>**B：单引擎 + 双适配器（leader / client）** | **B** |
| **Q2** | ZCode 原生 memory | ① 保持开启（共存） ② 装插件时关闭（`features.memory=false` + `memory.use=false`） ③ 吸收进原生目录 | **②**：两套 system-reminder 抢 24k、语义重复（「白板」vs「MEMORY.md」），且原生目录名有损不可对齐 |
| **Q3** | 记忆根 | A：沿用 `~/.dsh/memory`（不搬家）<br>B：中立根 `~/.auto-memory` | **A**；B 已论证与 DSH 的 symlink 拒绝冲突 |
| **Q4** | 面板优先级 | ① P2 全量重建 ② 只读三面 ③ 完全不做 | **②**（浏览 / 接续 / 白板），设置项不做 |
| **Q5** | 自动接续 / 工作台 | ① 移植 ② 砍掉 | **砍掉**（ZCode 无 `sessionController` / `tokenMeter`） |
| **Q6** | DSH 侧 D1–D6 | ① 全部执行 ② 只做 D1 / D3 / D4 / D5，D2 延后 ③ 都不做（ZCode 侧独立实现） | **②**；③ 会让引擎代码两套漂移，不推荐 |
| **Q7** | 发布形态 | ① 同一 npm 包加 `zcode/` 子目录 ② 独立包 `@a9i5k4/zcode-auto-memory` ③ 仓库内 `zcode-plugin/` 不单独发 | **②或③**（ZCode 插件是「目录 + plugin.json」，独立分发更干净） |

---

## 10. 未验证项（明确标注，不含猜测）

| # | 项 | 影响 | 建议实验 |
|---|---|---|---|
| V1 | `additionalContext` 是否**真的**以 system-reminder 进模型上下文且每轮都进 | 注入方案成立与否 | 有凭据会话里让 hook 返固定串，问模型复述；或抓 provider 请求体 |
| V2 | 24k 截断是「总长」还是「每条」 | 预算切分 | 两个 hook 各返 20k，看最终注入 |
| V3 | 桌面端是否读同一份 `~/.zcode/cli/config.json` | 用户级启用路径 | 桌面设置改可见项，diff 文件 |
| V4 | 桌面端 `plugins.dirs` 的 GUI 启用入口 | 用户安装路径 | 设置 → 插件 → 导入，观察 config 变化（需用户同意） |
| V5 | UI Plugin 面板在本机能否渲染 | P2 可行性 | 装官方 `visualize`，开侧栏看是否出面板 |
| V6 | Stop 续跑实际次数与 `stop_hook_active` 语义 | 轮末固化设计 | 让 Stop 返 `decision:block` 数轮次 |
| V7 | `--json` / app-server 是否给 token usage | 水位功能能否保留 | 跑一次 `-p --json` 看字段 |
| V8 | `async:true` 的 command hook 在 turn 结束后是否继续跑 | 后台固化方案 | async hook sleep 5s 写文件，turn 结束后查时间戳 |
| V9 | MCP server 进程在会话结束后是否被杀 | 常驻 / 定时任务方案 | 关会话后查 node 进程 |
| V10 | Python worker 是否支持多实例、engineIdentity 跨宿主是否必不一致 | leader 是否必须独占引擎 | 两进程各起 worker，看 `semantic/*.jsonl` 行数是否下降 |

---

## 附录 A：关键契约速查（写代码时直接照抄）

**ZCode hook stdin（实测，camel + snake 双份）**

```json
{"cwd":"...","hookEventName":"UserPromptSubmit","mode":"yolo","prompt":"...",
 "sessionId":"sess_...","timestamp":"...","traceId":"...","turnId":"turn_...",
 "hook_event_name":"UserPromptSubmit","permission_mode":"yolo","session_id":"sess_...",
 "transcript_path":"C:\\...\\zcode-hook-XXXX\\transcript.jsonl"}
```

- `Stop` 额外：`last_assistant_message`（完整 assistant 文本）、`stop_hook_active`、`toolCallCount`
- 环境变量（实测全部有值）：`ZCODE_SESSION_ID` / `CLAUDE_CODE_SESSION_ID` / `ZCODE_PROJECT_DIR` / `ZCODE_PLUGIN_ROOT` / `ZCODE_PLUGIN_DATA` / `ZCODE_PLUGIN_ID` / `ZCODE_PLUGIN_NAME`

**hook 输出（未知键被 Zod strip、不报错；两条硬失败：`hookEventName` 必须等于当前事件、stdout 必须以 `{` 开头）**

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}
```

**限制常量（ZCode v3.16.2 源码 / 实测）**：`HOOK_CONTEXT_MAX_CHARS = 24000`、`MAX_STOP_HOOK_CONTINUATIONS = 3`、hooks 默认 `maxOutputBytes = 32768` / `timeoutMs = 60000`、AGENTS.md 单文件 100 KiB、`skills.metadataBudget = 20000`

**DSH 侧常量（本仓实测）**：`injectBudgetChars = 8000`（`lib/index.js:628`）、Tier-0 ≤ 800 token、`ACTIVE_MS = 90000`（心跳）

---

## 附录 B：证据索引

| 文档 | 内容 | 关键结论 |
|---|---|---|
| [01-zcode-host-surface.md](./01-zcode-host-surface.md) | ZCode 插件系统 / hooks / MCP / skills / commands / AGENTS.md / UI Plugin / 原生 memory | 插件贡献面只有 5 类 + `ui.surfaces`；hook 串行阻塞；注入 24k 硬截；无 sampling |
| [02-dsh-coupling-map.md](./02-dsh-coupling-map.md) | 27 条宿主 API 依赖 / 8 个事件 / 113 模块三堆统计 / 数据与文件 / 后台活动 / 引擎可 import 专项 | A 94 模块 27,475 行可原样复用；引擎层 45.64% 可移植 |
| [03-shared-store-coexist.md](./03-shared-store-coexist.md) | 记忆根 / 锁 / 索引 / 自动行为 / 配置事务 / 7 项设计 / 20 行风险矩阵 / 13 条验收用例 | 一号风险 = 锁后缀；推荐 A 方案（真源不搬家）+ leader 租约 |

**可复跑工件**（`artifacts/_zcode-port/`）：

- `zcode-port-probe/`：7 文件最小探针插件（hooks 抓包 + MCP echo + skill + command）
- `testws/zcode.json`：项目级启用配置（实测生效）
- `sandbox-storage/cli/plugins/data/zcode-port-probe@inline/`：真实抓包（hook stdin 4 份 / MCP 生命周期 / 时序）
- `count-lib.cjs`、`measure.json`、`module-table.md`、`routes-rows.md`：三堆统计与路由表

---

*本文件为调研产物，未修改任何源码 / 配置 / 测试。实施前需按 §9 拍板。*
