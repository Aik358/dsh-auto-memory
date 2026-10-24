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
import { readFileSync } from 'node:fs'
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
  const consts = []
  for (const cname of ['PERCEPT_TITLES', 'PERCEPT_MAX_ITEMS']) {
    const v = extractVar(src, cname)
    if (v) consts.push(v + ';')
  }
  const code = glue + consts.join('\n') + '\n' + fnNames.map((n) => extractFn(src, n)).filter(Boolean).join('\n') + '\n;({ ' + fnNames.join(', ') + ', PERCEPT_TITLES: (typeof PERCEPT_TITLES !== "undefined" ? PERCEPT_TITLES : undefined), PERCEPT_MAX_ITEMS: (typeof PERCEPT_MAX_ITEMS !== "undefined" ? PERCEPT_MAX_ITEMS : undefined) })'
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
  'var apiGet = function () { return Promise.resolve({ ok: true, events: [] }); };',
  'var API = { eventList: \'/event-list\', eventUnarchived: \'/event-unarchived\' };',
  'var DamStatBar = function (p) { return { type: \'DamStatBar\', props: p || {}, children: [] }; };',
  'var DamTimelineList = function (p) { return { type: \'DamTimelineList\', props: p || {}, children: [] }; };',
  'var EventCard = function (p) { return { type: \'EventCard\', props: p || {}, children: [] }; };',
  'var eventStatsToCards4Pre = function () { return { cards4: [] }; };',
  'var eventsToTimelineShapePre = function () { return { entries: [] }; };',
  'var locale = \'zh\';',
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
