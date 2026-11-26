import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [launcher, installedDam, installedPlugin] = process.argv.slice(2)
if (process.platform !== 'linux' || !installedPlugin || !installedDam || !launcher) {
  process.stderr.write('Usage: node tests/live/auto-memory-linux.mjs DSH_BIN DAM_BIN INSTALLED_PLUGIN_DIRECTORY\n')
  process.exit(2)
}
const root = await mkdtemp(join(tmpdir(), 'dam-linux-'))
const profileName = 'web'
const home = join(root, 'dsh')
const env = {
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DSH_|DEEPSEEK_|NODE_OPTIONS$)/i.test(key))),
  DSH_HOME: home,
  DSH_AGENTS_HOME: join(root, 'agents'),
  DSH_TELEMETRY_DISABLED: '1',
  XDG_RUNTIME_DIR: join(root, 'run'),
}
const packageName = '@a9i5k4/dsh-auto-memory'
const packageDir = await realpath(installedPlugin)
const profile = join(home, 'profiles', profileName)
const report = (check, details) => console.log(JSON.stringify({ check, ...details }))
const request = (url, options) => fetch(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(8000) })
const hosts = []
let launchUrl

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { env, cwd: root, encoding: 'utf8', timeout: 30000, ...options })
  if (result.error) throw result.error
  return result
}

function dam(args, { input, exit = 0, connect } = {}) {
  const response = command(installedDam, [...args, '--json'], {
    input, env: { ...env, ...(connect ? { DSH_CONNECT_URL: launchUrl.href } : {}) },
  })
  assert.equal(response.status, exit, response.stderr)
  const source = exit ? response.stderr : response.stdout
  return JSON.parse(source)
}

async function remote(method, args, cookie) {
  const res = await request(new URL('/api/' + method, launchUrl), {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: 'dam-qa', method, payload: { args } }),
  })
  assert.equal(res.status, 200)
  const envelope = await res.json()
  assert.equal(envelope.result?.ok, true, method + ' rejected')
  return envelope.result.value
}

async function startHost() {
  let output = ''
  let stderr = ''
  const child = spawn(launcher, ['--profile', profileName, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const ready = Promise.withResolvers()
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal }))
  })
  const host = { child, completion }
  hosts.push(host)
  child.stdout.setEncoding('utf8').on('data', chunk => {
    output = (output + chunk).slice(-12000)
    const url = /http:\/\/127\.0\.0\.1:[0-9]+\/\?token=[a-zA-Z0-9_-]+(?=\s)/.exec(output)?.[0]
    if (url) ready.resolve(new URL(url))
  })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-4000) })
  const launchTimeout = new AbortController()
  try {
    host.url = await Promise.race([
      ready.promise,
      completion.then(({ code, signal }) => { throw new Error(`DSH exited before readiness (${code ?? signal})\n${stderr}`) }),
      delay(25000, undefined, { signal: launchTimeout.signal }).then(() => { throw new Error('DSH startup timed out') }),
    ])
    return host
  } finally { launchTimeout.abort() }
}

async function stopHost({ child, completion }) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  const deadline = new AbortController()
  try {
    const result = await Promise.race([completion, delay(7000, undefined, { signal: deadline.signal })])
    if (!result) { child.kill('SIGKILL'); await completion }
  } finally { deadline.abort() }
}

