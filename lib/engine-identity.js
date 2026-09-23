/**
 * 引擎身份（engine_identity_pre_v1）—— P2「引擎隔离」的地基（V2-P2 卡 / 评审 §3.5）。
 *
 * 为什么需要它（权威依据）：
 *   V2-P2 卡明确指出：单个 `PROVIDER_ID_INT8`（`python-setup.js:55`）**不足以**标识
 *   模型内容 / tokenizer / 预处理；两层缓存若只凭 `chunkId` 或**裸输入哈希**读取，
 *   **仍会串用两套向量**（e5 384 维与 bge-m3 1024 维混进同一次排序 = T2-9 判失败）。
 *   因此身份必须够宽，至少覆盖：
 *     模型与权重摘要 · tokenizer 版本 · 精度格式 · 维度 · 池化 · 归一化 · 输入处理版本。
 *
 * 本模块只做三件事（纯函数、零 IO、零依赖，便于宿主与测试共用）：
 *   1) `computeEngineIdentityPre(desc)` —— 宽身份描述 → 稳定身份串 `engid_pre_<32hex>`
 *      （canonical 排序 JSON + sha256，同输入逐字节同输出；任一字段变化 → 身份必变）。
 *   2) `aliasKeyPre(engineIdentity, chunkId)` —— 两级引用的**第一级**：
 *      `engineIdentity + chunkId → alias`。记录变化导致未改块重新编号（chunkId 变）时，
 *      只更新 alias，**不重新编码相同输入**（不改现有 chunkId 公式）。
 *   3) `vectorKeyPre(engineIdentity, exactEncoderInput)` —— **第二级**：
 *      `alias → hash(exactEncoderInput) → 向量对象`。相同输入且相同引擎 ⇒ 同一向量对象，
 *      可直接复用；引擎不同 ⇒ vectorKey 必不同 ⇒ 不可能跨引擎串用（T2-9 的零成本实现）。
 *
 * 成本口径（评审 §3.5 采纳的措辞，不得写「成本为零」）：
 *   **身份比较开销小；全量重建成本由本机承担。**
 *
 * UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'

export const ENGINE_IDENTITY_VERSION = 'engine_identity_pre_v1'

/** 身份串前缀：有意与 corpus 的 `idx_pre_` / L0 的 `l0idx_pre_` 区分，避免三套版本语义混淆。 */
export const ENGINE_IDENTITY_PREFIX = 'engid_pre_'

/** 身份必须覆盖的字段（缺一即身份不完整；缺失字段按空串参与哈希，不给"省略=通过"的口子）。 */
export const ENGINE_IDENTITY_FIELDS = Object.freeze([
  'provider',        // 通道/提供方标识（如 bge-m3-onnx-int8-pre-v1 / js-e5-small-q8-pre-v1）
  'model',           // 模型名（如 bge-m3 / multilingual-e5-small）
  'weightsDigest',   // 权重摘要（sha256 或廉价指纹；见 weightsDigestOfFilePre 的口径说明）
  'tokenizer',       // tokenizer 版本/来源（如 xenova-bge-m3-fast / e5-small-tokenizer-v1）
  'precision',       // 精度格式（int8 / q8 / fp32）
  'dim',             // 向量维度（384 / 1024）
  'pooling',         // 池化方式（cls / mean）
  'normalized',      // 是否已归一化（true/false）
  'inputVersion',    // 输入处理版本（前缀、截断、清洗等预处理口径）
])

const sha256Hex = (s) => createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest('hex')

/**
 * 规范化身份描述：只保留白名单字段，值统一为字符串（数字/布尔 canonical 化），
 * 键按固定顺序（ENGINE_IDENTITY_FIELDS，而非字母序）序列化 —— 顺序固定 = 哈希稳定。
 */
export function canonicalEngineDescPre(desc) {
  const d = desc && typeof desc === 'object' ? desc : {}
  const out = {}
  for (const k of ENGINE_IDENTITY_FIELDS) {
    const v = d[k]
    if (v === null || v === undefined) { out[k] = ''; continue }
    if (typeof v === 'boolean') { out[k] = v ? 'true' : 'false'; continue }
    if (typeof v === 'number') { out[k] = Number.isFinite(v) ? String(v) : ''; continue }
    out[k] = String(v)
  }
  return out
}

/**
 * 宽身份计算：canonical 描述 → `engid_pre_<first32hex(sha256)>`。
 * 任一字段（含维度、精度、tokenizer、输入版本）变化 → 身份必变；同输入确定性。
 */
