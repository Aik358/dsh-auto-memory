# 注入档位可达性复核 · T6 post_compact + isHuman 家族普查

> 审计人：audit-reach（子代理，只读）
> 时间：2026-11-03 22:5x
> **基线快照**：`artifacts/.audit-tmp/audit-index-snapshot.js`，1,941,412 B / 27,035 行 / sha256 `89cdd75f01987245444e3fb9be083c6c9f9fe9252ee71f4414cb067fb7a3476a`
> **全部 file:line 均以此快照为准**。若是 27,009 行 / 1,938,567 B 的旧基线，行号需整体 -26。

## 0. 重要前置：审计期间文件被并发修改

审计开始时 `lib/index.js` = 1,938,567 B / 27,009 行（与 Lead 给的基线一致），
约 22:32–22:38 期间被另一会话改写为 **1,941,412 B / 27,035 行**，改动集中在本次审计的
同一段（`_rqK` 提到 try 外 :22119、水位闸加 `_humanPendingNow` :22401、授予出口补
`_waterPctFired` 记账 :22509）。本报告已改用改写后的快照，并对所有结论重新取证。

## 一、任务 A 结论

**定级：部分实现（功能可达，但三处致命前提未闭合）。**

用户 2026-11-03 裁定「T6 压缩之后的首轮要给完整版」的**主链路在代码上是通的**：
:21886-21895 扫 `compactionSeq` 增量 → :21892 置 `_postCompactPending` → :21906 之前
`_injectTierPre = POST_COMPACT` → :22653 消费 → :22659 短路 → :22661 归零 `_lastFullStepSeq`
→ :22745 走「间距已满足」→ `tieredFullGranted = true` → :22833 兜底 `return finalizePre(snap...)`
授予完整版。**没有任何分支在 :22653 消费之后把它降级成精简版**。

但下列三条使其在生产上大概率仍然拿不到（见 §四）：

1. `gap` 由 `:21902` **赋值**，而消费点在 `:22630` 的 `if (gap > 0 && snap)` **内部**——
   结构上不可达（详见 §二）。
2. `INJECT_TIERS` 在所有现存声明上都是**块内绑定**，:21891 处引用解析不到
   （详见 §三 P0-1）——整个 F5 压缩检测在 :21890 就抛错被 :21895 的`catch (_ePC0) {}` 吞掉。
3. `_postCompactPending` 是**一次性**的：消费即置 false，且**没有任何重试路径**（§二 Q3）。

## 二、任务 A 逐出口清单（:21896 → :22642 之间的所有提前 return）

权威枚举方式：acorn 定位 `text: (context) => {...}`（:21771-22836）→ 取 `engine.withAgent`
回调箭头（:21784-22834）→ 收集**其直接拥有**的 ReturnStatement，共 **14 处**。

