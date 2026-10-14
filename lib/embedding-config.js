import { readConfigSnapshot, withConfigLockSync } from './config-lock.js'
import { writeTextAtomicPreSync } from './config-io.js'
import { JS_E5_IDENTITY_DESC_PRE_V1 } from './engine-identity.js'
import path from 'node:path'
import { createHash } from 'node:crypto'

export function embeddingConfigFilePre(dshHome, env = process.env) {
  return String(env.DSH_M7_EMBEDDING_CONFIG || '').trim() || path.join(dshHome, 'memory', 'semantic', 'embedding-config.json')
}

// Match worker_semantic_v1.load_embedding_config_from_env; an override is authoritative.
export function readEffectiveEmbeddingConfigPre(dshHome, env = process.env) {
  const file = embeddingConfigFilePre(dshHome, env)
  const config = readConfigSnapshot(file) || {}
  const modelDir = String(config.modelDir || '').trim()
  const configOk = config.provider === 'bge-m3-onnx-int8-pre-v1' && !!modelDir
  const modelPath = configOk ? path.resolve(modelDir, String(config.onnxFile || 'onnx/model_int8.onnx')) : ''
  const identity = createHash('sha256').update(JSON.stringify([file, config, process.cwd()])).digest('hex')
  return { file, config, configOk, modelPath, identity }
}

export function createJsEmbeddingConfigPre(modelsRoot) {
  return {
    provider: JS_E5_IDENTITY_DESC_PRE_V1.provider,
    dimension: JS_E5_IDENTITY_DESC_PRE_V1.dim,
    modelDir: String(modelsRoot).replace(/\\/g, '/'),
    onnxFile: 'multilingual-e5-small/onnx/model_quantized.onnx',
    activationEmitMode: 'shadow',
    activationPolicy: { mode: 'shadow' },
  }
}

// All writers reread under the same lock; only ENOENT permits creation.
export function updateEmbeddingConfigPre(file, update, { defaults = () => ({}), createOnly = false } = {}) {
  return withConfigLockSync(file, () => {
    let previous
    try { previous = readConfigSnapshot(file) } catch (e) {
      e.configStage = 'read'; e.configKind = e instanceof SyntaxError ? 'CORRUPT' : 'READ-FAILED'; throw e
    }
    if (previous && createOnly) return previous
    const cfg = update(previous || defaults())
    const saved = writeTextAtomicPreSync(file, JSON.stringify(cfg, null, 2))
    if (!saved.ok) throw Object.assign(new Error('embedding configuration save failed: ' + saved.error), { configStage: 'write' })
    return cfg
  })
}
