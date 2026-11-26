import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { startExternalDesktop } from './auto-memory-external-desktop.mjs'
import { connectDsh } from '../../lib/terminal/client.js'
import { connectExternalDsh } from '../../lib/harness/external-dsh-proxy.js'
import { getExternalHostEvents } from '../../lib/harness/external-hosts.js'

const [host, executable, ...launcherArgs] = process.argv.slice(2)
assert.ok(['codex', 'zcode', 'claude'].includes(host) && executable, 'Pass codex, zcode or claude and the host executable')
assert.ok(process.env.DAM_EXTERNAL_DSH_DESKTOP, 'Set DAM_EXTERNAL_DSH_DESKTOP to the installed Desktop executable')
const entry = process.env.DAM_EXTERNAL_PLUGIN_DIR
  ? path.join(process.env.DAM_EXTERNAL_PLUGIN_DIR, 'lib', 'harness', 'external-entry.js')
  : fileURLToPath(new URL('../../lib/harness/external-entry.js', import.meta.url))
const scratch = process.env.DAM_EXTERNAL_TEST_SCRATCH || tmpdir()
const root = await mkdtemp(path.join(scratch, 'dam-external-host-'))
const project = path.join(root, 'project')
const profile = path.join(root, 'profile')
const binding = path.join(root, 'binding.json')
const hookTrace = path.join(root, 'hook-trace.ndjson')
const hookLauncher = path.join(root, 'trace-hook.mjs')
await mkdir(project)
await mkdir(profile)
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'SYSTEMDRIVE', 'PROGRAMFILES',
    'PROGRAMFILES(X86)', 'PROCESSOR_ARCHITECTURE'].includes(name.toUpperCase())))
Object.assign(env, {
  HOME: profile, USERPROFILE: profile, CODEX_HOME: profile, ZCODE_DATA_BASE_DIR: profile,
  TEMP: root, TMP: root, LOCALAPPDATA: path.join(profile, 'local'), APPDATA: path.join(profile, 'roaming'),
  ZCODE_MODEL_TELEMETRY_ENABLED: 'false', NO_COLOR: '1',
})
const modelRequests = []
const contextMarker = 'DAM_EXTERNAL_CONTEXT_SENTINEL'
const zcodePostCompactPrompt = 'Synthetic turn after ZCode compaction'
const codexWaterlinePrompt = 'Synthetic Codex context pressure'
const expectedTools = ['status', 'memory_list', 'memory_recall']
let desktop
let toolMarker
let codexWaterlineSent = false
const observedNames = []

function responses(res, request) {
  const completed = new Set(request.input?.filter(item => item.type === 'function_call_output').map(item => item.call_id))
  const requested = expectedTools.find(name => !completed.has('call_fixture_' + name))
  const namespace = request.tools?.find(tool => tool.type === 'namespace' && tool.name === 'mcp__auto_memory')
  const tool = requested && (namespace?.tools.find(item => item.name === requested) ??
    request.tools?.find(tool => tool.name?.endsWith('_' + requested)))
  const crossesWaterline = !codexWaterlineSent && JSON.stringify(request.input).includes(codexWaterlinePrompt)
  if (crossesWaterline) codexWaterlineSent = true
  const inputTokens = crossesWaterline ? 30_000 : 100
  const response = { id: 'resp_fixture', object: 'response', status: 'in_progress', model: request.model, output: [] }
  const item = tool
    ? { id: 'fc_fixture_' + requested, type: 'function_call', status: 'completed',
      call_id: 'call_fixture_' + requested, name: tool.name, ...(namespace ? { namespace: namespace.name } : {}),
      arguments: requested === 'memory_recall' ? JSON.stringify({ query: contextMarker }) : '{}' }
    : { id: 'msg_fixture', type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'fixture complete', annotations: [] }] }
  const frames = [
    { type: 'response.created', response },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress' } },
  ]
  if (item.type === 'message') frames.push({
    type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: 'fixture complete',
  })
  frames.push(
    { type: 'response.output_item.done', output_index: 0, item },
    { type: 'response.completed', response: {
      ...response, status: 'completed', output: [item],
      usage: { input_tokens: inputTokens, output_tokens: 10, total_tokens: inputTokens + 10 },
    } },
  )
  res.setHeader('Content-Type', 'text/event-stream')
  res.end(frames.map((frame, i) => `event: ${frame.type}\ndata: ${JSON.stringify({ sequence_number: i, ...frame })}\n\n`).join(''))
}

