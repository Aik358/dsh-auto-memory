/**
 * v4 E2 · 左轨时间轴（照搬原型 renderRail）
 *
 * ## 本套件守什么
 * 原型 prototype.js L194-294 的 renderRail 有 8 个子结构：monthDensity / monthLabel / msep /
 * dsep / tick / rbreak / rail-today / railEnsureVisible。本步实现纯函数层 + 模型计算。
 *
 * ## ★Lead 点名的三个必验点
 * 1. 刻度数 === 事件总数（**不写死 185** —— 真实数据只有 1 个事件）
 * 2. 相对时间必须**注入固定 now** 测，不许用 Date.now()（否则断言随日期漂移）
 * 3. 空档断口数 === 现算 >2h 对数，且**负路径**（无 >2h ⇒ 0）
 *
 * ## ★ev4ShapeOf 适配器必须单独可测
 * 宿主 /event-list 返回 {name, updatedAt, checkpointCount}，原型要 {title, start, startMs,
 * end, endMs, checkpoints}。**这层写错 ⇒ 左轨显示但全错位，且不白屏不报错** —— 只能靠单测。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }

/** 花括号配平地抽函数（不用脆弱正则） */
function extractFn (src, name) {
  const at = src.indexOf('function ' + name + '(')
  if (at < 0) return null
  const open = src.indexOf('{', src.indexOf(')', at))
  if (open < 0) return null
  let depth = 1  // ★从 1 起：已消费开头的 {
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1) }
  }
  return null
}

console.log("== 0. 抽纯函数层并在 vm 中真求值 ==")
const FNS = ['pad2Pre', 'isoToLocalPre', 'monthLabelPre', 'ev4ShapeOf', 'monthDensityPre', 'relLabelPre', 'computeRailModelPre', 'eventSpanOfPre']
let bundle = ""
for (const f of FNS) {
  const s = extractFn(SRC, f)
  ok(!!s, '函数 ' + f + ' 可定位（' + (s ? s.length + ' 字符' : '未找到') + '）')
  if (s) bundle += s + "\n"
}
bundle += "var GAP_MS_PRE = 2 * 3600000;\n"
bundle += "var WEEK_PRE = ['周日','周一','周二','周三','周四','周五','周六'];\n"
const ctx = vm.createContext({ console })
vm.runInContext(bundle + "\n;globalThis.__E2 = { pad2Pre, isoToLocalPre, monthLabelPre, ev4ShapeOf, monthDensityPre, relLabelPre, computeRailModelPre, eventSpanOfPre };", ctx)
const E2 = ctx.__E2
ok(!!E2 && typeof E2.computeRailModelPre === 'function', '★★ 纯函数层真求值成功（不是静态断言）')
if (!E2) { console.log("\nSUMMARY  PASS " + pass + " / FAIL " + fail); process.exit(1) }

// ── 造宿主形状的事件（严格用宿主真实键：id/name/status/updatedAt/checkpointCount）──
const H = 3600000, D = 24 * H
const T0 = Date.UTC(2026, 8, 28, 2, 0, 0)  // 2026-09-28 10:00 本地（UTC+8）
function hostEv (id, name, updatedAt, cpCount, status) {
  return { id: id, name: name, status: status || 'active', updatedAt: updatedAt, checkpointCount: cpCount == null ? 3 : cpCount }
}

