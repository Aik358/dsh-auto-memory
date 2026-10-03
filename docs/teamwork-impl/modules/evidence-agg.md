
## evidence-agg

- **规模**：3,988 B / 82 行 / 3 个导出符号
- **交付形态**：**完整版**

### 职责

`evidence-agg-pre` —— **evidence 事件 → 聚合 → importance 输入契约**（M8-2b，2026-09-09）。
管道：`evidence/events/*.jsonl`（写入侧 `context-bridge`，只读）→ 有界扫描 → 按 memoryId 聚合六类计数 + distinctSessions → 交给 `memory-importance.computeImportancePre` → 作为 `recall()` L0 融合的加权因子之一（P8 融合入口）。
**契约**：纯函数 + IO 注入（`io = { listFiles(), readFile(name) }`），模块**零内置 IO、零写入**；**有界读取**：文件名日期在窗口内（默认近 7 天）且每文件只取**末 N 行**（默认 400），**绝不全量扫描历史**。

### 数据流

```
~/.dsh/memory/evidence/events/<YYYY-MM-DD>.jsonl   （按日分片，append-only）
   │
   ▼
scanEvidenceEventsPre(opts)   L33
   ├─ io.listFiles()   ← 注入（模块自身零 IO）
   ├─ 文件名日期在窗口内（EVIDENCE_AGG_DEFAULTS_PRE_V1.windowDays 默认 7）L20
   └─ io.readFile(name) → 每文件只取**末 N 行**（默认 400）
        │
        ▼
aggregateEvidenceEventsPre(events)  L57
   ├─ 按 memoryId 聚合：seen / read / cite / reuse / success / correction
   ├─ distinctSessions ← sessionRef 去重（L70）
   └─ 产出 importance 输入契约对象
        │
        ▼
memory-importance.computeImportancePre(...)   → importance
        │
        ▼
recall() L0 融合的加权因子之一
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L17 | `EVIDENCE_AGG_VERSION` | 版本常量 |
| L20 | `EVIDENCE_AGG_DEFAULTS_PRE_V1` | 默认：窗口 7 天 / 每文件末 400 行 |
| L33 | `scanEvidenceEventsPre(opts)` | **有界扫描**（IO 注入） |
| L57 | `aggregateEvidenceEventsPre(events)` | 按 memoryId 聚合 |

### 内部关键实现

**1. "绝不全量扫描历史" 是有界性的核心承诺**

文件头逐字：*"有界读取：文件名日期在窗口内（默认近 7 天）且每文件只取末 N 行（默认 400），**绝不全量扫描历史**"*。
⇒ 两个维度同时设界（**文件数** × **每文件行数**），防止历史增长把每次 recall 拖慢。

**2. 纯函数 + IO 全注入**

`io = { listFiles(), readFile(name) }` 注入 ⇒ 模块自身零 IO ⇒ 可用假 IO 直接单测。这是本仓"纯核心 + 注入 IO"的统一形态（同 fact-store / procedure-store / episodic-store）。

**3. sessionRef 去重 L70（与 procedure-store、memory-importance 同源）**

`distinctSessions` 用于 importance 的 diversity 项。**三处模块各自做这件事**（`procedure-store` 的 `_sessions`、`memory-importance`、本模块）⇒ 团队化必须**统一去重键**，否则同一会话在不同路径上被算成不同数量。

### 与团队化的关系

**判定：S3 派生重算（聚合结果）+ S2 共享（原始事件需跨端汇总）。**

理由：聚合值本身可重算，**同步聚合值没有意义**。但**输入事件**是团队化的关键：importance 要反映"团队用了多少次"，就必须拿到**多端的证据事件**。
⇒ 正确的接法是：**同步证据事件（或其中间摘要），本地重算聚合**。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| EA1 | `aggregateEvidenceEventsPre` L57 | 按 memoryId 聚合 | 每条证据行带 actorId；输出增加 byActor | 兼容（缺 actorId ⇒ 老行为） |
| EA2 | `scanEvidenceEventsPre` L33 | 只读本地目录 | 增加可选的团队事件源（第二个 io） | 新增参数 |
| EA3 | distinctSessions L70 | 裸 sessionRef | 改为 actorId + sessionRef 复合键（与 procedure-store / memory-importance 统一） | 键规则变更 |
| EA4 | 窗口 | 本地 7 天 | 团队窗口需更长（成员活动稀疏）；**独立配置项** | 新增配置 |
| EA5 | 幂等 | 无 | 团队事件可能重复投递 ⇒ 按 evidenceId 去重 | 新增 |

#### 可直接落地的代码片段

**片段 1**：统一去重键 + actor 分账。位置：`evidence-agg.js:57`（`aggregateEvidenceEventsPre` 函数体）。

```js
export function aggregateEvidenceEventsPre(events) {
  const list = Array.isArray(events) ? events : []
  const byMemory = new Map()
  // ★ Teamwork：去重键统一为 actorId + ':' + sessionRef。
  //   理由：procedure-store.js 的 _sessions、memory-importance 的 distinctSessions、
  //   本模块的 sessions 是**同一个语义**（跨会话多样性）在三处的实现。
  //   团队化把它们统一到同一套键，否则同一个人的同一会话会被算成 2 个（A 端 1 + B 端 1）。
  const KEYS = ['seen', 'read', 'cite', 'reuse', 'success', 'correction']
  for (const ev of list) {
    if (!ev || !ev.memoryId) continue
    const mid = String(ev.memoryId)
    let rec = byMemory.get(mid)
    if (!rec) {
      rec = { memoryId: mid, sessions: new Set(), byActor: new Map() }
      for (const k of KEYS) rec[k] = 0
      byMemory.set(mid, rec)
    }
    const kind = String(ev.kind || ev.evidenceKind || '')
    if (KEYS.indexOf(kind) >= 0) rec[kind] += 1
    const actor = String(ev.actorId || '')
    if (ev.sessionRef) {
      rec.sessions.add(actor ? (actor + ':' + String(ev.sessionRef)) : String(ev.sessionRef))
    }
    if (actor) {
      const a = rec.byActor.get(actor) || { actorId: actor, total: 0 }
      a.total += 1
      rec.byActor.set(actor, a)
    }
  }
  const out = []
  for (const rec of byMemory.values()) {
    const o = { memoryId: rec.memoryId, distinctSessions: rec.sessions.size }
    for (const k of KEYS) o[k] = rec[k]
    // 团队诊断用：谁贡献了多少证据（不参与 importance 计算，只供审计）
    o.byActor = [...rec.byActor.values()].sort((x, y) => y.total - x.total)
    out.push(o)
  }
  return out
}
```

**片段 2**：团队事件源 + 幂等去重。位置：`evidence-agg.js:33`（`scanEvidenceEventsPre` 返回前）。

```js
  // ★ Teamwork：团队事件可能被**重复投递**（网络重试、多路径同步）。
  //   按 evidenceId 去重是必要的 —— importance 是累加量，重复计数会直接虚高，
  //   而虚高的 importance 会把一条记忆推到排序前面且**没有明显症状**。
  const seenIds = new Set()
  const events = []
  for (const raw of rawEvents) {
    const id = raw && (raw.evidenceId || raw.id)
    if (id) {
      if (seenIds.has(String(id))) continue      // 重复 ⇒ 丢弃
      seenIds.add(String(id))
    }
    events.push(raw)
  }
  return events
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **三处去重键不一致** | 只改本模块 | EA3 要求三处同轮改；判据统一为 actorId + sessionRef |
| **重复事件虚高 importance** | 团队事件重投 | 片段 2 按 evidenceId 去重 |
| **历史膨胀** | 团队事件量大 | 有界性（窗口 × 末 N 行）必须保留；团队窗口独立配置 |
| **零 IO 契约被破坏** | 为图方便直接读文件 | 文件头明文"模块零内置 IO、零写入" |

**既有测试/守卫**：本模块的有界性用例（窗口/末 N 行）、聚合用例。片段 1 改变返回对象结构（sessions → distinctSessions 已是既有字段名）⇒ **需确认既有断言里的字段名**；片段 1 保留 `distinctSessions` 名称，兼容性良好。
