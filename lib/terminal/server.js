import { createHash, randomUUID } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pathKey } from '../file-boundary.js'
import {
  BODY_LIMIT, CONTRACT_PATH, CONTRACT_VERSION, ContractError, boolean, object, record, revisionOf, scopeSchema, text, validate,
} from './contract.js'
import { localProof, newLocalKey, publishInstance, verifyKey } from './discovery.js'
import { createExternalLifecycle } from './external-lifecycle.js'
import { invokeTerminalMemoryTool } from './memory-tool-operations.js'
import { createOperations } from './operations.js'
import { configRevision } from './settings.js'

const localAddress = new Set(['127.0.0.1', '::ffff:127.0.0.1', '::1'])
const noncePattern = /^[a-f0-9]{64}$/
const requestIdSchema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{16,96}$' }
const envelope = object({
  operation: text, args: record, scope: scopeSchema, instanceId: text, approved: boolean, requestId: requestIdSchema,
}, ['operation', 'args', 'instanceId'])
const RECEIPT_LIMIT = 4096
const JOB_LIMIT = 128
export const terminalWorkspacePaths = Symbol('terminalWorkspacePaths')

function loadedBuild() {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  const hash = createHash('sha256')
  for (const file of ['../index.js', '../event-store.js', './server.js', './operations.js', './contract.js', './panel-operations.js',
    './settings.js', './external-lifecycle.js', './board-tool-operations.js', './memory-tool-operations.js']) {
    hash.update(readFileSync(new URL(file, import.meta.url)))
  }
  return { pluginVersion: pkg.version, buildId: hash.digest('hex') }
}
const build = loadedBuild()

function profileVersion(profile) {
  if (!profile?.installAnchor) return null
  try {
    const { version } = JSON.parse(readFileSync(profile.installAnchor, 'utf8'))
    return typeof version === 'string' ? version : null
  } catch { return null }
}

function send(res, status, data) {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(data))
}

function requestObject(req, routePath, method, params, queryArgs) {
  const body = method === 'GET' ? [] : [Buffer.from(JSON.stringify(params))]
  const forwarded = Readable.from(body)
  forwarded.url = routePath
  if (queryArgs || method === 'GET') {
    const query = new URLSearchParams(Object.entries(queryArgs || params).filter(([, v]) => v !== undefined && v !== null))
    if (query.size) forwarded.url += '?' + query
  }
  forwarded.method = method
  forwarded.headers = { ...req.headers, 'content-type': 'application/json' }
  forwarded.socket = req.socket
  return forwarded
}

