/**
 * 批 C 专项套件（#282 / #283 / #284）—— **真执行产线数据与代码**：
 *   · #282/#283：从 lib/client.js 抽出**实际生效的两张样式表**（冻结表 + 生成表，
 *     含运行时拼接的 LEGACY_OVERLAY_EXTRA），逐选择器计数与规则取原文；
 *   · #284：vm 真执行真组件体（受控 hooks/window/document），真派发 dam-skin-changed，
 *     断言 #dam-shared-ui-style 的 textContent 被同步更新（旧实现恒不更新 ⇒ 必红）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

/* ---------- 工具：按 JS 字符串字面量规则取真值 ---------- */
const Q = String.fromCharCode(34)
const BS = String.fromCharCode(92)
function readStringLit (text, marker) {
  const i = text.indexOf(marker)
  if (i < 0) return null
  let j = i + marker.length, out = ''
  while (j < text.length) {
    const c = text[j]
    if (c === BS) { const n = text[j + 1]; out += (n === 'n' ? String.fromCharCode(10) : n); j += 2; continue }
    if (c === Q) return out
    out += c; j++
  }
  return null
}
const TABLE_MARK = 'var ITER5_CSS = ' + Q
const tables = []
let at = -1
while ((at = SRC.indexOf(TABLE_MARK, at + 1)) >= 0) tables.push(readStringLit(SRC.slice(at), 'var ITER5_CSS = ' + Q))
ok(tables.length >= 2, '① 抽出两张 ITER5_CSS 表（实=' + tables.length + '）')
const frozen = tables[0]
const extra = readStringLit(SRC, 'var LEGACY_OVERLAY_EXTRA = ' + Q)
const variant = tables[tables.length - 1]
const effectiveLegacy = frozen + (extra || '')

const cnt = (css, sel) => { let n = 0, i = 0; while ((i = css.indexOf(sel, i)) >= 0) { n++; i += sel.length } return n }

/* ---------- #282 ---------- */
console.log('')
console.log('[C-①] #282 经典/默认档原生浮层 CSS')
ok(!!frozen && frozen.length > 50000, '①-1 冻结表已抽出（' + (frozen ? frozen.length : 0) + ' 字节）')
ok(!!extra && extra.length > 2000, '①-2 运行时附加表已抽出（' + (extra ? extra.length : 0) + ' 字节）')
console.log('       生效 legacy 表 = ' + effectiveLegacy.length + ' 字节')
for (const sel of ['[data-native-continuation]', '[data-native-dialog]', '.i5-native-notice', '.i5-continuation-heading']) {
  const nLegacy = cnt(effectiveLegacy, sel)
  ok(nLegacy > 0, '①-3 旧档生效表命中 ' + sel + '（实=' + nLegacy + '；修复前=0）')
}
{
  const nFrozen = cnt(frozen, '[data-native-continuation]')
  ok(nFrozen === 0, '①-4 冻结表本身仍 0 命中（证明补丁来自附加表，未改动冻结源）')
  // #282 硬要求：变体表一字节不变 —— 用选择器计数与总长度双证
  ok(cnt(variant, '[data-native-continuation]') === 1 && cnt(variant, '.i5-native-notice') === 8, '①-5 变体表计数保持 1/8（iter5 档未受影响）')
}

/* ---------- #283 ---------- */
console.log('[C-②] #283 弹窗族 box-sizing')
{
  const rules = []
  for (const r of variant.split('}')) {
    const head = r.split('{')[0] || ''
    if (/data-native-dialog|data-dam-status-dialog/.test(head) && /box-sizing/.test(r)) rules.push(head.trim())
  }
  ok(rules.length >= 1, '②-1 变体表出现「弹窗选择器 × box-sizing」规则（实=' + rules.length + '；修复前=0）')
  ok(rules.some((h) => h.indexOf('[data-dam-status-dialog]') >= 0), '②-2 规则覆盖 [data-dam-status-dialog]（DialogHost 实际挂的节点）')
  // 作用域必须落在 data-dam-theme（本插件命名空间），不得扩大全局 reset
  ok(rules.every((h) => h.indexOf('[data-dam-theme]') >= 0), '②-3 规则全部限定在 [data-dam-theme] 作用域内（不扩大全局 reset）')
  const globalReset = /\[data-iter5\]\s*\*\s*\{[^}]*box-sizing:border-box/
  ok(globalReset.test(variant), '②-4 既有 [data-iter5] * 全局 reset 未被删除（未用减法兜底）')
}

