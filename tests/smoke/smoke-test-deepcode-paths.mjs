import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import vm from 'node:vm'
import { MemoryEngine, apply, API } from '../lib/audit-engine.mjs'

// Exercise production methods and the registered /config route with real path aliases.
const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dam-deepcode-')))
const oldDsh = process.env.DSH_HOME
const oldFetch = globalThis.fetch, oldInterval = globalThis.setInterval, oldTimeout = globalThis.setTimeout
const listeners = new Map(['uncaughtException', 'unhandledRejection', 'exit'].map(e => [e, new Set(process.listeners(e))]))
const cleanups = [], disposals = [], routes = []
let server, failures = 0
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name) }
  catch (e) { failures++; console.error('FAIL ' + name + ': ' + e.message) }
}
try {
  const real = path.join(tmp, 'data-data'), alias = path.join(tmp, 'data-user-0')
  fs.mkdirSync(real)
  fs.symlinkSync(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
  process.env.DSH_HOME = alias
  const eng = new MemoryEngine()
  eng.configLoaded = true
  const nestedAlias = path.join(alias, 'new', 'nested', 'hub')
  const nestedReal = path.join(real, 'new', 'nested', 'hub')
  await test('uncreated nested workspace keeps the physical DSH root', () => {
    assert.equal(eng._canonPath(nestedAlias), nestedReal)
    eng.config.workbenchRoot = nestedAlias
    assert.equal(eng._workbenchCwd(), nestedReal)
  })
  await test('actual workbench verification reuses an aliased session', async () => {
    fs.mkdirSync(nestedReal, { recursive: true })
    eng.config.workbenchRoot = nestedAlias
    const epoch = eng._workbenchEpoch(Date.now())
    eng._readWorkbench = async () => ({ version: 2, epoch, current: { sessionId: 'phone-hub' }, phase: 'active' })
    const agent = { session: { id: 'phone-hub', header: { cwd: nestedReal } } }
    eng._agentBySessionId = () => agent
    eng._workspaceRegistry = { list: () => [{ path: nestedAlias }] }
    eng._permPresets = () => ({ current: () => 'danger-full-access' })
    assert.equal((await eng._verifyWorkbench(Date.now())).ok, true)
    agent.session.header.cwd = path.join(tmp, 'other-drive')
    assert.equal((await eng._verifyWorkbench(Date.now())).reason, 'cwd-mismatch')
    agent.session.header.cwd = nestedReal
    eng._permPresets = () => ({ current: () => 'workspace-write' })
    assert.equal((await eng._verifyWorkbench(Date.now())).reason, 'permission-mismatch')
  })
  await test('cleanup preserves an empty registration for the current physical workspace', async () => {
    const deleted = []
    eng._workspaceRegistry = { list: () => [
      { id: 'current', title: '记忆中枢', path: nestedAlias, sessionIds: [] },
      { id: 'stale', title: '记忆中枢', path: path.join(real, 'old-hub'), sessionIds: [] },
      { id: 'has-sessions', title: '记忆中枢', path: path.join(real, 'older-hub'), sessionIds: ['old'] },
    ], delete: id => { deleted.push(id); return true } }
    assert.equal(await eng._pruneStaleWorkbenchWorkspaces(nestedReal), 1)
    assert.deepEqual(deleted, ['stale'])
  })
  await test('continuation workspace lookup resolves aliases and respects direct session ownership', () => {
    eng._workspaceRegistry = { list: () => [
      { id: 'phone-workspace', path: nestedAlias, sessionIds: [] },
      { id: 'owned-workspace', path: path.join(real, 'other'), sessionIds: ['owned'] },
    ] }
    assert.equal(eng.resolveWorkspaceIdForSession('new-session', nestedReal), 'phone-workspace')
    assert.equal(eng.resolveWorkspaceIdForSession('owned', nestedReal), 'owned-workspace')
    assert.equal(eng.resolveWorkspaceIdForSession('new-session', path.join(real, 'elsewhere')), '')
  })
  await test('path identity preserves case on Android/Linux and folds it on Windows', () => {
    assert.equal(eng._pathKey(path.join(real, 'Case-Hub')) === eng._pathKey(path.join(real, 'case-hub')),
      process.platform === 'win32')
    assert.equal(eng._pathKey(''), '')
    for (const platform of ['linux', 'darwin', 'win32']) {
      const key = vm.runInNewContext('({' + eng._pathKey.toString() + '})._pathKey', { process: { platform } })
      const host = { _canonPath: value => value }
      assert.equal(key.call(host, '/phone/Case-Hub') === key.call(host, '/phone/case-hub'), platform === 'win32')
    }
  })
  fs.writeFileSync(path.join(real, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(real, 'memory'), userMemoryDir: path.join(real, 'user'),
    globalBriefEnabled: false, teamEnabled: false, greetingEnabled: false, externalSources: {},
  }))
  globalThis.fetch = async () => { throw Error('external network forbidden') }
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  apply({ get: () => undefined, on: (name, fn) => { if (name === 'dispose') disposals.push(fn) },
    systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} },
    webServer: { register: route => { routes.push(route); return () => {} } }, effect: fn => cleanups.push(fn()) }, {})
  globalThis.setInterval = oldInterval; globalThis.setTimeout = oldTimeout
  for (const [event, old] of listeners) for (const fn of process.listeners(event)) if (!old.has(fn)) process.removeListener(event, fn)
  const route = routes.find(r => r.path === API.config)
  server = http.createServer((req, res) => void route.handler(req, res).catch(e => { res.writeHead(500); res.end(e.message) }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const call = (method, body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: API.config, method,
      headers: { 'content-type': 'application/json' } }, res => {
      let text = ''; res.on('data', b => { text += b }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }))
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined)
  })
  await call('GET')
  for (const key of ['workbenchRoot', 'memoryRoot', 'userMemoryDir']) {
    await test('config route accepts physical spelling for ' + key, async () => {
      const root = path.join(real, 'custom', 'not-created', key)
      const r = await call('POST', { [key]: root })
      assert.equal(r.status, 200)
      assert.equal(r.body.config[key], root)
    })
  }
  await test('a contained dot-prefixed workspace is not mistaken for a parent traversal', async () => {
    const root = path.join(real, '..phone', 'hub')
    assert.equal((await call('POST', { workbenchRoot: root })).body.config.workbenchRoot, root)
    eng.config.workbenchRoot = root
    assert.equal(eng._workbenchCwd(), root)
  })
  await test('config route rejects a symlink escaping the DSH root', async () => {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    const escape = path.join(real, 'escape')
    fs.symlinkSync(outside, escape, process.platform === 'win32' ? 'junction' : 'dir')
    const before = (await call('GET')).body.config
    for (const key of ['workbenchRoot', 'memoryRoot', 'userMemoryDir']) {
      const r = await call('POST', { [key]: path.join(alias, 'escape', 'hub') })
      assert.equal(r.body.config[key], before[key], key + ' must reject escaped physical paths')
    }
    assert.equal(eng._canonPath(path.join(alias, 'escape', 'hub')), path.join(outside, 'hub'))
  })
  await test('empty workbench setting still restores automatic mode', async () => {
    assert.equal((await call('POST', { workbenchRoot: '' })).body.config.workbenchRoot, '')
  })
} finally {
  for (const fn of disposals) fn()
  for (const fn of cleanups) fn?.()
  if (server) await new Promise(resolve => server.close(resolve))
  globalThis.fetch = oldFetch; globalThis.setInterval = oldInterval; globalThis.setTimeout = oldTimeout
  for (const [event, old] of listeners) for (const fn of process.listeners(event)) if (!old.has(fn)) process.removeListener(event, fn)
  await new Promise(resolve => setTimeout(resolve, 100))
  fs.rmSync(tmp, { recursive: true, force: true })
  if (oldDsh === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldDsh
}
process.exitCode = failures ? 1 : 0
