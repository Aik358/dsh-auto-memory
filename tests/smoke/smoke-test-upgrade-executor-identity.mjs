import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { readStorePre } from '../../lib/event-store.js'
import { planRevisionPre } from '../../lib/plan-store.js'
import { listPendingWritesPre } from '../../lib/upgrade-pending.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-upgrade-executor-'))
process.env.DSH_HOME = root
const indexUrl = new URL('../../lib/index.js', import.meta.url)
const source = (await readFile(process.env.DAM_STATE_ENGINE_SOURCE || indexUrl, 'utf8'))
  .replace(/(from |import\()'(\.\/[^']+)'/g, (_, prefix, relative) => prefix + JSON.stringify(new URL(relative, indexUrl).href))
const sourceFile = path.join(root, 'engine.mjs')
await writeFile(sourceFile, source + '\nexport { MemoryEngine }; export const flushDiagnostics = () => _diagChain;')
const { MemoryEngine, apply, flushDiagnostics } = await import(pathToFileURL(sourceFile).href)
const config = {
  memoryRoot: path.join(root, 'workspaces'),
  userMemoryDir: path.join(root, 'user'),
  handoffEnabled: true,
  autoContinueEnabled: false,
  teamEnabled: false,
  globalBriefEnabled: false,
  l0IndexEnabled: false,
  externalSources: {},
  greetingEnabled: false,
  autoConsolidate: false,
  criteriaGate: false,
  planAutoRedrawEnabled: false,
  pythonBackendEnabled: false,
  subagentProvider: 'configured-provider',
  subagentModel: 'configured-model',
}
// The real inventory excludes Windows temp-path workspace keys. These logical
// cwd values are never written to. Every resulting store is inside root.
const workspace = path.join(path.parse(root).root, 'dam-executor-fixture')
const [wsA, wsB, wsC] = ['first', 'second', 'unselected'].map(name => path.join(workspace, name))
const makeAgent = (id, cwd) => ({ id, session: { id, header: { id, cwd } }, ctx: { get() {} } })
const parent = makeAgent('dam-hub-parent', wsC)
const user = makeAgent('ordinary-user', wsA)
const tools = new Map()
const disposers = []
const starts = []
const executors = []
let engine
let scenario
let performChild
let childWork
let finishChild
let pass = 0
let fail = 0

async function check(name, fn) {
  try {
    await fn()
    pass++
    console.log('PASS ' + name)
  } catch (err) {
    fail++
    console.error('FAIL ' + name + ': ' + err.message)
  }
}

async function until(get, want, reason) {
  const end = Date.now() + 5000
  let last
  do {
    last = await get()
    if (want(last)) return last
    await delay(10)
  } while (Date.now() < end)
  throw new Error(reason + ': ' + JSON.stringify(last))
}

const subagents = {
  list: () => ['spawn'],
  async startActivation(spec) {
    starts.push({ scenario, spec })
    const executor = makeAgent(spec.childId || 'host-generated-' + starts.length, wsC)
    if (scenario === 'failed-turn') {
      const error = new Error('UNSUPPORTED_REASONING_EFFORT: provider apigoto model deepseek-flash does not support reasoning effort max')
      const result = Promise.reject(error)
      result.catch(() => {})
      return { childId: executor.id, messageId: 'rejected-effort', result, dispose() {} }
    }
    if (scenario !== 'main' && starts.filter(x => x.scenario === scenario).length === 1) {
      const error = new Error('UNKNOWN_MODEL fixture')
      if (scenario === 'fallback-start') throw error
      const result = Promise.reject(error)
      result.catch(() => {})
      return { childId: executor.id, messageId: 'rejected-model', result, dispose() {} }
    }
    executors.push(executor)
    const result = new Promise(resolve => { finishChild = resolve })
    // Exercise the real tool wrappers during initial admission, before the
    // host returns the activation receipt. rc.5 supplies no localAgent handle.
    childWork = await performChild(executor)
    return { childId: executor.id, messageId: 'accepted-message', result, dispose() {} }
  },
}

