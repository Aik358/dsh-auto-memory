/**
 * lib/greeting.js —— v4-H6：问候环节改造（读事件摘要 + 未完成承诺）。
 *
 * ★为什么是改造而非新增段：
 *   区 III（通道区）上限 CHANNEL_ZONE_MAX_CHARS = 300，且已登记 **9 个段**
 *   （water-advisory / plan-update-request / calendar / external-memory / external-sessions /
 *     welcome-title / welcome-body / handoff-pointer / event-unarchived）。
 *   新增第 10 段 ⇒ 再切一刀 300 字预算，且新段优先级又是 normal（最易被丢）；
 *   还要过 ZONE_BY_KIND_PRE_V1 登记（该文件 L34 注释：新增注入段必须在此登记）⇒ 两处成本。
 *   ⇒ 改造已存在的 welcome-title / welcome-body 两段，零登记成本。
 *
 * ★★区 III 的实测水位（2026-10-25，可复现）：
 *   上限 300。同区常驻/常见段实测：
 *     · water-advisory      = 273（1 前导\n + 18 标题 + 1 分隔\n + 253 正文；pct 占位渲染后）
 *     · event-unarchived    = 102（按 L9059-9063 模板逐字重建，n=540）
 *     · handoff-pointer     ≈ 100（未精确复算，仅用于估算）
 *   ⇒ 与 water 同场（must，永不丢）时 welcome 必然被丢 —— 那不是 H6 能解决的，
 *     属「区 III 配额重分配」独立议题（Lead 已裁定另开单，很可能会并入 H7）。
 *
 * ★H6 能改善的部分：把 welcome 压到尽可能小，使它在与 **normal 段**（unarchived 102 等）
 *   同场时不被丢。定稿目标：两段合计 ≤130（title 7 + body ≤123）。
 *
 * ★零依赖设计：不 import 任何模块（源码抽取式沙箱可独立执行）。
 *   纯函数：不读文件、不读全局 Date（now 由 opts 注入）。
 */

/** welcome 两段合计硬上限（Lead 2026-10-25 定稿）。★模块常量，不是配置键。 */
export const WELCOME_TOTAL_MAX_CHARS = 130

/** title 原文长度（'[欢迎回来]' = 6；pushPart 传 '\n' + title ⇒ 占 7）。 */
export const WELCOME_TITLE_RAW = 6

/** body 硬上限 = 合计上限 - title 占位（含前导换行）。 */
export const WELCOME_BODY_MAX_CHARS = WELCOME_TOTAL_MAX_CHARS - (WELCOME_TITLE_RAW + 1)

/** 事件名 / 承诺文案的截断长度（防超长吃爆预算）。 */
export const GREETING_EVENT_NAME_MAX = 24
export const GREETING_PROMISE_MAX = 20

/** 安全截断（不切断代理对）。 */
function cutSafePre(text, max) {
  const s = String(text == null ? '' : text)
  if (!Number.isFinite(max) || max <= 0) return ''
  if (s.length <= max) return s
  if (max <= 1) return '\u2026'
  let cut = s.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return cut + '\u2026'
}

/**
 * 构建问候正文（纯函数）。
 *
 * @param {object} state  需要 { lastActiveAt, events? }
 *   - lastActiveAt: number 上次活跃时间（ms）
 *   - events: Array<{ name, status, commitments? }> 事件列表（可省，省则视为无事件）
 * @param {object} [opts]
 *   - now: number          ★注入当前时间（不读全局 Date）
 *   - awayMinutes: number  ★来自配置（config.awayMinutes，默认 60；0 = 关闭）；非硬编码
 *   - fallbackBody: string 无事件无承诺时退回的静态文案
 * @returns {{ text: string, reasons: string[], mins: number, hasEvent: boolean, openCount: number }}
 *   text 为**严格空串**当未达离开阈值或 awayMinutes<=0（⇒ 段不出现，零字节）。
 */
export function buildGreetingPre(state, opts = {}) {
  const empty = { text: '', reasons: [], mins: 0, hasEvent: false, openCount: 0 }
  const st = state || {}
  const now = Number.isFinite(opts.now) ? opts.now : Date.now()
  // ★阈值来自配置（opts.awayMinutes），不是硬编码常量 —— 测试断言 ⑥ 守这条。
  const awayMinutes = Number.isFinite(opts.awayMinutes) ? opts.awayMinutes : 60
  if (!(awayMinutes > 0)) return empty            // 0 = 关闭（配置语义）
  const lastActiveAt = Number(st.lastActiveAt) || 0
  if (!lastActiveAt) return empty
  const awayMs = now - lastActiveAt
  if (!(awayMs > awayMinutes * 60000)) return empty

  const mins = Math.round(awayMs / 60000)
  const events = Array.isArray(st.events) ? st.events : []

  // ① 活跃事件摘要（只取 1 个 active）
  const active = events.filter((e) => e && e.status === 'active').slice(0, 1)
  const evName = active.length ? cutSafePre(String(active[0].name || '').trim(), GREETING_EVENT_NAME_MAX) : ''

  // ② 未完成承诺：**只统计 state === 'open'**
  //   ★★关键（Lead 断言 ③）：kept（已完成）/任何非 open 状态**都不计入**。
  //   若把 kept 也算进来，用户会看到「还有 1 条约定未完成」但实际已完成 ⇒ 负价值。
  const openCms = []
  for (const e of events) {
    if (!e || !Array.isArray(e.commitments)) continue
    for (const c of e.commitments) {
      if (c && String(c.state || '') === 'open') openCms.push(c)
    }
  }
  const firstPromise = openCms.length ? cutSafePre(String(openCms[0].promise || '').trim(), GREETING_PROMISE_MAX) : ''

  const reasons = []
  if (evName) reasons.push('event')
  if (openCms.length) reasons.push('commitment')

  // ③ 全无 ⇒ 退回静态文案（★不含「上次你在做」，断言 ④ 守）
  if (!reasons.length) {
    const fb = typeof opts.fallbackBody === 'string' && opts.fallbackBody
      ? opts.fallbackBody
      : '用户离开已超过设定时长。回复开头先用一句简短温暖的话欢迎用户回来。'
    return { text: cutSafePre(fb, WELCOME_BODY_MAX_CHARS), reasons, mins, hasEvent: false, openCount: 0 }
  }

  // ④ 组合（按预算增量拼接，超了就截，不超支）
  const parts = ['用户离开约 ' + mins + ' 分钟。']
  if (evName) parts.push('上次在做：' + evName + '。')
  if (openCms.length) parts.push('还有 ' + openCms.length + ' 条约定未完成' + (firstPromise ? '：' + firstPromise : '') + '。')
  parts.push('回复开头用一句自然的话欢迎回来，并自然带出上述进展，不要生硬罗列。')
  const text = cutSafePre(parts.join(''), WELCOME_BODY_MAX_CHARS)
  return { text, reasons, mins, hasEvent: !!evName, openCount: openCms.length }
}

export default { buildGreetingPre, WELCOME_TOTAL_MAX_CHARS, WELCOME_BODY_MAX_CHARS, GREETING_EVENT_NAME_MAX, GREETING_PROMISE_MAX }