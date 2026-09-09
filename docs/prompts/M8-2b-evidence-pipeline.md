> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。
> 依赖：**P8（必须已完成）** —— importance 加权需要 P8 建好的融合入口。
> 本段完成 M8-2 的原始目标（311e2e8 仅交付纯核心）。

## 【M8-2b】evidence → 检索数据管道 + importance 加权接入

**背景（实读代码，2026-09-09 核实）**：
- **数据在盘上，只是没人读**：evidence 事件落盘于 `~/.dsh/memory/evidence-pre/events/`，**按日 JSONL**（如 `2026-08-23.jsonl` 2491B、`2026-08-25.jsonl` 18102B），行结构含 `{kind, memoryId, ts 或 event.ts}`。
- `lib/index.js:6861-6876` **已有读取范式**（读最近 2 个 `.jsonl`、每文件末 400 行、按 `kind==='seen'` 过滤、5s 聚类）——**直接复用此范式，不要另造**。
- 六类 kind 枚举：`lib/context-bridge-pre.js:45` `ACCESS_KINDS_PRE_V1 = ['seen','read','cite','reuse','success','correction']`。
- **零调用方**：`grep -rn "evidenceFor" lib/` 仅命中注释（含构建产物 `fact-store.js`）；`lib/procedure-store-pre.js` 注释明确"由调用方传入，本模块不直接读 evidence store"。
- `lib/memory-importance-pre.js`（M8-2, 311e2e8）**已交付纯函数但未接线**。

**目标**：补上「evidence 事件 → 按 memoryId 聚合 → importance → 参与 P8 融合排序」这条管道。

**涉及功能模块**：
- 新增 `lib/evidence-agg-pre.js`（只读聚合层）
- 消费 `lib/memory-importance-pre.js`（已存在）
- 接入点：P8 建好的 `recall()` 融合入口

**验收标准**：
1. `lib/evidence-agg-pre.js` 为**纯函数 + IO 注入**（沿用项目惯例：零内置 IO、可 fixture 锁定）
2. 按 `memoryId` 聚合六类计数 + 去重会话数（`distinctSessions`），输出形状**与 `memory-importance-pre.js` 的输入契约一致**（以其源码为准）
3. **有界读取**：默认最近 7 天 / 每文件末 400 行（沿用既有范式），可配置；**不得全量扫描历史**
4. **空数据返回中性值**：无 evidence 记录的记忆既不置顶也不沉底
5. **只读、零副作用**：不写回、不修改 events 文件；读取失败 → fail-soft（importance 取中性值），**绝不阻塞检索**
6. importance 作为**加权因子之一**接入 P8 融合，**不得作为唯一排序依据**；`correction` 必须为负向（复用 procedure-store 的 `correctionRate` 口径）
7. 确定性：相同 events 输入 → 相同聚合结果
8. 基线不降：**memory-importance 17**、**p4 34** 及十三套基线；新增聚合层 smoke

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`（读取范式 `6861-6876`）、`lib/context-bridge-pre.js`、`lib/memory-importance-pre.js`、`lib/fact-store-pre.js`、`lib/procedure-store-pre.js`、`lib/recall-fusion-pre.js`
- 关键词：`evidence-pre`、`events`、`kind`、`memoryId`、`ACCESS_KINDS_PRE_V1`、`distinctSessions`、`correctionRate`、`importance`、`rankFusionRRFPre`、`_jsSemanticRank`
- **必须先确认**：① `memory-importance-pre.js` 的**确切输入契约**（字段名与缺省处理）② events 行的真实结构（`ts` 还是 `event.ts`？`sessionId` 字段名？）——**必须实读一个真实 events 文件确认，不得假设** ③ P8 融合入口的当前形态（`rankFusionRRFPre` 的 `pairs`/`opts` 是否已支持权重项）

**改动边界**：
- ✅ 允许新增：`lib/evidence-agg-pre.js`、`tests/smoke/smoke-test-evidence-agg-pre.mjs`
- ✅ 允许：`recall()` 中调用聚合层并加权（**最小 diff，仅在 P8 建好的融合入口处加一项**）
- ❌ **禁止修改**：`lib/context-bridge-pre.js`（写入侧）、`lib/memory-importance-pre.js`（M8-2 已锁定）、`lib/recall-fusion-pre.js`（P8 已锁定）、`lib/procedure-store-pre.js`
- ❌ 禁止：另立一套与 `correctionRate` 冲突的纠正口径；修改/删除 evidence 事件文件；在聚合层引入写入能力
- ❌ 禁止：把 importance 变成唯一排序依据

**集成位置正确性（回报必写）**：
- 说明 importance 加在融合公式的哪一项、为何不破坏 P8 的 rank-space 结构
- 列出下游影响（哪些查询的排序结果会变）
- 回滚：删除新增文件 + `git checkout lib/index.js`

**停止条件**：
1. 若真实 events 文件结构与预期不符（缺 `kind` 或 `memoryId`），**立即停止回报**，不得猜测字段
2. 若 `memory-importance-pre.js` 输入契约无法确认，**立即停止回报**，不得自造公式

**自检清单**：按 `_COMMON.md` §5 执行（本段重点：`node --check lib/evidence-agg-pre.js` + memory-importance smoke ≥17 + 只读性断言）。
