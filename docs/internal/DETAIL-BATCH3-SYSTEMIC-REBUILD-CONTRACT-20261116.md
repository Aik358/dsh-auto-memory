# 批次3系统化重建契约：投递系统模块化/API化重写

> 日期：2026-11-16
> 性质：施工契约与架构定稿；基于既有调查、交叉审计、用户裁定与task-30/31/32复核。
> 本文件内联到总体施工大纲，作为批次3重建的统一契约。不是新方向讨论，不改生产代码。

## 1. 总体纲要

以**系统化、模块化、API化**的方式重写相关投递系统。

原因：当前投递系统存在数量较多且杂乱的复杂性耦合，规则读取、档位选择、白板/账本裁剪、事件消费、通知消费、预算计量和最终回调相互穿插，导致功能紊乱、证据断层与验收假绿。

本次不是继续堆内联条件，也不是重新讨论是否需要重建；是把既有调查结论落成可测试、可回滚、可接线的模块与公共契约。

## 2. 既有依据与效力

- 注入施工准则与 R1–R7：摘要指针、legacy少给、human_full低频全量、维护块位置、50%水位默认关、总量上限生效、特殊档保留。
- Codex/DeepSeek交叉审计：规则全文截断、两层读取缺口、预算非硬门、通知预消费、plan/ledger预截断、最终账不一致。
- 模块化/API化调查：Sources/Readers、Projection/Policy、Envelope/Budget、Notification/Delivery 的接口建议与负路径。
- 第二批复核：2.3与2.5–2.9已提供来源证明、摘要指针、事件身份与只读提醒；2.4仍冻结。
- 3.0解耦：旧编号只保留溯源，施工统一使用 B3-RC/RP/FM/NT/BD/CB/EV。

## 3. 重建目标与非目标

### 目标

1. 把读取、投影、预算、通知、最终投递拆成职责明确的模块。
2. 所有公共入口有稳定 DTO、版本、来源证明、错误与降级信息。
3. 最终帧是唯一计量与定稿对象，候选渲染不得提前消费。
4. 模块可独立真 import/构造/调用，支持隔离负路径与变异。
5. 旧接口通过薄适配兼容，生产接线与真实HOST另行验收。

### 非目标

- 不改2.4真实归并，不迁移/删除真实记忆。
- 不在本批训练模型、引入RL或新模型依赖。
- 不在本批改前端、生成器或lib/client.js。
- 不用静态源码命中、空输出或未调用工厂冒充验收。

## 4. 模块与公共API契约

### 4.1 Sources / Readers

`readInjectionSourcesPre({paths,state,policyVersion}) → {rules,events,plan,handoff,reflections,logs,proofs,warnings}`

- 只读，不写事件、白板、账本、记忆或配置。
- 返回来源身份、相对路径、bytes、raw/normalized SHA、revision。
- 区分 missing / empty / unreadable / invalid，不静默转空。
- 规则读取必须覆盖 user+project；完整正文与指针读取分离。
- `parseWaterPctThresholdsPre` 等纯函数进入明确内部模块；通过真实回调验证最终行为，只有确实需要外部调用才纳入公共 facade。

### 4.2 Projection / Policy

`projectInjectionPre({sources,tier,frame,config}) → {candidates,notifications,policyVersion}`

- 纯函数；候选带 id/kind/bucket/priority/text/sourceIdentity/contentVersion。
- 档位、full/slim视角、特殊档策略只在此层决定，不散落各模块。
- 各内容段可有不同名单，不能为统一名单改变语义。
- 画像只使用 accepted/used 与 authorResponse 结构化来源。
- 事件归属只消费2.3的proposal-only建议，不在此层自动attach/merge/archive。

### 4.3 Envelope / Budget

`composeFinalEnvelopePre({candidates,tier,budgetPolicy}) → {text,chars,segments,dropped,truncated,degradations,unresolved}`

