import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { MemoryStore } from '../lib/store.js'

export async function fixture(t) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'memory-core-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  const workspacePath = name => process.platform === 'win32' ? path.join(home, name).toLowerCase() : path.join(home, name)
  return { home, workspace: workspacePath('project-a'), other: workspacePath('project-b'), store: new MemoryStore(path.join(home, 'memory-core')) }
}

export function agent(workspace, id = 'session-a', text = '项目使用 pnpm，验证命令是 pnpm test。') {
  const events = [
    { seq: 0, type: 'request/header', data: { header: { config: { provider: 'test-provider', model: 'test-model' } } } },
    { seq: 1, type: 'turn/start', data: { turn: 1 } },
    { seq: 2, type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'stale memory injection' }] } },
    { seq: 4, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '已运行 pnpm test，全部通过。' }] } } },
    { seq: 5, type: 'tool/result', data: { message: { content: [{ type: 'text', text: 'test output: 5 passed' }] } } },
  ]
  return { session: { id, header: { cwd: workspace }, events, snapshotEvents: () => events } }
}

export function llm(memories = [{ text: '项目使用 pnpm；测试命令 pnpm test，已验证通过。', scope: 'project' }]) {
  const calls = []
  return { calls, async *stream(request) {
    calls.push(request)
    yield { type: 'text-delta', index: 0, text: JSON.stringify({ memories }) }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
}

export async function eventually(check, timeout = 3000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for background work')
}
