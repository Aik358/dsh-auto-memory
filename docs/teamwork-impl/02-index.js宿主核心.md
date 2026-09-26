# 02 · lib/index.js 宿主核心 · 逐段读透与 Teamwork 改造

> 对象：`lib/index.js` —— **960,443 B / 14,653 行 / 4 个类 / 272 个方法 / 19 个工具 / 56 条路由**。
> 本卷按**运行时序**逐段读透，每段给出：现状（带行号）→ 数据流 → **Teamwork 改法（含可直接落地的代码）**。

---

## 一、文件骨架（实测行号）

| 区段 | 行范围 | 内容 |
|---|---|---|
| 头部常量 / API 表 | 1 – ~400 | `API` 映射（56 条路由名→路径）、依赖注入点 |
| `DEFAULT_CONFIG` | 368 – 1100+ | **119 个配置键**（含 `externalSources` 13 子键） |
| `ObserverRing` | 1279 | 观察环形缓冲（有界最小投影） |
| `SessionRuntimeStore` | 1471 | 每 session runtime 存储（ALS 隔离） |
| `MemoryEngine` | **1592** | **核心类，208 个方法**（1593–约 11000） |
| `ExternalMemory` | 10778 | 外部记忆源（WorkBuddy/CodeBuddy/…） |
| HTTP 辅助 | 10726 – 10760 | `isLoopbackRequest` / `writeJson` / `readJsonBody` / `isUnderMemoryTree` |
| `hygieneGateForPrimitive` | 11257 | 记忆卫生门（脏 token / 凭据过滤） |
| 插件注册区 | 12300 – 12615 | `ctx.on` ×8、`ctx.tools.register`、`ctx.webServer.register`、定时器 |
| 注入区 | **12614 – 12780** | `ctx.systemPrompt.context` 动态快照 + `ctx.systemPrompt.section` 静态规则 |
| 工具定义区 | **12774 – 13262** | 19 个 `defineTool` |
| 路由表 | **13263 – 14560** | 56 个 `{kind:'exact', path, handler}` |

---

## 二、运行时序总览（一次对话完整生命周期）

```
宿主启动
 └─ 插件 apply(ctx)
     ├─ 建 MemoryEngine（:1592）
     ├─ 注册 8 个 ctx.on（:12447-12612）
     ├─ 注册注入（:12617 context / :~13100 section）
     ├─ 注册 19 工具（:12774+，循环 :14636）
     └─ 注册 56 路由（:13263+，循环 :14637）

用户发消息
 └─ agent/pre-step（:12554，waterfall，可 await）
     ├─ 套娃防护：自家子代理直接放行（:12558）
     ├─ hasReliableSessionIdentity 判定（:12560）
     ├─ flushReasoningBuffer（:12566）      ← CoT 缓冲冲刷
     ├─ ingestAgentLifecycle（:12567）      ← 生命周期采集
     ├─ checkWaterLevelAtStep（:12570）     ← 水位与交接建议
     ├─ _activationHost.onPreStep（:12572） ← 激活包 claim
     ├─ stateFor + 15s 过期判定（:12578）
     │   └─ await withAgent(() => refresh(agent))（:12590）
     └─ next()

注入（宿主装配 context 时）
 └─ ctx.systemPrompt.context.text(context)（:12620）
     ├─ injectEnabled 总闸（:12631）
     ├─ capturePathsFor（:12639）
     ├─ renderMemoryDynamic（:12658）       ← ★动态快照唯一数据源
     ├─ 分级：turn 首个注入强制完整版（:12675）
     ├─ 节流：snapshotMinGapRounds（:12696+）
     └─ 返回 user-role 快照文本

模型输出 / 工具调用
 ├─ session/event（:12607）→ observeSessionEvent
 └─ tools/result（:12610）→ observeToolResult

回合结束
 └─ agent/turn-stopping（:12512）
     └─ setTimeout 600ms → consolidateTurn（:12546）  ← 自动沉淀

插件卸载
 └─ dispose（:12447）→ 5 个子系统 disposeAll + clearInterval
```

