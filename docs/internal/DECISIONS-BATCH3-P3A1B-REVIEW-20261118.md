# 批次3 P3-A1b 复核：通过；A1b2 小修后进 P3-B（2026-11-18）

性质：Lead 对 P3-A1b 回执的独立复核。**A1b 通过。** 另发现一处 A1 遗留的判据过期（p6a 两断言），列为 A1b2 小修，在全量回归前完成。

## 0. 结论

| 项 | 结论 |
|---|---|
| A1b 条件冻结 | **通过**。七键清单与后端接管集合由真实抽取互验；四态（有策略只读/删除恢复/无策略可编辑/负路径）与双入口一致性均由 25/0 套件覆盖，含 3 类变异。 |
| effectiveTriggers 收窄 | **通过**。saved-only；无策略/null 返回 null，显式非法策略抛错；生产旧路径仍给 40 / 15 / [25]，四连续真人 FSSS 未变。 |
| 两个红套件 | **已归因并转绿**：cadence-projection 103/0、final-frame 101/0；均按当前契约重建夹具，未改产品行为。 |
| p6a 新发现 | **A1b 未引入，但需 A1b2 修**：`smoke-test-p6a-rules-layer.mjs` 123/2，两处是 A1 有意变更后的判据过期（详见 §3）。**我的 A1/A1b 验收漏跑 p6a，属 Lead 缺口。** |
| 清理 | **通过**。三个临时物已移出仓库外，备份三文件 SHA-256 与回执一致（我逐个复算），原路径均不存在。 |
| 真实宿主 | 仍未验证；A1b2 后进 P3-B。 |

## 1. Lead 独立核实

| 项 | 实测 |
|---|---|
| `lib/client.js` | 27,281 行 / 3,033,480 B / sha256 `895f88adcc7c58a1…` / 纯 CRLF（bareLF 0）/ 14 factory 导出 |
| `lib/index.js` | 30,415 行 / 2,214,027 B / sha256 `f71d8ece…`（与 A1 逐字节一致，A1b 未动后端） |
| `policy-runtime.js` | 62 行 / 2,666 B / LF / sha16 `42ed3bd5`（A1 时 81 行 / 3,541 B） |
| `policy-settings.js` | 998 行 / 70,204 B / LF；frozen 2,571 行 / 360,725 B |
| 生成器 | `SYNC-OK: sources × generator == lib/client.js` |
| 计数 | verify-docs **22 / 87 / 182**；后端导出 **41**；client-loadable **34/0** |

**我复跑**：`delivery-settings-ui` **25/0**、`delivery-policy-runtime` **11/0**、`batch3-cadence-projection` **103/0**、`batch3-final-frame` **101/0**、`r26` **26/0**、`iter5-skin` 26/0、`t1` 59/0、`water` 47/0、`gap` 56/0、`frozen-mirror` 37/0、`client-loadable` 34/0、`i335` 32/0、`parity` 112 键 × 3 面、`settings-sync`/`s2`/`batch-y`/`delivery-backend/cadence-contract/policy-v2/diagnostics`/`tiered`/`inj4`/`inj5`/`bd/ca/rp/cb/contract` 全部退出 0。

**冻结实现核对**（源码级）：
- `ITER5_POLICY_MANAGED_LEGACY_KEYS` 恰为 7 键；`iter5HasSavedDeliveryPolicyPre` 只认 `/config.config.deliveryPolicy` 自有且非 null；外层派生策略不触发冻结。
- 冻结行是 `span[data-dam-policy-legacy-readonly]`（显示服务器旧值 + 「已由投递策略接管」），无 input/select/button、无 `set()` 路径；`iter5PolicyLegacyConfigPre` 把 7 键 + `deliveryPolicy` 从本地草稿回灌为服务器值，`iter5PolicyClearLegacyDraftPre` 清接管键草稿。
- 守卫从真实动态回调抽取 `_deliveryTriggersPre/??` 与水位别名对应的 7 个旧键，与 `effectiveTriggers` 返回键集合及共享常量三向比对；加键/漏键/后端读点漂移三类变异均报红（`tests/...ui.mjs:1148`）。
- `effectiveTriggers({})`/`{deliveryPolicy:null}` 均为 `null`；saved 返回六字段；非法显式策略抛 `deliveryPolicy.presetId: unknown value`。