function chatCompletions(res, request) {
  const completed = new Set(request.messages?.filter(message => message.role === 'tool').map(message => message.tool_call_id))
  const requested = expectedTools.find(name => !completed.has('call_fixture_' + name))
  const tool = requested && request.tools?.find(tool => tool.function?.name?.endsWith('__' + requested))
  const chunk = {
    id: 'chatcmpl-fixture', object: 'chat.completion.chunk', created: 1, model: request.model,
    choices: [{ index: 0, delta: tool
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_fixture_' + requested, type: 'function',
        function: { name: tool.function.name, arguments: requested === 'memory_recall' ? JSON.stringify({ query: contextMarker }) : '{}' } }] }
      : { role: 'assistant', content: 'fixture complete' }, finish_reason: null }],
  }
  res.setHeader('Content-Type', 'text/event-stream')
  res.end(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({
    ...chunk, choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  })}\n\ndata: [DONE]\n\n`)
}

function anthropicMessages(res, request) {
  const tools = request.tools ?? []
  const completed = new Set(request.messages?.flatMap(message => Array.isArray(message.content)
    ? message.content.filter(part => part.type === 'tool_result').map(part => part.tool_use_id) : []))
  const requested = expectedTools.find(name => !completed.has('call_fixture_' + name))
  const name = 'mcp__auto_memory__' + requested
  const call = tools.some(tool => tool.name === name)
  const block = call ? { type: 'tool_use', id: 'call_fixture_' + requested, name, input: {} } : { type: 'text', text: '' }
  const frames = [
    { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant',
      content: [], model: request.model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: block },
    { type: 'content_block_delta', index: 0, delta: call
      ? { type: 'input_json_delta', partial_json: requested === 'memory_recall' ? JSON.stringify({ query: contextMarker }) : '{}' }
      : { type: 'text_delta', text: 'fixture complete' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: call ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 10 } },
    { type: 'message_stop' },
  ]
  res.setHeader('Content-Type', 'text/event-stream')
  res.end(frames.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''))
}

const server = createServer(async (req, res) => {
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}
    const route = new URL(req.url, 'http://127.0.0.1').pathname
    if (route.endsWith('/messages/count_tokens')) {
      res.setHeader('Content-Type', 'application/json')
      return res.end('{"input_tokens":100}')
    }
    if (route.endsWith('/messages')) {
      modelRequests.push(data)
      return anthropicMessages(res, data)
    }
    if (route.endsWith('/responses') || route.endsWith('/chat/completions')) {
      modelRequests.push(data)
      return req.url.endsWith('/responses') ? responses(res, data) : chatCompletions(res, data)
    }
    res.writeHead(404).end()
  } catch (error) {
    console.error(error.message)
    res.writeHead(500).end()
  }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const origin = `http://127.0.0.1:${server.address().port}`

await writeFile(hookLauncher, `import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const chunks = []
for await (const chunk of process.stdin) chunks.push(chunk)
const input = Buffer.concat(chunks)
const payload = JSON.parse(input)
const call = spawnSync(process.execPath, ${JSON.stringify([entry, host, 'hook', binding])}, { input, encoding: 'utf8', timeout: 3500 })
const result = JSON.parse(call.stdout || '{}')
appendFileSync(${JSON.stringify(hookTrace)}, JSON.stringify({
  name: payload.hook_event_name ?? payload.hookEventName,
  sessionId: payload.session_id ?? payload.sessionId,
  source: payload.source, trigger: payload.trigger,
  hasTurnId: Boolean(payload.turn_id ?? payload.turnId),
  hasContext: Boolean(result.hookSpecificOutput?.additionalContext),
  hookExit: call.status,
  diagnostic: call.stderr?.trim() || undefined,
}) + '\\n')
process.stdout.write(call.stdout || '{}')
process.stderr.write(call.stderr || '')
`)
const command = ['node', hookLauncher].map((arg, index) =>
  index === 0 ? arg : `"${arg.replaceAll('\\', '/')}"`).join(' ')
