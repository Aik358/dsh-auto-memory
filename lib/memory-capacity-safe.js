/** #38: lossless capacity planning. Zero runtime dependencies, no user files on import. */
import path from 'node:path'
import { createHash } from 'node:crypto'

/** Exact spans, not synthesized headings. Headings inside fenced code are not records. */
export function legacyRecordStartsPre(text) {
  const starts = []
  let offset = 0, fence = null
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const plain = line.replace(/\r?\n$/, '')
    const fm = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(plain)
    if (fence) {
      if (fm && fm[1][0] === fence.ch && fm[1].length >= fence.n && !fm[2].trim()) fence = null
    } else if (fm) {
      fence = { ch: fm[1][0], n: fm[1].length }
    } else if (/^##[\t ]+\S/.test(plain)) {
      starts.push(offset)
    }
    offset += line.length
  }
  // A real nonblank preamble is its own record; a whitespace prefix belongs to the first one.
  if (!starts.length) return text.trim() ? [0] : []
  if (starts[0] > 0 && text.slice(0, starts[0]).trim()) starts.unshift(0)
  else starts[0] = 0
  return starts
}

export function legacyAppendPre(current, record) {
  return current ? current.replace(/\s+$/, '') + '\n' + record : record
}

function renderText(result) {
  if (typeof result === 'string') return result
  if (!result || result.ok !== true) throw new Error(result?.reason || 'render-failed')
  if (Buffer.isBuffer(result.text)) return new TextDecoder('utf-8', { fatal: true }).decode(result.text)
  if (typeof result.text !== 'string') throw new Error('render-returned-no-text')
  return result.text
}

/**
 * render(kept, summary) MUST serialize the actual final write, including anchors/EOL/date.
 * starts are character offsets of complete records; callers with anchors use parser offsets.
 * No IO, no partial compaction on refusal, no invented success criteria or textual truncation.
 */
export async function planBudgetedWritePre({ current, limit, replace = false, replacement,
  render, starts = legacyRecordStartsPre(current), fold = null, foldMaxChars = 1500 }) {
  if (typeof current !== 'string' || !Number.isSafeInteger(limit) || limit < 0 || typeof render !== 'function') {
    throw new TypeError('invalid capacity plan arguments')
  }
  const account = text => ({ limit, used: current.length, need: text.length, add: text.length - current.length, ok: text.length <= limit })
  const result = (text, archive = '', folded = false) => ({ ok: true, text, archive, folded,
    compacted: archive.length > 0, acct: account(text) })
  if (replace) {
    const text = renderText(await render(replacement, ''))
    return text.length <= limit ? result(text) : { ok: false, reason: 'replacement-over-capacity', acct: account(text) }
  }
  const direct = renderText(await render(current, ''))
  if (direct.length <= limit) return result(direct)
  const alone = renderText(await render('', ''))
  if (alone.length > limit) return { ok: false, reason: 'write-over-capacity', acct: account(direct) }
  if (!Array.isArray(starts) || starts.some((n, i) => !Number.isSafeInteger(n) || n < 0 || n >= current.length || (i && n <= starts[i - 1]))) {
    throw new Error('invalid record boundaries')
  }
  // Smallest removable prefix that fits => maximal contiguous recent history, newest intact.
  for (let i = 1; i < starts.length; i++) {
    const cut = starts[i], kept = current.slice(cut), archive = current.slice(0, cut)
    const candidate = renderText(await render(kept, ''))
    if (candidate.length > limit) continue
    if (fold && archive.trim()) {
      let summary = ''
      try { summary = String(await fold(archive, Math.min(foldMaxChars, Math.max(0, limit - candidate.length))) || '').trim() } catch (_) {}
      if (summary && summary.length <= foldMaxChars && summary.length < archive.length) {
        const withSummary = renderText(await render(kept, summary))
        if (withSummary.length <= limit && withSummary.length < direct.length) return result(withSummary, archive, true)
      }
    }
    if (candidate.length < direct.length) return result(candidate, archive)
  }
  // The newest record is a hard floor. Only a nonempty, fitting summary may replace it.
  if (fold && current.trim()) {
    let summary = ''
    try { summary = String(await fold(current, Math.min(foldMaxChars, Math.max(0, limit - alone.length))) || '').trim() } catch (_) {}
    if (summary && summary.length <= foldMaxChars && summary.length < current.length) {
      const candidate = renderText(await render('', summary))
      if (candidate.length <= limit && candidate.length < direct.length) return result(candidate, current, true)
    }
  }
  return { ok: false, reason: 'no-removable', acct: account(direct) }
}

