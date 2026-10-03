# 长期记忆系统 逻辑审计报告 · 第 1 批：procedure（技能）晋升与审批链路

> 审计日期：2026-09-21 · 审计对象：`D:\dsh-auto-memory`（pre 线，未提交未发布）
> 取证基线：`lib/client.js` SHA256 `AF5BC45E…`、`lib/index.js` 11,572 行、运行时真实数据
> `C:\Users\JH Z\.dsh\memory\hub-pre\procedures.json`（24 条，savedAt 1789999632474）
>
> **本报告只做诊断，未改任何代码。**

---

## 0. 结论先行：用户说的「批准不了」是三个独立缺陷叠加出来的

用户原话：「现在批准不了，就是晋升不了记忆」「旧算法和新算法可能逻辑也特别乱」「这个算法的审批也特别乱」。
三条都成立，且**不是同一个原因**。按可观察现象分三层：

| 层 | 现象 | 根因 | 严重度 |
|---|---|---|---|
| ① 点了没反应 | 审批队列里点「晋升」，界面回一句 `promote: keep (diversity-below-3)`，条目不动 | 前端按钮显示条件 ≠ 真实可晋升条件；统计门默认 3 会话 / 2 成功，而模型写的条目这两个数**恒为 0** | **P0** |
| ② 根本没有"批准"这个动作 | 高风险条目点晋升永远返回 `decision:'ask'`，**没有任何通路能把 `approved` 置真** | 宿主建 store 时没注入 `opts.approve`；路由动作白名单里也没有 `approve` | **P0** |
| ③ 晋升了也没用 | 即使手动晋升 + 激活成功，技能**永不注入**到对话 | `procedurePromotionEnabled` 默认 `false`，而它就是技能注入的总闸（不只是"是否自动晋升"） | **P0** |

另有 9 条结构性缺陷（死状态、死统计、死函数、双份实现、校验缺口），列在 §3。

---

## 1. 用户可见链路（先对齐"用户点一下"到底发生了什么）

```
用户在「记忆中枢」页看到「技能审批队列」
  │  ← 数据来自 hub.overview().procedures.pipeline
  │     过滤：stage !== 'active' && stage !== 'deprecated'
  ↓
点「晋升」按钮（client.js:3385，显示条件 = !p.observationOnly）
  ↓ hubAct('promote', procedureId)          client.js:3316
POST /memory-hub { action:'promote', procedureId }   client.js:3317
  ↓ 路由 :memory-hub 兜底                     index.js:10900
procs.promote(pid)                          index.js:10904   ← ★ 未传第二/三参
  ↓ procedure-store-pre.js:281
┌─ deprecated?            → keep ['deprecated']
├─ isObservationOnly?     → keep ['observation-only']     ← 前端已隐藏按钮
├─ authorizedBy 为空 ⇒ 统计门**不跳过**：
│    sessions < 3         → keep ['diversity-below-3']    ← ★ 模型条目 sess 恒 0
│    success  < 2         → keep ['success-below-2']      ← ★ 模型条目 succ 恒 0
├─ correctionRate > 0.3   → keep
├─ ev.correction > 0      → keep ['has-correction']
├─ !successCriteria.length→ keep ['no-success-criteria']
├─ requiresApproval && !approved:
│    approveFn 为 null    → ask ['high-risk-awaiting-approval']  ← ★ 无路可走
└─ 全部通过 → stage='validated'
  ↓
回到前端：hubAct 把 keep 原因拼成一行灰字显示             client.js:3324
```

**关键点**：`procs.promote(pid)` 只传了 1 个参数。而 `promote()` 的签名是 `promote(procedureId, extraEvidence = {}, opts = {})`——
**第二参 `extraEvidence` 与第三参 `opts`（含 `authorizedBy`）在用户手点路径上永远为空**。
只有模型工具路径 `memory_procedure` 会传 `{ authorizedBy: 'model' }`（index.js:10384）。

⇒ **用户手点与模型自写，走的是两套门限**。这是"审批逻辑乱"的第一层来源。

---

## 2. P0 级缺陷（3 条，直接对应"批准不了"）

