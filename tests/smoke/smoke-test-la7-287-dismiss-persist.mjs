/**
 * smoke-test-la7-287-dismiss-persist —— #287 成功提示重挂载重播 + 过期不清 验收（2026-10-08）。
 *
 * 缺陷：关闭身份只存 useRef ⇒ 组件重挂载即重播；过期分支只清错误文本。
 * 修法：localStorage 持久化「已关闭的那一条」身份键（口径同 #278 = at|sessionId），10 分钟有效期 +
 *   容量上限 64；读取 fail-soft（脏数据一律按「未关闭」）；过期时按 /^[x✓]/ 清显示。
 *   铁律：关闭类状态**只跳过显示**，sessions.open 搭线副作用原地不动（#278 已固化）。
 *
 * 真执行：node:vm 跑 client.js + 真执行 __ModuleLoader__.load({factory}) + 真挂载组件体。
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

/* ---------- ① 真执行 factory（storage 可注入，用于跨挂载共享持久层） ---------- */
function runClientFactory (code, storage) {
  const noop = () => {}
  const mkEl = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: (c) => c, removeChild: noop, setAttribute: noop, removeAttribute: noop, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [] })
  const documentStub = { head: mkEl(), body: mkEl(), documentElement: mkEl(), createElement: () => mkEl(), createElementNS: () => mkEl(), createTextNode: () => mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, cookie: '' }
  const React = { createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids }), useState: (v) => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useRef: (v) => ({ current: v }), useReducer: (r, i) => [i, noop], useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}), useLayoutEffect: noop, createContext: () => ({ Provider: (p) => p, Consumer: (p) => p }) }
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    window: { __ModuleLoader__: { load: (e) => { sandbox.__entry = e } }, addEventListener: noop, removeEventListener: noop, setTimeout: () => ({ __to: true }), clearTimeout: noop, setInterval: () => ({ __iv: true }), clearInterval: noop, location: { href: 'http://x/', origin: 'http://x' }, document: documentStub },
    document: documentStub, localStorage: storage, sessionStorage: storage, navigator: { userAgent: 'node', language: 'zh' },
    setTimeout: () => ({ __to: true }), clearTimeout: noop, setInterval: () => ({ __iv: true }), clearInterval: noop, queueMicrotask: noop,
    requestAnimationFrame: () => ({ __raf: true }), cancelAnimationFrame: noop,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    TextEncoder, TextDecoder, URL, URLSearchParams, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), getComputedStyle: () => ({ getPropertyValue: () => '' })
  }
  sandbox.globalThis = sandbox; sandbox.self = sandbox
  const ctx = vm.createContext(sandbox)
  const out = { factoryErr: null, topErr: null, api: null }
  try { new vm.Script(code, { filename: 'client.js' }).runInContext(ctx, { timeout: 20000 }) } catch (e) { out.topErr = e; return out }
  const entry = sandbox.__entry
  if (!entry || typeof entry.factory !== 'function') { out.topErr = new Error('no factory'); return out }
  try { out.api = entry.factory((n) => (n === 'react' ? React : n === 'react-dom' ? { createPortal: (x) => x } : {})) } catch (e) { out.factoryErr = e }
  return out
}

/** 造一份独立的 localStorage 替身（用例之间互不污染）。 */
function freshStorage () {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), _map: m }
}

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

/** 组件体 + 受控 hooks 的真挂载工厂。o.storage 即本次用例的持久层。 */
function makeMount (body, storage) {
  return function mount (o) {
    o = o || {}
    const st = o.storage || storage
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
    const Lz = (zh) => zh
    const t = (k) => 'T:' + k
    const apiGet = o.apiGet || (() => Promise.resolve(null))
    const apiPost = () => Promise.resolve({ ok: true })
    const API = { config: '/api/config', autoContState: '/api/auto-cont-state', autoContDecide: '/api/auto-cont-decide' }
    const sessions = o.sessions || { open: () => {} }
    const sidOf = typeof o.sidOf === 'function' ? o.sidOf : () => o.sid || 'sid-A'
    const render = new Function('useState', 'useEffect', 'useRef', 'useReducer', 'useMemo', 'useCallback', 'h', 'L', 't', 'apiGet', 'apiPost', 'API', 'sessions', 'currentSessionIdClient', 'Iter5AutoContinue', 'configOf', 'localStorage', 'setInterval', 'clearInterval', body + '\nreturn AutoContinueHost()')
    const show = () => {
      cursor = 0
      const vnode = render(useState, useEffect, useRef, (r, i) => [i, () => {}], (f) => f(), (f) => f, h, Lz, t, apiGet, apiPost, API, sessions, sidOf, h, (d) => d, st, setIntervalSpy, clearIntervalSpy)
      renders.push(vnode)
      return vnode
    }
    return {
      show, intervals, effects,
      runEffects: () => { first = false; for (const fn of effects.splice(0)) { const c = fn(); void c } },
      tick: async () => { for (const fn of Array.from(intervals.values())) fn(); await sleep(); await sleep(); return show() },
      settle: async () => { await sleep(); await sleep(); return show() },
      lastRender: () => renders[renders.length - 1],
    }
  }
}

