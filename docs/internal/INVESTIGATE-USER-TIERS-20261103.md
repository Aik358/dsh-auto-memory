# 调查：user full / user slim 注入面（P9 / task-4）

> 调查日期：2026-11-03 · 只读调查，**未修改 lib/ 下任何文件**、未 commit、未改版本号。
> 判据基准：用户 2026-11-03 口述的三条设计意图（见 §2 引文）。
> 复算装置：`artifacts/inject-tiers-20261103/probe-tiers.mjs`（真引擎 + 真实记忆数据）。

---

## §1 现状表

### 1.1 分档开关（谁是「档」的真正开关）

结论先行：**本仓有两层完全独立的东西都叫「档」，且二者互不知情**。

| 层 | 名称 | 作用 | 定义位置 | 读取位置 |
|---|---|---|---|---|
| **A. 帧级开关**（真正决定「注多少」） | `snap`（全帧） vs `slimText`（精简帧） | 决定本轮返回 `renderMemoryDynamic()` 的 24,393 字，还是 `renderSlimSnapshotPre()` 的 2,219 字 | 判定：`lib/index.js:22449-22686`；渲染：全帧 `lib/index.js:10966`、精简帧 `lib/index.js:9834` | `lib/index.js:21883`（`const snap = engine.renderMemoryDynamic(context)`）、`lib/index.js:21916`（`slimText = engine.renderSlimSnapshotPre(...)`） |
| **B. 档位枚举**（只做内容微调） | `INJECT_TIERS` 8 档 | 只影响**全帧内部**各段的裁剪规格 | 枚举 `lib/index.js:1790-1815`；判定 `decideInjectTierPre` `lib/index.js:1975-1984` | 写入 state `lib/index.js:21880`；渲染器内读 `lib/index.js:11099-11105` |

**关键事实（A 层）**：全帧 / 精简帧的取舍函数把「完整版」写成三条独立旁路 + 一条门槛，全部在 `lib/index.js:22449-22518`：

```
22449  const _grantByHuman = _reqHumanNow || (isHuman && firstOfTurn)
22450  const _grantByGap   = byThreshold && (stepSeqNow - (Number(stH._lastFullStepSeq) || 0)) >= 1
22451  if ((_grantByHuman || _grantByGap) && !tieredFullGranted) { … return finalizePre(snap + …) }
```

**关键事实（B 层）**：档位枚举**不参与**「给全帧还是精简帧」的决定 —— 源码自己写明（`lib/index.js:1786-1788`）：

> 「⚠️ 本枚举的**唯一用途是内容差异化**，不改变「给完整版还是精简版」的既有节奏判定（那个由 `snapshotMinGapRounds` / `slimEveryRounds` / 真人旁路 / 水位阈值决定）。」

### 1.2 档位判定链：全帧渲染器永远只看到 `*_full`

| 顺序 | 代码 | 写入的 `_injectTierPre` |
|---|---|---|
| ① 乐观判定 | `lib/index.js:21831` `decideInjectTierPre({ isHuman, isFull: true })` —— **`isFull` 硬编码 true** | `human_full` / `run_full`（+ 条件性 `post_compact` `hang_compensate` `handoff_carry`） |
| ② 写 state | `lib/index.js:21880` `_stTier._injectTierPre = _tierGuess` | 同上 |
| ③ **渲染全帧** | `lib/index.js:21883` `renderMemoryDynamic(context)` | **读到的是 ①（`*_full`）** |
| ④ 降级为 `*_slim` | `lib/index.js:21905-21915`（仅 `human_full`/`run_full`/`human_slim`/`run_slim` 四档参与） | `human_slim` / `run_slim` |
| ⑤ 渲染精简帧 | `lib/index.js:21916` `renderSlimSnapshotPre(...)` | **读到的是 ④（`*_slim`）** |

⇒ **生产环境里 `renderMemoryDynamic` 永远不会收到 `human_slim` / `run_slim`**：降级（④）发生在全帧渲染（③）**之后**。
⇒ `renderMemoryDynamic` 内部那一整套按 `*_slim` 裁剪的代码（规则摘要 `lib/index.js:11207-11215`、白板核心节 `lib/index.js:11329-11331`、`recent-logs` 丢弃）**在全帧路径上是死分支**；它唯一生效的场景是测试夹具手工塞档位（本报告 §3 的 C/D/F 列即此）。

### 1.3 触发条件（当前真实的节奏，不是设计意图）

