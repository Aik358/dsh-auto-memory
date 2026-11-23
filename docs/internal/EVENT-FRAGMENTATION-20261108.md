# 事件碎片化根因调查与事件层设计（只读调查）

- 工作区：`D:/dsh-auto-memory`（仓库 dsh-auto-memory，分支 `preview`，HEAD `a21f3b1c`）
- 事件库真源：`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`
- schema：`v4_event_store_v2`；实测 **45 个事件 / 697 条检查点**（2,950,769 B，2026-11-08 05:50 读数）
- 本文件只出方案，**不改任何源码**；未运行生成器，未修改 lib/ tests/ tools/ skins/。
- 复查口径：任务书给出的「已确认事实」中的三个计数（事件数、检查点数、按日 unknown 分布）在本次测量时已随事件库继续增长而不同，差异在第 8 节「未验证 / 边界」中逐条列出，其余事实在本机复算一致。

## 0. 结论速览

1. **每轮一条碎片的写入者是 `memory_log` 工具本身，不是自动沉淀** → 现象：11-07 单日 17 个 unknown 事件、平均 1 条检查点 → 根因：`lib/index.js:24470-24507` 的「主题重叠 ≥0.34 才挂已有事件，否则新建」门，在真实数据上**永远不可能通过**（分母是本条日志全文词集，分子只能来自事件名——而事件名只是另一条日志的前 40 字；自重叠上限中位数 0.081、最大 0.320，26/26 全部 < 0.34） → 落点 `lib/index.js:24506` / `lib/index.js:24520`。
2. **拐点是 2026-11-05 的同一处改动**，不是数据迁移 → 现象：10-24..11-03 共 15 个事件 unknown 占 0，11-05 15:30 起出现第一个 unknown → 根因：`e338473f`（2026-11-05 17:20 提交，工作树内先于提交生效）把 `const active = evId ? { id: evId } : resolveActiveEventPre(store0)` 换成主题门；此前所有 `memory_log` 都追加到「最近更新的 active 事件」（这正是 114/160/199 条检查点那类大事件的成因）→ 落点 `lib/event-write.js:156-185` + `lib/index.js:24470-24527`。
3. **kind 从不推断，且创建入口把 unknown 写死** → 现象：unknown 27 个、四段全空 24 个（88.9%） → 根因：`lib/event-store.js:120` 创建默认值 `kind: 'unknown'`，`:262` 只做「非法值回落 unknown」，全仓无任何推断点 → 落点 `lib/event-store.js:96-126`（`emptyEventPre`）+ `:255-269`（`normalizeEventPre`）。
4. **四段为空是「没人填」，不是「填了被覆盖」** → 现象：`createEventForWorkPre` 建出来的事件 sections 永远是 `{goal:'',doing:'',deadend:'',next:''}`，建完后没有任何路径给它写四段 → 根因：四段只有两个写入者（`memory_event(action=create/set)` 与 `memory_note(kind=plan)` 的 PLAN 镜像），而日志路径两者都不走（handoff 明确只追加检查点、不镜像 sections，见 §3.1） → 落点 `lib/event-write.js:231`（`emptyEventPre(name, …)` 不带 sections）+ 四段可解：**能从检查点的 goal/state/dead/next 反推**，实测 697 条检查点里「四段全非空」的有 163 条（23.4%），「至少一段非空」503 条（72.2%），见 §3.3。
5. **事件名 40 字窄带是单点截断**：`memory_log` 建事件时 `name: (gate.clean || note).trim().slice(0, 40)`（`lib/index.js:24523`），另一处同款在 `lib/event-write.js:593`；`event-store` 侧的真实上限是 80（`lib/event-write.js:222`）⇒ 40 不是契约，是**某个调用点自己定的**，且截断点落在中文句子中间（"（b989a5f9.."、"6 个「EX"）→ 落点 `lib/index.js:24523`。

## 1. Q1 · 每轮一条碎片是谁写的

### 1.1 结论

每轮固定只产生**一条新事件 + 一条检查点**的写入者，是 `memory_log` 工具处理体里的「归属判定」分支：它在找不到「主题重合 ≥0.34 的 active 事件」时调用 `createEventForWorkPre` 建新事件。**不是** `consolidateTurn`（每轮自动沉淀），**不是** 定时 summary，**不是** `consolidateMemory`——后三者都不写事件库（证据见 1.5）。

### 1.2 写入链（逐行）

`memory_log` 工具定义：`lib/index.js:24364`（工具名 `memory_log`，参数 `note` 必填）。
处理体内与事件相关的三段：

| 步骤 | 位置 | 逐字原文 |
|---|---|---|
| ① 读事件库 | `lib/index.js:24445` | `const store0 = await readEventStorePre(storePath)` |
| ② 主题门（内联 IIFE） | `lib/index.js:24470-24507` | 见 1.3 |
| ③ 门返回 null ⇒ 新建事件 | `lib/index.js:24520-24524` | `const created = await createEventForWorkPre(storePath, {` / `today: date,` / `dayBoundaryMinutes: boundaryMin,` / `name: (gate.clean || note).trim().slice(0, 40),` |
| ④ 追加检查点（kind 固定 'log'） | `lib/index.js:24542-24548` | `const ap = await appendCheckpointPre(storePath, evId, {` / `kind: 'log',` / `at: cpAt,` / `text: entry,` / `panels: [{ kind: 'log', text: entry }],` / `idemKey,` |

即：一次 `memory_log` 调用 = 最多一次建事件 + 恰好一次 append 检查点。这解释了「unknown 事件几乎都只有 1 条检查点」：实测 27 个 unknown 事件的检查点数分布为
`[1,1,2,3,61,1,7,3,2,1,1,1,2,1,1,3,2,2,1,1,1,1,2,2,3,0,1]`（中位数 1）。

### 1.3 主题门：0.34 阈值在真实数据上不可能通过

阈值判定行（`lib/index.js:24505-24506`，逐字）：

```
          const _ratio = _hit / _noteTok.length
          return _ratio >= 0.34 ? { id: _best.id, event: _best } : null
```

同一判据的模块级实现（供 handoff/plan 之外的调用方复用）在 `lib/event-write.js:182-184`：

```
  const ratio = hit / noteTok.length
  if (ratio >= 0.34) return best
  return null // 主题不匹配 ⇒ 交给调用方新建事件
```

**结构性缺陷**：分母 `_noteTok.length` 是**本条日志全文**的词集大小（中文按单字切、英文按 ≥2 连续串切）；分子只能取自 `_best.name + _best.summary`。而 `_best.name` 是**另一条日志的前 40 字**（见 Q5），`summary` 在日志建的事件上恒为空（见 §3）。于是「同一条日志挂到自己身上」这一最优情形，比率也只有「40 字前缀词集 / 全文词集」。

实测（26 个有检查点的 unknown 事件，自重叠上限 = 用该事件首个检查点正文的 40 字前缀去匹配它自己的全文词集）：

| 读数 | 值 |
|---|---|
| 上限最小值 | 0.035 |
| 上限最大值 | 0.320 |
| 上限中位数 | 0.081 |
| ≥0.34 的条数 | **0 / 26** |

同时实测相邻事件对（按 createdAt 排序，前一个事件作为 `_best` 的代理）的真实比率：41 对，最大 0.310，**≥0.34 的 0 对**。

⇒ 结论：该门自 2026-11-05 上线后**从未放行过一次**，「新建」是唯一可达分支。这不是阈值调得偏紧，而是**分母取错对象**（详见 §4 的判据重设计）。

### 1.4 时间线取证

`git log -S "0.34" -- lib/index.js` 只命中一个提交：

```
e338473f|2026-11-05 17:20|fix(core): alpha.6 后端修复批 — 跨区升级 P0-P6 / v1事件写兼容 / 团队传输安全 / 响应体上限
```

`git log -S "pickActiveEventByTopicPre"` 同样只命中 `e338473f`。该提交对本改动删除的原始行（逐字）：

