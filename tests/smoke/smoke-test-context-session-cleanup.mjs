import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const isolated = await mkdtemp(path.join(os.tmpdir(), 'dam-context-close-'))
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(k => [k, process.env[k]]))
for (const k of Object.keys(savedEnv)) process.env[k] = isolated
const originals = Object.fromEntries(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch'].map(k => [k, globalThis[k]]))
const { apply, MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
const load = MemoryEngine.prototype.loadConfigSync
let engine
MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
globalThis.fetch = async () => { throw Error('offline regression') }
const effects = []
try {
  await writeFile(path.join(isolated, 'dsh-auto-memory.json'), JSON.stringify({ globalBriefEnabled: false, externalSources: {}, associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: true, contextSinkMode: 'python', memoryRoot: path.join(isolated, 'memory'), userMemoryDir: path.join(isolated, 'user') }))
  apply({ get: () => undefined, on() {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: fn => effects.push(fn()) }, {})
  engine._pythonSidecar.dispose()
  const notifications = []
  let sharedDisposed = 0
  engine._pythonSidecar = { request: async () => ({ ok: false }), onActivation: () => () => {}, notify: (type, payload) => notifications.push({ type, payload }), debugView: () => ({}), dispose: () => sharedDisposed++ }
  const capture = sid => {
    const agent = { id: sid, session: { id: sid, header: { id: sid, cwd: isolated } } }
    const rt = engine.runtimeFor(agent)
    Object.assign(rt.state, { ws: isolated, userDir: path.join(isolated, 'user'), notesPath: path.join(isolated, 'memory', 'MEMORY.md'), logPath: path.join(isolated, 'memory', 'log.md') })
    engine.withAgent(agent, () => engine.capturePathsFor(agent))
    return agent
  }
  const a = capture('a'), b = capture('b')
  assert.deepEqual(engine._contextHost.debugView().capturedPathKeys, ['session:a', 'session:b'])
  assert(engine.disposeAgent(a))
  assert.equal(engine.disposeAgent(a), false)
  assert.equal(engine.peekRuntime(a), undefined)
  assert.deepEqual(engine._contextHost.debugView().capturedPathKeys, ['session:b'])
  assert.deepEqual(notifications, [{ type: 'close_session', payload: { sessionId: 'a' } }])
  assert.equal(sharedDisposed, 0, 'closing one session must preserve the shared sidecar')
  assert(engine.runtimes.disposeSession(b.session))
  assert.deepEqual(engine._contextHost.debugView().capturedPathKeys, [])
  assert.equal(notifications.length, 2)
  // A snapshot without a lazily allocated state is also owned at plugin level.
  engine._contextHost.capturePaths('orphan', { ws: isolated, userDir: isolated, notesPath: path.join(isolated, 'orphan.md') })
  assert(engine._contextHost.debugView().capturedPathKeys.includes('orphan'))
  for (const cleanup of effects) cleanup()
  for (const cleanup of effects) cleanup()
  assert.deepEqual(engine._contextHost.debugView().capturedPathKeys, [])
  engine._contextHost.capturePaths('late', { ws: isolated })
  assert.deepEqual(engine._contextHost.debugView().capturedPathKeys, [])
  assert.equal(sharedDisposed, 1)
  console.log('PASS context lifecycle: session close notification, peer isolation, orphan collection and idempotent plugin unload')
} finally {
  for (const cleanup of effects) cleanup()
  MemoryEngine.prototype.loadConfigSync = load
  for (const [key, value] of Object.entries(originals)) globalThis[key] = value
  await flushDiagnostics()
  await rm(isolated, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
