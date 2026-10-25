# 02 · DSH 宿主耦合测绘（研究线 B）

> 目标：把 `@a9i5k4/dsh-auto-memory` v3.3.15 的宿主耦合面测绘清楚，为移植到 ZCode 给出**模块级清单**与**实测工作量占比**。
> 纪律：只读；未改动任何源码/配置/测试。本文所有数字均可由 `artifacts/_zcode-port/` 下的脚本复算。

## 0. 测量基线（可复算）

| 项 | 值 |
|---|---|
| 仓库 | `D:\dsh-auto-memory`，`package.json` version = **3.3.15**（测绘开始时）→ **3.3.16**（10:54 由其他线 bump，非本线改动；`lib/` 未随之变化），`private: true`，`type: module`，`main = lib/index.js` |
| Git HEAD | `4464474`（2026-10-22 08:53:39 +08:00，`feat(tools): 图表工具包进仓`） |
| 工作树状态 | `lib/index.js`、`lib/client.js`、`lib/skill-export-host.js` **有未提交改动**（`git diff --stat -- lib` = 3 files, +369/−84；来自本日 #454/#453 修复）。本文测绘的是**这棵含未提交改动的工作树**，不是已发布的 v3.3.15 tarball |
| 文件指纹 | `lib/index.js` sha256 `daf815a0f210933a…`（1,474,647 B / wc -l **21,141**）；`lib/client.js` sha256 `de2a0b3f2f70759d…`（2,321,779 B / wc -l **19,740**） |
| lib/*.js | **113** 个模块（已排除 `.bak*/.GOOD*/.PRE-*/.scratch/.curtest/.headtest` 等备份变体），合计 **75,210** 行（wc -l 口径）/ **5,631,823** 字节 |

复算命令（本机已实跑，exit 0）：

```bash
# ⚠️ 本仓 package.json 是 "type": "module" ⇒ 脚本用 .cjs 后缀
node artifacts/_zcode-port/count-lib.cjs      # 三堆文件数/行数/字节数 + 分类清单
node artifacts/_zcode-port/dump-measure.cjs   # 事件表/路由表/ctx 计数/定时器 → measure.json
```
原始测量结果落盘：`artifacts/_zcode-port/measure.json`；模块清单表落盘：`artifacts/_zcode-port/module-table.md`。

> ⚠️ 口径差异说明：`lib/index.js` 有 **21,141** 行（wc -l），而任务书给的是「21141 行」——一致；`lib/client.js` 为 **19,740** 行（任务书写 19,725，那是本日 #454 改动前的行数，改动后 +15 行）。本文一律用 wc -l 现测值。

---

## 1. 宿主 API 依赖表

### 1.1 顶层形状：只有 `apply(ctx, config)` 一个入口

`lib/index.js` 的对外契约（`:332`–`:344`）：

```js
export const name = 'auto-memory-pre'                  // :332
export const inject = ['webServer','tools','systemPrompt','subagents','llm']  // :335
export const GUIDANCE = '…'                            // :344
export const API = { … }                               // :347  （73 条路由路径常量）
export function apply(ctx, config) { … }               // :15548–:21131（5,583 行）
```

`package.json` 的宿主声明（逐字）：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-runtime",
               "@deepseek-ai/dsh-client-connection", "@deepseek-ai/dsh-client-ui-slots",
               "@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-ui-sidebar"],
    "platform": "web"
  }
},
"peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" },
"optionalDependencies": { "@huggingface/transformers": "^3.7.6" }
```

`cordis.patch.yml` 全文 10 行，只做一件事：把 `id: auto-memory-pre` 的插件行插进 web profile roster。

**关键结论（复核任务书的「初步结论」）**：

1. ✅ 成立：`lib/*.js` **没有任何一个模块 import `@deepseek-ai/*`**。全仓 grep 命中的 `@deepseek-ai/` 共 4 个文件、17 处，**全部是注释里的类型出处引用**（`index.js` 8 处、`client.js` 5 处、`official-compaction.js` 3 处、`team-identity.js` 1 处），零 `import`/`require`。唯一非 node 内建的 `require` 在 `client.js`，且是宿主注入的 `require('react')` / `require('react-dom')`。
2. ✅ 成立：宿主对象**只经 `apply(ctx)` 注入**。但需精化：除 `ctx` 外还从 **`exec.agent.ctx`**（工具执行期的 agent 句柄，`:5171`）和 **`agent.ctx.get`**（`parent.ctx`，`:12584`）二跳取服务——这两个是「宿主对象的宿主对象」，ZCode 适配层必须一并伪造。
3. ⚠️ 需修正：`ctx.policy` / `ctx.head`（`:16791` / `:16796`）**不是宿主 API**——该处的 `ctx` 是 `engine.ensureJsDecide()` 返回的**策略工件上下文**（局部变量遮蔽），与 DSH `ctx` 同名但无关。A/B/C/D 表中按「非宿主」处理。

### 1.2 `ctx.*` 逐项依赖表

计数口径：**非注释行**（排除 `//`、`*` 开头行）。表内「行号」为该成员在 `lib/index.js` 中**实际调用/读取**的行。

| # | API / 事件 / 服务 | `lib/index.js` 行号 | 用途 | 分级 |
|---:|---|---|---|---|
| 1 | `ctx.tools.register(tool)` | `:21116`（`inject` 声明 `:335`） | 注册 **19 个 tool**（15 `memory_*` + 4 `calendar_*`），其中 `memory_expand`/`memory_trace` 由 `boardMode` 闸门条件注册（`:19022`） | **A** |
| 2 | `ctx.webServer.register(route)` | `:21118`（`inject` 声明 `:335`） | 注册 **73 条 HTTP 路由**（全部 `kind:'exact'`，前缀 `/api/dsh-auto-memory/`），`:19046–:21014`（1,969 行 / 131,386 B = index.js 的 **8.9%**）；每条 handler 首行统一 `isLoopbackRequest(req, panelAllowedHosts)` 守卫（73/73） | **C**（ZCode 无 HTTP 路由能力） |
| 3 | `ctx.systemPrompt.context({name,order,text})` | `:17460`（动态记忆快照）、`:18213`（M6 reference tail） | 两条 **user-role 快照**注入面；`text(context)` 收到 `context.agent`，返回字符串 | **B**（需映射到 ZCode 注入面；语义不同，见 §1.3） |
| 4 | `ctx.systemPrompt.section({name,order,text})` | `:18203` | 静态纪律段（`renderMemoryStatic()`），要求**字节级稳定**做 DeepSeek 前缀缓存锚 | **B** |
| 5 | `ctx.on('dispose', fn)` | `:17242` | 置 `engine._disposed = true`，阻断 dispose 后迟到 IO/子进程 | **A** |
| 6 | `ctx.on('agent/session-start', fn)` | `:17285` | `payload.agent` → 建 runtime、`_lastAgent`（排除子代理）、`seedRuntimeFromSession`、refresh | **B** |
| 7 | `ctx.on('agent/turn-stopping', fn)` | `:17307` | `payload.agent` / `payload.turn` → 刷活动戳、白板首建、水位测量 + arm 接续、600 ms 后 `consolidateTurn` | **B** |
| 8 | `ctx.on('agent/pre-step', async (payload, next))` | `:17349` | **waterfall 钩子**，必须 `return next()`；读 `payload.agent/turn/step/messages`（`messages[].source.kind==='user'` 嗅真人） | **B**（ZCode 有 hooks，需语义对齐） |
| 9 | `ctx.on('agent/disposed', fn)` | `:17441` | `payload.agent` → `disposeAgent` | **A** |
| 10 | `ctx.on('session/disposed', fn)` | `:17444` | `session` → `runtimes.disposeSession` | **A** |
| 11 | `ctx.on('session/event', (session,event))` | `:17450` | post-commit 事件流 → `observeSessionEvent`（M2 observer，有界 ring） | **B** |
| 12 | `ctx.on('tools/result', (exec,result))` | `:17453` | 工具执行终态 → `observeToolResult`（`exec.callId/rootCallId/name/agent`） | **B** |
| 13 | `tokenMeter`（经 `agent.ctx.get('tokenMeter')` 取，非 `ctx.get`） | `:5171` | 水位分子：`meter.measure(session).totalTokens`，与聊天框 context ring 同源 | **C**（ZCode 无 tokenMeter；需自建或降级为启发式） |
| 14 | `ctx.get('agents')`（+ `get('agent')` 兜底） | `:17248`；使用点 `:6204`、`:6252`、`:11650`、`:12051` | `AgentRegistry.get(sessionId).status`（`'idle'\|'running'`）判忙闲；`restoreLastAgent()` | **B** |
| 15 | `ctx.get('sessions')` | `:17244`；使用点 `:11125` | `sessions.list()` 恢复最近 agent | **B** |
| 16 | `ctx.get('subagents')` | `:17237`；使用点 `:12273`、`:12353`、`:12552` | `subagents.list()`（provider 名数组）、`startActivation({provider,label,request,signal,delivery:'parent'})`（0.2.x）/ `start()`（0.1.x 兼容） | **C**（ZCode 子代理语义差异大） |
| 17 | `ctx.get('llm')` | `:17250`；使用点 `:20989` | `listProviders()` / `listModels()`（设置页模型抽屉数据源） | **B** |
| 18 | `ctx.get('workspaceRegistry')` | `:17252`；使用点 `:3670`、`:6227`、`:11837`、`:12096`、`:12790`、`:12965`、`:15262`（+ `_ctxRef` 惰性重取 `:11768`、`:11820`、`:12075`） | `list()` 反查会话→工作区、`create(path,title)`、`delete(id)` | **C**（ZCode 无 workspace 概念，需自建映射） |
| 19 | `ctx.get('sessionController')` | **不在 apply 内直接取**；经 `_ctxRef?.get?.()` 惰性取：`:5750`、`:6283`、`:11694`、`:11876`、`:11931`、`:12093` | `create({workspaceId})` / `selectModel` / `prompt` / `cancel`——一键接续、工作台会话创建 | **C**（ZCode 无对应会话控制器） |
| 20 | `ctx.get('permissionPresets')` | `:6191`、`:11643` | `current(session)` / `set(session,name)`——权限预设继承、工作台 `danger-full-access` 校验 | **D**（ZCode 无权限预设概念，可砍） |
| 21 | `ctx.get('sessionQuery')` | `:17235`；使用点 `:4649` | `searchSessions(query)` 历史会话全文检索；缺失时返回带 `diagnostic` 的空数组（fail-soft） | **B** |
| 22 | `ctx.get('sessionPersistence')` | `:13066`（经 `_engineCtx()`） | `locate(header)` 定位会话目录；回退为扫描 `~/.dsh/sessions` | **C**（目录布局是 DSH 特有） |
| 23 | `ctx.get('config')` | `:12397` | `get('subagent.maxActiveSubagents')`（B0 契约探针） | **D**（探针专用，可砍） |
| 24 | `ctx.get('tools')` | `:12405` | 探针：检查 `send_message` 工具是否注册（`Symbol.for('dsh.subagent.adjacentAgentSendMessageTool')`） | **D** |
| 25 | `ctx.effect(fn, label)` | `:15645`（`'dsh-auto-memory: surfaces'`）、`:21122`（`'…: surfaces: retry'`） | disposer 所有权：apply 抛错时回滚全部 timer/路由/工具注册 | **A**（ZCode 插件若有 lifecycle 可直译；否则用 try/catch + 显式 dispose 等价实现） |
| 26 | `ctx.remote.directoryPicker.pick()` | `:20443` | 内核标准契约优先的目录选择器 | **D**（ZCode 无） |
| 27 | `ctx.directoryPicker.capability().pick(signal)` | `:20452` | 旧 capability 形态目录选择器（5 分钟超时 abort） | **D** |

