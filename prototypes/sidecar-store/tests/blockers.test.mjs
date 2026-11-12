import test from 'node:test'
import assert from 'node:assert/strict'
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { SidecarStore, MarkdownSidecarAdapter, SidecarStoreError } from '../index.js'

const testsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(testsDirectory, '../../..')
const root = path.join(repo, 'artifacts/_index-gov-20261109/prototype-tests', 'blockers-' + randomUUID())
const workspaceKey = '--sidecar-blockers--'
const source = 'handoff/PLAN.md'
const archiveSource = 'handoff/archive/PLAN-20261112.md'
const makeEntry = (id, entrySource, kind = 'plan') => ({ id, source: entrySource, kind, title: id, tags: ['topic:blockers'], cues: ['cue:blockers'] })
const snapshot = (entries, versions = {}, sourceRevisions = {}) => ({ version: 'wb_sidecar_pre_v1', ws: workspaceKey, rebuilt_at: '', entries, by_tag: {}, by_cue: {}, versions, sourceRevisions })
const open = (name, options = {}) => SidecarStore.open({ directory: path.join(root, name), workspaceKey, durable: true, ...options })
const change = (entry, revision = 'r1') => ({ source: entry.source, expectedRevision: null, sourceRevision: revision, entries: [entry] })

async function publicFailure(promise, code, causeCode) {
  await assert.rejects(promise, error => {
    assert(error instanceof SidecarStoreError, 'public API must reject with SidecarStoreError: ' + error?.stack)
    assert.equal(error.code, code)
    if (causeCode) assert.equal(error.cause?.code, causeCode)
    return true
  })
}

const lockHolder = fileURLToPath(new URL('./lock-holder.mjs', import.meta.url))
async function startLockHolder(lockPath) {
  const child = spawn(process.execPath, [lockHolder, lockPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', value => { stderr += value })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('lock holder did not become ready')) }, 5000)
    child.once('message', message => {
      if (message !== 'ready') return
      clearTimeout(timer)
      resolve()
    })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); reject(new Error('lock holder exited early: ' + code + ' ' + stderr)) })
  })
  return {
    child,
    async release() {
      const exited = once(child, 'exit')
      const released = new Promise((resolve, reject) => {
        child.once('message', message => { if (message === 'released') resolve() })
        child.once('error', reject)
        child.once('exit', code => reject(new Error('lock holder did not release: ' + code + ' ' + stderr)))
      })
      child.send('release')
      await released
      const [code, signal] = await exited
      assert.equal(code, 0, stderr)
      assert.equal(signal, null)
    },
    async kill() {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      const [code, signal] = await exited
      assert(signal === 'SIGKILL' || process.platform === 'win32' && code === 1)
    },
  }
}

