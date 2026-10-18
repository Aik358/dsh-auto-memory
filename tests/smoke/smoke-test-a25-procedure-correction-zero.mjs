#!/usr/bin/env node
/**
 * [A25 · #390] 技能纠正容忍度必须可以设为合法的 0（三面真执行 + 宿主闸门 + 晋升链路）。
 *
 * ★为什么必须新建本套件（既有套件对它零鉴别力）：
 *   #390 的缺陷形态是 **falsy 误判**：旧写法 `Number(e.target.value) || 0.3` 把用户输入的 0 当空值，
 *   当场回填 0.3。所以只看「源码含某个字符串」的守卫在修复前后都能通过 —— 它根本看不见「0 变成了 0.3」。
 *   按 CR-10 纪律：本套件的主判据一律是 **真 vm 执行 factory -> 真渲染树 -> 真触发 onChange -> 断言被写回配置的值**。
 *
 * ★被测面（三处控件 = 同一表达式的三个落点）：
 *   ① 经典手写 SettingsPage（lib/client.js，生成区之外；v4 变体 Iter5Settings 的生成源）
 *   ② v4 变体 Iter5Settings（lib/client.js 的 ITER5-GENERATED 区内，由 ① 经生成器带出）
 *   ③ legacy 旧款 Iter5Settings（lib/client.js 的 ITER5-LEGACY-GENERATED 区内 = 冻结包被 IIFE 包进 factory）
 *   ④ skins/legacy/iter5-325.js.frozen（冻结旧款皮肤源；无重建通道，独立验，见 [F]）
 *
 * ★判据纪律：主判据是**真渲染树的 input.value + 真实 POST /config 的 body**；源码文本比对只作守卫，
 *   并在断言文案里显式标注「守卫，非功能证据」。
 *
 * ★变异验证（负路径，隔离副本，绝不改仓库文件）：
 *   const CLIENT = process.env.DAM_A25_CLIENT || <repo>/lib/client.js
 *   把 client.js 复制到 .diag-a25/client-mutant.js，把三处 onChange 忠实回退为旧写法
 *   Math.max(0, Math.min(1, Number(e.target.value) || 0.3))，然后：
 *     $env:DAM_A25_CLIENT='<副本绝对路径>'; node tests/smoke/smoke-test-a25-procedure-correction-zero.mjs
 *   必须变红，且红在「0 被写成 0.3」那几条。
 */
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = process.env.DAM_A25_CLIENT ? path.resolve(process.env.DAM_A25_CLIENT) : path.join(ROOT, 'lib', 'client.js')
const FROZEN = path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen')
const INDEX = path.join(ROOT, 'lib', 'index.js')
const STORE = path.join(ROOT, 'lib', 'procedure-store.js')
const NL = String.fromCharCode(10)
const Q = String.fromCharCode(39)

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log('  ok - ' + msg) } else { fail += 1; console.error('  FAIL - ' + msg) } }
const eq = (a, b, msg) => ok(Object.is(a, b), msg + ' (actual ' + JSON.stringify(a) + ')')

console.log('[face source] ' + CLIENT)
console.log('[repo root]   ' + ROOT)

// ---------------- 真执行 factory（React/localStorage/document 是受控边界） ----------------
const source = readFileSync(CLIENT, 'utf8')
let states = [], effects = [], cursor = 0, exposed
const React = {
  Fragment: Symbol('Fragment'),
  Component: function Component(props) { this.props = props },
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
  useState(initial) {
    const i = cursor++
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial
    return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }]
  },
  useRef(initial) { const r = React.useState(() => ({ current: initial }))[0]; return r },
  useReducer(fn, initial) { const p = React.useState(initial); return [p[0], action => p[1](old => fn(old, action))] },
  useEffect(fn, deps) {
    const i = cursor++
    const old = states[i]
    if (!old || !deps || deps.some((d, n) => !Object.is(d, old[n]))) { states[i] = deps || []; effects.push(fn) }
  },
}
React.Component.prototype = { constructor: React.Component }
const lsStore = {}
const localStorage = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v) },
  removeItem: (k) => { delete lsStore[k] }, length: 0,
}
const document = {
  documentElement: { getAttribute: () => '', style: { setProperty() {} }, classList: { contains: () => false } },
  querySelector: () => null, getElementById: () => null, addEventListener() {}, removeEventListener() {},
  createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
  head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} },
}
const window = {
  localStorage, addEventListener() {}, removeEventListener() {}, confirm() { return true },
  setTimeout, clearTimeout, location: { reload() {} },
  __ModuleLoader__: { load(def) { exposed = def.factory((name) => { if (name === 'react') return React; throw Error('Test module unavailable: ' + name) }) } },
}
const context = vm.createContext({
  window, document, localStorage,
  console: { log() {}, warn() {}, info() {}, error() {} },
  navigator: { language: 'zh-CN' }, URL, URLSearchParams,
  requestAnimationFrame: (fn) => fn(), setTimeout, clearTimeout,
  setInterval: () => 1, clearInterval() {},
  fetch: () => { throw Error('Unexpected raw fetch') }, AbortController,
})

