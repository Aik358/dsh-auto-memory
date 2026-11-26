import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathKey } from '../file-boundary.js'
import { ContractError, integer, object, oneOfValues, revisionOf, scopeSchema, text, validate } from './contract.js'
import { projectConfig } from './settings.js'

const routes = {
  'settings.get': { title: 'Settings', group: 'settings', scope: 'global', route: 'config' },
  'memory.list': { title: 'Project notes, logs and reflections', group: 'memory', scope: 'workspace', route: 'list' },
  'memory.source': {
    title: 'Read project memory', group: 'memory', scope: 'workspace', route: 'file',
    inputSchema: object({ path: text }, ['path']),
  },
  'board.events.list': {
    title: 'Events and timeline', group: 'board', scope: 'workspace', route: 'event-list', needsSession: true,
    inputSchema: object({ all: oneOfValues(0, 1), cursor: integer(0, Number.MAX_SAFE_INTEGER),
      limit: integer(1, 200), status: oneOfValues('active', 'paused', 'closed') }),
  },
  'board.events.detail': {
    title: 'Event detail', group: 'board', scope: 'workspace', route: 'event-detail', needsSession: true,
    inputSchema: object({ id: text }, ['id']),
  },
  'status': { title: 'Connection status', group: 'system', scope: 'global' },
  'system.workspaces': { title: 'DSH workspaces', group: 'system', scope: 'global' },
}

async function localRegistry(home, request, signal) {
  const { path: config } = await request('config', {}, signal)
  if (typeof config !== 'string' || !path.isAbsolute(config) || pathKey(path.dirname(config)) !== pathKey(home)) {
    throw new ContractError('legacy-home-mismatch', 'The installed plugin does not confirm this DSH home', 409)
  }
  const file = path.join(home, 'storages', 'workspace.json')
  try {
    const stat = await lstat(file)
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new Error('Invalid registry file')
    const { unit, global, tables } = JSON.parse(await readFile(file, { encoding: 'utf8', signal }))
    if (unit?.name !== 'workspace' || unit.version !== 2 || global?.initialized !== true ||
        !Array.isArray(global.workspaceIds) || !tables?.workspaces) throw new Error('Unknown registry schema')
    return global.workspaceIds.flatMap(workspaceId => {
      const record = Object.hasOwn(tables.workspaces, workspaceId) && tables.workspaces[workspaceId]
      if (typeof record?.path !== 'string' || !path.isAbsolute(record.path) || !Array.isArray(record.sessionIds)) return []
      return [{ ...record, workspaceId }]
    })
  } catch (error) {
    signal?.throwIfAborted()
    throw new ContractError('legacy-registry-unavailable', 'Could not read the registered workspaces for this DSH home', 503)
  }
}

async function workspaceBaseline(origin, headers, signal) {
  const url = new URL('/api/remote.mux', origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const streamId = randomUUID()
  signal.throwIfAborted()
  const socket = new WebSocket(url, { headers })
  try {
    return await new Promise((resolve, reject) => {
      const listeners = new AbortController()
      const options = { signal: listeners.signal }
      const finish = (callback, value) => {
        listeners.abort()
        callback(value)
      }
      const failed = () => finish(reject, new ContractError('legacy-workspaces-unavailable',
        'The DSH workspace feed ended before returning an authorized workspace list', 503))
      signal.addEventListener('abort', () => finish(reject, signal.reason), options)
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'open', streamId, endpoint: 'workspace/follow', payload: { args: {} } }))
        socket.send(JSON.stringify({ type: 'end', streamId }))
      }, options)
      socket.addEventListener('error', failed, options)
      socket.addEventListener('close', failed, options)
      socket.addEventListener('message', ({ data }) => {
        try {
          const message = JSON.parse(data)
          if (message.streamId !== streamId) return
          const items = message.value?.value?.items
          if (message.type === 'item' && message.value?.type === 'baseline' && Array.isArray(items)) finish(resolve, items)
          else if (message.type === 'end' || message.type === 'error') failed()
        } catch { failed() }
      }, options)
    })
  } finally {
    socket.close()
  }
}

