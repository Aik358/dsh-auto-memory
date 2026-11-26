import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const packageName = '@a9i5k4/dsh-auto-memory'
const [mode, ...args] = process.argv.slice(2)
const mutationMode = mode === '--mutated'
const updateMode = mode === '--update-install'
const candidateMode = mode === '--candidate'
const timeoutMaintenance = mode === '--maintain-timeout'
const modelMaintenance = mode === '--maintain-model' || timeoutMaintenance
const maintainMode = mode === '--maintain' || modelMaintenance
const [desktopArg, pluginArg, thirdArg] = mutationMode || maintainMode || updateMode || candidateMode ? args : [mode, ...args]
if (!desktopArg || !pluginArg) {
  console.error('Usage: node tests/live/auto-memory-cli-baseline.mjs DESKTOP_EXE V346_PACKAGE_DIR [PLAYWRIGHT_ENTRY]')
  console.error('       node tests/live/auto-memory-cli-baseline.mjs --candidate DESKTOP_EXE CANDIDATE_PACKAGE_DIR')
  console.error('       node tests/live/auto-memory-cli-baseline.mjs --mutated DESKTOP_EXE CANDIDATE_PACKAGE_DIR [DAM_CMD]')
  console.error('       node tests/live/auto-memory-cli-baseline.mjs --maintain DESKTOP_EXE PLUGIN_PACKAGE_DIR [DAM_CMD]')
  console.error('       node tests/live/auto-memory-cli-baseline.mjs --maintain-model DESKTOP_EXE PLUGIN_PACKAGE_DIR [DAM_CMD]')
  console.error('       node tests/live/auto-memory-cli-baseline.mjs --maintain-timeout DESKTOP_EXE PLUGIN_PACKAGE_DIR [DAM_CMD]')
  console.error('       node tests/live/auto-memory-cli-baseline.mjs --update-install DESKTOP_EXE PLUGIN_PACKAGE_DIR EXPECTED_REGISTRY_VERSION')
  process.exit(2)
}
const desktop = resolve(desktopArg)
const resources = join(dirname(desktop), 'resources')
const runtime = join(resources, 'app.asar', 'dsh')
const runtimeFiles = join(resources, 'runtime')
const desktopHost = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'index.js')
const compiledQueryRoot = process.env.DAM_SESSION_QUERY_BUILD_DIR
  ? resolve(process.env.DAM_SESSION_QUERY_BUILD_DIR) : null
const queryPreload = new URL('./fixtures/auto-memory-compiled-session-query.mjs', import.meta.url).href
const browserFixture = new URL('./fixtures/auto-memory-browser-session.mjs', import.meta.url).href
const api = '/api/dsh-auto-memory/'
const terminalPath = api + 'terminal/v1'
const report = (check, details = {}) => console.log(JSON.stringify({ check, ...details }))
const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))
const browserAutomation = !mutationMode && !maintainMode && !updateMode && !candidateMode && thirdArg
  ? await import(pathToFileURL(resolve(thirdArg))) : null
const webCalendarTitle = 'Calendar item written by Web UI'
const echoId = 'validation.echo'
const secrets = new Set()

function remember(value) {
  if (value) secrets.add(value)
  return value
}

function scrub(text) {
  let safe = String(text)
  for (const secret of secrets) safe = safe.replaceAll(secret, '<redacted>')
  return safe.replace(/([?&]token=)[^\s"'&]+/giu, '$1<redacted>')
}

async function withDeadline(promise, milliseconds, label) {
  const timeout = new AbortController()
  try {
    return await Promise.race([promise, delay(milliseconds, undefined, { signal: timeout.signal }).then(() => {
      throw new Error(label + ' timed out')
    })])
  } finally {
    timeout.abort()
  }
}

function environment(root, home) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(DSH_|DEEPSEEK_|ELECTRON_|NODE_OPTIONS$)/iu.test(name) && !/(KEY|SECRET|TOKEN|PASSWORD|PROXY)/iu.test(name)))
  return {
    ...inherited,
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(root, 'agents'),
    DSH_TELEMETRY_DISABLED: '1',
    DSH_CLIENT_VERSION: '0.2.2-rc.5',
    LOCALAPPDATA: join(root, 'local-app-data'),
    XDG_RUNTIME_DIR: join(root, 'runtime'),
    ELECTRON_RUN_AS_NODE: '1',
    DSH_DESKTOP_NODE_EXECUTABLE: desktop,
  }
}

function startDesktop(root, home, modelOrigin) {
  const profile = join(home, 'profiles', 'desktop')
  const env = environment(root, home)
  if (modelOrigin) env.DEEPSEEK_API_KEY = 'dam-loopback-fixture-key'
  if (updateMode) {
    for (const name of Object.keys(env).filter(key => /^npm_config_/iu.test(key))) delete env[name]
    Object.assign(env, {
      npm_config_userconfig: join(root, 'npm-user-config'),
      npm_config_globalconfig: join(root, 'npm-global-config'),
      npm_config_cache: join(root, 'npm-cache'),
      npm_config_registry: 'https://registry.npmjs.org/',
      npm_config_ignore_scripts: 'true',
      npm_config_legacy_peer_deps: 'true',
      npm_config_omit: 'optional',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
    })
  }
  if (browserAutomation) env.DAM_BASELINE_ASAR_DSH = runtime
  if (compiledQueryRoot) {
    env.DAM_SESSION_QUERY_BUILD_DIR = compiledQueryRoot
    env.DAM_SESSION_QUERY_ASAR_DSH = runtime
  }
  const child = spawn(desktop, [
    '--expose-internals',
    ...(compiledQueryRoot ? ['--import', queryPreload] : []),
    desktopHost, runtime, profile,
    join(runtimeFiles, 'primary-runtime'),
    join(runtimeFiles, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs'),
    join(runtimeFiles, 'bin'),
  ], { cwd: profile, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  const ready = Promise.withResolvers()
  const exited = Promise.withResolvers()
  let output = ''
  let stopped = false
  let runId
  let started = false
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { output = (output + chunk).slice(-16000) })
  }
  child.on('message', (message) => {
    if (message.type === 'starting') runId = message.runId
    if (message.type === 'shutdown-complete') stopped = true
    if (message.type === 'fatal') ready.reject(new Error('Desktop Host reported startup failure'))
    if (message.type === 'ready') {
      started = true
      const url = new URL(message.url)
      remember(url.searchParams.get('token'))
      const graph = message.injections?.find((row) => row.name === '__DSH_BOOT__')?.value
      ready.resolve({ url, runId, graph })
    }
  })
  child.on('error', ready.reject)
  child.on('close', (code, signal) => {
    ready.reject(new Error('Desktop Host exited before readiness (' + (code ?? signal) + ')'))
    exited.resolve({ code, signal })
  })
  return {
    async ready() {
      try {
        return await withDeadline(ready.promise, 65000, 'Desktop Host startup')
      } catch (error) {
        throw new Error(error.message + '\n' + scrub(output))
      }
    },
    output: () => scrub(output),
    async stop() {
      if (child.connected) await new Promise((done) => child.send({ type: 'shutdown' }, () => done()))
      let result
      try {
        result = await withDeadline(exited.promise, 12000, 'Desktop Host shutdown')
      } catch (error) {
        child.kill()
        await withDeadline(exited.promise, 5000, 'Desktop Host force stop')
        throw error
      }
      if (started) {
        assert.equal(result.code, 0, 'Desktop Host shutdown exit code')
        assert.equal(stopped, true, 'Desktop Host shutdown-complete IPC')
      }
    },
  }
}

async function prepare(root, plugin, modelOrigin) {
  const home = join(root, 'dsh')
  const profile = join(home, 'profiles', 'desktop')
  const scope = join(profile, 'node_modules', '@a9i5k4')
  await mkdir(scope, { recursive: true })
  const installed = join(profile, 'node_modules', packageName)
  if (updateMode) await cp(plugin, installed, { recursive: true })
  else await symlink(plugin, installed, process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(join(profile, 'package.json'), JSON.stringify({
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } },
  }))
  await writeFile(join(profile, 'cordis.yml'), '[]\n')
  const overlay = []
  if (compiledQueryRoot) overlay.push('- id: session-query-sqlite', '  config:', '    openAt: first-search', '    path: ":memory:"')
  if (modelOrigin) overlay.push('- id: llm-deepseek', '  config:', '    baseURL: ' + JSON.stringify(modelOrigin + '/anthropic'))
  if (browserAutomation) overlay.push(
    '- id: ui-settings-models', '  config:', '    credentialOnboarding: false',
    '- insert:', '    - id: dam-baseline-browser-session', '      name: ' + JSON.stringify(browserFixture),
  )
  if (overlay.length) await writeFile(join(profile, 'cordis.patch.yml'), overlay.join('\n') + '\n')
  await writeFile(join(home, 'dsh-auto-memory.json'), JSON.stringify({
    semanticEngineMode: 'lexical',
    memoryRoot: join(home, 'memory'),
    userMemoryDir: join(home, 'user'),
    externalSources: {},
    autoConsolidate: false,
    teamEnabled: false,
    globalBriefEnabled: false,
    handoffEnabled: true,
    autoPopupEnabled: false,
    welcomeTourEnabled: false,
    ...(browserAutomation && { workbenchEnabled: false }),
    ...(maintainMode && { maintainScheduleEnabled: false, consolidateScheduleEnabled: false }),
    ...(modelOrigin && { subagentProvider: 'deepseek-official', subagentModel: 'deepseek-v4-flash' }),
    ...(timeoutMaintenance && { subagentTimeoutSeconds: 30 }),
  }))
  return home
}

