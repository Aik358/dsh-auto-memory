/**
 * L-E 专项验收：#271（插槽排序覆盖同节点的区域隐藏）+ #273（诊断页首错永久「加载中」）。
 *
 * CR-10：**真执行 factory**（照抄 r9 / client-loadable 的 require 回调形态）取真出口，
 *   真构造 normalize 输出、真调用、断言真实副作用；#273 用真组件体 + 受控 hooks 真渲染。
 *   每条判据均配负路径（变异必红、还原复绿）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { normalizeLayoutConfig } from '../../lib/layout-config.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('  ok   - ' + m) } else { fail++; console.log('  FAIL - ' + m) } }

/* ---------- 宿主沙箱（与既有加载守卫同构） ---------- */
function mkStyle () {
  const store = {}
  return store
}
function mkEl (attrs) {
  const el = {
    style: mkStyle(), dataset: {},
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: (c) => c, removeChild: () => {}, setAttribute: () => {}, removeAttribute: () => {},
    getAttribute: function (k) { return (this.__attrs && this.__attrs[k] != null) ? this.__attrs[k] : null },
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    insertBefore: () => {}, contains: () => false, focus: () => {}, blur: () => {},
    firstChild: null, parentNode: null, children: [], textContent: '', innerHTML: '', value: '',
  }
  if (attrs) el.__attrs = attrs
  return el
}

