# 2.3 第三轮：真实 train/dev、严格 LOO 与可迁移性诊断 —— 结果报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-21）
> 依据：[PROMPT-EVENT-ATTRIBUTION-LAB-ROUND3-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-LAB-ROUND3-20261116.md)
> 隔离目录：`artifacts/_event-attribution-lab-round3-20261116/`（9 个文件 / 26598204 字节）
> 性质：**监督训练实验**。`trainingNotRun: false`；`productionEnabled: false`；`humanReviewed: false`；未改lib/、未装依赖、未转换公开轨迹、未碰真实记忆。
> Lead核对：落盘train-eval.json的split/候选计数与cov12=0.7253、LR=0.3251一致；两次完整run_code复跑120s超时且无后台job，不宣称完整复跑通过。cov12仅作实验候选，不直接生产。

---

## 0. 结论：真实数据上，训练反而让结果变差

**候选级 top-1 命中率（真实冻结 benchmark，严格留出）**：

| 臂 | 类型 | train | dev | **test** |
|---|---|---|---|---|
| baseline-random | 零参数 | 0.118 | 0.000 | **0.099** |
| baseline-status-only | 零参数 | 0.000 | 0.000 | **0.152** |
| baseline-cov12-only | 零参数 | 0.529 | 0.625 | **0.725** |
| trained-lr | 训练 | 0.882 | 0.875 | **0.325** |

**三条必须直说的结论**：

1. **零参数的 `cov12`（只用严格 LOO 的 12-gram 覆盖率排序）在真实 test 上是 0.725**，而**训练出的模型只有 0.325**。
2. 训练模型 dev=0.875 但 test=0.325，**PR-AUC 从 dev 的 0.8895 掉到 test 的 0.0828** —— 典型过拟合到 9 个训练事件。
3. 因此本轮**不宣称任何改进**：真实可用训练数据不足，监督训练在此规模下**劣于不训练**。这是本轮的核心交付。

---

## 1. 真实数据结构（实测，决定了整轮可行性）

冻结输入指纹见 `inputs/frozen-inputs.json`（9 份，含 benchmark 85,462,282 B / sha256 `25a1724dc0ff4817…`、event-store 3,755,866 B / `550751ddc6c0e9c2…`）。

### 1.1 每个 split 都是单类

| 组 | n | gold | split |
|---|---|---|---|
| historicalWeak | 744 | **全部 attach-existing** | dev 92 / test 652 |
| ruleSupportedDirectId | 61 | 全部 attach-existing | test |
| source-review-path-only | 18 | 全部 attach-existing | test |
| originTimeReplay | 24 | 全部 create-new | test |
| protocolConflict | 30 | 全部 ambiguous | test |
| protocolClosed | 119 | 全部 not-applicable | test |

⇒ **decision-level 四分类无法从真实数据训练**：任何单一 split 内都没有类别变化。
⇒ 本轮因此改做 **candidate-level 排序**：正例 = 该候选即 gold 事件。这是真实数据里唯一有正负样本的监督任务（744 正 / 18,257 负，正例率 3.92%）。

### 1.2 真实独立事件只有 19 个，且一个事件占 59/92 例

原 dev 的 92 例 = **19 个独立事件**（事件与重复族一一对应）：

```
evt_9c357363: 59 例   ← 单事件占 64%
evt_9c37bcbb:  5 例
evt_256ca517:  3 例   evt_58537be3: 3 例   evt_600c6d4a: 3 例
evt_0feff853:  2 例   evt_aaff3fd6: 2 例   evt_e1940b9f: 2 例
evt_fe275b34:  2 例   evt_7b9e4471: 2 例
其余 9 个事件各 1 例
```

**任何按事件切分都会让 `evt_9c357363` 独占一侧**，使该侧退化为「单事件训练集」。这不是算法问题，是数据分布问题。

---

## 2. 切分方案（严格隔离，含两次自我纠错）

### 2.1 最终方案

| 量 | train | dev | test |
|---|---|---|---|
| case | **17** | **16** | **892** |
| 独立事件 | 9 | 9 | 25 |
| 候选行 | 17正 / 522负 | 16正 / 419负 | 731正 / 20559负 |

规则：

- **train/dev 取自教师轮原 dev 的 19 个事件**；排除 `evt_9c357363`（59 例超大簇，单列 `heldout-bigcluster`），其余 18 个事件按 LPT 均衡分成 9/9。
- **test 冻结**，并剔除与 train/dev 共享事件或族的 12 例（`originTimeReplay` 10 + `protocolConflict` 2）。
- 隔离复算：**事件交集 0 / 族交集 0**（train↔dev、train↔test、dev↔test 三对全为 0）。
- **来源路径仍有 1 处重叠**（train↔test 的 `lib/index.js`、dev↔test 的 `tools/run-smoke.mjs`）：同一代码文件被不同事件的不同记录引用，**不是事件级泄漏**。若强求源路径不交，train 将无数据可用。**如实标注为已知未隔离维度**。

