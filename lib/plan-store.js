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
  // ★issue#434(2026-10-17):同一文档内**同名标题**按出现序号(0 基)纳入身份。
  //
  // 为什么序号必须在**这一层**算,不能交给 applyAnchorsPre 自己数:本函数是**逐标题**
  //   调用 applyAnchorsPre(每次只喂 `line + '\n'`),被调方每次只看得见一个标题 ⇒ 内部
  //   计数器恒为 0 ⇒ 重复标题仍撞同一 id。序号只能由「看得见整篇」的这一层供给。
  //
  // ★序号必须数**本文档的全部标题**,不能只数「需要插锚点的标题」:
  //   下面那个 `if` 的条件含「下一行**不是**锚点」——已带锚点的标题走「原样保留」分支、
  //   **根本不会调用** applyAnchorsPre。但序号照样要递增,否则:
  //     `## A`(有锚点) → `### 下一步`(应为 0,漏数会变 1) → `### 下一步`(应为 1)
  //   ⇒ 第二个会算成 1 而第一个算成 1 ⇒ 仍然撞车。故计数器放在 `if` **外面**维护。
  //
  // 统计口径:`#{2,4}` 级标题流内的同名出现次序(与 applyAnchorsPre 认的标题级一致)。
  const seenTitles = new Map()
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i][0], line = raw.replace(/\r?\n$/, '')
    if (/<!--\s*user\s*-->/.test(line)) user = true
    const inUser = user
    if (/<!--\s*\/user\s*-->/.test(line)) user = false
    if (/^\s*```/.test(line)) fence = !fence
    out.push(raw)
    // 序号:只对「本函数认的卡片标题」(#{2,4} 且非 fence/非用户区)计数,口径与插入判据一致。
    let ordinal = 0
    if (!fence && !inUser && /^#{2,4}\s+/.test(line)) {
      const title = line.replace(/^#{2,4}\s+/, '').trim()
      const key = String(title)
      ordinal = seenTitles.get(key) || 0
      seenTitles.set(key, ordinal + 1)
    }
    // Preserve existing IDs even when a card title changes. Never insert into
    // fenced examples or user-owned regions. Mixed line endings stay intact.
    if (!fence && !inUser && /^#{2,4}\s+/.test(line) && !/^<!--\s*memory:mem_[a-f0-9]{32}\s*-->\s*$/.test(lines[i + 1]?.[0] || '')) {
      // 把上面算好的 ordinal 传给 applyAnchorsPre(第 4 参)。单标题调用时它内部的
      // occurrence 恒为 0,故这里让 `ordinalOf` 直接返回该标题的全篇序号。
      const anchor = applyAnchorsPre(workspaceKey, 'handoff/PLAN.md', line + '\n', () => ordinal).text.split('\n')[1]
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
    // ★issue#434(2026-10-17):**重复 id 必须报自己的错误,不能伪装成 revision 冲突**。
    //   旧实现在这里一句 `cards.filter(...).length !== 1` 把「重复 id」与「revision 过期」
    //   混成同一个 plan-card-conflict ⇒ 调用方按提示「重读卡片再拿新 revision 重试」,
    //   但重复 id 下**无论如何重试都冲突**(find 永远拿第一张、filter 计数永远是 2)
    //   ⇒ 恒失败且提示是**假出路**。现把两者拆开:重复 id 明确指路「先修文件」。
    //   单条命中逻辑不变(下面 `card` 仍是 `find` 的第一张,行为与旧实现逐字相同)。
    const dupCount = cards.filter(c => c.id === opts.cardId).length
    if (dupCount > 1) {
      return {
        ok: false,
        error: 'plan-card-duplicate-id: ' + dupCount + ' cards share id ' + String(opts.cardId) +
          '; repair the plan file so every card id is unique before editing a single card',
        code: 'PLAN_CARD_DUPLICATE_ID',
        duplicateId: String(opts.cardId),
        duplicateCount: dupCount,
      }
    }
    if (!card || card.revision !== opts.expectedCardRevision) {
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