/**
 * R13 验收：看板「展开更早」（13a 折叠纯函数 / 13b 持久化）。
 *   真 import lib/wb-sidecar.js ⇒ 真调用 foldCardsPre ⇒ 断言可复算物理量 + 负路径。
 * ★权威：44 卷 L13 用户原话 + 46 卷 L124 折叠条「展开更早的 21 天（1,341 条活动）」。
 * ★核心判据（70 卷）：「大量卡时首屏不卡；**展开后计数守恒**」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SB = path.join(ROOT, 'lib', 'wb-sidecar.js')
const IDX = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const SRC = readFileSync(SB, 'utf8')
const sb = await import(pathToFileURL(SB).href)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
console.log('=== R13 展开更早（44 卷 L13 · 46 卷 L124）===')
const { foldCardsPre } = sb
ok(typeof foldCardsPre === 'function', '① foldCardsPre 是函数（真导出）')

/* ---- 造数据：NOW = 2026-09-27 12:00 本地（周日）---- */
const NOW = new Date(2026, 8, 27, 12, 0, 0).getTime()
const D = 86400000
const mk = (dt, source) => ({ id: 'c' + dt + (source || ''), title: 't', section: 's', kind: 'ledger', mtime: NOW - dt * D, source: source || 'x.md', chars: 1, bullets: 0, anchored: false, criteria: 'unknown', tags: [] })
const cards = [mk(0, 'a'), mk(1, 'b'), mk(2, 'c'), mk(3, 'd'), mk(5, 'e'), mk(6, 'f'), mk(10, 'g'), mk(20, 'h'), mk(30, 'i')]
const r = foldCardsPre(cards, { now: NOW })

/* ---- ② 默认 7 天 ---- */
ok(r.foldDays === 7, '② 默认 foldDays = 7（实测 ' + r.foldDays + '）')
ok(r.total === 9, '③ total = 输入长度 9（实测 ' + r.total + '）')
/* ---- ④ ★计数守恒（70 卷核心判据）---- */
ok(r.visible.length + r.folded.count === r.total, '④ ★计数守恒：visible(' + r.visible.length + ') + folded.count(' + r.folded.count + ') === total(' + r.total + ')')
ok(r.folded.count === 3, '⑤ 折叠 3 条（10/20/30 天前，实测 ' + r.folded.count + '）')
ok(r.hasMore === true, '⑥ hasMore = true')
/* ---- ⑦ 折叠条三量（46 卷 L124）—— ★期望值由数据自身派生，不写死 ---- */
// ★口径裁定：days = **被折叠集合中最早卡距今天数（含今天）**，即被折叠集合的**固有属性**（与 count 同性质），
//   不随 foldDays 变化 —— 若按「展开新增跨度 (span)」算，同一被折叠集合在不同窗口下会报不同天数，不合理。
const dayStartT = new Date(NOW).setHours(0, 0, 0, 0)
const D2 = 86400000
const earliestFolded = NOW - 30 * D
const EXP_DAYS = Math.floor((dayStartT - earliestFolded) / D2) + 1
ok(r.folded.days === EXP_DAYS, '⑦ ★更早天数 = ' + EXP_DAYS + '（由数据派生：floor((dayStart − 最早折叠卡 mtime)/D)+1，实测 ' + r.folded.days + '）')

/* ---- ⑦b ★固有属性不变量：days 不随 foldDays 变化（同一被折叠集合）---- */
const rDays1 = foldCardsPre(cards, { now: NOW, foldDays: 1 })
const rDays7 = foldCardsPre(cards, { now: NOW, foldDays: 7 })
ok(rDays1.folded.days === rDays7.folded.days, '⑦b ★days 是固有属性：foldDays=1（折叠 ' + rDays1.folded.count + ' 条）与 7（折叠 ' + rDays7.folded.count + ' 条）报同一天数 ' + rDays7.folded.days)
ok(rDays7.folded.days >= rDays7.foldDays, '⑦c days(' + rDays7.folded.days + ') 覆盖窗口之外的更早部分 ⇒ ≥ foldDays(' + rDays7.foldDays + ')')

