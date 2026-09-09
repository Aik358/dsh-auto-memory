## 附：执行顺序建议（v2，反映 M8-R 已执行完毕的现状）

```
批次 1（并行，互不干扰，可分给不同 Agent）
  ├─ P1   L0 索引            （新增 lib/l0-index-pre.js，不接线，删文件即回滚）
  ├─ P5   接续锚点表          （改 index.js 的 buildContinueCarry 单一函数）
  ├─ P7   写入侧修复          （改 index.js 写入函数：标题重复 / 白板老化）
  └─ M8-1 Fact 元数据补强     （改 lib/fact-store-pre.js 增量，不动 M8 其他文件）

批次 2（依赖 P1）
  └─ P2 语义臂接入 recall     （改 index.js 的 recall()）

批次 3（依赖 P2）
  └─ P3 融合层改造            （改 lib/semantic-js-pre.js：rank-space + 绝对分数）

批次 4（依赖 P3）
  └─ P4 返回 L0 + 按需展开    （改 index.js 的 recall() 返回结构）

批次 5（依赖 P5）
  └─ P6 账本权重化截断        （新增 lib/handoff-anchor-pre.js + index.js 接线）

批次 6（建议 P3 之后，避免权重叠加冲突）
  └─ M8-2 evidence → importance 接线
       （新增 lib/memory-importance-pre.js；若 P3 未完成则只交付纯函数不接线）

批次 7（需用户书面确认后才投喂）
  └─ M8-3 M8 启用 + live 验证（改 index.js 的 memoryHubEnabled 默认值一行）

── 以下为 2026-09-09 收官后补做段（M8-2 目标未达成，见 M8-2-ADJUDICATION.md）──

批次 8（依赖 P3 已交付 + P1/P2/P4；修复 P2 语义臂实效性）
  └─ P8  RRF 接线进 recall（替换字典序排序，默认开启 + legacy 回退）

批次 9（依赖 P8）
  └─ M8-2b evidence 聚合层 + importance 加权接入

批次 10（M8-2b 验收后数据源瓶颈，P9 已排查完）
  └─ P9a correction 修复（唯一投喂项，重设计：单条归因到最近被 cite 记忆）
  └─ P9d success 时间戳缺陷修复（**结构性断裂，立即做，优先于观察**）
  ├─ P9b success 观察（**P9d 之后**才观察：5/30 分钟窗口命中量级）
  └─ P9c reuse 延后（与 success 合并为"有用性信号补全"段，之后定）

批次 11（低风险、可与 P9 并行，建议尽早做）
  └─ P11 fail-soft 空 catch 统一可观测

批次 12（顺序后移：待 success/reuse/correction 有真实数据后再标定）
  └─ P10 importance 效应定标（w 可配置 + 翻转率实测）
```

## 冲突提示（务必遵守）

1. **P2/P3/P4 与 P5/P6 都会改 `lib/index.js`**。若并行执行，必须**串行投喂、逐段 `git diff` 验收**，避免同文件改动互相覆盖。
2. **M8-1 与 P 系列零文件交集**（M8-1 只碰 `lib/fact-store-pre.js`），可与批次 1 完全并行。
3. **M8-2 与 P3 有概念耦合**（importance 参与融合排序）：P3 先做，M8-2 后做；顺序颠倒会导致两次改同一融合公式。
4. **M8-3 永远最后**：它是行为开关，必须等 M8-1/M8-2 落地且五套基线全绿之后再确认执行。

## M8-R 调研状态

**已执行完毕**（2026-09-09），报告见 `M8-R-REPORT.md`。选型 = **A+（保留三层 + 叠加 epistemicStatus 字段 + 补时间三价 + importance 接线）**。`M8-R-research.md` 任务书保留存档，无需再投喂。

## P8 / M8-2b 补做说明（2026-09-09 裁决）

M8-2 的排序目标**未达成**：纯函数已交付（`311e2e8`），但接线点在当时不存在。经实读代码核实后裁决为**不降级，拆两段补做**：

- **P8**：`recall()` 当前是**字典序排序**（`b.lex - a.lex || (b.sem||0) - (a.sem||0)`），语义臂仅在词法分相等时打破平局 → P2 的语义臂"接了但没用"。P3 交付的 `rankFusionRRFPre` 经 grep 确认**零引用**。本段把它接进去，**属缺陷修复，默认开启**。
- **M8-2b**：evidence 事件**确实落盘**（`~/.dsh/memory/evidence-pre/events/*.jsonl`，按日），只是无人读取（`evidenceFor` 零调用方）。本段补「聚合层 → importance → 接入 P8 融合」全链。

完整裁决依据（四条代码证据 + 三条规划缺口认领）见 **`M8-2-ADJUDICATION.md`**。

## 全程验收底线（每段完成后核对）

```bash
git status --short   # 改动文件不得超过该段"允许修改"清单
git diff --stat      # 最小 diff，无整文件重写
```

五套 smoke 基线不得下降：**l0-extract 18 / handoff 51 / continue-chain 58 / water-step 12 / autocont-host 29**（M8-1 追加 fact store ≥41 断言）。
