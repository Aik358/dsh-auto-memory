# 批次 5 铭文升级提案

2026-11-23 · 基线 `preview@9ef7614e` · 供用户审批 · 本次只交方案。

## 4.1 一页摘要

建议审批下方中文稿。它把归属、账本、检查点、白板和结束事件排成一条可以逐项核对回执的流程。同文优先使用必须更新的账本，检查点已有回执就省正文，未落盘的四类感知仍能补入。用户画像由事件的 `userPercept` 生成，正文现已明确其写入字段和入选条件。

| 变更 | 数量和口径 |
| --- | --- |
| 修缺陷 | 10 条的调用指导，覆盖下文 P1–P6 与 N1、N2、N4、N6。涉及工具行为的部分以表中注明的前置为限 |
| 补跳过条件 | 6 组：无实质产出、同文日志、已有检查点、白板已与事实相符、技能流程不可复用、未出现存量提示 |
| 补终止位 | 3 组：前置凭据缺失、确认回执、归档无命中 |
| 合并重复 | 3 组：归属规则与建事件、检查点与自动记录、白板及账本说明 |
| 补缺失能力 | L1 采纳 5 项，L2 采纳 2 项，L3 采纳 0 项。详见 §4.5 |

完整帧由 **1,675 JS 字符 / 3,034 B / 估 707 token** 变为 **1,723 JS 字符 / 2,733 B / 估 669 token**。JS 字符增加 48，UTF-8 减少 301 B，估算 token 减少 38。距批准的 **1,750** 字符护栏还有 **27** 字符。

三条取舍：

1. **账本和今日日志的双份可见性。** 隔离夹具里，正式写账本后再正式写日志，检查点由 1 增至 2。草稿优先保证账本与事件，同文不再另记日志。这条同文也就不会进入今日日志投影。若要求两面同时显示且只增一条检查点，需要另定执行器契约。
2. **白板重绘的适用范围。** 事件来源白板可按事件重绘。已有手写卡的白板用原文及 revision 更新。直接投影重绘会把原手写卡移到历史归档，无法保证它继续留在活动白板。
3. **先用现有 R4 契约完成交接。** 修改 `lib/` 仍须写账本。R4 更新需版本，首建需有效事件。账本回执只确认确实完成的动作，旧账本和 R4 的感知写入行为不同。

## 4.2 新提示词全文

以下为实际字面值。前 14 行是 `snapshotInscription`。最后一行 ⑦ 是 `snapshotInscriptionArchive`，该词条包含自己的前导 LF。帧渲染另在首行前加 1 个 LF。Markdown 围栏和末尾换行不属于提示词。

```text
[铭文 · 每轮提醒 {date}]
【收尾自检】阶段完成/实质进展/重要裁定/根因落地才写。纯读/闲聊/派活/等待/重复跳过。缺凭据停。
① 先定归属，同文优先账本。日志 memory_log(note,eventId)，kind 取 rule=用户约束/约定、preference=偏好、fact=事实、todo=待办。
② 事件索引，账本是原文载体。
· 先查标识 #evt_xxx，已知必传 eventId，存疑 memory_log(note,dryRun:true)。批次挂伞（三录/编排/alpha.N/总表/白板）。专属限同日同修复，founding 仅首检查点。同标识异线不挂。无匹配才 memory_event(action=create,name)。粒度不明宁拆勿并，归属不明宁建勿挂。
· 动 lib/（含测试/工具）或交接必写 memory_note(kind=handoff)。content 四段：任务状态/目标/已试方案与失败原因/进度与下一步。R4 用真实 documentId 或 maintenanceTopic。更新带 expectedRevision，首建带真实 eventId，显式首建加 createDocument:true。关用旧账本。
· 同轮合一检查点。memory_event(action=append,eventId,checkpoint)，含 kind/text/goal/state/dead/next，重试同 idemKey。已记省 checkpoint。画像用 userPercept。确认/用上填 stage=accepted/used，明确回应填 kind=authorResponse。agentTrace/sharedGround/commitment 据实补缺。头段 goal/doing/deadend/next 变才 set(eventId,变更)，暂停需 pausedReason。事件结束才 set summary→close(eventId,outcome)。仍有下一步不可 close。
· 白板不符才 memory_note(kind=plan)，读原版带 expectedRevision。事件板 fromEvents:true。手写 content 保锚/备注。跨轮结论 memory_note(kind=note,action=append,content)。note/docs 不代白板/账本。
· memory_recall(scope=events,query)，取检查点带同值 expand/eventId、checkpointIndex 或 idemKey。
③ 多步先 memory_procedure_list，按 successCriteria 验收。跑通可复用才 memory_procedure。action=update 带 procedureId/改动，别另写同名新条。新项 title/steps/successCriteria，确信才 action=activate，否则 write。跨项目规则 memory_user(action,content)。memory_rules 增改带 content，改删先 list 取 index/expect。
④ 失效用 memory_note(kind=note,content)。旧ID数组。有后继 supersedes=，错则 retract=加 retractReason=，标错 restore=。
⑤ 标题/正文标泳道 type:goal/type:state/type:dead-end/type:progress。
⑥ 客观第三人称，仅留可复用事实/决策/规则/路径。核回执即停。
⑧ 见「存量未归档」按提示归事件。
⑦ archive/ 默认30天，不进 all。memory_recall(scope=archive,query) 找名→memory_read(kind=archive,name)。超长按路径读。省 name 列目录，无命中停。
```

### 改前与改后逐行对照

下面的 diff 分别列出两份求值结果。旧第 8 行的归属规则和旧第 13 行的归属口诀合到新第 5 行。旧第 5–7 行的分流移到新第 6–8 行。旧第 9–10 行的事件动作移到新第 7 行。其余锚点的保留和改写见逐条表。

