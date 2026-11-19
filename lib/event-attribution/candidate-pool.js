/**
 * candidate-pool.js —— 候选池构造：eligible 清单、时间/生命周期约束、证据视图、**显式**截断。
 *
 * 职责边界：
 *   · 给定「记录快照 + 事件库快照」⇒ 产出 eligible 候选清单与每个候选的证据视图
 *   · 执行 LOOCA（leave-one-current-out）：记录自身、未来事件、当前记录已挂事件一律排除
 *   · 只做**约束与选取**，不做归属判定（判定在 reviewer + model）
 *
 * 禁止：写事件库、调模型、渲染回执。
 *
 * ★本模块存在的最重要理由（2026-11-16 task-27 实证）：
 *   把候选截断到 N 个而池中位数是 59 时，gold 被挤出可见集 ⇒ attach 类 gold 可见率只有 91/333，
 *   模型被迫在「看不见答案的集合里猜」，分数从 0.87 掉到 0.56。**由此产生的低分是装置缺陷，不是模型缺陷。**
 *   ⇒ 任何截断都必须同时给出 eligibleCount / visibleCount / omittedCount / truncated / coverage，
 *     并由 contract 的不变量强制 coverage=partial。
 */

import { EVENT_ATTRIBUTION_PROFILE_V1 } from './contract.js'

/**
 * 事件是否可作为本次写入的候选。
 *
 * 规则（与任务书 §6 一致）：
 *   · 必须 active —— closed 不可作为新写入目标；paused 单独标记但仍可提案
 *   · createdAt 必须 ≤ 记录时刻 —— 不能选「未来才存在」的事件
 *   · 必须不是本次记录已挂的事件 —— 否则就是自己证明自己
 *   · 必须不是当前记录自身（eventId 相等即排除）
 *
 * @param {object} ev 事件（含 id/status/createdAt）
 * @param {{ at:number, excludeEventId?:string|null }} ctx
 * @returns {{ok:boolean, reason?:string}}
 */
export function isEligiblePre(ev, ctx) {
  const e = ev && typeof ev === 'object' ? ev : null
  if (!e || !e.id) return { ok: false, reason: 'no-id' }
  if (e.status === 'closed') return { ok: false, reason: 'closed' }
  if (e.status !== 'active' && e.status !== 'paused') return { ok: false, reason: 'status:' + String(e.status) }
  const at = Number(ctx && ctx.at)
  const created = Number(e.createdAt)
  if (Number.isFinite(created) && Number.isFinite(at) && created > at) return { ok: false, reason: 'future' }
  const ex = ctx && ctx.excludeEventId
  if (ex && String(ex) === String(e.id)) return { ok: false, reason: 'self' }
  return { ok: true }
}

/**
 * 构造候选证据视图。
 *
 * 证据优先级（任务书 §6.2）：name + summary + 最近 checkpoint.goal/state；缺失回退 text。
 * **不包含**当前记录自身或后写入内容。
 *
 * @param {object} ev
 * @param {number} maxChars
 * @returns {{ eventId:string, evidence:string[], chars:number }}
 */
