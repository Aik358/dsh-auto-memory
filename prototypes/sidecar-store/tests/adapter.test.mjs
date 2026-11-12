import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { SidecarStore, MarkdownSidecarAdapter, SidecarStoreError } from '../index.js'
import { planRevisionPre } from '../../../lib/plan-store.js'
import { buildByTagPre, buildByCuePre } from '../../../lib/wb-sidecar.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const root = path.join(repo, 'artifacts/_index-gov-20261109/prototype-tests', 'adapter-' + randomUUID())
const workspaceKey = '--adapter-test--'
const document = { source: 'handoff/PLAN.md', kind: 'plan', text: '# 白板\n\n## 当前状态\n推进 API 接入。tag:索引治理\n\n## 下一步\n验证重启。\n' }
const make = async name => {
  const store = await SidecarStore.open({ directory: path.join(root, name), workspaceKey })
  return { store, adapter: new MarkdownSidecarAdapter(store, { workspaceKey }) }
}
const plain = value => JSON.parse(JSON.stringify(value))

test('Markdown adapter checks workspace identity and indexes through deterministic source parsing', async () => {
  const { store, adapter } = await make('workspace')
  try {
    assert.throws(() => new MarkdownSidecarAdapter(store, { workspaceKey: 'another-workspace' }), error => error instanceof SidecarStoreError)
    const write = await adapter.indexDocument({ ...document, expectedRevision: null }, { operationId: 'adapter:first' })
    assert.equal(write.changed, true)
    assert.equal(await store.getSourceRevision(document.source), planRevisionPre(document.text))
    const view = await store.loadView()
    assert.equal(view.entries.length, 2)
    assert.deepEqual(view.by_tag, plain(buildByTagPre(view.entries)))
    assert.deepEqual(view.by_cue, plain(buildByCuePre(view.entries)))
    assert.equal((await store.findByTag('tag:索引治理')).length, 1)
  } finally { await store.close() }
})

test('same text and metadata produce zero writes; changed parsing metadata has a distinct derivation identity', async () => {
  const { store, adapter } = await make('metadata')
  try {
    await adapter.indexDocument(document, { operationId: 'metadata:first' })
    const before = await store.getStatus()
    const same = await adapter.indexDocument(document, { operationId: 'metadata:same' })
    assert.equal(same.bytesWritten, 0)
    assert.equal(same.seq, before.seq)
    const revision = await store.getSourceRevision(document.source)
    const changed = { ...document, ts: '2026-11-09 23:59', mtime: 42 }
    const result = await adapter.indexDocument(changed, { operationId: 'metadata:changed' })
    assert.equal(result.changed, true)
    assert.equal(await store.getSourceRevision(document.source), revision)
    assert((await store.listSource(document.source)).every(entry => entry.mtime === 42 && entry.ts === changed.ts))
    assert.equal((await adapter.indexDocument(changed, { operationId: 'metadata:same-again' })).bytesWritten, 0)
  } finally { await store.close() }
})

test('adapter rebuild takes an explicit source scope and removes absent sources with tombstones', async () => {
  const { store, adapter } = await make('rebuild')
  try {
    const ledger = { source: 'handoff/handoff-20261109-120000.md', kind: 'ledger', text: '# 账本\n\n## 状态\n完成存储接口。tag:索引治理\n' }
    await adapter.indexDocuments([document, ledger], { operationId: 'rebuild:seed' })
    const result = await adapter.rebuild([{ ...document, text: document.text.replace('推进', '完成') }], { operationId: 'rebuild:only-plan' })
    assert.equal(result.changedSources.length, 2)
    assert.deepEqual(await store.listSource(ledger.source), [])
    assert.match(await store.getSourceRevision(ledger.source), /^deleted:/)
    const newView = await store.loadView()
    await store.compact()
    assert.deepEqual(await store.loadView(), newView)
    const disk = JSON.parse(await readFile((await store.getStatus()).checkpointPath, 'utf8'))
    assert.equal(Object.hasOwn(disk.payload.view, 'by_tag'), false)
    assert.equal(Object.hasOwn(disk.payload.view, 'by_cue'), false)
  } finally { await store.close() }
})

test('adapter rebuild refuses stale global state without applying its source replacements', async () => {
  const { store, adapter } = await make('rebuild-cas')
  try {
    await adapter.indexDocument(document)
    const old = await store.readSnapshot()
    await adapter.indexDocument({ ...document, text: document.text + '\n有另一笔更新。\n' })
    const before = await store.exportLegacySnapshot()
    await assert.rejects(adapter.rebuild([document], { expectedState: old.revision }), { code: 'INDEX_REVISION_CONFLICT' })
    assert.equal(await store.exportLegacySnapshot(), before)
  } finally { await store.close() }
})

test('legacy file import reads the supplied JSON file without modifying it', async () => {
  const { store, adapter } = await make('file-import')
  try {
    await mkdir(root, { recursive: true })
    const file = path.join(root, 'legacy-input.json')
    const legacy = { version: 'wb_sidecar_pre_v1', ws: workspaceKey, rebuilt_at: '', entries: [], by_tag: {}, by_cue: {}, versions: {}, sourceRevisions: {} }
    const original = JSON.stringify(legacy, null, 2)
    await writeFile(file, original)
    await adapter.importLegacyFile(file, { approvedRoot: root, operationId: 'import:file' })
    assert.equal(await readFile(file, 'utf8'), original)
    assert.deepEqual(await store.loadView(), legacy)
  } finally { await store.close() }
})
