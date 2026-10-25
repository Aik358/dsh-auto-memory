# ★记忆单元分层设计勘误 + 白板看板工作区错判（2026-10-25 21:25）

> ## ⛔ 本文档已作废（2026-10-25 21:5x 用户当面纠正）
>
> **有三处采信了过时依据，结论错误，不要按本文施工：**
> ① 把原型 `perceptFields.note`「四个 percept 本期只建结构不用」当本期权威 —— 那是**很早的思想**，用户今日稍早裁「**现在就加上**」；
> ② 用 `V4-MASTER-PLAN-2026-10-24` 的蒸馏链当唯一依据 —— 用户指出「**24 号的已经有点过时**，蒸馏不事件化是对的，但装在更晚的文档里」；
> ③ 把 `memory_log` 写事件判成「错位」—— 那是 **25 号决断（memory log 依附事件）**，**做法正确**，撤回该结论。
>
> **⇒ 请改读 `artifacts/MEMORY-LAYER-DESIGN-AUDIT-2026-10-25-v2.md`（唯一有效版本）。**

> **这份文档是用户 2026-10-25 21:20 口述纠正的调查结论。**
> 用户原话：「这个白板看板工作区判断有问题，那4个东西不是每轮追加的吗？你看一下项目的设计，就这个模块的设计文档，
> 还有原型的HTML那些范例设计，**这个自动沉淀不是像日记一样没什么用的嘛。它属于是放到每日的，就是长期记忆嘛；
> 而日记类的，它是独立的**」
> 
> **本文的结论：用户判断正确，且问题比表面更深 —— 是「三层记忆单元」被实现成了「两层」，日记类被错灌进事件容器。**

---

## §0 · 一句话结论

```
设计意图（文档 + 原型双证）：
  ① 事件（event）      = 长期记忆单元，一件事一个容器，四类 percept 挂在**事件级**
  ② 每日日志（log/.md）= 日记类，独立的日粒度记录，**不进事件**
  ③ 每日反思（reflect）= 日记类的蒸馏产物，**不进事件**

实际实现（本机实测）：
  ✗ 自动沉淀**完全绕过事件层**（三支全走 appendText 直写 .md）
  ✗ 而 memory_log 又**把日记行灌进事件**当检查点（idemKey = log:日期:时间:hash）
  ⇒ **两份东西都错位了**：日记该独立却被灌进事件；自动沉淀该进日记却又绕开事件。
  ⇒ 结果：事件里全是流水（161 个检查点 0 个有 percept）；日记层反而没有结构。
```

---

## §1 · 设计文档原文（这是意图的唯一真源）

### 1.1 蒸馏链设计（`artifacts/V4-MASTER-PLAN-2026-10-24.md` §1.4.2，L209-220）

> ```
> 每日日志（原料，细碎） → 每日反思（当天蒸馏） → consolidate（多日蒸馏） → 项目规约 / 事件头
> ```
> 
> | 环 | 工具 | 输入 → 输出 | 是否事件化 |
> |---|---|---|---|
> | ① 原料 | `memory_log` | 每轮工作 → 事件检查点（+ 日视图 `.md`） | **事件是源，md 是投影** |
> | ② 日蒸馏 | `memory_reflect` | 当日日志 → `reflections/YYYY-MM-DD.md` | ❌ **不事件化**（蒸馏产物） |
> | ③ 多日蒸馏 | `memory_consolidate` | 最近 N 天日志 → `MEMORY.md` | ❌ **不事件化**（蒸馏产物） |
> | ④ 规约 | `memory_note(kind=plan)` / `memory_rules` | 长期结论 → 白板 / 规则 | ❌ **保留为项目规约** |
> | ⑤ 事件收口 | `memory_event(action=close)` | 一件事做完 → 事件 `outcome` | ✅ |

**关键读法**：

```
· ① 的「事件是源，md 是投影」 —— 主语是 **memory_log（用户/模型主动写的工作记录）**
· ②③ 明确标注 ❌ 不事件化 —— 它们是**蒸馏产物**，独立于事件
· ★但这份表**没有提「自动沉淀」** —— 这就是缺口的起点：
    自动沉淀是 turn-stopping 时的自动评估，它属于①②③哪一环？文档没定义。
```

### 1.2 Q1–Q5 裁决（同文档 §1.4.1）

