# 模块化 Prompt 集（严谨集成版）

> 写于 2026-09-09，基于 v2.2.6 实测代码。
> **本文件替代** `PROMPT-PACK-LAYERED-RECALL.md` 的 prompt 正文部分；该文 §0 的 OpenViking 联网核实结论仍然有效，本文直接引用不再重复。
> 全局背景见 [INTEGRATION-ANALYSIS.md](INTEGRATION-ANALYSIS.md)（本地架构解读 + 四仓库评估）。
> **已完成**：T1（`lib/l0-extract-pre.js`）、G1/G3（接续指令文案）。

---

## 通用前置约束（每一段 prompt 都必须遵守，投喂时一并附上）

### 1. 搜索优先原则（违反即打回）

1. **动手前必须先搜索定位**。禁止凭 prompt 描述臆造文件路径、函数名、字段名。
2. 必用手段：`Grep`（正则）、`Glob`、`Read`。每个要改动的符号都要**实际 grep 到并记下真实行号**。
3. prompt 中给出的行号是**上一次观测值，可能已漂移**，必须先重新定位再动手；若行号对不上，以实际搜索结果为准并在回报中说明。
4. **引用规范**：回报中每一处改动必须写成 `文件路径:行号 — 原内容 → 新内容`。

### 2. 禁止事项

- **不得臆造 API**：任何调用的函数、字段、配置项，必须先在仓库中 grep 到定义处。搜不到就**停下回报**。
- **不得整文件重写**：一律最小 diff。禁止"顺手重构""统一风格""优化命名"。
- **不得引入新依赖**：项目 `dependencies` 为空（零运行时依赖承诺）。
- **不得改 API 签名**：既有导出函数的参数列表不得变更（可用可选参数扩展）。
- **不得删除既有测试断言**。
- 涉及 OpenViking（AGPLv3）：**不得复制、翻译、逐行改写其源码**，只可参考公开文档算法思路。

### 3. 集成位置正确性论证（回报必写）

每处改动必须说明：
- **为什么选这个位置**（上游数据来源、下游消费者分别是谁，用 grep 到的调用链证明）
- **上下游影响**（哪些函数/模块会受影响，列出调用点行号）
- **回滚方式**（精确到命令或操作）

### 4. 无法定位时

**立即停止并回报**，格式：
```
停止原因：未能定位 <符号/文件>
已尝试：<搜索词 1>、<搜索词 2>、<路径>
需要：<澄清问题>
```
**禁止猜测、禁止"应该是"**。

### 5. 自检清单模板（每段完成后逐项执行并贴结果）

```bash
cd D:\dsh-auto-memory

# ① 编译
node --check <改动涉及的每个 lib/*.js>

# ② 测试（必跑，数字不得下降）
node tests/smoke/smoke-test-l0-extract-pre.mjs       # 基线 18
node tests/smoke/smoke-test-handoff-pre.mjs          # 基线 51
node tests/smoke/smoke-test-continue-chain-pre.mjs   # 基线 58
node tests/smoke/smoke-test-water-step-pre.mjs       # 基线 12
node tests/smoke/smoke-test-autocont-host-pre.mjs    # 基线 29

# ③ 接口一致性（grep 校验，不得出现孤儿调用/断链）
grep -rn "<新增/改动的符号>" lib/ | head -20

# ④ 改动范围
git status --short
git diff --stat
```

### 6. 项目事实速查（已核实，可直接引用）

| 项 | 值 |
|---|---|
| 根 | `D:\dsh-auto-memory`（pre 线） |
| 版本 / 协议 | 2.2.6 / BSD-3-Clause |
| 依赖 | peer `@deepseek-ai/cordis ^4.0.1`；optional `@huggingface/transformers ^3.7.6`；**dependencies 为空** |
| 约定 | 新增模块一律 `lib/xxx-pre.js`（纯函数、零 IO、IO 注入） |
| 编码 | UTF-8 无 BOM；仓库 CRLF；`*-pre.js` 与 `*.js` 成对存在 |
| 五条不变量 | I1 前缀缓存字节稳定 / I2 不替 host 决定压缩 / I3 凭证永不进提示词 / I4 绝不阻塞接续 / I5 水位测量在 pre-step |

