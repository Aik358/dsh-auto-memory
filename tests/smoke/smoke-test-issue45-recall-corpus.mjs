/**
 * Issue #45 regression: execute the production recall/read/list method bodies.
 * Run: node --test tests/smoke/smoke-test-issue45-recall-corpus.mjs
 *
 * No DSH bootstrap, model weights or network. Paths, session/external services,
 * diagnostic home and semantic providers are controlled boundary fixtures.
 * The parser, RRF, temporal parser and evidence/importance modules are real.
 * This is method-level integration, NOT a full-plugin/real-model E2E test.
 * ISSUE45_SOURCE_ROOT is only for testing a separate baseline/candidate tree.
 */
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const root = process.env.ISSUE45_SOURCE_ROOT
  ? path.resolve(process.env.ISSUE45_SOURCE_ROOT)
  : fileURLToPath(new URL('../../', import.meta.url))
const indexText = readFileSync(path.join(root, 'lib/index.js'), 'utf8').replace(/\r\n/g, '\n')
const sandbox = await mkdtemp(path.join(tmpdir(), 'issue45-recall-'))
after(async () => { await rm(sandbox, { recursive: true, force: true }) })
const diagnosticHome = path.join(sandbox, 'diagnostic-home')
await mkdir(path.join(diagnosticHome, 'memory/evidence/events'), { recursive: true })
const dependencies = ['l0-extract-pre.js', 'recall-fusion-pre.js', 'temporal-parse-pre.js', 'evidence-agg-pre.js', 'memory-importance-pre.js', 'note-status-apply-pre.js']
const loaded = new Map()
for (const dep of dependencies) loaded.set(dep, await import(pathToFileURL(path.join(root, 'lib', dep)).href))
// Fail during setup, rather than silently turning an absent dependency into a green fallback test.
assert.equal(typeof loaded.get('l0-extract-pre.js').buildL0IndexPre, 'function')
assert.equal(typeof loaded.get('recall-fusion-pre.js').rankFusionRRFPre, 'function')
assert.equal(typeof loaded.get('temporal-parse-pre.js').parseTemporalQueryPre, 'function')
assert.equal(typeof loaded.get('evidence-agg-pre.js').scanEvidenceEventsPre, 'function')
assert.equal(typeof loaded.get('memory-importance-pre.js').computeImportancePre, 'function')
// G3（2026-09-19）读侧：recall 的 L0 分支经 statusOf 读磁盘状态行 —— 缺它会让 G3 写了也读不回来。
assert.equal(typeof loaded.get('note-status-apply-pre.js').readRecordStatusPre, 'function')
const { buildL0IndexPre } = loaded.get('l0-extract-pre.js')

function extractMethod(signature) {
  const marker = '  async ' + signature
  const start = indexText.indexOf(marker)
  assert.ok(start >= 0, 'missing production method: ' + signature)
  assert.equal(indexText.indexOf(marker, start + marker.length), -1, 'ambiguous production method')
  // In this source style, method-close has two spaces; nested blocks have >=4.
  const close = indexText.indexOf('\n  }\n', start)
  assert.ok(close > start, 'missing production method closing line')
  return indexText.slice(start, close + '\n  }\n'.length)
}
const methods = [
  'readTextSafe(p) {',
  'listDailyLogs(projectDir, limit = 40) {',
  'listReflections(reflectDir, limit = 30) {',
  "recall(query, limit = 8, agent, scope = 'all', opts = null) {",
].map(extractMethod).join('\n')
const relocatedMethods = methods.replace(/import\('\.\/([^']+)'\)/g, (_, name) => {
  assert.ok(dependencies.includes(name), 'unreviewed dynamic dependency: ' + name)
  return 'import(' + JSON.stringify(pathToFileURL(path.join(root, 'lib', name)).href) + ')'
})
// DATE_RE is the fixture's ISO-filename gate. All test log names are valid ISO dates.
// The production reader/list/recall bodies themselves are not reimplemented.
const harnessModule = `
import { readFile, readdir, stat } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
const DATE_RE = /^\\d{4}-\\d{2}-\\d{2}$/
const dshHome = () => ${JSON.stringify(diagnosticHome)}
export const diagnostics = []
const diag = (message) => diagnostics.push(message)
export class RecallHarness {
${relocatedMethods}
}
`
const harnessPath = path.join(sandbox, 'real-recall-methods.mjs')
await writeFile(harnessPath, harnessModule)
const { RecallHarness, diagnostics } = await import(pathToFileURL(harnessPath).href)
const optsL0 = { format: 'l0' }
const firstSix = [50, 52, 79, 10, 41, 63]
const dateAt = (i, origin = '2026-09-15') => new Date(Date.parse(origin + 'T12:00:00Z') - i * 86400000).toISOString().slice(0, 10)
const l0Rows = (text) => text.split('\n').filter((s) => s.startsWith('· [mem_'))
const containsId = (text, id) => l0Rows(text).some((s) => s.includes('[' + id + ']'))

