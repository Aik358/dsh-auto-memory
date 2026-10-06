import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)

if (process.argv[2] === '--probe') {
  const { apply, flushDiagnostics } = await import('../lib/audit-engine.mjs')
  const root = process.env.DSH_HOME
  const timeout = globalThis.setTimeout, interval = globalThis.setInterval
  await writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ globalBriefEnabled: false, externalSources: {}, memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user') }))
  const mount = () => {
    globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
    let cleanup
    try {
      apply({ get: () => undefined, on() {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: fn => { cleanup = fn() } }, {})
    } finally { globalThis.setTimeout = timeout; globalThis.setInterval = interval }
    return cleanup
  }
  const kind = process.argv[3]
  if (kind === 'lifecycle') {
    const events = ['uncaughtException', 'unhandledRejection', 'uncaughtExceptionMonitor', 'exit']
    const counts = Object.fromEntries(events.map(event => [event, process.listenerCount(event)]))
    const streams = [process.stdout.listenerCount('error'), process.stderr.listenerCount('error')]
    const a = mount(), b = mount()
    assert.equal(process.listenerCount('uncaughtException'), counts.uncaughtException)
    assert.equal(process.listenerCount('unhandledRejection'), counts.unhandledRejection)
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), counts.uncaughtExceptionMonitor + 1)
    a(); a()
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), counts.uncaughtExceptionMonitor + 1, 'second mount still owns diagnostics')
    b(); b()
    for (const event of events) assert.equal(process.listenerCount(event), counts[event], event)
    assert.deepEqual([process.stdout.listenerCount('error'), process.stderr.listenerCount('error')], streams)
    const c = mount(); c()
    for (const event of events) assert.equal(process.listenerCount(event), counts[event], event)
    const failedEffects = []
    globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
    try {
      assert.throws(() => apply({ get: () => undefined, on() {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register() { throw Error('mount failed') } }, webServer: { register: () => () => {} }, effect: fn => failedEffects.push(fn()) }, {}), /mount failed/)
    } finally {
      globalThis.setTimeout = timeout; globalThis.setInterval = interval
      for (const dispose of failedEffects) dispose()
    }
    for (const event of events) assert.equal(process.listenerCount(event), counts[event], event)
    assert.throws(() => apply({ effect() { throw Error('effect registration failed') } }, {}), /effect registration failed/)
    for (const event of events) assert.equal(process.listenerCount(event), counts[event], event)
    await flushDiagnostics()
    // Engine background writes may already have started before mounting completed.
    for (let attempt = 0; ; attempt++) {
      try { await rm(root, { recursive: true, force: true }); break }
      catch (error) { if (attempt === 9) throw error; await new Promise(resolve => timeout(resolve, 100)) }
    }
    console.log('PASS diagnostic ownership and repeated unload/reload')
  } else {
    mount()
    if (kind === 'host-handler') process.on('uncaughtException', () => { console.log('HOST_POLICY'); process.exitCode = 7 })
    setImmediate(() => {
      if (kind === 'rejection') void Promise.reject(new Error('AUDIT_FATAL_REJECTION'))
      else throw new Error('AUDIT_FATAL_EXCEPTION')
    })
    setImmediate(() => console.log('AFTER_FATAL'))
  }
} else {
  const roots = []
  try {
    for (const kind of ['exception', 'rejection', 'host-handler', 'lifecycle']) {
      const isolated = await mkdtemp(path.join(os.tmpdir(), 'dam-fatal-process-'))
      roots.push(isolated)
      const result = spawnSync(process.execPath, ['--unhandled-rejections=throw', self, '--probe', kind], {
        encoding: 'utf8', timeout: 15000,
        env: { ...process.env, HOME: isolated, USERPROFILE: isolated, DSH_HOME: isolated },
      })
      assert.equal(result.error, undefined, String(result.error))
      assert.equal(result.status, kind === 'host-handler' ? 7 : kind === 'lifecycle' ? 0 : 1, result.stdout + result.stderr)
      if (kind === 'exception' || kind === 'rejection') {
        assert(!result.stdout.includes('AFTER_FATAL'), 'fatal error continued host work')
        assert.match(result.stderr, /\[dsh-auto-memory\].*(uncaughtException|unhandledRejection)/)
      }
      if (kind === 'host-handler') assert.match(result.stdout, /HOST_POLICY/)
      console.log(`PASS ${kind}: host exit policy is preserved`)
    }
  } finally { for (const root of roots) await rm(root, { recursive: true, force: true }) }
}
