import { createInterface } from 'node:readline'
import { EXTERNAL_TOOLS, ExternalHostError } from './external-hosts.js'

const VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'])
const TOOL_NAMES = new Map(Object.entries(EXTERNAL_TOOLS))
const MAX_LINE_BYTES = 1024 * 1024

function errorCode(error) {
  return error instanceof ExternalHostError ? error.code : 'live-api-unavailable'
}

export async function serveExternalMcp(adapter, { input = process.stdin, output = process.stdout } = {}) {
  const pending = new Map()
  const lines = createInterface({ input, crlfDelay: Infinity })
  let protocolVersion
  let ready = false
  const reply = (id, fields) => output.write(JSON.stringify({ jsonrpc: '2.0', id, ...fields }) + '\n')
  const invalid = (id, code, message) => reply(id, { error: { code, message } })

  async function dispatch({ id, method, params }, signal, cancelled) {
    if (method === 'initialize') {
      if (protocolVersion || typeof params?.protocolVersion !== 'string') {
        return invalid(id, -32602, 'Invalid initialization')
      }
      protocolVersion = VERSIONS.has(params.protocolVersion) ? params.protocolVersion : '2025-11-25'
      return reply(id, {
        result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'auto-memory', version: '1.0' } },
      })
    }
    if (method === 'ping') return reply(id, { result: {} })
    if (!ready) return invalid(id, -32002, 'Initialize the MCP session first')

    if (method === 'tools/list') {
      const { operations } = await adapter.discover({ signal })
      const tools = []
      for (const [name, id] of TOOL_NAMES) {
        const operation = operations.find(item => item.id === id)
        if (operation) tools.push({
          name,
          description: operation.title,
          inputSchema: operation.inputSchema,
          annotations: { readOnlyHint: true },
        })
      }
      if (!cancelled.aborted) reply(id, { result: { tools } })
      return
    }
    if (method === 'tools/call') {
      const operationId = TOOL_NAMES.get(params?.name)
      const args = params?.arguments ?? {}
      if (!operationId || typeof args !== 'object' || Array.isArray(args)) {
        return invalid(id, -32602, 'Unknown tool or malformed arguments')
      }
      let result
      try {
        const data = await adapter.call(operationId, args, { signal })
        result = { content: [{ type: 'text', text: JSON.stringify(data ?? null) }] }
      } catch (error) {
        result = { isError: true, content: [{ type: 'text', text: errorCode(error) }] }
      }
      if (!cancelled.aborted) reply(id, { result })
      return
    }
    invalid(id, -32601, 'Method not found')
  }

  try {
    for await (const line of lines) {
      if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
        invalid(null, -32600, 'MCP message exceeds size limit')
        continue
      }
      let request
      try {
        request = JSON.parse(line)
      } catch {
        invalid(null, -32700, 'Malformed JSON')
        continue
      }
      if (request?.jsonrpc !== '2.0' || typeof request.method !== 'string') {
        invalid(null, -32600, 'Invalid MCP request')
        continue
      }
      const { id, method, params } = request
      if (id === undefined) {
        if (method === 'notifications/initialized' && protocolVersion) ready = true
        if (method === 'notifications/cancelled') pending.get(params?.requestId)?.abort()
        continue
      }
      if ((typeof id !== 'string' && typeof id !== 'number') || pending.has(id)) {
        invalid(null, -32600, 'Invalid or duplicate MCP request ID')
        continue
      }
      const controller = new AbortController()
      pending.set(id, controller)
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)])
      dispatch(request, signal, controller.signal).catch(error => {
        if (!controller.signal.aborted) invalid(id, -32000, errorCode(error))
      }).finally(() => pending.delete(id))
    }
  } finally {
    for (const controller of pending.values()) controller.abort()
  }
}