```diff
- [铭文 · 每轮提醒 {date}]
- 【收尾自检】本轮有实质产出才做；纯只读/闲聊轮跳过。三个方向 + 分类别丢：
- ① 写记忆文件 memory_log —— kind 按性质选，别一律 fact：rule=用户约束/约定、preference=偏好、fact=事实、todo=待办；
- ② 更新白板/账本 + 维护事件 —— ★硬映射(满足即必须做,别自行判断「算不算」变化)：
-    · 本轮改过 lib/ 下任何文件(含测试/工具) ⇒ **必写 memory_note(kind=handoff)** 四段式账本；
-    · 白板与结束时的事实不符(回归数字/已完成项/下一步) ⇒ 必做 memory_note(kind=plan)；
-    · 只补一条可复用结论 ⇒ 才用 memory_note(kind=note, action=append)。
-    ★事件归属(硬性)：**已知归属必须显式传 eventId**（注入面事件卡/目录带 #evt_xxx；不确定先 memory_log(dryRun:true) 预检）——对不上才 memory_event(action=create) 建新，**宁建勿挂**(挂错污染历史边界)；批次执行日志挂**批次伞事件**，宁拆勿并：
-    · 有新进展 ⇒ memory_event(action=append, eventId, checkpoint)；
-    · 目标/状态变了 ⇒ memory_event(action=set, eventId, …)；做完了 ⇒ memory_event(action=close, eventId, outcome)。
-    ⚠ 事件是索引；memory_note(kind=handoff) 是原文载体，都要写。查全经过 memory_recall(scope=events)。
-    ⚠ kind=note 不等于白板/账本——只写 note 却宣称已更新白板是**失职**；write 直接写 docs/ 不算插件记忆。
-    · 归属判据(15 条精简)：①标识优先，命中即显式传 eventId；②批次日志挂**批次伞事件**；③伞=三录/编排/alpha.N/总表/白板；④专属事件仅同日同一具体修复时挂；⑤founding 仅当本条是该事件首个检查点；⑥同标识但另一工作线⇒不挂；⑦宁拆勿并仅证据不足时用。
- ③ 技能库优先 —— 多步任务前先 memory_procedure_list 查流程，按 successCriteria 验收；跑通的新流程 → memory_procedure(action=update 改已有，**别另写同名新条**；确信可复用就 action=activate)。跨会话结论→memory_note／跨项目规则→memory_user／规则增删改→memory_rules；
- ④ 结论失效 —— supersedes= 标 superseded；做错了 retract= 标 retracted 并附 retractReason=(前者有后继，后者即教训)；标错用 restore=；
- ⑤ 看板落列 —— 白板/账本要进看板泳道，须在标题或正文写 tag：type:goal / type:state / type:dead-end / type:progress；不写则按标题猜会落空；
- ⑥ 语体 —— 客观陈述、第三人称，只留可复用的事实/决策/规则/路径。
- ⑧ 存量未归档 —— 注入面出现「存量未归档」段时按其指引把账本归入事件；无存量时该段零字节、不出现。
- ⑦ 旧日志在 archive/(30 天前归档，不在 memory_recall 的 all 里)。取原文：memory_recall(scope=archive) 找文件名 → memory_read(kind=archive, name) 取全文；只列目录用 memory_read(kind=archive)。
+ [铭文 · 每轮提醒 {date}]
+ 【收尾自检】阶段完成/实质进展/重要裁定/根因落地才写。纯读/闲聊/派活/等待/重复跳过。缺凭据停。
+ ① 先定归属，同文优先账本。日志 memory_log(note,eventId)，kind 取 rule=用户约束/约定、preference=偏好、fact=事实、todo=待办。
+ ② 事件索引，账本是原文载体。
+ · 先查标识 #evt_xxx，已知必传 eventId，存疑 memory_log(note,dryRun:true)。批次挂伞（三录/编排/alpha.N/总表/白板）。专属限同日同修复，founding 仅首检查点。同标识异线不挂。无匹配才 memory_event(action=create,name)。粒度不明宁拆勿并，归属不明宁建勿挂。
+ · 动 lib/（含测试/工具）或交接必写 memory_note(kind=handoff)。content 四段：任务状态/目标/已试方案与失败原因/进度与下一步。R4 用真实 documentId 或 maintenanceTopic。更新带 expectedRevision，首建带真实 eventId，显式首建加 createDocument:true。关用旧账本。
+ · 同轮合一检查点。memory_event(action=append,eventId,checkpoint)，含 kind/text/goal/state/dead/next，重试同 idemKey。已记省 checkpoint。画像用 userPercept。确认/用上填 stage=accepted/used，明确回应填 kind=authorResponse。agentTrace/sharedGround/commitment 据实补缺。头段 goal/doing/deadend/next 变才 set(eventId,变更)，暂停需 pausedReason。事件结束才 set summary→close(eventId,outcome)。仍有下一步不可 close。
+ · 白板不符才 memory_note(kind=plan)，读原版带 expectedRevision。事件板 fromEvents:true。手写 content 保锚/备注。跨轮结论 memory_note(kind=note,action=append,content)。note/docs 不代白板/账本。
+ · memory_recall(scope=events,query)，取检查点带同值 expand/eventId、checkpointIndex 或 idemKey。
+ ③ 多步先 memory_procedure_list，按 successCriteria 验收。跑通可复用才 memory_procedure。action=update 带 procedureId/改动，别另写同名新条。新项 title/steps/successCriteria，确信才 action=activate，否则 write。跨项目规则 memory_user(action,content)。memory_rules 增改带 content，改删先 list 取 index/expect。
+ ④ 失效用 memory_note(kind=note,content)。旧ID数组。有后继 supersedes=，错则 retract=加 retractReason=，标错 restore=。
+ ⑤ 标题/正文标泳道 type:goal/type:state/type:dead-end/type:progress。
+ ⑥ 客观第三人称，仅留可复用事实/决策/规则/路径。核回执即停。
+ ⑧ 见「存量未归档」按提示归事件。
+ ⑦ archive/ 默认30天，不进 all。memory_recall(scope=archive,query) 找名→memory_read(kind=archive,name)。超长按路径读。省 name 列目录，无命中停。
```