export function computeEngineIdentityPre(desc) {
  const canon = canonicalEngineDescPre(desc)
  return ENGINE_IDENTITY_PREFIX + sha256Hex(JSON.stringify(canon)).slice(0, 32)
}

/** 身份合法性：必须是本模块产出的前缀形态（防把任意字符串当身份塞进缓存）。 */
export function isEngineIdentityPre(x) {
  return typeof x === 'string' && /^engid_pre_[0-9a-f]{32}$/.test(x)
}

/** 两个身份是否同一引擎。非法的身份一律视为不匹配（fail closed：宁可重建，不冒串用风险）。 */
export function engineIdentityMatchesPre(a, b) {
  if (!isEngineIdentityPre(a) || !isEngineIdentityPre(b)) return false
  return a === b
}

/**
 * 第一级引用：`engineIdentity + chunkId → aliasKey`。
 * 用途：记录内容变化 → memoryId/recordDigest 变化 → chunkId 变；此键随引擎与 chunkId 走，
 * 是"记录 → 向量"的可更新指针（记录重编号时只改这一层）。
 */
export function aliasKeyPre(engineIdentity, chunkId) {
  return String(engineIdentity || '') + '|' + String(chunkId == null ? '' : chunkId)
}

/**
 * 第二级引用：`engineIdentity + exactEncoderInput → vectorKey`。
 * exactEncoderInput = **真正送进编码器的文本**（含引擎内部前缀之后的形态；调用方负责给出
 * 与编码器输入一致的字符串）。相同引擎 + 相同输入 ⇒ 相同 vectorKey ⇒ 复用向量对象。
 * 该键不含 chunkId，因此**块重新编号不会导致重复编码**（T2-2 的核心）。
 */
export function vectorKeyPre(engineIdentity, exactEncoderInput) {
  return String(engineIdentity || '') + '|' + sha256Hex(exactEncoderInput)
}

/**
 * 权重摘要的**廉价指纹**（性能口径，必须如实标注）：
 * 对 2GB 级 onnx 做全量 sha256 代价过高，这里用 `size:mtimeMs:文件名` 的 sha256 作为
 * **权重变更指纹**（同一份权重稳定、文件被替换/重下必变）。
 * 说明：这是**指纹（fingerprint）而非内容摘要（digest）**；要真摘要需在切换时一次性计算
 * 并落盘缓存（P4 若需要再补），本阶段不引入 2GB 级读盘开销。
 */
export function weightsDigestOfFilePre(stat, name) {
  const size = Number(stat && stat.size) || 0
  const mtime = Number(stat && (stat.mtimeMs != null ? stat.mtimeMs : stat.mtime)) || 0
  return 'fp_' + sha256Hex(size + ':' + mtime + ':' + String(name == null ? '' : name)).slice(0, 32)
}

/** 端侧 JS 引擎（e5-small q8，384 维已归一化）的规范身份描述。 */
export const JS_E5_IDENTITY_DESC_PRE_V1 = Object.freeze({
  provider: 'js-e5-small-q8-pre-v1',
  model: 'multilingual-e5-small',
  weightsDigest: 'manifest-e5-small-q8-pre-v1', // 端侧资产清单版本；模型文件摘要由下载清单锁定
  tokenizer: 'e5-small-tokenizer-v1',
  precision: 'q8',
  dim: 384,
  pooling: 'mean',
  normalized: true,
  inputVersion: 'e5-passage-prefix-v1', // 引擎内部加 `passage: ` 前缀（见 semantic-js.js:351 注释）
})

/** Python 引擎（bge-m3 onnx int8，1024 维）的身份描述构造器（weightsDigest 由调用方给指纹）。 */
export function pyBgeM3IdentityDescPre(weightsDigest) {
  return {
    provider: 'bge-m3-onnx-int8-pre-v1',
    model: 'bge-m3',
    weightsDigest: weightsDigest || '',
    tokenizer: 'xenova-bge-m3-fast',
    precision: 'int8',
    dim: 1024,
    pooling: 'cls',
    normalized: true,
    inputVersion: 'bge-m3-raw-v1',
  }
}

/** 供诊断/测试的最小投影（不泄内容：只有身份串与字段读数）。 */
export function describeEngineIdentityPre(desc) {
  const canon = canonicalEngineDescPre(desc)
  return { identity: computeEngineIdentityPre(desc), fields: canon, version: ENGINE_IDENTITY_VERSION }
}
