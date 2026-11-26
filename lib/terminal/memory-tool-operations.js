import { fileWithinRoots, pathKey } from '../file-boundary.js'
import { ContractError, boolean, integer, object, oneOfValues, record, text, validate } from './contract.js'

const revision = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const eventId = { type: 'string', pattern: '^evt_[a-f0-9]{8}$' }
const memoryId = { type: 'string', pattern: '^mem_[a-f0-9]{32}$' }
const noteIds = { items: memoryId, minItems: 1, maxItems: 50, uniqueItems: true }
const noteDestination = { expectedNotesPath: text, expectedRevision: revision }
const noteResult = object({ path: text, revision, changed: boolean, warning: text }, ['path', 'revision', 'changed'])
const liveSessionRequired = ({ liveAgent }) => liveAgent ? null : 'Select an active DSH session'

function describeTool(tools, {
  id, title, name, fields, required, constraints = {}, privateFields = {}, fixed = {},
  access = 'read', result, options, args: toolArgs = args => ({ ...args, ...fixed }),
}) {
  const tool = tools.get(name)
  if (!tool) return null
  const properties = { ...privateFields }
  for (const field of [...fields, ...Object.keys(fixed)]) {
    const modelField = tool.parameters.properties[field]
    if (!modelField) throw new Error(id + ' references missing tool argument ' + field)
    if (Object.hasOwn(fixed, field)) validate(fixed[field], modelField)
    else properties[field] = { ...modelField, ...constraints[field] }
  }
  for (const field of tool.parameters.required || []) {
    if (!required.includes(field) && !Object.hasOwn(fixed, field)) {
      throw new Error(id + ' must supply required tool argument ' + field)
    }
  }
  return {
    id, title, group: 'memory', scope: 'session', access,
    approval: access === 'read' ? 'none' : 'explicit-confirmation',
    inputSchema: object(properties, required),
    resultSchema: result || tool.output.schema,
    source: { kind: 'tool', key: name },
    since: '1.0', deprecated: null, status: 'available', available: liveSessionRequired,
    execute: (args, ctx) => ctx.memoryTool(name, toolArgs(args), options?.(args)),
  }
}

function noteOptions({ expectedNotesPath, expectedRevision }, action) {
  return { note: { action, expectedNotesPath, expectedDigest: expectedRevision } }
}