### P0-1 前端「晋升」按钮显示条件与真实可晋升条件不一致

- 位置：`lib/client.js:3383-3386`
- 代码：
  ```js
  // issue #30:纯 episode 观察行**结构上**不可能晋升(无 successCriteria),
  // 继续显示"晋升"按钮只会让人反复点击却看不到变化 ⇒ 直接隐藏并打观察标。
  !p.observationOnly && h('button', { ... onClick: ... hubAct('promote', ...) }, ...)
  ```
- 问题：作者已经认识到"结构上不可能晋升的条目不该显示按钮"，但**只把这条原则用在了 `observationOnly` 一种情况上**。
  真实可晋升条件还有 `successCriteria.length > 0`（store `:311`）、`ev.correction === 0`（`:309`）、correctionRate 上限（`:307`）
  —— 这些情况下按钮**照旧显示**。
- 影响：用户对着一个缺 successCriteria 的条目反复点"晋升"，每次只得到一行小字 `promote: keep (no-success-criteria)`，条目纹丝不动 ⇒ 直接感受为"批准不了"。
- 修法建议：把"可晋升"判定收敛成**单一函数**（前端已有 `p.promotion` 投影，见 memory-hub-pre.js:240-254），
  按钮显示条件改为 `p.promotion && p.promotion.decision === 'promote'`；`keep` 时显示原因而不是按钮。

### P0-2 高风险条目的"批准"动作没有任何实现通路

- 位置：`lib/index.js:10900`（动作白名单）、`lib/index.js:9152-9165`（store 构造）、`lib/procedure-store-pre.js:313-322`
- 代码：
  ```js
  // index.js:10900
  if (['promote', 'activate', 'deprecate', 'pin'].includes(action)) {
  ```
  ```js
  // procedure-store-pre.js:313
  if (p.requiresApproval && !p.approved) {
    if (approveFn) { ... } else {
      stats.approvalAsked++
      reason.push('high-risk-awaiting-approval')
      return { ok: true, decision: 'ask', procedure: p, reasonCodes: reason }
    }
  }
  ```
- 取证：全仓搜索 `approveFn` / `approve:` 只有 **2 处**——定义处（`procedure-store-pre.js:125`、`procedure-store.js:121`）与内部使用处。
  **宿主构造 store 时（index.js:9152）没有传 `approve` 字段** ⇒ `approveFn` 恒为 `null`。
  路由动作白名单里也没有 `approve` / `approveHigh` 之类的动作。
- 影响：任何 `riskLevel:'high'` 的条目，**用户永远无法批准它**。点晋升只会不断累加 `stats.approvalAsked` 并返回 `ask`。
  条目的 `approved` 初始为 `c.riskLevel !== 'high'`（`:184`），high 即 `false`，之后**没有任何代码路径能把它改成 true**。
- 修法建议：三选一（需求拍板后实施）——
  A. 路由加 `action:'approve'` + store 加 `approve(procedureId)` 原语（最小、语义清晰）；
  C. 设置页给"高风险需批准"开关时，同时提供"全部批准"入口（粗粒度）。
  建议 A。**这是唯一一条"功能缺失"而非"逻辑错误"的缺陷，需用户拍板形态。**

### P0-3 `procedurePromotionEnabled` 默认 false，而它是技能注入的总闸

- 位置：`lib/index.js:546`（声明）、`lib/context-host-pre.js:537`、`lib/activation-host-pre.js:330`
- 代码：
  ```js
  // index.js:546
  /** Procedure 自动晋升。 */
  procedurePromotionEnabled: false,
  ```
  ```js
  // context-host-pre.js:537
  const skillEnabled = engine.config.memoryHubEnabled === true && engine.config.procedurePromotionEnabled !== false
  ```
  ```js
  // activation-host-pre.js:330
  if (engine.config.procedurePromotionEnabled === false) return null
  ```
- 问题：**注释与设置页文案都说这是"是否自动晋升"，实际它是"技能注入总开关"**。
  设置页（client.js:5016）文案：「技能固化与晋升 — 重复流程固化为 checklist 自动附上；跨会话验证后晋升」，
  语义上像"自动晋升策略"，实际关掉后**连已激活的技能也不会被注入**（两处 `skillEnabled` 判定都会短路）。
