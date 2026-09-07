# Held-out 审核状态（2026-08-25）

## 当前阶段：✅ 人工审核完成 + ✅ 离线打分验收 PASS — 等用户手动重启 3080 进入受控 shadow

正式报告：**docs/M7-ACTIVATION-V2-HOLDEDOUT-EVAL.md**（verdict PASS：
actPrecision 0.917 / predictedEmit 12 / emitOnSuppress 0 / harmfulEmit 0）。

审核结果：67 条人工 gold（A27/S22/P18，英文 activate 6）+ 2 条 deferred
（hd-048/049 跨工作区待设置项）；hd-021/023 用户 override suppress→activate。
人工金标文件：`heldout-human-gold.jsonl`。逐条决策：`holdout-scored.jsonl`。
注意：4 条锚定记忆已被蒸馏清理出线上语料，评估用 anchor-recovery.json 恢复池
（详见报告披露节）。

主 Agent 规则："未人工确认的不能算 gold"。据此明确以下口径：

| 文件 | 性质 |
| --- | --- |
| `heldout-review-v2.xlsx` | **人工审核入口**。69 条 = 原 53 条队列 + 16 条补充集（12 预取 + 4 抑制），含独立性标注列、A/P/S/H/E 下拉、目标 ID 附录 |
| `heldout-proposed-all.jsonl` | 上述 69 条的机器可读合并集，标签全部来自 strong-agent 合成（synthetic），**是 proposed 不是 gold** |
| `heldout-independence-report-v2.json` | 全部 69 条对训练金标 / parity fixture 的文本独立性分类（Jaccard≥0.5）：48 独立 / 11 与 parity 相似 / 10 与训练集相似 |
| `heldout-final-gold.json`、`heldout-gold-confirmed.jsonl` | ⚠️ 历史快照，命名有误导性——内容是**合成 proposed 标签**，未经人审。保留仅为溯源，不得当 gold 引用 |
| `heldout-review.xlsx`（v1） | 已被 v2 取代：只含 53 条、漏了 16 条补充集 |

## 结构预检（heldout-validation-report.json，非打分验收）

PASS：activate 25 ≥15、prefetch 18 ≥15、suppress 26 ≥15；en activate 正例 6 条、zh 19 条；expected/forbidden 不相交；sampleId 级与训练集零重叠。

## 审核后的固定流程（不因审核结果调整策略）

1. 导入人工判定 → 写 `heldout-human-gold.jsonl`（只有人审过的行才算 gold）
2. **离线打分验收**（冻结策略 activation_policy_pre_v2：tauHi=0.45 / tauLo=0.35 / deltaExp=0.03 / deltaPro=0.05 / mode=shadow-candidate；BGE-M3 + hybrid 检索锚定语料，离线可跑，不需要重启 3080）
   - 门禁：actPrecision ≥0.70、predictedEmit ≥8、harmful/correction/wrong-scope/stale/PII leakage 全 0
   - 报告 zh / en / explicit lane / proactive lane 分组 + bootstrap 95% CI；同时给出"仅独立子集"分层结果
3. 受控 shadow（用户手动重启 3080，mode=shadow，18–24 条受控请求）
4. 单 session active canary（仅 explicit lane emit）

生成器：`build_heldout_xlsx_v2.py`（解释器 python/bench/.venv）。