try {
  await writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify(config))
  await writeFile(path.join(root, 'settings.yaml'), 'agent-default-model:\n  provider: fallback-provider\n  model: fallback-model\n')
  const load = MemoryEngine.prototype.loadConfigSync
  const realFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => { throw new Error('network is disabled in this fixture') }
    MemoryEngine.prototype.loadConfigSync = function () {
      engine = this
      return load.call(this)
    }
    apply({
      get: name => ({
        subagents,
        agents: { get: id => id === user.id ? user : undefined },
        workspaceRegistry: { list: () => [wsA, wsC].map(workspacePath => ({ path: workspacePath })) },
      })[name],
      on: () => () => {},
      systemPrompt: { context: () => () => {}, section: () => () => {} },
      tools: { register: tool => { tools.set(tool.name, tool); return () => {} } },
      webServer: { register: () => () => {} },
      effect: fn => {
        const dispose = fn()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
    }, {})
  } finally {
    MemoryEngine.prototype.loadConfigSync = load
  }
  disposers.unshift(() => { globalThis.fetch = realFetch })
  assert.ok(engine)
  engine._workbenchReady = true
  engine._workbenchParent = parent

  const planPath = cwd => path.join(engine.projectDirOf(cwd), 'handoff', 'PLAN.md')
  const storePath = cwd => path.join(engine.projectDirOf(cwd), 'handoff', 'event-store.json')
  const pending = runId => listPendingWritesPre({ root: config.userMemoryDir, runId })
  const readState = () => engine.readUpgradeStatePre(parent)
  const runTool = (name, args, agent) => tools.get(name).execute(args, { agent })
  const makeEvent = (name, target, agent) => runTool('memory_event', {
    action: 'create', name, workspace: target,
    sections: { goal: 'Verify migration writes to the selected store', doing: 'Testing the production write tools', deadend: '', next: 'Inspect durable files' },
  }, agent)
  const seed = '# Original board\n\nSeed board before the upgrade.\n'
  for (const cwd of [wsA, wsB, wsC]) {
    await mkdir(path.dirname(planPath(cwd)), { recursive: true })
    await writeFile(planPath(cwd), seed)
  }
  await engine.writeUpgradeStatePre(parent, { phase: 'done', jobId: 'old-job', subagentSessionIds: [user.id] })

  performChild = async executor => {
    const marker = scenario + ' migration'
    const a = await makeEvent(marker + ' first', engine.wsKey(wsA), executor)
    const b = await makeEvent(marker + ' second', path.dirname(path.dirname(planPath(wsB))), executor)
    const c = await makeEvent(marker + ' forbidden', engine.wsKey(wsC), executor)
    const implicit = await makeEvent(marker + ' implicit forbidden', undefined, executor)
    const firstId = String(a).match(/事件已建立: (evt_[a-f0-9]{8})/)?.[1]
    const plan = await runTool('memory_note', {
      kind: 'plan',
      workspace: wsA,
      fromEvents: true,
      eventId: firstId,
      expectedRevision: planRevisionPre(await readFile(planPath(wsA), 'utf8')),
    }, executor)
    const secondId = String(b).match(/事件已建立: (evt_[a-f0-9]{8})/)?.[1]
    const secondPlan = await runTool('memory_note', {
      kind: 'plan',
      workspace: engine.wsKey(wsB),
      fromEvents: true,
      eventId: secondId,
      expectedRevision: planRevisionPre(await readFile(planPath(wsB), 'utf8')),
    }, executor)
    const log = await runTool('memory_log', {
      note: marker + ' log linked to the selected event.',
      eventId: firstId,
      workspace: wsA,
    }, executor)
    return { a, b, c, implicit, firstId, plan, secondPlan, log }
  }

  for (const mode of ['main', 'fallback-start', 'fallback-result']) {
    scenario = mode
    childWork = undefined
    user.session.header.cwd = wsA
    const state = await engine.startUpgradeJobPre(parent, {
      scope: 'subset', workspaceKeys: [engine.wsKey(wsA), engine.wsKey(wsB)], ws: wsC,
    })
    assert.equal(state.ok, true, JSON.stringify(state))
    const activation = await until(
      async () => ({ childWork, phase: (await readState()).phase, starts: starts.filter(x => x.scenario === mode).length }),
      status => Boolean(status.childWork) || status.phase !== 'running', mode + ' child tools did not return',
    )
    if (!activation.childWork) {
      await check(mode + ' child tools return after activation', () => assert.fail(JSON.stringify(activation)))
      continue
    }
    const scope = await readState()
    const ids = starts.filter(x => x.scenario === mode).map(x => x.spec.childId)
    await check(mode + ' starts with reserved session identity and selected scope', async () => {
      assert.equal(ids.length, mode === 'main' ? 1 : 2)
      assert.ok(ids.every(id => typeof id === 'string' && id.length > 0), JSON.stringify(ids))
      assert.equal(new Set(ids).size, ids.length)
      assert.deepEqual(scope.perWorkspace.map(row => row.wsKey).sort(), [engine.wsKey(wsA), engine.wsKey(wsB)].sort())
      if (mode !== 'main') {
        assert.deepEqual(starts.at(-1).spec.agentOptions, { provider: 'fallback-provider', model: 'fallback-model' })
      }
    })
    await check(mode + ' writes each selected store before the host returns its receipt', async () => {
      assert.match(childWork.a, /事件已建立:/)
      assert.match(childWork.b, /事件已建立:/)
      const first = (await readStorePre(storePath(wsA))).events
      const second = (await readStorePre(storePath(wsB))).events
      assert.ok(first.some(event => event.name === mode + ' migration first'))
      assert.ok(second.some(event => event.name === mode + ' migration second'))
      assert.ok((await readFile(planPath(wsA), 'utf8')).includes(mode + ' migration first'), childWork.plan)
      assert.ok(first.find(event => event.id === childWork.firstId).checkpoints.some(cp => cp.text.includes(mode + ' migration log')), childWork.log)
    })
    await check(mode + ' renders PLAN for an inventory workspace without a host registry entry', async () => {
      const text = await readFile(planPath(wsB), 'utf8')
      assert.ok(text.includes(mode + ' migration second'), childWork.secondPlan)
      assert.ok(!text.includes(mode + ' migration first'))
    })
    await check(mode + ' refuses both explicit and implicit unselected targets', async () => {
      assert.doesNotMatch(childWork.c, /事件已建立:|已暂存到补写队列/)
      assert.doesNotMatch(childWork.implicit, /事件已建立:|已暂存到补写队列/)
      assert.match(childWork.c, /工作区.*(?:清单|范围)/)
      assert.match(childWork.implicit, /工作区.*(?:清单|范围)/)
      assert.deepEqual((await readStorePre(storePath(wsC))).events, [])
      assert.equal(await readFile(planPath(wsC), 'utf8'), seed)
    })
    for (const identity of mode === 'main' ? [user] : [user, executors[0]]) {
      const ordinary = makeAgent(identity.id, wsA)
      const marker = mode + ' queued from ' + identity.id
      await check(mode + ' queues a same-workspace ordinary write for ' + identity.id, async () => {
        const same = await makeEvent(marker, undefined, ordinary)
        assert.match(same, /已暂存到补写队列/)
        assert.ok(!(await readStorePre(storePath(wsA))).events.some(event => event.name === marker))
        const entries = await Promise.all((await pending(state.jobId)).map(async file => JSON.parse(await readFile(file, 'utf8'))))
        assert.equal(entries.find(record => record.entry.args.name === marker)?.entry.target.projectDir, engine.projectDirOf(wsA))
      })
    }
    await check(mode + ' refuses cross-workspace ordinary writes without queueing', async () => {
      const before = await pending(state.jobId)
      const cross = await makeEvent(mode + ' ordinary cross refused', engine.wsKey(wsB), user)
      assert.doesNotMatch(cross, /事件已建立:|已暂存到补写队列/)
      assert.deepEqual(await pending(state.jobId), before)
      assert.ok(!(await readStorePre(storePath(wsB))).events.some(event => event.name === mode + ' ordinary cross refused'))
    })
    let replayFinished = false
    let resolvesBeforeCommit = 0
    const resolvePaths = engine.resolvePaths
    const replayPending = engine.replayUpgradePendingWritesPre
    if (mode === 'main') {
      await check('invalid writes are queued separately before replay', async () => {
        const text = await runTool('memory_event', { action: 'append', checkpoint: { kind: 'progress', text: 'No event ID' } }, user)
        assert.match(text, /已暂存到补写队列/)
        const note = await runTool('memory_note', { kind: 'plan', content: '   ' }, user)
        assert.match(note, /已暂存到补写队列/)
        const log = await runTool('memory_log', { note: 'No event exists for this queued log.', eventId: 'evt_12345678' }, user)
        assert.match(log, /已暂存到补写队列/)
        const entries = await Promise.all((await pending(state.jobId)).map(async file => JSON.parse(await readFile(file, 'utf8'))))
        assert.deepEqual(entries.filter(record => record.entry.args.action !== 'create').map(record => [record.entry.tool, record.attempts]).sort(), [
          ['memory_event', 0], ['memory_log', 0], ['memory_note', 0],
        ])
      })
      const queuedEventName = mode + ' queued from ' + user.id
      const applyPendingEntry = engine._applyPendingEntryPre
      engine._applyPendingEntryPre = async function (entry, meta) {
        if (entry.args.name !== queuedEventName) return applyPendingEntry.call(this, entry, meta)
        this.resolvePaths = async function (agent) {
          if (agent?.session?.id === user.id && !(await readStorePre(storePath(wsA))).events.some(event => event.name === queuedEventName)) {
            resolvesBeforeCommit++
          }
          return resolvePaths.call(this, agent)
        }
        try {
          return await applyPendingEntry.call(this, entry, meta)
        } finally {
          this.resolvePaths = resolvePaths
        }
      }
      engine.replayUpgradePendingWritesPre = async function (opts) {
        try {
          return await replayPending.call(this, opts)
        } finally {
          if (opts?.runId === state.jobId) {
            this._applyPendingEntryPre = applyPendingEntry
            this.replayUpgradePendingWritesPre = replayPending
            replayFinished = true
          }
        }
      }
    }
    user.session.header.cwd = wsB
    finishChild({ output: [{ type: 'text', text: 'Migration test completed.' }] })
    const done = await until(readState, current => current.phase !== 'running', 'job did not finish')
    await check(mode + ' reports done with durable evidence for each selected workspace', () => {
      assert.equal(done.phase, 'done', JSON.stringify(done))
      assert.equal(done.evidenceVerdict.verifiable, true)
      assert.deepEqual(done.perWorkspace.map(row => row.wsKey).sort(), [engine.wsKey(wsA), engine.wsKey(wsB)].sort())
      for (const row of done.perWorkspace) {
        assert.equal(row.phase, 'done')
        assert.equal(row.evidence.dEvent, 1)
        assert.equal(row.evidence.planChanged, true)
      }
    })
    await check(mode + ' replays queued writes after completion into only the original store', async () => {
      if (mode === 'main') await until(() => replayFinished, Boolean, 'pending replay did not finish')
      else await until(() => pending(state.jobId), queued => queued.length === 0, 'pending replay did not drain')
      assert.equal((await engine.resolvePaths(user)).ws, wsB)
      const a = (await readStorePre(storePath(wsA))).events
      const b = (await readStorePre(storePath(wsB))).events
      const expected = mode === 'main' ? 1 : 2
      assert.equal(a.filter(event => event.name.startsWith(mode + ' queued from ')).length, expected)
      assert.equal(b.filter(event => event.name.startsWith(mode + ' queued from ')).length, 0)
    })
    if (mode === 'main') {
      await check('registered event replay resolves the workspace once before commit', () => {
        assert.equal(resolvesBeforeCommit, 1)
      })
      for (const [tool, reason] of [
        ['memory_event', /append 需要 eventId/],
        ['memory_log', /eventId 不存在/],
        ['memory_note', /content 为空/],
      ]) {
        await check('refused ' + tool + ' replay retains its pending file and records the failure', async () => {
          const records = await Promise.all((await pending(state.jobId)).map(async file => JSON.parse(await readFile(file, 'utf8'))))
          const retained = records.find(record => record.entry.tool === tool)
          assert.ok(retained, tool + ' queue entry was removed')
          assert.equal(retained.attempts, 1)
          assert.equal(retained.lastError.code, 'handler-refused')
          assert.match(retained.lastError.error, reason)
        })
      }
    }
    await check(mode + ' removes cross-workspace access from the retired executor', async () => {
      const result = await makeEvent(mode + ' retired privilege', engine.wsKey(wsB), executors.at(-1))
      assert.match(result, /跨工作区写仅限/)
      assert.ok(!(await readStorePre(storePath(wsB))).events.some(event => event.name === mode + ' retired privilege'))
    })
  }
  engine._llm = {
    listProviders: () => [{ id: 'apigoto' }],
    listModels: async () => [{ id: 'deepseek-flash' }],
  }
  scenario = 'unsupported-selection'
  user.session.header.cwd = wsA
  const startsBeforeUnsupported = starts.length
  const unsupported = await engine.startUpgradeJobPre(parent, {
    scope: 'subset', workspaceKeys: [engine.wsKey(wsA)], ws: wsC,
    provider: 'apigoto', model: 'deepseek-flash', effort: 'max',
  })
  const unsupportedState = await readState()
  await check('unsupported effort is rejected before spawning and marked failed', () => {
    assert.equal(unsupported.ok, false, JSON.stringify(unsupported))
    assert.equal(unsupported.error, 'unsupported-reasoning-effort')
    assert.equal(starts.length, startsBeforeUnsupported)
    assert.equal(unsupportedState.phase, 'failed')
    assert.equal(unsupportedState.perWorkspace[0].phase, 'failed')
  })
  engine._llm = undefined
  scenario = 'failed-turn'
  childWork = undefined
  user.session.header.cwd = wsA
  const failedStart = await engine.startUpgradeJobPre(parent, {
    scope: 'subset', workspaceKeys: [engine.wsKey(wsA)], ws: wsC,
  })
  assert.equal(failedStart.ok, true, JSON.stringify(failedStart))
  const failedTurn = await until(readState, current => current.phase !== 'running', 'failed model turn did not settle')
  await check('failed model turn preserves the provider error in upgrade state', () => {
    assert.equal(failedTurn.phase, 'failed', JSON.stringify(failedTurn))
    assert.match(failedTurn.error, /UNSUPPORTED_REASONING_EFFORT/)
    assert.match(failedTurn.error, /apigoto.*deepseek-flash/)
  })
  await check('zero-write failure is counted failed, never complete or pending', () => {
    assert.equal(failedTurn.perWorkspace.length, 1)
    assert.equal(failedTurn.perWorkspace[0].phase, 'failed', JSON.stringify(failedTurn.perWorkspace))
    assert.equal(failedTurn.perWorkspace.some(row => row.phase === 'done'), false)
  })
} catch (err) {
  fail++
  console.error(err.stack)
} finally {
  for (const dispose of disposers.reverse()) await dispose()
  await flushDiagnostics()
  await rm(root, { recursive: true, force: true, maxRetries: 3 })
}

console.log(`${pass} PASS / ${fail} FAIL`)
if (fail) process.exitCode = 1
