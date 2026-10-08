/** #289: execute the production component with deferred responses from both polls. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
// Reuse the controlled hooks/timers of #278 without changing its regressions.
const helperSource = readFileSync(new URL('./smoke-test-issue278-autocont-dismiss.mjs', import.meta.url), 'utf8')
const extract = new Function(helperSource.slice(helperSource.indexOf('function extractFnBody ('), helperSource.indexOf('const AC_BODY =')) + ';return extractFnBody')()
const body = extract(source, 'function AutoContinueHost() {')
const sleep = () => new Promise((resolve) => setImmediate(resolve))
const helper = helperSource.slice(helperSource.indexOf('function mountAutoContinueHost (opts) {'), helperSource.indexOf('const statusOf ='))
  .replace('const sessions = { open: () => {} }', 'const sessions = o.sessions || { open: () => {} }')
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
  assert.equal(requests.length, 2, 'both polling effects issue a state request')
  return { host, opts, opened, requests }
}

let passed = 0
let failed = 0
async function check (name, run) {
  try { await run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('FAIL - ' + name + ': ' + error.message) }
}

for (const path of [0, 1]) {
  await check('late A executing on B cannot write acState via polling path ' + path, async () => {
    const { host, opts, requests } = start()
    requests.at(-1).resolve(armed)
    await host.settle()
    // Make this path the latest request so session identity alone must reject it.
    Array.from(host.intervals.values())[path]()
    opts.sid = 'B'
    requests.at(-1).resolve(executing)
    await host.settle()
    assert.equal(host.lastRender().props.executing, false, 'different-session acState is rejected')
    assert.ok(host.lastRender().props.confirmation)
  })
  await check('late A success on B is ignored by polling path ' + path, async () => {
    const { host, opts, opened, requests } = start()
    opts.sid = 'B'
    requests[path].resolve(success)
    await host.settle()
    assert.deepEqual(opened, [])
    assert.equal(host.lastRender(), null, 'no status from a different current session')
  })
  await check('older armed cannot overwrite newer executing via polling path ' + path, async () => {
    const { host, requests } = start()
    const older = requests[path]
    await host.tick()
    requests.at(-1).resolve(executing)
    await host.settle()
    assert.equal(host.lastRender().props.executing, true)
    older.resolve(armed)
    await host.settle()
    assert.equal(host.lastRender().props.executing, true, 'acState remains the newer executing state')
    assert.equal(host.lastRender().props.confirmation, null, 'older armed cannot restore confirmation')
  })
}

await check('latest source-session success still opens successor exactly once', async () => {
  const { host, requests, opened } = start()
  requests.at(-1).resolve(success)
  await host.settle()
  assert.deepEqual(opened, ['A-next'])
  await host.tick()
  requests.at(-1).resolve(success)
  await host.settle()
  assert.deepEqual(opened, ['A-next'])
})

await check('latest load path can still update executing state', async () => {
  const { host, requests } = start()
  requests.at(-1).resolve(armed)
  await host.settle()
  // Trigger only the first effect's timer, making it the newest request.
  Array.from(host.intervals.values())[0]()
  requests.at(-1).resolve(executing)
  await host.settle()
  assert.equal(host.lastRender().props.executing, true)
})

await check('same-session response superseded by a pending request is ignored', async () => {
  const { host, requests, opened } = start()
  const older = requests.at(-1)
  await host.tick()
  older.resolve(success)
  await host.settle()
  assert.deepEqual(opened, [])
  assert.equal(host.lastRender(), null)
})

await check('latest request failure does not allow an older response to roll state back', async () => {
  const { host, requests } = start()
  requests.at(-1).resolve(executing)
  await host.settle()
  await host.tick()
  const older = requests.at(-2)
  requests.at(-1).reject(new Error('controlled request failure'))
  await host.settle()
  older.resolve(armed)
  await host.settle()
  assert.equal(host.lastRender().props.executing, true)
  assert.equal(host.lastRender().props.confirmation, null)
})

console.log(`${fileURLToPath(import.meta.url)}: ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
