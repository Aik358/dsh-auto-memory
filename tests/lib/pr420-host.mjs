import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'node:http'
import { apply, API, MemoryEngine } from './audit-engine.mjs'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'

// The complete apply() wiring and real HTTP handlers; no DSH host or model is needed.
export async function startRecallHost(root, config = {}) {
  const previous = { home: process.env.DSH_HOME, load: MemoryEngine.prototype.loadConfigSync,
    interval: globalThis.setInterval, timeout: globalThis.setTimeout }
  const listeners = new Map(['uncaughtException', 'unhandledRejection', 'exit'].map(key => [key, new Set(process.listeners(key))]))
  const routes = []
  let engine, cleanup
  process.env.DSH_HOME = root
  await fs.writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot: path.join(root, 'memory'),
    userMemoryDir: path.join(root, 'user'), globalBriefEnabled: false, handoffEnabled: false, externalSources: {}, ...config }))
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return previous.load.call(this) }
  globalThis.setInterval = globalThis.setTimeout = (callback, ms) => ({ callback, ms, unref() {} })
  try {
    apply({ get: () => undefined, on: () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} },
      tools: { register: () => () => {} }, webServer: { register: route => { routes.push(route); return () => {} } },
      effect: fn => { cleanup = fn() } }, {})
  } finally {
    MemoryEngine.prototype.loadConfigSync = previous.load
    globalThis.setInterval = previous.interval; globalThis.setTimeout = previous.timeout
  }
  const agent = { session: { id: 'fixture-session', header: { cwd: path.join(root, 'workspace') } } }
  const paths = await engine.resolvePaths(agent)
  engine.agentForSessionId = sid => sid === agent.session.id ? agent : null
  engine.resolvePathsForSession = async sid => ({ ...paths, wsBound: sid === agent.session.id })
  const server = createServer((req, res) => {
    const route = routes.find(route => route.path === new URL(req.url, 'http://localhost').pathname)
    if (route) Promise.resolve(route.handler(req, res)).catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })) })
    else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port
  return {
    engine, agent, paths,
    request: async (key, body, query = '') => {
      const response = await fetch(base + API[key] + query, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
      return { status: response.status, data: await response.json() }
    },
    close: async () => {
      await new Promise(resolve => server.close(resolve))
      if (cleanup) cleanup()
      for (const [key, before] of listeners) for (const listener of process.listeners(key)) if (!before.has(listener)) process.removeListener(key, listener)
      if (previous.home === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous.home
    },
  }
}

export async function writeRecallFixture(host) {
  const ids = { Workspace: 'mem_' + 'a'.repeat(32), User: 'mem_' + 'b'.repeat(32) }
  const writer = new MemoryDocumentStore({ sidecarDir: path.join(process.env.DSH_HOME, 'memory', 'index', 'files') })
  for (const [scope, file] of [['Workspace', host.paths.notesPath], ['User', host.paths.userFile]]) {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '<!-- memory:' + ids[scope] + ' -->\n## Fixture heading ' + scope + '\nOriginal body with no query overlap.\n<!-- dsh-status: retracted -->\n')
    assert.equal((await writer.rebuildSidecar(file)).ok, true)
  }
  return ids
}
