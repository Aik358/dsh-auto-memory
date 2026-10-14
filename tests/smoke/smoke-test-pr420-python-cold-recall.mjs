import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { startRecallHost, writeRecallFixture } from '../lib/pr420-host.mjs'

const root = await fs.mkdtemp(path.join(tmpdir(), 'dam-420-python-'))
const previousPath = process.env.PATH
let host
try {
  let python
  for (const command of ['python3', 'python', 'py']) {
    const result = spawnSync(command, ['-c', 'import sys;print(sys.executable)'], { encoding: 'utf8' })
    if (result.status === 0) { python = result.stdout.trim(); break }
  }
  assert.ok(python, 'a standard-library Python is required for this production wiring fixture')
  const venv = path.join(root, 'python-engine', '.venv')
  const created = spawnSync(python, ['-m', 'venv', '--without-pip', venv], { encoding: 'utf8' })
  assert.equal(created.status, 0, created.stderr)
  const managed = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  const site = spawnSync(managed, ['-c', 'import sysconfig;print(sysconfig.get_path("purelib"))'], { encoding: 'utf8' })
  assert.equal(site.status, 0)
  // Empty import fixtures satisfy the real resolver; they do not pretend to run a model.
  for (const module of ['transformers', 'onnxruntime', 'numpy']) await fs.writeFile(path.join(site.stdout.trim(), module + '.py'), '# protocol fixture only\n')
  const modelDir = path.join(root, 'fixture-model')
  await fs.mkdir(modelDir); await fs.writeFile(path.join(modelDir, 'model.onnx'), 'not an inference model')
  await fs.mkdir(path.join(root, 'memory', 'semantic'), { recursive: true })
  const embeddingConfig = path.join(root, 'memory', 'semantic', 'embedding-config.json')
  await fs.writeFile(embeddingConfig, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir, onnxFile: 'model.onnx' }))
  host = await startRecallHost(root, { semanticEngineMode: 'auto',
    pythonBackendWorkerPath: fileURLToPath(new URL('../fixtures/pr420-recall-worker.py', import.meta.url)) })
  const { engine, agent, paths } = host
  const ids = await writeRecallFixture(host)
  const snapshot = { records: Object.values(ids).map(memoryId => ({ memoryId, text: 'Fixture heading' })),
    pyPaths: { ws: paths.ws, userFile: paths.userFile, notesPath: paths.notesPath, logPath: paths.logPath } }
  process.env.PATH = path.join(root, 'empty-path')
  const events = async () => (await fs.readFile(path.join(root, 'pr420-worker-events.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  for (const mode of ['auto', 'python']) {
    engine.config.semanticEngineMode = mode
    engine.invalidatePythonRuntime('fixture-cold-start')
    assert.equal(engine.pythonRuntimeCached(), null)
    assert.equal(engine._pythonSidecar.currentEpoch(), null)
    const response = await host.request('recall', { query: 'nonlexical-fixture-query', sessionId: agent.session.id, scope: 'current' })
    assert.equal(response.status, 200)
    assert.match(response.data.result, new RegExp(ids.Workspace), mode + ' first HTTP request must reach the managed worker')
    assert.equal(engine._rankPath, 'c3(python)')
    assert.ok(response.data.hits.some(hit => hit.memoryId === ids.User && hit.sourcePath === paths.userFile))
    const ranked = await engine._pySemanticRank(snapshot, 'nonlexical-fixture-query')
    assert.equal(ranked?.source, 'c3', mode + ' cold recall must resolve the only usable managed interpreter before sync')
    assert.deepEqual([...ranked.scores.keys()].sort(), Object.values(ids).sort(), 'foreign worker IDs never escape the authorized corpus')
    assert.equal(engine.resolvedPythonCommand(), managed)
    const log = await events()
    assert.ok(log.some(entry => entry.type === 'index_sync_commit'))
    assert.ok(log.filter(entry => entry.type === 'recall_rank').every(entry => path.resolve(entry.executable) === path.resolve(managed)))
    assert.equal(log.filter(entry => entry.type === 'health').length, 0, 'cold recall does not depend on a settings health probe')
    engine._pyRtCacheAt = Date.now() - 60001
    assert.equal((await engine._pySemanticRank(snapshot, 'expired-cache'))?.source, 'c3', 'expired cache is resolved before reuse')
  }
  // A changed effective configuration invalidates the old command and worker generation.
  engine.config.pythonBackendExecutable = path.join(root, 'missing-configured-python')
  assert.equal(engine.pythonRuntimeCached(), null)
  assert.equal((await engine._pySemanticRank(snapshot, 'changed-config'))?.source, 'c3')
  assert.equal(engine.resolvedPythonCommand(), managed, 'an invalid explicit interpreter falls through to the managed venv')
  engine.config.semanticEngineMode = 'auto'
  const outside = { records: [], pyPaths: snapshot.pyPaths }
  assert.equal(await engine._pySemanticRank(outside, 'no-authorized-records'), null)

  const originalProbe = engine.probePythonRuntime
  engine.invalidatePythonRuntime('fixture-delayed-resolution')
  let finish
  engine.probePythonRuntime = () => new Promise(resolve => { finish = resolve })
  const pending = engine.preparePythonRecallPre(1000)
  engine.invalidatePythonRuntime('fixture-config-change')
  finish({ chosen: managed, modelPresent: true, depsOk: true, usable: true })
  assert.equal(await pending, false, 'a late result from an older generation cannot start a worker')
  assert.equal(engine._pythonSidecar.currentEpoch(), null)
  const timedOut = engine.preparePythonRecallPre(20)
  assert.equal(await timedOut, false, 'interpreter resolution has a bounded wait and fails soft')
  assert.equal(engine._pythonSidecar.currentEpoch(), null)
  finish({ chosen: managed, modelPresent: true, depsOk: true, usable: true })
  engine.probePythonRuntime = originalProbe
  console.log('PASS PR420 production managed-venv cold recall in auto/python, HTTP sync/rank, stale identity and bounded resolution')
} finally {
  if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath
  if (host) await host.close()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