console.log("")
console.log("== 1. ★ev4ShapeOf 适配器（宿主键 → 原型键，单独可测）==")
const one = hostEv("evt_aaaaaaaa", "测试事件", T0 + 5 * H, 7, "done")
const shaped = E2.ev4ShapeOf(one)
console.log("  输出:", JSON.stringify(shaped).slice(0, 220))
ok(shaped.title === '测试事件', '★[正] title ← name（宿主 name 无 title）实测 "' + shaped.title + '"')
ok(typeof shaped.start === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(shaped.start), '★[正] start 是本地 "YYYY-MM-DD HH:MM" 串（实测 "' + shaped.start + '"）')
ok(shaped.startMs === T0 + 5 * H, "★★[正] startMs ← updatedAt（宿主无 createdAt 时）实测 " + shaped.startMs)
ok(shaped.endMs === shaped.startMs, "[正] endMs ← updatedAt（同值）")
ok(shaped.checkpoints.length === 7, "★★[正] checkpoints 数组长度 === checkpointCount（实测 " + shaped.checkpoints.length + "）")
ok(shaped.status === "done", "[正] status 透传")
ok(shaped.id === "evt_aaaaaaaa", "[正] id 透传")
// 负路径：空对象不崩
const empty = E2.ev4ShapeOf({})
ok(empty.title === '(未命名)' && empty.checkpoints.length === 0, '[负] 空对象 ⇒ 标题降级且 cp 空，不崩')
ok(E2.ev4ShapeOf(null).title === '(未命名)', '[负] null ⇒ 不崩')
// 变异：把 title 改读 ev.title（宿主没有这个键）⇒ 断言必红
const mutShape = extractFn(SRC, "ev4ShapeOf").replace("title: String(e.name || '(未命名)')", "title: String(e.title || '(未命名)')")
const mutCtx = vm.createContext({ console })
vm.runInContext(bundle.replace(extractFn(SRC, "ev4ShapeOf"), mutShape) + "\n;globalThis.__M = { ev4ShapeOf };", mutCtx)
ok(mutCtx.__M.ev4ShapeOf(one).title === '(未命名)', '★★[变异] 把 title 改读 e.title（宿主无此键）⇒ 标题塌成占位 ⇒ 断言必红（判据非恒真）')
ok(E2.ev4ShapeOf(one).title === '测试事件', '[还原] 未变异版仍取 name ⇒ 复绿')

console.log("")
console.log("== 2. ★刻度数 === 事件总数（Lead 必验点 1，不写死）==")
const ev3 = [
  hostEv("e1", "事件一", T0, 2, "done"),
  hostEv("e2", "事件二", T0 + 3 * H, 5, "active"),
  hostEv("e3", "事件三", T0 + 30 * H, 1, "paused"),
]
const m3 = E2.computeRailModelPre(ev3, T0 + 40 * H)
ok(m3.ticks.length === ev3.length, "★★[正] ticks.length === 事件总数（" + m3.ticks.length + " === " + ev3.length + "）")
ok(m3.total === ev3.length, "★[正] total === 事件总数（" + m3.total + "）")
// 边界：1 个事件 / 0 个事件
ok(E2.computeRailModelPre([ev3[0]], T0 + H).ticks.length === 1, "[正] 1 个事件 ⇒ 1 刻度（真实数据只有 1 个）")
ok(E2.computeRailModelPre([], T0).ticks.length === 0, "[负] 0 个事件 ⇒ 0 刻度，不崩")
ok(E2.computeRailModelPre(null, T0).ticks.length === 0, "[负] null ⇒ 0 刻度，不崩")
// 变异：把循环上界改成 i < list.length - 1 ⇒ 少一个刻度 ⇒ 断言必红
const mutRail = extractFn(SRC, "computeRailModelPre").replace("for (var i = 0; i < list.length; i++) shaped.push(ev4ShapeOf(list[i]))", "for (var i = 0; i < list.length - 1; i++) shaped.push(ev4ShapeOf(list[i]))")
const mutRailCtx = vm.createContext({ console })
vm.runInContext(bundle.replace(extractFn(SRC, "computeRailModelPre"), mutRail) + "\n;globalThis.__R = { computeRailModelPre };", mutRailCtx)
ok(mutRailCtx.__R.computeRailModelPre(ev3, T0 + 40 * H).ticks.length === ev3.length - 1, "★★[变异] 循环少跑一次 ⇒ 刻度比事件少 1 ⇒「刻度 === 总数」断言必红")