---

## 三、逐段读透与改造

### 3.1 【注入闸门】`ctx.systemPrompt.context`（:12617–12780）

**现状要点**
- 命名 `dsh:auto-memory-pre`（:12618），带 `order: SECTION_ORDER`。
- **总闸**：`engine.config.injectEnabled === false` 直接返回空串（:12631）—— 注释明确写出这是"死开关复活"，且**解耦要求**：只关这一条通路，不动静态规则段/ tail surface / 写入与检索。
- **唯一数据源**：`const snap = engine.renderMemoryDynamic(context)`（:12658）—— 注释警告这行曾被误删导致整段注入变空且**不报错**（外层 catch 吞掉 ReferenceError）。
- **分级注入**：`snap + engine.renderSlimSnapshotPre(wsHintPre)`，turn 内首次强制完整版（:12675-12695），其余轮给精简版。
- **去重**：靠宿主 `dsh-agent-loop project()` 的内容去重（:12615 注释），**插件侧不做去重**。

**Teamwork 改法**

> **这是团队记忆进入模型的唯一入口** —— 团队数据若要被模型看到，必须在这里合并。

**改动点**

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| I-1 | :12631 之后 | 只有本机 `injectEnabled` 总闸 | 追加 **团队注入闸**（正交，不合并开关） | 新增 1 行判定 + 1 个配置键 |
| I-2 | :12658 之后 | `snap` 只含本机内容 | 追加 **团队快照合并**（带来源标注与新鲜度） | 注入文本结构变化，需同步 smoke |
| I-3 | :12675 强制完整版 | 只判 turn 边界 | 追加 **团队版本变更也强制完整版**（团队库更新后必须让模型看到） | 新判定分支 |
| I-4 | 静态规则段（~13100） | `renderMemoryStatic()` | **不动**（缓存锚 + 属另一功能，改它会击穿前缀缓存） | 零改动 |

**可直接落地的代码**（插入位置已标注）

```js
// ===== 插入点 1：lib/index.js 的 ctx.systemPrompt.context 回调内，紧接 :12631 的 injectEnabled 判定之后 =====
// 团队注入闸：与 injectEnabled **正交**（用户硬性要求"单一开关不得顺带改变其他功能"）。
// 语义：关掉团队注入 ≠ 关掉本机注入；两者独立可关。
if (engine.config && engine.config.teamInjectEnabled === false) return ''

```

```js
// ===== 插入点 2：lib/index.js :12658（const snap = engine.renderMemoryDynamic(context)）之后 =====
// 团队快照：只读本地已同步副本，**绝不发起网络请求**（注入回调必须同步返回，不能 await）。
// 数据来源：sync-pull 落盘的 teamSnapshot（内存缓存 + 落盘兜底）。
let teamSnapPre = ''
if (engine.config && engine.config.teamEnabled && engine.config.teamInjectEnabled !== false) {
  try {
    // 同步读内存缓存；缓存未命中则读上次落盘的快照文件（零 await）
    teamSnapPre = engine.renderTeamSnapshotPre(agent) || ''
  } catch (_) { teamSnapPre = '' }
}
// 合并顺序：本机快照在前（人最关心自己的），团队快照在后（补充上下文）
const mergedPre = teamSnapPre ? (snap + teamSnapPre) : snap
// ★ 后续所有使用 snap 的地方改用 mergedPre（:12675 分支、:12692、:12696+）
```

