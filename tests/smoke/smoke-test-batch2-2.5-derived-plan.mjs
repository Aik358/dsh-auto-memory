import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { renderPlanFromEventsPre } from '../../lib/plan-render.js'
import { mergeDerivedPlanPre } from '../../lib/plan-derived.js'
import { anchoredPlanPre, planCardsPre, planRevisionPre } from '../../lib/plan-store.js'

const root = path.resolve('artifacts', '_batch2-2.5-derived-plan')
const mutationRoot = path.resolve('artifacts', '_batch2-2.5-derived-mutations')
const ws = 'fixture-task7'
let pass = 0, fail = 0
const failures = []
const evidence = []
const mk = (id, name, startMs, summary, extra = {}) => ({
  id, name, summary, status: 'active', startMs, createdAt: startMs,
  sections: { goal: '目标 ' + summary, doing: '进展 ' + summary, deadend: '', next: '下一步 ' + summary },
  checkpoints: [], ...extra,
})
const ids = {
  a: 'evt_a1a1a1a1', b: 'evt_b2b2b2b2', c: 'evt_c3c3c3c3',
  d: 'evt_d4d4d4d4', e: 'evt_e5e5e5e5', other: 'evt_f6f6f6f6',
}
const firstEvents = [
  mk(ids.a, '同名', 100, 'A'),
  mk(ids.b, '同名', 300, 'B'),
  mk(ids.c, '改名前', 200, 'C'),
  mk(ids.d, '退出投影', 250, 'D'),
]
const render = (events) => renderPlanFromEventsPre(events, { wsName: ws, now: Date.UTC(2026, 10, 12, 12) })
const orderedIds = (events) => events.slice().sort((a, b) => b.startMs - a.startMs || String(a.id).localeCompare(String(b.id))).map((event) => event.id)
const input = (events) => ({ text: render(events), eventIds: orderedIds(events) })
const merge = (existing, events) => mergeDerivedPlanPre(existing, input(events), { workspaceKey: ws })
const card = (text, name) => planCardsPre(text).find((item) => item.title === name)
const anchors = (text) => [...text.matchAll(/<!--\s*memory:(mem_[a-f0-9]{32})\s*-->/g)].map((match) => match[1])
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex')
function userNote(text, eventId, note) {
  const needle = 'memId: ' + text.match(new RegExp('eventId: ' + eventId + '\\nmemId: (mem_[a-f0-9]{32})'))?.[1] + '\n<!-- /model -->\n'
  assert.ok(text.includes(needle), 'binding fixture must contain eventId before adding notes')
  return text.replace(needle, needle + '<!-- user -->' + note + '\n<!-- /user -->\n')
}
const initialEvents = firstEvents
const initial = merge('', initialEvents)
assert.equal(initial.ok, true, initial.error)
const oldIds = { ...initial.bindings }
const custom = '## 自有卡\n人工  原文\n<!-- user -->父备注  原样\n<!-- /user -->\n### 自有子卡\n子卡  原文\n<!-- user -->子备注  原样\n<!-- /user -->\n'
const unbound = '### 未绑定旧卡\n<!-- memory:mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa -->\n不得凭同名认领\n'
let seeded = initial.text.replace('## 当前状态', custom + unbound + '## 当前状态')
seeded = userNote(seeded, ids.a, 'A 的备注  逐字节')
seeded = userNote(seeded, ids.d, '退出卡备注  不删除')
const secondEvents = [
  mk(ids.c, '改名后', 600, 'C'),
  mk(ids.e, '新增较早事件', 50, 'E'),
  mk(ids.a, '同名', 100, 'A'),
  mk(ids.b, '同名', 300, 'B'),
]
const second = merge(seeded, secondEvents)
assert.equal(second.ok, true, second.error + (second.debugMerged ? '\n' + second.debugMerged : ''))

