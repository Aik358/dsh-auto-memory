/**
 * #278 守卫：自动接续**成功提示关不掉** —— 关闭后 3 秒轮询又把它显示回来。
 *
 * 缺陷：AutoContinueHost 成功分支只要读到有效 lastOk 就 setAcSt，不检查该结果是否已被用户关闭；
 *   轮询每 3000ms 一次、同一 lastOk 在 10 分钟窗内持续满足显示条件 ⇒ 关闭无法保持生效。
 *
 * CR-10 真执行（照抄 le-271-273 / client-loadable 形态）：
 *   ① node:vm 真跑 lib/client.js + 真执行 __ModuleLoader__.load({factory})（证明可加载）；
 *   ② 真挂载 AutoContinueHost **真组件体**（受控 React hooks / 计时器 / apiGet 返回值），
 *   真调 onDismiss、真推进 3 秒轮询，断言**真实渲染输出**（status 文本）。
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
const sleep = () => new Promise((r) => setImmediate(r))

/* ---------- ① 真执行 factory ---------- */
function runClientFactory (code) {
  const noop = () => {}
  const mkEl = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: (c) => c, removeChild: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }), insertBefore: noop, contains: () => false, focus: noop, blur: noop, firstChild: null, parentNode: null, children: [], textContent: '', innerHTML: '', value: '' })
  const store = new Map()
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] || null, get length () { return store.size } }
  const documentStub = { head: mkEl(), body: mkEl(), documentElement: mkEl(), createElement: () => mkEl(), createElementNS: () => mkEl(), createTextNode: () => mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, readyState: 'complete', cookie: '', title: '', hidden: false, visibilityState: 'visible' }
  const React = { createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids }), useState: (v) => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useReducer: (r, i) => [i, noop], useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}), Fragment: 'Fragment', createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }), memo: (c) => c, forwardRef: (f) => f, Children: { map: (a, f) => (a || []).map(f) } }
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    window: { __ModuleLoader__: { load: (e) => { sandbox.__entry = e } }, addEventListener: noop, removeEventListener: noop, setTimeout: () => ({ __to: true }), clearTimeout: noop, setInterval: () => ({ __iv: true }), clearInterval: noop, localStorage: storage, sessionStorage: storage, location: { href: 'http://localhost/', origin: 'http://localhost', search: '', hash: '' }, navigator: { userAgent: 'node', language: 'zh' }, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), requestAnimationFrame: () => ({ __raf: true }), cancelAnimationFrame: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }) },
    document: documentStub, localStorage: storage, sessionStorage: storage, navigator: { userAgent: 'node', language: 'zh' },
    setTimeout: () => ({ __to: true }), clearTimeout: noop, setInterval: () => ({ __iv: true }), clearInterval: noop, queueMicrotask: noop,
    requestAnimationFrame: () => ({ __raf: true }), cancelAnimationFrame: noop,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    TextEncoder, TextDecoder, URL, URLSearchParams, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  const ctx = vm.createContext(sandbox)
  const out = { factoryErr: null, topErr: null, api: null }
  try { new vm.Script(code, { filename: 'client.js' }).runInContext(ctx, { timeout: 20000 }) } catch (e) { out.topErr = e; return out }
  const entry = sandbox.__entry
  if (!entry || typeof entry.factory !== 'function') { out.topErr = new Error('未取得 factory'); return out }
  try { out.api = entry.factory((n) => (n === 'react' ? React : n === 'react-dom' ? { createPortal: (x) => x } : {})) } catch (e) { out.factoryErr = e }
  return out
}
const R = runClientFactory(SRC)
ok(!R.topErr, '① 真跑 client.js 顶栏不抛（' + (R.topErr ? R.topErr.message : 'ok') + '）')
ok(!R.factoryErr, '② ★真执行 __ModuleLoader__ factory 不抛（' + (R.factoryErr ? R.factoryErr.message : 'ok') + '）')
ok(!!R.api && typeof R.api === 'object', '③ factory 返回真出口对象')

/* ---------- ② 真挂载 AutoContinueHost（受控 hooks + 受控计时器 + 受控 API） ---------- */
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
const AC_BODY = extractFnBody(SRC, 'function AutoContinueHost() {')
ok(AC_BODY.length > 1500, '④ 真组件体已抽出（' + AC_BODY.length + ' 字符）')
// ★#289 夹具开缝自检：组件体必须真的**引用** sessions（否则外部补桩进不去、跳转断言恒假绿）。
//   判据 = 抽取出的真组件体里 sessions 的引用数 ≥ 1；「补桩命中数 = 1」的运行期断言在新套件
//   smoke-test-minervaowl7-a2-autocont-display.mjs 的「跳转」用例里（那里才会真正触发跳转）。
{
  const uses = (AC_BODY.match(/\bsessions\b/g) || []).length
  ok(uses >= 1, '④b 夹具开缝：真组件体引用 sessions（次数=' + uses + '，≥1 才可能补桩）')
}

