> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【P7】写入侧缺陷修复

**目标**：两个独立小缺陷 ① 账本标题重复（最近 6 个中 3 个含两个 `# 交接账本` 标题行、时间戳不一致，解析会取到错的）② `PLAN.md` 退化成日志（并列堆积 2.2.5/2.2.6 状态与历史踩坑，无老化）。

**涉及功能模块**：`memory_note_pre` 的 `kind=handoff` 分支；白板归档（复用既有 PLAN archive 机制）。

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