const statusOf = (v) => (v && v.props && typeof v.props.status === 'string') ? v.props.status : null
const isOkShown = (v) => { const s = statusOf(v); return !!s && s.indexOf(String.fromCharCode(10003)) === 0 }
const NOW = Date.now()
const okState = (at, sid) => ({ executing: false, lastOk: { at, sessionId: sid, model: 'm1', reasoningEffort: 'high' }, error: null, armed: null })
const DISMISS_KEY = 'dsh-auto-memory.acDismissedOk'

const R = runClientFactory(SRC, freshStorage())
ok(!R.topErr, '① 真跑 client.js 顶栏不抛（' + (R.topErr ? R.topErr.message : 'ok') + '）')
ok(!R.factoryErr, '② ★真执行 __ModuleLoader__ factory 不抛（' + (R.factoryErr ? R.factoryErr.message : 'ok') + '）')
const AC_BODY = extractFnBody(SRC, 'function AutoContinueHost() {')
ok(AC_BODY.length > 1000, '③ 从 client.js 配平抽出真组件体（' + AC_BODY.length + ' 字符）')
console.log('')
console.log('[A] #287 核心：关闭 -> **重挂载**（同 at/sessionId）=> 提示不得重播')
{
  const store = freshStorage()
  const mk = () => makeMount(AC_BODY, store)({ storage: store, apiGet: () => Promise.resolve(okState(NOW - 5000, 'sid-A')), sid: 'sid-A' })
  const h1 = mk(); h1.show(); h1.runEffects(); await h1.settle()
  const v1 = h1.lastRender()
  ok(isOkShown(v1), '④ 轮询到成功结果 => 显示成功提示（基线）status=' + JSON.stringify(statusOf(v1)))
  v1.props.onDismiss(); await h1.settle()
  ok(!isOkShown(h1.lastRender()), '⑤ 关闭后当轮不再显示')
  await h1.tick()
  ok(!isOkShown(h1.lastRender()), '⑥ 同挂载内推进轮询仍不显示（#278 成果守恒）')
  const persisted = store.getItem(DISMISS_KEY)
  ok(!!persisted, '★ ⑦ 关闭身份已**落盘**（' + DISMISS_KEY + '）value=' + String(persisted).slice(0, 90))
  const h2 = mk(); h2.show(); h2.runEffects(); await h2.settle()
  ok(!isOkShown(h2.lastRender()), '★ ⑧ 重挂载后同一 at/sessionId **不再重播**（旧实现此处必现）status=' + JSON.stringify(statusOf(h2.lastRender())))
  await h2.tick()
  ok(!isOkShown(h2.lastRender()), '★ ⑨ 重挂载 + 推进轮询仍不显示')
}

console.log('[B] #287 新结果照常显示（不是一刀切禁掉整个提示）')
{
  const store = freshStorage()
  let cur = okState(NOW - 5000, 'sid-A')
  const mk = () => makeMount(AC_BODY, store)({ storage: store, apiGet: () => Promise.resolve(cur), sid: 'sid-A' })
  const h1 = mk(); h1.show(); h1.runEffects(); await h1.settle()
  ok(isOkShown(h1.lastRender()), '（前置）旧结果可见')
  h1.lastRender().props.onDismiss(); await h1.settle()
  ok(!!store.getItem(DISMISS_KEY), '先关闭旧结果 => 已落盘')
  cur = okState(NOW - 1000, 'sid-B')
  const h2 = mk(); h2.show(); h2.runEffects(); await h2.settle()
  ok(isOkShown(h2.lastRender()), '★ 新结果（不同 at|sessionId）=> 照常显示（未被改死）')
}

