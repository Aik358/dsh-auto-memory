/**
 * 迁移包引擎（migrate pack）—— 把一个工作区的记忆打包/搬包/导入。
 *
 * ★设计要点（依据 docs/internal/MIGRATION-ARCH-20260922.md 的实测取证）：
 *   1. **零依赖**：只用 node 内置。不用 zip（`node:zlib` 只有 gzip/deflate、没有 zip 容器；
 *      引第三方库违反本仓零依赖铁律）⇒ 单 JSON 文件，可选再 gzip 一层。
 *   2. **纯逻辑与 IO 分离**：本模块**不碰真实磁盘**（只做纯函数），IO 由宿主负责。
 *      这样导出/重写/计划三步都能在守卫里用真数据直接单测，不必起宿主。
 *   3. **路径重写是必需的**：实测 slug 规则为
 *        `'--' + path.replace(/[\\/:*?"<>|]/g, '-') + '--'`
 *      —— 它**不可逆**（原路径里的 `-` 与替换产物 `-` 无法区分）⇒ 新路径的 slug 只能由
 *      新路径**重新计算**，且文件内出现的旧路径必须逐处重写，否则 B 机全是死链。
 *   4. **checksum 必校验**：半损坏的包会污染现场且极难排查 ⇒ inspect 阶段即拒绝。
 *
 * 包格式 `dam-pack-v1`（单个 JSON）：
 *   {
 *     format, createdAt, source:{ws,slug,host}, runtime:{pluginVersion},
 *     summaryRecord,            // workspaces-summary.json 里属于该工作区的那一条
 *     files: { '<相对 slug 目录的路径>': '<原样文本>' },
 *     stats: { fileCount, bytes },
 *     checksum: { algo:'sha256', value }
 *   }
 */

import { createHash } from 'node:crypto'

export const MIGRATE_PACK_FORMAT_PRE = 'dam-pack-v1'
export const MIGRATE_PACK_CHECKSUM_ALGO_PRE = 'sha256'
/** 单包上限：文件数与总字节（防手滑把整个 memory 目录塞进来）。 */
export const MIGRATE_PACK_MAX_FILES_PRE = 20000
export const MIGRATE_PACK_MAX_BYTES_PRE = 256 * 1024 * 1024

/**
 * workspaceKey（slug）—— **与宿主 `lib/index.js` 的同名逻辑逐字一致**。
 * ★不要改成「更聪明」的写法：两处一旦不一致，导入会把数据放进错误的目录。
 */
