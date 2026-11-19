# 批次3重建施工细则：分阶段、可回滚、可验证实施

> 版本：2026-11-17 · Lead全量审核修订版
> 层级：L2施工细则（施工顺序、验收与回滚的唯一权威）
> 架构/API/DTO：以L1 = DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md为准。
> 新旧关系与存量证据：REVIEW-BATCH3-LEAD-FULL-AUDIT-20261117.md。
> 状态：施工文件，尚未开始生产代码实现。

## 0. 施工顺序与硬依赖

~~~text
B3-CB
  → 公共DTO/profile与兼容适配
  → B3-SR + B3-RC
  → B3-CA + B3-PJ
  → B3-RP
  → B3-NT + B3-BD + B3-FM
  → B3-EV
  → B3-CO
  → 4.1/4.5接口联验
  → 5.1（最后）
~~~

- CB先保证测试能抓旧缺陷，不能先写业务再补假绿测试。
- SR/RC先能完整读取，CA/PJ再决定何时/给什么，RP只做呈现。
- NT/BD/FM共享最终帧，必须共同验收。
- EV服从FM；CO在SR可用后可与EV并行设计，但写入路径独立。
- lib/index.js始终单写者；共享入口的接线按顺序串行。

## 1. 开工前读取与基线

### 1.1 必须读取

1. 本L2与L1全文；
2. REVIEW-BATCH3-LEAD-FULL-AUDIT-20261117.md；
3. DETAIL-BATCH3-IMPLEMENTATION-20261113.md；
4. INVESTIGATION-BATCH3-MODULAR-API-20261113.md；
5. CONSTRUCTION-GUIDELINE-INJECT-20261108.md及A类交叉审计；
6. Prototype三份架构/评审/阻断报告；
7. RESULT-BATCH2-IMPLEMENTATION-REVIEW-20261116.md；
8. 当前lib/index.js、rules-layer.js、memory-envelope.js、event-render.js及相关测试。

其余42份直接相关文档按审核报告的索引查阅，不要求实施者重新做方向性调查，但不得只凭文件名或旧行号施工。

### 1.2 基线记录

每个单位开工前记录：HEAD、工作树、目标文件bytes/lines/export数、CRLF/LF/bareLF、sha256、相关锁与当前测试基线。写入前再次核对共享文件指纹，出现非本任务改动即停止并上报。

lib/index.js保持既有CRLF；其他新模块和测试沿用LF。不得整文件覆盖lib/index.js。

### 1.3 建议模块边界

按职责而非旧编号机械拆文件，可采用：
- injection/contract.js：DTO/profile/校验；
- injection/sources.js：SR与RC及Reader适配；
- injection/cadence.js：CA纯决策；
- injection/projection.js：PJ/RP/BD；
- injection/envelope.js：FM；
- injection/notification.js：NT；
- injection/event-views.js：EV；
- injection/consolidation.js：CO；
- injection/index.js：唯一公共facade与依赖注入。

可复用现有模块时不重复实现。目录只是建议，不是要求每个代号各建一个文件；不得形成多个公共状态源。

## 2. U1 / B3-CB：真实验收基础

### 2.1 先修已知假绿

1. smoke-test-p6a-rules-layer.mjs：提供真实renderMemoryDynamic，真调用并断言非空产品输出。
2. smoke-test-v4-h5-user-portrait.mjs：真正执行makeFn()并检查构造/返回。
3. smoke-test-batch2-2.9-wiring.mjs：
   - A24g分别证明sourceDocumentNormalizedSha256与sourceCoverageNormalizedSha256有效且来源不同；
   - C5区分真测通过与显式SKIP，删除恒真写法。

### 2.2 真实回调面

- 真import、真构造、真apply()、真context回调；
- 固定语料、requestId/turnKey、frame、时序与状态；
- 同请求双调用、下一请求、压缩、水位、预算、通知未投不消费；
- 记录候选、插件最终返回、宿主project/retained（若可观测）三层；
- 无宿主证据时HostDeliveryObservation=unknown，不伪造交付成功。

### 2.3 兼容与变异

- 盘点当前真实抽取式渲染套件，逐个选择迁移或保留兼容适配；
- 不再以“函数存在/源码有字符串”当功能证据；
- 每项先证明锚点恰命中，删除被检定义或恢复旧缺陷，测试必红；还原复绿；
- 变异在隔离副本执行，不在共享工作区就地改。

### 2.4 交付与回滚

交付真实输出、状态差异、负路径、变异日志、文件指纹。回滚只撤本单位的测试与适配，不删除旧失败断言来“修绿”。

## 3. U2 / 公共DTO、profile与适配

### 3.1 实施

- 按L1 §5冻结DTO/profile；
- 定义SourceProof、ProjectionCandidate、ContentSpec、CadenceDecision、PreparedNotification、FinalizeReceipt、DeliveryReceipt、HostDeliveryObservation；
- 所有DTO可JSON序列化，输入不可变，错误与降级可见；
- facade显式注入Reader、writer、clock、path resolver、host observer等ports；
- 纯函数不读文件、不写记忆、不调模型、不发通知。

