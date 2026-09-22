// Repository audit regressions. Uses actual modules in a throwaway copy to expose
// private host methods without changing production exports or touching real DSH data.
import assert from 'node:assert/strict'
import { mkdtemp, cp, readFile, writeFile, mkdir, readdir, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temp = await mkdtemp(path.join(tmpdir(), 'dam-audit-runtime-'))
let passed = 0, failed = 0
async function check(name, run) {
  try { await run(); passed++; console.log('ok - ' + name) }
  catch (error) { failed++; console.error('FAIL - ' + name + '\n' + error.stack) }
}
try {
  await cp(path.join(root, 'lib'), path.join(temp, 'lib'), { recursive: true })
  await writeFile(path.join(temp, 'package.json'), '{"type":"module"}')
  const entry = path.join(temp, 'lib/index.js')
  const source = await readFile(entry, 'utf8')
  await writeFile(entry, source + '\nexport { MemoryEngine as AuditMemoryEngine }\n')
  const { AuditMemoryEngine } = await import(pathToFileURL(entry).href)
  const { scanPluginSubagentSessions } = await import(pathToFileURL(path.join(temp, 'lib/subagent-gc.js')).href)
  const { createShadowHost } = await import(pathToFileURL(path.join(temp, 'lib/shadow-host.js')).href)
  const { replay } = await import(pathToFileURL(path.join(temp, 'lib/shadow-retrieval.js')).href)
  const engine = { configLoaded: true, config: {}, expandUserPath: (value) => value }
  const probe = (dir) => AuditMemoryEngine.prototype.syncDirProbe.call(engine, dir)

  await check('writable sync directory is accepted and probe files are removed', async () => {
    const dir = path.join(temp, 'sync-good'); await mkdir(dir)
    const result = await probe(dir)
    assert.equal(result.exists, true)
    assert.equal(result.writable, true)
    assert.equal(result.ok, true)
    assert.deepEqual(await readdir(dir), [])
  })
  await check('parallel probes succeed without sharing or leaking a scratch file', async () => {
    const dir = path.join(temp, 'sync-parallel'); await mkdir(dir)
    const results = await Promise.all(Array.from({ length: 12 }, () => probe(dir)))
    assert.ok(results.every((result) => result.ok))
    assert.deepEqual(await readdir(dir), [])
  })
  await check('sync probe never overwrites a pre-existing timestamp-named file', async () => {
    const dir = path.join(temp, 'sync-sentinel'); await mkdir(dir)
    const timestamp = 1790079000000
    const sentinel = path.join(dir, '.dam-sync-probe-' + timestamp)
    await writeFile(sentinel, 'preserve me')
    const realNow = Date.now
    try { Date.now = () => timestamp; await probe(dir) } finally { Date.now = realNow }
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve me')
    assert.deepEqual(await readdir(dir), [path.basename(sentinel)])
  })
  await check('missing sync directories are not created or reported writable', async () => {
    const result = await probe(path.join(temp, 'missing'))
    assert.equal(result.ok, false); assert.equal(result.exists, false)
  })

  const events = [
    { type: 'session', version: 0, id: 'child', cwd: '/workspace', parentSession: 'parent', origin: 'subagent', delegationDepth: 1 },
    { type: 'subagent/descriptor', data: { label: 'auto-memory-summarize', mode: 'one-shot' } },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n'
  for (const name of ['session.v3.jsonl.zstd', 'session.v4.jsonl.zstd', 'session.jsonl.zstd', 'session.v4.jsonl', 'session.jsonl']) {
    await check('GC discovers and decodes ' + name, async () => {
      const sessionsRoot = path.join(temp, 'gc-' + name)
      const dir = path.join(sessionsRoot, 'workspace', 'child'); await mkdir(dir, { recursive: true })
      const file = path.join(dir, name)
      await writeFile(file, name.endsWith('.zstd') ? zstdCompressSync(Buffer.from(events)) : events)
      await utimes(file, 1, 1)
      const result = await scanPluginSubagentSessions({ sessionsRoot, keepMs: 0 })
      assert.equal(result.candidates.length, 1, JSON.stringify(result.reasons))
      assert.equal(result.candidates[0].file, file)
    })
  }
  await check('GC selects the latest live file instead of an old recyclable legacy file', async () => {
    const sessionsRoot = path.join(temp, 'gc-live')
    const dir = path.join(sessionsRoot, 'workspace', 'child'); await mkdir(dir, { recursive: true })
    const old = path.join(dir, 'session.v3.jsonl.zstd')
    const live = path.join(dir, 'session.v4.jsonl.zstd')
    await writeFile(old, zstdCompressSync(Buffer.from(events))); await utimes(old, 1, 1)
    await writeFile(live, zstdCompressSync(Buffer.from(events))); await utimes(live, 1000, 1000)
    const result = await scanPluginSubagentSessions({ sessionsRoot, now: 1001000, keepMs: 60000 })
    assert.equal(result.candidates.length, 0)
  })
  await check('GC excludes backup and corrupt filenames', async () => {
    const sessionsRoot = path.join(temp, 'gc-backups')
    const dir = path.join(sessionsRoot, 'workspace', 'child'); await mkdir(dir, { recursive: true })
    for (const name of ['session.backup.jsonl.zstd', 'session.corrupt.jsonl']) {
      await writeFile(path.join(dir, name), name.endsWith('.zstd') ? zstdCompressSync(Buffer.from(events)) : events)
    }
    const result = await scanPluginSubagentSessions({ sessionsRoot, keepMs: 0 })
    assert.equal(result.candidates.length, 0)
  })
  await check('shadow host replay delegates to the imported pure core', async () => {
    const fixture = { contextSnapshots: [{}], corpusSnapshot: {} }
    const file = path.join(temp, 'replay.json'); await writeFile(file, JSON.stringify(fixture))
    const host = createShadowHost({ engine: { config: {}, __dshHomeOverride: temp } })
    assert.deepEqual(host.replayFromFile(file), replay(fixture))
  })
  await check('all registered prompt surfaces, including the reference tail, are disposed once', async () => {
    // Execute the real registration statement, not a synthetic implementation. The
    // host's unrelated cleanup closure is intentionally not run in this unit test.
    const start = source.indexOf('const disposers = []')
    const end = source.indexOf('for (const tool of tools)', start)
    assert.ok(start >= 0 && end > start, 'host cleanup registration anchor missing')
    const calls = [0, 0, 0]
    const callbacks = calls.map((_, i) => () => { calls[i]++ })
    const collect = new Function('disposeContext', 'disposeSection', 'disposeTailSurface', source.slice(start, end) + '; return disposers')
    const disposers = collect(...callbacks)
    for (const callback of disposers) if (callbacks.includes(callback)) callback()
    assert.deepEqual(calls, [1, 1, 1])
  })
} finally {
  await rm(temp, { recursive: true, force: true })
}
console.log(`\n[audit-runtime] ${passed} passed, ${failed} failed`)
if (failed) process.exitCode = 1
