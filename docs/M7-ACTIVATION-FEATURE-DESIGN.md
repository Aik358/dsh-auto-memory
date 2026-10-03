# M7 Activation Feature Design

> 状态：设计评审稿；本轮不修改生产代码、配置、阈值或 active 状态
> 日期：2026-08-24
> 前置：M0-M6 live；M7-2..M7-7.5 tested；Phase F = gold_quota_met_but_score_not_separable

## 1. 结论

BGE-M3、D6 hybrid、scope/provenance 和 M7-2..M7-7 代码继续保留。当前失败不是基础 retrieval 失败，而是 activation eligibility 与 semantic relevance 混淆：suppress 类生活记录 echo 的最高分高于 activate gold；denseTop 不表示用户正在请求历史资料；recency 因 occurredAt=null 休眠；live evidence 多数为空。因此单独调 tOn/tOff 无法同时获得 precision 和 recall。

当前状态保持：

~~~text
retrieval_quality = usable
activation_policy = not separable
active_canary = prohibited
M7 = tested, not live
~~~

新特征必须使用新 policyVersion，在人工 gold 和新增 shadow 流量上离线重放；本设计不授权 active。

## 2. 两条激活路径

Explicit Recall Lane：用户明确要求历史资料，如之前、上次、找出来、什么决定、recall、previous decision、what did we decide。要求 recallIntent 高置信、候选 fresh/in-scope、目标唯一或 margin 足够、无 correction/ignored/PII/safety 硬拒绝。可用较低语义分数，但不绕过 JS/M6 硬门。

Proactive Lane：用户没有明确要求回忆。必须有工具失败、重复尝试、未解决事项、阶段切换或多条独立任务信号。普通陈述、生活记录复述、acknowledgement 不能仅因 denseTop 高而 activate。

## 3. 特征设计

### 3.1 echoRisk

当前文本与候选正文近重复/复述的风险，不等于普通 semantic similarity。输入包括 lexical coverage、normalized text similarity、dense similarity、dialogueAct、recallIntent、candidate 是否刚由用户引入、taskNeed、toolFailure、unresolved。

高 echoRisk 初始条件：高 lexical/dense 相似 + statement/acknowledgement + 无 recallIntent + taskNeed=none。明确 recallIntent 或 taskNeed=required 时不直接 veto。落点是 Python feature layer，policyVersion 为 activation_features_pre_v2；高置信 echo 只能 suppress/prefetch。

### 3.2 recallIntent

一期用高精度中英文词典和句式，二期用人工 gold 训练小型可解释分类器。建议字符 n-gram/embedding + Logistic Regression，再用 sigmoid/isotonic calibration。SetFit、NLI、Snorkel 只做离线对照或弱标签，不能替代人工 gold。

输出 recallIntentProbability、dialogueAct、intentEvidence。Explicit recall 是 lane 选择信号，不是越权授权。

### 3.3 dialogueAct / taskNeed

枚举：question、recall_request、action_request、error_report、planning、statement、acknowledgement、correction、other。

taskNeed：none、optional、required。它回答任务是否依赖历史记忆，不等于候选是否相似。

### 3.4 margin / uniqueness / evidence

Proactive 要求 calibrated margin、candidate uniqueness 或多个任务信号；explicit lane 可用较低 margin但必须 fresh/in-scope。M5 evidence 是 boost，不是 cold-start 硬门。correction、ignored、conflict、PII、wrong scope、stale 是硬 suppress。margin 阈值由 gold 网格选择。

### 3.5 repetition / persistence

按 per-session topic/entity fingerprint 或 query embedding 相似度做衰减计数，不按重复词面简单计数。状态包含 topicKey、firstSeenAt、lastSeenAt、decayedCount、failedAttemptCount、progressSignal、lastAction。重复失败/同一未决目标可升级 suppress 到 prefetch 或 prefetch 到 activate；重复生活陈述不能升级。

### 3.6 fused / lexicalExact

D6 fusedScore 已包含 dense+lexical，不得再次把 denseTop、fusedScore、lexicalScore 无校准相加。activation 使用 fusedScore、fusedMargin、lexicalExact/code/path/error-code hit、intent、echoRisk、taskNeed、evidence。raw dense 仅用于诊断/消融。

## 4. P1-P7 裁定

