# P4 · recall 返回 L0 + 按需展开（已完工）

> **状态**：已完工 · 2026-09-09（原文记录的最后一次核实日）
> **性质**：派工任务书（存档）—— 本文为完成后的技术记录，不再作为待执行计划。
> **落点**：`lib/index.js` 的 `recall()` 返回组装部分；套件 `tests/smoke/smoke-test-p4-l0-response.mjs`。
> **验收**：`smoke-test-p4-l0-response.mjs` 通过；已并入全量回归。

## 摘要

该轮要解决的是 `recall()` 返回整条原文（平均 814 字符）导致结果臃肿的问题。方案是改为默认返回 L0 列表（每条约 93 字符，含 `id/score/match_reason`），并保留按 `mem_xxx` 展开原文的入口，对齐 OpenViking 的渐进式加载。落地后 5 条场景由约 4070 字符降至约 590 字符，展开不串条、旧调用方式行为不变。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

> **投喂方式（存档）**：该轮要求本段与 `_COMMON.md` 一并投喂；该批次已执行完毕。


## 【P4】recall 返回 L0 + 按需展开（原任务书）

**目标**：recall 当前返回整条原文（平均 814 字符）。改为默认返回 L0 列表，按需按 id 展开原文（对齐 OpenViking 渐进式加载：L0 已在结果中，`is_leaf` 决定取 L1/L2）。

**涉及功能模块**：`lib/index.js` 的 `recall()` 返回结构；可能复用 `memory_read` 或新增展开入口。

**验收标准**：
1. 默认返回 L0 列表（每条 ~93 字符），含 `id/score/match_reason`
2. 提供按 `mem_xxx` 展开原文的入口
3. 5 条场景：约 4070 字符 → 约 590 字符
4. 展开不串条；旧调用方式（不传新参数）行为不变
5. 五套基线不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`lib/memory-index-pre.js`
- 关键词：`async recall(`、`memory_read`、`readTextSafe`、`byteStart`、`byteEnd`、`recordDigest`、`locator`
- 必须先确认：① 现有是否已能按 id 定位到字节区间（若能则复用，不要新造）② `recall()` 返回字符串还是对象

**改动边界**：
- ✅ 允许：`lib/index.js` 的 `recall()` 返回组装部分
- ❌ 禁止：改变静态纪律层注入内容（I1）；删除既有返回字段
- ❌ 禁止修改：`lib/memory-index-pre.js`

**回滚**：`git checkout lib/index.js`。

---
