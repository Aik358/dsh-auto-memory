/**
 * team-merge.js —— 下行合并的三方判定 + 冲突中心（**纯内存、纯函数**）。
 *
 * ## 为什么不是 migrate-pack.js 的 calendarMergePre
 * 那个是**包级整体合并**（同步包落地时把整篇日历并起来），粒度是「文件」。
 * 团队同步要的是**条目级三方合并**（同一条日历/白板条目，本机改了、对端也改了），
 * 粒度是「键」，且必须能产出**可裁决的冲突记录** ⇒ 两者不是同一层，不能复用。
 *
 * ## 三方合并语义（每键）
 *   base=b, local=l, remote=r（任一可为 undefined）
 *     l === r          ⇒ noop          （两边已收敛）
 *     l === b          ⇒ take-remote   （只有对端改了）
 *     r === b          ⇒ keep-local    （只有本机改了）
 *     其它             ⇒ conflict      （两边都改且不同 ⇒ 需人工）
 *   base 里没有、只有一边有的键：直接采纳该边（不算冲突）。
 *
 * ## 纪律
 *  1. **绝不抛**：任何畸形输入降级为「全 keep-local」，宁可不动也不误删。
 *  2. **纯内存**：不碰磁盘；持久化由 index.js 用既有原子写落盘。
 *  3. **有界**：冲突列表硬上限，超出丢弃**最旧**的（保留新近冲突更可诊断）。
 *  4. **幂等**：同键重复 add 只更新一条，不叠加。
 */

export const TEAM_MERGE_MAX_CONFLICTS_PRE = 200

export const MERGE_NOOP = 'noop'
export const MERGE_TAKE_REMOTE = 'take-remote'
export const MERGE_KEEP_LOCAL = 'keep-local'
export const MERGE_CONFLICT = 'conflict'

/** 值等价判定：用 JSON 比较（条目都是普通对象/标量）。绝不抛。 */
function samePre(a, b) {
  if (a === b) return true
  try { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b) }
  catch (_) { return false }
}

/** 键集合（并集）。绝不抛。 */
function keysOfPre(base, local, remote) {
  const set = []
  const seen = Object.create(null)
  for (const src of [base, local, remote]) {
    if (!src || typeof src !== 'object') continue
    for (const k of Object.keys(src)) { if (!seen[k]) { seen[k] = 1; set.push(k) } }
  }
  return set
}

/**
 * 单键三方判定。返回 `MERGE_*` 之一。绝不抛。
 */
export function decideKeyPre(base, local, remote) {
  try {
    if (samePre(local, remote)) return MERGE_NOOP
    const hasB = base !== undefined
    if (!hasB) {
      // base 无此键：只有一边有 ⇒ 采纳有的一边；两边都有且不同 ⇒ 冲突
      if (local === undefined) return MERGE_TAKE_REMOTE
      if (remote === undefined) return MERGE_KEEP_LOCAL
      return MERGE_CONFLICT
    }
    if (samePre(local, base)) return MERGE_TAKE_REMOTE
    if (samePre(remote, base)) return MERGE_KEEP_LOCAL
    return MERGE_CONFLICT
  } catch (_) { return MERGE_KEEP_LOCAL }
}

/**
 * 整个对象的三方合并。
 * 返回 `{ merged, taken, kept, noop, conflicts: [{key, base, local, remote}] }`。
 * 冲突键**保留本机值**（不擅自覆盖），同时进 conflicts 供人工裁决。绝不抛。
 */
export function mergeThreeWayPre(base, local, remote) {
  const out = { merged: {}, taken: 0, kept: 0, noop: 0, conflicts: [] }
  try {
    const l = local && typeof local === 'object' ? local : {}
    const r = remote && typeof remote === 'object' ? remote : {}
    const b = base && typeof base === 'object' ? base : undefined
    for (const k of keysOfPre(b, l, r)) {
      const bv = b ? b[k] : undefined
      const lv = l[k]
      const rv = r[k]
      const d = decideKeyPre(bv, lv, rv)
      if (d === MERGE_TAKE_REMOTE) { out.merged[k] = rv; out.taken += 1 }
      else if (d === MERGE_KEEP_LOCAL) { out.merged[k] = lv; out.kept += 1 }
      else if (d === MERGE_NOOP) { out.merged[k] = lv; out.noop += 1 }
      else { out.merged[k] = lv; out.kept += 1; out.conflicts.push({ key: k, base: bv, local: lv, remote: rv }) }
    }
  } catch (_) { /* 降级：原样返回 local */
    try { return { merged: Object.assign({}, local || {}), taken: 0, kept: 0, noop: 0, conflicts: [] } }
    catch (__) { return { merged: {}, taken: 0, kept: 0, noop: 0, conflicts: [] } }
  }
  return out
}

