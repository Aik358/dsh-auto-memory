# 批次 3 P3-A2 U1.2 + U2 回执

日期：2026-11-20
范围：修复 U1.1 D1；新增六个纯 adapter 与 `bindUnits`；新增真调用 smoke。**U3 未接线**。未改生产入口、客户端、策略 schema、PRESETS 或生成器。

## 改动文件与物理量

| 文件 | 行数 | 字节 | SHA16 | EOL | 本轮变化 |
|---|---:|---:|---|---|---|
| `lib/injection/unit-policy.js` | 302 | 11,789 | `ABE69CB52D8658B2` | LF | D1 overcommit 分支先按 enabled 分流 |
| `tests/smoke/smoke-test-batch3-unit-policy.mjs` | 416 | 19,404 | `C17F6A200CBB758B` | LF | 增 P-25/P-26、M-11 判据 |
| `lib/injection/unit-adapters.js` | 360 | 17,661 | `4C51AFA77530C7E1` | LF | 新增六 adapter + bindUnits |
| `tests/smoke/smoke-test-batch3-unit-adapters.mjs` | 255 | 12,416 | `FF84137C55C3CD96` | LF | 新增 24 adapter + 8 binder 真调用用例 |

四文件无 CRLF、无尾随空格。保留既有 `policy-v2.js` 修改，SHA16 为 `E055339F894CBBEE`，本轮没有修改它。

## D1 修复

`unit-policy.js:257-264` 的 `budgetOvercommit` 分支现在先判断 `entry.enabled`：禁用模块进入 `rejected`，reason 为 `module-disabled`；启用模块进入 `deferred`。其他预算、成本、locked 直通和 rejection 语义不变。

| 用例 | 结果 | 证据 |
|---|---|---|
| P-25 | PASS | locked 成本 100、budget 50、events disabled：locked selected；events 只进入 `rejected(module-disabled)`；deferred 为空；overcommit 与截断标记均为 true / budget |
| P-26 | PASS | overcommit 下 disabled event 进入 rejected、enabled rules 进入 deferred，locked 仍 selected |

U1 selector 套件最终为 **30 PASS / 0 FAIL**。

## Adapter 输入与映射

六个 adapter 只读已算好的数据，不接触 policy、引擎或文件；RawUnit 固定为 `moduleId/unitKind/sourceRef/text/pointer` 五个字段。RawUnit 不含 id、cost。source 为空时返回 `[]`；非法结构抛 `UnitPolicyError('invalid-source')`，detail 含 adapter 名和字段路径；长文本保留原文。

| Adapter | 真实输入形状 | 映射与边界 |
|---|---|---|
| `adaptEvents` | event-view 风格 `{events:[{id,name,status,summary,sections:{goal,doing,deadend,next},checkpoints:[...]}]}`；checkpoint 接受稳定 id/sourceRef/idemKey/opId 或四段/正文 | active 事件 → `event`，检查点 → `checkpoint`；非 active（含 closed）→ `catalogEntry`。closed 不生成 event unit。来源优先事件/检查点天然身份，缺少检查点身份时由不可变来源字段组合稳定生成。 |
| `adaptRules` | `readRulesAggregatePre` 的 `RulesAggregate`：`rules/notes/candidates/references/retired` 五数组；条目含 `layer/entryIndex/itemIndex/segmentIndex/entryId/itemId/text/kind/revision/status/retired` | 当前 rule/note 正文 → `rule`；候选、reference、retired 会校验结构但不变成有效投递单元；pointer 使用 `render-rules.js` 的 `SUMMARY_POINTER` 真源。sourceRef 含层、条目位置和 revision。 |
| `adaptPlan` | 已算好的 planSpec，可为 `sections:[{key|id|title,text}]` 或 `current/recent/constraints/todos` 四段字符串 | 每段 → `planSection`；以稳定段 key 生成 sourceRef。plan-render 的四种精确空状态占位不生成 RawUnit；合法空段不会制造占位。 |
| `adaptHandoff` | `parseHandoffLedgerPre` 形状 `{sections:[{title,body,weight}]}` | 四种 canonical section（goal/state/dead-end/progress）各映射 `ledgerSection`，sourceRef 按 tag 稳定。空数组返回 `[]`。 |
| `adaptPortrait` | 结构化画像条目 `{portraitItems:[{kind,stage,text,sourceRef,eventId,at}]}`，来源语义对齐 `events[].userPercept` | accepted/used 的已知画像 kind 和 `authorResponse` → `portraitItem`；不从原始记忆文本启发式造画像。 |
| `adaptCalendar` | 已解析且已按工作区范围准备好的 `{entries:[{id,date,done,time,quadrant,title,note}]}` | 每项 → `calendarEntry`，优先用稳定 calendar id；旧条目无 id 时按身份字段确定性生成。Adapter 不读时钟、不访问工作区，也不自行扩大调用方给定的 entries 范围。 |

