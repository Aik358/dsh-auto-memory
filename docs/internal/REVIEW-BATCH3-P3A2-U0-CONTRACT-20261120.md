# P3-A2 · U0 契约评审 + U1 用例清单 · 2026-11-20

性质：**只读设计交付**。本文不含生产代码改动，供用户裁定后再派工。

## 0. 用户裁定（本轮拍板，作为后续一切的权威）

| # | 裁定 | 影响 |
|---|---|---|
| R1 | **unit = 「模块 × 表示 × 配额」三元组** | 选择器的分组/竞争单位就是这三元；不是「模块」单键 |
| R2 | 选择器为**纯函数**（不读盘、不读时间、不生成文本，IO 归调用方） | 可离线跑、可复算、可变异 |
| R3 | 边界：**最终预算仍归 FM**；**EV closed 事件不进模块配额竞争** | 防第二套裁量 |

## 1. 结论摘要

**U0 不需要改持久化 schema。** 现有 `DeliveryPolicy` v2 已经具备三元组的全部三个维度，只是没人消费：

| 三元组维度 | 现有落点 | 现状 |
|---|---|---|
| 模块 | `policy.modules.<id>`（11 个 producer + 2 locked + diagnostics） | 只有 `diagnostics` 被真实注入读取 |
| 表示 | `policy.modules.<id>.view`（枚举来自 `MODULE_REGISTRY[id].views`） | 零读取 |
| 配额 | `policy.modules.<id>.quotas[] = {unit, scope, max, strength, overflowAllowance?}` | 零读取 |

因此 **U0 的产出是「运行时契约」**：定义 adapter 产出的 `Unit` 形状、selector 的输入输出、以及失败模式；持久化层只补一条**跨字段一致性校验**（见 F3）。这把 U3 的风险压到「接线」一件事，而不是「换数据模型」。

## 2. 三元组的精确落点（消除歧义）

用户说的「配额」在现有 schema 里是**一个条目**（`quotas[]` 的元素），它自带 `unit`（单位种类）与 `scope`。据此定义：

```
策略键 PolicyKey = <moduleId> : <view> : <quotaKey>
  quotaKey = '<unit>/<scope>'        例：'event/event'、'checkpoint/event'、'rule/delivery'
           | '@unbounded'            该模块无对应配额条目时（仅当 enabled 且未配配额）
```

- `moduleId` ∈ `PRODUCER_IDS` ∪ `LOCKED_MODULES` ∪ `{diagnostics}`
- `view` ∈ `MODULE_REGISTRY[moduleId].views`
- `unitKind` ∈ `MODULE_REGISTRY[moduleId].units`，**不是键的一部分**：它是配额条目自带的属性，同一条配额下的多个 unitKind 共享额度（这正是现有 `quotas[].unit` 的语义）

⇒ 所以「模块 × 表示 × 配额」= 「哪个模块的、用什么表示、吃哪一档配额」，与现有 schema 一一对应。**唯一新增约束**：同一模块内 `(unit, scope)` 必须唯一，否则同一档配额有两个上限、额度归属不确定（见 F3）。

## 3. 运行时 `Unit` 形状（内部契约，不落盘）

```js
Unit = {
  id: string,            // 稳定标识：<moduleId>:<unitKind>:<sourceRef>；同一次请求内唯一、可复现
  moduleId: ModuleId,
  unitKind: UnitKind,
  view: View,            // 'full' | 'summary' | 'preview' | 'pointer'（各模块视图名以其 views 为准）
  policyKey: string,     // 见 §2，selector 用它做配额记账
  priority: number,      // 取自 policy.modules[moduleId].priority
  cost: { jsChars: number, utf8Bytes: number },  // adapter 预算，selector 不重新测量
  text: string | null,   // 已渲染的该单位文本；view='pointer' 时可为 null
  pointer: string | null,// view='pointer' 时必须非空（否则 F6 显式失败）
  sourceRef: string,     // 溯源：事件 id / 段号 / 文件相对路径，用于 reasons 与审计
}
```