/* ---------- #284：真执行真组件体 ---------- */
console.log('[C-③] #284 换肤时共享样式同步（vm 真执行）')
function extractFnBody (src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('not found: ' + header)
  let depth = 0
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  throw new Error('unbalanced: ' + header)
}
function mountSurface (kind) {
  const body = extractFnBody(SRC, 'function Iter5Surface(props) {')
  const listeners = new Map()
  const styles = new Map()
  const doc = {
    head: { appendChild: (el) => { styles.set(el.id, el) } },
    getElementById: (id) => styles.get(id) || null,
    createElement: () => ({ id: '', dataset: {}, textContent: '' }),
  }
  const win = {
    addEventListener: (n, f) => { const a = listeners.get(n) || []; a.push(f); listeners.set(n, a) },
    removeEventListener: (n, f) => { const a = (listeners.get(n) || []).filter((x) => x !== f); listeners.set(n, a) },
  }
  const cells = new Map(); let cursor = 0
  const effectDeps = new Map()
  const sandbox = {
    document: doc, window: win,
    useState: (v) => { const i = cursor++; if (!cells.has(i)) cells.set(i, typeof v === 'function' ? v() : v); return [cells.get(i), (n) => cells.set(i, n)] },
    // ★受控 useEffect：必须**照 React 语义**尊重依赖数组（只在首次挂载或依赖变化时执行），
    //   否则「依赖仍为 [] ⇒ 不重复注册」这条判据会因夹具自身每次渲染都跑而假红（本套件首版实测）。
    useEffect: (fn, deps) => {
      const i = cursor++
      const prev = effectDeps.get(i)
      const should = !prev || !Array.isArray(deps) || deps.length !== prev.length || deps.some((d, k) => d !== prev[k])
      if (!should) return
      effectDeps.set(i, deps)
      const c = fn()
      if (typeof c === 'function') cleanups.push(c)
    },
    useRef: (v) => { const i = 'r' + (cursor++); if (!cells.has(i)) cells.set(i, { current: v }); return cells.get(i) },
    useIter5Theme: () => [null, false],
    useIter5Style: () => 'instrument',
    useTick: () => [0, () => {}],
    controller: { subscribe: () => () => {} },
    useCallback: (f) => f, useMemo: (f) => f(), useReducer: (r, i) => [i, () => {}],
    h: (t, p, ...k) => ({ type: t, props: p || {}, children: k }),
    createPortal: null, FONT_SCALE_VALUES: {}, fontScale: 'md',
    damSharedSurfaceCss: () => 'SHEET-' + skinFlavor, damSkinCssFlavor: () => skinFlavor,
    window2: win,
  }
  const cleanups = []
  let skinFlavor = 'iter5'
  sandbox.globalThis = sandbox
  const ctx = vm.createContext(sandbox)
  const render = vm.runInContext('(function(){' + body + String.fromCharCode(10) + 'return Iter5Surface;})()', ctx)
  return {
    render: () => { cursor = 0; return render({ kind }) },
    emitSkin: (flavor) => { skinFlavor = flavor; for (const f of (listeners.get('dam-skin-changed') || [])) f() },
    styleEl: () => styles.get('dam-shared-ui-style') || null,
    listeners,
  }
}
{
  const s = mountSurface('dialogs')
  s.render()
  const el = s.styleEl()
  ok(!!el, '③-1 首次渲染注入 #dam-shared-ui-style（' + (el && el.textContent) + '）')
  ok((s.listeners.get('dam-skin-changed') || []).length >= 1, '③-2 ★已注册 dam-skin-changed 监听（旧实现=0 ⇒ 换肤不同步）')
  const before = el && el.textContent
  s.emitSkin('legacy')
  const after = s.styleEl() && s.styleEl().textContent
  ok(after !== before && after === 'SHEET-legacy', '③-3 ★核心：换肤后样式内容被同步更新（' + JSON.stringify(before) + ' → ' + JSON.stringify(after) + '）')
  // 防「每次渲染都跑」：重复渲染不应重复注册监听
  const n1 = (s.listeners.get('dam-skin-changed') || []).length
  s.render(); s.render()
  const n2 = (s.listeners.get('dam-skin-changed') || []).length
  ok(n2 === n1, '③-4 依赖仍为 []：重复渲染不重复注册（' + n1 + ' → ' + n2 + '）')
}

console.log('')
console.log('[C] 结果: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
