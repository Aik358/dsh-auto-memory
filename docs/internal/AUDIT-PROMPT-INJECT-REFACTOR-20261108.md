# 交叉审计任务书 · 记忆注入层的档位体系重构

> **这份文件是给外部 Agent 的独立审计任务书。** 请完整读完再动手。
> 生成日期：2026-11-08 · 生成者：上一轮主 Agent（ZCode / DeepSeek Harness 线）
> **本文件里的每一条结论都声称「可复算」。你的任务不是同意它，而是**证伪它或补强它**。**

---

## 0 · 任务性质与边界（先读这一节）

### 0.1 你要做什么

对一个**已经存在的、正在生产运行的** DSH 插件（`dsh-auto-memory`）的记忆注入层，做一次**独立的结构审计**，回答两件事：

1. **A 类（事实校验）**：§5 列出的 12 条断言，逐条判定「成立 / 不成立 / 部分成立」，每条必须给出你自己复算到的数字或代码位置。**不允许**只写「同意」。
2. **B 类（方案校验）**：§6 列出的 6 个开放问题，给出你的独立判断与理由。

### 0.2 你**不能**做什么

- ❌ **不得修改任何文件**（`lib/`、`tests/`、`tools/`、`skins/`、`docs/` 一律只读）
- ❌ 不得 `git add` / `commit` / `stash` / `checkout` / `reset` / `branch`
- ❌ 不得运行任何会写 `~/.dsh/memory/**` 的命令（那是真实用户记忆数据）
- ❌ 不得运行全量 `tools/run-smoke.mjs`（跑起来要十几分钟，且工作树里有其它任务在飞的改动，会污染归因）
- ❌ 不得「顺手修一个 bug」——你的交付物是**审计报告**，不是代码

> 唯一例外：可以在 `%TEMP%` 或 `os.tmpdir()` 下建临时目录做测量。
> 本仓库的目录约定：**绝对不要**把临时文件写到 `~/.dsh/memory/` 下。

### 0.3 环境

| 项 | 值 |
|---|---|
| 仓库 | `D:/dsh-auto-memory`（Windows，Git Bash） |
| 分支 | `preview` |
| **审计基线 commit** | **`7974d930`**（`fix(facts): 冲突库止血…`） |
| Node | v24.x（有 `zlib.zstdDecompressSync`） |
| `lib/index.js` 行尾 | **纯 CRLF**（28,809 行，bare-LF = 0）——**Edit 工具会把它翻成纯 LF，不要用 Edit** |
| 其它 `lib/*.js` 与 `tests/smoke/*.mjs` | **纯 LF** ——与 `index.js` 相反 |
| 记忆数据 | `C:/Users/JH Z/.dsh/memory/`（**只读**） |

> 行尾不一致是本仓已知事故源，测量脚本请用 `readFileSync(...).replace(/\r\n/g,'\n')` 归一化后再算长度。

---

## 1 · 用词约定（**这一节是全文最容易产生误解的地方**）

本仓库历史上把「精简」这个词用在了**两个完全不同**的东西上，这就是本次审计的核心症结。请严格区分：

| 术语 | 指什么 | 判据 | 量级 |
|---|---|---|---|
| **精简帧**（slim frame） | `renderSlimSnapshotPre()` 的返回值，存在变量 `slimText` 里 | 由**频率计数器**决定（`snapshotMinGapRounds=20` / `slimEveryRounds=8`） | 2,043–2,254 字符 |
| **摘要档**（summary tier / 全帧的裁剪态） | `renderMemoryDynamic()` 的返回值 `snap`，但**内容按档位裁过** | 由**档位** `_injectTierPre` 决定 | 19,871–44,048 字符 |
| **档位**（tier） | `INJECT_TIERS` 枚举的 8 个值之一 | `decideInjectTierPre()` | — |

**两条线各自回答不同问题**：

- 频率线：「这一个**模型请求**该给大块还是小块」
- 档位线：「这一帧里**内容集**取哪一档」

所以它们**不是冗余**，是正交的两层。本仓的混乱来自：**两条线都叫「精简」，而规则段的策略在两条线里各写了一遍**（一条给 0 条 + 一行指针，另一条给 182 条摘要）。

---

## 2 · 项目与注入机制的最小必要背景

