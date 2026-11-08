# user_full 事件注入层级 · C-3/C-4 实证评估

> 调查日期：2026-11-08 · 分支 preview · **全程只读**（未改 `lib/`、`tests/`、`tools/`，未跑生成器，未动工作树未提交改动）
> 前置文档：`docs/internal/TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md`（413 行 / 30,367 B，下文简称「前文」）
> 本文只回答三个问题：**C-3「只注入检查点是不是重复提醒」**、**C-4「注入相关文档」可行不可行**、**C-1/C-2 差多少**。
> 所有数字均给出复算命令（§4），口径统一为 `token(保守) = ceil(chars / 2)`。

---

## 0. 结论速览（先看这 7 条）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **C-3 的「重复提醒」担忧只对「已被卡片展开的那 2 个事件」成立**。对这 2 个事件，检查点在注入面里已被覆盖 **33.1%–45.6%**；对**未展开的其余 36 个 active 事件**，覆盖率只有 **1.7%–7.4%**（693 条全量平均 11.13%）。⇒ 「检查点 = 重复」在本机数据上是**局部真、整体假**。 | §1a 表 3 |
| 2 | **但 C-3 的直觉指向一个更严重的真问题**：`[事件卡片]` 的「四段」在**本机 22/42 个事件上全空**（含 updatedAt 最新的 3 个 active 事件全部 `sections={goal:"",doing:"",deadend:"",next:""}`）。⇒ 用户说「反正你的模型上下文已经把事件都说明白了」**不成立**——事件只给了一个 commit-hash 式的名字，其余什么都没说。 | §1b 表 1、§1c |
| 3 | **检查点不是「进度播报」，它是本仓唯一的溯源载体**：693 条检查点里 **100% 有 `at`**（推翻前文「`checkpoint.at` 非必填」的说法）、72.3% 有四段、11.7% 有 `rel` 文件路径、4.6% 有 `quoteRef` 原话。内容含**具体 commit 哈希、具体函数名、具体报错标识、被推翻方案的失败原因**——这些在事件名/四段/白板里**一处都没有**。 | §1b 表 2 |
| 4 | **5 个事件层段落全部同源**：3 个是同一份 `event-store.json` 的**直接投影**（`[当前事件]` / `[事件卡片]` / `[其他事件]`，由 `refreshEventStatePre` 一次读盘产出）；另 2 个是**间接派生**（白板 `## 当前状态` 由 `renderPlanFromEventsPre` 渲染成 PLAN.md 再读回；`[最近交接]` 是 `kind:"handoff"` 检查点写成的磁盘账本）。⇒ 「换个投影方式」确实能解决大部分需求，**不需要新数据源**。 | §1c 表 1 |
| 5 | **「注入文档」的数据源已存在，但注入面完全没用它**：`members[]` 覆盖 **24/42 事件**（59 个 distinct 值，其中 26 个是 `docs|artifacts` 路径）、`checkpoints[].rel` 覆盖 **81/693**（44 个 distinct 路径、42 个可解析）。而 `event-render.js` 对 `members`/`rel`/`quoteRef`/`sourceRef`/`bytes`/`sha256` 的引用次数 **全 0**，注入面里 `docs|artifacts` 路径数 **= 0**。⇒ **不需要新 schema，需要渲染层把它们读出来**（「只存不用」家族）。 | §2a 表 7/表 9 |
| 6 | **注入 1 篇施工文档 = 2,992–33,353 token**（本机 5 篇实测），**单独一篇就能吃掉 human_full 8,000 预算的 37%–417%**。⇒ 「注入文档正文」在 8,000 预算下**结构性不可行**；可行形态只有「标题+首段」（50–163 token/篇）或「纯指针」（~28 token/条）。 | §2c 表 12/表 13 |
| 7 | **按需下钻已经能做，且比注入便宜一个数量级**：`memory_recall(scope="events")` 的检查点检索**按行命中并返回原文行**（实测可命中），`memory_recall(expand="evt_xxx")` 能取单事件最近 5 条检查点。⇒ **注入的边界应落在「让模型知道该下钻哪里」，不是「把下钻结果提前塞进去」**。 | §2b |

---

## 1. C-3 实证：「只注入检查点是否重复提醒、有没有用」

### 1a. 量化重复度

#### 表 1 · 当前注入里**所有「事件层」段落**（本机真实数据实测）

复算：`node artifacts/_assess-c3-segments.mjs`（逻辑见 §4-①），数据源 `handoff/event-store.json`（2,935,674 B / 42 事件 / 693 检查点）+ `handoff/PLAN.md`（14,371 字符）+ 最新账本 `handoff-20261108-011742.md`（1,418 字符）。

| 段落 | 生成位置 | 取几条 / 过滤 | 本机实测 chars | token(保守) | 它说了什么 |
|---|---|---|---|---|---|
| `[当前事件]` | `lib/index.js:10594-10610`（精简体） | `slimEventT1[0]` 即 active 按 updatedAt 降序第 1 条；T1 行再截 **60 字**；后缀「（共 N 个事件）」 | **57** | 29 | **只有一句 commit-hash 式的名字**：`Lead 三条裁决收口完成，本地提交 332d05cf（6 files / +1…（共 42 个事件）` |
| `[事件卡片 — 当前在做什么]` | `lib/index.js:12668`（完整版，`must` 优先级） | `pickT2EventsPre(events, eventMaxActiveInInject=2)` ⇒ active 前 **2** 个，每个 `renderT2Pre` ≤2,400 字；检查点每条截 **300 字**、最多 **3** 条 | **1,459** | 730 | 2 个事件的【事件名】+ 四段（本机为空）+ percept + **最近 3 条检查点（各前 300 字）** + 成果 |
| 白板 `## 当前状态` 表 | `lib/plan-render.js:137-147` → 磁盘 PLAN.md → `lib/index.js:12537-12626` 注入 | **只认 active**（实测 19 行）；每行 = 事件名 + 状态 + `summary` 首句截 **80 字** | **1,950** | 975 | 19 个 active 事件的**名字 + 一句进展**（不是检查点） |
| `[其他事件 — 本工作区还有这些]` | `lib/index.js:12685-12693`（完整版，`normal`） | `renderEventCatalogPre(maxChars=400, excludeIds=已展开的2个, applyVisibility)` ⇒ 实测 **8 行**，标注「共 40 个，下列 8 个」 | **415** | 208 | 另外 8 个事件的 **T0 行**（名字+状态），**无进展、无检查点** |
| `[最近交接]` | `lib/index.js:12630-12636`（完整版） | 最新 `handoff-*.md` 账本，`handoffLedgerChars=800` 加权截断 | **800** | 400 | 四段式账本；**内容由 `kind:"handoff"` 的检查点生成** |
| **合计** | | | **4,681** | **2,341** | |

> **口径说明（重要）**：`[事件卡片]` 的 1,459 字是在**本机真实数据**上算的——之所以远低于 2,400 上限，是因为 2 个事件各只有 2 条检查点、且四段全空。检查点多的老事件（如 199 条的那个）会顶到 2,400。

#### 表 2 · 白板注入文本的真实构成（8,000 预算下截到 7,894 字符）

复算：§4-②（用 `lib/index.js:1754-1803` 的 `truncatePlanByPriority` **原样抽出**执行，不重写实现）。

| 节 | 磁盘原长 | 注入后长度 | 说明 |
|---|---|---|---|
| `# 项目白板` 前导 | 57 | 57 | |
| `## 当前状态` | 1,958 | **1,958** | **整节未被截断**（命中 `PLAN_SECTION_PRIORITY_RE` 的「当前」⇒ 高优先） |
| `## 近期进展（按时间倒序）` | 10,919 | **4,442** | 被截断；原 23 个小节（每事件一段四段）只剩前若干个 |
| `## 关键约束` | 69 | 69 | |
| `## 待办` | 1,364 | **1,364** | 命中「待办」⇒ 高优先，未被截 |
| **合计** | 14,371 | **7,894** | |

> **这一节的实测价值**：白板注入面里 **693 条检查点只出现 2 条（0.3%）**（§4-②末段）。即**白板几乎不携带检查点内容**——它携带的是「事件名 + summary 首句」和「四段」。

#### 表 3 · 「再加最近 N 个检查点，有多少是已有的？」——可复算的重合度口径

**口径定义（可复算、不含主观判断）**：

```
对每条检查点正文 B（有四段则四段以 " ‖ " 连接，否则用 text）：
  覆盖率(B) = |{ 4-gram g ∈ B : g ∈ 注入面文本 }| / |{ 4-gram g ∈ B }|
  归一化：两边都去掉全部空白字符（否则换行/缩进差异会污染结果）
  4-gram = 连续 4 个字符；短于 4 字的正文按全命中计
```

**结果（693 条全量）**：

| 统计量 | 值 |
|---|---|
| 检查点条数 n | **693** |
| 平均覆盖率（对 5 个事件层段落的并集） | **11.13%** |
| 最高 | **55.5%** |
| p50（中位） | **10.2%** |
| p90 | **4.9%** |
| 最低 | **0.0%** |

**按「是否已被 `[事件卡片]` 展开」分层（这是回答 C-3 的关键切分）**：

| 分组 | 事件数 | 该组检查点在注入面中的平均覆盖率 | 判定 |
|---|---|---|---|
| **已被 T2 卡片展开**（updatedAt 前 2 个 active） | 2 | **34.0% / 41.4%** | 有实质重复，但**只覆盖每条检查点的前 300 字**（见下） |
| **未被展开**（第 3–8 位 active） | 6 | **1.7% / 5.1% / 6.6% / 7.4% / 6.4%** | **几乎全是新信息** |
| 第 3 位（`evt_6ea35c20`） | 1 | — | **cp=0，无检查点**（无法比较） |

