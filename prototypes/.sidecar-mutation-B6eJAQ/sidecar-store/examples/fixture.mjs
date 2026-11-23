import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { SidecarStore } from '../index.js'
import { buildByTagPre, buildByCuePre } from '../../../lib/wb-sidecar.js'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const artifacts = path.join(repository, 'artifacts/_index-gov-20261109')
const base = JSON.parse(await readFile(path.join(artifacts, 'work/poc-a/base.json'), 'utf8'))
const meta = JSON.parse(await readFile(path.join(artifacts, 'out/fixture-meta.json'), 'utf8'))
const snapshot = { version: meta.version, ws: meta.ws, rebuilt_at: meta.rebuilt_at, entries: base.entries, by_tag: buildByTagPre(base.entries), by_cue: buildByCuePre(base.entries), versions: base.versions, sourceRevisions: base.sourceRevisions }
const sha = value => createHash('sha256').update(value).digest('hex')
assert.equal(sha(JSON.stringify(snapshot, null, 2)), meta.originalSha256)
const directory = path.join(artifacts, 'prototype-fixture', randomUUID())
const options = { directory, workspaceKey: meta.ws, durable: true }
const store = await SidecarStore.open(options)
let reader, reopened
try {
  const start = performance.now()
  await store.importLegacy(snapshot, { operationId: 'fixture:import' })
  const migrationMs = performance.now() - start
  assert.equal(sha(await store.exportLegacySnapshot()), meta.originalSha256)
  reader = await SidecarStore.open(options)
  await reader.loadView()
  const source = 'handoff/PLAN.md'
  const entries = await store.listSource(source)
  const initialStatus = await store.getStatus()
  const initialCheckpoint = await stat(initialStatus.checkpointPath)
  const writes = []
  const beforeRevision = await store.getSourceRevision(source)
  let revision = beforeRevision
  for (let i = 0; i < 9; i++) {
    const changed = entries.map((entry, index) => index ? entry : { ...entry, body: String(entry.body ?? '') + `\n原型调用 ${i}`, preview: `模块API更新 ${i}`, tags: [...(entry.tags ?? []), 'prototype:api'] })
    const nextRevision = `prototype:fixture:${i}`
    const t = performance.now()
    const result = await store.replaceSource({ source, expectedRevision: revision, sourceRevision: nextRevision, entries: changed }, { operationId: `fixture:update:${i}` })
    const elapsedMs = performance.now() - t
    if (i >= 2) writes.push({ elapsedMs, bytesWritten: result.bytesWritten })
    revision = nextRevision
  }
  const afterStatus = await store.getStatus()
  assert.equal((await stat(initialStatus.checkpointPath)).mtimeMs, initialCheckpoint.mtimeMs)
  assert.equal((await stat(initialStatus.checkpointPath)).size, initialCheckpoint.size)
  const readStart = performance.now()
  const found = await reader.findByTag('prototype:api')
  const freshReadMs = performance.now() - readStart
  assert.equal(found.length, 1)
  assert.equal(await reader.getSourceRevision(source), revision)
  const current = await store.loadView()
  assert.deepEqual(current.by_tag, JSON.parse(JSON.stringify(buildByTagPre(current.entries))))
  assert.deepEqual(current.by_cue, JSON.parse(JSON.stringify(buildByCuePre(current.entries))))
  const noOp = await store.replaceSource({ source, sourceRevision: revision, entries: await store.listSource(source) }, { operationId: 'fixture:no-op' })
  assert.equal(noOp.bytesWritten, 0)
  const compactStart = performance.now()
  const compaction = await store.compact()
  const compactionMs = performance.now() - compactStart
  reopened = await SidecarStore.open(options)
  assert.deepEqual(await reopened.loadView(), current)
  assert.deepEqual(await reader.loadView(), current)
  const compactedStatus = await reopened.getStatus()
  const checkpoint = JSON.parse(await readFile(compactedStatus.checkpointPath, 'utf8'))
  assert.equal(Object.hasOwn(checkpoint.payload.view, 'by_tag'), false)
  assert.equal(Object.hasOwn(checkpoint.payload.view, 'by_cue'), false)
  const times = writes.map(sample => sample.elapsedMs).sort((a, b) => a - b)
  const output = { runtime: process.version, directory, sourceSha256: meta.originalSha256, sourceEntries: snapshot.entries.length, changedSourceEntries: entries.length, migrationMs, samples: writes, medianWriteMs: times[Math.floor(times.length / 2)], writeBytes: writes.map(sample => sample.bytesWritten), previousIndexBytes: meta.originalBytes, checkpointUntouchedDuringWrites: true, freshReaderIncludingCatchUpMs: freshReadMs, compactMs: compactionMs, compactedCheckpointBytes: (await stat(compactedStatus.checkpointPath)).size, indexMapsAbsentFromCheckpoint: true, noOp, initialStatus, afterStatus, compaction, caveat: 'Actual module API with file sync/shared lock and in-memory source updates; 2 warmup + 7 samples. Not the full production PLAN writer, not a cold OS cache or power-failure benchmark. Checkpoint compaction is synchronous under the workspace lock.' }
  await mkdir(path.join(artifacts, 'out'), { recursive: true })
  await writeFile(path.join(artifacts, 'out/prototype-fixture.json'), JSON.stringify(output, null, 2) + '\n')
  console.log(JSON.stringify(output, null, 2))
} finally {
  await reopened?.close()
  await reader?.close()
  await store.close()
}
