# R3-A · 老前端机制地图（以「机制」为单位测绘 `lib/client.js`）

> **测绘对象**：`D:\dsh-auto-memory\lib\client.js` — 7,734 行 / 689,407 B / CRLF / ES5（`var` + `var h = React.createElement` 别名）/ 零构建手写 `__ModuleLoader__`。
> **取证方式**：只读源码，按行号区间读取 + 正则统计；**每个结论附 `lib/client.js:行号`**；无代码证据的判断一律显式标注「**推断**」。
> **本轮零代码改动**：未修改 `lib/`、`tests/`、`tools/`、`docs/ui-demo/`、`docs/proposal/` 下任何文件；唯一新增文件即本报告。
> **写本文的动机**：上一轮给出的「13 页签 → 4 个一级入口」映射**漏了 `refine`**（`RefineTab`，L3455-3580），根因是把页签当排版问题而非业务闭环问题。本文把「每个机制是否仍有完整入口」作为测绘单位。

---

## 0. 先把地图的骨架定死：三层结构 + 一份唯一事实

### 0.1 宿主槽位（承载面）——共 7 个注册点

`client.js` 只通过 `ctx.slots.inject(...)` 对外暴露界面，全部注册集中在 `registerSurfaces()`（**L7652-7716**）：

| # | 槽位 | id | order | 组件 | 证据 |
|---|---|---|---|---|---|
| 1 | `sidebar.footer.action` | `auto-memory-pre` | 5 | `SidebarButton` | L7654-7656 |
| 2 | `shell.overlay` | `auto-memory-pre` | 5 | `MemoryPanel`（浮层） | L7657-7659 |
| 3 | `shell.overlay` | `auto-memory-pre-dialogs` | 6 | `DialogHost`（全屏弹窗） | L7660-7662 |
| 4 | `shell.overlay` | `auto-memory-pre-autocont` | 7 | `AutoContinueHost`（右下角接续卡） | L7663-7665 |
| 5 | `settings.section` | `auto-memory-pre` | 25 | `SettingsPage` | L7666-7668 |
| 6 | `conversation.view` | `auto-memory-pre-panel` | 78 | `MemoryPageView`（「记忆」并列页） | L7674-7681 |
| 7 | `conversation.view` | `auto-memory-pre-kanban` | 80 | `KanbanView`（整页白板看板） | L7686-7691 |
| (8) | `conversation.view` | `auto-memory-pre-graph` | 81 | `WhiteboardGraphView`（**默认隐藏**） | L7702-7712 |

第 8 个默认关闭：`WBG_ENABLED` 只认 `localStorage['dam-wbg-enabled']==='1'`（L7702-7704），代码保留是因为「画布依赖 kanban-board 在当前会话能解析出正确工作区，实测解析失败时返回 `enabled:true` 但 ws 为空 + 0 卡」（L7692-7701）。**这不是死代码，是一个被临时摘掉的机制。**

**接续页签的注册是条件性的**：`conversation.view` 的「记忆」页只在 `panelPos` 为 `page` 或 `both` 时注册（L7674），切换承载面时由 `refreshSurfaces()` 重注册（L7717-7721）。这条曾出过事故——「自毁按钮」：在 page 档点一下就把本页签注销，用户实测「上面的东西连按钮一起消失」（L5666-5668），现改为 page ↔ both 互切（L5648-5651）。

### 0.2 唯一事实（single source of truth）

| 事实 | 唯一来源 | 证据 |
|---|---|---|
| 13 个页签的**键序与文案** | `MEMORY_TABS()` | L5621-5623 |
| 13 个页签的**组件分派** | `MemoryTabBody(tab, nonce)` | L5606-5620 |
| 当前页签 | 模块级 `panelTab`（**浮层与并列页共享**，不会有第二份 `useState`） | L138-139 / L5631 / L5691 |
| 承载面 | `panelPos`（`bottom-left` / `page` / `both`，默认 `both`） | L52-60 |
| 配置写入 | `saveConfigPatch()`（L1537-1552），旧版有 4 条互不相同的写配置路径，已止血 | L1531-1536 |
| 配置读取 | `configOf(d)`（L1562），宿主恒返回 `{config, path}` 外壳，直读外壳曾导致「开关只能关不能开」 | L1553-1561 |

> 注释 L5601-5605 说明抽取动机：两种承载面必须「同内容、同页签、同数据」，若各写一份 body 分支，页签一多必然漂移。

### 0.3 一处**应当更正**的命名（给 Lead）

任务书把横切机制写作「`WB_KANBAN_LANES` 相关」。**实测 `WB_KANBAN_LANES` 在 `client.js` 中命中 0 次**（`grep` 计数 0）。泳道机制的真实实现是一组分散的常量与函数：

- `KX_LANE_COLOR`（L2413-2420）+ `kxLaneColor()`（L2421）——六条泳道配色
- `LANE_LABEL_ZH`（L3023）——`{goal:目标, state:进行中, deadend:失败与弯路, progress:进度与下一步, archive:版本归档, misc:其它}`
- `wbLaneTone()`（L2164-2172）——泳道 → 色值
- `wbLayout()` 的 `ORDER` 固定列序（L2743）
- 注释 L2730：「泳道是**有限的 6 类**」（goal/state/deadend/progress/archive/misc）

下文一律按真实符号名引用。

---

## 1. 分派层：13 个页签的真实清单（逐字取自源码）

`MEMORY_TABS()`（L5621-5623）返回 13 项，顺序即渲染顺序：

```
[['overview'], ['logs'], ['refine'], ['hub'], ['storage'], ['notes'], ['plan'],
 ['reflections'], ['connect'], ['calendar'], ['search'], ['workspaces'], ['stats']]
```

中文文案取自同文件 i18n 表（L237）：`refine` 显示为 **「唤起回顾」**（L237）、英文 `refineTab: 'Recall review'`（L506）。**这一点很关键：老前端的页签标签本身就没有「refine」这个词，任何按字符串找 `refine` 的审计都会漏掉它**——上一轮漏掉 `refine` 的一个直接技术原因就在这。

`MemoryTabBody`（L5606-5620）为 13 个键各自 `return h(XxxTab)`，`refine` 在 **L5609**；函数末尾 `return h(SearchTab)`（L5619）是兜底分支，即 **`search` 无需显式匹配**——审计时若只数 `if` 分支会得到 12 条，**实际是 13 个**（推断：这正是「13 个页签」容易数错的另一处陷阱）。

### 0.4 测绘口径声明

下文每个机制按六要素展开：**①真实职责 ②界面元素（含 `data-dam-*`）③调用接口 ④状态机 ⑤与其它机制的关系 ⑥三层归属（单人 / 项目 / 团队）**。
「三层归属」的判据取**数据落盘位置与作用域**（用户级 `~/.dsh/memory/MEMORY.md` / 项目级工作区记忆目录 / 跨工作区集合），而非界面上放在哪个篮子——这正是上一轮把「团队」当排版容器的错误源头。

---

## 2. 十三个页签机制（逐一）

### M1 · overview —「今天」的工作台（`OverviewTab` L3357-3451，95 行）

**① 真实职责**：回答「我今天在这个项目里做了什么、有没有欠账」。它不是仪表盘，是**收尾动作的入口**：一次性生成反思。

**② 界面元素**：`GreetingCard`（L3157-3273，117 行）承载问候语 + 昨天时间轴 + 提醒；`data-dam-collapsible` 折叠的跨工作区总结（L3417）；`data-dam-kv` 状态行（今日条目数 / 最近反思日期 / 工作区，L3426-3429）；自动沉淀即时反馈（L3431-3435）；「一键反思」按钮（L3438）；技术细节折叠里显示四个落盘路径与大小（L3445-3450）。

**③ 调用接口**：`API.workspaces`（POST，`force:false` 读缓存，L3380）；`API.state`（GET + `ws` 参数，L3381 / L3399 / L3410）；`API.greet`（POST，L3385）；`API.reflectAuto`（POST，L3408）。

**④ 状态机**：`state=null` → `Loading`（L3404）；进入页 → 走缓存；**若 `state.greeting` 存在但没有问候语 → 自动补生成一次**（宿主按时段缓存，不会重复生成，L3383-3393）；页面常驻 **30 秒轮询** `API.state` 保持数据新鲜（L3397-3402）；`reflectBusy` 期间按钮禁用防重复提交（L3406-3407）。

**⑤ 关系**：`workspaces` 与 M11 同源（M11 是它的展开版）；`reflectAuto` 与 M8 反思页共用同一接口（L4733）；`state.todayEntries` 与 M2 的日志列表同源。

**⑥ 三层归属**：**项目层**（主），但跨工作区折叠块是**团队层**的唯一投影点——`WorkspaceGraph` 在此以 `onSelect: function(){}` **空回调**渲染（L3420）。**注意：这里的关系图不可交互**，点击无任何反应，是真·只读投影。

---

### M2 · logs —「规则 + 用户笔记 + 日志」的只读+可编辑层（`LogsTab` L3582-3638 + `FoldableLogs` L3640-3658 + `RulesEditPanel` L3702-3795）

**① 真实职责**：这是**两个硬性注入面的管理者**。页面顶部两块（硬性约束、用户级 MEMORY.md）都是**每轮无条件注入**的稳定内容，日志属于翻查型内容。

