import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createExternalAdapter, getExternalHostEvents } from '../../lib/harness/external-hosts.js'
import { formatAntigravityHookOutput } from '../../lib/harness/antigravity.js'

const root = await mkdtemp(path.join(tmpdir(), 'dam-antigravity-contract-'))
const workspace = path.join(root, 'project')
const other = path.join(root, 'other')
await Promise.all([mkdir(workspace), mkdir(other)])

try {
  assert.deepEqual(getExternalHostEvents('antigravity'), ['SessionStart', 'PreInvocation', 'Stop'])

  const events = []
  const adapter = createExternalAdapter({
    harness: 'antigravity',
    workspace,
    workspaceRef: 'dsh-workspace',
    dshSessionId: 'dsh-session',
    profile: 'isolated',
    connection: {
      discover: async () => ({
        contractVersion: '1.0',
        identity: { harness: 'dsh', profile: 'isolated', instanceId: 'instance-1' },
        operations: [],
      }),
      call: async () => ({ status: 'accepted', context: 'bound project context' }),
    },
    lifecycle: async event => {
      events.push(event)
      return { status: 'accepted', context: 'bound project context' }
    },
  })

  const payload = {
    conversationId: 'conversation-123',
    workspacePaths: [workspace],
    lastUserInput: 'private prompt content',
    transcriptPath: path.join(workspace, 'private-transcript.jsonl'),
  }
  const start = await adapter.handleHook(payload, { hookEventName: 'SessionStart' })
  assert.equal(start.status, 'accepted')
  assert.deepEqual(events[0], {
    harness: 'antigravity',
    name: 'SessionStart',
    sessionId: 'conversation-123',
  })
  assert.deepEqual(JSON.parse(formatAntigravityHookOutput(start)), {
    injectSteps: [{ systemMessage: { systemMessage: 'bound project context' } }],
  })

  const prompt = await adapter.handleHook(payload, { hookEventName: 'PreInvocation' })
  assert.equal(prompt.event.name, 'PreInvocation')
  assert.equal(events[1].name, 'PreInvocation')
  assert.equal(events[1].prompt, undefined)
  assert.deepEqual(JSON.parse(formatAntigravityHookOutput(prompt)), {
    injectSteps: [{ systemMessage: { systemMessage: 'bound project context' } }],
  })
  assert.deepEqual(JSON.parse(formatAntigravityHookOutput({ status: 'duplicate' })), {})

  const stop = await adapter.handleHook(payload, { hookEventName: 'Stop' })
  assert.equal(stop.event.name, 'Stop')
  assert.equal(formatAntigravityHookOutput(stop), '{"decision":"stop"}\n')

  await assert.rejects(adapter.handleHook(payload, { hookEventName: 'PreToolUse' }), { code: 'invalid-hook-event' })
  await assert.rejects(adapter.handleHook({ ...payload, workspacePaths: [other] }, { hookEventName: 'SessionStart' }), {
    code: 'scope-forbidden',
  })
  await assert.rejects(adapter.handleHook({ ...payload, workspacePaths: [workspace, other] }, { hookEventName: 'SessionStart' }), {
    code: 'invalid-hook-event',
  })

  console.log('Antigravity hooks: SessionStart, PreInvocation, Stop, injectSteps output, and workspace binding passed')
} finally {
  await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 })
}
