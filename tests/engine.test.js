import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { MemoryEngine } from '../lib/engine.js'
import { apply } from '../lib/index.js'
import { importLegacy, turnSource, extract } from '../lib/host.js'
import { fixture, agent, llm, eventually } from './helpers.js'

test('host lifecycle automatically captures, extracts, consolidates and injects a bounded summary', async t => {
  const { home, workspace, other } = await fixture(t)
  const model = llm()
  const listeners = new Map(), tools = new Map(), contexts = new Map(), effects = []
  let active = 0
  const register = () => { active++; return () => { active-- } }
  const ctx = {
    llm: model, effect: fn => effects.push(fn()),
    on: (event, handler) => { listeners.set(event, handler); return register() },
    systemPrompt: { section: register, context: item => { contexts.set(item.name, item); return register() } },
    tools: { register: tool => { tools.set(tool.name, tool); return register() } },
    webServer: { register },
  }
  const engine = apply(ctx, { home, idleMs: 10, requestTimeoutMs: 500 })
  t.after(() => effects.forEach(fn => fn()))
  const a = agent(workspace)
  const assemble = async (a) => {
    const assembly = { contexts: [{ name: 'memory-summary', text: contexts.get('memory-summary').text({ agent: a }) }] }
    return listeners.get('system-prompt/assemble')(assembly, { agent: a }, async () => assembly)
  }
  assert.equal((await assemble(a)).contexts[0].text, '')
  let nextCalled = false
  await listeners.get('agent/pre-step')({ agent: a }, async () => { nextCalled = true })
  assert.equal(nextCalled, true)
  assert.equal(model.calls.length, 0)
  await listeners.get('agent/turn-stopping')({ agent: a, turn: 1 })
  await eventually(async () => (await engine.store.list(workspace)).length === 1)
  const summary = (await assemble(a)).contexts[0].text
  assert.match(summary, /pnpm test/)
  assert.ok(summary.length <= 3000)
  assert.equal(model.calls[0].provider, 'test-provider')
  assert.equal(model.calls[0].tools, undefined)
  assert.doesNotMatch(model.calls[0].messages[0].content[0].text, /stale memory injection/)
  const results = JSON.parse(await tools.get('memory_search').execute({ query: 'pnpm' }, { agent: a }))
  assert.equal(results.records.length, 1)
  const record = results.records[0]
  await tools.get('memory_write').execute({ id: record.id, text: '改用 bun test。', scope: 'project', expectedVersion: record.version }, { agent: a })
  assert.match(engine.snapshot(a), /bun test/)
  assert.equal((await assemble(agent(other, 's2'))).contexts[0].text, '')
  const read = JSON.parse(await tools.get('memory_read').execute({ id: record.id }, { agent: a }))
  await tools.get('memory_delete').execute({ id: read.id, expectedVersion: read.version }, { agent: a })
  assert.equal(engine.snapshot(a), '')
  effects.forEach(fn => fn())
  assert.equal(active, 0)
  assert.equal(engine.closed, true)
})

test('incomplete model streams do not consume evidence; valid empty extraction does', async t => {
  const { home, workspace } = await fixture(t)
  const ctx = { llm: { async *stream() { yield { type: 'text-delta', text: '{"memories":[]}' } } } }
  const engine = new MemoryEngine(ctx, { home, autoExtract: false })
  t.after(() => engine.close())
  const a = agent(workspace)
  await engine.end(a, 1)
  await assert.rejects(engine.run(workspace), /missing finish/)
  assert.equal((await engine.status(workspace)).pending, 1)
  ctx.llm = llm([])
  await engine.run(workspace)
  assert.equal((await engine.status(workspace)).pending, 0)
  assert.equal((await engine.status(workspace)).error, '')
})

test('timeouts and new turns cancel background work without committing late responses', async t => {
  const { home, workspace } = await fixture(t)
  let finish
  const blocked = { async *stream() {
    await new Promise(resolve => { finish = resolve })
    yield { type: 'text-delta', text: '{"memories":[{"text":"late","scope":"project"}]}' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const engine = new MemoryEngine({ llm: blocked }, { home, autoExtract: false, requestTimeoutMs: 20 })
  t.after(() => engine.close())
  const a = agent(workspace)
  await engine.end(a, 1)
  await assert.rejects(engine.run(workspace), /超时/)
  finish()
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal((await engine.store.list(workspace)).length, 0)
  const running = engine.run(workspace)
  const rejected = assert.rejects(running, /会话继续/)
  await eventually(() => Boolean(engine.state(workspace).controller))
  await engine.begin(a)
  await rejected
  finish()
  assert.equal((await engine.status(workspace)).pending, 1)
  await assert.rejects(engine.run(workspace), /正在对话/)
})

test('manual global updates refresh all active workspace summaries; disposed subagents are ignored', async t => {
  const { home, workspace, other } = await fixture(t)
  const engine = new MemoryEngine({ llm: llm() }, { home, autoExtract: false })
  t.after(() => engine.close())
  const a = agent(workspace), b = agent(other, 'other')
  await engine.prepare(a); await engine.prepare(b)
  await engine.mutate(workspace, 'write', { text: '用户喜欢简洁回答', scope: 'user' })
  assert.match(engine.snapshot(b), /简洁回答/)
  const sub = agent(workspace, 'sub'); sub.session.header.origin = 'subagent'
  await engine.end(sub, 1)
  assert.equal((await engine.status(workspace)).pending, 0)
  assert.equal(engine.snapshot(sub), '')
})

test('legacy core files import once and remain traceable; old plugins/skills are not imported', async t => {
  const { home, store, workspace } = await fixture(t)
  const directory = path.join(workspace, '.dsh-memory')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'MEMORY.md'), '记住 pnpm test')
  await writeFile(path.join(directory, '2026-10-01.md'), '已经验证测试通过')
  await writeFile(path.join(directory, 'skills.md'), 'must not import')
  await importLegacy(store, workspace, home)
  let state = await store.load()
  assert.equal(Object.keys(state.sources).length, 2)
  for (let i = 0; i < 2; i++) await store.consolidate(workspace, await store.nextBatch(workspace), [])
  await writeFile(path.join(directory, 'MEMORY.md'), 'changed legacy file must not be reimported')
  await importLegacy(store, workspace, home)
  assert.equal(await store.nextBatch(workspace), null)
  assert.equal((await store.search(workspace, 'pnpm', 10, true)).sources.length, 1)
})

test('only the current turn is captured, excluding runtime summaries', async () => {
  const a = agent('/project')
  a.session.events.unshift({ type: 'user/message', data: { content: [{ type: 'text', text: 'old turn' }] } })
  const text = turnSource(a, 1)
  assert.doesNotMatch(text, /old turn|stale memory injection/)
  assert.match(text, /test output/)
})

test('max-token and invalid JSON responses are failures, not empty successful extraction', async () => {
  const batch = { source: { content: 'data' }, records: [] }
  const bad = { async *stream() { yield { type: 'text-delta', text: '{"memories":[]}' }; yield { type: 'finish', reason: { kind: 'max-tokens' } } } }
  await assert.rejects(extract(bad, {}, batch, new AbortController().signal), /max-tokens/)
  const invalid = { async *stream() { yield { type: 'text-delta', text: 'invalid' }; yield { type: 'finish', reason: { kind: 'stop' } } } }
  await assert.rejects(extract(invalid, {}, batch, new AbortController().signal))
})