export function createTeamMerge(options) {
  const opt = options || {}
  const maxConflicts = (function (v) {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : TEAM_MERGE_MAX_CONFLICTS_PRE
  })(opt.maxConflicts)
  const nowFn = typeof opt.now === 'function' ? opt.now : function () { return Date.now() }
  let seq = 0
  let items = []

  /** 冲突的稳定键：scope + key 相同即视为同一条（幂等）。 */
  function idOfPre(scope, key) { return String(scope || '') + '\u0000' + String(key || '') }

  /**
   * 记录一批冲突（来自 mergeThreeWayPre 的 `conflicts`）。
   * 返回 `{ added, updated, size }`。绝不抛。
   */
  function addConflicts(scope, list, meta) {
    let added = 0; let updated = 0
    try {
      const arr = Array.isArray(list) ? list : []
      for (const c of arr) {
        if (!c || typeof c !== 'object') continue
        const key = String(c.key === undefined ? '' : c.key)
        const id = idOfPre(scope, key)
        const hit = items.find(function (it) { return it.id === id })
        const rec = {
          id: id, scope: String(scope || ''), key: key,
          base: c.base, local: c.local, remote: c.remote,
          at: nowFn(), byMember: (meta && meta.member) || '',
          status: 'pending', choice: '', resolvedAt: 0,
        }
        if (hit) {
          // 幂等：同键只更新「值」，**不重置已裁决状态**（否则用户裁完又弹回来）
          hit.base = rec.base; hit.local = rec.local; hit.remote = rec.remote
          hit.at = rec.at; hit.byMember = rec.byMember
          updated += 1
        } else {
          seq += 1; rec.seq = seq
          items.push(rec); added += 1
        }
      }
      // 有界：超出丢**最旧**的
      if (items.length > maxConflicts) items = items.slice(items.length - maxConflicts)
    } catch (_) { /* 绝不抛 */ }
    return { added: added, updated: updated, size: items.length }
  }

  /** 待裁决列表（快照，按加入序）。 */
  function pending() {
    try { return items.filter(function (it) { return it.status === 'pending' }).map(function (it) { return Object.assign({}, it) }) }
    catch (_) { return [] }
  }

  /** 全部（含已裁决）。 */
  function all() {
    try { return items.map(function (it) { return Object.assign({}, it) }) } catch (_) { return [] }
  }

  function counts() {
    let pendingN = 0; let resolvedN = 0
    try { for (const it of items) { if (it.status === 'pending') pendingN += 1; else resolvedN += 1 } } catch (_) { /* */ }
    return { total: items.length, pending: pendingN, resolved: resolvedN, max: maxConflicts }
  }

  /**
   * 裁决一条。`choice` ∈ `'local' | 'remote'`。
   * 返回 `{ ok, reason?, record? }`。绝不抛。
   */
  function resolve(id, choice, byMember) {
    try {
      const it = items.find(function (x) { return x.id === id })
      if (!it) return { ok: false, reason: 'not-found' }
      if (choice !== 'local' && choice !== 'remote') return { ok: false, reason: 'bad-choice' }
      it.status = 'resolved'; it.choice = choice; it.resolvedAt = nowFn()
      if (byMember) it.resolvedBy = String(byMember)
      return { ok: true, record: Object.assign({}, it) }
    } catch (_) { return { ok: false, reason: 'threw' } }
  }

  /** 一键批量裁决（用于「全部采用对端」/「全部保留本机」）。 */
  function resolveAll(choice, byMember) {
    let n = 0
    try {
      for (const it of items) {
        if (it.status !== 'pending') continue
        const r = resolve(it.id, choice, byMember)
        if (r.ok) n += 1
      }
    } catch (_) { /* */ }
    return { ok: true, resolved: n }
  }

  /** 清空（裁决完毕或用户手动清理）。 */
  function clear() { const n = items.length; items = []; return { ok: true, cleared: n } }

  /** 序列化（供 index.js 原子写落盘）。 */
  function toJSON() {
    try { return { seq: seq, items: items.map(function (it) { return Object.assign({}, it) }) } }
    catch (_) { return { seq: 0, items: [] } }
  }

  /** 从落盘状态恢复（畸形输入降级为空）。 */
  function load(state) {
    try {
      const s = state && typeof state === 'object' ? state : {}
      seq = Number.isFinite(s.seq) ? s.seq : 0
      items = Array.isArray(s.items) ? s.items.filter(function (x) { return x && typeof x === 'object' }) : []
      if (items.length > maxConflicts) items = items.slice(items.length - maxConflicts)
      return { ok: true, size: items.length }
    } catch (_) { items = []; return { ok: false, size: 0 } }
  }

  function describe() {
    return { maxConflicts: maxConflicts, idSep: '\\u0000', choices: ['local', 'remote'] }
  }

  return {
    addConflicts: addConflicts, pending: pending, all: all, counts: counts,
    resolve: resolve, resolveAll: resolveAll, clear: clear,
    toJSON: toJSON, load: load, describe: describe,
  }
}
