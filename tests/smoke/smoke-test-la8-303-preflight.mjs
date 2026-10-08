/**
 * smoke-test-la8-303-preflight —— #303 第 1 点「模型继承静态预检前置」验收（2026-10-08）。
 *
 * 时序依据：hostAutoContinue 里 sc.cancel(:5415) 先于 sc.selectModel(:5492) ⇒ 任何「继承必失败」
 *   的情形，旧实现都会先停掉用户正在跑的旧回合，之后才发现模型换不过去（半路状态）。
 * 修法：把**静态可判**的失败模式（缺 provider/model、宿主无 selectModel）提前到 cancel 之前；
 *   预检失败 ⇒ 不 cancel、不预留、不建后继、不跑仪式。
 * ★与批 D 是**叠加**：预检通过后 selectModel 仍抛错 ⇒ 保持批 D（允许降级 + 如实标注）。
 *
 * 真跑真 MemoryEngine + 替身 sessionController（记录调用序列）。零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0, fail = 0
const ok = (c, n) => { if (c) { pass++; console.log('  ok - ' + n) } else { fail++; console.error('  FAIL - ' + n) } }
const eq = (a, b, n) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); ok(ja === jb, n + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }
const tmps = []
const mkroot = (t) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la8-' + t + '-')); tmps.push(d); return d }
let seq = 0
async function loadEngine (mutations = []) {
  const shim = path.join(ROOT, 'tests', 'lib', 'state-engine.mjs')
  if (!mutations.length) { delete process.env.DAM_STATE_ENGINE_SOURCE; return await import(pathToFileURL(shim).href + '?v=' + (++seq)) }
  let src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  for (const [from, to] of mutations) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 60)) + ' hits=' + hits)
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
function writeSession (home, sid, wsReal) {
  const dir = path.join(home, 'sessions', WS, sid)
  mkdirSync(dir, { recursive: true })
  const evs = [
    JSON.stringify({ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'SRC-MODEL' } } }, cwd: wsReal }),
    JSON.stringify({ type: 'request/context', data: { contextWindow: 100000, cwd: wsReal } }),
    JSON.stringify({ type: 'user/message', data: { message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } } }),
  ]
  writeFileSync(path.join(dir, 'session.jsonl'), evs.join(NLc) + NLc, 'utf8')
}

/** 造替身 controller：记录**调用序列** —— 预检是否真的拦在 cancel 之前，全靠它。 */
function mkCtl (opts) {
  opts = opts || {}
  const calls = []
  const sc = {
    create: async () => { calls.push('create'); return { sessionId: NEWID } },
    rename: async () => { calls.push('rename'); return {} },
    prompt: async () => { calls.push('prompt'); return { ok: true } },
    cancel: async () => { calls.push('cancel'); return { accepted: true } },
  }
  if (!opts.noSelectModel) {
    sc.selectModel = async () => { calls.push('select'); if (opts.selectThrows) { const e = new Error('MODEL_NOT_FOUND'); e.code = 'MODEL_NOT_FOUND'; throw e } return { ok: true } };
  }
  return { sc, calls }
}
/** 造引擎：carry 可控（provider/model 可缺），仪式可控。 */
function mkEng (mod, iso, carryFields) {
  const eng = new mod.MemoryEngine()
  const fields = Object.assign({ provider: 'p1', model: 'SRC-MODEL', reasoningEffort: 'high', contSeq: 1, transcriptPath: '', workspaceId: '', agentPreset: '', wsFallback: false }, carryFields || {})
  eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
  eng.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
  eng.markContinuedSession = async () => true
  const carryCalls = []
  eng.buildContinueCarry = async (prevSid) => {
    carryCalls.push(prevSid)
    return Object.assign({ ok: true, carryText: 'CARRY', prevSessionId: SID, ws: iso.wsReal }, fields)
  }
  eng._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === NEWID ? { session: { id: NEWID, events: [{ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'SRC-MODEL' } } } }] } } : null } : null }
  eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
  return { eng, carryCalls }
}console.log('')
console.log('[A] ① 静态预检失败：缺 model => 不得 cancel / create / 仪式（调用序列必须为空）')
{
  const iso = isolate('nomodel')
  try {
    const mod = await loadEngine()
    const { eng } = mkEng(mod, iso, { model: '' })
    const c = mkCtl({})
    eng._sessionController = c.sc
    let ritualCalls = 0
    eng.hostRefreshRitual = async () => { ritualCalls++; return { ok: true } }
    const res = await eng.hostAutoContinue()
    eq(res.ok, false, '★ 回执如实报失败（ok:false）')
    ok(String(res.error).includes('preflight failed'), '★ 错误信息指明是静态预检（实 ' + JSON.stringify(String(res.error).slice(0, 90)) + '）')
    ok(String(res.error).includes('missing-model'), '★ 原因码 missing-model')
    eq(c.calls, [], '★ **调用序列为空** —— 未 cancel / 未 create / 未 prompt（半路状态从根上消除）')
    eq(ritualCalls, 0, '★ 未跑接续仪式（#303：static failure must not cancel or run the ritual）')
    eq(eng._autoContState.executing, false, 'finally 复位 executing')
    eq(eng._autoContState.armed, null, 'finally 清 armed（不会卡在已 armed 的僵尸态）')
  } finally { iso.restore() }
}

