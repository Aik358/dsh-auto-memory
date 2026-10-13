# P5 · 接续锚点表注入（已完工）

> **状态**：已完工 · 2026-09-09（原文记录的最后一次核实日）
> **性质**：派工任务书（存档）—— 本文为完成后的技术记录，不再作为待执行计划。
> **落点**：`lib/handoff-anchor.js`（原文记作 `lib/handoff-anchor-pre.js`）；`lib/index.js` 的 `buildContinueCarry()`；套件 `tests/smoke/smoke-test-handoff-anchor.mjs`。
> **验收**：`smoke-test-handoff-anchor.mjs` 通过；`handoff 51` / `continue-chain 58` 基线不下降；已并入全量回归。

## 摘要

该轮要解决的是 `buildContinueCarry()` 机械截断（白板 3000 / 账本 8000 / 总 18000）、材料虽在却无锚点表可下钻的问题。方案是用 L0 抽取生成锚点表（每条约 20–30 token）注入接续材料，并保证相同输入两次注入内容 hash 一致。落地后锚点生成失败时 fail-soft 回退现有平铺、不引入新的 LLM 轮次。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

> **投喂方式（存档）**：该轮要求本段与 `_COMMON.md` 一并投喂；该批次已执行完毕。


## 【P5】接续锚点表注入（原任务书）

**目标**：`buildContinueCarry()` 当前机械截断（白板 3000 / 账本 8000 / 总 18000）。G1/G3 已改指令为"按需取用"，但**没有锚点表可供下钻**。本段用 T1 的 L0 抽取生成锚点表。

**涉及功能模块**：`lib/index.js` 的 `buildContinueCarry()`。

**验收标准**：
1. 注入含锚点表（每条 ~20–30 token），材料仍可达
2. **字节稳定**：相同输入两次注入内容 hash 一致
3. 锚点生成失败 → fail-soft 回退现有平铺，**绝不阻塞接续**
4. **不引入新的 LLM 轮次**（纯解析），满足 0.75 早于官方 0.80 的时序
5. handoff 51 / continue-chain 58 不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`
- 关键词：`buildContinueCarry`、`carryText`、`slice(0, 3000)`、`slice(0, 8000)`、`slice(0, 18000)`、`truncateHead`、`stripSensitiveSections`、`snapshotPlanTitle`、`snapshotHandoffTitle`
- 必须先确认：① `buildContinueCarry` 的真实行号与返回字段 ② 三处截断的准确位置 ③ `carryText` 被谁消费（下游）

**改动边界**：
- ✅ 允许：`buildContinueCarry()` 内部（最小 diff）
- ❌ 禁止：新增 LLM 调用；让注入内容随查询/任务动态变化；改动静态纪律层
- ❌ 禁止修改：`refreshRitualPrompt()`（那是 P6/P7 范围）

**回滚**：`git checkout lib/index.js`。

---
