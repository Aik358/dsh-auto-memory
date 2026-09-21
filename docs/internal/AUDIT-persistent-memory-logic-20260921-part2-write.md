# 长期记忆系统 逻辑审计报告 · 第 2 批：事实/情节写入与去重链路

> 审计日期：2026-09-21 · 对象 `D:\dsh-auto-memory`（pre 线）
> 取证基线：`lib/fact-store-pre.js`(24,181 B / mtime 09-19 05:22)、`lib/episodic-store-pre.js`、
> `lib/memory-hub-pre.js`、`lib/intent-clean-safe-pre.js`、`lib/index.js`
> 运行时数据：`~/.dsh/memory/hub-pre/facts.json`（10 条）、`episodes.json`（35,688 B）
>
> **本报告只做诊断，未改任何代码。**

---

## 0. 结论先行

「旧算法和新算法逻辑也特别乱」——**成立，而且比 procedure 那条更严重**。根因是同一份数据存在
**多条互不同源的写入通路**，各自清洗/校验口径不同，且**旧副本仍在仓库里可被引用**。

最刺眼的是：**已经修好的清洗器并没有清掉已经进库的脏数据，而且仍有一类残片能穿过去**。
实测（`node` 直跑真实字符串）：

| 输入（取自 facts.json 真实值） | `looksRuntimeResidue` | `stripRuntimeIntent` | 判定 |
|---|---|---|---|
| `Approval prompts are disabled in this session x` | ✅ 命中 | 置空 | 正常拦截 |
| `Current runtime context. This snapshot s` | ✅ 命中 | 置空 | 正常拦截 |
| `现在是什么情况？ Current DSH file policy: danger-…` | ✅ 命中 | 置空 | 正常拦截 |
| `{"path":"D:\\personal_issue\\.dsh-vision` | — | 置空 | 正常拦截 |
| **`Reference: - 20:16 [kind:todo]`** | ❌ **未命中** | **原样通过** | ★ **漏网（活 bug）** |
| `episode` | ❌ 未命中 | 原样通过 | 空值回退占位，可接受 |

`Reference: - 20:16 [kind:todo]` 就是 `facts.json` 里 `fact_pre_9a706422e` 的 subject，
`confirmedAt = 09-20 00:18` —— **在清洗器修复（09-16）之后写入，说明这不是历史遗留，是现行漏网。**

---

## 1. P0 级（1 条）

### P0-1 清洗器漏掉「Reference: - …」形态的召回残片

- 位置：`lib/intent-clean-safe-pre.js:146`
- 代码：
  ```js
  const RUNTIME_RESIDUE_RE = /Current DSH file policy|Current runtime context|Approval prompts are disabled in this session|\[Retrieved memory ref|Verify against the current user request|If a reference hints at what you need|Reason:\s*fv2 lane=|Score:\s*[0-9.]+ \(rank \d+\/\d+\)/i
  ```
- 问题：`RUNTIME_RESIDUE_RE` 覆盖了 `[Retrieved memory refe…` 形态，但**没覆盖**滚动摘要/召回列表里另一种前缀
  `Reference: - HH:MM [kind:xxx]`。实测该串两个函数都不命中 ⇒ 原样进库。
- 证据（运行时）：`facts.json` 第 6 条 `fact_pre_9a706422e…`，subject = `Reference: - 20:16 [kind:todo]`，
  确认时间 `09-20 00:18`（晚于清洗器落地时间）。
- 影响：
  1. 垃圾 subject 会被 `hubFlushTick` 写回 `MEMORY.md` ⇒ **污染注入面与语义语料**（这是历史上⑩-a/⑩-b 的同源问题）；
  2. 前端「记忆中枢」展示为一条无意义事实，用户判断力被干扰。
- 修法建议：`RUNTIME_RESIDUE_RE` 增加 `^Reference:\s*-\s*\d{2}:\d{2}\s*\[kind:` 或更宽的
  `^\s*(?:Reference|Source|Reason):\s*-` 前缀族；并补一条**回归测试**用真实脏串做断言（现有测试没覆盖此形态）。

---

## 2. P1 级（5 条）

### P1-1 同一份 facts 有多条写入通路，清洗口径不一致

- 取证（三条通路）：
  1. `lib/memory-hub-pre.js:186-193` —— `crossFeed()` 的 episode→fact 分支，**过双重清洗**
     （`looksRuntimeResiduePre` + `stripRuntimeIntentPre`）。
  2. `lib/memory-hub-pre.js:288-317` —— `factCandidateFromRow()`，**过双重清洗**（同上，T1-2 追加）。
  3. `lib/index.js:9313-9320` —— `hubFlushTick` 写回 `MEMORY.md` 前的卫生门，**再过一次**清洗。
