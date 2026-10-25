# v4 底层改造 · 代码级施工文档（Code-Level Construction Spec）· 2026-10-24

> **本文件是 v4 底层改造的唯一代码级施工依据**。上位文档：`V4-MASTER-PLAN-2026-10-24.md`（顺序与验收）、`V4-H-BATCH-SCHEDULE-2026-10-24.md`（批次排期）。
> **架构图**：`artifacts/_diagrams/v4-h-architecture.svg` / `.png`（1560×1260，含六段判据与三步存量转换）。
> **所有行号均为 2026-10-24 实测**，改动前须重新核对（行号会随改动漂移）。

---

## §0 · 六段判据（本改造的验收总纲）

缺任一段 = **假完成**。这是本轮最重要的判据，因为前几轮就是只做了「事件」和「前端」两段就宣布完成了。

```
① 写入 → ② 事件 → ③ 投影 → ④ 注入 → ⑤ 检索 → ⑥ 前端
   ↑ H1      ↑ 已有    ↑ H2/H3    ↑ H4-H8    ↑ H9      ↑ H4
```

| 段 | 判据 | 现状 |
|---|---|---|
| ① 写入 | 所有「记一件事」的工具都写入事件 | ❌ 8/8 绕开 |
| ② 事件 | event-store.json 是唯一真源 | ✅ 已建（16 字段） |
| ③ 投影 | 日视图/白板/账本由事件派生 | ❌ 各自独立写 |
| ④ 注入 | 事件是主材料，四 percept 全渲 | ❌ 事件仅附加段，percept 0 消费 |
| ⑤ 检索 | `all` scope 含事件 | 🔶 只有显式 `scope='events'` |
| ⑥ 前端 | 事件卡展示四段 + percept | 🔶 只有四段 |

---

## §1 · 现有代码资产清单（实测，可直接复用）

### 1.1 后端 `lib/index.js`（**实测 1,193,314 字符 / 22,021 CRLF + 末尾空行**；行号会随改动漂移，改前须重核）

| 符号 | 位置 | 签名 | 作用 | 本改造是否改 |
|---|---|---|---|---|
| `class MemoryEngine` | L2520 | — | 引擎主类 | 否 |
| `loadConfigSync()` | L3336 | `loadConfigSync()` | 同步载入配置 | 否 |
| `assembleCarryPre` | L1544 | `({head, nav, bulk, budget=18000})` | 接续链三区组装 | **改（H8）** |
| `refreshEventStatePre(agent)` | L8417 | `async` | 事件层预计算（T2 卡片/T0 目录/未归档） | **改（H1/H4）** |
| `buildTierLayerInjection(agent)` | L8459 | `(agent)` | 构造 Tier 层注入 | **改（H7/H9）** |
| `renderMemoryDynamic(context)` | L8866 | `(context)` | **三区组装主入口** | **改（H5/H6/H8）** |
| `pushPart(bucket, kind, text, prio)` | L8935 | 4 参 | 段入队（全文 21 处调用） | 否（复用） |
| `composeMemoryEnvelopePre` | L9173 | 导入自 `memory-envelope.js` | 信封合成 | 否 |
| `renderMemoryStatic()` | L9228 | `()` | 静态提示（system prompt） | **改（三条通路）** |
| `consolidateMemory(agent, days)` | L11784 | `async (agent, days=7)` | 多日蒸馏 | 否（保留） |

### 1.2 工具定义（`defineTool` 序列）

| 工具 | 位置 | 本改造 |
|---|---|---|
| `memory_log` | L18980 | **改（H1）**：写入改为事件检查点 + 日视图派生 |
| `memory_note` | L19005 | **改（H2）**：handoff/plan 收敛到事件 |
| `memory_reflect` | L19217 | **不改**（蒸馏产物） |
| `memory_event` | L19329 | **改（H4）**：暴露 `commitments` 参数 |
| `memory_consolidate` | L19391 | **不改**（蒸馏产物） |
| `memory_expand` / `memory_trace` | 注册段（`graphEnabled` 闸门） | **改（H0）**：解耦 |

### 1.3 事件模块（已存在的三个文件）

| 文件 | 导出 | 状态 |
|---|---|---|
| `lib/event-store.js` | `eventStorePre.list/detail/create/append/set/close` | ✅ 可用 |
| `lib/event-render.js` | `firstSentencePre` / `renderT0Pre` / `renderT1Pre` / `renderT2Pre` / `renderEventCatalogPre` / `pickT2EventsPre` | ✅ 可用，**但 renderT2Pre 只渲四段** |
| `lib/event-plan.js` | `scanUnarchivedLedgersPre` / `groupIntoCandidateEventsPre` / `estimateCurationCostPre` | ✅ 可用（D2 批） |

### 1.4 前端 `lib/client.js`（1,969,124 字符 / CRLF 19,327）

| 符号 | 位置 | 本改造 |
|---|---|---|
| `EventCard(props)` | 手写区 | **改（H4）**：补四个 percept 展示 |
| `EventView(props)` | 手写区 | **改（H4）**：统计条加 userPercept 计数 |
| `PlanTab` | 手写区 | **改（H10）**：加存量转换入口提示条 |
| `conversation.view` 槽位 | 已挂 `EventView` | 否 |
| 生成区 | L10813–L13297（2,484 行） | **改则必须同步 `.frozen`** |

---
## §2 · H0 · 工具闸门解耦（0.5h）

### 2.1 改动点

| # | 文件 | 位置 | 现状 | 目标 |
|---|---|---|---|---|
| 1 | `lib/index.js` | 工具注册段（`return { tools }` 之前） | `if (resolveBoardModePre(engine.config.boardMode).graphEnabled) { tools.push(defineTool('memory_expand'...)); tools.push(defineTool('memory_trace'...)) }` | 去掉外层 `if`，无条件 push |

### 2.2 代码级 diff（示意）

```js
// 前
if (resolveBoardModePre(engine.config.boardMode).graphEnabled) {
  tools.push(defineTool('memory_expand', '...', {...}, async (a, e) => ...))
  tools.push(defineTool('memory_trace',  '...', {...}, async (a, e) => ...))
}

// 后
// 2026-10-24 v4 H0：遍历工具从 graphEnabled 闸门解耦 —— 事件档/legacy 档也要能遍历。
// 理由：user 硬约束「20 个工具一个不能漏」；且事件档下它们是**唯一**的结构化遍历入口。
tools.push(defineTool('memory_expand', '...', {...}, async (a, e) => ...))
tools.push(defineTool('memory_trace',  '...', {...}, async (a, e) => ...))
```

