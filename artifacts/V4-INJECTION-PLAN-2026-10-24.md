# v4 注入面改造方案（完整版・草案，仅方案不施工）

> 产出：2026-10-24 12:4x · 只读调研，lib/ 与 tests/ 零改动
> 触发问题（用户原话）：「注入完整版的地方不只是给模型的遵循 prompt，还有最近记忆的信息。这个该如何改造？……接续的话，现在是不是也有应该在新方案下改的点？」

---

## 0 · 一句话结论

**现在的「完整版注入」是一条平铺的字符流，遵循 prompt 与记忆内容混在同一本预算账里、共用同一个淘汰序。**
改造 = 把它拆成**三个有独立契约的区**（遵循区 / 记忆区 / 通道区），并且**把记忆区的取用判据从「文件位置」换成「事件时间」**。
接续链要改 5 个点 + 加 2 个结构化块 —— 否则新会话必然建出第二个重复事件，比现在更糟。

---

## 1 · 实测基线（全部真执行，可复算）

### 1.1 复算方法（可重跑）

```
node artifacts/probe-overlap.mjs                    # 规则段 vs 记忆段重复度
node artifacts/probe-head-truncation.mjs            # 头截断注入的是哪个日期
node artifacts/probe-plan-trunc.mjs                 # PLAN 截断丢几个节
node artifacts/probe-ledger-trim.mjs                # 账本两种截法覆盖对比
node artifacts/probe-chronology-vs-convention.mjs    # 记忆文件成分
node artifacts/probe-real-tier0.mjs                 # 真实 Tier-0 目录与逐层配额
node artifacts/probe-slim-len.mjs                   # 精简版各层字符
node artifacts/probe-injection-truth.mjs            # ★权威值：用真实 Tier-0 文本复算 12 段全量
```

做法：从 `lib/index.js` 用花括号配平抽出 `renderMemoryDynamic`，注入真实 helper + `memory-envelope.js` + `injection-policy.js`，喂**磁盘上的真实记忆文件**（用户级 MEMORY.md 24,052 字符、工作区 MEMORY.md 23,981、handoff/PLAN.md 8,543、最新账本 2,463），跑真实 `composeMemoryEnvelopePre`。

### 1.2 真实完整版 = 17,515 字符 / 12 段

| 段 | 字符 | 占比 | 类别 |
|---|---:|---:|---|
| rules-section | 7,427 | 42.4% | **P 遵循** |
| user-memory | 1,676 | 9.6% | M 记忆 |
| project-notes | 1,662 | 9.5% | M 记忆 |
| recent-logs | 1,475 | 8.4% | M 记忆 |
| frame-inscription | 1,430 | 8.2% | **P 遵循** |
| whiteboard-plan | 1,337 | 7.6% | M 记忆 |
| tier0-catalog | 1,201 | 6.9% | M 记忆 |
| handoff-ledger | 824 | 4.7% | M 记忆 |
| frame-head | 302 | 1.7% | **P 遵循** |
| frame-meta | 86 | 0.5% | **P 遵循** |
| workspace-map | 78 | 0.4% | M 记忆 |
| frame-tail | 17 | 0.1% | **P 遵循** |

- **P（遵循 prompt）合计 9,262 = 52.9%**
- **M（最近记忆信息）合计 8,253 = 47.1%**
- config `injectBudgetChars = 8000`，实际 17,515 ⇒ **已超 2.19 倍**，只产生一条 `over-budget-total` 降级，不裁剪。
- `memRefLimit = 9,900`（memoryReferences 上限），实际 8,175 ⇒ 有 1,725 余量（**这是唯一的真余量**）。

> 注：`injection-policy.js` 的 17 段是**代码里的可能段**；本机真实渲染出 12 段（reflection / calendar / external / sessions / welcome / handoff-pointer 无条件不成立）。**施工与验收必须以「实际渲染段」为准，不能按 17 段算。**

### 1.3 三个「最近的记忆」其实都不是最近的（★本节是核心证据）