**② 界面元素**：`data-dam-section` 包裹的两块——`RulesEditPanel`（L3626）与用户级 `MEMORY.md` 卡片（L3627-3631）；`FoldableLogs` 折叠日志列表，标记 `data-dam-fold` + `data-open` + `aria-expanded`（L3645）；`RulesEditPanel` 每条规则 `data-dam-rule`，含 `data-dam-content`、编辑 textarea、保存/取消/删除（L3773）；新增区 textarea + 按钮（L3776-3790）；**「下一轮注入会变成什么样」的 `pre` 预览**（L3793）。

**③ 调用接口**：`API.list`（GET，L3605）；`API.state`（取 `userText` 与 `userTextTruncated`，L3606）；`API.file`（打开某篇日志，L3612，path 形如 `2026-09-23.md`，L3656）；`API.rulesList`（GET，L3713）；`API.rulesApply`（POST，L3721）。

**④ 状态机**：日志列表**默认收起**（L3600），展开 → 逐日卡片 → 点击进入单篇（`open` 非空时列表整体让位，L3617-3620）。规则编辑：每条有「展示 / 编辑」两态，`draft` 是 `{idx: text}` 映射；`apply(op,payload)` 的三态回报 `r.error` → `❌`、成功 → 用**后端回传的新列表**直接替换本地（L3725，「即时回显」用户硬性偏好）并清空 draft。删除**真删且不可撤销**——代码注释写明理由：该层渲染器**不认任何状态标记**，软删标记会被当正文注入模型（L3766-3767），故走 `window.confirm` 二次确认（L3768）。

**⑤ 关系**：`reflections` 页（M8）与它共用 `API.list`，但各取各的字段（M2 取 `logs`，M8 取 `reflections`）。规则段是 13 个注入分区之一（`rules-section`，L6649）。

**⑥ 三层归属**：**跨层**——规则段与用户级 MEMORY.md 是**单人层**（跨项目），日志是**项目层**。这是全前端唯一同时管两层的页面。

---

### M3 · refine —「阴影候选人工反馈」闭环（`RefineTab` L3455-3580，126 行）★上一轮漏掉的机制

**① 真实职责**：它是**主动唤起的质量控制闭环**。系统在 shadow 模式下会记录每一次「它认为该唤起」的判定（候选），本页让人**逐条裁定**「该激活 / 只预取 / 应抑制 / 有害 / 改目标」，裁定结果进 append-only 队列，用于离线重放与策略演进。用户原话级文案：「对每次唤起判断给出你的裁定(A 该激活/P 只预取/S 应抑制/H 有害/E 改目标),审批队列将用于离线重放与策略演进」（L269）。**这不是一个展示页，是全前端唯一的人工标注入口。**

**② 界面元素**：`refineSub` 说明行（L3543）；判定队列汇总卡（L3545-3556）含 `A×n / P×n / S×n / H×n / E×n` 徽标与 `fb.hints` 提示，右上角注明「判定队列(近 100 条)」；**按天分组的卡片流**（`data-dam-flow` 打在分组容器上——注释 L3558-3560 明确：CSS 规则是 `[data-dam-flow] > [data-dam-card]` 直接子元素，打在页签根上会退化成无效接线）；每张卡 `data-dam-card`（L3566）含：

- **泳道徽标**（`laneBg`，L3490/L3528）：`explicit`「明确召回」/ `proactive`「主动观测」
- **决策徽标**（`decBg`，L3489/L3527）：`emit` 绿 / `prefetch` 橙 / `suppress` 灰
- **投递结果徽标**（L3571-3573）：`✓投递×n` / `技能✓` / **`未投递`（红）**——`decision==='emit'` 但无投递时显式报警
- **reasonCodes 芯片**（`reasonChip`，L3491/L3576，等宽字体）
- **APES H 五键裁定行**（`apeRow`，L3530-3541）：每键 `data-dam-btn`，选中态用 accent 色高亮

**③ 调用接口**：`API.shadowRecent`（GET，L3470）；`API.reviewFeedback`（GET 取队列汇总 L3473；POST 提交裁定 L3479-3481，body = `{observationId, choice}`）。

**④ 状态机**：
- 加载态：`err` → 错误行（L3504）；`data===null` → loading（L3505）；`data.length===0` → **「(暂无唤起记录——需要 shadow 观测产生数据)」**（L3506 / 文案 L270）。
- 裁定态机：`sent[observationId] = choice`（L3462-3464、L3483）。**提交成功后本地立即翻面**（`if (j && j.ok)` 才置位，L3483），即「该激活/只预取/应抑制/有害/改目标」五态；**失败静默**（L3484 `.catch(function(){})`，无错误回显）。
- 队伍汇总态：`fb.byChoice[ch]` 计数为 0 时该徽标不渲染（L3549）。
- **注意（推断）**：裁定是**可覆盖**的——同一个 `observationId` 再次点击会用新 `choice` 覆盖本地 `sent`，代码层没有「已裁定则锁定」的门。

**⑤ 关系**：数据源 `shadowRecent` 是**只读投影**，用户判定写入 **append-only `review-queue.jsonl`**，**不直接改任何策略/参数**（L3453-3454 注释原文）。它与 M10 统计页的第三条通路 `shadow` 是同一份数据的两种视角：
- M10（`StatsTab`，L5125）看**数量与质量比**：`events / hits / distinct / zeroHit`（L5080-5083）
- M3 看**逐条内容并给出裁定**
两者标签互补：`statsChShadow: '③ 主动唤起'` + `statsChShadowHint: '系统判断该唤起 → 质量视角：唤起了但没命中的比例'`（L230-231 / L499-500）。
**这条链路是全前端唯一的「人给模型打标签」闭环**，入口只在 M3。

**⑥ 三层归属**：**单人层**——裁定队列是本机对「唤起策略」的偏好样本，不含项目语义；但它是**项目层质量**的度量输入。**推断**：若新 IA 把它放进「项目」，会让用户以为裁定是按项目隔离的，与真实落盘不符。

---

### M4 · hub —三层记忆中枢 + 技能审批（`MemoryHubTab` L3798-4019，222 行）

**① 真实职责**：把记忆按**三层模型**（技能 procedures / 事实 facts / 经历 episodic）摆出来，并**对技能做审批与库归属管理**。它是「自动沉淀出来的东西到底成了什么」的唯一可见面。

**② 界面元素**：`data-dam-flow` 卡片流（L4018）；**双库视图卡**（`hubScopeTitle`，L3874-3877）显示默认库、各库条数、工作区是否可写；技能行 `data-dam-content` 含 `scopeBadge`（`data-dam-scope` = `workspace|global`，L3882-3887）；审批队列每行含 `stageLabel`、观察标、📌 置顶、⚠ 高风险、**`whyNotPromotable` 区块**（L3932-3938）、**晋升后注入预览** `<details>`（`hubInjectPreview`，L3940-3948）；动作按钮族：`data-dam-scope-to` 归属转移（L3890-3897）、晋升（L3962）、**批准(人工)**（L3968）、**强制晋升**（L3977）、直接激活（L3978）、弃用 / 置顶（L3979-3980）。

**③ 调用接口**：`API.memoryHub`（GET 投影 L3814；POST `hubAct` L3822；POST `transfer-scope` L3840）。

**④ 状态机**（技能生命周期）：`observed → candidate → validated → active → deprecated`，由 `stageLabel`（L3664-3667）做中文映射；`observationOnly` 为真时显示「观察（不参与自动晋升）」（L3925）且**结构上不可能晋升**（无 successCriteria）。

**审批门三态**（这是本页最精细的状态机）：
| 门 | 判据 | 界面表现 | 证据 |
|---|---|---|---|
| 可晋升 | `p.promotion.decision === 'promote'` | 显示「晋升」按钮 | L3961-3962 |
| 待人工批准 | `decision === 'ask'`（高风险） | 显示「批准(人工)」 | L3967-3968 |
| 仅统计门拦住 | `p.promotion.overridable === true` | 显示「强制晋升」 | L3976-3977 |
| 结构门拦住 | `gateKind === 'structural'` | **不给按钮**，只说明原因 | L3692 / L3969-3975 |

**⑤ 关系**：`hubScopeTransfer` 走 `migrate()` 的两阶段提交，**失败必须显示 `rolledBack` 与 `reason`**——注释 L3836-3837 原文：「静默成 done 等于把回滚藏起来，正是用户列为『功能坏了』的那种表现」。它与设置页 `skills` 分区（L7239-7258）共用同一批配置键。

**⑥ 三层归属**：**三层的交汇点**——`scopeView`（L3870）就是「单人（global 技能库）/ 项目（workspace 技能库）」的切换器；事实层与经历层是项目层产物。**这是新 IA 里唯一天然属于「团队」的机制**（跨工作区共享的技能库）。

---

### M5 · storage —记忆语料的体检、外科手术与搬迁（`StorageTab` L4024-4257，234 行）

**① 真实职责**：三件事，缺一不可——**①健康扫描**（逐源 sidecar↔正文 digest 比对）**②stale 一键自愈**（只重建 sidecar，正文不动）**③按 memoryId 删除**（正文原子删 + 在途激活包清理 + 派生事实撤销，三联动）。外加 **④迁移搬包**（导出 → 预览差异 → 确认导入的三步向导）。职责定义见 L4021-4023。

