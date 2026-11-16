# 批次3重建施工细则：按依赖顺序的模块化/API化实施

> 日期：2026-11-16
> 作用：更新并替代原有3.0/3.1类的分散施工内容；旧3.0.x仅作溯源，不作施工编号。
> 总体依据：DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md。
> 原则：系统化、模块化、API化；先验收基础，再公共契约，再分阶段接线。
> 本轮只写施工文档，不改生产代码。

## 0. 施工总序

B3-CB → 公共契约 → B3-RC/RP → B3-NT/BD/FM → B3-EV

依赖约束：
- B3-CB负责让后续测试可信；
- 公共契约负责让各模块不各写一套；
- B3-RC先于B3-RP，读取完整内容先于指针呈现；
- B3-NT/BD/FM共享最终帧，不得各自计费或提前消费；
- B3-EV服从FM，不另建平行预算。

## 1. B3-CB：验收基础与真实回调

### 目标
先修恒真断言，再建立可复用的真实回调验收面。

### 实施
1. 修 smoke-test-p6a-rules-layer.mjs：提供真实 renderMemoryDynamic，真调用并断言非空产品输出。
2. 修 smoke-test-v4-h5-user-portrait.mjs：真正执行 makeFn()，检查构造与返回，而非只检查类型。
3. 修 smoke-test-batch2-2.9-wiring.mjs 两处恒真写法：A24g必须断言两个normalized口径分别存在且来源不同；C5区分真测通过与显式SKIP。
4. 固定语料、请求键、时序与状态；同请求双调用、下一请求、压缩、水位、预算、通知未投不消费均有对照。
5. 现有抽取式套件逐个迁移或补适配，不能把未调用工厂当功能验收。

### 验收
真import、真构造、真调用、断言最终文本或副作用；删除被检定义必红，恢复后通过；旧缺陷变异必须被捕获。

### 回滚
只回滚测试适配与本单位改动，不动生产真源。

## 2. 公共契约：DTO、profile与依赖注入

### 目标
在业务实现前冻结公共数据形状与版本，避免各模块自建平行协议。

### DTO
- SourceProof：sourceRef、bytes、rawSha256、normalizedSha256、revision。
- ProjectionCandidate：id、kind、bucket、priority、text、sourceIdentity、contentVersion。
- PreparedNotification：id、version、payload、commitToken。
- DeliveryReceipt：requestId、finalizedText、selectedNotificationIds、committed、skipped、errors。

### profile
包含 policyVersion、来源身份、档位、预算单位、表示版本、降级策略。

### 约束
DTO可JSON序列化，不含函数、Map、循环引用；输入不可变。每个公共返回带稳定身份、来源证明、错误码与降级信息。纯函数不读文件、不写记忆、不调模型、不发通知。只有确实需要外部调用的函数才纳入公共facade；内部纯函数不为测试方便直接导出。

### 验收
每个DTO真构造并断言字段、默认值、非法输入与降级；序列化/反序列化保持身份；覆盖缺失、空、非法、跨层、版本不符。

### 回滚
删除新增契约适配，保留旧协议，不改真源。

## 3. B3-RC：完整读取与来源聚合

### 目标
建立user+project的完整只读读取与来源证明，先能读到，再谈指针。

### API
readInjectionSourcesPre({paths,state,policyVersion}) → {rules,events,plan,handoff,reflections,logs,proofs,warnings}

### 实施
聚合规则、事件、白板、账本、反思、日志；保留来源身份、相对路径、bytes、raw/normalized SHA、revision；区分missing/empty/unreadable/invalid；不改变旧applyRuleEditPre的层内索引、expect、revision与跨层CAS拒绝。

### 验收
两层完整正文可取回，多行限定不丢；缺层、空层、不可读分别可见；读取失败不能静默产生空全集；负路径与字节不变证明。

### 回滚
撤聚合只读适配，恢复旧读取，不动旧文件。

## 4. B3-RP：规则指针与摘要呈现

### 目标
在B3-RC可用后切换摘要档与完整档呈现，不在读取未闭环时先换指针。

### API
renderRulesForTierPre({rules,tier}) → {text,counts,chars,mode}