| 段 | 实际用的函数 | 实测结果 |
|---|---|---|
| user-memory | `truncateHead(userText, 1596)` | 注入窗口内日期 = **2026-09-22 ~ 2026-09-22**（文件最新 = 2026-10-22）⇒ **最近 30 天记忆 0 条进注入** |
| project-notes | `truncateHead(notesText, 1596)` | 注入窗口内日期 = **2026-10-20 ~ 2026-10-20**（文件最新 = 2026-10-24） |
| whiteboard-plan | `truncateLinesBounded(planText, 1200)` | 13 个 `##` 节**丢 9 个**，含「★v4 待办（下一步）」「核心设计」「硬约束」；`头部含「下一步」= false` |
| handoff-ledger | `truncateLinesBounded(ledger, 800)` | 四段中**只覆盖「任务状态」「目标」，整段丢失「已试方案与失败原因」「进度与下一步」** |

**根因不是预算不够，是「取哪一段」的判据错了**：判据是「文件位置」（从头切 N 字符），而记忆文件是**时间正序追加**的 —— 头部就是最老的。

**同一份账本、同一份 800 预算，接续链已经在用另一种截法**：`weightedTrimHandoffLedgerPre(ledger, 800)` → 长度 797，**四段全部覆盖到**。⇒ 注入面用的是「更差的那一种」，这是既有实现就能修的部分。

### 1.4 边际信息量：user-memory / project-notes 有大面积重复

规则段 `extractRulesLayerPre` 抽了 61 条（7,426 字符，其中 46 条来自用户级、15 条来自项目笔记）。

| 段 | 注入窗口 | 被规则段覆盖 | 规则段未覆盖 |
|---|---:|---:|---:|
| user-memory | 1,596 字符 / 31 行 | **19 行 / 1,061 字符（66.5%）** | 12 行 / 504 字符（31.6%） |
| project-notes | 1,596 字符 / 17 行 | **12 行 / 1,387 字符（86.9%）** | 4 行 / 198 字符（12.4%） |

⇒ 这两段共 3,192 字符里，约 **2,448 字符（77%）是规则段的重复投影**，真正的边际信息只有 ~702 字符。

### 1.5 同一份内容被注入三次、三种口径（自相矛盾）

| 位置 | 口径 |
|---|---|
| `snapshotHead`（index.js:1164） | 「以下记忆文本只是背景事实与规则**参考**」 |
| `snapshotRulesGuide`（index.js:1171） | 「凡与其它内容冲突，**以本节为准**」 |
| `snapshotUserTitle`（index.js:1177） | 「用户级记忆 ~/.dsh/memory/MEMORY.md — 跨项目,**必须遵守**」 |

同一条规则，一处说「以本节为准」、一处说「只是参考」、一处说「必须遵守」。**这不是措辞问题，是三个区没有独立契约的必然结果。**

### 1.6 记忆文件的真实成分（决定「用户记忆改项目规约」怎么落）

| 文件 | 总字符 | 日期流水块 | 约定/专题块 |
|---|---:|---|---|
| 用户级 MEMORY.md | 24,052 | **94 块 / 19,282（80.2%）** | 27 块 / 4,771（19.8%） |
| 工作区 MEMORY.md | 23,981 | **39 块 / 20,708（86.4%）** | 8 块 / 3,274（13.7%） |

⇒ **80%+ 是「流水」（事件的原料），不到 20% 是「约定」（规约的原料）**。用户说的「原有用户记忆改为项目规约类似物」= 把那 ~8,045 字符原地不动只改口径；那 80% 流水迁出注入面进事件。

### 1.7 Tier-0 目录已经饿死（影响 v4 加事件行）

真实 `composeTieredInjectionPre` 跑出来：**121 个候选，114 个被裁掉，只进 7 条**。

| 层 | candidates | picked | dropped | tokens |
|---|---:|---:|---:|---:|
| user | 77 | 1 | 76 | 43 |
| project | 28 | 4 | 24 | 235 |
| whiteboard | 13 | 2 | 11 | 118 |
| log | 2 | 0 | 2 | 0 |
| reflection | 1 | 0 | 1 | 0 |

tier0Tokens = **396 / 400**（maxTokens 已是 400）；真实渲染出的 tier0-catalog 段 = **1,201 字符**（含降级行与层账）。

