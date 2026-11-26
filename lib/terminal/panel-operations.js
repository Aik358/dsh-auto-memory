import { arrayOf, boolean, integer, object, oneOfValues, record, string, text } from './contract.js'

const target = 'session'
const owner = 'instance'
const empty = object()
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }
const sessionArgs = (args, ctx) => ({ ...args, sessionId: ctx.scope.sessionId })
const workspaceArgs = (args, ctx) => ({ ...args, ws: ctx.scope.workspace })
const action = name => args => ({ ...args, action: name })
const select = (result, keys) => Object.fromEntries(keys.filter(key => result[key] !== undefined).map(key => [key, result[key]]))

export function panelOperations({ route, service }) {
  return [
    route('memory.recall.semantic', 'Context-aware memory search', 'memory', target, 'smartRecall', 'POST',
      object({ query: { ...text, maxLength: 4000 } }, ['query']), record, sessionArgs, 'read'),
    route('memory.recall.metrics', 'Recall statistics', 'memory', owner, 'recallStats', 'GET', empty, record),
    service('memory.recall.metrics.reset', 'Reset recall statistics', 'memory', owner, 'write', empty, record,
      (_, ctx) => ctx.route('recallStats', 'POST', {}, { reset: 1 }), { kind: 'route', key: 'recallStats', method: 'POST' }),
    route('memory.brief', 'Global brief and watched sources', 'memory', target, 'global-brief', 'GET', empty, record, sessionArgs),
    route('memory.notices', 'Plugin notices', 'memory', owner, 'notices', 'GET', empty, record),
    route('memory.greet', 'Generate the workspace greeting', 'memory', target, 'greet', 'POST', empty, record, workspaceArgs),
    route('memory.reflection.save', 'Save a daily reflection', 'memory', target, 'reflect', 'POST',
      object({ date, text }, ['date', 'text']), record, sessionArgs),
    route('memory.reflection.generate', 'Generate a daily reflection', 'memory', target, 'reflect-auto', 'POST', empty, record, sessionArgs),
    route('memory.summary.generate', 'Generate a period summary', 'memory', target, 'summarize', 'POST',
      object({ period: text, force: boolean }, ['period']), record, workspaceArgs),
    route('memory.review.recent', 'Recent review observations', 'memory', owner, 'shadow-recent', 'GET', empty, record),
    route('memory.review.queue', 'Review feedback queue', 'memory', owner, 'review-feedback', 'GET', empty, record),
    route('memory.review.submit', 'Submit a review decision', 'memory', owner, 'review-feedback', 'POST',
      object({ observationId: text, choice: oneOfValues('A', 'P', 'S', 'H', 'E'), targetMemoryId: text },
        ['observationId', 'choice']), record),
    route('system.directory.browse', 'Browse local directories', 'system', owner, 'browseDir', 'POST',
      object({ path: text }), record, undefined, 'read'),
    route('system.directory.pick', 'Open the host directory picker', 'system', owner, 'pickDir', 'POST', empty, record),
    route('system.update.check', 'Check Auto Memory updates', 'system', owner, 'updateCheck', 'GET',
      object({ force: oneOfValues(0, 1) }), record),
    service('system.update.install', 'Install the checked plugin update', 'system', owner, 'write', empty,
      object({ ok: boolean, landedVersion: string, targetVersion: string, restartHint: string, installKind: string }, ['ok']),
      async (_, ctx) => select(await ctx.route('update', 'POST', {}), ['ok', 'landedVersion', 'targetVersion', 'restartHint', 'installKind']),
      { kind: 'route', key: 'update', method: 'POST' }),
    route('memory.storage.dirty', 'Scan the selected workspace for dirty memory', 'memory', target, 'scanDirty', 'GET', empty, record, sessionArgs),
    service('memory.storage.diagnostics', 'Inspect plugin storage diagnostics', 'memory', owner, 'write', empty, record,
      async (_, ctx) => {
        const report = await ctx.route('debug', 'GET', {})
        return {
          deliveryMode: report.deliveryMode?.mode || null,
          heartbeat: { exists: report.heartbeat?.exists === true },
          proxyCompaction: select(report.proxyCompaction || {}, ['enabled', 'detected', 'reason']),
          rulesBudget: report.associativeMemory?.rulesBudget || null,
          storage: report.memoryFiles || {},
          budgets: report.budgets || {},
          maintenance: select(report.autoConsolidate || {}, ['enabled', 'consolidating', 'pendingQueue', 'callCountToday']),
        }
      }, { kind: 'route', key: 'debug', method: 'GET' }),
    route('system.engine.detect', 'Probe the semantic engine', 'system', owner, 'semantic-deep-detect', 'GET',
      empty, record, undefined, 'write'),
    route('settings.engine.activation', 'Save semantic activation mode', 'settings', owner, 'semantic-emit', 'POST',
      object({ mode: oneOfValues('shadow', 'canary-explicit', 'active'), createOnly: boolean }, ['mode']), record),
    route('jobs.engine.download.start', 'Download semantic engine assets', 'jobs', owner, 'semantic-download', 'POST',
      object({ mirror: oneOfValues('auto', 'cn', 'intl') }), record, action('start')),
    route('jobs.engine.download.cancel', 'Cancel the semantic asset download', 'jobs', owner, 'semantic-download', 'POST',
      empty, record, action('cancel')),
    route('jobs.engine.uninstall', 'Uninstall the Python engine', 'jobs', owner, 'py-setup-uninstall', 'POST', empty, record),
    route('jobs.workbench.status', 'Memory workbench status', 'jobs', owner, 'workbench', 'POST', empty, record, undefined, 'read'),
    route('jobs.workbench.setup', 'Create or repair the memory workbench', 'jobs', owner, 'workbench', 'POST', empty, record, action('setup')),
    route('board.continue.status', 'Automatic continuation status', 'board', target, 'auto-continue-state', 'GET', empty, record, sessionArgs),
    route('board.continue.preview', 'Review the handoff material for this conversation', 'board', target, 'handoff-continue', 'POST',
      empty, record, (_, ctx) => ({ fromSessionId: ctx.scope.sessionId })),
    service('board.continue.permissions', 'Inherit the selected conversation permission preset', 'board', target, 'write',
      object({ successorId: text }, ['successorId']), record,
      ({ successorId }, ctx) => ctx.inheritPermission(successorId),
      { kind: 'service', key: 'inheritPermissionForContinue' }),
    service('board.continue.decide', 'Handle an automatic continuation request', 'board', target, 'write',
      { ...object({ action: oneOfValues('agree', 'reject', 'cancel', 'manual'), edgeAt: integer(0, Number.MAX_SAFE_INTEGER) }, ['action']),
        if: { properties: { action: { const: 'manual' } } }, else: { required: ['edgeAt'] } },
      record, (args, ctx) => ctx.continueSession(args), { kind: 'service', key: 'decideAutoContinue' }),
    route('jobs.upgrade.workspaces', 'List workspace upgrade scope and cost', 'jobs', target, 'upgrade-workspaces', 'GET',
      object({ effort: text, scope: oneOfValues('all', 'current', 'subset') }), record, (args, ctx) => sessionArgs(workspaceArgs(args, ctx), ctx)),
    route('team.status', 'Team memory and synchronization status', 'team', owner, 'teamState', 'GET', empty, record),
    route('team.sync.debug', 'Team subsystem diagnostics', 'team', owner, 'teamSyncDebug', 'GET', empty, record),
    service('team.sync.diagnostics', 'Team synchronization diagnostics', 'team', owner, 'read', empty, record,
      async (_, ctx) => {
        const state = await ctx.route('teamState', 'GET', {})
        return { enabled: state.enabled === true, transportReady: state.transport?.ready === true,
          sync: state.sync ? { running: state.sync.running === true, hasError: Boolean(state.sync.lastError) } : null,
          outbox: state.outbox ? { size: state.outbox.size, hasError: !!state.outbox.lastError } : null }
      }, { kind: 'route', key: 'teamState', method: 'GET' }),
    ...[
      ['members', 'Members', 'teamMembers'], ['presence', 'Member presence', 'teamPresence'],
      ['attribution', 'Attribution', 'teamAttribution'], ['conflicts', 'Conflicts', 'teamConflicts'],
      ['handoffs', 'Handoffs', 'teamHandoffs'], ['skills', 'Skills', 'teamSkills'],
      ['compliance', 'Compliance', 'teamCompliance'],
    ].map(([id, title, key]) => route('team.' + id, title, 'team', owner, key, 'GET', empty, record)),
    service('team.pause', 'Pause or resume team synchronization', 'team', owner, 'write',
      object({ paused: boolean, reason: string }, ['paused']), object({ ok: boolean, paused: boolean, reason: string }, ['ok', 'paused']),
      async (args, ctx) => select(await ctx.route('teamPause', 'POST', args), ['ok', 'paused', 'reason']),
      { kind: 'route', key: 'teamPause', method: 'POST' }),
    route('team.cursor.reset', 'Reset the team synchronization cursor', 'team', owner, 'teamControl', 'POST',
      empty, record, () => ({ action: 'reset-cursor', confirm: true })),
    route('team.pause.runtime', 'Temporarily pause or resume the current team runtime', 'team', owner, 'teamControl', 'POST',
      object({ paused: boolean }, ['paused']), record, action('pause')),
    route('team.baseline.status', 'Available team baseline', 'team', owner, 'teamBaseline', 'GET', empty, record),
    route('team.baseline.search', 'Search for a team baseline', 'team', target, 'teamBaseline', 'POST',
      empty, record, (args, ctx) => workspaceArgs(action('search-remote')(args), ctx)),
    route('team.baseline.upload', 'Publish a team baseline', 'team', target, 'teamBaseline', 'POST',
      object({ uploadAfterUpgrade: boolean }), record, (args, ctx) => workspaceArgs(action('upload')(args), ctx)),
    route('team.baseline.apply', 'Apply a reviewed team baseline', 'team', target, 'teamBaseline', 'POST',
      object({ expectedChecksum: text }, ['expectedChecksum']), record, (args, ctx) => workspaceArgs(action('apply')(args), ctx)),
    route('team.skills.transfer', 'Move a reviewed skill between scopes', 'team', target, 'memory-hub', 'POST',
      object({ procedureId: text, scope: oneOfValues('global', 'workspace') }, ['procedureId', 'scope']), record, action('transfer-scope')),
    service('memory.storage.repair', 'Repair selected memory index entries', 'memory', target, 'write',
      object({ items: { ...arrayOf(object({ file: text }, ['file'])), minItems: 1, maxItems: 200 } }),
      record, (args, ctx) => ctx.storage('repair', args), { kind: 'service', key: 'storageManager.repair' }),
    service('memory.storage.delete', 'Delete a memory entry by digest', 'memory', target, 'write',
      object({ filePath: text, memoryId: text, expectedDigest: text }, ['filePath', 'memoryId', 'expectedDigest']),
      record, (args, ctx) => ctx.storage('delete', args), { kind: 'service', key: 'storageManager.deleteMemory' }),
  ]
}
