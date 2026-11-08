# 批次 2 · 碎片链条完整修复 —— 施工细则

- **日期**：2026-11-08
- **上游文档**：[CONSTRUCTION-PLAN-20261108.md](file:///D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md)（批次 2 见第 176-190 行；本表与审计的对应关系见第 340-349 行）
- **审计依据**：[EVENT-FRAGMENTATION-20261108.md](file:///D:/dsh-auto-memory/docs/internal/EVENT-FRAGMENTATION-20261108.md)（§2 Q2 kind / §3 Q3 四段）、[MEMORY-LOGIC-GAPS-20261108.md](file:///D:/dsh-auto-memory/docs/internal/MEMORY-LOGIC-GAPS-20261108.md)（D-5）、[ORPHAN-CAPABILITY-AUDIT-20261108.md](file:///D:/dsh-auto-memory/docs/internal/ORPHAN-CAPABILITY-AUDIT-20261108.md)（C-1）
- **本文件状态**：**细则待用户确认，未开工**
- **本文件不改任何代码**：全文只出方案。临时探针脚本落在 `artifacts/_detail-batch2/`，未触碰 `lib/`、`tests/`、工作区根目录。

---

## 0. 口径订正与环境实测（先读这一节）

### 0.1 两处必须订正的前提

| # | 任务书/总表原写 | 实测 | 影响 |
|---|---|---|---|
| ① | 「该仓用 CommonJS 风格」 | **不是**。`package.json:5` 为 `"type": "module"`，`lib/*.js` 全部用 `import` / `export`；只有一次性探针用 `.cjs` | 本细则全部 JS 片段按 **ESM** 写 |
| ② | 「`createEventForWorkPre` 传 sections 就能建出 goal」 | **不能**。实测传 `{sections, members, outcome, startMs, endMs, kind}` 后落盘：`sections.goal=""`、`members=[]`、`outcome=null`、`startMs=0`、`endMs=0`、`kind="unknown"` —— **六个字段全部静默丢弃**（`event-write.js:231` 只做 `emptyEventPre(name, { id, summary })`） | 直接决定 2.1 的两条实现路线（见 §2.1.2） |

### 0.2 目标文件基线（三者缺一不可：bytes / 行数 / sha16）

| 文件 | 字节 | LF | CRLF | sha256 前 16 |
|---|---|---|---|---|
| `lib/index.js` | 2,082,057 | 28,809 | **28,809** | `36BE3335AED3128E` |
| `lib/event-store.js` | 70,215 | 1,081 | 0 | `A1534113FA15747F` |
| `lib/event-write.js` | 42,659 | 749 | 0 | `D93369FBD2169DE9` |
| `lib/event-plan.js` | 7,336 | 149 | 0 | `4BEA31F201EBB169` |
| `lib/plan-render.js` | 10,249 | 282 | 0 | `08379D09F6BDC042` |
| `lib/event-regroup.js` | 11,486 | 291 | 0 | `40280C7F8A43EF42` |
| `lib/event-regroup-scan.js` | 11,745 | 258 | 0 | `1D127F386AA679A2` |
| `lib/event-regroup-propose.js` | 9,274 | 231 | 0 | `BD84E6AA31EBE016` |
| `lib/event-regroup-apply.js` | 10,334 | 260 | 0 | `35D8D4AC0517F6E7` |

> **`lib/index.js` 是 100% CRLF（CRLF 数 == LF 数 == 28,809）**，其余 lib 文件是纯 LF。对 `index.js` 的 edit 必须保持 CRLF；对其余文件不得引入 CR。收工时必须复测本表，并把差值对到「本批预估增量区间」内。

复算命令（PowerShell，可原样执行）：

```
$files = @("lib\index.js","lib\event-store.js","lib\event-write.js","lib\event-plan.js","lib\plan-render.js","lib\event-regroup.js","lib\event-regroup-scan.js","lib\event-regroup-propose.js","lib\event-regroup-apply.js")
foreach ($f in $files) {
  $b = [System.IO.File]::ReadAllBytes($f)
  $sha = (Get-FileHash $f -Algorithm SHA256).Hash
  $txt = [System.Text.Encoding]::UTF8.GetString($b)
  $lf = 0; foreach ($ch in $txt.ToCharArray()) { if ($ch -eq [char]10) { $lf++ } }
  $crlf = ([regex]::Matches($txt, [string][char]13 + [string][char]10)).Count
  Write-Output ($f + " bytes=" + $b.Length + " LF=" + $lf + " CRLF=" + $crlf + " sha16=" + $sha.Substring(0,16))
}
```

### 0.3 真实数据基线（`event-store.json`）

- 路径：`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`
- 字节 **3,022,982**｜mtime `2026-11-08T09:47:56`｜sha256 `D6A061D67B7E4BEE901EC09B5A3B8468A232A9C3267104325018CCAD695B0EE7`
- 顶层键仅 3 个：`schema` / `events` / `updatedAt`；`schema = "v4_event_store_v2"`
- **50 个事件**（active **46** / closed **4**）｜**706 条检查点**
- `kind` 分布：`ledger` **13** / `project` **6** / `unknown` **31**
- 检查点 `idemKey`：有 **646** / 无 **60**
- 检查点 `kind` 分布：log 298｜progress 162｜handoff 156｜plan 36｜deadend 18｜state 17｜grouping 7｜handoff-write-failed 6｜plan-write-failed 5｜todo 1
- 四段全空事件 **28** / `sections.goal` 非空 **22** / `members` 非空 **25** / `outcome` 非空 **4** / 起止时间均 >0 **48**
- `unknown` 事件的检查点条数分布：`{0:1, 1:15, 2:9, 3:4, 7:1, 61:1}`（合计 113 条）
- **「27 个碎片」的实测订正**：`unknown & active & 检查点≤2` = **23** 个；`unknown & active & 检查点≤1` = **14** 个；`unknown` 总数 = **31** 个。三种口径都不是 27 —— 施工与验收**一律以「23」为碎片口径**（见 §2.4.2）。

### 0.4 白板基线（`PLAN.md`）

- 路径同上目录 `handoff/PLAN.md`｜**15,250 字符 / 26,872 字节**｜**34 颗 memory 锚点（34 颗互不相同）**｜用户区 `user` 区块 **0 个**｜顶层节 4 个（当前状态 / 近期进展 / 关键约束 / 待办）
- 同参渲染对照：`renderPlanFromEventsPre(store.events, { wsName: "dsh-auto-memory" })` → **9,400 字符 / 16,811 字节 / 0 颗锚点**，与磁盘现状**不相等**（第 6 行即分叉）。
- 结论：**「事件 → 白板」目前不是投影关系**。磁盘上的 PLAN.md 是历史上手写与半渲染的混合产物，34 颗锚点由 `writePlanSnapshot` 内的 `anchoredPlanPre` 现场分配。这一条直接决定 2.5 的改法（见 §2.5.2）。
- `handoff/` 目录：781 个文件（`.md` 771 篇），`archive/` 328 篇。

### 0.5 总表行号漂移实测表（**总表给的行号已漂移，施工一律以本表为准**）

| 项 | 总表原写 | 实测 | 实测该行内容 |
|---|---|---|---|
| 2.1 | `lib/index.js:24520` | **`:24561`** | `const created = await createEventForWorkPre(storePath, {`（24520 实为 `if (!_best) return null`） |
| 2.1 邻 | — | **`:24564`** | `name: (gate.clean || note).trim().slice(0, 40),`（总表 1.5 写的 `:24523` 亦已漂移） |
| 2.2 | `lib/event-store.js:96-126` | **吻合** | 96 = `export function emptyEventPre`；120 = kind 默认值 `unknown` |
| 2.2 | `lib/event-store.js:255-269` | **吻合** | 255 = `export function normalizeEventPre`；262 = `if (!EVENT_KINDS.includes(out.kind)) out.kind = unknown` |
| 2.3 | `lib/index.js:8581` | **`:8622`（函数定义）/ `:8639`（确定性聚类）/ `:8649`（dryRun 分支）** | 8581 实为 `diagThrottled('listUnarchivedPre-global-fallback'…)` |
| 2.4 | `lib/index.js:8647` | **`:8688`** | `async writeCuratedEventsPre(opts = {}) {`（8647 实为 `sections: { goal: g.goalKey, … }`） |
| 2.5 | `lib/index.js:24721` | **`:24749`（fromEvents 分支）/ `:24762`（渲染调用）** | 24721 实为「必须完全自包含」注释行 |

### 0.6 既有 event-regroup 四件套与套件基线

| 模块 | 字节 | 生产调用点 |
|---|---|---|
| `event-regroup.js` | 11,486 | **0**（仅被 scan/propose import + 1 个套件） |
| `event-regroup-scan.js` | 11,745 | **0** |
| `event-regroup-propose.js` | 9,274 | **0** |
| `event-regroup-apply.js` | 10,334 | 仅 `upgrade-apply.js:49`（同族死岛） |
| **合计** | **42,839** | `grep -c regroup lib/index.js` = **0** |

四个套件当前基线（本轮实跑，全部 EXIT=0）：`smoke-test-v5-p6-event-regroup` **PASS 48 / FAIL 0**；`-r2-regroup-scan` **44 / 0**；`-r3-regroup-propose` **43 / 0**；`-r6-regroup-apply` **40 / 0**。

### 0.7 工作树状态（开工前必须复核）

分支 `preview`｜HEAD `4132510b`｜领先 `origin/preview` **24** 提交｜`git status --porcelain` **20** 条。

**本细则五项一律不改动下列已有脏文件**：`lib/index.js`（工作区版本）、`lib/tier-layer-inject.js`、`lib/tier0-catalog.js`、`tests/smoke/smoke-test-tier0-catalog.mjs`、`.gitignore` 及未跟踪文件。

> ⚠️ **`lib/index.js` 本身就在脏列表里**，而 2.1/2.3/2.4/2.5 四项都要改它。这不是「不要动脏文件」的冲突，而是**必须先做基线钉死**：改动前记「读基线」，写入前再记一次，两读的 (bytes, lines, sha16) 不一致即停机上报（本仓已实证过一次 964 B 外来改动混入）。详见 §2.4.6 与 §5。

---
## 2.1 创建事件时填 goal 首段

### 2.1.1 现状实测

落点（实测 **`lib/index.js:24556-24568`**，总表原写 `:24520`，**实测 24561**）：

```
        if (active) {
          evId = active.id
          _ownDecision = 'attached'
          _ownEventName = String((active.event && active.event.name) || '')
        } else {
          const created = await createEventForWorkPre(storePath, {
            today: date,
            dayBoundaryMinutes: boundaryMin,
            name: (gate.clean || note).trim().slice(0, 40),
          })
          evId = created.id
          _ownDecision = _wantEv ? 'explicit' : 'created'
          _ownEventName = String((created.event && created.event.name) || '')
        }
```

被调方（实测 **`lib/event-write.js:211-236`**，逐字）：

```
async function createEventForWorkUnlockedPre(storePath, opts) {
  const store = await readStorePre(storePath)
  const today = String(opts.today || '')
  const rawName = String(opts.name || '').trim()
  let name = rawName
  ...
  if (name.length > 80) name = name.slice(0, 79) + '…'
  const used = new Set((store.events || []).map((e) => e.id))
  ...
  const ev = emptyEventPre(name, { id, summary: opts.summary })
  store.events = store.events || []
  store.events.push(ev)
  await writeStorePre(storePath, store)
  return { id: ev.id, event: ev }
}
```

**实测确认**：`opts` 只被读了 `today` / `name` / `summary` / `dayBoundaryMinutes` 四项，**`sections` 从未被读**。把 `sections` 塞进 `opts` 是**无效**的（本轮探针实测落盘 `sections.goal = ""`）。

写入后也无人回填：`lib/event-write.js:635-644` 的注释逐字写明 handoff 路径「**只追加检查点，不镜像 sections**」。真实数据证据：50 个事件里**四段全空 28 个**、`goal` 非空仅 22 个，且这 22 个全部来自 `memory_event(action=create/set)` 或迁移，无一个来自 `memory_log`。

### 2.1.2 改法（函数级 diff）

**结论先行：主方案要越过总表落点 1 个文件（`event-write.js`）**，理由是实测证明「只在 index.js 内传 sections 完全无效」。两条路都给出，**推荐 B**。

#### 方案 B（推荐：改 `event-write.js` + `index.js`）

**改 `lib/event-write.js:231`**（1 行 → 5 行）：

```
  // 旧：const ev = emptyEventPre(name, { id, summary: opts.summary })
  const ev = emptyEventPre(name, { id, summary: opts.summary })
  // ★批次 2.1（2026-11-08）：透传四段。只接受四个已知键，类型不符一律忽略（不抛错，
  //   与空事件骨架默认值语义一致）；不传时行为与旧版**逐字节相同**（sections 仍全空）。
  const _secIn = (opts.sections && typeof opts.sections === 'object') ? opts.sections : null
  if (_secIn) for (const k of ['goal', 'doing', 'deadend', 'next']) {
    if (typeof _secIn[k] === 'string') ev.sections[k] = _secIn[k]
  }
```

**改 `lib/index.js:24561-24565`**（对象里加 1 个键）：

```
          const created = await createEventForWorkPre(storePath, {
            today: date,
            dayBoundaryMinutes: boundaryMin,
            name: (gate.clean || note).trim().slice(0, 40),
            // ★批次 2.1：新建事件必须带 goal 首段，否则四段永远空（A-4）。
            //   取值 = 本条日志正文（与事件名同源），压成单行并夹到 200 字；
            //   不做「猜测性摘要」——日志正文本身已是一句话概括（写闸门 maxEntryChars=2000）。
            sections: { goal: String(gate.clean || note || '').replace(/\s+/g, ' ').trim().slice(0, 200) },
          })
```

签名：`createEventForWorkPre(deps, opts)` **不变**（只多读一个可选键，向后兼容）；`createEventForWorkUnlockedPre` 也不变。

#### 方案 A（严格落在 `index.js` 内：create 之后再补一笔 set）

```
          const created = await createEventForWorkPre(storePath, { ... })   // 三个键原样不动
          evId = created.id
          // ★批次 2.1 方案 A：建完立刻补写 goal（两笔事务，中间态 goal 为空）
          try {
            await eventStorePre.set(storePath, evId, {
              sections: { goal: String(gate.clean || note || '').replace(/\s+/g, ' ').trim().slice(0, 200) },
            })
          } catch (_) { /* 补写失败不阻断主流程：事件与检查点仍会写入 */ }
```

**方案 A 的硬代价（不推荐它的真实原因）**：`memory_log` 的工具处理体会被两个套件用 `new Function` **抽取后单独求值**，形参表写死 17 个（`tests/smoke/smoke-test-v4-h1b-memory-log.mjs:104-115`）。`eventStorePre` 不在其中 ⇒ 一旦引用它，当场 `ReferenceError: eventStorePre is not defined`，两个套件必红。要救就得改两个套件的形参表与调用实参 —— **测试改动比方案 B 的 6 行生产改动更重，且下次重构更容易再次失配**。

### 2.1.3 与既有机制的关系

| 机制 | 影响 |
|---|---|
| pruneIfNeeded | **不涉及**。`grep pruneIfNeeded lib/event-store.js` = 0 命中；该函数属 `fact-store.js` |
| flush 整体重写 | **不涉及**。事件写走 `mutatePre` → `writeStorePre`（tmp → rename 原子写），非整体重写架构 |
| 注入面 budget | **不涉及**。`sections.goal` 不进注入面：T1/T2 读 name/summary/checkpoints；白板「当前状态」表读 summary；`goal` 只进白板「近期进展」小节（`plan-render.js:158`），该节不在预算裁剪面 |
| `smoke-test-v4-h1b-memory-log` | **方案 B：零影响**（不新增外部符号）。**方案 A：必红** |
| `smoke-test-v4-memory-event-tool` | 同 h1b（同一抽取管道） |
| `smoke-test-v5-p6-r6-regroup-apply` | 不受影响（不碰 apply） |
| `event-store.validateEventPre` | 不受影响（`sections.goal` 只校验 `typeof === 'string'`，`:217`） |
| `event-write.js` 头部注释 `:187-196` | **需同批补一句 goal 取值口径**，否则注释与实现再次错位（本仓已有同族教训） |

### 2.1.4 失败模式（4 条）

| # | 会怎么错 | 测试里怎么被发现 |
|---|---|---|
| F1 | 把 `sections` 塞进 `opts` 但**没改** `event-write.js` ⇒ 落盘 goal 仍空，工具回执照样说成功（**静默无效**，正是 §0.1② 的同款陷阱） | 真调 `memory_log` 后读盘断言 `events[0].sections.goal === note`；只在 index.js 传参时此断言必红 |
| F2 | goal 取原文但含换行/超长 ⇒ 白板「近期进展」被一条 2,000 字日志撑爆（`PLAN_SECTION_CHAR_MAX=600` 只截渲染不截存储） | 断言落盘 `goal.length <= 200` 且不含 `CR`/`LF`；喂 2,000 字日志必红 |
| F3 | 只覆盖 `memory_log` 路径，`appendHandoffCheckpointPre` 的建事件分支（`event-write.js:593`）仍写空 goal | 断言必须覆盖**两处建事件入口**：`memory_log` 路径 + `memory_note(kind=handoff)` 路径；只测前者则 F3 漏网 |
| F4 | goal 写成事件名的截断副本（40 字）⇒ 与 name 重复但信息量不增，比空更糟（读的人以为是真目标） | 构造 120 字日志，断言 `goal.length >= 100` |

### 2.1.5 验收用例设计

#### 真执行（真 import → 真构造 → 真调用 → 断言返回值/副作用）

```
// 新增 tests/smoke/smoke-test-batch2-1-event-goal.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const EW = await import(pathToFileURL(path.join(REPO, 'lib/event-write.js')).href)
const SANDBOX = path.join(REPO, '.tmp-smoke-run/b2-1')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })
const STORE = path.join(SANDBOX, 'event-store.json')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n + (d ? ' :: ' + d : '')) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// A. 直连入口：createEventForWorkPre 透传 sections
const a = await EW.createEventForWorkPre(STORE, { name: 'A 工作', sections: { goal: '把 goal 首段填上' } })
const sa = JSON.parse(fs.readFileSync(STORE, 'utf8'))
const ea = sa.events.find((e) => e.id === a.id)
ok(ea.sections.goal === '把 goal 首段填上', 'A-1 ★createEventForWorkPre 透传 sections.goal', JSON.stringify(ea.sections.goal))

// B. 不传 sections ⇒ 逐字节等价旧行为（向后兼容，不可被改坏）
const b = await EW.createEventForWorkPre(STORE, { name: 'B 工作' })
const eb = JSON.parse(fs.readFileSync(STORE, 'utf8')).events.find((e) => e.id === b.id)
ok(eb.sections.goal === '', 'B-1 ★不传 sections ⇒ goal 仍为空串')
ok(JSON.stringify(Object.keys(eb)) === JSON.stringify(Object.keys(ea)), 'B-2 26 字段集合与顺序未变')

// C. 超长 / 换行夹断
const LONG = 'x'.repeat(400) + String.fromCharCode(10) + '第二行'
const c = await EW.createEventForWorkPre(STORE, { name: 'C 工作', sections: { goal: LONG } })
const ec = JSON.parse(fs.readFileSync(STORE, 'utf8')).events.find((e) => e.id === c.id)
ok(ec.sections.goal.length <= 200, 'C-1 goal 夹到 <=200 字', String(ec.sections.goal.length))
ok(ec.sections.goal.indexOf(String.fromCharCode(10)) < 0, 'C-2 goal 不含换行')

// D. 非法类型 fail-soft：不写垃圾、也不抛错
const d = await EW.createEventForWorkPre(STORE, { name: 'D 工作', sections: { goal: 12345 } })
const ed = JSON.parse(fs.readFileSync(STORE, 'utf8')).events.find((e) => e.id === d.id)
ok(ed.sections.goal === '', 'D-1 ★goal 非字符串 ⇒ 保持空串（不写垃圾、不抛错）')
```

**总表判据「构造 3 次新建 → 3 个 goal 都非空」**用端到端复现（复用 h1b 的抽取管道，真调 `memory_log` 三次）：

```
for (let i = 1; i <= 3; i++) {
  await tool.execute({ note: '批次 2.1 端到端第 ' + i + ' 条：事件必须带 goal 首段', kind: 'fact' }, exec)
}
const s3 = JSON.parse(fs.readFileSync(storePath, 'utf8'))
const created3 = s3.events.filter((e) => e.name.indexOf('批次 2.1 端到端') === 0)
ok(created3.length === 3, 'E-1 真建 3 个事件', String(created3.length))
ok(created3.every((e) => String(e.sections.goal || '').trim().length > 0),
  'E-2 ★★★3 个 goal 全部非空', created3.map((e) => e.sections.goal.length).join(','))
```

#### 负路径（旧实现通过、新实现必须拒绝）

**取 F1 的形态**：把 `index.js` 新增的 `sections:` 那一行**删掉**（只改 event-write.js、不改 index.js），断言 **E-2 必须变红**（3 个 goal 全空）。

这条负路径的鉴别力在于：它区分「event-write 的透传逻辑存在」与「它真的被调用到了」。只有 A-1 会绿而 E-2 红 —— 这正是「半修」的典型形状，必须让它在套件里显式红出来。

#### 变异必红

| 变异 | 改哪一行回旧形态 | 必须变红的断言 |
|---|---|---|
| M1-a | `lib/event-write.js:231` 回退为 `const ev = emptyEventPre(name, { id, summary: opts.summary })`（删掉 4 行透传） | **A-1** 必红 |
| M1-b | `lib/index.js:24561` 的对象里删掉 `sections:` 那一行 | **E-2** 必红（A-1 仍绿） |
| M1-c | 把 `slice(0, 200)` 改成 `slice(0, 0)` | **C-1 仍绿**（0 ≤ 200 恒真）、**E-2 必红** ⇒ 证明 C-1 单条**无区分力**，必须与 E-2 同跑（此条须写进套件注释） |
| M1-d | 把 `typeof _secIn[k] === 'string'` 改成直接赋值 | **D-1** 必红（goal 变 12345 或抛错） |

### 2.1.6 风险与回滚

- **不碰真实用户数据**：验收全在 `.tmp-smoke-run/b2-1/` 沙箱里跑（与 `smoke-test-v4-h1b-memory-log.mjs:24` 同款约定）。
- 生产路径代价：新建事件多写 ≤200 字符/事件。按当前 50 事件 / 706 检查点的速率（≈1 事件/轮），千事件 +200 KB 量级，可忽略。
- **回滚步骤**：(1) revert 本项的 2 个 hunk（`event-write.js` +4/-1、`index.js` +1/-0）；(2) **已落盘的 goal 不需要数据回滚**——空 goal 与有 goal 都是合法状态，`validateEventPre` 两者都通过；(3) 若某个 goal 内容写错，用 `memory_event(action=set, sections:{goal:"正确值"})` 单事件修正。

### 2.1.7 工时与依赖

- 改动量：**生产代码 +5 行 / -1 行**（`event-write.js` +4/-1、`index.js` +1/-0）；**新增 1 个套件 / 约 10 条断言**。
- **依赖 1.4（必须先完成）**：2.1 只在「主题门返回 null ⇒ 新建」分支生效。门若仍是 0.34 词袋比（数学上不可能通过，见 A-1），则**每条 memory_log 都新建事件**，2.1 会让 100% 的日志都长出独立事件 —— 反而放大碎片数。1.4 落地后新建频率才降到真实「新事」频率。
- 与 2.2 可并行（不同文件），但两者都过 `validateEventPre`，建议同批回归。

---
## 2.2 kind 推断（ledger / project / unknown）

### 2.2.1 现状实测

落点吻合总表。**创建默认值（`lib/event-store.js:96-127`）**：

```
/** 空事件骨架（严格 16 字段，一个不多一个不少） */
export function emptyEventPre(name, opts = {}) {
  const t = Number(opts.now) || now0()
  return {
    id: opts.id || '',
    name: String(name == null ? '' : name),
    summary: String(opts.summary == null ? '' : opts.summary),
    outcome: null,
    skillRef: null,
    status: 'active',
    pausedReason: null,
    sections: { goal: '', doing: '', deadend: '', next: '' },
    checkpoints: [],
    ...
    kind: 'unknown',      // 徽章：ledger / planSnapshot / sessionTranscript / ...
    confidence: 'unknown',// 徽章：high / medium / low / unknown
    ...
  }
}
```

**读时归一化（`lib/event-store.js:255-269`）**：

```
export function normalizeEventPre(ev) {
  if (!ev || typeof ev !== 'object') return ev
  const out = Object.assign({}, ev)
  if (typeof out.startMs !== 'number') out.startMs = 0
  if (typeof out.endMs !== 'number') out.endMs = 0
  if (!Array.isArray(out.members)) out.members = []
  if (typeof out.rationale !== 'string') out.rationale = ''
  if (!EVENT_KINDS.includes(out.kind)) out.kind = 'unknown'
  if (!EVENT_CONFIDENCES.includes(out.confidence)) out.confidence = 'unknown'
  ...
  return out
}
```

**全仓事实**：`EVENT_KINDS`（`:31`）= `['ledger','planSnapshot','sessionTranscript','project','mechanical','unknown']`，**没有任何一处代码在创建时或写入后推断 kind** —— 三个来源只有：① 写死默认值 `'unknown'`；② 调用方显式传；③ 读时非法值回落 `'unknown'`。

**为什么这条必须修（消费侧证据，逐字）**：`lib/client.js:10371` 的 `ev4TicketOfPre` 为

```
if (e.kind === 'demo' || e.kind !== 'ledger') return 'narrow'
```

⇒ 非 `ledger` 一律渲染成 **窄卡**（只有标题+时间，不渲染 badge/summary/成果），且**泳道/甘特与工作流视图都用 `EV.filter(e => e.kind === "ledger")` 取数 ⇒ 不收录**。同时 `ev4KindLabelPre`（`client.js:10386-10393`）把 `unknown` 渲染成「**账本事件**」——用户看到的碎片不是标着「未知」，而是标着「账本事件」的窄卡。这解释了为什么碎片长期没被识别成缺陷。

**判据不得越界的硬理由**：`EVENT_TOP_FIELDS`（`:43-50`）是 **26 项 fail-closed 契约**，`validateEventPre` 对未知顶层键判 `unknown:` **硬拒**，多个套件断言「恰好 26 字段」。⇒ **推断只能改已有字段 `kind` 的取值，绝不能新增 `kindSource` 之类的顶层字段**。

### 2.2.2 改法（函数级 diff）

三档判据，**自上而下、先命中先定**，全部只用「创建时已有信号」：

| 序 | 条件 | kind | 依据 |
|---|---|---|---|
| 1 | 调用方显式传了合法 `kind` | **用它**（不推断） | 显式优于推断 |
| 2 | `members` 里存在指向文档的路径（含 `docs/` 或 `handoff/` 或结尾 `.md`） | `ledger` | 有来源文档 ⇒ 账本归组 |
| 3 | `outcome` 非空 **且** `startMs>0` **且** `endMs>0` | `project` | 有成果+有起止 ⇒ 已完结的项目级事件 |
| 4 | 其余 | `unknown` | **信号不足就不猜**（保持现状） |

**改 `lib/event-store.js`：新增一个纯函数（放在 `normalizeEventPre` 之后，约 `:269` 后插入），并在 `create` 里调用一次。**

```
/**
 * ★批次 2.2（2026-11-08）：**kind 推断**（A-3：全仓零推断，31/50 落 unknown）。
 *
 * 判据（自上而下，先命中先定；全部只用「创建时已有信号」）：
 *   ① 显式合法 kind ⇒ 原样返回（显式优于推断）
 *   ② members 里有指向文档的路径 ⇒ 'ledger'
 *   ③ outcome 非空 且 startMs>0 且 endMs>0 ⇒ 'project'
 *   ④ 其余 ⇒ 'unknown'（**信号不足就不猜**——unknown 不是失败，它表示形态未确认）
 *
 * ★为什么是纯函数：推断必须可单测、可复算；不许在这里读盘或读别的字段。
 * ★为什么不新增顶层字段：EVENT_TOP_FIELDS 是 26 项 fail-closed 契约（validateEventPre 硬拒未知键）。
 *
 * @param {{kind?:string, members?:string[], outcome?:*, startMs?:number, endMs?:number}} src
 * @returns {string} 六值枚举之一
 */
export function inferKindPre(src) {
  const s = (src && typeof src === 'object') ? src : {}
  if (s.kind !== undefined && EVENT_KINDS.includes(s.kind)) return s.kind
  const mem = Array.isArray(s.members) ? s.members : []
  for (const m of mem) {
    const p = String(m == null ? '' : m)
    if (!p) continue
    if (/^docs[\\/]/i.test(p) || /^handoff[\\/]/i.test(p) || /\.md$/i.test(p)) return 'ledger'
  }
  const hasOutcome = typeof s.outcome === 'string' && s.outcome.trim() !== ''
  const hasSpan = Number(s.startMs) > 0 && Number(s.endMs) > 0
  if (hasOutcome && hasSpan) return 'project'
  return 'unknown'
}
```

**改 `create`（`lib/event-store.js:811-843`，`:840` 之后）**：

```
      // ★v2：透传 10 个新字段（非法值留给 validate 抛错，不在这里静默吞）
      applyV2FieldsPre(ev, opts)
      // ★批次 2.2：显式传了 kind 就尊重它；没传才推断（不覆盖显式值）。
      if (!(opts && opts.kind !== undefined)) ev.kind = inferKindPre(opts)
      store.events.push(ev)
      return clone(ev)
```

签名不变（`inferKindPre(src)` 是新导出，只增不改）。

**改 `normalizeEventPre`：不动。** 理由写进注释：读时归一化拿不到「创建时的 members/outcome」语义（它是全量重算，会把用户后来 set 过的 kind 判成别的档），且「改善不可见」（磁盘仍 unknown）。它继续只做「非法值回落 `unknown`」，作为兜底。

**与 2.1 的交叉点（必须同批处理）**：2.1 落地后，`createEventForWorkPre` 会带 `sections` 但**仍不带 members/outcome** ⇒ 走完 ① ② ③ 后落 `unknown`。这是**正确行为**（一条日志确实不是账本），但要在套件里显式断言，防止有人「为了让 kind 好看」把判据改成「有 goal 就 ledger」。

### 2.2.3 与既有机制的关系

| 机制 | 影响 |
|---|---|
| pruneIfNeeded | 不涉及（event-store 无 prune） |
| flush 整体重写 | 不涉及（`writeStorePre` 原子写） |
| **注入面 budget** | **有影响但可忽略**：`projectEventForListPre` 的 `withKind` 开关（`:720`）只在 `/event-list` 路由开启 ⇒ **HTTP 响应体变化**（窄卡→宽卡），不走注入面预算；注入面（`renderT1Pre`/`T2Pre`）不读 kind |
| **auto 注入总量** | **零变化**。`injection-zones.js` 未见 kind 相关分区 |
| `smoke-test-v4-event-store` | **可能变红**：多处断言「恰好 26 字段」不变，但若有断言 kind 默认值 == `unknown` 会红 ⇒ 见 §2.2.5「变异必红」的 M2-e |
| `smoke-test-v4-h1b-memory-log` | **会变**：`memory_log` 建的事件若带 members 就会从 `unknown` 变 `ledger`。当前 `memory_log` 不传 members ⇒ **实测不变** |
| `smoke-test-v5-p6-*` 四套件 | 不受影响（不建事件） |
| `upgrade-apply.js:381` | 不受影响（迁移路径显式传 kind，走分支 ①） |
| **前端 `client.js`** | **禁改**。`ev4TicketOfPre` / `ev4KindLabelPre` 一行不动 —— 2.2 只让更多事件**落进**已有的 `ledger` 分支，不改分支本身 |

### 2.2.4 失败模式（4 条）

| # | 会怎么错 | 测试里怎么被发现 |
|---|---|---|
| F1 | 推断写成「有 goal 就 ledger」⇒ 2.1 落地后 100% 事件变 ledger，泳道里全是假账本 | 断言 `inferKindPre({sections:{goal:'x'}}) === 'unknown'`（goal 不是判据） |
| F2 | 覆盖了显式 kind（先推断再无条件赋值）⇒ 迁移/远端同步写入的 `planSnapshot` 被改判成 `ledger` | 断言 `inferKindPre({kind:'planSnapshot', members:['docs/a.md']}) === 'planSnapshot'` |
| F3 | 把「信号不足」当成失败去兜底猜 `mechanical` / `ledger` ⇒ unknown 从 23 掉到 0，但全是假标签 | 断言负路径 `inferKindPre({}) === 'unknown'` 且 `inferKindPre({members:[], outcome:'', startMs:0, endMs:0}) === 'unknown'` |
| F4 | `members` 判据用了 `includes('.md')` 而非结尾匹配 ⇒ 任意含 ".md" 的字符串（如 `notes.md.bak`）误判 ledger | 断言 `inferKindPre({members:['a.md.bak']}) === 'unknown'` —— 但注意：按上面的正则 `/\.md$/` 不会命中，**这条正是变异必红的靶子** |

### 2.2.5 验收用例设计

#### 真执行（真 import → 真构造 → 真调用 → 断言返回值）

```
// 新增 tests/smoke/smoke-test-batch2-2-kind-infer.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ES = await import(pathToFileURL(path.join(REPO, 'lib/event-store.js')).href)
const SANDBOX = path.join(REPO, '.tmp-smoke-run/b2-2')
fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })
const STORE = path.join(SANDBOX, 'event-store.json')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n + (d ? ' :: ' + d : '')) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// A. 纯函数三档（直接断言返回值，不看源码）
ok(ES.inferKindPre({ members: ['docs/internal/a.md'] }) === 'ledger', 'A-1 ★docs 路径 ⇒ ledger')
ok(ES.inferKindPre({ members: ['handoff/x.md'] }) === 'ledger', 'A-2 handoff 路径 ⇒ ledger')
ok(ES.inferKindPre({ outcome: '做完了', startMs: 1000, endMs: 2000 }) === 'project', 'A-3 ★outcome+起止 ⇒ project')
ok(ES.inferKindPre({}) === 'unknown', 'A-4 ★★负路径：信号不足 ⇒ unknown')
ok(ES.inferKindPre({ members: [], outcome: '', startMs: 0, endMs: 0 }) === 'unknown', 'A-5 负路径：全空 ⇒ unknown')

// B. 显式优先
ok(ES.inferKindPre({ kind: 'planSnapshot', members: ['docs/a.md'] }) === 'planSnapshot', 'B-1 ★显式 kind 不被推断覆盖')
ok(ES.inferKindPre({ kind: 'not-a-kind', members: ['docs/a.md'] }) === 'ledger', 'B-2 非法 kind ⇒ 视为未传，走推断')

// C. 边界
ok(ES.inferKindPre({ outcome: '有成果', startMs: 1000, endMs: 0 }) === 'unknown', 'C-1 ★只有 startMs ⇒ 不够 project（负路径）')
ok(ES.inferKindPre({ members: ['a.md.bak'] }) === 'unknown', 'C-2 ★★.md 必须结尾匹配（a.md.bak 不算）')
ok(ES.inferKindPre({ members: ['.md'] }) === 'ledger', 'C-3 极端串 ".md" 按当前正则算命中（记录口径，非缺陷）')

// D. 真建 3 类事件（走 eventStore.create 真写盘）
const e1 = await ES.eventStorePre.create(STORE, { name: '账本类事件', members: ['docs/internal/x.md'] })
const e2 = await ES.eventStorePre.create(STORE, { name: '项目类事件', outcome: '交付完成', startMs: 1000, endMs: 2000 })
const e3 = await ES.eventStorePre.create(STORE, { name: '不明形态事件' })
const disk = JSON.parse(fs.readFileSync(STORE, 'utf8'))
const k = (id) => disk.events.find((x) => x.id === id).kind
ok(k(e1.id) === 'ledger', 'D-1 ★真建 → ledger', k(e1.id))
ok(k(e2.id) === 'project', 'D-2 ★真建 → project', k(e2.id))
ok(k(e3.id) === 'unknown', 'D-3 ★★真建 → unknown（负路径）', k(e3.id))

// E. 26 字段契约未破
const bad = ES.validateEventPre(disk.events.find((x) => x.id === e1.id))
ok(bad.length === 0, 'E-1 推断后仍过 26 字段 fail-closed 校验', JSON.stringify(bad))
```

> ⚠️ **D-3 的口径**：`outcome` 在 `emptyEventPre` 里默认 `null`，而 `eventStorePre.create` 的 `opts` 透传链（`:812` 解构 5 项 + `applyV2FieldsPre` 10 项）**不含 outcome**（实测：传 `outcome:'成果乙'` 落盘仍 `null`）。⇒ D-2 目前**必须靠 `applyV2FieldsPre` 不支持的 `outcome` 路径**，实际会落 `unknown`。**这是本项的隐藏依赖**，见 §2.2.6 的「已知缺口」。

#### 负路径（旧实现通过、新实现必须拒绝）

**核心负路径**：`inferKindPre({})`。
- 旧实现（不存在该函数）⇒ 无返回值；把变异体改成「无条件返回 `'ledger'`」⇒ **A-4 必红**。
- 这条负路径守的是「**不许把信号不足硬塞成一个标签**」这个不变量。若只写 A-1/A-3，一个「永远返回 ledger」的实现也能全绿。

#### 变异必红

| 变异 | 改哪一行回旧形态 | 必须变红的断言 |
|---|---|---|
| M2-a | `inferKindPre` 的 `return 'unknown'` 改成 `return 'ledger'` | **A-4 / A-5 / C-1** 必红 |
| M2-b | 把 `if (s.kind !== undefined && EVENT_KINDS.includes(s.kind)) return s.kind` 整行删掉 | **B-1** 必红（planSnapshot 被改判 ledger） |
| M2-c | `/\.md$/i` 改成 `/\.md/i` | **C-2** 必红（a.md.bak 变 ledger） |
| M2-d | `create` 里的 `if (!(opts && opts.kind !== undefined))` 守卫删掉、改成无条件 `ev.kind = inferKindPre(opts)` | **B-1** 相关端到端断言必红（若 B-1 只测纯函数则不红 ⇒ 必须补一条端到端） |
| M2-e | `emptyEventPre` 的 `kind: 'unknown'` 改成 `'ledger'`（把默认值当推断用） | **A-4 仍绿**（纯函数不读默认值）、**D-3 必红** ⇒ 证明 D-3 是必需的端到端锚 |

### 2.2.6 风险与回滚

- **不碰真实用户数据**：验收全在 `.tmp-smoke-run/b2-2/` 沙箱。
- **存量 31 个 unknown 事件不会被自动改写**：本项只影响**新生**事件。存量要不要回填，属 2.4 的归并动作（会碰真实数据），**不得**在 2.2 里顺手做。
- **回滚**：(1) 删掉 `inferKindPre` 整个函数与 `create` 里那 1 行调用；(2) 已落盘的非 unknown kind **不需要回滚**（都是合法枚举值，`validateEventPre` 通过）；若要恢复成 unknown，用 `memory_event(action=set, kind:"unknown")` 逐条改（31 条以内，可脚本化）。
- **已知缺口（须单列，不在本项扩范围）**：`eventStorePre.create` 不透传 `outcome`（`:812` 解构里没有它，`applyV2FieldsPre` 也不含）⇒ 「outcome + 起止时间 ⇒ project」这条判据在**当前 create 通道上永远不成立**。要让 D-2 真绿，必须让 `create` 透传 `outcome`（+2 行）。**这属于对 `event-store.js` create 契约的扩张**，建议作为 2.2 的一部分一并做（改动仍在本项落点文件内），但需用户确认（见 §6 问题 1）。

### 2.2.7 工时与依赖

- 改动量：**生产代码 +32 行**（`inferKindPre` 约 28 行 + `create` 里 1 行 + 注释若干）；若采纳「透传 outcome」则 **+2 行**。**新增 1 个套件 / 约 15 条断言**。
- **依赖 1.4**（同 2.1）：新建频率不降下来，kind 推断只是在给碎片打更准确的标签，碎片数不减。
- 与 2.1 可并行（不同文件），但两者同批回归。

---
## 2.3 event-regroup 只读提案段接线（**零风险项**）

### 2.3.1 现状实测

落点（总表原写 `lib/index.js:8581`，**实测 8622 / 8639 / 8649**）。现行确定性聚类的完整上下文（`lib/index.js:8617-8651`，逐字）：

```
  /** ★v4 批次 D2：**审理草案**（只产草案，绝不写盘 —— 人在环确认后才由前端逐条调 memory_event）。
   *
   *  dryRun=true 时只返回将要发给子代理的 prompt 预览（前端「预览」按钮用），不启动子代理、不烧 token。
   *  ★D11：逐条确认 + 批量「全部接受 high」两种粒度并存 ⇒ 草案必须带 confidence。
   */
  async curateUnarchivedPre(opts = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || DEFAULT_CURATE_BATCH, 1), 200)
    ...
    const pCur = opts.paths || await this.resolvePaths(undefined)
    const list = await this.listUnarchivedPre({ cursor: 0, limit, paths: pCur })
    if (!list.unarchived) return { ok: false, error: 'no-unarchived', message: '本工作区没有未归档的四段账本。' }
    const batch = list.items.slice(0, limit)
    const cost = estimateCurationCostPre(batch)
    // 草案生成：确定性聚类（不烧 token）。语义聚类属后续模型项（用户已定「模型未调好先用现有占位」）。
    const scan = await scanUnarchivedLedgersPre({ dir: pCur.handoffDir, withText: true })
    const byName = new Map(scan.ledgers.map((l) => [l.name, l]))
    const batchLedgers = batch.map((b) => byName.get(b.name)).filter(Boolean)
    const groups = groupIntoCandidateEventsPre(batchLedgers)
    const drafts = groups.map((g) => ({
      candidateId: g.candidateId,
      name: (g.goalKey || '(未识别目标)').slice(0, 80),
      summary: '由 ' + g.memberCount + ' 篇账本聚类（确定性判据：目标段首行相同，或 6 小时内且目标段有 ≥2 个共同 2-gram）。',
      members: g.members.map((m) => 'handoff/' + m.name),
      rationale: '目标段首行/时间窗+2-gram 重合',
      confidence: g.memberCount >= 2 ? 'medium' : 'low',
      sections: { goal: g.goalKey, doing: '', deadend: '', next: '' },
    }))
    if (opts.dryRun === true) {
      return { ok: true, dryRun: true, batch: batch.length, cost, groups: groups.length, draftsPreview: drafts.slice(0, 5) }
    }
```

**实测病灶（本轮真跑，不是推断）**：对当前 668 篇未归档账本的前 40 篇（`DEFAULT_CURATE_BATCH = 40`）跑 `groupIntoCandidateEventsPre`，得到 **8 个候选组，成员数 3,4,6,2,6,3,13,3**，覆盖 40/40。逐组看 `goalKey`（前 6 个逐字）：

| 组 | 成员数 | goalKey（截断 70 字） |
|---|---|---|
| 1 | 3 | `…(已按预算截断全文见handoff/最新账本)…(已按预算截断全文见handoff/最新账本)…` |
| 2 | 4 | `-用户目标彻底解决记忆系统根部问题（84mb冲突库无界增长事件碎片化多形态无联动）…` |
| 3 | 6 | `typegoal-①存量 effort=medium 的老任务必须能续跑②done 但「未核实」…` |
| 4 | 2 | `typegoal-alpha7全批**贡献者pr纳入+本地修复正确+统一推送**…` |
| 5 | 6 | `typegoal-让「本事件来源·n篇原始账本」块在任意members/checkpoints长度组合下都不抛异常` |
| 6 | 3 | `typegoal-alpha6收口把#536揭穿的6个假绿套件处置完→摘pr#471测试…` |

**这正是 `event-regroup.js:8-13` 模块头逐字批判的形态**：

```
 * 旧版「把账本变成事件」用的是**纯确定性聚类**（目标段首行相同 / 6 小时内 2-gram 重合），
 * 实测产出垃圾：一篇账本 = 一个事件，事件名直接取「目标段首行」，
 * 而那行往往是 <!--type=goal--> 这种未清理的 HTML 注释。
 *
 * 用户裁定（逐字）：「可以先用这个机械的分类器来提供借鉴，但是**不能全量相信**，
 * 只能作为**加速器**。**具体事件的分类还是得 AI 来解决**。」
```

⇒ 现行 `drafts[].name` 直接取 `goalKey.slice(0, 80)`，落盘后会得到「`typegoal-①存量…`」这类事件名。而仓内已有一个**专门的事件名质量闸门** `validateEventNamePre`（`event-regroup.js:40-67`），现行代码**完全没调用它**。

### 2.3.2 改法（函数级 diff）

**总原则（与用户 2026-10-26 裁定严格相容）**：
- R1（`event-regroup.js`）**只作加速器**：产出 `suggestions`，每项带 `confidence` 与 `rationale`；
- R2（`event-regroup-scan.js`）只读扫描 + 构造 AI prompt；
- R3（`event-regroup-propose.js`）解析 AI 输出、fail-closed 校验、守恒检查；
- **最终分类权在 AI**：草案同时给出「机械建议」与「AI 输入材料」，机械建议明确标注「可全部推翻」。

#### 改动 1：新增只读提案方法 `proposeRegroupPre`（加在 engine 上，不加在工具上）

位置：`lib/index.js` 的 `curateUnarchivedPre` **之前**（实测 `:8617` 之前），约 **+48 行**：

```
  /** ★批次 2.3（2026-11-08）：**只读提案** —— 用语义/机械分组替换现行确定性聚类，**只产建议、绝不写盘**。
   *
   *  用户裁定（2026-10-26 逐字）：「可以先用这个机械的分类器来提供借鉴，但是**不能全量相信**，
   *  只能作为**加速器**。**具体事件的分类还是得 AI 来解决**。」
   *  ⇒ 本方法返回四块，缺一不可：
   *    ① suggestions —— R1 机械建议（带 confidence，AI 可全部推翻）
   *    ② prompt      —— R2 构造给 AI 的单批 prompt（**这才是分类的真正输入**）
   *    ③ badNames    —— 过不了 R1 命名闸门的候选名（证明闸门真的在跑）
   *    ④ cost        —— 可复算的 token 估算
   *
   *  ★★零写入硬约束（复算验证见 §2.3.5）：本方法只调 readTextSafe / listUnarchivedPre /
   *     eventStorePre.list，**不调** writeStorePre / writeTextAtomicPre / appendCheckpointPre /
   *     createEventForWorkPre / applyRegroupPre。套件用写入探针把这条钉死。
   */
  async proposeRegroupPre(opts = {}) {
    const limit = Math.min(Math.max(Number(opts.limit) || DEFAULT_CURATE_BATCH, 1), 200)
    const p = opts.paths || await this.resolvePaths(undefined)
    // ① 只读：未归档四段账本清单（与 listUnarchivedPre 完全同源，含"已归档"判定）
    const list = await this.listUnarchivedPre({ cursor: 0, limit, paths: p })
    if (!list.unarchived) return { ok: false, dryRun: true, error: 'no-unarchived', message: '本工作区没有未归档的四段账本。' }
    // ② 只读：带原文读取（R1 需要正文里的「## 目标」段，**不能喂 sections 的 join**）
    const scan = await scanUnarchivedLedgersPre({ dir: p.handoffDir, withText: false })
    const want = new Set(list.items.map((x) => x.name))
    const ledgers = []
    for (const l of scan.ledgers) {
      if (!want.has(l.name)) continue
      let text = ''
      try { text = String(await this.readTextSafe(path.join(p.handoffDir, l.name)) || '') } catch (_) { text = '' }
      ledgers.push({ name: l.name, mtime: l.mtime, bytes: l.bytes, text })
    }
    // ③ R1：机械建议（**加速器**，带 confidence，永不写盘）
    const { suggestGroupsPre, validateEventNamePre, suggestEventNamePre } = await import('./event-regroup.js')
    const grouped = suggestGroupsPre(ledgers)
    // ④ R1 命名闸门：现行草案直接取 goalKey.slice(0,80) ⇒ 会把 "typegoal-…" 写成事件名。
    //    这里**每个候选名都过闸门**，过不了的单列 badNames（不静默改名）。
    const badNames = []
    for (const g of grouped.suggestions) {
      const cand = String(g.suggestedName || '')
      if (!cand) { badNames.push({ group: g.members.slice(0, 3), name: '', code: 'no-suggested-name' }); continue }
      const v = validateEventNamePre(cand)
      if (!v.ok) badNames.push({ group: g.members.slice(0, 3), name: cand.slice(0, 60), code: v.code })
    }
    // ⑤ R2：构造给 AI 的 prompt（**分类权的真正落点**；只拼字符串，不发请求、不烧 token）
    const { buildRegroupPromptPre, buildExcerptPre } = await import('./event-regroup-scan.js')
    const excerpts = ledgers.map((l) => ({
      name: l.name, mtime: l.mtime, bytes: l.bytes,
      excerpt: buildExcerptPre({ goal: goalOfLedgerText(l.text), outcome: '' }, l.text),
      suggestName: suggestEventNamePre({ name: l.name, text: l.text }),
    }))
    let existing = []
    try {
      const all = await eventStorePre.list(path.join(p.handoffDir, V4_EVENT_STORE_FILENAME), { all: true })
      existing = (all && Array.isArray(all.events)) ? all.events : []
    } catch (_) { existing = [] }
    const prompt = buildRegroupPromptPre({
      ledgers: excerpts,
      existingEvents: existing.map((e) => ({ id: e.id, name: e.name, status: e.status })),
      suggestions: grouped.suggestions,
      batchIndex: 0, batchTotal: 1,
    })
    return {
      ok: true, dryRun: true, wrote: false,
      batch: ledgers.length,
      suggestions: grouped.suggestions,
      ungrouped: grouped.ungrouped,
      badNames,
      prompt,
      cost: estimateCurationCostPre(ledgers),
    }
  }
```

> 用到的 `goalOfLedgerText` 是**模块级小函数**（+8 行，放在 `lib/index.js` 的 `groupIntoCandidateEventsPre` 导入之后），从账本正文抽「## 目标」段首行：

```
/** ★批次 2.3：从账本正文抽「目标」段首行（供 R2 的 excerpt 使用）。纯函数，零 IO。 */
function goalOfLedgerText(text) {
  const m = String(text || '').match(/^##\s*目标\s*\r?\n+([^\r\n]+)/m)
  if (!m) return ''
  return String(m[1]).replace(/<!--[\s\S]*?-->/g, '').replace(/^[#>*+\-\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 300)
}
```

#### 改动 2：接线到 HTTP 路由（**只读，无令牌**）

在 `lib/index.js:27876` 的 `event-curate` 路由里、`candidateIds` 判断**之前**插入分支（**+10 行**）：

```
          const body = await readJsonBody(req).catch(() => ({}))
          // ★批次 2.3（2026-11-08）：**只读提案**分支。op='propose' ⇒ 走 proposeRegroupPre，
          //   零写盘、零令牌。与下面 candidateIds 写盘分支互斥，且**先判**（只读不需要任何令牌）。
          if (String((body && body.op) || '') === 'propose') {
            const _rpP = await engine.resolvePathsForRequestPre(String(body.sessionId || '').trim())
            if (_rpP.pa.wsBound === false) return writeJson(res, 400, { error: 'workspace unavailable for this session', sessionId: _rpP.sid })
            const rp = await engine.proposeRegroupPre({ limit: body.limit, paths: _rpP.pa })
            return writeJson(res, rp && rp.ok ? 200 : 400, rp)
          }
          const candidateIds = Array.isArray(body && body.candidateIds) ? body.candidateIds : null
```

**为什么复用 `/event-curate` 而不新增路由**：本仓有「新增路由 → 必须同批重钉 r26 的 E3/E4 与 10 处文档计数」的硬约束（路由数 70→71 的教训）。**复用已有路由 + 一个 `op` 字段 = 路由数不变**，零计数锁改动。

#### 改动 3：dryRun 结果怎么呈现给用户

**分两层，本批只做第一层**：

1. **本批（后端可验收）**：HTTP 直接返回结构化 JSON（下方形态）+ 一段**人可读文本回执**（`summaryText` 字段，约 8 行），用户可 curl 或由面板后续消费。
2. **后续独立项（前端）**：在既有「审理」弹层里加一块只读预览区。**本批不动 `client.js`**（属「禁止社区 merge 式重构」+「改前必须跑真执行 factory 守卫」的高风险面）。见 §5「建议扩范围」。

返回形态（逐字段）：

```
{
  "ok": true, "dryRun": true, "wrote": false,
  "batch": 40,
  "suggestions": [ { "members": ["a.md","b.md"], "suggestedName": "", "confidence": "medium",
                     "rationale": "目标段首行完全相同（确定性判据，AI 可推翻）", "method": "A:goal-first-line" } ],
  "badNames": [ { "group": ["c.md"], "name": "typegoal-①存量…", "code": "markdown-prefix" } ],
  "prompt": "你是记忆整理助手。任务：把一批「工作交接账本」重新归类成**事件**……",
  "cost": { "count": 40, "avgChars": 1153, "estimatedInputTokens": 27130, "estimatedOutputTokens": 3000 }
}
```

**呈现的关键口径（写进回执文案，防误读）**：
- `suggestions` 前必须显式标注「**机械建议，AI 可全部推翻**」；
- `badNames` 必须如实列出「这些组的候选名过不了命名闸门，**必须由 AI 命名**」；
- `prompt` 必须注明「**这才是分类的输入**，直接交给子代理即可」。

### 2.3.3 与既有机制的关系

| 机制 | 影响 |
|---|---|
| pruneIfNeeded | 不涉及 |
| flush 整体重写 | **不涉及，且这正是零风险来源**：本方法调用的全部入口是 `readStorePre` / `readTextSafe` / `readdir`；**不碰 `mutatePre`** ⇒ 不存在 tmp→rename 写 |
| **注入面 budget** | **零影响**。不产出任何 `pushPart` 数据；`prompt` 只回给 HTTP 调用方，不进注入面 |
| `curateUnarchivedPre`（现行审理） | **不改**，老路径原样保留（向后兼容）；「用新方法替换老方法」是**另一项改动**，不在本项 |
| `writeCuratedEventsPre`（会写盘） | **不调用**（它是 2.4 的落盘端） |
| `event-regroup-apply.js` | **本项不 import** —— 确保 2.3 与 2.4 物理隔离 |
| `smoke-test-v5-p6-*` 四套件 | 不受影响（本项不改那四个模块）。基线 **48 / 44 / 43 / 40 全绿** |
| 路由计数 | **不变**（复用 `event-curate`，只加 `op` 分支） |
| 文档计数 | **不变**（工具数仍 14 个 `memory_*`；路由数不变） |
| `client.js` | **本批不改** |

### 2.3.4 失败模式（4 条）

| # | 会怎么错 | 测试里怎么被发现 |
|---|---|---|
| F1 | **后人往 R1/R2 里加了写盘调用**（比如「顺手把提案落个缓存」）⇒ 零风险承诺失效且无人发现 | 套件装**写入探针**：把 `append/create/set` 包成计数桩，真调提案后断言计数 == 0（见 §2.3.5 N-1b） |
| F2 | `resolvePaths` 写错（沿用 `resolvePaths(undefined)`）⇒ 读到**别的工作区**的账本（本仓已犯过 6 次的同族缺陷） | 给两个不同 sessionId 调，断言返回的 `batch` 与首条成员名不同；解析不出的 sessionId ⇒ 400 |
| F3 | excerpt 用了 `sections` 的 join 而非原文 ⇒ `goalOfLedgerText('')` 恒空 ⇒ prompt 里全是空摘要，AI 无从分类 | **本轮实测已踩中**：用 sections join 时 `suggestGroupsPre` 返回 **0 组**；改原文后返回 **15 组**。⇒ 断言 P-3：suggestions ≥ 1 |
| F4 | `badNames` 恒空（因为没真调闸门）⇒ 看起来「名字全合格」，实际现行草案仍在用 `goalKey.slice(0,80)` | 构造目标段首行以 `typegoal-` 开头的账本，断言 `badNames.length > 0` 且 `code === 'markdown-prefix'` |

### 2.3.5 验收用例设计

#### 真执行（真 import → 真构造 → 真调用 → 断言返回值）

夹具（3 篇同目标账本 + 1 篇垃圾名账本）：

```
// tests/smoke/smoke-test-batch2-3-regroup-propose.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SANDBOX = path.join(REPO, '.tmp-smoke-run/b2-3')
fs.rmSync(SANDBOX, { recursive: true, force: true })
const HANDOFF = path.join(SANDBOX, 'handoff')
fs.mkdirSync(HANDOFF, { recursive: true })
const NL = String.fromCharCode(10)
const LEDGER = (goal) => ['# 交接账本', '', '## 任务状态', '- 进行中', '', '## 目标', goal, '',
  '## 已试方案与失败原因', '- 无', '', '## 进度与下一步', '- 下一步', ''].join(NL)
fs.writeFileSync(path.join(HANDOFF, 'handoff-a.md'), LEDGER('修复注入面预算超支'), 'utf8')
fs.writeFileSync(path.join(HANDOFF, 'handoff-b.md'), LEDGER('修复注入面预算超支'), 'utf8')
fs.writeFileSync(path.join(HANDOFF, 'handoff-c.md'), LEDGER('typegoal-未清理的注释型目标'), 'utf8')
fs.writeFileSync(path.join(HANDOFF, 'event-store.json'),
  JSON.stringify({ schema: 'v4_event_store_v2', events: [], updatedAt: 1 }, null, 2), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n + (d ? ' :: ' + d : '')) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// 真 import 依赖（与产线同一份）
const EP = await import(pathToFileURL(path.join(REPO, 'lib/event-plan.js')).href)
const ES = await import(pathToFileURL(path.join(REPO, 'lib/event-store.js')).href)
const eventStorePre = ES.eventStorePre
const PATHS = { handoffDir: HANDOFF, projectDir: SANDBOX, planPath: path.join(HANDOFF, 'PLAN.md'), ws: SANDBOX, wsBound: true }

// 真 engine（只实现被本方法用到的入口；listUnarchivedPre 用真扫描结果，**不造数据**）
const engine = {
  config: { dayBoundaryMinutes: 450 },
  async resolvePaths() { return PATHS },
  async readTextSafe(p) { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  async listUnarchivedPre(o) {
    const sc = await EP.scanUnarchivedLedgersPre({ dir: HANDOFF, withText: false })
    return { ok: true, total: sc.total, archived: 0, unarchived: sc.total, scanned: sc.examined,
      items: sc.ledgers.slice(0, o.limit || 40).map((l) => ({ rel: 'handoff/' + l.name, name: l.name, mtime: l.mtime, bytes: l.bytes })) }
  },
}

// ★从 index.js 抽取方法体后 new Function 求值（与 h1b 同一手法，**真跑产线同一份代码**）
const IDX = fs.readFileSync(path.join(REPO, 'lib/index.js'), 'utf8').split(String.fromCharCode(13, 10)).join(NL)
const START = IDX.indexOf('async proposeRegroupPre(opts = {}) {')
ok(START > 0, 'A-0 ★接线已落地（找到方法定义）', 'idx=' + START)
// 括号配平扫描取出方法体
let i = IDX.indexOf('(', START), depth = 0, end = -1
for (; i < IDX.length; i++) { const ch = IDX[i]; if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) { end = i + 1; break } } }
const methodSrc = 'async ' + IDX.slice(START, end) + ' }'
const factory = new Function('engine', 'path', 'eventStorePre', 'V4_EVENT_STORE_FILENAME',
  'scanUnarchivedLedgersPre', 'estimateCurationCostPre', 'DEFAULT_CURATE_BATCH', 'goalOfLedgerText',
  'return ({ ' + methodSrc + ' })')
const goalOfLedgerText = (text) => {
  const m = String(text || '').match(/^##\s*目标\s*\r?\n+([^\r\n]+)/m)
  if (!m) return ''
  return String(m[1]).replace(/<!--[\s\S]*?-->/g, '').replace(/^[#>*+\-\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, 300)
}
const api = factory(engine, path, eventStorePre, 'event-store.json',
  EP.scanUnarchivedLedgersPre, EP.estimateCurationCostPre, EP.DEFAULT_CURATE_BATCH, goalOfLedgerText)

// ── P 组：正路径 ──
const r = await api.proposeRegroupPre.call(Object.assign(Object.create(null), engine, api), { paths: PATHS, limit: 40 })
```

> **抽取式求值的现实约束**：方法体引用 7 个外部符号 ⇒ 必须用 `new Function` 显式注入（与 `smoke-test-v4-h1b-memory-log.mjs:104-115` 同一手法）。**不要改成 `await import(...)` 来规避**：本仓已实证沙箱里动态 import 的相对路径按模块所在目录解析会 `ERR_MODULE_NOT_FOUND`（`lib/index.js:8718-8722` 注释逐字记录过这次教训）。

断言清单（正路径，全部断言返回值/副作用）：

```
ok(r.ok === true && r.dryRun === true && r.wrote === false, 'P-1 返回 dryRun/wrote 标记')
ok(Array.isArray(r.suggestions), 'P-2 suggestions 是数组')
ok(r.suggestions.length >= 1, 'P-3 ★★至少 1 组（a/b 同目标必聚）', 'groups=' + r.suggestions.length)
ok(r.suggestions.every((g) => typeof g.confidence === 'string' && g.confidence.length > 0),
  'P-4 ★★★每个建议都带 confidence（总表判据）', r.suggestions.map((g) => g.confidence).join(','))
ok(r.suggestions.every((g) => typeof g.rationale === 'string' && g.rationale.length > 0), 'P-5 每项带 rationale')
ok(r.badNames.length >= 1, 'P-6 ★命名闸门真的跑了（typegoal- 必被拒）', JSON.stringify(r.badNames[0] || {}))
ok(r.badNames.some((b) => b.code === 'markdown-prefix'), 'P-7 拒绝原因是 markdown-prefix')
ok(typeof r.prompt === 'string' && r.prompt.indexOf('事件边界判据') >= 0, 'P-8 ★prompt 含 AI 判定边界判据')
ok(r.prompt.indexOf('你可以全部推翻') >= 0, 'P-9 ★★prompt 明确写「机械建议可全部推翻」（与用户裁定相容）')
ok(typeof r.cost === 'object' && Number(r.cost.count) === 3, 'P-10 cost 可复算', JSON.stringify(r.cost))
```

#### 负路径（旧实现通过、新实现必须拒绝）

**N-1 零写入探针（本项最重要的一条）**：

```
let writeCalls = 0
const wrapped = Object.create(eventStorePre)
wrapped.append = async () => { writeCalls++; throw new Error('PROPOSE-MUST-NOT-WRITE: append') }
wrapped.create = async () => { writeCalls++; throw new Error('PROPOSE-MUST-NOT-WRITE: create') }
wrapped.set    = async () => { writeCalls++; throw new Error('PROPOSE-MUST-NOT-WRITE: set') }
wrapped.close  = async () => { writeCalls++; throw new Error('PROPOSE-MUST-NOT-WRITE: close') }

const before = fs.statSync(path.join(HANDOFF, 'event-store.json')).size
const r2 = await api.proposeRegroupPre.call(Object.assign(Object.create(null), engine, api), { paths: PATHS, limit: 40 })
const after = fs.statSync(path.join(HANDOFF, 'event-store.json')).size

ok(r2.ok === true, 'N-1a 提案仍成功（探针没被踩到）')
ok(writeCalls === 0, 'N-1b ★★写入探针：append/create/set/close 各被调 0 次', 'calls=' + writeCalls)
ok(before === after, 'N-1c ★★★event-store 字节数前后不变', before + ' -> ' + after)
```

**N-2 有区分力的负路径**：把 `proposeRegroupPre` 里任一处改成调用 `eventStorePre.set`（例如「顺手更新一下 updatedAt」），**N-1b 与 N-1c 必红**。写进套件注释：`before === after` 单看有可能恒真（两个 int 相等），**必须配 N-1b 的探针才构成完整证明**。

**N-3 命名闸门负路径**：把 `validateEventNamePre(cand)` 换成恒 `{ok:true}` ⇒ **P-6 / P-7 必红**。

#### 可复算的「前后 event-store 字节数不变」校验（**对真实数据**）

```
$P = "C:\Users\JH Z\.dsh\memory\workspaces\--D--dsh-auto-memory--\handoff\event-store.json"
$b0 = (Get-Item $P).Length
$h0 = (Get-FileHash $P -Algorithm SHA256).Hash
$m0 = (Get-Item $P).LastWriteTimeUtc.Ticks
Start-Sleep -Milliseconds 200
curl.exe -s -X POST "http://127.0.0.1:19387/api/dsh-auto-memory/event-curate" -H "Content-Type: application/json" -d "{\"op\":\"propose\",\"limit\":40}" -o artifacts\_detail-batch2\propose-out.json
$b1 = (Get-Item $P).Length
$h1 = (Get-FileHash $P -Algorithm SHA256).Hash
$m1 = (Get-Item $P).LastWriteTimeUtc.Ticks
Write-Output ("bytes  " + $b0 + " -> " + $b1 + "  equal=" + ($b0 -eq $b1))
Write-Output ("sha256 equal=" + ($h0 -eq $h1))
Write-Output ("mtime  equal=" + ($m0 -eq $m1))
```

**判据（三条必须同时成立）**：`bytes equal=True` **且** `sha256 equal=True` **且** `mtime equal=True`。

> ★ 为什么必须**同时看 mtime**：事件库每轮都可能被 `memory_log` 写；只看字节可能「长度相同但内容变了」（`updatedAt` 是等长数字），sha256 抓内容，mtime 抓「被重写但内容回滚成一样」。三者同看才闭合。
> ★ 若同时在跑别的工作（另一个 agent 在写 `memory_log`），本判据**必然红** ⇒ 必须在**静默窗口**里跑：先确认 `event-store.json` 的 mtime 在最近 60 秒内没动过，再开始三步。

### 2.3.6 风险与回滚

- **不碰真实用户数据**（只读）。真实数据校验见上，bytes + sha256 + mtime 三重。
- 唯一真实风险是 F1（后人加写盘）与 F2（解析错工作区），两者都已配必红断言。
- **回滚**：(1) 删 `proposeRegroupPre` 整个方法（−48 行）；(2) 删路由 `op:'propose'` 分支（−10 行）；(3) 删 `goalOfLedgerText`（−8 行）。**无数据回滚**（本项从未写盘）。

### 2.3.7 工时与依赖

- 改动量：**生产代码 +66 行 / −0 行**（方法 48 + 路由 10 + 纯函数 8）；**新增 1 套件 / 约 18 条断言**。
- **依赖：无** —— 本批唯一零依赖项，**建议第一个做**。
- 与 2.4 的关系：2.4 消费本项的 `suggestions` 与 `prompt`，但 2.4 的落盘端**不得 import 本项方法**，必须走独立 `applyRegroupPre` 通道（物理隔离，见 §2.4）。

---
## 2.4 存量碎片归并（**会碰真实数据 · 本批最危险项**）

### 2.4.1 现状实测（**先说结论：现行 apply 模块不能用，必须先修三处**）

落点（总表原写 `lib/index.js:8647`，**实测 8688** = `async writeCuratedEventsPre(opts = {})`）。

真正的落盘端在 `lib/event-regroup-apply.js:144-233`（`applyRegroupPre`），核心 40 行逐字：

```
  // ⑤ 构造新 store（旧 active ⇒ archived；新增 AI 重整事件）
  const next = {
    ...store,
    events: Array.isArray(store.events) ? store.events.slice() : [],
  }
  const archivedIds = []
  for (const ev of next.events) {
    if (ev && String(ev.status) === 'active') {
      ev.status = 'archived'
      ev.archivedAt = Number(o.now) || Date.now()
      ev.archivedBy = 'regroup'
      archivedIds.push(String(ev.id || ''))
    }
  }
  const used = new Set(next.events.map((e) => String((e && e.id) || '')))
  const created = []
  const groups = Array.isArray(proposal.proposedGroups) ? proposal.proposedGroups : []
  for (const g of groups) {
    const ev = emptyEventPre(String(g.name || ''), { id: newEventIdPre(used), summary: String(g.summary || '') })
    used.add(ev.id)
    const sec = (g.sections && typeof g.sections === 'object') ? g.sections : {}
    for (const k of ['goal', 'doing', 'deadend', 'next']) {
      if (typeof sec[k] === 'string') ev.sections[k] = sec[k]
    }
    // ★把成员账本记进事件（sourceRef 列表），供回溯
    ev.memberLedgers = Array.isArray(g.members) ? g.members.map(String) : []
    ev.origin = 'regroup-ai'
    ev.createdBy = 'regroup'
    next.events.push(ev)
    created.push({ id: ev.id, name: ev.name })
  }
```

**本轮真跑，在沙箱 store 上实测三个致命缺陷（不是推断，是可复现读数）**：

| # | 缺陷 | 实测证据 |
|---|---|---|
| **D-1** | 新事件被塞了 **3 个不在 26 字段契约里的顶层键**（`memberLedgers` / `origin` / `createdBy`） | `validateEventPre(newEvent)` → `["unknown:memberLedgers","unknown:origin","unknown:createdBy"]` |
| **D-2** | 旧事件被改成 `status:'archived'` —— **该值不在枚举里**（`EVENT_STATUSES = ['active','paused','closed']`），另加 2 个未知键 | `validateEventPre` → `["unknown:archivedAt","unknown:archivedBy","bad-status"]` |
| **D-3** | **新事件检查点恒为 0**，旧事件的检查点**不会迁移**过去 | 实测 `newEv.checkpoints.length === 0`；全局检查点数 4 → 4（旧事件留着，只是被标 archived） |

**D-1/D-2 的后果链（这是最危险的部分，必须看懂再动手）**：

`event-store.js:552-612` 的 `mutateUnlockedPre` 对**全库**跑 `validateEventPre`：
- 本次事务**碰过**的坏事件 ⇒ `touchedBad` ⇒ **抛错**；
- 本次事务**没碰**的坏事件 ⇒ `quarantined` ⇒ 不阻断，但**写进返回值**并在文案里声称「不参与读取」。

实测后果（沙箱 3 事件 store 上跑完 apply 后，逐字）：

```
APPEND to new event   => THROW 事件写入前校验失败：本次入参 evt_80144147 非法：unknown:memberLedgers,unknown:origin,unknown:createdBy
APPEND to archived ev => THROW 事件写入前校验失败：本次入参 evt_00000001 非法：unknown:archivedAt,unknown:archivedBy,bad-status
```

⇒ **归并之后，46 个 active 事件全部变成不可再写的 archived，新建的归并事件也不可再写**。下一次 `memory_log` 只会得到两条路：新建一个孤立事件，或撞上 `quarantineNotice` 里列出的 46 条 id。

⇒ **2.4 绝不能在修这三处之前跑真实数据。**

### 2.4.2 「27 个碎片」的口径订正与归并对象

| 口径 | 实测值 |
|---|---|
| `kind === 'unknown'` 总数 | **31** |
| 其中 `status === 'active'` | **29** |
| 其中 active 且 检查点 ≤ 2 | **23** |
| 其中 active 且 检查点 ≤ 1 | 14 |
| 其中 active 且 检查点 ≤ 3 | 27 |

**总表写「27 个碎片」的来源找到了**：正好是 `unknown & active & 检查点 ≤ 3` = 27。但按「碎片 = 一轮一条日志」的定义（审计 A-4 的「1 条检查点」特征），主口径应为 **23**（≤2）或 **14**（≤1）。

**本细则取 23 为主口径**（≤2 覆盖「一轮日志 + 一次跟进」），并在验收里同时报 14 / 23 / 27 三个数，让用户自己裁量。

### 2.4.3 改法（**必须与 2.3 物理隔离；先修 apply 再谈归并**）

#### 2.4.3.1 第一步：修 `event-regroup-apply.js` 的三处越界写（+34 / −6 行）

**修 D-1（新事件不再越界写字段）**：

```
    // ★批次 2.4（2026-11-08）：**禁止往事件上写 26 字段之外的键**。
    //   EVENT_TOP_FIELDS 是 fail-closed 契约，多一个键 ⇒ validateEventPre 判 unknown ⇒
    //   整个事件被隔离（不可写、不可被 memory_event 更新）。旧实现写的
    //   memberLedgers / origin / createdBy 全部属越界，改为走**合法字段**：
    //     · members（字符串数组，≤500）   ← 成员账本路径
    //     · rationale（≤600 字符串）      ← 归组来源
    ev.members = Array.isArray(g.members) ? g.members.map(String).slice(0, 500) : []
    ev.rationale = 'regroup-ai: ' + String(g.members ? g.members.length : 0) + ' 篇账本归并'
```

**修 D-2（旧事件不改成非法状态）**：

```
  for (const ev of next.events) {
    if (ev && String(ev.status) === 'active') {
      // ★批次 2.4：**不得写 status:'archived'** —— 'archived' 不在 EVENT_STATUSES 里，
      //   写进去 validateEventPre 判 bad-status ⇒ 事件被隔离 ⇒ 全库可写性塌掉（实测）。
      //   「归档」用合法状态表达：closed + outcome（close 的既有语义就是「这件事结束」）。
      ev.status = 'closed'
      if (!(typeof ev.outcome === 'string' && ev.outcome.trim())) {
        ev.outcome = '已被事件重整归并（regroup）'
      }
      ev.updatedAt = Number(o.now) || Date.now()
      archivedIds.push(String(ev.id || ''))
    }
  }
```

> 注意：`archivedAt` / `archivedBy` 两个自造键**一并删除**。若确需留时间戳，写进 `rationale`（≤600 字）。

**修 D-3（检查点必须迁移到新事件）**：

```
    // ★批次 2.4：**把成员事件的全部检查点迁到新事件**（否则归并 = 内容蒸发）。
    //   顺序：收集 → 查重 idemKey（同事件内不得重复，validateEventPre:229 硬拒）→ 按 at 稳定排序。
    const seenKey = new Set()
    const carried = []
    for (const se of next.events) {
      if (!se || archivedIds.indexOf(String(se.id)) < 0) continue
      for (const c of (Array.isArray(se.checkpoints) ? se.checkpoints : [])) {
        if (!c) continue
        const k = String(c.idemKey || '')
        if (k && seenKey.has(k)) continue
        if (k) seenKey.add(k)
        carried.push(JSON.parse(JSON.stringify(c)))
      }
    }
    carried.sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    ev.checkpoints = carried
```

> ★ 排序后**不再重新分配 idemKey**：idemKey 的原样保留是守恒判据（多维比对）能成立的前提。若两个源事件有同一 idemKey，第二条被**丢弃** —— 这会导致总量守恒失败（总数少 1），从而被 §2.4.4 的守恒判据**如实抓到并中止**，这正是要的行为（宁中止，不静默丢）。

#### 2.4.3.2 第二步：归并动作本身（走 `applyRegroupPre`，**不新增通道**）

**为什么不走 `writeCuratedEventsPre`**：它建的事件**不带检查点**（`index.js:8769-8774` 只 append 一条「（存量账本归档）」摘要），且它会为每篇账本建**一条**检查点 —— 与「归并 = 检查点守恒」的判据方向相反。2.4 的语义是**搬**，不是**记**。

**调用序列（严格按此顺序，一步都不能换）**：

```
// 步骤 0：静默窗口确认（必须）
//   读 event-store.json 的 mtime，若距今 < 60s ⇒ 停手（有别的写者在跑）

// 步骤 1：拍快照 + 立即校验快照完整性
const snap = await snapshotStorePre({ storePath, backupDir, maxBackups: 20 })
//   校验：sha256(快照文件) === sha256(storePath) —— 不等就中止（快照不可信）

// 步骤 2：归并前守恒基线（3 维，见 §2.4.4）
const before = await takeConservationBaselinePre(storePath)

// 步骤 3：dry-run 预览（不传 apply）
const pre = await applyRegroupPre({ proposal, storePath, backupDir, token })
//   断言 pre.ok === true && pre.dryRun === true

// 步骤 4：真写（apply: true）
const done = await applyRegroupPre({ proposal, storePath, backupDir, token, apply: true })
//   断言 done.ok === true && done.dryRun === false && done.snapshot.file 存在

// 步骤 5：归并后守恒校验（3 维严格相等）
const after = await takeConservationBaselinePre(storePath)
if (!conservedPre(before, after).ok) { await atomicRollbackPre({ storePath, backupFile: done.snapshot.file }); throw }

// 步骤 6：契约校验 —— 每个事件都必须过 validateEventPre（D-1/D-2 的永久护栏）
for (const e of after.events) { const bad = validateEventPre(e); if (bad.length) { await atomicRollbackPre({ storePath, backupFile: done.snapshot.file }); throw } }
```

### 2.4.4 「检查点总数守恒」的具体算法（**用户硬要求，逐字给出**）

#### 数什么（三维，缺一维就是自欺）

| 维度 | 口径 | 为什么必须 |
|---|---|---|
| **① 总数** | `Σ events[].checkpoints.length` | 底线：不能凭空多、不能凭空少 |
| **② idemKey 多重集** | 全部检查点 idemKey（缺失记 `''`）的**排序后数组逐项相等** | 只比总数会漏「A 少一条 B 多一条」；idemKey 是仓内既有的幂等身份，天然可作指纹 |
| **③ 逐条内容指纹** | 每条检查点的 `sha256(kind + 分隔符 + at + 分隔符 + text)` 的**排序后数组**逐项相等 | 实测 706 条里 **60 条没有 idemKey** ⇒ 缺失键的条目只能靠内容指纹区分 |

**不数什么（避免自欺）**：
- 不数事件数（归并**就是**要让它下降）；
- 不数文件字节数（JSON 缩进/字段顺序会变，字节不可比）；
- 不数 `updatedAt`（归并必然刷新它）。

#### 怎么数（可直接落地的实现，加进 `event-regroup-apply.js`，+26 行）

```
import { createHash } from 'node:crypto'   // 该文件已有此 import（:14），无需新增

/**
 * ★批次 2.4：归并前后的**检查点守恒基线**（三维）。
 * @param {string} storePath
 * @returns {Promise<{total:number, idemKeys:string[], fp:string[]}>}
 */
export async function takeConservationBaselinePre(storePath) {
  const store = await readStorePre(storePath)
  const all = []
  for (const e of (Array.isArray(store.events) ? store.events : [])) {
    for (const c of (Array.isArray(e && e.checkpoints) ? e.checkpoints : [])) {
      if (c) all.push(c)
    }
  }
  const idemKeys = all.map((c) => String(c.idemKey == null ? '' : c.idemKey)).sort()
  const fp = all.map((c) => createHash('sha256')
    .update(String(c.kind == null ? '' : c.kind) + '\u0000' + String(Number(c.at) || 0) + '\u0000' + String(c.text == null ? '' : c.text))
    .digest('hex').slice(0, 16)).sort()
  return { total: all.length, idemKeys, fp }
}

/**
 * ★三维守恒判定：**任一维不等即失败**（不降级、不近似）。
 * @returns {{ok:boolean, dim?:string, before?:any, after?:any}}
 */
export function conservedPre(before, after) {
  const a = before || {}, b = after || {}
  const eq = (x, y) => Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i])
  if (Number(a.total) !== Number(b.total)) return { ok: false, dim: 'total', before: a.total, after: b.total }
  if (!eq(a.idemKeys, b.idemKeys)) return { ok: false, dim: 'idemKeys', before: a.idemKeys.length, after: b.idemKeys.length }
  if (!eq(a.fp, b.fp)) return { ok: false, dim: 'fingerprint', before: a.fp.length, after: b.fp.length }
  return { ok: true }
}
```

#### 守恒失败怎么中止（**原子回滚的完整步骤，不许写「回滚即可」**）

```
/**
 * ★批次 2.4：**原子回滚** —— 从快照恢复，且恢复本身必须可验证。
 *
 * 为什么不能只 copyFile：copyFile 是**非原子**的（写一半断电 ⇒ store 半截）。
 * 做法：copy 到同目录 tmp → **校验 tmp 的 sha256 == 快照 sha256** → rename 覆盖（同分区原子）→ 回读再验。
 */
export async function atomicRollbackPre(p = {}) {
  const storePath = String(p.storePath || '')
  const backupFile = String(p.backupFile || '')
  if (!storePath || !backupFile) return { ok: false, step: 'args', error: '缺 storePath 或 backupFile' }
  const dir = path.dirname(storePath)
  const tmp = path.join(dir, '.event-store.rollback.' + process.pid + '.' + randomBytes(4).toString('hex') + '.tmp')
  try {
    await copyFile(backupFile, tmp)                                             // ① 复制到 tmp
    const hSnap = createHash('sha256').update(await readFile(backupFile)).digest('hex')
    const hTmp  = createHash('sha256').update(await readFile(tmp)).digest('hex')
    if (hSnap !== hTmp) { try { await unlink(tmp) } catch (_) {} return { ok: false, step: 'verify-tmp', error: 'tmp 与快照不一致' } }   // ② 校验
    await rename(tmp, storePath)                                                // ③ 原子替换
    const hNow = createHash('sha256').update(await readFile(storePath)).digest('hex')
    if (hNow !== hSnap) return { ok: false, step: 'verify-final', error: '回滚后内容与快照不一致', restoredSha16: hNow.slice(0, 16).toUpperCase() }   // ④ 回读复验
    return { ok: true, restoredSha16: hNow.slice(0, 16).toUpperCase() }
  } catch (e) {
    try { await unlink(tmp) } catch (_) {}
    return { ok: false, step: 'io', error: String((e && e.message) || e).slice(0, 200) }
  }
}
```

**回滚的完整执行序列（守恒失败时按此逐条走，不许跳步）**：

| 步 | 动作 | 失败即意味着 |
|---|---|---|
| 1 | 记下 `done.snapshot.file`（第 4 步 apply 已产出） | 快照路径丢失 ⇒ **人工介入**（在 `handoff/.event-store-backups/` 里按时间戳找） |
| 2 | 调 `atomicRollbackPre({storePath, backupFile})` | 见步 3–5 的分步错误 |
| 3 | 断言返回 `ok===true` 且 `restoredSha16` 非空 | `step:'verify-tmp'` ⇒ 快照本身损坏 ⇒ 换更早一份快照重试；`step:'verify-final'` ⇒ rename 后内容不对 ⇒ 立即停手并人工介入 |
| 4 | 复测 `takeConservationBaselinePre`，断言三维 **等于 before**（不只是「前后相等」，是「回到基线」） | 不等于 ⇒ 回滚未真正还原 ⇒ 停手 |
| 5 | 断言 `event-store.json` 的 sha256 == **拍快照前记录的原始 sha256** | 这是最终判据：字节级回到原点 |
| 6 | 只在 3/4/5 全绿后才向用户报「已回滚」 | 任一步不绿 ⇒ 报「回滚失败 + `step` + 盘上实际 sha16」，**不得谎报已恢复** |

> ★ 步骤 5 的 sha256 **必须在拍快照之前**对 `storePath` 本身算（不是对快照算）。本细则 §0.3 给出的 `D6A061D67B7E4BEE…` 就是这条基线。

### 2.4.5 与既有机制的关系

| 机制 | 影响 |
|---|---|
| pruneIfNeeded | 不涉及 |
| **flush 整体重写** | **本项就是一次整体重写**：`readStorePre` → 改 → `writeStorePre`（tmp→rename）。**必须在静默窗口跑**（无并发 `memory_log` / `memory_note`） |
| 注入面 budget | **间接**：归并后 active 从 46 → 约 46−23+组数；`renderEventCatalogPre` 的 400 字目录条目会重算。**不改任何预算常量** |
| `smoke-test-v5-p6-r6-regroup-apply` | **必红且必须逐条裁决重写**（见 §2.4.5.1） |
| `smoke-test-v4-event-store` | **会新增绿**：D-1/D-2 修好后归并产物过 26 字段校验 |
| `lib/index.js:8688 writeCuratedEventsPre` | **不改**。它是「账本归档」通道，与 2.4「事件归并」是两件事 |
| `plan-render.js` | 间接：closed 不进「当前状态」表（只列 active），与「archived 被 skip」等价 |
| `client.js` | **不改**。前端 `ev4TicketOfPre` 只看 `kind==='ledger'`；归并后 kind 由 2.2 推断 |

#### 2.4.5.1 r6 套件既有断言的逐条裁决（**不能整批改**）

| 既有断言 | 守的是 | 处置 |
|---|---|---|
| 「默认 dry-run，不传 apply 绝不写盘」 | **不变量** | 原样保留 |
| 「令牌不匹配 ⇒ 拒绝」 | **不变量** | 原样保留 |
| 「快照先行」 | **不变量** | 原样保留 |
| 「旧事件**标 archived** 而非删除」 | **旧决策**（archived 是非法枚举值，实测必致隔离） | **改写为**「旧事件 status 变 closed 且 outcome 非空」 |
| 「检查点守恒」（若已有） | 不变量 | 保留，并升级为三维 |

### 2.4.6 失败模式（5 条）

| # | 会怎么错 | 测试里怎么被发现 |
|---|---|---|
| **F1** | 用**未修**的 apply 直接跑真实数据 ⇒ 46 个 active 全变 `archived` ⇒ 全库不可写、全部被隔离 | 真跑前先在**沙箱副本**上跑一遍 apply，然后 `validateEventPre` 每个事件，任一非空即中止 |
| **F2** | 检查点迁移时**丢了 text**（只搬 kind/at）⇒ 总数对了但内容空了 | 第三维（内容指纹）必红 —— 这正是「只比总数」抓不到的形状 |
| **F3** | 迁移时 **idemKey 冲突**（两个源事件有同一个 idemKey）⇒ 合并后同事件内 `duplicate-idemKey` ⇒ 整个事件被拒 | `validateEventPre:229` 判 `duplicate-idemKey` ⇒ 步骤 6 的契约校验必红 |
| **F4** | 归并期间**别的进程在写**（另一 agent 的 `memory_log`）⇒ 整体重写把它的写**覆盖掉** | 静默窗口（mtime > 60s）+ 归并前后比对「事件 id 集合」；出现**新的**未知 id ⇒ 有并发写 ⇒ 中止 |
| **F5** | 回滚只做 `copyFile` 没做 sha 校验 ⇒ 回滚「看起来成功」但内容不对 | `atomicRollbackPre` 的 `verify-final` 断言；构造「快照被截断」夹具 ⇒ 必红 |

### 2.4.7 验收用例设计

#### 第一段：沙箱真跑（不碰真实数据）

```
// tests/smoke/smoke-test-batch2-4-regroup-conserve.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SANDBOX = path.join(REPO, '.tmp-smoke-run/b2-4')
fs.rmSync(SANDBOX, { recursive: true, force: true })
const HANDOFF = path.join(SANDBOX, 'handoff')
fs.mkdirSync(HANDOFF, { recursive: true })
const STORE = path.join(HANDOFF, 'event-store.json')
const BK = path.join(HANDOFF, '.event-store-backups')

const RA = await import(pathToFileURL(path.join(REPO, 'lib/event-regroup-apply.js')).href)
const ES = await import(pathToFileURL(path.join(REPO, 'lib/event-store.js')).href)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n + (d ? ' :: ' + d : '')) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

// 造 3 个碎片事件（共 5 条检查点）+ 1 个 closed 事件，全部**合法 26 字段**
const base = (id, name, status, cps) => ({
  id, name, status, summary: '', outcome: status === 'closed' ? '已完成' : null, skillRef: null, pausedReason: null,
  sections: { goal: '', doing: '', deadend: '', next: '' }, checkpoints: cps,
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: 1, updatedAt: 1, startMs: 0, endMs: 0, members: [], rationale: '',
  kind: 'unknown', confidence: 'unknown', outcomes: [], ordinal: 0,
  skills: { hitCount: 0, names: [], touched: false }, idemTag: null,
})
const CP = (k, t) => ({ at: k, kind: 'log', text: t, idemKey: 'k' + k })
fs.writeFileSync(STORE, JSON.stringify({ schema: 'v4_event_store_v2', events: [
  base('evt_00000001', '碎片一', 'active', [CP(1, 'a'), CP(2, 'b')]),
  base('evt_00000002', '碎片二', 'active', [CP(3, 'c')]),
  base('evt_00000003', '碎片三', 'active', [CP(4, 'd'), CP(5, 'e')]),
  base('evt_00000004', '已完成', 'closed', [CP(6, 'f')]),
], updatedAt: 1 }, null, 2), 'utf8')

const before = await RA.takeConservationBaselinePre(STORE)
ok(before.total === 6, 'A-1 归并前检查点总数 = 6', String(before.total))

const proposal = { schema: 'v1_event_regroup_proposal', workspace: 'w', generatedAt: 1,
  proposedGroups: [{ name: '合并后事件', summary: 's', members: ['evt_00000001', 'evt_00000002'],
    sections: { goal: 'G', doing: '', deadend: '', next: '' } }], requiresHumanApproval: true }
const token = RA.proposalTokenPre(proposal)
const snapBytes = fs.readFileSync(STORE)
const r = await RA.applyRegroupPre({ proposal, storePath: STORE, backupDir: BK, token, apply: true })
ok(r.ok === true && r.dryRun === false, 'A-2 真写成功')

const after = await RA.takeConservationBaselinePre(STORE)
```

> ⚠️ **A-2 的一个前提**：`applyRegroupPre` 的 `proposedGroups[].members` 语义是「账本文件名」（来源：`event-regroup.js:173` 的 `members: idxs.map(i => String(list[i].name))` 与 `previewApplyPre` 的 `memberCount`）。而**检查点迁移需要「源事件 id」**。这两者不是一回事 ⇒ **必须在 proposal schema 的 `proposedGroups` 里显式加 `sourceEventIds:string[]`**（+1 字段，只加在 proposal 上，**不加在事件上**，因此不触碰 26 字段契约）。这是本节对 2.4 的唯一 schema 补充，需用户确认（见 §6 问题 2）。

**关键断言（守恒 + 契约 + 可写性）**：

```
ok(after.total === before.total, 'B-1 ★★★总量守恒', before.total + ' -> ' + after.total)
ok(JSON.stringify(after.idemKeys) === JSON.stringify(before.idemKeys), 'B-2 ★★★idemKey 多重集守恒')
ok(JSON.stringify(after.fp) === JSON.stringify(before.fp), 'B-3 ★★★内容指纹守恒（防「数量对、内容空」）')

const disk = JSON.parse(fs.readFileSync(STORE, 'utf8'))
ok(disk.events.length === 2, 'B-4 事件数下降（4 -> 2）', String(disk.events.length))
const newEv = disk.events.find((e) => e.name === '合并后事件')
ok(!!newEv && newEv.checkpoints.length === 5, 'B-5 ★新事件承接 5 条检查点', newEv ? String(newEv.checkpoints.length) : 'null')

let badAll = []
for (const e of disk.events) { const bad = ES.validateEventPre(e); if (bad.length) badAll.push(e.id + ':' + bad.join(',')) }
ok(badAll.length === 0, 'B-6 ★★★归并后每个事件都过 26 字段 fail-closed 校验', badAll.join(' | '))
ok(disk.events.filter((e) => e.status === 'active').length === 1, 'B-7 旧 active 全部 closed、新事件 active')

// 归并后仍可写 —— 这是 D-1/D-2 的直接后果，必须端到端验证
let appendErr = ''
try { await ES.eventStorePre.append(STORE, newEv.id, { checkpoint: { at: 99, kind: 'log', text: 'z', idemKey: 'zz' } }) }
catch (e) { appendErr = String(e.message) }
ok(appendErr === '', 'B-8 ★★★归并后新事件仍可追加检查点（D-1 已修）', appendErr.slice(0, 120))
```

#### 第二段：回滚真调用一次成功（总表判据）

```
// C 组：真调用 rollbackFromSnapshotPre（**总表点名的那个函数**）
const snapFile = r.snapshot.file
ok(!!snapFile && fs.existsSync(snapFile), 'C-1 快照文件存在', snapFile ? path.basename(snapFile) : 'null')
const rb = await RA.rollbackFromSnapshotPre({ storePath: STORE, backupFile: snapFile })
ok(rb.ok === true, 'C-2 ★★rollbackFromSnapshotPre 真调用一次成功', JSON.stringify(rb))
const back = fs.readFileSync(STORE)
ok(Buffer.compare(back, snapBytes) === 0, 'C-3 ★★★回滚后与归并前**逐字节相等**', back.length + ' vs ' + snapBytes.length)

const restored = await RA.takeConservationBaselinePre(STORE)
ok(restored.total === before.total && JSON.stringify(restored.fp) === JSON.stringify(before.fp), 'C-4 回滚后三维回到归并前')
```

#### 负路径（旧实现通过、新实现必须拒绝）

**N-1 守恒必须能失败**（证明判据不是恒真）：构造「只搬 kind/at、丢掉 text」的形态，断言第三维必红而第一维仍绿。

```
const beforeX = { total: 2, idemKeys: ['k1', 'k2'], fp: ['aaa', 'bbb'] }
const afterX  = { total: 2, idemKeys: ['k1', 'k2'], fp: ['aaa', 'ccc'] }   // 数量对、内容变
const cx = RA.conservedPre(beforeX, afterX)
ok(cx.ok === false && cx.dim === 'fingerprint', 'N-1 ★★三维判据能抓「数量对、内容空」', JSON.stringify(cx))
```

**N-2 归档状态必须合法**：

```
ok(disk.events.every((e) => ES.EVENT_STATUSES.includes(e.status)), 'N-2 ★★无 archived 非法状态', disk.events.map((e) => e.status).join(','))
```

**N-3 原子回滚必须能拒绝坏快照**：

```
const badSnap = path.join(SANDBOX, 'bad-snapshot.json')
fs.writeFileSync(badSnap, fs.readFileSync(snapFile).slice(0, 10), 'utf8')
const rbad = await RA.atomicRollbackPre({ storePath: STORE, backupFile: badSnap })
ok(rbad.ok === false, 'N-3 ★★坏快照必须被拒（不是静默写成半截）', JSON.stringify(rbad))
```

#### 变异必红

| 变异 | 改哪一行回旧形态 | 必须变红的断言 |
|---|---|---|
| M4-a | 删掉 `ev.checkpoints = carried` 那一行（恢复旧行为：不迁检查点） | **B-5**、**B-1/B-2/B-3** 必红 |
| M4-b | `ev.status = 'closed'` 改回 `ev.status = 'archived'` | **B-6**、**N-2**、**B-8** 必红 |
| M4-c | 把 `ev.members = …` 改回 `ev.memberLedgers = …` | **B-6** 必红（`unknown:memberLedgers`） |
| M4-d | 把 `ev.rationale = 'regroup-ai: …'` 改回 `ev.origin = 'regroup-ai'` | **B-6** 必红（`unknown:origin`） |
| M4-e | `conservedPre` 里删掉第三维（fingerprint）比较 | **N-1 必红** |
| M4-f | `atomicRollbackPre` 的 `rename(tmp, storePath)` 改回 `copyFile(backupFile, storePath)` | **N-3 必红** |

### 2.4.8 风险与回滚

**会碰真实用户数据** —— 本批唯一碰数据项。真实数据路径与指纹：

- 文件：`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`
- 当前：**3,022,982 B**｜sha16 `D6A061D67B7E4BEE`｜50 事件 / 706 检查点

**开工前置（缺一不许开工）**：

1. **0.2 备份已完成并经校验**：`sha256(备份) === sha256(原件)`。批次 0 报告只记录了 `facts.json` 与 `index.json` 的备份（`BATCH0-BASELINE-20261108.md`），**event-store.json 需单独确认**。
2. **静默窗口**：`event-store.json` mtime 距今 > 60 秒。
3. **沙箱演练必须先全绿**（§2.4.7 的 A/B/C 三组 + N 组全 PASS）。
4. **2.3 已上线并验证零写盘**（依赖）。
5. 记录 `git status` 与 §0.2 三元组基线。

**回滚步骤（核心命令，判据见 §2.4.4 六步序列）**：

```
# ① 归并前记录（必须在 apply 之前做）
$P = "C:\Users\JH Z\.dsh\memory\workspaces\--D--dsh-auto-memory--\handoff\event-store.json"
$sha0 = (Get-FileHash $P -Algorithm SHA256).Hash
$bytes0 = (Get-Item $P).Length
Write-Output ("归并前 sha256=" + $sha0 + " bytes=" + $bytes0)

# ② 守恒失败 ⇒ 用 apply 自己产出的快照回滚
#    快照在 handoff\.event-store-backups\event-store.<ts>.<token>.json
$snap = "<apply 返回的 snapshot.file>"
node -e "import('./lib/event-regroup-apply.js').then(async m => { const r = await m.atomicRollbackPre({ storePath: process.argv[1], backupFile: process.argv[2] }); console.log(JSON.stringify(r)) })" "$P" "$snap"

# ③ 三项复验（缺一即视为回滚未完成）
$sha1 = (Get-FileHash $P -Algorithm SHA256).Hash
$bytes1 = (Get-Item $P).Length
Write-Output ("sha256 复原=" + ($sha0 -eq $sha1) + " | bytes 复原=" + ($bytes0 -eq $bytes1))
node -e "import('./lib/event-regroup-apply.js').then(async m => { const b = await m.takeConservationBaselinePre(process.argv[1]); console.log(JSON.stringify({total:b.total,idem:b.idemKeys.length,fp:b.fp.length})) })" "$P"
```

**判据**：`sha256 复原=True` **且** `bytes 复原=True` **且** 三维计数回到 **706**。三者全绿才可报「已回滚」。

**回滚失败怎么办（不许跳）**：报「回滚失败 + `step` + 盘上实际 sha16」，并**停止后续所有批次 2 动作**。`MAX_BACKUPS=20` 的裁剪可能已删掉更早的快照 ⇒ **归并前必须手工再存一份到 `hub/backups/`**，与批次 0 的备份放在一起。

### 2.4.9 工时与依赖

- 改动量：**生产代码 +78 行 / −6 行**（修 D-1 +6/−3、修 D-2 +10/−3、修 D-3 +18、守恒基线 +26、原子回滚 +34，按去重计）；**改写 1 个既有套件（r6，约 6 条断言）+ 新增 1 个套件 / 约 16 条断言**。
- **依赖（两个，缺一不可）**：
  - **2.3**（必须先上线并验证零写盘）—— 本项消费它的 `suggestions` / `prompt`；
  - **0.2**（event-store 备份）—— 必须完成且经 sha256 校验。
- **额外前置（本细则要求）**：先修 D-1/D-2/D-3 再谈归并。若用户要求「按现状跑」，本细则**不建议执行 2.4**。

---

## 2.5 白板随事件自动重绘

### 2.5.1 现状实测

落点（总表原写 `lib/index.js:24721`，**实测 24749 = fromEvents 分支，24762 = 渲染调用**）：

```
      if (args.kind === 'plan' && args.fromEvents === true) {
        try {
          const _evStorePath = path.join(p.handoffDir, V4_EVENT_STORE_FILENAME)
          const _evList = await eventStorePre.list(_evStorePath, { all: true })
          const _evs = (_evList && Array.isArray(_evList.events)) ? _evList.events : []
          if (!_evs.length) return 'memory_note: 事件库为空，无法渲染白板。请先 memory_event(action=create) 建事件。'
          const { renderPlanFromEventsPre } = await import('./plan-render.js')
          ...
          const _wsPath = String(p.ws || '')
          const _wsName = (_wsPath ? path.basename(_wsPath) : '') || path.basename(String(p.projectDir || 'workspace')) || 'workspace'
          const _rendered = renderPlanFromEventsPre(_evs, { wsName: _wsName })
          if (!String(_rendered || '').trim()) return 'memory_note: 事件渲染结果为空，未写入（事件库可能有内容但四段全空）。'
          content = _rendered
        } catch (eR) {
          return 'memory_note: 事件渲染失败（' + String((eR && eR.message) || eR) + '）。可用 fromEvents=false 手写 content 兜底。'
        }
      }
```

**这是全仓唯一的「事件 → 白板」生产入口**（`renderPlanFromEventsPre` 全仓 6 处命中：`index.js:24755` 动态导入 + `24762` 调用，`plan-render.js:211` 定义，`upgrade-apply.js:49/456/710/764` 死岛）。**事件 append 路径零调用** ⇒ 事件变了白板不变（D-5 逐字）。

**关键实测（决定改法）**：对当前真实事件库跑同参渲染 = **9,400 字符 / 16,811 字节 / 0 颗锚点**；磁盘 `PLAN.md` = **15,250 字符 / 26,872 字节 / 34 颗锚点**，两者**第 6 行即分叉**。

⇒ 若把「每次事件写都自动重绘白板」做成无条件覆盖，**第一次写入就会丢掉 34 颗锚点、体积 26,872 → 16,811（−37.4%）**。这不是「自动重绘」，这是**白板被降级**。所以 2.5 必须先解决「重绘的卡片身份能不能稳定」。

### 2.5.2 改法（函数级 diff）

**分两步，第一步是前提，第二步才是自动化。**

#### 第一步：让重绘的卡片身份跨调用稳定（改调用点，不改渲染器）

`writePlanSnapshot`（`lib/index.js:5319`）内已有 `anchoredPlanPre`，它会**给缺锚点的卡片分配新 id**。所以真正需要的不是「保留旧锚点」，而是**让同一事件在两次渲染之间落到同一个卡片位置**，否则每刷新一次白板 id 全变、M1 判据与前端选中态全部失配。

依据：`plan-render.js:129-131` 的排序已用 `ordinal` 做「时间相同」的稳定序（注释逐字「同输入逐字节确定」）。把它改成「按事件 id 定序」即可获得**跨调用稳定**的渲染结果。

```
// lib/index.js:24762 前后（+9 行）
          const { renderPlanFromEventsPre } = await import('./plan-render.js')
          // ★批次 2.5（2026-11-08）：用**事件 id 定序**生成稳定的 ordinal，
          //   使同一事件在多次重绘之间映射到同一个卡片位置（anchoredPlanPre 按出现序分配 id）。
          const _ordinalById = new Map()
          _evs.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .forEach((e, i) => _ordinalById.set(String(e.id), i + 1))
          const _evsSeeded = _evs.map((e) => Object.assign({}, e, { ordinal: _ordinalById.get(String(e.id)) || 0 }))
          const _rendered = renderPlanFromEventsPre(_evsSeeded, { wsName: _wsName })
```

#### 第二步：把「事件写成功 ⇒ 重绘白板」接上（**配置开关，默认关闭**）

**为什么必须默认关闭**：这是本项最容易造成数据事故的地方（每次 `memory_log` 都整体重写 PLAN，带 CAS + M1 门 + 归档）。默认开的后果：①写放大（每轮一次 26 KB 写 + 一次归档）；②M1 丢卡告警可能每轮刷；③一旦渲染器回归，白板每轮被降级一次。

**不改 `event-write.js`**（保持物理隔离）：在 `lib/index.js` 的 `memory_event` 四个写分支里，各在既有 `refreshEventStatePre` 之后加 9 行「尽力重绘」。

```
          try {
            // ★批次 2.5：白板随事件自动重绘（**配置开关，默认关闭**）。
            //   只在 boardMode=graph 且 config.planAutoRedraw === true 时执行；
            //   失败一律 fail-soft（白板是投影，绝不能因为它让事件写入失败）。
            if (String((engine.config || {}).boardMode || '').toLowerCase() === 'graph'
              && (engine.config || {}).planAutoRedraw === true) {
              await engine.redrawPlanFromEventsPre(p, exec.agent)
            }
          } catch (_) { /* fail-soft：白板重绘失败不影响事件写入 */ }
```

**新增 `redrawPlanFromEventsPre`**（engine 方法，+26 行，放在 `writePlanSnapshot` 之后）：

```
  /** ★批次 2.5（2026-11-08）：事件写完 ⇒ 尽力把白板重绘成事件的投影。
   *
   *  ★三条安全约束：
   *    ① **先比对**：重绘结果与磁盘 PLAN 逐字节相同 ⇒ **一个字节都不写**（负路径判据的来源）；
   *    ② 走 `writePlanSnapshot` 唯一写盘口（复用 CAS + M1 保护 + 归档 + sidecar），不自己写文件；
   *    ③ fail-soft：任何异常只记诊断，**绝不向上抛**（白板是投影，不能拖垮事件写入）。
   */
  async redrawPlanFromEventsPre(p, agent) {
    try {
      const planPath = p.planPath || path.join(p.handoffDir, 'PLAN.md')
      const existing = await this.readTextSafe(planPath)
      const storePath = path.join(p.handoffDir, V4_EVENT_STORE_FILENAME)
      const all = await eventStorePre.list(storePath, { all: true })
      const evs = (all && Array.isArray(all.events)) ? all.events : []
      if (!evs.length) return { ok: false, code: 'empty-store' }
      const { renderPlanFromEventsPre } = await import('./plan-render.js')
      const wsPath = String(p.ws || '')
      const wsName = (wsPath ? path.basename(wsPath) : '') || path.basename(String(p.projectDir || 'workspace')) || 'workspace'
      const ord = new Map()
      evs.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .forEach((e, i) => ord.set(String(e.id), i + 1))
      const seeded = evs.map((e) => Object.assign({}, e, { ordinal: ord.get(String(e.id)) || 0 }))
      const rendered = renderPlanFromEventsPre(seeded, { wsName })
      if (!String(rendered || '').trim()) return { ok: false, code: 'empty-render' }
      // ① 无变化 ⇒ 不写（负路径：PLAN 字节不变）
      if (String(rendered) === String(existing)) return { ok: true, skipped: 'no-change', bytes: Buffer.byteLength(existing, 'utf8') }
      // ② 走唯一写盘口
      const w = await this.writePlanSnapshot(p.projectDir, rendered, {})
      return { ok: !!(w && w.ok), wrote: !!(w && w.ok), bytes: Number((w && w.committedBytes) || 0), m1: !!(w && w.m1Downgraded), error: (w && w.error) || '' }
    } catch (e) {
      try { recordDiagnosticErrorPre(this._degradeSink, 'plan-auto-redraw', e) } catch (_) {}
      return { ok: false, code: 'exception', error: String((e && e.message) || e).slice(0, 200) }
    }
  }
```

**新增配置键 `planAutoRedraw`**（`DEFAULT_CONFIG`，默认 `false`）：这是**唯一新增的配置键**，需在 `verify-docs.mjs` 的键计数中同步（154 → 155）。

### 2.5.3 与既有机制的关系

| 机制 | 影响 |
|---|---|
| pruneIfNeeded | 不涉及 |
| **flush 整体重写** | **间接**：本项每次都调 `writePlanSnapshot`（整体重写 PLAN）。**这就是必须默认关闭 + no-change 短路的原因** |
| **M1 丢卡保护** | **直接影响**：重绘结果若少卡 ⇒ `m1Downgraded=true` 并回吐「⚠ 白板丢卡警示」。§2.5.1 已实测：无条件重绘会让 34 颗锚点变 0 ⇒ **必然触发 M1 降级**。⇒ 第一步的 ordinal 稳定化是**前置必需** |
| **注入面 budget** | **零影响**。PLAN.md 进注入面走 `handoffEnabled` 分支，长度受既有预算裁剪；本项不改预算 |
| `writePlanSnapshot` | **复用不修改**（CAS / 归档 / sidecar / M1 全部原样） |
| `checkMutationPre` | 会被调用（经 writePlanSnapshot）⇒ 本细则**不传 skipCriteria**（保持判据门开启） |
| `smoke-test-*plan*` 系列 | **新增 1 个套件**；既有 plan 套件不受影响（新方法是纯增量） |
| `tools/verify-docs.mjs` | **需同步**：配置键 +1（154 → 155）。该脚本不在回归套件内，须单独执行 |
| `client.js` | **不改**（配置项由用户在配置文件里手动开，不加 UI 控件） |

### 2.5.4 失败模式（4 条）

| # | 会怎么错 | 测试里怎么被发现 |
|---|---|---|
| F1 | **no-change 短路失效**（比对写成 `includes` 或干脆没做）⇒ 每轮都整体重写 + 归档一份历史 | 负路径 N-1：连调两次，断言第二次 `skipped === 'no-change'` 且 PLAN 的 mtime 与字节都不变 |
| F2 | 重绘丢卡 ⇒ 每次写都吐 M1 告警，用户被刷屏且白板逐步被降级成骨架 | 断言 `result.m1 === false`；构造「PLAN 有 34 卡、事件只能渲染出 0 卡」的夹具 ⇒ 必红 |
| F3 | 重绘异常向上抛 ⇒ **事件写成功了但工具报失败**（用户会重试 ⇒ 重复写入） | 注入一个会抛错的 `writePlanSnapshot` 桩，断言事件写入仍返回成功、`redraw` 返回 `ok:false` |
| F4 | 开关默认开 ⇒ 每轮 26 KB 写 + 归档，磁盘与延迟双涨 | 断言 `DEFAULT_CONFIG.planAutoRedraw === false`（这是**静态**断言，只能作守卫，**不算功能验收**） |

### 2.5.5 验收用例设计

#### 真执行（真 import → 真构造 → 真调用 → 断言副作用）

```
// tests/smoke/smoke-test-batch2-5-plan-auto-redraw.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SANDBOX = path.join(REPO, '.tmp-smoke-run/b2-5')
fs.rmSync(SANDBOX, { recursive: true, force: true })
const HANDOFF = path.join(SANDBOX, 'handoff')
fs.mkdirSync(HANDOFF, { recursive: true })
const STORE = path.join(HANDOFF, 'event-store.json')
const PLAN = path.join(HANDOFF, 'PLAN.md')
const NL = String.fromCharCode(10)

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ok   - ' + n + (d ? ' :: ' + d : '')) } else { fail++; console.log('  FAIL - ' + n + (d ? ' :: ' + d : '')) } }

const ES = await import(pathToFileURL(path.join(REPO, 'lib/event-store.js')).href)
const PATHS = { handoffDir: HANDOFF, projectDir: SANDBOX, planPath: PLAN, ws: SANDBOX, wsBound: true }

// 造 2 个 active 事件（四段非空，才能渲染出「近期进展」）
const mk = (id, name, goal) => ({
  id, name, status: 'active', summary: name + ' 的总览', outcome: null, skillRef: null, pausedReason: null,
  sections: { goal, doing: 'd', deadend: '', next: 'n' }, checkpoints: [],
  userPercept: [], agentTrace: [], sharedGround: [], commitments: [], constraints: [],
  createdAt: 1, updatedAt: 1, startMs: 0, endMs: 0, members: [], rationale: '',
  kind: 'ledger', confidence: 'high', outcomes: [], ordinal: 0,
  skills: { hitCount: 0, names: [], touched: false }, idemTag: null,
})
fs.writeFileSync(STORE, JSON.stringify({ schema: 'v4_event_store_v2', events: [
  mk('evt_0000000a', '事件甲', '做甲事'), mk('evt_0000000b', '事件乙', '做乙事'),
], updatedAt: 1 }, null, 2), 'utf8')
fs.writeFileSync(PLAN, '# 项目白板 · 占位' + NL, 'utf8')

// 真引擎：只注入本方法用到的入口；writePlanSnapshot 用**真实现的最小版**（原子写）
const engine = {
  _degradeSink: null, config: { boardMode: 'graph', planAutoRedraw: true, dayBoundaryMinutes: 450 },
  async readTextSafe(p) { try { return fs.readFileSync(p, 'utf8') } catch (_) { return '' } },
  async writePlanSnapshot(projectDir, content) {
    const p = path.join(projectDir, 'handoff', 'PLAN.md')
    const prev = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    if (prev === content) return { ok: true, committed: true, committedBytes: Buffer.byteLength(content, 'utf8') }
    const tmp = p + '.tmp' + process.pid
    fs.writeFileSync(tmp, content, 'utf8'); fs.renameSync(tmp, p)          // 真实 tmp->rename 原子写
    return { ok: true, committed: true, committedBytes: Buffer.byteLength(content, 'utf8'), m1Downgraded: false }
  },
}

// 抽取 redrawPlanFromEventsPre 并真跑（源码先归一成 LF，防 CRLF 锚点恒不命中）
const IDXN = fs.readFileSync(path.join(REPO, 'lib/index.js'), 'utf8').split(String.fromCharCode(13, 10)).join(NL)
const S = IDXN.indexOf('async redrawPlanFromEventsPre(p, agent) {')
ok(S > 0, 'A-0 ★方法已落地', 'idx=' + S)
let i = IDXN.indexOf('(', S), depth = 0, end = -1
for (; i < IDXN.length; i++) { const ch = IDXN[i]; if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth === 0) { end = i + 1; break } } }
const src = 'async ' + IDXN.slice(S, end) + ' }'
const engineObj = Object.assign(Object.create(null), engine, {
  redrawPlanFromEventsPre: new Function('path', 'eventStorePre', 'V4_EVENT_STORE_FILENAME', 'recordDiagnosticErrorPre', 'Buffer',
    'return ({ ' + src + ' })')(path, ES.eventStorePre, 'event-store.json', () => {}, Buffer).redrawPlanFromEventsPre,
})

// P 组：改一条事件 ⇒ PLAN diff 非空
const beforeBytes = fs.statSync(PLAN).size
await ES.eventStorePre.set(STORE, 'evt_0000000a', { sections: { goal: '做完甲事（已改）' } })
const r1 = await engineObj.redrawPlanFromEventsPre.call(engineObj, PATHS, null)
const afterBytes = fs.statSync(PLAN).size
ok(r1.ok === true && r1.wrote === true, 'P-1 ★重绘真写了', JSON.stringify(r1))
ok(afterBytes !== beforeBytes, 'P-2 ★★★改一条事件 ⇒ PLAN 字节变化', beforeBytes + ' -> ' + afterBytes)
ok(fs.readFileSync(PLAN, 'utf8').indexOf('做完甲事（已改）') >= 0, 'P-3 ★PLAN 含新的 goal 文本')
```

#### 负路径（旧实现通过、新实现必须拒绝）

```
const b2 = fs.statSync(PLAN).size
const m0 = fs.statSync(PLAN).mtimeMs
const r2 = await engineObj.redrawPlanFromEventsPre.call(engineObj, PATHS, null)
const a2 = fs.statSync(PLAN).size
const m1 = fs.statSync(PLAN).mtimeMs
ok(r2.ok === true && r2.skipped === 'no-change', 'N-1a ★★无事发生 ⇒ skipped=no-change', JSON.stringify(r2))
ok(a2 === b2, 'N-1b ★★★无变化时 PLAN 字节不变', b2 + ' -> ' + a2)
ok(m1 === m0, 'N-1c ★★★无变化时 PLAN 的 mtime 不变（真的没写，不是写了同样的内容）')

// N-2 事件写入不被白板失败拖垮
const engineBoom = Object.assign(Object.create(null), engineObj, {
  async writePlanSnapshot() { throw new Error('boom') },
})
let threw = ''
let r3 = null
try { r3 = await engineBoom.redrawPlanFromEventsPre.call(engineBoom, PATHS, null) } catch (e) { threw = String(e.message) }
ok(threw === '', 'N-2a ★重绘异常不向上抛', threw)
ok(r3 && r3.ok === false && r3.code === 'exception', 'N-2b ★返回 ok:false + code:exception', JSON.stringify(r3))
```

#### 变异必红

| 变异 | 改哪一行回旧形态 | 必须变红的断言 |
|---|---|---|
| M5-a | 删掉 `if (String(rendered) === String(existing)) return { ok: true, skipped: 'no-change' … }` 整行 | **N-1a / N-1b / N-1c** 必红 |
| M5-b | 把 `writePlanSnapshot` 调用改成直接 `fs.writeFileSync(planPath, rendered)` | **N-2a / N-2b** 必红（绕过唯一写盘口后异常直接冒泡） |
| M5-c | 把 `try/catch` 整块删掉（让异常冒泡） | **N-2a** 必红 |
| M5-d | 把 `renderPlanFromEventsPre(seeded, …)` 的 `seeded` 改回 `evs` | 需补一条断言：**同一批事件连调两次，渲染结果必须逐字节相同**；不稳定时该断言红 |

### 2.5.6 风险与回滚

- **不碰真实用户数据**：验收全在 `.tmp-smoke-run/b2-5/` 沙箱。
- 生产风险：开关默认 **false** ⇒ 上线零行为变化。打开后每轮可能整体重写 PLAN（26 KB）+ 归档一份。**建议先在单工作区打开，观察 3 天再推广**。
- **M1 风险**：未做 ordinal 稳定化就打开开关，实测会让 34 颗锚点归零并每轮抛「⚠ 白板丢卡警示」⇒ **第一步是前置必需，不许跳过**。
- **回滚**：(1) 把 `config.planAutoRedraw` 置回 `false`（**一行配置，立即生效，无需改代码**）；(2) 若要彻底移除：删 `redrawPlanFromEventsPre`（−26 行）+ 四个工具分支里的 36 行调用；(3) PLAN 若被降级，从 `handoff/archive/PLAN-<ts>.md`（writePlanSnapshot 每次重写都自动归档）恢复。

### 2.5.7 工时与依赖

- 改动量：**生产代码 +35 行 / −0 行**（方法 26 + 调用点 9）；**配置键 +1**（需同步 verify-docs 计数）；**新增 1 套件 / 约 14 条断言**。
- **依赖：无**（可独立做）。但与 2.4 有**顺序建议**：2.4 归并会让事件数从 50 降到约 28，白板「当前状态」表随之变化。**建议 2.5 在 2.4 之前完成**（先建立自动化，再让归并结果自动投影出去）。

---

## 3. 本批汇总（工时 / 依赖 / 顺序）

### 3.1 顺序（严格按此）

```
第 0 步（前置，非本批）
  └ 0.2 event-store.json 备份 + sha256 校验     ← 2.4 的硬前置
  └ 1.4 主题门换判据                            ← 2.1 / 2.2 的硬前置

第 1 步  2.3  event-regroup 只读提案接线        ← 零风险、零依赖，先做
第 2 步  2.2  kind 推断                         ← 与 2.1 可并行（不同文件）
第 2 步  2.1  建事件时填 goal 首段              ← 与 2.2 可并行
第 3 步  2.5  白板随事件自动重绘（默认关闭）    ← 必须在 2.4 之前（先建自动化）
第 4 步  2.4  存量碎片归并（碰真实数据）        ← 串行，且必须先修 apply 三处
```

### 3.2 工时合计（行数量级 + 测试条数）

| 项 | 生产代码 | 测试 | 依赖 |
|---|---|---|---|
| 2.1 | +5 / −1 行 | 1 套件 / 约 10 条 | 1.4 |
| 2.2 | +32 行（含可选 +2） | 1 套件 / 约 15 条 | 1.4 |
| 2.3 | +66 行 | 1 套件 / 约 18 条 | **无** |
| 2.4 | +78 / −6 行 | 1 新套件 / 约 16 条 + 改写 r6 约 6 条 | 2.3 + 0.2 + 先修 apply 三处 |
| 2.5 | +35 行 + 1 配置键 | 1 套件 / 约 14 条 | 无 |
| **合计** | **约 +216 / −7 行** | **5 新套件 / 约 73 条 + r6 改写 6 条** | — |

### 3.3 必须复算的物理量（收工时逐条填）

| 量 | 现值（基线） | 收工时实测 |
|---|---|---|
| `lib/index.js` 行数 | 28,809 | |
| `lib/index.js` 字节 | 2,082,057 | |
| `lib/index.js` sha16 | `36BE3335AED3128E` | |
| `lib/event-store.js` 字节 | 70,215 | |
| `lib/event-regroup-apply.js` 字节 | 10,334 | |
| event-store 事件数 | 50（active 46 / closed 4） | |
| event-store 检查点数 | 706 | |
| 5 个新套件 PASS 数 | 0（尚未创建） | |
| r6 套件 PASS 数 | 40 | |
| 既有 4 个 event-regroup 套件 | 48 / 44 / 43 / 40 | |
| `tools/verify-docs.mjs` 配置键数 | 154（2.5 后 155） | |

---

## 4. 建议扩范围（**单列，不直接扩**）

以下三项在施工中会碰到，但**不属于批次 2 划定的落点**。列在这里由用户裁定，不得自行扩大。

| # | 建议 | 为什么必须跨范围 | 代价 |
|---|---|---|---|
| S-1 | **把 `create` 的 `outcome` 透传补上**（`event-store.js:812` 解构 +1 项、`applyV2FieldsPre` 不受影响） | 2.2 的「outcome + 起止 ⇒ project」判据在**当前 create 通道上永远不成立**（实测传 outcome 落盘仍 null）⇒ 该判据形同虚设 | +2 行，且是 26 字段契约内已有字段，零 schema 变更 |
| S-2 | **`proposedGroups` 增加 `sourceEventIds:string[]`** | 2.4 的「检查点迁移」需要**源事件 id**，而现行 `members` 语义是**账本文件名**（`event-regroup.js:173` 逐字），两者不可互换 | +1 字段（只在 proposal 上，不碰事件 26 字段契约）；需同步 `proposalTokenPre` 的 canon 与 r6 套件 |
| S-3 | **面板加只读提案预览区**（`client.js`） | 2.3 的 dryRun 结果目前只能 curl 看；用户要「在面板里看到建议」需前端接线 | 属「禁止社区 merge 式重构」+「改前必须跑真执行 factory 守卫」的高风险面；建议**独立排期**，不在本批 |

---

## 5. 计划外的大额工时（**单列，不混进本批**）

| # | 事项 | 为什么算计划外 | 估计 |
|---|---|---|---|
| X-1 | **`docs/internal/` 下 300+ 份审计文档里的路由数/工具数/配置键数计数** 在 2.5 新增配置键后可能需要全量对齐 | 总表未把「配置键计数同步」列为批次 2 的任务；但本仓有「计数锁改动必须全仓检索所有出现点，否则校验器全绿仍属假绿」的硬约束 | 需先跑 `tools/verify-docs.mjs` 拿到真实影响面；若超过 3 处需用户裁定 |
| X-2 | **r6 套件的 6 条断言改写** | 严格说属 2.4 的一部分（§2.4.5.1 已逐条裁决），但如果用户不想动既有套件，这 6 条就变成**计划外的测试改动** | 约 1 小时 |
| X-3 | **归并后 PLAN.md 的一次性重建**（34 颗锚点会全部换新） | 2.5 的 ordinal 稳定化只保证**此后**稳定；归并那一刻白板卡 id 必然全变，需人工确认一次 | 1 次人工核对（不是代码工时） |

---

## 6. 本批开工前必须先答的问题（**共 5 条**）

**Q1（2.2 / S-1）**：`eventStorePre.create` 目前**不透传 `outcome`**（实测传 `outcome:'成果乙'` 落盘仍 `null`）。2.2 的第三档判据「outcome 非空 **且** 起止时间 >0 ⇒ project」因此在**当前 create 通道上永远不成立**。是否同意**同批补上 outcome 透传**（+2 行，26 字段内已有字段）？若不同意，2.2 的第三档要不要改成「只有 set 通道生效」并在套件里显式标注为**已知不生效**？

**Q2（2.4 / S-2）**：2.4 的「检查点迁移」需要**源事件 id**，而 `applyRegroupPre` 的 `proposedGroups[].members` 语义是**账本文件名**（实测：`event-regroup.js:173` 逐字 `members: idxs.map((i) => String(list[i].name))`）。两者不可互换。是否同意在 **proposal 对象**上加 `sourceEventIds:string[]`（只加在 proposal 上，不碰事件 26 字段契约）？

**Q3（2.4）**：现行 `applyRegroupPre` 有三处**必致数据不可写**的缺陷（新事件越界写 3 个未知键 / 旧事件写成非法 `status:'archived'` / 检查点不迁移）。本细则把「先修这三处」列为 2.4 的**第一步**。请确认这属于 2.4 范围内，还是应拆成独立的「2.4-pre 修 apply」项？

**Q4（2.5）**：2.5 需要新增配置键 `planAutoRedraw`（默认 `false`），且需同步 `tools/verify-docs.mjs` 的键计数（154 → 155）。请确认：① 新增这个键可以吗？② 收工时是否必须跑 `verify-docs.mjs` 并把输出贴进回执（该脚本**不在回归套件内**）？

**Q5（2.3）**：2.3 的 dryRun 结果**目前只能通过 HTTP/curl 看到**，面板呈现被列为 S-3（独立排期）。请确认本批的 2.3 验收**以「路由可 curl + 返回结构含 confidence + 零写盘」为界**即可，不需等前端接线。

---

## 7. 本文件的自检（可复算）

| 检查项 | 结果 |
|---|---|
| 五项 × 7 块齐全 | 2.1 / 2.2 / 2.3 / 2.4 / 2.5 各有：现状实测、改法、与既有机制的关系、失败模式、验收用例设计（真执行+负路径+变异必红）、风险与回滚、工时与依赖 —— **7/7 × 5 = 35 块全在** |
| 是否真打开文件读代码 | 是。引用的每一段都有 `file:line`，行号为本轮实测（漂移表见 §0.5） |
| 是否给出可复算物理量 | 是。§0.2 / §0.3 / §0.4 / §0.6 / §3.3 全部为实测字节/行数/sha16/PASS 数 |
| 是否改动代码 | **否**。本轮只在 `artifacts/_detail-batch2/` 下写探针脚本；`lib/`、`tests/` 零改动 |
| 是否越出总表落点 | 2.1 跨界到 `event-write.js`（+5 行）、2.4 跨界到 `event-regroup-apply.js`（+78/−6 行）—— **两处已在正文逐段说明理由**，且 2.4 的三处修复属「不修就不能跑」的前置 |
| 计划外大额工时 | 已单列于 §5（X-1 / X-2 / X-3），未混进本批工时 |

---

## 8. 一句话结论

**2.3 可以今天做完且零风险；2.4 在「修 apply 三处」之前不能碰真实数据 —— 现状跑一次会让 46 个 active 事件全部变成不可写的隔离事件。**

