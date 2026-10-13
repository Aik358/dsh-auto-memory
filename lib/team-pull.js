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
 *  5. **游标只在整批成功后前进**：失败不推进 `since`，下次可重试。
 *     ★#343（2026-10-13）细化：**临时失败**（EACCES/写事务失败/锁被占等可自愈原因）一律不推进
 *     `since` 且回 ok:false（可重试）；只有**业务拒绝**（未知 kind / 门拒绝 / 畸形数据）才照旧前进
 *     —— 后者重拉结果完全一样，拦着游标只会死循环重放。判据见 classifyFailurePre。
 */

/** 已知的变更类型（与 03 卷 §2.3 的 `switch` 逐条一致）。 */
export const TEAM_PULL_KINDS_PRE = ['fact', 'procedure', 'handoff']

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
  const stats = { runs: 0, pulled: 0, applied: 0, rejected: 0, unknown: 0, deferred: 0, transientFailures: 0 }

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
   * ★#343（2026-10-13）：**区分「临时失败」与「不可接受的业务数据」**。
   *
   * 为什么必须区分：游标只在整批成功后前进，前提是「这次失败下次重试会变好」。
   *   · **业务拒绝**（未知 kind / 无 applier / 门拒绝 / 数据畸形）重拉一百次结果一样 ⇒
   *     拦着游标不动只会让同一批永远重放（本仓既有的「死循环重拉」教训）⇒ 可以前进。
   *   · **临时失败**（EACCES/EPERM/EBUSY/EIO/ENOSPC、写事务失败/超时、锁被占）是**可自愈**的 ⇒
   *     此时若照旧前进游标，这批变更就**永远不会被重放**，调用方还会因为 ok:true 以为已落盘。
   *     报告症状：一次 EACCES 之后就算故障恢复，普通下一次 pull（不 reset）也再也补不回来。
   *
   * 判据取**结构化错误码**（res.code / res.reason / res.errorCode / res.fsCode / err.code），
   *   而不是猜错误文案：已知临时码 ⇒ 临时；已知业务码 ⇒ 业务；**未识别 ⇒ 偏向临时**
   *   （宁可不前进游标去重放，也不静默丢数据 —— 重放由服务端 kind+key 幂等兜底，
   *     这正是本模块既有的 at-least-once 契约）。
   *
   * @returns {{transient:boolean, code:string}}
   */
  function classifyFailurePre(res, err) {
    const TRANSIENT = { EACCES: 1, EPERM: 1, EBUSY: 1, EIO: 1, EAGAIN: 1, EMFILE: 1, ENFILE: 1, ENOSPC: 1, ETIMEDOUT: 1, EDEADLK: 1, EROFS: 1 }
    const TRANSIENT_NAMES = {
      'write-failed': 1, 'write-transaction-failed': 1, 'transaction-failed': 1, 'lock-busy': 1,
      'state-lock-busy': 1, 'outbox-persist-failed': 1, 'drain-persist-failed': 1, 'timeout': 1,
      'busy': 1, 'retry': 1, 'retryable': 1, 'unavailable': 1, 'temp-failure': 1,
    }
    const BUSINESS = {
      'gate-rejected': 1, 'policy-rejected': 1, 'conflict': 1, 'conflict-added': 1,
      'validation-failed': 1, 'invalid': 1, 'bad-change': 1, 'no-kind': 1, 'unknown-kind': 1,
      'no-applier': 1, 'no-result': 1, 'not-found': 1, 'denied': 1, 'forbidden': 1, 'duplicate': 1,
    }
    const codes = []
    const push = (v) => { if (typeof v === 'string' && v && codes.indexOf(v) < 0) codes.push(v) }
    if (res && typeof res === 'object') { push(res.code); push(res.reason); push(res.errorCode); push(res.fsCode) }
    if (err && typeof err === 'object') { push(err.code); push(err.fsCode) }
    for (let i = 0; i < codes.length; i++) { if (TRANSIENT[codes[i]] || TRANSIENT_NAMES[codes[i]]) return { transient: true, code: codes[i] } }
    for (let i = 0; i < codes.length; i++) { if (BUSINESS[codes[i]]) return { transient: false, code: codes[i] } }
    return { transient: true, code: codes[0] || 'unclassified' }
  }

  /**
   * 应用单条变更。**判据 1：不绕过 Gate** —— 只转调注入的 applier。
   *
   * ★#343 起返回值升级为结构化对象（`applyOne` 这个**对外的**同名方法仍回 boolean，
   *   逐字保持既有调用契约；pullOnce 用本函数以拿到临时/业务判据）。
   *
   * @returns {{ok:boolean, transient?:boolean, code?:string}} true=已应用；false=被拒
   */
  function applyOneEx(ch) {
    if (!ch || typeof ch !== 'object') { noteRejected('bad-change'); return { ok: false, transient: false, code: 'bad-change' } }
    const kind = String(ch.kind || '')
    if (!kind) { noteRejected('no-kind'); return { ok: false, transient: false, code: 'no-kind' } }

    // 判据 3：未知 kind ⇒ 不猜、不写、留痕（业务拒绝：重拉也不会变）
    if (TEAM_PULL_KINDS_PRE.indexOf(kind) < 0) {
      stats.unknown += 1
      diag('pull unknown-kind: ' + kind)
      noteRejected('unknown-kind', kind)
      return { ok: false, transient: false, code: 'unknown-kind' }
    }

    const apply = appliers[kind]
    if (typeof apply !== 'function') {
      // 装配层没给 ⇒ 拒绝（**不 fallback 到自写**，否则就等于绕过 Gate）
      diag('pull no-applier: ' + kind)
      noteRejected('no-applier', kind)
      return { ok: false, transient: false, code: 'no-applier' }
    }

    let res = null
    try { res = apply(ch.payload, ch) } catch (e) {
      // ★#343：applier 抛错可能是**临时**的（EACCES 等）⇒ 交给统一判据，不再一律当业务拒绝。
      const cls = classifyFailurePre(null, e)
      noteRejected('applier-threw', kind + ': ' + ((e && e.message) || e))
      return { ok: false, transient: cls.transient, code: cls.code }
    }

    // 判据 1：既有校验说不行 ⇒ 计数并留痕，**不写盘**
    if (res && res.ok === false) {
      // ★#343：门拒绝**也可能携带临时码**（写事务失败 / 锁被占 / 磁盘 EACCES）⇒ 先分类。
      const cls = classifyFailurePre(res, null)
      noteRejected('gate-rejected', kind)
      return { ok: false, transient: cls.transient, code: cls.code || 'gate-rejected' }
    }
    // applier 返回 undefined/null ⇒ 视为「没有这条写路径」而非成功（防假绿）
    if (res === undefined || res === null) {
      noteRejected('no-result', kind)
      return { ok: false, transient: false, code: 'no-result' }
    }

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

    return { ok: true, code: 'applied' }
  }

  /**
   * **对外同名方法**：保持既有 boolean 契约逐字不变（index.js 与既有套件都按 true/false 读）。
   * ★#343 起内部走 applyOneEx 拿到「临时/业务」判据，本包装只做 boolean 投影。
   */
  function applyOne(ch) {
    try { return applyOneEx(ch).ok === true } catch (_) { return false }
  }

  /**
   * 拉一次增量。返回 `{ ok, changed, applied, rejected, unknown, deferred? }`；**永不抛**。
   *
   * ★#343（2026-10-13）游标语义修正 —— 按**失败性质**分流，不再「部分失败也一律前进」：
   *   · 全部条目都被**业务拒绝**（未知 kind / 无 applier / 门拒绝 / 畸形）⇒ 照旧前进游标：
   *     重拉同一批结果完全一样，拦着不动只会死循环重放（既有教训），且拒绝已通过 conflictCenter 留痕。
   *   · 出现任意一条**临时失败**（EACCES/EPERM/EBUSY/EIO/ENOSPC、写事务失败、锁被占…）⇒
   *     **游标一律不前进**，并如实回 ok:false 供调用方重试 —— 否则这批变更永远不再重放，
   *     而调用方还会以为已经落盘（报告症状：一次 EACCES 后恢复，普通下一次 pull 不 reset 就补不回来）。
   *   · 已成功应用的条目**保持幂等**：下次重放同一批时，applier 侧按 kind+key 幂等兜底
   *     （本模块既有的 at-least-once 契约），不会因为重放而重复写入。
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
      let deferred = 0
      const appliedEntries = []
      const deferredCodes = []

      for (let i = 0; i < changes.length; i++) {
        if (!enabled() || engine._teamPaused || (engine._teamEpoch || 0) !== epoch) return { ok: false, reason: 'team-request-invalidated' }
        const ch = changes[i]
        const one = applyOneEx(ch)
        if (one.ok === true) {
          applied += 1
          appliedEntries.push(ch)
        } else if (one.transient === true) {
          // ★#343：临时失败 ⇒ 本批不可推进游标；如实计数 + 把错误码带进返回值/诊断
          deferred += 1
          if (deferredCodes.indexOf(one.code) < 0) deferredCodes.push(one.code)
        } else rejected += 1
      }

      stats.pulled += changes.length

      // ★#343：有临时失败 ⇒ 游标**停住**（下次从同一 since 重拉），并明确回 ok:false 供调用方重试。
      if (deferred > 0) {
        stats.deferred += deferred
        stats.transientFailures += deferred
        lastError = 'transient-failure: ' + deferredCodes.join(',')
        diag('pull deferred ' + deferred + ' transient failure(s): ' + deferredCodes.join(',') + ' (cursor NOT advanced; retry)')
        return {
          ok: false,
          reason: lastError,
          retryable: true,
          changed: applied > 0,
          applied: applied,
          rejected: rejected,
          deferred: deferred,
          deferredCodes: deferredCodes,
          unknown: stats.unknown,
          total: changes.length,
          appliedEntries: appliedEntries,
          since: since,   // 未前进（逐字证明「游标没动」）
        }
      }

      // 游标前进（被拒项已通过 conflictCenter 留痕：重拉同一批没有意义）
      const cursor = Number(data.cursor)
      if (Number.isFinite(cursor)) since = cursor

      lastAt = nowFn()
      lastError = ''

      return {
        ok: true,
        changed: applied > 0,
        applied: applied,
        rejected: rejected,
        deferred: 0,
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
