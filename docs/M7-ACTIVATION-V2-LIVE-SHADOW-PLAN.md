# M7 Activation v2 · 受控 Live Shadow 计划（18~24 条）

> 前置：held-out 独立验收 PASS · 冻结策略 τ_hi=0.45/δ_exp=0.03
> 本阶段验证：线上特征与离线结果逐字段一致
> 结束后：单会话 active canary（explicit lane only）

## 前置操作

1. 实现 Agent 完成 worker 接线收尾（`_fv2_shadow_decide` 已在位，需确认
   candidateHit 生产语义 = topK ∩ memoryRefs）
2. 用户重启 3080 宿主加载新 worker（唯一人工步骤）

## 查询清单

### Explicit Recall（8 条，中英各 4 条）

| # | 语言 | 查询 | 预期决策 | 预期目标 |
|---|---|---|---|---|
| E1 | zh | 之前关于琥珀协议的决策是什么？ | emit/prefetch | mem_27a7… |
| E2 | zh | 蓝鲸-7号联调通过的记录找出来。 | emit/prefetch | mem_b914… |
| E3 | zh | 现在分词方案的最终决策是什么？ | prefetch | mem_3191… |
| E4 | zh | M7-8 编排修复完成情况调出来。 | prefetch | mem_5f6a… |
| E5 | en | What was decided about the amber protocol? | emit/prefetch | mem_27a7… |
| E6 | en | When did Blue Whale-7 pass testing? | prefetch | mem_b914… |
| E7 | en | What's the current tokenization decision? | prefetch | mem_3191… |
| E8 | en | What was the M7-8 orchestration fix outcome? | prefetch | mem_5f6a… |

### Prefetch（4 条）

| # | 语言 | 查询 | 预期决策 |
|---|---|---|---|
| P1 | zh | 我准备继续做 embedding 相关的工作。 | prefetch |
| P2 | zh | 打算过一遍 activation 校验逻辑。 | prefetch/suppress |
| P3 | en | Planning to review the envelope budget next. | prefetch/suppress |
| P4 | zh | 准备更新交接文档。 | prefetch |

### Echo / Suppress（4 条）

| # | 语言 | 查询 | 预期决策 |
|---|---|---|---|
| S1 | zh | 中午那碗面条挺不错的。 | suppress |
| S2 | zh | 今天天气不错适合出去走走。 | suppress |
| S3 | en | This noodle soup is pretty good. | suppress |
| S4 | zh | 在吗？随便聊聊。 | suppress |

### 负例（4~8 条）

| # | 类型 | 查询 | 预期 |
|---|---|---|---|
| N1 | correction | 把之前 jieba 预切的方案拿来用。 | hard suppress |
| N2 | stale | 还按最早的单阶段顺序推进。 | suppress/harmful |
| N3 | PII | 用户的手机号是多少？ | suppress + piiClass |
| N4 | wrong-scope | WorkBuddy 跨设备用什么模式？ | suppress（dsh-core scope 下不可达） |
| N5-N8 | 闲聊 | 格点 QCD 进展？/ Rust vs Go？/ 重构函数 / 电影推荐 | suppress |

## 验证要点（逐条检查）

每条 push 后读取 `activation-shadow-v2.jsonl` 最新行：

- [ ] `policyVersions` 三件套与 policy JSON configHash 一致
- [ ] `lane` 与预期一致（explicit/proactive）
- [ ] `decision` 与预期一致（emit/prefetch/suppress）
- [ ] `reasonCodes` 包含预期标签（explicit_lane / echo_veto_proactive / …）
- [ ] `features.intentProb` 与离线 OOF 差值 ≤0.25（选择偏差容忍带）
- [ ] `candidateHit` 显式召回=true、闲聊=false
- [ ] `candidateProvenance` 的 memoryId 在 derived-corpus 中存在
- [ ] 无 model-visible Reference Tail / delivered / seen（shadow 态）
- [ ] 负例全部 fail closed（不产生任何激活帧或尾注）

## 通过标准

18+ 条查询中：
- Explicit recall 正例 ≥6/8 产生 emit 或 prefetch
- Echo/闲聊 ≥3/4 suppress
- 全部负例 fail closed
- 零 harmfulEmit
- 零泄漏（correction/wrong-scope/stale/PII）

→ 通过后进入 single-session active canary
→ 未通过 → 按 reasonCodes 归因 → 返回特征层修正

## 回滚

完成后恢复全部默认关闭：assoc=false / inbox=false / sink='null' /
source='fake' / anchor=true。删除 semantic-pre 即完全回退。
