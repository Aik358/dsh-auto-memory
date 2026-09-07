/**
 * M10 存储管理(docs/HANDOFF-M8-M9-M10.md §2 P3)。
 *
 * 原语此前都已就绪但**零组装**,本模块把三个接线点装起来:
 *   ①删除一条记忆 = docStore.replace(原子事务,省略锚定 ID 即删除)
 *                  + activationHost.purgeMemory(在途激活包级联清理)
 *                  + factStore.revokeBySource(派生事实级联失效)
 *   ②语料健康扫描 = 逐源 sidecar ↔ 正文 fileDigest 比对(复用 M4-2 loadCorpusSnapshot 的
 *                  dropped 分类),stale 自动 rebuildSidecar(只重建 sidecar,不动正文,零风险)
 *   ③管理动作审计(有界 64 条最小投影,只记 sourceRef/原因,不记正文)
 *
 * 铁律遵守:
 *   - 不碰 M5/M6 validator / Reference Tail 固定边界 / seen 语义;
 *     删除只影响「还没投递的包」与「还没固化的事实」,已产生的 seen 证据不改写。
 *   - 全 _pre 命名空间;可注入 IO(docStore/io/activationHost/factStore),便于纯内存测试。
 *   - 每个动作 fail-closed:任一步失败不影响其它步,结果逐项回报。
 * UTF-8 无 BOM。
 */
import { buildSourceCatalog, loadCorpusSnapshot } from './m4-corpus.js'
import { parseAnchors } from './memory-anchor.js'

export const STORAGE_MANAGE_VERSION_V1 = 'storage_manage_v1'
/** 审计环形缓冲上限(最小投影,不记正文)。 */
const AUDIT_MAX = 64
/** 可通过「重建 sidecar」自愈的失效分类(与 loadCorpusSnapshot 的 dropped.reason 对齐)。 */
export const REPAIRABLE_REASONS_V1 = Object.freeze(['sidecar-missing', 'sidecar-invalid', 'stale-source', 'record-stale'])