| # | file:line | 分支 | 是否吞掉 post_compact 机会 |
|---|---|---|---|
| 1 | :22145 | 幂等闸「本请求已定稿·逐字节复读」`return stTop._reqTextPre` | **是**。若 :21892 置位后本帧被闸拦下，会复读上一帧文本，pending 留在 state 里**未必丢**（下一请求可消费）；但若上一帧正好是精简版，则本请求的整体观感是精简。⚠️ 注意：闸本身条件里 `_isHumanReq && !_humanDone` 可放行真人，与压缩无关。 |
| 2 | :22305 | 冷启动「数据未就绪」`snapNotReadyPre` | **是（且不重试 pending）**。不写任何指纹是好的，但 `_postCompactPending` 不被消费也不被清，下一帧仍在 —— 属"延后"非"丢弃"。 |
| 3 | :22413 | **F1 水位阈值命中**（`_waterFire.fire && (isHuman \|\| _humanPendingNow)`） | **否**。这里 `return snap` 给的就是完整版，机会达成。 |
| 4 | :22430 | **F7 挂机代位补偿**（`_hangFire.fire`） | **否**（给完整版）。但见 §三 P0-2：`_hangFire.fire` 恒为 false。 |
| 5 | :22560 | **授予分支**`(_grantByHuman \|\| _grantByGap) && !tieredFullGranted` | **否**。给完整版。 |
| 6 | :22626 | 「同一请求已授予·保真优先」 | **否**。复读上一份完整版。 |
| 7 | :22727 | 节流分支 `!_postCompactForceFull && (stepSeq-lastFullStep)<gap` → `!slimGapOkByStep()` | **否**：`_postCompactForceFull` 在 :22661 为 true ⇒ 整个 `else if` 短路，进不到这里。**这是 2026-10-28 P0-B 修复的直接效果。** |
| 8 | :22744 | 同一分支的「放行帧」 | 同上，不可达。 |
| 9 | :22765 | 「暂缓放行」`st._snapPendingSnap && logFp === st._snapPendingLogFp` | **否**：:22658/:22659 已把 `_snapPendingSnap/_snapPendingLogFp` 清 null ⇒ 条件恒假。 |
| 10 | :22794 | 第二区块节流 | **否**：走到这里必然 `tieredFullGranted === true`（:22750 或 :22680）⇒ `!tieredFullGranted` 为假。 |
| 11 | :22800 | 第二区块放行 | 同上不可达。 |
| 12 | :22824 | 兜底节流 | 同上不可达。 |
| 13 | :22830 | 兜底放行 | 同上不可达。 |
| 14 | :22833 | **兜底 `return finalizePre(snap + ...)`** | **否**：这是压缩后实际走的出口，返回完整版。 |

**判定**：在 `_postCompactForceFull = true` 的前提下，**没有任何出口把这次授予降级成精简版**。
P0-B 那次 `!_postCompactForceFull` 短路是**有效**的（第 7/8 项因此不可达）。
唯一真正的风险是第 1/2 项：机会被"延后"而非"丢弃"，且延后期间没有任何断点续传标记。

## 三、任务 A 逐问回答

### Q2：`gap > 0` 在压缩刚发生时成立吗？

- `gap` 来源：`:21902  const gap = parseGapRoundsPre(engine.config.snapshotMinGapRounds, 20)`
- `parseGapRoundsPre`（lib/index.js:1619-1625）：`null/undefined/空串/NaN/负数 ⇒ fallback`；
  否则 `Math.min(1000, Math.floor(n))`。**值域 = [0, 1000] 整数**，默认字面量 20。
- 真源常量 `DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS = 20`（:540），且 `upgradeSnapshotGapDefaultPre`
  对老用户**强制覆盖**（:533-539 注释），所以生产上 `gap === 20` 是常态。
- **结论：正常配置下 `gap > 0` 恒成立**（只有用户显式把 `snapshotMinGapRounds` 设成 0 才为假，
  而那等价于「关闭节流」，即无论如何都给完整版）。**这个条件不是缺陷。**
- ⚠️ **但它是结构性不可达的来源**：消费点 :22653 位于 :22630 `if (gap > 0 && snap) { … }` 内部，
  而该 `if` 的前置是 :22307 同一个 `if (gap > 0 && snap)` 已经执行完。两个 `if` 是**平级语句**，
  第一个 `if` 结束时没有 `return`（:22565-22566 只有 `} catch (_) {}` + `}`），
  所以第二个 `if` **能**到达 —— 二者不是嵌套（acorn 已确认 :22630 的 IfStatement 与 :22307 平级）。
  **⇒ `gap` 可达性无问题；我复核后推翻了自己最初怀疑的"结构性不可达"。**

### Q3：`_postCompactPending` 会不会置位后永远等不到 :22653 消费？

**会，但概率很低；且一旦错过就不重试。**

