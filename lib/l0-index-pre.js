/**
 * L0 向量索引（l0_index_pre_v1）—— 为 T1 产出的 L0 建立向量索引,供语义检索使用。
 *
 * 2026-09-09 建立(P1)。参照 OpenViking「Vector Index 只存 URI+向量+元数据,不含文件内容」:
 * 每条目仅 {id, vector, l0, source, l0Hash, updatedAt},**绝不存记忆原文**。
 *
 * 组成(工厂 createL0IndexPre,IO 与 embedding 全注入,模块层零 fs/零模型):
 *   1) buildFull  —— 全量建索引:buildL0IndexPre(text) × embedPassages(l0s),一次性写盘
 *   2) update     —— 增量:逐条比 l0Hash,新增/重算/跳过/移除,仅重算变化条
 *   3) remove     —— 显式按 ids 移除失效条目
 *   4) load       —— fail-soft 读取:文件缺失/schema 不符/条目非法 → {ok:false, entries:[]},绝不抛
 *   5) status     —— 索引概况(count/version/updatedAt)
 *
 * 身份与版本约定(沿用仓库惯例):
 *   - l0Hash = sha256(l0),增量重算的唯一判据(l0 不变 → 跳过该条)
 *   - l0IndexVersion = 'l0idx_pre_' + first32hex(sha256(canonical sorted [id,l0Hash] tuples))
 *     (前缀 l0idx_pre_ 有意区别于 corpus 的 idx_pre_ memoryIndexVersion,避免两套版本语义混淆)
 *   - 向量维度由 embedder 决定(真实 C2 引擎为 384 维已归一化),本模块不硬编码维度
 *   - 向量以纯 number 数组存盘(JSON 安全);embedder 返回 Float32Array 时经 Array.from 转换
 *
 * 边界:纯函数 + IO 注入、零 npm 依赖;所有 API 在边界处 fail-soft 返回 {ok:false,error},
 * 不向调用方抛异常(不阻塞任何调用方);非法输入返回空结果。UTF-8 无 BOM。
 */
import { createHash } from 'node:crypto'
import { buildL0IndexPre, L0_LAYERS, L0_STATUSES, L0_DEFAULT_LAYER } from './l0-extract-pre.js'
import { isEngineIdentityPre } from './engine-identity-pre.js'

export const L0_INDEX_VERSION = 'l0_index_pre_v1'
export const L0_INDEX_SCHEMA_VERSION = 1

/**
 * 2026-09-14（三层契约 C3）：**索引条目显式落 `layer` + `status` 两列**。
 * 此前 assemble() 只写 {id,vector,l0,source,l0Hash,updatedAt} → 层与状态在索引里丢失，
 * 检索侧只能看到原文块而无法按层/状态过滤（契约 I4「每条带 layer+status」在 L0 索引这一环断了）。
 * 兼容口径：两列按「缺失即默认」处理（layer→log / status→current），**不因缺列拒绝整文件**，
 * 这样既有索引文件（无这两列）仍可加载，不触发无谓的全量重建。
 */
export const L0_INDEX_DEFAULT_STATUS = 'current'
const normLayerPre = (x) => (typeof x === 'string' && L0_LAYERS.includes(x) ? x : L0_DEFAULT_LAYER)
const normStatusPre = (x) => (typeof x === 'string' && L0_STATUSES.includes(x) ? x : L0_INDEX_DEFAULT_STATUS)

const sha256Hex = (s) => createHash('sha256').update(String(s == null ? '' : s), 'utf8').digest('hex')
const HEX64_RE = /^[0-9a-f]{64}$/

/** 规范化向量:Float32Array/number[] → 纯 number 数组;非法输入返回 null。 */
function normalizeVector(vec) {
  if (!(vec && (Array.isArray(vec) || vec instanceof Float32Array))) return null
  const out = []
  for (let i = 0; i < vec.length; i++) {
    const n = Number(vec[i])
    if (!Number.isFinite(n)) return null
    out.push(n)
  }
  return out.length ? out : null
}

