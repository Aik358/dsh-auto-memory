# 批次 3 P3-A2 U2.1 回执：事件 quota 家族 + rules maintenance

日期：2026-11-20
范围：事件 scope 家族匹配、`ruleModule` maintenance RawUnit、对应真调用和隔离变异。U3 未接线；不改 `policy-v2.js`、生产入口、客户端、skins、生成器或 runner。

## 配额家族修复

`lib/injection/unit-policy.js:9` 导出冻结的 `EVENT_FAMILY = ['event','checkpoint','catalogEntry']`；`:28` 的 `quotaMatchesForUnitKind(quotas, unitKind)` 是唯一匹配函数。它同时用于 selector 的 F13 / quota 解析（`:225` 起）和 `bindUnits`（`unit-adapters.js:345`）。`bindUnits` 按 `unit/scope` 去重：零项绑定 `@unbounded`、一项绑定该 quota key、多项不同 key 抛 `ambiguous-quota-scope`。

对同一个 `events` policy（`quotas=[{unit:'event',scope:'event',max:2,strength:'hard'}]`）真实绑定输出：

```text
修复前：
[{"kind":"event","key":"events:cards+catalog:event/event"},
 {"kind":"checkpoint","key":"events:cards+catalog:@unbounded"},
 {"kind":"catalogEntry","key":"events:cards+catalog:@unbounded"}]

修复后：
[{"kind":"event","key":"events:cards+catalog:event/event"},
 {"kind":"checkpoint","key":"events:cards+catalog:event/event"},
 {"kind":"catalogEntry","key":"events:cards+catalog:event/event"}]
```

修复前结果来自隔离副本 M-13（binder 退回 exact-unitKind 匹配），共享源码未改动；修复后结果来自当前真实模块调用。

## `ruleModule` maintenance

`adaptRules` 在 `unit-adapters.js:152` 接受可选 `input.maintenance = {key?,text}`。缺少/null/空白正文不生成 RawUnit；非空正文只生成一个 `moduleId='rules'`、`unitKind='ruleModule'` 单元，sourceRef 为 `rules:maintenance:<key||default>`，pointer 复用 `SUMMARY_POINTER` 真源。其余五类 RulesAggregate 仍按原逻辑校验/投递，`deliveryModule` 没有由任何 U2 adapter 生成。

maintenance 是否应传入 adapter 由未来接线层根据有效策略决定；本步 adapter 不读取 policy。U0 v1.3 A7 有一处 prose 写成 `ruleUnit`，但该节标题、当前任务书、B-11 与 `MODULE_REGISTRY.rules.units` 使用 `ruleModule`；按本轮任务书和 registry 实现，没有新增单位枚举。

## 新用例

| 用例 | 结果 | 说明 |
|---|---|---|
| P-27 | PASS | 只有 `event/event` family quota 时，checkpoint 自称 `@unbounded` 抛 `quota-bypass` |
| P-28 | PASS | 同一 family quota 下，catalogEntry 自称 `@unbounded` 抛 `quota-bypass` |
| B-09 | PASS | checkpoint 绑定 `events:<view>:event/event` |
| B-10 | PASS | catalogEntry 绑定 `events:<view>:event/event` |
| B-11 | PASS | 非空 maintenance 恰产一个 `ruleModule`，sourceRef 包含显式 key；无 maintenance 或空文本不产占位 |

另在 B-04 的既有用例中加入冲突路径：checkpoint 同时匹配 `event/event` family 与 `checkpoint/delivery` 精确项时抛 `ambiguous-quota-scope`，不选最大额度或静默偏向任一项。

最终 selector suite：**32 PASS / 0 FAIL**。最终 adapter suite：**35 PASS / 0 FAIL**。

## 变异

所有变异均在 `artifacts/_u1-mutations/` 隔离副本执行；修改后的目标测试实红，恢复副本后逐份复绿。