try {
  await Promise.all([mkdir(join(profile, 'node_modules', '@a9i5k4'), { recursive: true }), mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })])
  await symlink(packageDir, join(profile, 'node_modules', packageName), 'dir')
  await Promise.all([
    writeFile(join(profile, 'package.json'), JSON.stringify({
      private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } },
    })),
    writeFile(join(profile, 'cordis.yml'), '[]\n'),
    writeFile(join(home, 'dsh-auto-memory.json'), JSON.stringify({
      memoryRoot: join(home, 'memory'), userMemoryDir: join(home, 'user'), semanticEngineMode: 'lexical',
      autoConsolidate: false, globalBriefEnabled: false, externalSources: {}, workbenchEnabled: false,
      teamEnabled: false, consolidateScheduleEnabled: false, maintainScheduleEnabled: false,
    })),
  ])
  const dshVersion = command(launcher, ['--version']).stdout.trim()
  assert.equal(dshVersion, '0.2.2-rc.5')
  const version = dam(['--version']).version
  assert.equal(version, JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8')).version)
  assert.equal(dam(['doctor'], { exit: 4 }).error.code, 'instance-not-found')

  launchUrl = (await startHost()).url
  const doctor = dam(['doctor', '--profile', profileName])
  assert.equal(doctor.identity.profile, profileName)
  assert.equal(doctor.identity.pluginVersion, version)
  assert.equal(doctor.identity.hostVersion, dshVersion)
  const mismatch = dam(['doctor', '--profile', profileName, '--expect-host-version', '0.0.0'], { exit: 5 })
  assert.equal(mismatch.error.code, 'host-version-mismatch')
  assert.equal(mismatch.error.details.actual, dshVersion)
  assert.equal(doctor.identity.instanceId, dam(['doctor', '--profile', profileName], { connect: true }).identity.instanceId)
  assert.equal((await request(new URL('/api/dsh-auto-memory/terminal/v1', launchUrl))).status, 401)
  report('Linux native npm and real DSH web load', {
    kernel: process.platform, dshVersion, version, contractVersion: doctor.contractVersion, build: doctor.identity.buildId,
  })

  const browser = await request(launchUrl)
  assert.equal(browser.status, 303)
  const cookie = browser.headers.getSetCookie()[0].split(';', 1)[0]
  const workspace = join(root, '独立项目')
  await mkdir(workspace)
  const created = await remote('workspace/create', { request: { path: workspace } }, cookie)
  const workspaceId = created.workspace.workspaceId
  const { sessionId } = await remote('session/create', { request: { workspaceId } }, cookie)
  const scope = ['--session', sessionId, '--workspace-ref', workspaceId]
  const overview = dam(['memory', 'overview', ...scope])
  assert.equal(overview.ws, workspace)
  const note = 'Linux candidate readback 全文 7314'
  const requestId = 'dam-linux-note-7314'
  const input = JSON.stringify({ content: note, expectedNotesPath: overview.notesPath })
  const write = dam(['memory', 'note', ...scope, '--request-id', requestId, '--yes', '--input-file', '-'], { input })
  assert.equal(write.receipt.state, 'finished')
  assert.equal(dam(['api', 'receipt', requestId, ...scope]).state, 'finished')
  const source = dam(['memory', 'source', ...scope, '--input-file', '-'], { input: JSON.stringify({ path: overview.notesPath }) })
  assert.match(source.content, /Linux candidate readback 全文 7314/)
  assert.equal(source.revision, createHash('sha256').update(await readFile(source.path)).digest('hex'))
  const recall = dam(['memory', 'recall', ...scope, '--input-file', '-'], { input: '{"query":"7314","scope":"current"}' })
  assert.match(recall.result, /7314/)
  const stale = dam(['memory', 'note', ...scope, '--yes', '--input-file', '-'], { exit: 5,
    input: JSON.stringify({ content: 'Stale destination', expectedNotesPath: join(root, 'old-destination.md') }) })
  assert.equal(stale.error.code, 'operation-rejected')
  assert.equal(createHash('sha256').update(await readFile(source.path)).digest('hex'), source.revision)
  assert.deepEqual(dam(['board', 'events', ...scope]).events, [])
  const createdEvent = dam(['api', 'call', 'board.events.create', ...scope, '--yes', '--input-file', '-'], {
    input: '{"name":"Linux board 事件","summary":"候选包真实白板读写"}',
  }).result
  const event = dam(['board', 'event', ...scope, '--input-file', '-'], { input: JSON.stringify({ id: createdEvent.eventId }) })
  assert.equal(event.event.name, 'Linux board 事件')
  assert.equal(event.revision, createdEvent.revision)
  report('Linux DSH workspace, write, receipt, recall, source and whiteboard', {
    sourceSha256: source.revision, boardWriteAndRevision: true, staleExit: 5,
  })

  const second = await startHost()
  assert.notEqual(second.url.origin, launchUrl.origin)
  const ambiguous = dam(['doctor', '--profile', profileName], { exit: 5 }).error
  assert.equal(ambiguous.code, 'multiple-instances')
  assert.equal(ambiguous.details.length, 2)
  assert.equal(dam(['doctor', '--instance', doctor.identity.instanceId]).identity.instanceId, doctor.identity.instanceId)
  await stopHost(second)
  assert.equal(dam(['doctor']).identity.instanceId, doctor.identity.instanceId)
  report('Linux same-profile instance selection and stable pin', { ambiguousExit: 5, candidates: 2, stable: true })
} catch (error) {
  const message = String(error?.stack || error).replace(/([?&]token=)[^\s"'&]+/giu, '$1<redacted>')
  console.error(message)
  process.exitCode = 1
} finally {
  for (const host of hosts.reverse()) await stopHost(host)
  await rm(root, { recursive: true, force: true })
}