## 4.3 逐条改动表与方法 B

本表从现有行为反查真实工具及前置。提案中的 `set/close/update/write/activate` 是相邻工具的 `action` 值，规则的 `list` 是 `op` 值。函数式写法用于提示模型组织参数。

| # | 位置 | 改前 | 改后 | 类型 | 理由 | 影响的行为 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 总闸，1599 | 实质产出才做 | 四类触发，纯读、闲聊、派活、等待及重复跳过 | 补跳过条件 | 展开 11 月 16 日总表裁定 | 阶段收口或有新增事实才写 |
| 2 | ①，1600 | 日志四分类 | 先定归属，给 `note`，同文优先账本，保留四种 kind | 合并重复 | `memory_log` 也会生成检查点 | 该写的独立日志仍能分类 |
| 3 | ② 归属，1605、1610 | 显式归属与口诀分两段 | 合并标识、伞事件、专属范围、founding 与异工作线判据。粒度不明宁拆勿并，归属不明宁建勿挂。预检带 `note` | 修缺陷 | 两条规则分别判断事件粒度与归属。预检要求 `note` | 同标识但不同工作线保持独立。确无匹配时带 `name` 建事件 |
| 4 | ② 账本，1602、1608 | 动 lib 即写四段 | 保留动作及四段。R4 更新读 revision，首建绑有效事件，关闭后走旧账本 | 补缺失能力 | R4 缺身份或版本会拒绝 | 账本承载原文，CAS 冲突不猜新版本 |
| 5 | ② 追加，1606 | 有新进展就 append | 同轮合并一次。补 `kind/text`、四段及幂等键，查回执后以已有记录作准。用 `userPercept` 记录有依据的用户反馈，正文写明画像入选条件 | 修缺陷 | 处理器可能接受缺正文的检查点，未带幂等键的重试可重复追加。只列感知字段不能说明画像如何取用 | 已有正文时，四类感知只补实际缺项，画像条目的阶段来自实际反馈 |
| 6 | ② 改四段，1607 | 目标或状态变就 set | 显式 `eventId` 和变更，头四段 `goal/doing/deadend/next`，暂停附原因 | 修缺陷 | set 需实际可变字段，暂停另有前置 | 保存当前全貌，检查点与事件头分开 |
| 7 | ② 关闭，1607 | 做完就 close | 整件事结束后先 set summary，再 close 并给 outcome。仍有下一步不可 close | 修缺陷 | 直接 close 可保留旧 summary，提前关闭会阻断后续记录 | 仍待接续的事件保持可追加 |
| 8 | ② 白板，1603 | 白板不符就 plan | 先判断是否仍不符。读取原版 revision。事件板走投影，手写留锚点和备注 | 补缺失能力 | 投影可省 content，现存白板仍需版本，手写卡不能交给整体投影保活 | 已自动重绘就跳过，避免无故改写 |
| 9 | ② 笔记，1604、1609 | append 笔记，另有重复提醒 | 追加带 `content`，保留 note 或直接写 docs 不算更新白板及账本 | 压缩措辞 | 笔记正文是处理器前置 | 不以笔记回执冒充白板回执 |
| 10 | ② 事件经过，1608 | scope=events 查全经过 | 搜索加 `query`。完整单个检查点另给同值 `expand/eventId` 和索引或幂等键 | 修缺陷 | 普通召回给命中摘要。下钻回真源 | 锁定所需的检查点再取原文 |
| 11 | ③，1611 | 查技能，更新或直接激活 | 多步先查，按标准验收，已有项按 id 补修，新建给标题步骤及标准 | 修缺陷 | 不同动作前置不同 | 有依据才激活，保留同名防重复 |
| 12 | ③，1611 | 给出三个写入工具名 | 项目写 content，跨项目加 action，规则改删先 list | 补缺失能力 | 用户记忆的 action 与 content 都必填，规则改删是条件必填 | 降低裸调用及过期索引误写 |
| 13 | ④，1612 | supersedes/retract/restore，未点明载体 | 放在 `memory_note(kind=note,content)`，旧 ID 传数组，撤回附理由 | 修缺陷 | 只有项目笔记成功路径处理软状态，空正文会拒绝 | 有实际说明正文时才走状态修改，纯打标见 §4.4 |
| 14 | ⑤，1613 | 四个 tag，强调无 tag 会落空 | 保留全部 tag 与标题/正文位置 | 压缩措辞 | 标准节名也能辅助分列 | 需明确入列时仍主动打标签 |
| 15 | ⑥，1614 | 客观语体和可复用内容 | 原要求保留，回执确认后停止 | 补终止位 | 失败或已持久化都要据回执判断 | 不补无关动作 |
| 16 | ⑧，1615 | 存量提示出现才归事件 | 保留提示触发，省去解释 | 压缩措辞 | 提示是本轮处理依据 | 没看到就跳过写入，不据此断言磁盘无存量 |
| 17 | ⑦，1622 | 归档 scope 短写，按 name 取全文 | 查词后按命中文件名取正文，超长按路径取，列表省 name，无命中停 | 修缺陷 | `query` 必填，正文响应有 8,000 字符阈值 | 只按真实文件名读，不盲猜 |

