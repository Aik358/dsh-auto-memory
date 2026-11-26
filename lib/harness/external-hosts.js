import { realpathSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { CLOUD_CODE_HOOK_EVENTS, KIMI_HOOK_EVENTS, normalizeKimiHookInput } from './kimi.js'
import { ANTIGRAVITY_HOOK_EVENTS } from './antigravity.js'

const HOSTS = Object.freeze({
  codex: Object.freeze(['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact', 'Stop', 'SessionEnd']),
  zcode: Object.freeze(['SessionStart', 'UserPromptSubmit', 'Stop']),
  claude: Object.freeze(['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact']),
  kimi: KIMI_HOOK_EVENTS,
  'cloud-code': CLOUD_CODE_HOOK_EVENTS,
  antigravity: ANTIGRAVITY_HOOK_EVENTS,
  opencode: Object.freeze(['SessionStart', 'UserPromptSubmit', 'PreInvocation', 'Stop', 'PreCompact', 'PostCompact']),
})
export const EXTERNAL_HARNESSES = Object.freeze(Object.keys(HOSTS))
const CONTEXT_EVENTS = new Set(['SessionStart', 'UserPromptSubmit', 'PreInvocation'])
export const EXTERNAL_TOOLS = Object.freeze({
  status: 'status',
  memory_list: 'memory.list',
  memory_recall: 'memory.recall',
})
const TOOL_OPERATIONS = new Set(Object.values(EXTERNAL_TOOLS))
const MAX_CONTEXT_BYTES = 16_000

export class ExternalHostError extends Error {
  constructor(code) {
    super(code)
    this.name = 'ExternalHostError'
    this.code = code
  }
}

function canonicalWorkspace(workspace) {
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) {
    throw new ExternalHostError('workspace-unbound')
  }
  try {
    return realpathSync.native(workspace)
  } catch {
    throw new ExternalHostError('workspace-unbound')
  }
}

function readHostField(payload, snake, camel) {
  const value = payload[snake] ?? payload[camel]
  if (payload[snake] != null && payload[camel] != null && payload[snake] !== payload[camel]) {
    throw new ExternalHostError('invalid-hook-event')
  }
  return value
}

function validId(value) {
  return typeof value === 'string' && /^[\w.:-]{1,200}$/u.test(value)
}

export function getExternalHostEvents(harness) {
  if (!Object.hasOwn(HOSTS, harness)) throw new ExternalHostError('unsupported-harness')
  return HOSTS[harness]
}