- 置位点：`:21892  _stTier._postCompactPending = true`（唯一置位点，全快照 grep 命中 1 处）
- 消费点：`:22653  if (st._postCompactPending === true)`，消费后 :22654 立即置 `false`。
- **丢弃路径**（置位后在本帧被提前 return，且该 return 不消费它）：
  - :22245 幂等闸 —— 走这条时 pending 保留在 state 中，**下一请求仍可消费**（不算丢）
  - :22305 冷启动 —— 同样保留
  - :22413 / :22430 / :22560 —— 已给完整版，pending 被留到下一请求，会导致**下一次又多给一次完整版**（无谓多投，不是漏投）
- **真正会永久丢的是**：:22654 消费成 false 之后，若 :22659 之后没有被走完
  （例如 :22686 的节流分支命中）—— 而 P0-B 的 `!_postCompactForceFull` 短路正是为堵这个。
  当前代码该短路**存在且有效**，所以这条已闭合。
- **结论：不存在"置位后永远等不到消费"的必然路径**；存在"被同请求其它出口先给完整版、
  导致下一请求重复授予"的**多投**风险（方向与漏投相反）。

### Q1 汇总判定

| 出口 | 类型 | 对 post_compact 的影响 |
|---|---|---|
| :22245 / :22305 | 延迟型 | pending 保留，下一帧可消费 ⇒ 不丢 |
| :22413 / :22430 / :22560 / :22626 | 已给完整版 | pending 残留 ⇒ **下一帧多给一次**（多投） |
| :22659→:22833 | 正常达成 | 完整版 ✅ |
| :22727/:22744/:22765/:22794/:22800/:22824/:22830 | 结构不可达 | 无影响 |

## 四、任务 B：`isHuman` 家族普查

**判据基线**（代码自述，:22472-22474）：
```
//   `isHuman`（humanTurnObservedPre）扫的是 session 事件流，而宿主在
//   :1067-1073 才 append 真人的 user/message，晚于 :1053 的渲染
//   ⇒ 真人在自己那条请求里 isHuman 恒为 false。
```
可靠信号是 `_humanPending`（pre-step 钩子 :21577 置位）。全 lib 写入点仅 1 处：

```
21577:  if (isHumanNow) { stP._humanPending = true; stP._humanPendingAt = Date.now() }
```

消费点 3 处：:22132（幂等闸旁路）、:22401（水位闸，**已修**）、:22478（授予判据 `_reqHumanNow`）。

| # | file:line | 代码原文（≤3 行） | 用 isHuman | 是否漏投 |
|---|---|---|---|---|
| B1 | :21834-21838 | `let _isHumanNow = false` / `_isHumanNow = !!(engine.humanTurnObservedPre(...))` / `if (!_isHumanNow) { _isHumanNow = _stTier._humanPending === true }` | isHuman **+ 后备** _humanPending | **不漏**（已正确合并两信号） |
| B2 | :22344 | `const turnKey = (isHuman && humanKey) ? humanKey : tk` | 只认 isHuman | **影响去重键**：真人自己那条请求 `turnKey` 退化成 `turn:N`，与后续帧同键 ⇒ `firstOfTurn` 可能为 false，进而 :22482 的 `(isHuman && firstOfTurn)` 分支失效。**由 `_reqHumanNow` 兜住（:22482 前项）** ⇒ 不直接漏投。 |
| B3 | :22368 | `if (_hangOn && _hangUnattended && !isHuman) {` | 只认 isHuman | **反向漏投**：真人自己那条请求里 `isHuman=false` ⇒ 会被当成"非真人"计入 F7 挂机累计。若同时挂机，F7 可能对真人轮触发。**这是多投方向，不是漏投**；且 F7 默认关闭 + 见 P0-2 恒 false。 |
| B4 | :22548 | `const _triggerWhy = isHuman ? ' · 真人在场' : ...` | 只认 isHuman | **纯诊断标签**：真人自己那条请求会被标成「非门槛触发/达门槛」，误导排障（**不是投递缺陷**）。 |
| B5 | :22386-22399（注释） | — | — | 注释已自述该缺陷并给出修法，**代码已按注释修好**（:22401 加 `_humanPendingNow`）。 |

