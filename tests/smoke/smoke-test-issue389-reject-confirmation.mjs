import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('      var onReject = function () {')
const callback = source.slice(start, source.indexOf('      if (acConfirm', start))
for (const answer of [null, { ok: false, error: 'stale edge' }, { ok: true, rejected: true, sessionId: 'A', edgeAt: 12 }]) {
  let cleared = false, cancelled = false, message = '', payload
  const card = { sessionId: 'A', edgeAt: 12 }
  const env = { acConfirm: card, acConfirmRef: { current: card }, currentSessionIdClient: () => 'A',
    cancelAc: () => { cancelled = true }, setAcConfirm: () => { cleared = true }, setAcSt: (s) => { message = s },
    t: (s) => s, L: (s) => s, API: { autoContDecide: '/fixture' },
    apiPost: async (_, p) => { payload = p; if (!answer) throw Error('network'); return answer } }
  vm.runInNewContext(callback + '\nonReject()', env)
  await setImmediate()
  assert.equal(payload.sessionId, 'A')
  assert.equal(cleared, !!(answer && answer.rejected))
  assert.equal(cancelled, cleared)
  assert.equal(message === 'autoContRejected', cleared, 'only confirmed rejection can report skipped')
}
console.log('PASS #389 reject failures keep confirmation visible and never claim cancellation')