### 2.3 数据源问题（必须同步解决）

`memory_expand` / `memory_trace` 当前读 **wb-sidecar 索引**（仅 `boardMode==='graph'` 时写盘）。解耦后若数据源不产出，工具会**空转**（能注册但返回空）——那是另一种假完成。

| 方案 | 做法 | 推荐 |
|---|---|---|
| A | sidecar 索引改为「任何档位都写」（把 `boardMode==='graph'` 判断从 4 处写盘点移除） | ✅ **推荐** |
| B | 让这两个工具改为直接读 `event-store` | 改动大，但更彻底 |

**本批采用 A**（最小改动），并在 H9 检索补完时评估是否切 B。

### 2.4 验收

| 类型 | 判据 |
|---|---|
| 正 | `defineTool(` 实测计数 = **20** |
| 正 | 真调 `memory_expand('type:state')` 返回非空（有事件时） |
| 负 | 删掉 sidecar 索引文件 → 工具返回明确错误而非静默空 |
| 变异 | 把 `if (graphEnabled)` 加回 → 计数断言必红 |

---

## §3 · H1 · 写入层统一（3.0h，**最关键**）

### 3.1 新建模块 `lib/event-write.js`

| 导出函数 | 签名 | 作用 |
|---|---|---|
| `resolveActiveEventPre(store)` | `(store) → {id, event} \| null` | 找当前活跃事件（`status==='active'` 且 `updatedAt` 最新）；无则 `null` |
| `createEventForWorkPre(store, {name, summary})` | `() → {id, event}` | 无活跃事件时自动建（名称取当天日志首条或「未命名工作」） |
| `appendCheckpointPre(storePath, eventId, ck)` | `(path, id, {kind,text,panels}) → {ok, checkpointCount}` | 追加检查点（append-only） |
| `renderDayViewPre(store, date)` | `(store, 'YYYY-MM-DD') → string` | 从事件按 date 派生当日 `.md` 文本 |
| `deriveDayViewToDiskPre(paths, store, date)` | `() → {ok, path, bytes}` | 把派生结果写盘（原子写） |

### 3.2 `memory_log` 改造（L18980）

**现有实现**（实测）：
```js
const logPath = path.join(p.projectDir, date + '.md')
const existing = engine.state.logText || (await engine.readTextSafe(logPath)) || ''
const body = await engine.appendText(logPath, entry)
```

**改造后**：
```js
// ① 解析活跃事件（无则建）
const storePath = path.join(p.handoffDir, V4_EVENT_STORE_FILENAME)
let store = await readStoreForInjectPre(storePath)          // 复用 event-store 的读
let ev = resolveActiveEventPre(store)
if (!ev) ev = createEventForWorkPre(store, { name: note.slice(0, 40) })
// ② 追加事件检查点（第一等写入）
await appendCheckpointPre(storePath, ev.id, {
  kind: 'log', text: entry,
  panels: [{ kind: 'log', text: entry }],
})
// ③ 派生当日视图（投影，不是主写入）
const dayView = renderDayViewPre(await readStoreForInjectPre(storePath), date)
await deriveDayViewToDiskPre(p, await readStoreForInjectPre(storePath), date)
// ④ 兼容：engine.state.logText 仍更新（供注入读取派生视图）
engine.state.logText = dayView
```

### 3.3 关键设计约束

| # | 约束 | 理由 |
|---|---|---|
| 1 | **事件写入先于日视图派生** | 事件是源，视图是投影；顺序反了会产生「视图有、事件无」的孤儿 |
| 2 | **日视图必须可重建** | 判据：删掉 `.md` 再跑一次派生，字节完全相同 |
| 3 | **旧 `.md` 仍可读** | 存量用户升级前，`readTextSafe(logPath)` 路径保留 |
| 4 | **失败不得静默** | 事件写失败必须回传错误，不能 fallback 到只写 `.md`（那会造出「看起来成功、实际没进事件」） |

### 3.4 验收

| 类型 | 判据 |
|---|---|
| 正 | 真调 `memory_log({note:'x'})` → `event-store.json` 的 `checkpoints.length` +1 |
| 正 | 若库里无 active 事件 → 自动建 1 个事件 |
| 正 | 日视图内容含该条 note |
| 正 | 删日视图 → 重新派生 → 字节与之前完全相同 |
| 负 | 事件写失败（store 只读）→ 返回错误，**不得**假装成功 |
| 负 | 旧格式 `.md`（无事件）仍可被 `readTextSafe` 读出 |
| 变异 | 把事件写入注释掉只留 `.md` → 检查点计数断言必红 |

---

## §4 · H2 · 其余写入收敛（3.0h）

| # | 工具 | 现状 | 目标 | 验收 |
|---|---|---|---|---|
| 1 | `memory_note(kind=handoff)` | 新建 `handoff/*.md` | 追加事件检查点 `kind='handoff'`；`.md` 由检查点派生 | 调 note → 检查点 +1；`.md` 仍生成 |
| 2 | `memory_note(kind=plan)` | 重写 `PLAN.md`（plan-store CAS） | 事件头 `sections` 更新；`PLAN.md` 由事件头派生 | 改白板 → 事件 `updatedAt` 变；`PLAN.md` 内容 = 派生结果 |
| 3 | `memory_reflect` | 写 `reflections/*.md` | **不改** | 文件仍生成 |
| 4 | `memory_consolidate` | 写 `MEMORY.md` | **不改** | 文件仍更新 |

**注意**：`memory_note(kind=plan)` 的双向问题——白板是**单份可变快照**（有 revision/CAS），而事件头也是可变的。设计为 **事件头是真源，PLAN.md 是派生**，这样只需要单向派生。

---

## §5 · H3 · 项目规约改造（2.0h）

### 5.1 规约卡格式（新）

```markdown
## <规约标题>
<!-- memory:mem_<32hex> -->
<!-- status: current | superseded | retracted -->
<!-- revised: 2026-10-24 -->

**判据**：<一句话可执行判据>

**修订记录**（只追加）：
- 2026-10-24 初版：<内容>
- 2026-10-25 修订：<原因>
```

