# 死键普查 + slimCheckpointCount 溯源（2026-11-08）

> **性质**：只读调查。本轮**未改动** `lib/`、`tests/`、`tools/` 任何字节，未运行任何生成器。
> **输入**：`artifacts/_deadkey-list.json`（179 个键，Lead 预先导出）
> **产出**：本文件（`docs/internal/DEADKEY-AUDIT-20261108.md`），全仓唯一新增文件。

---

## 0. 结论速览

| 项 | 数值 | 分母 | 占比 |
|---|---|---|---|
| 普查键数 | 179 | — | — |
| **死键（生产读取点 = 0）** | **9** | 179 | **5.03%** |
| ├ 全仓零读取（连测试都不读值） | 5 | 179 | 2.79% |
| └ 仅测试断言默认值 | 4 | 179 | 2.23% |
| 单点键（生产读取点恰 = 1） | 9 | 179 | 5.03% |
| **生产读取点 ≤ 1 合计** | **18** | 179 | **10.06%** |

自检两项均通过：

- **`slimCheckpointCount` 被判为死键**（生产读取点 0）。
- **`fullInjectTokenGap` / `fullInjectOnCompact` 不在 179 里**（确已被删）。

同批 6 键（c3309c54）现状：**2 删 / 1 死 / 3 活** —— 明细见 §1.4。

### 0.1 方法论前提：任务书建议的计数口径在本仓会失效

任务书建议「`src.split(key).length - 1` ≤ 1 即死键」。实测反例（同一份 `lib/index.js`）：

| 键 | index.js 原始出现 | 生产读取点 | 原始计数为何骗人 |
|---|---|---|---|
| `panelAllowedHosts` | **179** | **1** | 178 次是**同名局部变量** `const panelAllowedHosts = parseAllowedHostsPre(...)`；只有 `:25861` 的 `engine.config.panelAllowedHosts` 是真读配置 |
| `hangCompensateEnabled` | 7 | 2 | 5 处在注释 / JSDoc 里（含 `★F7` 设计说明） |
| `slimPlanChars` | 2 | **0** | 2 处都是注释（废弃说明） |
| `slimCheckpointCount` | 1 | **0** | 唯一一处就是定义行本身 |
| `maxPacketItems` | 1 | **0** | 唯一一处就是定义行本身（测试里的读取不计入生产） |

⇒ 本报告的「生产读取点」一律**排除**：①定义行自身 ②整行注释 / 块注释 / JSDoc 内的行 ③对象字面量键名（`key:`）④数组键表里的键名字符串（`['key', ...]`）⑤测试里当字符串用的键名 ⑥**同名局部变量**（见上表 `panelAllowedHosts`）。
⇒ 保留计入：`a.key` / `a?.key` / `a['key']` / `safeGet(cfg, 'key')` 四种真实取值形态，**外加**经 `config[变量]` 间接取值的键（逐个人工核实，6 个，见 §1.3）。

> ⚠️ 普查工具的两个实测陷阱（本报告第一版曾因此给出错误结论，已修正）：
> 1. **同名字符串 vs 取值**：`'panelAllowedHosts'` 出现在 `const panelAllowedHosts = ...` 行里，正则会把变量声明当配置读取。
> 2. **getter 参数嵌套**：`safeGet(configOf(), 'teamPushPath')` 的参数里含嵌套括号，用 `getter\s*\([^)]*$` 这类「到第一个右括号为止」的前瞻会**漏判**——实测漏掉了 `team-sync.js:334`、`team-auth.js:225/229` 等多处真读取。正解是**整行匹配 getter 名**，不看括号层级。

---

## 1. 任务 A：179 键全量死键普查

### 1.1 扫描口径（可复算）

扫描范围：

| 目录 | 文件数 | 说明 |
|---|---|---|
| `lib/index.js` | 1 | 定义所在：28,769 行 / 2,077,967 B（CRLF） |
| `lib/*.js`（除 index.js） | 143 | 其他后端模块 |
| `tests/smoke/*.mjs` | 584 | 含 `_` 前缀脚手架 |
| `tools/*.mjs` | 107 | 含 probe / verify-docs / build-iter5-skin |
| **合计** | **835** | — |

每个键、每处命中的判定流程：

1. **词边界过滤** —— 命中位置前后不得是 `[A-Za-z0-9_$]`（否则 `teamAuditEnabledX` 会污染 `teamAuditEnabled`）。
2. **定义行剔除** —— `lib/index.js` 中行号 == `_deadkey-list.json` 声明行 ⇒ 记 `def`。
3. **注释剔除** —— 整行 trim 后以 `//` / `*` / `/*` 开头，或落在跨行块注释内 ⇒ 记 `comment`。
4. **取值形态判定** —— 向前跳过空白后：
   - 前一字符是 `.` 或 `]` ⇒ `prop`（`cfg.key` / `cfg[k]['key']`）
   - 前一是引号、再前是 `[`，且 `[` 之前是标识符 / `)` / `]` ⇒ `prop`（`obj['key']` / `f()['key']`）
   - 前一是引号、再前是 `[`，但 `[` 之前是行首或 `=` / `(` 等 ⇒ `objkey`（数组键表，**不计**）
   - 前一是引号，且**该行出现 `safeGet(` / `getConfig(` / `cfgGet(` / `readCfg(` / `cfgHas(` / `safeCfg(`** ⇒ `strget`（真读取，**计入**）
   - 后跟 `:` ⇒ `objkey`（对象字面量键名，**不计**）
5. **同名局部变量剔除** —— 命中处不是 `X.config.key` / `X.config['key']` 形态、也不匹配第 4 步任何读取形态，且同文件存在同名 `const/let` 声明 ⇒ 判为局部变量，**不计**（`panelAllowedHosts` 的 178 次即由此排除）。
6. **间接取值补齐** —— 人工核实 6 个键经变量间接读取（§1.3），各补 1 个读取点。

**定义行自检**：179 个键声明的行号，逐个用 `^\s{2}<key>\s*:` 回验实际源码行 ⇒ **0 处不符**。
**逐条人工复核**：9 个死键的**每一处**出现都逐行打印核对（§4 复算命令 ③），确认无一处是取值形态。

### 1.2 死键清单（9 个）

| 键名 | 定义行 | index.js 总出现 | 其他文件命中 | 前端接线 | 注释行 | 建议 |
|---|---|---|---|---|---|---|
| `slimPlanChars` | 990 | 2 | — | 0 | 3 |
| `slimLedgerChars` | 991 | 2 | — | 0 | 3 |
| `slimCheckpointCount` | 1169 | 1 | — | 0 | 0 |
| `softInjectionEnabled` | 1305 | 1 | — | 0 | 0 |
| `streamingInterruptionEnabled` | 1357 | 1 | — | 0 | 0 |
| `maxPacketItems` | 1359 | 1 | tests×1 | 0 | 0 |
| `maxPacketChars` | 1361 | 1 | tests×1 | 0 | 0 |
| `packetTtlSteps` | 1363 | 1 | tests×1 | 0 | 0 |
| `injectionCooldownSteps` | 1365 | 1 | tests×1 | 0 | 0 |

分组说明：

**A 组 · 全仓零读取（5 个）** —— `slimPlanChars` / `slimLedgerChars` / `slimCheckpointCount` / `softInjectionEnabled` / `streamingInterruptionEnabled`。连测试都只用到键名字符串，没有任何代码取过它们的值。

**B 组 · 仅测试断言默认值（4 个）** —— `maxPacketItems` / `maxPacketChars` / `packetTtlSteps` / `injectionCooldownSteps`。唯一读取点是 `tests/smoke/smoke-test-context-observer.mjs:136`：

```js
if (cfg.maxPacketItems !== 2 || cfg.maxPacketChars !== 800 || cfg.packetTtlSteps !== 2 || cfg.injectionCooldownSteps !== 3) {
  throw new Error('packet budget defaults drifted')
}
```

⇒ 这 4 个键的产品语义（MemoryPacket 条目数 / 字符预算 / TTL / 注入冷却）**没有任何消费者**。该断言只锁「默认值没漂」，不构成功能存在证据（本仓「恒真守卫」家族）。`maxPacketItems` 定义行注释仍写「MemoryPacket 最大条目数」，但 `MemoryPacket` 在本仓已无对应渲染实现。