**谁产生**：U2 的六个 adapter（EV/RP/BD/portrait/calendar/rules），只做「原生结构 → Unit」，**不裁剪、不排序、不读 policy**。
**谁消费**：U1 selector；U3 的接线只把 `selected` 拼进帧。
**禁止**：adapter 返回字符串让调用方猜结构；selector 内重新测量字符数（成本必须来自 adapter，否则同一单元两处测量会漂）。

## 4. 选择器契约（U1 的实现判据）

```js
select(input) -> output
input = {
  policy,                       // validatePolicy 过后的对象，只读
  units: Unit[],                // adapter 产出，顺序任意
  budget: { jsChars?: number, utf8Bytes?: number },   // 本轮可用的**提示值**，不是终裁
  phase: 'human_full'|'human_slim'|'run_full'|'run_slim'|'post_compact'|'handoff_carry'|'hang_compensate',
}
output = {
  selected: Unit[],                       // 顺序稳定，见下
  rejected: Array<{ id, moduleId, view, reason }>,
  cost: { jsChars, utf8Bytes },
  deferred: Unit[],                       // 留给 FM 决定要不要的（预算挤压时）
  truncatedBy: 'quota' | 'budget' | null,
}
```

**硬性判据**（每条都要有对应用例）：

| 编号 | 判据 |
|---|---|
| S1 | **纯**：同一 `input`（深拷贝）调用两次，`JSON.stringify(output)` 逐字相同 |
| S2 | **不 mutate**：调用前后 `JSON.stringify(input)` 不变 |
| S3 | **无 IO**：源码中零 `fs`/`Date`/`Math.random`/`process` 引用（静态守卫 + 变异） |
| S4 | **顺序确定**：`selected` 按 `(priority desc, moduleId asc, id asc)` 排序，不依赖输入顺序 |
| S5 | **配额记账按 policyKey**：同一 policyKey 的 `selected` 计数 ≤ `quota.max`（hard 时严格）；soft 时 ≤ max+overflowAllowance |
| S6 | **整单元取舍**：永不切半条——要么整条进 selected，要么进 rejected/deferred |
| S7 | **`enabled=false` 一票否决**：该模块全部 unit 进 rejected（reason `module-disabled`），不消耗配额 |
| S8 | **locked 模块直通**：`user-memory` / `project-notes` 恒为 full、不经配额竞争，但 `cost` 仍计入 `output.cost`（FM 看得到） |
| S9 | **reason 可解释**：每条 rejected 必须带 `module-disabled` / `quota-exhausted` / `budget` / `view-not-allowed` / `no-pointer` / `duplicate-id` 之一，禁止空 reason |
| S10 | **预算只做提示**：`budget` 不足时把候选移入 `deferred` 而不是直接丢弃；`truncatedBy='budget'` 时 `selected` 成本必须 ≤ budget |

## 5. 失败模式矩阵（显式失败，禁止静默降级）

| # | 触发 | 行为 |
|---|---|---|
| F1 | `policy.modules` 出现未知 moduleId | **校验期失败**（现有 `keys()` 已挡，需用例钉住） |
| F2 | `view` 不在该模块 views 内 | **校验期失败**（现有 `enumOf` 已挡） |
| F3 | 同一模块内两条配额 `(unit, scope)` 相同 | **新增校验期失败** `duplicate-quota-scope`；否则额度归属不确定 |
| F4 | `quota.unit` 不在模块 units 内 | 校验期失败（现有已挡） |
| F5 | `view='pointer'` 但 `pointer` 为空 | **运行期失败** `no-pointer`（不可回落成空串） |
| F6 | 两个 unit 的 `id` 相同 | **运行期失败** `duplicate-id`（adapter 契约违背） |
| F7 | adapter 抛错 / 来源不可读 | 该来源**整体**降级为显式 `unreadable` 段（沿用现有「不可读显式降级」判据），不静默缺段 |
| F8 | `cost` 为负或非安全整数 | **运行期失败** `invalid-cost` |
| F9 | 软配额超 `overflowAllowance` | `truncatedBy='quota'` + 逐步 reject（reason `quota-exhausted`），不抛 |
| F10 | legacy 键与 policy 同时有值 | policy 胜，legacy 仅作 `compatibility.legacyKeys` 记录；**不回写**（保留回滚通道） |
| F11 | `human_full` 档出现非 full 表示 | 校验期失败（现有 `checkRepresentation` 已挡，需用例钉住） |
| F12 | `diagnostics` 模块 | **行为保持不变**：U3 只把「是否注入」并入统一判定，不得改 `windowHours`/`maxLines` 语义 |

