/**
 * L0 索引接线（l0_index_sync_pre_v1）—— 三层检索契约 C3
 * （`docs/internal/THREE-LAYER-CONTRACT.md` §7 C3；接口规范 `SEMANTIC-ARCHITECTURE-SPEC.md` S1/S9）。
 *
 * 背景：`lib/l0-index.js`（L0 自己的向量索引，增量）长期**零引用**——文件在、能力在、
 * 就是没人调用它。本模块是它的**接线口**：把「工作区语料里的 L0 摘要」按层增量写成索引文件，
 * 供后续语义检索读回向量，而不必每次现场重嵌（S1.3 的增量精神：只重算变化条）。
 *
 * ── 文件布局与命名（契约 C3）────────────────────────────────────────────
 *   <dir>/l0-index-<workspaceKey 短哈希>-<layer>.json
 *   例：~/.dsh/memory/semantic-pre/l0/l0-index-9f2c1ab34de5-project.json
 *
 * 为什么**按层各一份文件**、而不是「一个工作区一份合并文件」（与任务书的字面表述有偏差，
 * 这是**能力边界**而非偷懒，见下）：
 *   `l0-index-pre` 的 `buildFull`/`update` 每次调用只接受**单一 `layer`**
 *   （内部是 `buildL0IndexPre(text, { layer })` → 该次调用产出的**全部**条目同层）。
 *   工作区 L0 语料天然多层（project / user / log / reflection / whiteboard 五种来源同批），
 *   因此「一次调用产出一份含真实层归属的单文件」在该 API 下**无法表达**：
 *     - 传合并文本 + 任选一个 layer → 其余层的条目**全部落成错的层**（契约 I4 直接违反，
 *       这正是契约 C3 行里点名的「`:147/172` 未传层 → 会全落默认 log」同类错误）；
 *     - 沿用模块原样不动（任务书要求）时，唯一能保住层归属的实现就是**按层分文件**。
 *   若日后要「一份合并文件」，需要二选一：①给 `l0-index-pre` 增一个多来源入口（改模块）；
 *   ②在接线侧自己合并条目（等于把 `assemble()` 复制一份 → 同一文件格式两个写者，风险更高）。
 *   两条都未做，交由契约方裁定（见交付报告「未完成/存疑」）。
 *
 * ── 边界与纪律 ─────────────────────────────────────────────────────────
 *   - **默认开启**（宿主开关 `l0IndexEnabled` 默认 true，用户 2026-09-14 裁定）：`enabled !== true` 时零 IO、零嵌入、零目录创建（设 false 即回到零 IO）；
 *   - **fail-soft**：任何异常（读文件失败 / 嵌入抛错 / 写盘失败 / 单层失败）只记一行 `diag`，
 *     返回结构化 `{ok:false, reason}` 或逐层 `files[].error`，**绝不抛**、绝不阻塞调用方；
 *   - **S9（检索路径零 LLM）**：嵌入通道由调用方注入，本模块自身零网络、零模型、零 fetch——
 *     宿主注入的是端侧 JS 引擎（e5-small q8）的 `embedPassages`；
 *   - 只读调用方给出的来源路径，不自行发现工作区（禁用参数注入，不猜路径）。
 * 零第三方依赖（仅 node 内建）。UTF-8 无 BOM。
 */
import path from 'node:path'
import { createHash } from 'node:crypto'
import { L0_LAYERS } from './l0-extract.js'
import { createL0IndexPre } from './l0-index.js'

export const L0_INDEX_SYNC_VERSION = 'l0_index_sync_pre_v1'

/** 索引文件名前缀（契约 C3 命名：`l0-index-<workspaceKey 短哈希>`）。 */
export const L0_INDEX_FILE_PREFIX = 'l0-index-'

/** 短哈希长度（hex 字符）：12 hex = 48 bit，够工作区级唯一，文件名仍短。 */
export const L0_INDEX_WS_HASH_CHARS = 12

const LAYER_SET = new Set(L0_LAYERS)

/** workspaceKey → 短哈希（确定性；空键也稳定，不抛）。 */
export function workspaceKeyShortHashPre(workspaceKey, chars = L0_INDEX_WS_HASH_CHARS) {
  const n = Number(chars) > 0 ? Math.min(64, Math.floor(Number(chars))) : L0_INDEX_WS_HASH_CHARS
  return createHash('sha256').update(String(workspaceKey == null ? '' : workspaceKey), 'utf8').digest('hex').slice(0, n)
}

