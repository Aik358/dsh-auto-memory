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
//
// ★2026-10-14 吸收 PR#420 时补的一个真实缺陷（不是他的逻辑错，是他的调用点会误读结果）：
//   `createOnly` 命中已存在文件时**什么都不写**，却把返回值做成与「真写过」同形 ——
//   调用点 `engine._jsConfigurationError = ''` 于是凭空清掉一条**真实的配置错误**：
//   启动自检约 16s 后跑一次 createOnly，用户看到面板「正常」，而配置其实没修好（#421 同族症状：
//   「设置看起来没生效」）。修法是让「未写」可区分：返回 saved 标记，调用点据此决定是否清空。
//   判据：createOnly 命中已存在文件 ⇒ 返回 { ...previous, __unchanged: true }，且调用点绝不因此清错误。
export function updateEmbeddingConfigPre(file, update, { defaults = () => ({}), createOnly = false } = {}) {
  return withConfigLockSync(file, () => {
    let previous
    try { previous = readConfigSnapshot(file) } catch (e) {
      e.configStage = 'read'; e.configKind = e instanceof SyntaxError ? 'CORRUPT' : 'READ-FAILED'; throw e
    }
    if (previous && createOnly) return Object.assign({}, previous, { __unchangedByCreateOnly: true })
    const cfg = update(previous || defaults())
    const saved = writeTextAtomicPreSync(file, JSON.stringify(cfg, null, 2))
    if (!saved.ok) throw Object.assign(new Error('embedding configuration save failed: ' + saved.error), { configStage: 'write' })
    return cfg
  })
}
