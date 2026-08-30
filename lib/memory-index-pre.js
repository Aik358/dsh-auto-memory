/**
 * MemoryFileIndex — 只读记忆文件索引(M3a,系统地图 M-06 契约)。
 * 不修改任何 Markdown;对记忆文件(用户级/项目笔记/每日日志/反思/日历)按标题行切块,
 * 建立 UTF-8 半开字节区间 [byteStart,byteEnd)、行号 locator、recordDigest 与文件级 sourceVersion。
 * stale 判定 = 当前文件在该字节区间的切片 digest 与记录不一致(含前置插入导致的位移);
 * stale ≠ coverage=0。多字节字符按 UTF-8 字节计数,与模型 read 返回的字节区间一致。
 */
import { createHash } from 'node:crypto'

/** 单文件索引构建上限(字节),超出跳过(返回 skipped),避免大文件同步阻塞。 */
const INDEX_MAX_FILE_BYTES = 5 * 1024 * 1024

/** 标题行识别:行首 1-6 个 '#' + 空白。 */
const HEADING_RE = /^#{1,6}\s/

/**
 * 按 0x0A 切行为字节行,保留各自 [start,end) 半开区间(end 含换行符)。
 * CRLF:0x0D 保留在行内,行文本解码时剔除尾部 \r,字节区间不受影响。
 * @param {Buffer} buf
 * @returns {{start:number,end:number,text:string}[]} 行号 = 数组下标 + 1
 */
function splitByteLines(buf) {
  const lines = []
  let start = 0
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      lines.push({ start, end: i + 1, text: decodedLine(buf, start, i) })
      start = i + 1
    }
  }
  if (start < buf.length) lines.push({ start, end: buf.length, text: decodedLine(buf, start, buf.length) })
  else if (start === buf.length && buf.length === 0) { /* empty file */ }
  return lines
}

/** 行字节 → UTF-8 文本(剔除结尾 CR)。 */
function decodedLine(buf, s, e) {
  let end = e
  if (end > s && buf[end - 1] === 0x0d) end -= 1
  if (end <= s) return ''
  return buf.toString('utf8', s, end)
}

/**
 * 构建单个文件的记录索引。
 * 超限保护在模块自身生效:content 超过 INDEX_MAX_FILE_BYTES 时直接返回
 * { sourceFile, skipped:true, records:[] } 且 fileDigest 为空,不做任何切片/摘要计算。
 * 每条记录携带构建时的 sourceVersion 与 fileDigest(文件级身份);
 * verifyRecord 因此能实现"文件任何位置变化 ⇒ 本文件所有 locator stale"的文件级语义。
 * @param {string} sourceFile 绝对路径(仅作标识,不读取)
 * @param {Buffer|string} content 文件字节/文本(文本视为 UTF-8)
 * @param {{version?:number,fileDigest?:string}} prev 上次构建信息(用于版本递增)
 * @returns {{sourceFile:string,fileDigest:string,sourceVersion:number,skipped?:boolean,records:Array<object>}}
 */
