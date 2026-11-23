# 团队线迁移引导能力补齐 · 实施方案 v1

> 2026-11-05 · 阶段一交付物（**只出方案，未改任何产品代码**）
> 任务书：`artifacts/wave1-prompts/TEAM-UPGRADE-BRIEF.md`
> 实施依据：本文件经 Lead 批准后作为阶段二的施工依据。
> 所有 file:line 均为撰写时（`lib/client.js` 2,862,047 B / 25,149 行；`lib/index.js` 1,975,512 B / 27,423 行）实测位置。

## 1 现状与问题

### 1.1 两条线已经分叉（实测复核）

| 项 | 个人模式 | 团队模式 |
|---|---|---|
| 组件 | `UpgradeWizard` @ `client.js:8396` | `UpgradePopup` @ `client.js:7503` |
| 挂载 | `shell.overlay` order 8，`auto:true` @ `client.js:24971` | `EventView` 返回树内 @ `client.js:9647` |
| 分流 | `client.js:7605` `if (!isTeamMode) return null` | 同上（团队才继续） |
| 页/信息 | 5 页（p1/dry/p2/p3/progress） | 单卡 + 4 相位标题 + 一行 counts + reasons |

`client.js:7602-7604` 的既有裁定原文（**不推翻**）：
> 三页向导接管**个人模式**；本卡只保留团队模式的「基线发布/订阅」流程。个人使用仍走向导；团队模式分支（#516/#517/#518 那套）**一字未动**。

用户 2026-10-31 原话：「如果个人使用的话，依旧是原来的这一套 memory update 弹窗流程」⇒ **个人版形态是标杆，团队版向它看齐**。

### 1.2 团队卡片现有的四个动作（全部保留，语义不动）

| 按钮 | handler | 位置 | 后端 |
|---|---|---|---|
| ① 在远端搜索新版本 | `onSearchRemote` | `client.js:7729` | `POST team-baseline {action:'search-remote'}` |
| 下载并应用 | `onApplyBaseline` | `client.js:7906` | `{action:'apply', expectedChecksum}`（#516 硬闸） |
| ② 自己整理并上传 | `onSelfUpgrade` → `runUploadAfterUpgrade` | `client.js:7790` / `7833` | `{action:'upload', uploadAfterUpgrade:true}` |
| ③ 仅上传已完成结果 | `onResumeUpload` | `client.js:7893` | 同上（#525「恰好一次」） |

### 1.3 叠加缺陷（真缺陷，本次必修）

证据链（逐条已复核）：

- 团队卡片可见性：`client.js:7595` `var show = !!status.canUpgrade || phase === 'running' || sticky`
- `canUpgrade` 定义：`index.js:26820` `const canUpgrade = legacy === true && !(declined && sinceMs < SNOOZE) && phase !== 'running'`
- 向导触发：`client.js:8145 upgradeWizardTriggerPre` 三道闸 = `legacy` / `sessionDismissed` / `sinceMs >= 24h` —— **不含 teamMode**
- 向导挂载：`client.js:24971 h(UpgradeWizard, { auto: true, ... })`，`UpgradeWizard` 组件内（`client.js:8396-8974`）**零 team 判断**

⇒ 团队模式 + `legacy===true` 时两者**触发条件完全重合**。两者样式同为 `position:fixed; left:50%; top:50%; transform:translate(-50%,-50%)`、z-index 同为 2147481999/2147482000（`client.js:8371-8379` 与 `7956-7980`）⇒ 遮罩双叠、卡片重合。

**零测试覆盖（实测）**：扫 `tests/` 全部 561 个 `.mjs`，
- 含 `teamMode` 的套件：**0 个**（全仓仅 `lib/client.js`、`lib/index.js` 两个文件出现该词）
- 含 `upgradeWizard|UpgradeWizard` 的套件：2 个（`smoke-test-iter5-skin.mjs`、`smoke-test-upgrade-wizard-client.mjs`）
- **交集：0 个** —— 任务书 §5 的判断成立。

### 1.4 两个被任务书漏掉的连带真缺陷（本方案新增取证）

**(A) 范围选择目前是死功能。**
- `client.js:8618` 发送 `{action:'start', ws, scope, effort, model}` + `8619 workspaceKeys`
- `index.js:26506-26510` handler 透传 `scope/model/effort` 进 `startUpgradeJobPre`
- `index.js:10876` **只把它写进 state** `scope: (opts && opts.scope) || 'all'`
- 全仓检索：`opts.scope` 仅此 1 处（写入）；`workspaceKeys` 全仓仅 `client.js:8619` 1 处，**后端从未读取**
- 派发时 `index.js:10889 buildWorkspaceManifestPre()` **无参**（签名声明确认：`10388 async buildWorkspaceManifestPre() {`），清单恒为「全部工作区」
- 提示词 `index.js:10443` 写死「✅ 只处理上表这 N 个工作区，**一个不许漏，也一个不许加**」

⇒ 用户选「仅当前工作区」，子代理仍处理**全部**区。**个人版与团队版都是假功能**。

**(B) `perWorkspace` 恒空。**
- `index.js:10876` 初始化 `perWorkspace: []`
- `index.js:26865` 原样回传
- 全仓无任何写入点（`grep perWorkspace` 命中：client 的读侧 4 处 + index 的写初值/回传各 1 处）

⇒ P4 已做的进度卡「逐区」在任何模式下**永远显示「逐区状态暂未回报」**。团队版补逐区进度若不先补这个，同样是空壳。

### 1.5 现状能力矩阵（修正版）

