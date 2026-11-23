# 能力全集 vs 用户 6 点清单 · 完整查漏表（v2 覆盖版）

> 2026-11-08 · Lead 亲自枚举（非估算）· 只读产出 · v2 覆盖 v1
> 起因：用户原话「你这要不就是没列全，要不就是只列了第一层。你需要仔细看到底有没有列全这个工具，
> 还有工具内部的小分类都需要调查明白，我的功能不可能有这么少」

## 0. 结论：为什么「感觉功能很多」却只数出 21 个工具

**两者都对，而且是同一件事。**

本插件的设计是**元操作（meta-operation）**：工具数量少，但每个工具的参数空间极大。
典型：`memory_event` 一个工具 = **27 个参数 + 5 个 action + 18 个枚举值**，
其中 `checkpoint` 一个参数内部还有 **15 个字段**。它一个就顶别人十几个工具。

所以正确的功能计量不是「几个工具」，而是分层：

| 层 | 内容 | 实测数量 |
|---|---|---|
| L1 | 工具 | **21** |
| L2 | 工具级子命令（action / kind / scope / op 等枚举值） | **73** |
| L3 | 工具参数总数 | **106** |
| L4 | 复合参数内部字段（checkpoint / sections / 四类感知 / panels） | **29** |
| L5 | 模块级枚举常量（lib/ 下 Object.freeze 数组） | **100 个常量 / 610 个值** |

## 1. L1：21 个工具（逐一列出，含行号）

全部注册在 `lib/index.js`，无一在别的文件。复算口径：正则 `defineTool\(\s*'([a-zA-Z0-9_]+)'`
命中 21 处（另有 1 处函数定义、1 处注释、2 处 `tools.push(defineTool(...))` 属这 21 个之内）。

| # | 工具 | 行号 | L2 子命令数 | 参数数 |
|---|---|---|---|---|
| 1 | memory_log | 24364 | 4 | 5 |
| 2 | memory_note | 24627 | 5 | 17 |
| 3 | memory_user | 24904 | 2 | 2 |
| 4 | memory_read | 24933 | 7 | 3 |
| 5 | memory_recall | 24998 | 7 | 5 |
| 6 | memory_maintain | 25006 | 0 | 1 |
| 7 | memory_upgrade | 25022 | 3 | 1 |
| 8 | memory_status | 25059 | 1 | 1 |
| 9 | memory_reflect | 25119 | 0 | 2 |
| 10 | memory_external | 25124 | 4 | 3 |
| 11 | calendar_add | 25145 | 4 | 7 |
| 12 | calendar_list | 25155 | 0 | 1 |
| 13 | calendar_done | 25169 | 0 | 4 |
| 14 | calendar_remove | 25176 | 0 | 4 |
| 15 | memory_rules | 25183 | 4 | 5 |
| 16 | memory_event | 25232 | 18 | 27 |
| 17 | memory_consolidate | 25409 | 0 | 1 |
| 18 | memory_procedure | 25429 | 6 | 9 |
| 19 | memory_procedure_list | 25734 | 8 | 5 |
| 20 | memory_expand | 25846 | 0 | 2 |
| 21 | memory_trace | 25850 | 0 | 1 |

## 2. L2：73 个子命令（这才是「工具内部的小分类」）

| 工具 | 枚举字段 | 全部取值 |
|---|---|---|
| memory_event | action | create / set / append / close / rename |
| memory_event | kind | ledger / planSnapshot / sessionTranscript / project / mechanical / unknown |
| memory_event | confidence | high / medium / low / unknown |
| memory_event | status | active / paused / closed |
| memory_note | kind | note / handoff / plan |
| memory_note | action | append / replace |
| memory_log | kind | rule / preference / fact / todo |
| memory_user | action | append / replace |
| memory_read | kind | log / reflection / user / notes / calendar / plan / archive |
| memory_recall | scope | all / handoff / sessions / archive / events |
| memory_recall | format | l0 / full |
| memory_rules | op | list / add / update / remove |
| memory_status | op | upgrade-plan |
| memory_upgrade | action | start / status / ack |
| memory_external | action | list / import |
| memory_external | target | project / user |
| memory_procedure | action | write / activate / update |
| memory_procedure | riskLevel | low / medium / high |
| memory_procedure_list | scope | all / workspace / global |
| memory_procedure_list | stage | all / observed / validated / active / deprecated |
| calendar_add | quadrant | 重要紧急 / 重要不紧急 / 紧急不重要 / 不重要不紧急 |