| 变异 | 红证据 | 恢复后 |
|---|---|---|
| M-01 | 去掉 enabled=false 短路 → P-07 FAIL | 32/0 |
| M-02 | quota `>=` 改 `>` → P-05 FAIL | 32/0 |
| M-03 | 排序只按 id → P-04 FAIL | 32/0 |
| M-04 | 引入 `Date.now()` → P-03 FAIL | 32/0 |
| M-05 | 删除 pointer 空值拒绝 → P-09 FAIL | 32/0 |
| M-06 | locked 进入 max=0 quota → P-08 FAIL | 32/0 |
| M-07 | 测试 adapter fixture 截断长文本 → P-12 FAIL | 32/0 |
| M-08 | 删除 F3 校验 → F3-01 FAIL | 32/0 |
| M-09 | 删除 quota-bypass 校验 → P-21 FAIL | 32/0 |
| M-10 | 从 output cost 剔除 locked → P-19 FAIL | 32/0 |
| M-11 | overcommit 忽略 enabled → P-25、P-26 FAIL | 32/0 |
| M-12 | 家族 helper 退回精确 unit 匹配 → P-27、P-28 FAIL | 32/0 |
| M-13 | binder 退回精确 unit 匹配 → B-09、B-10 FAIL | 35/0 |
| M-14 | adapter 忽略 maintenance → B-11 FAIL | 35/0 |
| MA-01 | closed catalogEntry 改标 event → AD-EV-x1 FAIL | 35/0 |
| MA-02 | RawUnit 文本 `.slice(0,100)` → AD-EV-x4 FAIL | 35/0 |
| MA-03 | Unit id 改由数组 index 构造 → B-07 FAIL | 35/0 |

M-01..M-11 与 MA-01..MA-03 已按 U2.1 最终 selector/adapter 用例计数重新运行。旧 mutation copies 恢复后，selector 每份均 32/0，adapter 每份均 35/0。M-12..M-14 的新变异同样逐项实红后恢复复绿。

## 验收与物理量

| 文件 | 行数 | 字节 | SHA16 | EOL |
|---|---:|---:|---|---|
| `lib/injection/unit-policy.js` | 308 | 12,047 | `0225B044BF0578A3` | LF |
| `tests/smoke/smoke-test-batch3-unit-policy.mjs` | 428 | 20,180 | `B2436952A58B1FD4` | LF |
| `lib/injection/unit-adapters.js` | 376 | 18,419 | `642086CAB85CD5D2` | LF |
| `tests/smoke/smoke-test-batch3-unit-adapters.mjs` | 287 | 14,443 | `04C70E75EDB23797` | LF |

| 检查 | 结果 |
|---|---|
| 四文件 `node --check` | PASS，退出码 0 |
| unit-policy | 32 PASS / 0 FAIL |
| unit-adapters | 35 PASS / 0 FAIL |
| M-01..M-14 + MA-01..MA-03 | 全部 CAUGHT；恢复副本按对应套件全绿 |
| `node tools/build-iter5-skin.mjs --check --strict` | `SYNC-OK: sources × generator == lib/client.js` |
| `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` | PASS 2 / FAIL 0 / TIMEOUT 0 |
| 真 ESM import | selector 与 adapters 均 PASS |
| `git diff --check` | PASS |

`lib/index.js` 和 `lib/client.js` SHA256 与 U2.1 开工值一致：`89BCC7E8E38C76B9AF3F65FC1DB4E0401754432C9279416026384A2CB8A82F6A`、`9154599DD272C142DBB3BE83BF3B7D0608CE90575C0091E443920F39F57AECD8`。`policy-v2.js` 保持开工前已存在的修改，未触碰。

## 未做项

- **U3 未接线**：没有生产路径 import selector 或 adapters；没有真实宿主验证；没有运行全量 smoke。
- `deliveryModule` 仍属 U3 帧装配层产物，本步六个 adapter 均不生成它。
- 没有新增 schema、配置键或持久化数据；没有提交、推送或改版本号。
- 开工前工作树已有 `policy-v2.js`、`artifacts/e8-visual/e8-7-double-check.json` 修改及多项未跟踪文件，均予以保留。