/**
 * l0IndexVersion:canonical sorted [id,l0Hash,**layer,status**] tuples → 'l0idx_pre_' + first32hex(sha256)。
 * 同内容同版本(确定性);任一条目 l0 变化、层归属或状态变化、条目增删 → 版本变化。
 * (C3：层/状态进身份,否则「同一条记忆换层」不会触发版本变化 → 下游缓存会拿到过期归属。)
 */
export function computeL0IndexVersionPre(entries) {
  const canon = (Array.isArray(entries) ? entries : [])
    .map((e) => [
      String(e && e.id) || '',
      String(e && e.l0Hash) || '',
      normLayerPre(e && e.layer),
      normStatusPre(e && e.status),
    ])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return 'l0idx_pre_' + sha256Hex(JSON.stringify(canon)).slice(0, 32)
}

/**
 * 工厂:创建 L0 索引操作器。
 * @param {object} opts
 * @param {{readJson(path:any):any, writeJson(path:any, obj:any):void, exists?(path:any):boolean}} opts.io
 *   磁盘 IO 全注入;readJson 对缺失文件应返回 null 或抛错(两种都被模块层容错)。
 * @param {{embedPassages(texts:string[]):Promise<Float32Array[]|number[][]>}} opts.embedder
 *   embedding 注入(真实 C2 引擎或测试假 embedder);前缀由引擎内部负责,调用方传裸文本。
 * @param {()=>number} [opts.now] 时间注入(默认 Date.now;测试确定性用)。
 */
