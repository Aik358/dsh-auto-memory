#!/usr/bin/env node
/**
 * smoke-test-batch7-20260919-pre.mjs —— 第七批（#74 时间解析四项）
 *
 * **CB-6 nowShiftMonths 月末进位缩窗**：`new Date(y, m+n, d)` 在 d=31、目标月仅 30 天时
 *   **自动进位到下月 1 日** ⇒ now=2026-03-31 的「最近一个月」起点变成 03-03（而非 02-28），
 *   窗口缩水 2–3 天且 29/30/31 日周期性复发；而「N 个月前」走 `monthStartShift(day=1)` 无此病
 *   ⇒ 两臂语义不一致。
 *
 * **CC-3 时间解析三连**：
 *   a) `几十天前` 从「十」起匹配 ⇒ 被当**精确** -10 天（模糊量词落精确日期）；
 *   b) `labelToDateMsPre` 正则未锚定 ⇒ 从 `x2026-09-09y` 类字符串**抽取伪日期**；
 *   c) `new Date(y,m-1,d)` 无范围校验 ⇒ `2026-13-45` 静默进位成 `2027-02-14`。
 */
import { parseTemporalQueryPre, labelToDateMsPre } from '../../lib/temporal-parse-pre.js'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const ok = (c, n, x) => {
  if (c) { pass++; console.log('  ok -', n) }
  else { fail++; console.error('  FAIL -', n, x == null ? '' : x) }
}
const src = () => readFileSync(new URL('../../lib/temporal-parse-pre.js', import.meta.url), 'utf8')
const codeOnly = (t) => String(t).split(/\r?\n/)
  .filter((l) => { const s = l.trim(); return !(s.startsWith('//') || s.startsWith('*') || s.startsWith('/*')) }).join('\n')

// 固定 now = 2026-03-31（月末，正好触发 CB-6）
const NOW = new Date(2026, 2, 31, 10, 0, 0).getTime()
const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

console.log('\n[1] CB-6 月末必须钳制到目标月最后一天（不得进位缩窗）')
{
  const r = parseTemporalQueryPre('最近一个月', { now: NOW })
  ok(r !== null, '「最近一个月」被识别')
  ok(dayOf(r.startMs) === '2026-02-28', '★★ 起点 = 2026-02-28（旧实现进位得 03-03，缩窗 2–3 天）', dayOf(r.startMs))
  ok(dayOf(r.endMs) === '2026-03-31', '★ 终点 = now（不变）', dayOf(r.endMs))
  const code = codeOnly(src())
  ok(/Math\.min\(d\.getDate\(\), lastDayOfTarget\)/.test(code),
    '★★ 显式月末钳制（Math.min(date, 目标月最后一天)）')
}

console.log('\n[2] CC-3a 模糊量词不得落精确日期')
{
  ok(parseTemporalQueryPre('几十天前', { now: NOW }) === null,
    '★★ 「几十天前」→ null（旧：matched=十天前，被当精确 -10 天单日区间）')
  ok(parseTemporalQueryPre('几十个月前', { now: NOW }) === null, '★ 「几十个月前」→ null')
  // 精确量不受影响（回归保护）
  ok(parseTemporalQueryPre('三天前', { now: NOW }) !== null, '★ 「三天前」仍识别（精确量）')
  ok(parseTemporalQueryPre('十天前', { now: NOW }) !== null, '★ 「十天前」仍识别')
  ok(parseTemporalQueryPre('上周', { now: NOW }) !== null, '★ 「上周」仍识别')
  const code = codeOnly(src())
  ok(/text\[m\.index - 1\] === '几'/.test(code), '★★ 模糊量词守卫（前一字为「几」则跳过本模式）')
}

console.log('\n[3] CC-3b label 正则必须锚定（不得抽伪日期）')
{
  ok(labelToDateMsPre('2026-09-09.md') !== null, '★ 标准文件名识别')
  ok(labelToDateMsPre('reflections/2026-08-19.md') !== null, '★ 带目录前缀识别')
  ok(labelToDateMsPre('x2026-09-09y') === null, '★★ 伪日期 x2026-09-09y → null（旧：抽取成功）')
  ok(labelToDateMsPre('MEMORY.md') === null, '★ 无日期 → null')
  ok(labelToDateMsPre('') === null, '★ 空串 → null')
}

console.log('\n[4] CC-3b 日期分量必须范围校验（不得静默进位）')
{
  ok(labelToDateMsPre('2026-13-45.md') === null, '★★ 2026-13-45 → null（旧：进位成 2027-02-14）')
  ok(labelToDateMsPre('2026-02-30.md') === null, '★★ 2月30日 → null（回读校验拦住）')
  ok(labelToDateMsPre('2026-00-10.md') === null, '★ 月份 0 → null')
  ok(labelToDateMsPre('2024-02-29.md') !== null, '★ 闰年 2/29 合法仍识别（不误杀）')
  const code = codeOnly(src())
  ok(/d\.getFullYear\(\) !== Y \|\| d\.getMonth\(\) !== Mo - 1 \|\| d\.getDate\(\) !== D/.test(code),
    '★★ 回读校验（防 Date 静默进位）')
}

console.log('\n[5] 反向锁：三项修复都不得回退')
{
  const code = codeOnly(src())
  ok(!/new Date\(d\.getFullYear\(\), d\.getMonth\(\) \+ n, d\.getDate\(\),/.test(code),
    '★★ nowShiftMonths 不再直接 Date 进位')
  ok(!/const m = \/\(\\d\{4\}\)-\(\\d\{2\}\)-\(\\d\{2\}\)\/\.exec/.test(code),
    '★★ label 正则不再裸露未锚定')
  ok(/if \(!\(Mo >= 1 && Mo <= 12\)\) return null/.test(code), '★★ 月份范围校验存在')
  ok(/if \(!\(D >= 1 && D <= 31\)\) return null/.test(code), '★★ 日期范围校验存在')
}

console.log(`\n[batch7-20260919] ${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