const mcpArgs = [entry, host, 'mcp', binding]
const supportedEvents = getExternalHostEvents(host)
const hooks = Object.fromEntries(supportedEvents.map(name => [name, [{ hooks: [{ type: 'command', command, timeout: 3 }] }]]))

function launch(args, command = executable, prefix = launcherArgs, cwd = project) {
  return spawn(command, [...prefix, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
}

async function run(args, command, prefix, cwd) {
  const child = launch(args, command, prefix, cwd)
  const chunks = { out: [], err: [] }
  child.stdin.end()
  child.stdout.on('data', data => chunks.out.push(data))
  child.stderr.on('data', data => chunks.err.push(data))
  const timer = setTimeout(() => child.kill(), 60_000)
  try {
    const [code] = await once(child, 'close')
    return { code, stdout: Buffer.concat(chunks.out).toString(), stderr: Buffer.concat(chunks.err).toString() }
  } finally {
    clearTimeout(timer)
  }
}

async function withCodexAppServer(fn) {
  const child = launch(['app-server', '--stdio'])
  const lines = createInterface({ input: child.stdout })
  let id = 0
  child.stderr.resume()
  async function request(method, params) {
    const requestId = ++id
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        lines.off('line', onLine)
        reject(Error(`Codex App Server timed out on ${method}`))
      }, 30_000)
      function onLine(line) {
        const response = JSON.parse(line)
        if (response.id !== requestId) return
        clearTimeout(timeout)
        lines.off('line', onLine)
        if (response.error) reject(Error(JSON.stringify(response.error)))
        else resolve(response.result)
      }
      lines.on('line', onLine)
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
    })
  }
  try {
    await request('initialize', { clientInfo: { name: 'dam_fixture', version: '1.0' } })
    child.stdin.write('{"jsonrpc":"2.0","method":"initialized"}\n')
    return await fn(request, lines)
  } finally {
    child.stdin.end()
    child.kill()
    lines.close()
  }
}

async function codexHookTrust(trustStatus) {
  return withCodexAppServer(async request => {
    const { data } = await request('hooks/list', { cwds: [project] })
    const listed = data.flatMap(workspace => workspace.hooks)
    assert.equal(listed.length, supportedEvents.length)
    for (const hook of listed) {
      assert.equal(hook.command, command)
      assert.equal(hook.trustStatus, trustStatus)
    }
    return listed.map(hook => `[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash = ${JSON.stringify(hook.currentHash)}`).join('\n\n')
  })
}

async function compactCodexThread(threadId) {
  await withCodexAppServer(async (request, lines) => {
    await request('thread/resume', { threadId, cwd: project })
    const completion = Promise.withResolvers()
    lines.on('line', line => {
      const { method, params } = JSON.parse(line)
      if (method === 'turn/completed' && params.threadId === threadId) completion.resolve(params.turn)
    })
    await request('thread/compact/start', { threadId })
    const timer = setTimeout(() => completion.reject(Error('Timed out waiting for Codex compaction')), 20_000)
    try {
      const turn = await completion.promise
      assert.equal(turn.status, 'completed', JSON.stringify(turn.error))
    } finally {
      clearTimeout(timer)
    }
  })
}

