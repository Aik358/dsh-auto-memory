import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { startExternalDesktop } from './auto-memory-external-desktop.mjs'
import { withKimiAcp } from './auto-memory-kimi-acp.mjs'
import { CLOUD_CODE_HOOK_EVENTS, KIMI_HOOK_EVENTS } from '../../lib/harness/kimi.js'
import { connectDsh } from '../../lib/terminal/client.js'

const [hostArg, desktopArg, variant] = process.argv.slice(2)
assert.ok(hostArg && desktopArg && [undefined, '--cloud-teahouse'].includes(variant),
  'Pass Kimi dist/main.mjs or cloudcode.exe, DSH Desktop executable, and --cloud-teahouse for Cloud Code')
const cloudTeahouse = variant === '--cloud-teahouse'
const harness = cloudTeahouse ? 'cloud-code' : 'kimi'
const hostInfo = cloudTeahouse
  ? { name: 'Cloud Teahouse Cloud Code CLI', version: '0.2.0', settingsDir: '.cloud-code' }
  : { name: 'MoonshotAI Kimi Code CLI', version: '2.8.0', settingsDir: '.kimi-code' }
const candidate = resolve(process.env.DAM_EXTERNAL_PLUGIN_DIR ?? fileURLToPath(new URL('../../', import.meta.url)))
const { getExternalHostEvents } = await import(pathToFileURL(join(candidate, 'lib/harness/external-hosts.js')).href)
assert.deepEqual(getExternalHostEvents(harness), cloudTeahouse ? CLOUD_CODE_HOOK_EVENTS : KIMI_HOOK_EVENTS)
const entry = join(candidate, 'lib/harness/external-entry.js')
const dam = join(candidate, 'lib/terminal/cli.js')
const hostEntry = resolve(hostArg)
const root = await mkdtemp(join(process.env.DAM_KIMI_TEST_SCRATCH ?? tmpdir(), 'dam-auto-memory-kimi-live-'))
const project = join(root, 'project')
const other = join(root, 'other')
const profile = join(root, 'host-profile')
const mcpConfig = join(project, hostInfo.settingsDir, 'mcp.json')
const traceFile = join(root, 'trace.ndjson')
const hookEntry = fileURLToPath(new URL('./auto-memory-kimi-trace.mjs', import.meta.url))
const bindingFile = join(root, 'binding.json')
const projectNote = 'KIMI_BOUND_PROJECT_SENTINEL'
const prompt = 'Kimi Auto Memory read-only fixture'
const toolNames = ['status', 'memory_list', 'memory_recall']
const qualified = name => 'mcp__auto_memory__' + name
const toolCallId = name => 'call_kimi_' + name
const reports = []
const requests = []
let desktop

const inherited = /^(path|pathext|systemroot|windir|comspec|systemdrive|programfiles(?:\(x86\))?|processor_architecture)$/i
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => inherited.test(name))),
  HOME: profile, USERPROFILE: profile, KIMI_CODE_HOME: profile, APPDATA: join(profile, 'roaming'),
  LOCALAPPDATA: join(profile, 'local'), TEMP: root, TMP: root, TMPDIR: root, NO_COLOR: '1',
  KIMI_DISABLE_TELEMETRY: '1', KIMI_CODE_NO_AUTO_UPDATE: '1',
  ...(cloudTeahouse ? { CLOUD_CODE_HOME: profile, CLOUD_CODE_NO_AUTO_UPDATE: '1' } : {}),
}

function output(message, response, status) {
  const data = { id: 'chatcmpl-kimi-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture' }
  response.setHeader('Content-Type', 'text/event-stream')
  response.end([
    { ...data, choices: [{ index: 0, delta: { role: 'assistant', ...message }, finish_reason: null }] },
    { ...data, choices: [{ index: 0, delta: {}, finish_reason: status }],
      usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
  ].map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n')
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return res.writeHead(404).end()
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const request = JSON.parse(Buffer.concat(chunks))
    requests.push(request)
    const results = request.messages.filter(message => message.role === 'tool')
    const next = toolNames.find(name => !results.some(message => message.tool_call_id === toolCallId(name)) &&
      request.tools?.some(tool => tool.function?.name === qualified(name)))
    if (!next) return output({ content: 'Kimi fixture complete' }, res, 'stop')
    output({ tool_calls: [{ index: 0, id: toolCallId(next), type: 'function', function: {
      name: qualified(next), arguments: JSON.stringify(next === 'memory_recall' ? { query: projectNote } : {}),
    } }] }, res, 'tool_calls')
  } catch (error) {
    reports.push({ fixtureError: error.message })
    res.writeHead(500).end()
  }
})

