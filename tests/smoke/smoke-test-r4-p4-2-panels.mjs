/**
 * R4 P4-2 验收：legacy / graph / iter5 面板与已打开文档 revision 更新。
 *
 * 判据来源：docs/internal/PROTOCOL-R4-20261110.md §5「legacy 面板 / iter5 面板」两行 +
 *           docs/internal/PROMPT-R4-P4-2-IMPL-20261111.md §5。
 *
 * 断言形态（本套件全部是**真执行**，不是源码字符串守卫）：
 *   A. 后端：真 apply 出 MemoryEngine → 真调 handoffPanelData / fileQ → 断言返回载荷与错误码；
 *      隔离夹具（artifacts/_r4-p4-2-fixtures）内用真 LedgerDocumentStore 造文档。
 *   B. 前端 classic PlanTab：从 lib/client.js 抽出函数源码，在 vm 里配最小 React 钩子运行时
 *      真渲染（真调用组件函数 → 得到元素树 → 真点按钮 → 真跑 useEffect → 真读 apiGet 调用）。
 *   C. 前端 iter5 Iter5Handoff：同法从 client.js 抽出（legacy 生成块）+ useIter5Data。
 *   D. 隔离变异：backend 变异落到 artifacts/_r4-p4-2-mutations/<name>/lib/index.js，用
 *      DAM_AUDIT_ENGINE_SOURCE 由 audit-engine 从副本加载（不就地改共享 lib/）；
 *      frontend 变异只改内存里的函数源码（不落盘）。每个变异必须红、clean 必须绿。
 */
import * as fs from 'node:fs/promises'
import * as nodeFs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PROBE = process.env.R4_P42_PROBE === '1'
const fixtureRoot = path.join(ROOT, 'artifacts', '_r4-p4-2-fixtures')
const mutationRoot = path.join(ROOT, 'artifacts', '_r4-p4-2-mutations')

const EVENT_ID = 'evt_c1d2e3f4'
const DOC_ID = 'r4p42-panel-261111-0001'
let pass = 0
let fail = 0
const failures = []
async function test(name, action) {
  try { const detail = await action(); pass++; console.log('  ok   - ' + name + (detail ? ' :: ' + detail : '')) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : error)) }
}
const eq = (actual, expected, label) => { if (actual !== expected) throw new Error(label + '：期望 ' + JSON.stringify(expected) + '，实得 ' + JSON.stringify(actual)) }
const ok = (claim, label) => { if (!claim) throw new Error(label || '断言失败') }

/* ───────────────────────── 夹具 ───────────────────────── */
const nowBase = Date.UTC(2026, 10, 11, 4, 0, 0)
async function resetFixture(name) {
  const root = path.join(fixtureRoot, name)
  ok(root.startsWith(fixtureRoot + path.sep), '夹具必须落在 artifacts 内')
  await fs.rm(root, { recursive: true, force: true })
  const handoffDir = path.join(root, 'handoff')
  await fs.mkdir(path.join(handoffDir, 'documents'), { recursive: true })
  await fs.writeFile(path.join(handoffDir, 'event-store.json'), JSON.stringify({ events: [{ id: EVENT_ID, status: 'active', checkpoints: [{ at: nowBase, kind: 'wal-committed', documentId: DOC_ID }] }], appliedOps: {} }))
  await fs.writeFile(path.join(handoffDir, 'handoff-20261111-120000.md'), '# Synthetic legacy ledger\n')
  await fs.writeFile(path.join(handoffDir, 'PLAN.md'), '# Synthetic plan\n')
  const { LedgerDocumentStore } = await import('../../lib/ledger-doc/index.js')
  const store = new LedgerDocumentStore(path.join(handoffDir, 'documents'), { eventsPath: path.join(handoffDir, 'event-store.json'), now: () => new Date(nowBase).toISOString() })
  const created = await store.createDocument({ documentId: DOC_ID, title: 'Synthetic maintenance document', eventIds: [EVENT_ID], content: 'first synthetic body' })
  ok(created.ok === true, '夹具文档创建失败: ' + JSON.stringify(created))
  return { root, handoffDir, documentsDir: store.rootDir, store, document: created }
}
function PATHS(f) {
  return {
    ws: f.root, wsBound: true, projectDir: f.root, handoffDir: f.handoffDir,
    planPath: path.join(f.handoffDir, 'PLAN.md'), notesPath: path.join(f.root, 'MEMORY.md'),
    userFile: path.join(f.root, 'USER.md'), logPath: path.join(f.root, 'logs'),
    reflectDir: path.join(f.root, 'reflections'), userDir: path.join(f.root, 'user'),
    greetPath: path.join(f.root, 'greeting.md'), greetPathLegacy: path.join(f.root, 'greeting-old.md'), calendarPath: path.join(f.root, 'calendar.md'),
  }
}
async function makeEngine(f, overrides) {
  const { apply, MemoryEngine } = await import('../lib/audit-engine.mjs')
  let engine = null
  const original = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return original.call(this) }
  const ctx = { effect() {}, get() { return undefined }, on() { return () => {} }, config: {}, root: fixtureRoot, tools: { register() { return () => {} } }, webServer: { register() { return () => {} } }, systemPrompt: { context() { return () => {} }, section() { return () => {} } } }
  try { apply(ctx) } finally { MemoryEngine.prototype.loadConfigSync = original }
  ok(engine, '真 apply 必须构造出 MemoryEngine')
  engine.config = Object.assign({}, engine.config, { handoffEnabled: true, boardMode: 'graph', ledgerDocEnabled: true }, overrides || {})
  engine.configLoaded = true
  engine.loadConfig = async () => {}
  engine.loadConfigSync = () => {}
  engine.resolvePaths = async () => PATHS(f)
  engine.resolvePathsForSession = async () => PATHS(f)
  return engine
}

