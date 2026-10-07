// Exercise real persistence boundaries; all faults, homes and HTTP are local.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadIsolatedEngine } from '../lib/load-isolated-engine.mjs'

const repo = process.env.AUDIT_TEST_REPO || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const load = name => import(pathToFileURL(path.join(repo, 'lib', name)).href)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-minimal-safety-'))
const env = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(k => [k, process.env[k]]))
Object.assign(process.env, { HOME: root, USERPROFILE: root, DSH_HOME: root })
const selected = process.argv.find(a => a.startsWith('--case='))?.slice(7)
const dir = name => { const d = path.join(root, name); fs.mkdirSync(d, { recursive: true }); return d }
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'))
let flushDiagnostics

async function migration() {
  const { createScopedHubIoPre } = await load('hub-io.js')
  const { createProcedureStorePre } = await load('procedure-store.js')
  for (const direction of ['global', 'workspace']) {
    for (const stage of ['receiving', 'donating', 'verify', 'rollback']) {
      const d = dir('migration-' + direction + '-' + stage)
      const globalDir = dir(path.relative(root, path.join(d, 'global')))
      const workspace = dir(path.relative(root, path.join(d, 'workspace')))
      const files = { global: path.join(globalDir, 'procedures.json'), workspace: path.join(workspace, 'procedures.json') }
      const target = direction === 'global' ? 'workspace' : 'global'
      const store = createProcedureStorePre()
      const rows = ['A', 'B', 'C'].map(title => ({ ...store.observe({ title: 'Audit skill ' + title,
        steps: ['Perform ' + title], successCriteria: ['Verify ' + title], origin: 'user', scope: direction,
        sourceMemoryIds: [], sourceEpisodes: [] }).procedure, workspaceRef: direction === 'workspace' ? 'ws' : '' }))
      fs.writeFileSync(files[direction], JSON.stringify({ schemaVersion: 1, procedures: rows }))
      // Absent receivers also need a valid per-item rollback snapshot.
      let recvWrites = 0, donorWrites = 0, verifyFault = false
      const io = createScopedHubIoPre({ globalDir, resolveWorkspace: () => ({ dir: workspace, key: 'ws' }), fsApi: {
        renameSync(from, to) {
          if (to === files[target]) {
            recvWrites++
            if ((stage === 'receiving' && recvWrites === 2) || (stage === 'rollback' && recvWrites === 3)) {
              throw Object.assign(Error('injected receiving fault'), { code: 'ENOSPC' })
            }
          }
          if (to === files[direction] && ++donorWrites === 2 && ['donating', 'rollback'].includes(stage)) {
            throw Object.assign(Error('injected donor fault'), { code: 'ENOSPC' })
          }
          return fs.renameSync(from, to)
        },
        readFileSync(file, ...args) {
          if (stage === 'verify' && file === files[target] && recvWrites === 2 && !verifyFault) {
            verifyFault = true
            return JSON.stringify({ schemaVersion: 1, procedures: [] })
          }
          return fs.readFileSync(file, ...args)
        }
      } })
      const progress = []
      const result = io.migrate(rows.map(p => ({ procedureId: p.procedureId, scope: target, workspaceRef: 'ws' })),
        done => progress.push(done))
      const source = json(files[direction]).procedures.map(p => p.procedureId)
      const receiver = json(files[target]).procedures.map(p => p.procedureId)
      assert.ok(receiver.includes(rows[0].procedureId), direction + '/' + stage + ': previously committed move was lost')
      for (const row of rows) assert.ok(source.includes(row.procedureId) || receiver.includes(row.procedureId), 'procedure disappeared')
      assert.equal(result.results[0].ok, true)
      assert.equal(result.results[1].ok, false)
      assert.equal(result.rolledBack, stage !== 'rollback')
      assert.deepEqual(progress, [1, 2, 3])
      if (stage === 'rollback') {
        assert.equal(result.results[2].reason, 'rollback-failed-aborted')
        assert.ok(source.includes(rows[2].procedureId), 'continued writing after rollback failed')
      } else {
        assert.equal(result.results[2].ok, true)
        assert.ok(source.includes(rows[1].procedureId))
        assert.ok(!receiver.includes(rows[1].procedureId), 'failed move was not rolled back')
        assert.equal(new Set([...source, ...receiver]).size, source.length + receiver.length)
      }
    }
  }
}

