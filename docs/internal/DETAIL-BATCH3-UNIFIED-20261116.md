# 批次3测绘与依赖大纲（L3 · Lead全量审核修订版）

> 版本：2026-11-17
> 层级：L3证据、代号溯源与未决边界，不再定义公共API或profile。
> 权威：模块/API/DTO以L1 = DETAIL-BATCH3-SYSTEMIC-REBUILD-CONTRACT-20261116.md为准；施工步骤以L2 = DETAIL-BATCH3-IMPLEMENTATION-SEQUENCE-20261116.md为准。
> 全量审核：REVIEW-BATCH3-LEAD-FULL-AUDIT-20261117.md。

## 0. 为什么旧3.0.x不能直接映射

两套旧文档有5/7编号错位，且同一编号还跨不同职责：

| 旧编号 | 施工细则 | 进度报告 | 判定 |
|---|---|---|---|
| 3.0.1 | 规则指针与完整读取 | 规则指针与完整读取 | 对齐 |
| 3.0.2 | 完整规则与维护提醒 | 精简档位修正 | 错位 |
| 3.0.3 | 水位默认值一致 | 通知消费与定稿 | 错位 |
| 3.0.4 | 总预算与最终计量 | 最终预算与最终计量 | 对齐 |
| 3.0.5 | 定稿与通知可靠性 | 白板/账本裁剪 | 错位 |
| 3.0.6 | 白板与账本裁剪闭环 | 真实回调与消费证明 | 错位 |
| 3.0.7 | 真实回调与回归基础 | 联机通知与默认关闭 | 错位 |

进度报告3.0.3还同时包含水位记账时机，不能按文档编号或旧行号归并。noticeRemoteEnabled被错误归位为3.0.7，但细则明确不属于本批，且当前lib中0命中，继续默认关闭并另立规格。

## 1. 新语义代号与旧内容的联系

| 代号 | 职责 | 主要承接的存量研究 |
|---|---|---|
| B3-CB | 真实回调与回归 | 真实apply/context、恒真断言修复、旧缺陷变异 |
| B3-SR | 全来源读取 | Sources/Readers、来源证明、unreadable分层 |
| B3-RC | 规则完整读取 | user+project、rule/note/retired、旧CAS/expect/revision |
| B3-CA | 帧节奏 | 首帧/真人/运行、25/50水位、压缩、间隔、特殊档与幂等 |
| B3-PJ | 内容策略 | ContentSpec、档位、full/slim视角、候选投影 |
| B3-RP | 规则呈现 | 摘要指针、human_full完整正文、legacy少给、维护块位置 |
| B3-BD | 白板/账本 | 按节选择、去2000预截断、尾部失败与下一步 |
| B3-FM | 最终计量 | 分桶、尾巴、最终total、候选/实际分账 |
| B3-NT | 通知定稿 | prepare/commit、旧版本保护、写盘失败重试 |
| B3-EV | 事件视图 | 四段、检查点、目录、定位与来源指针 |
| B3-CO | Consolidation | 日志+事件+白板+账本+反思，prompt与写入分离 |

新增B3-CA、B3-CO并拆分B3-SR/B3-RC，是Lead全量审核后的订正：避免把节奏、读取和工作流重新揉成一个耦合中心。

## 2. 当前依赖图

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

- CB为唯一无前置的施工入口；
- RC完整读取先于RP指针切换；
- CA决定何时给，PJ决定给什么，FM决定最终如何计量；
- CO可在SR后并行设计，但写入路径与EV分开；
- lib/index.js单写者，不并行修改共享入口。

## 3. 存量研究的正确用法

### 3.1 前期测绘与审计

- MASTER-PLAN-3.0.md：分项账本、写入门与状态过滤、共用契约的历史来源；其中Phase编号与旧默认不是当前任务编号。
- CONSTRUCTION-GUIDELINE-INJECT-20261108.md：R1–R7、S项、D1–D4及旧局部修补边界；新模块化重建取代“不得抽模块”的路线限制，但保留行为约束。
- AUDIT-PROMPT-INJECT-REFACTOR-20261108.md及交叉审计：规则、预算、通知、回调和同名耦合的证据；旧数字只作当时样本。
- INVESTIGATION-BATCH3-MODULAR-API-20261113.md：Sources/Projection/Envelope/Notification分层与真实接口。
- DETAIL-BATCH3-IMPLEMENTATION-20261113.md：旧3.0–3.4 API/验收/回滚；其3.1 consolidate内容现在由B3-CO承接。
- TIER0-AND-USERFULL-EVENT-DESIGN-20261108.md与USERFULL-EVENT-DESIGN-ASSESS-20261108.md：事件指针、目录去重、全文成本与下钻证据。
- PROMPT-AND-CONSOLIDATE-20261108.md：consolidate只读日志的缺口、写回边界与未完成项。