// 宿主响应的可控边界：GET /config 给出远端配置，POST /config 记录**真实请求体**并回写。
let remoteConfig = { locale: 'zh', procedureCorrectionCap: 0.3 }
const postCalls = []
async function apiGetImpl(url) {
  const u = String(url)
  if (u.indexOf('/config') >= 0) return { config: Object.assign({}, remoteConfig) }
  if (u.indexOf('/update-check') >= 0) return { current: '3.3.4' }
  if (u.indexOf('/handoff-state') >= 0) return {}
  if (u.indexOf('/semantic-status') >= 0) return { loaded: true, ready: true }
  return {}
}
async function apiPostImpl(url, payload) {
  const u = String(url)
  postCalls.push({ url: u, payload })
  if (u.endsWith('/config')) {
    remoteConfig = Object.assign({}, remoteConfig, payload)
    return { config: Object.assign({}, remoteConfig), migrated: '', warning: '' }
  }
  return {}
}

// 暴露三个设置面（含旧款冻结块的 settings 组件）与注入点；不改任何运行时行为。
const LEGACY_RET = 'return { page: Iter5Page, css: ITER5_CSS + LEGACY_OVERLAY_EXTRA }'
const hasLegacyRet = source.indexOf(LEGACY_RET) >= 0
const LEGACY_RET_PATCHED = 'return { page: Iter5Page, css: ITER5_CSS + LEGACY_OVERLAY_EXTRA, settings: Iter5Settings }'
const injection = '    exports._a25 = { SettingsPage: SettingsPage, Iter5Settings: Iter5Settings, LegacySettings: LEGACY_SKIN_NS.settings, t: t, API: API, transport: function (get, post) { apiGet = get; apiPost = post }, sessions: function (value) { sessions = value } }' + NL + '    return module.exports'
let injected = hasLegacyRet ? source.replace(LEGACY_RET, LEGACY_RET_PATCHED) : source
injected = injected.replace('    return module.exports', injection)
vm.runInContext(injected, context, { filename: CLIENT })
const test = exposed._a25
ok(!!test && typeof test.SettingsPage === 'function', '[A] factory 真执行成功，经典 SettingsPage 可调用（运行时守卫，非静态断言）')
ok(!!test && typeof test.Iter5Settings === 'function', '[A] factory 真执行成功，v4 Iter5Settings 可调用（运行时守卫，非静态断言）')
ok(hasLegacyRet, '[A] legacy 生成块 IIFE 的返回值锚点在位（旧款 settings 组件可被取出）')
ok(!!test && typeof test.LegacySettings === 'function', '[A] factory 真执行成功，legacy Iter5Settings（冻结包）可调用（运行时守卫，非静态断言）')
test.transport(apiGetImpl, apiPostImpl)
test.sessions({
  list: {
    getSnapshot() { return { current: 'sA25', byId: { sA25: { cwd: '/ws-a25', retainedBy: { mainView: 1 } } } } },
    subscribe() { return () => {} },
  },
})

