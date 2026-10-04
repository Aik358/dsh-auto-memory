/**
 * 自动沉淀**解析层确定性过滤** + [USER] 写入门槛（#167 / 审计 §G1 P0 + P1）。
 *
 * 为什么是纯函数模块：审计明确要求「**不得依赖模型判断**」，且过滤行为必须可复现——
 * 同一输入重复多次结果必须逐字节一致。本模块零 IO、零随机、零时钟，天然满足；
 * 确定性自证见 tests/smoke/smoke-test-audit-g-consolidate-filter.mjs（同输入跑 5 次全等）。
 *
 * 覆盖审计列出的四类穿透：
 *   ① 空壳变体（旧实现只拦字面 `(无)`，`无` / `暂无` / `没有值得记录的` 可穿透）；
 *   ② 过程叙述开头（「我排查了…」「尝试…」）——只落结论，不落过程；
 *   ③ 过短要点（低于 MIN_POINT_CHARS 的字面）；
 *   ④ 重复要点（同段内去重，保序）。
 */

/** 空壳要点：整条就是「无 / 没有 / 暂无 / none / n/a」及其标点变体。 */
const EMPTY_SHELL_POINT_RE_PRE_V1 = /^(?:[（(【\[]?\s*)?(?:无|沒有|没有|暂无|暫無|none|nothing|n\/a|nil)(?:\s*[）)】\]。，,．.]?)?$/i

/** 过程叙述开头（含可选主语）。命中即视为「过程复述」，不落记忆。 */
const ACTION_LEAD_RE_PRE_V1 = /^(?:我|我们|本人|助手|模型|AI|系统)?\s*(?:考虑|排查|检查|尝试|讨论|分析了|分析|查看了|查看|搜索|思考|想了想|准备|计划要|先|然后|接着|最后|试了|跑了|看了一下)/

/** 要点最小字数（审计 §G1 P1「低于 N 字」；N=8）。 */
export const MIN_POINT_CHARS_PRE_V1 = 8

/**
 * 确定性过滤要点列表。
 * @param {unknown} points 原始要点（可含任何类型；非数组即视为空）
 * @param {{minChars?: number}} [opts]
 * @returns {{kept: string[], dropped: {text: string, reason: string}[]}}
 */
export function filterPointsPre(points, opts) {
  const rawMin = Number(opts && opts.minChars)
  const minChars = Number.isFinite(rawMin) && rawMin > 0 ? rawMin : MIN_POINT_CHARS_PRE_V1
  const kept = []
  const dropped = []
  const seen = new Set()
  const list = Array.isArray(points) ? points : []
  for (const item of list) {
    const text = String(item == null ? '' : item).trim()
    if (!text) { dropped.push({ text, reason: 'empty' }); continue }
    if (EMPTY_SHELL_POINT_RE_PRE_V1.test(text)) { dropped.push({ text, reason: 'empty-shell' }); continue }
    if (ACTION_LEAD_RE_PRE_V1.test(text)) { dropped.push({ text, reason: 'action-narration' }); continue }
    if (text.length < minChars) { dropped.push({ text, reason: 'too-short' }); continue }
    if (seen.has(text)) { dropped.push({ text, reason: 'duplicate' }); continue }
    seen.add(text)
    kept.push(text)
  }
  return { kept, dropped }
}

/** 该批要点过滤后是否还有可写内容（空段则不写）。 */
export function hasKeptPointsPre(points, opts) {
  return filterPointsPre(points, opts).kept.length > 0
}

/**
 * [USER] 写入门槛（P0）：自动沉淀产出的 [USER] 要点**一律不进全局用户级记忆**，
 * 只落「待确认区」（由调用方写到 pending 文件），人工确认后才可晋升。
 * 本函数本身不写盘，只做「过滤 + 放行判定」，便于确定性回归。
 * @returns {{pending: string[], dropped: {text: string, reason: string}[]}}
 */
export function userGatePre(points, opts) {
  const r = filterPointsPre(points, opts)
  return { pending: r.kept, dropped: r.dropped }
}

/** 供调用方复用的正则（便于守卫断言真实存在，而非复制字符串）。 */
export const CONSOLIDATE_FILTER_RES_PRE_V1 = Object.freeze({
  emptyShell: EMPTY_SHELL_POINT_RE_PRE_V1,
  actionLead: ACTION_LEAD_RE_PRE_V1,
})
