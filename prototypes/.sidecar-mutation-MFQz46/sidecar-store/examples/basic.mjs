import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { SidecarStore, MarkdownSidecarAdapter } from '../index.js'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const directory = path.join(repository, 'artifacts/_index-gov-20261109/prototype-demo', randomUUID())
const workspaceKey = '--example-workspace--'
const store = await SidecarStore.open({ directory, workspaceKey, durable: true })
const markdown = new MarkdownSidecarAdapter(store, { workspaceKey })
let reader
try {
  const document = { source: 'handoff/PLAN.md', title: '白板 PLAN', kind: 'plan', text: '# 白板\n\n## 正在做\n完善索引 API。tag:索引治理\n\n## 下一步\n验证并发、重启和无变化短路。\n' }
  const first = await markdown.indexDocument({ ...document, expectedRevision: null }, { operationId: 'example:first' })
  const revision = await store.getSourceRevision(document.source)
  const noChange = await markdown.indexDocument({ ...document, expectedRevision: revision }, { operationId: 'example:no-change' })
  assert.equal(noChange.bytesWritten, 0)
  assert.equal(noChange.seq, first.seq)

  // A separate instance observes another writer through the same public API.
  reader = await SidecarStore.open({ directory, workspaceKey })
  await reader.loadView()
  const changedDocument = { ...document, text: document.text.replace('完善索引 API。', '索引 API 已完成，开始接入验证。') }
  const mutation = await markdown.indexDocument({ ...changedDocument, expectedRevision: revision }, { operationId: 'example:edit' })
  const observed = await reader.getSourceRevision(document.source)
  assert.notEqual(observed, revision)
  const tagged = await reader.findByTag('tag:索引治理')
  assert(tagged.length > 0)

  const beforeCompact = await store.loadView()
  const compaction = await store.compact()
  assert.deepEqual(await reader.loadView(), beforeCompact)
  const exported = await store.exportLegacySnapshot()
  await writeFile(path.join(directory, 'export-index.json'), exported)
  const summary = { directory, first, noChange, mutation, taggedEntries: tagged.length, compaction, exportBytes: Buffer.byteLength(exported) }
  await mkdir(path.join(repository, 'artifacts/_index-gov-20261109/out'), { recursive: true })
  await writeFile(path.join(repository, 'artifacts/_index-gov-20261109/out/prototype-basic.json'), JSON.stringify(summary, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await reader?.close()
  await store.close()
}
