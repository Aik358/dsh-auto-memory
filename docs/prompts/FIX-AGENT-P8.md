> **给使用者的说明**：下面是**一整段可直接复制投喂**的 prompt，已自包含（硬约束内联 + 绝对路径），Agent 无需再读 `_COMMON.md`。
> 复制时从 `你是一名严谨的修复 Agent` 开始，一直复制到文件末尾。

---

你是一名严谨的修复 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：把已交付但闲置的 RRF 融合接进 recall（替换字典序排序）

## 0. 必读文件（绝对路径，先全部读完再动手）

- `D:\dsh-auto-memory\lib\index.js` —— 重点 `async recall(` 起始处（上次观测：第 3301 行，**行号可能漂移，必须重新 grep 定位**）
- `D:\dsh-auto-memory\lib\recall-fusion-pre.js` —— P3 已交付的 RRF 实现（**当前零引用**）
- `D:\dsh-auto-memory\lib\semantic-js-pre.js` —— C2 语义引擎 / `_jsSemanticRank`
- `D:\dsh-auto-memory\lib\shadow-retrieval-pre.js` —— 词法臂
- `D:\dsh-auto-memory\lib\l0-extract-pre.js` —— L0 抽取（**只读参考，禁止修改**）
- `D:\dsh-auto-memory\docs\prompts\M8-2-ADJUDICATION.md` —— 本任务的裁决依据（可选读）

## 1. 问题（已有代码证据，你必须先自行复现验证）

**证据 A — P3 交付物零引用**：在 `lib/` 下 grep `recall-fusion`，除自身外无任何命中。`lib\recall-fusion-pre.js` 导出 `rankFusionRRFPre(pairs, opts)`、`FUSION_RRF_K_PRE_V1 = 60`、`FUSION_RRF_DIVISOR_PRE_V1 = 60`、`RECALL_FUSION_VERSION = 'rrf_fusion_pre_v1'`，**没有任何调用方**。

**证据 B — recall 当前是字典序排序，不是融合**：`recall()` 的 L0 命中排序形如

```js
.sort((a, b) => b.lex - a.lex || (b.sem || 0) - (a.sem || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
```

含义：**词法分 `lex` 绝对主导，语义分 `sem` 只在 `lex` 完全相等时才用于打破平局**。这导致 P2 接入的 C2 语义臂在排序中几乎不起作用——`recall()` 实质仍是纯词法。**请用 grep 复现这两条证据，并在回报中给出你实测到的真实行号。**

## 2. 目标

把 `rankFusionRRFPre` 接入 `recall()` 的 L0 命中排序，取代上述字典序排序，使词法臂与语义臂真正融合。

**本任务定位为「缺陷修复」而非新增能力**（P2 语义臂当前实效为零），因此新排序**默认开启**，但必须保留 `legacy` 回退开关。

## 3. 硬约束（违反即打回）

1. **搜索优先**：动手前必须 grep 定位每个符号并记下真实行号；不得臆造 API、字段名、配置项。
2. **最小 diff**：禁止整文件重写，禁止"顺手重构/统一风格/优化命名"。
3. **零新依赖**：项目 `dependencies` 为空。
4. **不得改 API 签名**：`recall(query, limit, agent, scope, opts)` 保持不变。
5. **不得删除既有测试断言**，不得降低任何既有 smoke 数字。
6. **禁止 score-space 加权 RRF**：必须用 rank-space `1/(k + rank/divisor)`，`k = 60`（复用 `FUSION_RRF_K_PRE_V1`）。依据：Hindsight issue #3956 实测，k=60 时动态范围仅 5.9 倍，加权会让排序退化为字典序，recall@20 从 0.97 崩到 0.40。
7. **不得触碰前缀缓存纪律层**（I1）：本任务只改检索排序，不改任何注入内容。

## 4. 改动边界

**允许修改**
- `D:\dsh-auto-memory\lib\index.js` —— 仅限 `recall()` 内部 **L0 命中排序那一段**（最小 diff）
- `D:\dsh-auto-memory\tests\smoke\` —— 允许新增断言文件

**禁止修改**（绝对路径）
- `D:\dsh-auto-memory\lib\recall-fusion-pre.js`（P3 已锁定）
- `D:\dsh-auto-memory\lib\l0-extract-pre.js`（T1 已锁定）
- `D:\dsh-auto-memory\lib\semantic-js-pre.js`
- `D:\dsh-auto-memory\lib\shadow-retrieval-pre.js`
- `D:\dsh-auto-memory\lib\index.js` 中除上述排序段以外的任何内容（尤其是注入、接续、水位逻辑）

## 5. 验收标准（逐条可验证）

1. **核心断言**：构造「`lex` 相同、`sem` 不同」的用例，排序结果**必须随 `sem` 变化**。这是本任务存在的唯一理由，必须有对应断言。
2. RRF 参数 `k = 60`，来自 `FUSION_RRF_K_PRE_V1`，不得硬编码其他值。
3. **排序确定性**：相同输入两次调用，`id` 序列逐项相等。
4. 提供 `legacy` 回退开关（配置项或参数，键名与默认值写进回报），**默认值为 `rrf`**。
5. 语义臂不可用（`_jsSemanticRank` 抛错或返回空）→ fail-soft 退回纯词法，不报错、不阻塞。
6. 非 L0 分支（旧调用方式，`opts` 不传 `format:'l0'`）行为**完全不变**。
7. 回报中必须给出 **legacy vs rrf 的排序差异实测**：至少 3 条主题性查询，每条列出 top-5 的 `id` 序列 diff。

## 6. 停止条件（触发即停下回报，禁止猜测）

- `rankFusionRRFPre(pairs, opts)` 的 `pairs` 形状与 `recall()` 现有数据结构无法对应；
- `lex` / `sem` 的实际含义与你理解不符（例如 `sem` 不是语义分）；
- 找不到 L0 分支的排序位置。

回报格式：
```
停止原因：未能定位 <符号/文件>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 完成后自检（逐项执行并把原始输出贴进回报）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node --check lib/index.js
node --check lib/recall-fusion-pre.js

# 基线（数字不得下降，缺失的套件先 ls tests/smoke/ 确认真实文件名）
node tests/smoke/smoke-test-p4-recall-l0-pre.mjs        # 34
node tests/smoke/smoke-test-l0-extract-pre.mjs          # 18
node tests/smoke/smoke-test-handoff-pre.mjs             # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs      # 58
node tests/smoke/smoke-test-water-step-pre.mjs          # 12
node tests/smoke/smoke-test-autocont-host-pre.mjs       # 29

# 接口一致性：rankFusionRRFPre 现在应有调用方
grep -rn "rankFusionRRFPre" lib/ | head -20

git status --short
git diff --stat
```

## 8. 回报必须包含（缺一不可）

1. 证据 A / 证据 B 的**复现行号**（`文件:行号`）
2. 每处改动写成 `文件路径:行号 — 原内容 → 新内容`
3. **为什么改在这个位置**：上游数据来源 + 下游消费者，用 grep 到的调用链证明
4. 开关的键名、默认值、行号；`recall()` 的全部调用点行号
5. legacy vs rrf 的 top-5 diff（第 5.7 条）
6. 回滚方式（本任务：`git checkout lib/index.js`，或把开关切回 `legacy`）
7. 上述自检的原始输出

**回滚**：`git checkout lib/index.js`；或把开关切回 `legacy`。

---

> **投喂提示**：本段自包含，无需再附 `_COMMON.md`。原文依据见 `D:\dsh-auto-memory\docs\prompts\P8-rrf-wiring.md` 与 `M8-2-ADJUDICATION.md`。
