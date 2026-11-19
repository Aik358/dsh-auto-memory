# Lead 亲自全量审核：批次3新旧内容、存量研究与施工契约（2026-11-17）

> 执行：Lead 本人。未把 teammate 的摘要当作审核结论。
> 基线：preview / fcdf60b6。
> 范围：42份直接相关文档及当前 lib 代码、prototype文件与生产引用。
> 性质：文档与代码审核。未改生产代码、未启动HOST、未访问19387。

## 0. 总结论

fcdf60b6 已解决 task-33 发现的文档形式冲突，但不能据此认定批次3内容已经完整。此次扩大范围后发现：

- 新纲要缺少帧节奏层、consolidate独立工作流、事件来源指针和宿主交付边界；
- B3-RC被统一成“全部来源读取”，反而模糊了Rules Complete的原有职责；
- 旧“局部修补不抽模块”与新“模块化重建”是两种不同施工路线，必须说明替代关系，不能同时当约束；
- 旧文档包含大量历史实测与建议，不等于当前代码事实或最终用户裁定；
- 预算、full/slim视角、事件展开数量等仍有真实未决边界，不能为了显得完整而擅自定值。

因此需要修订总体施工文档和L1/L2/L3，而不是继续追加零散补丁。

## 1. 审核覆盖与读法

### 1.1 新施工与核对文档

- DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md
- DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md
- DETAIL-BATCH3-UNIFIED-20261116.md
- REPORT-BATCH3-NUMBERING-DECOUPLING-20261116.md
- RESULT-BATCH3-CONTRACT-REPAIR-20261116.md
- REVIEW-BATCH3-DOCUMENTS-20261116.md
- REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md
- RESULT-BATCH2-IMPLEMENTATION-REVIEW-20261116.md
- RESULT-BATCH3-MODULAR-IMPLEMENTATION-20261116.md
- CONSTRUCTION-PLAN-20261108.md 的批次1–5、待裁定与进度登记
- NEXT-STEPS-20261114.md

### 1.2 旧注入调查、施工准则与历史结论

- MASTER-PLAN-3.0.md
- CONSTRUCTION-GUIDELINE-INJECT-20261108.md
- AUDIT-PROMPT-INJECT-REFACTOR-20261108.md
- AUDIT-CROSS-ROUND1-CODEX-20261108.md
- INVESTIGATION-BATCH3-MODULAR-API-20261113.md
- DETAIL-BATCH3-IMPLEMENTATION-20261113.md
- REPORT-3.0-INJECTION-PROGRESS-20261113.md
- PROMPT-BATCH3-MODULAR-API-INVESTIGATION-20261113.md
- DIAG-20261006-SLIM-INJECTION-NOT-EFFECTIVE.md
- DESIGN-20261006-INJECTION-ASYMMETRY-FIX.md
- INJECT-COST-RESEARCH-20260922.md
- INJECT-TIER-DEFECTS-20261028.md
- INJECT-TIER-DOUBLE-CHECK-20261028.md
- INJECT-TIER-DOUBLE-CHECK-REPLY-20261028.md
- INJECT-TIER-REPLY-VERIFY-20261028.md
- PENDING-FIX-INJECT-TIER-20261029.md
- ACCEPT-INJECT-TIER-20261103.md
- DOUBLE-CHECK-INJECT-TIERS-20261103.md
- INVESTIGATE-USER-TIERS-20261103.md
- INVESTIGATE-TIERS-FULL-20261103.md
- TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md
- USERFULL-EVENT-DESIGN-ASSESS-20261108.md
- PROMPT-AND-CONSOLIDATE-20261108.md

### 1.3 Prototype、2.3与2.9存量工作

- ARCH-SIDECARSTORE-PROTOTYPE-AND-SYSTEM-INTEGRATION-20261112.md
- REVIEW-SIDECARSTORE-PROTOTYPE-20261113.md
- RESULT-SIDECARSTORE-BLOCKERS-20261113.md
- HANDOFF-SIDECAR-PRODUCTION-WIRING-POST-23-20261112.md
- PLAN-SCHEMA-ALIGN-PROTOTYPE-2026-10-27.md
- PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md
- PROMPT-BATCH2-2.9-HANDOFF-COVERAGE-20261113.md
- RESULT-EVENT-ATTRIBUTION-IMPLEMENTATION-20261116.md
- prototypes/sidecar-store 六个JS文件与lib生产引用

以上文档均核对了标题、结论、关键章节和与当前施工相关的内容；核心施工契约、prototype、consolidate、事件设计与当前代码另作全文/重点章节交叉复核。没有声称对仓内所有记忆相关文档逐字覆盖，也没有把历史数字当当前实测。

