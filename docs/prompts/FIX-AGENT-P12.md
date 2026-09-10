> **给使用者的说明**：**可选段**（是否发版前修由你定）。复制时从 `你是一名严谨的修复 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> 改 `lib\shadow-retrieval-pre.js`，与并行会话的 `index.js` / `python-setup-pre.js` 无冲突。

---

你是一名严谨的修复 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：修复 QueryPlan 词项截断按字典序丢弃高权重词

## 0. 缺陷（已核实，必须先自行复现）

**这是生产路径，不是评估通路**：`lib\context-host-pre.js:27` 导入 `buildQueryPlan` / `lexicalSearch`，在 `:321-323` 以 `mode:'prefetch'` 调用——这是**主动联想（预取）**链路，即本项目的核心功能。

**缺陷代码**（`lib\shadow-retrieval-pre.js`，`buildQueryPlan` 内约 246-250）：

```js
// 排序稳定:按 term 字典序
const terms = [...seenTerms.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
if (terms.length > SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms) {   // queryTerms = 32
  terms.length = SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms
}
```

**问题**：排序纯粹为了确定性，截断却直接取前 32 个 ⇒ **被保留的是字典序靠前的词，与词的重要性无关**。

而 `seenTerms` 里**每个词都带 `weight`**（由来源决定，`:223`）：

```
trigger 1.0 > recent-user 0.8 > tool-result 0.6 > reasoning 0.5 > tool-call 0.4 > assistant 0.2
```

后果：一个 `weight=1.0` 的 trigger 词可能被截掉，而 `weight=0.2` 的 assistant 词被留下 ⇒ 主动联想的词法候选集被削偏。
触发频率**不低**：窗口为 8 段 / 4096 字符（`:65-67`），词项很容易超过 32。

**第一步**：复现上述行号与常量值，写进回报。

## 1. 必读文件（绝对路径）

- `D:\dsh-auto-memory\lib\shadow-retrieval-pre.js` —— 改动面 `buildQueryPlan`（221-290）、常量 `SHADOW_LEXICAL_BUDGET_PRE_V1`（64-70）
- `D:\dsh-auto-memory\lib\context-host-pre.js` —— 唯一生产调用点 `:321-323`（**禁止修改**）
- `D:\dsh-auto-memory\tests\smoke\smoke-test-m4-pre.mjs` —— 现有断言（**含 `queryDigest` 断言 2 处，本段必然需要更新**）

## 2. 目标

把截断选择从「字典序靠前」改为「**权重高者优先**」，同时保持确定性。

## 3. 改动边界

- ✅ 允许修改：`lib\shadow-retrieval-pre.js` 中 `buildQueryPlan` 的排序那一段（最小 diff）
- ✅ 允许修改：`tests\smoke\smoke-test-m4-pre.mjs` 中因 `queryDigest` 变化而失效的断言（**必须逐条说明新旧值与变更原因**）
- ❌ **禁止修改**：`lib\context-host-pre.js`、`lib\index.js`、`lib\semantic-js-pre.js`、`lib\recall-fusion-pre.js`
- ❌ 禁止：改 `queryTerms` 预算值；改 tokenizer；改 `weight` 的赋值规则；引入新依赖；整文件重写

## 4. 设计要求

1. 排序键：**`weight` 降序**（高权重优先保留），**同权重按 `term` 字典序升序**作为稳定 tiebreak
2. 截断逻辑不变（仍取前 `queryTerms` 个，仍置 `truncated`）
3. **确定性不变**：相同输入 → 逐字节相同的 QueryPlan（含 `queryDigest`）
4. 可选增强（**仅在你能证明不影响确定性时做**）：把词项在窗口内的出现次数纳入次要排序键；若做，必须写清理由与断言。**做不了就只做 weight 排序，不要勉强。**

## 5. 验收标准

1. 构造 fixture：窗口内词项 > `queryTerms`，且高权重词恰好字典序靠后 → **修复后高权重词保留、低权重词被截**
2. 同一 fixture：修复前该高权重词被截（回归证明）
3. 确定性：同输入两次 `buildQueryPlan` 结果 `JSON.stringify` 全等
4. 未触发截断时（词项 < 32）结果与现状一致（无谓变更）
5. **`queryDigest` 变化的说明**：列出所有因本改动而变化的断言及新旧值
6. 既有基线不降：`m4`（更新后全绿）、handoff 51 / continue-chain 58 / p8 14 / p4 34 / evidence-agg 14 / memory-importance 18 / p9a 26 / p9d 13

## 6. 停止条件

- 若 `weight` 字段在截断时不可用（例如被归一化掉）→ 停止回报；
- 若改动导致 `m4` 断言大面积失效（>5 处）→ 停止回报，说明影响面，等我裁决。

```
停止原因：<描述>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 完成后自检

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node --check lib/shadow-retrieval-pre.js

node tests/smoke/smoke-test-m4-pre.mjs                          # 基线（更新后应全绿）
node tests/smoke/smoke-test-handoff-pre.mjs                     # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs              # 58
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs               # 14
node tests/smoke/smoke-test-p4-l0-response-pre.mjs              # 34
node tests/smoke/smoke-test-evidence-agg-pre.mjs                # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs           # 18
node tests/smoke/smoke-test-p9a-correction-attribution-pre.mjs  # 26
node tests/smoke/smoke-test-p9d-recent-evidence-ts-pre.mjs      # 13

git status --short
git diff --stat
```

## 8. 回报必须包含

1. 复现结果（真实行号 + `queryTerms` 值）
2. 改动：`文件:行号 — 原内容 → 新内容`
3. 修复前 / 修复后的保留词对比（fixture 证据）
4. **`queryDigest` 变更清单**（新旧值 + 原因）
5. 确定性断言结果
6. 回滚：`git checkout lib/shadow-retrieval-pre.js tests/smoke/smoke-test-m4-pre.mjs`

---

> 立项背景：`D:\dsh-auto-memory\docs\STATUS-BOARD.md` §5。
