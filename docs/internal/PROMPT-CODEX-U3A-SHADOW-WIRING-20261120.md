# Codex 任务书 · P3-A2 · U3a：生产入口「影子模式」接线（默认关闭，不接管注入）

前置：U1/U2 线已收口（policy 32/0、adapters 35/0；我独立变异双向验证通过）。U3 是**唯一改真实注入**的一步，因此拆成 a/b：
- **U3a（本任务）= 影子**：真实每轮注入照旧，另算一遍单位选择并产出**观测回执**，**绝不改记忆正文**；
- U3b（后续，另派）= 接管（`on` 模式）、`deliveryModule` 实产、真实宿主逐轮对比后翻开关。

## 0. 铁律（违反即返工）

- **不得实现 `on` 接管**：本任务只新增 `off` / `shadow` 两态；出现 `on` 必须被**显式拒绝**（fail-closed），不得静默降级成 shadow。
- **影子期注入正文必须逐字节不变**（开启 diagnostics 时新增的诊断行除外，见 §3.3）。
- **影子永不让当轮变红**：adapter/bind/select 任一抛错 ⇒ 捕获、记 `degradations`、返回空回执，注入继续。
- 不提交、不推送、不改版本号。

## 1. Phase 0：先测绘再写码（回执必须含此节）

**先只读定位并写下答案，再动代码；若结论与下列假设冲突，停手回报，不要硬接。**

1. 每轮注入的真实入口与函数名（预计在 `lib/index.js` 的 `ctx.systemPrompt.context({ text: (context) => … })` 回调内，约 :23994 起）；
2. 该处**当前可直接拿到的源对象**是什么字段/变量（如 `st.sources` / `snap` / `sources`），以及它是否已含 events/rules/plan/handoff/portrait/calendar 六个来源；
3. `state._injectTierPre`（档位标记）如何映射到 U1 的 8 个 phase 字符串；映射表逐行写出；
4. 预算来源：本轮回调内可用的 `injectBudgetChars` / `_fullTierBudget` / slim 预算分别是哪个变量、单位是字符还是 token（`cost.jsChars` 必须对上）；
5. 计划落点：**不改任何返回字符串**的前提下，插入点具体到行号与函数名；
6. 新增配置键后的锁清单：`DEFAULT_CONFIG` 顶层键数（现 182）、哪些测试/文档锁了该数（r26、verify-docs、config-key 计数等），逐项列出。

## 2. 允许改动

| 文件 | 动作 |
|---|---|
| `lib/injection/unit-shadow.js` | **新增**：影子计算 + 回执形状 + 降级 |
| `lib/index.js`（CRLF！） | 改：接 shadow 计算点 + 诊断行 + 配置键 + 校验 |
| `lib/client.js` / `skins/**` | **不改**（本任务无 UI） |
| `tests/smoke/smoke-test-batch3-unit-shadow.mjs` | **新增** |
| 相关锁测试 / 文档 | 按 Phase 0 清单同步重钉 |

`unit-shadow.js` 只依赖 `unit-adapters.js` / `unit-policy.js`；**不得** import `fs`/`path`（纯计算），不得读 policy 之外的状态。

## 3. 行为规格

### 3.1 配置键

- `DEFAULT_CONFIG.unitPolicyMode = 'off'`（新键，字符串枚举 `['off','shadow']`）。
- 设置补丁校验：非枚举值 ⇒ 明确错误（消息含 `invalid-unitPolicyMode`），不静默回退。
- `'on'` ⇒ 明确错误（`unit-policy-on-unimplemented`），**不是** warning。

### 3.2 `unit-shadow.js` 导出

```js
buildUnitShadow({ sources, policy, phase, budget, mode })
// => { mode, computed: boolean, phase, selected, deferred, rejected,
//      cost, budget, truncatedBy, budgetOvercommit, unitIds, degradations }
```

- `mode === 'off'` ⇒ `{ mode:'off', computed:false }`，**不跑任何 adapter**（零开销）。
- `mode === 'shadow'` ⇒ 逐个 adapter 取源（六源 + rules.maintenance 可选）→ `bindUnits` → `selectUnits`；全程 `try/catch`，失败写 `degradations: [{ source, code, message }]` 并返回 `computed:false`。
- `unitIds` **有界**：最多 40 条（超出只计数量，不截断字符串）。
- 纯函数：同一输入两次调用结果 deep-equal；不读时间/随机。

