# 批次3 模块化/API化实施报告（2026-11-16）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-30）
> 工作区 `D:/dsh-auto-memory`｜分支 `preview`｜开工 HEAD **`2aa3835d`**
> 配套：[批次2/3 依赖核对报告](file:///D:/dsh-auto-memory/docs/internal/REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md)

---

## 0. 结论先行：本轮**没有实施任何代码**，这是按裁定的结果

原任务书 §2.B 要求分 P0–P5 实施第三批代码。开工后我核对 `task-30` 的写域，发现它只含三项：

- `docs/internal/REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md`
- `docs/internal/RESULT-BATCH3-MODULAR-IMPLEMENTATION-20261116.md`
- `artifacts/_batch3-modular-implementation-20261116`

**不含 `lib/` 与 `tests/smoke/`**，而 §2.B 的全部实施动作都必须写这两处。我据此上报写域冲突，**未擅自越权改生产代码**。

**Lead 按用户最新裁定回复**（2026-11-16）：

> 「本轮只做测绘与依赖报告，不改代码。不扩写域到 lib/ 或 tests/smoke/；不实施 P0/P1/P2/P3，也不新建契约模块。」

因此本轮交付为：**一份可施工的依赖测绘**，而不是代码。原先规划的 P0–P5 已转为 §4 的任务拆分建议。

---

## 1. 本轮实际产出

| 交付物 | 路径 | 字节 | 行 | sha16 |
|---|---|---|---|---|
| 依赖核对报告 | `docs/internal/REPORT-BATCH2-BATCH3-DEPENDENCIES-20261116.md` | 18050 | 215 | `7584EA8CFB9458BD` |
| 本报告 | `docs/internal/RESULT-BATCH3-MODULAR-IMPLEMENTATION-20261116.md` | （见文末） | — | — |
| 取证指纹 | `artifacts/_batch3-modular-implementation-20261116/evidence/fingerprints.json` | — | — | — |

---

## 2. 本轮实测到的关键事实（依赖报告 §1–§4 的证据基础）

### 2.1 ⚠ 两份文档的 3.0.x 编号不是同一套（阻塞性问题）

| 来源 | 3.0.2 | 3.0.3 | 3.0.5 | 3.0.6 | 3.0.7 |
|---|---|---|---|---|---|
| `DETAIL-BATCH3-IMPLEMENTATION-20261113.md` §1 | 完整规则与维护提醒 | 水位默认值一致 | 定稿与通知可靠性 | 白板与账本裁剪闭环 | 真实回调与回归基础 |
| `REPORT-3.0-INJECTION-PROGRESS-20261113.md` §3 | 精简档位修正 | 通知消费与定稿 | 白板/账本裁剪 | 真实回调 | 联机通知与默认关闭 |

细则 §1 **明令不得直接映射**。⇒ **施工与验收必须用细则 §1 口径**；进度报告只能当「缺陷形态」来源。

### 2.2 3.0.7 两处假绿：本轮逐处复现（可复算）

**缺陷一 `smoke-test-p6a-rules-layer.mjs`**：

```js
// 311 行：shell 只返回 { renderSlimSnapshotPre }
const shell = new Function(... + 'return {' + fnSrc + '};')()
// 337 行：读一个从不存在的键
const fullOut = (() => { try { return shell.renderMemoryDynamic ? ... : '' } catch (_) { return '' } })()
// 339 行：条件含 fullOut === '' ⇒ 恒真
ok(fullOut === '' || fullOut.includes('【用户硬性规则') || ..., '★规则分层仍生效…')
```

`shell.renderMemoryDynamic` 恒 `undefined` ⇒ `fullOut` 恒 `''` ⇒ **断言恒真，零验收价值**。

**缺陷二 `smoke-test-v4-h5-user-portrait.mjs`**：

```js
const makeFn = () => { ... }                              // 151 行：定义工厂
ok(typeof makeFn === 'function', 'E1 renderMemoryDynamic 可被源码抽取')  // 161 行：只断言「是函数」
```

全文 `makeFn()` 调用 **0 次**（`makeFn()()` / `factory()` 亦 0 次）⇒ 抽取器**从未执行**。

### 2.3 各项缺口的当前代码证据

| 子项 | 实测证据 | 缺口 |
|---|---|---|
| 3.0.1 | `rules-layer.js:396 firstLine(max=200)`、`:446 ruleSummaryPre(max=200)`；`index.js:26307` `applyRuleEditPre(engine,'list',{})` 只取 user；`readRulesAggregatePre` 0 命中 | **仍在** |
| 3.0.2 | `ruleSummaryPre` 默认 200 ⇒ human_full 仍逐条截 | **仍在**（维护块位置属 3.0-B） |
| 3.0.3 | `index.js:1196 fullInjectWaterPct: '25,50'` | 需补测解析缺省（本轮未测） |
| 3.0.4 | `composeMemoryEnvelopePre` 4 处；`composeFinalEnvelopePre` **0 命中**；`observeInjection` 仅 1 处 | **仍在** |
| 3.0.5 | `planUpdatePending` 在 `:13834`「取了就清」；`briefDetectSyncPre` 在 `:13552` 候选阶段即调用 | **仍在** |
| 3.0.6 | `#506` 已修**但仅** `:13403/13404`（user/notes）；**plan `:12906` / ledger `:13000` 仍用 `sanitizeForInjection` 缺省 2000** | **仍在** |
| 3.0.7 | 见 §2.2 | **仍在** |
| 3.2 | `event-render.js:331 CHECKPOINT_QUAD_KEYS` 四段映射**已存在**（v6 已修「只存不用」） | **主体已实现**（细则所记缺陷已过时，施工前须重测） |
| 3.3 | `event-render.js:333 cutPre(rawText, CHECKPOINT_ITEM)`，`:75 CHECKPOINT_ITEM=300` | **仍在**（单向头截） |
| 3.4 | `pickT2EventsPre` 有；`eventMaxActiveInInject` 3 处；`selectEventProjectionPre` 0 命中 | 部分；≤8000 口径未明 |
| 3.1 | `collectConsolidationSourcesPre` 等目标 API **0 命中** | **未实现** |

---

## 3. 3.0-B 未定边界（**本轮未替用户定案**）

按裁定「3.0-B 边界不得由实现者猜」，以下 8 类**全部保持未定**，依赖报告 §7 已逐条列全：

| # | 边界 |
|---|---|
| B1 | 预算范围与豁免（50K 单位、full/压缩豁免、rules/must 超额、静态/M6/反思/诊断计费、8000 迁移） |
| B2 | 两份 MEMORY 投递范围（尾部窗口 / 全量 / 非规则投影） |
| B3 | 白板 full/slim 视角（章节、排序、必保正文、无命中兜底、当前任务来源） |
| B4 | 特殊档 `handoff_carry/hang_compensate` 公共修复边界 |
| B5 | 水位缺省切换与旧配置迁移范围 |
| B6 | 3.3 段级规格（现有 300 不等于已批准最终值） |
| B7 | 3.4 ≤8000 是段级还是整帧 |
| B8 | `noticeRemoteEnabled`（细则明确不属 3.0-A；实测 `lib/` **0 命中**，保持默认关闭） |

---

## 4. 后续任务拆分建议（原 P0–P5 的落地形态）

| 序号 | 任务 | 3.0-B 阻塞 | 写域 |
|---|---|---|---|
| **T1** | 3.0.7 回归基础：修两处假绿 + 固定语料/请求键/时序 + 变异必红 | **无** | `tests/smoke/` |
| **T2** | 公共契约：4 个 DTO + profile + 计量骨架 | **无** | 新模块目录 |
| **T3** | 可独立小修：合法桶名、prepare 不消费、plan/ledger 去 2000 预截断 | **无** | `lib/index.js` 单写者、`lib/event-render.js` |
| **T4** | 读取先于指针切换：`readRulesAggregatePre`、旧 CAS 安全后再改摘要、移除逐条 200 | **无** | `lib/rules-layer.js`、`lib/index.js` |
| **T5** | 定稿/通知/最终计量共同验收 | **B1/B2** | `lib/memory-envelope.js`、`lib/index.js` |
| **T6** | 3.1–3.4 按同一最终契约 | **B3/B6/B7** | `lib/event-render.js`、consolidate |

**建议**：T1 → T2 → T3 → T4 可立即排期（无 3.0-B 阻塞）；T5/T6 待边界明示。

---

## 5. 未验边界（如实）

1. **未改任何代码**：`lib/`、`tests/`、`lib/client.js`、皮肤、生成器零改动。
2. **未新建契约模块**、未实施 P0–P3（按裁定）。
3. **未运行任何测试套件**：本轮只读测绘，不产 PASS/FAIL；依赖报告 §2.1 的数字是 task-28/29 已交付实测值的转记，非本轮重跑。
4. **未做真实 HOST**、未启隔离 `DSH_HOME`、未访问 19387、未改生产配置或真实记忆。
5. **未 push / 未发版 / 未迁移 / 未删除**。
6. **3.0.3 水位解析缺省行为未实测**（只确认了 `DEFAULT_CONFIG` 字面值）。
7. **3.3/3.4 段级与整帧口径未定**（B6/B7），本报告不给推荐值。
8. **未做行尾/字节/导出/锁核验**（本轮无代码改动，不适用）。

---

## 6. 行尾与产物

两份报告均为新建 `.md`，UTF-8 + LF（与 `docs/internal/` 既有 Markdown 一致）。
产物目录：`artifacts/_batch3-modular-implementation-20261116/`（`evidence/` + `MANIFEST.json`）。