**② 界面元素**：语料健康卡（`counts.ok/counts.total`，L4172）逐源 `✓/⚠/✕` 状态行（L4175-4177）；「重新扫描」/「修复 stale (n)」按钮（L4180-4182，stale 为 0 时降透明度且点击无效，L4181）；删除卡含 `data-dam-select` 语料文件下拉 + `mem_…` 输入框 + 删除按钮（L4187-4196）；最近动作审计行（只取 `audit.slice(-4)`，L4198-4202）；迁移卡 `migTitle`（L4209）含两组「输入框 + 选择目录 + 动作」行、plan 差异明细（新增/覆盖/重写命中/涉及文件，L4225-4240）、**冲突策略三选一** `keep / overwrite / rename`（L4242-4244）、结果卡（L4247-4253）。

**③ 调用接口**：`API.storageManage`（GET L4139 / POST `act()` L4147 / 动作后重拉 L4157）；`API.pickDir`（L4085）；`API.migrateExport`（L4100）/`API.migrateInspect`（L4117）/`API.migrateImport`（L4130）。

**④ 状态机**：`data.indexEnabled === false` 时**整体降级但不报错**——顶部给警告并指引到「设置 → 语义记忆总开关」开启「记忆锚定索引」，其余功能照常（L4167-4170）；动作失败原因走**特判映射**：`reason === 'no-doc-store'` 翻译成人话（L4152-4154）。迁移是四态：`idle → preview(plan) → apply → result`，任何失败走 `migFail()` **把 `error`/`errors`/`warnings`/`skipped` 一并显示，绝不静默**（L4072-4081）。导入冲突默认 `keep`（L4069）。

**⑤ 关系**：与 M4 是**两套**删除/管理面——M4 管技能条目的 `deprecate`（软状态），M5 管**正文文件的物理删除**（硬删除）。二者不可互相替代。

**⑥ 三层归属**：**项目层**（语料是工作区记忆目录下的文件），但**搬迁（migrate）是跨项目的**——它把整包记忆从一个工作区搬到另一个（`targetWs`，L4117 / L4130）。

---

### M6 · notes —项目笔记的追加写入（`NotesTab` L4259-4296，38 行）

**① 真实职责**：往**项目级 `MEMORY.md`** 追加一段内容。它是记忆写入链路上唯一**由人直接书写**的入口（其余写入者都是模型或自动沉淀）。职责定义见 L4259。

**② 界面元素**：`notesPathLabel` + 路径展示（L4289）；`data-dam-input` textarea（6 行，L4290）；`data-dam-row` 内的追加按钮与提示（L4291-4293）；成功消息 / `data-dam-error`（L4294-4295）。

**③ 调用接口**：`API.state`（GET，取 `notesPath`，L4277）；`API.note`（POST `{content}`，L4284）。

**④ 状态机**：`draft.trim()` 为空则 `save()` 直接 return（L4282）；`saving` 期间按钮禁用；成功 → `setMsg(d.result)` 并**清空草稿**（L4285）；失败 → `setErr`。**只追加，不可编辑、不可删除**（L4284 只发 `content`）。

**⑤ 关系**：与 M2 的「用户级 MEMORY.md」是**两个不同的落盘目标**——本页写**项目**笔记，M2 写**用户级**记忆。二者在界面上被放在两个页签里，容易让人误以为是同一份文件。容量上限由设置页 `fNoteCap` / `fUserCap` 分别控制（默认 24000 字符，L7229-7230）。

**⑥ 三层归属**：**项目层**（单目标、无作用域开关）。

---

### M7 · plan —白板 / 交接账本 / 水位 / 接续 的同一页（`PlanTab` L4442-4700，259 行）★本页承载 6 个横切机制

**① 真实职责**：它是**长会话续命的驾驶舱**。页签名「白板」，实际渲染顺序（`rows.unshift` 层层上浮）为：白板内容 → 单文件查看 → 白板看板 → 新版看板结构化视图 → **水位卡** → 自动接续说明 → 版本/账本时间线 → 一键接续。逐条见下。

**② 界面元素**：
- **开关卡**（`handoffSwitchTitle`，L4568-4582，**恒渲染，两种状态下都在**，L4696-4698）：白板开关、看板模式快捷切换（`boardMode`，L4574）、自动接续开关、阈值输入（0.5–0.95 步进 0.05，L4580）
- **白板内容卡**（`planTitle` = 「白板 · PLAN.md(项目全貌)」，L4605）；`wsBound === false` 时改为未绑定提示（L4602-4603）
- **看板卡**（`data-dam-content` 内嵌 `KanbanBoard`，L4611）
- **结构化索引卡**（标签导航 + 段视图），**只在 `kbData` 缺席时兜底显示**（L4621，判据与理由见 L4613-4620）
- **水位卡**（L4659-4671）：`token / window · pct%`、来源徽标、计量徽标、进度条、阈值说明
- **接续卡**（`continueCardTitle` = 「一键接续」，L4690-4694）：按钮 + 进度消息
- **版本线**：`planVersions`（白板历史版本）与 `planLedgers`（交接账本时间线）两组按钮（L4681-4688），文件名经 `shortLedgerName()`（L4557-4563）压成 `09-23 20:15` 形态，完整名进 `title`

**③ 调用接口**：`API.config`（L4487）；`API.handoffState`（GET 主数据 L4524 / 单文件内容 L4549）；`API.kanbanBoard`（L4527）；`API.handoffContinue`（L4426，经 `runContinueFlow`）；`API.handoffPermission`（L4397 / L4404）；`API.autoContinueThreshold` 等经 `saveConfigPatch`（L4508）。

**④ 状态机**：
- **水位卡三态**：`wl.window > 0` → 正常显示；`wl.window` 未知但 `wl.at` 或对象非空 → 显示「未能从本会话读取模型窗口」+ 恢复方法（L4652 / L4661 / L4668-4670）。**这条是 2026-09-23 刚修的**：旧条件 `wl.window > 0` 使未测出窗口时**整张卡消失**，连说明都不可达（L4649-4651）。
- **开关回显态**：`autoSave(patch)` 必须做**键名翻译**（`autoContinueEnabled → enabled`、`autoContinueThreshold → threshold`），否则「按钮永远不回弹、点了看似没反应」——而写盘其实是成功的（L4496-4500 原文）。
- **接续执行态**：`contBusy` → `runContinueFlow({onProgress})`（L4510-4520）。

**⑤ 关系**：与 M2/M4 共享 `handoffEnabled` / `autoContinueEnabled` 配置键（L4468-4469 注释：两处不可能各说各话）；`kbData` 与 M16 的整页看板同源（同一 `API.kanbanBoard`）。

**⑥ 三层归属**：**项目层**（白板与账本都是工作区内的文件），但「一键接续」**跨会话**——它是会话级的机制（见 M18）。

---

### M8 · reflections —每日反思的生成与阅读（`ReflectionsTab` L4702-4757，56 行）

**① 真实职责**：把「昨天做了什么」沉淀成一篇反思文件，并提供回看。它是 M1「一键反思」的**专用展开页**。

**② 界面元素**：`data-dam-row` 内的一键反思按钮 + 提示（L4743-4745）；`msg` 消息行（L4746）；空态 `data-dam-muted`（L4747）；逐日卡片（标题 = `日期 · 大小`）+「查看」按钮（L4750-4751）；打开后整页让位给内容 + 「返回」（L4740-4741）。

**③ 调用接口**：`API.list`（GET L4720；生成后重拉 L4735）；`API.file`（L4726，path = `'reflections/' + r.name`，L4751）；`API.reflectAuto`（POST L4733）。

**④ 状态机**：`busy` 防重入；成功 → `setMsg(d.result)` 并**重拉列表**（L4734-4735）；失败 → `setMsg(t('failed') + e.message)`；打开态与列表态互斥。

**⑤ 关系**：与 M1 用同一个 `reflectAuto` 接口，但 M1 只显示「最近反思日期」，本页负责**生成与全文阅读**。反思是 Tier-0 常驻目录的一个层（`reflection 0/1` 的层账概念见宿主侧）。

**⑥ 三层归属**：**项目层**（文件落在工作区的 `reflections/` 目录）。

---

### M9 · search —模型侧检索的预览窗口（`SearchTab` L4759-4807，49 行）

**① 真实职责**：让人**亲眼看到模型检索会拿到什么**。两条通路并列：`recall`（词法/语义原文片段）与 `smartRecall`（AI 分析后的答案 + 关键词 + 命中）。

**② 界面元素**：`data-dam-input` 查询框（回车即搜，L4787）；两个按钮（`searchBtn` / `smartSearch`，L4788-4789）；`Loading` 行（L4790）；`smartAnswer` 卡（L4791-4804）含答案正文、`keywordsLabel`、**命中行带结论层标记**（`hit.mark`，L4800-4802，如「⚠已撤回」）；`resultTitle` 卡（L4806）。

**③ 调用接口**：`API.recall`（POST L4775）；`API.smartRecall`（POST L4781）。

**④ 状态机**：`busy` 互斥；两个动作**互相清空对方结果**（L4774 / L4780）；失败时 `result` 直接置为错误串（L4776）而 `smart` 置为结构化空壳 + 错误（L4782）——**两条通路的失败形态不一致**（前者是纯文本，后者仍是对象），这是可复用的观测点。

**⑤ 关系**：`smartRecall` 的 `hit.mark` 是**结论层标记**（⚠ 已撤回 / superseded）的**唯一可见渲染点**——L4795-4797 注释原文：「宿主早已把结论层标记放进 hits 投影……前端此前零渲染 ⇒『这条结论已失效』在界面上完全看不出来，用户会把它当有效结论读」。**这条机制在新 IA 里必须保留，否则「作废结论」重新变成不可见。**