async function maintenance() {
  for (const anchored of [false, true]) await maintenanceMode(anchored)
}

async function maintenanceMode(anchored) {
  const name = 'maintenance-' + anchored
  const home = dir(name)
  const mod = await loadIsolatedEngine(home, repo)
  flushDiagnostics = mod.flushDiagnostics
  const projectDir = dir(name + '/project'), userDir = dir(name + '/user')
  const notesPath = path.join(projectDir, 'MEMORY.md'), source = path.join(projectDir, '2020-01-01.md')
  fs.writeFileSync(notesPath, '## Existing notes\n- Original reusable fact.\n')
  fs.writeFileSync(source, '## Existing log\n- Original archived fact.\n')
  const engine = new mod.MemoryEngine()
  engine.configLoaded = true
  engine.config = { ...engine.config, memoryAnchorEnabled: anchored, handoffEnabled: false, associativeMemoryEnabled: false, userMemoryDir: userDir, memoryRoot: home }
  engine.resolvePaths = async () => ({ ws: projectDir, projectDir, userDir, notesPath })
  const append = engine.appendText.bind(engine)
  let acknowledged = false
  const amendment = 'Concurrent accepted amendment must survive.'
  engine.appendText = async (file, text) => {
    const result = await append(file, text)
    if (file === notesPath) acknowledged = (await append(source, '\n- ' + amendment + '\n')).includes(amendment)
    return result
  }
  await engine.maintain(30)
  assert.ok(acknowledged, 'fixture writer must be acknowledged')
  assert.ok(fs.existsSync(source), 'maintenance deleted a newer acknowledged source version')
  assert.ok(fs.readFileSync(source, 'utf8').includes(amendment))
  assert.ok(!fs.readFileSync(path.join(projectDir, 'archive/2020-01-01.md'), 'utf8').includes(amendment))
  engine.appendText = append
  await engine.maintain(30)
  assert.ok(!fs.existsSync(source), 'unchanged, fully archived log should still be deleted')
  assert.ok(fs.readFileSync(path.join(projectDir, 'archive/2020-01-01.md'), 'utf8').includes(amendment))

  // Two independent engines can overlap; the engine-local single-flight map
  // does not protect the archive from a stale snapshot in the other engine.
  fs.writeFileSync(source, '## Original log\n- Original archived fact.\n')
  const other = new mod.MemoryEngine()
  other.configLoaded = true
  other.config = { ...engine.config }
  other.resolvePaths = engine.resolvePaths
  for (const e of [engine, other]) {
    e._subagents = {}
    e.runSubagent = async () => '### Stable summary\n- Original reusable fact.'
  }
  const archiveFile = path.join(projectDir, 'archive/2020-01-01.md')
  let signalPaused, signalResume, signalArchived
  const paused = new Promise(r => { signalPaused = r })
  const resume = new Promise(r => { signalResume = r })
  const archiveDone = new Promise(r => { signalArchived = r })
  const write = engine.writeFull.bind(engine)
  engine.writeFull = async (file, text) => {
    if (file === archiveFile) { signalPaused(); await resume }
    try { return await write(file, text) }
    finally { if (file === archiveFile) signalArchived() }
  }
  const appendOther = other.appendText.bind(other)
  other.appendText = async (file, text) => {
    const result = await appendOther(file, text)
    if (file === notesPath) { signalResume(); await archiveDone }
    return result
  }
  const agent = { session: { id: 'isolated-overlapping-maintain' } }
  const first = engine.maintain(30, agent)
  await paused
  let acknowledgedSecond = false
  const secondAppend = appendOther(source, '\n- ' + amendment + '\n').then(result => {
    acknowledgedSecond = result.includes(amendment)
  })
  // Old code admits the append and second archive while the stale writer is
  // paused. Shared archive publication defers the writer until release.
  const admittedEarly = await Promise.race([secondAppend.then(() => true), new Promise(r => setTimeout(() => r(false), 80))])
  if (!admittedEarly) signalResume()
  await secondAppend
  await Promise.all([first, other.maintain(30, agent)])
  assert.ok(acknowledgedSecond)
  assert.ok(fs.readFileSync(archiveFile, 'utf8').includes(amendment), 'overlapping maintainer replaced newer archive and deleted its source')
  engine.writeFull = write
  // A changed archive also invalidates deletion even with an unchanged source.
  fs.writeFileSync(source, '## Original log\n- Original archived fact.\n')
  engine.appendText = async (file, text) => {
    const result = await append(file, text)
    if (file === notesPath) await engine.writeFull(archiveFile, '## Updated archive\n- New archive content.\n')
    return result
  }
  await engine.maintain(30, agent)
  assert.ok(fs.existsSync(source), 'maintenance deleted the source after its archive changed')

  // An independent writer of the archive may join the document queue while
  // the maintainer is reading its source. It must succeed without waiting for
  // a config-lock timeout or making the maintainer wait on its own successor.
  engine.appendText = append
  other.appendText = appendOther
  const boundary = engine._withMemoryMutationPre.bind(engine)
  let signalReading, signalReadResume, intercepted = false
  const reading = new Promise(r => { signalReading = r })
  const readResume = new Promise(r => { signalReadResume = r })
  engine._withMemoryMutationPre = (file, job, admission) => boundary(file, async physicalFile => {
    if (file === source && !intercepted) { intercepted = true; signalReading(); await readResume }
    return job(physicalFile)
  }, admission)
  const maintenanceFlight = engine.maintain(30, agent)
  await reading
  const writer = other.writeFull(archiveFile, '## Independent archive edit\n- Archive correction.\n')
  // Allow the queue predecessor to request its lock in the negative control.
  await new Promise(r => setTimeout(r, 40))
  signalReadResume()
  let deadline
  try {
    const outcome = await Promise.race([
      Promise.allSettled([maintenanceFlight, writer]),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(Error('archive queue/config lock-order stall')), 3000) })
    ])
    assert.ok(outcome.every(r => r.status === 'fulfilled'), 'legitimate concurrent archive writer failed')
    assert.ok(fs.existsSync(source), 'edited archive must keep the unarchived source')
  } finally {
    clearTimeout(deadline)
    await Promise.allSettled([maintenanceFlight, writer])
    engine._withMemoryMutationPre = boundary
  }
}