| 触发 | 代码位置 | 条件 | 生产实测（`~/.dsh/dsh-auto-memory-diagnose.log`，10-30→11-03 共 15,013 行） |
|---|---|---|---|
| **首轮** | `lib/index.js:22633` `if (st._snapFp === undefined)` | 本 agent 从未投递过快照 | 有，且不受门槛限制 |
| **每个真人 turn** | pre-step 嗅探 → `_humanPending = true`（`lib/index.js:21561`）→ `_grantByHuman`（`:22449`） | `payload.messages` 里出现 `source.kind === 'user'`（或无 source） | `完整版（… · 真人在场）` **214 次**；另 `非门槛触发` **220 次**（该标签=「非人且未达步数门槛却仍授予」，两种来源：①pre-step 嗅到真人但事件流 `isHuman` 尚未落地；②本 runtime 首次注入 `_snapFp===undefined`）⇒ **真人触发的完整版最多 434/517 = 84%**（下限 214/517 = 41.4%，取决于 220 里两类各占多少） |
| 步数门槛 | `:22450` `_grantByGap`；门槛 `lib/index.js:21969` `fullGapStep = cfg.snapshotMinGapRounds`（默认 **20**） | 距上次完整版 ≥ 20 个**模型请求** | `完整版（… 达门槛 · 距上次 N 个模型请求 / 门槛 20）` **82 次** |
| **压缩后** | `POST_COMPACT` 判定 `lib/index.js:21860-21878`；强制放行 `lib/index.js:22609-22626` | `scanPressureSignalsPre(events).compactionSeq` 相对基线增长 | `log` 中 `压缩后强制重建` **0 次**、`post_compact` **0 次** |
| **水位 25% / 50%** | 阈值解析 `lib/index.js:2001-2029`；判定 `lib/index.js:2051-2073`；计算 `lib/index.js:22052-22072`；授予 `lib/index.js:22370-22385` | `_waterFire.fire && isHuman` | `log` 中 `水位阈值命中` **0 次** —— **该分支 100% 抛异常被吞（见 1.4）** |
| 挂机代位补偿 | `lib/index.js:22334-22355` + 授予 `:22391-22399` | `hangCompensateEnabled`（默认 **false**） | **0 次**（默认关） |
| 交接接续 | `lib/index.js:21840-21843` | `!ws && globalLedgerPath` | `handoff_carry` 命中 4 次（另一通道） |
| 精简帧 | `lib/index.js:21916` + 节流 `:22644-22686` | 其余全部请求；自身再按 `slimEveryRounds`（默认 **8**）节流 | `精简版` **475 次**、`精简版被节流` **3,322 次** |

### 1.4 ★ 两条「设计意图钩子」实际是死代码（实测抛 ReferenceError 被空 catch 吞掉）

`_rqK` 在 `lib/index.js:22097` 声明于 `try { … } catch (_) {}`（`:22096-22123`）**块内**；而水位授予分支（`:22373`、`:22378`）与挂机授予分支（`:22394`）在**该块之外**引用它。

实测（真抽解决策段 + 真 `parseWaterPctThresholdsPre`/`decideWaterPctFirePre`，2026-11-03）：

- 水位分支内捕获到的异常：**`_rqK is not defined`** ⇒ 被 `:22384` 的 `catch (_eWf)` 静默吞掉 ⇒ `_waterPctFired` 恒为 `0`、输出仍是精简帧；
- 同一 bug 在 `:22394`（F7 挂机补偿）。

这与仓库既有纪律「门控/节奏类判定分支禁止用空 catch 兜底」完全同型：`node --check` 与静态断言全绿，功能 100% 不生效。生产 `log` 中 `水位阈值命中`=0 / `挂机代位补偿`=0 是同一个证据的现场侧。

### 1.5 预算常量清单（标出作用档位与「硬上限 / 仅告警」）