**⑥ 三层归属**：**跨层**（检索本身不区分作用域，结果里可能同时出现用户级与项目级条目）。

---

### M10 · stats —三来源召回统计（`StatsTab` L5013-5126，114 行）★横切机制「三来源分流」的载体

**① 真实职责**：回答「三条召回通路各自在动吗、代价花在哪、质量如何」。页头注释直言动机：「用户要『看哪个召回得更多、哪个更重要』，这是一眼看的活，不适合塞进已有 12 个页签的任意一个里」（L4893-4896）。立场：**纯只读展示 + 一个清零按钮，不改召回排序**（L4897-4899）。

**② 界面元素**：`Card` + 总览环形图 `DamDonut`（L5098-5101）；`statsSince` 起始时间 + 复位按钮（L5102-5107）；三张通路卡由 `chCard()` 统一生成（L5075-5090）；图元全部手绘 SVG 零依赖：`DamDonut`（L4906）/ `DamBars`（L4937）/ `DamSpark`（L4959）/ `DamHeat`（L4982）/ `DamStat`（L5002）；骨架态 `data-dam-stat-skeleton`（L5047）。

**③ 调用接口**：`API.recallStats`（GET L5024；`?reset=1` POST L5039）。

**④ 状态机 — 三来源的真实定义（本机制的骨架）**：

| 通路 id | 中文名 | 视角 | 证据 |
|---|---|---|---|
| `model` | ① 模型主动检索 | 高信号：哪些内容真的被需要 | L5063-5064 / L226-227 |
| `inject` | ② 每轮自动注入 | 成本视角：注入预算花在哪一段 | L5065 / L228-229 |
| `shadow` | ③ 主动唤起 | 质量视角：唤起了但没命中的比例 | L5066 / L230-231 |

数据来源写在注释里：**「三条通路各自一格」**（L5062）；`channelIds` 由宿主下发而**非前端硬编码**（L5061）。指标四件套：`events / hits / distinct / zeroHit`（L5080-5083）。`inject` 卡额外把 `top` 映射成**按字符数排序**的条形（`score` 当条长、`count` 当数字，L5117-5122），回答「哪一段最占预算」（L5115）。**「没开 shadow 时该卡自然为 0，不谎报」**（L5124）。

轮询：**15 秒自动刷新**，纯 GET 只读，卸载清定时器（L5030-5035）。这条是 2026-09-23 修的第二真因——此前只在挂载/复位时拉一次，「用户盯着统计页数字也永远不动」（L5030-5032）。

**⑤ 关系**：`shadow` 通路的**逐条内容与人工裁定**在 M3；`inject` 通路的分区明细在设置页 `window` 分区（13 个注入开关，L7165-7223）；`model` 通路的可见结果在 M9。

**⑥ 三层归属**：**跨层**（统计不区分作用域），是**唯一的跨层健康度仪表**。

---

### M11 · workspaces —跨工作区总结（`WorkspaceTab` L5128-5169，42 行 + `WorkspaceGraph` L4813-4891，79 行）

**① 真实职责**：把「所有工作区各自在干什么」摆成一张图上。**注意任务书给出的 L5128（2608 行巨型函数）与实际不符**：`WorkspaceTab` 实测 **L5128-5169 共 42 行**；2,608 行的量级属于 **L2033-6050 区间的白板/看板/弹窗组**（`KanbanBoard` 123 行 + `KanbanView` 201 行 + `WhiteboardGraphView` 227 行 + `DialogHost` 501 行 + `DebugCenter` 208 行 + `AutoContinueHost` 124 行 + `SettingsPage` 735 行 等），**推断**该行数是把「WorkspaceTab 起始行到某处结束」的区间当成了函数本体。

**② 界面元素**：`data-dam-row` 刷新按钮 + 缓存时间（L5154-5156）；`data-dam-graph-toolbar` 缩放滑块（0.55–1.75，L5159）；`WorkspaceGraph` 的 SVG 画布（`data-dam-graph`，L4871）；工作区卡片流 `data-dam-flow` + `data-dam-card`（L5163-5167），每卡可展开（`AnimatedDisclosure`）。

**③ 调用接口**：`API.workspaces`（POST，`force` 控制是否绕过缓存，L5138）。

**④ 状态机**：`data === null` → `Loading`；`busy` 期间按钮禁用；`data.cached` 为真时显示 `generatedAt`（L5156）；无工作区 → `wsNone`（L5168）。**画布交互**：`WorkspaceGraph` 自带 pan（指针拖拽 + `setPointerCapture`，L4824-4842）与缩放（外部滑块传入 `scale`）；`columns = min(2, max(1, workspaces.length))` 两列布局（L4847）。

**⑤ 关系**：与 M1 的折叠块**同一接口同一组件**，但 M1 传 `onSelect: function(){}`（空）而本页传真实回调（L5161）——**同一组件两种能力等级**，新 IA 若只保留一处，必须保留可交互的那处。

**⑥ 三层归属**：**团队层**（跨工作区集合）。

---

### M12 · calendar —日程（`CalendarTab` L5180-5393，214 行）

**① 真实职责**：管理用户级日历，并把「未完成事项」注入上下文。它是**唯一带时间语义的记忆**——其余记忆都是内容导向的。

**② 界面元素**：`data-dam-calendar` 根（L5392）；月网格 `data-dam-calendar-day`（L5259）每格最多显示 3 条 + `+n`（L5269-5284）；事件 `data-dam-calendar-event` 带四象限配色（`QUADRANT_STYLE` L5173-5179）与完成态删除线（L5279）；四象限图例（L5239-5243）；**当天时间轴弹层** `data-dam-calendar-modal`（L5356）含小时槽 `data-dam-calendar-slot`（L5332）与「未定时」段（L5339）；**添加/编辑浮层**（L5366-5388）含标题/时间/象限/地点/提醒/备注；前后一天翻页 + ISO-8601 周序号（L5344-5355）。

**③ 调用接口**：`API.calendar`（GET L5204；POST `action:'done'|'remove'` L5293；POST 新增 L5301）。

**④ 状态机**：`dayView` 与 `draft` 两个互斥弹层态；事件 `done` 与未完成两态（点击事件主体 = 切换完成/删除，**同一按钮两义**：`en.done ? 'remove' : 'done'`，L5293）；`saving` 防重入；`calError` 局部错误显示。

**时间轴的修复史很关键**：旧实现写死 `for (hourSlot = 7; hourSlot <= 22; ...)`，导致 **23:00–06:59 与 `time='--:--'` 的事件在当天视图里永不显示**——而用户真实数据里就有 7 条 23:59 截止的作业（L5309-5313）。现改为**由数据驱动**（先扫真实小时取 min/max，无事件才回落 07:00–22:00），范围外事件单独成「时间轴外」段（L5314-5341）。**这是「静默丢失用户数据」的典型事故，新 IA 必须继承「范围由数据决定」这条判据。**

**⑤ 关系**：日历是**独立的注入分区**（`calendar`，L6653），与其余记忆分开发射。设置页 `store` 分区可选开启「提醒/反思」等（`fReflect` L7321）。

**⑥ 三层归属**：**单人层**（`~/.dsh/memory/CALENDAR.md`，跨项目、跨工作区）。

---

### M13 · connect —外部 AI 工具记忆的接入与撤出（`ConnectTab` L5396-5523，128 行）

**① 真实职责**：把**其他 AI 工具（WorkBuddy / CodeBuddy / Claude Code / Codex / 项目约定文件）**的记忆以**纯链接模式**接进本插件，并可**精确撤出**。它是「继承既有 AI 遗产」的通道。

**② 界面元素**：`TOOL_LABEL` 映射工具名（L5395）；来源卡（L5497）含「查看内容」按钮（L5489）、来源为 sessions 时显示文件数（L5491）、否则显示**导入/删除二态按钮**（L5493-5494，目标为 `user` 或 `project` 两个独立按钮）；展开后显示来源正文、**「已接入位置」**、**「在记忆中查找」**按钮与命中结果（L5503-5508）；底部「全部接入」/「重新扫描」（L5518-5519）。

**③ 调用接口**：`API.external`（GET 列表 L5425）；`API.externalView`（GET 单源内容 L5445）；`API.externalImport`（POST L5432 / 批量链式 L5477）；`API.externalRemove`（POST L5457）；`API.recall`（「在记忆中查找」复用检索，L5465）。

**④ 状态机**：
- **导入/删除二态由服务端回传的 `importedUser` / `importedNotes` 决定**（L5493-5494、L5435、L5459）——**不是本地乐观状态**。
- **删除需要二次点击**：`removeArm` 记录「已武装」的键，第一次点击只把按钮文案变成「确认删除？」并染色（L5493 / L5455-5456），第二次才真正提交。这是全前端唯一的**两段式确认**模式（其余用 `window.confirm`）。
- `importAll` 用 `Promise` 链**串行**执行（L5476-5478），避免并发写同一文件。

**⑤ 关系**：外部记忆是 **8 个注入分区之一**（`external-memory`，L6654），且有**独立预算** `externalInjectionChars`（默认 1400，L7209）；历史会话索引是另一个分区（`external-sessions`，L6655）。设置页 `store` 分区有 `fExclude` **排除来源**（按行填写，L7342-7351）。

**⑥ 三层归属**：**跨层**——接入目标可选 `user`（单人层）或 `project`（项目层），**这是全前端唯一让用户显式选择目标作用域的导入动作**。

---

