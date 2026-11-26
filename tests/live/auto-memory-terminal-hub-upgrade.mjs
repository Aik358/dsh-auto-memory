import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const [desktop, packageDir = repo] = process.argv.slice(2)
if (!desktop || process.argv.length > 4) {
  console.error('Usage: node tests/live/auto-memory-terminal-hub-upgrade.mjs <Desktop executable> [plugin package directory]')
  process.exit(2)
}
const plugin = resolve(packageDir)
assert.ok(process.env.DAM_SESSION_QUERY_BUILD_DIR, 'Set DAM_SESSION_QUERY_BUILD_DIR to the compiled session-query worktree')
const baseline = new URL('./auto-memory-cli-baseline.mjs', import.meta.url).href
const hook = registerHooks({
  load(url, context, next) {
    const loaded = next(url, context)
    if (url !== baseline) return loaded
    const source = Buffer.from(loaded.source).toString('utf8').replaceAll('\r\n', '\n')
    const dispatch = source.lastIndexOf('\nif (mutationMode) {\n  await verifyMutation')
    const environment = '    ...inherited,\n    DSH_HOME: home,'
    assert.ok(dispatch > 0 && source.includes(environment), 'Baseline launcher anchors changed')
    return {
      ...loaded,
      source: source.slice(0, dispatch).replace(environment, [
        '    ...inherited,',
        "    HOME: root, USERPROFILE: root, APPDATA: join(root, 'roaming'),",
        '    TMP: root, TEMP: root, TMPDIR: root,',
        '    DSH_HOME: home,',
      ].join('\n')) + '\nexport { authenticate, cli, createWorkspace, pluginRequest, report, sha256, startDesktop, prepare }\n',
    }
  },
})
const argv = process.argv
let launcher
try {
  process.argv = [...argv.slice(0, 2), desktop, plugin]
  launcher = await import(baseline)
} finally {
  process.argv = argv
  hook.deregister()
}
const { authenticate, cli, createWorkspace, pluginRequest, report, sha256, startDesktop, prepare } = launcher
// The upgrade inventory intentionally excludes workspace keys containing AppData-Local-Temp.
const parent = await realpath(resolve(process.env.DAM_HUB_PROBE_TMP || dirname(resolve(repo))))
const root = await mkdtemp(join(parent, 'dam-terminal-hub-upgrade-'))
const entry = join(plugin, 'lib', 'terminal', 'cli.js')
const { createProcedureStorePre } = await import(pathToFileURL(join(plugin, 'lib', 'procedure-store.js')))

function inside(base, file) {
  const remainder = relative(base, file)
  assert.ok(remainder && !isAbsolute(remainder) && !/^\.\.(?:[\\/]|$)/u.test(remainder), 'Fixture path escapes isolation')
  return file
}

async function seedHub(home) {
  const procedures = createProcedureStorePre()
  const seed = (name, riskLevel = 'low') => {
    const observed = procedures.observe({
      title: name, riskLevel, steps: ['Read the synthetic checklist: ' + name],
      successCriteria: ['Read back from the isolated Desktop profile'], scope: 'global',
    })
    assert.equal(observed.ok, true)
    return observed.procedure.procedureId
  }
  const ids = { cli: seed('Loopback checklist A'), web: seed('Loopback checklist B'), high: seed('Loopback high risk', 'high') }
  for (const id of [ids.cli, ids.web]) {
    const promoted = procedures.promote(id, {}, { authorizedBy: 'user' })
    assert.equal(promoted.procedure.stage, 'validated')
  }
  const file = join(home, 'memory', 'hub', 'procedures.json')
  await mkdir(dirname(file), { recursive: true })
  const snapshot = procedures.snapshot()
  // A legacy validated row can still require approval. Exercise that gate in activate().
  snapshot.procedures.find(row => row.procedureId === ids.high).stage = 'validated'
  await writeFile(file, JSON.stringify(snapshot), { flag: 'wx' })
  return { ...ids, file }
}

