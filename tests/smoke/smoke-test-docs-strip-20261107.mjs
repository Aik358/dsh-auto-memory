/**
 * 「相关文档」条验收（真执行）—— 2026-11-07 alpha.7
 *
 * ## 为什么不能只做静态断言
 * 本仓有过「源码里有这个字符串、但那段在结构不可达分支里」的长期误判（#544）。
 * ⇒ 本套件功能证据来自真执行，分两路：
 *   A/B/E：真执行 factory → 真渲染 EventView → 遍历**真实渲染树**（宿主元素逐个计数、读文本、比顺序）
 *   C/D  ：把复制按钮组件**从源码抽出**，用真 h/useState/useRef/useEffect 桩真调用 → 真点击 → 假 clipboard，
 *          断言 clipboard 实际收到的字符串与按钮的实际渲染产出（成功态/失败态）
 *
 * ★为什么按钮单独抽出跑：client.js 的 hooks 是**模块级别名**（var useState = React.useState），
 *   所有组件共享同一份 React 桩 ⇒ 在渲染树里展开子组件会互相踩 hook 槽位（第一版就踩了）。
 *   抽出来在独立 vm 里给它一份独立 hook 列表，才是「真执行该组件」的正确形态。
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

const P1 = 'docs/internal/PLAN-ALPHA7-20261107.md'
const P2 = 'handoff/handoff-20261107-1655.md'
const P3 = 'lib/client.js'

const EV3 = {
  id: 'evt_aaaaaaaa', name: '带三条来源的事件', status: 'active', updatedAt: 3000,
  checkpointCount: 1, kind: 'ledger', sections: { goal: 'g' },
  members: [P1, P2, P3],
}
const EV0 = {
  id: 'evt_bbbbbbbb', name: '无来源的事件', status: 'active', updatedAt: 2000,
  checkpointCount: 1, kind: 'ledger', sections: { goal: 'g' }, members: [],
}

const noop = () => {}
const mkEl = () => ({
  style: {}, dataset: {}, classList: { add () {}, remove () {}, toggle () {}, contains: () => false },
  appendChild: (c) => c, removeChild () {}, setAttribute () {}, getAttribute: () => null,
  removeAttribute () {}, addEventListener () {}, removeEventListener () {},
  querySelector: () => null, querySelectorAll: () => [],
  getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  insertBefore () {}, contains: () => false, focus () {}, blur () {},
  firstChild: null, parentNode: null, children: [], textContent: '', innerHTML: '', value: '',
  offsetWidth: 0, offsetHeight: 0, clientWidth: 0, clientHeight: 0,
})
const sameDeps = (a, b) => {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 一个组件实例的 hook 列表（对应 React 的 per-instance hooks） */
function hooksApi () {
  const states = [], refs = [], memos = [], effects = []
  let cursor = 0
  const api = {
    useState (init) {
      const i = cursor++
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init
      return [states[i], (v) => { const nv = typeof v === 'function' ? v(states[i]) : v; if (nv !== states[i]) states[i] = nv }]
    },
    useRef (v) { const i = cursor++; if (!(i in refs)) refs[i] = { current: v }; return refs[i] },
    useMemo (fn, deps) { const i = cursor++; const p = memos[i]; if (p && sameDeps(p.deps, deps)) return p.v; const v = fn(); memos[i] = { v, deps }; return v },
    useEffect (fn, deps) { const i = cursor++; const p = effects[i]; if (!p || !sameDeps(p.deps, deps)) effects[i] = { fn, done: false } },
    useReducer (r, init) { const i = cursor++; if (!(i in states)) states[i] = init; return [states[i], noop] },
    useCallback (fn) { return fn }, useContext () { return {} },
  }
  return {
    api,
    begin () { cursor = 0 },
    runEffects () { for (const e of effects) { if (!e || e.done) continue; e.done = true; try { e.fn() } catch (err) { /* fail-soft */ } } },
  }
}

function createTimers () {
  const q = new Map(); let next = 1
  return {
    setTimeout (fn) { const id = next++; q.set(id, fn); return id },
    clearTimeout (id) { q.delete(id) },
    flush () { const all = Array.from(q.entries()); q.clear(); for (const [, fn] of all) { try { fn() } catch (e) {} } },
    size: () => q.size,
  }
}

