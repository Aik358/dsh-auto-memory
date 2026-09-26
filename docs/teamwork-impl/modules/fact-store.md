## fact-store

- **规模**：51,378 B / 892 行 / 55 个导出符号（8 个 `export const` + 5 个 `export function` + 42 个文件内 `const` 常量）
- **交付形态**：**完整版**

### 职责

M8-0 事实存储**纯核心**：一个零 IO、零第三方依赖的内存状态机，维护 Fact 四元组 `{scope, subject, predicate, object}` + provenance + confirmedAt + ttl + revoked 的完整生命周期（upsert / 冲突保留 / supersede / revoke / 过期 / 保留上限淘汰）。
它同时是 M7 judgement-shadow 输出（`semantic_candidate` / `profile_candidate`）的**摄入适配器**，与 M5 AccessEvidence 的聚合入口（`evidenceFor`）。
模块自身**不读写磁盘**，持久化通过可注入 IO 接口（`opts.io`）在 Host 接线时接到真实文件——这一点决定了团队化改造可以从"注入层"切入而不必碰状态机。

### 数据流

```
输入侧 A（模型推断，来自 judgement-shadow worker）
  ~/.dsh/memory/judgement/*.jsonl  ──(Host 读行)──▶ ingestJudgementRows(store, rows)   L872
                                                      └─▶ factCandidateFromJudgementRow(row)  L847
                                                          （只收 semantic_candidate / profile_candidate，其他 kind 返回 null）

输入侧 B（显式写入，来自工具/路由）
  memory_* 工具调用 ──▶ host 组装 cand ──▶ store.upsert(cand)   L426
                                          │
   ┌──────────────────────────────────────┴───────────────────────────────────────┐
   │ validateFactCandidatePre(cand)      L79    形状非法 → {ok:false, outcome:'invalid'}
   │ looksFactCandidatePre(c)            L284   形态闸门（B-3）：非事实陈述 → outcome:'not-a-fact-statement'
   │ findSubjectPredicate(scope,subj,pred) L357 同主谓不同宾语 → 冲突集（**登记快照而非活引用** L461-470）
   │ findById(newFactId)                 L367   ▲ A-3：命中已撤销记录 → 复活 + merge，绝不 push 第二条 L491-500
   └──────────────────────────────────────┬───────────────────────────────────────┘
                                          ▼
                                   内存 facts[] / conflicts[]
                                          │
                                          ▼
                    persist()  L725 ──▶ io.save(snapshot({includeRevoked:true}))  L737
                                          │
物理路径（Host 接线，本模块不直接拼路径）：~/.dsh/memory/workspaces/<ws>/facts.json
```

**派生输出**：`snapshot()` L737 是全量只读投影，供 M-06 可读投影与 sidecar 索引消费；`evidenceFor(memoryId, evidenceList)` L632 聚合六类证据（seen/read/cite/reuse/success/correction）+ 去重 session 数，供 M-04 技能晋升复用。

### 对外接口

**模块级导出**

| 行号 | 签名 | 说明 |
|---|---|---|
| L42–L73 | `FACT_POLICY_VERSION` 等 8 个 `export const` | 策略版本与封闭枚举（scope / epistemicStatus / trend / sourceClass / sourceKind / upsertOutcome / TTL 默认值） |
| L79 | `validateFactCandidatePre(cand)` | 形状校验，返回 `{ok, candidate, reason}` |
| L105 | `validateFactPre(fact)` | 已固化记录校验 |
| L131 | `isFactConflict(existing, cand)` | 冲突判据：同 scope+subject+predicate 且 object 不同 |
| L251 | `looksFactStatementPre(text)` | B-3 事实性判据，单独导出便于测试 |
| L284 | `looksFactCandidatePre(cand)` | 同上，作用于候选对象 |
| L308 | `defaultEpistemicStatusPre(c)` | 按来源推断默认认识论状态（explicit > inference） |
| L323 | `createFactStorePre(opts)` | **工厂**，返回 18 个方法的实例（见下） |
| L847 | `factCandidateFromJudgementRow(row)` | judgement 行 → FactCandidate |
| L872 | `ingestJudgementRows(store, rows, opts)` | 批量摄入，含 `observationId + sourceIds` 去重 |

