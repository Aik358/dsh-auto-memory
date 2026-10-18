import { calendarFieldEncodePre, calendarFieldDecodePre, calendarQuadrantPre } from './calendar-fields.js'
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
/** v1 载荷：只覆盖 `files`（历史包全用这个值；缺省也按它解释）。 */
export const MIGRATE_PACK_CHECKSUM_ALGO_PRE = 'sha256'
/**
 * ★2026-10-17（#438）：**覆盖 userFiles 的 v2 载荷**。
 *
 * 为什么必须新增而不是改 v1：v1 的摘要只喂 `files`，于是篡改 `userFiles['CALENDAR.md']`
 * 后 checksum 与原包**完全相等**（实测），而那一行会被 `calendarMergePre` 真的并入本机日历。
 * 但 v1 包在野（用户机器上已有），改 v1 的算法会让**所有历史包**判为 checksum-mismatch
 * ⇒ 兼容判据必须写在 `checksum.algo` 上，由 algo 决定"这次要比几个清单"。
 * **不改 `format`**：新增格式名会让新包与旧版本互斥（旧的读不了新的）。
 */
export const MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE = 'sha256+userFiles-v2'
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
 *   - 只做**字面量**替换：路径全部转义，不解释为正则/模糊模式
 *
 * @param {string} text
 * @param {{fromPath:string, toPath:string, fromSlug?:string, toSlug?:string}} opt
 * @returns {{text:string, hits:number}}
 */
export function rewritePathsInTextPre(text, opt = {}) {
  const s = String(text == null ? '' : text)
  let hits = 0
  const pairs = new Map()
  const add = (from, to) => { if (from && !pairs.has(from)) pairs.set(from, to) }
  const fromPath = String(opt.fromPath || '')
  const toPath = String(opt.toPath || '')
  if (fromPath && toPath && fromPath !== toPath) {
    const fromPosix = fromPath.replace(/\\/g, '/')
    const toPosix = toPath.replace(/\\/g, '/')
    // 按形态配对，不能分别按长度排序后用下标配对：路径深度会改变排序。
    add(fromPath, toPath)
    add(fromPosix, toPosix)
    add('file:///' + fromPosix, 'file:///' + toPosix)
    if (fromPath.includes('\\')) add(fromPath.replace(/\\/g, '\\\\'), toPath.replace(/\\/g, '\\\\'))
  }
  const fromSlug = String(opt.fromSlug || '')
  const toSlug = String(opt.toSlug || '')
  if (fromSlug && toSlug && fromSlug !== toSlug) add(fromSlug, toSlug)
  if (!pairs.size) return { text: s, hits }
  // 只扫描原文一次；新路径可能包含旧路径/slug，不能再次替换刚插入的文本。
  // 转义所有元字符，正则仅用于一次性匹配字面量；回调也保护目标中的 $&/$1。
  const pattern = Array.from(pairs.keys()).sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const rewritten = s.replace(new RegExp(pattern, 'g'), (match) => {
    const replacement = pairs.get(match)
    if (replacement !== match) hits++
    return replacement
  })
  return { text: rewritten, hits }
}

// 批次 X(拆取自 PR#212 claim 4):JSON/JSONL 文件的路径重写。
// 先解码字符串 token、重写、再重编码——绕开「替换值含裸反斜杠(Windows 路径)直接落进
// JSON 字符串 ⇒ \t/\n 等非法转义损坏文件」的坑。逐行 JSON.parse 先行验证(含 JSONL 逐行,
// 空行跳过校验但原样保留),任何一行非法即抛错,fail closed;未触及的 token 字面
// (空白、转义写法、数值)原样保留。
function rewriteJsonPathsPre(raw, options, jsonl) {
  for (const text of jsonl ? raw.split(/\r?\n/).filter(s => s.trim()) : [raw]) JSON.parse(text)
  let hits = 0
  const text = raw.replace(/"(?:\\.|[^"\\])*"/g, token => {
    const result = rewritePathsInTextPre(JSON.parse(token), options)
    hits += result.hits
    return result.hits ? JSON.stringify(result.text) : token
  })
  return { text, hits }
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
 *
 * ★2026-10-17（#438）：第二个参数 `userFiles` 从"收下但不用"改为**真的参与摘要**，
 * 且两本清单用 **`F` / `U` 命名空间前缀**分开（否则 `files['a']` 与 `userFiles['a']`
 * 同内容会得到同一段喂入字节，跨清单搬家不可检测）。哈希算法**恒为 sha256**
 * —— algo 只描述"覆盖范围"，不是"用哪种哈希"（旧实现 algo 只写不读，改 algo 即可冒充旧包）。
 *
 * 兼容红线：`userFiles` 缺省/为空 ⇒ 输出与旧实现**逐字节相同**（v1 包的摘要不变）。
 *
 * @param {Object<string,string>} files     相对工作区 slug 目录
 * @param {Object<string,string>|null} [userFiles] 相对用户级 memory 目录
 */
