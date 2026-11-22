# Codex 任务书 · P3-A2 · U1.2 + U2：D1 修复 + 六处 adapter（不含生产接线）

前置：U1 / U1.1 已交付并经 Lead 复核；U1.1 留下 1 个必修缺陷 D1。本任务把 **D1 修复**与 **U2 六处 adapter** 合并交付。

权威依据：
1. `docs/internal/REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md`（含 §修订 v1.1 的 A1/A2/A3 与 A5）
2. `docs/internal/PROMPT-CODEX-U1-2-UNIT-POLICY-FIX-20261120.md`（D1 的精确修复说明）

## 0. 本任务**不做**的事（违反即返工）

- **不接生产**：不得改 `lib/index.js`、`lib/client.js`、`skins/**`、生成器、`tools/run-smoke.mjs`；不得让任何生产路径 import 新模块。
- 不改 `lib/injection/policy-v2.js`（F3 已验收）。
- 不新增持久化字段、不改 `PRESETS`/`DEFAULT_POLICY`。
- 不提交、不推送、不跑 release、不改版本号。

## 1. 允许的改动（四个文件）

| 文件 | 动作 |
|---|---|
| `lib/injection/unit-policy.js` | 改（只做 D1 修复） |
| `tests/smoke/smoke-test-batch3-unit-policy.mjs` | 改（P-25/P-26 + M-11） |
| `lib/injection/unit-adapters.js` | **新增**（六 adapter + bindUnits） |
| `tests/smoke/smoke-test-batch3-unit-adapters.mjs` | **新增** |

全部 **LF**。

运行环境：Node ESM（服务端专用）。`unit-policy.js` / `unit-adapters.js` **不得**进入浏览器 bundle；可用 `Buffer`（Node 全局），但不得 import `node:*` 之外的东西。

## 2. 第一部分：D1 修复（照 U1.2 任务书执行）

- `budgetOvercommit === true` 分支：先判 `entry.enabled`——禁用 ⇒ `rejected(module-disabled)`，启用 ⇒ `deferred`。
- 新增 **P-25**（禁用 + overcommit ⇒ rejected 恰为 module-disabled、deferred 空）、**P-26**（禁用进 rejected、启用进 deferred）。
- 新增 **M-11**（删该判断 ⇒ P-25/P-26 红）。
- 验收：`unit-policy` 套件 **30 PASS / 0 FAIL**。

## 3. 第二部分：U2 的分层（关键设计，不要自行改动）

U2 拆成**两层**，职责严格分离：

```
原生数据 ──[adapter：纯函数，不认识 policy]──▶ RawUnit ──[bindUnits：唯一认识 policy 的地方]──▶ Unit
```

### 3.1 RawUnit（adapter 产出，不含策略）

```js
RawUnit = {
  moduleId: string,      // 必须是 PRODUCER_IDS 之一（不含 locked/diagnostics）
  unitKind: string,      // 必须属于 MODULE_REGISTRY[moduleId].units
  sourceRef: string,     // 稳定来源标识（事件 id / 段号 / 文件相对路径），非空
  text: string,          // 已渲染文本（adapter 不做策略裁剪）
  pointer: string|null,  // 指针视图用的目标；无指针能力时为 null
}
```

- **cost 不在 RawUnit 里**：由 `bindUnits` 用 `text` 实算（jsChars = text.length、utf8Bytes = Buffer.byteLength(text,'utf8')），避免两处测量漂移。
- **id 也不在 RawUnit 里**：由 `bindUnits` 生成 `<moduleId>:<unitKind>:<sourceRef>`，保证全局唯一口径。

### 3.2 bindUnits(rawUnits, policy, options?) -> Unit[]

- 唯一允许读 `policy` 的函数。
- 对每个 raw：取 `policy.modules[moduleId]` 的 `view` 与 `priority`；view 不在该模块 `views` 内 ⇒ 抛 `UnitPolicyError('view-not-allowed')`。
- 生成 policyKey：在该模块 `quotas` 中找 `quota.unit === unitKind` 的条目——恰好一条 ⇒ `'<unit>/<scope>'`；多条不同 scope ⇒ **抛 `ambiguous-quota-scope`**（本批不猜）；零条 ⇒ `'@unbounded'`。
- 生成 id 与 cost（见上）。
- 产出必须能直接喂给 `selectUnits`（用 U1 的 `validateUnit` 自检）。
- `options.assignPriority`（测试用）可覆盖 priority；默认不提供。

> `ambiguous-quota-scope` 是**新增错误码**，只在 bind 期出现；`REASONS` 不变。

### 3.3 六个 adapter（全部纯函数，签名 `(input) -> RawUnit[]`）

