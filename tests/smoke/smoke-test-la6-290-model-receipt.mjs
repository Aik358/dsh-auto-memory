/**
 * smoke-test-la6-290-model-receipt —— #290 模型继承失败静默降级验收（2026-10-08）。
 *
 * 缺陷：hostAutoContinue 里 selectModel 失败**只 diag**（异常被吞），且 st.lastOk.model / 返回体
 *   无条件复制请求值 d.model ⇒ 实测「delivered=宿主默认，reported=源模型」、error 空、completed=true。
 *
 * 用户裁定：**允许降级，但必须如实标注**（依据：停旧回合 sc.cancel 在 :5415、模型继承在 :5492
 *   ⇒ 停旧回合先于模型继承，「继承失败即拒绝投递」会把用户晾在半路）。
 * 修法：捕获失败 → modelDegraded/modelDegradeReason；回执改报**已确认的实际模型**
 *   （agentForSessionId → sessionEventsOf → findSessionModelPre 真读回），读不回来则 '' + modelConfirmed:false。
 *
 * 真跑真 MemoryEngine + 替身 sessionController + 真隔离 DSH_HOME/会话文件。零依赖、不联网。
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
const mkroot = (t) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la6-' + t + '-')); tmps.push(d); return d }
let seq = 0
async function loadEngine(mutations = []) {
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
function isolate(tag) {
  const root = mkroot(tag), home = path.join(root, 'home'), wsReal = path.join(root, 'realws')
  mkdirSync(home, { recursive: true }); mkdirSync(wsReal, { recursive: true })
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = home }
  return { root, home, wsReal, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } } }
}
const WS = '--D--ws--'
const SID = 'aaaaaaaa-1111-2222-3333-444444444444'
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
}/** 造一个可控的替身 sessionController：create 建新会话、selectModel 可控成功/抛错、
 *  并且**模拟真实宿主行为** —— selectModel 成功时把模型写进新会话的 request/header（供读回）。
 *  readbackEvents 用于注入「新会话日志里实际写了什么」。 */
function mkController (mod, iso, opts) {
  const calls = { selectModel: 0, cancel: 0, prompt: 0 }
  const newId = 'bbbbbbbb-2222-3333-4444-555555555555'
  const writtenModel = opts.writtenModel === undefined ? 'SRC-MODEL' : opts.writtenModel
  const sc = {
    create: async () => ({ sessionId: newId }),
    rename: async () => ({}),
    prompt: async () => { calls.prompt++; return { ok: true } },
    cancel: async () => { calls.cancel++; return { accepted: true } },
    selectModel: async () => {
      calls.selectModel++
      if (opts.selectModelThrows) { const e = new Error('MODEL_NOT_FOUND: no such model'); e.code = 'MODEL_NOT_FOUND'; throw e }
      return { ok: true }
    },
  }
  return { sc, calls, newId, writtenModel }
}

console.log('[A] #290 正路径：selectModel 成功 ⇒ 回执报**已确认**的实际模型')
{
  const iso = isolate('ok')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const { sc, calls, newId } = mkController(mod, iso, { selectModelThrows: false })
    eng._sessionController = sc
    // 新会话在 prompt 后才建：这里让 agentForSessionId 能取到新会话，且其日志里已写入请求的模型
    eng._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === newId ? { session: { id: newId, events: [
      { type: 'request/header', data: { header: { config: { provider: 'p1', model: 'SRC-MODEL' } } } },
    ] } } : null } : null }
    eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
    // 让 carry 成功（避免被其它前置挡住）：直接替身 buildContinueCarry
    eng.buildContinueCarry = async () => ({ ok: true, carryText: 'CARRY', prevSessionId: SID, ws: iso.wsReal, workspaceId: '', provider: 'p1', model: 'SRC-MODEL', reasoningEffort: '', agentPreset: '', wsFallback: false, contSeq: 1, transcriptPath: '' })
    eng.markContinuedSession = async () => true
    eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    eng.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
    const res = await eng.hostAutoContinue()
    ok(res && res.ok === true, '接续成功（' + JSON.stringify(res && res.error) + '）')
    eq(calls.selectModel, 1, 'selectModel 被真实调用一次')
    eq(res.model, 'SRC-MODEL', '★ 成功路径：回执 model = 已确认的实际模型（与请求值一致 ⇒ 输出与既有行为相同）')
    eq(res.modelConfirmed, true, '★ modelConfirmed=true（确已确认）')
    eq(res.modelDegraded, false, '★ modelDegraded=false（未降级）')
    eq(eng._autoContState.lastOk.model, 'SRC-MODEL', '★ lastOk.model 同为已确认值')
    eq(eng._autoContState.lastOk.modelDegraded, false, '★ lastOk.modelDegraded=false')
  } finally { iso.restore() }
}

