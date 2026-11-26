import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectDsh } from '../../lib/terminal/client.js'

export async function startExternalDesktop(root, desktop, workspace, note) {
  const pluginName = '@a9i5k4/dsh-auto-memory'
  const checkout = process.env.DAM_EXTERNAL_PLUGIN_DIR || fileURLToPath(new URL('../../', import.meta.url))
  const home = path.join(root, 'dsh')
  const profile = path.join(home, 'profiles', 'desktop')
  const platformRuntime = path.join(path.dirname(desktop), 'resources', 'runtime')
  const runtime = path.join(path.dirname(desktop), 'resources', 'app.asar', 'dsh')
  const desktopHost = path.join(runtime, 'node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js')
  const scopeDir = path.join(profile, 'node_modules', '@a9i5k4')
  await mkdir(scopeDir, { recursive: true })
  await symlink(checkout, path.join(scopeDir, 'dsh-auto-memory'), process.platform === 'win32' ? 'junction' : 'dir')
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({
    private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', pluginName] } },
  }))
  await writeFile(path.join(profile, 'cordis.yml'), '[]\n')
  await writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    semanticEngineMode: 'lexical', memoryRoot: path.join(home, 'memory'), userMemoryDir: path.join(home, 'user'),
    externalSources: {}, autoConsolidate: false, globalBriefEnabled: false, teamEnabled: false,
  }))
  const allowed = /^(path|pathext|systemroot|windir|comspec|systemdrive|programfiles(?:\(x86\))?|processor_architecture)$/i
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => allowed.test(name)))
  Object.assign(env, {
    USERPROFILE: root, HOME: root, DSH_HOME: home, DSH_AGENTS_HOME: path.join(root, 'agents'),
    DSH_TELEMETRY_DISABLED: '1', LOCALAPPDATA: path.join(root, 'desktop-local'), APPDATA: path.join(root, 'desktop-roaming'),
    ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_NODE_EXECUTABLE: desktop, DSH_CLIENT_VERSION: '0.2.2-rc.5',
    TEMP: root, TMP: root,
  })
  const child = spawn(desktop, ['--expose-internals', desktopHost, runtime, profile,
    path.join(platformRuntime, 'primary-runtime'),
    path.join(platformRuntime, 'primary-runtime/dependencies/pnpm/bin/pnpm.mjs'),
    path.join(platformRuntime, 'bin')], { cwd: profile, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true })
  child.stdout.resume()
  child.stderr.resume()
  const ready = Promise.withResolvers()
  const closed = Promise.withResolvers()
  child.on('error', ready.reject)
  child.on('message', message => {
    if (message.type === 'ready') ready.resolve(message.url)
    if (message.type === 'fatal') ready.reject(Error('Isolated Desktop Host startup failed'))
  })
  child.on('close', code => {
    ready.reject(Error('Isolated Desktop Host exited before readiness'))
    closed.resolve(code)
  })
  async function close() {
    if (child.connected) child.send({ type: 'shutdown' }, () => {})
    const timer = setTimeout(() => child.kill(), 10_000)
    try { await closed.promise } finally { clearTimeout(timer) }
  }
  const timer = setTimeout(() => ready.reject(Error('Isolated Desktop Host startup timed out')), 55_000)
  try {
    const launch = new URL(await ready.promise)
    assert.equal(launch.hostname, '127.0.0.1')
    const response = await fetch(launch, { redirect: 'manual', signal: AbortSignal.timeout(8_000) })
    assert.equal(response.status, 303)
    const cookie = response.headers.getSetCookie()[0]?.split(';', 1)[0]
    assert.ok(cookie)
    await response.body?.cancel()
    async function request(relative, body) {
      const response = await fetch(new URL(relative, launch.origin), {
        headers: { cookie, 'Content-Type': 'application/json' },
        ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8_000),
      })
      assert.equal(response.status, 200, relative + ' returned HTTP ' + response.status)
      return response.json()
    }
    async function rpc(method, args) {
      const envelope = await request('/api/' + method, { type: 'client-request', rpcId: 'dam-external', method, payload: { args } })
      assert.ok(envelope.result?.ok, method)
      return envelope.result.value
    }
    const created = await rpc('workspace/create', { request: { path: workspace } })
    const { sessionId } = await rpc('session/create', { request: { workspaceId: created.workspace.workspaceId } })
    const state = await request('/api/dsh-auto-memory/state?' + new URLSearchParams({ ws: workspace }))
    const saved = await request('/api/dsh-auto-memory/note', { sessionId, content: note, expectedNotesPath: state.notesPath })
    assert.equal(saved.path, state.notesPath)
    const dsh = { connectUrl: launch.href, home }
    const manifest = await connectDsh(dsh).discover({ scope: { workspace, sessionId } })
    return {
      close, scope: { workspace, sessionId }, identity: manifest.identity,
      dsh: { ...dsh, profile: manifest.identity.profile, instance: manifest.identity.instanceId },
    }
  } catch (error) {
    await close()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
