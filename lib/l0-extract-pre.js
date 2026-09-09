/**
 * L0 抽取纯核心（l0_extract_pre_v1）—— 分层语义唤回的地基。
 *
 * 2026-09-08 建立。目的：为每条记忆生成廉价摘要（L0），使检索可先在小空间
 * 收敛候选，再按 id 下钻原文，从而把 token 开销与索引构建成本降约一个数量级
 * （实测：条目平均 814 字符 → L0 约 118 字符，压缩比 6.9:1）。
 *
 * 组成：
 *   1) parseMemoryItemsPre —— 按 `<!-- memory:mem_<32hex> -->` 锚点切分记忆条目
 *   2) extractL0Pre        —— 单条记忆的 L0 抽取（三级 fallback，见下）
 *   3) buildL0IndexPre     —— 文件级 L0 索引（确定性排序）
 *
 * L0 抽取优先级（零 LLM，纯解析）：
 *   ① `## 主题块标题`   —— 已由写入侧概括，质量最好（去掉 `（HH:MM）` 后缀）
 *   ② 首个 `- ` 条目首句 —— 去掉 `- HH:MM ` 时间戳前缀后取首句
 *   ③ 截断兜底          —— 前 maxChars 字符
 *   若首句过短（< minChars）则继续并接后续句子，直到达标或触顶。
 *
 * 边界：纯函数、零 IO、零依赖；对同输入逐字段确定；非法输入 fail closed（返回
 * 空串/空数组），不抛异常。所有新增文本 UTF-8 无 BOM。
 */

export const L0_EXTRACT_VERSION = 'l0_extract_pre_v1'

/** 锚点：`<!-- memory:mem_<32hex> -->`（允许空白浮动）。 */
const MEM_ANCHOR_RE = /<!--\s*memory:(mem_[0-9a-f]{32})\s*-->/g

/** 行首时间戳：`12:01 ` / `14:5x ` 等（日志条目惯例）。 */
const LEAD_TIME_RE = /^\s*\d{1,2}:\d{2}[a-z]?\s+/

/** 句末/句读分隔符（含中文）。 */
const SENTENCE_SPLIT_RE = /[。；;!！?？\n]/

/** 主题块标题后缀：`（12:02）` 或 `(12:02)`。 */
const HEADING_SUFFIX_RE = /\s*[（(]\s*\d{1,2}:\d{2}\s*[)）]\s*$/

export const L0_DEFAULTS = Object.freeze({
  maxChars: 160,
  minChars: 15,
  hardChars: 480,
})

const clean = (s) => String(s == null ? '' : s).replace(/\u0000/g, '').trim()

/**
 * 按锚点切分记忆条目。
 *
 * 约定：锚点标记**其后**的内容（实测文件结构为 `<!-- A -->内容A<!-- B -->内容B`），
 * 因此第 i 个内容对应第 i 个锚点。锚点之前的游离内容（若有）归入 `preamble`。
 *
 * @param {string} text 文件内容
 * @returns {{items: Array<{id:string, body:string}>, preamble: string, anchors: number}}
 */
export function parseMemoryItemsPre(text) {
  const src = typeof text === 'string' ? text : ''
  const items = []
  if (!src) return { items, preamble: '', anchors: 0 }

  MEM_ANCHOR_RE.lastIndex = 0
  const marks = []
  let m
  while ((m = MEM_ANCHOR_RE.exec(src)) !== null) {
    marks.push({ id: m[1], start: m.index, end: m.index + m[0].length })
    if (m.index === MEM_ANCHOR_RE.lastIndex) MEM_ANCHOR_RE.lastIndex++
  }
  if (!marks.length) return { items, preamble: clean(src), anchors: 0 }

  for (let i = 0; i < marks.length; i++) {
    const from = marks[i].end
    const to = i + 1 < marks.length ? marks[i + 1].start : src.length
    const body = clean(src.slice(from, to))
    if (body) items.push({ id: marks[i].id, body })
  }
  return { items, preamble: clean(src.slice(0, marks[0].start)), anchors: marks.length }
}

/**
 * 抽取单条记忆的 L0。纯函数，永不抛异常。
 *
 * @param {string} body 条目正文
 * @param {{maxChars?:number, minChars?:number}} opts
 * @returns {{l0: string, source: 'heading'|'firstSentence'|'truncate'|'empty'}}
 */
export function extractL0Pre(body, opts = {}) {
  const maxChars = Math.max(16, Number(opts.maxChars) || L0_DEFAULTS.maxChars)
  const minChars = Math.max(0, Number(opts.minChars) || L0_DEFAULTS.minChars)
  const text = clean(body)
  if (!text) return { l0: '', source: 'empty' }

  const lines = text.split(/\r?\n/)

  // ① 主题块标题
  for (const line of lines) {
    const h = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line)
    if (h) {
      const title = clean(h[1]).replace(HEADING_SUFFIX_RE, '')
      if (title) return { l0: cut(title, maxChars), source: 'heading' }
    }
  }

  // ② 首个 `- ` 条目：先取首句，过短再并接（并接时剥列表标记与时间戳）
  for (const line of lines) {
    const b = /^\s*[-*+]\s+(.+?)\s*$/.exec(line)
    if (!b) continue
    let s = clean(b[1]).replace(LEAD_TIME_RE, '')
    if (!s) continue
    const first = clean(s.split(SENTENCE_SPLIT_RE)[0])
    s = growToMin(first || s, text, minChars, maxChars)
    return { l0: cut(s, maxChars), source: 'firstSentence' }
  }

  // ③ 兜底：正文截断
  const flat = clean(text.replace(/\s+/g, ' '))
  return { l0: cut(flat, maxChars), source: 'truncate' }
}

/** 构建文件级 L0 索引（按 id 升序，确定性）。 */
export function buildL0IndexPre(text, opts = {}) {
  const { items } = parseMemoryItemsPre(text)
  const out = items.map((it) => {
    const r = extractL0Pre(it.body, opts)
    return { id: it.id, l0: r.l0, source: r.source, chars: r.l0.length, bodyChars: it.body.length }
  })
  out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return out
}

// ---------- 内部工具 ----------

function cut(s, n) {
  if (s.length <= n) return s
  return s.slice(0, Math.max(1, n - 1)) + '…'
}

/** 首句过短时，并接后续句子直到 minChars 或 maxChars。每句先剥列表标记与时间戳前缀。 */
function growToMin(first, full, minChars, maxChars) {
  if (first.length >= minChars) return first
  const flat = clean(full.replace(/\s+/g, ' '))
  if (!flat || flat.length <= first.length) return first
  const parts = flat.split(SENTENCE_SPLIT_RE)
    .map((x) => clean(String(x).replace(/^\s*[-*+]\s+/, '').replace(LEAD_TIME_RE, '')))
    .filter(Boolean)
  let acc = ''
  for (const p of parts) {
    acc = acc ? acc + '。' + p : p
    if (acc.length >= minChars || acc.length >= maxChars) break
  }
  return acc || first
}
