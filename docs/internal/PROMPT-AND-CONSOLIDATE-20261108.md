# 铭文清单化 · memory_consolidate 能力评估 · 未完成项清查

> 日期 2026-11-08 · 工作区 `D:/dsh-auto-memory`（分支 preview）· **只读调查**：未改 lib/tests/tools/skins，未跑生成器，未改配置
> 产物：本文件（唯一产出）
> 测量对象：`lib/index.js`（2,077,967 B / 28,769 行 / CRLF）、`lib/event-render.js`（29,034 B / 503 行）、`lib/rules-layer.js`（740 行）、事件库 `event-store.json`（2,954,741 B / 45 事件 / 697 检查点）
> 字符口径：JS `String.length`（UTF-16 码元）；token 估算 = `ceil(chars/2)`（任务书指定口径，**非**分词器实测）；复算命令见 §4。

## 0. 结论速览

1. **铭文不是「没清单化」，而是「清单方向反了」**：现铭文 17 段 / 1,330 字符（第⑦段另 159，合计 1,489 / 745 token ≈ 快照预算 18.6%）。其中 59.0% 已是「X ⇒ 调工具」的可执行映射，但 **0 段给跳过条件、0 段给终止点**，23.7% 的条目（事件归属/append/set）**缺前置数据**——evt id 在注入面出现 **0 次**。注释 `:1534` 仍写「实测约 420 字符」，与实测差 3.17 倍。

2. **用户 6 点原型：1 点可直接落地、1 点半支持、4 点缺前置**。用户规则（`memory_rules`）可判定；项目规定只有 `memory_note` 一条通道，落不落进规约段由 `classifyText` 决定；事件更新 / 检查点 / 改名三件都要求 evt id（注入面 0 处），日历要求 calendar 段存活（本会话已被通道区 300 字符上限击杀）。**第 3、4 点应合并**（同一工具同一 eventId 的两种参数），改后为「1 门 + 5 判定 + 1 低频项」。

3. **「两难自解」只解一半**。清单化能解「不知道该不该写」（把 6 点变成是/否 + 显式终止位），也能消除「set 完再 append」的双写；但解不了三件事：**可见性**（41 个 active 只展开 2 个、目录只列 8 个 ⇒ 77.8% 不可见；检查点单条只显示 300/1,391.6 字符 = 21.6%）、**消费侧**（`dead` 45/45 全空，检查点四段全空 27.8%——写了没人读）、**去重**（规约 122 条 / 8,696 字符，模型无法逐轮查重；已有 2 个同名事件）。

4. **consolidate 是一个「append-only 文本提炼器」，不是记忆库管理器**。只读每日日志（每篇截尾 2,500 字符，最近 7 篇实际只喂 **12.7%** 的字符），**不读事件库 / 白板 / 账本 / 反思（67 篇）**；只会 `appendText`，项目笔记已 **23,634/24,000 = 98.5%**，6 个日期标题全部重复；用户层候选只进 `PENDING-USER-MEMORY.md`（15,411 字符 / 105 条、无容量闸门、无确认入口）。它不能承担「碎片事件合并 + 四段补全」——那需要事件级写盘、快照与回滚，而这条链路已存在但**零入口**。

5. **未完成项里最该先落地的是「拨了没反应」的开关**：8 个配置键前端有控件、后端真实读取点 = 0（`locale` 应剔除，是纯前端 i18n；`externalInjectionChars` 唯一命中在注释里）。其次是面板展开容器 `overflow:hidden` + 写死 `max-height:1800px`（`client.js:4465`）导致长内容被裁。这两项都是**用户可感**且改动面极小；`slimCheckpointCount`（无消费点、无数据源）、B9 派发调度（`run` 恒 undefined、`schedule` 零调用）、分层事件目录（已被独立段替代，建议取消）属纯内部，可降级。

---

## 1. 块 1 · 铭文清单化

### 1.1 现状测绘

#### 1.1.0 落点核对（先验 Lead 给的位置）

| Lead 给的位置 | 实测 | 判定 |
|---|---|---|
| `lib/index.js:1537-1560` 每轮尾部铭文 `snapshotInscription` | 具名字段实为 **1537–1553**（17 个物理段）；1554–1559 是注释；**1560 才是** `snapshotInscriptionArchive` | 区间正确，但「17 段 + 紧随其后 archive」应改为「17 段（1537–1553）+ 第⑦段在独立字段（1560），中间隔 6 行注释」 |
| `lib/index.js` 共 28,769 行 / 2,077,967 B | 实测 2,077,967 B / 28,769 行 | ✅ 成立 |
| 每轮注入方式 | `lib/index.js:13120` 一行注入两字段，保护级 `must` | ✅ 成立（额度紧张时不被按优先级丢弃） |

#### 1.1.1 17 段逐段字符（实测）

类型口径：**A** = 可执行且当前注入面已具备判定依据（能回答是/否，对应一次工具调用）；**B** = 可执行但缺前置数据（须先额外取数）；**C** = 解释性散文 / 不可判定的约束。

| # | 源行 | 字符 | token | 内容（逐字取自源码） | 类型 |
|---|---|---|---|---|---|
| 1 | 1537 | 19 | 10 | `[铭文 · 每轮提醒 {date}]` + 换行 | C 标签 |
| 2 | 1538 | 39 | 20 | 【收尾自检】本轮有实质产出才做；纯只读/闲聊轮跳过。 | A 门 |
| 3 | 1539 | 85 | 43 | ① memory_log，kind 四值（rule/preference/fact/todo），别一律 fact | A 指令 |
| 4 | 1540 | 47 | 24 | ② 白板/账本 + 事件；硬映射（满足即必须做，别自行判断「算不算」变化） | A 指令 |
| 5 | 1541 | 71 | 36 | · 本轮改过 lib/ 下任何文件 ⇒ 必写 memory_note(kind=handoff) 四段账本 | A 指令 |
| 6 | 1542 | 61 | 31 | · 白板与结束时的事实不符 ⇒ 必做 memory_note(kind=plan) | A 指令 |
| 7 | 1543 | 59 | 30 | · 只补一条可复用结论 ⇒ 才用 memory_note(kind=note, action=append) | A 指令 |
| 8 | 1544 | 98 | 49 | ★事件归属：先自问「我在做哪件事」，对不上就 create，「宁建勿挂」 | **B**（无 evt id 可对） |
| 9 | 1545 | 62 | 31 | · 有新进展 ⇒ memory_event(action=append, eventId, checkpoint) | **B**（无 evt id） |
| 10 | 1546 | 104 | 52 | · 目标/状态变了 ⇒ action=set；做完了 ⇒ action=close | **B**（无 evt id） |
| 11 | 1547 | 93 | 47 | ⚠ 事件只是索引；handoff 是原文载体；查全经过用 recall(scope=events) | C 解释（含 1 条指令） |
| 12 | 1548 | 81 | 41 | ⚠ kind=note ≠ 白板/账本；write 直接写 docs 的 md 不算插件记忆 | C 负向断言 |
| 13 | 1549 | 212 | 106 | ③ 技能库：先 list 查流程 → 命中照做；跑通 update 不新建；跨会话→note / 跨项目→user / 规则改→rules | A 指令 |
| 14 | 1550 | 105 | 53 | ④ supersedes / retract(+retractReason) / restore | A 指令 |
| 15 | 1551 | 106 | 53 | ⑤ 看板落列：tag 四值 type:goal / state / dead-end / progress | A 指令 |
| 16 | 1552 | 37 | 19 | ⑥ 语体：客观陈述、第三人称、只留事实/决策/路径 | C 不可判定 |
| 17 | 1553 | 51 | 26 | ⑧ 存量未归档：注入面出现该段就归入事件；无存量则零字节 | **B**（段本身可能被击杀） |
| — | **小计** | **1,330** | **665** | | |
| 18 | 1560 | 159 | 80 | ⑦ 旧日志在 archive/；两条取回命令 | A 指令 |
| — | **合计注入** | **1,489** | **745** | 占 `injectBudgetChars` 默认 8,000 的 **18.6%** | |