export function createMemoryToolOperations(tools) {
  const recall = describeTool(tools, {
    id: 'memory.recall.scoped', title: 'Search DSH session history or project events', name: 'memory_recall',
    fields: ['scope', 'query', 'limit', 'format'], required: ['scope', 'query'],
    constraints: { scope: oneOfValues('sessions', 'events'), query: { maxLength: 4000 }, limit: integer(1, 50) },
    options: () => ({ scopedRecall: true }),
  })
  // An empty query is the existing event enumeration command.
  if (recall) {
    recall.inputSchema.if = { properties: { scope: { const: 'sessions' } } }
    recall.inputSchema.then = { properties: { query: { pattern: '\\S' } } }
  }

  return [
    recall,
    describeTool(tools, {
      id: 'memory.recall.expand', title: 'Read a recalled memory record by ID', name: 'memory_recall',
      fields: ['expand'], fixed: { query: '' }, required: ['expand'], constraints: { expand: memoryId },
      args: ({ expand }) => ({ expand, query: expand }),
      options: () => ({ scopedRecall: true }),
    }),
    describeTool(tools, {
      id: 'memory.plan.trace', title: 'Trace a whiteboard entry and its versions', name: 'memory_trace',
      fields: ['id'], required: ['id'], constraints: { id: { ...text, pattern: '\\S', maxLength: 256 } }, result: record,
    }),
    describeTool(tools, {
      id: 'memory.plan.expand', title: 'Expand whiteboard entries by tag', name: 'memory_expand',
      fields: ['tag', 'limit'], required: ['tag'], result: record,
      constraints: { tag: { ...text, pattern: '\\S', maxLength: 512 }, limit: integer(1, 20) },
    }),
    describeTool(tools, {
      id: 'memory.note.replace', title: 'Replace the full project note at its current revision', name: 'memory_note',
      fields: ['content'], fixed: { kind: 'note', action: 'replace' },
      required: ['content', 'expectedNotesPath', 'expectedRevision'], privateFields: noteDestination,
      constraints: { content: { ...text, pattern: '\\S', maxLength: 200000 } }, access: 'write', result: noteResult,
      args: ({ content }) => ({ kind: 'note', action: 'replace', content }),
      options: args => noteOptions(args, 'replace'),
    }),
    describeTool(tools, {
      id: 'memory.note.retract', title: 'Mark project note entries as retracted', name: 'memory_note',
      fields: ['retract', 'retractReason'], fixed: { kind: 'note' },
      required: ['retract', 'expectedNotesPath', 'expectedRevision'], privateFields: noteDestination,
      constraints: {
        retract: noteIds,
        retractReason: { ...text, pattern: '^[^\\r\\n]+$', maxLength: 120 },
      },
      access: 'write', result: noteResult,
      args: ({ retract, retractReason }) => ({ kind: 'note', retract, ...(retractReason === undefined ? {} : { retractReason }) }),
      options: args => noteOptions(args, 'retract'),
    }),
    describeTool(tools, {
      id: 'memory.note.restore', title: 'Restore project note entries to current status', name: 'memory_note',
      fields: ['restore'], fixed: { kind: 'note' },
      required: ['restore', 'expectedNotesPath', 'expectedRevision'], privateFields: noteDestination,
      constraints: { restore: noteIds }, access: 'write', result: noteResult,
      args: ({ restore }) => ({ kind: 'note', restore }),
      options: args => noteOptions(args, 'restore'),
    }),
    describeTool(tools, {
      id: 'memory.note.supersede', title: 'Mark project note entries as superseded', name: 'memory_note',
      fields: ['supersedes'], fixed: { kind: 'note' },
      required: ['supersedes', 'successorId', 'expectedNotesPath', 'expectedRevision'],
      privateFields: { ...noteDestination, successorId: memoryId }, constraints: { supersedes: noteIds },
      access: 'write', result: noteResult,
      args: ({ supersedes }) => ({ kind: 'note', supersedes }),
      options: args => ({ note: { ...noteOptions(args, 'supersede').note, successorId: args.successorId } }),
    }),
    describeTool(tools, {
      id: 'memory.log.preflight', title: 'Preview daily log event attribution', name: 'memory_log',
      fields: ['note', 'kind', 'date', 'eventId'], fixed: { dryRun: true }, required: ['note'],
      constraints: {
        note: { ...text, pattern: '\\S', maxLength: 2000 }, eventId,
        date: { pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      options: () => ({ logPreflight: true }),
    }),
  ].filter(Boolean)
}

export async function invokeTerminalMemoryTool(tools, engine, { scope, liveAgent, workspacePaths }, signal, name, args, options = {}, workspaceRead = false) {
  const tool = tools.get(name)
  if (!tool) throw new ContractError('tool-unavailable', 'The selected memory tool is unavailable', 409)
  validate(args, { ...tool.parameters, additionalProperties: false })
  const isActive = () => liveAgent?.session?.id === scope.sessionId && engine.agentForSessionId(scope.sessionId) === liveAgent
  const workspaceAgent = !liveAgent && workspacePaths && workspaceRead
    ? { session: { header: { cwd: workspacePaths.ws } } }
    : undefined
  const verify = async () => {
    signal.throwIfAborted()
    if (workspaceAgent) {
      if (!workspacePaths.wsBound || pathKey(workspacePaths.ws) !== pathKey(scope.workspace)) {
        throw new ContractError('workspace-mismatch', 'The selected workspace changed', 409)
      }
      return
    }
    if (!liveAgent || !isActive()) throw new ContractError('session-unavailable', 'The selected active DSH session changed', 409)
    const paths = await engine.resolvePaths(liveAgent)
    if (!isActive()) throw new ContractError('session-unavailable', 'The selected active DSH session changed', 409)
    assertTerminalMemoryWorkspace(paths, scope.workspace)
    signal.throwIfAborted()
  }
  await verify()
  let result
  try {
    // The registered tool's upgrade gate can queue the call for replay. A
    // preview and a revision-bound edit must finish in this invocation.
    if ((options.note || options.logPreflight) && engine._inflightUpgradeJobs.size) {
      throw new ContractError('memory-upgrade-in-progress', 'Retry after the memory upgrade finishes', 409)
    }
    const execute = () => tool.execute(args, { agent: liveAgent || workspaceAgent, signal,
      terminalMemory: { ...options, workspace: scope.workspace, workspaceOnly: !liveAgent && workspaceRead } })
    if (workspaceAgent) {
      try { result = await engine.withAgent(workspaceAgent, execute) } finally { engine.disposeAgent(workspaceAgent) }
    } else result = await execute()
  } catch (error) {
    if (options.note && (error?.fsCode === 'MEMORY_CONFLICT' ||
      (error?.code === 'MEMORY_WRITE_FAILED' && error.message?.endsWith(':conflict-external-edit')))) {
      throw new ContractError('note-revision-conflict', 'The project note changed. Read its current revision before retrying.', 409)
    }
    if (options.note && error?.written === true) {
      throw new ContractError('note-write-unverified', 'The write reached disk. Read the project note before retrying.', 500)
    }
    throw error
  }
  if (!options.note) await verify()
  if (result && typeof result === 'object' && result.error && (name === 'memory_expand' || name === 'memory_trace')) {
    throw new ContractError('whiteboard-read-failed', 'The plugin could not load the whiteboard index', 503)
  }
  return result
}

export function assertTerminalMemoryWorkspace(paths, workspace) {
  if (!paths.wsBound || !paths.ws || !workspace || pathKey(paths.ws) !== pathKey(workspace)) {
    throw new ContractError('workspace-mismatch', 'The selected session workspace changed', 409)
  }
}

function assertTerminalNoteDestination(paths, { workspace, note }) {
  assertTerminalMemoryWorkspace(paths, workspace)
  const physical = fileWithinRoots(paths.notesPath, [paths.projectDir], { strict: true })
  if (note.expectedNotesPath !== paths.notesPath && note.expectedNotesPath !== physical) {
    throw new ContractError('note-destination-changed', 'The project note destination changed. Read the current project overview.', 409)
  }
  if (!physical) {
    throw new ContractError('note-source-unavailable', 'The project note is unavailable within the selected project', 404)
  }
}

export function checkTerminalNoteStatusSnapshot(text, digest, plan, { expectedDigest, successorId }, readRecordStatus) {
  if (digest !== expectedDigest) {
    throw new ContractError('note-revision-conflict', 'The project note changed. Read its current revision before retrying.', 409)
  }
  const ids = plan.supersedes ?? plan.retract ?? plan.restore
  const entries = ids.map(id => readRecordStatus(text, id))
  if (entries.some(entry => !entry)) {
    throw new ContractError('note-entry-not-found', 'A selected entry is missing from the project note', 404)
  }
  if (successorId) {
    const successor = readRecordStatus(text, successorId)
    if (ids.includes(successorId) || successor?.status !== 'current') {
      throw new ContractError('note-successor-invalid', 'Select a different current entry in this project note as the successor', 409)
    }
    if (entries.some(entry => entry.status === 'superseded' && entry.supersededBy !== successorId)) {
      throw new ContractError('note-successor-conflict', 'A selected entry already has a different supersession status', 409)
    }
  }
}

export function terminalNoteReceipt(path, revision, changed, warning) {
  return { path, revision, changed, ...(warning ? { warning } : {}) }
}

export async function executeTerminalNoteMutation({ engine, paths, args, terminalMemory, sanitizeForWrite, writeGateRefusalTextPre }) {
  assertTerminalNoteDestination(paths, terminalMemory)
  engine._assertTeamActionPre(engine._teamWriteActionPre(paths.notesPath))
  const { note } = terminalMemory
  if (note.action === 'retract') {
    return engine.applyNoteStatusPre(paths.notesPath, { retract: args.retract, reason: args.retractReason }, '',
      { expectedDigest: note.expectedDigest })
  }
  if (note.action === 'restore') {
    return engine.applyNoteStatusPre(paths.notesPath, { restore: args.restore }, '',
      { expectedDigest: note.expectedDigest })
  }
  if (note.action === 'supersede') {
    return engine.applyNoteStatusPre(paths.notesPath, { supersedes: args.supersedes }, '',
      { expectedDigest: note.expectedDigest, successorId: note.successorId })
  }
  const content = args.content.trim()
  const gate = sanitizeForWrite(content, { maxEntryChars: 200000 })
  if (!gate.ok) throw new ContractError('note-content-rejected', writeGateRefusalTextPre('memory_note', gate))
  if (gate.truncated) throw new ContractError('note-content-too-long', 'The full project note exceeds the write limit')
  const write = gate.clean || content
  // A full replacement is charged for its own size. Compaction would mutate
  // the source without making an oversized replacement fit.
  const limit = engine.capacityLimit('note')
  if (write.length > limit) {
    throw new ContractError('note-capacity-exceeded', 'The replacement exceeds the configured project note capacity of ' + limit + ' characters', 409)
  }
  const saved = await engine.writeFull(paths.notesPath, write, { expectedDigest: note.expectedDigest })
  engine.state.notesText = write
  engine.state.loadedAt = Date.now()
  return terminalNoteReceipt(paths.notesPath, saved.digest, saved.digest !== note.expectedDigest,
    saved.dirty ? 'The note was saved. Its derived index needs repair.' : undefined)
}