export function createL0IndexPre(opts = {}) {
  const io = opts.io
  const embedder = opts.embedder
  const nowMs = () => (typeof opts.now === 'function' ? Number(opts.now()) || 0 : Date.now())
  // ★P2 引擎隔离（T2-9）：工厂级身份 = 当前写入/读取该索引所用的嵌入引擎身份。
  // 未提供合法身份时不启用身份门（保持旧行为，便于渐进接线与测试）。
  const engineIdentity = isEngineIdentityPre(opts.engineIdentity) ? String(opts.engineIdentity) : null
  const identityGate = engineIdentity != null && opts.engineIdentityGate !== false
  // 2B 跨 id 复用开关：false ⇒ 只按「同 id 同 hash」复用（严格旧行为，回滚用）。
  const crossIdReuse = opts.crossIdReuse !== false
  if (!io || typeof io.readJson !== 'function' || typeof io.writeJson !== 'function') {
    // fail closed:工厂级配置错误直接抛(调用方组装错误,不属于运行期 fail-soft 范畴)
    throw new Error('l0-index-pre: io.readJson/io.writeJson required')
  }

  /** fail-soft 读取+整文件校验。任何异常/不符 → {ok:false, reason, entries:[]}。 */
  function load({ path } = {}) {
    try {
      const obj = io.readJson(path)
      if (!obj || typeof obj !== 'object') return { ok: false, reason: 'missing', entries: [] }
      if (obj.schemaVersion !== L0_INDEX_SCHEMA_VERSION) return { ok: false, reason: 'schema', entries: [] }
      if (typeof obj.l0IndexVersion !== 'string' || !obj.l0IndexVersion.startsWith('l0idx_pre_')) {
        return { ok: false, reason: 'version', entries: [] }
      }
      // ★P2 T2-9 引擎身份门：文件声明的引擎身份与当前引擎不一致 ⇒ 整文件判不可用，
      // 调用方（update）随即走全量重建路径 —— 两套向量绝不可能参与同一次排序。
      // 兼容口径：旧文件（无该字段）按当前引擎接受；身份门关闭时本检查整体跳过。
      if (identityGate) {
        const fileIdentity = obj.engineIdentity
        if (isEngineIdentityPre(fileIdentity) && fileIdentity !== engineIdentity) {
          return { ok: false, reason: 'engine-mismatch', entries: [], fileEngineIdentity: fileIdentity }
        }
      }
      if (!Array.isArray(obj.entries)) return { ok: false, reason: 'entries', entries: [] }
      const out = []
      for (const e of obj.entries) {
        if (!e || typeof e !== 'object') return { ok: false, reason: 'entry', entries: [] }
        if (typeof e.id !== 'string' || !e.id) return { ok: false, reason: 'entry.id', entries: [] }
        if (typeof e.l0 !== 'string') return { ok: false, reason: 'entry.l0', entries: [] }
        if (typeof e.l0Hash !== 'string' || !HEX64_RE.test(e.l0Hash)) return { ok: false, reason: 'entry.l0Hash', entries: [] }
        if (typeof e.source !== 'string') return { ok: false, reason: 'entry.source', entries: [] }
        if (!Number.isFinite(Number(e.updatedAt))) return { ok: false, reason: 'entry.updatedAt', entries: [] }
        const vec = normalizeVector(e.vector)
        if (!vec) return { ok: false, reason: 'entry.vector', entries: [] }
        out.push({
          id: e.id, vector: vec, l0: e.l0, source: e.source, l0Hash: e.l0Hash, updatedAt: Number(e.updatedAt),
          // C3：两列按「缺失即默认」归一化——既有索引文件（无这两列）照常加载，不触发全量重建；
          // 非法值也不放行，绝不把脏层名/状态带进检索侧。
          layer: normLayerPre(e.layer), status: normStatusPre(e.status),
        })
      }
      return { ok: true, entries: out, l0IndexVersion: obj.l0IndexVersion, updatedAt: Number(obj.updatedAt) || 0 }
    } catch (e) {
      return { ok: false, reason: 'read-error', error: String(e && e.message ? e.message : e), entries: [] }
    }
  }

  /**
   * 由 buildL0IndexPre 的条目 + 批量 embedding 组装索引文件对象(不写盘)。
   *
   * ★P2 真增量（T2-1/T2-2）：**只把"找不到可复用向量"的条目送进 embedder**。
   *   复用查找顺序（两层引用）：
   *     ① 同 id 且 l0Hash 相同 —— 原行为（内容未变的同一条目）；
   *     ② **不同 id 但 l0Hash 相同** —— 2B 跨 id 复用：记录变了导致未改块重新编号时，
   *        alias 指向新 id，但 vectorKey（= 引擎身份 + hash(exactEncoderInput)）不变，
   *        因此**不重新编码相同输入**（T2-2：固定三块只改末块 → 实际只编码 1 个输入）。
   *   返回 `{fileObj, embedded, reusedById, reusedByHash}`，其中 `embedded` = 真实 embedder
   *   输入数（T2-1 直接消费；**不是**"按返回计数推断"，而是实际送进去的条数）。
   */
  async function assemble(items, prevById) {
    const prevList = prevById ? [...prevById.values()] : []
    // 索引：hash → 向量（跨 id 复用的第二级；同 hash 多条时取任意一条的向量即可 —— 输入相同则向量相同）
    const vecByHash = new Map()
    if (crossIdReuse && prevList.length) {
      for (const e of prevList) if (e && e.l0Hash && Array.isArray(e.vector)) vecByHash.set(e.l0Hash, e.vector)
    }
    const resolveReuse = (it, hash) => {
      const prev = prevById ? prevById.get(it.id) : null
      if (prev && prev.l0Hash === hash && Array.isArray(prev.vector)) return { vector: prev.vector, via: 'id' }
      if (crossIdReuse) {
        const v = vecByHash.get(hash)
        if (v) return { vector: v, via: 'hash' }
      }
      return null
    }
    // ① 先分类：可复用者直接拿向量，其余进待嵌入集合（同一 hash 只嵌入一次 —— 批内去重）
    const needEmbed = []
    const seenHash = new Set()
    const plan = [] // {it, hash, reuse}
    for (const it of items) {
      const hash = sha256Hex(it.l0)
      const reuse = resolveReuse(it, hash)
      plan.push({ it, hash, reuse })
      if (!reuse && !seenHash.has(hash)) { seenHash.add(hash); needEmbed.push({ hash, text: it.l0 }) }
    }
    // ② 只嵌入真需要的（空数组时不调用 embedder —— 不变更新的真实输入数 = 0）
    let vecsByEmbeddedHash = new Map()
    if (needEmbed.length) {
      const vecs = await embedder.embedPassages(needEmbed.map((x) => x.text))
      if (!Array.isArray(vecs) || vecs.length !== needEmbed.length) {
        throw new Error('l0-index-pre: embedder returned ' + (Array.isArray(vecs) ? vecs.length : 'non-array') + ' vectors for ' + needEmbed.length + ' passages')
      }
      needEmbed.forEach((x, i) => {
        const v = normalizeVector(vecs[i])
        if (!v) throw new Error('l0-index-pre: embedder produced invalid vector at index ' + i)
        vecsByEmbeddedHash.set(x.hash, v)
      })
    }
    const ts = nowMs()
    let reusedById = 0
    let reusedByHash = 0
    const entries = plan.map(({ it, hash, reuse }) => {
      let vector
      if (reuse) {
        vector = reuse.vector
        if (reuse.via === 'id') reusedById++
        else reusedByHash++
      } else {
        vector = vecsByEmbeddedHash.get(hash)
        if (!vector) throw new Error('l0-index-pre: missing vector for ' + it.id)
      }
      const prev = prevById ? prevById.get(it.id) : null
      // updatedAt 语义：整条（同 id 同 hash）复用时保留原时间；跨 id 复用属"新条目指向旧向量"，按新条记时。
      const sameEntryReused = !!(prev && prev.l0Hash === hash)
      return {
        id: it.id,
        vector,
        l0: it.l0,
        source: it.source,
        l0Hash: hash,
        updatedAt: sameEntryReused ? prev.updatedAt : ts,
        // C3：层与状态显式落盘（取自 buildL0IndexPre 的条目，缺失/非法即归一化）。
        layer: normLayerPre(it.layer),
        status: normStatusPre(it.status),
      }
    })
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return {
      fileObj: {
        schemaVersion: L0_INDEX_SCHEMA_VERSION,
        // ★P2 T2-9：文件声明写入它的引擎身份（宽身份串；身份门开启时必填）。
        ...(engineIdentity ? { engineIdentity } : {}),
        l0IndexVersion: computeL0IndexVersionPre(entries),
        updatedAt: ts,
        entries,
      },
      embedded: needEmbed.length,
      reusedById,
      reusedByHash,
    }
  }

  async function writeIndex(path, fileObj) {
    io.writeJson(path, fileObj)
    return fileObj
  }

  return {
    version: L0_INDEX_VERSION,

    /** 全量建索引(整文件重建,所有条目重算)。返回 {ok, count, added, recomputed, removed, skipped, embedded, l0IndexVersion} 或 {ok:false, error}。 */
    async buildFull({ path, text, maxChars, minChars, layer } = {}) {
      try {
        if (!embedder || typeof embedder.embedPassages !== 'function') throw new Error('embedder.embedPassages required')
        const items = buildL0IndexPre(typeof text === 'string' ? text : '', { maxChars, minChars, layer })
        const built = await assemble(items, null)
        const fileObj = built.fileObj
        await writeIndex(path, fileObj)
        return {
          ok: true, count: fileObj.entries.length, added: fileObj.entries.length,
          recomputed: fileObj.entries.length, removed: 0, skipped: 0,
          embedded: built.embedded, // 全量重建 = 真实 embedder 输入数（= 条目数）
          l0IndexVersion: fileObj.l0IndexVersion,
        }
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) }
      }
    },

    /**
     * 增量更新:新 L0 与旧索引逐条比 l0Hash——
     * 新增(旧无此 id)/变化(hash 不同)→ 仅这些条重算;不变 → 原样保留;消失(旧有新无)→ 移除。
     * 旧索引损坏/非法/引擎身份不符 → fail-soft 退化为全量重建(recovered / engineMismatch),不阻塞调用方。
     *
     * ★P2：`embedded` = **实际送进 embedder 的输入数**（T2-1 判据：不变更新 0 / 单新增 1 / 状态变化 0）。
     */
    async update({ path, text, maxChars, minChars, layer } = {}) {
      try {
        if (!embedder || typeof embedder.embedPassages !== 'function') throw new Error('embedder.embedPassages required')
        const prev = load({ path })
        const recovered = !prev.ok
        const engineMismatch = !prev.ok && prev.reason === 'engine-mismatch'
        const prevById = new Map()
        if (prev.ok) for (const e of prev.entries) prevById.set(e.id, e)
        const items = buildL0IndexPre(typeof text === 'string' ? text : '', { maxChars, minChars, layer })
        // 先做哈希分类,只为计数;实际组装仍走 assemble(其内部同样按 hash 决定复用)
        const nextById = new Map()
        let unchanged = 0
        let changed = 0
        for (const it of items) {
          const h = sha256Hex(it.l0)
          nextById.set(it.id, h)
          const p = prevById.get(it.id)
          if (p && p.l0Hash === h) unchanged++
          else changed++
        }
        let removed = 0
        for (const id of prevById.keys()) if (!nextById.has(id)) removed++
        const built = await assemble(items, prevById)
        await writeIndex(path, built.fileObj)
        return {
          ok: true,
          count: built.fileObj.entries.length,
          added: items.filter((it) => !prevById.has(it.id)).length,
          recomputed: changed,
          removed,
          skipped: unchanged,
          // ★P2 真增量读数（T2-1）：真实 embedder 输入数，与"按返回计数推断"无关。
          embedded: built.embedded,
          reusedById: built.reusedById,
          reusedByHash: built.reusedByHash,
          recovered: recovered || undefined,
          engineMismatch: engineMismatch || undefined,
          l0IndexVersion: built.fileObj.l0IndexVersion,
        }
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) }
      }
    },

    /** 显式移除失效条目。ids 中不存在的自动忽略。 */
    async remove({ path, ids } = {}) {
      try {
        const prev = load({ path })
        if (!prev.ok) return { ok: false, error: 'index not loadable: ' + (prev.reason || '?'), removed: 0 }
        const drop = new Set((Array.isArray(ids) ? ids : []).map(String))
        const kept = prev.entries.filter((e) => !drop.has(e.id))
        const ts = nowMs()
        const fileObj = {
          schemaVersion: L0_INDEX_SCHEMA_VERSION,
          l0IndexVersion: computeL0IndexVersionPre(kept),
          updatedAt: ts,
          entries: kept,
        }
        await writeIndex(path, fileObj)
        return {
          ok: true,
          removed: prev.entries.length - kept.length,
          count: kept.length,
          l0IndexVersion: fileObj.l0IndexVersion,
        }
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e), removed: 0 }
      }
    },

    /** fail-soft 读取(见 load)。 */
    load,

    /** 索引概况(不修改任何状态)。含引擎身份读数（T2-9：可供向导/诊断判断"当前引擎的索引是否就绪"）。 */
    status({ path } = {}) {
      const r = load({ path })
      if (!r.ok) return { ok: false, count: 0, path, reason: r.reason, engineIdentity: engineIdentity || null, engineMatch: r.reason === 'engine-mismatch' ? false : null }
      return { ok: true, count: r.entries.length, path, l0IndexVersion: r.l0IndexVersion, updatedAt: r.updatedAt, engineIdentity: engineIdentity || null, engineMatch: true }
    },
  }
}