### 5.2 改动点

| # | 位置 | 改动 |
|---|---|---|
| 1 | `memory_note(kind=plan)` 的渲染器 | 输出格式改为规约卡 |
| 2 | `buildTier0CatalogFromTextPre` | 解析新格式（兼容旧格式） |
| 3 | `memory_rules` | 条目也走规约卡格式 |

### 5.3 验收

| 类型 | 判据 |
|---|---|
| 正 | 新建一条规约 → 渲染出「判据 + 修订记录」两段 |
| 正 | 旧格式条目仍可解析（兼容） |
| 负 | `status: retracted` 的规约不进规则段 |
| 变异 | 去掉 `status` 解析 → retracted 过滤断言必红 |

---
## §6 · H4 · 四个 percept 接线（2.5h）★核心缺口

### 6.1 现状：`renderT2Pre` 只渲五样东西

```js
// lib/event-render.js（现状，实测）
export function renderT2Pre(ev, opts = {}) {
  lines.push('【事件】' + ev.name + '  [' + STATUS_LABEL[ev.status] + ']')
  for (const [key, title] of SEC_TITLES) { ... }        // 四段
  for (const c of cks) { lines.push('  - [' + c.kind + '] ' + c.text) }  // 检查点 text
  if (ev.outcome) lines.push('· 成果：' + ev.outcome)
  return cutPre(lines.join('\n'), RENDER_LIMITS.T2)
}
```

**缺失**：`userPercept` / `agentTrace` / `sharedGround` / `commitments` / `checkpoints[].panels` —— **五样全不读**。

### 6.2 改造后（新增渲染块，插在 `outcome` 之前）

```js
// ── 人的一侧（D1 契约 §2.1 四类记忆，全部带 stage）──
const PERCEPT_TITLES = [
  ['userPercept',  '用户记忆',   ['preference','state','unfinished-goal']],
  ['agentTrace',   'Agent 经历',  null],
  ['sharedGround', '共同认知',   null],
  ['commitments',  '关系约定',   null],
]
for (const [key, title] of PERCEPT_TITLES) {
  const arr = Array.isArray(ev[key]) ? ev[key] : []
  if (!arr.length) continue
  // 只取最近 3 条 + 按 stage 过滤（accepted > used > delivered > mentioned > retrieved）
  const picked = arr.slice(-3)
  const lines2 = picked.map((x) => {
    const st = x.stage ? '[' + x.stage + '] ' : ''
    return '  - ' + st + String(x.text || x.promise || x.claim || '').trim()
  }).filter((s) => s.trim() !== '-')
  if (lines2.length) lines.push('· ' + title + '：\n' + lines2.join('\n'))
}

// ── 检查点面板组（PANEL_KINDS 注册表）──
for (const c of cks) {
  const ps = Array.isArray(c.panels) ? c.panels : []
  for (const pn of ps) {
    if (!pn || !pn.text) continue
    lines.push('  · [' + (pn.kind || 'log') + '] ' + String(pn.text).replace(/\s*\n+\s*/g, ' / '))
  }
}
```

### 6.3 字数预算（必须加，否则 T2 会爆）

| 项 | 预算 |
|---|---|
| 四段 | 现有（不设硬限，靠 T2 总限 2,400） |
| **四个 percept** | **合计 ≤ 200 字**（每个 ≤50，取最近 3 条） |
| **panels** | **合计 ≤ 150 字** |
| 检查点 text | 现有 |

**实现**：加一个 `cutPre(text, PERCEPT_LIMIT)` 包裹，超限截断并加 `…`。

### 6.4 `commitments` 暴露到工具（现在连存都存不进）

| 位置 | 现状 | 目标 |
|---|---|---|
| `defineTool('memory_event', ...)` 的 schema | **无 `commitments` 参数** | 加 `{ type: 'object', description: '关系约定：{at,promise,boundary,state,sourceRef}' }` |
| `memory_event` action=append 处理 | 不写 commitments | 若传了则写入 `ev.commitments.push(...)` |

**注意**（已有教训）：`defineTool` 只透传 `type/description/enum/items/required`，**嵌套 object 的 properties 会被丢弃** ⇒ `commitments` 必须写成 `type:'object'`，不能展开平铺。

### 6.5 验收

| 类型 | 判据 |
|---|---|
| 正 | 造一个含 `userPercept:[{stage:'accepted',text:'用户偏好 X'}]` 的事件 → 真调 `renderT2Pre` → 输出含「用户记忆」与「用户偏好 X」 |
| 正 | 同上，`commitments` → 输出含「关系约定」 |
| 正 | `checkpoints[].panels` → 输出含 panel 文本 |
| 负 | 四字段全空 → 输出**不含**「用户记忆」「Agent 经历」等标题 |
| 负 | 超长（500 字）→ 输出长度 ≤ 200 字上限 |
| 变异 | 把四字段渲染注释掉 → 正路径断言必红 |

---

### 6.6 ★勘误（2026-10-25 H4 实施时实测，两处）

> 本节由 A 线 H4 施工时**实测**发现并经 Lead 裁定，落盘留档而非悄悄改掉上面两节。

#### 6.6.1 §6.2 缺陷：`agentTrace` 的文本载体是 `action`，不是 `text || promise || claim`

§6.2 给的参考实现是：
```js
return '  - ' + st + String(x.text || x.promise || x.claim || '').trim()
```

**但四个 percept 的实际归一化结构不同**（依据 `lib/event-store.js` L326–L329，不是猜）：

| 字段 | 实际文本载体 | 文档三元兜底能否取到 |
|---|---|---|
| `userPercept` | `text` | ✅ |
| **`agentTrace`** | **`action`**（+ `result` / `wasRefuted`） | ❌ **永远空串** |
| `sharedGround` | `claim` | ✅ |
| `commitments` | `promise` | ✅ |

**后果**：按 §6.2 原样实现，`agentTrace`（Agent 经历）会渲染成空行并被 `.filter()` 丢弃 ⇒ **四类里有 1 类永远不显示**。这是「只存不用」的另一种形态，凶手是规格写错。