```
        const active = evId ? { id: evId } : resolveActiveEventPre(store0)
```

替换后即现在的主题门。`resolveActiveEventPre`（`lib/event-write.js:120-131`）的语义是「updatedAt 最大的 active 事件」，本身**未被修改**——它仍被 handoff（`lib/event-write.js:590`）与 plan（`lib/event-write.js:687` 附近）复用。

**事件库侧的拐点**（`createdAt`，UTC+8）：

| 日期 | 事件总数 | unknown | 备注 |
|---|---|---|---|
| 2026-10-24 | 1 | 0 | |
| 2026-10-25 | 1 | 0 | |
| 2026-10-27 | 9 | 0 | 迁移批 |
| 2026-10-31 | 2 | 0 | |
| 2026-11-02 | 1 | 0 | |
| 2026-11-03 | 1 | 0 | |
| **2026-11-05** | 3 | **3** | 首个 unknown = `evt_aac0cafd`，2026-11-05 **15:30:58** |
| 2026-11-06 | 1 | 1 | |
| 2026-11-07 | 19 | 17 | |
| 2026-11-08 | 7 | 6 | 当日 05:50 前已入库部分 |

按记忆日界（450 分钟，凌晨归前一天）分组时，同一份数据给出：11-06 共 7 个（unknown 5）、11-07 共 20 个（unknown 19）。**任务书事实 3 的「11-07 17/18」与本次实测差 1~2 个事件，差异来自事件库在两次测量之间继续增长（43→45），不是口径分歧**。

**第一个 unknown 事件（15:30:58）早于提交时间（17:20:01）1 小时 49 分**。合理解释：本仓按批次在会话末端提交，改动在工作树内先于提交生效。因此 `git` 时间戳是上界而非切换瞬间；但「10-24 至 11-03 零 unknown、11-05 起连续 unknown」与该提交共同构成唯一自洽解释——期间没有第二个改动触及 `memory_log` 的归属逻辑（`git log -S "0.34"` 只有一个命中）。

**检查点流向**（按目标事件 kind 统计，每天）：

| 日期 | → ledger/project | → unknown |
|---|---|---|
| 2026-11-04 | 15 | 0 |
| 2026-11-05 | 45 | 4 |
| 2026-11-06 | 0 | 3 |
| 2026-11-07 | 4 | 91 |
| 2026-11-08 | 0 | 9 |

11-05 的 45 条仍进 project，是因为 handoff/plan 两条通路**没改**（仍走 `resolveActiveEventPre`），且当时那个 project 事件还是「最近更新」。到 11-07，最新更新的 active 事件已经是碎片，handoff/plan 也跟着挂进碎片——实测 unknown 事件里含 15 条 `handoff` 检查点与 2 条 `plan` 检查点，这是**碎片反噬账本通路**的直接证据。

### 1.5 为什么「自动沉淀」不是每轮建事件的写入者

`consolidateTurn`（`lib/index.js:18453`）的写盘只有三处，全部直写 .md，不经事件库：

| 位置 | 逐字原文 | 目标 |
|---|---|---|
| `lib/index.js:18667` | `const body = await this.appendText(p.logPath, '\n## ' + topic + '\n' + logPts.map((x) => '- ' + x).join('\n'))` | 今日日志 .md |
| `lib/index.js:18674` | `const body = await this.appendText(p.notesPath, '\n## ' + today + '\n' + notePts.map((x) => '- ' + x).join('\n'))` | 项目笔记 .md |
| `lib/index.js:18694` | `await this.appendText(pendingPath, head + gate.pending.map((x) => '- ' + x).join('\n'))` | 待确认区 .md |

`appendText` 是 `.md` 追加原语，与 `appendCheckpointPre`（事件库）无关。另外 `consolidateMemory`（`lib/index.js:18789`）与定时做梦（`lib/index.js:16258` 调用点）同样只写 .md/笔记。

**全仓建事件调用点只有 4 处**（`grep -n "createEventForWorkPre(" lib/*.js`）：

| 位置 | 触发者 | 频率 |
|---|---|---|
| `lib/event-write.js:593` | handoff 双写（无 active 事件时） | 每次写账本 |
| `lib/event-write.js:687` | plan 双写（无 active 事件时） | 每次写白板 |
| `lib/index.js:8710` | `curateMemory` 存量归档整理 | 手工/一次性 |
| `lib/index.js:24520` | **`memory_log` 主题门失败** | **每次 `memory_log` 调用** |

`appendCheckpointPre` 的调用点只有 2 处（`lib/index.js:8728`、`lib/index.js:24542`）。

⇒ 因此「每轮一条碎片」= **模型每轮按注入纪律调用一次 `memory_log`**（纪律文本见 `lib/index.js:13312`：`- 完成实质性工作后立即调用 memory_log 追加今日日志...`）× **主题门恒失败**。两者缺一不可：只有纪律，旧代码会把每轮日志叠进同一个事件（这正是 §5 里 114/160/199 条检查点的大事件成因）；只有门，没有调用就不会有碎片。

### 1.6 为什么它建出来的事件 kind 恒为 unknown、sections 恒为空

`createEventForWorkPre` 的入参只有 `{ today, dayBoundaryMinutes, name }`（`lib/index.js:24520-24524`），随后：

`lib/event-write.js:231`

```
  const ev = emptyEventPre(name, { id, summary: opts.summary })
```

`opts.summary` 在 `memory_log` 调用点**未传** ⇒ `summary` 为 `''`；`sections` 根本不在入参里。`emptyEventPre` 的默认值（`lib/event-store.js:106`、`:120`，逐字）：

```
    sections: { goal: '', doing: '', deadend: '', next: '' },
```
```
    kind: 'unknown',      // 徽章：ledger / planSnapshot / sessionTranscript / ...
```

⇒ kind 恒 `unknown`、四段恒空，**在创建那一刻就已决定**，与后续任何写入无关。

`createEventForWorkPre` 自己的 name 兜底还有一个 80 字截断（`lib/event-write.js:222`）：`if (name.length > 80) name = name.slice(0, 79) + '…'` —— 这个分支对 40 字的名字永远不触发（见 Q5）。

## 2. Q2 · kind 为什么不推断

### 2.1 结论

**全仓没有任何一处代码在创建时或写入后推断 kind。** kind 只有三个来源：① `emptyEventPre` 的写死默认值 `'unknown'`；② 调用方**显式传入**（`memory_event(action=create/set)` 的 `args.kind`，或迁移草稿 JSON 的 `kind`）；③ 读时归一化「非法值回落 `unknown`」。没有任何函数看 `members` / 检查点数 / `outcome` / `rationale` 来决定 kind。

### 2.2 全量清单（`lib/` 内，`grep -n "EVENT_KINDS\|ev.kind\|out.kind"`）

| 位置 | 类型 | 逐字/语义 |
|---|---|---|
| `lib/event-store.js:31` | 枚举定义 | `export const EVENT_KINDS = Object.freeze(['ledger', 'planSnapshot', 'sessionTranscript', 'project', 'mechanical', 'unknown'])` |
| `lib/event-store.js:120` | **创建默认值** | `kind: 'unknown',      // 徽章：ledger / planSnapshot / sessionTranscript / ...` |
| `lib/event-store.js:186-189` | 显式写入（校验） | `if (src.kind !== undefined) {` … `ev.kind = src.kind` |
| `lib/event-store.js:240` | 写前校验 | `if (!EVENT_KINDS.includes(ev.kind)) bad.push('bad-kind:' + ev.kind)` |
| `lib/event-store.js:262` | **读时归一化** | `if (!EVENT_KINDS.includes(out.kind)) out.kind = 'unknown'` |
| `lib/event-store.js:720` | 读时投影兜底 | `if (withKind === true) base.kind = String(e.kind || 'ledger')` |
| `lib/index.js:25301-25307` | 工具入参透传 | `const ev = await eventStorePre.create(storePath, {` … `rationale: args.rationale, kind: args.kind, confidence: args.confidence,` |
| `lib/index.js:21226-21235` | 跨机同步 applier | `const r = await eventStorePre.create(evStore, {` … `kind: p.kind, confidence: p.confidence,` |
| `lib/upgrade-apply.js:273` | 迁移草稿校验 | `if (ev.kind !== undefined && !EVENT_KINDS.includes(ev.kind)) out.errors.push(at + ' 非法 kind：' + String(ev.kind))` |
| `lib/upgrade-apply.js:381-382` | 迁移落盘 | `if (!EVENT_KINDS.includes(src.kind)) throw failPre('bad-kind', …)` / `ev.kind = src.kind` |

