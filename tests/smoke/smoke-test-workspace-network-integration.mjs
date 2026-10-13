import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Execute the shipped entry and injected stylesheet, not only native-map.js.
let states = [], cursor = 0, effects = [], frames = [], exported, resizeCallbacks = []
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) {
    const i = cursor++
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial
    return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }]
  },
  useRef(initial) { return React.useState(() => ({ current: initial }))[0] },
  useEffect(fn, deps) {
    const i = cursor++, prior = states[i]
    if (!prior || deps.some((d, n) => !Object.is(d, prior[n]))) { states[i] = deps; effects.push(fn) }
  },
}
const tags = new Map(), localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
const document = {
  documentElement: { getAttribute: () => '', style: {}, classList: { contains: () => false } },
  querySelector: () => null, getElementById: id => tags.get(id),
  createElement: () => ({ dataset: {} }), head: { appendChild: el => tags.set(el.id, el) },
}
const window = { localStorage, addEventListener() {}, removeEventListener() {}, __ModuleLoader__: {
  load(def) { exported = def.factory(name => { if (name === 'react') return React; throw Error('Unavailable: ' + name) }) },
} }
const context = vm.createContext({ window, document, localStorage, navigator: { language: 'zh-CN' }, URL, URLSearchParams,
  console: { log() {}, warn() {}, info() {}, error() {} }, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
  requestAnimationFrame: fn => { frames.push(fn); return frames.length }, cancelAnimationFrame: id => { frames[id - 1] = null },
  ResizeObserver: class { constructor(fn) { resizeCallbacks.push(fn) } observe() {} disconnect() {} },
})
const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
vm.runInContext(source.replace('    return module.exports', `
    exports.networkTest = { WorkspaceGraph, WorkspaceTab, Iter5WorkspaceGraph, ensureStyle,
      transport: function (data) { apiPost = async function () { return data } } }
    return module.exports`), context)
const test = exported.networkTest
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
function fresh() { states = []; cursor = 0; effects = []; frames = []; resizeCallbacks = [] }
const a = { path: '/a', name: 'First', graphTopics: [{ label: 'Topic', detail: 'Evidence' }] }
const b = { path: '/b', name: 'Second', graphTopics: [{ label: 'Other' }] }
fresh()
const entry = test.WorkspaceGraph({ workspaces: [a, b], current: b, scale: 1.25, fitKey: 7 })
const shared = nodes(entry).find(n => n.type === test.Iter5WorkspaceGraph)
assert(shared, 'Default and floating entries must use the shared card renderer')
assert.equal(shared.props.current, b)
assert.equal(shared.props.scale, 1.25)
assert.equal(shared.props.fitKey, 7)
assert.equal(shared.props.allWorkspaces, true)
test.ensureStyle()
const css = tags.get('dsh-auto-memory-css').textContent
function rule(selector) {
  const start = css.indexOf(selector + ' {')
  assert(start >= 0, 'Shared injected stylesheet contains ' + selector)
  return css.slice(start, css.indexOf('}', start))
}
assert.match(rule('[data-dam-network-card]'), /border:\s*1px/)
assert.match(rule('[data-dam-network-card]'), /background:\s*var\(/)
assert.match(rule('[data-dam-network-title]>span'), /-webkit-line-clamp:\s*2/)
assert.match(rule('[data-dam-panel] [data-dam-workspace-index]'), /min-width:\s*0/)
console.log('PASS actual shared entry and injected card/floating styles')

fresh()
test.transport({ workspaces: [a, b], graph: { links: [] } })
function render() { cursor = 0; const tree = test.WorkspaceTab(); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree }
render()
await Promise.resolve(); await Promise.resolve()
let tree = render()
let graph = nodes(tree).find(n => n.type === test.WorkspaceGraph)
const originalFitKey = graph.props.fitKey
graph.props.onSelect(b, true)
// Refs are mounted before effects; emulate the actual floating scroll boundary.
let maxScroll = 100, scrollTop = 0
const pane = { get scrollTop() { return scrollTop }, set scrollTop(value) { scrollTop = Math.min(maxScroll, value) }, getBoundingClientRect: () => ({ top: 100 }) }
cursor = 0
tree = test.WorkspaceTab()
const detail = nodes(tree).find(n => n.props['data-dam-workspace-detail'] === b.path)
assert(detail, 'Selection has an identifiable detail card')
detail.props.ref({ closest: selector => selector === '[data-dam-panel]' ? {} : pane, getBoundingClientRect: () => ({ top: 900 - pane.scrollTop }) })
const pending = effects; effects = []; pending.forEach(fn => fn()); frames.splice(0).forEach(fn => fn?.())
assert(pane.scrollTop > 0, 'Floating selection brings its detail into the visible pane')
maxScroll = 1000
assert.equal(resizeCallbacks.length, 1, 'Observe the actual detail card as its disclosure opens')
resizeCallbacks[0]()
assert(pane.scrollTop >= 750, 'Reveal again after the opening disclosure increases the scroll range')
graph = nodes(tree).find(n => n.type === test.WorkspaceGraph)
assert.equal(graph.props.current.path, b.path)
assert.equal(graph.props.fitKey, originalFitKey, 'Selecting a lower root must not reset the graph to the first root')
pane.scrollTop = 0
graph.props.onSelect(a, false)
render(); frames.splice(0).forEach(fn => fn?.())
assert.equal(pane.scrollTop, 0, 'Changing scope does not scroll away from the graph controls')
const reset = nodes(tree).find(n => n.type === 'button' && n.props.title === '重置视图')
reset.props.onClick()
tree = render()
assert(nodes(tree).find(n => n.type === test.WorkspaceGraph).props.fitKey > originalFitKey, 'Explicit reset still resets panning')
console.log('PASS floating detail visibility, selection without pan reset, and explicit reset')