| # | 问题 | 裁决 |
|---|---|---|
| Q1 | `memory_log` 只写事件 / 双写 / 事件为主+md派生 | **(c) 事件为主 + 日 md 派生**；**每日反思链必须保留** |
| Q2 | 日 `.md` 是否继续生成 | **继续生成，由事件派生**（供反思与 consolidate 使用） |
| Q3 | 白板与事件关系 | **事件的投影视图** |
| Q4 | 项目笔记 | **保留为「项目规约」** |
| Q5 | 旧注入段迁移时机 | **所有新东西建好之后**再迁移 |

**注意**：Q1/Q2 通篇只讲 `memory_log`，**从未讨论自动沉淀**。⇒ 自动沉淀在 v4 改造中被遗漏了。

---

## §2 · 原型 HTML 的设计（第二个独立证据）

### 2.1 四类 percept 是**事件级**字段，不是检查点级

实测 `artifacts/wb-event-preview/index.html` 的 payload schema：

```
Event 顶层字段（22 个）：
  id, ordinal, kind, title, summary, rationale, confidence, status, date, start, end,
  startMs, endMs, members, checkpoints, outcomes, skills,
  userPercept, agentTrace, sharedGround, commitments, sourceCount
                     ↑ 四类 percept 全部在**事件级**

Checkpoint 顶层字段（18 个）：
  id, at, date, time, ms, rel, bytes, sha256, goal, state, dead, next,
  quoteRef, quoteLine, userPercept, commitments, panels
                     ↑ 只有 userPercept / commitments 两个（面板用），
                       **agentTrace / sharedGround 根本不存在于检查点级**
```

### 2.2 原型对四类 percept 的**明确定性**（决定性证据）

原型 payload 里有一段 `perceptFields` 元数据，原文逐字：

```json
"perceptFields": {
  "note": "四个 percept 字段本期只建结构不用（空数组），供后续版本填充",
  "stages": ["retrieved","delivered","used","mentioned","accepted"]
}
```

同时原型页面 footer 里有一行面向用户的说明（代码里写死）：

> 「四个 percept 字段（userPercept / agentTrace / sharedGround / commitments）**本期只建结构，未填充**。」

**⇒ 两层含义**：

```
① 四类 percept 是**事件级**的（不是每轮追加到检查点上）
② 原型明确说「本期只建结构」—— 即 v4 阶段本就没打算填
   ⇒ 现在看到的「4 个未填」= **符合原型的预期状态**，不是 bug
```

### 2.3 原型详情页的「理由」字段来自哪里

用户截图 2 里那一大段文字，在原型里是 `ev.rationale`：

```js
// 原型 renderDetail 里：
var foot = el("div", "foot");
foot.appendChild(el("div", null, "理由：" + ev.rationale));
```

而 adapter 里：

```js
// lib/ev4-adapter.js L146
rationale: sPre(sec.deadend) || sPre(ev.pausedReason),
```

**⇒ 截图 2 那段「绿但假的第 3 形态…」是账本四段里的 `deadend` 段，被塞进了 `rationale`。**

**这不是 bug**：原型的 rationale 设计就是「一句话理由」，而我们的账本 deadend 段是长文，
长度不匹配 ⇒ 视觉上「理由」框里堆了一大堆字。**属数据结构映射的粒度失配。**

---

## §3 · 实际实现的偏移（本机实测，可复算）

### 3.1 自动沉淀**完全绕过事件层**（真缺陷）

`lib/index.js` L14891 附近，`auto-consolidate` 子代理成功后的落盘三支：

```js
// ① LOG  → 直接写日 .md
const body = await this.appendText(p.logPath, '\n## ' + topic + '\n' + logPts.map(x => '- ' + x).join('\n'))

// ② NOTE → 直接写项目笔记 .md
const body = await this.appendText(p.notesPath, '\n## ' + today + '\n' + notePts.map(x => '- ' + x).join('\n'))

// ③ USER → 直接写待确认区 .md
await this.appendText(pendingPath, head + gate.pending.map(x => '- ' + x).join('\n'))

// ⇒ 三支全部 appendText，**没有一处 appendCheckpointPre**
```

**实测验证**：在 `lib/index.js` 全文搜 `appendCheckpointPre`，
`memory_log` 工具分支内有 **1 处**；`auto-consolidate` 分支内 **0 处**。

### 3.2 而 `memory_log` 把**日记行灌进事件**（另一侧的错位）

`memory_log` 的写入链（H1 落地）：

```js
const idemKey = 'log:' + date + ':' + nowHm() + ':' + createHash('sha1').update(entry).digest('hex').slice(0,12)
await appendCheckpointPre(storePath, evId, {
  kind: 'log', at: Date.now(), text: entry,
  panels: [{ kind: 'log', text: entry }],   // ← 只给 log 面板
  idemKey,                                  // ← 无 percept
})
```