/**
 * 受控渲染：cells 跨渲染持久（模拟 React state/ref），effects 只收集首次挂载的，
 *   setInterval 被拦截 ⇒ 手动「推进 3 秒轮询」（不依赖真实墙钟）。
 */
function mountAutoContinueHost (opts) {
  const o = opts || {}
  const cells = new Map()
  let cursor = 0, first = true
  const intervals = new Map()
  let ivSeq = 0
  const effects = []
  const renders = []
  const useState = (init) => {
    const idx = cursor++
    if (!cells.has(idx)) cells.set(idx, typeof init === 'function' ? init() : init)
    return [cells.get(idx), (next) => { cells.set(idx, typeof next === 'function' ? next(cells.get(idx)) : next) }]
  }
  const useRef = (v) => { const idx = 'r' + (cursor++); if (!cells.has(idx)) cells.set(idx, { current: v }); return cells.get(idx) }
  const useEffect = (fn) => { if (first) effects.push(fn) }
  const setIntervalSpy = (fn) => { const id = ++ivSeq; intervals.set(id, fn); return id }
  const clearIntervalSpy = (id) => { intervals.delete(id) }
  const h = (type, props, ...kids) => ({ type, props: props || {}, children: kids })
  const L = (zh) => zh
  const t = (k) => 'T:' + k
  const apiGet = o.apiGet || (() => Promise.resolve(null))
  const apiPost = () => Promise.resolve({ ok: true })
  const API = { config: '/api/config', autoContState: '/api/auto-cont-state', autoContDecide: '/api/auto-cont-decide' }
  // ★#289 夹具开缝（2026-10-08）：`sessions` 原为硬编码空替身 `{ open: () => {} }`，而组件体
  //   闭包捕获它 ⇒ 外部注入进不去，任何「跳转是否发生」的断言都恒为空数组（首版探针因此假绿）。
  //   此处允许 opts.sessions 覆盖；默认值逐字不变（既有 17 条断言语义零影响）。
  const sessions = o.sessions || { open: () => {} }
  // ★#289：会话身份必须可驱动（跳转/身份校验都读它）；默认值逐字不变。
  const currentSessionIdClient = typeof o.sidOf === 'function' ? o.sidOf : () => o.sid || 'sid-A'
  // ★必须把 setInterval / clearInterval 注入为**受控替身**：组件体直接引用全局 setInterval，
  //   若让它拿到 Node 真全局，测试会留下真 3 秒定时器 ⇒ **进程永不退出（实测挂死）**，
  //   且「推进 3 秒轮询」无法由用例驱动。故一并传入受控实现。
  const render = new Function('useState', 'useEffect', 'useRef', 'useReducer', 'useMemo', 'useCallback', 'h', 'L', 't', 'apiGet', 'apiPost', 'API', 'sessions', 'currentSessionIdClient', 'Iter5AutoContinue', 'configOf', 'setInterval', 'clearInterval',
    AC_BODY + '\nreturn AutoContinueHost()')
  const show = () => {
    cursor = 0
    const vnode = render(useState, useEffect, useRef, (r, i) => [i, () => {}], (f) => f(), (f) => f, h, L, t, apiGet, apiPost, API, sessions, currentSessionIdClient, h, (d) => d, setIntervalSpy, clearIntervalSpy)
    renders.push(vnode)
    return vnode
  }
  return {
    show, intervals, effects,
    runEffects: () => { for (const fn of effects.splice(0)) { const c = fn(); void c } },
    // ★React 语义：setState 之后要**重新渲染**才看得到新状态。故推进轮询后必须再 show() 一次。
    tick: async () => { for (const fn of Array.from(intervals.values())) fn(); await sleep(); await sleep(); return show() },
    settle: async () => { await sleep(); await sleep(); return show() },
    lastRender: () => renders[renders.length - 1],
  }
}

const statusOf = (v) => (v && v.props && typeof v.props.status === 'string') ? v.props.status : null
const isOkShown = (v) => { const s = statusOf(v); return !!s && s.indexOf(String.fromCharCode(10003)) === 0 }
// ★at 必须是**近实的**毫秒时间戳：成功分支有 10 分钟有效期判据（okAt !== 0 且 now-okAt < 10min），
//   传 epoch 附近的常数会直接落进「超窗」分支而永不显示（首版实测踩过）。
const NOW = Date.now()
const okState = (at, sid) => ({ executing: false, lastOk: { at, sessionId: sid, model: 'm1', reasoningEffort: 'high' }, error: null, armed: null })

