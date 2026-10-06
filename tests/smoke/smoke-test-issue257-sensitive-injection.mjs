import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { loadSecurityEngine, securityModule } from '../lib/security-engine.mjs'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-sec257-'))
const prior = process.env.DSH_HOME
const priorHome = process.env.HOME, priorProfile = process.env.USERPROFILE
process.env.DSH_HOME = root
process.env.HOME = root; process.env.USERPROFILE = root
try {
  const { MemoryEngine } = await loadSecurityEngine()
  const { canonicalize, buildSourceCatalog, loadCorpusSnapshot } = await securityModule('m4-corpus.js')
  const { buildSidecar } = await securityModule('memory-anchor.js')
  const secret = 'SYNTHETIC_SEC257_SECRET'
  const ordinary = 'Ordinary project decision remains available'
  // Child record has no sensitive heading of its own: parent source membership matters.
  const text = '# Memory\n## 凭据\n<!-- memory:mem_' + '1'.repeat(32) + ' -->\n- API key = ' + secret
    + '\n## 普通事项\n<!-- memory:mem_' + '2'.repeat(32) + ' -->\n- ' + ordinary + '\n'
  const sourcePath = path.join(root, 'user', 'MEMORY.md')
  await fs.mkdir(path.dirname(sourcePath), { recursive: true })
  await fs.writeFile(sourcePath, text)
  const digest = createHash('sha256').update(text).digest('hex')
  const engine = new MemoryEngine()
  Object.assign(engine.config, { injectBudgetChars: 12000, tier0BudgetShare: 0.8 })
  Object.assign(engine.state, { userText: text, notesText: '', userDir: path.dirname(sourcePath), ws: root })
  Object.assign(engine, { external: { cache: [] }, peekRuntime: () => ({ contextVersion: 1 }),
    tierCurrentMivPre: () => 'test-miv', isUnattendedNow: () => false, renderPlanUpdateRequest: () => '' })
  const agent = { session: { id: 'isolated-session', header: { cwd: root } } }
  const { sensitiveSections } = await securityModule('injection-policy.js')
  // Read supported BOM files through the real engine before injection. Matrix
  // controls include ordinary first headings and both disk newline formats.
  for (const newline of ['\n', '\r\n']) for (const bom of ['', '\uFEFF']) for (const sensitiveFirst of [true, false]) {
    const first = sensitiveFirst ? '凭据' : '普通事项'
    const marker = 'SYNTHETIC_BOM_SEC257'
    const body = bom + ['## ' + first, '<!-- memory:mem_' + '3'.repeat(32) + ' -->', '- ' + marker,
      '## 普通后续', '<!-- memory:mem_' + '4'.repeat(32) + ' -->', '- Ordinary BOM control', ''].join(newline)
    await fs.writeFile(sourcePath, body)
    const disk = await fs.readFile(sourcePath)
    const read = await engine.readTextSafe(sourcePath)
    assert.equal(read, body, 'read/explicit full text must retain original BOM and newline')
    const policy = sensitiveSections(read)
    assert.equal(policy.lines[0], bom + '## ' + first + (newline === '\r\n' ? '\r' : ''))
    Object.assign(engine.state, { userText: read, notesText: '', logText: '', planText: '', latestReflection: '', recentLogs: [] })
    delete engine._tierGateHits
    const directory = engine.buildTierLayerInjection(agent)
    assert.equal(directory.includes(marker), !sensitiveFirst, 'first heading admission disagrees with source')
    assert(directory.includes('Ordinary BOM control'), 'ordinary negative control must survive')
    assert.equal(engine.renderMemoryDynamic().includes(marker), !sensitiveFirst, 'final directory prompt admission drift')
    assert.equal(policy.blocked[0], sensitiveFirst)
    if (sensitiveFirst) assert.equal(policy.ranges[0].end, Buffer.byteLength(policy.lines[0] + '\n'), 'recognition changed original byte coordinate')
    engine._tierGateHits = { sessionId: agent.session.id, workspaceKey: canonicalize(root), at: Date.now(), contextVersion: 1,
      miv: 'test-miv', observationId: 'bom-observation', question: '请给原文证据出处', hits: [
        { memoryId: 'mem_' + '3'.repeat(32), score: 1, status: 'current', layer: 'user', sourceRef: 'user:MEMORY.md', excerpt: marker, lineStart: 3, lineEnd: 3 },
        { memoryId: 'mem_' + '4'.repeat(32), score: 0.9, status: 'current', layer: 'user', sourceRef: 'user:MEMORY.md', excerpt: 'Ordinary BOM control', lineStart: 6, lineEnd: 6 },
      ] }
    const drilldown = engine.buildTierLayerInjection(agent)
    assert(drilldown.includes('[Tier-1') && drilldown.includes('[Tier-2') && drilldown.includes('Ordinary BOM control'), 'BOM matrix must actually drill down')
    assert.equal(drilldown.includes(marker), !sensitiveFirst, 'BOM Tier-1/Tier-2 admission drift')
    assert.equal(engine.renderMemoryDynamic().includes(marker), !sensitiveFirst, 'BOM final drilldown prompt drift')
    const matrixSidecars = path.join(root, 'bom-sidecars'); await fs.mkdir(matrixSidecars, { recursive: true })
    const matrixBuilt = buildSidecar({ sourceFile: sourcePath, content: read })
    assert(matrixBuilt.ok && matrixBuilt.sidecar.records.length === 2)
    await fs.writeFile(path.join(matrixSidecars, createHash('sha256').update(canonicalize(sourcePath)).digest('hex') + '.json'), JSON.stringify(matrixBuilt.sidecar))
    const matrixSnapshot = loadCorpusSnapshot(buildSourceCatalog({ workspaceKey: root, userMemoryPath: sourcePath }), { sidecarDir: matrixSidecars })
    assert(matrixSnapshot.ok)
    assert.equal(matrixSnapshot.snapshot.records.length, sensitiveFirst ? 1 : 2, 'M4 admission differs from injection')
    for (const kept of matrixSnapshot.snapshot.records) {
      const original = matrixBuilt.sidecar.records.find(r => r.memoryId === kept.memoryId)
      for (const key of ['memoryId', 'lineStart', 'lineEnd', 'byteStart', 'byteEnd', 'recordDigest', 'fileDigest']) assert.equal(kept[key], original[key], 'BOM ' + key + ' identity drift')
    }
    assert.deepEqual(await fs.readFile(sourcePath), disk, 'automatic admission changed disk bytes')
  }
  console.log('PASS #257 read -> Tier0/Tier1/Tier2/final/M4: BOM/no-BOM x LF/CRLF x sensitive/ordinary first heading, source byte/line/digest identity')
  delete engine._tierGateHits
  await fs.writeFile(sourcePath, text)
  for (const source of ['userText', 'notesText', 'logText', 'planText', 'latestReflection']) {
    Object.assign(engine.state, { userText: '', notesText: '', logText: '', planText: '', latestReflection: '', [source]: text })
    const injected = engine.buildTierLayerInjection(agent)
    assert(!injected.includes(secret), source + ' directory leaked sensitive content')
    assert(injected.includes('Ordinary project decision'), source + ' lost ordinary source')
    assert(!engine.renderMemoryDynamic().includes(secret), source + ' leaked through legacy final render')
  }
  engine.state.recentLogs = [{ date: '2026-10-07', text }]
  engine.config.tier0CatalogEnabled = false
  engine.buildTierLayerInjection(agent)
  assert(!engine.renderMemoryDynamic().includes(secret), 'disabled directory reintroduced sensitive recent-log/reflection')
  engine.config.tier0CatalogEnabled = true
  engine.state.recentLogs = []
  Object.assign(engine.state, { userText: text, notesText: '', logText: '', planText: '', latestReflection: '' })
  for (const question of ['decision', '请给原文证据出处']) {
    engine._tierGateHits = { sessionId: agent.session.id, workspaceKey: canonicalize(root), at: Date.now(),
      contextVersion: 1, miv: 'test-miv', observationId: 'observation', question, hits: [
        { memoryId: 'mem_' + '1'.repeat(32), score: 1, status: 'current', layer: 'user', sourceRef: 'user:MEMORY.md', excerpt: secret, lineStart: 4, lineEnd: 4 },
        { memoryId: 'mem_' + '2'.repeat(32), score: 0.9, status: 'current', layer: 'user', sourceRef: 'user:MEMORY.md', excerpt: ordinary, lineStart: 7, lineEnd: 7 },
      ] }
    const injected = engine.buildTierLayerInjection(agent)
    assert(!injected.includes(secret), 'located sensitive child leaked into drilldown')
    assert(injected.includes('[Tier-1') && injected.includes(ordinary), 'ordinary hit did not actually drill down')
    if (question.includes('证据')) assert(injected.includes('[Tier-2'), 'Tier-2 path was not exercised')
    assert(!engine.renderMemoryDynamic().includes(secret), 'final prompt leaked')
    delete engine._tierGateHits.hits[0].lineStart
    delete engine._tierGateHits.hits[0].lineEnd
    assert(!engine.buildTierLayerInjection(agent).includes(secret), 'old unlocated projection leaked')
  }
  const before = await fs.readFile(sourcePath)
  assert.equal(await engine.readTextSafe(sourcePath), text, 'explicit full read changed')
  const sidecarDir = path.join(root, 'sidecars'); await fs.mkdir(sidecarDir)
  const built = buildSidecar({ sourceFile: sourcePath, content: text })
  assert(built.ok && built.sidecar.records.length === 2)
  const sidecarFile = path.join(sidecarDir, createHash('sha256').update(canonicalize(sourcePath)).digest('hex') + '.json')
  await fs.writeFile(sidecarFile, JSON.stringify(built.sidecar))
  const snapshot = loadCorpusSnapshot(buildSourceCatalog({ workspaceKey: root, userMemoryPath: sourcePath }), { sidecarDir })
  assert(snapshot.ok)
  assert.equal(snapshot.snapshot.records.length, 1, 'sensitive child entered automatic corpus')
  const record = snapshot.snapshot.records[0], original = built.sidecar.records[1]
  for (const key of ['memoryId', 'lineStart', 'lineEnd', 'byteStart', 'byteEnd', 'recordDigest', 'fileDigest']) assert.equal(record[key], original[key], key + ' identity drift')
  assert(snapshot.dropped.some(d => d.reason === 'sensitive-section'))
  assert.equal(createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex'), digest)
  assert.deepEqual(await fs.readFile(sourcePath), before)
  // Exercise production provenance -> activation projection -> actual drilldown,
  // not only a handcrafted _tierGateHits projection.
  const { memoryDir } = await securityModule('datadir.js')
  const actualSidecars = path.join(memoryDir('index', () => root), 'files')
  await fs.mkdir(actualSidecars, { recursive: true })
  await fs.copyFile(sidecarFile, path.join(actualSidecars, path.basename(sidecarFile)))
  const { createContextHost } = await securityModule('context-host.js')
  const { createActivationHost } = await securityModule('activation-host.js')
  const { makeFakeActivationRequestPre } = await securityModule('activation-inbox.js')
  engine._contextHost = createContextHost({ engine })
  engine._contextHost.capturePaths('runtime', { ws: root, userDir: path.dirname(sourcePath) })
  const prov = engine._contextHost.findProvenance(root, record.memoryId, record.recordDigest)
  assert.equal(prov.lineStart, record.lineStart); assert.equal(prov.lineEnd, record.lineEnd)
  assert.equal(engine._contextHost.findProvenance(root, built.sidecar.records[0].memoryId, built.sidecar.records[0].recordDigest), null)
  Object.assign(engine.config, { associativeMemoryEnabled: true, activationInboxEnabled: true, activationSource: 'fake' })
  const activation = createActivationHost({ engine })
  const request = makeFakeActivationRequestPre({ seed: 'sec257', agentId: 'synthetic-agent', sessionId: agent.session.id, workspaceKey: canonicalize(root),
    contextVersion: 1, memoryIndexVersion: snapshot.snapshot.memoryIndexVersion, records: [{ ...record, excerpt: ordinary }] })
  const offered = activation.injectActivation(request)
  assert(offered.ok, JSON.stringify(offered))
  assert.equal(engine._tierGateHits.hits[0].lineStart, original.lineStart, 'production projection lost locator')
  engine.tierCurrentMivPre = () => snapshot.snapshot.memoryIndexVersion
  engine._tierGateHits.question = '请给原文证据出处'
  const production = engine.buildTierLayerInjection(agent)
  assert(production.includes('[Tier-2') && production.includes(ordinary), 'production located hit did not drill down')
  assert(!production.includes(secret))
  activation.disposeAll('test-end'); engine._contextHost.disposeAll('test-end')
  console.log('PASS #257 actual five-source directories, Tier-1/Tier-2/final render, old projection refusal, corpus parent-section admission, explicit full read, original anchor/line/byte/digest identity')
} finally {
  if (prior === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prior
  if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome
  if (priorProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = priorProfile
  await fs.rm(root, { recursive: true, force: true })
}
