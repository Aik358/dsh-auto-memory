# M7 Activation 算法扩展参考：中文方向与跨中英文

> 定位：补充 `docs/M7-ACTIVATION-FEATURE-DESIGN.md` §5 公开算法建议中未覆盖的**中文方向 / 跨中英文**内容；由校准 Agent 整理并附本地实证。
> 数据基座：58 条 human gold（A22/P19/S17，`label-review-cal20260824-1954/`）；全部实验按 pairId/session 分组交叉验证，脚本与结果同目录可复现（`intent_probe.py`、`extend_probe.py`、`intent-probe-results.json`、`extend-probe-results.json`）。
> 效力：参考性；落地形式仍以 `activation_features_pre_v2` policyVersion + 重标定门槛为准。

## 1. 主 Agent 原六项裁定速览（2026-08-24 评审）

| 方法 | 裁定 | 一句话依据 |
| --- | --- | --- |
| CalibratedClassifierCV | **立即采纳（P0）** | 小样本下 sigmoid 校准显著改善阈值决策概率 |
| MAPIE conformal | 二期采纳 | 预测集合=天然 abstain/prefetch 机制 |
| NLI cross-encoder | 仅离线研究 | CPU 成对推理进不了 500ms 同步链 |
| MMR | 低优先可选 | 只做已召回集合内去冗余，不判断唤起必要性 |
| SetFit | 缓，作对照 | 卖点是少样本；我们有 58 条真 gold，n-gram+LR 基线先行 |
| Snorkel | 暂不采纳 | 弱标签是扩规模工具；当前瓶颈是策略可分性不是标注量 |

## 2. 本地实证摘要（详见结果文件）

| 实验 | 设置 | 结果 | 含义 |
| --- | --- | --- | --- |
| T2 recallIntent 二分类（A vs S） | char_wb 2-4gram TF-IDF + LR，分组 CV 5 折 | **AUC 0.901**；校准后 acc 0.744→**0.872**、Brier 0.227→**0.131** | 意图可从查询文本学习；校准带来决定性增益 |
| T1 三分类（A/P/S 纯文本） | 同上 | macroF1 仅 **0.494**；P 类 8/19 误判为 A | 必要性判断不能只靠查询文本——任务语境特征（P4/fusedMargin/lane）必需，两 lane 设计获得实证 |
| T3 containment 单信号 | bigram(query)∩bigram(top1)/\|query\| | echo 组中位 **0.273 < activate 组 0.462** | 词面覆盖率单独不判回声（activate 天然共享目标术语）——"BM25 覆盖硬封顶"被证伪 |
| X1 zh→en/mixed 零样本迁移 | 仅 zh gold 训练（32 条，AUC 0.886）→ 7 条 en/mixed gold 测试 | **recall@0.5 = 0.857**（meanP 0.528） | 字符 n-gram 有一定跨语鲁棒性但不完美；生产训练集必须中英混合 + 双语词表 |
| X2 组合回声规则 | containment≥θ 且 无疑问/回忆标记 | 最优 θ=0.3：precision **0.70** / recall 0.467 | 组合规则可用但召回有限——作为 echoRisk 的输入之一，非单独裁决 |
| X3 词表意图基线 | 中英疑问+回忆标记词表 | P=R=F1=**0.864** | 冷启动即接近学习型基线；FP 剖析见 §3.3 |

## 3. 新增：中文方向与跨中英文（本轮网络核验 + 实证）

### 3.1 多语言 NLI（离线研究轨，替代英文专用建议）

主 Agent 引用的 `cross-encoder/nli-roberta-base` 为**英文专用**（模型卡证实：roberta-base、~124M 参数/499MB safetensors、成对单次前向、logits 未校准、SNLI+MNLI 训练）。本项目语料中英混写，应改用多语言变体：

- **推荐**：`MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7` —— mDeBERTa-v3-base（~0.3B），27 语微调**含中文**，XNLI 中文准确率 **0.803**（en 0.871），训练集含 ~10% 中英混合对；MIT 许可。
- 硬约束：mDeBERTa **不支持 FP16**（须 FP32 推理）；作者仅提供 A100 吞吐（670-1900 texts/s），CPU 未基准——按参数量估算单对 CPU 推理仍在百 ms 级 ⇒ 维持"仅离线研究轨"裁定；GPU 立项后可重评上异步链。
- 用途：离线判定 query↔candidate 是 entailment(该唤起的知识关系)/neutral/contradiction(矛盾=stale 信号)，与 supersede 边互补。