| 常量 | 值 | 定义位置 | 作用档位 | 性质 |
|---|---|---|---|---|
| `injectBudgetChars` | 8,000 | `lib/index.js:811` | 全部 → 只用于**推算** `sub`（`:11719-11720`）与白板上限；`envelope` 只拿它做 `over-budget-total` **可见性标注（`inject:false`）**，**不是硬门** | **仅告警** |
| `snapshotMinGapRounds` | 20 | `lib/index.js:1054`（真源 `:540`） | 全帧间隔（模型请求） | **硬门槛** |
| `slimEveryRounds` | 8 | `lib/index.js:1063`（真源 `:542-548`） | 精简帧自身间隔 | **硬门槛** |
| `fullInjectSlimBudgetChars` | 3,000 | `lib/index.js:1105` | **瘦档**白板预算 `_slimBudget`（`:11290`） | 硬上限（白板段） |
| `handoffPlanChars` | 1,200 | `lib/index.js:903` | LEGACY 白板预算 `_fullBudget`（`:11289`） | 硬上限 |
| `handoffPlanSectionMax` | 2,000 | `lib/index.js:911` | 白板**单节**上限（`:11109`/`:11302-11304`） | 硬上限 |
| `injectBudgetChars`（全帧白板） | 8,000 | `lib/index.js:11292` `_fullTierBudget = max(injectBudgetChars, _slimBudget)` | **全帧档**白板预算 | 硬上限（8,000） |
| `handoffLedgerChars` | 800 | `lib/index.js:913` | 账本段（`:11404`） | 硬上限 |
| `fullInjectSemanticChars` | 800 | `lib/index.js:1108` | `semantic-recall` 段（`:11515`），仅 `human_*`/`post_compact`/`handoff_carry` | 硬上限 |
| `userRulesWarnChars` | **4,000** | `lib/index.js:729` → 传入 `:11043` | **规则段 / 全帧**（`rules-layer.js:373`） | **仅告警**：`rules-layer.js:437-441` 明写「这两个数字是**警戒线**，不是**截断线**」；超线**全文照常注入** |
| `projectRulesWarnChars` | 6,000 | `lib/index.js:730` | 项目规约 | 仅告警 |
| `USER_RULES_WARN_CHARS_PRE_V1` | 1,500（出厂，被上面 4,000 覆盖） | `lib/rules-layer.js:445` | 同上 | 仅告警 |
| `noteCapacityChars` / `userCapacityChars` | 24,000 / 24,000 | `lib/index.js:861-862` | **文件本体**容量，不是注入面 | 写入侧压缩触发 |
| `CHANNEL_ZONE_MAX_CHARS` | 300 | `lib/injection-zones.js:29`（消费 `lib/index.js:11923-11925`） | 通道区（calendar / 外部记忆 / 待审理账本） | **硬上限**（实测本轮丢掉 4 段、1,573 字符） |
| `memRefLimit` | 全帧 **16,697** / 瘦档 **11,697** | `lib/index.js:11865-11873` | `memoryReferences` 桶 | **硬上限** |
| `otherDynamic` 上限 | `null`（未配置不设限） | `lib/index.js:11876-11877` | `otherDynamic` 桶 | 不设上限 |
| `rules` 桶 | **永不参与裁剪** | `lib/memory-envelope.js:119-138` | 规则段 | 明确豁免（传了上限也忽略并留痕） |
| 每证据段预算 `sub` | **1,473** | `lib/index.js:11719-11720` `floor((8000-500-catalogCost)/4)` | `user-memory` / `project-notes` / `recent-logs` | **硬上限（腰斩）** |
| `tier0BudgetShare` | 0.25（+ 契约硬顶 B0=800 token） | `lib/index.js:826` | Tier-0 目录 | 硬上限 |
| `fullInjectWaterPct` | `'25,50'` | `lib/index.js:1094` | 全帧（水位钩子） | **钩子存在但死（§1.4）** |
| `snapshotTieredInject` | `true` | `lib/index.js:1049` | 精简帧总开关（`:21916`） | 开关 |
| `hangCompensateEnabled` | `false` | `lib/index.js:1110` | 挂机补偿 | 开关（默认关） |

### 1.6 同一语义多处各写一份判据（本仓已知病）

| 语义 | 副本 1 | 副本 2 | 副本 3 | 生产消费点 |
|---|---|---|---|---|
| 档位枚举 | `INJECT_TIERS` `lib/index.js:1790-1815` | 内联 `_T` `lib/index.js:11093-11098` | — | 内联那份 |
| 「是否给规则全文」 | `isRulesFullTierPre` `lib/index.js:1863-1868` | 内联 `_rulesFullTierInline` `lib/index.js:11201-11206` | — | **仅内联**；模块级函数**生产 0 消费**（只有注释与套件引用） |
| 「是否给白板全文」 | `isPlanFullTierPre` `lib/index.js:1837` + `planSpecForTierPre` `:1994-1999` | 内联 `_planSpec` `lib/index.js:11107-11118` | 内联 `_planCapFullIdx` `lib/index.js:11865-11868`（**第三份**，envelope 桶用） | `_planSpec` + `_planCapFullIdx`；`planSpecForTierPre` **生产 0 消费** |
| 「是否给画像 / semantic-recall」 | 内联 `:11496`（semantic 名单） | 内联 `:11545-11546`（portrait 名单） | `isHumanTierPre` `:1818`（生产 0 消费） | **同一函数内两份手写名单**（历史 D12） |

### 1.7 真实注入体积（同一份真实记忆数据，全帧）

```
A human_full  24,393 字符 / 48,110 B / 314 行      ← 本机当前实际「完整版」
B 精简帧       2,219 字符 /  4,717 B /  18 行      ← 本机当前实际「精简版」
```

全帧内 user 侧构成（实测）：规则段 **8,683**（35.6%：用户规约正文 5,539 / 49 条、项目规约 2,582 / 17 条、超预算告警 **150**、三层语义分工 371）+ 用户级记忆 **1,574** + 画像 **615** + semantic-recall **915** = **11,787 字符（48.9%）**。

---

## §2 与用户设计意图的逐条差距

