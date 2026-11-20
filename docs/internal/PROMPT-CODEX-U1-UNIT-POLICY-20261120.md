# Codex 任务书 · 批次3 P3-A2 · U1：unit-policy 纯选择器 + F3 收紧校验

## 0. 角色与边界

你是 dsh-auto-memory 仓库的施工者。只按本任务书施工；任何「顺手优化」「顺手重构」都不做。
仓库根：`D:\dsh-auto-memory`（Windows，Node 24，无 lint 强制）。当前 HEAD `23646c04`。

## 1. 这一步在做什么（先读这段，别跳过）

批次3 的投递策略分四层：选择 / 表示 / 运输 / 预算。前三层里只有「运输+预算」的整帧部分接了生产。
现在要补第一、二层：先把**纯函数选择器**做出来（U1）。**本步不接生产**——它只被测试 import。

权威契约（唯一判据来源，必须逐条读）：
`docs/internal/REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md`

规划依据（读一遍，理解现有 schema 就够）：
- `lib/injection/policy-v2.js` —— 现有 policy v2：MODULE_REGISTRY / PRESETS / validatePolicy / resolvePolicy / DeliveryPolicyError
- `lib/injection/preview.js` —— 现有「预览」如何消费 policy（**参考它的度量方式，不要照抄它的结构**）
- `tests/smoke/smoke-test-batch3-cadence-projection.mjs` —— 测试风格样板（ok/pass/fail 计数，PASS/FAIL 行）

## 2. 硬禁令（违反任一条即返工）

1. **不得改** `lib/index.js`、`lib/client.js`、`skins/**`、`tools/build-iter5-skin.mjs`、`tools/run-smoke.mjs`。
2. **不得接线到真实注入**：`unit-policy.js` 在本步只能被 smoke 测试 import。
3. **不得新增持久化字段**；不得改 `PRESETS` / `DEFAULT_POLICY` 的既有取值。
4. **不得为通过测试放宽判据**；不得用「源码含某字符串」冒充功能验收（静态断言只能当守卫，必须另有真调用断言）。
5. 不提交、不推送、不跑 `tools/release.mjs`、不改版本号。
6. 不改 `.frozen` / 生成区；跑生成器只用 `--check --strict`（只读）。

允许的改动**只有三处**：
- 新增 `lib/injection/unit-policy.js`（**LF** 行尾）
- 修改 `lib/injection/policy-v2.js` 的 `quotas()`（**LF**，只加 F3 校验，见 §4）
- 新增 `tests/smoke/smoke-test-batch3-unit-policy.mjs`（**LF**）

## 3. 契约摘要（细节以 U0 文档为准）

### 3.1 三元组（用户已裁定 R1）

```
PolicyKey = <moduleId> : <view> : <quotaKey>
  quotaKey = '<unit>/<scope>'  |  '@unbounded'
```
- `moduleId` 取自 `PRODUCER_IDS ∪ LOCKED_MODULES ∪ {'diagnostics'}`；**不要自己再造枚举**，直接 import。
- `view` 必须 ∈ `MODULE_REGISTRY[moduleId].views`。
- `unitKind` ∈ `MODULE_REGISTRY[moduleId].units`，**不属键**：它是配额条目自带属性，同一配额下多个 unitKind 共享额度。

### 3.2 `Unit` 形状（运行时，不落盘）

```js
Unit = {
  id: string,          // <moduleId>:<unitKind>:<sourceRef>，本次请求内唯一
  moduleId, unitKind, view,
  policyKey: string,   // 见 3.1
  priority: number,    // 取自 policy.modules[moduleId].priority
  cost: { jsChars: number, utf8Bytes: number },  // 由调用方给，选择器不重新测量
  text: string|null,   // view='pointer' 时可为 null
  pointer: string|null,
  sourceRef: string,
}
```

### 3.3 `selectUnits(input) -> output`（签名冻结）

```js
input  = { policy, units, budget: { jsChars?, utf8Bytes? }, phase }
output = { selected: Unit[], rejected: [{ id, moduleId, view, reason }], cost: { jsChars, utf8Bytes }, deferred: Unit[], truncatedBy: 'quota'|'budget'|null }
```
- `policy` 必须是**已通过 `validatePolicy` 的对象**（本函数不重复校验 policy，但会在入口断言它是 object）。
- `phase` ∈ `human_full|human_slim|run_full|run_slim|post_compact|handoff_carry|hang_compensate|legacy`；未知即抛错。
- `rejected[].reason` 只能取这六个：`module-disabled` / `quota-exhausted` / `budget` / `view-not-allowed` / `no-pointer` / `duplicate-id`。

