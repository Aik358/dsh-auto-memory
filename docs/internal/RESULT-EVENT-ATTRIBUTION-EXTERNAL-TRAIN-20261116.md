# 2.3 外部四态标注与隔离训练验证 —— 结果报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-23）
> 依据：[PROMPT-EVENT-ATTRIBUTION-EXTERNAL-TRAIN-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-EXTERNAL-TRAIN-20261116.md)
> 隔离目录：`artifacts/_event-attribution-external-train-20261116/`（10 文件 / 9783266 字节）
> 性质：**监督训练已执行**。`trainingRun: true`；`labelOrigin: model-reviewed`（**非 human-reviewed**）；`productionEnabled: false`；未改lib/、未装依赖、未碰真实记忆/19387。
> Lead复核（2026-11-16）：独立复跑 et-train.py EXIT=0；dev 0.372 vs majority 0.314/cov12 0.235，M5=0.059，与报告一致；候选池100% closed，heldout 51未评估。

---

## 0. 结论：模型超过零参数基线，但绝对水平很低，不足以判定「可靠模型」

**case 级四态判定（dev）**：

| 臂 | 类型 | train | **dev** |
|---|---|---|---|
| zero-cov12 | 零参数 | 0.410 | **0.235** |
| zero-random | 零参数 | 0.179 | **0.255** |
| zero-majority | 零参数 | 0.513 | **0.314** |
| trained-softmax | 训练 | 0.333 | **0.372** |

**必须同时说出的三件事**：

1. **训练模型 dev 0.372，高于零参数 cov12 的 0.235 和多数类的 0.314。** 这是四轮以来第一次，训练模型超过了零参数基线。
2. **但 0.372 这个绝对值太低**：四类问题，随机 0.25，多数类 0.314。模型只比「全猜最常见类」高 5.8 个百分点。**不能据此宣称「得到了较可靠的模型」**。
3. 严格变异 **3/5 被区分**，其中 M5 打乱标签掉到 0.059（Δ=−0.314）说明管线确实在学习；但 M1（去掉全部 cov 特征）与 M4（去掉标题命中）**Δ=0.000，未区分**。

---

## 1. 数据来源与复用（本轮未新增 API 调用）

全部复用 task-22 已采集的真实 GitHub 原始数据（`raw/github-auth.json`，1,246,588 B / sha16 `32ede8094990d003`）：

| 仓库 | 许可 | PR | issue | 评论 |
|---|---|---|---|---|
| `psf/requests` | **Apache-2.0** | 100 | 50 | 106 |
| `pallets/flask` | **BSD-3-Clause** | 100 | 50 | 79 |
| `django/django` | BSD-3-Clause | 100 | **0** | 0 |

`django/django` 未提供可用 issue 语料（issue 全经 PR 流转），**未用 PR 冒充 issue**，也未进入本轮数据集。

---

## 2. 事件构造与四态来源（真实结构推导，不伪造类别）

每条「包」= 一条记录 + 记录时刻可见的候选事件集合。四态**不是随意指定**，而是由真实结构关系推导：

| 四态 | 真实来源 | 包数 |
|---|---|---|
| `attach-existing` | 评论发生在该 issue 关闭**之前** ⇒ 该 issue 当时可接收 | 78 |
| `not-applicable` | 评论发生在该 issue 关闭**之后** ⇒ 唯一同文容器已关闭 | 36 |
| `create-new` | issue 创建正文，记录时刻自身尚不存在（LOO 剔除自身） | 77 |
| `ambiguous` | **无结构真值**，完全由标注者判 | — |

总计 **191 包**。按 issue 编号确定性哈希分桶（同族不跨桶）：

| split | 包数 | 说明 |
|---|---|---|
| train | 81 | 参与标注与训练 |
| dev | 59 | 参与标注，仅用于选型/变异 |
| **heldout** | **51** | **未标注、未参与训练与选型的真实外部留出** |

19 个包因标注超时未取得结果，最终可用 **129** 包（train 78 / dev 51），共 **3,157 个候选行**。

---

## 3. 独立模型标注（model-reviewed，非 human-reviewed）

| 项 | 值 |
|---|---|
| 标注者 | `glm-5.3-flash`，temperature=0，**独立新上下文** |
| 标注者可见信息 | 仅记录正文 + 候选（标题/状态/时间/摘要）。**看不到** structuralHint、goldEventId、splitGroup、任何训练结果 |
| `labelOrigin` | `model-reviewed` |
| `sourceKind` | `public-derived` |
| 产出 | 129 条原始响应，逐条含 evidence / counterHypothesis / unknowns / usage，已落盘 `logs/labels-partial.json`（254,302 B） |
| 解析失败 | **0** |
| 总 token | 830,755 |

**四态分布（129 条）**：{"not-applicable":17,"attach-existing":41,"ambiguous":15,"create-new":56}

### 3.1 标注质量旁证：结构提示 vs 模型决策

结构提示是**结构事实**（评论在关闭前/后、issue 新建），标注者看不到它。二者一致率 **94/129 = 72.9%**：

