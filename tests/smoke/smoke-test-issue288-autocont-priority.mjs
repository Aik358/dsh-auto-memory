/** #288: current host intent must outrank the previous success during a short cooldown. */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  findSessionModelPre, scanPressureSignalsPre, reusableWindowCachePre, shouldArmAutoContinuePre,
} from '../../lib/water-window.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const isolatedHome = mkdtempSync(path.join(os.tmpdir(), 'dsh-issue288-'))
for (const key of ['DSH_HOME', 'USERPROFILE', 'HOME']) process.env[key] = isolatedHome
const client = readFileSync(path.join(root, 'lib/client.js'), 'utf8')
const consumptionStart = client.indexOf('    // #287:')
const consumption = consumptionStart < 0 ? '' : client.slice(consumptionStart, client.indexOf('    function AutoContinueHost() {'))
const host = readFileSync(path.join(root, 'lib/index.js'), 'utf8')
const originalNow = Date.now
const now = 1800000000000
Date.now = () => now
let passed = 0, failed = 0
const check = (name, fn) => {
  try { fn(); passed++; console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message) }
}

function extract(src, header) {
  const start = src.indexOf(header)
  assert.ok(start >= 0, 'production function exists: ' + header)
  let depth = 0
  for (let i = start + header.length - 1; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1)
  }
  throw new Error('unbalanced production function: ' + header)
}

// Execute the actual component body with persistent hooks and controlled polling.
function mount(stateOf, config) {
  const cells = new Map(), effects = [], intervals = new Map(), opened = [], stored = new Map()
  const storage = { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, String(value)) }
  let cursor = 0, first = true, seq = 0
  const useState = initial => {
    const key = cursor++
    if (!cells.has(key)) cells.set(key, typeof initial === 'function' ? initial() : initial)
    return [cells.get(key), next => cells.set(key, typeof next === 'function' ? next(cells.get(key)) : next)]
  }
  const useRef = initial => {
    const key = cursor++
    if (!cells.has(key)) cells.set(key, { current: initial })
    return cells.get(key)
  }
  const h = (type, props) => ({ type, props })
  const render = new Function('useState', 'useRef', 'useEffect', 'h', 'L', 't', 'apiGet', 'apiPost', 'API', 'sessions', 'currentSessionIdClient', 'Iter5AutoContinue', 'configOf', 'setInterval', 'clearInterval', 'localStorage',
    consumption + '\n' + extract(client, 'function AutoContinueHost() {') + '\nreturn AutoContinueHost()')
  const show = () => {
    cursor = 0
    const result = render(useState, useRef, fn => { if (first) effects.push(fn) }, h,
      zh => zh, key => key, async endpoint => endpoint === '/config' ? config : stateOf(),
      async () => ({ ok: true }), { config: '/config', autoContState: '/state', autoContDecide: '/decide' },
      { open: sid => opened.push(sid) }, () => 'old-A', 'AutoContinueCard', d => d,
      fn => { intervals.set(++seq, fn); return seq }, id => intervals.delete(id), storage)
    first = false
    return result
  }
  const settle = async () => {
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
    return show()
  }
  show()
  for (const fn of effects.splice(0)) fn()
  return { show, settle, opened, tick: async () => { for (const fn of intervals.values()) fn(); return settle() } }
}