### 3.4 十条硬判据（每条都要有对应用例）

| 编号 | 判据 |
|---|---|
| S1 | 同输入两次调用，输出 `JSON.stringify` 逐字相同 |
| S2 | 调用前后 `JSON.stringify(input)` 不变（不 mutate） |
| S3 | 零 `fs` / `path` / `process` / `Date` / `Math.random` 引用（静态守卫 + 变异验证） |
| S4 | `selected` 按 `(priority desc, moduleId asc, id asc)` 排序，与输入顺序无关 |
| S5 | 同一 policyKey 的 selected 计数：hard 时 ≤ max；soft 时 ≤ max+overflowAllowance |
| S6 | 永不切半条：整条进 selected 或进 rejected/deferred |
| S7 | 模块 `enabled=false` ⇒ 该模块全部 rejected（`module-disabled`），不消耗配额 |
| S8 | locked 模块（user-memory / project-notes）恒 full 直通、不占配额，但 cost 计入 `output.cost` |
| S9 | 每条 rejected 必须带非空 reason（六枚举之一） |
| S10 | budget 不足时移入 `deferred` 而非丢弃；`truncatedBy='budget'` 时 selected 成本必须 ≤ budget |

### 3.5 失败模式（显式失败，禁止静默降级）

| # | 条件 | 行为 |
|---|---|---|
| F2 | `view` 不在模块 views 内 | 抛 `UnitPolicyError('view-not-allowed')` |
| F5 | `view='pointer'` 但 `pointer` 为空 | 抛 `no-pointer`（**不得回落成空串**） |
| F6 | 两个 unit `id` 相同 | 抛 `duplicate-id` |
| F8 | `cost` 非安全整数或负数 | 抛 `invalid-cost` |
| F9 | soft 配额超 allowance | 不抛：`truncatedBy='quota'`，逐步 reject |
| — | `phase` 非法 | 抛 `invalid-phase` |
| — | `policy` 不是 object | 抛 `invalid-policy` |

`UnitPolicyError` 请**在新模块里定义并导出**（不要复用 `DeliveryPolicyError`——后者是 policy 校验错、`statusCode=400`；选择器运行期错误语义不同）：

```js
export class UnitPolicyError extends Error {
  constructor(code, message, detail) {
    super(message); this.name = 'UnitPolicyError'; this.code = code; this.detail = detail || null
  }
}
```

## 4. F3：`duplicate-quota-scope`（用户已裁 A：直接判非法）

在 `lib/injection/policy-v2.js` 的 `quotas()`（当前约 176 行）里，**map 之后、return 之前**加一遍重复检测：
- 同一模块内，若两条配额条目的 `(unit, scope)` 完全相同 ⇒ `bad(at, 'duplicate-quota-scope')`，其中 `at` 是**后出现那条**的路径 `p + '[' + i + ']'`。
- 错误消息字符串必须精确包含 `duplicate-quota-scope`；路径沿用现有风格。
- **只加这一条**：不改其他校验、不改返回形状、不改 `interfaces`/`exports`。
- 负路径必须有用例：构造 `quotas: [{unit:'event',scope:'event',max:1,strength:'hard'},{unit:'event',scope:'event',max:2,strength:'hard'}]` ⇒ `validatePolicy` 抛 `DeliveryPolicyError`，`message` 含 `duplicate-quota-scope`。

## 5. `unit-policy.js` 实现要求

```js
export const UNIT_POLICY_VERSION = '1'
export class UnitPolicyError extends Error { ... }
export function validateUnit(unit)      // 测试与 adapter 契约用；非法形状抛 UnitPolicyError('invalid-unit')
export function selectUnits(input)       // 核心，纯函数
export function unitPolicyKey(unit)      // 由 moduleId/view/quotaKey 计算 policyKey（导出便于测试与审计）
```

- 从 `policy-v2.js` import `MODULE_REGISTRY` / `PRODUCER_IDS` / `LOCKED_MODULES`，**不要复制枚举**。
- 纯函数：不 `require`/`import` 任何 node 内建；不读环境变量；不写 console。
- 输入深拷贝一份内部工作副本（或只用不可变操作），确保 S2。
- 输出可 `Object.freeze`（推荐，但不强制）。
- 代码风格与 `policy-v2.js` 一致（2 空格缩进、无分号、单引号、`const`/`function`）。

## 6. 测试要求（`smoke-test-batch3-unit-policy.mjs`）