### 实施
摘要档输出一行指针，不投整段规则；human_full给完整有效正文，不只首行、不逐条200截断；legacy少给；snapshotSlimMaintain只在human_slim；note保留中性前缀，不冒充硬规则。

### 验收
超过200字且含多行限定的规则在human_full完整出现；摘要档指针可回到两层完整内容；human_slim含维护块，run_slim不含；旧200截断/维护块错位变异必红。

### 回滚
恢复旧渲染与维护块位置，不删除维护正文。

## 5. B3-NT / B3-BD / B3-FM：最终帧共同施工

### 5.1 B3-NT：通知与定稿

API：
- prepareNotificationPre(scanResult) → {id,version,payload,commitToken}
- finalizeInjectionPre({requestId,text,prepared}) → {text,finalizeReceipt,selectedNotificationIds}
- commitNotificationPre({requestId,finalizeReceipt}) → {committed,skipped,errors}

prepare不消费、不清状态、不写水位、不发通知；finalize只定稿插件文本，不冒充宿主已交付；commit只提交最终保留的通知身份与版本；同请求幂等，旧commit不得清掉新待办，失败可重试。

### 5.2 B3-BD：白板/账本投递

去掉plan/ledger选择前的2000预截断；按节选择，保尾部失败原因与下一步；与2.5生成/更新边界分离；full/slim视角、无命中回退与特殊档按既定契约联验。

### 5.3 B3-FM：最终预算与计量

API：composeFinalEnvelopePre({candidates,tier,budgetPolicy}) → {text,chars,segments,dropped,truncated,degradations,unresolved}

标题、分隔符、降级尾巴、通知、反思先成段再计量；最终文本长度=total=分桶之和=最终段长度之和；候选账与实际投递账分离；同时记录JS字符与UTF-8字节，token未实测不得冒称；未决边界用unresolved显式返回。

### 共同验收
选slim、复读缓存、通知被关/裁掉/截断时不误消费；两桶各未超但合计超、rules独超、must独超、多条诊断、反思与授予标记；最终尾巴也入账；每请求只记一次；旧行为变异必红。

### 回滚
只撤本单位适配；不删除已提交水位、不伪造新提交、不改真源。

## 6. B3-EV：事件消费侧

### 内容
四段消费：失败/卡点段按真实字段进入最终输出；检查点预览保留首尾或按既定策略动态分配；事件展开按id、正文、定位与数量进入同一FM预算。

### 约束
服从B3-FM，不另建平行预算；8000与段级/整帧关系必须显式写入profile；不改事件schema、不改检查点原文；不把最近更新事件冒充当前任务。

### 验收
1400字检查点首尾均可达；固定active事件夹具验证id与正文；空字段不输出；预算与最终帧联验；旧单向截断/漏段变异必红。

### 回滚
恢复旧T2/检查点预览/展开数，不改原文。

## 7. 并行、串行与接线纪律

可并行：不同模块的设计与独立测试。必须串行：所有lib/index.js改动，单写者。每个单位先完成实现、测试、文档、锁/指纹与回滚，再进入下一依赖。2.4真实归并继续冻结；5.1铭文最后；真实HOST、全量回归、生产启用另行验收。

## 8. 文档替代关系

本细则更新并替代原有3.0/3.1类分散施工内容；旧文档保留作调查与溯源，不再作为并行施工入口。若旧文档与本细则冲突，施工对象以本细则B3语义代号与公共契约为准；用户已裁定约束不得被旧编号改写；新发现的当前代码事实须先记录，再修订本细则。

## 9. 当前状态

本细则已作为总体施工大纲的施工层入口；尚未因此修改生产代码、启动HOST或发布。

## 10. 前期调查、Prototype与证据包（实施前必须读取）

本批不是从零调查，也不是让实施模型重新猜结论。以下材料是施工依据，需在动工前按职责读取：

### 10.1 总体测绘与缺陷证据

- CONSTRUCTION-GUIDELINE-INJECT-20261108.md：R1–R7用户裁定、八档实测、预算与待调查项。
- AUDIT-CROSS-ROUND1-CODEX-20261108.md：交叉审计与已修正的误判，尤其规则全文截断、两层读取缺口、通知预消费与最终账不一致。
- INVESTIGATION-BATCH3-MODULAR-API-20261113.md：现有模块接口、真实隔离调用、缺陷矩阵与目标API。
- REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md：当前代码与旧行号漂移、第二批剩余项、第三批依赖。
- RESULT-BATCH2-IMPLEMENTATION-REVIEW-20261116.md：第二批12套件335 PASS、2.3三专项133 PASS、2.9恒真断言与真实HOST未验。
- REPORT-3.0-INJECTION-PROGRESS-20261113.md：历史缺陷进度；其编号不得直接映射到本细则。