const archiveQueues = new Map()
async function durableArchivePre(fs, file, raw) {
  const key = path.resolve(file)
  const previous = archiveQueues.get(key) || Promise.resolve()
  const run = previous.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    const handle = await fs.open(file, 'a+')
    try {
      const bytes = Buffer.from('\n\n' + raw, 'utf8')
      await handle.writeFile(bytes)
      await handle.sync()
      const end = (await handle.stat()).size
      const verified = Buffer.alloc(bytes.length)
      let offset = 0
      while (offset < bytes.length) {
        const r = await handle.read(verified, offset, bytes.length - offset, end - bytes.length + offset)
        if (!r.bytesRead) throw new Error('archive-verify-short-read')
        offset += r.bytesRead
      }
      if (!verified.equals(bytes)) throw new Error('archive-verify-mismatch')
    } finally { await handle.close() }
  })
  const settled = run.catch(() => {})
  archiveQueues.set(key, settled)
  settled.then(() => { if (archiveQueues.get(key) === settled) archiveQueues.delete(key) })
  return run
}

/** Reuse MemoryDocumentStore's existing per-file queue, backup/atomic commit/sidecar contract. */
export function transactMemoryFilePre(store, file, prepare, { archiveFile = null } = {}) {
  return store._queue(file, async () => {
    const state = await store._readState(file)
    const current = state.buf ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(state.buf) : ''
    let plan
    try { plan = await prepare(current, state) } catch (e) {
      return { ok: false, reason: 'prepare-failed:' + e.message, written: false }
    }
    if (!plan || plan.ok !== true) return { ...plan, ok: false, written: false }
    if (typeof plan.text !== 'string') throw new Error('transaction returned no text')
    if (plan.text === current) return { ...plan, body: current, written: false }
    // Same optimistic concurrency contract as the existing writer. Never overwrite a detected edit.
    const unchanged = async () => (await store._readState(file)).fileDigest === state.fileDigest
    if (!await unchanged()) return { ok: false, reason: 'conflict-external-edit', written: false }
    if (plan.archive) {
      if (!archiveFile) return { ok: false, reason: 'archive-path-missing', written: false }
      if (path.resolve(archiveFile) === path.resolve(file)) return { ok: false, reason: 'archive-is-source', written: false }
      try { await durableArchivePre(store.fs, archiveFile, plan.archive) }
      catch (e) { return { ok: false, reason: 'archive-failed:' + e.message, written: false } }
      if (!await unchanged()) return { ok: false, reason: 'conflict-external-edit', written: false, archived: true }
    }
    const committed = await store._commit(file, Buffer.from(plan.text, 'utf8'))
    if (!committed.ok) return { ...committed, archived: !!plan.archive }
    return { ...plan, ...committed, body: plan.text, archived: !!plan.archive }
  })
}

/** UTF-8 byte boundaries from parseAnchors -> JS character offsets; never cut a code point. */
export function anchoredRecordStartsPre(text, parsed) {
  if (!parsed || parsed.status !== 'clean') throw new Error('dirty-file')
  const buf = Buffer.from(text, 'utf8')
  const starts = (parsed.records || []).map(r => r.kind === 'anchored' ? r.markerByteStart : r.byteStart)
    .map(n => {
      if (!Number.isSafeInteger(n) || n < 0 || n > buf.length) throw new Error('bad-record-offset')
      return new TextDecoder('utf-8', { fatal: true }).decode(buf.subarray(0, n)).length
    })
  if (starts.length && starts[0] !== 0) starts.unshift(0)
  return [...new Set(starts)].filter(n => n < text.length)
}

export const memoryDigestPre = text => createHash('sha256').update(text).digest('hex')