动作前置及用户裁定依据见 [现有铭文](/D:/dsh-auto-memory/lib/index.js:1598)、[5.1 总表](/D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md:520)。

### M2 与 M3 修订前后

| 修订 | 修订前原文 | 修订后完整所在行 |
| --- | --- | --- |
| M2 | `· 先查标识 #evt_xxx，已知必传 eventId，存疑 memory_log(note,dryRun:true)。批次挂伞（三录/编排/alpha.N/总表/白板）。专属限同日同修复，founding 仅首检查点。同标识异线不挂。无匹配才 memory_event(action=create,name)，证据不足宁建勿挂。` | `· 先查标识 #evt_xxx，已知必传 eventId，存疑 memory_log(note,dryRun:true)。批次挂伞（三录/编排/alpha.N/总表/白板）。专属限同日同修复，founding 仅首检查点。同标识异线不挂。无匹配才 memory_event(action=create,name)。粒度不明宁拆勿并，归属不明宁建勿挂。` |
| M3 | `· 同轮合一检查点。memory_event(action=append,eventId,checkpoint)，含 kind/text/goal/state/dead/next，重试同 idemKey。已记省 checkpoint。画像用 userPercept。确认/用上填 stage=accepted/used，明确回应填 kind=authorResponse。agentTrace/sharedGround/commitment 据实补缺。头段 goal/doing/deadend/next 变才 set(eventId,变更)，暂停需 pausedReason。事件结束才 set summary→close(eventId,outcome)。` | `· 同轮合一检查点。memory_event(action=append,eventId,checkpoint)，含 kind/text/goal/state/dead/next，重试同 idemKey。已记省 checkpoint。画像用 userPercept。确认/用上填 stage=accepted/used，明确回应填 kind=authorResponse。agentTrace/sharedGround/commitment 据实补缺。头段 goal/doing/deadend/next 变才 set(eventId,变更)，暂停需 pausedReason。事件结束才 set summary→close(eventId,outcome)。仍有下一步不可 close。` |

### 内容保全自检

行号从 §4.2 审批代码块首行计数。

| 必须保留的内容 | 审批稿位置 |
| --- | --- |
| 15 条归属判据的主干 | 第 5 行。标识优先、已知必传 eventId、存疑预检、批次挂伞（三录/编排/alpha.N/总表/白板）、专属限同日同修复、founding 仅首检查点、同标识异线不挂。粒度不明宁拆勿并，归属不明宁建勿挂 |
| 四类感知 | 第 7 行。`userPercept`、`agentTrace`、`sharedGround`、`commitment` |
| 画像入选条件 | 第 7 行。`stage=accepted/used`、`kind=authorResponse` |
| 检查点四段键及账本四段 | 第 7 行的 `goal/state/dead/next`。第 6 行的任务状态、目标、已试方案与失败原因、进度与下一步 |
| 四个泳道 tag | 第 12 行。`type:goal`、`type:state`、`type:dead-end`、`type:progress` |
| ⑦ 归档及查询参数 | 第 15 行。`memory_recall(scope=archive,query)` |
| ⑧ 存量未归档 | 第 14 行。见到「存量未归档」按提示归事件 |
| 事件召回及检查点定位 | 第 9 行。`memory_recall(scope=events,query)`，同值 `expand/eventId` 加 `checkpointIndex` 或 `idemKey` |
| 白板与事件重绘 | 第 8 行。`memory_note(kind=plan)`、`expectedRevision`、`fromEvents:true` |
| 技能三种写入动作和验收条件 | 第 10 行。`memory_procedure`、`action=update`、`write`、`action=activate`、`successCriteria` |
| 规则改删前读取当前值 | 第 10 行。`memory_rules` 改删先 list 取 `index/expect` |

## 4.4 缺陷修复落点与独立验证

与前报告 **重合 6 项，新增 7 项**。重合按任务书所说的六个主问题计数，其中事件收口包含先写总览。前报告已记录的归档 8,000 字符上限、技能前置与规则 CAS 作为已知约束复核，未再计作新增。本轮把「原子写入」的旧账本与 R4 分流从原描述中拆开。

### 方法 A · 已注册工具的 required

`defineTool` 只把 `spec.required` 加进注册 schema，其他条件由执行器检查。在临时 profile 中执行真实 `apply()`，从 22 个注册工具中逐个断言下面九个工具的 `required` 数组。两个召回 scope 分开列。 [schema 生成](/D:/dsh-auto-memory/lib/index.js:20095)