分类汇总（17 段 / 1,330 字符）：**A = 785 字符（59.0%）** / **B = 315 字符（23.7%）** / **C = 230 字符（17.3%）**。计入第 18 段（⑦，159，A）后：A = 944 / 1,489 = 63.4%。

#### 1.1.2 结构诊断（逐条给证据）

① **它已经是清单，但回答的是「写什么」，不是「要不要写」。**
17 段里 9 段是「X ⇒ 工具调用」的映射（①②③④⑤），**0 段以「若否 ⇒ 跳到第 N 条」收尾**，**0 段给出「本轮判定结束」的终止点**。唯一终止语义是第 2 段一句「纯只读/闲聊轮跳过」，其后紧跟的却是 7 条「必须写」的子分支 —— 结构与语义方向相反。

② **编号不连续且注入顺序倒置。** 源码为 ①-⑥ 后直接 ⑧（无 ⑦），⑦ 在独立字段 `:1560` 追加在字符串末尾 ⇒ 模型实际看到顺序是 ⑥ → ⑧ → ⑦。第 ⑧ 段自身的触发条件（「注入面出现『存量未归档』段」）又依赖另一段是否存在。

③ **注释与实况脱节（3.17 倍）。** `:1534` 原文：

```
  //   那里是 system prompt，不随对话增长）。实测约 420 字符 ≈ 210 token，单份快照预算 8000 的 5%。
```

实测该段 1,330 字符 / 665 token / 16.6%。该注释自 2026-09-20 后未随文本增长更新。

④ **20.2% 的字符不产生任何动作**（第 11/12/16 段：解释「事件只是索引」、说明「note ≠ 白板」、规定语体）。三段都是**写给模型看的解释**，不是可执行判定；第 16 段（语体）根本无法在本轮自证。

⑤ **「查全经过」指令与注入面重复。** 第 11 段要求用 `memory_recall(scope=events)` 查全经过，但注入面已含事件卡与目录；实测本会话可见事件 10 / 45（22.2%），模型无动机再查。

---

### 1.2 用户 6 点原型可行性（逐点核对真实工具与参数）

#### 1.2.1 6 点逐点核对

工具与参数以**源码定义**为准（`lib/index.js:25183-25259` 的 `defineTool` 调用），不引任务书措辞。

| 用户原型点 | 真实工具与参数（逐字取自源码） | 注入面是否已有判定依据 | 判定 |
|---|---|---|---|
| 1 用户层级规则是否更新 | `memory_rules`{`op` enum list/add/update/remove，`index`，`expect`，`content`(≤2000)，`dateSection`}；update/remove **必须带 expect=该条当前文本** | 有：`[用户规约]` 段**每轮完整注入、不参与裁剪**（本会话实测 122 条 / 8,696 字符） | ✅ 可判定；改/删需先 `op=list` 取 index+expect（+1 次调用） |
| 2 项目规定是否更新 | **无专用工具**。唯一落点 `memory_note`{`kind:'note'`, `action:'append'`, `content`} → `.dsh-memory/MEMORY.md` | 有：`[项目规约]` 段（本会话 10,210 字符） | ⚠️ **半支持**：写进去**不保证进规约段**；是否成「规则」由 `rules-layer.js:191-209` 的 `classifyText` 决定（无标记、无约束语汇 ⇒ `reference`，不进注入） |
| 3 当前事件是否更新 | `memory_event`{`action:'set'`, `eventId`(evt_8hex), `sections{goal,doing,deadend,next}`, `summary`≤400, `status`} | **否**：注入面 **0 处**出现 evt id | ❌ 不可判定（须先 `memory_recall(scope="events")` 取 id） |
| 4 检查点是否更新 | `memory_event`{`action:'append'`, `eventId`, `checkpoint{goal,state,dead,next,text,kind,panels,idemKey,quoteRef,quoteLine,rel,bytes,sha256}`} | **否**：同上缺 id；且只显示最近 ≤3 条、**单条 ≤300 字符** | ❌ 不可判定 |
| 5 日历是否更新 | `calendar_add`{`date,time,quadrant,title,location,reminder,note`} / `calendar_list` / `calendar_done` / `calendar_remove` | **否（且不稳定）**：日历段 `lib/index.js:13084` 是 `normal` 优先级，**通道区上限 300 字符内可被整段击杀**；本会话注入面已出现「[降级] 丢弃 …（calendar）」 | ❌ 不可判定（须先 `calendar_list`） |
| 6 事件名称修改（让名称覆盖真实进度） | `memory_event`{`action:'rename'`, `eventId`, `name`(≤80 字)}；`action` 枚举逐字为 `['create','set','append','close','rename']` | **否**：注入面有 `name`，但**无 id**；改名必须先定位 id | ❌ 不可判定（同 3/4） |

#### 1.2.2 前置数据实测：「模型每轮真正看到了什么」

（真实事件库 + 真实渲染函数的实测输出，非估计。）

| 指标 | 实测值 | 来源 / 含义 |
|---|---|---|
| 事件库总量 | 45 事件（active 41 / closed 4）、697 检查点、2,954,741 B | `event-store.json` |
| T2 事件卡展开数 | **2**（`eventMaxActiveInInject: 2`，`lib/index.js:776`；取值点 `:10047`） | 2 / 41 active = **4.9%** |
| 目录（T0）可见数 | **8**，截断丢弃 **35**（`EVENT_CATALOG_MAX_CHARS = 400`，实测输出 392 字符） | 8 / 45 = 17.8% |
| 合计可见事件 | **10 / 45 = 22.2%**；不可见 **35 / 45 = 77.8%** | 卡 2 + 目录 8 |
| **注入面出现的 evt id 数量** | **0** | `renderT2Pre` 只拼 name+status；`renderT0Pre` 只拼 name；slim `[当前事件]` 只给 `line`（summary 首句）——三处均不含 id |
| 事件卡实际字符 | 卡1 **370** 字符（以 `…` 结尾）、卡2 **50** 字符（仅「【事件】name [进行]」） | 上限 2,400 未用满；卡2 对应事件四段全空、0 检查点 |
| 四段（sections）填充率 | 全空 **24/45 = 53.3%**；填 3 段 **21/45 = 46.7%**；**填满 4 段 0/45 = 0%** | 逐事件统计 |
| 单字段空值 | `dead` **45/45 = 100% 空**；`goal`/`doing`/`next` 各空 24/45 | 同上 |
| 检查点四段填充 | `goal` 487/697（69.9%）、`state` 503（72.2%）、`dead` 178（25.5%）、`next` 201（28.8%）；四段齐 **163（23.4%）**；四段全空 **194（27.8%）** | 检查点 `text` 均值 **1,391.6** 字符、中位 822、最大 27,578 |
| 检查点正文长度 | **>300 字符 576/697 = 82.6%** | 渲染单条上限 `CHECKPOINT_ITEM: 300` ⇒ 均值下**只显示 21.6%** |
| 重复事件 | 44 distinct name / 45 事件，1 组重复：`evt_0127b3f9`（0 检查点）与 `evt_6e6497f7`（1 检查点）同名，且**同为本轮 T2 picks** | 归属失败的实证 |

