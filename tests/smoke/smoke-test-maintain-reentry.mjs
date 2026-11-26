import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as realDelay } from 'node:timers/promises'
import { withSubagentGuardPre } from '../../lib/subagent-prompt-guard.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-maintain-reentry-'))
process.env.DSH_HOME = root
const { MemoryEngine, apply, flushDiagnostics } = await import('../lib/audit-engine.mjs')
const realTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout
const realInterval = globalThis.setInterval
const oldName = '2000-01-01.md'
const oldBytes = Buffer.from('# Old project log\r\n- Keep this fully intact. 中文内容。\r\n')
const registered = new Map()
const virtualTimers = new Map()
const pending = () => new Promise(() => {})
const nextTick = () => new Promise(resolve => setImmediate(resolve))
const checked = async (promise, context) => {
  const watchdog = new AbortController()
  try {
    return await Promise.race([promise, realDelay(2500, null, { signal: watchdog.signal }).then(() => {
      throw new Error('Bounded return expected: ' + context)
    })])
  } finally {
    watchdog.abort()
  }
}

let engine
let disposePlugin
let caseCount = 0
let serial = 0
const it = async (name, run) => {
  await run()
  console.log('PASS ' + name)
  caseCount++
}
const scope = async (name, writeOld = true) => {
  const cwd = path.join(root, name)
  const agent = { session: { id: 'fixture-' + (++serial), header: { cwd } }, ctx: { get: () => undefined } }
  await mkdir(cwd, { recursive: true })
  const { projectDir, notesPath } = await engine.resolvePaths(agent)
  await mkdir(projectDir, { recursive: true })
  if (writeOld) await writeFile(path.join(projectDir, oldName), oldBytes)
  return { agent, notesPath, original: path.join(projectDir, oldName), archived: path.join(projectDir, 'archive', oldName) }
}
const assertArchived = async (fixture) => {
  assert.deepEqual(await readFile(fixture.archived), oldBytes)
  await assert.rejects(readFile(fixture.original), { code: 'ENOENT' })
}
const assertPreserved = async (fixture) => assert.deepEqual(await readFile(fixture.original), oldBytes)
const worker = (fixture, id, label = 'auto-memory-long-distill-g01') => ({
  session: { id, header: { cwd: fixture.agent.session.header.cwd, origin: 'subagent', label } },
  ctx: fixture.agent.ctx,
})
const completed = (text) => ({ output: [{ type: 'text', text }], stopReason: 'completed' })
const setBackend = (startActivation) => {
  engine._subagents = { list: () => ['spawn'], startActivation }
}
const fireDeadline = (ms) => {
  const matches = [...virtualTimers].filter(([, timer]) => timer.ms === ms)
  assert.equal(matches.length, 1, 'the maintenance job must use a single deadline')
  const [handle, { fn }] = matches[0]
  virtualTimers.delete(handle)
  fn()
}
const call = (agent, days = 30, extraArgs = {}) => registered.get('memory_maintain').execute({ days, ...extraArgs }, { agent })

