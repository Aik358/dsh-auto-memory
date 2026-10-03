> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【P4】recall 返回 L0 + 按需展开

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
