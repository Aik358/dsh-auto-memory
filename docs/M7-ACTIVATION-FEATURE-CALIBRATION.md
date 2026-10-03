# M7 Activation Feature v2 校准报告

> 阶段：R1（Python feature v2 shadow 接线 + 离线校准 + held-out 准备）
> 日期：2026-08-25 · runId：feature-v2-heldout
> 结论：**continue_shadow** — 架构已验证、parity 全绿，但 held-out 人工 gold 尚未导入

## 1. 当前有效策略（唯一来源）

python/policies/activation_policy_pre_v2.json
- policyVersion = activation_policy_pre_v2
- mode = **shadow-candidate**
- tauLane=0.45 / tauHi=0.45 / tauLo=0.35 / deltaExp=0.03 / deltaPro=0.05
- echo veto 仅 proactive lane
- decisionRecordId = activation-v2-delta-exp-override-20260824

## 2. 实现交付（全部完成）

| 组件 | 路径 | 状态 |
| --- | --- | --- |
| 特征模块 | python/m7_activation_features_pre_v2.py | 纯 stdlib |
| 意图头工件 | python/policies/recall_intent_lr_pre_v1.json | vocab 2497/IDF/LR/Platt |
| 策略工件 | python/policies/activation_policy_pre_v2.json | 含 configHash/goldDigest |
| 决策记录 | python/policies/decision-record-*.json | δ 0.02→0.03 变更审计 |
| 独立校验器 | python/verify_policy_artifact.py | PASS |
| Worker 接线 | worker_semantic_pre_v1.py（shadow 路径） | fail-closed |
| Golden parity | 55 fixtures 逐字段一致 | ALL MATCH |
| 规则单测 | tests/test_m7_features_v2.py | OK |
| 全量回归 | 28 suites (含 m79) | ALL PASS |

## 3. 86 Gold 重拟合结果

v1 默认: prec=0/rec=0 (emit即回声)
v2c+P3门 τ_hi=0.45/δ=0.03(effective): prec=1.000/rec=0.289/sViol=0
学习头 v3a τ=0.65(无完整性门): prec=0.833/rec=0.682/sViol=1
v3b oracle hit(上限): prec=0.826/rec=0.864

## 4. Held-out 准备

53 条新样本与 86 gold 完全隔离：
activate 25 / suppress 22 / prefetch 6
覆盖 echo-vs-recall/failure-vs-planning/supersede/cross-workspace/cross-lingual/low-info
split 按 pairId 哈希分组 train/dev/test

用户裁决后合并预期：86+53≈139 条 → 满足 held-out active 门 ≥15/class

## 5. continue_shadow 理由

held-out activate gold=0(未导入) / predicted emit=N/A(无 live 流量) / actPrecision=N/A
→ 全部条件不满足，继续 shadow

下一步路径：用户裁决 heldout-review-queue.jsonl → 导入 human gold → live shadow ≥3天 → 按门验收 → policy diff → 用户批准 → active canary

## 6. 已知债务

1. candidateHit 使用 memoryRefs 交集近似
2. repetition logging-only; P4 升级逻辑需 JS 多次提及门口径对齐
3. completeness 词典为一期保守方案
4. 意图头 OOF vs full-fit 边界差 0.222——需 held-out 弥合
