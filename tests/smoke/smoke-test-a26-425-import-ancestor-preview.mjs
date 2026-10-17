#!/usr/bin/env node
/**
 * [A26 · #425] 迁移包「预览」期必须如实报「祖先不可写」——不得再打「预览 ✓」。
 *
 * ★为什么必须新建本套件：缺陷形态是「预览只看 j.ok、plan.errors 一条不渲染」⇒ 任何
 *   「源码含 blockedByAncestor」的静态守卫在修复前后**都仍通过**（Lead 的修复恰好就用了这个名字）。
 *   按 CR-10 纪律：真执行 factory → 真渲染 → 真点「预览」→ 断言**渲染树节点文案** + 变异验证。
 *
 * ★被测面：**经典 StorageTab（lib/client.js:7502 首处 = 生成区外手写面）**。
 *   选它的理由：它是 v4 Iter5Storage 与冻结旧款面的生成源；且它用原始 fetch 读 /storage-manage、
 *   用 apiPost 发 /migrate-inspect，在 vm + 伪 React harness 下可完整渲染并真点击（无需原生选择器）。
 *   渲染路径：mount → fetch(storageManage) → 手填包路径 input.onChange → 点「预览」按钮 →
 *   apiPost(migrateInspect) 回夹具 → 计划面板 + migNote 重渲染。
 *
 * ★判据纪律：主判据=真渲染出的节点文本。源码文本计数仅作附带守卫，且断言文案显式标注
 *   「守卫，非功能证据」。负路径=①无阻塞夹具（对照，必须仍「✓」且无阻塞节点）
 *   ②变异副本（.diag-a2x/client-mutant-a26*.js，把 migBlockedN 回退成 0 / 去掉阻塞节点）必须红。
 *
 * ★已做的变异验证（隔离副本，仓库文件零改动；副本由 Buffer 原样复制 lib/client.js 后只改一处）：
 *   M1 client-mutant-a26-note.js        —— 三处 migBlockedN 全回退成 0（≡ 旧行为「只看 j.ok」）
 *                                         ⇒ 5 FAIL（migNote 又变成「预览 ✓ …」，且守卫计数 3→0）
 *   M2 client-mutant-a26-first-only.js  —— 只回退**经典面**那一处（另两面保留）
 *                                         ⇒ 5 FAIL（证明断言钉的就是被渲染的这一面，不是别面的字符串）
 *   M3 client-mutant-a26-node.js        —— 删掉经典面的 [data-dam-blocked-by-ancestor] 节点
 *                                         ⇒ 6 FAIL（证明「节点存在 + 文本含 path(ancestor:kind)」是承重的）
 *   三份副本均 crlf=19451 / lone-LF=0（行尾与源一致），node --check 通过。
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const CLIENT = process.env.DAM_A26_CLIENT || path.join(ROOT, 'lib', 'client.js')

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
let fetchImpl = () => { throw Error('Unexpected raw fetch') }
const context = vm.createContext({
  window, document, localStorage,
  console: { log() {}, warn() {}, info() {}, error() {} },
  navigator: { language: 'zh-CN' }, URL, URLSearchParams,
  requestAnimationFrame: fn => fn(), setTimeout, clearTimeout,
  setInterval: () => 1, clearInterval() {},
  fetch: (url, opts) => fetchImpl(url, opts),
})
vm.runInContext(source.replace('    return module.exports', `    exports._a26 = { StorageTab: StorageTab, t: t,
      transport: function (get, post) { apiGet = get; apiPost = post } }
    return module.exports`), context, { filename: CLIENT })
const test = exposed && exposed._a26
ok(!!test && typeof test.StorageTab === 'function', 'factory 真执行成功，经典 StorageTab 可调用（运行时守卫，非静态断言）')
const t = test.t

// ───────────────────────── 树工具（真渲染树，不读源码） ─────────────────────────
function nodes(tree, predicate, out = []) {
  if (!tree || typeof tree !== 'object') return out
  if (Array.isArray(tree)) { tree.forEach(x => nodes(x, predicate, out)); return out }
  if (predicate(tree)) out.push(tree)
  nodes(tree.props && tree.props.children, predicate, out)
  return out
}
// 组合组件（如 Iter5Notice）没有 children prop ⇒ 单独展平它们的输出才能读到 title/message 文案。
// 调用前后保存/还原 hook 槽，避免「读文案」污染被测组件的状态。
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
const findButton = (tree, label) => nodes(tree, n => n.type === 'button').find(n => flatText(n.props.children) === label)
const findInput = (tree, placeholder) => nodes(tree, n => n.type === 'input' && n.props && n.props.placeholder === placeholder)[0]
const findByKey = (tree, key) => nodes(tree, n => n.props && n.props.key === key)[0]
const blockedNodes = (tree) => nodes(tree, n => n.props && n.props['data-dam-blocked-by-ancestor'] !== undefined)

const tick = async (n = 8) => { for (let i = 0; i < n; i += 1) await new Promise(r => setTimeout(r, 0)) }
const flushErrors = []
function renderTab() {
  cursor = 0
  const tree = test.StorageTab({})
  const pending = effects
  effects = []
  pending.forEach(fn => { try { fn() } catch (e) { flushErrors.push(e) } })
  return tree
}
function resetUi() { states = []; effects = []; cursor = 0; flushErrors.length = 0 }

// ───────────────────────── 夹具（真实路由返回形状，见 lib/index.js:9719-9747） ─────────────────────────
const PACK = 'C:\\tmp\\x.dam-pack'
const storageFixture = { indexEnabled: true, counts: { ok: 0, total: 0, stale: 0, unrepairable: 0 }, sources: [], audit: [] }
const BLOCKED = {
  ok: true,
  previewToken: 'tok-425',
  plan: {
    ok: false,
    format: 'dam-pack/1',
    pathChanged: false,
    fromPath: 'C:\\ws\\a', toPath: 'C:\\ws\\b',
    fromSlug: 'a', toSlug: 'b',
    additions: [], overwrites: [],
    stats: { willWrite: 0 },
    rewrite: { totalHits: 0, fileCount: 0, files: [] },
    blockedByAncestor: [{ path: 'linkdir/PLAN.md', ancestor: 'linkdir', kind: 'link-outside' }],
    warnings: ['ancestor-blocked'],
    errors: ['ancestor-not-writable:linkdir/PLAN.md(linkdir:link-outside)'],
  },
}
const CLEAN = {
  ok: true,
  previewToken: 'tok-clean',
  plan: {
    ok: true,
    format: 'dam-pack/1',
    pathChanged: false,
    fromPath: 'C:\\ws\\a', toPath: 'C:\\ws\\b',
    fromSlug: 'a', toSlug: 'b',
    additions: [], overwrites: [],
    stats: { willWrite: 0 },
    rewrite: { totalHits: 0, fileCount: 0, files: [] },
    blockedByAncestor: [],
    warnings: ['same-path'],
    errors: [],
  },
}
let inspectFixture = null
let inspectCalls = []
fetchImpl = async (url) => {
  const u = String(url)
  if (u.indexOf('/storage-manage') >= 0) return { ok: true, json: async () => storageFixture }
  throw Error('Unexpected raw fetch: ' + u)
}
test.transport(
  async (url) => { throw Error('unexpected apiGet: ' + url) },
  async (url, payload) => {
    const u = String(url)
    if (u.indexOf('/migrate-inspect') >= 0) { inspectCalls.push({ url: u, payload }); return inspectFixture }
    throw Error('unexpected apiPost: ' + u)
  },
)

/** 挂载 → 等 /storage-manage 落定 → 手填包路径 → 点「预览」→ 等 apiPost 落定 → 返回最终渲染树 */
async function previewFlow(inspect) {
  inspectFixture = inspect
  inspectCalls = []
  resetUi()
  renderTab()                       // mount 帧：fetch 效果入队
  await tick(10)                    // 假 fetch 落定 → setData
  let tree = renderTab()            // 数据帧（迁移卡可见）
  const packInput = findInput(tree, t('migPickPack'))
  ok(!!packInput, '夹具自检：渲染树里找到包路径 input（placeholder=' + t('migPickPack') + '）')
  if (!packInput) return { tree, clicked: false }
  packInput.props.onChange({ target: { value: PACK } })
  tree = renderTab()                // 反映 migPack 状态
  const previewBtn = findButton(tree, t('migPreview'))
  ok(!!previewBtn, '夹具自检：渲染树里找到「' + t('migPreview') + '」按钮')
  if (!previewBtn) return { tree, clicked: false }
  previewBtn.props.onClick()        // 真点
  await tick(10)
  tree = renderTab()
  return { tree, clicked: true }
}

