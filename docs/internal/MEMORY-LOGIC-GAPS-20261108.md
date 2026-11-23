# 记忆系统逻辑缺环与平行功能联动审计（只读）

- 审计对象：dsh-auto-memory（工作区 D:/dsh-auto-memory，分支 preview）
- 记忆根：`C:/Users/JH Z/.dsh/memory/`（下称 MEM）；本工作区 `MEM/workspaces/--D--dsh-auto-memory--/`（下称 WS）
- 实测时间：2026-11-08 06:14–06:40（Asia/Hong_Kong）
- 纪律：全程只读；未改 lib/tests/tools/skins，未改配置，未跑生成器，未调用任何 memory_* 写工具。
- 边界：不查「有代码没接线」（任务 C）、不查事件归组根因（任务 A）；只查「根本没实现」与「两个都在跑但不通」。

---

## 0. 结论速览

1. **任务书里的三条「已确认可疑缺口」全部不成立，但每一条都被同一个更基础的问题误读：插件把记忆同时写在「用户级根目录」与「工作区目录」两套位置，而审计面只看了工作区那一套。**
   - 技能库：WS/hub/procedures.json 0 条属实，但**通用库 `MEM/hub/procedures.json` 有 115 条 / 308,452 B**，且已导出 18 个 `~/.dsh/skills/mem-skill-*` 目录（本轮会话的 available_skills 里可见）。
   - 时段总结：WS/summaries 停在 2026-09-01 属实，但**用户级 `MEM/summaries/` 有 114 个文件、最后一个 2026-11-07-晚上.json（23:51）**，产出从未停。
   - 用户画像：确属每帧现算（`lib/user-portrait.js:116` `buildUserPortraitPre`，无持久化、无缓存）；但磁盘上另有一份**跨项目 person store**（`MEM/person/event-store.json`），没有任何代码读它。
2. **真正的断链集中在「记忆中枢（hub）三店」：写入量最大、下游消费者为零。** facts.conflicts 单文件 74,025,124 B / 64,327 条（其中 64,264 条未解决、无任何代码处置）、facts 1,000 条、episodes 198 条，全部只进面板 overview 与 storage-manage，**注入面与检索面零消费**；且整份 87,411,604 B 快照在每次 flush 时整体重写。
3. **平行功能联动断点共 6 处**：跨项目画像（写盘→零读）、hub 冲突库（写→零处置）、工作区技能库（读侧齐、写侧缺）、时段总结（写→只有弹窗）、白板（事件→白板无自动重绘，仅单向镜像）、归档统计口径（诊断读冻结旧目录）。
4. **真缺失 8 项**：淘汰/降权、TTL 生效、冲突处置闭环、跨形态去重、检索使用反馈进排序、备份自动恢复、迁移收尾、技能到模型的全量通道。
5. **计数：断链 6 · 真缺失 8 · P0 2**（P0 = hub 三店零消费 / person store 零读取端）。

---

## 1. 块 1 · 记忆生命周期全链路图

### 1.1 文字版链路（按实际代码顺序）

```
[模型/自动机] 产生
   ├─ memory_log ────────────┐（事件优先：先 append 检查点，再派生 .md 投影）
   ├─ memory_note(kind=handoff) ─→ 写 .md 账本 ─→ append 检查点(kind=handoff,含四段)
   ├─ memory_note(kind=plan)  ─→ 写 PLAN.md（CAS+M1 门）─→ 镜像事件头 sections ─→ append 检查点(kind=plan)
   ├─ memory_note(kind=note)  ─→ 追加项目 MEMORY.md / 用户级 MEMORY.md
   ├─ memory_event            ─→ 事件库 event-store.json（append-only）
   ├─ memory_reflect          ─→ reflections/YYYY-MM-DD.md（**不进事件**，代码注释明示派生链）
   ├─ memory_procedure        ─→ hub/procedures.json（scope 恒 global）+ active 时导出 SKILL.md
   └─ autoConsolidate(自动)    ─→ 日志 + 项目笔记/用户记忆 + hub episodes.append
          ↓
[存储] 每日日志 .md │ 项目 MEMORY.md │ WS/handoff/event-store.json │ 账本 .md │ PLAN.md
       │ reflections/ │ archive/ │ MEM/summaries/*.json │ MEM/hub/{facts,episodes,procedures}.json
       │ MEM/person/event-store.json（孤儿）
          ↓
[归组/聚合] 事件（append-only 容器）→ 事件头 sections / 检查点四段 / 四类感知
       ├─ 画像聚合：events[].userPercept → buildUserPortraitPre（每帧现算）
       ├─ 白板：memory_note(kind=plan, fromEvents) 时 renderPlanFromEventsPre 渲染
       └─ 事件重组：event-regroup-{scan,propose,apply}（人工触发）
          ↓
[注入] index.js:12333-13121 的 28 个 pushPart 段（rules / tier0-catalog / plan / ledger /
       event-cards / event-catalog / semantic-recall / user-portrait / calendar / external-memory …）
          ↓
[检索/唤回] memory_recall → 词法 + 语义/影子 + 事件召回 + scope=archive（含旧日志原文）
          ↓
[定期回顾] pendingReflection 提示 → memory_reflect；定时 maintain(10:00) / consolidate
          ↓
[蒸馏/固化] memory_consolidate（多日日志→项目笔记/用户记忆）；hub 语义判定喂数
          ↓
[归档] memory_maintain → archive/<日志>.md（原文整份归档，退出常规检索面）
          ↓
[淘汰] facts.pruneIfNeeded（仅 facts 环形淘汰）；其余形态**无任何淘汰/降权**
```

### 1.2 每环判定表

判据（任务书）：同时满足「有写入口」「有落盘」「有下游读者」才算通；缺任一项即为断链并标明缺哪一项。