- 问题：清洗逻辑以**复制**方式散在三处（外加 `intent-clean-pre.js:27` 的再导出）。任何一处漏改，
  就会出现「补了口 A、漏了口 B」（这正是代码注释里 T1-2 自陈的踩坑史）。
- 影响：脏数据从任一口穿过去都会再次污染下游；且三处的判据强度不同（有的只 strip、有的 strip+residue）。
- 修法建议：抽出**唯一**的 `sanitizeFactFieldPre(raw)`（内含 strip + residue + 空值回退），三处统一调用；
  并用测试断言「三条通路对同一脏输入产出一致」。

### P1-2 已入库的脏数据没有任何清理/迁移机制

- 运行时证据（`hub-pre/facts.json`，共 10 条）：
  ```
  fact_pre_ac4920327  08-28 21:42  subject = DSH \ufffd\ufffd\ufffd\ufffd\ufffd\ufffd   ← 编码损坏
  fact_pre_a9380f5bc  09-08 19:03  subject = 让我自己去试吧。现在是什么情况？        ← 对话语气，非事实
  fact_pre_dda6cc1f3  09-17 03:07  subject = Approval prompts are disabled …        ← 运行时信封
  fact_pre_9a706422e  09-20 00:18  subject = Reference: - 20:16 [kind:todo]          ← ★ 漏网残片
  fact_pre_ec6f6b496  09-20 05:18  subject = 不是谁告诉你上下文要满的？…            ← 对话语气
  fact_pre_a5292de3a  09-20 06:20  subject = 现在工具就是调用，确实是折叠了，但是…  ← 对话语气
  ```
  ⇒ **10 条里 3 条结构性垃圾**（编码损坏 1 + 信封 1 + 残片 1），**另有 3 条语义上不是事实**（用户对 AI 说的话被当事实）。
- 问题：清洗器的修复只对**新写入**生效（`restore()` 逐条 `validateFactPre`，但该函数**不检查内容卫生**，
  只检查结构与类型）。没有一次性清扫，也没有「存量数据卫生检查」入口。
- 影响：脏数据永久留存，且会被 `hubFlushTick` 持续写回 `MEMORY.md`，再次进入注入面。
- 修法建议：① `restore()` 增加卫生过滤（或至少打标 `quarantined`）；② 提供一次性清理脚本；
  ③ `MemoryHubTab` 加「疑似脏数据」视图供用户裁决。**需拍板是否自动清（涉及用户数据，建议只标记不删）。**

### P1-3 事实层把「用户对 AI 说的话」直接当 subject，缺乏事实性判据

- 取证：`lib/memory-hub-pre.js:186-192`
  ```js
  const factIntent = looksRuntimeResiduePre(rawIntent) ? '' : stripRuntimeIntentPre(rawIntent).trim()
  const cand = {
    scope: 'Workspace', subject: factIntent.slice(0, 30) || 'episode', predicate: '有未决事项',
    object: factObject.slice(0, 60), ...
  }
  ```
- 问题：`ep.subject` 直接取 episode 的 intent 前 30 字符，**没有任何「这是不是一条事实」的判定**。
  于是「不是谁告诉你上下文要满的？」「现在工具就是调用…」这种**对话发言**全变成 fact 的 subject。
- 影响：事实库被对话噪声填充（实测 3/10）。这就是用户说「屎山」的直观来源之一——
  打开「记忆中枢」看到的不是事实，是聊天记录残句。
- 修法建议：二选一（需拍板）——
  A. 收紧入口：episode→fact 分支要求 intent 具备陈述形态（含主语+谓语断言），否则只留 episode 不升格 fact；
  B. 保持写入但**打标低置信**（`epistemicStatus:'observation'` + `confidence` 低），前端默认折叠。

### P1-4 M8-1 新增字段从未真正写入（10/10 全部缺失）

- 取证：`lib/fact-store-pre.js:41-44` 定义了 `epistemicStatus` / `trend` / 时间三价（`occurredAt`/`mentionedAt`/`ingestedAt`）；
  `:218-223` 在新建时透传；`:104-109` 在 `validateFactPre` 里做**可选**校验（缺字段放行）。
- 运行时证据：`facts.json` **10/10 条**既无 `epistemicStatus` 也无 `occurredAt`；
  仅有 `ingestedAt`（由 `:219` 强制填 `now`）。
- 问题：字段是「加法性」设计（缺省放行），但**上游三条写入通路一条都没传这些字段**（见 `memory-hub-pre.js:188-192`、
  `:306-316`）。⇒ M8-1 那一层认识论模型（fact/observation/directive、趋势、时间三价）**在真实数据里零落地**。
