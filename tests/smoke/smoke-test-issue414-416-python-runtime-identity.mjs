import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { readEffectiveEmbeddingConfigPre } from '../../lib/embedding-config.js'

const home = fs.mkdtempSync(path.join(tmpdir(), 'dam-python-identity-'))
try {
  const cfg = path.join(home, 'memory', 'semantic', 'embedding-config.json'), modelDir = path.join(home, '自定义 model directory')
  fs.mkdirSync(path.dirname(cfg), { recursive: true }); fs.mkdirSync(modelDir)
  fs.writeFileSync(path.join(modelDir, 'custom.onnx'), 'fixture-model')
  fs.writeFileSync(cfg, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir, onnxFile: 'custom.onnx', dimension: 1024 }))
  const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const start = source.indexOf('  engine.probePythonRuntime = async (optsRt = {}) => {')
  const end = source.indexOf('  /** 只读缓存版', start)
  let healthCalls = 0
  const engine = { config: { pythonBackendExecutable: 'fixture-python' }, _pyRtCacheAt: 0, _pyRtGeneration: 0, _pyHealthProbes: new Set(),
    _probeWorkerHealthOnce: async () => { healthCalls++; return { tried: true, healthSeen: true, ready: true } } }
  const env = { engine, Date, Map, JSON, String, Number, readEffectiveEmbeddingConfigPre,
    existsSync: fs.existsSync, pluginRootDir: () => '/fixture/plugin', resolveDshHomePre: () => home,
    path, buildPythonCandidatesPre: () => [], resolvePythonInterpreterPre: async () => ({ chosen: 'fixture-python', probed: [], chosenIsDev: false }) }
  vm.createContext(env); vm.runInContext(source.slice(start, end), env)
  let restarts = 0
  engine._pythonSidecar = { restart: () => { restarts++ } }
  const invalidateStart = source.indexOf('  engine.invalidatePythonRuntime = (reason) => {')
  vm.runInContext(source.slice(invalidateStart, source.indexOf('  /**', invalidateStart)), env)
  const full = await engine.probePythonRuntime({ withWorker: true, refresh: true })
  assert.equal(full.modelPath, path.join(modelDir, 'custom.onnx')); assert.equal(full.state, 'verified-ok')
  assert.equal(healthCalls, 1)
  await engine.probePythonRuntime({ withWorker: true, refresh: true })
  assert.equal(healthCalls, 2, 'forced full detection ignores the earlier worker verdict')
  const otherDir = path.join(home, 'other'); fs.mkdirSync(otherDir); fs.writeFileSync(path.join(otherDir, 'next.onnx'), 'fixture-next')
  fs.writeFileSync(cfg, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir: otherDir, onnxFile: 'next.onnx', dimension: 1024 }))
  const changed = await engine.probePythonRuntime({ withWorker: true })
  assert.equal(changed.modelPath, path.join(otherDir, 'next.onnx')); assert.equal(healthCalls, 3)
  assert.equal(restarts, 1, 'changing effective configuration stops the old lazy worker')
  let finishHealth
  engine._probeWorkerHealthOnce = () => new Promise(resolve => { finishHealth = resolve })
  const pending = engine.probePythonRuntime({ withWorker: true, refresh: true })
  while (!finishHealth) await new Promise(resolve => setTimeout(resolve, 0))
  engine.invalidatePythonRuntime('uninstall')
  finishHealth({ tried: true, healthSeen: true, ready: true })
  const stale = await pending
  assert.equal(stale.ok, false); assert.equal(engine._pyRtCache, null); assert.equal(engine._pyWorkerVerdict, null)
  assert.equal(restarts, 2)
  engine._probeWorkerHealthOnce = async () => { healthCalls++; return { tried: true, healthSeen: true, ready: true } }
  let finishWeak
  env.resolvePythonInterpreterPre = () => new Promise(resolve => { finishWeak = resolve })
  const weak = engine.probePythonRuntime()
  env.resolvePythonInterpreterPre = async () => ({ chosen: 'fixture-python', probed: [] })
  const strong = await engine.probePythonRuntime({ withWorker: true, refresh: true })
  assert.equal(strong.state, 'verified-ok', 'full detection does not join a weaker in-flight probe')
  finishWeak({ chosen: 'fixture-python', probed: [] }); await weak
  assert.equal(engine._pyRtCache.state, 'verified-ok')
  const cachedStart = source.indexOf('  engine.pythonRuntimeCached = () => {')
  vm.runInContext(source.slice(cachedStart, source.indexOf('  /**', cachedStart)), env)
  assert.equal(engine.pythonRuntimeCached().state, 'verified-ok')
  engine._pyRtCacheAt = Date.now() - 60001
  assert.equal(engine.pythonRuntimeCached(), null, 'expired runtime cache cannot certify current readiness')
  engine._pyRtCacheAt = Date.now(); engine._pyWorkerVerdict.at = Date.now() - 600001
  assert.equal(engine.pythonRuntimeCached(), null, 'an expired worker verdict cannot certify readiness')
  const override = path.join(home, 'override.json')
  fs.writeFileSync(override, JSON.stringify({ provider: 'bge-m3-onnx-int8-pre-v1', modelDir, onnxFile: 'custom.onnx' }))
  assert.equal(readEffectiveEmbeddingConfigPre(home, { DSH_M7_EMBEDDING_CONFIG: override }).modelPath, path.join(modelDir, 'custom.onnx'))
  fs.writeFileSync(override, '{}')
  assert.equal(readEffectiveEmbeddingConfigPre(home, { DSH_M7_EMBEDDING_CONFIG: override }).configOk, false, 'an invalid override never falls back to the managed configuration')
  fs.writeFileSync(cfg, '{corrupt')
  const corrupt = await engine.probePythonRuntime({ withWorker: true, refresh: true })
  assert.equal(corrupt.ok, false); assert.notEqual(corrupt.state, 'verified-ok')
  assert.equal(corrupt.state, 'config-failed', 'configuration corruption is distinct from missing model files')
  assert.equal(fs.readFileSync(cfg, 'utf8'), '{corrupt')
  console.log('PASS #414/#415/#416 forced runtime probes, worker invalidation and configured model identity stay aligned')
} finally { fs.rmSync(home, { recursive: true, force: true }) }