try {
  await writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user'), externalSources: {}, globalBriefEnabled: false,
  }))
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  const originalLoad = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return originalLoad.call(this) }
  globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
  try {
    apply({
      get: () => undefined, credentials: {}, on: () => {},
      systemPrompt: { context: () => () => {}, section: () => () => {} },
      tools: { register: tool => { registered.set(tool.name, tool); return () => {} } },
      webServer: { register: () => () => {} },
      effect: f => { disposePlugin = f() },
    }, {})
  } finally {
    MemoryEngine.prototype.loadConfigSync = originalLoad
    globalThis.setTimeout = realTimeout
    globalThis.setInterval = realInterval
  }
  assert.ok(engine && registered.has('memory_maintain'))
  engine._workbenchReady = true
  engine._workbenchParent = { session: { id: 'fixture-hub' }, ctx: { get: () => undefined } }
  engine._readWorkbench = async () => ({})
  engine.wbOwnerOf = () => 'current'
  engine._wbTokenOf = () => ''
  // The real host advances generations and recycles sessions. The fixture has no real child files.
  engine.bumpGenFor = async () => {}
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (![180000, 240000, 300000].includes(ms)) return realTimeout(fn, ms, ...args)
    const handle = { unref() { return this } }
    virtualTimers.set(handle, { ms, fn })
    return handle
  }
  globalThis.clearTimeout = handle => { if (!virtualTimers.delete(handle)) realClearTimeout(handle) }

  await it('pre-admission exact ID, same-day and changed-day calls return NO', async () => {
    const f = await scope('reentry')
    let launches = 0
    let acceptedId
    setBackend(async (spec) => {
      launches++
      acceptedId = spec.childId
      const child = worker(f, spec.childId || 'unregistered-distill')
      const no = await checked(call(child), 'same-day nested tool call')
      assert.match(no, /^NO：.*子代理/)
      assert.match(no, /直接根据任务附带的日志提炼要点/)
      assert.match(await checked(call(child, 7, { confirm: true }), 'changed-day nested tool call'), /^NO：/)
      return { childId: spec.childId, result: Promise.resolve(completed('### Topic\n- A useful fixture conclusion.')) }
    })
    const result = await checked(call(f.agent), 'outer maintenance with cooperative child')
    assert.match(acceptedId, /^[a-f0-9-]{36}$/)
    assert.equal(launches, 1)
    assert.match(result, /AI 提炼 \+ 原文归档/)
    assert.match(await readFile(f.notesPath, 'utf8'), /A useful fixture conclusion/)
    await assertArchived(f)
    // Receipt settled. A resumed session whose earlier activation is over is outside this gate.
    const after = await call(worker(f, acceptedId))
    assert.match(after, /没有超过 30 天/)
  })

  await it('a different agent with the same display label can request maintenance', async () => {
    const f = await scope('same-label')
    const fake = worker(f, 'different-id')
    let launches = 0
    setBackend(async (spec) => {
      launches++
      return { childId: spec.childId, result: Promise.resolve(completed('### Topic\n- A valid normal request.')) }
    })
    assert.match(await checked(call(fake), 'independent subagent tool call'), /AI 提炼 \+ 原文归档/)
    assert.equal(launches, 1)
    await assertArchived(f)
  })

  await it('a different job retains its original prompt and activation shape', async () => {
    const f = await scope('other-job', false)
    const prompt = 'Produce a consolidation result for a different job.'
    const label = 'auto-memory-consolidate-logs'
    setBackend(async (spec) => {
      assert.equal(spec.childId, undefined)
      assert.equal(spec.prompt[0].text, withSubagentGuardPre(prompt, label))
      return { childId: 'consolidation-child', result: Promise.resolve(completed('Consolidation output')) }
    })
    assert.equal(await checked(engine.runSubagent(prompt, label, f.agent), 'different job'), 'Consolidation output')
  })

  await it('timeout returns archive-only while cleanup remains pending', async () => {
    const f = await scope('stuck-disposal')
    engine.config.subagentTimeoutSeconds = 180
    engine._subagentLastTimeout = false
    const accepted = Promise.withResolvers()
    const output = Promise.withResolvers()
    const disposal = Promise.withResolvers()
    let disposeCalls = 0
    setBackend(async (spec) => {
      accepted.resolve(spec)
      return { childId: spec.childId, result: output.promise, dispose: () => { disposeCalls++; return disposal.promise } }
    })
    const previousBudget = engine.ensureBudget
    let budgetCalls = 0
    engine.ensureBudget = () => { budgetCalls++; return pending() }
    try {
      const outer = call(f.agent)
      const spec = await checked(accepted.promise, 'child activation')
      await nextTick()
      fireDeadline(180000)
      const result = await checked(outer, 'archive fallback with stuck disposal and budget')
      assert.match(result, /超过 180 秒/)
      assert.match(result, /已核验 1 份归档副本/)
      assert.equal(disposeCalls, 1)
      assert.equal(budgetCalls, 0)
      assert.equal(engine._subagentLastTimeout, false)
      assert.equal(engine._subagentInflight, 0)
      assert.equal(spec.signal.aborted, true)
      await assertArchived(f)
      assert.match(await call(worker(f, spec.childId)), /^NO：/, 'timed-out worker stays in the gate until exit')
      output.resolve(completed('A late response must not enter notes'))
      disposal.resolve()
      await nextTick()
      await assert.rejects(readFile(f.notesPath), { code: 'ENOENT' })
    } finally {
      engine.ensureBudget = previousBudget
    }
  })

  await it('stalled host activation times out and a late receipt is disposed', async () => {
    const f = await scope('stuck-startup')
    engine.config.subagentTimeoutSeconds = 300
    const called = Promise.withResolvers()
    const late = Promise.withResolvers()
    let disposeCalls = 0
    setBackend((spec) => { called.resolve(spec); return late.promise })
    const outer = call(f.agent)
    const spec = await checked(called.promise, 'host startup')
    fireDeadline(300000)
    const result = await checked(outer, 'archive fallback with stuck host startup')
    assert.match(result, /超过 300 秒/)
    assert.equal(spec.signal.aborted, true)
    await assertArchived(f)
    late.resolve({ childId: spec.childId, result: pending(), dispose: () => { disposeCalls++ } })
    await nextTick()
    assert.equal(disposeCalls, 1)
  })

  await it('archive failure and altered readback preserve active originals', async () => {
    const f = await scope('archive-failure')
    const f2 = await scope('archive-mismatch')
    engine.config.subagentTimeoutSeconds = 240
    const previousWrite = engine.writeFull
    engine.writeFull = async function (file, text, options) {
      if (file === f.archived) throw new Error('Fixture archive write failure')
      if (file === f2.archived) return previousWrite.call(this, file, text + 'changed', options)
      return previousWrite.call(this, file, text, options)
    }
    try {
      for (const fixture of [f, f2]) {
        const active = Promise.withResolvers()
        setBackend(async (spec) => {
          active.resolve()
          return { childId: spec.childId, result: pending(), dispose: () => {} }
        })
        const outer = call(fixture.agent)
        await checked(active.promise, 'child activation before archive failure')
        await nextTick()
        fireDeadline(240000)
        const result = await checked(outer, 'error receipt')
        assert.match(result, /部分完成/)
        assert.match(result, /归档未成功，活跃原文已保留/)
        assert.doesNotMatch(result, /已核验|已保底归档/)
        await assertPreserved(fixture)
      }
    } finally {
      engine.writeFull = previousWrite
    }
  })

  await it('legacy activation without reserved identity uses original-only fallback', async () => {
    const f = await scope('legacy-host')
    let starts = 0
    engine._subagents = { list: () => ['spawn'], start: () => { starts++; return pending() } }
    const out = await checked(call(f.agent), 'legacy host with no safe child identity')
    assert.match(out, /AI 蒸馏不可用/)
    assert.equal(starts, 0)
    await assertArchived(f)
  })
  console.log('maintain reentry: ' + caseCount + ' cases passed')
} finally {
  globalThis.setTimeout = realTimeout
  globalThis.setInterval = realInterval
  globalThis.clearTimeout = realClearTimeout
  if (typeof disposePlugin === 'function') disposePlugin()
  await flushDiagnostics()
  await rm(root, { recursive: true, force: true })
}