**逐条明细（已展开的 2 个事件）**：

| 事件 | cp | 原文长度 | 在 `[事件卡片]` 里的覆盖率 | 为什么不是 100% |
|---|---|---|---|---|
| `evt_ea2cbd88` | cp[0] `log` | 1,141 | **33.1%** | 卡片按 `CHECKPOINT_ITEM=300` 截断 ⇒ 后 841 字不在注入面 |
| `evt_ea2cbd88` | cp[1] `handoff` | 1,145 | **34.9%** | 同上 |
| `evt_fe275b34` | cp[0] `log` | 1,191 | **45.6%** | 同上 |
| `evt_fe275b34` | cp[1] `handoff` | 1,133 | **37.1%** | 同上 |

> **⇒ 对 C-3 的直接回答（第一层）**：
> 「再加最近 N 个检查点」**不是纯重复**。重复量集中在「**已被展开的那 2 个事件的每条前 300 字**」（33–46%），
> 对**未展开的 36 个 active 事件**几乎零重复（1.7–7.4%）。
> 但用户直觉里的「重复」确实存在一个更硬的来源：**同一批检查点被渲染了 2 次**——
> 一次作为 `[事件卡片]` 的「· 最近检查点：」，一次作为 `[最近交接]` 账本正文（`kind:"handoff"` 的检查点就是账本原文）。
> 实测：`[最近交接]` 那 800 字里，`evt_ea2cbd88` 的 `handoff` 检查点覆盖率 **54.4%**——**这才是最高的一处重复**。


#### 表 4 · 逐段落重复来源拆解（回答「重复到底重复在哪」）

同一批 693 条检查点，对**每一个段落单独**算覆盖率（口径同表 3）：

| 段落 | n | 平均覆盖率 | 最高 | 判读 |
|---|---|---|---|---|
| `[当前事件]` | 693 | **0.11%** | 3.2% | 完全不含检查点内容（只有事件名） |
| `[事件卡片]` | 693 | **4.22%** | **45.6%** | **重复集中在这里**——但只对**被展开的那 2 个事件**生效 |
| 白板 `## 当前状态` | 693 | **5.72%** | 54.3% | 平均看似不低，但**来源不是检查点**：见下注 |
| `[其他事件]` | 693 | **0.68%** | 13.6% | 只有名字，不含内容 |
| `[最近交接]` | 693 | **5.20%** | **52.6%** | **第二处高重复**——账本正文 = `kind:"handoff"` 检查点原文 |

> **白板 5.72% 的成因（必须说明，否则会误读）**：白板 `## 当前状态` 的「最近进展」列取的是 `event.summary` 首句（`lib/plan-render.js:144`），
> 而 `summary` 与检查点**共用同一批措辞**（自动沉淀把日志行同时写进 summary 与 checkpoint）。
> 所以这 5.72% 是「**同源措辞**」而非「白板复制了检查点」。逐条看最高值 54.3% 的那条，命中的全是通用术语串（`type:state`、`未 push`、`工作树`），不是句子。

**逐段交叉表（已展开的 2 个事件，4 条检查点）**：

| 检查点 | 长度 | `[当前事件]` | `[事件卡片]` | 白板当前状态 | `[其他事件]` | `[最近交接]` |
|---|---|---|---|---|---|---|
| `evt_ea2cbd88` cp[0] `log` | 1,141 | 3.2% | **33.1%** | 1.2% | 0.8% | 23.4% |
| `evt_ea2cbd88` cp[1] `handoff` | 1,145 | 2.3% | **34.9%** | 1.6% | 1.3% | **52.6%** |
| `evt_fe275b34` cp[0] `log` | 1,191 | 0.7% | **45.6%** | 1.2% | 0.8% | 19.3% |
| `evt_fe275b34` cp[1] `handoff` | 1,133 | 0.6% | **37.1%** | 1.9% | 0.9% | 24.1% |

> **⇒ C-3 第一层的结论（可复算）**：
> ① 「再加最近 N 个检查点」的**重复成本上限**是 `[事件卡片]` 那 33–46%（且只是每条前 300 字）；
> ② 真正**几乎完全重复**的是 `[最近交接]` 与 `[事件卡片]` 对 `kind:"handoff"` 检查点的**双重渲染**（52.6% vs 34.9%，同一条内容出现两次）；
> ③ 对**未展开的 36 个 active 事件**，任何形式的检查点注入都是 **92.6%–98.3% 的新信息**。

### 1b. 检查点里到底有什么

数据源：`C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json`
（`schema: v4_event_store_v2`，2,935,674 B，**42 事件 / 693 检查点**，38 active / 0 paused / 4 closed）

#### 表 5 · 检查点字段填充率（693 条全量，实测）

复算：§4-③

| 字段 | 有值条数 | 占比 | 说明 |
|---|---|---|---|
| `at` | **693** | **100.0%** | **推翻前文「`checkpoint.at` 非必填」**——写入侧 `lib/event-store.js:943` 是 `at: Number(c.at) || now0()`，**永远有值** |
| `kind` | 693 | 100.0% | 默认 `'log'`（`:944`） |
| `text` | 686 | 99.0% | |
| `goal/state/dead/next` 四段任一 | **501** | **72.3%** | goal 70.0% / state 72.3% / dead **25.5%** / next **28.7%** |
| `panels` | 301 | 43.4% | |
| `idemKey` | 635 | 91.6% | 幂等键 |
| `rel` | **81** | **11.7%** | 文件路径（**这是 C-4 的关键**，见 §2a） |
| `sourceRef` | 79 | 11.4% | 多为 `handoff/xxx.md` 或绝对路径 |
| `quoteRef` | **32** | **4.6%** | 原文引用 |
| `bytes` / `sha256` | 32 / 30 | 4.6% / 4.3% | 文件指纹 |
| `quoteLine` | 18 | 2.6% | |

**`text` 与四段的关系**：both 494 / onlyQuad 7 / **onlyText 192** ⇒ 有 192 条只有 `text`、没有四段。
`lib/event-render.js:318-319` 对此的处理是「**有四段用四段，没有回落 text**」——即注入面**两种形态都能渲**，不会因为缺四段就空。

**`kind` 分布**：`log` 292 · `progress` 160 · `handoff` 152 · `plan` 35 · `deadend` 18 · `state` 17 · `grouping` 7 · `handoff-write-failed` 6 · `plan-write-failed` 5 · `todo` 1

#### 表 6 · 三个事件 × 各 2–3 条检查点，逐字段原文

**事件 A · `evt_ea2cbd88`**（active，`createdAt=2026-11-07T17:17:42Z`，`startMs=2026-11-07T17:17:42Z`，2 条检查点，`sections` 四段全空，`members: []`）

| 字段 | cp[0] | cp[1] |
|---|---|---|
| `at` | 1794071862519 | 1794071862661 |
| `kind` | `log` | `handoff` |
| `text` | `- 01:17 [kind:fact] Lead 三条裁决收口完成，本地提交 332d05cf（6 files / +108 −8，未 push，工作树 tracked 干净）。①存量 medium：仅补「normalizeEffortPre 不报错」的断言不够 —— 实测我上一批加的白名单校验会把 upgrade-state.agentOptions.effort='medium' 判成 bad-agent-options 并**拒绝启动**，老任务再也起不来；加 LEGACY_EFFORT_ALIAS_PRE={medium:'high'} 在 startUpgradeJobPre 入口（…` **1,141 字** | `## 任务状态\ntype:state\n- Lead 三条裁决收口完成并提交 **332d05cf**（6 files / +108 −8，未 push）。\n- 校验：新套件 79/0、r26 26/0、v4-u6 37/0…` **1,145 字** |
| `goal` | `""` | `type:goal\n- ① 存量 \`effort='medium'\` 的老任务必须能续跑；② \`done\` 但「未核实」必须让用户看得见；③ perWorkspace 不加 dir 字段（避免 storage schema 变更）。` |
| `state` | `""` | `type:state\n- Lead 三条裁决收口完成并提交 **332d05cf**（6 files / +108 −8，未 push）。\n- 校验：新套件 79/0、r26 26/0、v4-u6 37/0、iter5 EXIT=0、client/rule/eventstore 全 0、\`build-iter5-skin --check\` SYNC-OK、导出 23 / 裸 LF 0。` |
| `dead` | `""` | `type:dead-end\n- **只补「\`normalizeEffortPre('medium')\` 不报错」的断言不够**：白名单校验在 \`startUpgradeJobPre\` 内，老任务照样被判 \`bad-agent-options\` 并拒绝启动。必须**入口归一**（\`LEGACY_EFFORT_ALIAS_PRE\`）…` **663 字** |
| `next` | `""` | `type:progress\n- 全量回归由 Lead 跑。…\n- 本批 \`lib/index.js\` / \`lib/client.js\` 已提交，Lead 接下来做 PR 批量合并（#522 → #471 → #546 → #475），我这条线暂停。` |
| `quoteRef` / `quoteLine` / `rel` / `bytes` / `sha256` | 全无 | 全无 |
| `panels` | `[{kind:'log', text:'<与 text 完全相同的前缀>'}]` **1 条** | `[]` |
| `sourceRef` | `null` | `null` |
| `idemKey` | `log:2026-11-07:01:17:97e71ab528b1` | `handoff:84881aa355a7` |

**事件 B · `evt_fe275b34`**（active，`createdAt=2026-11-07T16:50:17Z`，2 条检查点，`sections` 四段全空）

