import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { connectDsh } from '../../lib/terminal/client.js'
import { startExternalDesktop } from './auto-memory-external-desktop.mjs'

const [executable, desktopExecutable] = process.argv.slice(2)
assert.ok(executable && desktopExecutable, 'Usage: node tests/live/auto-memory-opencode.mjs OPENCODE_EXE DESKTOP_EXE')
const packageDirectory = process.env.DAM_EXTERNAL_PLUGIN_DIR || fileURLToPath(new URL('../../', import.meta.url))
const root = await mkdtemp(path.join(process.env.DAM_EXTERNAL_TEST_SCRATCH || tmpdir(), 'dam-opencode-'))
const workspace = path.join(root, 'project')
const foreign = path.join(root, 'other')
const marker = 'opencode-synthetic-copper-quail'
const requests = []
const toolName = 'auto_memory_memory_recall'
const toolId = 'call_opencode_recall'
const waterlinePrompt = 'Record a response near the configured context limit'
let desktop
let host
let hostClosed
let compacting
let modelWithoutTools = false
let highUsageSent = false

const model = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions') {
    response.writeHead(404).end()
    return
  }
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  requests.push(body)
  const latestUser = body.messages.findLastIndex(message => message.role === 'user')
  const crossesWaterline = !highUsageSent && JSON.stringify(body.messages[latestUser]?.content ?? '').includes(waterlinePrompt)
  if (crossesWaterline) highUsageSent = true
  const summaryRequest = crossesWaterline ? undefined : compacting
  if (summaryRequest) {
    summaryRequest.resolve()
    await summaryRequest.release
  }
  const retrieved = body.messages.slice(latestUser + 1)
    .some(message => message.role === 'tool')
  const denied = !body.tools?.some(tool => tool.function?.name === toolName)
  const complete = retrieved || denied || summaryRequest || modelWithoutTools
  const delta = complete ? { content: summaryRequest ? 'fixture compacted summary' : 'fixture complete' } : {
    tool_calls: [{ index: 0, id: toolId, type: 'function',
      function: { name: toolName, arguments: JSON.stringify({ query: marker }) } }],
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream' })
  const send = (choices, usage) => response.write('data: ' + JSON.stringify({
    id: 'chatcmpl-test', object: 'chat.completion.chunk', model: 'fixture', choices, usage,
  }) + '\n\n')
  send([{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }])
  send([{ index: 0, delta: {}, finish_reason: complete ? 'stop' : 'tool_calls' }])
  const inputTokens = crossesWaterline ? 64_000 : 500
  send([], { prompt_tokens: inputTokens, completion_tokens: 20, total_tokens: inputTokens + 20 })
  response.end('data: [DONE]\n\n')
})

const allowedEnv = /^(path|pathext|systemroot|windir|comspec|systemdrive|programfiles(?:\(x86\))?|processor_architecture)$/i
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowedEnv.test(name)))
Object.assign(env, {
  USERPROFILE: root, HOME: root, APPDATA: root, LOCALAPPDATA: root, TEMP: root, TMP: root,
  XDG_CONFIG_HOME: path.join(root, 'config'), XDG_CACHE_HOME: path.join(root, 'cache'),
  XDG_DATA_HOME: path.join(root, 'data'), XDG_STATE_HOME: path.join(root, 'state'),
  OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_DISABLE_MODELS_FETCH: '1',
})

