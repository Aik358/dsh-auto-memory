# 批次3「投递能力表 + 四档×十四段矩阵」适配度复核

日期：2026-11-17。复核对象：用户提供的 10 行配置能力表、4 档 × 14 段投递矩阵（GPT 暂定细则）。
方法：逐条回到生产源码与已提交的批次3模块核对；不采信方案文本的自述。

## 0. 三个问题直答

**① 这套理论能不能做到系统化 / 模块化 / API 化？**
理论：能。它是目前唯一能同时满足「设置里选投递点 + 什么时候投什么」的形状 —— 模块注册表决定「有哪些投递点」，模式解析决定「何时投什么」，单位选择器决定「投多少」，表示层决定「投成什么样」。
现有代码：不能。参考引擎只有 258 行，是**计量内核**，不是系统。系统化所需的 9 件部件它缺 7 件（见 §3）。评估：理论完成度约 80%，参考代码约 25–30%。

**② 现有批次3的内容：保留、删除还是融入？**
不删任何单元。保留 6 个（CB / SR / RC / CA / NT / CO），融入改造 6 个（DTO / PJ / RP / BD / EV / FM），拆分 1 个（PJ 的「策略解析」与「候选投影」分家），新增 3 个部件（B3-POLICY 注册表与预设、B3-SU 选择器、设置与预览 API）。删除的不是文件，是**职责**：各模块内部的投递裁剪决策。代码可留约 60–65%。

**③ 这两张表本身适配吗？**
- 10 行能力表：不是「10 个平铺字段」，而是**三层 + 一个设置层**；落到现有引擎是 4 支持 / 2 半支持 / 4 缺失。
- 4×14 矩阵：14 段与 L1 的 ContentSpec 逐条对应，但**生产实际可关清单是 13 段**（`PROMPT_SECTION_KEYS_PRE_V1`），两者不是同一集合；4 档只覆盖生产 8 档的一半；标 [定] 的 4 行里 3 行与代码一致、1 行与生产实现冲突；标 [建议] 的 10 行里有 3 行需要先改契约、2 行有重复注入风险、1 行是无生产者的死段。

## 1. 10 行能力表 → 实际是三层 + 一个设置层

| 用户的行 | 所属层 | 归属部件 | 现有引擎 | 结论 |
|---|---|---|---|---|
| 内容开关 | 策略层 | 注册表（PJ/registry） | 半：靠 modules 数组是否存在隐式表达，无 enabled 字段 | 补显式启用位 |
| 来源范围 | 选择层 | B3-SU 选择器 | 缺：scope 只是配额作用域，没有「当前事件/指定事件/当前项目/选定资料」选择器 | 新增，且相关性分数只能由事实提供者给 |
| 呈现形式 | **两层** | 模块视图（ContentSpec 枚举）+ 单元表示（SU/FM） | 半：只支持 full/preview/pointer，且把「核心节」这种模块视图与「摘要/指针」这种单元表示混在一列 | 必须拆成 view 与 representation 两个维度 |
| 内容数量 | 选择层 | 配额（B3-SU） | 半：metric 硬编码 5 种（modules/events/checkpoints/references/checkpointIdentities），无法表达「几条规则/几条画像/几条日历」 | metric 必须由 unitType 注册 |
| 单段预算 | 传输层 | FM（每模块） | 缺：transport 只有全局 | 补 scope=module 的传输上限 |
| 总预算 | 传输层 | FM（全局） | 有 | 保留 |
| 上限性质 | 选择层 | hard/soft | 有（仅配额；传输恒 hard） | 需明说传输不可软 |
| 超额策略 | 选择层 | 降表示 / 省略 / 显式失败 | 有 | 保留 |
| 保留优先级 | 选择层 | priority + required | 有 | 保留 |
| 触发策略 | 节奏层 | CA + 模式解析 + 预设 | 缺：引擎无触发概念；CA 有节奏但不可配置 | 新增 mode resolver，4×14 矩阵落为预设 |