```js
// ===== 新增方法：MemoryEngine.prototype.renderTeamSnapshotPre（建议放 renderMemoryDynamic 之后，:6618 附近） =====
/**
 * 渲染团队记忆快照（同步、零 IO 优先、绝不抛）。
 * 与 renderMemoryDynamic 的关系：**并列**，不修改对方；输出带来源标注与新鲜度。
 */
renderTeamSnapshotPre(agent) {
  const cfg = this.config || {}
  if (!cfg.teamEnabled) return ''
  const rt = this.runtimeFor(agent)
  const cache = rt && rt.teamCache
  if (!cache || !cache.text) return ''          // 没同步过就不注入，不阻塞
  // 团队版本未变则返回空（靠宿主 project() 去重之外再加一道，减少 token）
  const ver = cache.rev || 0
  if (rt._teamSnapRev === ver) return ''
  rt._teamSnapRev = ver
  const ageMs = Date.now() - (cache.at || 0)
  const ageTxt = ageMs < 60000 ? Math.round(ageMs / 1000) + ' 秒前'
    : ageMs < 3600000 ? Math.round(ageMs / 60000) + ' 分钟前'
    : Math.round(ageMs / 3600000) + ' 小时前'
  const lines = []
  lines.push('<team_memory rev="' + ver + '" synced="' + ageTxt + '">')
  if (cache.facts) for (const f of cache.facts.slice(0, 8)) {
    lines.push('- [' + (f.actor || '未知') + '] ' + f.title)
  }
  if (cache.procedures) for (const p of cache.procedures.slice(0, 5)) {
    lines.push('- [技能·' + (p.stage || 'observed') + '] ' + p.title)
  }
  lines.push('</team_memory>')
  return lines.join('\n')
}
```

**风险与回归**
- ⚠️ 注入文本变化会命中 **`missing memory_system block`** 类 smoke 断言 ⇒ 改前先跑 `tests/smoke` 中所有含 `memory_system` 的套件。
- ⚠️ `renderMemoryDynamic` 的输出是"字节级稳定以命中前缀缓存"（:12616 注释）⇒ **团队快照必须带版本号并在未变时返回空串**，否则每轮注入变化会击穿 DeepSeek 前缀缓存（这是本仓已解决过的问题，不能回退）。

---

### 3.2 【pre-step 门】`agent/pre-step`（:12554–12595）

**现状要点**（逐条，都是 Teamwork 的挂钩点）

| 行 | 逻辑 | Teamwork 含义 |
|---:|---|---|
| 12558 | **套娃防护**：自家子代理直接 `next()` | 团队同步触发的子代理必须走同一条路，否则会递归 |
| 12560 | `hasReliableSessionIdentity(agent)` 才处理 | **成员身份可以复用这个判据**：有可靠 session 身份 = 可归属到人 |
| 12566 | `flushReasoningBuffer(rt)` | 不影响 |
| 12567 | `ingestAgentLifecycle` | **可挂审计采集** |
| 12570 | `checkWaterLevelAtStep` | 水位是个人态，团队不改 |
| 12572 | `_activationHost.onPreStep` | 激活包是个人态 |
| 12579 | `!st.loadedAt \|\| now - loadedAt > 15000` | **团队同步可挂在同一个 15s 节拍上**（不必新增定时器） |
| 12590 | `await engine.withAgent(agent, () => engine.refresh(agent))` | ★**ALS 唯一写入点**，任何新增的 refresh 都必须包在 `withAgent` 内 |

**Teamwork 改法**

> **同步的"心跳"就挂在这里** —— 复用 15s 节拍，不新增定时器（新增定时器会增加宿主负担，且与既有 dispose 链冲突）。

```js
// ===== 插入点：lib/index.js :12590 之后（await refresh 之后，仍在 if (!skip && ...) 块内） =====
// 团队同步心跳：复用本处 15s 节拍。★ 必须 fire-and-forget（不 await），
// 否则网络慢会阻塞 pre-step ⇒ 直接拖慢每一轮对话（违反"本地优先"硬约束）。
if (engine.config && engine.config.teamEnabled && engine._teamSync) {
  try { void engine._teamSync.tick(agent) } catch (_) {}   // tick 内部全 catch，永不抛
}
```