/** 索引文件名：`l0-index-<wsHash 12>-<layer>.json`（非法 layer 回落 log，绝不生成脏文件名）。 */
export function l0IndexFileNamePre(workspaceKey, layer, chars = L0_INDEX_WS_HASH_CHARS) {
  const l = LAYER_SET.has(String(layer)) ? String(layer) : 'log'
  return L0_INDEX_FILE_PREFIX + workspaceKeyShortHashPre(workspaceKey, chars) + '-' + l + '.json'
}

/**
 * 工厂：L0 索引同步器（IO / 嵌入 / 读文本 全注入）。
 *
 * @param {object} opts
 * @param {{readJson(path):any, writeJson(path,obj):void}} opts.io 落盘 IO（同 l0-index-pre 契约；
 *        readJson 对缺失文件返回 null 或抛 ENOENT 均可被模块层容错）。
 * @param {{embedPassages(texts:string[]):Promise<Float32Array[]|number[][]>}} opts.embedder
 *        端侧嵌入通道（宿主机注入 `_jsSemantic.embedPassages`；测试注入假 embedder）。
 * @param {(filePath:string)=>Promise<string>} [opts.readText] 读来源文本（fail-soft；返回空串=跳过）。
 * @param {(msg:string)=>void} [opts.diag] 诊断输出（默认静默）。
 */
