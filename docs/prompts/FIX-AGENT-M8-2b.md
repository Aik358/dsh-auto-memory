> **给使用者的说明**：**P8 验收通过后再投喂本段**。同样自包含（硬约束内联 + 绝对路径），复制时从 `你是一名严谨的修复 Agent` 开始复制到文件末尾。

---

你是一名严谨的修复 Agent。工作目录：`D:\dsh-auto-memory`（Node.js 项目，BSD-3-Clause，v2.2.6，零运行时依赖）。

# 任务：补上「evidence 事件 → 聚合 → importance → 参与检索排序」这条管道

## 0. 必读文件（绝对路径，先全部读完再动手）

- `D:\dsh-auto-memory\lib\memory-importance-pre.js` —— M8-2 已交付的纯函数（**未接线**，本任务消费它）
- `D:\dsh-auto-memory\lib\context-bridge-pre.js` —— 六类 evidence 写入侧（第 45 行 `ACCESS_KINDS_PRE_V1`）
- `D:\dsh-auto-memory\lib\procedure-store-pre.js` —— `correctionRate` 口径来源（**必须复用，不得另立一套**）
- `D:\dsh-auto-memory\lib\fact-store-pre.js` —— `evidenceFor()`（注释称消费侧聚合，**实际零调用方**）
- `D:\dsh-auto-memory\lib\index.js` —— 第 6861–6876 行附近已有 evidence 事件的**读取范式**（**直接复用，不要另造**）；以及 P8 刚改好的 `recall()` 融合入口
- `D:\dsh-auto-memory\lib\recall-fusion-pre.js` —— P8 接线后的 RRF（**禁止修改**）
- 真实数据样本：`C:\Users\JH Z\.dsh\memory\evidence-pre\events\*.jsonl`（**必须实读至少 1 个文件确认行结构**）

## 1. 问题（已有代码证据，你必须先自行复现验证）

- **数据在盘上，只是没人读**：evidence 事件按日落盘为 JSONL，行结构含 `{ kind, memoryId, ts 或 event.ts, ... }`。
- `evidenceFor` 在 `lib/` 下 grep **仅命中注释**，`lib/index.js` 无 evidence store 实例 → **检索侧拿不到 evidence**。
- `lib\memory-importance-pre.js` 已交付 importance 纯函数，但**零引用**。
- 因此 M8-2 的原始目标「importance 参与候选排序」未达成。

**请用 grep + 实读一个 events 文件复现以上事实，并在回报中给出真实行号与一条真实事件样本（脱敏后）。**

## 2. 目标

新增只读聚合层 `lib\evidence-agg-pre.js`：按 `memoryId` 聚合六类计数与去重会话数 → 经 `memory-importance-pre.js` 转 importance → 作为**加权因子之一**接入 P8 已建好的 `recall()` 融合排序。

## 3. 硬约束（违反即打回）

1. **搜索优先**：每个符号先 grep 到定义处；**events 行结构必须实读真实文件确认，禁止假设字段名**。
2. **最小 diff**，禁止整文件重写。
3. **零新依赖**；新模块遵循 `lib\xxx-pre.js` 惯例：**纯函数 + IO 注入，零内置 IO**。
4. **只读**：聚合层**不得写入**任何文件，尤其不得修改 events 目录。
5. **fail-soft**：events 缺失/损坏/读取失败 → importance 取中性值，**绝不阻塞检索**。
6. **不得另立一套纠正口径**：`correction` 的负向处理必须复用 `procedure-store-pre.js` 的 `correctionRate` 口径。
7. **importance 只能是加权因子之一**，不得成为唯一排序依据。

## 4. 改动边界

**允许新增**
- `D:\dsh-auto-memory\lib\evidence-agg-pre.js`
- `D:\dsh-auto-memory\tests\smoke\smoke-test-evidence-agg-pre.mjs`

**允许修改**
- `D:\dsh-auto-memory\lib\index.js` —— 仅在 P8 建好的融合入口处**加一项加权**（最小 diff）

**禁止修改**（绝对路径）
- `D:\dsh-auto-memory\lib\memory-importance-pre.js`（M8-2 已锁定）
- `D:\dsh-auto-memory\lib\recall-fusion-pre.js`（P8 已锁定）
- `D:\dsh-auto-memory\lib\context-bridge-pre.js`（写入侧）
- `D:\dsh-auto-memory\lib\procedure-store-pre.js`
- `D:\dsh-auto-memory\lib\fact-store-pre.js`
- evidence 事件目录（只读，不得增删改）

## 5. 验收标准（逐条可验证）

1. `evidence-agg-pre.js` 为**纯函数 + IO 注入**，可用 fixture 锁定，结果**确定性**。
2. 按 `memoryId` 聚合六类计数 + `distinctSessions`，输出形状与 `memory-importance-pre.js` 的**输入契约一致**（以其源码为准）。
3. **有界读取**：默认最近 7 天 / 每文件末 400 行（沿用 `index.js:6861-6876` 范式），可配置；**不得全量扫描历史**。
4. **空数据返回中性值**：无 evidence 记录的记忆既不置顶也不沉底。
5. **只读性断言**：运行前后 events 目录文件哈希不变。
6. `correction` 为负向；importance **只作为加权因子之一**接入。
7. 既有基线不降：`memory-importance 17`、`p4 34` 及十三套基线。
8. 覆盖「读取失败 → 中性值」的 fail-soft 断言。

## 6. 停止条件（触发即停下回报，禁止猜测）

- 真实 events 文件结构不含 `kind` 或 `memoryId`；
- `memory-importance-pre.js` 的输入契约无法确认；
- P8 的融合入口不支持加入加权项（此时应回报"需先扩展 P8 接口"，**不得自行改写 `recall-fusion-pre.js`**）。

回报格式：
```
停止原因：未能定位/确认 <符号/结构>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```

## 7. 完成后自检（逐项执行并把原始输出贴进回报）

```bash
cd /d/D/dsh-auto-memory || cd D:/dsh-auto-memory

node --check lib/evidence-agg-pre.js
node --check lib/index.js

node tests/smoke/smoke-test-evidence-agg-pre.mjs       # 新增
node tests/smoke/smoke-test-memory-importance-pre.mjs   # 17
node tests/smoke/smoke-test-p4-recall-l0-pre.mjs        # 34
node tests/smoke/smoke-test-l0-extract-pre.mjs          # 18
node tests/smoke/smoke-test-handoff-pre.mjs             # 51
node tests/smoke/smoke-test-continue-chain-pre.mjs      # 58
node tests/smoke/smoke-test-water-step-pre.mjs          # 12
node tests/smoke/smoke-test-autocont-host-pre.mjs       # 29

# 接口一致性：importance 现在应有调用方
grep -rn "memory-importance\|evidence-agg" lib/ | head -20

git status --short
git diff --stat
```

## 8. 回报必须包含（缺一不可）

1. **一条真实 events 行样本**（脱敏）与你据此确认的字段结构
2. 每处改动写成 `文件路径:行号 — 原内容 → 新内容`
3. importance 加在融合公式的哪一项、为何不破坏 P8 的 rank-space 结构
4. 有界读取的具体参数与默认值
5. 只读性证据（events 目录前后哈希）
6. 回滚方式：删除新增文件 + `git checkout lib/index.js`
7. 上述自检的原始输出

---

> **投喂提示**：本段自包含，无需再附 `_COMMON.md`。原文依据见 `D:\dsh-auto-memory\docs\prompts\M8-2b-evidence-pipeline.md` 与 `M8-2-ADJUDICATION.md`。