export function packChecksumPre(files, userFiles = null) {
  const h = createHash(MIGRATE_PACK_CHECKSUM_ALGO_PRE)
  const names = Object.keys(files || {}).sort()
  const uf = userFiles && typeof userFiles === 'object' ? userFiles : null
  const uNames = uf ? Object.keys(uf).sort() : []
  // ★兼容红线（2026-10-17 · #438）：**无 userFiles ⇒ 完整走旧喂法**（无命名空间前缀），
  //   保证历史 v1 包的摘要逐字节不变 —— 否则所有在野的旧包都会被判 checksum-mismatch。
  if (!uNames.length) {
    for (const n of names) {
      h.update(n)
      h.update('\u0000')
      h.update(String(files[n]))
      h.update('\u0000')
    }
    return h.digest('hex')
  }
  // v2：两本清单各带命名空间前缀（'F' / 'U'），否则 files['a'] 与 userFiles['a']
  // 同内容会喂出同一段字节 ⇒ 跨清单搬家不可检测。命名空间与路径之间仍用 \u0000 分隔。
  const feed = (namespace, map, keys) => {
    for (const n of keys) {
      h.update(namespace)
      h.update('\u0000')
      h.update(n)
      h.update('\u0000')
      h.update(String(map[n]))
      h.update('\u0000')
    }
  }
  feed('F', files, names)
  feed('U', uf, uNames)
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
  // ★v3.1.3：用户级文件（如 `CALENDAR.md`）—— 与 `files` 的语义区别：
  //   files 相对「工作区 slug 目录」，userFiles 相对「用户级 memory 目录」，且**跨工作区共享**。
  //   老包无此字段 ⇒ 视为 {}，行为逐字节不变（向后兼容）。
  const userFiles = (opt.userFiles && typeof opt.userFiles === 'object') ? opt.userFiles : {}
  let userBytes = 0
  for (const n of Object.keys(userFiles)) {
    if (n.includes('..') || n.startsWith('/') || n.startsWith('\\')) {
      return { ok: false, error: 'unsafe-user-relative-path:' + n, warnings }
    }
    userBytes += Buffer.byteLength(String(userFiles[n]), 'utf8')
  }
  const pack = {
    format: MIGRATE_PACK_FORMAT_PRE,
    createdAt: typeof opt.now === 'number' ? opt.now : Date.now(),
    source: { ws, slug: workspaceSlugPre(ws), host: String(opt.sourceHost || '') },
    runtime: { pluginVersion: String(opt.pluginVersion || '') },
    summaryRecord: opt.summaryRecord && typeof opt.summaryRecord === 'object' ? opt.summaryRecord : null,
    files,
    userFiles,
    stats: { fileCount: names.length, bytes, userFileCount: Object.keys(userFiles).length, userBytes },
    // ★2026-10-17（#438）：**仅当确实有 userFiles 时才升级 algo**。
    //   无 userFiles 的包 checksum/checksum.algo 与旧版**逐字节相同**（老包能互认）。
    checksum: Object.keys(userFiles).length
      ? { algo: MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE, value: packChecksumPre(files, userFiles) }
      : { algo: MIGRATE_PACK_CHECKSUM_ALGO_PRE, value: packChecksumPre(files) },
  }
  return { ok: true, pack, warnings }
}

/**
 * 校验一个已解析的包对象（纯函数，不抛）。
 * @returns {{ok:boolean, errors:string[], warnings:string[]}}
 */