| 能力 | 个人版 | 团队版 | 说明 |
|---|---|---|---|
| 工作区清单 | ✅ 有 UI | ❌ | `/upgrade-workspaces` 本机路由，两线都能用 |
| 各区体量 | ✅ 有 UI | ❌ | 同上 |
| 成本估算 | ✅ 有 UI | ❌ | 服务端 `estimateUpgradeTotalsPre` |
| 范围选择 | ⚠️ **有 UI 无效果**（§1.4A） | ❌ | |
| dry-run | ✅ | ❌ | 纯 IO 零写盘，见 §5 |
| 逐区进度 | ⚠️ **有 UI 无数据**（§1.4B） | ❌ | |
| 团队特有：`teamUpgradePhase` 显示 | — | ❌ | `idle→pausing→pulling→upgrading→verifying→done`，见 `team-upgrade-driver.js:38` |

---

## 2 形态决策

### 2.1 选定：**团队复用向导**（同一组件 + `mode` 分流），团队卡片降为「发布/订阅动作面板」

具体形态：

```
teamMode.mode === 'team' 且 legacy === true
  ⇒ UpgradeWizard(mode:'team') 取得前台权
     p1 检测说明（+ 团队上下文块：远端基线状态 / teamUpgradePhase / 同步是否暂停）
     dry 只读体量与费用（+ 「上传基线是单区动作」提示）
     p2 范围选择（默认 current，见 §3.3）
     p3 模型/思考强度/费用
     progress 逐区进度；phase==='done' 时出现「去发布团队基线 →」
        └─ 点击 ⇒ 前台权交给 UpgradePopup（团队卡片，只显示 4 个动作）
              └─ 卡片上有「← 返回整理向导」互达
teamMode.mode === 'team' 且 legacy !== true
  ⇒ UpgradePopup 取前台权（无东西可整理，只剩发布/订阅）—— 与今天行为一致
teamMode.mode !== 'team'
  ⇒ UpgradeWizard（个人模式，行为零变化）
```

### 2.2 为什么选它

1. **用户裁定要求团队版向个人版看齐**（§1.1）。复用同一组件是最直接的兑现；补两套会立刻产生第二份判据。
2. **6 项能力的实现已经在向导里**：`upgradeWizardTriggerPre`(`8145`)、`upgradeWizardCostSharePre`(`8163`)、`upgradeWizardSecondsPre`(`8193`)、`upgradeWizardProgressModelPre`(`8204`)、`upgradeWizardScopeRowsPre`(`8251`)、`upgradeWizardCurrentRowPre`(`8272`)。它们全部是**纯函数、零 team 假设**，团队模式直接用即可。重写第二份 = 本仓明令禁止的「同一语义两处判据」。
3. **叠加缺陷自动消失**：一旦有「谁有前台权」的单一裁决，两个组件物理上不会同时渲染 —— 不需要 z-index 补丁、不需要 `pointer-events` 再修。
4. **风险面最小**：团队卡片只改**可见性判据**（1 行）+ 加 2 个按钮，四个 handler 与 `runUploadAfterUpgrade` **一字不改**，`#516/#517/#518/#525` 语义零风险。

### 2.3 否决的方案

**(a) 给团队卡片补齐 6 项能力（在 `UpgradePopup` 里长出一套页状态机）**
否决理由：
- `UpgradePopup` 已 562 行（7503-8065），再塞 5 页会把 `r38` 的 helper 段锁（250~1500，当前实测 1341）直接顶穿；
- 两套页状态机 + 两套 DOM 命名（`data-dam-wizard-*` vs `data-dam-team-*`）⇒ 守卫要写两遍；
- 用户会看到两种不同长相的向导，违反「形态是标杆」。

**(b) 团队线独立第三组件 `TeamUpgradeWizard`**
否决理由：纯函数复用但 DOM 重写，等于把 53932 字符的向导段复制一份，维护成本翻倍且必然漂移。

**(c) 保持现状，只把团队卡片挪到向导下面（z-index/位置错开）**
否决理由：这是**掩盖不是修复**。两层 `position:fixed` 遮罩仍在（`pointer-events:none` 虽不拦点击，但视觉上两张卡都在屏幕中央），且「谁在前台」的语义仍然未定义，后续任一改动都会复发。

---

## 3 能力补齐设计

先定**单一裁决点**，所有能力都挂在它下面。

### 3.0 前台权裁决（新增纯函数，方案核心）

```js
/**
 * 谁有升级引导的前台权。**唯一实现** —— 两个组件的可见性都必须由它派生，
 * 组件内不得再自行判断 teamMode（同一语义两处判据必漂移）。
 * @param {{teamMode?:string, legacy?:boolean, phase?:string,
 *          teamSticky?:boolean, request?:'wizard'|'team-card'|''}} input
 * @returns {{owner:'wizard'|'team-card'|'none', reason:string}}
 */
function upgradeSurfaceOwnerPre(input) { ... }
```

判据表（逐条，可被守卫套件真调用）：

| 输入 | owner | reason |
|---|---|---|
| `request==='team-card'` 且 `teamMode==='team'` | `team-card` | `explicit-team` |
| `request==='team-card'` 但非团队 | `wizard` | `explicit-team-but-personal` |
| `request==='wizard'` | `wizard` | `explicit-wizard` |
| `teamMode!=='team'` | `wizard` | `personal` |
| 团队 + `teamSticky===true` | `team-card` | `team-sticky` |
| 团队 + `phase==='running'` | `wizard` | `team-running`（进度在向导 progress 页） |
| 团队 + `legacy===true` | `wizard` | `team-legacy` |
| 团队 + `legacy!==true` | `team-card` | `team-no-legacy` |
| 未知/异常 | `wizard` | `fallback`（fail-open 到个人线，绝不锁死界面） |

**`teamSticky` 为什么入参**：`#524` 要求终态后卡片不得当场卸载（`client.js:7688 setSticky(true)`）。sticky 是组件内 state，纯函数读不到 ⇒ 作为入参传入。优先级必须高于 `legacy`，否则「整理完成」那一刻卡片会被向导抢回去、用户看不到结果。

配套总线（模块级，与现有 `upgradeWizardRequestOpenPre` @ `client.js:8316` 同族）：

