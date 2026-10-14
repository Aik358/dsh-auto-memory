import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { loadPrivateEngine } from '../lib/load-private-engine.mjs'

const { MemoryEngine, DEFAULT_CONFIG } = await loadPrivateEngine()
const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-recall-evidence-'))
const userFile = path.join(dir, 'user', 'MEMORY.md'), notesPath = path.join(dir, 'MEMORY.md')
const ids = [1, 2, 3].map((n) => 'mem_' + n.toString(16).padStart(32, '0'))
const anchor = (id, body) => '<!-- memory:' + id + ' -->\n' + body
const p = { ws: dir, projectDir: dir, reflectDir: path.join(dir, 'reflections'), userFile, notesPath }
const engine = Object.create(MemoryEngine.prototype)
engine.config = { ...DEFAULT_CONFIG, handoffEnabled: false, semanticEngineMode: 'lexical' }
engine.resolvePaths = async () => p
engine.listDailyLogs = async () => [{ name: '2026-10-14.md' }]
engine.listReflections = async () => []
engine.searchHandoffCorpus = engine.discoverWorkspaces = engine.searchSessionHistory = async () => []
engine.external = { search: async () => [] }
try {
  await fs.mkdir(path.dirname(userFile))
  await fs.writeFile(notesPath, '')
  await fs.writeFile(path.join(dir, '2026-10-14.md'), Array.from({ length: 16 }, (_, i) => 'alpha weak log ' + i).join('\n'))
  await fs.writeFile(userFile, anchor(ids[0], '## General heading\n' + 'prefix '.repeat(80) + 'alpha beta DOC-UNIQUE-001 condition-keep 🙂') + '\n' +
    anchor(ids[1], '## Old conclusion\nalpha beta evidence-one\n<!-- dsh-status: retracted -->') + '\n' +
    anchor(ids[2], '## Other conclusion\n' + 'identical-prefix '.repeat(10) + 'alpha beta evidence-two'))
  const hits = await engine.collectHits(['alpha', 'beta'], 4)
  assert.ok(hits.some((h) => h.memoryId === ids[0]), 'strong user evidence must survive log saturation')
  assert.ok(hits.some((h) => h.memoryId === ids[2]), 'records with similar prefixes remain distinct')
  const first = hits.find((h) => h.memoryId === ids[0])
  assert.match(first.line, /DOC-UNIQUE-001/, 'excerpt must include the matching position')
  assert.equal(first.sourcePath, userFile)
  const old = hits.find((h) => h.memoryId === ids[1])
  assert.equal(old.status, 'retracted')
  assert.ok(old.mark, 'withdrawn evidence must retain its warning')
  let answerPrompt = ''
  engine.runSubagent = async (prompt, tag) => { if (tag === 'auto-memory-smart-kw') return 'alpha\nbeta'; answerPrompt = prompt; return 'fixture answer' }
  engine.withTimeout = async (work) => work
  const smart = await engine._smartRecallCore('alpha beta')
  assert.ok(smart.hits.some((h) => h.status === 'retracted' && h.mark))
  assert.match(answerPrompt, /status=retracted/)
  const full = await engine.recall('DOC-UNIQUE-001', 8, undefined, 'current', { format: 'full' })
  assert.match(full, /condition-keep 🙂/, 'full format must retain the end of a matching line')
  const l0 = await engine.recall('DOC-UNIQUE-001', 8, undefined, 'current', { format: 'l0', fusion: 'legacy' })
  assert.match(l0, new RegExp(ids[0]), 'L0 lexical match must search anchored bodies as well as headings')
  engine._jsSemanticRank = async () => ({ scores: new Map([[ids[0], 0.95]]) })
  const semantic = await engine.recall('non-lexical-query', 8, undefined, 'current', { format: 'full' })
  assert.match(semantic, new RegExp('\\[' + ids[0] + '\\]'), 'semantic hits must carry expandable full IDs')
  engine._jsSemanticRank = null
  await fs.writeFile(notesPath, Array.from({ length: 14 }, (_, i) => 'alpha weak ' + i).join('\n') + '\nalpha beta strongest-late-evidence')
  const ordered = await engine.recall('alpha beta', 1, undefined, 'current', { format: 'full' })
  assert.match(ordered, /strongest-late-evidence/, 'rank after scanning all matches')
  await fs.mkdir(path.join(dir, 'archive'))
  assert.match(await engine.recall('alpha', 8, undefined, 'archive'), /暂无归档文件/)
  await fs.mkdir(path.join(dir, 'archive', 'bad.md'))
  await fs.writeFile(path.join(dir, 'archive', 'good.md'), 'alpha complete source')
  const partial = await engine.recall('alpha', 8, undefined, 'archive')
  assert.match(partial, /complete source/)
  assert.match(partial, /检索不完整.*bad.md/)
  await fs.rm(path.join(dir, 'archive'), { recursive: true })
  await fs.writeFile(path.join(dir, 'archive'), 'not a directory')
  assert.match(await engine.recall('alpha', 8, undefined, 'archive'), /检索失败/)
  console.log('PASS #382/#399/#401/#402/#404/#406 recall preserves strong late evidence and source coordinates')
} finally { await fs.rm(dir, { recursive: true, force: true }) }
