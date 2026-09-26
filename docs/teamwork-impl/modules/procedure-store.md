## procedure-store

- **规模**：49,367 B / 815 行 / 约 40 个导出符号
- **交付形态**：**完整版**

### 职责

M8-2 技能存储**纯核心**：把"多次使用过的固定流程"固化成 skill，供 M7 召回系统在相似场景自动唤起。零 IO、零第三方依赖，持久化经 `opts.io` 注入。
它实现一条**两态跳变**的生命周期状态机 `observed → validated → active → deprecated`，以及晋升门限（`promote`）与人工越权投影（`promotionOverrideView`）。
本模块是"记忆中枢"的**价值兑现层**：fact/episode 只是原料，procedure 才是可复用的产出。

### 数据流

```
输入：episode.consolidate() 产出 procedure_candidate / judgement-shadow 的 procedure_candidate
        │
        ▼
  observe(cand)  L229  ──▶ stage='observed'（证据空壳 emptyEvidencePre L209）
        │
        ├── addEvidence(procedureId, ev)  L292   六类证据累加（seen/read/cite/reuse/success/correction）
        │                                          ★ 只累加 ev.sessions 的**去重集合** _sessions（L305）
        ├── touch(procedureId)            L317   更新 lastSeenAt
        ├── setPinned(procedureId, v)     L326   用户钉住（不进自动流转）
        │
        ▼
  applyAutomaticTransitions(nowTs)  L338   ──▶ 超期未用 → deprecated
        │
        ▼
  promote(procedureId, extraEvidence, opts)  L378
        └─ evaluatePromotion(procedureId)    L449   只读投影（**顺序必须与 promote 完全一致** L461）
              │
              ├─ diversity < gates.minSessionDiversity(3)  → keep
              ├─ successCount < gates.minSuccessCount(2)    → keep
              ├─ corrRate > gates.maxCorrectionRate         → keep
              ├─ maxContradictions===0 且 correction>0      → keep
              ├─ !successCriteria.length                    → keep
              ├─ requiresApproval && !approved              → ask（高风险待批准）
              └─ 全过 → promote
        │
        ▼
  activate(procedureId) L593 / approve(procedureId, by) L627 / deprecate(procedureId, reason) L655
        │
        ▼
  消费出口：renderChecklist(procedureId)  L706  → 注入上下文（超长截断显式可见 L697-704）
            query(q) L667 / activeProcedures() L676 / get(procedureId) L679
            snapshot() L729 / restore(data) L736 / persist() L790

物理路径（Host 接线）：~/.dsh/memory/workspaces/<ws>/procedures.json
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L64–L112 | `PROCEDURE_*` 常量 | 策略版本、ID 前缀/正则、四阶段枚举、归档天数、风险/级别/scope 枚举、**默认门限** L100、最小成功数 L109、激活级别 L112 |
| L115 | `validateProcedurePre(p)` | 已固化记录校验 |
| L160 | `validateProcedureCandidatePre(c)` | 候选校验 |
| L189 | `createProcedureStorePre(opts)` | **工厂**；`opts = {io, now, approve, gates, activeLevel}` |

**实例方法（关键 14 个）**

```js
observe(cand) L229                  addEvidence(procedureId, ev) L292
touch(procedureId) L317             setPinned(procedureId, v) L326
applyAutomaticTransitions(nowTs) L338
promote(procedureId, extraEvidence={}, opts={}) L378
evaluatePromotion(procedureId) L449             ← 只读；被守卫锁签名
promotionOverrideView(procedureId) L556         ← 只读；A-9b 补判被遮住的结构门
activate(procedureId) L593          approve(procedureId, by='user') L627
deprecate(procedureId, reason='user-disabled') L655
query(q={}) L667                    activeProcedures() L676        get(procedureId) L679
renderChecklist(procedureId) L706   snapshot() L729   restore(data) L736
clear() L769   dispose(reason) L777   persist() L790   getStats() L811
```

### 内部关键实现

**1. `gates` 必须保留调用方对象引用 L193-195 —— 不可 `Object.assign` 展开**

```js
// 2026-08-30:gates 保留调用方对象引用(支持 getter 活读配置);缺省才用冻结默认。
// 注意:不可 Object.assign 展开——会立即求值 getter 并冻结挂载时的配置快照。
const gates = opts.gates || PROCEDURE_DEFAULT_GATES_PRE_V1
```

坑：热重载配置时，展开会让门限永远停在**挂载瞬间**的值。团队化若引入"团队级门限覆盖"，这条纪律必须原样保留。

**2. `promote()` 与 `evaluatePromotion()` 的顺序双写 L461**

```js
// ⚠️ 顺序必须与 promote() **完全一致**（先返回的那个才决定前端文案）
```

`smoke-test-r2-promotion.mjs` 用**字面正则**锁 `evaluatePromotion(procedureId)` 签名，并用**源码切片**比对它与 `promote()` 的 `reason.push` 序列。→ 动任一函数的门限顺序会**同时打红两条守卫**。

**3. `hiddenStructuralCodesPre()` L505 —— A-9b 的"补判"设计**

事故链（注释 L533-540 有完整记录）：`evaluatePromotion` 前一道门不过就 early-return ⇒「证据不足 + 高风险未批准」只吐出 `['diversity-below-3']` ⇒ 旧判据"码全是统计门"得 `overridable:true` ⇒ 界面渲染「强制晋升」按钮 ⇒ 点下去 `promote()` 跳过统计门后**撞上高风险门**返回 `ask` ⇒ **一个点了没反应的假通道**。
修法：**不动 `evaluatePromotion` 的签名/函数体/门限顺序**（r2 锁死了），在只读投影层独立补判被遮住的结构门。维护约定 L547：`promote()` 统计门之后每加/改一道结构门，本函数**必须同步**。

**【推断】** 这是本仓最值得团队化借鉴的模式：**给"被守卫锁死不能改"的核心函数做只读增补**，而不是重构它。

**4. `ok` 与 `promoted` 的语义分离（P2-5）**

`promote()` 的 `ok` 只表示**这次调用被正常处理**（未抛错、未命中 disposed/not-found）；**拒绝晋升同样是 `ok:true`**。判断"到底晋升了没有"必须读 `promoted`（boolean）。
加这个字段的原因有代码证据：宿主 `lib/index.js:10934-10936` 记录过该坑——旧日志只记 `r.ok` ⇒ 全部显示成功。

**5. `addEvidence()` 的 session 去重 L292-316**

`diversity`（跨会话多样性）取自 `_sessions` 集合大小，而非`ev.sessions` 累加值——否则同一会话反复调用会**假性达标**。晋升铁律：`sessionDiversity ≥ 3` 且 `successCount ≥ 2`，"一次成功或三次重复均不足以证明可靠"。

**6. `renderChecklist()` L706 + 截断可见 L697-704**

高风险技能降级为 `level:'hint'`，文案强制"如需执行请先向用户确认"（L712）。2000 字符封顶，超长时**显式**追加"…(清单超长已截断:尾部 N 字符未展开…)"，P2-7 修复（此前静默砍掉尾部）。

### 与团队化的关系

**判定：团队共享（Shared），但 `evidence` 拆分为「本地重算 + 投票上报」。**

理由：procedure 的价值来自"多人验证过的流程"——原本 `sessionDiversity ≥ 3` 的门限意图就是**跨独立会话验证**，在单人环境里只能靠自己反复用；团队场景下这个门限才真正有意义（A 用 3 次 、B 用 2 次 ⇒ 天然满足）。**这正是 Teamwork 最直接的增益点**。
但 `_sessions` 集合（L305）是**会话去重键**，跨端合并时必须用 `actorId + sessionRef` 复合键，否则 B 端的同一会话会被算成新的多样性。

**不同步**：`renderChecklist` 输出是纯派生（输入=条目字段），各端本地渲染即可 —— 「派生重算」。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| P1 | `addEvidence()` L292 | `ev.sessions` 累加、`_sessions` 去重 | 去重键从 `sessionRef` 改为 `actorId + ':' + sessionRef` | 改 1 行；**旧数据无 actorId ⇒ 退化为原键**（向后兼容） |
| P2 | `observe()` L229 | 新建即 observed | 附加 `origin: {groupId, actorId}` | 结构新增字段 |
| P3 | `promote()` L378 | 纯本地门限 | **不改**。门限逻辑不变，多样性天然吃到团队证据 | 无 |
| P4 | 新增 `applyTeamEvidencePre(procedureId, rows)` | 无 | 团队证据合并入口：**单调累加**，绝不覆盖本地更大值 | 新增导出 |
| P5 | `snapshot()` L729 / `restore()` L736 | 只处理本地结构 | 容忍 `origin` 缺失 | 兼容性 |
| P6 | 新增 `teamConflictViewPre(procedureId)` | 无 | 同名不同 steps 的跨端分歧列出，供人工裁决 | 新增；**只在存在分歧时返回非空** |

#### 可直接落地的代码片段

**片段 1**：证据去重键带 actor。位置：`procedure-store.js:305` 附近（`if (ev.sessionRef) ` 分支内）。

```js
        // ★ Teamwork：去重键升级为 actorId + sessionRef 复合键。
        //   原因：跨端同步后，"B 端同一会话"若仍按裸 sessionRef 计数，
        //   同一次使用会在 A/B 两端各算一次多样性 ⇒ 门限被稀释（假性达标）。
        //   兼容：旧调用方不传 actorId 时退化为原键，历史数据语义不变。
        if (ev.sessionRef) {
          const _actor = ev.actorId ? String(ev.actorId) : ''
          const _key = _actor ? (_actor + ':' + String(ev.sessionRef)) : String(ev.sessionRef)
          if (!p._sessions) p._sessions = new Set()
          p._sessions.add(_key)
          p.evidence.sessions = p._sessions.size
        }