三点观察：

1. `lib/event-store.js:720` 是**唯一**带「默认给个有意义的 kind」意图的行，但它只在读投影、且只在 `e.kind` 为**假值**时生效——磁盘上的 `'unknown'` 是真值，永远走不到这个兜底。
2. `lib/index.js:25242` 的入参描述里写着「ledger=账本归组（默认）」——**与实际默认值相反**（实际默认 `unknown`）。这是提示词层面的错标，会让模型以为不传就是 ledger。
3. 迁移路径（`upgrade-apply`）写进去的 kind 是**草稿 JSON 自带的**，来自 `lib/migration-prompt.js` 的固定提示词（见 §4.2），不是代码推断。

### 2.3 后果：kind 不是「徽章」，是三个视图的开关

> 说明：`lib/ev4-prototype-blocks.js` 全文 97 行，其中第 39 行是 `EV4_PROTO_RUNTIME` 这一个巨型字符串字面量（`export const EV4_PROTO_RUNTIME = "…"`），EV4 运行时的全部函数都在该字符串内。因此下方引用给的是**同一行 + 字符偏移**，并附运行时内部的函数名；字符串内的引号在源码中带反斜杠转义，这里按运行时源码原样引用。

`kind === 'ledger'` 在 `lib/` 里有 4 个真实消费者（全部来自 EV4 运行时，逐字）：

| 位置 | 逐字 | 效果 |
|---|---|---|
| `lib/ev4-prototype-blocks.js:39`（`EV4_PROTO_RUNTIME` 字符串内、字符偏移 58,828 处的 `ticketOf`） | `if (ev.kind === "demo" \|\| ev.kind !== "ledger") return "narrow";` | 非 ledger ⇒ 卡片恒为 **narrow**（只有标题+时间，不渲染 badge/summary/成果） |
| `lib/client.js:10371`（`ev4TicketOfPre`，同一规则的产品侧副本） | `if (e.kind === 'demo' \|\| e.kind !== 'ledger') return 'narrow'` | 同上 |
| EV4 运行时 `renderLanes`（同文件第 39 行字符串内、偏移 90,266 附近） | `var items = EV.filter(function (e) { return e.kind === "ledger"; });` | 泳道/甘特**不收录**非 ledger |
| EV4 运行时 `renderWorkflow`（同文件第 39 行字符串内、偏移 91,317/91,372 附近） | `var ledgers = EV.filter(function (e) { return e.kind === "ledger"; });` | 工作流视图**不收录**非 ledger |

且徽章文案会**贴错标签**（`lib/client.js:10386-10393`，逐字）：

```
    function ev4KindLabelPre(k) {
      return k === 'planSnapshot' ? '白板快照'
        : k === 'sessionTranscript' ? '会话转写'
        : k === 'note' ? '说明'
        : k === 'unplanned' ? '待归并'
        : k === 'demo' ? '合成'
        : '账本事件'
    }
```

⇒ `'unknown'` 走最后一档，被渲染成 **「账本事件」**。用户看到的碎片不是标着「未知」，而是**标着「账本事件」的窄卡**——这解释了为什么碎片长期没被识别成缺陷，而被当成「账本事件渲染丢了信息」。

实测规模：27 个 unknown 事件全部落在 narrow 档，且全部不进泳道/工作流视图。

### 2.4 六值枚举够不够用

六个值在 lib 内**没有**一个消费者区分 `planSnapshot` / `sessionTranscript` / `project` / `mechanical`——只有 `ledger` 与非 `ledger` 的二分。也就是说，枚举表面有 6 个值，实际语义只有 2 档。

同时 `kindLabel` 已认得两个**枚举里不存在**的值：`'note'`（说明）与 `'unplanned'`（待归并）。这是现成的设计缺口证据：UI 侧早就预期会有「待归并」这一类，枚举没跟上。

**建议（不新增顶层字段）**：把 `'unplanned'` 加入 `EVENT_KINDS`。理由是零新增渲染成本（`kindLabel` 已有分支）、语义准确（「待归并」正是每轮碎片的真实身份）、且不触碰 26 字段契约。`'fragment'` / `'turnLog'` 之类的命名需要同步改前端 `kindLabel`，成本更高。

**不要新增顶层字段**（如 `kindSource`）：`EVENT_TOP_FIELDS`（`lib/event-store.js:43-50`）是 26 项 fail-closed 契约，配套校验在 `validateEventPre`、`upgrade-apply.js:381`，以及多个 smoke 套件的「恰好 26 字段」断言；新增字段会把「本次写事务」变成一次 schema 变更。需要留痕时用现有字段：`rationale`（≤600 字，`lib/event-store.js:179`）里写一行归组来源即可。

### 2.5 推断应该补在哪一层

| 层 | 位置 | 可行性 | 判据 |
|---|---|---|---|
| **创建入口（推荐）** | `lib/event-write.js:211-236`（`createEventForWorkUnlockedPre`） | 高：此处同时可见 `opts`（是否显式带 summary/kind）、`store.events`（前一个事件）、`opts.name` | 由调用方显式传 `kind` 优先；未传时按下表判 |
| 写侧（append 后） | `lib/event-store.js` `append` | 中：可在首个检查点落盘后回填 kind，但 append-only 语义下回填 kind 属**非追加写入**，会与「append-only 不可撤销」的注释冲突，需要显式裁定 | 不建议 P0 做 |
| 读时归一化 | `lib/event-store.js:255-269` | 低风险但**改善不可见**：只影响返回对象，磁盘仍是 unknown，下次读出仍要重算；且 `normalizeEventPre` 是纯函数，拿不到 checkpoints 以外的上下文（其实能拿到 ev.checkpoints，够用） | 可作兜底，不作主路径 |

**创建入口的确定性判据（建议值，全部只用创建时已有的信号）**：

| 条件（自上而下，先命中先定） | kind |
|---|---|
| 调用方显式传 `kind` | 用它 |
| `opts.summary` 非空 **且** `members.length >= 1` | `ledger` |
| `opts.rationale` 非空（归组理由由人/迁移代理给出） | `ledger` |
| `opts.name` 且首个检查点 `kind === 'log'` 且无 `outcome` | **`unplanned`**（每轮碎片） |
| 其余 | `unknown`（保持现状，不猜） |

关键：**不要把 `unknown` 当失败**。kind 的真实职责是「这条记录是什么形态」，形态确认不了就该留 `unknown`；当前的问题是「有确定形态（碎片）却被记成不确定」。

## 3. Q3 · 四段为什么是空的，谁应该填

### 3.1 四段的写入路径（全量）

事件头 `sections` 的写入口只有 3 个，全部在 `lib/`：

| # | 位置 | 触发 | 语义 |
|---|---|---|---|
| ① | `lib/event-store.js:836` | `memory_event(action=create, sections=…)` | 创建时按 key 覆盖：`if (sections && typeof sections === 'object') for (const k of ['goal','doing','deadend','next']) if (typeof sections[k] === 'string') ev.sections[k] = …` |
| ② | `lib/event-store.js:860-865` | `memory_event(action=set, sections=…)` | 逐 key 覆盖：`ev.sections[sk] = String(s[sk] == null ? '' : s[sk])` |
| ③ | `lib/event-write.js:696` | `memory_note(kind=plan)` 成功后 `mirrorPlanSectionsPre` | `await eventStorePre.set(storePath, evId, { sections: wanted })`（`wanted` 只含 PLAN 里**非空**且非表格的四段） |