### 3.2 PAWS-X：回声陷阱的学术对应物

PAWS-X 是 PAWS 的跨语言扩展（含中文），专门构造**高词面重叠但语义不同**的对抗式复述对（每语种 49,401 训练/2,000 dev/2,000 test）。这与我们的 echo trap 结构同构——"词面像 ≠ 同一言语行为"。用途：①echo/intent 分类器的外部预训练或评测资源（中文子集可直接用）；②防止分类器退化为词面匹配器的对抗验证集。

### 3.3 fastText LID 与中文混合查询

`lid.176.bin`（126MB）/`.ftz`（917KB）支持 176 语识别，可给混合查询打语言标签以路由词表/分类器。注意：官方页面未声称短码切换（code-switching）输入的性能，须用我们 `mixed` 类 gold 自测。零成本起步方案：CJK 字符占比启发式（≥1 个汉字即视为 zh 参与词表匹配）已在 X3 生效。

### 3.4 LCQMC（哈尔滨工业大学）

大规模中文问对语义匹配语料（C-MTEB 托管，100K-1M 档，aclanthology 2021.emnlp-main.357）。用途：为中文意图/相似度分类器提供领域增强预训练。域差警示：LCQMC 是问-问对，我们是查询-记忆对，只做中间预训练不做直接替换。

### 3.5 中文疑问/回忆标记词表（工程起点已内置）

`extend_probe.py` 内置 INTERROG（什么/如何/怎么/哪些/为什么/吗/呢/what/how…）与 RECALL_CTX（之前/上次/当时/找出来/调出来/previous/earlier…）双表。X3 实测 P=R=F1=0.864；假阳性剖析：cal-0015/0014 属"有回忆意图但被 correction/harm 硬门压制"（特征目标是意图而非最终动作，属预期行为），cf-104「在吗？」的孤立"吗"字误报提示词表需要**最小长度/搭配约束**（如"吗"须与动词短语共现）。

## 4. 综合采纳矩阵

| 方法 | 判定对象 | 落点 | 优先级 | 验收门槛 |
| --- | --- | --- | --- | --- |
| 字符 n-gram LR + CalibratedClassifierCV(sigmoid) | recallIntentProbability（唤起必要程度·意图侧） | Python `activation_features_pre_v2` | **P0** | 分组 CV AUC≥0.85 且校准后 acc≥0.85（当前实测已达：0.901/0.872） |
| 双语词表启发式 | 同上冷启动 + 兜底 | 同上 | **P0** | 与 LR 门集成；"吗/呢"加搭配约束 |
| containment×句式 组合回声规则 | echoRisk（唤起必要程度·反侧） | 同上 | **P0** | 作为 echoRisk 输入之一；echo-gold 全 suppress 且 activate-gold 误伤≤1 |
| fusedMargin + 候选唯一性 | 任务语境必要性 | 同上（Proactive lane 门） | P0 | gold 网格选择 δ，搜索范围 [0.03,0.05] |
| repetition/persistence（带衰减） | 重复痛点升级 | 同上 per-session state | P1 | 2 次失败/3 次提及起步实验；生活陈述不升级 |
| MAPIE conformal | 不确定→prefetch/abstain | Python policy | P1 | coverage-risk 曲线；中英分组覆盖分别报告 |
| 多语言 NLI（mDeBERTa-xnli 系） | echo/contradiction 离线特征 | bench 离线实验 | P2 | 与人工 echo 标注一致率报告；GPU 轨解锁后再议上链 |
| fastText LID / CJK 占比 | 混合查询语言路由 | JS gate 或 worker | P1（③a/③b 前置） | mixed 类 gold LID 正确率自测报告 |
| PAWS-X zh 子集 | echo 分类器对抗评测/预训练 | bench 离线 | P2 | 加入即报告 |
| LCQMC | 中文意图分类器中间预训练 | bench 离线 | P2 | 域差消融报告 |
| MMR | 候选去冗余 | worker 候选阶段 | P2 | 语料密度触发后再启 |
| SetFit / Snorkel / GPU-rerank | 对照 / 规模工具 / 延迟解 | offline/runtime | P2-P3 | 主 Agent 原裁定不变 |