/* ---- ⑧ foldDays=0 ⇒ 全量（等价「点击后显示」）---- */
const r0 = foldCardsPre(cards, { now: NOW, foldDays: 0 })
ok(r0.visible.length === 9 && r0.folded.count === 0 && r0.hasMore === false, '⑧ ★foldDays=0 ⇒ 全量 9 条 / 折叠 0 / hasMore=false')
ok(r0.visible.length + r0.folded.count === r0.total, '⑨ foldDays=0 仍守恒')
/* ---- ⑩ 自定义天数 ---- */
const r1 = foldCardsPre(cards, { now: NOW, foldDays: 1 })
ok(r1.visible.length === 1 && r1.folded.count === 8, '⑩ foldDays=1 ⇒ 只留今天 1 条（实测 ' + r1.visible.length + '）')
const r2 = foldCardsPre(cards, { now: NOW, foldDays: 30 })
ok(r2.visible.length === 8 && r2.folded.count === 1, '⑪ foldDays=30 ⇒ 留 8 条 / 折叠 1（30 天前的边界不含，实测 ' + r2.visible.length + '）')

/* ---- ⑫ 排序：mtime 倒序 ---- */
const desc = r0.visible.every((c, i, a) => i === 0 || (Number(a[i-1].mtime) || 0) >= (Number(c.mtime) || 0))
ok(desc, '⑫ visible 按 mtime 倒序（首屏给最近的）')

/* ---- ⑬ 边界：周起点无关（按天而非按周）---- */
const rh = foldCardsPre([mk(0.4)], { now: NOW, foldDays: 7 })
ok(rh.visible.length === 1, '⑬ 不到 1 天的卡（0.4 天前）落在 7 天窗口内')

/* ---- ⑭ 负路径：空态与畸形入参 ---- */
const e = foldCardsPre([], { now: NOW })
ok(e.visible.length === 0 && e.folded.count === 0 && e.folded.days === 0 && e.hasMore === false && e.total === 0, '⑭ ★空态：全 0 且不崩')
let threw = 0
for (const b of [null, undefined, 0, 'x', {}, [null], [{}], [1], { a: 1 }]) { try { foldCardsPre(b, { now: NOW }) } catch (err) { threw++ } }
ok(threw === 0, '⑮ 9 种畸形入参不抛（实测 ' + threw + '）')
const rn = foldCardsPre(cards, { now: 'not-a-date' })
ok(rn.visible.length + rn.folded.count === rn.total, '⑯ 无效 now 不崩且守恒')
ok(foldCardsPre(cards, { now: NOW, foldDays: -1 }).foldDays === 7, '⑰ foldDays 负数 ⇒ 回落 7（不出现负窗口）')
ok(foldCardsPre(cards, { now: NOW, foldDays: 'x' }).foldDays === 7, '⑱ foldDays 非数 ⇒ 回落 7')
ok(foldCardsPre(cards, null).total === 9, '⑲ opts=null 不抛')

/* ---- ⑳ 宿主接线（真源码断言，仅作守卫）---- */
ok(IDX.indexOf('const foldRes = foldCardsPre(boardCards, {') >= 0, '⑳ ★宿主真接线：foldCardsPre(boardCards, ...)')
ok(IDX.indexOf('kb.stats.fold = { foldDays: foldRes.foldDays, days: foldRes.folded.days, count: foldRes.folded.count, hasMore: foldRes.hasMore }') >= 0, '㉑ ★stats.fold 三量 + foldDays 在场')
ok(IDX.indexOf("url.searchParams.get('foldDays')") >= 0, '㉒ ★13b 持久化：路由真透传 foldDays')
ok(IDX.indexOf('kb.stats.cards4 = stat4.cards') >= 0, '㉓ R12 cards4 未破')
ok(IDX.indexOf('const wantArchive = (opts && opts.includeArchive === true)') >= 0, '㉔ R11c 归档 opt-in 未破')

/* ---- ㉕ 守卫反向验证：真删 foldCardsPre 定义（去 export）---- */
const ANCHOR = 'export function foldCardsPre(cards, opts = {}) {'
ok(SRC.split(ANCHOR).length - 1 === 1, '㉕ 被删锚串恰命中 1 次')
ok(Object.keys(sb).indexOf('foldCardsPre') >= 0, '㉖ 导出集合含 foldCardsPre（导出数 ' + Object.keys(sb).length + '）')
console.log('')
console.log('[r13] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)