# 批次3 · B3-CA + B3-PJ 实施结果（含 task-38 复核修订）

> 执行：DeepSeek teammate `d0010608-1e39-4eaf-82cc-14de905f6ceb`（task-38 + 复核修订）
> 工作区 `D:/dsh-auto-memory`｜HEAD **`fc042186`**（未 commit / 未 push）
> 依据：L1 §4.3 / §4.4 / §6.1 / §6.2、L2 §5
> **只在 `lib/injection/` 修改/新增模块 + 接 facade**：未接 `lib/index.js`，未实施 RP/BD/NT/FM/EV/CO。

---

## 0. 结论

| 项 | 结果 |
|---|---|
| **B3-CA** `decideInjectionCadencePre` | 纯函数；**已按复核四条修订**（缺省水位/真实字段/reinject/首观测） |
| **B3-PJ** `projectInjectionPre` | 按 ContentSpec **14 段**投影，本轮未改 |
| 复核修订 | **4 项全部落地**，逐项有对照与变异 |
| 验收 | 本单元 **97 PASS / 0 FAIL**；四条修订专项变异 **12/12 CAUGHT** |
| 回归 | **532 PASS / 0 FAIL** |
| `lib/index.js` | **零改动**（`E6C6C2944A068164`、导出 41 守恒） |

---

## 1. 物理指纹（复核修订后）

| 文件 | 字节 | 行 | sha16 | 状态 |
|---|---|---|---|---|
| `lib/index.js` | 2185452 | 30050 | `E6C6C2944A068164` | **未改** |
| `lib/injection/cadence.js` | 16545 | 318 | `DE7BBDC9FA6CABCA` | **改（复核修订）** |
| `lib/injection/projection.js` | 9741 | 215 | `99CBCD08996A128D` | 未改 |
| `lib/injection/index.js` | 2134 | 96 | `BE5D37FB0EBB25E8` | 改（补 2 个导出） |
| `lib/injection/dto.js` | 15834 | 337 | `E721E73BBB152313` | 未改 |
| `tests/smoke/smoke-test-batch3-cadence-projection.mjs` | 23351 | 308 | `F96565F39AECE515` | **重写 CA 段** |
| `tests/smoke/smoke-test-batch3-contract.mjs` | 15087 | 179 | `B3DF540C2D221C28` | 未改 |
| `tests/smoke/smoke-test-batch3-sources.mjs` | 12912 | 216 | `8B7962181ABB4DF5` | 未改 |

**修订前 cadence.js**：12,569B / 259 行 / `6B147802AA942D79`（Lead 开工核对确认未被改动）
**修订后 cadence.js**：**16,545B / 318 行 / `DE7BBDC9FA6CABCA`**

---

## 2. ★ 复核四条修订（逐条前后对照）

### 修订 1：缺省水位只 25，50 默认关闭

| 项 | 修订前 | 修订后 |
|---|---|---|
| 缺省 / 空串 / 全非法 | `[25, 50]` | **`[25]`**（50 默认关闭） |
| 显式 `'25,50'` | `[25,50]` | `[25,50]`（**保留双档，不被缺省逻辑吞掉**） |
| `off`/`0`/`none`/`false` | `[]` | `[]`（不变） |

依据：L1 §6.1「50%水位默认关闭，25%保留」是**已裁定**；L1 §6.2 记既有 `lib/index.js` 仍为 `'25,50'`（未实现）。

**⚠ 与既有实现的差异（必须记住，属预期不是缺陷）**：`lib/index.js:2153` 的 `parseWaterPctThresholdsPre` **缺省仍是 `[25,50]`**。
本模块实现的是**已裁定口径**。**生产替换时两者行为不同是设计意图**，替换须按本节语义同步；本批不碰 `lib/index.js`。

**实测（缺省配置下）**：

| 输入 | 修订前 | 修订后 |
|---|---|---|
| `waterPct=26` | `water-25` | `water-25` |
| **`waterPct=51`** | `water-50` | **`water-25`（无 50 档）** |
| 显式 `'25,50'` + 51% + 已投25 | `water-50` | `water-50`（显式仍生效） |