/* ───────────────── 最小 React 钩子运行时（真渲染用） ───────────────── */
function makeReact() {
  const st = []; const rf = []; const dp = []; let idx = 0; let dirty = false; let pending = []
  return {
    useState(init) { const i = idx++; if (!(i in st)) st[i] = typeof init === 'function' ? init() : init; return [st[i], (v) => { st[i] = typeof v === 'function' ? v(st[i]) : v; dirty = true }] },
    useEffect(fn, deps) {
      const i = idx++
      const prev = dp[i]
      const changed = !prev || !deps || deps.length !== prev.length || deps.some((d, k) => !Object.is(d, prev[k]))
      if (changed) { dp[i] = deps ? deps.slice() : null; pending.push(fn) }
    },
    useRef(v) { const i = idx++; if (!(i in rf)) rf[i] = { current: v }; return rf[i] },
    isDirty() { return dirty },
    clearDirty() { dirty = false },
    takePending() { const p = pending; pending = []; return p },
    beginRender() { idx = 0 },
  }
}
function makeH() {
  return function h(type, props) {
    const children = []
    for (let i = 2; i < arguments.length; i += 1) {
      const c = arguments[i]
      if (Array.isArray(c)) { for (const x of c) if (x !== null && x !== undefined && x !== false) children.push(x) }
      else if (c !== null && c !== undefined && c !== false) children.push(c)
    }
    return { type: typeof type === 'string' ? type : (type && (type.name || 'Component')), props: props || {}, children }
  }
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const c of node.children || []) walk(c, visit)
}
function findAll(tree, pred) { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n) }); return out }
function textOf(tree) {
  let s = ''
  const collect = (node) => {
    if (!node || typeof node !== 'object') return
    for (const c of node.children || []) { if (typeof c === 'string') s += c + '\n'; else collect(c) }
  }
  collect(tree)
  return s
}
function mount(react, fn, props) {
  const comp = {
    props,
    tree: null,
    setProps(next) { comp.props = Object.assign({}, comp.props, next); react.clearDirty(); comp.render() },
    render() { react.beginRender(); comp.tree = fn(comp.props); return comp.tree },
    flush() {
      for (let guard = 0; guard < 12; guard += 1) {
        const effects = react.takePending()
        if (effects.length) for (const eff of effects) eff()
        if (!react.isDirty() && !effects.length) break
        react.clearDirty()
        comp.render()
      }
      return comp.tree
    },
  }
  comp.render()
  return comp
}
const BACKTICK = String.fromCharCode(96)
/**
 * 抽函数：先按「下一个同缩进 function 声明」定界（正则字面量里的花括号会骗过朴素括号扫描，
 * 实测把后续 Iter5Document 等函数一起吞进来 ⇒ 沙箱里出现真实的第二个实现，断言失真），
 * 找不到边界才回落括号扫描。
 */
function extractFunction(source, name) {
  const sig = 'function ' + name + '('
  // 只认行首的真实函数声明；注释里引用签名不算第二定义。
  const declaration = new RegExp('(^|\n)([ \t]*)' + sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const matches = [...source.matchAll(declaration)]
  if (!matches.length) throw new Error('函数未找到: ' + name)
  if (matches.length > 1) throw new Error('函数名不唯一: ' + name)
  const start = matches[0].index + matches[0][1].length
  const rest = source.slice(start + sig.length)
  const lineStart = source.lastIndexOf(String.fromCharCode(10), start) + 1
  const indent = source.slice(lineStart, start)
  const boundary = new RegExp(String.fromCharCode(10) + indent + 'function [A-Za-z0-9_$]+\\(').exec(rest)
  if (boundary && boundary.index > 0) return source.slice(start, start + sig.length + boundary.index)
  let i = source.indexOf('{', start)
  let depth = 0
  let inS = null; let inD = false; let inLC = false; let inBC = false; let esc = false
  for (; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (inLC) { if (ch === '\n') inLC = false; continue }
    if (inBC) { if (ch === '*' && next === '/') { inBC = false; i += 1 } continue }
    if (inS) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === inS) inS = null; continue }
    if (inD) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === BACKTICK) inD = false; continue }
    if (ch === '/' && next === '/') { inLC = true; i += 1; continue }
    if (ch === '/' && next === '*') { inBC = true; i += 1; continue }
    if (ch === '"' || ch === "'") { inS = ch; continue }
    if (ch === BACKTICK) { inD = true; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth === 0) return source.slice(start, i + 1) }
  }
  throw new Error('函数体未闭合: ' + name)
}