⇒ **旧施工文档里「T0 事件行属替换、tier0 原有 776 预算」这句话是错的**：实际可用余量只有 **4 token**（且段内已有 114 条候选被裁）。加事件行必须**同时**做三选一：(a) 提高 `tier0MaxTokens`；(b) 事件目录**独立于** Tier-0 另开一段；(c) 显式降低别的层的 floor。**这一条必须在施工前拍板，否则 T0 加事件行等于把 user 层从 1 条压到 0 条。**

### 1.8 精简版实测 1,105 字符

| 层 | 字符 |
|---|---:|
| snapshotHead | 302 |
| snapshotMeta | 71 |
| snapshotSlimGuide | 178 |
| snapshotSlimRecallHit | 90（条件式） |
| snapshotSlimNote | 59 |
| snapshotSlimMaintain | 240 |
| snapshotSlimRecallNote | 149 |
| snapshotTail | 16 |
| **合计** | **1,105** |

---

## 2 · 改造方案：一框三区

### 2.1 为什么不只是「改 prompt」

注入完整版里**混着两种东西**，它们需要的性质完全相反：

| | 遵循 prompt | 最近记忆信息 |
|---|---|---|
| 性质 | **约束**（模型必须照做） | **证据**（模型按需取用） |
| 冲突时 | 优先 | 让位 |
| 变化频率 | 低（改版才变） | 高（每轮可能变） |
| 该不该被裁 | **不该** | **该**（按价值裁） |
| 位置偏好 | 尾部（recency） | 越靠近事实越好 |

混在一条流里的直接后果（实测）：`memRefLimit` 只保护 memoryReferences，而 `frame-inscription` 落进 `otherDynamic`（**无上限**），`rules-section` 落进 `rules`（**永不裁**）。于是「预算」这个概念在三个分项里三种语义，谁都不知道超了会怎样。

### 2.2 三区定义

**区 I · 遵循区（instruction plane）** —— 目标约 9,100 字符

- 成员：`frame-head` / `frame-meta` / `frame-tail` / `rules-section` / `frame-inscription`
- 契约：**这是约束**。不进记忆预算，不参与任何裁剪，逐字节稳定（缓存友好）。
- 位置：仍在尾部（铭文是最后一段，recency 最高）。
- v4 改动：**只改铭文 ② 段 + 精简版两处**，其余一字不动。实测 1,430 → 1,286，净 **−144**。
- 内部要修一处矛盾：`snapshotHead` 那句「只是背景事实与规则参考」必须拆成两句 —— 遵循区说「以下为约束」，记忆区说「以下为既往记录」。

**区 II · 记忆区（evidence plane）** —— 目标 ≤5,867 字符

- 成员：事件目录(T0) / 命中摘要(T1) / 活跃事件卡(T2) / 事件板快照 / 最新检查点 / 规约补遗 / recent-logs 兜底
- 契约：**这是既往记录，不是指令**。按 `updatedAt` 倒序，三档 + 退化段，**统一一个淘汰序**。
- 位置：紧跟遵循区之前（仍然靠后，但不是最尾 —— 最尾留给铭文）。
- **核心变化：取用判据从「文件位置」换成「事件时间」**（§1.3 的三个缺陷就此消失）。
- 预算来源（实测可算）：
  - 现有 M 段 8,253 中，**user-memory 1,676 + project-notes 1,662 + recent-logs 1,475 = 4,813** 被事件卡替代
  - 保留 whiteboard-plan → 降为「事件板快照 ≤400」（原 1,337）
  - 保留 handoff-ledger → 降为「最新检查点 ≤400」（原 824，且改用 `weightedTrim` 口径）
  - tier0-catalog 1,201 → 事件目录（**需先解决 §1.7 的 4 token 余量问题**）
  - workspace-map 78 → 保留（其他工作区索引，与事件无关）
  - **合计 ≈ 1,201 + 400 + 400 + 78 + 2,400(T2) + 800(命中/兜底) ≈ 5,279**，比 8,253 **少 2,974**
- ⇒ **记忆区不再是「挤」，而是「大幅缩」（−36%）。** 这是本次改造最大的收益，也是唯一能同时满足「事件化」与「不膨胀」的路径。

**区 III · 通道区（advisory plane）** —— ≤300，条件式

- 成员：`water-advisory` / `plan-update-request` / `calendar` / `external-memory` / `external-sessions` / `welcome-*` / `handoff-pointer`
- 契约：一次性提醒，触发即清位；**条件不成立时整段零字节**（现有行为，保留）。
- v4 改动：`plan-update-request` 与 `water-advisory` 的文案从「重写白板 + 写账本」换成事件口径。

