# Prompt：2.3 模型独立复核、仲裁与困难负样本闭环

> 版本：2026-11-16（模型执行 / 证据约束 / 金标分级）
> 工作区：`D:/dsh-auto-memory`
> 目标：用模型完成 2.3 的独立复核、仲裁与困难负样本构造，形成可审计的标签集；**不直接训练、不接入生产。**

## 0. 结论边界

你可以使用**同一模型**分别执行教师、复核者 A、复核者 B、仲裁者和负样本构造者，但必须是**不同的新会话/独立上下文**。不同角色之间不得看到对方的结论或推理。

- 这不是两个独立的人，也不是两个独立模型；报告中必须如实写 `sameModelDifferentContexts: true`。
- 这种结构只能产出 `model-reviewed` 标签，**不能冒充双人复核或 human-reviewed 金标**。
- 若要满足原任务书“双人复核”的严格训练门，仍须两个独立人工复核者及仲裁；你不得把 `humanReview.reviewers` 伪填为 2。
- 任何输出都不得自动 attach/merge/archive，不写真实事件库、真实记忆或 19387。

## 1. 必读与隔离

先读：
- `docs/internal/PROMPT-EVENT-ATTRIBUTION-TEACHER-TRAINING-20261113.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-TEACHER-TRAINING-20261113.md`
- `docs/internal/REVIEW-2.3-TRAINING-PROGRESS-20261114.md`
- `artifacts/_event-attribution-teacher-20261113/results/training-gate.json`
- `artifacts/_event-attribution-teacher-20261113/review/review-queue-v4.json`

原始快照只读。所有新产物放在**新的隔离目录**，例如：
`artifacts/_event-attribution-review-20261116/`

不得修改原 benchmark/teacher 目录、生产 `lib/`、生产配置或真实数据；不 commit/push。记录模型 provider/model/版本、日期、输入清单、源文件 SHA-256 和每个角色的上下文指纹。

## 2. 角色与隔离规则

### R1 复核者 A / R2 复核者 B

为每个 case 各自启动**全新独立会话**：
- 只给该 case 当时允许的数据：正文、合法来源、时间、候选事件 name/summary/status、候选 ID、允许的确定性证据。
- 不提供教师答案、另一位复核者答案、隐藏金标、未来事件、调参历史或其他 case 的标签。
- 先给候选事件随机/稳定映射 ID，禁止根据模型旧印象“认出正确答案”。
- 记录两个角色实际拿到的输入指纹；若输入泄漏另一角色或教师答案，该 case 标 `invalid` 并重做。
- 同一 case 的 A/B 只能使用相同证据包，不得一个多给来源、另一个少给来源。

每个复核者输出：
```json
{
  "caseId": "case_...",
  "reviewerId": "A|B",
  "reviewerType": "model",
  "modelIdentity": "实际provider/model/版本",
  "decision": "attach-existing|create-new|ambiguous|not-applicable",
  "eventId": "evt_...|null",
  "evidence": [
    { "field": "sourceRef|documentId|quoteLine|time|status|identifier", "supports": "为什么这条证据支持或反对某候选" }
  ],
  "strongestCounterHypothesis": "最强反对理由",
  "unknowns": ["仍然缺失的信息"],
  "status": "model-review-only"
}
```

### R3 仲裁者

第三个全新会话，输入为：相同证据包 + A/B 的原始输出 + 来源证明（若有）。
仲裁者不得看教师建议或自己的先前答案；若存在这些泄漏，标 `invalid`。

仲裁规则：
1. **证据先于结论**。先验证来源内容，再判断归属；来源匹配不等于归属正确。
2. 支持、反对及未知分别列出，不能用语言流畅度或置信度当证据。
3. A/B 一致也不能自动正确；仲裁者可以驳回两者。
4. 缺证据、多个合法目标、标签协议不清 ⇒ `ambiguous`，不得强行 attach/create。
5. 非法/候选外 ID、closed 追加、未来信息、越权动作 ⇒ 拒绝。
6. 仲裁输出 `model-reviewed` 或 `needs-human-review`，**禁止输出 `human-reviewed`**。