export function workspaceSlugPre(ws) {
  if (typeof ws !== 'string' || !ws) return ''
  return '--' + String(ws).replace(/[\\/:*?"<>|]/g, '-') + '--'
}

/**
 * 一个真实路径在文件里可能出现的 **4 种形态**。
 * 实测：日志/笔记正文写的是 `D:\a\b`；JSON 里是转义形态 `D:\\a\\b`；
 * file URL 出现在语义索引与部分摘要里。
 */
export function pathVariantsPre(p) {
  const s = String(p || '')
  if (!s) return []
  const posix = s.replace(/\\/g, '/')
  const out = [s, posix, 'file:///' + posix]
  // JSON 转义形态：反斜杠翻倍（Windows 路径在 JSON 文本里长这样）
  if (s.includes('\\')) out.push(s.replace(/\\/g, '\\\\'))
  // 去重并按长度降序（先替换长的，避免短形态抢先命中留下残渣）
  return Array.from(new Set(out)).filter(Boolean).sort((a, b) => b.length - a.length)
}

/**
 * 文本级路径重写（纯函数）。**这是导入时唯一会改动用户正文的地方**，故：
 *   - 逐形态替换，长形态优先
 *   - 返回 `hits`（改了多少处）供预览逐文件展示，用户能看见改在哪
 *   - 不做正则/模糊匹配（避免误伤），只做**字面量**替换
 *
 * @param {string} text
 * @param {{fromPath:string, toPath:string, fromSlug?:string, toSlug?:string}} opt
 * @returns {{text:string, hits:number}}
 */
export function rewritePathsInTextPre(text, opt = {}) {
  let s = String(text == null ? '' : text)
  let hits = 0
  const fromPath = String(opt.fromPath || '')
  const toPath = String(opt.toPath || '')
  if (fromPath && toPath && fromPath !== toPath) {
    const toVariants = pathVariantsPre(toPath)
    const fromVariants = pathVariantsPre(fromPath)
    // 建立「同形态 → 同形态」映射：Windows 原形对 Windows 原形、posix 对 posix …
    // 简化为按索引对齐（pathVariantsPre 的排序对两者一致，因为只是斜杠方向不同）
    for (let i = 0; i < fromVariants.length; i++) {
      const fv = fromVariants[i]
      const tv = toVariants[i] !== undefined ? toVariants[i] : toPath
      if (!fv || fv === tv) continue
      const before = s
      s = s.split(fv).join(tv)
      if (s !== before) hits += countOccurrencesPre(before, fv)
    }
  }
  const fromSlug = String(opt.fromSlug || '')
  const toSlug = String(opt.toSlug || '')
  if (fromSlug && toSlug && fromSlug !== toSlug) {
    const before = s
    s = s.split(fromSlug).join(toSlug)
    if (s !== before) hits += countOccurrencesPre(before, fromSlug)
  }
  return { text: s, hits }
}

/** 字面量子串出现次数（不用正则，避免特殊字符）。 */
export function countOccurrencesPre(hay, needle) {
  if (!needle) return 0
  let n = 0, i = 0
  for (;;) {
    const p = String(hay).indexOf(needle, i)
    if (p < 0) return n
    n++
    i = p + needle.length
  }
}

// ───────────────────────── 校验和 ─────────────────────────

/**
 * 包内容摘要（纯函数）。**规范化**：按路径排序后逐条喂入，保证同一内容在任何机器上
 * 得到同一个值（否则跨机校验永远失败）。
 * 用 `\u0000` 作字段分隔（路径/内容里不会出现的字符），避免拼接歧义（如 a|b 与 a、b）。
 */
export function packChecksumPre(files) {
  const names = Object.keys(files || {}).sort()
  const h = createHash(MIGRATE_PACK_CHECKSUM_ALGO_PRE)
  for (const n of names) {
    h.update(n)
    h.update('\u0000')
    h.update(String(files[n]))
    h.update('\u0000')
  }
  return h.digest('hex')
}

// ───────────────────────── 打包（纯函数）─────────────────────────

/**
 * 构造一个迁移包对象（**不写盘**）。
 * @param {{ws:string, files:Object<string,string>, summaryRecord?:object,
 *          pluginVersion?:string, now?:number, sourceHost?:string}} opt
 * @returns {{ok:boolean, error?:string, pack?:object, warnings:string[]}}
 */
export function buildPackPre(opt = {}) {
  const warnings = []
  const ws = String(opt.ws || '')
  const files = opt.files && typeof opt.files === 'object' ? opt.files : {}
  if (!ws) return { ok: false, error: 'missing-source-ws', warnings }
  const names = Object.keys(files)
  if (!names.length) return { ok: false, error: 'no-files', warnings }
  if (names.length > MIGRATE_PACK_MAX_FILES_PRE) return { ok: false, error: 'too-many-files:' + names.length, warnings }
  let bytes = 0
  for (const n of names) {
    if (n.includes('..') || n.startsWith('/') || n.startsWith('\\')) {
      return { ok: false, error: 'unsafe-relative-path:' + n, warnings }
    }
    bytes += Buffer.byteLength(String(files[n]), 'utf8')
  }
  if (bytes > MIGRATE_PACK_MAX_BYTES_PRE) return { ok: false, error: 'too-large:' + bytes, warnings }
  // 体积提示（不阻断）：超过 16 MB 时提醒用户包会很大
  if (bytes > 16 * 1024 * 1024) warnings.push('pack-large:' + Math.round(bytes / 1048576) + 'MB')
  const pack = {
    format: MIGRATE_PACK_FORMAT_PRE,
    createdAt: typeof opt.now === 'number' ? opt.now : Date.now(),
    source: { ws, slug: workspaceSlugPre(ws), host: String(opt.sourceHost || '') },
    runtime: { pluginVersion: String(opt.pluginVersion || '') },
    summaryRecord: opt.summaryRecord && typeof opt.summaryRecord === 'object' ? opt.summaryRecord : null,
    files,
    stats: { fileCount: names.length, bytes },
    checksum: { algo: MIGRATE_PACK_CHECKSUM_ALGO_PRE, value: packChecksumPre(files) },
  }
  return { ok: true, pack, warnings }
}

/**
 * 校验一个已解析的包对象（纯函数，不抛）。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validatePackPre(pack) {
  const errors = []
  const warnings = []
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['not-an-object'], warnings }
  if (pack.format !== MIGRATE_PACK_FORMAT_PRE) errors.push('unknown-format:' + String(pack.format))
  if (!pack.source || typeof pack.source.ws !== 'string' || !pack.source.ws) errors.push('missing-source-ws')
  if (!pack.files || typeof pack.files !== 'object') errors.push('missing-files')
  else {
    const n = Object.keys(pack.files).length
    if (!n) errors.push('empty-files')
    if (n > MIGRATE_PACK_MAX_FILES_PRE) errors.push('too-many-files:' + n)
    for (const k of Object.keys(pack.files)) {
      if (k.includes('..') || k.startsWith('/') || k.startsWith('\\')) { errors.push('unsafe-relative-path:' + k); break }
    }
  }
  if (!errors.length) {
    const want = pack.checksum && pack.checksum.value
    const got = packChecksumPre(pack.files)
    if (!want) errors.push('missing-checksum')
    else if (String(want) !== got) errors.push('checksum-mismatch')
  }
  if (!errors.length && pack.stats) {
    const real = Object.keys(pack.files).length
    if (pack.stats.fileCount !== undefined && pack.stats.fileCount !== real) warnings.push('stats-filecount-drift')
  }
  return { ok: errors.length === 0, errors, warnings }
}

// ───────────────────────── 目标重写（纯函数）─────────────────────────

/**
 * 把包内容重写到目标工作区（纯函数，不写盘）。
 *
 * 路径相同时**不做任何替换**（避免误改用户正文）——这是架构里的「情形 A」；
 * 路径不同时才逐文件重写并回报 hits（供预览逐条展示）。
 *
 * @param {object} pack
 * @param {{targetWs:string, rewriteBody?:boolean}} opt
 *        `rewriteBody !== false` ⇒ 连正文一起改（用户拍板：需要重写，避免 B 机死链）
 * @returns {{files:Object, plan:{pathChanged:boolean, rewriteFiles:Array, totalHits:number}}}
 */
export function rewritePackForTargetPre(pack, opt = {}) {
  const files = pack && pack.files ? pack.files : {}
  const fromPath = String((pack && pack.source && pack.source.ws) || '')
  const toPath = String(opt.targetWs || '')
  const fromSlug = workspaceSlugPre(fromPath)
  const toSlug = workspaceSlugPre(toPath)
  const pathChanged = !!toPath && (fromPath !== toPath || fromSlug !== toSlug)
  const rewriteBody = opt.rewriteBody !== false
  const out = {}
  const rewriteFiles = []
  let totalHits = 0
  for (const name of Object.keys(files)) {
    const raw = String(files[name])
    if (!pathChanged || !rewriteBody) { out[name] = raw; continue }
    const r = rewritePathsInTextPre(raw, { fromPath, toPath, fromSlug, toSlug })
    out[name] = r.text
    if (r.hits > 0) { rewriteFiles.push({ path: name, hits: r.hits }); totalHits += r.hits }
  }
  rewriteFiles.sort((a, b) => b.hits - a.hits)
  return { files: out, plan: { pathChanged, fromPath, toPath, fromSlug, toSlug, rewriteFiles, totalHits } }
}

// ───────────────────────── 预览计划（纯函数）─────────────────────────

/**
 * 计算「导入将要发生什么」（纯函数）—— **这是唯一能算出差异的地方**，
 * import 只接受这里产出的 plan（防 TOCTOU），且预览必须能逐条列出覆盖项。
 *
 * @param {object} pack           已校验通过的包
 * @param {{targetWs:string, existingFiles?:Object<string,string>, rewriteBody?:boolean,
 *          onConflict?:'keep'|'overwrite'|'rename'}} opt
 *        `existingFiles` = 目标目录现有文件（宿主负责读），用于算新增/覆盖
 */
export function planImportPre(pack, opt = {}) {
  const { files, plan: rw } = rewritePackForTargetPre(pack, opt)
  const targetWs = String(opt.targetWs || '')
  const targetSlug = workspaceSlugPre(targetWs)
  const onConflict = ['keep', 'overwrite', 'rename'].includes(opt.onConflict) ? opt.onConflict : 'keep'
  const existing = opt.existingFiles && typeof opt.existingFiles === 'object' ? opt.existingFiles : {}
  const additions = []
  const overwrites = []
  const replaced = {}   // 实际会写入的文件（含改名后的键）
  for (const name of Object.keys(files)) {
    const next = String(files[name])
    const has = Object.prototype.hasOwnProperty.call(existing, name)
    if (!has) { additions.push({ path: name, bytes: Buffer.byteLength(next, 'utf8') }); replaced[name] = next; continue }
    const old = String(existing[name])
    if (old === next) { replaced[name] = next; continue }           // 内容相同 ⇒ 无需改动，不算覆盖
    if (onConflict === 'keep') { continue }                          // 默认保留 B 机 ⇒ 不写
    if (onConflict === 'overwrite') {
      overwrites.push({ path: name, oldBytes: Buffer.byteLength(old, 'utf8'), newBytes: Buffer.byteLength(next, 'utf8') })
      replaced[name] = next
      continue
    }
    // rename：A 机的版本改名为 <名字>.from-pack，B 机原文件保持不动
    const alt = renameForConflictPre(name)
    additions.push({ path: alt, bytes: Buffer.byteLength(next, 'utf8'), renamedFrom: name })
    replaced[alt] = next
  }
  const warnings = []
  if (rw.pathChanged) warnings.push('path-changed')
  else warnings.push('same-path')
  if (!Object.keys(replaced).length) warnings.push('nothing-to-write')
  return {
    ok: true,
    format: pack.format,
    source: { ws: pack.source.ws, slug: pack.source.slug },
    target: { ws: targetWs, slug: targetSlug },
    pathChanged: rw.pathChanged,
    fromPath: rw.fromPath,
    toPath: rw.toPath,
    onConflict,
    additions: additions.sort((a, b) => a.path.localeCompare(b.path)),
    overwrites: overwrites.sort((a, b) => a.path.localeCompare(b.path)),
    rewrite: { totalHits: rw.totalHits, files: rw.rewriteFiles.slice(0, 50), fileCount: rw.rewriteFiles.length },
    writeFiles: replaced,
    stats: { willWrite: Object.keys(replaced).length, total: Object.keys(files).length, bytes: pack.stats ? pack.stats.bytes : 0 },
    warnings,
  }
}

/** 冲突改名：`handoff/PLAN.md` → `handoff/PLAN.from-pack.md`（保留扩展名）。 */
export function renameForConflictPre(relPath) {
  const s = String(relPath)
  const i = s.lastIndexOf('.')
  const j = s.lastIndexOf('/')
  if (i > j && i > 0) return s.slice(0, i) + '.from-pack' + s.slice(i)
  return s + '.from-pack'
}

// ───────────────────────── 全局记录合并（纯函数）─────────────────────────

/**
 * 把包内的 summaryRecord 合并进目标机的 workspaces-summary.json（**merge 不 replace**）。
 * ★实测该文件有 7 条记录（含其它工作区）⇒ 整体覆盖会丢别人的。
 *
 * @param {object} summary  目标机现有 summary（可能为 null）
 * @param {object} record   包内记录（可能为 null）
 * @param {string} targetWs 目标真实路径
 * @returns {{summary:object, changed:boolean, action:'appended'|'updated'|'noop'}}
 */
export function mergeSummaryRecordPre(summary, record, targetWs) {
  const base = summary && typeof summary === 'object' ? summary : {}
  const list = Array.isArray(base.workspaces) ? base.workspaces.slice() : []
  const now = Date.now()
  if (!record || typeof record !== 'object') {
    return { summary: Object.assign({}, base, { workspaces: list, generatedAt: base.generatedAt || now }), changed: false, action: 'noop' }
  }
  const next = Object.assign({}, record, { path: targetWs, name: basenamePre(targetWs) })
  const i = list.findIndex((x) => x && x.path === targetWs)
  if (i >= 0) {
    // 同路径：保留目标机已有的 items（更可能是较新的），但把 A 机的补进来（去重）
    const old = list[i] || {}
    const items = dedupeStringsPre([].concat(old.items || [], next.items || []))
    list[i] = Object.assign({}, old, next, { items, dateRange: old.dateRange || next.dateRange })
    return { summary: Object.assign({}, base, { workspaces: list, generatedAt: now }), changed: true, action: 'updated' }
  }
  list.push(next)
  return { summary: Object.assign({}, base, { workspaces: list, generatedAt: now }), changed: true, action: 'appended' }
}

/** 去重（保持顺序，字面量比对）。 */
export function dedupeStringsPre(arr) {
  const seen = new Set()
  const out = []
  for (const x of arr || []) {
    const s = String(x == null ? '' : x)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** 取路径最后一段（不引 node:path，保持本模块可被纯逻辑测试）。 */
export function basenamePre(p) {
  const s = String(p || '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}
