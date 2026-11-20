# Codex 任务书 · P3-A2 · U3a-2：影子回执（refresh 内计算 + 只读端点暴露）

前置：
1. U3a Phase 0 测绘回执已由 Lead 复核，结论**成立**（见 `docs/internal/RECEIPT-BATCH3-U3A-SHADOW-20261120.md`）。
2. **三条阻塞问题已裁定**，本任务按 `docs/internal/RULING-BATCH3-U3A-SOURCES-20261120.md` 执行；该裁定**优先于**旧任务书 `PROMPT-CODEX-U3A-SHADOW-WIRING-20261120.md` 的 §2/§3/§4。

## 0. 与旧任务书的差异（先读，避免按旧书写）

| 旧任务书 | 本任务（已裁定） |
|---|---|
| 新增 `unitPolicyMode` 配置键 | ❌ **不加**（配置键保持 182，不牵动任何锁） |
| shadow 行插入 renderer 诊断段 | ❌ **不做**（不跨层传 receipt，注入正文一个字节不变） |
| 影子吃「六源统一 DTO」 | ⭘ 改为 **refresh 内就地组装**（源是局部变量，不常驻内存） |
| 按最终投递帧计算 | ⭘ 改为**单一显式假设** `phase='human_full'`、`budget=config.injectBudgetChars`，回执里写 `assumed` |
| `on` 模式 | ❌ 本任务完全不出现 `on`（留 U3b） |

## 1. 计算点（唯一）

`lib/index.js` 的 `refreshEventStatePre()` 内（约 :10415-10560），**在该函数局部变量仍存活处**：

- events：:10427 `const events`
- T2 picks：:10429
- rules aggregate：:10523 `_rl = extractRulesLayerPre(...)`
- portrait 来源：:10553-10559 的 `userPercept` 汇总处
- plan / handoff：`this.state.planText` / `this.state.latestHandoffText`（文本；用既有纯解析器还原，见 §2）
- calendar：`this.state.calendarText` + `this.parseCalendar(...)`（:16679）

**禁止**：新增磁盘读取、重复 `resolvePaths`、再开一次 `refresh`、把六源 DTO 写进 state。

## 2. 允许使用的既有纯解析器（复用，不新写第二份）

| 来源 | 用法 |
|---|---|
| handoff 文本 | `parseLedgerSectionsPre`（`lib/event-write.js:671`）或 `parseHandoffLedgerPre`（`lib/handoff-anchor.js:41`）→ 映射成 `{sections:[{title,body}]}` |
| calendar 文本 | `this.parseCalendar(text)` → `{entries}` |
| rules | 直接用 `_rl`（`extractRulesLayerPre` 已是结构）+ 可选 `maintenance` 文本 |
| events | 直接用 `events` 数组 |
| portrait | 直接用 refresh 内的 `userPercept` 汇总结构 |
| plan 文本 | 优先：按 `planSpecForTierPre(...).sections` 的节名在文本中切段；**切不出** ⇒ 整块产 1 个 `planSection` 单元 + 回执 `degradations: [{source:'plan', code:'plan-granularity-degraded'}]`（不得伪造节结构） |

## 3. 新文件 `lib/injection/unit-shadow.js`

```js
export const UNIT_SHADOW_VERSION = 1

export function buildUnitShadow(input)
// input = { rawSources, policy, phase, budget, now }
// rawSources = { events, rules, planText, handoffText, portraitItems, calendarEntries, maintenance? }
// => 回执（形状见 RULING §3）
```

要求：
1. **纯函数**（除 `now` 可注入）：不 import `fs`/`path`；不读时间（用 `input.now`）、不读随机、不 console。
2. 内部依次：组装 adapter 输入（§2 的映射）→ `bindUnits` → `selectUnits`；**逐源 try/catch**，失败写 `degradations` 并继续其余源。
3. 任一 adapter/bind/select 抛错 ⇒ 整体 `computed:false`（但 `degradations` 保留），**绝不外抛**。
4. 回执有界：`unitIds` ≤ 40；序列化 ≤ 4 KB（超了只截 `unitIds`，不改计数）。
5. 预算入参：`{ jsChars: config.injectBudgetChars, utf8Bytes: config.injectBudgetChars * 3 }`（字符→字节的既有口径，若仓库已有同款换算函数则复用并在回执注明）。

## 4. 接线（`lib/index.js`，CRLF，改动必须最小）

