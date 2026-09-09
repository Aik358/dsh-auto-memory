/**
 * temporal-parse-pre —— 中文时间表达解析(P12 后新增时间检索臂 Phase 1, 2026-09-09)。
 *
 * 目标:把查询里的中文时间表达("上周""三天前""最近一周""上个月"等)解析为
 * [startMs, endMs) 时间范围,供检索的软性第三臂(time arm)做 rank-space 提升。
 * 查询无时间表达 → 返回 null → 调用方零行为变更。
 *
 * 边界:纯函数、零 IO、零依赖;禁止 LLM/第三方日期库;确定性(同输入同 now 逐字节相同输出)。
 * 时刻必须经 opts.now 注入(缺省 Date.now() 仅为便利;测试一律注入)。
 *
 * 时区假设(显式声明):全部自然日/周/月/年边界用宿主**本地时间**计算
 * (new Date(y,m,d) 系列本地方法)。部署机时区为 Asia/Shanghai(CST,UTC+8,无夏令时),
 * 与记忆日志文件名日期(本地日期)一致;若部署到其他时区,范围语义跟随宿主本地时区。
 */

/** 中文数字表(支持零〇一二两三四五六七八九十百,≤999,够 366 上限)。 */
const CN_DIGIT = { '零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 }

/** N 的合法区间(含端点);超界视为未识别。 */
const N_MIN = 1
const N_MAX = 366

const DAY_MS = 86400000

/** 中文/阿拉伯数字 → 整数;非法返回 NaN。 */
function numToInt(s) {
  if (/^\d{1,3}$/.test(s)) return parseInt(s, 10)
  let total = 0
  let num = 0
  for (const ch of String(s)) {
    if (ch === '十') { total += (num || 1) * 10; num = 0 }
    else if (ch === '百') { total += (num || 1) * 100; num = 0 }
    else if (ch === '零' || ch === '〇') { /* 占位,跳过 */ }
    else if (CN_DIGIT[ch] !== undefined) { num = CN_DIGIT[ch] }
    else return NaN
  }
  const out = total + num
  return out > 0 ? out : NaN
}

/** 本地自然日 00:00 的毫秒时间戳。 */
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** 本地自然周(周一 00:00 起)的毫秒时间戳。 */
function startOfWeek(d) {
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return monday.getTime()
}

/** 本地自然月 1 日 00:00 的毫秒时间戳。 */
function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

/** 按本地月序号(可为负,自动借位)取自然月起点。 */
function monthStartShift(d, shift) {
  return new Date(d.getFullYear(), d.getMonth() + shift, 1).getTime()
}

/** 从 d 往前/后 n 个日历月,锚定同一日与时分秒(月末溢出由 Date 自动进位,确定性)。 */
function nowShiftMonths(d, n) {
  return new Date(d.getFullYear(), d.getMonth() + n, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()).getTime()
}

/** 日期 d 所在月的下个月起点。 */
function nextMonthStart(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
}

/**
 * 解析查询文本中的中文时间表达。
 *
 * @param {string} text 查询文本
 * @param {{now?:number}} [opts] now:毫秒时间戳(注入以保证确定性;缺省 Date.now())
 * @returns {null | {startMs:number, endMs:number, matched:string}}
 *   null=未识别到时间表达(调用方零行为变更);否则为半开区间 [startMs, endMs)
 *   与命中的原文子串 matched。多个表达命中时取**首个**(按下方模式表顺序,确定性)。
 */
export function parseTemporalQueryPre(text, opts = {}) {
  try {
    if (typeof text !== 'string' || !text) return null
    const nowMs = Number.isFinite(opts.now) ? opts.now : Date.now()
    const now = new Date(nowMs)
    const today0 = startOfDay(now)
    // 模式表(顺序即优先级:长/特异表达在前,防止子串误配,如"大前天"先于"前天"、"上上周"先于"上周")
    const patterns = [
      { re: /大前天/, fn: () => ({ startMs: today0 - 3 * DAY_MS, endMs: today0 - 2 * DAY_MS }) },
      { re: /前天/, fn: () => ({ startMs: today0 - 2 * DAY_MS, endMs: today0 - DAY_MS }) },
      { re: /昨天/, fn: () => ({ startMs: today0 - DAY_MS, endMs: today0 }) },
      { re: /今天/, fn: () => ({ startMs: today0, endMs: today0 + DAY_MS }) },
      { re: /上上周/, fn: () => ({ startMs: startOfWeek(now) - 14 * DAY_MS, endMs: startOfWeek(now) - 7 * DAY_MS }) },
      { re: /上周/, fn: () => ({ startMs: startOfWeek(now) - 7 * DAY_MS, endMs: startOfWeek(now) }) },
      { re: /本周|这一周|这个星期/, fn: () => ({ startMs: startOfWeek(now), endMs: startOfWeek(now) + 7 * DAY_MS }) },
      { re: /上个月|上月/, fn: () => ({ startMs: monthStartShift(now, -1), endMs: startOfMonth(now) }) },
      { re: /本月|这个月/, fn: () => ({ startMs: startOfMonth(now), endMs: nextMonthStart(now) }) },
      { re: /去年/, fn: () => ({ startMs: new Date(now.getFullYear() - 1, 0, 1).getTime(), endMs: new Date(now.getFullYear(), 0, 1).getTime() }) },
      { re: /今年/, fn: () => ({ startMs: new Date(now.getFullYear(), 0, 1).getTime(), endMs: new Date(now.getFullYear() + 1, 0, 1).getTime() }) },
      // 最近 N 个自然周期:从 now 往前 N 个周期(半开区间 [now-N周期, now));月按日历月锚定 now 时刻
      { re: /最近\s*([0-9零〇一二两三四五六七八九十百]+)\s*个?\s*月/, fn: (m) => {
          const n = numToInt(m[1]); if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return null
          return { startMs: nowShiftMonths(now, -n), endMs: nowMs }
        } },
      { re: /最近\s*([0-9零〇一二两三四五六七八九十百]+)\s*个?\s*(?:星期|周)/, fn: (m) => {
          const n = numToInt(m[1]); if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return null
          return { startMs: nowMs - n * 7 * DAY_MS, endMs: nowMs }
        } },
      { re: /最近\s*([0-9零〇一二两三四五六七八九十百]+)\s*(?:天|日)/, fn: (m) => {
          const n = numToInt(m[1]); if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return null
          return { startMs: nowMs - n * DAY_MS, endMs: nowMs }
        } },
      // N 个月前:定位到那个自然月(整月)
      { re: /([0-9零〇一二两三四五六七八九十百]+)\s*个?\s*月前/, fn: (m) => {
          const n = numToInt(m[1]); if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return null
          return { startMs: monthStartShift(now, -n), endMs: monthStartShift(now, -n + 1) }
        } },
      // N 周(星期)前:定位到那个自然周(周一 00:00 起整周)
      { re: /([0-9零〇一二两三四五六七八九十百]+)\s*个?\s*(?:星期|周)前/, fn: (m) => {
          const n = numToInt(m[1]); if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return null
          const base = startOfWeek(now) - n * 7 * DAY_MS
          return { startMs: base, endMs: base + 7 * DAY_MS }
        } },
      // N 天(日)前:定位到那个自然日 00:00–24:00
      { re: /([0-9零〇一二两三四五六七八九十百]+)\s*(?:天|日)前/, fn: (m) => {
          const n = numToInt(m[1]); if (!Number.isInteger(n) || n < N_MIN || n > N_MAX) return null
          const base = today0 - n * DAY_MS
          return { startMs: base, endMs: base + DAY_MS }
        } },
    ]
    for (const p of patterns) {
      const m = p.re.exec(text)
      if (!m) continue
      const range = p.fn(m)
      if (!range) continue
      return { startMs: range.startMs, endMs: range.endMs, matched: m[0] }
    }
    return null
  } catch (_) {
    return null
  }
}

/**
 * 从 L0 候选 label 抽取候选时间戳(当日 00:00 本地)。
 * label 形如日志/反思文件名(含 YYYY-MM-DD,如 "2026-09-09.md"、"reflections/2026-08-19.md");
 * 非日期来源(".../MEMORY.md"、"~/MEMORY.md")→ null → 时间臂对该候选不参与(中性)。
 */
export function labelToDateMsPre(label) {
  try {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(label || ''))
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isFinite(d.getTime()) ? d.getTime() : null
  } catch (_) {
    return null
  }
}
