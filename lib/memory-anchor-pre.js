/**
 * Anchor/Sidecar/Dry-run Planner — M3b-1(系统地图 M-06 契约 + docs/M3B-CONTRACT.md §3-§7)。
 * 只读分析层:解析独占行 anchor、构建/校验 sidecar、生成 dry-run 迁移计划。
 * 不修改任何 Markdown,不接入真实写路径(写入事务属 M3b-2)。
 *
 * anchor 格式(契约 §3):
 *   memoryId = mem_<32 lowercase hex>   (首次随机分配后永久稳定,禁止由内容/digest/路径/行号派生)
 *   anchorId = memory:<memoryId>
 *   marker   = <!-- memory:<memoryId> -->   (独占一行,置于记录内容之前)
 *
 * 解析状态(契约 §5):anchored / legacy / orphan-anchor / duplicate-anchor /
 *   malformed-anchor / orphan-content。duplicate/malformed/orphan 一律 conflict(fail closed),
 *   写入闸门与迁移 planner 必须拒绝,不得静默重编号。
 * legacy 段按 heading 行切块,每块是将来一个 insert-anchor 的迁移目标
 * (契约 §7:"非空 preamble 形成一个 legacy 记录;每个旧 heading block 形成一个记录")。
 *
 * 字节语义与 M3a 一致:UTF-8 半开区间 [byteStart,byteEnd),多字节按字节计数;
 * anchored 记录内容 = marker 行之后到下一 marker 行首之间的非空内容(首尾空行不纳入),
 * 不含 marker 本身(契约 §4:byteStart/byteEnd 与 recordDigest 只覆盖记录内容)。
 */
import { createHash, randomUUID } from 'node:crypto'
import { splitByteLines, INDEX_MAX_FILE_BYTES } from './memory-index-pre.js'

export const SIDECAR_SCHEMA_VERSION = 1
export const SIDECAR_NAMESPACE = 'dsh-auto-memory-pre'
export const ANCHOR_PREFIX = 'memory:'
export const MEMORY_ID_RE = /^mem_[0-9a-f]{32}$/
export const MARKER_RE = /^<!-- memory:(mem_[0-9a-f]{32}) -->$/
const MARKER_OPEN = '<!-- memory:'
const HEADING_RE = /^#{1,6}\s/
const HEX64_RE = /^[0-9a-f]{64}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** 分配新 memoryId:mem_ + 32 位小写 hex(默认随机 UUID 去连字符;rnd 仅测试注入)。 */
export function newMemoryId(rnd) {
  return 'mem_' + (rnd || randomUUID().replace(/-/g, ''))
}

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** 换行风格统计:'lf' / 'crlf' / 'mixed'(无任何换行视为 'lf')。 */
function detectNewline(buf) {
  let crlf = 0
  let lf = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      if (i > 0 && buf[i - 1] === 0x0d) crlf++
      else lf++
    }
  }
  if (crlf > 0 && lf > 0) return 'mixed'
  if (crlf > 0) return 'crlf'
  return 'lf'
}

/** 统计 UTF-8 字节区间的字符数(与 M3a buildIndex 同一算法)。 */
function countChars(buf, s, e) {
  let chars = 0
  for (let i = s; i < e;) {
    const c = buf.readUInt8(i)
    i += c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4
    chars += 1
  }
  return chars
}