export function validatePackPre(pack, opts) {
  const o = (opts && typeof opts === 'object') ? opts : {}
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
  // ★v3.1.3：userFiles 与 files 受**同等**安全检查（路径穿越）；老包无该字段直接通过。
  if (!errors.length && pack.userFiles && typeof pack.userFiles === 'object') {
    for (const k of Object.keys(pack.userFiles)) {
      if (k.includes('..') || k.startsWith('/') || k.startsWith('\\')) { errors.push('unsafe-user-relative-path:' + k); break }
      if (typeof pack.userFiles[k] !== 'string') { errors.push('non-text-user-file:' + k); break }
    }
  }
  if (!errors.length) {
    const want = pack.checksum && pack.checksum.value
    // ★2026-10-17（#438）：兼容判据写在 **algo** 上（不靠猜、不改 format）。
    //   v1（缺省 / 'sha256'）：历史包只覆盖 files —— 但若包里带了 userFiles，
    //     就等于「有内容没有任何完整性保护」，且它会被 calendarMergePre 真的并入本机日历
    //     ⇒ **fail closed 拒收**（D2 决策），绝不降级成 warning。
    //   v2：双清单校验。
    //   其它 algo：未知载荷 ⇒ 拒（不能拿没见过的算法假装校验通过）。
    const algo = pack.checksum && pack.checksum.algo
    const rawAlgo = algo == null ? '' : String(algo)
    const algoV1 = rawAlgo === '' || rawAlgo === MIGRATE_PACK_CHECKSUM_ALGO_PRE
    const algoV2 = rawAlgo === MIGRATE_PACK_CHECKSUM_ALGO_V2_PRE
    const userFiles = (pack.userFiles && typeof pack.userFiles === 'object') ? pack.userFiles : null
    const hasUserFiles = !!userFiles && Object.keys(userFiles).length > 0
    if (!want) errors.push('missing-checksum')
    else if (!algoV1 && !algoV2) errors.push('unknown-checksum-algo:' + rawAlgo)
    else if (algoV1 && hasUserFiles && o.allowUnprovenUserFiles !== true) {
      // ★#449-1（2026-10-18 回归修复）：**不要无条件拒**。
      //   历史事实：userFiles 自 v3.1.3 就在包里，而 `sha256+userFiles-v2` 算法自 v3.3.5 才引入
      //   ⇒ 3.1.3–3.3.4 产出的**所有含日历的历史包**都命中这条守卫，等于把在野历史包全判死
      //   （#438 的修法扩大了打击面）。现改为：
      //     · 默认仍拒（fail closed，不静默导入未校验的日历）；
      //     · 调用方显式传 allowUnprovenUserFiles=true ⇒ 仍按 v1 口径校验 files，
      //       校验通过才放行，并追加 warning 留痕（让用户知道日历未被摘要保护）。
      errors.push('userfiles-unproven-by-checksum')
    }
    else if (algoV1 && hasUserFiles) {
      // 显式确认通道：安全意图不变（files 仍必须校验通过），只是不再因「算法版本落后」而一刀切拒绝。
      const got = packChecksumPre(pack.files)
      if (String(want) !== got) errors.push('checksum-mismatch')
      else warnings.push('userfiles-unproven-by-checksum-accepted:' + Object.keys(userFiles).length)
    }
    else {
      const got = algoV2 ? packChecksumPre(pack.files, userFiles) : packChecksumPre(pack.files)
      if (String(want) !== got) errors.push('checksum-mismatch')
    }
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
    const options = { fromPath, toPath, fromSlug, toSlug }
    // .json/.jsonl 走 token 级重写(防裸反斜杠非法转义);其余文本保持逐字面替换。
    const r = /\.jsonl?$/i.test(name)
      ? rewriteJsonPathsPre(raw, options, /\.jsonl$/i.test(name))
      : rewritePathsInTextPre(raw, options)
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
  // ★2026-10-17（#425）：**祖先占用判据**（纯函数、零 IO —— 不破 S10「引擎不碰磁盘」）。
  //
  //   缺陷：目标里预先存在一个**目录链接**（junction/symlink → 记忆根外）时，只要包里带了
  //   `<那个目录>/新文件`，写入链就会 `mkdir(dirname)` + 原子写 —— mkdir 对已存在的链接是
  //   no-op，于是文件被写到**链接指向的根外目录**。而 catalog 里该链接只记成 `unsupported`，
  //   `existing` 里没有它的子路径键 ⇒ 计划判成 additions ⇒ 一路放行。
  //
  //   判据：对待写路径的**每一级祖先**查 `existing`；若祖先是
  //     · `link-outside`（指向根外的目录链接）/ `unsupported`（非目录非普通文件）⇒ 阻塞
  //     · `directory-link`（指向根内的目录链接）⇒ 允许（合法内容，根内递归），
  //       但由宿主按**物理路径**写（见 index.js 的两次校验），不能词法直写。
  //   这里只判"要不要拦"，不判"能不能写"——后者需要 realpath，属宿主 IO 职责。
  const blockedByAncestor = []
  /** @returns {{kind:string, ancestor:string}|null} 第一个不可写的祖先（逐级向上查，含直接父目录） */
  const ancestorVerdict = (relPath) => {
    const parts = String(relPath).split('/').filter(Boolean)
    let acc = ''
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? acc + '/' + parts[i] : parts[i]
      const entry = existing[acc]
      if (entry === undefined) continue
      if (typeof entry === 'string' || Array.isArray(entry)) continue          // 普通文本/列表 ⇒ 不是祖先
      const kind = entry && typeof entry === 'object' ? entry.kind : undefined
      if (kind === 'directory' || kind === 'directory-link') continue          // 目录（含根内链接）⇒ 可写
      if (kind === 'link-outside' || kind === 'unsupported' || kind === 'too-large') return { kind, ancestor: acc }
      // 未知 kind（未来新增）⇒ fail closed：不能证明是目录，就不许在下层新建文件。
      return { kind: kind === undefined ? 'unknown-kind' : String(kind), ancestor: acc }
    }
    return null
  }
  const additions = []
  const overwrites = []
  const replaced = {}   // 实际会写入的文件（含改名后的键）
  // 预留本机文件与整包原始文件名，避免另存覆盖旧备份或尚未遍历的包内文件。
  const reserved = new Set([...Object.keys(existing), ...Object.keys(files)])
  for (const name of Object.keys(files)) {
    const next = String(files[name])
    // ★#425：祖先是被判为"根外链接/不可用"的条目 ⇒ 该路径**一律不写**（不因冲突策略而异）。
    //   三种冲突策略下都会走到 mkdir(父目录)，所以必须在策略分支**之前**拦。
    const ancestor = ancestorVerdict(name)
    if (ancestor) {
      if (!blockedByAncestor.some((x) => x.path === name)) {
        blockedByAncestor.push({ path: name, ancestor: ancestor.ancestor, kind: ancestor.kind })
      }
      continue
    }
    const has = Object.prototype.hasOwnProperty.call(existing, name)
    if (!has) { additions.push({ path: name, bytes: Buffer.byteLength(next, 'utf8') }); replaced[name] = next; continue }
    // 批次 X(拆取自 PR#212 claim 1):宿主清单条目可能不是正文(字符串)——
    // too-large 占位 {kind,bytes,digest} 也要能走覆盖(用真实 bytes 记账);
    // keep 语义下照旧跳过;目录/特殊文件在 overwrite 下**抛错**(绝不静默覆盖非文本目标)。
    const knownText = typeof existing[name] === 'string'
    const old = knownText ? existing[name] : null
    if (knownText && old === next) { replaced[name] = next; continue } // 宿主识别同内容并跳过实际写入
    if (onConflict === 'keep') { continue }                          // 默认保留 B 机 ⇒ 不写
    if (onConflict === 'overwrite') {
      if (!knownText && existing[name]?.kind !== 'too-large') throw new Error('unsupported-existing-target:' + name)
      overwrites.push({ path: name, oldBytes: knownText ? Buffer.byteLength(old, 'utf8') : existing[name].bytes, newBytes: Buffer.byteLength(next, 'utf8') })
      replaced[name] = next
      continue
    }
    // rename：A 机的版本改名为 <名字>.from-pack，B 机原文件保持不动
    let ordinal = 1
    let alt = renameForConflictPre(name, ordinal)
    while (reserved.has(alt)) alt = renameForConflictPre(name, ++ordinal)
    reserved.add(alt)
    additions.push({ path: alt, bytes: Buffer.byteLength(next, 'utf8'), renamedFrom: name })
    replaced[alt] = next
  }
  const warnings = []
  if (rw.pathChanged) warnings.push('path-changed')
  else warnings.push('same-path')
  if (!Object.keys(replaced).length) warnings.push('nothing-to-write')
  // ★#425：被祖先挡下时**整体不 ok**（宿主据此拒导入，而不是"少写几个文件假装成功"）。
  //   blockedByAncestor 同时作为新增可选键回传（前端 migFail 会把 errors 原样拼出）。
  if (blockedByAncestor.length) warnings.push('ancestor-blocked')
  return {
    ok: blockedByAncestor.length === 0,
    blockedByAncestor,
    errors: blockedByAncestor.map((b) => 'ancestor-not-writable:' + b.path + '(' + b.ancestor + ':' + b.kind + ')'),
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
export function renameForConflictPre(relPath, ordinal = 1) {
  const s = String(relPath)
  const suffix = '.from-pack' + (ordinal > 1 ? '-' + ordinal : '')
  const i = s.lastIndexOf('.')
  const j = s.lastIndexOf('/')
  if (i > j && i > 0) return s.slice(0, i) + suffix + s.slice(i)
  return s + suffix
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

/** Assign the same legacy occurrence identities on reads and imports. Explicit IDs
 * reserve their slots; identical legacy rows remain distinct occurrences. */
export function calendarIdentitiesPre(entries) {
  const seen = new Set(), counts = new Map()
  for (const en of entries) {
    if (!en.id) continue
    if (seen.has(en.id)) throw Object.assign(new Error('ambiguous calendar identity'), { statusCode: 409 })
    seen.add(en.id)
  }
  for (const en of entries) {
    if (en.id) continue
    const key = JSON.stringify([en.date, en.time, en.quadrant, en.title, en.note])
    let count = counts.get(key) || 0
    do { en.id = 'cal_' + createHash('sha256').update(key + '|' + count++).digest('hex').slice(0, 32) } while (seen.has(en.id))
    counts.set(key, count)
    seen.add(en.id)
  }
  return entries
}

/** 去重（保持顺序，字面量比对）。 */
/**
 * ★v3.1.3：日历条目**合并**（纯函数，不覆盖）。
 *
 * 为什么不是整篇覆盖：CALENDAR.md 在 `~/.dsh/memory/CALENDAR.md` —— **用户级、跨工作区共享**，
 *   且两台机器都可能往里写过。整篇覆盖会丢掉本机独有的条目
 *   （与 `workspaces-summary.json` 必须 merge 是同一条纪律）。
 *
 * 判据：显式 ID 优先；旧无 ID 条目按规范字段 + 同内容出现次数补稳定 ID。
 *   - 身份冲突 ⇒ **保留本机已有的**（与导入冲突默认 keep 一致；不覆盖用户已改过的状态）。
 *   - 本机没有的 ⇒ 追加进来。
 *   - 输出按 日期 → 时间 排序，保证确定性（同输入必得同输出，便于断言）。
 *
 * @param {string} localText 本机 CALENDAR.md 原文（空 ⇒ 视为空日历）
 * @param {string} incomingText 包内 CALENDAR.md 原文
 * @returns {{ok:boolean, text:string, added:number, kept:number}}
 */
export function calendarMergePre(localText, incomingText) {
  const parse = (t) => {
    const out = []
    const extras = []   // 与 out 同下标：该条目的缩进续行（trim 后）
    let curDate = ''
    let cur = -1
    for (const raw of String(t || '').split(/\r?\n/)) {
      let line = raw.trim()
      const identity = /\s*<!-- calendar-id: (cal_[0-9a-f]{32}) -->$/.exec(line)
      if (identity) line = line.slice(0, identity.index).trimEnd()
      const encodedFields = /\s*<!-- calendar-fields: escaped-v1 -->$/.exec(line)
      if (encodedFields) line = line.slice(0, encodedFields.index).trimEnd()
      if (!line) { cur = -1; continue }
      // ★#254 B'（2026-10-08）：**续行识别与 index.parseCalendar 同口径**（本文件 412-413 行
      //   自己写下的纪律：「两处正则必须同口径」，否则会出现「主路径认、迁移路径丢」的半修）。
      //   判据：以空格/Tab 开头且紧跟条目行 ⇒ 该条目的备注续行；空行/标题行/其它行终止续行段。
      if (cur >= 0 && /^[ \t]/.test(raw)) { extras[cur].push(line); continue }
      const dm = line.match(/^## (\d{4}-\d{2}-\d{2})/)
      if (dm) { curDate = dm[1]; cur = -1; continue }
      // ★ 2026-10-02 审计修复批 issue #182/F06：#182 同款正则——`--:--`（日期待定的合法条目）
      //   在迁移导入时会被静默跳过，下一次整篇覆写即物理删除。两处正则（此处与 index.parseCalendar）必须同口径。
      const m = line.match(/^- \[([ xX])\] (\d{1,2}:\d{2}|--:--) \| ([^|]+?) \| (.+?)(?: \| (.*))?$/)
      if (m) {
        out.push({ date: curDate, done: m[1] !== ' ', time: m[2], quadrant: calendarQuadrantPre(m[3]), title: encodedFields ? calendarFieldDecodePre(m[4].trim()) : m[4].trim(), note: encodedFields ? calendarFieldDecodePre((m[5] || '').trim()) : (m[5] || '').trim() })
        if (identity) out[out.length - 1].id = identity[1]
        extras.push([])
        cur = out.length - 1
        continue
      }
      cur = -1
    }
    for (let i = 0; i < out.length; i++) {
      if (!extras[i].length) continue
      out[i].note = (out[i].note ? out[i].note + '\n' : '') + extras[i].join('\n')
    }
    return out
  }
  const keyOf = (en) => en.id
  const local = calendarIdentitiesPre(parse(localText).filter((en) => en.date))
  const incoming = calendarIdentitiesPre(parse(incomingText).filter((en) => en.date))
  const seen = new Set(local.map(keyOf))
  const merged = local.slice()
  let added = 0
  for (const en of incoming) {
    const k = keyOf(en)
    if (seen.has(k)) continue
    seen.add(k)
    merged.push(en)
    added++
  }
  calendarIdentitiesPre(merged)
  const byDate = new Map()
  for (const en of merged) {
    if (!byDate.has(en.date)) byDate.set(en.date, [])
    byDate.get(en.date).push(en)
  }
  const lines = ['# 日历与日程 (CALENDAR)', '', '> 由 dsh-auto-memory 维护;AI 可从对话中提取 deadline/约定写入,用户也可在 GUI 操作。', '']
  for (const date of Array.from(byDate.keys()).sort()) {
    lines.push('## ' + date)
    for (const en of byDate.get(date).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))) {
      const mark = en.done ? 'x' : ' '
      // ★#254 B'：这是同一条缺陷的**第二个出口** —— 旧实现在这里把 note 拼回单行，
      //   于是「迁入的多行备注」会在合并输出时被压平（行数与内容都变）。改为与 index.renderCalendar 同款缩进续行。
      const parts = en.note ? String(en.note).split('\n') : []
      const note = parts.length ? ' | ' + calendarFieldEncodePre(parts[0]) : ''
      lines.push('- [' + mark + '] ' + (en.time || '--:--') + ' | ' + (en.quadrant || '未分类') + ' | ' + calendarFieldEncodePre(en.title) + note + ((calendarFieldEncodePre(en.title) !== en.title || (parts.length && calendarFieldEncodePre(parts[0]) !== parts[0])) ? ' <!-- calendar-fields: escaped-v1 -->' : '') + (en.id ? ' <!-- calendar-id: ' + en.id + ' -->' : ''))
      for (let i = 1; i < parts.length; i++) lines.push('    ' + parts[i])
    }
    lines.push('')
  }
  return { ok: true, text: lines.join('\n'), added, kept: local.length }
}

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
