import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { apply, flushDiagnostics, MemoryEngine, createLedgerDocSystemPre } from '../lib/audit-engine.mjs'
import { LedgerDocumentStore } from '../../lib/ledger-doc/index.js'
import { eventStorePre } from '../../lib/event-store.js'

const file = path.resolve('tests/smoke/smoke-test-r4-acceptance-fix.mjs')
const root = path.resolve('artifacts', '_r4-acceptance-fix-fixtures')
const id = 'synthetic-fix-261111-0001'
let eventId = ''
let checks = 0
const check = (condition, message) => { assert.ok(condition, message); checks++ }
const count = (text, token) => text.split(token).length - 1

async function seed() {
  await fs.rm(root, { recursive: true, force: true })
  const handoffDir = path.join(root, 'handoff')
  await fs.mkdir(path.join(handoffDir, 'documents'), { recursive: true })
  const eventsPath = path.join(handoffDir, 'event-store.json')
  const event = await eventStorePre.create(eventsPath, { name: 'synthetic acceptance fixture' })
  eventId = event.id
  await fs.writeFile(path.join(handoffDir, 'handoff-20261111-120000.md'), '# Synthetic legacy\nLEGACY_CONTROL\n')
  await fs.writeFile(path.join(handoffDir, 'PLAN.md'), '# Synthetic plan\n')
  const store = new LedgerDocumentStore(path.join(handoffDir, 'documents'), { eventsPath })
  const created = await store.createDocument({ documentId: id, title: 'Synthetic acceptance document', eventIds: [eventId], content: '## 任务状态\nFIX_DEDUP_UNIQUE\n## 目标\nFIX_SECOND_SECTION\n## 进度与下一步\nsynthetic next' })
  check(created.ok === true, 'fixture create ' + JSON.stringify(created))
  const linked = await eventStorePre.append(eventsPath, eventId, { checkpoint: { kind: 'log', text: 'synthetic fixture link', documentId: id } })
  check(linked.ok === true, 'fixture event link')
  return { handoffDir, eventsPath, store, created }
}

async function callRoute(routes, routePath, method, body) {
  const route = routes.find((item) => item.path === new URL(routePath, 'http://localhost').pathname)
  check(Boolean(route), 'registered route ' + routePath)
  const req = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:3080' }, method, url: routePath }
  if (body !== undefined) req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  let status = 200
  let text = ''
  const res = { writeHead(value) { status = value }, end(value) { text = value } }
  await route.handler(req, res)
  return { status, body: JSON.parse(text) }
}