```

**片段 2**：团队证据合并（新增导出，放文件末尾）。**关键纪律：单调累加，绝不覆盖。**

```js
/**
 * 合并来自团队的证据行。设计铁律三条：
 *   1. **单调性**：证据计数只增不减。远端数值小于本地时保留本地——
 *      "某人投完票又撤回"在本系统里没有语义（append-only 审计面），删减会造成
 *      "晋升后又掉回 observed"的非单调跳变。
 *   2. **会话键带 actor**：与片段 1 同款复合键，否则多样性被稀释。
 *   3. **不触发晋升决策**：只写证据。晋升与否由本地 promote() 按既有门限判定——
 *      团队同步不得绕过门限（否则高风险条目可能被远端"投"上去）。
 *
 * @param {object} store createProcedureStorePre 实例
 * @param {string} procedureId
 * @param {Array<{actorId:string, sessionRef:string, kinds:object, at:number}>} rows
 * @returns {{ok:boolean, applied:number, ignored:number, error?:string}}
 */
export function applyTeamEvidencePre(store, procedureId, rows) {
  if (!store || typeof store.get !== 'function' || typeof store.addEvidence !== 'function') {
    return { ok: false, applied: 0, ignored: 0, error: 'no-store' }
  }
  const p = store.get(procedureId)
  if (!p) return { ok: false, applied: 0, ignored: 0, error: 'not-found' }
  const list = Array.isArray(rows) ? rows : []
  let applied = 0, ignored = 0
  for (const r of list) {
    if (!r || !r.actorId || !r.sessionRef) { ignored++; continue }
    // 时间戳护栏：比本地 lastSeenAt 还早的补丁一律丢弃（乱序到达保护）
    const at = Number(r.at) || 0
    if (at && p.lastSeenAt && at < Date.parse(p.lastSeenAt)) { ignored++; continue }
    try {
      const out = store.addEvidence(procedureId, { ...(r.kinds || {}), sessionRef: r.sessionRef, actorId: r.actorId })
      if (out && out.ok === false) ignored++; else applied++
    } catch (_) { ignored++ }
  }
  return { ok: true, applied, ignored }
}
```

**片段 3**：跨端分歧视图（新增导出）。位置：文件末尾，与片段 2 相邻。

```js
/**
 * 列出同名 procedure 的跨端步骤分歧，供人工裁决。
 * 为什么不自动合并：procedure 是"要照着做的流程"，steps 自动合并会产生
 * **任何人都不认可的第 4 版流程**——比冲突本身更危险。
 * @returns {{ok:boolean, divergent:boolean, variants:Array<{actorId:string,steps:string[],at:number}>}}
 */