// ───────────────────────── ① 正路径：计划层报祖先不可写 ⇒ 预览不得打「✓」，且列出具体路径 ─────────────────────────
{
  const { tree, clicked } = await previewFlow(BLOCKED)
  ok(clicked, '夹具自检：预览按钮成功点击')
  eq(inspectCalls.length, 1, '★真点击确实发出了 /migrate-inspect 请求（api 参数可核对）')
  ok(inspectCalls[0] && inspectCalls[0].payload && inspectCalls[0].payload.packPath === PACK,
    '★真点击携带手填的包路径 packPath=' + PACK)
  const blocked = blockedNodes(tree)
  ok(blocked.length === 1, '★正路径：计划面板渲染出 [data-dam-blocked-by-ancestor] 节点（实际 ' + blocked.length + '）')
  const blockedText = blocked.map(n => flatText(n.props.children)).join(' | ')
  ok(blockedText.indexOf('linkdir/PLAN.md') >= 0, '★正路径：阻塞清单列出具体路径 linkdir/PLAN.md（实际「' + blockedText + '」）')
  ok(blockedText.indexOf('link-outside') >= 0, '★正路径：阻塞原因 kind=link-outside 可见（不是只有裸码 warnings）')
  ok(blockedText.indexOf('linkdir:link-outside') >= 0, '★正路径：按 path(ancestor:kind) 形态给出祖先与原因')
  const note = findByKey(tree, 'mnote')
  ok(!!note, '夹具自检：migNote 节点在场（key=mnote）')
  const noteText = note ? flatText(note.props.children) : ''
  ok(noteText.indexOf('✓') < 0, '★正路径：有阻塞时 migNote **不含**「✓」（修复前恒为「预览 ✓ …」；实际「' + noteText + '」）')
  ok(noteText.indexOf('不可写') >= 0, '★正路径：migNote 明确说「不可写」（实际「' + noteText + '」）')
  ok(noteText.indexOf('导入会被拒绝') >= 0, '★正路径：migNote 预告「导入会被拒绝」')
}

