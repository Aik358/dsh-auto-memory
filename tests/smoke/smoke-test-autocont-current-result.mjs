/** Full engine and production UI; isolated disk/session/hooks, no provider calls. */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = mkdtempSync(path.join(tmpdir(), 'dam-autocont-result-'))
for (const name of ['DSH_HOME', 'USERPROFILE', 'HOME']) process.env[name] = root
globalThis.fetch = async () => { throw Error('network blocked') }
const { MemoryEngine, flushDiagnostics } = await import('../lib/state-engine.mjs')
const src = readFileSync(fileURLToPath(new URL('../../lib/client.js', import.meta.url)), 'utf8')
const hostStart = src.indexOf('    function AutoContinueHost() {')
const helperStart = src.indexOf('    // #287:')
const end = src.indexOf('    // ★P10-T1/T2', hostStart)
assert.ok(hostStart >= 0 && end > hostStart)
const code = src.slice(helperStart >= 0 ? helperStart : hostStart, end)
const selected = { provider: 'fixture-provider', model: 'fixture-model', reasoningEffort: 'high' }
const previous = () => ({ sessionId: 'previous-target', fromSid: 'previous-source', model: 'previous-model' })

function mount(state) {
  const cells = [], effects = [], cleanups = [], intervals = new Map(), opened = [], values = new Map()
  let cursor = 0, seq = 0, host
  const context = vm.createContext({
    localStorage: { getItem: k => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)) },
    Date: { now: () => Date.now() },
    useState(init) {
      const i = cursor++
      if (!(i in cells)) cells[i] = typeof init === 'function' ? init() : init
      return [cells[i], v => { cells[i] = typeof v === 'function' ? v(cells[i]) : v }]
    },
    useRef(init) { const i = cursor++; if (!(i in cells)) cells[i] = { current: init }; return cells[i] },
    useEffect(fn, deps) {
      const i = cursor++, prev = cells[i]
      if (!prev || deps.some((d, j) => d !== prev[j])) {
        cells[i] = deps; effects.push(() => { if (cleanups[i]) cleanups[i](); cleanups[i] = fn() })
      }
    },
    setInterval(fn) { const id = ++seq; intervals.set(id, fn); return id },
    clearInterval: id => intervals.delete(id),
    h: (type, props) => ({ type, props }), Iter5AutoContinue: 'card',
    L: zh => zh, t: key => key, configOf: d => d,
    API: { config: 'config', autoContState: 'state', autoContDecide: 'decide' },
    apiGet: url => Promise.resolve(url === 'config' ? { autoContinueThreshold: .75 } : host.state),
    apiPost: () => Promise.resolve({ ok: true }),
    sessions: { open: sid => opened.push(sid) }, currentSessionIdClient: () => 'previous-source',
  })
  vm.runInContext(code, context)
  host = {
    state, opened,
    render() { cursor = 0; return context.AutoContinueHost() },
    async settle() {
      for (let i = 0; i < 4; i++) {
        host.view = host.render(); effects.splice(0).forEach(fn => fn())
        await new Promise(resolve => setImmediate(resolve))
      }
      host.view = host.render()
    },
    async tick(state = host.state) { host.state = state; intervals.forEach(fn => fn()); await host.settle() },
    async dismiss() { host.view.props.onDismiss(); await host.settle() },
    unmount() { cleanups.forEach(fn => { if (fn) fn() }) },
  }
  return host
}

function engine(sid, reject = false) {
  const e = new MemoryEngine(), calls = []
  e.config = { autoContinueEnabled: true, handoffEnabled: false }
  const at = Date.now() - 120000
  e._autoContState = { lastRunAt: at, lastOk: previous() }
  e.buildContinueCarry = async prevSessionId => ({ ok: true, prevSessionId, carryText: 'fixture task', ws: root,
    ...(reject ? selected : {}) })
  e.inheritPermissionForContinue = async () => ({ ok: false })
  e._sessionController = {
    cancel: async () => { calls.push('cancel') },
    create: async () => { calls.push('create'); return { sessionId: sid + '-next' } },
    selectModel: async () => { calls.push('selectModel'); if (reject) throw Error('fixture selection rejected'); return { selected } },
    prompt: async r => { calls.push(r.sessionId === sid + '-next' ? 'deliver' : 'notify') },
  }
  return { e, calls, at }
}

