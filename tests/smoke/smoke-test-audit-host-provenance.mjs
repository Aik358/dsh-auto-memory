import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-host-provenance-'))
process.env.DSH_HOME = root
// No host polling or external services: actual registered tools/routes still run.
globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
globalThis.fetch = async () => new Response('{}', { status: 503 })
const workspace = path.join(root, 'actual-project'), other = path.join(root, 'other-project')
fs.mkdirSync(workspace); fs.mkdirSync(other)
fs.writeFileSync(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ teamEnabled: true, teamId: 'fixture', teamServerUrl: 'http://127.0.0.1:1', memoryRoot: path.join(root, 'memory', 'workspaces'), userMemoryDir: path.join(root, 'memory'), externalSources: {} }))
const prior = { schema: 1, items: { old: { memberId: 'prior-member', memberName: 'Prior', at: 1, op: 'edit' } } }
const file = path.join(root, 'team-attribution.json')
fs.writeFileSync(file, JSON.stringify(prior))
const { apply, MemoryEngine } = await (await import('../lib/load-private-engine.mjs')).loadPrivateEngine()
let engine, failed = 0
const load = MemoryEngine.prototype.loadConfigSync
MemoryEngine.prototype.loadConfigSync = function (...args) { engine = this; return load.apply(this, args) }
const tools = [], routes = [], disposers = []
const agent = { session: { id: 'audit-session', header: { cwd: workspace } } }
const ctx = {
  get: key => key === 'agents' ? { get: id => id === agent.session.id ? agent : null } : key === 'workspaceRegistry' ? { list: () => [{ path: workspace, sessionIds: [agent.session.id] }, { path: other, sessionIds: [] }] } : undefined,
  on: () => () => {}, effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') disposers.push(cleanup); return () => {} },
  systemPrompt: { context: () => () => {}, section: () => () => {} },
  tools: { register: tool => { tools.push(tool); return () => {} } },
  webServer: { register: route => { routes.push(route); return () => {} } },
}
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) }
}
async function activateViaGui(id) {
  const route = routes.find(r => r.path.endsWith('/memory-hub'))
  assert.ok(route)
  const req = Readable.from([Buffer.from(JSON.stringify({ action: 'activate', procedureId: id }))])
  Object.assign(req, { method: 'POST', url: route.path, socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' } })
  let status, body
  await route.handler(req, { writeHead: code => { status = code }, end: text => { body = JSON.parse(text) } })
  assert.equal(status, 200)
  return body
}
try {
  apply(ctx, {})
  await check('F3 actual plugin restart restores prior authors and preserves them on write', () => {
    assert.equal(engine._teamAttribution.get('old')?.memberId, 'prior-member')
    engine._teamAttributionRecord([{ key: 'new', member: { id: 'new-member', name: 'New' }, op: 'edit' }])
    const next = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.deepEqual(next.items.old, prior.items.old)
    assert.equal(next.items.new.memberId, 'new-member')
  })
  await check('F5 actual model tool exports the bound session project', async () => {
    const result = await tools.find(t => t.name === 'memory_procedure').execute({ action: 'activate', title: 'Session project skill', steps: 'Read project source', successCriteria: 'Source read', riskLevel: 'low' }, { agent })
    assert.match(result, /已导出 SKILL.md/)
    const name = fs.readdirSync(path.join(root, 'skills'))[0]
    const text = fs.readFileSync(path.join(root, 'skills', name, 'SKILL.md'), 'utf8')
    assert.ok(text.includes('（`' + workspace + '`）'))
    assert.ok(!text.includes('（`' + process.cwd() + '`）'))
  })
  await check('F5 foreign-owner activation fails visibly and retries in the owning workspace', async () => {
    const store = engine._memoryHub.stores.procedures
    engine.state.ws = other
    const observed = store.observe({ title: 'Other project skill', steps: ['Read other source'], successCriteria: ['Source read'], riskLevel: 'low', scope: 'workspace', workspaceRef: engine.wsKey(other) })
    assert.equal(observed.ok, true)
    assert.equal(observed.persisted, true)
    const p = observed.procedure
    assert.equal(store.promote(p.procedureId, {}, { authorizedBy: 'user' }).ok, true)
    engine.state.ws = workspace
    const refused = await activateViaGui(p.procedureId)
    assert.equal(refused.ok, false)
    assert.equal(refused.persisted, false)
    assert.match(refused.error, /foreign-workspace/)
    assert.equal(refused.skillExport, undefined, 'failed commit must not report a successful export')
    engine.state.ws = other
    const result = await activateViaGui(p.procedureId)
    assert.equal(result.ok, true)
    assert.equal(result.persisted, true)
    assert.equal(result.skillExport.ok, true)
    assert.ok(fs.readFileSync(result.skillExport.file, 'utf8').includes('（`' + other + '`）'))
    const ownerFile = path.join(root, 'memory', 'workspaces', engine.wsKey(other), 'hub', 'procedures.json')
    assert.equal(JSON.parse(fs.readFileSync(ownerFile, 'utf8')).procedures.find(row => row.procedureId === p.procedureId).stage, 'active')
  })
  await check('F5 unknown global source remains activated without a fabricated export project', async () => {
    const store = engine._memoryHub.stores.procedures
    const p = store.observe({ title: 'Unknown origin skill', steps: ['Read source'], successCriteria: ['Source read'], riskLevel: 'low' }).procedure
    store.promote(p.procedureId, {}, { authorizedBy: 'user' })
    const result = await activateViaGui(p.procedureId)
    assert.equal(result.ok, true)
    assert.equal(result.skillExport.ok, false)
    assert.match(result.skillExport.reason, /source|project/)
  })
  await check('F3 unreadable startup does not later overwrite an unseen history file', () => {
    fs.rmSync(file); fs.mkdirSync(file)
    apply(ctx, {})
    fs.rmdirSync(file); fs.writeFileSync(file, JSON.stringify(prior))
    const result = engine._teamAttributionRecord([{ key: 'new', member: { id: 'new-member' }, op: 'edit' }])
    assert.equal(result.ok, false)
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), prior)
  })
} finally {
  for (const dispose of disposers) { try { if (typeof dispose === 'function') dispose() } catch (_) {} }
  fs.rmSync(root, { recursive: true, force: true })
}
process.exit(failed ? 1 : 0)