**已有自带标注的死键**（部分此前已被发现，只是没删）：

| 键 | 定义行注释原文（节录） |
|---|---|
| `slimPlanChars` / `slimLedgerChars` | 「⚠️ **已废弃（2026-10-24 v4 批次 G）**：… 但**从未接通**（全仓 0 处读取，只有定义行 + 一行注释）… 采用**废弃**而非补实现」（`lib/index.js:982-989`） |
| `softInjectionEnabled` | 「★v3.1.3 审计标注：本键当前**无消费者**（全 lib/ 零读取点、设置页零控件）—— 属保留字段」（`lib/index.js:1303-1304`） |
| `streamingInterruptionEnabled` | 仅「流式中断/恢复实验。」（`lib/index.js:1356`），**无**无消费者标注 |

### 1.3 单点键清单（9 个，生产读取点恰 = 1）

| 键名 | 定义行 | index.js 总出现 | 唯一读取点 | 前端接线 |
|---|---|---|---|---|
| `eventMaxActiveInInject` | 776 | 3 | lib/index.js:10047 | 0 |
| `eventCatalogChars` | 777 | 3 | lib/index.js:10113 | 0 |
| `eventUnarchivedScanTtlMs` | 782 | 3 | lib/index.js:10287 | 0 |
| `subagentReasoningEffortShort` | 837 | 2 | lib/index.js:2727 | 0 |
| `subagentReasoningEffortLong` | 838 | 3 | lib/index.js:2727 | 0 |
| `panelAllowedHosts` | 1080 | 179 | lib/index.js:25861 | 0 |
| `hangCompensateTokens` | 1172 | 3 | lib/index.js:23790 | 0 |
| `teamMemberName` | 1477 | 2 | lib/client.js:15715-15750 | 泛读 |
| `teamAuditEnabled` | 1482 | 2 | lib/client.js:15715-15750 | 泛读 |

其中 **6 个是变量间接取值**（正则扫不到 `cfg.<key>` 形态，必须人工核实）：

| 键 | 间接读取点 | 源码 |
|---|---|---|
| `subagentReasoningEffortLong` / `Short` | `lib/index.js:2727` | `const laneKey = lane === 'long' ? 'subagentReasoningEffortLong' : lane === 'short' ? 'subagentReasoningEffortShort' : ''` → `config[laneKey]` |
| `noteCapacityChars` / `userCapacityChars` | `lib/index.js:4099`、`:4102`、`:9531` | `for (const key of ['noteCapacityChars','userCapacityChars']) { const raw = Number(this.config[key]) }` |
| `workbenchLoopLong` / `Short` | `lib/index.js:17675` | `const key = lane === 'long' ? 'workbenchLoopLong' : 'workbenchLoopShort'; const raw = Number(this.config[key])` |

> 这 6 个键不在单点表里（它们经间接读取后 prod ≥ 1，其中 `noteCapacityChars` / `userCapacityChars` / `workbenchLoop*` 另有前端控件 ⇒ prod ≥ 2）。列出是为了给后续工具做白名单。

⇒ **判据提示**：纯正则 `cfg\.<key>` 普查会把这 6 个键**误判为死键**。任何后续死键工具都必须把它们白名单化，或改为「先收集键名字符串字面量，再看是否被 `config[变量]` 消费」。

### 1.4 同批 6 键（c3309c54）现状核对

| 键 | 现状 | 证据 |
|---|---|---|
| `fullInjectTokenGap` | **已删**（P2 取代） | 不在 179 里；`git log -S` 命中 c3309c54（加）与 5e1cf8b5（删）；P1 测试 `:75-79` 注释「已被 fullInjectWaterPct 取代」 |
| `fullInjectOnCompact` | **已删**（T3，2026-10-30） | 不在 179 里；`lib/index.js:1173` 注释「★T3（2026-10-30）：删除死键…全仓 0 读取点，连前端都没接线」；P1 测试 `:98` 有正向守卫「不得存在」 |
| `slimCheckpointCount` | **死键**（0 读取点） | 见 §1.2 与任务 B |
| `hangCompensateTokens` | 活，单点 | `lib/index.js:23790` `Number(_cfgNow.hangCompensateTokens) || 300000` |
| `hangCompensateEnabled` | 活，双点 | `lib/index.js:23248`、`:23789` |
| `fullInjectSlimBudgetChars` | 活，双点 | `lib/index.js:12516`、`:13145` |

⇒ **6 键中：2 删 / 1 死 / 3 活。** `slimCheckpointCount` 是唯一「既没被删、也从没被消费」的一个。

### 1.5 附带发现：宿主零读取但前端有控件（9 个）

这 9 个键**不在死键名单里**（`client.js` 真读了它们、渲染了控件），但**宿主 `lib/` 侧零读取** ⇒ 用户拨动开关后写进配置，后端不产生任何行为。属「界面在、能力不在」，与死键不同类但同样值得登记：

| 键名 | 定义行 | 前端读取点 | 测试读值 |
|---|---|---|---|
| `settingsEntryInDsSettings` | 808 | 4 | — |
| `settingsEntryInPluginsPage` | 809 | 4 | — |
| `welcomeTourEnabled` | 1192 | 10 | — |
| `locale` | 1202 | 14 | 61 |
| `externalInjectionChars` | 1209 | 6 | — |
| `globalBriefUnattended` | 1393 | 3 | — |
| `teamShowMemberBadges` | 1445 | 1+泛读 | — |
| `teamMemberName` | 1477 | 泛读 | — |
| `teamAuditEnabled` | 1482 | 泛读 | — |

> 注：`teamShowMemberBadges` / `teamMemberName` / `teamAuditEnabled` 的读取经 `renderTeamSettings` 的 `cfg[key]` 泛读循环完成（`lib/client.js:15715-15750`，`TEAM_SETTING_KEYS` 键表 25 项），故「前端读取点」列标「泛读」。

---

## 2. 任务 B：`slimCheckpointCount` 溯源

### 2.1 三份文档逐字摘录

#### 2.1.1 `artifacts/INJECTION-THROTTLE-DECISION-2026-10-26.md`（决定文档，283 行）

**L136-L145（配置键表，6 键全表逐字）**：

```text
## 6. 新增配置键（6 个）

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| fullInjectTokenGap | integer | **250000** | 两轮完整版之间新增输出 token 的间隔 |
| slimCheckpointCount | enum(3/5/7) | **3** | 精简版给「当前事件最近 N 条检查点」 |
| hangCompensateTokens | integer | **300000** | 挂机代位补偿阈值 |
| fullInjectOnCompact | boolean | **true** | 压缩后是否注完整版（F5） |
| fullInjectSlimBudgetChars | integer | **3000** | 精简档（F2/F4）总字符预算 |
| hangCompensateEnabled | boolean | **false** | F7 挂机代位补偿总开关（用户要求默认关） |
```

**F2 / F4 档原文**：

- L47（F2 定义）：`| **F2** | **用户发声精简版** | 用户说话，但距上次完整版新增 **<250k token** |`
- L49（F4 定义）：`| **F4** | **运行中精简版** | 非人消息，且未轮到 F3 |`
- L90（§4 逐段归属矩阵，第 9 段 event-cards）：`| 9 | event-cards | ● | ● 当前事件 | ● | ◐ 当前事件 | ● | ● | ● |`
  ⇒ **F2 档「● 当前事件」（必给、不可裁）、F4 档「◐ 当前事件」（按档位条件给）** —— 这两处正是 `slimCheckpointCount` 理应生效的档位。
- L125（§5 用户面归属）：`| **用户规则**（memory_rules） | **F1 全文 / F3 全文 / F4 标题+条数** | 规则是红线。但**精简版不全带**（实测用户规约 4,847 + 项目规约 2,000 ≈ 6,800，塞进 3,000 预算等于没精简）⇒ F4 只给「你有 N 条硬约束，动手前 memory_rules 查」 |`

**§11 分期计划原文（L243-L252）**：