### 1.2b 任务书点名的 5 个成员 → 实际访问形态

任务书要求覆盖 `ctx.agents / ctx.sessions / ctx.subagents / ctx.llm / ctx.tokenMeter`。这 5 个在本仓**全部不是直接属性访问**，而是 `ctx.get('服务名')` 的字符串服务键（cordis 服务注册表）。逐条对照：

| 任务书写法 | 本仓实际写法 | 首次取用行 | 使用点 | 分级 |
|---|---|---|---|---|
| `ctx.agents` | `ctx.get('agents')`（旧宿主 `ctx.get('agent')` 兜底） | `:17248` | `:6204`、`:6252`、`:11650`、`:12051` | B |
| `ctx.sessions` | `ctx.get('sessions')` | `:17244` | `:11125`（`restoreLastAgent`） | B |
| `ctx.subagents` | `ctx.get('subagents')` | `:17237` | `:12273`、`:12353`、`:12552`、`:12623` | C |
| `ctx.llm` | `ctx.get('llm')` | `:17250` | `:20989`（`listProviders/listModels`） | B |
| `ctx.tokenMeter` | **`agent.ctx.get('tokenMeter')`**（二跳，不经 apply 的 ctx） | `:5171` | 同左 | C |

另有 2 个只经 `_ctxRef.get()` 惰性取、**不在 `inject` 数组里**的服务（缺服务时降级而非整个插件不加载）：`sessionController`（`:5750` 等 6 处）、`workspaceRegistry`（`:11768` 等 3 处）。

**`ctx.policy` / `ctx.head` 不在上表**：`:16791` / `:16796` 的 `ctx` 是 `engine.ensureJsDecide()` 返回的 `{policy, head}` 策略工件上下文（局部变量），非宿主 API。

### 1.3 分级统计（逐条汇总）

| 分级 | 条数 | 说明 |
|---|---:|---|
| **A** 可原样复用 | 5 | `tools.register` / `effect` / `on('dispose')` / `on('agent/disposed')` / `on('session/disposed')` |
| **B** 需适配层 | 11 | `systemPrompt.context`（1 行覆盖 2 个 surface）/ `systemPrompt.section` / 5 个生命周期事件 / `agents` / `sessions` / `llm` / `sessionQuery` = 1+1+5+4 |
| **C** 必须重写 | 6 | `webServer.register`（73 路由）/ `tokenMeter` / `subagents` / `workspaceRegistry` / `sessionController` / `sessionPersistence` |
| **D** ZCode 无对应需砍 | 5 | `permissionPresets` / `config` / `tools`（两项探针）/ `remote.directoryPicker` / `directoryPicker` |

> 口径说明：上表按「一行一个 API 表面」计 27 条；`inject` 声明里的 `'webServer'`/`'tools'`/`'systemPrompt'`/`'subagents'`/`'llm'` 5 个名字与具体调用点合并计一行，不重复计。

---

## 2. 事件表

共 **8 个** `ctx.on()` 注册（`:17242`–`:17453`）。payload 字段按**代码实际读取**列出（不是推测）。

| # | 事件 | 行号 | payload 实际使用字段 | 处理器做什么 | 分级 |
|---:|---|---|---|---|---|
| 1 | `dispose` | `:17242` | 无 | `engine._disposed = true`；后续 `writeHeartbeat`/`runSubagent`/`hubFeedTick` 等入口全部提前返回 | A |
| 2 | `agent/session-start` | `:17285` | `payload.agent`（完整 agent 对象，需 `.session.id` 或 `.session.header.id`）；`payload.source`（仅 `boundedStr` 截断后入 lifecycle 日志） | ① `hasReliableSessionIdentity` 守卫；② `runtimeFor(agent)` 建 runtime；③ 非子代理才写 `_lastAgent`；④ `seedRuntimeFromSession(agent)` 回放已存在事件；⑤ `ingestAgentLifecycle(...,'agent/session-start')`；⑥ `refreshAll(agent)` | B |
| 3 | `agent/turn-stopping` | `:17307` | `payload.agent`、`payload.turn` | ① 套娃防护（`_ownSubagents.has(agent)` 直接 return）；② 写 `lastActiveAt` / `_globalLastActiveAt`；③ `ensurePlanBoardForAgentPre(agent)` 白板首建；④ `checkWaterLevel(agent)` → `armAutoContinue(...)` 水位+接续倒计时；⑤ `ingestAgentLifecycle`；⑥ 600 ms 后 `setTimeout(() => consolidateTurn(payload.turn, agent), 600)` 每轮自动沉淀 | B |
| 4 | `agent/pre-step` | `:17349` | `payload.agent`、`payload.turn`、`payload.step`、`payload.messages[]`（读 `.source`，`kind==='user'` 或空即真人） | **waterfall**（必须 `return next()`）：① 记请求键 `(turn, step)`；② 嗅真人消息置 `_humanPending`（此段在子代理早退**之前**）；③ 套娃防护 `return next()`；④ 首步登记 runtime、`flushReasoningBuffer`、`checkWaterLevelAtStep`、`activationHost.onPreStep`；⑤ 非子代理且 `loadedAt` 超 15 s → `await withAgent(agent, () => refresh(agent))` | B |
| 5 | `agent/disposed` | `:17441` | `payload.agent` | `engine.disposeAgent(payload.agent)` | A |
| 6 | `session/disposed` | `:17444` | 第 1 个位置参数 `session` | `engine.runtimes.disposeSession(session)` | A |
| 7 | `session/event` | `:17450` | 第 1 参数 `session`（只读 `.id` / `.header.id`）；第 2 参数 `event`（读 `.type`、`.seq`、`.time`、`.data.*`） | `observeSessionEvent` → 按 `sessionId` 找 runtime → `ingestSessionEventRecord`：`user/message`、`assistant/message` 等按 `nativeSeq` 游标去重后入有界 ring（`ENVELOPE_RING_LIMIT=128` / `SEGMENT_RING_LIMIT=64` / `SEED_REPLAY_MAX_EVENTS=512`） | B |
| 8 | `tools/result` | `:17453` | 第 1 参数 `exec`：`.agent`、`.callId`、`.rootCallId`、`.name`；第 2 参数 `result`：`.isError`、`.error.message`、`.error.info.{name,code}`、`.value` | `observeToolResult`：`isError` 判成功/失败 → 预览（成功取 `JSON.stringify(value)` 前 240 字符；失败取 `error.message`）→ `linkObserverCall` + `ingestEnvelope` | B |

**事件语义要点（对移植最关键的 3 条）**：

1. `agent/pre-step` 是**唯一可 await 的注入前钩子**，且宿主契约要求它返回 `next()`。ZCode 若无 waterfall 钩子，整条「首轮注入必达」保证（`systemPrompt` 的 text 是同步函数不能 await）会退化为「首轮可能为空」。
2. `systemPrompt.context()` 的 `text()` 在**同一模型请求内会被调用两次**（`:17511-17516` 注释：preStep 的 assemble 帧被结构性丢弃、step 的 refreshContext 帧才进模型），因此插件用 `_reqTextKeyPre`/`_reqTextPre` 做**同请求定稿复读**。这是 DSH `dsh-agent-loop` 的实现细节，ZCode 必须重新验证「一请求调用几次」。
3. `session/event` / `tools/result` 是 M2 observer 的唯一数据源；ZCode 若只给 hook 不给事件流，则 observer / 证据层 / shadow-retrieval 全部退化为空（不影响主注入，但会让面板「回忆了什么」永远为空）。

---

## 3. 纯核心模块清单（lib/*.js 全量 113 个）

### 3.1 三堆判定规则（可复算）

| 堆 | 判定 |
|---|---|
| **C 必须重写** | ① `lib/index.js`（宿主壳）；② `lib/client.js`（浏览器 bundle）；③ 直接 `spawn/fork` 子进程的 4 个模块：`python-runtime.js`、`python-setup.js`、`python-sidecar-client.js`、`semantic-js-process.js` |
| **B 需适配层** | 依赖 DSH 专有路径口径（`resolveDshHomePre` / `DSH_HOME` / `memoryDir(`）或接收宿主 seam 注入（`activation-host` / `context-host` / `shadow-host` 的 `initCapability(ctxLike)`）或 CLI 入口（`continuation-maintenance.js`） |
| **A 可原样复用** | 其余全部：无 `ctx.*`、无 `dshHome()`/`DSH_HOME`、无 `spawn/fork`、无 HTTP、无 `document/window/React` |