## 6. 边界（R3 的落地口径）

1. **FM 终裁**：selector 只产出 `selected/deferred/cost`，**不做最终帧裁剪**；FM 仍按整帧硬顶/软预算做最后一刀。selector 的 `budget` 是提示，不是授权。
2. **EV closed 不进配额**：`closed` 事件的目录条目走现有 catalog 路径，不参与 `events` 模块的 `event/event` 配额竞争（沿用 BD 审查结论）。U2 的 EV adapter 必须显式标注 `unitKind='catalogEntry'` 且不进 event scope 配额。
3. **locked 模块**：`user-memory` / `project-notes` 不允许被 `enabled=false` 或改 view（现有 `locked:true` 无校验，U0 加一条：出现即失败）。
4. **maintenance 子开关**：`modules.rules.maintenance === false` ⇒ rules 的 maintenance 子段不产生 unit；rules 主段照常（现有语义保持）。
5. **13 段开关（C9）不在 U0 范围**：`SECTION_KEYS` 的优先级与模块的关系属 U3，本文只登记「不越界」。

## 7. U1 用例清单（可直接派工）

### 7.1 selector 纯逻辑（P 组，约 18 条）

| 编号 | 用例 | 判据 |
|---|---|---|
| P-01 | 同输入两次调用 | 输出逐字相同（S1） |
| P-02 | 调用前后 input 序列化 | 不变（S2） |
| P-03 | 静态扫描 lib/injection/unit-policy.js | 零 `fs`/`Date`/`random`/`process`（S3） |
| P-04 | 打乱 units 输入顺序 | selected 顺序不变（S4） |
| P-05 | hard 配额 max=3，给 5 条 | selected=3，rejected=2 且 reason=`quota-exhausted`（S5） |
| P-06 | soft 配额 max=3 + allowance=2，给 6 条 | selected=5，rejected=1（S5） |
| P-07 | 模块 enabled=false | 该模块 0 条进 selected，不消耗配额（S7） |
| P-08 | locked 模块 | 恒 full 进 selected，不占配额，cost 计入 output.cost（S8） |
| P-09 | pointer 视图无 pointer | 抛 `no-pointer`（F5） |
| P-10 | 重复 id | 抛 `duplicate-id`（F6） |
| P-11 | 负 cost | 抛 `invalid-cost`（F8） |
| P-12 | budget 只够一半 | 一半进 selected、其余进 deferred，`truncatedBy='budget'`，selected 成本 ≤ budget（S10） |
| P-13 | 每条 rejected 都有 reason | 无空 reason（S9） |
| P-14 | 三元组记账隔离 | 同 module 不同 view/quota 的额度互不影响（R1 直接验收） |
| P-15 | 同配额下多 unitKind 共享额度 | event + checkpoint 共吃 `event/event` 的 max |
| P-16 | 模块 disabled 但其余模块正常 | 其余模块 selected 不受影响 |
| P-17 | 零 units | 输出空集、无异常、truncatedBy=null |
| P-18 | 大输入（1,000 units） | 线性耗时上限（例如 < 50ms），且顺序稳定 |

### 7.2 六处 adapter（AD 组，每处 4 条 = 24 条）