**正确做法**（已在 `lib/event-render.js` 的 `PERCEPT_RENDER` 落地）：**逐字段定义取值器，禁止三元兜底**：
```js
const PERCEPT_RENDER = [
  ['userPercept',  '用户记忆',   (x) => x.text,    (x) => x.stage],
  ['agentTrace',   'Agent 经历', (x) => x.action,  (x) => (x.wasRefuted ? 'refuted' : '')],
  ['sharedGround', '共同认知',   (x) => x.claim,   (x) => (x.correction ? 'corrected' : '')],
  ['commitments',  '关系约定',   (x) => x.promise, (x) => x.state],
]
```

#### 6.6.2 §6.3 缺失：只给 percept/panels 设了上限，**没给四段和单条检查点设上限**

§6.3 原预算表只有「四个 percept ≤200 / panels ≤150」，**四段与单条检查点无上限**。

**实测后果（本机真实事件）**：
```
checkpoints = 23 · sections 合计 1,229 字 · 单条 handoff 检查点 1,457 字
旧 renderT2Pre 输出 = 2,400 / 上限 2,400（恰好撞顶）· 以省略号结尾
「· 最近检查点：」从第 1,297 字符才开始 ⇒ 尾部只剩 1,103 字
⇒ headroom = 0：新增 percept(200) + panels(150) 无论放哪儿都只能从检查点挤 350 字
```

**⇒ 只加 §6.2 的渲染块、不改预算，H4 做出来 100% 被总限截掉（等于白做）。**

**补充后的完整分段预算**（已落地为 `lib/event-render.js` 的 `T2_BUDGET` 模块常量）：

| 块 | 预算 | 说明 |
|---|---|---|
| 头部（事件名+状态） | 不设限（实测 ~60） | — |
| 四段 `sections` | **900**（合计） | **逐段截 + 合计回压**；只做「每段截 225」不等于合计 ≤900 |
| 四个 percept | **200**（合计，每条 ≤50） | 取最近 3 条，带 `[stage]` |
| `checkpoints[].panels` | **150**（合计） | 紧跟其宿主检查点 |
| 检查点块 | **900**（合计），**单条 ≤300** | 超出则少渲几条并标注「另有 N 条未显示」；**至少保留 1 条** |
| `outcome` | **120** | **固定配额**，不能「有剩才加」——否则排最后的它会被饿死 |
| 总限 | **2,400** 兜底 | 正常不该触发 |

**加法核对**：60 + 900 + 200 + 150 + 10 + 900 + 120 = **2,340**，余 60 余量 ✓

#### 6.6.3 ★渲染顺序必须调整（否则新增块永在截断尾部）

§6.2 说「新增渲染块插在 `outcome` 之前」——但 `outcome` 在**检查点之后**，而检查点已吃掉 1,297+ 字符 ⇒ 新增块必然被截断。

**正确顺序**（已落地）：
```
【事件】name [status]
· 四段（≤900，逐段截+合计回压）
· 四个 percept（≤200，带 [stage]）        ← 必须在检查点之前
· panels（≤150，紧跟宿主检查点）          ← 必须在检查点之前
· 最近检查点（≤900，单条 ≤300，保底 ≥1 条）
· 成果（≤120 固定配额）
```

#### 6.6.4 验收判据（防假绿，已落成 `tests/smoke/smoke-test-v4-h4-t2-percept.mjs`，30 条）

★**关键**：断言「四段 ≤900」时**必须直调子函数** `buildSectionsBlockPre(ev).used`，**不能只看 `renderT2Pre` 的最终字符串** —— 否则无法区分「四段真被压到 900」和「四段拼了 1,500 但被总限切掉」（后者是假绿）。

为此 `renderT2Pre` 已拆成三个可测子函数（各自返回 `{ lines, used, dropped }`，`used` 是**未经总限裁剪**的物理量）：
- `buildSectionsBlockPre(ev)`
- `buildPerceptBlockPre(ev)`
- `buildCheckpointsBlockPre(ev, maxCk)`

#### 6.6.5 §6.4 整节**已过期**：`commitments` 早已接线，无需改动

§6.4 原文说「`commitments` 现在**连存都存不进**，必须加参数」，并据此要求改 `memory_event` schema。

**实测：此结论已过期。** 磁盘原文（`lib/index.js`）：
```js
// L19482（参数表已有，注意是**单数** commitment）
commitment: { type: 'object', description: 'append 用。承诺：{at?,promise,boundary?,state?,sourceRef?}。' },
// L19498（append 分支已接线）
agentTrace: args.agentTrace, sharedGround: args.sharedGround, commitment: args.commitment,
```

**独立进程实测（真 import）**：
```js
eventStorePre.append(sp, ev.id, { commitment: { promise:'答应做 Z', boundary:'仅限本周', state:'open' } })
→ {"appended":1}
→ ev.commitments = [{"at":…,"promise":"答应做 Z","boundary":"仅限本周","state":"open","sourceRef":null}]
```

**⇒ H4 不需要改 schema。** 且**不应**新增复数别名 `commitments` —— 两个同义参数会让模型选到没接线的那个，**静默丢数据**，比只有一个更危险。

**★但必须保留这条命名不一致的记录**（将来模型用错的高发点）：

| 层级 | 名称 | 形态 |
|---|---|---|
| 工具参数（模型看到） | `commitment` | **单数** |
| store 字段（落盘/渲染） | `commitments` | **复数（数组）** |
| 渲染标题 | `关系约定` | — |

其余三个 percept 的对应关系供对照：`userPercept`（参数=字段，同名复数）、`agentTrace`（同名）、`sharedGround`（同名）—— **只有 commitments 这一个是不一致的**。

## §7 · H5 · 用户画像段（2.0h）★新功能

### 7.1 为什么必须独立成段

用户原话（SPEC-v2 L14）：**「用户画像记忆和项目规约还是可以单独的」** ⇒ 两者**并列**，不能合并。

### 7.2 新段定义

| 项 | 值 |
|---|---|
| 段名（`pushPart` kind） | `user-portrait` |
| bucket | `otherDynamic`（与 `rules-section` 同层可见） |
| 优先级 | `normal`（可被预算裁掉，但优先于 external） |
| 开关 | 进 `PROMPT_SECTION_KEYS_PRE_V1` |
| 字符上限 | **≤ 600 字** |

### 7.3 数据源与聚合逻辑（新函数）

