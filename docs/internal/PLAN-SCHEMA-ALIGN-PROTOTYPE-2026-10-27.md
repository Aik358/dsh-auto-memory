# 施工纲要 · 事件数据模型对齐 prototype（甲方案 · 全量）

> 版本：v2 · 2026-10-27（压缩后重新测绘，补齐注入层与白板渲染层）
> 目标：让产品的 `event-store` 承载 prototype 的 22 事件字段 + 17 检查点字段，
> 能渲染出与 `artifacts/wb-event-preview` 一致的三栏视图；
> **迁移产出新版本白板**（由事件数据重新组织），而不是把旧白板拆成碎片事件。

---

## 0. 六层测绘结果（全部实测，非推测）

### 层 1 · 数据层 `lib/event-store.js`（501 行）

```
L21  export const EVENT_STORE_SCHEMA = 'v4_event_store_v1'
L24  export const PANEL_KINDS = ['state','log','deadend','next','userPercept','commitment']
L27  export const EVENT_STATUSES = ['active','paused','closed']
L29  export const EVENT_TOP_FIELDS = [16 个]
       id,name,summary,outcome,skillRef,status,pausedReason,sections,
       checkpoints,userPercept,agentTrace,sharedGround,commitments,constraints,createdAt,updatedAt
L79  emptyEventPre(name, opts)
L102 validateEventPre(ev)
L326 projectEventForListPre(e, withPercept)   ← list() 投影，6 处调用点
L352 eventStorePre = { create, append, set, close, ... }
```

**缺 10 个事件字段**：`startMs, endMs, members, rationale, kind, confidence, outcomes, ordinal, sourceCount, skills`

### 层 2 · 工具层 `lib/index.js` L21754 `memory_event`

```js
// create —— 只透传 5 个字段！新字段全被丢弃
eventStorePre.create(storePath, { name, summary, sections, constraints, skillRef })
// append —— 同样只透传 6 个
eventStorePre.append(storePath, id, { checkpoint, constraint, userPercept, agentTrace, sharedGround, commitment })
// set —— 字段白名单 7 个
for (const k of ['name','summary','outcome','skillRef','status','pausedReason','sections'])
```

### 层 3 · 注入展示层 `lib/event-render.js`（476 行）

**★★ 这是压缩前漏测的关键层。实测结论：**

| 渲染函数 | 行 | 读什么 | 缺口 |
|---|---|---|---|
| `renderT0Pre` | L97 | `ev.status`, `ev.name` | 无时间/kind/confidence |
| `renderT1Pre` | L108 | `ev.summary` 首句 | 无时间范围 |
| `buildSectionsBlockPre` | L174 | `ev.sections.{goal,doing,deadend,next}` | ✅ 四段已有（事件级） |
| `buildPerceptBlockPre` | L220 | 四类 percept（逐字段 getter，有修复注释） | ✅ 已正确 |
| `buildCheckpointsBlockPre` | L270 | **只读 `c.kind` + `c.text`** | ❌ **检查点四段完全不读** |
| `renderT2Pre` | L346 | 组装上面四块 | — |
| `renderEventCatalogPre` | L432 | 目录（400 字符上限） | 无 kind 徽章 |

**关键代码（L290-294）**：
```js
const kind = String(c.kind || 'log')
const rawText = String(c.text || '').replace(/\s*\n+\s*/g,' / ').trim()
let body = cutPre(rawText, T2_BUDGET.CHECKPOINT_ITEM)
let line = '  - [' + kind + '] ' + body      // ← 只有 kind + text
```
⇒ 即使补了 `checkpoint.goal/state/dead/next`，**注入面也看不见**，必须同时改这里。

### 层 4 · 白板注入层 `lib/index.js` L10390-10480（`renderMemoryDynamic` 内）

**★★ 这也是压缩前漏测的关键层。实测结论：**

```js
L10385  const _planBudgetBase = ...
L10389  const _planBudget = _legacySlim ? min(base, 2400) : base
L10390  const _planSectionMax = _legacySlim ? min(cfg.handoffPlanSectionMax || 2000, 800) : cfg
L10393  const _planRaw = stripSensitiveSections(sanitizeForInjection(s.planText || ''))
L10409  const _planSections = (_legacySlim ? _LEGACY_CORE : _planSpec.sections) || cfg.handoffPlanSections
L10436  const _truncatePlanBySectionsInline = (text, whitelist, perSectionMax) => {...}  ← 内联（模块级不可见）
L10467  const _planPart = (() => { if (_planSections) { bySec = _truncatePlanBySectionsInline(...) } 
                              return truncatePlanByPriority(_planRaw, _planBudget) || truncateLinesBounded(...) })()
L10477  if (planPart) pushPart('memoryReferences', 'whiteboard-plan', '\n' + L('snapshotPlanTitle') + '\n' + planPart)
```

