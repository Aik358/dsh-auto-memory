# 团队线双版互达 · 实施方案 v1

> 阶段 1 交付物（只出方案，不动产品代码）。依据：`artifacts/wave1-prompts/TEAM-WIZARD-BRIDGE-BRIEF.md`。
> 用户裁定原话：「结束之后，如果打开团队 Teamwork 功能的用户，应当优先展示团队版，两版之间可以相互切换，且没有负面影响」

---

## 1 现状

### 1.1 owner 判据（已接线，工作正常）

`lib/client.js:8401` `upgradeSurfaceOwnerPre(input)` —— 前台权唯一裁决。当前优先级链（实测行号）：

| 序 | 判据 | 行 | owner | reason |
|---|---|---|---|---|
| ① | `req === "wizard"` | 8407 | wizard | explicit-wizard |
| ① | `req === "team-card"` 且团队 | 8408-8410 | team-card | explicit-team |
| ② | `!isTeam` | 8413 | wizard | personal |
| ③ | `phase === "running"` | 8428 | wizard | team-running |
| ④ | `teamSticky === true` | 8430 | team-card | team-sticky |
| ⑤ | `legacy === true` | 8432 | wizard | team-legacy |
| ⑥ | 否则 | 8433 | team-card | team-no-legacy |

### 1.2 共享事实位（已接线，可自我修复）

- `__upgradeSurfaceTeamSticky`（`:8496`）+ getter/setter（`:8566/:8567`）
- 卡片 `useEffect` 同步、**卸载即清**（`:7616-7619`）
- 这是**事实的镜像**：sticky 变它就变、卡片卸载它就 false ⇒ 不会永久压住任何一方

### 1.3 未接线的总线（本次要解决的核心）

```js
var __upgradeSurfaceOwner = ""                        // :8487
function upgradeSurfaceRequestOwnerPre(target) {      // :8498
  ... __upgradeSurfaceOwner = t                       // :8501  <-- 只写不清
  ... listeners.forEach(...)
}
function upgradeSurfaceSubscribeOwnerPre(fn) { ... }  // :8504
function upgradeSurfaceOwnerNowPre() { ... }          // :8509
```

**三函数零调用点**（批1 建、批2/批3 都没接）。

不接的理由（批1 已写明、Lead 审过同意）：`__upgradeSurfaceOwner` 是**模块级持久变量、只写不清** ⇒ 一旦接进判据，用户点一次「切到团队卡片」⇒ 变量永久停在 `team-card` ⇒ **向导永远不再弹**（哪怕新工作区还有旧格式要整理）。这是「请求位被当成事实位」的经典错误。

### 1.4 三个可能被忽略的既有事实（本次核对新发现，直接影响方案）

**F1 · `running` 的提前返回在 owner 判据之前**

`lib/client.js:8709` —— 向导 auto effect 里：

```js
if (phase === "running") { setOpen(true); setPage("progress"); return }   // :8709 直接开进度页
var ownerV = upgradeSurfaceOwnerPre({ ... })                              // :8713 在这之后
if (ownerV.owner !== "wizard") return                                     // :8727
```

⇒ **即使 owner 判给 `team-card`，running 时向导仍会自己打开**。这是 §3.4 裁定的硬前提：「意图 vs running」不能只在纯函数里定，**必须同时改 auto effect 的分支顺序**，否则裁定是假的。

**F2 · 团队卡片的 `wantShow` 里含 `phase === "running"`**

`:7599` `var wantShow = !!status.canUpgrade || phase === "running" || sticky` ⇒ running 时卡片**本来就愿意显示**。当前因 owner 判 `team-running` ⇒ `show=false` 才没显示。裁成「意图优先」时**不需要额外放开 wantShow**。

**F3 · 向导 progress 页当前只有「后台运行 / 关闭」两个按钮**（`:9258-9260`），没有「去发布」入口；团队卡片整份按钮组（`:8072` ②自己整理并上传、`:8084` ③仅上传已完成结果）才是发布动作所在。

**F4 · 两个组件的挂载生命周期不同（自审新发现，直接决定 V3-a 的验法）**

| 组件 | 挂载点 | 生命周期 |
|---|---|---|
| 团队卡片 `UpgradePopup` | `:9812` `h(UpgradePopup, { key: 'ev4-upgrade', ... })`，挂在**白板页面内** | 随页签切换/离开白板 ⇒ **卸载** |
| 三页向导 `UpgradeWizard` | `:25271` `slots.register({ id: 'auto-memory-pre-upgrade-wizard', order: 8 })` → `shell.overlay` | **会话级常驻**，页面切走仍在 |

⇒ **V3-a「切换后重新挂载回到团队版」对两个组件的含义不同**：
- 对**卡片**：离开白板页再回来 ⇒ 卡片重新挂载 ⇒ `useState` 归零 ⇒ 必须回到团队优先；
- 对**向导**：overlay 常驻 ⇒ **不会重新挂载** ⇒ 单靠「重挂载」验不到它。
  ⇒ 对向导必须用「模块级状态重置」（vm 里重建 context / 生产里刷新整页）来验，
    并在套件里显式区分这两条路径，**不能只测一种就宣称 V3-a 成立**。

