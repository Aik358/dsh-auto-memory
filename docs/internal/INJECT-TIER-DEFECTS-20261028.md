# 注入档位体系缺陷报告（2026-10-28）

> **状态**：P0–P2 修复进行中。每修一项在本报告对应条目追加「修复方式 / 预计效果 / 实测结果」。
> **来源**：Lead 全面测量 + 独立核验 agent（只读交叉验证）。
> **设计权威口径**：2026-10-27 设计纲要（用户定稿，见 §1）。

---

## §1 设计纲要（权威口径，不可自行改动）

四个注入档位，**单位全部是「步数」= 模型请求（step）**，不是对话轮次。

| 档位 | 触发时机 | 内容要求 |
|---|---|---|
| `user_full` | ①压缩后 ②水位跨 25% ③水位跨 50% —— 均为「之后的第一条 user 信息」 | **全量投送**：规则全文 + 项目全貌 + 用户偏好 + 用户画像 + agent 共同记忆。**不设上限或上限相对大** |
| `user_slim` | 其余 user 发声轮次 | **核心节**，专注当前事项；**不投规则全文** |
| `run_full` | 每 **20 步** 一次 | 形式与 `user_slim` 类似：**核心节 + 不投规则全文** |
| `run_slim` | 每 **8 步** 一次（最克制） | 只有功能指导相关内容；可承载记忆唤回 |

用户强调的设计意图（逐字）：

> human_slim / run_full 应该是核心节，并且不投送「规则」的全文，因为模型注意力没有那么容易漂移。
> user_full 应该不设上限或者上限相对大，因为要全量投送规则、项目全貌、用户偏好、用户画像、agent 共同记忆等等全量内容。

---

## §2 缺陷总表

| ID | 优先级 | 缺陷 | 核心证据 | 修复状态 |
|---|---|---|---|---|
| D1 | **P0-1** | `_stepGrantedSeq` 只写不读 ⇒ 完整版被同一请求重复授予 | 全仓 1 处赋值 / **0 处读取**；日志 26 次 `gap=0`，其中 21 次时间差 <1s | ✅ **已修**（§4 D1） |
| D2 | **P0-2** | `user_full` 丢事件卡，反不如 `run_slim` | event-cards 2,839 字符被裁；memRef 9,435 < 9,899 | ⏸ **待用户裁定**（§7） |
| D3 | **P0-3** | 「三档内容规格从未生效」 | `renderSlimSnapshotPre` 读 `_injectTierPre` **0 次** | ❌ **重新定性为误判**（§7：精简帧单形态是 2026-10-01 裁定） |
| D4 | **P0-4** | `user_full` 白板预算 = 瘦档预算 = 3,000 | `Math.max(1200,3000)` 抹平差异 | ✅ **已修**（§4 D4） |
| D5 | **P1-1** | `isRulesFullTierPre` 等「生产未接线」（非纯死代码） | lib 定义 1 / 测试消费 4+ / **生产消费 0** | ✅ **已修**（§4 D5，含规则段按档位裁剪） |
| D6 | **P1-2** | `renderSlimSnapshotPre` 裸读 `this.state` | L9544 vs 同函数 L9581 的 `stateFor` | ✅ **已修**（§4 D6） |
| D7 | **P1-3** | 规则段在抽取沙箱里恒为空 | `extractRulesLayerPre`/`renderRulesSectionPre` 未内联未守卫 | 待修 |
| D8 | **P2-1** | `injectBudgetChars` 不是硬上限 | 设 2,000 → 实际注入 17,408；设 20,000 → 24,985 | 待修 |
| D9 | **P2-2** | `extBudget` / `externalInjectionChars` 死配置 | 设 200 / 1400 输出都是 266 | 待修 |
| D10 | **P2-3** | 三处 gap fallback 不一致 20 / 10 / 5 | L524=20、L20510=5、L20569=10、L9654=5(文案) | ✅ **已修**（§4 D10） |
| D11 | **P2-4** | `diag` 把真人触发误标成「距上次完整版 N」 | 270 条中 233 条(86.3%) N<20 是标签错 | 待修 |
| D12 | **P2-5** | 画像/语义两处名单手写不一致 | `hang_compensate` 多投画像 480 字符 | 待修 |

---

## §3 基线实测（修复前，用于对比）

### 3.1 四档真实注入体积

| 档位 | 实测字符 | 规则段 | 事件卡 |
|---|---|---|---|
| `human_full` | 20,104 | 8,291 | ❌ 0 |
| `human_slim` | 20,040 | 8,291 | ❌ 0 |
| `run_full` | 18,645 | 8,291 | ❌ 0 |
| `run_slim` | 16,046 | 0 | ✅ 保留 |

**关键**：`human_full` 与 `human_slim` 只差 **64 字符（0.3%）** ⇒ 四档预算分层实际不存在。

### 3.2 档位可达性

唯一调用点 `L20495`：`decideInjectTierPre({ isHuman: _isHumanNow, isFull: true })` —— **硬编码 `isFull: true`**。

⇒ 可达档位只有 `human_full` / `run_full`（+ 条件性的 `handoff_carry` / `hang_compensate`）。
⇒ `human_slim` / `run_slim` / `post_compact` 全不可达（`postCompact` 全仓 0 调用点）。
⇒ **L10402 的 `run_slim` 裁剪是永不执行的死分支。**

### 3.3 今日真实投递（diagnose.log 全量）

