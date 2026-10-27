/**
 * plan-render.js —— 由事件数据渲染「新版白板」（v6 · 2026-10-27）
 *
 * 用户裁定：「迁移应该产出新版本白板（用事件数据重新组织）」。
 * 即：白板是**产出物**，不是输入物。本模块负责「事件 → 白板 markdown」这一段。
 *
 * 纪律：
 *   · 纯函数、零 IO、零宿主 API（不 import index.js，避免环形依赖）
 *   · 入参统一走 normalizeEventPre（兼容 v1 旧事件）
 *   · 时间用 startMs；startMs === 0 回落 createdAt；**绝不允许出现 1970**
 *   · 输出不得含任何 HTML 注释（'<!--' 会泄漏到注入面，用户实报过）
 *   · 空数组 ⇒ 返回骨架，不崩溃
 */

import { normalizeEventPre } from './event-store.js'
import { firstSentencePre } from './event-render.js'

/** 单事件在「近期进展」里四段各自的字符上限（防某个超长事件吃掉整份白板） */
export const PLAN_SECTION_CHAR_MAX = 600
/** 「近期进展」最多渲染多少个事件 */
export const PLAN_RECENT_MAX = 30
/** 整份白板字符上限（超出则硬截断） */
export const PLAN_TOTAL_CHAR_MAX = 30000
/** 状态中文短标（表内用，省字节） */
export const PLAN_STATUS_LABEL = Object.freeze({ active: '进行', paused: '暂停', closed: '完成' })

const CUT = '…'
/** 骨架里 20 个片段之间共有 19 个换行（estimate 与 render 共用这个数，改结构必须同步） */
const PLAN_JOIN_NEWLINES = 19

const PLAN_FIXED_TITLE = '# 项目白板 · '
const PLAN_FIXED_HEADER_HEAD = '> 由 '
const PLAN_FIXED_HEADER_TAIL = ' 个事件渲染 · 最后更新 '
/** 四个节标题（顺序即渲染顺序） */
const PLAN_FIXED_SECTIONS = [
  '## 当前状态',
  '## 近期进展（按时间倒序）',
  '## 关键约束',
  '## 待办',
]

/** 码点安全截断（不切坏代理对；结尾加省略号时保证总长 ≤ n） */
function cutPre(s, n) {
  const src = String(s == null ? '' : s)
  if (src.length <= n) return src
  if (n <= 1) return CUT
  let end = n - 1
  const code = src.charCodeAt(end)
  if (code >= 0xdc00 && code <= 0xdfff) end -= 1
  return src.slice(0, Math.max(0, end)) + CUT
}

/**
 * 剥 HTML 注释（含**未闭合**的半截标记）。
 *
 * ★为什么不能只剥成对注释：本仓负路径判据是「输出里一个 '<!--' 都不许有」，
 *   而真实事件数据里既有 `<!-- memory:mem_xxx -->` 完整锚点，也有被截断留下的
 *   `<!-- type=goal`（无闭合）。只写 /<!--[\s\S]*?-->/g 时后者会原样漏进注入面。
 *   ⇒ 先剥成对，再把残余的开闭标记各自清掉。
 */
function stripHtmlCommentsPre(s) {
  return String(s == null ? '' : s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--/g, '')
    .replace(/-->/g, '')
}