async function outbox() {
  const { createTeamOutbox } = await load('team-outbox.js')
  const { syncBriefPre } = await load('brief-sync.js')
  const d = dir('outbox'), file = path.join(d, 'watermarks.json'), source = path.join(d, 'notes.md')
  const q = createTeamOutbox({ dir: d })
  const entries = stamp => [{ path: source, source: 'workspace', mtimeMs: stamp, size: stamp }]
  const detect = list => syncBriefPre({ file, entries: list, watchTeam: true, enqueue: item => q.enqueue(item) })
  detect(entries(1)); detect(entries(2))
  const first = q.list()[0]
  assert.ok(first)
  await q.flush(async () => { detect(entries(3)) })
  const observer = createTeamOutbox({ dir: d }); observer.load()
  const second = observer.list()[0]
  assert.ok(second, 'same-path newer changed event was removed by older flight acknowledgement')
  assert.notEqual(second.payload.eventId, first.payload.eventId)
  assert.equal(second.payload.change, 'changed')
  assert.deepEqual(json(file).teamPending, [])
  await q.flush(async () => { detect([]) })
  observer.load()
  assert.equal(observer.list()[0]?.payload.change, 'removed', 'different same-path event was swallowed as duplicate')
  await q.flush(async () => {})
  observer.load(); assert.deepEqual(observer.list(), [])
  const original = { kind: 'handoff', key: 'same', payload: { change: 'old' } }
  assert.equal(q.enqueue(original).ok, true)
  const saved = q.list()[0]
  assert.equal(q.enqueue(original).dup, true)
  assert.equal(q.list()[0].revision, saved.revision)
  assert.equal(q.list()[0].at, saved.at)
  assert.deepEqual(q.list()[0].payload, saved.payload)
  const rename = fs.renameSync
  fs.renameSync = () => { throw Object.assign(Error('injected outbox write failure'), { code: 'ENOSPC' }) }
  try { assert.equal(q.enqueue({ ...original, payload: { change: 'new' } }).ok, false) }
  finally { fs.renameSync = rename }
  observer.load()
  assert.equal(observer.list()[0].revision, saved.revision, 'failed replacement must preserve last durable revision')
  assert.deepEqual(observer.list()[0].payload, saved.payload)
  assert.equal(q.enqueue({ ...original, payload: { change: 'new' } }).ok, true)
  observer.load(); assert.equal(observer.list()[0].payload.change, 'new')
  // Existing pre-upgrade pending events gain stable identities before retry.
  const legacyFile = path.join(d, 'legacy.json')
  fs.writeFileSync(legacyFile, JSON.stringify({ watermarks: {}, teamPending: [{ path: source, kind: 'changed', source: 'workspace' }] }))
  syncBriefPre({ file: legacyFile, entries: [], watchTeam: true, enqueue: () => ({ ok: false }) })
  const pending = json(legacyFile).teamPending[0]
  assert.ok(pending.eventId)
  syncBriefPre({ file: legacyFile, entries: [], watchTeam: true, enqueue: () => ({ ok: false }) })
  assert.equal(json(legacyFile).teamPending[0].eventId, pending.eventId)
}