**关键约束（血泪教训，见 L10415-10426 注释）**：
- `renderMemoryDynamic` 被 **20+ 套件用 `new Function` 抽取执行**
- ⇒ **函数内绝对不能引用模块级 const**（`typeof === 'undefined'` ⇒ 静默死代码）
- ⇒ 新增白板渲染逻辑**必须内联**，或放在 `s`（state）里预计算

**白板注入的三档行为**：
| 档位 | 预算 | 截断方式 |
|---|---|---|
| LEGACY / HUMAN_FULL / HANDOFF_CARRY | `handoffPlanChars`（默认 1200） | `truncatePlanByPriority` |
| 瘦档 F2/F3/F5/F7（`_legacySlim`） | 2400 / 单节 800 | `_truncatePlanBySectionsInline` 三节白名单 |

### 层 5 · 前端 `lib/client.js`

| 项 | 位置 | 状态 |
|---|---|---|
| `EventView` | **L7324** | 手写区（不在 generated 标记内），可改 |
| `EV4_PROTO_RUNTIME` | **L561913 起，62,658 字符 / 1,484 行** | ✅ **完整实现三栏视图，不改** |
| 原型引用的字段 | `startMs endMs members rationale confidence quoteRef sourceCount outcomes skills` 全✅ | 只差喂数据 |
| 原型未用 `ordinal` | ❌ | 可不补 |

### 层 6 · 提示词 `lib/migration-prompt.js`（11,315 字符 / 441 行）

阶段结构：0 同意 / 1 备份 / 2 不递归 / 3 五类分拣 / 4 写回 / 5 自检1-8 / 6 报告 / 7 效率 / 8 白板优先

**阶段 8 现状的问题**：
- 8.3 写「一个 `##` 章节 ≈ 一个事件」⇒ **错**（一节一碎片）
- 要求 `startMs/endMs` ⇒ **产品丢弃**
- 没有 `members` / `rationale` 概念 ⇒ 无法表达「为什么这几篇是一件事」
- **没有「写白板」这一步** ⇒ 白板只被读、从未被写

---

## 1. 改造清单（六层 + 白板新能力）

### B1 · 数据层 `lib/event-store.js`

| # | 改动 | 关键点 |
|---|---|---|
| 1.1 | `EVENT_TOP_FIELDS` +10 字段 | 追加在 `constraints` 之后、`createdAt` 之前（保 key 顺序断言） |
| 1.2 | `emptyEventPre` 补默认值 | `startMs:0,endMs:0,members:[],rationale:'',kind:'ledger',confidence:'unknown',outcomes:[],ordinal:0,skills:{}` |
| 1.3 | `validateEventPre` 加校验 | `startMs<=endMs`（非0时）；members 必须 string[]；kind/confidence 枚举 |
| 1.4 | 新增 `CHECKPOINT_TOP_FIELDS` 常量 | 旧5 + 新11 = 16 |
| 1.5 | `create()` 透传新字段 | 从 `opts` 白名单拷贝 |
| 1.6 | `append()` 透传检查点新字段 | 同上 |
| 1.7 | **`append` 自动更新事件 span** | 若新检查点 `at` 超出 `[startMs,endMs]` ⇒ 扩展（关键：免手工维护） |
| 1.8 | `projectEventForListPre` 可选投影 | **默认关闭**（照 withPercept 模式，6 处调用点） |
| 1.9 | schema 升 v2，读兼容 v1 | `EVENT_STORE_SCHEMA = 'v4_event_store_v2'`；读 v1 时补默认值 |
| 1.10 | 新增 `normalizeEventPre` | 统一做 v1→v2 补字段（读路径唯一入口） |

**验收**：真 import→create/append→读回断言 21 个字段；**负路径**：`members` 非数组 / `startMs>endMs` / `kind` 非法枚举 ⇒ 抛错不静默。

### B2 · 工具层 `lib/index.js`