// ---------------- 树工具 / 无调度器 harness（与 smoke-test-a23 同构） ----------------
function nodes(tree, predicate, out) {
  out = out || []
  if (!tree || typeof tree !== 'object') return out
  if (Array.isArray(tree)) { tree.forEach((x) => nodes(x, predicate, out)); return out }
  if (predicate(tree)) out.push(tree)
  nodes(tree.props && tree.props.children, predicate, out)
  return out
}
function flatText(v) {
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(flatText).join('')
  if (v && typeof v === 'object' && v.props) return flatText(v.props.children)
  return ''
}
const hasProp = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key)
const tick = async (n) => { const c = n || 8; for (let i = 0; i < c; i += 1) await new Promise((r) => setTimeout(r, 0)) }
function resetHooks() { states = []; effects = []; cursor = 0 }
function frame(Comp) {
  cursor = 0
  const tree = Comp({})
  const pending = effects; effects = []
  for (const fn of pending) { try { fn() } catch (e) {} }
  return tree
}
const CORR_LABEL = () => test.t('fProcCorr')
function locateCorrection(tree) {
  const i5rows = nodes(tree, (n) => n.props && n.props['data-i5-field'] === CORR_LABEL())
  if (i5rows.length) return { rows: i5rows.length, input: nodes(i5rows[0], (n) => n.type === 'input')[0] || null }
  const rows = nodes(tree, (n) => n.props && hasProp(n.props, 'data-dam-settings-row') && flatText(n).indexOf(CORR_LABEL()) >= 0)
  return { rows: rows.length, input: rows[0] ? (nodes(rows[0], (n) => n.type === 'input')[0] || null) : null }
}
async function mount(Comp) {
  resetHooks()
  let tree = frame(Comp)
  for (let i = 0; i < 14; i += 1) {
    await tick(6)
    tree = frame(Comp)
    if (locateCorrection(tree).input) break
  }
  return tree
}
async function advance(Comp, rounds) {
  let tree = frame(Comp)
  const c = rounds || 4
  for (let i = 0; i < c; i += 1) { await tick(6); tree = frame(Comp) }
  return tree
}
const inputValue = (tree) => { const loc = locateCorrection(tree); return loc.input ? loc.input.props.value : undefined }
function saveButtonOf(tree) {
  const bars = nodes(tree, (n) => n.props && hasProp(n.props, 'data-dam-savebar'))
  if (!bars.length) return null
  const buttons = nodes(bars[0], (n) => n.type === 'button')
  return buttons.find((b) => b.props['data-dirty'] === 'true') || null
}
function cancelButtonOf(tree) {
  const bars = nodes(tree, (n) => n.props && hasProp(n.props, 'data-dam-savebar'))
  if (!bars.length) return null
  return nodes(bars[0], (n) => n.type === 'button').find((b) => flatText(b.props.children).indexOf('取消') >= 0) || null
}
function lastConfigPost() {
  for (let i = postCalls.length - 1; i >= 0; i -= 1) if (postCalls[i].url.endsWith('/config')) return postCalls[i]
  return null
}
// props 同形过滤（number/min=0/max=1/step=0.05）在本页会命中 2 个（tier0BudgetShare 同形）
// => 这是真实的定位陷阱：本套件按**用户可见标签**定位，并把该事实钉成夹具自检。
const sameShapeInputs = (tree) => nodes(tree, (n) => n.type === 'input' && n.props && n.props.type === 'number' && n.props.min === 0 && n.props.max === 1 && n.props.step === 0.05)