async function fixture(t, { logCount = 22, reflectionCount = 21, logSizes = firstSix,
  noteSize = 3, userSize = 3, crlf = false } = {}) {
  const dir = await mkdtemp(path.join(sandbox, 'case-'))
  t.after(async () => { await rm(dir, { recursive: true, force: true }) })
  const p = { ws: path.join(dir, '工作区 with spaces'), projectDir: path.join(dir, '工作区 with spaces/.dsh-memory'),
    reflectDir: path.join(dir, '反思 reflections'), userFile: path.join(dir, '用户 memory/MEMORY.md') }
  p.notesPath = path.join(p.projectDir, 'MEMORY.md')
  p.logPath = path.join(p.projectDir, dateAt(0) + '.md')
  await Promise.all([mkdir(p.projectDir, { recursive: true }), mkdir(p.reflectDir, { recursive: true }), mkdir(path.dirname(p.userFile), { recursive: true })])
  const records = [], targets = {}, paths = []
  let serial = 0
  async function source(file, size, kind, sourceIndex = 0) {
    const list = []
    for (let j = 0; j < size; j++) {
      const id = 'mem_' + (++serial).toString(16).padStart(8, '0') + '0'.repeat(24)
      let token = `fixture-common ordinary-${kind}-${sourceIndex}-${j}`
      const keys = []
      if (kind === 'log' && sourceIndex === 0 && j === 0) keys.push('fresh')
      if (kind === 'log' && sourceIndex === 5 && j === size - 1) keys.push('sixthTail')
      if (kind === 'log' && sourceIndex === 7 && j === size - 1) keys.push('oldLog')
      if (kind === 'reflection' && sourceIndex === reflectionCount - 1 && j === size - 1) keys.push('oldReflection')
      if (kind === 'note' && j === size - 1) keys.push('project')
      if (kind === 'user' && j === size - 1) keys.push('user')
      if (kind === 'log' && sourceIndex === logCount - 1 && j === size - 1) keys.push('lastLog')
      for (const key of keys) {
        const needle = `唯一线索-${key}-零四五`
        token += ' ' + needle
        targets[key] = { id, needle, file }
      }
      const body = 'RAW_BODY_NOT_IN_L0_' + id + ' 只在正文，不在摘要。'
      const record = { id, token, body, file, kind, sourceIndex }
      records.push(record); list.push(record)
    }
    const text = list.map((r) => `<!-- memory:${r.id} -->\n## ${r.token}\n${r.body}\n`).join('\n')
    await writeFile(file, crlf ? text.replace(/\n/g, '\r\n') : text)
    paths.push(file)
  }
  for (let i = 0; i < logCount; i++) await source(path.join(p.projectDir, dateAt(i) + '.md'), logSizes[i] ?? 7, 'log', i)
  for (let i = 0; i < reflectionCount; i++) await source(path.join(p.reflectDir, dateAt(i, '2026-09-14') + '.md'), 3, 'reflection', i)
  await source(p.notesPath, noteSize, 'note')
  await source(p.userFile, userSize, 'user')
  const engine = new RecallHarness()
  const reads = [], listCalls = []
  const originalRead = engine.readTextSafe.bind(engine)
  engine.readTextSafe = async (file) => { reads.push(file); return originalRead(file) }
  for (const method of ['listDailyLogs', 'listReflections']) {
    const real = engine[method].bind(engine)
    engine[method] = async (...args) => { listCalls.push({ method, args }); return real(...args) }
  }
  Object.assign(engine, { resolvePaths: async () => p, searchHandoffCorpus: async () => [],
    searchSessionHistory: async () => [], discoverWorkspaces: async () => [], external: { search: async () => [] } })
  const recall = (query, limit = 8, opts = optsL0, scope = 'all') => engine.recall(query, limit, undefined, scope, opts)
  return { dir, p, records, targets, paths, engine, reads, listCalls, recall }
}