console.log('[C] #287 过期：>10 分钟 => 已清除（含历史成功文本）')
{
  const store = freshStorage()
  let cur = okState(NOW - 5000, 'sid-A')
  const h = makeMount(AC_BODY, store)({ storage: store, apiGet: () => Promise.resolve(cur), sid: 'sid-A' })
  h.show(); h.runEffects(); await h.settle()
  ok(isOkShown(h.lastRender()), '先显示成功提示（未关闭）')
  cur = okState(NOW - 11 * 60 * 1000, 'sid-A')
  await h.tick()
  ok(!isOkShown(h.lastRender()), '★ 过期后历史成功文本**已清除**（旧实现只清错误文本，会一直留驻）status=' + JSON.stringify(statusOf(h.lastRender())))
}

console.log('[D] #287 脏数据 fail-soft：损坏/超长/非法 JSON => 不崩且按「未关闭」处理')
{
  const cases = [
    ['非法 JSON', '{not json'],
    ['非数组', '{"k":"x"}'],
    ['超长(>8192)', '[' + JSON.stringify({ k: 'a'.repeat(9000), t: Date.now() }) + ']'],
    ['条目形态不符', '[null,42,"x",{"k":123,"t":"nan"},{"t":1}]'],
    ['未来时间戳(时钟回拨)', JSON.stringify([{ k: String(NOW) + '|sid-A', t: Date.now() + 10 * 60 * 1000 }])],
  ]
  for (const [label, raw] of cases) {
    const st = freshStorage(); st.setItem(DISMISS_KEY, raw)
    let threw = null, rendered = null
    try {
      const host = makeMount(AC_BODY, st)({ storage: st, apiGet: () => Promise.resolve(okState(NOW - 5000, 'sid-A')), sid: 'sid-A' })
      host.show(); host.runEffects(); await host.settle(); rendered = host.lastRender()
    } catch (e) { threw = e }
    ok(!threw, '★ ' + label + ' => 不抛错（fail-soft）' + (threw ? '：' + threw.message : ''))
    ok(isOkShown(rendered), '★ ' + label + ' => 按**未关闭**处理，提示照常显示')
  }
  const capSt = freshStorage()
  for (let i = 0; i < 70; i++) {
    const host = makeMount(AC_BODY, capSt)({ storage: capSt, apiGet: () => Promise.resolve(okState(NOW - 5000 - i, 'sid-' + i + '-' + 'x'.repeat(8))), sid: 'sid-A' })
    host.show(); host.runEffects(); await host.settle()
    const v = host.lastRender()
    if (v && v.props && typeof v.props.onDismiss === 'function') v.props.onDismiss()
    await host.settle()
  }
  const arr = JSON.parse(capSt.getItem(DISMISS_KEY) || '[]')
  ok(Array.isArray(arr) && arr.length <= 64, '★ 写入有界：70 次关闭后落盘条数 = ' + (Array.isArray(arr) ? arr.length : 'n/a') + '（<=64）')
}