```js
var __upgradeSurfaceOwner = ''            // '' | 'wizard' | 'team-card'
function upgradeSurfaceRequestOwnerPre(target) { ... 广播 ... }
function upgradeSurfaceSubscribeOwnerPre(fn) { ... 返回退订 ... }
function upgradeSurfaceOwnerNowPre() { ... }
```

### 3.1 工作区清单 + 3.2 各区体量（同一数据源）

- 数据：`GET /upgrade-workspaces?effort=<effort>` → `{workspaces:[{wsKey,wsPath,planChars,logCount,logChars,chars}], totals, opencodeUsableChars}`
- 后端：`index.js:4477 buildUpgradeWorkspacesPre`（纯 IO，零 LLM，零写盘）
- **复用** `ensureInventory(eff)` @ `client.js:8533`（已实现 `invCacheRef` 缓存 + 错误可见），团队分支直接调用，**不新增第二条取数路径**
- UI：团队模式下在 `p1` 增加一块 `data-dam-wizard-team-context`：
  - 工作区数、各区体量（沿用 `renderDry` 的 `data-dam-dry-row` 行结构）
  - 团队特有：`teamUpgradePhase`（取自 `GET /config` 的 `teamUpgradePhase`，与 `teamResumeGatePre` @ `team-sync.js:591` 同源）、`teamPaused` 状态
  - 明确一行：「以下统计是本机全部工作区；**上传基线只发当前工作区**」（见 §6）

### 3.3 范围选择（语义见下，**必须先补 §1.4A 才不是假的**）

- **默认值 = `current`**（两个模式统一）。理由三条：
  1. 兑现 `PLAN-520` 裁定 3「**默认范围让用户在弹窗里选，并做好备注说明**」—— 用户明确要的是「可选 + 说清楚」，不是「默认全部」。默认全部会与「最快、先做一次看看」的首次体验冲突。
  2. 与上传语义一致（§6）：上传固定单区，默认 `current` 让「选中」与「将发布」天然对齐，不产生「我选了三区却只发了一区」的误解。
  3. 个人版现状就是 `current`（`client.js:8418 useState('current')`），团队版改成 `all` 会让两条线在同一个纯函数上分叉。
- **备注说明**（`p2` 必须渲染，缺一不可）：
  - 每个选项旁一句：`current` =「最快，推荐首次」/ `all` =「逐区处理，可中断，费用按字符线性增长」/ `subset` =「只整理勾选的区」
  - 一行强制提示：**「整理范围只决定『整理哪些区』；发布团队基线永远是『当前工作区』这一个区（后端 `uploadBaselinePre({ws})` 只打包单区）。选『全部』不会让上传变成多区。」**
- 团队模式下 `all` 额外警告：若 `teamUpgradePhase` 不在 `idle|done`，禁用「开始整理」并指向 `teamResumeGatePre` 的拒因（`upgrade-in-progress`）。

### 3.4 成本估算（口径见 §4）

- 复用 `upgradeWizardCostSharePre(totals, rows)` @ `client.js:8163`（按 chars 占比分摊，**前端零价格公式**）
- 团队模式在 `p3` 费用块下方增加两行**零成本**说明：
  - `data-dam-wizard-cost` = `publish-pack`：「打包基线 ¥0（本地 brotli 压缩，无模型调用）」
  - `data-dam-wizard-cost` = `publish-net`：「同步到团队 ¥0（走团队 outbox，无 LLM）」
- 依据：`packBaselinePre` @ `team-baseline.js:113` 只做 JSON 序列化 + `brotliCompressSync`；`uploadBaselinePre` @ `index.js:10542` 只读文件 + enqueue。全链路无模型调用。

### 3.5 dry-run（见 §5 结论：**允许**）

- 直接复用向导 `dry` 页（`client.js:8753 renderDry`）
- 团队模式在页内加一行：「本页只读；**不会**触发基线发布、不会改 `teamPaused`、不会写 `baseline-offer.json`」
- 团队模式下不提供「导出报告」以外的动作（导出是本地 Blob 下载，零副作用）

### 3.6 逐区进度（**必须先补 §1.4B 才有数据**）

- 复用 `upgradeWizardProgressModelPre` @ `client.js:8204`
- 团队模式在 `progress` 页额外一行：`data-dam-progress-team-phase` 显示 `teamUpgradePhase`（与 `upgrade-state.phase` 是两个不同东西，UI 要分开写标签：「整理阶段」vs「迁移阶段」）
- `phase==='done'` 时新增按钮 `data-dam-wizard-publish`「去发布团队基线 →」⇒ `upgradeSurfaceRequestOwnerPre('team-card')`

### 3.7 互达按钮（防止用户被卡死）

- 团队卡片新增 `data-dam-team-back-to-wizard`「← 返回整理向导」⇒ `upgradeSurfaceRequestOwnerPre('wizard')`
- 仅当 `legacy===true` 时显示（`legacy!==true` 时没有可整理的东西，按钮会点进一个空转的向导）

---

## 4 成本估算口径（回答问题 4）

**结论：只算整理成本；上传与同步成本恒为 ¥0。**

| 环节 | 是否有模型调用 | 依据 | UI 呈现 |
|---|---|---|---|
| 整理（子代理） | 是 | `startUpgradeJobPre` → `runSubagent(MEMORY_BASIS_MIGRATION_PROMPT)` @ `index.js:10891` | `upgradeWizardCostSharePre` 三档费用 + 耗时 |
| 打包基线 | 否 | `packBaselinePre` @ `team-baseline.js:113`：JSON + `brotliCompressSync` | ¥0（显式标注） |
| 远端搜索 | 否 | `probeBaselineRemotePre` 网络探测 | ¥0 |
| 上传/入队 | 否 | `uploadBaselinePre` @ `index.js:10542` → `_teamOutbox.enqueue` | ¥0 |
| 下载并应用 | 否 | `applyBaselineOfferPre` @ `index.js:10636`：解包 + 写盘 | ¥0 |

