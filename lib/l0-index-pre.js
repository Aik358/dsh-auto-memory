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
import { buildL0IndexPre } from './l0-extract-pre.js'

export const L0_INDEX_VERSION = 'l0_index_pre_v1'
export const L0_INDEX_SCHEMA_VERSION = 1

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
 * l0IndexVersion:canonical sorted [id,l0Hash] tuples → 'l0idx_pre_' + first32hex(sha256)。
 * 同内容同版本(确定性);任一条目 l0 变化或条目增删 → 版本变化。
 */
export function computeL0IndexVersionPre(entries) {
  const canon = (Array.isArray(entries) ? entries : [])
    .map((e) => [String(e && e.id) || '', String(e && e.l0Hash) || ''])
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
        out.push({ id: e.id, vector: vec, l0: e.l0, source: e.source, l0Hash: e.l0Hash, updatedAt: Number(e.updatedAt) })
      }
      return { ok: true, entries: out, l0IndexVersion: obj.l0IndexVersion, updatedAt: Number(obj.updatedAt) || 0 }
    } catch (e) {
      return { ok: false, reason: 'read-error', error: String(e && e.message ? e.message : e), entries: [] }
    }
  }

  /** 由 buildL0IndexPre 的条目 + 批量 embedding 组装索引文件对象(不写盘)。 */
  async function assemble(items, prevById) {
    const texts = items.map((it) => it.l0)
    const vecs = await embedder.embedPassages(texts)
    if (!Array.isArray(vecs) || vecs.length !== items.length) {
      throw new Error('l0-index-pre: embedder returned ' + (Array.isArray(vecs) ? vecs.length : 'non-array') + ' vectors for ' + items.length + ' passages')
    }
    const ts = nowMs()
    const entries = items.map((it, i) => {
      const vector = normalizeVector(vecs[i])
      if (!vector) throw new Error('l0-index-pre: embedder produced invalid vector at index ' + i)
      const l0Hash = sha256Hex(it.l0)
      const prev = prevById ? prevById.get(it.id) : null
      // 复用语义:prev 的 l0Hash 一致才整条复用(保留原 updatedAt);否则按新条处理
      const reused = prev && prev.l0Hash === l0Hash
      return {
        id: it.id,
        vector: reused ? prev.vector : vector,
        l0: it.l0,
        source: it.source,
        l0Hash,
        updatedAt: reused ? prev.updatedAt : ts,
      }
    })
    entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    return {
      schemaVersion: L0_INDEX_SCHEMA_VERSION,
      l0IndexVersion: computeL0IndexVersionPre(entries),
      updatedAt: ts,
      entries,
    }
  }

  async function writeIndex(path, fileObj) {
    io.writeJson(path, fileObj)
    return fileObj
  }

  return {
    version: L0_INDEX_VERSION,

    /** 全量建索引(整文件重建,所有条目重算)。返回 {ok, count, added, recomputed, removed, skipped, l0IndexVersion} 或 {ok:false, error}。 */
    async buildFull({ path, text, maxChars, minChars } = {}) {
      try {
        if (!embedder || typeof embedder.embedPassages !== 'function') throw new Error('embedder.embedPassages required')
        const items = buildL0IndexPre(typeof text === 'string' ? text : '', { maxChars, minChars })
        const fileObj = await assemble(items, null)
        await writeIndex(path, fileObj)
        return {
          ok: true, count: fileObj.entries.length, added: fileObj.entries.length,
          recomputed: fileObj.entries.length, removed: 0, skipped: 0,
          l0IndexVersion: fileObj.l0IndexVersion,
        }
      } catch (e) {
        return { ok: false, error: String(e && e.message ? e.message : e) }
      }
    },

    /**
     * 增量更新:新 L0 与旧索引逐条比 l0Hash——
     * 新增(旧无此 id)/变化(hash 不同)→ 仅这些条重算;不变 → 原样保留;消失(旧有新无)→ 移除。
     * 旧索引损坏/非法 → fail-soft 退化为全量重建(recovered:true),不阻塞调用方。
     */
    async update({ path, text, maxChars, minChars } = {}) {
      try {
        if (!embedder || typeof embedder.embedPassages !== 'function') throw new Error('embedder.embedPassages required')
        const prev = load({ path })
        const recovered = !prev.ok
        const prevById = new Map()
        if (prev.ok) for (const e of prev.entries) prevById.set(e.id, e)
        const items = buildL0IndexPre(typeof text === 'string' ? text : '', { maxChars, minChars })
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
        const fileObj = await assemble(items, prevById)
        await writeIndex(path, fileObj)
        return {
          ok: true,
          count: fileObj.entries.length,
          added: items.filter((it) => !prevById.has(it.id)).length,
          recomputed: changed,
          removed,
          skipped: unchanged,
          recovered: recovered || undefined,
          l0IndexVersion: fileObj.l0IndexVersion,
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

    /** 索引概况(不修改任何状态)。 */
    status({ path } = {}) {
      const r = load({ path })
      if (!r.ok) return { ok: false, count: 0, path, reason: r.reason }
      return { ok: true, count: r.entries.length, path, l0IndexVersion: r.l0IndexVersion, updatedAt: r.updatedAt }
    },
  }
}
