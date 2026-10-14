import assert from 'node:assert/strict'
import { createTeamFetch } from '../../lib/team-auth.js'

const config = { teamEnabled: true, serverUrl: 'https://team.invalid/', teamId: 'fixture', teamToken: 'fixture' }
const teamFetch = createTeamFetch({ config })
for (const status of [200, 204]) {
  const failed = await teamFetch('push', { fetchImpl: async () => ({ status, text: async () => { throw new Error('body stream lost') } }) })
  assert.equal(failed.ok, false)
}
assert.equal((await teamFetch('push', { fetchImpl: async () => ({ status: 204, text: async () => '' }) })).ok, true)
assert.equal((await teamFetch('push', { fetchImpl: async () => ({ status: 200, text: async () => '{"ok":false,"reason":"denied"}' }) })).ok, false)
console.log('PASS #370 incomplete responses and business rejections cannot acknowledge sends')