关键源码（逐字抄回）：

```
lib/event-render.js:377:  out.push('【事件】' + String(ev.name || '(未命名)') + '  [' + (STATUS_LABEL[ev.status] || ev.status) + ']')
lib/event-render.js:122:  return cutPre(name, Math.max(1, room)) + suffix
lib/event-render.js:62:  CHECKPOINT_ITEM: 300, // ★单条检查点上限（现值单条 1,457 字独占，不设则 3 条必撑爆）
lib/index.js:13188:    //   文档契约：通道区是「条件式提醒，触发即清位，合计 ≤300 字符」。此前**没有任何上限** ——
```

#### 1.2.3 验证用户的担心：「写 4 项太难 ⇒ 退化成只写 memory_log」

**担心成立，且已在数据里发生**，但根因与用户表述不同，须分开：

1. **四段确实写不全**：sections 填满 0/45；`dead` 45/45 空；检查点四段齐 23.4%。这不是「不会写」，是**没有回报**：一次 `append` 就能带四段（同一个 `checkpoint` 对象），成本不变，而 `dead` 写完后在渲染侧无专属消费（空的段直接省行）。
2. **退化路径确实被选中**，机制是**接口可见性**而非意志：`memory_log` 是唯一**零前置依赖**的写工具（不需要 id、不需要事件归属）；而事件四件套（create/set/append/rename）**全部要求 evt id**，id 在注入面出现 **0 次**。模型在「不知道 id」时，唯一可行的写入就是 log。
3. **本轮已有同源证据**：两个同名事件（`evt_0127b3f9` / `evt_6e6497f7`）正是「无法对 id ⇒ 重新 create」的产物，两者同时进入 T2 卡片，白占一个卡片位。

**结论**：退化不是「4 项太多」，而是「3/4/6 点缺 id、5 点缺日历、4 点只显示 21.6% 正文」。若只把 6 点写成清单而不补可见性，第 3/4/6 条会被模型直接跳过，实际可执行只剩「写 log + 写 note + 改规则」——与当前行为几乎无差别。

#### 1.2.4 清单化能否成立的前提（技术判定）

须三件事同时在场，缺一即退化为「写 log」：

- **P-A 事件身份可见**：卡片/目录/精简行带 `id=evt_xxxxxxxx`（当前 0 处）。成本：每卡 +14 字符、每目录行 +14 字符；目录实测 8 行 ⇒ +112 字符（392 → 504），**超 400 上限**，须同步调 `EVENT_CATALOG_MAX_CHARS` 或只给卡片加。
- **P-B 上一轮写了什么可见**：检查点单条只显示 300 / 1,391.6 字符（21.6%），且 `buildCheckpointsBlockPre` **从最新往前收集**（`:333`），语义是「最近」而非「尾部」。模型看不到自己上一条结论的落点，无法判断「要不要更新」。
- **P-C 日历不被静默击杀**：`calendar` 为 `normal`，通道区 300 字符内先死 low、再死 normal；本会话实测已被丢。


### 1.3 改进后的清单建议（可判定 / 有序 / 带跳过条件）

设计原则（三条，均针对 1.1.2 的结构缺陷）：
1. **每条必须能回答是/否**，是/否两侧都给出动作或跳过；
2. **自上而下短路**：前一条为「否」时，只有后续仍可能为「是」的才继续，否则终止；
3. **合并同调用判定**：同一工具、同一参数的两种取值（`append` vs `set`）合成**一次判定**——这正是用户 6 点里第 3、4 点的重复。

建议清单（1 个门 + 7 条判定，顺序即判定顺序）：

| 序 | 判定问题 | 需要的可见输入 | 是 ⇒ 动作 | 否 ⇒ |
|---|---|---|---|---|
| **G** | 本轮是否产生了「新的可复用事实 / 决策 / 交付物」？（纯读取、纯等待、寒暄 = 否） | 无（自判） | 进入 Q1 | **终止本轮全部记忆写入**（显式终态） |
| **Q1** | 该事实是否关于「人」（偏好 / 纠正 / 拍板 / 当前处境）？ | 无 | `userPercept`（随 Q5 的 append 一次带，不单独调用）或 `memory_user` | Q2 |
| **Q2** | 它是否改变了「跨项目必须遵守什么」？ | `[用户规约]` 段（已完整注入） | `memory_rules{op:'add'/'update'/'remove', expect}` | Q3 |
| **Q3** | 它是否改变了「本项目必须遵守什么」（架构 / 判据 / 路径）？ | `[项目规约]` 段（已注入） | `memory_note{kind:'note',action:'append'}` | Q4 |
| **Q4** | 它推进了**哪一个**已存在的事件？（读卡片 `id=`） | **需 P-A**（当前缺失） | Q5 | 若是全新事项 ⇒ `memory_event{action:'create'}` 后终止；否则终止 |
| **Q5** | 推进形态是「新证据点」还是「状态/目标改变」？ | **需 P-B**（上一条检查点尾部） | 证据点 ⇒ `append(eventId, checkpoint{…})`；状态变 ⇒ `set(eventId, sections, summary)`；同一轮可同时发生，但**只是一次工具调用** | 终止 |
| **Q6** | 本轮的结论是否带「必须记住的时间点」（deadline / 约定 / 节点）？ | **需 P-C**（日历段） | `calendar_add`（或对既有条目 `calendar_done`） | 终止 |
| **Q7** | 事件名是否已不覆盖当前进度（`name` 与 `sections.next` 比较）？ | 卡片 `name`（已有） | `rename(eventId, name≤80)` | 终止 |

与用户 6 点的差异（技术判断，非搬运）：