统一模板（每个 adapter 都要四条）：
- `AD-x1` 正常结构 → Unit 形状合法（id/cost/sourceRef 齐、view 在枚举内）
- `AD-x2` 空来源 → 返回空数组（不是 null、不是占位段）
- `AD-x3` 不可读 / 损坏 → 抛可识别错误，由接线层转「显式降级段」（F7）
- `AD-x4` 超长单条 → cost 如实反映长度，**adapter 不自行截断**（截断属 selector/FM 职责）

| adapter | 来源 | 需额外钉的负路径 |
|---|---|---|
| AD-EV | `event-view.js` 事件/检查点 | closed 事件必须标 `catalogEntry` 且不进 event 配额（R3-2） |
| AD-RP | `read-rules.js` 规则五类 | 五类齐全/缺类；maintenance=false 时子段不产生 unit |
| AD-BD | 白板 planSpec / 账本四段 | 四段全空时不得伪造段落（沿用既有判据） |
| AD-PT | 画像段落 | 无画像时返回空，不得生成占位 |
| AD-CA | 日历条目 | `current` 视图只给近期条目；跨工作区条目不得串入 |
| AD-RS | rules 段 + children | 与 AD-RP 的职责边界：规则内容 vs 规则段呈现，用例要各钉一条防重叠 |

### 7.3 变异（M 组，每处至少 1 条，必红→还原复绿）

| 编号 | 变异 | 必须变红 |
|---|---|---|
| M-01 | 删掉 `enabled === false` 的短路 | P-07 红 |
| M-02 | 配额比较 `<` 改 `<=` | P-05 红 |
| M-03 | 打乱排序键（去掉 moduleId/priority） | P-04 红 |
| M-04 | 让 selector 读 `Date.now()` | P-03 红 |
| M-05 | 把 `pointer` 为空回落成空串 | P-09 红 |
| M-06 | 让 locked 模块进配额竞争 | P-08 红 |
| M-07 | adapter 自行截断超长文本 | AD-x4 红 |
| M-08 | EV adapter 把 closed 标成 `event` | AD-EV 的 R3-2 用例红 |

## 8. U0/U1 明确不做

- 不改 `lib/index.js`、不改真实组帧、不改前端、不跑生成器；
- 不新增持久化字段（除非 F3 校验需要，且只加校验不加字段）；
- 不动 `SECTION_KEYS` 13 段的优先级；
- 不实现 U3 的任何接线；
- 不碰 `user-memory` / `project-notes` 的既有行为。

## 9. 验收出口（U0/U1 完成判据）

1. `unit-policy.js` 真实 import → 真构造 → 真调用，P 组 18 条全绿（禁止纯静态断言充当功能验收）；
2. M 组 8 条变异全部 CAUGHT，还原后复绿；
3. AD 组 24 条全绿（此时 adapter 仍未接线，只证明形状正确）；
4. `lib/index.js` 零改动、`client.js` 零改动、生成器 `--check --strict` 仍 SYNC-OK、全量回归不新增红；
5. 交付物：本契约 + `lib/injection/unit-policy.js` + `tests/smoke/smoke-test-batch3-unit-policy.mjs` + 回执。

## 10. 待用户确认的 1 个点（不阻塞开工）

F3 要把「同模块内 `(unit, scope)` 唯一」变成**校验期失败**。这是对现有 schema 的**收紧**：合规的老配置不受影响（现状页面每种 scope 基本只存一条），但如果有用户手改过 JSON 造出重复条目，升级后该配置会被判非法。

两个选项：**A** 直接判非法（我推荐，语义干净）；**B** 容忍并在 `compatibility.migrationCodes` 记一条降级。

---

## 修订 v1.1（2026-11-20 · U1 交付复核后，Lead 裁定）

U1 实施者提出两处契约冲突、Lead 复核另发现一处可绕过配额的口径缺口，在此一并裁定。**本节优先于前文冲突处。**

### A1. `diagnostics` 不进入 Unit 模型（确认实施者的处理正确）

