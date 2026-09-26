
## episodic-store

- **规模**：22,065 B / 442 行 / 10 个导出符号
- **交付形态**：**完整版**

### 职责

M8-1 经历存储**纯核心**：把会话对话段累积成 Episode 六元组 `{intent, actions, entities, unresolved, outcome, provenance}`，在会话结束/空闲期巩固（consolidate）成可被上层消费的 `episodic_candidate`。
零 IO、零第三方依赖，持久化经 `opts.io` 注入。
设计口径一条关键纪律：**失败经验默认是 candidate，不直接是事实**（防错误自我解释污染长期层，文件头 L12）。

### 数据流

```
输入：Host 采集的对话段 { sessionRef, kind, userTexts, eventSeq, contextVersion }
        │
        ▼
  append(seg)  L141
    ├─ 会话切换检测 L155  current.sessionRef !== incomingRef ⇒ 先巩固旧会话
    ├─ 段累积 + segmentCap 上限裁剪 L181（while 循环丢最旧）
    └─ 生命周期：intent/actions/entities/unresolved 增量提取
        │
        ▼
  consolidate()  L250   ← 会话结束 / 空闲期 / flush() L301
    ├─ segments < minSegments ⇒ 丢弃（stats.droppedTooShort++）L253-258
    ├─ inferOutcome(current) L227
    ├─ extractIntent L201 / extractEntities L207 / extractUnresolved L237
    ├─ provenance = sessionRef:eventSeq L273  ★A-7 修复
    ├─ validateEpisodePre L277
    ├─ **episodeId 去重**（后到者胜）L284-286  ★P2-11 修复
    ├─ retention 淘汰最旧 L288-291
    └─ persist() L294
        │
        ▼
  episode 数组 ──▶ query L307 / recent(n) L316 / get(id) L319 / statsFor(sessionRef) L325
                   snapshot() L336 / importEpisodes(rows) L367 / restore(data) L382

物理路径（Host 接线）：~/.dsh/memory/workspaces/<ws>/episodes.json
```

**依赖**：`./intent-clean-safe.js` 的 `stripRuntimeIntentPre`（清洗运行时残留意图）。

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L29–L43 | `EPISODIC_POLICY_VERSION` / `EPISODE_ID_PREFIX` / `EPISODE_ID_RE` / `EPISODE_SEGMENT_CAP_PRE_V1` / `EPISODE_RETENTION_PRE_V1` / `EPISODE_MIN_SEGMENTS_PRE_V1` / `EPISODE_OUTCOMES_PRE_V1` | 策略常量与封闭枚举 |
| L49 | `validateEpisodeSegmentPre(seg)` | 段校验 |
| L63 | `validateEpisodePre(ep)` | Episode 校验 |
| L88 | `createEpisodicStorePre(opts)` | **工厂** |

**实例方法**：`append(seg) L141`、`extractIntent L201`、`extractEntities L207`、`inferOutcome L227`、`extractUnresolved L237`、`consolidate() L250`、`flush() L301`、`query(q={}) L307`、`recent(n=10) L316`、`get(episodeId) L319`、`statsFor(sessionRef) L325`、`snapshot() L336`、`importEpisodes(rows) L367`、`restore(data) L382`、`clear() L394`、`dispose(reason) L404`、`persist() L420`、`getLastPersistError() L436`、`getStats() L437`。

### 内部关键实现

**1. provenance 必须带 sessionRef L269-273（A-7 修复）**

```js
// 旧实现只用 'seg:' + eventSeq ⇒ 不同会话里 eventSeq 从 1 重新计数时会产出
// 完全相同的串（实测 ["seg:1","seg:1"]），既无法溯源到会话，
// 也让"同一段被重复计入"与"两段恰好同号"在审计面上不可区分。
provenance: current.segments.map((s) => String(current.sessionRef) + ':' + String(s.eventSeq)),
```

**2. consolidate() 按 episodeId 去重 L279-286（P2-11 修复）**

`episodeId = hash(sessionRef, startedAt)` ⇒ 同一会话同一时间戳被重复巩固会产出**同一主键的第二条**，下游 `query`/`statsFor` 把一次会话数成两次 ⇒ `distinctSessions/success` 虚高。策略**后到者胜**（原地替换，不打乱既有顺序），与 `fact-store.restore` 一致。

**3. consolidate() 的 persisted 语义分离 L295-297**

```js
return pr.ok
  ? { ok: true, episode: v.episode, persisted: true }
  : { ok: true, episode: v.episode, persisted: false, persistError: pr.error }
```

**★ 这是与 procedure-store 同款的 ok/promoted 分离纪律**：巩固本身成功了（`ok:true`），但落盘失败另有 `persisted:false`。消费方只看 `ok` 会误判。团队化回执必须透传 `persisted`。

**4. segmentCap 用 while 而非 if L181**

```js
while (current.segments.length > cfg.segmentCap) { ... }
```
【推断】用 `while` 是为防御"配置被热改小、一次超出多段"的场景（`if` 只裁一段）。

### 与团队化的关系

**判定：私有（Private），仅巩固产物 episodic_candidate 升格为团队共享。**