async function run(args, { cwd = project, trusted = false, input, command = process.execPath } = {}) {
  const child = spawn(command, args, {
    cwd, env: { ...env, ...(trusted ? { KIMI_CODE_TRUST_WORKSPACE: '1' } : {}) },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, signal: AbortSignal.timeout(45_000),
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  const [code] = await once(child, 'close')
  return { code, stdout, stderr }
}

function runHost(args, trusted) {
  return cloudTeahouse ? run(args, { command: hostEntry }) : run([hostEntry, ...args], { trusted })
}

async function config(origin, decision) {
  const hook = [hookEntry, entry, bindingFile, traceFile, harness].map(part => JSON.stringify(part.replaceAll('\\', '/')))
  const command = ['"' + process.execPath.replaceAll('\\', '/') + '"', ...hook].join(' ')
  const hookRules = [...getExternalHostEvents(harness), 'PermissionRequest', 'PermissionResult'].map(event =>
    ['[[hooks]]', 'event = ' + JSON.stringify(event), 'command = ' + JSON.stringify(command), 'timeout = 7'].join('\n'))
  const permissions = toolNames.map(name => ['[[permission.rules]]',
    'decision = ' + JSON.stringify(name === 'memory_recall' ? decision : 'allow'),
    'pattern = ' + JSON.stringify(qualified(name)),
  ].join('\n'))
  await writeFile(join(profile, 'config.toml'), [
    'default_model = "fixture"', '[providers.fixture]', 'type = "openai"',
    'base_url = ' + JSON.stringify(origin + '/v1'), 'api_key = "loopback-fixture-only"',
    '[models.fixture]', 'provider = "fixture"', 'model = "fixture"', 'max_context_size = 65536',
    ...permissions, ...hookRules,
  ].join('\n') + '\n')
}

async function readTrace() {
  return (await readFile(traceFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''
    throw error
  })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function toolMessages(frames, name) {
  return frames.flatMap(request => request.messages)
    .filter(message => message.role === 'tool' && message.tool_call_id === toolCallId(name))
}

function toolData(frames, name) {
  return toolMessages(frames, name).map(({ content }) => JSON.parse(content.slice(content.indexOf('\n') + 1)))
}

function hasModelContext(frames, promptText = '') {
  return frames.some(({ messages }) => {
    const userMessages = messages.filter(message => message.role === 'user').map(message => JSON.stringify(message.content))
    const start = promptText ? userMessages.findLastIndex(content => content.includes(promptText)) : 0
    return start >= 0 && userMessages.slice(start).some(content => content.includes(projectNote) && content.includes('hook_result'))
  })
}

async function invoke(label, args, trusted) {
  const first = requests.length
  const firstEvent = (await readTrace()).length
  const result = await runHost(['--output-format', 'stream-json', ...args], trusted)
  const frames = requests.slice(first)
  const events = (await readTrace()).slice(firstEvent)
  assert.equal(result.code, 0, JSON.stringify({ label, ...result, reports, events }))
  assert.ok(frames.length, JSON.stringify({ label, ...result, events }))
  reports.push({ label, exit: result.code, modelRequests: frames.length, context: hasModelContext(frames), events,
    offered: [...new Set(frames.flatMap(frame => (frame.tools ?? []).map(tool => tool.function?.name)).filter(name => name?.startsWith('mcp__auto_memory__')))] })
  return { frames, events, result }
}

async function verifyAcp(origin) {
  await config(origin, 'ask')
  const firstEvent = (await readTrace()).length
  await withKimiAcp(hostEntry, project, env, async ({ request, approvals, updates }) => {
    const cwd = project
    const mcpServers = []
    const { sessionId } = await request('session/new', { cwd, mcpServers })
    const send = text => request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
    const first = requests.length
    await send('Kimi ACP permissions fixture')
    const frames = requests.slice(first)
    assert.ok(hasModelContext(frames, 'Kimi ACP permissions fixture'))
    assert.deepEqual(approvals.map(approval => approval.outcome), ['reject_once'])
    assert.ok(toolMessages(frames, 'memory_recall').some(message => /denied|blocked|reject/iu.test(message.content)))
    assert.ok(toolMessages(frames, 'memory_recall').every(message => !message.content.includes(projectNote)))

    await send('/compact')
    const deadline = Date.now() + 15_000
    let compactEvents = []
    while (Date.now() < deadline) {
      compactEvents = (await readTrace()).slice(firstEvent).filter(event => event.name.endsWith('Compact'))
      if (compactEvents.some(event => event.name === 'PostCompact')) break
      await delay(100)
    }
    assert.deepEqual(compactEvents.map(event => [event.name, event.trigger]),
      [['PreCompact', 'manual'], ['PostCompact', 'manual']], JSON.stringify(updates.slice(-6)))
    const firstAfterCompact = requests.length
    await send('Kimi ACP after compact fixture')
    assert.ok(hasModelContext(requests.slice(firstAfterCompact), 'Kimi ACP after compact fixture'))
    await request('session/close', { sessionId })
    const firstAfterClose = requests.length
    await request('session/load', { sessionId, cwd, mcpServers })
    await send('Kimi ACP after explicit close fixture')
    assert.ok(hasModelContext(requests.slice(firstAfterClose), 'Kimi ACP after explicit close fixture'))
    await request('session/close', { sessionId })
    const events = (await readTrace()).slice(firstEvent)
    assert.equal(events.filter(event => event.name === 'SessionEnd' && event.reason === 'exit').length, 2)
    assert.ok(events.some(event => event.name === 'SessionStart' && event.source === 'resume'))
    assert.ok(events.every(event => !event.diagnostic), JSON.stringify(events))
    reports.push({ label: 'acp-close-resume-compact-and-permission', approvals, events })
  })
}

async function probeLateStop() {
  const connection = connectDsh(desktop.dsh)
  const options = { scope: desktop.scope, instanceId: desktop.identity.instanceId }
  const event = { harness: 'kimi', sessionId: 'kimi-late-stop-fixture' }
  const observe = (name, fields) => connection.call('external.lifecycle', { ...event, name, ...fields }, options)
  await observe('SessionStart', { source: 'startup' })
  const first = await observe('UserPromptSubmit')
  await observe('SessionEnd')
  const lateStop = await observe('Stop', { turnId: '0' })
  await observe('SessionStart', { source: 'resume' })
  const resumed = await observe('UserPromptSubmit')
  assert.equal(first.status, 'accepted')
  assert.ok(first.context?.includes(projectNote))
  assert.equal(lateStop.status, 'out-of-order')
  const reinjected = Boolean(resumed.context?.includes(projectNote))
  reports.push({ label: 'late-stop-order-probe', resumedStatus: resumed.status, reinjected })
  assert.equal(reinjected, true)
}

async function verify() {
  await Promise.all([mkdir(join(project, hostInfo.settingsDir), { recursive: true }), mkdir(other), mkdir(profile)])
  const version = await runHost(['--version'])
  assert.equal(version.code, 0)
  assert.equal(version.stdout.trim(), hostInfo.version)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = 'http://127.0.0.1:' + server.address().port

  process.env.DAM_EXTERNAL_PLUGIN_DIR = candidate
  desktop = await startExternalDesktop(root, resolve(desktopArg), project, '## Kimi fixture\n' + projectNote)
  await writeFile(bindingFile, JSON.stringify({
    version: 1, harness, workspace: project, dshSessionId: desktop.scope.sessionId, dsh: desktop.dsh,
  }))
  await writeFile(mcpConfig, JSON.stringify({ mcpServers: {
    auto_memory: { command: process.execPath, args: [entry, harness, 'mcp', bindingFile], enabledTools: toolNames },
  } }))
  const cli = [dam, '--harness', harness, '--binding', bindingFile, 'status', '--json']
  assert.equal((await run(cli)).code, 0)
  const cross = await run(cli, { cwd: other })
  assert.equal(cross.code, 1)
  assert.match(cross.stderr + cross.stdout, /scope-forbidden/u)
  const rejectedHook = await run([entry, harness, 'hook', bindingFile], { cwd: other,
    input: JSON.stringify({ cwd: other, session_id: 'other-session', hook_event_name: 'UserPromptSubmit' }) })
  assert.equal(rejectedHook.stdout.trim(), '')
  assert.match(rejectedHook.stderr, /scope-forbidden/u)
  reports.push({ label: 'binding', boundCliExit: 0, crossWorkspaceCliExit: cross.code, crossWorkspaceHookRejected: true })

  await config(origin, 'allow')
  if (!cloudTeahouse) {
    const untrusted = await invoke('untrusted-project-mcp', ['-p', prompt], false)
    assert.ok(toolNames.every(name => !untrusted.frames.some(frame => frame.tools?.some(tool => tool.function?.name === qualified(name)))))
  }

  const startup = await invoke(cloudTeahouse ? 'cloud-project-mcp-without-trust-override' : 'trusted-startup', ['-p', prompt], true)
  assert.ok(hasModelContext(startup.frames))
  assert.ok(startup.events.some(event => event.name === 'SessionStart' && event.source === 'startup'))
  assert.ok(startup.events.some(event => event.name === 'UserPromptSubmit' && event.context))
  assert.ok(startup.events.some(event => event.name === 'Stop' && event.turnId === (cloudTeahouse ? undefined : 0)))
  assert.equal(startup.events.some(event => event.name === 'SessionEnd' && event.reason === 'exit'), cloudTeahouse)
  assert.ok(toolData(startup.frames, 'status').some(data =>
    data.connection === 'ready' && data.scope.sessionId === desktop.scope.sessionId))
  assert.ok(toolData(startup.frames, 'memory_list').some(data => data.wsBound && data.ws === project && data.notesSize > 0))
  assert.ok(toolData(startup.frames, 'memory_recall').some(data => data.hits?.some(hit => hit.line.includes(projectNote))))

  const sessionId = startup.events.find(event => event.name === 'SessionStart').sessionId
  const resumed = await invoke('resume', ['--session', sessionId, '-p', 'Host resume fixture'], true)
  assert.ok(resumed.events.some(event => event.name === 'SessionStart' && event.source === 'resume'))
  assert.ok(hasModelContext(resumed.frames))
  assert.ok(resumed.events.some(event => event.name === 'UserPromptSubmit' && event.context === cloudTeahouse))
  if (cloudTeahouse) assert.ok(hasModelContext(resumed.frames, 'Host resume fixture'))

  await config(origin, 'deny')
  const denied = await invoke('deny-recall', ['-p', prompt], true)
  const deniedTool = toolMessages(denied.frames, 'memory_recall')
  assert.ok(deniedTool.length)
  assert.ok(deniedTool.every(message => !JSON.stringify(message).includes(projectNote)))
  assert.ok(deniedTool.some(message => /denied|blocked|reject/iu.test(JSON.stringify(message))))
  if (!cloudTeahouse) {
    await verifyAcp(origin)
    await probeLateStop()
  }
  assert.ok([...startup.events, ...resumed.events].every(event => !event.diagnostic),
    JSON.stringify([...startup.events, ...resumed.events]))
  console.log(JSON.stringify({ host: hostInfo.name, hostVersion: hostInfo.version, bindingHarness: harness, dshDesktopVersion: '0.2.2-rc.5',
    dshIdentity: { pluginVersion: desktop.identity.pluginVersion, buildId: desktop.identity.buildId }, reports }))
}

try {
  await verify()
} catch (error) {
  console.error(JSON.stringify({ reports }))
  throw error
} finally {
  server.close()
  try { await desktop?.close() } finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }) }
}