**计分：4 有 / 2 半 / 4 缺。** 另外「设置层」四件套（schema、校验、预览、持久化迁移）在两张表里完全没有，是真正的空白。

## 2. 4×14 矩阵逐行适配

| 段 | 矩阵（4 档） | 生产实际（代码证据） | 结论 |
|---|---|---|---|
| 规则 | human_full 全文；human_slim 指针+维护；run_full/run_slim 指针 | `render-rules.js`：SUMMARY_TIERS=[slim,run_full,run_slim,human_slim,legacy]；human_slim 追加 maintain | **一致**，且已生产接线（RP dd8c87ec） |
| 白板 | 全文 / 核心节 / 核心节 / 不投 | `index.js:12674` `_planSpec`：full=human_full+handoff_carry+post_compact；none=run_slim；其余 core 7 节 | **一致** |
| 交接账本 | 四段加权 / 三段 / **建议有限视图** / 三段 | `index.js:13130` `_LEDGER_FULL_TIERS` **含 run_full** ⇒ run_full 四段全量 | **冲突**：矩阵是改现有生产行为，需裁定 |
| 事件 | 当前事件+相关目录 / 当前事件+小范围 / 任务相关卡 / **当前事件提醒** | `index.js:13198` `_evCardsOk = !(RUN_SLIM)`；用户 2026-10-28 已裁定 run_slim 不给事件卡与画像 | **矩阵 run_slim 一格错**，应改「不投」；「相关目录」实为「卡片未展开的剩余事件目录」（互斥），非相关性筛选 |
| 用户画像 | 完整 / 简短相关 / 不投 / 不投 | `index.js:13302` `_portraitOk` = human_full+human_slim+post_compact+handoff_carry | 4 档**一致**；「相关」未实现（现按 accepted/used 与分类配额过滤） |
| 语义背景 | 最相关完整 / 限定当前事件 / 限定自动任务 / 不投 | `index.js:13253` 同 4 档 | 档位一致；但「限定当前事件/自动任务」是 **scope 维度**，ContentSpec 只有 none/full | 
| 日志 | 相关尾部 / 不投 / 不投 / 不投 | 与「最近日志」**映射到同一 prompt 段**（`projection.js:40,44` 都→`recent-logs`） | **结构性缺陷**：两段同开即重复注入 |
| 日历 | 当前相关 / 相关给当前 / 同左 / 不投 | `index.js:13615` push 点无 tier 判断 | 矩阵 run_slim「不投」需补门控或确认上游已门控 |
| 外部记忆 | 完整合格 / 不单独投 / 不投 / 不投 | `index.js:13593` push 点无 tier 判断 | 需门控；且 human_full 与语义背景都「完整」→ 重复风险 |
| 工作区地图 | 完整 / 邻近摘要 / 任务摘要 / 不投 | `index.js:12865` 无 tier 判断 | 需门控 |
| 最近日志 | 近期尾部 / 小范围 / 小范围 / 不投 | 同日志（同段） | 同 D1 |
| 反思 | 近期已接纳 / 不投 / 不投 / 不投 | push 位置与门控**未逐行核**，标待核 | 需补证据 |
| 诊断 | 全不投 | `CONTENT_SPEC_TO_PROMPT_SECTION.diagnostic = null` | **死段**：任何档启用都只产生 segment-unmapped 降级 |
| 维护提醒 | 不带 / 带 / 不带 / 不带 | `render-rules.js:170` 仅 human_slim 追加 | **一致** |

### 2.1 先修结构性问题（与格子对错无关）

