# 2.3 外部候选池重采、500+ 标注与冻结留出评估 —— 结果报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-24）
> 依据：[PROMPT-EVENT-ATTRIBUTION-EXTERNAL-EXPANDED-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-EXTERNAL-EXPANDED-20261116.md)
> 隔离目录：`artifacts/_event-attribution-external-expanded-20261116/`（25 文件 / 121989258 字节）
> 性质：**训练 + 冻结留出评估**。`labelOrigin: model-reviewed`（非 human-reviewed）；`productionEnabled: false`；未改lib/、未装依赖、未碰真实记忆/19387。
> Lead复核（2026-11-16）：独立复跑 s5-train.py / s8-eval-heldout.py 均 EXIT=0；153留出 frozen 48/153=0.3137 vs cov12 0.3203，与报告一致；标签仍非人工金标。

---

## 0. 结论：修好候选池后，**训练模型在真实留出上没能赢过零参数基线**

| 阶段 | 训练集(520包) dev | **真实留出(153包，冻结模型)** |
|---|---|---|
| trained / frozen-model | **0.3387** | **0.3137** |
| zero-cov12（严格 LOO） | 0.2043 | **0.3203** |
| zero-majority | 0.2419 | 0.2288 |
| macro-F1 | — | 模型 **0.2779** vs cov12 0.2148 |

**三条必须同时说出的事实**：

1. **dev 上模型大幅领先**（0.3387 vs cov12 0.2043），但**冻结后在真实留出上反被 cov12 反超**（0.3137 vs 0.3203）。
2. 差距虽小（0.0066 ≈ 1 例），但**方向是负的** —— 不能宣称「训练模型更好」。
3. 模型 macro-F1 **0.2779 高于** cov12 的 0.2148 —— 模型在少数类（ambiguous / not-applicable）上更均衡，cov12 只押 attach。这是模型唯一可辩护的优势，但不足以支撑「更准」。

**这正是为什么必须先冻结再评估**：若只看 dev，会得出「模型领先 13.4 个百分点」的错误结论。

---

## 1. 先修上轮的候选池缺陷（本轮第一优先级）

上轮（task-23）实测：**4,730 个候选 100% 是 closed issue**，原因是采集用了 `is:issue is:closed` 过滤。

**本轮修正**：

- 去掉 `is:closed` 限制，对每仓库分别检索 `is:open` 与 `is:closed` 再合并，保证两类都进池。
- 候选状态**按记录时刻判定**（用 `closedAt` 与 `recordAt` 比较），**不用当前 `state` 覆盖历史状态**。
- 每包记录 `openRatio`。

**修复结果（实测）**：

| 量 | 上轮 | **本轮** |
|---|---|---|
| 候选总数 | 4,730 | **61,509** |
| 记录时刻 open | 0 | **31,529** |
| 记录时刻 closed | 4,730 | 29,980 |
| **openRatio** | **0.0000** | **0.5126** |

采集到的原始 issue：**421 个**（open 181 / closed 240），来自 4 个仓库。

---

## 2. 数据来源、许可与指纹

| 仓库 | 许可 | issue | open | closed |
|---|---|---|---|---|
| `pallets/flask` | **BSD-3-Clause** | 88 包 | — | — |
| `psf/requests` | **Apache-2.0** | 375 包 | — | — |
| `urllib3/urllib3` | **MIT** | 261 包 | — | — |
| `pytest-dev/pytest` | **MIT** | 300 包 | — | — |

**采集请求：850 次**（GitHub REST API v3，认证配额 5000/h）。token 从本机 `gh auth token` 读入内存，落盘前做 `payload.includes(TOKEN)` 断言（命中即 `exit 2`），产物实测无 token 模式。每条请求的 url/status/bytes/sha256/剩余配额都记在 `raw/github-mixed.json` 的 `requests[]`。

---

## 3. 事件构造与四态来源

四态由**真实结构关系**推导，不是随意指定：

| 四态 | 来源 |
|---|---|
| `attach-existing` | 评论发生在该 issue 关闭**之前** ⇒ 当时可接收 |
| `not-applicable` | 评论发生在该 issue 关闭**之后** ⇒ 唯一同文容器已关闭 |
| `create-new` | issue 创建正文，记录时刻自身尚不存在（LOO 剔除自身） |
| `ambiguous` | **无结构真值**，完全由标注者判 |

包总数 **1,024**，按 repo+issue 确定性哈希分桶（同族不跨桶）：

| split | 包数 | 状态 |
|---|---|---|
| train | 580 | 已标注 334，参与训练 |
| dev | 291 | 已标注 186，用于选型/变异 |
| **heldout** | **153** | **训练期间未标注、未训练；仅在模型冻结后独立标注并评估** |

另有 361 个包因标注预算未标注，**如实保留为未用池，未凑数**。

**实际标注量：520 包**（533 条尝试，13 条失败），**达到 500+ 目标**。

---

## 4. 独立标注

