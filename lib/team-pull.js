/**
 * team-pull.js —— 团队**下行驱动器**（纯逻辑 + 依赖注入）。
 *
 * ## 为什么是「依赖注入」而不是直接调引擎（03 卷伪代码的修正）
 * 03 卷 §2.3 的设计判据是「**下行数据必须走既有的、带校验的写路径，不得绕过 Gate**」。
 * 但该卷伪代码里写的三个接缝（`_appendHandoffPre` / `_notifyConflictPre` / `_actorNamePre`）
 * 在今日代码里**均不存在**（实测 0 命中，见 61 卷 §一）。
 *
 * ⇒ 本实现改为**把写路径注入进来**（`appliers`），本模块：
 *   · 不 import `node:fs` / `node:path` ⇒ **结构上无法直接写盘**
 *   · 不持有任何引擎内部名字 ⇒ 引擎改名不会静默失效
 *   · 不发起网络 ⇒ `fetchJson` 由装配层注入
 * 这比「约定不要绕过」更强：**没有工具可绕**。
 *
 * ## 纪律
 *  1. **绝不抛**：任何畸形输入降级为「拒绝 + 留痕」，不中断整批。
 *  2. **未知 kind 不猜不写**：返回 false 并 diag（06 卷 B6 判据 3）。
 *  3. **拒绝可见**：被既有校验拒掉的条目必须进 conflictCenter（判据 4），否则「静默丢数据」。
 *  4. **幂等/防重入**：`inflight` 期间再次调用直接返回 `{ok:false, reason:'inflight'}`。
 *  5. **暂时失败不推进游标**：成功项防重放；永久拒绝（含未装配类型）留痕后可跨过。
 */

/** 已知的变更类型（与 03 卷 §2.3 的 `switch` 逐条一致）。 */
import { createHash } from 'node:crypto'

export const TEAM_PULL_KINDS_PRE = ['fact', 'procedure', 'handoff']

function canonicalChange(value) {
  if (Array.isArray(value)) return value.map(canonicalChange)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalChange(value[key])]))
}

/**
 * 创建下行驱动器。
 *
 * @param {Object} opt
 *   - opt.engine        : 只读用（读 `config.teamEnabled` 等）；可为 null
 *   - opt.fetchJson     : async (path) => { ok, data?, error? } —— 由装配层注入
 *   - opt.conflictCenter: 冲突中心（team-merge 实例）；可为 null
 *   - opt.appliers      : { fact?, procedure?, handoff? } —— **写路径**，由 index.js 装配
 *   - opt.onApplied     : (entry) => void —— 落盘成功后回调（供 team-attribution 记作者）
 *   - opt.diag          : (msg) => void
 *   - opt.now           : () => number
 */
