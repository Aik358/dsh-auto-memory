> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【P5】接续锚点表注入

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