**为什么不把上传算进来**：① 事实层面它没有 LLM 调用（上表逐条可查）；② 若把网络/压缩折算成「成本」，就必须引入第二套计量口径，而本仓铁律是「前端不得复制价格公式」—— 编一个上传价格就是新的第二份判据。⇒ **明确标注 ¥0，而不是估算一个非零值**。

**整理成本的口径不变**：`estimateUpgradeTotalsPre`（服务端，`lib/upgrade-estimate.js:86`）按 `chars/1.19` 算 inTok，按 `EFFORT_OUT_RATIO` 算 outTok，三档价（谷 1/4、峰 2/8、中转 0.09/0.36）。团队模式与个人模式**同一口径**，唯一差别是可能选更多区（chars 更大）。

---

## 5 dry-run 在团队场景下是否允许（回答问题 5）

**结论：允许，且是安全的。**

**副作用核查（逐条对照实际调用链）**：

| 可能副作用 | 是否发生 | 依据 |
|---|---|---|
| 改 `teamPaused` | ❌ | `buildUpgradeWorkspacesPre` @ `index.js:4477-4496` 只有 `readFile`/`readdir`/`stat`；`pauseSync` 只在 `applyBaselineOfferPre` 里调 |
| 写 `baseline-offer.json` | ❌ | 只有 pull applier 与 `search-remote` 的缓存读取路径涉及，dry 不调 |
| 写 `upgrade-state.json` | ❌ | `readUpgradeStatePre` @ `10254` 只读；写盘只在 `writeUpgradeStatePre` 与 `startUpgradeJobPre` |
| 派子代理 / 花 token | ❌ | 无 `runSubagent` 调用 |
| 改团队基线 | ❌ | 无 `uploadBaselinePre` / `enqueue` 调用 |

⇒ `dry` 页在团队模式下的行为**与个人模式逐字节相同**，唯一差别是文案多一行「不会触发基线发布」。

**但要写清 dry-run 看不到什么**：它**看不到远端基线状态**（那是 `onSearchRemote` 的职责）。用户若想知道「远端有没有新版」，必须先点「① 在远端搜索新版本」。UI 上 dry 页给出 `data-dam-wizard-dry-team-hint`：「想知道远端有没有新基准？请在发布页点『① 在远端搜索新版本』—— 本页只量本机体量。」

---

## 6 上传粒度与「发布团队基线」的关系（回答问题 6）

**核心事实（实测）**：
- `uploadBaselinePre(o.ws)` @ `index.js:10542` → `resolvePathsSyncForBaseline(o.ws)` @ `10805` → `projectDirOf(wantWs)`
- 打包文件 = 该**单个工作区**的 `handoff/event-store.json` + `handoff/PLAN.md` + `MEMORY.md` + 用户级 `MEMORY.md`（`index.js:10556-10567`）
- outbox key 固定 `'baseline:current'`（`index.js:10578`）⇒ 远端永远只有 1 条
- 白名单：`TEAM_BASELINE_REQUIRED_PRE=['event-store.json']` + 3 个 optional（`team-baseline.js:40-53`）

**⇒ 上传粒度 = 单个工作区，这是后端既有事实，本次不改。**

因此设计三条硬约束：

1. **UI 必须明说**：`p2` 与 `p3` 各一行，「发布团队基线 = 发布**当前工作区**的记忆基准（单区）。整理范围不影响上传范围。」
2. **新增前置校验**（纯函数 `upgradeTeamPublishGatePre`）：

```js
/**
 * 团队发布门：当前工作区必须在选中范围内，否则拒绝上传并说明原因。
 * 背景：整理范围可选多区，但 uploadBaselinePre 只打包 ws 指定的单区。
 *   若当前 ws 不在选中范围 ⇒ 整理完的是别的区，此刻上传发出去的是**当前区整理前的旧内容**
 *   （与 #481「整理没完成就打包」同族，只是换成了另一个维度）。
 * @param {{scope:string, currentWs:string, selectedKeys:string[], uploadTargetWs:string}} input
 * @returns {{allowed:boolean, reason:string}}
 */
function upgradeTeamPublishGatePre(input) { ... }
```

判据表：

| 条件 | allowed | reason |
|---|---|---|
| `uploadTargetWs` 为空 | false | `no-target` |
| `scope==='current'` 且 target === currentWs | true | `ok` |
| `scope==='all'` | true | `ok-all` |
| `scope==='subset'` 且 target ∈ selectedKeys | true | `ok-subset` |
| `scope==='subset'` 且 target ∉ selectedKeys | false | `target-not-selected` |
| 其他 | false | `unknown` |

3. **UI 落点**：`upgradeTeamPublishGatePre` 为 false 时，团队卡片的「② 自己整理并上传」禁用，并在卡片上显示原因：「本次整理范围不含当前工作区，因此没有可发布的基准；请改选『仅当前』或先整理当前区。」

---

## 7 兼容与降级（回答问题 7 —— **含一处对任务书前提的订正**）

### 7.1 订正：`/upgrade-workspaces` 是**本机**路由，不是对端路由

任务书 §9.7 写「老版本**对端**（无 `upgradeWorkspaces` 路由）怎么办」。实测：

- 路由注册：`index.js:26747 path: API['upgrade-workspaces']`，`API` 表 @ `index.js:504` 定义 `'/api/dsh-auto-memory/upgrade-workspaces'`
- handler 直接调本机引擎：`engine.buildUpgradeWorkspacesPre(null, {effort})`
- **不经过**团队传输层（`team-transport*` / `team-pull` / `team-outbox` 全仓 0 处引用该路由）

⇒ 对端版本**不影响**这条路由能否用。真正会缺失字段的是「**本机插件版本较旧**」（用户装了老版 dsh-auto-memory）或「本机引擎异常」。

### 7.2 真正需要处理的四类降级

