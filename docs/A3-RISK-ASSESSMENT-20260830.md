# A3 风险评估：三个新发现（2026-08-30 canary 夜）

> 背景：A1 act.skill Python canary 期间（22:24–23:20）发现三个此前未立项的行为。
> 本文给结论：每个是 bug 还是已知设计、是否阻塞 npm 首发、建议窗口。
> 结论先行：**均不阻塞首发**，其中 F1 建议发布前小修（30 分钟级），F2/F3 记录为已知限制。

## F1 stale 证据振荡（建议发布前小修）

**现象**：语料升版（每日日志追加→重锚定换 digest）后，受影响记忆的"最近一条证据"
digest 变旧 → aggregate freshness=stale → fv2 stale 门（top-K 候选含 stale 记忆即
suppress）→ 22:38 第二轮 canary 全部 `hard_gate_stale`。实测 35/64 记忆 stale。

**为什么不是死锁**：自愈路径存在且已实测——模型用记忆工具重新读取（22:57 turn 3）
→ 写入当前版 digest 的新 seen/cite 事件 → freshness 恢复 fresh → 下一轮 emit 正常
（23:01 turn 4 delivered）。

**残余风险**：若用户长期不发触发读取的 query，stale 集会累积、emit 命中率下降；
以及"语料每次升版 → 全量证据一夜变 stale"的振荡本身浪费决策。

**建议**（二选一，倾向 a）：
a) fv2 调用侧给 stale 门加"降版本容忍"：freshness=stale 但 stale 事件晚于当前
   语料版本时（即事件只是旧版本、记忆未真正失效）不进门——调用侧调整，不动冻结核；
b) 语料重锚定后由 JS 主动对"内容未变"的记忆补写 seen 证据（成本高，放弃）。

**不阻塞理由**：有自愈、无错误注入（fail-closed 方向 suppress，精度无损）、
召回率短暂下降对用户表现为"没想起来"而非"想错"。

## F2 重启后首轮 miv 竞态（记录，不修）

**现象**：22:24 首轮 emit 帧带旧 memoryIndexVersion → JS 侧 `stale-index` 拒收。
indexSync 的 latest-wins 重同步（日志：syncsOk=2, mivReplaced=1）随即收敛，
第二轮起 offer 全部 accepted。

**定性**：设计内 fail-closed 时序——重启后 worker 用旧语料先应答一次、JS 用新语料
拒收一次，下一次对齐。代价=重启后第一条强召回 query 丢一次注入。

**不阻塞理由**：单次、可自愈、方向安全。记录到 handoff"已知限制"。

## F3 fv2 query 窗口污染（已有立项，维持 P3）

前轮回忆内容抬后续轮 intentProb——今晚 23:01 canary 的 intentProb=0.998 部分来自
会话内前轮 canary 语境（"发射档位确认流程"本身是高频命中词）。既有 handoff P3.3
立项不变；缓解方向=emit 后窗口衰减，属 fv2 调用侧参数，不阻塞首发。

## 附：A1 修复本身（02dacea）

真 bug=技能段预算饥饿：renderReferenceTail 末位计价，emit 满帧（8 引用 ~3.7KB）
时技能段（~480B）必超 4096 → skillDropped，任何满帧投递都不含 checklist。
修=预算预留制（技能段先扣成本，引用按分装填，低分引用走既有 dropped 语义）。
m83 S5 重写为预留语义，61/61；重启后 canary 复测模型逐字复述 checklist 通过。

## 时间线证据（今晚 canary）

| 时刻(本地) | 轮次 | 结果 |
|---|---|---|
| 22:24 | turn1 回忆 | offer stale-index 拒（F2）；会话末 consolidate → 语料升版 |
| 22:38 | turn2 回忆 | 全部 hard_gate_stale（F1）；证据窗口全 stale |
| 22:57 | turn3 读取刷新 | 模型记忆工具读取 → sv=31 新证据 → delivered=1 自愈 |
| 23:01 | turn4 正式 canary | delivered=2，候选∩技能源记忆=2 →（当时未修）skill 被预算挤掉 |
| 23:15 | 修复+重启后复测 | claims=6；下一轮 pre-step rendered=1 delivered=1 |
| 23:20 | turn6 复述验证 | **模型逐字复述技能段**：标题/步骤/完成标准全对 → A1 通过 |