function request(origin, pathname, { body, cookie, query, method } = {}) {
  const url = new URL(pathname, origin)
  if (query) url.search = new URLSearchParams(query).toString()
  const headers = {}
  if (cookie) headers.cookie = cookie
  if (body) headers['content-type'] = 'application/json'
  return fetch(url, {
    method: method ?? (body ? 'POST' : 'GET'),
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(9000),
  })
}

function cookieOf(response) {
  const value = response.headers.get('set-cookie')
  assert.ok(value?.includes('HttpOnly'), 'HttpOnly authentication cookie issued')
  const cookie = value.split(';', 1)[0]
  remember(cookie.slice(cookie.indexOf('=') + 1))
  return remember(cookie)
}

function remoteRequest(origin, method, args, cookie) {
  return request(origin, '/api/' + method, {
    cookie, body: { type: 'client-request', rpcId: 'dam-cli-baseline', method, payload: { args } },
  })
}

async function remote(origin, method, args, cookie) {
  const response = await remoteRequest(origin, method, args, cookie)
  assert.equal(response.status, 200, method)
  const envelope = await response.json()
  assert.ok(envelope.result?.ok, method + ' failed: ' + JSON.stringify(envelope.result))
  return envelope.result.value
}

async function authenticate(url) {
  assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port, 'loopback Desktop Host')
  assert.ok(url.searchParams.get('token'), 'Desktop IPC supplied launch credential')
  const origin = url.origin
  const denied = await remoteRequest(origin, 'settings/describe', {})
  assert.equal(denied.status, 401)
  await denied.body?.cancel()
  const browser = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(9000) })
  assert.equal(browser.status, 303)
  assert.equal(browser.headers.get('location'), './')
  const browserCookie = cookieOf(browser)
  const operator = await request(origin, '/connect', {
    query: { token: url.searchParams.get('token'), interactions: 'none' },
  })
  assert.equal(operator.status, 302, 'official non-page /connect exchange')
  const operatorCookie = cookieOf(operator)
  const lifecycle = new URL(operator.headers.get('location'), origin)
  assert.ok(lifecycle.hostname === '127.0.0.1' && lifecycle.port === url.port, 'local lifecycle endpoint')
  assert.equal((await remote(origin, 'settings/describe', {}, operatorCookie)).namespaces instanceof Array, true)
  await browser.body?.cancel()
  await operator.body?.cancel()
  return { origin, browserCookie, operatorCookie }
}

async function pluginRequest(connection, path, { status = 200, ...options } = {}) {
  const response = await request(connection.origin, api + path, { cookie: connection.browserCookie, ...options })
  assert.equal(response.status, status, path + ': unexpected HTTP status')
  return response.json()
}

async function createWorkspace(connection, path) {
  await mkdir(path)
  const { origin, browserCookie } = connection
  const { workspace } = await remote(origin, 'workspace/create', { request: { path } }, browserCookie)
  assert.ok(workspace.workspaceId, 'workspace/create returned its registry ID')
  const { sessionId } = await remote(origin, 'session/create', { request: { workspaceId: workspace.workspaceId } }, browserCookie)
  assert.ok(sessionId)
  return { sessionId, workspaceId: workspace.workspaceId }
}

async function exercise(plugin, root, connection, label) {
  const ws = join(root, 'project-A')
  const otherWs = join(root, 'project-B')
  const { sessionId, workspaceId } = await createWorkspace(connection, ws)
  const { sessionId: otherId, workspaceId: otherWorkspaceId } = await createWorkspace(connection, otherWs)
  const boundWorkspace = async (sessionId) => {
    const { _resolved } = await pluginRequest(connection, 'event-list', { query: { sessionId } })
    assert.equal(_resolved.wsBound, true)
    assert.equal(_resolved.sessionId, sessionId)
    return _resolved.ws
  }
  const bound = await boundWorkspace(sessionId)
  const boundB = await boundWorkspace(otherId)
  const state = await pluginRequest(connection, 'state', { query: { ws: bound } })
  const stateB = await pluginRequest(connection, 'state', { query: { ws: boundB } })
  assert.equal(await realpath(state.ws), await realpath(ws))
  assert.equal(await realpath(stateB.ws), await realpath(otherWs))
  assert.notEqual(state.notesPath, stateB.notesPath)
  assert.equal(state.autoPopupEnabled, false)
  await pluginRequest(connection, 'config', { body: { autoPopupEnabled: true } })
  assert.equal((await pluginRequest(connection, 'config')).config.autoPopupEnabled, true)
  assert.equal((await pluginRequest(connection, 'state', { query: { ws: bound } })).autoPopupEnabled, true)
  report('settings state readback', { label, oldValue: false, newValue: true, sameActivation: true })

  const content = '## tungstenwren baseline\nThe isolated source contains the cobalt fixture receipt.'
  const expectedNotesPath = state.notesPath
  const note = await pluginRequest(connection, 'note', { body: { content, sessionId, expectedNotesPath } })
  assert.equal(note.path, expectedNotesPath)
  const source = await pluginRequest(connection, 'file', { query: { path: note.path, sessionId } })
  assert.ok(source.content.includes(content), 'saved note source readback')
  await pluginRequest(connection, 'note', { status: 409, body: { content: 'stale destination fixture', sessionId, expectedNotesPath: stateB.notesPath } })
  assert.equal(sha256((await pluginRequest(connection, 'file', { query: { path: note.path, sessionId } })).content), sha256(source.content))
  const recallBody = { query: 'tungstenwren', limit: 8, scope: 'current', sessionId }
  const recall = await pluginRequest(connection, 'recall', { body: recallBody })
  assert.match(recall.result, /tungstenwren/i)
  assert.match(recall.result, /cobalt fixture receipt/i)
  const otherRecall = await pluginRequest(connection, 'recall', { body: { ...recallBody, sessionId: otherId } })
  assert.doesNotMatch(otherRecall.result, /cobalt fixture receipt/i)
  await pluginRequest(connection, 'recall', { status: 400, body: { ...recallBody, sessionId: 'isolated-missing-session' } })
  report('recall and source readback', { label, source: basename(note.path), sourceSha256: sha256(source.content), hits: recall.hits?.length ?? 0, rejected: [400, 409], crossWorkspace: 'isolated' })

  // The baseline UI reads checkpoints. Use the package's real store writer to seed
  // them without a model call. Every list, detail and source read uses live routes.
  const { eventStorePre, EVENT_STORE_FILENAME } = await import(pathToFileURL(join(plugin, 'lib', 'event-store.js')))
  const storePath = join(state.projectDir, 'handoff', EVENT_STORE_FILENAME)
  const event = await eventStorePre.create(storePath, { name: 'Baseline checkpoint 端到端', summary: 'Isolated readback' })
  const checkpoint = {
    kind: 'progress', text: 'Checkpoint checked the source note',
    goal: 'Goal: verify readback', state: 'State: note found', dead: 'Dead: none', next: 'Next: inspect source',
    sourceRef: 'MEMORY.md#tungstenwren', quoteRef: 'The isolated source contains the cobalt fixture receipt.',
    quoteLine: source.content.split('\n').findIndex((line) => line.includes('cobalt fixture receipt')) + 1,
    rel: 'MEMORY.md', bytes: Buffer.byteLength(source.content), sha256: sha256(source.content), idemKey: 'baseline-checkpoint',
  }
  await eventStorePre.append(storePath, event.id, { checkpoint })
  const list = await pluginRequest(connection, 'event-list', { query: { sessionId, limit: 1 } })
  const row = list.events?.find((item) => item.id === event.id)
  assert.ok(row, 'seeded event in the live list')
  assert.equal(row.checkpointCount, 1)
  assert.equal(list._resolved.sessionId, sessionId)
  assert.equal(list._resolved.wsBound, true)
  const detail = await pluginRequest(connection, 'event-detail', { query: { sessionId, id: event.id } })
  const returned = detail.event.checkpoints[0]
  for (const field of ['text', 'goal', 'state', 'dead', 'next', 'sourceRef', 'quoteRef', 'quoteLine', 'rel', 'bytes', 'sha256']) {
    assert.equal(returned[field], checkpoint[field], 'checkpoint ' + field)
  }
  assert.equal(source.content.split('\n')[returned.quoteLine - 1], returned.quoteRef)
  await pluginRequest(connection, 'event-detail', { status: 404, query: { sessionId: otherId, id: event.id } })
  report('board event checkpoint', { label, checkpoints: row.checkpointCount, sections: 4, quoteLine: returned.quoteLine, sourceSha256: returned.sha256, crossWorkspaceStatus: 404 })
  return { sessionId, workspaceId, workspace: bound, name: event.name, id: event.id, sourcePath: note.path, sourceSha256: sha256(source.content),
    other: { sessionId: otherId, workspaceId: otherWorkspaceId, workspace: boundB, sourcePath: stateB.notesPath } }
}