> 用户 2026-11-03 三条意图（判据基准）：
> ① user full 不该每轮注入，只在三种时机：会话首轮 / 上下文压缩后 / 压缩进度 25% 与 50% 时「人说话的下一轮次」；
> ② full 档不设注入量上限，或上限极大（不该有 4000 这类小预算卡着；「用户规约超预算线 4000 字符 / 当前 5347 字符 133.7%」这个提示本身就是设计错误的症状）；
> ③ 其他时候注入的都应该是 user slim（精简版，可裁剪）。

### 差距 1 —— 「user full 不该每轮注入」：**当前每个真人 turn 都拿到 full**（不满足）

- 代码判据：`lib/index.js:22449` `_grantByHuman = _reqHumanNow || (isHuman && firstOfTurn)` —— 只要本请求带真人消息（pre-step 在 `lib/index.js:21561` 置 `_humanPending`），**无条件授予全帧**，与本 turn 是第几轮、水位多少无关。
- 真抽解决策段实测（10 个连续真人 turn、每 turn 5 个模型请求）：**FULL=10 / SLIM=40** ⇒ 每个真人 turn 的第 1 个请求必得 24,393 字符全帧。
- 生产侧证据：5 天内完整版授予 **517** 次，其中 `真人在场` 214 + `非门槛触发` 220 + `达门槛` 82 + 保真 1。`非门槛触发` 的语义是「非人、且距上次完整版 < 20 步却仍授予」，来源只能是 `_reqHumanNow`（pre-step 嗅到真人但事件流 `isHuman` 未落地）或「本 runtime 首次注入」⇒ **真人触发占比在 41.4%–83.9% 之间**（`达门槛` 仅 82 次 = 15.9%）。
- 用户要的三时机，实际只有「首轮」在按设计工作（`:22633`）；「压缩后」（`:22609-22626`）在 5 天日志里 **0 次命中**；「25%/50%」（`:22370-22385`）**代码存在但 100% 抛 ReferenceError 被吞**（§1.4）⇒ 用户最关心的那条钩子从未生效。

### 差距 2 —— 「full 档不设上限」：**规则段确实无上限，但另外三处被小预算腰斩**（部分满足）

逐条实测：

| 用户要的「全量」 | 现状 | 判定 |
|---|---|---|
| 规则全文 | `rules` 桶在 envelope 里**明确豁免**（`lib/memory-envelope.js:119-138`）；实测全帧规则段 **8,683 字符全额在场**，无截断 | ✅ 满足 |
| 项目全貌 | 全帧白板预算 `max(injectBudgetChars 8000, 3000)`，实测白板段 **1,941 字符**（源 `PLAN.md` 11,134 字符） | ⚠️ 上限 8,000 未触顶，但源文件 11,134 ⇒ 仍有压缩（按节白名单优先） |
| **用户级记忆**（`user-memory`） | 被 `part(..., sub, 'must', 'tail')`（`lib/index.js:11758`）按 `sub = 1,473` **硬截**；实测注入 **1,574 字符**（含 45 字符截断标记 + 文件头），**源文件 27,102 字符 ⇒ 覆盖率 5.64%**，且取的是**尾部** | ❌ **严重不满足**；这才是「被小预算卡着」的真实位置 |
| **项目笔记**（`project-notes`） | 同上，实测 **1,610 字符**（正文 1,529）/ 源 23,945 ⇒ **6.39%** | ❌ 不满足 |
| 用户画像 | `user-portrait` 615 字符，无上限（`otherDynamic` 桶 `null`） | ✅ 满足 |
| agent 共同记忆 | `semantic-recall` 上限 800，实测 **915**（含截断标记） | ⚠️ 有 800 小预算 |

关于「4000」这条：**它不是截断线，是告警线**（`lib/rules-layer.js:437-441` 逐字「警戒线，不是截断线」；超线**全文照常注入**）。所以「被 4000 卡着」在**截断**意义上不成立；但**用户说的症状仍然成立且更严重** —— 那 150 字符的告警行**本身被注入进了每轮全帧**（实测占全帧 0.6%），而真正被「小预算」砍掉的是 `user-memory`（5.81% 覆盖）与 `project-notes`（6.72% 覆盖）。即：**告警的对象（4000）没截断，没人告警的对象（1,473/段）在腰斩最该全量给的用户记忆。**

### 差距 3 —— 「其他时候注入 user slim」：**slim 帧里 user 侧内容 = 0**（不满足，且比用户要求更狠）

实测精简帧（B，2,219 字符）内容清单：

- ✅ 有：记忆系统状态行、检索指引、`[当前事件]`（68 字符）、`[用户画像]`（88 字符）、`[取全文]` 入口、精简说明、维护基线、唤回声明。
- ❌ **没有**：用户规约（0 字符）、项目规约（0）、`[用户级记忆]` 段（0）、Tier-0 目录（0）、白板正文（0）、账本（0）、事件卡（0）、日历（0）。