- `diagnostics` **不是** producer：它没有 views/units/priority，只以 `{enabled, windowHours, maxLines}` 的独立开关形式存在于 `policy.modules.diagnostics`。
- ⇒ 收窄 §2 的 moduleId 集合为 **`PRODUCER_IDS ∪ LOCKED_MODULES`**；`diagnostics` 不属该集合，selector 对它抛 `invalid-unit` 是**正确行为**。
- U3 接线的纪律不变（F12）：diagnostics 只把「是否注入」并入统一判定，不改 `windowHours`/`maxLines` 语义，也不为它发明 view/unitKind。

### A2. S8 与 S10 冲突的裁定：**budget 是总额，S8 优先**

冲突原文：S8 要求 locked 单元恒直通并计入 cost；S10 要求 `truncatedBy='budget'` 时 selected 总成本 ≤ budget。若 locked 自身已超 budget，两条不可能同时成立。

裁定：
1. **`budget` 语义 = 本帧总预算（含 locked）**。原因：FM 最终按整帧裁剪，若 selector 把 budget 当「普通单元剩余额度」，locked 会额外挤出预算，FM 那一步仍会砍。
2. **S8 优先**：locked 永远不被预算或配额裁剪。
3. **S10 修正**为：「`selected` 中**非 locked 部分**的成本 ≤ `budget − lockedCost`；`truncatedBy='budget'` 恒表示「有普通单元因预算进 deferred」。」
4. **新增输出字段** `budgetOvercommit: boolean`：当 `lockedCost` 单独已超 budget 时为 `true`，此时普通单元**全部**进 `deferred`，`truncatedBy='budget'`。

⇒ 输出形状变为：
```js
output = { selected, rejected, cost, deferred, truncatedBy, budgetOvercommit }
```

### A3. 新增 F13：禁止用 `@unbounded` 绕过已配置的配额（口径缺口，必须堵）

现状：unit 的 `policyKey` 若以 `@unbounded` 结尾，selector 直接跳过配额记账。⇒ adapter 只要把本该受配额的 unit 标成 `@unbounded`，就能无声绕过上限；而 adapter 属 U2 代码，不能假定它永不犯错（更不该由它决定「是否受配额约束」）。

裁定（新增失败模式 F13）：
- 若 `modulePolicy.quotas` 中**存在** `quota.unit === unit.unitKind` 的条目 ⇒ 该 unit **不得**用 `@unbounded`；其 `policyKey` 必须匹配其中某一条 `(unit, scope)`，否则抛 `UnitPolicyError('quota-bypass')`。
- 若该模块**没有**任何 `quota.unit === unit.unitKind` 的条目 ⇒ `@unbounded` 合法（该 unitKind 不参与配额）。
- 判定只用 `unitKind`，**不给 `Unit` 加 `scope` 字段**（保持 §3 形状不变）；当同一 unitKind 存在多条不同 scope 的配额时，视为**该 unitKind 受配额约束**，仍须匹配其中之一。

### A4. 新增用例（U1.1 追加，编号续接）

| 编号 | 用例 | 判据 |
|---|---|---|
| P-19 | locked 成本 100、budget 50、另给 1 个普通 unit | locked 进 selected；普通进 deferred；`truncatedBy='budget'`；`budgetOvercommit=true` |
| P-20 | locked 成本 30、budget 50、普通 unit 成本 10 | 全进 selected；`budgetOvercommit=false`；非 locked 部分 10 ≤ 50−30 |
| P-21 | 模块配了 `{unit:'event',scope:'event'}`，unit 自称 `@unbounded` | 抛 `quota-bypass` |
| P-22 | 模块未配任何 `event` 配额，unit 用 `@unbounded` | 正常通过（不误伤） |
| P-23 | 模块配了 `{unit:'event',scope:'event'}` 与 `{unit:'event',scope:'delivery'}`，unit 用 `event/delivery` | 正常通过（多 scope 允许） |
| M-09 | 删掉 F13 检测 | P-21 必红 |
| M-10 | 把 locked 成本从 total 里剔除以「满足」S10 | P-19 必红 |

