/**
 * L-B1 验收（真执行）：vm 真跑组件 → 真 DOM 树 → 用**真 CSS 规则**求两按钮的最终几何与配色，
 *   并按 WCAG 2.1 算对比度；同时验证与常驻 continuation 卡不重叠。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
const ROOT = process.argv[2] || 'D:/dsh-auto-memory'
const SRC = readFileSync(path.join(ROOT, 'lib/client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }
function body (src, header) { const s = src.indexOf(header); if (s < 0) throw new Error('miss ' + header); let d = 0; for (let i = s + header.length - 1; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1) } } throw new Error('unbalanced') }
function mkH () { return (type, props, ...kids) => { const flat = []; for (const k of kids) { if (Array.isArray(k)) flat.push(...k.filter((x) => x != null && x !== false)); else if (k != null && k !== false) flat.push(k) } return { type, props: props || {}, children: flat } } }
// —— 真执行 Iter5Notice（welcomeBack 分支，与 DialogHost 同参数）——
const sandbox = { h: mkH(), L: (z) => z, t: (k) => k, Iter5Icon: (p) => ({ type: 'svg', props: {} }) }
sandbox.globalThis = sandbox
const ctx = vm.createContext(sandbox)
const Iter5Notice = vm.runInContext('(function(){' + body(SRC, 'function Iter5Notice(props) {') + String.fromCharCode(10) + 'return Iter5Notice;})()', ctx)
const h = mkH()
const tree = Iter5Notice({ kind: 'welcomeBack', title: 'awayTitle', message: 'awayMsg',
  actions: [ h('button', { 'data-dam-btn': '', onClick: () => {} }, 'gotIt'), h('button', { 'data-dam-btn': '', 'data-primary': 'true', onClick: () => {} }, 'Open memory') ] })
function flat (n, line, out) {
  if (!n || typeof n !== 'object') return out
  out.push({ tag: n.type, props: n.props, line: line.concat([n]) })
  for (const k of (n.children || [])) flat(k, line.concat([n]), out)
  return out
}
const nodes = flat(tree, [], [])
const btns = nodes.filter((x) => x.tag === 'button')
ok(btns.length === 2, '① 真渲染出 2 个按钮（实测 ' + btns.length + '）')
ok(btns.some((b) => b.props['data-primary'] === 'true'), '② 其中 1 个是 primary（打开记忆）')
// —— 真 CSS：解析经典档生效表，取 welcomeBack 段规则 ——
const overlay = readFileSync(path.join(ROOT, 'skins/iter5/legacy-native-overlays.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
function declOf (css, selRe, prop) {
  const re = new RegExp(selRe + '[^{}]*\\{[^}]*\\}')
  const m = re.exec(css)
  if (!m) return null
  // ★属性名必须**整词**匹配：否则 'background' 会命中 'background-color' 之外的 'border' 前缀场景
  //   （实测首版把 background 读成 null：正则先撞上 border 的 'b'）。用 (?:^|;) + 词边界 + 紧随冒号。
  const p = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)').exec(m[0])
  return p ? p[1].trim() : null
}
const WB_PRIMARY = 'aside\\.i5-native-notice\\[data-native-dialog=welcomeBack\\]\\s+\\[data-dam-btn\\]\\[data-primary=true\\]'
// ★先按「选择器 + {…}」定位整条规则体，再在体内取属性；避免跨规则误取。
function ruleBody (css, selRe) { const m = new RegExp(selRe + '[^{}]*\\{([^}]*)\\}').exec(css); return m ? m[1] : null }
const primaryBody = ruleBody(overlay, WB_PRIMARY)
const primaryBg = primaryBody && /(?:^|;)\s*background\s*:\s*([^;]+)/.exec(primaryBody) ? /(?:^|;)\s*background\s*:\s*([^;]+)/.exec(primaryBody)[1].trim() : null
const primaryFg = primaryBody && /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(primaryBody) ? /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(primaryBody)[1].trim() : null
console.log('   primary 规则体: ' + (primaryBody || '(未找到)').slice(0, 120))
console.log('   primary 规则: bg=' + primaryBg + '  color=' + primaryFg)
// 经典档令牌实值（冻结表）
function readStrAt (t, mk) { const i = t.indexOf(mk); if (i < 0) return null; let j = i + mk.length, o = ''; while (j < t.length) { const c = t[j]; if (c === String.fromCharCode(92)) { const n = t[j+1]; o += (n === 'n' ? String.fromCharCode(10) : n); j += 2; continue } if (c === '"') return o; o += c; j++ } return null }
const frozen = readStrAt(readFileSync(path.join(ROOT, 'skins/legacy/iter5-325.js.frozen'), 'utf8'), 'var ITER5_CSS = "')
const tokval = (name) => { const m = new RegExp('(^|[;{])' + name + '\\s*:\\s*([^;}]+)').exec(frozen); return m ? m[2].trim() : null }
const i5blue = tokval('--i5-blue'), i5surface = tokval('--i5-surface')
ok(i5blue === '#2563EB' && i5surface === '#FFFFFF', '③ 经典档令牌取值符合领导实测（--i5-blue=' + i5blue + ' --i5-surface=' + i5surface + '）')
// 解析最终配色（var(--tok, fb) 形式：token 有定义 ⇒ 取 token 值）
function resolve (decl) { const m = /var\(\s*(--[\w-]+)\s*,\s*([^)]+)\)/.exec(decl || ''); if (!m) return decl; const v = tokval(m[1]); return v || m[2].trim() }
const bg = resolve(primaryBg), fg = resolve(primaryFg)
console.log('   解析后 primary: bg=' + bg + '  fg=' + fg)
function srgb (c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function lum (hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim()); if (!m) return null; const n = parseInt(m[1], 16); return 0.2126 * srgb((n >> 16) & 255) + 0.7152 * srgb((n >> 8) & 255) + 0.0722 * srgb(n & 255) }
const la = lum(bg), lb = lum(fg)
const ratio = la != null && lb != null ? (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) : null
ok(ratio != null && ratio >= 4.5, '④ ★primary 白字蓝底对比度 ' + (ratio == null ? 'n/a' : ratio.toFixed(2)) + ':1 ≥ 4.5:1（WCAG AA）')
ok(String(bg).toUpperCase().indexOf('2563EB') >= 0 && String(fg).toUpperCase().indexOf('FFFFFF') >= 0, '⑤ 形态＝蓝底实心 + 白字（用户裁定的目标形态）')
// ★★撤回记录（2026-10-08，Lead 复核裁定）：原 ⑥⑦⑧ 断言「welcomeBack 上锚 ⇒ 与常驻 continuation 卡
//   几何恒不相交 / z 序更高」，其前提**已被证伪** —— 调用点有外层守卫（lib/client.js:17372 处为
//   if (acConfirm || acCd > 0 || acSt) {，而 :17392 处 return null）⇒ 三者为空时组件**根本不挂载**，
//   不存在「常驻空胶囊」。原取证是直接调用组件函数的结果，不等于产线渲染。
//   ⇒ 几何与 z-index 改动已全部撤回；上述三条**基于错误前提的断言一律删除**，改为中性断言。
const wbTop = declOf(overlay, 'aside\\.i5-native-notice\\[data-native-dialog=welcomeBack\\]', 'top')
const wbBottom = declOf(overlay, 'aside\\.i5-native-notice\\[data-native-dialog=welcomeBack\\]', 'bottom')
const zWb = declOf(overlay, 'aside\\.i5-native-notice\\[data-native-dialog=welcomeBack\\]', 'z-index')
console.log('   welcomeBack 专属段: top=' + wbTop + ' bottom=' + wbBottom + ' z=' + zWb)
ok(wbTop === null, '⑥ ★本道不为 welcomeBack 设 top（几何已撤回；实测 ' + wbTop + '）')
ok(wbBottom === null, '⑦ 本道不为 welcomeBack 覆写 bottom（实测 ' + wbBottom + '）')
ok(zWb === null, '⑧ 本道不为 welcomeBack 抬高 z-index（实测 ' + zWb + '）')
const shared = declOf(overlay, ':is\\(\\[data-native-dialog-overlay=notice\\],\\[data-native-dialog-overlay=welcomeBack\\]\\)', 'bottom')
ok(shared !== null && /px/.test(shared), '⑨ 位置仍由共享规则决定（bottom=' + shared + '）⇒ 保持原位的右下角')
console.log('')
console.log('[L-B1-render] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