- **合并第 3、4 点**：`set` 与 `append` 是同一工具、同一 `eventId` 的两种参数形态。拆成两条会让模型在「都像 / 都不像」时反复权衡；合成 Q5 后判定只需回答「是证据点还是状态变」。6 点 ⇒ **1 门 + 5 个实质判定点 + 1 条低频项**。
- **第 6 点（改名）降为末位并给比较对象**：用户原话「让事件的名称覆盖它真实的进度内容」不可判定（没有「真实进度」这个可读字段）。改为「`name` 与 `sections.next` 不一致」，成为是/否题。实测 `name` 长度均值 35.9 / 最大 57，**≤80 上限有余量**，改名不受长度限制。
- **新增 G 门并置于首位**：现铭文第 2 段那句「纯只读/闲聊轮跳过」在第 3 段「①…必须调」之前已失去约束力（结构与语义反向）。清单化必须把它变成**唯一出口**。
- **Q2/Q3 必须带「先查重」子句**：规约段本会话 8,696 + 10,210 字符、122 条，模型无法逐条比对 ⇒ 会在两层都写近重复条目。该问题**不能靠提示词解决**（见 1.4-反面 3）。

预算测算（字符）：
- 现铭文 1,330 + 159 = **1,489**；
- 上述 8 行清单（含跳过条件与工具名）约 **620–760** 字符；
- 净减 **约 730–870 字符（−49% ~ −58%）**；结构由「59.0% 可判定」变为「P-A/P-B/P-C 落地后 7/8 条可零额外 IO 判定」。

逐条验收判据（可执行，供后续实现批次使用）：
- V1：清单文本字符数 ≤ 760，且 17 段散文中 C 类降到 0；
- V2：清单每条都有「否 ⇒」分支（正则断言：以 `⇒` 结尾的行数 = 条件行数）；
- V3：对给定输入集（只读轮 / 改代码轮 / 改规则轮 / 用户裁定轮）分别断言模型选中的工具序列，与上表预期一致；
- V4：G 门为「否」时，后续 7 条判定不得出现在该轮工具调用中（负路径）。

### 1.4 两难自解判定

用户原话：「这下就两难自解了」。判定：**部分自解，不是自解。**

**正面证据（清单化确实能解的部分）**

1. 「不知道该不该写」——清单把它变成 **1 门 + 5 个是/否**，并给出显式终止位；现铭文在这点上只有一句被后文覆盖的跳过语。
2. 「写多了没用」中的「写多了」——合并 Q5 后一轮只产生 **1 次事件写入调用**（append 或 set），不再出现「set 完还要 append」的双写；四段随 checkpoint 一次带，成本不变。
3. 顺序化消除现铭文的编号倒置（⑥ → ⑧ → ⑦）与 20.2% 散文段。

**反面证据（清单化解不了的部分）**

1. **可见性**：77.8% 事件不可见、0 个 evt id 可见、检查点只显示 21.6% 正文。清单第 3/4/6 条**没有判定依据**，会被跳过——清单不会让模型看见它看不见的东西。
2. **消费侧**：`dead` 45/45 全空、检查点四段全空 27.8%。空不是因为不知道要写，而是**写了没有读者**（渲染侧无该字段的专属消费）。清单只会让写入更规范，不会让写入被用上。
3. **查重**：122 条规约与 45 个同名事件只能靠工具/人去重，清单在 8,696 字符的规约段里无法做全量比对 ⇒ 清单化会**增产重复条目**（本轮已出现同名事件 2 个）。
4. **成本**：清单本身占预算；若保留现有解释段再叠清单，预算反增（1,489 + ~700）。净减只发生在「删掉 C 类散文」的前提下。

**诚实列出：清单化解不了什么**

- 注入面可见性（事件 id / 检查点尾部 / 日历存活）；
- 写入后的使用（`dead` 段，以及 `checkpoint` 的 `panels`/`quoteRef` 等字段在渲染侧的消费）；
- 去重与合并（同名事件、近重复规则）；
- 多事件归属歧义（45 事件中 2 个同名；24 个四段全空的事件无法用四段区分）。


---

## 2. 块 2 · memory_consolidate 能力评估

测量面：`consolidateMemory`（`lib/index.js:18789-18900`，112 行）、`consolidateTurn`（`:18453-18718`，266 行，每轮自动沉淀）、定时入口（`:16258`）、系统提示里的介绍行（`:13365`）、容量闸门（`ensureBudget` `:9564-9600`）、确定性过滤（`lib/consolidate-filter.js`，71 行）。

### 2.1 它现在实际做了什么

| 维度 | 实测 |
|---|---|
| 输入① | 每日日志：`listDailyLogs(p.projectDir, 60)` 取最近 60 篇，按 `days` 截前 N 篇（默认 7），**每篇只取尾部 2,500 字符**（`truncateTail(text, 2500)`，`:18798`） |
| 输入② | `已有项目笔记(尾部)` 1,200 字符 + `已有用户级记忆(尾部)` 1,200 字符（`:18821/18824`） |
| 输入实际体量 | 本机最近 7 篇日志合计 **137,292 字符**、实收 **17,500 字符 = 12.7%**（7 篇全部超过 2,500 字符上限） |
| prompt | 6 条固定规则 + 严格输出格式 `[PROJECT]`/`[USER]` bullet，或无内容时只输出 `(无)`（`:18801-18825`） |
| 模型调用 | `runSubagent(prompt, 'auto-memory-consolidate-logs', agent)`（`:18830`） |
| 写回①（项目层） | `[PROJECT]` → `ensureBudget(agent,'note',…)` 通过后 `appendText(p.notesPath, '\n## ' + today + '\n' + bullets)`（`:18872`） |
| 写回②（用户层） | `[USER]` **不写用户级 MEMORY.md**，改写 `<userDir>/PENDING-USER-MEMORY.md` 待确认区（`:18878-18885`） |
| 写回③（日志层） | **不写**。consolidateMemory 不追加今日日志（那是 `consolidateTurn` 的 [LOG] 分支） |
| 失败分支（6 条，逐条可在返回值区分） | ①`subagents 服务不可用`；②`最近 N 天没有日志`；③**超时**（`_subagentLastTimeout` + `subagentTimeoutSeconds` 秒数）；④**无正文**（子代理正常返回但 text 块为 0）；⑤`text.includes('(无)')`；⑥容量跳过（`skipped.push('项目笔记(' + budgetRefusalTextPre(...) + ')')`） |
| 降级 | `ensureBudget` 内部最多 3 轮 `compactLayer`（`:9581-9595`），失败则分层跳过并在返回值列出层名与原因；**不抛异常**，整轮以文本回执返回 |
| 调度 | 每天 `consolidateScheduleTime`（默认 09:30）触发一次；失败当日有界重试（`scheduleBeginAttemptPre`/`scheduleOkPre`/`scheduleFailPre`，`:16253-16265`） |

确定性过滤（写盘前的唯一质量闸）：`filterPointsPre` 四条规则 —— 空壳变体（`无/暂无/没有/…`）、过程叙述开头（`我考虑/我排查/尝试/…`）、长度 < 8 字符、**同段内**重复（保序）。**无跨层去重、无与既有记忆的语义比对、无淘汰。**

### 2.2 它做不到什么（逐条，含证据）

