// Evaluate the real browser bundle with a deterministic React/DOM harness.
// This checks hook order and resource ownership, not visual browser rendering.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
let passed = 0, failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('FAIL - ' + name + '\n' + error.stack) }
}
function harness() {
  let loaded, stateIndex = 0
  let states = [], hooks = []
  const timers = new Map(), listeners = new Map(), cleanups = [], activeSurfaces = new Set()
  let timerId = 0
  const setTimer = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id }
  const target = (name) => ({
    addEventListener(type, callback) { listeners.set(name + ':' + type, (listeners.get(name + ':' + type) || new Set()).add(callback)) },
    removeEventListener(type, callback) { listeners.get(name + ':' + type)?.delete(callback) },
  })
  const react = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState(initial) {
      hooks.push('state'); const index = stateIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useEffect() { hooks.push('effect') },
    useRef(initial) { hooks.push('ref'); return { current: initial } },
    useReducer() { hooks.push('reducer'); return [0, () => {}] },
  }
  const document = { ...target('document'), hidden: false, body: {}, documentElement: { style: { setProperty() {} } },
    querySelector: () => null, getElementById: () => null,
    createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
    head: { appendChild() {} },
  }
  const window = { ...target('window'), innerWidth: 1280, innerHeight: 900, location: { origin: 'http://localhost', pathname: '/' },
    __ModuleLoader__: { load({ factory }) { loaded = factory((id) => {
      if (id === 'react') return react
      if (id === 'react-dom') return { createPortal: (node) => node }
      throw new Error('unexpected require: ' + id)
    }) } },
  }
  const context = { window, document, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, navigator: { language: 'zh-CN' },
    location: window.location, URL, URLSearchParams, AbortController,
    setTimeout: setTimer, clearTimeout: (id) => timers.delete(id), setInterval: setTimer, clearInterval: (id) => timers.delete(id),
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  }
  const anchor = '    exports.apply = apply'
  assert.equal(source.split(anchor).length, 2, 'private test export anchor must be unique')
  vm.runInNewContext(source.replace(anchor, "    exports.__audit = { wbLayout, KanbanView, setLocale: function (value) { locale = value } }\n" + anchor), context)
  return {
    audit: loaded.__audit, timers, listeners, activeSurfaces,
    render(drawer) { stateIndex = 0; hooks = []; states[2] = drawer; loaded.__audit.KanbanView({}); return [...hooks] },
    apply() {
      loaded.apply({
        slots: { inject: (_, register) => { register(); const token = {}; activeSurfaces.add(token); return () => activeSurfaces.delete(token) }, register: () => () => {} },
        sessions: { list: { subscribe: () => () => {}, get: () => ({}) } },
        on: () => () => {}, effect: (setup) => { const dispose = setup(); if (typeof dispose === 'function') cleanups.push(dispose) },
      })
    },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); cleanups.length = 0 },
  }
}
for (const locale of ['zh', 'en']) {
  await check('graph overflow labels render in ' + locale + ' without unbound variables', () => {
    const h = harness(); h.audit.setLocale(locale)
    const cards = Array.from({ length: 16 }, (_, i) => ({ id: 'card-' + i, laneKey: 'goal', title: 'Title', preview: 'Body', ts: i }))
    const graph = h.audit.wbLayout(cards)
    const more = graph.nodes.find((node) => node.isMore)
    assert.equal(more.title, locale === 'zh' ? '还有 2 条' : '+2 more')
    assert.equal(graph.totalCards, 16)
  })
}
await check('opening and closing the Kanban drawer preserves the React hook sequence', () => {
  const h = harness()
  const closed = h.render(null)
  const opened = h.render({ id: 'card-1', title: 'Title', preview: 'Body', badge: { tone: 'unknown' } })
  const closedAgain = h.render(null)
  assert.deepEqual(opened, closed)
  assert.deepEqual(closedAgain, closed)
})
await check('client teardown clears notice/away polling and delayed semantic detection', async () => {
  const h = harness(); h.apply()
  const periods = [3600000, 30000, 12000]
  for (const period of periods) assert.ok([...h.timers.values()].some((timer) => timer.ms === period), 'expected active timer ' + period)
  h.dispose()
  for (const period of periods) assert.ok(![...h.timers.values()].some((timer) => timer.ms === period), 'leaked timer ' + period)
  assert.equal(h.listeners.get('document:visibilitychange')?.size || 0, 0)
})
await check('client teardown unregisters its surfaces', () => {
  const h = harness(); h.apply()
  assert.ok(h.activeSurfaces.size > 0)
  h.dispose()
  assert.equal(h.activeSurfaces.size, 0)
})
console.log(`\n[audit-client] ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
