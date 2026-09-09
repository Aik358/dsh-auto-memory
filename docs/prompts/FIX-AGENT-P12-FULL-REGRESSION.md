> **给使用者的说明**：**一整段投喂**。流程 = 修 P12 → 静态自检 + 静态回归 → **重启由你执行** → **live 验证由你按清单做** → 你结合两段结果裁定是否发版。
> 复制时从 `你是 DSH 环境里的执行 Agent` 开始到文件末尾（自包含，无需 `_COMMON.md`）。
> ⚠️ **Agent 不能重启**（重启会截断对话），所以本任务里 Agent 只负责「改 + 静态验证 + 产出重启后 live 清单」，重启与 live 验证是你的事。

---

你是 DSH 环境里的执行 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。你可以执行命令、读写文件。**你不能重启 dsh web，也不要尝试**。

# 任务：修 QueryPlan 截断缺陷 → 静态回归 → 产出「重启后 live 验证清单」给用户

## 阶段 0 · 前置检查（先做，有问题就停下）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory
git status --short
git log --oneline -3
```

- 工作区现有两个**未提交**文件（`lib/index.js` +11/-5 子代理超时兜底与 localAgent 兼容；`lib/python-setup-pre.js` +16/-4 issue #27 bge-m3 仓库名、#28 tokenizer）。这两个是**并行会话的真实 bug 修复**。
- **不要擅自提交它们**——在回报里说明，等用户确认。
- 除这两个外，若还有其他改动，**立即停止回报**。

## 阶段 1 · 修复 P12（QueryPlan 字典序截断丢弃高权重词）

### 1.1 缺陷（已核实，先自行复现）

**这是生产路径**：`lib\context-host-pre.js:27` 导入 `buildQueryPlan` / `lexicalSearch`，在 `:321-323` 以 `mode:'prefetch'` 调用 ⇒ **主动联想（预取）链路**，本项目的核心功能。

`lib\shadow-retrieval-pre.js` 的 `buildQueryPlan` 内（约 246-250）：

```js
// 排序稳定:按 term 字典序
const terms = [...seenTerms.values()].sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
if (terms.length > SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms) {   // queryTerms = 32
  terms.length = SHADOW_LEXICAL_BUDGET_PRE_V1.queryTerms
}
```

而 `seenTerms` 里每个词**都带 `weight`**（约 `:223`）：

```
trigger 1.0 ＞ recent-user 0.8 ＞ tool-result 0.6 ＞ reasoning 0.5 ＞ tool-call 0.4 ＞ assistant 0.2
```

⇒ 排序只为确定性，截断却取字典序前 32 个：**权重 1.0 的 trigger 词可能被丢，权重 0.2 的 assistant 词反而留下**。

### 1.2 改法

排序键改为 **`weight` 降序优先，`term` 字典序升序作为稳定 tiebreak**，截断逻辑与 `truncated` 标记不变。

### 1.3 改动边界

- ✅ 允许修改：`lib\shadow-retrieval-pre.js` 的 `buildQueryPlan` 排序段（最小 diff）
- ✅ 允许修改：`tests\smoke\smoke-test-m4-pre.mjs` 中因 `queryDigest` 变化失效的断言（**逐条列出新旧值**）
- ❌ 禁止修改：`lib\context-host-pre.js`、`lib\index.js`、`lib\semantic-js-pre.js`、`lib\recall-fusion-pre.js`
- ❌ 禁止：改 `queryTerms` 预算、改 tokenizer、改 weight 赋值规则、引入依赖、整文件重写

### 1.4 验收

1. fixture：词项 > 32 且高权重词恰好字典序靠后 ⇒ 修复后高权重词保留、低权重词被截；修复前该词被截（回归证明）
2. 确定性：同输入两次 `buildQueryPlan` 结果 `JSON.stringify` 全等
3. 词项 < 32 时结果与现状一致（无谓变更）
4. `queryDigest` 变化清单（新旧值 + 原因）

## 阶段 2 · 静态自检与静态回归（Agent 做，不涉及重启）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory
node --check lib/shadow-retrieval-pre.js

node tests/smoke/smoke-test-m4-pre.mjs                          # m4（可能因 queryDigest 变更而更新，须全绿）
node tests/smoke/smoke-test-p8-rrf-wiring-pre.mjs               # 14
node tests/smoke/smoke-test-p4-l0-response-pre.mjs              # 34
node tests/smoke/smoke-test-evidence-agg-pre.mjs                # 14
node tests/smoke/smoke-test-memory-importance-pre.mjs           # 18
node tests/smoke/smoke-test-p9a-correction-attribution-pre.mjs  # 26
node tests/smoke/smoke-test-p9d-recent-evidence-ts-pre.mjs      # 13
node tests/smoke/smoke-test-handoff-pre.mjs                     # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs              # 58
```