---

# A 篇 · 常规改造（按依赖顺序，彼此独立可单独投喂）

依赖关系：**P1 → P2 → P3 → P4**（主链串行）；**P5 → P6**（接续链，可与主链并行）；**P7** 无依赖随时可做。

---

## 【P1】L0 向量索引与增量更新

**目标**：为 T1 产出的 L0 建立向量索引，供语义检索使用。参照 OpenViking「Vector Index 只存 URI+向量+元数据，不含文件内容」（来源见 PROMPT-PACK §0.5）。

**涉及功能模块**：新增 `lib/l0-index-pre.js`；消费 `lib/l0-extract-pre.js`；参考 `lib/memory-index-pre.js`（既有索引范式）。

**验收标准**：
1. 177 条真实记忆全量建索引，每条 `{id, vector, l0, source, l0Hash, updatedAt}`，**零丢失**
2. 增量：改一条 → 仅重算该条（可断言"重算条数"）
3. 失效条目可移除
4. 索引缺失/非法 → fail-soft 回退，**不阻塞任何调用方**
5. 新增 smoke 全绿；既有五套基线不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/l0-extract-pre.js`、`lib/memory-index-pre.js`、`lib/semantic-js-pre.js`、`lib/m4-corpus-pre.js`
- 关键词：`buildL0IndexPre`、`extractL0Pre`、`MemoryFileIndex`、`createJsSemanticEnginePre`、`JS_SEMANTIC_ENGINE_VERSION`、`memoryIndexVersion`、`sourceVersion`、`recordDigest`
- 必须先确认：① `buildL0IndexPre` 的返回字段 ② C2 引擎的创建函数名与 embedding 调用方式（含 `query:`/`passage:` 前缀如何传）③ 既有索引落在哪个目录

**改动边界**：
- ✅ 允许新增：`lib/l0-index-pre.js`、`tests/smoke/smoke-test-l0-index-pre.mjs`
- ❌ 禁止修改：`lib/l0-extract-pre.js`（T1 已锁定）、`lib/index.js`、`lib/semantic-js-pre.js`、任何既有 `.js`
- ❌ 禁止：引入依赖、在索引中存原文

**完成自检**：按 §5 模板（本段 `node --check lib/l0-index-pre.js`）。

**回滚**：删除新增两个文件即可（本段不接线，零残留）。

---

## 【P2】语义臂接入 recall

**目标**：`memory_recall` 当前为纯词法（工具描述自述"关键词匹配"）。接入语义臂，**输入用 L0 而非全文**（全文会超 e5 512 token 上限被截断）。

**涉及功能模块**：`lib/index.js` 的 `recall()` 实现与 `memory_recall_pre` 工具定义；`lib/semantic-js-pre.js`（C2）；`lib/shadow-retrieval-pre.js`（词法臂）。

**验收标准**：
1. 主题性查询（"发布踩坑"）能召回词法不重合但语义相关的记忆
2. **词法臂必须保留并继续打全文**（错误码/变量名/路径在 L0 里没有）
3. 语义引擎不可用 → fail-soft 退回纯词法，**不报错、不阻塞**
4. `recall(query, limit, agent, scope)` **签名不变**
5. 五套基线不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/context-host-pre.js`
- 关键词：`async recall(`、`defineTool('memory_recall_pre'`、`engine.recall(`、`lexicalSearch`、`buildQueryPlan`、`D6_FUSION_WEIGHTS_PRE_V1`、`fuseD6Pre`、`SHADOW_GATE_POLICY_PRE_V1`
- 必须先确认：① `recall()` 真实行号与完整函数体 ② 当前召回走的是 `lexicalSearch` 还是别的函数 ③ C2 引擎实例在 `index.js` 中如何持有（字段名）④ 是否已有 `scope='sessions'` 走 host 的分支