## 3. 横切机制（任务书点名的 6 项）

### C1 · 水位 / 上下文预算

**计量口径**（写在文案里，是权威定义）：优先用**官方 token-meter**（与聊天框 context ring 同源），不可用时降级启发式估算；窗口优先取**官方路由容量**（`request/context` 的 `contextWindow`），其次按当前模型查 `settings.yaml` 的 `contextWindow`，也可手动覆盖；**触发分母 = 官方声明窗口（provider 自报过硬限时取较小值），预留输出不参与扣减**（L456 / L720）。

**核心常量**：阈值默认 **0.75**——官方自动压缩阈值是 80%，必须留 5% 余量（L1110 原文：「1M 窗口约 50K token」）。

**四个水位相关开关**（全部在设置页 `handoff` 分区）：
| 开关 | 键 | 作用 | 证据 |
|---|---|---|---|
| 水位估计窗口 | `waterLevelWindowTokens` | 0 = 关闭；默认 65536 | L7267 / L437 |
| 水位建议阈值 | `waterLevelThreshold` | 0.1–1.5，默认 0.75 | L7268 / L440 |
| 水位交接建议 | `waterLevelAdvisory` | 越阈时在动态快照注入交接建议（写账本/刷新白板/建议开新窗）；无人值守时静默 | L7269 / L438 |
| 水位自动骨架账本 | `waterLevelAutoHandoff` | 越阈自动写一篇**系统骨架账本**（每会话一次），防止模型忽视建议时交接材料缺失 | L7270 / L439 |

**三条水位派生机制**（同一数据三个消费者）：
1. **注入建议**：越阈 → 动态快照注入交接建议（对应注入分区 `water-advisory`，L6664-6668；文案明说「关掉后：不再提醒收尾写账本/反思 ⇒ 长任务跨窗口续命会变差」）
2. **骨架账本**：越阈自动补一篇（每会话一次）
3. **自动接续**：`autoContinueEnabled !== false && 水位≥阈值 && harness 权威 running==false（轮次边界）`（L6517）

**展示面**：M7 `PlanTab` 的水位卡（L4652-4671），三态：正常 / 未测出窗口（给恢复方法）/ 尚未测量（L4665）。输出格式 `tokens / window token · pct%`（L4661），**百分比如实上报**（旧版 `Math.min(x,1.5)` 截断到 150% 会把「窗口算错」伪装成「刚好超一点」，L4653-4655），进度条宽度仍按 100% 封顶（L4667）。

**出现密度**：「水位」在 `client.js` 中**出现 49 次、分布在 37 行**（`grep` 实测，与任务书的「49 次」一致）。**它没有独立页签**，展示面只有 M7 的一张卡 + 一个浮层确认卡（`AutoContinueHost`）。**新 IA 若把 `plan` 页拆散，必须为水位单独留一个可见位置——否则用户会失去对「上下文快用完了」的唯一感知。**

---

### C2 · 主动唤回 vs 每轮注入 vs 模型主动检索（三来源分流）

这是**产品最核心的架构区分**，但它在老前端里**没有任何一个页签以它为名**。它的可见面分散在四处：

| 来源 | 入口 | 可见面 | 证据 |
|---|---|---|---|
| ① 模型主动检索 | 模型调 `memory_recall` 等工具 | **M10 stats 的 `model` 卡**（事件数/命中/去重/零命中）+ 按层环形图 + 按天走势 | L5108-5114 / L5063-5064 |
| ② 每轮自动注入 | 每轮无条件注入 | **M10 stats 的 `inject` 卡**（条长按**字符数**回答「哪一段最占预算」）+ 设置页 13 个分区开关 | L5115-5123 / L7165-7223 |
| ③ 主动唤回（proactive） | 系统判断该不该唤起 | **M10 stats 的 `shadow` 卡**（质量视角）+ **M3 refine 的逐条裁定** | L5124-5125 / L3455-3580 |

**通路 id 由宿主下发**（`channelIds`，L5061），前端不硬编码——这是为了避免两边漂移。

**注入预算是个二维结构**（这点最容易被新 IA 压扁）：
- **总预算**：`injectBudgetChars`（默认 2400，L7203）
- **分区逐段控制**：`promptSectionToggles` 13 个开关（L7168-7201），成员与顺序**取自宿主下发的 `psecKeys`**（前端不硬编码），其中「硬性要求」段单独标注（`psecMust`，L7195）
- **专项预算**：Tier-0 目录 `tier0MaxTokens`（默认 400，L7206）、外部记忆 `externalInjectionChars`（默认 1400，L7209）、近期日志天数 `recentDaysInjected`（L7208）、白板 `handoffPlanChars`（默认 1200，L7263）、账本 `handoffLedgerChars`（默认 800，L7266）
- **快照节流**：`snapshotMinGapRounds`（默认 5，L7210）、`snapshotReinjectOnCompact`（L7211）
- **分层开关**：`tier0CatalogEnabled`（L7205）、`rulesLayeringMode`（L7207）

**13 个注入分区的完整清单**（`PROMPT_SECTION_TEXT`，L6648-6670）：`rules-section`、`tier0-catalog`、`whiteboard-plan`、`handoff-ledger`、`calendar`、`external-memory`、`external-sessions`、`workspace-map`、`welcome-title`、`welcome-body`、`plan-update-request`、`water-advisory`、`handoff-pointer`。

**⑥ 三层归属**：三来源各自跨层，但**注入分区是三层唯一的统一闸门**——新 IA 若不保留「逐段注入控制」，用户将失去对「哪一层在吃我的预算」的唯一控制手段。

---

### C3 ·「失败与弯路」泳道

**它是六条泳道之一，不是独立页签。** 泳道集合定义在两处（必须一致）：

- `KX_LANE_COLOR`（L2413-2420）：`goal` 蓝 / `state` 绿 / **`deadend` 红**（`--dsw-alias-state-error-primary`）/ `progress` 橙 / `archive` 灰蓝 / `misc` 暗灰
- `LANE_LABEL_ZH`（L3023）：`{goal:目标, state:进行中, deadend:'失败与弯路', progress:'进度与下一步', archive:'版本归档', misc:其它}`
- 固定列序 `ORDER = ['goal','state','deadend','progress','archive','misc']`（L2743）

**为什么按泳道而非文档分列**（L2730-2731 注释原文）：泳道是**有限的 6 类**；若按文档分列会有 1,842 × 23,494 的二维规模 ⇒ 纵向 37 屏，「要横向拖 52 屏」（L2720）。

**tag 的真实写法**：`type:goal` / `type:state` / `type:dead-end` / `type:progress`（注入到每轮提醒的原文，L832）。**注意 `dead-end` 带连字符，而泳道 key 是 `deadend` 不带**——`wbLaneTone()` 同时接受 `dead` 与 `deadend` 两种写法（L2168），这是**兼容层而非笔误**（推断：宿主侧做过一次改名）。新 IA 若重写 tag 解析，必须同时接受两种形态，否则历史账本的「失败与弯路」会全部掉进 `misc`。

**三个消费面**：
1. **面板侧** `KanbanBoard`（L2273-2395）：纵向堆叠默认 + 横向泳道可切 + 缩放/列宽（localStorage 记忆 `dam-kanban-zoom` / `dam-kanban-cols` / `dam-kanban-layout`，L2070-2072）+ 泳道折叠 + 空泳道默认收起（L2376）+ 泳道内搜索 + 「最近更新」聚合视图（L2343-2352）
2. **整页侧** `KanbanView`（L2487-2687）：矩阵视图，行=日期分组、列=小节类型，卡片点开右侧抽屉（`KanbanDrawerBody`，L2216-2220，用 `createPortal` 挂 body，L18-29）
3. **画布侧** `WhiteboardGraphView`（L2867-3093，默认隐藏）：分层布局 —— 列 = 泳道，行 = 时间倒序（L2728）

**判据徽章口径统一**：`kxBadge()`（L2424-2437）定义 `passed/warned/failed/unknown` 四态，注释明说是「抽出来避免两处漂移」（L2423）。

**④ 关键状态机**：泳道卡片有三种判据态（`c.criteria`），卡片可展开看全文（v3.1.2 起改为**按需从 `/kanban-card` 单取并缓存**，载荷不再内联 full —— 原因是 1178 卡 × ≤6000 字符 × lanes+matrix 双份 ≈ 1.7 MB 纯冗余，L2174-2180）。

**⑤ 已知缺陷（必须继承的教训）**：卡片数据来自 Markdown 的 `## ` 小节直通，全链路无摘要/清洗 ⇒ 实测 **868 张卡只有 195 个不同标题**（「目标」重复 109 次），且正文首行常是未剥离的 `<!-- type:goal -->`（L2082-2085）。前端因此加了**清洗层**（`wbStripComment` L2091 / `wbStripPrefix` L2093 / `wbStripMarkup` L2100 / `wbCleanLines` L2110 / `wbShape` L2131）。**这是渲染层职责，磁盘字节保持原样**（L2087-2088）。

---

### C4 · 接续 / 交接账本 / 白板 三者的关系

**三者是一件事情的三个时间尺度**，不是三个功能：

| 机制 | 写入者 | 时间尺度 | 落盘 | 读入方式 |
|---|---|---|---|---|
| **白板 PLAN.md** | **模型**（`memory_note(kind=plan)`） | 项目全貌，低频重写 | 工作区 `handoff/` | 每轮注入快照（受 `handoffPlanChars` 限） |
| **交接账本 handoff-\*.md** | **模型**（`memory_note(kind=handoff)`） | 阶段里程碑，四段式 | 工作区 `handoff/` | 阶段注入（受 `handoffLedgerChars` 限） |
| **接续 continue** | **人/宿主** | 会话切换那一刻 | 新会话 | 作为首条消息预载 |

