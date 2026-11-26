import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EVENT_STORE_FILENAME, eventStorePre, writeStorePre } from '../../lib/event-store.js'
import { boardToolOperations, projectBoardEventDetail } from '../../lib/terminal/board-tool-operations.js'
import { checkSchema, CONTRACT_PATH, ContractError, validate } from '../../lib/terminal/contract.js'
import { countPendingWritesPre } from '../../lib/upgrade-pending.js'
import { startRecallHost } from '../lib/pr420-host.mjs'

const root = await mkdtemp(path.join(tmpdir(), 'dam-terminal-events-'))
const operations = new Map(boardToolOperations((id, title, group, scope, access, inputSchema, resultSchema, execute, source) => ({
  id, title, group, scope, access, inputSchema, resultSchema, execute, source,
})).map(operation => [operation.id, operation]))
const requestOptions = { cookie: 'fixture=terminal-events', 'content-type': 'application/json' }
const workspaceRefs = new Map()
let host
let requestSequence = 0

try {
  await mkdir(path.join(root, 'workspace'))
  const otherWorkspace = path.join(root, 'other-workspace')
  await mkdir(otherWorkspace)
  host = await startRecallHost(root, { semanticEngineMode: 'lexical', planAutoRedrawEnabled: false }, {
    services: {
      connection: { admit: req => req.headers.cookie === requestOptions.cookie ? { peer: { principal: { kind: 'owner' } } } : { rejection: 401 } },
      workspaceRegistry: { get: id => workspaceRefs.get(id) },
    },
  })
  const otherAgent = { session: { id: 'fixture-other-session', header: { cwd: otherWorkspace } } }
  const otherPaths = await host.engine.resolvePaths(otherAgent)
  const agents = new Map([[host.agent.session.id, host.agent], [otherAgent.session.id, otherAgent]])
  const paths = new Map([[host.agent.session.id, host.paths], [otherAgent.session.id, otherPaths]])
  host.engine.agentForSessionId = sid => agents.get(sid) ?? null
  host.engine.resolvePathsForSession = async sid => paths.get(sid) ?? { wsBound: false }
  const scope = { sessionId: host.agent.session.id, workspace: host.paths.ws }
  workspaceRefs.set('fixture-workspace-ref', { path: scope.workspace, sessionIds: [scope.sessionId] })
  workspaceRefs.set('fixture-other-ref', { path: otherWorkspace, sessionIds: [otherAgent.session.id] })
  const store = path.join(host.paths.handoffDir, EVENT_STORE_FILENAME)
  const endpoint = host.base + CONTRACT_PATH
  const discovery = await fetch(endpoint + '?' + new URLSearchParams(scope), { headers: requestOptions })
  assert.equal(discovery.status, 200)
  const manifest = await discovery.json()
  const advertised = manifest.operations.filter(op => operations.has(op.id))
  const integrated = !process.argv.includes('--tool-only') && advertised.length > 0
  if (process.argv.includes('--require-integrated')) assert.ok(integrated, 'Terminal HTTP integration is required')
  if (integrated) {
    assert.equal(advertised.length, operations.size, 'Expected all event actions in terminal discovery')
  }
  for (const op of operations.values()) {
    checkSchema(op.inputSchema)
    checkSchema(op.resultSchema)
    assert.equal(op.access, 'write')
    assert.equal(op.scope, 'session')
    assert.deepEqual(op.source, { kind: 'tool', key: 'memory_event' })
    if (integrated) {
      const publicOp = advertised.find(item => item.id === op.id)
      assert.deepEqual(publicOp.inputSchema, op.inputSchema)
      assert.deepEqual(publicOp.resultSchema, op.resultSchema)
      assert.equal(publicOp.approval, 'explicit-confirmation')
    }
  }

  async function httpRequest(operation, args, extra) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: requestOptions,
      body: JSON.stringify({ operation, args, instanceId: manifest.identity.instanceId, scope, ...extra }),
    })
    const payload = await response.json()
    if (!response.ok) {
      throw new ContractError(payload.error.code, payload.error.message, response.status)
    }
    return payload
  }

  async function write(action, args, extra) {
    const key = 'board.events.' + action
    if (integrated) return (await httpRequest(key, args, {
      approved: true, requestId: 'terminal-event-fixture-' + ++requestSequence, ...extra,
    })).result

    // Before HTTP registration lands, run the real apply() tool and its real store.
    const selected = extra?.scope ?? scope
    const sessionId = selected.sessionId ?? workspaceRefs.get(selected.workspaceRef)?.sessionIds[0]
    const agent = agents.get(sessionId)
    assert.ok(agent)
    const op = operations.get(key)
    validate(args, op.inputSchema)
    const result = await op.execute(args, {
      scope: { sessionId, workspace: paths.get(sessionId).ws },
      tool: (name, toolArgs, replay) => {
        assert.ok(!Object.hasOwn(toolArgs, 'workspace'))
        assert.ok(!Object.hasOwn(toolArgs, 'expectedRevision'))
        return host.engine.withAgent(agent, () => host.engine._toolRawExec.get(name)(
          toolArgs, { agent }, { ...replay, paths: paths.get(sessionId) },
        ))
      },
    })
    return validate(result, op.resultSchema, { output: true })
  }

  async function detail(eventId) {
    if (integrated) return (await httpRequest('board.events.detail', { id: eventId })).result
    const response = await host.request('event-detail', undefined, '?' + new URLSearchParams({ id: eventId, sessionId: scope.sessionId }))
    assert.equal(response.status, 200, JSON.stringify(response))
    return projectBoardEventDetail(response.data)
  }
  const reject = (promise, code, status) => assert.rejects(promise, { code, status })

  await reject(write('create', { name: 'wrong target', workspace: otherWorkspace }), 'invalid-input', 400)
  if (integrated) {
    await reject(httpRequest('board.events.create', { name: 'Needs approval' }), 'confirmation-required', 403)
  }
  const created = await write('create', {
    name: '白板事件', summary: '总览', sections: { goal: '验收' },
    startMs: 123, endMs: 456, members: ['docs/task.md'], rationale: '同一任务',
    kind: 'project', confidence: 'high', outcomes: ['准备'], skills: ['review'],
    constraints: ['rule:a'], ordinal: 2,
  }, { scope: { workspaceRef: 'fixture-workspace-ref' } })
  const createdDetail = await detail(created.eventId)
  assert.equal(createdDetail.revision, created.revision)
  assert.deepEqual(createdDetail.event.sections, { goal: '验收', doing: '', deadend: '', next: '' })
  assert.deepEqual(createdDetail.event.skills.names, ['review'])
  assert.deepEqual(createdDetail.event.constraints, ['rule:a'])
  assert.deepEqual(createdDetail.event.members, ['docs/task.md'])
  assert.equal(createdDetail.event.ordinal, 2)

  const initial = { eventId: created.eventId, expectedRevision: created.revision }
  const beforeInvalid = await readFile(store)
  for (const [action, fields] of [
    ['set', {}],
    ['set', { sections: { state: 'unknown section' } }],
    ['set', { ordinal: 3 }],
    ['append', {}],
    ['append', { quoteRef: 'orphan quote' }],
    ['append', { checkpoint: { panels: [{ kind: 'progress', text: 'wrong enum' }] } }],
    ['append', { checkpoint: { panels: [{ kind: 'state', text: 'unknown field', typo: true }] } }],
    ['append', { checkpoint: { opId: 'internal op', text: 'blocked' } }],
    ['append', { checkpoint: { text: 'invalid digest', rawSha256: '1234' } }],
    ['append', { userPercept: { stage: 'invalid', kind: 'state', text: 'text' } }],
    ['append', { commitment: { promise: 'test', state: 'invalid' } }],
    ['rename', { name: '  ' }],
    ['close', {}],
  ]) {
    await reject(write(action, { ...initial, ...fields }), 'invalid-input', 400)
  }
  await reject(write('rename', { eventId: created.eventId, name: 'Missing revision' }), 'invalid-input', 400)
  await reject(write('set', { ...initial, status: 'paused' }), 'event-write-rejected', 409)
  await reject(write('set', { ...initial, status: 'closed' }), 'event-write-rejected', 409)
  await reject(write('rename', { ...initial, name: 'Wrong workspace' }, {
    scope: { workspaceRef: 'fixture-other-ref' },
  }), 'event-not-found', 404)
  assert.deepEqual(await readFile(store), beforeInvalid)

  const paused = await write('set', { ...initial, status: 'paused', pausedReason: '等待', summary: '总览已更新', sections: { doing: '测试' } })
  const current = { eventId: created.eventId, expectedRevision: paused.revision }
  const digest = 'a'.repeat(64)
  const append = {
    ...current, quoteRef: '别名引用', quoteLine: 2,
    checkpoint: { at: 500, kind: 'progress', goal: '验证', state: '实测', dead: '', next: '收口',
      panels: [{ kind: 'log', text: '检查点' }], quoteLine: 6, rel: 'docs/task.md', bytes: 12,
      sha256: digest, rawSha256: 'sha256:' + digest, normalizedSha256: digest, idemKey: 'checkpoint-1' },
    userPercept: { kind: 'authorResponse', stage: 'accepted', text: '继续' },
    agentTrace: { action: '回读', result: '成功', wasRefuted: false },
    sharedGround: { claim: '写入受修订保护', confirmedBy: 'user' },
    commitment: { promise: '保留来源', boundary: '本项目', state: 'kept' },
    constraint: 'spec:b',
  }
  const approval = { requestId: 'stable-event-append' }
  const appended = await write('append', append, approval)
  if (integrated) {
    assert.deepEqual(await write('append', append, approval), appended)
    const receipt = (await httpRequest('receipt', approval)).result
    assert.equal(receipt.state, 'finished')
    assert.equal(receipt.operation, 'board.events.append')
    assert.deepEqual(receipt.result, appended)
  }
  const appendedDetail = await detail(created.eventId)
  assert.equal(appendedDetail.revision, appended.revision)
  assert.equal(appendedDetail.event.endMs, 500)
  assert.equal(appendedDetail.event.checkpoints[0].quoteRef, '别名引用')
  assert.equal(appendedDetail.event.checkpoints[0].quoteLine, 6)
  assert.equal(appendedDetail.event.checkpoints[0].rawSha256, digest)
  assert.equal(appendedDetail.event.userPercept[0].kind, 'authorResponse')
  assert.equal(appendedDetail.event.agentTrace[0].result, '成功')
  assert.equal(appendedDetail.event.sharedGround[0].confirmedBy, 'user')
  assert.equal(appendedDetail.event.commitments[0].state, 'kept')
  assert.deepEqual(appendedDetail.event.constraints, ['rule:a', 'spec:b'])
  assert.deepEqual((await write('append', { ...append, expectedRevision: appended.revision })).revision, appended.revision)
  const beforeStale = await readFile(store)
  for (const [action, fields] of [['set', { summary: 'stale' }], ['append', { constraint: 'stale' }],
    ['close', { outcome: 'stale' }], ['rename', { name: 'stale' }]]) {
    await reject(write(action, { ...initial, ...fields }), 'event-version-conflict', 409)
  }
  assert.deepEqual(await readFile(store), beforeStale)

  const renameTarget = { eventId: created.eventId, expectedRevision: appended.revision }
  if (integrated) {
    const resolve = host.engine.resolvePathsForSession
    let scopeReads = 0
    host.engine.resolvePathsForSession = sid => ++scopeReads === 1 ? resolve(sid) : otherPaths
    try {
      await reject(write('rename', { ...renameTarget, name: 'Binding changed' }), 'workspace-mismatch', 409)
      assert.deepEqual(await readFile(store), beforeStale)
    } finally {
      host.engine.resolvePathsForSession = resolve
    }
  }
  const parallel = await Promise.allSettled([
    write('rename', { ...renameTarget, name: '并发甲' }),
    write('rename', { ...renameTarget, name: '并发乙' }),
  ])
  const winners = parallel.filter(result => result.status === 'fulfilled')
  const conflicts = parallel.filter(result => result.status === 'rejected')
  assert.equal(winners.length, 1)
  assert.deepEqual(conflicts.map(result => result.reason.code), ['event-version-conflict'])
  assert.equal((await detail(created.eventId)).revision, winners[0].value.revision)
  const closeTarget = { eventId: created.eventId, expectedRevision: winners[0].value.revision }
  const activeRun = 'terminal-event-smoke-upgrade'
  host.engine._inflightUpgradeJobs.set(activeRun, { executorSessionId: 'upgrade-executor', pendingWrites: new Set() })
  try {
    await reject(write('close', { ...closeTarget, outcome: 'Blocked by active upgrade' }), 'event-upgrade-running', 409)
    assert.equal((await countPendingWritesPre({ root: host.paths.userDir, runId: activeRun })).total, 0)
    assert.equal((await detail(created.eventId)).revision, closeTarget.expectedRevision)
  } finally {
    host.engine._inflightUpgradeJobs.delete(activeRun)
  }
  const closed = await write('close', { ...closeTarget, outcome: '已验收' })
  const closedState = await detail(created.eventId)
  assert.equal(closedState.revision, closed.revision)
  assert.equal(closedState.event.status, 'closed')
  assert.equal(closedState.event.outcome, '已验收')
  assert.equal(closedState.event.pausedReason, null)
  await reject(write('append', { ...closeTarget, expectedRevision: closed.revision, constraint: 'new' }), 'event-write-rejected', 409)

  const legacyId = 'evt_aaaaaaaa'
  const legacy = {
    id: legacyId, name: '旧库', summary: '', outcome: null, skillRef: null, status: 'active', pausedReason: null,
    sections: { goal: '', doing: '', deadend: '', next: '' }, checkpoints: [], userPercept: [], agentTrace: [],
    sharedGround: [], commitments: [], constraints: [], createdAt: 1, updatedAt: 1,
  }
  await writeStorePre(store, { events: [legacy, closedState.event] })
  const old = await detail(legacyId)
  assert.deepEqual(old.event, legacy)
  const updated = await write('rename', { eventId: legacyId, expectedRevision: old.revision, name: '旧库升级' })
  assert.equal((await detail(legacyId)).revision, updated.revision)
  assert.equal((await detail(created.eventId)).revision, closed.revision)
  const legacyTool = await host.invokeTool('memory_event', { action: 'set', eventId: legacyId, summary: '普通模型写入' })
  assert.match(legacyTool, /事件已更新/)
  await reject(write('rename', { eventId: legacyId, expectedRevision: updated.revision, name: '旧修订写入' }), 'event-version-conflict', 409)
  await assert.rejects(eventStorePre.rename(store, legacyId, '缺修订', { receipt: {} }), { code: 'invalid-event-revision' })

  if (integrated) {
    const source = path.join(path.dirname(store), 'verified.md')
    const original = '## 已核验\n完整历史材料。\n'
    const digest = createHash('sha256').update(original).digest('hex')
    await writeFile(source, original)
    await write('append', { eventId: legacyId, expectedRevision: (await detail(legacyId)).revision, checkpoint: {
      kind: 'progress', text: '归档时留下的检查点', sourceRef: 'handoff/verified.md', idemKey: 'verified-1',
      rawSha256: digest, normalizedSha256: digest,
    } })
    const selector = { eventId: legacyId, idemKey: 'verified-1' }
    const verified = (await httpRequest('board.checkpoint.read', selector)).result
    assert.equal(verified.verified, true)
    assert.equal(verified.text, original)
    assert.equal(verified.rawSha256, digest)
    await writeFile(source, '当前文件内容已变更\n')
    const historical = (await httpRequest('board.checkpoint.read', selector)).result
    assert.equal(historical.verified, false)
    assert.equal(historical.text, '归档时留下的检查点')
    await reject(httpRequest('board.checkpoint.read', { ...selector, checkpointIndex: 0 }), 'invalid-input', 400)
    console.log('PASS verified original and historical checkpoint fallback after source drift')
  }
  console.log('PASS five terminal event actions, strict input, atomic CAS, scope, upgrade gate and model compatibility' +
    (integrated ? ' via terminal HTTP' : ' via the registered model tool and event store'))
} finally {
  await host?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 5 })
}
