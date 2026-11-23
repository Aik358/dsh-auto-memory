export function calendarFieldEncodePre(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|')
}

export function calendarFieldDecodePre(value) {
  return String(value || '').replace(/\\([\\|])/g, '$1')
}

export function calendarQuadrantPre(value) {
  return value === '不重要紧急' ? '紧急不重要' : String(value || '未分类').trim()
}

// ══════════════════════════════════════════════════════════════════════════
// ★★D4（2026-10-29 · 研究报告 03-DEFECTS D4 / 06-审计 §三）：日期与时间的**软校验**
//
// 【缺陷】calendarAdd 此前只校验 quadrant 与 title，date / time **完全不校验**
//   ⇒ 实测 date="not-a-date"、time="99:99" 被原样写进日历并返回「已加入日历」。
//
// 【为什么是软校验而不是硬拒】
//   报告明确要求软校验，依据 ablation `polluted` 臂的教训：
//   硬判据会把正常路径堵死（那次实测 = 0% 合规 + 300s 超时）。
//   而模型目前表现良好（能把「明天」正确换算成 2026-10-30）⇒ 没有硬拒的必要。
//   ⇒ 返回**提示文案**（模型能看到并自纠，用户也能看到），**照写**。
//
// 【判据来源】date 契约 YYYY-MM-DD；time 契约 HH:MM 或 --:--。
//   两者都做**真实性**校验（不只形状）：2026-13-45 形状对但日期不存在，也算不合格。
// ══════════════════════════════════════════════════════════════════════════

/** 日期软校验：合格返回空串，不合格返回给人看的一句提示（调用方照写） */
export function calendarDateWarnPre(value) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return ''   // 缺省由调用方填 todayStr()，不算问题
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  if (!m) {
    return '日期「' + raw + '」不是 YYYY-MM-DD 格式（相对时间需先换算成具体日期，例如「明天」→ 具体年月日）。已按原样记录。'
  }
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  // ★真实性校验：形状对不代表日期存在（2026-13-45 / 2026-02-30 都要拦）
  const dt = new Date(y, mo - 1, d)
  const real = dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
  if (!real) {
    return '日期「' + raw + '」不存在（月份或日超出范围）。已按原样记录，建议更正。'
  }
  if (y < 1970 || y > 2999) {
    return '日期「' + raw + '」年份可疑（' + y + '）。已按原样记录，建议核对。'
  }
  return ''
}

/** 时间软校验：合格返回空串，不合格返回提示（调用方照写） */
export function calendarTimeWarnPre(value) {
  const raw = String(value == null ? '' : value).trim()
  if (!raw) return ''            // 缺省由调用方填 --:--
  if (raw === '--:--') return ''
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw)
  if (!m) {
    return '时间「' + raw + '」不是 HH:MM 格式（无时间请用 --:--）。已按原样记录。'
  }
  const h = Number(m[1]), mi = Number(m[2])
  if (h > 23 || mi > 59) {
    return '时间「' + raw + '」超出 24 小时制范围（时 0-23、分 0-59）。已按原样记录，建议更正。'
  }
  return ''
}
