# Codex 任务书 · P3-A2 · U1.2：修复「禁用模块在预算超限时泄漏到 deferred」

前置：U1.1 已交付并通过 28/0，但 Lead 复核发现一个**真实缺陷**（未覆盖组合）。

## 1. 缺陷（可复现）

场景：`policy.modules.events.enabled = false`；locked 单元成本 100、`budget = {jsChars:50, utf8Bytes:50}`；另给 1 个 events 模块的普通 unit（`policyKey='events:cards:@unbounded'`）。

当前结果：`selected=[locked]`、`rejected=[]`、`deferred=[events unit]`、`budgetOvercommit=true`。

**问题**：`deferred` 的语义是「因预算暂未入选、预算放宽后可再考虑」。把 `enabled=false` 的模块单元放进 `deferred`，会让 U3 在「下一帧预算变宽」时把它注入进来 ⇒ **禁用开关被绕过**。正确结果是 `rejected=[{reason:'module-disabled'}]`、`deferred=[]`。

根因：`if (budgetOvercommit) { for (const entry of ordinary) deferred.push(entry.unit) }` 分支没有先判 `entry.enabled`。

## 2. 修复（只改一处 + 加用例）

允许改动的文件（只有两个）：
1. `lib/injection/unit-policy.js`（LF）
2. `tests/smoke/smoke-test-batch3-unit-policy.mjs`（LF）

修复要求：
- `budgetOvercommit === true` 时，遍历 ordinary：**先判 `enabled`**——`enabled === false` ⇒ `rejected.push(makeRejected(unit, 'module-disabled'))`；`enabled === true` ⇒ `deferred.push(unit)`。
- 其余行为不变：`truncatedBy='budget'`、`budgetOvercommit=true`、`cost` 含 locked、配额不记账。
- 不要改 `REASONS`、不要改 F13、不要改 budget 计算。

新增用例：
- **P-25**：上述场景 ⇒ `rejected` 恰为 `[{reason:'module-disabled'}]`、`deferred` 为空、`budgetOvercommit=true`、`truncatedBy='budget'`。
- **P-26**：overcommit 下同时给「禁用模块单元」与「启用模块单元」⇒ 前者进 rejected（module-disabled）、后者进 deferred。

新增变异：
- **M-11**：删掉 overcommit 分支里的 `enabled` 判断（恢复旧行为）⇒ P-25 与 P-26 必红。

## 3. 验收出口

1. `node --check` 两个文件 = 0。
2. `node tests/smoke/smoke-test-batch3-unit-policy.mjs` ⇒ **30 PASS / 0 FAIL**（28 + P-25/P-26）。
3. 变异 **11/11 CAUGHT**，还原后逐份复绿（M-01..M-10 全重跑）。
4. `lib/index.js` 与 `lib/client.js` sha256 与开工前逐字节相同。
5. `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK。
6. `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` ⇒ FAIL 0。

## 4. 回执

`docs/internal/RECEIPT-BATCH3-U1-2-UNIT-POLICY-20261120.md`：缺陷复现输出（修复前）、修复后 P-25/P-26 结果、M-11 红/绿证据、新物理量、未做项单列。

## 5. 纪律

- 不接生产、不提交、不推送；
- 变异在隔离副本（`U1_MUTATION_DIR`）执行，不改共享文件；
- 不允许为了过测把 P-25 改成「deferred 也接受」。