- 标题、分隔符、降级尾巴、通知、反思先成为段，再统一计量。
- 最终文本长度、总账、分桶账、最终段长度必须一致。
- 候选账与实际投递账分离；最终选帧每请求只记一次。
- 同时记录JS字符数与UTF-8字节；token未实测不得冒称。
- 未定边界以 unresolved 显式返回，不把只记录超额写成硬上限。

### 4.4 Notification / Delivery

`prepareNotificationPre(scanResult) → {id,version,payload,commitToken}`

`finalizeInjectionPre({requestId,text,prepared}) → {text,finalizeReceipt,selectedNotificationIds}`

`commitNotificationPre({requestId,finalizeReceipt}) → {committed,skipped,errors}`

- prepare只读，不消费、不清状态、不写水位、不发通知。
- finalize只定稿插件文本，不冒充宿主已交付。
- commit只提交最终保留的通知身份与版本，旧commit不得清掉新待办。
- 同请求重复调用保持幂等，写盘失败可重试。

### 4.5 Event Views / Board Docs

- B3-EV负责四段消费、检查点首尾/动态预览、事件展开与定位。
- B3-BD负责白板/账本按节选择、去2000预截断、保尾部失败原因与下一步。
- 两者服从B3-FM最终预算，不另建平行预算。
- 2.5负责白板生成/更新，B3只负责选择与投递。

## 5. 公共数据契约

- SourceProof：sourceRef/bytes/rawSha256/normalizedSha256/revision。
- ProjectionCandidate：id/kind/bucket/priority/text/sourceIdentity/contentVersion。
- PreparedNotification：id/version/payload/commitToken。
- DeliveryReceipt：requestId/finalizedText/selectedNotificationIds/committed/skipped/errors。
- 所有DTO可JSON序列化，不含函数、Map、循环引用；输入不可变。
- 所有返回带稳定身份、来源证明、错误码与降级信息。

## 6. 已裁定约束与协调边界

### 已裁定，直接作为施工约束

- 摘要档规则只投一行指针。
- human_full给完整有效正文，不逐条200截断；低频投递接受全量。
- 50%水位默认关闭，25%保留；显式off/0保留。
- 总量上限必须生效，不新增预算配置键。
- legacy少给；snapshotSlimMaintain只在human_slim。
- handoff_carry/hang_compensate保留，未经调查不得删除/合并/改触发。
- 2.4真实归并继续冻结；5.1铭文最后实施。

### 施工协调项，不等于重新讨论方向

- full/slim各段的章节选择、来源与最终预算须由同一profile决定。
- full/压缩与总量上限的协调须通过最终帧验收闭合。
- 8000与段级/整帧的关系须在FM契约中显式声明。
- 旧配置迁移不得覆盖显式禁用或自定义阈值。
- 检查点段级策略须与最终帧预算联验。

## 7. 依赖与施工顺序

1. B3-CB：先修恒真断言、真实回调、固定语料/请求键/时序与变异。
2. 公共DTO/profile：先冻结数据与政策边界。
3. B3-RC：完整读取先于B3-RP指针切换。
4. B3-NT/B3-BD/B3-FM：按同一最终帧契约实施并联调。
5. B3-EV：事件消费侧服从FM，不另建预算。
6. 与4.1/4.5做接口联验；5.1最后。

`lib/index.js`始终单写者；独立模块可并行设计/测试，但不能并行改共享入口。

## 8. 验收与回滚

- 真import、真构造、真调用、断言返回值或副作用。
- 每项有负路径与隔离变异，先断言锚点命中。
- 覆盖空输入、长输入、跨层、非法枚举、缺失/不可读、重复请求、失败重试。
- 每单位独立交付：实现、测试、文档、锁/指纹、回滚。
- 不把PASS外推为真实HOST/生产通过。
- 回滚只撤本单位的适配与实现，不删除真源或无关改动。

## 9. 当前状态

本文是总体施工大纲的内联契约，下一步是B3-CB与公共契约实现；尚未因此改生产代码、启动HOST或发布。
