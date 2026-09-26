/**
 * team-derived.js —— 派生数据的**去抖重算调度**（纯调度，B9）。
 *
 * ## 什么是「派生」
 * 团队线里有些数据不是用户直接写的，而是**从已有数据算出来的**：
 * 目录索引、工作区地图、看板汇总、冲突计数……它们共同的特征是：
 *   - 一次写盘往往连带影响多份派生结果（改一个键 ⇒ 三份索引都要重算）
 *   - 重算是纯计算，但**贵**（要遍历全部条目）
 * ⇒ 逐次重算会做大量无用功；完全不重算又会让派生数据过期。
 * 正确答案是**去抖 + 合并**：短时间内的多次请求合并成一次重算。
 *
 * ## 纪律（都是踩过的坑）
 *  1. `teamEnabled=false` ⇒ `schedule()` **零行为**（不建定时器、不调用 run）。
 *  2. 定时器**必须 unref()** —— 否则会拖住宿主进程退出。
 *  3. **maxWaitMs 上限**：纯去抖会被持续请求饿死（永远等不到静默期），
 *     所以「第一次请求」起计时，到点必须跑一次，不管后面还在不在请求。
 *  4. **单飞**：同一 key 在跑时不并发起第二次；跑完若期间又来请求，再补跑一次
 *     （不能丢最新状态）。
 *  5. `run` 抛错**不能**让调度器失效：记 lastError，继续工作。
 *  6. `stop()` 之后**不再有任何定时器与调用**。
 */

export const TEAM_DERIVED_DEFAULT_DEBOUNCE_MS = 2000
export const TEAM_DERIVED_DEFAULT_MAX_WAIT_MS = 10000

function toPositiveIntPre(v, dflt) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : dflt
}

export function createTeamDerived(options) {
  const opt = options || {}
  const debounceMs = toPositiveIntPre(opt.debounceMs, TEAM_DERIVED_DEFAULT_DEBOUNCE_MS)
  const maxWaitMs = toPositiveIntPre(opt.maxWaitMs, TEAM_DERIVED_DEFAULT_MAX_WAIT_MS)
  const runFn = typeof opt.run === 'function' ? opt.run : null
  const nowFn = typeof opt.now === 'function' ? opt.now : function () { return Date.now() }
  const setT = typeof opt.setTimeout === 'function' ? opt.setTimeout : setTimeout
  const clearT = typeof opt.clearTimeout === 'function' ? opt.clearTimeout : clearTimeout

  let stopped = false
  let timer = null
  // key → { firstAt, dirty, running }
  const slots = Object.create(null)
  const stats = { scheduled: 0, coalesced: 0, ran: 0, failed: 0, skipped: 0 }
  let lastError = ''
  let lastRunAt = 0

  function clearTimer() {
    if (timer !== null) { try { clearT(timer) } catch (_) {} timer = null }
  }

  function slotOf(key) {
    if (!slots[key]) slots[key] = { firstAt: 0, dirty: false, running: false }
    return slots[key]
  }

  /** 一次重算。**绝不抛**；失败只记账。 */
  async function fire(key) {
    const s = slots[key]
    if (!s) return { ok: false, reason: 'no-slot' }
    if (s.running) { s.dirty = true; return { ok: false, reason: 'in-flight' } }
    s.running = true
    s.dirty = false
    s.firstAt = 0
    try {
      if (runFn) await runFn(key)
      stats.ran += 1
      lastRunAt = nowFn()
      lastError = ''
      return { ok: true }
    } catch (e) {
      stats.failed += 1
      lastError = String((e && e.message) || e)
      return { ok: false, reason: 'run-threw' }
    } finally {
      s.running = false
      // 跑期间又有请求 ⇒ 立刻补跑一次（不丢最新状态）
      if (s.dirty && !stopped) {
        s.dirty = false
        Promise.resolve().then(function () { return fire(key) }).catch(function () {})
      }
    }
  }

  /**
   * 请求一次重算（去抖）。`enabled !== true` ⇒ **零行为**。
   * 返回 `{ ok, reason }`；绝不抛。
   */
  function schedule(key, enabled) {
    try {
      if (enabled !== true) { stats.skipped += 1; return { ok: false, reason: 'disabled' } }
      if (stopped) { stats.skipped += 1; return { ok: false, reason: 'stopped' } }
      const k = String(key || 'default')
      const s = slotOf(k)
      const t = nowFn()
      if (!s.firstAt) s.firstAt = t
      stats.scheduled += 1
      if (s.dirty || s.running || timer !== null) stats.coalesced += 1
      s.dirty = true
      // 纯去抖会被持续请求饿死 ⇒ 到 maxWaitMs 必须跑
      const waited = t - s.firstAt
      if (waited >= maxWaitMs) {
        clearTimer()
        Promise.resolve().then(function () { return fire(k) }).catch(function () {})
        return { ok: true, reason: 'max-wait' }
      }
      clearTimer()
      timer = setT(function () {
        timer = null
        const keys = Object.keys(slots)
        for (const kk of keys) {
          const ss = slots[kk]
          if (ss && ss.dirty) Promise.resolve().then(function () { return fire(kk) }).catch(function () {})
        }
      }, debounceMs)
      // ★必须 unref：否则定时器会拖住宿主进程退出
      if (timer && typeof timer.unref === 'function') timer.unref()
      return { ok: true, reason: 'debounced' }
    } catch (_) { return { ok: false, reason: 'threw' } }
  }

  /** 立即把所有脏 key 跑掉（不等待）。 */
  async function flush() {
    try {
      if (stopped) return { ok: false, reason: 'stopped', ran: 0 }
      clearTimer()
      const keys = Object.keys(slots).filter(function (k) { return slots[k] && slots[k].dirty })
      for (const k of keys) await fire(k)
      return { ok: true, ran: keys.length }
    } catch (_) { return { ok: false, reason: 'threw', ran: 0 } }
  }

  function stop() {
    try {
      stopped = true
      clearTimer()
      const keys = Object.keys(slots)
      for (const k of keys) { if (slots[k]) slots[k].dirty = false }
      return { ok: true, stopped: keys.length }
    } catch (_) { return { ok: false, stopped: 0 } }
  }

  function status() {
    try {
      const keys = Object.keys(slots)
      const dirty = keys.filter(function (k) { return slots[k] && slots[k].dirty }).length
      const running = keys.filter(function (k) { return slots[k] && slots[k].running }).length
      return {
        stopped: stopped, timerArmed: timer !== null, keys: keys.length,
        dirty: dirty, running: running,
        debounceMs: debounceMs, maxWaitMs: maxWaitMs,
        scheduled: stats.scheduled, coalesced: stats.coalesced,
        ran: stats.ran, failed: stats.failed, skipped: stats.skipped,
        lastRunAt: lastRunAt, lastError: lastError,
      }
    } catch (_) { return { stopped: true, timerArmed: false, keys: 0, dirty: 0, running: 0, debounceMs: debounceMs, maxWaitMs: maxWaitMs, scheduled: 0, coalesced: 0, ran: 0, failed: 0, skipped: 0, lastRunAt: 0, lastError: '' } }
  }

  function describe() {
    return { debounceMs: debounceMs, maxWaitMs: maxWaitMs, defaultDebounceMs: TEAM_DERIVED_DEFAULT_DEBOUNCE_MS, defaultMaxWaitMs: TEAM_DERIVED_DEFAULT_MAX_WAIT_MS }
  }

  return { schedule: schedule, flush: flush, stop: stop, status: status, describe: describe }
}
