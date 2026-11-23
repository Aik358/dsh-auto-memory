# 批次 3 P3-A2 U1 回执：unit-policy 纯选择器 + F3 校验

日期：2026-11-20
基线 HEAD：`23646c04`
范围：新增纯 Unit 选择器；在 `quotas()` 收紧同模块重复 `(unit, scope)` 校验；新增真调用 smoke。未接生产注入。

## 交付文件

| 文件 | 物理量 | 行尾 | 改动 |
|---|---:|---|---:|
| `lib/injection/unit-policy.js` | 279 行 / 10,838 B / SHA16 `CFFDCDAA1217ED37` | LF | 新增 279 行 |
| `lib/injection/policy-v2.js` | 452 行 / 28,042 B / SHA16 `E055339F894CBBEE` | LF | `quotas()`：+9 / -1；只新增重复检测 |
| `tests/smoke/smoke-test-batch3-unit-policy.mjs` | 307 行 / 13,834 B / SHA16 `5826E171458C5D10` | LF | 新增 307 行 |
| 本回执 | 本文 | LF | 新增 |

实现入口：`unit-policy.js:3` 版本常量、`:14` 错误类型、`:54` key helper、`:71` Unit 校验、`:185` 选择器。F3 在 `policy-v2.js:176-201`，后出现条目通过 `policy-v2.js:198` 的 `bad(p + '[' + i + ']', 'duplicate-quota-scope')` 失败。测试覆盖见 `smoke-test-batch3-unit-policy.mjs:90-303`。

`unit-policy.js` 只导入 `MODULE_REGISTRY`、`PRODUCER_IDS`、`LOCKED_MODULES`；仓库搜索确认生产侧没有导入该模块，本步没有生产注入接线。

## P 与 F3 判据

| 判据 | 结果 | 实际断言 |
|---|---|---|
| P-01 | PASS | 相同输入两次选择后 JSON 完全相同 |
| P-02 | PASS | 选择前后输入 JSON 相同 |
| P-03 | PASS | 选择器源码不含 `fs`、`path`、`process`、`Date`、`Math.random` |
| P-04 | PASS | 优先级降序、moduleId 升序、id 升序；倒序输入仍相同 |
| P-05 | PASS | hard max=3、5 个候选：选 3、拒 2，原因 `quota-exhausted` |
| P-06 | PASS | soft max=3、allowance=2、6 个候选：选 5、拒 1 |
| P-07 | PASS | `enabled=false` 时全部以 `module-disabled` 拒绝，不进入配额记账 |
| P-08 | PASS | 两个 locked 模块均以 full 直通、不竞争配额，成本累计到输出 |
| P-09 | PASS | pointer 为空时真实调用抛 `UnitPolicyError('no-pointer')` |
| P-10 | PASS | 重复 id 真实调用抛 `UnitPolicyError('duplicate-id')` |
| P-11 | PASS | 负 cost 真实调用抛 `UnitPolicyError('invalid-cost')` |
| P-12 | PASS | 预算容纳一半时整条进入 selected，其余完整保留在 deferred；selected 成本不超预算 |
| P-13 | PASS | rejected 项均含六种允许 reason 之一 |
| P-14 | PASS | 同模块的不同 view/quotaKey 各自独立计数 |
| P-15 | PASS | event 与 checkpoint 使用同一 `event/event` policyKey，共享 max |
| P-16 | PASS | 一个模块关闭时其他启用模块仍正常入选 |
| P-17 | PASS | 零候选返回空集合、零成本、`truncatedBy=null` |
| P-18 | PASS | 1,000 单元稳定排序；测试阈值 `<50ms`。额外实测五次为 7.52、4.02、4.84、3.59、3.72ms |
| F3-01 | PASS | 重复 `(event,event)` 在 `modules.events.quotas[1]` 抛 `DeliveryPolicyError`，消息含 `duplicate-quota-scope` |
| F3-02 | PASS | 不同 scope 的策略通过；四个 PRESETS 全部重新 validate 通过 |

另有三条失败路径真调用：未注册 view 抛 `view-not-allowed`；`legacy` phase 可用而未知 phase 抛 `invalid-phase`；非对象 policy 抛 `invalid-policy`。Unit key 由 moduleId/view/quotaKey 组合；由于冻结的 Unit 形状没有独立 `quotaKey` 字段，`unitPolicyKey(unit)` 从现有 `policyKey` 读取 quotaKey 后缀，显式调用也可传第二参数。

## 变异证据

每个变异都在 `artifacts/_u1-mutations/M01` 至 `M08` 隔离副本执行。目标判据实红后，将该副本恢复成原始文件并从副本路径重跑；八份恢复副本均为 `RESULT 22 PASS / 0 FAIL`。