export function createTeamPuller(options) {
  const opt = options || {}
  const engine = opt.engine || null
  const fetchJson = typeof opt.fetchJson === 'function' ? opt.fetchJson : null
  const conflictCenter = opt.conflictCenter || null
  const appliers = opt.appliers && typeof opt.appliers === 'object' ? opt.appliers : {}
  const onApplied = typeof opt.onApplied === 'function' ? opt.onApplied : null
  const diagFn = typeof opt.diag === 'function' ? opt.diag : null
  const nowFn = typeof opt.now === 'function' ? opt.now : function () { return Date.now() }

  let since = 0
  let inflight = false
  let lastError = ''
  let lastAt = 0
  let retryable = false
  let duplicate = false
  // Keep successful entries while a page is retried. File-backed fact appliers
  // also commit this identity with the mutation, covering process restarts.
  const completed = new Set()
  const stats = { runs: 0, pulled: 0, applied: 0, rejected: 0, unknown: 0 }

  /** diag 安全包装：诊断自身绝不抛。 */
  function diag(msg) {
    try { if (diagFn) diagFn(String(msg)) } catch (_) { /* 绝不抛 */ }
  }

  /** 团队是否开启（关掉 ⇒ 零行为，与其他 team 模块同源判据）。 */
  function enabled() {
    try {
      if (!engine || !engine.config) return false
      return engine.config.teamEnabled === true && engine._teamDisposed !== true
    } catch (_) { return false }
  }

  /**
   * 记录一条「被拒」——**判据 4：拒绝可见**。
   * 走 conflictCenter 的 recordRejected（team-merge 提供）；缺失时退回 diag。
   * 绝不抛。
   */
  function noteRejected(reason, detail) {
    stats.rejected += 1
    try {
      if (conflictCenter && typeof conflictCenter.recordRejected === 'function') {
        conflictCenter.recordRejected(1, reason, detail)
        return
      }
    } catch (_) { /* 落到 diag */ }
    diag('pull rejected: ' + String(reason) + (detail ? ' | ' + String(detail) : ''))
  }

  /**
   * 应用单条变更。**判据 1：不绕过 Gate** —— 只转调注入的 applier。
   *
   * @returns {boolean} true=已应用；false=被拒（**正常业务结果，不是错误**）
   */
  function applyOne(ch, changeId) {
    retryable = false
    duplicate = false
    if (!ch || typeof ch !== 'object') { noteRejected('bad-change'); return false }
    const kind = String(ch.kind || '')
    if (!kind) { noteRejected('no-kind'); return false }

    // 判据 3：未知 kind ⇒ 不猜、不写、留痕
    if (TEAM_PULL_KINDS_PRE.indexOf(kind) < 0) {
      stats.unknown += 1
      diag('pull unknown-kind: ' + kind)
      noteRejected('unknown-kind', kind)
      return false
    }

    const apply = appliers[kind]
    if (typeof apply !== 'function') {
      // Missing capability is terminal for this wiring, not a transient IO
      // failure. Record rejection and let supported later pages progress.
      diag('pull no-applier: ' + kind)
      noteRejected('no-applier', kind)
      return false
    }

    let res = null
    try { res = apply(ch.payload, ch, changeId) } catch (e) {
      noteRejected('applier-threw', kind + ': ' + ((e && e.message) || e))
      retryable = true
      return false
    }

    // 判据 1：既有校验说不行 ⇒ 计数并留痕，**不写盘**
    if (res && (res.ok === false || res.persisted === false)) {
      // Only explicit validation refusals are terminal. IO/lock failures and
      // unknown errors must be retried before advancing the batch cursor.
      const permanent = /^(?:invalid:|fact-invalid:|procedure-invalid:|not-object$|not-a-fact-statement$|bad-evidence$)/.test(String(res.reason || ''))
      retryable = res.persisted === false || !permanent
      noteRejected(retryable ? 'apply-retry' : 'gate-rejected', kind + ': ' + String(res.reason || res.error || 'not-persisted'))
      return false
    }
    // applier 返回 undefined/null ⇒ 视为「没有这条写路径」而非成功（防假绿）
    if (res === undefined || res === null) {
      noteRejected('no-result', kind)
      retryable = true
      return false
    }
    if (res.outcome === 'remote-duplicate') { duplicate = true; return true }

    // 判据 2：冲突 ⇒ 进冲突中心（双方 provenance 由 team-merge 保留）
    try {
      if (res.outcome === 'conflict-added' && conflictCenter && typeof conflictCenter.addConflicts === 'function') {
        // ★兼容两种真实形状：factStore.upsert 返回**单体** `conflict`（fact-store.js:474 逐字）；注入桩可给数组。
        const list = Array.isArray(res.conflicts) ? res.conflicts
          : (res.conflict && typeof res.conflict === 'object' ? [res.conflict] : [])
        const member = ch.member || (res.member || null)
        const normalized = kind === 'fact' ? list.map(c => c.conflictId ? { key: c.conflictId, base: c.base, local: c.left, remote: c.right } : c) : list
        conflictCenter.addConflicts(kind, normalized, { member: member ? (member.id || member) : '' })
      }
    } catch (_) { /* 冲突登记失败不影响「已应用」判定 */ }

    stats.applied += 1

    // ★37 卷 §1 联动：把作者交给归属旁挂索引
    try {
      if (onApplied && ch.key) {
        onApplied({ key: ch.key, member: ch.member || res.member || null, op: ch.op || kind })
      }
    } catch (_) { /* 归属登记失败不影响主流程 */ }

    return true
  }

  /**
   * 拉一次增量。返回 `{ ok, changed, applied, rejected, unknown }`；**永不抛**。
   *
   * 游标跨过成功项和永久拒绝；暂时失败重试时跳过本页已完成项。
   */
  async function pullOnce() {
    if (!enabled()) return { ok: false, reason: 'team-disabled' }
    if (engine._teamPaused === true) return { ok: false, reason: 'team-paused' }
    if (inflight) return { ok: false, reason: 'inflight' }
    if (typeof fetchJson !== 'function') return { ok: false, reason: 'no-fetch' }

    const epoch = engine._teamEpoch || 0
    inflight = true
    stats.runs += 1
    try {
      const r = await fetchJson('/v1/changes?since=' + since)
      if (!enabled() || engine._teamPaused || (engine._teamEpoch || 0) !== epoch) return { ok: false, reason: 'team-request-invalidated' }
      if (!r || r.ok !== true) {
        lastError = String((r && r.error) || 'fetch-failed')
        diag('pull failed: ' + lastError)
        return { ok: false, reason: lastError }
      }

      const data = r.data && typeof r.data === 'object' ? r.data : {}
      const changes = Array.isArray(data.changes) ? data.changes : []
      let applied = 0
      let rejected = 0
      let retry = false
      const appliedEntries = []

      for (let i = 0; i < changes.length; i++) {
        if (!enabled() || engine._teamPaused || (engine._teamEpoch || 0) !== epoch) return { ok: false, reason: 'team-request-invalidated' }
        const ch = changes[i]
        // Prefer remote event/revision identity. Legacy feeds without one are
        // identified by their replay position and content, not just fact key.
        const identity = ch && (ch.id ?? ch.changeId ?? ch.revision)
        const changeId = createHash('sha256').update(JSON.stringify([
          engine.config.teamServerUrl || '', engine.config.teamId || '',
          identity == null ? [since, i] : identity, canonicalChange(ch),
        ])).digest('hex')
        if (completed.has(changeId)) continue
        const okOne = applyOne(ch, changeId)
        retry = retry || retryable
        if (!retryable) completed.add(changeId)
        if (okOne && !duplicate) {
          applied += 1
          appliedEntries.push(ch)
        } else if (!okOne) rejected += 1
      }

      stats.pulled += changes.length

      // A diagnostic rejection record is not a durable retry queue.
      const cursor = Number(data.cursor)
      if (!retry && Number.isFinite(cursor) && cursor > since) { since = cursor; completed.clear() }

      lastAt = nowFn()
      lastError = retry ? 'apply-retry' : ''

      return {
        ok: !retry,
        ...(retry ? { reason: 'apply-retry' } : {}),
        changed: applied > 0,
        applied: applied,
        rejected: rejected,
        unknown: stats.unknown,
        total: changes.length,
        appliedEntries: appliedEntries,
        since: since,
      }
    } catch (e) {
      lastError = String((e && e.message) || e)
      diag('pull threw: ' + lastError)
      return { ok: false, reason: lastError }
    } finally {
      inflight = false   // 幂等释放：含 throw 在内的一切路径都经此
    }
  }

  /** 只读快照，**无副作用**（与 team-sync 的 status 同形，便于 /team-sync-debug 汇总）。 */
  function status() {
    return {
      kind: 'team-pull',
      enabled: enabled(),
      since: since,
      inflight: inflight,
      lastAt: lastAt,
      lastError: lastError,
      stats: Object.assign({}, stats),
      kinds: TEAM_PULL_KINDS_PRE.slice(),
    }
  }

  /** 复位游标（测试与「强制全量重拉」用）。 */
  function reset() {
    if (inflight) return { ok: false, reason: 'inflight' }
    const prev = since
    since = 0
    completed.clear()
    lastError = ''
    return { ok: true, prev: prev }
  }

  function describe() {
    return {
      kinds: TEAM_PULL_KINDS_PRE.slice(),
      appliers: Object.keys(appliers),
      hasFetch: typeof fetchJson === 'function',
      hasConflictCenter: !!conflictCenter,
    }
  }

  return {
    pullOnce: pullOnce,
    applyOne: applyOne,
    status: status,
    reset: reset,
    describe: describe,
  }
}