### 2.2 两次自我纠错（都写进报告，不隐藏）

| # | 先做的错事 | 实测后果 | 纠正 |
|---|---|---|---|
| A | 第一版把 `null` 的 `sourcePath` 放进 Set 比对 | 报出「train↔test 来源重叠 800 条」的假泄漏 | 过滤 `null`/空串后再比对；真实重叠降到 1–2 条 |
| B | 第二版把「被任何 test 视图引用过的事件」全部排除出训练 | 隔离率 100%，但 train 只剩 **5 例**、dev **4 例** | 改为「test 剔除共享事件的 case」而非「train 剔除共享事件」——保住 92 例可训练池，test 减少 12 例 |

> 若不做 A 的纠正，会得出「真实数据完全泄漏」的错误结论；若不做 B 的纠正，会在 5 例上训练并宣称结果。两者都是必须避免的。

---

## 3. 证据视野对齐与严格 LOO

### 3.1 候选级证据（训练/推理同口径）

同一个 `featurize()` 函数同时用于训练、验证与测试，23 维确定性特征：

| 组 | 特征 |
|---|---|
| LOO 覆盖（核心） | `cov3` `cov5` `cov8` `cov12` |
| 语料规模/结构 | `logCorpusChars` `logKept` `dropRatio` `logMedCp` |
| 确定性重叠 | `numOverlap` `pathOverlap` `hexOverlap` |
| 语言/字面 | `zhAbsDiff` `zhRatioRec` `nameInRec` `summaryInRec` |
| 状态/时间 | `stActive` `stClosed` `stPaused` `createdBefore` `dtNorm` |
| 其它 | `isUmbrella` `recLen` `candCpCount` |

### 3.2 严格 LOO（禁止 self-leak）

对每个候选的**全部**检查点做逐条判定，剔除「就是这条记录」的：

```js
isSelf(cpText, recText): 归一化后相等 || 记录前缀出现在检查点中 || 检查点前缀出现在记录中
```

**实测**：996 例 / 23,951 个候选全部可在冻结事件库解析（100%），其中 **653 个候选的 LOO 后语料为空**（`emptyLooCandidates: 653`）——这些候选只剩 name/summary 可用，如实保留不丢弃。

> 这条是第二轮教训的延续：**全量语料覆盖率对 gold 恒为 1.0，是自引用**；只有 LOO 是诚实视野。

---

## 4. 训练与评估

### 4.1 实现

- numpy 手写逻辑回归（本机无 sklearn，已实测）；Adam，600 epochs，lr=0.1，L2=1e-3；类别不均衡加权（posWeight=30.71）
- W 零初始化、不消耗随机数；`W_norm=5.8839`、`W_sha256=46dfd4f2c0d33d81`
- **参数确实更新**：train PR-AUC `0.0549` → `0.8721`

### 4.2 按组分解（test，候选级 top-1）

| 组 | n | trained-lr 命中 | **cov12-only 命中** |
|---|---|---|---|
| historicalWeak | 652 | 277 (42.5%) | **580 (89.0%)** |
| ruleSupportedDirectId | 61 | 11 (18.0%) | **60 (98.4%)** |
| source-review-path-only | 18 | 2 (11.1%) | **7 (38.9%)** |
| originTimeReplay | 14 | 0 (0.0%) | **0 (0.0%)** |
| protocolConflict | 28 | 0 (0.0%) | **0 (0.0%)** |
| protocolClosed | 119 | 0 (0.0%) | **0 (0.0%)** |

**读法**：

- `historicalWeak`（652 例）：cov12 **580/652 = 89.0%**，训练模型仅 277/652 = 42.5%。
- `ruleSupportedDirectId`（61 例）：cov12 **60/61 = 98.4%**，训练模型 11/61 = 18.0%。
- `originTimeReplay` / `protocolConflict` / `protocolClosed` 三组**两个臂都是 0 命中** —— 因为这些组的候选里没有「正确目标」（该新建/该 ambiguous/该 not-applicable），候选级 top-1 指标对它们**不适用**，本轮不据此下结论。

### 4.3 严格变异（|Δ|>0.05）

| 变异 | dev top-1 | Δ | 判定 |
|---|---|---|---|
| M1-drop-loo | 0.9375 | +0.0625 | **CAUGHT** |
| M2-drop-status | 0.875 | 0 | **未区分** |
| M3-drop-overlap | 0.875 | 0 | **未区分** |
| M4-drop-lexical | 0.875 | 0 | **未区分** |
| M5-shuffle-labels | 0.0625 | -0.8125 | **CAUGHT** |

**2/5 被区分**。

- **M5 打乱标签**：0.875 → 0.063 —— **强证据**，管线确实在学习。
- **M1 去掉全部 LOO 特征**：0.875 → 0.938，**Δ=+0.063 被判 CAUGHT，但方向是变好** —— 说明 LOO 特征在 9 事件训练集上是**负贡献**。
- **M2/M3/M4 全部未区分（Δ=0.000）**：在 17 例正例上，去掉 status、去掉确定性重叠、去掉字面特征都**不影响** dev 表现 —— 这是样本量不足的直接证据，不是特征不重要。