console.log("")
console.log("== 3. ★月份分隔数 === 不同 YYYY-MM 数 + 逐月密度柱数 === 该月真实天数 ==")
const crossMonth = [
  hostEv("m1", "九月事件", Date.UTC(2026, 8, 5, 1), 2),   // 2026-09
  hostEv("m2", "十月事件", Date.UTC(2026, 9, 6, 1), 2),   // 2026-10
  hostEv("m3", "十月第二", Date.UTC(2026, 9, 20, 1), 2),  // 2026-10
]
const mCross = E2.computeRailModelPre(crossMonth, Date.UTC(2026, 9, 25))
const distinctMonths = [...new Set(crossMonth.map((e) => E2.isoToLocalPre(e.updatedAt).slice(0, 7)))]
ok(mCross.months.length === distinctMonths.length, "★★[正] months.length === 不同 YYYY-MM 数（" + mCross.months.length + " === " + distinctMonths.length + "）")
// 逐月密度柱数 = 该月真实天数（28/29/30/31 全测）
const dimCases = [
  ["2026-02", 28], ["2024-02", 29], ["2026-09", 30], ["2026-10", 31], ["2026-04", 30], ["2026-01", 31],
]
for (const [mk, want] of dimCases) {
  const d = E2.monthDensityPre(mk, crossMonth)
  ok(d.dim === want, "★★[正] " + mk + " 真实天数 === " + want + "（实测 " + d.dim + "）")
}
ok(E2.monthDensityPre("2099-07", crossMonth).max === 0, "[负] 无事件的月份 ⇒ max 0（密度柱全空，不崩）")
ok(E2.monthLabelPre("2026-09") === "2026 年 9 月", "★[正] 月份标签「2026 年 9 月」（实测 " + E2.monthLabelPre("2026-09") + "）")

console.log("")
console.log("== 4. ★空档断口数 === 现算 >2h 对数 + 负路径 ==")
// 构造：e1 结束在 T0+1h，e2 开始 T0+40h ⇒ 空档 39h > 2h ⇒ 1 个断口
const gapEvs = [
  hostEv("g1", "第一件", T0, 1),
  hostEv("g2", "第二件", T0 + 40 * H, 1),
  hostEv("g3", "第三件", T0 + 41 * H, 1),   // 距 g2 仅 1h ⇒ 无断口
]
const mg = E2.computeRailModelPre(gapEvs, T0 + 50 * H)
// 现算 >2h 对数（不读实现，独立算）
const shapedG = gapEvs.map((e) => E2.ev4ShapeOf(e)).sort((a, b) => a.startMs - b.startMs)
let wantBreaks = 0, wantHours = []
for (let i = 1; i < shapedG.length; i++) {
  const delta = shapedG[i].startMs - shapedG[i - 1].endMs
  if (delta > 2 * 3600000) { wantBreaks++; wantHours.push(Math.round((delta / 3600000) * 10) / 10) }
}
ok(mg.breaks.length === wantBreaks, "★★★[正] breaks.length === 现算 >2h 对数（" + mg.breaks.length + " === " + wantBreaks + "）")
ok(mg.breaks.length === 1, "★[正] 本例恰 1 个断口（实测 " + mg.breaks.length + "）")
ok(mg.breaks[0] && mg.breaks[0].hours === wantHours[0], "★[正] 断口小时数 === 现算（" + (mg.breaks[0] && mg.breaks[0].hours) + " === " + wantHours[0] + "）")
ok(mg.breaks[0] && mg.breaks[0].label === "空档 " + wantHours[0] + "h", "★[正] 文案「空档 X h」（实测 " + (mg.breaks[0] && mg.breaks[0].label) + "）")
// ★负路径：事件密集（间隔都 <2h）⇒ breaks 必须为 0
const denseEvs = [
  hostEv("d1", "密集一", T0, 1),
  hostEv("d2", "密集二", T0 + 1 * H, 1),
  hostEv("d3", "密集三", T0 + 2 * H, 1),
]
const md = E2.computeRailModelPre(denseEvs, T0 + 10 * H)
ok(md.breaks.length === 0, "★★★[负路径] 无 >2h 空档 ⇒ breaks === 0（实测 " + md.breaks.length + "）")
ok(E2.computeRailModelPre([], T0).breaks.length === 0, "[负] 0 事件 ⇒ 0 断口")
ok(E2.computeRailModelPre([hostEv("s1", "唯一", T0, 1)], T0).breaks.length === 0, "[负] 1 事件 ⇒ 0 断口（没有「对」）")
// 变异：把阈值 GAP_MS_PRE 改成 0.5h ⇒ 原本不报的密集事件会报 ⇒ 负路径断言必红
const mutGap = bundle.replace("var GAP_MS_PRE = 2 * 3600000;", "var GAP_MS_PRE = 0.5 * 3600000;")
const mutGapCtx = vm.createContext({ console })
vm.runInContext(mutGap + "\n;globalThis.__G = { computeRailModelPre };", mutGapCtx)
ok(mutGapCtx.__G.computeRailModelPre(denseEvs, T0 + 10 * H).breaks.length > 0, "★★[变异] 阈值降到 0.5h ⇒ 密集事件也报断口 ⇒ 负路径断言必红（判据非恒真）")
ok(md.breaks.length === 0, "[还原] 未变异版仍 0 断口 ⇒ 复绿")

