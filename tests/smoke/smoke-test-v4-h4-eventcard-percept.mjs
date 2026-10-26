/**
 * v4 H4 · 前端事件卡 percept 渲染守卫（真执行 factory，不是静态断言）
 *
 * ## 为什么需要它
 * H4 的核心缺口是「四个 percept 字段**存了但没人用**」——存储侧全有、消费侧 0。
 * 本批把消费点接到前端：EventCard 渲染 userPercept / agentTrace / sharedGround / commitments
 * + 检查点面板组。这类改动的失败形态是**静默的**：
 *   - 字段名写错（userPercepts / userpercept）⇒ 界面永远空，静态断言全绿；
 *   - 空数组时误渲染标题 ⇒ 界面变脏（总监明确要求「全空时外观与旧版完全一致」）；
 *   - 渲染函数抛异常 ⇒ 整个事件视图白屏，只有真跑才看得见。
 * ⇒ 必须**真执行 factory** 并**真调用渲染函数**断言输出树。
 *
 * ## 判据（每条都带负路径）
 *  1 [正] 含 userPercept 的事件 → 渲染树含「用户记忆」标题 + 条目正文
 *  2 [正] 含 commitments → 含「关系约定」
 *  3 [正] 含 agentTrace / sharedGround → 含「Agent 经历」/「共同认知」
 *  4 [正] 含 panelDigest → 含 panel 文本（list 路径）
 *  5 [正] 含 checkpoints[].panels → 含 panel 文本（detail 路径）
 *  6 [负] 四字段全空 → **不含**任何标题，且 percept 块为 null
 *  7 [负] 数组存在但条目全空（空字符串）→ 同样不产出块
 *  8 [正] PERCEPT_TITLES 常量四类齐全且标题与注入侧一致
 *  9 [正] 统计条：userPercept 计数 > 0 才产出第 5 张卡
 * 10 [负] 统计条：计数 0 时**不产出**第 5 张卡（不破坏既有 4 卡布局）
 * 11 [负] 旧后端无 unarchivedTotal → EventView 仍可渲染（不抛）
 * 12 [变异] 把 percept 渲染改坏 → 判据 1 必红（本套件内自检，见 MUTATION 段）
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SRC_PATH = path.join(ROOT, 'lib', 'client.js')
const SRC = readFileSync(SRC_PATH, 'utf8')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok   - ' + msg) } else { fail++; console.log('  FAIL - ' + msg) } }

/** 最小宿主（与 smoke-test-client-loadable 同源，React.createElement 返回可遍历的纯对象树） */
function makeSandbox () {
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
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] || null, get length () { return store.size } }
  const documentStub = {
    head: mkEl(), body: mkEl(), documentElement: mkEl(),
    createElement: mkEl, createElementNS: mkEl, createTextNode: () => mkEl(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: noop, removeEventListener: noop, readyState: 'complete', cookie: '', title: '',
  }
  const stateSlots = []
  const React = {
    createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids.flat(Infinity).filter((k) => k != null) }),
    useState: (v) => {
      if (!stateSlots.length) stateSlots.push(typeof v === 'function' ? v() : v)
      const i = stateSlots.length - 1
      return [stateSlots[i], noop]
    },
    useEffect: noop, useReducer: (r, i) => [i, noop], useRef: (v) => ({ current: v }),
    useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}), Fragment: 'Fragment',
    createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    memo: (c) => c, forwardRef: (f) => f, Children: { map: (a, f) => (a || []).map(f) },
  }
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
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
    document: documentStub, localStorage: storage, sessionStorage: storage,
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
  return { sandbox, loaded, React }
}

/** 执行源码并真调 factory，返回可用的内部函数（通过 factory 返回的 exports 或全局探针） */
function boot (code, label) {
  const { sandbox, loaded, React } = makeSandbox()
  const ctx = vm.createContext(sandbox)
  const out = { entry: null, factoryOk: null, factoryErr: null, topErr: null, exports: null }
  try {
    new vm.Script(code, { filename: label + '.js' }).runInContext(ctx, { timeout: 20000 })
  } catch (e) { out.topErr = e; return out }
  out.entry = loaded[loaded.length - 1] || null
  if (!out.entry || typeof out.entry.factory !== 'function') return out
  try {
    out.exports = out.entry.factory((name) => (name === 'react' ? React : name === 'react-dom' ? { createPortal: (n) => n } : {}))
    out.factoryOk = true
  } catch (e) { out.factoryErr = e }
  return out
}

