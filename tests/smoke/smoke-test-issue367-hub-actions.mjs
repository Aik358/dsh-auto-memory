import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const a = source.indexOf('    async function readHubActionResponsePre(')
assert.ok(a >= 0, 'hub action parser must exist')
const helper = source.slice(a, source.indexOf('    async function apiPost(', a))
let pos = 0, count = 0
while ((pos = source.indexOf('function hubAct(', pos)) >= 0) {
  const end = source.indexOf('// ★M8-B', pos)
  const callback = source.slice(pos, end)
  for (const [ok, payload, fails] of [[true, { error: 'hub-unavailable' }, true], [false, { error: 'server failed' }, true], [true, { ok: false, reason: 'denied', reasonCodes: ['gate'] }, true], [true, { ok: true, decision: 'promote' }, false], [true, null, true]]) {
    let message = ''
    const sandbox = { API: { memoryHub: '/fixture' }, window: { confirm: () => true }, L: (s) => s,
      setActMsg: (s) => { message = s }, setRefresh() {}, fetch: async () => ({ ok, status: ok ? 200 : 500, json: async () => { if (payload === null) throw new Error('invalid JSON'); return payload } }) }
    vm.runInNewContext(helper + callback + '\nhubAct("promote","fixture",1)', sandbox)
    await setImmediate()
    assert.equal(message.includes('failed:'), fails, message)
    if (!fails) assert.ok(message.includes('promote'))
  }
  count++; pos = end
}
assert.equal(count, 3)
console.log('PASS #367 all three actual action callbacks reject HTTP, business and JSON failures')