- 影响：即使 P0-1/P0-2 都修好、用户手动把条目晋升并激活成 `active`，**技能也不会出现在对话里**。
  用户感受就是"晋升了没用 / 记忆系统没生效"。真实数据里已有 5 条 `active`，其中 1 条是机械路径的、4 条是模型授权的——
  在当前默认配置下**这 5 条全部不生效**。
- 修法建议：拆成两个语义清晰的项（用户硬规则：单一开关不得顺带改变其他功能行为）——
  - `procedureInjectEnabled`（技能召回/注入，默认 **true**）
  - `procedureAutoPromoteEnabled`（是否自动跑晋升判定，默认 false）
  或最小改法：保持单开关但把默认值改为 `true`，并把文案改成"技能注入与晋升"。

---

## 3. P1 级缺陷（结构性，6 条）

### P1-1 模型直写路径的 `sourceMemoryIds` 恒为空 ⇒ `success` 证据永远为 0

- 位置：`lib/index.js:10374`（写入）与 `lib/index.js:7643`（消费）
- 代码：
  ```js
  // 写入：index.js:10374
  sourceMemoryIds: [], sourceEpisodes: [],
  ```
  ```js
  // 消费：index.js:7643
  for (const p of allProcs) {
    if (!(p.sourceMemoryIds || []).includes(e.memoryId)) continue
    procs.addEvidence(p.procedureId, { kind: 'success', sessionRef: sr })
  }
  ```
- 问题：成功证据的喂入条件是「该 procedure 的 sourceMemoryIds 包含本轮被引用的 memoryId」。
  模型直写的条目 `sourceMemoryIds` **恒为空数组** ⇒ 这个 `continue` 永远命中 ⇒ `evidence.success` 恒 0。
  同一段代码也不带 `sessionRef` 之外的来源 ⇒ `evidence.sessions` 同样恒 0（sessionRef 只在有 success 时才 add）。
- 真实数据佐证：4 条模型授权条目，全部 `sess=0 succ=0 seen=0`；唯一 `sess=11` 的那条是机械路径旧条目。
- 影响：
  1. 审批界面显示"成功 0 · 会话 0"，看起来像从没被验证过；
  2. 未授权路径下统计门**永远不可能通过**（`diversity<3` / `success<2` 恒真）；
  3. 连带 `evaluatePromotion` 也永远投影为 `diversity-below-3`。
- 修法建议：模型直写时接住调用方给出的溯源（工具参数补 `sourceMemoryIds`，或写入时回填本轮 session 的 memoryId 集合）；
  或在 success 判定处增加"procedure 标题/步骤与命中记忆语义相关"的兜底通路。**需产品拍板溯源口径。**

### P1-2 `candidate` 阶段是死状态（5 态实际只用 4 态）

- 位置：`lib/procedure-store-pre.js:41`（枚举含 candidate）、`:164`（observe 只产 observed）、`:325`（promote 直接 observed→validated）
- 取证：全仓 `stage: 'candidate'` / `= 'candidate'` 写入点 **0 处**；`memory-hub-pre.js:230` 只是**读** `query({stage:'candidate'})`。
- 真实数据佐证：24 条中 `candidate = 0`（observed 11 / deprecated 8 / active 5）。
- 影响：状态机文档（文件头注释画的是 `observed → candidate → validated → active`）与实际行为不符；
  `overview().procedures.candidates` 恒为空数组；前端 `hubStageCandidate` 文案永不出现。
- 修法建议：二选一——① 让 `promote` 先到 `candidate` 再到 `validated`（还原设计）；
  ② 从枚举里删掉 candidate，承认它是两态跳变。**建议 ②，改动小且与现状一致。**

### P1-3 `stats.candidates` 永不递增（死统计）

- 位置：`lib/procedure-store-pre.js:133` 初始化 `candidates: 0`；全文件 `stats.` 自增点仅
  `observed++(:189)`、`deprecated++(:253/:408)`、`approvalAsked++(:317/:319)`、`validated++(:330)`、`activated++(:396)`。
