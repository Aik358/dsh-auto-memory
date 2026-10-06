import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
// Full factory/apply with native-resource doubles; UI components need no real DOM here.
function makeSandbox () {
  const logs = []
  const loaded = []
  const noop = () => {}
  const mkEl = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: (c) => c, removeChild: noop, setAttribute: noop, getAttribute: () => null,
    removeAttribute: noop, addEventListener: noop, removeEventListener: noop,
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    insertBefore: noop, contains: () => false, focus: noop, blur: noop,
    firstChild: null, parentNode: null, children: [], textContent: '', innerHTML: '', value: '',
  })
  const store = new Map()
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
    key: (i) => Array.from(store.keys())[i] || null,
    get length () { return store.size },
  }
  const documentStub = {
    head: mkEl(), body: mkEl(), documentElement: mkEl(),
    createElement: mkEl, createElementNS: mkEl, createTextNode: () => mkEl(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop,
    readyState: 'complete', cookie: '', title: '',
  }
  const React = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids }),
    useState: (v) => [typeof v === 'function' ? v() : v, noop],
    useEffect: noop, useReducer: (r, i) => [i, noop], useRef: (v) => ({ current: v }),
    useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}), Fragment: 'Fragment',
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    memo: (c) => c, forwardRef: (f) => f, Children: { map: (a, f) => (a || []).map(f) },
  }
  const sandbox = {
    console: {
      log: (...a) => logs.push(['log', a.map(String).join(' ')]),
      warn: (...a) => logs.push(['warn', a.map(String).join(' ')]),
      error: (...a) => logs.push(['error', a.map(String).join(' ')]),
    },
    window: {
      __ModuleLoader__: { load: (entry) => loaded.push(entry) },
      addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout, setInterval, clearInterval,
      localStorage: storage, sessionStorage: storage,
      location: { href: 'http://localhost/', origin: 'http://localhost', search: '', hash: '' },
      navigator: { userAgent: 'node', language: 'zh' },
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
      requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
    },
    document: documentStub,
    localStorage: storage, sessionStorage: storage,
    navigator: { userAgent: 'node', language: 'zh' },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    TextEncoder, TextDecoder, URL, URLSearchParams,
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  return { sandbox, loaded, logs, React }
}


const { sandbox, loaded, React } = makeSandbox()
const timers = new Map(), listeners = new Map(), calls = []
let sequence = 0
const add = (scope, type, fn) => { const key = scope + ':' + type; if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn) }
const del = (scope, type, fn) => listeners.get(scope + ':' + type)?.delete(fn)
sandbox.AbortController = AbortController
sandbox.setTimeout = sandbox.setInterval = (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id }
sandbox.clearTimeout = sandbox.clearInterval = id => timers.delete(id)
Object.assign(sandbox.window, { setTimeout: sandbox.setTimeout, setInterval: sandbox.setInterval, clearTimeout: sandbox.clearTimeout, clearInterval: sandbox.clearInterval, addEventListener: (t, f) => add('window', t, f), removeEventListener: (t, f) => del('window', t, f) })
sandbox.document.addEventListener = (t, f) => add('document', t, f)
sandbox.document.removeEventListener = (t, f) => del('document', t, f)
sandbox.fetch = (url, options) => new Promise(resolve => calls.push({ url, signal: options?.signal, resolve }))
let source = readFileSync(process.env.DAM_AUDIT_CLIENT_SOURCE || new URL('../../lib/client.js', import.meta.url), 'utf8')
// Expose observation only; execute production factory/apply unchanged.
source = source.replace('    exports.apply = apply', '    exports._auditController = controller; exports._auditState = function () { return { dialog: dialogState, queue: dialogQueue.slice(), welcome: welcomeTourConfig, locale: locale } }; exports.apply = apply')
vm.runInNewContext(source, sandbox)
const plugin = loaded[0].factory(name => name === 'react' ? React : name === 'react-dom' ? { createPortal: n => n } : {})
let activeSurfaces = 0
const mount = () => {
  const effects = []
  plugin.apply({ slots: { inject: () => { activeSurfaces++; let alive = true; return () => { if (alive) { alive = false; activeSurfaces-- } } }, register: () => () => {} }, sessions: null, effect: fn => effects.push(fn()), on() {} })
  return () => { for (const cleanup of effects) cleanup(); for (const cleanup of effects) cleanup() }
}
const remainingListeners = () => [...listeners.values()].reduce((n, set) => n + set.size, 0)
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }
const reply = (call, stale) => {
  const body = call.url.includes('/notices') ? { notices: stale ? [{ id: 'old-notice', level: 'urgent' }] : [] }
    : call.url.includes('/config') ? { config: { welcomeTourEnabled: stale, locale: stale ? 'en' : 'zh' } }
    : call.url.includes('/update-check') ? { current: stale ? '99.0.0' : '' }
    : call.url.includes('/workbench') ? { ready: !stale, verify: { ok: !stale } }
    : { away: false, autoPopupEnabled: false }
  call.resolve({ ok: true, json: async () => body })
}
const first = mount()
plugin._auditController.open(); plugin._auditController.close()
const staleCalls = calls.slice(), queued = [...timers.values()].map(t => t.fn)
assert(activeSurfaces > 0)
first()
assert.equal(timers.size, 0, 'all apply timers must be released')
assert.equal(remainingListeners(), 0, 'all global listeners must be released')
assert.equal(activeSurfaces, 0)
assert(staleCalls.every(call => call.signal?.aborted), 'unload aborts every mount request')
const before = calls.length
for (const callback of queued) callback()
assert.equal(calls.length, before, 'already queued timer callbacks cannot schedule work after unload')
// Keep the same factory and remount before old requests resolve, even if fetch ignores abort.
const second = mount(), currentCalls = calls.slice(before)
plugin._auditController.open()
for (const callback of queued) callback()
assert.equal(plugin._auditController.isOpen(), true, 'old close animation cannot close a remounted panel')
assert.equal(plugin._auditController.isClosing(), false)
const liveTimerCount = timers.size, liveListenerCount = remainingListeners(), liveSurfaceCount = activeSurfaces
first()
assert.equal(timers.size, liveTimerCount)
assert.equal(remainingListeners(), liveListenerCount)
assert.equal(activeSurfaces, liveSurfaceCount)
for (const call of currentCalls) reply(call, false)
await settle()
assert.equal(plugin._auditState().dialog, null)
for (const call of staleCalls) reply(call, true)
await settle()
const state = plugin._auditState()
assert.equal(state.dialog, null, 'old notices/workbench/startup callbacks cannot reopen dialogs in the next mount')
assert.equal(state.queue.length, 0)
assert.equal(state.locale, 'zh', 'old config cannot change new mount locale')
second()
assert.equal(timers.size, 0)
assert.equal(remainingListeners(), 0)
assert.equal(activeSurfaces, 0)
const third = mount()
third()
assert.equal(timers.size, 0)
assert.equal(remainingListeners(), 0)
assert.equal(activeSurfaces, 0)
console.log('PASS client lifecycle: repeated mounts, timer/listener/slot release, queued callbacks, abort and late old responses across remount')
