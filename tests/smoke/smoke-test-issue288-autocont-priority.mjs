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
  const cells = new Map(), effects = [], intervals = new Map(), opened = []
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
  const render = new Function('useState', 'useRef', 'useEffect', 'h', 'L', 't', 'apiGet', 'apiPost', 'API', 'sessions', 'currentSessionIdClient', 'Iter5AutoContinue', 'configOf', 'setInterval', 'clearInterval',
    extract(client, 'function AutoContinueHost() {') + '\nreturn AutoContinueHost()')
  const show = () => {
    cursor = 0
    const result = render(useState, useRef, fn => { if (first) effects.push(fn) }, h,
      zh => zh, key => key, async endpoint => endpoint === '/config' ? config : stateOf(),
      async () => ({ ok: true }), { config: '/config', autoContState: '/state', autoContDecide: '/decide' },
      { open: sid => opened.push(sid) }, () => 'old-A', 'AutoContinueCard', d => d,
      fn => { intervals.set(++seq, fn); return seq }, id => intervals.delete(id))
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
  function makeEngine(fromSid, age = 120000) {
    const runtime = {}
    const engine = {
      config, state: {}, _autoContState: { lastRunAt: now - age, lastOk: { sessionId: 'previous-new', fromSid, model: 'fixture' } },
      runtimeFor: () => runtime, resolveWaterWindow: async () => ({ window: 1000000, source: 'fixture-settings' }),
      rememberWaterRecord() {}, handoffChainEnabledPre: () => false, hasReliableSessionIdentity: () => true,
      isContinuedSession: () => false, waterKey: sid => sid, continuedSessionsFile: () => path.join(isolatedHome, 'done.json'),
    }
    for (const header of ['_resolveWaterLevelPre(triggerWin, reserve, sessModel) {', 'async checkWaterLevel(agent) {', 'armAutoContinue(agent, wl, opts = null) {', 'autoContinueState(selfSid) {']) {
      const fn = Object.values(new Function(...Object.keys(deps), 'return ({' + extract(host, header) + '})')(...Object.values(deps)))[0]
      engine[fn.name] = fn.bind(engine)
    }
    const agent = {
      session: { id: 'old-A', events: [
        { seq: 1, type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'fixture-model', maxTokens: 384000 } } } },
        { seq: 2, type: 'request/context', data: { contextWindow: 1000000 } },
      ] },
      ctx: { get: () => ({ measure: () => ({ totalTokens: 800000, baseline: { kind: 'usage' } }) }) },
    }
    return { engine, agent, runtime }
  }
  async function arm(engine, agent, runtime) {
    await engine.checkWaterLevel(agent)
    engine.armAutoContinue(agent, {
      ratio: runtime.waterLevel, tokens: runtime.waterLevelTokens, window: runtime.waterLevelWindow,
      modelKnown: runtime.waterLevelModelKnown, hard: runtime.waterLevelHard,
    }, { awaitIdle: true })
  }

  for (const fromSid of ['old-A', 'another-source']) {
    for (const dismissed of [false, true]) {
      const { engine, agent, runtime } = makeEngine(fromSid)
      const ui = mount(() => engine.autoContinueState('old-A'), config)
      const initial = await ui.settle()
      check('historical success control: ' + fromSid + '/' + dismissed, () => assert.match(initial?.props.status || '', /^✓/))
      if (dismissed) { initial.props.onDismiss(); ui.show(); await ui.tick() }
      const opensBeforeArm = ui.opened.length
      await arm(engine, agent, runtime)
      const response = engine.autoContinueState('old-A')
      check('production host arms after 1-minute cooldown: ' + fromSid + '/' + dismissed, () => {
        assert.equal(response.armed?.ratio, .8)
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
      check('current intent beats ' + (dismissed ? 'dismissed' : 'visible') + ' success: ' + fromSid, () => {
        assert.equal(current?.props.confirmation?.edgeAt, response.armed.edgeAt)
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
  const { engine, agent, runtime } = makeEngine('another-source', 30000)
  await arm(engine, agent, runtime)
  check('within cooldown does not arm', () => assert.equal(engine.autoContinueState('old-A').armed, null))
  const errorUi = mount(() => ({ error: 'fixture failure', lastOk: null, armed: null, executing: false }), config)
  const error = await errorUi.settle()
  check('error without an active intent still displays', () => assert.equal(error?.props.status, '✗ fixture failure'))
  const belowThresholdUi = mount(() => ({ armed: { ratio: .45, edgeAt: now, expiresAt: now + 35000 }, lastOk: null, executing: false }), config)
  const belowThreshold = await belowThresholdUi.settle()
  check('ordinary client threshold behavior is unchanged', () => assert.equal(belowThreshold, null))
} finally {
  Date.now = originalNow
  rmSync(isolatedHome, { recursive: true, force: true })
}
console.log('[issue288] ' + passed + ' passed, ' + failed + ' failed')
if (failed) process.exitCode = 1