| 导出 | 来源（只读其**已算好的数据**，不调引擎、不读盘） | unitKind 取值 |
|---|---|---|
| `adaptEvents` | 事件列表/详情（`event-view.js` 的输入形状） | `event` / `checkpoint` / `catalogEntry` |
| `adaptRules` | 规则五类（`read-rules.js` 的输出形状） | `rule` / `ruleModule` |
| `adaptPlan` | 白板 planSpec 的段 | `planSection` |
| `adaptHandoff` | 账本四段 | `ledgerSection` |
| `adaptPortrait` | 画像条目 | `portraitItem` |
| `adaptCalendar` | 日历条目 | `calendarEntry` |

硬性要求（每个 adapter 都一样）：

1. **零 IO**：不 import `fs`/`path`/`process`；不读时间/随机；不 console。
2. **不读 policy**：不知道 view、priority、quota 的存在。
3. **不裁剪**：超长文本原样返回（裁剪属 selector/FM）。
4. **不造占位**：空来源返回 `[]`，不得生成「暂无内容」之类占位段。
5. **不吞错**：结构非法（缺字段/类型错）⇒ 抛 `UnitPolicyError('invalid-source')`，detail 带 adapter 名与字段路径。
6. `sourceRef` 必须**稳定**：同一来源两次调用得到同一 sourceRef（不得用数组下标当唯一标识，除非该来源无天然 id）。
7. EV 的 `closed` 事件必须标 `catalogEntry`，**不得**标 `event`（R3-2：closed 不进事件配额竞争）。

## 4. 测试（`smoke-test-batch3-unit-adapters.mjs`）

### 4.1 每个 adapter 4 条（共 24 条）

- AD-x1 正常结构 ⇒ RawUnit 形状合法（moduleId/unitKind/sourceRef/text/pointer 齐）且数量对；
- AD-x2 空来源 ⇒ `[]`（严格空数组）；
- AD-x3 结构非法（缺必填字段 / 类型错）⇒ 抛 `invalid-source`；
- AD-x4 超长单条 ⇒ text 原样返回、长度不变（不截断）。

### 4.2 bindUnits 8 条（B 组）

- B-01 正常：view/priority 取自 policy；id/cost 正确；`validateUnit` 通过；
- B-02 view 不合法 ⇒ `view-not-allowed`；
- B-03 只有一条 quota 匹配 ⇒ policyKey 正确；
- B-04 多条不同 scope 匹配 ⇒ `ambiguous-quota-scope`；
- B-05 无 quota 匹配 ⇒ `@unbounded`；
- B-06 utf8Bytes 与 `Buffer.byteLength` 一致（含中文/emoji 各一条）；
- B-07 两个 raw 同 sourceRef ⇒ 生成同 id（重复由 selector 的 `duplicate-id` 负责，本层不抛）；
- B-08 产出可直接喂 `selectUnits`（端到端一次真调用，返回 selected 非空）。

### 4.3 变异（3 条）

- MA-01 把 EV 的 closed 标成 `event` ⇒ 对应用例红；
- MA-02 adapter 里对超长 text 做 `slice` ⇒ AD-x4 红；
- MA-03 `bindUnits` 用下标当 id（而非 sourceRef）⇒ B-07 红。

> 变异沿用 `U1_MUTATION_DIR` 机制（隔离副本），逐条 CAUGHT → 还原复绿。

## 5. 验收出口

1. `node --check` 四个源文件 = 0。
2. `node tests/smoke/smoke-test-batch3-unit-policy.mjs` ⇒ **30 / 0**。
3. `node tests/smoke/smoke-test-batch3-unit-adapters.mjs` ⇒ **32 / 0**（24 + 8）。
4. 变异：policy 11/11 + adapters 3/3 CAUGHT，还原后复绿。
5. `lib/index.js`、`lib/client.js` sha256 与开工前逐字节相同；`git status` 只多出允许的四个文件。
6. `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK。
7. `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` ⇒ FAIL 0。

## 6. 回执

`docs/internal/RECEIPT-BATCH3-U12-U2-ADAPTERS-20261120.md`：

- 每个 adapter 的输入形状（从现有模块读到的真实结构，一句话 + 字段名）；
- 32 条用例逐条结果、3 条变异红/绿证据；
- 物理量（行数/字节/sha16）、未做项单列（必须写明「U3 未接线」）。

## 7. 常见错误（会返工）

- ❌ adapter 里 import `fs` 或调 engine —— 纯函数，输入即数据。
- ❌ adapter 读 `policy` 决定 view —— view 归 `bindUnits`。
- ❌ `bindUnits` 遇到多条 quota 时「随便挑一条」—— 必须抛 `ambiguous-quota-scope`。
- ❌ 用数组下标当 `sourceRef`（跨调用不稳定，会破坏 deferred 的 id 语义）。
- ❌ 为通过 AD-x4 把长文本截断。
- ❌ 顺手把 adapter 接进 `lib/index.js`「试一下」。
