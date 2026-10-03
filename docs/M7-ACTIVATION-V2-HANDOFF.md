# M7 Activation v2 移交文档（校准 Agent → 主 Agent 实现）

> 日期：2026-08-24 · 作者：校准 Agent（ox-alpha）
> 性质：**移交与实施依据**。设计权威=`docs/M7-ACTIVATION-FEATURE-DESIGN.md`；
> 算法扩展参考=`docs/M7-ACTIVATION-ALGO-REFERENCES.md`；本文档记录资产、已批准
> 策略与剩余条件。实现入口=`docs/M7-ACTIVATION-FEATURE-AGENT-PROMPT.md`。

## 1. 现状一页纸

- Phase E 通过（真实 BGE-M3 全链路）；Phase F 判定演进：
  `insufficient_gold_for_active` → **`gold_quota_met_but_score_not_separable`**
  → 经 feature v2 拟合 + P3 完整性门，**验收门在离线重放中全部通过**（§3）。
- **人工 gold 共 86 条**（activate 38 / prefetch 29 / suppress 19），三批用户裁决
  合并；另有 4 条跨工作区 relay 样本挂议题③a、2 条敏感度样本挂议题③b。
- 生产默认全程未动；无 active 流量；M7 维持 tested-not-live。
- syncTimeoutMs=120s 重试风暴修复已由主 Agent 完成（Phase E 记录）。

## 2. 已批准的默认策略（用户逐项拍板，2026-08-24）

| # | 决策项 | 批准值 | 验收挂钩 |
| --- | --- | --- | --- |
| 1 | sensitiveMemoryMode | **explicit_only** | cal-0062/0073 转正：仅显式搜索可返回，主动提醒路径关闭 |
| 2 | crossWorkspaceRecall | **advisory**（默认） | cal-0036/0037/0055/0058 四条 relay gold 转为可验收；active 档需显式 opt-in 且过全部硬门 |
| 3 | margin δ 选择方式 | gold 网格选择，范围 [0.02,0.05] 步长 0.01，**相邻格稳定性约束** | δ_exp 与 δ_pro 分开标定；δ_pro 待 P4 任务信号落地 |
| 4 | repetition k 起点 | **2 次失败 / 3 次提及**，30 分钟衰减窗 | 口径必须对齐 JS 端既有 episodic→procedural 多次提及门；生活/闲聊话题永不升级 |
| 5 | 审批形态 | **文件队列先行**（Markdown/JSON/xlsx） | GUI 触发条件：v2 冻结后审批 >50 条/周 |
| 6 | GPU | **暂缓**（无疑义） | 未来硬前置：device 进入 identity block/configHash 并全量重建 |

策略输入落点：#1/#2 作为 JS 侧 index_sync/context_push 前的过滤与路由配置；
#3/#4 属 Python activation_features_pre_v2；#5 为 JS 管理面；全部进 configHash
与 policy registry（append-only，含 parent policy/diff/gold digest/runId）。

## 3. 拟合结果与推荐工作点（86 gold，分组 OOF）

| 路径 | precision | recall | 备注 |
| --- | --- | --- | --- |
| v1 当前默认（denseTop 单阈值 0.62/0.52） | 0 | 0 | emit 即回声误触发 |
| v2 规则级联 | 1.000 | 0.500 | 可解释但规则枚举有限 |
| v3a 学习型+P3 完整性门，τ=0.70 【historical sweep；effective=activation_policy_pre_v2 tauHi=0.45/deltaExp=0.03(偏离简报冻结值0.02，原因与追认状态见 policy JSON deltaDeviationFromBrief)】 | **0.818** ✅ | 0.237 | emitOnP=0 ✅ sViolations=1 harmfulEmit=0 ✅ |
| v3b oracle hit（上限） | 0.826 | 0.864 | 与 v3a 差距 ≈ 在线验证债务 |

- 无完整性门时学习头在 86 gold 上 precision 仅 0.516/emitOnP=8——多目标完整性
  是政策问题而非文本可学，**P3 门是必要组件**（保守实现：对比/分别/两个等
  枚举词降级 prefetch；检索层目标齐全性校验待后续支持）。
- 意图头：char n-gram TF-IDF + LR，OOF AUC 0.857（校准后 0.834，
  Brier 0.217→0.166）。系数序：mark +1.64 ≫ containment +0.94 >
  intentProb +0.58 > margin +0.27 ≫ denseTop −0.38——"是否在问"比"有多像"
  重要一个数量级。
- Bootstrap 95%CI @τ=0.70：precision [0.433, 0.929]、recall [0.105, 0.435]
  ——区间偏宽，**held-out 真实流量验证不可省**。

## 4. activation_features_pre_v2 规范要点

特征：echoRisk（containment∨denseTop 双臂 + 句式）、recallIntentProbability
（校准 LR）、dialogueAct/taskNeed、fusedMargin、candidate uniqueness、
completeness gate、repetition/persistence（复用 JS 多次提及门，P1）。
决策顺序（2026-08-25 主 Agent 修订，覆盖本节初版）：JS/M7 硬门（correction/
ignored/stale/wrong-scope/PII）→ lane 判定 → explicit lane（echoRisk 仅作特征，
不作硬 veto——避免误伤"复述记忆后追问"句式）→ proactive lane（高 echoRisk 可
hard suppress/downgrade）→ completeness/margin/evidence → emit/prefetch/suppress。
BGE-M3/para-512/D6 hybrid/三重过滤不动。