/* ───────────────────────── A. 后端真执行 ───────────────────────── */
async function backendProbe() {
  const fixture = await resetFixture('probe')
  const graphOn = await makeEngine(fixture, { ledgerDocEnabled: true, boardMode: 'graph' })
  let checks = 0
  const bump = () => { checks += 1 }
  // A1 graph + R4 on：独立清单（documentId / revision / eventIds / 相对路径）
  const panel = await graphOn.handoffPanelData('', 'synthetic-session')
  const docs = panel.maintenanceDocuments
  ok(Array.isArray(docs) && docs.length === 1, 'graph 面板维护文档数应为 1，实得 ' + JSON.stringify(docs && docs.length)); bump()
  eq(docs[0].documentId, DOC_ID, 'documentId'); bump()
  eq(docs[0].relativePath, 'documents/' + DOC_ID + '.md', 'relativePath 口径'); bump()
  ok(/^sha256:[0-9a-f]{64}$/.test(docs[0].revision), 'revision 形状: ' + docs[0].revision); bump()
  ok(Array.isArray(docs[0].eventIds) && docs[0].eventIds[0] === EVENT_ID, 'eventIds'); bump()
  ok(!Array.isArray(panel.ledgers) || panel.ledgers.every((x) => !String(x.name).startsWith('documents/')), '维护文档不得混进旧 ledgers'); bump()
  // A2 fileQ 合法读取 + 磁盘重算 revision
  const read1 = await graphOn.handoffPanelData('documents/' + DOC_ID + '.md', 'synthetic-session')
  ok(String(read1.text || '').includes('first synthetic body'), 'fileQ 正文'); bump()
  eq(read1.revision, docs[0].revision, 'fileQ revision 与清单一致（磁盘重算）'); bump()
  eq(read1.documentId, DOC_ID, 'fileQ documentId'); bump()
  // A3 外部改内容 ⇒ revision 变
  const current = await fixture.store.readDocument(DOC_ID)
  const updated = await fixture.store.updateDocument({ documentId: DOC_ID, expectedRevision: current.revision, eventIds: [EVENT_ID], changeSet: [{ regionId: 'content', beforeText: current.content, afterText: 'second synthetic body' }] })
  ok(updated.ok === true, '外部更新失败: ' + JSON.stringify(updated)); bump()
  const panel2 = await graphOn.handoffPanelData('', 'synthetic-session')
  ok(panel2.maintenanceDocuments[0].revision !== docs[0].revision, 'revision 必须随内容变化'); bump()
  const read2 = await graphOn.handoffPanelData('documents/' + DOC_ID + '.md', 'synthetic-session')
  eq(read2.revision, panel2.maintenanceDocuments[0].revision, 'fileQ 必须重算到新 revision'); bump()
  ok(String(read2.text || '').includes('second synthetic body'), 'fileQ 必须返回新正文'); bump()
  // A4 非法 ID / 路径 / 不存在的合法 ID
  eq((await graphOn.handoffPanelData('documents/PLAN.md', 'synthetic-session')).error, 'bad file name', '非白名单名 ⇒ bad file name'); bump()
  eq((await graphOn.handoffPanelData('documents/../PLAN.md', 'synthetic-session')).error, 'bad file name', '越界相对路径 ⇒ bad file name'); bump()
  eq((await graphOn.handoffPanelData('documents/BAD-ID.md', 'synthetic-session')).error, 'bad file name', '非法 documentId 形状 ⇒ bad file name'); bump()
  eq((await graphOn.handoffPanelData('documents/absent-261111-0002.md', 'synthetic-session')).error, 'document-not-found', '不存在 ⇒ document-not-found'); bump()
  // A5 读失败与未命中分开：篡改 revision 行 ⇒ document-revision-mismatch
  const docPath = path.join(fixture.documentsDir, DOC_ID + '.md')
  const original = await fs.readFile(docPath, 'utf8')
  const tamperedText = original.replace(/^revision: sha256:[0-9a-f]{64}$/m, 'revision: sha256:' + '0'.repeat(64))
  ok(tamperedText !== original, 'revision 行必须被真的替换（否则负路径无效）'); bump()
  await fs.writeFile(docPath, tamperedText, 'utf8')
  const tampered = await graphOn.handoffPanelData('documents/' + DOC_ID + '.md', 'synthetic-session')
  eq(tampered.error, 'document-revision-mismatch', '读失败必须与未命中分开（实得 ' + tampered.error + '）'); bump()
  await fs.writeFile(docPath, original, 'utf8')
  // A6 越界 symlink/junction ⇒ path outside memory tree
  const outside = path.join(fixtureRoot, 'outside-secret.md')
  await fs.writeFile(outside, 'OUTSIDE-SECRET\n', 'utf8')
  const linkPath = path.join(fixture.documentsDir, 'link-261111-0003.md')
  let junctionOk = false
  try { await fs.symlink(outside, linkPath, 'junction'); junctionOk = true } catch (error) { if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error }
  if (junctionOk) {
    const linked = await graphOn.handoffPanelData('documents/link-261111-0003.md', 'synthetic-session')
    eq(linked.error, 'path outside memory tree', '越界链接必须拒绝（实得 ' + JSON.stringify(linked.error) + '）'); bump()
    ok(!JSON.stringify(linked).includes('OUTSIDE-SECRET'), '越界响应不得泄露树外内容'); bump()
  }
  // A7 legacy（非 graph）同样能读维护文档，且仍返回 legacy-mode
  const legacyOn = await makeEngine(fixture, { ledgerDocEnabled: true, boardMode: 'legacy' })
  const legacyPanel = await legacyOn.handoffPanelData('', 'synthetic-session')
  eq(legacyPanel.enabled, false, 'legacy 面板 enabled:false'); bump()
  eq(legacyPanel.reason, 'legacy-mode', 'legacy 面板 reason 必须保持 legacy-mode'); bump()
  ok(Array.isArray(legacyPanel.maintenanceDocuments) && legacyPanel.maintenanceDocuments.length === 1, 'legacy 必须也列出维护文档'); bump()
  const legacyRead = await legacyOn.handoffPanelData('documents/' + DOC_ID + '.md', 'synthetic-session')
  eq(legacyRead.documentId, DOC_ID, 'legacy fileQ 也能读维护文档'); bump()
  // A8 R4 关闭 ⇒ 返回形状等于旧行为
  const off = await makeEngine(fixture, { ledgerDocEnabled: false, boardMode: 'legacy' })
  const offPanel = await off.handoffPanelData('', 'synthetic-session')
  eq(JSON.stringify(offPanel), JSON.stringify({ enabled: false, reason: 'legacy-mode' }), 'R4 关闭时 legacy 返回必须逐字节等于旧形状'); bump()
  const offGraph = await makeEngine(fixture, { ledgerDocEnabled: false, boardMode: 'graph' })
  const offGraphPanel = await offGraph.handoffPanelData('', 'synthetic-session')
  ok(!('maintenanceDocuments' in offGraphPanel), 'R4 关闭时 graph 不得新增 maintenanceDocuments 键'); bump()
  ok(!('ledgerDocumentsEnabled' in offGraphPanel), 'R4 关闭时 graph 不得新增 ledgerDocumentsEnabled 键'); bump()
  eq((await offGraph.handoffPanelData('documents/' + DOC_ID + '.md', 'synthetic-session')).error, 'bad file name', 'R4 关闭时 documents/* 仍落旧白名单（bad file name）'); bump()
  return 'checks=' + checks
}