async function locks() {
  const { tryAcquireFileLock } = await load('process-file-lock.js')
  const { withSharedStateLock } = await load('shared-state-lock.js')
  const { withConfigLock, withConfigLockSync } = await load('config-lock.js')
  const file = path.join(dir('locks'), 'state.json')
  const platform = Object.getOwnPropertyDescriptor(process, 'platform'), open = fs.openSync
  const denied = Object.assign(Error('injected Windows delete-pending contention'), { code: 'EPERM', syscall: 'open' })
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    for (const wrapper of [withSharedStateLock, withConfigLock]) {
      let failures = 3, called = 0
      fs.openSync = (...args) => { if (failures-- > 0) throw denied; return open(...args) }
      syncBuiltinESMExports()
      assert.equal(await wrapper(file, () => { called++; return 'saved' }, { timeoutMs: 1000 }), 'saved')
      assert.equal(called, 1)
      fs.openSync = () => { throw denied }; syncBuiltinESMExports()
      called = 0
      await assert.rejects(wrapper(file, () => { called++ }, { timeoutMs: 40 }), e => /timeout/.test(e.message) && e.cause === denied)
      assert.equal(called, 0, 'permanent permission error must never admit a write')
    }
    assert.throws(() => withConfigLockSync(file, () => assert.fail('busy sync lock admitted write')),
      e => e.code === 'CONFIG_LOCK_BUSY' && e.cause === denied)
    denied.code = 'EACCES'
    let contention
    assert.equal(tryAcquireFileLock(file, { onContention: e => { contention = e } }), null)
    assert.equal(contention, denied)
    denied.code = 'EPERM'
    const writeDenied = Object.assign(Error('write permission failure'), { code: 'EPERM', syscall: 'write' })
    fs.openSync = () => { throw writeDenied }; syncBuiltinESMExports()
    assert.throws(() => tryAcquireFileLock(file), e => e === writeDenied)
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    fs.openSync = () => { throw denied }; syncBuiltinESMExports()
    assert.throws(() => tryAcquireFileLock(file), e => e === denied)
  } finally {
    fs.openSync = open; syncBuiltinESMExports()
    Object.defineProperty(process, 'platform', platform)
  }
  assert.ok(!fs.existsSync(file + '.lock') && !fs.existsSync(file + '.lock.acquire'))
}

