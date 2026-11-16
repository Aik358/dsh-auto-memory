# 批次3系统化重建契约：投递系统模块化/API化重写

> 版本：2026-11-17 · Lead全量审核修订版
> 层级：L1架构契约（公共模块、API、DTO、约束的唯一权威）
> 配套：L2 = DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md；L3 = DETAIL-BATCH3-UNIFIED-20261116.md
> 审核依据：REVIEW-BATCH3-LEAD-FULL-AUDIT-20261117.md
> 状态：施工契约，不代表功能已实现，不修改生产代码。

## 0. 效力与新旧路线关系

### 0.1 冲突裁决

1. 模块划分、API签名、DTO/profile、非目标：以本L1为准。
2. 施工顺序、每单位验收与回滚：以L2为准。
3. 历史代号、现状证据与未决边界：以L3及REVIEW-BATCH3-LEAD-FULL-AUDIT-20261117.md为索引；事实以当前代码实测为准。
4. 任何“已裁定”“建议”“当前已实现”必须分栏，不得相互冒充。

### 0.2 为什么替换旧的局部修补路线

旧CONSTRUCTION-GUIDELINE-INJECT-20261108.md曾基于局部修补风险，明确不抽inject-plan/content-render/inject-cadence，原因是抽取式测试、幂等闸和时机状态容易被破坏。

当前任务已由用户明确批准：以系统化、模块化、API化方式重写相关投递系统，解决规则读取、档位、白板/账本、事件、通知、预算和回调多套耦合的问题。因此新路线取代旧“不得抽模块”的路线限制，但不推翻旧文档中的行为语义、兼容边界和失败教训。

迁移门：必须先证明旧行为可对照、旧状态不被提前消费、旧档位兼容，再逐段替换；不得整文件重写lib/index.js或直接删除旧路径。

## 1. 总体纲要

以系统化、模块化、API化方式重写投递系统。

目标不是把每个函数拆成文件，而是形成职责明确、可独立验证、能通过公共契约协作的模块体系：

- 来源读取与规则完整读取分离；
- 帧节奏与内容策略分离；
- 候选渲染与最终定稿/交付分离；
- 最终帧统一计量；
- 事件视图与consolidate工作流分离；
- lib/index.js只做依赖注入与旧协议适配，不继续堆业务判断。

## 2. 范围与非目标

### 2.1 本批范围

- 规则、事件、白板、账本、反思、日志的读取与来源证明；
- 帧节奏、档位、ContentSpec、预算与最终计量；
- 白板/账本选择、通知准备/定稿/提交；
- 事件四段、检查点预览、目录与来源指针；
- consolidate扩读取面；
- 与2.3、2.5–2.9、4.1/4.5、5.1的接口。

### 2.2 非目标

- 不执行2.4真实归并，不迁移或删除真实记忆；
- 不改2.6/2.7/2.8写入口、2.9来源证明语义或2.3的proposal-only边界；
- 不改SidecarStore/R4存储边界，不以Prototype替代event-store.json或events.jsonl；
- 不训练模型，不引入RL或新模型依赖；
- 不在本阶段改前端、生成器或lib/client.js；
- 不用源码命中、空输出、未调用工厂或facade存在冒充功能验收；
- 不在本批实现references语义分类器或noticeRemoteEnabled；两者另立规格。

## 3. 模块代号与职责

| 代号 | 名称 | 唯一职责 | 不负责 |
|---|---|---|---|
| B3-CB | Callback | 真实import/apply/context、回归与旧行为对照 | 业务策略 |
| B3-SR | Source Readers | 全来源只读读取与SourceProof | 规则编辑、预算、归属 |
| B3-RC | Rules Complete | user+project规则完整读取与编辑兼容 | 其他来源、帧策略 |
| B3-CA | Cadence | 何时给full/slim、水位、压缩、间隔与幂等 | 内容渲染、通知提交 |
| B3-PJ | Projection & Policy | 给什么：ContentSpec与候选投影 | 何时给、最终计量 |
| B3-RP | Rules Pointer | 规则指针/摘要/全文呈现 | 读取实现、预算 |
| B3-BD | Board & Docs | 白板/账本按节选择与来源身份 | 生成白板、最终帧 |
| B3-FM | Final Metering | 最终段组装、预算与账实一致 | 提前消费、宿主交付证明 |
| B3-NT | Notification | prepare/finalize/commit与版本幂等 | 水位/压缩档位决策 |
| B3-EV | Event Views | 四段、检查点、目录、来源指针 | 自动归属、consolidate写回 |
| B3-CO | Consolidation | 扩读取、prompt构造、结果应用分离 | 事件归并、自动用户规则写入 |