async function probe() {
  const fixture = await seed()
  process.env.DSH_HOME = path.join(root, 'isolated-home')
  let engine = null
  const previousLoad = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function () {
    engine = this
    this.config = { ...this.config, ledgerDocEnabled: true, handoffEnabled: true }
    this.configLoaded = true
    return this.config
  }
  const routes = []
  const ctx = {
    get() { return undefined }, on() { return () => {} }, effect() {},
    systemPrompt: { context() { return () => {} }, section() { return () => {} } },
    tools: { register() { return () => {} } },
    webServer: { register(route) { routes.push(route); return () => {} } },
  }
  try { apply(ctx) } finally { MemoryEngine.prototype.loadConfigSync = previousLoad }
  check(engine instanceof MemoryEngine, 'real MemoryEngine constructed')
  engine.config = { ...engine.config, ledgerDocEnabled: true, handoffEnabled: true }
  engine.loadConfig = async () => {}
  engine.loadConfigSync = () => {}
  engine.configLoaded = true
  const paths = {
    ws: root, wsBound: true, projectDir: root, handoffDir: fixture.handoffDir,
    planPath: path.join(fixture.handoffDir, 'PLAN.md'), notesPath: path.join(root, 'MEMORY.md'),
    userFile: path.join(root, 'USER.md'), logPath: path.join(root, 'logs'),
    reflectDir: path.join(root, 'reflections'), userDir: path.join(root, 'user'),
    greetPath: path.join(root, 'greeting.md'), greetPathLegacy: path.join(root, 'greeting-old.md'),
    calendarPath: path.join(root, 'calendar.md'),
  }
  engine.resolvePaths = async () => paths
  engine.resolvePathsForSession = async (sid) => sid === 'fixture-session' ? paths : { ...paths, ws: null, wsBound: false }
  engine.listDailyLogs = async () => []
  engine.listReflections = async () => []
  engine.listArchiveFiles = async () => []
  engine.migrateLegacy = async () => {}
  engine.rehydrateProcedureScopes = () => ({})
  engine.buildTierLayerInjection = () => {}
  engine.refreshEventStatePre = async () => {}
  engine.discoverWorkspaces = async () => []
  engine.recentLogTails = async () => []
  const agent = { session: { id: 'fixture-session', header: { cwd: root } } }

  const l0 = await engine.recall('FIX_DEDUP_UNIQUE', 12, agent, 'all', { format: 'l0' })
  check(count(l0, 'FIX_DEDUP_UNIQUE') === 1, 'scope=all L0 same section occurs once')
  check(l0.includes('ledger-doc:'), 'L0 keeps stable chunk identity')
  const full = await engine.recall('FIX_DEDUP_UNIQUE', 12, agent, 'all', { format: 'full' })
  check(count(full, 'FIX_DEDUP_UNIQUE') === 1, 'scope=all full same section occurs once :: ' + full)
  const sections = await engine.recall('FIX_DEDUP_UNIQUE FIX_SECOND_SECTION', 12, agent, 'all', { format: 'l0' })
  check(count(sections, 'FIX_DEDUP_UNIQUE') === 1 && count(sections, 'FIX_SECOND_SECTION') === 1, 'distinct sections are not deduplicated away')
  const legacy = await engine.recall('LEGACY_CONTROL', 12, agent, 'all', { format: 'full' })
  check(count(legacy, 'LEGACY_CONTROL') === 1, 'legacy control remains single')
  const selected = await engine.readLedgerDocForPre(fixture.handoffDir)
  check(selected.ok && selected.chunks.length > 1, 'current document and sections available')
  const expanded = await engine.recall(selected.chunks[0].chunkId, 12, agent, 'all')
  check(expanded.includes(selected.chunks[0].text) && expanded.includes(selected.document.revision), 'chunk expansion keeps current text and revision')

  const api = '/api/dsh-auto-memory/'
  const http = await callRoute(routes, api + 'recall', 'POST', { sessionId: 'fixture-session', query: 'FIX_DEDUP_UNIQUE', scope: 'handoff', format: 'l0' })
  check(http.status === 200 && count(http.body.result, 'FIX_DEDUP_UNIQUE') === 1, 'HTTP handoff succeeds once')
  check(http.body.result.includes(selected.document.revision), 'HTTP handoff exposes current revision')
  check((await callRoute(routes, api + 'recall', 'POST', { query: 'x', scope: 'handoff' })).status === 400, 'missing session rejected')
  check((await callRoute(routes, api + 'recall', 'POST', { sessionId: 'unknown-session', query: 'x', scope: 'handoff' })).status === 400, 'unknown workspace rejected')
  check((await callRoute(routes, api + 'recall', 'POST', { sessionId: 'fixture-session', query: 'x', scope: 'events' })).status === 400, 'events not added to HTTP whitelist')
  check((await callRoute(routes, api + 'recall', 'POST', { sessionId: 'fixture-session', query: 'x', scope: 'sessions' })).status === 400, 'sessions not added to HTTP whitelist')

  let state = await callRoute(routes, api + 'handoff-state?ws=' + encodeURIComponent(root), 'GET')
  check(state.status === 200, 'state route success')
  check(state.body.latestHandoffTextTier === 'maintenance-document', 'observation names maintenance-document tier :: ' + JSON.stringify(state.body))
  check(state.body.ledgerDocId === id && state.body.ledgerDocRevision === selected.document.revision, 'observation has selected identity')
  check(state.body.latestHandoffTextChars === selected.document.text.length, 'observation has current bounded length')
  check(!Object.hasOwn(state.body, 'latestHandoffText') && !JSON.stringify(state.body).includes('FIX_DEDUP_UNIQUE'), 'observation has no document body')

  const writeSystem = createLedgerDocSystemPre({ rootDir: root, storePath: fixture.eventsPath, enabled: true })
  check((await writeSystem.start()).ok === true, 'real write system starts')
  const committed = await writeSystem.upsertDocument({ opId: 'r4op_' + 'ab'.repeat(16), documentId: id, expectedRevision: selected.document.revision, eventIds: [eventId], changeSet: [{ regionId: 'content', beforeText: selected.document.content, afterText: '## 任务状态\nFIX_COMMITTED_REVISION\n## 目标\nFIX_SECOND_SECTION\n## 进度与下一步\nsynthetic next' }] })
  check(committed.ok === true && committed.documentCommitted === true, 'real committed write :: ' + JSON.stringify(committed))
  engine._ledgerDocReadSystems.set(fixture.handoffDir, writeSystem)
  const committedReadback = await writeSystem.readDocuments({ documentId: id })
  const engineReadback = await engine.readLedgerDocForPre(fixture.handoffDir)
  state = await callRoute(routes, api + 'handoff-state?ws=' + encodeURIComponent(root), 'GET')
  console.log('COMMITTED_COMPARE', JSON.stringify({ cached: writeSystem.lastCommittedDocument?.revision, disk: committedReadback.document?.revision, engine: engineReadback.document?.revision, state: state.body.ledgerDocRevision, stateChars: state.body.latestHandoffTextChars, cachedChars: writeSystem.lastCommittedDocument?.text.length }))
  check(state.body.ledgerDocRevision === committed.document.revision && state.body.ledgerDocId === id, 'same-process committed revision is observed :: ' + JSON.stringify({ state: { tier: state.body.latestHandoffTextTier, id: state.body.ledgerDocId, revision: state.body.ledgerDocRevision, chars: state.body.latestHandoffTextChars }, committed: committed.document?.revision, cached: writeSystem.lastCommittedDocument?.revision }))
  const external = new LedgerDocumentStore(path.join(fixture.handoffDir, 'documents'), { eventsPath: fixture.eventsPath })
  const changed = await external.updateDocument({ documentId: id, expectedRevision: committed.document.revision, eventIds: [eventId], changeSet: [{ regionId: 'content', beforeText: committed.document.content, afterText: '## 任务状态\nFIX_CROSS_PROCESS_REVISION\n## 目标\nFIX_SECOND_SECTION\n## 进度与下一步\nsynthetic next' }] })
  check(changed.ok === true && changed.revision !== committed.document.revision, 'cross-process update committed to disk')
  state = await callRoute(routes, api + 'handoff-state?ws=' + encodeURIComponent(root), 'GET')
  check(state.body.ledgerDocRevision === changed.revision, 'refresh observes cross-process revision')
  engine.config.ledgerDocEnabled = false
  state = await callRoute(routes, api + 'handoff-state?ws=' + encodeURIComponent(root), 'GET')
  check(state.body.ledgerDocId === null && state.body.ledgerDocRevision === null, 'default-off observation clears identity')
  check(state.body.latestHandoffTextTier === 'legacy', 'default-off keeps legacy tier')
  const disabled = await engine.recall('LEGACY_CONTROL', 12, agent, 'all', { format: 'l0' })
  check(count(disabled, 'LEGACY_CONTROL') === 1, 'default-off legacy behavior remains')
  engine.config.ledgerDocEnabled = true

  const externalRoot = path.resolve('_r4-acceptance-fix-readonly')
  await fs.rm(externalRoot, { recursive: true, force: true })
  await fs.mkdir(path.join(externalRoot, 'handoff', 'documents'), { recursive: true })
  const documentName = (await fs.readdir(path.join(fixture.handoffDir, 'documents')))[0]
  await fs.copyFile(path.join(fixture.handoffDir, 'documents', documentName), path.join(externalRoot, 'handoff', 'documents', documentName))
  await fs.copyFile(fixture.eventsPath, path.join(externalRoot, 'handoff', 'event-store.json'))
  const readOnly = createLedgerDocSystemPre({ rootDir: externalRoot, enabled: true, readOnly: true })
  check(readOnly.wal === null, 'readOnly constructs no WAL or sink')
  check((await readOnly.start()).ok === true, 'readOnly starts outside artifacts')
  check((await readOnly.readDocuments({ documentId: id })).document.revision === changed.revision, 'readOnly current works outside artifacts')
  const chunk = (await readOnly.readDocuments({ documentId: id })).chunks[0]
  check((await readOnly.readSide.readChunk(chunk.chunkId)).ok === true, 'readOnly readChunk works')
  check((await readOnly.readSide.forEvent(eventId)).documents.length === 1, 'readOnly forEvent works')
  check((await readOnly.documents.readDocument(id)).revision === changed.revision, 'readOnly document store reads its own physical root')
  check((await readOnly.stamp.readStamp()).startsWith('sha256:'), 'readOnly stamp reads its own handoff root')
  check((await fs.readdir(externalRoot)).join(',') === 'handoff', 'readOnly creates no document/log/archive/legacy/report directories')
  const missingRoot = path.resolve('_r4-acceptance-fix-readonly-missing')
  await fs.rm(missingRoot, { recursive: true, force: true })
  const missing = createLedgerDocSystemPre({ rootDir: missingRoot, enabled: true, readOnly: true })
  const missingStarted = await missing.start()
  check(missingStarted.ok === true, 'readOnly does not require sink parent :: ' + JSON.stringify(missingStarted))
  await assert.rejects(fs.lstat(missingRoot), { code: 'ENOENT' }); checks++
  assert.throws(() => createLedgerDocSystemPre({ rootDir: externalRoot, enabled: true, storePath: path.join(externalRoot, 'handoff', 'event-store.json') }), /event-store-sink-path-invalid/); checks++
  const realWrite = createLedgerDocSystemPre({ rootDir: root, storePath: path.join(root, 'new-handoff', 'event-store.json'), enabled: true })
  check(realWrite.wal !== null, 'explicit real write still constructs sink')
  check((await fs.stat(path.join(root, 'new-handoff'))).isDirectory(), 'sink constructor creates isolated parent')
  await flushDiagnostics()
  console.log('PROBE PASS ' + checks)
}