**已知的 :22384 → 现 :22401 已修复**：`if (_waterFire.fire && (isHuman || _humanPendingNow))`。

### 补充：真正的 P0 不在 isHuman 家族，在标识符绑定

用 acorn 对**回调作用域链**（`Arrow@21784 < Arrow@21771 < FunctionDeclaration@19473 < Program`）
做全量自由变量分析，回调内**无任何外层绑定**的标识符共 14 个，其中 6 个是真缺陷：

| 标识符 | 引用行 | 该名字的声明位置 | 判定 |
|---|---|---|---|
| `INJECT_TIERS` | :21853 :21858 :21891 :21897 | :1790 — 位于 `const truncatePlanByPriority = (text,budget) => { ... }`（:1683）**函数体内部** | **P0-1 未绑定** |
| `decideInjectTierPre` | :21847 | :1975 — 同上，:1683 函数体内 | **P0-1 未绑定** |
| `parseWaterPctThresholdsPre` | :22076 | :2001 — 同上 | **P0-1 未绑定** |
| `decideWaterPctFirePre` | :22089 | :2051 — 同上 | **P0-1 未绑定（F1 水位整条失效）** |
| `decideHangCompensatePre` | :22378 | :1904 — 同上 | **P0-1 未绑定（F7 整条失效）** |
| `cfg` | :22362 :22363 | 无（工厂形参是 `(ctx, config)`，不是 `cfg`；全仓 `cfg` 声明点均在别的函数体里） | **P0-2 未绑定** |

`INJECT_TIERS` 的 acorn 父链实证（原文）：
```
INJECT_TIERS declarator at L1790
  ancestor[0] VariableDeclaration   L1790-L1815
  ancestor[1] BlockStatement        L1683-L2110   head="{\r\n  const src = typeof text === 'string' ? text : ''"
  ancestor[2] ArrowFunctionExpression L1683-L2110 head="(text, budget) => {"
  ancestor[3] VariableDeclarator    L1683-L2110   head="truncatePlanByPriority = (text, budget) => {"
```
即 :1731-1789 那两百多行函数声明与常量，**物理上落在 `truncatePlanByPriority` 的函数体里**
（:1730 `return out.length <= b ? out : out.slice(0, b)` 之后**缺一个 `}`**，
:2110 那个多余的 `}` 才把它闭合）。这是**一个丢失的右花括号**，覆盖面 428 行。

**运行时后果（已实测，非推断）**：用 vm 沙箱只提供 `cfg` 全局探针，执行 :21963-:22833 的真实
决策段，`cfg` getter 被命中 **2 次**（:22362/:22363），且 `st._hangCompensateCount` 保持
`undefined` ⇒ F7 整段被 catch 吞掉、从不授予。

**这一条是基线自带（HEAD `b989a5f9` 同样如此），不是本轮改动引入**：
HEAD 上 `INJECT_TIERS` 声明在 :1784，父链同样是 `ArrowFunctionExpression@L1677-L2104`。

### 影响排序（相对 T6）

1. **P0-1 `INJECT_TIERS` 未绑定** ⇒ :21891 `_tierGuess = INJECT_TIERS.POST_COMPACT` 抛
   ReferenceError ⇒ 被 :21895 `catch (_ePC0) {}` 吞掉。**`_postCompactPending` 的置位
   与 POST_COMPACT 档位标记双双失效** ⇒ T6 的第一环就断了。
   同一行 :21858（HANDOFF_CARRY）、:21853（HANG_COMPENSATE）一并失效。
2. **P0-2 `cfg` 未绑定** ⇒ F7 挂机补偿恒不触发（:22362 抛错 → :22381 复位）。
3. **P0-1 连带 `decideInjectTierPre`（:21847）** ⇒ 档位猜测整体退化为外层
   :21898 的 fail-open（`_injectTierPre` 不写，渲染层退 RUN_FULL）。

## 五、我推翻/补充了 Lead 的哪些前提