async function startLoopback() {
  let scenario
  const arm = (workspaces, writeEvents) => {
    const arrived = Promise.withResolvers()
    const paused = Promise.withResolvers()
    scenario = { workspaces, writeEvents, arrived, paused, requests: 0, tools: 0, errors: [] }
    return scenario
  }
  const server = createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      const pathname = new URL(req.url, 'http://127.0.0.1').pathname
      if (pathname.endsWith('/count_tokens')) {
        res.setHeader('content-type', 'application/json')
        return res.end('{"input_tokens":100}')
      }
      if (!pathname.endsWith('/messages')) { res.statusCode = 404; return res.end() }
      const active = scenario
      const contents = [...(input.messages || []).map(item => item.content), input.system].flat()
      const prompt = contents.map(part => typeof part === 'string' ? part : part?.text ?? '')
        .find(text => text.includes('WORKSPACE-MANIFEST:BEGIN'))
      let toolCall
      if (active && prompt) {
        const manifest = prompt.split('WORKSPACE-MANIFEST:END')[0]
        const selected = [...manifest.matchAll(/^\| \d+ \| \x60([^\x60]+)\x60/mgu)].map(match => match[1]).sort()
        assert.deepEqual(selected, active.workspaces.map(item => item.wsKey).sort())
        const previous = contents.filter(part => part?.type === 'tool_result' && part.tool_use_id?.startsWith('toolu_upgrade_fixture_'))
        assert.ok(previous.every(item => !item.is_error && /事件已建立/u.test(JSON.stringify(item))), JSON.stringify(previous))
        if (!active.requests++) {
          active.arrived.resolve(true)
          await active.paused.promise
        }
        if (active.writeEvents && previous.length < active.workspaces.length) {
          const tool = input.tools?.find(tool => /(?:^|__)memory_event$/u.test(tool.name))
          assert.ok(tool, 'The real upgrade executor was not offered memory_event')
          const workspace = active.workspaces[previous.length]
          const event = { action: 'create', workspace: workspace.wsKey, name: 'Synthetic upgrade event', summary: 'Loopback execution evidence' }
          toolCall = { name: tool.name, id: 'toolu_upgrade_fixture_' + previous.length, event }
          active.tools++
        }
      }
      const stop = toolCall ? 'tool_use' : 'end_turn'
      const message = { id: 'msg_upgrade_fixture', type: 'message', role: 'assistant', content: [], model: input.model,
        stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } }
      const block = toolCall
        ? { type: 'tool_use', id: toolCall.id, name: toolCall.name, input: {} }
        : { type: 'text', text: '' }
      const fixtureText = 'Synthetic Desktop upgrade response.'
      if (!input.stream) {
        res.setHeader('content-type', 'application/json')
        return res.end(JSON.stringify({ ...message, stop_reason: stop, content: [
          toolCall ? { ...block, input: toolCall.event } : { ...block, text: fixtureText },
        ] }))
      }
      const frames = [
        { type: 'message_start', message },
        { type: 'content_block_start', index: 0, content_block: block },
        { type: 'content_block_delta', index: 0, delta: toolCall
          ? { type: 'input_json_delta', partial_json: JSON.stringify(toolCall.event) }
          : { type: 'text_delta', text: fixtureText } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ]
      res.setHeader('content-type', 'text/event-stream')
      res.end(frames.map(frame => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join(''))
    } catch (error) {
      scenario?.errors.push(String(error.message))
      scenario?.arrived.resolve(false)
      res.statusCode = 500
      res.end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { arm, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => {
    scenario?.paused.resolve()
    server.close(resolve)
    server.closeAllConnections()
  }) }
}

