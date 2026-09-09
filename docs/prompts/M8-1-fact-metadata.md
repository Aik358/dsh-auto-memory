> **投喂方式**：本段须与 `_COMMON.md` 一并投喂。
> 前置：已执行 `M8-R-REPORT.md` 调研，选型 = **A+（保留三层，叠加认识论状态字段，补时间三价）**。
> 依赖：无。可与 P1 / P5 / P7 并行。

## 【M8-1】Fact 层元数据补强（时间三价 + 认识论状态 + 趋势）

**背景（有代码证据）**：
- `lib/fact-store-pre.js` 的 Fact 为四元组 `{scope, subject, predicate, object?}` + provenance + confirmedAt + ttl? + revoked?，持久化落 `facts.json`（`lib/index.js:5591`）。
- 现有**完全没有时间三价语义**：Hindsight 明确区分 `occurred_start/end`（事件发生）、`mentioned_at`（陈述时间=新鲜度）、入库时间三者，并指出"从旧文档提取的事实即使刚处理也保留旧 mentioned_at"。本项目 `confirmedAt` 单一字段无法表达。
- 三层分类（episodic/semantic/procedural）是**描述性分类**，不表达"这条是可重算的推断还是不可推导的证据"。

**目标**：为 Fact 增加三组**向后兼容**的元数据字段，不动既有 upsert / supersede / revoked 语义。

**涉及功能模块**：`lib/fact-store-pre.js`；`lib/index.js`（仅当需透传配置）。

**验收标准**：
1. 新增字段且**旧数据可读**：无新字段的既有 `facts.json` 记录能正常加载（不得因缺字段报错或丢弃）
2. 新增字段：
   - 时间三价：`occurredAt`（事件发生，可空）、`mentionedAt`（陈述时间，可空）、`ingestedAt`（入库时间，必填，默认取现有 `confirmedAt`）
   - 认识论状态：`epistemicStatus`，枚举 `fact`（证据/不可推导）| `observation`（推断/可重算）| `directive`（行为指令）
   - 趋势：`trend`，枚举 `new` | `strengthening` | `stable` | `weakening` | `stale`
3. `validateFactCandidatePre` / `validateFactPre` 须接受新字段（可选），**不得因新字段拒绝旧结构**
4. fact store 既有 **41 断言不下降**，并新增断言覆盖上述三点
5. 五套基线不降：l0-extract 18 / handoff 51 / continue-chain 58 / water-step 12 / autocont-host 29

**需先检索的仓库路径与符号关键词**：
- 路径：`lib/fact-store-pre.js`、`lib/index.js`
- 关键词：`createFactStorePre`、`validateFactCandidatePre`、`validateFactPre`、`isFactConflict`、`FACT_POLICY_VERSION`、`FACT_SCOPES_PRE_V1`、`confirmedAt`、`supersede`、`revoked`、`hubIo`
- **必须先确认**：① `hubIo()` 的定义体与落盘目录（调研未追到，本段必须查明并回报）② Fact 的完整字段列表与校验函数实现 ③ `facts.json` 是否已有真实数据（若有，必须验证向后兼容）

**改动边界**：
- ✅ 允许修改：`lib/fact-store-pre.js`（增量加字段 + 校验放宽）
- ✅ 允许新增：`tests/smoke/` 中断言
- ❌ **禁止修改**：`upsert` / `supersede` / `revoked` 的既有语义与分支
- ❌ 禁止修改：`lib/episodic-store-pre.js`、`lib/procedure-store-pre.js`、`lib/memory-hub-pre.js`、`lib/index.js`（除非确需透传，且须单独论证）
- ❌ 禁止：因新字段改变既有冲突判定结果；删除既有断言；整文件重写

**集成位置正确性（回报必写）**：
- 说明新字段加在 Fact 结构的哪个位置、为何不影响既有 41 断言
- 列出所有读取 Fact 字段的下游位置（grep `FACT_ID_PREFIX`、`snapshot`、`facts.` 等）
- 回滚：`git checkout lib/fact-store-pre.js` + 删除新增断言文件；`facts.json` 若被写入新字段，说明是否需清理

**停止条件**：若 `hubIo()` 定义体无法定位，或 `facts.json` 落盘目录不在 `memoryRoot` 内（违反"可整体删除"约定），**立即停止回报**。

**自检清单**：按 `_COMMON.md` §5 执行（本段重点：`node --check lib/fact-store-pre.js` + fact store 断言 ≥41）。