而用户要的 `user slim` 是「**核心节，专注当前事项，不投规则全文**」（2026-10-27 设计纲要 §1 逐字，`docs/internal/INJECT-TIER-DEFECTS-20261028.md`）。能产出这种形态的代码**确实存在**——`human_slim` 档（实测 19,136 字符，规则段降到 4,189 摘要、白板核心 7 节）——但**生产不可达**（§1.2：降级发生全帧渲染之后）。

⇒ 结论：**不是「区分度不足」，而是「用户定义的 slim 档根本没有生产入口」**。生产里只有两态：24,393（全量）与 2,219（近空），中间那一档（19,136）被 dead-code 化。

### 差距 4 —— 裁剪点位置错误（同类附加发现）

- `recent-logs`（最近日志）在 `human_slim` / `run_full` 档被 **整段丢弃**（`envelope.dropped = [recent-logs]`，实测），原因：瘦档 `memRefLimit = 11,697` 比全帧 16,697 少 5,000，而 `recent-logs` 是 `low` 优先级、`whiteboard-plan`/`event-cards` 是 `must` ⇒ 先死的是日志。这不是用户要求的「核心节优先」排序（用户要的是「不投规则全文」，而不是「拿日志换规则」）。
- `A vs G(post_compact)`：重叠率 **100% 行 / 98.01% 字符**，仅多 109 字符的「[上下文已压缩]」提示 ⇒ `post_compact` 与 `human_full` 实质是同一份内容（历史上 D2 的已知形态，仍未分层）。
- `A vs H(handoff_carry)`：**逐字节相同**（sha256 完全一致，`58023e12…`）⇒ 两个档位名对应零差异。

### 差距 5 —— 档位判据的「一处定义、多处手抄」

见 §1.6：4 组语义各存在 2–3 份手写判据，其中模块级 `isRulesFullTierPre` / `planSpecForTierPre` / `isHumanTierPre` 三个函数**生产消费点为 0**（只有套件与注释引用）。这正是本仓已固化的「恒真守卫」形态：套件全绿 ≠ 功能生效。

---

## §3 双档实测

### 3.1 装置与数据

- 引擎：`tests/lib/state-engine.mjs` 的 `MemoryEngine`（真 import → 真 apply → 真 `refresh()`）。
- 数据：本机真实记忆（`~/.dsh/memory`）：用户记忆 27,102 字符 / 项目笔记 23,945 / PLAN.md 11,134 / 最新账本 1,205 / 事件卡 2,402 / 画像 576 / 日志 1 天。
- 配置：`injectBudgetChars=8000`、`snapshotMinGapRounds=20`、`slimEveryRounds=8`、`handoffPlanChars=1200`、`userRulesWarnChars=4000`（= 本机出厂配置，与本机实际注入一致）。
- **陷阱（已避开）**：`renderMemoryDynamic` 读 `this.state`（default runtime），而档位由 `stateFor(agent)` 写 agent runtime；只写一处会得到「human_slim 与 human_full 逐字节相同」的假结论。装置同时写两处，并在报告中区分「生产可达」与「仅测试可达」。

### 3.2 八份落盘产物（`artifacts/inject-tiers-20261103/`）

| 文件 | 档位 / 形态 | 生产可达 | 字符 | 字节 | 行 | sha256 |
|---|---|---|---|---|---|---|
| `A-human_full.txt` | `human_full` 全帧 | ✅ | 24,393 | **48,110** | 314 | `1e02d030d4b51ce061c81a4c3f53b53147fea7650b190e80f7c70e2fb060d306` |
| `B-human_slim-frame.txt` | 精简帧（`human_slim` 标签） | ✅ | 2,219 | **4,717** | 18 | `a4eb29d1afe38033c423588338bba55159e7b5da0d9f532684185864df4e92c5` |
| `C-human_slim-inframefull.txt` | `human_slim` 跑全帧渲染器 | ❌ 仅测试 | 19,136 | **36,239** | 302 | `740f866ceca6b9ee3fa9841a23d3b5cbaf1438e891efc082f6dfb868d800e10a` |
| `D-run_full.txt` | `run_full` 全帧 | ✅ | 17,606 | **32,758** | 272 | `ae41cf4d61eb88d70736d11f0c1bdef067e5a504a1df4e8b3d5d0589bb2b46a0` |
| `E-run_slim-frame.txt` | 精简帧（`run_slim` 标签） | ✅ | 1,999 | **4,312** | 14 | `d393531b514ef082f1cef51a0d2eac0493951824628ca70c93c74f3897d33ce2` |
| `F-run_slim-inframefull.txt` | `run_slim` 跑全帧渲染器 | ❌ 仅测试 | 13,140 | **24,172** | 193 | `59b11057b373dc37dfdbb5418bfc8d05a81489a72a1b48f6244a0e1a42f8b141` |
| `G-post_compact.txt` | `post_compact` | 设计可达（实测 0 次） | 24,503 | **48,370** | 317 | `bd74d4039f65d63bbabb6f7a4aa8411fcc638d5f5f204bf15dbb58b7a5a979ae` |
| `H-handoff_carry.txt` | `handoff_carry` | ✅ | 24,393 | **48,110** | 314 | `1e02d030d4b51ce061c81a4c3f53b53147fea7650b190e80f7c70e2fb060d306` |