**为什么必须有账本**（设计判据，写在系统提醒文案里）：收尾时若方向变化/阶段完成，用 `kind=handoff` 写四段式交接账本给「下一个上下文窗口续命」（L832 区块）。

**接续的完整状态机（7 步，全前端最长的一条链）**：`runContinueFlow()`（L4414-4440）
1. **刷新仪式**（`refreshOldSession`，L4317-4344）：先让**旧会话的 Agent** 更新白板 PLAN 与交接账本 —— 通过 `remoteFace.session.prompt({sessionId: 旧会话, mode:'queue'})` 投一条提示（L4335），再 `waitForRefresh()` 轮询等它真的执行完（L4345-4366）
2. **等刷新结束**（`waitForRefresh` 的三个结束条件，任一命中）：材料变了（`planMtime` 或最新账本名变化）→ `'updated'`；旧会话跑完这一轮（`true→false`）→ `'turn-ended'`；超时（默认 90s，可配 `autoContinueRefreshTimeoutSeconds` 15–600s）→ `'timeout'`（L4346-4365）
3. **取交接材料**：`API.handoffContinue`（POST，带 `fromSessionId`，L4426）
4. **建新会话**：`executeContinue()`（L4367-4413）——`continueCreateArgs()`（L4310-4316）**优先 `workspaceId`**，因为官方 `session.create` 只接受 `workspaceId` 或 `cwd` 之一（同传报 bad-request），且**只有 workspaceId 分支会 `workspace.attachSession()`**，只传 cwd 会让新会话永远落「未分组工作区」（L4311-4313）
5. **改标题**：`接续 #n · 工作区名`（L4380-4382）
6. **沿用模型**：`selectModel({provider, model, reasoningEffort})`（L4385-4387）
7. **权限继承**（两段式）：投料前先试一次（命中则首轮就已继承），投料后再试一次（L4390-4411）

**失败可见性纪律**（贯穿整条链）：刷新仪式原先是 fail-soft 且静默，用户看到的现象是「点了接续却什么也没发生」；现改为**跳过/失败/超时都回报一句原因，接续本身照常继续**（L4319-4320）。工作区定位失败时（`wsFallback`）也**不再静默**，明确告知新会话建在哪个工作区及原因（L4428-4435）。

**自动接续（宿主兜底）**：`AutoContinueHost`（L6520-6643）每 3 秒轮询 `API.autoContState`，四态渲染：`armed 倒计时 → 确认卡` / `executing → 执行中` / `lastOk → 成功`（**10 分钟有效期**，L6576-6582）/ `error → 失败`。关键修复：宿主已完成接续后**必须收起确认卡**，否则卡片与「✓ 已自动接续」并存，像是「它还想接续」（L6567-6571）。**执行权在宿主**：同意/拒绝都 POST `API.autoContDecide`，浏览器只传达决定；30–40 秒无操作视为挂机自动接续（L457 / L6606-6625）。

**③ 接口**：`API.handoffState`（L4524/L4549）/ `API.handoffContinue`（L4426）/ `API.handoffPermission`（L4397/L4404）/ `API.autoContState`（L6547/L6564）/ `API.autoContDecide`（L6609/L6624）/ `API.kanbanBoard`（L4527）。

**④ 两个开关必须独立**（用户硬性规则「功能开关必须解耦」的落地）：`handoffEnabled`（白板）与 `autoContinueEnabled`（自动接续）出厂默认均为 **false**（L4470 注释：「功能仍在测试期」），开关卡在**两种状态下都渲染**——它曾只在「未启用」分支被返回，导致白板一旦开启就**再也看不到开关**（开得了、关不掉，L4696-4698）。

---

### C5 · 技能库双库（workspace / global）

**作用域常量**：`scopeView` 由宿主投影（`globalCount` / `workspaceCount` / `workspaceReady` / `globalDirCorrupt` / `workspaceDirCorrupt`，L3870-3877）——**前端不硬编码库路径**。

**逐条归属可见**：`scopeBadge(p)`（L3880-3888）用 `data-dam-scope` 输出 `workspace|global`，并附 `addedBy`（谁加进来的）。

**改判归属**：`scopeButtons(p)`（L3890-3897）用 `data-dam-scope-to` 指相反库；动作 `hubAct` 之外的**独立通路** `hubScopeTransfer()`（L3838-3856）POST `{action:'transfer-scope', procedureId, scope}`。

**为什么必须独立于 hubAct**（L3834-3837 注释原文）：动作名与参数不同（`scope` 而非 `v`），且**必须把 `migrate()` 的逐条结果（含 `rolledBack` / `reason`）显示出来** —— 「两阶段提交的失败是要让人看见的，静默成 done 等于把回滚藏起来」。已在目标库时宿主回 `noop`（幂等），界面显示「（已是该库）」。

**工作区未知时的处理**：按钮**仍然显示但点击会明确报错**（宿主 `migrate` 返回 `ws-unknown`），而不是灰掉按钮——「比灰掉按钮更能说明『为什么不行』」（L3867-3869）。

**三问的答案（这是双库视图的设计目标，L3863-3866 原文）**：①这条技能属于哪个库（逐条徽标）②当前是哪个库、各库几条、工作区库现在能不能写（区块头部）③怎么改判归属（逐条按钮）。

**与设置页的关系**：`skills` 分区管的是**晋升门限**（`procedureMinSessions` L7243 / `procedureMinSuccess` L7244 / `procedureCorrectionCap` L7245 / `procedureHighRiskApproval` L7246 / `procedureInjectEnabled` L7249 / `procedureActiveLevel` L7254），**不管归属**；归属只在 M4。

**⑥ 三层归属**：**单人（global 库）↔ 项目（workspace 库）**，界面即切换器。

---

### C6 · 设置页 9 个分区的真实作用域（`SettingsPage` L6671-7405，735 行）

**导航机制**：`sectionLabels`（L6989-6999）定义 9 个分区的键与标题；`section(key,title,content)` 生成 `id='dam-settings-'+key` + `data-dam-settings-group`（L7000）；`jumpToSection()`（L7001-7004）先设状态再 `scrollIntoView({behavior:'smooth', block:'start'})`。**这套「滚动式导航」曾出过事故**——设置页面板被搬到别的分区后因滚动式导航落在视口外，用户报障「弹不出来」（该事故记录在守卫文件头部注释里，见 `tests/smoke/`）。

| 分区 | 中文标题 | 真实作用域 | 关键键 | 证据 |
|---|---|---|---|---|
| `engine` | 语义记忆总开关 | **本机引擎**（JS/Python 两套可互换引擎 + 记忆锚定索引 + 唤起发射模式） | `associativeMemoryEnabled` `memoryAnchorEnabled` `semanticEngineMode` `activationEmitMode` `jsDecide*` | L7010-7164 |
| `window` | 记忆窗口（注入什么） | **注入面**（13 分区开关 + 总预算 + 分层） | `promptSectionToggles` `injectBudgetChars` `tier0*` `rulesLayeringMode` `recentDaysInjected` `externalInjectionChars` `snapshot*` `promptLayerOverrides` | L7165-7223 |
| `capacity` | 记忆容量与归档 | **文件本体大小**（与注入预算**不是一回事**） | `episodicRetention` `factRetentionMax` `noteCapacityChars` `userCapacityChars` `autoConsolidate*` `memoryFileIndexEnabled` | L7224-7238 |
| `skills` | 自动沉淀成技能 | **技能晋升门限 + 注入总闸** | `memoryHubEnabled` `episodicMinSegments` `procedureMin*` `procedureCorrectionCap` `procedureHighRiskApproval` `procedureInjectEnabled` `procedureActiveLevel` | L7239-7259 |
| `handoff` | 长会话接续 | **白板/账本/水位/接续全套**（原列的「子代理痕迹回收」**已判废停用**） | `handoffEnabled` `autoContinueEnabled` `handoffPlanChars` `criteriaGate` `handoffLedgerChars` `waterLevel*` `subagentGc*` | 行号已漂移（原记 L7260-7275 为旧快照，用前按锚点 grep 复核） |
| `auto` | 自动化与免打扰 | **定时与弹窗**（欢迎向导、暂离、总结、蒸馏排程） | `welcomeTourEnabled` `autoPopupEnabled` `unattendedMode` `awayMinutes` `autoSummaryTimes` `consolidateSchedule*` `maintainSchedule*` | L7276-7301 |
| `store` | 存储与外部记忆 | **落盘位置 + 反思 + 工作区扫描** | `userMemoryDir` `projectMemoryDir` `memoryRoot` `dayBoundaryMinutes` `reflectEnabled` `reflectStyle` `workspaceDiscoverMax` | L7302-7326 |
| `look` | 外观与交互 | **本机偏好**（语言、字号、承载面、强调色、图密度、排除来源、子代理模型） | `locale` `fontScale`(localStorage) `panelPos` `accentTheme` `graphDensity` `injectExcludeSources` `subagentModel` | L7327-7357 |
| `about` | 关于与诊断 | **版本/更新/白板模式/社区 + 调试中心** | `boardMode` `updateCheck` `update` + `DebugCenter` | L7358-7404 |

