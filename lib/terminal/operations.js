import {
  arrayOf, boolean, checkSchema, integer, object, oneOfValues, record, string, text,
} from './contract.js'
import { boardToolOperations, projectBoardEventDetail } from './board-tool-operations.js'
import { externalEventSchema, externalReceiptSchema } from './external-lifecycle.js'
import { createMemoryToolOperations } from './memory-tool-operations.js'
import { panelOperations } from './panel-operations.js'
import { configRevision, projectConfig, settingsPatchSchema, settingsSchema } from './settings.js'

const session = 'session'
const workspace = 'workspace'
const global = 'instance'
const read = 'read'
const write = 'write'
const key = { type: 'string', pattern: '^[a-f0-9]{64}$' }
const content = { ...text, maxLength: 8000 }
const flag = oneOfValues(0, 1)

function operation(id, title, group, scope, access, inputSchema, resultSchema, execute, source, available) {
  return {
    id, title, group, scope, access, approval: access === read ? 'none' : 'explicit-confirmation',
    inputSchema, resultSchema, execute, source, available,
    since: '1.0', deprecated: null, status: 'available',
  }
}

function viaRoute(id, title, group, scope, handler, method, input, result, map = args => args, access = method === 'GET' ? read : write) {
  return operation(id, title, group, scope, access, input, result,
    (args, ctx) => ctx.route(handler, method, map(args, ctx)),
    { kind: 'route', key: handler, method })
}

function viaTool(id, title, group, tool, tools, scope = session) {
  const resolved = tools.get(tool)
  if (!resolved) return null
  return operation(id, title, group, scope, read, { ...resolved.parameters, additionalProperties: false }, resolved.output.schema,
    (args, ctx) => ctx.tool(tool, args), { kind: 'tool', key: tool })
}

function narrowTool(id, title, group, name, tools, fields, guards, defaults) {
  const tool = tools.get(name)
  if (!tool) return null
  const selected = Object.fromEntries(fields.map(field => {
    const schema = tool.parameters.properties[field]
    if (!schema) throw new Error(id + ' references missing tool argument ' + field)
    return [field, schema]
  }))
  const base = object(selected, [...new Set([...tool.parameters.required.filter(field => fields.includes(field)), ...guards.required])])
  return operation(id, title, group, session, write, { ...base, ...guards.extra }, tool.output.schema,
    (args, ctx) => ctx.tool(name, { ...args, ...defaults }), { kind: 'tool', key: name })
}

const empty = object()
const statusResult = object({
  revision: key, settingsRevision: key, engineMode: string, searchIndex: record,
  connection: string, scope: object({ sessionId: text, workspace: text }), delivery: record,
  jobs: record, lastRefreshAt: { type: ['number', 'null'] }, memory: record,
}, ['revision', 'settingsRevision', 'connection', 'engineMode', 'scope', 'searchIndex', 'delivery', 'jobs', 'memory'])
const boardList = object({ cursor: integer(0, Number.MAX_SAFE_INTEGER), limit: integer(1, 200), all: flag, status: text })
const sessionArgs = (args, ctx) => ({ ...args, sessionId: ctx.scope.sessionId })
const workspaceArgs = (args, ctx) => ({ ...args, ws: ctx.scope.workspace })
const fileResult = object({ content: string, path: string, revision: key }, ['content', 'path', 'revision'])
const conflict = oneOfValues('keep', 'overwrite', 'rename')
const migrate = { packPath: text, onConflict: conflict, rewriteBody: boolean, allowUnprovenUserFiles: boolean }
const migrateScope = (args, ctx) => ({ ...args, targetWs: ctx.scope.workspace })
const calendarDate = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const calendarPriority = oneOfValues('重要紧急', '重要不紧急', '紧急不重要', '不重要不紧急', '未分类')
const notePlan = ['content', 'expectedRevision', 'fromEvents', 'archivedIds', 'cardId', 'expectedCardRevision']
const noteDocument = ['content', 'documentId', 'expectedRevision', 'createDocument', 'eventId']

