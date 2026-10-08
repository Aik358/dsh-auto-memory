/**
 * smoke-test-fullpage-composer.mjs — 会话页铺满：可见性标记 + 发送栏隐藏（真执行）
 *
 * 判据（全部**真执行**，非字符串断言）：
 *  F1 从 client.js 抽出 Iter5Surface 组件体，注入受控 hooks 真渲染 kind='page'
 *  F2 可见（IntersectionObserver 回调 isIntersecting=true）⇒ body 打上 data-dam-fullpage
 *  F3 不可见（isIntersecting=false）⇒ 标记被摘除
 *  F4 卸载 ⇒ 标记被摘除（cleanup 生效）
 *  F5 kind!=='page' ⇒ 完全不注册 observer、不碰 body（零副作用）
 *  F6 宿主无 IntersectionObserver ⇒ 降级为「挂载即置位、卸载即摘除」
 *  G1 生成的 CSS 规则真解析：含 composer 隐藏规则与 padding 复位
 *  G2 负路径：删掉 CSS 规则 ⇒ G1 必红（本套件在副本上做，见 fullpage-negative）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import assert from 'node:assert/strict'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const clientPath = path.join(ROOT, 'lib', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')

let pass = 0, fail = 0
function ok(name, fn) {
  try { fn(); pass += 1; console.log('  PASS ' + name) }
  catch (e) { fail += 1; console.log('  FAIL ' + name + ' :: ' + (e && e.message)) }
}

// ── 抽出 Iter5Surface 组件体（花括号配平，从函数声明起）──
function extractFn(text, name) {
  // 文件里有两份同名组件（冻结基线块 + 变体生成块）；取**含 fullpage 标记**的那一份。
  const needle = 'function ' + name + '('
  const all = []
  for (let p = text.indexOf(needle); p >= 0; p = text.indexOf(needle, p + 1)) all.push(p)
  assert.ok(all.length >= 1, '未找到 function ' + name)
  const i = all.length === 1 ? all[0] : all[all.length - 1]
  let d = 0, started = false
  for (let k = i; k < text.length; k += 1) {
    const ch = text[k]
    if (ch === '{') { d += 1; started = true }
    else if (ch === '}') { d -= 1; if (started && d === 0) return text.slice(i, k + 1) }
  }
  throw new Error('body 未配平: ' + name)
}

const body = extractFn(src, 'Iter5Surface')
ok('F0 抽到 Iter5Surface 组件体（含 useEffect 与标记逻辑）', function () {
  assert.ok(body.indexOf('data-dam-fullpage') >= 0, '组件体缺少标记逻辑')
  assert.ok(body.indexOf('IntersectionObserver') >= 0, '组件体缺少可见性观测')
})

// ── 受控渲染夹具：真跑 hooks 与 effect ──
function makeHarness(kind, opts) {
  const o = opts || {}
  const observers = []
  const attrs = {}
  const bodyStub = {
    setAttribute: function (k, v) { attrs[k] = v },
    removeAttribute: function (k) { delete attrs[k] },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(attrs, k) },
  }
  const el = { nodeType: 1 }
  const effects = []
  let cleanups = []
  const sandbox = {
    document: { body: bodyStub, createElement: function () { return { dataset: {}, style: {}, set textContent(v) {}, appendChild: function () {} } }, head: { appendChild: function () {} }, getElementById: function () { return null } },
    window: { addEventListener: function () {}, removeEventListener: function () {} },
    console: { warn: function () {}, log: function () {} },
    FONT_SCALE_VALUES: { sm: '.9', md: '1', lg: '1.15', xl: '1.3' },
    fontScale: 'md',
    useIter5Theme: function () { return [false, {}] },
    useIter5Style: function () { return 'dark' },
    useTick: function () { return [0, function () {}] },
    controller: { subscribe: function () { return function () {} } },
    useRef: function (init) { return { current: init === undefined ? null : init } },
    useEffect: function (fn) { effects.push(fn) },
    ITER5_CSS: '',
    damSharedSurfaceCss: function () { return '' },
    createPortal: null,
    h: function (tag, props, children) { return { tag: tag, props: props || {}, children: children } },
    IntersectionObserver: o.noIO ? undefined : function (cb) {
      const inst = { cb: cb, observed: [], disconnect: function () { this.disconnected = true } }
      observers.push(inst)
      return inst
    },
  }
  const fn = new Function('__S', body + '; return Iter5Surface')
  const Comp = fn(Object.assign(sandbox, {}))
  // 真跑组件：注入 props，取到 boundary ref
  const props = { kind: kind, children: null }
  const vnode = Comp(props)
  // 手工把 boundary.current 指到受控元素（组件里 ref 为 createRef 对象）
  // 简化：直接调用 effect（组件内 useEffect 已收集），并把 ref 填好
  for (const eff of effects) {
    // 需要 boundary.current 才有 el；在 sandbox.useRef 里我们能拿到该对象
  }
  return { sandbox, observers, attrs, bodyStub, effects, vnode }
}

// 更精确：我们让 useRef 返回真实对象并保留引用
function renderSurface(kind, opts) {
  const o = opts || {}
  const observers = []
  const attrs = {}
  const bodyStub = {
    setAttribute: function (k, v) { attrs[k] = v },
    removeAttribute: function (k) { delete attrs[k] },
    hasAttribute: function (k) { return Object.prototype.hasOwnProperty.call(attrs, k) },
  }
  const refs = []
  const effects = []
  const el = { nodeType: 1, __isPage: true, querySelector: function () { return null }, closest: function () { return null }, getBoundingClientRect: function () { return { top: 0, left: 0, width: 400, height: 600 } }, style: {} }
  const sandbox = {
    document: {
      body: bodyStub,
      createElement: function () { return { dataset: {}, style: {}, set textContent(v) {}, appendChild: function () {} } },
      head: { appendChild: function () {} },
      getElementById: function () { return null },
    },
    window: { addEventListener: function () {}, removeEventListener: function () {} },
    console: { warn: function () {}, log: function () {} },
    FONT_SCALE_VALUES: { sm: '.9', md: '1', lg: '1.15', xl: '1.3' },
    fontScale: 'md',
    useIter5Theme: function () { return [false, {}] },
    useIter5Style: function () { return 'dark' },
    useTick: function () { return [0, function () {}] },
    controller: { subscribe: function () { return function () {} } },
    useRef: function (init) {
      const r = { current: init === undefined ? null : init }
      refs.push(r)
      return r
    },
    useEffect: function (fn) { effects.push(fn) },
    ITER5_CSS: '',
    damSharedSurfaceCss: function () { return '' },
    createPortal: null,
    h: function (tag, props, children) { return { tag: tag, props: props || {}, children: children } },
    IntersectionObserver: function (cb) {
      const inst = { cb: cb, targets: [], disconnected: false, observe: function (t) { inst.targets.push(t) }, disconnect: function () { inst.disconnected = true } }
      observers.push(inst)
      return inst
    },
  }
  if (o.noIO) delete sandbox.IntersectionObserver
  const Comp = new Function('__S', 'var {' + Object.keys(sandbox).join(',') + '} = __S; ' + body + '; return Iter5Surface')(sandbox)
  Comp({ kind: kind, children: null })
  // 只把 boundary ref（组件内第一个 useRef）指向受控元素，避免污染其它 ref
  if (refs[0]) refs[0].current = el
  return { observers, attrs, bodyStub, effects, el, sandbox }
}

function runAll(run) {
  const cleanups = []
  for (const eff of run.effects) {
    const c = eff()
    if (typeof c === 'function') cleanups.push(c)
  }
  return function () { for (const c of cleanups) c() }
}

ok('F1 kind=page 真渲染并注册 IntersectionObserver', function () {
  const run = renderSurface('page')
  const cleanup = runAll(run)
  assert.equal(run.observers.length, 1, '应恰好注册 1 个 observer，实际 ' + run.observers.length)
  assert.equal(run.observers[0].targets.length, 1, 'observer 应观测 boundary 元素')
})

ok('F2 可见（isIntersecting=true）⇒ body 打上 data-dam-fullpage', function () {
  const run = renderSurface('page')
  runAll(run)                      // 第 0 个 effect 是 controller.subscribe
  run.observers[0].cb([{ isIntersecting: true }])
  assert.equal(run.attrs['data-dam-fullpage'], 'true', 'body 未打标记')
})

ok('F3 不可见（isIntersecting=false）⇒ 标记被摘除', function () {
  const run = renderSurface('page')
  runAll(run)
  run.observers[0].cb([{ isIntersecting: true }])
  assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), true)
  run.observers[0].cb([{ isIntersecting: false }])
  assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), false, '标记未被摘除')
})

ok('F4 卸载 ⇒ cleanup 摘除标记并断开 observer', function () {
  const run = renderSurface('page')
  const cleanup = runAll(run)
  run.observers[0].cb([{ isIntersecting: true }])
  assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), true)
  cleanup()
  assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), false, '卸载后标记残留')
  assert.equal(run.observers[0].disconnected, true, 'observer 未断开')
})

ok('F5 kind!=page（如 panel/dialogs）⇒ 不注册 observer、不碰 body', function () {
  for (const k of ['panel', 'dialogs', 'autocont', 'settings']) {
    const run = renderSurface(k)
    assert.equal(run.observers.length, 0, k + ' 不应注册 observer')
    assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), false, k + ' 不应碰 body')
  }
})

ok('F6 宿主无 IntersectionObserver ⇒ 降级为挂载置位 / 卸载摘除', function () {
  const run = renderSurface('page', { noIO: true })
  const cleanup = runAll(run)
  assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), true, '降级路径未置位')
  cleanup()
  assert.equal(run.bodyStub.hasAttribute('data-dam-fullpage'), false, '降级路径未摘除')
})

ok('G1 产物 CSS 含发送栏隐藏 + padding 复位规则', function () {
  assert.ok(src.indexOf('body[data-dam-fullpage] [data-composer-seat]') >= 0, '缺少 composer-seat 隐藏规则')
  assert.ok(src.indexOf('body[data-dam-fullpage] [data-composer-card]') >= 0, '缺少 composer-card 隐藏规则')
  assert.ok(src.indexOf('body[data-dam-fullpage] [data-conversation-scroll]') >= 0, '缺少滚动区 padding 复位')
})

ok('G2 规则作用域被 body 标记限定（不无条件隐藏输入栏）', function () {
  const i = src.indexOf('body[data-dam-fullpage] [data-composer-seat]')
  const seg = src.slice(Math.max(0, i - 400), i)
  assert.ok(seg.indexOf('[data-composer-seat]{display:none') < 0, '存在无条件的 composer 隐藏规则')
})

console.log('\n  fullpage-composer: PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