| 铭文写法 | 注册 required | 关键条件必填及缺项 | 源码 |
| --- | --- | --- | --- |
| `memory_log`、`memory_log(dryRun:true)` | `note` | 两个短写缺 `note`。有效已知归属需显式 `eventId`，显式 id 不存在或已 closed 会拒绝 | `index.js:25458–25466` |
| `memory_note(kind=handoff)` | 无 | 缺 `content`。R4 已有文档需 `documentId/maintenanceTopic` 与 `expectedRevision`。首建须真实 active/paused `eventId`。显式首建保留文档约定的 `createDocument:true` | `index.js:26002–26055,26224–26264` |
| `memory_note(kind=plan)` | 无 | 缺 `content` 或 `fromEvents:true`。更新现有白板需要 revision。单卡需要 `content + cardId + expectedCardRevision` | `index.js:26002–26017,26127–26171`，`plan-store.js:247` |
| `memory_note(kind=note,action=append)`、④状态短写 | 无 | 缺 `content`。软状态的 ID 传数组，确认旧 ID 后使用 | `index.js:26002–26025,26171,26490–26498` |
| `memory_event(create/set/append/close)` | `action` | create 缺 `name`。其余需 `eventId`。set 需实际变更，暂停需 `pausedReason`。append 有内容才产生对应记录，检查点填 `kind/text`，并提供四段。close 需 `outcome` 且先更新总览。本工具还有 `rename`，需 id 和新名 | `index.js:26843–26866,26958–27028` |
| `memory_recall(scope=events)` | `query` | 缺 `query`。查检查点需 `expand=eventId` 加 `checkpointIndex` 或 `idemKey`。可把 id 填进 query | `index.js:14528,26603–26606` |
| `memory_recall(scope=archive)` | `query` | 缺非空查词。返回命中行和文件名可交给下一步 | `index.js:14804,26603–26606` |
| `memory_read(kind=archive,name)` | `kind` | 有 name 读正文，省 name 列目录。长文按响应里的路径取完整原文 | `index.js:26535–26577` |
| `memory_procedure_list` | 无 | 可以直接查。按 `scope/stage/query` 筛选，可选 `includeNoise` | `index.js:27381–27386` |
| `memory_procedure(action=update/activate)` | 无，缺省 write | update 缺 `procedureId` 与实际变更。新写、激活缺 `title/steps` 就拒绝，晋升还需 `successCriteria` 等条件 | `index.js:27061–27073,27212–27219,27298–27315` |
| `memory_user` | `action,content` | 两个都未指明。跨项目追加用 `action=append`，整篇替换另有语义 | `index.js:26506–26509` |
| `memory_rules` | `op` | 短写缺操作。改删需 `index + expect`，新增和更新另带 `content` | `index.js:26794–26798` |

### 方法 C · 隔离执行

独立探针跑了 **42 个用例**。其中 4 个由探针按真实注册的 JSON Schema 在调用处理器之前拒绝。其余 38 个进入真实工具处理器。文件写入前记录候选并拦截持久化，临时锁按原逻辑清理。最终覆盖的隔离 profile 内 9 个夹具文件前后 SHA256 一致。技能测试初次有一次未被拦截的合成文件写入，后续只读用例排除了该写入，晋升规则以处理器分支核对。真实提交的双记录与重绘行为另在可弃的合成 profile 里验证，未涉及用户现有数据。工具执行阶段使用本地替身隔离模型调用。

| 编号 | 归类与隔离观察 | 草案落点 | 照做的结果与限制 |
| --- | --- | --- | --- |
| P1 | 重合。归档只给 scope 缺 `query`，长文结果在 8,000 字符处裁剪 | ⑦ 查词拿到 name 再读，超长提示改走返回路径 | schema 通过后按命中精确定位。没有命中就停 |
| P2 | 重合。事件只给 scope 缺 `query`，普通查询返回摘要 | ② 事件检索及检查点下钻 | 带真实 id 和定位字段可取单条原文。「取全文」在此指指定检查点 |
| P3 | 重合。预检缺 `note`，无效及关闭事件被拒 | ② 预检明确带 `note`，不确定归属先读再决定 | 具备正文时预检可运行。没有足够证据时不盲挂 |
| P4 | 重合。四段齐全但 R4 无定位仍拒，缺 revision 或 revision 不符也拒 | ② 定位、更新与首建分别给参数 | 已存在带有效版本，首建绑真实事件。缺前置停止，报告账本未写 |
| P5 | 重合。裸 plan 返回空正文，只有标题和引言的手写还会过不了 P-H1 | ② 区别投影和手写 | 投影走真实处理器抵达写入前，手写仍需完整结构和当前 revision |
| P6 | 重合。直接 close 的候选为 closed，summary 还保留旧值 | ② 结束先 set summary，再 close | 顺序与动作参数可执行。是否整件事结束由证据决定 |
| N1 | 新增。错误形状 `{type,content}` 进入候选但正文空。漏 `idemKey` 再追加，同一键换正文保留旧条 | ② 检查点明示 `kind/text`、四段及幂等键 | 同一事实重试用原键。新事实使用新键。只补感知时省 checkpoint |
| N2 | 新增。跨项目 `memory_user` 的原提示完全省去两个注册必填参数 | ③ 加 `action,content` | 能展开成 `{action:'append',content:'…'}` |
| N3 | 新增。合法旧 ID 数组和撤回原因仍不能通过空正文闸 | ④ 增项目笔记正文前置 | 有真实纠正内容可完成软状态修改。纯打标或纯 restore 暂无专用入口 |
| N4 | 新增。旧账本为感知和检查点传四个参数，R4 账本处理没有转发感知，首建也不走更新 WAL | ② 查回执，只补缺失的感知。已记检查点不再传 checkpoint | 能用 append 补真实感知。R4 一次原子写完二者仍需执行器接线 |
| N5 | 新增。显式首建标志写在公开说明。实际 R4 不存在文档时可凭真实事件进入首建，即使没有传该标志 | ② 保留 `createDocument:true` 条款 | 正常调用可提供该标志。只改提示无法强制旧调用必须提供 |
| N6 | 新增。事件重绘把手写卡移出活动 PLAN，旧锚点仍在归档。现存 PLAN 要过 CAS | ② `fromEvents:true` 仅事件板。手写保锚点和备注 | 纯事件投影与手写更新可分流。混合要求见下文 |
| N7 | 新增实测。旧账本产生 1 条 `handoff`，dry-run 后还是 1 条，正式日志后变 2 条，新增 `log`。旧白板落盘也可能另生成 `plan` 检查点 | ① 同文账本优先，② 已记录则省重复正文 | 可避免同文的显式重复调用。多个载体都必须持久化时目前无法用共同幂等键保证总数 |