async function check(home, launch, connection, fixtures, model) {
  const web = (route, options) => pluginRequest(connection, route, options)
  async function workspace(name, withLog = true) {
    const path = join(root, name)
    const ids = await createWorkspace(connection, path)
    const state = await web('state', { query: { ws: path } })
    assert.equal(await realpath(state.ws), await realpath(path))
    const projectDir = inside(join(home, 'memory'), state.projectDir)
    if (withLog) {
      await mkdir(projectDir, { recursive: true })
      await writeFile(join(projectDir, '2000-01-01.md'), '# ' + name + '\n\n- Synthetic legacy evidence.\n', { flag: 'wx' })
    }
    return { ...ids, path, projectDir, wsKey: basename(projectDir) }
  }
  const a = await workspace('project-A')
  const b = await workspace('project-B')
  const empty = await workspace('project-empty', false)
  const browserScope = project => ({ sessionId: project.sessionId, ws: project.path })
  const shell = (args, { project = a, input, exit = 0 } = {}) => cli(root, home, project, [
    '--dsh-home', home, '--profile', 'desktop',
    '--workspace-ref', project.workspaceId, ...(project.sessionId ? ['--session', project.sessionId] : []), ...args,
  ], undefined, { entry, input, expectedExit: exit })
  const call = (id, input, project) => shell(['api', 'call', id], { input, project })
  const approve = () => ['--yes', '--request-id', randomUUID()]
  async function write(id, input, { project, exit = 0, approval = approve() } = {}) {
    const result = await shell(['api', 'call', id, ...approval], { input, exit, project })
    if (exit === 0) assert.deepEqual(result.receipt, { requestId: approval[2], state: 'finished' })
    return result
  }
  const doctor = await shell(['doctor'])
  const official = await cli(root, home, a, ['doctor'], launch, { entry })
  assert.deepEqual(doctor.identity, official.identity)
  assert.equal(doctor.scope.sessionId, a.sessionId)
  assert.equal(doctor.status.searchIndex.committedSearchVersion, 1)
  const manifest = await shell(['api', 'list'])
  report('desktop terminal attached', {
    identity: doctor.identity, committedSearchVersion: doctor.status.searchIndex.committedSearchVersion,
    contract: doctor.contractVersion, operations: manifest.operations.length,
  })
  const reviewId = 'memory.hub.review'
  const hubActions = ['activate', 'deprecate', 'pin']
  const hubOperation = manifest.operations.find(op => op.id === reviewId)
  assert.equal(hubOperation?.status, 'available')
  assert.equal(hubOperation.scope, 'session')
  assert.equal(hubOperation.approval, 'explicit-confirmation')
  assert.ok(hubActions.every(action => hubOperation.inputSchema.properties.action.enum.includes(action)))
  assert.ok(hubActions.every(action => !manifest.operations.some(op => op.id === 'memory.hub.' + action)))
  const review = (action, procedureId, fields = {}, opts) => write(reviewId, { action, procedureId, ...fields }, opts)
  const webReview = (action, procedureId, fields = {}) => web('memory-hub', {
    body: { action, procedureId, sessionId: a.sessionId, ...fields },
  })
  const row = (hub, id) => [...hub.procedures.pipeline, ...hub.procedures.active].find(item => item.procedureId === id)
  async function hubPair(id) {
    const fromCLI = await call('memory.hub')
    const fromWeb = await web('memory-hub')
    assert.deepEqual(row(fromCLI, id), row(fromWeb, id))
    return row(fromWeb, id)
  }
  const before = sha256(await readFile(fixtures.file))
  assert.equal((await review('activate', fixtures.cli, {}, { approval: [], exit: 3 })).error.code, 'confirmation-required')
  const high = await review('activate', fixtures.high, {}, { exit: 5 })
  assert.equal(high.error.code, 'operation-rejected')
  assert.equal(high.error.message, 'high-risk-awaiting-approval')
  assert.equal((await webReview('activate', fixtures.high)).reason, high.error.message)
  const wrongScope = await shell(['api', 'call', reviewId, '--workspace', b.path, ...approve()], {
    input: { action: 'pin', procedureId: fixtures.cli, v: true }, exit: 5,
  })
  assert.equal(wrongScope.error.code, 'workspace-mismatch')
  assert.equal((await review('activate', fixtures.cli, { v: false }, { exit: 2 })).error.code, 'invalid-input')
  assert.equal((await review('pin', fixtures.cli, { v: 'false' }, { exit: 2 })).error.code, 'invalid-input')
  assert.equal((await review('pin', fixtures.cli, { v: true, sessionId: b.sessionId }, { exit: 2 })).error.code, 'invalid-input')
  assert.equal(sha256(await readFile(fixtures.file)), before)
  assert.equal((await hubPair(fixtures.cli)).stage, 'validated')
  assert.equal((await review('pin', fixtures.cli)).result.pinned, true)
  assert.equal((await hubPair(fixtures.cli)).pinned, true)
  assert.equal((await review('pin', fixtures.cli, { v: false })).result.pinned, false)
  assert.equal((await hubPair(fixtures.cli)).pinned, false)
  assert.equal((await review('pin', fixtures.cli, { v: true })).result.pinned, true)
  assert.equal((await hubPair(fixtures.cli)).pinned, true)
  assert.equal((await webReview('pin', fixtures.cli, { v: false })).pinned, false)
  assert.equal((await hubPair(fixtures.cli)).pinned, false)
  assert.equal((await webReview('pin', fixtures.web, { v: true })).pinned, true)
  assert.equal((await hubPair(fixtures.web)).pinned, true)
  assert.equal((await review('pin', fixtures.web, { v: false })).result.pinned, false)
  assert.equal((await hubPair(fixtures.web)).pinned, false)

  const activate = await review('activate', fixtures.cli)
  const webActivate = await webReview('activate', fixtures.web)
  const exports = []
  for (const [out, id] of [[activate.result, fixtures.cli], [webActivate, fixtures.web]]) {
    assert.equal(out.ok, true)
    assert.equal(out.procedure.stage, 'active')
    assert.equal(out.skillExport.ok, true, JSON.stringify(out.skillExport))
    const active = await hubPair(id)
    assert.equal(active.stage, 'active')
    assert.equal(active.pinned, false)
    const file = inside(join(home, 'skills'), join(home, 'skills', out.skillExport.dirName, 'SKILL.md'))
    const content = await readFile(file, 'utf8')
    assert.ok(content.toLowerCase().replaceAll('\\', '/').includes(a.path.toLowerCase().replaceAll('\\', '/')))
    exports.push({ file, sha256: sha256(content) })
  }
  const storedReceipt = await shell(['api', 'receipt', activate.receipt.requestId])
  assert.equal(storedReceipt.state, 'finished')
  assert.deepEqual(storedReceipt.result, activate.result)
  assert.equal((await review('pin', fixtures.cli, { v: true })).result.pinned, true)
  assert.equal((await hubPair(fixtures.cli)).pinned, true)
  const persistedActive = JSON.parse(await readFile(fixtures.file, 'utf8')).procedures.find(item => item.procedureId === fixtures.cli)
  assert.equal(persistedActive.pinned, true)
  assert.equal((await webReview('pin', fixtures.cli, { v: false })).pinned, false)
  assert.equal((await hubPair(fixtures.cli)).pinned, false)
  const deprecated = [ (await review('deprecate', fixtures.cli)).result, await webReview('deprecate', fixtures.web) ]
  for (const [index, id] of [fixtures.cli, fixtures.web].entries()) {
    assert.equal(deprecated[index].procedure.stage, 'deprecated')
    assert.ok(deprecated[index].skillRetired.length, JSON.stringify(deprecated[index]))
    assert.equal(await hubPair(id), undefined)
    await assert.rejects(readFile(exports[index].file), { code: 'ENOENT' })
  }
  const snapshot = JSON.parse(await readFile(fixtures.file, 'utf8'))
  assert.deepEqual(snapshot.procedures.filter(item => [fixtures.cli, fixtures.web].includes(item.procedureId))
    .map(({ stage, pinned }) => [stage, pinned]), [['deprecated', false], ['deprecated', false]])
  report('memory hub Web and CLI', {
    operation: reviewId, actions: hubActions,
    approvalGate: true, highRiskGate: true, pinned: [true, false], pinDefault: true,
    activePinReadback: [false, true, false], activePinPersisted: true, crossProjectScopeRejected: true,
    projectSkillExports: exports.map(item => item.sha256), retired: true,
    snapshotDigest: sha256(await readFile(fixtures.file)),
  })

  for (const project of [a, b]) {
    for (const scope of ['current', 'subset', 'all']) {
      const input = { scope, effort: 'low' }
      const fromCLI = await call('jobs.upgrade.workspaces', input, project)
      const fromWeb = await web('upgrade-workspaces', { query: { ...input, ...browserScope(project) } })
      assert.deepEqual(fromCLI, fromWeb)
      assert.equal(fromCLI.matchedWsKey, project.wsKey)
      assert.deepEqual(fromCLI.workspaces.map(row => row.wsKey).sort(), [a.wsKey, b.wsKey].sort())
      assert.ok(fromCLI.totals.ok)
    }
  }
  const emptyCurrent = await shell(['api', 'call', 'jobs.upgrade.workspaces'], { project: empty, input: { scope: 'current' }, exit: 2 })
  assert.equal(emptyCurrent.error.message, 'workspace-not-in-manifest')
  assert.equal((await web('upgrade-workspaces', {
    query: { scope: 'current', ...browserScope(empty) }, status: 400,
  })).error, 'workspace-not-in-manifest')
  report('upgrade inventory Web and CLI', { scopes: ['current', 'subset', 'all'], projectCount: 2, unmatchedCurrentRejected: true })

  const stable = ({ sinceMs, snoozeRemainingMs, ...data }) => data
  async function statusPair(project = a) {
    const fromCLI = await call('jobs.upgrade.status', {}, project)
    const fromWeb = await web('upgrade-status', { query: browserScope(project) })
    assert.deepEqual(stable(fromCLI), stable(fromWeb))
    return fromCLI
  }
  const initial = await statusPair()
  assert.equal(initial.phase, 'idle')
  assert.equal(Object.hasOwn(initial, 'error'), false)
  const snooze = (await write('jobs.upgrade.snooze', {})).result
  assert.equal((await statusPair(b)).declinedAt, snooze.at)
  const webSnooze = await web('upgrade-snooze', { body: browserScope(b) })
  assert.equal((await statusPair()).declinedAt, webSnooze.at)
  assert.ok((await statusPair()).snoozeRemainingMs > 0)
  assert.equal((await write('jobs.upgrade.start', { scope: 'subset', workspaceKeys: [] }, { exit: 2 })).error.code, 'invalid-input')
  assert.equal((await write('jobs.upgrade.start', { scope: 'current', ws: b.path }, { exit: 2 })).error.code, 'invalid-input')
  assert.equal((await write('jobs.upgrade.start', { scope: 'current' }, { approval: [], exit: 3 })).error.code, 'confirmation-required')
  assert.equal((await statusPair()).phase, 'idle')
  const workbench = await web('workbench', { body: { action: 'setup' } })
  assert.equal(workbench.ready, true, JSON.stringify({ reason: workbench.reason, verifyReason: workbench.verifyReason, setup: workbench.setup }))

  const modelName = 'deepseek-v4-flash'
  const upgradeStateFile = join(home, 'user', 'upgrade-state.json')
  const readDisk = async () => JSON.parse(await readFile(upgradeStateFile, 'utf8'))
  const eventCounts = new Map([[a, 0], [b, 0]])
  for (const scenario of [
    { source: 'CLI', scope: 'current', expected: [a], writeEvents: false },
    { source: 'CLI', scope: 'current', expected: [a], writeEvents: true },
    { source: 'Web API', scope: 'subset', workspaceKeys: [b.wsKey], expected: [b], writeEvents: true },
    { source: 'CLI', scope: 'subset', workspaceKeys: [b.wsKey], expected: [b], writeEvents: true },
    { source: 'CLI', scope: 'all', expected: [a, b], writeEvents: true },
  ]) {
    const { source, expected, writeEvents, ...input } = scenario
    const modelRun = model.arm(expected, writeEvents)
    const args = { ...input, model: modelName, effort: 'low' }
    const start = source === 'Web API'
      ? await web('memory-upgrade', { body: { ...browserScope(a), ...args } })
      : (await write('jobs.upgrade.start', args)).result
    assert.ok(start.ok && start.jobId)
    const runningTimeout = new AbortController()
    let previousEvidenceVisible
    try {
      const arrived = await Promise.race([modelRun.arrived.promise, delay(15000, false, { signal: runningTimeout.signal })])
      assert.ok(arrived, 'Loopback request not held: ' + JSON.stringify(modelRun.errors))
      const running = await statusPair()
      assert.equal(running.phase, 'running')
      assert.equal(Object.hasOwn(running, 'error'), false)
      assert.equal(running.jobId, start.jobId)
      assert.deepEqual(running.perWorkspace.map(row => row.wsKey).sort(), expected.map(item => item.wsKey).sort())
      assert.ok(running.perWorkspace.every(row => row.phase === 'pending'))
      previousEvidenceVisible = Number(running.evidenceVerdict?.at) > 0 && running.evidenceVerdict.at < running.startedAt
      const repeated = (await write('jobs.upgrade.start', args)).result
      assert.equal(repeated.jobId, start.jobId)
      assert.equal(repeated.reused, true)
    } finally {
      runningTimeout.abort()
      modelRun.paused.resolve()
    }
    let status = await call('jobs.upgrade.status', {})
    const deadline = Date.now() + 30_000
    while (status.phase === 'running' && Date.now() < deadline) {
      await delay(250)
      status = await call('jobs.upgrade.status', {})
    }
    assert.deepEqual(stable(status), stable(await statusPair()))
    assert.equal(status.jobId, start.jobId)
    assert.equal(status.scope, scenario.scope)
    assert.equal(status.agentOptions.model, modelName)
    assert.equal(status.agentOptions.effort, 'low')
    assert.deepEqual(modelRun.errors, [])
    assert.deepEqual(status.perWorkspace.map(row => row.wsKey).sort(), expected.map(item => item.wsKey).sort())
    const expectedPhase = writeEvents ? 'done' : 'failed'
    assert.equal(status.phase, expectedPhase, JSON.stringify(status))
    assert.equal(status.evidenceVerdict.overall, expectedPhase)
    assert.equal(status.evidenceVerdict.verifiable, true)
    assert.equal(modelRun.tools, writeEvents ? expected.length : 0)
    for (const row of status.perWorkspace) assert.equal(row.evidence.dEvent, writeEvents ? 1 : 0)
    if (writeEvents) {
      for (const project of expected) eventCounts.set(project, eventCounts.get(project) + 1)
    }
    for (const [project, count] of eventCounts) {
      const eventList = await call('board.events.list', {}, project)
      const webEvents = await web('event-list', { query: { sessionId: project.sessionId } })
      assert.equal(eventList.total, count)
      assert.equal(webEvents.total, count)
      assert.deepEqual(eventList.events.map(row => row.id).sort(), webEvents.events.map(row => row.id).sort())
    }
    const disk = await readDisk()
    assert.equal(disk.jobId, start.jobId)
    assert.equal(disk.phase, expectedPhase)
    if (writeEvents) {
      assert.equal(Object.hasOwn(status, 'error'), false)
    } else {
      assert.match(disk.error, /^evidence-insufficient:/u)
      assert.equal(status.error, 'evidence-insufficient')
    }
    report('upgrade run Web and CLI', {
      operation: source, scope: scenario.scope, firstPhase: 'running',
      terminalPhase: status.phase, runId: status.runId, selected: status.perWorkspace,
      model: status.agentOptions.model, effort: status.agentOptions.effort,
      evidence: status.evidenceVerdict.overall, publicError: status.error,
      previousEvidenceVisible, realToolCalls: modelRun.tools, reusedWhileRunning: true, eventIdsMatch: true,
    })
  }

  // Failed state may contain arbitrary errors from a provider or an older plugin.
  const terminal = await readDisk()
  const privateText = 'synthetic-private-upgrade-detail-' + randomUUID()
  await writeFile(upgradeStateFile, JSON.stringify({
    ...terminal, phase: 'failed', error: 'Provider exception: ' + privateText,
    summary: 'Model output: ' + privateText, file: join(root, privateText),
  }))
  const projected = await statusPair()
  assert.equal(projected.error, 'upgrade-failed')
  assert.equal(JSON.stringify(projected).includes(privateText), false)
  assert.equal((await readDisk()).error.includes(privateText), true)
  report('upgrade failure projection Web and CLI', { knownReason: 'evidence-insufficient', fallback: projected.error, privateDetailOmitted: true })
}

let host, model
try {
  model = await startLoopback()
  const home = await prepare(root, plugin, model.origin)
  const configFile = join(home, 'dsh-auto-memory.json')
  const config = JSON.parse(await readFile(configFile, 'utf8'))
  await writeFile(configFile, JSON.stringify({
    ...config, associativeMemoryEnabled: true, autoContinueEnabled: false,
    maintainScheduleEnabled: false, consolidateScheduleEnabled: false,
  }))
  const fixtures = await seedHub(home)
  host = startDesktop(root, home, model.origin)
  const { url: launch } = await host.ready()
  await check(home, launch, await authenticate(launch), fixtures, model)
} finally {
  try {
    await host?.stop()
  } finally {
    await model?.close()
    assert.equal(dirname(root), parent)
    assert.match(basename(root), /^dam-terminal-hub-upgrade-/u)
    await rm(root, { recursive: true, force: true, maxRetries: 5 })
  }
}
report('result', { passed: true })