function headingOf(text) {
  if (!HEADING_RE.test(text)) return null
  return text.replace(/^#{1,6}\s*/, '').trim()
}

/**
 * 解析 Markdown 为 anchor 记录流。
 * @param {Buffer|string} buf
 * @returns {{bom:boolean,newline:'lf'|'crlf'|'mixed',records:Array<object>,conflicts:Array<object>,status:'clean'|'conflict'}}
 *   records:kind='anchored'|'legacy';anchored 带 memoryId/anchorId/anchorLine;
 *   legacy 带 position:'preamble'|'interstitial'|'tail'(对 planner 无差别,仅信息)。
 *   conflicts:[{type,line,byteStart,byteEnd,memoryId?,detail}]。
 */
export function parseAnchors(buf) {
  const input = Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf), 'utf8')
  // 超限防御与 M3a 一致:避免同步全量解析/哈希阻塞,超大文件由调用方决定拆分迁移。
  if (input.length > INDEX_MAX_FILE_BYTES) {
    return { bom: false, newline: 'lf', records: [], conflicts: [], status: 'oversized', oversized: true }
  }
  const bom = input.length >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
  const b = bom ? input.subarray(3) : input
  // splitByteLines 行号 = 数组下标+1,此处补齐显式 lineNumber 供 locator 使用
  const lines = splitByteLines(b).map((l, i) => ({ start: l.start, end: l.end, text: l.text, lineNumber: i + 1 }))
  const newline = detectNewline(b)
  const records = []
  const conflicts = []
  const seenIds = new Map()
  let cur = null // 当前 anchored 段:{anchorLine,markerStart,markerEnd,memoryId,anchorId,lines:[]}
  let legacyLines = [] // 当前 legacy 段原始行(含空行),段结束时按 heading 切块
  let sawAnchored = false

  const finalizeAnchored = () => {
    if (!cur) return
    // 空内容 → orphan-anchor(空记录无意义,fail closed)
    let first = -1
    let last = -1
    for (let i = 0; i < cur.lines.length; i++) {
      if (cur.lines[i].text.trim() !== '') { if (first === -1) first = i; last = i }
    }
    if (first === -1) {
      conflicts.push({ type: 'orphan-anchor', line: cur.anchorLine, byteStart: cur.markerStart, byteEnd: cur.markerEnd, memoryId: cur.memoryId, detail: 'marker 无任何内容' })
      cur = null
      return
    }
    const l0 = cur.lines[first]
    const l1 = cur.lines[last]
    const byteStart = l0.start
    const byteEnd = l1.end
    records.push({
      kind: 'anchored',
      memoryId: cur.memoryId,
      anchorId: cur.anchorId,
      anchorLine: cur.anchorLine,
      markerByteStart: cur.markerStart,
      markerByteEnd: cur.markerEnd,
      heading: headingOf(l0.text),
      lineStart: l0.lineNumber,
      lineEnd: l1.lineNumber,
      byteStart,
      byteEnd,
      bytes: byteEnd - byteStart,
      chars: countChars(b, byteStart, byteEnd),
      recordDigest: sha256Hex(b.subarray(byteStart, byteEnd)),
    })
    cur = null
  }

  /** legacy 段切块:段内首个 heading 之前的非空内容=块1(heading:null),之后每个 heading 行起一块。 */
  const flushLegacy = (position) => {
    if (!legacyLines.length) return
    let first = -1
    let last = -1
    for (let i = 0; i < legacyLines.length; i++) {
      if (legacyLines[i].text.trim() !== '') { if (first === -1) first = i; last = i }
    }
    if (first !== -1) {
      let blk = null
      for (let i = first; i <= last; i++) {
        const ln = legacyLines[i]
        if (HEADING_RE.test(ln.text)) {
          if (blk) records.push(finishLegacyBlock(b, blk, position))
          blk = { heading: headingOf(ln.text), first: ln, last: ln }
        } else if (blk) {
          blk.last = ln
        } else {
          blk = { heading: null, first: ln, last: ln }
        }
      }
      if (blk) records.push(finishLegacyBlock(b, blk, position))
    }
    legacyLines = []
  }

  for (const ln of lines) {
    if (MARKER_RE.test(ln.text)) {
      // 边界:切换段
      finalizeAnchored()
      flushLegacy(sawAnchored ? 'interstitial' : 'preamble')
      const memoryId = MARKER_RE.exec(ln.text)[1]
      const prevLine = seenIds.has(memoryId) ? seenIds.get(memoryId) : null
      seenIds.set(memoryId, ln.lineNumber)
      if (prevLine) {
        conflicts.push({ type: 'duplicate-anchor', line: ln.lineNumber, byteStart: ln.start, byteEnd: ln.end, memoryId, detail: 'memoryId 重复,先前出现于行 ' + prevLine })
      }
      cur = { anchorLine: ln.lineNumber, markerStart: ln.start, markerEnd: ln.end, memoryId, anchorId: ANCHOR_PREFIX + memoryId, lines: [] }
      sawAnchored = true
      continue
    }
    if (ln.text.startsWith(MARKER_OPEN)) {
      // 行首疑似 marker 但整行非法(ID 格式错/内容残缺)
      conflicts.push({ type: 'malformed-anchor', line: ln.lineNumber, byteStart: ln.start, byteEnd: ln.end, detail: '非法的 anchor marker 行: ' + ln.text.slice(0, 60) })
      continue
    }
    if (ln.text.includes(MARKER_OPEN)) {
      // 保留语法出现在行内(用户伪造/意外引用)→ fail closed
      conflicts.push({ type: 'orphan-content', line: ln.lineNumber, byteStart: ln.start, byteEnd: ln.end, detail: '内容行包含保留 marker 语法' })
      // 仍作为普通内容行处理(记录归属继续),冲突由调用方拒绝
    }
    if (cur) cur.lines.push(ln)
    else legacyLines.push(ln)
  }
  finalizeAnchored()
  flushLegacy(sawAnchored ? 'tail' : 'preamble')

  return { bom, newline, records, conflicts, status: conflicts.length ? 'conflict' : 'clean' }
}

