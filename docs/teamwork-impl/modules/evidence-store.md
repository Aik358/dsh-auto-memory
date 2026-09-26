
## evidence-store

- **规模**：13,878 B / 305 行 / 9 个导出符号
- **交付形态**：**完整版**

### 职责

**M5-2 Evidence Store + Aggregate**（`docs/M5-CONTRACT.md` §8-§11）。append-only events（**JSONL 按日分片**）+ **隐私投影**（sessionRef / workspaceRef 哈希；**无原文 / 无绝对路径 / 无裸 sessionId / 无 workspaceKey / 无 excerpt**）+ retention（**30 天 / 32MiB**）+ aggregate rebuild（fresh / stale / unknown）。
**铁律**：events 为**唯一权威**；aggregate 是**可重建派生物**。默认不构造不落盘。

### 数据流

```
证据对象（来自 context-bridge.createAccessEvidencePre）
   │
   ▼
projectEvidenceForDurable(ev, opts)  L48   ★ 隐私投影
   ├─ sessionRefOf(sessionId)    L34   → sha256 前 32 hex
   ├─ workspaceRefOf(wsKey)      L39   → sha256 前 32 hex
   └─ 拒绝「事件超长」（eventMaxBytes 16 KiB）与非法形状
        │
        ▼
EvidenceEventStore.append(ev)  L135
   ├─ _appended 幂等集（4096）→ duplicate-evidence 早退 L138
   ├─ this._chain = this._chain.then(() => this._writeLine(...))  L146  **串行链**
   └─ 失败 ⇒ **释放幂等登记**（issue#56）L148-152
        │
        ▼
_writeLine(line)  L157   → <eventsDir>/<YYYY-MM-DD>.jsonl
        └─ sweepRetention()  L175   （30 天 / 32MiB；每进程至多全扫一次）
        │
        ▼
rebuildAggregates(...)  L233   → aggregate（可重建派生物）
persistAggregatesSnapshot(...)  L299 ； parseDurableEventLine L88 / canonicalWorkspaceKey L29
EVIDENCE_STORE_POLICY_PRE_V1  L19
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L19 | `EVIDENCE_STORE_POLICY_PRE_V1` | 冻结策略（keepDays 30 / maxTotalBytes 32MiB / eventMaxBytes 16KiB / appendedIdCache 4096） |
| L29 | `canonicalWorkspaceKey(key)` | 工作区键规范化 |
| L34 | `sessionRefOf(sessionId)` | 会话 → 哈希引用 |
| L39 | `workspaceRefOf(wsKey)` | 工作区 → 哈希引用 |
| L48 | `projectEvidenceForDurable(ev, opts)` | **隐私投影** |
| L88 | `parseDurableEventLine(line)` | 单行解析 |
| L115 | `EvidenceEventStore` | **事件存储类** |
| L233 | `rebuildAggregates(...)` | 聚合重建 |
| L299 | `persistAggregatesSnapshot(...)` | 聚合快照落盘 |

### 内部关键实现

**1. 隐私投影是"可共享"的前提（L48 + 文件头）**

文件头逐字：*"隐私投影（sessionRef/workspaceRef 哈希；**无原文/无绝对路径/无裸 sessionId/workspaceKey/excerpt**）"*。
⇒ 证据事件**本身就是可共享形态** —— 团队化几乎不需要额外脱敏。这是本模块对 Teamwork 最重要的贡献。

**2. 幂等登记必须可撤销（issue #56，L148-152）**

注释逐字：*"issue#56 修复(2026-09-19):写盘失败必须**释放幂等登记**。旧实现只 add 从不回退 ⇒ 一次瞬时写失败后,同 evidenceId 的重试恒被判 duplicate-evidence 而拒绝 ⇒ 该条证据**静默永久丢失**。登记保留在调用时(维持同步去重窗口),失败时撤销(允许重试)。"*
⇒ 团队化会**显著提高瞬时失败概率**（网络 + 磁盘），这条修复是团队化的**前置条件**。

**3. 串行链 _chain（L146）**

`this._chain = this._chain.then(...)` ⇒ 写操作**串行化**，避免并发 append 交错。团队回写也走同一链 ⇒ 天然有序。

**4. events 权威 / aggregate 派生（文件头）**

*"events 为唯一权威;aggregate 是可重建派生物"* ⇒ 团队只需同步 events，聚合各端重算。

### 与团队化的关系

**判定：S2 团队共享（证据事件可直接共享，因已脱敏）+ S3（aggregate 重算）。**

理由：证据的价值恰恰在"多人使用同一记忆"的累计。而隐私投影已把原文与会话标识剥离 ⇒ **共享证据不泄露对话内容**。**唯一必须治理的是 correction 类**（主观判断，见 `context-host.md` 的分流设计）。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| EV1 | `projectEvidenceForDurable` L48 | 本地投影 | 增加可选 `actorRef`（**哈希化后**入 payload） | 结构新增 |
| EV2 | `append` L135 | 幂等集 4096 上限 | 团队事件量大 ⇒ 幂等集上限需评估 | 配置项 |
| EV3 | 新增 `appendTeamEventsPre` | 无 | 团队事件批量导入（**复用 append**） | 新增导出 |
| EV4 | retention L19 | 30 天 / 32MiB | 团队独立 retention，**不得改本地值** | 新增配置 |
| EV5 | aggregate L233 | 本地重算 | 团队 aggregate 由合并后 events 重算 | 调用侧 |

#### 可直接落地的代码片段

**片段 1**：actorId 参与隐私投影（**必须哈希化**）。位置：`evidence-store.js:48`（`projectEvidenceForDurable` 内组装返回值处）。

```js
export function projectEvidenceForDurable(evidence, opts = {}) {
  // ...原有投影逻辑（sessionRefOf / workspaceRefOf / 超长与非法形状检查）...
  const out = { /* ...原有字段... */ }
  // ★ Teamwork：actorId 同样**必须哈希化**后才可入 payload。
  //   为什么：actorId 可用来"把人对应到行为"。即便它是团队内昵称，
  //   落盘后也会形成"某人在什么时间用了哪些记忆"的完整轨迹 —— 属于隐私面。
  //   投影层的既有纪律（文件头：无原文/无绝对路径/无裸 sessionId）同样适用于它。
  if (opts.actorId) {
    out.actorRef = sha256Str(String(opts.actorId)).slice(0, 32)
  }
  return { ok: true, line: JSON.stringify(out), projected: out }
}
```

**片段 2**：团队事件批量导入（新增导出，放文件末尾）。**复用 append 的幂等与串行链。**

```js
/**
 * 批量导入团队证据事件 —— **复用 append**，不另写 IO 路径。
 *
 * 为什么必须复用（见 hub-io.js:269 的既有纪律"不新建第二套 IO 实现"）：
 *   append 里已有三样来之不易的正确性 ——
 *   ① 幂等登记 + **失败时撤销登记**（issue#56：不撤销会导致瞬时失败后永久拒绝同 ID）；
 *   ② 串行链 _chain（防并发交错）；③ retention sweep。
 *   另写一条路径会立刻丢掉这三样，且症状是"偶发丢证据"——极难定位。
 *
 * @param {EvidenceEventStore} store
 * @param {Array<object>} events 团队证据（须已脱敏：经由 projectEvidenceForDurable）
 * @param {{limit?:number}} [opts]
 * @returns {Promise<{ok:boolean, applied:number, duplicates:number, failed:number}>}
 */
