// Owns the durable watermark/pending transaction. Host discovery stays in index.
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { withConfigLockSync } from './config-lock.js'
import { diffBriefPre, buildDraftPre, renderBriefPre } from './global-brief.js'

// null means detection could not commit. Enqueue failure still returns a brief
// after retaining its pending event; unchanged retries produce no prompt text.
export function syncBriefPre({ file, entries, previous, snapshot, isSelfWrite, watchTeam, enqueue, chars, instruction }) {
  if (!entries.length && !existsSync(file)) return null
  try { return withConfigLockSync(file, () => {
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : previous
    const diff = diffBriefPre({ previous: prev && prev.watermarks ? prev.watermarks : prev, entries, isSelfWrite })
    const pendingByPath = new Map((Array.isArray(prev && prev.teamPending) ? prev.teamPending : [])
      .map(c => [c.path, { ...c, eventId: c.eventId || randomUUID() }]))
    if (watchTeam) for (const change of diff.changed) pendingByPath.set(change.path, { ...change, eventId: randomUUID() })
    const watermark = { watermarks: diff.next, teamPending: [...pendingByPath.values()] }
    const save = () => {
      mkdirSync(path.dirname(file), { recursive: true })
      const tmp = file + '.tmp'
      writeFileSync(tmp, JSON.stringify(watermark), 'utf8')
      renameSync(tmp, file)
    }
    // Commit before enqueue; a crash or busy outbox leaves a recoverable event.
    save()
    if (diff.changed.length || !snapshot) {
      snapshot = { at: Date.now(), changed: diff.changed.slice(0, 40), counts: diff.counts, watched: entries.length }
    }
    if (watchTeam && typeof enqueue === 'function') {
      try {
        watermark.teamPending = watermark.teamPending.filter(change => {
          try {
            const accepted = enqueue({ kind: 'handoff', key: 'brief:' + String(change.path),
              payload: { path: change.path, change: change.kind, source: change.source, eventId: change.eventId } })
            return !accepted || accepted.ok !== true
          } catch (_) { return true }
        })
        save()
      } catch (_) { /* The first commit retains events if acknowledgement fails. */ }
    }
    let text = ''
    if (diff.changed.length) {
      try {
        text = renderBriefPre({ draft: buildDraftPre({ changed: diff.changed, maxChars: Number(chars) || 1200 }) })
        if (text && instruction === 'none') {
          const i = text.indexOf('\n请先按上面的绝对路径')
          if (i > 0) text = text.slice(0, i)
        }
      } catch (_) {}
    }
    return { watermark, snapshot, text }
  }, { reentrant: false }) } catch (_) { return null }
}
