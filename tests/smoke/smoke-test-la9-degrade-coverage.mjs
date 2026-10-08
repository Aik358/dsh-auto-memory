/**
 * smoke-test-la9-degrade-coverage —— L-A9「如实标注」全覆盖验收（2026-10-08）。
 *
 * 缺口：批 D 只在 selectModel **抛错**时留痕；而条件是「三与」`d.provider && d.model && typeof sc.selectModel`，
 *   不成立时整段跳过 ⇒ modelDegraded 不设、modelRequested 空串 ⇒ 前端两条标注分支都不触发 ⇒
 *   用户看到「✓ 已自动接续」却不知道模型没沿用（L-A8 负路径挖出的实测形态）。
 * 修法：把「继承未能进行」也按**降级**如实标注（原因码分开：source-model-unknown / selectModel-unavailable）。
 *   ★纯补可见性：不触碰任何判定/开关/流程。
 *
 * 真跑真 MemoryEngine + 替身 controller；前端标注用真挂载组件体验证。零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const ROOT = path.resolve(HERE, '..', '..')
const SRC_CLIENT = readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const eq = (a, b, n) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); ok(ja === jb, n + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }
const sleep = () => new Promise((r) => setImmediate(r))
const tmps = []
const mkroot = (t) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la9-' + t + '-')); tmps.push(d); return d }
let seq = 0
async function loadEngine (mutations = []) {
  const shim = path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')
  if (!mutations.length) { delete process.env.DAM_STATE_ENGINE_SOURCE; return await import(pathToFileURL(shim).href + '?v=' + (++seq)) }
  let src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  for (const [from, to] of mutations) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 70)) + ' hits=' + hits)
    src = src.replace(from, to)
  }
  const f = path.join(mkroot('mut'), 'idx-' + (++seq) + '.mjs')
  writeFileSync(f, src, 'utf8')
  process.env.DAM_STATE_ENGINE_SOURCE = f
  const m = await import(pathToFileURL(shim).href + '?v=' + (++seq))
  delete process.env.DAM_STATE_ENGINE_SOURCE
  return m
}
function isolate (tag) {
  const root = mkroot(tag), home = path.join(root, 'home'), wsReal = path.join(root, 'realws')
  mkdirSync(home, { recursive: true }); mkdirSync(wsReal, { recursive: true })
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = home }
  return { root, home, wsReal, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } } }
}
const WS = '--D--ws--'
const SID = 'aaaaaaaa-1111-2222-3333-444444444444'
const NEWID = 'bbbbbbbb-2222-3333-4444-555555555555'
const NLc = String.fromCharCode(10)
function writeSession (home, sid, wsReal, model) {
  const dir = path.join(home, 'sessions', WS, sid)
  mkdirSync(dir, { recursive: true })
  const hc = { provider: 'p1' }
  if (model !== null) hc.model = model === undefined ? 'SRC-MODEL' : model
  const evs = [
    JSON.stringify({ type: 'request/header', data: { header: { config: hc } }, cwd: wsReal }),
    JSON.stringify({ type: 'request/context', data: { contextWindow: 100000, cwd: wsReal } }),
    JSON.stringify({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } } }),
  ]
  writeFileSync(path.join(dir, 'session.jsonl'), evs.join(NLc) + NLc, 'utf8')
}
/** 造引擎：carry 字段可控（provider/model 可缺），并可选替身 selectModel。 */
function mkEng (mod, iso, carryFields, opts) {
  opts = opts || {}
  const eng = new mod.MemoryEngine()
  const calls = { selectModel: 0 }
  const fields = Object.assign({ provider: 'p1', model: 'SRC-MODEL', reasoningEffort: 'high', contSeq: 1, transcriptPath: '', workspaceId: '', agentPreset: '', wsFallback: false }, carryFields || {})
  eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
  eng.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
  eng.markContinuedSession = async () => true
  eng.buildContinueCarry = async () => Object.assign({ ok: true, carryText: 'CARRY', prevSessionId: SID, ws: iso.wsReal }, fields)
  eng._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === NEWID ? { session: { id: NEWID, events: [{ type: 'request/header', data: { header: { config: { provider: 'p1', model: opts.readbackModel === undefined ? 'SRC-MODEL' : opts.readbackModel } } } }] } } : null } : null }
  eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
  const sc = { create: async () => ({ sessionId: NEWID }), rename: async () => ({}), prompt: async () => ({ ok: true }), cancel: async () => ({ accepted: true }) }
  if (!opts.noSelectModel) sc.selectModel = async () => { calls.selectModel++; if (opts.selectThrows) { const e = new Error('MODEL_NOT_FOUND'); e.code = 'MODEL_NOT_FOUND'; throw e } return { ok: true } };
  eng._sessionController = sc
  return { eng, calls };
}console.log('')
console.log('[A] ① provider+model 且 selectModel 成功 => 无标注（输出与既有行为一致）')
{
  const iso = isolate('ok')
  try {
    const mod = await loadEngine()
    const { eng, calls } = mkEng(mod, iso, {}, { selectThrows: false })
    const res = await eng.hostAutoContinue()
    eq(res.ok, true, '接续成功')
    eq(calls.selectModel, 1, 'selectModel 真被调用')
    eq(res.modelDegraded, false, '★ modelDegraded=false（无降级标注）')
    eq(res.modelDegradeReason, '', '★ modelDegradeReason 为空（不污染非降级路径）')
    eq(res.model, 'SRC-MODEL', '★ 回执为已确认模型（与既有行为一致）')
  } finally { iso.restore() }
}