## 5. 资产清单（全部可复现）

| 资产 | 路径 |
| --- | --- |
| 三期 gold + 合并摘要 | artifacts/m7-live-pre/label-review-cal20260824-1954/{gold-confirmed,gold-confirmed-cf,gold-confirmed-b3}.jsonl、merged-gold-summary.json |
| 打分底座 | 同目录 {labels.scored 引用, cf-scored.jsonl, batch3-scored.jsonl}；向量缓存 vec-cache/ |
| 拟合与分析脚本 | calibration_harness.py、fit_path.py、features_v2_replay.py、intent_probe.py、extend_probe.py、merge_refit_b3.py、analyze_gold.py |
| 结果 | metrics-gold.json、threshold-grid-gold.csv、fit-path-results.json、intent-probe-results.json、extend-probe-results.json |
| 验收映射 | acceptance-gold-map.json（按测试矩阵 §8 逐项挂 gold） |
| 文档 | M7-ACTIVATION-CALIBRATION.md、M7-LABEL-REVIEW-REPORT.md、M7-ACTIVATION-FEATURE-DESIGN.md、M7-ACTIVATION-ALGO-REFERENCES.md |

## 6. 剩余条件（冻结 policyVersion 前）

1. 实现 Agent 将两 lane + 学习头移植进 worker（新 policyVersion），并校验
   **在线推理与离线 OOF 的一致性**。
2. 新真实 shadow 流量做 held-out 验证（当前工作点存在 58→86 gold 内选择偏差；
   bootstrap CI 偏宽）。
3. 达标定义不变：actPrecision ≥ 0.7、harmfulEmit=0、correction/wrong-scope/
   stale 泄漏=0、中英分别报告；达标后由用户批准 policy diff，再议 single-session
   active canary。
4. 检索层欠债登记（策略不可解）：cal-0020（envelope 预算 gold 未进 top-K）、
   cf-096（finish_reason 锚点 miss）、b3-rp1（重复故障改述后 miss）。

## 7. 披露

- bench venv 新增 openpyxl 依赖（本轮 xlsx 生成所需，隔离环境内安装）。
- batch3-review.xlsx 曾被脚本以空模板覆盖，用户原文已从解析日志逐字恢复；
  merge_refit_b3.py 内置 RULINGS 常量作为第二份备份。
- 全程零 commit/push、零 POST/重启 3080、零真实 MEMORY.md/Anchor/AccessEvidence
  写入；tracked 文件修改集与任务开始时一致。

## 8. 主 Agent 派发前修订（2026-08-25，已并入上文与 AGENT-PROMPT）

七点修正全部采纳：

1. **决策顺序修正**（§4 已改）：echo veto 从全局前置移入 proactive lane；
   explicit recall 不得因文本复述被提前 veto。
2. **运行时工件**：学习头以 JSON 策略工件进入运行时（feature schema、
   vocabulary/IDF、coefficients、intercept、calibration、runId、goldDigest、
   configHash、parentPolicyVersion），禁止 pickle/joblib；确定性纯 Python 推理，
   规避 sklearn 版本漂移。特征逻辑独立为 `python/m7_activation_features_pre_v2.py`，
   v1 保留作回放/fallback。
3. **三版本命名**：activation_features_pre_v2 / recall_intent_lr_pre_v1 /
   activation_policy_pre_v2；实验别名 v3a 不得作为 wire policyVersion。
4. **Golden parity**：≥20 条边界 fixture 逐字段比对 online vs OOF
   （normalizedText/containment/echoRisk/intentProb/dialogueAct/taskNeed/
   fusedMargin/completeness/lane/finalScore/decision/reasonCodes）；
   归一化/缺失值/浮点/分词差异 fail closed，阻断 shadow live。
5. **Completeness gate 结构化**：输出 requiredTargetCount/resolvedTargetCount/
   status(complete|partial|unknown)；partial/unknown 最多 prefetch；词典仅为
   一期保守检测。修正 cal-0066 类误 emit 的正道。
6. **Repetition 本轮 logging-only**：允许 suppress→prefetch，禁止仅凭次数
   直接 activate；待真实重复序列 gold 后再开放升级。
7. **JS 权威边界**：crossWorkspaceRecall/sensitiveMemoryMode 属 JS 的
   index_sync/context_push 前置授权层；Python 仅读取显式下发的 policy 字段，
   缺失即 fail closed，并输出 requiresCrossWorkspaceRelay/PII class。本轮不宣称二者已产品化。

held-out 门扩充：activate gold ≥15、predicted emit ≥8、中英各有独立正例、
precision CI 与 activation coverage 同时报告；任一不满足继续 shadow。

实施分两轮，不得混合：
- 第一轮（Python feature v2）：独立模块 + JSON policy artifact + 两 lane +
  echo/intent/dialogueAct/completeness/margin + repetition shadow + 86 gold OOF
  golden parity → 全程 shadow。
- 第二轮（JS policy plumbing）：PII 三档硬过滤（index_sync/context_push 前）、
  cross-workspace relay、append-only policy registry、文件审批队列写回。
  两轮分离使算法误差与 Host 授权误差可归因。

当前状态：修订后的 AGENT-PROMPT 可派发实现 Agent；完成 parity 后另派独立 JS
Agent 处理第二轮。GPU/model-sparse/reranker/graph 维持冻结。
