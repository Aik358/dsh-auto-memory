# prompts/ 投喂说明

> **🎯 本轮收尾投喂顺序看 [`FEEDING-SEQUENCE.md`](FEEDING-SEQUENCE.md)** —— 3 段喂 AI + 1 步你重启验证发版。

> **🚀 按轮次执行？先看 [`FEEDING-SCRIPT.md`](FEEDING-SCRIPT.md)** —— 每一轮投喂哪两个文件、Agent 要读哪些仓库文件、产出与验收，一张表说清。
> **⚠️ 2026-09-09 收官后补做段：`P8` + `M8-2b`，裁决依据见 [`M8-2-ADJUDICATION.md`](M8-2-ADJUDICATION.md)**（M8-2 排序目标未达成，**不降级，拆两段补做**）。

从 `docs/PROMPT-SET-STRICT.md` 拆分而来（脚本切片，内容未改），每个文件是一个**独立可投喂单元**。

---

## 一、投喂公式（唯一规则）

```
投喂给 Agent 的内容 = _COMMON.md  +  某一个任务段文件
```

- `_COMMON.md` **每次都必须带**，它是全局约束（搜索优先、六条禁止、停止回报、自检模板、项目事实速查）。单独投喂任务段 = 约束缺失 = 结果不可信。
- 任务段文件二选一即可，**不要一次塞多段**（除明确说明可并行的批次，也要分多个 Agent 分别投喂）。

**示例**：
```
请先阅读以下内容作为全局约束：
<粘贴 _COMMON.md 全文>

然后执行任务：
<粘贴 P1-l0-index.md 全文>
```

---

## 二、文件清单

| 文件 | 内容 | 依赖 | 改哪些文件 | 风险 |
|---|---|---|---|---|
| **`_COMMON.md`** | **通用前置约束（必带）** | — | — | — |
| `P1-l0-index.md` | L0 向量索引 + 增量更新 | 无（T1 已完成） | 新增 `lib/l0-index-pre.js` + smoke | 低（不接线） |
| `P2-semantic-recall.md` | 语义臂接入 recall | P1 | `lib/index.js` 的 `recall()` | 中 |
| `P3-fusion.md` | 融合层 rank-space + 绝对分数 | P2 | `lib/semantic-js-pre.js`（新增并存） | 中高 |
| `P4-l0-response.md` | recall 返回 L0 + 按需展开 | P3 | `lib/index.js` 的 `recall()` | 中 |
| `P5-handoff-anchor.md` | 接续锚点表注入 | 无 | `lib/index.js` 的 `buildContinueCarry()` | 中 |
| `P6-ledger-weight.md` | 账本权重化截断 | P5 | 新增 `lib/handoff-anchor-pre.js` + `index.js` | 中 |
| `P7-write-fix.md` | 写入侧缺陷修复（标题重复/白板老化） | 无 | `lib/index.js` 写入函数 | 低 |
| `M8-R-research.md` | M8 调研任务书（只读） | 无 | **禁止改任何文件** | 无 |
| `M8-R-REPORT.md` | **M8 调研报告（已执行，结论在此）** | — | — | — |
| `M8-1-fact-metadata.md` | Fact 元数据补强（时间三价+认识论状态+趋势） | 无 | `lib/fact-store-pre.js`（增量） | 中 |
| `M8-2-importance-wiring.md` | evidence → importance 接入检索排序 | 建议 P3 后 | 新增 `lib/memory-importance-pre.js` | 中 |
| `M8-3-enable-verify.md` | M8 启用 + live 验证清单 | **需你先确认** | `lib/index.js` 默认值一行 | 高 |
| `P8-rrf-wiring.md` | **RRF 接线进 recall**（替换字典序排序，激活 P2 语义臂） | P3 已交付 | `lib/index.js` 的 L0 排序分支 | 中 |
| `M8-2b-evidence-pipeline.md` | evidence 聚合层 + importance 加权接入 | **P8** | 新增 `lib/evidence-agg-pre.js` | 中 |
| `M8-2-ADJUDICATION.md` | **M8-2 目标裁决**（不降级，拆两段补做；含四条代码证据） | — | — | — |
| `P9-REVIEW-DECISION.md` | **P9 评审裁决**（success 根因误判纠正 + P9a 重设计 + importance 公式精确诊断） | — | — | — |
| **`FIX-AGENT-P8.md`** | **⭐ 复制即投喂：P8 RRF 接线（自包含，无需 `_COMMON.md`）** | P3 已交付 | `lib/index.js` L0 排序段 | 中 |
| `FIX-AGENT-M8-2b.md` | 复制即投喂：evidence 管道 + importance 加权（自包含） | **P8 验收后** | 新增 `lib/evidence-agg-pre.js` | 中 |
| `P9-evidence-write-coverage.md` | 排查 reuse/success 零产出、correction 近乎为零的根因（**默认只排查不改码**） | M8-2b 后 | 无（排查段） | 低 |
| **`FIX-AGENT-P9.md`** | **⭐ 复制即投喂：evidence 写入覆盖排查（自包含；报告先交规划侧过目）** | M8-2b 后 | 无（只排查） | 低 |
| **`FIX-AGENT-P9a.md`** | **⭐ 复制即投喂：correction 修复（重设计，单条归因）** | P9 裁决后 | `lib/context-host-pre.js` | 中 |
| **`FIX-AGENT-P9d.md`** | **⭐ 复制即投喂：success 时间戳缺陷修复（success 链结构性断裂，优先于观察）** | 无 | `lib/context-host-pre.js` 一行 | 低 |
| **`FIX-AGENT-P12-FULL-REGRESSION.md`** | **⭐ 一整段投喂：修 P12 + 重启 + 九套静态 + 七项 live + 发版 Go/No-Go 结论** | 无 | `lib/shadow-retrieval-pre.js` + m4 断言 | 中 |
| **`FIX-AGENT-TEMPORAL-ARM.md`** | **⭐ 时间检索臂（第一优先新功能）：解析时间表达 + 软性第三臂，零行为变更** | **P12 之后** | 新增 `lib/temporal-parse-pre.js` + recall-fusion 兼容扩展 | 中 |
| **`LIVE-VERIFY-ZCODE.md`** | **⭐ 给 Zcode 的独立 live 验收（可重启+控 UI+读后台日志，第三方视角，九项取证 + Go/No-Go）** | 第 1-3 段后 | **禁止改任何文件** | — |
| **`ZCODE-DROPIN.md`** | **⭐⭐ 直接整段扔进 Zcode 的那一份（含 `--no-open`、九项取证、Go/No-Go）** | 第 1-3 段后 | **禁止改任何文件** | — |
| `P10-importance-calibration.md` | importance 效应定标：`0.5+w×imp` 可配置 + 真实查询翻转率实测 | **P9 结论后** | `lib/index.js` dense 臂一行 + 配置项 | 低 |
| `P11-silent-catch-observability.md` | fail-soft 空 catch 统一加 diag（**只加日志不改行为**，可与 P9 并行） | 无 | `lib/index.js` catch 行 | 低 |
| **`FIX-AGENT-P11.md`** | **⭐ 复制即投喂：静默 catch 可观测（自包含，可与 P9 并行给另一 Agent）** | 无 | `lib/index.js` catch 行 | 低 |
| `EXEC-ORDER.md` | 执行顺序与冲突提示 | — | — | — |