**实例方法（`createFactStorePre` 返回对象，L814-837）**

```js
{ upsert(cand) L426, supersede(cand) L542, get(scope,subject,predicate) L587,
  query(q={}) L592, conflictsList() L604, pendingConflicts() L607,
  resolveConflict(conflictId, choice) L610, evidenceFor(memoryId, evidenceList=[]) L632,
  revokeBySource(sourceId) L567, snapshot(opts={}) L737, restore(data) L761, clear() L790,
  dispose(reason) L806, factCandidateFromJudgementRow L847,
  getStats() L824, getLastFactnessReject() L827, getLastPersistError() L829,
  getLastPrune() L832, retentionLimit() L834, get size L835, get conflictCount L836 }
```

### 内部关键实现

**1. `upsert(cand)` L426 —— 五道闸门串联**

顺序是**刻意的**，改动时不可重排：

1. `disposed` 短路 L427 → `{outcome:'disposed'}`
2. `validateFactCandidatePre` L429 —— **形状**非法报 `invalid`；注释 L441 明确"顺序：结构化校验在前，本闸门只判形态"
3. **浅拷贝** L434 `const c = { ...v.candidate }` —— B-4 修复，避免改写调用方对象（`validate` 返回的是**原引用**）
4. `looksFactCandidatePre` L442 —— **形态**闸门，命中即 `stats.factnessRejected++` + `lastFactnessReject = {...}` L447，**不静默丢弃**（可经 `getLastFactnessReject()` 读出）
5. 冲突检测 L455-470 → 复活/合并 L491-500

**2. 冲突登记取快照而非活引用 L461-470**

坑（上游 PR #80 第 3 项 / issue #67）：旧实现 `left: existing` 持 store 内活对象 ⇒ 后续 `mergeInto` 会**原地改写** `existing.confidence` 并对 `existing.provenance` **数组原地 push** ⇒ 已展示/已落盘的冲突左侧 ≠ 检测时的值，审计面失真。
现取 `{ ...existing, provenance: [...existing.provenance] }`。
**推论（【推断】）**：任何把 store 内对象直接交给外部（含跨机器同步）的设计，都必须沿用同一纪律——团队同步层拿到的必须是快照。

**3. 主键复活语义 L484-500（A-3）**

`factId` 是 `sha256(['fact-pre-v1', scope, subject, predicate, object])` L342-345 ——**不含 revoked**。因此"同一元组撤销后重新成立"会撞主键；旧实现无条件 push 第二条 ⇒ 宿主 `index.js:9299` 用 `hubFlushState.flushed[fact.factId]` 做写回去重键时，**新事实被当"已处理"永久跳过**。
现实现：命中即复活（`revoked=false`），清掉 `revokedAt`/`revokeReason`（L498-499，审计面自相矛盾），合并 provenance。

**4. `persist()` L725 / `dispose()` L806 / `clear()` L790 —— 三条"失败必须外显"路径**

- `persist()`：先 `pruneIfNeeded()` L727（#110，落盘前按上限有序淘汰），失败写 `lastPersistError` 并返回 `{ok:false,error}`
- `dispose()` L806-812：**最后一次落盘机会**，A-8 修复——旧实现空 `catch` ⇒ 静默丢弃全部未落盘状态
- `clear()` L790-805：issue #76-6c 修复——`for (const k of Object.keys(stats)) stats[k] = 0` **按现有键遍历归零**，避免将来新增字段再漏

**5. `restore(data)` L761 —— 按 factId 去重，后到者胜**

磁盘上若有重复主键（并发写/旧版本产物），旧实现无条件 push 会把上游 bug 一路带进新进程。现"原地替换、不打乱既有顺序"。

### 与团队化的关系

**判定：团队共享（Shared）。**

理由：Fact 是「谁在什么条件下断言了什么事」的**权威事实层**，同一团队成员的价值恰恰来自共享——A 记录的"这个项目用 pnpm 不用 npm"对 B 必须可见。`scope` 字段（`FACT_SCOPES_PRE_V1` L51）已经天然提供了「个人 / 项目 / 团队」的切分维度，是团队化**现成的路由键**。
但**冲突集（`conflicts[]`）必须单独判定**：冲突是「两个来源对同一主谓给出不同宾语」，在小团队里它就是**待裁决项**，应当共享且带裁决状态；而裁决动作（`resolveConflict` L610）必须记录**裁决人 actorId**，否则团队里无法追责。