console.log('[B] ①b 缺 provider => 同样全空')
{
  const iso = isolate('noprovider')
  try {
    const mod = await loadEngine()
    const { eng } = mkEng(mod, iso, { provider: '' })
    const c = mkCtl({})
    eng._sessionController = c.sc
    const res = await eng.hostAutoContinue()
    eq(res.ok, false, '回执失败')
    ok(String(res.error).includes('missing-provider'), '原因码 missing-provider')
    eq(c.calls, [], '★ 调用序列为空')
  } finally { iso.restore() }
}

console.log('[C] ② 宿主无 selectModel => 同样不得 cancel')
{
  const iso = isolate('nosel')
  try {
    const mod = await loadEngine()
    const { eng } = mkEng(mod, iso, {})
    const c = mkCtl({ noSelectModel: true }); delete c.sc.selectModel
    eng._sessionController = c.sc
    const res = await eng.hostAutoContinue()
    eq(res.ok, false, '回执失败')
    ok(String(res.error).includes('selectModel-unavailable'), '原因码 selectModel-unavailable')
    eq(c.calls, [], '★ 调用序列为空（delete sc.selectModel ⇒ 仍不 cancel）')
  } finally { iso.restore() }
}

console.log('[D] ③ ★叠加性：预检通过 + selectModel 抛错 => 仍 cancel，且**批 D 行为不变**')
{
  const iso = isolate('degrade')
  try {
    const mod = await loadEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const { eng } = mkEng(mod, iso, {})
    const c = mkCtl({ selectThrows: true }); delete c.sc.selectModel
    const ctl = mkCtl({ selectThrows: true })
    eng._sessionController = ctl.sc
    eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    const res = await eng.hostAutoContinue()
    ok(ctl.calls.includes('cancel'), '★ 预检**通过** ⇒ 旧回合照常被停（cancel 发生）：' + JSON.stringify(ctl.calls))
    ok(ctl.calls.includes('select'), '★ selectModel 真被调用（并被抛错）')
    ok(ctl.calls.includes('create'), '★ 后继照常创建（预检未误拦）')
    eq(res.ok, true, '★ 仍**允许降级继续**（批 D：不把用户晾在半路）')
    eq(res.modelDegraded, true, '★ modelDegraded=true（批 D 行为不变）')
    ok(String(res.modelDegradeReason).includes('MODEL_NOT_FOUND'), '★ modelDegradeReason 取 code（实 ' + JSON.stringify(res.modelDegradeReason) + '）')
    const lo = eng._autoContState.lastOk
    eq(lo.modelDegraded, true, '★ lastOk.modelDegraded=true（前端据此标注）')
    eq(lo.model, 'SRC-MODEL', '★ 回执报**真读回**的实际模型（本夹具新会话日志即 SRC-MODEL），不是未确认值')
  } finally { iso.restore() }
}

console.log('[E] ④ 守恒：预检通过的正常路径行为不变（cancel→create→select→prompt 顺序保持）')
{
  const iso = isolate('normal')
  try {
    const mod = await loadEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const { eng } = mkEng(mod, iso, {})
    const ctl = mkCtl({ selectThrows: false })
    eng._sessionController = ctl.sc
    const res = await eng.hostAutoContinue()
    eq(res.ok, true, '正常接续成功')
    eq(res.modelDegraded, false, 'modelDegraded=false')
    ok(ctl.calls.indexOf('cancel') < ctl.calls.indexOf('create'), '★ 顺序守恒：cancel 仍在 create 之前')
    ok(ctl.calls.indexOf('create') < ctl.calls.indexOf('select'), '★ select 在 create 之后')
    ok(ctl.calls.includes('prompt'), '★ 投递发生')
  } finally { iso.restore() }
}

console.log('[F] 负路径（变异必红 -> 还原必绿）')
{
  const iso = isolate('mut')
  try {
    // 变异：把预检挪回 cancel **之后** —— 等价回退本改（用「预检永不命中」模拟：判据恒 false）
    const ANCH = "      if (preflightReason) {"
    const m1 = await loadEngine([[ANCH, '      if (false) {']])
    const { eng } = mkEng(m1, iso, { model: '' })
    const ctl = mkCtl({})
    eng._sessionController = ctl.sc
    const res1 = await eng.hostAutoContinue()
    ok(ctl.calls.includes('cancel'), '★ 变异（预检失效）=> 缺 model 时**仍 cancel 了旧回合**（半路状态复现，①断言必红）实=' + JSON.stringify(ctl.calls))
    // ★注意变异后的真实行为：provider 在、model 缺 ⇒ `d.provider && d.model` 为假 ⇒ 跳过 selectModel，
    //   于是**静默降级投递并报成功**（res1.ok=true，model 为空/未确认）。这正是本改想消除的
    //   「用户旧回合已被停、却没人告知模型没沿用」的形态 —— 断言它比断言 ok:false 更贴事实。
    eq(res1.ok, true, '★ 变异后：旧回合被停 + 静默降级投递 + 报成功（无 preflight 的半路形态）')
    // 对照：还原后同一输入不得 cancel
    const mod2 = await loadEngine()
    const e2 = mkEng(mod2, iso, { model: '' })
    const c2 = mkCtl({})
    e2.eng._sessionController = c2.sc
    await e2.eng.hostAutoContinue()
    eq(c2.calls, [], '★ 还原：缺 model 时调用序列仍为空（必绿）')
  } finally { iso.restore() }
}

console.log('')
console.log('L-A8 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)