补充复核中，缺 `expect` 的规则更新和删除都拒绝。技能更新缺 `procedureId`、激活缺标题都拒绝。当前铭文和新稿中的看板 tag 字面值一致。

### 需由 Lead 单列的接口和执行器限制

- **同文双载体且只写一次检查点。** 日志与交接各自产生幂等键，参数表既无共用键，也无只生成视图的开关。今日日志只投影 `log`。需要双载体时，先裁定是否接受两个独立记录，或设计一个明确的单写接口。 [日志写入](/D:/dsh-auto-memory/lib/index.js:25859) · [账本写入](/D:/dsh-auto-memory/lib/index.js:26341) · [日志投影](/D:/dsh-auto-memory/lib/event-write.js:443)
- **R4 原子写入四类感知。** Phase 0 只从工具说明得到「同次」结论，适用范围过宽。旧账本实际转发四类感知。R4 写入由不同的文档和 WAL 路径处理，稿件用现有事件 append 补缺。将四类感知纳入 R4 的同一次原子操作需要生产接线。 [R4 分派](/D:/dsh-auto-memory/lib/index.js:26224) · [旧账本转发](/D:/dsh-auto-memory/lib/index.js:26359) · [WAL](/D:/dsh-auto-memory/lib/ledger-doc/wal.js:252)
- **状态单改、首建门和混合白板。** 纯状态写入需新增或调整处理器契约，不能靠空正文完成。强制验证首建标志需要执行器实施。按事件全量重绘同时在活动白板保留手写卡，需要独立的合并策略。 [正文前置](/D:/dsh-auto-memory/lib/index.js:26171) · [首建分派](/D:/dsh-auto-memory/lib/index.js:26248) · [白板重绘](/D:/dsh-auto-memory/lib/index.js:26148)

任务书要求在这些接口事项上停手。正文方案使用已有能力的可执行子集，未把任何接口变更写成实施项。当前铭文所谓「15 条精简」实为七组。草案逐组保留现有内容，完整来源规则与工具长说明留在原位置。 [归属记录](/D:/dsh-auto-memory/docs/internal/DETAIL-BATCH1B-20261109.md:343)

## 4.5 缺失能力盘点

| 能力 | 分层 | 进正文 | 理由与来源 |
| --- | --- | --- | --- |
| R4 定位、版本、首建 | L1 | 进 | 省略即拒绝或误把已有文档当首建。 `index.js:26044–26054` |
| 检查点实参、同轮合并、重试键 | L1 | 进 | 省略可写空正文或重复。 `event-store.js:986–1025` |
| 四类感知有实据才填写及补缺 | L1 | 进 | 明确用户画像用 `userPercept`，普通观察按 `accepted/used` 进画像，`authorResponse` 按类型入选。R4 账本落盘后，对照事件记录补实际缺项。 `index.js:26035–26038,26359–26362`、`user-portrait.js:164` |
| 正文载体与软状态 ID 数组 | L1 | 进 | 不指向 `memory_note` 和正文会让短写无法执行。 `index.js:26021–26025,26171` |
| 改删规则先读 `index/expect` | L1 | 进 | 避免过期序号更新错条，也避免缺参拒绝。 `index.js:26794–26798` |
| 事件原文下钻 | L2 | 进 | 正文已经承诺查经过，补 `expand/eventId` 路径省二次试错。 `index.js:14528,26603–26606` |
| 事件来源白板重绘 | L2 | 进 | 事件来源时可自动生成，避免手抄。现存白板仍校验 revision。 `index.js:26015,26127` |
| 手写白板单卡更新 | L2 | 留工具说明 | 已有 `cardId + expectedCardRevision + content`。针对明确卡片才触发，省正文字符。 `index.js:26016–26017` |
| 最新全局时段总结 | L2 | 留工具说明 | `memory_read(kind=summary)` 很适合跨工作区回顾。在每轮收尾提醒中频率低。 `index.js:26535–26536` |
| 精确冲突裁定 | L2 | 留工具说明 | `memory_conflict(action=list/resolve)` 有三步及 `confirm:true` 的落盘门。省略任何门都可能误撤用户事实。 `index.js:27505–27510` |
| 技能库查询筛选 | L2 | 留工具说明 | 已提示先查查重和验收。已有 `scope/stage/query/includeNoise` 随场景可读，省每轮字符。 `index.js:27381–27386` |
| 技能库写入范围 | L2 | 留工具说明 | `memory_procedure(scope=workspace/global)` 只有新建决定范围，更新不迁移库。仅具体任务才需要。 `index.js:27063` |
| 外部记忆接入 | L2 | 留工具说明 | `memory_external(action=list/import)`，import 需 source，仅导入链接指针。继承其他工具记忆时再调用。 `index.js:26735–26738` |
| 只读账本归属复核 | L2 | 留工具说明 | `memory_note(attributionReview:true)` 是可选前置。直接用现有日志 dry-run 已覆盖短铭文的通用路径。 `index.js:26046–26050` |
| 白板按 tag 展开与回溯 | L2 | 留工具说明 | `memory_expand/tag` 与 `memory_trace/id` 在主动调查时会用。它们不属于收尾必写动作。 `index.js:27493–27499` |
| 记忆状态与漏写诊断 | L2 | 留工具说明 | `memory_status` 查位置、条数及待反思状态。怀疑漏写时先查，避免盲目补写。 `index.js:26670` |
| 阶段性主动固化 | L2 | 留工具说明 | `memory_consolidate` 提炼近期材料并写入长期记忆。用户要求归纳或阶段收尾确需固化时才有价值。 `index.js:27041`、`:19681` |
| 每日反思落盘 | L3 | 不采纳 | `memory_reflect` 由「昨日反思待生成」提示触发，先呈现反思再写。对应提示已给出完整调用方法。 `index.js:14134`、`:26730` |
| 日历和主动维护工具 | L3 | 不采纳 | `calendar_*`、`memory_maintain`、`memory_upgrade` 分别用于日程、旧日志归档维护和旧基座迁移，按相应任务触发 |
| 文献及适配工具候选 | L3 | 不采纳 | `literature_*` 与 `memory_fit_*` 未见于本基线的 22 个注册模型工具。此处不向模型承诺它们可调用 |