| 项 | 值 |
|---|---|
| 标注者 | `glm-5.3-flash`，temperature=0，独立新上下文 |
| 可见信息 | 仅记录正文 + 候选。**看不到** structuralHint / goldEventId / splitGroup / 训练结果 |
| `labelOrigin` | `model-reviewed`（**非 human-reviewed**） |
| `sourceKind` | `public-derived` |
| 训练集标注 | 520 条，解析失败 0 |
| heldout 标注 | 153 条，**在模型冻结后单独执行**，独立文件 `logs/labels-heldout.json` |

**四态分布（520 条训练标签）**：{"attach-existing":289,"not-applicable":26,"ambiguous":64,"create-new":141}

**旁证：结构提示 vs 模型决策一致率**：416/540 = 77.0%（上轮 72.9%，本轮略升）。**这不是标签准确率**，按任务书「一致性不等于正确」。

---

## 5. 训练与严格变异

```json
{
  "epochs": 500,
  "lr": 0.08,
  "l2": 0.001,
  "optimizer": "Adam",
  "classWeighted": true,
  "init": {
    "classWeight": [
      27.541666666666668,
      0.2961298340944563,
      2.2176406926406926,
      7.360272988505747
    ]
  },
  "seed": 20261116
}
```

`W_shape=[17,4]`，`W_sha256=36dd5761a80c28c2`（**W 数值已落盘 `runs/frozen-model.json`，可复现**）

**分类别（dev, n=186）**：

| 类 | support | P | R | F1 |
|---|---|---|---|---|
| attach-existing | 103 | 0.5855 | 0.8641 | 0.698 |
| create-new | 45 | 0.6 | 0.2 | 0.3 |
| ambiguous | 28 | 0.2941 | 0.1786 | 0.2222 |
| not-applicable | 10 | 0 | 0 | 0 |

**严格变异 3/5**：

| 变异 | dev | Δ | 判定 |
|---|---|---|---|
| M1-drop-cov | 0.2473 | -0.0914 | **CAUGHT** |
| M2-drop-closed | 0.2473 | -0.0914 | **CAUGHT** |
| M3-drop-overlap | 0.3333 | -0.0054 | 未区分 |
| M4-drop-title | 0.3387 | 0 | 未区分 |
| M5-shuffle-labels | 0.1774 | -0.1613 | **CAUGHT** |

- M5 打乱标签 0.339→0.177（Δ−0.161）**CAUGHT** — 管线确实在学习
- M1 去全部 cov / M2 去 closed 特征：各 −0.091 **CAUGHT** — 两类特征都有实质贡献
- M3 去确定性重叠 / M4 去标题命中：Δ≈0 未区分

---

## 6. 冻结留出评估（本轮最关键一步）

**冻结流程**：

1. 训练配置与参数先固定（epochs=500 / lr=0.08 / l2=1e-3 / Adam / seed=20261116）；
2. 训练完成后把 `W / b / mu / sd` 数值落盘到 `runs/frozen-model.json`；
3. **heldout 153 包此时才第一次标注**（独立文件、独立运行）；
4. 评估脚本 `s8-eval-heldout.py` 只读冻结权重，**零训练、零选型**。

> 自检发现：首版 `train.json` 只存了 `W_sha256` 而没存 W 数值，**无法冻结复现**。已修正为落盘数值后重跑。若不做这一步，「冻结评估」会是假的。

**结果（heldout n=153，9663 行候选）**：

| 臂 | acc | macro-F1 | 错误分布 |
|---|---|---|---|
| frozen-model | **0.3137** | 0.2779 | {"other":41,"over-ambiguous":35,"false-create":24,"false-attach-closed":1,"false-attach":4} |
| zero-cov12 | **0.3203** | 0.2148 | {"false-attach":21,"false-create":49,"other":29,"false-attach-closed":5} |
| zero-majority | **0.2288** | 0.1717 | {"other":58,"false-attach":51,"false-attach-closed":9} |

**按 gold 类分组（frozen-model）**：

| 类 | n | 命中 |
|---|---|---|
| attach-existing | 80 | 3 (3.8%) |
| create-new | 51 | 34 (66.7%) |
| ambiguous | 13 | 10 (76.9%) |
| not-applicable | 9 | 1 (11.1%) |

**与上轮（task-23）的对照 —— 只作历史，不可直接相减**：

| 轮次 | 候选池 openRatio | dev | 留出 | 结论 |
|---|---|---|---|---|
| task-23 | **0.0000**（全 closed） | 0.372 | 未评估 | 指标偏乐观 |
| **task-24** | **0.5126** | 0.3387 | **0.3137 vs cov12 0.3203** | **模型未赢** |

两轮候选池不同，**分数不能直接比较**。可比的只有「同池内模型 vs 零参数」：本轮模型**输** 0.0066。

---

## 7. 未验边界与已知限制