### 6.1 P 组（18 条，编号与判据照 U0 §7.1）
P-01 同输入两次调用输出逐字相同；P-02 调用前后 input 不变；P-03 静态扫描本模块零 IO 关键字；P-04 打乱输入顺序 selected 不变；P-05 hard max=3 给 5 条 ⇒ selected=3/rejected=2(quota-exhausted)；P-06 soft max=3+allowance=2 给 6 条 ⇒ selected=5；P-07 enabled=false 模块 0 条且不消耗配额；P-08 locked 模块恒 full 且不占配额、cost 计入；P-09 pointer 空 ⇒ 抛 no-pointer；P-10 重复 id ⇒ 抛 duplicate-id；P-11 负 cost ⇒ 抛 invalid-cost；P-12 budget 只够一半 ⇒ 一半 deferred、truncatedBy='budget'、selected 成本 ≤ budget；P-13 每条 rejected 有 reason；P-14 同 module 不同 view/quota 额度互不影响；P-15 同配额下多 unitKind 共享额度；P-16 某模块 disabled 不影响其他模块；P-17 零 units ⇒ 空集无异常；P-18 1,000 units 线性耗时（< 50ms）且顺序稳定。

### 6.2 F3 组（2 条）
- F3-01 重复 `(unit,scope)` ⇒ `validatePolicy` 抛错且 message 含 `duplicate-quota-scope`。
- F3-02 合规配置（每 scope 一条）仍通过；`PRESETS` 四个预设全部 `validatePolicy` 通过。

### 6.3 变异（8 条，必须逐条 CAUGHT → 还原复绿）
| 编号 | 变异 | 必须变红的用例 |
|---|---|---|
| M-01 | 删掉 `enabled === false` 短路 | P-07 |
| M-02 | 配额比较 `<` 改 `<=` | P-05 |
| M-03 | 去掉排序键中的 priority/moduleId | P-04 |
| M-04 | 让 selector 读 `Date.now()` | P-03 |
| M-05 | `pointer` 为空时回落空串 | P-09 |
| M-06 | 让 locked 模块进配额竞争 | P-08 |
| M-07 | （在测试夹具里）adapter 侧自行截断超长文本 | 对应 S6 用例 |
| M-08 | F3 检测去掉 | F3-01 |

变异必须：①在**副本**上改（复制到 `artifacts/_u1-mutations/mNN/`），不改共享文件；②断言具体用例名变红；③还原后重跑复绿；④把每次的 red/green 输出摘要写进回执。

## 7. 验收出口（自己先跑一遍，全部贴进回执）

1. `node --check lib/injection/unit-policy.js` 与 `node --check lib/injection/policy-v2.js` = 0。
2. `node tests/smoke/smoke-test-batch3-unit-policy.mjs` ⇒ `PASS 28 / FAIL 0`（18+2+8 计口径自定，但 FAIL 必须 0）。
3. 变异 8/8 CAUGHT、0 MISSED，还原后复绿。
4. `git status --porcelain` 只出现三处（2 新增 + `M lib/injection/policy-v2.js`）；**`lib/index.js` 与 `lib/client.js` 的 sha256 与开工前逐字节相同**（开工前先记一次）。
5. `node tools/build-iter5-skin.mjs --check --strict` ⇒ `SYNC-OK`。
6. `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` ⇒ FAIL 0。
7. 记录 `lib/injection/unit-policy.js` 的行数/字节/sha16。

## 8. 交付

1. 三个文件（见 §2）。
2. 回执 `docs/internal/RECEIPT-BATCH3-U1-UNIT-POLICY-20261120.md`，必须含：
   - 文件物理量（行数 / 字节 / sha16）
   - P/F3/M 逐条结果（哪条绿、哪条红）
   - 变异证据（改了什么 → 哪条用例红 → 还原后复绿）
   - `lib/index.js`、`lib/client.js` 开工前/后的 sha256 对比（证明未碰）
   - **未做/未验证项单列**（不得用「全绿」掩盖）
3. 不要提交、不要 push。

## 9. 常见错误（会直接返工）

- ❌ 把 `selectUnits` 接进 `lib/index.js`「顺手试一下」——禁止。
- ❌ 复制一份 MODULE_REGISTRY 到新模块（必须 import，否则枚举会漂）。
- ❌ 用 `assert(源码.includes('no-pointer'))` 当 F5 的验收（必须真调用抛错）。
- ❌ 变异只在源码上改一处然后「看起来会红」——必须实跑并粘贴红/绿输出。
- ❌ 在 CRLF 文件里写 LF 行（`policy-v2.js` 是 LF，三个文件都保持 LF）。
- ❌ 为了让 P-18 通过而把 1,000 条改成 100 条。
