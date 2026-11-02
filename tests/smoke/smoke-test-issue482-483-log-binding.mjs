#!/usr/bin/env node
/**
 * 批次 K 补充验收：#482（补写过去日期）· #483（日志显式归属事件）
 *
 * 约束：index.js 的 memory_log 执行体需要完整引擎实例（重），本套件分两层：
 *   A 层（功能）：真 import event-write.js 的纯函数，断言 dateAtForMemDatePre 的落点
 *   B 层（契约）：真读 index.js 源码，断言接线存在（这一层是**守卫**，不是功能证据，
 *                 已在下面对应断言文案里显式标注）
 * 负路径：把两处接线改回去 ⇒ B 层必红。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const ROOT = new URL('../../', import.meta.url)
const SRC = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const EW = await import(new URL('../../lib/event-write.js', import.meta.url).href)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m) } else { fail++; console.log('  ✗ ' + m) } }

console.log('\n══ A · dateAtForMemDatePre 真执行（功能证据）══')
ok(typeof EW.dateAtForMemDatePre === 'function', 'A1 dateAtForMemDatePre 已导出')
if (typeof EW.dateAtForMemDatePre === 'function') {
  const B = 450
  const today = EW.memDateOfPre(Date.now(), B)
  // A2：传「今天」⇒ 必须等于 now（默认路径逐字节不变的红线）
  const now = Date.now()
  ok(EW.dateAtForMemDatePre(today, B, now) === now, 'A2 传今天 ⇒ 原样返回 now（默认路径不变）')
  // A3：传昨天 ⇒ 落点必须被 memDateOfPre 判为昨天
  const d = new Date(now); d.setDate(d.getDate() - 1)
  const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  const at = EW.dateAtForMemDatePre(ymd, B, now)
  ok(EW.memDateOfPre(at, B) === ymd, 'A3 传昨天 ⇒ 落点归入昨天（修复前用 now 会归到今天）')
  // A4：反例 —— 直接用 now 会被判成今天，与目标日不同（这就是原缺陷）
  ok(EW.memDateOfPre(now, B) !== ymd, 'A4 负路径：直接用 now ⇒ memDateOfPre 判为今天 ≠ 昨天（原缺陷复现）')
  // A5：非法日期必须抛错，不静默
  let threw = false
  try { EW.dateAtForMemDatePre('2026-13-99', B, now) } catch (_) { threw = true }
  ok(threw, 'A5 非法日期 ⇒ 抛错（不静默回落成今天）')
}

console.log('\n══ B · index.js 接线（守卫，非功能证据）══')
ok(/"dateAtForMemDatePre"/.test(SRC) || /dateAtForMemDatePre/.test(SRC), 'B1 已 import dateAtForMemDatePre')
ok(/at: cpAt/.test(SRC), 'B2 检查点 at 改用 cpAt（不再是写死 Date.now()）')
ok(/dateAtForMemDatePre\(date, engine\.config/.test(SRC), 'B3 cpAt 由目标 date 反解')
ok(/status === 'no-entries-in-date'/.test(SRC), 'B4 回执区分「目标日无可派生条目」')
ok(/目标日视图没有可派生条目/.test(SRC), 'B5 无可派生条目时回执不再宣称「已更新」')

console.log('\n══ C · #483 显式 eventId 归属 ══')
ok(/eventId: \{ type: 'string'/.test(SRC), 'C1 memory_log 参数表新增 eventId')
ok(/args\.eventId/.test(SRC), 'C2 执行体真实消费 args.eventId')
ok(/指定的 eventId 不存在/.test(SRC), 'C3 不存在 ⇒ 报错（不静默改挂）')
ok(/指定的事件已 closed/.test(SRC), 'C4 已关闭 ⇒ 报错（不静默改挂）')
ok(/resolveActiveEventPre\(store0\)/.test(SRC), 'C5 未传 eventId 时仍保留「最近更新」兜底（兼容）')

console.log('\n══ 变异（改回去必红）══')
const mutB3 = SRC.replace("dateAtForMemDatePre(date, engine.config ? engine.config.dayBoundaryMinutes : undefined, cpAt)", 'Date.now()')
ok(!/dateAtForMemDatePre\(date, engine\.config/.test(mutB3), '变异 B3：回退成 Date.now() ⇒ 判据会红')
const mutB4 = SRC.replace(/status === 'no-entries-in-date'/g, "status === '__never__'")
ok(!/status === 'no-entries-in-date'/.test(mutB4), '变异 B4：去掉三态判断 ⇒ 判据会红')
const mutC2 = SRC.replace(/args\.eventId/g, 'null')
ok(!/args\.eventId/.test(mutC2), '变异 C2：不再消费 eventId ⇒ 判据会红')

console.log('\n[K2-batch] pass=' + pass + ' fail=' + fail)
process.exit(fail === 0 ? 0 : 1)
