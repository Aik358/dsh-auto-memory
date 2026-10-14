import assert from 'node:assert/strict'
import { createTeamPuller } from '../../lib/team-pull.js'

for (const kind of ['fact', 'procedure', 'handoff']) {
  const appliers = {}
  const puller = createTeamPuller({ engine: { config: { teamEnabled: true } }, appliers,
    fetchJson: async () => ({ ok: true, data: { changes: [{ kind, key: 'fixture', payload: {} }], cursor: 12 } }) })
  const first = await puller.pullOnce()
  assert.equal(first.ok, false, kind)
  assert.equal(first.retryable, true, kind)
  assert.equal(puller.status().since, 0, kind)
  appliers[kind] = () => ({ ok: true })
  assert.equal((await puller.pullOnce()).ok, true, kind)
  assert.equal(puller.status().since, 12, kind)
}
console.log('PASS #364 missing capability keeps cursor replayable until a handler is available')