**改动边界**：
- ✅ 允许修改：`lib/index.js` 中 `recall()` 函数体内部（最小 diff）
- ❌ 禁止修改：`recall()` 签名、`defineTool` 的参数 schema 既有字段（只能新增可选字段）、`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、激活决策层
- ❌ 禁止：把全文送进 embedding

**集成位置正确性**：必须说明为何改在 `recall()` 内部而非工具定义处；列出 `recall()` 的所有调用点行号。

**回滚**：`git checkout lib/index.js`（本段改动仅限该文件）。

---

## 【P3】融合层改造（rank-space + 绝对分数决策）

**目标**：修复 `fuseD6Pre` 的 minmax 归一化三宗罪：① 分数随候选集漂移 ② 矮子里拔将军 ③ 候选 ≤1 时退化为常数 0.5（排序失效）。本项目核心是"是否注入"的决策，依赖分数与阈值比较，**相对量会腐蚀决策基础**。

**涉及功能模块**：`lib/semantic-js-pre.js` 的 `fuseD6Pre`。

**验收标准**：
1. 决策用**绝对分数 + 校准阈值**，排序用融合分数——两者解耦
2. 候选 < 3 时不退化（新增断言）
3. 提供 **rank-space** 融合：`score = Σ 1/(k + rank/divisor)`，**k=60**
4. 保留原始分数供审计

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/semantic-js-pre.js`、`lib/shadow-retrieval-pre.js`、`lib/context-bridge-pre.js`
- 关键词：`fuseD6Pre`、`D6_FUSION_WEIGHTS_PRE_V1`、`normArm`、`flat`、`reciprocal_rank_fusion`、`rrf`
- 必须先确认：① `fuseD6Pre` 的所有调用点 ② 现有返回值结构被谁消费（哪些字段不能删）③ 是否已有 RRF 实现

**改动边界**：
- ✅ 允许：在 `lib/semantic-js-pre.js` **新增**融合函数（并存），由配置/参数切换；或新增 `lib/recall-fusion-pre.js`
- ❌ **禁止删除或改写 `fuseD6Pre` 既有行为**（并存优先，避免破坏调用方）
- ❌ **禁止 score-space 加权 RRF**：Hindsight issue #3956 实测——k=60 时动态范围仅 5.9 倍，加权会让排序退化为字典序，recall@20 从 **0.97 崩到 0.40**
- ❌ 禁止照搬 OpenViking 的 `α=0.5` 父分数传播（本地无深目录树；若实现须映射为「工作区/日志文件/主题块」三级父且默认关闭）

**回滚**：新增文件则删除；若改了 `semantic-js-pre.js` 则 `git checkout` 该文件。

---

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

## 【P5】接续锚点表注入

**目标**：`buildContinueCarry()` 当前机械截断（白板 3000 / 账本 8000 / 总 18000）。G1/G3 已改指令为"按需取用"，但**没有锚点表可供下钻**。本段用 T1 的 L0 抽取生成锚点表。

**涉及功能模块**：`lib/index.js` 的 `buildContinueCarry()`。

