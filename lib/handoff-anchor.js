/**
 * P6(2026-09-09) 账本权重化截断纯核心(handoff_ledger_weight_v1)。
 *
 * 背景:buildContinueCarry 的 `ledger.slice(0, 8000)` 是位置截断,而账本段内异质——
 * 位置截可能把高价值段整体截掉(M-CM7 §C/§G4)。本模块按账本自身四段标题赋权:
 *   已试方案与失败原因 .35 > 进度与下一步 .30 > 目标 .20 > 任务状态 .15
 * 预算不足时从最低权重段开始截(保留段标题行),预算充足时逐字节原样返回。
 *
 * 契约:
 *   - 标题字符串来自账本文件本身(写入侧骨架逐字一致),不做内容语义标注——禁止把"成功解法"误标为"失败原因"。
 *   - 纯函数、零 IO、零依赖;同输入逐字节确定;非法输入 fail closed(返回 null,调用方回落位置截断)。
 *   - 只影响注入,不动文件原文。
 */

export const HANDOFF_LEDGER_WEIGHT_VERSION = 'handoff_ledger_weight_v1'

/** 四段标题 → 权重(降序)。标题为账本中的原样标题行(半角 '## '+单空格,不含行尾 \r)。 */
export const HANDOFF_LEDGER_SECTION_WEIGHTS_V1 = Object.freeze([
  Object.freeze({ title: '已试方案与失败原因', weight: 0.35 }),
  Object.freeze({ title: '进度与下一步', weight: 0.30 }),
  Object.freeze({ title: '目标', weight: 0.20 }),
  Object.freeze({ title: '任务状态', weight: 0.15 }),
])

const TITLE_WEIGHT = new Map(HANDOFF_LEDGER_SECTION_WEIGHTS_V1.map((x) => [x.title, x.weight]))
/** 未知 '## ' 段:权重最低(最先被截),但仍保留标题与内容直到轮到它。 */
const UNKNOWN_WEIGHT = 0.05
const TRIM_MARK = '…(已按预算截断,全文见 handoff/ 最新账本)'

function weightOf(titleText) {
  const name = String(titleText || '').replace(/^##\s*/, '').replace(/\s+$/, '')
  return TITLE_WEIGHT.has(name) ? TITLE_WEIGHT.get(name) : UNKNOWN_WEIGHT
}

/**
 * 解析账本四段。行级切分:遇到 `## ` 开头行即开新段;首个标题行之前的内容为 preamble(如 `# 交接账本 · …` 大标题)。
 * title 保留原样行(含 '## ' 前缀,容忍尾随 \r);body 为两标题行之间的原始行(不做 trim,保证原样回装)。
 * @returns {{preamble: string[], sections: Array<{title: string, body: string[], weight: number}>} | null}
 *  无任何 '## ' 段或输入非法 → null(fail closed)。
 */
export function parseHandoffLedgerPre(text) {
  const src = typeof text === 'string' ? text : ''
  if (!src.trim()) return null
  const lines = src.split('\n')
  const preamble = []
  const sections = []
  let cur = null
  for (const line of lines) {
    if (/^## (.+)$/.test(line.replace(/\r$/, ''))) {
      if (cur) sections.push(cur)
      cur = { title: line, body: [], weight: weightOf(line) }
    } else if (cur) cur.body.push(line)
    else preamble.push(line)
  }
  if (cur) sections.push(cur)
  if (!sections.length) return null
  return { preamble, sections }
}

/** 回装:preamble + 各段(title 行 + body 行)以 \n 连接;对无 \r 输入逐字节还原原文本。 */
function assemble(preamble, sections) {
  const parts = []
  if (preamble.length) parts.push(preamble.join('\n'))
  for (const s of sections) parts.push(s.body.length ? s.title + '\n' + s.body.join('\n') : s.title)
  return parts.join('\n')
}

/** 段内按行收缩:从 body 尾部丢行(保头部,与 slice(0,N) 语义一致),返回新 body(≤keepChars 字符)。 */
function shrinkBody(body, keepChars) {
  if (keepChars <= 0) return []
  const out = []
  let used = 0
  for (let i = 0; i < body.length; i++) {
    const cost = body[i].length + (i > 0 ? 1 : 0)
    if (used + cost > keepChars) break
    out.push(body[i])
    used += cost
  }
  return out
}

/**
 * 权重化截断。预算充足(原文 ≤budget)→ 返回与原文逐字节相同的字符串;
 * 不足 → 从最低权重段开始截 body(段标题保留,截点带 TRIM_MARK),直到进入预算;
 * 全部段收缩后仍超预算(如 preamble/标题行本身超限)→ 最后回落 `slice(0, budget)`。
 * 解析失败(非法输入/无已知段结构)→ 返回 null,调用方自行回落。
 * @param {string} text 账本全文
 * @param {number} budget 注入预算(字符)
 * @returns {string | null}
 */
export function weightedTrimHandoffLedgerPre(text, budget) {
  const b = Number(budget)
  if (!Number.isFinite(b) || b <= 0) return null
  const parsed = parseHandoffLedgerPre(text)
  if (!parsed) return null
  const original = assemble(parsed.preamble, parsed.sections)
  if (original.length <= b) return original

  // 截断顺序:权重升序(稳定:同权重保持文内出现顺序)
  const order = parsed.sections.map((s, i) => ({ s, i })).sort((x, y) => x.s.weight - y.s.weight || x.i - y.i)
  const markCost = TRIM_MARK.length + 1 // 截点换行 + marker 本身,预留避免逐段收敛震荡
  for (const { s } of order) {
    const current = assemble(parsed.preamble, parsed.sections)
    if (current.length <= b) break
    const bodyLen = s.body.join('\n').length
    if (bodyLen <= 0) continue
    const excess = current.length - b
    const keep = Math.max(0, bodyLen - excess - markCost)
    s.body = shrinkBody(s.body, keep)
    s.body = s.body.length ? s.body.concat([TRIM_MARK]) : [TRIM_MARK]
  }
  const out = assemble(parsed.preamble, parsed.sections)
  return out.length <= b ? out : out.slice(0, b)
}