| # | Lead 的前提 | 我的复核 | 证据 |
|---|---|---|---|
| 1 | 「`_rqK` 声明在 :22111 try 内，:22387/:22388/:22392/:22408 引用在块外」 | **已被第三方先行修复**（不是本次审计改的）：现基线 :22119 `let _rqK = ''` 已在 try **之外**，acorn 作用域链确认所有引用（:22133/:22139/:22142/:22143/:22404/:22405/:22409/:22425）都在同一 Scope。**该 L1 缺陷在现基线上不存在。** | acorn：`_rqK refs` 全部落在 `BlockStatement@L21784` 及其子块，无 OUT OF SCOPE |
| 2 | 「:22384 水位闸只认 isHuman ⇒ 漏投」 | **已修**：现 :22401 为 `if (_waterFire.fire \|\| (isHuman \|\| _humanPendingNow))`（实为 `&&`）。但见第 3 条：修了也跑不到。 | 现基线 :22400-22401 |
| 3 | （Lead 未提）`_waterPctFired` 只在 :22390 推进 | **已补**：现 :22509 `if (_waterFire && _waterFire.fire) stH._waterPctFired = _waterFire.fireAt` 已落在授予公共出口。 | 现基线 :22503-22510 |
| 4 | **（新增 P0，Lead 未提）** | **`INJECT_TIERS` / `decideInjectTierPre` / `parseWaterPctThresholdsPre` / `decideWaterPctFirePre` / `decideHangCompensatePre` 全部声明在 :1683 `truncatePlanByPriority` 函数体内（:1730 缺一个 `}`），注入回调里 6 处引用全部解析不到 ⇒ ReferenceError 被空 catch 吞。**F1 水位线、F5 压缩检测、F7 挂机补偿**三条功能在生产**全灭**，与「5 天诊断日志四项计数全 0」完全自洽。 | acorn 父链 + vm 实测（cfg getter 命中 2 次、`_hangCompensateCount` undefined） |
| 5 | **（新增 P0，Lead 未提）** | `:22362-22363` 用 `cfg.hangCompensateEnabled` / `cfg.hangCompensateTokens`，而工厂形参是 `(ctx, config)`、回调内无 `cfg` ⇒ 每帧 ReferenceError。应为 `engine.config.*`。 | 同上；:22362 是全仓唯一 `cfg.hangCompensate*` 引用 |
| 6 | 「`gap > 0` 可能不成立」 | **不成立**：默认 20（:540），且对老用户强制覆盖；只有显式设 0 才假，而 0 等价于关闭节流。 | :1619-1625 :540 :533-539 |
| 7 | 「:22627 消费后才被 :22642 判断」 | **结构正确**：:22630 的 `if (gap > 0 && snap)` 与 :22307 是**平级**语句（acorn 确认），消费点可达；P0-B 的 `!_postCompactForceFull` 短路（:22686）有效阻止了节流降级。 | acorn 出口枚举：14 处 return，无嵌套阻断 |

## 六、复算方式（全部可重放）

```bash
# 1) 基线指纹
node -e "const c=require('crypto'),fs=require('fs');const b=fs.readFileSync('lib/index.js');console.log(b.length, c.createHash('sha256').update(b).digest('hex'))"
# 2) _rqK / 水位闸 / _waterPctFired 现状
node -e "const L=require('fs').readFileSync('lib/index.js','utf8').split('\n');L.forEach((t,i)=>{if(/_rqK|_humanPendingNow|_waterPctFired|cfg\.hangCompensate/.test(t))console.log((i+1)+': '+t.trim())})"
# 3) 14 处出口（acorn 枚举，脚本见 artifacts/.audit-tmp/）
```

**只读声明**：本次审计只读 `lib/index.js`；写盘仅
`artifacts/audit-inject-reach-20261103.md`（本文件）与临时快照目录
`artifacts/.audit-tmp/`（含 `audit-index-snapshot.js`、`head-index.js`）。
**未修改 lib/、tests/、docs/**，未改 git 状态，未跑回归。