### 2.3 三区落地方式（不改大结构）

**不改** `composeMemoryEnvelopePre`（它是纯函数、有 3 条不变式、被锁住）。只做两件事：

1. **把 `frame-inscription` 从 `otherDynamic` 挪进 `rules` 分项**（`pushPart('rules', 'frame-inscription', …)`）。理由：它是**约束**，落 otherDynamic 会变成「无上限且可被 normal 丢弃」，与它的 `'must'` 标记矛盾。这一步是**改一个字符串**，但会让 `envelope.chars.rules` 从 7,427 变成 8,713 —— **所有锁 rules 字符数的断言会红，必须按 R12 纪律重新钉**。
   > 替代（更保守）：不动分项，只把 `otherDynamicBudgetChars` 默认值设成一个覆盖三区的数。**二选一，需拍板。**
2. **给记忆区新加一个「源」抽象**：`state.eventCardsText` / `state.eventArchiveText`，与既有 `tier0LayerText` 同性质（refresh() 预计算 → renderMemoryDynamic 只读）。**不在 renderMemoryDynamic 里做 IO** —— 该函数被源码抽取式测试以 `new Function` 独立执行，任何新 import/IO 都会让 47 个套件集体失效。

### 2.4 逐段改造表（12 段实际渲染段）

| 段 | 现字符 | v4 处理 | 目标 |
|---|---:|---|---:|
| frame-head | 302 | **改文案**：拆「约束 / 记载」两句 | ~360 |
| frame-meta | 86 | 不动 | 86 |
| rules-section | 7,427 | **M1 冻结，不动** | 7,427 |
| frame-inscription | 1,430 | **改 ② 段**（全文已定稿） | 1,286 |
| frame-tail | 17 | 不动 | 17 |
| workspace-map | 78 | 不动 | 78 |
| tier0-catalog | 1,201 | **改**：加事件层（先解 §1.7） | ≤1,201 |
| whiteboard-plan | 1,337 | **改**：事件板快照 | ≤400 |
| handoff-ledger | 824 | **改**：最新检查点（用 weightedTrim 口径） | ≤400 |
| user-memory | 1,676 | **撤**：规约补遗（只留规则段未覆盖的约定块） | ≤600 |
| project-notes | 1,662 | **撤**：同上 | （合并上一条） |
| recent-logs | 1,475 | **降为兜底**：仅当 active 事件数 = 0 时出现 | ≤800 |
| **event-cards（新）** | 0 | **新增**：T2 活跃事件 | ≤2,400 |
| **合计** | **17,515** | | **≈14,300（典型）/ ≤15,300（最坏）** |

### 2.5 三个「必须先解决」的冲突

1. **Tier-0 只有 4 token 余量**（§1.7）。事件目录放不进去。三选一待拍板。
2. **`frame-inscription` 分项归属**：挪进 `rules` 会让 8 个以上字符数断言全红；不挪则它在 `otherDynamic` 无上限。二选一待拍板。
3. **`user-memory` / `project-notes` 撤到什么程度**：规则段已覆盖 66.5% / 86.9%，理论上可以撤到只剩「规则段未覆盖的 ~702 字符」。但**规则抽取器只认 `- ` 行**；若某约定写成段落（非 `- ` 行），抽取器抓不到 ⇒ 撤掉就真丢了。**必须先跑一遍「规则段未覆盖且非 `- ` 行」的普查**，才知道能不能撤。这条**不在本方案里给结论**，应当作施工前的前置普查（~30 分钟）。

---

## 3 · 接续链：在新方案下必须改的 5 个点 + 2 个新增

### 3.0 为什么这件麻烦事必须一起做

`eventId` 在整个 `lib/index.js` 出现 **0 次**（实测 grep）。接续链返回的 23 个字段全是路径/模型/序号。新会话首条消息里**没有任何事件标识**。
而 v4 铭文的 ② 段要求模型「开工先判定任务归属」。两条一叠加：

> 新会话第 1 步读铭文 → 第 2 步找不到 eventId → 第 3 步只能 `memory_event(create)` → **同一任务变成第二个事件**，旧事件永远停在 active、再无人 `append`。