### 3.2 验收

- 每个DTO真构造，验证默认值、非法输入、版本不符、跨层、序列化往返；
- facade真构造/真调用，缺port有明确降级；
- 不为测试方便导出内部纯函数；确需公共调用才进入facade。

### 3.3 回滚

撤新增facade适配，保留旧协议，不改真源。

## 4. U3 / B3-SR + B3-RC：来源与规则读取

### 4.1 SR

- 按L1 §4.1实现readInjectionSourcesPre；
- 组合规则、事件、白板、账本、反思、日志及SourceProof；
- 读取失败区分missing/empty/unreadable/invalid；
- 不要求Prototype提供数据，不新增事实源。

### 4.2 RC

- 按L1 §4.2实现readRulesAggregatePre；
- userFile/notesPath可缺省；candidatePath/ownerSessionId/sessionKey/readFile由调用方注入，不从全局状态猜；
- user+project完整有效正文与候选规则，多行限定不丢；rule/note/candidate/reference/retired分别计数；候选不因措辞自动升格；
- 两个bullet与单条多行规则分别断言；
- 保留applyRuleEditPre层内index/expect/revision与跨层CAS拒绝。

### 4.3 验收与回滚

- 两层完整正文、空层、缺层、不可读、非法结构分别验证；
- revision(user)与revision(project)不混用；
- 读取前后所有真源字节不变；
- 回滚只撤聚合只读适配，不改旧文件。

## 5. U4 / B3-CA + B3-PJ：节奏与内容策略

### 5.1 CA

- 按L1 §4.3实现纯决策；
- 首观测只建基线；新压缩才触发post_compact；
- 强制full不被step gap吞掉；
- 25/50授予、复位、显式off/0、自定义阈值分别验证；
- handoff_carry/hang_compensate保持触发语义，legacy fail-open；
- parseWaterPctThresholdsPre等纯函数进入内部模块，以真实回调验证最终行为，不新增导出凑测试。

### 5.2 PJ

- 按L1 §4.4冻结ContentSpec，覆盖calendar/externalMemory/workspaceMap/recentLogs/reflection/diagnostic与现有PROMPT_SECTION_KEYS_PRE_V1；新增公共面先登记，通道区整段省略须显式degradation。
- 同一sources在不同tier/frame下产出正确候选；
- 不把human_slim/run_slim送入renderMemoryDynamic；
- 画像只用accepted/used与authorResponse；2.3只作建议；
- 特殊档的内容diff单独保留，不以“保留档”名义强制输出不变。

### 5.3 验收与回滚

- 首帧、真人/运行、间隔、压缩、水位、特殊档、非法tier分别测；
- 同输入两次输出一致；状态只由适配器显式提交，纯函数不偷写；
- 回滚恢复旧决策路径，不删除历史状态或配置。

## 6. U5 / B3-RP：规则呈现

- 摘要档一行指针，human_full完整正文；
- legacy少给；snapshotSlimMaintain只在human_slim；
- note保留中性前缀，retired不误当有效规则；
- 多行、长文、跨语言、空值分别验证；
- 指针能回读两层完整内容，旧200截断与维护块错位变异必红。

回滚恢复旧渲染和维护块位置，不删除维护正文。

## 7. U6 / B3-NT + B3-BD + B3-FM：最终帧共同施工

### 7.1 NT

- prepare只读，不清planUpdatePending、不推进水位、不发通知；
- finalize只定稿插件文本与候选身份；
- commit只提交最终保留的版本，旧commit不得清新待办；
- _recallJustDelivered只由真实Reference Tail交付路径写入；
- 运行时状态带runtimeScope/sessionId，不使用无ALS上下文的默认runtime；持久写入复用现有队列/锁/CAS/原子替换，Prototype不作跨文件事务。
- 写盘失败显式报错、可重试；同请求幂等。

### 7.2 BD

- 去plan/ledger选择前的2000预截断；
- 按节/四段选择，保尾部失败原因与下一步；
- full/slim视角与无命中回退按profile，未决项不得擅自回退全文；
- 与2.5生成/更新边界分离，不改PLAN或账本原文。

### 7.3 FM

- 标题、分隔符、降级尾巴、通知、反思先成段再计量；
- 候选账与实际投递账分开；每请求只记一次；
- text.length=chars.total=分桶之和=最终段长度之和；
- 另记UTF-8 bytes；token未实测不得冒称；
- 兼容计量与硬上限政策分开，未决边界写unresolved。

### 7.4 共同反例

- 选slim、旧缓存、通知被关/裁掉/截断时不误消费；
- 第一次候选未定稿，第二次仍能取到通知；
- 旧commit遇到新version被拒绝；
- 两桶各未超但合计超、rules独超、must独超、多条诊断、反思、授予标记分别验证；
- full出口缺公共记账必须跨请求对照；
- 反思作为最终追加段单独验收，不混成候选消费缺陷。

### 7.5 回滚

只撤本单位适配；不删除已提交水位、不伪造新提交、不改真源。

