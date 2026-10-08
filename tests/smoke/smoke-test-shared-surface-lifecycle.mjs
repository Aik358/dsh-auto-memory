import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Execute both shipped Surface families, retaining React's effect dependency and
// cleanup semantics. No host startup, disk memories, timers or network requests.
const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
function grab(start) {
  const brace = source.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error('Unbalanced function')
}
const surfaces = [...source.matchAll(/function Iter5Surface\(props\)/g)].map(m => grab(m.index))
assert.equal(surfaces.length, 2, 'Exercise frozen and current Surface implementations')
const helperStart = source.indexOf('function damUseSharedSurfaceCss()')
const helper = helperStart < 0 ? '' : grab(helperStart)
const dispatch = grab(source.indexOf('function damSharedSurfaceCss()'))

for (const [family, surface] of surfaces.entries()) {
  let flavor = 'iter5', active, style, removals = 0
  const document = {
    getElementById: () => style || null,
    createElement: () => ({ dataset: {}, textContent: '', remove() { style = null; removals++ } }),
    head: { appendChild(node) { style = node } },
  }
  const context = vm.createContext({
    document, ITER5_CSS: 'current-css', LEGACY_ITER5_CSS: 'frozen-css',
    damSkinCssFlavor: () => flavor,
    useIter5Style: () => flavor,
    useIter5Theme: () => [null, false], useTick: () => [0, () => {}],
    useRef: () => ({ current: null }),
    controller: { subscribe: () => () => {} },
    useEffect(setup, deps) {
      const index = active.cursor++, previous = active.effects[index]
      if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        active.pending.push(() => {
          if (previous && previous.cleanup) previous.cleanup()
          active.effects[index] = { deps, setup, cleanup: setup() }
        })
      }
    },
    h: () => null, createPortal: null, fontScale: 'normal', FONT_SCALE_VALUES: {},
  })
  vm.runInContext(dispatch + '\n' + helper + '\n' + surface, context)
  function make() {
    const instance = { effects: [], pending: [], cursor: 0 }
    instance.render = () => {
      active = instance; instance.cursor = 0; instance.pending = []
      context.Iter5Surface({ kind: 'autocont' })
      instance.pending.forEach(run => run())
    }
    instance.unmount = () => instance.effects.forEach(e => e.cleanup && e.cleanup())
    instance.render()
    return instance
  }
  const instances = [make(), make(), make()]
  const original = style
  assert.equal(style.dataset.users, '3')
  assert.equal(style.textContent, 'current-css')
  function switchTo(next, css) {
    flavor = next
    instances.forEach(instance => instance.render())
    assert.equal(style, original, 'Skin switch must retain the shared node')
    assert.equal(style.dataset.users, '3', 'Skin switch must retain ownership')
    assert.equal(style.textContent, css, 'Mounted Surfaces must immediately sync CSS')
    assert.equal(removals, 0, 'No skin-switch cleanup')
  }
  switchTo('legacy', 'frozen-css')
  switchTo('iter5', 'current-css')
  switchTo('classic', 'frozen-css')
  switchTo('iter5', 'current-css')
  // Unrelated popup mounting/rerendering must not alter the active stylesheet.
  const popup = make()
  assert.equal(style.dataset.users, '4')
  popup.render()
  assert.equal(style.dataset.users, '4')
  popup.unmount()
  assert.equal(style, original)
  assert.equal(style.dataset.users, '3')
  for (let i = 0; i < instances.length; i++) {
    instances[i].unmount()
    if (i < 2) {
      assert.equal(style, original, 'Remaining Surface still owns the sheet')
      assert.equal(style.dataset.users, String(2 - i))
      assert.equal(style.textContent, 'current-css')
    }
  }
  assert.equal(style, null, 'Final unmount removes the shared sheet')
  assert.equal(removals, 1)
  // React StrictMode replays setup/cleanup on initial mount.
  const replay = make()
  replay.unmount()
  replay.effects.forEach(e => { e.cleanup = e.setup() })
  assert.equal(style.dataset.users, '1')
  assert.equal(style.textContent, 'current-css')
  replay.unmount()
  assert.equal(style, null)
  console.log('PASS shared Surface family ' + family + ': switch, popup, ownership, final cleanup and StrictMode replay')
}
