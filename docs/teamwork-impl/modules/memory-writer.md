
## memory-writer

- **规模**：30,074 B / 572 行 / 6 个导出符号（+19 个文件内函数）
- **交付形态**：**完整版**

### 职责

`MemoryDocumentWriter` —— **M3b-2 原子写入基础设施**（契约 §8-§9，对应 M-06 的 project/atomicWrite 层）。三层组成：①纯渲染原语（无 fs、零副作用）：`applyMigrationPlan` / `appendAnchoredRecord` / `renderReplace`，与 `memory-anchor.js` 的 `parseAnchors` 成对，保证 **render→parse 幂等与身份稳定**；②`atomicReplace(target, data, fs)`：同目录临时文件 + fsync + rename；③`MemoryDocumentStore`：per-file 串行 Promise 队列、digest 前置条件、backup、sidecar 落盘/重建、故障注入接口（fs 可注入）。
本阶段不接入真实写路径（M3b-3 才逐路径迁移）、不迁移真实 Markdown（`memoryAnchorEnabled=false`）。

### 数据流

```
写请求（append / replace / replaceSingle / applyPlan）
   │
   ▼
MemoryDocumentStore._queue(file)   L345   ← **per-file 串行 Promise 队列**
   └─ 同一文件的写请求排队，杜绝交错
        │
        ▼
   _readState(file)  L356
        ├─ 读当前正文 + 解析 anchors（memory-anchor.parseAnchors）
        └─ 读 sidecar  L440 readSidecar / L430 _writeSidecar
        │
        ▼
   _checkCommitBoundary(...)  L396      ← digest 前置条件（乐观并发）
        │
        ▼
   _commit(...)  L452
        ├─ atomicReplace(target, data, fs)  L235
        │    同目录 tmp + fsync + rename
        └─ backup
        │
        ▼
   目标 Markdown 文件（物理路径由宿主给出）
   sidecarPath()  L423  → 同名 .sidecar.json

纯渲染路径（无 IO，可独立单测）：
   applyMigrationPlan  L84 / appendAnchoredRecord L119 / renderReplace L150 / replaceSingleRecord L196
```

### 对外接口

| 行号 | 签名 | 说明 |
|---|---|---|
| L36 | `toEol(text, eol)` | 统一行尾（CRLF/LF 保持性质） |
| L84 | `applyMigrationPlan(content, plan, opts)` | 应用迁移计划（纯函数） |
| L119 | `appendAnchoredRecord(content, record, opts)` | 追加一条带锚点记录（纯函数） |
| L150 | `renderReplace(content, memoryId, newBody)` | 替换指定条目正文（纯函数） |
| L196 | `replaceSingleRecord(content, ...)` | 单条替换（内部） |
| L235 | `atomicReplace(target, data, fs)` | 同目录临时文件 + fsync + rename |
| L310 | `memoryWriteLockKey(file)` | 锁键 |
| L316 | `memoryWriteError(...)` | 错误构造 |
| L334 | `MemoryDocumentStore` | 存储类 |

类方法：`constructor L335`、`_queue L345`、`_readState L356`、`_checkCommitBoundary L396`、`sidecarPath L423`、`_writeSidecar L430`、`readSidecar L440`、`_commit L452`、`append L505`、`replace L519`、`replaceSingle L532`、`applyPlan L545`、`rebuildSidecar L559`。

### 内部关键实现

**1. 纯渲染原语与 `parseAnchors` 成对（文件头 L6-8）**

设计目标逐字：*"与 memory-anchor.js 的 parseAnchors 成对，保证 render→parse 幂等与身份稳定"*。⇒ 团队化新增任何渲染形态，都必须同时保证"渲染出来的文本能被 `parseAnchors` 解析回同一组 memoryId"。

**2. per-file 串行 Promise 队列 L345 —— 并发安全的唯一闸门**

同一文件的所有写请求排队执行。**这是本模块能在并发环境下工作的关键**。注意：它只保证**进程内**串行；跨进程（多实例 DSH）需要文件锁 —— 团队化会把这个假设暴露出来。

**3. `_checkCommitBoundary` L396 —— digest 前置条件（乐观并发）**

