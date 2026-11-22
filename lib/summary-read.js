import path from 'node:path'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { fileWithinRoots } from './file-boundary.js'

// The generator writes YYYY-MM-DD-<period>.json. The period may be localized.
const summaryFilename = /^\d{4}-\d{2}-\d{2}-[^/\\]+\.json$/
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

function empty(directory, reason) {
  return { ok: false, scope: 'global', code: 'empty', reason, path: directory }
}

function unreadable(source, reason) {
  return { ok: false, scope: 'global', code: 'unreadable', reason, path: source }
}

/** Read the newest generated period summary and return the exact source text. */
export async function readLatestPeriodSummary(directory) {
  const root = path.resolve(directory)
  let entries
  try {
    const stat = await lstat(root)
    if (!stat.isDirectory()) return unreadable(root, 'invalid-directory')
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return empty(root, 'summary-directory-missing')
    return unreadable(root, error.code || 'directory-read-failed')
  }

  let latest = null
  for (const entry of entries) {
    const name = entry.name
    if (!summaryFilename.test(name) || entry.isDirectory()) continue
    const source = path.join(root, name)
    const physical = fileWithinRoots(source, [root], { strict: true })
    if (!physical) return unreadable(source, 'invalid-file-path')
    let stat, bytes
    try {
      stat = await lstat(source)
      if (!stat.isFile()) return unreadable(source, 'invalid-file')
      bytes = await readFile(physical)
    } catch (error) {
      return unreadable(source, error.code || 'file-read-failed')
    }

    let content, record
    try {
      content = utf8.decode(bytes)
      record = JSON.parse(content.replace(/^\uFEFF/, ''))
    } catch {
      return unreadable(source, 'invalid-summary-json')
    }
    if (typeof record?.summary !== 'string' || !Array.isArray(record.works)) {
      return unreadable(source, 'invalid-summary-record')
    }

    const generatedAt = Number.isFinite(record.generatedAt) && record.generatedAt > 0 ? record.generatedAt : null
    const at = generatedAt ?? stat.mtimeMs
    if (!latest || at > latest.at || (at === latest.at && name > latest.name)) {
      latest = {
        at, name,
        output: {
          ok: true, scope: 'global', path: source, generatedAt,
          timestampSource: generatedAt === null ? 'mtime' : 'generatedAt',
          ...(generatedAt === null ? { mtimeMs: stat.mtimeMs } : {}),
          bytes: bytes.length, content,
        },
      }
    }
  }
  return latest ? latest.output : empty(root, 'no-summary-files')
}