- **D1 日志与最近日志同映射一个生产段**：两段都开 = 两份候选争同一键，要么重复、要么后者覆盖前者。必须先定义「两个不同来源」或设为互斥。
- **D2 诊断段无生产者**：映射为 null，永远降级。要么给 debug provider（且不进用户可配清单），要么从 14 段移除（需契约变更）。
- **D3 维护提醒并入 rules 段**：若按「模块数」计量，会把 2 段算成 1 段或把 1 段算成 2 段。必须定义子单元或合并规则。
- **D4 矩阵只有 4 档，生产有 8 档**：post_compact / handoff_carry / hang_compensate / legacy 无值。正确做法是「3 个基础内容档 + 4 个显式 override」，不是复制 8 份表。
- **D5 矩阵漏了两段生产实际注入内容**：`user-memory` 与 `project-notes`（证据层，仅 legacy/human_full/handoff_carry/post_compact 投），以及 frame-head / tier0 / water / welcome 等内部段。**可关清单 13 段 ≠ ContentSpec 14 段**。若设置页只做 14 段开关，用户关不掉用户级记忆与项目笔记。

## 3. 系统化 / 模块化 / API 化 还差 9 件

1. **Provider registry**：14 段 → 实际 11 个生产者（rules+maintenance 合、logs+recentLogs 合、diagnostic 无），每段声明 unitTypes / views / enumerate / render / verifyCoverage / defaults。
2. **动态度量**：metric 由 unitType 注册，替代硬编码 5 种。
3. **每模块传输上限**：单段预算是必配项，不是全局预算的附带。
4. **来源范围选择器**：current-event / explicit-id / project / relevance；相关性只能消费事实层提供的候选分，不能自造。
5. **视图与表示分离**：ContentSpec 的 core/full/pointer/tail 是**模块视图**；full/summary/preview/pointer 是**单元表示**。混为一谈会让「核心节」和「摘要」互相冒充。
6. **触发与模式解析**：8 档 → 内容档 → resolvedPolicy；4×14 矩阵成为预设数据；触发参数（真人、压缩后、水位、间隔）从散键收进 policy。
7. **Policy schema + 校验**：未知字段/单位/视图拒绝；版本号单一。
8. **预览 / dry-run API**：纯函数引擎天然支持，设置页「保存前看效果」必需；没有它用户无法安全配置。
9. **持久化 + 迁移**：新键 `injectionPolicy`（或等价），旧 29 个直接相关的注入散键（实测 DEFAULT_CONFIG 区段：injectBudgetChars 8000、handoffPlanChars 1200、fullInjectSlimBudgetChars 3000、handoffLedgerChars 800、slimPlanChars 400、slimLedgerChars 300、eventMaxActiveInInject 2、eventCatalogChars 400、recentDaysInjected、fullInjectWaterPct、slimEveryRounds、snapshotMinGapRounds、slimCheckpointCount、fullInjectSemanticChars 800、externalInjectionChars 1400、tier0MaxTokens、tier0BudgetShare、promptSectionToggles、injectExcludeSources 等）→ policy 适配器；同步配置键计数锁、前端文案表、verify-docs。

## 4. 现有批次3处置

| 单元 | 处置 | 动作 |
|---|---|---|
| B3-CB | 保留 | 验收装置不动 |
| B3-SR | 保留 + 补 | 现只读 5 通道（events/plan/handoff/reflections/logs），需补 calendar/externalMemory/workspaceMap/semantic/portrait |
| B3-RC | 保留 | 规则读取不动 |
| B3-CA | 保留 + 补 | 输出 isHuman（上一轮 P0 未收口） |
| B3-NT | 保留 | 作为 notification unit provider |
| B3-CO | 保留 | 独立线，不受影响 |
| U2 DTO/profile | 融入 | 加 DeliveryUnit / Policy v2；ContentSpec 保留为「模块视图」层 |
| B3-PJ | **拆分** | resolvePolicy（预设 + override）与候选投影（legacy 路径）分家；4×14 矩阵落在 preset 数据里 |
| B3-RP | 融入 | 增加 rules 单元与 full/pointer 表示；文本渲染保留 |
| B3-BD | 融入 | 增加 plan/ledger 单元；**接线时必须显式传 policy.profile**——模块默认 `FULL_VIEW_TIERS` 含 run_full，与生产白板 `_planSpec` 相反，是接线定时炸弹 |
| B3-EV | 融入 | 改为单元枚举 + 表示变体；300/1800/2400 从「投递上限」降为「preview 生成器」 |
| B3-FM | **重写选择语义** | 保留计量等式与桶账；把「按段丢弃」改为「按单元最终裁决」 |
| 新增 | B3-POLICY / B3-SU / 设置与预览 API | 三件新部件 |