**F5 · 向导 `open` 是 `useState`，且 auto effect 只在 mount 时跑一次（`[]` 依赖）**

`UpgradeWizard` 的 auto effect 依赖数组是 `[]`（`:8741` 结尾 `}, [])`）⇒ **只执行一次**。
这意味着：用户点 E2「去发布」把向导关掉之后，**auto effect 不会再把向导弹回来**（除非整页刷新）。
⇒ 这条既是 E2 能生效的前提，也是**风险 R6**（见 §7）：若用户关掉向导后切走再回来，向导不会自动重开，
  必须靠 E1 反向切回或刷新。方案据此把 E1 定为**必须有**（不是可选）。

---

## 2 核心设计：意图怎么存、怎么消费、怎么不污染 V1

### 2.1 三个候选方案与取舍

| 方案 | 做法 | 致命问题 |
|---|---|---|
| A. 沿用 `__upgradeSurfaceOwner` 常驻值 | 接进 `request` 入参 | **就是当前缺陷**：只写不清 ⇒ 一次点击永久改变默认起点（违反 V1 / V3-a） |
| B. 写 sessionStorage 当事实源 | 存「用户上次选了哪版」 | 违反任务书 §3.6「不写 localStorage/sessionStorage 当事实源」；且刷新后仍生效 ⇒ **违反 V3-a** |
| **C. 模块级「意图槽」+ take 语义（采用）** | 一个变量 + 一次性读函数 | 需注意**双消费**（见 2.3）|

### 2.2 采用方案 C：意图槽 + take

```js
// ── 意图槽（一次性动作，读完即清）────────────────────────
var __upgradeSurfaceIntent = ""          // 只在这里存『这一次』的切换意图

/** 写入意图（供按钮 onClick 调用）。 */
function upgradeSurfaceSetIntentPre(target) {
  var t = String(target == null ? "" : target)
  if (t !== "wizard" && t !== "team-card") return
  __upgradeSurfaceIntent = t
}

/** take：读出并立即清空。判据只调它，不调 peek。 */
function upgradeSurfaceTakeIntentPre() {
  var v = __upgradeSurfaceIntent
  __upgradeSurfaceIntent = ""            // 读完即清 —— 这是 take 语义的全部意义
  return v
}
```

**为什么这样就不污染 V1**：
- 意图只活在**消费它的那一次状态刷新**里，之后槽立即清空；
- 刷新/重进 ⇒ 模块重新求值 ⇒ `__upgradeSurfaceIntent = ""` ⇒ **回到团队优先**；
- 不写任何持久化（不 config、不 storage）⇒ V3-b 成立。

### 2.3 接线形态：**消费点必须唯一**（本方案最容易埋雷处）

两个组件都要用 owner 判据：团队卡片 `:7601`、向导 auto effect `:8713`。

若两处各调一次 `takeIntent()` ⇒ **先执行的那个把意图消费掉，后执行的那个读到 ""** ⇒ 两个组件看到的判据**不一致** ⇒ 极可能出现「两边都不显示」或「两边都显示」。

**设计：意图消费与「状态刷新」绑定，用 seq 幂等。**

```js
var __upgradeSurfaceIntentSeq = -1      // 已消费到哪一次状态刷新
var __upgradeSurfaceIntentFor = ""      // 该次刷新消费到的意图（快照）

/**
 * 由**状态刷新**驱动：seq 变化才真 take；同一 seq 内重复调用返回同一快照。
 * @param {number} seq 本次状态刷新的序号（建议 status.jobId + phase + 时间戳）
 */
function upgradeSurfaceCommitIntentPre(seq) {
  var s = Number(seq)
  if (!isFinite(s)) s = 0
  if (s !== __upgradeSurfaceIntentSeq) {
    __upgradeSurfaceIntentSeq = s
    __upgradeSurfaceIntentFor = upgradeSurfaceTakeIntentPre()
  }
  return __upgradeSurfaceIntentFor
}
```

**效果**：两个组件先后执行，只要 `seq` 相同就**看到同一个意图快照**；`seq` 变化（新一轮状态）才重新 take ⇒ 既保证 take 语义，又不出现双消费。

**但这条仍有未解的洞（自审发现，见自审记录 A2）**：

团队卡片的 owner 判据在**渲染函数体里**（`:7601`，每次 render 都会跑），而向导的 owner 判据在 **auto effect 里**（`:8713`，只在 mount 时跑）。两者**根本不在同一个「状态刷新」节奏上**：卡片的 render 可能因任何 `useState` 变化而重跑多次，而 auto effect 只跑一次。用 `seq` 对齐两者只是把不一致**变得更难复现**，不是消除它。

⇒ **最终方案改为「意图只有一个消费者」（见 2.5），不再依赖 seq 对齐。** 2.3 的 seq 方案作为**被否决的备选**保留在此，供评审对照。

### 2.5 最终方案：意图只有一个消费者（丢弃 seq）