export function createStorageManagerPre(opts = {}) {
  const docStore = opts.docStore || null
  const io = opts.io || {}
  const pathsOf = typeof opts.pathsOf === 'function' ? opts.pathsOf : () => null
  const activationHostOf = typeof opts.activationHostOf === 'function' ? opts.activationHostOf : () => opts.activationHost || null
  const factStoreOf = typeof opts.factStoreOf === 'function' ? opts.factStoreOf : () => opts.factStore || null
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  const audit = []

  function auditPush(entry) {
    audit.push({ at: now(), ...entry })
    while (audit.length > AUDIT_MAX) audit.shift()
  }

  /** 当前工作区的三源 catalog(用户记忆/项目笔记/今日日志);路径缺失返回 null。 */
  function catalogFor(paths) {
    const p = paths || pathsOf()
    if (!p) return null
    return buildSourceCatalog({
      workspaceKey: p.workspaceKey || p.ws || '',
      userMemoryPath: p.userDir ? (p.userMemoryPath || (p.userDir + '/MEMORY.md')) : p.userMemoryPath,
      workspaceMemoryPath: p.notesPath,
      todayLogPath: p.logPath,
    })
  }

  /**
   * ①语料健康扫描:逐源比对 sidecar 与正文。
   * 健康度判定完全复用 M4-2 的 dropped 分类,不另写一套 digest 逻辑(避免两套真相)。
   * @returns {{ok:true, sources:Array, stale:Array, counts:object}|{ok:false,reason:string}}
   */
  function scanHealth(paths) {
    const catalog = catalogFor(paths)
    if (!catalog) return { ok: false, reason: 'no-paths' }
    if (!io.sidecarDir) return { ok: false, reason: 'no-sidecar-dir' }
    const res = loadCorpusSnapshot(catalog, io)
    const dropped = (res && res.dropped) || []
    const byRef = new Map()
    for (const d of dropped) {
      if (!byRef.has(d.sourceRef)) byRef.set(d.sourceRef, [])
      byRef.get(d.sourceRef).push(d.reason)
    }
    const sources = catalog.sources.map((s) => {
      const reasons = [...new Set(byRef.get(s.sourceRef) || [])]
      const repairable = reasons.filter((r) => REPAIRABLE_REASONS_V1.includes(r))
      return {
        sourceRef: s.sourceRef, kind: s.kind, scope: s.scope, file: s.file,
        status: repairable.length ? 'stale' : (reasons.length ? 'unrepairable' : 'ok'),
        reasons, repairable,
      }
    })
    const stale = sources.filter((s) => s.status === 'stale')
    const out = {
      ok: true,
      scannedAt: now(),
      version: STORAGE_MANAGE_VERSION_V1,
      sources,
      stale,
      counts: {
        total: sources.length,
        ok: sources.filter((s) => s.status === 'ok').length,
        stale: stale.length,
        unrepairable: sources.filter((s) => s.status === 'unrepairable').length,
      },
    }
    auditPush({ action: 'scan', stale: stale.length, total: sources.length })
    return out
  }

  /** 读取既有 sidecar(尽力而为):用于 rebuildSidecar 继承 epoch/version,避免无谓的 epoch 漂移。 */
  function readSidecarPrev(file) {
    try {
      if (!docStore || typeof docStore.sidecarPath !== 'function') return null
      const sp = docStore.sidecarPath(file)
      if (!sp) return null
      const txt = io.readFileSync ? io.readFileSync(sp, 'utf8') : null
      if (!txt) return null
      const j = JSON.parse(String(txt))
      if (!j || typeof j !== 'object') return null
      return { sourceEpoch: j.sourceEpoch, sourceVersion: j.sourceVersion, fileDigest: j.fileDigest }
    } catch (_) { return null }
  }

  /**
   * ②stale 自愈:只重建 sidecar,**不改动一个字节的正文**(用户手改内容零风险)。
   * @param {Array<{file:string}>} items 为空时自动按 scanHealth 的 stale 列表修复
   */
  async function repair(items, paths) {
    if (!docStore || typeof docStore.rebuildSidecar !== 'function') return { ok: false, reason: 'no-doc-store' }
    let list = Array.isArray(items) ? items : null
    if (!list) {
      const sc = scanHealth(paths)
      if (!sc.ok) return sc
      list = sc.stale
    }
    const out = []
    for (const it of list) {
      const file = it && it.file
      if (!file) { out.push({ ok: false, reason: 'no-file' }); continue }
      try {
        const r = await docStore.rebuildSidecar(file, readSidecarPrev(file) || undefined)
        out.push({ file, sourceRef: it.sourceRef || null, ok: !!r.ok, reason: r.ok ? undefined : r.reason })
      } catch (e) { out.push({ file, ok: false, reason: String(e && e.message || e).slice(0, 120) }) }
    }
    const repaired = out.filter((x) => x.ok).length
    auditPush({ action: 'repair', repaired, attempted: out.length })
    return { ok: true, repaired, attempted: out.length, results: out }
  }

  /**
   * ③删除一条记忆(三联动事务)。
   * 步骤:解析正文 → 摘掉该记录(marker 行 + 正文块)→ docStore.replace 原子写
   *      → activationHost.purgeMemory(在途包)→ factStore.revokeBySource(派生事实)。
   * 后两步是「尽力而为」的级联:失败不影响正文删除结果,但会在 cascade 里如实回报。
   * @param {{filePath:string, memoryId:string, expectedDigest?:string}} input
   */
  async function deleteMemory(input) {
    const filePath = input && input.filePath
    const memoryId = String((input && input.memoryId) || '')
    if (!filePath) return { ok: false, reason: 'no-file-path' }
    if (!memoryId) return { ok: false, reason: 'no-memory-id' }
    if (!docStore || typeof docStore.replace !== 'function') return { ok: false, reason: 'no-doc-store' }

    let buf
    try { buf = await docStore.fs.readFile(filePath) } catch (e) { return { ok: false, reason: 'read-failed:' + String(e && e.code || 'error') } }
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(String(buf), 'utf8')
    const parsed = parseAnchors(buf)
    if (parsed.status === 'oversized') return { ok: false, reason: 'oversized' }
    if (parsed.status !== 'clean') return { ok: false, reason: 'conflict:' + parsed.conflicts.map((c) => c.type).join(',') }
    const rec = parsed.records.find((r) => r.kind === 'anchored' && r.memoryId === memoryId)
    if (!rec) return { ok: false, reason: 'not-found' }

    // BOM:parseAnchors 的字节偏移是**去掉 BOM 之后**的坐标系,切除前先对齐
    const bomLen = parsed.bom ? 3 : 0
    const body = bomLen ? buf.subarray(bomLen) : buf
    // 删除区间 = marker 行起点 → 最后一行内容结束(byteStart/byteEnd 不含 marker 行)
    let start = rec.markerByteStart
    let end = rec.byteEnd
    if (!(start >= 0 && end > start && end <= body.length)) return { ok: false, reason: 'bad-record-range' }
    // 顺带吃掉紧随其后的一个换行(CRLF/LF),避免留下空洞空行
    if (body[end] === 0x0d && body[end + 1] === 0x0a) end += 2
    else if (body[end] === 0x0a) end += 1
    const newBody = Buffer.concat([body.subarray(0, start), body.subarray(end)])
    const newText = bomLen ? Buffer.concat([buf.subarray(0, bomLen), newBody]) : newBody

    let write
    try {
      write = await docStore.replace(filePath, newText, { expectedDigest: input && input.expectedDigest })
    } catch (e) { return { ok: false, reason: 'write-failed:' + String(e && e.message || e).slice(0, 120) } }
    if (!write || !write.ok) return { ok: false, reason: (write && write.reason) || 'write-failed' }

    const cascade = { purge: null, revoked: null }
    try {
      const host = activationHostOf()
      if (host && typeof host.purgeMemory === 'function') cascade.purge = host.purgeMemory(memoryId)
      else cascade.purge = { ok: false, reason: 'no-activation-host' }
    } catch (e) { cascade.purge = { ok: false, reason: String(e && e.message || e).slice(0, 80) } }
    try {
      const fs2 = factStoreOf()
      if (fs2 && typeof fs2.revokeBySource === 'function') cascade.revoked = fs2.revokeBySource(memoryId)
      else cascade.revoked = { ok: false, reason: 'no-fact-store', revoked: 0 }
    } catch (e) { cascade.revoked = { ok: false, reason: String(e && e.message || e).slice(0, 80), revoked: 0 } }

    auditPush({ action: 'delete', memoryId, removed: (write.removed || []).length, revoked: (cascade.revoked && cascade.revoked.revoked) || 0 })
    return { ok: true, memoryId, file: filePath, removed: write.removed || [], kept: write.kept || [], cascade }
  }

  return {
    scanHealth,
    repair,
    deleteMemory,
    auditLog: () => audit.slice(),
    version: STORAGE_MANAGE_VERSION_V1,
    dispose() { audit.length = 0 },
  }
}
