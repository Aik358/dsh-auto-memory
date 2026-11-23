# 2.3 多源标签构造与隔离挂机训练实验 —— 结果报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-19）
> 依据：[PROMPT-EVENT-ATTRIBUTION-LAB-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-LAB-20261116.md) · [RESULT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md](file:///D:/dsh-auto-memory/docs/internal/RESULT-EVENT-ATTRIBUTION-MODEL-REVIEW-20261116.md)
> 隔离目录：`artifacts/_event-attribution-lab-20261116/`（45 个文件 / 2573479 字节）
> 性质：**监督训练实验**。`trainingNotRun: false`（已真训练）；`productionEnabled: false`；`humanReviewed: false`；未碰真实记忆/19387。
> Lead复核（2026-11-16）：独立复跑 run1.py / run2.py 均 EXIT=0，训练指标与报告一致；M4打乱标签使trainAcc降至0.0556。公开轨迹本轮未转换。

---

## 0. 结论（最先说三件事）

1. **管线已真跑通**：模型构造标签 → 冻结 C2 之上的 numpy softmax 分类器 → 独立留出评估，全链路有产物、有指纹、可复算。参数是真更新的（训练准确率 **0.1245 → 0.7791**），不是固定答案冒充训练。
2. **跨源迁移失败**：synthetic 自建集 test caseAcc **0.867**，同一模型在**从未参与训练**的真实留出集上只有 **0.600**（9/15）。失败是**集中**的：`historicalWeak` 组 **0/5**，`originTimeReplay` 4/5，`protocolClosed` 5/5。
3. **本轮最有价值的产出不是模型，而是修掉两个基线缺陷 + 一个我自己造的泄漏**（§4）。其中「synthetic excerpt 直接复制记录正文」是我首版的错，它让第一轮指标虚高、在真实集上崩掉——**若不做真实留出评估，这个错会被当成成功**。

---

## 1. 环境与身份（全部实测）

| 项 | 实测值 | 取证 |
|---|---|---|
| 系统 Python | 3.14.6，**无 numpy / 无 sklearn / 无 scipy** | 真 import 各抛 ModuleNotFoundError |
| 训练用 Python | DSH 捆绑 runtime python，**numpy 2.3.5** | load_workspace_dependencies + 真 import |
| sklearn / scipy | **不可用**（两个解释器都没有） | 真 import 失败 |
| 本地 C2 向量底座 | multilingual-e5-small / model_quantized.onnx **118,308,185 B** / 384 维 / L2 归一化 | 真加载真推理：load 1,316 ms，2 条文本 7 ms，范数 1.000000 |
| 向量库 | @huggingface/transformers@3.8.1（optionalDependencies，本机已装） | 真 import + 真 pipeline |
| LLM 端点 | https://worldcodes.online/v1（OpenAI 兼容） | 200 / content=OK |
| 可用模型 | deepseek-v4.1-flash（200）、glm-5.3-flash（200） | 逐个真调用 |
| 不可用 | qwen3.8-max 404 model_not_found；dshapi provider **401 INVALID_API_KEY**（两个模型都试） | 如实记录，未绕过 |
| 公开数据集 | risenlab/agentlogs 200（**cc-by-4.0**）；AlienKevin/SWE-ZERO-96K 200（**apache-2.0**） | 只取 API 元数据，**未下载全量** |

**关于公开轨迹**：可达、许可明确，但**本轮未做转换**。理由如实写：先把 real-frozen + synthetic 双源闭环跑完并暴露失败，比同时铺三个源更容易判断「失败来自数据还是方法」。列为下一轮第一项（§7）。

**数据/代码指纹**：全部 45 个产物的字节数与 sha256 见 `data/MANIFEST.json`。冻结输入 10 份的 sha256 见 `inputs/frozen-inputs.json`，开工前后一致。

---

## 2. 多源数据（三源，本轮实启用两源）

### 2.1 real-frozen（真实冻结库，只读转换）

来源 `artifacts/_event-attribution-review-20261116/`：20 个 case、6 个事件、16 个重复族，**全部 split=test**（教师轮冻结）。

| 修正 | 做法 | 结果 |
|---|---|---|
| protocolConflict 不作为训练答案 | 5 例标 excludedFromTraining，reason=protocol-construct | **训练可用 15/20** |
| 同文跨事件单列 | 标 sameTextCrossEvent 字段，保留存储事实 | 见 §4 C1/C2 |
| 不删除真实历史 | 只读转换，零删除零归档 | 上游 5 个源文件 sha256 复验未变 |

### 2.2 synthetic-authored（自建事件库，本轮训练集来源）

126 个 case × 9 个场景族（`data/synthetic-libraries-v2.json`，727,475 B）。生成规则写在 `scripts/s2-build-synthetic.mjs` 头部：

| 场景 | 构造意图 | n |
|---|---|---|
| S10-clean-attach | 干净正例，同文容器唯一 | 14 |
| S2-ambiguous-target | 存在同文容器，应 attach 到它 | 14 |
| S3-no-candidate | 所有候选都不含正文，应新建 | 14 |
| S4-multi-candidate | 多候选相关，仅一个含同文 | 14 |
| S5-closed-container | 唯一同文容器已 closed | 14 |
| S7-cross-language | 正文中文 / 候选英文 | 14 |
| S8-umbrella | 同文同时出现在伞事件与子事件 | 14 |
| S1-decoy-nearby | 诱饵主题重叠但无同文 | 14 |
| S9-time-adjacent | 记录紧邻候选更新时间，无同文 | 14 |

split：train 91 / dev 18 / test 17（按 familyKey 哈希分配，**同族不跨 split**）。

**★第一版生成器有缺陷，已修**（§4 C5）：首版把记录正文**原样** push 进候选检查点，导致 excerpt 与 record 逐字相同 ⇒ 任务退化成字符串匹配。修正后 `excerpt === record` 条数为 **0 / 1231**（自检见 `eval/final-summary.json` 的 leakageSelfCheck）。同时把正文长度从 58–85 字拉到 **155–319 字**（对齐真实 103–3000 字）。

### 2.3 public-derived（本轮未启用）

见 §1。许可与可达性已核实并记录在 `logs/env-probe.json`。

---

## 3. 模型构造标签

**模型身份**：worldcodes.online/v1 / deepseek-v4.1-flash / temperature=0 / response_format=json_object。

**隔离**：标签模型只看「记录正文 + 候选名/摘要/状态/时间/检查点摘录」，**看不到 provenance、看不到 gold、看不到 split**。构造者可证标签由独立脚本按规则算出，两种标签分别标 `labelOrigin: model-reviewed` 与 `provableOrigin: construction-deterministic`。

**实测**：126 次调用、**120 条成功解析、0 条解析失败**、累计 **392,638 tokens**。原始输出与输入指纹存 `logs/label-full-v2.json`。

**双标签一致性**：

| 量 | 值 |
|---|---|
| 模型标签 vs 构造可证：决策一致 | **76 / 120 = 63.3%** |
| 同上：目标候选一致 | **104 / 120 = 86.7%** |

混淆（行=可证，列=模型）：

| 可证 ＼ 模型 | attach | create-new | ambiguous | not-applicable |
|---|---|---|---|---|
| attach-existing | **69** | 0 | 0 | 0 |
| create-new | 0 | 7 | **29** | 0 |
| not-applicable | **15** | 0 | 0 | 0 |

**两条可复现的模型标签缺陷**：

- **closed 容器仍被 attach：S5 = 14/14 全错**。模型看到同文就 attach，忽略 status=closed。与上一轮复核的 adv_07 同族，但更纯粹——「同文即归属」的过拟合。
- **无候选时倾向 ambiguous 而非 create-new：S3 = 8/14，S9 = 10/10**。证据不足时选「再确认」而不是「新建」，代价是把该新建的记录留在不确定状态。

**这些缺陷是训练目标的一部分，不是隐藏失败**——分类器要学的正是「不要只看同文」。

---

## 4. 基线缺陷订正（本轮最重要的产出）

| # | 原判断 | 实测结论 | 处置 |
|---|---|---|---|
| **C1** | 14/20 case 的记录正文与其 provenance 检查点完全相同 | **成立（存储层事实）** | 不删除、不当错误；逐例标 exactSameTextAsRecord |
| **C2** | 可见证据包存在同文泄漏 | **不成立 —— 订正** | 实测可见 excerpt 与记录正文的 **12-gram 包含度最高 0.350**，0/20 达 0.60 阈值；excerpt 逐字等于正文 **0 条**。**自我泄漏过滤器有效**。上一轮把「存储层同文」误读成「可见泄漏」 |
| **C3** | protocolConflict gold 是协议构造 | **成立** | 5 例排除出训练答案集 |
| **C4** | 教师轮 dev 可用于选模型 | **不成立 —— 新发现** | split-manifest-v4 的 dev=**92 例，全部 historicalWeak / attach-existing 单类**。单类 dev 无法做模型选择。本批 dev 改用 synthetic 自建 split |
| **C5** | （本批自查）synthetic 生成器无泄漏 | **首版有，已修** | excerpt 逐字复制正文 → 改为「同内容不同表述」+ 长度对齐。修正后 0/1231 |

> C2 是一个**方向相反的订正**：上一轮报告认为基线有可见泄漏，实测没有。不复算就沿用，本轮会去打一个不存在的靶子。

---

## 5. 训练与指标

### 5.1 实现（numpy 手写，可复算）

本机无 sklearn/scipy（已实测），故 `scripts/trainer.py` 用 numpy 实现：

- 多分类 softmax 回归，**26 维确定性特征**（n-gram Jaccard/包含度 × 5 档、数字/路径/哈希重叠、长度比、中文占比、status one-hot、时间关系、伞事件标志、摘录条数）
- **解析梯度 + 全批 Adam**，L2=1e-3，lr=0.05，400 epochs
- **W/b 零初始化，不使用随机数**（seed 仅作记录，如实标注）
- 每轮保存 W/b 的 shape/norm/sha256 与 loss 曲线

**参数确实更新了**：

| 标签源 | trainAcc before | trainAcc after | ‖W‖ |
|---|---|---|---|
| modelLabel | **0.1245** | **0.7791** | 3.4972 |
| provableLabel | **0.1004** | **0.8876** | 4.1866 |

### 5.2 synthetic 内部指标（test split，未参与训练）

| 标签源 | n | caseAcc | 误 attach | 误新建 |
|---|---|---|---|---|
| modelLabel | 15 | **0.867** | 0 | 0 |
| provableLabel | 15 | **0.933** | 0 | 0 |

### 5.3 ★真实留出集（real-frozen，从未参与训练）

| 指标 | 值 |
|---|---|
| n | **15**（protocolConflict 5 例已排除） |
| 正确 | **9 / 15 = 60.0%** |
| **误 attach** | **0** |
| **误新建（false-create）** | **3** |
| 过度 ambiguous | 2 |
| 其它误判 | 1 |

按组（Prompt §4 要求的分组报告）：

| 组 | n | 正确 | 主要错误 |
|---|---|---|---|
| historicalWeak | 5 | **0** | false-create ×3、over-ambiguous ×2 |
| originTimeReplay | 5 | 4 | other-misclass ×1 |
| protocolClosed | 5 | **5** | — |

**判读**：

- **误 attach = 0**，这是 Prompt 最看重的危险错误，本轮模型没犯。
- 真正失败在 historicalWeak：5/5 被判 create-new 或 ambiguous。原因是特征层面——真实记录是 1,000–3,000 字交接账本，候选只给 name/summary + 3 条摘录，n-gram 包含度天然极低（实测真实集 jac3 均值 0.041 vs synthetic 0.194）。**这是「证据视野」差异，不是模型不会判断**。
- protocolClosed 5/5 全对，说明「看 status」这条信号学得会。

### 5.4 特征分布偏移（失败归因，实测）

修正后的 v2 数据仍与真实集有 **18 / 26** 个特征偏移 **>0.8σ**（说明修正只解决了"逐字复制"，没解决分布形状）。前 6：

| 特征 | synthetic (v2) | real | 问题 |
|---|---|---|---|
| hex_overlap | 0.000 ± 0.000 | 0.088 ± 0.247 | 训练集是常数，零方差 ⇒ 该维在真实集上完全外推 |
| zh_ratio_rec | 0.457 ± 0.049 | 0.313 ± 0.108 | 真实记录英文/代码占比更高 |
| len_ratio_r | 0.955 ± 0.112 | 0.668 ± 0.311 | 真实正文比候选摘要长得多 |
| path_overlap | 0.623 ± 0.274 | 0.074 ± 0.163 | synthetic 正文与候选共享路径过多（**生成器人为痕迹**） |
| dt_norm | 0.032 ± 0.312 | 0.602 ± 0.418 | 真实记录与其事件时间差一个量级 |
| jac3 | 0.216 ± 0.130 | 0.041 ± 0.039 | **真实文本更长更杂 ⇒ 字面重叠天然低** |

完整 26 维见 `eval/transfer-diagnosis-v2.json`。**「训练损失下降」完全不能替代这组数**。

### 5.5 区分力 / 隔离变异

| 变异 | base | mutant | Δ | 严格判据 abs(Δ)>0.05 |
|---|---|---|---|---|
| M1 去掉全部 n-gram 特征 | 0.822 | 0.811 | −0.011 | **未区分（噪声）** |
| M2 去掉 status one-hot | 0.822 | 0.856 | +0.033 | **未区分** |
| M3 去掉时间特征 | 0.822 | 0.756 | −0.067 | CAUGHT |
| **M4 打乱标签** | 0.822 | **0.056** | **−0.767** | **CAUGHT** |
| M5 去掉伞事件标志 | 0.822 | 0.878 | +0.056 | CAUGHT（方向相反） |

**诚实结论**：**只有 M4（打乱标签）是强证据**——证明管线确实在学标签而不是恒定输出。M1/M2 差异只有 1–2 个用例，属噪声；M5 甚至让指标变好，说明「伞事件标志」在本特征集里是负贡献。**首版我用「不高于基线」当判据，会把这 3 个都判成 CAUGHT，那是假绿**；改用 abs(Δ)>0.05 后如实降为 3/5。

---

## 6. 未通过的门与边界（单列）

1. **人工金标：0 条**。humanReviewers: 0、humanConfirmed: 0。本批全部标签是 model-reviewed 或 construction-deterministic，**不满足原训练门的双人复核条件**。
2. **真实 HOST 未验**：没有在真实宿主里跑过归属判定，没有写入任何真实记忆。
3. **跨设备 / 跨时区未验**。
4. **公开轨迹未转换**（§2.3）。
5. **E5/LoRA/RL 未使用**：监督训练，无奖励、无多动作策略、无策略梯度。**不称 RL**。
6. **生产未启用**：无 attach/merge/archive 任何写操作，productionEnabled: false。
7. **样本量小**：真实留出 15 例、synthetic test 15 例。**这些数字是诊断，不是效果承诺**。
8. **dev 集单类**（§4 C4）：本批用自己的 synthetic dev，未解决教师轮 dev 不可用的问题。

---

## 7. 下一轮建议（按优先级）

1. **修证据视野，而不是继续调模型**：候选特征加上「候选检查点首 300 字摘要」而非仅 3 条摘录——§5.4 已证明失败来自视野差，不是判别力差。
2. **让 synthetic 更贴近真实**：按真实分布采样正文长度（中位 ~600）、时间差、路径重叠度；或直接从 real-frozen 的 823 条 historicalWeak 切训练集。
3. **转换 public-derived**：agentlogs（cc-by-4.0）与 SWE-ZERO（apache-2.0）已核实可达，可取小样本流式转换。
4. **closed 与伞事件**：模型标签在 S5 上 14/14 全错，是最好的负样本来源；提高 S5/S8 权重或做 focal loss。
5. **上线前必须补**：人工金标抽样（哪怕 50 条）、真实 HOST 端到端、跨设备。

---

## 8. 产物清单

全部 45 个文件的字节与 sha256 见 `data/MANIFEST.json`。关键项：

| 路径（相对 lab 根） | 字节 | sha256 前 16 |
|---|---|---|
| data/real-frozen-corrected.json | 36585 | 5780c6fbf0a0d9a3 |
| data/synthetic-libraries-v2.json | 727475 | 137cde72e052cf23 |
| eval/real-holdout-report-v2.json | 7759 | 840d29633cbf3da1 |
| logs/env-probe.json | 2421 | 5f1cbd7319131275 |
| logs/label-full-v2.json | 212772 | d4f9575da1c53fd4 |
| runs/run1-report-v2.json | 22385 | ba3717b8f702e7b3 |
| runs/run2-report-v2.json | 5653 | 8aef9f3ea1929f7f |
| scripts/diag.py | 4027 | b9d4d333154e12a1 |
| scripts/run1.py | 8286 | aa741336f31260ed |
| scripts/run2.py | 5811 | 200159521fb7c027 |
| scripts/run3.py | 7410 | 98dea76769e8a6a9 |
| scripts/s2-build-synthetic.mjs | 16870 | 84e00e397cdd03f1 |
| scripts/s2b-label-v2.mjs | 8025 | e209050f1a9088e0 |
| scripts/s2c-merge-v2.mjs | 3916 | bc72890336e98f65 |
| scripts/trainer.py | 9798 | 54efe193dbc07a34 |

复算入口：

```bash
# 1) 环境探测
node scripts/probe-embedding.mjs ; node scripts/probe-llm.mjs ; node scripts/probe-datasets.mjs
# 2) 数据
node scripts/s1-build-realfrozen.mjs ; node scripts/s2-build-synthetic.mjs
# 3) 标签（真实 API）
node scripts/s2b-label-v2.mjs ; node scripts/s2c-merge-v2.mjs
# 4) 训练与评估（DSH 捆绑 python）
"<dsh-python>" scripts/run1.py ; "<dsh-python>" scripts/run2.py
"<dsh-python>" scripts/run3.py ; "<dsh-python>" scripts/diag.py ; "<dsh-python>" scripts/run4_final.py
```