function finishLegacyBlock(b, blk, position) {
  const byteStart = blk.first.start
  const byteEnd = blk.last.end
  return {
    kind: 'legacy',
    memoryId: null,
    anchorId: null,
    position,
    heading: blk.heading,
    lineStart: blk.first.lineNumber,
    lineEnd: blk.last.lineNumber,
    byteStart,
    byteEnd,
    bytes: byteEnd - byteStart,
    chars: countChars(b, byteStart, byteEnd),
    recordDigest: sha256Hex(b.subarray(byteStart, byteEnd)),
  }
}

/**
 * 构建 sidecar(契约 §6)。digest 不变 → 保持 sourceVersion;变化 → +1;
 * 无 prev(新鲜/跨重启重建) → sourceVersion=1 + 新 sourceEpoch。
 * 冲突文件不建 sidecar(返回 ok:false)。
 * @returns {{ok:true,sidecar:object}|{ok:false,reason:string,conflicts?:Array<object>}}
 */
export function buildSidecar({ sourceFile, content, prev, sourceEpoch, now }) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  const parsed = parseAnchors(buf)
  if (parsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (parsed.status === 'conflict') {
    return { ok: false, reason: 'conflict:' + parsed.conflicts.map((c) => c.type).join(','), conflicts: parsed.conflicts }
  }
  const fileDigest = sha256Hex(buf)
  const prevOk = prev && typeof prev.sourceVersion === 'number' && typeof prev.fileDigest === 'string'
  const sourceVersion = prevOk ? (prev.fileDigest === fileDigest ? prev.sourceVersion : prev.sourceVersion + 1) : 1
  const epoch = (prevOk && typeof prev.sourceEpoch === 'string') ? prev.sourceEpoch : (sourceEpoch || randomUUID())
  // per-record 携带构建时文件级身份(sourceVersion+fileDigest)与 marker 行字节区间:
  // 1) 契约 §4 locator 字段完整(anchorByteStart/anchorByteEnd);
  // 2) 文件任何位置变化 ⇒ 所有记录按 fileDigest 判 stale,与 M3a 的记录级文件身份语义对齐。
  const records = parsed.records.filter((r) => r.kind === 'anchored').map((r) => ({
    memoryId: r.memoryId,
    anchorId: r.anchorId,
    anchorLine: r.anchorLine,
    anchorByteStart: r.markerByteStart,
    anchorByteEnd: r.markerByteEnd,
    heading: r.heading,
    lineStart: r.lineStart,
    lineEnd: r.lineEnd,
    byteStart: r.byteStart,
    byteEnd: r.byteEnd,
    bytes: r.bytes,
    chars: r.chars,
    recordDigest: r.recordDigest,
    sourceVersion,
    fileDigest,
  }))
  const sidecar = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    namespace: SIDECAR_NAMESPACE,
    sourceFile,
    sourceEpoch: epoch,
    sourceVersion,
    fileDigest,
    newline: parsed.newline,
    updatedAt: now || Date.now(),
    records,
  }
  return { ok: true, sidecar }
}

/**
 * 校验已落盘 sidecar 文本(JSON)。损坏/字段非法返回 ok:false + 具体 reason;
 * 调用方据此隔离损坏文件并从 Markdown 重建(契约 §6),不修改 Markdown。
 * @returns {{ok:true,sidecar:object}|{ok:false,reason:string}}
 */