if (process.env.R4_ACCEPTANCE_FIX_PROBE === '1') {
  try { await probe(); process.exit(0) } catch (error) { console.error(error.stack); process.exit(1) }
}

const mutationRoot = path.resolve('artifacts', '_r4-acceptance-fix-mutations')
await fs.rm(mutationRoot, { recursive: true, force: true })
await fs.mkdir(mutationRoot, { recursive: true })
const source = (await fs.readFile('lib/index.js', 'utf8')).replace(/\r\n/g, '\n')
const variants = [
  { name: 'dedupe-removed', anchor: 'if (seenR4Chunks.has(key)) return false', replacement: 'if (false) return false' },
  { name: 'http-handoff-removed', anchor: "['current', 'all', 'archive', 'handoff']", replacement: "['current', 'all', 'archive']" },
  { name: 'observation-field-removed', anchor: 'structured,\n      latestHandoffTextTier:', replacement: 'structured,\n      latestHandoffTextTierRemoved:' },
  { name: 'readonly-constructs-sink', anchor: 'enabled && options.readOnly !== true ? new EventStoreLedgerSink', replacement: 'enabled ? new EventStoreLedgerSink' },
]
let pass = 0
let fail = 0
const results = []
function run(name, sourcePath) {
  const child = spawnSync(process.execPath, [file], { env: { ...process.env, R4_ACCEPTANCE_FIX_PROBE: '1', DAM_AUDIT_ENGINE_SOURCE: sourcePath || path.resolve('lib/index.js'), DSH_HOME: path.join(root, 'child-home') }, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  return { name, status: child.status, stdout: child.stdout, stderr: child.stderr }
}
const clean = run('clean')
if (clean.status === 0 && /PROBE PASS \d+/.test(clean.stdout)) { pass++; console.log('ok - clean probe :: ' + clean.stdout.trim().split('\n').at(-1)) } else { fail++; console.error('FAIL - clean probe', clean) }
results.push({ ...clean, expected: 'GREEN', caught: clean.status === 0 })
for (const variant of variants) {
  checkAnchor: {
    if (source.split(variant.anchor).length - 1 !== 1) throw new Error('mutation anchor not unique: ' + variant.name)
  }
  const directory = path.join(mutationRoot, variant.name, 'lib')
  await fs.mkdir(directory, { recursive: true })
  const target = path.join(directory, 'index.js')
  await fs.writeFile(target, source.replace(variant.anchor, variant.replacement))
  const result = run(variant.name, target)
  const caught = result.status !== 0
  if (caught) { pass++; console.log('ok - MUT-' + variant.name + ' CAUGHT') } else { fail++; console.error('FAIL - MUT-' + variant.name + ' MISSED', result.stdout, result.stderr) }
  results.push({ ...result, expected: 'RED', caught })
}
await fs.writeFile(path.join(mutationRoot, 'results.json'), JSON.stringify(results, null, 2))
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + results.filter((r) => r.expected === 'RED' && r.caught).length + ' / MISSED ' + results.filter((r) => r.expected === 'RED' && !r.caught).length)
process.exitCode = fail === 0 ? 0 : 1