### 10.2 Prototype与既有可复用模块

Prototype/SidecarStore只负责派生索引持久化，不负责归属、档位或预算，不写Markdown正文。可复用其：
- 来源身份与sourceRevision；
- CAS/幂等/日志与只读快照；
- 负路径与错误语义；
- 但不要把它当作2.3模型训练或事件归属的前置。

既有模块的复用边界：
- rules-layer.js：保留抽取、分类、状态和两层分组；完整读取改由明确Reader提供。
- event-render.js：保留身份与分段预算；检查点预览按新契约改首尾/动态策略。
- event-write.js/event-pointer.js：复用四段、sourceRef、raw/normalized指纹与回读。
- plan-derived.js：复用同eventId的memId继承与用户区保留，不按同名认领。
- global-brief.js：复用diffBriefPre/buildDraftPre/renderBriefPre，但拆prepare/commit，禁止候选预消费。
- memory-envelope.js：复用分项账本，但最终尾巴与通知必须进入同一最终计量。
- lib/index.js：只做依赖注入与旧契约兼容，单写者，不堆业务实现。

### 10.3 证据的使用规则

- 文档中的旧行号、旧字节、旧数量只作历史证据，施工前必须按当前代码重新定位。
- “模块存在”不等于“已接线”；“PASS”不等于“HOST通过”。
- 任何新实现须给出真import/真构造/真调用证据，静态断言只作守卫。
- 发现文档与代码冲突时，先记录并修订契约，不擅自选一边。

## 11. 旧路径到新模块的迁移关系

| 旧职责 | 当前问题 | 新模块归属 | 迁移要求 |
|---|---|---|---|
| 规则摘要/全文 | 首行与200截断、两层读取不全 | B3-RC + B3-RP | 先读取，再呈现；保留旧CAS与编辑协议 |
| 白板/账本清洗 | 2000预截断，尾部失败原因丢失 | B3-BD | 先按节选择，再入FM；不先删原文 |
| 通知检测 | 候选阶段消费、UI与模型共用写状态 | B3-NT | prepare/commit分离，按最终保留提交 |
| 预算计量 | 尾巴与通知在账外，候选与最终混淆 | B3-FM | 最终段统一计量，候选与投递分账 |
| 事件正文 | 四段/检查点/展开各自为政 | B3-EV | 服从FM，保留sourceRef与事件id |
| 纯函数水位 | 内部函数难真验，默认真源分散 | 内部模块+真实回调 | 不为测试方便直接导出，需外部调用才进facade |

## 12. 施工包必须产出的内容

每个施工单位交付时必须包含：

1. 实现模块与公共API变更清单；
2. 旧路径到新模块的映射与兼容说明；
3. 真import/真构造/真调用结果；
4. 正路径、负路径、边界输入与隔离变异结果；
5. 字节数、行数、导出数、锁/指纹变化；
6. 回滚步骤与未验边界；
7. 与后续模块的接口说明。

不能只交“已改”“PASS”或源码命中截图。

## 13. 施工中的停止条件

出现以下任一情况，停止本单位并上报Lead：
- 需要修改未授权的真源/生产记忆；
- 需要新增公共导出、工具、路由或配置键但未列入契约；
- 发现旧文档与当前代码语义冲突；
- 测试无法证明被测函数真的被调用；
- 需要改变2.4、2.3、5.1或前端边界；
- 共享文件出现非本任务改动，无法安全归因。

## 14. 实施模型的最低工作方式

实施模型不需要重新做方向性调查，但必须：
1. 读取本细则与其引用的证据包；
2. 按B3-CB→公共契约→RC/RP→NT/BD/FM→EV执行；
3. 在每个单位完成后交付真实证据与回滚；
4. 不把未验的HOST/生产行为写成已完成；
5. 不擅自扩大范围，不用平行编号替代本细则。
