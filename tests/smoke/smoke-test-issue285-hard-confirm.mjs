// Production water measurement -> pre-step arm -> state -> confirmation -> decision.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { findSessionModelPre, scanPressureSignalsPre, reusableWindowCachePre, shouldArmAutoContinuePre } from '../../lib/water-window.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const isolated = mkdtempSync(path.join(os.tmpdir(), 'dsh-issue285-'))
const env = Object.fromEntries(['DSH_HOME', 'USERPROFILE', 'HOME'].map(k => [k, process.env[k]]))
for (const k of Object.keys(env)) process.env[k] = isolated
const originalNow = Date.now
const now = 1800000000000
Date.now = () => now
const sleep = () => new Promise(resolve => setImmediate(resolve))
const fixtures = {}
try {
  const { officialTriggerRatioPre } = await import('../../lib/index.js')
  const src = readFileSync(path.join(root, 'lib/index.js'), 'utf8')
  const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  function extract(header) {
    const start = src.indexOf(header)
    assert.ok(start >= 0, header)
    let depth = 0
    for (let i = start + header.length - 1; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
    }
    throw new Error('unbalanced: ' + header)
  }
  const deps = {
    diag: () => {}, sessionEventsOf: s => s?.events || [], findSessionModelPre,
    scanPressureSignalsPre, reusableWindowCachePre, shouldArmAutoContinuePre, officialTriggerRatioPre,
    DEFAULT_WATER_LEVEL_THRESHOLD: .75, DEFAULT_WATER_LEVEL_AUTO_MARGIN: .9,
    DEFAULT_AUTO_CONTINUE_THRESHOLD: .75, OFFICIAL_DEFAULT_RATIO: .8, OFFICIAL_DEFAULT_HEADROOM: 65536,
    isSubAgentSession: () => false, extractSessionMessages: () => [],
    continuedSourceState: () => null, continuedSourceView: () => null,
  }
  const compile = header => Object.values(new Function(...Object.keys(deps), 'return ({' + extract(header) + '})')(...Object.values(deps)))[0]
  // Reuse the existing controlled hooks; execute the current component body and real handlers.
  const test = readFileSync(path.join(root, 'tests/smoke/smoke-test-issue278-autocont-dismiss.mjs'), 'utf8')
  const helper = test.slice(test.indexOf('function extractFnBody (src, header) {'), test.indexOf('/* ---------- ③ 断言 ---------- */'))
    .replace('const apiPost = () => Promise.resolve({ ok: true })', 'const apiPost = o.apiPost || (() => Promise.resolve({ ok: true }))')
  const { mountAutoContinueHost } = new Function('SRC', 'ok', 'sleep', helper + ';return {mountAutoContinueHost}')(client, () => {}, sleep)
  for (const scenario of ['ordinary-low', 'compaction', 'overflow', 'wall', 'ordinary-high']) {
    const rt = {}, state = {}, calls = []
    const config = { autoContinueEnabled: true, autoContinueThreshold: .75, autoContinueCooldownMinutes: 1,
      handoffEnabled: false, waterLevelThresholdMode: 'auto', waterLevelAutoMargin: .9,
      officialCompactionRatio: .8, officialHeadroomTokens: 65536 }
    const tokens = scenario === 'ordinary-high' ? 800000 : 450000
    const agent = { session: { id: 'old-A', events: [
      { seq: 1, type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture-model', maxTokens: scenario === 'wall' ? 600000 : scenario === 'ordinary-high' ? 100000 : 384000 } } } },
      { seq: 2, type: 'request/context', data: { contextWindow: 1000000 } },
    ] }, ctx: { get: () => ({ measure: () => ({ totalTokens: tokens, baseline: { kind: 'usage' } }) }) } }
    const e = { config, state, runtimeFor: () => rt, resolveWaterWindow: async () => ({ window: 1000000, source: 'fixture-settings' }),
      rememberWaterRecord() {}, handoffChainEnabledPre: () => false, hasReliableSessionIdentity: () => true,
      isContinuedSession: () => false, waterKey: s => s, continuedSessionsFile: () => path.join(isolated, 'state'),
      hostAutoContinue: async () => { calls.push('execute'); e._autoContState.armed = null; return { ok: true } },
    }
    for (const header of ['_resolveWaterLevelPre(triggerWin, reserve, sessModel) {', 'async checkWaterLevel(agent) {',
      'checkWaterLevelAtStep(agent, minGapMs = 0) {', 'armAutoContinue(agent, wl, opts = null) {',
      'autoContinueState(selfSid) {', 'async decideAutoContinue(action, edgeAt, sessionId) {']) {
      const f = compile(header); e[f.name] = f.bind(e)
    }
    await e.checkWaterLevel(agent)
    if (scenario === 'compaction') agent.session.events.push({ seq: 3, type: 'compaction/summary', data: { compactionId: 'fixture-c1', summary: [] } })
    if (scenario === 'overflow') agent.session.events.push({ seq: 3, type: 'assistant/attempt', data: { stream: [{ chunk: { type: 'finish', reason: { failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } } }] } })
    e.checkWaterLevelAtStep(agent)
    await sleep(); await sleep()
    const response = e.autoContinueState('old-A')
    fixtures[scenario] = { config, response }
    const expectedArmed = scenario !== 'ordinary-low'
    assert.equal(!!response.armed, expectedArmed, scenario + ': host eligibility')
    assert.equal(e.autoContinueState('other-session').armed, null, 'session ownership remains enforced')
    const posts = []
    const h = mountAutoContinueHost({ sid: 'old-A', apiGet: async endpoint => endpoint === '/api/config' ? config : e.autoContinueState('old-A'),
      apiPost: async (endpoint, payload) => { posts.push(payload); return e.decideAutoContinue(payload.action, payload.edgeAt) } })
    h.show(); h.runEffects(); await h.settle()
    const card = h.lastRender()?.props?.confirmation
    assert.equal(!!card, expectedArmed, scenario + ': host armed must be visible below ordinary threshold')
    if (!expectedArmed) { console.log('PASS ' + scenario); continue }
    assert.equal(response.armed.triggerReason, ['compaction', 'overflow', 'wall'].includes(scenario) ? scenario : 'threshold')
    await e.checkWaterLevel(agent)
    assert.equal(e.autoContinueState('old-A').armed.triggerReason, response.armed.triggerReason, 'pending intent preserves its trigger across later measurements')
    assert.equal(card.ratio, tokens / 1000000, 'display measured use, not the raised arm ratio')
    assert.equal(card.ring, response.armed.ring, 'preserve host ring reading')
    assert.equal(card.wall, response.armed.wall, 'preserve host wall reading')
    assert.ok(card.reasonText, 'display a trigger explanation')
    assert.equal(h.lastRender().props.countdown, (response.armed.expiresAt - now) / 1000, 'same host deadline')
    const stale = await e.decideAutoContinue('agree', response.armed.edgeAt - 1)
    assert.equal(stale.ok, false, 'stale decision cannot execute')
    for (const action of ['reject', 'agree']) {
      e._autoContState.armed = { ...response.armed }
      await h.tick()
      const props = h.lastRender().props
      props[action === 'agree' ? 'onAgree' : 'onReject']()
      await h.settle()
      assert.deepEqual(posts.at(-1), { action, edgeAt: response.armed.edgeAt }, 'decision targets the displayed intent')
      assert.equal(e._autoContState.armed, null, action + ' clears host intent')
      assert.equal(!!h.lastRender()?.props?.confirmation, false, action + ' clears confirmation')
      if (action === 'reject') assert.equal(calls.length, 0, 'reject never executes')
      else assert.deepEqual(calls, ['execute'], 'agree executes once')
    }
    console.log('PASS ' + scenario + ' (reason/use/deadline/agree/reject/stale)')
  }
  if (process.argv.includes('--browser-fixtures')) {
    const out = path.join(root, 'artifacts/issue285')
    mkdirSync(out, { recursive: true })
    writeFileSync(path.join(out, 'fixtures.json'), JSON.stringify(fixtures, null, 2))
  }
} finally {
  Date.now = originalNow
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  rmSync(isolated, { recursive: true, force: true })
}
