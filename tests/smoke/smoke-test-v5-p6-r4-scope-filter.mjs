/**
 * smoke-test-v5-p6-r4-scope-filter.mjs
 *
 * ★R4 验收（2026-10-27）：看板事件范围筛选（用户裁定 Q7）。
 *
 * 用户裁定原文：「看板适配（默认筛 active + 时间轴）是否需要保留『全部事件』入口
 *              → **建议保留（折叠而非删除）**」。
 *
 * 【为什么必须测「真执行」】**
 *   这是前端 vm 抽取类测试的典型坑：只断言「源码含 filterEventsByScopePre」= 恒真守卫。
 *   必须**真调用**函数并断言返回值。
 *
 * ★★#544（2026-11-04）——本文件曾长期误判通过，原因就写在这里，免得再犯：
 *   旧 C-2 / C-3 只断言「源码里存在 'data-dam-scope-btn': 'active' 这个字符串」。
 *   而该字符串当时位于 EventView 的「if (!ev4SrcDoc)」降级分支内，buildEv4IframeHtmlSafePre
 *   恒返回真串 ⇒ 该分支**结构不可达** ⇒ 按钮从未出现在产品里，套件却一直绿。
 *   ⇒ 现在新增 D 组：**真渲染 EventView**（vm 执行 factory，内存注入 __probeEventView，不落盘），
 *     在渲染树里数按钮并模拟点击；E 组用内存变异证明 D 组有区分力（去掉主路径那行必须变红）。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

let pass = 0, fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok   - ' + name + (extra ? ' :: ' + extra : '')) }
  else { fail++; console.log('  FAIL - ' + name + (extra ? ' :: ' + extra : '')) }
}

// ★#507（2026-11-02）：ROOT 由**本文件位置**派生，而不是写死维护者本机路径。
//   旧写法把 ROOT 写成维护者本机的绝对路径，在 CI（ubuntu）与任何非本机检出下都读不到文件，
//   套件因此必红 —— 而那不是产品缺陷，是测试不可移植。**不要改回 process.cwd()**：
//   run-smoke 的工作目录、开发者 shell 的 cwd 都不保证是仓库根。
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

// ── 从源码抽取三个纯函数，在沙箱里真执行（照抄本仓既有的 vm/MakeRuntime 手法）──
function extractFn(name) {
  const marker = 'function ' + name + '('
  const i = SRC.indexOf(marker)
  if (i < 0) return null
  let d = 0, started = false, end = i
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j]
    if (c === '{') { d++; started = true }
    else if (c === '}') { d--; if (started && d === 0) { end = j + 1; break } }
  }
  return SRC.slice(i, end)
}

const fnFilter = extractFn('filterEventsByScopePre')
const fnRead = extractFn('readEventScopePre')
const fnWrite = extractFn('writeEventScopePre')

ok(!!fnFilter, 'P-1 filterEventsByScopePre 存在')
ok(!!fnRead, 'P-2 readEventScopePre 存在')
ok(!!fnWrite, 'P-3 writeEventScopePre 存在')

// 在沙箱里真求值（只注入它们自身需要的符号）
const SB = new Function(
  'var EVENT_SCOPE_KEY = "wbEvt.scope";' +
  fnFilter + ';' + fnRead + ';' + fnWrite + ';' +
  'return { filterEventsByScopePre: filterEventsByScopePre, readEventScopePre: readEventScopePre, writeEventScopePre: writeEventScopePre };'
)()

const EV = (id, status) => ({ id, status, name: id, updatedAt: 1 })

console.log('')
console.log('== A. filterEventsByScopePre（真调用）==')
{
  const all = [
    EV('e1', 'active'),
    EV('e2', 'paused'),
    EV('e3', 'closed'),
    EV('e4', 'archived'),
    EV('e5', undefined),
  ]
  const act = SB.filterEventsByScopePre(all, 'active')
  const ids = act.map((x) => x.id)
  ok(ids.indexOf('e1') >= 0, 'A-1 active 保留', ids.join(','))
  ok(ids.indexOf('e2') >= 0, 'A-2 ★paused 保留（暂时停下，用户仍在跟进）', ids.join(','))
  ok(ids.indexOf('e3') < 0, 'A-3 closed 默认不显示')
  ok(ids.indexOf('e4') < 0, 'A-4 archived 默认不显示')
  // ★★2026-10-27 加固：不只查「在列表里」，还要查**默认档**（不传 scope）也含它 ——
  //   这是「用户升级上来旧事件无 status 字段也不会从看板消失」的直接保障。
  ok(ids.indexOf('e5') >= 0, 'A-5a ★status 缺省按 active（不能隐藏当前工作）', ids.join(','))
  ok(SB.filterEventsByScopePre(all).map((x) => x.id).indexOf('e5') >= 0, 'A-5b ★★默认档也含 status 缺省的事件（旧数据不消失）')
  ok(act.length === 3, 'A-6 默认档只留 3 个', act.length)

  const allScope = SB.filterEventsByScopePre(all, 'all')
  ok(allScope.length === 5, 'A-7 ★★「全部」档返回全部 5 个（用户裁定：保留入口）', allScope.length)
  ok(allScope.map((x) => x.id).indexOf('e4') >= 0, 'A-8 ★archived 在「全部」里可见（折叠而非删除）')

  // 负路径 / 边界
  ok(SB.filterEventsByScopePre([], 'active').length === 0, 'A-9 空输入不炸')
  ok(SB.filterEventsByScopePre(null, 'active').length === 0, 'A-10 null 不炸')
  ok(SB.filterEventsByScopePre(all, '垃圾值').length === 3, 'A-11 ★未知 scope 回落 active（fail-safe）', SB.filterEventsByScopePre(all, '垃圾值').length)
  ok(SB.filterEventsByScopePre(all, undefined).length === 3, 'A-12 undefined scope 按默认 active')
  // ★★2026-10-27 加固（变异 1 漏网抓到）：A 组都**显式传 'active'**，测不到「默认值」本身。
  //   必须真测「不传 scope / 传 undefined」的默认行为 —— 那才是用户裁定「默认筛 active」的落点。
  const def1 = SB.filterEventsByScopePre(all)
  ok(def1.length === 3, 'A-14 ★★不传 scope ⇒ 默认只留 active（用户裁定「默认筛 active」）', def1.length)
  ok(def1.map((x) => x.id).indexOf('e4') < 0, 'A-15 ★默认档不含 archived')
  // 不修改原数组
  const before = all.length
  SB.filterEventsByScopePre(all, 'active')
  ok(all.length === before, 'A-13 ★不修改原数组（避免污染数据源）')
}

console.log('')
console.log('== B. read/writeEventScopePre（持久化，真调用）==')
{
  // 假 storage
  const mkStore = (init) => {
    const m = Object.assign({}, init || {})
    return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, _m: m }
  }
  ok(SB.readEventScopePre(mkStore({})) === 'active', 'B-1 ★空 storage 默认 active（用户裁定：默认筛 active）')
  ok(SB.readEventScopePre(mkStore({ 'wbEvt.scope': 'all' })) === 'all', 'B-2 恢复 all')
  ok(SB.readEventScopePre(mkStore({ 'wbEvt.scope': '垃圾' })) === 'active', 'B-3 垃圾值回落 active')
  ok(SB.readEventScopePre({ getItem: () => { throw new Error('denied') } }) === 'active', 'B-4 storage 抛异常 ⇒ active（fail-soft）')
  const st = mkStore({})
  ok(SB.writeEventScopePre('all', st) === 'all', 'B-5 写 all 返回 all')
  ok(st._m['wbEvt.scope'] === 'all', 'B-6 真的写进 storage')
  ok(SB.writeEventScopePre('垃圾', st) === 'active', 'B-7 写非法值规整为 active')
}

console.log('')
console.log('== C. 接线（源码结构，守卫非功能证据）==')
{
  // ★明确标注：C 组是**守卫**，不是功能验收（功能在 A/B 组真调用里）
  ok(SRC.indexOf('var all = filterEventsByScopePre(allRaw, evScope)') >= 0, 'C-1 [守卫] 筛选接在排序之前')
  // ★#544：C-2/C-3 只是**存在性守卫**，不构成功能证据（它们曾经在不可达分支里也恒绿）。
  //   功能证据在 D 组（真渲染 + 数按钮 + 点击）。保留本组是为了在「函数被整段删掉」时立刻红。
  ok(SRC.indexOf("'data-dam-scope-btn': 'active'") >= 0, 'C-2 [守卫·非功能证据] 「活跃」按钮构造代码存在（功能见 D 组）')
  ok(SRC.indexOf("'data-dam-scope-btn': 'all'") >= 0, 'C-3 [守卫·非功能证据] 「全部」按钮构造代码存在（功能见 D 组）')
  ok(SRC.indexOf('EVENT_SCOPE_KEY') >= 0, 'C-4 [守卫] 持久化键存在')
  // 顺序：筛选必须在 sort 之前（否则「先取前 N 再筛」会假空）
  const iFilter = SRC.indexOf('var all = filterEventsByScopePre(allRaw, evScope)')
  const iSort = SRC.indexOf('var sorted = all.slice().sort(function (a, b) {')
  ok(iFilter >= 0 && iSort >= 0 && iFilter < iSort, 'C-5 ★筛选在排序**之前**（否则前 N 被筛光会假空）', iFilter + ' < ' + iSort)
}

console.log('')
console.log('== D. 运行期断言：真渲染 EventView，数范围切换按钮（★#544 的功能证据）==')
// ★★#544（2026-11-04）：为什么这一段必须存在 —— 旧 C-2/C-3 只断言「源码里有那个字符串」，
//   而字符串当时恰在 if (!ev4SrcDoc) 的**结构不可达**分支里（buildEv4IframeHtmlSafePre 恒返回真串），
//   于是「全部事件」入口从未进入产品，套件却长期全绿。判据换成：真执行 factory、真渲染组件树、数按钮。
//
// 手法：在**内存里**给 client.js 的 factory 追加一行 exports.__probeEventView（只改内存字符串，不落盘），
//   然后用最小 hooks harness 跑 EventView（受控计时器 + 受控 fetch，零网络）。
{
  const MARK = '    exports.apply = apply'
  ok(SRC.indexOf(MARK) >= 0, 'D-0 测试注入锚点存在（exports.apply = apply）')
  function patchSrc(src) {
    // ★注入位必须按**被注入的那份源**自身重新定位：先算一次原源码的偏移再套到变异体上，
    //   会因为上面删了一行而整体位移 ⇒ 注入落到语句中间 ⇒ ReferenceError（本轮实测就是这个坑）。
    const at = src.indexOf(MARK)
    if (at < 0) throw Error('patchSrc: 注入锚点在目标源里不存在')
    const eolAt = src.indexOf('\n', at)
    return src.slice(0, eolAt + 1) + '    exports.__probeEventView = EventView\n' + src.slice(eolAt + 1)
  }
  ok(SRC.indexOf('exports.__probeEventView') < 0, 'D-0b ★产品源码里没有测试钩子（注入只在内存字符串里）')

  const sameDeps = (a, b) => {
    if (!a || !b || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
  const noop = () => {}
  const mkEl = () => ({
    style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    appendChild: (c) => c, removeChild() {}, setAttribute() {}, getAttribute: () => null,
    removeAttribute() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
    insertBefore() {}, contains: () => false, focus() {}, blur() {},
    firstChild: null, parentNode: null, children: [], textContent: '', innerHTML: '', value: '',
    offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0,
  })
  function createHooks() {
    const states = [], refs = [], memos = [], effects = []
    let cursor = 0, dirty = false
    const api = {
      useState(init) {
        const i = cursor++
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init
        return [states[i], (v) => { const nv = typeof v === 'function' ? v(states[i]) : v; if (nv !== states[i]) { states[i] = nv; dirty = true } }]
      },
      useRef(v) { const i = cursor++; if (!(i in refs)) refs[i] = { current: v }; return refs[i] },
      useMemo(fn, deps) { const i = cursor++; const p = memos[i]; if (p && sameDeps(p.deps, deps)) return p.v; const v = fn(); memos[i] = { v, deps }; return v },
      useEffect(fn, deps) { const i = cursor++; const p = effects[i]; if (!p || !sameDeps(p.deps, deps)) effects[i] = { fn, deps, done: false } },
      useReducer(r, init) { const i = cursor++; if (!(i in states)) states[i] = init; return [states[i], (a) => { states[i] = r(states[i], a); dirty = true }] },
      useCallback(fn) { return fn }, useContext() { return {} },
    }
    return {
      api,
      begin() { cursor = 0; dirty = false },
      wasDirty: () => dirty,
      runEffects() { for (const e of effects) { if (!e || e.done) continue; e.done = true; try { e.fn() } catch (err) { /* fail-soft */ } } },
    }
  }
  const ACTIVE = { id: 'evt_aaaaaaaa', name: '活跃事件', status: 'active', updatedAt: 1000, checkpointCount: 1, kind: 'ledger', sections: { goal: 'g' } }
  const CLOSED = { id: 'evt_bbbbbbbb', name: '已关闭事件', status: 'closed', updatedAt: 500, checkpointCount: 1, kind: 'ledger', sections: { goal: 'g' } }

  async function renderWith(events, srcOverride) {
    const hooks = createHooks()
    const store = new Map()
    const storage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] || null, get length() { return store.size },
    }
    const loaded = []
    const React = Object.assign({
      createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids }),
      Fragment: 'Fragment', createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
      memo: (c) => c, forwardRef: (f) => f, Children: { map: (a, f) => (a || []).map(f) },
    }, hooks.api)
    const domStub = {
      head: mkEl(), body: mkEl(), documentElement: mkEl(),
      createElement: mkEl, createElementNS: mkEl, createTextNode: () => mkEl(),
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, removeEventListener: noop, readyState: 'complete', cookie: '', title: '',
    }
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      window: {
        __ModuleLoader__: { load: (e) => loaded.push(e) },
        addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout, setInterval, clearInterval,
        localStorage: storage, sessionStorage: storage,
        location: { href: 'http://localhost/', origin: 'http://localhost', search: '', hash: '' },
        navigator: { userAgent: 'node', language: 'zh' },
        matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
        requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
      },
      document: domStub, localStorage: storage, sessionStorage: storage,
      navigator: { userAgent: 'node', language: 'zh' },
      setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
      requestAnimationFrame: (f) => setTimeout(f, 0), cancelAnimationFrame: clearTimeout,
      fetch: (url) => {
        const u = String(url)
        let body = { ok: true }
        if (u.indexOf('/event-list') >= 0) body = { ok: true, events: events, total: events.length }
        else if (u.indexOf('/event-unarchived') >= 0) body = { ok: true, unarchived: 0, total: 0 }
        else if (u.indexOf('/event-detail') >= 0) body = { ok: true, event: null }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
      },
      TextEncoder, TextDecoder, URL, URLSearchParams, AbortController,
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
    }
    sandbox.globalThis = sandbox; sandbox.self = sandbox
    const ctx = vm.createContext(sandbox)
    new vm.Script(srcOverride || patchSrc(SRC), { filename: 'client.js' }).runInContext(ctx, { timeout: 30000 })
    const entry = loaded[loaded.length - 1]
    const ex = entry.factory((name) => (name === 'react' ? React : (name === 'react-dom' ? { createPortal: (n) => n } : {})))
    const view = ex.__probeEventView
    if (typeof view !== 'function') { console.log('SETUP-FAIL: __probeEventView 未导出'); process.exit(2) }
    let tree = null
    for (let i = 0; i < 8; i++) {
      hooks.begin()
      tree = view({ sessionId: 'sess-1', zh: true, limit: 10 })
      const wasDirty = hooks.wasDirty()
      hooks.runEffects()
      await new Promise((r) => setTimeout(r, 40))
      if (!wasDirty && i > 0) break
    }
    // ★返回底层 Map（fake storage 只有 getItem/setItem 形式 API，断言要看键值就得拿真 Map）
    return { tree, store, storage }
  }
  const collect = (node, out) => {
    if (!node) return
    if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return }
    if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return }
    if (typeof node !== 'object') return
    const p = node.props || {}
    out.nodes.push({ tags: Object.keys(p), props: p })
    collect(p.children, out); collect(node.children, out)
  }
  const scan = (t) => { const o = { nodes: [], text: [] }; collect(t, o); return o }
  const byTag = (o, tag) => o.nodes.filter((n) => n.tags.indexOf(tag) >= 0)
  // ★变异锚点必须**整行精确**匹配：若用「8 空格 + 调用」做子串，
  //   它会同时命中空态那行（10 空格缩进，偏移 2 处起恰好是 8 空格 + 调用）⇒ 变异会误删空态那一行，
  //   变异验证变假（本轮实测就是 2 处命中）。改成按行比较 + 行内容全等。
  const MAIN_LINE = '        renderEventScopeBarPre(evScope, setEvScope, zh),'
  // ★client.js 是 CRLF，而本文件的 SRC 未做行尾归一化（A/B/C 组都按子串工作，不受影响）；
  //   按行比较前必须先剥掉尾随回车（CR）——否则整行全等永远为假（本轮实测 got=0）。
  const srcLinesRaw = SRC.split('\n')
  const mainLineIdx = srcLinesRaw.reduce((acc, l, i) => (l.replace(/\r$/, '') === MAIN_LINE ? acc.concat(i) : acc), [])


  // ── D-1 主路径（有 active 事件 ⇒ 走 iframe）──
  {
    const { tree, store } = await renderWith([ACTIVE, CLOSED])
    const s = scan(tree)
    const scopeBtns = byTag(s, 'data-dam-scope-btn')
    const scopeBar = byTag(s, 'data-dam-event-scope')
    const iframes = byTag(s, 'data-dam-ev4-iframe')
    console.log('   D-1 渲染树：iframe=' + iframes.length + ' / scopeBar=' + scopeBar.length + ' / scopeBtn=' + scopeBtns.length + ' / 文案=' + JSON.stringify(scopeBtns.map((n) => n.props.children)))
    ok(iframes.length === 1, 'D-1 主路径仍是 iframe（范围条不是把 iframe 挤掉换来的）')
    ok(scopeBar.length >= 1, 'D-1 ★主路径渲染出范围切换容器（旧实现在此恒为 0）got=' + scopeBar.length)
    ok(scopeBtns.length === 2, 'D-1 ★主路径渲染出 2 个范围按钮（活跃/全部）got=' + scopeBtns.length)
    ok(scopeBtns.some((n) => n.props['data-dam-scope-btn'] === 'active'), 'D-1 含「活跃」按钮')
    ok(scopeBtns.some((n) => n.props['data-dam-scope-btn'] === 'all'), 'D-1 ★含「全部」按钮（用户裁定 Q7 的落点）')
    ok(!!(scopeBar[0] && scopeBar[0].props.style && scopeBar[0].props.style.flex === 'none'), 'D-1 范围条 flex:none（不参与伸缩，iframe 才能吃满剩余高度）')
    const allBtn = scopeBtns.find((n) => n.props['data-dam-scope-btn'] === 'all')
    ok(!!allBtn && typeof allBtn.props.onClick === 'function', 'D-1 「全部」按钮带点击处理器')
    allBtn.props.onClick()
    ok(store.get('wbEvt.scope') === 'all', 'D-1 ★点击「全部」真的落到持久化键（wbEvt.scope=all）got=' + JSON.stringify(store.get('wbEvt.scope')))
    const { tree: tree2 } = await renderWith([ACTIVE, CLOSED])
    ok(byTag(scan(tree2), 'data-dam-scope-btn').length === 2, 'D-1 重新渲染后范围条仍在（不是一次性渲染）')
  }

  // ── D-2 空态（全 closed + 默认 active 档）──
  {
    const { tree, store } = await renderWith([CLOSED])
    const s = scan(tree)
    const scopeBtns = byTag(s, 'data-dam-scope-btn')
    const joined = s.text.join('|')
    console.log('   D-2 空态：scopeBtn=' + scopeBtns.length + ' / iframe=' + byTag(s, 'data-dam-ev4-iframe').length + ' / 文本=' + JSON.stringify(joined.slice(0, 60)))
    ok(byTag(s, 'data-dam-ev4-iframe').length === 0, 'D-2 全 closed 时确实走空态（没有 iframe）')
    ok(joined.indexOf('还没有事件') >= 0, 'D-2 空态文案保留（原提示不丢）')
    ok(scopeBtns.length === 2, 'D-2 ★空态里也有两个范围按钮（旧实现这里是死胡同：用户无法切到「全部」）got=' + scopeBtns.length)
    const allBtn = scopeBtns.find((n) => n.props['data-dam-scope-btn'] === 'all')
    ok(!!allBtn && typeof allBtn.props.onClick === 'function', 'D-2 空态的「全部」按钮可点')
    allBtn.props.onClick()
    ok(store.get('wbEvt.scope') === 'all', 'D-2 ★空态点「全部」真的落盘（能把自己从空态救出来）got=' + JSON.stringify(store.get('wbEvt.scope')))
  }

  // ── D-3 负路径：默认档只显示 active（范围条存在 ≠ 筛选失效）──
  {
    const { tree } = await renderWith([ACTIVE, CLOSED])
    const s = scan(tree)
    const iframe = byTag(s, 'data-dam-ev4-iframe')[0]
    const srcDoc = String((iframe && iframe.props && iframe.props.srcDoc) || '')
    ok(srcDoc.length > 1000, 'D-3 srcDoc 非空（iframe 内容真的构造出来了）')
    ok(srcDoc.indexOf('evt_aaaaaaaa') >= 0, 'D-3 srcDoc 含 active 事件')
    ok(srcDoc.indexOf('evt_bbbbbbbb') < 0, 'D-3 ★负路径：默认档 srcDoc 不含 closed 事件（范围条没有把筛掉的东西放回来）')
  }

  // ── E 变异验证：证明 D 组有区分力（内存里去掉主路径那一行 ⇒ 按钮必须归零）──
  {
    ok(mainLineIdx.length === 1, 'E-0 主路径调用点唯一（整行全等比较，全文恰 1 行）got=' + mainLineIdx.length)
    const mutated = srcLinesRaw.slice(0, mainLineIdx[0]).concat(srcLinesRaw.slice(mainLineIdx[0] + 1)).join('\n')
    ok(mutated.length === SRC.length - (MAIN_LINE.length + 2), 'E-0b 变异只删掉这一行（长度差 = 行内容 + CRLF）got=' + (SRC.length - mutated.length))
    ok(mutated.split('\n').length === srcLinesRaw.length - 1, 'E-0d 变异体行数守恒（原行数 - 1）')
    ok(mutated.indexOf('exports.__probeEventView') < 0, 'E-0c 变异体取自产品源码（不含测试钩子）')
    const { tree } = await renderWith([ACTIVE, CLOSED], patchSrc(mutated))
    const s = scan(tree)
    const btns = byTag(s, 'data-dam-scope-btn').length
    console.log('   E-1 变异后（删掉主路径那一行）scopeBtn=' + btns)
    ok(byTag(s, 'data-dam-ev4-iframe').length === 1, 'E-1 变异后仍走主路径（证明变异只影响范围条，没把组件弄崩）')
    ok(btns === 0, 'E-1 ★★变异验证：删掉主路径调用后按钮数归零 ⇒ D 组断言有区分力（不是恒绿守卫）got=' + btns)
    // 还原：原源码里按钮数为 2（与 D-1 一致）⇒ 变异—还原 双向可复现
    const { tree: back } = await renderWith([ACTIVE, CLOSED])
    ok(byTag(scan(back), 'data-dam-scope-btn').length === 2, 'E-1b ★还原后按钮数回到 2（变异必红、还原复绿）')
  }
}

console.log('')
console.log('SUMMARY  PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)