## 2. 新旧内容的联系与区别

### 2.1 保持不变的核心问题

新旧内容共同处理：

1. 规则完整读取与摘要指针；
2. full/slim及特殊档的内容差异；
3. 白板/账本选择与尾部信息保留；
4. 通知只读预览、最终保留提交和幂等；
5. 最终帧预算、分段与计量一致；
6. 事件四段、检查点、目录与定位；
7. 真实import/apply/context与负路径验收；
8. 与2.3、2.5–2.9、4.1/4.5、5.1的接口关系。

### 2.2 新纲要真正新增的价值

- 用语义代号替代冲突的3.0.x编号；
- 将读取、策略、最终帧、通知和事件视图变成公共契约；
- 将“候选渲染”与“最终投递”分开；
- 将prototype与2.3、R4、生产读写的边界明确化；
- 将测试从静态源码命中升级为真构造、真调用、负路径与隔离变异。

### 2.3 新纲要当前遗漏或过度简化的地方

| 领域 | 旧内容已有研究 | 新纲要现状 | 处置 |
|---|---|---|---|
| 帧节奏 | 水位、压缩、真人/运行、间隔、首帧基线、强制full | 主要塞在NT或PJ，缺独立决策层 | 新增B3-CA |
| 来源读取 | Sources/Readers与rules完整读取是不同职责 | B3-RC被扩大为全部来源 | 拆B3-SR与B3-RC |
| 内容策略 | ContentSpec、各段枚举与档位映射 | PJ只有原则，缺可执行规格 | 在PJ冻结ContentSpec |
| consolidate | 日志+事件+白板+账本+反思，写入分离 | 没有独立施工单元 | 新增B3-CO |
| 事件指针 | members/rel/quoteRef/sourceRef可按需下钻 | 只有四段/预览/展开 | 增加指针投影与未解析状态 |
| 宿主交付 | 插件文本、宿主project/retained、通知消费不同 | 只有原则，缺验收DTO与负路径 | 增加HostDeliveryObservation |
| 历史迁移 | 曾明确不抽三个模块，担心抽取式套件与幂等闸 | 新文档直接写模块化重建 | 写明路线替代与迁移门 |
| 预算迁移 | rules豁免、otherDynamic、full豁免/50K有历史冲突 | 只写最终长度等式 | 分开兼容计量与硬上限政策 |
| 配置现状 | snapshotReinjectOnCompact已接线，fullInjectOnCompact已无命中 | 未逐项标当前事实 | 更新现状表 |

## 3. 必须订正的架构问题

### 3.1 B3-SR 与 B3-RC 分开

- B3-SR（Source Readers）：统一读取规则、事件、白板、账本、反思、日志和来源证明。
- B3-RC（Rules Complete）：只负责user+project规则完整读取、rule/note/retired、层内revision、expect与跨层CAS兼容。
- readInjectionSourcesPre是全来源入口；readRulesAggregatePre是规则域入口，不再是“被取代的杂项”。
- 这样避免一个超大Reader成为新的耦合中心，也保留memory_rules真实回读能力。

### 3.2 新增 B3-CA（Cadence）

负责：

- 首帧/真人/运行、间隔与精简节流；
- 25/50水位授予与复位；
- post_compact检测、首观测基线、强制full；
- handoff_carry/hang_compensate触发边界；
- legacy fail-open回退；
- 与requestId/turnKey的幂等关系。

只返回决策，不直接改运行时状态，不渲染内容，不提交通知。

### 3.3 B3-PJ 冻结 ContentSpec

建议形状：
~~~text
rules: none|pointer|summary|full
plan: none|core|full
handoff: none|sections|full
events: none|cards|cards+catalog
portrait: none|short|full
semantic: none|full
logs: none|tail|full
maintenance: none|slim-maintain
~~~

PJ只决定“给什么”，CA只决定“何时给”，FM只决定“最终如何装帧计量”。

### 3.4 新增 B3-CO（Consolidation）

保留旧3.1：
- collectConsolidationSourcesPre({days,readers})
- buildConsolidationPromptPre({sources,budgetPolicy})
- applyConsolidationResultPre({parsed,writer,budget})

边界：
- collect/build只读；
- apply由现有工作流写入；
- USER候选仍只进待确认区，不直接写全局用户记忆；
- 不承担事件归并、四段补全或2.4；
- unreadable不得当空来源；
- 复用SR读取，不另造数据语义。

### 3.5 通知拆成三种语义

- planUpdatePending：待生成/待投递的计划更新提醒；
- _recallJustDelivered：唤回块刚刚实际交付后的状态；
- water/postCompact/full grant：属于CA的授予决策，不与UI通知混写。