console.log('[B] ② provider+model 但 selectModel 抛错 => 降级标注（批 D 原有路径，不得回退）')
{
  const iso = isolate('throw')
  try {
    const mod = await loadEngine()
    const { eng, calls } = mkEng(mod, iso, {}, { selectThrows: true })
    const res = await eng.hostAutoContinue()
    eq(calls.selectModel, 1, 'selectModel 被调用并抛错')
    eq(res.modelDegraded, true, '★ modelDegraded=true（批 D 行为保留）')
    ok(String(res.modelDegradeReason).includes('MODEL_NOT_FOUND'), '★ 原因取 code')
    eq(res.modelRequested, 'SRC-MODEL', '★ modelRequested 带上请求值')
  } finally { iso.restore() }
}

console.log('[C] ③ 缺 model（provider 在）=> ★本次新增覆盖：modelDegraded=true')
{
  const iso = isolate('nomodel')
  try {
    const mod = await loadEngine()
    const { eng, calls } = mkEng(mod, iso, { model: '' }, {})
    const res = await eng.hostAutoContinue()
    eq(res.ok, true, '仍允许降级继续（不拒绝接续）')
    eq(calls.selectModel, 0, '条件不成立 ⇒ 未调用 selectModel（流程判定未变）')
    eq(res.modelDegraded, true, '★ modelDegraded=true —— 缺口已补（旧实现在此为空/false）')
    eq(res.modelDegradeReason, 'source-model-unknown', '★ 原因码 source-model-unknown')
    eq(eng._autoContState.lastOk.modelDegraded, true, '★ lastOk.modelDegraded=true（前端据此标注）')
    eq(eng._autoContState.lastOk.modelDegradeReason, 'source-model-unknown', '★ lastOk 也带原因')
  } finally { iso.restore() }
}

console.log('[D] ④ 缺 provider => 同一类（source-model-unknown）')
{
  const iso = isolate('noprovider')
  try {
    const mod = await loadEngine()
    const { eng, calls } = mkEng(mod, iso, { provider: '' }, {})
    const res = await eng.hostAutoContinue()
    eq(calls.selectModel, 0, '未调用 selectModel')
    eq(res.modelDegraded, true, '★ modelDegraded=true')
    eq(res.modelDegradeReason, 'source-model-unknown', '★ 原因码 source-model-unknown')
  } finally { iso.restore() }
}