async function run(command, args, cwd) {
  const child = spawn(command, args, {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal: AbortSignal.timeout(40_000),
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

async function waitFor(label, read) {
  const deadline = Date.now() + 25_000
  do {
    const result = await read()
    if (result) return result
    await delay(100)
  } while (Date.now() < deadline)
  assert.fail('Timed out waiting for ' + label)
}

async function startOpenCode() {
  const password = 'isolated-loopback-fixture'
  host = spawn(executable, ['serve', '--hostname', '127.0.0.1', '--port', '0'], {
    cwd: workspace, env: { ...env, OPENCODE_SERVER_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  hostClosed = once(host, 'close')
  let output = ''
  host.stdout.setEncoding('utf8').on('data', chunk => { output += chunk })
  host.stderr.resume()
  const origin = await waitFor('OpenCode loopback server', () => {
    assert.equal(host.exitCode, null, output)
    return /opencode server listening on (http:\/\/127\.0\.0\.1:\d+)/u.exec(output)?.[1]
  })
  return async (pathname, body) => {
    const response = await fetch(new URL(pathname, origin), {
      headers: {
        authorization: 'Basic ' + Buffer.from('opencode:' + password).toString('base64'),
        'x-opencode-directory': encodeURIComponent(workspace),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    })
    assert.ok(response.ok, pathname + ' returned ' + response.status + (response.ok ? '' : ' ' + await response.text()))
    return response.status === 204 ? undefined : response.json()
  }
}

try {
  await Promise.all([mkdir(workspace), mkdir(foreign)])
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  desktop = await startExternalDesktop(root, desktopExecutable, workspace, '# Synthetic project note\n\n' + marker)
  const bindingFile = path.join(root, 'binding.json')
  await writeFile(bindingFile, JSON.stringify({
    version: 1, harness: 'opencode', workspace, dshSessionId: desktop.scope.sessionId, dsh: desktop.dsh,
  }))
  const bridge = path.join(packageDirectory, 'lib', 'harness', 'external-entry.js')
  const nativePlugin = pathToFileURL(path.join(packageDirectory, 'lib', 'harness', 'opencode.js')).href
  const config = {
    plugin: [[nativePlugin, { bindingFile }]],
    mcp: { auto_memory: { type: 'local', command: [process.execPath, bridge, 'opencode', 'mcp', bindingFile] } },
    enabled_providers: ['fixture'],
    provider: { fixture: {
      npm: '@ai-sdk/openai-compatible', name: 'Isolated fixture',
      options: { baseURL: 'http://127.0.0.1:' + model.address().port + '/v1', apiKey: 'local-fixture-only' },
      models: { fixture: { name: 'Fixture', tool_call: true, limit: { context: 65536, output: 2048 } } },
    } },
    model: 'fixture/fixture',
    small_model: 'fixture/fixture',
    permission: { '*': 'deny', 'auto_memory_*': 'allow' },
  }
  const configure = (directory, value) => writeFile(path.join(directory, 'opencode.json'), JSON.stringify(value))
  await Promise.all([configure(workspace, config), configure(foreign, config)])
  const list = await run(executable, ['mcp', 'list'], workspace)
  assert.equal(list.code, 0, list.stderr)
  assert.match(list.stdout, /connected[\s\S]*auto_memory|auto_memory[\s\S]*connected/iu)
  const wrong = await run(process.execPath, [bridge, 'opencode', 'mcp', bindingFile], foreign)
  assert.equal(wrong.code, 1)
  assert.match(wrong.stderr, /scope-forbidden/u)

  const command = ['run', '--format', 'json', '--model', 'fixture/fixture', 'Read the bound synthetic memory']
  const positive = await run(executable, command, workspace)
  assert.equal(positive.code, 0, positive.stderr)
  const sessionId = positive.stdout.split(/\r?\n/u).filter(line => line.startsWith('{'))
    .map(line => JSON.parse(line)).find(event => event.sessionID)?.sessionID
  assert.ok(sessionId, 'OpenCode returned a session ID')
  assert.ok(requests.some(body => body.tools?.some(tool => tool.function?.name === toolName)), 'model offered the real MCP tool')
  assert.ok(requests.some(body => body.messages.some(message => message.role === 'tool' &&
    message.tool_call_id === toolId && JSON.stringify(message.content).includes(marker))), 'model got the real DSH recall result')
  assert.ok(requests.some(body => body.messages.some(message => message.role === 'system' &&
    JSON.stringify(message.content).includes(marker))), 'model got project context from the native OpenCode hook')

  const firstDenied = requests.length
  await configure(workspace, { ...config, permission: { '*': 'deny' } })
  const negative = await run(executable, [
    'run', '--session', sessionId, '--format', 'json', '--model', 'fixture/fixture', 'Resume the synthetic session',
  ], workspace)
  assert.equal(negative.code, 0, negative.stderr)
  const denied = requests.slice(firstDenied)
  assert.ok(denied.length, 'denied run reached the loopback model')
  assert.ok(denied.every(body => !body.tools?.some(tool => tool.function?.name === toolName)), 'host denied the MCP tool')
  assert.ok(denied.every(body => body.messages.some(message => message.role === 'system' &&
    JSON.stringify(message.content).includes(marker))), 'native context is independent of the tool policy')

  await configure(workspace, { ...config, permission: { '*': 'deny', 'auto_memory_*': 'ask' } })
  const api = await startOpenCode()
  const fixtureModel = { providerID: 'fixture', modelID: 'fixture' }
  const permissionResults = {}
  for (const decision of ['once', 'reject']) {
    const session = await api('/session', { title: 'Synthetic permission ' + decision })
    const before = requests.length
    await api('/session/' + session.id + '/prompt_async', {
      model: fixtureModel, parts: [{ type: 'text', text: 'Check the synthetic memory' }],
    })
    const permission = await waitFor('MCP permission request', async () => {
      return (await api('/permission')).find(item => item.sessionID === session.id && item.permission === toolName)
    })
    const hasRecall = body => body.messages.some(message => message.role === 'tool' &&
      message.tool_call_id === toolId && JSON.stringify(message.content).includes(marker))
    assert.ok(!requests.slice(before).some(hasRecall), 'memory result cannot arrive before host approval')
    assert.equal(await api('/permission/' + permission.id + '/reply', { reply: decision }), true)
    await waitFor('OpenCode tool result or rejection (' + decision + ')', async () => {
      const messages = await api('/session/' + session.id + '/message')
      const terminalPart = messages.flatMap(message => message.parts)
        .find(part => part.type === 'tool' && part.tool === toolName && ['completed', 'error'].includes(part.state.status))
      if (!terminalPart) return false
      const expected = decision === 'once' ? 'completed' : 'error'
      assert.equal(terminalPart.state.status, expected)
      if (decision === 'once') {
        assert.match(terminalPart.state.output, new RegExp(marker, 'u'))
        return requests.slice(before).some(hasRecall)
      }
      assert.match(terminalPart.state.error, /reject|denied/iu)
      assert.ok(!requests.slice(before).some(hasRecall), 'rejected tool returned no recall content')
      return true
    })
    permissionResults[decision] = true
  }

  const connection = connectDsh(desktop.dsh)
  const postMessage = (id, text) => api('/session/' + id + '/message', {
    model: fixtureModel, parts: [{ type: 'text', text }],
  })
  async function verifyCompaction(id, mode, trigger) {
    const probeCompaction = () => connection.call('external.lifecycle', {
      harness: 'opencode', name: 'PreCompact', sessionId: id,
    }, { scope: desktop.scope, instanceId: desktop.identity.instanceId })
    // Hold the model response while checking PreCompact in the bound DSH instance.
    const release = Promise.withResolvers()
    compacting = { ...Promise.withResolvers(), release: release.promise }
    const finished = trigger()
    const seen = Promise.race([compacting.promise, finished.then(() => { throw Error('OpenCode skipped its compaction model') })])
    const during = requests.length
    try {
      await Promise.race([seen, delay(20_000, undefined, { ref: false }).then(() => { throw Error('No compaction model request') })])
      assert.equal((await probeCompaction()).status, 'duplicate', 'host PreCompact reached the bound DSH lifecycle')
    } finally {
      compacting = undefined
      release.resolve()
      await finished
    }
    assert.ok(requests.length > during, 'compaction called the model')
    await waitFor('OpenCode summary record', async () => {
      const messages = await api('/session/' + id + '/message')
      const compaction = messages.flatMap(message => message.parts).find(part => part.type === 'compaction')
      if (mode === 'auto') assert.ok(messages.some(message => message.info.tokens?.total === 64_020),
        'OpenCode recorded the simulated context waterline')
      return compaction?.auto === (mode === 'auto') && messages.some(message =>
        message.info.summary && message.parts.some(part => part.type === 'text' && part.text === 'fixture compacted summary'))
    })
    await waitFor('OpenCode PostCompact in DSH', async () => (await probeCompaction()).status === 'accepted')
    const postSummary = requests.length
    await postMessage(id, 'Continue after compaction')
    assert.ok(requests.slice(postSummary).some(body => body.messages.some(message => message.role === 'system' &&
      JSON.stringify(message.content).includes(marker))), 'native project context is available after compaction')
  }

  modelWithoutTools = true
  await verifyCompaction(sessionId, 'manual', () => api('/session/' + sessionId + '/summarize', fixtureModel))
  const autoSession = await api('/session', { title: 'Synthetic automatic compaction' })
  await verifyCompaction(autoSession.id, 'auto', () => postMessage(autoSession.id, waterlinePrompt))
  console.log(JSON.stringify({ host: 'opencode', plugin: desktop.identity, mcpConnected: true, nativeContextInModelInput: true,
    recallInModelInput: true, resumedContext: true, hostDenial: true, permissionResults, manualCompaction: true,
    automaticCompaction: true, postCompactionContext: true, crossWorkspaceExit: wrong.code, requests: requests.length }))
} finally {
  if (host) {
    host.kill()
    await hostClosed
  }
  model.closeAllConnections()
  if (model.listening) await new Promise(resolve => model.close(resolve))
  await desktop?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
}
