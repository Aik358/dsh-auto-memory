import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Readable } from 'node:stream'
import { apply, API, MemoryEngine } from '../lib/audit-engine.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-364-host-'))
const previous = { home: process.env.DSH_HOME, fetch: globalThis.fetch, interval: globalThis.setInterval, timeout: globalThis.setTimeout, load: MemoryEngine.prototype.loadConfigSync }
const listeners = new Map(['uncaughtException', 'unhandledRejection', 'exit'].map(key => [key, new Set(process.listeners(key))]))
const routes = [], urls = []
let engine, cleanup, changes = [], cursor = 12
const candidate = object => ({ scope: 'Workspace', subject: 'DOC-364 fixture', predicate: 'uses', object, sourceKind: 'explicit', provenance: ['test'], confidence: 1 })
const fact = { kind: 'fact', eventId: 'fact-364', key: 'one', payload: candidate('Node.js') }
try {
  process.env.DSH_HOME = root
  await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ teamEnabled: true, teamServerUrl: 'http://fake.invalid', teamId: 'fixture-team', memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), globalBriefEnabled: false, externalSources: {} }))
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return previous.load.call(this) }
  globalThis.setInterval = globalThis.setTimeout = (callback, ms) => ({ callback, ms, unref() {} })
  globalThis.fetch = async url => { assert.equal(new URL(url).hostname, 'fake.invalid'); urls.push(String(url)); return new Response(JSON.stringify({ cursor, changes })) }
  apply({ get: () => undefined, credentials: { teamToken: 'fixture-token' }, on: () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: route => { routes.push(route); return () => {} } }, effect: fn => { cleanup = fn() } }, {})
  globalThis.setTimeout = previous.timeout; globalThis.setInterval = previous.interval
  const request = async (key, body) => {
    let status, data
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    Object.assign(req, { method: body ? 'POST' : 'GET', url: API[key], socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1' } })
    await routes.find(route => route.path === API[key]).handler(req, { writeHead: value => { status = value }, end: value => { data = JSON.parse(value) }, setHeader() {} })
    return { status, data }
  }
  const store = engine._factStore
  assert.equal(typeof store.applyTeamChange, 'function', 'the production store owns the controlled writer')
  const procedures = engine._memoryHub?.stores?.procedures
  const beforeProcedures = procedures ? JSON.stringify(procedures.snapshot().procedures) : null
  const planFile = path.join(root, 'memory', 'PLAN.md')
  await fs.mkdir(path.dirname(planFile), { recursive: true }); await fs.writeFile(planFile, 'fixture whiteboard stays unchanged')
  changes = [fact, { kind: 'procedure', key: 'p1', payload: { procedureId: 'remote-procedure', state: 'active' } }, { kind: 'handoff', key: 'h1', payload: { text: 'remote handoff' } }]
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await engine._teamPull.pullOnce()
    // ★2026-10-21 语义修正（线上团队同步 12GB 事故）：procedure / handoff **不在本次 requestKinds(['fact']) 内**。
    //   旧实现把「没有 applier」一律判 transient ⇒ 游标永久不前进 ⇒ 每 5s 从 since=0 重取全史（活锁，
    //   服务端 12GB / 进程 29GB 的直接成因）。现按「是否本次请求的 kind」分流：
    //     · 请求外缺 applier ⇒ business 拒绝（前进游标，别被别人的数据卡住）；
    //     · 请求内缺 applier ⇒ 仍 transient（#364 原语义：能力补齐后仍可重放，见 issue364-missing-applier）。
    //   ★判据意图不变：这两类远程事件**一条都不得被应用**（下方 procedures / PLAN.md 未变更断言仍在）。
    assert.equal(result.ok, true, 'unsupported kinds are business-rejected; the batch itself still succeeds')
    assert.equal(result.applied, 1, 'only the requested fact is applied')
    assert.equal(result.rejected, 2, 'procedure + handoff are rejected (never applied)')
    assert.equal(result.deferred, 0, 'no transient failure: they are outside requestKinds')
    assert.equal(engine._teamPull.status().since, 12, 'cursor advances so the same batch is not replayed forever')
    assert.equal(store.query({}).length, 1)
  }
  assert.ok(urls.every(url => new URL(url).searchParams.get('kinds') === 'fact'))
  const state = (await request('teamState')).data.pull
  assert.deepEqual(state.supportedKinds, ['fact']); assert.deepEqual(state.unsupportedKinds, ['procedure', 'handoff'])
  assert.deepEqual(state.requestedKinds, ['fact']); assert.equal(state.scopeConfirmed, false)
  if (procedures) assert.equal(JSON.stringify(procedures.snapshot().procedures), beforeProcedures, 'remote events cannot bypass procedure approval')
  assert.equal(await fs.readFile(planFile, 'utf8'), 'fixture whiteboard stays unchanged')
  changes = [fact]; assert.equal((await engine._teamPull.pullOnce()).ok, true)
  assert.equal(engine._teamPull.status().since, 12)
  const snapshot = JSON.stringify(store.snapshot({ includeRevoked: true }).facts)
  assert.equal((await request('teamControl', { action: 'reset-cursor' })).status, 400)
  assert.equal((await request('teamControl', { action: 'reset-cursor', confirm: true })).status, 200)
  assert.equal(engine._teamPull.status().since, 0); assert.equal(JSON.stringify(store.snapshot({ includeRevoked: true }).facts), snapshot)
  await engine._teamPull.pullOnce(); assert.equal(store.query({}).length, 1)
  changes = [{ ...fact, eventId: 'fact-conflict-364', payload: candidate('Python') }]; cursor = 13
  await engine._teamPull.pullOnce(); assert.equal(store.pendingConflicts().length, 1)
  engine._teamPull.reset(); await engine._teamPull.pullOnce(); assert.equal(store.pendingConflicts().length, 1, 'a replay cannot duplicate an unresolved conflict')
  console.log('PASS #364 production fact writer, unsupported procedure/handoff, requested scope, preserved data and idempotent replay')
} finally {
  if (cleanup) cleanup()
  globalThis.fetch = previous.fetch; globalThis.setInterval = previous.interval; globalThis.setTimeout = previous.timeout; MemoryEngine.prototype.loadConfigSync = previous.load
  for (const [key, before] of listeners) for (const listener of process.listeners(key)) if (!before.has(listener)) process.removeListener(key, listener)
  if (previous.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous.home
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