async function withDiscoveryDirectory(root, fn) {
  const name = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_RUNTIME_DIR'
  const previous = process.env[name]
  process.env[name] = environment(root, '')[name]
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

function collectProcess(executable, args, options, input) {
  const child = spawn(executable, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
  const { promise, resolve: done, reject } = Promise.withResolvers()
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data })
  child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data })
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  child.once('error', reject)
  child.once('close', (code) => done({ code, stdout, stderr }))
  return withDeadline(promise, 30000, 'Test child process').finally(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill()
  })
}

async function cli(root, home, event, argv, launch, { entry, shim, input, expectedExit = 0 } = {}) {
  const env = environment(root, home)
  delete env.ELECTRON_RUN_AS_NODE
  if (launch) env.DSH_CONNECT_URL = launch.href
  if (event?.sessionId) env.DSH_SESSION_ID = event.sessionId
  const commandArgs = ['--json', ...argv, ...(input === undefined ? [] : ['--input-file', '-'])]
  let spec = [process.execPath, [entry || join(repo, 'lib', 'terminal', 'cli.js'), ...commandArgs], { env, cwd: root }]
  if (shim) {
    assert.equal(process.platform, 'win32')
    assert.match(shim, /^[A-Za-z]:[\\/][^"%!\r\n]*\.cmd$/iu)
    assert.ok(commandArgs.every((arg) => /^[-.\w]+$/u.test(arg)), 'only fixed CLI words go through cmd.exe')
    env.DAM_E2E_SHIM = shim
    spec = [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '""%DAM_E2E_SHIM%" ' + commandArgs.join(' ') + '"'],
      { env, cwd: root, windowsVerbatimArguments: true }]
  }
  const { code, stdout, stderr } = await collectProcess(...spec, input === undefined ? undefined : JSON.stringify(input))
  assert.equal(code, expectedExit, scrub(stderr))
  assert.equal(expectedExit === 0 ? stderr : stdout, '')
  return JSON.parse(expectedExit === 0 ? stdout : stderr)
}

async function verifySettingsWatch(root, home, event, launch, entry, connection, client, scope, revision) {
  const env = environment(root, home)
  delete env.ELECTRON_RUN_AS_NODE
  Object.assign(env, { DSH_CONNECT_URL: launch.href, DSH_SESSION_ID: event.sessionId })
  const child = spawn(process.execPath, [entry, 'status', '--watch', '--json', '--interval', '500'], {
    env, cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const closed = once(child, 'close')
  closed.catch(() => {})
  child.stderr.resume()
  const output = createInterface({ input: child.stdout })
  const lines = output[Symbol.asyncIterator]()
  try {
    const initial = await withDeadline(lines.next(), 9000, 'Initial installed CLI watch record')
    const first = JSON.parse(initial.value)
    assert.equal(first.settingsRevision, revision)
    await pluginRequest(connection, 'config', { body: { autoPopupEnabled: true } })
    const desired = (await client.call('settings.get', {}, { scope })).revision
    assert.notEqual(desired, revision)
    await withDeadline((async () => {
      for await (const line of lines) {
        const update = JSON.parse(line)
        if (update.settingsRevision === desired) {
          assert.notEqual(update.revision, first.revision)
          assert.deepEqual(update.scope, first.scope)
          return
        }
      }
      assert.fail('The installed CLI watch ended before observing Web config')
    })(), 9000, 'Web config revision on installed CLI watch')
  } finally {
    output.close()
    child.kill()
    await closed
  }
}

async function verifyTerminal(root, home, launch, connection, event, label, plugin) {
  const { status } = await request(connection.origin, terminalPath, { cookie: connection.operatorCookie })
  if (label === 'npm-control') {
    assert.equal(status, 404, 'the npm control has legacy endpoints')
    const check = await cli(root, home, null, ['doctor'], launch, { expectedExit: 4 })
    assert.equal(check.error.code, 'loaded-plugin-legacy')
    report('terminal contract unavailable in npm control', { status, doctorExit: 4, reason: check.error.code })
    return
  }
  assert.equal(status, 200)
  const denied = await request(connection.origin, terminalPath)
  assert.equal(denied.status, 401)
  await denied.body?.cancel()
  const { connectDsh } = await import(new URL('../../lib/terminal/client.js', import.meta.url))
  const scope = { sessionId: event.sessionId, workspace: event.workspace }
  const client = connectDsh({ connectUrl: launch.href, timeout: 9000 })
  const manifest = await client.discover({ scope })
  const call = (id, args = {}) => client.call(id, args, { scope })
  assert.equal(manifest.identity.profile, 'desktop')
  assert.equal(manifest.scope.sessionId, event.sessionId)
  assert.equal((await call('status')).connection, 'ready')
  assert.equal((await call('settings.get')).config.autoPopupEnabled, true)
  const recall = await call('memory.recall', { query: 'tungstenwren', scope: 'current' })
  assert.match(recall.result, /cobalt fixture receipt/)
  const source = await call('memory.source', { path: event.sourcePath })
  assert.equal(sha256(source.content), event.sourceSha256)
  const boardEvents = await call('board.events.list', { limit: 200 })
  assert.ok(boardEvents.events.some(row => row.id === event.id), 'seeded event remains in the workspace after additional writes')
  assert.equal((await call('board.events.detail', { id: event.id })).event.checkpoints[0].sha256, event.sourceSha256)
  const settings = await call('settings.get')
  const args = { patch: { autoPopupEnabled: false }, revision: settings.revision }
  await assert.rejects(call('settings.set', args), (error) => error.status === 409 || error.status === 403)
  const requestId = randomUUID()
  const approved = { scope, approved: true, requestId }
  const saved = await client.call('settings.set', args, approved)
  assert.notEqual(saved.revision, settings.revision)
  assert.deepEqual(await client.call('settings.set', args, approved), saved)
  const receipt = await client.receipt(requestId, { scope })
  assert.equal(receipt.operation, 'settings.set')
  assert.equal((await pluginRequest(connection, 'state', { query: { ws: event.workspace } })).autoPopupEnabled, false)
  const writes = await Promise.allSettled([{ autoPopupEnabled: true }, { unattendedMode: true }].map(patch =>
    client.call('settings.set', { patch, revision: saved.revision }, { scope, approved: true, requestId: randomUUID() })))
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(writes.find(result => result.status === 'rejected')?.reason.status, 409)
  const raced = await call('settings.get')
  assert.notEqual(raced.revision, saved.revision)
  assert.notEqual(raced.config.autoPopupEnabled, raced.config.unattendedMode)
  const restored = await client.call('settings.set', {
    patch: { autoPopupEnabled: false, unattendedMode: settings.config.unattendedMode }, revision: raced.revision,
  }, { scope, approved: true })
  const cliOptions = { entry: join(plugin, 'lib', 'terminal', 'cli.js') }
  await verifySettingsWatch(root, home, event, launch, cliOptions.entry, connection, client, scope, restored.revision)
  const local = await withDiscoveryDirectory(root, async () => {
    const discovery = connectDsh({ home, profile: 'desktop', timeout: 9000 })
    const found = await discovery.discover({ scope })
    assert.equal(found.identity.instanceId, manifest.identity.instanceId)
    assert.equal((await discovery.call('status', {}, { scope })).connection, 'ready')
    return discovery
  })
  const invoke = (words, input) => cli(root, home, event, words, launch, { ...cliOptions, input })
  const doctor = await invoke(['doctor'])
  assert.equal(doctor.identity.instanceId, manifest.identity.instanceId)
  if (compiledQueryRoot) assert.equal(doctor.status.searchIndex.committedSearchVersion, 1)
  const cliBoard = await invoke(['board', 'event'], { id: event.id })
  assert.equal(cliBoard.event.checkpoints[0].sha256, event.sourceSha256)
  const cliRecall = await invoke(['memory', 'recall'], { query: 'tungstenwren' })
  assert.match(cliRecall.result, /cobalt fixture receipt/)
  const cliCheckpoint = await invoke(['board', 'checkpoint'], { eventId: event.id, idemKey: 'baseline-checkpoint' })
  assert.equal(cliCheckpoint.eventId, event.id)
  assert.equal(cliCheckpoint.checkpointIndex, 0)
  assert.match(cliCheckpoint.text, /Checkpoint checked the source note/)
  const cliSource = await invoke(['board', 'source'], { path: event.sourcePath })
  assert.equal(sha256(cliSource.content), event.sourceSha256)
  const browseOnly = join(root, 'project-browse-only')
  await mkdir(browseOnly)
  const registered = await remote(connection.origin, 'workspace/create', { request: { path: browseOnly } }, connection.browserCookie)
  assert.ok(registered.workspace.workspaceId)
  const appeared = await cli(root, home, null, ['api', 'call', 'system.workspaces'], launch, cliOptions)
  assert.ok(appeared.workspaces.some(row => row.workspaceRef === registered.workspace.workspaceId && !row.sessionId))
  assert.ok(!appeared.workspaces.some(row => row.workspaceRef === registered.workspace.workspaceId && row.sessionId))
  const browse = (words, input, expectedExit) => cli(root, home, null, ['--workspace-ref', registered.workspace.workspaceId, ...words],
    launch, { ...cliOptions, input, expectedExit })
  assert.equal((await cli(root, home, null, ['api', 'list', '--workspace-ref', registered.workspace.workspaceId], launch, cliOptions))
    .operations.find(op => op.id === 'memory.read')?.status, 'available')
  const state = await pluginRequest(connection, 'state', { query: { ws: browseOnly } })
  assert.ok(!relative(home, state.notesPath).startsWith('..'))
  const fixtureContent = '# Synthetic workspace browser\n\nnightsilt belongs to this workspace.\n'
  await mkdir(dirname(state.notesPath), { recursive: true })
  await writeFile(state.notesPath, fixtureContent)
  const { eventStorePre, EVENT_STORE_FILENAME } = await import(pathToFileURL(join(plugin, 'lib', 'event-store.js')))
  const seeded = await eventStorePre.create(join(state.projectDir, 'handoff', EVENT_STORE_FILENAME), { name: 'Independent workspace browser event' })
  assert.equal((await browse(['status'])).scope.sessionId, undefined)
  assert.equal((await browse(['memory', 'list'])).notesSize, Buffer.byteLength(fixtureContent))
  const overview = await browse(['memory', 'overview'])
  assert.equal(await realpath(overview.projectDir), await realpath(state.projectDir))
  assert.equal((await browse(['memory', 'source'], { path: 'MEMORY.md' })).content, fixtureContent)
  const noteRequestId = randomUUID()
  const noteWrite = await browse(['memory', 'note', '--yes', '--request-id', noteRequestId], {
    expectedNotesPath: state.notesPath, content: 'Sessionless project note: duskfern belongs here.',
  })
  assert.equal(await realpath(noteWrite.result.path), await realpath(state.notesPath))
  assert.match(await readFile(state.notesPath, 'utf8'), /duskfern belongs here/u)
  const noteReceipt = await browse(['api', 'receipt', noteRequestId])
  assert.equal(noteReceipt.state, 'finished')
  assert.equal(noteReceipt.operation, 'memory.note')
  const memoryRead = await browse(['api', 'call', 'memory.read'], { kind: 'notes' })
  assert.match(memoryRead, /duskfern belongs/u)
  report('sessionless memory_read and approved note receipt', {
    requestId: noteRequestId, operation: noteReceipt.operation, receiptState: noteReceipt.state,
    workspace: registered.workspace.workspaceId, sourcePathMatched: true, memoryRead: true,
  })
  const remembered = await browse(['memory', 'read'], { kind: 'notes' })
  assert.match(remembered, /nightsilt belongs/u)
  assert.doesNotMatch(remembered, /fixture-other-session|project-B/u)
  assert.match((await browse(['memory', 'recall'], { query: 'nightsilt', scope: 'current' })).result, /nightsilt/u)
  assert.equal((await browse(['board', 'events'])).events[0].id, seeded.id)
  assert.equal((await browse(['board', 'event'], { id: seeded.id })).event.id, seeded.id)
  assert.equal((await browse(['memory', 'storage'])).sources.find(row => row.file === state.notesPath).status, 'ok')
  assert.equal((await browse(['board', 'event'], { id: event.id }, 4)).error.code, 'operation-rejected')
  assert.equal((await browse(['settings', 'get'])).config.autoPopupEnabled, true)
  report('read a registered workspace with no conversation', { label, sessionless: true, memoryListAndSource: true,
    recall: true, boardEventsAndDetail: true, foreignEventRejected: true, settingsReadable: true })
  report('terminal contract on Desktop Host', {
    label, anonymous: 401, operator: 200, sameAccountDiscovery: true, revisionAndReceipt: true,
    competingSettingsWrites: true, webWriteInCliWatch: true,
    contractVersion: manifest.contractVersion, operations: manifest.operations.length, build: manifest.identity.buildId,
    committedSearchVersion: doctor.status.searchIndex.committedSearchVersion,
    cli: ['doctor', 'board event', 'memory recall', 'board checkpoint', 'board source'],
  })
  return { local, instanceId: manifest.identity.instanceId }
}

async function run(plugin, label) {
  const root = await mkdtemp(join(tmpdir(), 'dam-cli-baseline-'))
  let host
  try {
    const build = await readJson(join(plugin, 'package.json'))
    assert.equal(build.name, packageName)
    if (label === 'npm-control') assert.equal(build.version, '3.4.6')
    report('plugin build', {
      label, version: build.version,
      indexSha256: sha256(await readFile(join(plugin, 'lib', 'index.js'))),
      clientSha256: sha256(await readFile(join(plugin, 'lib', 'client.js'))),
    })
    const home = await prepare(root, plugin)
    host = startDesktop(root, home)
    const first = await host.ready()
    assert.ok(first.runId)
    const connection = await authenticate(first.url)
    const batch = first.graph?.batches?.find((entry) => entry.url.includes(packageName + '/client.js'))
    assert.ok(batch, 'Desktop boot graph advertises the plugin client bundle')
    const client = await request(connection.origin, batch.url, { cookie: connection.browserCookie })
    assert.equal(client.status, 200, 'shipped browser-face route')
    assert.match(client.headers.get('content-type') || '', /javascript/i)
    assert.match(await client.text(), /conversation\.view|白板看板/)
    report('native Desktop Host authentication and load', { label, anonymousRemote: 401, browserExchange: 303, operatorExchange: 302, client: 200 })
    const event = await exercise(plugin, root, connection, label)
    let terminal
    try {
      if (label !== 'git-baseline') terminal = await verifyTerminal(root, home, first.url, connection, event, label, plugin)
    } catch (error) {
      console.error(scrub(error.stack))
      process.exitCode = 1
    }
    if (browserAutomation) {
      try {
        const runCli = label === 'worktree'
          ? (args, input, options = {}) => cli(root, home, event, args, first.url, { entry: join(plugin, 'lib', 'terminal', 'cli.js'), input, ...options })
          : null
        await verifyGui(connection, event, label, runCli)
        if (process.env.DAM_GUI_CHECK_CALENDAR === '1' && label === 'worktree') {
          const options = { entry: join(plugin, 'lib', 'terminal', 'cli.js') }
          const read = ['api', 'call', 'memory.calendar']
          const created = (await cli(root, home, event, read, first.url, options)).entries.find(row => row.title === webCalendarTitle)
          assert.ok(created?.id)
          assert.equal(created.quadrant, '重要紧急')
          assert.match(created.note, /fixture-room/)
          for (const action of ['done', 'remove']) {
            await cli(root, home, event, ['api', 'call', 'memory.calendar.' + action, '--yes'], first.url,
              { ...options, input: { id: created.id } })
            const refreshed = await pluginRequest(connection, 'calendar')
            const item = refreshed.entries.find(row => row.id === created.id)
            if (action === 'done') assert.equal(item?.done, true)
            else assert.equal(item, undefined)
          }
          report('browser calendar and installed CLI', { browserWrite: true, selectedDate: created.date, priority: created.quadrant,
            cliDoneAndRemove: true, webReadback: true })
        }
      } catch (error) {
        console.error(scrub(error.stack))
        process.exitCode = 1
      }
    }
    await host.stop()
    await assert.rejects(request(connection.origin, '/'), (error) => error.cause?.code === 'ECONNREFUSED')
    if (terminal) {
      await assert.rejects(terminal.local.discover(), (error) => error.code === 'instance-unreachable')
      await withDiscoveryDirectory(root, async () => {
        const { findLocalInstances } = await import(new URL('../../lib/terminal/discovery.js', import.meta.url))
        assert.equal(findLocalInstances(home).length, 0)
      })
    }
    host = startDesktop(root, home)
    const second = await host.ready()
    assert.notEqual(second.runId, first.runId)
    assert.notEqual(second.url.searchParams.get('token'), first.url.searchParams.get('token'))
    const reconnected = await authenticate(second.url)
    assert.equal((await pluginRequest(reconnected, 'config')).config.autoPopupEnabled, true)
    assert.equal((await pluginRequest(reconnected, 'event-detail', { query: { sessionId: event.sessionId, id: event.id } })).event.name, event.name)
    if (terminal) {
      const { connectDsh } = await import(new URL('../../lib/terminal/client.js', import.meta.url))
      await withDiscoveryDirectory(root, async () => {
        const discovery = connectDsh({ home, profile: 'desktop', timeout: 9000 })
        const found = await discovery.discover({ scope: { sessionId: event.sessionId } })
        assert.equal(found.identity.instanceId === terminal.instanceId, false)
      })
    }
    report('shutdown and reconnect', { label, shutdownCode: 0, shutdownIpc: true, stoppedEndpoint: 'ECONNREFUSED', generationChanged: true, authorityChanged: first.url.origin !== second.url.origin, settingsAndEventRestored: true, terminalReselected: !!terminal })
  } catch (error) {
    console.error(scrub(error.stack))
    if (host) console.error(host.output())
    process.exitCode = 1
  } finally {
    try {
      await host?.stop()
    } catch (error) {
      console.error(scrub(error.message))
      process.exitCode = 1
    } finally {
      assert.equal(dirname(root), resolve(tmpdir()))
      assert.match(basename(root), /^dam-cli-baseline-/)
      await rm(root, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

async function verifyGui(connection, event, label, runCli) {
  // Use the shipped settings mutation that the release notice's Continue
  // button uses, in the already authenticated, throwaway profile.
  await remote(connection.origin, 'settings/mutate', {
    ns: 'ui-settings-general',
    ops: [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-09-28.1' }],
  }, connection.browserCookie)
  const browser = await browserAutomation.chromium.launch({ channel: 'msedge' })
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1560, height: 1000 } })
    const [name, value] = connection.browserCookie.split('=')
    await context.addCookies([{ name, value, url: connection.origin, httpOnly: true, sameSite: 'Strict' }])
    await context.addInitScript(() => {
      if (location.origin === 'null') return
      localStorage.setItem('dam-skin-style', 'instrument')
      localStorage.setItem('dsh-auto-memory.presentation.v1', 'instrument')
      localStorage.setItem('dsh-auto-memory.panel.pos', 'page')
    })
    const page = await context.newPage()
    page.setDefaultTimeout(10000)
    for (const selector of ['[data-dam-wb-cta2]', '[data-dam-wizard-dismiss]']) {
      await page.addLocatorHandler(page.locator(selector).first(), button => button.click({ timeout: 7000 }))
    }
    await page.goto(connection.origin)
    const group = page.locator('[data-row-key="workspace:' + event.workspaceId + '"]')
    const session = page.locator('[data-row-key="session:' + event.sessionId + '"]')
    await group.waitFor({ timeout: 15000 })
    if (await group.getAttribute('aria-expanded') === 'false') await group.click({ timeout: 8000 })
    await session.click({ timeout: 10000 })
    await page.locator('[data-conversation-session="' + event.sessionId + '"]').waitFor({ timeout: 10000 })
    const dismissPluginPrompts = async () => {
      const notice = page.getByRole('button', { name: /^(知道了|Got it)$/u }).first()
      if (await notice.isVisible() && await notice.isEnabled()) await notice.click({ timeout: 8000 })
    }
    const openView = async (name) => {
      const tab = page.getByRole('tab', { name, exact: true })
      if (await tab.isVisible()) {
        await tab.click()
        return
      }
      await page.getByRole('button', { name: /更多会话视图|More conversation views/i }).click({ timeout: 8000 })
      await page.getByText(name, { exact: true }).last().click({ timeout: 8000 })
    }
    await openView(/^(白板看板|Whiteboard)$/u)
    const surface = page.locator('[data-dam-event-surface]')
    await surface.waitFor({ timeout: 10000 })
    const board = surface.frameLocator('iframe[data-dam-ev4-iframe]')
    if (process.env.DAM_GUI_CHECK_BOARD_GROUPS === '1' && label === 'worktree') {
      await board.getByText('P1 R2 并行验收', { exact: true }).first().waitFor()
      await dismissPluginPrompts()
      const active = page.locator('[data-dam-scope-btn="active"]')
      const all = page.locator('[data-dam-scope-btn="all"]')
      assert.equal(await active.getAttribute('aria-pressed'), 'true')
      await board.getByRole('tab', { name: '泳道 / 甘特' }).click()
      const parallelLane = board.locator('.lrow').filter({ hasText: 'P1 R2 并行验收' })
      await parallelLane.waitFor()
      await board.locator('.lrow').filter({ hasText: 'R2 暂停事项' }).waitFor()
      assert.equal(await board.locator('.lrow').filter({ hasText: 'P1 已关闭事项' }).count(), 0)
      await parallelLane.press('Enter')
      const groupedCheckpoint = board.locator('#detail [data-cp]').first()
      await groupedCheckpoint.locator('button.cp-h').click()
      await groupedCheckpoint.getByText('第一段推进', { exact: false }).first().waitFor()
      await board.getByRole('tab', { name: '工作流线索' }).click()
      const p1 = board.locator('.wfg').filter({ has: board.locator('.lane').getByText('P1', { exact: true }) })
      const r2 = board.locator('.wfg').filter({ has: board.locator('.lane').getByText('R2', { exact: true }) })
      assert.match(await p1.locator('.wfh').textContent(), /1 个事件/u)
      assert.match(await r2.locator('.wfh').textContent(), /2 个事件/u)
      await p1.locator('.wfh').click()
      await p1.locator('.wfrow').first().waitFor({ state: 'hidden' })
      await p1.locator('.wfh').click()
      await p1.getByText('P1 R2 并行验收', { exact: true }).click()
      await all.click()
      assert.equal(await all.getAttribute('aria-pressed'), 'true')
      await board.getByRole('tab', { name: '泳道 / 甘特' }).click()
      await board.locator('.lrow').filter({ hasText: 'P1 已关闭事项' }).waitFor()
      await active.click()
      await board.getByRole('tab', { name: '时间流' }).click()
      report('browser board range and grouped views', { label, activeAndAll: true, laneDetail: true,
        workflowGroups: { P1: 1, R2: 2 }, workflowToggle: true })
    }
    await board.getByText(event.name, { exact: true }).first().click({ timeout: 10000 })
    const checkpoint = board.locator('#detail [data-cp]').first()
    const checkpointToggle = checkpoint.locator('button.cp-h')
    if (await checkpointToggle.getAttribute('aria-expanded') !== 'true') await checkpointToggle.click({ timeout: 10000 })
    await checkpoint.getByText('Goal: verify readback', { exact: false }).first().waitFor({ timeout: 10000 })
    await checkpoint.getByText('Next: inspect source', { exact: false }).first().waitFor({ timeout: 10000 })
    if (process.env.DAM_GUI_CHECK_BOARD_GROUPS === '1' && label === 'worktree') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: connection.origin })
      const documents = surface.locator('[data-dam-docs-strip]')
      await documents.locator('[data-dam-docs-summary]').click()
      const copy = documents.locator('[data-dam-docs-copy][title="docs/plan.md"]')
      await copy.click()
      await documents.locator('[title="docs/plan.md"][data-dam-docs-copy-state="copied"]').waitFor()
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'docs/plan.md')
      report('browser board related document clipboard', { label, copiedPath: 'docs/plan.md' })
    }
    await dismissPluginPrompts()
    const shots = process.env.DAM_GUI_ARTIFACT_DIR
    if (shots) {
      await mkdir(shots, { recursive: true })
      await page.screenshot({ path: join(shots, label + '-board.png') })
    }
    await dismissPluginPrompts()
    await openView(/^(记忆|Memory)$/u)
    await dismissPluginPrompts()
    const library = page.locator('[data-i5-nav="library"]:visible').first()
    await library.click({ timeout: 10000 })
    await page.getByRole('tab', { name: /^(检索|Search)$/u }).click({ timeout: 10000 })
    const search = page.getByRole('searchbox', { name: /^(检索记忆|Search memories)$/u })
    await search.fill('tungstenwren')
    const [recall] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === api + 'recall', { timeout: 10000 }),
      search.press('Enter'),
    ])
    assert.equal(recall.status(), 200, 'GUI recall HTTP status')
    assert.equal(recall.request().postDataJSON().sessionId, event.sessionId, 'GUI recall bound to its conversation')
    assert.match((await recall.json()).result, /cobalt fixture receipt/)
    const sourceButton = page.getByRole('button', { name: /^(打开原文|Open original)/u }).first()
    await sourceButton.waitFor({ timeout: 10000 })
    await dismissPluginPrompts()
    const [file] = await Promise.all([
      page.waitForResponse((response) => new URL(response.url()).pathname === api + 'file', { timeout: 10000 }),
      sourceButton.click({ timeout: 8000 }),
    ])
    assert.equal(file.status(), 200)
    const original = await file.json()
    assert.equal(await realpath(original.path), await realpath(event.sourcePath))
    assert.equal(sha256(original.content), event.sourceSha256)
    await page.getByText('The isolated source contains the cobalt fixture receipt.', { exact: false }).first().waitFor({ timeout: 10000 })
    if (shots) await page.screenshot({ path: join(shots, label + '-memory.png') })
    report('browser WebUI navigation', { label, memory: true, whiteboard: true, fixtureEvent: event.name,
      checkpointExpanded: true, originalSourceSha256: event.sourceSha256, screenshots: shots ?? null })
    if (process.env.DAM_GUI_CHECK_CALENDAR === '1' && label === 'worktree') {
      await page.keyboard.press('Escape')
      await page.locator('[data-i5-nav="calendar"]:visible').first().click({ timeout: 10000 })
      const calendar = page.locator('.i5-calendar-view')
      const monthButton = calendar.getByRole('button', { name: /^(上个月|Previous month)$/u })
      const before = await calendar.locator('.i5-month h2').textContent()
      await monthButton.click()
      assert.notEqual(await calendar.locator('.i5-month h2').textContent(), before)
      await calendar.getByRole('button', { name: /^(今天|Today)$/u }).click()
      const currentDate = calendar.locator('[data-today="true"]')
      await currentDate.click()
      assert.equal(await currentDate.getAttribute('aria-pressed'), 'true')
      await calendar.getByRole('button', { name: /添加事项|Add event/u }).click()
      const form = page.getByRole('dialog', { name: /^(添加日程|Add event)$/u }).locator('.i5-calendar-form')
      await form.getByLabel(/^(标题|Title)$/u).fill(webCalendarTitle)
      await form.getByLabel(/^(地点|Location)$/u).fill('fixture-room')
      await form.locator('select').selectOption('重要紧急')
      const created = page.waitForResponse(response => new URL(response.url()).pathname === api + 'calendar' &&
        response.request().method() === 'POST', { timeout: 10000 })
      await form.locator('button[type="submit"]').click()
      assert.equal((await created).status(), 200)
      await calendar.locator('.i5-day-agenda').getByText(webCalendarTitle, { exact: true }).waitFor({ timeout: 10000 })
      if (shots) await page.screenshot({ path: join(shots, label + '-calendar.png') })
    }
    if (runCli && process.env.DAM_GUI_CHECK_SETTINGS === '1') {
      await page.keyboard.press('Escape')
      await page.locator('[data-i5-nav="settings"]:visible').first().click()
      const settings = page.locator('[data-dam-settings]:visible')
      const behavior = settings.getByRole('tab', { name: /^(接续与维护|Continue & maintain)$/u })
      await behavior.click()
      const popup = settings.locator('[data-i5-field="自动弹出记忆窗口"] [role="switch"]')
      const discard = settings.getByRole('button', { name: /^(取消修改|Discard changes)$/u })
      const save = settings.getByRole('button', { name: /^(保存更改|Save changes)$/u })
      const readSettings = () => runCli(['api', 'call', 'settings.get'])
      const before = await readSettings()
      assert.equal(before.config.autoPopupEnabled, true)
      assert.equal(await popup.isChecked(), true)
      await popup.uncheck()
      assert.equal(await settings.getAttribute('data-i5-dirty'), 'true')
      assert.equal((await readSettings()).revision, before.revision, 'draft has no effect on service state')
      if (shots) await page.screenshot({ path: join(shots, label + '-settings-draft.png') })
      await discard.click()
      assert.equal(await popup.isChecked(), true)
      assert.equal(await settings.getAttribute('data-i5-dirty'), 'false')
      assert.equal((await readSettings()).revision, before.revision, 'discard did not write to the service')
      await popup.uncheck()
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === api + 'config' &&
        response.request().method() === 'POST')
      await save.click()
      assert.equal((await saved).status(), 200)
      await page.locator('[data-dam-settings][data-i5-dirty="false"]:visible').waitFor()
      const current = await readSettings()
      assert.equal(current.config.autoPopupEnabled, false)
      assert.notEqual(current.revision, before.revision)
      await runCli(['api', 'call', 'settings.set', '--yes'], {
        revision: current.revision, patch: { autoPopupEnabled: true },
      })
      await page.getByRole('button', { name: /^(刷新当前页|Refresh current page)$/u }).click()
      await behavior.click()
      await settings.locator('[data-i5-field="自动弹出记忆窗口"] input:checked').waitFor()
      report('browser settings and CLI round trip', { label, draft: true, discard: true, savedWithNewRevision: true,
        cliReadWebWrite: true, webReadCliWrite: true })
    }
    if (runCli && process.env.DAM_GUI_CHECK_SCOPE === '1') {
      const sameWorkspace = await remote(connection.origin, 'session/create', { request: { workspaceId: event.workspaceId } },
        connection.browserCookie)
      assert.ok(sameWorkspace.sessionId && sameWorkspace.sessionId !== event.sessionId)
      const other = event.other
      const otherBody = '## Browser switch control\nKeep this project unchanged.'
      await pluginRequest(connection, 'note', { body: { sessionId: other.sessionId, expectedNotesPath: other.sourcePath, content: otherBody } })
      const readOther = () => pluginRequest(connection, 'file', { query: { sessionId: other.sessionId, path: other.sourcePath } })
      const before = sha256((await readOther()).content)
      async function focusConversation(workspaceId, sessionId) {
        const targetGroup = page.locator('[data-row-key="workspace:' + workspaceId + '"]')
        await targetGroup.waitFor()
        if (await targetGroup.getAttribute('aria-expanded') === 'false') await targetGroup.click()
        await page.locator('[data-row-key="session:' + sessionId + '"]').click()
        await page.locator('[data-conversation-session="' + sessionId + '"]:visible').waitFor()
        assert.equal((await runCli(['status'])).scope.sessionId, event.sessionId)
      }
      await page.keyboard.press('Escape')
      await focusConversation(event.workspaceId, sameWorkspace.sessionId)
      await focusConversation(other.workspaceId, other.sessionId)
      const boardRead = await runCli(['board', 'event'], { id: event.id })
      assert.equal(boardRead.event.id, event.id)
      const marker = 'Terminal keeps its explicitly selected project'
      const write = await runCli(['--workspace', event.workspace, '--session', event.sessionId, 'memory', 'note', '--yes'], {
        expectedNotesPath: event.sourcePath, content: marker,
      })
      assert.equal(await realpath(write.result.path), await realpath(event.sourcePath))
      const selected = await runCli(['memory', 'source'], { path: event.sourcePath })
      assert.ok(selected.content.includes(marker))
      assert.equal(sha256((await readOther()).content), before)
      const browsed = await runCli(['--workspace', other.workspace, 'status'])
      assert.equal(browsed.scope.sessionId, undefined, 'explicit workspace overrides inherited DSH_SESSION_ID')
      assert.equal(await realpath(browsed.scope.workspace), await realpath(other.workspace))
      const foreign = await runCli(['--workspace', other.workspace, '--session', event.sessionId, 'status'], undefined, { expectedExit: 5 })
      assert.equal(foreign.error.code, 'workspace-mismatch')
      report('browser tabs and terminal scope independence', { label, switchedToSameProjectSession: true,
        switchedToOtherProject: true, keptInitialSession: true, boardRead: true, scopedWrite: true, foreignDigestUnchanged: true })
    }
  } catch (error) {
    const page = browser.contexts()[0]?.pages()[0]
    const dialogs = page ? await page.getByRole('dialog').all() : []
    const names = await Promise.all(dialogs.map((dialog) => dialog.getAttribute('aria-label')))
    report('browser WebUI pending', { label, openDialogs: names.filter(Boolean) })
    throw error
  } finally {
    await browser.close()
  }
}