```js
// ===== 新增文件：lib/team-sync.js（未来实施时） =====
/**
 * 团队同步心跳。设计约束（逐条对应硬规则）：
 * ① 永不 await 网络 —— 所有网络动作在 outbox 队列里异步跑；
 * ② 永不抛 —— 任何异常都被吞掉并记入本机降级账本；
 * ③ 幂等 —— 同一 tick 重复调用无副作用；
 * ④ 尊重用户开关 —— teamEnabled=false 时整个对象不被创建。
 */
export function createTeamSync({ engine, outbox, puller, conflictCenter, diag }) {
  let lastTickAt = 0
  let inflight = false
  const MIN_TICK_MS = 5000                 // 两次 tick 最小间隔，防抖
  return {
    /** 由 agent/pre-step 调用；同步返回，内部异步。 */
    tick(agent) {
      const now = Date.now()
      if (inflight) return                     // 单飞：上一次还没跑完就跳过
      if (now - lastTickAt < MIN_TICK_MS) return
      lastTickAt = now
      inflight = true
      // 用 queueMicrotask 而不是 await：让 pre-step 立刻放行
      queueMicrotask(async () => {
        try {
          await outbox.flush()                 // 先推：本机变更上行
          const r = await puller.pullOnce()    // 再拉：增量下行
          if (r && r.changed) conflictCenter.scan(r.changed)
          engine._markTeamSyncedAt(Date.now())
        } catch (e) {
          try { diag('team sync tick failed: ' + ((e && e.message) || e)) } catch (_) {}
        } finally { inflight = false }
      })
    },
  }
}
```

**风险**：`agent/pre-step` 是**关键路径**，任何在这里做的同步动作都必须 fire-and-forget；一旦有人把它改成 `await`，就会把每一轮对话拖慢一个 RTT（这是本项目历史上"卡顿"类故障的同类模式）。

---

### 3.3 【回合结束】`agent/turn-stopping`（:12512–12550）

**现状**：回合停止后 `setTimeout(600ms)` 才启动 `consolidateTurn`（:12545-12547），注释写明理由："避免与 DSH 会话收尾竞争导致进程级崩溃"。

**Teamwork 改法**：**沉淀产物分流**（本机日志 vs 团队待审区）。

```js
// ===== 插入点：lib/index.js :12546 的 consolidateTurn 完成后（建议改成一个 async 包装） =====
setTimeout(() => {
  void engine.withAgent(agent, async () => {
    try {
      await engine.consolidateTurn(payload.turn, agent)
    } catch (e) {
      console.error('[dsh-auto-memory] consolidateTurn unhandled', e && (e.stack || e.message) || e)
    }
    // ★ 团队分流：沉淀产物中"事实候选"进团队待审区（S2），个人日志仍留 S1。
    // 与 consolidateTurn 解耦（用户硬性要求）：团队关闭时这一行不产生任何行为。
    if (engine.config && engine.config.teamEnabled && engine._teamOutbox) {
      try { void engine._teamOutbox.enqueueFromConsolidation(payload.turn) } catch (_) {}
    }
  }).catch(() => {})
}, 600)
```

---

### 3.4 【卸载】`dispose`（:12447–12489）

**现状**：依次 dispose 5 个子系统（shadowHost / contextHost / activationHost / indexSyncHost / pythonSidecar）+ clearInterval（retryTimer / heartbeatTimer）+ `_hubFeedDisposers` + `_memoryHub` + `runtimes.disposeAll()`。

**Teamwork 改法**：**必须在此 flush 同步队列**，否则未推送的变更会丢（下次启动才知道）。

```js
// ===== 插入点：lib/index.js dispose 回调内，runtimes.disposeAll() 之前 =====
// 团队同步收尾：① 落盘 outbox（保证下次启动可续推）② 断开轮询 ③ 不等待网络。
try { if (engine._teamOutbox) engine._teamOutbox.persistSync() } catch (_) {}
try { if (engine._teamSync) engine._teamSync.dispose() } catch (_) {}
```

**判据**：`persistSync()` 必须是**同步**落盘（用 `writeTextAtomicPreSync`，本仓已有，见 `lib/config-io.js`）—— 异步 flush 在 dispose 阶段不保证执行完。

---

### 3.5 【观察层】`session/event` + `tools/result`（:12607–12612）

