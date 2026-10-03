# 新用户引导（Onboarding）审计报告

- **日期**：2026-09-22
- **性质**：**只读审计**（未修改任何文件；取证脚本全部落在 `%TEMP%\dsh-onb-audit\`）
- **基线**：`lib/index.js` = 12,563 行 / `lib/client.js` = 7,449 行 / `package.json` version = **3.1.1**
- **方法**：源码为准 + `/config` GET 实测旁证（loopback）
  - `extract-config.cjs`：括号匹配抽 `DEFAULT_CONFIG` 字面量后包 `new Function` 求值 → 键全集与默认值真值
  - `toggle-keys.cjs`：逐键在 `lib/*.js`（排除 `*.bak-*`）列真实引用点
  - 实测 `/config` GET（对照用，宿主是否重启不影响结论）

### 取证环境说明（并发写入）

审计期间 **`lib/index.js` 被外部改动过**（mtime 由 `18:36:00` 变为 `18:50:36`），本报告不修改任何源码。为排除「报告数字已失效」的风险，**§0 的 8 项默认值与 §3 的 `injectEnabled` 零读取点结论已在改动后的磁盘状态上逐条复验**（复验脚本见 §6），结果**全部不变**：

| 复验项 | 结果 |
|---|---|
| `lib/index.js` 行数 | 12,563（报告基线一致） |
| `DEFAULT_CONFIG` 起始行 | 320 |
| `injectEnabled` / `reasoningObserverEnabled` / `handoffEnabled` / `autoContinueEnabled` / `boardMode` / `injectBudgetChars` / `tier0MaxTokens` / `hubMechanicalProcedureFeedEnabled` 八项 | 行号与值**全部命中**（334 / 612 / 426 / 472 / 326 / 350 / 357 / 637） |
| `injectEnabled` 后端读取点 | **仍为 0**（全 `lib/` 仅 `client.js:5868`、`client.js:6921`、`index.js:334` 三处，均非读取） |

**行号基准**：`lib/index.js`（12,563 行，12,563 行为磁盘当前态）、`lib/client.js`（7,449 行，mtime `18:38:10`，审计期间未变）。


---

## §0 基线校正（与任务书不符处）

| 任务书口径 | 实测 | 证据 |
|---|---|---|
| `DEFAULT_CONFIG` **101** 键 | **102** 键 | `extract-config.cjs` 求值 `lib/index.js:320-672`；实测 `/config` 应答体 `config` 对象也是 **102** 个属性 |
| 宿主约 12,500 行 | **12,563** 行 | 文件总行数 |
| `dsh-auto-memory` 12 个页签 | 一致（概览/日志/唤起回顾/记忆中枢/存储管理/笔记/白板/反思/接续/日历/检索/工作区） | `lib/client.js:237` |

**默认值核对结论（8 项全部与任务书一致，无一过时）**：

| 键 | 实测值 | 来源 |
|---|---|---|
| `handoffEnabled` | `true` | `lib/index.js:426` |
| `autoContinueEnabled` | `false` | `lib/index.js:472` |
| `boardMode` | `'graph'` | `lib/index.js:326` |
| `injectBudgetChars` | `8000` | `lib/index.js:350` |
| `noteCapacityChars` / `userCapacityChars` | `24000` | `lib/index.js:395-396` |
| `tier0MaxTokens` | `400` | `lib/index.js:357` |
| `hubMechanicalProcedureFeedEnabled` | `false` | `lib/index.js:637` |

---

## §1 引导面清单

引导面共 **8 类、约 40 处文案**。判定列：**正常** / **过时**（文案与代码真值不符或指向不存在的位置）/ **误导**（能走通但指向错误目标）。

### 1.1 首启欢迎向导（主引导面，`welcomeTour`）

- **入口**：`lib/client.js:5853` `TOUR_STEPS`（**9 步**：欢迎 / 核心能力 / 记忆快照 / 日常体验 / 反思总结 / 外部记忆 / 检索引擎 / 唤起与固化 / 完成）
- **渲染**：`lib/client.js:6025-6110`；状态与配置读取 `lib/client.js:5745-5808`
- **触发分发**：`lib/client.js:7218-7279` `dispatchStartupDialog()`（新装 / 老用户补放 / 大版本重放三条支路）
- **开关**：`welcomeTourEnabled`（`lib/index.js:525`，默认 `true`）；设置页位置 `lib/client.js:6995-7005`（分区「自动化与免打扰」）
- **用户动作闩**：`localStorage['dsh-auto-memory-pre.tourDismissed']`（`lib/client.js:1224/1230`）

### 1.2 向导内嵌的「当场可开」开关（`TOUR_STEPS[].toggles`）

共 **11 个**开关，分布在 5 个步骤内 —— 见 §3 健康度表。

### 1.3 向导内嵌的外部来源扫描步

- `lib/client.js:6059-6068`，数据源 `API.external`（`lib/client.js:5782-5785`）
- 组开关辅助路径 `EXT_SOURCE_KEYS`：`lib/client.js:5942`

### 1.4 语义引擎安装向导 / 检测面板

- `PySetupWizard()` 定义 `lib/client.js:3092`；挂载 `lib/client.js:6794`（`guide === 'python'`）
- 检测面板 `data-dam-detect-panel`：`lib/client.js:6756-6793`
- 引擎步内下载区：`lib/client.js:6069-6083`
- 未就绪自动弹引导卡 `semSetup`：`lib/client.js:6159-6169`、自动弹出点 `lib/client.js:6688 / 7334`
- 安装向导入口按钮（常驻）：`lib/client.js:6753`

### 1.5 启动期的其它引导/通知弹窗

`update`（更新说明）/ `notice`（通知中心）/ `welcomeBack`（暂离欢迎）/ `summary`（时段总结）—— `lib/client.js:1183-1200` 优先级表；`update` 渲染 `lib/client.js:5846-5848`；`notice` `:6112-6138`；`welcomeBack` `:6139-6146`；`summary` `:6147-6158`

### 1.6 白板首建骨架（宿主侧「引导」）

- `ensurePlanBoardPre()` `lib/index.js:2494`；骨架正文 `skeletonPlanTextPre()` `lib/index.js:2510`；契约说明 `lib/index.js:2475-2493`

### 1.7 各页签空态文案（`lib/client.js:208-430` 中文 / `:463-660` 英文）

| 文案键 | 行 | 判定 |
|---|---|---|
| `planEmpty`（白板尚未建立 … 宿主会自动落骨架） | `:237` | **正常**（与 `lib/index.js:2475-2535` 自动首建一致） |
| `planWsUnbound`（未绑定工作区） | `:237` | **正常** |
| `planDisabled`（交接白板未启用(设置 → **自动化**)） | `:237` | **过时**（见 §2 O-9） |
| `hubSkillsEmpty` / `hubFactsEmpty` / `hubEpisodicEmpty` | `:238` | 正常 |
| `refineEmpty`（暂无唤起记录——需要 shadow 观测产生数据） | `:270` | 正常 |
| `statsEmpty` / `statsNoInject`（宿主重启后开始累积） | `:221/:233` | 正常 |
| `noReflection`（还没有反思。每天第一次会话时…） | `:363` | 正常 |
| `rulesEmpty` / `autoSettledNone` / `dbgLogsNone` / `kvPyOff` / `notYet` | `:294-348` | 正常 |
| 看板空态（graph 已启用但索引无条目） | `:2115-2116` | 正常 |
| 画布空态（画布暂无内容） | `:2782-2783` | 正常 |
| 锚定索引未就绪（指向 设置 → 自动记忆引擎） | `:3905 / :3921` | **过时**（同上，设置分区实名见 §2 O-16） |

### 1.8 设置页内的引导/说明文字

- 分区标题表 `sectionLabels`：`lib/client.js:6708-6718`（`engine`=「语义记忆总开关」/ `window`=「记忆窗口（注入什么）」/ `capacity` / `skills`=「自动沉淀成技能」/ `handoff`=「长会话接续」/ `auto`=「自动化与免打扰」/ `store` / `look` / `about`）
- 引导卡与「⟳ 检测」旁白：`lib/client.js:6876-6879`

---

## §2 过时项逐条

### O-1【过时】向导「默认关」陈述与代码真值相反（2 处）

- **原文 A**（`lib/client.js:5896`，向导「检索引擎」步）：
  > `思维链监听` / sub：`监听模型思维链分段作为检索信号（默认关；内容比可见输出更敏感，按需开）`
- **原文 B**（`lib/client.js:5876`，向导「日常体验」步，`def: false` 显式标注）：
  > `夜间/批量自动托管` / sub：`…（def: false 驱动 UI 初值）`
- **应为**：`reasoningObserverEnabled` 出厂默认是 **`true`**（`lib/index.js:612`，注释明写「2026-08-26 裁定默认开：监听目标是模型思维链，闭源概括式 CoT 同样纳入」）；故 `sub` 里的「默认关」是**错的反向陈述**。
- **证据链**：
  - `lib/index.js:612` `reasoningObserverEnabled: true,`
  - `lib/index.js:1899` `if (!this.config.reasoningObserverEnabled || chunk.type !== 'reasoning-delta') {` ← 宿主真读
  - 实测 `/config` → `reasoningObserverEnabled` 不在应答体键集内（该键经 `/config` 白名单下发 `true`）
- **影响**：向导把「默认开」写成「默认关」，用户在向导里看到「默认关」但真实状态是开 ⇒ 若用户本意是关，会以为已经关了（**隐私语义的误报**，该开关文案自称「内容比可见输出更敏感」）。
- **补充（不构成缺陷）**：`def: false` 只用于 UI 初值兜底（`lib/client.js:5949` `return c[tg.key] === undefined ? tg.def !== false : !!c[tg.key]`），配置加载后真实值来自 `/config` 应答体，故**回显正确、仅文案错误**。

### O-2【过时】向导「技能固化与晋升（记忆中枢页审批）」把用户指向一个空页面

- **原文**（`lib/client.js:5907`）：
  > `技能固化与注入` / sub：`重复流程固化为 checklist 自动附上；跨会话验证后晋升（「记忆中枢」页审批）`
- **问题 A（措辞已自我修正但结论仍不准）**：`procedureInjectEnabled` 的**两个消费者**都只做「注入 / 唤起」，与「晋升」无关 —— `lib/context-host-pre.js:547`（`skillEnabled = memoryHubEnabled && resolveProcedureInjectEnabledPre(...)`，决定**是否注入上下文**）与 `lib/activation-host-pre.js:335`（`if (!resolveProcedureInjectEnabledPre(engine.config)) return null`，决定**主动唤起这条臂**）。真正的晋升由 store 门限 + 路由动作决定（`lib/procedure-switch-pre.js:5-19` 逐条取证）。文案把「固化与注入」与「晋升」混写在同一开关下，等于把两件事耦合成一件。
- **问题 B（「记忆中枢」页审批不在「记忆中枢」）**：审批队列渲染在**唤起回顾**页签 —— 定义 `lib/client.js:3675`（`技能审批队列` Card），所属渲染函数见 `lib/client.js:3636` 注释「M9 审批动作…走 `/memory-hub` POST」。而「记忆中枢」页签（`hubTab`，`lib/client.js:237`）只渲染三层记忆概览（`hubSkillsEmpty` / `hubFactsEmpty` / `hubEpisodicEmpty`，`lib/client.js:238`）。
- **应为**：`…跨会话验证后晋升（「唤起回顾」页审批）`
- **证据链**：`lib/client.js:3675`（审批 UI 落点）、`lib/client.js:3636`（动作路由）、`lib/procedure-switch-pre.js:5-9`（两个消费者语义）、`lib/index.js:11692/11699`（`action:'promote'` / `'force-promote'` 路由）
- **影响**：用户被指向一个**看不到审批队列**的页签 ⇒ 「找不到、以为没做出来」。

### O-3【过时】向导「外部记忆」步只覆盖 8 个来源，漏 5 个

- **原文**（`lib/client.js:5942` 的 `EXT_SOURCE_KEYS`）：
  > `['workbuddy-user','workbuddy-profile','codebuddy-memory','claude-global','project-conventions','workbuddy-sessions','claude-sessions','codex-sessions']` ← **8 项**
- **应为**：`DEFAULT_CONFIG.externalSources` 有 **13** 项（`lib/index.js:539-554`），漏掉 `'zcode-memory'` / `'zcode-sessions'` / `'kimi-global'` / `'kimi-sessions'` / `'trae-rules'`（2026-09-08 新增，注释明写「自动扫描，目录存在即出源」）。
- **证据链**：`lib/index.js:548-553` 5 个新键；`lib/client.js:5947/5957` 是 `EXT_SOURCE_KEYS` 的**唯一**两个消费者（`groupAll` 分组开关的读 / 写）
- **实际影响**：**当前为零**（`groupAll` 型开关在 `TOUR_STEPS` 中无处引用 —— 全 `client.js` 只在 `:5947/:5957` 出现，没有步骤带 `groupAll: true`）。属**死代码 + 潜在缺口**：一旦有人补一个 `groupAll` 步骤，就会一次性把 5 个源的设置漏掉。
- **判定**：过时（潜在），非当前可见故障。

### O-4【过时】向导「完成」步的「面板页签」清单不完整

- **原文**（`lib/client.js:6096`）：
  > `· ` **`面板页签`** ` —— 唤起回顾（决策打分）/ 存储管理（扫描修复）`
- **应为**：实际有 **12 个**页签（`lib/client.js:237`）：概览 / 日志 / 唤起回顾 / 记忆中枢 / 存储管理 / 笔记 / 白板 / 反思 / 接续 / 日历 / 检索 / 工作区。
- **判定**：**轻度过时**（用「唤起回顾 / 存储管理」举例本身可接受，但作为「随时改主意去哪里」的收尾指引，遗漏了向导自身提到的多个落点）。不单独列为必改项。

### O-5【过时】「Python 引擎 ≈563MB」与代码常量不符

- **原文**（`lib/client.js:5893/5894`、`:6083`）：
  > `进阶 Python 引擎（BGE-M3，约 563MB）` / `BGE-M3 int8 · 563MB · …`
- **应为**：`MODEL_SPEC.bytes = 568456694` = **568,456,694 B ≈ 542.1 MiB / 568.5 MB**（`lib/python-setup-pre.js:36`）。同一模块文件头注释自己写的是 `~539MB`（`lib/python-setup-pre.js:8`）——**三处口径互不相同**（563 / 539 / 568.5）。
- **证据链**：`lib/python-setup-pre.js:36`（唯一真源常量）、`lib/python-setup-pre.js:8`（文件头注释）、`lib/client.js:5893/6083`（向导文案）
- **判定**：过时。按 MiB 计应为 **约 542MB**；按 MB 计 **约 568MB**。向导的 563 两头不靠。

### O-6【过时】内置 JS 引擎「~129MB」与清单真值不符

- **原文**（`lib/client.js:6072` `'C2 · 129MB'`、`lib/client.js:6080` `'e5-small · ~129MB · 默认,正在为你安装'`）
- **应为**：`E5_SMALL_Q8_FILES_PRE_V1` 五项字节求和 = **135,391,183 B ≈ 129.1 MiB / 135.4 MB**（`lib/semantic-js-pre.js:435-441`）。
- **判定**：**按 MiB 计正确**（129.1 MiB）。但同时刻同屏另一处写「约 130MB」（`lib/client.js:5893`，MB 口径）⇒ **同一屏内 MiB/MB 两套口径混用**。属轻度过时（量纲不统一），建议统一为 `~135 MB (129 MiB)` 或统一 MiB。

### O-7【过时】向导自动下载「正在为你安装」把默认行为说死了

- **原文**（`lib/client.js:6080`）：`default, installing for you` / `默认,正在为你安装`
- **实际**：自动下载**有前置条件**——`lib/client.js:5800-5808` 的 `useEffect`：仅当 `curStep.dl` 为真、且 `!wizSt.ready && wizSt.loaded !== false`、且 `dl.phase` 不在 `downloading/verifying/done/error` 时才 `apiPost(semanticDownload)`。**已就绪用户、检测未完成用户、已出错用户都不会自动下载**。
- **判定**：轻度过时（文案未反映条件分支）。

### O-8【过时】`secSemantic` 文案「自动记忆引擎」已无任何消费方（孤儿文案）

- **原文**（`lib/client.js:243` 中文 / `:485` 英文）：`secSemantic: '自动记忆引擎'`
- **实测**：全 `client.js` 仅这两处定义，**零处 `t('secSemantic')` 引用**；设置页分区标题改走 `sectionLabels`（`lib/client.js:6708-6718`），engine 分区实际显示为「**语义记忆总开关**」。
- **证据链**：`grep secSemantic` 在 `client.js` 仅命中 `:243` / `:485` 两行定义；`sectionLabels.engine = '语义记忆总开关'`（`lib/client.js:6709`）
- **判定**：**孤儿文案**（死 i18n 键）。不产生可见故障，但属「引导/说明文本与 UI 真值脱节」的同类风险面。

### O-9【过时】白板空态把用户指向「设置 → 自动化」，而 `handoffEnabled` 在「长会话接续」

- **原文**（`lib/client.js:237`）：`planDisabled: '交接白板未启用(设置 → 自动化)。'`
- **实际位置**：`handoffEnabled` 控件在 **`section('handoff', …)`** 内 —— `lib/client.js:6976`，分区标题 `sectionLabels.handoff = '长会话接续'`（`:6713`）。「自动化与免打扰」（`sectionLabels.auto`，`:6714`）里放的是欢迎向导 / 暂离问候 / 无人值守 / 定时总结 / 定时固化（`:6991-7016`），**没有**交接白板开关。
- **证据链**：`lib/client.js:6713`（标题）、`:6976`（控件所在分区）、`:4338`（`planDisabled` 的渲染路径）、`:237`（文案）
- **影响**：用户照文案去「自动化」分区找，**找不到**该开关。
- **判定**：过时（指向错误）。

### O-10【过时】锚定索引提示指向「设置 → 自动记忆引擎」，该分区名已不存在

- **原文**（`lib/client.js:3905` / `:3921`）：
  > `记忆锚定索引未启用:请在 设置 → 自动记忆引擎 开启「记忆锚定索引」后重试`
- **应为**：「设置 → **语义记忆总开关**」（`lib/client.js:6709`）。「自动记忆引擎」这个名字现在只作为孤儿 i18n 键 `secSemantic` 存在（见 O-8），UI 上不再出现。
- **证据链**：`lib/client.js:6709`（真实标题）、`:6731`（`fAnchorIndex` 控件所在 engine 分区）、`:243`（旧名残留）
- **判定**：过时（指向不存在的位置）。**与 O-9 同类**，两处共用一个根因：设置页分区改名后未回改引路文案。

### O-11【过时】`injectEnabled`（向导「周期记忆快照」）文案描述的机制与真实生效门不一致

- **原文**（`lib/client.js:5868`）：
  > `周期记忆快照` / sub：`上面②的开关——定期/压缩后重注入记忆提示（推荐开）`
- **实际**：`injectEnabled` 是**死开关**（详见 §3 K-1）。真实控制「定期重注入」的是 `snapshotMinGapRounds`（`lib/index.js:514`，实测注入循环 `lib/index.js:10737/10744/10753/10774`）与 `snapshotReinjectOnCompact`（`:515`，读点 `lib/index.js:10781`）。
- **判定**：**过时 + 误导**（用户以为关掉就不再注入，实际毫无变化）。

### O-12【过时】向导外部来源步的「只存路径指针，不复制内容」与 `externalImport` 能力并存时语义收窄

- **原文**（`lib/client.js:5888`）：`已扫描本机可读的外部来源——勾选你想让插件读取的（只存路径指针，不复制内容）`
- **实际**：该步的勾选确实只写 `externalSources` 布尔（`lib/client.js:5978` `saveConfigPatch({ externalSources: cur })`），文案对**本步**是准确的；但插件另有一整套**接入（import）**能力 —— `API.externalImport`（`lib/client.js:1333`）、接入位置与「尚未接入」状态渲染（`lib/client.js:5235`）。
- **判定**：**不算过时**（本步语义自洽），此处仅登记为「同一概念两套词汇（扫描勾选 / 接入）」的**术语漂移**，供 §5 建议档参考。**列出以保持清单完整，不做必改。**

### O-13【过时】向导「欢迎」步承诺「接下来把所有功能向你解释清楚」

- **原文**（`lib/client.js:5856-5857`）：`接下来把所有功能向你解释清楚——每个功能都有开关，当场决定开不开`
- **实际**：向导 9 步只覆盖 **11 个开关**；而 `DEFAULT_CONFIG` 有 **102 键**，其中设置页可达约 60 个。且向导**完全未提及**：白板/交接账本（`handoffEnabled` 已翻转默认 **true**，3.0 招牌能力）、容量上限、水位/自动接续、存储与迁移、逐段注入控制、规则条目增删改。
- **判定**：**轻度过时**（「所有功能」是承诺性措辞，实际是「主干功能」）。建议改「把主要功能解释清楚」。列为建议档。

---

## §3 开关健康度表

**判定口径**（写入 → 白名单 → 后端读取，三段全通才算「可用」）：
- **可用** = 键在 `DEFAULT_CONFIG` 内（能落盘）+ 宿主 `lib/`（非 `client.js`）存在**真实读取点**（作用域内 `engine.config` / `cfg` / 构造器传入）+ 有即时回显
- **死** = 落盘成功但后端零读取方（点击可翻面，功能无变化）
- **半修** = 存在问题（默认值错、消费者语义与文案不符、条件分支未体现）但不完全失效

**白名单事实**（所有写入路径共用）：`/config` POST 用 `const allowed = Object.keys(DEFAULT_CONFIG)` 逐键过滤，白名单外**静默丢弃**（`lib/index.js:12126-12128`）。故「键是否在 `DEFAULT_CONFIG` 内」是硬闸门。

### 3.1 向导内嵌开关（11 个）

| # | 键名 | 写入点 | 后端读取点 | 判定 | 证据 |
|---|---|---|---|---|---|
| T1 | `associativeMemoryEnabled` | `client.js:5967` `saveConfigPatch(patch)` | `activation-host-pre.js` / `context-host-pre.js` / `shadow-host-pre.js` / `m7-index-sync-host-pre.js`（34 处） | **可用** | `index.js:557` |
| T2 | `injectEnabled` | `client.js:5967` | **无**（全 `lib/` 仅 `index.js:334` 声明行；排除 `procedureInjectEnabled` 后零读取点） | **死**（详见 K-1） | 见 K-1 |
| T3 | `autoPopupEnabled` | `client.js:5967` | `index.js:8723`（下发）、`client.js:7197`（消费） | **可用** | `index.js:523` |
| T4 | `unattendedAuto` | `client.js:5967`（`def:false`） | `index.js:5048/5051` | **可用** | `index.js:500` |
| T5 | `reflectEnabled` | `client.js:5967` | `index.js:4979` `if (this.config.reflectEnabled) {` | **可用** | `index.js:531` |
| T6 | `autoSummaryTimes` | `client.js:5956`（`boolOn:['12:00','18:00','22:00']` / `boolOff:[]`） | `index.js:7864`、下发 `index.js:8724` | **可用** | `index.js:527` |
| T7 | `reasoningObserverEnabled` | `client.js:5967`（`def:false`） | `index.js:1899` `if (!this.config.reasoningObserverEnabled \|\| chunk.type !== 'reasoning-delta') {` | **半修** | 默认值 `true`（`index.js:612`）↔ 文案「默认关」（`client.js:5896`）；见 O-1 |
| T8 | `activationEmitMode` | `client.js:5965` `apiPost(API.semanticEmit, …)` | `index.js:10383/11252` 读 `~/.dsh/memory/semantic-pre/embedding-config.json` | **可用（异路）** | **不在 `DEFAULT_CONFIG`**（实测 `/config` 无此键），故**不走** `/config` POST 白名单；走 `semantic-emit` 路由写 `embedding-config.json`（`index.js:11460-11481`）。设置页同源（`client.js:6735`）⇒ 双向联动成立 |
| T9 | `autoConsolidate` | `client.js:5967` | `index.js:8268/7586` | **可用** | `index.js:405` |
| T10 | `procedureInjectEnabled` | `client.js:5967` | `procedure-switch-pre.js:28` → `context-host-pre.js:547` / `activation-host-pre.js:335` | **可用** | `index.js:620`。**注**：键名已修正（旧键 `procedurePromotionEnabled` 曾结构性不可达），但向导文案仍有语义问题 ⇒ O-2 |
| T11 | `hubMechanicalProcedureFeedEnabled` | `client.js:5967` | `index.js:9904` `get mechanicalProcedureFeedEnabled() { return engine.config.hubMechanicalProcedureFeedEnabled === true }` → `memory-hub-pre.js:56` | **可用（半修）** | `index.js:637`。**见 K-3**：功能可用但**设置页无处可达** |

### 3.2 向导相关的其它引导面开关

| # | 键名 | 写入点 | 后端读取点 | 判定 | 证据 |
|---|---|---|---|---|---|
| T12 | `welcomeTourEnabled` | `client.js:6996` `set(...)` → 保存 | `index.js:525` 经 `/config` 下发 → `client.js:1217/1219/1223` | **可用** | 且关闭时立即撤下正在显示的向导（`client.js:1395-1398`）⇒ **即时回显成立** |
| T13 | `externalSources`（对象，13 源） | `client.js:5978` / 设置页 | `index.js:8834` `const map = this.engine.config.externalSources \|\| {}`、`:4989` | **可用** | `index.js:539-554` |
| T14 | `injectExcludeSources` | `client.js:7064` | `index.js`（注入侧排除闸） | **可用** | `index.js:376`；`/config` POST 有专门数组校验（`:12133-12138`） |

### 3.3 死键 / 孤儿键汇总（全 `DEFAULT_CONFIG` 扫描）

| 键名 | 声明 | 全 `lib/` 读取点 | 判定 | 备注 |
|---|---|---|---|---|
| **`injectEnabled`** | `index.js:334` | **0** | **死** | 向导 + 设置页双入口；见 K-1 |
| **`softInjectionEnabled`** | `index.js:606` | **0** | **死** | 设置页**无控件**（全 `client.js` 零命中），故用户不可达；仅悬空配置项 |
| `procedurePromotionEnabled` | `index.js:626` | 仅作兼容别名读（`procedure-switch-pre.js:30`） | **按设计保留** | 非缺陷：注释明写「设置页已改为操作新键，本键仅作读取回退」（`index.js:621-626`） |

### K-1【死开关·本次最高优先级】`injectEnabled`（向导「周期记忆快照」）

- **写入**：`lib/client.js:5967`（向导内，键来自 `TOGGLE` 定义 `:5868`）；设置页另有独立控件 `lib/client.js:6921`
- **白名单**：在 `DEFAULT_CONFIG` 内（`index.js:334`）⇒ **能落盘、GET 能读回、UI 能翻面**
- **后端读取**：**零**。精确检索（排除 `procedureInjectEnabled` / `resolveProcedureInjectEnabledPre`）后全 `lib/` 只剩 3 处：`client.js:5868`（向导定义）、`client.js:6921`（设置页控件）、`index.js:334`（声明）。**没有任何宿主代码读它。**
- **对照**：真实生效的注入门是
  - `snapshotMinGapRounds`（`index.js:514`）：实测注入循环 `index.js:10737`（`parseGapRoundsPre`）、`:10744`（精简版分支）、`:10753` / `:10774`（完整版节流分支）
  - `snapshotReinjectOnCompact`（`index.js:515`）：读点 `index.js:10781`
  - `snapshotTieredInject`（`index.js:509`）：读点 `index.js:10744`
  - `promptSectionToggles`（`index.js:366`）：逐段注入控制的真闸（`PROMPT_SECTION_KEYS_PRE_V1`，`index.js:743-757`）
- **用户可见后果**：向导第 3 步与设置页「记忆窗口」两处都摆着「周期记忆快照」开关，**关掉后记忆照旧每轮注入** ⇒ 精确复刻用户已认知的坏形态（「写盘成功但界面不变视为坏了」的同族：**界面变了但行为不变，且更隐蔽**）。
- **建议处置**（不实施，见 §5）：二选一 —— ① 接线到 `renderMemoryDynamic` 的调用侧做总闸（并在 `renderMemorySlim` 同步处理），② 删除该键与两个控件，把用户引导到 `snapshotMinGapRounds` / 逐段注入控制。

### K-2【死键·低危】`softInjectionEnabled`

- 声明 `index.js:606`，全 `lib/` 零读取点，`client.js` 零命中 ⇒ **用户不可达**的死配置项。不产生误导（无 UI），但属技术债。

### K-3【可达性缺陷】`hubMechanicalProcedureFeedEnabled` 在设置页无处可改

- **功能本身可用**：`index.js:9904`（getter 活读）→ `memory-hub-pre.js:56`（`opts.mechanicalProcedureFeedEnabled === true`）→ `memory-hub-pre.js:188` `crossFeed()` 分支。
- **但**：全 `client.js` **只有 1 处**命中（`client.js:5913`，向导第 8 步的开关）；设置页 `section('skills', …)`（`client.js:6958-6974`）里**没有**这个控件 —— 该分区只有 `memoryHubEnabled` / `episodicMinSegments` / `procedureMinSessions` / `procedureMinSuccess` / `procedureCorrectionCap` / `procedureHighRiskApproval` / `procedureInjectEnabled` / `procedureActiveLevel`。
- **用户可见后果**：向导里关掉（或开启）后，**设置页再也找不到它**；只有导出/手改配置文件才能回改。对照同类先例：`procedureInjectEnabled` 正是为「设置页此前只有旧键 ⇒ 用户改了也无效」补的线（`client.js:6966-6968` 注释），本键**漏补**。
- **判定**：半修（功能通、可达性缺）。

### K-4【孤儿文案】`secSemantic`（详见 O-8）

无消费方的 i18n 键，连带 O-10 的错误引路。

### 3.4 即时回显专项（用户明确偏好）

| 路径 | 机制 | 判定 | 证据 |
|---|---|---|---|
| 向导开关点击 | 乐观更新 `Object.assign(c, patch)` + `dlgTick()` 立即重渲 | **即时** | `client.js:5960-5961` |
| 向导配置加载闸 | `if (!wizSt.cfgLoaded) return`（防误触默认值覆盖） | **正确** | `client.js:5945/5952/5972` |
| 设置页开关 | `set()` → `setCfg` + `setDirty(true)`，**需点保存** | **非即时（设计如此）** | `client.js:6615`、保存条 `:7111` |
| 白板/接续页 `handoffEnabled` | 本地 `setHandoffOn(v)` + `saveConfigPatch({...}, {onSaved: …setReload…})` | **即时 + 数据重取** | `client.js:4315`、`:4225-4229` |
| 向导关闭开关时撤窗 | `saveConfigPatch` 成功回调内 `dismissWelcomeTourPre('config')` | **即时** | `client.js:1395-1397` |
| `activationEmitMode` | 向导与设置页均 `apiPost(semanticEmit)` 后 `refreshSem(setSem)` | **即时** | `client.js:5965` / `:6735` |

> **注**：向导内开关走「点击即写盘」（无需保存），设置页走「改完点保存」——**两套交互模型并存**。向导第 9 步文案「你刚才的选择都已即时保存」（`client.js:5917`）对向导内开关**属实**，但若用户误以为设置页也即时保存，会丢改动。

---

## §4 解耦与回显问题

### 4.1 解耦（用户硬性要求：单一开关不得顺带改变其他功能的行为）

**本次审计未发现向导开关存在新的耦合缺陷。** 核对如下：

| 检查项 | 结论 | 证据 |
|---|---|---|
| `boardMode` 是否牵连其它 | **已解耦**，只判白板线形态 | `index.js:321-326` 注释明写「开关解耦:只管白板线形态」 |
| `handoffEnabled` 是否牵连面板渲染 | **已解耦**（2026-09-17 L1 修） | `index.js:2866-2870` 注释：「移除 handoffEnabled 门…门控的是「渲染」还是「写入/取材」」；`handoffPanelData` 已不带该门，只回 `reason` |
| `procedureInjectEnabled` 是否牵连 | **文案层面耦合**（见 O-2），**代码层面已解耦** | `procedure-switch-pre.js:11` 自述旧键是「单一开关顺带改变其他功能」的反例，新键已拆 |
| `hubMechanicalProcedureFeedEnabled` | **已解耦** | `index.js:634-635` 注释：「只控制 procedure 切片；fact 分支、episode 巩固、judgement 消费等一律不受影响」 |
| `tier0MaxTokens` / `tier0BudgetShare` | 两者取小，属设计内 | `index.js:358-360` |
| `waterLevelThreshold` vs `autoContinueThreshold` | **刻意不复用常量**（防耦合成一个） | `index.js:313-318` 注释 |

**唯一需登记的耦合展示面**：向导「唤起与固化」步把 `procedureInjectEnabled`（注入总闸）与「晋升」写在同一条 `sub` 里（O-2），会把两个独立机制**在教学层面**耦合成一件 —— 属**文案耦合**，非代码耦合。

### 4.2 回显

- 向导内开关 **即时回显成立**（`client.js:5960-5961`）。
- **但存在一处「回显正确、行为不变」的强误导**：K-1 `injectEnabled` —— 点击后开关翻面、写盘成功、下次打开仍显示新值，**唯独记忆注入行为毫无变化**。这比「写盘成功界面不变」更难自查（用户会以为是自己没观察出来）。
- 设置页与向导**两套保存模型并存**（见 §3.4 注），无功能故障，属体验一致性问题。

---

## §5 建议改动清单

> **本清单只出建议，未实施任何改动。** 所有行号基于本报告基线（`index.js` 12,563 行 / `client.js` 7,449 行 / v3.1.1）。

### 必须改（用户可见的功能性错误）

| # | 改动 | 落点 | 理由 |
|---|---|---|---|
| M1 | `injectEnabled` **接线或删除**（二选一） | 接线：`index.js` 注入调用侧（近 `:10736`）；删除：`index.js:334` + `client.js:5868` + `client.js:6921` + i18n `fInject`/`fInjectHint`（`client.js:415` / `:652`） | K-1：向导与设置页双入口全是死开关，用户关不掉注入 |
| M2 | 向导「思维链监听」`sub` 去掉「默认关」 | `client.js:5896` | O-1：默认值是 `true`（`index.js:612`），文案与真值相反，且涉隐私语义 |
| M3 | 向导「技能固化与注入」`sub` 的审批页名改「唤起回顾」，并拆开「注入」与「晋升」 | `client.js:5907` | O-2：审批队列在唤起回顾页（`client.js:3675`）；`procedureInjectEnabled` 不控晋升 |
| M4 | `planDisabled` 引路改「设置 → 长会话接续」 | `client.js:237`（en 对应 `:479`） | O-9：`handoffEnabled` 控件在 `handoff` 分区（`client.js:6976`），不在「自动化」 |
| M5 | 锚定索引提示改「设置 → 语义记忆总开关」 | `client.js:3905` / `:3921` | O-10：「自动记忆引擎」已不是 UI 分区名 |
| M6 | 给 `hubMechanicalProcedureFeedEnabled` 补设置页控件 | `client.js` `section('skills', …)`（`:6958-6974`）内 | K-3：向导关掉后设置页无处回改 |

### 建议改（准确性 / 一致性）

| # | 改动 | 落点 | 理由 |
|---|---|---|---|
| S1 | Python 引擎体积统一为单一真源派生（`MODEL_SPEC.bytes` = 568,456,694 B ≈ 542 MiB） | `client.js:5893/5894/6083`；`python-setup-pre.js:8` 的 `~539MB` 注释同步 | O-5：现为 563 / 539 / 568.5 三个数 |
| S2 | 同屏统一体积量纲（MiB 或 MB 择一） | `client.js:5893`（130MB）vs `:6072/6080`（129MB） | O-6：同屏两套口径 |
| S3 | `EXT_SOURCE_KEYS` 补齐 5 个新源，或删除死代码 | `client.js:5942` | O-3：13 源 vs 8 源；当前无消费者但属隐患 |
| S4 | 向导「完成」步补全页签清单，或改为「完整清单见设置→关于」 | `client.js:6096` | O-4 |
| S5 | 删除孤儿 i18n 键 `secSemantic` | `client.js:243` / `:485` | O-8 |
| S6 | 向导「欢迎」步「所有功能」改「主要功能」 | `client.js:5856-5857` | O-13 |
| S7 | 向导引擎步「正在为你安装」补前置条件说明 | `client.js:6080` | O-7 |
| S8 | 统一向导/设置页保存语义（或明确文案区分） | `client.js:5917` / `:7111` | §3.4 注 |
| S9 | 清理死键 `softInjectionEnabled` 或补控件 | `index.js:606` | K-2 |

### 不影响（核对后确认无需改动）

- §0 的 8 项翻转默认值：**全部与代码一致**，任何引用这些数的旧文档若与 §0 不符，**错在旧文档，不在引导面**。
- `welcomeTourEnabled` 开关链路：写入、下发、消费、关窗副作用四段齐备，**无需改动**。
- `activationEmitMode` 异路写入（`semantic-emit` → `embedding-config.json`）：非缺陷，**设计如此**（键本就不属 `DEFAULT_CONFIG`）；实测该路径有原子写与合法值校验（`index.js:11468/11479`）。
- 白板自动首建骨架（`index.js:2494`）与 `planEmpty` 文案：**一致**。
- 12 个页签空态文案（除 O-9 指向项）：**正常**。
- 向导开关的即时回显机制（乐观更新 + `cfgLoaded` 闸门）：**实现正确**。

---

## §6 未能证实的事项（显式标注为推断）

以下均**未经运行时实测**，仅由源码静态阅读得出，标注为推断：

1. **【推断】K-1 的运行时症状**：`injectEnabled` 后端零读取点由**静态全库检索**确证；「关掉后注入行为不变」是由「零读取点」推出的**运行时结论**，未做「改配置 → 观察注入块」的端到端实测（需重启宿主，本任务禁止）。
2. **【推断】O-2 的「审批在唤起回顾页」**：由 `client.js:3636/3675` 所在的渲染函数归属推断。**未逐行确认**该函数只被 `refineTab` 挂载 —— 若它被多页复用，则「记忆中枢页」也可能渲染审批队列，O-2 的结论需收窄为「措辞不精确」。
3. **【推断】O-1 的 `def:false` 语义**：`tourToggleOn` 在 `cfgLoaded` 为真时**不读 `tg.def`**（`client.js:5949` 的三元仅在 `c[tg.key] === undefined` 时用 `def`）。实测 `/config` 是否**总是**下发 `reasoningObserverEnabled` 未逐项验证（本次只验证了键集总数 = 102 与部分键缺失情况）。若某路径下该键不下发，则显示值会回落到 `def` 值。
4. **【推断】O-5 / O-6 的「应为」换算**：按 1 MiB = 1,048,576 B 计算得出；**未核对**上游模型仓库（HuggingFace `Xenova/...`）当前实际发布体积（清单是本地冻结常量 `semantic-js-pre.js:435`，与远端可能漂移）。
5. **【推断】S3 的「当前影响为零」**：`groupAll` 在 `TOUR_STEPS` 中零引用由 grep 确证；但**未排除**运行时动态构造 `TOUR_STEPS` 的可能（本次阅读 `client.js:5853-5919` 为纯字面量数组，故风险极低）。
6. **未做**：真实浏览器点击验证（任务为只读审计；且宿主重启被明令禁止）。所有「即时回显」结论均为**代码路径推断**，非实测截图。
7. **未做**：`/config` POST 的**端到端写盘验证**（避免改动用户配置）。白名单机制由源码 `index.js:12126-12156` 逐行确证，实测仅做了 GET。

### 取证脚本（可复跑）

均落在 `%TEMP%\dsh-onb-audit\`（不污染仓库）：
- `extract-config.cjs` —— 括号匹配 + `new Function` 求值 `DEFAULT_CONFIG`（输出 `config-keys.json`）
- `toggle-keys.cjs` —— 逐键在 `lib/*.js`（排除 `*.bak-*`）列引用点（输出 `toggle-keys.json`）


