/**
 * 冲突提醒的**持久化滑动窗口**（1.2 第6步，2026-11-09）。
 *
 * 为什么需要它（用户裁定原话）：「一次性状态确实是正确的，但是我觉得还是得记，
 *   不过是一个滑动的窗口」——若只放内存，宿主重启后已提醒状态丢失 ⇒ 同一条冲突
 *   被反复提醒 ⇒ 用户反复看到同一个问题。
 *
 * 语义：同一条冲突对**同一会话**最多提醒 MAX_TIMES 次；之后不再主动提醒（仍可在
 *   面板看到、仍可用 memory_conflict 查）。窗口上限 CAP，按 lastAt 最旧淘汰。
 *
 * 纯状态机 + 可注入 IO（与 fact-store 同风格）：本模块不直接读写磁盘。
 * 损坏的持久化内容一律 fail-soft 视为空（最坏是多提醒一次，绝不崩）。
 */

export const CONFLICT_REMINDER_SCHEMA_PRE_V1 = 'dsh-auto-memory-conflict-reminders'
export const CONFLICT_REMINDER_CAP_PRE_V1 = 256
export const CONFLICT_REMINDER_MAX_TIMES_PRE_V1 = 2

/** 幂等键：一条冲突 × 一个会话。 */
function keyOfPre(conflictId, sessionId) {
  return String(conflictId || '') + '|' + String(sessionId || '')
}

export function createConflictRemindersPre(opts = {}) {
  const io = opts.io || { save() {}, load() { return null }, clear() {} }
  const cap = Math.max(1, Number(opts.cap) || CONFLICT_REMINDER_CAP_PRE_V1)
  const maxTimes = Math.max(1, Number(opts.maxTimes) || CONFLICT_REMINDER_MAX_TIMES_PRE_V1)
  const nowFn = typeof opts.now === 'function' ? opts.now : () => Date.now()

  /** @type {Map<string, {key:string, conflictId:string, sessionId:string, count:number, lastAt:number}>} */
  let entries = new Map()
  let hydrated = false
  let dirty = false
  let dropped = 0
  let lastEvict = null
  const stats = { reminded: 0, suppressed: 0, evicted: 0, restored: 0 }

  function ensure() {
    if (hydrated) return
    hydrated = true
    let raw = null
    try { raw = io.load() } catch (_) { raw = null }
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return
    for (const e of raw.entries) {
      if (!e || typeof e !== 'object') continue
      const cid = String(e.conflictId || '')
      const sid = String(e.sessionId || '')
      if (!cid) continue
      const k = keyOfPre(cid, sid)
      const count = Math.max(0, Math.floor(Number(e.count) || 0))
      if (count <= 0) continue
      entries.set(k, { key: k, conflictId: cid, sessionId: sid, count, lastAt: Number(e.lastAt) || 0 })
    }
    stats.restored = entries.size
    // 装载后也要收敛到 cap（旧文件可能来自更大的 cap）
    trim()
  }

  function trim() {
    if (entries.size <= cap) return
    const list = Array.from(entries.values()).sort((a, b) => (a.lastAt || 0) - (b.lastAt || 0))
    const drop = entries.size - cap
    for (let i = 0; i < drop; i++) {
      const e = list[i]
      if (!e) break
      entries.delete(e.key)
      stats.evicted += 1
    }
    lastEvict = { at: nowFn(), evicted: drop, cap }
    dirty = true
  }

  function snapshot() {
    ensure()
    return {
      schemaVersion: 1,
      namespace: CONFLICT_REMINDER_SCHEMA_PRE_V1,
      cap,
      maxTimes,
      savedAt: nowFn(),
      entries: Array.from(entries.values()).map((e) => ({ conflictId: e.conflictId, sessionId: e.sessionId, count: e.count, lastAt: e.lastAt })),
    }
  }

  /** 是否还可以提醒（不改状态）。 */
  function shouldRemind(conflictId, sessionId) {
    ensure()
    const e = entries.get(keyOfPre(conflictId, sessionId))
    if (!e) return true
    return e.count < maxTimes
  }

  /** 记账一次提醒（只有真投递了才调）。 */
  function markReminded(conflictId, sessionId) {
    ensure()
    const cid = String(conflictId || '')
    if (!cid) return 0
    const sid = String(sessionId || '')
    const k = keyOfPre(cid, sid)
    const at = nowFn()
    const prev = entries.get(k)
    const next = { key: k, conflictId: cid, sessionId: sid, count: (prev ? prev.count : 0) + 1, lastAt: at }
    entries.set(k, next)
    stats.reminded += 1
    dirty = true
    trim()
    persist()
    return next.count
  }

  /** 冲突被裁定/消失 ⇒ 清掉它的全部会话记账（避免残留 + 回收窗口）。 */
  function dropConflict(conflictId) {
    ensure()
    const cid = String(conflictId || '')
    if (!cid) return 0
    let n = 0
    for (const [k, e] of Array.from(entries.entries())) {
      if (e.conflictId === cid) { entries.delete(k); n += 1 }
    }
    if (n) { dropped += n; dirty = true; persist() }
    return n
  }

  /** 只保留仍然待裁定的冲突的记账（resolve 全部后清空）。 */
  function retainOnly(conflictIds) {
    ensure()
    const keep = new Set((conflictIds || []).map((x) => String(x)))
    let n = 0
    for (const [k, e] of Array.from(entries.entries())) {
      if (!keep.has(e.conflictId)) { entries.delete(k); n += 1 }
    }
    if (n) { dropped += n; dirty = true; persist() }
    return n
  }

  function persist() {
    if (!dirty) return
    dirty = false
    try { io.save(snapshot()) } catch (_) {}
  }

  function getStats() {
    ensure()
    return { ...stats, entries: entries.size, cap, maxTimes, dropped, lastEvict }
  }

  return {
    shouldRemind, markReminded, dropConflict, retainOnly, persist,
    snapshot, getStats,
    get size() { ensure(); return entries.size },
    get cap() { return cap },
    get maxTimes() { return maxTimes },
    reset() { entries = new Map(); hydrated = true; dirty = true; persist() },
  }
}
