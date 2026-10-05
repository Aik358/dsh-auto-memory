import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

export async function mountAuditHost(root) {
  const home = path.join(root, '.dsh')
  process.env.DSH_HOME = home
  process.env.HOME = root
  process.env.USERPROFILE = root
  await fs.mkdir(home, { recursive: true })
  await fs.writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    memoryRoot: path.join(home, 'memory'), userMemoryDir: path.join(home, 'memory', 'user'),
    teamMemory: { enabled: false },
  }))
  // These fixtures cannot contact providers, download models or scan personal profiles.
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  globalThis.setInterval = () => ({ unref() {} })
  const { apply, MemoryEngine, API } = await import('./audit-engine.mjs')
  let engine
  const original = MemoryEngine.prototype.loadConfigSync
  MemoryEngine.prototype.loadConfigSync = function (...args) { engine = this; return original.apply(this, args) }
  const routes = [], tools = [], cleanups = []
  const ctx = {
    get: () => undefined, on: () => {},
    systemPrompt: { context: () => () => {}, section: () => () => {} },
    tools: { register: tool => { tools.push(tool); return () => {} } },
    webServer: { register: route => { routes.push(route); return () => {} } },
    effect: callback => { const cleanup = callback(); if (typeof cleanup === 'function') cleanups.push(cleanup) },
  }
  try { apply(ctx, {}) } finally { MemoryEngine.prototype.loadConfigSync = original }
  return { engine, API, routes, tools, dispose() { for (const cleanup of cleanups) cleanup() } }
}

export async function callAuditRoute(host, key, body, query = '') {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  Object.assign(req, { method: body === undefined ? 'GET' : 'POST', url: host.API[key] + query,
    headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } })
  let status = 0, text = ''
  const res = { writeHead(code) { status = code }, setHeader() {}, end(value) { text = String(value || '') } }
  await host.routes.find(route => route.path === host.API[key]).handler(req, res)
  return { status, body: JSON.parse(text) }
}

export async function auditTemp(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}
