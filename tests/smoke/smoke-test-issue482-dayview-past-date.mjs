// issue#482 验收：memory_log 指定过去日期时，条目落到"今天"、目标文件不生成、回执仍说成功。
//
// 缺陷（修复前，HEAD 6a3da76a）：
//   · lib/index.js memory_log：业务日期 date（→ <projectDir>/<date>.md）与记录时间
//     checkpoint.at = Date.now() 取自**两个互不相关的源**；
//   · lib/event-write.js:227 renderDayViewPre 按 memDateOfPre(cp.at, boundary) 归日
//     ⇒ 补写过去日期时，条目必然落进"今天"那份日视图；
//   · lib/event-write.js:275-278 目标日无条目时返回 { ok:true, appended:0, skipped:0 }
//     —— 与"真成功但全部行已存在"**形状完全一样** ⇒ 调用方无法如实回执。
//   影响面三叠加：补写的历史条目丢失 / 该条目污染今天的日志 / 回执撒谎。
//
// 本套件是**功能验收（CR-10）**：真 import → 真构造 store → 真调纯函数/派生函数 → 断言返回值与磁盘。
//   [A] 现象复现：at=Now ⇒ renderDayViewPre(昨天) 为空（这是修复前基线，也是自然负路径）
//   [B] dateAtForMemDatePre 纯函数：返回値必须落在目标记忆日（boundary 0/450/720 全扫）
//   [C] 接上 at=dateAtForMemDatePre(昨天) ⇒ renderDayViewPre(昨天) 命中、derive 真写文件
//   [D] 今天那份日视图不再被污染（appended=0），目标日与今天的行集合互不干扰
//   [E] 默认路径保真：nowMs 本身在目标日 ⇒ 原样返回（memory_log 不传 date 时逐字节不变）
//   [F] deriveDayViewToDiskPre 回执能区分 no-entries-in-date / written / all-present
//   [G] 非法入参 fail-closed（不许静默回落到今天 —— 那正是 #482 的缺陷家族）
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
process.on('uncaughtException', (e) => { console.error('[482] FATAL:', (e && e.stack || e.message) || e); process.exit(1) })
process.on('unhandledRejection', (r) => { console.error('[482] REJ:', r); process.exit(1) })

const EW = await import('../../lib/event-write.js')
const { memDateOfPre, dateAtForMemDatePre, renderDayViewPre, deriveDayViewToDiskPre } = EW

let pass = 0, fail = 0
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) } else { fail++; console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) } }

const B = 450
const pad2 = (n) => (n < 10 ? '0' : '') + n
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
const NOW = Date.now()
const TODAY = memDateOfPre(NOW, B)
const dY = new Date(NOW); dY.setDate(dY.getDate() - 1)
const YESTERDAY = ymd(dY)
const dT = new Date(NOW); dT.setDate(dT.getDate() + 1)
const TOMORROW = ymd(dT)
console.log('日界 ' + B + ' 分钟 · TODAY=' + TODAY + ' · YESTERDAY=' + YESTERDAY)

const DIR = mkdtempSync(path.join(tmpdir(), 'dam-482-'))
const cpOf = (at, text) => ({ at, kind: 'log', text, panels: [] })
const mkStore = (cps) => ({ schema: 'v4_event_store_v2', events: [{ id: 'evt_0000aaaa', name: 'x', status: 'active', checkpoints: cps }] })

console.log('')
console.log('=== A. 现象复现：at = Date.now() ⇒ 昨天那份日视图为空（修复前基线）===')
const storeNow = mkStore([cpOf(NOW, '- 12:00 [kind:fact] 补写昨天的条目')])
ok(renderDayViewPre(storeNow, YESTERDAY, B) === '', 'A-1 ★at=Now 时 renderDayViewPre(昨天) 为空串（缺陷现象）')
ok(renderDayViewPre(storeNow, TODAY, B).indexOf('补写昨天的条目') >= 0, 'A-2 同一条目落在"今天"（污染今天）')
const logY = path.join(DIR, YESTERDAY + '.md')
const ioMem = { readText: async () => '', appendText: async () => {} }
const rA = await deriveDayViewToDiskPre({ logPath: logY }, storeNow, YESTERDAY, ioMem, B)
ok(rA.appended === 0, 'A-3 ★derive(昨天) appended=0（什么也没写）', JSON.stringify({ appended: rA.appended, skipped: rA.skipped }))
ok(rA.status === 'no-entries-in-date', 'A-4 ★回执可判：status=no-entries-in-date（修复前是裸 ok:true）', rA.status)