---

## 5. 失败归因

### 5.1 为什么训练模型 test 只有 0.325

| 原因 | 证据 |
|---|---|
| 训练事件极少 | 9 个独立事件 / 17 个正例。逻辑回归有 23 个参数，参数数 > 正例数 |
| dev 不可信 | dev 仅 16 例 / 9 事件，dev 与 test 差距 0.875 → 0.325 说明 dev 无法代表 test |
| 零参数基线本就很强 | cov12 在 test 上 0.725 —— 严格 LOO 覆盖率本身已经是强判据，训练难以超过 |
| 变异显示特征无用 | M2/M3/M4 全 Δ=0.000；M1 去掉 LOO 反而 +0.063 |

### 5.2 这解释了两轮以来的困惑

第二轮的结论是「合成的 0.94 涨了但真实的 0.60 没动」。本轮给出直接答案：

**真实数据上的可训练信号量本身不足。** 不是特征不够好，不是模型不够复杂，是**独立事件只有 19 个、其中 1 个占 64%**。在这个规模上，任何监督模型都会被零参数的覆盖率排序打败。

---

## 6. 未验边界与已知限制（单列）

1. **人工金标：0 条**。全部标签来自教师轮冻结 benchmark（`historicalWeak` 为弱标签 / `sourceVerified: 0`）。
2. **真实 HOST 未验**：未在真实宿主跑过归属判定。
3. **跨设备 / 跨时区未验**。
4. **公开轨迹未转换**：按任务书，B1（parquet 解码能力）第二轮已阻塞，本轮未安装依赖、未做转换。
5. **未用 E5 / LoRA / RL**：监督训练，无奖励、无多策略、无策略梯度。**不称 RL**。
6. **生产未启用**：无 attach/merge/archive 写操作。
7. **来源路径未完全隔离**：train↔test 有 1 个共享文件路径（`lib/index.js`）、dev↔test 有 1 个（`tools/run-smoke.mjs`）。事件与族已完全隔离。
8. **`evt_9c357363`（59 例）被单列为 heldout-bigcluster**，未参与训练/验证/模型选择，也未计入 test 指标。
9. **decision-level 四分类未训练**：真实数据每个 split 单类，无法训练；本轮指标全部是 candidate-level 排序，**不能外推为归属判定准确率**。
10. **`originTimeReplay` / `protocolConflict` / `protocolClosed` 三组的候选级 top-1 恒为 0**，是任务定义不适用，不是模型失败；本轮不对这三组下结论。

---

## 7. 下一轮建议（基于本轮实测）

1. **不要再在真实 benchmark 上做监督训练**。19 个事件、1 个占 64%，已达上限。要么扩充真实事件库，要么承认「覆盖率排序 + 规则」就是当前最优。
2. **把 cov12（严格 LOO 覆盖率）作为生产候选排序的默认特征**：它在真实 test 上 0.725，且零参数、可复算、无过拟合风险。
3. **`historicalWeak` 已是 89% 可解**（cov12 580/652）。真正未解的是「该新建 / 该 ambiguous / 该 not-applicable」三类，而它们在真实数据里**没有候选级正例**，需要另一套任务定义（如 case-level 二分类：是否存在可 attach 目标）。
4. **若用户批准安装 `pyarrow`**：公开轨迹可提供新的独立事件源，是唯一能突破 19 事件上限的路径。

---

## 8. 产物清单

全部 9 个文件 / 26598204 字节，逐文件 sha256 见 `data/MANIFEST.json`。

| 路径（相对 lab 根） | 字节 | sha256 前 16 |
|---|---|---|
| data/real-dataset-split.json | 7933721 | aabf05c28600f2ec |
| data/real-dataset.json | 18630717 | fdfe405dc06fc2ff |
| data/split.json | 1884 | 6b40db8cce88adaf |
| inputs/frozen-inputs.json | 2124 | a310a7399934a0b6 |
| logs/build-dataset.log | 433 | 1a3b20f90c6462ea |
| runs/train-eval.json | 8157 | 90cbc9e1d42b7a4f |
| scripts/r3-train.py | 7332 | cfa6d54f3a7a2e6f |
| scripts/s1-build-real-dataset.mjs | 7690 | fe88e7277d97fd14 |
| scripts/s2-split.mjs | 6146 | 30384c4d4fc032ac |

复算入口：

```bash
# 1) 真实 benchmark → candidate-level 数据集（严格 LOO）
node scripts/s1-build-real-dataset.mjs      # 约 4 分钟，产出 data/real-dataset.json 18.6MB
# 2) 严格隔离切分
node scripts/s2-split.mjs                   # 产出 data/split.json + real-dataset-split.json
# 3) 零参数基线 + 训练 + 严格变异
"<dsh-python>" scripts/r3-train.py          # 产出 runs/train-eval.json
```
