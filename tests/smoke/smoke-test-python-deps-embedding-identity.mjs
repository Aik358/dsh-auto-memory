import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import cp from 'node:child_process'
import { promisify } from 'node:util'
import { syncBuiltinESMExports } from 'node:module'
import vm from 'node:vm'
import { readEffectiveEmbeddingConfigPre } from '../../lib/embedding-config.js'

const dir = fs.mkdtempSync(path.join(tmpdir(), 'dam-python-deps-identity-'))
const originalExec = cp.execFile
const originalOverride = process.env.DSH_M7_EMBEDDING_CONFIG
delete process.env.DSH_M7_EMBEDDING_CONFIG
const fakeExec = () => {}
fakeExec[promisify.custom] = async () => ({ stdout: '3.11', stderr: '' })
cp.execFile = fakeExec
syncBuiltinESMExports()
const { createPythonSetupPre } = await import('../../lib/python-setup.js')
const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const start = source.indexOf('  engine.probePythonRuntime = async (optsRt = {}) => {')
const end = source.indexOf('  /** 只读缓存版', start)
assert.ok(start >= 0 && end > start)

function fixture(name, config, models = true) {
  const home = path.join(dir, name)
  const file = path.join(home, 'memory', 'semantic', 'embedding-config.json')
  const modelDir = path.join(home, 'python-engine', 'models')
  const python = path.join(home, 'python-engine', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  fs.mkdirSync(path.dirname(python), { recursive: true })
  fs.writeFileSync(python, 'fixture interpreter')
  if (config !== undefined) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config))
  }
  if (models) {
    fs.mkdirSync(modelDir, { recursive: true })
    const model = path.join(modelDir, 'model_int8.onnx')
    fs.writeFileSync(model, '')
    fs.truncateSync(model, 568456694)
    for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'sentencepiece.bpe.model']) {
      fs.writeFileSync(path.join(modelDir, name), name.endsWith('.json') ? '{}' : 'xx')
    }
  }
  const engine = { config: {}, _pyRtGeneration: 0,
    _probeWorkerHealthOnce: async () => ({ tried: true, healthSeen: true, ready: true }) }
  vm.runInNewContext(source.slice(start, end), { engine, Date, Map, JSON, String, Number, path,
    readEffectiveEmbeddingConfigPre, existsSync: fs.existsSync, pluginRootDir: () => '/fixture/plugin',
    resolveDshHomePre: () => home, buildPythonCandidatesPre: () => [],
    resolvePythonInterpreterPre: async () => ({ chosen: python, probed: [] }) })
  return { home, file, modelDir, engine, setup: createPythonSetupPre({ dshHome: home }) }
}

try {
  const preferences = { activationEmitMode: 'shadow', activationPolicy: { mode: 'shadow', keep: true }, gpu: false, unknown: { keep: 1 } }
  for (const [name, initial] of [['preferences-only', preferences], ['missing-config', undefined]]) {
    const f = fixture(name, initial)
    assert.equal((await f.setup.detect()).modelReady, true)
    const installed = await f.setup.ensureDeps({ gpu: false })
    const runtime = await f.engine.probePythonRuntime({ withWorker: true, refresh: true })
    assert.notEqual(runtime.error, 'embedding 配置缺少有效 provider/modelDir', 'dependency installation must not leave a preferences-only embedding configuration')
    assert.equal(installed.configOk, true)
    assert.equal(runtime.state, 'verified-ok')
    assert.equal(runtime.modelPath, path.join(f.modelDir, 'model_int8.onnx'))
    const saved = JSON.parse(fs.readFileSync(f.file))
    assert.equal(saved.dimension, 1024)
    for (const [key, value] of Object.entries(initial || {})) assert.deepEqual(saved[key], value)
  }
  const missing = fixture('no-model', preferences, false)
  await missing.setup.detect()
  assert.equal((await missing.setup.ensureDeps({ gpu: true })).configOk, false)
  assert.equal((await missing.engine.probePythonRuntime({ refresh: true })).state, 'no-files', 'identity initialization must not certify missing assets')

  for (const initial of [
    { provider: 'custom-provider', modelDir: '/custom', onnxFile: 'custom.onnx', dimension: 12 },
    { modelDir: '/explicit-but-incomplete' },
    { provider: '' },
  ]) {
    const f = fixture('explicit-' + Object.keys(initial).join('-'), initial)
    await f.setup.detect()
    await f.setup.ensureDeps({ gpu: true })
    assert.deepEqual(JSON.parse(fs.readFileSync(f.file)), { ...initial, gpu: true }, 'explicit engine identity must not be replaced by dependency installation')
  }
  const corrupt = fixture('corrupt', '{broken')
  await corrupt.setup.detect()
  assert.equal((await corrupt.setup.ensureDeps({ gpu: false })).phase, 'error')
  assert.equal(fs.readFileSync(corrupt.file, 'utf8'), '{broken')
  console.log('PASS Python dependency setup initializes missing identity, preserves explicit configuration and does not certify missing models')
} finally {
  cp.execFile = originalExec
  syncBuiltinESMExports()
  if (originalOverride === undefined) delete process.env.DSH_M7_EMBEDDING_CONFIG
  else process.env.DSH_M7_EMBEDDING_CONFIG = originalOverride
  fs.rmSync(dir, { recursive: true, force: true })
}