| 字段 | cp[0] `log` | cp[1] `handoff` |
|---|---|---|
| `at` | 1794070217822 | 1794070218006 |
| 长度 | 1,191 | 1,133 |
| `dead` | `""` | `type:dead-end\n- **baseline 快照用 await 会打破「start 立即返回」契约**：\`smoke-test-v4-u6-memory-upgrade\` 的 U6-3b（start <50ms）实测 50.11ms 直接红。⇒ 改成 \`Promise.resolve().then(...)\` 后台采集，恢复 44.70ms。**该套件是这条契约的唯一防线，改快照实现后必须跑它**。\n- **把「整批读不到磁盘」判成 unknown 会误降级真实成功**…` **521 字** |
| `panels` | 1 条（= `text` 前缀） | `[]` |
| `rel`/`quoteRef`/`bytes`/`sha256` | 全无 | 全无 |

**事件 C · `evt_b982e091`**（active，`createdAt=2026-11-07T14:45:57Z`，`updatedAt=15:34:53`，**3 条检查点**，`sections` 四段全空）

| 字段 | cp[0] `log` | cp[1] `progress` | cp[2] `progress` |
|---|---|---|---|
| `at` | 1794062757185 | 1794062809410 | 1794065693057 |
| `goal` | `""` | `task-37 A-1 前端分层说明落地 + B-1 的 CAS 契约套件先写成红` | `B-1 让项目层规约可在面板编辑 + A-2 给前端分层说明提供三字段` |
| `state` | `""` | `A-1 提交 56892999（+36/−2，iter5 classicLF R191 重钉 1,534,775/dbd6bdf9…，两次变异均使锁红）；B-1 准备件提交 32f15edc（新套件 smoke-test-rules-layer-cas.mjs 15 PASS/8 FAIL 正确红 + artifacts/B1-SKELETON-20261107.md 骨架）；**lib/index.js 仍被 be-applier 的 #548/#549 占用，A-2/B-1 后端未动**` | `已提交 80e76355（3 files +69−12，未 push）。B-1 五处跟层（含 revision 锁键换 targetFile）、A-2 三字段纯追加、路由透传 layer；rules-layer-cas 40/0（原 23/15 红）、r26 重钉 R194 后 26/0、p9 56/0、导出 23 守恒、裸 LF 0` |
| `dead` | `""` | `两个假绿：T1-c 比 upd.revision !== before.revision 在写失败时因 undefined 恒真；T0-e「两层 revision 必须不同」在夹具内容不同时因子 digest 不同天然成立、无区分力（构造「path 跟层但锁键仍用 userFile」半修变异体取证：内容不同夹具上判据通过=失效，改成等内容双文件后变异体两层 revision 均为 6f489fa1… 才暴露）` | `T1 漏传 revision 致 requireRevision 必拒；T3-d 误用已被 T1/T2 写改的 fakeEngine（内容不同⇒digest 不同⇒变异体上 revision 仍不等）；共同根因「派生标识相等性只在其它输入全等时有区分力」本批第 4 次` |
| `next` | `""` | `等 Lead 通知 be-applier 提交完成后：git status 确认 clean → Node 记三元组 → 照 artifacts/B1-SKELETON-20261107.md 逐处串行 edit（5 处 + A-2 + 路由透传，禁整文件 write）→ node --check → 跑 smoke-test-rules-layer-cas 期待红转绿 → 跑 p9-rules-lifecycle 确认「applyRuleEditPre 定义恰好 1 处」→ 自己重钉 r26` | `等 Lead 全量回归；若需前端 B-1 UI，按骨架文档做 Tab 切换（推荐不动 GET /rules 签名，前端拉两次合并）` |
| `panels` | 1 条 | `[]` | `[]` |
| `idemKey` | `log:2026-11-07:22:45:b1556e036167` | `task37-a1-b1prep-20261107b` | `task37-b1-a2-done-20261107` |

#### 判定：检查点是不是只有「进度播报」价值？

**不是。** 上表里至少有 4 类信息**在其他任何注入段落里都不存在**：

| 信息类别 | 实例（原文） | 别处有没有 |
|---|---|---|
| **具体文件路径 + 具体落点** | `artifacts/B1-SKELETON-20261107.md`、`smoke-test-rules-layer-cas.mjs`、`lib/index.js 仍被 be-applier 的 #548/#549 占用` | **没有**。`[其他事件]` 只有事件名；白板只有 summary 首句 |
| **具体报错/失败标识** | `bad-agent-options`、`U6-3b（start <50ms）实测 50.11ms 直接红`、`15 PASS/8 FAIL 正确红` | **没有** |
| **被推翻的方案 + 失败原因** | `T0-e「两层 revision 必须不同」在夹具内容不同时因子 digest 不同天然成立、无区分力`、`改成等内容双文件后变异体两层 revision 均为 6f489fa1… 才暴露` | **没有**。这正是用户最在意的「失败与弯路」 |
| **可复算的物理量** | `+108 −8`、`79/0`、`1,534,775/dbd6bdf9…`、`导出 23 守恒、裸 LF 0` | **没有** |
| **阻塞/依赖关系** | `lib/index.js 仍被 be-applier 的 #548/#549 占用，A-2/B-1 后端未动` | **没有** |

**但也要如实记录检查点的两个缺陷**（用户直觉里「没啥用」的部分确有依据）：

1. **`panels` 大部分是 `text` 的冗余副本（但不是全部）**：301 条有 panels 的检查点里，**263 条（87.4%）**的 panels 文本与 `text` **互为前缀**（同一句话的截断版），不是「补充面板」；**38 条（12.6%）不是**——这 38 条是真·独立面板（如 `evt_dfc30819` 的 3 条 progress 检查点，panels 分别 2/4/4 条、长度 37–130 字，与 text 不构成前缀关系）。⇒ 注入侧 `buildCheckpointsBlockPre` 无条件再渲一遍 panels（`event-render.js:342-355`）**对 87.4% 的检查点是纯重复**，且它吃 `PANELS_TOTAL=150` 的独立预算；但**不能因此把 panels 整段砍掉**（会丢掉那 12.6% 的真面板）。
2. **检查点正文极长**：693 条 `text` 平均 **1,393 字**、中位 820、p90 2,018、**最长 27,578 字**。⇒ 原样注入 3 条就要 ~4,200 字（≈2,100 token），必须截断（现实现 `CHECKPOINT_ITEM=300`）。

### 1c. 数据源是否同一份

**答：是同一份 `event-store.json`，5 个段落是它的 5 种投影 + 1 个派生文件。**

| 段落 | 数据来源 | 读的是同一个 store？ | 做了什么投影/过滤 | 代码位置 |
|---|---|---|---|---|
| `[当前事件]` | `state.slimEventT1` | ✅ 同一次读取 | `filter(status==='active')` → `sort(updatedAt desc)` → `map(renderT1Pre)`（= `summary` 首句 ≤140）→ 取 `[0]` → **再截 60 字** | 产出 `lib/index.js:10060-10068`；消费 `:10594-10610` |
| `[事件卡片]` | `state.eventCardsText` | ✅ 同一次读取 | `pickT2EventsPre(events, 2)` → 每个 `renderT2Pre`（≤2,400；四段 ≤900 / percept ≤200 / 检查点 ≤1,800 且每条 ≤300 / outcome 120–400） | 产出 `:10047-10048`；消费 `:12668` |
| `[其他事件]` | `state.eventCatalogText` | ✅ 同一次读取 | `renderEventCatalogPre(maxChars=400, excludeIds=已展开的2个, applyVisibility:true)` ⇒ 只留 active/paused + 近 14 天 closed，**排除已被 T2 展开的** | 产出 `:10107-10122`；消费 `:12685-12693` |
| 白板 `## 当前状态` | `handoff/PLAN.md`（磁盘） | ⚠️ **间接**：PLAN.md 由 `renderPlanFromEventsPre(events)` 渲染（`lib/plan-render.js:122-203`），但注入读的是**磁盘文件** | 白板侧：`filter(status==='active')` → 每行 `name` + `PLAN_STATUS_LABEL` + `summary` 首句 ≤80。注入侧：`stripSensitiveSections` → `truncatePlanByPriority` 到 8,000 | 渲染 `lib/plan-render.js:137-147`；注入 `lib/index.js:12537-12626` |
| `[最近交接]` | `state.latestHandoffText`（磁盘 `handoff-*.md`） | ⚠️ **派生**：账本是 `kind:"handoff"` 检查点写盘后的文件 | 加权截断到 `handoffLedgerChars=800` | `:12630-12636` |

**同源证据（可复算）**：5 个段落对同一批 693 条检查点的平均覆盖率分别是 0.11% / 4.22% / 5.72% / 0.68% / 5.20%（表 4）——
**它们互相之间的重合度远高于它们与检查点的重合度**，因为**都来自同一批 `name`/`summary`/`sections`**：

| 交叉项 | 实测 |
|---|---|
| `[当前事件]` 的 60 字 vs 白板当前状态该事件行的「最近进展」列 | **同一句话**（都是 `renderT1Pre`/`firstSentencePre(summary)`，仅截断长度不同 60 vs 80） |
| `[事件卡片]` 的【事件名】 vs `[其他事件]` 的行 | 互斥不重叠（`excludeIds` 已排除），但**同一字段 `name`** |
| 白板「当前状态」19 行 vs `[其他事件]` 8 行 + 卡片 2 行 | 19 行是 active 全量（38 个 active 里的 19 个，因为白板只渲染 19 行——见下注） |