理由：Episode 是**个人经历流**——"A 这一轮聊了什么、卡在哪"对 B 没有直接价值，且体量最大（`EPISODE_SEGMENT_CAP_PRE_V1` 上限逐段累积）。而 `consolidate()` 产出的 **intent / entities / unresolved / outcome 是已经抽象过的**，有共享价值（"这个项目里 unresolved 长期挂着 X"是团队事实）。
**关键**：`provenance`（L273）是 `sessionRef:eventSeq`，**sessionRef 是哈希后的**（见 `evidence-store.js:34 sessionRefOf`）⇒ 天然不泄露原始会话 ID，可直接共享。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| E1 | `consolidate()` L294 之后 | 只 `persist()` | 追加 `team.stage(...)`，**只投抽象投影** | 纯新增 |
| E2 | `append()` L141 | 本地累积 | **不动**（段级数据不出本机） | 无 |
| E3 | `consolidate()` L284 | 按 episodeId 去重 | 团队写入走独立入口，**不并入本地 episodes[]** | 新增函数 |
| E4 | `statsFor()` L325 | 只统计本地 | 新增 `teamStatsForPre` 聚合多端 | 新增 |
| E5 | `snapshot()` L336 | 全量 | 新增 `teamProjectionOfEpisodePre({since})` 只出抽象字段 | 新增 |

#### 可直接落地的代码片段

**片段 1**：团队投影（新增导出，放文件末尾）。**只出抽象字段，不出任何原文。**

```js
/**
 * 生成可安全共享的 episode 投影。
 * 白名单式投影（**不是黑名单**）——新增字段默认不外传，避免"顺手加一个字段"造成泄露。
 * 明确排除：userTexts / assistantTexts / 任何对话原文。
 * @param {object} ep consolidate() 产出的 episode
 * @returns {object|null} 不可共享时返回 null
 */
export function teamProjectionOfEpisodePre(ep) {
  if (!ep || !ep.episodeId) return null
  return {
    episodeId: String(ep.episodeId),
    // sessionRef 已是哈希（evidence-store.js:34），可直接外传
    sessionRef: String(ep.sessionRef || ''),
    intent: String(ep.intent || '').slice(0, 500),     // 截断：防止单条撑爆同步载荷
    actions: (Array.isArray(ep.actions) ? ep.actions : []).slice(0, 50).map((a) => String(a)),
    entities: (Array.isArray(ep.entities) ? ep.entities : []).slice(0, 50).map((e) => String(e)),
    unresolved: (Array.isArray(ep.unresolved) ? ep.unresolved : []).slice(0, 20).map((u) => String(u).slice(0, 200)),
    outcome: String(ep.outcome || ''),
    startedAt: Number(ep.startedAt) || 0,
    consolidatedAt: Number(ep.consolidatedAt) || 0,
    // provenance 也带上：它是 sessionRef:eventSeq，不含原文
    provenance: (Array.isArray(ep.provenance) ? ep.provenance : []).slice(0, 200).map((p) => String(p)),
  }
}
```

**片段 2**：在 consolidate() 成功分支投递。位置：`episodic-store.js:294`（`const pr = persist()` **之前**，这样投递不依赖落盘成败）。

```js
    // ★ Teamwork：巩固产物投递（只投抽象投影，见 teamProjectionOfEpisodePre）。
    //   放在 persist() 之前：本地落盘失败不应阻断团队可见性（两者是独立的可靠性域）。
    if (team && groupId) {
      try {
        const proj = teamProjectionOfEpisodePre(v.episode)
        if (proj) team.stage({ v: 1, entity: 'episode', groupId, actorId, op: 'consolidate', payload: proj, at: nowFn() })
      } catch (e) { lastTeamStageError = (e && e.message) ? String(e.message) : String(e) }
    }
```

**片段 3**：团队统计聚合（新增导出）。

```js
/**
 * 跨端 episode 统计。用于回答"这个项目在团队里卡过几次"。
 * 注意 unresolved 去重是**大小写无关**的——团队里 "Fix login" 与 "fix login" 是同一件事。
 * @param {Array<object>} projections 各端 teamProjectionOfEpisodePre 的输出
 * @returns {{sessions:number, outcomes:object, topUnresolved:Array<{text:string,count:number}>}}
 */
export function teamStatsForPre(projections) {
  const list = Array.isArray(projections) ? projections : []
  const sessions = new Set()
  const outcomes = {}
  const unresolved = new Map()
  for (const p of list) {
    if (!p) continue
    if (p.sessionRef) sessions.add(String(p.sessionRef))
    const o = String(p.outcome || 'unknown')
    outcomes[o] = (outcomes[o] || 0) + 1
    for (const u of (Array.isArray(p.unresolved) ? p.unresolved : [])) {
      const key = String(u).trim().toLowerCase()
      if (!key) continue
      const prev = unresolved.get(key)
      unresolved.set(key, { text: prev ? prev.text : String(u).trim(), count: (prev ? prev.count : 0) + 1 })
    }
  }
  const topUnresolved = [...unresolved.values()].sort((a, b) => b.count - a.count).slice(0, 20)
  return { sessions: sessions.size, outcomes, topUnresolved }
}
```

### 风险与回归

| 风险 | 说明 | 缓解 |
|---|---|---|
| **对话原文泄露** | 若用"排除字段"写法，新增字段会默认外传 | 片段 1 用**白名单**；回归须断言投影结果的 key 集合恰好等于白名单 |
| **载荷膨胀** | intent/entities 无界 | 片段 1 已逐字段截断（intent 500 / actions 50 / entities 50 / unresolved 20） |
| **persisted 误读** | 团队回执只看 `ok` | 回执必须透传 `persisted`（与 procedure-store 的 `promoted` 同款教训） |
| **episodeId 跨端碰撞** | `hash(sessionRef, startedAt)`，两端 sessionRef 不同 ⇒ 不碰撞【推断】 | 无需处理；但**同一会话在两端不应同时巩固**（Host 接线需保证） |

**既有测试/守卫**：episodic-store 单测（append/consolidate/去重/retention）。本次为纯新增导出 + 一处投递，预计不红。
