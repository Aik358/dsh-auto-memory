import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { CONTRACT_PATH, validate } from '../../lib/terminal/contract.js'
import { createMemoryToolOperations } from '../../lib/terminal/memory-tool-operations.js'
import { startRecallHost, writeRecallFixture } from '../lib/pr420-host.mjs'
import { flushDiagnostics } from '../lib/audit-engine.mjs'

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const approval = () => ({ approved: true, requestId: randomUUID() })
const readIfPresent = file => readFile(file).catch(error => {
  if (error.code !== 'ENOENT') throw error
  return null
})

test('discovery omits unregistered tools and can advertise either graph tool independently', () => {
  const trace = {
    parameters: { type: 'object', properties: { id: { type: 'string' } } },
    output: { schema: { type: 'string' } },
  }
  assert.deepEqual(createMemoryToolOperations(new Map()), [])
  const [op] = createMemoryToolOperations(new Map([['memory_trace', trace]]))
  assert.equal(op.id, 'memory.plan.trace')
  assert.equal(op.source.key, 'memory_trace')
})

test('terminal actions reuse registered tools and enforce session binding, CAS and preview', { timeout: 18000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-terminal-memory-actions-'))
  const cookie = 'dsh-fixture=memory-actions'
  const sessions = new Map()
  let host
  let searchedCwd
  try {
    host = await startRecallHost(root, { semanticEngineMode: 'lexical', handoffEnabled: true, boardMode: 'event' }, {
      services: {
        sessions,
        connection: { admit: req => req.headers.cookie === cookie ? { peer: { principal: { kind: 'owner' } } } : null },
        sessionQuery: { async searchSessions(request) {
          searchedCwd = request.sessionFilters[0].values[0]
          const item = (id, cwd, snippet) => ({
            header: { id, cwd, createdAt: 1700000000000 },
            bestMatch: { sessionId: id, type: 'user/message', surface: 'current', snippet },
          })
          return { items: [item('prior', searchedCwd, 'allowed history result'), item('foreign', root, 'foreign history result')] }
        } },
      },
    })
    const { agent, engine, paths } = host
    sessions.set(agent.session.id, { id: agent.session.id, header: agent.session.header })
    await mkdir(agent.session.header.cwd, { recursive: true })
    const otherAgent = { session: { id: 'fixture-other', header: { cwd: path.join(root, 'other') } } }
    await mkdir(otherAgent.session.header.cwd, { recursive: true })
    const otherPaths = await engine.resolvePaths(otherAgent)
    const findAgent = engine.agentForSessionId.bind(engine)
    const findPaths = engine.resolvePathsForSession.bind(engine)
    engine.agentForSessionId = sid => sid === otherAgent.session.id ? otherAgent : findAgent(sid)
    engine.resolvePathsForSession = sid => sid === otherAgent.session.id ? otherPaths : findPaths(sid)
    const { Workspace: originalId } = await writeRecallFixture(host)
    await mkdir(otherPaths.projectDir, { recursive: true })
    await writeFile(otherPaths.notesPath, 'A separate project note.')

    const scope = { sessionId: agent.session.id, workspace: agent.session.header.cwd }
    const endpoint = host.base + CONTRACT_PATH
    const headers = { cookie, 'content-type': 'application/json' }
    const manifest = async selection => {
      const response = await fetch(endpoint + '?' + new URLSearchParams(selection), { headers })
      assert.equal(response.status, 200)
      return response.json()
    }
    const initial = await manifest(scope)
    const call = async (operation, args, details = {}) => {
      const response = await fetch(endpoint, { method: 'POST', headers,
        body: JSON.stringify({ operation, args, scope, instanceId: initial.identity.instanceId, ...details }) })
      return { status: response.status, data: await response.json() }
    }
    const ok = async (operation, args, details) => {
      const { status, data } = await call(operation, args, details)
      assert.equal(status, 200, JSON.stringify(data))
      validate(data.result, initial.operations.find(item => item.id === operation).resultSchema, { output: true })
      return data.result
    }
    const expectError = async (operation, args, status, code, details) => {
      const result = await call(operation, args, details)
      assert.equal(result.status, status, JSON.stringify(result.data))
      assert.equal(result.data.error.code, code)
    }

    const current = await ok('memory.recall', { scope: 'current', query: 'Fixture heading' })
    assert.ok(current.hits.some(hit => hit.memoryId === originalId))
    const history = await ok('memory.recall.scoped', { scope: 'sessions', query: 'history' })
    assert.match(history, /allowed history result/)
    assert.doesNotMatch(history, /foreign history result/)
    assert.equal(searchedCwd, scope.workspace)
    await expectError('memory.recall.scoped', { scope: 'sessions', query: ' ' }, 400, 'invalid-input')
    await expectError('memory.recall.scoped', { scope: 'all', query: 'history' }, 400, 'invalid-input')
    const event = await host.invokeTool('memory_event', { action: 'create', name: 'Terminal fixture event', summary: 'Synthetic scope check' })
    assert.match(event, /evt_[a-f0-9]{8}/)
    assert.match(await ok('memory.recall.scoped', { scope: 'events', query: '' }), /Terminal fixture event/)
    const otherScope = { sessionId: otherAgent.session.id, workspace: otherPaths.ws }
    assert.doesNotMatch(await ok('memory.recall.scoped', { scope: 'events', query: '' }, { scope: otherScope }), /Terminal fixture event/)

    await writeFile(paths.planPath, '# PLAN\n\n## Fixture checkpoint\n\nA source for type:dead-end in the terminal fixture.\n')
    const expanded = await ok('memory.plan.expand', { tag: 'type:dead-end' })
    assert.ok(expanded.entries.length > 0, JSON.stringify(expanded))
    const traced = await ok('memory.plan.trace', { id: expanded.entries[0].id })
    assert.ok(traced.found)
    assert.equal(traced.entry.id, expanded.entries[0].id)

    const store = path.join(paths.handoffDir, 'event-store.json')
    const eventBefore = await readFile(store)
    const logBefore = await readIfPresent(paths.logPath)
    assert.match(await ok('memory.log.preflight', { note: 'Synthetic attribution preview for this session' }), /\[dryRun\]/)
    await expectError('memory.log.preflight', { note: 'Forbidden log', dryRun: false }, 400, 'invalid-input')
    assert.deepEqual(await readFile(store), eventBefore)
    assert.deepEqual(await readIfPresent(paths.logPath), logBefore)

    const readNote = () => ok('memory.source', { path: paths.notesPath })
    const before = await readNote()
    assert.equal(before.revision, sha256(await readFile(paths.notesPath)))
    const firstId = 'mem_' + '1'.repeat(32)
    const secondId = 'mem_' + '2'.repeat(32)
    const replacement = {
      expectedNotesPath: paths.notesPath, expectedRevision: before.revision,
      content: '<!-- memory:' + firstId + ' -->\n## First conclusion\nA candidate for retraction.\n\n'
        + '<!-- memory:' + secondId + ' -->\n## Second conclusion\nA separate current conclusion.',
    }
    await expectError('memory.note.replace', replacement, 403, 'confirmation-required')
    await expectError('memory.note.replace', replacement, 409, 'note-destination-changed', { ...approval(), scope: otherScope })
    engine._inflightUpgradeJobs.set('fixture-upgrade', { pendingWrites: new Set() })
    try {
      await expectError('memory.log.preflight', { note: 'Synthetic upgrade preview' }, 409, 'memory-upgrade-in-progress')
      await expectError('memory.note.replace', replacement, 409, 'memory-upgrade-in-progress', approval())
      assert.equal(engine._inflightUpgradeJobs.get('fixture-upgrade').pendingWrites.size, 0)
    } finally {
      engine._inflightUpgradeJobs.delete('fixture-upgrade')
    }
    const config = await readFile(engine._configPath)
    await writeFile(engine._configPath, JSON.stringify({
      ...JSON.parse(config), teamEnabled: true, teamProjectId: 'fixture-team',
      teamMemberId: 'fixture-member', teamMemberRole: 'viewer',
    }))
    try {
      await expectError('memory.note.replace', replacement, 403, 'team-forbidden', approval())
    } finally {
      await writeFile(engine._configPath, config)
    }
    assert.equal((await readNote()).revision, before.revision)
    assert.deepEqual(await readFile(store), eventBefore)
    assert.deepEqual(await readIfPresent(paths.logPath), logBefore)
    const replaced = await ok('memory.note.replace', replacement, approval())
    assert.equal(replaced.changed, true)
    const after = await readNote()
    assert.equal(replaced.revision, after.revision)
    assert.match(after.content, /First conclusion/)
    await expectError('memory.note.replace', replacement, 409, 'note-revision-conflict', approval())
    const retract = { expectedNotesPath: paths.notesPath, expectedRevision: after.revision, retract: [firstId], retractReason: 'Fixture correction' }
    await expectError('memory.note.retract', { ...retract, retract: [firstId, originalId] }, 404, 'note-entry-not-found', approval())
    assert.equal((await readNote()).revision, after.revision)
    const [one, two] = await Promise.all([
      call('memory.note.retract', retract, approval()),
      call('memory.note.retract', { ...retract, retract: [secondId] }, approval()),
    ])
    assert.deepEqual([one.status, two.status].sort(), [200, 409])
    const winner = one.status === 200 ? firstId : secondId
    const saved = await readNote()
    assert.equal(saved.revision, (one.data.result || two.data.result).revision)
    assert.equal(saved.content.match(/dsh-status: retracted/g)?.length, 1)
    const secondRetraction = await ok('memory.note.retract', { ...retract, retract: [winner], expectedRevision: saved.revision }, approval())
    assert.equal(secondRetraction.changed, false)
    assert.equal(secondRetraction.revision, saved.revision)
    const supersede = {
      expectedNotesPath: paths.notesPath, expectedRevision: saved.revision,
      supersedes: [winner], successorId: winner === firstId ? secondId : firstId,
    }
    await expectError('memory.note.supersede', { ...supersede, successorId: winner }, 409, 'note-successor-invalid', approval())
    const superseded = await ok('memory.note.supersede', supersede, approval())
    const finalNote = await readNote()
    assert.equal(superseded.revision, finalNote.revision)
    assert.ok(finalNote.content.includes('dsh-status: superseded by=' + supersede.successorId))
    assert.equal((await ok('memory.note.supersede', { ...supersede, expectedRevision: finalNote.revision }, approval())).changed, false)
    await expectError('memory.note.restore', {
      expectedNotesPath: paths.notesPath, expectedRevision: finalNote.revision, restore: [firstId, secondId],
    }, 403, 'confirmation-required')
    const restored = await ok('memory.note.restore', {
      expectedNotesPath: paths.notesPath, expectedRevision: finalNote.revision, restore: [firstId, secondId],
    }, approval())
    assert.equal(restored.changed, true)
    const restoredNote = await readNote()
    assert.equal(restored.revision, restoredNote.revision)
    assert.doesNotMatch(restoredNote.content, /dsh-status: (?:retracted|superseded)/)
    const repeatedRestore = await ok('memory.note.restore', {
      expectedNotesPath: paths.notesPath, expectedRevision: restoredNote.revision, restore: [firstId, secondId],
    }, approval())
    assert.equal(repeatedRestore.changed, false)
    await expectError('memory.note.restore', {
      expectedNotesPath: paths.notesPath, expectedRevision: restoredNote.revision,
      restore: ['mem_' + '9'.repeat(32)],
    }, 404, 'note-entry-not-found', approval())
    assert.equal(await readFile(otherPaths.notesPath, 'utf8'), 'A separate project note.')

    engine.agentForSessionId = () => null
    assert.equal((await manifest(scope)).operations.find(item => item.id === 'memory.plan.trace').status, 'unavailable')
    await expectError('memory.recall.scoped', { scope: 'events', query: '' }, 409, 'operation-unavailable')
  } finally {
    try {
      await host?.close()
      await host?.engine.flushPendingWritesPre()
      await flushDiagnostics()
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 30 })
    }
  }
})