### 3.2 历史档位与通知研究

- post_compact需同步信号、首观测基线与强制full短路；不得把历史压缩当新压缩。
- human_slim/run_slim只应走真实精简帧，不强制进入renderMemoryDynamic。
- 水位的授予、候选渲染、实际提交与宿主交付是不同事件。
- snapshotReinjectOnCompact当前已有真实消费，不能继续称死键；fullInjectOnCompact当前lib中0命中。
- handoff_carry/hang_compensate保留，是否改变内容输出用行为diff验证，默认关闭或日志零命中不是删除依据。

### 3.3 Prototype与第二批

- Prototype/SidecarStore只服务handoff/index.json派生索引，包含IndexState、JournalStorage、Markdown adapter、CAS、幂等、恢复与兼容视图。
- 37/37/0 skipped及6个变异只证明隔离工程；没有生产facade/HOST完成证据。
- 2.3已提供模块化归属建议与异常提醒，保持proposal-only；不是训练或自动归并前置。
- 2.5白板生成/更新与BD选择/投递分离；2.6/2.7/2.8写入口不改；2.9来源证明复用。
- appendEventNotePre生产代码0处，不得当成已存在基础设施。
- R4/LedgerDocSystem保持默认关闭；events.jsonl与维护文档各有独立写入语义。

## 4. 当前代码事实（施工前复核基线）

- fullInjectWaterPct='25,50'，50%默认关闭尚未实现；
- ruleSummaryPre默认max=200，human_full完整有效正文未闭合；
- snapshotSlimMaintain当前仅HUMAN_SLIM；isRulesFullTierPre仍包含LEGACY；
- plan/ledger仍有默认2000预截断路径；
- planUpdatePending在渲染前取了就清；brief候选阶段存在提前消费；
- composeFinalEnvelopePre、projectInjectionPre、collectConsolidationSourcesPre、selectEventProjectionPre等目标API未实现；
- event-render已有CHECKPOINT_QUAD_KEYS，但预览仍单向cutPre；
- lib/inject-tier.js不存在，档位逻辑与内联副本在lib/index.js；
- parseWaterPctThresholdsPre是内部const，按L1通过真实回调验证，不为测试新增导出；
- Prototype未接生产，R4默认关闭；真实HOST未做。

## 5. 未决边界与阻塞关系

| 边界 | 已确定 | 未决/施工协调 | 影响 |
|---|---|---|---|
| 预算范围与豁免 | 现有预算键需生效，不新增预算键 | 50K单位与范围、full/压缩豁免、rules/must、静态/M6/反思/诊断、旧配置迁移 | FM |
| 两份MEMORY范围 | human_full给完整有效正文，不逐条200 | 非full档继续尾部窗口、全量或只给非规则资料 | RC/RP/FM |
| 白板视角 | full关心全貌，slim关心当前任务 | 具体章节、排序、必保正文、无命中回退、当前任务来源 | PJ/BD |
| 特殊档 | 两档保留 | 公共修复是否改变输出，需行为diff | CA/PJ |
| 水位迁移 | 50%默认关、25%保留，显式配置不覆盖 | 服务端/解析/客户端真源与旧配置迁移 | CA |
| 检查点预览 | 不能只单向头截 | 300/1800/T2=2400与整帧的协调 | EV/FM |
| 事件展开 | 用eventMaxActiveInInject与目录去重 | ≤8000是段级还是整帧，展开目标与eventDigestRecentN不预设 | EV/FM |
| noticeRemote | 不属本批 | 默认关闭，另立规格 | 无 |

references语义分析是独立调查，不作为读取闭环、通知修复或漏账修复的共同前置。

## 6. 跨批接口

- 1.4/1.6：显式事件身份与L1归属边界。
- 2.3：proposal-only归属建议与异常提醒。
- 2.5：白板生成/更新与BD选择/投递。
- 2.6/2.7/2.8：只消费写入产物。
- 2.9：SourceProof、raw/normalized指纹与回读。
- 4.1：accepted/used画像来源。
- 4.5：sourceIdentity/contentVersion跨形态去重。
- 5.1：最后实施。

## 7. 证据等级

- 文档完成 ≠ 模块实现；
- 模块存在 ≠ 生产接线；
- smoke PASS ≠ HOST通过；
- 历史实测 ≠ 当前代码事实；
- 用户裁定 ≠ 已实现；
- Prototype隔离通过 ≠ 可迁移真实记忆；
- 本文只提供证据与依赖，不构成施工完成声明。