### 修订 2：接受真实 engine 字段，requestKey 不自造

**字段映射（真实字段优先，别名仅兜底）**：

| 真实字段 | 别名 | 用途 |
|---|---|---|
| `_compactSeqSeenPre` | `lastCompactCount` | 上次观测到的压缩序号**基线** |
| `compactionSeq` | `compactCount` | 当前压缩序号 |
| `_waterPctFired` | `waterFired` | 已投递到的最高水位阈值 |
| `_lastFullStepSeq` | `lastFullTurn` | 上次完整版的 step 序号 |
| `_stepSeq` | `turnIndex` | 当前 step 序号 |
| `requestKey` | — | **真实请求身份**（input 或 state.requestKey） |

**`requestKey` 语义（关键）**：

```js
// 修订前：自造 'cad:' + loadedAt + turn + step 覆盖
const requestKey = 'cad:' + load + ':' + turn + ':' + step;
// 修订后：只回显调用方真实输入；缺失给 null + requestKeyMissing，绝不伪造
const realKey = o.requestKey || s.requestKey || null;
return { requestKey: realKey, requestKeyMissing: realKey === null, ... };
```

**实测**：

| 输入 | 修订前 | 修订后 |
|---|---|---|
| `state.requestKey='sess-1:7:2'` | 被覆盖成 `cad:...` | **`sess-1:7:2`** |
| `input.requestKey='req-42'` | 被覆盖 | **`req-42`** |
| 未提供 | 自造 `cad:...` | **`null` + `requestKeyMissing:true`** + reasons 说明「不伪造」 |

**真实字段 vs 别名同语义对照**：同一语义两种写法（`_stepSeq/compactionSeq/...` 与 `turnIndex/compactCount/...`）**产出 tier 与 grants 完全一致**（实测 `full/post-compact` 两条全等）。

**新增只读回显 `observed`**（供适配器显式提交基线，本函数仍不写任何状态）：

```js
observed: { stepSeq, lastFullStepSeq, compactionSeq, compactSeqSeen }  // 已冻结
```

### 修订 3：`snapshotReinjectOnCompact=false` 不授 full 但记录 post_compact

| 情形 | 修订前 | 修订后 |
|---|---|---|
| 新压缩 + 允许（缺省/true） | full | full（不变） |
| **新压缩 + `false`** | **full（错误）** | **不授 full**；`newCompact:true` 仍保留；`grants` 含 `post-compact` **和** `post-compact-no-reinject` |

**关键**：`false` 时**不短路**，继续评估 human/fullGap —— 实测「新压缩+reinject=false+真人」⇒ `full`（`human-turn`），不被压缩条件吞掉。

**实测**：`tier=slim`、`fullGranted=false`、`grants=['post-compact','post-compact-no-reinject']`、`newCompact=true`。

### 修订 4：首观测只建压缩基线，不吞 human/fullGap；无观测字段不判首观测

**修订前**：首观测 **短路 return**，吞掉所有其它条件；且 `loadedAt` 缺失即判首观测（空 state 也算）。

**修订后**：

| 行为 | 修订后 |
|---|---|
| 首观测动作 | 记录 `first-observation-baseline` + `compactionBaselineOnly:true`，**然后继续往下决策** |
| 对 human | **不吞** —— 实测首观测+真人 ⇒ `full` / `human-turn` |
| 对 fullGap | **不吞** —— 实测首观测+`gap=10>=5` ⇒ `full` / `full-gap` |
| 对压缩判定 | 基线缺失 ⇒ **`newCompact=false`**（历史压缩不得当新压缩），并输出理由 |
| 首观测判定条件 | `signals.firstObservation===true` **或** （**存在观测字段** 且 `_compactSeqSeenPre` 缺失但 `compactionSeq` 存在） |
| **空 state / 无观测字段** | **不判首观测**（`compactionBaselineOnly=false`），按 legacy fail-open 正常决策 |

