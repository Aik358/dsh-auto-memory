/**
 * handoff-checkpoint.js —— 2.7 正文形态：检查点正文的确定性摘要（批次 2 · 2026-11-13）
 *
 * 用户裁定（G-2）：摘要上限 **300 个 JS UTF-16 字符**。它是字符数而非 UTF-8 字节数，
 * 不承诺恰好 150 个汉字；超长必须**可观测**（truncated=true），不能静默丢弃来源。
 *
 * 本模块只做一件事：把**已落盘的** plan/handoff 正文压成一段可复算的短正文。
 *
 * 四条硬约束（与定稿 §3.1 一一对应）：
 *   ① **纯函数、零 IO** —— 不读盘、不写盘、不推断 eventId、不调用模型；
 *   ② **确定性** —— 同一输入逐字节同输出，不含时间戳/随机数/环境相关量；
 *   ③ **四段不从摘要派生** —— sectionsOverride 只回传调用方给的**原始四段**
 *      （调用方应来自 parseHandoffCoveragePre/parseLedgerSectionsPre 对真源正文的解析）。
 *      摘要里可以出现「目标：…」这类短标签，但**绝不能反向解析摘要去填四段**：
 *      摘要本身是截断产物，回填出来的四段必然是残句。
 *   ④ **输入不可变** —— 不修改入参对象/数组，也不依赖调用方后续可变状态。
 *
 * 为什么摘要必须带字段标签：检查点正文会进 event-recall 的召回语料（占 61.81%），
 * 纯截断的前 300 字通常在「任务状态」段就被吃满，读者看不到目标与下一步。
 * 带标签后四段各自留一小截，语义可判读；代价是标签字符（每段 3-4 字）。
 */

/** 摘要上限（JS UTF-16 字符数 · 用户裁定 G-2） */
export const HANDOFF_CHECKPOINT_SUMMARY_CHARS = 300

/** 允许的正文形态 */
export const HANDOFF_CHECKPOINT_KINDS = Object.freeze(['plan', 'handoff'])

/** 四段键序（与 event-store 的 CHECKPOINT_QUAD_FIELDS 同序） */
const QUAD_FIELDS = Object.freeze(['goal', 'state', 'dead', 'next'])

/** 摘要里的短标签（省字节，且与检查点四段字段一一对应） */
const QUAD_LABELS = Object.freeze({ goal: '目标', state: '现状', dead: '失败', next: '下一步' })

/** 段间分隔符（单行更省字符，且不会与账本正文的换行结构混淆） */
const SEGMENT_SEPARATOR = ' / '
const ELLIPSIS = '…'
/** 标题行：账本/白板首行是 # 标题，进摘要没有信息量 */
const TITLE_LINE = /^#{1,6}[ \t]+/

/** 剥 HTML 注释（含半截标记）—— 锚点绝不能进检查点正文（会污染注入面） */
function stripHtmlCommentsPre(s) {
  return String(s == null ? '' : s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--/g, '')
    .replace(/-->/g, '')
}

/** 压成单行：剥注释 → 换行收成分隔符 → 压空白 */
function oneLinePre(s) {
  return stripHtmlCommentsPre(s)
    .replace(/[ \t\r\n]+/g, ' ')
    .trim()
}

/** 码点安全截断：超长时以省略号收尾，保证返回值长度 ≤ n */
function cutPre(s, n) {
  const src = String(s == null ? '' : s)
  if (src.length <= n) return src
  if (n <= 1) return ELLIPSIS
  let end = n - 1
  const code = src.charCodeAt(end)
  // 不切坏代理对（emoji/少见汉字）：退一格再切
  if (code >= 0xdc00 && code <= 0xdfff) end -= 1
  return src.slice(0, Math.max(0, end)) + ELLIPSIS
}

/** 取正文里第一段有信息量的文字（跳过标题行与空行） */
function fallbackBodyPre(text) {
  const lines = stripHtmlCommentsPre(text).split(/\r?\n/)
  const kept = []
  for (const line of lines) {
    const bare = line.trim()
    if (!bare) continue
    if (TITLE_LINE.test(bare)) continue
    kept.push(bare)
  }
  return kept.join(SEGMENT_SEPARATOR)
}

function isPlainObjectPre(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** 收口：保证返回值长度 ≤ 上限，并如实报告是否被截断 */
function finishSummaryPre(kind, body, sectionsOverride, sourceTruncated = false) {
  const overLimit = body.length > HANDOFF_CHECKPOINT_SUMMARY_CHARS
  const text = overLimit ? cutPre(body, HANDOFF_CHECKPOINT_SUMMARY_CHARS) : body
  // truncated 报「原文有没有被丢掉内容」：均分路径即使最终长度合规也必须为 true
  return { ok: true, kind, text, truncated: sourceTruncated || overLimit, sectionsOverride, chars: text.length }
}

/**
 * 生成检查点摘要。
 *
 * @param {{kind:'plan'|'handoff', text:string, quad?:object}} input
 *   text 必须是**已落盘的真源正文**；quad 是调用方对该正文解析出的原始四段。
 *   handoff 必须给 quad（缺了就等于「四段只能从摘要猜」⇒ 直接拒）；plan 无四段合法。
 * @returns {{ok:true, kind:string, text:string, truncated:boolean, sectionsOverride:object, chars:number}
 *          | {ok:false, code:string}}
 */
export function buildHandoffCheckpointSummaryPre(input) {
  if (!isPlainObjectPre(input)) return { ok: false, code: 'input-invalid' }
  const kind = String(input.kind == null ? '' : input.kind)
  if (!HANDOFF_CHECKPOINT_KINDS.includes(kind)) return { ok: false, code: 'kind-invalid' }
  if (typeof input.text !== 'string') return { ok: false, code: 'text-required' }
  const source = input.text
  if (!source.trim()) return { ok: false, code: 'text-empty' }

  const quadInput = input.quad
  if (quadInput != null && !isPlainObjectPre(quadInput)) return { ok: false, code: 'quad-invalid' }
  // handoff 的四段是账本格式的硬要求；缺参数属调用方错误（不是「文档本来没有四段」）。
  // 「文档没有四段」的表现是 quad 存在但四个值都是空串 —— 那种情况允许通过。
  if (kind === 'handoff' && quadInput == null) return { ok: false, code: 'quad-required' }

  const sectionsOverride = {}
  for (const key of QUAD_FIELDS) {
    // ★原样回传（不 oneLine、不裁剪）：这是「原始四段」，必须与真源解析结果逐字一致
    sectionsOverride[key] = quadInput == null ? '' : String(quadInput[key] == null ? '' : quadInput[key])
  }

  const present = []
  for (const key of QUAD_FIELDS) {
    const value = oneLinePre(sectionsOverride[key])
    if (!value) continue
    present.push({ key, value, label: QUAD_LABELS[key] + '：' })
  }

  let body = present.map((item) => item.label + item.value).join(SEGMENT_SEPARATOR)
  // 四段全空（plan 常见，或账本未按四段写）⇒ 退回正文首段文字，仍然确定性
  if (!body) {
    const fallback = fallbackBodyPre(source) || oneLinePre(source)
    if (!fallback) return { ok: false, code: 'summary-empty' }
    return finishSummaryPre(kind, fallback, sectionsOverride)
  }
  // ★truncated 的语义是「**原文被截掉了内容**」，不是「最终字符串超了上限」。
  //   首版把它算成后者 ⇒ 均分后长度必然 ≤300 ⇒ truncated 恒为 false，
  //   调用方会误以为没丢任何内容 —— 直接违反定稿「超长必须可观测」。
  //   实测：repeat 从 40 加到 200（正文 911→4,271 字），摘要恒为 298 字符，而首版 truncated 一直 false。
  const truncated = body.length > HANDOFF_CHECKPOINT_SUMMARY_CHARS
  if (!truncated) return finishSummaryPre(kind, body, sectionsOverride)

  // ★超长时的**均分配额**，而不是「拼起来直接截」。
  //   为什么：直接截断会让最先出现的 goal 吃满 300 字符预算，后面 state/dead/next
  //   整段消失 ⇒ 摘要读起来像「只有目标」。实测本机真实账本正是 goal 段最长。
  //   均分后四段各留一截，读者仍能判断「做到哪、卡在哪、下一步」，代价是每段更短。
  //   注意：只有**超限**才走这条分支 ⇒ 短正文的输出与均分逻辑引入前逐字节相同。
  const overhead = present.reduce((n, item) => n + item.label.length, 0) + SEGMENT_SEPARATOR.length * (present.length - 1)
  const budget = Math.max(present.length, HANDOFF_CHECKPOINT_SUMMARY_CHARS - overhead)
  const per = Math.floor(budget / present.length)
  const balanced = present.map((item) => item.label + cutPre(item.value, Math.max(1, per))).join(SEGMENT_SEPARATOR)
  return finishSummaryPre(kind, balanced, sectionsOverride, true)
}

export default {
  HANDOFF_CHECKPOINT_SUMMARY_CHARS,
  HANDOFF_CHECKPOINT_KINDS,
  buildHandoffCheckpointSummaryPre,
}
