import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { CorpusRegistry, buildSourceCatalog, canonicalize } from '../../lib/m4-corpus.js'

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
  const engine = { config: { semanticEngineMode: 'python' }, resolveSemanticTier: async () => 'c3',
    _pythonSidecar: { request: async (_, p) => { queries.push(p); return { ok: true, frame: { payload: { scores: [{ memoryId: ids[p.scope], score: 0.9 }, { memoryId: 'unauthorized', score: 1 }] } } } } } }
  vm.runInNewContext(source.slice(begin, end), { engine, path, memoryDir: () => indexDir, CorpusRegistry, buildSourceCatalog, canonicalize, recordDiagnosticErrorPre() {} })
  const result = await engine._pySemanticRank({ pyPaths: paths }, 'query')
  assert.deepEqual([...result.scores.keys()].sort(), Object.values(ids).sort())
  assert.deepEqual(queries.map((q) => q.scope).sort(), ['User', 'Workspace'])
  assert.equal(new Set(queries.map((q) => q.miv)).size, 1)
  queries.length = 0
  delete engine._pyRankCorpusRegistry
  const userOnly = { ...paths, notesPath: undefined }
  const only = await engine._pySemanticRank({ pyPaths: userOnly }, 'user query')
  assert.deepEqual([...only.scores.keys()], [ids.User])
  console.log('PASS #373 real host rank assembly queries authorized User and Workspace snapshots')
} finally { await fs.rm(root, { recursive: true, force: true }) }
