import { createHash } from 'node:crypto'

export const digest = (value) => createHash('sha256').update(value).digest('hex')

// Secrets are removed before archival, model calls, or manual writes.
export function redact(value) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{12,}/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization)["']?\s*[:=]\s*["']?)([^\s"',;}&]+)/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@')
    .replace(/([?&](?:token|key|sig|signature|credential|code)=)[^&#\s]+/gi, '$1[REDACTED]')
}

export function memoryText(value) {
  if (typeof value !== 'string') throw new Error('记忆内容必须是文字')
  const text = redact(value).trim()
  if (!text || text.length > 2000) throw new Error('每条记忆需为 1–2000 字符')
  return text
}

export function tokens(value) {
  const text = String(value).normalize('NFKC').toLowerCase()
  const result = new Set(text.match(/[a-z0-9_./-]+/g) || [])
  for (const run of text.match(/[\p{Script=Han}]+/gu) || []) {
    if (run.length === 1) result.add(run)
    for (let i = 0; i + 1 < run.length; i++) result.add(run.slice(i, i + 2))
  }
  return result
}

export function score(query, text) {
  const wanted = tokens(query)
  if (!wanted.size) return 0
  const available = tokens(text)
  let hits = 0
  for (const word of wanted) if (available.has(word)) hits++
  return hits / wanted.size + (String(text).toLowerCase().includes(query.toLowerCase()) ? 1 : 0)
}

export function excerpt(text, query, length = 360) {
  const needle = [...tokens(query)].find(word => text.toLowerCase().includes(word))
  const index = needle ? text.toLowerCase().indexOf(needle) : 0
  const start = Math.max(0, index - 80)
  return (start ? '…' : '') + text.slice(start, start + length) + (start + length < text.length ? '…' : '')
}