/* ─────────────── B/C. 前端真渲染（classic PlanTab / iter5 Iter5Handoff） ─────────────── */
const CLIENT = nodeFs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').split('\r\n').join('\n')
function buildFrontendWorld(env) {
  const calls = []
  const ctx = {
    h: makeH(),
    locale: 'zh',
    t: (key) => (env.i18n && env.i18n[key]) || key,
    L: (zh, en) => (env.locale === 'en' ? en : zh),
    API: { handoffState: '/handoff-state', config: '/config', eventUnarchived: '/event-unarchived' },
    currentSessionIdClient: () => env.sessionId,
    iter5Identity: () => 'identity-' + env.sessionId,
    pathName: (p) => String(p || '').split(/[\\/]/).pop(),
    iter5LedgerTitle: (name) => 'title:' + name,
    sessions: { list: { subscribe: (fn) => { env.sessionListener = fn; return () => {} } } },
    saveConfigPatch: () => {},
    configOf: (d) => (d && d.config) || {},
    runContinueFlow: async () => ({ ok: true }),
    autoState: { cdIv: null },
    AutoContinueHost: null,
  }
  const react = makeReact()
  ctx.useState = react.useState
  ctx.useEffect = react.useEffect
  ctx.useRef = react.useRef
  const sandbox = vm.createContext(ctx)
  vm.runInContext([
    'function Card(p){return h("Card",{title:p.title},p.children)}',
    'function Loading(){return h("Loading",null)}',
    'function Iter5Card(p){return h("Iter5Card",{className:p.className},p.children)}',
    'function Iter5Icon(p){return h("Iter5Icon",{name:p.name})}',
    'function Iter5Document(p){return h("Iter5Document",null,p.text)}',
    'function Iter5Empty(p){return h("Iter5Empty",{slot:p.slot},p.title)}',
    'function Iter5Error(p){return h("Iter5Error",null,p.error)}',
    // legacy Iter5Handoff 的「完整白板看板」details 区确实渲染 h(PlanTab)（既有实现，非本批引入）
    'function PlanTab(){return h("PlanTab",null)}',
  ].join('\n'), sandbox)
  return { ctx, react, calls, sandbox }
}
function installApiGet(world, env, opt) {
  const options = opt || {}
  world.ctx.apiGet = (api, params) => {
    const call = { api, params }
    world.calls.push(call)
    call.promise = new Promise((resolve, reject) => { call.resolve = (v) => { call.settled = true; resolve(v) }; call.reject = (e) => { call.settled = true; reject(e) } })
    if (!params || (params.file === undefined && params.sessionId !== undefined && options.autoResolvePanels !== false)) call.resolve(env.panel)
    if (!params) call.resolve(env.panel)
    return call.promise
  }
  return world
}
function docCalls(world) { return world.calls.filter((c) => c.params && String(c.params.file || '').startsWith('documents/')) }
/** flush 只跑同步 effect；promise 的 .then 是微任务 ⇒ 每个回合后再让出一次事件循环。 */
async function pump(comp, rounds) {
  const n = rounds || 8
  for (let i = 0; i < n; i += 1) {
    comp.flush()
    await new Promise((resolve) => setImmediate(resolve))
  }
  return comp.tree
}
function legacyBlockOf(clientText) {
  const begin = '    // ===== ITER5-LEGACY-GENERATED:BEGIN ====='
  const end = '    // ===== ITER5-LEGACY-GENERATED:END ====='
  const i = clientText.indexOf(begin)
  const j = clientText.indexOf(end)
  if (i < 0 || j < 0 || j < i) throw new Error('legacy 生成块标记缺失')
  return clientText.slice(i, j + end.length)
}
function panelData(docs) {
  return { enabled: true, ws: '/synthetic', wsBound: true, plan: '# SYNTH PLAN', planPath: '/p/PLAN.md', planMtime: 1, planVersions: [], ledgers: [], waterLevel: {}, boardMode: 'graph', maintenanceDocuments: docs }
}
function docEntry(id, rev) { return { documentId: id, revision: 'sha256:' + rev.repeat(64), eventIds: [EVENT_ID], relativePath: 'documents/' + id + '.md' } }