**配置写入的唯一出口**：`saveConfigPatch(patch, hooks)`（L1537-1552）；`set(key, value)` 改本地 `cfg` 标脏，底部 `data-dam-savebar` 统一提交（L7396-7399）。**注意两处特例**：`boardMode` 走 `saveConfigPatch` + 延迟 `window.location.reload()`（L7368-7374），**字号/强调色/承载面是即时生效的本地偏好**（L7331 / L7334 / L7336-7337）。

**实测过的两个「开关坏了」根因（必须继承）**：
1. **直读配置外壳**：宿主 `GET /config` 恒返回 `{config, path}`，直读 `c.autoContinueEnabled` 恒 `undefined` ⇒ 开关**显示恒为「开」**，且点击算 `!undefined = true` ⇒ **只能关、永远开不起来**（用户原话「我点开关，它并没有真正开关」，L1553-1560）。纪律：任何 `apiGet(API.config)` 的返回值都必须经 `configOf()` 解包。
2. **写盘成功但界面不更新**：patch 里是**配置键**，本地状态用的是短名 ⇒ 按钮读 `autoCfg.enabled`、写 `autoCfg.autoContinueEnabled` ⇒ **按钮永远不回弹**（L4496-4500）。用户明确把这种表现列为「功能坏了」。

---

## 4. 不在 13 页签内、但同样是「机制」的界面（上一轮映射同样没有覆盖）

### X1 · 全屏弹窗族 `DialogHost`（L6011-6511，501 行）

**职责**：承载 6 种互斥弹窗，是**发布者→用户的单向通知通道**与**首启引导**。
**种类**：`welcomeTour`（分步向导，含功能开关与引擎检测/下载引导）/ `update`（changelog，带 Logo 开场动画）/ `notice`（动态通知，urgent 优先）/ `welcomeBack`（暂离回归）/ `summary`（待展示时段总结）/ `semSetup`（语义引擎安装建议）。
**接口**：`API.notices`（L7590）、`API.updateCheck`、`API.semanticDeepDetect`（L7611）。
**状态机**：`openDialog(d)`（L1331）单入口；通知按 `id` 去重写 `localStorage['dsh-auto-memory.seenNotices']`（L6400-6408）；`notice.level === 'urgent'` 决定配色（L6398-6399）。

### X2 · 启动分发与暂离回归 `dispatchStartupDialog`（L7503-7553）+ `autoOpenOnReturn`（L7480-7492）+ `pollTimeState`（L7627-7649）

**职责**：决定「打开页面时弹什么」与「人回来后弹什么」。**关键状态机**（三条互斥分支）：全新安装 → 完整欢迎向导；老用户 `seen < 0.1.30` 或未完成向导 → 补一次向导；否则 `seen !== current` → 弹本版 changelog（**动态取当前版本**，旧版硬编码 `'2.1.0'` 导致老用户升级到 3.0.0 时弹的仍是 2.1.0 的说明卡，L7533-7537）。
**硬门**：三个自动弹出分支都必须过 `allowTour` 配置闸，否则 `welcomeTourEnabled=false` 形同虚设（L7513）；配置未知时（`null`）**一律不自动播放**，等配置到达再分发（L7554）。
**暂离回归**：只有 `away true→false` 才弹；`away` 挂着**绝不强弹** —— 旧版曾在用户关掉后再弹形成 30 秒重开死循环（用户观感「弹窗关不掉」，L7475-7478）。轮询周期 30 秒（L7649）。

### X3 · 承载面与浮层几何（`MemoryPanel` L5686-5798 + `SidebarButton` L3139-3148）

**职责**：**同一份内容两种承载**——左下角浮层（可拖拽/缩放/钉住）与「记忆」并列页。
**元素**：`data-dam-panel` / `data-pos="float"` / `data-scale` / `data-dragging` / `data-closing`（L5760-5769）；`data-dam-resize`（L5790）；`data-dam-pin`（L5779）；`data-dam-panel-host`（两节点共存时，L5797）。
**几何持久化**：`localStorage['dsh-auto-memory.panel.geom']`（L45）+ `PIN_KEY`（L41）。
**可读性兜底**：DSH Desktop 增强模式 / 透明材质下 `--dsw-alias-bg-layer-2` 自身 alpha < 0.65 时，把面板背景提升到 0.96 并加 `data-solid`（L5709-5736）——**普通模式不触发，液态玻璃观感零变化**。
**关闭方式**：面板外点击（排除 `[data-dam-panel]` 与 `[data-dam-sidebar-btn]`）+ Esc（L7421-7440），钉住时禁用外点关闭（L7424）。

### X4 · 调试中心 `DebugCenter`（L5801-6008，208 行）

**职责**：为提 issue 提供诊断。**两条探针**：`refresh()` 并发打 11 个接口记录 `status/ms`（L5834-5846）；`runScan()` 调 `API.scanDirty` 做静态缺陷扫描（L5821-5829）。入口在设置页 `about` 分区的折叠按钮（L7401-7403）。

### X5 · 白板看板整页 `KanbanView`（L2487-2687）与白板画布 `WhiteboardGraphView`（L2867-3093，默认隐藏）

见 C3。二者与面板侧 `KanbanBoard` 是**同一份数据的三种形态**（同一 `API.kanbanBoard` 同时回 `lanes` 与 `matrix`，L2406）。

---

## 5. 机制 → 建议归属（今天 / 项目 / 团队 / 检索 / 设置）总表

标注规则：**★ = 上一轮「13 页签 → 4 个一级入口」映射漏掉的机制**；「归属」列为按**数据落盘作用域**推导的建议，非按页签位置。

| # | 机制 | 载体（页签/组件） | 证据行 | 建议归属 | 上一轮是否覆盖 |
|---|---|---|---|---|---|
| M1 | 今日工作台 + 一键反思 + 跨工作区折叠 | `overview` | L3357-3451 | **今天** | ✅ |
| M2 | 硬性约束条目级增删改 + 用户级 MEMORY.md 只读 + 日志翻查 | `logs` | L3582-3638 / L3702-3795 | **今天**（规则）+ **项目**（日志） | ✅（但规则编辑面未提及） |
| **M3** | **阴影候选人工反馈（A/P/S/H/E 五态裁定）** | **`refine`** | **L3455-3580** | **今天 + 项目**（裁定队列） | **★ 漏** |
| M4 | 三层记忆中枢（技能/事实/经历）+ **技能审批三态门** + **双库归属转移** | `hub` | L3798-4019 | **团队** | **★ 部分漏**（审批动作与归属转移未覆盖） |
| M5 | 语料健康 + stale 自愈 + 三联动删除 + **迁移搬包三步向导** | `storage` | L4024-4257 | **项目**（搬迁跨项目） | **★ 漏**（尤其搬迁向导） |
| M6 | 项目笔记追加写入 | `notes` | L4259-4296 | **项目** | ✅ |
| M7 | 白板 + 交接账本 + 水位 + 一键接续 + 看板 | `plan` | L4442-4700 | **项目** | ✅（水位/接续仅部分） |
| M8 | 每日反思生成与阅读 | `reflections` | L4702-4757 | **项目** | ✅ |
| **M9** | **检索预览（含「已撤回」结论层标记渲染）** | `search` | L4759-4807 | **检索** | ✅（**标记渲染未提**） |
| M10 | 三来源召回统计（模型/注入/主动唤起） | `stats` | L5013-5126 | **检索 + 设置** | ✅（三来源未被点明） |
| M11 | 跨工作区总结 + **可交互关系图** | `workspaces` | L5128-5169 / L4813-4891 | **团队** | **★ 部分漏**（关系图交互未提） |
| **M12** | **日程 / 四象限 / 时间轴（数据驱动范围）** | `calendar` | L5180-5393 | **今天**（单人层） | **★ 漏** |
| **M13** | **外部 AI 工具记忆接入 / 撤出（两段式确认）** | `connect` | L5396-5523 | **团队**（可选 user/project 目标） | **★ 漏** |
| C1 | 水位 / 上下文预算（4 开关 + 3 派生机制） | 横切（`plan` 展示） | L456-457 / L4652-4671 / L6517 | **设置** | ✅ |
| C2 | 三来源分流 + **13 个注入分区开关** | 横切（`stats` + 设置 `window`） | L5063-5066 / L6648-6670 / L7165-7223 | **设置** | **★ 部分漏**（分区逐段控制未覆盖） |
| C3 | 「失败与弯路」六泳道 | 横切（`plan` 看板/整页/画布） | L2413-2420 / L3023 / L2743 | **项目** | ✅ |
| C4 | 接续 / 交接账本 / 白板三者关系 + 7 步接续状态机 | 横切（`plan`） | L4317-4440 / L6520-6643 | **项目**（接续跨会话） | ✅（刷新仪式与权限继承未提） |
| C5 | 技能库双库（workspace/global） | 横切（`hub`） | L3870-3897 / L3838-3856 | **团队** | **★ 部分漏** |
| C6 | 设置页 9 分区作用域 | `settings.section` | L6989-6999 / L7010-7404 | **设置** | ✅（分区作用域未逐条核实） |
| **X1** | **全屏弹窗族（向导/changelog/通知/回归/总结/引擎建议）** | `DialogHost` | L6011-6511 | **今天** | **★ 漏** |
| **X2** | **启动分发 + 暂离回归自动弹窗** | `dispatchStartupDialog` 等 | L7480-7553 / L7589-7649 | **设置**（自动化分区） | **★ 漏** |
| **X3** | **承载面切换 + 浮层几何/钉住/可读性兜底** | `MemoryPanel` | L5686-5798 | **设置**（外观分区） | **★ 漏** |
| **X4** | **调试中心（接口探针 + 静态扫描）** | `DebugCenter` | L5801-6008 | **设置**（关于与诊断） | **★ 漏** |
| **X5** | **整页看板矩阵 + 抽屉全文 + 白板画布（默认隐藏）** | `KanbanView` / `WhiteboardGraphView` | L2487-2687 / L2867-3093 | **项目** | **★ 漏**（画布默认隐藏这一事实） |