```text
## 11. 分期计划

| 期 | 内容 | 依赖 |
|---|---|---|
| **P1** | 6 个配置键 + 文案修正（fSnapGapHint）+ 白板按节投递 | 无 |
| **P2** | 七档状态机重构（F1-F6） | P1 |
| **P3** | semantic-recall 预留位 + F2/F1 内容差异化 | P2 |
| **P4** | F7 挂机代位补偿（默认关）+ 专门的视觉 Agent 测试章程 | P2 |

> P1 可独立交付且零风险；P2 是主体；P4 用户明确「一次性做完但开关默认关」。
```

#### 2.1.2 `artifacts/PROMPT-INJECTION-THROTTLE-P1-2026-10-26.md`（P1 施工 prompt，200 行）

**L44-L67（T2 任务原文，逐字）**：

```text
### T2 · 新增 6 个配置键

**位置**：`lib/index.js` 的 `DEFAULT_CONFIG`（约 L760-900 区）

**新增**：
/** ★2026-10-26（记忆中拟合裁定）：两轮「用户发声完整版」之间新增输出 token 的间隔。0=禁用 token 节流（退回按轮）。 */
fullInjectTokenGap: 250000,
/** 精简版给「当前事件最近 N 条检查点」。只允许 3/5/7，非法值回落 3。 */
slimCheckpointCount: 3,
/** 挂机代位补偿阈值（累计输出 token）。仅当 hangCompensateEnabled=true 时生效。 */
hangCompensateTokens: 300000,
/** 压缩后是否注入完整版（F5）。 */
fullInjectOnCompact: true,
/** 精简档（F2/F4）总字符预算。 */
fullInjectSlimBudgetChars: 3000,
/** 挂机代位补偿总开关。★默认 false（用户裁定：先做但默认关，更保险）。 */
hangCompensateEnabled: false,

**验收**：
- 6 个键全部在 DEFAULT_CONFIG 中可读到，类型正确。
- `slimCheckpointCount` 传 4 或 999 时回落 3（负路径）。
```

**L5（范围声明原文）**：
> `**范围**：本 prompt 只覆盖 **P1**（低风险、可独立交付）。P2/P3/P4 另发。`

#### 2.1.3 `artifacts/TEST-CHARTER-INJECTION-THROTTLE-2026-10-26.md`（测试章程，201 行）

**全文对 `slimCheckpointCount` / 事件检查点的命中：0 处。**

仅 2 处含「检查点」字样，且**语义完全不同**（指视觉 Agent 的测试检查项，不是事件检查点）：

- L132：`### 4.4 视觉 Agent 专用检查点`
- L182：`| **P4** | E8/E9 · L4 全部 S1-S6 · 视觉Agent 4 条检查点 |`

章程 §1.3 的七档矩阵用例（C1-C19）与 §2.2 的端到端场景（E1-E9）**没有一条涉及「精简版给 N 条检查点」**。⇒ 这个键从设计到测试，**从未被赋予过一条验收判据**（除 P1 那条「传 4 或 999 回落 3」，而那条也没实现 —— 见 §2.3）。

### 2.2 后续批次有没有排期过它？—— 没有

逐份核对 P1/P2/P3/P4 验收记录的「未做 / 下一步」清单：

| 文档 | 「未做 / 下一步」原文 | 含 `slimCheckpointCount`？ |
|---|---|---|
| `P1-ACCEPTANCE-2026-10-26.md` L171 | 「**下一步**：P2（七档状态机重构）—— 本批只落了配置键与「按节投递」基础设施，七档状态机尚未接入。」 | 否 |
| `P2-ACCEPTANCE-2026-10-26.md` §8（L161-177） | 「F1 内容差异化 → ⬜ P3」「semantic-recall 预留段 → ⬜ P3」「F7 挂机代位补偿 → ⬜ P4」 | **否** |
| `P3-ACCEPTANCE-2026-10-26.md` §7（L172-181） | 「F7 挂机代位补偿 → ⬜ P4」「规则段按档位差异化 → ⚠️ 谓词已备，尚未接入」「画像段按档位差异化 → ⚠️ 尚未接入」 | **否** |
| `P4-ACCEPTANCE-2026-10-26.md` §5（L139-152） | 七档完成度表只有「白板 / 规则 / 画像 / semantic / F7」五列，**没有「检查点」列**；L152 结论「**⇒ 七档的内容侧全部落地。**」 | **否** |
| `P4-ACCEPTANCE-2026-10-26.md` §6（L156-162） | 「F5『刚才压缩了』提示」「F7 视觉 Agent 测试章程」「F7 真机验证」 | **否** |

⇒ **P2/P3/P4 三份验收记录的「未做」清单里，从未出现过这个键。** P4 甚至已宣告「七档的内容侧全部落地」。

### 2.3 代码侧铁证：连 P1 自己的验收判据都没实现

P1 施工 prompt L67 要求：「`slimCheckpointCount` 传 4 或 999 时回落 3（负路径）」。实测：

| 检查项 | 结果 |
|---|---|
| `lib/index.js` 中 `[3, 5, 7]` 字面量 | **0 处** |
| 任何 `slimCheckpoint` 相关的 clamp / 校验函数 | **0 处** |
| `slimCheckpointCount` 在 `lib/` 的读取点 | **0 处** |
| `slimCheckpointCount` 在 `lib/client.js` 的读取点 | **0 处** |
| 全仓对它的唯一「使用」 | `tests/smoke/smoke-test-v5-p1-inject-throttle.mjs:80` 的键名字符串 `["slimCheckpointCount", "3"]`（断言定义存在且默认值 = 3） |

⇒ 「传 4 或 999 回落 3」这条负路径**从未存在**。P1 验收记录 §4 的 B 组也只写「T2 六键 + T4 两键的默认值」——只验默认值，没验 clamp。

### 2.4 数据侧铁证：它描述的功能连数据源都没有

键的语义是「精简版给『**当前事件最近 N 条检查点**』」。实测精简版渲染器 `renderSlimSnapshotPre`（`lib/index.js:10469` 起，253 行）实际产出：

```js
// lib/index.js:10599-10610
const _t1 = (_slimNeedsHumanCtx && Array.isArray(s.slimEventT1)) ? s.slimEventT1 : []
const _evTotal = _slimNeedsHumanCtx ? Math.max(0, Number(s.slimEventTotal) || 0) : 0
if (_t1.length) {
  let _one = String((_t1[0] && _t1[0].line) || '').replace(/\s*\n+\s*/g, ' ').trim()
  if (_one.length > _EVT_LINE_MAX) _one = _one.slice(0, _EVT_LINE_MAX - 1) + '…'
  if (_one) {
    let _line = '\n[当前事件] ' + _one
    if (_evTotal > 1) _line += '（共 ' + _evTotal + ' 个事件）'
    _slimParts.push(_line)
  }
}
```

- `_EVT_LINE_MAX = 60`（`:10588`）⇒ 只给 **1 个事件、1 行、60 字**，不是「N 条检查点」。
- `slimEventT1` 的数据形状（`lib/index.js:10060-10068`）是 `{ id, line }` 的**每事件一行投影**，**根本不携带 checkpoints 数组**：

  ```js
  this.state.slimEventT1 = events
    .filter((e) => e && e.status === 'active')
    .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
    .map((e) => {
      let line = ''
      try { line = String(renderT1Pre(e) || '') } catch (_) { line = '' }
      if (!line) line = String((e && e.name) || '')
      return { id: String((e && e.id) || ''), line: line.replace(/\s*\n+\s*/g, ' ').trim() }
    })
  ```

⇒ 要实现「最近 N 条检查点」，必须先让 `slimEventT1` 携带 checkpoints（或另建投影）。**这一步从未做过** —— 所以不是「读取点漏了」，而是**功能与数据源双双不存在**。

**唯一形似的实现**：`lib/index.js:12103` 的 `for (const e of t1.slice(0, 3))` —— 硬编码 3，位于 `buildReadOverviewPre(agent)`（`:12090`），产出 `[最近事件]` 段，**不是**精简版注入路径。它的 3 与默认值 3 数值巧合，但**不读键**。

### 2.5 结论：「P1 加了键、后续没做」还是「从头就只打算加键」？

