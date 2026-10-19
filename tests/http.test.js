import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { MemoryEngine } from '../lib/engine.js'
import { route, API } from '../lib/http.js'
import { fixture, agent, llm } from './helpers.js'

test('HTTP CRUD/source flow is workspace-scoped and rejects cross-origin writes', async t => {
  const { home, workspace, other } = await fixture(t)
  const engine = new MemoryEngine({ llm: llm() }, { home, autoExtract: false })
  t.after(() => engine.close())
  await engine.prepare(agent(workspace, 'a'))
  await engine.prepare(agent(other, 'b'))
  const server = createServer(route(engine).handler)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (data, extra = {}) => fetch(base + API, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify({ sessionId: 'a', ...data }) })
  const get = data => fetch(base + API + '?' + new URLSearchParams({ sessionId: 'a', ...data }))
  const created = await (await post({ action: 'write', text: 'HTTP pnpm memory', scope: 'project' })).json()
  assert.ok(created.id)
  assert.equal((await (await get({ action: 'list' })).json()).records.length, 1)
  assert.equal((await (await get({ action: 'list', sessionId: 'b' })).json()).records.length, 0)
  assert.equal((await get({ action: 'source', sessionId: 'b', id: created.sources[0] })).status, 400)
  assert.equal((await (await get({ action: 'source', id: created.sources[0] })).json()).content, created.text)
  assert.equal((await post({ action: 'write', text: 'attack' }, { origin: 'https://example.com' })).status, 403)
  assert.equal((await post({ action: 'delete', id: created.id, expectedVersion: 0 })).status, 400)
  assert.equal((await get({ sessionId: 'unknown' })).status, 400)
  assert.equal((await post({ action: 'delete', id: created.id, expectedVersion: created.version })).status, 200)
  assert.equal((await (await get({ action: 'search', query: 'pnpm' })).json()).records.length, 0)
  assert.equal((await get({ action: 'delete', id: created.id })).status, 400)
  const maliciousHost = await new Promise((resolve, reject) => {
    const req = request(base + API, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject); req.end()
  })
  assert.equal(maliciousHost, 403)
})
