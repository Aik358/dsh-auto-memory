/**
 * team-sync.js —— 团队版同步的**心跳 / 传输层**（客户端推送模型）。
 *
 * ## 背景
 * 团队版同步 = 「客户端推送 + 客户端拉取」，服务端**不主动推**。本模块只做传输层：
 * 按固定节奏把 B3 出站队列里排队的变更**批量发出**。**下行合并 / 冲突裁决是 B6**，本模块不实现。
 *
 * ## 设计约束（用户裁定 + 冻结书）
 *  1. **团队关闭 ⇒ 零行为**：`start()` 直接返回 —— 不建定时器、不联网、不读盘。
 *     这是 G-A1「teamEnabled=false ⇒ 与基线逐字节一致」的一部分：**不是内部判断，而是根本不启动**。
 *  2. **定时器必须 unref()** —— 心跳绝不能让进程无法退出（宿主退不掉的严重缺陷）。
 *  3. **单飞**：`tick()` 在途时再次调用 ⇒ 直接返回 `{skipped:true}`。
 *     ⚠️ 「检查 → 置位」之间**不得插入 await**（TOCTOU，本仓已踩过两次）。
 *     所有早退路径经**幂等释放函数**统一释放。
 *  4. **退避**：连续失败按 `base * 2^n` 递增，**设硬上限**，成功后**重置**。
 *     退避值可从 `status().nextDelayMs` 观测（可测性要求）。
 *  5. **绝不抛**：`tick()` 内任何异常 ⇒ 记 diag + 计入失败，不向外抛。
 *  6. **stop() 后静止**：停表后不得再有网络/落盘（防「停表后仍在途」的幽灵写入）。
 *
 * ## ★sender 契约（B3 明确补充，必须遵守）
 * `outbox.flush(sender)` 中：**sender「正常返回」即视为已发出、该条会被出队；
 * 若选择不发，必须 `throw`** —— 否则消息被静默丢弃。投递语义 = **at-least-once**。
 */

const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_BASE_DELAY_MS = 5000
const DEFAULT_MAX_DELAY_MS = 30000
const PUSH_PATH = 'api/team/sync/push'

export const TEAM_SYNC_DEFAULT_INTERVAL_MS_PRE = DEFAULT_INTERVAL_MS
export const TEAM_SYNC_BASE_DELAY_MS_PRE = DEFAULT_BASE_DELAY_MS
export const TEAM_SYNC_MAX_DELAY_MS_PRE = DEFAULT_MAX_DELAY_MS
export const TEAM_SYNC_PUSH_PATH_PRE = PUSH_PATH

function toText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try { return String(value) } catch (_) { return '' }
}

function safeGet(target, key) {
  try { return target === null || target === undefined ? undefined : target[key] } catch (_) { return undefined }
}

function safeDiag(diag, message) {
  try { if (typeof diag === 'function') diag(message) } catch (_) { /* diag 自身绝不外泄 */ }
}

function safeMessage(error) {
  if (error === null || error === undefined) return 'unknown'
  if (typeof error === 'string') return error
  try { return toText(safeGet(error, 'message')) || toText(error) } catch (_) { return 'unknown' }
}