B3-PJ不是RP/BD/EV的子步骤；B3-CO不是EV的子步骤；B3-CA与B3-NT不得互相代替。

## 4. 公共API契约

### 4.1 B3-SR：全来源读取

~~~text
readInjectionSourcesPre({paths,state,policyVersion})
→ {rules,events,plan,handoff,reflections,logs,proofs,warnings}
~~~

- 只读；不写事件、白板、账本、记忆或配置。
- 返回来源身份、相对路径、bytes、rawSha256、normalizedSha256、revision。
- 区分missing/empty/unreadable/invalid；读取失败不得静默转空。
- rules来自B3-RC，其他来源由各自现有Reader/适配器提供；不要求Prototype作为数据源。

### 4.2 B3-RC：规则完整读取

~~~text
readRulesAggregatePre({userFile,notesPath,candidatePath,ownerSessionId,sessionKey,readFile})
→ {rules,candidates,references,retired,counts,chars,proofs,warnings}
~~~

- 覆盖user+project完整有效正文与多行限定；rule/note/candidate/reference/retired分别计数。
- userFile/notesPath可缺省；candidatePath/ownerSessionId/sessionKey/readFile由真实调用方注入，不能从全局状态猜。
- 区分“两条bullet”与“一条多行规则”。
- 保留applyRuleEditPre的层内index/expect/revision及跨层CAS拒绝；不制造跨层统一编辑索引。
- 候选规则是候选，不因包含规则措辞自动升格；owner/session缺失时保留边界，不跨会话读取。
- revision(user)与revision(project)属于不同命名空间。
- 只读，不要求GUI编辑，不改变现有写入。

### 4.3 B3-CA：帧节奏

~~~text
decideInjectionCadencePre({state,frame,signals,config})
→ {tier,fullGranted,slimAllowed,grants,reasons,requestKey}
~~~

- 覆盖首帧、真人/运行、fullGap、slimEvery、25/50水位、post_compact、handoff_carry、hang_compensate与legacy回退。
- 首观测只建基线，历史压缩不得被当成新压缩；强制full不得被普通间距条件吞掉。
- 输入含所需事件信号；函数不直接读写state，不渲染内容，不提交通知。
- fullInjectWaterPct等纯函数放明确内部模块；通过真实回调验证最终行为，只有确有外部调用需求才纳入公共facade。

### 4.4 B3-PJ：投影与ContentSpec

~~~text
projectInjectionPre({sources,tier,frame,contentSpec})
→ {candidates,notifications,policyVersion}
~~~

ContentSpec至少包含：
~~~text
rules: none|pointer|summary|full
plan: none|core|full
handoff: none|sections|full
events: none|cards|cards+catalog
portrait: none|short|full
semantic: none|full
logs: none|tail|full
calendar: none|current|full
externalMemory: none|full
workspaceMap: none|brief|full
recentLogs: none|tail|full
reflection: none|recent|full
diagnostic: none|brief|full
maintenance: none|slim-maintain
~~~

- 纯函数；候选带id/kind/bucket/priority/text/sourceIdentity/contentVersion。
- 各段可有不同名单；不得为统一名单改变语义。
- ContentSpec覆盖tier0/rules/goal/rules/plan/handoff/events/portrait/semantic/calendar/externalMemory/workspaceMap/recentLogs/reflection/diagnostic/maintenance，并映射现有PROMPT_SECTION_KEYS_PRE_V1；扩展段须先登记，不得静默新增公共面。
- calendar/externalMemory等通道区可在超限整段省略，但省略必须产生显式degradation，不得静默。
- 画像仅使用accepted/used及authorResponse结构化来源。
- 事件归属只消费2.3建议，不自动attach/merge/archive。
- 不得把human_slim/run_slim强制送入renderMemoryDynamic；精简帧走真实精简路径。

### 4.5 B3-RP：规则呈现

~~~text
renderRulesForTierPre({rules,tier})
→ {text,counts,chars,mode}
~~~

- 摘要档一行指针；human_full输出完整有效正文，不只首行、不逐条200。
- note保留中性前缀，不冒充硬规则；legacy少给。
- snapshotSlimMaintain只在human_slim，run_slim不含。

### 4.6 B3-BD：白板/账本投影

