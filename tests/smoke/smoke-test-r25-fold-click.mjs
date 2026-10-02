/** R25 · 折叠条真点击链路验收（真 import + 真调用 + 负路径）。 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
const { foldCardsPre } = await import(new URL('../../lib/wb-sidecar.js', import.meta.url).href)
import { fileURLToPath } from 'node:url'

/** 平台无关行尾守恒：存在 CRLF 时不得有裸 LF；全 LF 合法（CI/Linux 检出态）。
 *  ★2026-09-28：原断言写作 cnt(NL)===cnt(CRNL)（即"必须全 CRLF"），在 Linux CI 上必红——
 *  索引里是 LF，本机 core.autocrlf=true 才检出 CRLF。守的语义不变：文件不得混合行尾。 */
const damNoMixedEol = (s) => {
  const crlf = (s.match(/\r\n/g) || []).length
  const lf = (s.match(/\n/g) || []).length
  if (crlf === 0) return true      // 全 LF：合法（CI 检出态）
  return crlf === lf               // 有 CRLF 则不得再有裸 LF
}
const damPath = (rel) => fileURLToPath(new URL('../../' + rel, import.meta.url))
const SRC = readFileSync(damPath('lib/client.js'), 'utf8')
const IX = readFileSync(damPath('lib/index.js'), 'utf8')
let p = 0, f = 0; const fails = []
const ok = (c, m) => { if (c) p++; else { f++; fails.push(m) } }
const eq = (a, b, m) => ok(Object.is(a, b), m + ' [got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b) + ']')
const cnt = (s, x) => s.split(x).length - 1

/* ── A. ★宿主侧能力（真 import 真调用，证明 foldDays=0 语义存在） ── */
const D = 86400000
const now = Date.now()
const cards = [0, 1, 2, 20, 30].map((d, i) => ({ id: 'c' + i, title: 't' + i, mtime: now - d * D }))
const r7 = foldCardsPre(cards, { now, foldDays: 7 })
const r0 = foldCardsPre(cards, { now, foldDays: 0 })
ok(r7.visible.length === 3 && r7.folded.count === 2 && r7.hasMore === true, 'A1 ★foldDays=7 ⇒ 折叠 2 条（默认态）')
eq(r0.visible.length, 5, 'A2 ★★foldDays=0 ⇒ 全量 5 条（点击后展开）')
eq(r0.folded.count, 0, 'A3 ★折叠数归零'); 
eq(r0.hasMore, false, 'A4 ★hasMore=false ⇒ 折叠条消失（真展开）')
ok(r0.visible.length > r7.visible.length, 'A5 ★展开确实是增量（5 > 3）')
const rU = foldCardsPre(cards, { now })
eq(rU.visible.length, r7.visible.length, 'A6 负路径：不传 foldDays ⇒ 等价默认 7（非全量）')
const rBad = foldCardsPre(cards, { now, foldDays: 'zzz' })
eq(rBad.visible.length, r7.visible.length, 'A7 ★负路径：非法 foldDays ⇒ 回落默认 7（不崩、不误展开）')