最终 **L1 5 项，L2 2 项，L3 0 项**。必填修复和已存在条文的恢复计入 §4.1 的缺陷或跳过条件统计。

### 用户画像的来源和写入

普通写入用 `memory_event(action=append)`，带实际 `eventId` 与 `userPercept:{kind,stage,text}`。用户明确确认了一项偏好、当前处境或尚未完成的目标时，`kind` 分别写 `preference`、`state`、`unfinished-goal`，`stage` 填 `accepted`。确认已有记录在后续实际用上时才填 `used`。用户明确同意、反对、纠正或拍板可写 `kind=authorResponse`，这一类按 `kind` 入选，不要求同样的 `stage`。例如用户确认下一版设置应默认关闭 50% 档，可记 `userPercept:{kind:'authorResponse',stage:'accepted',text:'确认默认关闭 50% 档'}`。 [事件追加](/D:/dsh-auto-memory/lib/index.js:26958) · [画像筛选](/D:/dsh-auto-memory/lib/user-portrait.js:164)

画像是在刷新事件后生成的投递段，读取当前工作区事件与 profile 下现有的 `memory/person/event-store.json`。上述模型工具将新增观察写入所属工作区事件。批次 4.1 接入了跨工作区画像读取，这 22 个模型工具中没有直接选择 person 库的写入参数。跨项目的长期规则与偏好继续用 `memory_user` 写入用户级 `MEMORY.md`。 [画像来源](/D:/dsh-auto-memory/lib/index.js:10537) · [用户级记忆工具](/D:/dsh-auto-memory/lib/index.js:26506)

### 按实际注册工具逐项核对

在隔离 profile 执行 `apply()`，读取模型工具注册对象的名称与参数 schema。插件共注册 **22 个**模型工具。审批正文点名 **9 个**，其余 **13 个**按各自的使用场景保留在工具说明或专用提示中。上一版盘点已经评估 19 个，其中六个通过日历和维护的分组行列出。本次补齐 `memory_status`、`memory_reflect`、`memory_consolidate` 的使用边界。该口径以本插件的注册表为准。见 [模型工具注册入口](/D:/dsh-auto-memory/lib/index.js:30530)。

| 模型工具 | schema 顶层必填 | 铭文覆盖及用途 | 来源 |
| --- | --- | --- | --- |
| `memory_log` | `note` | 正文。分类记录及预检，已知归属显式传事件 ID | `index.js:25458` |
| `memory_note` | 无 | 正文。项目笔记、账本、白板与结论状态。各种写入的前置见 §4.4 | `index.js:26001` |
| `memory_user` | `content, action` | 正文。跨项目用户规则与偏好 | `index.js:26506` |
| `memory_read` | `kind` | 正文点名归档回读。白板原版及 revision 也是该工具的读取场景。全局总结及其他读取类型按需使用 | `index.js:26535` |
| `memory_recall` | `query` | 正文点名事件与归档检索。交接材料和历史会话检索按工具说明使用 | `index.js:26602` |
| `memory_maintain` | 无 | L3。旧日志归档维护，`days` 缺省 30。仅在归档维护任务触发 | `index.js:26616` |
| `memory_upgrade` | `action` | L3。获同意后才启动旧基座迁移，另有查看状态和确认已汇报入口 | `index.js:26632` |
| `memory_status` | 无 | L2。怀疑漏写或用户询问存储位置时查状态。获同意后可用 `op=upgrade-plan` 读迁移步骤 | `index.js:26670` |
| `memory_reflect` | `date, text` | L3。在专用反思提示触发且已向用户呈现反思后，用被反思日志的日期写入 | `index.js:26730` |
| `memory_external` | `action` | L2。按需列出外部来源。接入时用可信来源 ID 写入链接指针 | `index.js:26735` |
| `calendar_add` | `title` | L3。用户日程、约定时间和截止日使用 | `index.js:26756` |
| `calendar_list` | 无 | L3。查询日程及稳定条目 ID | `index.js:26766` |
| `calendar_done` | `date, time, title` | L3。按查询结果标记完成，同名条目还需 ID | `index.js:26780` |
| `calendar_remove` | `date, time, title` | L3。按查询结果删除指定日程，同名条目还需 ID | `index.js:26787` |
| `memory_rules` | `op` | 正文。规则增删改，改删先取当前序号和原文 | `index.js:26794` |
| `memory_event` | `action` | 正文。建事件、追加、更新与关闭，改名按工具说明调用 | `index.js:26843` |
| `memory_consolidate` | 无 | L2。阶段性提炼近期五源材料，调用子代理，结果可写项目或用户长期笔记。工具描述仍以日志表述输入，生产收集链以五源为准 | `index.js:27041`、`:19681` |
| `memory_procedure` | 无 | 正文。写新技能、补修及激活，分别校验动作所需参数 | `index.js:27061` |
| `memory_procedure_list` | 无 | 正文。多步任务先查已有流程，其他筛选条件按需用 | `index.js:27381` |
| `memory_expand` | 无 | L2。给 `tag` 按主题展开白板或账本条目。三种白板模式均注册 | `index.js:27488–27496` |
| `memory_trace` | 无 | L2。给 `id` 回溯条目来源与版本。三种白板模式均注册 | `index.js:27488–27499` |
| `memory_conflict` | 无 | L2。先列冲突再预演裁定，真实落盘需明确依据及 `confirm:true` | `index.js:27505` |

