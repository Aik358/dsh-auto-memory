import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { createExternalAdapter, getExternalHostEvents } from '../../lib/harness/external-hosts.js'

const mcpURL = new URL('../../lib/harness/external-mcp.js', import.meta.url).href
const adapterURL = new URL('../../lib/harness/external-hosts.js', import.meta.url).href
const root = mkdtempSync(path.join(tmpdir(), 'dam-external-contract-'))
const workspace = path.join(root, 'project')
const other = path.join(root, 'other')
mkdirSync(workspace)
mkdirSync(other)
process.on('exit', () => rmSync(root, { recursive: true, force: true }))
const identity = { instanceId: 'dsh-instance', harness: 'dsh', profile: 'isolated', pluginVersion: 'test', buildId: 'test' }
const scope = { workspace, sessionId: 'dsh-session' }
const base = {
  scope: 'session', access: 'read', approval: 'none', status: 'available', group: 'memory',
  title: 'Test operation', inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  resultSchema: { type: 'object' },
}
const operations = [
  { ...base, id: 'status', scope: 'optional-session' },
  { ...base, id: 'memory.list' },
  { ...base, id: 'memory.recall' },
  { ...base, id: 'memory.write', access: 'write' },
]
const manifest = { contractVersion: '1.0', identity, operations }
const init = { harness: 'codex', workspace, workspaceRef: workspace, dshSessionId: scope.sessionId, profile: identity.profile }

test('discovery and calls use only the explicit DSH binding and a pinned instance', async () => {
  const calls = []
  let live = manifest
  const adapter = createExternalAdapter({
    ...init,
    connection: {
      discover: async options => {
        assert.deepEqual(options.scope, scope)
        return live
      },
      call: async (...args) => {
        calls.push(args)
        return args[0] === 'status' ? { ok: true, activeWorkspaces: [{ workspace: other, activities: { turn: 1 } }] } : { ok: true }
      },
    },
  })
  const result = await adapter.discover({ scope: { workspace } })
  assert.equal(adapter.mode, 'codex')
  assert.equal(result.mode, adapter.mode)
  assert.deepEqual(result.boundHost, adapter.boundHost)
  assert.equal(result.boundHost.harness, 'codex')
  assert.equal(result.identity.harness, 'dsh')
  assert.deepEqual(result.operations.map(op => op.id), ['status', 'memory.list', 'memory.recall'])
  assert.deepEqual(Object.keys(result.operations[2].inputSchema.properties), ['query'])
  await assert.rejects(adapter.call('memory.write'), { code: 'operation-unavailable' })
  await assert.rejects(adapter.call('memory.recall', { query: 'test', scope: 'all' }), { code: 'invalid-input' })
  await assert.rejects(adapter.call('status', {}, { scope: { sessionId: 'external-id' } }), { code: 'scope-forbidden' })
  await assert.rejects(adapter.call('status', {}, { scope: { workspace: other } }), { code: 'scope-forbidden' })
  assert.deepEqual(await adapter.call('memory.recall', { query: 'test' }), { ok: true })
  assert.deepEqual(calls, [['memory.recall', { query: 'test', scope: 'current' }, { scope, instanceId: identity.instanceId, signal: undefined }]])
  assert.deepEqual(await adapter.call('status'), { ok: true })
  live = { ...manifest, identity: { ...identity, instanceId: 'replacement' } }
  await assert.rejects(adapter.discover(), { code: 'instance-changed' })
  assert.equal(calls.length, 2)
})