| # | 行 | 改动 |
|---|---|---|
| 2.1 | L21754 | `create` 透传 10 新字段 |
| 2.2 | L21760 | `append` 透传检查点 11 新字段 |
| 2.3 | L21769 | `set` 白名单 +8（不含 ordinal/sourceCount，派生） |
| 2.4 | 工具 schema | 参数描述加新字段说明（**不加工具、不加路由、配置键 175 不变**） |

**验收**：真调 `memory_event` → 读 store → 断言；负路径同上。

### B3 · 注入展示层 `lib/event-render.js`（★压缩前漏测）

| # | 行 | 改动 | 为什么 |
|---|---|---|---|
| 3.1 | L285-306 `buildCheckpointsBlockPre` | **检查点行改为读四段**：若有 `goal/state/dead/next` 则拼 `goal ‖ state`，无则回落 `text` | 当前只读 text |
| 3.2 | L97 `renderT0Pre` | 名称后加时间标记 `[2026-09-20]`（有 startMs 时） | 时间轴感知 |
| 3.3 | L108 `renderT1Pre` | summary 首句前加 `kind` 标记（仅 ledger/planSnapshot 区分） | 徽章 |
| 3.4 | L432 `renderEventCatalogPre` | 目录行加时间范围 | 同上 |
| 3.5 | **不改 `buildSectionsBlockPre`** | 事件级四段已正确 | — |

**预算约束**：`T2_BUDGET.CHECKPOINT_ITEM` 已有上限，四段拼装后仍受它约束，**不得撑爆**。
**验收**：真构造事件（含四段检查点）→ 真调 `renderT2Pre` → 断言输出含四段摘要且长度 ≤ 预算；**负路径**：无四段时回落 text、不输出空行。

### B4 · 白板注入层 `lib/index.js` L10390-10480（★压缩前漏测）

| # | 改动 | 关键点 |
|---|---|---|
| 4.1 | 白板段**支持新结构化白板** | 新白板由事件渲染，标题结构变（见 §2.3） |
| 4.2 | `_LEGACY_CORE` / `PlanSpec.sections` **白名单要同步** | 否则新白板章节被旧白名单过滤掉 |
| 4.3 | **内联约束** | 新增逻辑必须内联或预计算进 `s`，禁止引用模块级 const |
| 4.4 | 加断言「白板段非空 + 章节数」 | 防再次死代码 |

**验收**：真引擎→`renderMemoryDynamic`→量白板段字节；**负路径**：新白板三节必须都出现（不是被截成 0）。

### B5 · 前端 `lib/client.js`

| # | 改动 | 关键点 |
|---|---|---|
| 5.1 | L7324 `EventView` 字段映射 | `name→title`、`createdAt→date`、`at→ms`、`kind→rel`、`text→q` |
| 5.2 | `EV4_PROTO_RUNTIME` **不改** | 62,658 字符已完整 |
| 5.3 | **禁止**三方合并 / 整块替换 | 用户硬规则 |
| 5.4 | `useMemo` 禁用 | 全仓未定义，用了必崩 |

**验收**：**真执行 factory** 运行时守卫（非静态断言）+ 截图对比 prototype。

### B6 · 提示词 `lib/migration-prompt.js`

| # | 改动 |
|---|---|
| 6.1 | **重写阶段 8** —— 白板从「输入」改成「输出」 |
| 6.2 | 新四段流程：读输入 → **归组事件**（多篇=一事） → 写事件（带 members/rationale/startMs） → **渲染新白板** |
| 6.3 | 归组三判据（目标演进 / 时间连续 / 产出归属） |
| 6.4 | 检查点四段**分别提取**，禁止整段塞 goal |
| 6.5 | `members` 必须是**文件路径数组**，`rationale` 一句话 |
| 6.6 | 删除旧规则「一个 `##` 章节 = 一个事件」 |

**验收**：套件断言新流程存在 + 旧规则已删（负路径）；**变异必红**。

### B7 · 白板渲染新能力（`lib/plan-render.js` 新建）

| # | 新增 | 说明 |
|---|---|---|
| 7.1 | `renderPlanFromEventsPre(events, opts)` | 由事件渲染 PLAN.md |
| 7.2 | `planSectionsFromEventsPre(events)` | 分节：当前状态 / 近期进展 / 关键约束 / 待办 |
| 7.3 | `memory_note(kind='plan')` 支持 `renderFromEvents:true` | opt-in，不破坏手工路径 |
| 7.4 | M1 保护门兼容 | 必须带全部 `<!--memory:mem_*-->` 锚点 |

**验收**：真渲染→真写盘→真读回；M1 门通过；**负路径**：无事件时输出骨架而非崩溃。

