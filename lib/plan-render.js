/**
 * plan-render.js —— 由事件数据渲染「新版白板」（v6 · 2026-10-27）
 *
 * 用户裁定：「迁移应该产出新版本白板（用事件数据重新组织）」。
 * 即：白板是**产出物**，不是输入物。本模块负责「事件 → 白板 markdown」这一段。
 *
 * 纪律：
 *   · 纯函数、零 IO、零依赖（不 import index.js，避免环形依赖）
 *   · 入参统一走 normalizeEventPre（兼容 v1 旧事件）
 *   · 时间用 startMs；startMs === 0 时回落 createdAt；**绝不允许出现 1970**
 *   · 输出不得含任何 HTML 注释（\`<!-- -->\` 会泄漏到注入面）
 *   · 空数组 ⇒ 返回骨架，不崩溃
 */

import { normalizeEventPre } from './event-store.js'

/** 单事件在「近期进展」里的四段各段字符上限（防某个超长事件吃掉整份白板） */
export const PLAN_SECTION_CHAR_MAX = 600
/** 「近期进展」最多渲染多少个事件 */
export const PLAN_RECENT_MAX = 30
/** 整份白板字符上限（超出则截断「近期进展」尾部） */
export const PLAN_TOTAL_CHAR_MAX = 30000

const CUT = '…'

/** 码点安全截断 */
function cutPre(s, n) {
  const src = String(s == null ? '' : s)
  if (src.length <= n) return src
  if (n <= 1) return CUT
  let end = n - 1
  const code = src.charCodeAt(end)
  if (code >= 0xdc00 && code <= 0xdfff) end -= 1
  return src.slice(0, Math.max(0, end)) + CUT
}

/** 把多行压成单行（白板是 md，但四段内部换行会让结构乱） */
function oneLine(s) {
  return String(s == null ? '' : s).replace(/\s*\n+\s*/g, ' / ').trim()
}

/** 事件的有效起始时间（startMs → endMs → createdAt，绝不用 0） */
function eventTimePre(ev) {
  const t = Number(ev.startMs) || Number(ev.endMs) || Number(ev.createdAt) || 0
  return t > 0 ? t : 0
}

/** 时间戳 → YYYY-MM-DD（本地时区；0 ⇒ ''，不产生 1970） */
function fmtDatePre(ms) {
  const t = Number(ms) || 0
  if (t <= 0) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  if (y < 1971) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + dd
}

/** 状态中文标签 */
const STATUS_CN = { active: '进行', paused: '暂停', closed: '完成' }

/**
 * 分四节渲染：当前状态 / 近期进展 / 关键约束 / 待办
 * @param {Array} events 原始事件数组（会走 normalize）
 * @returns {{current:string, recent:string, constraints:string, todos:string}}
 */