---

## 6. 上一轮「13 页签 → 4 个一级入口」映射漏掉的机制（**逐条列出**）

判定方法：对上一轮产物 `docs/ui-demo/index.html`（142,727 B / 2,431 行 / mtime 2026-09-23 21:06）做**关键词双向 grep**，与本文机制清单逐一比对。命中数为 0 即判为「未承载」。

### 6.1 漏掉的机制（高优先级）

| 机制 | demo 关键词命中 | 后果 |
|---|---|---|
| **M3 refine 阴影候选人工反馈** | `shadowRecent` 0、`reviewFeedback` 0、`该激活` 0、`只预取` 0、`应抑制` 0、`有害` 0、`改目标` 0、`唤起记录` 0、`语料精修` 0、`主动观测` 0、`明确召回` 0、`未投递` 0、`判定队列` 0 | **主动唤起的质量控制闭环整条消失**：用户再也无法对「系统认为该唤起」的判定给出裁定，策略演进失去人工样本 |
| **M4 技能审批三态门 + 双库归属转移** | `审批队列` 0、`弃用` 0、`全局库` 0、`工作区库` 0、`技能审批` 0、`事实层` 0、`经历层` 0（`记忆中枢` 0） | 「为什么不能晋升」与「强制晋升」的**分级门**消失；`hubScopeTransfer` 的**两阶段回滚可见性**消失 |
| **M5 存储管理（健康/stale/三联动删除/迁移搬包）** | `存储管理` 0、`语料健康` 0、`stale` 0、`迁移搬包` 0、`导入` 0、`三联动` 0 | 语料损坏**无法自愈**、记忆**无法物理删除**、工作区记忆**无法搬迁** |
| **M12 日历** | `日历` 2（仅提及）、`四象限` 0 | 唯一的**时间语义记忆**与「未完成事项注入」失去入口 |
| **M13 外部 AI 工具记忆接入** | `外部记忆` 0、`接入` 0（`导入` 0、`三联动` 0） | 「继承其他 AI 工具遗产」的通道消失；`external-memory` 注入分区变成只写不读 |
| **X1/X2 弹窗族与启动分发** | `调试中心` 0（`今日问候` 0） | 首启引导、changelog 送达、urgent 通知、暂离回归全部无承载 |
| **X5 白板画布（默认隐藏）** | `画布` 0、`矩阵` 0、`关系图` 0 | 已实现但默认关闭的机制若无占位，未来开启时无入口可挂 |

### 6.2 覆盖但被压扁的机制（中优先级）

| 机制 | demo 实测 | 风险 |
|---|---|---|
| C2 三来源分流 | `模型主动检索` 0、`每轮自动注入` 0、`三来源` 0；`统计` 仅 1 | 三条召回通路的**区分语义**丢失，退化成一张普通统计图 |
| M9 结论层标记 | ——（`已撤回` / `superseded` 未在 demo 出现） | 检索结果里**「这条结论已作废」的可见性**丢失，用户会把废结论当有效结论读 |
| M11 关系图交互 | `关系图` 0；`工作区` 15（仅文本） | 可 pan/缩放的 `WorkspaceGraph` 退化为静态文字 |
| C5 双库 | `双库` 8、`归属` 2 —— *部分覆盖*，但 `全局库`/`工作区库` 0 | 归属**改判动作**与**幂等 noop 提示**可能丢失 |
| C1 水位 | `水位` 8 —— *已覆盖* | 但需确认是否保留「未测出窗口时仍显示说明」的三态（L4649-4652） |

### 6.3 已正确覆盖的（供对照）

`账本` 23、`日志` 15、`笔记` 9、`反思` 4、`接续` 9、`泳道` 9、`失败与弯路` 10、`技能库` 9、`白板` 7、`看板` 8、`设置` 19、`分区` 9、`工作区` 15、`检索` 26、`概览` 1。

---

## 7. 「新 IA 会丢失现有能力」的风险点（给 Lead 的决策输入）

**R1 · 把 `refine` 归错层会二次失守**（最高优先级）
`refine` 的落盘是 **append-only `review-queue.jsonl`**，且注释明写「**不直接改任何策略/参数**」（L3453-3454）。若新 IA 把它放进「项目」层，用户会以为裁定按项目隔离 —— 与真实行为不符，且下一个审计者会再次把它当「排版问题」删掉。**建议：在「今天」层保留入口，标题必须含「唤起回顾」四字（这是它在老前端的真实标签，L237），并在页内注明裁定进的是全局队列。**

**R2 · `deadend` 与 `dead-end` 两种 tag 写法必须同时兼容**
`wbLaneTone()` 同时接受 `dead` / `deadend`（L2168），而注入提醒里写的是 `type:dead-end`（L832）。新 IA 若只按一种写法解析，**历史账本的全部「失败与弯路」会掉进 `misc`**——这是静默的内容降级，不会报错。

**R3 · 三条「静默丢失」的历史事故判据必须继承**
1. **日历时间轴范围必须由数据决定**（写死 07:00–22:00 会让 23:59 截止的作业在当天视图永不显示，L5309-5313）
2. **看板/画布的工作区解析失败要如实说原因**，不能显示空内容（L7692-7701）
3. **接续的工作区回退必须告知**（`wsFallback`，L4428-4435）

**R4 · 「开关即时回显」是用户硬性偏好，涉及两处已知根因**
配置外壳必须经 `configOf()` 解包（L1553-1562）；patch 键名与本地状态键名必须翻译（L4496-4505）。新 IA 重写配置层时，**这两条若不照搬会立刻复现「开关坏了」**。

**R5 · 13 个注入分区开关是「成本可见性」的唯一闸门**
`promptSectionToggles`（L7168-7201）的成员由宿主 `psecKeys` 下发，前端只提供文案。新 IA 若砍掉逐段控制，用户将无法回答「哪一层在吃我的预算」——而这正是 `stats` 的 `inject` 卡（按字符数排序，L5117-5122）要回答的同一问题的另一半。

**R6 · 「水位」没有独立页签，只有 `plan` 页的一张卡**
一旦 `plan` 被拆散，**必须为水位单独立位**；同时保留它未测出窗口时的三态说明（L4649-4671），否则用户会遇到第二次「目录里不显示水位」。

**R7 · 浮层与并列页共享 `panelTab` 是刻意设计**
`MemoryTabBody` / `MEMORY_TABS` 各只有一处事实（L5606-5623），两项计数锁（`eq(tabsReuse,2)` / `eq(bodyReuse,2)`）在 smoke 中固化。新 IA 若为两种承载面各写一份内容，**必然漂移**——这是老前端用注释明写的教训（L5601-5605）。

**R8 · 默认隐藏的 `WhiteboardGraphView` 不是死代码**
`WBG_ENABLED` 只认 `localStorage['dam-wbg-enabled']==='1'`（L7702-7704），代码完整（227 行清洗层 + 分列布局 + 平移缩放 + 侧栏）。新 IA 若无占位，**开启路径会被遗忘**。

**R9 · 两段式确认/导入的交互语义**
`connect` 的删除是「第一次点击只武装、第二次才提交」（`removeArm`，L5455-5456），`storage` 的删除是 `window.confirm` 二次确认（规则删除，L3768）。二者**同为防误删但形态不同**，新 IA 统一时必须保留「有确认」这一不变量。

**R10 · 白板开关卡必须在「开」与「关」两种状态下都渲染**
它曾只在未启用分支返回，导致「开得了、关不掉」（L4696-4698）。新 IA 若把开关放进「设置」而页内不保留入口，会重现同一类死锁。

---

## 8. 复核指引（给 Lead 的独立复核清单）

按本文任一结论复核时，建议用以下命令核对（**只读**）：

```powershell
# 1) 13 页签的真实清单与分派
Select-String -Path lib\client.js -Pattern "function MEMORY_TABS|function MemoryTabBody" -Context 0,18

# 2) refine 的三处证据
Select-String -Path lib\client.js -Pattern "API.shadowRecent|API.reviewFeedback|refineTab:|refineSub:"

# 3) 泳道六类与两种 tag 写法
Select-String -Path lib\client.js -Pattern "KX_LANE_COLOR|LANE_LABEL_ZH|wbLaneTone|dead-end"

# 4) 13 个注入分区
Select-String -Path lib\client.js -Pattern "PROMPT_SECTION_TEXT" -Context 0,24

# 5) 设置页 9 分区
Select-String -Path lib\client.js -Pattern "var sectionLabels" -Context 0,12
```

**行号会漂移**：本报告所有行号基于 `lib/client.js` **689,407 B / mtime 2026-09-23 20:11:12**。若文件已变更，请按上文给出的**内容锚点**（函数名、常量名、注释原文）定位，不要按行号硬改——此为本仓既有纪律。

---

*报告完。全文所有结论均附 `lib/client.js:行号`；无代码证据的判断已逐处标注「推断」。本轮零代码改动。*