```js
// lib/user-portrait.js（新建）
export function buildUserPortraitPre(events, userMemText, opts = {}) {
  const maxChars = opts.maxChars || 600
  // ① 跨事件聚合 userPercept（只取 stage 为 accepted/used 的，避免噪声）
  const percepts = []
  for (const ev of events) {
    for (const p of (ev.userPercept || [])) {
      if (p.stage === 'accepted' || p.stage === 'used') percepts.push(p)
    }
  }
  // ② 去重（按 text 前 20 字）+ 按 at 降序取最近
  ...
  // ③ 从 user memory 抽偏好类条目（kind=preference）
  ...
  // ④ 分类输出
  return { text, counts: { preference, state, unfinished } }
}
```

### 7.4 输出格式

```
[用户画像 — 这是谁（跨事件聚合）]
· 偏好：<最多 5 条>
· 当前状态：<最多 3 条>
· 未完成目标：<最多 3 条>
```

### 7.5 验收

| 类型 | 判据 |
|---|---|
| 正 | 有 2 个事件各含 `userPercept(stage=accepted)` → 段输出含两条 |
| 正 | 段与 `rules-section` **同时出现**且**内容不重复** |
| 负 | 无任何 percept → 段**零字节**（不出现空标题） |
| 负 | 关闭开关 → 段消失 |
| 变异 | 把 stage 过滤去掉 → 「只取 accepted/used」断言必红 |

---

## §8 · H6 · 问候环节改造（1.5h）★新功能

### 8.1 现状（实测）

| 项 | 值 |
|---|---|
| 触发 | `awayMinSnap > 0 && lastActiveGlobal && now - lastActiveGlobal > awayMinSnap * 60000` |
| 段 | `welcome-title`（`[欢迎回来]`）+ `welcome-body`（静态文案） |
| **读记忆** | **无** |
| 位置 | 区 III 通道区（≤300 字符，可整段丢） |

### 8.2 改造后

```js
if (!this.isUnattendedNow() && awayMinSnap > 0 && lastActiveGlobal && Date.now() - lastActiveGlobal > awayMinSnap * 60000) {
  const mins = Math.round((Date.now() - lastActiveGlobal) / 60000)
  // ① 活跃事件摘要（有事件才有）
  const evs = this.state._eventCache || []
  const active = evs.filter((e) => e.status === 'active').slice(0, 1)
  const evLine = active.length ? ('上次你在做：' + String(active[0].name || '').slice(0, 40)) : ''
  // ② 未完成承诺
  const openCms = []
  for (const e of evs) for (const c of (e.commitments || [])) if (c.state === 'open') openCms.push(c)
  const cmLine = openCms.length ? ('还有 ' + openCms.length + ' 条约定未完成：' + openCms[0].promise.slice(0, 30)) : ''
  // ③ 组合（有内容才注入，全无则退回原静态问候）
  const body = (evLine || cmLine)
    ? ('用户离开约 ' + mins + ' 分钟。' + [evLine, cmLine].filter(Boolean).join('；') + '。回复开头用一句自然的话欢迎回来，并自然带出上述进展，不要生硬罗列。')
    : L('snapshotWelcomeBody')
  pushPart('otherDynamic', 'welcome-title', '\n' + L('snapshotWelcomeTitle'))
  pushPart('otherDynamic', 'welcome-body', body)
}
```

### 8.3 区配额调整

问候内容从 ~120 字膨胀到可能 ~300 字。区 III 上限 300 ⇒ 必须：

| 方案 | 做法 |
|---|---|
| **推荐** | 把 `welcome-*` 从区 III 挪到**区 II**（记忆区），因为它的内容本质是「记忆回放」 |
| 备选 | 保持在区 III，但压缩到 ≤280 字 |

### 8.4 验收

| 类型 | 判据 |
|---|---|
| 正 | 有活跃事件 + 离开 > 阈值 → 问候含事件名 |
| 正 | 有 open commitments → 问候含约定条数 |
| 负 | 无事件无承诺 → 退回原静态文案（不含「上次你在做」） |
| 负 | `awayMinutes=0` → 问候段不出现 |
| 变异 | 把事件摘要拼接注释掉 → 正路径断言必红 |

---
## §9 · H7 · 注入预算重排（2.0h）

### 9.1 实测账（不可拍脑袋）

| 项 | 实测 | 说明 |
|---|---|---|
| `injectBudgetChars` | **8,000** | 出厂默认 |
| 规则段 | **7,659 字符（95.7%）** | 且**完全不受 limits 约束**（极限验证：喂 100,000 字 → 输出 100,100 字） |
| Tier-0 | **396 / 400 token** | 已满 |
| 事件段需求 | **4,320 字**（T0 800 + T1 1,120 + T2 2,400） | 现状只剩 **341 字** ⇒ **差 12.7 倍** |

### 9.2 重排方案

| 步 | 动作 | 目标值 |
|---|---|---|
| 1 | 规则段规约化（H3 已做格式改造，此处压缩文案） | 7,659 → **≤4,000** |
| 2 | `injectBudgetChars` 上调 | 8,000 → **12,000** |
| 3 | Tier-0 预算 | 400 → **600 token** |
| 4 | 区配额重算 | 区 I / II / III 按新总值重分 |
| 5 | 事件段容量 | 341 → **≥4,320** |

### 9.3 验收

| 类型 | 判据 |
|---|---|
| 正 | 事件段真实占用 ≥4,320 字 |
| 正 | 规则段 ≤4,000 字（实测渲染结果，不是配置值） |
| 负 | 加事件行后 `perLayer.user.picked` **不得为 0**（这是 D 批第 3 项的判据） |
| 变异 | 把规则段恢复到 7,659 → 事件段容量断言必红 |

---

## §10 · H8 · 注入主结构换事件（6.0h）

### 10.1 逐段迁移表（**19 pushPart + 5 独立 = 24 处，一处不漏**）