### B8 · 实跑验证

9 工作区真跑，对比 §3 指标。

---

## 2. 新流程设计（提示词核心改动）

### 2.1 旧流程（错在哪）

```
读白板 → 一个 ## 章节 = 一个事件 → 完
```
实测后果：14 章节 → 14 碎片事件；64% 只有 1 检查点；平均 members=1.0。

### 2.2 新流程

```
8-A 读输入（各 1 遍）
    读旧白板 PLAN.md · 读日志 YYYY-MM-DD.md · 读已有事件库

8-B ★归组（核心，判据三条全满足才归一事）
    ① 目标相同或演进
    ② 时间连续（无 >30 天真空档）
    ③ 产出归属相同（同一组文件/提交）
    ★ 归组单元 = 「一篇日志」或「一段白板叙述」，**不是白板章节**
    ★ members = 来源文件路径数组
    ★ rationale = 一句话归组理由

8-C 写事件（字段必须全）
    memory_event(create, {
      name, summary, kind, confidence,
      startMs, endMs,        ← 从 members 时间推
      members: [...], rationale: '...',
      sections: {goal, doing, deadend, next}
    })
    memory_event(append, { checkpoint: {
      at,
      goal, state, dead, next,     ← 四段分别提取
      quoteRef, quoteLine,          ← 指回源文件行
      text: '原文'
    }})

8-D ★写白板（新能力 · 此前从未做过）
    memory_note(kind='plan', renderFromEvents=true)
    ⇒ 由刚建的事件渲染出新版 PLAN.md
```

### 2.3 新白板结构

```markdown
# 项目白板 · <workspace>

## 当前状态
> 由 N 个 active 事件渲染 · 最后更新 <date>
| 事件 | 状态 | 最近进展 |

## 近期进展（按时间倒序）
### 2026-10-24 · <事件名>
- 目标 / 做了 / 卡点 / 下一步

## 关键约束（从事件提取）

## 待办（从 sections.next 汇总）
```

---

## 3. 对齐目标（可复算）

| 指标 | prototype | 当前实跑 | 目标 |
|---|---|---|---|
| 平均 members/事件 | 4.54 | 1.0 | **≥3.0** |
| 单检查点事件占比 | 23% | 64% | **≤30%** |
| 有 startMs/endMs | 185/185 | 0/56 | **100%** |
| 检查点有四段 | 100% | 0% | **100%** |
| 注入面能看见四段 | — | 否 | **是** |
| 新白板由事件渲染 | — | 否 | **是** |

---

## 4. 风险清单

| 风险 | 处理 |
|---|---|
| **抽取式执行**（20+ 套件 `new Function`） | 新逻辑禁止引用模块级 const；必须内联或预计算进 `s` |
| **list() 6 处调用点** | 新字段投影**默认关闭** |
| **旧事件无新字段** | 读路径统一走 `normalizeEventPre`，补默认值、不强制迁移 |
| **白板白名单过滤** | `_LEGACY_CORE` / `PlanSpec.sections` 必须同步改，否则新章节被过滤 |
| **前端崩溃** | 禁三方合并、禁 `useMemo`、必须真执行 factory |
| **计数锁** | 不加工具 / 不加路由（21/80）；配置键 175 不变 |
| **M1 保护门** | 白板重写带全部锚点 |
| **旧提示词套件** | B6 会删掉旧规则，需同步翻转断言为负路径 |

---

## 5. 批次顺序与依赖

```
B1 数据层 ──→ B2 工具层 ──→ B3 注入展示 ──┐
                                          ├─→ B6 提示词 ──→ B8 实跑
B1 ──→ B4 白板注入 ───────────────────────┤
B1 ──→ B5 前端 ───────────────────────────┤
B1 ──→ B7 白板渲染 ───────────────────────┘
```

**建议**：B1 → B2（后端线可独立验收）→ B3/B4/B5 并行 → B7 → B6 → B8

---

## 6. 待确认

1. **批次顺序**：按 §5 建议？（B1→B2→B3/B4/B5→B7→B6→B8）
2. **schema 版本**：升 v2、读兼容 v1，可否？
3. **B7 新文件**：`lib/plan-render.js` 新建（职责分离）vs 塞进 `event-render.js`？
4. **注入面是否显示检查点四段**：会占预算（当前 `CHECKPOINTS` 900 字符），四段全上可能撑爆 ⇒ 建议**只显示 goal + state**（dead/next 留给前端详情页），可否？