| # | 场景 | 判据 | 降级行为（必须有明确文案，不许静默） |
|---|---|---|---|
| D1 | 本机无该路由（404） | `apiGet` 抛，`e.response.status===404` 或 body 非 `{ok:true}` | 清单/体量/费用三块显示「本机插件版本过旧，无法读取体量清单（请升级 dsh-auto-memory）」；scope 强制 `current`；`p2` 的「全部/子集」禁用 |
| D2 | 路由在但 `workspaces` 为空 | `d.ok===true && d.workspaces.length===0` | 显示「没有可整理的工作区」；禁用「开始整理」，允许 dry 与关闭 |
| D3 | 有清单但 `totals.ok===false` | `totals.ok!==true` | 费用三行显示「—」+ 一行「费用估算不可用」；耗时也给「—」；**不伪造 0** |
| D4 | `upgrade-status` 缺 `perWorkspace`/`teamMode` | 字段缺失 | 已知：`teamMode` 缺失 ⇒ `isTeamMode=false` ⇒ 走个人线（`client.js:7598`）；`perWorkspace` 缺失 ⇒ progress 页显式提示（`client.js:8932` 已实现）。批 0 补齐后两者都有真值 |

### 7.3 对端版本不一致（真正的团队兼容问题）

既有机制已覆盖，本次不动：
- `packBaselinePre` 写入 `memoryFormat = TEAM_SYNC_MEMORY_FORMAT_PRE`（`index.js:10573`）
- `unpackBaselinePre` 校验 `v === TEAM_BASELINE_FORMAT_PRE`（`team-baseline.js:195`）
- `applyBaselineOfferPre` 有版本闸门（`index.js:10669` 起，§「③ 版本闸门」）
- `teamResumeGatePre` @ `team-sync.js:586`：`mismatch` ⇒ `upgrade-required`（带 side）；`unknown` ⇒ 保守拒绝

**方案只需保证**：向导在团队模式下把 `teamResumeGatePre` 的结论显示出来（经 `GET /config` 的 `teamUpgradePhase` + `_teamSync.status().upgrade.state`，后者已由 `upgrade-status` 的 `teamMode.reason` 间接体现）。不新增路由。

---

## 8 实施批次（回答问题 8）

> 原则：**纯函数与守卫先行，渲染接线在后**。每批都能独立验证、独立回滚。
> 共同红线：不碰生成区（`client.js:15790-15796` legacy / `15796-18302` variant / `18308-22039`），不跑 `build-iter5-skin`，不动 `client.js:12497/12501/21593` 的 `setMsg(action + ': ' + reason)`（生成器锚点，`build-iter5-skin.mjs:465` 依赖它）。

### 批 0 · 止血：让「范围选择」与「逐区状态」变成真的

**改哪里**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `lib/index.js` | `10388` `buildWorkspaceManifestPre()` | 增加可选入参 `(scope, keys)`；`scope==='current'` ⇒ 只列 `resolvePaths().ws` 对应那一行；`scope==='subset'` ⇒ 只列 `keys` 命中的行；未知 scope ⇒ 保持「全部」（向后兼容）。**签名改默认参数，老调用点不传参 = 现状逐字不变** |
| `lib/index.js` | `10889` 调用点 | `buildWorkspaceManifestPre(opts.scope, opts.workspaceKeys)` |
| `lib/index.js` | `10876` running 态写入 | `perWorkspace: <选中区的 {wsKey, phase:'pending'} 数组>`（先算清单再写；算不出就仍写 `[]`） |
| `lib/index.js` | `10958 finishUpgradeJobPre` | 终态时把 `perWorkspace` 每项 `phase` 置为 `done`/`failed`（按终态） |
| `lib/index.js` | `26506-26510` handler | 把 `body.workspaceKeys` 一并透传进 `_opts` |
| `lib/index.js` | `10443` 提示词「✅ 只处理上表这 N 个工作区，一个不许漏，也一个不许加」 | **必须随 scope 改**：`scope!=='all'` 时改成「只处理上表这 N 个工作区（本次范围由用户指定）」；否则清单只剩 1 行、提示词仍说「一个不许漏」，子代理会以为漏扫而自行补扫 —— 这正是 §1.4A 要防的形态 |

**为什么必须先做**：不做则团队版补出来的「范围选择」「逐区进度」两块 UI 都是假功能，等于把 §1.4 的两个缺陷抄进新代码。

**⚠ 批 0 会打红两条既有守卫（v1 漏记，自审补）** —— 实测两处都是**静态字符串断言**，改签名即失效：
- `smoke-test-v5-p8-workspace-manifest.mjs:32` `IX.indexOf('async buildWorkspaceManifestPre()')`（无参签名）
- 同文件 `:33` `IX.indexOf('engineRef.buildWorkspaceManifestPre()')`
- `smoke-test-task36-p2b-backend.mjs:213` 同样 grep `'buildWorkspaceManifestPre()'`

⇒ 批 0 必须**同批**更新这三处锚串为带参形式，并把这两条**静态断言升级为真执行断言**（当前 B 段已经是 vm 真执行，A-1/A-2 只是「函数存在/已接入」的廉价守卫；改为按 `function.length` 或真调参数验证）。这既是修锁，也是把「恒真守卫」降级为「真证据」的机会（本仓 CR-10 对纯源码断言有明确禁令）。

**怎么真验（新增 `tests/smoke/smoke-test-upgrade-scope-wiring.mjs`）**

1. 真 import `MemoryEngine`，构造临时 `DSH_HOME` + 3 个合成工作区（A/B/C）
2. 真调 `buildWorkspaceManifestPre('subset', ['--A--'])` ⇒ 断言返回串**只含 A 行**、不含 B/C；负路径：`buildWorkspaceManifestPre('subset', [])` ⇒ 返回串含 0 行且**不抛**（或明确 reason）
3. 变异：把函数体里的 `scope` 分支删掉（回到无参行为）⇒ 第 2 条必红
4. 真调 `startUpgradeJobPre(agent, {scope:'subset', workspaceKeys:['--A--']})` ⇒ 读 `upgrade-state.json`，断言 `perWorkspace.length===1 && perWorkspace[0].wsKey==='--A--'`
5. 负路径：`scope:'current'` 但 `resolvePaths` 拿不到 ws ⇒ `perWorkspace` 为 `[]` 且**不抛**