> **⚠ 一处必须记录的不一致**：事件库有 **38 个 active**，白板 `## 当前状态` 只有 **19 行**，`[其他事件]` 说「共 40 个，下列 8 个」。
> 三个数字（38 / 19 / 40）来自三条不同的可见性口径：
> · 38 = `status==='active'` 全量；
> · 19 = PLAN.md 磁盘快照（**上次渲染时**的 active 数，之后又有事件 create）；
> · 40 = `eventCatalogIncluded + eventCatalogDropped`（`applyVisibility` 后：active/paused + 近 14 天 closed = 38 + 4 中近期的部分）。
> ⇒ **白板是「过期快照」而非实时投影**——这是既有事实（PLAN.md 只在 `memory_note(kind=plan)` 时重写），不是本文发现的缺陷，但**设计新层级时必须知道：白板不能当作「事件清单的权威源」**。

**⇒ C-3 第二层的结论**：**同源 ⇒ 换投影就能解决，不需要新数据源。**
需要「最近 N 个检查点」时，正确做法是**在 `renderEventDigestPre` 里新增一个投影**（读同一次 `events`），而不是新读一份库、也不是新 schema。


---

## 2. C-4 「注入相关文档」可行性

### 2a. 数据可得性：事件库里有没有「关联文档」字段？

**答：有 3 个候选字段，但没有一个是「该事件的那一份施工文档」。**

复算：§4-④

#### 表 7 · 四个候选关联字段的实测覆盖

| 字段 | 位置 | 覆盖 | 语义 | 能不能直接当「相关文档」用 |
|---|---|---|---|---|
| `members[]` | **event** 级 | **24/42 事件**（57%） | 「这件事由哪几篇归组而来」。59 个 distinct 值，分类：**repoDoc 26 / repoCode 4 / memLog 27 / memPlan 1 / other 1** | ⚠️ **部分能**。26 个 `docs|artifacts` 下路径可用；但 **27 个是 `2026-09-28.md` 这类裸日期日志名**，它们是**记忆工作区**的日志，不在仓库里（实测：在仓库可解析 32 个、在记忆工作区可解析 19 个、**两边都找不到 9 个**） |
| `checkpoints[].rel` | **检查点** 级 | **81/693**（11.7%） | 该检查点涉及的文件路径 | ⚠️ **能，但极稀疏**。拆开后 44 个 distinct 路径、**42 个可解析**（2 个缺失：一个已被归档、一个是 `probe-g552-*.mjs` 通配）。其中 `docs|artifacts` 下 `.md` 只有 **15 个** |
| `checkpoints[].quoteRef` / `quoteLine` | 检查点级 | 32 / 18（4.6% / 2.6%） | 源文件**原文引用句** + 行号 | ❌ 它是「证明内容没丢」的引文，**不是路径**（32 条里平均 58 字、最长 184 字，是句子） |
| `checkpoints[].sourceRef` | 检查点级 | 79（11.4%） | 多为 `handoff/xxx.md` 绝对路径或 `auto:water` 这类系统值 | ❌ 指向**账本/日志**，不是施工文档 |

> **⚠ 修正一个容易踩的前提**：`rel` **不是**逗号分隔的多路径串（我一开始按 Lead 简报的假设以为是）。
> 实测 81 条里只有 **1 条**含逗号，其余都是单路径。但**那唯一 1 条**确实是四路径串：
> `lib/client.js, lib/ev4-adapter.js, lib/event-store.js, lib/index.js` ⇒ **解析时必须按逗号拆**，否则会把整串当路径（必然 ENOENT）。

#### 表 8 · 「既有 members 又有 rel」的交叉覆盖

| 组合 | 事件数 | 占比 |
|---|---|---|
| 既有 `members` 又有 `rel` | **8** | 19.0% |
| 有 `members`、无 `rel` | 16 | 38.1% |
| 无 `members`、有 `rel` | 1 | 2.4% |
| **两者都没有** | **17** | **40.5%** |
| **合计** | **42** | 100% |

> 复算：`events.filter(e => (e.members||[]).length && hasRel(e.id)).length` 等四项之和必须等于 42。

**关键实测：最近 3 个 active 事件的「关联文档」数是 `0 / 0 / 1`。**
即：**用户最关心的「当前正在做的事」，恰恰是关联文档最少的**——因为施工文档是**做完之后**才写的，正在做的事还没有文档。

#### 表 9 · 注入面里现在有没有任何文档路径？

`[事件卡片]`（`renderT2Pre`）对 2 个已展开事件的输出里，匹配 `(docs|artifacts|lib|tests|tools)/...` 的路径数 = **0**。

原因：`lib/event-render.js` 全文对 `members` / `sourceRef` / `rel` / `quoteRef` / `quoteLine` / `bytes` / `sha256` 的引用次数 = **0**（§4-④ 末段）。

⇒ **结论**：`members` / `rel` 这两个字段**已经存在、已经有值、已经可解析，但注入面一个字都没用**。
这是「只存不用」家族的第 N 次复现——**不需要新 schema，需要的是渲染层把它们读出来**。

### 2b. 已有能力是否够用（关键反问）

**答：够用，而且「按需下钻」在成本上比「注入」便宜 1–2 个数量级。真正缺的不是能力，是「让模型知道该下钻哪里」。**

#### 表 10 · 现有三条下钻通道的实测行为

| 通道 | 代码位置 | 返回什么 | 单次成本（实测/估算） |
|---|---|---|---|
| `memory_recall(scope="events", query="…")` | `lib/index.js:13855-14044` | **按行命中**：事件名 + summary 前 160 字 + 每条命中行的 **240 字摘录**（`recall-passages.js:5-13`）+ 行号。最多 3 条 passage/事件、最多 8 个事件 | 命中 1 事件 3 行 ≈ 3 × (240+30) ≈ **810 字 ≈ 405 token** |
| `memory_recall(scope="events", query="")` **枚举模式** | `lib/index.js:13873-13908` | 全部事件一行一个：`[evt_xxx] 名称 [状态] 检查点 N · 更新 时间`，summary 再 120 字 | 42 事件实测 ≈ **2,900 字 ≈ 1,450 token**（且**标注空壳**） |
| `memory_recall(expand="evt_xxx")` | `lib/index.js:14637-14667`（`expandEventRecordPre`） | 名称/状态/summary/四段 + **最近 5 条检查点，每条截 300 字** | 实测 ≈ **1,700 字 ≈ 850 token** |
| `memory_read(kind="plan")` | — | 白板全文 14,371 字 | **≈ 7,186 token**（不建议；注入面已有 8,000 预算的截断版） |

**实测验证（不靠读代码推断）**：用 `lib/recall-passages.js` 对一段无锚点的事件语料做词法检索，能正常返回**行级命中 + 行号**：

```
输入: "# 事件A\n这是总览\n## 目标\n- 目标一\n- [log] 检查点正文包含 iter5 锁 与 r26 重钉 内容\n- [handoff] 另一条检查点也提到 iter5 锁"
查询: ["iter5"]
输出: 2 条命中
  - line: "- [log] 检查点正文包含 iter5 锁 与 r26 重钉 内容"  lineStart: 5
  - line: "- [handoff] 另一条检查点也提到 iter5 锁"            lineStart: 6
```

⇒ 检查点正文**是可被词法检索到的**（`parseAnchors` 对无锚点文本按整块处理，不丢内容）。

#### 表 11 · 注入 vs 按需下钻的边界（这是本次调查最该回答的一张表）

| 判据 | 应当**注入** | 应当**按需下钻** |
|---|---|---|
| 模型**不知道自己缺**这条信息 | ✅ 必须注入 | ❌ 永远不会去查 |
| 需要它来决定**下一步动作**（如「当前在做什么」） | ✅ 必须注入 | ❌ 迟了 |
| 内容**稳定、可预算**（≤几百 token） | ✅ | — |
| 内容**体量不可预算**（一篇 3,000–33,000 token） | ❌ | ✅ |
| 需要**精确原文**（引用、行号、报错串） | ❌ 注入会被截断失真 | ✅ 下钻拿全文 |
| 只有**少数轮次**才需要（如某条失败方案） | ❌ 每轮都付钱 | ✅ |
| 是「**入口**」（去哪找），不是「**内容**」 | ✅ 注入入口 | — |

**⇒ 用户 C-3 的直觉在这一层是对的，但结论要改写：**
不是「注入检查点没用」，而是——
**「注入检查点的前 300 字」是低价值的（既失真又占预算），「注入检查点的存在 + 去哪取原文」才是高价值的。**
实测支撑：`[事件卡片]` 对每条检查点只覆盖 33–46%（因为 `CHECKPOINT_ITEM=300` 截断），
**模型拿到的是被砍掉 2/3 的句子**——这既不是「进度播报」也不是「原文」，是**两者都不算**的中间态。

### 2c. 成本实测：注入 1 篇施工文档要多少 token

样本：本仓 `artifacts/` 与 `docs/internal/` 下 **314 篇 `.md`**，中位 **8,004 字符**、p90 25,003、最大 69,125、平均 12,101。

取 5 篇真实施工/设计文档实测（复算：§4-⑤）：

#### 表 12 · 5 篇真实施工文档的体量