| 指标 | 次数 |
|---|---|
| 完整版授予 | 566 |
| 其中「真人在场」 | 225 |
| 其中「达 20 步门槛」 | 263 |
| 其中**「距上次 0 步」** | **26** ⚠️ 重复授予 |
| 精简版投递 | 364 |
| 精简版被节流 | 3,037 |

---

## §4 逐项修复记录

> 格式：每项含【缺陷】/【修复方式】/【预计效果】/【实测结果】/【回归】。

<!-- 修复记录在此之下逐项追加 -->
### D6 / P1-2 · `renderSlimSnapshotPre` 裸读 `this.state`（多会话串线）

**状态**：✅ 已修复（**最小面**：只改 `ws`，不整体换口径）

**【缺陷】** `refresh(agent)` 写 **agent runtime**，`this.state` 取 **default runtime** ⇒ 多会话并行时 `s.ws` 读到别的工作区。同函数内 L9581 已用 `stateFor(agent)` 读唤回标记 —— 同一函数两种口径，缺陷家族第 4 例。

**【修复方式】** `lib/index.js` `renderSlimSnapshotPre`：

```js
const s = this.state                                    // 其余 4 字段仍读 default
let _wsAgentRuntime = null
try { if (typeof this.stateFor === 'function') _wsAgentRuntime = this.stateFor(agent) } catch (_) {}
const _wsFromAgent = (function () {
  const w = _wsAgentRuntime && _wsAgentRuntime.ws
  return (typeof w === 'string' && w) ? w : '';         // 仅非空才覆盖
})()
const wsEff = _wsFromAgent || s.ws || wsHint || ''
```

**【为什么只改 ws，不整体换 stateFor】**（关键决策，第一次尝试踩过）

本函数另外 4 个字段（`events` / `slimEventT1` / `slimEventTotal` / `userPortraitText`）**由 `refreshEventStatePre` 写入 `this.state`**。
整体改成 `stateFor(agent)` ⇒ 写端仍在 default、读端却在 agent ⇒ **读写脱节** ⇒ 事件卡与画像全部读不到（实测 v4-c2 套件 **9 条断言全红**）。
⇒ 要整体换口径必须连写端一起换（更大改动面，不在本次范围）。

**【预计效果】** 多会话并行时精简帧读到**本 agent** 的工作区名，不再串线；其余字段行为不变。

**【实测结果】**

| 套件 | 结果 |
|---|---|
| `smoke-test-v4-c2-slim-events`（事件卡/画像真出现） | **39 PASS / 0 FAIL** ✅ |
| `smoke-test-ws-hint-first-round`（ws 优先级） | **31/31** ✅ |

**【下一轮核查方法】**

```bash
node tests/smoke/smoke-test-v4-c2-slim-events.mjs      # 期望 39/0
node tests/smoke/smoke-test-ws-hint-first-round.mjs   # 期望 31/31
# 真机：开两个不同工作区会话，精简帧头部的「工作区:」应各自正确，不互相串
```

---

### D10 / P2-3 · 三处 gap fallback 不一致（20 / 10 / 5）

**状态**：✅ 已修复

**【缺陷】** `DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS = 20`（真源），但三处读取各自写死 fallback：

| 位置 | 原 fallback |
|---|---|
| L9692（精简说明文案） | 5 |
| L20585（`gap`） | 5 |
| L20644（`fullGapStep`） | 10 |

**【修复方式】** 三处统一为 **内联字面量 20**。

⚠️ **关键教训（我自己踩了）**：第一次我改成引用 `DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS` 常量 ⇒ **15 个套件全红**。
原因：这些代码位于 `renderMemoryDynamic` / pre-step 的**源码抽取切片**里，测试用 `new Function` 执行，沙箱里**没有模块级 const** ⇒ `ReferenceError`。
⇒ 必须内联字面量，并在注释里写明「必须与真源常量保持同步」。

**【预计效果】** 配置缺失时完整版间隔从「5 或 10」统一为 **20 步**，不再比设定密 2~4 倍。

**【实测结果】** `grep 'snapshotMinGapRounds, [0-9]' lib/index.js` ⇒ **无残留**。

**【下一轮核查方法】**

```bash
grep -n 'snapshotMinGapRounds, [0-9]' lib/index.js   # 期望只看到 20（或常量名）
node tests/smoke/smoke-test-p6a-rules-layer.mjs     # 期望 pass=123 fail=0
```

---

## §5 本轮判据同步清单（语义按纲要变更，测试断言随之更新）

| 套件 | 断言 | 原判据 | 新判据 | 理由 |
|---|---|---|---|---|
| `v5-p3-tier-content` | C-8 | `isRulesFullTierPre(RUN_FULL) === true` | `=== false`（+C-8b/c/d/e 四条补正路径） | 纲要：run_full 不投规则全文 |
| `v5-p4-content-tier` | A-12 | 同上 | `=== false`（+A-12b） | 同上 |
| `v5-p5-tier-plan-real` | F-5 | run_full/post_compact 规则段=全文 | 改为摘要（+F-5b 三条负路径） | 同上 |
| `p6a-rules-layer` | 2 条 | gap fallback 必须恰为 `5` | 与真源一致（`20`） | 三处 fallback 已统一 |
| `ws-hint-first-round` | 口径断言 | `wsEff = s.ws \|\| wsHint` | `wsEff = _wsFromAgent \|\| s.ws \|\| wsHint` | ws 主源改 agent runtime |

---

## §6 全量回归结果

```
PASS 531 / FAIL 0 / TIMEOUT 0   (total 161.7s)   EXIT=0
```