写入前校验"我读到的那份内容没被别人改过"（digest 比对）。团队化多端写同一文件时，这条是**检出冲突的唯一机制**（但当前只返回失败，不做合并）。

**4. `atomicReplace` L235 —— tmp + fsync + rename**

文件头 L5 明确 "`Windows 覆盖须实测`" —— 即 rename 覆盖在 Windows 上曾有边界问题。团队化提高写频次会让这个问题更容易暴露。

**5. 保留语法守卫 `reservedSyntaxGuard` L63**

写之前检查内容里是否含**保留语法**，防止用户内容破坏锚点/信封结构。

### 与团队化的关系

**判定：S2 团队共享（写入口 → 共享），但其"原子写 + 队列"是本地基础设施。**

理由：`memory-writer` 是**所有记忆落盘的收口**。团队化后，「谁写的、什么时候写的、基于哪个版本写的」必须可追溯；而 per-file 队列与原子写解决的是**单机**问题，跨机需要升级为"补丁 + 冲突检出"。⇒ 本模块是**团队同步的正确接线点**：所有本地写入都经过它，所以在这里加"写后投递补丁"是**一处接入、全路径覆盖**。

### Teamwork 改造方案

#### 改动点清单

| # | 位置 | 现状 | 改法 | 影响面 |
|---|---|---|---|---|
| W1 | `_commit(...)` L452 | 落盘 + backup 后返回 | 落盘成功后调用 `emitTeamPatchPre(...)` 投递变更 | 一处接入、全路径覆盖 |
| W2 | `_checkCommitBoundary` L396 | digest 不符即失败 | 增加"返回远端版本供合并"的结构化产物 | 返回值增字段 |
| W3 | `MemoryDocumentStore` L334 构造 | 无团队上下文 | 增加 `opts.actorId` / `opts.groupId` | 纯新增 |
| W4 | `_queue` L345 | 仅进程内串行 | 增加可选的**文件锁**（团队化后多实例） | 新增能力，默认关闭 |
| W5 | 新增 `applyRemotePatchPre` | 无 | 远程补丁应用入口（复用 `_commit` 事务） | 新增导出 |

#### 可直接落地的代码片段

**片段 1**：在 `_commit` 落盘成功后投递团队补丁。位置：`memory-writer.js:452`（`_commit` 内，backup 完成、返回成功之前）。

```js
  /**
   * ★ Teamwork：本地落盘成功后的团队补丁投递。
   * 放这里的理由：**所有写入路径都汇聚到 _commit**（append/replace/replaceSingle/applyPlan
   * 四个入口最终都走它）⇒ 一处接入即全路径覆盖，不会出现"某个入口漏投递"的半修状态。
   *
   * 三条纪律：
   *   1. **先落盘、后投递** —— 本地是权威，投递失败不得影响本地写入结果。
   *   2. **投递的是补丁而非全文** —— 全文会把整份 Markdown 反复搬运；补丁只需 {memoryId, op, body}。
   *   3. **投递失败必须留痕** —— 走 health，不得静默（沿用 hub-io.js 的纪律）。
   */
  function emitTeamPatchPre(file, op, payload) {
    if (!this._team || !this._team.stage) return { ok: true, skipped: 'team-disabled' }
    try {
      const r = this._team.stage({
        v: 1,
        entity: 'memory-doc',
        groupId: this._team.groupId,
        actorId: this._team.actorId || 'local',
        op: op,                                  // 'append' | 'replace' | 'replace-single' | 'apply-plan'
        payload: payload,                        // {memoryId, body, digestBefore, digestAfter}
        // 语义身份：团队各端绝对路径不同，必须用**相对化的 file key** 而不是绝对路径
        fileKey: String(this._team.relPathOf ? this._team.relPathOf(file) : file),
        at: Date.now(),
      })
      return (r && typeof r === 'object') ? r : { ok: true }
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : String(e)
      if (this._team.onError) { try { this._team.onError('memory-writer:team-stage', msg) } catch (_) {} }
      return { ok: false, error: msg }
    }
  }
```

**片段 2**：把片段 1 接进 `_commit`。位置：`memory-writer.js:452` 的 `_commit` 方法体末尾（成功返回之前）。