console.log('')
console.log('=== B. dateAtForMemDatePre：返回値必须落在目标记忆日 ===')
const callSafe = (fn) => { try { return { ok: true, v: fn() } } catch (e) { return { ok: false, e: String((e && e.message) || e) } } }
const b1 = callSafe(() => dateAtForMemDatePre(YESTERDAY, B))
ok(b1.ok === true && memDateOfPre(b1.v, B) === YESTERDAY, 'B-1 boundary=450 ⇒ 落在昨天', b1.ok ? new Date(b1.v).toString().slice(0, 24) : '抛错:' + b1.e)
const boundaryAll = [0, 60, 180, 270, 450, 600, 720, 900, 1200]
let bBad = []
for (const b of boundaryAll) {
  for (const day of [TODAY, YESTERDAY, '2026-01-01', '2026-02-28', '2026-12-31']) {
    try { if (memDateOfPre(dateAtForMemDatePre(day, b), b) !== day) bBad.push(day + '@' + b) } catch (e) { bBad.push(day + '@' + b + ':' + e.message) }
  }
}
ok(bBad.length === 0, 'B-2 ★boundary × 日期 全组合（9×5=45 例）返回値都落在目标日', bBad.slice(0, 3).join(' | ') || '0 例外')
// ★下面每一步都用 callSafe 包住：变异时 dateAtForMemDatePre 会抛错，
//   若直接调用则整个套件在第一个抛错处终止，后续断言**根本不会执行** ⇒ 变异数值不完整、失去鉴别力。
const bAtY = callSafe(() => dateAtForMemDatePre(YESTERDAY, B))
const atY = bAtY.ok ? bAtY.v : NaN
ok(bAtY.ok && new Date(atY).getHours() === 12, 'B-3 落点是当日 12:00（远离任何日界）', bAtY.ok ? new Date(atY).getHours() + ':00' : '抛错')
ok(bAtY.ok && atY < NOW, 'B-4 昨天的落点确实早于现在')
const bLeap = callSafe(() => memDateOfPre(dateAtForMemDatePre('2024-02-29', B), B))
ok(bLeap.ok && bLeap.v === '2024-02-29', 'B-5 闰日 2024-02-29 正确', bLeap.ok ? bLeap.v : '抛错:' + bLeap.e)

console.log('')
console.log('=== C. 接上 at=dateAtForMemDatePre(昨天) ⇒ 条目真落到昨天 ===')
const storeFixed = mkStore([cpOf(atY, '- 12:34 [kind:fact] 昨天的条目-482')])
const dvy = renderDayViewPre(storeFixed, YESTERDAY, B)
ok(dvy === '- 12:34 [kind:fact] 昨天的条目-482\n', 'C-1 ★renderDayViewPre(昨天) 命中该条目', JSON.stringify(dvy))
ok(renderDayViewPre(storeFixed, TODAY, B) === '', 'C-2 昨天那份不再污染今天')

const logDir = mkdtempSync(path.join(DIR, 'day-'))
const logY2 = path.join(logDir, YESTERDAY + '.md')
const ioDisk = {
  readText: async (p) => { try { return readFileSync(p, 'utf8') } catch (_) { return '' } },
  appendText: async (p, t) => { const fs = await import('node:fs'); fs.appendFileSync(p, t + '\n'); return readFileSync(p, 'utf8') },
}
const rC = await deriveDayViewToDiskPre({ logPath: logY2 }, storeFixed, YESTERDAY, ioDisk, B)
ok(rC.appended === 1, 'C-3 ★derive(昨天) appended=1（真写）', JSON.stringify({ appended: rC.appended, skipped: rC.skipped }))
ok(rC.status === 'written', 'C-4 回执 status=written', rC.status + ' / ' + rC.reason)
ok(existsSync(logY2), 'C-5 ★昨天的 .md 文件真被创建')
const c6 = callSafe(() => readFileSync(logY2, 'utf8').indexOf('昨天的条目-482') >= 0)
ok(c6.ok && c6.v === true, 'C-6 文件内容含该条目', c6.ok ? '' : '文件不存在')