// Keep legacy handler argument and error semantics. Its HTTP response is captured
// in-process after authorization, so the shell needs no access to legacy routes.
async function callRoute(handler, routePath, method, params, req, signal, query, workspacePaths) {
  signal.throwIfAborted()
  const forwarded = requestObject(req, routePath, method, params, query)
  if (workspacePaths) forwarded[terminalWorkspacePaths] = workspacePaths
  const captured = new EventEmitter()
  let result
  let status
  captured.writeHead = code => { status = code }
  captured.end = text => { captured.writableFinished = true; result = text }
  const abort = () => {
    forwarded.aborted = true
    captured.destroyed = true
    forwarded.emit('aborted')
    captured.emit('close')
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    await handler(forwarded, captured)
    signal.throwIfAborted()
    if (!captured.writableFinished) throw new ContractError('missing-result', 'The registered route did not answer', 502)
    const data = JSON.parse(result)
    if (status >= 400 || data.ok === false) {
      const reason = data.error ?? data.reason
      const details = routePath === '/api/dsh-auto-memory/team-pause' && data.canResume === false
        ? { paused: data.paused === true, canResume: false, detail: typeof data.detail === 'string' ? data.detail : '' }
        : undefined
      throw new ContractError('operation-rejected', typeof reason === 'string' ? reason : 'The plugin rejected the operation', status >= 400 ? status : 409, details)
    }
    return data
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

function scopeMatches(engine, expected, actual) {
  return engine._pathKey(expected) === engine._pathKey(actual)
}

function scopedContinuationState(data, state, sessionId) {
  const executing = data.executing && state?.execution?.sessionId === sessionId
  const lastOk = data.lastOk?.fromSid === sessionId ? data.lastOk : null
  const lastCancel = data.lastCancel?.sessionId === sessionId ? data.lastCancel : null
  return { ...data, executing,
    ritualTry: executing ? data.ritualTry : 0, ritualMax: executing ? data.ritualMax : 0,
    lastOk, lastCancel, lastRunAt: lastOk ? data.lastRunAt : 0,
    rejectedEdgeAt: state?.rejectedSid === sessionId ? data.rejectedEdgeAt : 0,
    error: data.pending || state?.lastAttemptSid === sessionId ? data.error : '',
    ...(executing ? { execution: { edgeAt: state.execution.edgeAt,
      canCancel: state.execution.canCancel && !state.execution.cancelled } } : {}),
  }
}

async function resolveScope(engine, ctx, scope = {}, useSoleSession = false) {
  const registry = ctx.get('workspaceRegistry')
  let soleSession
  if (scope.workspaceRef) {
    const workspace = registry?.get?.(scope.workspaceRef)
    if (!workspace?.path) throw new ContractError('workspace-not-found', 'The DSH workspace reference does not exist', 404)
    if (scope.workspace && !scopeMatches(engine, scope.workspace, workspace.path)) {
      throw new ContractError('workspace-mismatch', 'The DSH workspace reference and path differ', 409)
    }
    soleSession = workspace.sessionIds?.length === 1 ? workspace.sessionIds[0] : undefined
    scope = { ...scope, workspace: workspace.path, sessionId: scope.sessionId || (useSoleSession ? soleSession : undefined) }
  }
  if (scope.workspace && !path.isAbsolute(scope.workspace)) {
    throw new ContractError('invalid-workspace', 'Use an absolute workspace path')
  }
  if (!scope.sessionId && scope.workspace) {
    const known = scope.workspaceRef || registry?.list?.().some(item => item.path && scopeMatches(engine, scope.workspace, item.path))
      || ctx.get('sessions')?.list?.().some(item => item.header?.cwd && scopeMatches(engine, scope.workspace, item.header.cwd))
    if (!known) throw new ContractError('workspace-not-found', 'Choose a DSH workspace from system.workspaces', 404)
    return { scope: { workspace: scope.workspace }, workspacePaths: await engine.resolveWorkspacePaths(scope.workspace), soleSession }
  }
  if (!scope.sessionId) return { scope: {} }
  const bound = await engine.resolvePathsForSession(scope.sessionId)
  if (!bound.wsBound || !bound.ws) throw new ContractError('unbound-session', 'The plugin could not verify this DSH session', 400)
  if (scope.workspace && !scopeMatches(engine, scope.workspace, bound.ws)) {
    throw new ContractError('workspace-mismatch', 'The session belongs to a different workspace', 409)
  }
  const liveAgent = engine.agentForSessionId(scope.sessionId)
  const agent = liveAgent || { session: { id: scope.sessionId, header: { cwd: bound.ws } } }
  return { scope: { sessionId: scope.sessionId, workspace: bound.ws }, agent, liveAgent, soleSession }
}

function readStatus(engine, ctx, selection, jobs) {
  const runtime = selection.liveAgent ? engine.runtimes.peek(selection.liveAgent) : null
  const state = runtime && !runtime.disposed ? runtime.state : null
  const receipt = state?._deliveryTransportReceiptPre
  const query = ctx.get('sessionQuery')
  const health = typeof query?.getSearchHealth === 'function' ? query.getSearchHealth() : null
  const result = {
    connection: 'ready',
    scope: selection.scope,
    engineMode: String(engine.config.semanticEngineMode || 'auto'),
    settingsRevision: configRevision(engine.config),
    searchIndex: query ? {
      status: health?.indexStatus || (typeof query.searchSessions === 'function' ? 'capability-present' : 'unavailable'),
      refreshPhase: health?.refreshPhase || null,
      committedSearchVersion: query.committedSearchVersion || null,
    } : { status: 'unavailable', reason: 'host-session-query-unavailable' },
    delivery: receipt ? {
      source: 'last-observed-delivery', accepted: receipt.ok === true, deliveredChars: receipt.deliveredChars || 0,
      deliveredBytes: receipt.deliveredBytes || 0, reminderOnly: receipt.reminderOnly === true,
      degradations: receipt.degradations || [],
    } : { source: 'unobserved' },
    lastRefreshAt: state?.loadedAt || null,
    jobs,
    memory: state ? {
      todayEntries: state.logText?.split('\n').filter(line => line.trim().startsWith('- ')).length || 0,
      userChars: state.userText?.length || 0, projectChars: state.notesText?.length || 0,
      ledgerRevision: state.ledgerDocRevision || null,
    } : {},
  }
  return { revision: revisionOf(result), ...result }
}

function makeJobStore(engine) {
  const jobs = new Map()
  const matches = (job, { scope }) => scope.sessionId
    ? scope.sessionId === job.sessionId
    : scope.workspace && scopeMatches(engine, scope.workspace, job.workspace)
  const forScope = selection => [...jobs.values()].filter(job => matches(job, selection))
  return {
    summary: selection => {
      const rows = forScope(selection)
      return { running: rows.filter(row => row.state === 'running').length, latest: rows.at(-1)?.id || null }
    },
    active: () => [...jobs.values()].filter(job => job.state === 'running'),
    read: (id, selection) => {
      const job = jobs.get(id)
      if (!job || !matches(job, selection)) throw new ContractError('job-not-found', 'No job for this selection', 404)
      return { ...job }
    },
    start: (operation, selection, run) => {
      if (jobs.size >= JOB_LIMIT) {
        const finished = [...jobs.values()].find(job => job.state !== 'running')
        if (!finished) throw new ContractError('jobs-busy', 'All background slots are occupied', 429)
        jobs.delete(finished.id)
      }
      if (forScope(selection).some(job => job.operation === operation && job.state === 'running')) {
        throw new ContractError('job-in-progress', 'This job is already running for the session', 409)
      }
      const job = { id: randomUUID(), operation, sessionId: selection.scope.sessionId,
        workspace: selection.scope.workspace, state: 'running', startedAt: Date.now() }
      jobs.set(job.id, job)
      Promise.resolve().then(run).then(result => {
        Object.assign(job, { state: 'finished', result, finishedAt: Date.now() })
      }, () => {
        Object.assign(job, { state: 'failed', error: 'The plugin task ended with an error', finishedAt: Date.now() })
      })
      return { ...job }
    },
  }
}

export function mountTerminal({ ctx, api, routes, tools, engine, readMemorySource, readExternalContext, readCalendar, readCheckpoint, log }) {
  const routeMap = new Map(routes.map(route => [route.path, route]))
  const toolMap = new Map(tools.map(tool => [tool.name, tool]))
  const operations = createOperations(api, routeMap, toolMap)
  const profile = ctx.get('profileContext')
  const identity = {
    ...build, instanceId: randomUUID(), harness: 'dsh',
    profile: profile?.name || process.env.DSH_PROFILE || null,
    hostVersion: profileVersion(profile),
  }
  const localKey = newLocalKey()
  const jobs = makeJobStore(engine)
  const receipts = new Map()
  const observeExternal = createExternalLifecycle()
  const inFlight = new Set()

  function activityByWorkspace() {
    const active = new Map()
    function add(workspace, kind) {
      if (!workspace) return
      const key = engine._pathKey(workspace)
      const row = active.get(key) || { workspace, activities: {} }
      row.activities[kind] = (row.activities[kind] || 0) + 1
      active.set(key, row)
    }
    const running = (ctx.get('agents')?.list?.() ?? []).filter(agent => agent.status === 'running')
    const withoutPath = new Set()
    for (const agent of running) {
      const workspace = agent.session?.header?.cwd || engine.runtimes.peek(agent)?.state?.ws
      if (workspace) add(workspace, 'turn')
      else if (agent.session?.id) withoutPath.add(agent.session.id)
    }
    if (withoutPath.size) {
      for (const project of ctx.get('workspaceRegistry')?.list?.() ?? []) {
        for (const sessionId of project.sessionIds ?? []) {
          if (withoutPath.delete(sessionId)) add(project.path, 'turn')
        }
      }
    }
    for (const job of jobs.active()) add(job.workspace, 'job')
    for (const operation of inFlight) add(operation.workspace, operation.kind)
    return active
  }

  function manifest(selection) {
    return [...operations.values()].map(({ execute, available, ...description }) => {
      const reason = description.scope === 'session' && !selection.agent && !(selection.soleSession && description.access !== 'read')
        ? 'Select a verified DSH session'
        : description.scope === 'workspace' && !selection.scope?.workspace && !selection.agent
          ? 'Select a DSH workspace' : available?.(selection)
      return { ...description, ...(reason ? { status: 'unavailable', reason } : {}) }
    })
  }

  function authorization(req) {
    if (!localAddress.has(req.socket?.remoteAddress) || req.headers.origin || req.headers['sec-fetch-site']) return false
    if (verifyKey(req.headers['x-auto-memory-terminal-key'], localKey)) return true
    const admitted = ctx.get('connection')?.admit?.(req)
    return admitted?.peer?.principal?.kind === 'owner'
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'GET' && url.searchParams.has('challenge')) {
      const challenge = url.searchParams.get('challenge')
      if (!localAddress.has(req.socket?.remoteAddress) || !noncePattern.test(challenge)) return send(res, 400, { error: { code: 'bad-challenge' } })
      return send(res, 200, { instanceId: identity.instanceId, proof: localProof(localKey, challenge) })
    }
    if (!authorization(req)) return send(res, 401, { error: { code: 'unauthorized', message: 'Use a local discovery or authenticated DSH connection' } })

    const controller = new AbortController()
    const onClose = () => { if (!res.writableFinished) controller.abort() }
    res.on('close', onClose)
    const signal = controller.signal
    try {
      if (req.method === 'GET') {
        const rawScope = Object.fromEntries(url.searchParams)
        const selection = await resolveScope(engine, ctx, validate(rawScope, scopeSchema))
        const descriptors = manifest(selection)
        // Availability depends on current scope. The manifest version covers its static contract.
        const manifestVersion = revisionOf(manifest({ agent: {}, liveAgent: true }))
        return send(res, 200, { contractVersion: CONTRACT_VERSION, identity, manifestVersion, operations: descriptors, scope: selection.scope })
      }
      if (req.method !== 'POST') throw new ContractError('method-not-allowed', 'Use GET or POST', 405)
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
        throw new ContractError('invalid-content-type', 'Expected application/json', 415)
      }
      const chunks = []
      let size = 0
      for await (const chunk of req) {
        size += chunk.length
        if (size > BODY_LIMIT) throw new ContractError('body-too-large', 'Request exceeds the maximum body size', 413)
        chunks.push(chunk)
      }
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new ContractError('invalid-json', 'Request body must be JSON') }
      validate(body, envelope)
      if (body.instanceId !== identity.instanceId) throw new ContractError('instance-changed', 'Selected DSH instance has changed', 409)
      const op = operations.get(body.operation)
      const selection = await resolveScope(engine, ctx, body.scope, op?.scope === 'session' && op.access !== 'read')
      if (body.operation === 'receipt') {
        validate(body.args, object({ requestId: requestIdSchema }, ['requestId']))
        const entry = receipts.get(body.args.requestId)
        if (!entry || entry.scopeRevision !== revisionOf(selection.scope)) {
          const requestedWorkspace = selection.scope.workspace
          if (!entry || !requestedWorkspace || !entry.scope?.workspace ||
              !scopeMatches(engine, requestedWorkspace, entry.scope.workspace)) {
            throw new ContractError('receipt-not-found', 'No matching write receipt', 404)
          }
        }
        return send(res, 200, { result: { state: entry.state, operation: entry.operation, ...entry.outcome } })
      }
      if (!op) throw new ContractError('operation-not-found', 'Operation is not in this instance manifest', 404)
      if (op.scope === 'session' && !selection.agent && !selection.soleSession) throw new ContractError('session-required', 'Select a verified DSH session with --session')
      if (op.scope === 'workspace' && !selection.scope.workspace) throw new ContractError('workspace-required', 'Select a DSH workspace')
      if (op.scope === 'session' && op.access !== 'read' && !body.scope?.workspace && !body.scope?.workspaceRef) {
        throw new ContractError('workspace-required', 'Confirm the destination with --workspace', 400)
      }
      if (op.scope === 'workspace' && op.access !== 'read' && !body.scope?.workspace && !body.scope?.workspaceRef) {
        throw new ContractError('workspace-required', 'Confirm the destination with --workspace', 400)
      }
      if (op.scope === 'session' && op.access !== 'read' && !body.scope?.sessionId && !selection.soleSession) {
        throw new ContractError('session-required', 'Confirm the destination session with --session', 400)
      }
      const unavailable = op.available?.(selection)
      if (unavailable) throw new ContractError('operation-unavailable', unavailable, 409)
      validate(body.args, op.inputSchema)
      const run = operationSignal => {
        const activity = selection.scope.workspace
          ? { workspace: selection.scope.workspace, kind: op.id.includes('recall') ? 'recall'
            : op.access === 'read' ? 'read' : 'operation' }
          : null
        if (activity) inFlight.add(activity)
        async function withReadAgent(invoke) {
          if (selection.agent) return invoke(selection.agent)
          const agent = { [terminalWorkspacePaths]: selection.workspacePaths }
          try {
            return await engine.withAgent(agent, () => invoke(agent))
          } finally {
            engine.disposeAgent(agent)
          }
        }
        const requestContext = {
          ...selection,
          status: () => readStatus(engine, ctx, selection, jobs.summary(selection)),
          settings: () => engine.loadConfig(),
          calendar: readCalendar,
          saveSettings: (patch, revision) => engine.saveConfig(patch, revision),
          overview: () => withReadAgent(async agent => {
            const { config, configReadError, ...snapshot } = await engine.withAgent(agent, () => engine.snapshot(agent))
            return snapshot
          }),
          source: file => readMemorySource(selection, file),
          checkpoint: args => readCheckpoint(selection, args),
          stagePack: async packPath => {
            if (!path.isAbsolute(packPath) || !/\.dam-pack(?:\.gz)?$/i.test(packPath)) {
              throw new ContractError('invalid-pack-name', 'Provide an absolute .dam-pack or .dam-pack.gz file')
            }
            const info = await stat(packPath).catch(() => null)
            if (!info?.isFile()) throw new ContractError('pack-not-found', 'The selected migration package is unavailable', 404)
            return engine.migrateUploadPre(createReadStream(packPath), path.basename(packPath))
          },
          storage: async (action, args) => {
            const manager = engine._storageManager
            if (!manager) throw new ContractError('storage-unavailable', 'The plugin storage manager is unavailable', 409)
            const resolved = selection.workspacePaths ?? await engine.resolvePaths(selection.agent)
            const paths = { workspaceKey: pathKey(resolved.ws), userMemoryPath: resolved.userFile,
              workspaceMemoryPath: resolved.notesPath, todayLogPath: resolved.logPath }
            const scan = manager.scanHealth(paths)
            if (action === 'scan') return { ...scan, audit: manager.auditLog().slice(-8) }
            if (!scan.ok) return scan
            const allowed = scan.sources.map(item => item.file)
            if (action === 'repair') {
              if (args.items?.some(item => !allowed.includes(item.file))) {
                throw new ContractError('source-forbidden', 'A repair file is outside the selected corpus', 403)
              }
              return manager.repair(args.items, paths)
            }
            if (!allowed.includes(args.filePath)) throw new ContractError('source-forbidden', 'The file is outside the selected corpus', 403)
            const result = await manager.deleteMemory(args)
            if (result.ok) return result
            if (result.reason === 'not-found') throw new ContractError('not-found', 'The memory entry no longer exists', 404)
            if (result.reason === 'conflict-external-edit') {
              throw new ContractError(result.reason, 'The memory source changed. Read its current revision before retrying.', 409)
            }
            if (result.reason === 'no-doc-store') throw new ContractError(result.reason, 'The anchored memory index is unavailable', 409)
            throw new ContractError('storage-delete-rejected', 'The plugin could not safely delete the memory entry', 409)
          },
          continueSession: async ({ action, edgeAt }) => {
            const sid = selection.scope.sessionId
            if (action === 'cancel') {
              const state = engine._autoContState
              const active = state?.execution || state?.armed || state?.lastCancel
              if (active?.sessionId !== sid || active.edgeAt !== edgeAt) {
                throw new ContractError('stale-edge', 'There is no matching continuation for the selected session', 409)
              }
            }
            const result = await engine.decideAutoContinue(action, edgeAt, sid)
            if (!result?.ok && !result?.cancelled) {
              throw new ContractError('continuation-rejected', result?.error || 'DSH did not accept the continuation', 409)
            }
            return result
          },
          inheritPermission: async successorId => {
            validate({ sessionId: successorId }, scopeSchema)
            if (!selection.liveAgent || successorId === selection.scope.sessionId) {
              throw new ContractError('invalid-successor', 'Select a live source and a different successor session', 409)
            }
            const successor = await resolveScope(engine, ctx, { sessionId: successorId, workspace: selection.scope.workspace })
            if (!successor.agent) throw new ContractError('invalid-successor', 'The successor could not be verified', 409)
            const result = await engine.inheritPermissionForContinue(selection.scope.sessionId, successorId)
            if (!result.ok) throw new ContractError('permission-inheritance-rejected', result.reason || 'The host refused inheritance', 409)
            return result
          },
          observeExternal: event => {
            if (!body.scope?.workspace) throw new ContractError('workspace-required', 'Bind the external host to an explicit DSH workspace')
            return observeExternal(event, selection.scope, () => readExternalContext(selection))
          },
          curate: async args => {
            const paths = await engine.resolvePathsForSession(selection.scope.sessionId)
            if (!paths.wsBound || !scopeMatches(engine, paths.ws, selection.scope.workspace)) {
              throw new ContractError('workspace-mismatch', 'The curation workspace changed', 409)
            }
            try { return await engine.writeCuratedEventsPre({ ...args, handoffDir: paths.handoffDir }) } catch (error) {
              if (error.code === 'confirm-required') throw new ContractError(error.code, error.message, 409)
              throw error
            }
          },
          route: (key, method, params, query) => {
            const dispatch = () => callRoute(routeMap.get(api[key]).handler, api[key], method, params, req, operationSignal, query,
              op.scope === 'workspace' ? selection.workspacePaths : undefined)
            const result = selection.agent ? engine.withAgent(selection.agent, dispatch) : dispatch()
            if (key !== 'auto-continue-state') return result
            return result.then(data => scopedContinuationState(data, engine._autoContState, selection.scope.sessionId))
          },
          workspaces: () => {
            const sessions = ctx.get('sessions')?.list() || []
            const workspaces = ctx.get('workspaceRegistry')?.list?.() || []
            const known = new Map()
            const projects = new Map()
            for (const workspace of workspaces) {
              if (!workspace.path) continue
              projects.set(engine._pathKey(workspace.path), { workspace: workspace.path, path: workspace.path,
                workspaceRef: workspace.id, title: workspace.title })
              for (const sessionId of workspace.sessionIds || []) {
                known.set(sessionId, { workspace: workspace.path, path: workspace.path, workspaceRef: workspace.id, title: workspace.title, sessionId })
              }
            }
            for (const item of sessions) {
              const workspace = item.header?.cwd
              if (!workspace) continue
              const key = engine._pathKey(workspace)
              if (!projects.has(key)) projects.set(key, { workspace, path: workspace })
              const row = known.get(item.id) || { workspace, path: workspace, sessionId: item.id }
              known.set(item.id, { ...row, sessionTitle: item.header.title })
            }
            const recent = engine._lastAgent?.session
            if (recent?.id && recent.header?.cwd && !known.has(recent.id)) {
              known.set(recent.id, { workspace: recent.header.cwd, path: recent.header.cwd, sessionId: recent.id })
            }
            const activity = activityByWorkspace()
            for (const workspace of projects.values()) {
              const current = activity.get(engine._pathKey(workspace.workspace))
              if (current) workspace.activities = current.activities
            }
            for (const workspace of known.values()) {
              const current = activity.get(engine._pathKey(workspace.workspace))
              if (current) workspace.activities = current.activities
            }
            return { workspaces: [...projects.values(), ...known.values()] }
          },
          tool: (key, args, replay) => withReadAgent(agent => toolMap.get(key).execute(args, { agent, signal: operationSignal }, replay)),
          memoryTool: (key, args, options) => invokeTerminalMemoryTool(toolMap, engine, selection, operationSignal, key, args,
            options, op.id === 'memory.read' && op.scope === 'workspace' && op.access === 'read'),
          job: id => jobs.read(id, selection),
          startJob: (opId, execute) => jobs.start(opId, selection, execute),
        }
        return Promise.resolve().then(() => op.execute(body.args, requestContext))
          .then(result => validate(result, op.resultSchema, { output: true }))
          .finally(() => { if (activity) inFlight.delete(activity) })
      }
      if (op.access === 'read') return send(res, 200, { result: await run(signal) })
      if (!body.requestId || body.approved !== true) {
        throw new ContractError('confirmation-required', 'An explicit confirmation and request ID are required', 403)
      }
      const signature = revisionOf([op.id, body.args, selection.scope])
      let entry = receipts.get(body.requestId)
      if (entry && entry.signature !== signature) throw new ContractError('request-conflict', 'Request ID belongs to a different operation or destination', 409)
      if (!entry) {
        if (receipts.size >= RECEIPT_LIMIT) throw new ContractError('receipt-limit', 'This instance has reached its receipt capacity', 503)
        entry = { operation: op.id, signature, scopeRevision: revisionOf(selection.scope), scope: selection.scope, state: 'running' }
        receipts.set(body.requestId, entry)
        entry.promise = run(new AbortController().signal).then(result => {
          entry.state = 'finished'
          entry.outcome = { result }
        }, error => {
          entry.state = 'rejected'
          entry.error = error
          entry.outcome = { error: error instanceof ContractError
            ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
            : { code: 'internal-error' } }
        })
      }
      await entry.promise
      if (entry.error) throw entry.error
      send(res, 200, { ...entry.outcome, receipt: { requestId: body.requestId, state: entry.state } })
    } catch (error) {
      const known = error instanceof ContractError || Number.isInteger(error.statusCode)
      if (!known && !signal.aborted) log?.('terminal operation failed: ' + String(error?.name || 'Error'))
      send(res, known ? error.status || error.statusCode : 500, {
        error: known
          ? { code: error.code || 'operation-rejected', message: error.message, ...(error.details ? { details: error.details } : {}) }
          : { code: 'internal-error', message: 'The plugin could not complete the request' },
      })
    } finally {
      res.removeListener('close', onClose)
    }
  }

  const unregister = ctx.webServer.register({ kind: 'exact', path: CONTRACT_PATH, handler: handle })
  let removeDiscovery = () => {}
  try {
    const origin = ctx.webServer.getOrigin?.()
    if (origin) removeDiscovery = publishInstance(identity, origin, localKey)
  } catch (error) {
    log?.('terminal discovery unavailable: ' + String(error?.code || error?.message || 'error'))
  }
  return () => {
    unregister()
    removeDiscovery()
  }
}