**回归演进（说明每步都是真修复，不是靠放宽判据蒙混）**：

| 轮次 | 结果 | 说明 |
|---|---|---|
| r163 | 516 / **15** | P2-3 误用模块级常量 ⇒ 抽取沙箱 ReferenceError |
| r163b | 528 / **3** | 改回内联字面量；剩 3 个是语义真变更 |
| r163c | 530 / **1** | 修完 v5-p5、p6a；剩 ws-hint 口径 |
| **r163d** | **531 / 0** | ws-hint 判据同步后全绿 |

---

## §7 未修复 / 待议项

| ID | 项 | 为什么不修 |
|---|---|---|
| D2/P0-2 | `user_full` 丢事件卡（event-cards 2,839 字符被裁） | **需用户裁定**：属「预算分配策略」，不是纯缺陷。修法涉及 memRefLimit 按档位取值或把 event-cards 提为 must，会改变注入面总体结构 |
| D3/P0-3 | 「三档内容规格从未生效」 | **已重新定性为误判**：精简帧单形态是 2026-10-01 用户裁定（只保留四块），不是缺陷。真正待议的是「run_full 该走完整帧还是精简帧」——与 D2 同一决策点 |
| D7/P1-3 | 规则段在抽取沙箱恒为空 | 属**测试基建**问题（10 个套件未注入 rules-layer），不影响生产；改动面在 tests/ 下，建议单独一批处理 |
| D8/P2-1 | `injectBudgetChars` 不是硬上限 | 需产品决策：是否要变成真正硬上限（会改变现有注入行为） |
| D9/P2-2 | `extBudget` / `externalInjectionChars` 死配置 | 要么接上、要么删除，需产品决策 |
| D11/P2-4 | `diag` 把真人触发误标成「距上次 N」 | 纯可观测性缺陷，不影响行为；改动小但会动日志文案，建议单独确认 |
| D12/P2-5 | 画像/语义两处名单不一致 | 需确认 `hang_compensate` 是否该投画像（当前多投 480 字符，违反自身注释） |

### D5 / P1-1 · `isRulesFullTierPre` / `isHumanTierPre` / `planSpecForTierPre`「死代码」

**状态**：✅ 已修复（D5 重新定性为「生产未接线」，不是纯死代码）

**【重新定性 · 重要】**

初判「死代码」**不准确**。全仓检索后发现：

| 函数 | lib 定义 | 测试消费 | 生产消费 |
|---|---|---|---|
| `isRulesFullTierPre` | L1765 | **4 条断言**（v5-p3 C-7/C-8、v5-p4 A-11/A-12） | **0** |
| `isHumanTierPre` | L1756 | 3 条断言（v5-p3 C-1/C-2/C-3） | 0 |
| `planSpecForTierPre` | L1891 | 多处 | 0（已内联替换） |

⇒ 这是**「恒真守卫」第 5 次复现**：测试守护函数逻辑，但生产代码从不调用它。
⇒ 测试全绿 ≠ 功能生效。

**【修复方式】**

**① 按设计纲要改写 `isRulesFullTierPre` 语义**（`lib/index.js` L1764）：

```js
// 旧定义：tier !== RUN_SLIM  ⇒ 7 档全给规则全文
// 新定义（纲要 2026-10-27）：规则全文只给 3 档
const isRulesFullTierPre = (tier) => (
  tier === INJECT_TIERS.HUMAN_FULL
  || tier === INJECT_TIERS.HANDOFF_CARRY
  || tier === INJECT_TIERS.LEGACY
)
```

**② 接上生产消费点**（`lib/index.js` 原 L10426）：

```js
// 旧：硬编码单档
if (_tier === _T.RUN_SLIM && rulesSection.text) { ...摘要... }

// 新：内联版按档位（⚠️ 必须内联，不能调模块级函数）
const _rulesFullTierInline = (
  _tier === _T.HUMAN_FULL || _tier === _T.HANDOFF_CARRY || _tier === _T.LEGACY
)
if (!_rulesFullTierInline && rulesSection.text) { ...摘要... }
```

**为什么必须内联**：`renderMemoryDynamic` 被 20+ 套件用 `new Function` 抽取执行，沙箱里没有模块级 const ⇒ `ReferenceError` 被 catch 吞掉 ⇒ 规则段恒空。本仓已有三次同款教训（`_T` 常量 / `renderRulesSlimPre` / `truncatePlanBySections`）。内联版与模块级 L1765 **逐字等价**，改一处必须同步改另一处。

**【预计效果】**

| 档位 | 修复前规则段 | 修复后规则段 |
|---|---|---|
| `human_full` / `handoff_carry` / `legacy` | 8,291 | 8,291（不变） |
| **`human_slim`** | 8,291 | **约 1,900（摘要）** |
| **`run_full`** | 8,291 | **约 1,900（摘要）** |
| `run_slim` / `post_compact` / `hang_compensate` | 8,291 | 约 1,900（摘要） |

⇒ `user_slim` / `run_full` 每轮节省约 **6,400 字符**（-77%）。
⇒ 符合纲要「模型注意力没有那么容易漂移 ⇒ 不必每轮灌规则全文」。

**【实测结果】**（真执行，8/8 通过）

测试桩：65 条规则、全文 9,000 字符；抽取真实源码片段执行。