> **sha256 的口径（如实标注）**：它是对**当次真实快照**取的 —— 快照里含 Tier-0 目录的「实计 N 元 token」与当日日志尾部，会随真实记忆漂移（本次两次运行之间该处就从 592 变 399，字符数不变但内容变 ⇒ sha 变）。**字符/字节/行数/重叠率在两次连续运行中完全一致（已实测复核）**；复算时以 `metrics.json` 的 chars/bytes/overlap 为准，sha256 仅作「本报告这一份快照」的指纹。

配套证据：`metrics.json`（全部物理量）、`envelope-metas.json`（7 档分项账本）、`segment-matrix.csv`（逐段对照）、`probe-tiers.mjs`（复算装置）。

### 3.3 重叠率（判据：>80% 即区分度不足）

| 配对 | 相同行 / |A| | 相同行 / |B| | Jaccard | 字符重叠 / |A| | 判定 |
|---|---|---|---|---|---|
| **A（全帧）vs B（精简帧）** | **2.68%** | 50.00% | 2.61% | **1.67%** | 区分度**充足** |
| A（human_full）vs C（human_slim 全帧） | 69.73% | 72.22% | 54.98% | 59.02% | 未达 80%，但**生产不可达** |
| A vs D（run_full） | 61.30% | 69.57% | 48.34% | 53.43% | 可区分 |
| A vs G（post_compact） | **100%** | 99.62% | 99.62% | **98.01%** | **区分度不足** |
| A vs H（handoff_carry） | **100%** | **100%** | **100%** | **98.01%** | **逐字节相同** |
| D（run_full）vs F（run_slim 全帧） | 72.61% | 98.82% | 71.98% | 68.94% | 未达 80% |
| B（human_slim 帧）vs E（run_slim 帧） | 78.57% | **100%** | 78.57% | **90.0%** | **接近/超过 80%，两档精简帧几乎相同** |

**结论**：任务书预设的判据（「若重叠率 > 80% 则区分度不足」）在 **A/B（全帧 vs 精简帧）上不成立**（2.68%/1.67%）。真正「区分度不足」的是：`post_compact` ≡ `human_full`（100% 行）、`handoff_carry` ≡ `human_full`（100% 逐字节）、`human_slim` 帧 ≡ `run_slim` 帧（90% 字符，仅差 [当前事件] 68 + 画像 88 = 156 字符）。

### 3.4 独有段落清单

**仅 A（全帧）有、B（精简帧）没有**（共 24 个段标题）：
`[用户规约超预算线]` · `[用户规约 — 跨项目通用 · 必须遵守]` · `[项目规约 — 本项目必守]` · `[记忆用途]` · `[Tier-0 常驻目录]` · `[层账]` · `[闸门]` · `[最近交接 — 四段式账本]` · `[事件卡片]` · `[其他事件]` · `[长期关系记忆]` · `[用户画像 — 这是谁（跨事件聚合）]` · `[用户画像 — 从已采纳的人类反馈中提炼]` · `[最近 1 天工作日志(尾部)]` · `[最近反思]` · `[用户级记忆 ~/.dsh/memory/MEMORY.md]` · `[铭文 · 每轮提醒]` + 6 条 `[降级]` 行。

**仅 B（精简帧）有、A 没有**（7 个）：
`[记忆检索指引]` · `[当前事件]`（T1 单行摘要） · `[用户画像]`（≤160 字压缩版） · `[取全文] memory_recall(...)` · `[记忆系统 · 精简注入]` · `[记忆结构 · 先读懂再动手]` · `[记忆唤回]`。

**两档共有 7 行**：框架头 `<memory_system>`、`[记忆定位 — 读法]`、`[来源身份 — 必须遵守]`、状态行（日期/工作区）、块尾 `</memory_system>` 等 —— 这是 2.68% 重叠的全部来源，**不含任何记忆内容**。

### 3.5 逐段对照（同数据，7 档）

见 `segment-matrix.csv`。要点：

| 段 | human_full | human_slim | run_full | run_slim |
|---|---|---|---|---|
| `rules-section` | **8,683** | 4,189 | 4,189 | 4,189 |
| `whiteboard-plan` | 1,941 | 1,884 | 1,884 | **0**（不投） |
| `handoff-ledger` | 839 | 839 | 839 | **0** |
| `event-cards` | 2,449 | 2,449 | 2,449 | **0** |
| `user-portrait` | 615 | 615 | **0** | **0** |
| `semantic-recall` | 915 | 915 | **0** | **0** |
| `recent-logs` | 775 | **0（被丢）** | **0（被丢）** | 775 |
| `user-memory` | 1,574 | 1,574 | 1,574 | 1,574（**四档完全相同**） |
| `project-notes` | 1,610 | 1,610 | 1,610 | 1,610（**四档完全相同**） |
| `total` | 24,112 | 18,786 | 17,256 | 12,859 |
| `limits.memoryReferences` | 16,697 | 11,697 | 11,697 | 11,697 |

