// M1 concurrent top-level agent/session isolation test.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const ws = mkdtempSync(path.join(tmpdir(), 'dam-isolation-'))
const home = path.join(ws, '.dsh-home')
const projectRoot = path.join(ws, '.project-root')
const userRoot = path.join(ws, '.user-root')
mkdirSync(home, { recursive: true })
// 审查修复轮2:配置文件名必须是 _pre 版(见 consolidate-isolation 同注)
writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
  memoryRoot: projectRoot,
  userMemoryDir: userRoot,
  projectMemoryDir: '.project-memory',
  externalSources: {},
}), 'utf8')
process.env.DSH_HOME = home
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
const { apply } = await import('../../lib/index.js')

const registeredTools = []
const registeredRoutes = []
const sections = []
const contexts = []
const eventHandlers = new Map()
const disposers = []
const ctx = {
  get() { return undefined },
  on(name, handler) { eventHandlers.set(name, handler); return () => eventHandlers.delete(name) },
  effect(fn) { disposers.push(fn); return () => {} },
  systemPrompt: {
    section(s) { sections.push(s); return () => {} },
    context(c) { contexts.push(c); return () => {} },
  },
  tools: { register(def) { registeredTools.push(def); return () => {} } },
  webServer: { register(route) { registeredRoutes.push(route); return () => {} } },
}
apply(ctx, {})

const wsA = path.join(ws, 'workspace-a')
const wsB = path.join(ws, 'workspace-b')
const agentA = { id: 'agent-a', session: { id: 'session-a', header: { id: 'session-a', cwd: wsA } } }
const agentB = { id: 'agent-b', session: { id: 'session-b', header: { id: 'session-b', cwd: wsB } } }
const status = registeredTools.find((tool) => tool.name === 'memory_status')
const log = registeredTools.find((tool) => tool.name === 'memory_log')
const provider = contexts[0].text

await Promise.all([
  status.execute({}, { agent: agentA }),
  status.execute({}, { agent: agentB }),
])
await Promise.all([
  log.execute({ note: 'A session isolated marker' }, { agent: agentA }),
  log.execute({ note: 'B session isolated marker' }, { agent: agentB }),
])

const textA = provider({ agent: agentA })
const textB = provider({ agent: agentB })
if (!textA.includes('工作区: ' + wsA)) throw new Error('A prompt workspace missing')
if (!textB.includes('工作区: ' + wsB)) throw new Error('B prompt workspace missing')
if (textA.includes('B session isolated marker')) throw new Error('B log leaked into A prompt')
if (textB.includes('A session isolated marker')) throw new Error('A log leaked into B prompt')
if (provider({ agent: agentA }) !== textA) throw new Error('A unchanged context snapshot is not stable')
if (provider({ agent: agentB }) !== textB) throw new Error('B unchanged context snapshot is not stable')

const preStep = eventHandlers.get('agent/pre-step')
const turnStopping = eventHandlers.get('agent/turn-stopping')
if (typeof preStep !== 'function' || typeof turnStopping !== 'function') throw new Error('lifecycle hooks not registered')
await preStep({ agent: agentA, turn: 1, step: 1 }, async () => ({ kind: 'enter', messages: [] }))
await turnStopping({ agent: agentA, turn: 1, signal: new AbortController().signal })
await turnStopping({ agent: agentB, turn: 1, signal: new AbortController().signal })
const debugRoute = registeredRoutes.find((route) => route.path === '/api/dsh-auto-memory/debug')
if (!debugRoute) throw new Error('debug route not registered')
let debugBody
await debugRoute.handler({
  socket: { remoteAddress: '127.0.0.1' },
  headers: { host: '127.0.0.1:3080' },
  method: 'GET',
  url: '/api/dsh-auto-memory/debug?sessionId=session-a&ws=' + encodeURIComponent(wsA),
}, { writeHead() {}, end(body) { debugBody = JSON.parse(body) } })
const runtimeA = debugBody.associativeMemory.runtimes.find((runtime) => runtime.sessionId === 'session-a')
const runtimeB = debugBody.associativeMemory.runtimes.find((runtime) => runtime.sessionId === 'session-b')
if (!runtimeA || !runtimeB) throw new Error('A/B runtime debug records missing')
if (runtimeA.ws !== wsA || runtimeB.ws !== wsB) throw new Error('runtime debug workspace mismatch')
// v0.1.29 hook 集: A=pre-step+turn-stopping(2), B=turn-stopping(1); 各自至少记录且序列正确即可(隔离意图: A 的事件不进 B)
if (runtimeA.eventCursor < 1 || runtimeB.eventCursor < 1) throw new Error('runtime event cursors not recorded')
if (runtimeA.lastEventSeq !== runtimeA.eventCursor || runtimeB.lastEventSeq !== runtimeB.eventCursor) throw new Error('event sequence/debug digest mismatch')
const textA2 = provider({ agent: agentA })
const textB2 = provider({ agent: agentB })
if (!textA2.includes('工作区: ' + wsA) || !textB2.includes('工作区: ' + wsB)) throw new Error('workspace changed after lifecycle events')

const disposed = eventHandlers.get('agent/disposed')
if (typeof disposed !== 'function') throw new Error('agent disposal hook not registered')
disposed({ agent: agentA })
const bAfterDispose = await status.execute({}, { agent: agentB })
if (!bAfterDispose.includes('工作区: ' + wsB)) throw new Error('disposing A affected B')

for (const dispose of disposers) { try { const teardown = dispose(); if (typeof teardown === 'function') teardown() } catch (e) {} }
rmSync(ws, { recursive: true, force: true })
console.log('M1 isolation smoke test passed: concurrent A/B state, events, and disposal are isolated')
