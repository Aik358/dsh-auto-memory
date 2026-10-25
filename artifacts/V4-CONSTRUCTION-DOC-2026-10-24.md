# v4 施工文档 · 详细版（2026-10-24 定稿，供直接施工）

> **本文件是施工基准。** 上一版 `V4-CONSTRUCTION-OUTLINE-2026-10-23.md`（489 行）保留为勘察底稿；本文件补全三块用户最关心的细节并给出可直接照抄的代码。
> 所有数字为实测（可复算）。当前 `lib/` 与 `tests/` **零改动**。

---

# 目录

- [第 0 部分 · 开工前必读](#第-0-部分--开工前必读)
- [第 1 部分 · 工具注册（用户问题 ①）](#第-1-部分--工具注册用户问题-)
- [第 2 部分 · Prompt 改造（用户问题 ②）](#第-2-部分--prompt-改造用户问题-)
- [第 3 部分 · 存量未归档（用户问题 ③）](#第-3-部分--存量未归档用户问题-)
- [第 4 部分 · 六批施工序](#第-4-部分--六批施工序)
- [第 5 部分 · 验收总表](#第-5-部分--验收总表)
- [第 6 部分 · 风险与陷阱](#第-6-部分--风险与陷阱)

---

# 第 0 部分 · 开工前必读

## 0.1 起点干净判据（三条全过才动手）

```bash
cd D:\dsh-auto-memory
git status --porcelain -- lib tests     # 期望：0 行
node tools/verify-docs.mjs              # 期望：工具 19 · 路由 73 · 配置键 160 · 全绿
node artifacts/wb-event-preview/verify.mjs   # 期望：不写死语料的版本全绿
```

## 0.2 必须拍板的 5 项命名（批次 0，0 代码）

| # | 项 | 选项 | **建议** | 理由 |
|---|---|---|---|---|
| 1 | 事件落盘文件名 | `event-store.json` / `mem-events.json` / `events-store.json` | **`event-store.json`** | `handoff/events.jsonl` **已被 sidecar 事件链占用**（`appendSidecarEventPre` @ index.js:4099）；且与 `facts.json`/`episodes.json`/`procedures.json` 完全同构 |
| 2 | 事件 ID 前缀 | `evt_pre_` / `evt_` | **`evt_pre_`** | 与 `fact_pre_`/`epi_pre_`/`proc_pre_` 同构，且 `_pre_` 是"政策版本"标记，未来改 schema 可升 v2 |
| 3 | boardMode 新档值 | `'event'` | **`'event'`** | 与 `legacy`/`graph` 同样简短；语义直白 |
| 4 | 前端是否新建 skin 包 | 是 / 否 | **否** | `skins/v4/` **已被 2026-09-27 的第三方皮肤包占用**；走 client.js 内 `boardMode==='event'` 分支 |
| 5 | 事件 API 前缀 | `/api/dsh-auto-memory/event-*` | **是** | 与既有 73 条路由同前缀 |

## 0.3 三个"连环锁"（改一个就不止改一处）

| 锁 | 当前值 | v4 后 | 要同步改的地方 |
|---|---|---|---|
| 工具数 | **19** | 20 | 4 个 smoke 用例 + 5 份文档 + `tools/verify-docs.mjs` 读的是实测值（不用改，但要跑） |
| 路由数 | **73** | +N | 同上 |
| 配置键 | **160** | +N | 同上 |

**具体清单**（一处不改就红）：

```
tests/smoke/smoke-test.mjs
tests/smoke/smoke-test-m3b3*.mjs
tests/smoke/smoke-test-graph-mode.mjs
tests/smoke/smoke-test-p23-wb-sidecar-pre.mjs
tests/smoke/smoke-test-context-observer.mjs
docs/WHITEPAPER.md              §3.1 规模表
docs/HOMEPAGE-CONTENT-FOR-GM53.md
docs/FRONTEND-CO-CREATION.md
README.md
README.zh-CN.md
docs/HANDBOOK.md                §6 工具表
```

**执行顺序（必须按这个序，否则会反复红）**：
1. 改代码 → 2. 跑 `node tools/verify-docs.mjs`（它会打印实测真值 19/73/160）→ 3. 按它打印的新值同步改上面 11 处 → 4. 再跑一次确认全绿。

---

# 第 1 部分 · 工具注册（用户问题 ①）

## 1.1 现状：19 个工具，注册机制

```
lib/index.js:13999   function defineTool(name, description, parameters, execute)
                     ├─ 把 parameters 表重建成 JSON Schema
                     ├─ spec.required → required 数组
                     ├─ ★spec.items 必须透传（A-1f① 历史 bug：不透传会让 Vertex 400 拒整轮）
                     └─ execute 抛错时：仅 memory_log/memory_note/memory_user 向上抛，其余降级成字符串
lib/index.js:18347   const tools = [ ... ]        ← 19 个 defineTool 直接写在数组里
lib/index.js:19114   tools.push(defineTool('memory_expand', ...))   ← graph 档条件注册
lib/index.js:19118   tools.push(defineTool('memory_trace', ...))
lib/index.js:21198   for (const tool of tools) disposers.push(ctx.tools.register(tool))
```

**19 个工具清单**（实测）：

```
18348 memory_log        18373 memory_note        18473 memory_user
18502 memory_read       18561 memory_recall      18569 memory_maintain
18573 memory_status     18585 memory_reflect     18590 memory_external
18611 calendar_add      18621 calendar_list      18635 calendar_done
18642 calendar_remove   18649 memory_rules       18681 memory_consolidate
18701 memory_procedure  19006 memory_procedure_list
19114 memory_expand     19118 memory_trace       （后两个 graph 档才注册）
```

## 1.2 新增：`memory_event`（19 → 20）

### 1.2.1 插入位置

**插在 `memory_rules` 之后、`memory_consolidate` 之前**（即 `index.js:18679` 的 `}),` 之后、`18681` 的 `defineTool('memory_consolidate'` 之前）。

理由：按"记忆写入类工具"聚在一起；`memory_rules` 管用户级约束、`memory_event` 管事件，两者都是"结构化写"。

### 1.2.2 完整注册代码（可直接照抄，注意 CRLF）

```js
    // ★★★ v4（2026-10-24）事件记忆模式 · 模型直写通路 ★★★
    // **工具数 19→20**。硬锁联动 11 处（见施工文档 §0.3，漏一处就红）。
    // 设计：
    //   · 事件 = 头可变（summary/outcome/status/sections）+ 尾只追加（checkpoints[]）
    //   · 四类人侧记忆字段全建但本期只存不用（percept/agentTrace/sharedGround/commitments）
    //   · checkpoint.panels 走 6 类面板注册表，kind 不写死（对应手绘 2①「工具要随时增减」）
    //   · 与 memory_note(kind=handoff) 是**索引 vs 证据**的关系，不是替代
    defineTool('memory_event', '事件记忆——以「一件事」为单位组织记忆（取代以日志/账本为单位）。★**开工先判归属**：先自问「我现在做的是哪一件事」，对得上现有事件就用 eventId，对不上就 action=create 建新（**宁建勿挂**：挂错会污染历史边界）。五动作：create 建事件 / set 改字段（含 status=paused 表示搁置）/ append 追加检查点 / close 收尾 / rename 改名。⚠ 事件只是索引，原文仍要写 memory_note(kind=handoff)。', {
      action: { type: 'string', enum: ['create', 'set', 'append', 'close', 'rename'], required: true, description: 'create=建事件（需 name+summary）；set=改字段（需 eventId+field+value）；append=追加检查点（需 eventId+checkpoint）；close=收尾（需 eventId+outcome）；rename=改名（需 eventId+name）。' },
      eventId: { type: 'string', description: '事件 id（evt_pre_<32hex>）。除 create 外必填。也接受 8 位短码。' },
      name: { type: 'string', description: 'create/rename 时的事件名（一句话，≤80 字）。' },
      summary: { type: 'string', description: 'create 时的「一段话总览」（L0，≤400 字）。这是 Tier-0 目录与注入面显示的内容。' },
      outcome: { type: 'string', description: 'close 时的「成果」。做了什么、交付了什么、验证结果。' },
      field: { type: 'string', description: 'set 时要改的字段名：summary / outcome / status / skillRef / sections.goal / sections.doing / sections.deadend / sections.next。' },
      value: { type: 'string', description: 'set 时的新值。' },
      status: { type: 'string', enum: ['active', 'paused', 'closed'], description: 'set 时可用；paused=搁置（需配 pausedReason）。' },
      pausedReason: { type: 'string', description: 'status=paused 时的搁置原因（一句话）。' },
      checkpoint: { type: 'object', description: 'append 时的检查点。{ kind, text, sourceRef, panels }。kind ∈ progress/decision/deadend/handoff；sourceRef 指向原账本文件+行区间；panels 是数组、kind 不写死。' },
      userPercept: { type: 'array', description: '★本期只存不用。用户观察：{ at, kind, stage, text, sourceRef }。kind ∈ preference/state/unfinished-goal/correction；stage ∈ retrieved/delivered/used/mentioned/accepted。', items: { type: 'object' } },
      agentTrace: { type: 'array', description: '★本期只存不用。Agent 自传：{ at, action, result, wasRefuted, sourceRef }。', items: { type: 'object' } },
      sharedGround: { type: 'array', description: '★本期只存不用。共同记忆：{ at, claim, confirmedBy, correction, sourceRef }。', items: { type: 'object' } },
      commitments: { type: 'array', description: '★本期只存不用。关系约定：{ at, promise, boundary, state, sourceRef }。state ∈ open/kept/revoked。', items: { type: 'object' } },
      constraints: { type: 'array', description: '引用而非复制的约束：[`rule:<id>`, `spec:<id>`]。', items: { type: 'string' } },
    }, async (args) => {
      const r = await engine.applyEventActionPre(args)
      if (!r.ok) return 'memory_event: ' + r.error
      return r.text
    }),
```

### 1.2.3 为什么 `checkpoint` 用 `type:'object'` 而不是展开成 4 个平铺参数

`defineTool` 只透传 `type / description / enum / items / required`（见 `index.js:14003-14013`）。**嵌套 object 的 properties 不会透传** —— 如果写 `checkpoint: { type:'object', properties:{...} }`，注册出去的 schema 里 `properties` 会消失，模型看不到子字段。

⇒ **两个选择**：
- **A（推荐）**：`checkpoint` 用 `type:'object'`，子结构靠 `description` 描述（如上）。模型能理解，但 schema 校验不严格。
- B：把 checkpoint 摊平为 `checkpointKind / checkpointText / checkpointSourceRef / checkpointPanels` 四个顶层参数。schema 严格，但参数名啰嗦。

**建议 A**：与现有 `memory_note` 的数组参数风格一致（它也是只给 `items:{type:'object'}` 不给子 properties）。

### 1.2.4 后端实现：`applyEventActionPre`

新增到 `lib/event-store.js`，主引擎在 `index.js` 里加薄包装：

```js
// lib/index.js（在 kanbanBoardData 附近，约 4400 行后加）
async applyEventActionPre(args) {
  const { applyEventActionPre: apply } = await import('./event-store.js')
  const p = await this.resolvePaths(this._currentAgentOrNull())
  const storePath = path.join(p.projectDir, 'handoff', 'event-store.json')
  return apply(storePath, args, {
    now: new Date().toISOString(),
    readJson: (f) => this.readJsonSafePre(f),      // 复用既有安全读
    writeJson: (f, o) => this.writeJsonAtomicPre(f, o),  // 复用既有原子写
  })
}
```

### 1.2.5 五动作的语义（`event-store.js` 契约）

| action | 必填 | 行为 | 失败条件 |
|---|---|---|---|
| `create` | name, summary | 生成 `evt_pre_<32hex>`（sha256(name+now+rand) 前 32 位），status=`active`，checkpoints=[] | name 空 / summary 空 / summary >400 字 |
| `set` | eventId, field, value | 改单个字段；`status=paused` 时必填 pausedReason | 事件不存在 / field 不在白名单 / paused 缺 reason / **closed 事件不可 set** |
| `append` | eventId, checkpoint | 往 `checkpoints[]` 末尾追加（**只追加，不可改历史**） | 事件不存在 / closed 事件不可 append / checkpoint.text 空 |
| `close` | eventId, outcome | status=`closed` + closedAt + outcome | 事件不存在 / outcome 空 / 已 closed |
| `rename` | eventId, name | 改 name | 事件不存在 / name 空 / >80 字 |

**幂等性**：`append` 必须支持 `idemKey`（可选参数），同一 idemKey 重复调用不重复追加 —— 这是防"模型重试导致检查点重复"的必要保护。

## 1.3 前端工具表也要改

`lib/client.js` 里如果有工具名清单（搜索结果为空，说明**前端无工具表**，只需改文档）。**但要改设置页的"能力清单"** —— 搜 `19 个` / `19 tools` 定位。

## 1.4 locale 不用改

`locale/zh.json` 和 `en.json` 只有 `meta.title` / `meta.description`，**不含工具名** ⇒ 新增工具不需要改 locale。

---

# 第 2 部分 · Prompt 改造（用户问题 ②）

> 用户原话：「Prompt 需要根据工具的新情况来进行修改。需要指名道姓，让大模型去确定任务的归属，明确现在在做什么任务，并确定是否要建新任务，以及是否要对旧任务进行状态更新。」

## 2.1 改造清单：一共 4 处 Prompt，不是 1 处

| # | Prompt | 位置 | 改什么 | 优先级 |
|---|---|---|---|---|
| **P1** | `snapshotInscription`（铭文） | `index.js:1198-1205` | **②整段重写**：加「开工先判任务归属」 | **最高** |
| **P2** | `snapshotSlimMaintain`（精简版维护底线） | `index.js:1229` | 加一条 `memory_event` | 高 |
| **P3** | `snapshotSlimGuide`（精简版检索指引） | `index.js:1222` | 加 `scope="events"` | 中 |
| **P4** | 注入面新增两段 | `index.js:8518` 后 / `8535` 后 | `event-cards` / `event-unarchived` | 高 |

## 2.2 P1 · 铭文改造（完整新版全文，可直接替换）

### 2.2.1 字数核算（实测）

| 项 | 字符数 |
|---|---|
| 现 ①–⑥ | 1,203 |
| 现 ⑦（archive 段） | 221 |
| **现合计** | **1,424** |
| **新版合计** | **1,286** |
| **净变化** | **−138**（有 214 字余量，安全） |

### 2.2.2 新版全文（逐字，可直接粘贴）

```
[铭文 · 每轮提醒 {date}]
【收尾自检】本轮有实质产出才做；纯只读/闲聊轮跳过：
① 写记忆文件 memory_log —— kind 按性质选，别一律 fact：rule=用户约束/约定、preference=偏好、fact=事实、todo=待办；
② ★【第一件事：判定任务归属】先自问「我现在做的是哪一件事？」，硬映射，不许跳过：
   · 对得上现有事件 ⇒ 记下 eventId，本轮所有写入都带它
   · 对不上任何事件 ⇒ memory_event(action="create") 建新事件
     ⚠ **宁建勿挂**：挂到不相干的事件上会污染它的历史边界，比多建一个事件更糟
   · 不确定 ⇒ 先 memory_recall(scope="events", query="任务关键词")；查完仍不确定就建新
   然后按情况维护：
   · 有新进展 ⇒ memory_event(action="append", eventId, checkpoint)
   · 目标/状态/成果变了 ⇒ memory_event(action="set", eventId, field, value)
   · 搁置了 ⇒ memory_event(action="set", eventId, status="paused", pausedReason)
   · 做完了 ⇒ memory_event(action="close", eventId, outcome)
   ⚠ 仍要写 memory_note(kind=handoff) —— 它是检查点的**原文载体**，事件只是索引
   ⚠ 白板 PLAN.md 退化为「事件板快照」，不再手工写；
③ 技能库优先 —— 多步任务前先 memory_procedure_list 查流程，命中照做并按 successCriteria 验收；跑通的新流程 → memory_procedure 写回（已存在用 update）。跨会话结论 → memory_note / 跨项目规则 → memory_user / 规则增删改 → memory_rules；
④ 结论失效 —— supersedes= 标 superseded；做错了 retract= 标 retracted 并附 retractReason=（前者有后继，后者即教训）；标错用 restore=；
⑤ 事件标签 —— 四段写 type:goal / state / dead-end / progress，不写则按标题猜会落空；
⑥ 语体 —— 客观陈述、第三人称，只留可复用事实/决策/规则/路径。
⑦ 旧日志在 archive/（不在 all 里）：memory_recall(scope="archive",query) 找文件名 → memory_read(kind="archive",name) 取全文；
⑧ 存量未归档 —— 注入面出现 [事件未归档] 段时按其指引操作；无存量时该段零字节，不出现。
```

### 2.2.3 相对旧版的逐条对照

| # | 旧版 | 新版 | 性质 |
|---|---|---|---|
| ② | 「更新白板与账本 —— 硬映射」三类（handoff / plan / note） | **「第一件事：判定任务归属」+ 五动作** | **整段重写** |
| ③ | 技能库优先（长版本） | 同上但压缩 | 压缩（−350 字） |
| ④ | 结论失效（含"被更新结论取代"等解释） | 同上但压缩 | 压缩 |
| ⑤ | 「看板落列」—— 卡片泳道 | **「事件标签」** —— 落到事件四段 | **语义改写** |
| ⑥ | 语体 | 一字不改 | 不动 |
| ⑦ | archive 取回（长版本） | 同上但压缩 | 压缩 |
| **⑧** | 无 | **新增：存量未归档指引** | **新增** |

### 2.2.4 「指名道姓」体现在哪（用户最关心的点）

新版 ② 里有 **4 个明确的判断分支**，每个都指名到具体工具与参数：

| 判断 | 指名 |
|---|---|
| 现在做的是哪件事？ | 自问式，强制回答 |
| 对得上现有事件吗？ | 「记下 eventId，本轮所有写入都带它」 |
| 对不上怎么办？ | `memory_event(action="create")` + **「宁建勿挂」** 判据 |
| 不确定怎么办？ | `memory_recall(scope="events", query="任务关键词")` → 仍不确定就建新 |
| 旧任务状态要更新吗？ | 四个动作各对应一个场景：append / set / close / paused |

**关键设计：「宁建勿挂」**。这是防止模型偷懒把新任务挂到旧事件上的核心判据。理由必须写清（「挂错会污染历史边界，比多建一个事件更糟」）—— 只给规则不给理由，模型会权衡时选省事的。

## 2.3 P2 · 精简版维护底线（`snapshotSlimMaintain`）

**现状**（`index.js:1229`，约 260 字）：
```
[记忆维护底线 · 每轮必做] **多步任务/固定流程开工前先 memory_procedure_list 查技能库，有现成流程就照它做**；有实质产出 → memory_log；改过 lib/ 或测试 → memory_note(kind="handoff")；白板与事实不符 → memory_note(kind="plan")；跑通新的可复用流程 → memory_procedure；需要历史事实与决策 → memory_recall。这六项是底线，不因本轮是精简版而免除
```

**新版**（净增约 85 字，从 260 → ~345）：
```
[记忆维护底线 · 每轮必做] **开工先判任务归属：我现在做的是哪一件事？对得上现有事件就带 eventId，对不上就用 memory_event(action="create") 建新（宁建勿挂）**；多步任务/固定流程开工前先 memory_procedure_list 查技能库，有现成流程就照它做；有实质产出 → memory_log；改过 lib/ 或测试 → memory_note(kind="handoff")；白板与事实不符 → memory_note(kind="plan")；跑通新的可复用流程 → memory_procedure；需要历史事实与决策 → memory_recall。**这七项是底线，不因本轮是精简版而免除**
```

⚠ **注意**：原文写「这六项」，改成七项要同步改数字，否则模型数出来是 7 会觉得文案错。这是易漏点。

## 2.4 P3 · 精简版检索指引（`snapshotSlimGuide`）

**现状**：`需要历史信息时：memory_recall（关键词/语义检索历史记忆）· memory_read（…）· memory_search（…）。需要项目进度时：读 handoff/PLAN.md（白板全貌）与 handoff/*.md（交接账本）。`

**改法**：加一句 `查某件事的全部经过用 memory_recall(scope="events")；`，插在 `memory_search` 之后。

**建议文案**：
```
[记忆检索指引] 需要历史信息时：memory_recall（关键词/语义检索历史记忆）· memory_read（按需取日志/笔记/反思/日历全文）· memory_search（下探证据层）· **查某件事的完整经过用 memory_recall(scope="events")**。需要项目进度时：读事件（memory_recall(scope="events")）或 handoff/PLAN.md（事件板快照）。目录里看得到但正文未展开的内容，随时可用上述工具取全文。
```

⚠ 原文里「读 handoff/PLAN.md（白板全貌）与 handoff/*.md（交接账本）」在 v4 里语义变了 —— PLAN 退化为「事件板快照」、账本变成「事件检查点的原文」。**不改这句会让模型继续按旧模型理解。**

## 2.5 P4 · 注入面新增两段

### 2.5.1 `event-cards`（T2 事件卡，≤2,400 字）

**位置**：`index.js:8518` 的 `pushPart('memoryReferences', 'handoff-ledger', ...)` **之后**。

**代码骨架**：
```js
// ★v4：T2 事件卡 —— 只放当前 active 的 1–2 个事件的完整四段
//   预算 2400；来源：state.eventCardsText（refresh() 预计算）
if (s.eventCardsText) {
  pushPart('memoryReferences', 'event-cards', '\n' + L('snapshotEventCardsTitle') + '\n' + s.eventCardsText)
}
```

**预计算**（在 `refresh()` 里）：
```js
// 只取 status='active' 且按 updatedAt 倒序的前 N 个（N = cfg.eventMaxActiveInInject，默认 2）
const actives = listEventsPre(store).filter(e => e.status === 'active')
  .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  .slice(0, Number(cfg.eventMaxActiveInInject) || 2)
s.eventCardsText = actives.map(e => renderEventT2Pre(e, { maxChars: Math.floor(2400 / Math.max(actives.length, 1)) })).join('\n\n')
```

**T2 渲染格式**（`event-render.js`）：
```
▌事件 evt_pre_ab12cd34 · 中文名
状态: active · 更新于 2026-10-24 11:20 · 12 个检查点
一段话: <summary，≤400 字>
【目标】...
【进行中】...
【失败与弯路】...
【进度与下一步】...
最近检查点: 2026-10-24 11:20 · <text，≤80 字>
```

### 2.5.2 `event-unarchived`（存量提示，≤200 字，**条件式**）

**位置**：`index.js:8535` 的 `pushPart('otherDynamic', 'water-advisory', ...)` **之后**。

⚠ **这一段的触发条件必须在初始状态为真** —— 用户级硬规则：「触发条件须在初始状态为真；只写『重写／更新』会使首建场景恒假」。

**代码骨架**：
```js
// ★v4：存量未归档提示 —— **有存量才出现，无存量整段零字节**
//   ⚠ 不得写成「请记得整理」这类无执行路径的话
if (s.eventUnarchivedCount > 0) {
  pushPart('otherDynamic', 'event-unarchived',
    '\n[事件未归档] 本工作区有 ' + s.eventUnarchivedCount + ' 篇存量账本尚未归入事件。'
    + '打开「白板 → 未归档事件」窗格，点「审理」可让子代理按目标聚类成事件草案（需二次确认，会消耗 token）。')
}
```

**预计算**：
```js
const planSet = new Set(listEventsPre(store).flatMap(e => (e.checkpoints || []).map(c => c.sourceRef)))
const allLedgers = await scanLedgersPre(path.join(projectDir, 'handoff'))
s.eventUnarchivedCount = allLedgers.filter(l => !planSet.has(l.rel)).length
```

**负路径验收**：无存量时必须 `s.eventUnarchivedCount === 0` 且 **注入字符串里不含「事件未归档」五个字**（这条比"count=0"更强，因为 count 对了但文案还在也是错的）。

## 2.6 四段 Prompt 的注入量核算

| 段 | 现体积 | v4 后 | 备注 |
|---|---|---|---|
| frame-inscription | 1,424 | **1,286** | −138 |
| tier0-catalog | 776 | 776 + event 行（≤10 行 × 80 字 = 800） | ⚠ 需从别处腾预算 |
| whiteboard-plan | 1,200 | 1,200（换成事件板快照，体积不变） | |
| handoff-ledger | 800 | 800（换成"最新检查点"） | |
| **event-cards** | 0 | **≤2,400** | 新增 |
| **event-unarchived** | 0 | **≤200（条件式）** | 新增 |

**预算来源**（M1 冻结前提下）：
- `memRefLimit = sub*4 + catalogCost + planCap + ledgerCap + 400` = **9,900**（实测）
- 实际使用 8,000 ⇒ **已有 1,900 余量**
- event-cards 的 2,400 中：T0 事件行属**替换**（tier0 目录里原本就有 776 预算）、T2 属**净新增**
- 净新增 ≈ 2,400 − 已有余量 1,900 = **500 需从 recent-logs 压缩**（1,681 → 1,181，压缩 500）

⚠ **这条要在批次 3 结束时实测确认**，不能只看公式。

---

# 第 3 部分 · 存量未归档（用户问题 ③）

> 用户原话：「(a) 存量的旧事件需要有一个专门的'未归档事项'栏去承载。(b) 可以点击按钮让子代理去理顺、整理成新款的。(c) 这个按钮一定要有二次确认，因为按一下可能消耗不了 token。」

## 3.1 三件套总览

| 件 | 实现位置 | 用户可见形态 |
|---|---|---|
| **(a) 未归档栏** | 前端 `client.js` 新组件 + 后端 `/event-unarchived` 路由 | 白板页 event 档下的一个页签/折叠区 |
| **(b) 审理按钮 → 子代理** | 后端 `/event-curate` 路由 + `callSubagentStartPre` | 按钮，点了启动子代理 |
| **(c) 二次确认** | 前端 `window.confirm` 双段确认 | 先确认「会消耗 token」，再确认「开始」 |

## 3.2 (a) 未归档栏

### 3.2.1 后端路由 `GET /api/dsh-auto-memory/event-unarchived`

```js
{
  kind: 'exact',
  path: API['event-unarchived'],
  handler: async (req, res) => {
    if (!isLoopbackRequest(req, panelAllowedHosts)) return writeJson(res, 403, forbiddenPanelPayloadPre(req, panelAllowedHosts))
    try {
      const r = await engine.listUnarchivedPre(req.url)
      return writeJson(res, 200, r)
    } catch (e) { return writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
  },
}
```

**返回形状**：
```json
{
  "ok": true,
  "total": 839,
  "archived": 127,
  "unarchived": 712,
  "items": [
    { "rel": "handoff/handoff-20261024-001006.md", "mtime": "2026-10-24T00:10:06Z", "bytes": 4821, "goalFirstLine": "…", "eventId": null },
    { "rel": "archive/PLAN-20261024-001006-*.md", "mtime": "…", "bytes": 9103, "goalFirstLine": null, "eventId": null, "kind": "planSnapshot" }
  ],
  "nextCursor": "…"
}
```

⚠ **必须分页**（默认 50/页）—— 839 篇一次返回是 3 MB 级 payload，会卡前端。

### 3.2.2 前端组件

**位置**：`client.js` 的 `EventView`（批次 4 新建）内部，作为一个页签。

**交互**：
- 表格列：文件 / 时间 / 目标首行 / 字节 / 状态
- 顶部：「未归档 N / 总 M」+ 「审理」按钮
- 分页或虚拟滚动（推荐虚拟滚动，839 行 DOM 太多）

## 3.3 (b) 审理按钮 → 子代理

### 3.3.1 后端路由 `POST /api/dsh-auto-memory/event-curate`

```js
{
  kind: 'exact',
  path: API['event-curate'],
  handler: async (req, res) => {
    if (!isLoopbackRequest(req, panelAllowedHosts)) return writeJson(res, 403, forbiddenPanelPayloadPre(req, panelAllowedHosts))
    if ((req.method || 'POST') !== 'POST') return writeJson(res, 405, { error: 'method not allowed' })
    try {
      const body = await readJsonBody(req).catch(() => ({}))
      // ★二次确认令牌：前端必须带 confirmToken，否则 409
      const token = String((body && body.confirmToken) || '')
      const expect = String((body && body.expectToken) || '')
      if (!token || token !== expect) return writeJson(res, 409, { error: 'confirm-required', message: '缺少或过期的二次确认令牌' })
      const r = await engine.curateUnarchivedPre({
        limit: Math.min(Math.max(Number(body.limit) || 40, 1), 200),
        dryRun: body.dryRun === true,
      })
      return writeJson(res, r.ok ? 200 : 400, r)
    } catch (e) { return writeJson(res, 500, { error: String(e && e.message ? e.message : e) }) }
  },
}
```

### 3.3.2 子代理调用（照抄现有 `handoff-continue` 范式）

**范式来源**：`index.js:12703-12790` 的三段式（选 provider → callSubagentStartPre → withTimeout(run.result)）。

```js
async curateUnarchivedPre(opts) {
  const { limit = 40, dryRun = false } = opts || {}
  // 1) 取未归档清单
  const list = await this.listUnarchivedPre()
  if (!list.unarchived) return { ok: false, error: 'no-unarchived' }

  // 2) 取这一批（按 mtime 倒序，先旧后新？还是先新？）
  //   ★建议先**最旧**（从根上整理起，避免"刚写的又被归并"）
  const batch = list.items.slice(0, limit)

  // 3) 构造 prompt（★必须是 block 数组，createUserMessage 校验 content.some）
  const promptText = buildCuratePromptPre(batch)
  if (dryRun) return { ok: true, dryRun: true, batch: batch.length, promptPreview: promptText.slice(0, 2000) }

  // 4) 并发闸门（复用既有 _wbInflight，避免多个审理同时跑）
  if (this._wbInflight >= WB_MAX_INFLIGHT_PRE) return { ok: false, error: 'busy', message: '已有 ' + this._wbInflight + ' 个任务在跑' }
  _wbAcquireInflight()
  const controller = new AbortController()
  const tMs = Math.max(Number(this.config.eventCurateTimeoutMs) || 300000, 30000)  // 默认 5 分钟
  const timer = setTimeout(() => controller.abort('curate timeout'), tMs)
  let run
  try {
    // 选 provider（照抄 12703-12709）
    let providerName = 'spawn'
    try { const reg = this.subagents && this.subagents.list ? this.subagents.list() : []; if (Array.isArray(reg) && reg.length && !reg.includes('spawn')) providerName = reg[0] } catch (_) {}
    run = await callSubagentStartPre(this.subagents, providerName, {
      label: 'event-curate',                        // ★ label 用于归属与回收
      prompt: [{ type: 'text', text: promptText }],
      signal: controller.signal,
      ...(parent ? { parent } : {}),
      ...(subAgentOptions(this.config, 'curate') ? { agentOptions: subAgentOptions(this.config, 'curate') } : {}),
    })
    try { const ra = run && (run.localAgent || run.agent); if (ra) this._ownSubagents.add(ra) } catch (_) {}
    const result = await this.withTimeout(run.result, tMs, null)
    const blocks = result && result.output ? result.output : []
    const text = blocks.filter(b => b && b.type === 'text').map(b => b.text).join('').trim()

    // 5) 解析草案（不直接写盘！人在环）
    const drafts = parseCurateDraftsPre(text)
    return { ok: true, batch: batch.length, drafts, raw: text.slice(0, 20000) }
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) }
  } finally {
    clearTimeout(timer)
    try { if (run && run.dispose) run.dispose() } catch (_) {}
    _wbReleaseInflight()
  }
}
```

### 3.3.3 子代理 prompt 模板（关键：**只读 + 只出草案**）

```
你是记忆整理子代理。任务：把下面 N 篇**存量账本**按「同一件事」聚类，产出事件草案。

## 硬约束
1. **只读**：绝不修改/删除任何 .md 文件；你只输出 JSON，不写盘
2. **不猜**：无法判断归属的账本，单独放进 "unassigned" 数组，不要硬塞进某个事件
3. 输出必须是**纯 JSON**（不要 markdown 代码块包裹），格式如下

## 输出格式
{
  "events": [
    {
      "name": "一句话事件名（≤80 字）",
      "summary": "一段话总览（≤400 字，含做了什么+结果）",
      "members": ["handoff/handoff-xxx.md", ...],
      "rationale": "为什么认为它们是一件事（一句话）",
      "confidence": "high" | "medium" | "low",
      "sections": { "goal": "...", "doing": "...", "deadend": "...", "next": "..." }
    }
  ],
  "unassigned": ["handoff/handoff-yyy.md", ...]
}

## 待整理的账本（共 N 篇）
<逐篇给：rel / mtime / ## 目标 段首行 / ## 任务状态 段首行>
```

### 3.3.4 为什么**不直接写盘**

用户在 v1 就定了「人在环确认后才写入」。理由：
- 子代理聚类可能错（v3/v4 原型实测：机械判据 91.7% 单篇，人判才能到 127 个合理事件）
- 直接写盘 = 一次错误消耗一次全量 token，且污染历史边界
- ⇒ **草案返回前端 → 用户逐条接受/改名/合并/丢弃 → 才调 `memory_event(action="create")` 写入**

## 3.4 (c) 二次确认（用户特别强调）

> 「这个按钮一定要有二次确认，因为按一下可能消耗不了 token」—— 我理解这句是「按一下**可能消耗很多** token」的口误/笔误。

### 3.4.1 为什么一次 `window.confirm` 不够

现有 31 处 `window.confirm` 都是单段确认（"确定关闭吗？"）。但审理按钮的风险**不是不可逆**，而是**不可预估的 token 消耗**。单段确认用户会无脑点"确定"。

### 3.4.2 设计方案：双段确认 + 成本预估

```js
// 第一段：显示规模与预估成本，让用户判断值不值
var est = await apiGet(API.eventUnarchived, { limit: 1 })   // 拿 total
var total = est.unarchived || 0
var batch = Math.min(total, 40)
var estTokensIn = Math.round(batch * 1153 / 1.7)   // 实测：账本平均 1153 字符，1.7 字/token
var estTokensOut = batch * 75                      // 实测原型：单篇平均输出 75 token
var msg1 = L3(
  '即将审理 ' + batch + ' 篇（共 ' + total + ' 篇未归档）。\n\n' +
  '预估消耗：约 ' + estTokensIn.toLocaleString() + ' 输入 token + ' + estTokensOut + ' 输出 token。\n' +
  '耗时约 1–2 分钟。\n\n' +
  '子代理只产出**草案**，不会直接写入；你需要在结果里逐条确认。\n\n' +
  '继续？',
  'Curate ' + batch + ' of ' + total + ' unarchived ledgers?\n\nEstimated: ~' + estTokensIn + ' input + ' + estTokensOut + ' output tokens.\nTakes 1-2 min. The subagent only produces drafts; nothing is written until you confirm each one.\n\nContinue?',
  '…'
)
if (!window.confirm(msg1)) return

// 第二段：真正开跑前再确认一次（防手滑双击）
var msg2 = L3(
  '确认开始审理？\n\n这会真的启动子代理并消耗上述 token。',
  'Start curation now?\n\nThis will actually launch the subagent and consume the tokens above.',
  '…'
)
if (!window.confirm(msg2)) return

// 发请求时带 confirmToken（防绕过前端直接打接口）
var confirmToken = 'curate-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
await apiPost(API.eventCurate, { limit: batch, expectToken: confirmToken, confirmToken: confirmToken })
```

### 3.4.3 二次确认的四个硬要求

| # | 要求 | 理由 |
|---|---|---|
| 1 | **第一段必须显示预估 token** | 用户说的是"可能消耗很多 token"——不显示数字等于没告知 |
| 2 | **第一段必须写明"只出草案不写盘"** | 消除"点一下就改了记忆"的恐惧，这是用户愿意点的前提 |
| 3 | **第二段必须存在**（哪怕只有一句话） | 防手滑双击；也防"第一段没看清就点了确定" |
| 4 | **后端必须校验 confirmToken** | 前端确认可被绕过（curl / 脚本）；后端 409 兜底 |

⚠ **第 4 点容易被漏**：只做前端 `window.confirm` 等于没有保护。后端必须有自己的门。

### 3.4.4 成本预估的依据（实测，可复算）

| 量 | 值 | 来源 |
|---|---|---|
| 账本平均长度 | **1,153 字符** | 833 篇实测 |
| 中文 token 换算 | ≈ **1.7 字符/token** | 经验值 |
| 单篇输入 token | ≈ **678** | 1,153 ÷ 1.7 |
| 单篇输出 token | ≈ **75** | v1 原型实测（事件草案 JSON 摊薄） |
| 40 篇一批 | ≈ **27,120 输入 + 3,000 输出** | ×40 |
| 全量 839 篇 | ≈ **569,000 输入 + 63,000 输出** | ×839 |

**结论**：单批 40 篇约 2.7 万输入 token，是可控的；全量 839 篇约 57 万，必须分批 + 每批确认。

### 3.4.5 补充保护（建议，非必须）

| 保护 | 实现 |
|---|---|
| **只看不跑** | 加「预览 prompt」按钮（`dryRun: true`），先把要发给子代理的 prompt 显示出来 |
| **批大小可选** | 下拉 20 / 40 / 80，默认 40 |
| **进度可见** | 长任务要有 `curateJobId`，前端轮询 `/event-curate-status?jobId=` |
| **可中止** | 后端存 `AbortController`，提供 `/event-curate-abort` |

这四条**建议做但可以延后**，二次确认是必须的，这四条是体验优化。

## 3.5 存量数据的口径（实测）

| 项 | 值 |
|---|---|
| handoff 顶层 .md（不含 PLAN.md） | **578** |
| handoff/archive/*.md | **261** |
| **合计账本+快照** | **839** |
| 其中四段账本（可归事件） | **517** |
| 其中机械产物（PLAN 快照 / 会话转写） | 261 + 60 = **321** |
| 已有事件归属 | 516（+1 待归并桶） |
| **真正未归档** | 839 − 517 ≈ **322**（四段账本口径）/ 全部机械产物也可归桶 |

⚠ **这个口径要在批次 3 实测确认** —— "未归档"到底算不算机械产物，需要拍板：

| 口径 | 未归档数 | 优点 | 缺点 |
|---|---|---|---|
| **A（推荐）**：只算四段账本 | ~322 | 审理目标明确（能变成事件的就是四段账本） | 机械产物在"未归档栏"里看不到 |
| B：算全部 | 839 | 一目了然全量 | 839 篇里 321 篇是垃圾，审理它们没意义 |
| C：分两个 tab | 322 + 321 | 最清晰 | 实现成本高 |

**建议 A**：未归档栏只列四段账本；机械产物归"归档快照"分类，不进审理队列。

---

# 第 4 部分 · 六批施工序

| 批 | 内容 | 估时 | 产出文件 | 独立验收 |
|---|---|---|---|---|
| **0** | 拍板 5 项命名 | 15 min | 无（写进台账） | — |
| **1** | **数据层** | 3 h | 新 `event-store.js`(450) / `event-plan.js`(180) / `event-render.js`(200)；改 `index.js`(+60) | 真 import→真调用五动作 |
| **2** | **工具层** | 2 h | 改 `index.js`(+70)；同步 11 处锁 | `memory_event` 五动作 + verify-docs 全绿 |
| **3** | **注入 + 检索 + Prompt** | 4 h | 改 `index.js`（4 处 Prompt + 2 新段 + Tier0 + recall） | 注入字符串实测 + 负路径 |
| **4** | **前端** | 6 h | 改 `client.js`(+900~1200) | 真 factory 守卫 + 肉眼验收 |
| **5** | **配置 + 设置页** | 1.5 h | 改 `index.js`(DEFAULT_CONFIG) + `client.js`(设置页) | 160→166 三处同步 |
| **6** | **收尾** | 1 h | — | 全量 smoke + verify-docs + 发版预检 |

**总计 ≈ 17.75 h / 2–3 个工作日。**

**建议切分**：批次 1+2（后端数据与工具，可独立内测）｜批次 3+5（注入与配置，需一起验预算）｜批次 4 单独一天（前端）。

---

# 第 5 部分 · 验收总表

> 纪律：**禁止以「源码含某字符串」充当功能验收**（仅可作守卫）。每条必须真执行 + 带负路径。

| # | 批次 | 验收项 | 方法 | 负路径 |
|---|---|---|---|---|
| 1 | 1 | `createEventPre` 返回含全字段 | 真调用 → 断言 21 个字段 | name 空应报错 |
| 2 | 1 | `appendCheckpointPre` 追加 | 调用后 length +1 | closed 事件 append 应报错 |
| 3 | 1 | `closeEventPre` | status==='closed' | 缺 outcome 应报错 |
| 4 | 1 | 原子写 | 模拟中途抛错 → 原文件不变 | — |
| 5 | 2 | `memory_event` 五动作 | 逐个真调用 | 非法 action / 不存在 eventId |
| 6 | 2 | 工具数 20 | `verify-docs` 实测 | — |
| 7 | 3 | event-cards 段出现 | 真构造 snapshot → 断言含事件名 | 无 active 事件 → 零字节 |
| 8 | 3 | event-unarchived 条件式 | 有存量 → 出现 | **无存量 → 字符串不含「事件未归档」** |
| 9 | 3 | 铭文 ≤1500 字 | 断言 length | — |
| 10 | 3 | recall scope=events 命中 | 真调用 → 断言返回含事件标题 | 删事件后不可命中 |
| 11 | 3 | SlimMaintain 「七项」数字对 | 断言含「七项」 | 断言不含「六项」 |
| 12 | 4 | legacy/graph 逐字节不变 | 真 factory 渲染 → 比对 sha | — |
| 13 | 4 | event 档三视图 | CDP 真点击 | 非法 boardMode → legacy |
| 14 | 4 | 未归档栏渲染 | 真点击页签 | 0 条时不显示「审理」按钮 |
| 15 | 4 | 二次确认双段 | CDP 拦截 confirm → 断言调用 2 次 | 取消第二段 → 不发请求 |
| 16 | 4 | 后端 confirmToken 校验 | curl 不带 token → 409 | 带错 token → 409 |
| 17 | 5 | 配置键 166 | `verify-docs` | — |
| 18 | 6 | 全量 smoke | PASS ≥ 443，FAIL 0 | — |

---

# 第 6 部分 · 风险与陷阱（13 条）

| # | 风险 | 后果 | 对策 |
|---|---|---|---|
| **R1** | 设置页 3 处 boardMode 副本只改部分 | "半修"：有的路径能解析、有的恒判失败 | 改前 grep 3 处，改后 grep 验证 3 处 |
| **R2** | `events.jsonl` 命名撞车 | sidecar 事件链与事件存储混读，解析必错 | 用 `event-store.json` |
| **R3** | 工具/路由/配置键三处连环锁 | 改代码没改文档 → 红 | 每批结束跑 `verify-docs` |
| **R4** | 前端整块替换式重构 | 用户明确警告过（merge 社区前端污染，修一整天） | 只做定点插入，legacy/graph 分支不动 |
| **R5** | 静态守卫冒充功能验收 | 全绿但运行时才炸 | 真 import→真调用；负路径 + 变异 |
| **R6** | `skins/v4/` 撞名 | 与第三方皮肤包冲突 | 不新建 skin 包 |
| **R7** | 注入段加了但没进预算公式 | 溢出导致其他段被裁（规则段冻结不能裁） | 加段时同步改 `memRefLimit` |
| **R8** | 事件 ID 前缀冲突 | 索引串味 | `evt_pre_` 与既有同构 |
| **R9** | `release.mjs:240` 把 `docs/` 整树覆盖 | dev 覆盖 main 的 docs | 发版前 `git fetch` 核对 |
| **R10** | 发版不得委派 subagent | 用户硬规则 | Lead 直接执行 |
| **R11** | npm publish 成功有三层不同步 | 只看 exit 0 会误判 | 按 shasum + gitHead + time 三值回查 |
| **R12** | **验证器写死语料绝对值** | 语料一长就假红（已真实发生）** | 改不变量断言：覆盖自洽 / 倒叙语义 / 单调下界 |
| **R13** | `defineTool` 不透传嵌套 object 的 properties | schema 里子字段消失，模型看不到 | `checkpoint` 用 `type:'object'` + description 描述 |

---

# 附 · 关键文件行号索引

| 位置 | 内容 |
|---|---|
| `index.js:101` | `import { resolveBoardModePre }` |
| `index.js:1198-1205` | 铭文 ①–⑥（**P1 改这里**） |
| `index.js:1212-1214` | 铭文 ⑦ archive 段 |
| `index.js:1222` | `snapshotSlimGuide`（**P3 改这里**） |
| `index.js:1229` | `snapshotSlimMaintain`（**P2 改这里**） |
| `index.js:4179` | `graphEnabled` getter |
| `index.js:4302` | `kanbanBoardData` |
| `index.js:8030` | Tier-0 `add('event', ...)` 插入点 |
| `index.js:8497-8613` | 17 段注入 |
| `index.js:8518` | `handoff-ledger` → **event-cards 插这之后** |
| `index.js:8535` | `water-advisory` → **event-unarchived 插这之后** |
| `index.js:8544-8545, 8625` | 预算公式 |
| `index.js:9153` | `recall()` |
| `index.js:12703-12790` | 子代理调用范式（**审理按钮照抄**） |
| `index.js:13999` | `defineTool` |
| `index.js:18347` | `const tools = [` |
| `index.js:18679` | `memory_rules` 结束 → **memory_event 插这之后** |
| `index.js:19113` | graph 工具条件注册 |
| `index.js:19114/19118` | `tools.push(memory_expand/memory_trace)` |
| `index.js:21198` | `for (const tool of tools) register` |
| `board-mode.js:24` | `BOARD_MODES_PRE_V1 = ['legacy','graph']` |
| `client.js:3678-3745` | 前端 API 常量表 |
| `client.js:5298-6005` | 看板组件区（708 行） |
| `client.js:8172-8187` | boardMode state |
| `client.js:12719 / 16056 / 19185` | **设置页 3 处副本** |
| `client.js:19593` | `settings.plugins.tab` 注册 |
| `verify-docs.mjs:40-49` | 工具/路由/配置键实测 |


---

# 附录 A · 本文件的自我复核（22 条行号断言逐条验过）

| # | 断言 | 结果 |
|---|---|---|
| 1 | 工具数 19 | ✅ |
| 2 | 路由数 73 | ✅ |
| 3 | 配置键 160 | ✅ |
| 4 | 铭文 @ `index.js:1198` | ✅ |
| 5 | `snapshotSlimMaintain` @ 1229 | ✅ |
| 6 | `snapshotSlimGuide` @ 1222 | ✅ |
| 7 | `defineTool` @ 13999 | ✅ |
| 8 | `const tools = [` @ 18347 | ✅ |
| 9 | `memory_rules` @ 18649 | ✅ |
| 10 | `memory_consolidate` @ 18681 | ✅ |
| 11 | `memory_expand` @ 19114 | ✅ |
| 12 | 注册循环 @ 21198 | ✅ |
| 13 | `handoff-ledger` 段 @ 8518 | ✅ |
| 14 | `water-advisory` 段 @ 8535 | ✅ |
| 15 | 预算公式 @ 8544/8625 | ✅ |
| 16 | `callSubagentStartPre` 调用 @ 12723 | ✅ |
| 17 | Tier-0 `add('reflection')` @ 8030 | ✅ |
| 18 | `recall()` @ 9153 | ✅ |
| 19 | client API 表 @ 3678 | ✅ |
| 20 | client 设置页 boardMode @ 12719 | ✅ |
| 21 | `settings.plugins.tab` @ 19593 | ✅ |
| 22 | `board-mode.js` 31 行 | ✅ |

**22/22 通过**（脚本逐条比对源码行，非人工确认）。

---

# 附录 B · 还需要你拍的 3 个开口（不影响开工，但会影响设计）

| # | 问题 | 我的建议 | 何时需要定 |
|---|---|---|---|
| **B1** | 「未归档」的口径：只算四段账本（~322 篇）还是全部 839 篇？ | **只算四段账本**（机械产物归"归档快照"分类，不进审理队列） | 批次 3 前 |
| **B2** | 审理的批大小默认值 | **40 篇**（≈2.7 万输入 token，1–2 分钟） | 批次 4 前 |
| **B3** | 审理后草案的确认粒度：逐条确认 / 批量接受 / 只确认低置信？ | **逐条确认 + 批量"全部接受 high"** 两种并存 | 批次 4 前 |

---

# 附录 C · 三处必须**当场停手**的信号

| 信号 | 含义 | 立刻做什么 |
|---|---|---|
| `verify-docs` 报「工具 20 但文档写 19」 | 锁没同步全 | 按它打印的新值同步 11 处，**别手改回 19** |
| `legacy`/`graph` 档 render 出来的 sha 变了 | 前端动到了不该动的分支 | **停手回滚**，只做定点插入 |
| 注入快照总长 > 8,000 字 | 预算溢出 | 检查是否漏改 `memRefLimit`；规则段冻结不能裁，从 recent-logs 让 |

---

# 附录 D · 一句话记住这次改造

> **事件是索引，账本是证据。**
> 模型每轮第一件事是**判断"我在做哪件事"**，不是写日志。
> 存量 839 篇不强行归并 —— 先放「未归档」，人点按钮、二次确认、子代理出草案、人逐条确认，才写入。
