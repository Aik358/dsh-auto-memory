# M7 Activation Feature v2 Shadow Agent Prompt

工作区：D:/dsh-auto-memory

你只负责 M7-8 Phase F 后续的 activation feature v2 设计实现和离线校准。本轮不得进入 active canary，不得修改 M5/M6 validator、Reference Tail、delivery/seen、生产默认配置，不得重启 3080。

开始前阅读：
1. docs/M7-ACTIVATION-FEATURE-DESIGN.md
2. docs/M7-ACTIVATION-CALIBRATION.md
3. docs/M7-ALGORITHM-DECISION.md
4. docs/M7-RESEARCH-PAPER.md
5. docs/PYTHON-SIDECAR-CONTRACT.md §19.8/§19.9
6. docs/M7-AUTONOMOUS-STATE.md 与 artifacts/m7-autonomous-pre/state.json
7. artifacts/m7-live-pre/calibration-cal20260824-1855/
8. artifacts/m7-live-pre/label-review-cal20260824-1954/
9. python/worker_semantic_pre_v1.py
10. smoke-test-m76-pre.mjs、smoke-test-m77-pre.mjs

先运行 git status --short --branch。保留所有既有修改和未跟踪文件；不要 reset、checkout、clean、add、commit、push、tag、publish。

当前硬事实：58 条人工 gold 已导入，activate=22、prefetch=19、suppress=17；当前 tOn=0.62/tOff=0.52 下 echo suppress 可能错误 emit；阈值网格无法在不改特征的情况下同时满足 precision-first 和 usable recall；M7 当前 tested not live。

M7-2 BGE-M3、D6 hybrid、三重 scope 过滤、correction hard-drop、rerank deferred、graph skipped 保持不变。不要重新选择 embedding，不要重新做 graph/reranker。

任务：

A. 实现 activation_features_pre_v2 shadow-only：
- echoRisk：词汇/文本近重复 + dialogueAct + recallIntent + taskNeed + toolFailure；高置信生活 echo suppress，明确 recall/taskNeed 不误伤。
- recallIntent：一期高精度中英词典/句式；二期小型 calibrated classifier，禁止在线大模型依赖。
- dialogueAct/taskNeed：question、recall_request、action_request、error_report、planning、statement、acknowledgement、correction、other；taskNeed=none/optional/required。
- proactive margin/uniqueness gate；explicit recall lane 允许较低 margin但仍需 fresh/in-scope。
- repetition persistence：per-session topic/entity fingerprint、衰减计数、failedAttemptCount；不升级生活 echo。
- fusedScore/lexicalExact 不重复计权 D6；公式可重算并绑定 policyVersion。

B. 离线研究 arm，不默认接同步生产路径：MMR 去冗余；NLI/entailment echo 特征；SetFit/Snorkel 弱监督；CalibratedClassifierCV/isotonic 与 MAPIE coverage-risk。每个 arm 独立 runId/configHash。

C. 禁止：调低 tOn/tOff 制造 emit；切 mode=active；改 M5/M6/JS Host；启动 GPU/reranker/model-sparse/graph 生产路径；在线修改 policy；让 cluster membership 单独 emit；让 correction 正向加分。

D. 数据：读取 58 human gold、silver/edge cases、activation-shadow 和 calibration artifacts。train/dev/test 按 session/seed/pair 分组，禁止泄漏。新 counterfactual 必须标 synthetic/derived、parent memory/episode、generator、sourceDigest。重点覆盖生活 echo、明确中英文 recall、statement/recall pair、tool failure/repetition、correction/stale/wrong scope/PII、cross-workspace advisory。

E. 校准：新 policyVersion 使用 activation_features_pre_v2 或更高；shadow replay 后输出 threshold grid，不能写生产配置。目标 actPrecision >=0.7、harmfulEmit=0、correction/wrong-scope/stale leakage=0、跨语言独立统计。达不到则输出 feature_not_separable 或 insufficient_gold_for_active，继续 shadow。

F. 产物：
- docs/M7-ACTIVATION-FEATURE-DESIGN.md 实施证据与偏差。
- docs/M7-ACTIVATION-FEATURE-CALIBRATION.md。
- artifacts/m7-live-pre/feature-v2-<runId>/labels.jsonl、metrics.json、threshold-grid.csv、error-analysis.jsonl、provenance-manifest.json。
- docs/M7-AUTONOMOUS-STATE.md 和 artifacts/m7-autonomous-pre/state.json 原子更新。

G. 测试：生活 echo 全 suppress；中英文 explicit recall；同主题 statement/recall pair；margin/uniqueness；repetition 只升级 prefetch；correction/ignored/stale/wrong scope/PII hard gate；cross-workspace advisory default off；classifier session-group split；policy replay deterministic；no online mutation。

完成后运行 Python tests、py_compile、现有 26 项回归和新增专项测试，保存 runId/configHash/device。只报告新特征对 separability 的影响、失败样本和 active 门状态；无论结果如何保持 shadow 和默认关闭。

## 【实施前强制修订】（主 Agent 评审 2026-08-25 附加，与上文冲突时以本节为准）

1. 决策顺序必须是：JS/M7 硬门 → lane 判定 → explicit/proactive 各自规则。echoRisk 只在 proactive lane 作 hard veto；明确 recall request 不得因文本复述而被提前 veto。

2. 新建独立 `python/m7_activation_features_pre_v2.py`，不要把全部特征逻辑内联堆入 worker。旧 activation v1 保留用于回放与 fallback。

3. 学习头导出为可审计 JSON，不得在生产加载 pickle/joblib：至少含 feature schema、vocabulary/IDF、coefficients、intercept、calibration、runId、goldDigest、configHash、parentPolicyVersion。

4. policy 命名固定区分：
   - activation_features_pre_v2
   - recall_intent_lr_pre_v1
   - activation_policy_pre_v2
   不得用实验别名 v3a 作为 wire policyVersion。

5. 建立不少于 20 条边界样本的逐字段 online-vs-OOF golden parity 测试；不仅比较整体指标。归一化、缺失值、浮点和分词差异必须 fail closed。（边界 fixture 可从 86 gold 中按 |intentProb−τ|≤0.10 与 |pEmit−0.65|≤0.15 选取，另含全部 echo/harm/relay 家族代表。）

6. completeness gate 输出 requiredTargetCount/resolvedTargetCount/status(complete|partial|unknown)。partial 或 unknown 最多 prefetch。对比/枚举词典仅作一期保守检测，不得作为永久唯一依据。

7. repetition 在本轮只做 feature logging；允许 suppress→prefetch，禁止仅凭 2 次失败或 3 次提及直接 activate。生活/闲聊 topic 永不升级。

8. 本轮不得宣称 crossWorkspaceRecall 或 sensitiveMemoryMode 已产品化。它们属于 JS 的 index_sync/context_push 前置授权层。Python 只能读取 JS 显式发送的 policy 字段，缺失时 fail closed，并输出 requiresCrossWorkspaceRelay / PII class 供后续 JS 阶段使用。

9. held-out active 门增加最小支持量：activate gold ≥15、predicted emit ≥8、中文/英文各有正例；同时报告 precision CI 与 activation coverage。未满足时继续 shadow，即使 point estimate precision≥0.7。

10. τ=0.70 仅写入 shadow candidate policy，不修改生产默认 tOn/tOff，不切 active。新 policy 必须有 parent、diff、goldDigest、runId、configHash 和 rollback 信息。

完成后停止在 held-out shadow 操作清单，不执行 3080 重启或 active canary。