| 结构提示 → 模型决策 | 数量 |
|---|---|
| create-expected → create-new | 54 |
| attach-expected → attach-existing | 27 |
| closed-expected → attach-existing | 14 |
| attach-expected → ambiguous | 14 |
| closed-expected → not-applicable | 13 |
| create-expected → not-applicable | 4 |
| closed-expected → create-new | 1 |
| attach-expected → create-new | 1 |
| create-expected → ambiguous | 1 |

**读法（这条必须写清）**：

- 一致率 72.9% 说明模型**不是**在乱猜，主要分歧集中在 `closed-expected → attach-existing`（14 例）。
- 但这 **不构成正确性证明**：一致只表示「模型判断与结构约束不矛盾」，结构提示本身也不是金标（`ambiguous` 类根本没有结构真值）。
- 按任务书要求：**标签一致性不等于正确，投票不替代证据**。本报告不把 72.9% 当作标签准确率。

---

## 4. 训练与结果

### 4.1 训练配置

候选级 4 类 softmax，numpy 手写 Adam（本机无 sklearn），class-weighted：

```json
{
  "epochs": 500,
  "lr": 0.08,
  "l2": 0.001,
  "optimizer": "Adam",
  "classWeighted": true,
  "init": {
    "classWeight": [
      21.522727272727273,
      0.31672240802675583,
      8.455357142857142,
      1.4750778816199377
    ]
  },
  "seed": 20261116
}
```

`W_shape=[17,4]`，`W_norm=4.2336`，`W_sha256=aa6240ca0f6d8230`
损失曲线：[{"epoch":100,"loss":0.5962387304079051},{"epoch":200,"loss":0.594298131812516},{"epoch":300,"loss":0.593632870489779},{"epoch":400,"loss":0.5933435896304824},{"epoch":500,"loss":0.5932150538356301}]

### 4.2 分类别 P/R/F1（dev）

| 类 | support | P | R | F1 |
|---|---|---|---|---|
| attach-existing | 19 | 0.5161 | 0.8421 | 0.64 |
| create-new | 16 | 0.6667 | 0.25 | 0.3636 |
| ambiguous | 11 | 0.6667 | 0.1818 | 0.2857 |
| not-applicable | 5 | 0.0909 | 0.2 | 0.125 |

macro-F1 = **0.3536**；整体 acc = **0.3725**

### 4.3 混淆矩阵（dev，行=gold，列=预测）

| gold \ pred | attach-existing | create-new | ambiguous | not-applicable |
|---|---|---|---|---|
| **attach-existing** | 16 | 0 | 0 | 3 |
| **create-new** | 6 | 4 | 0 | 6 |
| **ambiguous** | 8 | 0 | 2 | 1 |
| **not-applicable** | 1 | 2 | 1 | 1 |

### 4.4 错误分组（任务书要求的分组报告）

| 错误类型 | trained-softmax (dev) | zero-cov12 (dev) |
|---|---|---|
| false-attach | 6 | 5 |
| false-create | 0 | 17 |
| false-attach-closed | 1 | 2 |
| over-ambiguous | 1 | 0 |
| other | 24 | 15 |

**误 attach（should create-new → judged attach-existing）**：模型 6 例，零参数 5 例 —— **模型没有改善误 attach**。
**误 attach 到已关闭容器**：模型 1 例，零参数 2 例 —— 略有改善但样本极小。

### 4.5 严格变异（|Δ|>0.05）

| 变异 | dev acc | Δ | 判定 |
|---|---|---|---|
| M1-drop-cov | 0.3725 | 0 | **未区分** |
| M2-drop-closed | 0.2353 | -0.1372 | **CAUGHT** |
| M3-drop-overlap | 0.4314 | +0.0589 | **CAUGHT** |
| M4-drop-title | 0.3725 | 0 | **未区分** |
| M5-shuffle-labels | 0.0588 | -0.3137 | **CAUGHT** |

**3/5 被区分**。

- **M5 打乱标签**：0.372 → 0.059（Δ=−0.314）—— 强证据，管线确实在学习有用的东西。
- **M2 去掉 closed 特征**：0.372 → 0.235（−0.137）CAUGHT —— `stClosedAtRecord` 有实质贡献。
- **M3 去掉确定性重叠**：0.372 → 0.431（**+0.059**）CAUGHT 但**方向是变好** —— 重叠特征在本规模下有轻微负贡献。
- **M1 去掉全部 cov 特征 / M4 去掉标题命中**：Δ 均为 0.000 —— 未区分。

---

## 5. 本轮发现并修正的一个严重构造缺陷（必须记录）

第一版决策器在 dev 上恒为 0.098，且**训练模型与零参数 cov12 完全相同、5 个变异全为 Δ=0.000**。

**根因**：task-22 采集 issue 时用了 `is:issue is:closed` 过滤，导致**候选池里 3,157 个候选 100% 都是 closed issue**（实测）。决策器里 `if not [c for c in candidates if status=="open"]: return not-applicable` 因此**恒触发**，模型输出退化为常数。