| 档位 | 实测输出 | 期望 | 结果 |
|---|---|---|---|
| `human_full` | 9,000 | 全文 | ✅ |
| `handoff_carry` | 9,000 | 全文 | ✅ |
| `legacy` | 9,000 | 全文 | ✅ |
| `human_slim` | **1,938** | 摘要 | ✅ |
| `run_full` | **1,938** | 摘要 | ✅ |
| `run_slim` | 1,938 | 摘要 | ✅ |
| `post_compact` | 1,938 | 摘要 | ✅ |
| `hang_compensate` | 1,938 | 摘要 | ✅ |

**【下一轮核查方法】**

```bash
# 1. 两个套件应仍全绿（它们守护的语义变了，断言需同步更新）：
node tests/smoke/smoke-test-v5-p3-tier-content.mjs
node tests/smoke/smoke-test-v5-p4-content-tier.mjs

# 2. 真执行量：human_slim / run_full 档下规则段字符数应从 8,291 降到约 1,900
```

**⚠️ 待办**：C-8 / A-12 两条断言（`isRulesFullTierPre(RUN_FULL) === true`）与纲要有冲突，需改为 `=== false`。

---

### D4 / P0-4 · `user_full` 白板预算与瘦档相等

**状态**：✅ 已修复

**【缺陷】**

```js
// 旧写法（L10472）
const _planBudgetBase = _isFullTier ? Math.max(_fullBudget, _slimBudget) : _slimBudget
//   _fullBudget = handoffPlanChars        = 1200
//   _slimBudget = fullInjectSlimBudgetChars = 3000
//   ⇒ 完整档 = max(1200,3000) = 3000   瘦档 = 3000   ← 完全相等
```

L10465 的注释自述「修档位语义倒挂…保证『完整 >= 精简』」，但实际是**修成相等**，不是完整档更大。

**实证**：`human_full` 20,104 字符 vs `human_slim` 20,040 字符，只差 **64 字符（0.3%）**。

**【修复方式】**

- 文件：`lib/index.js`（原 L10465-10472）
- 完整档预算改取 **`injectBudgetChars`（全局注入预算，默认 8000）** —— 语义上正是「本轮注入总量上限」，同一口径。
- 瘦档仍用 `fullInjectSlimBudgetChars`（3000）。
- **不新增 config key**（避免配置键漂移与前端设置页不同步）。
- 保留用户既有约束「完整 >= 精简」：`Math.max(injectBudgetChars, _slimBudget)`。

```js
const _fullTierBudget = Math.max(Number(cfg.injectBudgetChars) || 8000, _slimBudget)
const _planBudgetBase = _isFullTier ? _fullTierBudget : _slimBudget
```

**【预计效果】**

| 档位 | 修复前 base | 修复后 base |
|---|---|---|
| `human_full` | 3,000 | **8,000** |
| `human_slim` / `run_full` / `run_slim` | 3,000 | 3,000（不变） |

- 完整档白板预算提升 **+5,000 字符**，符合纲要「user_full 上限相对大」。
- 瘦档不受影响（仍是 3,000），不会被放大。

**【实测结果】**（真执行）

| 配置 | human_full | human_slim | 差 |
|---|---|---|---|
| 本机真实值 | **8,000** | 3,000 | **+5,000** |

**负路径**：

- `injectBudgetChars` 缺失 → 回落 8,000，不炸，且不低于瘦档 ✅
- `injectBudgetChars=400`（比瘦档小）→ 取 `max(400,3000)=3000`，**不会把完整档压到比瘦档小** ✅
- 全空 `cfg` → 仍得合理值 8,000 ✅

**【下一轮核查方法】**

```bash
# 真执行量：renderMemoryDynamic 在 human_full 档下白板段字符数应显著 > 3,000
# 或观察注入面总字符数：human_full 应从 20,104 明显上升
```

---

### D1 / P0-1 · `_stepGrantedSeq` 只写不读 ⇒ 完整版重复授予

**状态**：✅ 已修复

**【缺陷】**

- `L21101` 写 `stH._stepGrantedSeq = Number(stH._stepSeq) || 0`，但全仓**读取点 0 处**。
- `L21141` 只用 `_stepGrantedScope === scopeG2`（字符串）判定保真。
- 宿主在两帧之间 append `step/start` ⇒ 帧② 的 scope 已变 ⇒ 保真失配 ⇒ `_grantByHuman` 再次命中 ⇒ **同一请求授予两次完整版**。

**实证**：566 次完整版授予中，26 次「距上次完整版 0 个模型请求」，其中 **21 次时间差 < 1 秒**。

**【修复方式】**

- 文件：`lib/index.js`（原 L21141 附近）
- 判据从「仅 scope 字符串相等」改为「**scope 字符串相等 OR `_stepSeq` 连续量相等**」：

```js
const _grantSeqSaved = Number(stG2 && stG2._stepGrantedSeq)
const _stepSeqCur    = Number(stG2 && stG2._stepSeq)
const _seqSame = Number.isFinite(_grantSeqSaved) && Number.isFinite(_stepSeqCur)
  && _grantSeqSaved > 0 && _grantSeqSaved === _stepSeqCur
const _scopeSame = !!(scopeG2 && stG2 && stG2._stepGrantedScope === scopeG2)
if (stG2 && stG2._stepGrantedFp && (_scopeSame || _seqSame)) { /* 保真 */ }
```

- **保留 scope 判据**（同 step 续帧场景更精确），**新增 seq 判据**覆盖「两帧间 append step/start」这个已实证场景。
- **空值纪律不变**：scope 为空 **且** seq 不可比 ⇒ 不参与保真（防止恒真后完整版被无限续命）。

