# 批次 3 P3-A2 U1.1 回执：预算语义与 quota-bypass 防护

日期：2026-11-20
范围：只改 `lib/injection/unit-policy.js` 与 `tests/smoke/smoke-test-batch3-unit-policy.mjs`，另新增本回执。未接生产注入；未改 `policy-v2.js`、`lib/index.js`、`lib/client.js`、`skins/**`、生成器或 smoke runner。

## A/B/C 改动位置

| 项 | 落点 | 行为 |
|---|---|---|
| A：总预算与 overcommit | `unit-policy.js:242-294` | 单独累计 locked 成本；`budgetOvercommit` 恒定进入返回体；locked 超任一已提供预算指标时保留全部 locked、把所有普通单元放入 deferred、设置 `truncatedBy='budget'`；正常情况下普通单元按累计总成本（含 locked）判预算；`output.cost` 保留全部 selected 成本。 |
| B：F13 配额绕过防护 | `unit-policy.js:219-227` | 仅按 `quota.unit === unit.unitKind` 找对应项；存在对应项时 policyKey 必须匹配其中一个 unit/scope，否则抛 `UnitPolicyError('quota-bypass')`，detail 为 `{moduleId, unitKind}`。没有同 unitKind 配额时，`@unbounded` 仍有效；共享到其他 unitKind 的已配置 key 仍可正常匹配。`REASONS` 未改。 |
| C：测试 | `smoke-test-batch3-unit-policy.mjs:280-358` | 新增 P-19 至 P-24，分别覆盖锁定超预算、总预算留给普通单元、绕过拒绝、无同类 quota 时允许 unbounded、多 scope 选择和普通预算行为兼容。 |

## P-19 至 P-24

| 用例 | 结果 | 证据 |
|---|---|---|
| P-19 | PASS | locked=100、budget=50：locked 仍 selected，普通单元 deferred，`truncatedBy='budget'`、`budgetOvercommit=true`；`cost` 仍为 100。 |
| P-20 | PASS | locked=30、普通=10、budget=50：全部 selected，`budgetOvercommit=false`；普通成本 10 ≤ 50−30。 |
| P-21 | PASS | 已配置 `event/event` 时，event Unit 使用 `@unbounded` 抛 `quota-bypass`，detail 含 moduleId 与 unitKind。 |
| P-22 | PASS | 仅配置 checkpoint quota 时，event Unit 使用 `@unbounded` 正常入选，未误伤不同 unitKind。 |
| P-23 | PASS | event 配有 event 与 delivery 两个 scope 时，event Unit 选择 `event/delivery` 正常入选。 |
| P-24 | PASS | 无 locked 单元时沿用普通预算行为：2 selected、2 deferred、`truncatedBy='budget'`、`budgetOvercommit=false`。 |

主套件结果：`RESULT 28 PASS / 0 FAIL`。原有 P-01 至 P-18、F3-01/F3-02 和额外负路径仍通过。

## 变异结果

所有变异都在 `artifacts/_u1-mutations/M01` 至 `M10` 副本执行；共享源码未作变异。每项目标断言实红后，恢复对应副本并从副本路径重跑，均为 `RESULT 28 PASS / 0 FAIL`。

| 变异 | 变异内容 | 红证据 | 恢复后 |
|---|---|---|---|
| M-01 | 去掉 enabled=false 短路 | P-07 FAIL（同时 P-16 失败） | 28/0 |
| M-02 | quota 耗尽比较 `>=` 改 `>` | P-05 FAIL（P-06、P-15 也失败） | 28/0 |
| M-03 | 排序只按 id | P-04 FAIL | 28/0 |
| M-04 | 加入 `Date.now()` | P-03 FAIL | 28/0 |
| M-05 | 删除 pointer 缺失失败 | P-09 FAIL：期望 `UnitPolicyError(no-pointer)`，实际未抛 | 28/0 |
| M-06 | locked 改走 max=0 quota | P-08 FAIL | 28/0 |
| M-07 | adapter fixture 按预算截断文本 | P-12 FAIL | 28/0 |
| M-08 | 删除 F3 duplicate 检测 | F3-01 FAIL：期望异常，实际未抛 | 28/0 |
| M-09 | 删除 F13 unitKind quota 检测 | P-21 FAIL：期望异常，实际未抛 | 28/0 |
| M-10 | 从返回成本中剔除 locked 成本 | P-19 FAIL：实际 `{jsChars:0, utf8Bytes:0}`，期望 `{jsChars:100, utf8Bytes:100}` | 28/0 |

M-01 至 M-08 已用本轮 28 项测试重新复跑，不是沿用 U1 的 22 项结果。M-09 与 M-10 的失败均来自具体用例断言；恢复副本后各自 28/0。

## 验收与物理量

| 文件 | 行数 | 字节 | SHA16 | EOL |
|---|---:|---:|---|---|
| `lib/injection/unit-policy.js` | 296 | 11,655 | `13904375786CB43D` | LF |
| `tests/smoke/smoke-test-batch3-unit-policy.mjs` | 385 | 17,689 | `475D69114BAB975E` | LF |

| 检查 | 结果 |
|---|---|
| 两个获准文件 `node --check` | PASS，退出码 0 |
| 真调用 smoke | 28 PASS / 0 FAIL |
| `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` | PASS 1 / FAIL 0 |
| `node tools/build-iter5-skin.mjs --check --strict` | `SYNC-OK: sources × generator == lib/client.js` |
| 真 ESM import `unit-policy.js` | PASS |
| `git diff --check` | PASS |

`lib/index.js` 本轮开工/结束 SHA256 均为 `89BCC7E8E38C76B9AF3F65FC1DB4E0401754432C9279416026384A2CB8A82F6A`；`lib/client.js` 本轮开工/结束 SHA256 均为 `9154599DD272C142DBB3BE83BF3B7D0608CE90575C0091E443920F39F57AECD8`。

## 未做与工作树说明

- 未运行全量 smoke；任务书指定的 `batch3-unit` 筛选套件已运行。
- 未接线生产，也未做宿主验证；这是本阶段的硬边界。
- 当前工作树在本轮开始前已有 `lib/injection/policy-v2.js` 的 U1 修改，以及 `artifacts/e8-visual/e8-7-double-check.json` 修改。本轮没有碰这两处；其他既有未跟踪文件也保留。
- 未提交、未推送、未改版本号。
