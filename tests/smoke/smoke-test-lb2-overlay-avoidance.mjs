/**
 * L-B2 验收（真解析 + 真几何）：接续卡与「欢迎回来」卡的「上下错开 + 自动避让」。
 *
 * 判据来源＝**真文件里真解析出的 CSS 规则值**（不猜、不写字面量期望），再按固定定位盒模型
 * 算出两矩形的纵轴区间并做**相交判定**。不相交由「上界」结构保证（代数证明）：
 *   欢迎回来卡内容高 h ≤ MAX（max-height 夹住）⇒ 其 top 边距视口底 ∈ [16, 16+MAX]；
 *   接续卡 bottom 边距视口底 = MAX+28 ⇒ 恒在欢迎卡上方 ≥12px ⇒ **对任意 h 都不相交**。
 * 故断言对 h 取代表性取值（含上界与远超上界）全部成立。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
const ROOT = process.argv[2] || 'D:/dsh-auto-memory'
const OVERLAY = path.join(ROOT, 'skins/iter5/legacy-native-overlays.css')
const raw = readFileSync(OVERLAY, 'utf8')
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

/** 取某选择器规则体中某属性的原始值。
 *  ★用**字面量** indexOf 定位选择器（不做正则转义）——避免转义层数带来的静默不命中
 *    （实测首版把 'aside\\.i5-...' 再转义一次 ⇒ 规则明明存在却取到 null，7 条断言假红）。 */