⇒ **事件越多越乱，比现在更糟。** 所以下面 5 个点不是「优化」，是「不这样改就不能上事件」。

### 3.1 五个必改点

| # | 位置 | 现状 | 改法 | 风险 |
|---|---|---|---|---|
| **1** | `refreshRitualPrompt()` @ index.js:6253 | 只要求 `memory_note(kind=plan)` + `memory_note(kind=handoff)`；旧会话不知道自己的 eventId | 加第 0 步「先读回我的 eventId」；账本降为「原文载体」但**必须带 eventId 引用**；判定成功 = 该事件 `checkpoints` 长度 +1 | 中：仪式失败会中止接续（:5809 只在 `disabled / handoff-disabled` 时放行） |
| **2** | `handoffMaterialStamp()` @ index.js:6277 | `stat(PLAN).mtime + '竖线' + 最新账本名`；注释自承 TODO：读的是**当前工作区**的 handoffDir | 改判 `eventStore` 里该事件 `updatedAt` + `checkpoints.length`；顺手把 TODO 修掉（改走已在用的 `resolvePathsForSession(sid)`） | 低：一句话改动 |
| **3** | `buildContinueCarry()` @ index.js:6565 | 23 个返回字段无事件标识；carryText 只有第0/1/2/3层 | 返回加 `eventId` / `eventName`；carryText 的 **head 区**（永不截断）加两行：【你正在续接事件 …】【未完成项 …】 | 中：head 区永不截断，写多了会挤 nav |
| **4** | 水位骨架账本 @ index.js:5359-5412 | 越阈就 `writeHandoffLedger` 一篇四段骨架，判据门失败照样写 | 改写进事件的 `checkpoints`，`kind='water'`、`sourceRef='auto:water'`；T2 渲染时这类检查点折叠、不占主叙事位 | 中：这是「最新账本」的主要污染源 |
| **5** | `planUpdatePending` @ 5347 / 5484 | **写**在无 ALS 上下文里（心跳/路由）⇒ 落到 default runtime；**读**在 `withAgent` 内 ⇒ 读该 agent 的 runtime | 置位改走 `runtimeFor(agent).state`；或干脆去掉这个待办，改由「事件缺 checkpoint」推导 | ⚠️ **静态推断，施工时必须实跑确认**（不确认不许改） |

### 3.2 两个新增（不是改，是加）

**新增 A · carry 的结构化块**

现在 carryText 是纯自然语言散文，新会话只能「读」它，不能「用」它。加两块进 **head 区**（与现有 nav 区同等待遇：**永不截断**）：

```
【事件绑定】eventId=evt_pre_ab12cd34  name="v4 注入面改造"  status=active
【未完成项】- ①给 injected plane 写测试  - ②确认 Tier-0 余量
```

理由：`assembleCarryPre({head, nav, bulk, budget: 18000})` 已区分三段，`nav` 先扣配额永不 slice（:1403-1406）。事件绑定是「逃生通道」同族，不能进 bulk。

**新增 B · 接续链的「事件存在性」硬门**

`buildContinueCarry` 现有唯一硬门（:6590）：
`if (!plan && !ledger && !(pack && (pack.tailText || …))) return { ok:false, error:'no handoff material' }`
v4 后要有第三条合法材料：**「该事件存在且有 active checkpoint」也算材料**。否则「事件已建但还没写账本」的会话接不过去。

### 3.3 三个「语义变化后会失准」的既有判定（不是必改，但要复核）

| 位置 | 判定 | v4 后 |
|---|---|---|
| index.js:6590 | 接续硬门看 PLAN/账本/转写包 | 见 §3.2 新增 B |
| index.js:8514 | `if (handoffEnabled !== false && (s.planText 或 s.latestHandoffText))` 决定整段白板/账本是否出现 | 事件存在但 PLAN 空 ⇒ 该段整段消失（连标题都没有） |
| index.js:7327 | 无 PLAN/账本 ⇒ 跨工作区扫「全局最近账本」 | 事件化后这个兜底会扫到**别的任务**的账本，应改为扫「最近事件」或不扫 |

### 3.4 顺带发现的三个死项（同族，施工时可一并处理）

