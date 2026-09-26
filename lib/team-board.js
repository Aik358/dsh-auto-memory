/**
 * team-board.js —— 白板**整篇冲突**裁决 + 看板**两阶段**提交（纯函数，B8）。
 *
 * ## 为什么白板不能像日历那样做条目级合并
 * 日历是**条目集合**（每行一条，可按键三方合并）；白板 PLAN.md 是**一篇散文**，
 * 没有稳定的键。硬做行级合并会产生「半篇本机 + 半篇对端」的缝合怪物，
 * 比直接用一边更糟。⇒ 白板冲突的正确粒度是**整篇**：
 *   - 只有一边改 ⇒ 直接采纳那一边（无需人工）
 *   - 两边都改且不同 ⇒ **进人工裁决**，选项是 local / remote / manual（手工合并稿）
 *
 * ## 看板两阶段（stage → commit）
 * 看板条目允许「先放到草稿区，再一次性提交」。理由：看板改动常是成组的
 * （一批任务同时移动列），逐条上行会让对端看到中间的半成品状态。
 * 两阶段的语义：
 *   - `stage(op, item)` 只改内存草稿，**不产生同步事件**
 *   - `commit()` 把草稿**压成一个批次**，返回可发送的载荷
 *   - `discard()` 丢弃草稿
 *
 * ## 纪律
 *  1. **绝不抛**；畸形输入降级为「无操作 / 空草稿」。
 *  2. 白板裁决**必须显式**（不给默认值），避免「静默选了一边」把另一边内容丢掉。
 *  3. 草稿**有界**；超出上限拒绝新增并如实报错，不静默丢。
 */

export const PLAN_CHOICE_LOCAL = 'local'
export const PLAN_CHOICE_REMOTE = 'remote'
export const PLAN_CHOICE_MANUAL = 'manual'
export const TEAM_BOARD_MAX_DRAFT_PRE = 200

function textOfPre(v) { return typeof v === 'string' ? v : '' }

/**
 * 白板整篇三方判定。
 * 返回 `{ action, reason }`：
 *   action ∈ 'noop' | 'take-remote' | 'keep-local' | 'conflict'
 * 绝不抛。
 */
export function decidePlanPre(baseText, localText, remoteText) {
  try {
    const b = textOfPre(baseText)
    const l = textOfPre(localText)
    const r = textOfPre(remoteText)
    if (l === r) return { action: 'noop', reason: 'both-sides-equal' }
    if (b === '' && r === '') return { action: 'keep-local', reason: 'remote-empty' }
    if (b === '' && l === '') return { action: 'take-remote', reason: 'local-empty' }
    if (l === b) return { action: 'take-remote', reason: 'only-remote-changed' }
    if (r === b) return { action: 'keep-local', reason: 'only-local-changed' }
    return { action: 'conflict', reason: 'both-changed' }
  } catch (_) { return { action: 'keep-local', reason: 'degraded' } }
}

/**
 * 应用裁决。`choice` 必须是显式的三种之一；未知取值 ⇒ 拒绝（返回 ok:false），
 * **绝不默认选一边**。
 * 返回 `{ ok, text, reason? }`。
 */
export function applyPlanChoicePre(choice, localText, remoteText, manualText) {
  try {
    const l = textOfPre(localText)
    const r = textOfPre(remoteText)
    if (choice === PLAN_CHOICE_LOCAL) return { ok: true, text: l }
    if (choice === PLAN_CHOICE_REMOTE) return { ok: true, text: r }
    if (choice === PLAN_CHOICE_MANUAL) {
      const m = textOfPre(manualText)
      if (m === '') return { ok: false, reason: 'manual-empty' }
      return { ok: true, text: m }
    }
    return { ok: false, reason: 'bad-choice' }
  } catch (_) { return { ok: false, reason: 'threw' } }
}