**实测**：

| 输入 | 修订前 | 修订后 |
|---|---|---|
| 首观测 + 真人 | **slim（吞掉）** | **full / human-turn** |
| 首观测 + fullGap | **slim（吞掉）** | **full / full-gap** |
| 空 state | **判首观测 ⇒ slim** | **不判首观测**，`baselineOnly=false` |
| 空 state + 真人 | **slim（误吞）** | **full** |

---

## 3. 四条修订的隔离变异：12/12 CAUGHT

变异在 `.tmp-ca4/` 与 `.tmp-ca5/` 副本内，**均已删除**，逐项完整还原（复原校验 `true`）。

| 组 | # | 变异动作 | 实测 | 判定 |
|---|---|---|---|---|
| **修订1** | R1a | 缺省水位改回 `[25,50]` | 97→93 / FAIL 4 | ✅ CAUGHT |
| 修订1 | R1b | 显式 `'25,50'` 被缺省逻辑吞 | 97→93 / FAIL 4 | ✅ CAUGHT |
| 修订1 | R1c | `off`/`0` 不再禁用 | 97→93 / FAIL 4 | ✅ CAUGHT |
| **修订2** | R2a | `requestKey` 改为自造 `cad:*` 覆盖 | **97→90 / FAIL 7** | ✅ CAUGHT |
| 修订2 | R2b | 忽略真实字段、只读别名 | **97→84 / FAIL 13** | ✅ CAUGHT |
| 修订2 | R2c | 真实 `_waterPctFired` 失效（恒取 0） | 97→95 / FAIL 2 | ✅ CAUGHT |
| **修订3** | R3a | `reinject=false` 仍授予 full | 97→92 / FAIL 5 | ✅ CAUGHT |
| 修订3 | R3b | `reinject=false` 时不记录 `post_compact` | 97→93 / FAIL 4 | ✅ CAUGHT |
| 修订3 | R3c | `reinject=false` 时短路吞掉 human | 97→95 / FAIL 2 | ✅ CAUGHT |
| **修订4** | R4a | 首观测短路吞 human/fullGap | 97→94 / FAIL 3 | ✅ CAUGHT |
| 修订4 | R4b | 空 state 也判首观测 | 97→95 / FAIL 2 | ✅ CAUGHT |
| 修订4 | R4c | 首观测时 postCompact 当新压缩 | 97→95 / FAIL 2 | ✅ CAUGHT |

### 3.1 一个无效变异的归因（如实）

`R2a` 首版变异把三元表达式改成 `const realKey = 'cad:' + String(...)` 直接替换**两行**（含 `: (…)` 分支），产生**语法错误** —— 我只在把 `R2a` 重做成语法有效版本后才拿到 CAUGHT（97→90/FAIL 7）。
**无效变异不计入 CAUGHT**；副产物是一条纪律：**变异后先 `node --check`，再判定 CAUGHT/MISSED**。

---

## 4. B3-PJ（本轮未改，简述）

| 项 | 结论 |
|---|---|
| 14 段投影 | 各段语义独立；14 段全部已登记（未登记段抛错） |
| 通道超限 | **整段省略 + 显式 `channel-overflow` degradation** |
| 画像 | 只用 accepted/used + authorResponse；其余丢弃并记 `portrait-filtered` |
| 2.3 归属 | **proposal-only**：`applied` 恒 false + 三个 auto 全 false |
| 精简档 | `renderPath` 结构性保证 `human_slim`/`run_slim` ⇒ `'slim'` |

---

## 5. 套件实跑（HEAD `fc042186`，复核修订后）

| 套件 | exit | PASS | FAIL |
|---|---|---|---|
| `smoke-test-batch3-cadence-projection.mjs`（本单元，CA 段已重写） | 0 | **97** | 0 |
| `smoke-test-batch3-contract.mjs` | 0 | 92 | 0 |
| `smoke-test-batch3-sources.mjs` | 0 | 64 | 0 |
| `smoke-test-batch3-cb.mjs` | 0 | 23 | 0 |
| `smoke-test-p6a-rules-layer.mjs` | 0 | 125 | 0 |
| `smoke-test-v4-h5-user-portrait.mjs` | 0 | 41 | 0 |
| `smoke-test-batch2-2.9-wiring.mjs` | 0 | 90 | 0 |
| **合计** | — | **532** | **0** |