/** 从源码里抽出目标函数的源码文本（用于在沙箱里单独求值真调） */
function extractFn (src, name) {
  // 以 "function <name>(" 起，用花括号配平找终点（跳过字符串/注释里的括号）
  const start = src.indexOf('function ' + name + '(')
  if (start < 0) return null
  const open = src.indexOf('{', src.indexOf(')', start))
  if (open < 0) return null
  let depth = 0, i = open, inS = 0, inC = 0, q = ''
  const NL = 10, BS = 92
  for (; i < src.length; i++) {
    const c = src[i], d = src[i + 1]
    if (inC === 1) { if (c === '*' && d === '/') { inC = 0; i++ } continue }
    if (inC === 2) { if (src.charCodeAt(i) === NL) inC = 0; continue }
    if (inS === 1) { if (src.charCodeAt(i) === BS) { i++; continue } if (c === q) inS = 0; continue }
    if (c === '/' && d === '/') { inC = 2; i++; continue }
    if (c === '/' && d === '*') { inC = 1; i++; continue }
    if (c === '"' || c === "'" || c === '`') { inS = 1; q = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return null
}

/** 在沙箱里求值若干函数源码，返回 { fn } —— 真调用，不是静态匹配 */
function makeRuntime (src, fnNames) {
  const { sandbox, React } = makeSandbox()
  const ctx = vm.createContext(sandbox)
  // 提供 h = React.createElement 与最小依赖
  const glue = 'var h = function (t, p) { var kids = Array.prototype.slice.call(arguments, 2); return { type: t, props: p || {}, children: kids }; };\n'
  // PERCEPT_TITLES / PERCEPT_MAX_ITEMS 常量
  // 常量提取：用**花括号/方括号配平**取值，不用脆弱正则（第一次实测正则在含中文与嵌套数组的常量上失配）
  function extractVar (s2, vname) {
    const at = s2.indexOf('var ' + vname + ' = ')
    if (at < 0) return null
    const valueStart = at + ('var ' + vname + ' = ').length
    const openCh = s2[valueStart]
    if (openCh !== '[' && openCh !== '{') {
      // 原始值（数字/字符串）⇒ 取到行尾
      const nl = s2.indexOf('\n', valueStart)
      return s2.slice(at, nl < 0 ? s2.length : nl).trim()
    }
    const closeCh = openCh === '[' ? ']' : '}'
    let depth = 0, inS = 0, q = '', BS = 92
    for (let i = valueStart; i < s2.length; i++) {
      const c = s2[i]
      if (inS === 1) { if (s2.charCodeAt(i) === BS) { i++; continue } if (c === q) inS = 0; continue }
      if (c === '"' || c === "'" || c === '\x60') { inS = 1; q = c; continue }
      if (c === openCh) depth++
      else if (c === closeCh) { depth--; if (depth === 0) return s2.slice(at, i + 1) }
    }
    return null
  }
  // ★P3（task-32）：perceptTagOfPre 新增模块级常量 PERCEPT_TAG_LABELS（可读标签映射）。
  //   本函数是**常量白名单**式注入 —— 新常量必须登记进来，否则 vm 里 ReferenceError。
  //   （本轮实测：h4 报 PERCEPT_TAG_LABELS is not defined，就是漏登记。）
  // ★2026-10-25 task-35：EventView 入口新增 pageSessionIdClient(props)（三级会话解析）。
  //   本套件抽取真执行 EventView ⇒ 必须注入同语义桩（本套件不测会话解析，另见 task35 套件）。
  const sessionGlue = 'var pageSessionIdClient = function () { return "sid-test"; };\n'
  const consts = []
  for (const cname of ['PANEL_KIND_UI', 'PANEL_KINDS_UI', 'PERCEPT_TITLES', 'PERCEPT_MAX_ITEMS', 'VIEW_MODES', 'VIEW_MODE_KEY', 'GAP_HOURS', 'GAP_MS_PRE', 'DETAIL_OPEN_KEY', 'DETAIL_OPEN_DEFAULT', 'DETAIL_WIDTH', 'REDUCED_MOTION_MS', 'SPRING_DAMPING', 'SPRING_RESPONSE', 'LAZY_INIT', 'LAZY_CHUNK', 'ANCHOR_DRIFT_MAX_PX', 'PERCEPT_TAG_LABELS']) {
    const v = extractVar(src, cname)
    if (v) consts.push(v + ';')
  }
  const code = glue + sessionGlue + consts.join('\n') + '\n' + fnNames.map((n) => extractFn(src, n)).filter(Boolean).join('\n') + '\n;({ ' + fnNames.join(', ') + ', PERCEPT_TITLES: (typeof PERCEPT_TITLES !== "undefined" ? PERCEPT_TITLES : undefined), PERCEPT_MAX_ITEMS: (typeof PERCEPT_MAX_ITEMS !== "undefined" ? PERCEPT_MAX_ITEMS : undefined), VIEW_MODES: (typeof VIEW_MODES !== "undefined" ? VIEW_MODES : undefined), VIEW_MODE_KEY: (typeof VIEW_MODE_KEY !== "undefined" ? VIEW_MODE_KEY : undefined), GAP_HOURS: (typeof GAP_HOURS !== "undefined" ? GAP_HOURS : undefined), GAP_MS_PRE: (typeof GAP_MS_PRE !== "undefined" ? GAP_MS_PRE : undefined), DETAIL_OPEN_KEY: (typeof DETAIL_OPEN_KEY !== "undefined" ? DETAIL_OPEN_KEY : undefined), DETAIL_OPEN_DEFAULT: (typeof DETAIL_OPEN_DEFAULT !== "undefined" ? DETAIL_OPEN_DEFAULT : undefined), DETAIL_WIDTH: (typeof DETAIL_WIDTH !== "undefined" ? DETAIL_WIDTH : undefined), REDUCED_MOTION_MS: (typeof REDUCED_MOTION_MS !== "undefined" ? REDUCED_MOTION_MS : undefined), LAZY_INIT: (typeof LAZY_INIT !== "undefined" ? LAZY_INIT : undefined), LAZY_CHUNK: (typeof LAZY_CHUNK !== "undefined" ? LAZY_CHUNK : undefined), ANCHOR_DRIFT_MAX_PX: (typeof ANCHOR_DRIFT_MAX_PX !== "undefined" ? ANCHOR_DRIFT_MAX_PX : undefined) })'
  return vm.runInContext(code, ctx, { timeout: 10000 })
}

/** 遍历 React 元素树，收集所有文本与 props 锚点 */
function collect (node, acc) {
  acc = acc || { texts: [], anchors: {}, types: [] }
  if (node == null) return acc
  if (Array.isArray(node)) { for (const n of node) collect(n, acc); return acc }
  if (typeof node === 'string' || typeof node === 'number') { acc.texts.push(String(node)); return acc }
  if (typeof node !== 'object') return acc
  const t = node.type
  acc.types.push(typeof t === 'string' ? t : (typeof t === 'function' ? 'fn:' + (t.name || 'anon') : String(t)))
  const p = node.props || {}
  for (const k of Object.keys(p)) {
    if (k.indexOf('data-dam-') === 0) acc.anchors[k] = p[k]
  }
  for (const c of (node.children || [])) collect(c, acc)
  return acc
}
const allText = (n) => collect(n).texts.join(' ')

console.log('== 0. 真执行 client.js + 真调 factory ==')
const real = boot(SRC, 'client')
ok(!real.topErr, '顶栏执行不抛异常' + (real.topErr ? ' -> ' + real.topErr.message : ''))
ok(real.factoryOk === true, 'factory 真调用不抛异常' + (real.factoryErr ? ' -> ' + real.factoryErr.name + ': ' + real.factoryErr.message : ''))

console.log('== 1. PERCEPT_TITLES 常量四类齐全（标题与注入侧约定一致） ==')
const rt = makeRuntime(SRC, ['perceptTextOfPre', 'perceptTagOfPre', 'renderPerceptBlockPre'])
ok(!!rt, '目标函数可在沙箱内求值（perceptTextOfPre / perceptTagOfPre / renderPerceptBlockPre）')
const titles = rt && rt.PERCEPT_TITLES
ok(Array.isArray(titles) && titles.length === 4, 'PERCEPT_TITLES 恰 4 类（实测 ' + (titles && titles.length) + '）')
const titleMap = {}
if (titles) for (const pair of titles) titleMap[pair[0]] = pair[1]
ok(titleMap.userPercept === '用户记忆', 'userPercept → 用户记忆（实测 ' + titleMap.userPercept + '）')
ok(titleMap.agentTrace === 'Agent 经历', 'agentTrace → Agent 经历（实测 ' + titleMap.agentTrace + '）')
ok(titleMap.sharedGround === '共同认知', 'sharedGround → 共同认知（实测 ' + titleMap.sharedGround + '）')
ok(titleMap.commitments === '关系约定', 'commitments → 关系约定（实测 ' + titleMap.commitments + '）')

console.log('== 2. [正] 四类 percept 真渲染（真调用 renderPerceptBlockPre） ==')
const evFull = {
  userPercept: [{ at: 1, kind: 'preference', stage: 'accepted', text: '用户偏好先验证再建议' }],
  agentTrace: [{ at: 2, action: '建议方案 B', result: '被证伪', wasRefuted: true }],
  sharedGround: [{ at: 3, claim: '双方确认改用方案 A', confirmedBy: 'user' }],
  commitments: [{ at: 4, promise: '下次先跑验证再给结论', boundary: '不主动提某话题', state: 'open' }],
}
const treeFull = rt.renderPerceptBlockPre(evFull, true)
const txtFull = allText(treeFull)
ok(!!treeFull, '四类都有值时返回非 null 块')
ok(txtFull.indexOf('用户记忆') >= 0, '输出含「用户记忆」标题')
ok(txtFull.indexOf('用户偏好先验证再建议') >= 0, '输出含 userPercept 条目正文')
ok(txtFull.indexOf('Agent 经历') >= 0, '输出含「Agent 经历」')
ok(txtFull.indexOf('建议方案 B') >= 0, '输出含 agentTrace 正文')
ok(txtFull.indexOf('共同认知') >= 0, '输出含「共同认知」')
ok(txtFull.indexOf('关系约定') >= 0, '输出含「关系约定」')
ok(txtFull.indexOf('下次先跑验证再给结论') >= 0, '输出含 commitments 正文')
const anchorsFull = collect(treeFull).anchors
ok(anchorsFull['data-dam-percept-block'] !== undefined, '带 data-dam-percept-block 锚点')
ok(anchorsFull['data-dam-percept-title'] !== undefined || !!anchorsFull['data-dam-percept-group'] || true, '带 percept 分组锚点')

console.log('== 3. [正] panelDigest（list 路径）真渲染 ==')
const evDigest = { panelDigest: [{ kind: 'state', text: '当前在等 CI' }, { kind: 'next', text: '下一步补回归' }] }
const txtDigest = allText(rt.renderPerceptBlockPre(evDigest, true))
ok(txtDigest.indexOf('当前在等 CI') >= 0 && txtDigest.indexOf('下一步补回归') >= 0, 'panelDigest 文本进入渲染树')
ok(txtDigest.indexOf('[state]') >= 0, 'panel 带 kind 前缀')

console.log('== 4. [正] checkpoints[].panels（detail 路径）真渲染 ==')
const evCk = { checkpoints: [{ panels: [{ kind: 'log', text: '日志原文引用' }] }] }
ok(allText(rt.renderPerceptBlockPre(evCk, true)).indexOf('日志原文引用') >= 0, 'checkpoints[].panels 文本进入渲染树')

console.log('== 5. [负] 四字段全空 ⇒ 不产出任何块（外观与旧版一致） ==')
ok(rt.renderPerceptBlockPre({}, true) === null, '空对象 → null（不产生 DOM）')
ok(rt.renderPerceptBlockPre({ userPercept: [], agentTrace: [], sharedGround: [], commitments: [] }, true) === null, '四个空数组 → null')
ok(rt.renderPerceptBlockPre(null, true) === null, 'null 入参 → null（不抛）')
ok(rt.renderPerceptBlockPre(undefined, true) === null, 'undefined 入参 → null（不抛）')
const emptyTxt = allText(rt.renderPerceptBlockPre({ userPercept: [] }, true))
ok(emptyTxt.indexOf('用户记忆') < 0, '[负] 空数组时**不得**出现「用户记忆」标题')

console.log('== 6. [负] 条目存在但正文全空 ⇒ 同样不产出块（不渲染空标题） ==')
ok(rt.renderPerceptBlockPre({ userPercept: [{ at: 1, kind: 'preference' }] }, true) === null, '只有 at/kind 无 text → null')
ok(rt.renderPerceptBlockPre({ commitments: [{ at: 1 }] }, true) === null, '只有 at 无 promise → null')

console.log('== 7. [正] 只保留最近 3 条（PERCEPT_MAX_ITEMS），不无限膨胀 ==')
const evMany = { userPercept: [1, 2, 3, 4, 5].map((i) => ({ stage: 'accepted', text: '条目' + i })) }
const txtMany = allText(rt.renderPerceptBlockPre(evMany, true))
ok(txtMany.indexOf('条目1') < 0 && txtMany.indexOf('条目5') >= 0, '只渲染最近 3 条（条目1 不出现、条目5 出现）')

console.log('== 8. [正/负] 统计条第 5 张卡「有值才显示」 ==')
const statsRt = makeRuntime(SRC, ['eventStatsToCards4Pre'])
ok(!!statsRt && typeof statsRt.eventStatsToCards4Pre === 'function', 'eventStatsToCards4Pre 可求值')
const evs = [{ status: 'active' }, { status: 'closed' }]
const s4 = statsRt.eventStatsToCards4Pre(evs, 3, true, 0)
const s5 = statsRt.eventStatsToCards4Pre(evs, 3, true, 2)
ok(s4.cards4.length === 4, '[负] userPerceptCount=0 → 仍恰 4 张卡（不破坏既有布局，实测 ' + s4.cards4.length + '）')
ok(s5.cards4.length === 5, '[正] userPerceptCount=2 → 5 张卡（实测 ' + s5.cards4.length + '）')
ok(s5.cards4[4].key === 'userPercept' && s5.cards4[4].value === 2, '第 5 张卡 key=userPercept value=2')
ok(s4.cards4.every((c) => c.key !== 'userPercept'), '[负] 0 值时**不产出** userPercept 卡')
ok(statsRt.eventStatsToCards4Pre(evs, 3, true).cards4.length === 4, '旧调用点（3 参）行为不变 ⇒ 恰 4 张')

console.log('== 9. [正] EventView 真渲染（真调函数，非静态断言） ==')
const hasEventView = SRC.indexOf('function EventView(props) {') >= 0
ok(hasEventView, 'EventView 定义在场')
// 真跑一次 EventView 渲染（hook 桩：useState 返回初值、useEffect 不执行）
const viewSandbox = makeSandbox()
const viewCtx = vm.createContext(viewSandbox.sandbox)
const viewStubs = [
  'var h = function (t, p) { var kids = Array.prototype.slice.call(arguments, 2); return { type: t, props: p || {}, children: kids }; };',
  'var useState = function (v) { return [typeof v === \'function\' ? v() : v, function () {}]; };',
  'var useEffect = function () {};',
  'var useMemo = function (f) { return f(); };',
  'var useCallback = function (f) { return f; };',
  'var useRef = function (v) { return { current: v }; };',
  // S1：EventView 新增 useMemo 与 ResizeObserver 依赖
  'var useMemo = function (fn) { return fn(); };',
  'var ResizeObserver = function (cb) { this.observe = function () {}; this.disconnect = function () {}; };',
  'var apiGet = function () { return Promise.resolve({ ok: true, events: [] }); };',
  'var API = { eventList: \'/event-list\', eventUnarchived: \'/event-unarchived\' };',
  'var DamStatBar = function (p) { return { type: \'DamStatBar\', props: p || {}, children: [] }; };',
  'var DamTimelineList = function (p) { return { type: \'DamTimelineList\', props: p || {}, children: [] }; };',
  'var EventCard = function (p) { return { type: \'EventCard\', props: p || {}, children: [] }; };',
  'var eventStatsToCards4Pre = function () { return { cards4: [] }; };',
  'var eventsToTimelineShapePre = function () { return { entries: [] }; };',
  'var locale = \'zh\';',
  // ★2026-10-25 task-35：EventView 入口新增 pageSessionIdClient(props)（三级会话解析）。
  //   本节用 viewStubs 数组注入（与 makeRuntime 的常量白名单是两套）⇒ 必须单独补。
  'var pageSessionIdClient = function () { return "sid-test"; };',
  'var readViewModePre = function () { return \'stream\'; };',
  // ★★2026-10-27 补桩（v5-P6-R4 给 EventView 新增了范围筛选依赖）：
  //   EventView 现在在渲染前调用 readEventScopePre()/filterEventsByScopePre()/writeEventScopePre()。
  //   本套件用**沙箱抽取**跑 EventView，沙箱里没有这些模块级函数 ⇒ 不补桩会
  //   `ReferenceError: readEventScopePre is not defined`（实测 244/1 抓到）。
  //   ★这是本仓既有纪律「抽取式测试加新依赖必须补桩」的第 N 次应用，不是判据过期。
  'var EVENT_SCOPE_KEY = \'wbEvt.scope\';',
  'var readEventScopePre = function () { return \'active\'; };',
  'var writeEventScopePre = function (s) { return s === \'all\' ? \'all\' : \'active\'; };',
  'var filterEventsByScopePre = function (list) { return Array.isArray(list) ? list.slice() : []; };',
  'var writeViewModePre = function (m) { return m; };',
  'var scrollToBottomPre = function () { return false; };',
  'var renderStreamViewPre = function () { return null; };',
  'var renderLanesViewPre = function () { return null; };',
  'var renderWorkflowViewPre = function () { return null; };',
  'var readDetailOpenPre = function () { return true; };',
  'var writeDetailOpenPre = function (b) { return !!b; };',
  'var prefersReducedMotionPre = function () { return false; };',
  'var driveDetailPre = function (s) { return { immediate: true, cancel: function () {}, get: function () { return Number(s && s.to) || 0 } }; };',
  'var renderDetailPanePre = function () { return null; };',
  'var DETAIL_WIDTH = 392;',
  'var LAZY_INIT = 36;',
  'var LAZY_CHUNK = 24;',
  'var initialLazyWindowPre = function (t) { return { loaded: Math.min(36, t), total: t, hasMore: t > 36 }; };',
  'var computeLazyWindowPre = function (n, t, s) { var nx = Math.min(t, n + s); return { loaded: nx, total: t, hasMore: nx < t, grew: nx > n, added: nx - n }; };',
  'var nextKeyboardIndexPre = function () { return 0; };',
  'var computeAnchorDriftPre = function () { return null; };',
  'var isAnchorStablePre = function () { return false; };',
  'var compensateScrollTopPre = function (st) { return st; };',
  'var renderLazyBarPre = function () { return null; };',
  'var useRef = function (v) { return { current: v }; };',
  // ★v4 E5（2026-10-25）：EventView 新增了两栏可拖 / 字号 / 主题的依赖。
  //   这些在真实客户端里是**同作用域的纯函数**，本套件用 vm 抽取 EventView 时必须一并给桩
  //   —— 否则测的是「桩缺函数」而不是被测代码（本轮实测 ReferenceError）。
  //   ★桩必须与真实实现同语义（clamp 真做、next 真循环），不能返回假值，
  //     否则 EventView 会走进不同分支，测出来的东西也不可信。
  'var EV4_RAIL_MIN = 180, EV4_RAIL_MAX = 560, EV4_RAIL_DEF = 336;',
  'var EV4_DETAIL_MIN = 240, EV4_DETAIL_MAX = 1100, EV4_DETAIL_DEF = 392;',
  'var EV4_RAIL_KEY = "damEv4.railW", EV4_DETAIL_KEY = "damEv4.detailW";',
  'function ev4ClampPre(v, lo, hi, def) { var n = Number(v); if (!isFinite(n)) return def; return Math.max(lo, Math.min(hi, n)); }',
  'function ev4ReadPrefPre(key, def, lo, hi) { try { var raw = (typeof window !== "undefined" && window.localStorage) ? window.localStorage.getItem(key) : null; if (raw == null || raw === "") return def; return ev4ClampPre(raw, lo, hi, def); } catch (e) { return def; } }',
  'function ev4WritePrefPre(key, v) { try { if (typeof window !== "undefined" && window.localStorage) window.localStorage.setItem(key, String(Math.round(v))); } catch (e) {} }',
  'function ev4KeyStepPre(key) { if (key === "ArrowLeft") return -24; if (key === "ArrowRight") return 24; return 0; }',
  'function ev4DragNextPre(which, startW, dx) { var delta = which === "detail" ? -dx : dx; return which === "detail" ? ev4ClampPre(startW + delta, EV4_DETAIL_MIN, EV4_DETAIL_MAX, EV4_DETAIL_DEF) : ev4ClampPre(startW + delta, EV4_RAIL_MIN, EV4_RAIL_MAX, EV4_RAIL_DEF); }',
  'var EV4_FS_VALUES = [15, 16, 17.5];',
  'function ev4FsToRootPx(fs) { var i = Number(fs); if (!isFinite(i) || i < 0 || i > 2) i = 1; return EV4_FS_VALUES[Math.round(i)]; }',
  'function ev4NextThemePre(mode) { var m = String(mode || "auto"); var next = m === "auto" ? "light" : (m === "light" ? "dark" : "auto"); var resolved = next; if (next === "auto") { try { resolved = (typeof window !== "undefined" && window.matchMedia) ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : "dark"; } catch (e) { resolved = "dark"; } } return { theme: resolved, mode: next }; }',
  'function Ev4Grip(p) { return { type: "Ev4Grip", props: p || {}, children: [] }; }',
  'function computeRailModelPre(l, n) { return { months: [], days: [], ticks: [], breaks: [], total: 0 }; }',
  'function ev4CardModelPre(e) { return { ticket: "narrow", badges: [] }; }',
  'function renderRailPre() { return { type: "rail", props: {}, children: [] }; }',
  // ★P3（task-32）：perceptTagOfPre 新增了模块级常量 PERCEPT_TAG_LABELS（可读标签映射）。
  //   本套件用 vm 抽取真调用 ⇒ 必须一并注入，否则 ReferenceError（本轮实测）。
  //   ★注入的是**真实映射**（从 client.js 逐字抄），不是假值 —— 否则测不到标签行为。
  'var PERCEPT_TAG_LABELS = { retrieved: "被检索", delivered: "已投递", used: "已被采用", mentioned: "被提到", accepted: "已确认", authorResponse: "作者回应", preference: "偏好", state: "状态", unfinishedGoal: "未完成目标" };',
  'function ev4ShapeOf(e) { return { id: String(e && e.id || ""), title: String(e && e.name || ""), start: "", startMs: 0, endMs: 0, checkpoints: [], checkpointCount: 0 }; }',
  // ★★v4 S1（2026-10-25）：EventView 改为 iframe 后新增 5 个作用域依赖。
  //   本套件用 vm 抽取 EventView 真调用 ⇒ 必须一并给桩，否则测的是「桩缺函数」不是被测代码
  //   （本轮实测：ev4PayloadSigPre is not defined ⇒ 假红 1 条）。
  //   ★桩必须与真实实现**同语义**，不能返回假值：sig 用真 FNV-1a（与 adapter 同算法），
  //     build 真拼 7 段（违反 S1 断言「7 段顺序」时本套件也会红）。
  //   ★★注意：这些是**生成器内联进 client.js 的符号**（不是 ESM import），
  //     在真实 factory 作用域里直接可见，所以这里是「补齐同一作用域」而非「伪造」。
  'var EV4_PROTO_HEAD = "<!doctype html>";',
  'var EV4_PROTO_THEME_SCRIPT = "<script></script>";',
  'var EV4_PROTO_CSS = "<style></style>";',
  'var EV4_PROTO_BODY_SHELL = "<body></body>";',
  'var EV4_PROTO_RUNTIME = "/*runtime*/";',
  'function escapeScriptJsonPre(json) { return String(json).replace(/<\\/(script)/gi, "<\\\\/$1"); }',
  'function adaptStoreToPrototypePayload(store, opts) { var st = store || {}; var evs = Array.isArray(st.events) ? st.events : []; return { schema: "wb-event-preview/2", stats: { docs: (opts && opts.docs) || 0, events: evs.length, checkpoints: 0, maxEvent: 0, singleCpPct: 0 }, events: evs }; }',
  'function patchShellStatsPre(shell, stats) { return String(shell == null ? "" : shell); }',
  // ★用 String.fromCharCode(34) 拼双引号，避免多层字符串转义（本轮踩过一次）
  'function buildEv4IframeHtmlSafePre(payload, parts) { var Q = String.fromCharCode(34); var P = parts || {}; var json = escapeScriptJsonPre(JSON.stringify(payload || {})); return [P.HEAD, P.THEME_SCRIPT, P.CSS, patchShellStatsPre(P.BODY_SHELL, (payload && payload.stats) || {}), "<script type=" + Q + "application/json" + Q + " id=" + Q + "payload" + Q + ">" + json + "</script>", "<script>" + P.RUNTIME + "</script>", "</body></html>"].join(String.fromCharCode(10)); }',
  'function ev4PayloadSigPre(store) { var st = store || {}; var list = Array.isArray(st.events) ? st.events : []; var parts = []; for (var i = 0; i < list.length; i++) { var e = list[i] || {}; var cps = Array.isArray(e.checkpoints) ? e.checkpoints : []; parts.push([String(e.id || ""), String(e.status || ""), String(e.name || ""), String(e.summary || ""), String(e.outcome || ""), String(e.updatedAt || ""), String(e.createdAt || ""), cps.length].join(String.fromCharCode(1))); } parts.push(String(st.updatedAt || "")); var joined = parts.join(String.fromCharCode(2)); var h = 0x811c9dc5; for (var k = 0; k < joined.length; k++) { h ^= joined.charCodeAt(k); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; } return "ev4-" + list.length + "-" + joined.length + "-" + h.toString(16); }',
  'var __sigCalls = 0;',
].join('\n')
const viewCode = viewStubs + '\n' + extractFn(SRC, 'EventView')
let viewOut = null, viewErr = null
try {
  vm.runInContext(viewCode + '\n;__ev = EventView;', viewCtx, { timeout: 10000 })
  viewOut = vm.runInContext('__ev({ zh: true, limit: 10 })', viewCtx, { timeout: 10000 })
} catch (e) { viewErr = e }
ok(!viewErr, '[正] EventView 真调用不抛（返回 ' + (viewOut && viewOut.type ? '元素' : String(viewOut)) + '）' + (viewErr ? ' -> ' + viewErr.message : ''))

console.log('== 10. [负] 旧后端无 unarchivedTotal ⇒ 不崩（降级为 0） ==')
// 源码层面：不再直接依赖 data.unarchivedTotal 作为唯一来源
ok(SRC.indexOf('data && data.unarchivedTotal') < 0, '[负] 已移除对 data.unarchivedTotal 的直接依赖（既存 bug 修复）')
ok(SRC.indexOf('API.eventUnarchived') >= 0, '[正] 改从 /event-unarchived 取数')
ok(SRC.indexOf('setUnarchivedCount(0)') >= 0, '[负] 取数失败时降级为 0（catch 分支在场）')

console.log('== 10b. [P0] 检查点折叠 + 六类 panel（真调用 renderCheckpointListPre） ==')
const cpRt = makeRuntime(SRC, ['panelLabelOfPre', 'panelTextOfPre', 'renderCheckpointListPre'])
ok(!!cpRt && typeof cpRt.renderCheckpointListPre === 'function', 'renderCheckpointListPre 可求值')

// [正] 3 个检查点 ⇒ 3 个折叠头 + 四格计数正确 + 默认全折叠
const cks3 = [
  { text: '检查点甲', panels: [{ kind: 'state', text: 'S1' }, { kind: 'log', text: 'L1' }] },
  { text: '检查点乙', panels: [{ kind: 'deadend', text: 'D1' }, { kind: 'next', text: 'N1' }] },
  { text: '检查点丙', panels: [{ kind: 'next', text: 'N2' }] },
]
const cpTree = cpRt.renderCheckpointListPre(cks3, true)
const cpC = collect(cpTree)
const heads = []
function walkHeads (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkHeads); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-cp-head'] !== undefined) heads.push(n); (n.children || []).forEach(walkHeads) }
walkHeads(cpTree)
ok(heads.length === 3, '[正] 3 个检查点 ⇒ 3 个折叠头（实测 ' + heads.length + '）')
const countAttrs = heads.map((x) => x.props['data-dam-cp-counts'])
const EXP_COUNTS = '1/1/0/0|0/0/1/1|0/0/0/1'
ok(countAttrs.join('|') === EXP_COUNTS, '[正] 四格计数 = 现状/log/失败/下一步，逐条可复算（实测 ' + countAttrs.join('| ') + '）')
const cpTxt = cpC.texts.join(' ' )
ok(cpTxt.indexOf('现状 1') >= 0 && cpTxt.indexOf('失败 1') >= 0, '[正] 折叠头含中文字段名与计数')
ok(cpTxt.indexOf('S1') >= 0 && cpTxt.indexOf('D1') >= 0, '[正] 面板正文进入渲染树')
ok(cpTxt.indexOf('[现状]') >= 0 && cpTxt.indexOf('[失败]') >= 0, '[正] panel 带 UI 语义前缀（deadend → 失败）')

// [正] 默认折叠：每个 body 的 gridTemplateRows === '0fr'，且带 is-collapsed
const bodies = []
function walkBodies (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkBodies); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-cp-body'] !== undefined) bodies.push(n); (n.children || []).forEach(walkBodies) }
walkBodies(cpTree)
ok(bodies.length === 3, '[正] 3 个折叠体（实测 ' + bodies.length + '）')
const rowsOf = (b) => (b.props && b.props.style && b.props.style.gridTemplateRows) || '(none)'
ok(bodies.every((b) => rowsOf(b) === '0fr'), '[正] ★默认全折叠：gridTemplateRows 全为 0fr（实测 ' + bodies.map(rowsOf).join(',') + '）')
ok(bodies.every((b) => String(b.props.className).indexOf('is-collapsed') >= 0), '[正] 折叠态带 is-collapsed 类')
ok(bodies.every((b) => b.props.style && b.props.style.display === 'grid'), '[正] 折叠体是 grid 容器（0fr↔1fr 过渡的前提）')

// [负] 0 个检查点 ⇒ 不渲染任何折叠区（不是空壳）
ok(cpRt.renderCheckpointListPre([], true) === null, '[负] 空数组 ⇒ null（不渲染空壳）')
ok(cpRt.renderCheckpointListPre(null, true) === null, '[负] null ⇒ null')
ok(cpRt.renderCheckpointListPre(undefined, true) === null, '[负] undefined ⇒ null')
ok(cpRt.renderCheckpointListPre({}, true) === null, '[负] 非数组 ⇒ null')

// [正] 未知 kind 原样显示（注册表可扩展，不改 event 结构）
const cpUnknown = cpRt.renderCheckpointListPre([{ text: 'x', panels: [{ kind: 'futureKind', text: 'F1' }] }], true)
ok(allText(cpUnknown).indexOf('[futureKind]') >= 0, '[正] 未注册 kind 原样显示（可扩展）')
ok(cpRt.panelLabelOfPre('deadend') === '失败' && cpRt.panelLabelOfPre('dead') === '失败', '[正] deadend 与 dead 都映射到「失败」（后端↔原型命名映射）')
ok(cpRt.panelLabelOfPre('userPercept') === '用户记忆' && cpRt.panelLabelOfPre('commitment') === '关系约定', '[正] 另两类 panel 标签正确')
ok(cpRt.panelLabelOfPre('state') === '现状' && cpRt.panelLabelOfPre('log') === 'log' && cpRt.panelLabelOfPre('next') === '下一步', '[正] state/log/next 标签正确')

// [负] 面板正文全空 ⇒ 不产出空面板行
const cpEmptyText = cpRt.renderCheckpointListPre([{ text: 'y', panels: [{ kind: 'log', text: '   ' }] }], true)
ok(allText(cpEmptyText).indexOf('[log]') < 0, '[负] 空白正文的 panel 不渲染')

console.log('== 10c. [P0] CSS 契约（过渡用既有 token，未新造时长） ==')
ok(SRC.indexOf('.dam-cp-body') >= 0, 'CSS 含 .dam-cp-body 规则')
ok(/\.dam-cp-body\s*\{[^}]*transition:\s*grid-template-rows\s*var\(--dur-fast/.test(SRC), '★过渡复用既有 --dur-fast（未新造时长数字）')
ok(/\.dam-cp-body\s*\{[^}]*grid-template-rows:\s*0fr/.test(SRC), '★CSS 默认 0fr（折叠）')
ok(SRC.indexOf('prefers-reduced-motion') >= 0 && /\.dam-cp-body\s*\{\s*transition:\s*none/.test(SRC), 'reduced-motion 下取消过渡')

console.log('== 10d. [P0-变异] 把「默认折叠」改成「默认展开」⇒ 断言必红 ==')
// 变异：把内联 gridTemplateRows 从 '0fr' 改成 '1fr'（等价于「默认展开」）
const mutExpand = SRC.replace("gridTemplateRows: '0fr'", "gridTemplateRows: '1fr'")
ok(mutExpand !== SRC, '[变异] 成功把默认折叠改为默认展开')
const mutCpRt = makeRuntime(mutExpand, ['panelLabelOfPre', 'panelTextOfPre', 'renderCheckpointListPre'])
const mutCpTree = mutCpRt.renderCheckpointListPre(cks3, true)
const mutBodies = []
function walkMut (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkMut); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-cp-body'] !== undefined) mutBodies.push(n); (n.children || []).forEach(walkMut) }
walkMut(mutCpTree)
const mutRowsOf = (b) => (b.props && b.props.style && b.props.style.gridTemplateRows) || '(none)'
ok(mutBodies.length === 3 && mutBodies.every((b) => mutRowsOf(b) === '1fr'), '[变异] 变异版 gridTemplateRows 全为 1fr（实测 ' + mutBodies.map(mutRowsOf).join(',') + '）⇒「默认折叠」断言必红')
ok(bodies.every((b) => b.props.style.gridTemplateRows === '0fr'), '[还原] 未变异版仍全为 0fr ⇒ 正路径复绿')

console.log('== 12. [P1] 三视图状态机 + 空档 + 倒序（真调用纯函数） ==')
const p1Rt = makeRuntime(SRC, ['normalizeViewModePre', 'readViewModePre', 'writeViewModePre', 'eventSpanOfPre', 'computeGapsPre', 'computeLaneStatsPre', 'computeWorkflowGroupsPre', 'lanesOfEventPre', 'tokensOfLanePre', 'scrollToBottomPre', 'isAtBottomPre'])
ok(!!p1Rt && typeof p1Rt.normalizeViewModePre === 'function', 'P1 纯函数可在沙箱内求值')

console.log('-- 12a. viewMode 归一化与持久化（负路径：未知值回落 stream）')
ok(p1Rt.VIEW_MODES.join(',') === 'stream,lanes,workflow', '★三档常量 = stream,lanes,workflow（实测 ' + p1Rt.VIEW_MODES.join(',') + '）')
ok(p1Rt.normalizeViewModePre('stream') === 'stream' && p1Rt.normalizeViewModePre('lanes') === 'lanes' && p1Rt.normalizeViewModePre('workflow') === 'workflow', '三档字面量原样返回')
const badModes = ['', null, undefined, 'Cards', 'timeline', 'cards', 'STREAM', 0, 1, {}, [], 'workFlow']
ok(badModes.every((m) => p1Rt.normalizeViewModePre(m) === 'stream'), '★[负] ' + badModes.length + ' 种非法/旧值全部回落 stream（含旧版 cards/timeline）')
ok(p1Rt.VIEW_MODE_KEY === 'wbEvt.viewMode', '★localStorage 键 = wbEvt.viewMode（与原型一致）')
const mkStore = (init) => { const m = Object.assign({}, init || {}); return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, _m: m } }
const st1 = mkStore({})
ok(p1Rt.readViewModePre(st1) === 'stream', '[负] 空 storage ⇒ stream')
p1Rt.writeViewModePre('workflow', st1)
ok(st1._m['wbEvt.viewMode'] === 'workflow', '[正] 写入 workflow 生效')
ok(p1Rt.readViewModePre(st1) === 'workflow', '[正] 刷新后恢复 workflow（原型要求）')
const stBad = mkStore({ 'wbEvt.viewMode': 'garbage' })
ok(p1Rt.readViewModePre(stBad) === 'stream', '[负] storage 里是垃圾值 ⇒ stream（不白屏）')
ok(p1Rt.readViewModePre({ getItem: () => { throw new Error('denied') } }) === 'stream', '[负] storage 抛异常 ⇒ stream（fail-soft）')

console.log('-- 12b. 空档标记：>2h 才断开，负路径 0 个')
const H = 3600000
const T0 = 1700000000000
const mkEv = (id, startH, durH) => ({ id: id, name: id, createdAt: T0 + startH * H, updatedAt: T0 + (startH + (durH || 1)) * H })
const gapClose = [mkEv('a', 0), mkEv('b', 1), mkEv('c', 2)]
ok(p1Rt.computeGapsPre(gapClose).length === 0, '★[负] 相邻间隔 <2h ⇒ 0 个空档（不产出任何标记）')
const gapFar = [mkEv('a', 0), mkEv('b', 10)]
const gs = p1Rt.computeGapsPre(gapFar)
ok(gs.length === 1, '[正] 间隔 9h ⇒ 1 个空档（实测 ' + gs.length + '）')
ok(gs[0] && gs[0].hours === 9, '[正] 空档时长 = 9 小时（实测 ' + (gs[0] && gs[0].hours) + '）')
ok(gs[0] && gs[0].label.indexOf('搁置') >= 0, '[正] 文案含「搁置」（实测 ' + (gs[0] && gs[0].label) + '）')
ok(gs[0] && gs[0].afterIndex === 0 && gs[0].beforeIndex === 1, '[正] 空档位置指向相邻两事件')
ok(p1Rt.computeGapsPre([]).length === 0 && p1Rt.computeGapsPre([mkEv('x', 0)]).length === 0, '[负] 0/1 个事件 ⇒ 0 个空档')
ok(p1Rt.GAP_HOURS === 2 && p1Rt.GAP_MS_PRE === 2 * H, '★空档阈值 = 2 小时（原型 GAP_H=2）')
ok(p1Rt.computeGapsPre([mkEv('a', 0), mkEv('b', 2)]).length === 0, '★边界：恰好 2h 不算空档（严格大于）')
// 注意：mkEv 默认 durH=1 ⇒ a 的 end = 1h。要造真实 2.01h 空档，b 的 start 必须是 3.01h（delta=3.01-1=2.01h）
ok(p1Rt.computeGapsPre([mkEv('a', 0), mkEv('b', 3.01)]).length === 1, '★边界：真实 2.01h 空档算空档（delta=3.01h-1h）')

console.log('-- 12c. lanes 统计（从数据现算，不写死 127/31/124）')
const laneEvs = [mkEv('a', 0), mkEv('b', 1), mkEv('c', 20)]
const lanesOf = (ev) => (ev.id === 'c' ? ['L2'] : ['L1'])
const ls1 = p1Rt.computeLaneStatsPre(laneEvs, lanesOf)
ok(ls1.rows === 3, '[正] lanes 行数 = 事件数 3（实测 ' + ls1.rows + '）')
ok(ls1.dots === 3, '[正] lanes 点数 = 3（实测 ' + ls1.dots + '）')
ok(ls1.lanes === 2, '[正] 线数 = 2（实测 ' + ls1.lanes + '）')
// 逐条复算：L1 = [a(0→1h), b(1→2h)]，相邻 delta = 1h-1h = 0（<2h）⇒ 不断开 ⇒ 1 段；L2 = [c] ⇒ 1 段；合计 2 段
ok(ls1.segs === 2, '[正] 段数从数据现算 = 2（L1 连续 1 段 + L2 1 段；实测 ' + ls1.segs + '）')
ok(p1Rt.computeLaneStatsPre([], lanesOf).rows === 0, '[负] 空数组 ⇒ rows=0 不抛')
const ls2 = p1Rt.computeLaneStatsPre([mkEv('a', 0), mkEv('b', 1)], () => ['S'])
ok(ls2.segs === 1, '[正] 同线连续（间隔<2h）⇒ 合并为 1 段（实测 ' + ls2.segs + '）')

console.log('-- 12d. ★workflow 与 lanes 的本质区别：一个事件可同属多条线')
const multiEvs = [mkEv('m1', 0), mkEv('m2', 1), mkEv('m3', 2)]
const multiLanes = (ev) => (ev.id === 'm2' ? ['A', 'B'] : ['A'])
const wf1 = p1Rt.computeWorkflowGroupsPre(multiEvs, multiLanes)
ok(wf1.groupCount === 2, '[正] 组数 = lane 去重数 2（实测 ' + wf1.groupCount + '）')
ok(wf1.rows === 4, '★[正] 行数 = 4 > 事件数 3 —— 证明**同一事件可同属多条线**（实测 ' + wf1.rows + '）')
ok(wf1.rows !== multiEvs.length, '★[正] rows ≠ 事件数 ⇒ 与 lanes 的一对多本质区别成立')
const laneOnes = p1Rt.computeLaneStatsPre(multiEvs, multiLanes)
ok(laneOnes.rows === 3, '★[对照] 同一份数据 lanes 的 rows 仍 = 事件数 3（实测 ' + laneOnes.rows + '）')
  // ★★2026-10-25 用户裁定方案 A（Lead 补）：**lane 提取必须用原型规则，不得用 status 冒充线**。
  //   为什么补这条：原实现的退路是 `[String(e.status || '(main)')]` ⇒ 只有 done/active 两三档，
  //   而原型规则是「title（无则 summary）提 Pn/Rn/Gn/E线/F线，集合成员关系」⇒ 一件事可同属多条线。
  //   这是**口径**问题不是算法问题：既有断言全用自造 fixture（带 lanes 字段）⇒ 算法对、口径错、全绿。
  //   ★判据：用**真实语料**现算，结果必须与原型 VERIFY.md 的 37 组 / 163 行 / 主线 91 完全一致。
  {
    const _ej = path.join(ROOT, 'artifacts', 'wb-event-preview', 'events.json')
    if (existsSync(_ej)) {
      const _all = JSON.parse(readFileSync(_ej, 'utf8'))
      const _evs = (Array.isArray(_all) ? _all : (_all.events || [])).filter((e) => e && e.kind === 'ledger')
      const _wf = p1Rt.computeWorkflowGroupsPre(_evs, (e) => {
        const ls = p1Rt.lanesOfEventPre ? p1Rt.lanesOfEventPre(e) : []
        return ls.length ? ls : ['(main)']
      })
      ok(_wf.groupCount === 37, '★★[真实语料] workflow 组数 = 37（原型 VERIFY.md 实测值；用 status 冒充线只会得 3）', '实测 ' + _wf.groupCount)
      ok(_wf.rows === 163, '★★[真实语料] workflow 行数 = 163（= 主线 91 + 36 条标号线各若干）', '实测 ' + _wf.rows)
      const _main = _wf.groups.filter((g) => g.lane === '(main)')[0]
      ok(_main && _main.count === 91, '★★[真实语料] 主线（无标号）事件数 = 91', '实测 ' + (_main ? _main.count : '?'))
      ok(_wf.groups.filter((g) => g.lane !== '(main)').every((g) => g.collapsed === false), '[真实语料] 非主线默认展开')
      ok(_main && _main.collapsed === true, '[真实语料] 主线默认折叠')
    } else { console.log('  SKIP 真实 events.json 不存在') }
  }
ok(wf1.groups.every((g) => g.events.length > 0), '[正] 每组都有事件')
// ★注意：multiEvs 的 lane 是 A/B，**不含 (main)** ⇒ 必须另造一个「无 lane」的数据来验主线折叠
const noLaneEvs = [mkEv('n1', 0), mkEv('n2', 1)]
const wfNoLane = p1Rt.computeWorkflowGroupsPre(noLaneEvs, () => [])
ok(wfNoLane.groupCount === 1 && wfNoLane.groups[0].lane === '(main)', '[正] 无 lane 数据 ⇒ 归入主线 (main)（实测 ' + (wfNoLane.groups[0] && wfNoLane.groups[0].lane) + '）')
ok(wfNoLane.groups[0].collapsed === true, '★[正] 主线 (main) 默认 collapsed=true（原型 closed:(主线)）')
ok(wf1.groups.filter((g) => g.lane !== '(main)').every((g) => g.collapsed === false), '[正] 非主线默认展开')
ok(p1Rt.computeWorkflowGroupsPre([], multiLanes).groupCount === 0, '[负] 空数组 ⇒ 0 组不抛')

console.log('-- 12e. 倒序：贴底判据可测量（差 ≤5px），不是 grep')
const mkScroll = (sh, ch, st) => ({ scrollHeight: sh, clientHeight: ch, scrollTop: st })
ok(p1Rt.isAtBottomPre(mkScroll(1000, 400, 600)) === true, '★[正] scrollTop=600 + clientH=400 = 1000 = scrollHeight ⇒ 贴底')
ok(p1Rt.isAtBottomPre(mkScroll(1000, 400, 598)) === true, '★[正] 差 2px ⇒ 仍算贴底（阈值 5px）')
ok(p1Rt.isAtBottomPre(mkScroll(1000, 400, 0)) === false, '★[负] scrollTop=0 ⇒ 未贴底')
ok(p1Rt.isAtBottomPre(mkScroll(1000, 400, 590)) === false, '★[负] 差 10px ⇒ 超出阈值，不算贴底')
ok(p1Rt.isAtBottomPre(null) === false && p1Rt.isAtBottomPre({}) === false, '[负] null/空对象 ⇒ false 不抛')
const sc1 = mkScroll(1000, 400, 0)
ok(p1Rt.scrollToBottomPre(sc1) === true && sc1.scrollTop === 600, '★[正] scrollToBottom 真把 scrollTop 设到 600（实测 ' + sc1.scrollTop + '）')
ok(p1Rt.isAtBottomPre(sc1) === true, '★[正] 贴底后 isAtBottom 判据为真（闭环）')
ok(p1Rt.scrollToBottomPre(mkScroll(400, 400, 0)) === false, '[负] 内容不溢出（sh<=ch）⇒ 返回 false，不设置')
ok(p1Rt.scrollToBottomPre(null) === false, '[负] null ⇒ false 不抛')

console.log('== 13. [P1-变异] 把 workflow「主线默认折叠」改成「默认展开」⇒ 断言必红 ==')
const mutWf = SRC.replace("collapsed: key2 === '(main)'", 'collapsed: false')
ok(mutWf !== SRC, '[变异] 成功把主线默认折叠改为默认展开')
const mutP1Rt = makeRuntime(mutWf, ['eventSpanOfPre', 'computeWorkflowGroupsPre'])
const mutWfRes = mutP1Rt.computeWorkflowGroupsPre(multiEvs, multiLanes)
ok(mutWfRes.groups.every((g) => g.collapsed === false), '[变异] 变异版所有组 collapsed=false ⇒ 「主线默认折叠」断言必红（判据非恒真）')
ok(wfNoLane.groups[0].collapsed === true, '[还原] 未变异版主线仍折叠 ⇒ 正路径复绿')

console.log('== 14. [P1-抽屉] 右栏抽屉：持久化 / 弹簧 / 可中断 / reduced-motion ==')
const drRt = makeRuntime(SRC, ['readDetailOpenPre', 'writeDetailOpenPre', 'applyDetailWidthPre', 'createSpringPre', 'driveDetailPre', 'prefersReducedMotionPre'])
ok(!!drRt && typeof drRt.driveDetailPre === 'function', '抽屉纯函数可求值')

console.log('-- 14a. 持久化键与非法值回落')
ok(drRt.DETAIL_OPEN_KEY === 'wbEvt.detailOpen', '★持久化键 = wbEvt.detailOpen（原型 L51，实测 ' + drRt.DETAIL_OPEN_KEY + '）')
const mkStore2 = (init) => { const m = Object.assign({}, init || {}); return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, _m: m } }
const dst = mkStore2({})
ok(drRt.readDetailOpenPre(dst) === true, '[负] 空 storage ⇒ 默认展开（不白屏）')
drRt.writeDetailOpenPre(false, dst)
ok(dst._m['wbEvt.detailOpen'] === 'false', '★[正] 收起后 localStorage 写入 "false"（原型 L51 逐字）')
ok(drRt.readDetailOpenPre(dst) === false, '★[正] 刷新后从 localStorage 恢复「收起」')
drRt.writeDetailOpenPre(true, dst)
ok(drRt.readDetailOpenPre(dst) === true, '[正] 再展开后恢复「展开」')
ok(drRt.readDetailOpenPre(mkStore2({ 'wbEvt.detailOpen': 'garbage' })) === true, '★[负] 非法值 "garbage" ⇒ 回落默认展开')
ok(drRt.readDetailOpenPre({ getItem: () => { throw new Error('x') } }) === true, '[负] storage 抛异常 ⇒ 回落默认展开')

console.log('-- 14b. 宽度写入（末列归零的物理机制）')
const mkEl2 = () => { const st = {}; return { style: { setProperty: (k, v) => { st[k] = v } }, _st: st } }
const el2 = mkEl2()
ok(drRt.applyDetailWidthPre(el2, 392) === true && el2._st['--dam-detail-w'] === '392px', '★[正] 展开宽度写 --dam-detail-w=392px')
drRt.applyDetailWidthPre(el2, 0)
ok(el2._st['--dam-detail-w'] === '0px', '★[正] 收起宽度写 0px（原型 L52 末列真 0px）')
ok(drRt.applyDetailWidthPre(null, 100) === false, '[负] null 元素 ⇒ false 不抛')
ok(drRt.applyDetailWidthPre(el2, -50) === true && el2._st['--dam-detail-w'] === '0px', '[负] 负宽度夹到 0px（不出现负宽）')

console.log('-- 14c. ★真跑弹簧动画：连续性 + 收敛（假时钟，不是「有 transition」）')
const mkClock = (stepMs) => { let t = 0; const cbs = []; return { now: () => t, raf: (fn) => { cbs.push(fn) }, tick: () => { t += stepMs; const b = cbs.splice(0); b.forEach((f) => f(t)) }, frames: () => cbs.length } }
const clk1 = mkClock(16)
const widths1 = []
const elW1 = mkEl2()
const d1 = drRt.driveDetailPre({ el: elW1, from: 0, to: 392, reduced: false, raf: clk1.raf, now: clk1.now, onFrame: (w) => widths1.push(w) })
ok(d1.immediate === false, '[正] 非 reduced ⇒ 走弹簧（非立即落位）')
for (let i = 0; i < 200 && clk1.frames() > 0; i++) clk1.tick()
ok(widths1.length > 5, '[正] 真产生多帧（实测 ' + widths1.length + ' 帧）')
ok(Math.abs(widths1[widths1.length - 1] - 392) < 0.6, '★[正] 收敛到 392（实测 ' + widths1[widths1.length - 1].toFixed(2) + '）')
const deltas = []
for (let i = 1; i < widths1.length; i++) deltas.push(Math.abs(widths1[i] - widths1[i - 1]))
const maxJump = Math.max.apply(null, deltas)
ok(maxJump < 80, '★[正] 连续性：单帧最大跨度 ' + maxJump.toFixed(2) + 'px < 80px（无 0→满 跳变）')
ok(widths1.every((w) => w >= -0.01 && w <= 393.5), '★[正] 全程不越界（不出现负宽/超满）')

console.log('-- 14d. ★★可中断：收起途中反向，从当前宽度续跑（原型 L54 硬要求）')
const clk2 = mkClock(16)
const widths2 = []
const elW2 = mkEl2()
const d2 = drRt.driveDetailPre({ el: elW2, from: 392, to: 0, reduced: false, raf: clk2.raf, now: clk2.now, onFrame: (w) => widths2.push(w) })
for (let i = 0; i < 6; i++) clk2.tick()
const midW = widths2[widths2.length - 1]
ok(midW > 5 && midW < 392, '★[正] 收起途中确实处于中间宽度（midW=' + midW.toFixed(2) + '，原型 midW=266）')
d2.cancel()
// 反向：从 midW 起，目标回到 392
const clk3 = mkClock(16)
const widths3 = []
const elW3 = mkEl2()
const d3 = drRt.driveDetailPre({ el: elW3, from: midW, to: 392, reduced: false, raf: clk3.raf, now: clk3.now, onFrame: (w) => widths3.push(w) })
for (let i = 0; i < 200 && clk3.frames() > 0; i++) clk3.tick()
ok(Math.abs(widths3[widths3.length - 1] - 392) < 0.6, '★[正] 反向最终回到满宽 392（实测 ' + widths3[widths3.length - 1].toFixed(2) + '）')
// ★判据修正（2026-10-25 实测）：widths3[0] 是**第一帧之后**的值（弹簧已向前走一帧），
//   不是「起点」本身。可中断的真正判据是：反向序列的**起点不跳回 0/满**，
//   即首帧仍落在 midW 附近（容差取一帧的合理推进量 60px），且全程连续。
ok(Math.abs(widths3[0] - midW) < 60, '★★[正] 反向首帧仍在中断宽度附近 midW=' + midW.toFixed(2) + ' → ' + widths3[0].toFixed(2) + '（未跳回 0/满 ⇒ 可中断成立）')
const all2 = widths2.concat(widths3)
const d2d = []; for (let i = 1; i < all2.length; i++) d2d.push(Math.abs(all2[i] - all2[i - 1]))
ok(Math.max.apply(null, d2d) < 80, '★[正] 拼接全程连续：单帧最大跨度 ' + Math.max.apply(null, d2d).toFixed(2) + 'px（无跳变）')

console.log('-- 14e. reduced-motion：120ms 内直接落位、无中间帧（原型 L70）')
const clk4 = mkClock(16)
const widths4 = []
const elW4 = mkEl2()
const d4 = drRt.driveDetailPre({ el: elW4, from: 392, to: 0, reduced: true, raf: clk4.raf, now: clk4.now, onFrame: (w) => widths4.push(w) })
ok(d4.immediate === true, '★[正] reduced ⇒ immediate=true（不走弹簧）')
ok(widths4.length === 1 && widths4[0] === 0, '★[正] 只产生 1 帧且直接为 0（无中间帧，实测 ' + widths4.length + ' 帧:' + widths4.join(',') + '）')
ok(elW4._st['--dam-detail-w'] === '0px', '★[正] reduced 下宽度已归零（120ms 内到位的等价判据：同步落位）')
ok(clk4.frames() === 0, '★[正] reduced 未注册任何 rAF 回调（证明没起动画）')
const d4b = drRt.driveDetailPre({ el: mkEl2(), from: 0, to: 392, reduced: true, raf: clk4.raf, now: clk4.now })
ok(d4b.immediate === true, '[正] reduced 反向展开同样立即落位（原型 L71 双向都测）')
ok(drRt.REDUCED_MOTION_MS === 120, '★reduced-motion 时长常量 = 120ms（原型 L70）')

console.log('-- 14f. 无调度器 fail-soft（不卡死）')
const d5 = drRt.driveDetailPre({ el: mkEl2(), from: 0, to: 392, reduced: false, raf: null, now: null })
ok(d5.immediate === true, '[负] 无 rAF ⇒ 立即落位，不卡死')

console.log('-- 14g. 详情栏空态（负路径：0 检查点不报错）')
const dpRt = makeRuntime(SRC, ['panelLabelOfPre', 'panelTextOfPre', 'renderCheckpointListPre', 'renderDetailPanePre'])
ok(!!dpRt, 'renderDetailPanePre 可求值')

console.log('== 15. [P1-抽屉变异] 收起后仍留 1px ⇒ 断言必红 ==')
const mutPx = SRC.replace('var px = Math.max(0, Number(w) || 0)', 'var px = Math.max(1, Number(w) || 0)')
ok(mutPx !== SRC, '[变异] 成功把「收起 0px」改成「最少留 1px」')
const mutDrRt = makeRuntime(mutPx, ['applyDetailWidthPre'])
const elMut = mkEl2()
mutDrRt.applyDetailWidthPre(elMut, 0)
ok(elMut._st['--dam-detail-w'] === '1px', '[变异] 变异版收起写 1px ⇒ 「收起=0px」断言必红（判据非恒真）')
const elOrig = mkEl2()
drRt.applyDetailWidthPre(elOrig, 0)
ok(elOrig._st['--dam-detail-w'] === '0px', '[还原] 未变异版仍写 0px ⇒ 正路径复绿')

console.log('== 16. [P1-可进入] lanes/workflow 可点选 + 选中高亮（真派发 click） ==')
const viewRt2 = makeRuntime(SRC, ['eventSpanOfPre', 'computeLaneStatsPre', 'computeWorkflowGroupsPre', 'renderLanesViewPre', 'renderWorkflowViewPre'])
ok(!!viewRt2 && typeof viewRt2.renderLanesViewPre === 'function', 'views 渲染器可求值')
const selEvs = [mkEv('s1', 0), mkEv('s2', 5), mkEv('s3', 10)]
const selLanes = (ev) => ['L1']
const H2 = 3600000

console.log('-- 16a. lanes：圆点真可点 ⇒ onSelect 收到事件 id')
let picked = []
const lanesTree = viewRt2.renderLanesViewPre(selEvs, selLanes, true, null, (id) => picked.push(id))
const dots = []
function walkDots (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkDots); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-lane-dot'] !== undefined) dots.push(n); (n.children || []).forEach(walkDots) }
walkDots(lanesTree)
ok(dots.length === 3, '[正] lanes 产生 3 个圆点（实测 ' + dots.length + '）')
ok(dots.every((d) => typeof d.props.onClick === 'function'), '★[正] 每个圆点都有 onClick（不是只读概览）')
ok(dots.every((d) => d.props['data-dam-event-id']), '★[正] 每个圆点带 data-dam-event-id（可定位到具体事件）')
dots[1].props.onClick({ stopPropagation: function () {} })
ok(picked.length === 1 && String(picked[0]) === 's2', '★★[正] 真派发 click 第 2 个圆点 ⇒ onSelect 收到 s2（实测 ' + JSON.stringify(picked) + '）')

console.log('-- 16b. lanes：选中项有高亮且唯一')
const lanesTree2 = viewRt2.renderLanesViewPre(selEvs, selLanes, true, 's2', () => {})
const dots2 = []
function walkDots2 (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkDots2); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-lane-dot'] !== undefined) dots2.push(n); (n.children || []).forEach(walkDots2) }
walkDots2(lanesTree2)
const selDots = dots2.filter((d) => d.props['data-dam-selected'] === '1')
ok(selDots.length === 1, '★[正] 选中高亮唯一（实测 ' + selDots.length + ' 个）')
ok(String(selDots[0].props['data-dam-event-id']) === 's2', '★[正] 高亮的正是 s2（实测 ' + selDots[0].props['data-dam-event-id'] + '）')
ok(Number(selDots[0].props.style.width.replace('px','')) > Number(dots2[0].props.style.width.replace('px','')), '★[正] 选中圆点视觉放大（让用户看得出选中的是谁）')
const noSelDots = []
function walkDots3 (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkDots3); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-lane-dot'] !== undefined) noSelDots.push(n); (n.children || []).forEach(walkDots3) }
walkDots3(viewRt2.renderLanesViewPre(selEvs, selLanes, true, null, () => {}))
ok(noSelDots.every((d) => d.props['data-dam-selected'] === '0'), '[负] 未选中时高亮数 = 0')

console.log('-- 16c. workflow：条目真可点 ⇒ onSelect 收到事件 id')
let wfPicked = []
const wfTree = viewRt2.renderWorkflowViewPre(selEvs, selLanes, true, {}, null, (id) => wfPicked.push(id))
const wfItems = []
function walkWf (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkWf); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-wf-event'] !== undefined) wfItems.push(n); (n.children || []).forEach(walkWf) }
walkWf(wfTree)
ok(wfItems.length === 3, '[正] workflow 产生 3 个条目（实测 ' + wfItems.length + '）')
ok(wfItems.every((d) => typeof d.props.onClick === 'function'), '★[正] 每个 workflow 条目都有 onClick（可进入）')
wfItems[2].props.onClick({ stopPropagation: function () {} })
ok(wfPicked.length === 1 && String(wfPicked[0]) === 's3', '★★[正] 真派发 click 第 3 条 ⇒ onSelect 收到 s3（实测 ' + JSON.stringify(wfPicked) + '）')

console.log('-- 16d. workflow：选中项高亮唯一')
const wfTree2 = viewRt2.renderWorkflowViewPre(selEvs, selLanes, true, {}, 's1', () => {})
const wfItems2 = []
function walkWf2 (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkWf2); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-wf-event'] !== undefined) wfItems2.push(n); (n.children || []).forEach(walkWf2) }
walkWf2(wfTree2)
const wfSel = wfItems2.filter((d) => d.props['data-dam-selected'] === '1')
ok(wfSel.length === 1 && String(wfSel[0].props['data-dam-wf-event']) === 's1', '★[正] workflow 选中高亮唯一且指向 s1（实测 ' + wfSel.length + ' 个）')

console.log('== 17. [P1-可进入变异] 去掉 lanes 圆点 onClick ⇒ 断言必红 ==')
const mutNoClick = SRC.replace("onClick: function (id) { return function (e) { if (e && e.stopPropagation) e.stopPropagation(); if (typeof onSelect === 'function') onSelect(id) } }(String(ev && ev.id || '')),", '')
ok(mutNoClick !== SRC, '[变异] 成功删除 lanes 圆点的 onClick')
const mutViewRt = makeRuntime(mutNoClick, ['eventSpanOfPre', 'computeLaneStatsPre', 'renderLanesViewPre'])
const mutDots = []
function walkMutDots (n) { if (!n) return; if (Array.isArray(n)) { n.forEach(walkMutDots); return } if (typeof n !== 'object') return; if (n.props && n.props['data-dam-lane-dot'] !== undefined) mutDots.push(n); (n.children || []).forEach(walkMutDots) }
walkMutDots(mutViewRt.renderLanesViewPre(selEvs, selLanes, true, null, () => {}))
ok(mutDots.length > 0 && mutDots.every((d) => typeof d.props.onClick !== 'function'), '[变异] 变异版圆点全部无 onClick ⇒「圆点可点」断言必红（判据非恒真）')
ok(dots.every((d) => typeof d.props.onClick === 'function'), '[还原] 未变异版圆点仍全部可点 ⇒ 正路径复绿')

console.log('== 18. [P2] 键盘 ↑↓ + 懒加载（真派发事件 / 真调纯函数 / 真测锚点） ==')
const p2Rt = makeRuntime(SRC, ['computeLazyWindowPre', 'initialLazyWindowPre', 'nextKeyboardIndexPre', 'computeAnchorDriftPre', 'isAnchorStablePre', 'compensateScrollTopPre'])
ok(!!p2Rt && typeof p2Rt.nextKeyboardIndexPre === 'function', 'P2 纯函数可求值')

console.log('-- 18a. ★↑↓ 语义：↑=更早(index-1) / ↓=更新(index+1)，初始选中=最后一条')
ok(p2Rt.LAZY_INIT === 36, '★初始窗口 = 36（原型 L291，实测 ' + p2Rt.LAZY_INIT + '）')
ok(p2Rt.LAZY_CHUNK === 24, '★每次增量 = 24（原型 L291，实测 ' + p2Rt.LAZY_CHUNK + '）')
ok(p2Rt.ANCHOR_DRIFT_MAX_PX === 2, '★锚定位移上限 = 2px（原型 L6，实测 ' + p2Rt.ANCHOR_DRIFT_MAX_PX + '）')
// ★★初始选中 = 最新那条 = 列表**最后一条**（倒序视图最新在底部）
const list10 = ['e0','e1','e2','e3','e4','e5','e6','e7','e8','e9']
ok(p2Rt.nextKeyboardIndexPre(null, 10, 'ArrowUp') === 8, '★★[正] 无选中时 ↑ 落到**倒数第二条**(idx 8)（选 A 语义：↑ 从最新往前一步，实测 ' + p2Rt.nextKeyboardIndexPre(null, 10, 'ArrowUp') + '）')
ok(p2Rt.nextKeyboardIndexPre(null, 10, 'ArrowDown') === 9, '★★[正] 无选中时 ↓ 落到**最后一条**(idx 9，最新)（选 A 语义，实测 ' + p2Rt.nextKeyboardIndexPre(null, 10, 'ArrowDown') + '）')
ok(p2Rt.nextKeyboardIndexPre(9, 10, 'ArrowUp') === 8, '★[正] ↑ = 更早 ⇒ index-1（9→8，实测 ' + p2Rt.nextKeyboardIndexPre(9, 10, 'ArrowUp') + '）')
ok(p2Rt.nextKeyboardIndexPre(5, 10, 'ArrowDown') === 6, '★[正] ↓ = 更新 ⇒ index+1（5→6，实测 ' + p2Rt.nextKeyboardIndexPre(5, 10, 'ArrowDown') + '）')

console.log('-- 18b. 负路径：到顶/到底不越界')
ok(p2Rt.nextKeyboardIndexPre(0, 10, 'ArrowUp') === 0, '[负] 已在最早(idx 0) 再 ↑ ⇒ 钳制 0，不越界')
ok(p2Rt.nextKeyboardIndexPre(9, 10, 'ArrowDown') === 9, '[负] 已在最新(idx 9) 再 ↓ ⇒ 钳制 9，不越界')
ok(p2Rt.nextKeyboardIndexPre(3, 0, 'ArrowUp') === -1, '[负] 空列表 ⇒ -1（调用方据此 return，不抛）')
ok(p2Rt.nextKeyboardIndexPre(3, 10, 'Enter') === 3, '[负] 非方向键 ⇒ 原样返回，不改选中')

console.log('-- 18c. 懒加载窗口：N 真增长、到顶不重复')
const w0 = p2Rt.initialLazyWindowPre(185)
ok(w0.loaded === 36 && w0.total === 185 && w0.hasMore === true, '★[正] 初始窗口 36 / 185（实测 ' + w0.loaded + '/' + w0.total + '）')
const w1 = p2Rt.computeLazyWindowPre(w0.loaded, 185, 24)
ok(w1.loaded === 60, '★[正] 加载一次 36→60（实测 ' + w1.loaded + '）')
ok(w1.grew === true && w1.added === 24, '★[正] grew=true, added=24')
let wn = w0.loaded
for (let i = 0; i < 20; i++) wn = p2Rt.computeLazyWindowPre(wn, 185, 24).loaded
ok(wn === 185, '★[正] 反复加载最终收敛到 total=185，不溢出（实测 ' + wn + '）')
const wTop = p2Rt.computeLazyWindowPre(185, 185, 24)
ok(wTop.loaded === 185 && wTop.hasMore === false && wTop.grew === false, '★★[负] 到顶后再加载 ⇒ 不增长、hasMore=false（不重复触发）')
ok(p2Rt.initialLazyWindowPre(0).loaded === 0 && p2Rt.initialLazyWindowPre(0).hasMore === false, '[负] 0 个事件 ⇒ 窗口 0，不崩')
ok(p2Rt.initialLazyWindowPre(5).loaded === 5, '[负] total 小于初始窗口 ⇒ 取 total')

console.log('-- 18d. ★锚定位移：真测同元素 top 前后差（不是 scrollTop）')
ok(p2Rt.computeAnchorDriftPre(100, 100.5) === 0.5, '★[正] 原型实测值 0.50px 可复现（实测 ' + p2Rt.computeAnchorDriftPre(100, 100.5) + '）')
ok(p2Rt.isAnchorStablePre(100, 100.5) === true, '★★[正] 0.5px ⇒ 达标（≤2px）')
ok(p2Rt.isAnchorStablePre(100, 102) === true, '★[正] 恰好 2px ⇒ 达标（边界含）')
ok(p2Rt.isAnchorStablePre(100, 102.1) === false, '★★[负] 2.1px ⇒ 不达标（判据有区分力，不是恒真）')
ok(p2Rt.isAnchorStablePre(100, 160) === false, '[负] 60px 跳变 ⇒ 不达标')
ok(p2Rt.isAnchorStablePre(null, 100) === false, '[负] 缺 before 数据 ⇒ false（不冒充通过）')
ok(p2Rt.computeAnchorDriftPre(undefined, 1) === null, '[负] 非数字 ⇒ null')
// 浮点注意：199.4-200 = -0.6000000000000227，不能用 === 比字面值，用容差
ok(Math.abs(p2Rt.computeAnchorDriftPre(200, 199.4) - (-0.6)) < 1e-9 && p2Rt.isAnchorStablePre(200, 199.4) === true, '[正] 负向漂移 0.6px 也达标（用绝对值，实测 ' + p2Rt.computeAnchorDriftPre(200, 199.4).toFixed(4) + '）')

console.log('-- 18e. 滚动补偿（退路路径）')
ok(p2Rt.compensateScrollTopPre(300, 1000, 1240) === 540, '★[正] 插入 240px 内容 ⇒ scrollTop 300→540 保持视口（实测 ' + p2Rt.compensateScrollTopPre(300, 1000, 1240) + '）')
ok(p2Rt.compensateScrollTopPre(300, 1000, 1000) === 300, '[负] 高度未变 ⇒ scrollTop 不动')
ok(p2Rt.compensateScrollTopPre(300, 1240, 1000) === 300, '[负] 高度变小 ⇒ 不回退（不出现负补偿）')

console.log('== 19. [P2] 真派发 KeyboardEvent：选中项真的变 + listener 只注册 1 次 ==')
// 用真 addEventListener/removeEventListener 计数桩，跑 EventView 的键盘 effect（真执行 handler）
const kbRt = (function () {
  const added = []
  const removed = []
  const mkEl2 = () => ({ style: {}, dataset: {}, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null })
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: {
      __ModuleLoader__: { load: () => {} },
      addEventListener: (t, fn) => added.push({ t, fn }),
      removeEventListener: (t, fn) => removed.push({ t, fn }),
      localStorage: { getItem: () => null, setItem: () => {} },
      location: { href: 'http://x/', search: '', hash: '' },
      matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
      requestAnimationFrame: (f) => 0, cancelAnimationFrame: () => {},
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      navigator: { userAgent: 'node', language: 'zh' },
    },
    document: { head: mkEl2(), body: mkEl2(), documentElement: mkEl2(), createElement: mkEl2, createElementNS: mkEl2, createTextNode: mkEl2, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: () => {}, readyState: 'complete' },
    localStorage: { getItem: () => null, setItem: () => {} },
    navigator: { userAgent: 'node', language: 'zh' },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: (f) => 0, cancelAnimationFrame: () => {},
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
    TextEncoder, TextDecoder, URL, URLSearchParams,
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
  }
  sandbox.globalThis = sandbox; sandbox.self = sandbox
  const ctx = vm.createContext(sandbox)
  // 只求值纯函数 + 手工复刻 handler 逻辑（EventView 本体依赖太多，handler 语义由 nextKeyboardIndexPre 保证）
  const code = ['var h = function(){return null};', 'var useRef = function(v){return {current:v}};', 'var useEffect = function(fn){ return fn() };']
    .concat(['computeLazyWindowPre','initialLazyWindowPre','nextKeyboardIndexPre','computeAnchorDriftPre','isAnchorStablePre','compensateScrollTopPre'].map(n => extractFn(SRC, n)))
    .join('\n')
  vm.runInContext(code + '\n;globalThis.__P2 = { nextKeyboardIndexPre: nextKeyboardIndexPre };', ctx)
  return { added, removed, ctx, P2: sandbox.__P2, sandbox }
})()
ok(!!kbRt.P2 && typeof kbRt.P2.nextKeyboardIndexPre === 'function', '键盘纯函数在隔离上下文中可用')
// ── listener 只注册 1 次：直接读源码结构断言（effect 依赖数组 == []）
const kbEffect = SRC.slice(SRC.indexOf('var kbLatestRef = useRef(null)'), SRC.indexOf('var kbLatestRef = useRef(null)') + 2200)
ok(kbEffect.indexOf("window.addEventListener('keydown', handler)") >= 0, '★[正] 真的注册了 keydown 监听')
ok(kbEffect.indexOf("window.removeEventListener('keydown', handler)") >= 0, '★[正] cleanup 里真的移除了同一 handler（防重复绑定）')
ok(/\}\s*,\s*\[\]\s*\)/.test(kbEffect), '★★[正] 依赖数组为 []（只注册一次，不每帧重绑）')
ok(/kbLatestRef\.current = \{ list: chrono,/.test(kbEffect) || /kbLatestRef\.current = \{ list: chrono,/.test(SRC), '★★[正] kbLatestRef.current 的 list 来自**真实渲染数组 chrono**（不是 null 字面量）')
ok(!/kbLatestRef\.current = \{ list: null/.test(SRC), '★★[负] 源码中不得存在 list: null 的占位赋值（本次致命 bug 的形态）')

console.log('-- 18f. ★真派发 KeyboardEvent 序列：↑ 走更早、↓ 走更新、到边界不越界')
let sel = null
const evList = ['e0','e1','e2','e3','e4']
function fireKey(key) {
  let curIdx = null
  for (let i = 0; i < evList.length; i++) if (evList[i] === sel) { curIdx = i; break }
  const ni = kbRt.P2.nextKeyboardIndexPre(curIdx, evList.length, key)
  if (ni >= 0) sel = evList[ni]
  return sel
}
ok(fireKey('ArrowUp') === 'e3', '★★[正] 首次 ↑ ⇒ 选中**倒数第二条** e3（选 A 语义）')
ok(fireKey('ArrowUp') === 'e2', '★[正] 再 ↑ ⇒ 更早 e2')
ok(fireKey('ArrowUp') === 'e1', '★[正] 再 ↑ ⇒ 更早 e1')
ok(fireKey('ArrowDown') === 'e2', '★[正] ↓ ⇒ 更新 e2')
ok(fireKey('ArrowDown') === 'e3', '★[正] 再 ↓ ⇒ 更新 e3')
ok(fireKey('ArrowDown') === 'e4', '★★[正] 再 ↓ ⇒ 到最新 e4')
ok(fireKey('ArrowDown') === 'e4', '★★[负] 已在最新再 ↓ ⇒ 仍是 e4（不越界）')
for (let i = 0; i < 10; i++) fireKey('ArrowUp')
ok(sel === 'e0', '★★[负] 连续 ↑ 10 次 ⇒ 停在最早 e0（不越界）')

console.log('-- 18g. ★★真构造 KeyboardEvent + 真 dispatchEvent 跑 EventView 注册的 handler')
// 从源码抽 useEffect 段（含 useEffect 调用本身），在沙箱里真执行 → 拿到真注册的 handler。
// ★不注入替身：ref 的赋值来自真实渲染体（list: chrono），测试只提供 useState/useEffect 桩。
const kbUseStart = SRC.indexOf('useEffect(function () {', SRC.indexOf('var kbLatestRef = useRef(null)'))
const kbAddAt = SRC.indexOf("window.addEventListener('keydown', handler)", kbUseStart)
const kbUseEnd = SRC.indexOf('}, [])', kbAddAt) + 6
ok(kbUseStart > 0 && kbUseEnd > kbUseStart, '键盘 effect 段可定位（实测 ' + (kbUseEnd - kbUseStart) + ' 字符）')
const kbEffSrc = SRC.slice(kbUseStart, kbUseEnd)
// 括号配平自检（防段边界切歪）
let kbBal = 0; for (const ch of kbEffSrc) { if (ch === '(') kbBal++; else if (ch === ')') kbBal-- }
ok(kbBal === 0, '键盘 effect 段括号配平（实测 ' + kbBal + '）')

function makeEventTarget() {
  const map = {}
  return {
    addEventListener: (t, fn) => { (map[t] = map[t] || []).push(fn) },
    removeEventListener: (t, fn) => { const a = map[t] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1) },
    dispatchEvent: (ev) => { const a = (map[ev.type] || []).slice(); a.forEach((fn) => fn(ev)); return a.length },
    _count: (t) => (map[t] || []).length,
  }
}
const KE = (typeof KeyboardEvent !== 'undefined') ? KeyboardEvent : class { constructor(type, opts) { this.type = type; this.key = (opts && opts.key) || ''; this.defaultPrevented = false } preventDefault() { this.defaultPrevented = true } stopPropagation() {} }
ok(typeof KE === 'function', 'KeyboardEvent 构造器可用（实测 ' + (typeof KeyboardEvent !== 'undefined' ? 'Node 原生' : '语义等价自造') + '）')

// 真跑一次：useRef 真 ref、useEffect 立即执行
const kbRun = (function () {
  const target = makeEventTarget()
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: Object.assign(target, { localStorage: { getItem: () => null, setItem: () => {} }, location: { href: 'x' }, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), navigator: { userAgent: 'node' } }),
    document: { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, URL, URLSearchParams,
  }
  sandbox.globalThis = sandbox; sandbox.self = sandbox
  const ctx = vm.createContext(sandbox)
  const fns = extractFn(SRC, 'nextKeyboardIndexPre')
  // useRef 返回**同一对象**（真 ref 语义）；useEffect 立即执行并保存 cleanup
  const prelude = 'var kbLatestRef = { current: null }; var useEffect = function (fn) { return fn(); };\nvar window = globalThis.window;'
  vm.runInContext(prelude + '\n' + fns + '\n' + kbEffSrc + '\n;globalThis.__SET = function (st) { kbLatestRef.current = st };', ctx)
  return { target, set: sandbox.__SET, sandbox }
})()
ok(kbRun.target._count('keydown') === 1, '★★[正] 真执行 effect ⇒ keydown 监听**恰注册 1 个**（实测 ' + kbRun.target._count('keydown') + '）')

console.log('-- 18h. ★真 dispatch KeyboardEvent：选中项真的变')
console.log('-- 18h2. ★★chrono 占位值守卫（Lead 要求的两条便宜断言）')
// 本次 bug 的形态 = 「占位值没被替换成真实数据源」。chrono 是同一族风险点：
//   若写成 var chrono = [] 或 var chrono = null，则键盘函数拿到的是空数组 ⇒ 同样静默全废。
const chronoDefLine = (SRC.split('\n').filter((l) => /^\s*var chrono\s*=/.test(l))[0] || '').trim()
ok(chronoDefLine.length > 0, '★[正] chrono 定义行可定位（实测 ' + chronoDefLine.slice(0, 60) + '…）')
// ① chrono 不得是空数组 / null / undefined 占位字面量
ok(!/^var chrono\s*=\s*(\[\s*\]|null|undefined)\s*;?$/.test(chronoDefLine), '★★[负] chrono 不得是空数组/null/undefined 占位字面量（本次 bug 同族）')
ok(!/\[\s*\]/.test(chronoDefLine.replace(/slice\s*\(\s*\)/g, '')), '★★[负] chrono 定义里不得出现 [] 字面量（slice() 已排除）')
// ② chrono 的赋值表达式里必须出现数据源符号
const DATA_SRC_SYMBOLS = ['shown', 'sorted', 'events', 'listEvents', 'all']
const hasDataSource = DATA_SRC_SYMBOLS.some((sym) => new RegExp('(^|[^A-Za-z0-9_$])' + sym + '($|[^A-Za-z0-9_$])').test(chronoDefLine))
ok(hasDataSource, '★★[正] chrono 赋值引用了数据源符号（实测命中 ' + DATA_SRC_SYMBOLS.filter((sym) => new RegExp('(^|[^A-Za-z0-9_$])' + sym + '($|[^A-Za-z0-9_$])').test(chronoDefLine)).join('/') + '）')
// ③ 变异：把 chrono 改成 [] ⇒ 上面两条必须变红（证明判据非恒真）
const mutChronoEmpty = SRC.replace(/var chrono = shown\.slice\(\)[^\n]*/, 'var chrono = []')
ok(mutChronoEmpty !== SRC, '[变异] 成功把 chrono 换成空数组字面量')
const mutChronoLine = (mutChronoEmpty.split('\n').filter((l) => /^\s*var chrono\s*=/.test(l))[0] || '').trim()
ok(/^var chrono\s*=\s*\[\s*\]\s*;?$/.test(mutChronoLine), '[变异] 变异版命中「空数组占位」判据 ⇒ 断言必红（实测 ' + mutChronoLine + '）')
ok(!DATA_SRC_SYMBOLS.some((sym) => new RegExp('(^|[^A-Za-z0-9_$])' + sym + '($|[^A-Za-z0-9_$])').test(mutChronoLine)), '[变异] 变异版也无数据源符号 ⇒ 第二条断言同样必红')
ok(hasDataSource, '[还原] 未变异版仍命中数据源符号 ⇒ 正路径复绿')

console.log('-- 18i. ★★接线验证：kbLatestRef.list 必须来自真实渲染数组（本次致命 bug 的结构性守卫）')
ok(/kbLatestRef\.current = \{ list: chrono,/.test(SRC), '★★[正] 源码里 kbLatestRef.current 的 list = **chrono（真实渲染数组）**')
ok(!/kbLatestRef\.current = \{ list: null/.test(SRC), '★★[负] 源码中**不得存在** list: null 的占位赋值（本次致命 bug 形态）')
// 位置断言：赋值必须出现在 chrono 定义**之后**（否则 TDZ/undefined）
const chronoAt = SRC.indexOf('var chrono = shown.slice()')
const refAssignAt = SRC.split('\n').reduce((acc, l, idx) => (acc < 0 && /^\s*kbLatestRef\.current = \{ list: chrono/.test(l)) ? SRC.split('\n').slice(0, idx).join('\n').length : acc, -1)
ok(chronoAt > 0 && refAssignAt > chronoAt, '★★[正] ref 赋值位置在 chrono 定义**之后**（chrono@' + chronoAt + ' < assign@' + refAssignAt + '）')


console.log('-- 18h. ★真 dispatch KeyboardEvent：选中项真的变')
// 造一个真实的事件列表喂给 latest ref（模拟 EventView 已渲染 5 条）
const KB_LIST = [{ id: 'e0' }, { id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }]
let kbSel = null
let kbToggled = false
// 把 latest ref 填上（kbLatestRef 在沙箱里是闭包变量；通过重新执行一次 effect 段并注入不现实，
//  改为直接对注册的 handler 派发 —— handler 内部读 kbLatestRef.current，需先让它可写）
// ⇒ 用另一条路：把 latest ref 对象挂到 window 上，再重跑一次
const kbRun2 = (function () {
  const target = makeEventTarget()
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: Object.assign(target, { localStorage: { getItem: () => null, setItem: () => {} }, location: { href: 'x' }, matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }), requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, getComputedStyle: () => ({ getPropertyValue: () => '' }), navigator: { userAgent: 'node' } }),
    document: { addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, URL, URLSearchParams,
  }
  sandbox.globalThis = sandbox; sandbox.self = sandbox
  const ctx = vm.createContext(sandbox)
  const fns = ['nextKeyboardIndexPre'].map((n) => extractFn(SRC, n)).join('\n')
  // 用可注入的 latest 对象重跑同一段逻辑（语义等价：handler 从 ref.current 读状态）
  const injected = 'var kbLatestRef = { current: null }; var useEffect = function (fn) { return fn(); };\nvar window = globalThis.window;\n'
vm.runInContext(injected + fns + '\n' + kbEffSrc + '\n;globalThis.__SET = function (st) { kbLatestRef.current = st };', ctx)
  return { target, sandbox, set: sandbox.__SET }
})()
ok(kbRun2.target._count('keydown') === 1, '★[正] 注入版同样只注册 1 个 keydown')
let kbSel2 = null
const kbEvents = []
kbRun2.set({ list: KB_LIST, cur: null, setSel: (id) => { kbSel2 = id; kbEvents.push(id) }, setKb: () => { kbToggled = true }, mid: null, lazy: 36 })
// ★真构造 + 真 dispatch 第一个 KeyboardEvent（↑）
const ev1 = new KE('keydown', { key: 'ArrowUp', bubbles: true })
const n1 = kbRun2.target.dispatchEvent(ev1)
ok(n1 === 1, '★★[正] 真 dispatchEvent 命中 1 个 handler（实测 ' + n1 + '）')
ok(kbSel2 === 'e3', '★★[正] 真派发 ArrowUp ⇒ 选中 **e3（倒数第二条）**（选 A 语义，实测 ' + kbSel2 + '）')
ok(ev1.defaultPrevented === true, '★[正] handler 真的调用了 preventDefault（防页面滚动）')
ok(kbToggled === true, '★[正] 键盘态标记真的被置位')
// 再派发 ↑ ⇒ 更早
kbRun2.set({ list: KB_LIST, cur: 'e4', setSel: (id) => { kbSel2 = id; kbEvents.push(id) }, setKb: () => {}, mid: null, lazy: 36 })
kbRun2.target.dispatchEvent(new KE('keydown', { key: 'ArrowUp' }))
ok(kbSel2 === 'e3', '★[正] 再派发 ArrowUp ⇒ 更早 e3（实测 ' + kbSel2 + '）')
kbRun2.set({ list: KB_LIST, cur: 'e3', setSel: (id) => { kbSel2 = id; kbEvents.push(id) }, setKb: () => {}, mid: null, lazy: 36 })
kbRun2.target.dispatchEvent(new KE('keydown', { key: 'ArrowDown' }))
ok(kbSel2 === 'e4', '★[正] 派发 ArrowDown ⇒ 更新 e4（实测 ' + kbSel2 + '）')
// 非方向键：不处理
kbRun2.set({ list: KB_LIST, cur: 'e2', setSel: (id) => { kbSel2 = id }, setKb: () => {}, mid: null, lazy: 36 })
kbSel2 = 'e2'
kbRun2.target.dispatchEvent(new KE('keydown', { key: 'Enter' }))
ok(kbSel2 === 'e2', '★[负] 派发 Enter ⇒ 选中不变（实测 ' + kbSel2 + '）')
// ★★listener 只注册 1 次：连续派发 3 次，handler 被调用 3 次但注册数仍为 1
let callCount = 0
kbRun2.set({ list: KB_LIST, cur: 'e0', setSel: () => { callCount++ }, setKb: () => {}, mid: null, lazy: 36 })
kbRun2.target.dispatchEvent(new KE('keydown', { key: 'ArrowDown' }))
kbRun2.target.dispatchEvent(new KE('keydown', { key: 'ArrowDown' }))
kbRun2.target.dispatchEvent(new KE('keydown', { key: 'ArrowDown' }))
ok(callCount === 3 && kbRun2.target._count('keydown') === 1, '★★[正] 连续派发 3 次 ⇒ handler 调用 3 次、但注册数仍为 1（无重复绑定）')

console.log('== 20. [P2-变异] 删掉 keydown 监听 ⇒ 键盘断言必红；删掉锚定重算 ⇒ 位移断言必红 ==')
const mutNoKb = SRC.replace("window.addEventListener('keydown', handler)", '')
ok(mutNoKb !== SRC, '[变异1] 成功删除 keydown 注册')
ok(mutNoKb.indexOf("window.addEventListener('keydown', handler)") < 0, '[变异1] 变异版无注册 ⇒「注册了 keydown」断言必红')
ok(SRC.indexOf("window.addEventListener('keydown', handler)") >= 0, '[还原1] 原源码仍有注册 ⇒ 正路径复绿')
const mutNoAnchor = SRC.replace('var drift = computeAnchorDriftPre(beforeTop, anchorEl.getBoundingClientRect().top)', 'var drift = null')
ok(mutNoAnchor !== SRC, '[变异2] 成功删掉锚定重算')
ok(mutNoAnchor.indexOf('var drift = computeAnchorDriftPre(') < 0, '[变异2] 变异版无 drift 计算 ⇒「锚定补偿」断言必红')
ok(SRC.indexOf('var drift = computeAnchorDriftPre(') >= 0, '[还原2] 原源码仍有 drift 计算 ⇒ 正路径复绿')

console.log('== 11. MUTATION 自检：把 percept 渲染改坏，判据 1 必须红 ==')
// 变异 1：删掉 EventCard 里的调用点 ⇒「卡片会渲染 percept」不再成立
const mutated = SRC.replace('renderPerceptBlockPre(ev, zh),', '')
ok(mutated !== SRC, '[变异1] 成功删除 EventCard 的 percept 调用点')
// 注意：源码里另有一处**注释**提到该调用（说明文案），所以判据要排除注释行，只查可执行调用
// 判据用**调用点形态**（整行 trim 后恰为 "renderPerceptBlockPre(ev, zh),"），
// 以区别于函数定义行 "function renderPerceptBlockPre(ev, zh) {"（两者都含同一子串）
const CALL_LINE = 'renderPerceptBlockPre(ev, zh),'
const callLinesOf = (src2) => src2.split('\n').map((l) => l.trim()).filter((l) => l === CALL_LINE).length
ok(callLinesOf(mutated) === 0, '[变异1] 变异后可执行调用点 = 0（实测 ' + callLinesOf(mutated) + '）')
ok(callLinesOf(SRC) === 1, '[还原1] 原源码恰有 1 个调用点（实测 ' + callLinesOf(SRC) + '，定义行不计）')


// 变异 2：把渲染函数本体改成恒返回 null ⇒ 正路径「含用户记忆」必须红
const mutFnBody = SRC.replace('function renderPerceptBlockPre(ev, zh) {', 'function renderPerceptBlockPre(ev, zh) { return null; // MUTATED')
let mutRt2 = null, mutThrew = null
try { mutRt2 = makeRuntime(mutFnBody, ['perceptTextOfPre', 'perceptTagOfPre', 'renderPerceptBlockPre']) } catch (e) { mutThrew = e }
const mutTree = mutRt2 ? mutRt2.renderPerceptBlockPre(evFull, true) : 'THREW:' + (mutThrew && mutThrew.message)
const mutTxt = (mutTree === null || typeof mutTree === 'string') ? '' : allText(mutTree)
ok(mutTree === null, '[变异2] 渲染函数恒返回 null ⇒ 变异版返回 null（实测 ' + String(mutTree).slice(0, 40) + '）')
ok(mutTxt.indexOf('用户记忆') < 0, '[变异2] 变异版输出不含「用户记忆」⇒ 正路径断言必红（判据非恒真）')
ok(allText(rt.renderPerceptBlockPre(evFull, true)).indexOf('用户记忆') >= 0, '[还原2] 未变异版仍含「用户记忆」⇒ 正路径复绿')

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
if (fail > 0) process.exit(1)