**物理量**：`lib/index.js` 改动前后字节数 + sha256；套件 PASS/FAIL 数

---

### 批 1 · 纯函数 + 互斥裁决 + 守卫（**零渲染改动**）

**改哪里**

| 文件 | 改什么 |
|---|---|
| `lib/client.js` | 在向导纯函数段内（`client.js:8106` 块头之后、`8396 UpgradeWizard` 之前）新增四函数：`upgradeSurfaceOwnerPre` / `upgradeSurfaceRequestOwnerPre` / `upgradeSurfaceSubscribeOwnerPre` / `upgradeTeamPublishGatePre` |
| `tests/smoke/smoke-test-team-upgrade-capability.mjs`（新建） | 段抽取 + vm 真执行 + 正反例 + 变异 |

**为什么要单独一批**：这四个函数是方案的地基。先把它们与守卫落地（此时**没有任何 UI 调用它们**），可以证明「判据本身正确」；批 2 接 UI 时只需验证「接线是否把正确判据接上」，两类缺陷彻底分离。

**怎么真验**

- `upgradeSurfaceOwnerPre` 9 条判据表逐条真调用（正 4 / 反 5）
- 变异 A：删掉 `phase==='running'` 分支 ⇒ 「running 时 owner 应为 wizard」必红
- 变异 B：把 `teamSticky` 判断挪到 `legacy` 之后 ⇒ 「sticky 优先」必红
- `upgradeTeamPublishGatePre` 6 条判据表逐条真调用；负路径：`scope='subset'` + target ∉ keys ⇒ `allowed===false && reason==='target-not-selected'`
- 总线：真调 `requestOwnerPre('team-card')` ⇒ 订阅者收到 1 次回调；退订后再请求 ⇒ 收到 0 次（负路径）

**物理量**：`client.js` 字节数/sha256（预计 +6~8 KB）；新套件 PASS 数

---

### 批 2 · 接线：修掉叠加缺陷

**改哪里**

| 文件 | 位置 | 改什么 |
|---|---|---|
| `lib/client.js` | `7595` 团队卡片 | `show` 改为由 `upgradeSurfaceOwnerPre({teamMode, legacy, phase, teamSticky: sticky})` 派生：`if (owner !== 'team-card') return null` |
| `lib/client.js` | `8467` 向导 auto effect | 闸门增加 `upgradeSurfaceOwnerPre({...})`，且订阅 `upgradeSurfaceSubscribeOwnerPre` 以响应显式切换 |
| `lib/client.js` | 团队卡片按钮组 | 新增 `data-dam-team-back-to-wizard` |

**注意**：团队卡片的 `show` 改造要保留 `sticky` 语义（作为入参传入），否则 #524 的「终态不得当场卸载」会退化。

**怎么真验（追加到 `smoke-test-team-upgrade-capability.mjs`）**

1. **叠加缺陷直接判据**：构造 fixture `{ teamMode:'team', legacy:true, phase:'idle' }`，真渲染两个组件，断言 **`UpgradeWizard` 渲染出节点 且 `UpgradePopup` 返回 null**（恰好一个）
2. 反向 fixture `{ teamMode:'team', legacy:false }` ⇒ `UpgradePopup` 渲染、`UpgradeWizard` 不显示
3. 个人 fixture `{ teamMode:'personal', legacy:true }` ⇒ 向导渲染、卡片 null（**现状不变**）
4. **负路径（证明判据有区分力）**：把 `UpgradePopup` 的 `owner` 判定注释掉（回到 `show = canUpgrade||running||sticky`）⇒ 第 1 条必红（两个都渲染）
5. **变异验证**：把 owner 纯函数里 `teamSticky` 分支删除 ⇒ 「sticky 时卡片渲染」必红

**物理量**：`client.js` 字节数/sha256；`smoke-test-client-loadable` PASS 数（**必须真跑 factory**）

---

### 批 3 · 团队向导的 6 项能力 + 发布门

**改哪里**（全部在 `client.js` 手写区，`8106-8974`）

| 页 | 增量 |
|---|---|
| `p1` | `data-dam-wizard-team-context`：工作区数 / 各区体量 / `teamUpgradePhase` / 是否暂停 / 一行「上传只发当前区」 |
| `dry` | `data-dam-wizard-dry-team-hint`：不会触发发布；想看远端请去发布页搜索 |
| `p2` | 三个选项的「备注说明」逐条渲染 + 上传粒度强制提示；`teamUpgradePhase` 非 `idle|done` 时禁用「开始整理」 |
| `p3` | 两行零成本说明（`publish-pack` / `publish-net`） |
| `progress` | `data-dam-progress-team-phase`（迁移阶段，与整理阶段分开标注）；`phase==='done'` ⇒ `data-dam-wizard-publish`「去发布团队基线 →」 |
| 团队卡片 | `upgradeTeamPublishGatePre` 为 false 时禁用「② 自己整理并上传」并显示原因 |

**怎么真验**

1. 四页真渲染（沿用 `smoke-test-upgrade-wizard-client.mjs` 的 `render(patches)` 手法），断言上述 `data-dam-wizard-*` 全部在场且文案含关键句
2. 真调 `upgradeTeamPublishGatePre`：6 条判据表 + 负路径
3. **变异**：把上传粒度提示行删掉 ⇒ 「p2 必须含『上传只发当前区』」必红
4. 负路径：`teamUpgradePhase='upgrading'` 时「开始整理」必须 `disabled`

**物理量**：向导段（`client.js:8106`→`EventView`）字符数；若超出现有守卫套件的段锁上界 80000，需按「判据过期」重钉并附归因（预计 53,932 → ~62,000，尚在界内）