function rankProvider(f, wanted, snapshots) {
  return async (snap) => {
    snapshots.push(snap)
    return { miv: snap.memoryIndexVersion, scores: new Map(snap.records
      .filter((r) => wanted.includes(r.memoryId)).map((r) => [r.memoryId, 0.93])) }
  }
}
// pre 线 miv 前缀为 `idx_pre_`（发布时由 tools/release.mjs 反转为 `idx_`）。
const hashRecords = (records) => 'idx_pre_' + createHash('sha256').update(JSON.stringify(records
  .map((r) => [r.memoryId, r.text]).sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))).digest('hex').slice(0, 32)

// Baseline and patched code run the identical tests. A red baseline must be a
// behavioural assertion failure, not a module import/setup failure.
test('fixture reproduces the reported growth: 45 sources, 476 L0 records, 295 in newest six logs', async (t) => {
  const f = await fixture(t)
  assert.equal(f.paths.length, 45)
  assert.equal(f.records.length, 476)
  const counts = []
  for (const file of f.paths.slice(0, 6)) counts.push(buildL0IndexPre(await readFile(file, 'utf8')).length)
  assert.deepEqual(counts, firstSix)
  assert.equal(counts.reduce((a, b) => a + b, 0), 295)
})
for (const fusion of ['rrf', 'legacy']) for (const key of ['sixthTail', 'oldLog', 'oldReflection', 'project', 'user']) {
  test(`lexical ${fusion}: ${key} remains reachable after 256 recent records`, async (t) => {
    const f = await fixture(t)
    const target = f.targets[key]
    const out = await f.recall(target.needle, 1, { format: 'l0', fusion })
    assert.ok(containsId(out, target.id), `missing ${key}: ${out}`)
    assert.equal(l0Rows(out).length, 1)
    assert.ok(!out.includes('RAW_BODY_NOT_IN_L0'))
  })
}
test('recent positive control still returns an L0 hit', async (t) => {
  const f = await fixture(t)
  assert.ok(containsId(await f.recall(f.targets.fresh.needle), f.targets.fresh.id))
})
for (const provider of ['_semanticRankBest', '_jsSemanticRank']) {
  test(`${provider}: dense-only old/reflection/project/user hits and full snapshot`, async (t) => {
    const f = await fixture(t), snapshots = []
    const wanted = ['oldLog', 'oldReflection', 'project', 'user'].map((k) => f.targets[k].id)
    f.engine[provider] = rankProvider(f, wanted, snapshots)
    const out = await f.recall('semantic-query-with-no-literal-overlap', 4)
    for (const id of wanted) assert.ok(containsId(out, id), 'missing dense-only hit ' + id)
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].records.length, f.records.length)
    assert.deepEqual(new Set(snapshots[0].records.map((r) => r.memoryId)), new Set(f.records.map((r) => r.id)))
    assert.equal(snapshots[0].memoryIndexVersion, hashRecords(snapshots[0].records))
    assert.equal(snapshots[0].pyPaths.notesPath, f.p.notesPath)
    assert.equal(snapshots[0].pyPaths.userFile, f.p.userFile)
  })
  test(`${provider}: provider exception does not lose old lexical hits`, async (t) => {
    const f = await fixture(t)
    f.engine[provider] = async () => { throw new Error('injected model unavailable') }
    assert.ok(containsId(await f.recall(f.targets.oldLog.needle), f.targets.oldLog.id))
  })
}
for (const response of [null, { scores: new Map() }]) test(`semantic ${response === null ? 'null' : 'empty'} falls back without truncating notes`, async (t) => {
  const f = await fixture(t)
  f.engine._semanticRankBest = async () => response
  assert.ok(containsId(await f.recall(f.targets.project.needle), f.targets.project.id))
})
test('best semantic provider retains priority over the direct JS provider', async (t) => {
  const f = await fixture(t), snapshots = []
  let directCalls = 0
  f.engine._semanticRankBest = rankProvider(f, [f.targets.user.id], snapshots)
  f.engine._jsSemanticRank = async () => { directCalls++; return null }
  assert.ok(containsId(await f.recall('dense-priority-no-literal'), f.targets.user.id))
  assert.equal(directCalls, 0)
})
test('legacy format semantic arm also sees every eligible source/record', async (t) => {
  const f = await fixture(t), snapshots = []
  f.engine._jsSemanticRank = rankProvider(f, ['oldLog', 'oldReflection', 'project', 'user'].map((k) => f.targets[k].id), snapshots)
  const out = await f.recall('dense-only-legacy-query', 8, null)
  assert.match(out, /== 语义命中/)
  for (const key of ['oldLog', 'oldReflection', 'project', 'user']) assert.ok(out.includes(f.targets[key].needle))
  assert.equal(snapshots[0].records.length, 476)
  assert.equal(snapshots[0].memoryIndexVersion, hashRecords(snapshots[0].records))
})
for (const size of [255, 256, 257, 4097]) test(`single-file tail remains reachable with ${size} L0 records`, async (t) => {
  const f = await fixture(t, { logCount: 1, reflectionCount: 0, logSizes: [size], noteSize: 0, userSize: 0 })
  assert.ok(containsId(await f.recall(f.targets.lastLog.needle, 1), f.targets.lastLog.id))
})
for (const key of ['project', 'user']) test(`${key}: no source quota loses the tail of a large MEMORY.md`, async (t) => {
  const f = await fixture(t, { noteSize: 300, userSize: 300 })
  assert.ok(containsId(await f.recall(f.targets[key].needle, 1), f.targets[key].id))
})
for (const limit of [1, 3, 8]) test(`L0 output remains bounded by limit=${limit} after full ranking`, async (t) => {
  const f = await fixture(t)
  const out = await f.recall('fixture-common', limit)
  assert.equal(l0Rows(out).length, limit)
  assert.ok(!out.includes('RAW_BODY_NOT_IN_L0'))
})
test('MIV includes an old-record edit but not the query or enumeration order', async (t) => {
  const f = await fixture(t), snapshots = []
  f.engine._semanticRankBest = rankProvider(f, [], snapshots)
  await f.recall('first-query'); await f.recall('second-query')
  assert.equal(snapshots[0].memoryIndexVersion, snapshots[1].memoryIndexVersion)
  const realList = f.engine.listDailyLogs.bind(f.engine)
  f.engine.listDailyLogs = async (...args) => (await realList(...args)).reverse()
  await f.recall('first-query')
  assert.equal(snapshots[0].memoryIndexVersion, snapshots[2].memoryIndexVersion)
  const oldFile = f.targets.oldLog.file
  await writeFile(oldFile, (await readFile(oldFile, 'utf8')).replace(f.targets.oldLog.needle, 'changed-old-record-heading'))
  await f.recall('first-query')
  assert.notEqual(snapshots[2].memoryIndexVersion, snapshots[3].memoryIndexVersion)
})
test('legacy semantic MIV changes for an old note edit', async (t) => {
  const f = await fixture(t), snapshots = []
  f.engine._jsSemanticRank = rankProvider(f, [], snapshots)
  await f.recall('query', 8, null)
  await writeFile(f.p.notesPath, (await readFile(f.p.notesPath, 'utf8')).replace(f.targets.project.needle, 'changed-project-heading'))
  await f.recall('query', 8, null)
  assert.notEqual(snapshots[0].memoryIndexVersion, snapshots[1].memoryIndexVersion)
})
test('exactly 40 logs and 30 reflections do not falsely report a cutoff', async (t) => {
  const f = await fixture(t, { logCount: 40, reflectionCount: 30 })
  assert.ok(!(await f.recall('nothing-matches-this-query')).includes('[本地检索范围受限]'))
})
for (const [logs, refs] of [[41, 21], [22, 31], [41, 31]]) test(`source window ${logs}/${refs}: report genuine cutoff, retain a miss, do not read excluded bodies`, async (t) => {
  const f = await fixture(t, { logCount: logs, reflectionCount: refs })
  const out = await f.recall('nothing-matches-this-query')
  assert.match(out, /未找到相关记忆/)
  assert.match(out, /\[本地检索范围受限\]/)
  assert.equal(out.includes('日志仅覆盖最近 40 份'), logs > 40)
  assert.equal(out.includes('反思仅覆盖最近 30 份'), refs > 30)
  assert.match(out, /未命中不代表从未记录/)
  if (logs > 40) assert.ok(!f.reads.includes(path.join(f.p.projectDir, dateAt(40) + '.md')))
  if (refs > 30) assert.ok(!f.reads.includes(path.join(f.p.reflectDir, dateAt(30, '2026-09-14') + '.md')))
})
test('window warning accompanies hits, not just misses; notes still enter the corpus', async (t) => {
  const f = await fixture(t, { logCount: 41, reflectionCount: 31 })
  const out = await f.recall(f.targets.project.needle)
  assert.ok(containsId(out, f.targets.project.id))
  assert.match(out, /\[本地检索范围受限\]/)
})
test('legacy format also reports the source window without turning a miss into a hit', async (t) => {
  const f = await fixture(t, { logCount: 41 })
  const out = await f.recall('nothing-matches-this-query', 8, null)
  assert.match(out, /未找到相关记忆/)
  assert.match(out, /日志仅覆盖最近 40 份/)
})
test('CRLF and non-ASCII paths preserve old-note recall', async (t) => {
  const f = await fixture(t, { crlf: true })
  assert.ok(containsId(await f.recall(f.targets.project.needle), f.targets.project.id))
})
test('empty query and expand bypass local listing', async (t) => {
  const f = await fixture(t)
  assert.match(await f.recall('  '), /query 为空/)
  let expansion = null
  f.engine.expandMemoryRecordPre = async (...args) => { expansion = args; return 'EXPAND_STUB' }
  assert.equal(await f.recall('', 8, { expand: f.targets.oldLog.id }), 'EXPAND_STUB')
  assert.equal(expansion[0], f.targets.oldLog.id)
  assert.equal(f.listCalls.length, 0)
})
for (const scope of ['handoff', 'sessions']) test(`${scope} scope does not enumerate or report local windows`, async (t) => {
  const f = await fixture(t, { logCount: 41, reflectionCount: 31 })
  const out = await f.recall('query', 8, optsL0, scope)
  assert.ok(out.includes('|' + scope + ']'))
  assert.equal(f.listCalls.length, 0)
  assert.ok(!out.includes('[本地检索范围受限]'))
})
test('missing files are fail-soft and genuine miss wording is retained', async (t) => {
  const f = await fixture(t, { logCount: 0, reflectionCount: 0, noteSize: 0, userSize: 0 })
  await rm(f.p.notesPath); await rm(f.p.userFile)
  assert.match(await f.recall('query'), /未找到相关记忆/)
})
test('L0 summary-only and unanchored-content boundaries are unchanged', async (t) => {
  const f = await fixture(t)
  const bodyNeedle = 'RAW_BODY_NOT_IN_L0_' + f.targets.project.id
  assert.match(await f.recall(bodyNeedle), /未找到相关记忆/)
  assert.ok((await f.recall(bodyNeedle, 8, null)).includes(bodyNeedle))
  await writeFile(f.p.notesPath, 'no-anchor-unique-test-content')
  assert.match(await f.recall('no-anchor-unique-test-content'), /未找到相关记忆/)
})
test('recall performs no writes to the memory fixture', async (t) => {
  const f = await fixture(t)
  const digest = async () => Promise.all(f.paths.map(async (p) => createHash('sha256').update(await readFile(p)).digest('hex')))
  const before = await digest()
  for (const key of ['oldLog', 'oldReflection', 'project', 'user']) await f.recall(f.targets[key].needle)
  assert.deepEqual(await digest(), before)
})
test('no accidental module-missing fallback occurred in the loaded method tests', () => {
  assert.ok(!diagnostics.some((s) => /ERR_MODULE_NOT_FOUND|Cannot find module/.test(s)), diagnostics.join('\n'))
})