| # | 段名 | 现来源 | 迁移后 | 批次 |
|---|---|---|---|---|
| S1 | `frame-head` | 静态 | 不变 | — |
| S2 | `frame-meta` | 状态行 | 加事件统计（活跃 N 件） | H8 |
| S3 | `rules-section` | 规则 | 保留（规约卡格式） | H3 |
| S4 | `workspace-map` | 跨工作区 | 不变 | — |
| S5 | `tier0-catalog` | 三层 | **加事件层** | H9 |
| S6 | `whiteboard-plan` | `planText` | 改为**事件头投影** | H8 |
| S7 | `handoff-ledger` | `latestHandoffText` | 改为**检查点视图** | H8 |
| S8 | `event-cards` | `eventCardsText` | **升级为主材料**（含四 percept） | H4/H8 |
| S9 | `plan-update-request` | 白板索取 | 改为**事件更新索取** | H8 |
| S10 | `handoff-pointer` | 全局账本指针 | 保留（存量期） | — |
| S11 | `water-advisory` | 水位 | 保留 | — |
| S12 | `event-unarchived` | 未归档 | 保留（迁移期） | — |
| S13 | `external-memory` | 外部工具 | 保留 | — |
| S14 | `external-sessions` | 外部会话 | 保留 | — |
| S15 | `calendar` | 日历 | 保留 | — |
| S16 | `welcome-title` | 静态 | **改造（H6）** | H6 |
| S17 | `welcome-body` | 静态 | **改造（H6）** | H6 |
| S18 | `frame-inscription` | 铭文 | **加事件指令 + 20 工具指引** | H8 |
| S19 | `frame-tail` | 框架尾 | 不变 | — |
| X1 | `logText`（19 处） | 今日日志 | **改为事件当日视图** | H1/H8 |
| X2 | `notesText`（30 处） | 项目笔记 | **保留为规约，格式改** | H3 |
| X3 | `assembleCarryPre`（5 处，L1544） | 接续链 | **改为事件绑定** | H8 |
| X4 | 静态 GUIDANCE | 常量 | 加事件指令 | H8 |
| X5 | client.js 镜像铭文 | 前端 | 与后端同步 | H8 |
| **+** | `user-portrait`（新建） | — | **用户画像段** | H5 |

### 10.2 三条提示通路（漏一条 = 半修）

| # | 通路 | 文件位置 | 必查 |
|---|---|---|---|
| T1 | 静态 GUIDANCE | `index.js` 常量区 | 含「事件」指令 |
| T2 | 完整版铭文（full） | `renderMemoryStatic` L9228 → `snapshotInscription` | 含 20 工具 + 事件优先 |
| T3 | 精简版铭文（slim） | 同上，精简分支 | **精简版也必须有** |
| T4 | client.js 镜像 | `lib/client.js` 尾部铭文 | 与后端文案一致 |

### 10.3 验收（每段三条）

每段都必须有：**正路径**（真实出现且内容正确）+ **负路径**（关掉后消失）+ **变异**（挂回旧分支必红）。

---

## §11 · H9 · 检索补完（2.0h）

| # | 位置 | 现状 | 目标 |
|---|---|---|---|
| 1 | `memory_recall` scope 枚举 | `['all','handoff','sessions','archive','events']` | 不变（已含 events） |
| 2 | `scope==='all'` 分支 | **明确排除 events** | **包含 events** |
| 3 | `buildTierLayerInjection` L8459 | 无事件层 | 加事件目录行 |
| 4 | 按事件聚合 | 散条目打分 | 同一事件的多条命中合并为一条结果 |

### 验收

| 类型 | 判据 |
|---|---|
| 正 | `recall(q, n, agent, 'all')` 命中事件 |
| 负 | 删掉事件 → `all` 不再命中该事件 |
| 负 | 事件与散条目同名 → 结果按事件聚合（不是两条） |
| 变异 | 把 `all` 分支改回排除 events → 正路径断言必红 |

---

## §11.5 🔴 生成区纠错（2026-10-24 23:20 实测，覆盖本文档此前所有行号）

> **此节由压缩后复核发现，是本文档最重要的一处纠错。此前文档写的「生成区 L10404–L12877」是错的，且漏了一整块。**

### 真实生成区：**两块，不是一块**

| 标记 | 实测行号 | 说明 |
|---|---|---|
| `// ===== ITER5-LEGACY-GENERATED:BEGIN =====` | **L10490** | LEGACY 区起 |
| `// ITER5-GENERATED:BEGIN`（内嵌） | **L10496** | 内嵌 ITER5 子区起 |
| `// ITER5-GENERATED:END`（内嵌） | **L12958** | 内嵌 ITER5 子区止 |
| `// ===== ITER5-LEGACY-GENERATED:END =====` | **L12963** | LEGACY 区止 |
| **`// ITER5-GENERATED:BEGIN`（外挂）** | **L12964** | 🔴 **此前文档完全没提** |
| **`// ITER5-GENERATED:END`（外挂）** | **L16363** | 🔴 **此前文档完全没提** |

```
块 1（LEGACY 区）：L10490 – L12963   （2,474 行）
   └─ 内嵌 ITER5 子区：L10496 – L12958
块 2（外挂 ITER5 区）：L12964 – L16363  （3,400 行）  ← 漏判
```

### 影响

| 场景 | 后果 |
|---|---|
| 改 `client.js` 且落在 **块 1** 内 | 必须同步 `skins/legacy/iter5-325.js.frozen`（LF），否则生成器拒绝写盘 |
| 改 `client.js` 且落在 **块 2** 内 | 必须同步 `skins/iter5/*` 源文件，否则**会被生成器静默覆盖** |
| 改块外（三处组件所在处） | ✅ 无需同步 |

### 三处组件的实际位置（实测）

| 组件 | 文档旧行号 | 实测（23:16） | 在生成区? |
|---|---|---|---|
| `EventCard` | L5343 | **L5436** | ✅ 区外 |
| `EventView` | L5376 | **L5472** | ✅ 区外 |
| `PlanTab` | L7776 | **L7875** | ✅ 区外 |

**⇒ C 线「三处都在区外、无需同步 .frozen」的结论正确**，但其判断依据（L10404–L12877）也是旧的；用真实边界复核后结论不变。

---
## §12 · H10 · 存量迁移 + 三步转换流程（4.0h）

### 12.1 用户要求的三步流程（原话）

> 1. **触发提示**：在前端页面或白板看板中设置一个按钮。提示语可以简单表述为「你现在还是旧版的流水账」；或者使用更高端的说法：「我们现在推出了新的以事件为中心的记忆方式，可以一键将本工作区的记忆重排成以事件为中心的内容，并呈现在前端上。是否将现有未归档或未排序的记忆归成事件？」
> 2. **确认与说明**：用户点击「确认」时，需明确说明该操作可能要调用子代理，会消耗一定的 token 额度。
> 3. **执行转换**：用户再次确定后，即可开始执行转换。