function buildIndex(sourceFile, content, prev) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
  if (buf.length > INDEX_MAX_FILE_BYTES) {
    return { sourceFile, fileDigest: '', sourceVersion: (prev && prev.version) || 1, skipped: true, records: [] }
  }
  const fileDigest = createHash('sha256').update(buf).digest('hex')
  const sourceVersion = prev && prev.fileDigest === fileDigest ? (prev.version || 1) : (prev ? (prev.version || 1) + 1 : 1)
  const lines = splitByteLines(buf)
  const records = []
  let cur = null
  lines.forEach((line, idx) => {
    if (HEADING_RE.test(line.text)) {
      if (cur) records.push(cur)
      cur = {
        sourceFile,
        heading: line.text.replace(/^#{1,6}\s*/, '').trim(),
        lineStart: idx + 1,
        lineEnd: idx + 1,
        byteStart: line.start,
        byteEnd: line.end,
        bytes: 0,
        chars: 0,
        recordDigest: '',
        sourceVersion: sourceVersion,
        fileDigest,
      }
    } else if (cur) {
      cur.lineEnd = idx + 1
      cur.byteEnd = line.end
    }
  })
  if (cur) records.push(cur)
  for (const rec of records) {
    const safeEnd = Math.min(rec.byteEnd, buf.length)
    const safeStart = Math.min(rec.byteStart, buf.length)
    rec.bytes = Math.max(0, safeEnd - safeStart)
    rec.chars = 0
    for (let i = safeStart; i < safeEnd;) {
      const c = buf.readUInt8(i)
      const n = c < 0x80 ? 1 : c < 0xe0 ? 2 : c < 0xf0 ? 3 : 4
      i += n
      rec.chars += 1
    }
    rec.recordDigest = createHash('sha256').update(buf.subarray(safeStart, safeEnd)).digest('hex')
    // 文件级身份:每条记录携带本次构建的 sourceVersion 与 fileDigest
    rec.sourceVersion = sourceVersion
    rec.fileDigest = fileDigest
  }
  return { sourceFile, fileDigest, sourceVersion, records }
}

/**
 * 校验 locator 在当前文件中是否 fresh。
 * 文件级语义(审查闭环):记录携带构建时的 fileDigest,当前文件整体 digest 与之一致
 * 且原字节切片 digest 一致 → fresh;文件任何位置发生变化 ⇒ 本文件所有记录 stale。
 * 无 fileDigest 的旧记录退化为只做切片比对(向后兼容)。
 * @param {object} record buildIndex 产出的记录
 * @param {Buffer} current 当前文件字节
 * @returns {{fresh:boolean,bytes:number|null,digest:string|null,fileLevel:boolean}}
 */
function verifyRecord(record, current) {
  if (!record || !Buffer.isBuffer(current)) return { fresh: false, bytes: null, digest: null, fileLevel: false }
  if (record.byteStart < 0 || record.byteEnd > current.length || record.byteEnd <= record.byteStart) return { fresh: false, bytes: null, digest: null, fileLevel: false }
  if (record.fileDigest) {
    const fileLevel = createHash('sha256').update(current).digest('hex') === record.fileDigest
    if (!fileLevel) return { fresh: false, bytes: 0, digest: null, fileLevel: false }
    const slice = current.subarray(record.byteStart, record.byteEnd)
    const digest = createHash('sha256').update(slice).digest('hex')
    return { fresh: digest === record.recordDigest, bytes: slice.length, digest, fileLevel: true }
  }
  const slice = current.subarray(record.byteStart, record.byteEnd)
  const digest = createHash('sha256').update(slice).digest('hex')
  return { fresh: digest === record.recordDigest, bytes: slice.length, digest, fileLevel: false }
}

/**
 * 计算一次 read 返回区间与记录的重合覆盖率(M-06)。
 * readRange = [start,end) 半开 UTF-8 字节区间;stale 记录直接拒绝,不做伪装 coverage=0。
 * @returns {{status:'fresh'|'stale'|'out-of-range',matchedBytes:number,totalBytes:number,ratio:number}}
 */
function coverage(readRange, record, current) {
  if (!record || !Array.isArray(readRange) || readRange.length < 2) return { status: 'out-of-range', matchedBytes: 0, totalBytes: 0, ratio: 0 }
  const [s, e] = [Math.max(0, Number(readRange[0]) || 0), Math.max(0, Number(readRange[1]) || 0)]
  const ver = verifyRecord(record, current)
  if (!ver.fresh) return { status: 'stale', matchedBytes: 0, totalBytes: Math.max(1, record.byteEnd - record.byteStart), ratio: 0 }
  const totalBytes = Math.max(1, record.byteEnd - record.byteStart)
  const matched = Math.max(0, Math.min(e, record.byteEnd) - Math.max(s, record.byteStart))
  return { status: 'fresh', matchedBytes: matched, totalBytes, ratio: matched / totalBytes }
}

export { buildIndex, verifyRecord, coverage, splitByteLines, INDEX_MAX_FILE_BYTES }