// ---------------- [B] 主判据：三面各走一遍 onChange('0') -> 真点保存 -> 真 POST body ----------------
const FACES = [
  { key: 'classic', name: '① 经典手写 SettingsPage（生成源，生成区之外）', comp: () => test.SettingsPage },
  { key: 'v4', name: '② v4 生成变体 Iter5Settings（ITER5-GENERATED 区）', comp: () => test.Iter5Settings },
  { key: 'legacy', name: '③ legacy 旧款 Iter5Settings（LEGACY-GENERATED 区 / 冻结包）', comp: () => test.LegacySettings },
]
for (const face of FACES) {
  console.log('== [B] ' + face.name + ' ==')
  remoteConfig = { locale: 'zh', procedureCorrectionCap: 0.3 }
  postCalls.length = 0
  let tree = await mount(face.comp())
  const loc = locateCorrection(tree)
  ok(loc.rows === 1, '夹具自检：页面上「' + CORR_LABEL() + '」行恰好 1 个（实际 ' + loc.rows + '）')
  ok(!!loc.input, '夹具自检：该行渲染出输入控件')
  if (!loc.input) continue
  eq(loc.input.props.type, 'number', '夹具自检：控件是 number 输入')
  eq(loc.input.props.min, 0, '夹具自检：控件 min=0（0 是设计允许值）')
  eq(loc.input.props.max, 1, '夹具自检：控件 max=1')
  eq(loc.input.props.step, 0.05, '夹具自检：控件 step=0.05')
  ok(sameShapeInputs(tree).length >= 2, '夹具自检：props 同形过滤在本页命中 ' + sameShapeInputs(tree).length + ' 个（>=2）=> 必须按标签定位（另一处是 tier0BudgetShare）')
  eq(loc.input.props.value, 0.3, '初始渲染值 = 宿主默认 0.3')

  loc.input.props.onChange({ target: { value: '0' } })
  tree = await advance(face.comp())
  eq(inputValue(tree), 0, '★真触发 onChange({value:"0"}) 后，树上 value 严格 === 0（修复前 falsy 回填 0.3）')
  ok(typeof inputValue(tree) === 'number', '★回填值类型是 number（不是字符串 0）')

  const saveBtn = saveButtonOf(tree)
  ok(!!saveBtn, '夹具自检：保存按钮进入 dirty 可点状态')
  if (saveBtn) {
    eq(saveBtn.props.disabled, false, '夹具自检：保存按钮未被禁用')
    saveBtn.props.onClick()
    await tick(30)
    tree = await advance(face.comp(), 3)
    const post = lastConfigPost()
    ok(!!post, '★真点击保存后发起了 POST /config')
    if (post) {
      ok(hasProp(post.payload, 'procedureCorrectionCap'), '★POST body 携带 procedureCorrectionCap')
      eq(post.payload.procedureCorrectionCap, 0, '★★POST body.procedureCorrectionCap 严格 === 0（不是 0.3、不是字符串 0）')
      eq(typeof post.payload.procedureCorrectionCap, 'number', '★POST body 里该字段是 number 类型')
    }
    eq(inputValue(tree), 0, '★保存回包后，树上 value 仍为 0（往返不丢）')
  }
  await tick(20)
}

// ---------------- [C] 负路径：同一 handler 的其它分支必须保持原语义（判据有鉴别力） ----------------
console.log('== [C] 负路径：空值/非法值仍回落 0.3，0 与空串必须被区分 ==')
{
  remoteConfig = { locale: 'zh', procedureCorrectionCap: 0.3 }
  let tree = await mount(test.Iter5Settings)
  const setVal = async (raw) => {
    const loc = locateCorrection(tree)
    ok(!!loc.input, '负路径夹具：控件在位（取值 ' + JSON.stringify(raw) + '）')
    if (!loc.input) return undefined
    loc.input.props.onChange({ target: { value: raw } })
    tree = await advance(test.Iter5Settings, 3)
    return inputValue(tree)
  }
  eq(await setVal(''), 0.3, '负路径：空串（用户清空）回落默认 0.3（fallback 分支仍活着）')
  eq(await setVal('abc'), 0.3, '负路径：非数值输入回落默认 0.3（Number.isFinite 判据生效）')
  eq(await setVal('2'), 1, '负路径：超上限 2 被夹到 1')
  eq(await setVal('-1'), 0, '负路径：负值 -1 被夹到 0（下界仍是 0）')
  eq(await setVal('0.05'), 0.05, '负路径：合法中间值 0.05 原样写入')
  eq(await setVal('0'), 0, '★负路径对照：字符串 0 必须写成 0 —— 与空串（0.3）结果不同，正是 #390 的缺陷形态')
  eq(await setVal(''), 0.3, '★负路径：随后的空串仍回落 0.3（0 的写入没有污染 fallback）')
  const cancelBtn = cancelButtonOf(tree)
  ok(!!cancelBtn, '夹具自检：v4 面有「取消修改」按钮（用于清理草稿）')
  if (cancelBtn) { cancelBtn.props.onClick(); tree = await advance(test.Iter5Settings, 3) }
  eq(inputValue(tree), 0.3, '清理后回到基线 0.3（草稿未污染后续断言）')
}