console.log('[E] #287 守恒铁律：关闭只跳过显示，sessions.open 搭线两种状态下都要发生')
{
  const runOpen = async (dismissFirst) => {
    const st = freshStorage()
    const opened = []
    const stOK = { executing: false, lastOk: { at: NOW - 5000, sessionId: 'sid-NEXT', fromSid: 'sid-A', model: 'm1' }, error: null, armed: null }
    const host = makeMount(AC_BODY, st)({ storage: st, sessions: { open: (s) => opened.push(s) }, apiGet: () => Promise.resolve(stOK), sid: 'sid-A' })
    host.show(); host.runEffects(); await host.settle()
    if (dismissFirst) {
      const v = host.lastRender()
      if (v && v.props && typeof v.props.onDismiss === 'function') v.props.onDismiss()
      await host.settle(); await host.tick()
    }
    return opened
  }
  const notDismissed = await runOpen(false)
  const dismissed = await runOpen(true)
  ok(notDismissed.length >= 1, '★ 未关闭状态：sessions.open 搭线**发生**（' + JSON.stringify(notDismissed) + '）')
  ok(dismissed.length >= 1, '★ 已关闭状态：sessions.open 搭线**照样发生**（' + JSON.stringify(dismissed) + '）')
}
console.log('[F] 负路径（变异必红 -> 还原必绿）')
{
  // 变异①：去掉持久化写入（读完就丢）=> 重挂载断言必红
  const ANCH1 = 'localStorage.setItem(AC_DISMISS_KEY, JSON.stringify(out))'
  const srcNoPersist = SRC.replace(ANCH1, 'void out')
  ok(srcNoPersist !== SRC && SRC.split(ANCH1).length - 1 === 1, '变异①锚串恰命中 1 次（去掉 localStorage.setItem）')
  const R2 = runClientFactory(srcNoPersist, freshStorage())
  ok(!R2.topErr && !R2.factoryErr, '变异①后 client.js 仍可加载（变异语法有效）')
  const bodyNo = extractFnBody(srcNoPersist, 'function AutoContinueHost() {')
  const stA = freshStorage()
  const mkA = () => makeMount(bodyNo, stA)({ storage: stA, apiGet: () => Promise.resolve(okState(NOW - 5000, 'sid-A')), sid: 'sid-A' })
  const a1 = mkA(); a1.show(); a1.runEffects(); await a1.settle()
  const av = a1.lastRender()
  ok(isOkShown(av), '变异①（前置）成功提示可见')
  if (av && av.props) av.props.onDismiss()
  await a1.settle()
  const a2 = mkA(); a2.show(); a2.runEffects(); await a2.settle()
  ok(isOkShown(a2.lastRender()), '★ 变异①（无持久化）=> **重挂载后提示重播**（缺陷复现，必红）')

  // 变异②：让「已关闭」也跳过 sessions.open => 守恒断言必红
  const ANCH2 = 'if (doneSid && fromSidAc && sidNowJump === sidQ && sidQ === fromSidAc'
  const srcSkip = SRC.replace(ANCH2, 'if (!acOkDismissed && doneSid && fromSidAc && sidNowJump === sidQ && sidQ === fromSidAc')
  ok(srcSkip !== SRC && SRC.split(ANCH2).length - 1 === 1, '变异②锚串恰命中 1 次（已关闭时也跳过搭线）')
  const R3 = runClientFactory(srcSkip, freshStorage())
  ok(!R3.topErr && !R3.factoryErr, '变异②后 client.js 仍可加载')
  const bodySkip = extractFnBody(srcSkip, 'function AutoContinueHost() {')
  // ★判据必须落在**重挂载后**：同一挂载内 `acOpenedSidRef` 幂等去重已经把第二次搭线挡掉了，
  //   变异在那里不可观测（首版因此假绿）。重挂载 ⇒ ref 归零、但持久层仍记着「已关闭」
  //   ⇒ 此时「已关闭」分支要不要跳过搭线，才真正可分辨。
  const stB = freshStorage()
  const openedB = []
  const stOK2 = { executing: false, lastOk: { at: NOW - 5000, sessionId: 'sid-NEXT', fromSid: 'sid-A', model: 'm1' }, error: null, armed: null }
  const mkB = () => makeMount(bodySkip, stB)({ storage: stB, sessions: { open: (x) => openedB.push(x) }, apiGet: () => Promise.resolve(stOK2), sid: 'sid-A' })
  const b1 = mkB(); b1.show(); b1.runEffects(); await b1.settle()
  const bv = b1.lastRender()
  if (bv && bv.props) bv.props.onDismiss()
  await b1.settle()
  const before = openedB.length
  const b2 = mkB(); b2.show(); b2.runEffects(); await b2.settle()
  ok(openedB.length === before, '★ 变异②（已关闭也跳过搭线）=> 重挂载后 sessions.open **不再发生**（守恒被破坏，必红）before=' + before + ' after=' + openedB.length)
}

console.log('[G] 还原必绿：未变异实现在同一批场景下正确')
{
  const st = freshStorage()
  const openedG = []
  const stOK3 = { executing: false, lastOk: { at: NOW - 5000, sessionId: 'sid-NEXT', fromSid: 'sid-A', model: 'm1' }, error: null, armed: null }
  const host = makeMount(AC_BODY, st)({ storage: st, sessions: { open: (x) => openedG.push(x) }, apiGet: () => Promise.resolve(stOK3), sid: 'sid-A' })
  host.show(); host.runEffects(); await host.settle()
  const v = host.lastRender()
  ok(isOkShown(v), '★ 还原：成功提示可见（必绿）')
  if (v && v.props) v.props.onDismiss()
  await host.settle(); await host.tick()
  ok(!isOkShown(host.lastRender()), '★ 还原：关闭后不再显示（必绿）')
  ok(openedG.length >= 1, '★ 还原：已关闭状态下搭线仍发生（必绿）实=' + JSON.stringify(openedG))
  // 重挂载口径复核（与变异②同形）：ref 归零、持久层仍记「已关闭」⇒ 搭线**照样发生**
  const beforeG = openedG.length
  const host2 = makeMount(AC_BODY, st)({ storage: st, sessions: { open: (x) => openedG.push(x) }, apiGet: () => Promise.resolve(stOK3), sid: 'sid-A' })
  host2.show(); host2.runEffects(); await host2.settle()
  ok(openedG.length > beforeG, '★ 还原：重挂载后搭线**照样发生**（必绿）before=' + beforeG + ' after=' + openedG.length)
}