## 2. 需要记录/更正的小项

1. **parity 110 → 112 的原因未在回执写明**：A1b 在 classic/v4/frozen 新增了 `hangCompensateEnabled`、`hangCompensateTokens` 两个旧控件（为可冻结所需），parity 的 `hasControl`（`cfg.X` 读绑定或 `set('X')`）把它们计入 ⇒ 112。属预期变化，回执应补一句归因；同时提醒：parity 计数是**守卫口径**（读绑定也算控件），不等于「可编辑键数」。
2. `git diff --check` 默认 1,184 + 268 + 2 条仍为 CRLF 在 eol=lf 下的 CR 假红；`core.whitespace=...,cr-at-eol` 退出 0。口径已写明，接受。

## 3. A1b2：p6a 两处判据过期（必须修，修完才跑全量）

`node tests/smoke/smoke-test-p6a-rules-layer.mjs` 实测 **123 PASS / 2 FAIL**（此前 P1 时 125/0；A1 改了 index 的两处有意行为）：

1. **`注入调用方取精简版，且开关可一键回退`**：旧正则要求 `engine.config.snapshotTieredInject === false ? '' : engine.renderSlimSnapshotPre(...)`；A1 已改为 `(_deliveryTriggersPre?.tieredInject ?? engine.config.snapshotTieredInject) === false ? ...`（saved 策略优先、旧键回退）。**这是 A1 的预期行为**，判据需接受「策略读 + 旧键回退」形态，并保留负路径：saved 策略 `tieredInject=false` 必须关掉精简文本、无策略时旧开关仍可回退。
2. **`规则段排在所有参考内容之前`**：断言用全文 `indexOf("'project-notes'")`，而 A1 在 `pushPart` 锁段守卫里新增了 `kind !== 'project-notes'`（锁段不可被旧开关关闭，属 R-E 预期），其字符串出现在规则 push 之前 ⇒ 位置断言假红（实测 19,072 < 58,269 / 7,325）。修法：去掉注释后按**实际 `part('memoryReferences','project-notes', …)` / pushPart 调用**定位，或从 iRules 之后搜索；不得放宽「规则必须在参考内容之前」的意图。

处置：A1b2 只改测试夹具 + 回执补一句 parity 归因，不改产品代码；修完跑 p6a ≥125/0（新增负路径后计数可增）与全量回归。

## 4. P3-B 计划（A1b2 通过后）

- **全量回归**：`--jobs=8 --timeout=180000`，先记基线；FAIL 单跑复验，区分判据过期与真回归。
- **真实宿主**：用隔离 dsh-home + 独立 profile + 自选端口启动（profile 带 `link:D:/dsh-auto-memory`，不碰用户当前 19387 实例）；按既有做法从 `.credentials.yaml` 自签 `dsh-auth-*` cookie 注入浏览器会话，避免 401 白屏。
- **三入口 a11y + 截图**：`settings.section` / `settings.plugins.tab` / `plugins.detail.section`，确认行为与维护分组、投递策略卡片、七键冻结态、删除策略恢复、13 段开关、预览 partial 呈现；窄窗 390px 再查溢出。
- **真实会话注入**：在隔离宿主内触发至少一次真实请求，核对注入帧确实含策略控制下的节奏/水位/硬顶效果与诊断默认关；证据以宿主日志 + 注入回执为准，不以单元套件代替。
- 未验证项（如用户本机 19387 自己的会话）单列，不与隔离宿主结果混写。

## 5. 风险与边界

- A1b 只动前端/运行时读取/测试；`lib/index.js` 与 `policy-v2/cadence/final-frame/dto/project-handoff/preview/diagnostics` 指纹均与 A1 通过值一致 ⇒ 后端行为边界未扩大。
- 模块/单位/事件接管仍属 A2；冻结只覆盖 A1 已接管的 7 键，13 段与其余旧键保持可编辑权威。
- 提交与发版仍待用户决定；本批次未 commit/push/改版本。