```js
    // ...原有逻辑：atomicReplace(target, data, fs) + backup...
    const _commitResult = { ok: true, digest: newDigest, backupPath: backupPath }

    // ★ Teamwork：落盘**已经**成功，此处投递团队补丁。
    //   注意顺序：绝不能把 emitTeamPatchPre 放在 atomicReplace 之前 —— 那样会出现
    //   "团队看到了、本地没写成"的假成功（对比 hub-io.js 修复前的"三条线全绿而磁盘没写上"）。
    emitTeamPatchPre.call(this, file, op, {
      memoryId: payload.memoryId || null,
      body: payload.body || null,
      digestBefore: payload.digestBefore || null,
      digestAfter: newDigest,
    })

    return _commitResult
```

**片段 3**：远程补丁应用（新增导出，放文件末尾）。**必须复用 `_commit` 事务，不得另写一套写盘。**

```js
/**
 * 应用一条来自团队的文档补丁。
 * 为什么不直接调 append/replace：那两个是"本地语义"入口，会带本地的 idFactory 与校验；
 * 远程补丁携带的是**远端已确定的 memoryId**，必须原样采纳（否则身份在两个端会漂移）。
 *
 * @param {MemoryDocumentStore} store
 * @param {object} patch {v, entity:'memory-doc', op, payload:{memoryId, body, digestBefore}, fileKey, actorId, at}
 * @param {string} targetFile 本机对应的真实路径（由 fileKey 解析而来）
 * @returns {Promise<{ok:boolean, outcome:string, error?:string}>}
 */
export async function applyRemotePatchPre(store, patch, targetFile) {
  if (!store || typeof store._commit !== 'function') return { ok: false, outcome: 'no-store' }
  if (!patch || patch.entity !== 'memory-doc' || patch.v !== 1) {
    return { ok: false, outcome: 'unsupported-patch', error: 'entity/v mismatch' }
  }
  const p = patch.payload || {}
  if (!p.body) return { ok: false, outcome: 'malformed', error: 'payload.body missing' }
  try {
    // 复用同一事务：读当前 state → 校验边界 → 落盘 → sidecar 重建
    const state = await store._readState(targetFile)
    // ① 远端 digestBefore 与本地当前不一致 ⇒ **不覆盖**，返回冲突让上层裁决
    if (p.digestBefore && state && state.digest && p.digestBefore !== state.digest) {
      return { ok: false, outcome: 'conflict', error: 'digest mismatch (remote base != local head)' }
    }
    await store._commit(targetFile, p.body, {
      source: 'team',
      actorId: String(patch.actorId || 'unknown'),
      skipTeamEmit: true,          // ② 防回流：远程补丁不得再次投递回团队（会形成回环）
    })
    return { ok: true, outcome: 'applied' }
  } catch (e) {
    return { ok: false, outcome: 'threw', error: (e && e.message) ? String(e.message) : String(e) }
  }
}
```

> **片段 3 的 `skipTeamEmit` 是必须的**：若不传，远程补丁落盘后会再次投递回团队 ⇒ A 收到 B 的补丁、落盘、又发回 B ⇒ **无限回环**。

### 风险与回归

| 风险 | 触发条件 | 缓解 |
|---|---|---|
| **同步回环** | 远程补丁再次投递 | 片段 3 的 `skipTeamEmit`；回归必须覆盖"applyRemotePatch 后 stage 未被调用" |
| **per-file 队列只保证进程内** | 两个 DSH 实例写同一文件 | W4 的文件锁；团队化前**必须实测该场景** |
| **digest 前置条件过严** | 团队高频写入导致大量 conflict | 需要合并策略（当前只有检出、无合并）【推断】 |
| **投递顺序错位** | 把 `emitTeamPatchPre` 放在落盘之前 | 片段 2 已显式注释顺序，回归覆盖"落盘失败时无投递" |
| **fileKey 用绝对路径** | 团队成员根目录不同 | 片段 1 用 `relPathOf` 相对化 |

**既有测试/守卫**：`memory-writer` 的 render→parse 幂等断言、`atomicReplace` 故障注入用例、sidecar 重建用例。本次为纯新增（投递 + 一个新导出），预计不红；但**若既有用例断言 `_commit` 的返回值 key 全等，会因新增字段而红**。
