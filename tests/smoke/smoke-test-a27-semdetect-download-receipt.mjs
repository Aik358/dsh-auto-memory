#!/usr/bin/env node
/**
 * [A27 · task-12 / #443 同族残留] semSetup 弹窗「立即下载」失败必须可见。
 *
 * ★缺陷形态：'.catch(function () {})' —— 空 catch 吞掉请求级错误。宿主对 semantic-download
 *   start 失败返回 400（already-running / no-models-root / bad-mirror，错误码全集见
 *   lib/semantic-js.js:721-734），旧实现弹窗照旧关闭、用户零线索 ⇒ 任何「源码含 catch 参数」的
 *   静态守卫在修复前后都仍通过。按 CR-10：真执行 factory → 真渲染 → 真点「立即下载」→
 *   断言 **notice 弹窗的渲染树文案** + 变异验证。
 *
 * ★被测面：lib/client.js 的 DialogHost()（:16966 起）里 'dialogState.kind === "semSetup"' 分支
 *   （:17544-17603）。点击链：sdActions[?].onClick → apiPost(API.semanticDownload,{action:'start'})
 *   → catch → openDialog({kind:'notice', notice:{title, message: dlFailTextPre(e)}})。
 *
 * ★判据纪律：主判据=真渲染出的 notice 弹窗节点文本（Iter5Notice 组合组件现场调用取文案）。
 *   负路径=①post 正常 resolve ⇒ 不出现失败文案；②变异副本（.diag-a2x/client-mutant-a27*.js，
 *   把修复段整段换回旧写法 .catch(function () {})）必须红。
 *
 * ★已做的变异验证（隔离副本，仓库文件零改动；副本由原样复制 lib/client.js 后只改这一处）：
 *   client-mutant-a27-emptycatch.js —— 把整段修复（sdSnoozeOnce + .then/.catch + openDialog）
 *   逐字换回 HEAD 的旧写法
 *     'apiPost(API.semanticDownload, { action: "start", mirror: "auto" }).catch(function () {})'
 *     + localStorage 免打扰 + closeDialog()
 *   ⇒ 10 FAIL（dialogState 恒 null、无 notice 弹窗、无「下载请求失败/已有下载在进行中/下载源参数不合法」）。
 *   副本 crlf=19440 / lone-LF=0，node --check 通过。
 *   ★注意：DialogHost 的 notice 分支返回的是**组合组件** h(Iter5Notice, …)，断言前必须现场展开
 *   （见 treeUtils 的 expand()），否则「渲染树里有没有 notice」会恒判 false。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = process.env.DAM_A27_CLIENT || path.join(ROOT, 'lib', 'client.js')

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
  documentElement: { getAttribute: () => '', style: { setProperty() {}, colorScheme: '' }, classList: { contains: () => false } },
  body: { hasAttribute: () => false },
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
vm.runInContext(source.replace('    return module.exports', `    exports._a27 = { DialogHost: DialogHost, setDialog: function (d) { dialogState = d },
      getDialog: function () { return dialogState },
      t: t, transport: function (get, post) { apiGet = get; apiPost = post } }
    return module.exports`), context, { filename: CLIENT })
const test = exposed && exposed._a27
ok(!!test && typeof test.DialogHost === 'function', 'factory 真执行成功，DialogHost 可调用（运行时守卫，非静态断言）')
ok(!!test && typeof test.setDialog === 'function', 'factory 真执行成功，setDialog 可注入弹窗状态')
ok(!!test && typeof test.getDialog === 'function', 'factory 真执行成功，getDialog 可观测单例队列状态')

// ───────────────────────── 树工具 ─────────────────────────
function nodes(tree, predicate, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (Array.isArray(tree)) { tree.forEach(x => nodes(x, predicate, out)); return out }
  if (predicate(tree)) out.push(tree)
  nodes(tree.props && tree.props.children, predicate, out)
  return out
}
// 组合组件（Iter5Notice）没有 children prop ⇒ 单独展平其输出才能读到 title/message 文案。
// 调用前后保存/还原 hook 槽，避免「读文案」污染被测组件状态。
function invokeComposite(fn, props) {
  const savedStates = states.slice(), savedCursor = cursor, savedEffects = effects.slice()
  try { return fn(props) } catch (_) { return null } finally { cursor = savedCursor; states = savedStates; effects = savedEffects }
}
const flatText = (v, depth = 0) => {
  if (depth > 10) return ''
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map(x => flatText(x, depth + 1)).join('')
  if (!v || typeof v !== 'object' || !v.props) return ''
  if (v.props.children === undefined && typeof v.type === 'function') {
    const out = invokeComposite(v.type, v.props)
    return out === undefined || out === null ? '' : flatText(out, depth + 1)
  }
  return flatText(v.props.children, depth + 1)
}
const treeText = (tree) => flatText(tree)
// DialogHost 的 notice 分支返回的是**组合组件** h(Iter5Notice, …)（不是宿主节点）⇒ 断言前必须把
// 组合组件现场展开成宿主树，否则「渲染树里有没有 notice」会恒判 false（即便弹窗真的弹出来了）。
// 展开时用 invokeComposite（保存/还原 hook 槽），对被展开组件的状态零污染。
function expand(tree, depth = 0) {
  if (depth > 12) return tree
  if (Array.isArray(tree)) return tree.map(x => expand(x, depth + 1))
  if (!tree || typeof tree !== 'object') return tree
  if (typeof tree.type === 'function') {
    const out = invokeComposite(tree.type, tree.props)
    return out === undefined || out === null ? null : expand(out, depth + 1)
  }
  const props = tree.props || {}
  if (!('children' in props)) return tree
  return { ...tree, props: { ...props, children: expand(props.children, depth + 1) } }
}
const expanded = (tree) => expand(tree)
const findButton = (tree, label) => nodes(expanded(tree), n => n.type === 'button').find(n => flatText(n.props.children) === label)
const noticeDialogs = (tree) => nodes(expanded(tree), n => n.props && n.props['data-native-dialog'] === 'notice')
const allText = (tree) => treeText(expanded(tree))

const tick = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise(r => setTimeout(r, 0)) }
// DialogHost 每帧必须把 cursor 归零，否则 harness 会分配新 hook 槽而非复用旧槽（state 全丢）。
function renderDialog() {
  cursor = 0
  const tree = test.DialogHost()
  const pending = effects
  effects = []
  pending.forEach(fn => { try { fn() } catch (_) {} })
  return tree
}
function resetUi() { states = []; effects = []; cursor = 0 }

// ───────────────────────── 夹具 ─────────────────────────
let postImpl = async () => ({ ok: true })
const postCalls = []
test.transport(
  async (url) => {
    const u = String(url)
    if (u.indexOf('/semantic-status') >= 0) return { loaded: true, ready: false, download: { phase: 'idle' } }
    return {}
  },
  async (url, payload) => { postCalls.push({ url: String(url), payload }); return postImpl(url, payload) },
)
const semSetDialog = (value) => test.setDialog(value)

/** 打开 semSetup 引导卡（recommendation=download-model ⇒ 必渲染「立即下载」） */
function openSemSetup() {
  resetUi()
  semSetDialog({ kind: 'semSetup', result: { recommendation: 'download-model', deep: null } })
  let tree = renderDialog()
  tree = renderDialog()   // 第二帧：冲刷 mount 帧里排队的 refreshSem 效果
  return tree
}