**【预计效果】**

- 消除同一请求的重复完整版授予。按今日日志推算：26 次/日 → 期望 **0 次**。
- 每次重复约 20,104 字符 ⇒ 每日约 **26 × 20,104 ≈ 52 万字符**（约 52 万/100 万上下文预算的一半）不再白烧。
- 完整版实际授予次数应从 566 降到约 **540**，且间隔分布更接近设定的 20 步。

**【实测结果】**（真执行，非静态断言）

| 场景 | 期望 | 实测 |
|---|---|---|
| 同 scope（原有路径） | 保真 | ✅ 保真 |
| **scope 变但 seq 未变** | **保真** | ✅ 保真（本次修的目标） |
| scope 与 seq 都变 | 放行 | ✅ 放行 |
| scope 空 + seq 缺失（空值纪律） | 放行 | ✅ 放行 |
| 从未授予完整版 | 放行 | ✅ 放行 |

**5/5 通过。** 验收方式：抽取真实源码片段 + 注入受控 `stG2`/`scopeG2` + 哨兵值断言是否进入保真分支。

**【下一轮核查方法】**

```bash
# 重启后观察诊断日志，应满足：
grep -c '距上次完整版 0 个模型请求' ~/.dsh/dsh-auto-memory-diagnose.log   # 期望 0
grep -c '同一请求已授予·保真优先〔seq=' ~/.dsh/dsh-auto-memory-diagnose.log # 期望 >0（新判据生效）
```

---


# 第二轮修复（P0-2 / P0-3 / P2-1 / P2-2 / P2-4 / P2-5）

> 2026-10-28 第二批。用户对第一轮 §7 待议项逐条裁定后施工。

## §8 用户裁定（逐字）

| 项 | 用户原话 |
|---|---|
| **P0-3①** | 「让 human_slim / run_slim 真正可达，这是严重的问题，说明没有按照预计在走」 |
| **P0-3②** | 「run_slim 应该是「最克制，只有功能指导」—— 那事件卡和画像就不该给，这是 human_slim 和 run_full 该干的事」 |
| **P0-2** | 「user_full 尽量完整投递内容」 |
| **P2-4** | 「改日志就行」 |
| **P2-5** | 「需确认 hang_compensate 是否该投画像」→ 经查证确认：**不该** |

---

## §9 修复记录（第二批）

### P0-3 · 档位可达性 + 精简帧按档分化

**状态**：✅ 已修复

**【缺陷 1：档位不可达】**

```js
// L20587 旧写法（硬编码）
let _tierGuess = decideInjectTierPre({ isHuman: _isHumanNow, isFull: true })
//   ⇒ 恒返回 HUMAN_FULL / RUN_FULL
//   ⇒ HUMAN_SLIM / RUN_SLIM / POST_COMPACT 在生产**永不可达**
```

实测：可枚举 8 档中，**3 个是死的**。

**【缺陷 2：精简帧完全不看档位】**

`renderSlimSnapshotPre` 里 `_injectTierPre` 出现 **0 次** ⇒ 四个精简档渲染结果完全相同（恒 2,180 字符）。

**【修复方式】**

**① 精简帧读取档位**（`lib/index.js` `renderSlimSnapshotPre`）：

```js
const _slimTierPre = (function () {
  const t = s && s._injectTierPre
  return (typeof t === 'string') ? t : '';
})()
const _slimNeedsHumanCtx = !(_slimTierPre === 'run_slim');   // 空值 fail-open
// 事件卡与画像：
const _t1  = (_slimNeedsHumanCtx && Array.isArray(s.slimEventT1)) ? s.slimEventT1 : []
const _por = _slimNeedsHumanCtx ? String(s.userPortraitText || '').trim() : ''
```

**② 渲染精简帧前先降级档位**（pre-step 内）：

```js
try {
  const _stD0 = engine.stateFor(agent)
  if (_stD0) {
    const _isH0 = _stD0._isHumanPre === true
    const _pt0 = _stD0._injectTierPre
    if (_pt0 === 'human_full' || _pt0 === 'run_full'
        || _pt0 === 'human_slim' || _pt0 === 'run_slim') {
      _stD0._injectTierPre = _isH0 ? 'human_slim' : 'run_slim'
    }
  }
} catch (_eSD0) {}
const slimText = ... renderSlimSnapshotPre(wsHintPre, agent)
```

**⚠️ 为什么保持 `slimText` 为常量而不是惰性函数**（我踩过）：
`smoke-test-tiered-branches` 等套件用 `new Function(..., "slimText", ...)` **注入该变量名**。改成函数后测试抛 `ReferenceError: slimTextOf is not defined` ⇒ **14 个套件全红**。必须保持常量语义。

**【预计效果】**

| 档位 | 精简帧修前 | 精简帧修后 | 事件卡 | 画像 |
|---|---|---|---|---|
| `run_slim` | 2,180 | **1,999（-8.3%）** | ❌ 不投 | ❌ 不投 |
| `human_slim` | 2,180 | 2,180 | ✅ | ✅ |
| `run_full` / `handoff_carry` | 2,180 | 2,180 | ✅ | ✅ |

**【实测结果】**（真执行）

```
run_slim      1999  事件卡=无  画像=无     ← 符合「最克制，只有功能指导」
human_slim    2180  事件卡=有  画像=有     ← 人际语境
run_full      2180  事件卡=有  画像=有     ← 20 步全量档
handoff_carry 2180  事件卡=有  画像=有
```