**本机实测（两个工作区）**：

```
工作区 A（dsh-auto-memory）:
  evt_dfc30819  113 检查点，其中 log 格式 39 条
  evt_89786878   48 检查点，其中 log 格式 17 条

工作区 B（aik_auto_memory_use）—— 用户截图那个:
  evt_605d3053   20 检查点，其中 log 格式 20 条（100%）
  idemKey 全部形如 log:2026-10-25:09:53:de2e7157b53a
  text 全部形如 "- 09:53 [kind:fact] …"（memory_log 的 entry 格式）
```

**⇒ 用户看到的那个「账本事件」卡，本质是一堆 `memory_log` 日记行被装进了事件容器。**

### 3.3 三层 ⇒ 两层的实证

| 设计上有三层 | 实际 |
|---|---|
| 事件（长期，事件级 percept） | ✅ 容器在，但**装的全是日记行** |
| 每日日志（日记类，独立） | ⚠️ 存在（.md），但**自动沉淀绕开事件也不进这里的事件语义** |
| 每日反思（蒸馏） | ✅ 存在，独立 |
| 四类 percept（事件级） | ❌ **本机 161 个检查点 0 个有 percept**；事件级只有 2 条（我手工填的） |

---

## §4 · 根本原因（三条，逐条有证据）

### 根因 1：v4 改造的 H 批漏了「自动沉淀」这一环

```
H1 = memory_log → 事件检查点 + 日视图派生  ✅ 做了
但 auto-consolidate 是**另一条写入路径**（turn-stopping 触发，subagent 评估后写）
  ⇒ H1 的施工面表（19 个 pushPart + 5 个独立段）里没有它
  ⇒ 它继续走旧路径（appendText 直写 .md）
⇒ 结果：memory_log 进事件，auto-consolidate 不进 ⇒ 两条写入路径**分叉**
```

### 根因 2：percept 的**填充时机**从未设计

```
H4 做的是「四类 percept **接线**」= 让 renderT2Pre 读它们、让 commit/commit 面板渲染
  ⇒ 这是**消费侧**接线
H4 **没有**做「谁在什么时候填 percept」= **生产侧**设计
  ⇒ 原型自己也写着「本期只建结构，未填充」
⇒ 结果：四类 percept 永远空。**不是坏了，是从来没安排过生产。**
```

### 根因 3：账本四段（deadend）与原型 rationale 的粒度失配

```
原型 rationale   = 「一句话理由」（如「目标段几乎逐字同指」）
我们的 sec.deadend = 长段落（几百字）
adapter 直接 rationale: sec.deadend ⇒ 视觉上「理由」框堆满长文
⇒ 这解释了截图 2 的现象，且**不是 bug，是映射粒度没对齐**
```

---

## §5 · 白板看板「工作区判断」问题

### 5.1 现象与实测

用户在「白板看板」页签看到的是 `aik_auto_memory_use` 工作区的事件（卡片标题 `2026-10-24 反思已落盘`）。

而当前会话的工作区是 `D:\dsh-auto-memory`，其 store 只有 2 个事件（`v4 底层改造…` / `项目白板`）。

### 5.2 取数链路（`lib/index.js` event-list handler）

```js
const pa = await engine.resolvePaths(undefined)   // ← ★这里传的是 undefined，不是 exec.agent
const storePath = path.join(pa.handoffDir, V4_EVENT_STORE_FILENAME)
const r = await eventStorePre.list(storePath, { ..., withPercept: true })
writeJson(res, 200, r)
```

**⇒ `resolvePaths(undefined)` 会回落到「default runtime 的工作区」或「最近活跃工作区」，**
**而不是「发起请求的那个会话所属的工作区」。**

这解释了为什么用户在当前会话点「白板看板」，看到的是另一个工作区的事件。

### 5.3 与既有缺陷家族的关系

```
这已经是「混用 this.state 与 stateFor(agent)」家族的**第 5 种表现**：
  ① C2 memLegacy（切新格式后提醒不消失）
  ② H3-E buildReadOverviewPre（项目总览段静默读不到）
  ③ U7 upgradeState（完成提醒停在第一次）
  ④ buildTierLayerInjection / renderSlimSnapshotPre（有 agent 参数却读 default）
  ⑤ ★本条：**路由 handler 里 resolvePaths(undefined)** ⇒ 取错工作区

共同根因：**「哪个工作区」这件事，在写点与读点用了不同口径**。
```