// ───────────────────────── ① 正路径：start 失败 ⇒ 真点「立即下载」⇒ 渲染树里出现 notice 回执 ─────────────────────────
{
  postCalls.length = 0
  delete lsStore['dsh-auto-memory.semDetectSnoozeUntil']
  postImpl = async () => { throw Object.assign(new Error('already running'), { response: { ok: false, reason: 'already-running' } }) }
  let tree = openSemSetup()
  const downloadBtn = findButton(tree, '立即下载')
  ok(!!downloadBtn, '夹具自检：semSetup 引导卡渲染出「立即下载」按钮（recommendation=download-model）')
  if (downloadBtn) {
    downloadBtn.props.onClick()          // 真点
    await tick(10)                       // 等 apiPost 拒绝 → catch → openDialog(notice)
    tree = renderDialog()                // notice 已入队（closeDialog 先 pop 队列，再 openDialog）
    tree = renderDialog()
    ok(postCalls.length === 1, '★真点击确实发出了 semantic-download 请求（实际 ' + postCalls.length + ' 次）')
    ok(postCalls[0] && postCalls[0].payload && postCalls[0].payload.action === 'start',
      '★真点击请求体 action=start（实际 ' + JSON.stringify(postCalls[0] && postCalls[0].payload) + '）')
    const dlg = test.getDialog()
    ok(dlg && dlg.kind === 'notice', '★正路径：openDialog 真把单例队列切到 notice（修复前空 catch ⇒ dialogState 直接为 null；实际 ' + JSON.stringify(dlg && dlg.kind) + '）')
    eq(noticeDialogs(tree).length, 1, '★正路径：渲染树里出现 **notice 弹窗**（修复前空 catch ⇒ 弹窗直接消失，零线索）')
    const text = allText(tree)
    ok(text.indexOf('下载请求失败') >= 0, '★正路径：notice 文案含「下载请求失败」（实际「' + text.replace(/\s+/g, ' ').slice(0, 220) + '…」）')
    ok(text.indexOf('已有下载在进行中') >= 0, '★正路径：already-running 被译成人话「已有下载在进行中」（不是裸码）')
    ok(text.indexOf('already-running') < 0, '★正路径：用户可见文案里不出现裸错误码 already-running')
    ok(text.indexOf('语义模型下载未启动') >= 0, '★正路径：notice 标题说明「语义模型下载未启动」')
    ok(!!lsStore['dsh-auto-memory.semDetectSnoozeUntil'], '★正路径：失败分支同样写下 24h 免打扰（localStorage semDetectSnoozeUntil）')
  }
  semSetDialog(null)
  renderDialog()
}