1. **人工金标 0 条**。全部 `labelOrigin=model-reviewed`，**不冒充 human-reviewed**，无仲裁。
2. **标注者与训练者同模型家族**，同类偏好无法排除。
3. **heldout 用的是同一标注器**（不同运行、不同文件、模型已冻结），因此 heldout 评估的是「对模型标签的拟合」，**不等于对真实归属的准确率**。
4. **361 个包未标注**，如实保留为未用池，未凑数。
5. **13 条标注失败**（超时），已如实记录未静默重试。
6. 仅 4 个仓库、Python 生态；`pallets/flask` 的 open issue 只有 1 个（该项目 issue 多为 PR 流转），使其候选池偏 closed。
7. **真实 HOST 未验**，跨设备/跨时区未验。
8. **未做跨语言/伞事件专项**：数据集中无对应标签。
9. 未使用 E5 / LoRA / RL；**不称 RL**。
10. **生产未启用**。

---

## 8. 结论与建议

**是否得到较可靠的模型？—— 没有。**

修好候选池、扩到 520 标注、并做了真正的冻结留出评估之后，结论是：**训练模型在真实留出上未能超过一个零参数的覆盖率排序器**（0.3137 vs 0.3203）。dev 上的领先没有迁移。

**本轮三个确定产出**：

1. **候选池缺陷已修复且可验证**：openRatio 0 → **0.5126**，问题不复现。
2. **首次完成真正的冻结留出评估**（W 落盘、heldout 独立标注、零训练评估），方法论闭环成立。
3. **量化了 dev→留出的落差**：模型 0.3387→0.3137（−0.025），而 cov12 0.2043→0.3203（**+0.116**）—— 说明 cov12 在 dev 上被低估，模型在 dev 上被高估。

**建议**：

1. **停止在此数据上继续加标注/调参**。520 标注、1,024 包已证明模型打不过 cov12，继续加量收益不明。
2. 若要继续，方向应是**换任务定义**（例如 case 级二分类「是否存在可 attach 目标」），而不是继续四态多分类。
3. 模型唯一可辩护优势是 macro-F1（0.2779 vs 0.2148）—— 若产品上更在意「少数类不被吞掉」而非总体准确率，可考虑 **cov12 + 模型混合**，但这需要另立实验验证。
4. **不要**把这批标签当 human-reviewed 金标使用。

---

## 9. 产物清单

全部 25 个文件 / 121989258 字节，逐文件 sha256 见 `data/MANIFEST.json`。

| 路径（相对 lab 根） | 字节 | sha256 前 16 |
|---|---|---|
| data/agreement.json | 53 | e56cd3f1dc8055d7 |
| data/dataset-heldout.json | 6979561 | fca41dce25bccb1b |
| data/dataset.json | 22108200 | 3daa6cd4f5dd1d90 |
| data/packs.json | 89600762 | 184194eda005a383 |
| inputs/frozen-inputs.json | 1462 | e52efd13b4e46f40 |
| logs/label-heldout.log | 556 | 4cb57350d78fb847 |
| logs/label.log | 643 | a419dbcffbf8c070 |
| logs/label2.log | 602 | 2daa2924953d13c2 |
| logs/label3.log | 199 | 9625c9b521880f6b |
| logs/label4.log | 1036 | 27c1ecf4fbc60ca8 |
| logs/labels-heldout.json | 300319 | f42cb00c0f6c3c02 |
| logs/labels-partial.json | 1065151 | f327bdc770bccf8e |
| logs/recollect.log | 684 | 0dc4d5b73fcbb5b5 |
| raw/github-mixed.json | 1854335 | 496535e4ff4816fb |
| runs/frozen-model.json | 2631 | a7f032ed892b6cdd |
| runs/heldout-eval.json | 6546 | 1bb2b1cc1fa13835 |
| runs/train.json | 21489 | 57ed5ffcdefa6da8 |
| scripts/s1-recollect.mjs | 4122 | 8eb26856113d649b |
| scripts/s2-build-packs.mjs | 5451 | d9922dabf30cbc2e |
| scripts/s3-label.mjs | 6378 | 2541019f23ea1884 |
| scripts/s4-features.mjs | 4922 | 360fff8ce8945e5c |
| scripts/s5-train.py | 9182 | ac0f070cd43f8e84 |
| scripts/s6-label-heldout.mjs | 6387 | c3d6819ada8bc52e |
| scripts/s7-features-heldout.mjs | 4932 | d409b2f91195a864 |
| scripts/s8-eval-heldout.py | 3655 | 1b34ef3c71579d2e |

复算入口：

```bash
node scripts/s1-recollect.mjs        # 850 请求，混合 open/closed
node scripts/s2-build-packs.mjs      # 1,024 包，openRatio 0.5126
node scripts/s3-label.mjs            # 训练集标注（520）
node scripts/s4-features.mjs         # 31,195 候选行
"<dsh-python>" scripts/s5-train.py   # 训练 + 严格变异 + 冻结权重落盘
node scripts/s6-label-heldout.mjs    # 冻结后独立标注 heldout（153）
node scripts/s7-features-heldout.mjs
"<dsh-python>" scripts/s8-eval-heldout.py  # 零训练冻结评估
```