async function frontendClassic() {
  const env = { sessionId: 'session-a', locale: 'zh', i18n: { planMaintenanceDocs: '维护文档', planMaintenanceEmpty: '(该工作区还没有维护文档)', planMaintenanceRevShort: '版本 ' } }
  const world = installApiGet(buildFrontendWorld(env), env)
  const body = extractFunction(CLIENT, 'PlanTab')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'a'), docEntry('doc-b-261111-0002', 'b')])
  const comp = mount(world.react, vm.runInContext(body + '\nPlanTab', world.sandbox), {})
  await pump(comp)
  let tree = comp.tree
  const buttons = findAll(tree, (n) => n.props && n.props['data-dam-mdoc'])
  eq(buttons.length, 2, 'classic 必须渲染 2 个维护文档按钮')
  eq(findAll(tree, (n) => n.type === 'Card' && String(n.props.title || '').includes('维护文档')).length, 1, '必须有独立的维护文档分组卡')
  eq(docCalls(world).length, 0, '未点击前不得预取正文')
  buttons[0].props.onClick()
  await pump(comp)
  eq(docCalls(world).length, 1, '点击后必须发起一次 fileQ')
  eq(docCalls(world)[0].params.file, 'documents/doc-a-261111-0001.md', 'fileQ 路径口径')
  eq(docCalls(world)[0].params.sessionId, 'session-a', 'fileQ 必须绑定会话')
  docCalls(world)[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'a').revision, text: 'DOC-A BODY ONE' })
  await pump(comp)
  ok(textOf(comp.tree).includes('DOC-A BODY ONE'), 'classic 正文必须显示')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'a'), docEntry('doc-b-261111-0002', 'b')])
  comp.setProps({ nonce: 2 })
  await pump(comp)
  eq(docCalls(world).length, 1, 'classic revision 未变 ⇒ 不得重复拉取')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'c')])
  let before = world.calls.length
  comp.setProps({ nonce: 3 })
  await pump(comp)
  const revCalls = world.calls.slice(before).filter((c) => c.params && String(c.params.file || '').startsWith('documents/'))
  eq(revCalls.length, 1, 'classic revision 变了 ⇒ 必须重取一次')
  revCalls[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'c').revision, text: 'DOC-A BODY REV-C' })
  await pump(comp)
  ok(textOf(comp.tree).includes('DOC-A BODY REV-C'), 'classic revision 失效后必须显示新正文')
  ok(!textOf(comp.tree).includes('DOC-A BODY ONE'), '旧正文不得残留')
  // 旧请求不得覆盖新 revision：D 请求挂起 → E 请求 → 先解析 E 再解析 D
  env.panel = panelData([docEntry('doc-a-261111-0001', 'd')])
  before = world.calls.length
  comp.setProps({ nonce: 4 })
  await pump(comp)
  const dCall = world.calls.slice(before).filter((c) => c.params && String(c.params.file || '').startsWith('documents/')).at(-1)
  eq(!!dCall, true, 'D 请求必须发出')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'e')])
  before = world.calls.length
  comp.setProps({ nonce: 5 })
  await pump(comp)
  const eCall = world.calls.slice(before).filter((c) => c.params && String(c.params.file || '').startsWith('documents/')).at(-1)
  eq(!!eCall, true, 'E 请求必须发出')
  eCall.resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'e').revision, text: 'DOC-A BODY REV-E' })
  await pump(comp)
  dCall.resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'd').revision, text: 'STALE-REV-D' })
  await pump(comp)
  ok(textOf(comp.tree).includes('DOC-A BODY REV-E'), '新 revision 正文必须保留')
  ok(!textOf(comp.tree).includes('STALE-REV-D'), '旧 revision 迟到响应不得覆盖')
  // 切会话 ⇒ 重绑新 sessionId；旧会话迟到响应不得覆盖
  env.panel = panelData([docEntry('doc-a-261111-0001', 'e')])
  before = world.calls.length
  env.sessionId = 'session-b'
  if (env.sessionListener) env.sessionListener()
  await pump(comp)
  const switched = world.calls.slice(before).filter((c) => c.params && String(c.params.file || '').startsWith('documents/'))
  eq(switched.length, 1, '切会话后必须为新会话重取一次')
  eq(switched[0].params.sessionId, 'session-b', '重取必须绑定新会话')
  switched[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'e').revision, text: 'SESSION-B BODY' })
  await pump(comp)
  ok(textOf(comp.tree).includes('SESSION-B BODY'), '新会话正文必须显示')
  return 'classic fileQ 请求数=' + docCalls(world).length
}