**现状**：只观察、有界最小投影（`ObserverRing`，:1279）；无可靠 owner 的事件被丢弃留痕，**绝不落入 default runtime**。

**Teamwork 改法**：这是**审计证据链的天然采集点**。

```js
// ===== 插入点：lib/index.js :12611 之后 =====
ctx.on('team/audit-point', (session, evt) => {   // 自定义事件（团队版新增）
  try { if (engine._teamAudit) engine._teamAudit.ingest(session, evt) } catch (_) {}
})
```

**注意**：审计必须走**追加日志**（P2 原语），不得覆盖；且不得把事件全文上报（只上报类型 + 摘要 hash）。

---

**下一节（本卷续）**：3.6 工具定义区 · 3.7 路由表 · 3.8 配置键分层 · 3.9 实施顺序

---

### 3.6 【工具定义区】19 个 `defineTool`（:12774–13262）

这一区**全部是模型可调用的入口**，是 Teamwork 最需要改的地方 —— 因为**团队的"人"是通过工具调用产生的**。

**逐个的改造定位**（详细代码在各模块卷，此处给汇总）：

| 工具 | 行 | 它写什么 | 团队改造要点 |
|---:|---:|---|---|
| `memory_log` | 12774 | 当日日志（append-only） | **保持 S1 个人云**；仅当 `kind=rule` 时提示可升团队 |
| `memory_note` | 12799 | 项目笔记/白板/账本（kind=note/handoff/plan） | ★**核心**：加 `scope` 判定 + `actor` 注入 + 冲突预检 |
| `memory_user` | 12887 | 用户级 MEMORY.md（跨项目规则） | ★**团队规则库的主入口**：需权限判定 + 整篇冲突走人工 |
| `memory_read` | 12916 | 读（日志/反思/用户/笔记/日历） | 读路径需能读团队副本 + 标注来源 |
| `memory_recall` | 12939 | 召回 | 结果需带 `origin`（本地/团队） |
| `memory_maintain` | 12947 | 30 天蒸馏 | **本机运维**，不动 |
| `memory_status` | 12951 | 诊断 | 需加「团队同步状态」一节 |
| `memory_reflect` | 12963 | 每日反思 | 个人云 + 私密标记 |
| `memory_external` | 12968 | 外部记忆源 | **纯本机**，但导入后的条目走普通规则 |
| `calendar_add` | 12989 | 日历新增 | ★**团队/个人双轨**，创建时必须选轨道 |
| `calendar_list` / `done` / `remove` | 12999/13013/13019 | 日历读写 | 团队条目 P1 + 墓碑 |
| `memory_rules` | 13025 | 规则条目增删改（带 expect 锚） | ★**团队治理核心**：分层 + 权限 + 审计 |
| `memory_consolidate` | 13057 | 手动触发沉淀 | 个人云 |
| `memory_procedure` | 13077 | 技能写入/激活 | ★**共享核心**：内容寻址 id + 审批流 |
| `memory_procedure_list` | 13168 | 技能列表（双库） | 读需带库归属 |
| `memory_expand` | 13253 | 白板 tag 展开 | 读（看板） |
| `memory_trace` | 13257 | 白板溯源 | 读（审计） |

**统一改造手法（19 个工具共用一段包装，而非逐个改）**

> 这是本卷**最重要的实施技巧**：不要逐个改 19 个 execute，而是在**唯一的注册循环**里加一层包装。