export function evidenceOfPre(ev, maxChars) {
  const lim = Math.max(40, Number(maxChars) || EVENT_ATTRIBUTION_PROFILE_V1.budget.maxEvidenceChars)
  const parts = []
  const nm = String((ev && ev.name) || '').replace(/\s+/g, ' ').trim()
  if (nm) parts.push('name: ' + nm.slice(0, 80))
  const sm = String((ev && ev.summary) || '').replace(/\s+/g, ' ').trim()
  if (sm) parts.push('summary: ' + sm.slice(0, 160))
  const cps = Array.isArray(ev && ev.checkpoints) ? ev.checkpoints.slice(-3) : []
  const quad = []
  const texts = []
  const sq = (x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim()
  for (const c of cps) {
    if (!c || typeof c !== 'object') continue
    // ★★task-29 阻断一：**真实 schema 的 checkpoint 直接字段**优先（goal/state/dead/next）。
    //   生产形状（lib/index.js memory_event 参数表 / event-write / handoff-write）是
    //   checkpoints:[{ goal, state, deadend, next, text, panels? }]，**不是**只有 panels。
    //   旧实现只读 panels ⇒ 真实库上 goal/state 一条都读不到，这是 67 项测试未覆盖的生产形状。
    let direct = 0
    for (const k of ['goal', 'state']) {
      const t = sq(c[k])
      if (t) { quad.push(k + ': ' + t.slice(0, 120)); direct += 1 }
    }
    // panels 作为**兼容通道**保留（旧夹具与部分写入路径仍用它）
    const q = Array.isArray(c.panels) ? c.panels : null
    if (q) {
      for (const pn of q) {
        const k = String((pn && pn.kind) || '')
        if (k === 'state' || k === 'goal') {
          const t = sq(pn && pn.text)
          if (t) quad.push(k + ': ' + t.slice(0, 120))
        }
      }
    }
    // ★回退顺序：直接 goal/state → panels → **本条 checkpoint.text**（不是 event.text）
    if (!direct && !(q && q.length)) {
      const ct = sq(c.text)
      if (ct) texts.push(ct.slice(0, 120))
    }
  }
  if (quad.length) parts.push(quad.slice(0, 3).join(' | '))
  // ★task-29 阻断一：回退读 checkpoint.text，**不是 event.text**
  //   理由：event.text 在真实库里多为渲染产物/摘要，而 checkpoint.text 才是这条事件最近做了什么。
  if (texts.length) parts.push('checkpoint.text: ' + texts.slice(0, 2).join(' | '))
  // 冻结时间/生命周期证据（只作约束与弱证据，**不按越近越好加分**）
  const st = String((ev && ev.status) || '')
  if (st) parts.push('statusAtRecord: ' + st)
  const out = []
  let used = 0
  for (const p of parts) {
    if (used >= lim) break
    const room = lim - used
    out.push(p.slice(0, room))
    used += Math.min(p.length, room)
  }
  return { eventId: String((ev && ev.id) || ''), evidence: out, chars: used }
}

/**
 * 构造候选池。
 *
 * @param {object} input
 * @param {Array<object>} input.events 事件库快照（每个含 id/status/createdAt/name/summary/checkpoints）
 * @param {number} input.at 记录时刻（ms）
 * @param {string|null} [input.excludeEventId] 本次记录已挂事件（LOOCA）—— 排除「自己」
 * @param {number} [input.maxCandidates] 送入模型的上限（默认取 profile 预算）
 * @param {(ev:object)=>number|null} [input.scoreOf] 纯内存打分器（可为 null ⇒ score 全为 null）
 * @returns {{ok:true, pool:object, visible:Array<object>}}
 */
export function buildCandidatePoolPre(input = {}) {
  const budget = EVENT_ATTRIBUTION_PROFILE_V1.budget
  const maxCand = Math.max(1, Number(input.maxCandidates) || budget.maxCandidates)
  const at = Number(input.at)
  const all = Array.isArray(input.events) ? input.events : []
  const excluded = []
  const eligible = []
  for (const ev of all) {
    const r = isEligiblePre(ev, { at, excludeEventId: input.excludeEventId })
    if (r.ok) eligible.push(ev)
    else excluded.push({ eventId: String((ev && ev.id) || ''), reason: r.reason })
  }
  // 稳定排序：先按分数降序（若有），再按 updatedAt 降序，最后按 id 升序 —— 完全确定，不含随机
  const scored = eligible.map((ev) => {
    let sc = null
    if (typeof input.scoreOf === 'function') {
      const v = input.scoreOf(ev)
      if (typeof v === 'number' && Number.isFinite(v)) sc = v
    }
    return { ev, score: sc }
  })
  scored.sort((a, b) => {
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score
    const ua = Number(a.ev.updatedAt) || 0
    const ub = Number(b.ev.updatedAt) || 0
    if (ua !== ub) return ub - ua
    return String(a.ev.id) < String(b.ev.id) ? -1 : (String(a.ev.id) > String(b.ev.id) ? 1 : 0)
  })
  const eligibleCount = scored.length
  // ★★task-29 阻断二：**focus 槽位保留**。
  //   缺陷根因：focusEventId（正在复核的当前目标）若因 top-K 被截掉，模型根本看不到它，
  //   会把「看不见」误当成「模型否决」⇒ 产生 false-positive 的 suspect-auto-attach。
  //   修法：目标在 eligible 中时**强制占一个可见槽位**（挤掉排名最末的一个），
  //   并在 pool 里显式记录 focus 是否可见，供 reviewer 区分「真否决」与「没看到」。
  const focusId = input.focusEventId ? String(input.focusEventId) : null
  const reserveFocus = input.reserveFocus !== false
  let visibleRaw = scored.slice(0, maxCand)
  let focusInEligible = false
  let focusReserved = false
  if (focusId) {
    const idx = scored.findIndex((x) => String(x.ev.id) === focusId)
    if (idx >= 0) {
      focusInEligible = true
      const already = visibleRaw.some((x) => String(x.ev.id) === focusId)
      if (!already && reserveFocus) {
        // 挤掉排名最末的一位，把目标放进去；随后**按原 scored 顺序重排**，
        // 保证 visible 的呈现顺序仍与排序一致（不能让 focus 永远排到末尾造成顺序泄漏）。
        const keep = new Set(scored.slice(0, Math.max(0, maxCand - 1)).map((x) => String(x.ev.id)))
        keep.add(focusId)
        visibleRaw = scored.filter((x) => keep.has(String(x.ev.id)))
        focusReserved = true
      }
    }
  }
  const omittedCount = Math.max(0, eligibleCount - visibleRaw.length)
  const visible = visibleRaw.map((s, idx) => {
    const ev2 = evidenceOfPre(s.ev, budget.maxEvidenceChars)
    // margin = 与下一名的分差（真实计算值；无分数时为 null，**不编造置信度**）
    let margin = null
    if (s.score != null && visibleRaw[idx + 1] && visibleRaw[idx + 1].score != null) {
      margin = s.score - visibleRaw[idx + 1].score
    }
    return {
      eventId: String(s.ev.id),
      score: s.score,
      margin,
      evidence: ev2.evidence.concat([
        'createdAt: ' + new Date(Number(s.ev.createdAt) || 0).toISOString().slice(0, 10),
      ]),
    }
  })
  return {
    ok: true,
    pool: {
      eligibleCount,
      visibleCount: visible.length,
      omittedCount,
      truncated: omittedCount > 0,
      coverage: omittedCount > 0 ? 'partial' : (visible.length ? 'complete' : 'none'),
      excluded,
      // ★focus 三态（task-29 阻断二）：reviewer 据此区分「真否决」与「目标不可见」
      focusEventId: focusId,
      focusInEligible,
      focusReserved,
      focusVisible: focusId ? visible.some((v) => String(v.eventId) === focusId) : false,
    },
    visible,
  }
}

export default { isEligiblePre, evidenceOfPre, buildCandidatePoolPre }