---

### 批 4 · 回归与文档

- 全量：`node tools/run-smoke.mjs --jobs=8 --timeout=180000`，与开工前基线逐条对比（当前基线：561 套件）
- 必跑清单（任务书 §7）：`smoke-test-upgrade-wizard-client`、`smoke-test-client-loadable`、`smoke-test-iter5-skin`（classicLF 锁，当前 `6ee0c2fe…` / 1,499,833 字符）、`smoke-test-v5-p7-upgrade-prompt-v4`、`smoke-test-v5-p8-workspace-manifest`、全部 `team-*` 套件（21 个）
- `node tools/build-iter5-skin.mjs --check --strict` ⇒ SYNC-OK（**由 Lead 跑**）
- 文档：`docs/internal/PLAN-TEAM-UPGRADE-CAPABILITY-20261105.md`（本文件）标注「已实施」；若涉及用户可见能力，同步 `README`/`CHANGELOG`

---

## 9 风险与回滚

| 风险 | 概率 | 影响 | 对策 |
|---|---|---|---|
| 批 0 改 `buildWorkspaceManifestPre` 签名影响老调用点 | 中 | 清单变空 ⇒ 子代理无边界（v5 事故形态） | 参数可选、不传即旧行为；新增套件有「不传参 = 现状」断言 |
| `perWorkspace` 初始化引入写盘失败 | 低 | 整理起不来 | 清单算不出时**回落 `[]`**，绝不因此拒绝启动 |
| owner 裁决把两线都判 `none` ⇒ 用户什么都看不到 | 中 | 功能消失 | 纯函数 `fallback` 分支恒 `wizard`；守卫套件有「未知输入不得返回 none」断言 |
| 团队卡片 `sticky` 语义被 owner 覆盖 | 中 | #524 退化（结果看不到） | `teamSticky` 优先级最高；有专门变异断言 |
| 向导段继续膨胀顶穿 r38/段锁 | 中 | 守卫红 | 段锁按「判据过期」重钉（附实测与归因），**不放宽 r38 的 250 下界** |
| 批 0 改签名打红 3 条静态守卫（`v5-p8` A-1/A-2、`task36-p2b`） | **高** | 验收时误判「改坏了」 | 同批更新锚串且升级为真执行断言（§8 批 0 已列） |
| 批 0 改清单不改提示词「一个不许漏」 ⇒ 子代理补扫 | **高** | 范围选择再次变假，且比现状更糟 | §8 批 0 已列 `index.js:10443` 必须同批改；套件加断言「scope=subset 时提示词不得含『一个不许漏』」 |
| CRLF 被破坏 | 低 | 全文件 diff 爆炸 | 改完必查裸 LF = 0 |

**回滚粒度**：每批独立可回滚。批 1 是纯新增（零调用点）⇒ 直接 revert 无副作用；批 0/2/3 各自可单独回退。

---

## 自审记录

写完 v1 后按「严格评审」自查，找到 6 个问题，逐条修订如下（**修订已并入正文，下面只记差异**）。

### 自审问题 1【最重要】范围选择在 v1 里被当成「已有能力」复用 ⇒ 实际是死功能

- **问题**：v1 §3.3 直接写「复用 `upgradeWizardScopeRowsPre` 即可实现团队范围选择」。但实测：`scope` 只被写进 run 记录（`index.js:10876`），`workspaceKeys` 全仓仅 `client.js:8619` 一处（后端零读取），`buildWorkspaceManifestPre()` 签名无参 ⇒ 清单恒为全部工作区，提示词又写死「一个不许漏」。
- **后果**：照 v1 实施，团队版会得到一个**看起来能选、实际不生效**的范围选择 —— 把个人版的假功能原样复制到团队线。
- **修订**：新增 **批 0（止血）**，先让 `scope`/`workspaceKeys` 真正流进 `buildWorkspaceManifestPre`；批 2/3 的范围 UI 依赖批 0 落地。同时在 §1.4(A) 把这条记为本方案新增取证的真缺陷（**任务书与 P4 都没发现**）。

### 自审问题 2【重要】v1 想「上传选中的多个区」⇒ 与后端单区打包事实冲突

- **问题**：v1 §6 初稿写「范围选 all ⇒ 上传全部选中的区」，并打算让 `uploadBaselinePre` 接收 `workspaceKeys`。
- **实测**：`uploadBaselinePre(o.ws)` → `resolvePathsSyncForBaseline(o.ws)` → 只读**单个** `projectDirOf(wantWs)` 下的文件；`packBaselinePre` 白名单只有 4 个文件名；outbox key 固定 `baseline:current`。改成多区要重写打包格式 + 改 `unpackBaselinePre` 的应用语义（`applyBaselineOfferPre` 的 `files` 落地假设单区结构）⇒ 远超本次范围，且会动到 §6.3 红线（#516 的 checksum 语义）。
- **修订**：§6 改为「**整理可多区、上传恒单区**」，并新增 `upgradeTeamPublishGatePre` 前置校验 —— 因为一旦范围不含当前区，整理完再点上传发出去的就是**当前区整理前的旧内容**（与 #481 同族的另一维度）。UI 强制说明 + 门禁用。

### 自审问题 3【重要】逐区进度在 v1 里没有数据源

- **问题**：v1 §3.6 写「复用 `upgradeWizardProgressModelPre`」，默认 `perWorkspace` 有值。
- **实测**：`perWorkspace` 只在 `index.js:10876` 初始化为 `[]`，全仓无写入点 ⇒ 任何模式下进度卡都只会显示「逐区状态暂未回报」。
- **修订**：并入批 0 —— running 态写入「选中区清单（phase=pending）」，`finishUpgradeJobPre` 终态时整批置 done/failed。**并在 §3.6 明确标注这是「纳入范围清单」而非「逐区完成时间」**，UI 文案不得暗示实时逐区进度。理由：`startUpgradeJobPre` 派的是**一个**子代理处理全部区（`index.js:10891`），没有天然逐区时序；要做真逐区必须改成「每区一个子代理」（成本 ×N）或依赖 PLAN §3.6 的草案文件信道（P7 未实施）——两者都超出本次范围。