console.log('[H] #285/#289 行为级补强（独立复核指出的两处「负路径不红」）')
{
  // ── H1（#285）：**纯 armed** 时必须真的出确认卡 —— 这条覆盖 applyArmCard(arm) 调用本身。
  //   旧 a2 套件删掉该调用仍 22/0（行为正确但无断言覆盖）；这里用「卡必须出现」直接钉住它。
  const armOnly = { executing: false, lastOk: null, error: null, armed: { ratio: 0.9, tokens: 900, window: 1000, ring: 0.9, wall: 0.1, edgeAt: NOW, expiresAt: NOW + 30000 } }
  const stH = freshStorage()
  const hA = makeMount(AC_BODY, stH)({ storage: stH, apiGet: () => Promise.resolve(armOnly), sid: 'sid-A' })
  hA.show(); hA.runEffects(); await hA.settle()
  const confA = hA.lastRender() && hA.lastRender().props && hA.lastRender().props.confirmation
  ok(!!confA, '★ H1 纯 armed（ratio 达阈值）=> 确认卡**必须出现**（覆盖 applyArmCard 调用；删除它此条必红）conf=' + JSON.stringify(confA && confA.ratio))
  ok(!!confA && Number(confA.window) === 1000, '★ H1 卡片字段完整（window/ring/wall 成对拷贝）window=' + (confA && confA.window) + ' ring=' + (confA && confA.ring))

  // ── H2（#285）：**armed 与 error 并存**时必须出卡（armed 是当下状态，不得被历史 error 挡住）
  const armAndErr = { executing: false, lastOk: null, error: 'BOOM-legacy-error', armed: { ratio: 0.9, tokens: 900, window: 1000, ring: 0.9, wall: 0.1, edgeAt: NOW, expiresAt: NOW + 30000 } }
  const stH2 = freshStorage()
  const hB = makeMount(AC_BODY, stH2)({ storage: stH2, apiGet: () => Promise.resolve(armAndErr), sid: 'sid-A' })
  hB.show(); hB.runEffects(); await hB.settle()
  const confB = hB.lastRender() && hB.lastRender().props && hB.lastRender().props.confirmation
  ok(!!confB, '★ H2 armed + error 并存 => 确认卡**仍出现**（error 不得吞掉卡）')
  const statusB = statusOf(hB.lastRender())
  ok(!(statusB && statusB.indexOf('BOOM-legacy-error') === 0), '★ H2 卡片优先：错误文本让位（不出现在 status 首行）status=' + JSON.stringify(statusB))

  // ── H3（#289）：**行为级**判据 —— 跳转瞬间会话已切走 ⇒ sessions.open 不得被调用。
  //   旧 a2 ⑥ 断言的是「取样序列里出现过 sid-B」这类间接特征，可被其它读点满足 ⇒ 恒真、无鉴别力。
  //   这里构造「第一层身份校验放行、跳转前重读时已切走」的单次响应，直接断言副作用未发生。
  const stH3 = freshStorage()
  const opened3 = []
  let sidCalls = 0
  const stJump = { executing: false, lastOk: { at: NOW - 5000, sessionId: 'sid-NEXT', fromSid: 'sid-A', model: 'm1' }, error: null, armed: null }
  const hC = makeMount(AC_BODY, stH3)({
    storage: stH3,
    sessions: { open: (x) => opened3.push(x) },
    // ★受控取值序列（计数经实测校准）：load effect 占 2 次（sidQ + 响应内身份复核），
    //   poll 占 2 次（sidQ + acFresh），第 5 次才是**跳转前的重读** ⇒ 前 4 次必须给 sid-A，
    //   否则 sidQ 直接变 sid-B、卡在 `sidQ === fromSidAc`，根本走不到要检验的那道守卫。
    sidOf: () => { sidCalls++; return sidCalls <= 4 ? 'sid-A' : 'sid-B' },
    apiGet: () => Promise.resolve(stJump),
  })
  hC.show(); hC.runEffects(); await hC.settle()
  ok(opened3.length === 0, '★ H3 跳转瞬间会话已切走 => sessions.open **未被调用**（行为级判据；把 sidNowJump 改成 sidQ 此条必红）实=' + JSON.stringify(opened3))
  // 对照：同一夹具但会话**不**切换 ⇒ 跳转照常发生（证明上述判据不是恒假）
  const stH4 = freshStorage()
  const opened4 = []
  const hD = makeMount(AC_BODY, stH4)({ storage: stH4, sessions: { open: (x) => opened4.push(x) }, apiGet: () => Promise.resolve(stJump), sid: 'sid-A' })
  hD.show(); hD.runEffects(); await hD.settle()
  ok(opened4.length >= 1, '★ H3 对照：未切会话 => 跳转照常发生（判据有鉴别力）实=' + JSON.stringify(opened4))
}

