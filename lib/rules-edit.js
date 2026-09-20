/**
 * rules-edit.js —— 「用户级硬性约束」的**条目级**解析与增删改（R7 需求）。
 *
 * ## 背景（用户 2026-09-20 明确要求「这个功能必须要落在前端」）
 *
 * `[规则 — 用户级硬性约束 · 必须遵守]` 这一段是**每轮无条件注入**的硬约束，
 * 真源 = `~/.dsh/memory/MEMORY.md`（见 `rules-layer.js:12` 的真源纪律）。
 * 它**不走语义层** —— 即没有检索/打分/淘汰环节 ⇒ **过时条目不会被自动清理**；
 * 而 AI（`memory_user`）也会往里写错东西。
 * ⇒ 用户必须能**自己增/删/改**，否则错一条就每轮都被误导。
 *
 * ## 与既有渲染层的关系（重要：本模块不改变注入语义）
 *
 * `rules-layer.js` 的 `extractRulesLayerPre()` 负责**读**（把 MEMORY.md 解析成规则段），
 * `renderRulesSectionPre()` 负责**渲染**。本模块只做**编辑定位**：
 * 给定原文，找出「哪一段是规则段、每条规则在第几行」，以及产出改后的新全文。
 * 它**不碰**注入、不碰检索、不碰 store。
 *
 * ## 条目模型
 *
 * 用户级 MEMORY.md 由若干 `## YYYY-MM-DD` 日期段 + `- ` 条目行组成。
 * `rules-layer.js` 的渲染器只取 `- ` 开头的行（且跳过日期段）。
 * ⇒ **一条规则 = 一个 `- ` 行**。本模块据此提供：
 *   - `listRuleItemsPre(text)`      → [{ line, indent, text, source }]
 *   - `updateRuleItemPre(text, i, next)` / `removeRuleItemPre(text, i)` / `appendRuleItemPre(text, body)`
 *
 * `source` 的判定：条目若落在 `## YYYY-MM-DD` 段内 ⇒ 归该日期（多为 AI 写入）；
 * 落在段外（文件头部）⇒ 记为 `user`（多为用户手写）。这是 R7-3「标注来源」的依据。
 *
 * ## 纪律
 *   - 纯函数：输入文本、输出文本，**不做任何 IO**（IO 由调用方走既有 writeFull 事务）。
 *   - **删除 = 真删**（见 R7-4）：本层渲染器不认任何状态标记，软删标记会被当正文注入模型。
 *   - 零运行时依赖。CRLF、无 BOM。
 */

/** 日期段标题（与 rules-layer.js 的 DATE_SECTION_RE 同口径）。 */
export const RULE_DATE_SECTION_RE_V1 = /^##\s*\d{4}-\d{2}-\d{2}\s*$/

/** 条目行：允许前导缩进 + `- `（渲染器同样只看 `- ` 行）。 */
export const RULE_ITEM_RE_V1 = /^(\s*)-\s+(.*)$/

/** 单条规则长度上限（与写闸门同量级，防止一次塞进整篇文档）。 */
export const RULE_ITEM_MAX_CHARS_V1 = 2000

/**
 * 列出所有规则条目（**行号从 0 开始**，供后续增删改定位）。
 *
 * @param {string} text  MEMORY.md 全文
 * @returns {Array<{line:number, indent:string, text:string, source:string, dateSection:string|null}>}
 */