try {
  const { officialTriggerRatioPre } = await import('../../lib/index.js')
  const deps = {
    diag: () => {}, sessionEventsOf: session => session?.events || [],
    findSessionModelPre, scanPressureSignalsPre, reusableWindowCachePre, shouldArmAutoContinuePre, officialTriggerRatioPre,
    DEFAULT_WATER_LEVEL_THRESHOLD: .75, DEFAULT_WATER_LEVEL_AUTO_MARGIN: .9,
    DEFAULT_AUTO_CONTINUE_THRESHOLD: .75, OFFICIAL_DEFAULT_RATIO: .8, OFFICIAL_DEFAULT_HEADROOM: 65536,
    isSubAgentSession: () => false, extractSessionMessages: () => [],
    continuedSourceState: () => null, continuedSourceView: () => null,
  }
  const config = {
    autoContinueEnabled: true, autoContinueThreshold: .75, autoContinueCooldownMinutes: 1,
    handoffEnabled: false, waterLevelThresholdMode: 'auto', waterLevelThreshold: .75,
    waterLevelAutoMargin: .9, officialCompactionRatio: .8, officialHeadroomTokens: 65536,
  }
  function makeEngine(fromSid, age = 120000, scenario = 'ordinary-high') {
    const runtime = {}
    const engine = {
      config, state: {}, _autoContState: { lastRunAt: now - age, lastOk: { sessionId: 'previous-new', fromSid, model: 'fixture' } },
      runtimeFor: () => runtime, resolveWaterWindow: async () => ({ window: 1000000, source: 'fixture-settings' }),
      rememberWaterRecord() {}, handoffChainEnabledPre: () => false, hasReliableSessionIdentity: () => true,
      isContinuedSession: () => false, waterKey: sid => sid, continuedSessionsFile: () => path.join(isolatedHome, 'done.json'),
    }
    for (const header of ['_resolveWaterLevelPre(triggerWin, reserve, sessModel) {', 'async checkWaterLevel(agent) {', 'checkWaterLevelAtStep(agent, minGapMs = 0) {', 'armAutoContinue(agent, wl, opts = null) {', 'autoContinueState(selfSid) {']) {
      const fn = Object.values(new Function(...Object.keys(deps), 'return ({' + extract(host, header) + '})')(...Object.values(deps)))[0]
      engine[fn.name] = fn.bind(engine)
    }
    const agent = {
      session: { id: 'old-A', events: [
        { seq: 1, type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture-model', maxTokens: scenario === 'wall' ? 600000 : scenario === 'ordinary-high' ? 100000 : 384000 } } } },
        { seq: 2, type: 'request/context', data: { contextWindow: 1000000 } },
      ] },
      ctx: { get: () => ({ measure: () => ({ totalTokens: scenario === 'ordinary-high' ? 800000 : 450000, baseline: { kind: 'usage' } }) }) },
    }
    return { engine, agent, runtime }
  }
  async function arm(engine, agent, runtime, scenario = 'ordinary-high') {
    await engine.checkWaterLevel(agent)
    if (scenario === 'compaction') agent.session.events.push({ seq: 3, type: 'compaction/summary', data: { compactionId: 'fixture-c1', summary: [] } })
    if (scenario === 'overflow') agent.session.events.push({ seq: 3, type: 'assistant/attempt', data: { stream: [{ chunk: { type: 'finish', reason: { failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } } }] } })
    engine.checkWaterLevelAtStep(agent)
    await new Promise(resolve => setImmediate(resolve))
    await new Promise(resolve => setImmediate(resolve))
  }

  for (const scenario of ['ordinary-high', 'compaction', 'overflow', 'wall']) {
    for (const fromSid of ['old-A', 'another-source']) {
      for (const dismissed of [false, true]) {
        const { engine, agent, runtime } = makeEngine(fromSid, 120000, scenario)
        const ui = mount(() => engine.autoContinueState('old-A'), config)
        const initial = await ui.settle()
        check('historical success control: ' + fromSid + '/' + dismissed, () => assert.match(initial?.props.status || '', /^✓/))
        if (dismissed) { initial.props.onDismiss(); ui.show(); await ui.tick() }
        const opensBeforeArm = ui.opened.length
        await arm(engine, agent, runtime, scenario)
        const response = engine.autoContinueState('old-A')
        check('production host arms after 1-minute cooldown: ' + scenario + '/' + fromSid + '/' + dismissed, () => {
          assert.ok(response.armed, 'current host intent exists')
          assert.equal(response.armed.triggerReason, scenario === 'ordinary-high' ? 'threshold' : scenario)
          assert.equal(response.lastOk?.at, now - 120000)
        })
        if (!dismissed) {
          const coldUi = mount(() => response, config)
          const cold = await coldUi.settle()
          check('first poll displays current intent without consuming history: ' + fromSid, () => {
            assert.equal(cold?.props.confirmation?.edgeAt, response.armed.edgeAt)
            assert.equal(cold?.props.status, '')
            assert.deepEqual(coldUi.opened, [])
          })
        }
        const current = await ui.tick()
        check(scenario + ': current intent beats ' + (dismissed ? 'dismissed' : 'visible') + ' success: ' + fromSid, () => {
          assert.equal(current?.props.confirmation?.edgeAt, response.armed.edgeAt)
          assert.equal(current?.props.confirmation?.ratio, scenario === 'ordinary-high' ? .8 : .45)
          assert.equal(current?.props.confirmation?.tokens, scenario === 'ordinary-high' ? 800000 : 450000)
          assert.equal(current?.props.confirmation?.window, 1000000)
          assert.equal(current?.props.confirmation?.ring, response.armed.ring)
          assert.equal(current?.props.confirmation?.wall, response.armed.wall)
          assert.ok(current?.props.confirmation?.reasonText)
          assert.equal(current?.props.countdown, 35)
          assert.equal(current?.props.status, '')
          assert.equal(ui.opened.length, opensBeforeArm, 'history must not navigate during a new intent')
        })
        check('source filtering still hides another session intent', () => assert.equal(engine.autoContinueState('other-window').armed, null))

        engine._autoContState.executing = true
        const executing = await ui.tick()
        check('executing beats armed and historical success', () => {
          assert.equal(executing?.props.confirmation, null)
          assert.equal(executing?.props.countdown, 0)
          assert.match(executing?.props.status || '', /^宿主正在自动接续/)
        })
        engine._autoContState.executing = false
        engine._autoContState.armed = null
        engine._autoContState.lastRunAt = now
        engine._autoContState.lastOk = { fromSid: 'old-A', sessionId: 'current-new', model: 'fixture' }
        const done = await ui.tick()
        check('normal completion clears confirmation and opens the successor once', () => {
          assert.equal(done?.props.confirmation, null)
          assert.equal(done?.props.countdown, 0)
          assert.match(done?.props.status || '', /^✓/)
          assert.equal(ui.opened.at(-1), 'current-new')
        })
        const opensAfterDone = ui.opened.length
        await ui.tick()
        check('completion navigation stays idempotent', () => assert.equal(ui.opened.length, opensAfterDone))
        done.props.onDismiss(); ui.show()
        const afterDismiss = await ui.tick()
        check('completed result remains dismissed on the next poll', () => assert.equal(afterDismiss, null))
      }
    }
  }
  const { engine, agent, runtime } = makeEngine('another-source', 30000)
  await arm(engine, agent, runtime)
  check('within cooldown does not arm', () => assert.equal(engine.autoContinueState('old-A').armed, null))
  const errorUi = mount(() => ({ error: 'fixture failure', lastOk: null, armed: null, executing: false }), config)
  const error = await errorUi.settle()
  check('error without an active intent still displays', () => assert.equal(error?.props.status, '✗ fixture failure'))
  const belowThresholdUi = mount(() => ({ armed: { ratio: .45, tokens: 450000, window: 1000000, edgeAt: now, expiresAt: now + 35000 }, lastOk: null, executing: false }), config)
  const belowThreshold = await belowThresholdUi.settle()
  check('host-authorized low ratio intent is visible', () => assert.equal(belowThreshold?.props.confirmation?.ratio, .45))
  // Serialized host intent is authoritative even when its arm ratio is below the config threshold.
  for (const fromSid of ['old-A', 'another-source']) {
    for (const dismissed of [false, true]) {
      const historical = { at: now - 120000, sessionId: 'previous-new', fromSid }
      let response = { lastOk: historical, armed: null, executing: false }
      const ui = mount(() => response, config)
      const initial = await ui.settle()
      if (dismissed) { initial.props.onDismiss(); ui.show(); await ui.tick() }
      const opensBeforeArm = ui.opened.length
      response = { ...response, armed: { ratio: .45, tokens: 450000, window: 1000000,
        triggerReason: 'compaction', hard: true, edgeAt: now, expiresAt: now + 35000 } }
      const current = await ui.tick()
      check('serialized low arm ratio beats history: ' + fromSid + '/' + dismissed, () => {
        assert.equal(current?.props.confirmation?.ratio, .45)
        assert.equal(current?.props.confirmation?.reasonText, '检测到新的上下文压缩')
        assert.equal(current?.props.confirmation?.edgeAt, now)
        assert.equal(current?.props.countdown, 35)
        assert.equal(current?.props.status, '')
        assert.equal(ui.opened.length, opensBeforeArm)
      })
    }
  }
  const low = makeEngine('another-source', 120000, 'ordinary-low')
  await arm(low.engine, low.agent, low.runtime, 'ordinary-low')
  check('ordinary low ratio is still rejected by the host', () => assert.equal(low.engine.autoContinueState('old-A').armed, null))
  const expiredUi = mount(() => ({ lastOk: { at: now - 600001, sessionId: 'expired', fromSid: 'old-A' }, armed: null, executing: false }), config)
  const expired = await expiredUi.settle()
  check('expired history neither displays nor navigates', () => { assert.equal(expired, null); assert.deepEqual(expiredUi.opened, []) })
} finally {
  Date.now = originalNow
  rmSync(isolatedHome, { recursive: true, force: true })
}
console.log('[issue288] ' + passed + ' passed, ' + failed + ' failed')
if (failed) process.exitCode = 1
