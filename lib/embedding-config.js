import { readConfigSnapshot, withConfigLockSync } from './config-lock.js'
import { writeTextAtomicPreSync } from './config-io.js'
import { JS_E5_IDENTITY_DESC_PRE_V1 } from './engine-identity.js'

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
    const previous = readConfigSnapshot(file)
    if (previous && createOnly) return previous
    const cfg = update(previous || defaults())
    const saved = writeTextAtomicPreSync(file, JSON.stringify(cfg, null, 2))
    if (!saved.ok) throw new Error('embedding configuration save failed: ' + saved.error)
    return cfg
  })
}