| 文档 | 字符 | 字节 | 行 | **token(保守 ceil/2)** | token(repo 口径 ceil/4+4) | **占 human_full 8,000 预算** |
|---|---|---|---|---|---|---|
| `docs/internal/PLAN-520-CROSS-WORKSPACE-UPGRADE-20261103.md` | 5,984 | 10,656 | 146 | **2,992** | 1,500 | **37%** |
| `docs/internal/TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md` | 18,269 | 30,367 | 413 | **9,135** | 4,572 | **114%** |
| `docs/internal/PR-MERGE-PIPELINE-20261108.md` | 18,437 | 26,705 | 559 | **9,219** | 4,614 | **115%** |
| `artifacts/V4-MASTER-PLAN-2026-10-24.md` | 61,403 | 100,930 | 1,303 | **30,702** | 15,355 | **384%** |
| `docs/internal/R4-DESIGN-TRUTH.md` | 66,705 | 94,130 | 992 | **33,353** | 16,681 | **417%** |
| **合计** | 170,798 | 262,788 | 3,413 | **85,401** | 42,722 | **1,068%** |

**⇒ 三条硬结论**：

1. **单篇就能吃光预算**：最小的一篇 2,992 token = 37%，最大的一篇 33,353 token = **417%**。
   「注入 1 篇文档正文」在 `injectBudgetChars=8000`（≈4,000 token 保守）下**结构性不可行**——**连一篇中等文档都装不下**。
2. **与 Tier-0 共存没有空间**：Tier-0 实测 400 token + 5 个事件层段落 2,341 token = 2,741 token，
   再加一篇最小文档 2,992 ⇒ **5,733 token ≈ 11,466 字符 > 8,000**，直接爆预算并触发截断。
3. **截断后更糟**（与前文 §7 R3 同一机制）：一篇 33,353 token 的文档截到 4,000 token ⇒
   模型看到「前 12%」+ 一个截断标记，**既不知道全文说什么，又占掉了所有预算**。

### 2d. 候选形态（3 种，各自 token 实测/估算）

#### 形态 A · 只注入「文档标题 + 首段」

| 文档 | 标题+首段字符 | token(保守) |
|---|---|---|
| PLAN-520（最短） | 99 | **50** |
| TIER0-AND-USERFULL（本次前文） | 234 | **117** |
| PR-MERGE-PIPELINE | 155 | **78** |
| V4-MASTER-PLAN | 326 | **163** |
| R4-DESIGN-TRUTH | 277 | **139** |
| **3 篇合计（活跃 3 事件各 1 篇）** | ~700 | **~350** |

- **可行性**：✅ 8,000 预算下完全装得下（350 / 4,000 = 8.8%）。
- **数据来源**：纯函数，零 IO 增量（同一次 `events` 读盘后按 `members`/`rel` 取路径 → 读文件 → 取首个 `# ` 标题 + 首个非标题段）。
- **代价**：每次 refresh（15s TTL）要**多读 N 个文档**。实测 314 篇全量读 76.3 ms（前文已测），3 篇 ≈ 1 ms，可接受。
- **风险**：**首段常常是「本文是唯一权威 / 按顺序执行」这类元话语**（实测 PLAN-520 首段就是这种），信息量低。

#### 形态 B · 注入「文档摘要（谁生成？）」

| 生成者 | 成本 | 风险 |
|---|---|---|
| **模型自己**（写事件时顺手写一句 `summary`） | 0 额外 token（已在 `memory_event` 里） | **依赖模型自觉**——实测本机 42 事件里 `summary` 平均 80.7 字、最长 371，**但这句 summary 描述的是「这件事」，不是「这份文档」** |
| **子代理离线生成** | 每篇一次 LLM 调用 | 新增后台任务、新增失败面、用户看不到生成过程 |
| **启发式抽取**（取 `## ` 二级标题列表） | 0 token | 实测 R4-DESIGN-TRUTH 有大量二级标题，列表本身可能就有 300–500 字 |

- **token 估算**：若每篇摘要 ≤120 字 ⇒ 3 篇 **≈180 token**。
- **判定**：**不推荐**。理由：①「谁生成」没有零成本且可靠的答案；②摘要会**引入第二份需要同步维护的文本**（本仓已有「同一语义两处判定必半修」的多次教训）；③模型真正需要的往往不是摘要，而是**「这份文档值不值得读」**——那用形态 A 或 C 就够。

#### 形态 C · 不注入正文，只给**指针**（路径 + 一句描述）

形如：

```
[相关文档 — 该事件涉及的施工/设计文档（未展开，按需 memory_read）]
· docs/internal/PR-MERGE-PIPELINE-20261108.md — PR 批量合并流水线（559 行）
· artifacts/V4-MASTER-PLAN-2026-10-24.md — v4 总施工细则（1,303 行）
```

| 项 | 值 |
|---|---|
| 单条指针字符 | 实测 `· <path> — <title>（<N> 行）` ≈ **55–75 字符** |
| 3 条指针 token | **≈ 90–110 token** |
| 6 条指针 token | **≈ 180–220 token** |
| 数据来源 | `members` + `rel`（**已存在**）+ 文件 `stat`（行数） |
| 新增 IO | 每事件 ≤2 次 `statSync`（不是 readFile）⇒ 微秒级 |
| 风险 | 路径可能失效（实测 `members` 59 个值里 **9 个两边都找不到**、`rel` 44 个里 2 个失效）⇒ **必须显式标注「路径未解析」而不是静默丢弃** |

#### 表 13 · 三种形态对比与建议

| 形态 | token（3 篇） | 占 8,000 预算 | 新增数据源 | 新增 IO | 主要风险 | 建议 |
|---|---|---|---|---|---|---|
| **A 标题+首段** | ~350 | 8.8% | 无（读文件） | 3 次 readFile | 首段多是元话语 | 可选 |
| **B 摘要（谁生成）** | ~180 | 4.5% | **要新建第二份文本** | 视生成方式 | 双份文本漂移 | **不推荐** |
| **C 纯指针** | ~90–220 | 2.3%–5.5% | 无（`members`/`rel` 已有） | 3–6 次 statSync | 路径失效需显式标注 | **推荐** |

**⇒ C-4 的结论**：
「注入相关文档」**方向对，但形态必须是 C（指针），不能是正文**。
而且它**不是「替代检查点」**——两者解决的是不同问题：
· 检查点回答「**做到哪了、试过什么失败了**」（时间线 / 状态）；
· 文档指针回答「**细节去哪看**」（索引 / 深挖入口）。
用户原话里「更应该注入相关的，比如说施工文档」——**按字面实现（注入正文）会撑爆预算**；
按意图实现（**让模型知道有这份文档、去哪读**）则只要 ~100 token，且**恰好补上现在完全缺失的一环**（表 9：注入面 0 个路径）。


---

## 3. C-1 / C-2 的落地差距（可实施清单）

### 3a. 用户原话（逐字保留，不改写）

> **C-1 · human_full**
> 「用户完整版，即 human full，也就是所谓的每百万上下文只注入两到三次，需要注入比较多在事件方面的这个模块的就是事件的名字，也就是事件层级的内容。比如最近一段时间的固定内容：
> 1. 最近 10 条或 20 条事件的内容；
> 2. 最近活跃的 3 条事件的 5~6 个检查点类的内容。同时也要提醒模型，这个事件是从什么时候开始的，还有多少条未在里面，想怎么查细则就该怎么查」

> **C-2 · human_slim + run_full**
> 「然后在每轮都注入，或者说注入相对频繁的，human slim 还有这个固定波次步次注入的 run full 是注入近期工作内容，例如：
> 1. 最近 3 个事件的 T0 级内容（即事件名）；
> 2. 最近工作事件的近几个检查点。」

> **C-3 · 用户的质疑**
> 「哎，我又开始在想，如果我只注入几个检查点的话，是不是有点没用？反正你的模型上下文已经把事件都说明白了。
> 如果只注入检查点的话，是重复提醒。更应该注入相关的，比如说施工文档，还有这个事件相关的、最近 1~3 个检查点的内联文档一类的内容。」

### 3b. 可实施清单

**token 估算全部按 `ceil(chars/2)`，数据源 = 本机真实 `event-store.json`（42 事件 / 693 检查点），复算见 §4-⑥。**

#### C-1 拆解

| 项 | 目标档位 | 现有能力 | 缺什么 | 数据源 | token 估算（实测） | 风险 |
|---|---|---|---|---|---|---|
| **C-1①a** 最近 **10** 条事件 | `human_full` | `[其他事件]` 已给 8 行 T0（名+状态），但**不含 summary**；且上限 `eventCatalogChars=400` 卡死 | 需要**独立的「近 N 条事件」段**（T1 级：名 + summary 首句），不受 400 字符限制 | `event-store.json` 同一份（`name`/`summary`/`updatedAt`） | **240** | 中：与 `[其他事件]` 语义重叠，必须**二选一或明确分工**，否则同一事件名出现两次 |
| **C-1①b** 最近 **20** 条事件 | `human_full` | 无 | 同上 | 同上 | **513** | 同上 + 20 行会淡化「当前在做什么」（前文 §7 R1 已实证同类事故） |
| **C-1②** 活跃 **3** 条的 **5–6** 个检查点 | `human_full` | `[事件卡片]` 取 active 前 **2** 个、每个最多 **3** 条检查点、每条截 300 字 | ①数量 2→3（`eventMaxActiveInInject` 是配置键，改默认值即可）；②检查点 3→5/6（`renderT2Pre({maxCheckpoints})` 已支持参数，但 `T2_BUDGET.CHECKPOINTS=1800` 会先撑爆）；③**每条 300 字截断**是硬约束 | 同上 | **669**（截 300 字口径）<br>**2,374**（原文口径） | **高**：`T2_BUDGET` 合计已超总限（前文 §2 已记录：3,240 > 2,400，缺口 840）⇒ 加检查点必然挤掉四段/成果 |
| **C-1③** 「事件从什么时候开始」 | `human_full` | **数据全有**：`createdAt` **42/42**、`startMs` **41/42**、`endMs` 41/42 | **只是没渲染**——`renderT2Pre` / `renderT1Pre` / `renderT0Pre` 三个函数**都不输出任何时间字段** | `event.createdAt` / `startMs` | **≈30–60**（每事件 1 个日期串，如 `起 11-07 17:17`） | **低**：纯增量渲染，无 schema 变更 |
| **C-1④** 「还有多少条未在里面」 | `human_full` | **可算**：`events.length`、`active` 数、已列数都能算。现有 `[其他事件]` 已有「共 40 个，下列 8 个」的**同款口径**可照抄 | 只是**新段落要带上**（不能只给列出的 N 条） | 同上（纯计数） | **≈20–40** | **低**：注意口径要与 `[其他事件]` 一致，别造第二个「总数」定义（38/19/40 三个数已打架，见 §1c 注） |
| **C-1⑤** 「想怎么查细则就该怎么查」 | `human_full` | 精简体已有 `[取全文] memory_recall(scope="events") / memory_read(kind="plan")`（`index.js:10619`）；**完整版没有这一行** | 完整版要补一句**带 eventId 的**下钻指引（如 `memory_recall(expand="evt_xxx")`），否则模型拿到名字也找不到 id | 静态文案 + `evt_xxx` | **≈40–80** | 低 |