console.log("")
console.log("== 5. ★相对时间四档（Lead 必验点 2：注入固定 now）==")
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0)
const mkRel = (deltaMs) => E2.relLabelPre(E2.ev4ShapeOf({ id: "x", name: "x", updatedAt: NOW - deltaMs, checkpointCount: 1 }), NOW)
const r1 = mkRel(30 * 60000)
ok(/^30 分钟前$/.test(r1), "★★[正] 30 分钟前（实测 " + r1 + "）")
const r2 = mkRel(5 * 3600000)
ok(/^5 小时前$/.test(r2), "★★[正] 5 小时前（实测 " + r2 + "）")
const r3 = mkRel(30 * 3600000)
ok(/^昨天 \d{2}:\d{2}$/.test(r3), "★★[正] 昨天 HH:MM（实测 " + r3 + "）")
const r4 = mkRel(3 * 24 * 3600000)
ok(/^3 天前$/.test(r4), "★★[正] 3 天前（实测 " + r4 + "）")
const r5 = mkRel(30 * 24 * 3600000)
ok(/^\d{4}-\d{2}-\d{2}$/.test(r5), "★★[正] >7 天 ⇒ 绝对日期（实测 " + r5 + "）")
const rFuture = E2.relLabelPre(E2.ev4ShapeOf({ id: "x", name: "x", updatedAt: NOW + 5 * 3600000, checkpointCount: 1 }), NOW)
ok(/^\d{2}-\d{2} \d{2}:\d{2}$/.test(rFuture), "★[负] 未来时间 ⇒ 回退绝对日期（实测 " + rFuture + "）")
// ★关键：同一事件在不同 now 下必须给出不同标签（证明 now 真的被用）
const evForRel = E2.ev4ShapeOf({ id: "x", name: "x", updatedAt: NOW - 30 * 60000, checkpointCount: 1 })
const atNow = E2.relLabelPre(evForRel, NOW)
const atLater = E2.relLabelPre(evForRel, NOW + 5 * 3600000)
ok(atNow !== atLater, "★★★[正] 同一事件在 now 与 now+5h 下标签不同（" + atNow + " vs " + atLater + "）⇒ 证明 now 真的被使用，不是读 Date.now()")
// 不传 now 时回退 Date.now()（只验不崩，不验具体值 —— 否则随日期漂移）
ok(typeof E2.relLabelPre(evForRel) === "string" && E2.relLabelPre(evForRel).length > 0, "★[负] 不传 now ⇒ 回退当前时间且不崩（不断言具体值，避免日期漂移）")

console.log("")
console.log("== 6. 日分隔：日期/周几/当日数 ==")
const dayEvs = [
  hostEv("y1", "同日一", Date.UTC(2026, 9, 20, 1), 1),
  hostEv("y2", "同日二", Date.UTC(2026, 9, 20, 2), 1),
  hostEv("y3", "次日", Date.UTC(2026, 9, 21, 1), 1),
]
const mDay = E2.computeRailModelPre(dayEvs, Date.UTC(2026, 9, 25))
ok(mDay.days.length === 2, "★★[正] 2 个不同日期 ⇒ 2 个日分隔（实测 " + mDay.days.length + "）")
ok(mDay.days[0].count === 2, "★[正] 首日有 2 个事件 ⇒ count 2（实测 " + mDay.days[0].count + "）")
ok(/^周[日一二三四五六]$/.test(mDay.days[0].week), "★[正] 周几格式「周X」（实测 " + mDay.days[0].week + "）")
ok(/^\d{2}-\d{2}$/.test(mDay.days[0].date), "★[正] 日期显示 MM-DD（实测 " + mDay.days[0].date + "）")

console.log("")
console.log("SUMMARY  PASS " + pass + " / FAIL " + fail)
if (fail > 0) process.exit(1)