**观察**：两个方向各自都有**显式动作**负责「打开对方 / 关闭自己」，因此意图槽**只需服务一个判据**，不需要跨组件共享一次 take。

| 场景 | 谁需要知道意图 | 驱动方式 |
|---|---|---|
| 用户点 E1「返回向导」 | 向导要打开、卡片要消失 | E1 调既有总线 `upgradeWizardRequestOpenPre()`（`:8358`，向导已订阅于 `:8745`）+ 写意图 `wizard` |
| 用户点 E2「去发布」 | 卡片要出现、向导要关闭 | E2 调向导本地 `setOpen(false)` + 写意图 `team-card` |
| 初次进入 / 状态刷新 | 只需**默认起点**（团队优先） | **不读意图** ⇒ 天然满足 V1 / V3-a |

**关键简化**：意图槽**只服务于「卡片该不该显示」**（向导侧靠 `setOpen` 直接开关，不查意图）⇒ 消费者**唯一**（团队卡片），双消费问题从根上消失。

```js
// ── 意图槽：只有「卡片该不该显示」用得到 ───────────────────
var __upgradeSurfaceIntent = ""        // "" | "wizard" | "team-card"

function upgradeSurfaceSetIntentPre(t) {
  var v = String(t == null ? "" : t)
  if (v !== "wizard" && v !== "team-card") return
  __upgradeSurfaceIntent = v
}

/** take：读出并立即清空。**只由团队卡片在挂载时调用一次**。 */
function upgradeSurfaceTakeIntentPre() {
  var v = __upgradeSurfaceIntent
  __upgradeSurfaceIntent = ""
  return v
}
```

**卡片侧接线**（`:7599-7613` 那段改造）：

```js
// 组件内保存本次生效的意图（不能每次渲染都 take，见下）
var intentPair = useState("")
var intentV = intentPair[0]
var setIntentV = intentPair[1]
useEffect(function () {
  var v = upgradeSurfaceTakeIntentPre()   // ★唯一消费点，且只在挂载时跑一次
  if (v) setIntentV(v)
}, [])

var surfaceVerdict = upgradeSurfaceOwnerPre({
  teamMode: (status.teamMode || {}).mode,
  legacy: !!status.canUpgrade,
  phase: phase,
  teamSticky: sticky === true || upgradeSurfaceTeamStickyNowPre(),
  request: intentV,                        // 用组件内的意图快照
})
var show = wantShow && surfaceVerdict.owner === "team-card"
```

**⚠ 为什么必须存进 `useState` 而不是每次渲染 take（自审 A3）**：
React 组件会因**任意** `useState` 变化重渲染 ⇒ 若在渲染体里 take，第二次渲染时意图已被清空 ⇒ `show` 从 true **跳回** false ⇒ 卡片闪一下就消失。存进 `useState` 后意图在整个组件生命周期内保持；组件卸载再挂载 ⇒ 重新 take ⇒ 槽已空 ⇒ **回到团队优先（V3-a 成立）**。

### 2.4 与既有 `request` 入参的关系

`upgradeSurfaceOwnerPre` **不改签名**，仍吃 `request`。只是调用方**传什么**变了：

```js
request: upgradeSurfaceCommitIntentPre(seq)     // 而不是 upgradeSurfaceOwnerNowPre()
```

`upgradeSurfaceOwnerNowPre()` 与 `__upgradeSurfaceOwner` **保留但不再接进任何判据**；阶段 2 应标注 deprecated 或删除。

---

## 3 优先级再裁定

### 3.1 新优先级链（拟定）

```
① 个人线             (!isTeam)                  => wizard      [不变]
② 切换意图 wizard    (intent === "wizard")      => wizard      [新]
③ 切换意图 team-card (intent === "team-card")   => team-card   [新]
④ running                                        => wizard
⑤ teamSticky                                     => team-card
⑥ legacy                                         => wizard
⑦ 默认                                           => team-card
```

**关键变化**：`intent` 从「排在所有判据之前」改为**排在个人线之后、running 之前**。

**⚠ 自审 A4 修正**：向导侧的 auto effect **不再读意图**（见 2.5：向导被 `setOpen` 直接驱动）。
因此 intent 实际只影响**卡片**的渲染。上表是 `upgradeSurfaceOwnerPre` 的**通用**优先级，
两个调用点传入的 `request` 取值不同：

| 调用点 | `request` 传什么 | 说明 |
|---|---|---|
| 团队卡片 `:7601` | `intentV`（组件内意图快照） | 唯一消费点 |
| 向导 auto effect `:8713` | `""`（**永远空**） | 不读意图；`running` 直接开进度页 |

⇒ 「intent vs running」的裁定**只在卡片侧有实际意义**：running 时卡片是否要因用户点击而出现。
下面 §3.2 仍按「谁赢」给出裁定，但落地形态是**卡片侧**的行为，不是纯函数的优先级排序。

### 3.2 §3.4 的冲突裁定：running 时点了「切到团队卡片」，谁赢

## 结论：**意图赢**（②③ 排在 ④ running 之前）。

#### 为什么不是 running 赢