`dsh-auto-memory` 是 DSH（DeepSeek Harness）的插件，负责本地记忆的自动注入。它通过宿主提供的 `ctx.systemPrompt.context()` 注册一个同步回调，每个**模型请求**调用一次，返回一段 `<memory_system>…</memory_system>` 文本，由宿主追加到对话历史尾部。

一次请求的决策链（**这里是审计重点**）：

```
pre-step 钩子        → 嗅到真人消息 ⇒ st._humanPending = true
  ↓
注入回调 text(context)
  ├─ ① 幂等闸：同一请求已定稿 ⇒ 原样复读
  ├─ ② 档位乐观写入：st._injectTierPre = decideInjectTierPre({ isHuman, isFull: true })   ← isFull 硬编码
  ├─ ③ snap = renderMemoryDynamic(context)      ← 全帧，按 ② 的档位裁内容
  ├─ ④ 档位降级：st._injectTierPre = 'human_slim' | 'run_slim'
  ├─ ⑤ slimText = renderSlimSnapshotPre(...)    ← 精简帧
  └─ ⑥ 频率决策：给 snap 还是 slimText（23 个 return 点之一）
```

**注意 ②→③→④ 的顺序**：`snap` 在档位降级**之前**就渲染完了。所以 `human_slim` / `run_slim` 这两个档**永远到不了 `renderMemoryDynamic`**，只能影响 `slimText`。

---

## 3 · 用户已下的裁定（**不可推翻，只校验实现是否符合**）

以下三条是用户亲自下达的，审计中如发现代码违背它们，那是缺陷，不是设计选择：

### R1 · 摘要档的规则段只投一行指针

> 用户原话（2026-11-08）：「摘要档就不应该投整段的项目规约和用户规约，理论上应该就是一行指针。」

已有先例：**精简帧**里就实现了这个形态（`lib/index.js:10711`）：

```js
if (_hardN > 0) out.push('\n[硬约束] 共 ' + _hardN + ' 条 · 用 memory_rules op=list 取全文')
```

「一行指针」= 这一行加上标题，约 **48 字符**。

### R2 · `legacy`（档位缺失兜底）走「少给」

> 用户原话（2026-11-08）：「Legacy 兜底走少给。」

即：档位读不到时**宁少不多**（与现有 `_legacySlim` 把白板压到 2400/800 同向）。

### R3 · `human_full` 是「真正的 full」，上限极大

> 用户原话（2026-11-08）：「Human full 因为是每百万上下文只投递两到三次，所以我的裁定是不是上限极大？它在每轮开始的时候或者压缩过后给全量信息，是不是就是真正的 full。」
> 用户既有的三时机裁定（代码 `lib/index.js:23953-23955` 逐字引用了它）：
> 「user full 只在三时机注入 —— ① 会话首轮 ② 上下文压缩后 ③ 水位过 25%、50% 后「人说话的下一轮」。其余时候一律 slim。」

⇒ `human_full` **不该有一个与它语义冲突的字符上限**，因为它的低频率本身就是成本控制手段。

---

## 4 · 已实测的事实（**请你复算，不要采信**）

以下数字由上一轮主 Agent 在 **2026-11-08 11:00 左右** 实测。`lib/index.js` 自那之后**未被修改**（`7974d930` 只动 `lib/fact-store.js`），所以数字应可复现。

### 4.1 基线指纹

```
lib/index.js: 2,082,057 B / 28,809 行（纯 CRLF）/ IX(LF 归一化) = 1,543,353 字符
IX sha256 前 16 位（大写）= FC3156244B5D87B9
```

复算：

```bash
cd /d/dsh-auto-memory
git rev-parse --short HEAD   # 期望 7974d930
node -e "const fs=require('fs'),c=require('crypto');const s=fs.readFileSync('lib/index.js','utf8').replace(/\r\n/g,'\n');console.log('bytes='+fs.statSync('lib/index.js').size,'IX='+s.length,'sha16='+c.createHash('sha256').update(s).digest('hex').slice(0,16).toUpperCase())"
```

> 上面这个 `IX length + sha16` 是本仓的跨层漂移锁（`tests/smoke/smoke-test-r26-cross-layer.mjs:819`）。任何改动 `lib/index.js` 的方案都必须重钉它并逐条归因。

### 4.2 规则层规模（真实记忆文件）

记忆文件：`C:/Users/JH Z/.dsh/memory/MEMORY.md`（用户级）+ `C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/MEMORY.md`（项目级）。