function makeSandbox (opts) {
  const o = opts || {}
  const noop = () => {}
  const logs = [], loaded = []
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
    createElement: () => mkEl(), createElementNS: () => mkEl(), createTextNode: () => mkEl(),
    getElementById: () => null, querySelector: () => null,
    querySelectorAll: o.querySelectorAll || (() => []),
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
    console: { log: (...a) => logs.push(['log', a.map(String).join(' ')]), warn: noop, error: noop },
    window: {
      __ModuleLoader__: { load: (entry) => loaded.push(entry) },
      addEventListener: noop, removeEventListener: noop,
      setTimeout, clearTimeout, setInterval, clearInterval,
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

/** 真执行 factory：照抄 smoke-test-client-loadable 的 require 回调形态 */
function runClient (code, opts) {
  const { sandbox, loaded, logs, React } = makeSandbox(opts)
  const ctx = vm.createContext(sandbox)
  const out = { api: null, topErr: null, factoryErr: null, logs }
  try { new vm.Script(code, { filename: 'client.js' }).runInContext(ctx, { timeout: 20000 }) }
  catch (e) { out.topErr = e; return out }
  const entry = loaded[loaded.length - 1]
  if (!entry || typeof entry.factory !== 'function') { out.topErr = new Error('未取得 factory'); return out }
  try {
    out.api = entry.factory((name) => {
      if (name === 'react') return React
      if (name === 'react-dom') return { createPortal: (n) => n }
      return {}
    })
  } catch (e) { out.factoryErr = e }
  return out
}

/* ============================================================
 * ① #271 · 插槽排序不得覆盖同节点的区域隐藏（真 factory + 真 DOM）
 * ============================================================ */
console.log('=== #271 双锚点节点：区域隐藏 × 插槽排序 ===')

const R = runClient(SRC)
ok(!R.topErr, '① 顶栏执行不抛（' + (R.topErr ? R.topErr.message : 'ok') + '）')
ok(!R.factoryErr, '② ★真执行 factory 不抛（' + (R.factoryErr ? R.factoryErr.message : 'ok') + '）')
const api = R.api || {}
ok(typeof api._applyLayoutSlotsPre === 'function' && typeof api._applyLayoutRegionsPre === 'function',
  '③ R7/R9 出口均为真函数（slots=' + typeof api._applyLayoutSlotsPre + ' regions=' + typeof api._applyLayoutRegionsPre + '）')
if (R.topErr || R.factoryErr) { console.log(''); console.log('[le-271-273] PASS ' + pass + ' / FAIL ' + fail); process.exit(1) }

/** 双锚点头部：data-dam-region="page" + data-dam-slot="head"（问题单的 MemoryPageView 真实头部形态） */
function dualFixture () {
  const head = mkEl({ 'data-dam-region': 'page', 'data-dam-slot': 'head' })
  return { head }
}
const SEL = (nodes) => (sel) => {
  const s = String(sel)
  if (s.indexOf('data-dam-region') >= 0) return nodes.filter((n) => n.__attrs && n.__attrs['data-dam-region'])
  if (s.indexOf('data-dam-slot') >= 0) return nodes.filter((n) => n.__attrs && n.__attrs['data-dam-slot'])
  return []
};

/* --- 判据 1：区域隐藏 + 插槽排序 ⇒ 隐藏不被排序清空 --- */
{
  const { head } = dualFixture()
  const R2 = runClient(SRC, { querySelectorAll: SEL([head]) })
  const a = R2.api || {}
  a._applyLayoutRegionsPre(normalizeLayoutConfig({ regions: { page: { hidden: true } } }))
  ok(head.style.display === 'none', '④ [正] 区域层先写 display=none（实测 "' + head.style.display + '"）')
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  ok(head.style.order === '5', '⑤ [正] 插槽层真写到 order=5（实测 "' + head.style.order + '"）')
  ok(head.style.display === 'none', '⑥ ★#271 核心：插槽排序后 display 仍为 none（实测 "' + head.style.display + '"）')
  // 幂等
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  ok(head.style.display === 'none' && head.style.order === '5', '⑦ [正] 重复应用幂等（仍 none / 5）')
}

/* --- 判据 2：移除插槽排序 ⇒ 只清 order，区域隐藏保留 --- */
{
  const { head } = dualFixture()
  const R3 = runClient(SRC, { querySelectorAll: SEL([head]) })
  const a = R3.api || {}
  a._applyLayoutRegionsPre(normalizeLayoutConfig({ regions: { page: { hidden: true } } }))
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  a._applyLayoutSlotsPre(normalizeLayoutConfig(null))
  ok(head.style.order === '', '⑧ [正] 删插槽配置 ⇒ order 被本层撤回（实测 "' + head.style.order + '"）')
  ok(head.style.display === 'none', '⑨ ★#271：order 撤回不得连带清掉区域层的 display:none（实测 "' + head.style.display + '"）')
}

/* --- 判据 3：取消区域隐藏 ⇒ 只动 display，插槽 order 保留 --- */
{
  const { head } = dualFixture()
  const R4 = runClient(SRC, { querySelectorAll: SEL([head]) })
  const a = R4.api || {}
  a._applyLayoutRegionsPre(normalizeLayoutConfig({ regions: { page: { hidden: true } } }))
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  a._applyLayoutRegionsPre(normalizeLayoutConfig(null))
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  ok(head.style.display === '' , '⑩ [正] 取消区域隐藏 ⇒ display 回默认（实测 "' + head.style.display + '"）')
  ok(head.style.order === '5', '⑪ ★#271：取消区域隐藏不得连带清掉插槽层的 order=5（实测 "' + head.style.order + '"）')
}

/* --- 判据 4：显式插槽隐藏（hidden:true）真实生效 + 可撤回 --- */
{
  const { head } = dualFixture()
  const R5 = runClient(SRC, { querySelectorAll: SEL([head]) })
  const a = R5.api || {}
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { hidden: true } } }))
  ok(head.style.display === 'none', '⑫ [正] 显式 slot.hidden=true ⇒ display=none（实测 "' + head.style.display + '"）')
  a._applyLayoutSlotsPre(normalizeLayoutConfig(null))
  ok(head.style.display === '', '⑬ [正] 撤回 slot.hidden ⇒ display 回默认（实测 "' + head.style.display + '"）')
}