function toPositiveInt(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function createTeamSync(options = {}) {
  const engine = options.engine || null
  const identity = options.identity || null
  const outbox = options.outbox || null
  const teamFetch = options.teamFetch || null
  const diag = options.diag
  const nowFn = typeof options.now === 'function' ? options.now : function () { return Date.now() }

  // —— 状态（全部私有；外部只能经 status() 只读观测）——
  let running = false
  let stopped = false
  let inFlight = false
  let timer = null
  let consecutiveFailures = 0
  let lastAt = 0
  let lastOk = null
  let lastError = ''
  let ticks = 0
  let sent = 0
  let failed = 0

  function configOf() { return safeGet(engine, 'config') }

  function enabled() {
    return safeGet(configOf(), 'teamEnabled') === true
  }

  function intervalMs() {
    return toPositiveInt(safeGet(configOf(), 'teamSyncIntervalMs'), DEFAULT_INTERVAL_MS)
  }

  /** 退避：连续失败 n 次 ⇒ base * 2^(n-1)，封顶 max。成功 ⇒ 重置为 0（返回 base）。 */
  function nextDelayMs() {
    const base = intervalMs()
    if (consecutiveFailures <= 0) return base
    // ★ 2^n（不是 2^(n-1)）：首次失败就必须**看到**退避增长，否则 n=1 时等于基线、
    //   退避形同虚设（本断言实测抓到过）。上限 2^16 再封顶 MAX_DELAY。
    const factor = Math.pow(2, Math.min(consecutiveFailures, 16))
    const raw = base * factor
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_DELAY_MS
    return Math.min(raw, DEFAULT_MAX_DELAY_MS)
  }

  /** 幂等释放：无论从哪条早退路径离开 tick，都走这里。 */
  function release() { inFlight = false }

  /**
   * 组装 sender —— 逐条投递。
   * ★「不发」必须 throw，否则该条会被 outbox 当作成功而出队（丢消息）。
   */
  function makeSender() {
    return async function senderPre(entry) {
      // ★顺序：先本地前置条件（身份），再传输能力（teamFetch）。
      //   否则 teamFetch 缺失会掩盖真正的「未登记身份」，排障被指向错误方向。
      // 未登记身份 ⇒ 不发（必须 throw，不能静默出队）
      let member = null
      try {
        if (identity && typeof identity.currentMember === 'function') member = identity.currentMember()
      } catch (error) {
        throw new Error('identity-unavailable: ' + safeMessage(error))
      }
      if (!member || member.ok !== true) {
        throw new Error('identity-not-registered')
      }
      if (typeof teamFetch !== 'function') throw new Error('team-fetch-unavailable')
      const payload = {
        kind: toText(safeGet(entry, 'kind')),
        key: toText(safeGet(entry, 'key')),
        at: safeGet(entry, 'at'),
        payload: safeGet(entry, 'payload'),
        member: { id: toText(safeGet(member, 'id')), role: toText(safeGet(member, 'role')) },
      }
      const res = await teamFetch(PUSH_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res || res.ok !== true) {
        throw new Error('push-failed: ' + (toText(safeGet(res, 'reason')) || 'unknown'))
      }
      return true
    }
  }

  /**
   * 单次同步。**绝不抛**。
   * ★单飞：「检查 → 置位」之间**没有 await**（TOCTOU 纪律）。
   */
  async function tick() {
    if (!enabled()) return { skipped: true, reason: "team-disabled" }
    if (inFlight) return { skipped: true, reason: "in-flight" }
    inFlight = true // 紧贴检查、此处无 await
    ticks += 1
    lastAt = nowFn()
    try {
      if (!outbox || typeof outbox.flush !== "function") throw new Error("outbox-unavailable")
      const result = await outbox.flush(makeSender())
      const sentN = toPositiveInt(safeGet(result, "sent"), 0)
      const failedN = toPositiveInt(safeGet(result, "failed"), 0)
      sent += sentN
      failed += failedN
      // ★★ 关键判据：`flush` **不抛**只代表队列服务正常，不代表投递成功。
      //   若 failed > 0（条目级失败），**必须计失败并让退避增长** —— 否则
      //   「每条都被对端拒绝」的场景下退避恒被重置，会以固定间隔死打网络。
      if (failedN > 0) {
        consecutiveFailures += 1
        lastOk = null
        lastError = "entries-failed:" + failedN
        safeDiag(diag, "team-sync partial failure: " + failedN + " entries (consecutive=" + consecutiveFailures + ")")
        return { skipped: false, sent: sentN, failed: failedN }
      }
      consecutiveFailures = 0 // 全部成功才重置退避
      lastOk = nowFn()
      lastError = ""
      return { skipped: false, sent: sentN, failed: failedN }
    } catch (error) {
      consecutiveFailures += 1
      lastOk = null
      lastError = safeMessage(error)
      safeDiag(diag, "team-sync tick failed (#" + consecutiveFailures + "): " + lastError)
      return { skipped: false, sent: 0, failed: 1, error: lastError }
    } finally {
      release() // 幂等释放：含 throw 在内的一切路径都经此
    }
  }

  /** 排下一次（退避值取自 nextDelayMs）。仅内部调用。 */
  function scheduleNext() {
    if (!running || stopped) return
    const delay = nextDelayMs()
    try {
      timer = setTimeout(function onTickPre() {
        timer = null
        Promise.resolve()
          .then(function () { return tick() })
          .catch(function (error) { safeDiag(diag, "team-sync loop: " + safeMessage(error)) })
          .then(function () { scheduleNext() })
      }, delay)
      if (timer && typeof timer.unref === "function") timer.unref() // 心跳不得阻止进程退出
    } catch (error) {
      safeDiag(diag, "team-sync schedule: " + safeMessage(error))
      timer = null
    }
  }

  /** 启动心跳。**幂等**；团队关闭 ⇒ 零行为（不建表、零 IO）。 */
  function start() {
    if (!enabled()) return { ok: false, reason: "team-disabled", running: false }
    if (running && timer) return { ok: true, reason: "already-running", running: true }
    stopped = false
    running = true
    scheduleNext()
    return { ok: true, running: true, intervalMs: intervalMs() }
  }

  /** 停表 + 清理。**幂等**；停后再 start 可恢复。 */
  function stop() {
    running = false
    stopped = true
    if (timer) {
      try { clearTimeout(timer) } catch (_) { /* 忽略 */ }
      timer = null
    }
    return { ok: true, running: false, inFlight: inFlight }
  }

  /** 只读快照，**无副作用**。 */
  function status() {
    return {
      running: running,
      inFlight: inFlight,
      ticks: ticks,
      sent: sent,
      failed: failed,
      lastAt: lastAt,
      lastOk: lastOk,
      lastError: lastError,
      consecutiveFailures: consecutiveFailures,
      nextDelayMs: nextDelayMs(),
      intervalMs: intervalMs(),
    }
  }

  return { start: start, stop: stop, tick: tick, status: status }
}
