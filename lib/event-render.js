/**
 * event-render.js —— v4 事件三档渲染（批次 A 数据层）
 *
 * 设计依据：MASTER-PLAN §3.2（三档渲染，对齐既有三层契约）
 *   T0 ≤80 字/事件：name + status      → 事件目录（独立段 ≤400 字符）
 *   T1 ≤140 字/事件：summary 首句       → Tier-1 命中摘要
 *   T2 ≤2400 字/事件：完整四段 + 最近 3 检查点 → event-cards 段（只放 active 1–2 个）
 *
 * 纪律：纯函数、零 IO、零依赖；所有上限都是**硬上限**（超了截断并加标记，不静默）；
 * 同输入逐字节确定（可做基线锁）。
 */

export const RENDER_LIMITS = Object.freeze({ T0: 80, T1: 140, T2: 2400 })
/** 事件目录段总上限（D6 裁定：独立段 ≤400 字符） */
export const EVENT_CATALOG_MAX_CHARS = 400
export const TRUNC_MARK = '…'

/** 按码点安全截断（不切坏代理对；结尾加省略号时保证总长 ≤ n） */
function cutPre(s, n) {
  const src = String(s == null ? '' : s)
  if (src.length <= n) return src
  if (n <= 1) return TRUNC_MARK.slice(0, Math.max(0, n))
  let end = n - 1
  const code = src.charCodeAt(end)
  if (code >= 0xdc00 && code <= 0xdfff) end -= 1
  return src.slice(0, Math.max(0, end)) + TRUNC_MARK
}

/**
 * 取 summary 的第一句。
 *
 * ★为什么英文句点要单独处理（2026-10-24 批次 A 实测）：
 *   ① 中英文标点（。！？；）是无歧义的句末 ⇒ 直接切；
 *   ② ASCII 的 `!` `?` `;` 也无歧义（后面通常跟空格/结尾）⇒ 直接切；
 *   ③ **ASCII 的 `.` 有歧义**：`v3.3.17` / `Dr. Smith` / `1.5x` 都不是句末。
 *      故只在「后面是空白或串尾」时才当句末（标准启发式）。
 *      若不这样区分，summary 里的版本号/小数会被切碎，T1 摘要就成了半句话。
 */
/** 句末标点位置扫描（**不用锚定前缀**：每个候选边界独立判定，才能跳过缩写继续找）。 */
const SENT_END_SCAN = /[。！？；]|[!?;](?=\s|$)|\.(?=\s|$)/g
/** 常见缩写（英文句点不是句末）。只收高频且低歧义的，宁可漏判也不误切。 */
const ABBREV = new Set(['dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'e.g', 'i.e', 'no', 'fig', 'sec', 'vol', 'ch', 'pp', 'al'])
export function firstSentencePre(text, max = 140) {
  const src = String(text == null ? '' : text).trim()
  if (!src) return ''
  SENT_END_SCAN.lastIndex = 0
  let end = -1
  let m
  while ((m = SENT_END_SCAN.exec(src)) !== null) {
    const at = m.index
    const mark = m[0]
    if (mark === '.') {
      // 往前取「紧邻的词」判断是否缩写（含 e.g / i.e 这种带点形态）
      const before = src.slice(0, at)
      const token = (/([A-Za-z][A-Za-z.]*)$/.exec(before) || [])[1] || ''
      if (ABBREV.has(token.toLowerCase())) continue
    }
    end = at + mark.length
    break
  }
  const one = end > 0 ? src.slice(0, end) : src
  return cutPre(one.trim(), max)
}

/** T0：name + status（≤80）。status 用中文短标，省字节。 */
const STATUS_LABEL = Object.freeze({ active: '进行', paused: '搁置', closed: '完成' })
export function renderT0Pre(ev) {
  if (!ev) return ''
  const label = STATUS_LABEL[ev.status] || String(ev.status || '?')
  const name = String(ev.name || '').trim() || '(未命名)'
  const suffix = ' [' + label + ']'
  // 名称可占的宽度 = 上限 - 状态标 - 1 个分隔空格
  const room = RENDER_LIMITS.T0 - suffix.length - 1
  return cutPre(name, Math.max(1, room)) + suffix
}

/** T1：summary 首句（≤140）；剥掉换行（注入面不允许裸换行破坏块结构） */
export function renderT1Pre(ev) {
  if (!ev) return ''
  const text = String(ev.summary || '').replace(/\s*\n+\s*/g, ' ').trim()
  const one = firstSentencePre(text, RENDER_LIMITS.T1)
  return one || cutPre(String(ev.name || '').trim(), RENDER_LIMITS.T1)
}

/** T2：完整四段 + 最近 3 检查点（≤2400）。段落标题写死中文（与账本四段同名，模型已认）。 */
export function renderT2Pre(ev, opts = {}) {
  if (!ev) return ''
  const maxCk = Number.isFinite(opts.maxCheckpoints) ? Math.max(0, Math.floor(opts.maxCheckpoints)) : 3
  const lines = []
  lines.push('【事件】' + String(ev.name || '(未命名)') + '  [' + (STATUS_LABEL[ev.status] || ev.status) + ']')
  const sec = ev.sections || {}
  const SEC_TITLES = [['goal', '目标'], ['doing', '进行中'], ['deadend', '失败与弯路'], ['next', '下一步']]
  for (const [key, title] of SEC_TITLES) {
    const body = String(sec[key] == null ? '' : sec[key]).trim()
    if (!body) continue
    lines.push('· ' + title + '：' + body.replace(/\s*\n+\s*/g, ' / '))
  }
  const cks = Array.isArray(ev.checkpoints) ? ev.checkpoints.slice(-maxCk) : []
  if (cks.length) {
    lines.push('· 最近检查点：')
    for (const c of cks) {
      const kind = String(c.kind || 'log')
      const text = String(c.text || '').replace(/\s*\n+\s*/g, ' / ').trim()
      lines.push('  - [' + kind + '] ' + text)
    }
  }
  if (ev.outcome) lines.push('· 成果：' + String(ev.outcome).replace(/\s*\n+\s*/g, ' / '))
  return cutPre(lines.join('\n'), RENDER_LIMITS.T2)
}

/** 事件目录段（D6：独立段 ≤400 字符）。输入按 updatedAt 降序（调用方保证或这里排）。 */
export function renderEventCatalogPre(events, opts = {}) {
  const list = Array.isArray(events) ? events.filter(Boolean) : []
  if (!list.length) return { text: '', included: 0, dropped: 0 }
  const max = Number.isFinite(opts.maxChars) ? Math.max(0, Math.floor(opts.maxChars)) : EVENT_CATALOG_MAX_CHARS
  const sorted = list.slice().sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  const parts = []
  let used = 0, dropped = 0
  for (const ev of sorted) {
    const line = '· ' + renderT0Pre(ev)
    const cost = line.length + (parts.length ? 1 : 0)
    if (used + cost > max) { dropped = sorted.length - parts.length; break }
    parts.push(line); used += cost
  }
  return { text: parts.join('\n'), included: parts.length, dropped: Math.max(0, dropped) }
}

/** 取 active 事件里最近更新的前 N 个做 T2（默认 2，与契约「只放 active 1–2 个」一致） */
export function pickT2EventsPre(events, max = 2) {
  const list = Array.isArray(events) ? events.filter((e) => e && e.status === 'active') : []
  return list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)).slice(0, Math.max(0, Math.floor(max)))
}

export default { RENDER_LIMITS, EVENT_CATALOG_MAX_CHARS, firstSentencePre, renderT0Pre, renderT1Pre, renderT2Pre, renderEventCatalogPre, pickT2EventsPre }