- 影响：`hubTab` / 后续依赖 `epistemicStatus` 做排序或过滤的逻辑全部拿不到数据；
  「这是推断还是事实」无法区分（这也正是 P1-3 无法靠打标缓解的原因）。
- 修法建议：写入侧补默认值（inference→`observation`，explicit→`fact`），不要依赖调用方显式传。

### P1-5 v1/v2 双份实现仍在互相引用（改错文件的土壤）

- 取证：
  | 文件 | 大小 | mtime | 状态 |
  |---|---|---|---|
  | `fact-store-pre.js` | 24,181 B | 09-19 05:22 | 宿主实际 import（index.js:48） |
  | `fact-store.js` | 19,662 B | 09-07 13:06 | 陈旧副本（无 T1/T4 修复） |
  | `episodic-store-pre.js` | 17,169 B | — | 宿主 import（index.js:47） |
  | `memory-hub-pre.js` | 21,888 B | — | 宿主 import（index.js:51） |
  | 而 `memory-hub.js:84/92/149` **仍 import 旧版 store** | | | |
- 且一批**非 `-pre` 的旧文件仍在互相 import 旧副本**：`shadow-host.js`→`shadow-retrieval.js`、
  `memory-writer.js`→`memory-anchor.js`/`memory-index.js`、`context-host.js`→`evidence-store.js`/`semantic-js.js` 等。
- 影响：已知事故模式（PR 改 `lib/*.js` 陈旧副本 ⇒ 宿主只 import `-pre.js` ⇒ **合并了但不落地**）随时重演。
- 修法建议：删除或重命名 v1 系列并加「无引用」断言。**需用户确认不再需要。**

---

## 3. P2 级（2 条）

### P2-1 `episode` 作为空值回退会掩盖真实丢失

- 位置：`lib/memory-hub-pre.js:189`（`|| 'episode'`）、`:308`（`|| String(sourceIds[0])`）
- 问题：清洗后为空时回退成 `'episode'` / 原始 memoryId 串。运行时确有这一条（`fact_pre_6361d55c9`，subject=`episode`）。
- 影响：面板上出现 `episode · 有未决事项` 这种无信息条目，且**无法区分**「本来就没内容」与「被清洗器清空了」。
- 修法建议：回退时打标（`degraded: true` 或 subject 前缀 `[空]`），让丢失可见——符合本插件「唤起可审计」的调性。

### P2-2 `restore()` 对坏记录静默跳过，无计数上报

- 位置：`lib/fact-store-pre.js`（restore 循环 `continue`）、`lib/procedure-store-pre.js:470-477`（同样 `continue`）
- 问题：`restore()` 遇到校验失败就 `continue`，**不记录被跳过的条数**（procedure 侧 `restored` 只报成功数）。
- 影响：数据静默丢失不可见；用户看到条数变少但不知道为什么。
- 修法建议：返回 `{ ok, restored, rejected: n, reasons: [...] }`，并在 `diag` 里落一行。

---

## 4. 未能确认 / 待补充

1. `evidence` 六类计数（seen/read/cite/reuse/success/correction）的**写入方**未在本批完全追完；
   已知 `success` 由 `index.js:7644` 驱动，但 `seen/read/cite/reuse` 的喂入点待第 3 批确认。
2. `episodes.json`（35,688 B）内部结构未逐条解析，无法判断 episode 层的脏数据比例。
3. `hubFlushTick` 写回 `MEMORY.md` 的实际内容与频率未实测（需运行期观察，代码侧 `DAILY_MAX = 8`）。
4. 旧副本 `fact-store.js` 等是否**真的**没有任何运行时引用，需完整调用图确认（本批只做了文本 grep）。

---

## 5. 与第 1 批的合并优先级（待拍板后执行）

| 序 | 缺陷 | 批 | 类型 |
|---|---|---|---|
| 1 | procedure 开关语义/默认值（P0-3） | 1 | 配置 |
| 2 | 高风险批准通路缺失（P0-2） | 1 | 功能缺失 |
| 3 | **清洗器漏网 Reference 残片（P0-1）** | 2 | 逻辑 |
| 4 | 前端按钮条件收敛（P0-1） | 1 | 逻辑 |
| 5 | 双份门限合一（P1-5） | 1 | 架构 |
| 6 | 清洗三通路合一（P1-1） | 2 | 架构 |
| 7 | 存量脏数据标记（P1-2） | 2 | 数据 |
| 8 | 事实性判据（P1-3） | 2 | 产品 |
| 9 | 溯源回填（P1-1） | 1 | 逻辑 |
| 10 | evidence 校验 / 死代码清理 / v1 删除 | 1+2 | 卫生 |

> 用户既有硬规则：**涉及 procedure 记忆引擎（含清洗器）的改动，须经用户拍板方可实施。**
> 本报告只出诊断，等拍板。