| 提案 | 裁定 | 落点 | 理由 |
| --- | --- | --- | --- |
| P1 echoRisk | 修改后采纳，P0 | Python feature/policy | 高 echo + statement + 无 intent + 无 task need 才 suppress；echo gold 全 suppress，activate gold 不误伤。 |
| P2 recallIntent | 采纳，P0 | Python feature/policy | 先词典/句式，后 calibrated small classifier；做中英混淆矩阵和 session-group split。 |
| P3 margin/evidence | 修改后采纳，P0 | Python activation policy | proactive 要 margin/uniqueness；evidence 是 boost；explicit lane 单独处理。 |
| P4 repetition | 修改后采纳，P1 | Python session state | 衰减 persistence + failed attempts；close_session 清理；不升级生活 echo。 |
| P5 fused/lexical | 采纳但重构，P1 | Python feature model | 防 D6 分数重复计权；公式可重算、policyVersion 固定。 |
| P6 model-sparse | 延后独立消融，P2 | Python retrieval | 改善候选不等于解决 echo；同 gold、独立 runId/configHash。 |
| P7 GPU | 延后条件采纳，P3 | Python runtime | 只解决 latency/rerank；独立 gpu-venv，device 进入 identity/configHash。 |

## 5. 公开算法建议

MMR 用于 top-K 去冗余，不用于判断是否唤起。公式为 relevance 减去与已选候选的最大相似度。来源：[Carbonell & Goldstein MMR](http://www.cs.cmu.edu/~jgc/publication/MMR_DiversityBased_Reranking_SIGIR_1998.pdf)。

NLI/entailment 可离线比较 query 到 memory 的 entailment、contradiction、neutral，作为 echo/contradiction 特征；不要放进当前 CPU 500ms 同步路径。参考：[cross-encoder/nli-roberta-base](https://huggingface.co/cross-encoder/nli-roberta-base)。

小型意图分类优先字符 n-gram/embedding + Logistic Regression，再做 [CalibratedClassifierCV](https://scikit-learn.org/stable/modules/generated/sklearn.calibration.CalibratedClassifierCV.html) 或 isotonic calibration。SetFit 可作 few-shot 对照，Snorkel labeling functions 可作弱标签。

不确定时输出 prefetch 或 suppress，而不是强制 activate。可用 [MAPIE conformal prediction](https://mapie.readthedocs.io/en/latest/content/conformal-prediction/theory/) 分析 coverage-risk。

## 6. 系统议题

### 6.1 门控进化

固定流程：shadow -> 人工 gold -> offline replay/calibration -> policy diff -> 人工批准 -> 新 policyVersion shadow canary -> active canary -> rollback。禁止 online 自动修改阈值、权重、模型或 prompt。策略 registry append-only，保存 parent policy、diff、gold digest、runId、metrics、批准者和 rollback 版本。

### 6.2 审批工作流

先输出脱敏 Markdown/JSON 审批队列，再做 UI。展示 memoryId、sourceRef、score、echoRisk、intent、scope、freshness 和理由；A/P/S/H/E append-only；E 只能选已有 memoryId；审批不创建 AccessEvidence、不触发 M6 delivery。advisory-only 独立呈现，不能自动执行 Procedure。

### 6.3 跨工作区

建议 crossWorkspaceRecall = off | advisory | active，默认 off。off 不发其他 workspace index_sync；advisory 允许 requiresCrossWorkspaceRelay=true 建议但默认不进 Reference Tail；active 需用户 opt-in，经 JS scope、workspaceRef、PII 和 M6 硬门。用户已裁决为 P/advisory 的样本不改成永久 hard suppress。

### 6.4 PII 敏感度

建议 sensitiveMemoryMode = never | explicit_only | proactive，默认建议 explicit_only，最终由用户拍板。JS 在 index_sync/context_push 前硬过滤：never 不发送；explicit_only 仅明确搜索/回忆可用；proactive 才允许主动建议。策略进入 context/index/activation policyVersion 和 configHash。

## 7. 最小解锁路径

1. P1/P2/P3 feature v2：echoRisk、recallIntent、dialogueAct/taskNeed、margin/uniqueness、correction/PII/scope hard gate。
2. 用 58 gold 和新增边界样本离线 replay。
3. 目标 actPrecision >= 0.7、harmfulEmit=0、correction/wrong-scope/stale leakage=0，并单独报告跨语言。
4. P4/P5 再进入 shadow。
5. P6/P7 只做独立消融，不作为 active 前置。
6. 达标后才做单一受控 active canary。

## 8. 测试矩阵

1. 面条/天气/生活 echo 全部 suppress。
2. 中英文 explicit recall activate。
3. 同主题 statement 与 recall request 成对对照。
4. proactive margin/uniqueness gate。
5. repetition 升级 prefetch 但不绕过 echo。
6. correction/ignored/stale/wrong scope/PII hard suppress。
7. cross-workspace advisory flag/default off。
8. classifier session-group split。
9. policy diff/replay determinism。
10. no online policy mutation。

## 9. 落点

本文件是 activation feature v2 设计入口。冻结 D1-D11 不直接覆盖；所有实验使用新 policyVersion、runId、configHash、device 和 gold digest。本轮只完成设计，不改生产代码、配置或 active 状态。