async function frontendIter5() {
  const env = { sessionId: 'session-a', locale: 'zh' }
  const world = installApiGet(buildFrontendWorld(env), env)
  const legacy = legacyBlockOf(CLIENT)
  const useData = extractFunction(legacy, 'useIter5Data')
  const handoff = extractFunction(legacy, 'Iter5Handoff')
  vm.runInContext(useData + '\n' + handoff, world.sandbox)
  const fn = world.sandbox.Iter5Handoff
  ok(typeof fn === 'function', 'iter5 抽取的函数必须可调用')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'a')])
  const comp = mount(world.react, fn, { nonce: 1 })
  await pump(comp)
  const group = findAll(comp.tree, (n) => n.props && n.props['data-i5-mdoc-group'])
  eq(group.length, 1, 'iter5 必须有独立分组容器')
  const buttons = findAll(comp.tree, (n) => n.props && n.props['data-i5-mdoc'])
  eq(buttons.length, 1, 'iter5 必须渲染维护文档按钮')
  eq(docCalls(world).length, 0, 'iter5 未点击前不得预取')
  buttons[0].props.onClick()
  await pump(comp)
  eq(docCalls(world).length, 1, 'iter5 点击后必须发起 fileQ')
  eq(docCalls(world)[0].params.file, 'documents/doc-a-261111-0001.md', 'iter5 fileQ 路径')
  docCalls(world)[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'a').revision, text: 'ITER5 DOC A BODY' })
  await pump(comp)
  ok(/16 字符/.test(textOf(comp.tree)), 'iter5 正文必须显示（渲染层字符数 = 正文长度 16）')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'a')])
  comp.setProps({ nonce: 2 })
  await pump(comp)
  eq(docCalls(world).length, 1, 'iter5 revision 未变 ⇒ 不重取')
  env.panel = panelData([docEntry('doc-a-261111-0001', 'e')])
  const before = world.calls.length
  comp.setProps({ nonce: 3 })
  await pump(comp)
  const revCalls = world.calls.slice(before).filter((c) => c.params && String(c.params.file || '').startsWith('documents/'))
  eq(revCalls.length, 1, 'iter5 revision 变 ⇒ 重取')
  revCalls[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'e').revision, text: 'ITER5 REV-E' })
  await pump(comp)
  ok(/11 字符/.test(textOf(comp.tree)), 'iter5 必须显示新 revision 正文（字符数 = 11）')
  docCalls(world)[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'a').revision, text: 'STALE-ITER5-A' })
  await pump(comp)
  ok(!/13 字符/.test(textOf(comp.tree)), 'iter5 旧 revision（13 字符）迟到响应不得覆盖')
  ok(/11 字符/.test(textOf(comp.tree)), 'iter5 新正文（11 字符）必须保留')
  return 'iter5 fileQ 请求数=' + docCalls(world).length
}

