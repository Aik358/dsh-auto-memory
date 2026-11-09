import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, appendFile, rename, stat } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { SidecarStore, SidecarStoreError } from '../index.js'
import { encodeEnvelope } from '../codec.js'
import { buildByTagPre, buildByCuePre, buildVersionsPre, expandByTagPre, traceByIdPre } from '../../../lib/wb-sidecar.js'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url))
const root = path.join(repo, 'artifacts/_index-gov-20261109/prototype-tests', `contracts-${Date.now()}-${randomUUID()}`)
await mkdir(root, { recursive: true })
const workspaceKey = '--prototype-contracts--'
const clean = value => JSON.parse(JSON.stringify(value))
const id = text => 'mem_' + createHash('sha256').update(text).digest('hex').slice(0, 32)
const entry = (key, source, tags = ['topic:shared'], cues = ['cue:shared'], extra = {}) => ({ id: id(key), source, title: key, section: key, kind: source.includes('/archive/') ? 'archive' : source.endsWith('/PLAN.md') ? 'plan' : 'ledger', tags, cues, preview: key, mtime: 0, criteria: 'unknown', futureField: { keep: ['unknown', 42] }, ...extra })
const snapshot = (entries, revisions = {}) => ({ version: 'wb_sidecar_pre_v1', ws: workspaceKey, rebuilt_at: '2026-11-09T00:00:00.000Z', entries, by_tag: buildByTagPre(entries), by_cue: buildByCuePre(entries), versions: buildVersionsPre(entries), sourceRevisions: revisions })
const open = async name => SidecarStore.open({ directory: path.join(root, name), workspaceKey, durable: true, lockTimeoutMs: 30000 })
const hasIndexCode = error => error instanceof SidecarStoreError && typeof error.code === 'string' && error.code.startsWith('INDEX_')

