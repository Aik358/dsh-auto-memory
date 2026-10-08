import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const src = readFileSync(fileURLToPath(new URL('../../lib/client.js', import.meta.url)), 'utf8')
const start = src.indexOf('    // #287:')
const hostStart = src.indexOf('    function AutoContinueHost() {')
const end = src.indexOf('    // ★P10-T1/T2', hostStart)
const code = src.slice(start >= 0 ? start : hostStart, end)
const storeKey = 'dsh-auto-memory.autocont.dismissed.v1'
const storage = () => {
  const values = new Map()
  return { getItem: (k) => values.get(k) || null, setItem: (k, v) => values.set(k, String(v)) }
}
const now = 1800000000000
const result = (at = now - 5000, sid = 'new-A') => ({ lastOk: { at, sessionId: sid, fromSid: 'old-A', model: 'fixture' } })
function page(storageImpl) {
  let active
  const context = vm.createContext({
    localStorage: storageImpl, Date: { now: () => active.time },
    useState: (v) => active.useState(v), useRef: (v) => active.useRef(v),
    useEffect: (fn, deps) => active.useEffect(fn, deps),
    setInterval: (fn) => active.interval(fn), clearInterval: (id) => active.intervals.delete(id),
    h: (type, props) => ({ type, props }), Iter5AutoContinue: 'card',
    L: (zh) => zh, t: (key) => key, configOf: (d) => d,
    API: { config: 'config', autoContState: 'state', autoContDecide: 'decide' },
    apiGet: (url) => Promise.resolve(url === 'config' ? { autoContinueThreshold: .75 } : active.state),
    apiPost: () => Promise.resolve({ ok: true }),
    sessions: { open: (sid) => active.opened.push(sid) }, currentSessionIdClient: () => 'old-A',
  })
  vm.runInContext(code, context)
  return {
    context,
    mount(state = result()) {
      const cells = [], effects = [], cleanups = [], intervals = new Map(), opened = []
      let cursor = 0, seq = 0
      const host = {
        state, time: now, intervals, opened,
        useState(init) {
          const i = cursor++
          if (!(i in cells)) cells[i] = typeof init === 'function' ? init() : init
          return [cells[i], (v) => { cells[i] = typeof v === 'function' ? v(cells[i]) : v }]
        },
        useRef(init) { const i = cursor++; if (!(i in cells)) cells[i] = { current: init }; return cells[i] },
        useEffect(fn, deps) {
          const i = cursor++, prev = cells[i]
          if (!prev || deps.some((d, j) => d !== prev[j])) {
            cells[i] = deps; effects.push(() => { if (cleanups[i]) cleanups[i](); cleanups[i] = fn() })
          }
        },
        interval(fn) { const id = ++seq; intervals.set(id, fn); return id },
        render() { active = host; cursor = 0; return context.AutoContinueHost() },
        async settle() {
          for (let i = 0; i < 4; i++) {
            host.view = host.render(); effects.splice(0).forEach((f) => f())
            await new Promise((r) => setImmediate(r))
          }
          host.view = host.render(); return host.view
        },
        async tick() { active = host; intervals.forEach((fn) => fn()); return host.settle() },
        async dismiss() { host.view.props.onDismiss(); return host.settle() },
        unmount() { active = host; cleanups.forEach((f) => { if (f) f() }) },
      }
      return host
    },
  }
}
const shown = (h) => !!h.view?.props.status?.startsWith('✓')
let passed = 0, failed = 0
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) }
}
await check('dismiss survives remount and a new page context', async () => {
  const disk = storage(), p = page(disk), h = p.mount()
  await h.settle(); assert.ok(shown(h)); await h.dismiss(); await h.tick(); assert.ok(!shown(h)); h.unmount()
  const remount = p.mount(); await remount.settle(); assert.ok(!shown(remount)); remount.unmount()
  const reload = page(disk).mount(); await reload.settle(); assert.ok(!shown(reload))
  assert.deepEqual(reload.opened, ['new-A'], 'dismissal must preserve sessions.open side effect')
  reload.state = result(now - 1000); await reload.tick(); assert.ok(shown(reload), 'changed at with same sid is new')
  await reload.dismiss(); reload.state = result(now - 1000, 'new-B'); await reload.tick(); assert.ok(shown(reload))
  await reload.dismiss(); reload.state = result(); await reload.tick(); assert.ok(!shown(reload), 'retain more than the latest identity')
})
await check('already shown success clears at the exact ten-minute boundary', async () => {
  const h = page(storage()).mount(result(now)); await h.settle(); assert.ok(shown(h))
  h.time = now + 600000 - 1; await h.tick(); assert.ok(shown(h))
  h.time++; await h.tick(); assert.ok(!shown(h))
  h.state = { armed: { ratio: .8, expiresAt: h.time + 10000 } }; await h.tick()
  assert.ok(h.view.props.confirmation); assert.ok(!shown(h))
})
await check('blocked storage falls back across component remounts', async () => {
  const p = page({ getItem() { throw Error('blocked') }, setItem() { throw Error('quota') } })
  const h = p.mount(); await h.settle(); await h.dismiss(); h.unmount()
  const remount = p.mount(); await remount.settle(); assert.ok(!shown(remount))
  remount.state = result(now, 'fresh'); await remount.tick(); assert.ok(shown(remount))
})
await check('malformed storage recovers and consumption stays bounded', async () => {
  const disk = storage(); disk.setItem(storeKey, '{broken')
  const h = page(disk).mount(); await h.settle(); assert.ok(shown(h)); await h.dismiss()
  for (let i = 0; i < 80; i++) {
    h.state = result(now, 'new-' + i); await h.tick(); assert.ok(shown(h)); await h.dismiss()
  }
  const records = JSON.parse(disk.getItem(storeKey)); assert.ok(records.length <= 64)
  assert.ok(records.some((r) => r.key.includes('new-79')))
})
await check('error and execution remain visible; expired success does not clear them', async () => {
  const h = page(storage()).mount(); await h.settle(); h.time += 660000
  h.state = { error: 'boom', lastOk: result().lastOk }; await h.tick(); assert.equal(h.view.props.status, '✗ boom')
  await h.dismiss(); h.state = result(now + 660000, 'new-B'); await h.tick(); assert.ok(shown(h))
  h.state = { executing: true }; await h.tick(); assert.match(h.view.props.status, /宿主正在自动接续/)
})
await check('other page consumption clears shown text and completed execution text', async () => {
  const disk = storage(), a = page(disk).mount(), b = page(disk).mount()
  await a.settle(); await b.settle(); assert.ok(shown(b)); await a.dismiss()
  await b.tick(); assert.ok(!shown(b))
  b.state = { executing: true }; await b.tick(); assert.ok(b.view.props.status)
  b.state = result(); await b.tick(); assert.ok(!b.view)
})
await check('invalid records and oversized storage cannot hide a fresh success', async () => {
  for (const raw of [JSON.stringify([null, { key: '1799999995000|new-A', at: 'bad' }]), 'x'.repeat(512 * 1024 + 1)]) {
    const disk = storage(); disk.setItem(storeKey, raw)
    const h = page(disk).mount(); await h.settle(); assert.ok(shown(h)); await h.dismiss()
    const reloaded = page(disk).mount(); await reloaded.settle(); assert.ok(!shown(reloaded))
  }
})
await check('readable storage with failed writes preserves in-memory remount fallback', async () => {
  const p = page({ getItem: () => '[]', setItem() { throw Error('quota') } })
  const h = p.mount(); await h.settle(); await h.dismiss(); h.unmount()
  const remount = p.mount(); await remount.settle(); assert.ok(!shown(remount))
})
await check('legacy timestamp-free result remains valid and can be consumed', async () => {
  const disk = storage(), h = page(disk).mount(result(0))
  await h.settle(); assert.ok(shown(h)); await h.dismiss(); h.unmount()
  const reload = page(disk).mount(result(0)); reload.time += 660000
  await reload.settle(); assert.ok(!shown(reload))
})
await check('oversized result identity cannot enlarge persistent consumption storage', async () => {
  const disk = storage(), h = page(disk).mount(result(now, 'x'.repeat(5000)))
  await h.settle(); assert.ok(shown(h)); await h.dismiss(); await h.tick(); assert.ok(!shown(h))
  assert.equal(disk.getItem(storeKey), null)
  h.state = result(now, 'normal'); await h.tick(); assert.ok(shown(h)); await h.dismiss()
  assert.ok(disk.getItem(storeKey).length < 4096)
})
console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