**都不是。准确结论是第三种：P1 明确把消费点押给了后续批次，但那个消费点从未进入任何批次的正式任务清单 —— 是一条「孤儿需求」。**

三条证据链：

**① P1 时是有消费意图的，不是纯粹为加键而加键。** `lib/index.js:1137-1146` 的代码注释逐字写：

```text
// ★v5-P1（2026-10-26 记忆拟合裁定）：**七档注入矩阵**的 6 个配置键。
//   ★P1 只落配置键（本批）；P2 才接状态机。故此处**只定义不消费**，
//     消费点在 P2 的七档状态机 —— 这样 P1 可独立交付且零行为变化。
```

⇒ 「只定义不消费」在 P1 是**有意的、写进注释的设计**，理由是「P1 可独立交付且零行为变化」。**不能判为「从头就只打算加键」。**

**② 但它押注的 P2 并没有接手它。** 决定文档 §11 给 P2 的范围是「七档状态机重构（F1-F6）」；`P2-ACCEPTANCE` 实际只做了 F1 触发口径（水位阈值），并在 §8 把「内容差异化」整体推给 P3；P3 只做了「白板投递差异化 + semantic-recall」两件事（§7 原文：「P3 已完成**白板投递差异化**与 **semantic-recall**（用户明确命名的两件事）」）；P4 做规则段/画像段/F7，并宣告「七档的内容侧全部落地」。

⇒ 「精简版给 N 条检查点」这件内容侧的事，在 P2 被推给 P3、在 P3 的清单里不存在、在 P4 的完成度表里连列都没有。**它在三次交接中每一次都被遗漏，且从未被显式写进任何一份「未做」清单。**

**③ 它连 P1 自己的最小验收都没兑现。** P1 要求的「传 4 或 999 回落 3」负路径从未实现（§2.3）。所以严格说：不是「后续批次没做完」，而是「P1 交付时就已少了一条自己写的验收项，且无人复查」。

**责任归属的可复算表述**：`git log -S"slimCheckpointCount" -- lib/ tests/ tools/` 只命中 2 个提交 —— `c3309c54`（加键）与 `5e1cf8b5`（仅在 r26 哈希锁的长注释里提到它，无代码改动）。⇒ 这个键自 2026-10-26 落地至今，**没有任何一个提交碰过它的实现**。

---

## 3. 建议（只出方案，未改任何代码）

按「风险 / 收益」排序，供 Lead 裁决：

| # | 对象 | 建议 | 理由 |
|---|---|---|---|
| 1 | `slimCheckpointCount` | **删键** | 功能与数据源双双不存在；P4 已宣告内容侧落地，不再有批次会接它；同批 `fullInjectOnCompact` 已有「0 读取点即删」先例（T3），配套「正向守卫」写法可照抄（P1 测试 `:98`）。删键须同步：`verify-docs` 配置键计数（当前 179）、P1 测试 B-1 的 want 行、白皮书/README 计数。 |
| 2 | `maxPacketItems` / `maxPacketChars` / `packetTtlSteps` / `injectionCooldownSteps` | **删键 + 删 `smoke-test-context-observer.mjs:136` 那条断言** | 唯一「消费者」是测试自己。保留它们 = 保留一个恒真守卫。若判断 `MemoryPacket` 未来会复活，则至少把定义行注释改成「未接线」，并在测试里改成显式标注（照 `softInjectionEnabled` 的做法）。 |
| 3 | `slimPlanChars` / `slimLedgerChars` | **保持现状（已废弃标注）**，但清掉 `docs/internal/FEATURE-INVENTORY.md:15/292` 等文档里的「可调」暗示 | 定义行已写明「保留是为了不破坏配置键数锁与老配置反序列化」。删键会缩水 `Object.keys(DEFAULT_CONFIG)` 白名单 ⇒ 老用户配置里的这两个键会被当未知键剔除，属**有感**行为变化（该结论已写在 `:988-989`）。 |
| 4 | `softInjectionEnabled` / `streamingInterruptionEnabled` | 归入同一批「无消费者保留字段」清单，统一加机器可读标注 | `softInjectionEnabled` 已有人读标注，`streamingInterruptionEnabled` 没有。建议统一句式，便于后续工具按标注批量识别。 |
| 5 | 死键普查工具 | **不要用原始出现次数做判据** | §0.1 的 179 vs 1 已证伪。建议以 §1.1 的六步判定为基线，并把 §1.3 的 6 个间接取值键写成白名单。 |

---

## 4. 复算命令

全部命令在仓库根执行（Windows PowerShell / pwsh）：

```powershell
# ① 179 键定义行自检（应输出 0）
$keys = Get-Content artifacts/_deadkey-list.json -Raw | ConvertFrom-Json
$ix = Get-Content lib/index.js
($keys | Where-Object { $ix[$_.line - 1] -notmatch ('^\s{2}' + [regex]::Escape($_.key) + '\s*:') }).Count

# ② 单键 index.js 原始出现次数（注意会含注释与同名局部变量）
(Select-String -Path lib/index.js -Pattern 'slimCheckpointCount' -AllMatches).Matches.Count   # => 1
(Select-String -Path lib/index.js -Pattern 'panelAllowedHosts'  -AllMatches).Matches.Count   # => 179（其中 178 是局部变量）

# ③ 逐行打印某个键的全部出现（本报告用它逐条人工复核 9 个死键）
Select-String -Path lib/*.js,tests/smoke/*.mjs,tools/*.mjs -Pattern 'slimCheckpointCount'

# ④ 生产读取点（应输出 0 —— 证明 slimCheckpointCount 是死键）
(Select-String -Path lib/*.js,tests/smoke/*.mjs,tools/*.mjs -Pattern '(\.|\]\.?)\s*slimCheckpointCount' | Measure-Object).Count

# ⑤ 反向对照：活键应非 0
(Select-String -Path lib/index.js -Pattern '\.hangCompensateTokens'  | Measure-Object).Count   # => 2（:1983 在 JSDoc 块内、:23790 是真读取）
(Select-String -Path lib/team-sync.js -Pattern "'teamPushPath'"      | Measure-Object).Count   # => 1

# ⑥ 两个已删键确认不在 179 里（应输出 False False）
($keys.key -contains 'fullInjectTokenGap'); ($keys.key -contains 'fullInjectOnCompact')

# ⑦ 键的历史（应只命中 c3309c54 与 5e1cf8b5）
git log --oneline -S"slimCheckpointCount" --all -- lib/ tests/ tools/

# ⑧ 「传 4 或 999 回落 3」的 clamp 是否存在（应输出 0）
(Select-String -Path lib/index.js -Pattern '\[3,\s*5,\s*7\]' -AllMatches).Matches.Count

# ⑨ 精简版渲染器里有没有检查点渲染（应只有 `[当前事件]` 单行，无 checkpoints）
Select-String -Path lib/index.js -Pattern 'checkpoint' | Where-Object { $_.LineNumber -ge 10469 -and $_.LineNumber -le 10721 }
```

> ⑤ 的读数说明：`.hangCompensateTokens` 命中 2 行 —— `:1983` 在 JSDoc 块内（`* @param {number} threshold 阈值（config.hangCompensateTokens，默认 300000）`），`:23790` 才是真读取 ⇒ 有效读取点 1 处。`.hangCompensateEnabled` 同理命中 3 行（`:1984` 在 JSDoc 内），有效读取点 `:23248` 与 `:23789` 两处。两处均与本报告表格一致。

---

## 5. 附：179 键全量明细

列说明：

- **有效读取点** = 生产读取点（`lib/` 真实取值 + `lib/client.js` 真实取值 + 变量间接取值 + `renderTeamSettings` 的 `cfg[key]` 泛读）。**不含**测试 / tools 的读值。
- **index.js 总出现** = `lib/index.js` 内的词边界命中数（含定义行、注释、同名局部变量），仅用于与「有效读取点」对照。
- **其他文件命中** = `lib/` 内实际读取点行号；`泛读` = 经 `TEAM_SETTING_KEYS` 键表在 `lib/client.js:15715-15750` 循环读取。
- **前端接线** = `lib/client.js` 直接读取点数。
- **测试/tools 读值** = 测试或工具里真取过该键值的次数（不含仅用键名字符串）。
- **注释行** = 该键名出现在注释中的次数（不构成读取点，仅解释原始计数为何虚高）。