**关键排除项**：handoff 路径**刻意不写 sections**，注释逐字（`lib/event-write.js:635-644`）：

```
 * ★★2026-10-25 修复（A 线自查 · 真缺陷）：handoff **只追加检查点，不镜像 sections**。
 *   原实现把账本的四段覆盖进事件头 sections，但两者语义完全不同：
 *     · 事件头 sections = 这件事**整体**的目标/进行中/失败与弯路/下一步（低频，只在方向变化时改）
 *   ★事件头 sections 的写入权归：memory_event(action=set) / memory_note(kind=plan) 镜像。
```

⇒ 由 `memory_log` 建出来的事件（27 个 unknown），创建时**没有第 ① 条通路**（`createEventForWorkPre` 根本不吃 `sections` 入参），创建后也没有任何自动路径走第 ②/③ 条（② 要模型显式调 `memory_event`，③ 只从 PLAN.md 取、且只镜像到「最近更新的 active 事件」）。

### 3.2 判定：是「没人填」，不是「填了被覆盖」

证据一（时间戳）：27 个 unknown 事件里，**14 个 `updatedAt − createdAt = 0 秒`**（创建后从未被任何写操作触碰），另有 8 个差值 ≤ 45 秒（仅同轮 append 检查点刷新 `updatedAt`）。四段非空的只有 3 个，其差值分别为 25,890 s / 67,358 s / 45 s —— 正是被显式 `set` 过的三个：

| 事件 | 检查点 | ΔupdatedAt | 四段 |
|---|---|---|---|
| `evt_256ca517` | 3 | +25,890 s | goal 52 字 / doing 104 / deadend 144 / next 138 |
| `evt_9c357363` | 61 | +67,358 s | goal 76 / doing 153 / deadend 空 / next 109 |
| `evt_600c6d4a` | 3 | +45 s | goal 28 / doing 23 / deadend 56 / next 32 |

证据二（擦除路径不存在于自动链）：

- ③ 的 `wanted` 只收非空值（`lib/event-write.js:672-676`：`const v = String(sections[k] || '').trim()` / `if (!v) continue`）⇒ **PLAN 镜像永远不会把非空段写成空**。
- ② 是**逐 key 覆盖**：传 `{goal: ''}` 会把 goal 擦成空。这条路径的风险是「模型为了改一段而只传四段里的某几段，未传的键不受影响」——因为循环的是 `Object.keys(s)` 而不是固定四键，所以未传的键**不会**被清空。唯一能擦空的方式是**显式传空串**。

⇒ 结论：**当前 24 个空四段事件是「从来没写过」，不是「写过又被清空」**。但设计上必须把「显式传空串就擦空」列为要防的点（见 P1-3）。

证据三（同一份数据的三处交叉印证）：27 个 unknown 事件中 `summary` 非空仅 4 个、`rationale` 非空 **0 个**、`confidence` 全部 `unknown`、`outcome` 仅 2 个。四段与总览是**同一批「人/代理显式写」字段**，它们同时为空，说明缺的是**一次显式写入**，不是某个字段被覆盖。

### 3.3 能不能从检查点反推四段

检查点契约里已有四段字段（`CHECKPOINT_QUAD_FIELDS = ['goal','state','dead','next']`，`lib/event-store.js:35`），字段映射是 `goal→goal / doing→state / deadend→dead / next→next`（`lib/event-write.js:615-620`）。

实测覆盖（697 条检查点）：

| 读数 | 值 |
|---|---|
| 至少有一个四段字段非空的检查点 | **503 / 697（72.2%）** |
| 四个字段全非空的检查点 | **163 / 697（23.4%）** |
| 至少能反推出 1 个键的事件 | **30 / 45** |
| 四个键都能反推出的事件 | **21 / 45** |
| 单键可反推的事件数 | goal 29 / doing 30 / deadend 21 / next 29 |

只看 27 个 unknown 事件：可反推的只有 12 个（其中 1 个四键齐全、11 个部分），**15 个一个键都反推不出**——它们的检查点只有 `kind:'log'` + 纯 `text`。

⇒ 结论：**反推可以作为兜底，但不能作为主路径**。它能救回「有 handoff/plan 检查点」的事件（30/45），救不回「纯 log 碎片」（15/27）。

反推的体量代价（用于注入面预算）：若对全部 45 个事件按「每个键取最近一条非空检查点」回填，四段合计 **27,502 字符 / 109 个键，均值 252 字符每键**（每事件约 1,009 字符）。这个量级**不能无条件进注入面**，必须与现有 slim 预算共用配额。

### 3.4 方案：谁在什么时机填

分三层，按「谁有信息」而不是「谁有权限」定归属：

**L1 · 创建时（`createEventForWorkPre`）—— 填 goal 一段，不做四段全填**

| 项 | 内容 |
|---|---|
| 谁 | 代码（确定性，零模型调用） |
| 时机 | `lib/event-write.js:231` `emptyEventPre(name, …)` 之后 |
| 填什么 | `sections.goal = opts.name`（40/80 字的「这件事要达成什么」就是 goal 的原始语义）；若 `opts.summary` 非空则 `sections.doing = summary` |
| 为什么只有 goal | 创建时唯一确定的信息就是「这件事的目标」，其余三段此刻不可能知道；填了就是编造 |
| 收益 | 四段空壳判定（`lib/index.js:13887-13892` `_isShellE` 取「四段与 summary 同时为空」）立刻不再命中，碎片不再被标 ⚠空壳，也不再被枚举排到第一位 |
| 风险 | 低。只影响新建事件，不碰存量 |

**L2 · 追加检查点时（`appendCheckpointPre`）—— 只在事件头该键为空时补，绝不覆盖**

| 项 | 内容 |
|---|---|
| 谁 | 代码（确定性） |
| 时机 | `lib/event-write.js:270` 的 append 事务内，检查点写盘成功后 |
| 填什么 | 对 `goal/state/dead/next` 逐个判：检查点该键非空 **且** 事件头该键为空 ⇒ 写入 |
| 关键约束 | **只填空，绝不覆盖非空**（与 `mirrorPlanSectionsPre` 同款保守语义，`lib/event-write.js:672-676`） |
| 收益 | 27 个 unknown 中 9 个能立刻补齐部分四段（见 3.3 表） |
| 风险 | 中：append 是热路径（每次 memory_log），多一次写盘要复用同一事务，不能另起一次 `set`（会与串行锁打架）。实现时必须走 `mutateUnlockedPre` 同一事务 |

**L3 · 收口时（`close`）—— 要求四段齐全，缺则拒绝**

| 项 | 内容 |
|---|---|
| 谁 | `memory_event(action=close)` 的调用方（模型） |
| 时机 | `lib/event-store.js` close 分支 |
| 判据 | `outcome` 已必填；再要求 `sections.goal` 与 `sections.doing` 非空，否则报错并指出缺哪个键 |
| 理由 | 收口是「这件事结束了」的唯一时刻，此时四段必然可知；在这里强制，成本最低且不可绕过 |
| 风险 | 已有 `close` 调用点会开始报错 —— 需要先全仓确认调用点数量（本次未统计，列入 §8 未验证） |

**不建议**：每轮由模型重写四段。四段是「这件事当前状态」，每轮重写等于把 L0 总览变成流水，且每轮一次 `memory_event(set)` 的 token 成本高于一次 `memory_log`。

## 4. Q4 · 什么粒度算「一件事」

### 4.1 现状：运行时没有任何归并逻辑