- 影响：面板统计永远少一格；也侧面印证 P1-2（candidate 从没被真正使用）。
- 修法建议：随 P1-2 一起处理。

### P1-4 `applyAutomaticTransitions`（90 天自动归档）零调用方

- 位置：`lib/procedure-store-pre.js:241` 定义、`:498` 导出；全仓**无调用**（grep 只有定义与导出两行）。
- 影响：`active` 技能永不老化 ⇒ 长期不用的技能永久留在 active 集合里，每轮都参与召回候选（context-host-pre.js:539 `activeProcedures()`）⇒
  召回精度随使用时间单调下降，且没有任何自动清理。
- 修法建议：挂到已有的定期任务上（如 `hubFlushTick` 或引擎启动时的 restore 之后跑一次）。

### P1-5 `promote()` 与 `evaluatePromotion()` 双份门限，且已经在"授权"维度上不一致

- 位置：`lib/procedure-store-pre.js:281-333`（真实） vs `:349-386`（只读投影）
- 代码注释（`:338-345`）自陈：
  > 与 `promote()` 的关系：**逐行复制其门限判定，但不改任何状态**。
  > ⚠️ 维护约定：改 `promote()` 的门限时**必须同步改这里**，否则前端会展示过时的判据。
- **已发现的实际不一致**：`promote()` 接受 `opts.authorizedBy` 跳过两条统计门（`:300`），
  而 `evaluatePromotion()` **没有这个参数**，永远按统计门判定。
  ⇒ 一条已被模型授权晋升成 `validated` 的条目，前端 `promotion` 投影仍会显示"diversity-below-3（条件不满足）"。
  另 `promote()` 支持 `extraEvidence` 覆盖 diversity/successCount（`:297-298`），投影也不支持。
- 影响：界面显示与实际状态**互相矛盾**；这正是用户"审批逻辑乱"的直接观感来源。
- 修法建议：二者合一——`evaluatePromotion` 改为「接受同一 `opts`，内部调用一个纯函数 `judge(p, opts)` 并对副作用做注入」，
  或至少在投影里带上 `authorizedBy` 与 `extraEvidence` 两个维度。**不再维护两份复制体。**

### P1-6 `validateProcedurePre` 不校验 `evidence`，restore 坏数据会静默通过或抛错

- 位置：`lib/procedure-store-pre.js:71-93`（校验清单里没有 evidence）、`:305`（直接算术）
- 代码：
  ```js
  // :305
  const total = ev.seen + ev.read + ev.cite + ev.reuse + ev.success + ev.correction
  ```
- 问题：`evidence` 是必需运算对象，但校验函数完全不检查它。两种坏数据后果不同：
  - `evidence` 缺失/为 null → `ev.seen` 抛 TypeError（`promote` 内无 try/catch）→ 冒到路由 catch → HTTP 500；
  - `evidence` 缺键（如只有 `seen`）→ 算术得 `NaN` → `corrRate = NaN` → `NaN > 0.3` 为 false **静默通过**。
- 影响：restore 阶段（index.js:9178-9179）对坏记录是"跳过"策略，但 evidence 坏不会被跳过（校验不查）⇒ 带病入内存。
- 修法建议：`validateProcedurePre` 增加 evidence 形状校验（六个计数 + sessions 均为有限数），与其余字段同等对待。

---

## 4. P2 / 可维护性（3 条）

### P2-1 v1/v2 双份实现并存，改动极易落错文件

| 文件 | 大小 | mtime | 备注 |
|---|---|---|---|
| `lib/procedure-store-pre.js` | 27,090 B | 2026-09-20 05:38 | **宿主实际 import**（index.js:49） |
| `lib/procedure-store.js` | 19,678 B | 2026-09-07 13:06 | 陈旧副本，无 T4/T10/issue#30 修复 |

- 且一批**非 `-pre` 的旧文件仍在互相 import 旧副本**：
  `context-host.js` → `evidence-store.js` / `shadow-retrieval.js` / `semantic-js.js`；
  `shadow-host.js` → `shadow-retrieval.js`；`memory-writer.js` → `memory-anchor.js` / `memory-index.js` 等。