⇒ 三处结构性问题：①`user-memory` / `project-notes` **四个档位一个字节都不变**（同受 `sub=1,473` 卡）；②`human_slim` 与 `run_full` 的规则段/白板/账本/事件卡**完全相同**（4,189 / 1,884 / 839 / 2,449）；③`run_slim` 反而保住了 `recent-logs`（775）而 `human_slim` 丢了 —— 裁剪方向与「谁更重要」相反。

### 3.6 成本换算（可复算）

按 A=24,393 / B=2,219 字符：

- **当前实现**（本机 5 天实测比例：完整版 517 / 精简版 475，全帧占真人在场轮次 100%）：若 20 个真人 turn + 80 个 agent 请求 ⇒ 20×24,393 + 80×2,219 = **665,380 字符**；
- **用户设计意图**（首轮 + 压缩后 + 25% + 50% 共 4 次全帧）：4×24,393 + 96×2,219 = **310,596 字符**；
- 倍率 **2.14×**。若仅修 §1.4 的 `_rqK` bug 而不改「每个真人 turn 都 full」，倍率不变。

---

## §4 改造建议（只出方案，未改代码）

### 4.1 需要新增的钩子

| # | 钩子 | 落点 | 判据 |
|---|---|---|---|
| H1 | **修正 `_rqK` 作用域**（P0，先修这个，否则 25%/50% 无从谈起） | 把 `const _rqK = …`（`lib/index.js:22097`）提到 `:22096` 的 `try{` **之外**，与本函数其余局部变量同层 | 真抽解决策段：真人 + 水位 26% + 同 turn 非首帧 ⇒ 输出全帧、`_waterPctFired===25`；负路径：水位 10% ⇒ 仍精简帧 |
| H2 | **「真人 turn 默认 slim」**：把 `_grantByHuman`（`:22449`）从「无条件」改为「仅当满足三时机之一」 | `_grantByHuman` 拆成 `_grantByFirstTurn || _grantByCompact || _grantByWater`；`_reqHumanNow` 不再单独作为授予理由 | 连续 10 个真人 turn、水位稳定 10% ⇒ 仅 turn1 全帧，其余 9 轮精简帧；水位跨 25% 那一条 turn ⇒ 全帧 |
| H3 | **首轮判据保留并显式化** | `:22633` `_snapFp === undefined` → 提到与 H2 同一分支组，命名 `_grantByFirstTurn` | 首帧全帧；第二帧同配置 ⇒ 精简帧 |
| H4 | **压缩后钩子的可达性验证** | `:21860-21878` 的 `compactionSeq` 基线 + `:22609-22626` 强制放行 | 构造 `compaction/start`+`compaction/summary` 事件 ⇒ 下一请求全帧且带 `[上下文已压缩]` 提示；5 天日志 0 命中需先确认是「真没压缩」还是判据失效 |
| H5 | **让「user slim」在精简帧可达**（当前 0 用户侧内容） | `renderSlimSnapshotPre`（`lib/index.js:9834`）新增「用户规约摘要」段：复用 `renderRulesSlimPre`（`lib/index.js:1929-1953`，已实现、当前生产 0 消费）产出「标题 + 每条 ≤60 字 + 总条数」；以及 `user-memory` 的**头部**摘要（当前全帧取的是尾部 1,473，可用性也需重估） | 精简帧含 `[用户规约 · 精简]`，实测字符 ≤600；负路径：无规则文件 ⇒ 整段零字节 |
| H6 | **全帧档解除 `sub` 腰斩** | `lib/index.js:11719-11720`：全帧档（`human_full`/`post_compact`/`handoff_carry`/`legacy`）改用 `injectBudgetChars` 或极大值作为 `user-memory`/`project-notes` 的预算，瘦档仍用 `sub` | 全帧 `user-memory` 覆盖率 ≥ 50%（当前 5.64%）；负路径：精简帧仍是摘要 |
| H7 | **去掉全帧里的 150 字符超预算告警行**（或阈值抬到 ≥ 全量） | `lib/rules-layer.js:387-393`；全帧档不再注入告警行，告警改走面板/日志 | 全帧文本不含 `[用户规约超预算线]`；面板仍可见 alert |
| H8 | **判据收敛为单一真源** | 删/接线 `isRulesFullTierPre`(`:1863`)、`planSpecForTierPre`(`:1994`)、`isHumanTierPre`(`:1818`)、`_planCapFullIdx`(`:11865`)、内联 `_T`(`:11093`)、`_rulesFullTierInline`(`:11201`)、`:11496` 与 `:11545` 两份名单 —— 改为**从同一模块级表派生**并让生产真调用（保留内联副本须加「逐字节等价」成对断言） | 变异测试：改模块级表任一行 ⇒ 产出必须变化（证明不是恒真守卫） |
| H9 | **区分 `post_compact` / `handoff_carry` 与 `human_full`** | 当前 `post_compact` 100% 行重叠（多 109 字符提示）、`handoff_carry` 逐字节相同 | 两档各自产出**段清单差异**（如 handoff_carry 必须含账本全文、不含画像），并以段清单断言验收 |

