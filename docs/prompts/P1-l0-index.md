> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【P1】L0 向量索引与增量更新

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