若 running 赢：
- 用户在 progress 页点「去发布团队基线 →」，**界面毫无反应**（auto effect 在 `:8709` 直接 `setOpen(true)`，永远回进度页）；
- 任务书 §3.5 明令「不能出现点了没反应的按钮」；
- 而这个按钮**只会**在 running 时出现在 progress 页上 —— 它唯一的存在意义就是 running 时能用。「running 优先」等于：这个按钮永远无效。**那是死按钮，不是裁定。**

#### ⚠ 但「意图赢」必须自带回程路径（Lead 指出的缺口，本方案补强）

**原论证的漏洞（自审 A10）**：我只证明了「不能让 running 赢」，**没证明「意图赢了之后用户不会丢进度」**。

而 `:8741` 的 auto effect 依赖 `[]` ⇒ **向导关掉后不会自动重开**。于是：

> 用户在 running 时点 E2「去发布团队基线」⇒ 向导关闭 ⇒ **进度页消失且不会自己回来** ⇒ 他再想看进度，得手动找回来。

这不是「点了没反应」，而是「**点了之后进度就找不回来了**」—— **比死按钮更糟**。

#### 补强方案：采取 (a) + (b) 两条一起（Lead 给的 a/b，我认为都需要）

只做 (b) 回程按钮不够：用户切过去后卡片上**仍是「发布/订阅」四个按钮**，读起来像「整理根本不在跑」，
反而更容易误判。只做 (a) 进度摘要不够：用户能看到进度但**回不到进度页**，仍要自己找。

**故 (a)+(b) 同时做**：

**（a）卡片在 `phase === "running"` 时显示进度摘要**

关键发现：进度模型 `upgradeWizardProgressModelPre`（`:8340`）是**纯函数**，输入就是 `(perWorkspace, status, nowMs)`，
卡片**可以原样复用**，不需要新写一套（本仓纪律：同一语义不得两处判据）。

卡片顶部加一行（仅在 running 时出现）：

```
[整理中] [3/7]  已写入 12 事件 / 34 检查点  已用 01:23 · 预计剩余 02:10
                   key-1 ✓   key-2 ●   key-3 ⋯
```

数据全部来自 `upgradeWizardProgressModelPre(Array.isArray(status.perWorkspace) ? status.perWorkspace : [], status, nowTs)`；
`perWorkspace` 缺失时按既有口径显式提示「逐区状态暂不可用」，**不伪造**。

**（b）卡片上提供明确的回程入口**

E1 按钮在 running 时**文案改为「← 看整理进度」**（而非「← 返回整理向导」），点击 = `upgradeWizardRequestOpenPre()`（`:8358`）。

**为什么复用既有总线而不是新写**：`upgradeWizardRequestOpenPre` 已有 2 处调用点（`:8589`/`:8607`），
向导的订阅处理（`:8745-8758`）里已经做了**正确的事**：

```js
apiGet(API.upgradeStatus).then(function (r) {
  if (r && r.ok) setSt(r)
  setOpen(true)                                                     // 重新打开
  setPage(String((r && r.phase) || "") === "running" ? "progress" : "p1")   // ★running ⇒ 直接回进度页
})
```

⇒ **回程路径已经被既有代码覆盖**，E1 只需调它。这是本补强的关键：「回程」不需要新机制，
需要的是**把既有机制接到 running 场景上**。

#### 对应的新断言（Lead 指定）

| 编号 | 断言 | 负路径 |
|---|---|---|
| **V4** | running 时点 E2 ⇒ 卡片出现**且卡片上有进度摘要**（含 `[n/m]` 与已写入计数） | 去掉进度摘要 ⇒ **必红** |
| **V5** | running 时切到卡片**再点 E1** ⇒ 向导重新打开**且 `page === "progress"`**（不是 p1、不是空白） | 把 E1 改成只 `setIntent` 不调总线 ⇒ **必红** |
| **V5-b** | 若实现不了回程（故意删掉 E1 的总线调用）⇒ V5 **必须红**（证明 V5 有区分力） | — |

#### 为什么意图赢是安全的

1. **进度不会丢**：`phase` 仍是 `running`，卡片状态来自同一个 `upgradeStatus`；用户点「← 返回整理向导」即可回到 progress 页（双向，V2）。
2. **意图是一次性的**：切过去后槽已清空 ⇒ 下一次状态刷新或重挂载 ⇒ **running 判据重新生效**，向导自动回到 progress 页。⇒ 不会出现「切走之后永远看不到进度」。
3. **不违背 #524**：#524 管的是**终态**不得当场卸载（`phase==="done"` 时 sticky 压过 legacy）—— 本次裁定只动 `running` 这一档，**没碰 ④⑤⑥ 的相对顺序**。

#### 必须同步改的代码（否则裁定是假的）

**⚠ 自审 A5 修正：原先「把 `:8709` 挪到 owner 之后」的方案被否决。**

理由：既然向导侧不再读意图（2.5），`:8709` 的 `running` 提前返回**不需要动** —— 它对向导自身是正确行为（running ⇒ 开进度页）。
改动它反而会引入 running 回归风险（自审记录 A5）。