export function createTeamBoard(options) {
  const opt = options || {}
  const maxDraft = (function (v) {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : TEAM_BOARD_MAX_DRAFT_PRE
  })(opt.maxDraft)
  const nowFn = typeof opt.now === 'function' ? opt.now : function () { return Date.now() }
  let draft = []
  let lastCommit = null

  /**
   * 放入草稿。`op` ∈ 'add' | 'move' | 'remove' | 'update'。
   * 返回 `{ ok, size, reason? }`。绝不抛。
   */
  function stage(op, item) {
    try {
      const o = String(op || '')
      if (o !== 'add' && o !== 'move' && o !== 'remove' && o !== 'update') return { ok: false, size: draft.length, reason: 'bad-op' }
      if (!item || typeof item !== 'object') return { ok: false, size: draft.length, reason: 'bad-item' }
      if (draft.length >= maxDraft) return { ok: false, size: draft.length, reason: 'draft-full' }
      draft.push({ op: o, item: Object.assign({}, item), at: nowFn() })
      return { ok: true, size: draft.length }
    } catch (_) { return { ok: false, size: draft.length, reason: 'threw' } }
  }

  /** 当前草稿（快照）。 */
  function peek() {
    try { return draft.map(function (d) { return { op: d.op, item: Object.assign({}, d.item), at: d.at } }) }
    catch (_) { return [] }
  }

  function size() { return draft.length }

  /**
   * 提交：把草稿压成**一个批次**（对端只会看到一次变更）。
   * 空草稿提交 ⇒ `{ ok: false, reason: 'empty' }`（不产生无意义的同步事件）。
   * 绝不抛。
   */
  function commit(meta) {
    try {
      if (!draft.length) return { ok: false, reason: 'empty', count: 0 }
      const ops = draft.map(function (d) { return { op: d.op, item: Object.assign({}, d.item) } })
      const batch = {
        count: ops.length, ops: ops, at: nowFn(),
        byMember: (meta && meta.member) || '',
      }
      lastCommit = batch
      draft = []
      return { ok: true, count: batch.count, batch: batch }
    } catch (_) { return { ok: false, reason: 'threw', count: 0 } }
  }

  /** 丢弃草稿。 */
  function discard() { const n = draft.length; draft = []; return { ok: true, discarded: n } }

  function status() {
    try {
      return {
        draft: draft.length, maxDraft: maxDraft,
        staged: size(), lastCommitCount: lastCommit ? lastCommit.count : 0,
        lastCommitAt: lastCommit ? lastCommit.at : 0,
      }
    } catch (_) { return { draft: 0, maxDraft: maxDraft, staged: 0, lastCommitCount: 0, lastCommitAt: 0 } }
  }

  /** 从落盘状态恢复（畸形输入降级为空草稿）。 */
  function load(state) {
    try {
      const s = state && typeof state === 'object' ? state : {}
      draft = Array.isArray(s.draft) ? s.draft.filter(function (d) { return d && typeof d === 'object' && d.item }) : []
      if (draft.length > maxDraft) draft = draft.slice(draft.length - maxDraft)
      lastCommit = s.lastCommit && typeof s.lastCommit === 'object' ? s.lastCommit : null
      return { ok: true, size: draft.length }
    } catch (_) { draft = []; return { ok: false, size: 0 } }
  }

  function toJSON() {
    try { return { draft: draft.map(function (d) { return { op: d.op, item: d.item, at: d.at } }), lastCommit: lastCommit } }
    catch (_) { return { draft: [], lastCommit: null } }
  }

  function describe() {
    return { maxDraft: maxDraft, ops: ['add', 'move', 'remove', 'update'], planChoices: [PLAN_CHOICE_LOCAL, PLAN_CHOICE_REMOTE, PLAN_CHOICE_MANUAL] }
  }

  return {
    stage: stage, peek: peek, size: size, commit: commit, discard: discard,
    status: status, load: load, toJSON: toJSON, describe: describe,
  }
}