| 项 | 值 |
|---|---|
| 抽取出的规则条目 | **182 条**（user 93 / project 89） |
| 其中 `kind==='rule'` | 123 条 |
| 其中 `kind==='note'`（渲染时加「（说明）」前缀） | 59 条 |
| 全文档渲染（`renderRulesSectionPre(groupByLayer:true)`） | **19,825 字符**（user 8,696 / project 10,389 + 告警 327） |
| 摘要渲染（`_renderRulesSlimInline`，单行上限 240） | **13,997 字符** |

> ⚠️ 这 182 条**随记忆增长会变**。2026-11-07 的测量是 187 条。审计时请用**你自己当场测到的数字**，不要用我的。

**关键比例：摘要档 / 全文档 = 13,997 / 19,825 = 70.6%。** 也就是说「摘要」这个手段在当前条目规模下已经失去区分度。

### 4.3 八个档位的实测输出（**核心证据表**）

复算脚本（自包含，直接存成 `%TEMP%/probe-tiers.mjs` 后 `node` 运行；**不要**放进仓库）：

```js
process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e && (e.stack || e.message)); process.exit(9) })
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const ROOT = 'D:/dsh-auto-memory'
const HOME = 'C:/Users/JH Z'
process.env.HOME = HOME; process.env.DSH_HOME = HOME
const SE = await import(pathToFileURL(path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')).href)
const { apply, MemoryEngine } = SE
const iv = globalThis.setInterval, to = globalThis.setTimeout, fe = globalThis.fetch
let engine = null
const load = MemoryEngine.prototype.loadConfigSync
try {
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
  apply({ get: () => undefined, on: () => () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: () => () => {} }, webServer: { register: () => () => {} },
    effect: (f) => { f() } }, {})
} finally {
  globalThis.setInterval = iv; globalThis.setTimeout = to; globalThis.fetch = fe
  MemoryEngine.prototype.loadConfigSync = load
}
const agent = { session: { id: 'audit-probe', header: { cwd: ROOT }, events: [] } }
await engine.refresh(agent)
try { await engine.refreshEventStatePre(agent) } catch (_) {}
const st = engine.state
const setTier = (t) => { try { const rt = engine.stateFor(agent); if (rt) rt._injectTierPre = t } catch (_) {} ; st._injectTierPre = t }
const TIERS = ['human_full','human_slim','run_full','run_slim','post_compact','handoff_carry','legacy','hang_compensate']
console.log('档位              整帧  规则段  whiteboard  事件卡  user-mem  项目笔记')
const out = {}
for (const t of TIERS) {
  setTier(t)
  const text = String(engine.renderMemoryDynamic({}) || '')
  const env = JSON.parse(JSON.stringify(st.envelopeMeta || {}))
  const seg = (k) => { const x = (env.segments || []).find((s) => s.kind === k); return x ? x.chars : 0 }
  out[t] = text
  console.log('  ' + t.padEnd(16) + String(text.length).padStart(6) + String(seg('rules-section')).padStart(7)
    + String(seg('whiteboard-plan')).padStart(11) + String(seg('event-cards')).padStart(7)
    + String(seg('user-memory')).padStart(9) + String(seg('project-notes')).padStart(10))
}
console.log('\n精简帧 renderSlimSnapshotPre = ' + String(engine.renderSlimSnapshotPre(ROOT, agent) || '').length)
console.log('hang_compensate === run_full ? ' + (out['hang_compensate'] === out['run_full']))
```

上一轮的实测输出（**请核对你得到的数是否同量级**）：

| 档位 | 整帧 | 规则段 | 白板 | 事件卡 | user-memory | 项目笔记 |
|---|---|---|---|---|---|---|
| `human_full` | 44,048 | **19,825** | 2,097 | 1,769 | 5,908 | 5,908 |
| `human_slim` | 26,024 | **13,997** | 2,039 | 1,769 | 0 | 0 |
| `run_full` | 24,513 | **13,997** | 2,039 | 1,769 | 0 | 0 |
| `run_slim` | 19,871 | **13,997** | 0 | 0 | 0 | 0 |
| `post_compact` | 43,800 | 19,825 | 2,097 | 1,769 | 5,908 | 5,908 |
| `handoff_carry` | 43,690 | 19,825 | 2,097 | 1,769 | 5,908 | 5,908 |
| `legacy` | 42,179 | 19,825 | 2,097 | 1,769 | 5,908 | 5,908 |
| `hang_compensate` | 24,513 | 13,997 | 2,039 | 1,769 | 0 | 0 |
| **精简帧** | **2,043–2,254** | **0 行** | 0 | 0 | 0 | 0 |