export async function appendTeamEventsPre(store, events, opts) {
  if (!store || typeof store.append !== 'function') return { ok: false, applied: 0, duplicates: 0, failed: 1 }
  const list = Array.isArray(events) ? events : []
  const cap = Number.isFinite(opts && opts.limit) ? Number(opts.limit) : list.length
  let applied = 0, duplicates = 0, failed = 0
  for (const ev of list.slice(0, cap)) {
    try {
      const r = await store.append(ev)
      if (r && r.ok) applied++
      else if (r && r.reason === 'duplicate-evidence') duplicates++
      else failed++
    } catch (_) { failed++ }
  }
  return { ok: failed === 0, applied, duplicates, failed }
}
```

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **隐私泄露** | actorId 明文入 payload | 片段 1 哈希化；与既有 sessionRef 同款 |
| **瞬时失败永久丢证据** | 幂等登记未撤销 | issue#56 已修；片段 2 复用 ⇒ 自动继承 |
| **团队事件撑爆本地 retention** | 共用 30 天 / 32MiB | EV4 独立 retention，**不改本地值** |
| **并发交错** | 另写写入路径 | 片段 2 复用 append（串行链） |
| **同步 aggregate** | 把派生物也同步 | 文件头铁律：events 权威、aggregate 可重建 |

**既有测试/守卫**：`evidence-store` 的隐私投影用例（断言输出无裸 ID/无绝对路径）、幂等撤销用例（issue#56）、retention 用例。**投影字段白名单很可能被守卫断言** ⇒ 片段 1 新增 `actorRef` 需同步断言。