/* ---------- ③ 断言 ---------- */
console.log('')
console.log('[#278] A. 核心判据：关闭后 3 秒轮询不得再显示')
{
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve(okState(NOW - 5000, 'sid-A')), sid: 'sid-A' })
  host.show()
  host.runEffects()
  await host.settle()
  const shown = host.lastRender()
  ok(isOkShown(shown), '⑤ 轮询到成功结果 ⇒ 显示成功提示（基线，防误伤）status=' + JSON.stringify(statusOf(shown)))
  const onDismiss = shown && shown.props && shown.props.onDismiss
  ok(typeof onDismiss === 'function', '⑥ 组件透出 onDismiss（真函数）')
  onDismiss()
  const afterDismiss = host.show()
  ok(!isOkShown(afterDismiss), '⑦ 调用 onDismiss 后当帧不再显示（status=' + JSON.stringify(statusOf(afterDismiss)) + '）')
  await host.tick()
  const afterTick = host.lastRender()
  ok(!isOkShown(afterTick), '⑧ ★★核心判据：再推进 3 秒轮询后仍不显示（旧实现必红）status=' + JSON.stringify(statusOf(afterTick)))
}

console.log('')
console.log('[#278] B. 防改死：新的成功结果必须能重新显示')
{
  let state = okState(NOW - 5000, 'sid-A')
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve(state), sid: 'sid-A' })
  host.show()
  host.runEffects()
  await host.settle()
  host.lastRender().props.onDismiss()
  host.show()
  await host.tick()
  ok(!isOkShown(host.lastRender()), '⑨ 同一条结果：关闭后保持静默（前置）')
  state = okState(NOW - 1000, 'sid-B')
  await host.tick()
  const fresh = host.lastRender()
  ok(isOkShown(fresh), '⑩ ★防改死：新的成功结果（不同 at/sessionId）⇒ 重新显示（status=' + JSON.stringify(statusOf(fresh)) + '）')
}

console.log('')
console.log('[#278] C. 防误伤：未关闭时轮询保持显示')
{
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve(okState(NOW - 5000, 'sid-A')), sid: 'sid-A' })
  host.show()
  host.runEffects()
  await host.settle()
  ok(isOkShown(host.lastRender()), '⑪ 首次显示')
  await host.tick()
  ok(isOkShown(host.lastRender()), '⑫ ★未关闭 ⇒ 轮询后仍显示（不误伤原有行为）')
  await host.tick()
  ok(isOkShown(host.lastRender()), '⑬ 连续多次轮询仍显示（幂等）')
}

console.log('')
console.log('[#278] D. 行为不变性：其它分支不受影响')
{
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve(okState(Date.now() - 11 * 60 * 1000, 'sid-old')), sid: 'sid-A' })
  host.show(); host.runEffects()
  await host.settle()
  ok(!isOkShown(host.lastRender()), '⑭ 10 分钟窗语义不变：超窗 lastOk 不显示')
}
{
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve({ executing: false, lastOk: null, error: 'boom', armed: null }), sid: 'sid-A' })
  host.show(); host.runEffects()
  await host.settle()
  const s = statusOf(host.lastRender())
  ok(!!s && s.indexOf(String.fromCharCode(10007)) === 0, '⑮ error 分支照常显示（status=' + JSON.stringify(s) + '）')
}
{
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve({ executing: true, lastOk: null, error: null, armed: null }), sid: 'sid-A' })
  host.show(); host.runEffects()
  await host.settle()
  const s = statusOf(host.lastRender())
  ok(!!s && s.indexOf('宿主正在自动接续') === 0, '⑯ executing 分支照常显示（status=' + JSON.stringify(s) + '）')
}
{
  let state = { executing: false, lastOk: null, error: 'boom', armed: null }
  const host = mountAutoContinueHost({ apiGet: () => Promise.resolve(state), sid: 'sid-A' })
  host.show(); host.runEffects()
  await host.settle()
  host.lastRender().props.onDismiss()
  host.show()
  state = okState(NOW - 2000, 'sid-C')
  await host.tick()
  ok(isOkShown(host.lastRender()), '⑰ 关闭错误行不影响随后新成功提示的显示（身份键只对成功提示生效）')
}

console.log('')
console.log('[#278] 结果：' + pass + ' passed, ' + fail + ' failed')
if (fail) process.exit(1)