export function planSectionsFromEventsPre(events) {
  const list = (Array.isArray(events) ? events : []).map((e) => normalizeEventPre(e))

  // 按时间倒序（最新在前）；同时间用 ordinal 降序；再同则 id 稳定序
  const sorted = list.slice().sort((a, b) => {
    const ta = eventTimePre(a), tb = eventTimePre(b)
    if (tb !== ta) return tb - ta
    const oa = Number(a.ordinal) || 0, ob = Number(b.ordinal) || 0
    if (ob !== oa) return ob - oa
    return String(a.id).localeCompare(String(b.id))
  })

  const actives = sorted.filter((e) => e.status !== 'closed')

  // ---- ① 当前状态（表格：只列 active） ----
  const cur = ['| 事件 | 状态 | 最近进展 |', '|---|---|---|']
  if (!actives.length) {
    cur.push('| （暂无 active 事件） | — | — |')
  } else {
    for (const e of actives) {
      const nm = oneLine(e.name).replace(/\|/g, '\\|')
      const first = cutPre(oneLine(e.summary || e.sections.goal || ''), 60).replace(/\|/g, '\\|')
      cur.push('| ' + nm + ' | ' + (STATUS_CN[e.status] || e.status) + ' | ' + (first || '—') + ' |')
    }
  }

  // ---- ② 近期进展（按时间倒序，每事件一小节四段） ----
  const rec = []
  for (const e of sorted.slice(0, PLAN_RECENT_MAX)) {
    const d = fmtDatePre(eventTimePre(e))
    const head = '### ' + (d ? d + ' · ' : '') + oneLine(e.name)
    rec.push(head)
    const sec = e.sections || {}
    const rows = [
      ['目标', sec.goal],
      ['做了什么', sec.doing],
      ['卡点', sec.deadend],
      ['下一步', sec.next],
    ]
    let wrote = 0
    for (const [label, body] of rows) {
      const t = cutPre(oneLine(body), PLAN_SECTION_CHAR_MAX)
      if (!t) continue
      rec.push('- ' + label + '：' + t)
      wrote++
    }
    if (!wrote) rec.push('- （本事件暂未填四段）')
    rec.push('')
  }
  if (!sorted.length) rec.push('（暂无事件）')

  // ---- ③ 关键约束（跨事件汇总去重） ----
  const cst = []
  const seen = new Set()
  for (const e of sorted) {
    for (const c of (Array.isArray(e.constraints) ? e.constraints : [])) {
      const t = oneLine(c)
      if (!t || seen.has(t)) continue
      seen.add(t)
      cst.push('- ' + cutPre(t, PLAN_SECTION_CHAR_MAX))
    }
  }
  if (!cst.length) cst.push('（暂无约束）')

  // ---- ④ 待办（从 active 事件的 sections.next 汇总） ----
  const todo = []
  const seenT = new Set()
  for (const e of actives) {
    const t = oneLine((e.sections || {}).next)
    if (!t || seenT.has(t)) continue
    seenT.add(t)
    todo.push('- ' + cutPre(t, PLAN_SECTION_CHAR_MAX))
  }
  if (!todo.length) todo.push('（暂无待办）')

  return {
    current: cur.join('\n'),
    recent: rec.join('\n').trim(),
    constraints: cst.join('\n'),
    todos: todo.join('\n'),
  }
}

/**
 * 由事件渲染完整白板 markdown。
 * @param {Array} events
 * @param {{wsName?:string, now?:number}} opts
 * @returns {string}
 */
export function renderPlanFromEventsPre(events, opts = {}) {
  const list = (Array.isArray(events) ? events : []).map((e) => normalizeEventPre(e))
  const wsName = String((opts && opts.wsName) || 'workspace')
  const nowMs = Number((opts && opts.now)) || Date.now()
  const day = fmtDatePre(nowMs)

  const s = planSectionsFromEventsPre(list)

  const parts = [
    '# 项目白板 · ' + wsName,
    '',
    '> 由 ' + String(list.length) + ' 个事件渲染 · 最后更新 ' + day,
    '',
    '## 当前状态',
    '',
    s.current,
    '',
    '## 近期进展（按时间倒序）',
    '',
    s.recent,
    '',
    '## 关键约束',
    '',
    s.constraints,
    '',
    '## 待办',
    '',
    s.todos,
    '',
  ]

  let out = parts.join('\n')
  if (out.length > PLAN_TOTAL_CHAR_MAX) out = cutPre(out, PLAN_TOTAL_CHAR_MAX)
  return out
}

/**
 * 估算渲染后的字符数（供预算控制，不实际拼串也可近似）。
 * @param {Array} events
 * @param {{wsName?:string}} opts
 * @returns {number}
 */
export function estimatePlanCharsPre(events, opts = {}) {
  // 直接用真实渲染算，保证与 renderPlanFromEventsPre 一致（误差 0）
  return renderPlanFromEventsPre(events, opts).length
}

export default {
  PLAN_SECTION_CHAR_MAX,
  PLAN_RECENT_MAX,
  PLAN_TOTAL_CHAR_MAX,
  planSectionsFromEventsPre,
  renderPlanFromEventsPre,
  estimatePlanCharsPre,
}