export function parseSidecar(text) {
  let src = text
  if (typeof src === 'string' && src.charCodeAt(0) === 0xfeff) src = src.slice(1)
  let obj
  try {
    obj = JSON.parse(src)
  } catch (e) {
    return { ok: false, reason: 'bad-json:' + (e && e.message ? e.message : String(e)) }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not-object' }
  const problems = []
  if (obj.schemaVersion !== SIDECAR_SCHEMA_VERSION) problems.push('schemaVersion')
  if (obj.namespace !== SIDECAR_NAMESPACE) problems.push('namespace')
  if (typeof obj.sourceFile !== 'string' || !obj.sourceFile) problems.push('sourceFile')
  if (typeof obj.sourceEpoch !== 'string' || !UUID_RE.test(obj.sourceEpoch)) problems.push('sourceEpoch')
  if (!Number.isInteger(obj.sourceVersion) || obj.sourceVersion < 1) problems.push('sourceVersion')
  if (typeof obj.fileDigest !== 'string' || !HEX64_RE.test(obj.fileDigest)) problems.push('fileDigest')
  if (obj.newline !== 'lf' && obj.newline !== 'crlf' && obj.newline !== 'mixed') problems.push('newline')
  if (!Number.isFinite(obj.updatedAt) || obj.updatedAt <= 0) problems.push('updatedAt')
  if (!Array.isArray(obj.records)) {
    problems.push('records')
  } else {
    const seen = new Set()
    obj.records.forEach((r, i) => {
      const p = 'records[' + i + ']'
      if (!r || typeof r !== 'object') { problems.push(p); return }
      if (typeof r.memoryId !== 'string' || !MEMORY_ID_RE.test(r.memoryId)) {
        problems.push(p + '.memoryId')
      } else {
        if (seen.has(r.memoryId)) problems.push(p + '.duplicate-id')
        seen.add(r.memoryId)
      }
      if (typeof r.anchorId !== 'string' || r.anchorId !== ANCHOR_PREFIX + r.memoryId) problems.push(p + '.anchorId')
      if (!Number.isInteger(r.anchorLine) || r.anchorLine < 1) problems.push(p + '.anchorLine')
      if (!Number.isInteger(r.anchorByteStart) || !Number.isInteger(r.anchorByteEnd) || r.anchorByteStart < 0 || r.anchorByteEnd <= r.anchorByteStart) problems.push(p + '.anchorBytes')
      if (!Number.isInteger(r.byteStart) || !Number.isInteger(r.byteEnd) || r.byteStart < 0 || r.byteEnd <= r.byteStart) problems.push(p + '.bytes')
      if (typeof r.recordDigest !== 'string' || !HEX64_RE.test(r.recordDigest)) problems.push(p + '.recordDigest')
      if (!Number.isInteger(r.sourceVersion) || r.sourceVersion < 1) problems.push(p + '.sourceVersion')
      if (typeof r.fileDigest !== 'string' || !HEX64_RE.test(r.fileDigest)) problems.push(p + '.fileDigest')
    })
  }
  if (problems.length) return { ok: false, reason: 'invalid:' + problems.join(',') }
  return { ok: true, sidecar: obj }
}

/**
 * Dry-run 迁移计划(契约 §7):只读 Markdown,产出 insert-anchor 操作,不修改任何文件。
 * - preamble 与每个 legacy heading 块各一条 insert-anchor;已有合法 anchor 不重新分配。
 * - planId 确定性派生(sha256(sourceFile+digest)):同一文件同一版本重跑得到同一 planId。
 * - existingPlan 仅在 sourceFile 与 expectedFileDigest 都匹配时按 legacyRecordDigest 复用 memoryId;
 *   文件变化 ⇒ 整份 plan stale,不复用(reusedIds=0 且分配全新 ID)。
 * - 任何 conflict ⇒ aborted:true,operations 为空(fail closed)。
 * @param {string} sourceFile 绝对路径(仅作标识)
 * @param {Buffer|string} content
 * @param {{existingPlan?:object,idFactory?:()=>string,now?:number}} opts
 */
export function planMigration(sourceFile, content, opts = {}) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  const parsed = parseAnchors(buf)
  if (parsed.status === 'oversized') {
    return {
      schemaVersion: 1, planId: 'plan_' + sha256Hex(Buffer.from(sourceFile + '\u0000', 'utf8')).slice(0, 32),
      createdAt: opts.now || Date.now(), sourceFile, expectedFileDigest: '', newline: 'lf',
      operations: [], conflicts: [], aborted: true, oversized: true, reusedIds: 0,
    }
  }
  const fileDigest = sha256Hex(buf)
  const newline = parsed.newline
  const createdAt = opts.now || Date.now()
  const planId = 'plan_' + sha256Hex(Buffer.from(sourceFile + '\u0000' + fileDigest, 'utf8')).slice(0, 32)
  if (parsed.status === 'conflict') {
    return {
      schemaVersion: 1, planId, createdAt, sourceFile, expectedFileDigest: fileDigest, newline,
      operations: [], conflicts: parsed.conflicts, aborted: true, reusedIds: 0,
    }
  }
  // 复用键 = digest + '#' + 出现序号:内容相同的两个 legacy 块(同 digest)仍须各自独立
  // 且跨次规划按文件顺序稳定对应,防止塌缩成重复 anchor。
  const reuse = new Map()
  const ep = opts.existingPlan
  const reuseable = ep && ep.sourceFile === sourceFile && ep.expectedFileDigest === fileDigest && Array.isArray(ep.operations)
  if (reuseable) {
    const epOcc = new Map()
    for (const op of ep.operations) {
      if (op && op.kind === 'insert-anchor' && typeof op.memoryId === 'string' && MEMORY_ID_RE.test(op.memoryId) && typeof op.legacyRecordDigest === 'string') {
        const n = (epOcc.get(op.legacyRecordDigest) || 0) + 1
        epOcc.set(op.legacyRecordDigest, n)
        if (!reuse.has(op.legacyRecordDigest + '#' + n)) reuse.set(op.legacyRecordDigest + '#' + n, op.memoryId)
      }
    }
  }
  const idFactory = typeof opts.idFactory === 'function' ? opts.idFactory : newMemoryId
  const usedIds = new Set(reuse.values())
  const operations = []
  let reusedIds = 0
  const thisOcc = new Map()
  for (const rec of parsed.records) {
    if (rec.kind !== 'legacy') continue
    const n = (thisOcc.get(rec.recordDigest) || 0) + 1
    thisOcc.set(rec.recordDigest, n)
    let memoryId = reuse.get(rec.recordDigest + '#' + n)
    if (memoryId) {
      reusedIds += 1
    } else {
      // 重试上限:注入恒定 idFactory 不得挂死(防御性)
      let tries = 0
      do {
        memoryId = idFactory()
        tries += 1
      } while (usedIds.has(memoryId) && tries <= 100)
      if (tries > 100) {
        return {
          schemaVersion: 1, planId, createdAt, sourceFile, expectedFileDigest: fileDigest, newline,
          operations, conflicts: [{ type: 'id-exhausted', line: 0, byteStart: 0, byteEnd: 0, detail: 'idFactory 无法产生未占用 ID' }],
          aborted: true, reusedIds,
        }
      }
      usedIds.add(memoryId)
    }
    operations.push({
      kind: 'insert-anchor',
      atByte: rec.byteStart,
      memoryId,
      anchorId: ANCHOR_PREFIX + memoryId,
      legacyLineStart: rec.lineStart,
      legacyLineEnd: rec.lineEnd,
      legacyRecordDigest: rec.recordDigest,
    })
  }
  return {
    schemaVersion: 1, planId, createdAt, sourceFile, expectedFileDigest: fileDigest, newline,
    operations, conflicts: [], aborted: false, reusedIds,
  }
}