`bindUnits`（`:315`）是唯一读取策略的位置：读取 producer 的 view/priority； quota 按 `quota.unit === unitKind` 精确匹配；一条匹配生成 `unit/scope`，多条抛 `ambiguous-quota-scope`，无匹配生成 `@unbounded`；按文本计算 UTF-16 `jsChars` 与 UTF-8 `utf8Bytes`；构建稳定 id 并用 `validateUnit` 自检。`options.assignPriority` 只用于测试覆盖。

## 用例结果

每个 adapter 的 x1 正常形状、x2 空输入、x3 非法结构、x4 长文本共 24 项；binder B-01..B-08 共 8 项。**adapter suite 为 32 PASS / 0 FAIL**。

| 范围 | 结果 |
|---|---|
| AD-EV-x1..x4 | 4 PASS；x1 核验 closed 只产 `catalogEntry` |
| AD-RP-x1..x4 | 4 PASS；x1 带五类聚合结果，只有有效 rules/notes 产生投递单元 |
| AD-PL-x1..x4 | 4 PASS；x2 使用真实空白板四段输出，确认占位不生成 RawUnit |
| AD-HO-x1..x4 | 4 PASS |
| AD-PT-x1..x4 | 4 PASS |
| AD-CA-x1..x4 | 4 PASS |
| B-01 | PASS：view/priority 来自 policy，id/cost 正确，`validateUnit` 通过；规则 pointer 也通过同一验证 |
| B-02 | PASS：非法 view 抛 `view-not-allowed` |
| B-03 | PASS：唯一 quota 生成对应 policyKey |
| B-04 | PASS：多 scope 抛 `ambiguous-quota-scope` |
| B-05 | PASS：没有对应 unitKind quota 时允许 `@unbounded` |
| B-06 | PASS：中文和 emoji 的 UTF-16/UTF-8 计量分别为 4/10 |
| B-07 | PASS：重复 sourceRef 生成重复 id，由 selector 抛 `duplicate-id` |
| B-08 | PASS：adapter → binder → selector 真实调用后 selected 非空 |

## 变异证据

所有变异在 `artifacts/_u1-mutations/` 的隔离副本执行，没有修改共享文件。每份恢复副本从副本路径重跑，结果符合对应 suite 的绿值。

| 变异 | 修改及红证据 | 恢复后 |
|---|---|---|
| M-01 | 移除 disabled 短路 → P-07 FAIL | 30/0 |
| M-02 | quota `>=` 改 `>` → P-05 FAIL | 30/0 |
| M-03 | 排序只按 id → P-04 FAIL | 30/0 |
| M-04 | 引入 `Date.now()` → P-03 FAIL | 30/0 |
| M-05 | 删除 pointer 空值拒绝 → P-09 FAIL | 30/0 |
| M-06 | locked 进入 max=0 quota → P-08 FAIL | 30/0 |
| M-07 | 测试 adapter fixture 按预算 slice → P-12 FAIL | 30/0 |
| M-08 | 删除 F3 检查 → F3-01 FAIL | 30/0 |
| M-09 | 删除 quota-bypass 检查 → P-21 FAIL | 30/0 |
| M-10 | 从总成本剔除 locked → P-19 FAIL | 30/0 |
| M-11 | overcommit 中禁用分支改为永不命中 → P-25、P-26 FAIL | 30/0 |
| MA-01 | closed 目录条目标为 event → AD-EV-x1 FAIL | 32/0 |
| MA-02 | RawUnit 文本 `.slice(0,100)` → AD-EV-x4 FAIL | 32/0 |
| MA-03 | id 改用数组 index → B-07 FAIL（selector 形状身份校验拒绝） | 32/0 |

