import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { workspaceKey, legacyWorkspaceKey } from '../../lib/workspace-key.js'
import { workspaceSlugPre } from '../../lib/migrate-pack.js'
import { createJsSemanticEnginePre } from '../../lib/semantic-js.js'
import { createProcedureStorePre } from '../../lib/procedure-store.js'
import { buildSourceCatalog, CorpusRegistry } from '../../lib/m4-corpus.js'
import { MemoryEngine } from '../lib/audit-engine.mjs'
const root = await mkdtemp(path.join(os.tmpdir(), 'dam-audit-isolation-'))
const oldHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
try {
  assert.notEqual(workspaceKey(path.join(root, 'foo-bar')), workspaceKey(path.join(root, 'foo', 'bar')))
  assert.equal(workspaceKey('C:\\Foo\\Bar'), workspaceKey('c:/foo/bar'))
  assert.equal(workspaceSlugPre('C:\\Foo\\Bar'), workspaceKey('C:\\Foo\\Bar'))
  const engine = new MemoryEngine()
  engine.configLoaded = true
  engine.config.memoryRoot = path.join(root, 'memory')
  engine.config.userMemoryDir = path.join(root, 'user')
  const ws = path.join(root, 'foo-bar')
  const legacy = path.join(engine.config.memoryRoot, legacyWorkspaceKey(ws))
  await mkdir(legacy, { recursive: true }); await writeFile(path.join(legacy, 'MEMORY.md'), '旧歧义数据')
  await engine.migrateLegacy(ws, engine.projectDirOf(ws))
  assert.match(engine.state.workspaceMigrationWarning, /归属不明确/)
  await assert.rejects(readFile(path.join(engine.projectDirOf(ws), 'MEMORY.md')))
  assert.equal(await readFile(path.join(legacy, 'MEMORY.md'), 'utf8'), '旧歧义数据')
  await mkdir(path.join(legacy, 'hub'))
  await writeFile(path.join(legacy, 'hub/procedures.json'), JSON.stringify({ procedures: [{ scope: 'workspace', workspaceRef: legacyWorkspaceKey(ws), title: 'old skill' }, { scope: 'global', workspaceRef: '', title: 'global skill' }] }))
  await writeFile(path.join(legacy, '.workspace-owner.json'), JSON.stringify({ workspace: ws }))
  const copy = engine.copyDir
  engine.copyDir = async () => { throw new Error('copy-fault') }
  await engine.migrateLegacy(ws, engine.projectDirOf(ws))
  assert.match(engine.state.workspaceMigrationWarning, /copy-fault/)
  await assert.rejects(readFile(path.join(engine.projectDirOf(ws), 'MEMORY.md')))
  engine.copyDir = copy
  await engine.migrateLegacy(ws, engine.projectDirOf(ws))
  assert.equal(await readFile(path.join(engine.projectDirOf(ws), 'MEMORY.md'), 'utf8'), '旧歧义数据')
  const migratedSkills = JSON.parse(await readFile(path.join(engine.projectDirOf(ws), 'hub/procedures.json'), 'utf8')).procedures
  assert.equal(migratedSkills[0].workspaceRef, workspaceKey(ws))
  assert.equal(migratedSkills[1].scope, 'global')
  assert.equal(JSON.parse(await readFile(path.join(legacy, 'hub/procedures.json'), 'utf8')).procedures[0].workspaceRef, legacyWorkspaceKey(ws))
  let ref = 'ws-a'
  const store = createProcedureStorePre({ get workspaceRef() { return ref } })
  // Use valid production rows from creation, then activate via authorized promotion.
  const create = (title, scope, workspaceRef) => {
    const r = store.observe({ title, triggerPattern: 'test', steps: ['first'], successCriteria: ['pass'], sourceMemoryIds: [], scope, workspaceRef })
    assert.ok(r.ok)
    return r.procedure
  }
  const global = create('global', 'global', '')
  const a = create('workspace a', 'workspace', 'ws-a')
  const b = create('workspace b', 'workspace', 'ws-b')
  const snap = store.snapshot(); for (const p of snap.procedures) p.stage = 'active'
  assert.ok(store.restore(snap).ok)
  assert.deepEqual(store.activeProcedures().map(p => p.title), ['global', 'workspace a'])
  ref = 'ws-b'; assert.deepEqual(store.query().map(p => p.title), ['global', 'workspace b'])
  assert.deepEqual(store.activeProcedures({ workspaceRef: 'ws-a' }).map(p => p.title), ['global', 'workspace a'])
  const dense = createJsSemanticEnginePre({ pluginDir: root, injectEmbedder: {
    async embedPassages(texts) { await new Promise(r => setTimeout(r, 20)); return texts.map(t => new Float32Array(t.includes('alpha') ? [1,0] : [0,1])) },
    async embedQuery() { return new Float32Array([1,0]) },
  } })
  const ma = 'idx_pre_' + 'a'.repeat(32), mb = 'idx_pre_' + 'b'.repeat(32)
  const [ra, rb] = await Promise.all([
    dense.rank({ memoryIndexVersion: ma, records: [{ memoryId: 'a', text: 'alpha' }] }, 'q'),
    dense.rank({ memoryIndexVersion: mb, records: [{ memoryId: 'b', text: 'beta' }] }, 'q'),
  ])
  assert.equal(ra.miv, ma); assert.equal(rb.miv, mb)
  assert.deepEqual([...ra.scores], [['a', 1]]); assert.deepEqual([...rb.scores], [['b', 0]])
  dense.dispose()
  engine.state.ws = ws; engine.state.notesPath = path.join(engine.projectDirOf(ws), 'MEMORY.md')
  const expected = new CorpusRegistry({ sidecarDir: path.join(process.env.DSH_HOME, 'memory/index/files') }).get(buildSourceCatalog({ workspaceKey: ws, workspaceMemoryPath: engine.state.notesPath }))
  assert.equal(engine.tierCurrentMivPre(), expected.snapshot.memoryIndexVersion)
  const full = '白板完整正文与独立证据'
  const mid = 'mem_' + 'a'.repeat(32)
  const handoffDir = path.join(root, 'handoff'); await mkdir(handoffDir)
  const planPath = path.join(handoffDir, 'PLAN.md')
  await writeFile(planPath, '<!-- memory:' + mid + ' -->\n## 白板\n' + full)
  engine.resolvePaths = async () => ({ projectDir: root, reflectDir: path.join(root, 'reflections'), notesPath: engine.state.notesPath, userFile: path.join(root, 'user/MEMORY.md'), planPath, handoffDir })
  assert.match(await engine.expandMemoryRecordPre(mid), new RegExp(full))
  // Streaming JSONL record straddles the production 64 KiB boundary.
  const jsonl = path.join(root, 'session.jsonl')
  const first = JSON.stringify({ type: 'user', content: [{ type: 'text', text: 'x'.repeat(70000) }] })
  await writeFile(jsonl, first + '\n' + JSON.stringify({ type: 'assistant', content: [{ type: 'text', text: 'tail marker' }] }))
  const external = engine.external
  const text = await external.extractSessionText(jsonl, 2, 100000)
  assert.ok(text.includes('tail marker')); assert.ok(text.includes('x'.repeat(600)))
  console.log('PASS audit retrieval isolation: F03 F04 F12 F13 F14 F25')
} finally { await rm(root, { recursive: true, force: true }); if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome }
