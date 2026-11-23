/**
 * parser.js —— 严格 JSON 提取 + 四态校验 + **真实 eventId 白名单**。
 *
 * 职责边界：
 *   · 从模型自由文本里提取 JSON（容忍代码块/前后废话，但不容忍结构非法）
 *   · 校验 decision 属于四态
 *   · 校验 selectedEventId ∈ 本次给定候选的白名单
 *
 * 禁止：自行猜测或修补非法 ID（模型幻觉必须 fail-closed，不能猜它「本来想说哪个」）。
 *
 * ★与 event-regroup-propose.js 的 extractJsonPre 关系：提取思路同源，
 *   但**四态校验与 eventId 白名单属于本协议**，不复用归并 schema（归并是 members/守恒，语义完全不同）。
 */

import { DECISIONS } from './contract.js'

/** 模型可返回的四态（unavailable 由调用方判定，模型不得自称不可用）。 */
const MODEL_DECISIONS = new Set([
  DECISIONS.ATTACH_EXISTING,
  DECISIONS.CREATE_NEW,
  DECISIONS.AMBIGUOUS,
  DECISIONS.NOT_APPLICABLE,
])

/**
 * 从模型文本里提取 JSON 对象。
 *
 * @param {string} text
 * @returns {{ok:boolean, value?:object, error?:string, code?:string}}
 */
export function extractJsonPre(text) {
  const raw = String(text == null ? '' : text)
  if (!raw.trim()) return { ok: false, code: 'empty', error: '模型输出为空' }
  // ① 整段直接解析
  try {
    const v = JSON.parse(raw.trim())
    if (v && typeof v === 'object') return { ok: true, value: v }
  } catch (_) { /* 继续 */ }
  // ② 剥 markdown 代码块
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) {
    try {
      const v = JSON.parse(fence[1].trim())
      if (v && typeof v === 'object') return { ok: true, value: v }
    } catch (_) { /* 继续 */ }
  }
  // ③ 截取首个 { 到末个 }
  const i = raw.indexOf('{')
  const j = raw.lastIndexOf('}')
  if (i >= 0 && j > i) {
    try {
      const v = JSON.parse(raw.slice(i, j + 1))
      if (v && typeof v === 'object') return { ok: true, value: v }
    } catch (e) {
      return { ok: false, code: 'invalid-json', error: 'JSON 非法：' + String((e && e.message) || e).slice(0, 120) }
    }
  }
  return { ok: false, code: 'no-json', error: '未找到 JSON 对象' }
}

/**
 * 校验模型输出。
 *
 * ★白名单是**硬门**：模型返回的 eventId 必须严格等于给定候选之一。
 *   未知 ID / 已关闭 ID / 未来 ID 一律 fail-closed（返回 ok:false + code），
 *   **不做「最相近 ID 猜测」** —— 那是把模型幻觉洗成可信数据。
 *
 * @param {string} modelText 模型原始输出
 * @param {string[]} allowedEventIds 本次允许的候选 eventId 白名单
 * @returns {{ok:boolean, decision?:string, selectedEventId?:string|null, rationale?:string,
 *            counterHypothesis?:string, code?:string, error?:string}}
 */
export function parseModelOutputPre(modelText, allowedEventIds) {
  const allowed = new Set((Array.isArray(allowedEventIds) ? allowedEventIds : []).map(String))
  const j = extractJsonPre(modelText)
  if (!j.ok) return { ok: false, code: j.code, error: j.error }
  const v = j.value || {}
  const decision = String(v.decision == null ? '' : v.decision).trim()
  if (!MODEL_DECISIONS.has(decision)) {
    return { ok: false, code: 'bad-decision', error: 'decision 非法：' + JSON.stringify(decision).slice(0, 60) }
  }
  let selected = v.selectedEventId
  if (selected == null || selected === '') selected = null
  else selected = String(selected)
  if (decision === DECISIONS.ATTACH_EXISTING) {
    if (!selected) return { ok: false, code: 'missing-event-id', error: 'attach-existing 未给 selectedEventId' }
    if (!allowed.has(selected)) {
      return { ok: false, code: 'invalid-event-id', error: 'selectedEventId 不在候选白名单内：' + selected.slice(0, 80) }
    }
  } else {
    // 非 attach 态若仍给了 ID，只接受白名单内的；白名单外一律拒绝（防止偷偷写入）
    if (selected != null && !allowed.has(selected)) {
      return { ok: false, code: 'invalid-event-id', error: 'selectedEventId 不在候选白名单内：' + selected.slice(0, 80) }
    }
    // ambiguous 必须保留 null（不在候选集里选一个冒充确定）
    if (decision === DECISIONS.AMBIGUOUS) selected = null
  }
  return {
    ok: true,
    decision,
    selectedEventId: selected,
    rationale: String(v.rationale == null ? '' : v.rationale).replace(/\s+/g, ' ').trim().slice(0, 600),
    counterHypothesis: String(v.counterHypothesis == null ? '' : v.counterHypothesis).replace(/\s+/g, ' ').trim().slice(0, 400),
  }
}

export default { extractJsonPre, parseModelOutputPre }