test('Claude registers the verified hooks and preserves host compaction metadata', async () => {
  assert.deepEqual(getExternalHostEvents('claude'), ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact'])
  let received
  const adapter = createExternalAdapter({
    ...init, harness: 'claude',
    connection: { discover: async () => manifest, call: async () => {} },
    async lifecycle(event) { received = event; return { status: 'accepted' } },
  })
  const payload = { cwd: workspace, hook_event_name: 'PreCompact', session_id: 'claude-session', trigger: 'manual' }
  const { status, output } = await adapter.handleHook(payload)
  assert.equal(status, 'accepted')
  assert.equal(output, undefined)
  assert.deepEqual(received, { harness: 'claude', name: 'PreCompact', sessionId: 'claude-session', trigger: 'manual' })
  await assert.rejects(adapter.handleHook({ ...payload, hook_event_name: 'PostCompact' }), { code: 'invalid-hook-event' })
})

test('hook fields, lifecycle deduplication and workspace rejection', async () => {
  const claimedTurns = new Set()
  const adapter = createExternalAdapter({
    ...init,
    connection: { discover: async () => manifest, call: async () => {} },
    async lifecycle(event, options) {
      assert.deepEqual(options.scope, scope)
      assert.equal(options.instanceId, identity.instanceId)
      assert.equal(event.sessionId, 'host-session')
      assert.equal(event.prompt, undefined)
      assert.equal(event.transcript_path, undefined)
      if (event.name === 'Stop') return { status: 'out-of-order' }
      if (claimedTurns.has(event.turnId)) return { status: 'duplicate' }
      claimedTurns.add(event.turnId)
      return { status: 'accepted', context: 'fixture' }
    },
  })
  const payload = {
    cwd: workspace, hook_event_name: 'UserPromptSubmit', session_id: 'host-session', turn_id: 'one',
    prompt: 'fixture-private-prompt', transcript_path: 'fixture-private-path',
  }
  assert.equal((await adapter.handleHook({ ...payload, hook_event_name: 'Stop' })).status, 'out-of-order')
  const outputs = await Promise.all([adapter.handleHook(payload), adapter.handleHook(payload)])
  assert.equal(outputs.filter(result => result.output).length, 1)
  assert.equal(outputs.find(result => result.output).output.hookSpecificOutput.additionalContext, 'fixture')
  await assert.rejects(adapter.handleHook({ ...payload, cwd: other }), { code: 'scope-forbidden' })
  await assert.rejects(adapter.handleHook({ ...payload, sessionId: 'wrong' }), { code: 'invalid-hook-event' })
})

test('spawn the MCP stdio bridge and exercise live discovery, invocation and disconnection', async t => {
  const binding = path.join(root, 'binding.mjs')
  writeFileSync(binding, `import { serveExternalMcp } from ${JSON.stringify(mcpURL)}
  import { createExternalAdapter } from ${JSON.stringify(adapterURL)}
  const adapter = createExternalAdapter({
    ...${JSON.stringify(init)}, connection: {
      discover: () => (${JSON.stringify(manifest)}),
      call: (id, args) => {
        if (args.query === 'disconnect') throw Error('fixture transport disconnected')
        return { id, args }
      },
    },
  })
  await serveExternalMcp(adapter)`)
  const child = spawn(process.execPath, [binding], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] })
  t.after(() => child.kill())
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
  let id = 0
  async function request(method, params = {}) {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n')
    const { value } = await lines.next()
    return JSON.parse(value)
  }
  const { result } = await request('initialize', { protocolVersion: '2025-06-18' })
  assert.equal(result.protocolVersion, '2025-06-18')
  child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
  assert.deepEqual((await request('tools/list')).result.tools.map(tool => tool.name), ['status', 'memory_list', 'memory_recall'])
  const reply = await request('tools/call', { name: 'memory_recall', arguments: { query: 'fixture' } })
  assert.deepEqual(JSON.parse(reply.result.content[0].text), { id: 'memory.recall', args: { query: 'fixture', scope: 'current' } })
  const failure = await request('tools/call', { name: 'memory_recall', arguments: { query: 'disconnect' } })
  assert.equal(failure.result.isError, true)
  assert.equal(failure.result.content[0].text, 'live-api-unavailable')
  child.stdin.end()
})