**真正的落地形态**：E2 按钮负责 `setOpen(false)` 关掉向导，同时写 `team-card` 意图；
卡片挂载时 take 到该意图 ⇒ `request="team-card"` ⇒ owner 判 `team-card`（②/③ 档排在 ④running 之前）⇒ **卡片显示**。

⇒ 「意图赢」通过**卡片的判据**实现，**不需要改 `:8709`**。这是本方案相较 v1 的最大简化，也是自审改掉的最重要一条。

**仍然需要验证的点**（R 组）：
- 无意图时，卡片在 `running` 下**仍不可见**（owner 判 `team-running`）⇒ 与现状逐字相同；
- 用户点 E2 后，卡片出现且**向导已关**（`setOpen(false)`）⇒ 互斥成立；
- 用户不点 E2 时，`running` 期间**不可能**出现卡片 ⇒ 不回归。

```js
var ownerV = upgradeSurfaceOwnerPre({ ..., request: commitIntent(seq) })   // 先裁决
if (ownerV.owner !== "wizard") return                                     // 判给卡片 => 不弹
if (phase === "running") { setOpen(true); setPage("progress"); return }    // 判给向导且在跑 => 进度页
var gate = upgradeWizardTriggerPre({ ... })                                // 否则走三道闸
```

**这是本方案唯一一处触及既有行为的改动，必须逐条验证不回归：**
- 无意图时 `commitIntent` 返回 `""` ⇒ `running` 仍判 `team-running` ⇒ owner 给 wizard ⇒ 再进 `if running` ⇒ **行为与现在逐字相同**；
- 这正是 V3-c「切换不得改变既有行为」的关键验证点（见 §6 的 R 组）。

### 3.3 为什么 `intent` 排在个人线之后

个人线（`!isTeam`）没有团队卡片可言。若 intent 排在个人线之前，误传 `intent="team-card"` 会让个人用户看到**不存在的面板**。既有代码已处理（`:8410` `explicit-team-but-personal` ⇒ wizard），但**把顺序放对更干净**：个人线直接短路，intent 根本不必被求值。

---

## 4 UI 切入口

### 4.1 位置与文案

| # | 位置 | 触发条件 | 文案（中 / 英） | 行为 |
|---|---|---|---|---|
| E1 | 团队卡片按钮组（`:8084` ③仅上传 之后） | 卡片**可见** | running 时：`← 看整理进度` / `← View progress`；否则 `← 返回整理向导` / `← Back to the wizard` | 写意图 `wizard` + **调 `upgradeWizardRequestOpenPre()`（`:8358`）** |
| E2 | 向导 progress 页 `btnRow("actions")`（`:9258`，后台运行之前） | `page==="progress"` 且 `phase==="running"` | `去发布团队基线 →` / `Go to team baseline →` | 写意图 `team-card` + 关闭向导 |


**卡片 `running` 态的额外渲染（补强 a）**：在卡片标题下方增加一行进度摘要，仅在 `phase === "running"` 时出现，
数据由 **`upgradeWizardProgressModelPre(perWorkspace, status, nowMs)`（`:8340`，纯函数，原样复用）** 产出 ——
不在卡片里另写一套进度算法（同一语义两处判据必漂移）。

**为什么 E1 放按钮组而不是卡片顶角**：与既有 ①②③ 动作同一排，用户读到的是一组「接下来能做什么」，而不是一个突兀的角标；且 `data-dam-team-*` 前缀与既有测试选择器一致。

### 4.2 「只在合法时机出现」

- **E1** 只在卡片**已经渲染**时出现（`show===true`），不可能「点了没反应」（卡片此刻就在前台）。
- **E2/E3** 只在 progress 页且 `phase` 为 `running`/`done` 时出现；`idle`/`failed` 时不显示（那两档没有「去发布」语义）。
- 三者都是**显式动作**，不是自动跳转。

### 4.3 与 #524 / 六项能力的隔离

- E1 只写意图槽，**不碰** `sticky`、不碰 `phase`、不写 config ⇒ 卡片常驻逻辑（#524）零影响。
- E2/E3 只写意图槽，不触发上传、不改状态 ⇒ 发布门与六项能力零影响。

---

## 5 与既有能力的隔离证明

| 既有语义 | 会不会被改到 | 依据 |
|---|---|---|
| #524 终态不卸载（`teamSticky` 压 `legacy`） | **不会** | ⑤⑥ 相对顺序未变；sticky 变量与卸载清空逻辑未动（`:7616-7619`、`:8567`） |
| `running` 优先于 `sticky` | **不会**（只在**有意图**时让位） | 无意图 ⇒ `intent=""` ⇒ 判据落到 ④ ⇒ 与现状逐字相同 |
| 六项能力（范围/体量/成本/清单/dry-run/逐区状态） | **不会** | 全在 p1/p2/p3 渲染里；本方案只加两个按钮 |
| 发布门 `upgradeTeamPublishGatePre` | **不会** | 门在 `runUploadAfterUpgrade` 内，与前台权判据无交集 |
| 个人版 | **完全不变** | 个人线在 ① 短路，intent 不被求值 |
| 范围选择生效（批0） | **不会** | 后端改动，本方案纯前端 |