let passed = 0, failed = 0
const flights = []
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message) }
}
try {
  for (const reject of [false, true]) for (const consumed of [false, true]) {
    await check(`${reject ? 'selection pending' : 'preflight failure'} replaces ${consumed ? 'consumed' : 'visible'} previous success`, async () => {
      const sid = 'source-' + reject + '-' + consumed, { e, calls, at } = engine(sid, reject)
      const h = mount(e.autoContinueState(sid))
      await h.settle(); assert.match(h.view.props.status, /^✓/)
      if (consumed) { await h.dismiss(); await h.tick(); assert.equal(h.view, null) }
      const receipt = await e.decideAutoContinue('manual', null, sid)
      assert.equal(receipt.ok, false)
      const state = e.autoContinueState(sid)
      // Check the actual rendered result first, so the negative control identifies the user-visible bug.
      await h.tick(state)
      assert.equal(h.view.props.status, '✗ ' + state.error)
      assert.equal(state.lastOk, null)
      assert.equal(state.lastRunAt, at, 'failed attempts must not change successful-run cooldown')
      assert.equal(state.executing, false); assert.equal(state.armed, null)
      assert.deepEqual(calls, reject ? ['cancel', 'create', 'selectModel'] : [])
      if (reject) {
        assert.equal(receipt.continuationPending, true)
        assert.equal(state.pending.successorId, sid + '-next')
        assert.ok(h.view.props.status.includes(state.pending.recoveryCommand))
        const retry = await e.decideAutoContinue('manual', null, sid)
        assert.equal(retry.continuationPending, true)
        assert.equal(retry.sessionId, sid + '-next')
        assert.deepEqual(calls, ['cancel', 'create', 'selectModel'], 'no duplicate successor or material delivery')
        const restarted = new MemoryEngine(); restarted.config = e.config
        await h.tick(restarted.autoContinueState(sid))
        assert.equal(h.view.props.status, '✗ ' + state.error, 'persistent pending remains visible after restart')
      } else {
        assert.equal(state.pending, null)
        // A repaired source replaces the old failure with a fresh, consumable success.
        e.buildContinueCarry = async prevSessionId => ({ ok: true, prevSessionId, carryText: 'fixture task', ws: root, ...selected })
        assert.equal((await e.decideAutoContinue('manual', null, sid)).ok, true)
        const success = e.autoContinueState(sid)
        assert.equal(success.error, ''); assert.equal(success.pending, null)
        assert.equal(success.lastOk.sessionId, sid + '-next')
        await h.tick(success); assert.match(h.view.props.status, /^✓/)
        await h.dismiss(); await h.tick(); assert.equal(h.view, null)
        assert.equal((await e.decideAutoContinue('manual', null, sid)).ok, true, 'success replay remains idempotent')
        assert.deepEqual(calls, ['cancel', 'create', 'selectModel', 'deliver', 'notify'])
      }
      h.unmount()
    })
  }
  await check('accepted armed execution clears history before asynchronous preflight', async () => {
    const sid = 'armed-source', { e, at } = engine(sid)
    const history = e._autoContState.lastOk
    e._autoContState.armed = { sessionId: sid, edgeAt: at, expiresAt: Date.now() + 10000, ratio: .8 }
    assert.equal(e._autoContState.lastOk, history, 'arming does not consume success')
    assert.equal((await e.decideAutoContinue('agree', at + 1, sid)).ok, false)
    assert.equal(e._autoContState.lastOk, history, 'stale decisions preserve result')
    const h = mount({ armed: e.autoContinueState(sid).armed })
    await h.settle(); assert.ok(h.view.props.confirmation)
    const flight = e.decideAutoContinue('agree', at, sid)
    flights.push(flight)
    const running = e.autoContinueState(sid)
    await h.tick(running)
    assert.equal(running.executing, true); assert.equal(running.lastOk, null)
    assert.equal(h.view.props.confirmation, null); assert.match(h.view.props.status, /宿主正在自动接续/)
    await flight; await h.tick(e.autoContinueState(sid)); assert.match(h.view.props.status, /^✗/)
    h.unmount()
  })
  await check('entry guards and expired history preserve cooldown semantics', async () => {
    const { e, at } = engine('guard-source'), history = e._autoContState.lastOk
    await e.hostAutoContinue(); assert.equal(e._autoContState.lastOk, history)
    e._autoContState.executing = true
    await e.decideAutoContinue('manual', null, 'guard-source'); assert.equal(e._autoContState.lastOk, history)
    e._autoContState.executing = false; e.config.autoContinueEnabled = false
    e._autoContState.armed = { sessionId: 'guard-source' }
    await e.hostAutoContinue(); assert.equal(e._autoContState.lastOk, history)
    e._autoContState.lastRunAt = at - 600000
    const h = mount(e.autoContinueState('guard-source')); await h.settle(); assert.equal(h.view, null)
    await e.decideAutoContinue('manual', null, 'guard-source')
    await h.tick(e.autoContinueState('guard-source')); assert.match(h.view.props.status, /^✗/)
    assert.equal(e._autoContState.lastRunAt, at - 600000)
    h.unmount()
  })
} finally {
  await Promise.allSettled(flights)
  await flushDiagnostics()
  rmSync(root, { recursive: true, force: true })
}
console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