---

## 三、执行顺序

```
批次 1（可并行，互不干扰）
  ├─ P1-l0-index.md        纯新增文件，不接线 → 删除即回滚
  ├─ P5-handoff-anchor.md
  ├─ P7-write-fix.md
  └─ M8-R-research.md      只读，产出报告后等你确认

批次 2 → P2-semantic-recall.md        （依赖 P1）
批次 3 → P3-fusion.md                 （依赖 P2）
批次 4 → P4-l0-response.md            （依赖 P3）
批次 5 → P6-ledger-weight.md          （依赖 P5）
批次 6 → M8-1-fact-metadata.md        （可与批次 1 并行）
批次 7 → M8-2-importance-wiring.md     （建议 P3 之后）
批次 8 → M8-3-enable-verify.md         （**需你先确认是否改默认**）
```

---

## 四、三个最容易犯的错

1. **只投喂任务段，忘带 `_COMMON.md`** —— 约束会全部丢失，Agent 可能整文件重写或臆造 API。
2. **把多个任务段一次性塞给同一个 Agent** —— 尤其 P2/P3/P4 与 P5/P6 都要改 `lib/index.js`，同 Agent 连续改极易互相覆盖。**同批次并行时必须分多个 Agent，且串行验收、逐段 `git diff`**。
3. **跳过 M8-R 直接要 M8 改造** —— M8-R 是只读调研，产出报告后**必须经你确认架构方向**，才能生成 M8-1…。它的停止条件很硬：查不到"参考 Hermes / 架构极不成熟"的文档出处就必须停下回报，不许猜。

---

## 五、验收（每段 Agent 回报后你必查）

```bash
cd D:\dsh-auto-memory
git status --short          # 改动范围是否符合该段的"允许/禁止"清单
git diff --stat             # 是否最小 diff（新增段应 <100 行，改动段应 <50 行）
```
外加该段自检清单里的五套 smoke 数字：**l0-extract 18 / handoff 51 / continue-chain 58 / water-step 12 / autocont-host 29**，任何一个下降即打回。