**验收标准**：
1. 注入含锚点表（每条 ~20–30 token），材料仍可达
2. **字节稳定**：相同输入两次注入内容 hash 一致
3. 锚点生成失败 → fail-soft 回退现有平铺，**绝不阻塞接续**
4. **不引入新的 LLM 轮次**（纯解析），满足 0.75 早于官方 0.80 的时序
5. handoff 51 / continue-chain 58 不下降

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`
- 关键词：`buildContinueCarry`、`carryText`、`slice(0, 3000)`、`slice(0, 8000)`、`slice(0, 18000)`、`truncateHead`、`stripSensitiveSections`、`snapshotPlanTitle`、`snapshotHandoffTitle`
- 必须先确认：① `buildContinueCarry` 的真实行号与返回字段 ② 三处截断的准确位置 ③ `carryText` 被谁消费（下游）

**改动边界**：
- ✅ 允许：`buildContinueCarry()` 内部（最小 diff）
- ❌ 禁止：新增 LLM 调用；让注入内容随查询/任务动态变化；改动静态纪律层
- ❌ 禁止修改：`refreshRitualPrompt()`（那是 P6/P7 范围）

**回滚**：`git checkout lib/index.js`。

---

## 【P6】账本权重化截断

**目标**：`ledger.slice(0, 8000)` 是位置截断。实测账本**段内异质**——「已试方案与失败原因」段里三条全是**成功解法**；「进度与下一步」混了已完成项、真待办、元指令。按位置截可能把高价值段整体截掉。

**涉及功能模块**：`lib/index.js`（解析 + 权重分配），解析部分建议抽成 `lib/handoff-anchor-pre.js` 纯函数。

**验收标准**：
1. 正确解析四段：`## 任务状态` / `## 目标` / `## 已试方案与失败原因` / `## 进度与下一步`
2. 权重：失败原因 .35 ＞ 下一步 .30 ＞ 目标 .20 ＞ 任务状态 .15
3. 预算不足时**从最低权重段开始截**
4. 纯函数 + fixture 锁定解析与排序

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/index.js`、`docs/M-CM7-HANDOFF-LAYERED-RETRIEVAL.md`
- 关键词：`readLatestHandoff`、`## 任务状态`、`## 已试方案与失败原因`、`handoffLedgerChars`、`handoffPlanChars`、`writeHandoffLedger`
- 必须先确认：① 四段标题的**确切字符串**（含空格/全半角）② 是否存在 `handoffLedgerChars` 等配置项（若有则复用，勿硬编码）

**改动边界**：
- ✅ 允许新增：`lib/handoff-anchor-pre.js`、`tests/smoke/smoke-test-handoff-anchor-pre.mjs`
- ✅ 允许：`buildContinueCarry()` 中调用新解析函数替换 `slice(0,8000)`
- ❌ 禁止：删除任何原文（只影响注入，不动文件）；把"成功解法"误标为"失败原因"

**回滚**：`git checkout lib/index.js` + 删除新增文件。

---

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

# B 篇 · M8 记忆系统（单独成篇，调研前置）

> **流程**：先投喂 **M8-R** → 产出调研报告 → **经你确认** → 才生成 M8 改造 prompt。
> 本篇严格遵守搜索—转写—精准集成约束。

---

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

## 【M8-1 …】M8 改造 prompt

**状态：待 M8-R 报告经你确认后生成。**

届时将按确认的架构方案拆解为独立的 M8-1、M8-2…，每段同样遵守：
- 先搜索定位（路径 + 符号关键词 + 真实行号）
- 最小 diff、禁整文件重写
- 明确允许/禁止修改文件
- 集成位置正确性论证 + 上下游影响 + 回滚方式
- 五套 smoke 基线不下降
- 无法定位即停止回报

---

## 附：执行顺序建议

```
批次 1（并行，互不干扰）
  ├─ P1  L0 索引          （新增文件，不接线）
  ├─ P5  接续锚点表        （改 index.js 单一函数）
  ├─ P7  写入侧修复        （改 index.js 写入函数）
  └─ M8-R 调研            （只读，产出报告待确认）

批次 2（依赖 P1）
  └─ P2 语义臂接入 recall

批次 3（依赖 P2）
  └─ P3 融合层改造

批次 4（依赖 P3）
  └─ P4 返回 L0 + 展开

批次 5（依赖 P5）
  └─ P6 账本权重截断

批次 6（依赖 M8-R 确认）
  └─ M8-1 … 按确认方案展开
```

**冲突提示**：P2/P3/P4 与 P5/P6 都会改 `lib/index.js`。若同一批次并行执行，必须**串行投喂并逐段 `git diff` 确认**，避免同文件改动互相覆盖。