| 键名 | 定义行 | index.js 总出现 | 有效读取点 | 其他文件命中 | 前端接线 | 测试/tools 读值 | 注释行 |
|---|---|---|---|---|---|---|---|
| `boardMode` | 770 | 41 | 11 | lib/index.js:5546<br>lib/index.js:5603<br>lib/index.js:5671<br>lib/index.js:5987<br>lib/index.js:8466<br>lib/index.js:8476<br>lib/index.js:8758<br>lib/index.js:8888<br>lib/index.js:8934<br>lib/index.js:20600 | 1 | 13 | 53 |
| `eventMaxActiveInInject` | 776 | 3 | 1 | lib/index.js:10047 | 0 | — | 2 |
| `eventCatalogChars` | 777 | 3 | 1 | lib/index.js:10113 | 0 | — | 1 |
| `eventCatalogRecentClosedDays` | 781 | 3 | 2 | lib/index.js:10116<br>lib/index.js:10117 | 0 | — | 0 |
| `eventUnarchivedScanTtlMs` | 782 | 3 | 1 | lib/index.js:10287 | 0 | 1 | 1 |
| `userRulesWarnChars` | 790 | 4 | 3 | lib/index.js:12226<br>lib/index.js:15721<br>lib/index.js:27687 | 0 | 2 | 1 |
| `projectRulesWarnChars` | 791 | 4 | 3 | lib/index.js:12227<br>lib/index.js:15722<br>lib/index.js:27688 | 0 | 2 | 1 |
| `userMemoryDir` | 793 | 6 | 7 | lib/index.js:4606<br>lib/index.js:4833<br>lib/index.js:11908<br>lib/memory-mutation-transaction.js:111 | 3 | 4 | 6 |
| `projectMemoryDir` | 795 | 12 | 15 | lib/index.js:4405<br>lib/index.js:4405<br>lib/index.js:4514<br>lib/index.js:5073<br>lib/index.js:5077<br>lib/index.js:5115<br>lib/index.js:5118<br>lib/index.js:5234<br>lib/index.js:5245<br>lib/index.js:13035<br>lib/memory-mutation-transaction.js:112<br>lib/memory-mutation-transaction.js:112 | 3 | 3 | 6 |
| `memoryRoot` | 797 | 22 | 24 | lib/index.js:4509<br>lib/index.js:4511<br>lib/index.js:4516<br>lib/index.js:4635<br>lib/index.js:5072<br>lib/index.js:5077<br>lib/index.js:5114<br>lib/index.js:5118<br>lib/index.js:5233<br>lib/index.js:5245<br>lib/index.js:8960<br>lib/index.js:11121<br>lib/index.js:12030<br>lib/index.js:16137<br>lib/memory-mutation-transaction.js:110 | 9 | 22 | 27 |
| `workbenchEnabled` | 799 | 3 | 2 | lib/index.js:16708<br>lib/index.js:17145 | 0 | 3 | 3 |
| `settingsEntryInDsSettings` | 808 | 1 | 4 | — | 4 | — | 1 |
| `settingsEntryInPluginsPage` | 809 | 1 | 4 | — | 4 | — | 1 |
| `workbenchRoot` | 817 | 5 | 12 | lib/index.js:16486<br>lib/index.js:17662<br>lib/index.js:17665 | 9 | 24 | 13 |
| `workbenchPeriodDays` | 825 | 11 | 9 | lib/index.js:4061<br>lib/index.js:16540<br>lib/index.js:16541 | 6 | 2 | 9 |
| `workbenchLoopShort` | 832 | 3 | 7 | lib/index.js:17675 | 6 | 1 | 4 |
| `workbenchLoopLong` | 834 | 3 | 7 | lib/index.js:17675 | 6 | 1 | 1 |
| `subagentReasoningEffortShort` | 837 | 2 | 1 | lib/index.js:2727 | 0 | — | 0 |
| `subagentReasoningEffortLong` | 838 | 3 | 1 | lib/index.js:2727 | 0 | — | 1 |
| `workbenchRetryMs` | 840 | 3 | 7 | lib/index.js:17735 | 6 | — | 4 |
| `injectEnabled` | 842 | 4 | 4 | lib/index.js:23178 | 3 | 3 | 1 |
| `injectBudgetChars` | 872 | 18 | 8 | lib/index.js:10331<br>lib/index.js:12189<br>lib/index.js:12518<br>lib/index.js:13125<br>lib/index.js:13147 | 3 | 13 | 21 |
| `tier0CatalogEnabled` | 875 | 3 | 4 | lib/index.js:10318 | 3 | — | 2 |
| `tier0MaxTokens` | 884 | 5 | 8 | lib/index.js:10335<br>lib/index.js:10335 | 6 | 2 | 13 |
| `tier0BudgetShare` | 887 | 5 | 7 | lib/index.js:10332 | 6 | — | 7 |
| `promptSectionToggles` | 893 | 4 | 12 | lib/index.js:12263<br>lib/index.js:12263<br>lib/index.js:12264 | 9 | — | 0 |
| `injectExcludeSources` | 903 | 8 | 36 | lib/index.js:10391<br>lib/index.js:10391<br>lib/index.js:27717<br>lib/index.js:27717<br>lib/index.js:27717<br>lib/settings-safety.js:23<br>lib/settings-safety.js:23<br>lib/settings-safety.js:23<br>lib/settings-safety.js:23 | 27 | 1 | 3 |
| `recentDaysInjected` | 905 | 2 | 4 | lib/index.js:9312 | 3 | — | 0 |
| `subagentModel` | 907 | 8 | 24 | lib/index.js:2720<br>lib/index.js:17119 | 22 | 14 | 13 |
| `subagentProvider` | 909 | 7 | 8 | lib/index.js:2725<br>lib/index.js:17118<br>lib/index.js:17481 | 5 | 7 | 6 |
| `subagentReasoningEffort` | 915 | 5 | 7 | lib/index.js:2728 | 6 | 2 | 3 |
| `subagentTimeoutSeconds` | 922 | 5 | 4 | lib/index.js:17847<br>lib/index.js:18835 | 2 | 6 | 8 |
| `noteCapacityChars` | 929 | 9 | 7 | lib/index.js:4099 | 6 | 26 | 3 |
| `userCapacityChars` | 930 | 9 | 7 | lib/index.js:4102 | 6 | 13 | 0 |
| `capacityDefaultsVersion` | 933 | 5 | 2 | lib/index.js:4096<br>lib/index.js:4106 | 0 | 4 | 7 |
| `memoryFileIndexEnabled` | 935 | 3 | 4 | lib/index.js:3522 | 3 | 2 | 1 |
| `memoryAnchorEnabled` | 937 | 4 | 6 | lib/index.js:13558<br>lib/shadow-host.js:82<br>lib/shadow-host.js:233 | 3 | 6 | 10 |
| `autoConsolidate` | 939 | 8 | 15 | lib/index.js:10687<br>lib/index.js:12336<br>lib/index.js:15846<br>lib/index.js:18462<br>lib/index.js:18462 | 10 | — | 1 |
| `autoConsolidateMinChars` | 941 | 3 | 8 | lib/index.js:15847<br>lib/index.js:18468 | 6 | — | 0 |
| `autoConsolidateCooldownMinutes` | 943 | 3 | 8 | lib/index.js:15848<br>lib/index.js:18472 | 6 | — | 0 |
| `autoConsolidateDailyMax` | 954 | 6 | 8 | lib/index.js:15849<br>lib/index.js:18475 | 6 | — | 4 |
| `consolidateScheduleEnabled` | 956 | 2 | 4 | lib/index.js:16244 | 3 | — | 0 |
| `consolidateScheduleTime` | 958 | 2 | 7 | lib/index.js:16245 | 6 | — | 0 |
| `consolidateScheduleDays` | 960 | 2 | 7 | lib/index.js:16258 | 6 | — | 0 |
| `maintainScheduleEnabled` | 962 | 2 | 4 | lib/index.js:16274 | 3 | — | 0 |
| `maintainScheduleTime` | 964 | 2 | 7 | lib/index.js:16275 | 6 | — | 0 |
| `handoffEnabled` | 969 | 35 | 19 | lib/index.js:5068<br>lib/index.js:5110<br>lib/index.js:5985<br>lib/index.js:7384<br>lib/index.js:8295<br>lib/index.js:8803<br>lib/index.js:9316<br>lib/index.js:9328<br>lib/index.js:12477<br>lib/index.js:12784<br>lib/index.js:13439<br>lib/index.js:14171<br>lib/index.js:14535<br>lib/index.js:14606<br>lib/index.js:14695 | 4 | 11 | 42 |
| `handoffPlanChars` | 971 | 8 | 7 | lib/index.js:12515 | 6 | — | 10 |
| `handoffPlanSections` | 977 | 6 | 2 | lib/index.js:12557<br>lib/index.js:12557 | 0 | — | 3 |
| `handoffPlanSectionMax` | 979 | 10 | 7 | lib/index.js:2116<br>lib/index.js:2116<br>lib/index.js:12305<br>lib/index.js:12305<br>lib/index.js:12529<br>lib/index.js:12529<br>lib/index.js:12530 | 0 | — | 2 |
| `handoffLedgerChars` | 981 | 4 | 8 | lib/index.js:12630<br>lib/index.js:13149 | 6 | — | 1 |
| `slimPlanChars` | 990 | 2 | 0 | — | 0 | — | 3 |
| `slimLedgerChars` | 991 | 2 | 0 | — | 0 | — | 3 |
| `rulesLayeringMode` | 1001 | 14 | 9 | lib/index.js:10140<br>lib/index.js:10665<br>lib/index.js:12207<br>lib/index.js:12212<br>lib/index.js:28275<br>lib/rules-layer.js:306 | 3 | 1 | 6 |
| `criteriaGate` | 1007 | 6 | 5 | lib/index.js:5854<br>lib/index.js:5892 | 3 | 4 | 10 |
| `waterLevelWindowTokens` | 1009 | 3 | 7 | lib/index.js:6363 | 6 | — | 1 |
| `waterLevelThreshold` | 1017 | 12 | 13 | lib/index.js:6550<br>lib/index.js:6804<br>lib/index.js:8783<br>lib/index.js:8793<br>lib/index.js:8819<br>lib/index.js:8819<br>lib/index.js:12788 | 6 | 4 | 5 |
| `waterLevelThresholdMode` | 1020 | 5 | 13 | lib/index.js:6549<br>lib/index.js:6800<br>lib/index.js:6807<br>lib/index.js:8823 | 9 | 1 | 3 |
| `officialCompactionRatio` | 1022 | 2 | 13 | lib/index.js:6555 | 12 | — | 3 |
| `officialHeadroomTokens` | 1024 | 2 | 13 | lib/index.js:6556 | 12 | — | 3 |
| `waterLevelAutoMargin` | 1026 | 4 | 13 | lib/index.js:6576 | 12 | 1 | 5 |
| `waterLevelAdvisory` | 1028 | 2 | 4 | lib/index.js:12788 | 3 | — | 0 |
| `waterLevelProxyCompat` | 1037 | 14 | 16 | lib/index.js:6729<br>lib/index.js:6844<br>lib/index.js:8828<br>lib/index.js:8828<br>lib/index.js:8829<br>lib/index.js:8829<br>lib/index.js:8830<br>lib/index.js:8830<br>lib/index.js:15624<br>lib/index.js:15630<br>lib/index.js:15707<br>lib/index.js:19189<br>lib/index.js:19192 | 3 | 8 | 2 |
| `waterLevelAutoHandoff` | 1039 | 6 | 4 | lib/index.js:6897 | 3 | 1 | 6 |
| `autoContinueEnabled` | 1044 | 14 | 13 | lib/index.js:7206<br>lib/index.js:7299<br>lib/index.js:7328<br>lib/index.js:7641<br>lib/index.js:13439 | 8 | 9 | 24 |
| `autoContinueThreshold` | 1046 | 5 | 7 | lib/index.js:7217<br>lib/index.js:7642 | 5 | 1 | 6 |
| `autoContinueConfirmSeconds` | 1048 | 2 | 7 | lib/index.js:7229 | 6 | — | 3 |
| `autoContinueRefreshRitual` | 1050 | 3 | 2 | lib/index.js:7964<br>lib/index.js:8930 | 0 | 3 | 0 |
| `autoContinueRefreshTimeoutSeconds` | 1054 | 3 | 4 | lib/index.js:7969 | 3 | 4 | 1 |
| `autoContinueRefreshAttempts` | 1056 | 3 | 3 | lib/index.js:7987 | 2 | — | 3 |
| `autoContinueProbeTimeoutSeconds` | 1059 | 2 | 3 | lib/index.js:7974 | 2 | 3 | 0 |
| `panelAllowedHosts` | 1080 | 179 | 1 | lib/index.js:25861 | 0 | — | 4 |
| `autoContinueCooldownMinutes` | 1082 | 2 | 7 | lib/index.js:7220 | 6 | — | 3 |
| `subagentGcEnabled` | 1087 | 4 | 6 | lib/index.js:17996<br>lib/index.js:18378<br>lib/index.js:26777 | 3 | — | 1 |
| `subagentGcKeepDays` | 1089 | 3 | 8 | lib/index.js:18383<br>lib/index.js:26778 | 6 | — | 0 |
| `sessionArchiveEnabled` | 1091 | 3 | 5 | lib/index.js:18186<br>lib/index.js:18188 | 3 | — | 0 |
| `autoArchiveEnabled` | 1093 | 5 | 8 | lib/index.js:18189<br>lib/index.js:18195<br>lib/index.js:18278<br>lib/session-archive.js:74<br>lib/session-archive.js:74 | 3 | — | 0 |
| `autoArchiveDays` | 1094 | 12 | 12 | lib/index.js:16528<br>lib/index.js:16538<br>lib/index.js:18190<br>lib/index.js:18283<br>lib/session-archive.js:69<br>lib/session-archive.js:75 | 6 | 1 | 5 |
| `autoDeleteEnabled` | 1096 | 5 | 8 | lib/index.js:18191<br>lib/index.js:18195<br>lib/index.js:18293<br>lib/session-archive.js:76<br>lib/session-archive.js:76 | 3 | 1 | 0 |
| `autoDeleteDays` | 1097 | 4 | 10 | lib/index.js:18192<br>lib/index.js:18294<br>lib/session-archive.js:70<br>lib/session-archive.js:77 | 6 | — | 0 |
| `autoArchiveCheckMin` | 1099 | 2 | 7 | lib/index.js:18193 | 6 | 2 | 3 |
| `awayMinutes` | 1101 | 13 | 12 | lib/index.js:13093<br>lib/index.js:16187<br>lib/index.js:16197<br>lib/index.js:19180<br>lib/greeting.js:70<br>lib/greeting.js:70 | 6 | — | 12 |
| `unattendedMode` | 1107 | 5 | 4 | lib/index.js:9500 | 3 | — | 5 |
| `unattendedAuto` | 1112 | 3 | 4 | lib/index.js:9501 | 3 | — | 1 |
| `unattendedAutoHours` | 1115 | 5 | 2 | lib/index.js:9504<br>lib/index.js:9504 | 0 | — | 2 |
| `snapshotTieredInject` | 1121 | 4 | 4 | lib/index.js:23353 | 3 | 1 | 7 |
| `snapshotMinGapRounds` | 1126 | 20 | 11 | lib/index.js:4135<br>lib/index.js:4140<br>lib/index.js:10677<br>lib/index.js:23323<br>lib/index.js:23406 | 6 | 9 | 23 |
| `slimEveryRounds` | 1135 | 19 | 10 | lib/index.js:4152<br>lib/index.js:4155<br>lib/index.js:23324<br>lib/index.js:23408 | 6 | 2 | 20 |
| `snapshotReinjectOnCompact` | 1136 | 5 | 4 | lib/index.js:12332 | 3 | — | 4 |
| `fullInjectWaterPct` | 1166 | 3 | 7 | lib/index.js:23496 | 6 | — | 4 |
| `slimCheckpointCount` | 1169 | 1 | 0 | — | 0 | — | 0 |
| `hangCompensateTokens` | 1172 | 3 | 1 | lib/index.js:23790 | 0 | — | 2 |
| `fullInjectSlimBudgetChars` | 1177 | 8 | 2 | lib/index.js:12516<br>lib/index.js:13145 | 0 | — | 7 |
| `fullInjectSemanticChars` | 1180 | 2 | 7 | lib/index.js:12741 | 6 | — | 0 |
| `hangCompensateEnabled` | 1182 | 7 | 2 | lib/index.js:23248<br>lib/index.js:23789 | 0 | — | 5 |
| `promptLayerOverrides` | 1188 | 14 | 12 | lib/index.js:10512<br>lib/index.js:10512<br>lib/index.js:12193<br>lib/index.js:12193<br>lib/index.js:13079<br>lib/index.js:13301 | 6 | — | 8 |
| `autoPopupEnabled` | 1190 | 3 | 8 | lib/index.js:19185 | 7 | — | 1 |
| `welcomeTourEnabled` | 1192 | 1 | 10 | — | 10 | — | 2 |
| `autoSummaryTimes` | 1194 | 6 | 20 | lib/index.js:16205<br>lib/index.js:16205<br>lib/index.js:19193<br>lib/index.js:19193<br>lib/settings-safety.js:22<br>lib/settings-safety.js:22<br>lib/settings-safety.js:22<br>lib/settings-safety.js:22 | 12 | — | 1 |
| `dayBoundaryMinutes` | 1196 | 13 | 18 | lib/index.js:8618<br>lib/index.js:8668<br>lib/index.js:8710<br>lib/index.js:9406<br>lib/index.js:10687<br>lib/index.js:12336<br>lib/index.js:24435<br>lib/index.js:24541<br>lib/context-host.js:386<br>lib/event-write.js:218<br>lib/shadow-host.js:349<br>lib/shadow-retrieval.js:478 | 6 | 1 | 8 |
| `reflectEnabled` | 1198 | 2 | 4 | lib/index.js:9347 | 3 | — | 0 |
| `reflectStyle` | 1200 | 2 | 4 | lib/index.js:13398 | 3 | 3 | 0 |
| `locale` | 1202 | 1 | 14 | — | 14 | 61 | 40 |
| `externalInjectionChars` | 1209 | 3 | 6 | — | 6 | — | 2 |
| `externalSources` | 1211 | 13 | 12 | lib/index.js:4470<br>lib/index.js:4470<br>lib/index.js:9368<br>lib/index.js:19543<br>lib/index.js:19576<br>lib/index.js:19576<br>lib/index.js:19577<br>lib/index.js:28751 | 4 | 5 | 9 |
| `associativeMemoryEnabled` | 1229 | 14 | 22 | lib/index.js:3623<br>lib/index.js:3712<br>lib/index.js:4478<br>lib/index.js:4478<br>lib/index.js:15711<br>lib/index.js:15753<br>lib/activation-host.js:64<br>lib/activation-host.js:68<br>lib/context-host.js:156<br>lib/context-host.js:160<br>lib/context-host.js:336<br>lib/m7-index-sync-host.js:53<br>lib/shadow-host.js:80<br>lib/shadow-host.js:231 | 8 | 12 | 11 |
| `shadowRetrievalEnabled` | 1233 | 1 | 5 | lib/shadow-host.js:81<br>lib/shadow-host.js:232 | 3 | — | 6 |
| `contextBridgeEnabled` | 1236 | 1 | 7 | lib/context-host.js:156<br>lib/context-host.js:161<br>lib/context-host.js:336<br>lib/m7-index-sync-host.js:54 | 3 | — | 5 |
| `contextSinkMode` | 1238 | 2 | 7 | lib/index.js:4387<br>lib/context-host.js:165<br>lib/m7-index-sync-host.js:56 | 4 | 2 | 5 |
| `activationInboxEnabled` | 1246 | 2 | 8 | lib/activation-host.js:64<br>lib/activation-host.js:69 | 6 | 4 | 8 |
| `activationSource` | 1249 | 2 | 6 | lib/index.js:4386<br>lib/activation-host.js:73 | 4 | 2 | 6 |
| `jsDecideCooldownRounds` | 1253 | 1 | 7 | lib/context-host.js:488 | 6 | — | 1 |
| `jsDecideDeltaExp` | 1259 | 2 | 7 | lib/index.js:22316 | 6 | — | 0 |
| `jsDecideExcerptChars` | 1263 | 2 | 10 | lib/context-host.js:554 | 9 | — | 1 |
| `jsDecideCandidateScheme` | 1267 | 1 | 16 | lib/context-host.js:551 | 15 | 1 | 0 |
| `jsDecideCandidatesN` | 1269 | 2 | 10 | lib/context-host.js:554 | 9 | — | 1 |
| `pythonBackendWorkerPath` | 1271 | 13 | 8 | lib/index.js:4043<br>lib/index.js:4046<br>lib/index.js:22360<br>lib/index.js:22408<br>lib/index.js:22491<br>lib/index.js:22492<br>lib/index.js:22542<br>lib/index.js:22673 | 0 | 1 | 5 |
| `pythonBackendExecutable` | 1273 | 10 | 8 | lib/index.js:22359<br>lib/index.js:22408<br>lib/index.js:22446<br>lib/index.js:22491<br>lib/index.js:22492<br>lib/index.js:22542<br>lib/index.js:22564<br>lib/index.js:22587 | 0 | 1 | 1 |
| `semanticEngineMode` | 1275 | 13 | 34 | lib/index.js:4384<br>lib/index.js:4385<br>lib/index.js:21875<br>lib/index.js:22029<br>lib/index.js:22069<br>lib/index.js:22078<br>lib/index.js:22119<br>lib/index.js:22190<br>lib/index.js:26828<br>lib/m7-index-sync-host.js:61<br>lib/settings-safety.js:31<br>lib/settings-safety.js:31<br>lib/settings-safety.js:31 | 21 | 18 | 5 |
| `l0IndexEnabled` | 1285 | 3 | 4 | lib/index.js:21930 | 3 | 2 | 8 |
| `localWasmPaths` | 1292 | 3 | 4 | lib/index.js:21840<br>lib/semantic-js-process.js:124<br>lib/semantic-js-worker.js:75<br>lib/semantic-js.js:336 | 0 | 3 | 5 |
| `semanticEmbedIncremental` | 1301 | 2 | 4 | lib/index.js:21837 | 3 | 2 | 4 |
| `softInjectionEnabled` | 1305 | 1 | 0 | — | 0 | — | 0 |
| `contextBridgeObserveChildSessions` | 1307 | 1 | 4 | lib/context-host.js:343 | 3 | 2 | 2 |
| `pythonBackendEnabled` | 1309 | 3 | 5 | lib/index.js:4388<br>lib/index.js:15775<br>lib/activation-host.js:70<br>lib/context-host.js:162<br>lib/m7-index-sync-host.js:55 | 0 | — | 4 |
| `reasoningObserverEnabled` | 1311 | 2 | 4 | lib/index.js:3846 | 3 | 2 | 1 |
| `procedureInjectEnabled` | 1319 | 1 | 6 | lib/procedure-switch.js:28<br>lib/procedure-switch.js:28<br>lib/procedure-switch.js:37 | 3 | — | 7 |
| `procedurePromotionEnabled` | 1325 | 2 | 3 | lib/procedure-switch.js:30<br>lib/procedure-switch.js:30<br>lib/procedure-switch.js:37 | 0 | — | 7 |
| `memoryHubEnabled` | 1335 | 6 | 8 | lib/index.js:18509<br>lib/index.js:21741<br>lib/activation-host.js:334<br>lib/context-host.js:579<br>lib/context-host.js:812 | 3 | 2 | 7 |
| `episodicMinSegments` | 1337 | 3 | 8 | lib/index.js:18519<br>lib/index.js:21595 | 6 | — | 1 |
| `episodicRetention` | 1339 | 2 | 7 | lib/index.js:21595 | 6 | — | 1 |
| `factRetentionMax` | 1342 | 2 | 7 | lib/index.js:21588 | 6 | 1 | 0 |
| `workspaceDiscoverMax` | 1345 | 3 | 7 | lib/index.js:14819 | 6 | 1 | 1 |
| `procedureMinSessions` | 1347 | 2 | 7 | lib/index.js:21607 | 6 | — | 1 |
| `procedureMinSuccess` | 1349 | 2 | 7 | lib/index.js:21608 | 6 | — | 1 |
| `procedureCorrectionCap` | 1351 | 2 | 7 | lib/index.js:21609 | 6 | 10 | 3 |
| `procedureHighRiskApproval` | 1353 | 2 | 4 | lib/index.js:21611 | 3 | — | 1 |
| `procedureActiveLevel` | 1355 | 2 | 4 | lib/index.js:21613 | 3 | — | 1 |
| `streamingInterruptionEnabled` | 1357 | 1 | 0 | — | 0 | — | 0 |
| `maxPacketItems` | 1359 | 1 | 0 | — | 0 | 1 | 0 |
| `maxPacketChars` | 1361 | 1 | 0 | — | 0 | 1 | 0 |
| `packetTtlSteps` | 1363 | 1 | 0 | — | 0 | 1 | 0 |
| `injectionCooldownSteps` | 1365 | 1 | 0 | — | 0 | 1 | 0 |
| `globalBriefEnabled` | 1379 | 6 | 7 | lib/index.js:13182<br>lib/index.js:19696<br>lib/index.js:28409<br>lib/index.js:28419 | 3 | — | 1 |
| `globalBriefWatchMemory` | 1381 | 3 | 5 | lib/index.js:19710<br>lib/index.js:28423 | 3 | — | 0 |
| `globalBriefWatchDocs` | 1383 | 3 | 5 | lib/index.js:19724<br>lib/index.js:28424 | 3 | — | 0 |
| `globalBriefWatchExternal` | 1385 | 3 | 5 | lib/index.js:19732<br>lib/index.js:28425 | 3 | — | 0 |
| `globalBriefWatchTeam` | 1387 | 3 | 5 | lib/index.js:19793<br>lib/index.js:28426 | 3 | — | 0 |
| `globalBriefChars` | 1389 | 3 | 8 | lib/index.js:19811<br>lib/index.js:28421 | 6 | — | 0 |
| `globalBriefInstruction` | 1391 | 3 | 5 | lib/index.js:19813<br>lib/index.js:28420 | 3 | — | 0 |
| `globalBriefUnattended` | 1393 | 1 | 3 | — | 3 | — | 0 |
| `teamEnabled` | 1395 | 49 | 34 | lib/index.js:13171<br>lib/index.js:19793<br>lib/index.js:20979<br>lib/index.js:21090<br>lib/index.js:21381<br>lib/index.js:21389<br>lib/index.js:26239<br>lib/index.js:26376<br>lib/index.js:26419<br>lib/index.js:26508<br>lib/index.js:26536<br>lib/index.js:26552<br>lib/index.js:26573<br>lib/index.js:26601<br>lib/index.js:26617<br>lib/index.js:26639<br>lib/index.js:26658<br>lib/index.js:26672<br>lib/index.js:26689<br>lib/index.js:28070<br>lib/team-attribution.js:54<br>lib/team-auth.js:292<br>lib/team-auth.js:302<br>lib/team-auth.js:349<br>lib/team-auth.js:371<br>lib/team-auth.js:404<br>lib/team-identity.js:152<br>lib/team-policy.js:8<br>lib/team-pull.js:167<br>lib/team-sync.js:259<br>lib/team-sync.js:569<br>lib/client.js:15715-15750 | 2+泛读 | 7 | 57 |
| `teamPaused` | 1403 | 14 | 2 | lib/index.js:26242<br>lib/team-sync.js:255 | 0 | 5 | 9 |
| `teamPausedReason` | 1405 | 8 | 2 | lib/index.js:26243<br>lib/team-sync.js:505 | 0 | — | 2 |
| `teamUpgradePhase` | 1411 | 5 | 2 | lib/index.js:21344<br>lib/team-sync.js:591 | 0 | — | 4 |
| `teamProjectId` | 1413 | 1 | 3 | lib/team-project-map.js:153<br>lib/team-pull.js:558<br>lib/client.js:15715-15750 | 泛读 | — | 3 |
| `teamEndpoint` | 1415 | 3 | 3 | lib/index.js:21022<br>lib/index.js:26247<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamBucket` | 1416 | 3 | 3 | lib/index.js:21023<br>lib/index.js:26248<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamRegion` | 1417 | 3 | 3 | lib/index.js:21024<br>lib/index.js:26249<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamPathStyle` | 1419 | 3 | 3 | lib/index.js:21027<br>lib/index.js:26250<br>lib/client.js:15715-15750 | 泛读 | — | 1 |
| `teamSyncTransport` | 1421 | 5 | 6 | lib/index.js:21021<br>lib/index.js:26266<br>lib/index.js:26267<br>lib/client.js:15715-15750 | 2+泛读 | — | 2 |
| `teamAccessKeyId` | 1422 | 2 | 2 | lib/index.js:21025<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamSecretAccessKey` | 1423 | 2 | 2 | lib/index.js:21026<br>lib/client.js:15715-15750 | 泛读 | 1 | 1 |
| `teamSyncIntervalMs` | 1425 | 2 | 3 | lib/index.js:21385<br>lib/team-sync.js:263<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamPushPath` | 1432 | 1 | 2 | lib/team-sync.js:334<br>lib/client.js:15715-15750 | 泛读 | 1 | 7 |
| `teamPullPageLimit` | 1438 | 2 | 2 | lib/index.js:21318<br>lib/client.js:15715-15750 | 泛读 | — | 4 |
| `teamOutboxMaxItems` | 1440 | 2 | 2 | lib/index.js:21044<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamMaxConflicts` | 1441 | 4 | 4 | lib/index.js:21080<br>lib/index.js:26252<br>lib/index.js:26252<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamShowMemberBadges` | 1445 | 1 | 2 | lib/client.js:15715-15750 | 1+泛读 | — | 3 |
| `teamE2E` | 1454 | 3 | 3 | lib/index.js:26686<br>lib/client.js:15715-15750 | 1+泛读 | — | 4 |
| `teamUsageReport` | 1460 | 3 | 2 | lib/index.js:26687<br>lib/client.js:15715-15750 | 泛读 | — | 1 |
| `teamUsageLog` | 1462 | 3 | 2 | lib/index.js:26693<br>lib/client.js:15715-15750 | 泛读 | — | 1 |
| `teamInjectEnabled` | 1464 | 4 | 3 | lib/index.js:13171<br>lib/index.js:26240<br>lib/client.js:15715-15750 | 泛读 | — | 2 |
| `teamDerivedDebounceMs` | 1466 | 2 | 2 | lib/index.js:21070<br>lib/client.js:15715-15750 | 泛读 | — | 0 |
| `teamServerUrl` | 1473 | 5 | 3 | lib/index.js:26244<br>lib/team-auth.js:225<br>lib/client.js:15715-15750 | 泛读 | 1 | 5 |
| `teamId` | 1475 | 6 | 7 | lib/index.js:26244<br>lib/fact-store.js:608<br>lib/team-auth.js:229<br>lib/team-identity.js:156<br>lib/team-identity.js:207<br>lib/team-pull.js:557<br>lib/client.js:15715-15750 | 泛读 | 3 | 10 |
| `teamMemberName` | 1477 | 2 | 1 | lib/client.js:15715-15750 | 泛读 | — | 3 |
| `teamConflictPolicy` | 1480 | 4 | 4 | lib/index.js:26251<br>lib/index.js:26600<br>lib/client.js:15715-15750 | 1+泛读 | — | 3 |
| `teamAuditEnabled` | 1482 | 2 | 1 | lib/client.js:15715-15750 | 泛读 | — | 3 |

---

**报告版本**：v1.1（2026-11-08，只读调查，未改动任何源码；v1.0 → v1.1 修正 getter 嵌套括号漏判与 index.js 计数口径）