async function testCodex() {
  const config = path.join(profile, 'config.toml')
  await writeFile(path.join(profile, 'hooks.json'), JSON.stringify({ hooks }))
  const settings = `model = "gpt-5.4"
model_provider = "dam_fixture"
sandbox_mode = "read-only"
approval_policy = "never"
web_search = "disabled"
[features]
hooks = true
[model_providers.dam_fixture]
name = "DAM fixture"
base_url = "${origin}/v1"
wire_api = "responses"
requires_openai_auth = false
[projects.${JSON.stringify(project)}]
trust_level = "trusted"
[mcp_servers.auto_memory]
command = ${JSON.stringify(process.execPath)}
args = ${JSON.stringify(mcpArgs)}
cwd = ${JSON.stringify(project)}
startup_timeout_sec = 20
`
  await writeFile(config, settings)
  const hookState = await codexHookTrust('untrusted')
  await writeFile(config, settings + '\n' + hookState)
  await codexHookTrust('trusted')
  const runArgs = ['--json', '--skip-git-repo-check']
  const first = await run(['exec', ...runArgs, 'Synthetic Auto Memory verification'])
  assert.equal(first.code, 0, first.stderr + '\n' + first.stdout)
  const { thread_id: threadId } = first.stdout.split(/\r?\n/u).filter(Boolean).map(JSON.parse).find(item => item.type === 'thread.started')
  const resumed = await run(['exec', 'resume', ...runArgs, threadId, 'Synthetic resume'])
  assert.equal(resumed.code, 0, resumed.stderr + '\n' + resumed.stdout)
  if (process.env.DAM_EXTERNAL_TEST_COMPACT === '1') await compactCodexThread(threadId)
  if (process.env.DAM_EXTERNAL_TEST_CODEX_AUTO_COMPACT === '1') {
    const firstRequest = modelRequests.length
    const auto = await run(['exec', 'resume', ...runArgs, '-c', 'model_auto_compact_token_limit=20000', threadId, codexWaterlinePrompt])
    assert.equal(auto.code, 0, auto.stderr + '\n' + auto.stdout)
    assert.equal(codexWaterlineSent, true)
    const automaticRequests = modelRequests.slice(firstRequest)
    assert.ok(automaticRequests.length > 2, 'Codex reached the model again after automatic compaction')
    assert.ok(JSON.stringify(automaticRequests.at(-1)).includes(contextMarker),
      'the final Codex request retained project memory after automatic compaction')
  }
}

async function testZcode() {
  const zcodeEntry = launcherArgs[0]
  assert.ok(zcodeEntry, 'Pass the installed zcode.cjs as the second launcher argument')
  const builtin = path.resolve(path.dirname(zcodeEntry), '../config/provider/zcode-builtin.json')
  const builtinFixture = JSON.parse(await readFile(builtin, 'utf8'))
  // Keep the synthetic provider as the only choice, including on a configuration error.
  builtinFixture.config.providerConfigRules = { templateRules: [], providerRules: [] }
  const builtinsPath = path.join(root, 'builtin.json')
  const personalPath = path.join(root, 'personal.json')
  await writeFile(builtinsPath, JSON.stringify(builtinFixture))
  await writeFile(personalPath, JSON.stringify({
    schemaVersion: 1, config: {
      providerConfigRules: { providerRules: [{
        providerId: 'dam-fixture', providerName: 'DAM fixture',
        config: {
          group: 'standard-personal', personalModelIds: ['dam-local'],
          access: { type: 'api-key', apiKey: 'fixture' },
          api: { type: 'openai-chat-completions', baseUrl: `${origin}/v1` },
        },
      }] },
      modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      defaultModelSelection: { providerId: 'dam-fixture', modelId: 'dam-local' },
    },
  }))
  Object.assign(env, {
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinsPath,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: personalPath,
  })
  const configDir = path.join(profile, '.zcode', 'cli')
  const pluginName = 'dam-external'
  const marketplace = 'dam-isolated'
  const pluginDir = path.join(configDir, 'plugins', 'cache', marketplace, pluginName, '1.0.0')
  await mkdir(path.join(pluginDir, '.zcode-plugin'), { recursive: true })
  await mkdir(path.join(pluginDir, 'hooks'))
  const save = (dir, name, value) => writeFile(path.join(dir, name), JSON.stringify(value))
  const id = `${pluginName}@${marketplace}`
  await save(path.join(pluginDir, '.zcode-plugin'), 'plugin.json', {
    name: pluginName, version: '1.0.0', description: 'Auto Memory isolated adapter',
    mcpServers: { 'auto-memory': { type: 'stdio', command: process.execPath, args: mcpArgs, cwd: '${ZCODE_PROJECT_DIR}' } },
  })
  await save(path.join(pluginDir, 'hooks'), 'hooks.json', { hooks })
  await save(configDir, 'config.json', {
    plugins: { enabledPlugins: { [id]: true } },
  })
  const stamp = new Date().toISOString()
  await save(path.join(configDir, 'plugins'), 'installed_plugins.json', {
    plugins: [{ id, name: pluginName, marketplace, version: '1.0.0', installPath: pluginDir, installedAt: stamp,
      updatedAt: stamp, scope: 'user', source: { source: 'local', type: 'path', path: pluginDir }, cacheTransactionId: 'fixture' }],
  })
  await save(path.join(configDir, 'plugins'), 'known_marketplaces.json', {
    marketplaces: [{ id: marketplace, source: { source: 'path', path: pluginDir }, name: marketplace, addedAt: stamp,
      lastUpdated: stamp, pluginCount: 1 }],
  })
  const validation = await run(['plugins', 'validate', pluginDir])
  assert.equal(validation.code, 0, validation.stderr + '\n' + validation.stdout)
  let listing = await run(['plugins', 'list'])
  if (listing.code === null) listing = await run(['plugins', 'list'])
  assert.equal(listing.code, 0, listing.stderr + '\n' + listing.stdout)
  assert.ok(listing.stdout.includes(id), listing.stdout)
  const result = await run(['--prompt', 'Synthetic Auto Memory verification', '--mode', 'guarded'])
  assert.equal(result.code, 0, result.stderr + '\n' + result.stdout)
  if (process.env.DAM_EXTERNAL_TEST_ZCODE_RESUME === '1') {
    const events = (await readFile(hookTrace, 'utf8')).trim().split('\n').map(JSON.parse)
    const sessionId = events.find(event => event.name === 'SessionStart')?.sessionId
    assert.ok(sessionId)
    const resumed = await run(['--resume', sessionId, '--prompt', 'Synthetic resume', '--mode', 'guarded'])
    let zcodeCompactCode
    if (process.env.DAM_EXTERNAL_TEST_ZCODE_COMPACT === '1') {
      const compacted = await run(['--resume', sessionId, '--prompt', '/compact', '--mode', 'guarded'])
      zcodeCompactCode = compacted.code
      assert.equal(zcodeCompactCode, 0, compacted.stderr + '\n' + compacted.stdout)
      const afterCompact = await run(['--resume', sessionId, '--prompt', zcodePostCompactPrompt, '--mode', 'guarded'])
      assert.equal(afterCompact.code, 0, afterCompact.stderr + '\n' + afterCompact.stdout)
    }
    return { zcodeResumeCode: resumed.code, zcodeCompactCode }
  }
  return {}
}

