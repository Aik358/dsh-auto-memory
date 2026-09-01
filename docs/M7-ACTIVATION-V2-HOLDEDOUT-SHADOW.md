# M7 Activation v2 · Held-out Shadow 操作清单

> 阶段：R1（Python feature v2）已完成并停止于本清单 · 生成：2026-08-25
> 前置达成：artifact gate 16/16 PASS · 55 fixture golden parity 全字段一致 ·
> 全量回归 27/27 PASS · online-vs-OOF 报告已出（`online-oof-consistency.json`）

## 0. 接线前置（实现侧编码任务，非算法变更）

在 `worker_semantic_pre_v1.py` 的 shadow 激活路径并行接入 v2 决策：

- `import m7_activation_features_pre_v2 as featv2`
- policy 工件定位：`<repo>/python/policies/*.json`（或
  `DSH_M7_ACTIVATION_POLICY_V2` env 指定目录）；`load_and_verify_policy`
  失败 = fail closed = 继续走 v1 影子日志，不崩不切。
- 每个 context_push 在现有 v1 判定旁调用 `decide_activation_v2`，
  追加写入 `semantic-pre/activation-shadow-v2.jsonl`（字段：v2 decision/
  reasonCodes/intentProb/completeness/lane + v1 对照列）。
- `candidateHit` 生产语义：top-K 与 memoryRefs（lexical 预取授权引用）交集；
  无 refs 时 False。expected-target 匹配仅在评测夹具可用。
- 输出 `requiresCrossWorkspaceRelay` / `piiClass` / `advisoryOnly` 三字段供第二轮 JS 使用。

## 1. 用户操作（沿用 §19.8 开关序列）

1. 确认 embedding-config（bge-m3 快照路径）未变；
2. 重启 3080 宿主加载接线后的 worker（唯一需用户动手的步骤）；
3. 按 assoc → bridge → pythonBackend → sink='python' → inbox →
   source='python' 逐项开启；activationPolicy.mode 保持 **shadow-candidate**；
4. 自然使用 ≥3 天，覆盖：中文显式召回、英文查询、生活回声、重复失败、
   多目标对比题。

## 2. 采集与标注

- 目标观测 ≥200 条；期间用文件队列（xlsx）对新增边界样本做轻量裁决，
  使 **held-out activate gold ≥15** 且中英各有正例；
- 新样本一律 synthetic/derived 标记 + parent 锚定，isGold 仅在裁决后翻转。

## 3. 验收门（任一不满足 → 继续 shadow 并输出归因报告）

| 门 | 阈值 |
| --- | --- |
| actPrecision | ≥ 0.7 |
| harmfulEmit | = 0 |
| correction/wrong-scope/stale leakage | = 0 |
| held-out activate gold | ≥ 15 |
| predicted emit | ≥ 8 |
| 语言覆盖 | 中文/英文各有正例 |
| 报告项 | precision bootstrap CI + activation coverage |

## 4. 达标后路径

policy diff（parent=activation_policy_pre_v2）→ 用户批准 → single-session
active canary（§19.8 步骤）→ 回滚验证（恢复默认关闭）→ 用户宣布 M7 live。
未达标：保持 shadow，按 reasonCodes 归因（检索欠债 / 完整性词典 / repetition
信号缺失）迭代特征层，禁止以调低 tOn/tOff 方式凑数。

## 5. 第二轮（JS plumbing，另行派发）

sensitiveMemoryMode 三档硬过滤（index_sync/context_push 前）、crossWorkspaceRecall
relay、append-only policy registry、审批写回通道。与本轮 Python 结果分开验收，
避免算法误差与 Host 授权误差混叠。
