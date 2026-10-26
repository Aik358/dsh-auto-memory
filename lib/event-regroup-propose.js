/**
 * event-regroup-propose.js —— ★R3（2026-10-27）：**AI 输出解析 + 提案构造**。
 *
 * 职责边界：
 *   · R1 = 纯函数（闸门/建议/守恒）
 *   · R2 = 只读扫描 + prompt 构造
 *   · **R3 = 本模块**：解析子代理的 JSON 输出 → 严格校验 → 构造提案对象
 *   · R6 = apply（令牌 + 快照 + 落盘）
 *
 * ★本模块**仍不写盘**（除了可选的提案文件落盘，需显式传 path）。
 *   它做的是「把 AI 的自由文本变成可信结构化数据」——这是最容易被 AI 幻觉污染的一环，
 *   所以校验必须**极严**：任何一条不合格都整批拒绝（fail-closed）。
 */

import { validateEventNamePre, validateRegroupConservationPre, buildProposalPre } from './event-regroup.js'

/** 单条事件名上限（与 validateEventNamePre 一致）。 */
export const NAME_MAX = 60
/** 单条 summary 上限。 */
export const SUMMARY_MAX = 400
/** 四段内容单项上限。 */
export const SECTION_MAX = 2000

/**
 * 从 AI 的自由文本里**提取 JSON**（容忍 markdown 代码块 / 前后废话）。
 *
 * ★为什么必须容忍：子代理经常忘了「只输出 JSON」，会包一层 ```json 或加解释。
 *   但容忍**不等于放水**——提取后仍要过严格结构校验。
 *
 * @param {string} text
 * @returns {{ok:boolean, value?:object, error?:string}}
 */
export function extractJsonPre(text) {
  const raw = String(text == null ? '' : text)
  if (!raw.trim()) return { ok: false, error: 'empty: AI 输出为空' }

  // ① 先试整段直接解析
  try {
    const v = JSON.parse(raw.trim())
    if (v && typeof v === 'object') return { ok: true, value: v }
  } catch (_) { /* 继续尝试 */ }

  // ② 剥 markdown 代码块
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) {
    try {
      const v = JSON.parse(fence[1].trim())
      if (v && typeof v === 'object') return { ok: true, value: v }
    } catch (_) { /* 继续 */ }
  }

  // ③ 从第一个 { 到最后一个 } 之间截取
  const i = raw.indexOf('{')
  const j = raw.lastIndexOf('}')
  if (i >= 0 && j > i) {
    try {
      const v = JSON.parse(raw.slice(i, j + 1))
      if (v && typeof v === 'object') return { ok: true, value: v }
    } catch (e) {
      return { ok: false, error: 'invalid-json: ' + String(e && e.message || e).slice(0, 120) }
    }
  }
  return { ok: false, error: 'no-json: 未找到 JSON 对象' }
}

/**
 * 校验并规整 AI 返回的单条事件。**任何一项不合格就整条拒绝**。
 *
 * @param {object} ev AI 给的一条事件
 * @param {Set<string>} allowedMembers 本批允许出现的账本名
 * @returns {{ok:boolean, event?:object, error?:string, code?:string}}
 */
export function validateAiEventPre(ev, allowedMembers) {
  const e = ev && typeof ev === 'object' ? ev : null
  if (!e) return { ok: false, code: 'not-object', error: '事件不是对象' }

  // ① 事件名（过 R1 的五条闸门）
  const nv = validateEventNamePre(e.name)
  if (!nv.ok) return { ok: false, code: 'bad-name:' + nv.code, error: '事件名不合格：' + nv.message }

  // ② summary
  const summary = String(e.summary == null ? '' : e.summary).replace(/\s+/g, ' ').trim()
  if (summary.length > SUMMARY_MAX) {
    return { ok: false, code: 'summary-too-long', error: 'summary 超过 ' + SUMMARY_MAX + ' 字（' + summary.length + '）' }
  }

  // ③ members：非空 + 类型 + 全部在本批允许集合内
  const members = Array.isArray(e.members) ? e.members.map((x) => String(x == null ? '' : x)) : []
  if (!members.length) return { ok: false, code: 'no-members', error: 'members 不能为空（事件必须有账本）' }
  const outside = members.filter((m) => !allowedMembers.has(m))
  if (outside.length) {
    return { ok: false, code: 'member-outside-batch', error: 'members 含本批之外的账本：' + outside.slice(0, 3).join(', ') }
  }

  // ④ sections（四段，各自夹断）
  const sIn = (e.sections && typeof e.sections === 'object') ? e.sections : {}
  const clip = (x) => String(x == null ? '' : x).replace(/\r\n/g, '\n').trim().slice(0, SECTION_MAX)
  const sections = {
    goal: clip(sIn.goal),
    doing: clip(sIn.doing),
    deadend: clip(sIn.deadend),
    next: clip(sIn.next),
  }

  return {
    ok: true,
    event: {
      name: nv.clean,
      summary,
      members,
      sections,
      // ★来源标记：便于 R6 落盘时区分「AI 重整」与「人工/旧版创建」
      origin: 'regroup-ai',
    },
  }
}