### 4.2 可复算判据（建议新增套件）

1. **双档装配套件**（复用 `artifacts/inject-tiers-20261103/probe-tiers.mjs` 的装置）：同一 state 分别渲染全帧/精简帧，断言
   - `bytes(full) > 10_000` 且 `bytes(slim) < 3_000`；
   - `lineOverlap(full, slim) < 20%`（当前 2.68%，阈值留余量）；
   - `slim` 必含 `[用户规约 · 精简]` 且 `chars ≤ 600`。
2. **档位区分度套件**：枚举 7 档，断言任意两档 `sha256` 不同（当前 `human_full == handoff_carry` 直接红）。
3. **钩子可达性套件（真执行）**：真抽解决策段 + 真 `parseWaterPctThresholdsPre`/`decideWaterPctFirePre`，断言
   - 真人+水位 26%+非首帧 ⇒ 全帧 且 `_waterPctFired === 25`；
   - 反例：水位 24% ⇒ 精简帧；
   - **负路径**：把 `_rqK` 声明移回块内 ⇒ 必须红（证明该断言真的能抓住 §1.4 那个 bug）。
4. **真人轮节奏套件**：10 个连续真人 turn ⇒ 全帧次数必须 == 1（首轮）或 1+水位命中数，而不是 10。
5. **覆盖率套件**：全帧 `user-memory` 段字符 / 源文件字符 ≥ 50%。

### 4.3 建议顺序（依赖关系）

`H1（_rqK）→ H4（压缩可达性）→ H2+H3（真人轮节奏）→ H5（slim 承载用户侧）→ H6（全帧解腰斩）→ H7（去告警行）→ H8（判据收敛）→ H9（档位差异化）`。

H1 必须最先做：它是用户第①条意图里唯一 **100% 死**的钩子，且修复面最小（一行作用域）；其余改动若在 H1 之前验收，会把「水位钩子死」误判成「水位钩子设计错」。

---

## 附：本报告物理量

| 项 | 值 |
|---|---|
| 报告路径 | `docs/internal/INVESTIGATE-USER-TIERS-20261103.md` |
| **bytes**（正文，不含本附节） | **30145** |
| **行数**（正文） | **283** |
| **sha256**（正文） | `d340f07783899298276baab57881d51d34b4353438b69655a4ebcb85eb7c49b8` |

证据目录 `artifacts/inject-tiers-20261103/`（8 份注入文本 + `metrics.json` + `envelope-metas.json` + `segment-matrix.csv` + `probe-tiers.mjs`）：

| 文件 | bytes | sha256 |
|---|---|---|
| `A-human_full.txt` | 48110 | `1e02d030d4b51ce061c81a4c3f53b53147fea7650b190e80f7c70e2fb060d306` |
| `B-human_slim-frame.txt` | 4717 | `a4eb29d1afe38033c423588338bba55159e7b5da0d9f532684185864df4e92c5` |
| `C-human_slim-inframefull.txt` | 36239 | `740f866ceca6b9ee3fa9841a23d3b5cbaf1438e891efc082f6dfb868d800e10a` |
| `D-run_full.txt` | 32758 | `ae41cf4d61eb88d70736d11f0c1bdef067e5a504a1df4e8b3d5d0589bb2b46a0` |
| `E-run_slim-frame.txt` | 4312 | `d393531b514ef082f1cef51a0d2eac0493951824628ca70c93c74f3897d33ce2` |
| `F-run_slim-inframefull.txt` | 24172 | `59b11057b373dc37dfdbb5418bfc8d05a81489a72a1b48f6244a0e1a42f8b141` |
| `G-post_compact.txt` | 48370 | `bd74d4039f65d63bbabb6f7a4aa8411fcc638d5f5f204bf15dbb58b7a5a979ae` |
| `H-handoff_carry.txt` | 48110 | `1e02d030d4b51ce061c81a4c3f53b53147fea7650b190e80f7c70e2fb060d306` |

- **未修改 `lib/` 任何文件**；未 commit / 未 push / 未改版本号。
- 复算：`node artifacts/inject-tiers-20261103/probe-tiers.mjs`（真引擎 + 真实记忆数据，实测 EXIT=0；连续两次运行 chars/bytes/行数/重叠率完全一致）。