仲裁输出：
```json
{
  "caseId": "case_...",
  "arbitration": "model-reviewed|needs-human-review",
  "decision": "attach-existing|create-new|ambiguous|not-applicable",
  "eventId": "evt_...|null",
  "sourceVerified": true,
  "attributionVerifiedBy": "model|human|unresolved",
  "labelVersion": "model-reviewed-v1",
  "reviewers": [
    { "type": "model", "id": "A", "inputSha256": "..." },
    { "type": "model", "id": "B", "inputSha256": "..." }
  ],
  "sameModelDifferentContexts": true,
  "rationale": "逐项证据结论",
  "dissent": "A/B 分歧及为何采纳/驳回",
  "status": "not-human-confirmed"
}
```

## 3. 困难负样本构造与闭环

第四个全新会话担任**对抗构造者**，不直接决定标签。

针对每个 case 生成至少一条**有证据支持的错误候选**，而不是随机挑错：
- 相似词/共享模板但属于不同事件；
- 同一产品不同阶段、时间相近但不同工作；
- 中文正文 vs 英文候选，或英文正文 vs 中文候选；
- 多候选均合理、无正确候选、closed、大台账；
- 显式 eventId 指向错误事件、同名不同事、重复文本不同 ID。

每条输出：
```json
{
  "baseCaseId": "case_...",
  "candidateType": "same-template|time-adjacent|cross-language|multi-valid|no-valid|closed|wrong-explicit-id",
  "candidate": "错误但有迷惑性的候选事件或构造文本",
  "expectedDecision": "attach-existing|create-new|ambiguous|not-applicable",
  "expectedReason": "可由独立证据证明的错误点",
  "synthetic": true,
  "sourceEvidence": ["来源及字段"],
  "status": "adversarial-candidate-only"
}
```

闭环不是“生成完就算完成”：
1. 将候选交给**没看过构造理由的** A/B 独立复核。
2. 只有独立证据证明其错误，才可作为负样本。
3. 证据不足 ⇒ `ambiguous`，不能强行当负样本。
4. 同一模板替换多个 ID 只算一个重复族；按 eventId 与重复族隔离 split，不得把同族跨训练/测试。
5. 真实负样本与构造负样本分别报告，不能把构造量当真实覆盖量。
6. 至少包含四类：误 attach、误 create、跨语言误并、closed/候选外错误。

## 4. 确定性校验门

在汇总前执行并保存结果：
- `sourceProof` 只证明来源原文指纹/字节匹配；另行记录 `attributionVerifiedBy`，不得混为一谈。
- A/B/仲裁输入文件不得含对方答案或教师答案；泄漏即该 case 无效。
- 只保留候选集合内的合法 ID；closed 不可追加；`not-applicable` 必须有协议依据。
- 任一模型输出不是合法 JSON、缺 rationale、缺反假设、虚构 ID ⇒ 不进入标签集。
- 所有 raw response 保留，解析失败如实计入，不得静默重试到“满意答案”。
- 分别统计 `model-reviewed`、`needs-human-review`、`ambiguous`、`invalid`；不得把 `humanReview.reviewers` 虚增为 2。

## 5. 验收与停止条件

只有以下全部成立，才可称为**模型复核闭环完成**：
1. 每个 case 有 A/B/仲裁三份独立上下文记录、输入指纹、输出与仲裁理由。
2. 困难负样本经独立复核验证，重复族与 eventId 不跨 split。
3. 来源证据与归属证据分开，模型审核与人工确认分开。
4. 四态、跨语言、closed、多候选和无正确候选有明确结果与负路径。
5. 真实/构造分组报告，不以教师自信或模型投票代替事实。
6. 没有真实写入、归并、归档或生产启用。

若需满足原训练门的“双人复核”，则另交两名独立人工复核者，冲突再交人仲裁；**不能声称本流程替代了该人工门**。

完成后交付：
- `docs/internal/RESULT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md`
- 隔离目录中的输入指纹、角色输出、仲裁记录、困难样本、split manifest、确定性校验报告。
- 明确 `trainingNotRun:true`（除非另行获得训练授权）；不要把模型审核闭环写成模型训练完成。