**派生项不必同步**：`evidenceFor` 的输出是纯派生（输入=evidenceList），可由各端本地重算 —— 归入「派生重算」。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| F1 | `createFactStorePre(opts)` L323 / L337 | 只注入 `io` / `now` / `factId` | 增加 `opts.team`（`{stage, groupId, actorId}`）与 `opts.origin` 默认值 | 纯新增，老调用方不传即老行为（**零破坏**） |
| F2 | `upsert()` L491 之后 | 本地新建后直接返回 | 新建/复活成功后调用 `teamStagePre('upsert', {...})` | 仅新增一次函数调用；失败**不回滚本地**（本地是权威，同步是尽力而为） |
| F3 | `supersede()` L542 / `revokeBySource()` L567 | 同上 | 各加一行 `teamStagePre` | 同上 |
| F4 | `persist()` L725 | 只 `io.save` | 保持不动（**落盘与同步解耦**） | 无 |
| F5 | 新增 `applyTeamPatchPre(patch)` | 无 | 新增远程补丁应用函数，**复用 upsert 的 conflict 分支**，但 `sourceKind` 标 `team` 且**跳过 factness 闸门**（远端已过闸） | 新增导出，不改既有路径 |
| F6 | `conflicts` 记录结构 L466-470 | 无 actor 字段 | 增加 `actorId` / `resolvedBy` | 结构新增字段；`snapshot()`/`restore()` 需容忍缺失（老数据无该键） |

#### 可直接落地的代码片段

**片段 1**：注入层扩展。位置：`fact-store.js:337`（`const io = opts.io || ...` 下一行）。

```js
  // ★ Teamwork：团队同步适配器（纯注入，缺省 null ⇒ 老行为字节级不变）
  //   与 io 同款约定：本模块不做网络，只把"待同步增量"交给 Host 注入的实现。
  const team = (opts.team && typeof opts.team.stage === 'function') ? opts.team : null
  const groupId = opts.groupId ? String(opts.groupId) : ''
  const actorId = opts.actorId ? String(opts.actorId) : 'local'

  /**
   * 把一条本地变更投递到团队暂存区。**尽力而为**：失败只记痕迹，绝不影响本地写入。
   * @returns {{ok:boolean, skipped?:string, error?:string}}
   */
  function teamStagePre(op, payload) {
    if (!team || !groupId) return { ok: true, skipped: 'team-disabled' }
    try {
      const r = team.stage({
        v: 1,                 // 补丁格式版本（跨端兼容锚点，改格式必须升）
        entity: 'fact',
        groupId,
        actorId,
        op,                   // 'upsert' | 'supersede' | 'revoke' | 'resolve-conflict'
        payload,              // 必须是**快照**，不得持 store 内活引用（见 L461-470 的教训）
        at: nowFn(),
      })
      return (r && typeof r === 'object') ? r : { ok: true }
    } catch (e) {
      // 不抛：本地是权威，同步失败不应中断记忆写入
      lastTeamStageError = (e && e.message) ? String(e.message) : String(e)
      return { ok: false, error: lastTeamStageError }
    }
  }
```

**片段 2**：在 `upsert()` 的三个成功出口投递（位置：`fact-store.js:548` 附近，即新建/复活/合并三条分支合并为 `outcome` 之后、`return` 之前）。

```js
    // ---- 以下为 Teamwork 新增：三条成功出口统一投递（新建 / 复活 / 合并） ----
    if (outcome === 'created' || outcome === 'revived' || outcome === 'merged') {
      // 传 snapshot 形态的**深拷贝**：provenance 是数组，必须复制（沿用 L742-745 的纪律）
      teamStagePre(outcome === 'merged' ? 'merge' : 'upsert', {
        fact: cloneFact(createdOrUpdatedFact),   // 由 upsert 内部已有的引用传入
        origin: 'local',
        epistemicStatus: c.epistemicStatus,
      })
    }
    return { ok: true, outcome /* ...原有字段不变 */ }
```