**修正**：去掉 status 短路，决策器只用严格 LOO 覆盖率与模型 4 类概率。修正后才有 0.235/0.372 这组数字。

> 若不做这一步，本报告会得出「训练与零参数完全一样、模型无区分力」的**错误结论**。这是本轮最重要的自检点。

---

## 6. 未参与训练的外部留出

**51 包（heldout）全程未标注、未训练、未选型、未做变异**，是真实外部留出。

本轮**未使用**它，因为：

1. 该留出没有标签（标注预算只覆盖 train+dev），无法直接算指标；
2. 若要给它打标签再评估，需要在**另一个独立上下文**里另行标注，且必须先把模型冻结 —— 本轮模型尚未达到值得这样做的水平（dev 0.372）。

⇒ 如实记录：**外部留出已保留但未评估**。

---

## 7. 未验边界与已知限制（单列）

1. **人工金标 0 条**。全部标签 `labelOrigin=model-reviewed`，**不冒充 human-reviewed**，也未做人工仲裁。
2. **标注者与训练者为同一模型家族**（glm-5.3-flash 标注 / numpy 模型训练）。虽然标注与训练是两个独立过程，但**标签与模型可能共享同类偏好**，这一点无法排除。
3. **候选池 100% 是 closed issue**（task-22 采集口径所限），`not-applicable` 与 `attach-existing` 的区分因此比真实场景更容易，指标**偏乐观**。
4. **仅两个仓库、Python 生态**，django 未提供 issue 语料。
5. **dev 只有 51 例**，单次划分，未做交叉验证；0.372 与 0.314 的差距（约 3 例）**在统计上不稳健**。
6. **真实 HOST 未验**，跨设备/跨时区未验。
7. **未做四态以外的判定**（如伞事件、跨语言专项），数据集中无对应标签。
8. **19 个包标注超时失败**（120s 上限），已如实丢弃、未重试填充。
9. 未使用 E5 / LoRA / RL；不称 RL。
10. **生产未启用**：cov12 与训练模型均未接入任何生产路径。

---

## 8. 结论与建议

**是否得到了较可靠的模型？** —— **没有。**

理由：dev 0.372 相对多数类 0.314 只高 5.8 个百分点，51 例样本下约等于 3 条样本的差异，**不足以支撑「可靠」**；误 attach 反而比零参数多 1 例。

**但本轮产出了三个可复用的确定结论**：

1. 外部真实事件 + 独立模型四态标注这条路径**技术上可行**：129 条标签、0 解析失败、结构一致率 72.9%。
2. **训练模型首次超过零参数基线**（0.372 vs 0.235），且 M5 变异证明信号真实 —— 之前三轮的「训练无收益」在**有足够类别多样性**时不再成立。
3. **候选池状态单一是主要瓶颈**：全部 closed 让 `not-applicable` 判定虚高，这是下一轮首先要修的构造问题。

**建议（按优先级）**：

1. **重采候选池**：加入 open issue（去掉 `is:closed` 过滤），让 `attach-existing` vs `not-applicable` 的区分恢复真实难度；这比换模型/调参更可能提升。
2. 给 heldout 51 包在**独立新上下文**打标签，做一次真正的留出评估（需要冻结模型）。
3. 扩大标注量到 500+ 包，再做一次；当前 dev 51 例的方差太大。
4. **不要**把这套标签当作 human-reviewed 金标使用。

---

## 9. 产物清单

全部 10 个文件 / 9783266 字节，逐文件 sha256 见 `data/MANIFEST.json`。

| 路径（相对 lab 根） | 字节 | sha256 前 16 |
|---|---|---|
| data/dataset.json | 2297061 | c3784e81890e6988 |
| data/packs.json | 7183761 | d9a3f982d29e514f |
| inputs/frozen-inputs.json | 1467 | 26421f87095b0109 |
| logs/label.log | 1213 | 7e4a868ef258793d |
| logs/labels-partial.json | 254302 | 97b4c94a78a4b573 |
| runs/train.json | 20679 | c574cfad54a9bed7 |
| scripts/et-train.py | 8079 | a5243184c8dc7af4 |
| scripts/s1-build-packs.mjs | 5681 | d6c750d9dbc71f35 |
| scripts/s2-label.mjs | 6152 | 8f791a22a4a8f7b5 |
| scripts/s3-features.mjs | 4871 | 28881a0cfdd5c01c |

复算入口：

```bash
# 1) 由真实 GitHub 原始数据构造证据包（不消耗 API）
node scripts/s1-build-packs.mjs     # 191 包 → train81/dev59/heldout51
# 2) 独立上下文模型四态标注（model-reviewed）
node scripts/s2-label.mjs           # 129 条，830,755 tokens
# 3) 严格 LOO 特征
node scripts/s3-features.mjs        # 3,157 候选行
# 4) 零参数基线 + 训练 + 严格变异
"<dsh-python>" scripts/et-train.py  # 产出 runs/train.json
```