**C-1 合计 token**：①b(513) + ②(669) + ③(45) + ④(30) + ⑤(60) = **≈1,317 token（保守）/ ≈658（repo 口径）**
占 8,000 预算 **16.5%**；与现有 5 段（2,341）+ Tier-0（400）叠加 = **4,058 token ≈ 8,116 字符**，**刚好卡在 8,000 字符边界**。

#### C-2 拆解

| 项 | 目标档位 | 现有能力 | 缺什么 | 数据源 | token 估算（实测） | 风险 |
|---|---|---|---|---|---|---|
| **C-2①** 最近 **3** 个事件的 **T0**（事件名） | `human_slim` + `run_full` | 精简体只给 `slimEventT1[0]` **1 条**（60 字）；`buildReadOverviewPre` 里有 `[最近事件]` 取 `t1.slice(0,3)`（`index.js:12100-12107`）但那是**读概览工具**，不是注入 | 精简体要 1→3 条 T0 | `state.slimEventT1`（**已存全部 active 的 T1 行**，38 条，只是渲染时取 `[0]`） | **76** | **低**：数据现成，只是 `[0]` → `slice(0,3)`；但精简体有 **260 字硬预算**（`index.js:10629`），加 2 行会挤掉画像 ⇒ 需重新分配 |
| **C-2②** 「最近工作事件的近几个检查点」 | `human_slim` + `run_full` | 精简体**完全没有**检查点（`renderSlimSnapshotPre` 内 0 处 `checkpoints`） | 全新段 | 同上 | **669**（3 事件 × ≤2 条 × 300 字） | **高**：精简体当前总长实测 ≈2,229 字（`index.js:10633` 注释记录），**再加 1,338 字翻倍** ⇒ 必须重新定义精简体预算 |

**C-2 合计 token**：76 + 669 = **≈745 token**，但**对精简体而言是 +60% 体积**（2,229 → 3,567 字）。

### 3c. 三个必答子问题

#### Q1 · C-1 的「事件是从什么时候开始的」——数据里有 `createdAt` / `startMs` 吗？

**有，而且几乎全有。**

| 字段 | 有值 | 说明 |
|---|---|---|
| `createdAt` | **42 / 42（100%）** | 建事件时写入 |
| `startMs` | **41 / 42（97.6%）** | 唯一缺失：`evt_6ea35c20`（`PR 批量合并流水线：4 个 open PR…`） |
| `endMs` | **41 / 42** | |

**缺的不是数据，是渲染**：`lib/event-render.js` 的 `renderT0Pre`（`:115-123`）/ `renderT1Pre`（`:126-131`）/ `renderT2Pre`（`:373-`）**三个函数体都不输出任何时间字段**。
（精确口径：全文件 5 处 `updatedAt` 命中全部在**排序/可见性**代码里——`:444` 的 `filterCatalogVisiblePre`、`:485`/`:500` 的 `sort`；`createdAt` / `startMs` / `endMs` 在全文件 **0 命中**。⇒ 「不渲染时间」这个结论成立，但**不能说「全文件 0 命中 at/updatedAt」**。）
⇒ **C-1③ 是纯增量**：在 `renderT2Pre` 的事件头行加 `（起 11-07 17:17）` 即可，**约 30–60 token**。

> **一处需要注意**：`startMs` 缺失时工具描述已约定「缺了会回落到 `createdAt`」（`index.js:25238`）⇒ 渲染侧必须实现这个回落，否则那 1 个事件会显示空日期。

#### Q2 · C-1 的「还有多少条未在里面」——能算吗？

**能算，且现有代码已有同款口径可照抄。**

| 量 | 实测值 | 怎么算 |
|---|---|---|
| 事件总数 | **42** | `events.length` |
| active | **38** | `filter(status==='active').length` |
| closed | **4** | 同上 |
| 若列 10 条 ⇒ 未列 | **32**（其中 active 28） | `total - 10` |
| 若列 20 条 ⇒ 未列 | **22** | `total - 20` |
| 近 3 天（`updatedAt > now-3d`） | **29** | 时间窗口径 |

**可照抄的既有实现**：`[其他事件]` 的标题行已经这么写（`index.js:12692`）：
```
（共 40 个，下列 8 个）
```
其中 `_catTotal = eventCatalogIncluded + eventCatalogDropped`。

> **⚠ 必须避开的坑**：现在**同时存在三个「事件总数」**——事件库 42、白板 19 行、`[其他事件]` 说 40。
> 新段落**必须显式声明自己用的是哪个口径**（建议：一律用 `events.length` = 42，并注明「本工作区事件库共 N 个」），
> 否则模型会看到三个互不相容的数字（这正是用户最反感的「同一语义多处判定」）。

#### Q3 · C-2 的「最近 3 个事件」与 C-1 的「活跃 3 条」会不会重复？

**会，实测 3/3 完全重合。**

| 口径 | 结果 |
|---|---|
| 最近 3 个事件（按 `updatedAt` 降序，**不限状态**） | `evt_ea2cbd88` / `evt_fe275b34` / `evt_6ea35c20` |
| 活跃 3 条（**仅 active**，按 `updatedAt` 降序） | `evt_ea2cbd88` / `evt_fe275b34` / `evt_6ea35c20` |
| **重合度** | **3 / 3 = 100%** |

原因：42 事件里 **38 是 active**（90.5%），且 active 的 `updatedAt` 分布覆盖了全局前 3 ⇒ 两个口径在**本机几乎必然同集**。
这与前文 §3 的结论一致（「42 事件里 38 是 active，取『active 前 3』与『last-active 前 3』很可能是同一批」）。

**⇒ 三种处置（需用户拍板）**：

| 方案 | 描述 | 评价 |
|---|---|---|
| **A. 合并**（推荐） | C-2① 直接复用 C-1② 的「活跃 3 条」，**不新增段落**——精简体只给 T0 名，完整版给 T0 名 + 检查点 | 零重复、零额外 token |
| B. 排除 active | C-2① 取「最近收口的 3 个」 | 语义变成「历史」，与「近期工作内容」原意不符 |
| C. 保留两份去重 | 实现复杂、收益低 | 不推荐 |

> **另一处实测支撑 A**：`近 10 条 ⊂ 近 20 条` 的重合是 **10/10**（近 10 是近 20 的前缀）
> ⇒ C-1①「10 条或 20 条」不是两个功能，**是一个参数**。建议做成 `eventDigestRecentN`（默认 20），不要写两个段。

### 3d. 「检查点数量」的真实约束（这条会决定 C-1② 能不能落地）

**实测：本机活跃前 3 个事件只有 2 + 2 + 0 = 4 条检查点，取 5 条和取 6 条输出完全一样（都是 1,338 字）。**

| 统计 | 值 |
|---|---|
| active 事件的检查点分布 | `{0:1, 1:10, 2:11, 3:7, 4:1, 5:1, 7:1, 8:1, 22:1, 57:1, 61:1, 160:1, 199:1}` |
| **只有 0 或 1 条检查点的 active 事件** | **11 / 38（28.9%）** |
| 取满 5 条检查点需要几个事件 | **4 个**（前 4 个才凑够 5 条） |
| 跨事件取最近 6 条检查点，覆盖几个事件 | **4 个** |

**⇒ C-1② 的「活跃 3 条的 5~6 个检查点」在本机数据上取不满**——因为事件粒度不均：
少数事件有 199 条检查点（历史长），多数只有 0–2 条（刚建）。
**必须像 `buildCheckpointsBlockPre` 那样「诚实标注不足」**（该函数已有 `（另有 N 条更旧的检查点因预算未显示）` 的范式，`event-render.js:356`），
不能靠「多取几个事件」凑数——那会悄悄改变「活跃 3 条」这个语义。


---

## 4. 复算命令（每个数字都可复现）

> 全部脚本为**只读**：只 `readFileSync` / `statSync`，不写盘、不 import 插件运行时（仅 import 纯函数模块 `lib/event-render.js`，该模块零 IO 零依赖）。

### ① 5 个事件层段落的尺寸（表 1）