## 5. 对接清单与纪律

1. 全部新特征进 `activation_features_pre_v2`；58 gold + 新增真实 shadow 流量重放；门槛不变：actPrecision ≥ 0.7、harmfulEmit=0、correction/wrong-scope/stale 泄漏=0、中英分别报告。
2. 分类器训练/评测一律按 pairId/session 分组（counterfactual-pairs 自带 split 字段：train92/dev10/test7），禁止同对照对跨 split。
3. 数据修复披露：batch1 gold 文件缺 `language` 字段，本轮探针已从源 `labels.jsonl` 回填；实现 Agent 建特征集时须携带语言字段。
4. GPU 轨（若立项）：device 进入 identity block/configHash 并全量重建是硬前置。
5. 本文档为参考性扩展；设计权威仍是 `docs/M7-ACTIVATION-FEATURE-DESIGN.md`。

## 6. 路径拟合结果（fit_path.py → fit-path-results.json）

> **HISTORICAL/SUPERSEDED 提示**：本节 τ=0.65/0.70 与 δ_exp=0.03 为修订前实验扫描值，仅作研究记录；当前 effective 候选策略以 python/policies/activation_policy_pre_v2.json 为准（tauLane=tauHi=0.45、tauLo=0.35、deltaExp=0.03[简报冻结 0.02 在生产化 completeness 下 fail 一例，待追认]、deltaPro=0.05，echo veto 仅 proactive lane）。

**架构结论（回应"关联性与唤起是否分开"）**：两者是不同的预测目标，最优路径为**同步计算、分层裁决**——关联性（检索层）决定"什么材料相关"，唤起性（策略层）决定"现在是否打断"。两条 lane 先后顺序相反且都已被数据支持：explicit lane 意图先行、关联验证（意图分类 AUC 0.901）；proactive lane 关联先行、语境批准（纯文本三分类仅 0.494 证明语境不可省）。

四条路径在 54 条可评估 gold 上的对比（emit 正确 = emit ∧ 目标命中 ∧ 无 forbidden）：

| 路径 | precision | recall | sViolations | 说明 |
| --- | --- | --- | --- | --- |
| v1 当前默认（denseTop 单阈值） | 0 | 0 | 4 | 回声家族占据 emit |
| v2 规则级联（手写两 lane） | **1.000** | 0.500 | 0 | 可解释但规则枚举有限 |
| **v3a 学习型·可部署特征** | **0.833 @ τ=0.65** | **0.682** | 1 | 特征全部线上可得 |
| v3b 学习型 + oracle hit | 0.826 | **0.864** | 1 | 上限；与 v3a 差距≈18pt=在线验证债务 |

- τ 扫描显示完整 PR 面：τ=0.70 → precision 1.0 / recall 0.409；τ=0.50 → 0.68/0.773。**推荐工作点 τ=0.65**（precision-first 纪律下 recall 最优），τ=0.70 作为保守档。
- 可部署系数（LR）：mark(疑问/回忆标记) +2.05 ≫ containment +1.58 > margin +0.26 > intentProb +0.32 > denseTop +0.06——**"是否在问"比"有多像"重要一个数量级**，与 echo trap 诊断互证。
- 残余错误归因：18 emits 中 17 正确；唯一 WRONG 是 cal-0066 双目标对比题被单条 emit——需要 P3 的候选完整性/唯一性门处理（多目标问句降级 prefetch），非意图误判。
- 债务清单：①v3a→v3b 的 18pt 召回差需在线自验证信号弥补；②sViolations=1 为 S 类 prefetch 级越界（无 harmful）；③P4 任务信号未入模。

## 7. 冻结前剩余条件

1. 实现 Agent 将两 lane + 学习头移植进 worker（新 policyVersion），校验在线推理与离线 OOF 一致性。
2. 新真实 shadow 流量做 held-out 验证（本拟合的工作点在 58 gold 内选出，存在选择偏差）。
3. 达标后由用户批准 policy diff，再议 active canary。