程序化校验（本机实跑）：A 堆 94 文件**零残留耦合命中**（`home`/`ctx`/`spawn`/`http`/`browser` 五项全 0）。A 与 B/C 之间的唯一跨层引用是 4 条单向依赖：`index-sync.js`→`evidence-store.js`、`m7-index-sync-host.js`→`evidence-store.js`、`procedure-store.js`→`evidence-store.js`、`team-policy.js`→`team-identity.js`（均为 A→B，反向为零）。

### 3.2 全量清单（113 行，一行一个模块）

| 文件 | 行数(wc -l) | 堆 | 依赖类型 | 职责（取自模块头注释） | 可原样 import |
|---|---:|---|---|---|---|
| `lib/acceptance.js` | 71 | A | 纯 JS | acceptance-pre —— P5 分档运行验收清单(2026-09-16, acceptance_pre_v1)。 | ✅ |
| `lib/activation-host.js` | 614 | B | 纯 JS | M6-3 Surface Adapter(docs/M6-CONTRACT.md §7-§11,§13 M6-3)。 | ❌ |
| `lib/activation-inbox-state.js` | 261 | A | 纯 JS | M6-2 Per-runtime Activation Inbox(docs/M6-CONTRACT.md §8-§9,§13 M6-2)。 | ✅ |
| `lib/activation-inbox.js` | 494 | A | crypto | M6-1 Activation Inbox / Reference Tail 纯核心(docs/M6-CONTRACT.md §3-§6,§13 M6-1)。 | ✅ |
| `lib/board-mode.js` | 30 | A | 纯 JS | board-mode-pre —— WB-GRAPH 白板线总开关(2026-09-16, board_mode_pre_v1)。 | ✅ |
| `lib/calendar-fields.js` | 11 | A | 纯 JS | return String(value || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|') | ✅ |
| `lib/calendar-lock.js` | 7 | A | 纯 JS | ★批次 W（2026-10-05，PR#210 拆取）：锁物理合一。 | ✅ |
| `lib/client.js` | 19740 | C | 纯 JS | dsh-auto-memory — browser half (hand-written __ModuleLoader__ bundle). | ❌ |
| `lib/config-io.js` | 209 | A | fs | 配置文件的**原子写**与**损坏隔离**（上游 issue #82 修复）。 | ✅ |
| `lib/config-lock.js` | 150 | A | fs+async_hooks | One transaction boundary for settings saves and startup migrations. | ✅ |
| `lib/consolidate-filter.js` | 70 | A | 纯 JS | 自动沉淀**解析层确定性过滤** + [USER] 写入门槛（#167 / 审计 §G1 P0 + P1）。 | ✅ |
| `lib/context-bridge.js` | 621 | A | crypto | M5-1 Context / Evidence Bridge 纯核心(docs/M5-CONTRACT.md §4-§11)。 | ✅ |
| `lib/context-host.js` | 1000 | B | fs+crypto | M5-3 Context Bridge Host Wiring(docs/M5-CONTRACT.md §12 M5-3)。 | ❌ |
| `lib/context-sink-python.js` | 90 | A | 纯 JS | M7-0/M7-1 PythonContextSinkPre(docs/PYTHON-SIDECAR-CONTRACT.md §5.2,§8.2,§13.1)。 | ✅ |
| `lib/continuation-maintenance.js` | 38 | B | 纯 JS | #!/usr/bin/env node | ❌ |
| `lib/continuation-state.js` | 190 | A | fs+crypto | Durable continuation state. Old JSON files remain readable and untouched on | ✅ |
| `lib/continuation.js` | 34 | A | 纯 JS | Bound ritual host calls even when a service ignores its cancellation signal. */ | ✅ |
| `lib/datadir.js` | 103 | B | fs | 记忆数据目录的唯一收口（去 pre，2026-09-23）。 | ❌ |
| `lib/degrade.js` | 385 | A | 纯 JS | degrade.js · 降级留痕层（R3，2026-09-18） | ✅ |
| `lib/diagnostic-error.js` | 38 | A | 纯 JS | Error messages can contain credentials, URLs, paths, source text or injected | ✅ |
| `lib/dsh-home.js` | 143 | B | 纯 JS | **DSH_HOME 的唯一解析口径**（上游 issue #86-3 修复）。 | ❌ |
| `lib/embedding-config.js` | 65 | A | crypto | return String(env.DSH_M7_EMBEDDING_CONFIG || '').trim() || path.join(dshHome, 'memory', 's… | ✅ |
| `lib/engine-identity.js` | 149 | A | crypto | 引擎身份（engine_identity_pre_v1）—— P2「引擎隔离」的地基（V2-P2 卡 / 评审 §3.5）。 | ✅ |
| `lib/engine-switch.js` | 247 | A | 纯 JS | 引擎切换状态机（engine_switch_pre_v1）—— P2 / T2-9 切档隔离与进度条（V2-P2 卡 points 4/5）。 | ✅ |
| `lib/episodic-store.js` | 493 | A | crypto | M8-1 Episodic Store 纯核心(docs/proactive-associative-memory-system-map.html M-02 Episodic)。 | ✅ |
| `lib/evidence-agg.js` | 81 | A | 纯 JS | evidence-agg-pre —— evidence 事件 → 聚合 → importance 输入契约(M8-2b, 2026-09-09)。 | ✅ |
| `lib/evidence-store.js` | 494 | B | fs+crypto | M5-2 Evidence Store + Aggregate(docs/M5-CONTRACT.md §8-§11)。 | ❌ |
| `lib/fact-store.js` | 1038 | A | crypto | M8-0 Fact Store 纯核心(docs/proactive-associative-memory-system-map.html M-03 Semantic/Profil… | ✅ |
| `lib/file-boundary.js` | 103 | A | fs | ★V2-1（AUDIT §3.0 铁律 2 / §3.4）：**路径边界判据的单一来源**。 | ✅ |
| `lib/fs-retry.js` | 46 | A | fs | 有界 rename 重试 —— 应对 Windows 下短暂的文件句柄争用(issue #48)。 | ✅ |
| `lib/global-brief.js` | 245 | A | 纯 JS | 「接续其他 Agent 记忆文档」的**纯逻辑核心**（全局动态简报）。 | ✅ |
| `lib/handoff-anchor.js` | 114 | A | 纯 JS | P6(2026-09-09) 账本权重化截断纯核心(handoff_ledger_weight_pre_v1)。 | ✅ |
| `lib/hub-io.js` | 848 | A | fs+crypto | M8 记忆中枢（Memory Hub）持久化 IO —— **带健康度记账的 io 适配器**（#110，2026-09-22）。 | ✅ |
| `lib/index-sync.js` | 178 | A | 纯 JS | M7-1 Authorized index_sync 构造与执行(docs/PYTHON-SIDECAR-CONTRACT.md §8.4;handoff M7-1)。 | ✅ |
| `lib/index.js` | 21141 | C | fs+child_process+crypto+async_hooks | ★B-1b（#218）：跨进程配置事务锁 —— 配置的读改写窗口横跨 read→校验→迁移→原子写， | ❌ |
| `lib/injection-policy.js` | 62 | A | 纯 JS | Automatic injection policy only. Source files, anchors, digests and explicit | ✅ |
| `lib/intent-clean-safe.js` | 258 | A | 纯 JS | 运行时信封剥离器 —— **结构判据版**（2026-09-19 R5）。 | ✅ |
| `lib/intent-clean.js` | 70 | A | 纯 JS | M8 采集侧 intent 清洗(2026-08-30 P1,docs/HANDOFF-M8-M9-M10.md §2 P1)。 | ✅ |
| `lib/jsonl-tail-cursor.js` | 75 | A | crypto | 环形 JSONL 的增量游标（issue #103）。 | ✅ |
| `lib/l0-extract.js` | 486 | A | 纯 JS | L0 抽取纯核心（l0_extract_pre_v1）—— 分层语义唤回的地基。 | ✅ |
| `lib/l0-index-sync.js` | 205 | A | crypto | L0 索引接线（l0_index_sync_pre_v1）—— 三层检索契约 C3 | ✅ |
| `lib/l0-index.js` | 349 | A | crypto | L0 向量索引（l0_index_pre_v1）—— 为 T1 产出的 L0 建立向量索引,供语义检索使用。 | ✅ |
| `lib/layout-config.js` | 265 | B | 纯 JS | 布局配置(layout-config) —— **配置层核心:纯逻辑 + 零 IO + 零依赖 + 零副作用**。 | ❌ |
| `lib/ledger-criteria.js` | 142 | A | 纯 JS | ledger-criteria-pre —— WB-GRAPH P1 判据校验中间件核心(2026-09-16, ledger_criteria_v1)。 | ✅ |
| `lib/m4-corpus.js` | 183 | A | fs+crypto | M4-2 Corpus Adapter — SourceCatalog/M3b sidecar 校验/CorpusRegistry(docs/M4-CONTRACT.md §7/§… | ✅ |
| `lib/m7-index-sync-host.js` | 315 | A | 纯 JS | M7-8 Host Index Sync Orchestrator(docs/PYTHON-SIDECAR-CONTRACT.md §19.10;修复 live blocker)。 | ✅ |
| `lib/m7-wire.js` | 269 | A | crypto | M7-0 Wire Protocol 纯核心(docs/PYTHON-SIDECAR-CONTRACT.md §7-§9,§13 M7-0)。 | ✅ |
| `lib/memory-anchor.js` | 506 | A | crypto | Anchor/Sidecar/Dry-run Planner — M3b-1(系统地图 M-06 契约 + docs/M3B-CONTRACT.md §3-§7)。 | ✅ |
| `lib/memory-envelope.js` | 257 | A | 纯 JS | 记忆注入信封 · 分项账本（memory_envelope_pre_v1）—— 契约 T0-3 / 总纲 §0.5 第 6 条。 | ✅ |
| `lib/memory-hub.js` | 500 | A | crypto | M8-3 Memory Hub 编排器(docs/PROJECT-FREEZE-AND-ROADMAP.md M8/M9; 记忆中枢)。 | ✅ |
| `lib/memory-importance.js` | 70 | A | 纯 JS | memory-importance-pre —— evidence → importance 纯核心(M8-2, 2026-09-09; memory_importance_pre… | ✅ |
| `lib/memory-index.js` | 147 | A | crypto | MemoryFileIndex — 只读记忆文件索引(M3a,系统地图 M-06 契约)。 | ✅ |
| `lib/memory-mutation-transaction.js` | 336 | B | fs+async_hooks | ★#249 C02（AUDIT §2.1）：**生产文档 mutation 统一 admission**。 | ❌ |
| `lib/memory-mutation.js` | 251 | A | crypto | 记忆写入保护门（memory_mutation_pre_v1）—— 3.0 主体拥有「共同提交与保护入口」。 | ✅ |
| `lib/memory-writer.js` | 894 | A | fs+crypto+async_hooks | MemoryDocumentWriter — M3b-2 原子写入基础设施(契约 §8-§9,M-06 project/atomicWrite 对应层)。 | ✅ |
| `lib/migrate-pack.js` | 636 | A | crypto | 迁移包引擎（migrate pack）—— 把一个工作区的记忆打包/搬包/导入。 | ✅ |
| `lib/note-status-apply.js` | 118 | A | 纯 JS | 结论层状态 · **条目级应用**（G3 写盘的核心纯函数） | ✅ |
| `lib/note-status.js` | 204 | A | 纯 JS | 结论层状态（G3）· **纯函数核心** —— 零 IO、零副作用、可单测。 | ✅ |
| `lib/official-compaction.js` | 246 | A | fs | 镜像官方压缩参数（唯一真源 · 零依赖） | ✅ |
| `lib/path-write-queue.js` | 52 | A | 纯 JS | 按路径串行的原子写队列（#207 / 审计 §G2 第 1-3 项的公共处方）。 | ✅ |
| `lib/plan-store.js` | 205 | A | fs+crypto | Shared PLAN is the source of truth. Revisions cover exact UTF-8 bytes; | ✅ |
| `lib/procedure-observation.js` | 65 | A | crypto | Episode-only rows cannot earn memory-ID evidence. Do not fabricate provenance or gates. */ | ✅ |
| `lib/procedure-snapshot-transaction.js` | 139 | A | fs | 通用技能库（procedure memory）**跨进程快照事务** —— #250（C03）的落点。 | ✅ |
| `lib/procedure-store.js` | 1097 | A | crypto | M8-2 Procedural Store 纯核心(docs/proactive-associative-memory-system-map.html M-04 Procedura… | ✅ |
| `lib/procedure-switch.js` | 38 | A | 纯 JS | ★ B-2 修复(2026-09-22)：**procedure 技能生效总闸的语义纠正与兼容层**。 | ✅ |
| `lib/python-runtime.js` | 198 | C | fs+child_process | Python 解释器/引擎**运行时探测链**（2026-09-30 新增）。 | ❌ |
| `lib/python-setup.js` | 533 | C | fs+child_process+crypto | M7.6 Python 一键向导(host 半):#16-#20 配套——把 C3 进阶档从"开发机可达"变成"爱好者可达"。 | ❌ |
| `lib/python-sidecar-client.js` | 1043 | C | fs+child_process+crypto | M7-0 JS SidecarClient(docs/PYTHON-SIDECAR-CONTRACT.md §7,§13;handoff M7-1 第一项)。 | ❌ |
| `lib/recall-fusion.js` | 170 | A | 纯 JS | recall-fusion-pre —— rank-space 融合(P3, 2026-09-09; rrf_fusion_pre_v1)。 | ✅ |
| `lib/recall-passages.js` | 45 | A | 纯 JS | if (line.length <= cap) return line | ✅ |
| `lib/recall-stats.js` | 300 | B | fs | 召回统计（recall statistics）—— 只**记录**、不参与排序。 | ❌ |
| `lib/rerank-host.js` | 160 | A | 纯 JS | rerank-host-pre —— P4 精排多级档位 + 有界异步窗口(2026-09-16, rerank_host_pre_v1)。 | ✅ |
| `lib/rules-edit.js` | 159 | A | 纯 JS | 「用户级硬性约束」的**条目级**解析与增删改（R7 需求）。 | ✅ |
| `lib/rules-layer.js` | 352 | A | 纯 JS | 规则层抽取（rules_layer_pre_v1）—— P6A 的"分类"部分（Phase 6 拆分中的 6A）。 | ✅ |
| `lib/semantic-decide.js` | 298 | A | fs | JS 端激活判定核(js_activation_decide_pre_v1) —— 2026-08-27 补全 JS 默认闭环。 | ✅ |
| `lib/semantic-js-process.js` | 150 | C | child_process | Process-only boundary for JS semantic inference (#156). | ❌ |
| `lib/semantic-js-worker.js` | 117 | A | fs | JS semantic inference process. Never import this file into the DSH host. | ✅ |
| `lib/semantic-js.js` | 738 | B | fs+crypto | C2 内置语义引擎宿主(js_semantic_engine_pre_v1)+ 资产下载器(js_semantic_dl_pre_v1)。 | ❌ |
| `lib/session-archive.js` | 494 | A | fs | 会话归档与删除的**自持**实现（F 线）。 | ✅ |
| `lib/settings-safety.js` | 187 | B | fs+crypto | Saving reads strictly and leaves a corrupt/unreadable original in place. | ❌ |
| `lib/shadow-host.js` | 401 | B | fs+crypto | M4-3 Host Shadow Wiring(docs/M4-CONTRACT.md §5/§14/§15/§17)。 | ❌ |
| `lib/shadow-retrieval.js` | 680 | A | crypto | Shadow Retrieval — M4-1 纯核心(docs/M4-CONTRACT.md §6-§16)。 | ✅ |
| `lib/shared-state-lock.js` | 247 | A | fs | Standalone reuse of the reviewed calendar-lock algorithm; no dependency on PR #206. | ✅ |
| `lib/skill-export-host.js` | 408 | A | fs+crypto | M9-3 Skill 导出层 · 宿主侧（IO 落地）。 | ✅ |
| `lib/skill-export.js` | 400 | A | crypto | M9-3 Skill 导出层（procedure → SKILL.md 目录束）。 | ✅ |
| `lib/skin-assets.js` | 69 | A | 纯 JS | 皮肤资源清单(skin-assets)—— **纯数据 + 一个取值函数**,零 IO、零依赖、零副作用。 | ✅ |
| `lib/skin-center.js` | 233 | A | 纯 JS | 皮肤中心（skin-center）—— R23 · 12 卷《前端皮肤接口契约》的**纯逻辑实现**。 | ✅ |
| `lib/state-commit.js` | 245 | A | crypto | 统一状态提交契约（state_commit_pre_v1）—— P1 主体（2026-09-15）。 | ✅ |
| `lib/storage-manage.js` | 263 | A | crypto | M10 存储管理(docs/HANDOFF-M8-M9-M10.md §2 P3)。 | ✅ |
| `lib/subagent-gc.js` | 405 | A | fs | 子代理痕迹回收(pre 线,2026-09-08)。 | ✅ |
| `lib/team-attribution.js` | 212 | A | 纯 JS | 条目级「谁编辑了」旁挂索引（B12 · 37 卷 §1 第一必做项） | ✅ |
| `lib/team-auth.js` | 329 | A | fs | 团队出站鉴权(team-auth)—— 团队请求的唯一出口。 | ✅ |
| `lib/team-board.js` | 161 | A | 纯 JS | 白板**整篇冲突**裁决 + 看板**两阶段**提交（纯函数，B8）。 | ✅ |
| `lib/team-calendar.js` | 123 | A | 纯 JS | 日历的**双轨标记**（本机轨 / 团队轨）。 | ✅ |
| `lib/team-derived.js` | 164 | A | 纯 JS | 派生数据的**去抖重算调度**（纯调度，B9）。 | ✅ |
| `lib/team-identity.js` | 311 | B | 纯 JS | 团队身份(team-identity)—— 把**宿主提供的登录态**映射成团队成员(actor)。 | ❌ |
| `lib/team-inject.js` | 156 | A | 纯 JS | 团队注入段的**预算仲裁**（纯函数，B7 / ★最高风险批）。 | ✅ |
| `lib/team-merge.js` | 246 | A | 纯 JS | 下行合并的三方判定 + 冲突中心（**纯内存、纯函数**）。 | ✅ |
| `lib/team-outbox.js` | 883 | A | fs | 团队版同步的**出站队列**（客户端推送模型）。 | ✅ |
| `lib/team-policy.js` | 14 | A | 纯 JS | Local business policy, not account authentication. Call with the pre-change | ✅ |
| `lib/team-project-map.js` | 110 | A | crypto | 团队项目 ID —— 解决「wsKey 跨机不汇合」的身份级缺陷。 | ✅ |
| `lib/team-pull.js` | 455 | A | 纯 JS | 团队**下行驱动器**（纯逻辑 + 依赖注入）。 | ✅ |
| `lib/team-sync.js` | 284 | A | 纯 JS | 团队版同步的**心跳 / 传输层**（客户端推送模型）。 | ✅ |
| `lib/team-transport-http.js` | 396 | A | 纯 JS | T2「涉密内网自建服务端」传输后端（独立模块；本文件不接线）。 | ✅ |
| `lib/team-transport.js` | 533 | A | crypto | 团队版同步的**传输接缝**（★CR-8 双通道的落点）。 | ✅ |
| `lib/temporal-parse.js` | 191 | A | 纯 JS | temporal-parse-pre —— 中文时间表达解析(P12 后新增时间检索臂 Phase 1, 2026-09-09)。 | ✅ |
| `lib/tier-layer-inject.js` | 774 | A | 纯 JS | 三层注入装配（tier_layer_inject_pre_v1）—— 契约 C5 | ✅ |
| `lib/tier0-catalog.js` | 852 | A | fs | Tier-0 目录生成器（tier0_catalog_pre_v1）—— 三层检索契约（`docs/internal/THREE-LAYER-CONTRACT.md`）C4。 | ✅ |
| `lib/wasm-paths.js` | 53 | A | fs | transformers.js / onnxruntime-web 的 **wasm 资产本地化**（#207 审计 §G2 第 4 项）。 | ✅ |
| `lib/water-window.js` | 545 | A | 纯 JS | 上下文窗口解析(2.2.4,2026-09-08)。 | ✅ |
| `lib/wb-contract.js` | 691 | A | crypto | 白板格式适配器（wb_contract_pre_v1）—— 白板线拥有「白板格式及其适配器」。 | ✅ |
| `lib/wb-sidecar.js` | 1411 | A | crypto | wb-sidecar-pre —— WB-GRAPH P2 结构化 sidecar(2026-09-16, wb_sidecar_pre_v1)。 | ✅ |
| `lib/ws-overview-rank.js` | 40 | A | 纯 JS | M10 工作区总览采样排序(2026-09-08,issue #24)。 | ✅ |
| **合计** | **75210** | | | **113 个模块** | |

### 3.3 「ZCode 端可原样 import」的集合

**A 堆 94 个模块 / 27,475 行全部可原样 import**（零改动的 `import … from './xxx.js'`），其中：

- **A-pure：48 个模块 / 8,883 行**——只依赖 `node:crypto`/`node:async_hooks` 或纯 JS，连 `node:fs` 都不碰。含：`fact-store`(1,038)、`procedure-store`(1,097)、`episodic-store`(493)、`memory-hub`(500)、`wb-contract`(691)、`tier-layer-inject`(774)、`shadow-retrieval`(680)、`water-window`(545)、`wb-sidecar`(1,411)、`tier0-catalog`(852) 等。
- **A-fs：46 个模块 / 18,592 行**——只依赖 `node:fs`/`node:fs/promises`（路径由调用方传入，不自己解析 home）。含：`memory-writer`(894)、`migrate-pack`(636)、`hub-io`(848)、`session-archive`(494)、`subagent-gc`(405)、`team-outbox`(883)、`storage-manage`(263)、`shared-state-lock`(247) 等。

**结论：核心记忆逻辑（存储/检索/白板/技能/团队协议）在这一层是与宿主无关的**——这是移植的最大杠杆。

---

## 4. 数据与文件

### 4.1 路径解析的唯一收口

`lib/dsh-home.js`（144 行，**B 堆**）是 `DSH_HOME` 的**单一口径**：

```js
resolveDshHomePre(override)   // 解析顺序：override → process.env.DSH_HOME → os.homedir()+'/.dsh'
                              //          → (USERPROFILE||HOME)+'/.dsh' → '.'  （永不抛、永不返回空串）
```

`lib/datadir.js`（104 行，B 堆）在其上做 `memoryDir(name, homeFn)`：`<home>/memory/<name>`，并把历史 `<name>-pre` 目录**逐文件增量补齐**（不 move、只补「目标缺失」或「目标是空壳 JSON」的文件，fail toward duplication）。

### 4.2 用户级（`<DSH_HOME>/memory/`，默认 `~/.dsh/memory/`）

| 路径 | 写入者 | 并发保护 |
|---|---|---|
| `MEMORY.md`（用户级硬约束/跨项目记忆） | `lib/memory-writer.js`（`MemoryDocumentStore`）经 `index.js` 工具 `memory_user`/`memory_rules` | 跨进程 `.lock`（`shared-state-lock` 协议）+ 进程内按路径串行队列 + `tmp→fsync→rename` |
| `CALENDAR.md` | 同上（`calendar_add/done/remove`，`index.js:18520–18557`） | 同上；另有 `calendar-lock.js`（8 行薄壳 re-export `withCalendarLock`） |
| `workspaces-summary.json` | `index.js:9737`（`_wsSummaryFile()`）、`:10219`、`:10681` | 未见专用锁（**待验证**：可能整写无锁） |
| `polling-heartbeat.json` | `index.js:10526`（读）、`:21024`（写，`writeHeartbeat`，15 s） | 无锁；多实例按 `pid:startedAt` 键合并（`:21027-21074`，`ACTIVE_MS=90s`） |
| `cont-seq.json` | `index.js:5481`（接续高水位计数） | `withSharedStateLock`（`continuation-maintenance.js:25` 同协议） |
| `auto-continue-done.json` | `index.js:5447` | 同上 |
| `auto-memory-archive-ledger.json` | `index.js:12897`、`:12902` | 同上 |
| `notices-cache-pre.json` | `index.js:7060` | 无锁（只读缓存） |
| `update-check-pre.json` | `index.js:7007` | 无锁（只读缓存） |
| `workbench.json` | `index.js:11261` | 经 `_writeWorkbench` 收敛单写入口 + 期牌（epoch）门 |
| `recall-stats.json` | `index.js:15657`（`createRecallStatsPre({file})`） | `recall-stats.js` 内建节流（300 行） |
| `dsh-auto-memory.json`（插件配置，160 键） | `index.js:2370` 起，`loadConfig/saveConfig` | `config-lock.js`（151 行，`wx` 认领 + 同主机死主判定 + `.acquire` 门回收）+ `tmp→rename`；`_configReadOnly` 降级 |
| `layout-config.json` | `layout-config.js`（`LAYOUT_CONFIG_FILE`，`:40`） | `config-lock` 同族（**待验证**：具体调用点未逐条核） |
| `dsh-auto-memory-diagnose.log` | `index.js:1710`（`diagLogFile()`），轮转上限 2 MB + 单行 8 KB | 单写者（同进程） |
| `dsh-auto-memory-pre.json`（旧配置名，迁移源） | `index.js:3007` 读 | 只读 |
| `memory/skins/<name>/`（用户皮肤） | `index.js:19103` 皮肤库安装（GitHub 拉 3 文件） | 逐文件 `tmp→rename` + `fileWithinRoots` 物理归属复验 |
| `memory/hub/`（episodic/facts/procedures 快照） | `hub-io.js`（848 行，带健康度记账） | `tmp→rename` + `beginBatch/endBatch` 批控制 |
| `memory/index/files/`（sidecar 语料） | `m4-corpus.js` → `CorpusRegistry` | `tmp→rename`（`config-io` 原语） |
| `memory/semantic/`（`embedding-config.json`、`judgement-shadow.jsonl`、`activation-shadow-v2.jsonl`、`l0/`、`engine-switch-state.json`） | `index.js:16036`、`:16244`、`:16412`、`:19809`、`:19897`；`embedding-config.js:8` | JSONL 为 Python/sidecar 追加写；读取侧用 `jsonl-tail-cursor.js`（**内容指纹**，非行数） |
| `memory/evidence/events/` | `evidence-store.js`（494 行） | 原子写 |
| `memory/retrieval/` | `shadow-host.js:158` | — |
| `memory/workspaces/<wsKey>/`（每工作区记忆根） | `index.js:3503 projectDirOf` → `bindMemoryDirectoryPre` | `memory-writer` 跨进程锁 + admission 边界 |
| `memory/archived-user.md` | `index.js:7781` | 同 writer |
| `exports/dsh-auto-memory/`（技能导出） | `index.js:9827`、`:9926` | 逐文件写 |
| `sessions/`、`storages/`、`storages/session_projcache/`、`subagent-gc-backup/` | `index.js:4724`、`:5511`、`:6140`、`:6350`（读）；`:11434`、`:12758`、`:12769`、`:13037`、`:13124`、`:13143`（GC/归档写） | `subagent-gc.js` / `session-archive.js` 自带 cooldown + 60 min 地板 |
| `profiles/`（settings 布局探测） | `index.js:6979`（只读） | — |
| `python-engine/`（venv + BGE-M3 模型，约 850 MB） | `python-setup.js:80` `engineRoot()` = `<home>/python-engine/` | `exclusive()` 单飞闸（detect/venv/deps/model 四步互斥） |

### 4.3 工作区级（`<ws>/.dsh-memory/`，可通过 `projectMemoryDir` 改为绝对路径）

`resolvePaths(agent)`（`index.js:3605–3656`）一次性返回 12 个路径：

```
userDir      = <home>/memory                      userFile  = userDir/MEMORY.md
calendarPath = userDir/CALENDAR.md                projectDir= <memoryRoot>/<wsKey(ws)>
notesPath    = projectDir/MEMORY.md               logPath   = projectDir/<YYYY-MM-DD>.md
reflectDir   = projectDir/reflections             handoffDir= projectDir/handoff
planPath     = projectDir/handoff/PLAN.md         greetDir  = projectDir/greetings
greetPath    = greetings/<date>.json              greetPathLegacy = greetings/<date>.md
```

- 默认 `memoryRoot = '~/.dsh/memory/workspaces'`（`DEFAULT_CONFIG:567`），`projectMemoryDir = '.dsh-memory'`（`:565`）——即**集中式**布局：所有工作区记忆统一放用户目录下，按 `wsKey(ws)`（`'--' + ws.replace(/[\\/:*?"<>|]/g,'-') + '--'`，`:3497`）分目录。
- `projectDir` 走 `bindMemoryDirectoryPre(this, path, 'project')` 登记归属根（`:3515`），供写入通道做 mutation admission 复核。

### 4.4 并发保护的四个层次

| 层 | 实现 | 文件 |
|---|---|---|
| ① 跨进程文件锁 | `openSync(lock,'wx')` 认领 + `{pid,host}` 元数据 + 同主机 `ESRCH` 死主判定 + `.acquire` 门回收（`stat` 前后 `ino/dev` 复核防误删新门） | `shared-state-lock.js`（247 行） |
| ② 配置事务 | 同上锁协议 + `tmp→rename` + 锁忙时 `_configReadOnly` 降级为只读 | `config-lock.js`（151 行） |
| ③ 进程内按路径串行 | `Map<path, Promise 链>`，同路径串行、异路径并行 | `path-write-queue.js`（53 行）、`memory-writer._queue` |
| ④ 文档级锁 | `<file>.lock` 复用 ① 协议（async + sync 双版互相排斥） | `memory-writer.js:441–:592` |

**没有锁的写入点（据现有证据）**：`polling-heartbeat.json`（多实例按 pid 合并，天然最后写者胜）、`workspaces-summary.json`（**待验证**）、`memory/semantic/*.jsonl`（Python 侧追加写，读取端靠内容指纹去重）。

---

## 5. 后台活动

### 5.1 `lib/index.js` 里的 6 个 `setInterval`（全部注册在 `apply()` 内）

| # | 间隔 | 行号 | 用途 | unref | 与第二宿主冲突可能性 |
|---:|---|---|---|---|---|
| 1 | `teamSyncIntervalMs`（默认 **5000 ms**，下限 5000，`:1078`） | `:15886` | 团队线 `_teamPull.pullOnce()` 轮询；把已应用条目转成注入候选 | ✅ `:15919` | **高**：两个宿主同时对同一 team 端点 pull，会重复拉取；去重靠 `_teamPull` 内部 done 标记 |
| 2 | **60 s** | `:16302` | `hubFeedTick`：增量读 `memory/semantic/judgement-shadow.jsonl` → 富化 → `hub.ingestJudgement` | ✅ `:16304` | **高**：内容指纹游标导致两个宿主各自消费同一批行 ⇒ `ingestJudgement` 可能双记 |
| 3 | `max(5, pythonHealthPollMs \|\| 300000)`，首轮延迟 **90 s** | `:16352`（JS 语义模型下载完成轮询，1 s × 1800 次上限）；`:16845`（Python sidecar 健康首检 90 s） | 下载完成补建 `embedding-config.json`；Python 长驻进程健康巡检 | ✅ `:16376` / `:16851` | 低（各自进程内状态），但若两宿主共享 `python-engine/` 则 venv 争用需闸门 |
| 4 | **3600 s** | `:17282` | `fetchNotices` 拉 `notices.json`（GitHub raw） | ✅ `damUnrefTimer` | 低（只读网络，写 `notices-cache-pre.json`） |
| 5 | **300 s** | `:21077` | 重试队列里失败的自动沉淀（`pendingConsolidations`，条目存活 30 min） | ✅ `damUnrefTimer` | **中**：两宿主都会重试自己内存里的队列（队列本身不落盘，故不会双写；但会各自 spawn 沉淀子代理） |
| 6 | **15 s** | `:21098` | `writeHeartbeat()` + `tickTime()`（暂离检测/定时总结）+ `subagentGcSweep()` + `tickAutoContinue()` + `sessionArchiveSweep()` + `_wbRotateTick()` | ✅ `damUnrefTimer` | **高**：`writeHeartbeat` 已显式按 `pid:startedAt` 合并多实例（`:21027-21074`）；其余五个 tick 各自有配置门与节流，但**没有跨进程租约** |

其余 `setTimeout`（14 处）均为单次：`hubBootTimer` 90 s（`:16306`，unref）、健康首检 90 s（`:16845`，unref）、`turn-stopping` 后 600 ms 触发沉淀（`:17340`，**未 unref**）、目录选择器 5 min abort（`:20457`）、以及 8 处 `await new Promise(setTimeout)` 形式的轮询退避/超时（`:5923`、`:6201`、`:6304`、`:12133`、`:12746`、`:17177` 等）。

### 5.2 子进程

| 类型 | 位置 | 触发条件 | 说明 |
|---|---|---|---|
| **Python sidecar（长驻）** | `python-sidecar-client.js:605` `spawn(command, args, {shell:false, windowsHide:true, stdio:['pipe','pipe','pipe'], env:childEnv})` | 仅显式启用路径 lazy spawn；**默认关闭 = 零 Python 进程、零协议 IO**（`index.js:16804-16805` 注释） | 行协议 JSON-RPC；有 `--expect-epoch` 自证身份；健康轮询 `startHealthPolling`（`:952` `setInterval`） |
| **JS 语义 worker** | `semantic-js-process.js:88` `fork(new URL('./semantic-js-worker.js', import.meta.url), [], {execArgv:[]})` | `createJsSemanticEnginePre` 实际使用时 | 启动超时 120 s、单请求超时 120 s，`SIGKILL` 兜底（`:42`/`:61`） |
| **短命探活进程** | `python-runtime.js:41` `execFile(py, args, {timeout, windowsHide:true, maxBuffer:1MB})` | `probePythonRuntime`（带 60 s 缓存 + 单飞） | 只探测解释器/依赖版本 |
| **插件自建子代理** | 非 `child_process`：`subagents.startActivation()`（`index.js:1870-1909` 的 `callSubagentStartPre`） | 自动沉淀/总结/问候/技能提炼等 7 条 lane（`SUBAGENT_LANES:1776`） | **进程内**（宿主管理），无独立进程；有并发闸门（inflight ≥ 3 拒绝，`:12566`）+ 30 min 熔断 |

### 5.3 心跳 / lease

`writeHeartbeat()`（`:21018–:21076`）每 **15 s** 写 `~/.dsh/memory/polling-heartbeat.json`：

- 顶层保留**兼容面**单值字段（`pid` / `heartbeatAt` / `uptimeMs` / `queueLength` / `lastConsolidatedAt` / `todayCount`）指向**本进程**；
- 新增 `instances[]` 数组，按 `pid:startedAt` 去重（`SAME_INSTANCE_MS=1000` 容忍 1 ms 抖动），保留 `90 s` 内有心跳的实例（`ACTIVE_MS=90000`）；
- `instanceCount > 1` 即表示同一 `DSH_HOME` 下有多个宿主在跑——**这是当前唯一的「双宿主可见性」机制，不是租约**：没有单写者仲裁，没有 leader 选举。

---

## 6. 前端层

### 6.1 体量与加载方式

| 项 | 值 |
|---|---|
| 文件 | `lib/client.js`，**19,740 行** / 2,321,779 B（wc -l 口径） |
| 加载方式 | `package.json` 的 `dsh.client` 声明 `platform: "web"` + 6 个 `@deepseek-ai/dsh-client-*` inject；文件本体是**手写 `__ModuleLoader__` bundle**：`:10` `console.log(fingerprint)`、`:11` `window.__ModuleLoader__.load({id:'@a9i5k4/dsh-auto-memory', factory:(require)=>{…}})`、`:19721` `exports.apply = apply` |
| 依赖 | 只有两个宿主注入的 `require`：`:16` `require('react')`、`:23` `require('react-dom').createPortal`（失败降级 null）。另有 `exports.inject = ['slots','sessions','remote','remote.session']`（`:19703`） |
| 模板 | 无 JSX/编译：**4,190 处 `h(...)`** `React.createElement` 手写调用；457 处 `useState(`、139 处 `useEffect(` |
| 样式 | 4 处 `<style>` 注入；**255 处 `--dsw-*` 主题令牌**（21 个不同令牌）——直接依赖 DSH 设计系统变量 |
| 本地状态 | 96 处 `localStorage`（16 个 key，如 `dsh-auto-memory.panel.geom`、`dsh-auto-memory.fontScale.v2`、`dam-skin`） |
| 数据面 | 197 处 `apiGet/apiPost(` 封装；252 处 `API.xxx` 引用（**62 个不同端点**）；31 处裸 `fetch(` |
| 定时器 | 17 处 `setInterval` + 13 处 `setTimeout`（面板轮询/自动接续倒计时/皮肤轮播等） |

### 6.2 注册的宿主槽位（`slots.inject` + `slots.register`，`:19543–:19632`）

| 槽位 | 次数 | id / order | 作用 |
|---|---|---|---|
| `sidebar.footer.action` | 1 inject + 1 register | `auto-memory-pre` / order 5 | 侧栏「记忆」入口按钮 |
| `shell.overlay` | 3 inject + 3 register | `…-pre`(5) / `…-pre-dialogs`(6) / `…-pre-autocont`(7) | 左下角浮层面板、对话框宿主、自动接续确认卡 |
| `settings.section` | 1 + 1 | `auto-memory-pre` / 25 | DSH 设置页独立分区 |
| `settings.plugins.tab` | 1 + 1 | `auto-memory-pre` / 20 | 「设置 → 插件」页标签 |
| `plugins.detail.section` | 1 + 1 | `auto-memory-pre` / 20 | 插件详情页分区 |
| `conversation.view` | 3 + 3 | `…-panel`(78) / `…-kanban`(80) / `…-graph`(81) | 「记忆」「白板看板」「白板画布」三个并列会话页 |

合计 **10 条 `slots.inject`**（其中 `shell.overlay` ×3、`conversation.view` ×3）+ **10 条 `slots.register`**。

### 6.3 用的宿主路由 / API

- **宿主侧**：全部走 `lib/index.js` 注册的 `/api/dsh-auto-memory/*`（73 条中的 62 条被前端引用）；另引用 3 个非插件端点：`workbench`、`migrate*`、`subagent-probe` 等（均在 73 条内）。
- **宿主客户端 API**：`ctx.slots`（槽位）、`ctx.sessions`（`sessions.list.getSnapshot()` / `.subscribe()` / `sessions.open(id)`）、`ctx.remote`（`remote.session.prompt({requestId,sessionId,mode:'queue',content:[…]})`，`:7977-8026`）、`ctx.locale.getLocale()` / `ctx.on('locale/change')`、`ctx.effect`（6 处）、`ctx.cfg/.set/.field`（DSH 设置表单 API，各 1 处）。
### 6.4 能否脱离 DSH Web 客户端独立运行

**不能。依据（可复核）**：

1. **加载契约是宿主专有的**：`:11` 直接调用 `window.__ModuleLoader__.load({id, factory})`——`__ModuleLoader__` 由 DSH Web 注入（`lib/index.js` 侧无此定义，`client.js` 内也无 shim）。脱离宿主该文件立即 `TypeError: Cannot read properties of undefined (reading 'load')`。
2. **`apply(ctx)` 的入参是宿主槽位服务**：`:19237` `var slots = ctx.slots; if (!slots) { console.warn('slots service unavailable'); return }`——没有 `ctx.slots` 就整个前端不渲染（显式早退）。
3. **UI 依赖宿主设计系统**：255 处 `--dsw-*` 令牌 + 宿主 `z-index:20` 堆叠上下文假设（`:11536`、`:14156` 注释），换成任何非 DSH 页面都会样式崩坏。
4. **数据面依赖宿主同源 HTTP**：197 处 `apiGet/apiPost` 打 `/api/dsh-auto-memory/*`，这些路由由 `ctx.webServer` 注册，ZCode 没有该能力（见表 #2，C 级）。

**若要在 ZCode 保留面板，需走 ZCode UI Plugin（MCP Apps，仅 Desktop 本地工作区）重建**——重建面按源码结构估算（**推断，非实测**）：

| 重建块 | 对应 client.js | 行数量级 |
|---|---|---|
| 槽位/注册层（`apply` + 10 条 inject/register + 生命周期） | `:19203–:19726` | ≈ 520 行 |
| 记忆面板（概览/日志/笔记/反思/检索 5 页签 + 抽屉/浮层） | `:16000–:18800` | ≈ 2,800 行 |
| 白板看板 + 白板画布（2 个 `conversation.view`） | `:16671–:17400` + graph 部分 | ≈ 1,500 行 |
| 设置页（4 个槽位共用同一组件 `Iter5HostSettings`） | `:11000–:15300` | ≈ 4,300 行 |
| 皮肤中心 / iter5 视觉层 / i18n / CHANGELOG 内嵌文案 | 散落全文 | ≈ 6,000 行 |
| 数据适配层（197 处 apiGet/apiPost → ZCode IPC/MCP 调用） | 全文 | ≈ 2,000 行 |
| 其它（tour、greet、auto-continue 卡、storage、team 面板） | 散落 | ≈ 2,600 行 |
| **合计** | | **≈ 19,700 行（≈100% 重写）** |

---

## 7. 三堆统计（实测）

### 7.1 口径

- **行数**：`wc -l`（= 文件中 `\n` 个数），与 `split('\n').length` 差 1。**本文全部用 wc -l**。
- **字节**：UTF-8 `Buffer.byteLength`。
- **范围**：`lib/*.js` 113 个模块（排除 `.bak*` 等备份变体，它们不计入任何一堆）。

### 7.2 总数与占比

| 堆 | 文件数 | 行数 | 行占比 | 字节数 | 字节占比 |
|---|---:|---:|---:|---:|---:|
| **A 可直接复用** | **94** | **27,475** | **36.53%** | 1,458,123 | **25.89%** |
| **B 需适配层** | **13** | **4,930** | **6.55%** | 266,930 | 4.74% |
| **C 必须重写** | **6** | **42,805** | **56.91%** | 3,906,770 | **69.37%** |
| **合计** | **113** | **75,210** | 100% | 5,631,823 | 100% |

校验：27,475 + 4,930 + 42,805 = **75,210** ✅；36.53% + 6.55% + 56.91% = **99.99%**（四舍五入）。

### 7.3 C 堆内部拆解（为什么 6 个文件吃掉 56.91% 的行）

| 文件 | 行数 | 占全部行 | 重写性质 |
|---|---:|---:|---|
| `lib/index.js` | 21,141 | 28.11% | **宿主壳**：`apply()` 5,583 行 + `MemoryEngine` 类 13,184 行（58.6% 字节）+ 73 路由 1,969 行 |
| `lib/client.js` | 19,740 | 26.25% | **浏览器 bundle**：整体报废，见 §6.4 |
| `lib/python-sidecar-client.js` | 1,043 | 1.39% | Python 行协议客户端（1,043 行） |
| `lib/python-setup.js` | 533 | 0.71% | venv/pip/模型下载向导（533 行） |
| `lib/python-runtime.js` | 198 | 0.26% | 解释器探测（198 行） |
| `lib/semantic-js-process.js` | 150 | 0.20% | Node worker fork 宿主（150 行） |

> **关键判断**：C 堆的 56.91% 里，**`index.js` + `client.js` = 40,881 行（54.36%）**。扣除这两个巨型文件后，真正需要重写的「引擎内部」只有 1,924 行（3 个 Python 模块 + 1 个 worker 宿主）。

### 7.4 另一种口径：引擎可移植部分

若把问题拆成「引擎」与「宿主外壳」两层：

| 层 | 组成 | 行数 | 占比 |
|---|---|---:|---:|
| **宿主外壳（必换）** | `lib/index.js`（apply + 路由 + 工具注册）+ `lib/client.js` | 40,881 | 54.36% |
| **引擎（可移植）** | 其余 111 个模块 | 34,329 | 45.64% |
| — 其中 A 堆 | 94 个模块 | 27,475 | 36.53% |
| — 其中 B 堆 | 13 个模块 | 4,930 | 6.55% |
| — 其中 C 堆（引擎内子进程 4 模块） | 4 个模块 | 1,924 | 2.56% |

### 7.5 复算命令

```bash
cd D:\dsh-auto-memory
node artifacts/_zcode-port/count-lib.cjs
# 输出：TOTAL files=113 lines=75210 bytes=5631823
#       A 可直接复用  files=94  lines=27475(36.53%) bytes=1458123(25.89%)
#       B 需适配层    files=13  lines=4930(6.55%)   bytes=266930(4.74%)
#       C 必须重写    files=6   lines=42805(56.91%) bytes=3906770(69.37%)

# 交叉核验（wc 口径，PowerShell）：
#   (Get-ChildItem lib\*.js | Where-Object {$_.Name -notmatch '\.bak'}).Count   # => 113
#   (Get-Content lib\index.js).Count   # => 21141
#   (Get-Content lib\client.js).Count  # => 19740
```

---

## 8. 引擎能否脱离 DSH 宿主被 import（专项）

### 8.1 `import 'lib/index.js'` 的顶层副作用——实测扫描结果

扫描方法：逐个模块找**缩进 0 且非 import/export/function/class/const/let/var** 的可执行语句，以及缩进 0 的 `process.env` 读。

**结论：`lib/index.js` 顶层零 IO、零 timer、零 `process.env` 读取。** 374 条顶层语句全部是 `import`（94 条）、`export const/function`（约 30 条）、`const`/`function`/`class` 声明（其余）。唯一一处「看起来像执行」的是 `:37` `const execP = promisify(cpExec)`（只是包装，不起进程）。

全 `lib/` 范围内，**模块级副作用只有 1 处**：`lib/semantic-js.js:78` `const DEV_TREE_ENABLED = process.env.DAM_DEV_TREE === '1'`（纯读，无 IO）。其余 112 个模块的顶层**全部是声明**。

> 附带发现：`lib/m4-corpus.js:76-77` 的两行 `existsSyncIo` / `readFileSyncIo` 被我的粗扫描命中，实为**函数体内**的辅助函数（缩进 0 是因为 `function` 关键字顶格），非模块级调用。

### 8.2 `new MemoryEngine()` 能否在纯 Node 下构造——逐条判据

`MemoryEngine` 类在 `:2364`，**未 export**（`index.js` 的 export 清单里没有它；`:21133`/`:21135` 只导出工具函数与 `SessionRuntimeStore`）。构造器（`:2365–:2394`）实际做的事：

| 构造期动作 | 是否触宿主 / IO | 判据 |
|---|---|---|
| `this.config = { ...DEFAULT_CONFIG }` | 否 | 纯对象字面量 |
| `new SessionRuntimeStore()` | 否 | 纯内存 Map/WeakMap |
| `new AsyncLocalStorage()` | 否 | `node:async_hooks` |
| `new Map()` ×2 | 否 | 纯内存 |
| **`this._configPath = path.join(dshHome(), 'dsh-auto-memory.json')`** | **是（读 env + homedir）** | `dshHome()` → `resolveDshHomePre()` 读 `process.env.DSH_HOME` 与 `os.homedir()`；**不写盘** |
| 各种标量字段初始化 | 否 | — |
| `new ExternalMemory(this)` | 否 | 构造器只 `this.engine=…; this._cacheByWorkspace=new Map()` |

**结论：`new MemoryEngine()` 在纯 Node 下可以构造**（唯一副作用是读环境变量 + `os.homedir()`，可通过 `DSH_HOME` 注入隔离）。但有两个前提：

1. **必须先 `export` 该类**——当前 `MemoryEngine` 是模块私有 class。ZCode 适配层无法 `import { MemoryEngine }`。最小改动是加一行 `export { MemoryEngine }`（**本文不改**，仅指出可行性）。
2. **构造后 config 只是 `DEFAULT_CONFIG`**，真实配置要调 `loadConfig()` / `loadConfigSync()`；这两条路径会读写 `~/.dsh/dsh-auto-memory.json` 并走 `config-lock`（跨进程锁）。在 ZCode 里应传入独立 `DSH_HOME` 或改用配置注入，避免与 DSH 实例抢同一把锁。

### 8.3 哪些方法强依赖 `ctx.*`

| 机制 | 实现 | 强依赖程度 |
|---|---|---|
| `withAgent(agent, cb)` | `:2491-2493` `this._runtimeContext.run(this.runtimeFor(agent), callback)` | **无宿主依赖**。只需要一个带 `.session.id`/`.session.header.id` 的对象（`hasReliableSessionIdentity` `:2502`）。ZCode 只需伪造 `{session:{id,header:{cwd}}}` 形状 |
| `runtimeFor` / `stateFor` / `capturePathsFor` | `SessionRuntimeStore`（`:2132`） | **无宿主依赖**（纯内存） |
| `resolvePaths(agent)` | `:3605` | 读 `agent.session.header.cwd`；缺失时走 `sessionWorkspaceFallback` → `workspaceRegistry`（`:3670`，**惰性 `ctx.get`**，缺失则回退扫 `sessions/` 目录） |
| `_sourceTurnStatusPre(sid)` | `:5687` 读 `this._agentSvc.get(sid).status` | **强依赖** `ctx.get('agents')`；缺失时返回 `'unknown'`（保守侧：继续等） |
| `restoreLastAgent()` | `:11123` 读 `this._sessionsSvc.list()` + `this._agentSvc.get()` | **强依赖** `sessions` + `agents` 两个服务；缺失时早退 |
| `runSubagent(...)` | `:12515` / `_runSubagentOnce` `:12523` | **强依赖** `ctx.get('subagents')`：`list()` / `startActivation()`；缺失直接 `return ''` |
| 自动接续 `executeContinuation` | `:5746` 起 | **强依赖** `ctx.get('sessionController')`（`create/selectModel/prompt/cancel`）；缺失抛 `sessionController service unavailable` |
| 工作台 `ensureWorkbench` | `:12088` 起 | **强依赖** `sessionController` + `workspaceRegistry` + `permissionPresets` 三者 |
| `sessionWorkspaceFallback` | `:3662` | `workspaceRegistry` 缺失时**可降级**为扫 `sessions/` 目录读首行 cwd |
| 水位 `checkWaterLevel` | `:5086` | `tokenMeter` 缺失时**可降级**为启发式估算（`meterLayer='heuristic'`，`:5168`） |
| 三注入面（`systemPrompt.context/section`） | 不在引擎内，在 `apply()` 里 `:17460/:18203/:18213` | 引擎只提供 `renderMemoryDynamic(context)` / `renderMemoryStatic()` / `renderTailFor(agent)` 三个**纯渲染方法** |
| 工具/路由 | 不在引擎内 | `defineTool(...)`（`:13908`）与 `routes` 数组（`:19046`）都在 `apply()` 作用域 |

### 8.4 可行性判据（「ZCode 端直接复用引擎」）

| 判据 | 结论 | 证据 |
|---|---|---|
| `import 'lib/index.js'` 是否安全（无顶层副作用） | **✅ 安全** | §8.1：顶层零 IO / 零 timer / 零 env 读取 |
| 能否只 import 子模块（绕过 index.js） | **✅ 可以** | A 堆 94 个模块全部 ESM `export`，`index.js` 只是它们的组装者；`import { createFactStorePre } from './lib/fact-store.js'` 无需 index.js |
| 能否 `new MemoryEngine()` | **⚠️ 可以，但要先 export** | §8.2：构造器唯一副作用是读 env+homedir；当前 class 未 export |
| 引擎主链路（注入/检索/写入/白板/技能）能否脱离 `ctx` 跑 | **✅ 能** | 上述三个 `render*` 方法与 `resolvePaths`/`runtimeFor`/`withAgent` 均无宿主依赖；服务缺失处全部 fail-soft 或 fail-closed，不抛 |
| 哪些功能**结构性**无法脱离 | **❌ 4 类** | ①一键接续（`sessionController`）②工作台（`sessionController`+`workspaceRegistry`+`permissionPresets`）③后台 AI 提炼/沉淀（`subagents`）④水位精确计量（`tokenMeter`，可降级启发式） |
| ZCode 侧最小适配层要伪造什么 | — | 一个 `ctx` 形状的对象：`{ get(name), on(event,fn), effect(fn,label), systemPrompt:{context,section}, tools:{register} }`，其中 `get()` 对 6 个服务返回 `undefined` 即可让引擎降级运行（功能面缩水但**不崩**） |

**总判据：引擎层（34,329 行 / 45.64%）可移植，宿主外壳（40,881 行 / 54.36%）必换。** 「直接复用引擎」在技术上成立，前提是补一个 ~200–400 行的 `ctx` 适配层（伪造 `get/on/effect/systemPrompt/tools` 五个成员）——**这是本测绘给出的最高杠杆点**。

---

## 9. 三个最大耦合点（结论）

| 排名 | 耦合点 | 量化 | 为什么是最大 |
|---:|---|---|---|
| **1** | **73 条 `ctx.webServer` 路由 + 62 个前端消费端点** | `index.js:19046–21014`（1,969 行）+ `client.js` 197 处 `apiGet/apiPost` | ZCode 无 HTTP 路由能力 ⇒ 后端 73 路由全废、前端 197 个数据调用全废；面板必须走 ZCode UI Plugin 重建（≈19,700 行，100% 重写） |
| **2** | **会话创建/切换控制器（`sessionController` + `workspaceRegistry` + `permissionPresets`）** | `index.js` 内 12 个惰性取用点 + 工作台 6 个写路径 | 「一键接续」「工作台」「子代理承载」三大功能**全部结构性依赖**这三服务；`workspaceRegistry` 还承担 `resolvePaths` 的工作区回落（`:3670`）。三者在 ZCode 均无对应（C/D 级） |
| **3** | **`systemPrompt` 双注入面 + `agent/pre-step` waterfall 的时序契约** | `:17460` / `:18203` / `:18213` 三个 surface + `:17349` pre-step | 注入正确性依赖 DSH 特有细节：`text()` 每请求调两次、pre-step 可 await、`section` 必须字节稳定做前缀缓存锚。换成 ZCode 钩子后**必须重新验证「一请求几帧」**，否则完整版/精简版会被后来的帧覆盖（这正是本插件 v3.3.6→v3.3.7 踩过的真实缺陷） |

---

## 10. 未验证项（明确标注）

| 项 | 状态 | 原因 |
|---|---|---|
| `layout-config.json` 的具体写入锁 | **待验证** | 只确认 `config-lock` 同族存在，未逐条追调用点 |
| `workspaces-summary.json` 是否有锁 | **待验证** | 只找到 3 处写点，未确认是否经 writer |
| `client.js` 各重建块的精确行数 | **推断** | 按源码区段粗分（§6.4），未逐函数统计 |
| ZCode UI Plugin（MCP Apps）的真实能力边界 | **待研究线 A** | 本文只按「ZCode 无 HTTP 路由、无内嵌 Web 前端」的前提推导；`01-zcode-host-surface.md` 应给出精确契约 |
| 双宿主并存时六个 tick 的实际冲突后果 | **待研究线 C** | 本文只给「无跨进程租约」的事实，冲突矩阵与对策由 `03-shared-store-coexist.md` 承担 |
| `lib/*.js` 之外（`python/`、`skins/`、`vendor/`）的移植面 | **未测绘** | 本任务范围限定 `lib/`；`python/` 排除 `bench/` 后为 10 个源文件，`skins/` 31 个文件 774 KB，`vendor/dsh-graph` 191 个文件 4.6 MB（TS 源码，非 `lib/*.js`） |

---

## 附录 A · 复算资产清单

| 文件 | 内容 |
|---|---|
| `artifacts/_zcode-port/count-lib.cjs` | 三堆统计脚本（113 文件分类 + 行数/字节/占比），`node count-lib.cjs` 直接出结果 |
| `artifacts/_zcode-port/module-table.md` | 113 行模块清单表（文件/行数/堆/依赖类型/职责/可原样 import） |
| `artifacts/_zcode-port/dump-measure.cjs` | 复现 `measure.json` 的全部原始测量（三堆 + ctx 计数 + 事件表 + 路由表 + 定时器） |
| `artifacts/_zcode-port/measure.json` | 原始测量快照：每文件 wc/bytes/sha256、三堆汇总、ctx 计数（含行号）、服务查找表、73 路由表、20 个定时器、8 个事件 |
| `artifacts/_zcode-port/routes-rows.md` | 73 条路由的行号↔端点对照（供 §1.2 #2 复核） |

## 附录 B · 任务书「初步结论」复核结果

| 任务书初步结论 | 复核 |
|---|---|
| 「`lib/*.js` 没有直接 import `@deepseek-ai`」 | ✅ **成立**（17 处引用全在注释；零 import） |
| 「宿主对象只经 `apply(ctx)` 注入」 | ⚠️ **基本成立，需补两跳**：`exec.agent.ctx.get()`（`:5171`）与 `parent.ctx.get()`（`:12584`）是二跳取服务 |
| 「`lib/index.js` 21141 行」 | ✅ 一致（wc -l = 21,141） |
| 「`lib/client.js` 19725 行」 | ⚠️ 现测 **19,740**（本日 #454 改动 +15 行后） |
| 「15 个 `memory_*` 工具 / 26 处 `path: API.` / 6 个 setInterval」 | ⚠️ **需修正**：`defineTool` 共 **19** 个（15 `memory_*` + 4 `calendar_*`）；`path: API.*` 共 **73** 处（26 处 `API.name` + 47 处 `API['name']`；其中 1 处与 `kind` 写在同一行，`API.teamControl`）；`setInterval` 共 **6** 个（与 Lead 口径一致 ✅） |

## 附录 C · `package.json` 与 `cordis.patch.yml` 的宿主耦合点

| 字段 | 值 | 移植影响 |
|---|---|---|
| `main` / `exports["."]` | `lib/index.js` | 节点半边入口，**必须重写**（C 级） |
| `exports["./client"]` | `lib/client.js` | 浏览器半边入口，**必须重写**（C 级） |
| `dsh.bundle.patch` | `./cordis.patch.yml`（10 行） | DSH profile roster 插行；ZCode 无 cordis，**D 级** |
| `dsh.client.inject` | 6 个 `@deepseek-ai/dsh-client-*` 包名 | DSH 客户端模块注入清单；ZCode 无，**D 级** |
| `dsh.client.platform` | `"web"` | ZCode 需 `desktop`/其它 |
| `peerDependencies` | `@deepseek-ai/cordis ^4.0.1` | 唯一硬 peer；ZCode 无 cordis |
| `optionalDependencies` | `@huggingface/transformers ^3.7.6` | **可选**，JS 语义臂（C2）使用；不装则退化为词法检索 |

**没有任何 `dependencies`**（`package.json` 无该字段）——除可选 peer transformers 外零第三方运行时依赖。这对移植是利好：**A 堆 94 个模块连 `node_modules` 都不需要**。