/* --- 判据 5：单个属性变化只影响预期属性（问题单「只影响预期行为」） --- */
{
  const { head } = dualFixture()
  const R6 = runClient(SRC, { querySelectorAll: SEL([head]) })
  const a = R6.api || {}
  a._applyLayoutRegionsPre(normalizeLayoutConfig({ regions: { page: { hidden: true } } }))
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  const d0 = head.style.display, o0 = head.style.order
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 9 } } }))
  ok(head.style.order === '9' && head.style.display === d0, '⑭ [正] 只改排序值 ⇒ display 逐字不变（' + JSON.stringify(d0) + ' → ' + JSON.stringify(head.style.display) + '）')
  a._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 9, hidden: true } } }))
  ok(head.style.display === 'none' && head.style.order === '9', '⑮ [正] 排序 + 显式隐藏并存（前值 ' + JSON.stringify(o0) + '）')
}

/* --- 判据 6：非本层节点零改动（沿用 R9 既有权界） --- */
{
  const foreign = mkEl({ 'data-dam-slot': 'graph' })
  foreign.style.display = 'none'
  const R7 = runClient(SRC, { querySelectorAll: SEL([foreign]) })
  const a7 = R7.api || {}
  a7._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 1 } } }))
  ok(foreign.style.display === 'none', '⑯ [负] 未配置且非本层写过的节点：display 不被越权清空')
}

/* --- 判据 7：★负路径 · 变异必红（把 #271 的按属性归属改回无条件清空） --- */
{
  const MUT_ANCHOR = '        var wroteOrder = layoutOwnedPropWritePre(el, slotOwnedProps, nm, \'order\', (it && it.order !== null) ? String(it.order) : \'\')'
  ok(SRC.split(MUT_ANCHOR).length - 1 === 1, '⑰ 负路径前置：被变异锚串恰命中 1 次')
  const mutated = SRC
    .replace(MUT_ANCHOR, '        if (it && it.order !== null) { el.style.order = String(it.order) } else { el.style.order = \'\' }\n        var wroteOrder = true')
    .replace('        var wroteDisplay = layoutOwnedPropWritePre(el, slotOwnedProps, nm, \'display\', (it && it.hidden === true) ? \'none\' : \'\')',
      '        var wroteDisplay = true\n        if (it && it.hidden === true) el.style.display = \'none\'\n        else el.style.display = \'\'')
  const { head } = dualFixture()
  const RM = runClient(mutated, { querySelectorAll: SEL([head]) })
  ok(!RM.topErr && !RM.factoryErr, '⑱ 变异体真执行不抛（' + (RM.factoryErr ? RM.factoryErr.message : 'ok') + '）')
  const am = RM.api || {}
  am._applyLayoutRegionsPre(normalizeLayoutConfig({ regions: { page: { hidden: true } } }))
  am._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  ok(head.style.display === '', '⑲ [负] ★变异必红：旧写法下插槽层把 display 清空（实测 "' + head.style.display + '"）')
  // 还原复绿：未变异源码同一序列 ⇒ none 保留
  const { head: head2 } = dualFixture()
  const RG = runClient(SRC, { querySelectorAll: SEL([head2]) })
  const ag = RG.api || {}
  ag._applyLayoutRegionsPre(normalizeLayoutConfig({ regions: { page: { hidden: true } } }))
  ag._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 5 } } }))
  ok(head2.style.display === 'none', '⑳ [负] 还原复绿：未变异源码 display 保持 none')
}

/* --- 判据 8：畸形入参不抛（负路径） --- */
{
  const { head } = dualFixture()
  const R8 = runClient(SRC, { querySelectorAll: SEL([head]) })
  let threw = null
  try { (R8.api || {})._applyLayoutSlotsPre(null); (R8.api || {})._applyLayoutSlotsPre({ ok: false }); (R8.api || {})._applyLayoutSlotsPre(42) } catch (e) { threw = e }
  ok(!threw, '㉑ [负] apply 传 3 种畸形配置不抛（' + (threw ? threw.message : 'ok') + '）')
}

/* --- 判据 9：DOM 查询抛错 ⇒ 静默返回 0 --- */
{
  const R9b = runClient(SRC, { querySelectorAll: () => { throw new Error('boom') } })
  let dThrew = null, dRet = null
  try { dRet = (R9b.api || {})._applyLayoutSlotsPre(normalizeLayoutConfig({ slots: { head: { order: 1 } } })) } catch (e) { dThrew = e }
  ok(!dThrew && dRet === 0, '㉒ [负] 查询抛错 ⇒ 静默返回 0（ret=' + dRet + '）')
}