console.log('[E] ④b 宿主无 selectModel => 按论证也算降级（selectModel-unavailable）')
{
  const iso = isolate('nosel')
  try {
    const mod = await loadEngine()
    const { eng } = mkEng(mod, iso, {}, { noSelectModel: true })
    const res = await eng.hostAutoContinue()
    eq(res.ok, true, '仍允许降级继续')
    eq(res.modelDegraded, true, '★ modelDegraded=true（论证：结果同样是跑在宿主默认模型上）')
    eq(res.modelDegradeReason, 'selectModel-unavailable', '★ 原因码 selectModel-unavailable（与源信息缺失分开）')
    eq(res.modelRequested, 'SRC-MODEL', '★ provider/model 都在 ⇒ modelRequested 仍带上（不丢信息）')
  } finally { iso.restore() }
}
console.log('[F] ★前端真挂载：modelDegraded=true 时提示**真的显示**降级标注')
{
  // 复用 #287 套件已验证的范式：真执行 factory + 配平抽组件体 + 受控 hooks/storage。
  function runClientFactory (code, storage) {
    const noop = () => {}
    const mkEl = () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: (c) => c, removeChild: noop, setAttribute: noop, removeAttribute: noop, addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [] })
    const documentStub = { head: mkEl(), body: mkEl(), documentElement: mkEl(), createElement: () => mkEl(), createElementNS: () => mkEl(), createTextNode: () => mkEl(), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener: noop, removeEventListener: noop, cookie: '' }
    const React = { createElement: (t, props, ...kids) => ({ type: t, props: props || {}, children: kids }), useState: (v) => [typeof v === 'function' ? v() : v, noop], useEffect: noop, useRef: (v) => ({ current: v }), useReducer: (r, i) => [i, noop], useMemo: (f) => f(), useCallback: (f) => f, useContext: () => ({}), useLayoutEffect: noop, createContext: () => ({ Provider: (p) => p, Consumer: (p) => p }) }
    const sandbox = {
      console: { log: noop, warn: noop, error: noop },
      window: { __ModuleLoader__: { load: (e) => { sandbox.__entry = e } }, addEventListener: noop, removeEventListener: noop, setTimeout: () => ({}), clearTimeout: noop, setInterval: () => ({}), clearInterval: noop, location: { href: 'http://x/', origin: 'http://x' }, document: documentStub },
      document: documentStub, localStorage: storage, sessionStorage: storage, navigator: { userAgent: 'node', language: 'zh' },
      setTimeout: () => ({}), clearTimeout: noop, setInterval: () => ({}), clearInterval: noop, queueMicrotask: noop,
      requestAnimationFrame: () => ({}), cancelAnimationFrame: noop,
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
      TextEncoder, TextDecoder, URL, URLSearchParams, matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }), getComputedStyle: () => ({ getPropertyValue: () => '' })
    }
    sandbox.globalThis = sandbox; sandbox.self = sandbox
    const ctx = vm.createContext(sandbox)
    try { new vm.Script(code, { filename: 'client.js' }).runInContext(ctx, { timeout: 20000 }) } catch (e) { return { topErr: e } }
    const entry = sandbox.__entry
    if (!entry || typeof entry.factory !== 'function') return { topErr: new Error('no factory') }
    try { entry.factory((n) => (n === 'react' ? React : n === 'react-dom' ? { createPortal: (x) => x } : {})) } catch (e) { return { factoryErr: e } }
    return {}
  }
  function extractFnBody (src, header) {
    const start = src.indexOf(header)
    if (start < 0) throw new Error('not found: ' + header)
    let depth = 0
    for (let i = start + header.length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
    }
    throw new Error('unbalanced: ' + header)
  }
  const freshStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() } }
  const R = runClientFactory(SRC_CLIENT, freshStorage())
  ok(!R.topErr && !R.factoryErr, '★ 真执行 factory 不抛（' + (R.topErr ? R.topErr.message : R.factoryErr ? R.factoryErr.message : 'ok') + '）')
  const AC_BODY = extractFnBody(SRC_CLIENT, 'function AutoContinueHost() {')
  const mount = (lastOk) => {
    const cells = new Map(); let cursor = 0, first = true; const intervals = new Map(); let ivSeq = 0
    const effects = []; const renders = []
    const useState = (init) => { const idx = cursor++; if (!cells.has(idx)) cells.set(idx, typeof init === 'function' ? init() : init); return [cells.get(idx), (next) => { cells.set(idx, typeof next === 'function' ? next(cells.get(idx)) : next) }] };
    const useRef = (v) => { const idx = 'r' + (cursor++); if (!cells.has(idx)) cells.set(idx, { current: v }); return cells.get(idx) };
    const useEffect = (fn) => { if (first) effects.push(fn) };
    const st = freshStorage();
    const apiGet = () => Promise.resolve({ executing: false, lastOk, error: null, armed: null });
    const render = new Function('useState', 'useEffect', 'useRef', 'useReducer', 'useMemo', 'useCallback', 'h', 'L', 't', 'apiGet', 'apiPost', 'API', 'sessions', 'currentSessionIdClient', 'Iter5AutoContinue', 'configOf', 'localStorage', 'setInterval', 'clearInterval', AC_BODY + '\nreturn AutoContinueHost()');
    const show = () => { cursor = 0; const v = render(useState, useEffect, useRef, (r, i) => [i, () => {}], (f) => f(), (f) => f, (t, props, ...kids) => ({ type: t, props: props || {}, children: kids }), (zh) => zh, (k) => 'T:' + k, apiGet, () => Promise.resolve({ ok: true }), { config: '/c', autoContState: '/s', autoContDecide: '/d' }, { open: () => {} }, () => 'sid-A', (t, props, ...kids) => ({ type: t, props: props || {}, children: kids }), (d) => d, st, (fn) => { const id = ++ivSeq; intervals.set(id, fn); return id }, (id) => intervals.delete(id)); renders.push(v); return v };
    const settle = async () => { await sleep(); await sleep(); return show() };
    return { show, runEffects: () => { first = false; for (const fn of effects.splice(0)) { const c = fn(); void c } }, settle };
  };
  const NOW = Date.now();
  const statusOf = (v) => (v && v.props && typeof v.props.status === 'string') ? v.props.status : null;
  const base = { at: NOW - 3000, sessionId: 'sid-N', fromSid: 'sid-A', model: 'SRC-MODEL' };
  // ③ 缺 model 的情形：宿主报降级 + 原因 source-model-unknown
  const h1 = mount(Object.assign({}, base, { modelDegraded: true, modelDegradeReason: 'source-model-unknown' }));
  h1.show(); h1.runEffects(); await h1.settle();
  const st1 = statusOf(h1.show());
  ok(!!st1 && st1.includes('模型沿用失败'), '★ ③ 缺 model ⇒ 提示**真的显示**降级标注（实 ' + JSON.stringify(st1) + '）');
  ok(!!st1 && st1.includes('已降级为宿主默认'), '★ 含「已降级为宿主默认」字样');
  // ④b 无 selectModel：provider/model 都在 ⇒ 提示应带「原请求」
  const h2 = mount(Object.assign({}, base, { modelDegraded: true, modelDegradeReason: 'selectModel-unavailable', modelRequested: 'SRC-MODEL' }));
  h2.show(); h2.runEffects(); await h2.settle();
  const st2 = statusOf(h2.show());
  ok(!!st2 && st2.includes('模型沿用失败'), '★ ④b 无 selectModel ⇒ 同样显示降级标注');
  ok(!!st2 && st2.includes('原请求 SRC-MODEL'), '★ 带 modelRequested ⇒ 文案含「原请求 SRC-MODEL」（不丢信息）实 ' + JSON.stringify(st2) + '）');
  // 对照：无降级 ⇒ 不出现该标注（防误伤 / 证明判据有鉴别力）
  const h3 = mount(base);
  h3.show(); h3.runEffects(); await h3.settle();
  const st3 = statusOf(h3.show());
  ok(!!st3 && st3.includes('已自动接续'), '（对照）无降级 ⇒ 照常显示成功提示');
  ok(!!st3 && !st3.includes('模型沿用失败'), '★ 对照：无降级时**不出现**降级标注（判据有鉴别力）');
  // 对照 2：旧实现在「跳过继承」时不设 modelDegraded ⇒ 同一输入下文案退化为无标注
  const h4 = mount(Object.assign({}, base, { modelDegraded: false }));
  h4.show(); h4.runEffects(); await h4.settle();
  const st4 = statusOf(h4.show());
  ok(!!st4 && !st4.includes('模型沿用失败'), '★ 对照：modelDegraded=false（旧行为形态）⇒ 无任何标注 —— 正是本次补上的缺口');
}
console.log('[G] 负路径（变异必红 -> 还原必绿）')
{
  const iso = isolate('mut')
  try {
    // 变异：把新增的留痕改回「不设」（等价回退本改）
    // ★锚串选择：`modelDegraded = true` 单独一行**命中 2 次**（批 D 的抛错分支也有一处）；
    //   多行锚串在本仓 CRLF 源码上会命中 0（已踩过两次）。⇒ 用**唯一**的单行 `modelDegradeReason`
    //   行作锚，并把替换文本写成「布尔复位 + 原因清空」两行 ⇒ 等价于「不设留痕」。
    const A1 = "        modelDegradeReason = (!d.provider || !d.model) ? 'source-model-unknown' : 'selectModel-unavailable'"
    const m1 = await loadEngine([[A1, "        modelDegraded = false\n        modelDegradeReason = ''"]])
    const mIso = isolate('mut2')   // ★独立 HOME：★被接续闩是持久的，复用同一 SID 会让第二次调用直接 'already continued'
    try {
      const { eng } = mkEng(m1, mIso, { model: '' }, {})
      const res = await eng.hostAutoContinue()
      eq(res.modelDegraded, false, '★ 变异（留痕改回不设）=> 缺 model 时 modelDegraded=false（缺口复现，③断言必红）')
      ok(!res.modelDegradeReason, '★ 变异后无原因码（前端两条分支都不触发）')
    } finally { mIso.restore() }
    // 对照：还原后同一输入必须为 true（★同样用独立 HOME）
    const rIso = isolate('restore')
    try {
      const mod2 = await loadEngine()
      const { eng: eng2 } = mkEng(mod2, rIso, { model: '' }, {})
      const r2 = await eng2.hostAutoContinue()
      eq(r2.modelDegraded, true, '★ 还原：缺 model 时 modelDegraded=true（必绿）')
      eq(r2.modelDegradeReason, 'source-model-unknown', '★ 还原：原因码正确（必绿）')
    } finally { rIso.restore() }
  } finally { iso.restore() }
}

console.log('')
console.log('L-A9 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)
