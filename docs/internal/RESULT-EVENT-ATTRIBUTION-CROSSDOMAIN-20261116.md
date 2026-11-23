# 2.3 外部真实语料跨域验证 —— 结果报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-22）
> 依据：[PROMPT-EVENT-ATTRIBUTION-CROSSDOMAIN-20261116.md](file:///D:/dsh-auto-memory/docs/internal/PROMPT-EVENT-ATTRIBUTION-CROSSDOMAIN-20261116.md)
> 隔离目录：`artifacts/_event-attribution-crossdomain-20261116/`（18 个文件 / 26571179 字节）
> 性质：**跨域验证，不训练**。`trainingRun: false`；`productionEnabled: false`；`humanReviewed: false`；未改lib/、未装依赖、未碰真实记忆/19387。
> Lead复核（2026-11-16）：独立复跑 cd-eval.py / cd-eval2.py 均 EXIT=0；T3 125例 cov12=0.288 vs 随机0.016，T1 noLoo=0.966 vs LOO=0.023，与报告一致。

---

## 0. 结论

跨域验证给出一个**明确但不乐观**的答案：

| 任务 | 性质 | n | 随机 | **cov12（严格 LOO）** | 结论 |
|---|---|---|---|---|---|
| T1 issue→issue | 检索/近重复（**非归属**） | 87 | 0.011 | **0.023** | **约等于随机，不迁移** |
| T2 PR→被引用 issue | 真实关联 | 3 | 0.000 | 0.667 | 样本太小，**不下结论** |
| T3 comment→所属 issue | **真实归属** | 125 | 0.016 | **0.288** | **高于随机约 18 倍，但远低于本地 0.725** |

**三条要点**：

1. **cov12 确实迁移了一部分**：T3（真实归属）上 cov12 0.288 vs 随机 0.016。这是跨域证据支持「严格 LOO 覆盖率有真实信号」的唯一一处。
2. **但迁移幅度远小于本地**：本地 round3 的 cov12 = 0.725，跨域只有 0.288（约 40%）。本地数字**不能外推到外部语料**。
3. **T1 揭示一个必须写清的机制**：同一批数据上，含自身时 noLooCov12 = 0.966，严格 LOO 后掉到 0.023。**「去掉自身」这一步本身就消灭了几乎全部信号**——这解释了为什么任何「记录=事件内容本身」的构造都会产出虚高指标。

---

## 1. 数据来源、许可与指纹（全部实测）

### 1.1 GitHub REST API v3

| 项 | 值 |
|---|---|
| 端点 | `https://api.github.com`（公开 API，非私有） |
| 认证 | 从本机 `gh auth token` 读入内存；**全程未落盘、未打印、未写入任何产物** |
| 凭证保护 | 采集脚本在写文件前做 `payload.includes(TOKEN)` 断言，命中即 `exit(2)` 拒绝落盘 |
| 匿名配额 | 60/h（实测，前 35 次请求耗尽） |
| 认证配额 | **5000/h**（实测 `resources.core.limit=5000`） |
| 本轮总请求 | **506 次**（`raw/github-auth.json` 的 `usedRequests`） |

**仓库与许可（逐个实测 `license.spdx_id`）**：

| 仓库 | 许可 | PR 采集 | issue 采集 | 评论 |
|---|---|---|---|---|
| `pallets/flask` | **BSD-3-Clause** | 100 | 50 | 79 |
| `psf/requests` | **Apache-2.0** | 100 | 50 | 106 |
| `django/django` | **BSD-3-Clause** | 100 | 0 | 0 |

合计：**300 个已合并 PR / 100 个已关闭 issue / 185 条评论**。`django/django` 的 issue 采集返回 0 —— 其 issue 全部经 PR 流转，本轮按其真实形态如实记为「该仓库无独立 issue 可用」，未用 PR 冒充 issue。

### 1.2 原始响应指纹

每一次 API 请求的 URL / 状态码 / 字节数 / sha256 / 剩余配额都记在 `raw/github-auth.json` 的 `requests[]` 里，可逐条复算。关键文件：

| 文件 | 字节 | sha256 前 16 |
|---|---|---|
| `data/crossdomain-dataset.json` | 445743 | `fc9e26675e35a883` |
| `data/crossdomain-v2.json` | 24723206 | `c684f2f5c3343ee0` |
| `raw/github-auth.json` | 1246588 | `32ede8094990d003` |
| `raw/github-bulk.json` | 33307 | `8d90cd541f9c796a` |
| `raw/github-issues.json` | 60603 | `c7a6905e349f511a` |
| `raw/github-probe.json` | 1202 | `403226c73311e923` |

### 1.3 SWE-bench / MEnvData-SWE-Trajectory：**未转换**

如实记录原因：两者与第二轮 B1 同一阻塞 —— **本机无 `pyarrow` / `fastparquet` / `thrift` / `snappy` / `zstd` / `lz4`**，Parquet 无法行级解码。任务书明确「不擅自安装依赖」，故**未做任何转换**，也未用元数据冒充转换完成。
GitHub 路径已提供足够的外部真实语料（300 PR / 100 issue），本轮结论不依赖 Parquet 数据集。

---

## 2. 事件构造规则（三个任务，指标分开）

### T1 issue→issue（**非归属**，已显式标注）

记录 = issue 正文（≥150 字）；候选 = 同仓库全部 issue 的 `title + body`；gold = 自身。
这是「检索/近重复」，**不是归属**，不并入归属结论。

### T2 PR→被引用 issue（真实关联）

记录 = PR 正文（≥120 字）；gold = 正文里 `Fixes #N` / `Closes #N` 显式引用的那个 issue；候选 = 同仓库 issue。
**只保留恰好 1 个可解析引用的 case**，避免多目标歧义。筛选后只剩 **3 例** —— 因为 50 个 issue 样本与 100 个 PR 的引用关系只有 3 处落在交集中。**样本量不足以支撑任何结论**。

### T3 comment→所属 issue（**真实归属**）

记录 = 某条 issue 评论（≥100 字）；候选 = 同仓库 issue；gold = 该评论所属 issue。
**剔除模板回复**：正则 `/palletsprojects\.com\/contributing\/llm-ai|rejected AI|automatically closed|This is an automated/i` —— 实测 185 条评论中 18 条是这类模板，它们不构成归属信号。
最终 **125 例**（flask 38 / requests 87），每例 50 个候选。

### 2.1 严格 LOO（禁止 self-leak）

```js
isSelfPiece(piece, rec):
  归一化后相等 || 记录前30字出现在片段中 || 片段前30字出现在记录中   // 片段<20字不参与判定
```

候选证据 = 该候选的 `title + body`，**逐片断剔除**与记录实质相同的部分，再算覆盖率。这直接对应任务书「不能把 gold 全文复制到候选让它字符串命中」。

---

## 3. 跨域指标（零参数，不训练）

### 3.1 T3 comment→issue（真实归属，n=125，50 候选）

| 排序器 | top-1 | top-5 | MRR | 中位名次 |
|---|---|---|---|---|
| cov5(严格LOO) | **0.344** | 0.568 | 0.458 | 3 |
| cov12(严格LOO) | **0.288** | 0.392 | 0.351 | 20 |
| cov8(严格LOO) | **0.288** | 0.552 | 0.422 | 3 |
| noLooCov12(含自身) | **0.288** | 0.392 | 0.349 | 21 |
| cov12+num | **0.240** | 0.376 | 0.315 | 17 |
| numOverlap | **0.048** | 0.152 | 0.116 | 27 |
| pathOverlap | **0.032** | 0.056 | 0.076 | 32 |
| random(det) | **0.016** | 0.080 | 0.080 | 26 |
| titleInRec | **0.000** | 0.016 | 0.043 | 33 |

**按仓库拆分（隔离性检查，两仓库各自独立）**：

| 仓库 | n | random | cov12(LOO) | noLooCov12 |
|---|---|---|---|---|
| `pallets/flask` | - | 0.000 | **0.289** | 0.289 |
| `psf/requests` | - | 0.023 | **0.287** | 0.287 |

两仓库单独看分别是 0.289 / 0.287，**一致**，说明不是单一仓库的偏置。

### 3.2 T1 issue→issue（非归属，n=87）

| 排序器 | top-1 | top-5 | MRR |
|---|---|---|---|
| noLooCov12(含自身) | 0.966 | 1.000 | 0.978 |
| titleInRec | 0.081 | 0.149 | 0.146 |
| cov8(严格LOO) | 0.046 | 0.103 | 0.117 |
| cov12(严格LOO) | 0.023 | 0.149 | 0.119 |
| pathOverlap | 0.023 | 0.103 | 0.096 |
| random(det) | 0.011 | 0.149 | 0.096 |
| cov5(严格LOO) | 0.011 | 0.046 | 0.054 |
| numOverlap | 0.011 | 0.035 | 0.061 |
| cov12+num | 0.011 | 0.081 | 0.081 |

**关键对照**：`noLooCov12` 0.966 → `cov12`（严格 LOO）**0.023**。
这不是「方法失效」，而是**机制证据**：当记录本身就是候选内容时，含自身必然命中；一旦严格执行 LOO 剔除自身，issue 正文与其它 issue 正文之间几乎没有可迁移的字面信号。

### 3.3 T2 PR→issue（样本不足，仅记录）

n=3，cov12 0.667（2/3），随机 0.000。**3 个样本不能支撑任何结论**，本轮不下判断。

---

## 4. 与本地 round3 的对照（本报告最重要的一次对照）

| 量 | 本地 round3（真实冻结 benchmark） | 跨域 T3（真实 GitHub） |
|---|---|---|
| 任务 | issue/记录 → 候选事件 | 评论 → 所属 issue |
| cov12 严格 LOO top-1 | **0.725** | **0.288** |
| 随机基线 | ~0.10 | 0.016 |
| 相对随机的倍数 | ~7× | ~18× |

**判读**：

- cov12 在跨域上**仍显著高于随机**（0.288 vs 0.016），所以「严格 LOO 覆盖率是一个真实信号」这一判断**得到外部语料支持**，不是本地过拟合的产物。
- 但**绝对水平从 0.725 掉到 0.288**。本地 round3 的 0.725 **不能外推**为「这个排序器在真实外部语料上也有 72% 准确率」。
- 两个任务定义不同（本地候选是「事件」，跨域候选是「issue」），**不可直接相减当作性能退化量**。本轮只声明方向与量级，不宣称等价。

---

## 5. 失败项与无法转换项（单列）

| # | 项 | 状态 | 实测细节 |
|---|---|---|---|
| B1 | SWE-bench / MEnvData 转换 | **BLOCKED** | 本机无 pyarrow/fastparquet/thrift/snappy/zstd/lz4；任务书禁止擅自装依赖 |
| B2 | T2 PR→issue 样本量 | **不足** | 严格筛选（恰好 1 个可解析引用 + 引用落在本地 issue 样本内）后只剩 3 例 |
| B3 | django/django issue | **0 收集** | 该仓库 issue 全经 PR 流转，返回 0；未用 PR 冒充 issue |
| B4 | 评论模板污染 | **已处理** | 185 条中 18 条是 `contributing/llm-ai` 类模板回复，已按正则剔除 |
| B5 | 外部四态标签 | **不存在** | GitHub 没有「attach/create/ambiguous/not-applicable」四态；本报告全部指标是**候选排序**，不是四态判定准确率 |

---

## 6. 未验边界

1. **人工金标：0 条**。全部标签来自 GitHub 的真实结构关系（评论所属、PR 引用），不是人工复核的归属金标。
2. **未做四态判定**：三个任务都是候选排序。**不能**把 0.288 说成「归属判定准确率」。
3. **真实 HOST 未验**；**跨设备/跨时区未验**。
4. **未训练任何模型**：本轮全部是零参数排序器，符合任务书「先跨域验证，不直接恢复监督训练」。
5. **未接入生产**：cov12 未接入任何生产路径。
6. **单次采集**：只做了 1 个时间点的快照，未验证时间漂移。
7. **仓库局限**：只有 flask / requests 两个仓库提供了可用 issue 语料，Python 生态偏置明显。

---

## 7. 结论与建议

**支持恢复监督训练吗？** —— **不支持。**

理由：

1. 跨域上没有出现「本地失败、外部成功」的反转；cov12 在外部同样是最强的零参数信号，且水平更低（0.288）。
2. 外部语料能提供的独立事件量仍有限（2 仓库 / 50 issue 量级），且**没有四态标签**，无法直接作为归属训练集。
3. 唯一能支撑的判断是：**严格 LOO 覆盖率是跨域一致的弱信号**，值得作为排序特征保留，但不值得据此扩大训练。

**建议（按优先级）**：

1. 把「记录=事件内容本身」这个构造方式**永久排除**出任何评估 —— T1 已量化其后果（0.966 → 0.023）。
2. 若要在外部语料上继续，需要的是**四态标签**，而 GitHub 不提供；必须由独立上下文模型标注并标 `model-reviewed`，且按本轮同样的 LOO 口径。
3. Parquet 数据集（SWE-bench / MEnvData）是唯一的规模化增量路径，但需要用户批准安装解码依赖。

---

## 8. 产物清单

全部 18 个文件 / 26571179 字节，逐文件 sha256 见 `data/MANIFEST.json`。

| 路径（相对 lab 根） | 字节 | sha256 前 16 |
|---|---|---|
| data/crossdomain-dataset.json | 445743 | fc9e26675e35a883 |
| data/crossdomain-v2.json | 24723206 | c684f2f5c3343ee0 |
| inputs/frozen-inputs.json | 1223 | fce1c7421723b3c8 |
| logs/collect-auth.log | 573 | 4f18b04c408a85aa |
| raw/github-auth.json | 1246588 | 32ede8094990d003 |
| raw/github-bulk.json | 33307 | 8d90cd541f9c796a |
| raw/github-issues.json | 60603 | c7a6905e349f511a |
| raw/github-probe.json | 1202 | 403226c73311e923 |
| runs/cd-eval2.json | 7269 | 6e29332d4eb1db60 |
| runs/crossdomain-eval.json | 15250 | 35a84baef3b3a1cb |
| scripts/cd-eval.py | 3236 | 4a7b82c1a2f966fe |
| scripts/cd-eval2.py | 3362 | 97435442328f0521 |
| scripts/s1-probe-github.mjs | 2203 | 4a628a65b213e560 |
| scripts/s2-collect-github.mjs | 3828 | 6c023f59715e443e |
| scripts/s3-collect-bulk.mjs | 3068 | 369486416a476a09 |
| scripts/s4-build-crossdomain.mjs | 7735 | 055028425c19b2fa |
| scripts/s5-collect-auth.mjs | 4616 | fd97d3825a563732 |
| scripts/s6-build-dataset.mjs | 8167 | e4b1114401c94c4b |

复算入口：

```bash
# 1) 探测 GitHub API 可用性（匿名，不消耗业务配额）
node scripts/s1-probe-github.mjs
# 2) 采集（readme 中说明认证来源为本机 gh，token 不落盘）
node scripts/s5-collect-auth.mjs      # 506 请求，产出 raw/github-auth.json
# 3) 构造跨域数据集（严格 LOO、模板剔除、时间可见性）
node scripts/s6-build-dataset.mjs     # 产出 data/crossdomain-v2.json
# 4) 评估（零参数，不训练）
"<dsh-python>" scripts/cd-eval2.py    # 产出 runs/cd-eval2.json
```