/* ============================================================
 * ② #273 · 诊断页首错必须渲染错误态而不是永久 loading（真组件体真渲染）
 * ============================================================ */
console.log('');
console.log('=== #273 诊断页首错可见性 + 重试可达 ===')

const DBG_START = SRC.indexOf('    function diagnosticFailureRowsPre(')
const DBG_END = SRC.indexOf('    // ───────────────────────── 更新弹窗', DBG_START)
ok(DBG_START > 0 && DBG_END > DBG_START, '㉓ 诊断中心段可定位（真组件体）')
const componentSource = SRC.slice(DBG_START, DBG_END)

/** 受控 hooks 真渲染：cells 跨渲染持久、effects 只收集首次挂载的 */
function mountDebug (opts) {
  const o = opts || {}
  const cells = [], effects = []
  let cursor = 0, first = true, fetchCount = 0
  const calls = { api: [], fetch: 0 }
  const useState = (initial) => {
    const index = cursor++
    if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial
    return [cells[index], (next) => {
      const v = typeof next === 'function' ? next(cells[index]) : next
      if (cells[index] !== v) { cells[index] = v; calls.api.push(v) }
    }]
  }
  const useEffect = (fn) => { if (first) effects.push(fn) }
  const t = (key) => (o.dict && o.dict[key] !== undefined) ? o.dict[key] : ('T:' + key)
  const h = (tag, props, ...children) => ({ tag, props: props || {}, children })
  const render = new Function('useState', 'useEffect', 'h', 'L', 't', 'locale', 'currentWs', 'fmtSize', 'API', 'fetch',
    componentSource + '\nreturn DebugCenter()')
  const show = () => { cursor = 0; return render(useState, useEffect, h, (zh, en) => zh, t, 'zh', () => '', String, o.API || { debug: '/api/debug' }, o.fetch) }
  const mounted = show()
  for (const effect of effects) effect()
  first = false
  return { cells, show, mounted, calls, get fetchCount () { return fetchCount } }
}

/** 成功响应体：覆盖 DebugCenter 正常分支所需字段（真渲染不抛） */
function goodData () {
  return {
    host: { indexPath: '/x/index.json', version: '9.9.9', pid: 1234, startTime: 0, needsRestart: false },
    heartbeat: { exists: true, heartbeatAt: Date.now() },
    autoConsolidate: { pendingQueue: 0, stats: { count: 1, lastAt: 0 }, consolidating: false },
    duplicateHeadings: 0,
    memoryFiles: { user: { exists: true, size: 1 }, notes: { exists: true, size: 1 }, log: { exists: true, size: 1 } },
    logs: { exists: false, path: '/x/log' },
    subagents: { available: true, providers: ['p'] },
    associativeMemory: {},
  }
}

/** 同步驱动：把 await 交给 microtask 队列 */
const flush = () => new Promise((r) => setImmediate(r))