> 本单元断言数 **68 → 97**（+29），主要来自：修订 1 的缺省/显式/禁用三组对照、修订 2 的真实字段与别名同语义对照 + requestKey 三态、修订 3 的四条 reinject 断言、修订 4 的六条首观测断言。

---

## 6. 未验边界与如实声明

1. **未接生产入口**：`lib/index.js` **没有** import `lib/injection/`；CA/PJ 是**可独立调用与验收的纯函数**，不代表注入链路已切换。
2. **未做真实 HOST**：未启隔离 `DSH_HOME`、未访问 19387、未读写任何真实记忆。
3. **真实字段名来自 Lead 指定，未与 engine 源码逐字段核对**：`_compactSeqSeenPre`/`compactionSeq`/`_waterPctFired`/`_lastFullStepSeq`/`_stepSeq` 的**类型与取值语义**（是否 0 起、是否可能为负、是否字符串化）本轮**未在真实 engine 上验证**。
4. **缺省水位 `[25]` 与既有 `lib/index.js` 的 `'25,50'` 有意不同**：本模块实现已裁定口径；**两者并存期间行为不一致**，替换时须同步（见 §2 修订 1 的 ⚠）。
5. **`requestKey` 缺失时的适配器补全未实现**：本模块显式给 `null` + `requestKeyMissing:true`，但**由谁、以什么规则补**未定案。
6. **`snapshotReinjectOnCompact` 的真实配置键名未核对**：本模块接受 `config.snapshotReinjectOnCompact` 与 `signals.snapshotReinjectOnCompact`，**未验证生产中该键实际叫什么、默认值是什么**。
7. **首观测判定规则是本模块约定**：真实 engine 是否已有「首次观测」标记字段**未核对**；若已有，应改为直读而非推导。
8. **PJ 未改未复验语义**：本轮只跑其既有断言（全绿），未重新审视 `SEGMENT_PRIORITY` / `channelLimit=2000` 这两个占位值（仍未与 3.0-B / B3-FM 对齐）。
9. 未跑全量回归 / `--impact-run`（只跑 7 个相关套件 532 PASS）。
10. 未 commit / 未 push / 未发版 / 未迁移 / 未删除。

---

## 7. 交付物

| 路径 | 说明 |
|---|---|
| `lib/injection/cadence.js` | **改**：B3-CA 含四条复核修订（16,545B / 318 行） |
| `lib/injection/projection.js` | 未改：B3-PJ（9,741B / 215 行） |
| `lib/injection/index.js` | 改：补导出 `DEFAULT_WATER_THRESHOLDS` / `OBSERVATION_FIELDS` |
| `tests/smoke/smoke-test-batch3-cadence-projection.mjs` | **CA 段重写**：97 断言（23,351B / 308 行） |
| `artifacts/_batch3-ca-pj-20261117/` | fingerprints(v2) / mutations(v2) / suite-runs / MANIFEST |


## Lead独立复核补证

`lib/index.js` 的 `_compactSeqSeenPre` 首次观测分支允许 0 基线，并由 `scanPressureSignalsPre(...).compactionSeq` 提供当前压缩序号；`_waterPctFired`、`_lastFullStepSeq`、`_stepSeq` 均按 Number 消费。`snapshotReinjectOnCompact: true` 为当前默认，且 `=== false` 时 post_compact 重注入标记被抑制。CA 的真实字段与配置语义已据此复核。

Lead复跑：cadence-projection 97、contract 92、sources 64、cb 23、p6a 125、h5 41、2.9-wiring 90，共532 PASS/0 FAIL。生产入口仍未接线，未做真实HOST/全量。
