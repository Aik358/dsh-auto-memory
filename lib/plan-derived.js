import { planCardsPre, planRevisionPre } from './plan-store.js'
import { applyAnchorsPre } from './wb-sidecar.js'

export const DERIVED_PLAN_TOTAL_CHAR_MAX = 30000
export const DERIVED_PLAN_RECENT_TITLE = '近期进展（按时间倒序）'
const FIXED_TITLES = new Set(['当前状态', DERIVED_PLAN_RECENT_TITLE, '关键约束', '待办'])
const EVENT_ID_RE = /^evt_[0-9a-f]{8}$/
const MEM_ID_RE = /^mem_[0-9a-f]{32}$/
const LINE_RE = /[^\n]*(?:\n|$)/g
const MEMORY_LINE_RE = /^<!--\s*memory:mem_[a-f0-9]{32}\s*-->[ \t]*(?:\r?\n|$)/

const failure = (error, extra = {}) => ({ ok: false, error, reason: error, archivedIds: [], ...extra })
const headingName = (card) => String(card.title || '').replace(/^#{2,4}\s+/, '').trim()
const headingLevel = (card) => (String(card.title || '').match(/^#{2,4}/) || ['##'])[0].length
const firstLine = (text) => String(text || '').match(/^[^\n]*(?:\n|$)/)?.[0] || ''
const eolOf = (text) => String(text || '').includes('\r\n') ? '\r\n' : '\n'
function marker(kind, close = false) {
  if (kind === 'user') return close ? /<!--\s*\/user\s*-->/ : /<!--\s*user\s*-->/
  return close ? /<!--\s*\/model\s*-->/ : /<!--\s*model\s*-->/
}
function regionsOf(text, kind) {
  const source = String(text || '')
  const output = []
  let start = -1
  let fence = false
  for (const match of source.matchAll(LINE_RE)) {
    const line = match[0]
    if (!line) continue
    if (/^\s*\`\`\`/.test(line)) fence = !fence
    if (fence) continue
    if (start < 0 && marker(kind).test(line)) start = match.index
    if (start >= 0 && marker(kind, true).test(line)) {
      const end = match.index + line.length
      output.push({ start, end, text: source.slice(start, end) })
      start = -1
    }
  }
  return output
}
function validateRegions(text) {
  for (const kind of ['user', 'model']) {
    let depth = 0
    let fence = false
    for (const match of String(text || '').matchAll(LINE_RE)) {
      const line = match[0]
      if (!line) continue
      if (/^\s*\`\`\`/.test(line)) fence = !fence
      if (fence) continue
      if (marker(kind).test(line)) {
        if (depth) return failure('derived-' + kind + '-nested')
        depth++
      }
      if (marker(kind, true).test(line)) {
        if (!depth) return failure('derived-' + kind + '-unclosed')
        depth--
      }
    }
    if (depth) return failure('derived-' + kind + '-unclosed')
  }
  return null
}
function modelBinding(card) {
  const regions = regionsOf(card.text, 'model')
  if (!regions.length) return null
  if (regions.length !== 1) return { error: 'derived-binding-duplicate' }
  const eventId = regions[0].text.match(/\beventId\s*[:=]\s*(evt_[0-9a-f]{8})\b/)?.[1] || ''
  const memId = regions[0].text.match(/\bmemId\s*[:=]\s*(mem_[0-9a-f]{32})\b/)?.[1] || ''
  if (!EVENT_ID_RE.test(eventId) || !MEM_ID_RE.test(memId)) return { error: 'derived-binding-missing' }
  if (card.id !== memId) return { error: 'derived-binding-mismatch' }
  return { eventId, memId }
}
function hasUser(card) { return regionsOf(card.text, 'user').length > 0 }
function userBytes(card) { return regionsOf(card.text, 'user').map((region) => region.text).join('') }
function withoutMetadata(card) {
  const first = firstLine(card.text)
  let body = card.text.slice(first.length).replace(MEMORY_LINE_RE, '')
  for (const region of [...regionsOf(body, 'model'), ...regionsOf(body, 'user')].sort((a, b) => b.start - a.start)) {
    body = body.slice(0, region.start) + body.slice(region.end)
  }
  return first + body
}
function truncated(text) {
  return text.length > DERIVED_PLAN_TOTAL_CHAR_MAX || (text.length >= DERIVED_PLAN_TOTAL_CHAR_MAX && text.endsWith('…'))
}
function parseDocument(text) {
  const invalid = validateRegions(text)
  if (invalid) return invalid
  const cards = planCardsPre(text).map((card, index) => ({ ...card, index, level: headingLevel(card), name: headingName(card), parent: null }))
  const anchors = new Map()
  const events = new Map()
  const fixed = new Map()
  const stack = []
  for (const card of cards) {
    while (stack.length && stack[stack.length - 1].level >= card.level) stack.pop()
    card.parent = stack.at(-1) || null
    stack.push(card)
    if (card.id) {
      if (anchors.has(card.id)) return failure('derived-anchor-duplicate', { memId: card.id })
      anchors.set(card.id, card)
    }
    const binding = modelBinding(card)
    if (binding?.error) return failure(binding.error, { memId: card.id || null })
    card.model = binding
    if (binding) {
      if (events.has(binding.eventId)) return failure('derived-binding-duplicate', { eventId: binding.eventId })
      events.set(binding.eventId, card)
    }
    if (card.level === 2 && FIXED_TITLES.has(card.name)) {
      if (fixed.has(card.name)) return failure('derived-section-duplicate', { title: card.name })
      fixed.set(card.name, card)
    }
  }
  const preamble = cards.length ? text.slice(0, cards[0].start) : text
  if (regionsOf(preamble, 'model').length) return failure('derived-binding-missing')
  return { ok: true, text, cards, anchors, events, fixed, preamble }
}
function blockEnd(doc, card) {
  return doc.cards.find((candidate) => candidate.start > card.start && candidate.level <= card.level)?.start ?? doc.text.length
}
function blockText(doc, card) { return doc.text.slice(card.start, blockEnd(doc, card)) }
function childrenOf(doc, card) { return doc.cards.filter((candidate) => candidate.parent === card) }
function directEnd(doc, card) {
  return doc.cards.find((candidate) => candidate.start > card.start)?.start ?? doc.text.length
}
function directText(doc, card) { return doc.text.slice(card.start, directEnd(doc, card)) }
function fixedCard(doc, card, previous, children) {
  const direct = directText(doc, card)
  const first = firstLine(direct)
  let text = first
  if (previous?.id) text += '<!-- memory:' + previous.id + ' -->' + eolOf(first)
  text += direct.slice(first.length)
  if (previous) text += userBytes({ text: directText(doc, previous) })
  return text + children.join('')
}
function generatedCard(doc, raw, eventId, previous) {
  const body = withoutMetadata({ ...raw, text: blockText(doc, raw) })
  const first = firstLine(body)
  const anchor = previous ? '<!-- memory:' + previous.id + ' -->' + eolOf(body) : ''
  const binding = '<!-- model -->' + eolOf(body) + 'eventId: ' + eventId + eolOf(body) + 'memId: ' + (previous ? previous.id : 'pending') + eolOf(body) + '<!-- /model -->' + eolOf(body)
  return first + anchor + body.slice(first.length) + binding + (previous ? userBytes(previous) : '')
}

/**
 * Pure derived-PLAN merge. The caller must supply existing from inside PLAN.lock.
 * rendered may be a string or {text,eventIds}; IDs follow the actual recent ###
 * cards, not input order or ordinal. No title-only event adoption is permitted.
 */
export function mergeDerivedPlanPre(existing, rendered, options = {}) {
  try {
    const before = String(existing == null ? '' : existing)
    const renderedText = String(typeof rendered === 'string' ? rendered : rendered?.text ?? rendered?.content ?? '')
    const suppliedIds = Object.prototype.hasOwnProperty.call(options, 'eventIds') ? options.eventIds : (typeof rendered === 'object' && rendered ? rendered.eventIds : undefined)
    if (suppliedIds !== undefined && !Array.isArray(suppliedIds)) return failure('derived-event-ids-invalid')
    if (truncated(before) || truncated(renderedText)) return failure('derived-plan-truncated')
    const old = parseDocument(before)
    if (!old.ok) return old
    const next = parseDocument(renderedText)
    if (!next.ok) return next
    const nextRecent = next.fixed.get(DERIVED_PLAN_RECENT_TITLE)
    const oldRecent = old.fixed.get(DERIVED_PLAN_RECENT_TITLE)
    const nextEvents = nextRecent ? childrenOf(next, nextRecent) : []
    if (!suppliedIds || suppliedIds.length !== nextEvents.length) return failure('derived-event-ids-mismatch')
    const seenEvents = new Set()
    const inherited = []
    const newEventIds = []
    const generated = []
    for (let index = 0; index < nextEvents.length; index++) {
      const raw = nextEvents[index]
      const suppliedId = suppliedIds?.[index] ?? ''
      const eventId = suppliedId || raw.model?.eventId || ''
      if (!EVENT_ID_RE.test(eventId)) return failure('derived-binding-missing', { title: raw.name, index })
      if (seenEvents.has(eventId)) return failure('derived-binding-duplicate', { eventId })
      seenEvents.add(eventId)
      if (raw.model && suppliedId && raw.model.eventId !== suppliedId) return failure('derived-binding-mismatch', { eventId: suppliedId })
      const previous = old.events.get(eventId) || null
      if (previous) inherited.push({ eventId, memId: previous.id })
      else newEventIds.push(eventId)
      generated.push({ index, text: generatedCard(next, raw, eventId, previous) })
    }
    const archivedIds = []
    const preservedIds = []
    const frozenIds = []
    const retainedRecent = []
    for (const raw of oldRecent ? childrenOf(old, oldRecent) : []) {
      const text = blockText(old, raw)
      if (raw.model && seenEvents.has(raw.model.eventId)) continue
      if (raw.model && !hasUser(raw)) {
        archivedIds.push(raw.id)
        continue
      }
      if (raw.model) frozenIds.push(raw.id)
      if (raw.id) preservedIds.push(raw.id)
      retainedRecent.push({ index: raw.index, text })
    }
    const recent = []
    for (const item of [...generated, ...retainedRecent].sort((a, b) => a.index - b.index)) recent.push(item.text)

    const selfTop = old.cards.filter((card) => !card.model && card.level === 2 && !FIXED_TITLES.has(card.name))
    const customBlocks = []
    let previousFixed = null
    for (const card of old.cards.filter((candidate) => candidate.level === 2)) {
      if (FIXED_TITLES.has(card.name)) previousFixed = card.name
      else if (!card.model) customBlocks.push({ before: previousFixed, text: blockText(old, card) })
    }
    for (const block of customBlocks) if (block.text.match(/<!--\s*memory:(mem_[0-9a-f]{32})\s*-->/)) preservedIds.push(...block.text.matchAll(/<!--\s*memory:(mem_[a-f0-9]{32})\s*-->/g).map((match) => match[1]))
    const fixedChildren = new Map()
    for (const card of old.cards.filter((candidate) => !candidate.model && candidate.parent && candidate.parent.level === 2 && FIXED_TITLES.has(candidate.parent.name) && candidate.parent.name !== DERIVED_PLAN_RECENT_TITLE)) {
      const title = candidate.parent.name
      if (!fixedChildren.has(title)) fixedChildren.set(title, [])
      fixedChildren.get(title).push(blockText(old, card))
      if (card.id) preservedIds.push(card.id)
    }
    const firstFixedCard = old.cards.find((card) => card.level === 2 && FIXED_TITLES.has(card.name))
    const oldPreamble = old.text.slice(0, firstFixedCard?.start ?? old.text.length)
    const oldPreambleCards = old.cards.filter((card) => !card.model && !card.parent && card.start < (firstFixedCard?.start ?? old.text.length))
    const customPreamble = oldPreambleCards.length || regionsOf(oldPreamble, 'user').length || (oldPreamble && !oldPreamble.startsWith('# 项目白板 · '))
    const protectedTexts = []
    const protect = (text) => {
      if (!text) return ''
      const token = '\n<derived-preserved-' + protectedTexts.length + '>\n'
      protectedTexts.push({ token, text })
      return token
    }
    const parts = []
    if (customPreamble) {
      if (oldPreambleCards.length) {
        const first = oldPreambleCards[0]
        const last = oldPreambleCards.at(-1)
        parts.push(protect(old.text.slice(0, first.start) + oldPreambleCards.map((card) => blockText(old, card)).join('')))
        parts.push(old.text.slice(blockEnd(old, last), firstFixedCard?.start ?? old.text.length))
      } else parts.push(protect(oldPreamble))
    } else parts.push(next.preamble)
    const customBefore = (title) => {
      for (const block of customBlocks.filter((candidate) => candidate.before === title)) parts.push(protect(block.text))
    }
    if (!customPreamble) customBefore(null)
    for (const raw of next.cards.filter((card) => card.level === 2 && FIXED_TITLES.has(card.name))) {
      const previous = old.fixed.get(raw.name) || null
      const children = raw.name === DERIVED_PLAN_RECENT_TITLE ? recent : (fixedChildren.get(raw.name) || []).map(protect)
      parts.push(fixedCard(next, raw, previous, children))
      customBefore(raw.name)
    }
    customBefore('__end__')
    for (const block of customBlocks.filter((candidate) => candidate.before === null && !parts.includes(candidate.text))) {
      // null blocks were already emitted before the first fixed section.
    }
    let merged = parts.join('')
    for (const item of protectedTexts) {
      // Keep placeholders through anchor allocation so unanchored human cards
      // never receive a new ID or lose a byte. They are restored below.
      if (!merged.includes(item.token)) return failure('derived-custom-card-preserved')
    }
    const replacements = []
    const allocatedOrdinals = new Map()
    for (const card of planCardsPre(merged)) {
      if (!card.text.includes('memId: pending')) continue
      const ordinal = allocatedOrdinals.get(card.title) || 0
      allocatedOrdinals.set(card.title, ordinal + 1)
      const anchor = applyAnchorsPre(options.workspaceKey || 'workspace', 'handoff/PLAN.md', firstLine(card.text), () => ordinal).text
      const id = anchor.match(/memory:(mem_[0-9a-f]{32})/)?.[1]
      if (!id) return failure('derived-binding-missing')
      replacements.push({ start: card.start, end: card.end, text: anchor + card.text.slice(firstLine(card.text).length).replace('memId: pending', 'memId: ' + id) })
    }
    for (const item of replacements.sort((a, b) => b.start - a.start)) merged = merged.slice(0, item.start) + item.text + merged.slice(item.end)
    for (const item of protectedTexts) {
      const tokenComment = item.token.replace(/^\n/, '').replace(/\n$/, '')
      merged = merged.replace('<!-- ' + tokenComment + ' -->', () => item.text)
      merged = merged.replace(item.token, () => item.text)
    }
    if (truncated(merged)) return failure('derived-plan-truncated')
    const finalDoc = parseDocument(merged)
    if (!finalDoc.ok) return { ...finalDoc, debugMerged: merged }
    for (const eventId of seenEvents) if (!finalDoc.events.has(eventId)) return failure('derived-binding-missing', { eventId })
    const eventBindings = [...finalDoc.events.entries()].map(([eventId, card]) => ({ eventId, memId: card.id }))
    return {
      ok: true, text: merged, content: merged,
      changed: merged !== before, revision: planRevisionPre(merged), bytes: Buffer.byteLength(merged, 'utf8'),
      archivedIds: [...new Set(archivedIds)], preservedIds: [...new Set(preservedIds)], frozenIds: [...new Set(frozenIds)],
      inherited, newEventIds, eventBindings, bindings: Object.fromEntries(eventBindings.map((item) => [item.eventId, item.memId])),
      cardCount: finalDoc.cards.length, anchorCount: finalDoc.anchors.size,
    }
  } catch (error) {
    return failure('derived-merge-threw: ' + String(error?.message || error))
  }
}
