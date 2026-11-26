import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startExternalDesktop } from './auto-memory-external-desktop.mjs'

const [desktopPath, pluginPath] = process.argv.slice(2)
if (!desktopPath || !pluginPath || process.argv.length !== 4) {
  process.stderr.write('Usage: node tests/live/auto-memory-antigravity-plugin.mjs DESKTOP_EXE INSTALLED_PACKAGE_DIR\n')
  process.exit(2)
}

const scratch = process.env.DAM_EXTERNAL_TEST_SCRATCH || tmpdir()
const root = await mkdtemp(path.join(scratch, 'dam-antigravity-plugin-'))
const workspace = path.join(root, 'project')
const marker = 'synthetic-antigravity-bound-memory'
let desktop
let server

try {
  await mkdir(workspace)
  const note = `# Isolated project memory\n\n${marker}\n`
  desktop = await startExternalDesktop(root, desktopPath, workspace, note)

  const bindingDirectory = path.join(workspace, '.agents')
  await mkdir(bindingDirectory)
  const bindingFile = path.join(bindingDirectory, 'auto-memory-antigravity.json')
  await writeFile(bindingFile, JSON.stringify({
    version: 1,
    harness: 'antigravity',
    workspace,
    dshSessionId: desktop.scope.sessionId,
    dsh: desktop.dsh,
  }))

  const plugin = path.join(pluginPath, 'integrations', 'antigravity')
  const hookEntry = path.join(plugin, 'scripts', 'hook.mjs')
  const payload = {
    conversationId: 'antigravity-fixture-session',
    workspacePaths: [workspace],
    lastUserInput: 'private synthetic prompt',
    transcriptPath: path.join(workspace, 'synthetic-transcript.jsonl'),
  }

  function runHook(eventName, input = payload) {
    const result = spawnSync(process.execPath, [hookEntry, eventName], {
      cwd: plugin,
      input: JSON.stringify(input),
      encoding: 'utf8',
      timeout: 7_000,
      windowsHide: true,
    })
    assert.equal(result.status, 0, result.stderr || result.error?.message)
    assert.equal(result.stderr, '', eventName)
    return JSON.parse(result.stdout)
  }

  const start = runHook('SessionStart')
  assert.match(start.injectSteps?.[0]?.systemMessage?.systemMessage || '', new RegExp(marker))
  assert.deepEqual(runHook('PreInvocation'), {})
  assert.deepEqual(runHook('Stop'), { decision: 'stop' })
  assert.deepEqual(runHook('SessionStart', { ...payload, workspacePaths: [workspace, root] }), {})

  const mcpEntry = path.join(plugin, 'scripts', 'mcp.mjs')
  const environment = { ...process.env, DAM_AUTO_MEMORY_WORKSPACE_ROOT: workspace }
  server = spawn(process.execPath, [mcpEntry], {
    cwd: workspace,
    env: environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const lines = createInterface({ input: server.stdout })[Symbol.asyncIterator]()
  let requestId = 0

  async function request(method, params = {}) {
    const id = ++requestId
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    const { value } = await lines.next()
    assert.ok(value, 'MCP server closed before answering ' + method)
    return JSON.parse(value)
  }

  const initialized = await request('initialize', { protocolVersion: '2025-06-18' })
  assert.equal(initialized.result.serverInfo.name, 'auto-memory')
  server.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
  const listed = await request('tools/list')
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['status', 'memory_list', 'memory_recall'])
  const recalled = await request('tools/call', {
    name: 'memory_recall',
    arguments: { query: marker },
  })
  assert.equal(recalled.result.isError, undefined)
  assert.match(recalled.result.content[0].text, new RegExp(marker))

  const serverClosed = new Promise(resolve => server.once('close', resolve))
  server.stdin.end()
  const serverCode = await serverClosed
  assert.equal(serverCode, 0)

  const wrongWorkspace = spawnSync(process.execPath, [mcpEntry], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    timeout: 5_000,
    windowsHide: true,
  })
  assert.equal(wrongWorkspace.status, 1)
  assert.match(wrongWorkspace.stderr, /scope-forbidden/u)

  console.log(JSON.stringify({
    check: 'Antigravity plugin bridge on real DSH Desktop',
    hostVersion: '0.2.2-rc.5',
    pluginVersion: desktop.identity.pluginVersion,
    buildId: desktop.identity.buildId,
    hooks: ['SessionStart', 'PreInvocation', 'Stop'],
    mcpTools: listed.result.tools.map(tool => tool.name),
    workspaceDenied: wrongWorkspace.status === 1,
    modelRequests: 0,
  }))
} finally {
  if (server?.exitCode === null && server.signalCode === null) server.kill()
  await desktop?.close()
  await rm(root, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 })
}