| 项 | 结论 | 证据 |
|---|---|---|
| `memory_event` 是否有 merge action | **没有**。五动作是 create / set / append / close / rename | `lib/event-store.js` 内 `async create` / `append` / `set` / `close` / `rename` 五个方法；`lib/index.js:25295` `const action = String(args.action \|\| '')` 后只分支到 create/append/set/close/rename |
| `rename` 能否合并且 | 不能，只改 name（注释：「rename：只改标题，id 不变」） | 同上 |
| 运行时是否有「把检查点搬去另一个事件」的能力 | 没有。检查点是 append-only，无搬移 API | `lib/event-store.js:10` 硬约束①「**append-only 不可撤销** —— checkpoints/constraints 只能加不能改不能删」 |
| `rationale`（「由白板章节与同主题日志归并为同一件事」）是谁写的 | **只有迁移提示词**，由 AI 子代理在一次性迁移里写 | 见 4.2 |

⇒ 归并**只存在于一次性的迁移流程里**，运行时不具备。唯一的「合并」手段是人工改 JSON。

### 4.2 「归并逻辑」的真身：`lib/migration-prompt.js` 的固定提示词

该文件 19,913 B / 29 行，是一份执行手册，关键段落（逐字）：

```
memory_event(action='create',
  workspace='<本区目录名，照抄清单表格「工作区目录名」列>',   ★#556 必填：不传会写回会话绑定区（中枢），不是本区
  name='<4-60 字，去掉 ★ 和括号注解>',
  summary='<≤400 字>',
  kind='ledger',
  confidence='high',
  startMs=<最早成员时间戳>,
  endMs=<最晚成员时间戳>,
  members=['handoff/xxx.md', '2026-10-24.md'],
  rationale='<一句话：为什么这几篇是一件事>',
  sections={ goal:'…', doing:'…', deadend:'…', next:'…' })
```

```
**★ `members`（来源清单）和 `rationale`（归组理由）是必填，不是可选。**
它们证明"由哪几篇归组、为什么"。缺了就退化成碎片。
```

它自带**三条量化判据**（同文件 §2c，逐字表格）：

```
| # | 判据 | 阈值 |
|---|---|---|
| ① | **平均 members ≥ 3** | 每事件至少 3 篇来源（< 3 说明归组太碎） |
| ② | **单检查点事件占比 ≤ 30%** | > 30% 说明把「一件事」拆成一堆碎片 |
| ③ | **startMs > 0 覆盖率 100%** | 每个事件必须有开始时间 |
| ④ | **四段覆盖率 100%** | 每检查点至少 goal + state 非空 |
```

并记录了**上一次同类尝试的失败**（逐字）：

```
> **上一版（v5）把白板逐节拆成事件** —— 这是**方向性错误**。
> 实测结果：14 个碎片事件、**64% 只有 1 个检查点**、**平均 members = 1.0**。
> 白板章节是**描述侧面**（约束/待办/进度），不是「事」本身。真正的事在日志里。
> **prototype 达标值**：185 事件 / **平均 members 4.54** / **单检查点占比 23%**。
```

**该提示词现在还在跑，但只在用户触发「记忆基座整理」时跑一次**：调用点 `lib/index.js:11783-11784`（`engineRef.runSubagent((manifest ? … : '') + MEMORY_BASIS_MIGRATION_PROMPT, UPGRADE_SUBAGENT_LABEL, agent, UPGRADE_SUBAGENT_TIMEOUT_MS, …)`）与 `lib/index.js:25106`（把提示词全文回给模型）。它不是每轮的归并器。

**用它的判据衡量当前事件库**：

| 判据 | 阈值 | 实测 | 结论 |
|---|---|---|---|
| ① 平均 members | ≥ 3 | 全库 members 总条目 **74**，÷45 个事件 = **1.64**；仅在 members 非空的 24 个事件内算 = **3.08**。unknown 事件 27 个中 members 非空仅 **7** 个 | 不达标（碎片把均值拖到 1.64） |
| ② 单检查点事件占比 | ≤ 30% | 检查点 ≤ 1 的事件 **16 / 45 = 35.6%** | 不达标（超阈值 5.6 个百分点） |
| ③ startMs > 0 覆盖 | 100% | **43 / 45 = 95.6%**（2 个为 0：`evt_6ea35c20`(project)、`evt_0127b3f9`(unknown)） | 不达标 |
| ④ 四段覆盖率 | 100% | 四段全空 24 / 45；unknown 里 24 / 27 | 不达标 |

⇒ 迁移提示词写下的标准，运行时在**每一轮都在违反**。这不是「标准过时」，是**运行时没有执行标准的代码**。

### 4.3 可判定的合并判据（按优先级，附真实数据验证）

**原则**：判据必须是「要么确定、要么不做」。误合并不可逆（append-only），误拆可逆（事后可合）⇒ **宁可误拆**。这条取舍在 `lib/event-write.js:143-144` 已有明文：「误并不可逆，误拆可逆（两个事件事后可合并）⇒ 宁可误拆」。

#### 判据 0 · 显式 eventId（确定性，无阈值）

模型传了 `eventId` ⇒ append。**当前已实现**（`lib/index.js:24451-24457`），且回执会提示（`lib/index.js:24616`：「若这条其实是**另一件事**…请带 eventId 重新调用」。

实测效力：本次 27 个碎片**全部没有** eventId（否则不会新建）。⇒ 判据 0 只能解决「模型愿意标」的场景，不能作为唯一手段。

#### 判据 1 · 事件名前置段内的高基数标识相同（**推荐主判据**）

定义：从**新日志正文**里抽 `#\\d{2,4}`（issue）与 `task-\\d+`（任务号）；从**候选事件的 `name`**（不是全部检查点）里抽同一组；**交集非空 ⇒ append**。

关键设计约束（两条，均由实测得出）：

1. **只跟事件名比，不跟累积检查点比**。若跟累积内容比，标识会**传递性扩散**：实测把标识累积到组上时，「task-33/#522」组会把 task-34、task-38、task-37 全吸进来，形成 6 合 1 的**过度归并**（详见下表 D 行）。
2. **标识必须落在名字里**（即「这件事的身份」），而不是正文任意位置。实测反例：`evt_1b83c8ec`（task-33/#522）与 `evt_1b814baf`（task-34/#557）正文里都提到 `#557`，但两件事完全不同 ⇒ 按「正文出现即匹配」会误并。

实测（对 27 个碎片按 createdAt 顺序重放）：

| 变体 | 结果事件数 | 合并组 |
|---|---|---|
| 不合并（现状） | **27** | — |
| 判据 1（锚定名字、无时间窗） | **20** | task-37×5、#557/task-34×3、#560×2 |
| 判据 1 + 时间窗 12h | 20 | 同上 |
| 判据 1 + 通用文件路径（`lib/`/`docs/`/`tests/`）12h | 19 | **但把 task-34 误并进 task-33 组** ⇒ 假合并 |
| 判据 1 + 累积标识 | 19 | **6 合 1 过度归并**（task-33/38/37 混成一个） |
| 只按通用文件路径 12h | 24 | 假合并多、收益小 |

⇒ **判据 1 单独使用**：27 → 20（全库 45 → 38），无假合并。这是唯一在本数据上「有收益且零假合并」的词法判据。

#### 判据 2 · 同一会话（session）内（**结构性判据，收益最大**）

「一件事」的最小可靠单位不是「主题」，而是**一次会话**：同一次会话里的连续工作天然是同一件事的推进。当前 `memory_log` 处理体里有 `exec.agent`（`lib/index.js:24391` 已在用它读 `header.cwd`），可取到 session id。

落地形态（不改 schema）：事件创建时把会话标识写进 `idemTag`（`string|null`，已是 26 字段之一、已有校验 `lib/event-store.js:198`），值形如 `sess:<sessionId 前 16 位>`；随后同一会话的 `memory_log` 若命中 `idemTag === 'sess:<同 id>'` 且该事件 `status==='active'` ⇒ append。

收益（估算口径见 §8 声明）：27 个碎片在 11-07 那一天来自同一长会话（见 4.2 的事件创建密度：11-07 单日 19 个），按此判据应合成 **1 个会话事件**；再叠加判据 1 拆出明显的不同任务，量级落在 3-6 个。