/* --- 判据 10：首拉网络失败 ⇒ 错误文本 + 重试按钮可见，绝不停在「加载中」 --- */
{
  const dict = { dbgLoading: 'LOADING_TEXT', dbgFailed: 'FAILED_TEXT: ', dbgRefresh: 'REFRESH_BTN', dbgRefreshing: 'REFRESHING' }
  let fetchCalls = 0
  const m = mountDebug({
    dict,
    fetch: async () => { fetchCalls++; const e = new Error('SYNTHETIC_NETWORK_FAILURE'); throw e },
  });
  await flush()
  const after = m.show()
  const tree = JSON.stringify(after)
  ok(fetchCalls === 1, '㉔ [正] 首挂载恰发起 1 次请求（实测 ' + fetchCalls + '）')
  ok(m.cells[0] === null, '㉕ [正] 失败后 data 仍为 null（实测 ' + JSON.stringify(m.cells[0]) + '）')
  ok(m.cells[1] && m.cells[1].debug && m.cells[1].debug.error === 'SYNTHETIC_NETWORK_FAILURE', '㉖ [正] 错误被记录进 probes（实测 ' + JSON.stringify(m.cells[1]) + '）')
  ok(m.cells[2] === false, '㉗ [正] busy 已复位（实测 ' + JSON.stringify(m.cells[2]) + '）')
  ok(!/LOADING_TEXT/.test(tree), '㉘ ★#273 核心：失败态不再渲染「加载中」文案')
  ok(/FAILED_TEXT/.test(tree) && /SYNTHETIC_NETWORK_FAILURE/.test(tree), '㉙ ★#273 核心：失败态渲染错误文本与真实原因')
  ok(/REFRESH_BTN/.test(tree), '㉚ ★#273 核心：失败态带重试按钮（不再不可达）')
  ok(/\"data-native-diag-retry\"/.test(tree), '㉛ 重试按钮带稳定锚 data-native-diag-retry')
};

/* --- 判据 11：JSON 解析失败 ⇒ 同样进错误态，且保留 HTTP status --- */
{
  const dict = { dbgLoading: 'LOADING_TEXT', dbgFailed: 'FAILED_TEXT: ', dbgRefresh: 'REFRESH_BTN', dbgRefreshing: 'REFRESHING' }
  const m = mountDebug({
    dict,
    fetch: async () => ({ status: 502, json: async () => { throw new Error('SYNTHETIC_JSON_PARSE_FAILURE') } }),
  });
  await flush()
  const after = JSON.stringify(m.show())
  ok(/SYNTHETIC_JSON_PARSE_FAILURE/.test(after) && !/LOADING_TEXT/.test(after), '㉜ [正] 解析失败 ⇒ 同进错误态')
  ok(m.cells[1].debug.status === 502, '㉝ [正] 响应已到达但解析失败 ⇒ 保留 HTTP status=502（实测 ' + JSON.stringify(m.cells[1].debug) + '）')
}

/* --- 判据 12：失败后点重试成功 ⇒ 正常诊断视图（真取数路径） --- */
{
  const dict = { dbgLoading: 'LOADING_TEXT', dbgFailed: 'FAILED_TEXT: ', dbgRefresh: 'REFRESH_BTN', dbgRefreshing: 'REFRESHING' }
  let n = 0
  const m = mountDebug({
    dict,
    fetch: async () => {
      n++;
      if (n === 1) throw new Error('SYNTHETIC_NETWORK_FAILURE');
      return { status: 200, json: async () => goodData() }
    },
  });
  await flush()
  const failedTree = JSON.stringify(m.show())
  ok(/REFRESH_BTN/.test(failedTree), '㉞ [正] 首错后重试按钮在场')
  // 真找按钮并真调用其 onClick（不靠读源码猜）
  const findRetry = (node) => {
    if (!node || typeof node !== 'object') return null
    if (node.props && node.props['data-native-diag-retry'] !== undefined) return node
    for (const c of (node.children || [])) { const r = findRetry(c); if (r) return r }
    return null
  };
  const retry = findRetry(m.show())
  ok(!!retry && typeof retry.props.onClick === 'function', '㉟ [正] 真取到重试按钮且 onClick 是真函数')
  retry.props.onClick()
  await flush()
  ok(n === 2, '㊱ [正] 点重试 ⇒ 真发起第 2 次请求（实测 ' + n + '）')
  ok(m.cells[0] !== null, '㊲ [正] 重试成功 ⇒ data 到位（实测 ' + (m.cells[0] === null ? 'null' : 'object') + '）')
  const okTree = (() => { try { return JSON.stringify(m.show()) } catch (e) { return 'RENDER_THROW:' + e.message } })()
  ok(okTree.indexOf('RENDER_THROW') !== 0, '㊳ [正] 成功态真渲染不抛（' + okTree.slice(0, 60).replace(/[\r\n]/g, ' ') + '）')
  ok(/data-native-diagnostics/.test(okTree) && !/LOADING_TEXT/.test(okTree) && !/FAILED_TEXT/.test(okTree), '㊴ ★#273 核心：重试成功进入正常诊断视图（非 loading / 非错误态）')
}

/* --- 判据 13：★负路径 · 变异必红（还原旧写法 ⇒ 永久 loading） --- */
{
  const MUT = '      if (!data) return h(\'div\', { \'data-dam-slot\': \'hint\', \'data-dam-hint\': \'\' }, t(\'dbgLoading\'))'
  // ★#273 修好后「旧写法」已不在源码里 ⇒ 前置判据应断言**旧写法已消失、新失败态锚在**。
  //   变异体由新段替换回旧写法构造（下方 mutatedComponent），故仍需 MUT 字面量本身。
  ok(componentSource.split(MUT).length - 1 === 0, '㊵ 负路径前置：旧写法已从源码消失（修后形态）')
  const startIdx = componentSource.indexOf('      var dbgFail = ');
  const endIdx = componentSource.indexOf('      function kv(label, value, warn) {');
  ok(startIdx > 0 && endIdx > startIdx, '㊶ 负路径前置：新失败态段可定位')
  const mutatedComponent = componentSource.slice(0, startIdx) + MUT + '\n' + componentSource.slice(endIdx)
  const dict = { dbgLoading: 'LOADING_TEXT', dbgFailed: 'FAILED_TEXT: ', dbgRefresh: 'REFRESH_BTN', dbgRefreshing: 'REFRESHING' }
  const cells = [], effects = []
  let cursor = 0, first = true
  const useState = (initial) => { const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], (v) => { cells[i] = v }] };
  const useEffect = (fn) => { if (first) effects.push(fn) };
  const h = (tag, props, ...children) => ({ tag, props: props || {}, children });
  const renderMut = new Function('useState', 'useEffect', 'h', 'L', 't', 'locale', 'currentWs', 'fmtSize', 'API', 'fetch',
    mutatedComponent + '\nreturn DebugCenter()')
  const showMut = () => { cursor = 0; return renderMut(useState, useEffect, h, (zh) => zh, (k) => dict[k] || ('T:' + k), 'zh', () => '', String, { debug: '/api/debug' }, async () => { throw new Error('SYNTHETIC_NETWORK_FAILURE') }) };
  showMut()
  for (const e of effects) e()
  first = false
  await flush()
  const mutTree = JSON.stringify(showMut())
  ok(/LOADING_TEXT/.test(mutTree), '㊷ [负] ★变异必红：旧写法下失败仍渲染「加载中」')
  ok(!/FAILED_TEXT|REFRESH_BTN|SYNTHETIC_NETWORK_FAILURE/.test(mutTree), '㊸ [负] ★变异必红：旧写法下错误文本与重试按钮均不可达')
};