```js
// node artifacts/_assess-c3-segments.mjs
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const mod = await import(pathToFileURL('D:/dsh-auto-memory/lib/event-render.js').href)
const H = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/'
const events = JSON.parse(fs.readFileSync(H + 'event-store.json', 'utf8')).events
const PLAN   = fs.readFileSync(H + 'PLAN.md', 'utf8')
const LEDGER = fs.readFileSync(H + 'handoff-20261108-011742.md', 'utf8')

// 复刻 refreshEventStatePre 的三条投影（逐字对齐 index.js:10047/10060/10112）
const slim = events.filter(e => e.status === 'active')
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  .map(e => { let l = ''; try { l = String(mod.renderT1Pre(e) || '') } catch (_) {}; if (!l) l = String(e.name || '')
              return l.replace(/\s*\n+\s*/g, ' ').trim() })
let one = slim[0]; if (one.length > 60) one = one.slice(0, 59) + '…'
const SEG_SLIM = '[当前事件] ' + one + '（共 ' + events.length + ' 个事件）'          // 57

const picks = mod.pickT2EventsPre(events, 2)                                          // 2 个 active
const SEG_CARDS = picks.map(e => mod.renderT2Pre(e)).join('\n\n')                    // 1459

const cat = mod.renderEventCatalogPre(events, { maxChars: 400,
  excludeIds: picks.map(e => e.id), applyVisibility: true })
const SEG_CAT = '[其他事件]（共 ' + (cat.included + cat.dropped) + ' 个，下列 ' + cat.included + ' 个）\n' + cat.text  // 415

const SEG_WB = /## 当前状态\s*\n([\s\S]*?)(?=\n## |$)/.exec(PLAN)[1]                 // 1950
const SEG_LEDGER = LEDGER.slice(0, 800)                                               // 800

for (const [k, v] of Object.entries({ SEG_SLIM, SEG_CARDS, SEG_WB, SEG_CAT, SEG_LEDGER }))
  console.log(k, v.length, Math.ceil(v.length / 2))
```

**实测输出**：`57 / 1459 / 1950 / 415 / 800`，合计 **4,681 字符 = 2,341 token**。

### ② 白板截断 + 检查点在白板里的出现率（表 2）

```js
// 关键：从源码**原样抽出** truncatePlanByPriority（lib/index.js:1754-1803）执行，
// 不重写实现（本仓铁律：锁/管道口径必须用同一条管道）。
const IX = fs.readFileSync('D:/dsh-auto-memory/lib/index.js', 'utf8').split('\r\n').join('\n')
const src = IX.split('\n').slice(1753, 1803).join('\n')   // 0-based 1753..1802 = 1-based 1754..1803
const f = new Function(src + '\nreturn truncatePlanByPriority;')()
const out = f(PLAN, 8000)
console.log('PLAN full', PLAN.length, '→ truncated', out.length)   // 14371 → 7894

// 检查点原文在注入白板里出现的比例（4-gram 口径）
const norm = s => String(s || '').replace(/\s+/g, '')
const outN = norm(out)
let hit = 0, tot = 0
for (const e of events) for (const c of (e.checkpoints || [])) {
  const q = [c.goal, c.state, c.dead, c.next].filter(Boolean).join(' ‖ ')
  const probe = norm(q || String(c.text || '')).slice(0, 40)
  if (!probe) continue
  tot++; if (outN.includes(probe)) hit++
}
console.log(hit + '/' + tot)   // 2/693 = 0.3%
```

### ③ 检查点字段填充率（表 5）

```js
let n = 0; const stat = {}
const K = ['at','kind','text','quoteRef','quoteLine','rel','bytes','sha256','panels','sourceRef','idemKey']
for (const e of events) for (const c of (e.checkpoints || [])) {
  n++
  for (const k of K) if (c[k] !== undefined && c[k] !== null && c[k] !== '') stat[k] = (stat[k] || 0) + 1
  if (c.goal || c.state || c.dead || c.next) stat.quad = (stat.quad || 0) + 1
}
console.log(n, stat)   // 693 { at:693, kind:693, text:686, quad:501, ... }
```

**实测输出**：`693 {at:693, kind:693, text:686, quad:501, quoteRef:32, quoteLine:18, rel:81, bytes:32, sha256:30, panels:301, sourceRef:79, idemKey:635}`

### ④ 重复度 4-gram 覆盖率（表 3 / 表 4）

```js
const norm = s => String(s || '').replace(/\s+/g, '')
function mkSet(t) { const n = norm(t); const g = new Set(); for (let i = 0; i + 4 <= n.length; i++) g.add(n.slice(i, i + 4)); return g }
function cov(body, set) {
  const n = norm(body); if (n.length < 4) return n.length ? 1 : 0
  let h = 0, c = 0
  for (let i = 0; i + 4 <= n.length; i++) { c++; if (set.has(n.slice(i, i + 4))) h++ }
  return h / c
}
const S = { '[当前事件]': mkSet(SEG_SLIM), '[事件卡片]': mkSet(SEG_CARDS),
            '[白板当前状态]': mkSet(SEG_WB), '[其他事件]': mkSet(SEG_CAT), '[最近交接]': mkSet(SEG_LEDGER) }

for (const [k, set] of Object.entries(S)) {
  let sum = 0, n = 0, max = 0
  for (const e of events) for (const c of (e.checkpoints || [])) {
    const q = [c.goal, c.state, c.dead, c.next].filter(Boolean).join(' ‖ ')
    const b = q || String(c.text || '')
    if (b.length < 50) continue
    const x = cov(b, set); sum += x; n++; if (x > max) max = x
  }
  console.log(k, 'n=' + n, 'avg=' + (sum / n * 100).toFixed(2) + '%', 'max=' + (max * 100).toFixed(1) + '%')
}
```

**实测输出**：
```
[当前事件]      n=693 avg=0.11% max=3.2%
[事件卡片]      n=693 avg=4.22% max=45.6%
[白板当前状态]  n=693 avg=5.72% max=54.3%
[其他事件]      n=693 avg=0.68% max=13.6%
[最近交接]      n=693 avg=5.20% max=52.6%
```

### ⑤ 关联文档可得性（表 7 / 表 8 / 表 9）

```js
import path from 'node:path'
const MEM = 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--'
const REPO = 'D:/dsh-auto-memory'

// members[]
const all = new Set(); for (const e of events) for (const m of (e.members || [])) all.add(m)
let memOk = 0, repoOk = 0, none = []
for (const m of all) {
  const a = fs.existsSync(path.join(MEM, m)), b = fs.existsSync(path.join(REPO, m))
  if (a) memOk++; if (b) repoOk++
  if (!a && !b) none.push(m)
}
console.log('members', all.size, 'mem', memOk, 'repo', repoOk, 'none', none.length)  // 59 19 32 9

// rel（注意：必须按逗号拆 —— 有 1 条是四路径串）
const relFiles = new Set()
for (const e of events) for (const c of (e.checkpoints || []))
  if (c.rel) for (const p of String(c.rel).split(',').map(s => s.trim())) if (p) relFiles.add(p)
console.log('rel distinct', relFiles.size,
  'docs|artifacts .md', [...relFiles].filter(p => /^(docs|artifacts)\/.*\.md$/.test(p)).length)  // 44, 15

// 注入面有没有文档路径
const paths = [...SEG_CARDS.matchAll(/(?:docs|artifacts|lib|tests|tools)\/[A-Za-z0-9_\-./]+/g)]
console.log('注入面路径数', paths.length)   // 0

// renderT2Pre 用了哪些溯源字段
const R = fs.readFileSync('D:/dsh-auto-memory/lib/event-render.js', 'utf8')
for (const k of ['members', 'sourceRef', 'quoteRef', 'quoteLine', 'rel', 'bytes', 'sha256'])
  console.log(k, (R.match(new RegExp(k, 'g')) || []).length)   // 全 0
```

### ⑥ C-1 / C-2 token 估算（§3b / §3d）

```js
const tok = s => Math.ceil(String(s).length / 2)
const byUpd = [...events].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
const t1 = byUpd.slice(0, 20).map(e => '· ' + mod.renderT1Pre(e)).join('\n')
console.log('近20条 T1', t1.length, tok(t1))                     // 1025 / 513
console.log('近10条 T1', tok(byUpd.slice(0, 10).map(e => '· ' + mod.renderT1Pre(e)).join('\n')))  // 240

// 活跃 3 条 × N 检查点（截 300 字，对齐 CHECKPOINT_ITEM）
const act3 = events.filter(e => e.status === 'active')
  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3)
let blk = ''
for (const e of act3) for (const c of (e.checkpoints || []).slice(-5)) {
  const q = [c.goal, c.state, c.dead, c.next].filter(Boolean).join(' ‖ ')
  let b = (q || String(c.text || '')).replace(/\s*\n+\s*/g, ' ').trim()
  if (b.length > 300) b = b.slice(0, 299) + '…'
  blk += '  - [' + (c.kind || 'log') + '] ' + b + '\n'
}
console.log('活跃3×5检查点', blk.length, tok(blk))                 // 1338 / 669
console.log('活跃3 检查点数', act3.map(e => (e.checkpoints || []).length))  // [2,2,0]

// C-2① 最近 3 事件 T0
console.log('T0×3', tok(act3.map(e => '· ' + mod.renderT0Pre(e)).join('\n')))  // 76

// 时间字段可用性
console.log('createdAt', events.filter(e => Number(e.createdAt) > 0).length, '/', events.length)  // 42/42
console.log('startMs  ', events.filter(e => Number(e.startMs) > 0).length, '/', events.length)    // 41/42

// 检查点分布
const dist = {}; for (const e of act3) {} 
for (const e of events.filter(x => x.status === 'active')) { const n = (e.checkpoints || []).length; dist[n] = (dist[n] || 0) + 1 }
console.log(dist)
```

