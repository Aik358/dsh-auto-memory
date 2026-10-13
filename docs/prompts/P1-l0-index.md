# P1 · L0 向量索引与增量更新（已完工）

> **状态**：已完工 · 2026-09-09（原文记录的最后一次核实日）
> **性质**：派工任务书（存档）—— 本文为完成后的技术记录，不再作为待执行计划。
> **落点**：`lib/l0-index.js`（原文记作 `lib/l0-index-pre.js`；`-pre` 命名已随 v3.1.6「删净 pre 全量落地」取消，下同）；套件 `tests/smoke/smoke-test-l0-index.mjs`。
> **验收**：`smoke-test-l0-index.mjs` 通过；已并入全量回归。

## 摘要

该轮要解决的是 L0 摘要只有文本、没有向量索引，语义检索无索引可查的问题。方案是参照 OpenViking「索引只存 URI+向量+元数据、不含文件内容」新建 `lib/l0-index.js`，支持全量建索引与单条增量重算。落地后索引可整体删除回滚，索引缺失或非法时 fail-soft 回退，不阻塞调用方；对应套件 `smoke-test-l0-index.mjs` 已并入全量回归。

> **存档声明**：本文为该轮派工任务书的原文存档，正文中的「你要做 / 必须 / 禁止」等祈使句**均为当时下达的要求**，不代表当前待办；实际结果以页首「落点 / 验收」为准。

---

> **投喂方式（存档）**：该轮要求本段与 `_COMMON.md` 一并投喂；该批次已执行完毕。


## 【P1】L0 向量索引与增量更新（原任务书）

**目标**：为 T1 产出的 L0 建立向量索引，供语义检索使用。参照 OpenViking「Vector Index 只存 URI+向量+元数据，不含文件内容」（来源见 PROMPT-PACK §0.5）。

**涉及功能模块**：新增 `lib/l0-index-pre.js`；消费 `lib/l0-extract-pre.js`；参考 `lib/memory-index-pre.js`（既有索引范式）。

**验收标准**：
1. 177 条真实记忆全量建索引，每条 `{id, vector, l0, source, l0Hash, updatedAt}`，**零丢失**
2. 增量：改一条 → 仅重算该条（可断言"重算条数"）
3. 失效条目可移除
4. 索引缺失/非法 → fail-soft 回退，**不阻塞任何调用方**
5. 新增 smoke 全绿；既有五套基线不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/l0-extract-pre.js`、`lib/memory-index-pre.js`、`lib/semantic-js-pre.js`、`lib/m4-corpus-pre.js`
- 关键词：`buildL0IndexPre`、`extractL0Pre`、`MemoryFileIndex`、`createJsSemanticEnginePre`、`JS_SEMANTIC_ENGINE_VERSION`、`memoryIndexVersion`、`sourceVersion`、`recordDigest`
- 必须先确认：① `buildL0IndexPre` 的返回字段 ② C2 引擎的创建函数名与 embedding 调用方式（含 `query:`/`passage:` 前缀如何传）③ 既有索引落在哪个目录

**改动边界**：
- ✅ 允许新增：`lib/l0-index-pre.js`、`tests/smoke/smoke-test-l0-index-pre.mjs`
- ❌ 禁止修改：`lib/l0-extract-pre.js`（T1 已锁定）、`lib/index.js`、`lib/semantic-js-pre.js`、任何既有 `.js`
- ❌ 禁止：引入依赖、在索引中存原文

**完成自检**：按 §5 模板（本段 `node --check lib/l0-index-pre.js`）。

**回滚**：删除新增两个文件即可（本段不接线，零残留）。

---