async function testClaude() {
  const config = path.join(profile, 'settings.json')
  const mcpConfig = path.join(profile, 'mcp.json')
  await writeFile(config, JSON.stringify({ hooks }))
  await writeFile(mcpConfig, JSON.stringify({
    mcpServers: { auto_memory: { type: 'stdio', command: process.execPath, args: mcpArgs } },
  }))
  Object.assign(env, {
    CLAUDE_CONFIG_DIR: profile, ANTHROPIC_BASE_URL: origin, ANTHROPIC_API_KEY: 'fixture',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
    ENABLE_TOOL_SEARCH: 'false',
  })
  const args = ['--print', '--settings', config, '--setting-sources', '',
    '--strict-mcp-config', '--mcp-config', mcpConfig, '--permission-mode', 'dontAsk',
    '--tools', '', '--allowedTools', ...expectedTools.map(name => 'mcp__auto_memory__' + name),
    '--model', 'claude-sonnet-4-6', '--output-format', 'json']
  const result = await run([...args, 'Synthetic Auto Memory verification'])
  assert.equal(result.code, 0, JSON.stringify({ ...result, modelRequests: modelRequests.length }))
  const first = JSON.parse(result.stdout)
  assert.equal(first.result, 'fixture complete')
  if (process.env.DAM_EXTERNAL_TEST_COMPACT === '1') {
    const compacted = await run([...args, '--resume', first.session_id, '/compact'])
    return { claudeCompactCode: compacted.code }
  }
  return {}
}

