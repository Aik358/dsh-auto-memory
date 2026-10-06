import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL, fileURLToPath } from 'node:url'

const repo = process.env.DSH_RUNTIME_REPO || fileURLToPath(new URL('../../', import.meta.url))
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-late-lifecycle-'))
const beforeEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(key => [key, process.env[key]]))
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
const moduleOf = name => import(pathToFileURL(path.join(repo, 'lib', name)).href)
let failures = 0
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)) }
const test = async (name, run) => {
  try { await run(); console.log('PASS ' + name) }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message) }
}
try {
  const { createContextHost } = await moduleOf('context-host.js')
  const { canonicalize } = await moduleOf('m4-corpus.js')
  const { buildSidecar } = await moduleOf('memory-anchor.js')
  const engineUrl = pathToFileURL(path.join(repo, 'lib/index.js'))
  const source = (await fs.readFile(engineUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g,
    (_, relative) => 'from ' + JSON.stringify(new URL(relative, engineUrl).href))
  const engineCopy = path.join(root, 'engine.mjs')
  await fs.writeFile(engineCopy, source + '\nexport { MemoryEngine }; export const flushDiagnostics = () => _diagChain;\n')
  const { MemoryEngine, flushDiagnostics } = await import(pathToFileURL(engineCopy).href)
  const contextFixture = async (name, python = false) => {
    const home = path.join(root, name); await fs.mkdir(home)
    const notes = path.join(home, 'MEMORY.md')
    const content = '<!-- memory:mem_' + '1'.repeat(32) + ' -->\n## alpha\nalpha fixture text\n'
    await fs.writeFile(notes, content)
    const side = buildSidecar({ sourceFile: notes, content }); assert(side.ok)
    const sideDir = path.join(home, 'memory/index/files'); await fs.mkdir(sideDir, { recursive: true })
    await fs.writeFile(path.join(sideDir, createHash('sha256').update(canonicalize(notes)).digest('hex') + '.json'), JSON.stringify(side.sidecar))
    const segment = { id: 'seg-fixture', digest: 'd'.repeat(64), kind: 'user', text: 'alpha', eventSeq: 1, contextVersion: 1, ts: Date.now() }
    const runtime = { key: 'session:' + name, sessionId: name, agentId: 'agent-' + name, contextVersion: 1, disposed: false,
      segments: { snapshot: () => [segment] }, agent: { session: { header: {} } } }
    const engine = { __dshHomeOverride: home,
      config: { associativeMemoryEnabled: true, contextBridgeEnabled: true, pythonBackendEnabled: python, contextSinkMode: python ? 'python' : 'null', activationInboxEnabled: true },
      runtimes: { values: () => [runtime] },
      _pythonSidecar: { request: async () => ({ ok: false }), onActivation: () => () => {}, notify() {}, debugView: () => ({}) } }
    const host = createContextHost({ engine }); host.capturePaths(runtime.key, { ws: home, notesPath: notes })
    return { home, engine, host, runtime, segment }
  }
  await test('RL03 late index cannot restore disposed session or degrade record', async () => {
    const fixture = await contextFixture('index', true), ready = gate()
    let started = 0
    fixture.engine._indexSyncHost = { ensureIndexReady() { started++; return ready.promise } }
    fixture.host.onSegmentAccepted(fixture.runtime, fixture.segment, { payload: {} })
    await settle(); assert.equal(started, 1)
    fixture.host.disposeRuntime(fixture.runtime)
    ready.release({ ready: false, reason: 'late-index' }); await settle()
    try {
      assert.equal(fixture.engine._indexDegradeBySession?.has(fixture.runtime.sessionId) || false, false)
      assert.equal(fixture.host.debugView().indexDegrade, null)
    } finally { fixture.host.disposeAll('test-end') }
  })
  for (const phase of ['decide', 'skill']) {
    await test('RL03 late ' + phase + ' cannot write query, shadow log, touch skill or offer', async () => {
      const fixture = await contextFixture(phase), decision = gate(), skill = gate()
      let started = 0, skillStarted = 0, offers = 0, touches = 0
      fixture.engine._jsSemanticRank = async snapshot => {
        if (snapshot.records[0]?.memoryId === 'fixture-skill') { skillStarted++; return skill.promise }
        return { scores: new Map([['mem_' + '1'.repeat(32), 0.99]]) }
      }
      fixture.engine._jsDecide = () => { started++; return decision.promise }
      fixture.engine.jsEmitMode = () => 'active'
      fixture.engine._activationHost = { offerExternalActivation() { offers++; return { ok: true } } }
      if (phase === 'skill') {
        fixture.engine.config.memoryHubEnabled = true
        fixture.engine._memoryHub = { stores: { procedures: {
          activeProcedures: () => [{ procedureId: 'fixture-skill', title: 'alpha skill', steps: ['fixture'] }],
          renderChecklist: () => ({ text: 'fixture checklist' }), touch: () => { touches++ },
        } } }
      }
      fixture.host.onSegmentAccepted(fixture.runtime, fixture.segment, { payload: {} })
      await settle(); assert.equal(started, 1)
      const emit = { ok: true, decision: 'emit', lane: 'fixture', reasonCodes: [], features: { intentProb: 1 }, _denseTop: 1, _margin: 1 }
      if (phase === 'skill') { decision.release(emit); await settle(); assert.equal(skillStarted, 1) }
      fixture.host.disposeRuntime(fixture.runtime); fixture.host.disposeAll('test-end')
      const shadowFile = path.join(fixture.home, 'memory/semantic/js-decide-shadow.jsonl')
      const priorShadow = await fs.readFile(shadowFile, 'utf8').catch(() => '')
      if (phase === 'decide') decision.release(emit)
      else skill.release({ scores: new Map([['fixture-skill', 0.99]]) })
      await settle()
      assert.equal(offers, 0)
      assert.equal(touches, 0)
      assert.equal(fixture.engine._lastTierQueryBySession?.has(fixture.runtime.sessionId) || false, false)
      assert.equal(await fs.readFile(shadowFile, 'utf8').catch(() => ''), priorShadow)
    })
  }
  await test('RL03 fresh host still offers a live decision; session cleanup removes its query', async () => {
    const fixture = await contextFixture('live'), mid = 'mem_' + '1'.repeat(32)
    let offers = 0
    fixture.engine._jsSemanticRank = async () => ({ scores: new Map([[mid, 0.99]]) })
    fixture.engine._jsDecide = async () => ({ ok: true, decision: 'emit', lane: 'fixture', reasonCodes: [], features: { intentProb: 1 } })
    fixture.engine.jsEmitMode = () => 'active'
    fixture.engine._activationHost = { offerExternalActivation() { offers++; return { ok: true } } }
    fixture.host.onSegmentAccepted(fixture.runtime, fixture.segment, { payload: {} })
    await settle()
    try {
      assert.equal(offers, 1)
      assert(fixture.engine._lastTierQueryBySession.has(fixture.runtime.sessionId))
      fixture.host.disposeRuntime(fixture.runtime)
      assert.equal(fixture.engine._lastTierQueryBySession.has(fixture.runtime.sessionId), false)
    } finally { fixture.host.disposeAll('test-end') }
  })
  const maintenanceFixture = async name => {
    const home = path.join(root, name); await fs.mkdir(home)
    const engine = new MemoryEngine(); engine.configLoaded = true
    engine.config = { ...engine.config, memoryRoot: root, userMemoryDir: root, externalSources: {}, teamEnabled: false }
    const agent = { session: { id: name, header: { cwd: home } } }
    const notes = path.join(home, 'MEMORY.md'), log = path.join(home, '2020-01-01.md')
    await fs.writeFile(notes, '## before\n- prior preserved\n'); await fs.writeFile(log, '## fixture\n- synthetic long-lived decision\n')
    engine.resolvePaths = async () => ({ ws: home, projectDir: home, userDir: root, notesPath: notes })
    engine._subagents = {}; engine.ensureBudget = async () => ({ ok: true })
    return { engine, agent, home, notes, log }
  }
  for (const kind of ['consolidate', 'maintain']) {
    await test('RL01 pending ' + kind + ' model cannot start IO after unload; failed receipt and flight released', async () => {
      const fixture = await maintenanceFixture(kind), model = gate()
      let started = false
      fixture.engine.runSubagent = () => { started = true; return model.promise }
      const flight = (kind === 'consolidate' ? fixture.engine.consolidateMemory(fixture.agent, 7) : fixture.engine.maintain(30, fixture.agent))
        .then(value => ({ value }), error => ({ error }))
      while (!started) await settle()
      const before = await fs.readFile(fixture.notes, 'utf8')
      fixture.engine._disposed = true
      model.release('[PROJECT]\n- synthetic long-lived architecture decision persisted')
      const result = await flight
      const receipt = fixture.engine._maintenanceTaskViewPre()[kind]
      assert.equal(await fs.readFile(fixture.notes, 'utf8'), before)
      assert.equal(await fs.stat(path.join(fixture.home, 'archive')).then(() => true, () => false), false)
      assert.equal(await fs.readFile(fixture.log, 'utf8'), '## fixture\n- synthetic long-lived decision\n')
      assert.equal(result.error?.code, 'PLUGIN_DISPOSED')
      assert.equal(receipt.status, 'failed'); assert.equal(receipt.writes, 0); assert.equal(receipt.resultCode, 'task-disposed')
      assert.equal(fixture.engine._maintenanceTaskFlights.size, 0)
    })
  }
  await test('RL01 disposal during committed project write preserves bytes and reports partial; no following user IO', async () => {
    const fixture = await maintenanceFixture('committed')
    fixture.engine.runSubagent = async () => '[PROJECT]\n- synthetic long-lived architecture decision persisted\n[USER]\n- synthetic lasting preference for concise explanations'
    const original = fixture.engine.appendText.bind(fixture.engine)
    let writes = 0
    fixture.engine.appendText = async (...args) => {
      const text = await original(...args); writes++; fixture.engine._disposed = true; return text
    }
    const result = await fixture.engine.consolidateMemory(fixture.agent, 7).then(value => ({ value }), error => ({ error }))
    assert.equal(result.error?.code, 'PLUGIN_DISPOSED')
    assert.equal(writes, 1)
    assert.match(await fs.readFile(fixture.notes, 'utf8'), /synthetic long-lived/)
    assert.equal(await fs.stat(path.join(root, 'PENDING-USER-MEMORY.md')).then(() => true, () => false), false)
    const receipt = fixture.engine._maintenanceTaskViewPre().consolidate
    assert.equal(receipt.status, 'partial'); assert.equal(receipt.writes, 1); assert.equal(receipt.resultCode, 'task-disposed')
    assert.equal(fixture.engine._maintenanceTaskFlights.size, 0)
  })
  await test('RL01 writer queued behind canonical config gate cannot start document IO after unload', async () => {
    const fixture = await maintenanceFixture('queued'), holderReady = gate(), unlock = gate()
    const { withConfigLock } = await moduleOf('config-lock.js')
    const holder = withConfigLock(fixture.engine._configPath, async () => { holderReady.release(); await unlock.promise })
    await holderReady.promise
    const pending = fixture.engine.appendText(fixture.notes, '\nMust not start queued IO\n').then(value => ({ value }), error => ({ error }))
    await settle(); fixture.engine._disposed = true; unlock.release(); await holder
    const result = await pending
    assert.equal(result.error?.code, 'PLUGIN_DISPOSED')
    assert.doesNotMatch(await fs.readFile(fixture.notes, 'utf8'), /queued IO/)
  })
  await test('RL01 delayed refresh cannot migrate or recreate default runtime after unload', async () => {
    const fixture = await maintenanceFixture('refresh'), paths = gate()
    let started = false, migrations = 0
    fixture.engine.resolvePaths = () => { started = true; return paths.promise }
    fixture.engine.migrateLegacy = async () => { migrations++ }
    const pending = fixture.engine.refresh(fixture.agent)
    while (!started) await settle()
    fixture.engine._disposed = true; fixture.engine.runtimes.disposeAll()
    paths.release({ ws: fixture.home, projectDir: fixture.home, userDir: root, notesPath: fixture.notes })
    await pending; await settle()
    assert.equal(migrations, 0)
    assert.equal(fixture.engine.runtimes.values().length, 0)
  })
  await flushDiagnostics()
} finally {
  for (const [key, value] of Object.entries(beforeEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 40 })
}
if (failures) process.exitCode = 1