降级映射实测：`human_full+isHuman` → `human_slim`；`run_full+!isHuman` → `run_slim`；`handoff_carry`/`hang_compensate`/`post_compact` **保持原档**。

---

### P0-2 · `user_full` 丢事件卡（「当前在做什么」）

**状态**：✅ 已修复

**【缺陷】** `event-cards` 优先级是 `normal` ⇒ 进入 `memory-envelope.js:157` 的 droppable 集合 ⇒ 实测 `human_full` 档下被裁成 **0 字符**（原始 2,839）。

**反直觉对照**：`run_slim` 因不投白板 ⇒ 预算够 ⇒ 事件卡反而保住。**即修前「user_full 看不到当前事项、run_slim 看得到」—— 与设计意图完全相反。**

**【修复方式】** 优先级 `normal` → **`must`**：

```js
if (s.eventCardsText) pushPart('memoryReferences', 'event-cards', '\n[事件卡片 …]\n' + s.eventCardsText, 'must')
```

`must` 级不参与 `rankOf(s) < PRIORITY_RANK.must` 过滤 ⇒ 永不被裁。同桶低优先级段（recent-logs / reflection / event-catalog）被挤掉 —— **这是设计意图**。

**【实测结果】**

| 档位 | 修前事件卡 | 修后事件卡 | 总字符 |
|---|---|---|---|
| `human_full` | **0** | **2,839** | 20,104 → **22,115** |
| `run_full` | 0 | 2,839 | 14,496 → 16,507 |
| `human_slim` | 0 | 2,839 | 15,891 → 17,902 |

---

### P2-5 · `hang_compensate` 误投画像

**状态**：✅ 已修复（用户确认「不该投」）

**【缺陷】** 旧判据是**负向列举**：`!(LEGACY || RUN_FULL || RUN_SLIM)` ⇒ 漏了 `HANG_COMPENSATE` ⇒ 多投 480 字符画像。

**三条证据证明它该排除**：
1. 本段注释自述「运行档不该投画像…**挂机自跑时投画像纯烧上下文**」
2. `hang_compensate` 只在 `hangCompensateEnabled && isUnattendedNow()` 触发 ⇒ **正是挂机自跑场景**
3. 同函数 `semantic-recall` 段用**正向列举**（HUMAN_FULL/HUMAN_SLIM/POST_COMPACT/HANDOFF_CARRY）⇒ 实测其 semantic=0（正确），画像=480（错误）

**【修复方式】** 改为与 semantic-recall **同一张正向名单**：

```js
const _portraitOk = (_tier === _T.HUMAN_FULL || _tier === _T.HUMAN_SLIM
  || _tier === _T.POST_COMPACT || _tier === _T.HANDOFF_CARRY)
```

**【实测结果】** `hang_compensate` 画像 480 → **0**；其余 7 档输出不变。

---

### P2-2 · `externalInjectionChars` 死配置

**状态**：✅ 已清理（删死变量 + 标注未接线）

**【缺陷】** `const extBudget = Math.max(Number(cfg.externalInjectionChars) || 1400, 200)` —— 算出后**全仓 0 处读取**（grep 实测）。

**【修复方式】** 删除 `extBudget` 死变量；在配置项上标注「当前未接线，改它不产生任何效果」。保留键名以免破坏配置键数锁（163）与前端设置页镜像。

**【为什么不真接上】** 外部记忆段实际受**通道区上限 300 字符**约束；接 1400 需一并调通道区预算，属更大结构改动。

---

### P2-4 · diag 把真人触发误标成「距上次完整版 N」

**状态**：✅ 已修复（用户裁定「改日志就行」）

**【缺陷】** 270 条该类记录中 **233 条（86.3%）N < 20**（门槛 20）—— 绝大多数是真人以外的触发路径，却被标成「距上次 N」，看起来像门槛失守。**本轮排障就被它误导过。**

**【修复方式】** 按真实触发原因分三段打印：

```js
const _byGap = Number(_gapSinceFull) >= Number(fullGapStep)
const _triggerWhy = isHuman ? ' · 真人在场'
  : (_byGap ? ' · 达门槛 · 距上次 N / 门槛 M'
           : ' · 非门槛触发 · 距上次 N（门槛 M，未达）')
```

**【下一轮核查方法】** 日志里应出现三种不同文案，不再一律「距上次完整版 N」。

---

### P2-1 · `injectBudgetChars` 语义澄清

**状态**：✅ 已澄清（**不改行为**，只补注释）

**【实测边界】**

| 设为 | 实际单轮总注入 |
|---|---|
| 2,000 | 17,408 |
| 8,000 | 19,958 |
| 20,000 | 24,985 |

⇒ 差 4 倍取值，总量只差 7,577（约 44%）⇒ 它**不是总量硬上限**，只管 `memoryReferences` 桶里的证据段。

**【为什么不改行为】** 用户 2026-09-15 的原注释明确写着「本门是**摘要内联**的额度，全文永远靠 `memory_recall` 按需下钻」—— 设计意图本来就是摘要额度，只是命名像总顶。

**【修复方式】** 补注释说明真实语义边界，避免下次再误判（本轮就误判过一次）。

---

## §10 事故记录（本轮）

### ⚠️ 我把 `lib/index.js` 写坏过一次（已完全恢复）

