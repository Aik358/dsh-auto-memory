/** Shared PLAN is the source of truth. Revisions identify the **canonical** document
 * state (duplicate-anchor-free form), not raw bytes — see #472 below.
 * Derived indexes and role-like prose cannot authorize an update. */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { applyAnchorsPre } from './wb-sidecar.js'
import { fileWithinRoots } from './file-boundary.js'

/**
 * ★★#472（2026-11-02）：白板 revision 的**唯一口径** = 规范形（canonical）文本的 sha256。
 *
 * ── 缺陷（修前）────────────────────────────────────────────────────
 * 同一份文件在系统里同时存在**三种文本**：
 *   · raw      —— 磁盘原文（可能含重复 `<!-- memory:mem_xxx -->` 锚点）
 *   · healed   —— 早愈文本（healPlanDuplicateIdsPre 内存里去掉重复锚点的结果）
 *   · written  —— 落盘文本（anchoredPlanPre 重新分配 id 之后）
 * 读侧 `memory_read(kind=plan)` 给的是 **sha256(raw)**；写侧 CAS 与冲突档比的是
 * **sha256(healed)** ⇒ 对同一份含重复锚点的文件两值**恒不相等** ⇒ 白板永久冻结，
 * 且错误码是误导性的 `plan-version-conflict`（用户按提示重读重试，永远写不进）。
 *
 * ── 修法：让 revision 对「自愈」幂等 ────────────────────────────────
 * 在**计算摘要这一层**先把文本归一（去掉重复锚点）再取 sha256。于是：
 *   · 读侧 planRevisionPre(raw)      = sha256(heal(raw))
 *   · 写侧 planRevisionPre(healed)   = sha256(heal(heal(raw))) = sha256(heal(raw))
 *   ⇒ **两值相等**，CAS 自然通过；而 heal 是幂等的（做过一次就没有重复锚点了）。
 *
 * ── 为什么选「读侧按 healed 归一化」而不是「写侧在 heal 之前取基线」────────
 * “写侧先取基线”需要改 `lib/index.js` 的 writePlanSnapshot（把 rawExisting 与
 * healedExisting 分开持有），而我这一批的写域**不含 index.js**；更要命的是它**只修一半**：
 * 读侧仍报 sha256(raw)，任何按 `memory_read` 返回值回传 expectedRevision 的调用方
 * 依旧恒冲突 —— 只是把矛盾从写侧挪回调用方。归一化放在摘要层是一次性对齐**所有**
 * 摘要计算点（读侧 / CAS / 冲突档 / sidecar sourceRevisions），且不新增对外字段。
 *
 * ── 向后兼容的硬判据（已在 smoke-test-issue472 里真断言）──────────────
 * heal 对**无重复锚点**的文本是**恒等变换**（`healPlanDuplicateIdsPre` 在 healed===0
 * 时原样返回 raw）⇒ 干净白板的 revision **逐字节不变**，全部既有 pin 不受影响。
 *
 * ★顺带实证：`healPlanDuplicateIdsPre(workspaceKey, text)` 的 workspaceKey 参数
 *   **从未被函数体使用** —— 去重只看文本本身（同一文档内同 id 的第 2 次及以后出现）。
 *   故本函数传 '' 与传真实 ws key 结果完全一致；这也是它能安全前置到摘要层的前提。
 */
export function canonicalPlanTextPre(text) {
  const raw = String(text == null ? '' : text)
  try {
    const h = healPlanDuplicateIdsPre('', raw)
    return h && typeof h.text === 'string' ? h.text : raw
  } catch (_) { return raw }
}

/** 白板内容是否等价（同一规范形）。供写侧「外部编辑」判据复用，避免再拿原文比已愈文本。 */
export function planSameContentPre(a, b) { return planRevisionPre(a) === planRevisionPre(b) }

export const planRevisionPre = text => createHash('sha256').update(canonicalPlanTextPre(text)).digest('hex')
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

/**
 * healPlanDuplicateIdsPre —— 白板重复卡片 id 的**自愈**（2026-10-18 #449-3）。
 *
 * 背景：#434 在「落盘前」加了重复 id 闸门，命中即拒绝且不写盘。但 anchoredPlanPre
 *   **原样保留**已有锚点、不去重不重排 ⇒ 磁盘上已经存在的重复会被每次重写原样重建
 *   ⇒ 闸门**每次都命中**，存量白板永久写不进，且不再留恢复文件（比 #434 原报告更严重）。
 *
 * 策略（先自愈、失败才拒）：
 *   · 同 id 的多张卡里**保留第一张**的 id（它是合法身份的持有者）；
 *   · 其余重复卡的锚点**移除**，让下游 anchoredPlanPre 按 (ws, path, title, ordinal)
 *     重新分配一个新 id（新 id 与旧 id 不同 ⇒ 单卡编辑不再恒冲突）；
 *   · 返回 healed 数量，调用方可据此留痕。
 *
 * 只处理「同一文档内重复」，绝不改动唯一锚点；fence / user 区一律不动。
 */
export function healPlanDuplicateIdsPre(workspaceKey, text) {
  const raw = String(text == null ? '' : text)
  const lines = linesPre(raw)
  const seen = new Map()
  const out = []
  let fence = false, user = false, healed = 0
  for (let i = 0; i < lines.length; i++) {
    const r = lines[i][0]
    const line = r.replace(/\r?\n$/, '')
    out.push(r)
    if (/<!--\s*user\s*-->/.test(line)) user = true
    const inUser = user
    if (/<!--\s*\/user\s*-->/.test(line)) user = false
    if (/^\s*```/.test(line)) fence = !fence
    if (fence || inUser) continue
    const m = /^<!--\s*memory:(mem_[a-f0-9]{32})\s*-->\s*$/.exec(line)
    if (!m) continue
    const id = m[1]
    const n = seen.get(id) || 0
    seen.set(id, n + 1)
    if (n === 0) continue
    // 第 2 次及以后出现同一 id ⇒ 移除这行锚点（删的是刚 push 进去的那行）
    out.pop()
    healed++
  }
  if (!healed) return { text: raw, healed: 0 }
  return { text: out.join(''), healed }
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