| 变异 | 副本改动 | 实际变红判据 | 还原复绿 |
|---|---|---|---|
| M-01 | 取消 `enabled=false` 短路 | P-07；同时 P-16 | 22/0 |
| M-02 | 配额耗尽比较 `>=` 改 `>` | P-05；同时 P-06、P-15 | 22/0 |
| M-03 | 排序只按 id | P-04 | 22/0 |
| M-04 | `selectUnits` 读取 `Date.now()` | P-03 静态守卫 | 22/0 |
| M-05 | 删除 pointer 缺失失败分支 | P-09 | 22/0 |
| M-06 | locked 单元改走 max=0 配额竞争 | P-08 | 22/0 |
| M-07 | 测试副本的 adapter fixture 按预算截断文本 | P-12 | 22/0 |
| M-08 | 删除重复 quota 检查 | F3-01 | 22/0 |

首次执行 M01-M06/M08 时，隔离副本漏拷 `cadence.js` 的两个真实依赖。首个错误原文：`Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'D:\dsh-auto-memory\artifacts\_u1-mutations\M01\errors.js' imported from D:\dsh-auto-memory\artifacts\_u1-mutations\M01\cadence.js`。根因是副本仅含 selector/policy/cadence；修复为同时复制 `errors.js`、`dto.js`，然后才重跑并计入上表。首次加载错误不作为变异 CAUGHT 证据。

## 验收运行

| 命令 / 检查 | 结果 |
|---|---|
| `node --check lib/injection/unit-policy.js` | PASS |
| `node --check lib/injection/policy-v2.js` | PASS |
| `node --check tests/smoke/smoke-test-batch3-unit-policy.mjs` | PASS |
| 真 ESM import `unit-policy.js` 与 `policy-v2.js` | PASS |
| `node tests/smoke/smoke-test-batch3-unit-policy.mjs` | 22 PASS / 0 FAIL |
| `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` | PASS 1 / FAIL 0 |
| `node tools/run-smoke.mjs --filter=delivery-policy --timeout=180000` | PASS 2 / FAIL 0（v2、runtime） |
| `node tools/run-smoke.mjs --filter=delivery-settings-backend --timeout=180000` | PASS 1 / FAIL 0 |
| `node tools/build-iter5-skin.mjs --check --strict` | `SYNC-OK: sources × generator == lib/client.js`；工具另报告 2 个 shared-style effect 收敛到一个 source of truth |
| `node tools/verify-docs.mjs` | PASS；工具 22 / 路由 87 / 配置键 182 与文档一致 |
| `git diff --check` | PASS，无输出 |

`lib/index.js` SHA256 开工前/结束后均为 `89BCC7E8E38C76B9AF3F65FC1DB4E0401754432C9279416026384A2CB8A82F6A`。`lib/client.js` SHA256 开工前/结束后均为 `9154599DD272C142DBB3BE83BF3B7D0608CE90575C0091E443920F39F57AECD8`。生成区、生产入口、PRESETS、DEFAULT_POLICY 和持久化 schema 均未改。

## 契约边界与未验证项

1. 任务书把 `legacy` 加入 phase；U0 phase 列表未列 `legacy`。本实现按更新的本轮任务书接纳，并已有正负路径测试。
2. 任务书将 `diagnostics` 列入 moduleId，但 `MODULE_REGISTRY`（`policy-v2.js:76-90`）没有 diagnostics 的 views/units/priority；它只在策略校验时作为独立开关处理（`:342-345`）。选择器不发明枚举，传入 diagnostics Unit 会因无 registry 被拒绝为 `invalid-unit`。需后续契约或接线任务明确诊断摘要是否作为 Unit。
3. `user-memory` 与 `project-notes` 没有 policy module priority；locked 单元使用 Unit 自带且通过安全整数校验的 priority 排序，保持 full、直通、不竞争配额。
4. 尚未裁定 locked 成本自身超过调用方 budget、同时普通单元因预算进入 deferred 的组合语义：S8 要求 locked 直通并计入 cost，S10 又要求 `truncatedBy='budget'` 时总 selected cost 不超 budget。当前实现先累计 locked 成本，再据此判断普通单元预算；若 locked 自身已超 budget 且普通单元被 deferred，两个判据无法同时满足。需要 Lead 定义预算是含 locked 的总额还是普通单元剩余额度。
5. P-18 的 `<50ms` 对 1,000 单元通过，五次实测最大 7.52ms。选择顺序依赖一般比较排序；本回执不把实测耗时扩大表述为严格 O(n) 算法证明。
6. 未运行全量 smoke 套件；已运行本 U1、delivery-policy 两套件、delivery-settings-backend 一套件及文档/生成器检查。未做真实宿主验证，本步无 UI 或宿主改动。

开工前工作树已含其他未跟踪交付物（E2E-546 文档、U0 review、`output/`、多个 sidecar mutation 目录、历史 run-smoke mutation 脚本等）。本轮保留这些内容；因此不能声称 `git status --porcelain` 只列本轮文件。没有提交、推送或改版本号。