---

## §6 · 修复方案（三件，按优先级）

### P0 · 白板看板取对工作区（用户直接可见）

```
改点：lib/index.js event-list / event-detail 两条 handler
改法：resolvePaths(undefined) → resolvePaths(req 对应会话的 agent)
     若 handler 拿不到 agent，则从 sessionId 反查（既有 resolvePaths(agent) 已是权威源）
判据：
  ① 两个不同工作区的会话分别请求 /event-list，返回各自的事件（不串）；
  ② 负路径：单工作区场景结果不变（不引入回归）。
```

### P1 · 自动沉淀归位到「日记类」（按用户裁定）

```
用户原话：「这个自动沉淀不是像日记一样没什么用的嘛。它属于是放到每日的，就是长期记忆嘛；而日记类的，它是独立的」

⇒ 裁定：自动沉淀 **不进事件**，它是日记类。**保持现状（appendText 直写日 .md）是对的。**
   ★这纠正了我之前的判断 —— 我说「自动沉淀绕过事件层 = 缺陷」，**错了**。
     按设计它本来就该走日记层，不该进事件。

真正要修的是**另一侧**：memory_log 把日记行灌进事件（见 P2）。
```

### P2 · memory_log 与事件的关系要重新定义（核心）

```
当前：memory_log → appendCheckpointPre（日记行变检查点）
问题：日记行是「日粒度流水」，事件检查点应是「事件粒度进展」
      ⇒ 两者粒度不同，硬灌会让事件里全是流水（实测：161 检查点 0 个有 percept）

三条候选（待用户裁决）：
  A. memory_log 回归「只写日记 .md」，**不写事件**
     ⇒ 事件只由 memory_event 显式创建/追加（真正的事件粒度）
     ⇒ 代价：日记与事件彻底分离，事件需要模型主动写，覆盖率可能低
  B. memory_log 仍写事件，但**合并到同一检查点**（同一天同一事件只一个检查点，追加 text）
     ⇒ 减少流水感，但检查点会变成「一天的汇总」
  C. memory_log 双写但**检查点带标记**（kind=log），前端默认折叠日志类检查点
     ⇒ 保留可追溯性，但事件里仍有流水
```

### P3 · 四类 percept 的生产侧设计（H4 只做了消费侧）

```
现状：H4 接线完成（消费侧 OK），但**没有任何代码在填它们**
原型也写着「本期只建结构，未填充」

需要在两处补「生产」：
  ① memory_event 工具描述补操作指引（什么时候填哪类）
  ② 自动沉淀的 subagent prompt 里，让它**顺带产出 percept 建议**（但按 P1 不进事件 ⇒ 只作为候选给模型参考）
```

---

## §7 · 待用户裁决（三件）

| # | 问题 | 选项 |
|---|---|---|
| **D1** | `memory_log` 该不该写事件？ | A 只写日记 / B 合并成日检查点 / C 双写+前端折叠 |
| **D2** | 白板看板该显示哪个工作区？ | A 当前会话工作区（推荐）/ B 全局合并 / C 用户可切 |
| **D3** | 四类 percept 何时填？ | A 只给模型操作指引（靠主动性）/ B 自动沉淀时顺带生成 / C 迁移时批量提取历史 |

---

## §8 · 本文档的证据清单（全部可复算）

```
【设计文档】
  artifacts/V4-MASTER-PLAN-2026-10-24.md  §1.4.1 Q1-Q5 裁决（L196-206）
                                          §1.4.2 蒸馏链三环表（L209-220）
【原型】
  artifacts/wb-event-preview/index.html   payload.perceptFields.note = "本期只建结构不用"
                                          Event 顶层 22 字段含四类 percept
                                          Checkpoint 顶层 18 字段无 agentTrace/sharedGround
                                          footer 明文「四个 percept 字段本期只建结构，未填充」
【代码】
  lib/index.js  L14891 附近   auto-consolidate 三支全部 appendText，0 处 appendCheckpointPre
  lib/index.js  memory_log    idemKey = log:日期:时间:hash，走 appendCheckpointPre
  lib/ev4-adapter.js L146     rationale: sPre(sec.deadend)
【本机实测】
  工作区 A：evt_dfc30819 113 检查点 / 39 条 log 格式；evt_89786878 48 / 17 条
  工作区 B：evt_605d3053 20 检查点 / 20 条 log 格式（100%）
  全库：161 个检查点中 0 个有 percept（0.0%）
```