function declOf (sel, prop) {
  const i = css.indexOf(sel)
  if (i < 0) return null
  const open = css.indexOf('{', i)
  const close = css.indexOf('}', open)
  if (open < 0 || close < 0) return null
  // 选择器之后必须紧跟可选空白再是 {，否则是「前缀命中」了更长的选择器
  if (css.slice(i + sel.length, open).trim() !== '') return null
  const body = css.slice(open + 1, close)
  const p = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(body)
  return p ? p[1].trim() : null
}
/** 求 calc(a px + b px * var(--dam-scale, d)) 等形态的数值；scale=null ⇒ 用回退 d */
function evalLen (v, scale) {
  if (v == null) return null
  let s = String(v).replace(/!important/g, '').trim()
  // ★先剥掉最外层 calc(...) —— 实测漏这一步会让 'calc(224px * var(--dam-scale,1))' 取不到值、
  //   变成 null，进而让下面的 h 全被夹到 0、行值一模一样 ⇒ 断言**空转变绿**（假绿）。
  const c = /^calc\(([\s\S]*)\)$/.exec(s)
  if (c) s = c[1].trim()
  const px = /^(-?[\d.]+)px$/.exec(s)
  if (px) return Number(px[1])
  // a px +/- b px * var(--dam-scale, d)
  const m = /^(-?[\d.]+)px\s*([+-])\s*(-?[\d.]+)px\s*\*\s*var\(\s*--dam-scale\s*,\s*([\d.]+)\s*\)$/.exec(s)
  if (m) { const b = Number(m[3]) * (scale == null ? Number(m[4]) : scale); return m[2] === '+' ? Number(m[1]) + b : Number(m[1]) - b }
  // a px * var(--dam-scale, d)
  const m2 = /^(-?[\d.]+)px\s*\*\s*var\(\s*--dam-scale\s*,\s*([\d.]+)\s*\)$/.exec(s)
  if (m2) return Number(m2[1]) * (scale == null ? Number(m2[2]) : scale)
  return null
}
console.log('')
console.log('[L-B2] 1. 避让规则存在（真解析）')
const avoidCont = declOf('body:has([data-native-dialog-overlay=welcomeBack]) [data-native-continuation]', 'bottom')
const wbMaxH = declOf('body:has([data-native-continuation]) aside.i5-native-notice[data-native-dialog=welcomeBack]', 'max-height')
console.log('   接续卡避让 bottom = ' + avoidCont)
console.log('   欢迎卡 max-height  = ' + wbMaxH)
ok(avoidCont != null, '1a 存在「接续卡上移」规则（bottom=' + avoidCont + '）')
ok(wbMaxH != null, '1b 存在「欢迎卡高度上界」规则（max-height=' + wbMaxH + '）')
ok(/var\(--dam-scale/.test(String(avoidCont || '')) && /var\(--dam-scale/.test(String(wbMaxH || '')), '1c 避让位与上界均随用户字号缩放（--dam-scale）')

console.log('')
console.log('[L-B2] 2. 基线位置未被改动（两者不同时存在时＝原状）')
const baseCont = declOf('[data-dam-theme] [data-native-continuation]{', 'bottom')
const baseWbBottom = declOf('aside.i5-native-notice[data-native-dialog=welcomeBack]{', 'bottom')
const shared = declOf(':is([data-native-dialog-overlay=notice],[data-native-dialog-overlay=welcomeBack]){', 'bottom')
console.log('   接续卡基线 bottom = ' + baseCont + ' ｜ 欢迎卡段内 bottom = ' + baseWbBottom + ' ｜ 共享规则 bottom = ' + shared)
ok(evalLen(baseCont, 1) === 16, '2a 接续卡基线仍为 bottom:16px（实测 ' + baseCont + '）')
ok(baseWbBottom === null, '2b 欢迎卡段内未覆盖 bottom ⇒ 仍走共享规则（实测 ' + baseWbBottom + '）')
ok(/px/.test(String(shared || '')), '2c 共享规则仍把欢迎卡放右下角（bottom=' + shared + '）')

console.log('')
console.log('[L-B2] 3. 两者同时存在 ⇒ 纵向**不相交**，且接续卡在上')
const MAX = evalLen(wbMaxH, null)
const AVOID = evalLen(avoidCont, null)
const GAP = AVOID - MAX - 16
console.log('   高度上界 MAX=' + MAX + 'px ｜ 接续卡 bottom=' + AVOID + 'px ｜ 设计间隙=' + GAP + 'px（scale=1）')
ok(Number.isFinite(MAX) && Number.isFinite(AVOID), '3a-0 ★上界与避让位均解析成功（防「取到 null ⇒ h 全夹到 0 ⇒ 断言空转假绿」；MAX=' + MAX + ' AVOID=' + AVOID + '）')
ok(GAP >= 8, '3a 设计间隙 ≥ 8px（实测 ' + GAP + 'px）')
const vh = 900
let allOk = true
const rows = []
for (const hRaw of [0, 60, MAX / 2, MAX, MAX * 2, MAX * 5]) {
  const h = Math.min(hRaw, MAX)
  const wbTopY = vh - (16 + h)
  const contBottomY = vh - AVOID
  const clear = contBottomY <= wbTopY
  rows.push('h=' + String(hRaw).padEnd(7) + ' 用高=' + String(h).padEnd(7) + ' 欢迎卡顶y=' + wbTopY.toFixed(1).padEnd(8) + ' 接续卡底y=' + contBottomY.toFixed(1).padEnd(8) + (clear ? 'OK' : 'OVERLAP'))
  if (!clear) allOk = false
}
for (const r of rows) console.log('   ' + r)
ok(allOk, '3b ★对 h ∈ {0,60,MAX/2,MAX,2MAX,5MAX} 全部成立：接续卡底边 ≤ 欢迎卡顶边（不相交且在上）')
let minGap = Infinity
for (const hRaw of [0, 60, MAX / 2, MAX, MAX * 2, MAX * 5]) {
  const h = Math.min(hRaw, MAX)
  minGap = Math.min(minGap, (vh - (16 + h)) - (vh - AVOID))
}
ok(minGap >= 8, '3c 最小间隙 ' + minGap.toFixed(1) + 'px ≥ 8px（接续卡在上、欢迎卡在下）')

console.log('')
console.log('[L-B2] 4. 方向与 z 序')
ok(AVOID > 16 + MAX / 2, '4a 避让位（' + AVOID + 'px）远大于基线 16px ⇒ 接续卡被抬到欢迎卡上方')
const wbZ = declOf('aside.i5-native-notice[data-native-dialog=welcomeBack]{', 'z-index')
ok(wbZ === null, '4b 未靠抬高 z-index 压人（欢迎卡段内 z-index=' + wbZ + '）')
ok(String(raw).indexOf('2147483300') < 0, '4c 全文未出现 2147483300（已撤回）')

console.log('')
console.log('[L-B2] 5. 硬前提：零自定义属性定义')
const defs = css.match(/(^|[;{])\s*--[\w-]+\s*:/g) || []
ok(defs.length === 0, '5 ★定义计数 == 0（实测 ' + defs.length + '）')

console.log('')
console.log('[L-B2] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
