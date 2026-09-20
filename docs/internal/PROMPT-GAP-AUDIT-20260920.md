# PROMPT-GAP-AUDIT — 代码能力 vs 模型 prompt 全量对账

> 生成：2026-09-20 · 触发：用户「有什么是我代码应该让模型知道的内容，模型现在还不知道，就是注入里面还没讲」
> 方法：全量扫描 `lib/*.js` 的 `export const` 枚举/契约常量 + 17 个 `defineTool` 的 description + `renderMemoryStatic` / `renderDynamic` 注入文本，逐条比对"代码有语义域 / prompt 有解释"。
> 铁律：本表**只做对账，不判断该不该补**——补哪条由用户拍板。

## 0. 一句话结论

**共 17 条缺口，分四类。** 其中 6 条是**模型根本判断不了**（零入口），11 条是**有入口但语义域没讲全**。

---

## A 类 · 模型零入口（判断不了，必须补代码才能补 prompt）

| # | 能力 | 代码位置 | 现状 | 影响 |
|---|---|---|---|---|
| **A1** | **`retracted`（撤回）写入** | `note-status-pre.js:52` 支持三态 / `:69` 可渲染 retracted · `index.js:5866` 仅映射 `superseded` | **无通道**：`memory_note_pre` 只有 `supersedes` 参数，硬编码映射到 `superseded` | 用户 2026-09-18 裁定「retracted 不是垃圾，是教训」——**教训通路不可写** |
| **A2** | **fact 过期机制** | `fact-store-pre.js:159 isExpired` · `:326 resolveConflict` · `:283 revokeBySource` · `:263 supersede` | 9 个能力齐全，**零 `defineTool`**（实测 `memory_fact*` = 0） | 用户问的「记忆是否过期」——模型既读不到也写不了 |
| **A3** | **episodic（情节）写入** | `episodic-store-pre.js` · `EPISODE_OUTCOMES_PRE_V1 = ['unknown','success','failure','partial']` | 仅宿主自动（`index.js:7411` `hub.stores.episodic.append`） | 模型无法标记"这次是失败/部分成功" |
| **A4** | **fact 语义域（5 个枚举）** | 见 §C-1 | 全部无 prompt | 模型不知道 fact 还有 epistemic_status / scope / trend 这些维度 |
| **A5** | **看板 tag 命名约定** | `wb-sidecar-pre.js:594-597` `matchTags: ['type:goal' / 'type:state' / 'type:dead-end' / 'type:progress']` | prompt 未提任何 tag 名 | 模型写白板时**不知道要打 tag 才能进看板泳道**——只能靠 `matchTitle` 正则兜 |
| **A6** | **看板泳道 = 5 条非 4 条** | `WB_KANBAN_LANES_PRE_V1`（`:593`）：goal / state / deadend / progress / **archive** | 注入里只说"四段式" | 用户说"看板方向 4 个"——实测**第 5 条「版本归档」靠 `matchKinds:['archive']`**，模型无从知晓 |

---

## B 类 · 有入口但 prompt 没讲清

| # | 缺什么 | 代码位置 | 现状 |
|---|---|---|---|
| **B1** | **白板/账本两套四段措辞不一致** | `index.js:5726`（催办块）用「当前目标/已完成/进行中/下一步第一步」· `:570`/`:3658` 用「任务状态/目标/已试方案与失败原因/进度与下一步」 | 同名四段、两套词，模型可能当同一件事 |
| **B2** | **`boardMode=graph` 前提** | `index.js:10198` 条件注册 `memory_expand_pre` / `memory_trace_pre` | legacy 模式下工具**不存在**，prompt 无任何解释 |
| **B3** | **procedure 晋升门限** | T4：`successCriteria` 缺失 ⇒ 结构上永不晋升 | 工具描述只提了 "high 需人工批准"，未说这条硬事实 |
| **B4** | **R1 四条可读性判据** | `R1-READABILITY-FORENSICS-20260919.md`（开头空行=0 / 空行占比<15% / 同日重复 `## `=0 / 缺主语<5%） | 仅在文档，**未进任何 prompt** |
| **B5** | **`memory_log_pre` 的 `date` 参数** | `index.js:9857` | 描述未说"可补写过去日期" |
| **B6** | **`memory_note_pre` 的容量与整理行为** | `:9880` 提到 24000，但未说整理触发条件与归档位置 | 模型不知道写满后会发生什么 |
| **B7** | **`memory_recall_pre` 的 `expand`/`format` 组合** | `:9976-9982` | 参数各自有描述，但**组合语义**（expand 时忽略 query）只在参数描述里夹带 |
| **B8** | **`memory_maintain_pre` 的 days 语义** | `:10007` | 未说"阈值天数"与日志可见性关系 |
| **B9** | **`memory_status_pre` / `memory_reflect_pre` 的适用时机** | `:10011` / `:10023` | 只写了功能，没写"什么时候该用" |
| **B10** | **`memory_external_pre` 的 import 链接模式** | `:10028` | 未说"只记路径指针、不写内容"的防脏纪律 |
| **B11** | **`memory_consolidate_pre` 与自动沉淀的关系** | `:10085` | prompt 里"自动沉淀"与"手动 consolidate"边界模糊 |

