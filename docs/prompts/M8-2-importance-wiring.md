> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。
> 依赖：**M8-1**（可选，不强依赖）；建议 P3（融合层）之后再执行，避免权重叠加冲突。

## 【M8-2】evidence → importance 权重接入检索排序

**背景（有代码证据）**：
- 六类证据 `['seen','read','cite','reuse','success','correction']` 已由 M5 写入：`lib/context-bridge-pre.js:45`（枚举）、`:292`（cite）、`:307/:309`（correction）、`:112`（聚合，含 `distinctSessions`）。
- `lib/fact-store-pre.js` 的 `evidenceFor()` 是**消费侧聚合**。
- **但六类计数目前只用于 M-04 技能晋升**（`lib/procedure-store-pre.js` 文件头 "promote 读 evidence stats"），**从未接入记忆检索排序**——检索侧 `shadow-retrieval-pre.js` / `semantic-js-pre.js` 均无 evidence 权重。

**结论**：importance 的**数据源早已具备，缺的是接线**。本段即补这条线。

**目标**：把 evidence 聚合值转换为**不随查询变化**的重要性权重，参与候选排序（作为绝对量，可缓解 P3 中"分数丧失绝对性"的问题）。

**涉及功能模块**：新增 `lib/memory-importance-pre.js`；接入检索/融合（具体接入点须先搜索确认）。

**验收标准**：
1. 提供纯函数：输入 evidence 聚合（`{distinctSessions, seen, read, cite, reuse, success, correction}`）→ 输出 `importance ∈ [0,1]`
2. **correction 必须为负向**（被纠正多的记忆重要性下降）；`success` / `reuse` / `distinctSessions` 为正向
3. 缺省（无 evidence 记录）时返回**中性值**，不得因此把记忆排到末尾或置顶
4. 纯函数 + fixture 锁定；确定性
5. 五套基线不降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/context-bridge-pre.js`、`lib/fact-store-pre.js`、`lib/procedure-store-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/semantic-js-pre.js`
- 关键词：`evidenceFor`、`ACCESS_KINDS_PRE_V1`、`distinctSessions`、`promote`、`correctionRate`、`fuseD6Pre`、`lexicalSearch`、`scores.total`
- **必须先确认**：① `evidenceFor()` 的返回结构确切字段名 ② procedure-store 现有如何把 evidence 转成 `correctionRate`（**直接复用其口径，不得另立一套**）③ 检索侧候选结构里 scores 的字段名（决定 importance 加到哪里）

**改动边界**：
- ✅ 允许新增：`lib/memory-importance-pre.js`、`tests/smoke/smoke-test-memory-importance-pre.mjs`
- ❌ **禁止修改**：`lib/context-bridge-pre.js`（写入侧）、`lib/procedure-store-pre.js`、evidence 的写入逻辑
- ❌ 禁止：另立一套与 `correctionRate` 冲突的纠正口径；把 importance 用作唯一排序依据（只能是加权因子之一）
- ❌ 若 P3 尚未完成，本段**只交付纯函数与测试，不接线**，并在回报中说明

**集成位置正确性（回报必写）**：
- 说明 importance 加在融合公式的哪一项、为何不破坏 P3 的绝对性改造
- 列出下游影响（哪些排序结果会变）
- 回滚：删除新增文件；若已接线则 `git checkout` 对应文件

**停止条件**：若 `evidenceFor()` 返回结构与 procedure-store 的 `correctionRate` 口径无法确认，**立即停止回报**，不得自创公式。

**自检清单**：按 `_COMMON.md` §5 执行。
