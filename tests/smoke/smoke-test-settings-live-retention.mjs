import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startRecallHost } from '../lib/pr420-host.mjs'

async function fixture(config, run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-live-retention-'))
  const host = await startRecallHost(home, config)
  try { await run(host, home) }
  finally { await host.close(); await fs.rm(home, { recursive: true, force: true }) }
}
function fact(store, n) {
  assert.equal(store.upsert({ scope: 'Workspace', subject: '测试主体' + n, predicate: '使用框架', object: 'React', sourceKind: 'explicit', provenance: ['mem_' + 'a'.repeat(32)] }).ok, true)
}
function episode(store, n, segments = 2) {
  for (let i = 0; i < segments; i++) assert.equal(store.append({ sessionRef: 'fixture-' + n, userText: '隔离经历测试 ' + n, eventSeq: i }).ok, true)
  return store.consolidate()
}

await test('fact limit changes govern subsequent writes without replacing stored facts', async () => {
  await fixture({ factRetentionMax: 30 }, async ({ engine, request }) => {
    const store = engine._factStore
    for (let i = 0; i < 12; i++) fact(store, i)
    const before = store.snapshot()
    assert.equal((await request('config', { factRetentionMax: 10 })).status, 200)
    assert.equal(engine._factStore, store)
    assert.deepEqual(store.snapshot().facts, before.facts, 'saving alone does not discard existing facts')
    assert.equal(store.retentionLimit(), 10)
    fact(store, 12)
    assert.equal(store.size, 10)
    assert.equal((await request('config', { factRetentionMax: 20 })).status, 200)
    for (let i = 13; i < 20; i++) fact(store, i)
    assert.equal(store.size, 17, 'raising the limit also reaches the existing store')
  })
})
await test('episode retention changes preserve the store and apply at the next consolidation', async () => {
  await fixture({ episodicRetention: 32, episodicMinSegments: 2 }, async ({ engine, request }) => {
    const store = engine._memoryHub.stores.episodic
    for (let i = 0; i < 17; i++) assert.equal(episode(store, i).ok, true)
    const ids = store.snapshot().episodes.map(e => e.episodeId)
    assert.equal((await request('config', { episodicRetention: 16 })).status, 200)
    assert.equal(engine._memoryHub.stores.episodic, store)
    assert.deepEqual(store.snapshot().episodes.map(e => e.episodeId), ids)
    assert.equal(episode(store, 17).ok, true)
    assert.equal(store.size, 16)
    assert.equal((await request('config', { episodicRetention: 18 })).status, 200)
    episode(store, 18); episode(store, 19)
    assert.equal(store.size, 18)
  })
})
await test('episode minimum reads saved changes in both directions', async () => {
  await fixture({ episodicMinSegments: 4 }, async ({ engine, request }) => {
    const store = engine._memoryHub.stores.episodic
    assert.equal((await request('config', { episodicMinSegments: 2 })).status, 200)
    assert.equal(episode(store, 1).ok, true)
    assert.equal((await request('config', { episodicMinSegments: 4 })).status, 200)
    assert.equal(episode(store, 2).reason, 'too-short')
    assert.equal(episode(store, 3, 4).ok, true)
  })
})
await test('rejected configuration saves do not change live retention parameters', async () => {
  await fixture({ factRetentionMax: 30, episodicMinSegments: 4 }, async ({ engine, request }, home) => {
    await fs.writeFile(path.join(home, 'dsh-auto-memory.json'), '{broken')
    assert.equal((await request('config', { factRetentionMax: 10, episodicMinSegments: 2 })).status, 500)
    assert.equal(engine._factStore.retentionLimit(), 30)
    assert.equal(episode(engine._memoryHub.stores.episodic, 1).reason, 'too-short')
    assert.equal(await fs.readFile(path.join(home, 'dsh-auto-memory.json'), 'utf8'), '{broken')
  })
})