### 12.2 后端改动

| # | 路由/函数 | 现状 | 目标 |
|---|---|---|---|
| 1 | `GET /event-unarchived` | ✅ 已有（D2 批） | 复用 |
| 2 | `POST /event-curate` | ✅ 已有（只产草案 `wrote:false`） | 复用 |
| 3 | **`POST /event-convert`** | ❌ 无 | **新建**：扫描 → 分组 → 产草案 + 成本估算 |
| 4 | **`POST /event-convert/apply`** | ❌ 无 | **新建**：confirmToken 校验 + 真写入事件 |
| 5 | `scanUnarchivedLedgersPre` | ✅ `lib/event-plan.js` | 复用 |
| 6 | `groupIntoCandidateEventsPre` | ✅ `lib/event-plan.js` | 复用 |
| 7 | `estimateCurationCostPre` | ✅ `lib/event-plan.js` | 复用 |

### 12.3 前端改动

| # | 位置 | 内容 |
|---|---|---|
| 1 | `PlanTab`（事件视图顶部） | **持久提示条**：仅当检测到「有未归档流水账」时显示 |
| 2 | 提示条文案 | 「你现在还是旧版的流水账。新版本以事件为中心，可一键重排。」+ `[了解详情]` `[一键重排]` |
| 3 | 点击 `[一键重排]` | 弹**第一步说明**：将扫描 N 篇未归档、预计分 M 组、**会调用子代理消耗 token** |
| 4 | 点「继续」 | 弹**第二步确认**：显示 `confirmToken` 输入/确认按钮 |
| 5 | 确认后 | 调 `POST /event-convert` → 显示草案列表 → 用户勾选 → `POST /event-convert/apply` |

### 12.4 存量用户最小代价原则

| 约束 | 做法 |
|---|---|
| **不破坏旧文件** | 转换只**新增**事件，旧 `.md` 全部保留 |
| **可回滚** | 转换前后各存一份 `handoff/event-migration-backup-<ts>.json` |
| **可分批** | 用户可选「只转最近 7 天」/「全量」 |
| **不自动执行** | 必须用户三次确认（提示→说明→确认） |
| **失败可续** | 记录已转换的源文件 hash，重跑跳过 |

### 12.5 验收

| 类型 | 判据 |
|---|---|
| 正 | 真调 `POST /event-convert` → 返回草案 ≥1、`wrote:false`、含 cost 估算 |
| 正 | 真调 `apply`（带正确 token）→ 事件数增加、旧文件数不变 |
| 负 | 缺 token / 错 token → **409 confirm-required** |
| 负 | 转换前后旧 `.md` 文件字节相同（未被修改） |
| 变异 | 去掉 token 校验 → 负路径断言必红 |

---

## §13 · H11 · 全量回归 + 文档同步（2.0h）

| # | 项 | 判据 |
|---|---|---|
| 1 | 全量回归 | **457 PASS / 0 FAIL / 0 TIMEOUT**（或按新增套件后的新基线） |
| 2 | `verify-docs` | 工具 / 路由 / 配置键三数全绿 |
| 3 | `build-iter5-skin --check` | **SYNC-OK** |
| 4 | 7 份文档进度标记 | 逐份更新 |
| 5 | 三条提示通路一致性 | 完整版/精简版/client.js 三者文案对齐 |
| 6 | 六段判据 | 逐段给出实测证据 |

---

## §13.5 🔴 前端设计真源：原型（2026-10-24 23:40 补，此前遗漏）

> **本节补的是本文档此前最大的遗漏**：前端线只列了要「补 percept + 存量转换 UI」，**没有把原型列为设计真源**。

### 原型位置与规模

| 文件 | 大小 | 作用 |
|---|---|---|
| `artifacts/wb-event-preview/VERIFY.md` | **37,755 B** | **100+ 条真执行断言** = 已验证的实现规格 |
| `artifacts/wb-event-preview/index.html` | **2,599,966 B** | 单文件零依赖原型（无 http 外链/script src/link href/img src） |
| `artifacts/wb-event-preview/events.json` | 3,318,513 B | 839 篇 → 127 账本事件 + 58 归桶 = 185 时间轴节点 |
| `artifacts/wb-event-preview/shot-*.png` | 12 张 | 1600×1000 各状态截图 |

### 原型的已验证能力（前端必须对齐）

| # | 能力 | 原型实测规格 |
|---|---|---|
| 1 | 三视图切换 | stream / lanes（127 行 31 点 124 段）/ workflow（37 组 163 行） |
| 2 | **右栏抽屉可中断** | 「收起途中反向，最终仍回到展开且**宽度连续**（无 0↔满 跳变）」midW=266 → finalW=872 |
| 3 | **检查点折叠** | 26/26 默认全折叠，`grid-template-rows: 0fr`（0→1fr 过渡），点开六格面板 |
| 4 | **六类 panel** | `state,log,dead,next,userPercept,commitment` 六类齐全 |
| 5 | 空档标记 | 「⏸ 搁置 40.9 小时 —— 起→止」；负路径：无 >2h 空档 ⇒ 0 个 |
| 6 | 懒加载 + 视口锚定 | 「已载 36 / 总 185」；加载更早后**位移 0.50px** |
| 7 | 深链 | `#evt-091` 命中并选中，标题正确 |
| 8 | 键盘 | ↑↓ 切换事件、←→ 切换视图 |
| 9 | 合成数据 demo | demoTicks=4 demoCards=4 realNodes=0 + 「合成数据」标识条 |
| 10 | reduced-motion | 120ms 内直接落位（无弹簧中间帧） |
| 11 | 过滤 | 输入即筛，过滤态临时全量 185 → 清空回 36 |
| 12 | 倒叙 | 初始 `scrollTop+clientH >= scrollH-5`（差 0px） |

### 为什么它是「真源」而不是「参考」

**因为每一条都已被真执行断言验证过。** 这些不是设计想法，是**已验证的实现规格**。
丢掉它们 = 把已验证的成果重新发明一遍，且很可能更差。