| # | 做不到 | 证据（实测 / 源码） |
|---|---|---|
| 1 | **看不见事件库** | `18453-18900` 区间内 `event-store` 字样 **0 命中**；「event」字样仅 7 处，全部是 harness 的 `eventSeq` 与 success evidence 通道，与 v4 事件库无关。⇒ 它整理出的项目笔记与事件库是**两套互不相通的记忆** |
| 2 | **看不见白板 / 账本 / 反思** | 同上：无 `PLAN.md`、无 `handoff/`、无 `reflections/` 读取（本机 reflections 目录有 **67** 篇） |
| 3 | **只会 append，不会合并/去重/淘汰** | 写回只有 `appendText`（`:18872/18883`）；`[PROJECT]` 每次都在文件尾追加 `## <today>` 标题。实测项目笔记 **31 个 `## ` 标题里 6 个日期全部重复**（2026-11-04 有 8 个同名标题） |
| 4 | **没有「这条已经记过了」的机制** | 唯一防线是 prompt 一句「已经在下方『已有记忆』里出现的不要重复」+ **尾部 1,200 字符**的上下文（项目笔记实为 23,634 字符 ⇒ 只看到 **5.1%**） |
| 5 | **用户层永远停在「待确认」** | `[USER]` 落 `PENDING-USER-MEMORY.md`（2026-10 批次 G 有意设计）。实测该文件 **15,411 字符 / 105 条 bullet / 61 个标题**，**0 条重复文本**却从未被消费；而用户级 `MEMORY.md` 已 **24,080 字符（> 24,000 上限 80 字符）** |
| 6 | **撞容量上限时只能丢层** | 实测项目笔记 **23,634 / 24,000 = 98.5%**，仅剩 366 字符余量 ⇒ 下一次 `[PROJECT]` 追加大概率走 `ensureBudget` 压缩或直接被跳过。跳过后回执写 `被今日预算跳过: 项目笔记(…已达容量上限…)` |
| 7 | **待确认区无容量闸门** | `:18883` 与 `:18694` 两处对 `PENDING-USER-MEMORY.md` 都用**裸 `appendText`**，未经 `ensureBudget` ⇒ 该文件**无上限**（已 15,411 字符） |
| 8 | **不能修正已有条目的错误** | `superseded` / `retract` 只存在于 `memory_note` 的参数面（模型显式调用）。`consolidateMemory` 产出的是 bullet 文本，**没有任何状态位、id、指向旧条目的字段** |
| 9 | **看不到自己上次写了什么（除尾部 1,200 字符）** | 同上；条目无 id ⇒ 无法做「这条取代那条」 |
| 10 | **每日日志的早期内容永远看不到** | `truncateTail` 取尾部 ⇒ 一天之内前半段的决策被丢弃；且 12.7% 的采样率使「发散提炼」实际只覆盖当天末尾 |

补充：系统提示 `:13365` 对本工具的描述逐字为「也可调用 `memory_consolidate` 让 AI 读日志发散提炼长期要点」—— 与实现一致（只读日志），但与用户对「做梦式技能」的期待（整理整个记忆库）**不一致**：它连事件库、白板、反思都不读。

### 2.3 要达到「优质记忆库」还缺什么（P0 / P1 / P2）

| 级 | 项 | 为什么 | 落点 | 验收（可执行） |
|---|---|---|---|---|
| **P0-1** | consolidate 读事件库，产出「事件级」结论 | 现状两套记忆互不相通：事件库 45 事件 / 697 检查点从不进入提炼输入 | `consolidateMemory` 输入段追加：事件投影（name/status/四段是否空/检查点数/最近 1 条检查点首 200 字）。**只读**，不写事件 | 断言：输入 prompt 含 `event-store` 投影且事件数与库一致；负路径：库为空时该段零字节 |
| **P0-2** | 合并去重（同日多条 `## today` 合一；近重复 bullet 归并） | 实测 6/6 个日期有重复标题，且无 id 可供 supersede | 写回前对既有笔记做「同日期节合并」+ 近重复（规范化后前缀/编辑距离）抑制 | 断言：同一 `today` 二次运行后 `## today` 计数仍为 1；合理新增不被误并 |
| **P0-3** | 待确认区有容量闸门 + 确认入口 | 15,411 字符 / 105 条候选无上限、无消费路径；用户层已 100.3% 满 | ①`PENDING` 写入走 `ensureBudget`（新增 layer 或独立上限）；②提供「晋升/丢弃」入口（工具或设置页按钮） | 断言：待确认区超限时拒绝并给可读原因；晋升后用户级条目数 +1、待确认区 −1 |
| **P0-4** | 容量事实进回执（不静默） | 项目笔记 98.5% 满，用户看不到「下一次会失败」 | 回执里附 `used/limit` 与余量；接近阈值（如 ≥90%）时显式警示 | 断言：构造 90% 占用 ⇒ 回执含余量数字与警示词 |
| **P1-1** | 让 consolidate 能「改」而非只能「增」 | 现在只能 append；错误条目无法被纠正 | 产出格式扩展为 `[REPLACE oldId]{…}` / `[RETRACT oldId]`，落盘走 `memory_note` 的 `supersedes`/`retract` 通道 | 断言：给出旧条目 id 时写盘后该条带 `dsh-status` 行；旧条目正文仍在盘上 |
| **P1-2** | 打通「事件重整」既有链路（见 2.4） | `event-regroup` 4 模块 1,044 行**零调用点** | 给 `applyRegroupPre` 一个入口（工具或路由），复用其 dry-run / 令牌 / 快照 / 回滚 | 断言：dry-run 不写盘；apply 前后存储指纹变化且可回滚 |
| **P1-3** | 四段补全作为独立动作 | 45 事件中 24 个四段全空、0 个填满；补全需要 `set` 而非「追加文本」 | 独立于 consolidate 的「事件补全」通道（可用同一 AI 批处理，但写 `memory_event`） | 断言：对四段全空事件运行后 `sections` 四键非空且 `checkpoints` 数量不变（append-only 不被破坏） |
| **P2-1** | 采样率提升 | 12.7% 采样使提炼只覆盖当天末尾 | 按 `truncateTail` → 分段摘要（先粗后细）或提高单篇上限并降 `days` | 断言：输入覆盖率达到设定阈值，且 prompt 总字符不超预算 |
| **P2-2** | 主题聚类替代按日追加 | 现为「每天一个新 `## 日期` 节」，与「主题组织」目标相反 | 写回改为按主题节合并（`maintain` 的 prompt 已要求 `### 主题`，consolidateMemory 未要求） | 断言：同一主题跨日写入落在同一节 |

### 2.4 特别评估：consolidate 能否承担「给碎片事件做合并与四段补全」

**判断：不能，且不应让它兼管。** 四条理由，逐条有据：