### 自审问题 4 任务书 §9.7 的前提有误，v1 照抄了

- **问题**：v1 初稿写「老版本**对端**没有 `upgradeWorkspaces` 路由 ⇒ 降级」。
- **实测**：`/upgrade-workspaces` 是本机引擎路由（注册 `index.js:26747`，handler 直调 `engine.buildUpgradeWorkspacesPre`），**不经过团队传输层**（`team-transport*`/`team-pull`/`team-outbox` 零引用）⇒ 对端版本与它无关。
- **修订**：§7 重写为「本机插件版本过旧 / 引擎异常」四类降级（D1-D4），并单列 §7.3 说明真正的对端兼容问题由既有 `memoryFormat` 闸门 + `teamResumeGatePre` 覆盖，本次不动。

### 自审问题 5 owner 纯函数漏了 `sticky`，会推翻 #524

- **问题**：v1 初版 `upgradeSurfaceOwnerPre({teamMode, legacy, phase})` 在 `phase==='done'` 时返回 `wizard`（因为 `legacy` 仍为 true）。
- **后果**：团队卡片刚显示「整理已完成」就被向导抢走前台 ⇒ 用户看不到结果，正是 #524 修过的「终态当场卸载」。
- **修订**：入参增加 `teamSticky`，优先级**高于** `legacy`；判据表补该行；批 1 加专门变异断言（删 sticky 分支 ⇒ 必红）。

### 自审问题 6 成本口径含糊（「整理 + 上传」）

- **问题**：v1 初稿按任务书问题 4 的问法，试图给「上传成本」一个数值。
- **实测**：打包（`packBaselinePre` 只 brotli）、搜索（网络探测）、上传（enqueue）、应用（解包写盘）**全部无 LLM 调用**。
- **修订**：§4 改为「只算整理成本，其余恒 ¥0 且显式标注」。理由有二：① 事实层面无模型调用；② 若要给上传编一个价格，就必然在前端引入第二套价格口径，直接违反「前端不得复制价格公式」（`client.js:8157` 注释、`lib/upgrade-estimate.js` 的唯一实现原则）。

### 自审问题 7【重要】批 0 会打红两条既有守卫，v1 完全没提

- **问题**：v1 的批 0 直接改 `buildWorkspaceManifestPre` 签名，但没检查谁在 grep 它。
- **实测**：`smoke-test-v5-p8-workspace-manifest.mjs:32/33` 与 `smoke-test-task36-p2b-backend.mjs:213` 都用 `IX.indexOf('...')  >= 0` 这种**静态字符串断言**锁着「无参签名」与「无参调用点」。改签名 ⇒ 三条断言当场变红，而它们与产品行为无关。
- **后果**：若按 v1 实施，批 0 的验收会先看到三条红，容易被误判成「改坏了」。
- **修订**：批 0 明确列出「同批更新这三处锚串」+「顺带把 A-1/A-2 从恒真静态断言升级为真执行断言」。并记入 §9 风险表。

### 自审问题 8【重要】批 0 改清单但不改提示词 ⇒ 制造新的自相矛盾

- **问题**：v1 批 0 只让清单按 scope 收窄，没动 `index.js:10443` 那句写死的「✅ 只处理上表这 N 个工作区，**一个不许漏，也一个不许加**」。
- **后果**：清单只剩 1 行、提示词仍命令「一个不许漏」⇒ 子代理会以为扫描漏了，**自行补扫**（v5 首跑那次 55 次调用 0 写盘的事故形态）。结果是范围选择又变回假的，且比现在更糟（现在至少清单是全的）。
- **修订**：批 0 表格增加一行——`scope!=='all'` 时提示词文案必须同步改。这条是本方案里**最容易漏、后果最严重**的一处联动。

### 自审后仍然存在的**已知不确定性**（如实列出，不假装解决）

1. **批 0 的 `perWorkspace` 仍是「清单级」而非「真逐区」**。若产品要求真逐区，需另立方案（每区一子代理 或 草案文件信道 P7）。本方案不承诺真逐区。
2. **`teamUpgradePhase` 与 `upgrade-state.phase` 是两套相位**，本方案只在 UI 上分开标注，**没有统一两者**。统一会动 `teamResumeGatePre` 的判据（`team-sync.js:591`），属另一条裁定线。
3. **未做真实浏览器验证**。本方案的所有验收都是 vm 真执行 + 真渲染，**没有覆盖**「两个 fixed 遮罩在真实 CSS 下的层叠视觉效果」。批 2 完成后建议补一次真机截图取证。
4. **`scope` 语义在团队模式下的副作用未穷举**：批 0 让子代理只处理选中区后，**未选中的区仍是旧格式**，用户下次进那些区会再次看到升级提示。这是预期行为（不是缺陷），但 UI 未承诺「一次全清」，方案里也不承诺。
5. **批 0 是批 2/3 的硬前置，不能并行**。若 Lead 决定只做「修叠加缺陷」（批 1+2）而不做批 0，则团队向导的 p2 范围页与 progress 逐区页必须**整块隐藏**（而不是显示假数据）—— 否则就是把 §1.4 的两个缺陷复制进新代码。方案给出的最小可交付子集是「批 1 + 批 2」，此时团队版只获得叠加缺陷修复，6 项能力一项都不上。

---

**结论**：本方案不改任何产品代码，等 Lead 批准后按批 0 → 批 1 → 批 2 → 批 3 → 批 4 顺序实施。批 0 是前置（否则范围/进度两块是假功能），批 1 无副作用可独立落地，批 2 修掉叠加缺陷，批 3 补齐 6 项能力。