1. **`/handoff-continue` 是死路由**：index.js:19745 有完整实现，client.js:3734 只有常量、**全仓无调用**；只剩 5 个测试在调它（`smoke-test-continue-host.mjs` / `contseq.mjs` / `issue207-routes.mjs` / `audit-g-207.mjs` / `autocont-host.mjs`）。GUI 实际走 `auto-continue-decide` 的 `manual` 分支。
2. **`slimPlanChars / slimLedgerChars` 名存实亡**：默认 400 / 300，**全仓 0 处读取**（只有定义行 + client.js:12445 的注释），且精简版早已把白板/账本整块移出。设置页文案却还在承诺「精简轮注入里白板 PLAN 的字符上限」。
3. **`handoffMaterialStamp` 的 TODO 是真的**：注释自承跨工作区接续时比较的是另一个目录。**这是独立于 v4 的真 bug**，一句话可修。

---

## 4 · 施工顺序（增量，不推翻已定的六批）

本方案**不新增批次**，只往既有批次里插：

| 批次 | 原内容 | 本方案追加 |
|---|---|---|
| 前置 | 命名拍板 | **+3 项拍板**：Tier-0 余量方案 / frame-inscription 分项 / user-memory 能否撤（需先普查） |
| 批次 1（数据层） | event-store | 无 |
| 批次 2（工具层） | memory_event | 无 |
| **批次 3（注入+检索）** | 铭文 4 处 + 新增 2 段 | **+三区分项调整 + 三个截断方向修正 + 事件目录接入** |
| **批次 3.5（新增）** | — | **接续链 5 点 + 2 新增**（约 3.5h） |
| 批次 4（前端） | 事件视图 | 无追加 |
| 批次 5（配置+设置页） | 新配置键 | +废弃 `slimPlanChars/slimLedgerChars`（或补实现） |
| 批次 6（收尾） | 回归 | +死路由处置决定 |

估时修正：**17.75 h → 约 21.5 h**（+3.5h 接续链 +0.5h 三区分项，其中 0.25h 是普查）。

---

## 5 · 验收（每条都带负路径）

| # | 验收项 | 判据 | 负路径 |
|---|---|---|---|
| V1 | 三区分项正确 | `envelope.chars` 里 `rules` 含 frame-inscription，且 `memoryReferences` **不含** | 把 frame-inscription 挪回 otherDynamic ⇒ 断言必红 |
| V2 | 记忆区取用方向 | 构造两篇账本（一旧一新），断言注入的是**新**的那篇 | 把 `weightedTrim` 换回 `truncateLinesBounded` ⇒ 「进度与下一步」丢失，断言必红 |
| V3 | 事件按 updatedAt | 构造 3 个 active 事件（updatedAt 乱序），断言 T2 只放最新 1–2 个 | 改成按 id 排序 ⇒ 顺序错，断言必红 |
| V4 | 无事件时退化 | `eventCount=0` ⇒ 注入里**含** recent-logs、**不含** event-cards | 让 event-cards 常驻 ⇒ 必红 |
| V5 | 事件目录不挤别的层 | 加事件行后 `perLayer.user.picked` **仍 ≥1** | 不调 tier0MaxTokens ⇒ user 层变 0，必红 |
| V6 | 接续带 eventId | 真调 `buildContinueCarry`，断言返回 `eventId` 非空且 carryText 含【事件绑定】 | 去掉该字段 ⇒ 新会话 create 第二个事件（可用「事件数不增」作端到端负路径） |
| V7 | 仪式判据认事件 | 事件 checkpoints +1 但 PLAN 未动 ⇒ 仪式判 `updated` | 仍用 `planMtime` ⇒ 判超时，必红 |
| V8 | 骨架检查点可折叠 | T2 渲染里 `kind='water'` 的检查点不出现在主叙事位置 | 让它进主叙事 ⇒ 断言必红 |
| V9 | 总量不膨胀 | 完整版 ≤15,300 字符（现状 17,515） | — |
| V10 | 缓存不退化 | 遵循区逐字节稳定：同日两次渲染 sha256 相同 | — |

> 全部验收必须**真执行**（真 import → 真构造 → 真调用 → 断言返回），禁止「源码含某字符串」。

---

## 6 · 需要你拍板的 3 件事（其余我都给了推荐）

