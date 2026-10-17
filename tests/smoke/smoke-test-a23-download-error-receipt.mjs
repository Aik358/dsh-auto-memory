#!/usr/bin/env node
/**
 * [A23 · #443] 模型下载「开始/取消」失败必须可见（前端多面 + 触发链）。
 *
 * ★为什么必须新建本套件（既有套件对它有零鉴别力）：
 *   #443 的缺陷形态是 `.catch(function () {})` —— **空 catch 吞掉请求级错误**。
 *   修复只是「把 catch 的参数用起来」，任何**仅断言源码含某字符串**的守卫在修复前后都仍通过。
 *   ⇒ 按 CR-10 纪律：**真执行 factory → 真渲染 → 真点击 → 断言渲染树节点** + 变异验证。
 *
 * ★被测面（真源归属见 docs/internal/A01-A24-FIX-PLAN-20261017.md §1.2）：
 *   ① 经典手写区 SettingsPage（生成区外）—— v4 变体 Iter5Settings 的**生成源**
 *   ② v4 变体 Iter5Settings（生成区，由 ① 经生成器带出）
 *   ③ 经典 Iter5Settings（legacy 冻结块，源 = skins/legacy/iter5-325.js.frozen，无重建通道）
 *   ④ 欢迎向导 DialogHost 的下载步（独立作用域，用 wizSt.dlError 承载回执）
 *
 * ★判据纪律：主判据一律是**真渲染出的树节点文案**。源码文本比对仅作附带守卫，
 *   且在断言文案里显式标注「守卫，非功能证据」。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass += 1; console.log('  ok - ' + msg) } else { fail += 1; console.error('  FAIL - ' + msg) } }
const eq = (a, b, msg) => ok(Object.is(a, b), msg + '（实际 ' + JSON.stringify(a) + '）')

// ───────────────────────── 真执行 factory ─────────────────────────
const source = readFileSync(CLIENT, 'utf8').replace(/\r\n/g, '\n')
let states = [], effects = [], cursor = 0, exposed
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
  useState(initial) {
    const i = cursor++
    if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial
    return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }]
  },
  useRef(initial) { const [ref] = React.useState(() => ({ current: initial })); return ref },
  useReducer(fn, initial) { const [state, set] = React.useState(initial); return [state, action => set(old => fn(old, action))] },
  useEffect(fn, deps) {
    const i = cursor++
    const old = states[i]
    if (!old || deps.some((d, n) => !Object.is(d, old[n]))) { states[i] = deps; effects.push(fn) }
  },
}
const lsStore = { 'dsh-auto-memory.presentation.v1': 'instrument' }
const localStorage = {
  getItem: (k) => (k in lsStore ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v) },
  removeItem: (k) => { delete lsStore[k] }, length: 0,
}
const document = {
  documentElement: { getAttribute: () => '', style: { setProperty() {} }, classList: { contains: () => false } },
  querySelector: () => null, getElementById: () => null, addEventListener() {}, removeEventListener() {},
}
const window = {
  localStorage, addEventListener() {}, removeEventListener() {}, confirm() { return true },
  __ModuleLoader__: { load(def) { exposed = def.factory(name => { if (name === 'react') return React; throw Error('Test module unavailable: ' + name) }) } },
}
const context = vm.createContext({
  window, document, localStorage,
  console: { log() {}, warn() {}, info() {}, error() {} },
  navigator: { language: 'zh-CN' }, URL, URLSearchParams,
  requestAnimationFrame: fn => fn(), setTimeout, clearTimeout,
  setInterval: () => 1, clearInterval() {},
  fetch: () => { throw Error('Unexpected raw fetch') },
})
vm.runInContext(source.replace('    return module.exports', `    exports._a23 = { Iter5Settings: Iter5Settings, DialogHost: DialogHost,
      setDialog: function (d) { dialogState = d }, t: t,
      transport: function (get, post) { apiGet = get; apiPost = post },
      identity: function (value) { iter5Identity = function () { return value } } }
    return module.exports`), context, { filename: CLIENT })
const test = exposed._a23
ok(!!test && typeof test.Iter5Settings === 'function', 'factory 真执行成功，Iter5Settings 可调用（运行时守卫，非静态断言）')

// ───────────────────────── 树工具 ─────────────────────────
function nodes(tree, predicate, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (Array.isArray(tree)) { tree.forEach(x => nodes(x, predicate, out)); return out }
  if (predicate(tree)) out.push(tree)
  nodes(tree.props && tree.props.children, predicate, out)
  return out
}
const flatText = (v) => {
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(flatText).join('')
  if (v && typeof v === 'object' && v.props) return flatText(v.props.children)
  return ''
}
const errorNodes = (tree) => nodes(tree, n => n.props && n.props['data-dam-error'] === '')
const errorText = (tree) => errorNodes(tree).map(n => flatText(n.props.children)).join(' | ')
const buttonsOf = (tree) => nodes(tree, n => n.type === 'button')
const findButton = (tree, label) => buttonsOf(tree).find(n => flatText(n.props.children) === label)

// ───────────────────────── 夹具 ─────────────────────────
// 引擎模式 js + semantic-status 未就绪 ⇒ 打开引导后下载卡必然渲染（isJs && !ready）
let semPhase = { loaded: true, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false, download: { phase: 'idle' } }
let config = { semanticEngineMode: 'js', associativeMemoryEnabled: true, locale: 'zh', externalSources: {} }
let postImpl = async () => ({ ok: true })
const postCalls = []
test.transport(
  async (url) => {
    const u = String(url)
    if (u.includes('/semantic-status')) return semPhase
    if (u.includes('/config')) return { config: { ...config } }
    if (u.includes('/update-check')) return { current: '3.3.4' }
    return {}
  },
  async (url, payload) => { postCalls.push({ url: String(url), payload }); return postImpl(url, payload) },
)
const tick = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise(r => setTimeout(r, 0)) }
function render() { cursor = 0; const tree = test.Iter5Settings({}); const pending = effects; effects = []; pending.forEach(fn => fn()); return tree }
async function settle() { await tick(); return render() }
function resetUi() { states = []; effects = []; cursor = 0 }
// DialogHost 的渲染器：每帧必须把 cursor 归零，否则本 harness 会分配**新的** hook 槽
// 而不是复用旧槽 ⇒ state 全部丢失（表现为点了圆点却还停在第一步）。
function renderDialog() { cursor = 0; const tree = test.DialogHost(); const pending = effects; effects = []; pending.forEach(fn => { try { fn() } catch (e) {} }); return tree }

// 打开安装引导卡：真点「🧩 安装向导」（不直接改 state）
async function openGuide() {
  // 首帧必须先 render（effects 才会入队、异步 GET 才会发出），再 settle 等其落定。
  // 这与 smoke-test-iter5-skin.mjs 的 render(); await settle() 序列同构。
  render()
  let tree = await settle()
  const btn = findButton(tree, '🧩 安装向导')
  if (!btn) return { tree, opened: false }
  btn.props.onClick()
  render()
  tree = await settle()
  return { tree, opened: true }
}

// ───────────────────────── ① 正路径：#443 start 失败 ⇒ 真点「开始下载」⇒ 树里有回执 ─────────────────────────
{
  semPhase = { loaded: true, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false, download: { phase: 'idle' } }
  config = { semanticEngineMode: 'js', associativeMemoryEnabled: true, locale: 'zh', externalSources: {} }
  postImpl = async () => { throw Object.assign(new Error('already running'), { response: { ok: false, reason: 'already-running' } }) }
  resetUi()
  const opened = await openGuide()
  ok(opened.opened, '夹具自检：设置页渲染出「安装向导」按钮并成功点击（引导卡可达）')
  let tree = opened.tree
  const startBtn = findButton(tree, '开始下载')
  ok(!!startBtn, '夹具自检：引导卡渲染出「开始下载」按钮（isJs && !ready && !dlActive）')
  if (startBtn) {
    startBtn.props.onClick()
    await tick(10)
    tree = await settle()
    // 判定必须落在**回执节点自身**的文本上：本面同屏还有一条既存的「JS 引擎未就绪」提示
    // 也是 [data-dam-error]，只数节点数会被它满足（变异 M1 实测：空 catch 下节点数仍 >0）。
    ok(errorNodes(tree).some(n => flatText(n.props.children).indexOf('下载请求失败') >= 0),
      '★正路径：渲染树里出现**下载回执**节点（修复前空 catch ⇒ 只有既存未就绪提示，无回执）')
    ok(errorText(tree).includes('下载请求失败'), '★正路径：回执带「下载请求失败」前缀')
    ok(errorText(tree).includes('已有下载在进行中'), '★正路径：already-running 被译成人话（不是裸码值）')
    ok(!errorText(tree).includes('already-running'), '★正路径：用户可见文案里不出现裸错误码')
  }
}

// ───────────────────────── ② 负路径：post 正常 ⇒ 绝不出现下载失败回执（防把成功当失败） ─────────────────────────
{
  semPhase = { loaded: true, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false, download: { phase: 'idle' } }
  config = { semanticEngineMode: 'js', associativeMemoryEnabled: true, locale: 'zh', externalSources: {} }
  postImpl = async () => ({ ok: true })
  resetUi()
  const opened = await openGuide()
  let tree = opened.tree
  const startBtn = findButton(tree, '开始下载')
  ok(!!startBtn, '负路径②：引导卡仍渲染出「开始下载」按钮')
  if (startBtn) {
    startBtn.props.onClick()
    await tick(10)
    tree = await settle()
    ok(!errorText(tree).includes('下载请求失败'), '★负路径②：成功返回时**没有**下载失败回执（防把成功当失败）')
    ok(!errorText(tree).includes('已有下载在进行中'), '★负路径②：成功返回时不出现 already-running 文案')
  }
}

// ───────────────────────── ③ cancel 失败也同样可见（start/cancel 两处都改，非半修） ─────────────────────────
{
  semPhase = { loaded: true, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false, download: { phase: 'downloading', bytesDone: 1, bytesTotal: 100 } }
  config = { semanticEngineMode: 'js', associativeMemoryEnabled: true, locale: 'zh', externalSources: {} }
  postImpl = async () => { throw Object.assign(new Error('not running'), { response: { ok: false, reason: 'not-running' } }) }
  resetUi()
  const opened = await openGuide()
  let tree = opened.tree
  const cancelBtn = findButton(tree, '取消')
  ok(!!cancelBtn, '夹具自检：下载进行中时渲染出「取消」按钮')
  if (cancelBtn) {
    cancelBtn.props.onClick()
    await tick(10)
    tree = await settle()
    ok(errorText(tree).includes('取消') || errorText(tree).includes('下载请求失败'), '★③：cancel 失败同样写进 err 槽（不只有 start 一处修好）')
  }
}

// ───────────────────────── ④ 冻结面（无重建通道）必须独立验 ─────────────────────────
{
  const frozen = readFileSync(path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen'), 'utf8').replace(/\r\n/g, '\n')
  ok(!/semanticDownload[^\n]*\.catch\(function \(\) \{\}\)/.test(frozen), '★frozen 面：模型下载调用点不再有空 catch（该面无重建通道，必须独立验）')
  eq((frozen.match(/setErr\(dlFailTextPre\(e\)\)/g) || []).length, 2, '★frozen 面：start 与 cancel 两处都写入既有 err 槽')
  ok(/err \? h\('div', \{ 'data-dam-error': '' \}, err\)/.test(frozen), '★frozen 面：err 槽渲染点在位（写了才可见）')
}

// ───────────────────────── ⑤ 向导面：下载步失败 ⇒ 可见错误文案 ─────────────────────────
{
  semPhase = { loaded: true, ready: false, assetPresent: false, peerPresent: false, pythonInt8Present: false, download: { phase: 'idle' } }
  postImpl = async () => { throw Object.assign(new Error('already running'), { response: { ok: false, reason: 'already-running' } }) }
  resetUi()
  const wizSt = { loaded: true, ready: false, download: { phase: 'idle' }, tourCfg: null, cfgLoaded: false }
  window['dsh-auto-memory.wizStatus'] = wizSt
  test.setDialog({ kind: 'welcomeTour', manual: true })
  let tree = renderDialog()
  await tick(6)
  tree = renderDialog()
  // 真点第 7 个圆点（dl:true 的步，索引 6）——不读源码常量，直接逐步点
  const dots = nodes(tree, n => n.props && n.props['data-dam-tour-dot'] === '')
  ok(dots.length === 9, '夹具自检：向导渲染出 9 个步骤圆点（实际 ' + dots.length + '）')
  if (dots[6] && typeof dots[6].props.onClick === 'function') {
    dots[6].props.onClick()
    // 注意：点击只改 state（tourStep），必须再渲染一帧才反映到树上——这是本 harness 的
    // 「无 React 调度器」特性（effects 手动冲刷、render 手动重入），与真实 React 的批处理语义等价。
    tree = renderDialog()
    await tick(6)
    tree = renderDialog()
    const dlCards = nodes(tree, n => n.props && n.props['data-dam-tour-dl'] !== undefined)
    ok(dlCards.length > 0, '夹具自检：第 7 步真渲染出下载卡（[data-dam-tour-dl]）')
    if (dlCards.length) {
      // 冲刷 mount-time effect（含自动下载 effect），触发真实的 apiPost 失败路径
      const pending = effects; effects = []
      pending.forEach(fn => { try { fn() } catch (e) {} })
      await tick(10)
      tree = renderDialog()
      const wizText = nodes(tree, () => true).map(n => flatText(n.props && n.props.children)).join(' | ')
      ok(/下载请求失败/.test(wizText), '★⑤向导面：下载失败后渲染树含「下载请求失败」（经 wizSt.dlError → dlPhaseTxt）')
      ok(/已有下载在进行中/.test(wizText), '★⑤向导面：向导里同样把 already-running 译成人话')
    }
  }
  test.setDialog(null)
}

// ───────────────────────── ⑥ 同批 #441 / #426 的前端判据（真渲染面已在其余套件覆盖，此处钉计数） ─────────────────────────
{
  eq((source.match(/!res\.ok \|\| \(j && j\.ok === false\)/g) || []).length, 2, '#441 res.ok 判据在 classic + v4 两面（少一处即半修）')
  const guard = "!p.observationOnly && p.stage === 'validated' && !(p.requiresApproval && !p.approved)"
  eq(source.split(guard).length - 1, 3, '#426 激活判据在 client.js 三面（classic 手写 + legacy 镜像 + v4）')
  const frozen = readFileSync(path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen'), 'utf8')
  eq(frozen.split(guard).length - 1, 1, '#426 激活判据在 frozen 面（手工镜像，独立验）')
}

// ───────────────────────── ⑦ 错误码全集（lib/semantic-js.js:721-734）都有翻译 ─────────────────────────
{
  const def = source.match(/function dlReasonTextPre\(code\) \{([\s\S]*?)\n    \}/)
  ok(!!def, '守卫：dlReasonTextPre 定义在场（守卫，非功能证据；功能证据在 ①/②/③/⑤ 真渲染）')
  if (def) {
    for (const code of ['already-running', 'not-running', 'no-models-root', 'bad-mirror']) {
      ok(def[1].includes("'" + code + "'"), '守卫：错误码全集覆盖 ' + code)
    }
    ok(def[1].includes('return raw'), '守卫：未知码原样透出（不静默吞）')
  }
  // 负路径：语义引擎侧的错误码集合必须恰好这四个（防日后新增码而不补翻译）
  const sj = readFileSync(path.join(ROOT, 'lib', 'semantic-js.js'), 'utf8')
  const codes = [...new Set((sj.match(/reason: '([a-z-]+)'/g) || []).map(s => s.replace(/reason: '/, '').replace(/'$/, '')))]
  ok(codes.length >= 4, '语义引擎侧错误码实测 ' + codes.length + ' 个：' + codes.join('/'))
  const missing = codes.filter(c => def && !def[1].includes("'" + c + "'"))
  eq(missing.length, 0, '语义引擎侧每个错误码都有对应的人话翻译（缺：' + JSON.stringify(missing) + '）')
}

console.log('')
console.log('== a23-download-error-receipt: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)
