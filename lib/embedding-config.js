import { readConfigSnapshot, withConfigLockSync } from './config-lock.js'
import { writeTextAtomicPreSync } from './config-io.js'
import { JS_E5_IDENTITY_DESC_PRE_V1 } from './engine-identity.js'
import path from 'node:path'
import { createHash } from 'node:crypto'

/**
 * ★#464（2026-11-02）：配置路径的**唯一**规范化函数。
 *
 * 缺陷：JS 侧对 env 路径与 `modelDir` 各自写了一份 `.trim()`（两处独立实现），
 *   Python 侧（`python/worker_semantic_v1.py` 与 `python/m7_embedding_v1.py`）则**原样使用** ——
 *   同一份配置，JS 认为「override 生效」、Python 认为「没有配置」（探针实测：
 *   env 带首尾空白 ⇒ JS configOk=true / Python {}）。且「纯空白」两端语义不同：
 *   JS 视作「未设置」回落默认，Python 视作「设置了但打不开」。
 *
 * 本函数的契约（两端都必须按它解释，Python 侧由另一条线对齐）：
 *   ① **只剥首尾空白**，路径**内部**的空格原样保留（`C:\Program Files\x.json` 必须不受影响）；
 *   ② **纯空白 = 未设置**（`configured: false`），不是「配置了一个空路径」；
 *   ③ `changed` 记录「原文与规范化结果不同」，供上层给出可见诊断（不静默改用户输入）。
 *
 * @param {unknown} value 原始输入（env 值 / 配置文件字段）
 * @returns {{raw:string, value:string, configured:boolean, changed:boolean}}
 */
export function normalizeConfigPathPre(value) {
  const raw = value == null ? '' : String(value)
  const value_ = raw.trim()
  return { raw, value: value_, configured: value_ !== '', changed: value_ !== raw }
}

export function embeddingConfigFilePre(dshHome, env = process.env) {
  const fromEnv = normalizeConfigPathPre(env == null ? '' : env.DSH_M7_EMBEDDING_CONFIG)
  // 纯空白 ⇒ 未设置（回落默认），与 Python 侧「空白视为未配置」同语义。
  return fromEnv.configured ? fromEnv.value : path.join(dshHome, 'memory', 'semantic', 'embedding-config.json')
}

// Match worker_semantic_v1.load_embedding_config_from_env; an override is authoritative.
//
// ★#464（2026-11-02）：`modelDir` / `onnxFile` 一律走 normalizeConfigPathPre（与 env 路径**同一份**
//   规范化实现）。返回值新增三个**诊断字段**（向后兼容，既有调用点只读 file/config/configOk/
//   modelPath/identity，不受影响）：
//     - `normalized`      —— 本次是否有任何输入被规范化（true 表示用户写的值带首尾空白）；
//     - `normalizedFields`—— 具体是哪几个字段（`['modelDir']` 等），便于面板精确提示；
//     - `modelDirBlank`   —— 配置里**有** modelDir 键但规范化后为空（纯空白）。
//       这与「根本没有 modelDir 键」是两种处境：前者是用户写错了，后者是从未配置。
//   面板/自检应当把 modelDirBlank 当**可见的配置错误**报出来，而不是静默当作未配置。
export function readEffectiveEmbeddingConfigPre(dshHome, env = process.env) {
  const file = embeddingConfigFilePre(dshHome, env)
  const config = readConfigSnapshot(file) || {}
  // ★#464：env 路径与**配置文件里的路径字段**共用同一个规范化器，且都进入 normalized 账 ——
  //   否则「env 带空白被悄悄 trim 掉」这件事对调用方不可见（用户以为生效的是自己写的那串）。
  const envRaw = env == null ? '' : env.DSH_M7_EMBEDDING_CONFIG
  const envNorm = normalizeConfigPathPre(envRaw)
  const modelDirNorm = normalizeConfigPathPre(config.modelDir)
  const onnxNorm = normalizeConfigPathPre(config.onnxFile)
  const normalizedFields = []
  if (envNorm.raw !== '' && envNorm.changed) normalizedFields.push('configFile')
  if (modelDirNorm.changed) normalizedFields.push('modelDir')
  if (onnxNorm.changed) normalizedFields.push('onnxFile')
  const modelDir = modelDirNorm.value
  const onnxFile = onnxNorm.configured ? onnxNorm.value : 'onnx/model_int8.onnx'
  const configOk = config.provider === 'bge-m3-onnx-int8-pre-v1' && !!modelDir
  const modelPath = configOk ? path.resolve(modelDir, onnxFile) : ''
  const identity = createHash('sha256').update(JSON.stringify([file, config, process.cwd()])).digest('hex')
  return {
    file, config, configOk, modelPath, identity,
    normalized: normalizedFields.length > 0,
    normalizedFields,
    modelDirBlank: Object.prototype.hasOwnProperty.call(config, 'modelDir') && !modelDirNorm.configured,
  }
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

export function createDefaultEmbeddingConfigPre(dshHome, mode) {
  if (mode !== 'python') return createJsEmbeddingConfigPre(path.join(dshHome, 'models', 'js-semantic'))
  return {
    provider: 'bge-m3-onnx-int8-pre-v1',
    dimension: 1024,
    modelDir: path.join(dshHome, 'python-engine', 'models').replace(/\\/g, '/'),
    onnxFile: 'model_int8.onnx',
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