风险：`idemTag` 现用于迁移幂等（`curate:` 前缀语义）。必须约定**前缀命名空间**（`sess:` / `curate:`），且 `createEventForWorkPre` 需要新增 `idemTag` 入参。若不想动 `idemTag`，替代方案是把会话标识写进 `rationale` 的固定前缀行（`rationale` ≤ 600 字，`lib/event-store.js:179`），但那是文本匹配、不如字段精确。

#### 判据 3 · 时间窗 + 同一工作集（保守兜底，不建议单独用）

| 信号 | 实测有效率 | 实测误合并 | 结论 |
|---|---|---|---|
| 通用文件路径交集（`lib/index.js` 等） | 3/26 相邻对命中 | **有**（task-34 被并进 task-33） | 不可单独用：`lib/index.js` 出现在本仓几乎每条日志里，区分力为零 |
| 具体产物路径（`docs/internal/…` / `artifacts/…`） | **0/26 命中** | 0 | 无收益：碎片正文很少写具体产物名 |
| 主题词重叠（containment = `|A∩B| / min(|A|,|B|)`） | 相邻对中位数 **0.330**、p75 0.446、有 24/26 ≥0.2 | **极高**：同一项目同一天的任何两条日志都 >0.2 | **不能作为判据**。当前 0.34 阈值恰好落在中位数附近，正是「有时并、有时拆」的来源 |
| 主题词重叠（Jaccard） | 中位数 0.131、最大 0.397 | 同上 | 同上，不可用 |

⇒ 结论：**词袋重合度在本仓不可用**（同项目高频词把所有日志黏在一起）。这直接否掉了「调阈值就能修好」的想法：0.34 不是调错了，是**这个度量本身没有区分力**。

### 4.4 「一件事」的可判定定义（建议写进提示词与代码注释）

> **一件事 = 一个可命名的工作单元，它的身份由一个稳定标识承载**（issue 号 / 任务号 / 产物路径 / 显式 eventId / 同一会话），**而不是由用词相似度承载**。

对应的机器判据，按顺序求值，**首个命中即决定**：

```
1. 调用方显式 eventId                              → append（不判）
2. 事件 idemTag = 'sess:<本会话>' 且 status=active   → append
3. ids(name) ∩ ids(新日志正文) ≠ ∅                  → append
4. 具体产物路径交集 ≠ ∅ 且 Δt ≤ 24h                  → append
5. 其余                                             → 新建（kind=unplanned）
```

阈值只出现在 4（24h）与 2（会话边界），两者都是**结构量**，不是统计量。这满足「可机器判定」且不依赖调参。

### 4.5 补一条：新建之后还要能合

即使判据全对，也会留下需要合的事件。当前**没有任何合并能力**，因此方案必须包含一个 append-only 兼容的合并动作：

**建议形态（P2，不是 P0）**：`memory_event(action='merge', eventId=<目标>, sourceIds=[…])` 语义 = **把 source 的检查点按 at 归并进目标（复制而非搬移，source 置 `status='closed'` + `pausedReason='merged-into:<id>'`）**。这样：

- 不违反 append-only（不删不改任何既有检查点，目标只增）；
- 源事件保留可追溯（不消失，只标 closed + 指针）；
- 与现有 `close` 的字段语义兼容（`pausedReason` 允许任意字符串，见 `lib/event-store.js:848` ALLOWED 列表）。

这一条**必须显式裁定**才能做（新增 action 属于语义扩展，且要先确认宿主 enum 不缓存旧 action —— 本仓有过「宿主内存旧 enum 把未知 action 静默降级」的教训）。

## 5. Q5 · 事件名为什么是 38-42 字符

### 5.1 生成逻辑：三条路径 + 一个 40 字常量

| 路径 | 位置 | 逐字 | 名字来源 |
|---|---|---|---|
| **memory_log 建事件（主路径，27/27 碎片）** | `lib/index.js:24523` | `name: (gate.clean \|\| note).trim().slice(0, 40),` | **本条日志正文的前 40 字** |
| handoff 建事件（无 active 事件时） | `lib/event-write.js:593` | `name: (sections.goal \|\| '交接账本').slice(0, 40)` | 账本 goal 段前 40 字 |
| `createEventForWorkPre` 的通用兜底 | `lib/event-write.js:214-222` | `const rawName = String(opts.name \|\| '').trim()` … `if (name.length > 80) name = name.slice(0, 79) + '…'` | 显式 name / 当天日志首条 / `'未命名工作'` |
| `memory_event(action=create)` | `lib/index.js:25302` | `name: args.name,` | 模型给，无截断（仅受 80 校验） |
| 契约硬上限 | `lib/event-store.js:209` | `if (String(ev.name \|\| '').length > 80) bad.push('name-too-long')` | **80 是真上限** |

⇒ **40 不是契约，是两个调用点各自写死的常量**。契约允许 80。这就是为什么长度集中在 39/40 而不是 79/80。

### 5.2 为什么恰好落在 38-42 窄带

三个因素叠加，全部可复算：

1. **`.slice(0, 40)`** ⇒ JS `.length` 是 UTF-16 码元数。本仓日志正文全为 BMP 中文/ASCII（每字 1 码元）⇒ 截断结果恒为 40。
2. **`.trim()`**（`lib/event-write.js:214` 的 `rawName`）⇒ 若第 40 个字符恰好是空格，名字变 39。实测 4 个 39 字事件全部符合：`slice(0,40)` 的末字符是空格，`slice(0,40).trim() === name` 为 true（`evt_1b814baf` / `evt_1b5ecc01` / `evt_aaff3fd6` / `evt_e319ccbf`）。
3. 少数不落在 40 的是**没有走这条路径**的：`evt_256ca517`（27 字，`memory_event create` 显式命名，带 `members` 3 篇）、`evt_9c357363`（56 字，同上，61 条检查点）。

实测长度分布（45 个事件）：

```
{4:1, 16:1, 18:1, 19:1, 20:1, 21:1, 26:1, 27:1, 28:2, 29:1, 32:1, 34:1,
 35:2, 39:5, 40:21, 46:1, 49:1, 56:1, 57:1}
```

39 与 40 合计 **26 / 45 = 57.8%**，全部是「日志前 40 字」这一个常量的产物。只看 27 个 unknown 事件：**21 个 40 字 + 4 个 39 字 = 25 / 27 = 92.6%** 落在 38-42 窄带，剩下 2 个（27 字、56 字）走的是 `memory_event create` 显式命名。

### 5.3 截断的代价：20/45 的名字被切在词中

判据（可复算）：括号/引号不成对 → 切在括号内；末字符是 ASCII 字母或数字 → 切在英文词中。

| 读数 | 值 |
|---|---|
| 括号/引号不成对 | **14 / 45** |
| 末字符为 ASCII 字母/数字/空格 | **14 / 45** |
| 两类合计（去重） | **20 / 45 = 44.4%** |

逐字样例（全部为真实事件名）：

```
"假绿审计（FAKE-GREEN-AUDIT-20261105）完成：6 个「EX"      ← 引号未闭合
"v3.4.0-alpha.6 发布到 preview 分支（b989a5f9.."          ← 括号未闭合
"P3 #551 修复：lib/memory-writer.js 新增 final"            ← 切在英文词中
"task-37 B-1 准备工作完成并提交 32f15edc（2 files +"      ← 括号未闭合 + 尾随 "+"
"按用户要求分两路派出只读调查并落盘任务书：A=事件碎片化根因（artifacts"   ← 括号未闭合
"两份只读调查交付并复核完成：docs/internal/DEADKEY-AUDI"   ← 路径被切断
```

后果不只是难看：这些名字是**注入面的 L0 索引**（事件卡片/枚举/回显全用它）。名字断在词中 ⇒ 模型与用户都无法从名字判断「这件事是什么」，只能再读检查点，等于索引失效。同一段文字还被用了两次（`evt_0127b3f9` 与 `evt_6e6497f7` 名字**逐字相同**），因为两轮日志的开头 40 字相同 —— 名字不唯一，索引即失效。

