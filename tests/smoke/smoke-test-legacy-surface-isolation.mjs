import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const surfaces = [...source.matchAll(/function Iter5Surface\(props\) \{/g)].map(match =>
  source.slice(match.index, source.indexOf('function Iter5HostSettings(props)', match.index)))
assert.equal(surfaces.length, 2)
const css = JSON.parse(source.match(/var DAM_HOST_SETTINGS_CSS = ("(?:[^"\\]|\\.)*")/)[1])
const glass = JSON.parse(source.match(/var DAM_LEGACY_OVERLAY_CSS = ("(?:[^"\\]|\\.)*")/)[1])
function panelOnly(sheet) {
  const clean = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = [...clean.matchAll(/(?:^|\})([^{}]+)\{/g)].flatMap(match => match[1].split(','))
  return selectors.length > 0 && selectors.every(selector => /^\s*\[data-dam-theme=["']panel["']\]/.test(selector))
}
assert.ok(panelOnly(glass), 'Every compiled glass rule explicitly targets the floating panel')
assert.ok(!panelOnly(glass.replaceAll('[data-dam-theme="panel"]', '[data-dam-theme="dialogs"]')),
  'A regression that paints dialogs with glass is rejected')
console.log('PASS compiled glass scope and the dialog-leak negative control')

for (const [index, code] of surfaces.entries()) {
  const effects = [], listeners = new Map(), styles = new Map()
  let flavor = 'legacy', ensured = 0
  const window = {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
  }
  const document = {
    body: {}, getElementById: id => styles.get(id),
    createElement: () => ({ dataset: {}, remove() { styles.delete(this.id) } }),
    head: { appendChild: el => styles.set(el.id, el) },
  }
  const render = vm.runInNewContext('(function(){' + code + ';return Iter5Surface})()', {
    h: (type, props) => ({ type, props }), useDeepTheme: () => false,
    useIter5Theme: () => index === 0 ? ['auto', false] : false, useIter5Style: () => 'legacy',
    useTick: () => [0, () => {}], useRef: () => ({ current: null }), useEffect: fn => effects.push(fn),
    controller: { subscribe: () => () => {} }, createPortal: node => node, document, window,
    FONT_SCALE_VALUES: { normal: '1' }, fontScale: 'normal',
    damSharedSurfaceCss: () => flavor + '-css', damSkinCssFlavor: () => flavor,
    damSkinEnsureCss: () => { ensured++ }, DAM_HOST_SETTINGS_CSS: css,
  })
  render({ kind: 'settings' }); render({ kind: 'dialogs' })
  const mounts = effects.filter(fn => fn.toString().includes('dam-shared-ui-style')).map(fn => fn())
  function send(type, event = {}) { for (const fn of listeners.get(type) || []) fn(event) }
  function expectSkin(expected) {
    assert.equal(styles.get('dam-shared-ui-style').textContent, expected + '-css\n' + css,
      `shipped implementation ${index}: switch skin without remounting its surfaces`)
    assert.equal(styles.get('dam-shared-ui-style').dataset.users, '2')
  }
  expectSkin('legacy')
  flavor = 'iter5'; send('dam-skin-changed'); expectSkin('iter5')
  flavor = 'classic'; send('dam-skin-changed'); expectSkin('classic')
  flavor = 'legacy'; send('storage', { key: 'dam-skin-style' }); expectSkin('legacy')
  flavor = 'iter5'; send('storage', { key: 'unrelated-preference' }); expectSkin('legacy')
  send('storage', { key: null }); expectSkin('iter5')
  assert.ok(ensured >= 4, 'Skin changes refresh the global sheet as well as the shared sheet')
  mounts[0]()
  assert.equal(styles.size, 1, 'Another mounted surface keeps the shared sheet')
  mounts[1]()
  assert.equal(styles.size, 0)
  assert.equal([...listeners.values()].reduce((n, set) => n + set.size, 0), 0,
    'Unloading releases every skin and storage listener')
}
console.log('PASS both shipped skins: same-tab/cross-tab changes, global/shared synchronization and cleanup')

const skinCss = readFileSync(new URL('../../skins/iter5/skin.css', import.meta.url), 'utf8')
const expandedLayer = Number(skinCss.match(/\[data-expanded=true\]\{[^}]*z-index:(\d+)/)[1])
const dialogs = [...source.matchAll(/function Iter5Dialog\(props\) \{/g)]
assert.equal(dialogs.length, 2)
for (const [index, match] of dialogs.entries()) {
  const code = source.slice(match.index, source.indexOf('function Iter5Calendar(props)', match.index))
  const render = vm.runInNewContext('(function(){' + code + ';return Iter5Dialog})()', {
    h: (type, props, ...children) => ({ type, props, children }), useRef: () => ({ current: null }),
    useIter5Theme: () => index === 0 ? ['auto', false] : false, useIter5Style: () => 'legacy',
    useEffect() {}, kxPortal: node => node, L: zh => zh,
  })
  const dialog = render({ title: 'Confirm', onClose() {} })
  assert.equal(dialog.props.style.position, 'fixed')
  assert.ok(dialog.props.style.zIndex > expandedLayer,
    `shipped dialog ${index} must appear above expanded settings (${expandedLayer})`)
}
console.log('PASS both shipped dialog layers stay above expanded settings')

const choice = readFileSync(new URL('../../skins/iter5/style-choice.js', import.meta.url), 'utf8')
const choiceCode = choice.slice(0, choice.indexOf('    function useIter5Style()'))
const store = new Map([['dam-skin', 'classic']]), changes = []
const choose = vm.runInNewContext('(function(){' + choiceCode + ';return iter5SetStyle})()', {
  localStorage: { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
  damSkinStyleSet: value => store.set('dam-skin-style', value),
  window: { dispatchEvent: event => changes.push(event.type) }, Event: class { constructor(type) { this.type = type } },
})
for (const family of ['instrument', 'editorial', 'water', 'legacy']) {
  store.set('dam-skin', 'classic')
  choose(family)
  assert.equal(store.get('dam-skin'), family === 'legacy' ? undefined : 'v4',
    'Choosing a family exits classic mode instead of leaving its stylesheet active')
  assert.equal(store.get('dam-skin-style'), family)
  assert.equal(store.get('dsh-auto-memory.presentation.v1'), family)
}
const saved = [...store]
choose('editorial', false)
assert.deepEqual([...store], saved, 'Cross-tab synchronization does not write back preferences')
assert.equal(changes.length, 5)
console.log('PASS family dropdown selects the active family and preserves read-only synchronization')

const ensureCode = source.slice(source.indexOf('    function damSkinEnsureCss() {'), source.indexOf('    function damSkinRemoveCss() {'))
const nodes = [], sheets = new Map()
let cssFlavor = 'legacy'
const head = {
  appendChild(el) { el.parentNode = head; nodes.push(el); sheets.set(el.id, el) },
  insertBefore(el, reference) { el.parentNode = head; nodes.splice(nodes.indexOf(reference), 0, el); sheets.set(el.id, el) },
  removeChild(el) { nodes.splice(nodes.indexOf(el), 1); sheets.delete(el.id) },
}
const sheetDocument = {
  head, getElementById: id => sheets.get(id),
  createElement: () => ({ attributes: {}, getAttribute(key) { return this.attributes[key] }, setAttribute(key, value) { this.attributes[key] = value } }),
}
const ensure = vm.runInNewContext('(function(){' + ensureCode + ';return damSkinEnsureCss})()', {
  document: sheetDocument, damSkinCssFlavor: () => cssFlavor, damSkinCssText: () => cssFlavor + '-css',
})
ensure()
head.appendChild({ id: 'dam-shared-ui-style' })
for (cssFlavor of ['iter5', 'classic', 'legacy']) {
  ensure()
  assert.ok(nodes.indexOf(sheets.get('dam-skin-v4-style')) < nodes.indexOf(sheets.get('dam-shared-ui-style')),
    'A family replacement keeps common host settings after the skin stylesheet in the cascade')
  assert.equal(sheets.get('dam-skin-v4-style').textContent, cssFlavor + '-css')
}
console.log('PASS stylesheet replacement preserves common host settings precedence')