## 3. L4：复合参数内部字段（29 个，全部是「小分类」）

### 3a `memory_event.checkpoint` 内部 —— 15 个字段

`at` / `kind` / `text` / `sourceRef` / `panels` / `goal` / `state` / `dead` / `next` /
`idemKey` / `quoteRef` / `quoteLine` / `rel` / `bytes` / `sha256`

其中 `panels[].kind` 有 6 种（见 `lib/event-store.js:38` `PANEL_KINDS`）：
state / log / deadend / next / userPercept / commitment

### 3b `memory_event.sections` 内部 —— 4 段

`goal` / `state` / `dead` / `next`（`lib/event-store.js:35` `CHECKPOINT_QUAD_FIELDS`）

### 3c 四类感知（memory_event / memory_note 各一套）—— 4 组

`userPercept` / `agentTrace` / `sharedGround` / `commitments`（`lib/event-store.js:79` `PERCEPT_KEYS_PRE_V1`）

其中 `userPercept.stage` 有 5 种（`lib/event-store.js:40` `PERCEPT_STAGES`）：
retrieved / delivered / used / mentioned / accepted

### 3d 事件本体 26 个顶层字段（`lib/event-store.js:43` `EVENT_TOP_FIELDS`）

id / name / summary / outcome / skillRef / status / pausedReason / sections / checkpoints /
userPercept / agentTrace / sharedGround / commitments / constraints / createdAt / updatedAt /
startMs / endMs / members / rationale / kind / confidence / outcomes / ordinal / skills / idemTag

## 4. L5：模块级枚举常量 —— 100 个常量 / 610 个值

这是「功能密度」的真正所在。与记忆语义直接相关的 30 个（节选，附 file:line）：

| 常量 | 位置 | 值数 |
|---|---|---|
| EVENT_TOP_FIELDS | event-store.js:43 | 26 |
| PROCEDURE_PROTECTED_FIELDS_PRE_V1 | procedure-store.js:775 | 20 |
| PROCEDURE_UPDATABLE_FIELDS_PRE_V1 | procedure-store.js:773 | 7 |
| PROCEDURE_LEVELS_PRE_V1 | procedure-store.js:83 | 6 |
| PROCEDURE_STAGES_PRE_V1 | procedure-store.js:71 | 4 |
| PROCEDURE_LINE_FIELDS_PRE_V1 | procedure-store.js:776 | 5 |
| LAYOUT_BLOCK_KINDS | layout-config.js:29 | 10 |
| ACCESS_KINDS_PRE_V1 | context-bridge.js:45 | 6 |
| ENGINE_IDENTITY_FIELDS | engine-identity.js:34 | 9 |
| EVENT_BOUNDARY_RULES | event-regroup-scan.js:148 | **7** |
| LEGACY_UPGRADE_FIELDS_PRE | event-store.js:294 | 10 |
| DRAFT_EVENT_FIELDS | upgrade-apply.js:59 | 23 |
| EVENT_KEYS | upgrade-draft.js:108 | 12 |
| PROMPT_SECTION_KEYS_PRE_V1 | index.js:1600 | 13 |
| RULE_CONSTRAINT_WORDS_PRE_V1 | rules-layer.js:64 | 10 |
| RULE_MARKERS_PRE_V1 | rules-layer.js:59 | 6 |
| TIER_LAYER_ORDER_PRE_V1 | tier-layer-inject.js:69 | 5 |

完整 100 个常量清单见第 7 节复算命令。

## 5. 头号发现：整条「事件归组」功能线没接线

这是本次调查最重要的发现，也是「有功能但没在用」的最强例证。

### 5a 事实

lib/ 下有 **4 个完整的归组模块**，共 42,839 B：

| 模块 | 字节 | 导出符号 | 生产引用 |
|---|---|---|---|
| event-regroup.js | 11,486 | 7 个 | 被 propose / scan 引用 |
| event-regroup-scan.js | 11,745 | 8 个（含 7 条边界判据） | **仅测试** |
| event-regroup-propose.js | 9,274 | 8 个 | **仅测试** |
| event-regroup-apply.js | 10,334 | 7 个（含快照/回滚） | 仅被 upgrade-apply 借快照 |