删除：0 个文件、0 个单元。删除的是职责：各模块内部的投递裁剪（T2_BUDGET 作为投递上限、BD 的 `_cap`、projection 的 tail slice）——代码保留为渲染/预览器，不再拥有「投多少」的决定权。

## 5. 设置页能做到什么 / 不建议做到什么

**能**：13 段可关开关；每段来源范围枚举；每段视图枚举；每 unitType 数量配额；每段与全局传输预算；hard/soft；超额策略；保留优先级；4 类触发参数（真人、压缩后、水位、间隔）。这正是用户 10 行表的能力集合。

**不建议**：
- 运行时新增未注册模块（L1 §4.4：扩展段须先登记，不得静默新增公共面）；
- 10 个平铺字段的自由组合（会产出大量非法组合，且无法迁移）；应是「preset + 有限 override」；
- 无 tokenizer 时的 token 硬上限（必须显式拒绝，不得用倍率折算）；
- 把「模块视图（核心节）」和「单元表示（摘要）」做成同一个下拉框。

## 6. 需要裁定

1. **账本 run_full**：保留现状四段全量（受 800 字预算约束），还是改成矩阵建议的有限视图？建议保留现状 —— 账本是「接着干」的最小上下文，run_full 是运行中完整版；且白板的「不擅自扩全文」是长期全貌维度，不适用于账本。
2. **事件 run_slim**：矩阵写「当前事件提醒」，与用户 2026-10-28 裁定（run_slim 最克制，不给事件卡与画像）冲突。建议改为「不投」。
3. **日志 / 最近日志**：先拆成两个真来源，还是先设互斥（human_full 只开一个）？建议先互斥，拆源放到后续批次。
4. **诊断段**：给 debug provider 还是从 14 段移除？建议移出用户可配清单、保留为内部 debug 段。
5. **human_slim 可达性**（上一轮遗留）：unit policy 已把它变成策略问题 —— 确认「真人可 slim」。

## 7. 施工顺序修正

| 阶段 | 内容 | 出口 |
|---|---|---|
| U0 契约 v2 | Policy schema、DeliveryUnit、四档表示、8 档映射、4×14 预设、13 段可关清单对齐、视图/表示分离 | 契约评审通过，先冻结 |
| U1 引擎补全 | 动态度量、每模块传输、bundle、四档表示、eligible、sourceRevision、增量记账 | reference 32 项 + 新增用例全绿 |
| U2 providers | 11 个生产者，补 5 通道 reader | 每 provider 真 import→真调用 |
| U3 唯一编排 | production inline → policy resolver → engine；删除双实现 | 隔离行为验收 |
| U4 设置页 + 预览 API | 前端线；需重新测绘设置页（client.js 禁整块替换） | 设置往返 + 预览一致性 |
| U5 验收 | 矩阵逐格行为断言 + 设置往返 + 隔离 HOST + 真实 HOST | 真实会话证据 |

## 8. 一句话总评

**方向对，粒度也对；两张表已经能当「设置页的默认预设数据」用，但还不是可执行契约。** 先把 14 段对齐成 11 个生产者 + 13 段可关清单、把 4 档扩成「3 基础档 + 4 override」、把日志与诊断两处结构性缺陷修掉，再谈接线；否则设置页做出来会是「14 个开关，其中两对互相打架、一个是空开关」。