/**
 * 解析一整批 AI 输出 → 校验 → 返回可信的事件数组。**fail-closed**。
 *
 * 校验链（任一环失败 ⇒ 整批拒绝，不返回半成品）：
 *   ① JSON 可提取
 *   ② 有 events 数组且非空
 *   ③ 每条事件独立校验（名称闸门 / members 在批内 / 长度）
 *   ④ **守恒**：members 并集 == 本批账本全集（不重不漏不多）
 *
 * @param {string} aiText AI 原始输出
 * @param {string[]} batchLedgerNames 本批账本名（守恒基准）
 * @returns {{ok:boolean, events?:Array, error?:string, code?:string, conservation?:object}}
 */
export function parseAiBatchPre(aiText, batchLedgerNames) {
  const names = Array.isArray(batchLedgerNames) ? batchLedgerNames.map(String) : []
  const allowed = new Set(names)

  const j = extractJsonPre(aiText)
  if (!j.ok) return { ok: false, code: 'extract-failed', error: j.error }

  const root = j.value
  const arr = Array.isArray(root.events) ? root.events : null
  if (!arr) return { ok: false, code: 'no-events-field', error: 'AI 输出缺少 events 数组' }
  if (!arr.length) return { ok: false, code: 'empty-events', error: 'AI 返回了空 events（本批有 ' + names.length + ' 篇账本）' }

  const events = []
  for (let i = 0; i < arr.length; i++) {
    const v = validateAiEventPre(arr[i], allowed)
    if (!v.ok) {
      return {
        ok: false,
        code: 'event-invalid:' + v.code,
        error: '第 ' + (i + 1) + ' 条事件不合格：' + v.error,
      }
    }
    events.push(v.event)
  }

  // ④ 守恒（★防线核心：AI 最容易在这里出错 —— 漏一篇或多算一篇）
  const cons = validateRegroupConservationPre(names, events)
  if (!cons.ok) {
    const detail = []
    if (cons.missing.length) detail.push('漏 ' + cons.missing.length + ' 篇（' + cons.missing.slice(0, 3).join(', ') + '）')
    if (cons.duplicated.length) detail.push('重复 ' + cons.duplicated.length + ' 篇（' + cons.duplicated.slice(0, 3).join(', ') + '）')
    if (cons.unknown.length) detail.push('多出 ' + cons.unknown.length + ' 篇（' + cons.unknown.slice(0, 3).join(', ') + '）')
    return { ok: false, code: 'conservation-failed', error: '成员守恒失败：' + detail.join('；'), conservation: cons }
  }

  return { ok: true, events, conservation: cons }
}

/**
 * 把多批解析结果**合并**成一份完整提案（供 R6 人审）。
 *
 * ★多批合并的两个风险（方案已列）：
 *   ① **批次间重复**：同一篇账本在两批都被分到（不可能 —— 分批本身互斥，但不同工作区
 *      可能出现同名文件）⇒ 用 `workspaceId + '/' + name` 做全局键。
 *   ② **批次间口径漂移**：第 1 批与第 15 批判断不一致 ⇒ 本函数不解决（那是 prompt 层已内置
 *      判据的作用），但会**统计每批产出的平均事件大小**供人审时发现异常。
 *
 * @param {Array<{workspaceId:string, events:Array}>} batches
 * @param {{workspace?:string, existingEvents?:Array, generatedAt?:number}} meta
 * @returns {{ok:boolean, proposal?:object, error?:string}}
 */
export function mergeBatchesPre(batches, meta = {}) {
  const list = Array.isArray(batches) ? batches : []
  const groups = []
  const seen = new Map() // 全局键 -> 出现次数

  for (const b of list) {
    const ws = String((b && b.workspaceId) || '')
    const evs = Array.isArray(b && b.events) ? b.events : []
    for (const e of evs) {
      const members = (Array.isArray(e.members) ? e.members : []).map((m) => ws + '/' + String(m))
      for (const k of members) seen.set(k, (Number(seen.get(k)) || 0) + 1)
      groups.push({
        name: e.name,
        summary: e.summary,
        members,
        sections: e.sections,
        origin: e.origin || 'regroup-ai',
        workspaceId: ws,
      })
    }
  }

  // 跨批重复检查（同一 workspaceId/name 被两个事件收走 ⇒ 数据错误）
  const dup = []
  for (const [k, n] of seen) if (n > 1) dup.push(k)
  if (dup.length) {
    return { ok: false, error: '跨批重复成员：' + dup.slice(0, 5).join(', '), duplicated: dup }
  }

  const proposal = buildProposalPre({
    workspace: meta.workspace,
    events: meta.existingEvents,
    groups,
    generatedAt: meta.generatedAt || 0,
  })
  // 补充可审计信息
  proposal.batchCount = list.length
  proposal.avgEventSize = groups.length ? (groups.reduce((a, g) => a + g.members.length, 0) / groups.length) : 0
  proposal.memberTotal = groups.reduce((a, g) => a + g.members.length, 0)
  return { ok: true, proposal }
}

export default {
  NAME_MAX,
  SUMMARY_MAX,
  SECTION_MAX,
  extractJsonPre,
  validateAiEventPre,
  parseAiBatchPre,
  mergeBatchesPre,
}