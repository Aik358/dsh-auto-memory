# Codex 任务书 · P3-A2 · U1.1：预算语义 + 配额绕过防护（小补丁）

前置：U1 主体已交付并通过 Lead 复核（22 PASS / 0 FAIL；Lead 独立跑 3 条变异均 CAUGHT）。
本步只处理复核中裁定的 3 个点。权威依据：
`docs/internal/REVIEW-BATCH3-P3A2-U0-CONTRACT-20261120.md` **§修订 v1.1（优先于前文冲突处）**。

## 1. 允许的改动（只有两个文件）

1. `lib/injection/unit-policy.js`（LF）
2. `tests/smoke/smoke-test-batch3-unit-policy.mjs`（LF）

**不得**改 `policy-v2.js`（F3 已验收）、不得改 `lib/index.js` / `lib/client.js` / `skins/**` / 生成器 / `tools/run-smoke.mjs`；不接线生产；不提交不推送。

## 2. 改动 A：`budget` 是总额，S8 优先，新增 `budgetOvercommit`

现状问题：locked 单元成本在普通单元判预算**之前**累计，若 locked 自身已超 budget，则 S8（locked 直通）与 S10（`truncatedBy='budget'` 时总成本 ≤ budget）不能同时成立。

要求：
- `output` **恒含** `budgetOvercommit: boolean`（形状稳定，不要只在超限时才加字段）。
- 计算 `lockedCost`（全部 locked unit 的 cost 之和，按 jsChars/utf8Bytes 分别）。
- 普通单元判预算时用：`nonLockedCost + unitCost <= budget`（即 budget 减掉 locked 之后剩下的空间）。
- 若 `lockedCost` 单独已超 budget（任一 metric）⇒ 所有普通单元进 `deferred`、`truncatedBy='budget'`、`budgetOvercommit=true`。
- 否则 `budgetOvercommit=false`；普通单元因预算不足进 deferred 时 `truncatedBy='budget'`。
- `output.cost` 仍为**全部** selected 的成本（含 locked）。
- 保持既有行为不变：locked 顺序、整单元取舍、排序、reason 枚举、freeze。

## 3. 改动 B：新增 F13 `quota-bypass` 防护

现状缺口：unit 用 `@unbounded` 即可跳过模块已配置的配额，adapter 可无声绕过上限。

要求（在 prepared 阶段、配额解析处）：
- 若 `modulePolicy.quotas` 中存在**至少一条** `quota.unit === unit.unitKind` 的条目 ⇒ 该 unit **不得**使用 `@unbounded`；其 `policyKey` 必须匹配其中一条的 `(unit, scope)`，否则抛 `UnitPolicyError('quota-bypass')`，detail 带 `{ moduleId, unitKind }`。
- 若不存在任何 `quota.unit === unit.unitKind` ⇒ `@unbounded` 合法（不得误伤）。
- 同一 unitKind 有多条不同 scope 的配额时：视为「受配额约束」，仍须匹配其中之一（允许匹配任一）。
- **不要**给 `Unit` 增加 `scope` 字段；判定只用 `unitKind`。
- `REASONS` 数组**不变**（`quota-bypass` 是抛错，不是 rejection reason）。

## 4. 改动 C：新增 6 条用例 + 2 条变异

| 编号 | 用例 | 期望 |
|---|---|---|
| P-19 | locked 成本 100、budget 50、另 1 个普通 unit | locked 全进 selected；普通进 deferred；`truncatedBy='budget'`；`budgetOvercommit=true` |
| P-20 | locked 成本 30、budget 50、普通 unit 成本 10 | 全进 selected；`budgetOvercommit=false`；非 locked 部分 10 ≤ 50−30 |
| P-21 | 模块配 `{unit:'event',scope:'event'}`，unit 自称 `@unbounded` | 抛 `UnitPolicyError('quota-bypass')` |
| P-22 | 模块未配任何 `event` 配额，unit 用 `@unbounded` | 正常通过 |
| P-23 | 模块配 `event/event` 与 `event/delivery` 两条，unit 用 `event/delivery` | 正常通过 |
| P-24 | 既有 P-12 的预算语义在新口径下仍成立（普通单元、无 locked） | 与原来一致，且 `budgetOvercommit=false` |

变异（隔离副本，逐条 CAUGHT → 还原复绿）：
- **M-09**：删掉 F13 检测 ⇒ P-21 必红。
- **M-10**：把 locked 成本从 `cost` 中剔除以「满足」S10 ⇒ P-19 必须红（`cost` 少算 或 `budgetOvercommit` 缺失）。

变异一律在副本目录（如 `artifacts/_u1-mutations/M09`）执行，沿用现有 `U1_MUTATION_DIR` 机制；**不要**就地改共享文件。

## 5. 验收出口（贴进回执）

1. `node --check` 两个文件 = 0。
2. `node tests/smoke/smoke-test-batch3-unit-policy.mjs` ⇒ **28 PASS / 0 FAIL**（22 + P-19..P-24）。
3. 变异 **10/10 CAUGHT、0 MISSED**，还原后逐份复绿（含原 M-01..M-08 重跑一遍，防止改动把旧判据打破）。
4. `lib/index.js` 与 `lib/client.js` sha256 与开工前**逐字节相同**。
5. `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK。
6. `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` ⇒ FAIL 0。
7. 记录 `unit-policy.js` 与测试文件的行数/字节/sha16。

## 6. 回执要求

`docs/internal/RECEIPT-BATCH3-U1-1-UNIT-POLICY-20261120.md`：
- 一段说明「A/B/C 三处改动各自落在哪几行」；
- P-19..P-24 逐条结果 + M-09/M-10 的红/绿证据；
- 新物理量（行数/字节/sha16）；
- **未做/未验证项单列**；
- 明确写出「未接线生产」。

## 7. 常见错误（会返工）

- ❌ 只在超限时才把 `budgetOvercommit` 塞进输出（形状不稳定）。
- ❌ 把 `budget` 当「普通单元剩余额度」却仍让 `cost` 只算普通部分（FM 会砍两次）。
- ❌ F13 用 `policyKey` 字符串前缀判断而不是 `quota.unit === unit.unitKind`（会把合法 unbounded 误杀）。
- ❌ 改 `REASONS` 加 `quota-bypass`（它是抛错不是理由）。
- ❌ 变异只跑新用例、不重跑 M-01..M-08。
