import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fixture } from './helpers.js'
import { score } from '../lib/text.js'

test('archive → extraction → search → source pagination; workspace isolation', async t => {
  const { store, workspace, other } = await fixture(t)
  const content = '用户：项目使用 pnpm。\n工具：测试通过。\n' + 'original '.repeat(4000) + 'END'
  const id = await store.archive({ workspace, sessionId: 's1', turn: 2, content })
  assert.equal(await store.archive({ workspace, sessionId: 's1', turn: 2, content }), id)
  const batch = await store.nextBatch(workspace)
  assert.equal(batch.source.content.length, 24000)
  await store.consolidate(workspace, batch, [{ text: '项目使用 pnpm，测试通过。', scope: 'project' }])
  const result = await store.search(workspace, 'pnpm', 10, true)
  assert.equal(result.records.length, 1)
  assert.equal(result.sources.length, 1)
  assert.equal(result.records[0].sources[0], id)
  const first = await store.source(id, workspace)
  const second = await store.source(id, workspace, first.nextOffset, 24000)
  const last = await store.source(id, workspace, second.nextOffset)
  assert.equal(first.content + second.content + last.content, content)
  assert.equal(last.nextOffset, null)
  assert.deepEqual(await store.search(other, 'pnpm', 10, true), { records: [], sources: [] })
  await assert.rejects(store.source(id, other), /不存在/)
  assert.match(await store.summary(workspace), /pnpm/)
  assert.ok((await store.summary(workspace, 400)).length <= 400)
  assert.equal(await store.summary(other), '')
})

test('correction wins against a stale extraction; deletion cannot resurrect from old evidence', async t => {
  const { store, workspace } = await fixture(t)
  const id = await store.archive({ workspace, content: '用 npm。'.repeat(100) })
  const batch = await store.nextBatch(workspace, 20)
  await store.consolidate(workspace, batch, [{ text: '项目使用 npm。', scope: 'project' }])
  const old = (await store.list(workspace))[0]
  const inFlight = await store.nextBatch(workspace)
  const corrected = await store.write({ workspace, id: old.id, text: '项目已改用 pnpm。', scope: 'project', expectedVersion: old.version })
  assert.equal(corrected.version, old.version + 1)
  const stale = await store.consolidate(workspace, inFlight, [{ text: old.text, scope: 'project', id: old.id }])
  assert.equal(stale.stale, true)
  assert.equal((await store.read(old.id, workspace)).text, corrected.text)
  await assert.rejects(store.write({ workspace, id: old.id, text: '冲突', expectedVersion: old.version }), /已变化/)
  assert.equal((await store.search(workspace, 'npm', 10, true)).sources.some(source => source.id === id), false)
  assert.equal((await store.source(id, workspace)).suppressed, true)
  await store.remove(corrected.id, workspace, corrected.version)
  assert.equal(await store.summary(workspace), '')
  assert.equal(await store.nextBatch(workspace), null)
  await store.archive({ workspace, content: '重复导入相同旧事实，项目使用 npm。' })
  await store.consolidate(workspace, await store.nextBatch(workspace), [{ text: old.text, scope: 'project' }])
  assert.equal((await store.list(workspace)).length, 0)
})

test('global manual preferences are shared; automatic output cannot overwrite them', async t => {
  const { store, workspace, other } = await fixture(t)
  const record = await store.write({ workspace, text: '使用简体中文回答。', scope: 'user' })
  assert.equal((await store.list(other))[0].id, record.id)
  assert.match((await store.source(record.sources[0], other)).content, /简体中文/)
  await store.archive({ workspace, content: 'use English' })
  const batch = await store.nextBatch(workspace)
  assert.ok(batch.records.some(item => item.id === record.id))
  await store.consolidate(workspace, batch, [{ id: record.id, text: 'Use English.', scope: 'user' }])
  assert.equal((await store.read(record.id, other)).text, record.text)
})

test('validate full model output before any write; reject corrupt state without overwriting', async t => {
  const { store, workspace } = await fixture(t)
  await store.archive({ workspace, content: 'some facts' })
  const batch = await store.nextBatch(workspace)
  await assert.rejects(store.consolidate(workspace, batch, [{ text: 'valid', scope: 'project' }, { text: 'invalid', scope: 'team' }]))
  assert.equal((await store.list(workspace)).length, 0)
  assert.equal((await store.nextBatch(workspace)).expectedCursor, 0)
  await writeFile(store.file, '{broken')
  await assert.rejects(store.write({ workspace, text: 'must not replace' }))
  assert.equal(await readFile(store.file, 'utf8'), '{broken')
})

test('secrets are removed before raw archive, records and model candidates', async t => {
  const { store, workspace } = await fixture(t)
  const secret = 'sk-' + 'x'.repeat(30)
  const id = await store.archive({ workspace, content: `api_key=${secret} password=hunter22` })
  assert.doesNotMatch(await readFile(store.sourcePath(id), 'utf8'), /hunter22|sk-xxx/)
  const record = await store.write({ workspace, text: `api_key=${secret}` })
  assert.match(record.text, /REDACTED/)
  assert.doesNotMatch(JSON.stringify(await store.nextBatch(workspace)), /sk-xxx|hunter22/)
  await assert.rejects(store.source('../../outside', workspace))
})

test('Chinese and path keywords work; list pagination retains all records', async t => {
  const { store, workspace } = await fixture(t)
  assert.ok(score('中文测试', '项目中文测试通过') > 0)
  assert.ok(score('src/main.ts', '修改 src/main.ts') > 0)
  for (let i = 0; i < 6; i++) await store.write({ workspace, text: `record ${i}` })
  const a = await store.list(workspace, '', 3, 0)
  const b = await store.list(workspace, '', 3, 3)
  assert.equal(new Set([...a, ...b].map(record => record.id)).size, 6)
})

test('independent processes serialize concurrent store writes', async t => {
  const { store, workspace } = await fixture(t)
  const moduleURL = new URL('../lib/store.js', import.meta.url).href
  await Promise.all([0, 1, 2].map(worker => new Promise((resolve, reject) => {
    const code = `import {MemoryStore} from ${JSON.stringify(moduleURL)}; const store = new MemoryStore(process.argv[1]); for(let i=0;i<5;i++) await store.write({workspace:process.argv[2],text:process.argv[3]+'-'+i});`
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, store.root, workspace, String(worker)], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', data => { stderr += data })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr)))
  })))
  assert.equal((await store.list(workspace)).length, 15)
  assert.equal(Object.keys((await store.load()).sources).length, 15)
})