async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   - ' + name) }
  catch (error) { fail++; failures.push({ name, error: error.message }); console.log('  FAIL - ' + name + ' :: ' + error.stack) }
}
console.log('=== Real render identity and preservation ===')
await test('D-01 actual renderer order, same-title events, rename/time/reorder inherit eventId anchors', async () => {
  const actualTitles = planCardsPre(render(secondEvents)).filter((item) => item.title.startsWith('### ')).map((item) => item.title)
  assert.deepEqual(actualTitles, ['### 改名后', '### 同名', '### 同名', '### 新增较早事件'])
  for (const [eventId, memId] of Object.entries(oldIds)) {
    if (eventId === ids.d) continue
    assert.equal(second.bindings[eventId], memId, eventId)
  }
  assert.notEqual(second.bindings[ids.a], second.bindings[ids.b])
  assert.ok(second.bindings[ids.e])
  assert.ok(card(second.text, '### 改名后'))
  evidence.push({ kind: 'identity', bindings: second.bindings, actualTitles })
})
await test('D-02 custom parent/child and unbound cards survive byte-for-byte exactly once', async () => {
  assert.equal(second.text.split(custom).length - 1, 1)
  assert.equal(second.text.split(unbound).length - 1, 1)
  assert.equal((second.text.match(/### 自有子卡/g) || []).length, 1)
  assert.equal(second.text.split('子卡  原文').length - 1, 1)
  assert.equal(second.text.split('父备注  原样').length - 1, 1)
  assert.equal(second.text.split('不得凭同名认领').length - 1, 1)
})
await test('D-03 derived user notes survive and exiting event with notes is frozen whole card', async () => {
  assert.ok(second.text.includes('A 的备注  逐字节'))
  assert.ok(second.text.includes('退出卡备注  不删除'))
  assert.equal(second.frozenIds.length, 1)
  assert.equal(second.frozenIds[0], oldIds[ids.d])
  assert.ok(!second.archivedIds.includes(oldIds[ids.d]))
  assert.ok(second.text.includes('eventId: ' + ids.d))
  assert.equal(second.bindings[ids.d], oldIds[ids.d])
})
await test('D-04 bare render+archivedIds loses custom/user content and reallocates identity', async () => {
  const bare = anchoredPlanPre(ws, render(secondEvents))
  assert.ok(!bare.includes(custom))
  assert.ok(!bare.includes('A 的备注  逐字节'))
  assert.ok(!bare.includes('退出卡备注  不删除'))
  assert.ok(!bare.includes('不得凭同名认领'))
  assert.notEqual(card(bare, '### 改名后').id, oldIds[ids.c])
  evidence.push({ kind: 'bare-render-loss', customLost: true, userLost: true, renamedIdChanged: true })
})
await test('D-05 no-change merge is byte-identical; real disk writer leaves mtime unchanged', async () => {
  const again = merge(second.text, secondEvents)
  assert.equal(again.ok, true, again.error)
  assert.equal(again.changed, false)
  assert.equal(again.text, second.text)
  assert.equal(again.revision, planRevisionPre(second.text))
  const file = path.join(root, 'handoff', 'PLAN.md')
  await fs.mkdir(path.dirname(file), { recursive: true })
  const write = (result) => result.ok && result.changed ? fs.writeFile(file, result.text) : Promise.resolve()
  await write(second)
  const before = await fs.stat(file)
  const diskBefore = await fs.readFile(file, 'utf8')
  await write(again)
  const after = await fs.stat(file)
  assert.equal(await fs.readFile(file, 'utf8'), diskBefore)
  assert.equal(after.mtimeMs, before.mtimeMs)
  assert.equal(new Set(anchors(diskBefore)).size, anchors(diskBefore).length)
  evidence.push({ kind: 'no-change', bytes: Buffer.byteLength(diskBefore), sha256: sha(diskBefore), revision: again.revision, anchors: anchors(diskBefore).length })
})
await test('D-06 new event never claims same-title unbound old card', async () => {
  const manual = initial.text.replace('## 当前状态', '### 同名\n<!-- memory:mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb -->\n未绑定同名旧卡\n<!-- user -->手工备注\n<!-- /user -->\n## 当前状态')
  const other = mk(ids.other, '同名', 900, 'OTHER')
  const result = merge(manual, [other])
  assert.equal(result.ok, true, result.error)
  assert.notEqual(result.bindings[ids.other], 'mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
  assert.ok(result.text.includes('未绑定同名旧卡'))
  assert.ok(result.text.includes('手工备注'))
})
console.log('')
console.log('=== Fail-closed negatives ===')
await test('D-07 missing/duplicate event binding and eventIds cardinality are rejected', async () => {
  const missing = mergeDerivedPlanPre(seeded, render(secondEvents), { workspaceKey: ws })
  assert.equal(missing.ok, false)
  assert.equal(missing.error, 'derived-event-ids-mismatch')
  const duplicate = mergeDerivedPlanPre(seeded, { text: render(secondEvents), eventIds: [ids.c, ids.c, ids.a, ids.b] }, { workspaceKey: ws })
  assert.equal(duplicate.ok, false)
  assert.equal(duplicate.error, 'derived-binding-duplicate')
  const count = mergeDerivedPlanPre(seeded, { text: render(secondEvents), eventIds: [ids.c] }, { workspaceKey: ws })
  assert.equal(count.ok, false)
  assert.equal(count.error, 'derived-event-ids-mismatch')
  const swappedModel = seeded.replace('eventId: ' + ids.a, 'eventId: ' + ids.b)
  const mismatch = mergeDerivedPlanPre(seeded, swappedModel, { workspaceKey: ws })
  assert.equal(mismatch.ok, false, JSON.stringify(mismatch))
  const wrongBinding = mergeDerivedPlanPre(seeded, swappedModel, { workspaceKey: ws })
  assert.equal(wrongBinding.ok, false)
  assert.equal(wrongBinding.error, 'derived-binding-duplicate')
})
await test('D-08 malformed binding, duplicate memId and unclosed user region fail closed', async () => {
  const malformed = merge(seeded.replace('eventId: ' + ids.a, 'eventId: not-event'), secondEvents)
  assert.equal(malformed.ok, false)
  assert.equal(malformed.error, 'derived-binding-missing')
  const duplicateMem = mergeDerivedPlanPre(seeded.replaceAll(oldIds[ids.b], oldIds[ids.a]), input(secondEvents), { workspaceKey: ws })
  assert.equal(duplicateMem.ok, false)
  assert.equal(duplicateMem.error, 'derived-anchor-duplicate')
  const unclosed = merge(seeded.replace('A 的备注  逐字节\n<!-- /user -->', 'A 的备注  逐字节'), secondEvents)
  assert.equal(unclosed.ok, false)
  assert.equal(unclosed.error, 'derived-user-unclosed')
})
await test('D-09 real renderer 30k truncation and over-limit existing text are rejected', async () => {
  const many = Array.from({ length: 60 }, (_, i) => mk('evt_' + String(i).padStart(8, 'a'), '长事件' + i, 1000 - i, '长'.repeat(400)))
  const truncated = render(many)
  assert.equal(truncated.length, 30000)
  assert.ok(truncated.endsWith('…'))
  const result = mergeDerivedPlanPre('', { text: truncated, eventIds: orderedIds(many) }, { workspaceKey: ws })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'derived-plan-truncated')
  const huge = mergeDerivedPlanPre('x'.repeat(30001), '', { workspaceKey: ws })
  assert.equal(huge.ok, false)
  assert.equal(huge.error, 'derived-plan-truncated')
})
console.log('')
console.log('=== Isolated mutation proof ===')
const clean = await fs.readFile('lib/plan-derived.js', 'utf8')
const variants = [
  { name: 'binding-inheritance-removed', anchor: 'const previous = old.events.get(eventId) || null', replacement: 'const previous = null' },
  { name: 'user-refill-removed', anchor: "+ (previous ? userBytes(previous) : '')", replacement: "+ ''" },
  { name: 'custom-preserved-removed', anchor: 'if (customPreamble) {', replacement: 'if (false) {' },
]
for (const variant of variants) assert.equal(clean.split(variant.anchor).length - 1, 1, variant.name)
for (const variant of variants) {
  const dir = path.join(mutationRoot, variant.name)
  await fs.mkdir(dir, { recursive: true })
  const source = clean.replace(variant.anchor, variant.replacement)
  await fs.writeFile(path.join(dir, 'plan-derived.js'), source)
  for (const dependency of ['plan-store.js', 'wb-sidecar.js', 'file-boundary.js']) await fs.copyFile(path.join('lib', dependency), path.join(dir, dependency))
  const module = await import(pathToFileURL(path.join(dir, 'plan-derived.js')).href + '?mutation=' + variant.name)
  const mutant = module.mergeDerivedPlanPre(seeded, input(secondEvents), { workspaceKey: ws })
  await test('MUT-' + variant.name + ' has discriminating behavior', async () => {
    if (variant.name === 'binding-inheritance-removed') {
      assert.equal(second.ok, true)
      assert.equal(mutant.ok, true, mutant.error)
      assert.notEqual(mutant.bindings[ids.c], oldIds[ids.c])
    } else if (variant.name === 'user-refill-removed') {
      assert.ok(second.text.includes('A 的备注  逐字节'))
      assert.equal(mutant.ok, true, mutant.error)
      assert.ok(!mutant.text.includes('A 的备注  逐字节'))
    } else {
      assert.ok(second.text.includes(custom))
      assert.equal(mutant.ok, true, mutant.error)
      assert.ok(!mutant.text.includes(custom))
    }
  })
  evidence.push({ kind: 'mutation', name: variant.name, result: 'CAUGHT' })
}
await test('MUT-restored clean module retains all protections', async () => {
  const result = merge(seeded, secondEvents)
  assert.equal(result.ok, true, result.error)
  assert.equal(result.text, second.text)
  assert.equal(result.revision, second.revision)
})
for (const file of ['lib/plan-derived.js', 'tests/smoke/smoke-test-batch2-2.5-derived-plan.mjs']) {
  const bytes = await fs.readFile(file)
  const text = bytes.toString('utf8')
  assert.equal(text.includes('\r\n') && text.split('\r\n').join('').includes('\n'), false, file)
  evidence.push({ kind: 'file', file, bytes: bytes.length, sha256: sha(bytes) })
}
await fs.mkdir(root, { recursive: true })
const report = { pass, fail, failures, mutationCaught: evidence.filter((item) => item.result === 'CAUGHT').length, restored: 'GREEN', evidence }
await fs.writeFile(path.join(root, 'derived-plan-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log('SUMMARY PASS ' + pass + ' / FAIL ' + fail)
console.log('MUTATION CAUGHT ' + report.mutationCaught + ' / MISSED 0')
console.log('RESTORED GREEN')
process.exitCode = fail ? 1 : 0