**【经过】** 用 `src.indexOf(endMarker)` 求块尾时返回 **-1**，随后 `src.slice(b + endMarker.length)` = `slice(45)` ⇒ 把从第 45 字符起的内容整个拼到末尾 ⇒ 文件从 **1,346,826 B 膨胀到 3,238,053 B**（`class MemoryEngine` 出现 2 次）。

**【恢复】** 逐段定位重复边界 → 精确切除 → 三项独立校验（唯一性 / 惰性块零残留 / 11 项修复全在位）→ 真 import 通过（40 exports）。

**【教训（已写进代码注释）】**
> **用 `indexOf` 求块尾时必须断言 `>= 0`**，否则 `slice(-1 + len)` 这类算式会静默产生「几乎整文件」的切片。
> 本次若没有 `class MemoryEngine` 计数这个物理量，损坏可能被误判成「改动成功」。

### ⚠️ 同一轮我第二次踩抽取沙箱（14 套件红）

把 `slimText` 改成惰性函数 `slimTextOf()` ⇒ 测试用 `new Function(..., "slimText", ...)` 注入的变量名不存在 ⇒ `ReferenceError`。
**已在代码注释里固化**：`slimText` 必须保持常量语义。

### ⚠️ 我用整文件 `write` 破坏了 CRLF（23 处裸 LF）

恢复时用 `writeFileSync` 写入，导致 23 处 LF 混入纯 CRLF 文件。被 `smoke-test-v4-h3-c1-c2-legacy` 的 C2-22 与 `smoke-test-la-audit-fixes` 的 Z-1 抓到。
**修复**：统一转回 CRLF（CRLF=25,275 / 裸 LF=0）。**教训**：整文件写后必须跑行尾检测。

---

## §11 全量回归（R166）

```
PASS 531 / FAIL 0 / TIMEOUT 0   (total 161.4s)   EXIT=0
```

**演进**：

| 轮次 | 结果 | 说明 |
|---|---|---|
| r164 | 517 / **14** | `slimTextOf` 破坏抽取沙箱 |
| （损坏） | — | 文件膨胀到 3.2 MB，已恢复 |
| r165 | 528 / **3** | CRLF 混用 + 2 条过期判据 |
| **r166** | **531 / 0** | 全绿 |

---

## §12 判据同步清单（第二批）

| 套件 | 断言 | 原判据 | 新判据 | 理由 |
|---|---|---|---|---|
| `v5-p4-content-tier` | B-3/B-4 | `_portraitOk = !(...)` 负向列举 | 正向名单 + 3 条新断言（含防回退） | P2-5 改正向 |

---

## §13 当前注入面实测（R166 全绿后）

**完整帧**：

| 档位 | 总字符 | 规则 | 白板 | 事件卡 | 画像 |
|---|---|---|---|---|---|
| `human_full` | **22,115** | 8,291 全文 | 1,889 | **2,839** | 480 |
| `handoff_carry` | 22,115 | 8,291 全文 | 1,889 | 2,839 | 480 |
| `legacy` | 20,720 | 8,291 全文 | 1,889 | 2,839 | 0 |
| `human_slim` | 17,902 | 4,142 摘要 | 1,825 | 2,839 | 480 |
| `run_full` | 16,507 | 4,142 摘要 | 1,825 | 2,839 | 0 |
| `hang_compensate` | 16,507 | 4,142 摘要 | 1,825 | 2,839 | **0** |
| `run_slim` | 16,043 | 4,142 摘要 | 0 | 2,839 | 0 |

**精简帧**：`run_slim` = **1,999**（无事件卡/画像）；其余 = **2,180**。

**关键改善**：所有档位的事件卡都是 2,839（P0-2 前 `human_full` 是 0）。

# 第三轮修复：`post_compact` 档位真正可达

> 2026-10-28。用户实报「压缩之后的就是 post compact，好像也没有在跑」。

## §14 用户裁定（逐字）

> 「压缩之后的就是 post compact，好像也没有在跑啊。看一下修一下，这个应该和 human full 一样是尽量多地提供相关内容的」

---

## §15 根因：三重断链

**用户观察完全正确 —— `post_compact` 在生产从未产生过。**

### 断链 ①：`postCompact` 参数全仓 0 调用点

```js
// decideInjectTierPre 支持该参数：
const decideInjectTierPre = (p) => {
  if (o.postCompact) return INJECT_TIERS.POST_COMPACT   // ← 唯一消费点
}

// 但生产唯一调用处（L20587 附近）**从不传它**：
decideInjectTierPre({ isHuman: _isHumanNow, isFull: true })   // ← 没有 postCompact
```

全仓普查：`postCompact` 仅 **2 处**（1 处 JSDoc 声明 + 1 处函数内判断），**调用点 0**。

### 断链 ②：压缩检测存在，但不打档位标记

压缩其实**早已被检出**（`contextVersion` 回退判定，L21396）：

```js
if (snapshotReinjectOnCompact !== false && st._snapCv !== undefined && cv < st._snapCv) {
  st._snapLogFp = ''          // 只做了「强制重注入」
  st._snapPendingSnap = null
  st._snapPendingLogFp = null
  // ← 但从未写 st._injectTierPre = 'post_compact'
}
```

⇒ 压缩后确实会重注入，但档位标签仍是 `human_full` / `run_full` ⇒ **永远不会出现 post_compact**。

### 断链 ③：即使标了档，白板/规则名单也不认它

