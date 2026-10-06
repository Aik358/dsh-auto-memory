import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const surfaces = [...source.matchAll(/function Iter5Surface\(props\) \{/g)].map(match => {
  const end = source.indexOf('function Iter5HostSettings(props)', match.index)
  return source.slice(match.index, end)
})
assert.equal(surfaces.length, 2, 'Exercise both shipped skin implementations')

for (const [index, code] of surfaces.entries()) {
  let hostDeep, skinDeep
  const effects = [], styles = new Map()
  const document = {
    body: {}, getElementById: id => styles.get(id),
    createElement: () => ({ dataset: {}, remove() { styles.delete(this.id) } }),
    head: { appendChild: el => styles.set(el.id, el) },
  }
  const shared = source.match(/var DAM_HOST_SETTINGS_CSS = ("(?:[^"\\]|\\.)*")/)
  const hostCss = shared ? JSON.parse(shared[1]) : ''
  const render = vm.runInNewContext('(function(){' + code + ';return Iter5Surface})()', {
    h: (type, props) => ({ type, props }),
    useDeepTheme: () => hostDeep,
    useIter5Theme: () => index === 0 ? ['system', skinDeep] : skinDeep,
    useIter5Style: () => 'legacy', useTick: () => [0, () => {}],
    useRef: () => ({ current: null }), useEffect: fn => effects.push(fn),
    createPortal: node => node, controller: { subscribe: () => () => {} },
    document, window: { addEventListener() {}, removeEventListener() {} },
    damSkinEnsureCss() {}, damSkinCssFlavor: () => 'legacy',
    FONT_SCALE_VALUES: { normal: '1' }, fontScale: 'normal',
    damSharedSurfaceCss: () => 'skin-base', DAM_HOST_SETTINGS_CSS: hostCss,
  })
  for (hostDeep of [false, true]) for (skinDeep of [false, true]) {
    for (const kind of ['settings', 'page', 'panel', 'dialogs', 'autocont']) {
      assert.equal(render({ kind }).props['data-deep'], String(kind === 'settings' ? hostDeep : skinDeep),
        `shipped implementation ${index}: ${kind}, host=${hostDeep}, workbench=${skinDeep}`)
    }
  }
  const canonical = readFileSync(new URL('../../skins/iter5/host-settings.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n').trim()
  assert.equal(hostCss, canonical, 'Shared host settings sheet comes from canonical source')
  const install = effects.filter(fn => fn.toString().includes('dam-shared-ui-style'))
  const removeFirst = install[0](), removeSecond = install[1]()
  assert.equal(styles.size, 1, 'Mounts share one stylesheet')
  assert.equal(styles.get('dam-shared-ui-style').textContent, 'skin-base\n' + canonical,
    'Every shipped skin installs the opaque native settings sheet after its skin base')
  removeFirst()
  assert.equal(styles.size, 1, 'Another mounted surface retains its stylesheet')
  removeSecond()
  assert.equal(styles.size, 0, 'Last unmount removes its stylesheet')
}
console.log('PASS shipped legacy and variant settings: host theme, canonical sheet, shared installation and teardown')

for (const file of ['../../skins/iter5/surfaces.js', '../../skins/legacy/iter5-325.js.frozen']) {
  const code = readFileSync(new URL(file, import.meta.url), 'utf8')
  const start = code.indexOf('    function Iter5HostSettings(props) {')
  const end = code.indexOf('    // Keep unsaved edits', start)
  const state = [], refs = [], effects = []
  let stateIndex, refIndex, resized, removed = 0, disconnected = 0
  const render = vm.runInNewContext('(function(){' + code.slice(start, end) + ';return Iter5HostSettings})()', {
    h: (type, props, ...children) => ({ type, props: props || {}, children }), L: zh => zh,
    iter5Identity: () => 'test', useIter5Style: () => 'legacy', Iter5Surface() {}, Iter5Settings() {},
    createPortal: node => node, document: { createElement: () => ({ remove() { removed++ } }) },
    useState: initial => { const i = stateIndex++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial; return [state[i], value => { state[i] = value }] },
    useRef: initial => { const i = refIndex++; return refs[i] ||= { current: initial } },
    useEffect: fn => effects.push(fn),
    ResizeObserver: class { constructor(fn) { resized = fn } observe() {} disconnect() { disconnected++ } },
  })
  function view() { stateIndex = 0; refIndex = 0; return render({}) }
  view(); refs[1].current = { clientWidth: 0 }
  const cleanup = effects[0]()
  assert.equal(state[1], false, 'Hidden slot does not consume first valid measurement')
  refs[1].current.clientWidth = 300
  resized()
  assert.equal(state[1], true, 'First narrow measurement opens expanded settings')
  const tree = view()
  function find(node) {
    if (!node || typeof node !== 'object') return null
    if ('data-i5-settings-return' in (node.props || {})) return node
    for (const child of node.children || []) { const found = find(child); if (found) return found }
  }
  find(tree).props.onClick()
  resized(); resized()
  assert.equal(state[1], false, 'Return to host stays effective across resize notifications')
  cleanup()
  assert.equal(removed, 1)
  assert.equal(disconnected, 1)
}
console.log('PASS both source lifecycles: delayed first measurement, narrow expansion, stable return and cleanup')