---

## 6 验收方案

### 6.1 三条验收的可判定化

| 编号 | 判据 | 断言 | 负路径 |
|---|---|---|---|
| **V1** | 团队用户首次看到团队版 | `{isTeam, legacy:true, intent:""}` ⇒ owner=`team-card` | 把 intent 默认写成 `"wizard"` ⇒ **必红** |
| **V2-a** | 卡片 → 向导 | 真渲染：卡片可见 + 点 E1 ⇒ 卡片 `return null`、向导 mask 出现 | 不写意图槽（只改本地 state）⇒ **必红** |
| **V2-b** | 向导 → 卡片 | 真渲染：向导可见 + 点 E2 ⇒ 向导 `return null`、卡片 mask 出现 | 同上 |
| **V3-a-card** | 卡片重挂载回到团队版 | 消费意图 ⇒ 卡片卸载再挂载 ⇒ `{isTeam, legacy:true, 槽已空}` ⇒ 卡片可见（团队优先） | 让意图不清（peek 语义）⇒ 重挂载后仍按 intent 走 ⇒ **必红** |
| **V3-a-page** | 整页刷新回到团队版 | vm 重建 context（模块重新求值）⇒ 槽为 `""` ⇒ 团队优先 | 把意图写进 sessionStorage ⇒ 刷新后仍生效 ⇒ **必红** |
| **V3-b** | 不改 sticky / phase / config | 点 E1/E2 前后，`upgradeSurfaceTeamStickyNowPre()`、`status.phase`、config 快照**逐字相等** | 让 E1 顺手 `setSticky(true)` ⇒ **必红** |
| **V3-c** | 可切回来 | 卡片→向导→卡片，两次都成功 | 让 take 变 peek（不清）⇒ 第二次切回**必红** |
| **穷举** | 恰好一个可见 | `(isTeam × phase × sticky × legacy × intent)` = 2×4×2×2×3 = **96 组**，每组断言 `card XOR wizard` | 去掉 owner 收窄 ⇒ 重合必现 |
| **V6 · 脏值**（裁定②） | 非法值不卡槽 | `TakeIntent` 遇 `'bogus'` / `null` / `123` / `undefined` / `{}` ⇒ 返回 `""` **且槽被清空**，不抛错 | 把非法值原样写进槽 ⇒ 后续判据被钉住 ⇒ **必红** |

### 6.2 真渲染要求（CR-10）

**不能只断言纯函数返回值**。必须像 `smoke-test-upgrade-surface-arbitration.mjs` 那样，从 `lib/client.js` **抽出真实判定链**在 `node:vm` 里真跑，断言「恰好一个可见」。新增切入口后判定链要包含 `commitIntent(seq)` 调用 ⇒ 抽取方式需相应扩展（见 6.4）。

### 6.3 变异验证（缺一不可）

1. `takeIntent` 改回 `peekIntent`（不清空）⇒ V3-c **必红**
2. `intent` 判据整段删掉 ⇒ V2-a/V2-b **必红**
3. 把 `intent` 写进 `__upgradeSurfaceTeamSticky` ⇒ V3-a/V3-b **必红**
4. 把意图消费点从「卡片挂载时」改成「删除」⇒ E2 后卡片**不出现** ⇒ V2-b **必红**
5. 让卡片**忽略** `request`（写死 `""`）⇒ V2-b 必红（即使写了意图也切不过去）
6. 把意图存进 `__upgradeSurfaceTeamSticky` ⇒ V3-a/V3-b **必红**（sticky 是事实镜像，会被卸载清空/被下轮 running 污染）
5. 去掉 owner 收窄（`show = wantShow`）⇒ 穷举 **必红**

### 6.4 套件改造

- **新增** `tests/smoke/smoke-test-upgrade-surface-intent.mjs`：I 组（意图槽 take/commit，含**双消费**负路径）、V 组（V1/V2-a/V2-b/V3-a/V3-b/V3-c 真渲染）、X 组（96 组穷举）、M 组（5 条变异）
- **改** `smoke-test-upgrade-surface-arbitration.mjs`：判定链抽取要带 `request: commitIntent(seq)`（否则跑不通 ⇒ 会退化为 SKIP，**必须核对 SKIP=0**）
- **改** `smoke-test-team-upgrade-capability.mjs`：优先级链新增 ②③ 两档 ⇒ 既有 S1~S5 约 3~5 条需同步
- **删** `smoke-test-team-upgrade-capability.mjs` 的 **B 组**（总线 7 条，B-1~B-7）—— 裁定①：三个总线函数整体删除，B 组随之作废。**PASS 数会降，这是预期**（详见 §7 的风险 R8）
- **必跑** `smoke-test-client-loadable`（真执行 factory）

### 6.5 SKIP / 基线

- 每批必报 **PASS / FAIL / SKIP**；SKIP 上升即停工（本仓踩过「守卫退化成 SKIP 但套件全绿」）
- iter5-skin classicLF 会变 ⇒ 按四段归因重钉