console.log('')
console.log('=== D. 目标日与今天互不串味 ===')
const rD = await deriveDayViewToDiskPre({ logPath: logY2 }, storeFixed, YESTERDAY, ioDisk, B)
ok(rD.appended === 0 && rD.skipped === 1, 'D-1 重跑幂等：0 追加 / 1 跳过', JSON.stringify({ a: rD.appended, s: rD.skipped }))
ok(rD.status === 'all-present', 'D-2 ★回执可判：status=all-present（与 no-entries-in-date 明确区分）', rD.status)
const rDToday = await deriveDayViewToDiskPre({ logPath: path.join(logDir, TODAY + '.md') }, storeFixed, TODAY, ioDisk, B)
ok(rDToday.appended === 0 && rDToday.status === 'no-entries-in-date', 'D-3 ★今天那份 0 追加且 status=no-entries-in-date（不被污染）', rDToday.status)
ok(!existsSync(path.join(logDir, TODAY + '.md')), 'D-4 今天不生成空文件')

console.log('')
console.log('=== E. 默认路径保真：nowMs 在目标日 ⇒ 原样返回真实时刻 ===')
const same = dateAtForMemDatePre(TODAY, B, NOW)
ok(same === Math.floor(NOW), 'E-1 ★nowMs 落在目标日 ⇒ 原样返回（memory_log 不传 date 时 at 不变）', same + ' vs ' + Math.floor(NOW))
const e2 = callSafe(() => dateAtForMemDatePre(YESTERDAY, B, NOW))
ok(e2.ok && e2.v !== Math.floor(NOW), 'E-2 nowMs 不在目标日 ⇒ 不用它（否则又是错位）', e2.ok ? '' : '抛错')

console.log('')
console.log('=== F. 回执三态真正可区分（同一形状的旧实现无法区分）===')
const seen = new Set([rA.status, rC.status, rD.status])
ok(seen.size === 3, 'F-1 ★三种终态互不相同', [...seen].join(' / '))
ok(typeof rA.reason === 'string' && rA.reason.length > 0 && typeof rC.reason === 'string' && rC.reason.length > 0, 'F-2 每个终态都带人可读 reason')
ok(rA.ok === true && rC.ok === true && rD.ok === true, 'F-3 ok 语义不变（派生过程没出错），区分靠 status（加字段不改旧语义）')

console.log('')
console.log('=== G. 非法入参 fail-closed（不许静默回落今天）===')
const expectThrow = (fn, name, keyword) => {
  let err = null
  try { fn() } catch (e) { err = e }
  const msg = err ? String(err.message || err) : ''
  ok(!!err && msg.indexOf(keyword) >= 0, name, err ? msg.slice(0, 80) : '（没有抛错）')
}
expectThrow(() => dateAtForMemDatePre('昨天', B), 'G-1 中文"昨天"抛错（不是静默今天）', '非法日期')
expectThrow(() => dateAtForMemDatePre('2026-13-01', B), 'G-2 13 月抛错', '非法日期')
expectThrow(() => dateAtForMemDatePre('2026-02-31', B), 'G-3 2 月 31 日抛错（Date 会静默滚成 3 月）', '不存在')
expectThrow(() => dateAtForMemDatePre('', B), 'G-4 空串抛错', '非法日期')
expectThrow(() => dateAtForMemDatePre(null, B), 'G-5 null 抛错', '非法日期')

console.log('')
console.log((fail === 0 ? 'PASS ' : 'FAIL ') + pass + ' / FAIL ' + fail)
try { rmSync(DIR, { recursive: true, force: true }) } catch (_) {}
process.exit(fail === 0 ? 0 : 1)