---

## C 类 · 枚举值模型看不到（内部语义域）

### C-1 fact 域（5 个）

```
FACT_EPISTEMIC_STATUSES_PRE_V1 = ['fact', 'observation', 'directive']
FACT_SCOPES_PRE_V1             = ['User', 'Workspace']
FACT_SOURCE_KINDS_PRE_V1       = ['explicit', 'inference']
FACT_SOURCE_CLASSES_PRE_V1     = ['user-memory','workspace-notes','workspace-log','semantic-candidate','profile-candidate']
FACT_TRENDS_PRE_V1             = ['new', 'strengthening', 'stable', 'weakening', 'stale']
FACT_TTL_DEFAULT_PRE_V1        = 0   // 0 = 永不过期
```

### C-2 证据域（2 个）

```
ACCESS_KINDS_PRE_V1 = ['seen', 'read', 'cite', 'reuse', 'success', 'correction']
ACK_REASONS_PRE_V1  = ['ok', 'disabled', 'busy', 'unsupported', 'oversize', 'stale']
```

### C-3 投递/激活域（2 个）

```
ACTIVATION_LEVELS_PRE_V1 = ['index', 'hint', 'excerpt', 'checklist', 'resource', 'full']
DELIVERY_STATES_PRE_V1   = ['pending', 'claimed', 'delivered', 'expired', 'dropped']
```

### C-4 L0 层域（1 个）

```
L0_LAYERS = ['user', 'project', 'log', 'reflection', 'whiteboard']
L0_LAYER_LABELS_PRE_V1 = { project:'结论层·项目笔记', user:'结论层·用户级记忆', whiteboard:'结论层·白板/账本', … }
L0_RETRACTED_MARK_PRE_V1 = '⚠已撤回'
```

### C-5 降级域（1 个）

```
DEGRADE_KINDS_PRE_V1 = ['semantic-arm', 'evidence-arm', 'l0-sync']
```

### C-6 白板状态（1 个）

```
WB_STATUSES_PRE_V1 = ['current', 'superseded', 'retracted']   // 与笔记三态同名同值，但作用于白板条目
```

---

## D 类 · 三态/四段的家族对照（澄清用，非缺口）

| 族 | 常量 | 取值 | 作用于 |
|---|---|---|---|
| 笔记条目生命周期 | `NOTE_STATUSES_PRE_V1` | current/superseded/retracted | `MEMORY.md` |
| 白板条目生命周期 | `WB_STATUSES_PRE_V1` | current/superseded/retracted | 白板/账本条目 |
| L0 检索标记 | `L0_STATUSES` | current/superseded/retracted | 检索输出标记 |
| **账本四段**（截断权重） | `HANDOFF_LEDGER_SECTION_WEIGHTS_PRE_V1` | 任务状态.15 / 目标.20 / 已试方案与失败原因.35 / 进度与下一步.30 | 账本内部**截断排序** |
| **看板五泳道**（渲染分组） | `WB_KANBAN_LANES_PRE_V1` | 目标 / 进行中 / 失败与弯路 / 进度与下一步 / **版本归档** | 面板**看板分列** |

> **关键澄清（用户已指出）**：账本四段 ≠ 看板泳道 ≠ 记忆三态，**三者互不相交**。
> 账本四段管"截断时先丢谁"；看板泳道管"面板上分几列"；三态管"条目是否作废"。

---

## E 类 · 判定为「不需要进 prompt」

| 项 | 理由 |
|---|---|
| `EPISODE_RETENTION_PRE_V1 / SEGMENT_CAP / MIN_SEGMENTS` | 宿主容量参数，模型无需知道 |
| `UPSERT_OUTCOMES_PRE_V1` | fact store 内部返回值 |
| `DEGRADE_CAP / QUOTA_THRESHOLDS / ARM_STATES` | 宿主降级配额 |
| `EVIDENCE_PREFIX / OBSERVATION_PREFIX / ACTIVATION_ID_PREFIX` | id 前缀，内部格式 |
| `BOARD_MODES_PRE_V1 = ['legacy','graph']` | 已由 B2 覆盖（说明"图模式才有那两个工具"即可） |
| `INDEX_SYNC_PAGE_BUDGET` / `CONTEXT_BRIDGE_BUDGET` | 内部预算 |
| 46 条路由 / `DEFAULT_CONFIG` 97 键 | 用户面配置，非模型面 |

---

## F. 拍板建议（三条最小改动，已在前轮提出）

1. **A1**：`memory_note_pre` 增 `retract: string[]`，与 `supersedes` 对称走 `applyNoteStatusPre`
2. **B1**：统一白板/账本四段措辞，或在 prompt 显式声明二者区别
3. **B2**：铭文补 boardMode 说明

**若扩大范围**，A5（tag 命名约定）与 A6（第 5 条泳道）应一并补——否则模型写的白板**永远进不了看板的 tag 匹配**，只能靠 `matchTitle` 正则兜底。
