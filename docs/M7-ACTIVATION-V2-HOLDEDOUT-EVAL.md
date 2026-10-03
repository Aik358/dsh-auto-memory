# M7 Activation v2 — Held-out Score-Based Evaluation (2026-08-25)

## Verdict: **PASS** — 冻结策略通过独立人工金标离线验收

冻结产物 `activation_features_pre_v2` / `recall_intent_lr_pre_v1` /
`activation_policy_pre_v2`（tauHi=0.45, tauLo=0.35, deltaExp=0.03,
deltaPro=0.05, mode=shadow-candidate，configHash 校验通过）在 67 条
**人工金标** held-out 样本上重放生产检索路径（BGE-M3 dense + BM25 lexical,
D6 加权融合），逐条 `decide_activation_v2` 决策。**全程零重调参。**

## 门禁结果

| 门禁 | 要求 | 实测 | 结果 |
| --- | --- | --- | --- |
| actPrecision | ≥ 0.70 | **0.917**（11/12，CI95 [0.727, 1.0]，pairId 聚类 bootstrap B=2000） | ✅ |
| predictedEmit | ≥ 8 | **12** | ✅ |
| harmfulEmit | = 0 | 0（本批无 harmful 样本，见泄漏覆盖说明） | ✅ |
| emitOnSuppress | = 0 | **0**（20 条 S 金标无一 emit，echo veto 零漏） | ✅ |
| correction / wrong-scope / stale / PII leakage | = 0 | 见泄漏覆盖说明 | ✅* |

*本批 held-out 无 correction/stale/PII 专项样本；这些硬门由训练金标 v2 重放覆盖
（features-v2-replay.json：sViolations=0, harmfulEmit=0, emitOnP=0），并需在受控
shadow 真实流量中再验。

主集 = 63 条（67 减 4 条 cross-workspace 单列分层）；跨区层另报：
n=6, emit=1（正确），prec 1.0 —— 跨区召回是 JS 权威层（R2），按设计不入主门禁。

## 数据集口径（重要修正）

- 69 条 proposed（53 队列 + 16 补充）全部经 `heldout-review-v2.xlsx` **人工审核**；
  此前 `heldout-final-gold.json` 等文件以合成标签冒名 gold，已废弃为历史快照。
- 人工判定分布：activate 27 / suppress 22 / prefetch 18；英文 activate 正例 6。
- **deferred 2 条**：hd-048/hd-049，用户批注「跨工作区让用户选择是A还是S」——判定
  取决于未来跨工作区设置项，不计 gold。
- 用户 override 2 条：hd-021/hd-023 suppress→**activate**（与 cal-0036/0037 的
  advisory 关联宽容裁决一致），已如实转写 overridesPrior=true。

## 锚点恢复披露（anchor recovery）

本集锚定的 4 条合成测试记忆（琥珀协议/蓝鲸-7号/分词勘误/面条生活记录）已于
2026-08-25 被**蒸馏清理出线上语料**（用户 11:33 批注确认可清理）。首次评估因此
15/23 的 activate 金标检索不命中（predictedEmit 仅 4，FAIL）。四条原文从
semantic-pre 向量快照 excerpt 与 workspace 日志转写完整恢复（anchor-recovery.json，
含来源标注），并入检索池后重跑。恢复只影响检索池构成，不触碰任何策略参数。

## 分层结果

| 层 | n | emit | precision | recall |
| --- | --- | --- | --- | --- |
| zh | 57 | 8 | 0.875 | 0.412 |
| en | 6 | 4 | 1.000 | 0.667 |
| explicit lane | 41 | 12 | 0.917 | 0.550 |
| proactive lane | 22 | 0 | — | 0.000（设计：round-1 proactive 不 emit） |
| independent 子集 | 44 | 8 | 0.875 | 0.412 |
| overlapping 子集 | 19 | 4 | 1.000 | 0.667 |
| cat: echo-vs-recall | 20 | 7 | **1.000** | **0.700** |
| cat: cross-lingual | 6 | 4 | 1.000 | 0.667 |

echo 战场（本项目的核心发现）在独立 held-out 上 7 次 emit 全部正确、20 条含
echo 的样本零误激活——双臂 echo veto（containment≥0.30 ∪ denseTop≥0.70，仅
proactive lane）在未见数据上成立。独立性分层无翻车（重叠子集反而更准，方向
与"重叠虚高"担忧相反）。

## 观察项（非门禁）

1. **hd-supp-pf-02**（P 金标被判 emit）：margin 0.033 刚过 δExp，过激一档，
   与训练侧 cal-0008 同性质；累计两例供未来 δ 网格复审，当前不改。
2. **hd-037「蓝鲸-7号真厉害。」**（S 金标被判 prefetch）：echo 双臂均未触发
   （containment=0, dTop=0.504<0.70），走 proactive margin 门。prefetch 无模型
   可见效果，且与用户对意见陈述→P 的既有裁决（cf-008/014）方向一致。
3. **failure-vs-planning recall 天花板**：6 条 A 金标中 4 条检索未命中（失败汇报
   与目标记忆文本相似度本质偏低），其余被 margin 门保守降级；proactive lane
   round-1 不 emit 属设计取舍，此类依赖 repetition 信号累积（logging-only），
   留待真实流量验证。
4. ep_* 目标 4 条排不进 top-8（cos 0.36–0.53）：真实检索债，与训练侧已知
   misses（cal-0020/cf-096/b3-rp1）同类，归属 retrieval 层改进，不在本门禁内。

## 下一步（顺序不变）

1. ✅ 人工审核（69 条）→ 2. ✅ 离线打分验收（本文）→
3. **受控 live shadow**：用户手动重启 3080（加载 fv2 修复后的 worker），开启
   Python/Context Bridge/Activation Inbox 保持 mode=shadow，18–24 条受控请求
   （明确回忆 / 中英回忆 / 生活 echo / correction / wrong scope / stale /
   tool failure），核对线上字段与离线决策一致性 →
4. 单 session active canary（仅 explicit lane emit，生活 echo 与 correction 反例
   验证不注入），结束后恢复默认关闭。

## 复现

```bash
cd artifacts/m7-live-pre/feature-v2-heldout
D:/dsh-auto-memory/python/bench/.venv/Scripts/python.exe holdout_score_eval.py
# 输出 holdout-scored.jsonl（逐条特征+决策） / holdout-score-eval.json（指标+门禁）
```