**`hang_compensate` 与 `run_full` 逐字节相同。**

### 4.4 线上真实投递帧（不是模拟，是宿主写进会话日志的原文）

会话文件：`C:/Users/JH Z/.dsh/sessions/--D-dsh-auto-memory--/<sessionId>/session.v4.jsonl.zstd`
存储格式：**每帧一个 zstd frame，一帧一行 JSON**（用 magic `0x28 0xB5 0x2F 0xFD` 切片后逐帧 `zstdDecompressSync`）。
注入文本落在 `user/message` 事件的 `data.content`（字符串或 parts 数组）。

上一轮解码 3 个会话共 140 个投递帧，分类结果：

| 帧类型 | 条数 | 规则段 | 整帧区间 |
|---|---|---|---|
| 全文档帧（`human_full` / `post_compact` / `handoff_carry`） | 21 | **19,651** | 44,824–49,238 |
| 摘要档帧（`run_full` / `human_slim`） | 7 | **14,596** | 25,657–30,116 |
| 精简帧 | 112 | **0 行** | 3,553–3,823 |

⇒ **精简帧**（你的 R1 已实现）占绝大多数；**摘要档帧**是那个 26K 的问题帧，且它的规则段 14,596 **一行没少**。

按提交时间分组（全部会话）：
- `4cdcf928`（2026-11-07，P2b 提示词分层批）**之前**：规则段均值 8,184（n=1,485），整帧 24,652
- **之后**：规则段均值 13,783（n=328，**+68%**），整帧 35,092（+42%）

### 4.5 归因矩阵（规则段字符数）

| 状态 | 条目数 | 全文档 | 摘要@60 | 摘要@240 |
|---|---|---|---|---|
| `4cdcf928^`（改前） | 58 | 7,713 | 4,603 | 5,695 |
| 开 S1 条目化（cap 仍 60） | 187 | 20,326 | 12,941 | 14,447 |
| 当前 HEAD（S1+S2） | 187 | 20,326 | 12,941 | **14,447** |

⇒ **膨胀的主因是条目数 ×3.2，不是截断上限。** 把 cap 从 240 降到 60 只省 7%。

---

## 5 · A 类：12 条待校验断言

逐条给判定 + 你的复算值。**特别注意 A3/A4/A5 这三条，它们是「提案是否必要」的关键依据。**

### A1 · 摘要档的规则段实现的是「摘要」，不是「一行指针」

- 声称：`_renderRulesSlimInline`（`lib/index.js:12397-12450`）把 182 条全部渲染成 `- ` 行，无指针形态。
- 声称：摘要档渲染 13,997 字符，185 行 `- ` 行。
- 待判：你说的行数与字符数是否一致？段内第一行标题是什么？

### A2 · 精简帧的规则段是「一行指针」（R1 的既有实现）

- 声称：`renderSlimSnapshotPre` 输出 **0 条 `- ` 规则行**，只有 `[硬约束] 共 N 条 · 用 memory_rules op=list 取全文`（`lib/index.js:10711`）。
- 待判：`N` 是否 = 123（`kind!=='note'` 的条数）？还是 182？

### A3 · `human_slim` / `run_slim` 两个档在生产中**永远到不了** `renderMemoryDynamic`

- 声称：`decideInjectTierPre` 的调用点（`lib/index.js:23284`）硬编码 `isFull: true`，而档位降级（`:23390`）发生在 `snap` 渲染（`:23361`）**之后**。
- 声称：因此 `INJECT_TIERS` 里为 F2/F4 写的内容规格（`_planSpec` 的核心节白名单、`_rulesFullTierInline` 的摘要）**在生产中只有 `run_slim` 偶然生效**（靠 `decideInjectTierPre` 的 `catch` 兜底返回 `RUN_SLIM`）。
- 待判：请**独立检查**这条。若有办法让 `*_slim` 到达 `renderMemoryDynamic`（例如别的调用点），请指出具体路径。

### A4 · 存在 **8 份**互相不一致的档位白名单

声称分布在 `renderMemoryDynamic` 内的 8 处（行号为基线 `7974d930`）：