async function gist() {
  const webhook = fs.readFileSync(path.join(repo, '.github/cloud/qq-webhook/index.js'), 'utf8').replace(/\r\n/g, '\n')
  const from = webhook.indexOf('async function gistAppend('), to = webhook.indexOf('// 状态文件', from)
  assert.ok(from >= 0 && to > from)
  let legacy = JSON.stringify({ m: 'legacy' }) + '\n', reads = 0, resolveReads
  const bothRead = new Promise(resolve => { resolveReads = resolve })
  const records = []
  let status = 201
  const gh = async (_url, opts = {}) => {
    if (opts.method === 'POST') {
      if (status !== 201) return { ok: status < 400, status, body: {} }
      const record = { id: records.length + 1, body: JSON.parse(opts.body).body }
      records.push(record)
      return { ok: true, status: 201, body: record }
    }
    // Also supports the old read/overwrite protocol for the negative control.
    if (opts.method === 'PATCH') { legacy = JSON.parse(opts.body).files['group-feedback.jsonl'].content; return { ok: true, status: 200 } }
    const snapshot = legacy
    if (++reads === 2) resolveReads()
    await bothRead
    return { ok: true, status: 200, body: { files: { 'group-feedback.jsonl': { content: snapshot } } } }
  }
  const append = new Function('gh', 'CFG', 'FEEDBACK_FILE', 'crypto', webhook.slice(from, to) + ';return gistAppend')(
    gh, { gistId: 'fixture' }, 'group-feedback.jsonl', crypto)
  await Promise.all([append(JSON.stringify({ m: 'A' })), append(JSON.stringify({ m: 'B' }))])
  const retained = records.length ? records.map(c => JSON.parse(c.body.split('\n')[1])) : legacy.trim().split('\n').map(JSON.parse)
  assert.ok(retained.some(r => r.m === 'A') && retained.some(r => r.m === 'B'), 'two acknowledged concurrent feedback appends lost a message')
  assert.equal(legacy, JSON.stringify({ m: 'legacy' }) + '\n')
  assert.equal(new Set(retained.map(r => r.feedbackId)).size, 2)
  for (const badStatus of [503, 200]) {
    status = badStatus
    await assert.rejects(append(JSON.stringify({ m: 'unacknowledged' })))
  }
  await assert.rejects(append('[]'))
  const helper = webhook.slice(webhook.indexOf('async function feedbackComments('), to).trim()
  const digest = fs.readFileSync(path.join(repo, '.github/scripts/group-digest.mjs'), 'utf8').replace(/\r\n/g, '\n')
  const helperStart = digest.indexOf('async function feedbackComments(')
  assert.equal(digest.slice(helperStart, digest.indexOf('\n}\n', helperStart) + 3).trim(), helper,
    'standalone webhook and digest must use the same pagination protocol')
  const reader = new Function(helper + ';return feedbackComments')()
  const marker = '<!-- dsh-group-feedback:v1 -->\n'
  const comments = Array.from({ length: 701 }, (_, i) => ({ id: i + 1, body: i % 3 === 0 ? 'human comment' : marker + JSON.stringify({ m: String(i) }) }))
  const pages = []
  const rows = await reader(async url => {
    const page = Number(new URL('https://fixture.invalid' + url).searchParams.get('page'))
    pages.push(page)
    return { ok: true, body: comments.slice((page - 1) * 100, page * 100),
      link: '<https://fixture.invalid/comments?per_page=100&page=8>; rel="last"' }
  }, 'fixture')
  assert.deepEqual(rows, comments.filter(c => c.body.startsWith(marker)).slice(-400).map(c => c.body.slice(marker.length)))
  assert.equal(pages[0], 1)
  assert.ok(pages.includes(8))
  await assert.rejects(reader(async () => ({ ok: false, body: {} }), 'fixture'))
}

try {
  for (const [name, test] of Object.entries({ migration, maintenance, outbox, locks, gist })) {
    if (selected && selected !== name) continue
    await test()
    console.log('PASS audit minimal safety: ' + name)
  }
} finally {
  if (flushDiagnostics) await flushDiagnostics()
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  fs.rmSync(root, { recursive: true, force: true })
}