console.log('[B] #290 缺陷路径：selectModel 抛错 ⇒ 回执**不得**含未确认的请求值 + 明确降级标记')
{
  const iso = isolate('bad')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const { sc, calls, newId } = mkController(mod, iso, { selectModelThrows: true })
    eng._sessionController = sc
    // 关键：新会话日志里写入的是**宿主默认模型**（不是请求值）—— 真实降级场景
    eng._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === newId ? { session: { id: newId, events: [
      { type: 'request/header', data: { header: { config: { provider: 'p1', model: 'HOST-DEFAULT' } } } },
    ] } } : null } : null }
    eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
    eng.buildContinueCarry = async () => ({ ok: true, carryText: 'CARRY', prevSessionId: SID, ws: iso.wsReal, workspaceId: '', provider: 'p1', model: 'SRC-MODEL', reasoningEffort: '', agentPreset: '', wsFallback: false, contSeq: 1, transcriptPath: '' })
    eng.markContinuedSession = async () => true
    eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    eng.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
    const res = await eng.hostAutoContinue()
    eq(calls.selectModel, 1, 'selectModel 被真实调用（并抛错）')
    ok(res && res.ok === true, '★ 仍**允许降级继续**（用户裁定：不得把用户晾在半路）')
    eq(res.model, 'HOST-DEFAULT', '★ 回执 model = **真读回**的实际生效模型（不是请求值）')
    ok(res.model !== 'SRC-MODEL', '★ 回执**不再回显**未确认的请求值 SRC-MODEL（旧实现正是如此）')
    eq(res.modelDegraded, true, '★ modelDegraded=true')
    ok(String(res.modelDegradeReason).includes('MODEL_NOT_FOUND'), '★ modelDegradeReason 取 code（实 ' + JSON.stringify(res.modelDegradeReason) + '）')
    eq(res.modelConfirmed, true, '★ modelConfirmed=true（读回成功，值可信）')
    const lo = eng._autoContState.lastOk
    eq(lo.model, 'HOST-DEFAULT', '★ lastOk.model 同为读回值')
    ok(lo.model !== 'SRC-MODEL', '★ lastOk **不含**未确认请求值')
    eq(lo.modelDegraded, true, '★ lastOk.modelDegraded=true（前端据此标注）')
    eq(lo.modelRequested, 'SRC-MODEL', '★ 保留 modelRequested 供提示里说明「原请求什么」')
  } finally { iso.restore() }
}

console.log('[C] #290 读不回来 ⇒ 如实标为未知（不得用请求值冒充）')
{
  const iso = isolate('unknown')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const { sc } = mkController(mod, iso, { selectModelThrows: true })
    eng._sessionController = sc
    eng._ctxRef = { get: () => ({ get: () => null }) }  // agent 取不到 ⇒ 读不回
    eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
    eng.buildContinueCarry = async () => ({ ok: true, carryText: 'CARRY', prevSessionId: SID, ws: iso.wsReal, workspaceId: '', provider: 'p1', model: 'SRC-MODEL', reasoningEffort: '', agentPreset: '', wsFallback: false, contSeq: 1, transcriptPath: '' })
    eng.markContinuedSession = async () => true
    eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    eng.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
    const res = await eng.hostAutoContinue()
    eq(res.model, '', '★ 读不回来 ⇒ 回执 model 为空串（**不用请求值冒充**）')
    eq(res.modelConfirmed, false, '★ modelConfirmed=false（显式未知）')
    eq(res.modelDegraded, true, '★ 降级标记仍在（selectModel 确实失败了）')
  } finally { iso.restore() }
}