| # | 落在哪里 | 行 | 名单 |
|---|---|---|---|
| 1 | `_planSpec.fullTier` | 12350 | human_full, handoff_carry, post_compact |
| 2 | `_rulesFullTierInline` | 12468 | human_full, handoff_carry, post_compact, **legacy** |
| 3 | `_isFullTier`（白板预算） | 12564 | legacy, human_full, handoff_carry, post_compact |
| 4 | `_evFullTier`（证据段放宽） | 13011 | 同 3 |
| 5 | `_planCapFullIdx`（桶限额） | 13183 | 同 3 |
| 6 | `_EVIDENCE_LAYER_TIERS` | 13072 | 同 3 |
| 7 | `_portraitOk`（画像） | 12812 | human_full, **human_slim**, post_compact, handoff_carry |
| 8 | `_SLIM_HUMAN_CTX_TIERS`（精简帧） | 10626 | human_slim, human_full, run_full, post_compact, handoff_carry, legacy, '' |

声称两两比较有 **17 组不一致**，最关键两组：
- `legacy` 在 #2 里「给规则全文」，在 #1 里「不给白板全文」⇒ 同一档两个方向
- `human_slim` 只在 #7/#8 出现 ⇒ 除了「投画像」之外，它和 `run_full` 无差别

待判：**逐一核对这 8 处的实际内容**（不要只看行号，行号可能因你本地状态漂移）。是否存在第 9 处我没找到的？

### A5 · `INJECT_TIERS` 的 JSDoc 契约与实际渲染**方向相反**

- `lib/index.js:1890` 逐字：`/** F4 运行中精简版：规则标题+条数 + 不投白板 */` —— 声称实际渲染 182 行、13,997 字符。
- `lib/index.js:1888` 逐字：`/** F3 运行中完整版：规则全文 + 核心 3 节白板 */` —— 声称实际渲染摘要，**比契约少**。
- `lib/index.js:1897` 逐字：`/** F7 挂机代位补偿：同 F3 内容（完整版），仅触发时机不同 */` —— 声称实际与 `run_full` 逐字节相同（含摘要规则段），即**既不符合 F7 自己的契约，也不符合 F3 的契约**。

待判：这三条是否成立？如果成立，说明「注释写的规格」与「代码做的规格」是两套，且**没有任何断言在检查这件事**。请确认是否真的没有断言（建议 grep `tests/smoke/`）。

### A6 · 规则分项**没有限额**，`injectBudgetChars` 对它完全无效

- 声称：`lib/memory-envelope.js:119-120`：
  ```js
  const limitOf = (b) => { if (b === 'rules') return null }
  ```
- 声称：把 `injectBudgetChars` 从 8000 降到 400，规则段**恒为 13,997 不动**，被丢的是 `recent-logs` / `whiteboard-plan` / `event-cards` / `handoff-ledger`。

待判：复算这条。若成立，请评估「先丢当前工作、保住规约」这个优先级是否符合设计意图。

### A7 · `human_full` 整帧 44K，而 `injectBudgetChars` 只有 8,000

- 声称：总预算 8,000 但实际产出 44,048（**5.5 倍**），`envelope.degradations` 只记一条 `over-budget-total`，内容一个字不砍。
- 声称：因此「注入预算」这个键在当前实现里**不是一个上限**，只是一个「超了会记一笔」的观察点。

待判：这条成立吗？如果是，它与 R3（`human_full` 上限极大 / 真正 full）是**一致**还是**矛盾**？

### A8 · 全文档帧里同一条规约被投了两次

- 声称：`human_full` 同时投 `rules-section`（19,825，从 MEMORY.md 抽取的条目）与 `user-memory`（5,908，MEMORY.md 原文尾部）。
- 声称：93 条用户规约里 **25 条**在这两段里字面重复，约 **1,925 字符**。

待判：复算重复条数与字符数（提示：按摘要行前 20–24 字符做前缀比对即可）。

### A9 · 「超预算线」告警本身被注入进 prompt

- 声称：`lib/rules-layer.js:532-553` 生成的两条告警（「当前 8,696 字符 / 预算 4,000 字符（占 217.4%）…」）被拼进 `text`，随每一帧投递给模型，合计约 **327 字符**。
- 待判：这条成立吗？它是不是「本该只给人看的 UI 信号」？有没有配置可以关掉？

### A10 · `global-brief` 段让渲染**不幂等**