async function child(mode, directory, parameter) {
  return await new Promise((resolve, reject) => {
    const process = spawn(globalThis.process.execPath, [worker, mode, directory, workspaceKey, parameter], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    process.stdout.on('data', chunk => { stdout += chunk })
    process.stderr.on('data', chunk => { stderr += chunk })
    process.once('error', reject)
    process.once('exit', (code, signal) => {
      const result = { code, signal, stdout, stderr }
      writeFile(path.join(root, `worker-${mode}-${parameter}-${randomUUID()}.json`), JSON.stringify(result, null, 2) + '\n').then(() => resolve(result), reject)
    })
  })
}

async function journalPath(directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'))
  return path.join(directory, manifest.journal)
}

test('empty store returns the eight-field view, detached values and explicit closed errors', async () => {
  const store = await open('empty')
  const view = await store.loadView()
  assert.deepEqual(Object.keys(view), ['version', 'ws', 'rebuilt_at', 'entries', 'by_tag', 'by_cue', 'versions', 'sourceRevisions'])
  assert.equal(view.ws, workspaceKey)
  assert.deepEqual(view.entries, [])
  assert.equal(await store.getEntry(id('missing')), null)
  assert.deepEqual(await store.findByTag('missing'), [])
  view.entries.push({ id: 'caller-mutation' })
  assert.deepEqual((await store.loadView()).entries, [])
  await store.close()
  await assert.rejects(store.loadView(), { code: 'INDEX_CLOSED' })
  await assert.rejects(store.getEntry(id('missing')), { code: 'INDEX_CLOSED' })
})

test('source replacement preserves surviving slots, posting order and untouched metadata', async () => {
  const store = await open('ordered')
  const a = 'handoff/PLAN.md', b = 'handoff/handoff-20261109-120000.md', z = 'handoff/archive/PLAN-20261108-120000.md'
  const first = entry('a-first', a), other = entry('b-other', b), second = entry('a-second', a), archive = entry('z-archive', z)
  const initial = snapshot([first, other, second, archive], { [a]: 'a:1', [b]: 'b:1', [z]: 'z:1' })
  await store.importLegacy(initial, { operationId: 'import-ordered' })
  assert.deepEqual(clean(await store.loadView()), clean(initial))
  const replacement = { ...second, title: 'a-second-edited', tags: ['topic:new', 'topic:shared'], cues: ['cue:new'] }
  const added = entry('a-new', a, ['topic:new', 'topic:shared'], ['cue:new'])
  await store.replaceSource({ source: a, expectedRevision: 'a:1', sourceRevision: 'a:2', entries: [replacement, added] }, { operationId: 'replace-ordered' })
  const expectedEntries = [other, replacement, archive, added]
  const view = await store.loadView()
  assert.deepEqual(view.entries, expectedEntries)
  assert.deepEqual(clean(view.by_tag), clean(buildByTagPre(expectedEntries)))
  assert.deepEqual(clean(view.by_cue), clean(buildByCuePre(expectedEntries)))
  assert.deepEqual(clean(view.versions), clean(buildVersionsPre(expectedEntries)))
  assert.deepEqual(await store.findByTag('topic:shared'), expectedEntries)
  assert.deepEqual(await store.findByCue('cue:new'), [replacement, added])
  assert.deepEqual(await store.listSource(a), [replacement, added])
  assert.equal(await store.getEntry(first.id), null)
  const query = await store.getEntry(replacement.id)
  query.futureField.keep.push('caller-writes')
  assert.deepEqual((await store.getEntry(replacement.id)).futureField, second.futureField)
  assert.deepEqual(view.sourceRevisions, { [a]: 'a:2', [b]: 'b:1', [z]: 'z:1' })
  await store.close()
})

test('CAS, duplicate ids and multi-source validation fail without partial commit', async () => {
  const store = await open('atomic-validation')
  const a = 'handoff/PLAN.md', b = 'handoff/handoff-20261109-120001.md'
  const first = entry('existing', a)
  await store.replaceSource({ source: a, expectedRevision: null, sourceRevision: 'a:1', entries: [first] }, { operationId: 'seed' })
  const before = await store.exportLegacySnapshot()
  const status = await store.getStatus()
  await assert.rejects(store.replaceSource({ source: a, expectedRevision: 'wrong', sourceRevision: 'a:2', entries: [first] }, { operationId: 'stale-cas' }), hasIndexCode)
  await assert.rejects(store.replaceSources([
    { source: a, expectedRevision: 'a:1', sourceRevision: 'a:2', entries: [first, entry('would-change', a)] },
    { source: b, expectedRevision: null, sourceRevision: 'b:1', entries: [{ ...first, source: b }] },
  ], { operationId: 'cross-source-id-conflict' }), hasIndexCode)
  await assert.rejects(store.replaceSource({ source: a, expectedRevision: 'a:1', sourceRevision: 'a:2', entries: [first, first] }, { operationId: 'duplicate-id' }), hasIndexCode)
  await assert.rejects(store.replaceSource({ source: '../outside.md', sourceRevision: 'bad', entries: [] }, { operationId: 'escaped-source' }), hasIndexCode)
  assert.equal(await store.exportLegacySnapshot(), before)
  assert.equal((await store.getStatus()).seq, status.seq)
  assert.equal((await store.getStatus()).journalBytes, status.journalBytes)
  await store.close()
})

test('no-change, operation dedupe, restart, compaction and conflicting retries', async () => {
  const directory = path.join(root, 'idempotency')
  let store = await open('idempotency')
  const source = 'handoff/PLAN.md', original = entry('idempotency', source)
  const change = { source, expectedRevision: null, sourceRevision: 'r1', entries: [original] }
  await store.replaceSource(change, { operationId: 'stable-operation' })
  const before = await store.getStatus()
  const retry = await store.replaceSource(change, { operationId: 'stable-operation' })
  assert.equal(retry.alreadyApplied, true)
  await store.replaceSource({ source, expectedRevision: 'r1', sourceRevision: 'r1', entries: [original] }, { operationId: 'same-content' })
  assert.equal((await store.getStatus()).seq, before.seq)
  assert.equal((await store.getStatus()).journalBytes, before.journalBytes)
  await assert.rejects(store.replaceSource({ source, expectedRevision: 'r1', sourceRevision: 'r1', entries: [{ ...original, title: 'different content' }] }, { operationId: 'same-revision-different-content' }), { code: 'INDEX_REVISION_MISMATCH' })
  await assert.rejects(store.replaceSource({ ...change, sourceRevision: 'different' }, { operationId: 'stable-operation' }), { code: 'INDEX_OPERATION_CONFLICT' })
  await store.close()
  store = await SidecarStore.open({ directory, workspaceKey })
  assert.equal((await store.replaceSource(change, { operationId: 'stable-operation' })).alreadyApplied, true)
  const view = await store.exportLegacySnapshot()
  await store.compact()
  assert.equal(await store.exportLegacySnapshot(), view)
  assert.equal((await store.replaceSource(change, { operationId: 'stable-operation' })).alreadyApplied, true)
  await store.close()
  store = await SidecarStore.open({ directory, workspaceKey })
  assert.equal(await store.exportLegacySnapshot(), view)
  assert.equal((await store.replaceSource(change, { operationId: 'stable-operation' })).alreadyApplied, true)
  await store.close()
})

test('source removal keeps a revision tombstone and rejects stale resurrection', async () => {
  const store = await open('remove')
  const source = 'handoff/PLAN.md', value = entry('removable', source)
  await store.replaceSource({ source, expectedRevision: null, sourceRevision: 'r1', entries: [value] }, { operationId: 'create' })
  await store.removeSources([{ source, expectedRevision: 'r1' }], { operationId: 'remove' })
  assert.deepEqual(await store.listSource(source), [])
  assert.equal(await store.getEntry(value.id), null)
  assert.deepEqual(await store.findByTag('topic:shared'), [])
  const tombstone = await store.getSourceRevision(source)
  assert.match(tombstone, /^deleted:/)
  await assert.rejects(store.replaceSource({ source, expectedRevision: null, sourceRevision: 'r2', entries: [value] }, { operationId: 'stale-recreate' }), hasIndexCode)
  await store.replaceSource({ source, expectedRevision: tombstone, sourceRevision: 'r2', entries: [value] }, { operationId: 'recreate' })
  assert.deepEqual(await store.getEntry(value.id), value)
  await store.close()
})

test('parser changes invalidate a source once without manufacturing a new source revision', async () => {
  const store = await open('parser-version')
  const source = 'handoff/PLAN.md', value = entry('parser-version', source)
  const change = { source, sourceRevision: 'r1', entries: [value] }
  await store.replaceSource(change, { operationId: 'parser-v1', parserVersion: 'parser-1' })
  const first = await store.getStatus()
  await store.replaceSource({ ...change, expectedRevision: 'r1' }, { operationId: 'parser-v2', parserVersion: 'parser-2' })
  const second = await store.getStatus()
  assert.equal(second.seq, first.seq + 1)
  assert.equal(await store.getSourceRevision(source), 'r1')
  await store.replaceSource({ ...change, expectedRevision: 'r1' }, { operationId: 'parser-v2-no-change', parserVersion: 'parser-2' })
  assert.equal((await store.getStatus()).seq, second.seq)
  assert.equal((await store.getStatus()).journalBytes, second.journalBytes)
  await store.close()
})

test('rebuild rejects a stale global token and a fresh rebuild can remove old sources', async () => {
  const store = await open('rebuild')
  const a = 'handoff/PLAN.md', b = 'handoff/old.md'
  const first = entry('rebuild-original', a), stale = entry('rebuild-old-source', b)
  await store.replaceSources([
    { source: a, sourceRevision: 'a:1', entries: [first] },
    { source: b, sourceRevision: 'b:1', entries: [stale] },
  ], { operationId: 'seed-rebuild' })
  const old = await store.readSnapshot()
  const updated = { ...first, title: 'changed after capture' }
  await store.replaceSource({ source: a, expectedRevision: 'a:1', sourceRevision: 'a:2', entries: [updated] }, { operationId: 'newer-source' })
  const before = await store.exportLegacySnapshot()
  await assert.rejects(store.rebuild(old.view, { expectedState: old.revision, operationId: 'stale-rebuild' }), { code: 'INDEX_REVISION_CONFLICT' })
  assert.equal(await store.exportLegacySnapshot(), before)
  const fresh = await store.readSnapshot()
  const rebuilt = { ...updated, title: 'explicit rebuild result' }
  await store.rebuild(snapshot([rebuilt], { [a]: 'a:3' }), { expectedState: fresh.revision, operationId: 'fresh-rebuild' })
  assert.deepEqual((await store.loadView()).entries, [rebuilt])
  assert.equal(await store.getEntry(stale.id), null)
  assert.equal(await store.getSourceRevision(a), 'a:3')
  await store.close()
})

test('legacy import rejects an unknown future schema before publishing content', async () => {
  const store = await open('future-schema')
  const before = await store.getStatus()
  await assert.rejects(store.importLegacy({ ...snapshot([]), version: 'wb_sidecar_future_v99' }, { operationId: 'future-schema' }), hasIndexCode)
  assert.equal((await store.getStatus()).seq, before.seq)
  assert.deepEqual((await store.loadView()).entries, [])
  await store.close()
})

test('legacy import snapshots caller-owned input before asynchronous publication', async () => {
  const store = await open('detached-import')
  const source = 'handoff/PLAN.md'
  const legacy = snapshot([entry('detached-import', source)], { [source]: 'r1' })
  const expected = clean(legacy)
  const pending = store.importLegacy(legacy, { operationId: 'detached-import' })
  legacy.entries[0].title = 'caller changed the object before await'
  legacy.sourceRevisions[source] = 'caller-changed-revision'
  await pending
  assert.deepEqual(clean(await store.loadView()), expected)
  await store.close()
})

test('invalid parser options are rejected before journal append and leave future writes usable', async () => {
  const directory = path.join(root, 'invalid-parser-options')
  const store = await open('invalid-parser-options')
  const before = await store.getStatus()
  const source = 'handoff/PLAN.md'
  const change = { source, sourceRevision: 'r1', parserVersion: 'valid-source-parser', entries: [entry('invalid-parser-options', source)] }
  await assert.rejects(store.replaceSource(change, { operationId: 'invalid-parser-options', parserVersion: '' }), hasIndexCode)
  assert.equal((await store.getStatus()).seq, before.seq)
  assert.equal((await store.getStatus()).journalBytes, before.journalBytes)
  await store.replaceSource(change, { operationId: 'valid-after-invalid-parser', parserVersion: 'valid-source-parser' })
  assert.equal((await store.listSource(source)).length, 1)
  await store.close()
  const reopened = await SidecarStore.open({ directory, workspaceKey })
  assert.equal((await reopened.listSource(source)).length, 1)
  await reopened.close()
})

test('mutation options are captured when the call is accepted', async () => {
  const store = await open('captured-options')
  const source = 'handoff/PLAN.md', value = entry('captured-options', source)
  const options = { operationId: 'captured-options', parserVersion: 'captured-parser' }
  const pending = store.replaceSource({ source, sourceRevision: 'r1', entries: [value] }, options)
  options.parserVersion = ''
  options.operationId = 'caller-mutated-operation'
  await pending
  const before = await store.getStatus()
  await store.replaceSource({ source, sourceRevision: 'r1', entries: [value] }, { operationId: 'check-captured-parser', parserVersion: 'captured-parser' })
  assert.equal((await store.getStatus()).seq, before.seq)
  assert.equal((await store.getStatus()).journalBytes, before.journalBytes)
  const retry = await store.replaceSource({ source, sourceRevision: 'r1', entries: [value] }, { operationId: 'captured-options', parserVersion: 'captured-parser' })
  assert.equal(retry.alreadyApplied, true)
  await store.close()
})

test('mutating a caller-owned rebuild token cannot turn a stale capture into authority', async () => {
  const store = await open('captured-rebuild-token')
  const source = 'handoff/PLAN.md', original = entry('captured-rebuild', source)
  await store.replaceSource({ source, sourceRevision: 'r1', entries: [original] }, { operationId: 'seed-token' })
  const stale = await store.readSnapshot()
  await store.replaceSource({ source, expectedRevision: 'r1', sourceRevision: 'r2', entries: [{ ...original, title: 'newer protected title' }] }, { operationId: 'newer-token' })
  const current = await store.getStatus()
  const pending = store.rebuild(stale.view, { expectedState: stale.revision, operationId: 'mutable-token' })
  stale.revision.seq = current.seq
  await assert.rejects(pending, { code: 'INDEX_REVISION_CONFLICT' })
  assert.equal((await store.getEntry(original.id)).title, 'newer protected title')
  await store.close()
})

test('real child writers preserve all updates and a warmed reader observes their journal tail', async () => {
  const directory = path.join(root, 'multiprocess')
  const reader = await open('multiprocess')
  assert.equal((await reader.loadView()).entries.length, 0)
  const workers = await Promise.all([child('writer', directory, '11'), child('writer', directory, '22')])
  for (const result of workers) assert.equal(result.code, 0, result.stderr)
  const view = await reader.loadView()
  assert.equal(view.entries.length, 24)
  assert.equal(new Set(view.entries.map(e => e.id)).size, 24)
  assert.equal((await reader.getStatus()).seq, 24)
  assert.equal((await reader.findByTag('topic:parallel')).length, 24)
  assert.deepEqual(clean(view.by_tag), clean(buildByTagPre(view.entries)))
  await reader.close()
})

test('two processes competing on the same absent revision produce one commit and one conflict', async () => {
  const directory = path.join(root, 'multiprocess-cas')
  const reader = await open('multiprocess-cas')
  const results = await Promise.all([child('cas', directory, 'candidate-a'), child('cas', directory, 'candidate-b')])
  const values = results.map(result => { assert.equal(result.code, 0, result.stderr); return JSON.parse(result.stdout.trim()) })
  assert.equal(values.filter(value => value.committed).length, 1)
  assert.equal(values.filter(value => !value.committed && value.code.startsWith('INDEX_')).length, 1)
  assert.equal((await reader.loadView()).entries.length, 1)
  assert.equal((await reader.getStatus()).seq, 1)
  await reader.close()
})

test('only an incomplete log tail is repaired; a complete corrupt line fails without rewriting evidence', async () => {
  const directory = path.join(root, 'tail')
  const store = await open('tail')
  const source = 'handoff/PLAN.md'
  await store.replaceSource({ source, sourceRevision: 'r1', entries: [entry('tail', source)] }, { operationId: 'seed' })
  const file = await journalPath(directory)
  const original = await readFile(file)
  await appendFile(file, Buffer.from('{"incomplete":"残尾'))
  assert.equal((await store.loadView()).entries.length, 1)
  assert.deepEqual(await readFile(file), original)
  await store.replaceSource({ source, expectedRevision: 'r1', sourceRevision: 'r2', entries: [entry('tail-after', source)] }, { operationId: 'after-tail' })
  await appendFile(file, '{broken}\n')
  const corrupt = await readFile(file)
  await assert.rejects(store.loadView(), hasIndexCode)
  assert.deepEqual(await readFile(file), corrupt)
  await store.close()
})

test('missing published manifest is rejected by both warm and newly opened instances', async () => {
  const directory = path.join(root, 'missing-manifest')
  const store = await open('missing-manifest')
  const source = 'handoff/PLAN.md'
  await store.replaceSource({ source, sourceRevision: 'r1', entries: [entry('manifest', source)] }, { operationId: 'seed' })
  await rename(path.join(directory, 'manifest.json'), path.join(directory, 'manifest.preserved-evidence.json'))
  await assert.rejects(store.loadView(), { code: 'INDEX_CORRUPT' })
  await store.close()
  await assert.rejects(SidecarStore.open({ directory, workspaceKey }), { code: 'INDEX_CORRUPT' })
})

test('cold replay rejects checksum mismatch and valid-checksum sequence gaps without discarding evidence', async () => {
  for (const variant of ['checksum', 'sequence']) {
    const name = 'corrupt-' + variant, directory = path.join(root, name)
    const store = await open(name)
    const source = 'handoff/PLAN.md'
    await store.replaceSource({ source, sourceRevision: 'r1', entries: [entry(variant, source)] }, { operationId: variant })
    await store.close()
    const file = await journalPath(directory)
    const record = JSON.parse((await readFile(file, 'utf8')).trim())
    let malformed
    if (variant === 'checksum') {
      record.changes[0].sourceRevision = 'tampered-after-checksum'
      malformed = JSON.stringify(record) + '\n'
    } else {
      const { checksum, ...core } = record
      core.seq += 2
      malformed = encodeEnvelope(core) + '\n'
    }
    await writeFile(file, malformed)
    await assert.rejects(SidecarStore.open({ directory, workspaceKey }), { code: 'INDEX_CORRUPT' })
    assert.equal(await readFile(file, 'utf8'), malformed)
  }
})

test('an existing workspace cannot be opened under a different identity', async () => {
  const directory = path.join(root, 'workspace-identity')
  const store = await open('workspace-identity')
  await store.close()
  await assert.rejects(SidecarStore.open({ directory, workspaceKey: '--different-workspace--' }), { code: 'INDEX_CORRUPT' })
})

for (const stage of ['appendAfterWrite', 'compactBeforeManifest', 'compactAfterManifest']) {
  test(`actual worker termination at ${stage} leaves a complete recoverable generation`, async () => {
    const name = 'kill-' + stage
    const directory = path.join(root, name)
    const seed = await open(name)
    const source = 'handoff/PLAN.md'
    await seed.replaceSource({ source, sourceRevision: 'r1', entries: [entry('kill-seed', source)] }, { operationId: 'kill-seed' })
    const before = await seed.exportLegacySnapshot()
    const beforeStatus = await seed.getStatus()
    await seed.close()
    const killed = await child('crash', directory, stage)
    assert.notEqual(killed.code, 0, `Crash hook not executed: ${killed.stderr}`)
    assert.equal(JSON.parse(killed.stdout.trim()).faultReached, stage)
    // Windows reports TerminateProcess as exit code 1 rather than a POSIX signal.
    assert(killed.signal === 'SIGKILL' || process.platform === 'win32' && killed.code === 1)
    assert.equal(killed.stderr, '', 'Termination must occur at the hook without a JavaScript exception')
    const recovered = await SidecarStore.open({ directory, workspaceKey, durable: true, lockTimeoutMs: 30000 })
    if (stage === 'appendAfterWrite') {
      assert.equal((await recovered.listSource('handoff/crash.md')).length, 1)
      assert.equal((await recovered.getStatus()).seq, beforeStatus.seq + 1)
    } else {
      assert.equal(await recovered.exportLegacySnapshot(), before)
      const generation = (await recovered.getStatus()).generation
      if (stage === 'compactBeforeManifest') assert.equal(generation, beforeStatus.generation)
      else assert.notEqual(generation, beforeStatus.generation)
    }
    const nextSource = 'handoff/after-crash.md'
    await recovered.replaceSource({ source: nextSource, expectedRevision: null, sourceRevision: 'after:1', entries: [entry('after-crash', nextSource)] }, { operationId: 'after-crash' })
    assert.equal((await recovered.listSource(nextSource)).length, 1)
    await recovered.close()
  })
}

test('sealed real legacy fixture preserves the complete view and existing expand/trace behavior', async t => {
  let base, meta
  try {
    base = JSON.parse(await readFile(path.join(repo, 'artifacts/_index-gov-20261109/work/poc-a/base.json'), 'utf8'))
    meta = JSON.parse(await readFile(path.join(repo, 'artifacts/_index-gov-20261109/out/fixture-meta.json'), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') { t.skip('Local sealed memory fixture is not distributed with the prototype'); return }
    throw error
  }
  const legacy = { version: meta.version, ws: meta.ws, rebuilt_at: meta.rebuilt_at, entries: base.entries, by_tag: buildByTagPre(base.entries), by_cue: buildByCuePre(base.entries), versions: base.versions, sourceRevisions: base.sourceRevisions }
  assert.equal(createHash('sha256').update(JSON.stringify(legacy, null, 2)).digest('hex'), meta.originalSha256)
  const directory = path.join(root, 'real-fixture')
  const store = await SidecarStore.open({ directory, workspaceKey: meta.ws, durable: true })
  await store.importLegacy(legacy, { operationId: 'import-real' })
  const view = await store.loadView()
  assert.deepEqual(clean(view), clean(legacy))
  for (const tag of ['*', ...Object.keys(legacy.by_tag).slice(0, 12)]) assert.deepEqual(expandByTagPre(view, tag, 3), expandByTagPre(legacy, tag, 3))
  for (const value of legacy.entries.slice(0, 12)) assert.deepEqual(traceByIdPre(view, value.id), traceByIdPre(legacy, value.id))
  await store.compact()
  await store.close()
  const reopened = await SidecarStore.open({ directory, workspaceKey: meta.ws })
  assert.deepEqual(clean(await reopened.loadView()), clean(legacy))
  const manifestFile = path.join(directory, 'manifest.json')
  const manifestBytes = await readFile(manifestFile)
  const manifest = JSON.parse(manifestBytes)
  const checkpointFile = path.join(directory, manifest.checkpoint)
  const checkpointBytes = await readFile(checkpointFile)
  const checkpoint = JSON.parse(checkpointBytes)
  assert.equal(Object.hasOwn(checkpoint.payload.view, 'by_tag'), false)
  assert.equal(Object.hasOwn(checkpoint.payload.view, 'by_cue'), false)
  const source = 'handoff/PLAN.md'
  const originals = await reopened.listSource(source)
  const nextEntries = originals.map((value, i) => i === 0 ? { ...value, title: value.title + ' prototype change' } : value)
  const logFile = path.join(directory, manifest.journal)
  const logBefore = (await stat(logFile)).size
  const committed = await reopened.replaceSource({ source, expectedRevision: await reopened.getSourceRevision(source), sourceRevision: 'prototype-fixture-r2', entries: nextEntries }, { operationId: 'fixture-incremental' })
  assert(committed.bytesWritten < 64 * 1024, 'The sealed PLAN source transaction should fit under 64 KiB')
  assert.equal((await stat(logFile)).size - logBefore, committed.bytesWritten)
  assert.deepEqual(await readFile(manifestFile), manifestBytes)
  assert.deepEqual(await readFile(checkpointFile), checkpointBytes)
  const final = await reopened.loadView()
  assert.deepEqual(final.entries.filter(value => value.source !== source), legacy.entries.filter(value => value.source !== source))
  assert.deepEqual(clean(final.by_tag), clean(buildByTagPre(final.entries)))
  assert.deepEqual(clean(final.by_cue), clean(buildByCuePre(final.entries)))
  await reopened.close()
})

test.after(async () => {
  await writeFile(path.join(root, 'run-location.json'), JSON.stringify({ directory: root, noProductionWrites: true }, null, 2) + '\n')
  console.log('Prototype test artifacts: ' + root)
})