```js
// ===== 改法：lib/index.js :14636 附近的注册循环（原样） =====
for (const tool of tools) {
  const rawExec = tool.execute
  if (typeof rawExec === 'function') {
    tool.execute = async (args, exec) => {
      const agent = exec && exec.agent
      return agent ? engine.withAgent(agent, () => rawExec(args, exec)) : rawExec(args, exec)
    }
  }
  disposers.push(ctx.tools.register(tool))
}

// ===== 改造后：在既有包装**之外**再套一层"团队信封"（不动内层，保护既有语义） =====
for (const tool of tools) {
  const rawExec = tool.execute
  if (typeof rawExec === 'function') {
    tool.execute = async (args, exec) => {
      const agent = exec && exec.agent
      const run = () => rawExec(args, exec)
      // 内层：既有 agent 绑定（原文照抄，零改动）
      const bound = agent ? engine.withAgent(agent, run) : run()
      // 外层：团队信封 —— 只在开启时生效
      if (!engine.config || !engine.config.teamEnabled || !engine._teamEnvelope) return bound
      return engine._teamEnvelope.wrap(tool.name, args, agent, bound)
    }
  }
  disposers.push(ctx.tools.register(tool))
}
```

```js
// ===== 新增文件：lib/team-envelope.js（未来实施时） =====
/**
 * 团队信封：包住每一次工具调用，做三件事（全部 fail-soft，绝不阻断本机功能）：
 *  ① 身份注入：把本次写入归属到成员（actor）—— 这是"记忆有主人"的唯一来源；
 *  ② 作用域裁决：决定这次写入落 S1（个人云）还是 S2（团队库）；
 *  ③ 出队：把 S2 的写入放进 outbox（异步上行，不阻塞工具返回）。
 * 设计判据：**信封失败必须降级为"仅本机写入"**，绝不能因为团队故障而让工具报错。
 */
export function createTeamEnvelope({ engine, outbox, identity, scopeOf, diag }) {
  return {
    async wrap(toolName, args, agent, bound) {
      let actor = null
      try { actor = identity.currentActor(agent) } catch (_) {}
      // ① 先执行本体：本机写入永远优先、永远不因团队失败而失败
      const result = await bound
      // ② 结果拿到后再决定是否上行（下行失败不影响已完成的写入）
      try {
        if (actor && scopeOf.isTeamWritable(toolName, args)) {
          outbox.enqueue({
            tool: toolName,
            args: redactForTeam(args),        // ★ 必须脱敏：去掉本机路径/用户名
            actor: actor.id,
            at: Date.now(),
            origin: engine.originOf(agent),   // 设备 + 工作区
          })
        }
      } catch (e) {
        try { diag('team envelope enqueue failed: ' + ((e && e.message) || e)) } catch (_) {}
      }
      return result
    },
  }
}
```

**★ 关键设计判据（写进代码注释，防后人改错）**
- **先执行本体、后 enqueue** —— 反过来会让团队故障拖死本机写入；
- **enqueue 不 await** —— outbox 内部自己管重试；
- **脱敏必须在这里做**（`redactForTeam`），不能指望服务端 —— 因为服务端不该看到本机路径。

---

### 3.7 【路由表】56 条（:13263–14560）

**现状**：33 条具名 `API['name']` + 23 条字面 `API.name`；**全部走回环守卫**；33 条 POST 限定。

**Teamwork 改法**：**不新增路由**（避免 9 处计数落点连锁改动），而是**在既有路由里加字段**。

理由（实测支撑）：本仓既有纪律 —— **每新增 1 条路由牵动 9 处计数落点**（HANDBOOK 5 处 + smoke-test-api-paths 白名单 1 处 + 3 个 smoke 硬锁）。加 6 条路由 = 54 处要一次改全，风险远高于收益。

**因此：团队状态通过既有 3 条路由暴露**

| 复用路由 | 加什么字段 | 前端用法 |
|---|---|---|
| `state`（:13901） | `team: { enabled, member, teamName, syncAt, queue, conflicts }` | 同步状态条、成员区 |
| `memory-hub`（:13725） | 每条记录带 `actor` / `scope` / `rev` | 记忆库作者徽标、库归属 |
| `config`（:14218） | `team.*` 读取与写入 | 设置页团队分区 |

```js
// ===== 插入点：lib/index.js :13901 state 路由的响应体（找到 writeJson(res, 200, {...}) 处） =====
// 只加字段，不改既有字段（前端旧代码零破坏）
const body = engine.state()          // 原文照抄
// ★ 团队附加段：teamEnabled=false 时给 null（前端据此隐藏全部团队 UI）
body.team = (engine.config && engine.config.teamEnabled && engine._teamState)
  ? engine._teamState.snapshot()     // {enabled, member, teamName, syncAt, queue, conflicts}
  : null
writeJson(res, 200, body)
```