/** 真执行 factory + 真渲染 EventView，返回渲染树（不展开子组件，避免共享 hook 槽串味） */
async function renderEventView (events, srcOverride) {
  const timers = createTimers()
  const hk = hooksApi()
  const store = new Map()
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k), clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] || null, get length () { return store.size },
  }
  const loaded = []
  const React = Object.assign({
    createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids }),
    Fragment: 'Fragment', createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }),
    memo: (c) => c, forwardRef: (f) => f, Children: { map: (a, f) => (a || []).map(f) },
  }, hk.api)
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
      addEventListener: noop, removeEventListener: noop,
      setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: noop, clearInterval: noop,
      localStorage: storage, sessionStorage: storage,
      location: { href: 'http://localhost/', origin: 'http://localhost', search: '', hash: '' },
      navigator: { userAgent: 'node', language: 'zh' },
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
      requestAnimationFrame: (f) => { void f; return 0 }, cancelAnimationFrame: noop,
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
    },
    document: domStub, localStorage: storage, sessionStorage: storage,
    navigator: { userAgent: 'node', language: 'zh' },
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: noop, clearInterval: noop,
    queueMicrotask, Promise,
    requestAnimationFrame: (f) => { void f; return 0 }, cancelAnimationFrame: noop,
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
    hk.begin()
    tree = view({ sessionId: 'sess-1', zh: true, limit: 10 })
    hk.runEffects()
    hk.begin()
    tree = view({ sessionId: 'sess-1', zh: true, limit: 10 })
    hk.runEffects()
    await new Promise((r) => setTimeout(r, 20))
  }
  return { tree }
}

/** 代码锚串抽取（花括号配平），返回函数源码文本 */
function body (src, header) {
  const s = src.indexOf(header)
  if (s < 0) throw new Error('miss ' + header)
  let d = 0
  for (let i = s + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') d++
    else if (src[i] === '}') { d--; if (!d) return src.slice(s, i + 1) }
  }
  throw new Error('unbalanced')
}

/**
 * 真执行 DocsCopyButtonPre（源码抽出，独立 vm + 独立 hook 列表）。
 * 返回 { render(), click(), node }：render() 产生一次「渲染」，click() 调上一次渲染产出的 onClick。
 */
function makeCopyButton (clipboard) {
  const hk = hooksApi()
  const h = (type, props, ...kids) => {
    const flat = []
    for (const k of kids) { if (Array.isArray(k)) flat.push(...k.filter((x) => x != null && x !== false)); else if (k != null && k !== false) flat.push(k) }
    return { type, props: props || {}, children: flat }
  }
  const sandbox = { h, useState: hk.api.useState, useRef: hk.api.useRef, useEffect: hk.api.useEffect, console: { log: noop, warn: noop, error: noop } }
  sandbox.globalThis = sandbox
  if (clipboard) sandbox.navigator = { clipboard }
  else sandbox.navigator = {}
  const ctx = vm.createContext(sandbox)
  const code = body(SRC, 'function DocsCopyButtonPre(props) {') + '\nglobalThis.__Btn = DocsCopyButtonPre'
  vm.runInContext(code, ctx)
  const Btn = ctx.__Btn
  let node = null
  return {
    render (props) { hk.begin(); node = Btn(props); hk.runEffects(); return node },
    click () { if (!node || typeof node.props.onClick !== 'function') throw new Error('no onClick'); node.props.onClick() },
    get node () { return node },
  }
}

const MARK = '    exports.apply = apply'
ok(SRC.indexOf(MARK) >= 0, 'A-0 测试注入锚点存在（exports.apply = apply）')
ok(SRC.indexOf('exports.__probeEventView') < 0, 'A-0b ★产品源码里没有测试钩子（注入只在内存字符串里）')
function patchSrc (src) {
  const at = src.indexOf(MARK)
  if (at < 0) throw Error('patchSrc: 注入锚点在目标源里不存在')
  const eolAt = src.indexOf('\n', at)
  return src.slice(0, eolAt + 1) + '    exports.__probeEventView = EventView\n' + src.slice(eolAt + 1)
}

const collect = (node, out) => {
  if (node == null || node === false) return
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return }
  if (typeof node === 'string' || typeof node === 'number') { out.text.push(String(node)); return }
  if (typeof node !== 'object') return
  const p = node.props || {}
  out.nodes.push({ type: node.type, props: p, children: node.children || [] })
  collect(node.children, out)
  collect(p.children, out)
}
const scan = (t) => { const o = { nodes: [], text: [] }; collect(t, o); return o }
const byProp = (o, key) => o.nodes.filter((n) => Object.prototype.hasOwnProperty.call(n.props, key))
const textOf = (n) => (n.children || []).map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : (c && c.type === 'b' ? String((c.children || []).join('')) : ''))).join('')