prepare→finalize→commit必须闭合：
- prepare无副作用；
- finalize只产生插件最终文本与候选ID；
- commit只提交最终保留的版本；
- 没有宿主交付证明不得写成hostDelivered；
- 旧版本commit不得清新待办；
- 写盘失败显式报错且可重试。

### 3.6 预算分“兼容计量”和“硬上限政策”

先保证最终文本与计量完全一致，再谈统一硬上限：

- 现状兼容：rules豁免、otherDynamic既有语义、候选/实际分账；
- 最终段、标题、分隔符、降级尾巴、通知、反思全部入账；
- 记录JS String.length与UTF-8 bytes，token未实测不得冒称；
- full/压缩与总量上限的历史冲突显式保留，不擅自设50K或豁免；
- 8000、1800、300等旧值需区分现状、段级和整帧，不写成新批准值。

### 3.7 事件消费增加指针与来源分工

- 四段消费保留当前CHECKPOINT_QUAD_KEYS事实；
- 检查点预览保留首尾或按四段动态分配，具体额度待联验；
- 展开数量使用eventMaxActiveInInject，不擅自增加；
- 目录排除已展开事件，避免同卡重复；
- members/rel/quoteRef/sourceRef生成指针，不直接注入整篇施工文档；
- 不可解析路径显式标未解析，不静默丢弃；
- quoteRef是引文，不是路径；sourceRef可能指向账本/日志，不冒充施工文档；
- currentEventIds来自真实会话上下文；没有时只称“最近更新”，不能冒充当前任务。

### 3.8 Prototype与R4不是本批重写对象

- Prototype只做派生索引、CAS、幂等、恢复和source revision；
- 37/37/0 skipped与6个变异只证明隔离工程，不是生产接入；
- SidecarStore不接模型，不决定归属、档位或预算；
- 不替代event-store.json或events.jsonl；
- R4/LedgerDocSystem继续默认关闭；
- 2.9来源证明可复用，covered不授予删除/迁移权限。

## 4. 历史裁定、建议与当前事实的正确写法

### 4.1 已裁定但当前未完全实现

- 摘要档规则指针；
- human_full完整有效正文、不逐条200；
- legacy少给；
- 50%水位默认关闭、25%保留；
- snapshotSlimMaintain只在human_slim；
- 总量上限要生效；
- 特殊档保留；
- 通知最终保留才提交。

这些不能写成“已经做完”。

### 4.2 已有调查建议，但不能当最终批准值

- legacy约7200字符；
- 段级1800、单项300、T2=2400；
- 10 active展开或eventDigestRecentN默认20；
- 50K具体上限或full豁免；
- references语义分类器的具体模型与成本；
- 白板full/slim的具体章节清单与无命中回退。

### 4.3 当前代码核对

- fullInjectWaterPct仍为'25,50'；
- ruleSummaryPre仍默认max=200；
- snapshotReinjectOnCompact已有真实消费，POST_COMPACT且配置非false才输出；
- fullInjectOnCompact在当前lib中0命中；
- noticeRemoteEnabled在lib中0命中；
- snapshotSlimMaintain当前仅HUMAN_SLIM分支；
- isRulesFullTierPre仍包含LEGACY，legacy“少给”未闭合；
- CHECKPOINT_QUAD_KEYS已存在，但检查点预览仍单向cutPre；
- collectConsolidationSourcesPre/selectEventProjectionPre/composeFinalEnvelopePre/projectInjectionPre等目标API当前0命中；
- lib/inject-tier.js不存在，档位与内联副本在lib/index.js；
- Prototype生产facade没有接入。

## 5. 修订后的施工顺序

1. B3-CB：修恒真断言、真实import/apply/context与旧行为对照；
2. 公共DTO/profile与兼容适配；
3. B3-SR与B3-RC：来源读取与规则完整读取；
4. B3-CA与B3-PJ：帧节奏与ContentSpec；
5. B3-RP：规则呈现；
6. B3-NT/BD/FM：通知、白板账本与最终帧共同验收；
7. B3-EV：事件消费、预览与指针；
8. B3-CO：consolidate扩读取面；
9. 与4.1/4.5接口联验，5.1最后。

CO可与EV在SR可用后并行设计，共享lib/index.js的接线仍单写者串行。

## 6. 本次修订的验收口径

- 文档中的每个公共API只在一个权威层定义；
- 新旧关系、历史替代和未决边界可追溯；
- prototype与2.3/2.9/2.4/R4关系完整；
- 不把历史数字当当前事实，不把建议当用户裁定；
- 不把文档完成当模块实现，不把隔离测试当HOST通过；
- 任何代码施工仍需按L2分阶段独立验收和提交。