- 声称：`engine.external.briefDetectSyncPre()`（`lib/index.js:19734-19810`）会在内部更新 watermark 并写盘（`:19804-19810`），所以**第 1 次调用返回内容、第 2 次返回空串**。
- 声称：它挂在 `:13221-13227` 的 `segs.push` 上 ⇒ 同一档位连续渲染两帧，第 1 帧含「全局动态」段、第 2 帧不含 ⇒ 长度差约 315。

待判：复算。若成立，请评估它对「同请求两帧必须逐字节相同（宿主整串去重）」这条硬纪律的影响。

### A11 · 注入回调里有 23 个 return、31 个空 catch

- 声称：`ctx.systemPrompt.context({ name: 'dsh:auto-memory-pre' })` 的回调（`lib/index.js:23205` 至 `:24348`，约 1,147 行）内有 **23 个 `return`**、**48 个 `try`**、其中 **31 个是空 catch**，并读写 **31 个 `state` 字段**。
- 待判：复算这些计数。请评估「空 catch 数量」对可观测性的影响（本仓已有多次「ReferenceError 被空 catch 吞掉 ⇒ 功能整体不执行」的历史事故）。

### A12 · 有 15 个套件用「源码抽取」方式测这个渲染函数

- 声称：引用 `renderMemoryDynamic` 的套件共 25 个，其中 **15 个**用 `new Function` / `extractFn` / `grab()` 把函数体从源码里抽出来执行。
- 声称：这些套件因此**不能**引用任何新的模块级符号（否则 `ReferenceError` 被函数自带 catch 吞成假绿）。本仓已有 4 次同款教训（`_T` 常量 / `renderRulesSlimPre` / `truncatePlanBySections` / `_slimRuleCountPre`）。
- 待判：请给出你自己的清单（文件名），与我列的对照：

```
smoke-test-a13-inject-seg-chars      smoke-test-t0-3-budget-ledger
smoke-test-b05-truncation-direction  smoke-test-v4-c1-zones
smoke-test-handoff                   smoke-test-v4-c3-inject-segments
smoke-test-issue349-water-window-cache smoke-test-v4-h3-d-memory-usage
smoke-test-p6a-rules-layer           smoke-test-v4-h5-user-portrait
smoke-test-r26-cross-layer           smoke-test-v5-p4-content-tier
smoke-test-water-pct-tier            smoke-test-v5-p5-tier-plan-real
smoke-test-ws-hint-first-round
```

---

## 6 · B 类：6 个开放问题（需要你的独立判断）

### B1 · 三模块拆分是否是正确的重构粒度？

上一轮主 Agent 的提案是：

```
lib/inject-plan.js     规格表 + decide()     约 120 行   纯函数、零 IO
lib/content-render.js  spec → string         约 350 行   纯函数（原 27 个 pushPart）
lib/inject-cadence.js  31 个 state → 帧决策   约 200 行   纯函数
```

核心思想：**把所有 `_tier === X` 判断从渲染函数移出，换成一张 `ContentSpec` 表传入**。规格用**枚举**而非布尔值：

```js
{ rules: 'none'|'pointer'|'summary'|'full',
  plan: 'none'|'core'|'full',
  events: 'none'|'cards'|'cards+catalog',
  portrait:'none'|'short'|'full',
  evidence:'none'|'full', semantic:'none'|'full', channel:'none'|'full' }
```

请评估：
- 三模块切法对吗？`cadence`（频率）与 `plan`（内容）的边界应该画在哪？
- 规格用枚举 vs 布尔 vs 每段一个函数——哪个更不容易再次退化成「8 份名单」？
- 有没有更小的改动能达到同样效果（例如只把 8 份名单合成 1 个模块级常量对象，仍留在 `index.js` 里）？

### B2 · 如果让 `*_slim` 档真正到达 `renderMemoryDynamic`，会发生什么？

上一轮主 Agent 的实测警示：
- `snap@human_slim = 26,024`，而 `slimText = 2,043` ⇒ **12.7 倍**
- 若 F2 的内容规格真的生效（核心 3 节白板 + 事件卡 + 画像摘要 + semantic-recall + 规则指针），它应该在 3–4K 量级
- 但这意味着 `human_slim` 会与 `slimText` 几乎变成同一份东西 ⇒ **两条线合并，八档模型退化回两档**

请判断：
- 这两条线**应该**合并吗？如果合并，`slimEveryRounds`（8）与档位语义如何共存？
- 如果不合并，「档位到不了全帧渲染器」这个缺陷要不要修？还是应该把 F2/F4 从 `INJECT_TIERS` 里删掉（承认只有 6 档）？