| # | 问题 | 我的推荐 | 不定的后果 |
|---|---|---|---|
| **Q1** | Tier-0 只剩 **4 token** 余量，事件目录怎么放？ | **(b) 事件目录独立于 Tier-0 另开一段**（不动 B0=800 这个冻结常量，`event-catalog` 单独 ≤400 字符） | 选 (a) 要改 B0 契约（18 个断言）；选 (c) 会把 user 层压到 0 |
| **Q2** | `frame-inscription` 要不要从 `otherDynamic` 挪进 `rules`？ | **挪**。它带 `must` 却落在无上限分项里，语义与保护等级矛盾 | 不挪 ⇒ 铭文超预算时可能被「normal 丢弃」，而它是收尾自检位（recency 最高） |
| **Q3** | `user-memory` / `project-notes` 能否撤到只剩「规则段未覆盖部分」？ | **先普查再定**。需先跑「规则段未覆盖且非 `- ` 行」的块普查（~30 min），确认不会真丢内容 | 直接撤 ⇒ 可能丢掉规则抽取器抓不到的段落型约定（不可恢复） |

---

## 7 · 自我复核（8 条实测断言，逐条脚本验过）

| # | 断言 | 值 | 验证脚本 |
|---|---|---|---|
| A1 | 完整版真实字符数 | 17,515（真实 Tier-0 1,114 字符） | probe-injection-truth.mjs |
| A2 | P/M 占比 | 52.9% / 47.1% | probe-injection-truth.mjs |
| A3 | user-memory 注入窗口日期 | 2026-09-22 单日（窗口 1,596） | probe-head-truncation.mjs |
| A4 | PLAN 丢节数 | 9 / 13 | probe-plan-trunc.mjs |
| A5 | 账本头部截断丢段 | 2 / 4 段 | probe-ledger-trim.mjs |
| A6 | 规则段覆盖记忆段比例 | 66.5% / 86.9%（窗口 1,596） | probe-sub1596.mjs |
| A7 | Tier-0 余量 | 396/400 token，121 候选裁 114，段 1,201 字符 | probe-real-tier0.mjs |
| A8 | 精简版字符 | 1,105 | probe-slim-len.mjs |

---

## 8 · 一句话

> **遵循 prompt 与记忆内容必须分区 —— 一个不能被裁，一个必须被裁；一个要「以本节为准」，一个要「只是既往记录」。**
> **而记忆区的取用判据必须从「文件位置」换成「事件时间」：现在三个「最近的记忆」段，实测注入的都是一个月前的。**
> **接续链不跟着改，事件化上线第一天就会开始复制事件 —— 所以那 5 个点是必改项，不是优化项。**

---

## 附录 A · 三个待确认项（我怕自己判断错，写在这里）

| # | 我的判断 | 依据 | 怎么快速验证 |
|---|---|---|---|
| B1 | `planUpdatePending` 的写入与读取不在同一个 runtime | 写点在心跳 setInterval / 路由 handler，均无 `withAgent`；读点在 `withAgent` 内 | 施工时加一行临时 diag 打印 `state.ws`，跑一次水位越阈即可（5 分钟） |
| B2 | 规则抽取器只认 `- ` 行 | 规则段 61 条全部以 `- ` 开头；`extractRulesLayerPre` 用行首匹配 | 读 `lib/rules-layer.js:211-320` 的解析段（5 分钟） |
| B3 | `weightedTrimHandoffLedgerPre` 的段权重对事件检查点同样适用 | 它按 `## 任务状态/目标/已试方案与失败原因/进度与下一步` 四个标题定位；事件检查点的 `sections` 键名一致 | 直接复用即可，但它**不认**新的事件字段，需扩一版（0.5h） |

---

## 附录 B · 三张图

| 图 | 内容 | 文件 |
|---|---|---|
| P1 | 注入完整版「一框三区」改造 + 同一份记忆被注入三次的证据 | `artifacts/_diagrams/P1-three-planes.png` |
| P2 | 「最近记忆的信息」为什么不是最近的（三个案例实测） | `artifacts/_diagrams/P2-recent-is-not-recent.png` |
| P3 | 接续链 5 个必改点 + 2 新增 | `artifacts/_diagrams/P3-continuation-rewire.png` |