三项新增盘点沿用既有调用时机。`memory_consolidate` 有独立的材料选择及运行代价。`memory_expand` 和 `memory_trace` 的注册描述仍写「需 boardMode=graph」，这条限制已落后于实际注册逻辑。

## 4.6 长度与判据

固定日期 2026-11-23。行尾为 LF。圆整后的 token 方法为 `Math.round(ASCII × 0.3 + 非 ASCII × 0.6)`。实测取审批代码块并拼接实际前导换行。日期代入增加 4 JS 字符与 4 字节。英文评估沿用前报告。

| 口径 | JS 字符 | UTF-8 B | ASCII | 非 ASCII | token 估算 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 旧完整帧，日期已渲染 | 1675 | 3034 | 992 | 683 | 707 |
| 新主模板，含 `{date}` | 1601 | 2553 | 1122 | 479 | 624 |
| 新⑦，自带 LF | 117 | 175 | 88 | 29 | 44 |
| 新两模板拼接，含 `{date}` | 1718 | 2728 | 1210 | 508 | 668 |
| 代入日期 | 1722 | 2732 | 1214 | 508 | 669 |
| **代入日期并加 `pushPart` 前导 LF** | 1723 | 2733 | 1215 | 508 | 669 |

| SHA256 口径 | 完整值 |
| --- | --- |
| 两模板拼接 | `6ed40ac0a9e6de885e6e2663c87148614cb43880d2f459409bdea4fda277df9f` |
| 代入日期 | `5fe771981bdaeff85699bee121115098c2c917bddfa657385c00ddaa8d38cd5a` |
| 代入日期并加前导 LF | `2ef1fe966bce77ca52df0f6e497af5d90bda8f2fcb0159c42e33c920d346984d` |

- **1,750 已裁定。** 以 5.1 上一版完整帧 1,700 的实测值加 50 字符作护栏。本次补齐语义后，完整帧 1,723，实际余量 27。
- **G4-6** 本轮按授权将单层模板与两模板合计的两项长度阈值改为 1,750。第三项 `total.length + 1 <= 1700` 继续约束含前导 LF 的未代入模板。生产词条当前通过。审批稿若直接落盘，该项会用 1,719 与 1,700 比较并失败。正式实施时需要处理这条断言，并用代入日期的完整帧与 1,750 对照。G4-6b 比较两侧词条逐字相等。 [G4-6](/D:/dsh-auto-memory/tests/smoke/smoke-test-g4-whiteboard.mjs:115) · [G4-6b](/D:/dsh-auto-memory/tests/smoke/smoke-test-g4-whiteboard.mjs:149)
- **总表 5.1 ③④**。③ 把旧 1,489 基准更新为「审批稿 1,723，渲染上限 1,750」。④ 指向当前 `index.js:1594–1597` 的 420 字符旧注释。产品落盘后按最终稿更新字符、字节及 token 估算口径。 [施工总表](/D:/dsh-auto-memory/docs/internal/CONSTRUCTION-PLAN-20261108.md:520)
- **实施收口** 同步服务端两个词条与客户端镜像，r26 和 Iter5 只按套件报出的 actual 处理。正文、镜像和守卫需在用户确认后走下一轮。 [服务端](/D:/dsh-auto-memory/lib/index.js:1598) · [客户端](/D:/dsh-auto-memory/lib/client.js:2678)

## 4.7 风险与未验证

| 风险 | 需要的验收 |
| --- | --- |
| 少写检查点或感知 | 遇到「账本已写但检查点未落」或「R4 没有感知」，核对真实回执后补一次。只有已写正文时才省 checkpoint。核对事件库而不是只看工具返回一句成功 |
| 少写账本 | 确保动 `lib/` 一定触发判断。无可用真实身份或 CAS 冲突时报告缺项，并查是否留有独立日志/事件，避免误把失败回执当交付 |
| 少写日志 | 同文采用账本时当日日志不出现该事实。单独日志仍按分类写。若用户明确要求当日日志也显示，按 §4.8 裁定冲突 |
| 多写账本或事件 | 同一轮重复调用、R4 部分成功后盲重试、同时重绘和 append 都可能写多。场景须核对检查点数、操作回执与实际文件 |
| 错误关闭或错重绘 | 未结束事件不得只凭空 next 关闭。手写卡不能交给整板事件投影，需验证原锚与用户备注 |
| 文案行为及成本 | 真实模型执行顺序、遵循率、计费 token、缓存命中和宿主逐轮行为均未验证。协议和夹具结果用于证明调用路径与前置，不能代替模型验收 |

## 4.8 待用户确认

| 决断 | A | B |
| --- | --- | --- |
| 铭文方向 | **中文判断清单**。审批上方全文后做一轮真实模型验收 | 同批另测英语等义稿。增加试验成本，且旧英文等义稿估算更长 |
| 长度目标 | **按修订稿完整渲染实测 1,723 审批**。距已裁定的 1,750 还有 27 字符 | 另行收紧长度。需要再排正文与工具说明的分工并重新审批全文 |
| 何时写账本与同文日志 | **按交接需要写，动 lib 仍必写**。有前置才落盘。账本已覆盖同文即跳过重复日志，同一内容不产生第二次显式 append | 保留账本与日志同时为必写。如果同时要求只新增一条检查点，需要另案调整执行器 |
| 归档提示位置 | **铭文保留⑦，明确 query 和读原文路径**。继续承担固定帧开销 | 把细节移到工具说明。释放帧空间，需重做归档可发现性验证 |
