import assert from 'node:assert/strict'
import { createTeamFetch } from '../../lib/team-auth.js'
import { createTeamSync } from '../../lib/team-sync.js'
import { createTeamOutbox } from '../../lib/team-outbox.js'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const config = { teamEnabled: true, serverUrl: 'https://team.invalid/', teamId: 'fixture', teamToken: 'fixture' }
const teamFetch = createTeamFetch({ config })
for (const status of [200, 204]) {
  const failed = await teamFetch('push', { fetchImpl: async () => ({ status, text: async () => { throw new Error('body stream lost') } }) })
  assert.equal(failed.ok, false)
}
assert.equal((await teamFetch('push', { fetchImpl: async () => ({ status: 204, text: async () => '' }) })).ok, true)
assert.equal((await teamFetch('push', { fetchImpl: async () => ({ status: 200, text: async () => '{"ok":false,"reason":"denied"}' }) })).ok, false)

// Real auth -> sender -> durable outbox, against a local HTTP server only.
const dir = await mkdtemp(path.join(os.tmpdir(), 'dam-issue370-'))
let mode = 'drop'
const received = [], committed = new Set()
const server = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const event = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  received.push(event)
  if (mode === 'drop' || mode === 'success') committed.add(JSON.stringify(event))
  if (mode === 'success') { res.writeHead(204); res.end(); return }
  res.writeHead(200, { 'content-type': 'application/json' })
  if (mode === 'denied') { res.end('{"ok":false,"reason":"denied"}'); return }
  res.write('{"ok":')
  if (mode === 'drop') setImmediate(() => res.destroy())
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const engine = { config: { ...config, serverUrl: 'http://127.0.0.1:' + server.address().port + '/', timeoutMs: 150 } }
  const outbox = createTeamOutbox({ dir })
  const sync = createTeamSync({ engine, outbox, teamFetch: createTeamFetch({ engine }), identity: { currentMember: () => ({ id: 'fixture' }) } })
  assert.equal(outbox.enqueue({ kind: 'fact', key: 'one', eventId: 'stable-event', payload: { text: 'fixture' } }).ok, true)
  for (mode of ['drop', 'hang', 'denied']) {
    const result = await sync.tick()
    assert.equal(result.sent, 0, mode)
    assert.equal(result.failed, 1, mode)
    assert.equal(outbox.size(), 1, mode)
    assert.equal(createTeamOutbox({ dir }).load().size, 1, 'failure remains on disk')
    assert.equal(outbox.list()[0].eventId, 'stable-event', 'outbox retry identity remains stable')
  }
  mode = 'success'
  assert.equal((await sync.tick()).sent, 1)
  assert.equal(outbox.size(), 0)
  assert.equal(received.length, 4)
  for (const event of received) assert.deepEqual(event, received[0], 'retry preserves the entire wire payload')
  assert.equal(committed.size, 1, 'fixture server deduplicates unchanged retries')
  sync.stop()
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await rm(dir, { recursive: true, force: true })
}
console.log('PASS #370 body failure/timeout and business rejection retain outbox; recovery retries the same event')
