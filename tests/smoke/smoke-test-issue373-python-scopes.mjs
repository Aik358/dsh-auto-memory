import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { CorpusRegistry, buildSourceCatalog, canonicalize } from '../../lib/m4-corpus.js'
import { createIndexSyncHostPre } from '../../lib/m7-index-sync-host.js'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-373-'))
try {
  const indexDir = path.join(root, 'index')
  const paths = { ws: root, notesPath: path.join(root, 'workspace.md'), userFile: path.join(root, 'user.md') }
  const ids = { Workspace: 'mem_' + 'a'.repeat(32), User: 'mem_' + 'b'.repeat(32) }
  const writer = new MemoryDocumentStore({ sidecarDir: path.join(indexDir, 'files') })
  for (const [scope, file] of [['Workspace', paths.notesPath], ['User', paths.userFile]]) {
    await fs.writeFile(file, '<!-- memory:' + ids[scope] + ' -->\n\nA specific persisted memory for ' + scope + '\n')
    assert.equal((await writer.rebuildSidecar(file)).ok, true)
  }
  const source = await fs.readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const begin = source.indexOf('    engine._pySemanticRank = async')
  const end = source.indexOf('    // P13 择优:', begin)
  assert.ok(begin >= 0 && end > begin)
  const queries = []
  const calls = [], readyScopes = new Set(), syncScopes = new Map()
  let epoch = null, failSync = false
  const engine = { config: { semanticEngineMode: 'python' }, resolveSemanticTier: async () => 'c3',
    _pythonModelReady: async () => true, preparePythonRecallPre: async () => true, pythonRuntimeCached: () => ({ chosen: 'fixture-python' }),
    _pythonSidecar: { currentEpoch: () => epoch, request: async (type, p) => {
      calls.push(type)
      if (type !== 'recall_rank') {
        epoch ||= 'fixture-worker'
        if (type === 'index_sync_begin') syncScopes.set(p.syncId, p.scope)
        if (type === 'index_sync_commit' && !failSync) readyScopes.add(syncScopes.get(p.syncId))
        return { ok: true, frame: { payload: { accepted: !failSync } } }
      }
      queries.push(p)
      assert.ok(readyScopes.has(p.scope), 'a cold scope must commit before recall')
      return { ok: true, frame: { payload: { scores: [{ memoryId: ids[p.scope], score: 0.9 }, { memoryId: 'unauthorized', score: 1 }] } } }
    } } }
  engine._indexSyncHost = createIndexSyncHostPre({ engine })
  vm.runInNewContext(source.slice(begin, end), { engine, path, memoryDir: () => indexDir, CorpusRegistry, buildSourceCatalog, canonicalize, recordDiagnosticErrorPre() {} })
  const result = await engine._pySemanticRank({ pyPaths: paths }, 'query')
  assert.deepEqual([...result.scores.keys()].sort(), Object.values(ids).sort())
  assert.deepEqual(queries.map((q) => q.scope).sort(), ['User', 'Workspace'])
  assert.equal(new Set(queries.map((q) => q.miv)).size, 1)
  assert.ok(calls.indexOf('index_sync_commit') < calls.indexOf('recall_rank'))
  assert.equal(engine.config.associativeMemoryEnabled, undefined, 'explicit recall does not enable automatic association')
  calls.length = 0
  await engine._pySemanticRank({ pyPaths: paths }, 'repeat')
  assert.deepEqual(calls, ['recall_rank', 'recall_rank'], 'same identity reuses both authorized scopes')
  epoch = null; readyScopes.clear(); calls.length = 0
  await engine._pySemanticRank({ pyPaths: paths }, 'after restart')
  assert.ok(calls.includes('index_sync_begin'), 'a stopped worker invalidates cached ready scopes')
  calls.length = 0; epoch = 'changed'; readyScopes.clear(); failSync = true
  assert.equal(await engine._pySemanticRank({ pyPaths: paths }, 'failed sync'), null)
  assert.ok(!calls.includes('recall_rank'), 'a failed sync never queries the unready index')
  failSync = false
  queries.length = 0
  delete engine._pyRankCorpusRegistry
  const userOnly = { ...paths, notesPath: undefined }
  const only = await engine._pySemanticRank({ pyPaths: userOnly }, 'user query')
  assert.deepEqual([...only.scores.keys()], [ids.User])
  engine.config.semanticEngineMode = 'lexical'; calls.length = 0
  const denied = await engine._indexSyncHost.ensureWorkspaceIndexReady({ records: [{}] }, {}, { explicitRecall: true })
  assert.equal(denied[0].ready, false); assert.equal(calls.length, 0)
  engine._indexSyncHost.dispose('test')
  console.log('PASS #373/#412 authorized scopes sync on explicit cold recall and preserve epoch, failure and lexical gates')
} finally { await fs.rm(root, { recursive: true, force: true }) }