---

## 7 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| R1 · 双消费导致两组件判据不一致 | 可能「两边都不显示」 | §2.3 的 seq 幂等；I 组专门断言 |
| R2 · 改 `:8709` 分支顺序引入 running 回归 | 在跑时看不到进度 | §3.2 四条验证；R 组断言「无意图时行为逐字不变」 |
| R3 · 意图槽在异常路径未被消费 | 一次点击影响后续渲染 | 每次状态刷新都 `commitIntent(seq)`（幂等）；异常走 try/catch 返回 "" |
| R4 · 卡片 closed/Esc 关闭与意图冲突 | 切过去又被关掉 | E1 只在 `show===true` 时出现；`closed` 是会话内状态，卸载即失效 |
| R5 · classicLF 重钉遗漏 | 套件红 | 按既有四段归因流程 |

| R6 · 向导 auto effect 只跑一次（`[]` 依赖，`:8741`） | 用户关掉向导后，切走再回来**不会自动重开** | E1「返回向导」是**必需**而非可选：它走 `upgradeWizardRequestOpenPre`（既有总线，订阅于 `:8745`）显式打开 |
| R8 · 裁定①删除总线导致 `team-upgrade-capability` PASS 下降 | 看起来像回归 | **预期行为**：B 组 7 条（B-1~B-7）随三函数一起删；实施时必须**明确报出降了几条**，并核对**除 B 组外无其他下降** |
| R7 · 卡片 `closed`（Esc/关闭按钮）与意图叠加 | 切过去后可能立即被 `closed` 关掉 | `closed` 是组件内 `useState`（`:7544`），卡片卸载即归零；E1 只在 `show===true` 时出现，不可能点到隐藏卡片 |

**回滚**：改动集中在 `lib/client.js` 手写区 + 新增一个套件；回滚 = 反向 patch 三处（判据链、两个按钮、`:8709` 顺序），无数据/配置迁移，无版本号变动。

---

## 自审记录

> 自审方式：把自己当**敌对评审**，逐条问「这条论证成立吗？代码真的长这样吗？」。下列每条都对应一次实际的代码取证或设计推翻。

### A1 · 发现「running 提前返回在 owner 之前」（保留，成为方案基石）

**问题**：v0 草案只在纯函数里排优先级，假设「改了 `upgradeSurfaceOwnerPre` 的顺序就生效」。
**取证**：`:8709` 的 `if (phase === "running") { setOpen(true); ...; return }` 在 `:8713` owner 判据**之前**（相差 275 字符）⇒ 即使 owner 判 `team-card`，running 时向导仍会自己打开。
**处置**：写进 §1.4 F1，并在 §3.2 中作为裁定的硬前提。**这是本方案能成立的前提，不是细节。**

### A2 · 推翻 v1 的「seq 幂等 take」（最重要的一条）

**v1 设计**：两个组件共用一次 take，用 `seq` 保证它们看到同一快照。
**自审发现**：卡片的 owner 判据在**渲染函数体**里（每次 render 都跑），向导的在 **auto effect** 里（只跑一次）——**两者不在同一个节奏上**。`seq` 只能让不一致更难复现，不能消除。
**处置**：改为**单一消费者**（§2.5）——意图槽只服务卡片，向导靠 `setOpen` 显式开关。**双消费问题从根上消失**，不是被缓解。

### A3 · 发现「渲染时 take」会让卡片闪一下消失

**问题**：若在组件渲染体里调 `takeIntent()`，第一次渲染拿到 `team-card` 显示卡片，随后任意 `useState` 变化触发重渲染 ⇒ 第二次 take 得到 `""` ⇒ `show` 跳回 false ⇒ **卡片闪一下就没**。
**取证**：`UpgradePopup` 内有 `closedPair` / `offerPair` / `busy` / `msg` 等多个 `useState`，重渲染是常态。
**处置**：take 结果存入组件自己的 `useState`，且**只在挂载时 take 一次**（§2.5 代码块）。

### A4 · 修正「向导也读意图」的过度设计

**问题**：v1 让向导 auto effect 也读 `request`，导致必须讨论「两个消费点」。
**自审发现**：向导根本不需要读意图——它由 E1/E2 的显式 `setOpen` 驱动。
**处置**：向导侧 `request` **永远传 `""`**（§3.1 表）。少一个消费者 = 少一整类竞态。

### A5 · 推翻 v1 的「必须改 `:8709`」（第二重要）

**v1 设计**：为让「意图赢 running」，把 `:8709` 挪到 owner 之后。
**自审发现**：既然向导不读意图（A4），`:8709` 对向导自身是**正确行为**；改动它只会引入 running 回归风险，且收益为零。
**处置**：**不动 `:8709`**。裁定的落地形态改为「卡片挂载时 take 到意图 ⇒ owner 判 team-card ⇒ 卡片显示」（§3.2）。风险 R2 随之消失。

### A6 · 发现两个组件挂载生命周期不同（影响 V3-a 的验法）

