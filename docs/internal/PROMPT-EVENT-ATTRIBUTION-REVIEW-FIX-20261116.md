# Prompt：2.3 接线 Lead 集成复核返工（task-28 后续）

> 日期：2026-11-16
> 工作区：D:/dsh-auto-memory
> 执行者：复用同一 DeepSeek teammate d0010608-1e39-4eaf-82cc-14de905f6ceb
> 当前基线：HEAD 55a4b2a9 + task-28 未提交改动
> 性质：Lead 审查真实 diff 后发现的接线缺陷修复；不是扩大范围，不是重新设计。

## 1. 已独立复跑且保留的成果

- 专项 67 PASS / 0 FAIL；r26 26 PASS / 0 FAIL。
- 9 个模块与 facade 方向保留，lib/index.js 仍只做薄接线。
- 行尾实测：无 CRCRLF；唯一 bare CR 在 HEAD 同位置已存在，不是本批新增。用 git -c core.whitespace=cr-at-eol diff --check 检查本仓 CRLF 口径。

不得整批回滚。以下按缺陷逐项修。

## 2. 阻断一：真实 checkpoint.goal/state 没有被读取

lib/event-attribution/candidate-pool.js:56-94 当前只读 checkpoint.panels，回退读 event.text。真实工具 schema（lib/index.js:26282）与 event-write/handoff-write 使用 checkpoint 直接字段 goal/state/dead/next，且 checkpoint.text 也存在。

必须修：
1. 直接支持 checkpoint.goal / checkpoint.state，保留 panels 兼容。
2. 无 goal/state 时回退 checkpoint.text，不是 event.text。
3. 保留 name+summary+goal/state 优先级、证据预算与 LOOCA。
4. 新增真实形状用例：{name,summary,checkpoints:[{goal:'G',state:'S',text:'T'}]}，断言 G/S 进入证据；另一个只有 text 的 checkpoint 回退正确。
5. 不能用 panels 夹具替代真实形状；这是当前 67 测试未覆盖的生产形状。

## 3. 阻断二：目标不可见与模型真正否决混为一谈

reviewer.js:170-177 当前只要 attrDecision=attach 且模型选择不同，就打 SUSPECT_AUTO_ATTACH。如果 attrEventId 被 maxCandidates=12 截掉，模型根本看不到当前目标，会产生误报。

必须修：
1. 分开 focusEventId（正在复核的当前目标）与 excludeEventId（记录自身/自引用）。
2. 当前 attach / 显式 review 的目标若在 eligible 中，应在预算内强制保留一个可见槽位，不能因 top-K 被静默排除。
3. 目标不在 eligible 或确实不可见时：
   - 使用现有 EXPLICIT_TARGET_NOT_IN_POOL；
   - 不得打 SUSPECT_AUTO_ATTACH；
   - 不得把“看不到目标”说成模型否决；
   - 决策按证据为 ambiguous/unavailable，理由写清。
4. reviewExplicitPre 必须传入当前目标的复核上下文（attrDecision=attach / attrEventId），不能只排除显式 ID 后做无目标判断。
5. 新增至少三例：
   - 目标是第13个候选、max=12，模型同意当前目标 ⇒ 不误报；
   - 目标可见、模型明确选另一事件 ⇒ 才允许 suspect-auto-attach；
   - 目标不在 eligible ⇒ explicit-target-not-in-pool 且不是 suspect-auto-attach。

## 4. 阻断三：历史提案只有 facade，没有真实入口

lib/index.js 当前 diff 只有 memory_log/memory_note/import，没有 proposeRegroupPre，也没有 event-curate 的 propose 分支。仅 svc.proposeRegroup 存在不等于 2.3 历史零写提案已接线。

必须修：
1. 在 engine 上提供只读 proposeRegroupPre(opts)（或等价公共方法），真实调用 R1/R2/R3 + facade。
2. 在现有 event-curate POST 增加明确 op='propose'（或等价）分支，不新增 HTTP 路由。
3. dryRun 只预览 R2 prompt，不调模型；实际 propose 可调用宿主模型，但不写记忆/账本/事件。
4. 不调用 curateUnarchivedPre 的写侧、writeCuratedEventsPre、applyRegroupPre，不发/不改 _curateToken。
5. 保留原 curate 与 candidateIds+confirmToken 的既有分支行为。
6. 测试必须走到实际 engine 方法/现有 HTTP 分支，不只直接调 facade；断言写原语/apply/token 调用 0 次、R1/R2/R3 真调用、输出含机械建议/prompt/badNames/cost/AI提案。

## 5. 阻断四：lib/index.js 新接线缺少正向真执行证明

现有专项主要直接测 facade，旧 13 个抽取套件因没有模块绑定走跳过路径，因此并未证明新 import 后的 memory_log/memory_note 真正工作。

必须补：
1. 用现有括号配平/new Function 抽取方式，显式注入 createEventAttributionServicePre 与 createHostModelPortPre，执行真实 memory_log：
   - dryRun 返回模型建议且事件/日志字节不变；
   - 真实 create/弱 attach 的写入不被模型重定目标，回执含提醒；
   - 显式 eventId 真写不调用模型。
2. 执行真实 memory_note(attributionReview:true)，模型返回后正文/账本/PLAN/维护文档/事件字节不变。
3. 不能用“facade 直接调用通过”替代这些工具级测试。
4. 若抽取夹具缺新依赖，只补桩，不改产品以迎合夹具。

## 6. 协议补齐：requested 与 resolved 分开

reviewer.js 当前 requestedProvider/requestedModel 永远 null，失去任务书要求的请求配置追踪。
- host-model port 可提供 requested（从 engine.config.subagentProvider/subagentModel 读取，缺失为 null）；
- reviewer 写入 requestedProvider/requestedModel；
- resolvedProvider/resolvedModel 在 runSubagent 未观测时仍 null，不猜测；
- 测试有配置与无配置两种。

## 7. 验收与交付

1. 保留原67项并新增上述真实用例；每项有负路径。
2. 重跑：专项、v4-event-attr-receipt、v4-h1b、regroup R1/R2/R3、r26、受影响套件、verify-docs。
3. 单独复核原 impact 红灯：issue368-write-contract-negative、switch-decouple、r4-p4-3-brief-scan；不得沿用旧归因而不复跑。
4. 完成后再跑 impact-run；全量未跑须如实写。
5. 追加报告 docs/internal/RESULT-EVENT-ATTRIBUTION-IMPLEMENTATION-20261116.md 的 Lead 返工段，列出每项根因/修法/真实测试/未验边界。
6. 更新 artifacts/_event-attribution-implementation-20261116/ 的指纹与日志。
7. 保持模块化/API化、22/86/181、CRLF/LF原格式、lib/index.js既有导出数不变。
8. 不接2.4/Sidecar facade、不改前端、不装依赖、不重启19387、不commit/push。

完成后读取 team_task_get 按当前revision完成，并给Lead真实数字。不要只回报“已修”，必须提供实际工具入口测试证据。