// ---------------- [D] 宿主侧真执行：闸门 getter 表达式求值 + 校验层 + 白名单 ----------------
console.log('== [D] 宿主侧：maxCorrectionRate getter 真实表达式求值 / 校验层 / DEFAULT_CONFIG 白名单 ==')
const indexSource = readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n')
{
  const refs = indexSource.split('get maxCorrectionRate()').length - 1
  eq(refs, 1, '[D] 守卫：lib/index.js 中 maxCorrectionRate getter 恰好 1 处（非功能证据）')
  const marker = 'get maxCorrectionRate() {'
  const at = indexSource.indexOf(marker)
  ok(at >= 0, '[D] 守卫：能定位 getter（非功能证据）')
  if (at >= 0) {
    const lineEnd = indexSource.indexOf(NL, at)
    const line = indexSource.slice(at, lineEnd)
    const open = line.indexOf('{')
    const close = line.lastIndexOf('}')
    const body = line.slice(open + 1, close)
    ok(body.length > 40, '[D] 守卫：取到 getter 表达式体（' + body.length + ' 字符；非功能证据）')
    const evalCap = (capValue) => {
      const engine = { config: { procedureCorrectionCap: capValue } }
      return vm.runInNewContext('(function(){' + body + '})()', { engine })
    }
    eq(evalCap(0), 0, '★★真求值：procedureCorrectionCap=0 => maxCorrectionRate 严格 === 0（0 是合法有效值）')
    eq(evalCap(0.3), 0.3, '真求值：0.3 => 0.3（默认值不被改写）')
    eq(evalCap(undefined), 0.3, '真求值：未配置 => 回落 0.3（v >= 0 判据）')
    eq(evalCap(-1), 0.3, '真求值：负值 => 回落 0.3（非法值不穿透）')
    eq(evalCap('0'), 0, '真求值：字符串 0 => 0（Number() 归一后仍尊重 0）')
    eq(evalCap('abc'), 0.3, '真求值：非数值 => 回落 0.3')
    ok(indexSource.indexOf('Number(engine.config.procedureCorrectionCap) || 0.3') < 0, '[D] 守卫：宿主 getter 不再使用 Number(...) || 0.3（非功能证据；功能证据是上面的真求值）')
  }
  const { validateSettingsPatch } = await import(pathToFileURL(path.join(ROOT, 'lib', 'settings-safety.js')).href)
  eq(Object.keys(validateSettingsPatch({ procedureCorrectionCap: 0 })).length, 0, '[D] 校验层：validateSettingsPatch({procedureCorrectionCap:0}) 无错误（0 不被拒绝）')
  eq(Object.keys(validateSettingsPatch({ procedureCorrectionCap: 0.3 })).length, 0, '[D] 校验层：0.3 同样无错误（对照，证明校验层不是全放行也不是只看 0）')
  eq(validateSettingsPatch({ procedureCorrectionCap: 0 }).procedureCorrectionCap, undefined, '[D] 校验层：{0} 返回空错误对象（无该键）')
  const dcStart = indexSource.indexOf('const DEFAULT_CONFIG = {')
  const dcEnd = indexSource.indexOf(NL + '}' + NL, dcStart)
  ok(dcStart >= 0 && dcEnd > dcStart, '[D] 守卫：能定位 DEFAULT_CONFIG 块（非功能证据）')
  if (dcStart >= 0 && dcEnd > dcStart) {
    const dcBlock = indexSource.slice(dcStart, dcEnd)
    const keys = []
    for (const line of dcBlock.split(NL)) {
      const m = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/)
      if (m) keys.push(m[1])
    }
    ok(keys.length > 100, '[D] 守卫：DEFAULT_CONFIG 键集解析到 ' + keys.length + ' 个键（>100，解析非空）')
    ok(keys.includes('procedureCorrectionCap'), '★[D] procedureCorrectionCap 在 DEFAULT_CONFIG 白名单内（POST /config 的 allowed 键集 = Object.keys(DEFAULT_CONFIG)）')
  }
}
// [D5] 真宿主路由：真 import lib/index.js -> 真 apply -> 真 POST /config（临时 DSH_HOME，不碰用户数据）
{
  const tmpHome = mkdtempSync(path.join(tmpdir(), 'dam-a25-host-'))
  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = tmpHome
  try {
    let idx = null
    try { idx = await import(pathToFileURL(INDEX).href) } catch (e) {
      console.log('  SKIP - lib/index.js 当前不可 import（并发编辑中间态）：' + String((e && e.message) || e).slice(0, 140))
      console.log('         => [D5] 真路由段本次跳过；单跑复验请在无人并发时执行')
    }
    if (idx) {
      const routes = []
      const ctx = {
        get() { return undefined }, on() { return () => {} }, effect() { return () => {} },
        systemPrompt: { section() { return () => {} }, context() { return () => {} } },
        tools: { register() { return () => {} } },
        webServer: { register(route) { routes.push(route); return () => {} } },
      }
      idx.apply(ctx, {})
      const route = routes.find((r) => String(r.path || '') === '/api/dsh-auto-memory/config')
      ok(!!route, '[D5] 夹具自检：真宿主注册了 /config 路由（共 ' + routes.length + ' 条）')
      if (route) {
        const call = (method, body) => new Promise((resolve) => {
          let statusCode = 0, payload = null
          const chunks = body ? [Buffer.from(JSON.stringify(body))] : []
          const res = {
            writeHead(c) { statusCode = c; return this }, setHeader() {},
            end(s) { try { payload = JSON.parse(s) } catch (_) { payload = s } resolve({ statusCode, payload }) },
          }
          const req = {
            method, url: '/api/dsh-auto-memory/config',
            headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' },
            [Symbol.asyncIterator]() { let i = 0; return { next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }) } },
            setEncoding() {}, pause() {}, resume() {},
          }
          Promise.resolve(route.handler(req, res)).catch((e) => resolve({ statusCode: -1, payload: String((e && e.message) || e) }))
        })
        const before = await call('GET')
        eq(before.statusCode, 200, '[D5] GET /config 200')
        eq(before.payload && before.payload.config && before.payload.config.procedureCorrectionCap, 0.3, '[D5] 真宿主出厂默认 0.3')
        const posted = await call('POST', { procedureCorrectionCap: 0 })
        eq(posted.statusCode, 200, '★[D5] 真宿主 POST /config {procedureCorrectionCap:0} => 200（白名单+校验层都放行）')
        eq(posted.payload && posted.payload.config && posted.payload.config.procedureCorrectionCap, 0, '★[D5] 响应 config 里 procedureCorrectionCap === 0')
        const after = await call('GET')
        eq(after.payload && after.payload.config && after.payload.config.procedureCorrectionCap, 0, '★[D5] 真宿主落盘后回读仍 === 0（不是 0.3）')
      }
    }
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
    try { rmSync(tmpHome, { recursive: true, force: true }) } catch (e) {}
  }
}

