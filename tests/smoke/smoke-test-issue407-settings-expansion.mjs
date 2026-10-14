import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../skins/iter5/surfaces.js', import.meta.url), 'utf8')
const start = source.indexOf('    function Iter5HostSettings(props) {')
const body = source.slice(start, source.indexOf('    // Keep unsaved edits', start))
const slots = [], dependencies = [], cleanups = []
let index = 0, effects = [], observerCallback, focused = null, pluginDetail = false
const parent = { getBoundingClientRect: () => ({ top: 64 }) }
const pluginArea = { getBoundingClientRect: () => ({ top: 50, height: 750 }), parentElement: null }
const slot = { clientWidth: 320, closest: () => pluginDetail ? null : parent, parentElement: pluginArea, appendChild() {} }
const close = { focus: () => { focused = close } }
const first = { offsetParent: true, tabIndex: 0, focus: () => { focused = first } }
const last = { offsetParent: true, tabIndex: 0, focus: () => { focused = last } }
const root = { querySelector: () => close, querySelectorAll: () => [first, last] }
const handlers = {}
const env = {
  Math, String, Array, getComputedStyle: () => ({ overflowY: 'auto' }), dialogState: null, iter5SettingsDrafts: {}, iter5Identity: () => 'fixture',
  useIter5Style: () => 'legacy', Iter5Surface() {}, Iter5Settings() {}, L: s => s,
  h: (tag, props, ...children) => { if (props && props.ref) props.ref.current = props['data-i5-settings-slot'] !== undefined ? slot : root; return { tag, props: props || {}, children: children.flat() } },
  createPortal: form => form,
  useState: value => { const n = index++; if (!(n in slots)) slots[n] = typeof value === 'function' ? value() : value; return [slots[n], v => { slots[n] = v }] },
  useRef: value => { const n = index++; if (!(n in slots)) slots[n] = { current: value }; return slots[n] },
  useEffect: (fn, deps) => { const n = index++; if (!dependencies[n] || deps.some((d, i) => dependencies[n][i] !== d)) { dependencies[n] = deps; effects.push(() => { if (cleanups[n]) cleanups[n](); cleanups[n] = fn() }) } },
  ResizeObserver: class { constructor(fn) { observerCallback = fn } observe() {} disconnect() {} },
  navigator: { windowControlsOverlay: { visible: true, getTitlebarAreaRect: () => ({ y: 0, height: 40 }) } },
  document: { createElement: () => ({ remove() {} }), body: { appendChild() {} }, querySelector: () => null, get activeElement() { return focused } },
  window: { addEventListener: (name, fn) => { handlers[name] = fn }, removeEventListener() {}, confirm: () => true },
  setInterval: () => 1, clearInterval() {},
}
vm.createContext(env); vm.runInContext(body, env)
function render() { index = 0; effects = []; const tree = env.Iter5HostSettings({ inPluginDetail: pluginDetail }); effects.forEach(fn => fn()); return tree }
function nodes(tree) { return [tree, ...(tree.children || []).filter(c => c && typeof c === 'object').flatMap(nodes)] }
render(); let tree = render()
let frame = nodes(tree).find(n => n.props['data-i5-embedded'] !== undefined)
assert.equal(frame.props['data-expanded'], 'true'); assert.equal(frame.props.style.top, '64px')
assert.equal(focused, close)
let prevented = 0; focused = last
frame.props.onKeyDown({ key: 'Tab', currentTarget: root, preventDefault: () => { prevented++ } })
assert.equal(focused, first); assert.equal(prevented, 1)
nodes(tree).find(n => n.props['data-i5-settings-return'] !== undefined).props.onClick()
observerCallback(); tree = render()
frame = nodes(tree).find(n => n.props['data-i5-embedded'] !== undefined)
assert.equal(frame.props['data-expanded'], 'false', 'a narrow slot cannot automatically reopen after an explicit return')
nodes(tree).find(n => n.props['data-i5-settings-return'] !== undefined).props.onClick(); tree = render()
handlers.keydown({ type: 'keydown', key: 'Escape', preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} })
observerCallback(); tree = render()
assert.equal(nodes(tree).find(n => n.props['data-i5-embedded'] !== undefined).props['data-expanded'], 'false')
cleanups.forEach(fn => fn && fn())
slots.length = 0; dependencies.length = 0; cleanups.length = 0; pluginDetail = true
render(); tree = render()
frame = nodes(tree).find(n => n.props['data-i5-embedded'] !== undefined)
assert.equal(frame.props['data-expanded'], 'true')
assert.equal(frame.props.style.top, '58px', 'plugin detail uses its actual scroll area below the host title/menu, without requiring a dialog')
cleanups.forEach(fn => fn && fn())
console.log('PASS #407 dialog and plugin-detail expansion respect host/titlebar boundaries, focus and explicit narrow-slot return')
