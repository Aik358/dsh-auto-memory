/**
 * M4-2 Corpus Adapter — SourceCatalog/M3b sidecar 校验/CorpusRegistry(docs/M4-CONTRACT.md §7/§8)。
 * 纯适配层:输入为受控 source paths 与磁盘 shadow-copy;不接触 live Host、不做 audit、不注入。
 *
 * 职责:
 *   1) buildSourceCatalog({workspaceKey, userMemoryPath, workspaceMemoryPath, todayLogPath}):
 *      固定顺序三源 catalog(user/workspace/workspace-log),canonical 化,sourceRef 稳定相对引用。
 *   2) canonicalScopeGuard:sidecar.sourceFile 必须与 catalog canonical 完全一致;
 *      symlink/reparse 解析真实路径不得逃逸允许根(realpathSync)。
 *   3) loadCorpusSnapshot(catalog, fsApi):逐源 parseSidecar→stat/read→fileDigest 比对→
 *      record byte range/digest 校验→CorpusRecord[](legacy/conflict/stale fail closed 记原因);
 *      memoryIndexVersion(canonical tuples);预算(sources≤3/records≤512/corpusBytes≤64MiB/单文件 5MiB)。
 *   4) CorpusRegistry:fingerprint(stat size+mtimeMs)缓存;fingerprint 未变化复用 snapshot;
 *      变化只 reload 受影响 source 并整体替换;completedKeys/recentHits 上限由调用方持有。
 */
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseSidecar } from './memory-anchor.js'
import { memoryIndexVersion as computeIndexVersion, SHADOW_LEXICAL_BUDGET_V1 as BUDGET } from './shadow-retrieval.js'

const sha256Hex = (buf) => createHash('sha256').update(buf).digest('hex')
const INDEX_MAX_FILE_BYTES = 5 * 1024 * 1024

/** Windows 稳定 canonical:resolve + 正斜杠 + 小写(大小写不敏感 FS)。 */
export function canonicalize(p) {
  return path.resolve(String(p == null ? '' : p)).replace(/\\/g, '/').toLowerCase()
}

/** sourceRef 稳定相对引用(契约 §15.3:audit 只允许这三类前缀)。 */
function refFor(kind, file) {
  const base = path.basename(file)
  if (kind === 'user') return 'user:' + base
  if (kind === 'workspace-log') return 'workspace-log:' + base
  return 'workspace:' + base
}


/** §7.2 SourceCatalog:三源固定顺序;canonical 化;scope 授权由调用方受控路径决定。 */
export function buildSourceCatalog({ workspaceKey, userMemoryPath, workspaceMemoryPath, todayLogPath }) {
  const entries = []
  if (userMemoryPath) entries.push({ kind: 'user', scope: 'User', sourceClass: 'user-memory', file: userMemoryPath })
  if (workspaceMemoryPath) entries.push({ kind: 'workspace', scope: 'Workspace', sourceClass: 'workspace-notes', file: workspaceMemoryPath })
  if (todayLogPath) entries.push({ kind: 'workspace-log', scope: 'Workspace', sourceClass: 'workspace-log', file: todayLogPath })
  const sources = entries.map((e) => ({
    kind: e.kind, scope: e.scope, sourceClass: e.sourceClass,
    file: path.resolve(e.file),
    canonicalFile: canonicalize(e.file),
    sourceRef: refFor(e.kind, e.file),
    workspaceKey: String(workspaceKey || ''),
  }))
  return { workspaceKey: String(workspaceKey || ''), sources }
}

/**
 * §7.3 scope guard:sidecar.sourceFile 必须与 catalog canonical 完全一致;
 * 真实路径(realpath,解析 symlink/reparse/8.3)不得逃逸声明目录。
 */
export function canonicalScopeGuard(source, sidecarSourceFile, fsApi = { realpathSync }) {
  if (canonicalize(sidecarSourceFile) !== canonicalize(source.file)) {
    return { ok: false, reason: 'source-mismatch' }
  }
  let real
  try { real = canonicalize(fsApi.realpathSync(source.file)) } catch (_) { return { ok: false, reason: 'sidecar-invalid' } }
  const declaredRoot = canonicalize(path.dirname(path.resolve(source.file)))
  if (!real.startsWith(declaredRoot)) return { ok: false, reason: 'cross-workspace' }
  return { ok: true }
}

// —— IO 抽象(测试注入;默认同步 node:fs)——
function existsSyncIo(io, p) { return io && io.existsSync ? io.existsSync(p) : existsSync(p) }
function readFileSyncIo(io, p) { return io && io.readFileSync ? io.readFileSync(p) : readFileSync(p) }