export function createExternalAdapter({ harness, workspace, workspaceRef, dshSessionId, profile, connection, lifecycle }) {
  const events = getExternalHostEvents(harness)
  const root = canonicalWorkspace(workspace)
  if (!workspaceRef || typeof workspaceRef !== 'string' || !validId(dshSessionId) ||
      !profile || typeof profile !== 'string' ||
      typeof connection?.discover !== 'function' || typeof connection?.call !== 'function') {
    throw new ExternalHostError('binding-unavailable')
  }
  const boundScope = Object.freeze({ workspace: workspaceRef, sessionId: dshSessionId })
  const boundHost = Object.freeze({ harness, workspace: root })
  let pinnedInstance

  function checkScope(requested) {
    if (requested === undefined) return
    if (!requested || typeof requested !== 'object' || Array.isArray(requested) ||
        Object.keys(requested).some(key => key !== 'workspace') ||
        (Object.hasOwn(requested, 'workspace') && requested.workspace !== workspaceRef)) {
      throw new ExternalHostError('scope-forbidden')
    }
  }

  function assertWorkspace(cwd) {
    if (canonicalWorkspace(cwd) !== root) throw new ExternalHostError('scope-forbidden')
  }

  async function discover({ signal, scope } = {}) {
    checkScope(scope)
    const manifest = await connection.discover({ signal, scope: boundScope })
    if (manifest?.contractVersion !== '1.0' || !Array.isArray(manifest.operations)) {
      throw new ExternalHostError('contract-unsupported')
    }
    const identity = manifest.identity
    if (identity?.harness !== 'dsh' || identity.profile !== profile || !validId(identity.instanceId)) {
      throw new ExternalHostError('instance-unverified')
    }
    if (pinnedInstance && pinnedInstance !== identity.instanceId) {
      throw new ExternalHostError('instance-changed')
    }
    pinnedInstance = identity.instanceId
    const operations = manifest.operations.filter(operation =>
      TOOL_OPERATIONS.has(operation?.id) && operation.access === 'read' &&
      operation.approval === 'none' && operation.status === 'available' &&
      (['workspace', 'session'].includes(operation.scope) ||
        (operation.id === 'status' && ['instance', 'optional-session'].includes(operation.scope))) &&
      operation.inputSchema?.type === 'object').map(operation => {
      if (operation.id !== 'memory.recall') return operation
      const { query, limit, format } = operation.inputSchema.properties ?? {}
      const properties = Object.fromEntries(Object.entries({ query, limit, format }).filter(([, schema]) => schema))
      return { ...operation, inputSchema: {
        type: 'object', properties, required: ['query'], additionalProperties: false,
      } }
    })
    return { contractVersion: '1.0', mode: harness, boundHost, identity, operations, manifestVersion: manifest.manifestVersion,
      scope: { workspace: workspaceRef } }
  }

  async function call(id, args = {}, { signal, scope, instanceId } = {}) {
    checkScope(scope)
    const manifest = await discover({ signal })
    if (instanceId !== undefined && instanceId !== manifest.identity.instanceId) {
      throw new ExternalHostError('instance-changed')
    }
    const operation = manifest.operations.find(operation => operation.id === id)
    if (!operation) {
      throw new ExternalHostError('operation-unavailable')
    }
    const keys = id === 'memory.recall' ? ['query', 'limit', 'format'] : []
    if (!args || typeof args !== 'object' || Array.isArray(args) ||
        Object.keys(args).some(key => !keys.includes(key))) {
      throw new ExternalHostError('invalid-input')
    }
    const input = id === 'memory.recall' ? { ...args, scope: 'current' } : args
    const result = await connection.call(id, input, { signal, scope: boundScope, instanceId: manifest.identity.instanceId })
    if (id !== 'status' || !result || !Object.hasOwn(result, 'activeWorkspaces')) return result
    const { activeWorkspaces, ...scopedStatus } = result
    return scopedStatus
  }

  async function handleHook(payload, { signal, hookEventName } = {}) {
    if (harness === 'kimi') payload = normalizeKimiHookInput(payload)
    if (harness === 'antigravity') {
      if (!Array.isArray(payload.workspacePaths) || payload.workspacePaths.length !== 1) {
        throw new ExternalHostError('invalid-hook-event')
      }
      payload = { hook_event_name: hookEventName, session_id: payload.conversationId, cwd: payload.workspacePaths[0] }
    }
    const name = readHostField(payload, 'hook_event_name', 'hookEventName')
    if (!events.includes(name)) throw new ExternalHostError('invalid-hook-event')
    assertWorkspace(payload.cwd)
    const sessionId = readHostField(payload, 'session_id', 'sessionId')
    const turnId = readHostField(payload, 'turn_id', 'turnId')
    if (!validId(sessionId) || (turnId !== undefined && !validId(turnId))) {
      throw new ExternalHostError('invalid-hook-event')
    }
    const source = name === 'SessionStart' ? payload.source : undefined
    const trigger = name === 'PreCompact' || name === 'PostCompact' ? payload.trigger : undefined
    const event = {
      harness,
      name,
      sessionId,
      ...(turnId ? { turnId } : {}),
      ...(['startup', 'resume', 'clear', 'compact', 'fork'].includes(source) ? { source } : {}),
      ...(['manual', 'auto'].includes(trigger) ? { trigger } : {}),
    }
    if (!lifecycle) return { status: 'lifecycle-unavailable', event }

    const { identity } = await discover({ signal })
    const result = await lifecycle(event, { signal, scope: boundScope, instanceId: identity.instanceId })
    const status = ['accepted', 'duplicate', 'out-of-order', 'unavailable'].includes(result?.status)
      ? result.status : 'unavailable'
    // The live executor claims each injection atomically across short-lived hook processes.
    const context = result?.context
    if (status !== 'accepted' || !CONTEXT_EVENTS.has(name) || typeof context !== 'string' ||
        !context || Buffer.byteLength(context) > MAX_CONTEXT_BYTES) return { status, event }
    return { status, event, output: { hookSpecificOutput: { hookEventName: name, additionalContext: context } } }
  }

  return Object.freeze({ harness, mode: harness, boundHost, events, assertWorkspace, discover, call, handleHook })
}
