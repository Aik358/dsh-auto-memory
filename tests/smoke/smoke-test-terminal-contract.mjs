import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startRecallHost } from '../lib/pr420-host.mjs'
import { CONTRACT_PATH, validate } from '../../lib/terminal/contract.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-terminal-contract-'))
const executable = fileURLToPath(new URL('../../lib/terminal/cli.js', import.meta.url))
const manifestFile = new URL('../fixtures/terminal-contract-v1.json', import.meta.url)
const cookie = 'dsh-fixture=synthetic'
let host
let passed = 0
function pass(label) { passed++; console.log('PASS ' + label) }

try {
  await mkdir(path.join(root, 'workspace'))
  const workspaces = [{ id: 'fixture-project', path: path.join(root, 'workspace'), sessionIds: [] }]
  host = await startRecallHost(root, { semanticEngineMode: 'lexical', handoffEnabled: false }, {
    services: {
      connection: { admit: req => req.headers.cookie === cookie ? { peer: { principal: { kind: 'owner' } } } : { rejection: 401 } },
      workspaceRegistry: { list: () => workspaces, get: id => workspaces.find(item => item.id === id) },
      agents: { list: () => host?.engine._lastAgent ? [host.engine._lastAgent] : [] },
    },
  })
  const endpoint = host.base + CONTRACT_PATH
  const scope = { sessionId: host.agent.session.id, workspace: host.agent.session.header.cwd }
  const headers = { cookie, 'content-type': 'application/json' }
  async function discover(chosen = scope) {
    const response = await fetch(endpoint + '?' + new URLSearchParams(chosen), { headers })
    assert.equal(response.status, 200)
    return response.json()
  }
  assert.equal((await fetch(endpoint)).status, 401)
  assert.equal((await fetch(endpoint, { headers: { ...headers, origin: 'http://127.0.0.1:1024' } })).status, 401)
  const manifest = await discover()
  assert.equal(manifest.contractVersion, '1.0')
  assert.equal(manifest.identity.harness, 'dsh')
  assert.deepEqual(manifest.scope, scope)
  pass('owner authentication and verified scope')

  const described = manifest.operations.map(({ status, reason, ...op }) => op).sort((a, b) => a.id.localeCompare(b.id, 'en'))
  if (process.argv.includes('--update-manifest')) await writeFile(manifestFile, JSON.stringify(described, null, 2) + '\n')
  const expected = JSON.parse(await readFile(manifestFile, 'utf8'))
  const oldOperations = new Map(expected.map(op => [op.id, op]))
  const currentOperations = new Map(described.map(op => [op.id, op]))
  const differences = []
  for (const id of new Set([...oldOperations.keys(), ...currentOperations.keys()])) {
    if (!oldOperations.has(id)) differences.push('added ' + id)
    else if (!currentOperations.has(id)) differences.push('removed ' + id)
    else if (JSON.stringify(oldOperations.get(id)) !== JSON.stringify(currentOperations.get(id))) differences.push('changed ' + id)
  }
  assert.deepEqual(differences, [], 'Runtime contract drift. Review the named changes and migration plan.')
  pass('all ' + described.length + ' public operation schemas and bindings match the versioned contract')

  async function call(operation, args = {}, details = {}, signal) {
    const response = await fetch(endpoint, { method: 'POST', headers, signal,
      body: JSON.stringify({ operation, args, scope, instanceId: manifest.identity.instanceId, ...details }) })
    return { status: response.status, data: await response.json() }
  }
  const stale = await call('status', {}, { instanceId: 'stale' })
  assert.equal(stale.status, 409)
  assert.equal((await call('status', {}, { scope: { sessionId: 'unknown' } })).status, 400)
  assert.equal((await call('memory.list', {}, { scope: { ...scope, workspace: path.join(root, 'other') } })).status, 409)
  assert.equal((await call('memory.list', {}, { scope: {} })).status, 400)
  host.engine._lastAgent = { ...host.agent, status: 'running' }
  const pathOnly = { workspace: scope.workspace }
  const workspaceStatus = (await call('status', {}, { scope: pathOnly })).data.result
  assert.deepEqual(workspaceStatus.scope, pathOnly)
  const workspaceState = (await call('system.workspaces', {}, { scope: pathOnly })).data.result
  assert.equal(workspaceState.workspaces.find(row => row.workspaceRef === 'fixture-project').activities.turn, 1)
  const pathDiscovery = await discover({ workspaceRef: 'fixture-project' })
  assert.deepEqual(pathDiscovery.scope, pathOnly)
  assert.equal(pathDiscovery.operations.find(op => op.id === 'board.events.list').status, 'available')
  assert.equal(pathDiscovery.operations.find(op => op.id === 'memory.note').status, 'available')
  assert.equal((await call('memory.list', {}, { scope: pathOnly })).data.result.ws, scope.workspace)
  assert.deepEqual((await call('board.events.list', {}, { scope: pathOnly })).data.result._resolved.source, 'workspace')
  const workspaceOverview = (await call('memory.overview', {}, { scope: pathOnly })).data.result
  const workspaceNote = { content: 'Workspace browse write with explicit approval.', expectedNotesPath: workspaceOverview.notesPath }
  const noteConfirmation = 'fixture-sessionless-workspace-write'
  assert.equal((await call('memory.note', workspaceNote, { scope: pathOnly })).status, 403)
  const noteWrite = await call('memory.note', workspaceNote, { scope: pathOnly, approved: true, requestId: noteConfirmation })
  assert.equal(noteWrite.status, 200, JSON.stringify(noteWrite))
  assert.equal(noteWrite.data.result.path, workspaceNote.expectedNotesPath)
  assert.equal((await call('receipt', { requestId: noteConfirmation }, { scope: pathOnly })).data.result.state, 'finished')
  assert.equal((await call('status', {}, { scope: { workspace: path.join(root, 'unknown') } })).data.error.code, 'workspace-not-found')
  assert.deepEqual((await call('status', {}, { scope: {} })).data.result.scope, {})
  assert.equal((await call('memory.recall', { query: 'test', scope: 'unknown' })).status, 400)
  assert.equal((await call('not-known')).status, 404)
  pass('stale generation, invalid session, wrong workspace, input and unknown operation')

  const first = (await call('status')).data.result
  assert.equal((await call('status')).data.result.revision, first.revision)
  const webSave = await host.request('config', { globalBriefEnabled: true })
  assert.equal(webSave.status, 200)
  const status = (await call('status')).data.result
  assert.notEqual(status.revision, first.revision)
  const settingsResponse = await call('settings.get')
  assert.equal(settingsResponse.status, 200, JSON.stringify(settingsResponse))
  const settings = settingsResponse.data.result
  assert.equal(settings.config.globalBriefEnabled, true)
  assert.equal((await call('settings.set', { patch: { globalBriefEnabled: false }, revision: first.settingsRevision })).status, 403)
  assert.equal((await call('settings.set', { patch: { globalBriefEnabled: false }, revision: first.settingsRevision }, {
    approved: true, requestId: 'fixture-setting-stale',
  })).data.error.code, 'settings-version-conflict')
  const approval = { approved: true, requestId: 'fixture-setting-current' }
  const patch = { patch: { globalBriefEnabled: false }, revision: settings.revision }
  const [saved, duplicate] = await Promise.all([call('settings.set', patch, approval), call('settings.set', patch, approval)])
  assert.equal(saved.status, 200, JSON.stringify(saved))
  assert.deepEqual(saved, duplicate)
  assert.equal((await host.request('config')).data.config.globalBriefEnabled, false)
  assert.equal((await call('receipt', { requestId: approval.requestId })).data.result.state, 'finished')
  assert.equal((await call('settings.set', { ...patch, patch: { globalBriefEnabled: true } }, approval)).status, 409)
  pass('Web and CLI setting readback, CAS, concurrent replay and receipt')

  const lastSettings = (await call('settings.get')).data.result
  const savedCredentials = await call('settings.set', { revision: lastSettings.revision,
    patch: { teamAccessKeyId: 'fixture-key-id', teamSecretAccessKey: 'fixture-secret' } },
  { approved: true, requestId: 'fixture-setting-credential' })
  assert.equal(savedCredentials.status, 200)
  assert.notEqual(savedCredentials.data.result.revision, lastSettings.revision)
  assert.equal(JSON.stringify(savedCredentials.data).includes('fixture-secret'), false)
  assert.equal((await call('settings.get')).data.result.config.teamSecretAccessKey, undefined)
  const calendar = await call('memory.calendar', {}, { scope: {} })
  assert.equal(calendar.status, 200, JSON.stringify(calendar))
  assert.equal(Array.isArray(calendar.data.result.entries), true)
  pass('write-only settings change revision, and calendar can be read without a project')

  const team = await call('team.sync.diagnostics')
  assert.deepEqual(team.data.result, { enabled: false, transportReady: false, sync: null, outbox: null })
  const resumeId = 'fixture-team-resume'
  const resume = await call('team.pause', { paused: false }, { approved: true, requestId: resumeId })
  assert.equal(resume.status, 409)
  assert.equal(resume.data.error.message, 'upgrade-state-unavailable')
  assert.deepEqual(resume.data.error.details, {
    paused: true, detail: '拿不到版本状态，无法确认双方一致', canResume: false,
  })
  const resumeReceipt = await call('receipt', { requestId: resumeId })
  assert.equal(resumeReceipt.data.result.state, 'rejected')
  assert.deepEqual(resumeReceipt.data.result.error, resume.data.error)
  pass('team diagnostics report unavailable transport and preserve resume refusal details')

  const start = Promise.withResolvers()
  const finish = Promise.withResolvers()
  const saveConfig = host.engine.saveConfig
  const interruption = new AbortController()
  const writeInput = { revision: savedCredentials.data.result.revision, patch: { globalBriefEnabled: true } }
  const writeDetails = { approved: true, requestId: 'fixture-timeout-retry' }
  let saveCount = 0
  host.engine.saveConfig = async function (...args) {
    saveCount++
    start.resolve()
    await finish.promise
    return saveConfig.apply(this, args)
  }
  try {
    const pending = call('settings.set', writeInput, writeDetails, interruption.signal)
    const stopped = assert.rejects(pending, { name: 'AbortError' })
    await start.promise
    interruption.abort()
    await stopped
    assert.equal((await call('receipt', { requestId: writeDetails.requestId })).data.result.state, 'running')
    finish.resolve()
    const repeated = await call('settings.set', writeInput, writeDetails)
    assert.equal(repeated.status, 200, JSON.stringify(repeated))
    assert.equal((await call('receipt', { requestId: writeDetails.requestId })).data.result.state, 'finished')
    assert.equal(saveCount, 1)
    assert.equal((await host.request('config')).data.config.globalBriefEnabled, true)
    pass('interrupted connection preserves the accepted write and same-ID recovery')
  } finally {
    finish.resolve()
    host.engine.saveConfig = saveConfig
  }

  const list = await call('memory.list')
  assert.equal(list.status, 200, JSON.stringify(list))
  assert.equal(list.data.result.wsBound, true)
  const note = { content: 'Terminal contract sample 文本', expectedNotesPath: host.paths.notesPath }
  assert.equal((await call('memory.note', note, { ...approval, requestId: 'fixture-note-wrong-target', scope: { sessionId: scope.sessionId } })).status, 400)
  assert.equal((await call('memory.note', { ...note, expectedNotesPath: path.join(root, 'different') }, {
    ...approval, requestId: 'fixture-note-stale-path',
  })).status, 409)
  const result = await call('memory.note', note, { ...approval, requestId: 'fixture-note-correct' })
  assert.equal(result.status, 200, JSON.stringify(result))
  const source = await call('memory.source', { path: host.paths.notesPath })
  assert.equal(source.status, 200, JSON.stringify(source))
  assert.match(source.data.result.content, /Terminal contract sample 文本/)
  assert.equal((await call('memory.source', { path: path.join(root, 'dsh-auto-memory.json') })).status, 404)
  assert.equal((await call('board.events.list')).status, 200)
  assert.equal((await call('board.events.detail', { id: 'missing' })).status, 404)
  pass('note target proof, write, source scope and event list/detail')

  const operation = manifest.operations.find(op => op.id === 'memory.read')
  assert.deepEqual(operation.inputSchema.properties.kind.enum, ['log', 'reflection', 'user', 'notes', 'calendar', 'plan', 'archive', 'summary'])
  const read = await call('memory.read', { kind: 'notes' })
  assert.match(read.data.result, /Terminal contract sample/)
  assert.throws(() => validate({ kind: 'read', rows: [{ action: 'replace' }] },
    { type: 'object', properties: { rows: { type: 'array', items: {
      type: 'object', if: { properties: { action: { const: 'replace' } } }, then: { required: ['revision'] },
    } } } }), /revision is required/)
  const cli = spawn(process.execPath, [executable, 'doctor', '--json', '--url', host.base, '--dsh-home', path.join(root, 'missing')], {
    env: { ...process.env, DSH_SESSION_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  let diagnostic = ''
  cli.stdout.on('data', chunk => { output += chunk })
  cli.stderr.on('data', chunk => { diagnostic += chunk })
  assert.equal(await new Promise(resolve => cli.on('close', resolve)), 3)
  assert.equal(output, '')
  assert.equal(JSON.parse(diagnostic).error.code, 'unauthorized')
  pass('registered tool schema, nested condition validation and machine failure output')

  const lifecycle = (name, fields = {}, harness = 'codex') => call('external.lifecycle', {
    harness, name, sessionId: 'fixture-external-session', ...fields,
  })
  assert.equal((await lifecycle('UserPromptSubmit', { turnId: 'turn-1' })).data.result.status, 'out-of-order')
  assert.equal((await call('external.lifecycle', { harness: 'codex', name: 'SessionStart', sessionId: 'fixture-external-session' },
    { scope: { sessionId: scope.sessionId } })).status, 400)
  const initial = (await lifecycle('SessionStart', { source: 'startup' })).data.result
  assert.equal(initial.status, 'accepted')
  assert.match(initial.context, /Terminal contract sample 文本/)
  assert.deepEqual((await lifecycle('SessionStart', { source: 'startup' })).data.result, { status: 'duplicate' })
  assert.deepEqual((await lifecycle('UserPromptSubmit', { turnId: 'turn-1' })).data.result, { status: 'accepted' })
  assert.deepEqual((await lifecycle('UserPromptSubmit', { turnId: 'turn-1' })).data.result, { status: 'duplicate' })
  assert.equal((await lifecycle('PreCompact', { trigger: 'manual' })).data.result.status, 'accepted')
  assert.equal((await lifecycle('PostCompact', { trigger: 'manual' })).data.result.status, 'accepted')
  assert.match((await lifecycle('UserPromptSubmit', { turnId: 'turn-2' })).data.result.context, /Terminal contract sample/)
  assert.match((await lifecycle('SessionStart', { source: 'startup' }, 'zcode')).data.result.context, /Terminal contract sample/)
  assert.equal((await lifecycle('PostCompact', { trigger: 'manual' }, 'zcode')).status, 400)
  const zcodeCompact = { source: 'compact', turnId: 'zcode-compact-turn' }
  assert.match((await lifecycle('SessionStart', zcodeCompact, 'zcode')).data.result.context, /Terminal contract sample/)
  assert.deepEqual((await lifecycle('SessionStart', zcodeCompact, 'zcode')).data.result, { status: 'duplicate' })
  const antigravityStart = await call('external.lifecycle', {
    harness: 'antigravity', name: 'SessionStart', sessionId: 'fixture-antigravity-session',
  })
  assert.equal(antigravityStart.data.result.status, 'accepted')
  assert.match(antigravityStart.data.result.context, /Terminal contract sample/)
  assert.deepEqual((await call('external.lifecycle', {
    harness: 'antigravity', name: 'PreInvocation', sessionId: 'fixture-antigravity-session',
  })).data.result, { status: 'accepted' })
  assert.equal((await call('external.lifecycle', {
    harness: 'antigravity', name: 'Stop', sessionId: 'fixture-antigravity-session',
  })).data.result.status, 'accepted')
  pass('workspace-bound external context, ordered events, host isolation, and duplicate suppression')
  console.log('Terminal contract ' + passed + ' cases passed')
} finally {
  await host?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
}