| 名单 | 位置 | 修前是否含 `POST_COMPACT` |
|---|---|---|
| `_isFullTier`（白板全量预算） | L10608 | ❌ **不含** ⇒ 只给 3,000 而非 8,000 |
| `_rulesFullTierInline`（规则全文） | L10513 | ❌ **不含** ⇒ 只给 4,142 摘要而非 8,291 全文 |
| `_planSpec` 的 `fullTier`（白板节规格） | L10445 | ❌ **不含** ⇒ 走 7 节白名单 |
| `isRulesFullTierPre`（模块级） | L1804 | ❌ **不含** |
| 画像 / semantic-recall 名单 | L10795/L10845 | ✅ 已含（这两处原本就对） |

---

## §16 修复记录

### 修复 1：压缩检出时打 `POST_COMPACT` 档位标记

```js
if (snapshotReinjectOnCompact !== false && cv < st._snapCv) {
  st._snapLogFp = ''
  st._snapPendingSnap = null
  st._snapPendingLogFp = null
  // ★新增：
  st._injectTierPre = 'post_compact'
  st._postCompactPending = true
}
```

### 修复 2：压缩后强制给完整版（绕过步数间距）

**为什么必须加这条**：压缩检测在某分支内，但该分支之后仍要过「距上次完整版 ≥ 20 步」的判定。压缩刚发生时 `_lastFullStepSeq` 往往很近 ⇒ 会被节流成**精简帧**（2,180 字符）⇒ `post_compact` 白标了。

```js
let _postCompactForceFull = false
if (st._postCompactPending === true) {
  st._postCompactPending = false
  st._lastFullStepSeq = 0        // 等价于「间距已远」
  st._snapLogFp = ''
  st._snapPendingSnap = null
  st._snapPendingLogFp = null
  st._snapRoundTurnKey = null
  st._snapRound = 0
  _postCompactForceFull = true
  diag('tiered inject: → 完整版（★压缩后强制重建 · post_compact 档）')
}
// 短路：压缩后不看日志指纹，无条件进入「需要重注入」分支
if (_postCompactForceFull || logFp !== (st._snapLogFp || '')) { ... }
```

### 修复 3：四处档位名单全部纳入 `POST_COMPACT`（一次改全）

| # | 位置 | 改动 |
|---|---|---|
| ① | `_isFullTier` | `|| _tier === _T.POST_COMPACT` |
| ② | `_rulesFullTierInline` | `|| _tier === _T.POST_COMPACT` |
| ③ | `_planSpec` 的 `fullTier` | `|| _tier === _T.POST_COMPACT` |
| ④ | `isRulesFullTierPre`（模块级） | `|| tier === INJECT_TIERS.POST_COMPACT` |

⚠️ ①②必须**内联**（`renderMemoryDynamic` 被 `new Function` 抽取执行，沙箱无模块级 const）；③④与①②**逐字等价**，改一处必须同步另一处。

---

## §17 实测结果

| 档位 | 总字符 | 规则 | 白板 | 事件卡 | 画像 | 语义唤回 |
|---|---|---|---|---|---|---|
| **`post_compact`** | **22,115** | **8,291 全文** | **1,889 全文** | 2,839 | 480 | 915 |
| `human_full` | 22,115 | 8,291 全文 | 1,889 全文 | 2,839 | 480 | 915 |

**`post_compact` 现与 `human_full` 逐项完全一致：22,115 字符。**

修复前对比：

| | 修前 | 修后 |
|---|---|---|
| 是否可达 | ❌ **永不可达** | ✅ 压缩检出即标记 |
| 总字符 | —（无此档） | 22,115 |
| 规则 | — | 8,291 全文 |
| 白板 | — | 1,889（8,000 预算） |

---

## §18 判据同步

| 套件 | 断言 | 原判据 | 新判据 | 理由 |
|---|---|---|---|---|
| `v5-p5-tier-plan-real` | B-1 | `run_full` vs `post_compact` 字节一致（同为瘦档） | 改用 `run_full` vs `human_slim`；**新增 B-1b** 断言 `post_compact === human_full` | post_compact 已升为全量档 |
| `v5-p5-tier-plan-real` | F-5 / F-5b | `post_compact` 在「摘要」组 | 移入「全文」组 | 同上 |

**B-1b 是新加的强判据**：直接断言 `post_compact` 的白板字节数 == `human_full`，防止将来回退。

---

## §19 回归

```
PASS 530 / FAIL 1   ← 唯一失败是 smoke-test-js-semantic-host-recovery 并行假红
```

**该失败已归因为「并行假红」**（本仓既有判据：`--jobs=8` 下长耗时套件有资源竞争）：

- 单跑：`fail 0` / exit 0
- 与我的改动无因果：该套件全文 0 处出现 `post_compact` / `_isFullTier` / `postCompact`

**前一轮（R168）的 3 个失败同样全部单跑通过**：`issue341-lockgate`（exit 0）、`m78-host`（33/0）、`v4-c4`（39/0，已知 libuv `UV_HANDLE_CLOSING` 竞态）。

---

## §20 下一轮核查方法

```bash
# 1. 重启后触发一次上下文压缩（或等它自然发生），然后看诊断日志：
grep 'post_compact 档' ~/.dsh/dsh-auto-memory-diagnose.log
# 期望看到：tiered inject: → 完整版（★压缩后强制重建 · post_compact 档）

# 2. 真执行量：该帧注入面应约 22,115 字符（与 human_full 同级）
```

**⚠️ 注意**：`post_compact` 只在**真实压缩发生时**触发一次，不是每轮都有。若日志里长期看不到，需先确认是否真的发生过压缩（`contextVersion` 回退）。