async function assertNoLiveLock(directory) {
  const names = await readdir(directory)
  for (const name of names.filter(name => name === 'manifest.json.lock' || name === 'manifest.json.lock.acquire')) {
    let owner
    try { owner = JSON.parse(await readFile(path.join(directory, name), 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') continue
      throw error
    }
    assert.notEqual(owner.pid, process.pid, 'operation-owned lock must be released; another process may still hold its lock')
  }
  assert(!names.some(name => name.endsWith('.tmp')), 'atomic temporary files must be cleaned')
}

test('B1 opaque versions survive touched, removed and unrelated source changes through export/restart/compaction', async () => {
  const directory = path.join(root, 'versions-preserved')
  const current = makeEntry('mem_current', source)
  const archive = makeEntry('mem_archive', archiveSource, 'archive')
  const other = makeEntry('mem_other', 'handoff/other.md', 'ledger')
  const versions = {
    mem_current: ['handoff/archive/history-b.md', 'handoff/archive/history-a.md'],
    mem_archive: ['handoff/archive/history-a.md', archiveSource],
    mem_other: [],
    mem_without_current_entry: ['handoff/archive/orphan-history.md'],
  }
  const preserved = structuredClone(versions)
  const store = await open('versions-preserved')
  await store.importLegacy(snapshot([current, archive, other], versions, { [source]: 'p1', [archiveSource]: 'a1', 'handoff/other.md': 'o1' }))
  await store.replaceSource({ source, expectedRevision: 'p1', sourceRevision: 'p2', entries: [{ ...current, title: 'updated current' }] })
  assert.deepEqual((await store.loadView()).versions, preserved, 'an entry update is not authority to erase historical lineage')
  await store.removeSources([{ source, expectedRevision: 'p2' }])
  assert.deepEqual((await store.loadView()).versions, preserved, 'removing a derived entry must not erase its archival evidence')
  const exported = await store.exportLegacySnapshot()
  await store.compact()
  await store.close()
  const reopened = await SidecarStore.open({ directory, workspaceKey })
  assert.deepEqual((await reopened.loadView()).versions, preserved)
  assert.equal(await reopened.exportLegacySnapshot(), exported)
  await reopened.close()
})

test('B1 archive sources append with stable dedupe while duplicate and cross-source identities fail closed', async () => {
  const archive = makeEntry('mem_archive_append', archiveSource, 'archive')
  const store = await open('versions-append')
  const originalVersions = { mem_archive_append: ['handoff/archive/old-z.md', 'handoff/archive/old-a.md'], mem_new_archive: ['handoff/archive/preexisting-chain.md'] }
  await store.importLegacy(snapshot([archive], originalVersions, { [archiveSource]: 'a1' }))
  await store.replaceSource({ source: archiveSource, expectedRevision: 'a1', sourceRevision: 'a2', entries: [archive] })
  await store.replaceSource({ source: archiveSource, expectedRevision: 'a2', sourceRevision: 'a3', entries: [{ ...archive, title: 'same archive identity, new index revision' }] })
  const nextSource = 'handoff/archive/PLAN-20261113.md'
  const next = makeEntry('mem_new_archive', nextSource, 'archive')
  await store.replaceSource(change(next))
  await store.replaceSource({ source: nextSource, expectedRevision: 'r1', sourceRevision: 'r2', entries: [{ ...next, title: 'deduplicated archive source' }] })
  const before = await store.exportLegacySnapshot()
  await publicFailure(store.replaceSource({ source: 'handoff/archive/cross-source.md', sourceRevision: 'bad', entries: [{ ...archive, source: 'handoff/archive/cross-source.md' }] }), 'INDEX_ENTRY_CONFLICT')
  await publicFailure(store.replaceSource({ source: archiveSource, sourceRevision: 'bad-duplicate', entries: [archive, archive] }), 'INDEX_ENTRY_CONFLICT')
  assert.equal(await store.exportLegacySnapshot(), before)
  assert.deepEqual((await store.loadView()).versions, {
    mem_archive_append: ['handoff/archive/old-z.md', 'handoff/archive/old-a.md', archiveSource],
    mem_new_archive: ['handoff/archive/preexisting-chain.md', nextSource],
  })
  await store.close()
})

test('B2 parserVersion is a real readonly public getter matching status and the declaration', async () => {
  const store = await open('parser-getter', { parserVersion: 'parser-runtime-contract' })
  assert.equal(store.parserVersion, 'parser-runtime-contract')
  assert.equal(store.parserVersion, (await store.getStatus()).parserVersion)
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(store), 'parserVersion')
  assert.equal(typeof descriptor?.get, 'function')
  assert.equal(descriptor?.set, undefined)
  assert.throws(() => { store.parserVersion = 'caller-must-not-rewrite' }, TypeError)
  assert.equal(store.parserVersion, 'parser-runtime-contract')
  await store.close()
  const declaration = await readFile(path.join(repo, 'prototypes/sidecar-store/index.d.ts'), 'utf8')
  const storeClass = declaration.match(/export class SidecarStore \{[\s\S]*?\n\}/)?.[0]
  assert(storeClass)
  assert.match(storeClass, /readonly parserVersion: string/)
  const importOptions = declaration.match(/export interface ImportLegacyFileOptions extends MutationOptions \{[\s\S]*?\n\}/)?.[0]
  assert(importOptions)
  assert.match(importOptions, /approvedRoot: string/)
})

test('B3 approved-root imports accept absolute and root-relative regular files without changing input bytes', async () => {
  const approvedRoot = path.join(root, 'approved-import')
  await mkdir(approvedRoot, { recursive: true })
  const file = path.join(approvedRoot, 'legacy.json')
  const legacy = snapshot([], { mem_history: ['handoff/archive/old.md'] })
  const original = JSON.stringify(legacy, null, 2)
  await writeFile(file, original)
  for (const [name, input] of [['absolute-file', file], ['relative-file', 'legacy.json']]) {
    const store = await open(name)
    const adapter = new MarkdownSidecarAdapter(store, { workspaceKey })
    const result = await adapter.importLegacyFile(input, { approvedRoot, operationId: name })
    assert.equal(result.imported, true)
    assert.deepEqual((await store.loadView()).versions, legacy.versions)
    assert.equal(await readFile(file, 'utf8'), original)
    await store.close()
  }
})

test('B3 missing roots, directories, missing files and lexical/physical escapes reject without poisoning later import', async t => {
  const approvedRoot = path.join(root, 'boundary-root')
  const outside = path.join(root, 'outside')
  await mkdir(approvedRoot, { recursive: true })
  await mkdir(outside, { recursive: true })
  const validFile = path.join(approvedRoot, 'valid.json')
  await writeFile(validFile, JSON.stringify(snapshot([])))
  const outsideFile = path.join(outside, 'outside.json')
  await writeFile(outsideFile, JSON.stringify(snapshot([])))
  const store = await open('path-boundary')
  const adapter = new MarkdownSidecarAdapter(store, { workspaceKey })
  await publicFailure(adapter.importLegacyFile(validFile), 'INDEX_INVALID_ARGUMENT')
  await publicFailure(adapter.importLegacyFile(validFile, { approvedRoot: 'relative/root' }), 'INDEX_INVALID_ARGUMENT')
  await publicFailure(adapter.importLegacyFile(validFile, { approvedRoot: validFile }), 'INDEX_PATH')
  await publicFailure(adapter.importLegacyFile(approvedRoot, { approvedRoot }), 'INDEX_PATH')
  await publicFailure(adapter.importLegacyFile(outsideFile, { approvedRoot }), 'INDEX_PATH')
  await publicFailure(adapter.importLegacyFile('../outside/outside.json', { approvedRoot }), 'INDEX_PATH')
  await publicFailure(adapter.importLegacyFile('missing.json', { approvedRoot }), 'INDEX_PATH', 'ENOENT')
  await publicFailure(adapter.importLegacyFile(validFile, { approvedRoot: path.join(root, 'missing-root') }), 'INDEX_PATH', 'ENOENT')

  const junction = path.join(root, 'approved-root-junction')
  await symlink(approvedRoot, junction, 'junction')
  assert((await lstat(junction)).isSymbolicLink())
  await publicFailure(adapter.importLegacyFile(validFile, { approvedRoot: junction }), 'INDEX_PATH')
  const intermediate = path.join(approvedRoot, 'linked-directory')
  await symlink(outside, intermediate, 'junction')
  await publicFailure(adapter.importLegacyFile(path.join(intermediate, 'outside.json'), { approvedRoot }), 'INDEX_PATH')
  try {
    const fileLink = path.join(approvedRoot, 'file-symlink.json')
    await symlink(validFile, fileLink, 'file')
    assert((await lstat(fileLink)).isSymbolicLink())
    await publicFailure(adapter.importLegacyFile(fileLink, { approvedRoot }), 'INDEX_PATH')
  } catch (error) {
    if (error.code !== 'EPERM') throw error
    t.diagnostic('Direct file-symlink creation is unavailable (EPERM); real directory junction symlink paths were still exercised.')
  }
  const result = await adapter.importLegacyFile('valid.json', { approvedRoot })
  assert.equal(result.imported, true)
  await publicFailure(adapter.importLegacyFile('broken.json', { approvedRoot }), 'INDEX_PATH', 'ENOENT')
  await store.close()
})

test('B3 malformed JSON is a stable public data error with cause and a later valid import succeeds', async () => {
  const approvedRoot = path.join(root, 'json-errors')
  await mkdir(approvedRoot, { recursive: true })
  await writeFile(path.join(approvedRoot, 'broken.json'), '{not-json')
  await writeFile(path.join(approvedRoot, 'valid.json'), JSON.stringify(snapshot([])))
  const store = await open('json-errors')
  const adapter = new MarkdownSidecarAdapter(store, { workspaceKey })
  await assert.rejects(adapter.importLegacyFile('broken.json', { approvedRoot }), error => {
    assert(error instanceof SidecarStoreError)
    assert.equal(error.code, 'INDEX_INVALID_DATA')
    assert(error.cause instanceof SyntaxError)
    return true
  })
  assert.equal((await store.getStatus()).seq, 0)
  await adapter.importLegacyFile('valid.json', { approvedRoot })
  assert.equal((await store.getStatus()).entries, 0)
  await store.close()
})

test('B4 live-lock timeouts use INDEX_LOCK_TIMEOUT with cause, clean up, and leave the queued store usable', async () => {
  const directory = path.join(root, 'live-lock')
  const store = await open('live-lock', { lockTimeoutMs: 35 })
  const status = await store.getStatus()
  const alias = path.join(status.directory, 'via-directory-alias')
  await symlink(status.directory, alias, 'junction')
  assert((await lstat(alias)).isSymbolicLink())
  const holder = await startLockHolder(path.join(alias, 'manifest.json'))
  assert.equal(JSON.parse(await readFile(status.lockPath, 'utf8')).pid, holder.child.pid)
  const first = makeEntry('mem_lock_first', source)
  try {
    await publicFailure(store.replaceSource(change(first), { operationId: 'lock-first' }), 'INDEX_LOCK_TIMEOUT')
    await assertNoLiveLock(directory)
    await publicFailure(store.replaceSource(change(first), { operationId: 'lock-second' }), 'INDEX_LOCK_TIMEOUT')
    await assertNoLiveLock(directory)
  } finally { await holder.release() }
  await store.replaceSource(change(first), { operationId: 'after-lock-release' })
  assert.equal((await store.getStatus()).seq, 1)
  await assertNoLiveLock(directory)
  await store.close()
})

test('B4 open timeout has a public cause and a later open succeeds after lock release', async () => {
  const directory = path.join(root, 'open-lock')
  await mkdir(directory, { recursive: true })
  const alias = path.join(directory, 'via-directory-alias')
  await symlink(directory, alias, 'junction')
  const lockPath = path.join(alias, 'manifest.json')
  const holder = await startLockHolder(lockPath)
  assert.equal(JSON.parse(await readFile(path.join(directory, 'manifest.json.lock'), 'utf8')).pid, holder.child.pid)
  try {
    await publicFailure(SidecarStore.open({ directory, workspaceKey, lockTimeoutMs: 35 }), 'INDEX_LOCK_TIMEOUT')
    await assertNoLiveLock(directory)
  } finally { await holder.release() }
  const store = await SidecarStore.open({ directory, workspaceKey })
  await store.replaceSource(change(makeEntry('mem_after_open_timeout', source)))
  assert.equal((await store.listSource(source)).length, 1)
  await assertNoLiveLock(directory)
  await store.close()
})

test('B4 startup reclaim removes a real dead-process lock and subsequent writes work', async () => {
  const directory = path.join(root, 'dead-lock')
  await mkdir(directory, { recursive: true })
  const alias = path.join(directory, 'via-directory-alias')
  await symlink(directory, alias, 'junction')
  const holder = await startLockHolder(path.join(alias, 'manifest.json'))
  await holder.kill()
  assert((await lstat(path.join(directory, 'manifest.json.lock'))).isFile())
  const store = await SidecarStore.open({ directory, workspaceKey, lockTimeoutMs: 1000 })
  await store.replaceSource(change(makeEntry('mem_after_dead_lock', source)))
  await assertNoLiveLock(directory)
  await store.close()
})

test('B4 filesystem faults map to INDEX_PATH and compaction/append failures recover with usable queues', async () => {
  for (const stage of ['compactBeforeManifest', 'compactAfterManifest']) {
    const directory = path.join(root, 'fault-' + stage)
    let inject = true
    const store = await open('fault-' + stage, { fault: async actual => {
      if (inject && actual === stage) {
        inject = false
        throw Object.assign(new Error('injected storage full'), { code: 'ENOSPC', path: directory })
      }
    } })
    await publicFailure(store.compact(), 'INDEX_PATH', 'ENOSPC')
    await store.replaceSource(change(makeEntry('mem_after_' + stage, source)))
    assert.equal((await store.listSource(source)).length, 1)
    await assertNoLiveLock(directory)
    await store.close()
  }
  let appendInject = true
  const store = await open('fault-append', { fault: async stage => {
    if (appendInject && stage === 'appendAfterWrite') {
      appendInject = false
      throw Object.assign(new Error('injected append failure'), { code: 'ENOSPC' })
    }
  } })
  const entry = makeEntry('mem_append_failure', source)
  const request = change(entry)
  await publicFailure(store.replaceSource(request, { operationId: 'append-fault' }), 'INDEX_PATH', 'ENOSPC')
  const retry = await store.replaceSource(request, { operationId: 'append-fault' })
  assert.equal(retry.alreadyApplied, true)
  await store.replaceSource({ source: 'handoff/next.md', expectedRevision: null, sourceRevision: 'next', entries: [makeEntry('mem_after_append_failure', 'handoff/next.md', 'ledger')] })
  const acceptedBeforeClose = store.loadView()
  const closing = store.close()
  await publicFailure(store.getStatus(), 'INDEX_CLOSED')
  assert.equal((await acceptedBeforeClose).entries.length, 2)
  await closing
  await assertNoLiveLock(path.join(root, 'fault-append'))
})

test.after(async () => {
  await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'run-location.json'), JSON.stringify({ directory: root, hostname: os.hostname(), noProductionWrites: true }, null, 2) + '\n')
  console.log('B1-B4 test artifacts: ' + root)
})