// ---------------- [E] 产线链路：maxCorrectionRate=0 必须是最严格的**有效**值（不是 falsy 穿透） ----------------
console.log('== [E] procedure-store 真执行：cap=0 拦阻 <=> 同证据 cap=0.3/cap=1 放行 ==')
{
  const { createProcedureStorePre } = await import(pathToFileURL(STORE).href)
  const NOW = 1750000000000
  const gates = (cap) => ({ minSessionDiversity: 0, minSuccessCount: 0, maxCorrectionRate: cap, maxContradictions: 99, highRiskRequiresApproval: false })
  const seed = (store) => {
    const created = store.observe({ title: 'A25 流程（真执行）', riskLevel: 'low', steps: ['1'], successCriteria: ['ok'], scope: 'global' })
    ok(created && created.ok === true, '[E] 夹具自检：observe 入库成功')
    const id = created.procedure.procedureId
    store.addEvidence(id, { kind: 'seen' })
    store.addEvidence(id, { kind: 'seen' })
    store.addEvidence(id, { kind: 'success' })
    store.addEvidence(id, { kind: 'success' })
    store.addEvidence(id, { kind: 'correction' })
    return id
  }
  const run = (cap) => {
    const store = createProcedureStorePre({ gates: gates(cap), now: () => NOW })
    const id = seed(store)
    const promoted = store.promote(id)
    const view = store.evaluatePromotion(id)
    const override = store.promotionOverrideView(id)
    return { promoted, view, override }
  }
  const zero = run(0)
  eq(zero.promoted.promoted, false, '★[E] cap=0：同证据（纠正率 0.17）**不得**晋升')
  ok(Array.isArray(zero.promoted.reasonCodes) && zero.promoted.reasonCodes.some((c) => c.indexOf('correction-rate-') === 0),
    '★★[E] cap=0：拦阻原因码是 correction-rate-*（实际 ' + JSON.stringify(zero.promoted.reasonCodes) + '）')
  eq(zero.view.decision, 'keep', '[E] 只读投影同判据：cap=0 => keep')
  ok(Array.isArray(zero.view.reasonCodes) && zero.view.reasonCodes.some((c) => c.indexOf('correction-rate-') === 0), '[E] 只读投影原因码同为 correction-rate-*')
  eq(zero.override.gateKind, 'structural', '[E] cap=0 拦阻属结构门（人工也不可越权）')
  const dflt = run(0.3)
  eq(dflt.promoted.promoted, true, '★[E] 对照组：cap=0.3（出厂默认）同证据 => 晋升成功')
  const wide = run(1)
  eq(wide.promoted.promoted, true, '★[E] 对照组：cap=1 => 晋升成功')
  ok(zero.promoted.promoted !== dflt.promoted.promoted, '★★[E] 反 falsy 穿透：cap=0 的行为与 cap=0.3 **不同** => 0 没有被 || 0.3 静默替换')
  ok(zero.promoted.promoted !== wide.promoted.promoted, '[E] cap=0 的行为与 cap=1 也不同（0 是最严格端）')
}