console.log('[D] 负路径（变异必红 -> 还原必绿）')
{
  const iso = isolate('mut')
  try {
    // M1：把回执改回 `model: d.model`（旧实现）=>「抛错时不得回显未确认请求值」必红
    const ANCH = "const modelReported = modelConfirmed ? modelEffective : ''"
    const m1 = await loadEngine([[ANCH, "const modelReported = d.model || ''"]])
    const e1 = new m1.MemoryEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const c1 = mkController(m1, iso, { selectModelThrows: true })
    e1._sessionController = c1.sc
    e1._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === c1.newId ? { session: { id: c1.newId, events: [{ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'HOST-DEFAULT' } } } }] } } : null } : null }
    e1._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
    e1.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    e1.buildContinueCarry = async () => ({ ok: true, carryText: 'C', prevSessionId: SID, ws: iso.wsReal, workspaceId: '', provider: 'p1', model: 'SRC-MODEL', reasoningEffort: '', agentPreset: '', wsFallback: false, contSeq: 1, transcriptPath: '' })
    e1.markContinuedSession = async () => true
    e1.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
    const r1 = await e1.hostAutoContinue()
    eq(r1.model, 'SRC-MODEL', '★ M1 变异（回执改回 d.model）=> 抛错时**回显未确认请求值**（缺陷复现，必红）')
    ok(r1.model !== 'HOST-DEFAULT', '★ M1 变异 => 回执**不再**是真实生效模型（缺陷语义完整复现）')

    // M2：去掉读回 => 成功路径也不再回显请求值（可观测差异）
    const READBACK = '          if (infoNew && infoNew.model) { modelEffective = String(infoNew.model); modelConfirmed = true; break }'
    const m2 = await loadEngine([[READBACK, '          if (false) { modelEffective = String(infoNew.model); modelConfirmed = true; break }']])
    const e2 = new m2.MemoryEngine()
    writeSession(iso.home, SID + '-m2', iso.wsReal)
    const c2 = mkController(m2, iso, { selectModelThrows: false })
    e2._sessionController = c2.sc
    e2._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === c2.newId ? { session: { id: c2.newId, events: [{ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'SRC-MODEL' } } } }] } } : null } : null }
    e2._autoContState = { armed: { sessionId: SID + '-m2', manual: true }, executing: false }
    e2.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    e2.buildContinueCarry = async () => ({ ok: true, carryText: 'C', prevSessionId: SID + '-m2', ws: iso.wsReal, workspaceId: '', provider: 'p1', model: 'SRC-MODEL', reasoningEffort: '', agentPreset: '', wsFallback: false, contSeq: 1, transcriptPath: '' })
    e2.markContinuedSession = async () => true
    e2.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
    const r2 = await e2.hostAutoContinue()
    eq(r2.model, '', '★ M2 变异（去掉读回）=> 回执为空串（不再冒充请求值）')
    eq(r2.modelConfirmed, false, '★ M2 变异 => modelConfirmed=false（显式未知）')
  } finally { iso.restore() }
}

console.log('[E] 还原必绿')
{
  const iso = isolate('restore')
  try {
    const mod = await loadEngine()
    const eng = new mod.MemoryEngine()
    writeSession(iso.home, SID, iso.wsReal)
    const c = mkController(mod, iso, { selectModelThrows: true })
    eng._sessionController = c.sc
    eng._ctxRef = { get: (n) => n === 'agents' ? { get: (id) => id === c.newId ? { session: { id: c.newId, events: [{ type: 'request/header', data: { header: { config: { provider: 'p1', model: 'HOST-DEFAULT' } } } }] } } : null } : null }
    eng._autoContState = { armed: { sessionId: SID, manual: true }, executing: false }
    eng.hostRefreshRitual = async () => ({ ok: true, waited: 'updated' })
    eng.buildContinueCarry = async () => ({ ok: true, carryText: 'C', prevSessionId: SID, ws: iso.wsReal, workspaceId: '', provider: 'p1', model: 'SRC-MODEL', reasoningEffort: '', agentPreset: '', wsFallback: false, contSeq: 1, transcriptPath: '' })
    eng.markContinuedSession = async () => true
    eng.inheritPermissionForContinue = async () => ({ ok: true, preset: 'p' })
    const res = await eng.hostAutoContinue()
    eq(res.model, 'HOST-DEFAULT', '★ 还原：回执为真读回值（必绿）')
    eq(res.modelDegraded, true, '★ 还原：降级标记仍在（必绿）')
  } finally { iso.restore() }
}

console.log('')
console.log('L-A6 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)
