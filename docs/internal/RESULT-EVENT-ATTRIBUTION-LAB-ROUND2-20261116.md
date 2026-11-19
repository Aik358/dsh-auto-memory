# 2.3 第二轮：证据视野、真实分布与公开轨迹转换 —— 结果报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-20）
> 依据：[PROMPT-EVENT-ATTRIBUTION-LAB-ROUND2-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-LAB-ROUND2-20261116.md) · 首轮 [RESULT-EVENT-ATTRIBUTION-LAB-20261116.md](file:///D:/dsh-auto-memory/docs/internal/RESULT-EVENT-ATTRIBUTION-LAB-20261116.md)
> 隔离目录：`artifacts/_event-attribution-lab-round2-20261116/`（39 个文件 / 143927955 字节，含 127 MB 合成集与 15.7 MB 富化真实集）
> 性质：**监督训练实验**。`trainingNotRun: false`（已真训练）；`productionEnabled: false`；`humanReviewed: false`；未碰真实记忆/19387。
> Lead复核（2026-11-16）：按 §9 权威管道运行 `r2-run2.py` / `r2-run3.py` 均 EXIT=0，四臂真实结果与报告一致；严格变异3/5。直接运行旧 `r2-run1.py` 会因 case 缺 `_feats` 报 KeyError，须用 §9 的特征装配+评估入口。

---

## 0. 结论：本轮的改进没有转化成真实迁移改善

任务书要求「先修候选证据视野与真实分布」。**我修了，而且合成集上确实大幅提升**（test caseAcc 0.400 → 0.800 / 0.941）。
**但真实留出集没有跟着变好，甚至略差。**

| 臂 | 特征 | 合成 test | **真实留出** | 误 attach | 误新建 | 过度 ambiguous |
|---|---|---|---|---|---|---|
| 首轮（对照，同一 15 例） | 26 维旧视野 | 0.867 | **9/15 = 0.600** | 0 | 3 | 2 |
| A-excerpt-only | 仅 3 条摘录覆盖 | 0.400 | **8/15 = 0.533** | 1 | 5 | 0 |
| B-loo-evidence（modelLabel） | 24 维 LOO 视野 | 0.800 | **7/15 = 0.467** | 0 | 2 | 5 |
| B-loo-evidence（provableLabel） | 24 维 LOO 视野 | 0.941 | **9/15 = 0.600** | 0 | 5 | 0 |

**必须直说**：真实留出最好也只有 **9/15 = 0.600**，与首轮持平，**没有任何提升**。合成集与真实集之间的 0.94 vs 0.60 是**跨源鸿沟**，不是训练不足。
更糟的信号在 §5：**去掉全部 LOO 特征后 caseAcc 只掉 0.012（噪声级）** —— 说明模型根本没把这批新特征用于真实判别。

---

## 1. 基线订正（完整保留，未推翻）

| # | 结论 | 本轮处置 |
|---|---|---|
| **C2** | 「可见证据包存在同文泄漏」**不成立** —— 12-gram 包含度最高 0.350，0/20 达阈值，逐字相同 0 条 | 保留。本轮 46 个候选全部复验，未见可见泄漏 |
| **C4** | 教师轮 dev = 92 例，全为 historicalWeak/attach-existing 单类，不能用于选模型 | 保留。本轮 dev 用 synthetic-r2 自建（18 例） |
| **C5** | 首版 synthetic 把正文逐字复制进候选，已改为同内容不同表述，修正后 0/1231 | 保留。本轮 generator 沿用 paraphrase，逐字复制 0 条 |
| **protocolConflict** | 旧弱金标为协议构造，不作训练答案 | 保留。5 例仍排除出训练答案集（`trainingLabelUsable=false`） |

---

## 2. 第一步：修候选证据视野 —— 但实测结论与任务书预期相反

### 2.1 任务书要求的「首 300 字摘要」实测**有害**

我先按任务书字面实现 `checkpointDigest`（每个检查点首 300 字），然后测「gold 候选 vs 非 gold 候选」在该视野下的覆盖率分离度：

| 视野 | gold 均值 | 非 gold 均值 | **分离度** |
|---|---|---|---|
| 原始 3 条摘录（首轮视野） | 0.0352 | 0.0170 | **+0.0182** |
| 首 300 字摘要（任务书要求） | 0.0022 | 0.0157 | **−0.0135（负的）** |
| 全量检查点语料 | 1.0000 | 0.2317 | +0.7683（**但是自引用，见 2.2**） |

**为什么摘要是负的**：真实检查点中位 652 字、最长 27,578 字。首 300 字是账本标题与「## 任务状态」开头，与记录正文**错位**。摘要把长文变成了「开头片段」，反而稀释了真正匹配的段落。
所以本轮**没有把摘要作为主特征**，而是在报告中单列这条反证。这偏离了任务书字面，但符合任务书「修证据视野」的实质目标。

### 2.2 「全量语料」是自引用，不能用

把候选全部检查点语料直接给出去后，覆盖率对 gold 恒等于 **1.0000（15/15）**，看起来是完美信号。
实测真相：**记录正文本身就是该事件的一个检查点**（首轮 C1 已证 14/15 条 `identical=true`）。
做 leave-one-out（剔除「就是这条记录」的检查点）后：

| 组 | covAll | **covLOO** | 自引用贡献 |
|---|---|---|---|
| historicalWeak（5 例） | 1.0000 | **0.2201** | 0.78 |
| 最低单例 | 1.0000 | **0.0620** | 0.94 |

**这才是模型在真实推理时刻能看到的东西**（新记录还没入库）。本轮 LOO 是唯一诚实的证据视野。

### 2.3 特征分布偏移：18/26 → 12/24

| 指标 | 首轮 | 本轮 |
|---|---|---|
| 特征数 | 26 | 24 |
| 偏移 >0.8σ | **18（69.2%）** | **12（50.0%）** |

任务书点名要求修的三项：

| 特征 | 首轮 gap | 本轮 gap | 说明 |
|---|---|---|---|
| `len_ratio_r` | 2.559 | **0.444** | **已修复**（改用单条检查点中位长度为分母） |
| `path_overlap` | 2.002 | **1.083** | 改善但仍超阈（只统计检查点正文，排除 name/summary） |
| `jac3` | 1.345 | **7.676**（变差） | **未修复，如实报告** |

**`jac3` 为什么变差**：真实 gold 候选语料 456,401 字（160 检查点），synthetic 只有约 20,000 字。jaccard 的分母被长语料稀释 —— 真实 jac3=0.0161 不是「不相关」，而是分母巨大。
我第一版用 p10..p90 几何插值采样检查点数，得中位 22，而真实 p50=**114**（分布左端很重）。改用**经验分布重采样**后合成集平均检查点升到 94.9，`len_ratio_r` 与 `path_overlap` 因此改善，但 `jac3` 仍差一个量级。**这一项没有解决。**

### 2.4 合成集：按真实分布拟合

新增 `data/synthetic-r2.json`（126 例 × 9 场景），长度与结构从 `realfrozen-enriched.json` 拟合：

| 量 | 真实 p10/p50/p90 | 合成实测 |
|---|---|---|
| 记录字数 | 266 / 1117 / 3000 | 536 / 909 / 1713 |
| 检查点数 | 3 / 114 / 160 | 平均 94.9 |
| 中文占比 | 0.207 / 0.273 / 0.411 | 按 p50±0.3 混合采样 |

split：train 91 / dev 18 / test 17，按 familyKey 哈希，**同族不跨 split**。
负路径全保留：S1 诱饵、S3 无候选、S5 closed、S8 伞事件、S9 时间相邻、S7 跨语言、S2/S4/S10 attach。

---

## 3. 模型构造标签

**模型身份**：`worldcodes.online/v1` / **`glm-5.3-flash`** / `temperature=0` / `response_format=json_object`。

**为什么换模型（如实记录，非选择偏好）**：
- `deepseek-v4.1-flash`（首轮用的）本轮返回 **HTTP 429 `Upstream rate limit exceeded`**。单条 prompt（700 字记录 + 多候选摘要）触发限流，**0/126 成功**。
- 自动停止规则生效：连续 8 次失败即 `STOP`，**没有静默重试到满意答案**。
- 换 `glm-5.3-flash` 后返回 200，但它**无视 `response_format`**，把 JSON 包进 `````````json````````` 围栏 ⇒ 首轮 0 解析。加稳健提取（剥围栏 / 取首个平衡花括号）后成功。

**实测**：126 次调用、**118 条成功解析、0 条解析失败**、累计 **549,530 tokens**。中途有 `fetch failed` / `operation was aborted` 各若干（并发 3、单条 120s 超时），未重试。

**双标签一致性**：

| 量 | 值 |
|---|---|
| 模型 vs 构造可证：决策一致 | **80 / 118 = 67.8%** |
| 同上：目标候选一致 | **115 / 118 = 97.5%** |

**S5 closed 已修复**：首轮 14/14 全错（把 closed 容器当成可 attach），本轮 **12/12 全对**。做法是在系统提示里加第 6 条硬约束「status=closed 的事件不可接收新记录，唯一同文容器是 closed 则判 not-applicable」。这是本轮唯一一处**明确生效的模型行为修正**。

**仍未修复的模型偏差**：S1 诱饵 0/14、S9 时间相邻 0/13 —— 模型在这两组一律判 ambiguous 或 attach，而构造规则要求 create-new。与首轮同族。

---

## 4. 训练与真实留出评估

### 4.1 实现

- numpy 手写 softmax（本机无 sklearn/scipy，已实测）；解析梯度 + 全批 Adam；W/b 零初始化、不消耗随机数；400 epochs、lr=0.05、L2=1e-3
- 特征由 JS 侧统一计算后落盘（`data/features-*.json`），Python 只读，避免两套实现漂移
- **参数确实更新**：见下表 before/after

### 4.2 两臂对照（同数据、同标签、只换特征视野）

| 臂 | 标签源 | 训练样本 | trainAcc before → after | 合成 test | **真实留出** |
|---|---|---|---|---|---|
| A-excerpt-only | model | 464 | 0.1078 → **0.5776** | 0.4 | **8/15 = 0.5333** |
| A-excerpt-only | provable | 502 | 0.0976 → **0.8386** | 0.5882 | **8/15 = 0.5333** |
| B-loo-evidence | model | 464 | 0.1078 → **0.7328** | 0.8 | **7/15 = 0.4667** |
| B-loo-evidence | provable | 502 | 0.0976 → **0.8904** | 0.9412 | **9/15 = 0.6** |

### 4.3 真实留出分组（Prompt §5 要求的分组报告）

| 臂 | historicalWeak | originTimeReplay | protocolClosed | 误 attach | 误新建 | 过度 ambiguous |
|---|---|---|---|---|---|---|
| A-excerpt-only(model) | 0/5 | 3/5 | 5/5 | 1 | 5 | 0 |
| A-excerpt-only(provable) | 0/5 | 3/5 | 5/5 | 1 | 5 | 0 |
| B-loo-evidence(model) | 0/5 | 2/5 | 5/5 | 0 | 2 | 5 |
| B-loo-evidence(provable) | 0/5 | 4/5 | 5/5 | 0 | 5 | 0 |

**三点判读**：

1. **`historicalWeak` 四臂全部 0/5**。这是首轮就失败的那一组，本轮**没有一处改善**。真实记录是 1,000–3,000 字交接账本，而候选只给摘要；LOO 语料把 gold 覆盖率从 1.0 拉到 0.22，语义信号仍不足以让分类器选对。
2. **`protocolClosed` 四臂全部 5/5**。「看 status」这条信号最稳，且与特征视野无关。
3. **误 attach 在 B 臂为 0**（A 臂各 1）。这是 Prompt 最看重的危险错误，B 臂没有犯；代价是 over-ambiguous 升到 5（把该 attach 的判成不确定）。

### 4.4 为什么合成集涨了、真实集没涨

合成 test 0.400 → 0.941，真实留出 0.533 → 0.600。**差值来自「合成集内部的自洽性」而不是「学到了可迁移的归属判据」**：

- 合成集的记录与候选共用同一词汇池（同一 domain 的 topics/files），LOO 覆盖率天然高且区分度大；真实集不是。
- 变异实验直接证实：**去掉全部 LOO 特征，caseAcc 只掉 0.012**。模型实际依赖的是 status/时间/结构特征，而不是这批新证据视野。
- 本轮把 `jac3` 从 1.345 推到 7.676，等于在这条最难的特征上**倒退**了。

---

## 5. 区分力变异（严格判据）

首轮教训：用「变异后不高于基线」当判据会把 1–2 个用例的抖动判成 CAUGHT。本轮固定用 **abs(Δ) > 0.05**。

| 变异 | base | mutant | Δ | 判定 |
|---|---|---|---|---|
| M1-no-loo | 0.7647 | 0.7529 | -0.0118 | **未区分** |
| M2-no-structural | 0.7647 | 0.7529 | -0.0118 | **未区分** |
| M3-no-status | 0.7647 | 0.6588 | -0.1059 | **CAUGHT** |
| M4-shuffle-labels | 0.7647 | 0.0706 | -0.6941 | **CAUGHT** |
| M5-only-loo | 0.7647 | 0.0235 | -0.7412 | **CAUGHT** |

**3/5 被区分。** 逐条说清楚：

- **M4 打乱标签**：0.765 → 0.071 —— **强证据**，管线确实在学标签，不是恒定输出。
- **M5 只保留 LOO 特征**：0.765 → 0.024 —— 说明 LOO 单独**不足以**支撑判别（信息不全，不是噪声）。
- **M3 去掉 status/时间**：0.765 → 0.659 —— 这是模型真正依赖的那批特征。
- **M1 去掉全部 LOO**：−0.012、**M2 去掉结构特征**：−0.012 —— **均属噪声，未区分**。这两条是本轮最诚实的负面结果：**新特征对模型没有实质贡献**。

---

## 6. 第二步：公开轨迹小样本转换

### 6.1 许可与可达性（实测）

| 数据集 | 许可 | revision | 文件数 | 元数据 |
|---|---|---|---|---|
| `risenlab/agentlogs` | **cc-by-4.0** | `c58e2be5fb286fb6b25adcccf100b1ff9bd7dc81` | 540 | HTTP 200 |
| `AlienKevin/SWE-ZERO-96K-trajectories` | **apache-2.0** | `b128cdd8172936d1c8359a8efd08bd74ea002205` | 13 | HTTP 200 |

已实际下载一个分片作为样本：`agent_session_logs/part_00000_of_00505.parquet`，**111,770,632 字节**，sha256 `71f0db8015d2af18c69c751cbc203c053783b245b826d24f519a4ead5d51155a`，magic `PAR1`。
SWE-ZERO README（apache-2.0）已取证：列 `instance_id / messages / repo / trajectory_format / exit_status / prompt_tokens / completion_tokens / duration_sec`，消息格式 system/user/assistant。

### 6.2 转换**未执行**，原因是能力阻塞，不是许可问题

| 编号 | 阻塞 | 实测细节 | 状态 |
|---|---|---|---|
| **B1** | parquet 行级解码 | `pyarrow` ✗ / `fastparquet` ✗ / `thrift` ✗ / `snappy` ✗ / `zstandard` ✗ / `lz4` ✗ / node 侧无 parquet 库；**只有 `pandas`（无 parquet engine）** | **BLOCKED** |
| **B2** | 公开轨迹无本插件归属金标 | 只能 `model-reviewed`，不能冒充 `human-reviewed` | ACCEPTED-RISK |
| **B3** | 样本体积 | 单分片 111 MB，全量 540 分片 | SCOPED |

**能做的做了**：从 parquet footer（明文 Thrift）抽出 17 个字段名（`session / entry_index / parsed / data / agent / created / tool_calls / role / content / type / model / index / finish_reason / function_name / function_arguments / reasoning_text / token_count`），并据此写出**可执行转换契约** `public-trajectory-to-events-v1`（见 `public/conversion-contract.json`），包含分组、切窗、checkpoint 构造、标签来源、隔离规则。
**没做的没有假装做**：行级读取与真实转换需要装 `pyarrow` 或 `fastparquet`。任务书说「不擅自改生产依赖」，我没有安装，如实记为 B1 阻塞。

---

## 7. 未通过的门与边界（单列）

1. **人工金标：0 条**。`humanReviewers: 0`、`humanConfirmed: 0`。全部标签是 `model-reviewed` 或 `construction-deterministic`。
2. **真实 HOST 未验**：未在真实宿主跑过任何归属判定，未写入真实记忆。
3. **跨设备 / 跨时区未验**。
4. **公开轨迹未转换**（B1 阻塞）。
5. **未用 E5 / LoRA / RL**：监督训练，无奖励、无多策略、无策略梯度。**不称 RL**。
6. **生产未启用**：无 attach/merge/archive 写操作。
7. **样本量小**：合成 test 17 例、真实留出 15 例。**是诊断，不是效果承诺**。
8. **`jac3` 未修复**（1.345 → 7.676），如实报告。
9. **LOO 新特征对模型无实质贡献**（M1 −0.012）。
10. **模型供应商不稳定**：`deepseek-v4.1-flash` 429、`glm-5.3-flash` 无视 `response_format`、多次 `fetch failed`。单轮 549,530 tokens。

---

## 8. 下一轮建议（基于本轮实测，不是推测）

1. **停止在 synthetic 上调特征。** 两轮实验已经证明：合成集指标与真实留出**不同向**（0.941 vs 0.600；且 M1 证明新特征对模型无贡献）。继续优化合成集只会得到更好的假象。
2. **把训练集直接换成真实分布。** 教师轮已有 999 例 benchmark（907 test / 92 dev），其中 823 例 historicalWeak。既然 synthetic 与真实不同构，就该从真实集切 train/dev，而不是继续生成合成数据。
3. **先解决 `historicalWeak` 的证据不对等**：真实记录 1,000–3,000 字 vs 候选 3 条摘要。要么给候选完整语料（LOO 已实现，但覆盖率 0.22 仍不够），要么把记录侧也裁剪到与候选同量级再做匹配。
4. **不要再用「首 300 字摘要」**：本轮实测其分离度为 **−0.0135**，是负贡献。
5. **公开轨迹**:先装 `pyarrow`（需用户批准），再按 `public/conversion-contract.json` 执行。

---

## 9. 产物清单

全部 39 个文件 / 143927955 字节，逐文件 sha256 见 `data/MANIFEST.json`。关键项：

| 路径（相对 lab 根） | 字节 | sha256 前 16 |
|---|---|---|
| data/features-real.json | 41423 | b7d3f88ff5941615 |
| data/features-synthetic.json | 556937 | 8679a0e66541e04e |
| data/realfrozen-enriched.json | 15668735 | c15048c954f25516 |
| data/synthetic-r2.json | 127080975 | 86096993ef3d4175 |
| logs/endpoint-probe.json | 882 | 0450449d2d4309a9 |
| logs/label-full-syn2.json | 225443 | c615846e4553699b |
| public/conversion-contract.json | 4226 | 66fa17c2a11b9a3e |
| public/probe.json | 3520 | 73eebcdead6305d7 |
| runs/run2-eval.json | 71810 | b9bb1a1bd6dbd2ca |
| runs/run3-mutation.json | 1123 | 9fd5b3bba15476b8 |
| scripts/r2-evidence.mjs | 3797 | 864410ae2afe5f1c |
| scripts/r2-features.mjs | 7226 | 8036f6d8b165d98b |
| scripts/r2-run2.py | 8236 | ff936360772a693c |
| scripts/r2-run3.py | 4573 | 0ed0f71a3967d2f3 |
| scripts/r2-trainer.py | 1849 | 6104e5ed2c57e2ce |
| scripts/s1-build-realfrozen-enriched.mjs | 5145 | c71e7f9b8e8f0506 |
| scripts/s2-build-synthetic-r2.mjs | 13463 | cd7dd07e280260d8 |
| scripts/s4-label-synthetic-r2.mjs | 7412 | 061635686e5a70c5 |
| scripts/s6-dump-features.mjs | 1761 | 122c6b254fae4b82 |
| scripts/s7-public-convert.mjs | 4841 | cb8897821c0c478a |
| scripts/s8-merge-labels.mjs | 3536 | 2dc60a863dbba69b |

复算入口：

```bash
# 1) 富化真实集（全量检查点语料）
node scripts/s1-build-realfrozen-enriched.mjs
# 2) 按真实分布生成合成集
node scripts/s2-build-synthetic-r2.mjs && node scripts/s3-measure-shift.mjs
# 3) 模型标注（需 worldcodes key；glm-5.3-flash）
node scripts/s4-label-synthetic-r2.mjs && node scripts/s8-merge-labels.mjs
# 4) 特征 + 训练 + 真实留出 + 变异
node scripts/s6-dump-features.mjs
"<dsh-python>" scripts/r2-run2.py ; "<dsh-python>" scripts/r2-run3.py
# 5) 公开轨迹探测
node scripts/s5-public-probe.mjs && node scripts/s5-download-sample.mjs && node scripts/s7-public-convert.mjs
```