1. **输入面不对**。它读的是按日切分的日志（且每篇只 2,500 字符尾部），事件是**跨日容器**；把「合并碎片事件」放进一个看不见事件库的函数里，等于让它在不理解目标对象的情况下改目标对象。实测输入里 0 处事件数据。
2. **写模型不对**。它唯一写动作是 `appendText` 文本追加；事件合并需要：把 N 个事件的 checkpoints 迁到 1 个、旧事件标 `archived`、**不物理删除**、写前快照、令牌校验、可回滚。这些语义在 `event-regroup-apply.js` 里已经实现（`:144 applyRegroupPre`、`:241 rollbackFromSnapshotPre`、`MAX_BACKUPS = 20`），与 consolidate 的文本管道是两套设施。
3. **append-only 边界**。事件的 `checkpoints` 是 append-only（不可改不可删）；「四段补全」是 `set`（重写 sections），与「新增结论」是两种权限。若由 consolidate 批量代写，会把「模型直写通路」变成「后台批写通路」，失去 `memory_event` 的字段级校验与幂等键。
4. **既有设计已把这件事放在别处**。仓库已有完整的 R1/R2/R3/R6 链（纯函数建议 → 只读扫描 + prompt → 严格 JSON 解析 → 令牌 + 快照 + 回滚落盘），并已裁定「机械分类只作加速器，具体分类由 AI 解决」（`event-regroup.js` 文件头逐字记录用户裁定）。

**但有一个真问题必须指出**：该链**没有入口**。全仓检索 `regroup` 的 14 处命中里，除 4 个模块自身，只有 `upgrade-apply.js:48` 复用了其快照/回滚函数；`applyRegroupPre` / `buildRegroupPromptPre` / `parseAiBatchPre` / `suggestGroupsPre` **全部零外部调用**。1,044 行代码处于「已实现但不可达」状态 —— 这是块 3 的一级候选。

**分工建议（与任务 A 的交界点）**：
- `consolidateMemory` 保留「日志 → 项目笔记/待确认区」的既有职责，**不再扩张**；
- 新增独立「事件整理」入口，直接复用 `event-regroup-*` 四模块（R2 扫描 → AI → R3 解析 → R6 落盘），其中「四段补全」作为该入口的第二种动作（`fillSections`），走 `memory_event(action=set)` 的同一校验；
- 两者共用同一个「AI 调用 + 严格 JSON 校验」骨架，但**写盘路径必须分开**（文本 vs 事件库），否则回滚语义不成立。


---

## 3. 块 3 · 未完成项清查

### 3.1 检索面与方法（可复算，先给命中）

