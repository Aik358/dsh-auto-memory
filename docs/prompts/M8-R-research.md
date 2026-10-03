> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。

## 【M8-R】M8 记忆系统调研（前置，阻塞后续）

**目标（本段只调研，不改代码）**：回溯「原记忆系统参考 Hermes、架构极不成熟」这一结论，核实现有 M8 三层实现的真实数据流、存储结构与调用点，给出替代架构的方案对比与选型理由。**产出报告，等待确认。**

### 调研任务

**任务 1 · 回溯原始结论与架构细节**
- 检索路径：`docs/`（尤其 `PROACTIVE-*`、`M8-MEMORY-HUB.md`、`HANDOFF-M8-M9-M10.md`、`PROJECT-FREEZE-AND-ROADMAP.md`、`proactive-associative-memory-*.md/html`）
- 关键词：`Hermes`、`三层记忆`、`episodic`、`semantic`、`procedural`、`procedural memory`、`记忆中枢`、`M-02`、`M-03`、`M-04`、`元代码`
- 要求：引用**具体文件与行号**说明——① 当初判定"参考 Hermes"的依据 ② "架构极不成熟"具体指什么（分类边界？转化条件？存取策略？）③ 原设计的目标形态

**任务 2 · 梳理现有实现的数据流与存储结构**
- 检索路径：`lib/fact-store-pre.js`、`lib/episodic-store-pre.js`、`lib/procedure-store-pre.js`、`lib/memory-hub-pre.js`、`lib/memory-index-pre.js`、`lib/memory-writer-pre.js`、`lib/index.js`、`lib/m7-index-sync-host-pre.py?`（应为 `.js`）、`python/worker_semantic_pre_v1.py`
- 关键词：`createFactStorePre`、`createEpisodicStorePre`、`createProcedureStorePre`、`createMemoryHubPre`、`ingestJudgementRows`、`evidenceFor`、`append(`、`consolidate(`、`promote`、`judgement-shadow`、`episodic_candidate`、`semantic_candidate`、`profile_candidate`、`procedure_candidate`、`KIND_TO_LAYER_PRE_V1`
- 要求：画出并写清——
  1. **数据流**：对话段 →（哪段代码）→ episode → consolidate → candidate →（哪段代码）→ fact / procedure
  2. **存储结构**：三层各存什么字段、有无持久化（落到哪个文件/目录）、是否仅内存
  3. **调用点**：`index.js` 中三层 store 的实例化位置、消费位置、以及 Python sidecar 与 JS 侧的分工边界
  4. **证据系统**：`evidenceFor` 六类计数由谁写入（grep 写入点）

**任务 3 · 替代长期记忆架构方案对比与选型**
- 至少三套候选，每套写：核心数据结构、冲突处理、巩固机制、对现有代码的改动量、风险
- 候选建议（可增补）：
  - A. **保留三层，补强语义**（沿用 fact/episodic/procedure，补时间三价 + 巩固规则 + 趋势分类）
  - B. **改为认识论分层**（借鉴 Hindsight：事实证据 / 推断观察 / 行为指令，按可推导性与可变性划分）
  - C. **双层 + 投影**（原始事件流 append-only + 由事件重算的投影视图，投影可丢弃重建）
- 选型理由必须基于**任务 2 的真实代码**，不得泛泛而谈

### 交付物（报告格式）

```
# M8 调研报告
## 1. 原始结论回溯（含文件:行号引用）
## 2. 现有实现数据流 / 存储结构 / 调用点（含文件:行号 + 调用链）
## 3. 问题清单（现有实现的确切缺陷，每条附代码证据）
## 4. 候选架构对比（表格）
## 5. 选型建议与理由（含改动量估算、风险）
## 6. 待你确认的开放问题
```

### 改动边界

- ❌ **本段禁止修改任何文件**。`git status` 必须保持投喂前状态。
- ✅ 允许只读搜索与阅读。

### 停止条件

若任务 1 的"参考 Hermes""架构极不成熟"在 `docs/` 中**检索不到明确出处**，立即停止并回报：

```
停止原因：未能定位「参考 Hermes / 架构极不成熟」的文档出处
已尝试：<关键词列表>、<检索路径>
需要：请确认该结论的原始来源（哪个文档/哪次对话），或允许以代码现状为准重新评估
```

**禁止猜测、禁止把"我推测这里不成熟"当证据。**

### 自检清单（本段）

```bash
git status --short        # 必须与投喂前一致（无任何改动）
# 报告中每一条结论都必须能给出 文件:行号
```

---