async function installGuardHarness(target) {
  const files = [
    'tests/lib/audit-engine.mjs', 'tests/lib/pr420-host.mjs', 'tests/fixtures/terminal-contract-v1.json',
    'tests/smoke/smoke-test-terminal-contract.mjs', 'tools/run-smoke.mjs', 'tools/smoke-impact.mjs',
  ]
  await Promise.all(files.map(async (file) => {
    await mkdir(dirname(join(target, file)), { recursive: true })
    await cp(join(repo, file), join(target, file))
  }))
  // Windows can observe a pending diagnostic write during the smoke teardown.
  // Keep that filesystem race from hiding the preceding contract assertion.
  const suite = join(target, 'tests', 'smoke', 'smoke-test-terminal-contract.mjs')
  const source = await readFile(suite, 'utf8')
  await writeFile(suite, source.replace(
    'await rm(root, { recursive: true, force: true })',
    'await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })',
  ))
}

async function mutate(candidate) {
  const operationsPath = join(candidate, 'lib', 'terminal', 'operations.js')
  const source = await readFile(operationsPath, 'utf8')
  const marker = '  const operations = ['
  assert.equal(source.split(marker).length, 2, 'operation array mutation anchor')
  assert.ok(!source.includes(echoId), 'original plugin has no fixture operation')
  const echo = [
    "    operation('" + echoId + "', 'Echo from the live validation handler', 'system', global, read,",
    "      object({ message: text, tags: arrayOf(string) }, ['message', 'tags']),",
    "      object({ echo: text, tags: arrayOf(string), handledBy: text }, ['echo', 'tags', 'handledBy']),",
    "      ({ message, tags }) => ({ echo: message, tags: [...tags], handledBy: 'isolated-cordis' }),",
    "      { kind: 'service', key: 'validationEcho' }),",
  ].join('\n')
  await writeFile(operationsPath, source.replace(marker, marker + '\n' + echo))
}