export function createLegacyClient({ origin, headers, profile, home, request }) {
  const identity = { instanceId: randomUUID(), harness: 'dsh', profile, origin }
  let cached
  let refreshAfter = 0

  async function registry(signal) {
    if (!cached || Date.now() >= refreshAfter) {
      cached = await (home ? localRegistry(home, request, signal) : workspaceBaseline(origin, headers, signal))
      refreshAfter = Date.now() + 10000
    }
    return cached
  }

  function selection(scope, entries) {
    validate(scope, scopeSchema)
    if (!Object.keys(scope).length) return { scope }
    const workspace = entries.find(entry => path.isAbsolute(entry.path ?? '') &&
      (!scope.workspace || pathKey(entry.path) === pathKey(scope.workspace)) &&
      (!scope.workspaceRef || entry.workspaceId === scope.workspaceRef) &&
      (!scope.sessionId || entry.sessionIds?.includes(scope.sessionId)))
    if (!workspace) throw new ContractError('workspace-not-found', 'Select a workspace or session from the DSH workspace list', 404)
    return {
      scope: { workspace: workspace.path, workspaceRef: workspace.workspaceId, ...(scope.sessionId && { sessionId: scope.sessionId }) },
      sessionId: scope.sessionId || workspace.sessionIds?.[0],
    }
  }

  function availability(spec, selected) {
    if (spec.scope === 'workspace' && !selected.scope.workspace) return 'Select a workspace'
    if (spec.needsSession && !selected.sessionId) return 'This plugin route requires a session in the selected workspace'
    return ''
  }

  async function memoryList(workspace, signal) {
    const value = await request('list', { ws: workspace }, signal)
    if (value.wsBound !== true || typeof value.ws !== 'string' || pathKey(value.ws) !== pathKey(workspace)) {
      throw new ContractError('workspace-mismatch', 'The installed plugin did not verify the selected workspace', 409)
    }
    if (!Array.isArray(value.logs) || !Array.isArray(value.reflections)) {
      throw new ContractError('invalid-response', 'The installed plugin returned an invalid memory list', 502)
    }
    return value
  }

  async function discover({ scope = {}, signal } = {}) {
    const selected = selection(scope, await registry(signal))
    const operations = Object.entries(routes).map(([id, spec]) => {
      const { title, group, scope, inputSchema = object() } = spec
      const reason = availability(spec, selected)
      return { id, title, group, scope, inputSchema, access: 'read', status: reason ? 'unavailable' : 'available',
        ...(reason && { reason }) }
    })
    return { identity, mode: 'dsh-legacy', contractVersion: '1.0', manifestVersion: 'legacy-read-1', scope: selected.scope, operations }
  }

  async function call(id, args = {}, { scope = {}, signal, instanceId } = {}) {
    if (instanceId && instanceId !== identity.instanceId) throw new ContractError('instance-changed', 'The selected instance changed', 409)
    const spec = Object.hasOwn(routes, id) && routes[id]
    if (!spec) throw new ContractError('operation-unavailable', 'The installed plugin does not expose this operation through legacy compatibility', 409)
    validate(args, spec.inputSchema ?? object())
    const entries = await registry(signal)
    const selected = selection(scope, entries)
    const reason = availability(spec, selected)
    if (reason) throw new ContractError('operation-unavailable', reason, 409)
    if (id === 'system.workspaces') return { workspaces: entries.filter(entry => path.isAbsolute(entry.path ?? '')).map(entry => ({
      workspace: entry.path, workspaceRef: entry.workspaceId, title: entry.title,
    })) }
    if (id === 'status') {
      const result = { connection: 'ready', mode: 'dsh-legacy', scope: selected.scope, identity }
      return { ...result, revision: revisionOf(result) }
    }
    if (id === 'memory.list') return memoryList(selected.scope.workspace, signal)
    if (id === 'memory.source') {
      const listing = await memoryList(selected.scope.workspace, signal)
      const paths = ['MEMORY.md', ...listing.logs.map(entry => entry.name),
        ...listing.reflections.map(entry => 'reflections/' + entry.name)]
      if (!paths.includes(args.path) || !/^(?:reflections\/)?[^/\\:]+\.md$/u.test(args.path) ||
          typeof listing.projectDir !== 'string' || !path.isAbsolute(listing.projectDir)) {
        throw new ContractError('source-unavailable', 'Choose a source listed for the selected workspace', 404)
      }
      const expected = path.resolve(listing.projectDir, args.path)
      const value = await request('file', { path: expected, ...(selected.sessionId && { sessionId: selected.sessionId }) }, signal)
      if (typeof value.path !== 'string' || pathKey(value.path) !== pathKey(expected) || typeof value.content !== 'string') {
        throw new ContractError('source-mismatch', 'The plugin returned a different memory source', 409)
      }
      return value
    }
    const query = { ...args }
    if (spec.needsSession) query.sessionId = selected.sessionId
    const value = await request(spec.route, query, signal)
    if (id.startsWith('board.events.') &&
        (value._resolved?.sessionId !== selected.sessionId || value._resolved?.sidExplicit !== true ||
          pathKey(value._resolved?.ws ?? '') !== pathKey(selected.scope.workspace))) {
      throw new ContractError('workspace-mismatch', 'The installed plugin did not verify the selected event scope', 409)
    }
    if (id === 'settings.get') {
      const config = projectConfig(value.config ?? {})
      return { config, revision: revisionOf(config) }
    }
    return value
  }

  return { discover, call }
}
