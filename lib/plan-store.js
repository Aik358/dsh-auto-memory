/** Shared PLAN is the source of truth. Revisions cover exact UTF-8 bytes;
 * derived indexes and role-like prose cannot authorize an update. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { applyAnchorsPre } from './wb-sidecar.js'
import { fileWithinRoots } from './file-boundary.js'

export const planRevisionPre = text => createHash('sha256').update(text).digest('hex')
export async function readPlanPre(file) {
  try {
    const bytes = await readFile(file)
    const text = bytes.toString('utf8')
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('plan-invalid-utf8: preserve the original file and repair its encoding before updating')
    return text
  }
  catch (e) { if (e.code === 'ENOENT') return ''; throw e }
}
function linesPre(text) {
  return [...text.matchAll(/[^\n]*(?:\n|$)/g)].filter(line => line[0])
}
// Offsets include the heading and retain every byte of neighbouring cards.
export function planCardsPre(text) {
  const headings = []
  let fence = false, user = false
  for (const line of linesPre(text)) {
    if (/<!--\s*user\s*-->/.test(line[0])) user = true
    const inUser = user
    if (/<!--\s*\/user\s*-->/.test(line[0])) user = false
    if (/^\s*```/.test(line[0])) fence = !fence
    if (!fence && !inUser && /^#{2,4}\s+/.test(line[0])) headings.push(line)
  }
  return headings.map((heading, i) => {
    const end = headings[i + 1]?.index ?? text.length
    const body = text.slice(heading.index, end)
    const anchor = body.slice(heading[0].length).match(/^<!--\s*memory:(mem_[a-f0-9]{32})\s*-->[ \t]*(?:\r?\n|$)/)
    return { id: anchor?.[1] || null, start: heading.index, end, title: heading[0].trim(), revision: planRevisionPre(body), text: body }
  })
}
export function anchoredPlanPre(workspaceKey, text) {
  const lines = linesPre(text), out = []
  let fence = false, user = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i][0], line = raw.replace(/\r?\n$/, '')
    if (/<!--\s*user\s*-->/.test(line)) user = true
    const inUser = user
    if (/<!--\s*\/user\s*-->/.test(line)) user = false
    if (/^\s*```/.test(line)) fence = !fence
    out.push(raw)
    // Preserve existing IDs even when a card title changes. Never insert into
    // fenced examples or user-owned regions. Mixed line endings stay intact.
    if (!fence && !inUser && /^#{2,4}\s+/.test(line) && !/^<!--\s*memory:mem_[a-f0-9]{32}\s*-->\s*$/.test(lines[i + 1]?.[0] || '')) {
      const anchor = applyAnchorsPre(workspaceKey, 'handoff/PLAN.md', line + '\n').text.split('\n')[1]
      if (anchor) {
        const eol = raw.endsWith('\r\n') ? '\r\n' : raw.endsWith('\n') ? '\n' : text.includes('\r\n') ? '\r\n' : '\n'
        if (!raw.endsWith('\n')) out.push(eol)
        out.push(anchor + eol)
      }
    }
  }
  return out.join('')
}
export async function archivePlanPre(dir, base, text) {
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, base + '-' + randomUUID() + '.md')
  await writeFile(file, text, { encoding: 'utf8', flag: 'wx' })
  return file
}
export async function conflictPlanPre(file, current, proposed, opts, reason) {
  // #268：冲突副本必须落在 PLAN 所在 handoff 的**物理**子目录内。旧写法只做词法 path.join，
  // 若 conflicts 已被预置为目录链接 / junction，副本会落到链接指向的目录（可逃逸出 handoff）。
  // 判据统一取自 lib/file-boundary.js（本仓路径边界的唯一来源）：
  //   ① mkdir 之前先验词法与物理路径同形 ⇒ 既有链接不被跟随写透；
  //   ② mkdir 之后再验一次，覆盖「先前不存在、mkdir 时被抢占成链接」的窗口；
  //   ③ 最终写入目标按同一物理口径复验组件级包含关系，并就用该物理路径写盘。
  const handoffDir = path.dirname(file)
  const dir = path.join(handoffDir, 'conflicts')
  const assertPhysicalSubdir = () => {
    // strict:true ⇒ 必须真在 handoff 之下；allowMissing:true ⇒ mkdir 之前允许尚不存在，
    // 但悬空链接是已存在条目、一律拒；返回值即被校验过的物理路径，直接拿去写盘。
    const physical = fileWithinRoots(dir, [handoffDir], { strict: true, allowMissing: true })
    if (!physical) {
      const e = new Error('plan-conflict-dir-escaped: conflicts must be a physical subdirectory of the handoff directory')
      e.code = 'PLAN_CONFLICT_DIR_ESCAPED'
      throw e
    }
    return physical
  }
  assertPhysicalSubdir()
  await mkdir(dir, { recursive: true })
  const physicalDir = assertPhysicalSubdir()
  const target = path.join(physicalDir, 'PLAN-' + randomUUID() + '.json')
  await writeFile(target, JSON.stringify({
    schemaVersion: 'plan-conflict-v1', reason, current, proposed,
    currentRevision: planRevisionPre(current), expectedRevision: opts.expectedRevision || null,
    cardId: opts.cardId || null, expectedCardRevision: opts.expectedCardRevision || null,
  }, null, 2), { encoding: 'utf8', flag: 'wx' })
  return { ok: false, error: reason, conflictPath: target, revision: planRevisionPre(current) }
}
export async function preparePlanPre(file, current, incoming, opts = {}) {
  if (opts.createOnly && current) return { ok: true, skipped: 'exists', text: current }
  if (opts.cardId) {
    const cards = planCardsPre(current), card = cards.find(c => c.id === opts.cardId)
    if (!card || cards.filter(c => c.id === opts.cardId).length !== 1 || card.revision !== opts.expectedCardRevision) {
      return conflictPlanPre(file, current, incoming, opts, 'plan-card-conflict: read the current card and retry with its revision')
    }
    if (card.end < current.length && !incoming.endsWith('\n')) return { ok: false, error: 'plan-card-format: retain the final line ending before the next card' }
    const replacement = planCardsPre(incoming)
    if (replacement.length !== 1 || replacement[0].id !== card.id || replacement[0].start !== 0) {
      return { ok: false, error: 'plan-card-format: supply one complete heading/card retaining its anchor' }
    }
    for (const user of card.text.matchAll(/<!--\s*user\s*-->[\s\S]*?<!--\s*\/user\s*-->/g)) {
      if (!incoming.includes(user[0])) return { ok: false, error: 'plan-user-region-protected' }
    }
    return { ok: true, text: current.slice(0, card.start) + incoming + current.slice(card.end) }
  }
  if ((current || opts.expectedRevision !== undefined) && opts.expectedRevision !== planRevisionPre(current)) {
    return conflictPlanPre(file, current, incoming, opts, 'plan-version-conflict: memory_read(kind=plan) before rewriting; retain both candidates')
  }
  return { ok: true, text: incoming }
}