export function createL0IndexSyncPre(opts = {}) {
  const io = opts.io
  const embedder = opts.embedder
  const readText = typeof opts.readText === 'function' ? opts.readText : null
  const diagFn = typeof opts.diag === 'function' ? opts.diag : () => {}
  // ★P2（T2-9）：透传引擎身份与两个开关到索引层（身份门 + 跨 id 复用）。
  // 不传身份 ⇒ 索引层不启用身份门（旧行为）；宿主接线时传真实宽身份。
  const engineIdentity = typeof opts.engineIdentity === 'string' ? opts.engineIdentity : ''
  const engineIdentityGate = opts.engineIdentityGate
  const crossIdReuse = opts.crossIdReuse
  // 工厂级配置错误直接抛（调用方组装错，不属运行期 fail-soft 范畴）——与 l0-index-pre 同口径。
  if (!io || typeof io.readJson !== 'function' || typeof io.writeJson !== 'function') {
    throw new Error('l0-index-sync-pre: io.readJson/io.writeJson required')
  }
  if (!embedder || typeof embedder.embedPassages !== 'function') {
    throw new Error('l0-index-sync-pre: embedder.embedPassages required')
  }

  const safeDiag = (msg) => { try { diagFn(String(msg).slice(0, 200)) } catch (_) {} }

  /** 路径拼接（统一走 node:path，Windows 反斜杠不影响）。 */
  function indexPathOf(dir, workspaceKey, layer) {
    return path.join(String(dir || ''), l0IndexFileNamePre(workspaceKey, layer))
  }

  /**
   * 同步一次（幂等、可重复调用）。
   *
   * @param {object} o
   * @param {boolean} o.enabled 总开关 —— 非 true 直接返回 disabled，**零 IO**（宿主 `l0IndexEnabled`，默认 true）。
   * @param {string} o.workspaceKey 工作区键（进文件名短哈希）。
   * @param {string} o.dir 索引目录（<dshHome>/memory/semantic-pre/l0）。
   * @param {Array<{layer:string, path:string, text?:string}>} o.sources 来源（text 已给则不读盘）。
   * @param {number} [o.maxChars] / @param {number} [o.minChars] 透传 l0-extract-pre 的抽取参数。
   * @param {()=>number} [o.now] 时间注入（测试确定性）。
   * @returns {Promise<{ok:boolean, reason:string, enabled:boolean, written:number, count:number,
   *   files:Array<{layer:string, path:string, ok:boolean, count:number, added:number, recomputed:number,
   *   removed:number, skipped:number, l0IndexVersion:string, error:string}>}>}
   */
  async function sync(o = {}) {
    const files = []
    const empty = (reason, enabled) => ({ ok: false, reason, enabled: !!enabled, written: 0, count: 0, files })
    try {
      const enabled = o && o.enabled === true
      if (!enabled) return empty('disabled', false)
      const dir = String((o && o.dir) || '')
      if (!dir) return empty('no-dir', true)
      const workspaceKey = String((o && o.workspaceKey) || '')
      const maxChars = o && o.maxChars
      const minChars = o && o.minChars
      const now = o && typeof o.now === 'function' ? o.now : undefined

      // ① 来源分组：只认合法 layer + 非空路径；同路径去重（今日日志可能同时在 logs 与 logPath 里）。
      const groups = new Map()
      const seenPaths = new Set()
      let droppedSources = 0
      for (const s of Array.isArray(o && o.sources) ? o.sources : []) {
        const layer = String((s && s.layer) || '')
        const p = String((s && s.path) || '')
        if (!LAYER_SET.has(layer) || !p) { droppedSources++; continue }
        let key = p
        try { key = path.resolve(p) } catch (_) { key = p }
        const keyWithLayer = layer + '|' + key
        if (seenPaths.has(keyWithLayer)) { droppedSources++; continue }
        seenPaths.add(keyWithLayer)
        if (!groups.has(layer)) groups.set(layer, [])
        groups.get(layer).push({ path: p, text: s && typeof s.text === 'string' ? s.text : null })
      }
      if (!groups.size) return { ok: false, reason: 'no-sources', enabled: true, written: 0, count: 0, droppedSources, files }

      // ② 逐层同步（层名升序 = 确定性；每层一次 update，只重算该层变化的条）。
      let written = 0
      let count = 0
      const idx = createL0IndexPre({
        io, embedder, ...(now ? { now } : {}),
        ...(engineIdentity ? { engineIdentity } : {}),
        ...(engineIdentityGate !== undefined ? { engineIdentityGate } : {}),
        ...(crossIdReuse !== undefined ? { crossIdReuse } : {}),
      })
      for (const layer of [...groups.keys()].sort()) {
        const parts = []
        for (const src of groups.get(layer)) {
          let text = src.text
          if (text == null) {
            if (!readText) continue
            try { text = await readText(src.path) } catch (e) { safeDiag('l0-index-sync: read fail ' + layer + ' ' + src.path + ': ' + ((e && e.message) || e)); text = '' }
          }
          if (text) parts.push(String(text))
        }
        const text = parts.join('\n')
        const filePath = indexPathOf(dir, workspaceKey, layer)
        let r
        try {
          // layer 必须显式传入：不传 → buildL0IndexPre 回退默认 log，整层归属丢失（契约 C3 点名的坑）。
          r = await idx.update({ path: filePath, text, layer, ...(maxChars ? { maxChars } : {}), ...(minChars ? { minChars } : {}) })
        } catch (e) {
          r = { ok: false, error: String((e && e.message) || e) }
        }
        if (!r || !r.ok) {
          safeDiag('l0-index-sync: update fail layer=' + layer + ': ' + String((r && r.error) || 'unknown'))
          files.push({ layer, path: filePath, ok: false, count: 0, added: 0, recomputed: 0, removed: 0, skipped: 0, l0IndexVersion: '', error: String((r && r.error) || 'unknown') })
          continue
        }
        written++
        count += Number(r.count) || 0
        files.push({
          layer, path: filePath, ok: true,
          count: Number(r.count) || 0, added: Number(r.added) || 0, recomputed: Number(r.recomputed) || 0,
          removed: Number(r.removed) || 0, skipped: Number(r.skipped) || 0,
          embedded: Number(r.embedded) || 0,   // ★P2（T2-1）：真实 embedder 输入数（逐层）
          l0IndexVersion: String(r.l0IndexVersion || ''), error: '',
        })
      }
      if (!written) return { ok: false, reason: 'all-failed', enabled: true, written: 0, count: 0, droppedSources, files }
      return { ok: true, reason: '', enabled: true, written, count, droppedSources, files }
    } catch (e) {
      safeDiag('l0-index-sync 降级: ' + String((e && e.message) || e))
      return empty('error', true)
    }
  }

  return { version: L0_INDEX_SYNC_VERSION, sync, indexPathOf, _l0IndexFileNamePre: l0IndexFileNamePre }
}
