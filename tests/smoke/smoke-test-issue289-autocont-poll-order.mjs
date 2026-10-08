/** #289: production component, deferred responses and sustained wall-clock polling. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(process.env.DSH_TEST_CLIENT_SOURCE || new URL('../../lib/client.js', import.meta.url), 'utf8')
const helperSource = readFileSync(new URL('./smoke-test-issue278-autocont-dismiss.mjs', import.meta.url), 'utf8')
const extract = new Function(helperSource.slice(helperSource.indexOf('function extractFnBody ('), helperSource.indexOf('const AC_BODY =')) + ';return extractFnBody')()
const body = extract(source, 'function AutoContinueHost() {')
const sleep = () => new Promise((resolve) => setImmediate(resolve))
// Preserve #278's harness; add cleanup and optional real timers for this suite.
const helper = helperSource.slice(helperSource.indexOf('function mountAutoContinueHost (opts) {'), helperSource.indexOf('const statusOf ='))
  .replace('const sessions = { open: () => {} }', 'const sessions = o.sessions || { open: () => {} }')
  .replace('const effects = []', 'const effects = []; const cleanups = []')
  .replace('const id = ++ivSeq; intervals.set(id, fn); return id', 'const id = o.realTimers ? setInterval(fn, 3000) : ++ivSeq; intervals.set(id, fn); return id')
  .replace('intervals.delete(id)', 'if (o.realTimers) clearInterval(id); intervals.delete(id)')
  .replace('void c', 'if (typeof c === "function") cleanups.push(c)')
  .replace('show, intervals, effects,', 'show, intervals, effects, unmount: () => { for (const c of cleanups.splice(0)) c() },')
const mount = new Function('AC_BODY', 'sleep', helper + ';return mountAutoContinueHost')(body, sleep)
const executing = { executing: true, armed: null, lastOk: null }
const armed = { executing: false, lastOk: null, armed: { ratio: .8, edgeAt: Date.now(), expiresAt: Date.now() + 35000 } }
const success = { executing: false, armed: null, lastOk: { at: Date.now(), fromSid: 'A', sessionId: 'A-next' } }

function start () {
  const requests = []
  const opened = []
  const opts = {
    sid: 'A', sessions: { open: (sid) => opened.push(sid) },
    apiGet: (url, query) => url.includes('config')
      ? Promise.resolve({ autoContinueEnabled: true })
      : new Promise((resolve, reject) => requests.push({ resolve, reject, sid: query?.sessionId })),
  }
  const host = mount(opts)
  host.show(); host.runEffects()
  // The display poll is the last timer even on the broken two-poll baseline.
  const poll = () => Array.from(host.intervals.values()).at(-1)()
  return { host, opts, opened, requests, poll }
}

let passed = 0
let failed = 0
async function check (name, run) {
  try { await run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('FAIL - ' + name + ': ' + error.message) }
}

await check('late A executing on B cannot write state', async () => {
  const { host, opts, requests, poll } = start()
  requests.at(-1).resolve(armed)
  await host.settle()
  poll(); opts.sid = 'B'
  requests.at(-1).resolve(executing)
  await host.settle()
  assert.equal(host.lastRender().props.executing, false)
  assert.ok(host.lastRender().props.confirmation)
})

await check('late A success on B cannot open a successor or display status', async () => {
  const { host, opts, opened, requests } = start()
  opts.sid = 'B'
  requests.at(-1).resolve(success)
  await host.settle()
  assert.deepEqual(opened, [])
  assert.equal(host.lastRender(), null)
})

await check('B response is accepted while A remains in flight; late A stays ignored', async () => {
  const { host, opts, requests, opened, poll } = start()
  const older = requests.at(-1)
  opts.sid = 'B'; poll()
  requests.at(-1).resolve(executing)
  await host.settle()
  older.resolve(success)
  await host.settle()
  assert.equal(host.lastRender().props.executing, true)
  assert.deepEqual(opened, [])
})

await check('older armed cannot overwrite newer accepted executing', async () => {
  const { host, requests, poll } = start()
  const older = requests.at(-1)
  poll(); requests.at(-1).resolve(executing)
  await host.settle()
  older.resolve(armed)
  await host.settle()
  assert.equal(host.lastRender().props.executing, true)
  assert.equal(host.lastRender().props.confirmation, null)
})

await check('older success cannot open a successor after newer accepted executing', async () => {
  const { host, requests, opened, poll } = start()
  const older = requests.at(-1)
  poll(); requests.at(-1).resolve(executing)
  await host.settle()
  older.resolve(success)
  await host.settle()
  assert.equal(host.lastRender().props.executing, true)
  assert.deepEqual(opened, [])
})

await check('source-session success opens successor exactly once and clears confirmation', async () => {
  const { host, requests, opened, poll } = start()
  requests.at(-1).resolve(armed)
  await host.settle()
  poll(); requests.at(-1).resolve(success)
  await host.settle()
  assert.deepEqual(opened, ['A-next'])
  assert.equal(host.lastRender().props.confirmation, null)
  poll(); requests.at(-1).resolve(success)
  await host.settle()
  assert.deepEqual(opened, ['A-next'])
})

await check('pending newer request does not suppress a usable completed success', async () => {
  const { host, requests, opened, poll } = start()
  const older = requests.at(-1)
  poll(); older.resolve(success)
  await host.settle()
  assert.deepEqual(opened, ['A-next'])
  assert.match(host.lastRender().props.status, /^✓/)
})

await check('latest request failure allows a fresh older result to make progress', async () => {
  const { host, requests, opened, poll } = start()
  const older = requests.at(-1)
  poll(); requests.at(-1).reject(new Error('controlled failure'))
  await host.settle()
  older.resolve(success)
  await host.settle()
  assert.deepEqual(opened, ['A-next'])
  assert.match(host.lastRender().props.status, /^✓/)
})

await check('latest request failure cannot revive a result older than accepted executing', async () => {
  const { host, requests, poll } = start()
  const older = requests.at(-1)
  poll(); requests.at(-1).resolve(executing)
  await host.settle()
  poll(); requests.at(-1).reject(new Error('controlled failure'))
  await host.settle()
  older.resolve(armed)
  await host.settle()
  assert.equal(host.lastRender().props.executing, true)
  assert.equal(host.lastRender().props.confirmation, null)
})

await check('unmounted component ignores pending success and clears timers', async () => {
  const { host, requests, opened } = start()
  host.unmount()
  requests.at(-1).resolve(success)
  await host.settle()
  assert.equal(host.intervals.size, 0)
  assert.equal(host.lastRender(), null)
  assert.deepEqual(opened, [])
})

for (const delayMs of [200, 3200]) {
  await check('sustained 3s wall-clock polling accepts ' + delayMs + 'ms responses', async () => {
    const opened = [], timeouts = new Set()
    let issued = 0, completed = 0, response = armed
    const host = mount({
      sid: 'A', realTimers: true, sessions: { open: (sid) => opened.push(sid) },
      apiGet: (url) => url.includes('config') ? Promise.resolve({ autoContinueEnabled: true }) : new Promise((resolve) => {
        issued++
        const value = response
        const id = setTimeout(() => { timeouts.delete(id); completed++; resolve(value) }, delayMs)
        timeouts.add(id)
      }),
    })
    try {
      host.show(); host.runEffects()
      await new Promise((resolve) => setTimeout(resolve, delayMs + 150))
      await host.settle()
      const confirmationShown = !!host.lastRender()?.props.confirmation
      response = success
      await new Promise((resolve) => setTimeout(resolve, 12800 - delayMs - 150))
      await host.settle()
      assert.ok(issued >= 5 && completed >= 4, 'multiple overlapping responses completed')
      assert.ok(confirmationShown, 'slow armed response displays confirmation despite newer pending polls')
      assert.match(host.lastRender()?.props.status || '', /^✓/, 'success remains visible through continued polling')
      assert.equal(host.lastRender().props.confirmation, null)
      assert.deepEqual(opened, ['A-next'])
      console.log(`  wall-clock: ${issued} issued / ${completed} completed`)
    } finally {
      host.unmount()
      for (const id of timeouts) clearTimeout(id)
    }
  })
}

await check('configuration polling does not issue a competing state request', async () => {
  const { host, requests } = start()
  assert.equal(requests.length, 1)
  Array.from(host.intervals.values())[0]()
  await host.settle()
  assert.equal(requests.length, 1)
})

console.log(`${fileURLToPath(import.meta.url)}: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