export function createOperations(api, routes, tools) {
  const operations = [
    operation('status', 'Live status', 'system', 'optional-session', read, empty, statusResult,
      (_, ctx) => ctx.status(), { kind: 'service', key: 'status' }),
    operation('settings.get', 'Settings', 'settings', global, read, empty, object({ config: settingsSchema, revision: key }, ['config', 'revision']),
      async (_, ctx) => { const config = await ctx.settings(); return { config: projectConfig(config), revision: configRevision(config) } },
      { kind: 'service', key: 'loadConfig' }),
    operation('settings.set', 'Save settings', 'settings', global, write,
      object({ patch: settingsPatchSchema, revision: key }, ['patch', 'revision']),
      object({ config: settingsSchema, revision: key, migration: string, warning: string }, ['config', 'revision']),
      async ({ patch, revision }, ctx) => {
        const saved = await ctx.saveSettings(patch, revision)
        return { config: projectConfig(saved.config), revision: configRevision(saved.config),
          migration: saved.migrated || '', warning: saved.warning || '' }
      }, { kind: 'service', key: 'saveConfig' }),
    operation('system.workspaces', 'Select a DSH workspace and session', 'system', global, read, empty,
      object({ workspaces: arrayOf(record) }, ['workspaces']), (_, ctx) => ctx.workspaces(), { kind: 'service', key: 'sessions.list' }),
    viaRoute('memory.relationships.refresh', 'Generate workspace relationships', 'memory', global, 'workspaces', 'POST',
      object({ force: boolean }), record),
    viaRoute('system.models', 'Available model routes', 'system', global, 'models', 'GET', empty, record),
    viaRoute('system.semantic', 'Semantic engine status', 'system', global, 'semantic-status', 'GET', empty, record),
    viaRoute('memory.list', 'Project notes, logs and reflections', 'memory', workspace, 'list', 'GET', empty,
      object({ ws: string, wsBound: boolean, logs: arrayOf(record), reflections: arrayOf(record) }, ['ws', 'wsBound', 'logs', 'reflections'], true), sessionArgs),
    operation('memory.overview', 'Project memory overview', 'memory', workspace, read, empty, record,
      (_, ctx) => ctx.overview(), { kind: 'service', key: 'snapshot' }),
    operation('memory.delivery.receipt', 'Last observed delivery for the selected session', 'memory', session, read, empty, record,
      (_, ctx) => ctx.status().delivery, { kind: 'service', key: 'status' }),
    viaRoute('memory.recall', 'Search memory and sources', 'memory', workspace, 'recall', 'POST',
      object({ query: { ...text, maxLength: 4000 }, limit: integer(1, 50), scope: oneOfValues('current', 'all', 'archive', 'handoff'), format: oneOfValues('full', 'l0') }, ['query']),
      object({ result: string, hits: arrayOf(record) }, ['result', 'hits']), sessionArgs, read),
    operation('memory.source', 'Read the complete source', 'memory', workspace, read, object({ path: text }, ['path']), fileResult,
      (args, ctx) => ctx.source(args.path), { kind: 'service', key: 'readMemorySource' }),
    operation('memory.read', 'Read named memory and archive', 'memory', workspace, read,
      { ...(tools.get('memory_read')?.parameters ?? {}), additionalProperties: false },
      tools.get('memory_read')?.output.schema ?? record,
      (args, ctx) => ctx.memoryTool('memory_read', args, { workspaceReadable: true }),
      { kind: 'tool', key: 'memory_read' },
      ({ liveAgent, workspacePaths }) => liveAgent || workspacePaths ? null : 'Select a DSH workspace'),
    viaRoute('memory.note', 'Append project note', 'memory', workspace, 'note', 'POST',
      object({ content, expectedNotesPath: text }, ['content', 'expectedNotesPath']), record,
      (args, ctx) => ({ ...args, ...(ctx.scope.sessionId ? { sessionId: ctx.scope.sessionId } : {}) })),
    operation('memory.calendar', 'Memory calendar', 'memory', global, read, empty,
      object({ entries: arrayOf(record), path: string }, ['entries', 'path']),
      (_, ctx) => ctx.calendar(), { kind: 'service', key: 'calendarEntriesPre' }),
    viaRoute('memory.calendar.add', 'Add a calendar entry', 'memory', global, 'calendar', 'POST',
      object({ date: calendarDate, time: string, title: text, note: string, quadrant: calendarPriority }, ['date', 'title']), record),
    ...['done', 'remove'].map(action => viaRoute('memory.calendar.' + action, action === 'done' ? 'Complete a calendar entry' : 'Remove a calendar entry',
      'memory', global, 'calendar', 'POST',
      { ...object({ id: text, date: text, time: string, title: text }), anyOf: [{ required: ['id'] }, { required: ['date', 'time', 'title'] }] },
      record,
      args => ({ ...args, action }))),
    viaRoute('memory.rules', 'User rules and revisions', 'memory', global, 'rules-list', 'GET', empty, record),
    viaRoute('memory.rules.edit', 'Edit a user rule', 'memory', global, 'rules-apply', 'POST',
      { ...object({ op: oneOfValues('add', 'update', 'remove'), index: integer(0, 1000000), expect: text, revision: text,
        text: content, dateSection: text, layer: oneOfValues('user') }, ['op', 'revision']),
      allOf: [
        { if: { properties: { op: { const: 'add' } } }, else: { required: ['index', 'expect'] } },
        { if: { properties: { op: { const: 'remove' } } }, else: { required: ['text'] } },
      ] },
      record),
    viaRoute('memory.hub', 'Memory hub and pending reviews', 'memory', global, 'memory-hub', 'GET', empty, record),
    viaRoute('memory.conflicts', 'Unresolved fact conflicts', 'memory', global, 'facts-conflicts', 'GET', empty, record),
    viaRoute('memory.conflicts.resolve', 'Resolve a fact conflict', 'memory', global, 'facts-conflicts', 'POST',
      object({ conflictId: text, choice: oneOfValues('left', 'right'), note: string }, ['conflictId', 'choice']), record,
      args => ({ ...args, action: 'resolve' })),
    viaRoute('memory.hub.review', 'Review a skill in the memory hub', 'memory', session, 'memory-hub', 'POST',
      { ...object({ procedureId: text, action: oneOfValues('approve', 'promote', 'force-promote', 'activate', 'deprecate', 'pin'), v: boolean },
        ['procedureId', 'action']), if: { properties: { action: { const: 'pin' } } }, else: { not: { required: ['v'] } } },
      record, sessionArgs),
    viaRoute('memory.external', 'External memory sources', 'memory', session, 'external', 'GET', empty, record, sessionArgs),
    viaRoute('memory.external.source', 'Read an external source preview', 'memory', 'optional-session', 'external-view', 'GET',
      object({ source: text }, ['source']), record, sessionArgs),
    viaRoute('memory.external.import', 'Import an external source', 'memory', session, 'external-import', 'POST',
      object({ source: text, target: oneOfValues('user', 'project') }, ['source', 'target']), record, sessionArgs),
    viaRoute('memory.external.remove', 'Remove an external import', 'memory', session, 'external-remove', 'POST',
      object({ source: text, target: oneOfValues('user', 'project') }, ['source', 'target']), record, sessionArgs),
    operation('memory.storage', 'Storage management overview', 'memory', workspace, read, empty, record,
      (_, ctx) => ctx.storage('scan', {}), { kind: 'service', key: 'storageManager.scanHealth' }),
    viaRoute('memory.migration.export', 'Export selected project memory', 'memory', session, 'migrate-export', 'POST',
      object({ outPath: text, compress: boolean }), record, workspaceArgs),
    operation('memory.migration.stage', 'Stage and validate a local migration package', 'memory', global, write,
      object({ packPath: text }, ['packPath']), object({ ok: boolean, path: string, bytes: integer(1, Number.MAX_SAFE_INTEGER) }, ['ok','path','bytes']),
      ({ packPath }, ctx) => ctx.stagePack(packPath), { kind: 'service', key: 'migrateUploadPre' }),
    viaRoute('memory.migration.inspect', 'Inspect a migration package', 'memory', session, 'migrate-inspect', 'POST',
      object(migrate, ['packPath']), record, migrateScope, read),
    viaRoute('memory.migration.import', 'Apply a checked migration package', 'memory', session, 'migrate-import', 'POST',
      object({ ...migrate, previewToken: text }, ['packPath', 'previewToken']), record, migrateScope),
    viaRoute('memory.delivery.preview', 'Delivery policy preview', 'memory', global, 'deliveryPreview', 'POST',
      object({ policy: record, tier: text, isHuman: boolean, isFull: boolean }), record, undefined, read),
    viaRoute('board.events.list', 'Events, timeline and checkpoints', 'board', workspace, 'event-list', 'GET', boardList,
      object({ ok: boolean, events: arrayOf(record), total: integer(0, Number.MAX_SAFE_INTEGER) }, [], true), sessionArgs),
    operation('board.events.detail', 'Event detail and checkpoint sources', 'board', workspace, read,
      object({ id: text }, ['id']), object({ ok: boolean, event: record, revision: key, _resolved: record }, ['ok', 'event', 'revision']),
      async (args, ctx) => projectBoardEventDetail(await ctx.route('event-detail', 'GET', sessionArgs(args, ctx))),
      { kind: 'route', key: 'event-detail', method: 'GET' }),
    operation('board.checkpoint.read', 'Verify and read a checkpoint source', 'board', workspace, read,
      { ...object({ eventId: { type: 'string', pattern: '^evt_[a-f0-9]{8}$' }, checkpointIndex: integer(0, Number.MAX_SAFE_INTEGER), idemKey: text },
        ['eventId']), oneOf: [{ required: ['checkpointIndex'] }, { required: ['idemKey'] }] },
      object({ eventId: string, checkpointIndex: integer(0, Number.MAX_SAFE_INTEGER), idemKey: { type: ['string', 'null'] },
        verified: boolean, code: string, text: string, source: oneOfValues('checkpoint', 'trusted-handoff') },
      ['eventId', 'checkpointIndex', 'verified', 'code', 'text', 'source'], true),
      (args, ctx) => ctx.checkpoint(args), { kind: 'service', key: 'readEventCheckpointPre' }),
    viaRoute('board.events.unarchived', 'Unarchived handoff records', 'board', workspace, 'event-unarchived', 'GET',
      object({ cursor: integer(0, Number.MAX_SAFE_INTEGER), limit: integer(1, 200) }), record, sessionArgs),
    viaRoute('board.kanban', 'Whiteboard lanes', 'board', workspace, 'kanban-board', 'GET',
      object({ includeArchive: flag, foldDays: integer(0, 3650), actor: text }), record, sessionArgs),
    viaRoute('board.card', 'Read the full whiteboard card', 'board', workspace, 'kanban-card', 'GET',
      object({ id: text }, ['id']), record, sessionArgs),
    viaRoute('board.ledger', 'Plan and handoff documents', 'board', workspace, 'handoff-state', 'GET',
      object({ file: text }), record, (args, ctx) => sessionArgs(workspaceArgs(args, ctx), ctx)),
    narrowTool('board.plan.update', 'Update a plan at its current revision', 'board', 'memory_note', tools, notePlan, {
      required: [], extra: { allOf: [
        { if: { required: ['cardId'] }, then: { required: ['expectedCardRevision', 'content'] }, else: { required: ['expectedRevision'] } },
        { if: { required: ['fromEvents'], properties: { fromEvents: { const: true } } }, else: { required: ['content'] } },
      ] },
    }, { kind: 'plan' }),
    narrowTool('board.document.write', 'Create or edit a maintenance document', 'board', 'memory_note', tools, noteDocument, {
      required: ['content', 'documentId'], extra: {
        if: { required: ['createDocument'], properties: { createDocument: { const: true } } },
        then: { required: ['eventId'] }, else: { required: ['expectedRevision'] },
      },
    }, { kind: 'handoff' }),
    viaRoute('board.curate.preview', 'Preview historical handoff curation', 'board', session, 'event-curate', 'POST',
      object({ limit: integer(1, 200) }), record, (args, ctx) => sessionArgs({ ...args, dryRun: true }, ctx), read),
    viaRoute('board.curate.propose', 'Generate curation candidates and confirmation token', 'board', session, 'event-curate', 'POST',
      object({ limit: integer(1, 200) }), record, sessionArgs),
    operation('board.curate.apply', 'Apply reviewed event curation', 'board', session, write,
      object({ candidateIds: { ...arrayOf(text), minItems: 1, maxItems: 200, uniqueItems: true }, confirmToken: text }, ['candidateIds', 'confirmToken']),
      record, (args, ctx) => ctx.curate(args), { kind: 'service', key: 'writeCuratedEventsPre' }),
    viaRoute('jobs.upgrade.status', 'Upgrade progress', 'jobs', session, 'upgrade-status', 'GET', empty, record, sessionArgs),
    viaRoute('jobs.upgrade.start', 'Start memory upgrade for a reviewed scope', 'jobs', session, 'memory-upgrade', 'POST',
      { ...object({
        model: text, effort: text, scope: { ...oneOfValues('current', 'subset', 'all'), default: 'current' },
        workspaceKeys: { ...arrayOf(text), minItems: 1, maxItems: 200, uniqueItems: true },
      }), if: { required: ['scope'], properties: { scope: { const: 'subset' } } },
      then: { required: ['workspaceKeys'] }, else: { not: { required: ['workspaceKeys'] } } },
      record, (args, ctx) => sessionArgs(workspaceArgs({ scope: 'current', ...args }, ctx), ctx)),
    viaRoute('jobs.upgrade.snooze', 'Snooze the selected workspace upgrade', 'jobs', session, 'upgrade-snooze', 'POST',
      empty, record, (args, ctx) => sessionArgs(workspaceArgs(args, ctx), ctx)),
    viaRoute('board.plan.archive', 'Archive the selected workspace plan', 'board', session, 'upgrade-archive-plan', 'POST',
      empty, record, (args, ctx) => sessionArgs(workspaceArgs(args, ctx), ctx)),
    viaRoute('jobs.engine.status', 'Engine setup progress', 'jobs', global, 'py-setup-status', 'GET', empty, record),
    viaRoute('jobs.engine.detect', 'Detect the Python engine', 'jobs', global, 'py-setup-detect', 'POST', empty, record),
    viaRoute('jobs.engine.venv', 'Create the engine environment', 'jobs', global, 'py-setup-venv', 'POST', empty, record),
    viaRoute('jobs.engine.dependencies', 'Install engine dependencies', 'jobs', global, 'py-setup-deps', 'POST',
      object({ gpu: boolean }), record),
    viaRoute('jobs.engine.model', 'Fetch engine model assets', 'jobs', global, 'py-setup-model', 'POST', empty, record),
    viaRoute('jobs.engine.configure', 'Repair the engine configuration', 'jobs', global, 'py-setup-config', 'POST', empty, record),
    viaRoute('jobs.engine.cancel', 'Cancel engine setup', 'jobs', global, 'py-setup-cancel', 'POST', empty, record),
    operation('jobs.maintain.start', 'Distill and archive old logs', 'jobs', session, write,
      object({ days: integer(1, 3650) }), record,
      (args, ctx) => ctx.startJob('jobs.maintain.start', () => ctx.tool('memory_maintain', args)),
      { kind: 'tool', key: 'memory_maintain' }, ({ liveAgent }) => liveAgent ? null : 'An active DSH session is required'),
    operation('jobs.get', 'Read a background job receipt', 'jobs', workspace, read,
      object({ id: text }, ['id']), record, ({ id }, ctx) => ctx.job(id), { kind: 'service', key: 'job' }),
    operation('external.lifecycle', 'Receive a bound host lifecycle event', 'harness', session, read,
      externalEventSchema, externalReceiptSchema, (event, ctx) => ctx.observeExternal(event),
      { kind: 'service', key: 'observeExternal' }),
    ...panelOperations({ route: viaRoute, service: operation }),
    ...boardToolOperations(operation),
    ...createMemoryToolOperations(tools),
  ].filter(Boolean)

  const table = new Map()
  for (const op of operations) {
    if (table.has(op.id)) throw new Error('Duplicate operation ' + op.id)
    const { source } = op
    if (source.kind === 'route') {
      if (!routes.has(api[source.key])) throw new Error(op.id + ' has no registered route ' + source.key)
      source.path = api[source.key]
    }
    if (source.kind === 'tool' && !tools.has(source.key)) throw new Error(op.id + ' has no registered tool ' + source.key)
    checkSchema(op.inputSchema, op.id + '.input')
    checkSchema(op.resultSchema, op.id + '.result')
    table.set(op.id, op)
  }
  return table
}
