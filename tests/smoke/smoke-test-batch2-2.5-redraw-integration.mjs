import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MemoryEngine, apply } from '../lib/audit-engine.mjs'
import { eventStorePre } from '../../lib/event-store.js'

const root = path.resolve('artifacts', '_batch2-2.5-redraw-integration')
const workspace = path.join(root, 'workspace')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(workspace, { recursive: true })
const home = path.join(root, 'dsh-home')
const memoryRoot = path.join(home, 'memory', 'workspaces')
const userMemoryDir = path.join(home, 'memory')
await fs.mkdir(memoryRoot, { recursive: true })
await fs.mkdir(userMemoryDir, { recursive: true })
await fs.writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({ memoryRoot, userMemoryDir, ledgerDocEnabled: false, handoffEnabled: true, criteriaGate: false, autoContinueEnabled: false, teamEnabled: false, planAutoRedrawEnabled: false, externalSources: {} }))
const original = { home: process.env.DSH_HOME, interval: globalThis.setInterval, timeout: globalThis.setTimeout, fetch: globalThis.fetch, load: MemoryEngine.prototype.loadConfigSync }
const agent = { session: { id: 'synthetic-redraw', header: { cwd: workspace } } }
let engine, event
let pass = 0
process.on('uncaughtException', (e) => { console.error(e); process.exitCode = 1 })
const check = (value, message) => { assert.ok(value, message); pass++ }
const call = (args) => event.execute(args, { agent })
try {
  process.env.DSH_HOME = home
  globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return original.load.call(this) }
  apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: (tool) => { if (tool.name === 'memory_event') event = tool; return () => {} } }, webServer: { register: () => () => {} }, effect: () => {} }, {})
  const p = await engine.resolvePaths(agent)
  const storePath = path.join(p.handoffDir, 'event-store.json')
  const planPath = path.join(p.handoffDir, 'PLAN.md')
  const plan = async () => fs.readFile(planPath, 'utf8').catch(() => '')
  const custom = '## 自有卡\n人工  原文\n<!-- user -->父备注  原样\n<!-- /user -->\n### 自有子卡\n子卡  原文\n<!-- user -->子备注  原样\n<!-- /user -->\n'
  await fs.mkdir(p.handoffDir, { recursive: true })
  await fs.writeFile(planPath, '# Synthetic plan\n' + custom + '## 目标\n- 足够长的人工目标内容\n')
  const before = await plan()
  const create = await call({ action: 'create', name: '默认关闭事件', sections: { goal: '默认不重绘', doing: '隔离', deadend: '', next: '验收' } })
  check(create.includes('事件已建立') && !create.includes('白板重绘'), 'default off has no redraw notice')
  check((await plan()) === before, 'default off preserves exact plan bytes')
  const id = create.match(/evt_[0-9a-f]{8}/)[0]
  engine.config.planAutoRedrawEnabled = true
  const append = await call({ action: 'append', eventId: id, checkpoint: { idemKey: 'synthetic-redraw-1', kind: 'progress', text: '事件已成功，可重绘', goal: '目标', state: '已更新', dead: '', next: '下一步' } })
  check(append.includes('+1') && append.includes('白板重绘: redrawn') && append.includes('sidecar-fresh'), 'successful append redraws with sidecar status')
  let text = await plan()
  check(text.includes('## 自有卡\n<!-- memory:') && text.includes('### 自有子卡\n<!-- memory:') && text.includes('人工  原文') && text.includes('子卡  原文') && text.includes('父备注  原样') && text.includes('子备注  原样'), 'human parent and child and user notes survive; existing writer may add missing anchors')
  check(text.includes('默认关闭事件') && text.includes('eventId: ' + id), 'derived card has event identity')
  const memId = text.match(new RegExp('eventId: ' + id + '\\nmemId: (mem_[a-f0-9]{32})'))?.[1]
  check(!!memId, 'event binding allocated')
  text = text.replace('memId: ' + memId, 'memId: ' + memId + '\n<!-- user -->人工备注  原样\n<!-- /user -->')
  await fs.writeFile(planPath, text)
  const renamed = await call({ action: 'rename', eventId: id, name: '改名且重排' })
  check(renamed.includes('事件已改名') && renamed.includes('白板重绘'), 'rename redraws')
  text = await plan()
  check(text.includes(memId) && text.includes('人工备注  原样') && text.includes('## 自有卡\n<!-- memory:') && text.includes('### 自有子卡\n<!-- memory:') && text.includes('人工  原文') && text.includes('子卡  原文') && text.includes('父备注  原样') && text.includes('子备注  原样'), 'rename preserves memId, user note and human cards')
  const updated = await call({ action: 'set', eventId: id, sections: { doing: '新的进展内容用于重绘', next: '继续隔离验收' } })
  check(updated.includes('事件已更新') && updated.includes('白板重绘'), 'set redraws')
  text = await plan()
  check(text.includes('新的进展内容用于重绘') && text.includes('人工备注  原样'), 'new event state and human note coexist')
  const actualIndex = JSON.parse(await fs.readFile(path.join(p.handoffDir, 'index.json'), 'utf8'))
  check(actualIndex.entries.some((entry) => entry.source === 'handoff/PLAN.md'), 'sidecar has current plan entries')
  const beforeFailure = await plan()
  const write = engine.writePlanSnapshot.bind(engine)
  engine.writePlanSnapshot = async (_dir, content) => { if (typeof content === 'function') await content(await plan()); return { ok: false, error: 'synthetic-redraw-failure' } }
  const failure = await call({ action: 'set', eventId: id, summary: '事件成功但重绘失败' })
  engine.writePlanSnapshot = write
  check(failure.includes('事件已更新') && failure.includes('白板重绘失败（事件已成功）') && failure.includes('synthetic-redraw-failure'), 'event success and redraw failure separated')
  check((await plan()) === beforeFailure, 'redraw failure leaves previous plan untouched')
  const failedEvent = await eventStorePre.detail(storePath, id)
  check(failedEvent.event.summary === '事件成功但重绘失败', 'event remains committed after redraw failure')
  const duplicate = await call({ action: 'append', eventId: id, checkpoint: { idemKey: 'synthetic-redraw-1', kind: 'progress', text: '同一幂等重试' } })
  check(duplicate.includes('已去重'), 'deduped append preserves event semantics')
  const closed = await call({ action: 'close', eventId: id, outcome: '隔离验收完成' })
  check(closed.includes('事件已收口') && closed.includes('白板重绘'), 'close redraws current projection')
  const beforeInvalid = await plan()
  const invalid = await call({ action: 'rename', eventId: 'evt_ffffffff', name: '不存在' })
  check(invalid.includes('失败') && (await plan()) === beforeInvalid, 'invalid event does not redraw')
  const readIndex = JSON.parse(await fs.readFile(path.join(p.handoffDir, 'index.json'), 'utf8'))
  check(readIndex.entries.some((entry) => entry.source === 'handoff/PLAN.md' && entry.body.includes('改名且重排')), 'renamed event visible in sidecar')
  console.log('SUMMARY PASS ' + pass + ' / FAIL 0')
  console.log('PHYSICAL eventId=' + id + ' memId=' + memId + ' planBytes=' + Buffer.byteLength(await plan()) + ' sidecarEntries=' + readIndex.entries.length)
} finally {
  process.env.DSH_HOME = original.home
  globalThis.setInterval = original.interval
  globalThis.setTimeout = original.timeout
  globalThis.fetch = original.fetch
  MemoryEngine.prototype.loadConfigSync = original.load
}