/**
 * anchor-aware 只读索引投影(M-06 memoryFileIndex.rebuild 的 anchor 语义,M3b-2 衔接)。
 * 与 buildIndex(M3a,按标题切块) 形状兼容,但块边界按 anchor marker:
 * anchored 块 = marker 行之后的内容(byteStart 为内容首字节,不含 marker);
 * legacy 块 = 无 marker 的 heading 块,与 parseAnchors 完全一致。
 * 文件级身份语义与 M3a 相同:records 携带构建时 sourceVersion+fileDigest。
 * 超限(>INDEX_MAX_FILE_BYTES)返回 skipped:true(与 M3a 一致,零哈希)。
 * @param {string} sourceFile 绝对路径(仅作标识)
 * @param {Buffer|string} content
 * @param {{version?:number,fileDigest?:string}} prev
 * @returns {{sourceFile:string,fileDigest:string,sourceVersion:number,skipped?:boolean,records:Array<object>}}
 */
export function buildAnchoredIndex(sourceFile, content, prev) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  if (buf.length > INDEX_MAX_FILE_BYTES) {
    return { sourceFile, fileDigest: '', sourceVersion: (prev && prev.version) || 1, skipped: true, records: [] }
  }
  const fileDigest = sha256Hex(buf)
  const sourceVersion = prev && prev.fileDigest === fileDigest ? (prev.version || 1) : (prev ? (prev.version || 1) + 1 : 1)
  const parsed = parseAnchors(buf)
  if (parsed.status !== 'clean' && parsed.status !== 'oversized') {
    // 冲突文件不产出索引投影(与写入闸门一致 fail closed)
    return { sourceFile, fileDigest, sourceVersion, skipped: false, records: [], conflicts: parsed.conflicts }
  }
  const records = parsed.records.map((r) => ({
    kind: r.kind,
    memoryId: r.memoryId,
    anchorId: r.anchorId,
    anchorLine: r.anchorLine || null,
    heading: r.heading,
    position: r.position || null,
    lineStart: r.lineStart,
    lineEnd: r.lineEnd,
    byteStart: r.byteStart,
    byteEnd: r.byteEnd,
    bytes: r.bytes,
    chars: r.chars,
    recordDigest: r.recordDigest,
    sourceVersion,
    fileDigest,
  }))
  return { sourceFile, fileDigest, sourceVersion, skipped: false, records }
}

export { detectNewline }