/** §7.3/§8 loader:sidecar→guard→文件 digest→record 校验→CorpusSnapshot(预算 fail closed)。 */
export function loadCorpusSnapshot(catalog, io = {}, opts = {}) {
  const sidecarDir = io.sidecarDir
  const dropped = []
  const records = []
  const versionSources = []
  let loadedSources = 0
  for (const source of catalog.sources) {
    const canonHash = sha256Hex(Buffer.from(canonicalize(source.file), 'utf8'))
    const sp = path.join(sidecarDir, canonHash + '.json')
    if (!existsSyncIo(io, sp)) { dropped.push({ stage: 'corpus', reason: 'sidecar-missing', sourceRef: source.sourceRef }); continue }
    let sideText
    try { sideText = readFileSyncIo(io, sp) } catch (_) { dropped.push({ stage: 'corpus', reason: 'sidecar-invalid', sourceRef: source.sourceRef }); continue }
    const parsed = parseSidecar(String(sideText))
    if (!parsed.ok) { dropped.push({ stage: 'corpus', reason: 'sidecar-invalid', sourceRef: source.sourceRef }); continue }
    const sc = parsed.sidecar
    const g = canonicalScopeGuard(source, sc.sourceFile)
    if (!g.ok) { dropped.push({ stage: 'corpus', reason: g.reason, sourceRef: source.sourceRef }); continue }
    let buf
    try { buf = readFileSyncIo(io, source.file) } catch (_) { dropped.push({ stage: 'corpus', reason: 'stale-source', sourceRef: source.sourceRef }); continue }
    if (buf.length > INDEX_MAX_FILE_BYTES) { dropped.push({ stage: 'corpus', reason: 'oversized', sourceRef: source.sourceRef }); continue }
    const fileDigest = sha256Hex(buf)
    if (fileDigest !== sc.fileDigest) { dropped.push({ stage: 'corpus', reason: 'stale-source', sourceRef: source.sourceRef }); continue }
    for (const r of (sc.records || [])) {
      if (!Number.isInteger(r.byteStart) || !Number.isInteger(r.byteEnd) || r.byteStart < 0 || r.byteEnd > buf.length) {
        dropped.push({ stage: 'corpus', reason: 'record-stale', memoryId: r.memoryId, sourceRef: source.sourceRef }); continue
      }
      if (sha256Hex(buf.subarray(r.byteStart, r.byteEnd)) !== r.recordDigest) {
        dropped.push({ stage: 'corpus', reason: 'record-stale', memoryId: r.memoryId, sourceRef: source.sourceRef }); continue
      }
      records.push({
        memoryId: r.memoryId, anchorId: r.anchorId,
        scope: source.scope, sourceClass: source.sourceClass, sourceRef: source.sourceRef,
        sourceEpoch: sc.sourceEpoch, sourceVersion: sc.sourceVersion,
        fileDigest: sc.fileDigest, recordDigest: r.recordDigest,
        lineStart: r.lineStart || 0, lineEnd: r.lineEnd || 0,
        byteStart: r.byteStart, byteEnd: r.byteEnd,
        heading: r.heading != null ? r.heading : null,
        text: buf.toString('utf8', r.byteStart, Math.min(r.byteEnd, r.byteStart + BUDGET.recordScanKiB * 1024)),
        bytes: r.bytes != null ? r.bytes : (r.byteEnd - r.byteStart),
      })
    }
    loadedSources++
    versionSources.push({ scope: source.scope, sourceRef: source.sourceRef, sourceEpoch: sc.sourceEpoch, sourceVersion: sc.sourceVersion, fileDigest: sc.fileDigest })
  }
  if (loadedSources > BUDGET.sourceFiles) return { ok: false, reason: 'source-budget', dropped }
  if (records.length > BUDGET.corpusRecords) return { ok: false, reason: 'record-budget', dropped }
  let totalBytes = 0
  for (const r of records) totalBytes += Number(r.bytes || 0)
  if (totalBytes > BUDGET.corpusBytes) return { ok: false, reason: 'corpus-byte-budget', dropped }
  const miv = computeIndexVersion(versionSources)
  return {
    ok: true,
    snapshot: {
      memoryIndexVersion: miv,
      sources: versionSources,
      records,
      counts: { sources: loadedSources, records: records.length, legacyConflicts: dropped.filter((d) => d.reason === 'legacy-conflict').length, rawHits: 0, kept: 0, dropped: dropped.length },
      dropped,
    },
    dropped,
  }
}

/** §14.3 stat fingerprint(size+mtimeMs)。 */
export function sourceFingerprint(file, fsApi = {}) {
  try {
    const st = (fsApi.statSync || statSync)(file)
    return st.size + ':' + st.mtimeMs
  } catch (_) { return null }
}

/** CorpusRegistry:fingerprint 缓存;未变化复用(零重读),变化整体重建。 */
export class CorpusRegistry {
  constructor(opts = {}) { this.sidecarDir = opts.sidecarDir || null; this._cache = new Map() }

  get(catalog) {
    const key = canonicalize(catalog.workspaceKey || '__all__')
    const cached = this._cache.get(key)
    const fingerprints = new Map()
    const changed = []
    for (const s of catalog.sources) {
      const fp = sourceFingerprint(s.file)
      fingerprints.set(s.canonicalFile, fp)
      const prevFp = cached && cached.fingerprints.get(s.canonicalFile)
      if (prevFp !== fp) changed.push(s)
    }
    if (cached && changed.length === 0) return { ok: true, snapshot: cached.snapshot, reloaded: [], fromCache: true }
    const res = loadCorpusSnapshot(catalog, { sidecarDir: this.sidecarDir }, {})
    if (!res.ok) return res
    this._cache.set(key, { fingerprints, snapshot: res.snapshot })
    return { ok: true, snapshot: res.snapshot, reloaded: changed.map((c) => c.sourceRef), fromCache: false }
  }

  invalidate() { this._cache.clear() }
}
