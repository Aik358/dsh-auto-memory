/**
 * smoke-test-bc-audit-fixes —— B/C 车道（2026-10-08）行为级验收套件。
 *
 * 覆盖（均为**独立复核**，不是实现者自述）：
 *   ① #270 python worker 的 recall_rank 信封校验：合法信封受理 + 5 类畸形信封全部 invalid-envelope
 *      （真起 python 进程走真协议帧；负路径 = 把旁路改回去，畸形帧必被受理）。
 *   ② #258 团队本机角色门：viewer 经**真 HTTP 路由**（config / calendar）与团队通道被拒且**未落盘**；
 *      读动作放行；teamEnabled!==true 时短路放行（个人用户零感知）。
 *   ③ #252 client 卸载清理：真执行 __ModuleLoader__ factory 的运行时守卫（见套件内 runClientFactory）。
 *
 * 纪律：真 import → 真构造 → 真调用 → 断言副作用（磁盘字节 / 路由状态码）；负路径必须真变异。
 * 一切子进程走 node（本环境 run_code 内 spawn 静默失效，故本套件由 pwsh 启动）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { Readable } from 'node:stream'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const tmps = []
const mkroot = (tag) => { const d = fs.mkdtempSync(path.join(tmpdir(), 'dam-bc-' + tag + '-')); tmps.push(d); return d }
function withIsolatedEnv(root) {
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = root }
  return () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } }
}
async function loadEngine() {
  const shim = path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')
  return await import(pathToFileURL(shim).href + '?v=' + Date.now() + Math.random())
}

// ══════════════════════════════════════════════════════════════
console.log('[①] #270 独立复核：recall_rank 信封校验（真 python 进程 / 真协议帧）')
// ══════════════════════════════════════════════════════════════
function pyWorkerRun(frames, mutate) {
  const pyDir = path.join(ROOT, 'python')
  const dir = mkroot('py270')
  for (const f of fs.readdirSync(pyDir)) if (f.endsWith('.py')) fs.copyFileSync(path.join(pyDir, f), path.join(dir, f))
  const home = path.join(dir, 'home'); fs.mkdirSync(home, { recursive: true })
  const script = path.join(dir, 'worker_semantic_v1.py')
  if (mutate) {
    const src = fs.readFileSync(script, 'utf8').replace(/\r\n/g, '\n')
    const hits = src.split(mutate[0]).length - 1
    assert.equal(hits, 1, 'python mutation anchor must hit exactly once, hits=' + hits)
    const next = src.replace(mutate[0], mutate[1])
    assert.notEqual(next, src, 'python mutation must actually change the file')
    fs.writeFileSync(script, next.replace(/\n/g, '\r\n'))
  }
  const input = frames.map((f) => JSON.stringify(f)).join('\n') + '\n'
  const r = spawnSync('python', [script, '--expect-epoch', 'ep', '--dsh-home', home],
    { cwd: pyDir, input, encoding: 'utf8', timeout: 120000 })
  assert.equal(r.error, undefined, 'python spawn error: ' + String(r.error))
  return String(r.stdout || '').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
{
  const env = (over) => Object.assign({
    protocolVersion: 'm7_wire_pre_v1', frameId: 'f1', requestId: 'r1', workerEpoch: 'ep',
    type: 'recall_rank', sentAt: 12,
    payload: { query: 'x', workspaceKey: 'wsr_' + '0'.repeat(32), scope: 'Workspace', memoryIndexVersion: 'idx_pre_' + '0'.repeat(32), topK: 5 },
  }, over)
  const MALFORMED = [
    ['protocolVersion 不符', { protocolVersion: 'WRONG' }],
    ['payload 非对象', { payload: 'not-a-dict' }],
    ['frameId 缺失', { frameId: undefined }],
    ['requestId 非字符串', { requestId: 123 }],
    ['sentAt 为布尔', { sentAt: true }],
  ]
  const good = pyWorkerRun([env({})])
  ok(good.length === 1 && good[0].type === 'recall_rank_result', '合法信封 ⇒ recall_rank_result（实 ' + (good[0] && good[0].type) + '）')
  ok(good[0].payload && Array.isArray(good[0].payload.scores), '合法信封的返回结构含 scores 数组')
  const bad = pyWorkerRun(MALFORMED.map(([, over], i) => env(Object.assign({ frameId: 'f' + i, requestId: 'r' + i }, over))))
  ok(bad.length === MALFORMED.length, '5 类畸形帧各回一帧（实 ' + bad.length + '）')
  MALFORMED.forEach(([label], i) => {
    const fr = bad[i]
    ok(fr && fr.type === 'error' && fr.payload && fr.payload.code === 'invalid-envelope',
      '★ ' + label + ' ⇒ invalid-envelope（实 ' + (fr && fr.type) + '/' + (fr && fr.payload && fr.payload.code) + '）')
  })
  // 负路径：把类型白名单旁路改回去（recall_rank 不进 envelope 校验）⇒ 畸形帧被受理
  // 锚点**不含换行**（换行字面量在本环境经写入层易被改写）：用唯一条件行做内容匹配。
  const mut = pyWorkerRun(MALFORMED.map(([, over], i) => env(Object.assign({ frameId: 'f' + i, requestId: 'r' + i }, over))),
    ['if not base.envelope_shape_ok(envelope):', "if not (isinstance(obj, dict) and obj.get('type') == 'recall_rank') and not base.envelope_shape_ok(obj):"])
  const accepted = mut.filter((fr) => fr && fr.type === 'recall_rank_result').length
  ok(accepted >= 4, '负路径（恢复旁路）：畸形帧被受理 ⇒ 缺陷复现（实 ' + accepted + '/5 被受理）—— 证明判据有鉴别力')
}

// ══════════════════════════════════════════════════════════════
console.log('[②] #258 独立复核：viewer 经真 HTTP 路由被拒 + 未落盘 + 读放行 + 个人用户放行')
// ══════════════════════════════════════════════════════════════
async function bootEngine(root, config) {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify(config), 'utf8')
  const routes = [], tools = [], effects = []
  const prevLoad = (await loadEngine()).MemoryEngine.prototype.loadConfigSync
  const mod = await loadEngine()
  const seen = []
  const proto = mod.MemoryEngine.prototype
  const origLoad = proto.loadConfigSync
  proto.loadConfigSync = function (...a) { seen.push(this); return origLoad.apply(this, a) }
  const ctx = {
    get: () => undefined,
    on: () => {}, credentials: {}, remote: null,
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: (t) => { tools.push(t); return () => {} } },
    webServer: { register: (r) => { routes.push(r); return () => {} } },
    effect: (fn) => { const c = fn(); if (typeof c === 'function') effects.push(c) },
  }
  try { mod.apply(ctx, {}) } catch (e) { throw new Error('apply threw: ' + (e && e.stack || e)) }
  proto.loadConfigSync = prevLoad
  const engine = seen[0]
  return { engine, routes, tools, effects, dispose: () => { for (const f of effects) { try { f() } catch (_) {} } } }
}
async function callRoute(routes, key, API, { method = 'GET', body = null } = {}) {
  const route = routes.find((r) => r.path === API[key])
  assert.ok(route, 'route exists: ' + key + ' (' + API[key] + ')')
  let status = 0, text = 'null'
  const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
  Object.assign(req, { method, url: API[key], socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' } })
  await route.handler(req, { writeHead: (s) => { status = s }, end: (b) => { text = b === undefined ? 'null' : String(b) }, setHeader() {} })
  let json = null; try { json = JSON.parse(text) } catch (_) {}
  return { status, json, text }
}
{
  const root = mkroot('team258')
  const restore = withIsolatedEnv(root)
  try {
    const VIEWER = { teamEnabled: true, teamMemberId: 'u1', teamMemberRole: 'viewer', memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), globalBriefEnabled: false }
    const { MemoryEngine, API } = await loadEngine()
    const boot = await bootEngine(root, VIEWER)
    const eng = boot.engine
    ok(!!eng, '真引擎已构造（apply 成功）')
    ok(typeof eng._assertTeamActionPre === 'function', '产线团队门入口存在')

    // ① 读动作放行（viewer 未越权收紧）
    const st = await callRoute(boot.routes, 'state', API)
    ok(st.status === 200, '★ read-team：viewer 读 /state 放行（HTTP ' + st.status + '）')

    // ② 真 HTTP 路由：viewer 改团队开关（edit-team-config）⇒ 403 + 未落盘
    const cfgBefore = fs.readFileSync(eng._configPath, 'utf8')
    const cfg = await callRoute(boot.routes, 'config', API, { method: 'POST', body: { teamEnabled: false } })
    ok(cfg.status === 403, '★ config 路由：viewer 关团队开关（edit-team-config）⇒ 403（实 ' + cfg.status + '）')
    ok(/team-forbidden/.test(String(cfg.json && cfg.json.error)), '★ 拒绝原因是 team-forbidden（实 ' + JSON.stringify(cfg.json && cfg.json.error) + '）')
    ok(fs.readFileSync(eng._configPath, 'utf8') === cfgBefore, '★ 被拒的配置写入没有落盘（磁盘字节逐字节不变）')

    // ②b 越权改角色：不得提权（无论返回码如何，磁盘上的角色必须仍是 viewer）
    const role = await callRoute(boot.routes, 'config', API, { method: 'POST', body: { teamMemberRole: 'administrator' } })
    const diskCfg = JSON.parse(fs.readFileSync(eng._configPath, 'utf8'))
    ok(diskCfg.teamMemberRole === 'viewer', '★ viewer 试图自升 administrator 未生效（磁盘角色仍为 viewer；HTTP ' + role.status + '）')

    // ③ 真 HTTP 路由：viewer 写日历 ⇒ 403 + 未落盘
    const calPath = (await eng.resolvePaths(undefined)).calendarPath
    fs.mkdirSync(path.dirname(calPath), { recursive: true })
    fs.writeFileSync(calPath, '# 日历与日程 (CALENDAR)\n\n## 2026-10-08\n- [ ] 12:00 | 未分类 | 既有条目\n', 'utf8')
    const calBefore = fs.readFileSync(calPath, 'utf8')
    const cal = await callRoute(boot.routes, 'calendar', API, { method: 'POST', body: { action: 'add', date: '2026-10-09', time: '09:00', title: '越权写入' } })
    ok(cal.status === 403, '★ calendar 路由：viewer 写日历 ⇒ 403（实 ' + cal.status + '）')
    ok(fs.readFileSync(calPath, 'utf8') === calBefore, '★ 被拒的日历写入没有落盘（字节不变，且不含越权标题）')
    ok(!fs.readFileSync(calPath, 'utf8').includes('越权写入'), '★ 磁盘上找不到被拒的条目标题')

    // ③b 真 HTTP 工具路径：viewer 走 memory_note 写白板（edit-board）⇒ 拒绝 + 未落盘
    const noteTool = boot.tools.find((t) => t.name === 'memory_note')
    ok(!!noteTool, 'memory_note 工具已注册（真注册面）')
    let noteErr = null, noteOut = null
    try { noteOut = await noteTool.execute({ kind: 'plan', content: '# 越权白板\n\n正文内容足够长以避免其它判据干扰。' }, { agent: undefined }) } catch (e) { noteErr = e }
    // 磁盘全树搜索：越权内容不得出现在任何一个 PLAN.md 里（不依赖具体 projectDir 解析）
    const hitsPlan = []
    ;(function walk(d) {
      let ents = []
      try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch (_) { return }
      for (const en of ents) {
        const p = path.join(d, en.name)
        if (en.isDirectory()) { if (en.name !== 'node_modules') walk(p) }
        else if (en.name === 'PLAN.md') { try { if (fs.readFileSync(p, 'utf8').includes('越权白板')) hitsPlan.push(p) } catch (_) {} }
      }
    })(root)
    const noteText = String(noteErr ? (noteErr.code || noteErr.message || noteErr) : JSON.stringify(noteOut))
    ok(hitsPlan.length === 0, '★ memory_note(白板) ⇒ viewer 被拒且**没有落盘**（全树 PLAN.md 命中 ' + hitsPlan.length + ' 个）')
    ok(!!noteErr || (noteOut && noteOut.ok === false) || /team-forbidden/.test(noteText), '★ 白板写入给出了可观察的拒绝（实 ' + noteText.slice(0, 160) + '）')
    ok(/team-forbidden/.test(noteText), '★ 拒绝原因可归属到团队门（team-forbidden，实 ' + noteText.slice(0, 120) + '）')

    // ④ 团队通道（_teamFetch 包装）：viewer 发送 ⇒ throw team-forbidden
    let sendErr = null
    try { if (typeof eng._teamFetch === 'function') await eng._teamFetch('http://127.0.0.1:1/x', { method: 'POST' }) } catch (e) { sendErr = e }
    ok(!!sendErr && sendErr.code === 'team-forbidden', '★ _teamFetch 通道：viewer 发送被拒（实 ' + (sendErr && (sendErr.code || sendErr.message)) + '）')

    // ⑤ R1 修复复核：包装体保留 dispose/describe/readToken 属性面
    const attrs = eng._teamFetch ? ['dispose', 'describe', 'readToken'].filter((k) => typeof eng._teamFetch[k] === 'function') : []
    ok(attrs.length === 3, '★ R1：_teamFetch 包装保留属性面（实 ' + JSON.stringify(attrs) + '）')

    // ⑥ 个人用户：teamEnabled!==true ⇒ 写原语短路放行（零感知）
    const p2 = mkroot('personal258')
    const restore2 = withIsolatedEnv(p2)
    try {
      const personal = { teamEnabled: false, teamMemberId: 'u1', teamMemberRole: 'viewer', memoryRoot: path.join(p2, 'memory'), userMemoryDir: path.join(p2, 'user'), globalBriefEnabled: false }
      fs.writeFileSync(path.join(p2, 'dsh-auto-memory.json'), JSON.stringify(personal), 'utf8')
      const b2 = await bootEngine(p2, personal)
      let e2 = null
      try { await b2.engine.appendText(path.join(p2, 'MEMORY.md'), '- 个人写入') } catch (e) { e2 = e }
      ok(!e2 || e2.code !== 'team-forbidden', '★ teamEnabled!==true：写原语短路放行（个人用户零感知，实 ' + (e2 ? e2.code || e2.message : 'ok') + '）')
      ok(fs.existsSync(path.join(p2, 'MEMORY.md')), '★ 个人写入真的落盘')
      b2.dispose()
    } finally { restore2() }
    boot.dispose()
  } finally { restore() }
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL')
// ══════════════════════════════════════════════════════════════
console.log('[③] #252 RL-02：client 卸载后计时器/监听器必须清零（真执行 factory）')
// ══════════════════════════════════════════════════════════════
function runClientLifecycle(source) {
  const noop = () => {}
  const mkEl = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: (c) => c, removeChild: noop, setAttribute: noop, removeAttribute: noop, getAttribute: () => null, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }), insertBefore: noop, contains: () => false, focus: noop, blur: noop, firstChild: null, parentNode: null, children: [], textContent: '', innerHTML: '', value: '' })
  const store = new Map()
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => Array.from(store.keys())[i] || null, get length () { return store.size } }
  const docL = [], winL = []
  const documentStub = {
    head: mkEl(), body: mkEl(), documentElement: mkEl(), createElement: () => mkEl(), createElementNS: () => mkEl(), createTextNode: () => mkEl(),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (t, f) => { docL.push([t, f]) },
    removeEventListener: (t, f) => { const i = docL.findIndex((x) => x[0] === t && x[1] === f); if (i >= 0) docL.splice(i, 1) },
    readyState: 'complete', cookie: '', title: '', hidden: false, visibilityState: 'visible',
  }
  const React = { createElement: (type, props, ...kids) => ({ type, props: props || {}, children: kids }), useState: (v) => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useReducer: (r, i) => [i, noop], useRef: (v) => ({ current: v }), useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}), Fragment: 'Fragment', createContext: () => ({ Provider: 'Provider', Consumer: 'Consumer' }), memo: (c) => c, forwardRef: (f) => f, Children: { map: (a, f) => (a || []).map(f) } }
  const sandbox = {
    console: { log: noop, warn: noop, error: noop },
    window: {
      __ModuleLoader__: { load: (e) => { sandbox.__entry = e } },
      addEventListener: (t, f) => { winL.push([t, f]) },
      removeEventListener: (t, f) => { const i = winL.findIndex((x) => x[0] === t && x[1] === f); if (i >= 0) winL.splice(i, 1) },
      setTimeout: () => ({ __to: true }), clearTimeout: noop, setInterval: () => ({ __iv: true }), clearInterval: noop,
      localStorage: storage, sessionStorage: storage,
      location: { href: 'http://localhost/', origin: 'http://localhost', search: '', hash: '' }, navigator: { userAgent: 'node', language: 'zh' },
      matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), requestAnimationFrame: () => ({ __raf: true }), cancelAnimationFrame: noop, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    },
    document: documentStub, localStorage: storage, sessionStorage: storage, navigator: { userAgent: 'node', language: 'zh' },
    setTimeout: () => ({ __to: true }), clearTimeout: noop, queueMicrotask: noop,
    requestAnimationFrame: () => ({ __raf: true }), cancelAnimationFrame: noop,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    TextEncoder, TextDecoder, URL, URLSearchParams, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), getComputedStyle: () => ({ getPropertyValue: () => '' }),
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox
  // 计时器拦截：live 集合 = 到卸载时仍活着的 setInterval
  const live = new Map()
  let seq = 0
  sandbox.setInterval = () => { const h = { __id: ++seq }; live.set(h.__id, h); return h }
  sandbox.clearInterval = (h) => { if (h && h.__id) live.delete(h.__id) }
  const ctx = vm.createContext(sandbox)
  new vm.Script(source, { filename: 'client.js' }).runInContext(ctx, { timeout: 20000 })
  const entry = sandbox.__entry
  const mod = entry.factory((n) => (n === 'react' ? React : n === 'react-dom' ? { createPortal: (x) => x } : {}))
  const effects = []
  const hostCtx = {
    get: () => undefined, on: noop, credentials: {}, remote: null,
    slots: { inject: () => () => {}, register: () => () => {} },
    sessions: null, locale: { getLocale: () => ({ active: 'zh' }) },
    effect: (fn) => { const c = fn(); if (typeof c === 'function') effects.push(c) },
    systemPrompt: { context: () => () => {}, section: () => () => {} },
  }
  let applyErr = null
  try { mod.apply(hostCtx) } catch (e) { applyErr = e }
  const before = { intervals: live.size, doc: docL.length, win: winL.length }
  let cleanupErr = null
  try { for (const f of effects.slice()) f() } catch (e) { cleanupErr = e }
  return { applyErr, effects: effects.length, api: mod, before, after: { intervals: live.size, doc: docL.length, win: winL.length }, cleanupErr }
}
{
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const cur = runClientLifecycle(src)
  ok(!cur.applyErr, '③ 真执行 factory + apply 不抛（' + (cur.applyErr ? cur.applyErr.message : 'ok') + '，effects=' + cur.effects + '）')
  ok(typeof cur.api._damDisposeRuntimeHandlesPre === 'function', '③ 导出卸载清理入口（真函数）')
  ok(cur.before.intervals >= 2, '③ 挂载后确有轮询计时器（实 ' + cur.before.intervals + ' 个）—— 否则本判据无鉴别力')
  ok(cur.after.intervals === 0, '★ ③ 卸载后计时器全部停掉（' + cur.before.intervals + ' → ' + cur.after.intervals + '）')
  ok(cur.after.doc === 0, '★ ③ 卸载后 document 级监听器全部解绑（' + cur.before.doc + ' → ' + cur.after.doc + '）')
  ok(cur.after.win === 0, '★ ③ 卸载后 window 级监听器全部解绑（' + cur.before.win + ' → ' + cur.after.win + '）')
  ok(!cur.cleanupErr, '③ 清理过程不抛（' + (cur.cleanupErr ? cur.cleanupErr.message : 'ok') + '）')
  // 负路径：把登记里的清理体改成空操作（等价于 #252 未修）⇒ 计时器/监听器必残留
  const marker = '__damRuntimeHandlesPre.disposers.push(function () {'
  assert.equal(src.split(marker).length - 1, 1, '负路径锚点必须恰命中 1 次')
  const mut = runClientLifecycle(src.replace(marker, marker + ' if (true) return;'))
  ok(mut.after.intervals > 0, '★ ③ 负路径（清理体置空）：计时器残留（实 ' + mut.after.intervals + ' 个）⇒ 判据有鉴别力')
  ok(mut.after.doc + mut.after.win > 0, '★ ③ 负路径：监听器残留（doc ' + mut.after.doc + ' + win ' + mut.after.win + '）')
  // 幂等：重复清理不抛
  cur.api._damDisposeRuntimeHandlesPre()
  cur.api._damDisposeRuntimeHandlesPre()
  ok(cur.api._damRuntimeHandlesPre.disposers.length === 0, '③ 清理幂等（重复调用后待办队列为空）')
}

for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }) } catch (_) {} }
process.exit(fail ? 1 : 0)