/* ───────────────────────── D. 隔离变异 ───────────────────────── */
const selfFile = fileURLToPath(import.meta.url)
function runProbe(sourcePath) {
  return spawnSync(process.execPath, [selfFile], { env: Object.assign({}, process.env, { R4_P42_PROBE: '1', DAM_AUDIT_ENGINE_SOURCE: sourcePath, DSH_HOME: path.join(mutationRoot, 'child-home') }), encoding: 'utf8', timeout: 180000, maxBuffer: 8 * 1024 * 1024 })
}
async function frontendClassicReengen(planTabBody) {
  const env = { sessionId: 'session-a', locale: 'zh', i18n: { planMaintenanceDocs: '维护文档', planMaintenanceEmpty: '(该工作区还没有维护文档)', planMaintenanceRevShort: '版本 ' } }
  const world = installApiGet(buildFrontendWorld(env), env)
  env.panel = panelData([docEntry('doc-a-261111-0001', 'a')])
  const comp = mount(world.react, vm.runInContext(planTabBody + '\nPlanTab', world.sandbox), {})
  await pump(comp)
  const buttons = findAll(comp.tree, (n) => n.props && n.props['data-dam-mdoc'])
  eq(buttons.length, 1, '变异基线：必须仍渲染维护文档按钮')
  buttons[0].props.onClick()
  await pump(comp)
  eq(docCalls(world).length, 1, '变异基线：首取一次')
  docCalls(world)[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'a').revision, text: 'A' })
  await pump(comp)
  env.panel = panelData([docEntry('doc-a-261111-0001', 'f')])
  comp.setProps({ nonce: 2 })
  await pump(comp)
  if (docCalls(world).length < 2) throw new Error('revision 变了但没有重取')
}
async function frontendClassicStale(planTabBody) {
  const env = { sessionId: 'session-a', locale: 'zh', i18n: { planMaintenanceDocs: '维护文档', planMaintenanceEmpty: '(该工作区还没有维护文档)', planMaintenanceRevShort: '版本 ' } }
  const world = installApiGet(buildFrontendWorld(env), env)
  env.panel = panelData([docEntry('doc-a-261111-0001', 'd')])
  const comp = mount(world.react, vm.runInContext(planTabBody + '\nPlanTab', world.sandbox), {})
  await pump(comp)
  const buttons = findAll(comp.tree, (n) => n.props && n.props['data-dam-mdoc'])
  buttons[0].props.onClick()
  await pump(comp)
  const dCall = docCalls(world).at(-1)
  env.panel = panelData([docEntry('doc-a-261111-0001', 'e')])
  comp.setProps({ nonce: 2 })
  await pump(comp)
  const eCall = docCalls(world).at(-1)
  if (!eCall || eCall === dCall) throw new Error('E 请求未发出')
  eCall.resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'e').revision, text: 'BODY-E' })
  await pump(comp)
  dCall.resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'd').revision, text: 'STALE-D' })
  await pump(comp)
  if (textOf(comp.tree).includes('STALE-D')) throw new Error('旧 revision 迟到响应覆盖了新正文')
  if (!textOf(comp.tree).includes('BODY-E')) throw new Error('新正文丢失')
}
async function frontendIter5Reengen(iter5Body) {
  const env = { sessionId: 'session-a', locale: 'zh' }
  const world = installApiGet(buildFrontendWorld(env), env)
  const useData = extractFunction(legacyBlockOf(CLIENT), 'useIter5Data')
  vm.runInContext(useData + '\n' + iter5Body, world.sandbox)
  env.panel = panelData([docEntry('doc-a-261111-0001', 'a')])
  const comp = mount(world.react, world.sandbox.Iter5Handoff, { nonce: 1 })
  await pump(comp)
  const btns = findAll(comp.tree, (n) => n.props && n.props['data-i5-mdoc'])
  eq(btns.length, 1, '变异基线：iter5 必须仍渲染维护文档按钮')
  btns[0].props.onClick()
  await pump(comp)
  eq(docCalls(world).length, 1, '变异基线：iter5 首取一次')
  docCalls(world)[0].resolve({ enabled: true, documentId: 'doc-a-261111-0001', revision: docEntry('doc-a-261111-0001', 'a').revision, text: 'A' })
  await pump(comp)
  env.panel = panelData([docEntry('doc-a-261111-0001', 'f')])
  comp.setProps({ nonce: 2 })
  await pump(comp)
  if (docCalls(world).length < 2) throw new Error('iter5 revision 变了但没有重取')
}

/* ───────────────────────── 主流程 ───────────────────────── */
console.log('=== R4 P4-2：后端 handoff-state/fileQ + 前端 classic/iter5 面板 ===')
await fs.mkdir(fixtureRoot, { recursive: true })
if (PROBE) {
  try {
    const detail = await backendProbe()
    console.log('PROBE PASS :: ' + detail)
    process.exit(0)
  } catch (error) {
    console.error('PROBE FAIL :: ' + ((error && error.message) || error))
    process.exit(1)
  }
}
await test('A-01 backend：graph 独立清单/合法 fileQ/磁盘重算/非法名/未命中/读失败/junction/legacy 可读/默认关闭', backendProbe)
await test('B-01 classic PlanTab：独立分组 + 点击取文 + revision 未变不重取 + revision 变重取 + 旧请求不覆盖 + 切会话重绑', frontendClassic)
await test('C-01 iter5 Iter5Handoff：独立分组 + 点击取文 + revision 失效重取 + 旧请求不覆盖', frontendIter5)