async function guard(candidate, root, expectedDrift) {
  const env = environment(root, join(root, 'dsh'))
  delete env.ELECTRON_RUN_AS_NODE
  const result = await collectProcess(process.execPath, ['tools/run-smoke.mjs', '--filter=terminal-contract', '--jobs=1', '--retry=0'], {
    cwd: candidate, env,
  })
  const output = scrub(result.stdout + result.stderr)
  if (expectedDrift) {
    assert.equal(result.code, 1, output)
    assert.match(output, /added validation\.echo/u)
    report('CI contract guard rejects runtime addition', { exit: result.code, difference: 'added ' + echoId })
  } else {
    assert.equal(result.code, 0, output)
    assert.match(output, /1\/1|1 passed|1 套/u)
    report('CI contract guard accepts candidate', { exit: result.code })
  }
}

async function verifyMutation(plugin, shim) {
  const root = await mkdtemp(join(tmpdir(), 'dam-cli-mutation-'))
  const candidate = join(root, 'candidate')
  const copyRoots = ['package.json', 'lib', 'locale', 'skins', 'cordis.patch.yml', 'icon.svg']
  const entry = join(candidate, 'lib', 'terminal', 'cli.js')
  let host
  try {
    await mkdir(candidate)
    await Promise.all(copyRoots.map((name) => cp(join(plugin, name), join(candidate, name), { recursive: true })))
    await installGuardHarness(candidate)
    const cliEntry = shim ? resolve(shim) : entry
    const clientHash = sha256(await readFile(cliEntry))
    const runtimeCliHash = sha256(await readFile(join(plugin, 'lib', 'terminal', 'cli.js')))
    const phase = async (name, mountedPlugin, fn) => {
      const isolated = join(root, name)
      const home = await prepare(isolated, mountedPlugin)
      host = startDesktop(isolated, home)
      try {
        const { url } = await host.ready()
        const connection = await authenticate(url)
        await fn(isolated, home, url, connection)
      } finally {
        await host.stop()
        host = undefined
      }
    }
    let originalBuild
    const originalInputs = { message: '合成 echo receipt', tags: ['live', '合同'] }
    const cliOptions = { entry, shim: shim && resolve(shim) }
    await phase('original', plugin, async (isolated, home, url, connection) => {
      const manifest = await cli(isolated, home, null, ['api', 'list'], url, cliOptions)
      originalBuild = manifest.identity.buildId
      assert.ok(!manifest.operations.some((row) => row.id === echoId))
      const missing = await cli(isolated, home, null, ['api', 'describe', echoId], url, { ...cliOptions, expectedExit: 4 })
      assert.equal(missing.error.code, 'operation-not-found')
      const event = await exercise(plugin, isolated, connection, 'candidate')
      const status = await cli(isolated, home, event, ['doctor'], url, cliOptions)
      assert.equal(status.identity.buildId, originalBuild)
      assert.equal(status.scope.sessionId, event.sessionId)
      if (compiledQueryRoot) assert.equal(status.status.searchIndex.committedSearchVersion, 1)
      const found = await cli(isolated, home, event, ['memory', 'recall'], undefined, {
        ...cliOptions, input: { query: 'tungstenwren' },
      })
      assert.match(found.result, /cobalt fixture receipt/)
      const detail = await cli(isolated, home, event, ['board', 'event'], undefined, {
        ...cliOptions, input: { id: event.id },
      })
      assert.equal(detail.event.checkpoints[0].sha256, event.sourceSha256)
      report('candidate CLI on real Desktop Host', { build: originalBuild, shim: !!shim, cliSha256: runtimeCliHash,
        launcherSha256: clientHash, committedSearchVersion: status.status.searchIndex.committedSearchVersion })
    })
    await guard(candidate, root, false)
    await mutate(candidate)
    await phase('mutated', candidate, async (isolated, home, url) => {
      const manifest = await cli(isolated, home, null, ['api', 'list'], url, cliOptions)
      assert.notEqual(manifest.identity.buildId, originalBuild)
      if (compiledQueryRoot) {
        const status = await cli(isolated, home, null, ['status'], url, cliOptions)
        assert.equal(status.searchIndex.committedSearchVersion, 1)
      }
      assert.equal(manifest.operations.filter((op) => op.id === echoId).length, 1)
      const description = await cli(isolated, home, null, ['api', 'describe', echoId], url, cliOptions)
      assert.equal(description.source.key, 'validationEcho')
      assert.deepEqual(description.inputSchema.required, ['message', 'tags'])
      const data = await cli(isolated, home, null, ['api', 'call', echoId], url, { ...cliOptions, input: originalInputs })
      assert.deepEqual(data, { echo: originalInputs.message, tags: originalInputs.tags, handledBy: 'isolated-cordis' })
      await cli(isolated, home, null, ['api', 'call', echoId], url, {
        ...cliOptions, input: { ...originalInputs, tags: [17] }, expectedExit: 2,
      })
      assert.equal(sha256(await readFile(cliEntry)), clientHash)
      assert.equal(sha256(await readFile(entry)), runtimeCliHash)
      report('candidate CLI consumes new live operation', { id: echoId, commands: ['list', 'describe', 'call'], invalidArgumentExit: 2,
        baseBuild: originalBuild, mutatedBuild: manifest.identity.buildId, cliSha256: runtimeCliHash, shim: !!shim })
    })
    await guard(candidate, root, true)
  } finally {
    try {
      await host?.stop()
    } finally {
      assert.equal(dirname(root), resolve(tmpdir()))
      assert.match(basename(root), /^dam-cli-mutation-/)
      await rm(root, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

async function verifyMaintenance(plugin, shim) {
  const root = await mkdtemp(join(tmpdir(), 'dam-cli-maintain-'))
  const cliOptions = { entry: join(plugin, 'lib', 'terminal', 'cli.js'), shim: shim && resolve(shim) }
  let host, model
  try {
    if (modelMaintenance) model = await startMaintenanceModel({ hang: timeoutMaintenance })
    const home = await prepare(root, plugin, model?.origin)
    host = startDesktop(root, home, model?.origin)
    const { url } = await host.ready()
    const connection = await authenticate(url)
    const workspace = join(root, 'project-A')
    const session = await createWorkspace(connection, workspace)
    const other = await createWorkspace(connection, join(root, 'project-B'))
    const scopeArgs = ['--workspace-ref', session.workspaceId, '--session', session.sessionId]
    const doctor = await cli(root, home, session, ['doctor', ...scopeArgs], url, cliOptions)
    assert.equal(doctor.status.connection, 'ready')
    assert.equal(doctor.scope.sessionId, session.sessionId)
    if (compiledQueryRoot) assert.equal(doctor.status.searchIndex.committedSearchVersion, 1)
    const instanceArgs = ['--instance', doctor.identity.instanceId]
    const runCli = (command, input, options, target = session) =>
      cli(root, home, target, [...command, ...instanceArgs], undefined, { ...cliOptions, input, ...options })

    const state = await pluginRequest(connection, 'state', { query: { ws: doctor.scope.workspace } })
    const memoryRelative = relative(join(home, 'memory'), state.projectDir)
    assert.ok(memoryRelative && !isAbsolute(memoryRelative) && !memoryRelative.startsWith('..'), 'fixture target is in isolated memory root')
    assert.equal(state.config.workbenchEnabled, true)
    const workbench = await pluginRequest(connection, 'workbench', { body: {} })
    assert.equal(workbench.ready, false, 'fresh profile has no authorized workbench session')
    assert.equal(workbench.setup, null)
    if (model) {
      const result = await pluginRequest(connection, 'workbench', { body: { action: 'setup' } })
      assert.equal(result.ready, true, JSON.stringify({ reason: result.reason, verifyReason: result.verifyReason, setup: result.setup }))
    }
    await mkdir(state.projectDir, { recursive: true })
    const filename = '2000-01-01.md'
    const activePath = join(state.projectDir, filename)
    const archivePath = join(state.projectDir, 'archive', filename)
    const original = Buffer.from('# Isolated maintenance journal\r\n- citrineheron 中文与 emoji 🧪。\r\n\r\n- 尾行保留两个空格  \r\n', 'utf8')
    await writeFile(activePath, original, { flag: 'wx' })
    await assert.rejects(readFile(archivePath), { code: 'ENOENT' })
    const args = { days: 30 }
    const start = ['api', 'call', 'jobs.maintain.start', ...scopeArgs]
    const denied = await runCli(start, args, { expectedExit: 3 })
    assert.equal(denied.error.code, 'confirmation-required')
    assert.deepEqual(await readFile(activePath), original)

    const requestId = randomUUID()
    const approved = [...start, '--yes', '--request-id', requestId]
    const accepted = await runCli(approved, args)
    assert.equal(accepted.receipt.requestId, requestId)
    assert.equal(accepted.result.sessionId, session.sessionId)
    assert.equal(accepted.result.state, 'running')
    assert.ok(accepted.result.id, 'host returned a job identifier')
    assert.deepEqual(await runCli(approved, args), accepted, 'same request ID replays the accepted job')

    const otherRead = await runCli(['jobs', 'get'], { id: accepted.result.id }, { expectedExit: 4 }, other)
    assert.equal(otherRead.error.code, 'job-not-found')
    const writeReceipt = await runCli(['api', 'receipt', requestId, ...scopeArgs])
    assert.equal(writeReceipt.state, 'finished')
    assert.equal(writeReceipt.operation, 'jobs.maintain.start')
    const deadline = Date.now() + 45000
    let job
    do {
      job = await runCli(['jobs', 'get'], { id: accepted.result.id })
      if (job.state !== 'running') break
      await delay(250)
    } while (Date.now() < deadline)
    assert.equal(job.id, accepted.result.id)
    assert.equal(job.state, 'finished', 'maintenance job finished before the deadline')
    assert.ok(job.finishedAt >= job.startedAt)
    if (timeoutMaintenance) {
      assert.match(job.result, /AI 蒸馏等候超过 30 秒/u)
      assert.match(job.result, /已核验 1 份归档副本/u)
      assert.ok(model.observations.some(request => request.maintenance && request.oldLog && request.disconnected))
      const remainingNotes = await readFile(state.notesPath, 'utf8').catch(error => {
        if (error.code === 'ENOENT') return ''
        throw error
      })
      assert.doesNotMatch(remainingNotes, /DAM 模型归档结论 8194/u)
    } else if (model) {
      assert.match(job.result, /完成:\s*AI 提炼 \+ 原文归档 1 个旧日志/u)
      assert.ok(model.observations.some(request => request.maintenance && request.oldLog))
      assert.match(await readFile(state.notesPath, 'utf8'), /DAM 模型归档结论 8194/u)
    } else {
      assert.match(job.result, /完成:\s*原文归档 1 个旧日志/u)
      assert.match(job.result, /AI 蒸馏不可用/u)
    }
    assert.match(job.result, /2000-01-01\.md/u)
    assert.deepEqual(await readFile(archivePath), original)
    await assert.rejects(readFile(activePath), { code: 'ENOENT' })

    const listing = await runCli(['memory', 'read'], { kind: 'archive' })
    assert.match(listing, /2000-01-01\.md/u)
    const archive = await runCli(['memory', 'read'], { kind: 'archive', name: filename })
    assert.ok(archive.endsWith(original.toString('utf8')), 'archive operation returned complete original contents')
    const source = await runCli(['memory', 'source'], { path: archivePath })
    assert.deepEqual(Buffer.from(source.content, 'utf8'), original)
    const recalled = await runCli(['memory', 'recall'], { query: 'citrineheron', scope: 'archive' })
    assert.match(recalled.result, /citrineheron/u)
    const done = await runCli(['doctor'])
    assert.equal(done.identity.instanceId, doctor.identity.instanceId)
    const afterWorkbench = await pluginRequest(connection, 'workbench', { body: {} })
    assert.equal(afterWorkbench.ready, !!model)
    if (!model) {
      assert.equal(afterWorkbench.verifyReason, workbench.verifyReason)
      const diagnostics = await readFile(join(home, 'dsh-auto-memory-diagnose.log'), 'utf8')
      assert.match(diagnostics, /subagent auto-memory-distill gated: workbench not ready/u)
    }
    report('maintenance job and archive on real Desktop Host', {
      shim: !!shim, jobId: accepted.result.id, jobState: job.state, writeReceiptState: writeReceipt.state,
      unauthorizedExit: 3, crossSessionExit: 4, receiptReplay: true, archive: filename,
      bytes: original.length, sha256: sha256(original), originalRemoved: true, archiveListAndRead: true,
      mode: timeoutMaintenance ? 'loopback-timeout-and-archive' : model ? 'loopback-model-and-archive' : 'archive-only',
      workbenchReason: afterWorkbench.verifyReason, sameInstance: true,
      ...(model && { modelRequests: model.observations.length, verifiedModelPrompt: true }),
      committedSearchVersion: doctor.status.searchIndex.committedSearchVersion,
    })
    await host.stop()
    host = undefined
  } catch (error) {
    console.error(scrub(error.stack))
    if (host) console.error(host.output())
    process.exitCode = 1
  } finally {
    try {
      await host?.stop()
    } finally {
      await model?.close()
      assert.equal(dirname(root), resolve(tmpdir()))
      assert.match(basename(root), /^dam-cli-maintain-/)
      await rm(root, { recursive: true, force: true, maxRetries: 3 })
    }
  }
}

async function verifyInstalledUpdate(plugin, expected) {
  assert.match(expected ?? '', /^\d+\.\d+\.\d+$/u, 'Provide the expected public registry version')
  const root = await mkdtemp(join(tmpdir(), 'dam-cli-baseline-'))
  let host
  try {
    const current = (await readJson(join(plugin, 'package.json'))).version
    assert.notEqual(current, expected)
    const home = await prepare(root, plugin)
    const deployedDir = join(home, 'profiles', 'desktop', 'node_modules', packageName)
    const options = { entry: join(plugin, 'lib', 'terminal', 'cli.js') }
    host = startDesktop(root, home)
    const first = await host.ready()
    const browser = await authenticate(first.url)
    const fixture = await exercise(plugin, root, browser, 'update-install')
    const call = (id, flags = [], cliOptions = {}) =>
      cli(root, home, null, ['api', 'call', id, ...flags], first.url, { ...options, ...cliOptions })
    await mkdir(join(home, 'profiles', 'desktop', 'node_modules'), { recursive: true })
    const before = await call('system.update.check', [], { input: { force: 1 } })
    assert.equal(before.current, current)
    assert.equal(before.latest, expected, 'Public registry version changed')
    assert.equal(before.installKind, 'registry')
    const path = join(deployedDir, 'package.json')
    const digest = sha256(await readFile(path))
    const denied = await call('system.update.install', [], { expectedExit: 3 })
    assert.equal(denied.error.code, 'confirmation-required')
    assert.equal(sha256(await readFile(path)), digest)
    const update = await call('system.update.install', ['--yes'])
    assert.equal(update.result.ok, true, JSON.stringify(update.result))
    assert.equal(update.result.targetVersion, expected)
    assert.equal(update.result.landedVersion, expected)
    assert.equal(update.result.installKind, 'registry')
    assert.ok(update.result.restartHint)
    assert.equal(update.receipt.state, 'finished')
    assert.equal((await readJson(path)).version, expected)
    const live = await cli(root, home, fixture, ['doctor'], first.url, options)
    assert.equal(live.identity.pluginVersion, current, 'the active process retains its loaded identity')
    await host.stop()
    host = startDesktop(root, home)
    const second = await host.ready()
    assert.notEqual(first.runId, second.runId)
    const reconnected = await authenticate(second.url)
    const landed = await pluginRequest(reconnected, 'update-check', { query: { force: 1 } })
    assert.equal(landed.current, expected)
    const original = await pluginRequest(reconnected, 'file', {
      query: { path: fixture.sourcePath, ws: fixture.workspace, sessionId: fixture.sessionId },
    })
    assert.equal(sha256(original.content), fixture.sourceSha256)
    const legacy = await cli(root, home, null, ['doctor'], second.url, { ...options, expectedExit: 4 })
    assert.equal(legacy.error.code, 'loaded-plugin-legacy')
    report('registry update and host restart', { current, target: expected, loadedBeforeRestart: current,
      loadedAfterRestart: landed.current, confirmationRequired: true, receipt: update.receipt.state,
      loadedCliDiagnostic: legacy.error.code, sourcePreserved: true })
  } finally {
    try {
      await host?.stop()
    } finally {
      assert.equal(dirname(root), resolve(tmpdir()))
      assert.match(basename(root), /^dam-cli-baseline-/u)
      await rm(root, { recursive: true, force: true, maxRetries: 8 })
    }
  }
}

async function startMaintenanceModel({ hang, markers = [], hangMarker, pressureMarker, responseForPrompt }) {
  const observations = []
  const server = createServer(async (req, res) => {
    try {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const payload = Buffer.concat(chunks).toString('utf8')
      const { model, stream } = JSON.parse(payload || '{}')
      const route = new URL(req.url, 'http://127.0.0.1').pathname
      if (route.endsWith('/count_tokens')) {
        res.setHeader('content-type', 'application/json')
        return res.end('{"input_tokens":100}')
      }
      if (!route.endsWith('/messages')) { res.statusCode = 404; return res.end() }
      const maintenance = payload.includes('待蒸馏日志')
      const observation = { maintenance, oldLog: payload.includes('citrineheron'),
        ...(markers.length && { markers: markers.filter(marker => payload.includes(marker)) }) }
      observations.push(observation)
      if ((hang && maintenance) || (hangMarker && payload.includes(hangMarker))) {
        res.on('close', () => { observation.disconnected = true })
        res.setHeader('content-type', 'text/event-stream')
        return res.flushHeaders()
      }
      const text = responseForPrompt?.(payload) ?? (maintenance
        ? '### 可复用结论\n- DAM 模型归档结论 8194，保留原始材料的校验记录。' : 'Fixture ready.')
      const inputTokens = pressureMarker && payload.includes(pressureMarker) ? 35000 : 100
      const message = { id: 'msg_maintenance_fixture', type: 'message', role: 'assistant', content: [], model,
        stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 1 } }
      if (!stream) {
        res.setHeader('content-type', 'application/json')
        return res.end(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' }))
      }
      const events = [
        { type: 'message_start', message },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ]
      res.setHeader('content-type', 'text/event-stream')
      res.end(events.map(frame => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''))
    } catch { res.statusCode = 400; res.end() }
  })
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  return { origin: 'http://127.0.0.1:' + server.address().port, observations,
    close: () => new Promise(done => { server.close(done); server.closeAllConnections() }) }
}

const installed = await readJson(join(runtimeFiles, 'primary-runtime', 'runtime.json'))
assert.equal(installed.desktopVersion, '0.2.2-rc.5')
report('host build', { version: installed.desktopVersion, runtimeDigest: installed.payloadDigest, node: installed.node })
if (compiledQueryRoot) {
  const compiledDigests = await Promise.all(['session-query', 'session-query-sqlite'].map(async (name) => [
    name, sha256(await readFile(join(compiledQueryRoot, 'packages', 'session-query', name, 'lib', 'index.js'))),
  ]))
  report('compiled session-query artifacts', Object.fromEntries(compiledDigests))
}
if (mutationMode) {
  await verifyMutation(resolve(pluginArg), thirdArg)
} else if (maintainMode) {
  await verifyMaintenance(resolve(pluginArg), thirdArg)
} else if (updateMode) {
  await verifyInstalledUpdate(resolve(pluginArg), thirdArg)
} else if (candidateMode) {
  await run(resolve(pluginArg), 'final-candidate')
} else {
  await run(process.env.DAM_GUI_INSTALLED_PLUGIN_DIR ? resolve(process.env.DAM_GUI_INSTALLED_PLUGIN_DIR) : repo, 'worktree')
  await run(resolve(pluginArg), 'npm-control')
  if (process.env.DAM_BASELINE_PLUGIN_DIR) await run(resolve(process.env.DAM_BASELINE_PLUGIN_DIR), 'git-baseline')
}