验收出口相应变为：套件 **28 PASS / 0 FAIL**（原 22 + 6 新增），变异 **10/10 CAUGHT**。

### A5. `budgetOvercommit` 分支必须先判 `enabled`（U1.1 复核发现的缺陷）

U1.1 在 `budgetOvercommit=true` 时把所有普通单元直接推入 `deferred`，跳过了 `module-disabled` 判定 ⇒ **禁用模块的单元会出现在 `deferred`**，而 `deferred` 的语义是「预算放宽后可再考虑」，U3 若在后续帧消费 `deferred` 就会把禁用模块注入回来。

裁定：`budgetOvercommit=true` 时，ordinary 先按 `enabled` 分流——禁用 ⇒ `rejected(module-disabled)`；启用 ⇒ `deferred`。

验收：P-25（禁用 + overcommit ⇒ rejected/无 deferred）、P-26（禁用进 rejected、启用进 deferred）、M-11（删判断 ⇒ 两用例必红）；套件 **30/0**、变异 **11/11**。

### A6. 配额匹配必须按「scope 家族」而非 `unitKind` 精确相等（U2 复核发现的缺陷 D2）

`policy-v2` 的配额校验已有家族语义：`scope === 'event'` 的条目，其 `unit` 只允许是 `event|checkpoint|catalogEntry`（`lib/injection/policy-v2.js:183`）；U0 §3.1 也写明「同一配额下多个 unitKind 共享额度」。

U2 的 `bindUnits` 按 `quota.unit === unitKind` 精确匹配 ⇒ `checkpoint` / `catalogEntry` 在只配了 `{unit:'event',scope:'event'}` 时匹配不到任何条目，被判成 `@unbounded` ⇒ **绕过事件配额**（实测：`checkpoint` 得到 `events:cards+catalog:@unbounded`）。这正是 F13 要堵的洞，只是发生在 F13 看不到的层。

裁定（唯一匹配函数，两处共用）：

```js
const EVENT_FAMILY = ['event', 'checkpoint', 'catalogEntry']
export function quotaMatchesForUnitKind(quotas, unitKind) {
  return quotas.filter(q => q.unit === unitKind
    || (q.scope === 'event' && EVENT_FAMILY.includes(unitKind)))
}
```

- `selectUnits` 的 F13 判定改用该函数（否则 checkpoint 仍可 `@unbounded` 绕过）。
- `bindUnits` 改用该函数：命中集合取 `(unit + '/' + scope)` 去重——恰好 1 个 ⇒ 用它；多个不同 ⇒ `ambiguous-quota-scope`；0 个 ⇒ `@unbounded`。

⇒ 三条硬判据：①`{unit:'event',scope:'event'}` 下 `event`/`checkpoint`/`catalogEntry` **必须**同得 `event/event`；②同一模块同时配 `event/event` 与 `checkpoint/delivery` ⇒ 对 checkpoint 是 `ambiguous-quota-scope`（不猜）；③无任何匹配 ⇒ `@unbounded` 合法。

### A7. `ruleModule`（maintenance 子段）与 `deliveryModule` 的归属

- **`ruleModule`**：`MODULE_REGISTRY.rules.units` 含它、`children: ['maintenance']`。裁定：`adaptRules(input)` 接受**可选** `input.maintenance = { key?: string, text: string }`；有且 `text` 非空 ⇒ 产 1 个 `ruleUnit`（sourceRef `rules:maintenance:<key||'default'>`）；无 ⇒ 不产（不造占位）。与 U0「maintenance=false 时可不产 Unit」一致。
- **`deliveryModule`**：`events`/`rules`/`handoff` 三模块的 units 都含它，它是**模块指针单位**，由 U3 的帧装配层产生，**U2 六个 adapter 一律不产**。