export function teamConflictViewPre(localProc, remoteProcs) {
  const norm = (steps) => (Array.isArray(steps) ? steps : []).map((s) => String(s).trim()).join('\n')
  const base = norm(localProc && localProc.steps)
  const variants = (Array.isArray(remoteProcs) ? remoteProcs : [])
    .filter((r) => r && norm(r.steps) !== base)
    .map((r) => ({ actorId: String(r.actorId || 'unknown'), steps: Array.isArray(r.steps) ? r.steps : [], at: Number(r.syncedAt) || 0 }))
  return { ok: true, divergent: variants.length > 0, variants }
}
```

### 风险与回归

| 风险 | 说明 | 缓解 |
|---|---|---|
| **r2 守卫双锁** | `smoke-test-r2-promotion.mjs` 字面正则锁 `evaluatePromotion(procedureId)` 签名 + 源码切片比对 `reason.push` 序列 | 本次改动**不碰** `promote`/`evaluatePromotion` 的函数体与签名；新增函数独立 |
| **`hiddenStructuralCodesPre` 同步约定 L547** | 改 `promote()` 统计门之后的结构门必须同步 | 本次不动任何门 ⇒ 无需同步；但要写进改造说明避免后人误改 |
| **`ok`/`promoted` 误用** | 团队回执若只看 `ok` 会全部报成功 | 回执结构必须透传 `promoted`（P2-5 教训） |
| **单调性破坏** | 远端覆盖本地大值 ⇒ 晋升后掉回 observed | 片段 2 的单调累加 + 回归用例"远端证据更小" |
| **session 键迁移** | 旧数据 `_sessions` 里是裸 sessionRef | 兼容分支已保留；**但迁移后同一会话会多算一次**（历史数据无法回溯 actor）【推断】 |

**既有测试/守卫**：`smoke-test-r2-promotion.mjs`（晋升门限）、procedure 相关单测（observe/addEvidence/promote 权威路径）。本次为纯新增，预计不红。