### 5.4 名字应该怎么起

**判据（先定语义，再定长度）**：事件名要回答「这件事**现在**是什么、推进到哪」，不是「这一轮说了什么」。

| 规则 | 具体做法 | 反例 |
|---|---|---|
| R1 取**目标句**而非流水句 | 优先取 `sections.goal`；goal 为空时取日志正文的**第一个完整句**（到 `。`/`；` 为止），而不是前 N 字 | 「P3 #551 修复：lib/memory-writer.js 新增 final」 |
| R2 在**语义边界**截断 | 只在 `。！？；·｜/` 或空格处切；切点不存在则**回溯到上一个边界**再补 `…`；禁止切在括号/引号/英文词内 | 「（b989a5f9..」 |
| R3 长度目标 20-60，硬上限 80 | 不设 40 这个中间常量；40 只够一句中文，容不下「对象 + 进度态」 | 40 |
| R4 名字必须**随进度 rename** | 里程碑/收口时 `memory_event(action=rename)`（已有此 action）；名字是索引不是流水号 | 从 11-05 到 11-08 名字一次没变 |
| R5 名字必须**唯一** | 新建前若同名事件 active 存在 ⇒ 先走 §4 的判据决定 append 还是加限定词；实测已有 2 组同名事件 | `evt_0127b3f9` / `evt_6e6497f7` |

**推荐的命名模板**（两段式，各段都能机读）：

```
<对象> · <进度态>
```

样例（同一件事在三个里程碑上的三个名字，靠 R4 演进）：

```
事件碎片化根因调查 · Q1-Q3 已取证
事件碎片化根因调查 · 5 问全答，待落地方案
事件碎片化根因调查 · 方案定稿（P0-P2）
```

这样名字同时满足：人可读、能看出进度、能作为后续 append/rename 的锚点、且与事件名唯一性判据兼容。

**落地位置**：命名逻辑应抽成一个纯函数（如 `eventNameFromGoalPre(goalText, { max: 60 })`），放 `lib/event-write.js`，由 `lib/index.js:24523` 与 `lib/event-write.js:593` 两处共用。当前是两处各写一遍 `.slice(0, 40)`（复制粘贴常量），改一处漏一处即为分裂。

## 6. 分阶段落地方案

> 全部为方案，不含实现；落点行号以 HEAD `a21f3b1c` 为准。

### P0 · 止血（不改 schema、不改 26 字段契约、不跑生成器）

| # | 改动 | 落点 | 预期效果（可测） | 风险 |
|---|---|---|---|---|
| **P0-1** | 主题门换判据：把「词袋重合 ≥0.34」换成 §4 判据 1（`ids(name) ∩ ids(新日志) ≠ ∅`） | `lib/index.js:24470-24507`（内联 IIFE）+ `lib/event-write.js:156-185`（模块级同族） | 11-07 那类 17 个/日的碎片降到按标识分组的量级；§4.3 实测 27→20（全库 45→38） | **两处必须同批改**（内联 IIFE 是 `new Function` 抽取求值的硬约束，见 `lib/index.js:24465-24469`），改一处即分裂；IIFE 内不得引用任何外部符号 |
| **P0-2** | 名字按语义边界截断 + 目标长度 60（抽成纯函数供两处共用） | `lib/index.js:24523`、`lib/event-write.js:593` | 「词中截断」从 20/45 降到 0；名字唯一性检查可避免同名双事件 | 名字变长会改变注入面体积（事件卡片/枚举回显），需与 slim 预算一起量；两处常量必须同源 |
| **P0-3** | 创建时填 `sections.goal = name` | `lib/event-write.js:231`（`emptyEventPre` 之后） | 四段全空率下降；空壳判定（`lib/index.js:13887-13892`）不再命中碎片 | goal 与 name 内容重复；需接受「初值即名字」这一事实（好于空） |
| **P0-4** | `kind` 推断与新增枚举值 `unplanned` | `lib/event-store.js:31`（枚举）、`lib/event-store.js:120`（默认值改由推断决定）、`lib/event-write.js:231`（推断点） | 碎片不再被渲染成「账本事件」（`lib/client.js:10392` 的兜底档），改为「待归并」（`lib/client.js:10390` 已有分支，前端零改动） | 枚举新增值 ⇒ 按本仓纪律**必须先重启宿主**再验证（宿主内存旧 enum 会静默降级）；且 `EVENT_KINDS` 的改动点不止一处（`upgrade-apply.js:273/381`、`lib/index.js:25242` 的 enum 描述） |

### P1 · 结构修正

| # | 改动 | 落点 | 预期效果 | 风险 |
|---|---|---|---|---|
| **P1-1** | append 检查点时，若事件头该键为空则从检查点同名键补齐（**只填空，绝不覆盖**） | `lib/event-write.js:270`（`appendCheckpointPre` 事务内） | 27 个碎片中 9 个能立刻补齐部分四段（§3.3） | 必须复用同一写事务（`mutateUnlockedPre`），不能另起 `set`（会与串行锁打架）；`append-only` 语义下这是「改事件头」而非「改检查点」，需在注释里写清边界 |
| **P1-2** | `close` 时要求 `sections.goal` 与 `sections.doing` 非空，缺则报错并指出缺哪个键 | `lib/event-store.js` close 分支 | 收口事件必然带四段（当前 `closed` 只校验 `outcome`，见 `:212`） | **会打红既有 close 调用点**；本次未统计调用点数量（§8） |
| **P1-3** | `memory_event(action=set, sections=…)` 收到「显式空串且原值非空」时拒绝（或记 diag 后照写） | `lib/event-store.js:860-865` | 堵住唯一能把四段擦空的路径 | 与「允许清空」的合法场景冲突（例如方向变了要作废某段）⇒ 建议改为「显式空串必须同时传 `sectionsClearedBy`」太重；更轻的做法是只记 diag 不拒绝 |
| **P1-4** | 会话级 append：`idemTag = 'sess:<sid>'` | `lib/event-write.js:211-236`（`createEventForWorkUnlockedPre` 增 `idemTag` 入参）+ `lib/index.js:24520`（调用点） | 一次性把「每轮一条」压成「每会话数条」，这是收益最大的结构化改动 | `idemTag` 现被迁移幂等占用（`curate:` 前缀）⇒ 必须有命名空间约定；需实测 `exec.agent.session.id` 在该 handler 可达（§8） |

### P2 · 长期

| # | 改动 | 落点 | 预期效果 | 风险 |
|---|---|---|---|---|
| **P2-1** | 新增 `memory_event(action='merge')`：把 source 的检查点**复制**进目标（按 `at` 归并、按 `idemKey` 去重），source 置 `closed` + `pausedReason='merged-into:<id>'` | `lib/index.js` 工具分支 + `lib/event-store.js` 新方法 | 误拆可逆（当前运行时无法合并，误拆只能人改 JSON） | 新增 action 属语义扩展，需显式裁定；且必须先重启宿主验证 enum |
| **P2-2** | 存量一次性整理：把 27 个碎片按 §4 判据合并，产出可审计的 migration 草稿（走 `upgrade-apply` 的既有校验链） | `lib/migration-prompt.js`（提示词补「碎片合并」一节）+ 一次性执行 | 45 个事件收敛到 30±；白板/事件卡片恢复可读 | 一次性写操作，必须先备份 `event-store.json`；且 `upgrade-apply` 的 kind 校验要求草稿 kind 合法（不能写 `unplanned`，除非 P0-4 已落地并重启） |
| **P2-3** | 名字与进度绑定：把「里程碑/收口时 rename」写进铭文与工具描述 | `lib/index.js:1537` 起的铭文段、`memory_event` 的工具描述（`lib/index.js:25240` 附近） | 名字随进度演进，索引长期有效 | 提示词变更会改变注入面字节，需与缓存前缀策略一起看（本仓有过「提示词变更击穿前缀缓存」的记录） |

