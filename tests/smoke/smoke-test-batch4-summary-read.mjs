import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const liveEntry = new URL('../../lib/index.js', import.meta.url)
const kinds = ['log', 'reflection', 'user', 'notes', 'calendar', 'plan', 'archive', 'summary']
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const fixtureTime = Date.UTC(2026, 10, 23, 10)

async function run(entry) {
  const fixture = await mkdtemp(path.join(tmpdir(), 'dam-summary-read-'))
  const previousHome = process.env.DSH_HOME
  const previousFetch = globalThis.fetch
  const profile = path.join(fixture, 'profile')
  const user = path.join(fixture, 'configured-user')
  const directory = path.join(user, 'summaries')
  const registered = new Map()
  const disposers = []
  const noop = () => () => {}
  let passes = 0
  const passed = (name, evidence) => {
    passes++
    console.log('PASS ' + name, evidence ?? '')
  }
  const writeSummary = async (name, data, mtime) => {
    const source = path.join(directory, name)
    const content = Buffer.from(JSON.stringify({
      summary: '完成时段总结 🧪',
      works: [{ title: '保留结论', points: ['保留完整换行'] }],
      ...data,
    }, null, 2).replace(/\n/g, '\r\n') + '\r\n')
    await writeFile(source, content)
    await utimes(source, mtime / 1000, mtime / 1000)
    return source
  }
  try {
    process.env.DSH_HOME = profile
    globalThis.fetch = async () => ({ ok: false, status: 503 })
    await mkdir(profile)
    await writeFile(path.join(profile, 'dsh-auto-memory.json'), JSON.stringify({
      userMemoryDir: user, memoryRoot: path.join(fixture, 'projects'), externalSources: {},
    }))
    const { apply } = await import(entry)
    apply({
      get: () => undefined, on: noop, systemPrompt: { section: noop, context: noop },
      tools: { register(tool) { registered.set(tool.name, tool); return noop() } },
      webServer: { register: noop },
      effect(runEffect) { const dispose = runEffect(); if (typeof dispose === 'function') disposers.push(dispose) },
    }, {})
    const tool = registered.get('memory_read')
    assert.ok(tool, 'memory_read is registered')
    assert.deepEqual(tool.parameters.properties.kind.enum, kinds, 'registered summary kind is missing')
    passed('schema matches the documented kinds')
    const read = async (agent) => JSON.parse(await tool.execute({ kind: 'summary' }, { agent }))

    await mkdir(directory + '-pre', { recursive: true })
    await writeFile(path.join(directory + '-pre', '2026-11-22-old.json'), '{}')
    assert.deepEqual(await read(), {
      ok: false, scope: 'global', code: 'empty', reason: 'summary-directory-missing', path: directory,
    })
    passed('missing main directory returns an explicit empty result')

    await mkdir(directory)
    await writeFile(path.join(directory, 'unrelated.json'), '{')
    assert.deepEqual(await read(), {
      ok: false, scope: 'global', code: 'empty', reason: 'no-summary-files', path: directory,
    })
    passed('unrelated files do not count as summary candidates')

    const generated = await writeSummary('2026-11-23-下午.json', { generatedAt: fixtureTime }, fixtureTime - 10_000)
    await writeSummary('2026-11-23-morning.json', { generatedAt: fixtureTime - 50_000 }, fixtureTime + 10_000)
    const first = await read({ session: { id: 'summary-a', header: { cwd: path.join(fixture, 'a') } } })
    const second = await read({ session: { id: 'summary-b', header: { cwd: path.join(fixture, 'b') } } })
    assert.equal(first.path, generated, 'valid generatedAt takes precedence over reverse mtime order')
    assert.deepEqual(second, first)
    assert.deepEqual([first.ok, first.scope, first.generatedAt, first.timestampSource], [true, 'global', fixtureTime, 'generatedAt'])
    const sourceBytes = await readFile(first.path)
    const returnedBytes = Buffer.from(first.content)
    assert.deepEqual(returnedBytes, sourceBytes, 'full JSON text must match the source file')
    assert.equal(first.bytes, sourceBytes.length)
    assert.equal(hash(returnedBytes), hash(sourceBytes))
    passed('generatedAt beats reverse mtime, two workspaces share exact disk bytes', {
      path: first.path, bytes: first.bytes, diskSha256: hash(sourceBytes), replySha256: hash(returnedBytes),
    })

    await writeSummary('2026-11-23-noon.json', { generatedAt: 'invalid' }, fixtureTime + 90_000)
    await writeSummary('2026-11-24-dawn.json', {}, fixtureTime + 90_000)
    const tieWinner = await writeSummary('2026-11-24-existing.json', { generatedAt: 0 }, fixtureTime + 90_000)
    const fallback = await read()
    assert.equal(fallback.path, tieWinner, 'mtime tie is resolved by descending filename')
    assert.deepEqual([fallback.generatedAt, fallback.timestampSource, fallback.mtimeMs], [null, 'mtime', fixtureTime + 90_000])
    passed('legacy mtime fallback and stable filename tie', {
      path: fallback.path, generatedAt: fallback.generatedAt, mtimeMs: fallback.mtimeMs,
    })

    const broken = path.join(directory, '2026-11-24-malformed.json')
    await writeFile(broken, '{')
    const error = await read()
    assert.equal(error.code, 'unreadable', 'bad JSON returns unreadable')
    assert.deepEqual(error, { ok: false, scope: 'global', code: 'unreadable', reason: 'invalid-summary-json', path: broken })
    await writeFile(broken, Buffer.from([0xff, 0xfd]))
    assert.equal((await read()).code, 'unreadable', 'invalid UTF-8 returns unreadable')
    await writeFile(broken, '[]')
    assert.equal((await read()).reason, 'invalid-summary-record')
    passed('malformed JSON, UTF-8 and record shape are reported at their source path', error)

    const invalid = await tool.execute({ kind: 'summaries' }, {})
    assert.equal(invalid, 'memory_read: kind 无效(可选 ' + kinds.join('/') + ')。')
    passed('misspelled kind retains the invalid-kind response and lists valid choices')
    return passes
  } finally {
    for (const dispose of disposers.reverse()) await dispose()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    globalThis.fetch = previousFetch
    await rm(fixture, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
  }
}

async function checkMutants() {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-summary-read-mutants-'))
  try {
    const lib = path.join(root, 'lib')
    await cp(new URL('.', liveEntry), lib, { recursive: true })
    await writeFile(path.join(root, 'package.json'), '{"type":"module"}')
    const mutants = [
      ['summary-read.js', 'const at = generatedAt ?? stat.mtimeMs', 'const at = stat.mtimeMs', 'valid generatedAt takes precedence over reverse mtime order'],
      ['summary-read.js', "return unreadable(source, 'invalid-summary-json')", "return empty(root, 'no-summary-files')", 'bad JSON returns unreadable'],
      ['index.js', "enum: ['log', 'reflection', 'user', 'notes', 'calendar', 'plan', 'archive', 'summary']", "enum: ['log', 'reflection', 'user', 'notes', 'calendar', 'plan', 'archive']", 'registered summary kind is missing'],
    ]
    for (const [name, anchor, replacement, failure] of mutants) {
      const file = path.join(lib, name)
      const original = await readFile(file, 'utf8')
      assert.equal(original.split(anchor).length, 2, 'mutation anchor must be unique')
      await writeFile(file, original.replace(anchor, replacement))
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), path.join(lib, 'index.js')], { encoding: 'utf8' })
      assert.equal(child.status, 1, child.stdout + child.stderr)
      assert.ok(child.stderr.includes(failure), child.stderr)
      console.log('CAUGHT', name, failure)
      await writeFile(file, original)
    }
    const restored = spawnSync(process.execPath, [fileURLToPath(import.meta.url), path.join(lib, 'index.js')], { encoding: 'utf8' })
    assert.equal(restored.status, 0, restored.stdout + restored.stderr)
    assert.match(restored.stdout, /PASS 7 \/ FAIL 0/)
    console.log('PASS restored sources, 3 mutations caught')
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
  }
}

try {
  const childEntry = process.argv[2]
  const passes = await run(childEntry ? pathToFileURL(childEntry).href : liveEntry.href)
  if (!childEntry) await checkMutants()
  console.log('PASS ' + passes + ' / FAIL 0')
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