console.log('\n=== 隔离变异（backend 用副本 + DAM_AUDIT_ENGINE_SOURCE；frontend 只改内存源码）===')
await fs.rm(mutationRoot, { recursive: true, force: true })
await fs.mkdir(mutationRoot, { recursive: true })
const indexSource = (await fs.readFile(path.join(ROOT, 'lib', 'index.js'), 'utf8')).split('\r\n').join('\n')
const backendVariants = [
  { name: 'fileq-maintenance-whitelist-removed', anchor: 'const docQ = await this.readMaintenanceDocumentForPanel(fileQ, p)', replacement: 'const docQ = null' },
  { name: 'legacy-panel-docs-removed', anchor: 'maintenanceDocuments: maintL.documents,', replacement: 'maintenanceDocuments: [],' },
  { name: 'path-containment-removed', anchor: "if (!physical) return { enabled: true, file: fileQ, error: 'path outside memory tree' }", replacement: "if (false) return { enabled: true, file: fileQ, error: 'path outside memory tree' }" },
  { name: 'read-failure-code-collapsed', anchor: "return { enabled: true, file: fileQ, documentId, error: (document && document.error) || 'document-read-failed' }", replacement: "return { enabled: true, file: fileQ, documentId, error: 'document-not-found' }" },
]
const clean = runProbe(path.join(ROOT, 'lib', 'index.js'))
if (clean.status === 0 && /PROBE PASS/.test(clean.stdout || '')) { pass++; console.log('  ok   - clean probe 绿 :: ' + String(clean.stdout || '').trim().split('\n').at(-1)) }
else { fail++; console.log('  FAIL - clean probe 必须绿\n' + String(clean.stdout || '').slice(-1500) + String(clean.stderr || '').slice(-800)) }
const mutantResults = []
for (const variant of backendVariants) {
  const hits = indexSource.split(variant.anchor).length - 1
  if (hits !== 1) { fail++; console.log('  FAIL - 变异锚不唯一: ' + variant.name + ' hits=' + hits); continue }
  const dir = path.join(mutationRoot, variant.name, 'lib')
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, 'index.js')
  await fs.writeFile(target, indexSource.replace(variant.anchor, variant.replacement), 'utf8')
  const result = runProbe(target)
  const caught = result.status !== 0
  mutantResults.push({ name: variant.name, layer: 'backend', expected: 'RED', caught, status: result.status })
  if (caught) { pass++; console.log('  ok   - MUT-' + variant.name + ' CAUGHT') }
  else { fail++; console.log('  FAIL - MUT-' + variant.name + ' MISSED\n' + String(result.stdout || '').slice(-1200) + String(result.stderr || '').slice(-600)) }
}
const planTabSrc = extractFunction(CLIENT, 'PlanTab')
const iter5Src = extractFunction(legacyBlockOf(CLIENT), 'Iter5Handoff')
const frontendVariants = [
  { name: 'classic-revision-dep-removed', anchor: '[mdocOpen && mdocOpen.documentId, mdocOpen && mdocOpen.revision, sid]', replacement: '[mdocOpen && mdocOpen.documentId, sid]', body: planTabSrc, run: frontendClassicReengen },
  { name: 'classic-request-identity-removed', anchor: 'if (mdocReq.current !== seq) return', replacement: 'if (false) return', body: planTabSrc, run: frontendClassicStale },
  { name: 'iter5-revision-dep-removed', anchor: '[mdocOpen && mdocOpen.documentId, mdocOpen && mdocOpen.revision, currentSessionIdClient()]', replacement: '[mdocOpen && mdocOpen.documentId, currentSessionIdClient()]', body: iter5Src, run: frontendIter5Reengen },
]
for (const variant of frontendVariants) {
  const hits = variant.body.split(variant.anchor).length - 1
  if (hits !== 1) { fail++; console.log('  FAIL - 前端变异锚不唯一: ' + variant.name + ' hits=' + hits); continue }
  const mutated = variant.body.replace(variant.anchor, variant.replacement)
  let caught = false
  let detail = ''
  try { await variant.run(mutated) } catch (error) { caught = true; detail = String((error && error.message) || error) }
  mutantResults.push({ name: variant.name, layer: 'frontend', expected: 'RED', caught })
  if (caught) { pass++; console.log('  ok   - MUT-' + variant.name + ' CAUGHT :: ' + detail) }
  else { fail++; console.log('  FAIL - MUT-' + variant.name + ' MISSED（语义缺失却仍绿）') }
}
await fs.writeFile(path.join(mutationRoot, 'results.json'), JSON.stringify(mutantResults, null, 2), 'utf8')

console.log('\nSUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + mutantResults.filter((r) => r.caught).length + ' / MISSED ' + mutantResults.filter((r) => !r.caught).length)
if (fail) { console.error('\nFAILURES:\n' + failures.map((f) => ' - ' + f.name + ' :: ' + f.error).join('\n')); process.exitCode = 1 }
