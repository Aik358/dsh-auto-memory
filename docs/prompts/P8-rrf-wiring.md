> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。
> 依赖：**P3（已完成，c917bbe）**。`rankFusionRRFPre` 已交付但零引用，本段负责接线。
> 定位：**缺陷修复**（修复 P2 语义臂实效性），非新增能力 → 默认开启，保留 `legacy` 回退开关。

## 【P8】RRF 接线进 recall（替换字典序排序）

**背景（实读代码，2026-09-09 核实）**：
- `lib/index.js:3301` `async recall(query, limit = 8, agent, scope = 'all', opts = null)`。
- 现状 L0 分支排序为 **`.sort((a, b) => b.lex - a.lex || (b.sem || 0) - (a.sem || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))`** —— **字典序排序**：词法分主导，**语义分仅在词法分完全相等时才打破平局**。
- 后果：P2 接入的 C2 语义臂（`_jsSemanticRank`）在排序中几乎不起作用，`recall()` 实质仍是纯词法。
- P3 已交付 `lib/recall-fusion-pre.js`：`rankFusionRRFPre(pairs, opts)`、`FUSION_RRF_K_PRE_V1 = 60`、`FUSION_RRF_DIVISOR_PRE_V1 = 60`、`RECALL_FUSION_VERSION = 'rrf_fusion_pre_v1'` —— **经 grep 确认零引用**。

**目标**：把 `rankFusionRRFPre` 接入 `recall()` 的 L0 命中排序，替换字典序排序，使词法臂与语义臂真正融合。

**涉及功能模块**：`lib/index.js` 的 `recall()`（`3301` 起）L0 分支；消费 `lib/recall-fusion-pre.js`。

**验收标准**：
1. L0 命中的排序由 `rankFusionRRFPre` 产生，**词法与语义均为真实输入**（构造 lex 相同、sem 不同的用例，排序必须随 sem 变化——**这是本段的核心断言**）
2. RRF 参数：`k = 60`（复用 `FUSION_RRF_K_PRE_V1`），**禁止 score-space 加权**
3. **排序确定性**：相同输入两次结果全等（id 序列逐项相等）
4. 提供 `legacy` 回退开关（配置或参数），可一键回到字典序排序；**默认值为 `rrf`**（缺陷修复）
5. 语义臂不可用 → fail-soft 退回纯词法，不报错、不阻塞
6. 既有基线不降：**p4 34**、l0-extract 18 / handoff 51 / continue-chain 58 / water-step 12 / autocont-host 29；新增断言覆盖第 1、3 条
7. 回报中必须给出 **legacy vs rrf 的排序差异实测**（至少 3 条主题性查询，列出 top-5 id 序列 diff）

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`lib/recall-fusion-pre.js`、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`
- 关键词：`async recall(`、`l0Mode`、`_jsSemanticRank`、`rankFusionRRFPre`、`FUSION_RRF_K_PRE_V1`、`FUSION_RRF_DIVISOR_PRE_V1`、`b.lex - a.lex`、`l0Hits`、`l0Corpus`
- **必须先确认**：① `recall()` 中 L0 分支的准确行号范围与 `l0Hits` 的构造过程 ② `lex` / `sem` 两个分数的量纲（是否可比；若不可比，RRF 的 rank 输入正是为此设计）③ `rankFusionRRFPre(pairs, opts)` 的 `pairs` 确切形状（**以源码为准，不得臆造**）④ `_jsSemanticRank` 的返回结构

**改动边界**：
- ✅ 允许修改：`lib/index.js` 中 `recall()` 的 **L0 命中排序部分**（最小 diff）
- ✅ 允许新增：`tests/smoke/` 断言
- ❌ **禁止修改**：`lib/recall-fusion-pre.js`（P3 已锁定）、`lib/l0-extract-pre.js`、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`
- ❌ 禁止：改变 `recall()` 签名；改动 L0 抽取逻辑；改动注入（I1）；score-space 加权 RRF（Hindsight issue #3956：k=60 动态范围仅 5.9 倍，加权致 recall@20 从 0.97 崩到 0.40）
- ❌ 禁止：整文件重写 `index.js`

**集成位置正确性（回报必写）**：
- 说明改在 `recall()` 内部何处、为何不影响非 L0 分支（旧行为）
- 列出 `recall()` 的全部调用点行号
- 开关落在哪个配置项（键名 + 默认值 + 行号）

**回滚**：`git checkout lib/index.js`；或把开关切回 `legacy`（说明切换方式）。

**停止条件**：若 `rankFusionRRFPre` 的 `pairs` 形状与 `recall()` 现有数据结构无法对应，**立即停止回报**，禁止自造适配层绕过。

**自检清单**：按 `_COMMON.md` §5 执行（本段重点：`node --check lib/index.js` + p4 smoke ≥34 + 确定性断言）。