**取证**：卡片挂在**白板页面内**（`:9812`）⇒ 随页签卸载；向导挂在 `shell.overlay`（`:25271`）⇒ **会话级常驻**。
**问题**：v1 只写「重挂载 ⇒ 回到团队版」，但向导根本不会重挂载 ⇒ 这条验收对向导**无法验证**。
**处置**：V3-a 拆成 **V3-a-card**（卡片重挂载）与 **V3-a-page**（整页刷新 = vm 重建 context）两条（§6.1）。

### A7 · 发现向导 auto effect 只跑一次（新增风险 R6）

**取证**：auto effect 依赖数组是 `[]`（`:8741`）。
**后果**：用户关掉向导后，**切走再回来不会自动重开**。
**处置**：E1「返回向导」定为**必需**（走既有 `upgradeWizardRequestOpenPre` 总线，`:8358`，向导订阅于 `:8745`），并登记为 R6。

### A8 · Lead 已裁定（原为待拍板项）

| 项 | 裁定 |
|---|---|
| 零调用点三函数 | **删除**（语义本就错，标 deprecated 会诱导后人再接）；`__upgradeSurfaceTeamSticky` **不能删**（事实镜像，与总线无关） |
| 穷举维度 | **96 组够**；另加 1 条非法值断言（V6），不扩到 128 组 |
| E3（done 切入口） | **不做** —— done 时卡片本就因 sticky/#524 自动出现，E3 冗余；少一个入口少一条要验的路径 |

### A8-old · 原待拍板项（已由 Lead 裁定，保留备查）

1. **`__upgradeSurfaceOwner` / `upgradeSurfaceOwnerNowPre` 的处置**：本方案不再使用它们。
   建议阶段 2 **直接删除**（三个函数零调用点，删掉最干净）；但删除会改变 `smoke-test-team-upgrade-capability` 的 B 组断言（B-1~B-7）。
   ⇒ 请 Lead 裁定：**删除**（并同批改套件）还是**保留并标注 deprecated**。
2. **96 组穷举的维度取值**：`intent` 我取 `{"", "wizard", "team-card"}` 三值。
   若你认为还需覆盖「非法值」（如 `"bogus"`），变成 128 组 —— 请确认。
3. **E3（done 态切入口）的必要性**：任务书只点名了「progress/done 上『去发布团队基线 →』」。
   我按点名实现了，但**done 态其实已有卡片自动出现**（sticky，#524）⇒ E3 可能是冗余按钮。
   ⇒ 建议：**先只做 E2（running 态）**，E3 观察是否需要。请 Lead 决定。
4. **切入口的 i18n**：文案我已给中英对照，但 `USER-GUIDE` 是否要同步补一节，等你指示。

### A10 · Lead 指出的缺口：只论证了「不能让 running 赢」，没论证「意图赢后不丢进度」（最重要的一条）

**原方案漏洞**：裁定「意图赢 running」的理由只有反面论证（running 赢 ⇒ 死按钮），**缺正面论证**（意图赢 ⇒ 用户不会失去进度）。

**取证**：auto effect 依赖 `[]`（实际 `:8701` 开始、`:8741` 结束）⇒ 向导关掉后**不会自动重开**。

**后果比死按钮更糟**：用户点 E2 后进度页消失且不会自己回来 ⇒ 「点了之后进度就找不回来了」。

**处置**：补 §3.4 的「回程路径」整节 —— (a) 卡片 running 态显示进度摘要 + (b) E1 在 running 时文案改「← 看整理进度」并调既有总线。
**关键发现**：回程**不需要新机制** —— `upgradeWizardRequestOpenPre`（`:8358`）+ 向导订阅处理（`:8745-8758`）里已经做了「running ⇒ setPage('progress')」。要做的只是**把这个既有机制接到 running 场景上**。

**新增断言**：V4（卡片有进度摘要）、V5（切回后 `page === 'progress'` 而非空白）、V5-b（删掉总线调用 ⇒ V5 必红）。

### A11 · 修正文档里的行号错误

原稿写 auto effect 依赖在 `:8651` —— **实测是 `:8741`**（effect 起于 `:8701`，`}, [])` 落在 `:8741`）。
Lead 独立核实时给的是 `:8741`（正确）。已全文修正 3 处。**教训：引用行号必须用脚本取，不能手写。**

### A9 · 自审后仍未消除的残余风险

- **卡片与向导的「同一 tick」竞态**：E2 里先 `setOpen(false)` 再 `setIntent("team-card")`，两者都是同步调用；
  但卡片要等它自己的 `useEffect`（挂载时 take）才生效 —— 若卡片**当前未挂载**（用户在别的页签），
  意图会**留在槽里**直到卡片下次挂载。这符合「切过去 = 下次看到卡片」的语义，但**意味着 E2 后用户可能看不到立即变化**。
  ⇒ 已登记为验收项：**E2 后若卡片已挂载，必须立即出现；若未挂载，不得报错**。
- 本方案**未**做真实浏览器验证（阶段 1 只出方案）；所有结论基于源码取证 + 既有 vm 真渲染套件的手法。