**关键**：`lib/index.js`（主引擎）对这四个模块的引用数 = **0**。
`index.js` 中 `applyRegroupPre` / `previewApplyPre` / `buildProposalPre` / `suggestGroupsPre` 出现次数均为 **0**。

配套的 4 个 smoke 套件全部存在并通过：
smoke-test-v5-p6-event-regroup / -r2-regroup-scan / -r3-regroup-propose / -r6-regroup-apply

⇒ **能力建好了、测试写好了、测过了，但日常运行时从不调用。**

### 5b 这正好解释了事件碎片化

`lib/event-regroup-scan.js:148` 里已经写好了 7 条「一件事」判据，含用户 2026-10-26 的明确裁定：

1. 一件事 = 一个连贯的目标从提出到达成/放弃的完整过程
2. 目标相同或演进关系 ⇒ 同一件事
3. 时间连续且中间无其他目标插入 ⇒ 同一件事
4. 同一目标中断多日后被重新拾起 ⇒ 仍算同一件事（用户裁定）
5. 产物归属相同（同一 commit / PR / tag）⇒ 同一件事
6. 目标不同（哪怕同一天）⇒ 两个事件
7. 反例：同会话同天但目标不同 ⇒ 两个事件

**这些判据存在、但没有任何生产代码调用它们。**

所以：没有归组 → 每轮新建一条 → kind 走默认 unknown → sections 无人填 → 四段全空。
这与实测完全吻合（25 个 unknown 事件中 22 个四段全空，占 88%）。

### 5c 这与任务 A 的关系

任务 A 的 Q4 在重新推导「合并判据」，但判据其实**已经存在**。
真正要解的不是「判据是什么」，而是「**为什么它没被调用**」。
这会把 A 的结论从「设计新判据」修正为「接线 + 补触发条件」。

## 6. 完整孤儿功能清单（有代码、没接线）

| 类别 | 数量 | 证据 |
|---|---|---|
| 归组模块零生产入口 | 4 模块 / 42,839 B | index.js 引用数 0 |
| 前端有控件、后端零读取 | 9 个配置键 | 见 DEADKEY-AUDIT 报告 |
| 仅测试断言的死键 | 7 个 | 同上 |
| 有意保留的废弃键 | 2 个 | index.js:982-989 写明理由 |

**归组模块是其中最严重的**：死键只是「开关拨不动」，归组是「整条功能线没通电」。

## 7. 复算命令

（1）工具数：正则 `defineTool\(\s*'([a-zA-Z0-9_]+)'` 对 `lib/index.js` 全文匹配，去重计数 = 21

（2）子命令数：对每个工具的定义块内匹配 `enum:\s*\[`，提取字面量值，合计 = 73

（3）模块级枚举常量：扫 `lib/**/*.js`，正则 `const ([A-Z][A-Z0-9_]+)\s*=\s*Object\.freeze\(\s*\[`，
    过滤值数 ≤60 的，得 100 个常量 / 610 个值

（4）归组模块零接线：`lib/index.js` 中 `event-regroup` 字面出现 = 0；
    `applyRegroupPre` / `previewApplyPre` / `buildProposalPre` / `suggestGroupsPre` 均为 0

（5）归组判据存在：`lib/event-regroup-scan.js:148` `EVENT_BOUNDARY_RULES`，7 条

## 8. 对「清单化」的直接影响

用户直觉「我的功能不可能有这么少」成立。但清单化的正解**不是把 610 个值都写进铭文**——那会让铭文爆炸。

正解是三层处理：

**① 进清单的**：只有「需要模型每轮判断」的动作（约 10-12 条，见 v1 的 L0-L4 结构）。
**② 进工具描述（不进铭文）的**：L2 子命令与 L4 复合字段 —— 模型调用时自然读到。
**③ 不进提示词、应进「接线」的**：L5 里的孤儿功能（归组 4 模块、9 个死控件）。
    这些东西写进清单毫无意义 —— 模型让它们动，它们也不会动。**先把线接上。**

## 9. 未验证 / 边界

- L5 的 100 个常量中，是否每个都「被消费」未逐一验证。按任务 A 的方法（判读取点）需另跑一轮。
- HTTP 路由面（API 前缀 `/api/dsh-auto-memory`）未计入本表 —— 那是用户/前端可操作面，不是模型可调用面。
- `memory_fit_*` 4 个工具不在本仓，本表按非本插件能力处理。
- 工具调用频率未统计（若某工具长期零调用，权重应下调）。