/* ── B. 宿主路由真接参（★缺口就在这一层） ── */
ok(IX.includes("searchParams.get('foldDays')"), 'B1 ★宿主 kanban-board 读取 foldDays 查询参数')
ok(/foldDays: *\(opts && opts\.foldDays !== undefined/.test(IX), 'B2 ★宿主把 foldDays 透传给 foldCardsPre')
ok(IX.includes('kb.stats.fold = {'), 'B3 ★宿主回填 stats.fold 供前端渲染折叠条')

/* ── C. 前端接线（R24 补的五处） ── */
eq(cnt(SRC, 'foldDays: foldOpen.days'), 1, 'C1 ★前端取数**真带** foldDays（R13 缺口①）')
// ★★CR-10 纠正（本轮反向验证抓到）：下面 C2 原为**源码字符串计数** —— 变异 `foldOpen.expand` 的**函数体**
//   后该串仍在 ⇒ 断言恒真、变异不变红（实测 PASS 27/0 假绿）。改为**真执行语义断言**，并保留计数为守卫。
eq(cnt(SRC, 'foldOpen.expand = function'), 1, 'C2a（守卫，非功能证据）展开函数定义恰 1 处')
const _iF = SRC.indexOf("      var stFold = useState({ days: 7 })")
const _iG = SRC.indexOf('foldOpen.expand = function')
const _iGend = SRC.indexOf('\n', _iG)
ok(_iF > 0 && _iG > _iF && _iGend > _iG, 'C2b ★折叠态两行可真抽取')
const _foldSeg = SRC.slice(_iF, _iGend)
let _lastSet = null
const _sb2 = { console, useState: function (v) { return [v, function (n) { _lastSet = n }] } }
_sb2.globalThis = _sb2
vm.runInContext(_foldSeg + ';globalThis.__EX = foldOpen.expand;globalThis.__D = foldOpen.days;', vm.createContext(_sb2), { filename: 'client.js#foldstate' })
eq(_sb2.__D, 7, 'C2c ★初始态 days=7（与宿主默认折叠天数一致）')
_sb2.__EX()
ok(_lastSet && _lastSet.days === 0, 'C2d ★★真调用 expand() ⇒ setFoldOpen({days:0})（变异则必红）')
// ★R38 口径同步（守的语义未变，只是字面串变了）：原断言写死 `onExpand: foldOpen.expand` ——
//   那正是**白屏 bug 本身**（foldOpen 在 KanbanBoardRail 作用域内不存在）。R38 把折叠态上提到本组件
//   （`var onExpand = function () {...}`）后，恰字面串失配，但「折叠条**真透传**一个可调用函数」这一被守语义
//   完全未变。判据：守**语义**（透传 + 真函数），不是旧 bug 形状的字面串。
eq(cnt(SRC, 'onExpand: onExpand'), 1, 'C3 ★折叠条透传 onExpand（R13 缺口② · R38 口径同步）')
eq(cnt(SRC, 'var onExpand = function ()'), 1, 'C3b ★onExpand 是**本作用域内真实定义**的函数（不再引用兄弟函数的 foldOpen）')
eq(cnt(SRC, 'onClick: (typeof props.onExpand'), 1, 'C4 ★★折叠条**真可点**（有 onClick）')
eq(cnt(SRC, 'DAM_FOLD_DAYS_DEFAULT = 7'), 1, 'C5 默认天数常量 1 处')

/* ── D. ★真执行：折叠条组件真渲染 + 点击真回调 ── */
const h = function (type, props) { const rest = Array.prototype.slice.call(arguments, 2), kids = []
  const push = (k) => { if (k === null || k === undefined || k === false) return; if (Array.isArray(k)) k.forEach(push); else kids.push(k) }
  rest.forEach(push); return { __el: true, type, props: props || {}, kids } }
const i0 = SRC.indexOf('    var DAM_FOLD_DAYS_DEFAULT = 7')
const i1 = SRC.indexOf('\n    }', SRC.indexOf('function DamFoldBar'))
ok(i0 > 0 && i1 > i0, 'D0 折叠段可抽取');
const SEG = SRC.slice(i0, i1 + 6)
const sb = { console, h, String, Object, Array, JSON, Number }
sb.globalThis = sb
vm.runInContext(SEG + ';globalThis.__F = DamFoldBar;', vm.createContext(sb), { filename: 'client.js#fold' })
ok(typeof sb.__F === 'function', 'D1 ★DamFoldBar 在 vm 中真执行');
let clicked = 0
const el = sb.__F({ zh: true, fold: { days: 21, count: 1341, hasMore: true }, onExpand: function () { clicked++ } })
ok(!!el, 'D2 ★真调用返回元素');
const pill = el.kids.filter((k) => k && k.props && k.props['data-dam-fold-pill'] === '')[0]
ok(!!pill, 'D3 ★真返回含胶囊');
ok(typeof pill.props.onClick === 'function', 'D4 ★★胶囊真带 onClick（可点）');
pill.props.onClick();
eq(clicked, 1, 'D5 ★★点击真触发回调（端到端可复算）');
ok(String(pill.kids.join ? pill.kids.join('') : pill.kids).indexOf('1,341') >= 0, 'D6 文案含千分位计数');
const elNo = sb.__F({ zh: true, fold: { days: 7, count: 0, hasMore: false } })
ok(elNo === null, 'D7 ★负路径：无折叠 ⇒ return null（零 DOM）');
const elNonFn = sb.__F({ zh: true, fold: { days: 7, count: 2, hasMore: true }, onExpand: 'not-a-fn' })
const pill2 = elNonFn.kids.filter((k) => k && k.props && k.props['data-dam-fold-pill'] === '')[0]
eq(pill2.props.onClick, undefined, 'D8 ★负路径：onExpand 非函数 ⇒ onClick=undefined（不崩）');

/* ── E. 守恒 ── */
eq((SRC.match(/(?<!function )MEMORY_TABS\(\)/g) || []).length, 2, 'E2 计数锁不变');
ok(damNoMixedEol(SRC), 'E3 纯 CRLF');
console.log('lib/client.js ' + Buffer.byteLength(SRC, 'utf8') + 'B / CRLF ' + (SRC.match(/\r\n/g) || []).length + ' / sha16 ' + createHash('sha256').update(SRC).digest('hex').slice(0, 16).toUpperCase())
console.log('PASS ' + p + ' / FAIL ' + f)
fails.forEach((x) => console.log('  FAIL: ' + x))
process.exit(f === 0 ? 0 : 1)