M-11 的隔离变异保留了 if 结构、只令 disabled 判断恒 false，避免语法破坏；运行时结果复现“禁用项泄漏到 deferred”，P-25/P-26 都变红。第一次试验删除整个 if 块导致隔离变异文件语法错误 `SyntaxError: Unexpected token 'else'`，该次不计 CAUGHT；随后使用可执行的语义变异重跑并取得上述证据。

开发过程中的首轮 adapter 测试还修正了三处夹具/形状：plan 空输入改用 plan-render 的真实占位形状；规则指针断言改为允许其合法非空 pointer；`Event body` 的字符数期望从误算的 11 改为实际 10。它们都在正式 32/0 结果前修正。

## 验收命令

| 检查 | 结果 |
|---|---|
| 四个 JS 源/测试 `node --check` | PASS，退出码 0 |
| unit-policy 真调用 | 30 PASS / 0 FAIL |
| unit-adapters 真调用 | 32 PASS / 0 FAIL |
| M-01..M-11 | 11/11 CAUGHT；恢复副本均 30/0 |
| MA-01..MA-03 | 3/3 CAUGHT；恢复副本均 32/0 |
| `node tools/build-iter5-skin.mjs --check --strict` | `SYNC-OK: sources × generator == lib/client.js` |
| `node tools/run-smoke.mjs --filter=batch3-unit --timeout=180000` | PASS 2 / FAIL 0 / TIMEOUT 0 |
| `git diff --check` | PASS |
| 真 ESM import `unit-policy.js`、`unit-adapters.js` | PASS |

`lib/index.js` 和 `lib/client.js` SHA256 与开工值一致，分别为 `89BCC7E8E38C76B9AF3F65FC1DB4E0401754432C9279416026384A2CB8A82F6A`、`9154599DD272C142DBB3BE83BF3B7D0608CE90575C0091E443920F39F57AECD8`。`policy-v2.js` 保持开工前已存在的修改，本轮未改。

## 未做项与待裁定口径

- **U3 未接线**：任何生产路径均未 import 新 adapter 或 selector；未做真实宿主验证；未跑全量 smoke。
- U0 P-15 要求 event 与 checkpoint 共吃 `event/event` quota；本轮 binder 任务则明确按 `quota.unit === unitKind` 精确匹配，U1.1 F13 也按该精确字段防绕过。这样只有 `event/event` quota 时，checkpoint 会被 binder 视为无匹配并绑定 `@unbounded`。本轮遵照更新的 U2 精确匹配规则，没有私自加 `checkpoint → event` 映射；需在后续接口冻结时明确裁定。
- U0 还定义 `rules.maintenance === false` 时 maintenance 子段不产 unit，并且 registry 有 `ruleModule` unitKind；本轮 U2 的 `read-rules.js` 输入形状（五类规则数组）没有独立 maintenance-child 或 rule-module grouping 字段。Adapter 不合成不存在的来源，也不产 `ruleModule`；需在后续指定 maintenance RawUnit 的已计算来源与稳定身份。
- 日历 adapter 接收调用方已经按工作区隔离并准备好的 entries；它不读 policy 或时钟，因此 `current` 窗口筛选与跨工作区隔离由上游提供正确输入，本轮未新增这层协调器。
- 任务书要求 adapter suite 为 32 项；实现测试正好为 24 + 8。D1 selector suite 为 30 项。没有提交、推送或改版本号。

本轮开始前工作树已有 `policy-v2.js`、`artifacts/e8-visual/e8-7-double-check.json` 修改及多项未跟踪文件；这些内容均保留，未计成本轮改动。
