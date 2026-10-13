# P7 · 写入侧缺陷修复（已完工）

> **状态**：已完工 · 2026-09-09（原文记录的最后一次核实日）
> **性质**：派工任务书（存档）—— 本文为完成后的技术记录，不再作为待执行计划。
> **落点**：`lib/index.js` 与 `lib/memory-writer.js`（原文记作 `lib/memory-writer-pre.js`）的账本/白板写入分支；套件 `tests/smoke/smoke-test-p7-write-fix.mjs`。
> **验收**：`smoke-test-p7-write-fix.mjs` 通过；已并入全量回归。

## 摘要

该轮要修两个独立写入侧缺陷：① 账本标题重复（最近 6 个中 3 个含两行 `# 交接账本` 且时间戳不一致，解析会取到错的）；② `PLAN.md` 退化成日志、并列堆积历史状态与踩坑而无老化。方案是追加写入前检测已有标题、并复用既有 PLAN archive 机制把历史移入 `handoff/archive/`。落地以不丢失任何既有内容为前提。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

> **投喂方式（存档）**：该轮要求本段与 `_COMMON.md` 一并投喂；该批次已执行完毕。


## 【P7】写入侧缺陷修复（原任务书）

**目标**：两个独立小缺陷 ① 账本标题重复（最近 6 个中 3 个含两个 `# 交接账本` 标题行、时间戳不一致，解析会取到错的）② `PLAN.md` 退化成日志（并列堆积 2.2.5/2.2.6 状态与历史踩坑，无老化）。

**涉及功能模块**：`memory_note` 的 `kind=handoff` 分支；白板归档（复用既有 PLAN archive 机制）。

**验收标准**：
1. 追加写入前检测已存在标题则跳过（或解析取最后一个标题，二选一并断言）
2. 白板区分「当前状态」与「历史」，历史移入 `handoff/archive/`
3. 不丢失任何既有内容
4. 五套基线不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`lib/memory-writer-pre.js`
- 关键词：`writeHandoffLedger`、`writePlanSnapshot`、`kind`、`handoff`、`plan`、`archive`、`PLAN-`、`MemoryDocumentWriter`、`sanitizeForWrite`
- 必须先确认：① 账本写入函数的真实名字与行号 ② 标题是在写入函数里拼的还是 LLM 生成的 ③ 既有 PLAN 归档函数

**改动边界**：
- ✅ 允许：`lib/index.js` 中账本/白板写入函数（最小 diff）
- ❌ 禁止：删除用户已有账本/白板内容；改动注入预算；绕过 `sanitizeForWrite`（I3）

**回滚**：`git checkout lib/index.js`；文件层面改动需说明是否可回滚（建议先备份 `~/.dsh/memory`）。

---