1. refresh 内：`if (policy.modules.diagnostics.enabled === true)` ⇒ `try { this.state._unitShadowPre = buildUnitShadow({...}) } catch (_) {}`。**默认关闭 ⇒ 零调用、零开销。**
2. 回执只存 `state._unitShadowPre`（有界对象），**不写任何文件**。
3. `POST /preview` 响应加一个字段：`unitShadow: (runtime && runtime.state && runtime.state._unitShadowPre) || null`（在 :29268 附近）。
4. `debugInfo()` 同源加 `unitShadow`（只读投影，不重算）。
5. **不改** `renderMemoryDynamic`、不改诊断段、不改任何返回字符串、不改 `client.js`。

## 5. 测试 `tests/smoke/smoke-test-batch3-unit-shadow.mjs`（10 条）

- **S-01** `diagnostics.enabled=false` ⇒ 真 refresh 后 `state._unitShadowPre` 不存在（未计算）。
- **S-02** `enabled=true` + 夹具 store（≥3 个 active 事件、规则文本、白板/账本/日历）⇒ 回执 `computed:true`，`counts.raw>0`、`counts.selected>0`。
- **S-03** 注入正文不变：同一夹具下 `enabled=false` 与 `enabled=true` 两次 `renderMemoryDynamic` 输出**逐字节相等**（本任务不插诊断行）。
- **S-04** 某源非法（如 events 塞字符串）⇒ `computed:false` 或该源进 `degradations`，且 refresh 不抛、`state.eventCardsText` 仍正常。
- **S-05** 预算：`cost.jsChars <= assumed.budget.jsChars`（除非 `budgetOvercommit=true`），并断言 `assumed.phase==='human_full'`。
- **S-06** 有界：构造 61 个可选中单元 ⇒ `unitIds.length===40` 且 `counts.selected===61`；序列化长度 ≤ 4096。
- **S-07** 幂等/纯：同一 `rawSources` 两次调用（同 `now`）deep-equal；源码零 `fs`/`path`/`Date.now`/`Math.random`（用源码扫描 + 一次真调用双证）。
- **S-08** 端点暴露：起最小路由上下文调 preview handler（或直接调其内部函数），响应含 `unitShadow`，`enabled=false` 时为 `null`。
- **S-09** 配额生效：夹具里给 `events` 配 `{unit:'event',scope:'event',max:1,strength:'hard'}` ⇒ 回执 `counts.selected` 中被事件族占用的数量为 1、其余进 `rejected`（`reason:'quota-exhausted'`），且 `truncatedBy==='quota'|null` 与实际一致。
- **S-10** 性能：单次 `buildUnitShadow` < 15 ms（本机；超时失败）。

## 6. 变异（≥4，隔离副本）

- **MV-01** 去掉尝试/降级（`try/catch`）⇒ S-04 红。
- **MV-02** 把 `enabled===true` 门槛写反/去掉 ⇒ S-01 红。
- **MV-03** 在回执里截断 `unitIds` 之外还改写计数 ⇒ S-06 红。
- **MV-04** 让 refresh 在 shadow 抛错时外抛 ⇒ S-04 红（refresh 失败）。
- **MV-05** 把 `assumed.phase` 写成 `'auto'` 或不写 ⇒ S-05 红。

## 7. 验收出口

1. `node --check` `unit-shadow.js` 与 `lib/index.js`。
2. `node tests/smoke/smoke-test-batch3-unit-shadow.mjs` ⇒ **10/0**。
3. 既有 `batch3-unit` 两套件仍 **32/0**、**35/0**。
4. 全量回归 `--jobs=8 --timeout=180000` ⇒ **FAIL 0**（TIMEOUT 单跑复验）。
5. `node tools/verify-docs.mjs` ⇒ **22 / 87 / 182**（配置键仍 182，不得变）。
6. `node tests/smoke/smoke-test-r26-cross-layer.mjs` ⇒ 26/0（长度锁按实际重钉并在回执写明旧→新）。
7. `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK；`lib/client.js` sha256 与开工前相同。

## 8. 回执

`docs/internal/RECEIPT-BATCH3-U3A-2-SHADOW-RECEIPT-20261120.md`：落点行号、10 条用例结果、5 条变异红/绿、`state._unitShadowPre` 的一条真实样本（脱敏）、锁重钉清单、未做项（写「on 未实现 / deliveryModule 未产 / 未做真宿主」）。

## 9. 常见错误（会返工）

- ❌ 又把 `unitPolicyMode` 加回来（会牵动 182 与五份文档）。
- ❌ 把六源 DTO 挂到 state 上「方便一下」。
- ❌ 在 renderer 里插诊断行（本任务明确不做）。
- ❌ 把 `parseCalendar` 之外的日历逻辑再写一份。
- ❌ 影子失败时让 refresh 抛错（refresh 是 fire-and-forget 热路径）。
- ❌ 为了 S-03 去改渲染分支（应当零改动即通过）。
