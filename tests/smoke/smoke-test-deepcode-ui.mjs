import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../skins/compat/mobile.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim()
const embedded = JSON.parse(source.match(/var DAM_CLIENT_COMPAT_CSS = ("(?:[^"\\]|\\.)*")/)[1])
assert.equal(embedded, css, 'mobile compatibility must be generated from the canonical CSS source')

// Execute the production style installer: every skin shares this independent sheet.
const styles = new Map()
const document = {
  getElementById: id => styles.get(id),
  createElement: () => ({ dataset: {} }),
  head: { appendChild: el => styles.set(el.id, el) },
}
const start = source.indexOf('    function ensureStyle() {')
const end = source.indexOf('\n    }', start) + 6
const install = vm.runInNewContext('(function(){' + source.slice(start, end) + ';return ensureStyle})()', {
  document, CSS: 'base', STYLE_ID: 'base-style', DAM_CLIENT_COMPAT_CSS: embedded,
})
install(); install()
assert.equal(styles.size, 2, 'repeated mounts must not duplicate styles')
assert.equal(styles.get('dam-client-compat-style').textContent, css)
console.log('PASS real style installer embeds compatibility once, independent of skin selection')

// Execute the exact registered lifecycle, including resize and teardown.
const marker = source.indexOf("}, 'dsh-auto-memory: mobile compatibility')")
const effectStart = source.lastIndexOf('ctx.effect(function () {', marker)
const effect = source.slice(effectStart, marker + "}, 'dsh-auto-memory: mobile compatibility')".length)
const attrs = new Set(), listeners = new Map()
let narrow = true, cleanup
const window = { matchMedia: () => ({ matches: narrow }),
  addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
const root = { hasAttribute: key => attrs.has(key), setAttribute: key => attrs.add(key), removeAttribute: key => attrs.delete(key) }
vm.runInNewContext(effect, { window, document: { documentElement: root }, ctx: { effect: fn => { cleanup = fn() } } })
assert.ok(attrs.has('data-dam-mobile'), 'narrow browser gets mobile fallback')
narrow = false; listeners.get('resize')()
assert.ok(!attrs.has('data-dam-mobile'), 'ordinary desktop keeps its floating glass preference')
window.androidBridge = {}; listeners.get('resize')()
assert.ok(attrs.has('data-dam-mobile'), 'DeepCode desktop mode still needs its WebView fallback')
delete window.androidBridge; attrs.add('data-dsh-mobile-form'); listeners.get('resize')()
assert.ok(attrs.has('data-dam-mobile'), 'DeepCode mobile form marker is supported')
cleanup()
assert.ok(!attrs.has('data-dam-mobile'))
assert.equal(listeners.size, 0)
console.log('PASS actual mobile lifecycle: narrow / DeepCode bridge / mobile marker / desktop / cleanup')

// Render each production theme boundary, including the frozen classic implementation.
// Workbench preferences must never turn the native host settings into the opposite theme.
for (const file of ['../../skins/iter5/surfaces.js', '../../skins/legacy/iter5-325.js.frozen']) {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = code.indexOf('    function Iter5Surface(props) {')
  const end = code.indexOf('    function Iter5HostSettings(props) {', start)
  let hostDeep, skinDeep
  const render = vm.runInNewContext('(function(){' + code.slice(start, end) + ';return Iter5Surface})()', {
    h: (type, props) => ({ type, props }),
    useDeepTheme: () => hostDeep,
    useIter5Theme: () => file.includes('legacy') ? ['system', skinDeep] : skinDeep,
    useIter5Style: () => 'legacy', useTick: () => [0, () => {}],
    useRef: () => ({ current: null }), useEffect: () => {}, createPortal: node => node,
    document: { body: {} }, FONT_SCALE_VALUES: { normal: '1' }, fontScale: 'normal',
  })
  for (hostDeep of [false, true]) for (skinDeep of [false, true]) {
    for (const kind of ['settings', 'page', 'panel', 'dialogs', 'autocont']) {
      const expected = kind === 'settings' ? hostDeep : skinDeep
      assert.equal(render({ kind }).props['data-deep'], String(expected),
        `${file}: ${kind}, host=${hostDeep}, workbench=${skinDeep}`)
    }
  }
}
console.log('PASS both production boundaries: settings follow host; workbench and overlays retain their preference')

for (const file of ['../../skins/iter5/surfaces.js', '../../skins/legacy/iter5-325.js.frozen']) {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = code.indexOf('    function Iter5HostSettings(props) {')
  const end = code.indexOf('    // Keep unsaved edits', start)
  const state = [], refs = [], effects = [], updates = []
  let stateIndex, refIndex, resized
  const h = (type, props, ...children) => ({ type, props: props || {}, children })
  const render = vm.runInNewContext('(function(){' + code.slice(start, end) + ';return Iter5HostSettings})()', {
    h, L: zh => zh, iter5Identity: () => 'test', useIter5Style: () => 'legacy', Iter5Surface: () => {}, Iter5Settings: () => {},
    createPortal: (node) => node, document: { createElement: () => ({ remove() {} }) },
    useState: initial => {
      const index = stateIndex++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => { state[index] = value; if (index === 1) updates.push(value) }]
    },
    useRef: initial => { const index = refIndex++; return refs[index] ||= { current: initial } },
    useEffect: fn => effects.push(fn),
    ResizeObserver: class { constructor(fn) { resized = fn } observe() {} disconnect() {} },
  })
  function view() { stateIndex = 0; refIndex = 0; return render({}) }
  view(); refs[1].current = { clientWidth: 300 }
  effects[0]()
  assert.deepEqual(updates, [true], 'first narrow mount expands once: ' + file)
  resized(); resized()
  assert.deepEqual(updates, [true], 'resize does not keep reopening the settings: ' + file)
  const tree = view()
  function find(node) {
    if (!node || typeof node !== 'object') return null
    if ('data-i5-settings-return' in (node.props || {})) return node
    for (const child of node.children || []) { const result = find(child); if (result) return result }
  }
  find(tree).props.onClick()
  resized()
  assert.equal(state[1], false, 'return action must survive ResizeObserver: ' + file)
}
console.log('PASS both actual settings components: initial expansion and return remain stable across resize')