**建议的施工顺序**：P0-2（零风险、立刻可感）→ P0-3（零风险）→ P0-1（根因止血）→ P0-4（需重启）→ P1 → P2。P0-1 是唯一能真正改变「每轮一条」的改动，其余都是让剩下的条目可读。

---

## 7. 复算命令清单

全部命令在 `D:/dsh-auto-memory` 下、用 PowerShell 执行；路径含空格与中文，必须整体加引号。前置一行：

```powershell
$ev = "C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json"
```

| 编号 | 命令（见下方 C1-C9 代码块） | 期望读数（2026-11-08 05:50 实测） |
|---|---|---|
| C1 | kind 分布 + 四段全空分布 + 事件/检查点总数 | `events=45 cps=697`；`{"ledger":13,"project":5,"unknown":27}`；`{"ledger":[0,13],"project":[0,5],"unknown":[24,27]}` |
| C2 | 名字长度分布 | `{"4":1,"16":1,"18":1,"19":1,"20":1,"21":1,"26":1,"27":1,"28":2,"29":1,"32":1,"34":1,"35":2,"39":5,"40":21,"46":1,"49":1,"56":1,"57":1}` |
| C3 | 持续时长分桶与均值 | `0d n=35 avg=1.97` / `1-3d n=4 avg=46.00` / `>3d n=6 avg=74.00` |
| C4 | 引入 0.34 的提交 | 仅 1 行 `e338473f`，2026-11-05 17:20 |
| C5 | 引入 `pickActiveEventByTopicPre` 的提交 | 同上 1 行 `e338473f` |
| C6 | 该提交删掉的原始行 | `const active = evId ? { id: evId } : resolveActiveEventPre(store0)` |
| C7 | 建事件调用点 | 4 处：`event-write.js:198`（定义）、`:593`、`:687`、`index.js:8710`、`index.js:24520` |
| C8 | 名字被切在词中的条数 | `unbalanced=14 endsAscii=14`（去重合计 20/45） |
| C9 | 检查点四段覆盖 | `anyQuad=503 allFour=163` |

C1：

```powershell
node -e "const fs=require('fs');const e=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).events;const k={};for(const x of e)k[x.kind]=(k[x.kind]||0)+1;const empty=x=>['goal','doing','deadend','next'].every(y=>!String((x.sections||{})[y]||'').trim());const z={};for(const x of e){z[x.kind]=z[x.kind]||[0,0];z[x.kind][1]++;if(empty(x))z[x.kind][0]++}console.log('events='+e.length,'cps='+e.reduce((a,b)=>a+(b.checkpoints||[]).length,0));console.log(JSON.stringify(k));console.log(JSON.stringify(z))" "$ev"
```

C2：

```powershell
node -e "const fs=require('fs');const e=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).events;const L={};for(const x of e)L[x.name.length]=(L[x.name.length]||0)+1;console.log(JSON.stringify(L))" "$ev"
```

C3：

```powershell
node -e "const fs=require('fs');const e=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).events;const b={'0d':[],'1-3d':[],'>3d':[]};for(const x of e){const a=(x.checkpoints||[]).map(c=>Number(c.at)||0).filter(v=>v>0);const d=a.length>=2?(Math.max(...a)-Math.min(...a))/864e5:0;b[d<=0.5?'0d':d<=3?'1-3d':'>3d'].push((x.checkpoints||[]).length)}for(const k of Object.keys(b))console.log(k,'n='+b[k].length,'avg='+(b[k].reduce((x,y)=>x+y,0)/b[k].length).toFixed(2))" "$ev"
```

C4：

```powershell
git log --pretty=format:"%h|%ad|%s" --date=format:"%Y-%m-%d %H:%M" -S "0.34" -- lib/index.js
```

C5：

```powershell
git log --pretty=format:"%h|%ad|%s" --date=format:"%Y-%m-%d %H:%M" -S "pickActiveEventByTopicPre" -- lib/event-write.js lib/index.js
```

C6：

```powershell
git show e338473f -- lib/index.js | Select-String -Pattern "resolveActiveEventPre" -Context 3,3
```

C7：

```powershell
Select-String -Path lib/*.js -Pattern "createEventForWorkPre\(" | ForEach-Object { "$($_.Filename):$($_.LineNumber)" }
```

C8：

```powershell
node -e "const fs=require('fs');const e=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).events;const bad=n=>(n.split('（').length!==n.split('）').length)||(n.split('「').length!==n.split('」').length);console.log('unbalanced='+e.filter(x=>bad(x.name)).length,'endsAscii='+e.filter(x=>/[A-Za-z0-9]$/.test(x.name)).length)" "$ev"
```

C9：

```powershell
node -e "const fs=require('fs');const e=JSON.parse(fs.readFileSync(process.argv[1],'utf8')).events;let q=0,all=0;for(const x of e)for(const c of(x.checkpoints||[])){if(['goal','state','dead','next'].some(k=>String(c[k]||'').trim()))q++;if(['goal','state','dead','next'].every(k=>String(c[k]||'').trim()))all++}console.log('anyQuad='+q,'allFour='+all)" "$ev"
```

---

## 8. 未验证 / 边界

1. **事件库在调查期间继续增长**：任务书写的是 43 个事件 / 696 条检查点，本次实测为 **45 / 697**（多出的 2 个是同一名字的碎片，`evt_0127b3f9` 与 `evt_6e6497f7`，2026-11-08 05:4x 创建）。因此「按日 unknown 分布」与任务书事实 3 有 ±1~2 的差异（§1.4 已逐条列出）。凡冲突处，以本文件的实测读数为准。
2. **0.34 阈值的比率复算用的是「前一个事件」作代理**：真实 `_best` 是「updatedAt 最大的 active 事件」。本文件的重放取「按 createdAt 排序的前一个事件」，两者在绝大多数时刻重合，但不是精确的历史还原；「自重叠上限 0.081 / 0.320」这一组读数**不依赖该代理**（用事件自己的名字比自己的正文），是结论的主要支撑。
3. **§4.3 的合并重放是「终态数据重放」**：拿当前的 27 个碎片按 createdAt 顺序重跑判据，而不是重放当时的 active/closed 状态。因为检查点 append-only、事件极少关闭（全库 closed 仅 4 个，其中 unknown 占 2 个），该差异对结果影响可忽略，但**不是零**。
4. **`close` 调用点数量未统计**：P1-2 会打红既有调用点，本次只在 `lib/event-store.js` 侧读了校验逻辑（`:212` `closed-needs-outcome`），未全仓统计 `status='closed'` 的写入点。
5. **`exec.agent.session.id` 在 `memory_log` handler 内是否可达未实测**：该 handler 里已用到 `exec.agent.session.header.cwd`（`lib/index.js:24391`），说明 `session` 可达；但 `session.id` 这个具体路径**未验证**，P1-4 依赖它。
6. **前端未跑生成器**：`ev4KindLabelPre`（`lib/client.js:10386`）与 `EV4_PROTO_RUNTIME` 内的 `ticketOf`（`lib/ev4-prototype-blocks.js` 巨型字符串内）是两份**手抄同源**的实现，本文件只做了字符串级比对（两处逻辑一致），**未通过 `build-iter5-skin` 重建验证**（本任务禁跑生成器）。
7. **新增 kind 值需宿主重启**：按本仓纪律（未知 action/enum 会被宿主内存旧枚举静默降级），P0-4 落地后必须重启宿主再验证，静态检查无法发现该缺陷。
8. **未量化「名字变长对注入面的影响」**：P0-2 把名字从 40 提到 60 会增加事件卡片/枚举回显的字符量，本次未测具体增量；按事件数 45 估算量级为 +900 字符（不是实测）。
9. **`unplanned` 这个值的选择依据是「前端已有分支」，不是语义调研**：`kindLabel` 把 `'unplanned'` 渲染为「待归并」（`lib/client.js:10390`），语义贴合碎片，但「待归并」是否等于用户心里那个概念，需用户裁定。