// ───────────────────────── ② 负路径（对照）：无阻塞 ⇒ 仍「✓」且不出现阻塞节点（防误报） ─────────────────────────
{
  const { tree, clicked } = await previewFlow(CLEAN)
  ok(clicked, '负路径②：无阻塞夹具下预览按钮同样成功点击')
  eq(blockedNodes(tree).length, 0, '★负路径②：无阻塞时**不**渲染 [data-dam-blocked-by-ancestor] 节点（防误报）')
  const note = findByKey(tree, 'mnote')
  const noteText = note ? flatText(note.props.children) : ''
  ok(noteText.indexOf('✓') >= 0, '★负路径②：无阻塞时 migNote 仍为「预览 ✓ …」（实际「' + noteText + '」）')
  ok(noteText.indexOf('不可写') < 0, '★负路径②：无阻塞时 migNote 不出现「不可写」')
}

// ───────────────────────── ③ 计划层多条阻塞路径全部列出（不是只报第一条） ─────────────────────────
{
  const { tree } = await previewFlow({
    ok: true,
    previewToken: 'tok-2',
    plan: {
      ok: false, pathChanged: false, fromPath: 'C:\\ws\\a', toPath: 'C:\\ws\\b', fromSlug: 'a', toSlug: 'b',
      additions: [], overwrites: [], stats: { willWrite: 0 }, rewrite: { totalHits: 0, fileCount: 0, files: [] },
      blockedByAncestor: [
        { path: 'linkdir/PLAN.md', ancestor: 'linkdir', kind: 'link-outside' },
        { path: 'weirddir/x.md', ancestor: 'weirddir', kind: 'unsupported' },
      ],
      warnings: ['ancestor-blocked'], errors: ['ancestor-not-writable:linkdir/PLAN.md(linkdir:link-outside)'],
    },
  })
  const blockedText = blockedNodes(tree).map(n => flatText(n.props.children)).join(' | ')
  ok(blockedText.indexOf('linkdir/PLAN.md') >= 0 && blockedText.indexOf('weirddir/x.md') >= 0,
    '★③：多条阻塞路径全部列出（linkdir/PLAN.md + weirddir/x.md；实际「' + blockedText + '」）')
  const note = findByKey(tree, 'mnote')
  const noteText = note ? flatText(note.props.children) : ''
  ok(noteText.indexOf('2') >= 0 && noteText.indexOf('不可写') >= 0, '★③：migNote 报出条数 2 且说明不可写（实际「' + noteText + '」）')
}

// ───────────────────────── ④ 源码守卫（守卫，非功能证据；功能证据在 ①/②/③ 真渲染） ─────────────────────────
{
  const raw = readFileSync(CLIENT, 'utf8').replace(/\r\n/g, '\n')
  eq((raw.match(/var migBlockedN = Array\.isArray\(p\.blockedByAncestor\) \? p\.blockedByAncestor\.length : 0/g) || []).length, 3,
    '守卫（非功能证据）：client.js 三面（经典 + legacy 镜像 + v4）都有 migBlockedN 计划层判据')
  eq((raw.match(/'data-dam-blocked-by-ancestor': ''/g) || []).length, 3,
    '守卫（非功能证据）：client.js 三面都渲染阻塞清单节点')
  const frozenPath = path.join(ROOT, 'skins', 'legacy', 'iter5-325.js.frozen')
  const frozen = readFileSync(frozenPath, 'utf8').replace(/\r\n/g, '\n')
  eq((frozen.match(/var migBlockedN = Array\.isArray\(p\.blockedByAncestor\)/g) || []).length, 1,
    '守卫（非功能证据）：冻结旧款面 migBlockedN 在场（该面无重建通道）')
  eq((frozen.match(/'data-dam-blocked-by-ancestor': ''/g) || []).length, 1,
    '守卫（非功能证据）：冻结旧款面阻塞清单节点在场')
  const nativeStoragePath = path.join(ROOT, 'skins', 'iter5', 'native-storage.js')
  if (existsSync(nativeStoragePath)) {
    const ns = readFileSync(nativeStoragePath, 'utf8').replace(/\r\n/g, '\n')
    eq((ns.match(/'data-dam-blocked-by-ancestor': ''/g) || []).length, 1,
      '守卫（非功能证据）：v4 Iter5Migration 生成源渲染阻塞清单节点')
  }
}

console.log('')
console.log('== a26-425-import-ancestor-preview: PASS ' + pass + ' / FAIL ' + fail + ' ==')
if (fail) process.exit(1)