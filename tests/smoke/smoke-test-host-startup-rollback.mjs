import assert from 'node:assert/strict'
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
const isolated = await mkdtemp(path.join(os.tmpdir(), 'dam-startup-rollback-'))
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(k => [k, process.env[k]]))
for (const k of Object.keys(savedEnv)) process.env[k] = isolated
const originals = Object.fromEntries(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'fetch'].map(k => [k, globalThis[k]]))
const { apply, MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
const load = MemoryEngine.prototype.loadConfigSync
let engine
MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
const timers = new Set()
globalThis.setTimeout = globalThis.setInterval = (callback, ms) => { const timer = { callback, ms, unref() {} }; timers.add(timer); return timer }
globalThis.clearTimeout = globalThis.clearInterval = timer => timers.delete(timer)
globalThis.fetch = async () => { throw Error('offline regression') }
try {
  await writeFile(path.join(isolated, 'dsh-auto-memory.json'), JSON.stringify({ globalBriefEnabled: false, externalSources: {}, memoryRoot: path.join(isolated, 'memory'), userMemoryDir: path.join(isolated, 'user') }))
  for (const phase of ['effect', 'prompt', 'tool', 'route', 'success']) {
    engine = undefined
    const effects = [], acquired = [], released = [], resources = new Map()
    let tools = 0, routes = 0, prompts = 0, effectCount = 0, instrumented = false
    const acquire = name => { acquired.push(name); return () => released.push(name) }
    const instrument = () => {
      if (instrumented) return
      instrumented = true
      for (const [field, method] of [['_jsSemantic', 'dispose'], ['_jsDownload', 'dispose'], ['_pythonSidecar', 'dispose'], ['_pythonSetup', 'cancelDownload']]) {
        const value = engine[field], raw = value[method].bind(value)
        value[method] = (...args) => { resources.set(field, (resources.get(field) || 0) + 1); return raw(...args) }
      }
    }
    const ctx = {
      get: () => undefined,
      on: event => acquire('event:' + event),
      effect: fn => { if (++effectCount === 2 && phase === 'effect') throw Error('mount failed'); effects.push(fn()) },
      systemPrompt: {
        context: () => { if (++prompts === 2 && phase === 'prompt') throw Error('mount failed'); return acquire('context:' + prompts) },
        section: () => acquire('section'),
      },
      tools: { register: () => { instrument(); if (++tools === 2 && phase === 'tool') throw Error('mount failed'); return acquire('tool:' + tools) } },
      webServer: { register: () => { if (++routes === 3 && phase === 'route') throw Error('mount failed'); return acquire('route:' + routes) } },
    }
    if (phase === 'success') apply(ctx, {})
    else assert.throws(() => apply(ctx, {}), /mount failed/)
    for (const cleanup of effects) cleanup()
    for (const cleanup of effects) cleanup()
    assert.equal(timers.size, 0, phase + ': acquired timers must unwind')
    assert.deepEqual(released, [...acquired].reverse(), phase + ': partial registrations unwind exactly once in reverse order')
    if (engine) assert.equal(engine._disposed, true)
    if (instrumented) for (const count of resources.values()) assert.equal(count, 1)
    // A queued startup heartbeat must not publish after the rollback.
    await new Promise(resolve => originals.setTimeout(resolve, 30))
    await assert.rejects(access(path.join(isolated, 'memory', 'polling-heartbeat.json')), { code: 'ENOENT' })
    console.log('PASS startup rollback: ' + phase)
  }
} finally {
  MemoryEngine.prototype.loadConfigSync = load
  for (const [key, value] of Object.entries(originals)) globalThis[key] = value
  await flushDiagnostics()
  await rm(isolated, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