/* --- 判据 14：三语词条真实存在且可取值（真字典，非源码字符串断言） --- */
{
  const declStart = SRC.indexOf('    var I18N = {')
  const declEnd = SRC.indexOf("    var localeMode = 'system'")
  ok(declStart > 0 && declEnd > declStart, '㊹ i18n 声明段可定位')
  const sb = { console };
  sb.globalThis = sb;
  vm.runInContext(SRC.slice(declStart, declEnd) + '\nglobalThis.__I18N = I18N', vm.createContext(sb), { filename: 'client.js#i18n' });
  const I18N = sb.__I18N;
  ok(!!I18N, '㊺ ★真执行 i18n 声明段取到真字典')
  for (const loc of ['zh', 'en', 'ja']) {
    const v = I18N[loc] && I18N[loc].dbgFailed;
    ok(typeof v === 'string' && v.length > 0, '㊻ I18N.' + loc + '.dbgFailed 为真字符串（实测 ' + JSON.stringify(v) + '）')
  }
  // 负路径：旧形态（缺键）在 t() 语义下会回落到键名
  const tFallback = (dict, key) => (dict && dict[key]) || key;
  ok(tFallback({}, 'dbgFailed') === 'dbgFailed', '㊼ [负] 缺该键 ⇒ t() 必然回落键名（证明三语条目是必要新增）')
}

console.log('');
console.log('=========================================');
console.log('[le-271-273] PASS ' + pass + ' / FAIL ' + fail);
console.log('=========================================');
process.exit(fail ? 1 : 0)