/* ═══════════ A. 真渲染：3 条 members ═══════════ */
console.log('== A. 真渲染 EventView（members 3 条）==')
{
  const { tree } = await renderEventView([EV3])
  const s = scan(tree)
  const strips = byProp(s, 'data-dam-docs-strip')
  const paths = byProp(s, 'data-dam-docs-path')
  const copyNodes = s.nodes.filter((n) => typeof n.type === 'function' && n.type.name === 'DocsCopyButtonPre')
  ok(strips.length === 1, 'A-1 ★渲染出 1 条「相关文档」容器（实测 ' + strips.length + '）')
  ok(strips[0] && strips[0].props['data-dam-docs-count'] === '3', 'A-2 条数标记 = 3（实测 ' + (strips[0] && strips[0].props['data-dam-docs-count']) + '）')
  ok(s.text.indexOf('相关文档') >= 0, 'A-3 标题文案「相关文档」出现在渲染树里')
  ok(paths.length === 3, 'A-4 ★渲染出 3 条路径（实测 ' + paths.length + '）')
  const gotPaths = paths.map(textOf)
  ok(gotPaths.join('|') === [P1, P2, P3].join('|'), 'A-5 ★三条路径逐字一致且保序：' + gotPaths.join(' | '))
  ok(copyNodes.length === 3, 'A-6 ★每条路径右侧各有 1 个复制按钮组件（实测 ' + copyNodes.length + '）')
  ok(copyNodes.map((n) => n.props.path).join('|') === [P1, P2, P3].join('|'), 'A-7 三个按钮的 path prop 与三条路径一一对应')
  ok(paths.every((n) => n.type === 'span'), 'A-8 路径是纯文本 span（**不可点击跳转**：无 a 标签、无 href）')
  ok(byProp(s, 'data-dam-ev4-iframe').length === 1, 'A-9 仍走 iframe 主路径（条子没有把 iframe 挤掉）')
  const stripIdx = s.nodes.indexOf(strips[0])
  const frameIdx = s.nodes.findIndex((n) => n.props['data-dam-ev4-iframe'] !== undefined)
  ok(stripIdx >= 0 && frameIdx >= 0 && stripIdx < frameIdx, 'A-10 条子在 iframe **之前**（详情头部位置）got ' + stripIdx + ' < ' + frameIdx)
  const scopeIdx = s.nodes.findIndex((n) => n.props['data-dam-event-scope'] !== undefined)
  ok(scopeIdx >= 0 && scopeIdx < stripIdx, 'A-11 条子在范围条**之后**（题面指定位置）got ' + scopeIdx + ' < ' + stripIdx)
  ok(strips[0].props.style && strips[0].props.style.flex === 'none', 'A-12 容器 flex:none（不参与伸缩，iframe 仍吃满剩余高度）')
}

/* ═══════════ B. 负路径：members=[] ⇒ 整条不渲染 ═══════════ */
console.log('== B. [负路径] members 为空 ⇒ 整条不渲染（不占位）==')
{
  const { tree } = await renderEventView([EV0])
  const s = scan(tree)
  ok(byProp(s, 'data-dam-docs-strip').length === 0, 'B-1 ★members=[] ⇒ 容器 0 个（实测 ' + byProp(s, 'data-dam-docs-strip').length + '）')
  ok(byProp(s, 'data-dam-docs-path').length === 0, 'B-2 路径也不渲染')
  ok(s.nodes.filter((n) => typeof n.type === 'function' && n.type.name === 'DocsCopyButtonPre').length === 0, 'B-3 复制按钮组件也不渲染')
  ok(s.text.indexOf('相关文档') < 0, 'B-4 ★标题文案也不出现（不是渲染了空壳）')
  ok(byProp(s, 'data-dam-ev4-iframe').length === 1, 'B-5 主路径 iframe 不受影响（负路径没有把组件弄崩）')
  const noField = Object.assign({}, EV0); delete noField.members
  const r2 = await renderEventView([noField])
  ok(byProp(scan(r2.tree), 'data-dam-docs-strip').length === 0, 'B-6 字段整体缺失（旧后端）⇒ 同样不渲染，不抛')
  const dup = Object.assign({}, EV3, { id: 'evt_cccccccc', members: [P1, '  ', P1, null, P2] })
  const r3 = await renderEventView([dup])
  ok(byProp(scan(r3.tree), 'data-dam-docs-path').length === 2, 'B-7 去重 + 去空串/null（P1 重复两次只留一条）实测 ' + byProp(scan(r3.tree), 'data-dam-docs-path').length)
}