// ───────────────────────── ② 负路径：post 正常 resolve ⇒ 绝不出现下载失败文案（防把成功当失败） ─────────────────────────
{
  postCalls.length = 0
  delete lsStore['dsh-auto-memory.semDetectSnoozeUntil']
  postImpl = async () => ({ ok: true, started: true })
  let tree = openSemSetup()
  const downloadBtn = findButton(tree, '立即下载')
  ok(!!downloadBtn, '负路径②：引导卡仍渲染出「立即下载」按钮')
  if (downloadBtn) {
    downloadBtn.props.onClick()
    await tick(10)
    tree = renderDialog()
    tree = renderDialog()
    ok(postCalls.length === 1, '负路径②：成功路径同样发出了 semantic-download 请求')
    const text = allText(tree)
    ok(text.indexOf('下载请求失败') < 0, '★负路径②：成功返回时**没有**下载失败回执（实际「' + text.replace(/\s+/g, ' ').slice(0, 160) + '…」）')
    ok(text.indexOf('已有下载在进行中') < 0, '★负路径②：成功返回时不出现 already-running 文案')
    ok(noticeDialogs(tree).length === 0, '★负路径②：成功返回时不弹失败 notice（弹窗应静默关闭）')
    ok(test.getDialog() === null, '★负路径②：成功返回时单例队列为空（dialogState===null），未入队任何 notice（实际 ' + JSON.stringify(test.getDialog()) + '）')
    ok(!!lsStore['dsh-auto-memory.semDetectSnoozeUntil'], '★负路径②：成功分支也写 24h 免打扰（两分支共用 sdSnoozeOnce）')
    ok(tree === null, '★负路径②：弹窗关闭后 DialogHost 渲染为 null（semSetup 真被关掉、不留残影）')
  }
  semSetDialog(null)
  renderDialog()
}

// ───────────────────────── ③ 其它错误码也译成人话（bad-mirror）——不是只针对 already-running 特判 ─────────────────────────
{
  postCalls.length = 0
  postImpl = async () => { throw Object.assign(new Error('bad mirror'), { response: { ok: false, reason: 'bad-mirror' } }) }
  let tree = openSemSetup()
  const downloadBtn = findButton(tree, '立即下载')
  if (downloadBtn) {
    downloadBtn.props.onClick()
    await tick(10)
    tree = renderDialog(); tree = renderDialog()
    const text = allText(tree)
    ok(text.indexOf('下载请求失败') >= 0, '★③：bad-mirror 同样弹出失败回执（不是只修一个错误码）')
    ok(text.indexOf('下载源参数不合法') >= 0, '★③：bad-mirror 译成人话「下载源参数不合法」（实际「' + text.replace(/\s+/g, ' ').slice(0, 180) + '…」）')
  }
  semSetDialog(null)
  renderDialog()
}

// ───────────────────────── ④ 源码守卫（守卫，非功能证据；功能证据在 ①/②/③ 真点击实测） ─────────────────────────
{
  const raw = readFileSync(CLIENT, 'utf8').replace(/\r\n/g, '\n')
  // 负守卫：旧写法（空 catch + 紧接 snooze）不得残留
  ok(!/apiPost\(API\.semanticDownload, \{ action: 'start', mirror: 'auto' \}\)\.catch\(function \(\) \{\}\)/.test(raw),
    '守卫（非功能证据）：模型下载调用点不再有空 catch')
  eq((raw.match(/semantic-download-failed:/g) || []).length, 1,
    '守卫（非功能证据）：失败回执 id 前缀语义化（semantic-download-failed）')
  eq((raw.match(/sdSnoozeOnce\(\)/g) || []).length, 2,
    '守卫（非功能证据）：成功/失败两分支都调 sdSnoozeOnce（先免打扰再关窗）')
  const frozenPath = path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen')
  const frozen = readFileSync(frozenPath, 'utf8').replace(/\r\n/g, '\n')
  ok(!/semanticDownload[^\n]*\.catch\(function \(\) \{\}\)/.test(frozen),
    '守卫（非功能证据）：冻结旧款面模型下载调用点同样无空 catch')
}

console.log('')
console.log('== a27-semdetect-download-receipt: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)