---

### 3.8 【配置键分层】配置键（115–119）→ 三层

**现状**：`DEFAULT_CONFIG` 共 **119 个顶层键**（另有 `externalSources` 13 子键），全部扁平。

**问题**：Teamwork 要加团队策略，但**不能把团队策略和设备偏好混在一层** —— 否则一个人改主题会污染全团队（旧调研已识别的 R10 风险）。

**改法：新增 14 个 `team.*` 键（带点号前缀，物理上仍是扁平键，但按前缀分派作用域）**

```js
// ===== 插入点：lib/index.js DEFAULT_CONFIG（:368 起）内，建议放数组末尾 =====
// ---- 团队（Teamwork）----
// 全部默认「关闭」。★ teamEnabled=false 时以下键**不产生任何行为**（含零网络、零文件）。
teamEnabled: false,                  // 总开关
teamServerUrl: '',                   // 团队服务端地址（空=未配置）
teamId: '',                          // 团队/租户 ID（每个请求都带，服务端据此隔离）
teamProjectId: '',                   // 团队项目 ID（解决 wsKey 跨机不汇合）
teamMemberName: '',                  // 本机成员显示名
teamInjectEnabled: true,             // 团队记忆是否参与注入（与 injectEnabled **正交**）
teamSyncChannels: 'all',             // all | text-only | manual
teamTextBudgetMs: 5000,              // T1 秒级通道预算
teamVectorLagMs: 300000,             // T3 异步通道预算（向量 5 分钟）
teamConflictPolicy: 'mixed',         // auto | manual | mixed
teamExcludedPaths: ['**/*-pre/**', '**/*.bak', '**/*.bak-*', '**/polling-heartbeat.json', '**/update-check*.json'],
teamEncryptionMode: 'none',          // none（默认，遵既有裁定）| enterprise-key
teamAuditEnabled: false,             // 审计开关
teamShowMemberBadges: true,          // 前端是否显示成员标识
```

**★ 分层判据（写进注释）**：

```js
// 团队策略（随团队库同步、管理员优先） vs 设备偏好（纯本机、不参与同步）：
//   team.*            → S2 策略层（可被管理员下发覆盖）
//   其余 119 键       → 默认 S0 本机；其中外观/主题类键**永不进 S2**
// 判据：凡"换台机器我愿意重新设一遍"的键 → S0；凡"团队要求统一"的键 → S2。
```

---

### 3.9 【实施顺序】（本文件的落地次序，按依赖排列）

| 序 | 改动 | 依赖 | 验收 |
|---:|---|---|---|
| 1 | 加 14 个 `team.*` 配置键 | 无 | `config` 路由能读写；默认全关时**行为与本轮一致** |
| 2 | 加 `team-auth.js` 出站鉴权 | 1 | 单测：未配置/未登录/超时三种情形均返回 `{ok:false}` 且不抛 |
| 3 | 加 `renderTeamSnapshotPre` + 注入合并 | 1 | 未同步时注入文本**逐字节不变**（回归全绿） |
| 4 | 加 `pre-step` 同步心跳 | 2,3 | 关掉开关后 pre-step 耗时与基线一致 |
| 5 | 加 `team-envelope` 工具包装 | 2 | 19 个工具正常；团队关闭时零行为差异 |
| 6 | `state` 路由加 `team` 字段 | 1 | 旧前端字段不变；新字段为 null 时不渲染 |
| 7 | `dispose` 加队列落盘 | 5 | 重启后 outbox 内容仍在 |

**每一步都必须是"关掉开关 = 与本轮逐字节一致"**，这是企业交付的验收底线。

---

**下一卷**：[03 · 数据层模块（fact-store / procedure-store / evidence / hub-io）](modules/00-模块总览.md)
