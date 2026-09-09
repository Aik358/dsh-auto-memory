> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【P6】账本权重化截断

**目标**：`ledger.slice(0, 8000)` 是位置截断。实测账本**段内异质**——「已试方案与失败原因」段里三条全是**成功解法**；「进度与下一步」混了已完成项、真待办、元指令。按位置截可能把高价值段整体截掉。

**涉及功能模块**：`lib/index.js`（解析 + 权重分配），解析部分建议抽成 `lib/handoff-anchor-pre.js` 纯函数。

**验收标准**：
1. 正确解析四段：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`
2. 权重：失败原因 .35 ＞ 下一步 .30 ＞ 目标 .20 ＞ 任务状态 .15
3. 预算不足时**从最低权重段开始截**
4. 纯函数 + fixture 锁定解析与排序

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`docs/M-CM7-HANDOFF-LAYERED-RETRIEVAL.md`
- 关键词：`readLatestHandoff`、`## 任务状态`、`## 已试方案与失败原因`、`handoffLedgerChars`、`handoffPlanChars`、`writeHandoffLedger`
- 必须先确认：① 四段标题的**确切字符串**（含空格/全半角）② 是否存在 `handoffLedgerChars` 等配置项（若有则复用，勿硬编码）

**改动边界**：
- ✅ 允许新增：`lib/handoff-anchor-pre.js`、`tests/smoke/smoke-test-handoff-anchor-pre.mjs`
- ✅ 允许：`buildContinueCarry()` 中调用新解析函数替换 `slice(0,8000)`
- ❌ 禁止：删除任何原文（只影响注入，不动文件）；把"成功解法"误标为"失败原因"

**回滚**：`git checkout lib/index.js` + 删除新增文件。

---