**任一数字下降 → 立即停止回报**（这是静态 Go/No-Go 的第一道）。

## 阶段 3 · 产出「重启后 live 验证清单」（交给用户执行）

在回报末尾附上下面这份清单，**明确标注：由用户在重启 dsh web 之后逐项执行**。

| # | 功能 | 怎么验 | 通过标准 |
|---|---|---|---|
| **L1** | **主动联想（P12 直接影响面）** | 开一个新会话，聊一段与已有记忆主题相关的话 | 记忆被**主动**联想并注入；从日志/diag 看 `queryPlan` 保留的词里**含高权重来源（user/trigger）的词** |
| **L2** | **语义检索（P8）** | 用 `memory_recall_pre` 查一个**词法不重合但语义相关**的查询（如记忆里写"npm 发布报 ENEEDAUTH"，查"发布凭证问题"） | 能召回。失败则切 `legacy` 对比——若 legacy 正常而 rrf 失败 ⇒ **P8 回归** |
| **L3** | L0 返回与展开 | 同 L2 的 recall | 返回 L0 列表（含 id/score），用 `expand="mem_xxx"` 能取到原文 |
| **L4** | M8 记忆中枢 | 浏览器打开记忆面板 | 三栏（技能/事实/经历）有内容或正确空态；`GET /api/dsh-auto-memory-pre/memory-hub` 返回 200 + overview |
| **L5** | 证据落盘 | 查看 `C:\Users\JH Z\.dsh\memory\evidence-pre\events\` 当日文件 | 有 `seen` 事件新增 |
| **L6** | 跨窗口接续 | 让水位涨到 75% 触发自动接续（或手动一键接续） | 新会话收到分层材料，且**不再要求先 read 转写**；接续后对话能连续推进 |
| **L7** | 记忆写入 | 对话若干轮后检查日志文件与 `facts.json` / `episodes.json` | 有新条目；再重启一次后数据能 restore 不丢 |

> L1 与 L2 是**最关键**的两项：P12 改的是主动联想，P8 是排序行为变更。

## 阶段 4 · 静态结论 + 发版建议

回报最后给一段**静态侧结论**（不包含 live，live 由用户补）：

```
静态结论：【通过 / 未通过】
- 九套基线：<全绿 / 哪项失败>
- queryDigest 变更：<清单>
- 建议：若静态通过，请用户重启 dsh web 后按 live 清单验证；live 全过即可发版
```

### 静态 No-Go 判据

1. 任一静态基线数字下降
2. 工作区除阶段 0 那两个文件外还有其他未提交改动

### 回报必须包含

1. P12 改动：`文件:行号 — 原内容 → 新内容`
2. 修复前 / 修复后保留词对比（fixture 证据）
3. `queryDigest` 变更清单
4. 九套静态原始输出
5. **静态结论**
6. **重启后 live 验证清单**（阶段 3 表，供用户执行）
7. 回滚：`git checkout lib/shadow-retrieval-pre.js tests/smoke/smoke-test-m4-pre.mjs`

## 硬约束（全程）

- 搜索优先：每个符号先 grep 定位，行号以实际为准
- 最小 diff，禁止整文件重写、禁止顺带重构
- 零新依赖；不改既有 API 签名；不删既有断言
- **不尝试重启 dsh web**；无法定位就停下回报，禁止猜测

---

> 背景：`D:\dsh-auto-memory\docs\STATUS-BOARD.md` §5.1、`docs\RELEASE-GO-NOGO.md`。
