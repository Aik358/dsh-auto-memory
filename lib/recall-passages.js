import { parseAnchors } from './memory-anchor.js'
import { statusOfBodyPre } from './note-status.js'
import { supersededMarkPre } from './l0-extract.js'

export function recallExcerptPre(text, terms, cap = 240) {
  const line = String(text || '').trim()
  if (line.length <= cap) return line
  const lower = line.toLowerCase()
  const positions = terms.map((term) => lower.indexOf(term)).filter((at) => at >= 0)
  const at = positions.length ? Math.min(...positions) : 0
  const start = Math.max(0, Math.min(at - 60, line.length - cap))
  return (start ? '…' : '') + line.slice(start, start + cap) + (start + cap < line.length ? '…' : '') + ' [原文 ' + line.length + ' 字符]'
}

export function recallPassagesPre(text, terms, sourcePath, full = false) {
  const input = Buffer.from(String(text || ''), 'utf8')
  const parsed = parseAnchors(input)
  const normalized = parsed.bom ? input.subarray(3) : input
  const hits = []
  for (const record of parsed.records || []) {
    const memoryId = record.memoryId || ''
    const body = normalized.subarray(record.byteStart, record.byteEnd).toString('utf8')
    const info = statusOfBodyPre(body)
    const status = info && info.status || 'current'
    const mark = supersededMarkPre({ ...info, status })
    body.split('\n').forEach((line, index) => {
      if (/^\s*<!--/.test(line)) return
      const lower = line.toLowerCase()
      const score = terms.reduce((total, term) => total + (term && lower.includes(term) ? 1 : 0), 0)
      if (!score) return
      hits.push({ sourcePath, memoryId, lineStart: record.lineStart + index, lineEnd: record.lineStart + index,
        status, mark, supersededBy: info && info.supersededBy || '', reason: info && info.reason || '', score,
        line: full ? line.trim() : recallExcerptPre(line, terms) })
    })
  }
  return hits
}