console.log('[I] H1/H3 断言的鉴别力验证（变异必红）')
{
  // I1：#285 —— 删掉 armed 分支的 applyArmCard(arm) ⇒ H1/H2 必红
  const ANCH_I1 = 'applyArmCard(arm)'
  const srcI1 = SRC.replace('              applyArmCard(arm)', '              void arm')
  ok(srcI1 !== SRC && SRC.split('              applyArmCard(arm)').length - 1 === 1, 'I1 锚串恰命中 1 次（armed 分支的 applyArmCard(arm)）')
  const RI1 = runClientFactory(srcI1, freshStorage())
  ok(!RI1.topErr && !RI1.factoryErr, 'I1 变异后仍可加载')
  const bI1 = extractFnBody(srcI1, 'function AutoContinueHost() {')
  const stI1 = freshStorage()
  const hI1 = makeMount(bI1, stI1)({ storage: stI1, apiGet: () => Promise.resolve({ executing: false, lastOk: null, error: null, armed: { ratio: 0.9, tokens: 900, window: 1000, ring: 0.9, wall: 0.1, edgeAt: NOW, expiresAt: NOW + 30000 } }), sid: 'sid-A' })
  hI1.show(); hI1.runEffects(); await hI1.settle()
  const cI1 = hI1.lastRender() && hI1.lastRender().props && hI1.lastRender().props.confirmation
  ok(!cI1, '★ I1 删掉 applyArmCard(arm) => 纯 armed 时确认卡**不再出现**（H1 必红 ⇒ 断言有鉴别力）')

  // I2：#289 —— 把跳转前的重读退回 sidQ ⇒ H3 必红（跳转错误发生）
  // ★该语句实际是**两行**（`var sidNowJump = ''` + `try { sidNowJump = String(...) }`），首版按单行写 ⇒ 锚串命中 0 次而假绿。
  const ANCH_I2 = "var sidNowJump = ''\n                try { sidNowJump = String(currentSessionIdClient() || '') } catch (eSj) {}"
  const SRC_LF = SRC.replace(/\r\n/g, '\n')
  const srcI2 = SRC_LF.replace(ANCH_I2, 'var sidNowJump = sidQ')
  ok(srcI2 !== SRC_LF && SRC_LF.split(ANCH_I2).length - 1 === 1, 'I2 锚串恰命中 1 次（跳转前重读；在 LF 归一化副本上匹配）')
  const RI2 = runClientFactory(srcI2, freshStorage())
  ok(!RI2.topErr && !RI2.factoryErr, 'I2 变异后仍可加载')
  const bI2 = extractFnBody(srcI2, 'function AutoContinueHost() {')
  const stI2 = freshStorage()
  const openedI2 = []
  let nI2 = 0
  const hI2 = makeMount(bI2, stI2)({
    storage: stI2,
    sessions: { open: (x) => openedI2.push(x) },
    sidOf: () => { nI2++; return nI2 <= 4 ? 'sid-A' : 'sid-B' },
    apiGet: () => Promise.resolve({ executing: false, lastOk: { at: NOW - 5000, sessionId: 'sid-NEXT', fromSid: 'sid-A', model: 'm1' }, error: null, armed: null }),
  })
  hI2.show(); hI2.runEffects(); await hI2.settle()
  ok(openedI2.length === 1, '★ I2 退回 sidQ => 会话已切走仍**发生跳转**（H3 必红 ⇒ 行为级判据有鉴别力）实=' + JSON.stringify(openedI2))
}

console.log('')
console.log('L-A7 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
if (fail > 0) process.exit(1)
