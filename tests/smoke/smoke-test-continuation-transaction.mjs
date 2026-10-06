/** Regressions for source identity, actual completion, failure and concurrent intents. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { continuationProbePre, continuationRitualEndPre } from '../../lib/continuation.js'
import { shouldArmAutoContinuePre } from '../../lib/water-window.js'

// ★本仓 CRLF：归一化后再按 LF 边界提取
const host = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const client = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function extract(src, header) {
  const start = src.indexOf(header)
  assert(start >= 0, header)
  let depth = 0
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw Error('unbalanced ' + header)
}
function compile(src, deps) { return new Function(...Object.keys(deps), 'return ' + src)(...Object.values(deps)) }
const deps = { CONTINUE_CREATE_FALLBACK_ALLOWED_CODES: ['workspace/not-found'], acquireSharedStateLock:async()=>()=>{},continuedSourceFile:()=>'/virtual/source', continuedSourceState: () => ({status:'done'}), reserveContinuedSource: async () => 'fixture-token', setContinuedSourceTarget: async () => {}, releaseContinuedSource: async () => {}, diag() {}, AbortSignal, continuationProbePre, continuationRitualEndPre, shouldArmAutoContinuePre,
  // ★2026-10-06 批次 A-1f② 配套（逐 hunk 移植自 PR#217）：armAutoContinue 新增外部依赖
  //   isSubAgentSession（子代理会话不得 arm）。抽出的方法体在 new Function 里重建，作用域中没有
  //   模块级绑定 ⇒ 必须一并注入，否则 ReferenceError 会被该方法自身的 catch 吞掉，
  //   表现为「明明达标却不 arm」（同 2026-09-14 shouldArmAutoContinuePre 的教训）。
  isSubAgentSession: (x) => { const h = x && x.session && x.session.header; if (!h) return false; if (String(h.origin || '') === 'subagent') return true; const d = Number(h.delegationDepth); return Number.isFinite(d) && d > 0 },
  DEFAULT_AUTO_CONTINUE_THRESHOLD: .75, contTitleStampPre: () => '09-30 12:00', randomUUID: () => 'ritual-request-001' }
function method(header, extra = {}) {
  const obj = compile('({' + extract(host, header) + '})', { ...deps, ...extra })
  return Object.values(obj)[0]
}
function engine() {
  const calls = [], marked = new Set()
  const e = { continuedSessionsFile: () => '/virtual/state', waterKey: sid => sid, config: { autoContinueEnabled: true, handoffEnabled: false }, state: {}, calls, marked,
    hasReliableSessionIdentity: a => !!a?.session?.id, isContinuedSession: sid => marked.has(sid),
    markContinuedSession: (from, to) => { calls.push(['mark', from, to]); marked.add(from) },
    buildContinueCarry: async sid => ({ ok: true, prevSessionId: sid, carryText: 'source task', ws: 'C:/source', workspaceId: 'workspace-source', model: 'm', provider: 'p', agentPreset: 'agent', contSeq: 1 }),
    inheritPermissionForContinue: async () => { calls.push(['permission']); return { ok: true, preset: 'workspace-write' } },
    _sessionController: {
      cancel: async r => calls.push(['cancel', r.sessionId]),
      create: async r => { calls.push(['create', r]); return { sessionId: 'successor' } },
      selectModel: async r => calls.push(['model', r]), rename: async r => calls.push(['rename', r]),
      prompt: async r => calls.push(['prompt', r.sessionId, r.requestId, r.content[0].text]),
    },
  }
  for (const h of ['armAutoContinue(agent, wl, opts = null) {', 'async tickAutoContinue() {', 'async hostAutoContinue() {', 'async decideAutoContinue(action, edgeAt, sessionId) {', 'async hostRefreshRitual(oldSid) {']) {
    const fn = method(h), name = /(?:async )?(\w+)\(/.exec(h)[1]
    e[name] = fn
  }
  return e
}
const wl = { ratio: .8, modelKnown: true }
const arm = (e, sid = 'source') => e.armAutoContinue({ session: { id: sid } }, wl)
let passed = 0
async function check(name, run) { await run(); passed++; console.log('ok - ' + name) }

await check('C01 turning off during countdown prevents interruption and creation', async () => {
  const e = engine(); arm(e); e.config.autoContinueEnabled = false; e._autoContState.armed.expiresAt = Date.now() - 1
  await e.tickAutoContinue()
  assert.deepEqual(e.calls, [])
  assert.equal(e._autoContState.armed, null)
})
await check('C02 expired source intent is neither replaced nor postponed', async () => {
  const e = engine(); arm(e); e._autoContState.armed.expiresAt = Date.now() - 1
  const intent = { ...e._autoContState.armed }
  arm(e); arm(e, 'other')
  assert.deepEqual(e._autoContState.armed, intent)
})
await check('C03 stale reject and wrong-session agree cannot change current intent', async () => {
  const e = engine(); arm(e)
  const edge = e._autoContState.armed.edgeAt
  assert.equal((await e.decideAutoContinue('reject', edge - 1, 'source')).ok, false)
  assert.equal((await e.decideAutoContinue('agree', edge, 'other')).ok, false)
  assert(e._autoContState.armed)
  assert.equal((await e.decideAutoContinue('reject', edge, 'source')).rejected, true)
  assert.equal(e._autoContState.armed, null)
})
const ritualEvents = (id, ended = false) => [
  { seq: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 2, type: 'user/message', data: { source: { rpcId: id } } },
  { seq: 3, type: 'tool/call', data: { name: 'read' } },
  ...(ended ? [{ seq: 4, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }] : []),
]
await check('C04 first tool call and unrelated request cannot finish the ritual', async () => {
  assert.equal(continuationRitualEndPre(ritualEvents('other', true), 'wanted', -1), '')
  assert.equal(continuationRitualEndPre(ritualEvents('wanted'), 'wanted', -1), '')
  let polls = 0, requestId
  const e = engine(); e.config.handoffEnabled = true; e._ritualPollMs = 1
  let stamps = 0
  e.handoffMaterialStamp = async () => 'stamp-' + stamps++
  e.refreshRitualPrompt = () => 'ritual'
  e._sessionController.inspect = async () => ({ meta: { id: 'source' }, events: requestId ? ritualEvents(requestId, ++polls >= 2) : [] })
  e._sessionController.prompt = async r => { requestId = r.requestId }
  const result = await e.hostRefreshRitual('source')
  assert.equal(result.waited, 'updated')
  assert.equal(polls, 2)
})
await check('C05 permission-only callback cannot commit continuation', async () => {
  const routeOffset = host.indexOf("path: API['handoff-permission']")
  const src = extract(host.slice(routeOffset), 'handler: async (req, res) => {').replace(/^handler: /, '')
  const e = engine()
  const handler = compile('(' + src + ')', { engine: e, isLoopbackRequest: () => true,
    readJsonBody: async () => ({ fromSessionId: 'source', toSessionId: 'empty' }), writeJson() {} })
  await handler({}, {})
  assert.equal(e.marked.size, 0)
})
await check('C05 ambiguous creation failure retains pending without delivery or completion', async () => {
  const e = engine()
  e._sessionController.create = async () => { throw Error('create rejected before delivery') }
  const bad = await e.decideAutoContinue('manual', null, 'source')
  assert.equal(bad.ok, false)
  assert.equal(bad.continuationPending, true)
  assert.equal(e.marked.size, 0)
  assert.equal(e._autoContState.executing, false)
  assert(!e.calls.some(c => c[0] === 'prompt'))
})
await check('C06 simultaneous manual/automatic intents create only one successor', async () => {
  const e = engine(); arm(e)
  let release
  const gate = new Promise(r => { release = r })
  const create = e._sessionController.create
  e._sessionController.create = async r => { await gate; return create(r) }
  const automatic = e.hostAutoContinue()
  const manual = await e.decideAutoContinue('manual', null, 'source')
  assert.equal(manual.ok, false)
  assert.equal(manual.error, 'already executing')
  release(); assert.equal((await automatic).ok, true)
  assert.equal((await e.decideAutoContinue('manual', null, 'source')).sessionId, 'successor')
  assert.equal(e.calls.filter(c => c[0] === 'create').length, 1)
})
const assemble = compile('(' + extract(host, 'export function assembleCarryPre({ head = [], nav = [], bulk = [], budget = 18000 } = {}) {').replace(/^export /, '') + ')', {})
const carry = method('async buildContinueCarry(preferSid) {', { path, assembleCarryPre: assemble,
  stat: async () => { throw Error('ENOENT') }, readdir: async () => [] })
function carryEngine() {
  return { config: { handoffEnabled: true }, resolvePathsForSession: async () => ({ ws: 'C:/source', wsBound: true, planPath: 'C:/source/PLAN.md', handoffDir: 'C:/source/handoff' }),
    readTextSafe: async p => p.includes('other') ? 'FOREIGN TASK' : '', readLatestHandoff: async () => '',
    findLatestGlobalHandoff: async () => { throw Error('foreign workspace must not be scanned') },
    buildPrevSessionPack: async () => ({ sessionId: 'source', cwd: 'C:/source', tailText: 'source task', msgCount: 1 }),
    sessionWorkspaceFallback: async () => 'C:/source', resolveWorkspaceIdForSession: () => 'workspace-source', allocContSeq: async () => 1 }
}
await check('C07 no unrelated workspace ledger is imported when source has none', async () => {
  const result = await carry.call(carryEngine(), 'source')
  assert(result.ok && result.carryText.includes('source task'))
  assert(!result.carryText.includes('FOREIGN TASK'))
})
await check('C08 empty pack and unknown workspace are refused before cancelling work', async () => {
  const c = carryEngine(); c.config.handoffEnabled = false; c.buildPrevSessionPack = async () => ({ sessionId: 'source' })
  assert.equal((await carry.call(c, 'source')).ok, false)
  const e = engine(); e.buildContinueCarry = sid => carry.call(c, sid)
  assert.equal((await e.decideAutoContinue('manual', null, 'source')).ok, false)
  assert.deepEqual(e.calls, [])
  c.resolvePathsForSession = async () => ({ wsBound: false, ws: 'C:/other' })
  assert.equal((await carry.call(c, 'source')).error, 'source workspace unavailable')
})
await check('C09 browser pins source before network and opens only returned successor', async () => {
  let sid = 'A', posted, opened
  const run = compile('(' + extract(client, 'async function runContinueFlow(opts) {') + ')', {
    currentSessionIdClient: () => sid, continueFlowBusy: false, L: (zh, en) => en, API: { autoContDecide: 'decide' },
    apiPost: async (p, body) => { posted = body; sid = 'B'; return { ok: true, sessionId: 'successor-A' } }, sessions: { open: s => { opened = s } },
  })
  await run()
  assert.deepEqual(posted, { action: 'manual', sessionId: 'A' })
  assert.equal(opened, 'successor-A')
})
await check('C10 manual uses stop, model, permission, delivery, then commit order', async () => {
  const e = engine()
  const r = await e.decideAutoContinue('manual', null, 'source')
  assert.equal(r.ok, true)
  const names = e.calls.map(c => c[0])
  assert(names.indexOf('cancel') < names.indexOf('create'))
  assert(names.indexOf('model') < names.indexOf('prompt'))
  assert(names.indexOf('permission') < names.indexOf('prompt'))
  assert(names.indexOf('prompt') < names.indexOf('mark'))
  assert.equal(e.calls.find(c => c[0] === 'cancel')[1], 'source')
})
await check('C11 unresponsive inspection is bounded and releases the execution lock', async () => {
  const e = engine(); e.config.handoffEnabled = true; e._ritualPollMs = 1
  e.handoffMaterialStamp = async () => 'unchanged'; e.refreshRitualPrompt = () => 'ritual'
  let reads = 0
  e._sessionController.inspect = async (sid, signal) => { assert(signal); return ++reads === 1 ? { events: [] } : new Promise(() => {}) }
  e.hostRefreshRitual = method('async hostRefreshRitual(oldSid) {', {
    continuationProbePre: (probe, ms) => { assert(ms > 0 && ms <= 30000); return continuationProbePre(probe, Math.min(20, ms)) },
  })
  const result = await e.decideAutoContinue('manual', null, 'source')
  assert.equal(result.ok, false)
  assert(result.error.includes('timed out'))
  assert.equal(e._autoContState.executing, false)
  assert(!e.calls.some(c => c[0] === 'create'))
})
await check('scope fallback cannot create a target in the host default workspace', async () => {
  const e = engine()
  e._sessionController.create = async r => { assert(r.workspaceId || r.cwd); throw Error('source workspace rejected') }
  assert.equal((await e.decideAutoContinue('manual', null, 'source')).ok, false)
  assert.equal(e.marked.size, 0)
})
console.log(`[continuation-transaction] ${passed} cases passed`)