export function listRuleItemsPre(text) {
  const lines = String(text == null ? '' : text).split(/\r?\n/)
  const out = []
  let curDate = null
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (RULE_DATE_SECTION_RE_V1.test(l)) { curDate = l.replace(/^##\s*/, '').trim(); continue }
    const m = RULE_ITEM_RE_V1.exec(l)
    if (!m) continue
    const body = m[2].trim()
    if (!body) continue
    out.push({
      line: i,
      indent: m[1] || '',
      text: body,
      // 落在日期段内 ⇒ 多为 AI（memory_user 会带日期标题）写入；否则视为用户手写
      source: curDate ? 'ai' : 'user',
      dateSection: curDate,
    })
  }
  return out
}

/** 内部：切行（保留原始行尾风格判定所需的信息交给 join 处理）。 */
function splitLinesPre(text) { return String(text == null ? '' : text).split(/\r?\n/) }

function joinLinesPre(lines) { return lines.join('\n') }

/**
 * **替换**第 idx 条规则（按 listRuleItemsPre 的顺序）。
 *
 * @returns {{ok:boolean, text?:string, error?:string}}
 */
export function updateRuleItemPre(text, idx, nextBody) {
  const items = listRuleItemsPre(text)
  const body = String(nextBody == null ? '' : nextBody).trim()
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return { ok: false, error: 'index-out-of-range' }
  if (!body) return { ok: false, error: 'empty-body' }
  if (body.length > RULE_ITEM_MAX_CHARS_V1) return { ok: false, error: 'too-long' }
  if (/\r|\n/.test(body)) return { ok: false, error: 'multiline-not-allowed' }
  const lines = splitLinesPre(text)
  const it = items[idx]
  lines[it.line] = it.indent + '- ' + body
  return { ok: true, text: joinLinesPre(lines) }
}

/**
 * **删除**第 idx 条规则（真删，见 R7-4）。
 *
 * ⚠️ 本层渲染器（`renderRulesSectionPre`）不认任何状态标记 ⇒ 软删标记会被当正文注入模型；
 *    故这里**直接移除该行**。不可撤销 —— 调用方必须做二次确认。
 */
export function removeRuleItemPre(text, idx) {
  const items = listRuleItemsPre(text)
  if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) return { ok: false, error: 'index-out-of-range' }
  const lines = splitLinesPre(text)
  lines.splice(items[idx].line, 1)
  return { ok: true, text: joinLinesPre(lines) }
}

/**
 * **追加**一条规则。
 *
 * 落点规则（与用户手写习惯一致，且保证渲染器一定能读到）：
 *   - `dateSection` 为空 ⇒ 追加到**文件头部**（用户手写区，`source` 会是 `user`）；
 *   - 给了 `dateSection` ⇒ 追加到该日期段的**末尾**（AI 写入区）。
 */
export function appendRuleItemPre(text, body, opts = {}) {
  const b = String(body == null ? '' : body).trim()
  if (!b) return { ok: false, error: 'empty-body' }
  if (b.length > RULE_ITEM_MAX_CHARS_V1) return { ok: false, error: 'too-long' }
  if (/\r|\n/.test(b)) return { ok: false, error: 'multiline-not-allowed' }
  const lines = splitLinesPre(text)
  const want = opts && opts.dateSection ? String(opts.dateSection).trim() : ''
  const newLine = '- ' + b
  if (!want) {
    // 头部插入：跳过开头的空行，避免把条目顶到文件最上面的空行之前
    let at = 0
    while (at < lines.length && lines[at].trim() === '') at++
    lines.splice(at, 0, newLine)
    return { ok: true, text: joinLinesPre(lines) }
  }
  // 找目标日期段，插到该段内最后一个非空行之后
  let secAt = -1
  for (let i = 0; i < lines.length; i++) {
    if (RULE_DATE_SECTION_RE_V1.test(lines[i]) && lines[i].replace(/^##\s*/, '').trim() === want) { secAt = i; break }
  }
  if (secAt < 0) return { ok: false, error: 'date-section-not-found' }
  let end = secAt + 1
  while (end < lines.length && !RULE_DATE_SECTION_RE_V1.test(lines[end])) end++
  let ins = end
  while (ins > secAt + 1 && lines[ins - 1].trim() === '') ins--
  lines.splice(ins, 0, newLine)
  return { ok: true, text: joinLinesPre(lines) }
}

/**
 * **预览**：把规则条目渲染成注入时会长的样子（R7-6）。
 *
 * 只做**只读**格式化，不引入 rules-layer.js 的其它依赖（避免循环 import 风险）。
 */
export function previewRulesPre(text) {
  const items = listRuleItemsPre(text)
  return items.map((x) => '- ' + x.text).join('\n')
}

/** 空规则段判定（给 UI 显示空态用）。 */
export function isEmptyRulesPre(text) { return listRuleItemsPre(text).length === 0 }

