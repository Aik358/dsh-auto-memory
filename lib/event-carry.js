#!/usr/bin/env node
/**
 * lib/event-carry.js —— v4 批次 E · 接续链的事件绑定（纯函数，零 IO）。
 *
 * 为什么需要独立模块：
 *   lib/index.js 里的 carryText 组装（buildContinueCarry）体量大、依赖多，无法被
 *   new Function 抽取式测试单独执行。而「新会话必须知道自己正在续接哪个事件」是**唯一**
 *   能防止「同一任务被建成第二个事件」的机制（INJECTION-PLAN §3.0 的硬结论），
 *   必须能被独立、真执行地验证。
 *
 * 契约（由 MASTER-PLAN / INJECTION-PLAN §3.2 新增 A 定义）：
 *   - 事件绑定块进 **head 区**（永不截断），与 nav 区同等待遇 —— 它是「逃生通道」同族；
 *   - 格式固定两行：【事件绑定】… / 【未完成项】…；
 *   - 无事件时**返回空串**（零字节），不得输出「(无事件)」之类占位（会让模型误以为有事件）。
 */

export const EVENT_CARRY_VERSION = 'event_carry_pre_v1'

/** 未完成项最多列几条。多于此数会让 head 区膨胀（head 永不截断，写多了挤 nav）。 */
export const EVENT_CARRY_MAX_PENDING = 3

/** 单条未完成项文本上限（含省略号）。 */
export const EVENT_CARRY_PENDING_MAX_CHARS = 80

const STATUS_TXT = Object.freeze({ active: '进行', paused: '搁置', closed: '完成' })

/**
 * 从事件的 sections.next 里抽「未完成项」。
 * 判据：按行切，去掉空行与已完成标记（- [x] / ✓ / 已完成），最多取 max 条。
 * 为什么从 sections.next 而不是 checkpoints：checkpoints 是历史流水，sections.next 才是
 * 「当前还没做完的」（这是四段结构的设计意图）。
 */
export function pendingFromEventPre(ev, max = EVENT_CARRY_MAX_PENDING) {
  if (!ev || typeof ev !== 'object') return []
  const next = String((ev.sections && ev.sections.next) || '')
  if (!next.trim()) return []
  const out = []
  for (const raw of next.split(/\r?\n/)) {
    let line = String(raw || '').trim()
    if (!line) continue
    // 已完成的不算未完成项
    if (/^[-*]\s*\[[xX]\]/.test(line)) continue
    if (/^✓/.test(line)) continue
    if (/(已完成|已做完|^完成$)/.test(line)) continue
    line = line.replace(/^[-*]\s*/, '').replace(/^\[[ \]]\s*/, '').trim()
    if (!line) continue
    if (line.length > EVENT_CARRY_PENDING_MAX_CHARS) line = line.slice(0, EVENT_CARRY_PENDING_MAX_CHARS - 1) + '…'
    out.push(line)
    if (out.length >= Math.max(0, Math.floor(max))) break
  }
  return out
}

/**
 * 渲染事件绑定块（进 carry 的 head 区）。
 * 无事件 / 无 id ⇒ 返回 ''（**零字节**，这是硬约定：空串才不会被拼进 head）。
 */
export function renderEventBindingPre(ev) {
  if (!ev || typeof ev !== 'object') return ''
  const id = String(ev.id == null ? '' : ev.id).trim()
  if (!id) return ''
  const name = String(ev.name == null ? '' : ev.name).trim()
  const st = String(ev.status == null ? '' : ev.status)
  const stTxt = STATUS_TXT[st] || st || '未知'
  const pend = pendingFromEventPre(ev)
  const L = []
  L.push('【事件绑定】eventId=' + id + '  name="' + name + '"  status=' + st)
  L.push('（你正在续接**同一件事**：本轮所有写入都带 eventId=' + id + '；不要用 memory_event(action=create) 重复建；这件事当前状态=' + stTxt + '）')
  if (pend.length) L.push('【未完成项】' + pend.map((p, i) => '(' + (i + 1) + ') ' + p).join('  '))
  return L.join('\n')
}

/**
 * 接续材料「事件存在性」硬门判据（INJECTION-PLAN §3.2 新增 B）。
 * 为什么需要：现有硬门只认 PLAN/账本/转写包 ⇒「事件已建但还没写账本」的会话接不过去，
 *   而那恰恰是 v4 新工作区的常态（刚建事件、还没产出账本）。
 * 判据：事件存在 且 (status='active' 或 有 checkpoints)。paused 且有检查点也算 —— 搁置后拾起是真实场景。
 */
export function eventCarriesMaterialPre(ev) {
  if (!ev || typeof ev !== 'object') return false
  if (!String(ev.id == null ? '' : ev.id).trim()) return false
  if (String(ev.status || '') === 'active') return true
  return Array.isArray(ev.checkpoints) && ev.checkpoints.length > 0
}

/**
 * 从事件列表里挑「接续该用哪个事件」。
 * 判据：优先 active；同状态按 updatedAt 倒序。没有 active 就取最近一个有检查点的（搁置后拾起）。
 * 返回 null 表示「没有可作为接续材料的事件」。
 */
export function pickCarryEventPre(events) {
  const list = Array.isArray(events) ? events.filter((e) => e && typeof e === 'object' && String(e.id || '').trim()) : []
  if (!list.length) return null
  const byUpdated = list.slice().sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
  const active = byUpdated.find((e) => String(e.status || '') === 'active')
  if (active) return active
  const withCp = byUpdated.find((e) => Array.isArray(e.checkpoints) && e.checkpoints.length > 0)
  return withCp || null
}

export default {
  EVENT_CARRY_VERSION,
  EVENT_CARRY_MAX_PENDING,
  EVENT_CARRY_PENDING_MAX_CHARS,
  pendingFromEventPre,
  renderEventBindingPre,
  eventCarriesMaterialPre,
  pickCarryEventPre,
}