| 面 | 命令 | 命中 |
|---|---|---|
| 文档（docs/ 689 篇 .md + artifacts/ 491 篇 .md） | 见 §4 的 C5 | 含「本轮只/本批只/下批/后续批次/留待/未做/待接/下一批」的 **docs 139 篇 / artifacts 103 篇** |
| **代码注释**（lib/*.js，最富集） | 见 §4 的 C6 | 16 处（index.js 9 / client.js 3 / team-pull.js 3 / memory-importance.js 1） |
| 提交信息 | `git log --format='%h %s' -n 400` + 过滤 | **1 条**（`32f15edc …（暂不动 index.js）`） |

**方法结论**：这类「留待下批」在本仓**主要写在代码注释与派工文档里，不在 commit subject 里**（400 条提交只 1 条带标记）。只查 git log 会漏掉全部实质孤儿。

### 3.2 清查结果

判定口径（两问）：①**有没有消费点**（不是「有没有定义」）；②**用户能不能感知**（前端有无控件 / 拨动后有无行为 / 界面有无裁切）。

| 编号 | 项 | 计划出处（逐字） | 实测状态 | 用户可感 | 处置建议 |
|---|---|---|---|---|---|
| **O1** | 9 个「前端有控件、后端零读取」的配置键：settingsEntryInDsSettings / settingsEntryInPluginsPage / welcomeTourEnabled / locale / externalInjectionChars / globalBriefUnattended / teamShowMemberBadges / teamMemberName / teamAuditEnabled | 前端逐键渲染控件（client.js 各有 4–13 处引用） | 后端真实读取点（`config.<key>` / `cfg.<key>`，排除注释）**全部 = 0**；其中 externalInjectionChars 唯一命中 `index.js:13048` 落在注释里（「旧写法 … 算完之后全仓 0 处读取」） | **是（最强）**：拨开关 → 写进配置 → 后端不产生任何行为 | 见 §3.3-① |
| **O2** | 面板展开容器终态写死 1800px | `R4-DESIGN-TRUTH.md:694`：「MOTION-SPEC §4.3 已列为『单独一批』的遗留待办」 | `client.js:4464` `[data-dam-disclosure] { overflow: hidden; … max-height: 0; … }` + `:4465` `[data-dam-disclosure][data-phase="open"] { opacity: 1; max-height: 1800px; … }` ⇒ 内容高于 1800px 的作者区被 **overflow:hidden 裁掉** | **是**：长内容展开后被切，无滚动条 | 补实现（改 0→测量高度，或 open 态改 `max-height: none` + `overflow: auto`）；须真机截图取证 |
| **O3** | `slimCheckpointCount` | `index.js:1144-1145`：「★P1 只落配置键（本批）；P2 才接状态机。故此处**只定义不消费**，消费点在 P2 的七档状态机」 | 全仓 .js **1 处**（就是该定义 `:1169`）；tests 有 1 处默认值断言（`smoke-test-v5-p1-inject-throttle.mjs:80`）；**且数据源不存在**（`slimEventT1` 投影只有 `{id,line}`） | 否（前端无该控件；用户设 5/7 也无入口） | 删键 + 从测试断言移除；或降级为「实验项」并在配置注释标注「无消费点/无数据源」 |
| **O4** | 事件重整链路 R1/R2/R3/R6 | `event-regroup.js` 文件头：「**具体事件的分类还是得 AI 来解决**」（用户裁定）；`event-regroup-apply.js` 文件头：「提案 → 批准 → 落盘 + 快照 + 回滚」 | 4 模块合计 **1,044 行**（292+259+232+261）；`applyRegroupPre` / `buildRegroupPromptPre` / `parseAiBatchPre` / `suggestGroupsPre` **零外部调用**；全仓非模块命中仅 4 处，其中 1 处是 `upgrade-apply.js:48` 只 import 快照/回滚两个函数 | **是（间接）**：45 事件 / 697 检查点、2 个同名事件，用户只能手工整理 | 补入口（工具或路由）或明确删码。判据：已实现且含 dry-run/令牌/快照/回滚，删掉是浪费；补入口成本低于重写 |
| **O5** | 团队派生重算的去抖调度（B9） | `index.js:21064-21065`：「**只建对象**：`run` 由后续批次注入（届时用 `engine._teamDerivedRun`），本批只保证「关闭时零行为」与「定时器 unref」」 | `_teamDerivedRun` 全仓 **2 处**（注释 + `:21071` 的三元兜底）⇒ `run` 恒 `undefined`；且 `_teamDerived.schedule(…)` **零调用点** ⇒ 整个调度器不转 | 否（团队面板只显示 derived 状态字段） | 补实现（接 run + 调 schedule）或摘除对象与状态投影；判据：纯内部、零用户可感，可延后但要写进「未做」清单 |
| **O6** | Tier-0/分层注入「加事件目录」 | `V4-MASTER-PLAN-2026-10-24.md:813`：「| 3 | `buildTierLayerInjection` 加事件目录 | ⬜ **未做** | … 建议**取消本项**，待用户确认 |」 | `lib/tier-layer-inject.js` 中 `eventCatalog` / 「事件目录」 **0 命中**；用户确认从未发生 | 否（已有独立 `event-cards` 段替代） | **按建议取消**并把裁定写进文档（否则明年又被当成「漏做」） |

#### 3.2.1 与「孤儿」容易混淆的三类（本批实测排除，避免误判）

| 表面线索 | 实测 | 结论 |
|---|---|---|
| `memory-importance.js:23`「待 P3 RRF 实际接线时作为加权因子」 | `index.js:14275-14280` 已 import `computeImportancePre` 并把 `impMap.set(mid, …)` 喂给融合排序 | **已接线**，注释过期 |
| `index.js:28517`「action='run' 留待 B0 行为实验」 | `:28529` `if (action === 'run')` 已实现（B0c，2026-09-25） | **已实现**，注释过期 |
| `client.js:6527`「看板改卡留待后续」 | 前端只读组件，改卡走后端工具 | 有意分层，非孤儿 |

⇒ 判据：**注释里的「留待」一律要核到调用点**；「有定义/有注释」不等于「有消费」。反之「注释说过期」也不等于「没实现」。

### 3.3 处置建议（每类给判定依据）

**① 9 个死键（O1）—— 拆成两组处理，不要整批删**
- **8 个「前端控件 + 后端零读取」**（settingsEntryInDsSettings / settingsEntryInPluginsPage / welcomeTourEnabled / externalInjectionChars / globalBriefUnattended / teamShowMemberBadges / teamMemberName / teamAuditEnabled）：**判定 = 欺骗性 UI**（用户拨动后无任何行为，比「没有这个开关」更差）。
  处置优先级：**先摘控件或置灰并标注「未接线」**（1 处前端改动，可立即消除误导），再按产品决策决定是否补实现。
  理由：补实现是**产品决策**（每个键背后都是一套行为），不属于「漏做」；而「显示可用但无效」是**缺陷**。
- **locale**：**不是死键**，是纯前端 i18n 键（client.js 126 处引用，后端本就不该读）。应从「9 键」清单中剔除，否则会误导后续批次去「修」一个不需要修的东西。
- externalInjectionChars 的**真实缺口**不是「没接线」而是「通道区 300 字符上限未调」（`index.js:13051-13054` 已写明「接 1400 会突破那个上限 ⇒ 需要一并调通道区预算」）。处置：要么一并调预算，要么把控件摘掉。

**② 面板 1800px（O2）—— 补实现（用户可感、成本低）**
判定依据：`overflow:hidden` + 固定 `max-height` = 长内容必被裁；这是**可见的功能缺陷**，不是风格问题。验收须真机：构造高度 >1800px 的 disclosure，断言展开后内容底部可见（截图 + `scrollHeight <= clientHeight`）。

**③ slimCheckpointCount（O3）—— 删键（推荐）**
判定依据：消费点 0、数据源 0、前端控件 0 ⇒ 三者皆无，保留只会让后来人以为「调大就能给更多检查点」。若担心删键让白名单缩水（`:982-989` 的同族理由），则**降级为实验项**：保留键但在注释标明「无消费点/无数据源，勿在设置页暴露」，并删掉那条测试断言（它守的是一个不存在的功能）。

**④ 事件重整链路（O4）—— 补入口**
判定依据：1,044 行、含 dry-run + 令牌 + 快照（`MAX_BACKUPS = 20`）+ 回滚，且已按用户裁定设计（「机械分类只作加速器」）。零调用是**接线缺口**，不是设计问题。最小落地：一个路由/工具调 `scanAllWorkspacesPre` → AI → `parseAiBatchPre` → `previewApplyPre`/`applyRegroupPre`，默认 dry-run。

**⑤ B9 调度（O5）—— 标注为实验项，暂不补**
判定依据：纯内部、零用户可感、且团队能力整体未上线（团队面板字段已在，但派生重算没有业务驱动）。写进「未做」清单并注明「对象在、调度不转」，避免下次被当成已实现。

**⑥ 分层事件目录（O6）—— 取消并留痕**
判定依据：已被独立 `event-cards` 段替代（D6 裁定）。把「取消」写进文档，终止它反复出现在未做清单里。

### 3.4 按「用户能不能感知」排序（这是落地顺序）

1. **O1 的 8 个死键控件**（拨开关没反应 —— 最强可感，且是「欺骗性 UI」）
2. **O2 面板 1800px 裁切**（看得见的内容被切掉）
3. **O4 事件重整无入口**（用户面对 45 事件 / 2 个同名事件只能手工）
4. **O3 slimCheckpointCount**（无控件，纯内部）
5. **O6 分层事件目录**（纯内部，且已有替代）
6. **O5 B9 调度**（纯内部，零业务驱动）

注：前两项合计改动面很小（1 处前端条件 + 1 条 CSS），建议作为独立小批先做；后四项需要产品决策或较大接线。

---

## 4. 复算命令清单

统一前置：工作目录 `D:/dsh-auto-memory`，Node ≥ 18，命令均为只读。

```powershell
# C1 铭文 17 段逐段字符 + 合计（输出 17 行 + SUM17 + archive）
node --input-type=module -e "import fs from 'node:fs';const L=fs.readFileSync('lib/index.js','utf8').split('
');const val=(n,re)=>{let s=L[n-1];if(re)s=s.replace(re,'');s=s.replace(/^s*+s*/,'').replace(/,s*$/,'');return new Function('return '+s)()};let t=0;for(let n=1537;n<=1553;n++){const s=val(n,n===1537?/^s*snapshotInscription:s*/:null);t+=s.length;console.log(n,s.length)}console.log('SUM17',t,'token',Math.ceil(t/2));console.log('archive',val(1560,/^s*snapshotInscriptionArchive:s*/).length)"
```

```powershell
# C2 事件库：sections 填充分布 / 单字段空值 / 检查点四段与长度
node --input-type=module -e "import fs from 'node:fs';const s=JSON.parse(fs.readFileSync('C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json','utf8'));const es=s.events;const d={0:0,1:0,2:0,3:0,4:0};let n=0,h={goal:0,state:0,dead:0,next:0},a4=0,n0=0,cm=[],ce={goal:0,doing:0,dead:0,next:0};for(const e of es){const q=e.sections||{};d[['goal','doing','dead','next'].filter(k=>typeof q[k]==='string'&&q[k].trim()).length]++;for(const k of ['goal','doing','dead','next'])if(!(typeof q[k]==='string'&&q[k].trim()))ce[k]++}for(const e of es)for(const c of (e.checkpoints||[])){n++;let x=0;for(const k of ['goal','state','dead','next'])if(typeof c[k]==='string'&&c[k].trim()){h[k]++;x++}if(x===4)a4++;if(x===0)n0++;cm.push(String(c.text||'').length)}cm.sort((a,b)=>a-b);console.log('events',es.length,'sectionsFill',d,'emptyPerField',ce);console.log('cps',n,'cpFields',h,'all4',a4,'none',n0,'mean',(cm.reduce((a,b)=>a+b,0)/n).toFixed(1),'median',cm[Math.floor(n/2)],'>300',cm.filter(x=>x>300).length)"
```

```powershell
# C3 事件卡与目录的实测输出（用产品自己的纯函数，不启动插件）
node --input-type=module -e "import fs from 'node:fs';import {pathToFileURL} from 'node:url';const m=await import(pathToFileURL('D:/dsh-auto-memory/lib/event-render.js').href);const s=JSON.parse(fs.readFileSync('C:/Users/JH Z/.dsh/memory/workspaces/--D--dsh-auto-memory--/handoff/event-store.json','utf8'));const p=m.pickT2EventsPre(s.events,2);console.log('active',s.events.filter(e=>e.status==='active').length,'picks',p.length);for(const e of p)console.log(e.id,String(e.name).slice(0,20),'cardChars',m.renderT2Pre(e).length);const c=m.renderEventCatalogPre(s.events,{applyVisibility:true,excludeIds:p.map(e=>e.id)});console.log('catalog',c.text.length,'included',c.included,'dropped',c.dropped)"
```

```powershell
# C4 注入面是否出现 evt id（0 = 不出现）
node --input-type=module -e "import fs from 'node:fs';for(const f of ['lib/event-render.js']){const L=fs.readFileSync(f,'utf8').split(/?
/);L.forEach((l,i)=>{if(/out.push|return cutPre/.test(l))console.log(f+':'+(i+1),l.trim().slice(0,120))})}"
```

```powershell
# C5 文档面的孤儿标记分布（docs 689 + artifacts 491 篇 .md）
node --input-type=module -e "import fs from 'node:fs';import path from 'node:path';const walk=(d,o=[],k=0)=>{if(k>3)return o;let es=[];try{es=fs.readdirSync(d,{withFileTypes:true})}catch{return o}for(const e of es){if(e.name==='node_modules'||e.name==='.git')continue;const p=path.join(d,e.name);if(e.isDirectory())walk(p,o,k+1);else if(/.md$/.test(e.name))o.push(p)}return o};const pats=['本轮只','下批','后续批次','留待','未做','TODO','待接','下一批','本批只'];for(const d of ['docs','artifacts']){const res={};for(const f of walk(d)){let t='';try{t=fs.readFileSync(f,'utf8')}catch{continue}let n=0;for(const p of pats)n+=(t.match(new RegExp(p,'g'))||[]).length;if(n)res[f]=n}const a=Object.entries(res).sort((x,y)=>y[1]-x[1]);console.log(d,'files',a.length,'top',a.slice(0,5))}"
```

```powershell
# C6 lib 代码注释里的「留待」面（16 处）
node --input-type=module -e "import fs from 'node:fs';const pats=/只定义不消费|消费点在|留待|下批|后续批次|待 P[0-9]/;for(const f of fs.readdirSync('lib').filter(x=>x.endsWith('.js'))){const L=fs.readFileSync('lib/'+f,'utf8').split(/?
/);L.forEach((l,i)=>{if(pats.test(l))console.log(f+':'+(i+1),l.trim().slice(0,110))})}"
```

```powershell
# C7 每个孤儿项的「有没有消费点」核验
node --input-type=module -e "import fs from 'node:fs';const files=fs.readdirSync('lib').filter(f=>f.endsWith('.js'));for(const k of ['slimCheckpointCount','_teamDerivedRun','applyRegroupPre']){const hits=[];for(const f of files){const t=fs.readFileSync('lib/'+f,'utf8');t.split(/?
/).forEach((l,i)=>{if(l.includes(k))hits.push(f+':'+(i+1))})}console.log(k,hits.length,hits.slice(0,8).join(' '))}"
```

```powershell
# C8 9 个配置键的「后端真实读取点」（排除注释；输出行需人工排除以 // 开头的行）
node --input-type=module -e "import fs from 'node:fs';const files=fs.readdirSync('lib').filter(f=>f.endsWith('.js')&&f!=='client.js');for(const k of ['settingsEntryInDsSettings','settingsEntryInPluginsPage','welcomeTourEnabled','locale','externalInjectionChars','globalBriefUnattended','teamShowMemberBadges','teamMemberName','teamAuditEnabled']){const hits=[];for(const f of files){const t=fs.readFileSync('lib/'+f,'utf8');t.split(/?
/).forEach((l,i)=>{if(new RegExp('(config|cfg)\\.'+k+'\\b').test(l)&&!/^\s*\/\//.test(l))hits.push(f+':'+(i+1))})}console.log(k,hits.length,hits.join(' '))}"
```

```powershell
# C9 提交信息面（400 条里只有 1 条）
git log --format='%h %s' -n 400 | Select-String -Pattern '留待|下批|未做|本批只|后续批次|待接|暂不|先只'
```

## 5. 未验证 / 边界

- **token 为估算口径**（`ceil(chars/2)`，任务书指定），非分词器实测；真实 token 取决于模型词表。
- 事件卡/目录/事件库统计取自**本机真实数据**（45 事件 / 697 检查点，2026-11-08 05:5x）。未在空库、80+ 事件库、其他工作区复测；`eventMaxActiveInInject` 若被改配置，可见数随之变化。
- 「`dead` 45/45 空 ⇒ 无消费」依据的是**渲染侧源码**；未检查前端面板与检索侧是否消费该字段。若前端消费，则该字段的价值在面板而非注入面，块 1 的结论需修正。
- 通道区击杀日历读自源码 `:13187-13190` / `:13273-13282`，并在本会话注入面观察到「[降级] 丢弃 …（calendar）」；**未做**「构造超限 → 断言 calendar 被丢 → 调优先级后复绿」的变异验证。
- 块 3 的 O2（1800px）**未真机复现**：结论来自 CSS 静态阅读（`overflow:hidden` + 固定 `max-height`）。须按项目纪律用 headless Chrome 读 `getComputedStyle`/`scrollHeight` + 截图取证后才能定级。
- O4 的「零调用」结论来自静态 grep（含模块自引用排除），**未做动态 import/运行时探针**；若存在字符串拼装式动态加载（本仓未发现），结论需修正。
- 本文件全程未启动插件、未跑 smoke、未改任何源码；所有结论为**静态源码 + 磁盘数据实测**，不含端到端行为验证。

- **基线口径提醒（实测，非本文件改动）**：任务书给的 `lib/index.js` 2,077,967 B / 28,769 行是**工作树**读数，不是 HEAD。实测 HEAD = **28,761 行**；工作树与 HEAD 差 `9 insertions(+), 1 deletion(-)`（净 +8 行）—— 属**他方未提交改动**，本文件未写入 lib/ 任何文件（本会话对 lib/ 只有 readFileSync / grep）。引用「28,769 行」时须注明「工作树」，否则与 HEAD 对不上。
- 块 3 的 O4 若最终走「删码」而非「补入口」，需先确认没有未入库的提案/文档按名引用这四个模块（本文件只做了静态 grep，未做引用完整性核验）。