/* ═══════════ C. 真点击复制（假 clipboard 成功） ═══════════ */
console.log('== C. 真点击复制 ⇒ clipboard 内容 === 该路径 ==')
{
  const written = []
  const clip = { writeText: (t) => { written.push(String(t)); return Promise.resolve() } }
  const btn = makeCopyButton(clip)
  btn.render({ path: P2, zh: true })
  ok(btn.node && btn.node.type === 'button', 'C-1 组件真渲染出 button（实测 ' + (btn.node && btn.node.type) + '）')
  ok(btn.node.props['data-dam-docs-copy-state'] === 'idle', 'C-2 初始态 idle，文案「复制」（实测 ' + (btn.node.children || []).join('') + '）')
  btn.click()
  await new Promise((r) => setTimeout(r, 10))
  ok(written.length === 1, 'C-3 ★真点击触发了一次 writeText（实测 ' + written.length + '）')
  ok(written[0] === P2, 'C-4 ★★clipboard 内容 === 该路径（实测 ' + JSON.stringify(written[0]) + '）')
  btn.render({ path: P2, zh: true })
  ok(btn.node.props['data-dam-docs-copy-state'] === 'copied', 'C-5 ★状态切到 copied（实测 ' + btn.node.props['data-dam-docs-copy-state'] + '）')
  ok(String((btn.node.children || []).join('')) === '已复制', 'C-6 ★★按钮文案变「已复制」（实测 ' + JSON.stringify(btn.node.children) + '）')
  ok(btn.node.props['data-dam-docs-copy-error'] === '0', 'C-7 成功路径不置 error 标记')
  // 短暂：1.4s 后应回 idle
  const timers = createTimers()
  void timers
}

/* ═══════════ D. 负路径：失败必须显式提示 ═══════════ */
console.log('== D. [负路径] clipboard 失败 ⇒ 显式提示，不静默 ==')
{
  const cases = [
    ['writeText 同步抛错', { writeText: () => { throw new Error('clipboard-blocked') } }],
    ['writeText Promise reject', { writeText: () => Promise.reject(new Error('denied')) }],
    ['完全没有 navigator.clipboard', null],
    ['clipboard 存在但没有 writeText', {}],
  ]
  for (const [label, clip] of cases) {
    const b = makeCopyButton(clip)
    b.render({ path: P3, zh: true })
    b.click()
    await new Promise((r) => setTimeout(r, 10))
    b.render({ path: P3, zh: true })
    const st = b.node.props['data-dam-docs-copy-state']
    const txt = String((b.node.children || []).join(''))
    ok(st === 'failed' && b.node.props['data-dam-docs-copy-error'] === '1' && txt.indexOf('失败') >= 0,
      'D ★[' + label + '] 失败态显式可见（state=' + st + ' / error=' + b.node.props['data-dam-docs-copy-error'] + ' / 文案=' + JSON.stringify(txt) + '）')
  }
}

/* ═══════════ E. 变异反向验证 ═══════════ */
console.log('== E. [变异反向验证] 把「members 为空不渲染」改坏 ⇒ B 组必红；还原 ⇒ 复绿 ==')
{
  const GUARD = '      if (!paths.length) return null'
  ok(SRC.split(GUARD).length - 1 === 1, 'E-0 变异锚串恰命中 1 次（防注释包裹假绿）')
  const mutatedSrc = SRC.split(GUARD).join('      /* mutated: 去掉空则不渲染 */')
  ok(mutatedSrc !== SRC, 'E-0b 变异体确实与原文不同')
  const { tree } = await renderEventView([EV0], patchSrc(mutatedSrc))
  const s = scan(tree)
  const strips = byProp(s, 'data-dam-docs-strip').length
  const hasTitle = s.text.indexOf('相关文档') >= 0
  ok(strips === 1 && hasTitle, 'E-1 ★★变异后 members=[] 也渲染出空壳（strips=' + strips + ' / 标题=' + hasTitle + '）⇒ B 组断言有区分力')
  const back = await renderEventView([EV0])
  ok(byProp(scan(back.tree), 'data-dam-docs-strip').length === 0, 'E-1b ★还原后容器回到 0（变异必红、还原复绿）')
}

console.log('')
console.log('[docs-strip] PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail === 0 ? 0 : 1)