## 8. U7 / B3-EV：事件视图与来源指针

### 8.1 四段与检查点

- 事件头与检查点分别使用正确字段；deadend/dead可见，空字段不输出；
- 预览保留首尾或按四段分配，最新检查点优先，省略量如实；
- 单项/段级/整帧预算与FM联验，不把300等现值写成新批准值。

### 8.2 展开与定位

- activeLimit来自eventMaxActiveInInject；
- 目录排除已展开事件，active/paused/closed/archived分别验证；
- 合法evt id与正文同时可达，非法/缺id不伪造；
- currentEventIds来自真实会话上下文；缺失时只称最近更新，不冒充当前任务。

### 8.3 来源指针

- members/rel/quoteRef/sourceRef生成指针，不直接注入整篇施工文档；
- quoteRef是引文不是路径；sourceRef可能是账本/日志；
- 路径失效显式标未解析，不静默丢弃；
- 通过memory_recall/expand或对应读取工具下钻，全文不预塞。

### 8.4 验收与回滚

1400字检查点首尾、四段全空/部分空、多语言、10个active夹具、重复id、路径失效、目录去重、最终预算分别验证。回滚恢复旧T2/预览/展开，不改事件schema或检查点原文。

## 9. U8 / B3-CO：Consolidation扩读取面

### 9.1 实施

- collectConsolidationSourcesPre：日志+事件+白板+账本+反思及证明；
- buildConsolidationPromptPre：来源计数、截断、sourceProofs；
- applyConsolidationResultPre：仅通过现有writer应用；
- 复用SR读取，不另造数据语义或事件写权限。

### 9.2 验收

- 五类来源进入prompt并可验证；
- 无日志、无事件、空文档、损坏文档分别处理；
- 统计每类输入JS字符、最终prompt字符与被裁量，不沿用历史12.7%；
- USER候选仍只进待确认区；
- 模型空正文、(无)、超时、解析异常均无新写入；
- 删除事件/白板来源或把unreadable静默为空，变异必红。

### 9.3 回滚

撤新source collector，恢复日志-only prompt；不重写或删除既有笔记，不执行2.4。

## 10. 跨批接口与存量工作使用规则

- 2.3：只消费proposal-only建议，不自动attach/merge/archive。
- 2.5：只对接白板生成/更新契约，不由BD接管。
- 2.6/2.7/2.8：只消费写入产物，不改写入口。
- 2.9：复用sourceRef/raw/normalized指纹与回读，covered不授予删除。
- Prototype：只作派生索引/CAS/幂等/恢复证据；不接模型、不决定归属/预算、不替代event-store或events.jsonl。
- R4：保持默认关闭，未完成HOST/全仓/跨设备验证不得接管真实记忆。
- 4.1：person store提供accepted/used画像来源。
- 4.5：按sourceIdentity/contentVersion去重，不按前缀自动删除。
- 5.1：最后实施。

## 11. 并行、串行与停止条件

### 11.1 并行边界

- 可并行：不同模块的独立设计、纯函数与隔离测试；不得因此并行修改同一共享契约或生产入口；
- 必须串行：lib/index.js及共享旧协议适配；
- 必须按序：CB→DTO/profile→SR/RC→CA/PJ→RP；NT/BD/FM共享最终帧共同验收；EV服从FM，CO在SR后可独立设计；
- 可并行仅限同一阶段已冻结契约下、写域不重叠的实现，例如SR与RC、独立事件纯函数、consolidate只读收集；
- NT/BD/FM共享状态与帧，不能由多个执行者并行接线；4.1/4.5/5.1不提前实施。
- 每单位先实现、测试、文档、锁/指纹与回滚，再进入下一依赖；
- 不把所有改动堆到最后统一联调。

### 11.2 必须停止并上报

- 需要改未授权的真源、生产记忆或19387；
- 需要新增公共导出、工具、路由或配置键但未获批准；
- 文档与当前代码语义冲突，无法由代码实测裁定；
- 测试未真正调用产品函数或只返回空结果；
- 宿主project/retained形状未核，准备声称已交付；
- 共享文件出现非本任务改动，无法安全归因；
- 需要改变2.4、2.3、5.1、前端或Prototype/R4边界。

## 12. 每单位交付清单

1. 实现模块与公共API变更；
2. 旧路径到新模块映射与兼容说明；
3. 真import/真构造/真调用输出；
4. 正路径、负路径、边界输入与隔离变异；
5. bytes/lines/export/sha/锁变化；
6. 回滚步骤与未验边界；
7. 与下一单位的接口说明；
8. 相关测试与verify-docs结果，未跑全量时明确说明。

不能只交“已改”“PASS”或源码命中截图。

## 13. 当前未验边界

- 目标API均未因本文而实现；
- 未启动真实HOST，未验证project/retained或生产噪声；
- 未跑全量回归；后续每阶段按影响面验收；
- 预算范围、full/slim具体视角与事件段级额度仍须按L1未决项处理；
- 本文及审核报告不代表生产已启用、已发布或真实记忆已迁移。
