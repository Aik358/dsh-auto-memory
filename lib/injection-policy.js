// Automatic injection policy only. Source files, anchors, digests and explicit
// user-authorized full-file reads remain intact.
export function sensitiveSections(text) {
  const lines = String(text || '').split('\n')
  const blocked = []
  const ranges = []
  let skip = false, byte = 0
  for (const line of lines) {
    // A supported UTF-8 BOM belongs to the source bytes, not the first heading.
    // Ignore it only for recognition; keep lines and byte coordinates intact.
    const heading = blocked.length === 0 ? line.replace(/^\uFEFF/, '') : line
    if (/^## /.test(heading)) skip = /敏感|凭据|令牌|口令|token|密钥|secret|password|credential|pat\b|api\s*key/i.test(heading)
    blocked.push(skip)
    const end = byte + Buffer.byteLength(line + '\n', 'utf8')
    if (skip) ranges.push({ start: byte, end })
    byte = end
  }
  return { lines, blocked, ranges }
}

export function stripSensitiveSections(text, { preserveLines = false } = {}) {
  const { lines, blocked } = sensitiveSections(text)
  const safe = lines.map((line, i) => blocked[i] ? '' : line).join('\n')
  return preserveLines ? safe : safe.replace(/\n{3,}/g, '\n\n').trim()
}

export function sensitiveRecord(policy, start, end) {
  return policy.ranges.some(r => start < r.end && end > r.start)
}

// A summarized hit no longer carries its parent section. Require its original
// line range when its source has excluded sections; old unlocated projections
// fail closed for that source, while entirely ordinary sources stay compatible.
export function filterSensitiveHits(hits, sources) {
  const entries = sources.map(s => ({ ...s, policy: sensitiveSections(s.text) }))
  const kept = [], dropped = []
  for (const h of Array.isArray(hits) ? hits : []) {
    if (!h) continue
    const ref = String(h.sourceRef || h.path || '')
    const source = entries.find(s => ref && (ref === s.path || ref === s.sourceRef))
      || entries.find(s => s.layer === h.layer)
    let allowed = true, admitted = h
    if (source && source.policy.ranges.length) {
      const start = Number(h.lineStart), end = Number(h.lineEnd)
      allowed = Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start
        && end <= source.policy.lines.length
        && !source.policy.blocked.slice(start - 1, end).some(Boolean)
      if (allowed) {
        // Do not trust an old derived summary merely because its locator is safe.
        // Rebuild drilldown from admitted original lines before rendering.
        const text = source.policy.lines.slice(start - 1, end).join('\n')
        admitted = { ...h, excerpt: text, excerptFull: text, text, oneLine: '', summary: '', title: '' }
      }
    }
    // Covers complete self-contained blocks from other sources, too.
    if (allowed) allowed = !['excerptFull', 'excerpt', 'text', 'heading', 'title', 'summary', 'oneLine']
      .some(key => admitted[key] && sensitiveSections(admitted[key]).ranges.length)
    if (allowed) kept.push(admitted)
    else dropped.push(h)
  }
  return { kept, dropped }
}