**前端线纪律**：
1. 任何前端改动前，**先读 `VERIFY.md`** 确认该能力的已验证规格
2. 做完后**逐项核对**：✅ 已做 / 🟡 部分 / ❌ 未做 / ⛔ 不适用（不适用须给理由）
3. **不得凭记忆自创**（用户 2026-10-24 明确提醒）

### 2026-10-24 实测偏差（待 C 线填三态）

| # | 能力 | 当前 client.js | 状态 |
|---|---|---|---|
| 1 | 三视图 | `lanes`/`workflow` 有，`viewMode` 0 | 🟡 需核 |
| 2 | 右栏抽屉 | `detailOpen` 0 | 🔴 缺 |
| 3 | 检查点折叠 | `checkpointOpen` 0 | 🔴 缺 |
| 4 | 六类 panel | `PANEL_KINDS` 0 | 🔴 缺 |
| 5 | 空档标记 | `gap` 527 / `suspended` 0 | 🟡 部分 |
| 6 | 懒加载 | `lazy` 6 / `已载` 0 | 🟡 部分 |
| 7 | 深链 | `location.hash` 0 | 🔴 缺 |
| 8 | 键盘 | `ArrowDown` 0 | 🔴 缺 |
| 9 | 合成 demo | `demo` 0 | 🔴 缺 |
| 10 | 倒叙 | `倒叙` 7 | ✅ 有 |

**详见** `artifacts/V4-PROTOTYPE-ALIGN-AUDIT-2026-10-24.md`（104 行）。

### ★用户 2026-10-25 裁定：workflow 三视图必须做

> 用户原话：「能够反映本质：原型中使用了现有的老白板语料，做出来的效果比较好地反映了记忆的本质和内容。符合多项目并行：作为前端的表现形式，它更符合多项目并行的实际情况。比如有时候一个线做完阶段性成果后，过一段时间又开始继续推进，或者有了新的想法。我觉得这个可行性比较大。毕竟这只是前端展示，又不是纯粹的后端底层重构，所以你在做前端的时候一起做了就行。」

**⇒ 推翻我此前「workflow 本轮不做」的裁决。三档全做：stream / lanes / workflow。**

| 档 | 说明 | 原型已验证规格 |
|---|---|---|
| stream | 时间流（倒序） | 初始贴底，185 卡/懒加载 36 |
| lanes | 泳道/甘特 | 127 行 / 31 点 / 124 段 |
| **workflow** | **工作流线索** | **37 组 / 163 行 / 事件可同属多条线 / 主线默认折叠** |

**验收要求**：三档切换用 `localStorage.wbEvt.viewMode`，刷新后恢复；workflow 按 lane 分组、主线默认折叠、行数与 events.json 现算值一致。

---


---
## §14 · 多线并行建议（用户要求 (a)）

### 14.1 可并行的三个独立线

| 线 | 批次 | 写域 | 可并行 |
|---|---|---|---|
| **A 后端写入线** | H0 → H1 → H2 → H3 | `lib/index.js`、新建 `lib/event-write.js`、`lib/user-portrait.js` | ✅ 与 B/C 无冲突 |
| **B 注入线** | H4 → H5 → H6 → H7 | `lib/event-render.js`、`lib/index.js`（注入函数区） | ⚠️ 与 A 共享 `index.js` ⇒ **必须分区改** |
| **C 前端线** | H10 前端 + H4 前端 | `lib/client.js` | ✅ 独立 |

### 14.2 冲突规避（关键）

`lib/index.js` 是三条线唯一共享文件 ⇒ 必须**按函数区分区**：

| 线 | 改的函数区 | 行号范围（当前） |
|---|---|---|
| A | 工具定义段（`defineTool` 序列） | L18980–L19400 |
| B | 注入函数区（`renderMemoryDynamic` 等） | L8417–L9300 |
| C | 不碰 `index.js` | — |

**纪律**：① 每线改自己的区，**不得跨区**；② 每线完成后立刻 `node --check`；③ 合并时由 Lead 逐个跑套件归因。

### 14.3 串行兜底

若并行冲突过多，退回串行：H0→H1→H2→H3→H4→H5→H6→H7→H8→H9→H10→H11（总 ≈30.5h）。

---

## §15 · 验证依据（用户要求 (b)）

**唯一权威**（冲突时按此顺序）：

| 序 | 文档 | 管什么 |
|---|---|---|
| 1 | `artifacts/V4-FINAL-SPEC-v2-2026-10-23.md` | **为什么**（裁定 1–30） |
| 2 | `artifacts/V4-MASTER-PLAN-2026-10-24.md` | **顺序与验收**（含 §1.4 H 批裁定） |
| 3 | `artifacts/V4-INJECTION-PLAN-2026-10-24.md` | **注入与接续怎么改** |
| 4 | `artifacts/V4-CONSTRUCTION-DOC-2026-10-24.md` | **怎么改**（可粘贴代码） |
| 5 | `artifacts/V4-CODE-LEVEL-SPEC-2026-10-24.md`（本文件） | **代码级落点** |
| 6 | `artifacts/V4-H-BATCH-SCHEDULE-2026-10-24.md` | **批次排期** |
| 7 | `artifacts/_diagrams/v4-h-architecture.svg` | **架构与六段判据** |

**冲突裁决规则**（沿用 MASTER-PLAN §0.1）：以实测值为准；文档与代码冲突时先归因再动手。

---

## §16 · 交付要求（用户要求 (c)）

| # | 要求 | 判据 |
|---|---|---|
| 1 | 逻辑正确 | 每批真执行 + 负路径 + 变异验证（变异必红、还原复绿） |
| 2 | 接好线 | 六段判据全部通过（写入→事件→投影→注入→检索→前端） |
| 3 | 前后端同步 | 三条提示通路 + `client.js` 镜像文案一致 |
| 4 | 设置更新到最新 | 新增段进 `PROMPT_SECTION_KEYS_PRE_V1`；设置页可见可关 |
| 5 | 存量用户最小代价 | 三步转换流程 + 旧文件不改 + 可回滚 + 可分批 + 不自动执行 |

---

## §17 · 一句话

**六段判据：写入 → 事件 → 投影 → 注入 → 检索 → 前端。缺任一段 = 假完成。**
本轮之前只做了第 ② 段（事件容器）和第 ⑥ 段（前端展示），其余四段是空的。