### B3 · 「一行指针」在不同档位下应该是什么形态？

R1 只说了摘要档要指针。请给出你的建议（逐档，给字符量级估计）：

| 档位 | 规则段应为？ | 理由 |
|---|---|---|
| `human_full` | 全文（R3 裁定「真正 full」） | |
| `human_slim` | ？ | |
| `run_full` | ？ | |
| `run_slim` | ？ | |
| `post_compact` | ？ | |
| `handoff_carry` | ？ | |
| `hang_compensate` | ？ | |
| `legacy` | 少给（R2）—— 具体是「摘要」还是「指针」？ | |

### B4 · `human_full` 的「真正 full」具体是多大？

R3 说「上限极大」，但实测 44,048 字符（≈22,000 token）里，规则段 19,825 占 45%。请判断：

- 「真正 full」是否应该**取消** `injectBudgetChars` 对它的约束（现在 8,000 名存实亡）？
- `user-memory`（5,908）+ `project-notes`（5,908）与 `rules-section`（19,825）语义重叠（A8 实测 25 条重复）—— 在 full 档里两者都保留是对的吗？有没有更好的切法（例如 full 档只给规则段、原文按需 `memory_read`）？
- 44K 一帧、每 1M 上下文投 2–3 次 ⇒ 约 66–132K/百万 token。这个成本你认可吗？

### B5 · 修复顺序与风险

上一轮提案是 S0→S5 六步：

| 步骤 | 内容 | 影响面 |
|---|---|---|
| S0 | 摘要档规则段改成指针（R1） | 1 个调用点 `:12474` |
| S1 | 把 brief 检测移出渲染（修 A10） | 1 处 `:13221-13227` |
| S2 | 8 份名单合成 1 张表（仍内联在 `index.js`） | 8 处 → 1 处 |
| S3 | 抽 `lib/inject-plan.js` | 新增模块 + 15 个套件迁移 |
| S4 | 抽 `lib/content-render.js` | 最大一步 |
| S5 | 抽 `lib/inject-cadence.js` | 最大风险（涉及幂等闸） |

请判断：
- 只做 S0+S1+S2 是否足够（能消掉 80% 的混乱）？还是必须做到 S4/S5？
- S3 之后 15 个套件要改成真 `import` 而非源码抽取 —— 这个迁移的**风险**与**收益**你怎么评估？
- 有没有「S2.5」这种中间态更合理？

### B6 · 你发现了什么我没发现的问题？

这一项优先于前面所有项。特别欢迎：
- 我漏掉的档位判断点（除 A4 那 8 处之外）
- 我说的「死代码」其实能通过某条路径到达（尤其 A3）
- 我给的数字与你的复算不符（**请直接指出差异与原因**）
- 提案本身会引入的新问题（例如幂等闸、压缩后强制 full、水位记账这些时序敏感的机制会不会被拆坏）

---

## 7 · 交付格式

请按下面的结构输出（Markdown）。**不要**输出代码补丁。

```markdown
# 审计报告 · <你的名字> · 2026-11-08

## 0. 复算环境
- commit: <git rev-parse --short HEAD 的实测值>
- lib/index.js: <bytes> B / <IX length> 字符 / sha16=<值>
- 规则条目: <你自己测到的条数>（user X / project Y）

## 1. A 类断言判定表

| # | 断言 | 判定 | 我的复算值 / 代码位置 | 备注 |
|---|---|---|---|---|
| A1 | 摘要档是摘要非指针 | 成立/不成立/部分 | 实测 13,9xx 字符 / xx 行 | |
| … | | | | |
| A12 | 15 个套件源码抽取 | … | 实测 N 个：<文件名> | |

> 判「不成立」的必须给出反证（具体文件:行 + 实测数字）。

## 2. B 类判断题

### B1 三模块粒度
<你的结论 + 理由 + 如果你有更好的方案，用伪代码或表格表达>

### B2 … B6
（同上）

## 3. 我发现的额外问题（B6）
| # | 问题 | 证据（文件:行 + 实测） | 严重度 |
|---|---|---|---|

## 4. 最终建议
- 我建议的改动范围：<S0 / S0+S1+S2 / 全套 / 其它>
- 我建议的档位 → 内容规格表（逐档逐段填一遍）
- 我建议**不要**做的事，以及理由
```

### 写作纪律

