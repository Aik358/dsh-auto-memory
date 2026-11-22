# Codex 任务书 · P3-A2 · U2.1：事件配额家族匹配 + ruleModule（maintenance）

前置：U1.2 + U2 已交付并经 Lead 复核 —— `unit-policy` 30/0、`unit-adapters` 32/0 均**复现为真**；我自造的「adapter 截断长文本」变异令 6 条 AD-x4 全红（26/6）。**adapter 的纯函数与不截断契约成立。**

但复核发现 **2 个真实缺口**，本任务只修这两处。权威依据：U0 契约 **§修订 v1.3 的 A6 / A7**。

## 1. D2：事件配额被 checkpoint/catalogEntry 绕过（必修）

**实测复现**（我跑的探针）：

```
policy.modules.events.quotas = [{ unit: 'event', scope: 'event', max: 2, strength: 'hard' }]
bindUnits([event 单元, checkpoint 单元], policy)
⇒ [ { kind:'event',      key:'events:cards+catalog:event/event' },
     { kind:'checkpoint', key:'events:cards+catalog:@unbounded' } ]
```

根因：`bindUnits` 用 `quota.unit === raw.unitKind` 精确匹配。而 `policy-v2.js:183` 的既有语义是 **`scope:'event'` 是一个家族桶**（成员 `event|checkpoint|catalogEntry`）。⇒ checkpoint / catalogEntry 拿不到配额键，走 `@unbounded`，**事件配额形同虚设**。F13 也按 `unitKind` 精确匹配，所以它拦不住。

**修法（唯一匹配函数，两处共用）：在 `unit-policy.js` 新增并导出**

```js
export const EVENT_FAMILY = ['event', 'checkpoint', 'catalogEntry']

export function quotaMatchesForUnitKind(quotas, unitKind) {
  return quotas.filter(q => q.unit === unitKind
    || (q.scope === 'event' && EVENT_FAMILY.includes(unitKind)))
}
```

- `selectUnits` 里的 F13 判定改用该函数；
- `bindUnits` 改用该函数：命中的 `(unit + '/' + scope)` **去重**——1 个 ⇒ 用它；多个不同 ⇒ `ambiguous-quota-scope`；0 个 ⇒ `@unbounded`。

## 2. D3：`ruleModule`（maintenance 子段）没有生产者

`MODULE_REGISTRY.rules.units` 含 `ruleModule` 且 `children: ['maintenance']`，但 `adaptRules` 只产 `rule`。

**修法**：`adaptRules(input)` 接受**可选** `input.maintenance = { key?: string, text: string }`：

- 有且 `text.trim()` 非空 ⇒ 产 1 个 `ruleModule` 单元，`sourceRef = 'rules:maintenance:' + (key || 'default')`；
- 无 / 空 ⇒ **不产**（不造占位）。

另：`deliveryModule` 是 U3 的帧装配层产物，U2 六个 adapter **一律不产**，不要顺手补。

## 3. 允许改动（四个文件，全部 LF）

| 文件 | 动作 |
|---|---|
| `lib/injection/unit-policy.js` | 新增 EVENT_FAMILY / quotaMatchesForUnitKind；F13 改用 |
| `lib/injection/unit-adapters.js` | bindUnits 改用；adaptRules 加可选 maintenance |
| `tests/smoke/smoke-test-batch3-unit-policy.mjs` | +P-27/P-28 +M-12 |
| `tests/smoke/smoke-test-batch3-unit-adapters.mjs` | +B-09/B-10/B-11 +M-13/M-14 |

**不得**改 `policy-v2.js`、`lib/index.js`、`lib/client.js`、`skins/**`、生成器、`tools/run-smoke.mjs`；不接线生产；不提交不推送。

## 4. 新增用例

### 4.1 policy 套件（+2）

- **P-27**：模块 `events` 配 `{unit:'event',scope:'event',max:1,strength:'hard'}`；给一个 **checkpoint** 单元且 `policyKey` 写 `@unbounded` ⇒ 抛 `UnitPolicyError('quota-bypass')`。
- **P-28**：同上但单元是 **catalogEntry** ⇒ 同样抛 `quota-bypass`。

### 4.2 adapter 套件（+3）

- **B-09**：`{unit:'event',scope:'event'}` 配额下，`checkpoint` raw ⇒ `policyKey` 恰为 `events:<view>:event/event`（**不是** `@unbounded`）。
- **B-10**：同上 `catalogEntry` raw ⇒ 同得 `event/event`。
- **B-11**：`adaptRules` 带 `maintenance:{text:'...'}` ⇒ 恰多 1 个 `ruleModule` 单元、sourceRef 以 `rules:maintenance:` 开头；不带 `maintenance` ⇒ 无 `ruleModule` 单元。

### 4.3 变异（+3）

- **M-12**：`quotaMatchesForUnitKind` 退回只按 `q.unit === unitKind` ⇒ P-27/P-28 红。
- **M-13**：`bindUnits` 退回精确匹配 ⇒ B-09/B-10 红。
- **M-14**：`adaptRules` 忽略 `input.maintenance` ⇒ B-11 红。

## 5. 验收出口

1. `node --check` 四个文件 = 0。
2. `node tests/smoke/smoke-test-batch3-unit-policy.mjs` ⇒ **32 PASS / 0 FAIL**（30 + 2）。
3. `node tests/smoke/smoke-test-batch3-unit-adapters.mjs` ⇒ **35 PASS / 0 FAIL**（32 + 3）。
4. 变异：policy **12/12**、adapters **5/5** CAUGHT；M-01..M-11 与 MA-01..MA-03 全重跑；还原后复绿。
5. `lib/index.js` / `lib/client.js` sha256 与开工前逐字节相同。
6. `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK。
7. `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` ⇒ FAIL 0。

## 6. 回执

`docs/internal/RECEIPT-BATCH3-U2-1-QUOTA-FAMILY-20261120.md`：修复前后 `bindUnits` 的 policyKey 对照（贴真实输出）、P-27/P-28/B-09..B-11 结果、M-12..M-14 红/绿证据、新物理量、未做项（写明「U3 未接线、deliveryModule 未产」）。

## 7. 常见错误（会返工）

- ❌ 把 `scope:'event'` 家族规则写成「只对 event 生效」——checkpoint 仍会绕过。
- ❌ `bindUnits` 对多个不同配额键「挑 max 最大的那条」——必须抛 `ambiguous-quota-scope`。
- ❌ 让 F13 与 `bindUnits` 各写一份匹配逻辑——必须是同一个导出函数，两处共用。
- ❌ `adaptRules` 在无 `maintenance` 时补一个空 `ruleModule` 占位。
- ❌ 顺手把 `deliveryModule` 也造出来。