- 影响：这是历史事故的重演土壤（已知事故：PR 改了 `lib/*.js` 陈旧副本 ⇒ 宿主只 import `-pre.js` ⇒ **合并了但不落地**）。
  审计者/后续 agent 极易改错文件。
- 运行时数据同样双份：`~/.dsh/memory/hub/`（空壳，2026-09-01）与 `hub-pre/`（38,912 B，2026-09-21）并存。
- 修法建议：删掉 v1 系列（或加 `.deprecated` 后缀并全仓断言无引用）。**需用户确认这些旧文件不再需要。**

### P2-2 `promote()` 的拒绝路径一律返回 `ok: true`

- `:301/:302/:307/:309/:311` 全部返回 `{ ok: true, decision: 'keep' }`。
- 影响：`ok` 字段无法区分"成功晋升"与"判定为不晋升"。宿主路由已因此踩过坑（index.js:10928-10930 注释：
  「旧日志只记 `r.ok` —— 而 promote 的"拒绝晋升"也是 ok:true(decision='keep')，于是日志里全是 ok:true 的假阳性」）。
  该处已修（改记 decision+reasonCodes），但**其他潜在调用方仍可能踩同一个坑**。
- 修法建议：保留 `ok` 兼容，另加显式 `promoted: boolean`，或在类型层强制调用方读 `decision`。

### P2-3 前端按钮条件与 store 门限是两套独立逻辑

- 前端：`client.js:3385`（`!p.observationOnly`）、`:3386`（`p.stage === 'validated'` 才显示"激活"）。
- store：`procedure-store-pre.js:281-333`。
- 影响：任何一侧改门限，另一侧不会自动跟随；P0-1 就是这个结构问题的第一个实例。
- 修法建议：前端只依赖 `p.promotion`（已是只读投影）+ `p.stage` 做显示，不再自行判断可晋升性。

---

## 5. 未能确认 / 待补充

1. **`stats.approvalAsked` 的实际增长情况**无法从快照读出（`stats` 存在内存，`procedures.json` 只存 `procedures` 数组）。
   需要运行期诊断日志或重启后观察。
2. **`requiresApproval` 为 true 的条目当前有几条**：真实数据里没有一条 `riskLevel:'high'` ⇒ P0-2 目前是"潜伏缺陷"，
   一旦有高风险技能进队列就会立刻显形（AI 常写的部署/删除类流程正是 high）。
3. `evidence` 的 `seen/read/cite/reuse` 四个计数**由谁喂入**未在本批完全追踪（需看 M5 evidence 落盘路径），
   留给第 2 批（写入/去重链路）。
4. 前端 `hubAct` 失败提示只显示 `action + decision/reason`，**不显示 `detail`**（如 `need:3 / diversity:0`），
   用户看不出"差多少"。是否补 UI 待拍板。

---

## 6. 修复优先级建议（待用户拍板后执行）

| 序 | 项 | 类型 | 影响面 | 备注 |
|---|---|---|---|---|
| 1 | P0-3 开关语义拆分 / 默认值 | 配置 | 全部 active 技能是否生效 | 改动最小、收益最大 |
| 2 | P0-2 高风险批准通路 | 功能缺失 | high 风险技能 | **需拍板形态（A/B/C）** |
| 3 | P0-1 按钮条件收敛到投影 | 逻辑 | 审批页可用性 | 依赖 P1-5 一并做 |
| 4 | P1-5 双份门限合一 | 架构 | 一致性根源 | 与 3 同批 |
| 5 | P1-1 溯源回填 | 逻辑 | 证据闭环 | 需拍板溯源口径 |
| 6 | P1-6 evidence 校验 | 健壮性 | 防脏数据 | 独立可做 |
| 7 | P1-2/P1-3/P1-4 死状态/死统计/死函数 | 清理 | 可维护性 | 独立可做 |
| 8 | P2-1 删 v1 双份 | 卫生 | 防改错文件 | **需确认无引用** |

> 用户既有硬规则：**涉及 procedure 记忆引擎的改动，须经用户拍板方可实施。**
> 本报告只出诊断，等拍板。