~~~text
projectHandoffPre({planText,latestHandoffText,tier,policy})
→ {planPart,ledgerPart,sourceIdentity,degradations}
~~~

- 先按既定章节/四段选择，再交FM；不得在选择前默认2000截断。
- 保留尾部失败原因与下一步及截断标记。
- full/slim视角、无命中回退和特殊档按profile；无命中不得擅自回退全文。
- 2.5负责生成/更新白板，BD只负责选择与投递。

### 4.7 B3-FM：最终帧

~~~text
composeFinalEnvelopePre({candidates,tier,budgetPolicy})
→ {text,chars,segments,dropped,truncated,degradations,unresolved}
~~~

- 标题、分隔符、降级尾巴、通知、反思先成为段，再统一计量。
- text.length = chars.total = 分桶之和 = 最终段长度之和；另记UTF-8 bytes。
- 候选账与实际投递账分离；最终选帧每请求只记一次。
- 区分兼容计量与硬上限政策；未定的full/压缩/50K/段级/整帧边界放unresolved，不擅自定值。

### 4.8 B3-NT：通知与定稿

~~~text
prepareNotificationPre(scanResult)
→ {id,version,payload,commitToken}

finalizeInjectionPre({requestId,text,prepared})
→ {text,finalizeReceipt,selectedNotificationIds}

commitNotificationPre({requestId,finalizeReceipt})
→ {committed,skipped,errors}
~~~

- prepare只读，不消费、不清状态、不写水位、不发通知。
- finalize只产生插件最终文本与候选身份，不冒充宿主已交付。
- commit只提交最终保留的身份与版本；旧版本不得清掉新待办。
- 同请求幂等，写盘失败显式报错并可重试。
- planUpdatePending、_recallJustDelivered与CA的water/postCompact/full grant分开处理。
- 运行时状态必须通过显式runtimeScope/sessionId写入，不能使用无ALS上下文的默认runtime。
- 写入持久通知前复用现有队列/锁/CAS/原子替换；不得把Prototype当跨文件事务，也不得把多个文件写入伪装成单次原子操作。

### 4.9 B3-EV：事件视图

~~~text
projectEventSectionsPre({sections})
→ [{key,title,text}]

renderCheckpointPreviewPre({checkpoint,budget,sourceRef})
→ {text,head,tail,truncated,sourceIdentity}

selectEventProjectionPre({events,activeLimit,catalogChars,finalBudget,currentEventIds})
→ {cards,catalog,counts}

renderEventSourcePointersPre({members,checkpoints,resolvePath})
→ {pointers,warnings}
~~~

- 事件头使用goal/doing/deadend/next；检查点使用goal/state/dead/next，不混映射。
- 预览保留首尾或按四段分配；空字段不输出；不改检查点原文。
- activeLimit来自eventMaxActiveInInject，不擅自增加；目录排除已展开事件。
- members/rel/quoteRef/sourceRef只生成指针，不默认注入整篇文档；未解析路径显式标注。
- quoteRef是引文，不是路径；sourceRef可能是账本/日志，不冒充施工文档。
- currentEventIds来自真实会话上下文；没有时只称“最近更新”，不冒充当前任务。

### 4.10 B3-CO：Consolidation

~~~text
collectConsolidationSourcesPre({days,readers})
→ {logs,events,plan,handoff,reflections,proofs,warnings}

buildConsolidationPromptPre({sources,budgetPolicy})
→ {prompt,counts,truncation,sourceProofs}

applyConsolidationResultPre({parsed,writer,budget})
→ {written,skipped,errors}
~~~

- collect/build只读；apply由现有工作流写入。
- 来源含日志、事件、白板、账本、反思；unreadable不得当空来源。
- USER候选仍只进待确认区，不直接写全局用户级MEMORY。
- 不承担事件归并、四段补全或2.4；模型解析失败、空正文、超时不得产生新写入。
- 同型读取/预算/写入问题须同时审查consolidate/maintain/autoSummary，不仅修被举报路径；scope/默认不扩写不等于三者均可改生产。

## 5. 公共DTO与profile

### 5.1 DTO

- SourceProof：sourceRef、bytes、rawSha256、normalizedSha256、revision。
- ProjectionCandidate：id、kind、bucket、priority、text、sourceIdentity、contentVersion。
- ContentSpec：§4.4所列枚举及必要预算/来源字段。
- CadenceDecision：tier、fullGranted、slimAllowed、grants、reasons、requestKey。
- PreparedNotification：id、version、payload、commitToken。
- FinalizeReceipt：requestId、textSha256、selectedNotificationIds、preparedVersions、hostObservation。
- DeliveryReceipt：requestId、finalizedText、selectedNotificationIds、committed、skipped、errors。
- HostDeliveryObservation：requestId、projected、retained、observedAt、evidenceRef；未观测时明确unknown，不得伪造hostDelivered。