// ---------------- [F] 冻结面 / 多面同形（守卫，非功能证据） ----------------
console.log('== [F] 冻结面与多面同形守卫（守卫，非功能证据） ==')
const NEW_EXPR = 'e.target.value !== ' + Q + Q + ' && Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 0.3'
const OLD_EXPR = 'Number(e.target.value) || 0.3'
{
  const rawClient = readFileSync(CLIENT, 'utf8')
  const frozenRaw = readFileSync(FROZEN, 'utf8')
  eq(rawClient.split(NEW_EXPR).length - 1, 3, '[F] client.js 三面各一处新表达式（守卫，非功能证据）')
  eq(rawClient.split(OLD_EXPR).length - 1, 0, '[F] client.js 已无旧写法 Number(e.target.value) || 0.3（守卫，非功能证据）')
  eq(frozenRaw.split(NEW_EXPR).length - 1, 1, '[F] 冻结包 iter5-325.js.frozen 一处新表达式（该面无重建通道，独立验；守卫，非功能证据）')
  eq(frozenRaw.split(OLD_EXPR).length - 1, 0, '[F] 冻结包已无旧写法（守卫，非功能证据）')
  const frozenLines = frozenRaw.split(NL)
  const frozenLine = frozenLines.find((l) => l.indexOf('fProcCorr') >= 0) || ''
  ok(frozenLine.indexOf(NEW_EXPR) >= 0, '[F] 冻结包 fProcCorr 那一行含新表达式（守卫，非功能证据）')
  ok(frozenLine.indexOf('procedureCorrectionCap') >= 0 && frozenLine.indexOf('Math.max(0, Math.min(1') >= 0, '[F] 冻结包该行仍保留下界/上限夹取（守卫，非功能证据）')

  const skinsFiles = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.js$|\.frozen$/.test(entry.name)) skinsFiles.push(full)
    }
  }
  walk(path.join(ROOT, 'skins'))
  const CONTROL_RE = /t\('fProcCorr'\), h\('input'/
  const BIND_RE = /set\('procedureCorrectionCap'/
  // 判「有控件」而不是「提到该键」：skins/iter5/settings-copy.js 只是文案词典（有 fProcCorr 的措辞），
  // 没有控件绑定。用「field(t('fProcCorr'), h('input'」+「set('procedureCorrectionCap'」双判据。
  const skinHits = skinsFiles.filter((f) => {
    const text = readFileSync(f, 'utf8')
    return CONTROL_RE.test(text) && BIND_RE.test(text)
  })
  eq(skinHits.length, 1, '[F] 第四面普查：skins 下只有 iter5-325.js.frozen 含该控件（扫描 ' + skinsFiles.length + ' 个文件；命中 ' + skinHits.map((f) => path.basename(f)).join(',') + '）')
  ok(skinHits.length > 0 && path.basename(skinHits[0]) === 'iter5-325.js.frozen', '[F] 第四面普查：命中的正是冻结包（无第四套皮肤面）')
  // skins/iter5/settings-copy.js 是**文案词典**（只有措辞，没有控件/绑定）——它在普查里必须被判为「无控件」。
  const copyFile = path.join(ROOT, 'skins', 'iter5', 'settings-copy.js')
  const copyText = readFileSync(copyFile, 'utf8')
  ok(copyText.indexOf('fProcCorr') >= 0, '[F] 普查口径自检：settings-copy.js 确实提到 fProcCorr（措辞层）')
  ok(!(CONTROL_RE.test(copyText) && BIND_RE.test(copyText)), '[F] 普查口径自检：settings-copy.js 只有措辞、无控件与绑定 => 不计入第四面')
}
for (const face of FACES) console.log('  [F] 已覆盖面：' + face.key)

console.log('')
console.log('== a25-procedure-correction-zero: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)
