/**
 * receipt.js —— proposal → 简洁工具文本提醒。
 *
 * 职责边界：
 *   · 把 proposal DTO 渲染成**追加到原工具文本尾部**的几行中文提醒
 *   · 明确区分「既有规则已做了什么」与「模型建议什么」—— 不得伪称已按模型修正
 *
 * 禁止：改变原工具写入结果、写入任何文件、决定归属。
 *
 * ★最重要的一条：模型只是建议。真实写入仍走原路径。
 *   若模型不同意，回执必须说清「当前按既有规则已挂/已新建，模型建议复核另一个事件」，
 *   **不得**写成「已按建议改为 X」。
 */

import { DECISIONS, WARN_CODES } from './contract.js'

const DECISION_CN = {
  [DECISIONS.ATTACH_EXISTING]: '建议挂到已有事件',
  [DECISIONS.CREATE_NEW]: '建议新建事件',
  [DECISIONS.AMBIGUOUS]: '无法区分（多个候选同样合理）',
  [DECISIONS.NOT_APPLICABLE]: '无适用候选',
  [DECISIONS.UNAVAILABLE]: '模型不可用',
}

/**
 * 渲染提醒文本。返回空串表示「无需追加」（模型同意且无风险时保持安静）。
 *
 * @param {object} proposal
 * @param {{ actualDecision?:string, actualEventId?:string|null, dryRun?:boolean,
 *           explicitEventId?:string|null }} [ctx]
 * @returns {string}
 */
export function renderReceiptPre(proposal, ctx = {}) {
  if (!proposal || typeof proposal !== 'object') return ''
  const dec = proposal.decision
  const lines = []
  const codeSet = new Set((proposal.warnings || []).map((w) => w.code))

  // ① unavailable：只在「本可复核却拿不到结果」时提示，且必须说清不等于新建
  if (dec === DECISIONS.UNAVAILABLE) {
    const why = (proposal.warnings || []).find((w) => w.code === WARN_CODES.MODEL_UNAVAILABLE)
    lines.push('⚠ 归属复核不可用（' + String((why && why.message) || '未返回结果').slice(0, 120) + '）')
    lines.push('  ⇒ 本次按既有规则处理，**模型未给出任何归属意见**（不可用 ≠ 建议新建）。')
    return lines.join('\n')
  }

  // ② 模型同意当前处理 ⇒ 安静（不制造噪声）
  const actual = String(ctx.actualDecision || '')
  const agree = (
    (dec === DECISIONS.ATTACH_EXISTING && actual === 'attach' && String(proposal.selectedEventId) === String(ctx.actualEventId))
    || (dec === DECISIONS.CREATE_NEW && (actual === 'create' || actual === 'created'))
  )
  if (agree && !codeSet.has(WARN_CODES.POOL_TRUNCATED) && !codeSet.has(WARN_CODES.SUSPECT_AUTO_ATTACH)) {
    return ''
  }

  // ③ 疑似错误归属（最高优先级提示）
  if (codeSet.has(WARN_CODES.SUSPECT_AUTO_ATTACH)) {
    lines.push('⚠ 疑似错误归属：本条按既有规则已自动挂载，但证据显示可能不属于该事件。')
  }

  // ④ 主判定行
  const head = DECISION_CN[dec] || String(dec)
  if (dec === DECISIONS.ATTACH_EXISTING) {
    const id = String(proposal.selectedEventId || '')
    const cand = (proposal.candidates || []).find((c) => c.eventId === id)
    const sc = (cand && cand.score != null) ? ('，分数 ' + Number(cand.score).toFixed(3)) : ''
    lines.push('归属复核：' + head + ' ' + id + sc)
  } else if (dec === DECISIONS.AMBIGUOUS) {
    const ids = (proposal.candidates || []).slice(0, 4).map((c) => c.eventId)
    lines.push('归属复核：' + head + (ids.length ? '（候选 ' + ids.join(' / ') + '）' : ''))
  } else {
    lines.push('归属复核：' + head)
  }

  // ⑤ 与既有规则不一致时，必须说清「没有改写」
  if (actual && !agree && (dec === DECISIONS.ATTACH_EXISTING || dec === DECISIONS.CREATE_NEW)) {
    if (actual === 'attach' || actual === 'attached' || actual === 'explicit') {
      lines.push('  ⇒ 当前按既有规则已挂在 ' + String(ctx.actualEventId || '（未记录）')
        + '；模型建议的是另一个处置，**未改写**本次写入。')
    } else if (actual === 'create' || actual === 'created') {
      lines.push('  ⇒ 当前按既有规则已新建事件；模型建议的是另一种处置，**未改写**本次写入。')
    } else {
      lines.push('  ⇒ 当前按既有规则处理；模型建议是参考，**未改写**本次写入。')
    }
  }

  // ⑥ 候选池被截断时必须显式声明（不得静默）
  if (codeSet.has(WARN_CODES.POOL_TRUNCATED)) {
    const p = proposal.pool || {}
    lines.push('  ⚠ 候选池不完整：eligible ' + Number(p.eligibleCount) + ' 条，仅展示 '
      + Number(p.visibleCount) + ' 条，未展示 ' + Number(p.omittedCount) + ' 条 ⇒ 结论可辩护性下降。')
  }

  // ⑦ 理由与反假设（各一行，截短）
  const ra = String(proposal.rationale || '').trim()
  if (ra) lines.push('  理由：' + ra.slice(0, 200))
  const ch = String(proposal.counterHypothesis || '').trim()
  if (ch) lines.push('  反假设：' + ch.slice(0, 140))

  // ⑧ dryRun 场景的下一步指引
  if (ctx.dryRun === true && (dec === DECISIONS.ATTACH_EXISTING || dec === DECISIONS.AMBIGUOUS)) {
    lines.push('  下一步：若认同 ⇒ 带 eventId 重调；否则按原判断写入即可。')
  }
  return lines.join('\n')
}

/**
 * 追加到原工具文本尾部。**原文本逐字保留**，只在其后追加。
 *
 * @param {string} originalText 原工具返回值
 * @param {string} receipt 提醒文本（空串则原样返回）
 * @returns {string}
 */
export function appendReceiptPre(originalText, receipt) {
  const base = String(originalText == null ? '' : originalText)
  const tail = String(receipt == null ? '' : receipt)
  if (!tail) return base
  return base + '\n\n' + tail
}

export default { renderReceiptPre, appendReceiptPre }