async function testBoundHost({ dsh, scope, identity }, connection) {
  await writeFile(binding, JSON.stringify({ version: 1, harness: host, workspace: project, dshSessionId: scope.sessionId, dsh }), { mode: 0o600 })
  const adapter = await connectExternalDsh({ harness: host, bindingFile: binding, cwd: project })
  const discovered = await adapter.discover()
  assert.equal(discovered.mode, host)
  assert.equal(discovered.boundHost.harness, host)
  assert.equal(discovered.identity.harness, 'dsh')
  assert.equal(discovered.identity.instanceId, identity.instanceId)
  const cli = path.resolve(path.dirname(entry), '../terminal/cli.js')
  const cliArgs = ['--harness', host, '--binding', binding]
  const cliStatus = await run([...cliArgs, 'status', '--json'], process.execPath, [cli])
  assert.equal(cliStatus.code, 0, cliStatus.stderr)
  assert.equal(JSON.parse(cliStatus.stdout).settingsRevision, toolMarker)
  const wrongDirectory = await run([...cliArgs, 'status', '--json'], process.execPath, [cli], root)
  assert.notEqual(wrongDirectory.code, 0)
  assert.match(wrongDirectory.stderr, /scope-forbidden/)
  let zcodeResult
  let claudeResult
  if (host === 'codex') await testCodex()
  else if (host === 'zcode') zcodeResult = await testZcode()
  else claudeResult = await testClaude()
  const toolOutputs = modelRequests.flatMap(request => [
    ...(request.input?.filter(item => item.type === 'function_call_output').map(item => [item.call_id, JSON.stringify(item.output)]) ?? []),
    ...(request.messages?.filter(message => message.role === 'tool').map(message => [message.tool_call_id, JSON.stringify(message.content)]) ?? []),
    ...(request.messages?.flatMap(message => Array.isArray(message.content)
      ? message.content.filter(part => part.type === 'tool_result').map(part => [part.tool_use_id, JSON.stringify(part.content)])
      : []) ?? []),
  ])
  const events = (await readFile(hookTrace, 'utf8')).trim().split('\n').map(line => {
    const { sessionId, ...event } = JSON.parse(line)
    return event
  })
  const testEvent = { harness: host, sessionId: 'synthetic-adapter-receipts', name: 'UserPromptSubmit', turnId: 'fixture-turn' }
  const observe = event => connection.call('external.lifecycle', event, { scope, instanceId: identity.instanceId })
  const receiptCases = [[testEvent, 'out-of-order'], [{ ...testEvent, name: 'SessionStart', source: 'startup' }, 'accepted'],
    [testEvent, 'accepted'], [testEvent, 'duplicate'], [{ ...testEvent, name: 'Stop' }, 'accepted']]
  if (host === 'claude' && process.env.DAM_EXTERNAL_TEST_COMPACT === '1') {
    receiptCases.push([{ ...testEvent, name: 'PreCompact', trigger: 'manual' }, 'accepted'],
      [{ ...testEvent, name: 'SessionStart', source: 'compact' }, 'accepted'])
  }
  if (host === 'zcode' && process.env.DAM_EXTERNAL_TEST_ZCODE_COMPACT === '1') {
    const afterCompact = { ...testEvent, name: 'SessionStart', source: 'compact', turnId: 'compacted-fixture-turn' }
    receiptCases.push([afterCompact, 'accepted'], [afterCompact, 'duplicate'])
  }
  const receipts = []
  for (const [event] of receiptCases) receipts.push(await observe(event))
  for (const [index, [event]] of receiptCases.entries()) observedNames.push(`${event.name}:${receipts[index].status}`)
  const summary = {
    host, mode: discovered.mode, boundIdentity: discovered.identity.harness,
    cliStatus: cliStatus.code, wrongDirectory: wrongDirectory.code, ...zcodeResult, ...claudeResult,
    hooks: events, lifecycleReceipts: observedNames, modelRequests: modelRequests.length,
    pluginVersion: identity.pluginVersion, buildId: identity.buildId,
    offeredTools: [...new Set(modelRequests.flatMap(request => request.tools?.flatMap(tool =>
      (tool.name ?? tool.function?.name ?? '').includes('auto_memory') ||
      (tool.name ?? tool.function?.name ?? '').includes('auto-memory')
        ? [tool.name ?? tool.function?.name, ...(tool.tools ?? []).map(item => item.name)] : []) ?? []))],
    sawProjectNotes: modelRequests.some(request =>
      JSON.stringify(request).includes('Auto Memory · Selected project notes') && JSON.stringify(request).includes(contextMarker)),
    toolResults: {
      status: toolOutputs.some(([id, data]) => id === 'call_fixture_status' && data.includes(toolMarker)),
      memoryList: toolOutputs.some(([id, data]) => id === 'call_fixture_memory_list' && data.includes('wsBound')),
      memoryRecall: toolOutputs.some(([id, data]) => id === 'call_fixture_memory_recall' && data.includes(contextMarker)),
    },
  }
  console.log(JSON.stringify(summary, null, 2))
  assert.deepEqual(summary.toolResults, { status: true, memoryList: true, memoryRecall: true })
  for (const [index, [event, expected]] of receiptCases.entries()) {
    const receipt = receipts[index]
    assert.equal(receipt.status, expected, event.name)
    if (event.name === 'SessionStart' && expected === 'accepted') assert.match(receipt.context, new RegExp(contextMarker))
    else assert.equal(receipt.context, undefined)
  }
  assert.ok(events.some(event => event.name === 'SessionStart' && event.hasContext))
  assert.ok(events.some(event => event.name === 'UserPromptSubmit' && !event.hasContext))
  assert.ok(events.some(event => event.name === 'Stop'))
  if (host === 'codex') {
    assert.ok(events.some(event => event.name === 'SessionStart' && event.source === 'resume'))
    assert.ok(events.some(event => event.name === 'SessionEnd'))
    if (process.env.DAM_EXTERNAL_TEST_COMPACT === '1') {
      assert.ok(events.some(event => event.name === 'PreCompact' && event.trigger === 'manual'))
      assert.ok(events.some(event => event.name === 'PostCompact' && event.trigger === 'manual'))
    }
    if (process.env.DAM_EXTERNAL_TEST_CODEX_AUTO_COMPACT === '1') {
      assert.ok(events.some(event => event.name === 'PreCompact' && event.trigger === 'auto' && event.hookExit === 0))
      assert.ok(events.some(event => event.name === 'PostCompact' && event.trigger === 'auto' && event.hookExit === 0))
    }
  }
  if (host === 'zcode' && process.env.DAM_EXTERNAL_TEST_ZCODE_RESUME === '1') {
    assert.equal(zcodeResult.zcodeResumeCode, 0)
    assert.ok(events.some(event => event.name === 'SessionStart' && event.source === 'resume'))
    if (process.env.DAM_EXTERNAL_TEST_ZCODE_COMPACT === '1') {
      assert.ok(events.some(event => event.name === 'SessionStart' && event.source === 'compact' && event.hasContext))
      const compactedTurn = modelRequests.find(request => JSON.stringify(request).includes(zcodePostCompactPrompt))
      assert.ok(compactedTurn, 'the ZCode session sent the turn after compaction to the model')
      assert.ok(JSON.stringify(compactedTurn).includes(contextMarker), 'ZCode delivered project memory after compaction')
    }
  }
  if (host === 'claude') {
    assert.ok(events.some(event => event.name === 'SessionEnd'))
    if (process.env.DAM_EXTERNAL_TEST_COMPACT === '1') {
      assert.equal(claudeResult.claudeCompactCode, 0)
      assert.ok(events.some(event => event.name === 'PreCompact' && event.trigger === 'manual' && !event.diagnostic))
      assert.ok(events.some(event => event.name === 'SessionStart' && event.source === 'compact' && event.hasContext))
    }
  }
  assert.ok(summary.sawProjectNotes)
}

try {
  desktop = await startExternalDesktop(root, process.env.DAM_EXTERNAL_DSH_DESKTOP, project, '## Fixture\n' + contextMarker)
  const { dsh, scope, identity } = desktop
  const connection = connectDsh(dsh)
  const status = await connection.call('status', {}, { scope, instanceId: identity.instanceId })
  assert.deepEqual(status.scope, scope)
  toolMarker = status.settingsRevision
  await testBoundHost(desktop, connection)
} finally {
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await desktop?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
}