**片段 3**：远程补丁应用（新增导出函数，放在文件末尾 `ingestJudgementRows` L872 之后）。

```js
/**
 * 应用一条来自团队的补丁。与 upsert 的差异（三条，必须写进注释否则后人会"顺手统一"）：
 *   1. **跳过 factness 闸门** —— 远端入库时已过闸，本地重判会造成"同一条事实 A 端进 B 端不进"。
 *   2. `sourceKind` 强制标 `'team'`，并保留远端 actorId 进 provenance。
 *   3. **不做冲突裁决**：远端与本地冲突时进 conflicts[] 等待裁决，而不是本地覆盖——
 *      团队语义下"谁对"必须由人决定，不由到达顺序决定。
 * @param {object} store createFactStorePre 返回的实例
 * @param {object} patch {v, entity, op, payload:{fact}, actorId, at}
 * @returns {{ok:boolean, outcome:string, conflictId?:string, error?:string}}
 */
export function applyTeamPatchPre(store, patch) {
  if (!store || typeof store.upsert !== 'function') return { ok: false, outcome: 'no-store' }
  if (!patch || patch.entity !== 'fact' || patch.v !== 1) {
    return { ok: false, outcome: 'unsupported-patch', error: 'entity/v mismatch' }
  }
  const f = patch.payload && patch.payload.fact
  if (!f) return { ok: false, outcome: 'malformed', error: 'payload.fact missing' }
  const cand = {
    scope: f.scope, subject: f.subject, predicate: f.predicate, object: f.object,
    sourceKind: 'team',                     // ① 强制团队来源
    sourceClass: f.sourceClass || 'team',
    confidence: f.confidence,
    epistemicStatus: f.epistemicStatus,
    provenance: [
      ...(Array.isArray(f.provenance) ? f.provenance : []),
      { kind: 'team-import', actorId: String(patch.actorId || 'unknown'), at: Number(patch.at) || Date.now() },
    ],
    // ② 打标：让 upsert 内部知道这条不该被本地 inference 逻辑改写
    _fromTeam: true,
  }
  try {
    const r = store.upsert(cand)
    return { ok: !!r.ok, outcome: r.outcome || (r.ok ? 'applied' : 'rejected'), ...(r.conflictId ? { conflictId: r.conflictId } : {}) }
  } catch (e) {
    return { ok: false, outcome: 'threw', error: (e && e.message) ? String(e.message) : String(e) }
  }
}
```

> 片段 3 的 `cand.sourceKind: 'team'` 需要在 `FACT_SOURCE_KINDS_PRE_V1`（L65）里加枚举项，否则 `validateFactCandidatePre` L79 会拒。**这是本次改造唯一必须同步改的封闭枚举**。

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **枚举漏改** | 加了 `sourceKind:'team'` 但没改 `FACT_SOURCE_KINDS_PRE_V1` L65 | 字符串枚举写错编译器不报错、静默忽略（已有用户级教训）。必须补一条测试断言该枚举含 `'team'` |
| **主键碰撞跨端** | 两端独立生成同 `factId`（同 scope+subject+predicate+object）但 provenance 不同 | 设计上**这是期望行为**（合并而非冲突），但要断言合并后 provenance 双向可见 |
| **冲突集无限膨胀** | 团队多人反复给出不同宾语 | `conflicts[]` 无上限（`facts` 有 `maxFacts` L680）。**当前无淘汰机制**，团队化后这是首要容量风险【推断】 |
| **teamStage 抛错污染主流程** | Host 注入的 `stage` 抛异常 | 片段 1 已 try/catch；回归需覆盖"stage 必抛"的负路径 |
| **老快照兼容** | `restore()` L761 读到的 facts.json 无 `actorId` 字段 | 新增字段一律可选，`restore` 不校验未知字段 |

**既有测试/守卫**：`tests/` 下 fact-store 相关单测（`ingestJudgementRows` 委托分支、`factness` 五码、`clear()` 全量归零、`restore` 去重）都是**行为级断言**，本次改造为纯新增路径，预计不红；但 `clear()` 的 `Object.keys(stats)` 归零断言若新增 `team* ` 统计键，**必须同步确认归零仍全量**（这是 issue #76-6c 的回归点）。