### 3.3 诊断行（唯一允许的注入面变化）

- 仅当 `policy.modules.diagnostics.enabled === true` **且** `unitPolicyMode === 'shadow'` 时，在**诊断块内部**追加一行：
  `unit-policy: phase=<phase> sel=<n>/<total> cost=<jsChars>/<budget.jsChars> trunc=<truncatedBy|none> over=<true|false> deg=<n>`
- `off` 或 diagnostics 关闭 ⇒ 逐字节与现状相同。
- 记忆正文（规则/白板/账本/事件/画像/日历任何段）**不得**因 shadow 改变一个字节。

## 4. 测试（`smoke-test-batch3-unit-shadow.mjs`）

- **S-01** `mode:'off'` ⇒ `computed:false`，且**零 adapter 调用**（用可观测计数器或 spy 证明）。
- **S-02** `mode:'shadow'` + 六源正常 ⇒ `computed:true`、`selected>0`、`cost.jsChars ≤ budget.jsChars`（或 `budgetOvercommit=true`）。
- **S-03** 注入正文不变：同一 state 下 `off` 与 `shadow` 的渲染文本，**剥掉诊断行后逐字节相等**。
- **S-04** 某个 adapter 抛错（喂非法源）⇒ `computed:false`、`degradations` 含该项、**注入文本与 off 相同**（不抛到外层）。
- **S-05** 非法 `unitPolicyMode` ⇒ 设置补丁被拒、错误消息含 `invalid-unitPolicyMode`。
- **S-06** `'on'` ⇒ 被拒、消息含 `unit-policy-on-unimplemented`，且不落盘。
- **S-07** `unitIds` 有界：61 个可选中单元 ⇒ 数组长度 = 40，另有计数 `selected=61`。
- **S-08** 纯函数/幂等：同输入两次 deep-equal；源码零 `fs`/`path`/time/random。
- **S-09** 性能界：单次 shadow 计算 < 15 ms（本机基准，超时即失败；用于防「影子拖慢每轮」）。

## 5. 变异（≥3，隔离副本）

- **MV-01** 去掉 `try/catch` ⇒ S-04 红（shadow 抛到外层）。
- **MV-02** `mode:'off'` 仍跑 adapter ⇒ S-01 红。
- **MV-03** 诊断行在 `off` 时也输出 ⇒ S-03 红。
- **MV-04**（如适用）把 `on` 静默降级为 shadow ⇒ S-06 红。

## 6. 验收出口

1. `node --check` 全部改动文件（含 `lib/index.js`）。
2. `node tests/smoke/smoke-test-batch3-unit-shadow.mjs` ⇒ **9/0**（S-01..S-09）。
3. 既有 `batch3-unit` 两套件仍 32/0 与 35/0。
4. 全量回归 `node tools/run-smoke.mjs --jobs=8 --timeout=180000` ⇒ **FAIL 0**（TIMEOUT 需单跑复验）。
5. `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK。
6. r26 / 配置键计数 / verify-docs 三项按 Phase 0 清单重钉，且**只重钉确实变动的那几处**。
7. `lib/client.js` sha256 与开工前**逐字节相同**（本任务无 UI 改动）。

## 7. 回执

`docs/internal/RECEIPT-BATCH3-U3A-SHADOW-20261120.md`：

- **Phase 0 测绘节**（六问逐条答案，含行号）；
- 落点 diff 摘要（改在哪几行、为什么那里不改返回串）；
- S-01..S-09 逐条结果、MV 红/绿证据；
- 锁重钉清单（文件 + 旧值 → 新值）；
- 物理量（行数/字节/sha16）、未做项（必须写「on 未实现、deliveryModule 未产」）。

## 8. 常见错误（会返工）

- ❌ 把 shadow 算在 `previewDelivery` 里就算完 —— 那是预览端点，不是每轮注入。
- ❌ 用 `await` 引入异步（注入回调必须同步返回）。
- ❌ 为了拿源而新增磁盘 IO 或重复 refresh。
- ❌ 影子失败时抛异常或把当轮注入清空（必须降级为 off 文本）。
- ❌ 顺手把 `unitPolicyMode` 做成 `true/false` 布尔（后续无法加 on）。
- ❌ 新键只加进 `DEFAULT_CONFIG` 不改锁 —— 会让 r26/计数锁**假绿**。