1. **每条判定必须带「可复算物理量」**（字符数 / 条数 / `文件:行`）。只写「同意」或「合理」的条目，视为未完成。
2. **不确定就写「不确定」并说明缺什么信息**，不要猜。
3. 如果你没有执行环境（例如只能读文件不能跑 node），请在报告开头**显式声明**，并把 A 类改为「源码级核验」（给代码位置 + 你从代码读出的结论），不要伪造实测数字。
4. **优先回答 B6 与 A3/A4/A5** —— 那四项决定这个重构提案是否必要、以及边界画在哪。

---

## 附录 · 已确认的代码位置索引（基线 `7974d930`）

| 行 | 内容 |
|---|---|
| 1873–1899 | `INJECT_TIERS` 枚举 + 各档 JSDoc（**契约所在**） |
| 1902 | `isHumanTierPre` |
| 1921 | `isPlanFullTierPre` |
| 1924 | `shouldInjectPlanPre` |
| 1947–1952 | `isRulesFullTierPre`（模块级，**零生产消费**） |
| 1969 | `PLAN_CORE_SECTIONS`（7 节白名单） |
| 1988–1997 | `decideHangCompensatePre`（F7 纯函数） |
| 2013–2075 | `renderRulesSlimPre`（模块级摘要渲染器，与内联版必须逐字一致） |
| 2097–2106 | `decideInjectTierPre` |
| 2116–2121 | `planSpecForTierPre` |
| 10510–10732 | `renderSlimSnapshotPre`（**精简帧**，252 行） |
| 10711 | `[硬约束] 共 N 条 · 用 memory_rules op=list 取全文`（R1 的既有实现） |
| 12190–12334 | `renderMemoryDynamic` 开头（state 取法 / wsHint / budget） |
| 12336–12355 | `_tier` 解析 + `_planSpec`（名单 #1） |
| 12397–12450 | `_renderRulesSlimInline`（摘要渲染） |
| 12468–12482 | `_rulesFullTierInline` + 规则段裁剪调用点（**S0 的落点**） |
| 12536–12597 | `_legacySlim` / `_fullTierBudget` / `_isFullTier`（名单 #3）/ 白板节白名单 |
| 12702–12709 | `_evCardsOk`（run_slim 不投事件卡） |
| 12763–12788 | semantic-recall 正向名单 |
| 12812–12814 | `_portraitOk`（名单 #7） |
| 12987 | `const sub = ...`（预算分片） |
| 13011–13015 | `_evFullTier`（名单 #4）+ `subEv` |
| 13052 | `SANITIZE_NO_CAP` |
| 13072–13077 | `_EVIDENCE_LAYER_TIERS`（名单 #6）+ user-memory / project-notes |
| 13160–13203 | inscription / frame-tail / budgetChars / planCap / `memRefLimit` / otherLimit |
| 13207–13227 | 团队段 + global-brief 段（**A10 落点**） |
| 13265–13305 | `composeMemoryEnvelopePre` 调用 + `envelopeMeta` 落 state |
| 19734–19810 | `briefDetectSyncPre`（**有副作用**，与 A10 相关） |
| 23205 | `ctx.systemPrompt.context({ name: 'dsh:auto-memory-pre' })` 回调起点 |
| 23268–23358 | 档位判定（`isFull: true` 在 `:23284`，写入在 `:23358`） |
| 23361 | `const snap = engine.renderMemoryDynamic(context)` |
| 23383–23394 | 档位降级为 `*_slim` + `slimText` |
| 23401–23412 | `finalizePre`（请求级定稿） |
| 23502–23513 | `_stepSeq` 推进（节奏计数） |
| 23534–23553 | F1 水位判定 |
| 23761–23767 | 冷启动骨架帧 |
| 23822–23849 | F7 挂机补偿累计判定 |
| 23869–23884 | F1 水位授予旁路 |
| 23890–23900 | F7 授予旁路 |
| 23930–23933 | `_fullGapOk` / `byThreshold` |
| 23951–23975 | H2/H3：真人**不再**是授予理由（**R3 的代码依据**） |
| 23990–24072 | 授予分支（`_grantByHuman = false` 在 `:23991`） |
| 24142–24278 | 间隔满足 / 暂缓放行 / 精简节流（**A6 的观察点**） |
| 24280–24345 | 三处「未获授 ⇒ 精简版」兜底 |

---

**报告完成后请直接返回正文，不要保存文件到仓库。**
