# 接续 Prompt：2.3 模型教师候选、可验证奖励与隔离训练（RL条件）

你是2.3归属判定器的**实验与训练Agent**。工作目录 `D:/dsh-auto-memory`。本任务接续隔离实验，不是批次3调查，也不涉及生产接线。

## 1. 目标与术语

允许使用通用语言模型作为**教师候选生成器/批判者**：提出事件归属、理由、反例、难负样本和人工复核队列。不能把同一模型自答自评称为强化学习，更不能把模型建议直接升级为训练金标。

目标是建立可复核的偏好/分类数据，并在训练门通过后评估冻结C2向量的小分类/排序器；E5/LoRA/CNN不是默认执行项。是否实际训练取决于本文件的证据门。

## 2. 必读现状与工件

- `docs/internal/PROMPT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`
- `docs/internal/RESULT-EVENT-ATTRIBUTION-BENCHMARK-20261112.md`
- `artifacts/_event-attribution-benchmark-20261112/results/training-gate.json`
- `artifacts/_event-attribution-benchmark-20261112/review/README-v13.md`
- `artifacts/_event-attribution-benchmark-20261112/scripts/`
- `artifacts/_event-attribution-benchmark-20261112/data/`（只读原始快照）

现有结果：冻结53事件/940检查点；C2 multilingual-e5-small/q8，384维；D真实24探针/19可复核，冲突0/6、closed0/5；可采纳来源验证金标0；94条弱证据attach；3个重复族跨split。E/F均未运行。

**不得修改上述原件。** 复制到新隔离目录 `artifacts/_event-attribution-teacher-20261113/`，记录所有输入/输出/模型身份/代码/日志/指纹。生产lib、真实记忆、19387、2.4、SidecarStore、2.9和批次3均保持不动。

## 3. 先做数据修复，禁止先训练

1. 按来源、真实文档members/documentId/eventIds、显式ID与可验证quoteLine/full sha补齐来源验证样本。
2. 保留历史eventId为弱标签，不把它当正确答案；冲突记录保留两侧并标needs-review。
3. 以文本规范化/近重复/共享模板识别重复族，固定同源分组；同族与eventId不得跨训练/验证/测试。
4. 建立独立真实留出集，不能与教师提示/生成/规则调参共享事件或近重复文本。
5. 四态至少覆盖：`attach-existing`/`create-new`/`ambiguous`/`not-applicable`。补充跨语言、大台账、closed、无正确候选、多候选、同文异事和非法结构。
6. 对四态/来源关联做**双人复核**，记录分歧与仲裁；不能以同一教师模型同时充当两位独立复核者。
7. 任何不足如实标0或blocked，不为凑样本造“真实”数据。

## 4. 教师模型协议

教师只看到case时刻允许的数据：正文、来源、时间、候选事件的name/summary/status、已有允许证据、标识和候选分数。不得泄漏测试标签、未来事件、隐藏正确答案或自己产生的伪理由。

候选输出：
```json
{
  "caseId": "case_...",
  "teacherIdentity": "实际provider/model/版本",
  "proposal": { "decision": "attach-existing|create-new|ambiguous|not-applicable", "eventId": "evt_...|null", "rationale": "只引用已给证据" },
  "counterHypothesis": "最强反对理由",
  "unknowns": ["缺失的信息"],
  "confidence": "high|medium|low",
  "status": "teacher-proposal-only"
}
```

教师必须给反假设；不得创建eventId、不得执行写盘、attach、merge或archive。原始回复与解析失败全部保留。

## 5. 奖励与仲裁（不是自评分）

`reward` 只由**独立可验证规则/人审**产生，不能来自教师自身置信度、长度、连贯性或另一份同模型复述。

- **正确**：人工/独立来源金标与教师decision一致，且attach的eventId合法正确。
- **错误**：把应新建误attach、closed误当可写、候选外ID、相同模板跨事件误并等，必须负奖励并保留原因。
- **不确定**：缺证据、多个合法目标或教师分歧，保留`ambiguous`，不得强行二选一。
- **安全/协议**：schema非法、虚构ID、越界、自动写入倾向均拒绝且不得奖励。
- **跨语言**：原句/译句同组切分，真实与构造样本分别报告，不能用英文同语掩盖zh→en或en→zh失败。

人工复核提供同意/驳回/纠正/原因/复核者；用户明确裁定优先于教师模型。记录`labelVersion`、证据引用与冲突状态。

## 6. 训练与RL条件

### 6.1 先小分类/排序器
只有数据门、防泄漏、正确候选和四态负路径通过，才可训练冻结C2向量+确定性特征的小分类/排序器。先与既有A/B/C/D在同case、相同候选下比较，按事件macro与micro、误挂/误新建、跨语言/大台账/closed分别报。

### 6.2 若坚持称为强化学习
必须真实现**多个可区分动作、外部奖励、策略/权重更新**，而不是对同一输出打分。动作可为`attach/create/ambiguous/not-applicable`；奖励只来自独立标签/协议门；使用明确的preference/DPO/其他算法名称，记录目标、参数、seed、步数、训练/验证/测试范围。

若只是教师蒸馏或监督分类，就如实称为监督蒸馏/分类训练，**不得冒称RL**。本任务默认优先可验证小分类器，不要求真实PPO。

### 6.3 E5微调/CNN
仅在冻结向量小模型相对融合/通用模型稳定增益且仍不足时，提交单独评估方案。无本批证据不得直接E5/LoRA/CNN；不训练不等于失败，低证据训练才是失败。

## 7. 验收与停止条件

- 金标来源/复核/四态/跨语言与困难负样本可复算；
- split按事件与重复族同时隔离，原句/译句不跨侧；
- 教师候选与真实奖励来源分离；非法ID/closed/冲突/写入均拒绝；
- 训练后真实分组留出优于基线才考虑交付，且保持proposal-only；
- 缺金标、覆盖不足或模型偏差未解决：**停止训练**，交付修复后的数据与报告，不交低证据模型；
- 所有源文件SHA不变；生产写入/归并/归档=0；不接生产、不迁移、不发布；
- 交付物完整性PASS与模型通过分开报告，不虚构成模型已可用。

## 8. 交付物

1. `docs/internal/RESULT-EVENT-ATTRIBUTION-TEACHER-20261113.md`：教师/仲裁协议、数据门、真实模型/训练结果、错误与未验边界。
2. `artifacts/_event-attribution-teacher-20261113/`：冻结副本清单、候选/奖励/仲裁记录、split manifest、脚本、原始输出、训练配置、日志与指纹。
3. 若未达训练门，明确写`trainingNotRun:true`及原因；不要伪称强化学习或微调。
4. 不commit/push，不改生产代码，不写真实记忆，不操作2.4或SidecarStore。