所有DTO可JSON序列化，不含函数、Map或循环引用；输入不可变。公共返回带稳定身份、来源证明、错误码与降级信息。

### 5.2 profile

单一policyVersion，另含来源身份、档位、预算单位、表示版本、降级策略。早期多个平级版本字段仅作该profile的组成信息，不另建平行协议。

## 6. 已裁定、建议与当前事实

### 6.1 已裁定约束（不等于已实现）

- 摘要档规则只投一行指针；
- human_full给完整有效正文，不逐条200，低频可接受全量；
- legacy少给；snapshotSlimMaintain只在human_slim；
- 50%水位默认关闭，25%保留，显式off/0及自定义配置不被覆盖；
- 总量上限需生效，不新增预算配置键；
- handoff_carry/hang_compensate保留，未经行为diff不得删除/合并/改触发；
- 通知只提交最终保留内容；
- 2.4冻结，5.1最后实施。

### 6.2 当前代码事实（2026-11-17复核）

- fullInjectWaterPct仍为'25,50'；ruleSummaryPre仍默认max=200；
- snapshotReinjectOnCompact已有真实消费；fullInjectOnCompact在lib中0命中；
- snapshotSlimMaintain当前仅HUMAN_SLIM分支；isRulesFullTierPre仍包含LEGACY；
- CHECKPOINT_QUAD_KEYS已存在，预览仍单向cutPre；
- collectConsolidationSourcesPre/selectEventProjectionPre/composeFinalEnvelopePre/projectInjectionPre等目标API当前未实现；
- lib/inject-tier.js不存在，档位及内联副本在lib/index.js；
- Prototype只有隔离工程证据，生产facade未接入；R4默认关闭。

### 6.3 不得擅自定案的边界

- 50K单位与范围、full/压缩豁免、rules/must超额、静态/M6/反思/诊断计费及旧配置迁移；
- 两份MEMORY在非full档的范围；human_full的R3不自动推广到其他档；
- 白板full/slim具体章节、排序、无命中回退与当前任务来源；
- 8000/1800/300/T2=2400等是现状或建议，不是新批准值；
- 事件展开数量、eventDigestRecentN等不得写成既定实现；
- references语义分析与noticeRemoteEnabled独立。

## 7. 既有模块与Prototype复用边界

- rules-layer.js：保留规则抽取、分类、状态、两层分组和编辑兼容。
- event-render.js：保留身份、T0/T1/T2与分段预算；预览和指针按本契约扩展。
- event-write.js/event-pointer.js：复用四段、sourceRef、raw/normalized指纹与回读。
- plan-derived.js/plan-render.js：复用同eventId的memId继承与事件投影；BD不接管生成。
- global-brief.js：复用diffBriefPre/buildDraftPre/renderBriefPre，拆prepare/commit。
- memory-envelope.js：复用段/桶/优先级账本，尾巴与通知进入最终计量。
- Prototype：只复用派生索引、CAS、幂等、恢复与sourceRevision思想；不接模型、不决定归属/预算，不写Markdown正文。
- 2.9：复用来源证明；covered不授予删除或迁移权限。

## 8. 跨批接口

- 1.4/1.6：使用显式事件身份与L1边界，不改自动归属。
- 2.3：只消费proposal-only建议与提醒。
- 2.5：白板生成/更新与BD选择/投递分离。
- 2.6/2.7/2.8：只消费其写入产物，不改写入口。
- 2.9：复用来源证明与回读。
- 4.1：person store提供accepted/used画像来源。
- 4.5：以sourceIdentity/contentVersion支持跨形态去重，不按前缀自动删除。
- 5.1：待投递与联动稳定后最后调整铭文。

## 9. 实现与验收约束

- 先B3-CB，再公共DTO/profile，随后按L2分阶段实施。
- 旧接口通过薄适配兼容；不得整批回滚或直接删除旧行为。
- 每项真import/真构造/真调用、负路径、隔离变异、物理指纹与回滚。
- 插件最终文本、宿主project/retained与真实生产效果分开验收。
- 本文完成不代表任何目标API已实现，不代表HOST或生产通过。