/** 压成单行：先剥注释，再把换行/连续空白收成一个分隔符 */
function oneLine(s) {
  return stripHtmlCommentsPre(s)
    .replace(/\s*\n+\s*/g, ' / ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** 表格单元格：压单行 + 转义竖线 */
function cellPre(s) {
  return oneLine(s).replace(/\|/g, '\\|')
}

/**
 * 事件的有效时间：startMs → createdAt → 0。
 *
 * ★刻意**不**用 endMs 兜底：契约是「时间用 startMs，startMs === 0 回落 createdAt」。
 *   多插一级 endMs 会让「startMs 缺失」的事件显示成它自己的**结束**日期，
 *   与契约不符（旧实现即如此，B7 验收 A/B 组抓不到，D 组负路径才能抓到）。
 *   ★返回 0 表示「真的没有时间」——调用方据此输出空日期，绝不伪造 0 冒充 1970。
 */
function eventTimePre(ev) {
  const start = Number(ev && ev.startMs)
  if (Number.isFinite(start) && start > 0) return start
  const created = Number(ev && ev.createdAt)
  if (Number.isFinite(created) && created > 0) return created
  return 0
}

/** 时间戳 → YYYY-MM-DD（本地时区；拿不到 ⇒ ''，绝不产生 1970） */
function fmtDatePre(ms) {
  const t = Number(ms)
  if (!Number.isFinite(t) || t <= 0) return ''
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  // 1970-01-01 在本仓是「时间戳缺失后被伪造成 0」的典型症状，绝不外泄
  if (y < 1971) return ''
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return y + '-' + m + '-' + dd
}

/** 数组化（非数组 ⇒ []） */
function arrPre(v) { return Array.isArray(v) ? v : [] }

/** 事件名兜底 */
function namePre(ev) { return oneLine(ev && ev.name) || '(未命名事件)' }

/**
 * 分四节渲染：当前状态 / 近期进展 / 关键约束 / 待办
 * @param {Array} events 原始事件数组（会走 normalizeEventPre）
 * @returns {{current:string, recent:string, constraints:string, todos:string}}
 */
export function planSectionsFromEventsPre(events) {
  const list = arrPre(events).map((e) => normalizeEventPre(e))

  // 倒序时间；同时间用 ordinal 降序；再同则 id 稳定序（同输入逐字节确定）
  const sorted = list.slice().sort((a, b) => {
    const ta = eventTimePre(a), tb = eventTimePre(b)
    if (tb !== ta) return tb - ta
    const oa = Number(a.ordinal) || 0, ob = Number(b.ordinal) || 0
    if (ob !== oa) return ob - oa
    return String(a.id).localeCompare(String(b.id))
  })

  // ★「当前状态」与「待办」都**只认 active**：paused/closed 不该出现在「当前」与「待办」里
  const actives = sorted.filter((e) => e.status === 'active')

  // ---- ① 当前状态（表格：只列 active） ----
  const cur = ['| 事件名 | 状态 | 最近进展 |', '|---|---|---|']
  if (!actives.length) {
    cur.push('| （暂无 active 事件） | — | — |')
  } else {
    for (const e of actives) {
      const nm = cellPre(namePre(e))
      const first = cellPre(oneLine(firstSentencePre(stripHtmlCommentsPre(e.summary), 80))) || '—'
      cur.push('| ' + nm + ' | ' + (PLAN_STATUS_LABEL[e.status] || e.status) + ' | ' + first + ' |')
    }
  }

  // ---- ② 近期进展（按时间倒序，每事件一小节四段） ----
  const rec = []
  for (const e of sorted.slice(0, PLAN_RECENT_MAX)) {
    const d = fmtDatePre(eventTimePre(e))
    rec.push('### ' + (d ? d + ' · ' : '') + namePre(e))
    const sec = (e && e.sections) || {}
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

  // ---- ③ 关键约束（跨事件汇总去重；不限定状态——约束是长期有效的） ----
  const cst = []
  const seen = new Set()
  for (const e of sorted) {
    for (const c of arrPre(e && e.constraints)) {
      const t = oneLine(c)
      if (!t || seen.has(t)) continue
      seen.add(t)
      cst.push('- ' + cutPre(t, PLAN_SECTION_CHAR_MAX))
    }
  }
  if (!cst.length) cst.push('（暂无约束）')

  // ---- ④ 待办（只从 active 事件的 sections.next 汇总去重） ----
  const todo = []
  const seenT = new Set()
  for (const e of actives) {
    const t = oneLine((e && e.sections && e.sections.next) || '')
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
  const list = arrPre(events).map((e) => normalizeEventPre(e))
  const wsName = String((opts && opts.wsName) || 'workspace')
  const nowMs = Number((opts && opts.now)) || Date.now()
  const day = fmtDatePre(nowMs)

  const s = planSectionsFromEventsPre(list)

  const parts = [
    PLAN_FIXED_TITLE + wsName,
    '',
    PLAN_FIXED_HEADER_HEAD + String(list.length) + PLAN_FIXED_HEADER_TAIL + day,
    '',
    PLAN_FIXED_SECTIONS[0],
    '',
    s.current,
    '',
    PLAN_FIXED_SECTIONS[1],
    '',
    s.recent,
    '',
    PLAN_FIXED_SECTIONS[2],
    '',
    s.constraints,
    '',
    PLAN_FIXED_SECTIONS[3],
    '',
    s.todos,
    '',
  ]

  let out = parts.join('\n')
  if (out.length > PLAN_TOTAL_CHAR_MAX) out = cutPre(out, PLAN_TOTAL_CHAR_MAX)
  return out
}

/**
 * 估算渲染后的字符数（供预算控制）。
 *
 * ★为什么**不**直接 return renderPlanFromEventsPre(...).length：
 *   那样「估算误差 ≤ 15%」这条验收就是恒真（两个值永远相等，实现怎么改都不会红），
 *   等于没有鉴别力。这里改用**独立的骨架算式**：固定文本 + 各节实际长度 + 连接换行。
 *   将来 render 加了新节而本函数没跟上，误差就会变大 ⇒ 判据能抓到。
 * @param {Array} events
 * @param {{wsName?:string, now?:number}} opts
 * @returns {number}
 */
export function estimatePlanCharsPre(events, opts = {}) {
  const list = arrPre(events).map((e) => normalizeEventPre(e))
  const wsName = String((opts && opts.wsName) || 'workspace')
  const nowMs = Number((opts && opts.now)) || Date.now()
  const day = fmtDatePre(nowMs)

  const s = planSectionsFromEventsPre(list)
  const fixed =
    PLAN_FIXED_TITLE.length + wsName.length +
    PLAN_FIXED_HEADER_HEAD.length + String(list.length).length + PLAN_FIXED_HEADER_TAIL.length + day.length +
    PLAN_FIXED_SECTIONS.reduce((n, t) => n + t.length, 0)

  const total = fixed + s.current.length + s.recent.length + s.constraints.length + s.todos.length + PLAN_JOIN_NEWLINES
  return Math.min(total, PLAN_TOTAL_CHAR_MAX)
}

export default {
  PLAN_SECTION_CHAR_MAX,
  PLAN_RECENT_MAX,
  PLAN_TOTAL_CHAR_MAX,
  PLAN_STATUS_LABEL,
  planSectionsFromEventsPre,
  renderPlanFromEventsPre,
  estimatePlanCharsPre,
}