| # | 环节 | 写入口（file:line） | 触发条件 | 落盘 | 下游读者 | 判定 |
|---|---|---|---|---|---|---|
| 1 | 产生 | `index.js:24364` memory_log / `:24627` memory_note / `:25232` memory_event / `:25119` memory_reflect / `:25429` memory_procedure；自动：`:18462` autoConsolidate | 模型显式调用；自动沉淀受 `autoConsolidate !== false` 与 `autoConsolidateMinChars`(240)/cooldown(30min)/dailyMax(8) 门控 | 见 #2 | 见 #3–#8 | **通** |
| 2 | 写入 | memory_log：`index.js:24434` `eventStorePathOfPre` → 先 append 检查点 → 派生当日 `.md`（H1「事件是源、日 md 是投影」`index.js:24420-24433`）；memory_note：`index.js:24787-24788` → `writeHandoffLedger` / `writePlanSnapshot`；事件：`lib/event-store.js` 单事务 append | 同上；写闸门 `sanitizeForWrite`（`:24409`）、复读防护 `tailHas`（`:24412`）、工作区绑定校验（`:24389-24404`） | 工作区 `.dsh-memory/` 与 `handoff/` | 注入（#5）与检索（#6）直接读这些文件 | **通** |
| 3 | 存储 | 见 #2；`lib/datadir.js:86` `memoryDir(name)` 收口目录名（去 pre，逐文件补齐，仅目标缺失/空壳时复制） | 首次访问某 datadir 时 | WS 与 MEM 两套物理位置 | 各读者 | **通（残缺）**：`datadir` 只补不改名，历史遗留目录仍在原地（`WS/summaries`、`WS/hub-pre`、`MEM/person`），见 P3-1 |
| 4 | 归组/聚合 | 事件：`lib/event-write.js:198` `createEventForWorkPre`、`:582` `appendHandoffCheckpointPre`；话题归属 `index.js:24458-24470`（#543：先主题相似度、找不到即新建）；白板镜像 `lib/event-write.js:661` `mirrorPlanSectionsPre`；画像 `lib/user-portrait.js:116`；事件重组 `lib/event-regroup-{scan,propose,apply}.js` | 每次写入；重组需人工/子代理发起 | event-store.json（43 事件 / 696 检查点） | 注入 event-cards/event-catalog、白板镜像、画像段 | **通（残缺）**：白板无「事件→白板」自动重绘（见 2.1 B 项）；事件重组无自动触发 |
| 5 | 注入 | `index.js:12333-13121` 共 28 个 `pushPart`；分区登记 `lib/injection-zones.js:62-73` | 每帧（完整版/精简版按节奏） | 不落盘（内存组装） | 模型 | **通**，但三个形态无注入通道：时段总结、hub 三店、person store（见块 2） |
| 6 | 检索/唤回 | `index.js:24998` memory_recall（enum 含 `archive`）；`index.js:14050` scope=archive 分支；`lib/recall-fusion.js`、`lib/shadow-retrieval.js`、`lib/event-recall.js` | 模型显式调用 | 读侧 | 模型 | **通** |
| 7 | 定期回顾 | `index.js:13394` pendingReflection 注入提示 → `memory_reflect`(`:25119`) → `saveReflection`(`:15890`)；定时 maintain `:16274`（默认 10:00） | 「昨日反思待生成」提示；定时 | reflections/*.md | 注入（Tier-0 目录层）+ 检索 | **通** |
| 8 | 蒸馏/固化 | `index.js:18791` memory_consolidate；自动 `:18462`；`lib/consolidate-filter.js`；hub 语义喂数 `:21684-21740` | 定时 / 模型显式 / 每轮自动沉淀 | 项目 MEMORY.md、用户 MEMORY.md、hub 三店 | 注入 rules-section（`:12442`） | **通（产出侧残缺）**：喂进 hub 的 facts/episodes 无注入消费者（P0-1） |
| 9 | 归档 | `index.js:25006` memory_maintain；`:18978-19010` 归档落盘 + 原文移出活跃面；手写白板归档 `:5180` | 定时 maintain（默认开）/ 模型显式 | `archive/<日志>.md`、`handoff/archive/` | 检索 scope=archive（`:14050`）、memory_read kind=archive（`:24948`） | **通** |
| 10 | 淘汰 | facts：`lib/fact-store.js:726` `pruneIfNeeded`（`maxFacts` 默认 1000）；其余形态：**无** | facts 写入时超上限 | 无 | — | **断链**：缺「淘汰/降权」环节（M-1 / P2-1） |

### 1.3 判「断」的六处（每处缺哪一项）

| 编号 | 环节 | 缺的是 | 证据 |
|---|---|---|---|
| D-1 | 跨项目画像（person store） | **下游读者** | `MEM/person/event-store.json`（4,676 B / 1 事件 / 5 条 accepted userPercept）存在；`grep -rn "'person'" lib/*.js` = 0 命中；事件自身 `sections.next` 写明「等 person store 读取端（U1 分层）落地后，本事件才会进入 [用户画像] 段；在那之前它只是磁盘存档」 |
| D-2 | hub 冲突库（facts.conflicts） | **下游读者 + 淘汰** | `MEM/hub/facts.json` 87,411,604 B，其中 `conflicts` 74,025,124 B / 64,264 条、`resolved:false` 占绝对多数、`conflictId` 唯一 64,327 个；消费点只有 `lib/memory-hub.js:297` `pendingConflicts()` 与面板计数 |
| D-3 | 工作区技能库（双库设计的一半） | **写入口** | `WS/hub/procedures.json` 0 条；模型直写通路 `index.js:25540-25550` 的 `cand` **不含 scope** ⇒ `lib/procedure-store.js:280` 回落 `PROCEDURE_DEFAULT_SCOPE_PRE_V1='global'`；唯一能写工作区库的是面板 `transfer-scope`（`index.js:27049-27058`） |
| D-4 | 时段总结（summaries） | **下游读者（模型侧）** | 写：`index.js:16178-16180` → `MEM/summaries/<date>-<period>.json`；读：只有 `GreetingCard`（`client.js:11987/12329/16908`）与 `debugInfo`；`memory_read` 的 kind enum 无 summaries（`index.js:24934`），`memory_recall` 亦不覆盖 |
| D-5 | 白板（PLAN.md） | **写入口（事件侧触发）** | 事件 append 路径（`lib/event-store.js`）无任何 plan 渲染调用；`renderPlanFromEventsPre` 调用点仅 `index.js:24721`（memory_note kind=plan + fromEvents）与 `lib/upgrade-apply.js:456/473` ⇒ 事件变了白板不变 |
| D-6 | 归档/统计口径 | **下游读者（读对文件）** | `index.js:15864` `summariesDir: await sizeMtime(path.join(p.projectDir,'summaries'))` 读的是**冻结的旧目录**（最后写 2026-09-01），而真实产出在 `MEM/summaries`（最后 2026-11-07 23:51）⇒ 诊断面与面板显示的是过期体积 |

---

## 2. 块 2 · 平行记忆形态的联动矩阵

### 2.1 12×12 矩阵（行 = 读者，列 = 被读）

符号：**↔** 双向联动 · **→** 单向（行读列） · **◐** 条件/门控联动 · **▣** 同一写入路径的两份投影（同源） · **✗** 无联动 · **—** 自身

| 读者 \ 被读 | 事件库 | 白板 | 账本 | 日志 | 反思 | 时段总结 | 技能库 | 日历 | 项目笔记 | 用户记忆 | 用户画像 | 归档原文 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **事件库** | — | ◐ 镜像 sections | → 检查点 | ▣ 先事件后投影 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **白板** | ◐ 仅手工 fromEvents | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **账本** | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **日志** | ▣ 派生视图 | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **反思** | ✗ | ✗ | ✗ | ◐ 提示词层 | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **时段总结** | ✗ | ✗ | ✗ | → 全局扫描 | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **技能库** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ | ✗ |
| **日历** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ✗ | ✗ | ✗ | ✗ |
| **项目笔记** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — | ↔ consolidate 双写 | ◐ 反向去重 | ✗ |
| **用户记忆** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ↔ consolidate 双写 | — | ◐ 反向去重 | ✗ |
| **用户画像** | → userPercept 聚合 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ◐ 去重输入 | ◐ 去重输入 | — | ✗ |
| **归档原文** | ✗ | ✗ | ✗ | ← maintain 产出 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | — |
| **注入面**（第 13 行，唯一的模型出口） | → event-cards/event-catalog | → whiteboard-plan | → handoff-ledger | ✗（仅 Tier-0 目录层） | ◐ Tier-0 目录层 | **✗** | ◐ emit 时 1 条 checklist + 宿主 skills | → calendar 段 | → rules-section | → rules-section | → user-portrait 段 | ✗ |

### 2.2 任务书点名要查的七组，逐条给证据

**① 检查点 kind=handoff ⇒ 会不会真的写出一份账本文件？—— 不会。方向是反的。**
- 真实方向：先写 .md 账本（`index.js:24787` `writeHandoffLedger`），**成功之后**才追加检查点（`lib/event-write.js:582-645`，`sourceRef` 回指账本路径，四段映射 `goal→goal / doing→state / deadend→dead / next→next`，见 `:615-621`）。
- 反查：磁盘上的账本 .md 与事件检查点能对上 —— 检查点 `sourceRef` 存账本绝对路径、`checkpoints[].text` 存账本全文（注释 `:643`「账本全文已完整保存在检查点的 text 字段里」）。
- 断点：**事件侧没有任何反向写 .md 的能力**。一个只有检查点 kind=handoff、没有对应 memory_note 调用的事件，永远不会产生账本文件。

**② 检查点 kind=plan ⇒ 会不会真的更新白板？—— 不会，同样是反的。**
- 真实方向：`memory_note(kind=plan)` → `writePlanSnapshot`（`index.js:24788`，CAS + M1 锚点门）→ `mirrorPlanSectionsPre`（`lib/event-write.js:661`）把白板四段镜像进事件头 → append 检查点 kind=plan。
- 断点：事件库里 kind=plan 的检查点只是「白板被更新过」的时间线，**不改写 PLAN.md**（`event-write.js:651-653` 注释明示「绝不碰 PLAN.md 文件本身」）。

**③ 每日日志 ⇒ 事件：已联动（双向同源），这是 v4-H1 的成果。**
- `index.js:24420-24433` 注释写明「事件是源，日 .md 是投影」，三步顺序：① 解析/创建活跃事件 ② append 检查点 ③ 派生当日视图；`:24431-24432` 明令事件写失败必须抛错、不得 fallback 只写 .md。
- 归属：`#543`（`:24458-24470`）先按主题相似度匹配 active 事件，找不到就新建；显式 `eventId` 优先（`:24451-24457`）。

**④ 事件 userPercept ⇒ 用户画像：已联动，但输入只有当前工作区。**
- `index.js:10167-10173` `buildUserPortraitPre(events.map(e => ({ userPercept: e.userPercept })))`；抽取口径在 `lib/user-portrait.js:156-175`：只收 `stage ∈ {accepted, used}`（`:49`）与 `kind=authorResponse` 旁路（`:65`），并剔除已在规约层的条目（`:133-154`）；配额 5/3/3/3（`:35-43`），硬上限 600 字（`:32`）。
- 无持久化：结果只写内存 `this.state.userPortraitText`（`index.js:10174`），**每帧重算**，无缓存键。
- 输入范围：`events` 来自当前工作区事件库 ⇒ 跨项目维度只能靠 `MEM/person/event-store.json`，而它零读取端（D-1）。

**⑤ 技能库 ⇒ 注入面：两条通道，均为条件式/半量。**
- 通道甲（插件注入段）：只在「语义判定 emit」分支里命中，且**单轮最多 1 条**、`score>=0.6`、受 `memoryHubEnabled && procedureInjectEnabled` 双门（`lib/context-host.js:579-613`；旧键兼容见 `lib/procedure-switch.js:26-32`，本机 config `procedurePromotionEnabled=false` 但新键未设 ⇒ 实际取 true）。
- 通道乙（宿主技能目录）：`memory_procedure action=activate` 成功后导出 SKILL.md（`index.js:25592`；面板 activate/deprecate 同源 `:27123` / `:27166`），落到 `~/.dsh/skills/mem-skill-*`。实测 18 个导出目录在盘，本轮会话 available_skills 中可见 `mem-skill-issue-v3-4523438bb660` 等 —— **这就是用户级记忆里「proc_pre_4523438bb660 升 v3」那条规则的实体**。
- 断点：非 active（89 条 observed / 10 条 deprecated）与「active 但未导出」的条目，模型侧完全不可见。

**⑥ 归档旧日志 ⇒ 检索面：已联动（两条读路径都在）。**
- `index.js:14050` `if (scope === 'archive')` → 只扫 `pA.projectDir/archive`（`:14053`）；无归档文件时给明确空态（`:14059`）。
- `memory_read(kind=archive)` 独立入口（`:24934` enum、`:24948` 分支）。
- 注入面不读归档（`pushPart` 28 段无 archive）—— 属设计（冷存储分层），不计断链。

**⑦ 时段总结 ⇒ 任何下游：**只到弹窗，无模型侧读者。（证据见 D-4。）

**⑧ 日历 ⇒ 注入面：已联动。** `index.js:13069-13084`：`state.calendarText` → `parseCalendar` → 过滤 `!done && date>=today` → 前 10 条 → `pushPart('otherDynamic','calendar')`。

### 2.3 矩阵里的「应该联动但没有」清单（5 处）

| 编号 | A ⇒ B | 现状 | 证据 |
|---|---|---|---|
| L-1 | person store ⇒ 画像 | ✗ | `grep -rn "'person'" lib/*.js` = 0 |
| L-2 | hub facts/episodes ⇒ 注入/检索 | ✗ | 消费点仅 `lib/memory-hub.js:291-299`（overview）、`lib/storage-manage.js:259`、`index.js:15551`（debugInfo） |
| L-3 | hub conflicts ⇒ 处置 | ✗ | `lib/fact-store.js:640-648` 只有 `conflictsList/pendingConflicts/resolve` 读原语，无任何调用方；面板只显示计数 |
| L-4 | 事件 append ⇒ 白板重绘 | ✗ | `renderPlanFromEventsPre` 调用点只有 `index.js:24721`、`lib/upgrade-apply.js:456/473` |
| L-5 | 时段总结 ⇒ 注入/回读 | ✗ | 见 D-4 |

---

## 3. 块 3 · 缺失功能的横向对照

| 编号 | 应有能力 | 现状 | 证据（file:line + 实测） | 缺了会造成什么（具体后果） |
|---|---|---|---|---|
| M-1 | 遗忘 / 淘汰 / 降权 | **部分**：只有 facts 一店有环形淘汰 | `lib/fact-store.js:726` `pruneIfNeeded()`（`maxFacts` 默认 1000，`:728` 先判上限）；事件库、日志、笔记、账本、反思、技能库**无任何过期/降权/删除判据**（`grep -n "prune\|expire" lib/*.js` 命中全部属 `activation-inbox`（TTL 包）与 facts） | 事件库 2,960,257 B / 45 事件 / 698 检查点只增不减；注入面只能靠字符预算（`slim*/maxPacket*` 档位）裁剪，而不是「哪条该退场」⇒ 低价值条目与高价值条目争同一预算，且退场靠截断而非判定 |
| M-2 | 冲突检测 + 处置闭环 | **半条链**：检测有，处置无 | 检测：`lib/fact-store.js:478` `conflicts.push({...})` → `:486` `outcome:'conflict-added'`；读取原语 `:640-648`（`conflictsList` / `pendingConflicts` / `resolve`）**全仓零调用方**（`grep -n "conflictsList\|pendingConflicts" lib` 仅定义处 + `memory-hub.js:297` 计数） | 实测 `MEM/hub/facts.json` 的 `conflicts` = **64,264 条 / 74,025,124 B**（`facts` 仅 1,000 条 / 442,574 B，比例 64:1），全部 `resolved:false` ⇒ 系统知道「这里有矛盾」，但既不裁定、也不注入、也不提示，纯沉积 |
| M-3 | 时效性判断（过期即降权） | **名存实亡** | facts 条目带 `ttl` 字段，实测样本 `"ttl":0`；`fact-store` 里无任何按 ttl 过滤/降权的判据；事件检查点只有 `at` 时间戳，无有效期语义 | 已过期的结论（例：「单套件 <30s」这类条目被新裁定推翻后仍留在事件/笔记里）与新结论同等权重注入；模型读到的是无时间纵深的平铺记忆 |
| M-4 | 跨形态去重 | **仅形态内去重** | 现有三处：日志尾部复读防护 `index.js:24412` `tailHas`；技能查重 `index.js:25482` `proceduresFindDuplicatePre`（标题/前 3 步/磁盘技能目录）；画像前 20 字去重 `lib/user-portrait.js:178-189`。**跨形态（log ↔ checkpoint ↔ 账本 ↔ 白板）零去重** | 同一结论同时躺在四个形态里：注入面同时读 `event-cards`(`:12668`)、`handoff-ledger`(`:12636`)、`whiteboard-plan`(`:12626`) 三段 ⇒ 一次工作被计费 2–4 次；实测 2026-10-25 单日日志 811,220 B 与 763 份账本并存 |
| M-5 | 检索使用情况回写排序/淘汰 | **只回写曝光轮换** | `lib/tier0-usage.js:59` `tier0MarkSeenPre` / `:81` `tier0MarkUsedPre` → `tier-layer-inject.js:692-693` 仅用于 `tier0RotationLinesPre` 挑「最久未曝光」的 2 条轮换位（`tier0-usage.js:4-6` 自述目的即此）；`MEM/tier0-usage.json` 20,029 B | 「被真正用过」不提升任何权重，「从没用过」也不降低任何权重 ⇒ 记忆库质量的唯一反馈通道只到「公平曝光」一层，不到「择优」一层 |
| M-6 | 迁移完整性（旧目录收尾） | **部分** | `lib/datadir.js:86-135` `memoryDir(name)` 把 `<name>-pre` 逐文件补进裸名目录（`:22-45` 逐文件判据，只补缺失/空壳）；但只对**被调用到的 name** 生效 ⇒ 未被调用的目录永远留在旧位置 | 实测三处遗留：`WS/summaries`（20 个，最后 2026-09-01）与 `MEM/summaries`（114 个，最后 2026-11-07 23:51）并存；`WS/hub-pre/procedures.json` 134 B 空壳；`MEM/person/event-store.json` 无主 |
| M-7 | 备份与自动恢复 | **部分（只有手动备份点）** | 全仓唯一 `.bak-` 创建点：`index.js:15219` `backup = targetDir + '.bak-' + stamp + '-' + randomUUID()`（升级/迁移用）；事件库写入路径（`lib/event-store.js`）无写前快照；`lib/hub-io.js:395-416` 有「损坏则拒写 + 抛 `DAM-CORRUPT-LIBRARY`」，但拒绝 ≠ 恢复 | `event-store.json` 单文件 2,960,257 B 承载 45 事件/698 检查点，损坏后没有自动回滚路径（只能靠人手找 `.bak-*`，而事件库没有写前 .bak）；技能库则有 corrupt 拒写保护，两者保护级别不一致 |
| M-8 | 技能「全量到达模型」的通道 | **部分（两条都是半量）** | 通道甲：`lib/context-host.js:579-613`，仅在语义判定 `emit` 分支、`score>=0.6`、**单轮 1 条**；通道乙：导出 SKILL.md（`index.js:25592` `exportSkillForPre`、`:27123`），实测 `~/.dsh/skills` 下 `mem-skill-*` 目录 **18 个** | 存量 115 条（active 16 / observed 89 / deprecated 10）中，observed 89 条结构上不可能导出（导出判据是 `stage==='active'`，`index.js:27100`），deprecated 10 条已退休；模型可见面 ≈ 16 条 active 中已导出的子集 |

---

## 4. 块 4 · 分级与补救建议

### P0（断链导致记忆写入后无人使用 = 数据白存）

**P0-1 · 记忆中枢（hub）三店写而不用；冲突库无界增长**
- 现象：`MEM/hub/facts.json` 87,497,408 B（审计期间从 87,411,604 B 继续增长），其中 `conflicts` 64,264 条 / 74,025,124 B；`facts` 1,000 条；`episodes.json` 198 条 / 110,167 B。三者**在注入面（28 个 pushPart 段）与检索面（memory_recall 的 5 个 scope）都没有读者**，唯一读者是面板 overview（`lib/memory-hub.js:291-299`）与存储管理（`lib/storage-manage.js:259`）。
- 根因落点：`lib/fact-store.js:478`（conflict 无上限 push）；`lib/fact-store.js:726`（prune 只覆盖 facts，不含 conflicts）；`index.js:21588`（整份快照 IO：每次 flush 重写 87 MB）。
- 补救动作：① 给 `conflicts` 加硬上限 + 已解决项移入 `conflicts-archive/`；② 二选一 —— 要么给 facts/episodes 造消费者（例如 confirmed 且 ttl 有效的事实进入 `memory_recall` 的语义层），要么在文档与面板明示「仅面板可见」并把喂数频率/写盘改成增量；③ 写盘由整份快照改为增量或分片。
- 验收判据：`facts.json` < 5 MB；`conflicts.length` ≤ 设定上限；一次 flush 的写字节与墙钟可复算；`memory_recall(query=<某条 confirmed fact 的主语>)` 真调用返回该条（负路径：删除该 fact 后同查询不返回）。

**P0-2 · 跨项目画像（person store）写盘后零读取端**
- 现象：`MEM/person/event-store.json` 4,676 B / 1 事件 / 5 条 `stage=accepted` 的 userPercept，永久不进 `[用户画像]` 段；画像段只由当前工作区事件现算（`index.js:10167`）。
- 根因落点：缺失读取端（`grep -rn "'person'" lib/*.js` = 0 命中）；该事件自己的 `sections.next` 已写明「等 person store 读取端（U1 分层）落地后，本事件才会进入 [用户画像] 段；在那之前它只是磁盘存档」。
- 补救动作：在 `index.js:10167` 的聚合输入里并入 person store 的事件（同 stage 门、同配额、同 600 字上限），或实现 U1 分层读取端并显式标注来源（跨项目 vs 本项目）。
- 验收判据：画像段出现 person store 独有内容（如「香港理工大学」）；负路径：临时移走 `person/event-store.json` 后同帧画像段不含该内容，且段长按 600 字上限仍成立。

### P1（断链导致某功能长期停摆但用户暂未察觉）

**P1-1 · 技能库「工作区库」有读侧、无模型侧写入口**
- 现象：双库设计（`lib/procedure-store.js:95` `['workspace','global']`）的读侧完整（`lib/hub-io.js:411-429` 合并读），写侧模型通路缺：`index.js:25540-25550` 的候选对象不含 `scope`，回落 `lib/procedure-store.js:280` 的 `global` ⇒ `WS/hub/procedures.json` 恒 0 条，面板「工作区库」列永远为空。
- 根因落点：`index.js:25540`（cand 无 scope）+ `index.js:27049`（唯一能写工作区库的是面板 `transfer-scope`）。
- 补救动作：二选一 —— ① `memory_procedure` 增 `scope` 入参（缺省 global，避免改变现有行为），写后回执带库名；② 保持「全部进通用库」，同时从工具描述与面板文案里删掉「工作区库」概念，避免永久空列误导。
- 验收判据：写 1 条 `scope=workspace` → `WS/hub/procedures.json` 条目 0→1、`memory_procedure_list(scope="workspace")` 命中；负路径：`MEM/hub/procedures.json` 条目数不变。

**P1-2 · 白板不随事件自动重绘（单向镜像）**
- 现象：`PLAN.md` 25,728 B 与事件库 45 事件/698 检查点各自演化；事件 append 不触发任何 plan 渲染。渲染点只有 `index.js:24721`（`memory_note(kind=plan, fromEvents=true)`）与 `lib/upgrade-apply.js:456/473`（升级）。反向 PLan→事件 的镜像存在（`lib/event-write.js:661` `mirrorPlanSectionsPre`，含漂移诊断 `:712` `plan-mirror-drift`），但镜像只覆盖「写白板那一刻」，事件后续变动不会回写白板。
- 根因落点：无「事件→白板」触发点；`renderPlanFromEventsPre`（`lib/plan-render.js:211`）是纯函数，缺调用方。
- 补救动作：不做自动覆盖（会撞 M1 保护门与卡片锚点）。改为**漂移检测**：注入面比较事件头 `sections` 与 PLAN 四段，不一致时输出一行提示（「白板与事件不一致，建议 memory_note(kind=plan, fromEvents=true)」），零字节纪律保持。
- 验收判据：构造「事件 sections 改、PLAN 未改」→ 注入出现该提示行；未漂移帧该行零字节（正负两路径都要有）。

### P2（增强能力缺失，不影响基本闭环）

| 项 | 现象 | 根因落点 | 补救 | 验收 |
|---|---|---|---|---|
| P2-1 淘汰/降权 | 仅 facts 有环形淘汰（M-1） | `lib/fact-store.js:726` 是唯一实现 | 给事件检查点加「引用计数/最后引用时间」，超过 N 天且未被注入引用 → 注入降权（不是删除） | 构造 100 天旧检查点 → 注入排序下移，正文仍在盘 |
| P2-2 冲突处置通道 | 64,264 条未解决（M-2） | `fact-store.js:640-648` 原语零调用方 | 面板加「待裁定」列 + 一键 `resolve`；或写入时只留「最新一条/同主语」 | 裁定 1 条 → `pendingConflicts` 减 1，且 `resolved:true` |
| P2-3 TTL 生效 | `ttl:0` 无消费（M-3） | 无判据 | 注入侧过滤 `now > confirmedAt + ttl` 的 facts | 构造过期 fact → 不进注入；未过期进 |
| P2-4 跨形态去重 | 同一结论 2–4 处计费（M-4） | 注入段各自独立渲染（`:12626/12636/12668`） | 注入组装时对三段做内容指纹去重（保留优先级最高的一段） | 构造「账本与事件检查点同文」→ 注入只含 1 份 |
| P2-5 使用反馈进排序 | 只做曝光轮换（M-5） | `tier-layer-inject.js:692-693` | `used>0` 的条目在目录层排序加权（不改淘汰） | 断言两轮后同层条目顺序变化可复算 |
| P2-6 时段总结回读 | `memory_read` 无 summaries kind（D-4） | `index.js:24934` enum | enum 增 `summary`（读最近 N 个 json）；或明确标注「仅弹窗」 | `memory_read(kind="summary")` 真调用返回最新一条 |
| P2-7 技能注入面扩容 | 单轮 1 条 / 仅 emit 分支（M-8） | `lib/context-host.js:583-613` | 允许 2–3 条（按 score 排序），或把 active 技能标题列入 Tier-0 目录 | 构造命中 2 条 → 注入含 2 条 checklist |

### P3（理论缺陷，实际影响可忽略）

| 项 | 现象 | 根因落点 | 补救 | 验收 |
|---|---|---|---|---|
| P3-1 诊断口径读冻结目录 | `debugInfo` 报的 summaries 体积来自 `WS/summaries`（最后 2026-09-01） | `index.js:15864` | 改读 `gp.summariesDir`（`:8944` 用户级） | 面板体积读数 == `MEM/summaries` 实际字节 |
| P3-2 备份无自动恢复 | 事件库无写前 .bak（M-7） | `lib/event-store.js` 写路径 | 每日首写前复制 `.bak-<date>`，并给 restore 路由 | 损坏后 restore 一条命令回到前一日 |
| P3-3 迁移收尾 | 三处旧目录并存（M-6） | `lib/datadir.js:86` 只迁被调用的 name | 启动期一次性扫 `*-pre` 目录清单补迁；`WS/summaries` 明示废弃 | 迁移日志记录三处；旧目录清零 |

---

## 5. 块 5 · 复算命令清单（附期望读数）

> 读数取 2026-11-08 06:40 实测。**注意：宿主与其它并行 agent 仍在写**（审计期间 `facts.json` 由 87,411,604 B 涨到 87,497,408 B，事件由 43 涨到 45），因此字节/条数允许小幅漂移；判据是「量级与比例」而不是末位字节。

**① 记忆形态存量（一条命令全出）**

```powershell
node -e "const fs=require('fs'),path=require('path');const WS='C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--';const MEM='C:/Users/JH Z/.dsh/memory';const st=p=>{try{return fs.statSync(p).size}catch(e){return -1}};const ls=p=>{try{return fs.readdirSync(p)}catch(e){return []}};const cnt=(d,sfx)=>{let n=0;for(const f of ls(d)){if(!f.endsWith(sfx))continue;try{if(fs.statSync(path.join(d,f)).isFile())n++}catch(e){}}return n};const es=JSON.parse(fs.readFileSync(WS+'/handoff/event-store.json','utf8'));const evs=es.events||[];let cps=0,up=0;for(const e of evs){cps+=(e.checkpoints||[]).length;up+=(e.userPercept||[]).length}console.log('event-store',st(WS+'/handoff/event-store.json'),evs.length,cps,up);console.log('PLAN',st(WS+'/handoff/PLAN.md'));console.log('handoff',cnt(WS+'/handoff','.md'),'handoffArchive',cnt(WS+'/handoff/archive','.md'));const logFiles=ls(WS).filter(f=>f.startsWith('2026-')&&f.endsWith('.md'));console.log('logs',logFiles.length,'maxLog',Math.max(...logFiles.map(f=>st(WS+'/'+f))));console.log('archive',cnt(WS+'/archive','.md'),'reflections',cnt(WS+'/reflections','.md'));console.log('WSsum',cnt(WS+'/summaries','.json'),'MEMsum',cnt(MEM+'/summaries','.json'));console.log('WSnotes',st(WS+'/MEMORY.md'),'MEMnotes',st(MEM+'/MEMORY.md'),'CAL',st(MEM+'/CALENDAR.md'));console.log('skillDirs',ls('C:/Users/JH Z/.dsh/skills').filter(f=>f.startsWith('mem-skill-')).length);console.log('person',st(MEM+'/person/event-store.json'),'facts',st(MEM+'/hub/facts.json'),'episodes',st(MEM+'/hub/episodes.json'),'procs',st(MEM+'/hub/procedures.json'));"
```

期望读数（2026-11-08 06:40）：

| 读数 | 实测 | 判据 |
|---|---|---|
| `event-store` | 2,960,257 B / 45 事件 / 698 检查点 / 36 userPercept | 与任务书基线 43/696 相差 ≤2（并行写入） |
| `PLAN` | 25,728 B | 与基线一致 |
| `handoff` / `handoffArchive` | 763 / 327 | 账本目录 1,090 个 .md |
| `logs` / `maxLog` | 29 / 811,220 | 29 个 `2026-*.md` |
| `archive` / `reflections` | 40 / 67 | 与基线 42/67 相差 ≤2 |
| `WSsum` / `MEMsum` | **20 / 114** | 前者最后 `2026-09-01-昨天.json`，后者最后 `2026-11-07-晚上.json` |
| `WSnotes` / `MEMnotes` / `CAL` | 42,409 / 44,474 / 3,577 | 与基线一致 |
| `skillDirs` | **18** | `~/.dsh/skills` 下 mem-skill-* 目录数 |
| `person` / `facts` / `episodes` / `procs` | 4,676 / 87,497,408 / 110,167 / 308,452 | facts 为 87 MB 级 |

**② 技能库双命名空间计数（证明「不是不存在，是命名空间」）**

```powershell
node -e "
const fs=require('fs');
const M='C:/Users/JH Z/.dsh/memory';
const W=M+'/workspaces/--D--dsh-auto-memory--';
for(const p of [M+'/hub/procedures.json',M+'/hub-pre/procedures.json',W+'/hub/procedures.json',W+'/hub-pre/procedures.json']){
  const j=JSON.parse(fs.readFileSync(p,'utf8')); const a=j.procedures||[];
  const st={}; const sc={}; for(const x of a){st[x.stage||'?']=(st[x.stage||'?']||0)+1;sc[x.scope||'?']=(sc[x.scope||'?']||0)+1}
  console.log(p.replace(M,'MEM'),'bytes',fs.statSync(p).size,'n',a.length,JSON.stringify(st),JSON.stringify(sc));
}"
```

期望：`MEM/hub` = 308,452 B / **115** 条 / `{active:16, observed:89, deprecated:10}` / 全部 `scope=global`；`MEM/hub-pre` = 108,009 B / 56 条；`WS/hub` 与 `WS/hub-pre` = **134 B / 0 条**。

**③ hub 冲突库规模与未解决比例（P0-1 的物理量）**

```powershell
node -e "
const fs=require('fs');const f=JSON.parse(fs.readFileSync('C:/Users/JH Z/.dsh/memory/hub/facts.json','utf8'));
console.log('fileBytes',fs.statSync('C:/Users/JH Z/.dsh/memory/hub/facts.json').size);
console.log('facts',f.facts.length,'factsBytes',JSON.stringify(f.facts).length);
console.log('conflicts',f.conflicts.length,'conflictsBytes',JSON.stringify(f.conflicts).length);
console.log('unresolved',f.conflicts.filter(c=>!c.resolved).length);
console.log('uniqueConflictIds',new Set(f.conflicts.map(c=>c.conflictId)).size);"
```

期望：`fileBytes` 87 MB 级；`facts` 1,000 / 442,574 B；`conflicts` 64,264 / 74,025,124 B；`unresolved` ≈ 64,264；`uniqueConflictIds` 64,327（略多于条数 ⇒ 有跨分片重复）。

**④ 时段总结时间线（证明「未停摆」）**

```powershell
Get-ChildItem 'C:/Users/JH Z/.dsh/memory/summaries' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name,LastWriteTime
Get-ChildItem 'C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/summaries' -File | Sort-Object LastWriteTime -Descending | Select-Object -First 3 Name,LastWriteTime
node -e "const c=require('C:/Users/JH Z/.dsh/dsh-auto-memory.json');console.log('autoSummaryTimes',JSON.stringify(c.autoSummaryTimes))"
```

期望：MEM 侧 = `2026-11-07-晚上.json`（2026/11/7 23:51）；WS 侧 = `2026-09-01-昨天.json`（2026/9/2 0:44）；`autoSummaryTimes` = `[]`（定时总结从未开启）。

**⑤ 关键「零读者」的检索式证明（每条都应是 0 命中，除注明的例外）**

```powershell
cd D:/dsh-auto-memory
# D-1 person store 无读者：应为 0
(Select-String -Path lib/*.js -Pattern "'person'" -SimpleMatch | Measure-Object).Count
# actor：确认画像只吃事件（应有 10167 一处）
Select-String -Path lib/index.js -Pattern "buildUserPortraitPre\(" | Select-Object LineNumber,Line
# D-5 白板渲染调用点（应只有 24721 + upgrade-apply 2 处）
Select-String -Path lib/*.js -Pattern "renderPlanFromEventsPre\(" | Select-Object Filename,LineNumber
# M-2 冲突处置原语调用方（应只有 fact-store.js 定义处）
Select-String -Path lib/*.js -Pattern "conflictsList|pendingConflicts" | Select-Object Filename,LineNumber
```

期望：第 1 条 **0**；第 2 条 **1** 处（`index.js:10167`）；第 3 条 **3** 处（`index.js:24721`、`upgrade-apply.js:456`、`upgrade-apply.js:473`*，另有 1 处 import）；第 4 条只在 `fact-store.js` 与 `memory-hub.js:297`。

**⑥ 技能导出物（证明技能库确实到达模型）**

```powershell
Get-ChildItem 'C:/Users/JH Z/.dsh/skills' -Directory | Where-Object { $_.Name -like 'mem-skill-*' } | Measure-Object
Get-Content 'C:/Users/JH Z/.dsh/skills/mem-skill-issue-v3-4523438bb660/SKILL.md' -TotalCount 8
```

期望：18 个目录；SKILL.md 首行标题为「Issue 批量处理标准流程 v3 …」，与 `proc_pre_4523438bb660` 对应。

---

## 6. 块 6 · 假阳性排查记录

任务书要求「判『缺失』前必须穷尽替代存在形式」。本轮三条候选缺口**全部是假阳性**，排查过程如下（这也是本报告最重要的一节）。

| 候选结论 | 排除的替代存在形式 | 实际情况 | 判定 |
|---|---|---|---|
| 「技能库零条目」 | ① 别的文件名：`procedure-store.json`（0 命中）、`procedures.json`（命中）② 别的目录/命名空间：`WS/hub`、`WS/hub-pre`、`MEM/hub`、`MEM/hub-pre` 四者逐一计数 ③ 内存现算：`createProcedureStorePre` 有 `restore()`，但启动只读通用库（`index.js:21628-21632`），无内存专有集 ④ 别的模块提供：导出物 `~/.dsh/skills/mem-skill-*`（18 个），以及本轮 available_skills 里 8 个 `mem-skill-*` | **通用库 115 条（active 16 / observed 89 / deprecated 10），全部 scope=global**；工作区库 0 条 | 假阳性（原判）→ 真缺陷换成 D-3：**工作区库有读侧无写侧** |
| 「时段总结停摆 68 天」 | ① 别的目录：`MEM/summaries`（114 个，最后 2026-11-07 23:51）② 别的文件名：日期+中文时段（`-昨天/-晚上/-下午/…`），非固定 `summary.json` ③ 内存现算：`periodSummary()`（`index.js:16104`）按日志行现切时段，不落盘 ④ 别的模块：`summarizePeriod`（`:16117`）走 `runSubagent` 由 AI 生成，产物落用户级目录 | 产出从未停；WS 侧是**迁移前的旧副本**（`index.js:16118-16119` 注释：2026-09-01 起「全局统揽」改走用户级目录） | 假阳性 → 真缺陷换成 D-4：**产出无模型侧读者 + 定时任务默认关** |
| 「用户画像无持久化文件 = 数据源不明」 | ① 别的文件名：`user-portrait.json` / `portrait.json`（0 命中）② 内存现算：**命中** —— `index.js:10167-10176` 每帧 `buildUserPortraitPre`，结果只存 `state.userPortraitText` ③ 别的存储：`MEM/person/event-store.json`（跨项目画像，但**零读取端**） | 画像 = 当前工作区事件 `userPercept` 的实时聚合，无持久化、无缓存；跨项目画像有盘无读 | 假阳性（「数据源不明」）→ 真缺陷换成 D-1/P0-2：**person store 零读取端** |
| 「技能库曾有条目但被清空」 | ① 备份链：`MEM/hub/procedures.json.bak-depre-*`（108,009 B）、`.bak-i335-dedup-*`（249,585 / 245,241 B）、`.bak-probe-removal`（275,087 B）② 迁移日志：`MEM/datadir-migration.log` 49,353 B ③ 双库 migrate 的两阶段回滚（`lib/hub-io.js:707-760`） | 备份文件证明条目数只增不减（108 KB → 249 KB → 308 KB），**不是被清空**；「proc_pre_4523438bb660」在现行 `MEM/hub` 里以 `mem-skill-issue-v3-4523438bb660` 的 SKILL.md 形式存在 | 假阳性（「条目丢失」） |
| 「白板是事件投影，应该自动更新」 | ① 别的写入口：`writePlanSnapshot`（`index.js:5223`）、骨架创建（`:5079`/`:5195`）、`upgrade-apply.js`（自有 tmp→rename）② 别的渲染器：`wb-sidecar.js` 只读 PLAN 建图，不写 ③ 定时器：`grep "PLAN.md" lib/index.js` 无定时写 | **确无自动重绘**：写入只发生在模型显式 `memory_note(kind=plan)` 或升级流程 | 真缺陷（P1-2） |
| 「归档不可检索」 | ① `memory_recall(scope='archive')`：`index.js:14050-14059` 真实存在 ② `memory_read(kind='archive')`：`:24948` ③ 归档目录：`WS/archive` 40 篇 / `handoff/archive` 327 篇 | 两条读路径都在 | 假阳性（不计断链） |
| 「日历不进注入」 | ① 注入段：`pushPart('otherDynamic','calendar')`（`index.js:13084`）② 数据源：`state.calendarText` → `parseCalendar` → 过滤未完成且 `date>=today` 前 10 条（`:13069-13070`） | 已联动 | 假阳性 |
| 「事件检查点 kind=handoff 应生成账本文件」 | ① 反向路径：`event-write.js:582` 只 append 检查点 ② `.md` 写入口：`writeHandoffLedger`（`index.js:24787`）先写、检查点后记 ③ 该函数注释 `:635-644` 明确「只追加检查点，不镜像 sections」 | 方向是「账本 → 检查点」，反向不存在 | 假阳性（设计如此） |

---

## 7. 块 7 · 未验证 / 边界

1. **未取得运行时注入帧**：本轮未启动宿主、未调用 `systemPrompt.context` 的回调，全部「注入面」结论来自静态读码（`pushPart` 调用点）与既有注入文本。未验证的推断：某段在**当前**帧里是否真的非零字节（受 tier 节奏、预算裁剪、`isUnattendedNow()` 等门控影响）。
2. **未真调检索**：没有执行 `memory_recall`（只读工具允许，但会触发统计写入 `recall-stats.json`），因此「scope=archive 能取到归档」是**代码路径成立**，不是端到端观测。同样，`memory_recall` 能否命中 facts 是补救方案的验收项，不是当前事实。
3. **存量数字受并行写入影响**：审计窗口内事件 43→45、facts 87,411,604→87,497,408 B（另一条线在写）。所有数字均给出命令与时刻，复算允许漂移；判据用「量级/比例」。
4. **person store 的写入者不明**：`MEM/person/event-store.json` 的 `updatedAt` = 1793070944510（2026-10-27 11:15），内容风格是「一次性人工提炼 5 条」。结论只到「无代码读它」，**不主张**「插件写它但不读它」。
5. **面板按钮存在性未验**：`transfer-scope` 只有后端路由（`index.js:27049`），未核对 `client.js` 是否真有入口按钮（`grep isWs` 命中 6 处属展示逻辑）。若入口不存在，D-3 会从「P1 写侧缺失」升级为「工作区库彻底不可达」。
6. **conflicts 的语义未逐条核**：只统计了条数/字节/未解决比例，未抽样判断这些冲突是否「真矛盾」还是「同主语不同日期」的噪声。若是后者，P0-1 的补救应优先「先修检测判据」而不是「先做处置 UI」。
7. **未查 client.js 的全部 UI 联动**（属于任务 C 的「孤儿功能」范畴），本报告只覆盖后端引擎与数据面。
8. **未评估修复成本**：第 4 节只给方案与验收判据，未估工时；P0-1 的「整份快照改增量」涉及 hub-io 事务契约，属结构性改动，需单独立项。

---

## 附 · 编号对照（断链 / 缺失 → 分级）

| 分级项 | 对应编号 | 内容 |
|---|---|---|
| P0-1 | D-2 + M-2 | hub 冲突库写而不用 + 无界增长（检测有、处置无） |
| P0-2 | D-1 | person store 跨项目画像零读取端 |
| P1-1 | D-3 + M-8 | 技能库工作区库无模型侧写入口（并及「全量到模型」通道半量） |
| P1-2 | D-5 | 白板不随事件自动重绘（单向镜像） |
| P2-1 | M-1 | 无淘汰/降权 |
| P2-2 | M-2 | 冲突处置通道 |
| P2-3 | M-3 | TTL 未生效 |
| P2-4 | M-4 | 跨形态去重 |
| P2-5 | M-5 | 使用反馈不进排序 |
| P2-6 | D-4 | 时段总结无模型侧读者 |
| P2-7 | M-8 | 技能注入面半量（单轮 1 条 / 仅 emit） |
| P3-1 | D-6 | 诊断口径读冻结旧目录 |
| P3-2 | M-7 | 备份无自动恢复 |
| P3-3 | M-6 | 迁移收尾（三处旧目录） |

合计：断链 6（D-1…D-6）+ 真缺失 8（M-1…M-8）= 14 项，分级为 P0 2 / P1 2 / P2 7 / P3 3。