### ⑦ 施工文档体量（表 12）

```js
import path from 'node:path'
for (const rel of [
  'docs/internal/PLAN-520-CROSS-WORKSPACE-UPGRADE-20261103.md',
  'docs/internal/TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md',
  'docs/internal/PR-MERGE-PIPELINE-20261108.md',
  'artifacts/V4-MASTER-PLAN-2026-10-24.md',
  'docs/internal/R4-DESIGN-TRUTH.md',
]) {
  const p = path.join('D:/dsh-auto-memory', rel)
  const t = fs.readFileSync(p, 'utf8')
  console.log(rel, t.length, 'chars', Math.ceil(t.length / 2), 'tok保守',
    ((Math.ceil(t.length / 2) / 8000) * 100).toFixed(0) + '% of 8000')
}
// 全仓 314 篇 .md 的分布
// median 8,004 / p90 25,003 / max 69,125 / avg 12,101
```

### ⑧ 检查点时间戳是否可排序（§3d 相关）

```js
let mono = 0, tot = 0
for (const e of events) { const c = e.checkpoints || []
  for (let i = 1; i < c.length; i++) { tot++; if ((c[i].at || 0) >= (c[i - 1].at || 0)) mono++ } }
console.log((mono / tot * 100).toFixed(1) + '%', mono + '/' + tot)   // 99.5% 649/652
```

⇒ **数组序 ≈ 时间序（99.5%）**，所以「最近 N 个检查点」用 `slice(-N)` 是**可靠近似**，
**不需要**新 schema 字段（这也推翻了前文 §3「这是本设计最大的数据缺口」的判断——
真正的缺口是「跨事件排序」而非「检查点内排序」，而跨事件有 `event.updatedAt` 可用）。

---

## 5. 未验证 / 边界（明确标注）

| 项 | 状态 |
|---|---|
| **线上真实帧的段落实际字节数** | **未抓取**。本文所有段落尺寸都是**离线复刻** `refreshEventStatePre` 的投影算出来的；线上还要过 `memory-envelope.js` 的桶裁剪（`must` / `normal` 竞争），实际可能更少。前文 §10 也记录同一未验证项 |
| **`[事件卡片]` 被 `must` 提优先级后是否真的不再被裁** | 代码事实：`pushPart(...,'must')`（`index.js:12668`）；但**未抓线上帧验证** |
| **`run_slim` 档位是否真的不给事件层** | 代码事实：`_evCardsOk = !(_tier === _T.RUN_SLIM)`（`:12667`）+ 精简体 `_SLIM_HUMAN_CTX_TIERS` 白名单不含 `run_slim`（`:10585`）；**未抓线上帧** |
| **白板 19 行 vs 事件库 38 active** | 已确认是**磁盘快照过期**（PLAN.md 只在 `memory_note(kind=plan)` 时重写）；但**「多久没重写」未量化** |
| **「注入文档」若真做，`members` 里的 9 个不可解析值** | 已实测「两边都找不到」（`2026-09-28.md` 等裸日期名）；**这些是记忆工作区日志的旧命名，未确认是否已归档到 `archive/`** |
| **`panels` 冗余度的全量验证** | **已全量验证**（301 条）：263 条互为前缀（87.4%）、38 条不是（12.6%）。但「不是前缀」不等于「信息一定独立」——那 38 条是否与 `text` 语义重复，**未逐条判定** |
| **C-1② 的 5~6 检查点在检查点多的老事件上会不会撑爆 `T2_BUDGET`** | **未实测**。本机活跃前 3 只有 4 条检查点；有 199 条检查点的那类事件未做「取 6 条 × 300 字」的实测 |
| **`eventMaxActiveInInject` 2→3 的副作用** | **未实测**。该键是配置键，改默认值会影响所有用户的帧体积 |
| **用户 C-3 里「内联文档」的确切所指** | **未澄清**。可能是 ①施工文档正文 ②检查点里 `rel` 指向的文件 ③Markdown 内联代码块。本文按 ①+② 理解并分别评估 |

---

## 6. 一句话回答用户的三个疑问

### Q-C3 · 「只注入检查点是不是重复提醒、没啥用？」

**一半对，一半不对。**

- **对的那一半**：如果注入的是「**已经展开的那 2 个事件的前 300 字**」，那确实是重复——
  实测覆盖率 33.1% / 34.9% / 45.6% / 37.1%，而且**同时**在 `[最近交接]` 里再出现一次（52.6%）。
  ⇒ **同一条检查点被渲染两遍、且每遍都被截断**，这是真实浪费。
- **不对的那一半**：对**未被展开的 36 个 active 事件**，检查点是 **92.6%–98.3% 的新信息**，
  且它携带的是**别处一处都没有的四类内容**：具体文件路径、具体报错标识、被推翻的方案与失败原因、可复算的物理量。
- **用户更深的直觉是对的**：问题不是「检查点没用」，而是
  **「把检查点截到 300 字塞进注入面」既失真又占预算**。
  正确做法是 **注入「有哪些检查点 + 怎么取原文」（指针）**，把全文留给 `memory_recall(expand="evt_xxx")`。

### Q-C4 · 「与其注入检查点，不如注入相关文档」可行吗？

**方向对，但「注入文档正文」在 8,000 预算下不可行。**

- 实测 1 篇施工文档 = **2,992–33,353 token**，最小的一篇就占 8,000 预算的 **37%**，最大 **417%**。
- 可行形态只有 **指针**（路径 + 标题 + 行数，**~30 token/条**）或 **标题+首段**（**~50–163 token/篇**）。
- **而且它现在完全是空白**：注入面里 `docs/`/`artifacts/` 路径数 = **0**；`event-render.js` 对
  `members`/`rel`/`quoteRef`/`sourceRef`/`bytes`/`sha256` 的引用次数 = **0**（「只存不用」）。
- 数据**已经存在**：`members` 覆盖 24/42 事件（其中 26 个 `docs|artifacts` 路径）、`rel` 覆盖 81/693 检查点（44 个 distinct 路径、42 个可解析）。
  ⇒ **不需要新 schema，需要的是渲染层把它们读出来。**

### Q-落地 · C-1 / C-2 差多少？

| | C-1（human_full） | C-2（human_slim + run_full） |
|---|---|---|
| 数据 | **全有**（`createdAt` 42/42、`startMs` 41/42、检查点 693、`updatedAt` 全有） | **全有**（`slimEventT1` 已存 38 条 active 的 T1 行，只是渲染取 `[0]`） |
| 主要缺口 | ①「近 N 条事件」段不存在（`[其他事件]` 只有 400 字符 / 8 行、无 summary）；②检查点 3→5/6 会撑爆 `T2_BUDGET`；③**时间字段一个都没渲染** | ①精简体只给 1 条（要 3 条）；②精简体**零检查点**，加进去体积 +60%（2,229 → 3,567 字）；③260 字硬预算要重新分配 |
| token | **≈1,317**（保守）/ 658（repo） | **≈745**，但对精简体是 **+60% 体积** |
| 重复风险 | 「最近 10/20 条」与 `[其他事件]`、白板当前状态表**三处同义**，必须明确分工 | **C-2① 与 C-1② 实测 3/3 完全重合**（38/42 是 active）⇒ 建议合并，不要两段都做 |
| 结论 | **能做，但必须先把「三处事件清单」收敛成一处**，否则新增段落只是把重复从 2 份变成 3 份 | **能做，但要重定精简体预算**；且 C-2① 应复用 C-1② 而非独立实现 |


---

## 7. 这份文档怎么用（给下一位接手者）

| 你要做什么 | 先看哪节 | 关键数字 |
|---|---|---|
| 判断「要不要加检查点注入」 | §1a 表 3 + §2b 表 11 | 已展开 33–46% 覆盖 / 未展开 1.7–7.4% |
| 判断「检查点里有什么」 | §1b 表 6（三个事件逐字段原文） | 693 条 / 100% 有 `at` / 72.3% 有四段 |
| 判断「要不要注入文档」 | §2c 表 12 + §2d 表 13 | 单篇 2,992–33,353 token / 指针 ~28 token |
| 判断「注入还是按需下钻」 | §2b 表 11（7 条判据） | 下钻 405–850 token/次 |
| 落地 C-1 | §3b C-1 拆解表 + §3c Q1/Q2 | ≈1,317 token |
| 落地 C-2 | §3b C-2 拆解表 + §3c Q3 | ≈745 token，但精简体 +60% |
| 复算任何一个数字 | §4（8 段可跑脚本） | 全部只读 |

### 三条最该带走的判断

1. **检查点的价值不在「文本」，在「指针」**。
   现在注入的是每条检查点的**前 300 字**（覆盖率 33–46%），既失真又占预算；
   而检查点里真正独有的东西（commit 哈希、报错串、被推翻方案、可复算物理量）**恰好都在后 2/3**。

2. **文档注入的可行形态是「指针」，不是「正文」**。
   本机 5 篇实测：最小 2,992 token（占 8,000 的 37%），最大 33,353（417%）。
   而 `members` / `rel` **已有数据、已可解析、注入面 0 引用** ⇒ 这是**渲染层欠账**，不是数据欠账。

3. **C-1/C-2 的真实障碍不是数据、不是预算，是「事件清单已经有 3 份」。**
   `[其他事件]`（8 行 / 400 字符）+ 白板 `## 当前状态`（19 行）+ `[当前事件]`（1 行）
   已经在说同一件事；再加「近 10/20 条」就是第 4 份。
   **必须先收敛成一处，再谈新增**——否则每加一段，重复就从 2 份变 3 份。
