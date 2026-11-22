import { createHash } from 'node:crypto'
import { stripSensitiveSections } from '../injection-policy.js'
import { parseHandoffLedgerPre, weightedTrimHandoffLedgerPre } from '../handoff-anchor.js'
import { filterCatalogVisiblePre, firstSentencePre, cutPre } from '../event-render.js'
import { projectCheckpointSectionsPre, projectEventSectionsPre } from './event-view.js'
import { adaptCalendar, adaptEvents, adaptHandoff, adaptPlan, adaptPortrait, adaptRules, bindUnits } from './unit-adapters.js'
import { prepareUnitRulesInputPre } from './unit-shadow.js'
import { LOCKED_MODULES } from './policy-v2.js'
import { PORTRAIT_MAX_CHARS } from '../user-portrait.js'
import { selectUnits, unitPolicyKey } from './unit-policy.js'

const METRICS = ['jsChars', 'utf8Bytes']
const LEDGER_CORE = new Set(['goal', 'progress', 'dead-end'])
const ANCHOR_PARTS = new Set(['frame-head', 'frame-tail'])
const MODULE_FOR_PART = {
  'rules-section': 'rules', 'whiteboard-plan': 'plan', 'handoff-ledger': 'handoff', 'handoff-pointer': 'handoff',
  'event-cards': 'events', 'event-catalog': 'events', 'event-unarchived': 'events', 'current-event': 'events',
  'user-portrait': 'portrait', 'semantic-recall': 'semantic', calendar: 'calendar',
  'external-memory': 'externalMemory', 'external-sessions': 'externalMemory', 'global-brief': 'externalMemory',
  'workspace-map': 'workspaceMap', 'recent-logs': 'recentLogs', reflection: 'reflection',
}
const ADAPTED_MODULES = new Set(['events', 'portrait', 'rules', 'plan', 'handoff', 'calendar'])
const TITLE_BY_KIND = {
  event: '事件', checkpoint: '检查点', catalogEntry: '事件目录', rule: '规则', ruleModule: '规则维护',
}
const READ_POINTER = {
  rules: 'memory_rules op=list', plan: 'memory_read(kind="plan")', handoff: 'memory_read(kind="handoff")',
  portrait: 'memory_recall(scope="events")', semantic: 'memory_recall', calendar: 'memory_read(kind="calendar")',
  externalMemory: 'memory_external', workspaceMap: 'memory_recall', recentLogs: 'memory_read(kind="log")',
  reflection: 'memory_read(kind="reflection")',
}

function cost(text) {
  return { jsChars: text.length, utf8Bytes: Buffer.byteLength(text, 'utf8') }
}

function add(left, right) {
  return { jsChars: left.jsChars + right.jsChars, utf8Bytes: left.utf8Bytes + right.utf8Bytes }
}

function fits(value, limits) {
  return METRICS.every(metric => limits[metric] === undefined || value[metric] <= limits[metric])
}

function bounds(transport, defaultChars) {
  const result = Number.isSafeInteger(defaultChars) && defaultChars >= 0 ? { jsChars: defaultChars } : {}
  for (const metric of METRICS) {
    if (transport?.[metric] === undefined) continue
    result[metric] = transport[metric] + (transport.strength === 'soft' ? (transport.overflowAllowance?.[metric] ?? 0) : 0)
  }
  return result
}

function roomAfter(limit, used) {
  return Object.fromEntries(METRICS.filter(metric => limit[metric] !== undefined)
    .map(metric => [metric, Math.max(0, limit[metric] - used[metric])]))
}

function safeCode(error) {
  return typeof error?.code === 'string' && /^[a-z-]{1,64}$/.test(error.code) ? error.code : 'invalid-source'
}

function tryAdapter(output, degradations, moduleId, adapt) {
  try {
    for (const raw of adapt()) {
      const text = stripSensitiveSections(raw.text)
      if (text) output.push({ ...raw, text })
    }
  } catch (error) {
    degradations.push({ moduleId, code: safeCode(error) })
  }
}

function refDigest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

function eventDisplay(raw) {
  const [, encodedId, , checkpointId] = raw.sourceRef.split(':')
  const id = decodeURIComponent(encodedId)
  if (!/^evt_[0-9a-f]{8}$/.test(id)) return null
  const ref = 'memory_recall(scope="events") #' + id
  return {
    ...raw, pointer: ref, eventId: id,
    // Legacy input sometimes uses the whole body as its checkpoint identity. Keep a stable digest in runtime memory.
    sourceRef: checkpointId ? 'event:' + encodedId + ':checkpoint:' + refDigest(checkpointId) : raw.sourceRef,
  }
}

function adaptEventForDelivery(event) {
  const sections = Object.fromEntries(projectEventSectionsPre(event).map(({ key, text }) => [key, text]))
  const checkpoints = (event.checkpoints ?? []).map(checkpoint => {
    if (!checkpoint || typeof checkpoint !== 'object') return checkpoint
    const parts = projectCheckpointSectionsPre(checkpoint)
    if (!parts.length) return checkpoint
    const text = parts.map(part => part.title + '：' + part.text).join('\n')
    const originalIdentity = checkpoint.sourceRef || checkpoint.checkpointId || checkpoint.id
      || checkpoint.idemKey || checkpoint.opId || JSON.stringify([checkpoint.kind ?? null, checkpoint.at ?? null, checkpoint.text ?? null, text])
    return { ...checkpoint, text, sourceRef: originalIdentity }
  })
  return { ...event, sections, checkpoints }
}

/** Reduce refresh-local event and portrait sources to non-mutating, disjoint delivery candidates. */
export function collectDeliveryEventUnitsPre({ events = [], portraitItems = [], now, recentClosedDays } = {}) {
  const rawUnits = [], degradations = []
  // [DECISION D30B-10 | 2026-11-22 | user ruling] Event recency controls visibility only.
  const visible = filterCatalogVisiblePre(events, { now, recentClosedDays }).visible
  for (const event of visible) {
    tryAdapter(rawUnits, degradations, 'events', () => adaptEvents({ events: [adaptEventForDelivery(event)] })
      .map(eventDisplay).filter(Boolean))
  }
  for (const item of portraitItems) tryAdapter(rawUnits, degradations, 'portrait', () => adaptPortrait({ portraitItems: [item] }))
  return { rawUnits, degradations }
}

function planRows(source) {
  const lines = stripSensitiveSections(source).split(/\r?\n/)
  const rows = []
  let current
  let fenced = false
  for (const line of lines) {
    if (/^\s*(?:\x60{3,}|~{3,})/.test(line)) fenced = !fenced
    const heading = !fenced && /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      current = { key: heading[1], heading: line, body: [] }
      rows.push(current)
    } else if (current) current.body.push(line)
  }
  return rows
}

function identifiedTag(row) {
  const tag = /\btype:(goal|progress|dead-end|state)\b/i.exec(row.key)
    || row.body.map(line => /^\s*type:(goal|progress|dead-end|state)\s*$/i.exec(line)).find(Boolean)
  return tag?.[1]?.toLowerCase()
}

function corePlanRow(row, names) {
  if (LEDGER_CORE.has(identifiedTag(row))) return true
  if (identifiedTag(row)) return false
  return names.some(name => row.key === name || row.key.startsWith(name + '（')
    || row.key.startsWith(name + '(') || row.key.startsWith(name + ' '))
}

function optionalPointer(moduleId, key, label) {
  const pointer = READ_POINTER[moduleId] + ' · ' + label
  return { moduleId, unitKind: 'deliveryModule', sourceRef: moduleId + ':pointer:' + key,
    text: pointer, pointer, forcePointer: true }
}

function preparePlan(source, policy, phase, degradations) {
  if (!source.planText?.trim()) return []
  // [DECISION D30B-11 | 2026-11-22 | user ruling] Handoff/compensation preserve host planSpec tier semantics.
  const special = phase === 'handoff_carry' || phase === 'hang_compensate'
  const full = special ? source.planSpec?.sections === null : policy.view === 'full'
  // [DECISION D30B-7 | 2026-11-22 | user ruling] Include the explicit goal/progress/dead-end sections in core.
  const names = policy.selection?.sections ?? source.planSpec?.sections ?? source.planCoreSections ?? []
  const output = []
  // [DECISION D30B-6 | 2026-11-22 | user ruling] Keep the plan source order and existing core section names.
  // [DECISION D30B-8 | 2026-11-22 | user ruling] Keep the existing per-section and plan total caps.
  let remaining = source.planTotalChars ?? Infinity
  for (const row of planRows(source.planText)) {
    if (!row.body.join('').trim()) continue
    if (!full && !corePlanRow(row, names)) {
      const pointer = optionalPointer('plan', encodeURIComponent(row.key), row.key)
      // Reserve source limits for core bodies before considering appendix pointers.
      output.push(pointer)
      continue
    }
    const limit = Math.min(remaining, source.planSpec?.maxChars ?? Infinity)
    if (limit <= row.heading.length + 2) break
    const body = cutPre(row.body.join('\n').trim(), limit - row.heading.length - 2)
    const rows = adaptPlan({ sections: [{ key: row.key, text: row.heading + '\n' + body }] })
    for (const item of rows) {
      remaining -= item.text.length + 1
      output.push({ ...item, pointer: READ_POINTER.plan + ' · ' + row.key })
    }
  }
  // [DECISION D30B-9 | 2026-11-22 | user ruling] An unmatched plan produces a receipt entry and no original body.
  if (!output.some(unit => unit.unitKind === 'planSection')) {
    degradations.push({ moduleId: 'plan', code: 'plan-no-eligible-sections' })
    return []
  }
  return output.filter(unit => {
    if (!unit.forcePointer) return true
    const size = labeled(unit, unit.text).length + 1
    if (size > remaining) return false
    remaining -= size
    return true
  })
}

function prepareLedger(source, policy, phase, degradations) {
  if (!source.handoffText?.trim()) return []
  const parsed = parseHandoffLedgerPre(stripSensitiveSections(source.handoffText))
  const sections = parsed?.sections?.filter(section => section.body.some(line => line.trim())) ?? []
  const units = []
  for (const section of sections) {
    try { units.push(...adaptHandoff({ sections: [section] })) } catch (error) {
      if (error?.detail?.field !== 'sections[0].title') throw error
      degradations.push({ moduleId: 'handoff', code: 'handoff-section-unrecognized' })
    }
  }
  // [DECISION D30B-11 | 2026-11-22 | user ruling] Preserve the host's full ledger for handoff and compensation.
  const core = policy.view === 'sections' && phase !== 'handoff_carry' && phase !== 'hang_compensate'
  const tagOf = unit => unit.sourceRef.split(':').at(-1)
  const retained = units.filter(unit => !core || LEDGER_CORE.has(tagOf(unit)))
  if (!retained.length) {
    degradations.push({ moduleId: 'handoff', code: 'handoff-no-eligible-sections' })
    return []
  }
  const combined = retained.map(unit => unit.text).join('\n')
  const limit = source.handoffMaxChars ?? Infinity
  const budgeted = combined.length > limit ? weightedTrimHandoffLedgerPre(combined, limit) : combined
  const selected = new Map()
  for (const section of parseHandoffLedgerPre(budgeted)?.sections ?? []) {
    try {
      for (const unit of adaptHandoff({ sections: [section] })) selected.set(unit.sourceRef, unit)
    } catch (_) { /* Weighted trimming can leave a partially cut heading. */ }
  }
  let remaining = limit - [...selected.values()].reduce((sum, unit) => sum + unit.text.length + 1, 0)
  return units.flatMap(unit => {
    const tag = tagOf(unit)
    if (core && !LEDGER_CORE.has(tag)) {
      const pointer = optionalPointer('handoff', tag, 'type:' + tag)
      const size = labeled(pointer, pointer.text).length + 1
      if (size > remaining) return []
      remaining -= size
      return [pointer]
    }
    const chosen = selected.get(unit.sourceRef)
    return chosen ? [{ ...chosen, pointer: READ_POINTER.handoff + ' · type:' + tag }] : []
  })
}

function moduleCandidates(policy, phase, snapshot, sources, parts, degradations) {
  const output = [...(snapshot?.rawUnits ?? [])]
  const modules = policy.modules
  if (modules.rules.enabled && sources.rules) {
    tryAdapter(output, degradations, 'rules', () => {
      const maintenance = phase === 'human_slim' && modules.rules.maintenance !== false ? sources.maintenance : undefined
      const prepared = prepareUnitRulesInputPre(sources.rules, maintenance)
      if (prepared.identitySynthesized) degradations.push({ moduleId: 'rules', code: 'rules-identity-synthesized' })
      return adaptRules(prepared.input).map(unit => unit.unitKind === 'ruleModule'
        ? { ...unit, unitKind: 'deliveryModule', forcePointer: true } : unit)
    })
  }
  if (modules.plan.enabled) tryAdapter(output, degradations, 'plan', () => preparePlan(sources, modules.plan, phase, degradations))
  if (modules.handoff.enabled) tryAdapter(output, degradations, 'handoff', () => prepareLedger(sources, modules.handoff, phase, degradations))
  if (modules.calendar.enabled && Array.isArray(sources.calendarEntries)) {
    tryAdapter(output, degradations, 'calendar', () => adaptCalendar({ entries: sources.calendarEntries }))
  }
  for (const { kind, text } of parts) {
    const moduleId = MODULE_FOR_PART[kind]
    if (!moduleId || ADAPTED_MODULES.has(moduleId) || !modules[moduleId].enabled) continue
    output.push({ moduleId, unitKind: 'deliveryModule', sourceRef: moduleId + ':part:' + kind,
      text, pointer: READ_POINTER[moduleId] ?? null })
  }
  return output
}

function permittedView(raw, modulePolicy, sources) {
  if (raw.unitKind === 'catalogEntry' && modulePolicy.view !== 'cards+catalog') return false
  if (raw.unitKind === 'calendarEntry' && modulePolicy.view === 'current' && typeof sources.today === 'string') {
    return raw.text.startsWith('- [ ] ' + sources.today + ' ') || raw.text.startsWith('- [x] ' + sources.today + ' ')
  }
  return true
}

function labeled(raw, body) {
  const title = TITLE_BY_KIND[raw.unitKind] ?? (raw.forcePointer ? '来源指针' : '')
  const id = raw.eventId ? ' #' + raw.eventId : ''
  return title ? '[' + title + id + '] ' + body : body
}

function renderRepresentation(raw, representation) {
  if (representation === 'pointer') return raw.pointer || READ_POINTER[raw.moduleId] || ''
  if (representation === 'summary') return firstSentencePre(raw.text)
  if (representation === 'preview') return cutPre(raw.text, 300)
  return raw.text
}

function prepareCandidates(input, policy, sources, neutralize) {
  return input.flatMap(raw => {
    const modulePolicy = policy.modules[raw.moduleId]
    if (!permittedView(raw, modulePolicy, sources)) return []
    let preferred = policy.representation.preferred
    if (raw.forcePointer || modulePolicy.view === 'pointer') preferred = 'pointer'
    else if (modulePolicy.view === 'summary') preferred = 'summary'
    const representations = raw.forcePointer || modulePolicy.view === 'pointer' ? ['pointer']
      : [preferred, ...policy.representation.fallback]
    const variants = []
    for (const rep of new Set(representations)) {
      if (rep === 'omit') break
      const text = renderRepresentation(raw, rep)
      if (text) variants.push({ rep, text: '\n' + neutralize(labeled(raw, text)) })
    }
    return variants.length ? [{ raw, variants }] : []
  })
}

function inputUnit(candidate, variant) {
  const { raw } = candidate
  return { moduleId: raw.moduleId, unitKind: raw.unitKind, sourceRef: raw.sourceRef,
    text: variant.text, pointer: raw.pointer }
}

function identity(raw) {
  return raw.moduleId + ':' + raw.unitKind + ':' + raw.sourceRef
}

function lockedUnit(part) {
  const moduleId = part.kind, sourceRef = moduleId + ':tail-window'
  return { id: moduleId + ':memoryRecord:' + sourceRef, moduleId, unitKind: 'memoryRecord',
    view: 'full', policyKey: unitPolicyKey({ moduleId, view: 'full' }, '@unbounded'),
    priority: 0, cost: cost(part.text), text: part.text, pointer: null, sourceRef }
}

function overModuleLimits(selected, policy) {
  const totals = new Map(), excess = new Map()
  for (const unit of selected) {
    if (LOCKED_MODULES.includes(unit.moduleId) || excess.has(unit.moduleId)) continue
    const moduleCap = bounds(policy.modules[unit.moduleId].transport)
    // Enforce the portrait ceiling after quota admission and representation selection.
    if (unit.moduleId === 'portrait') moduleCap.jsChars = Math.min(moduleCap.jsChars ?? Infinity, PORTRAIT_MAX_CHARS)
    const next = add(totals.get(unit.moduleId) ?? cost(''), unit.cost)
    if (fits(next, moduleCap)) totals.set(unit.moduleId, next)
    else excess.set(unit.moduleId, unit)
  }
  return excess
}

function pickVariants(candidates, policy, phase, limit, locked, auxiliaryCost, degradations) {
  const representations = new Map(candidates.map(candidate => [identity(candidate.raw), 0]))
  const byId = new Map(candidates.map(candidate => [identity(candidate.raw), candidate]))
  const budget = roomAfter(limit, auxiliaryCost)
  for (;;) {
    const ordinary = candidates.flatMap(candidate => {
      const variant = candidate.variants[representations.get(identity(candidate.raw))]
      return variant ? [inputUnit(candidate, variant)] : []
    })
    const selection = selectUnits({ units: [...locked, ...bindUnits(ordinary, policy)], policy, phase, budget })
    if (selection.budgetOvercommit) return selection
    // Charge module transport only after quota and global budget admission. A rejected item cannot reserve space.
    const excess = overModuleLimits(selection.selected, policy)
    if (excess.size) {
      for (const [moduleId, unit] of excess) {
        representations.set(unit.id, representations.get(unit.id) + 1)
        degradations.push({ moduleId, code: 'module-transport-limit' })
      }
      continue
    }
    let reduced = false
    for (const unit of selection.deferred) {
      const index = representations.get(unit.id)
      if (index + 1 >= byId.get(unit.id).variants.length) continue
      representations.set(unit.id, index + 1)
      reduced = true
    }
    if (!reduced) {
      for (const unit of selection.selected) {
        if (representations.get(unit.id) > 0) degradations.push({ moduleId: unit.moduleId, code: 'representation-degraded' })
      }
      return selection
    }
  }
}

function safeReceipt(degradations, selection, chosen, limits, staticText, finalText, budgetOvercommit, policy) {
  const countByModule = {}
  for (const unit of chosen) {
    const byKind = countByModule[unit.moduleId] ??= {}
    byKind[unit.unitKind] = (byKind[unit.unitKind] ?? 0) + 1
  }
  const frameCost = add(cost(staticText), cost(finalText))
  return {
    mode: 'units', budget: limits, cost: frameCost, staticCost: cost(staticText),
    dynamicCost: cost(finalText), m6Included: false, budgetOvercommit,
    counts: countByModule, selectedCount: chosen.length, rejectedCount: selection.rejected.length,
    deferredCount: selection.deferred.length, truncatedBy: selection.truncatedBy,
    softTargetExceeded: policy.transport?.strength === 'soft'
      && METRICS.some(metric => policy.transport[metric] !== undefined && frameCost[metric] > policy.transport[metric]),
    degradations: Array.from(new Map(degradations.map(entry => [entry.moduleId + ':' + entry.code, entry])).values()),
  }
}

function joinParts(head, chosen, extras, footer, suffixText) {
  return [...head, ...chosen, ...extras, ...footer].map(part => part.text).join('') + suffixText
}

/** Compose the actual dynamic text from isolated existing reads and finalized source units. */
export function composeUnitDeliveryPre({
  policy, phase, sourceSnapshot, sources = {}, parts = [], staticText = '', budgetChars, suffixText = '',
  neutralize = text => text,
}) {
  const degradations = [...(sourceSnapshot?.degradations ?? [])]
  const seen = new Set()
  const raws = moduleCandidates(policy, phase, sourceSnapshot, sources, parts, degradations)
    .filter(raw => {
      const id = identity(raw)
      if (seen.has(id)) { degradations.push({ moduleId: raw.moduleId, code: 'duplicate-id' }); return false }
      seen.add(id)
      return true
    })
  const candidates = prepareCandidates(raws, policy, sources, neutralize)
  const normalized = parts.filter(part => part.text && !MODULE_FOR_PART[part.kind])
    .map(part => ({ ...part, text: '\n' + neutralize(part.text).replace(/^\n/, '') }))
  const locked = normalized.filter(part => LOCKED_MODULES.includes(part.kind)).map(lockedUnit)
  // [DECISION D30B-1 | 2026-11-22 | user ruling] There is one frame limit across full and compact tiers.
  const limit = bounds(policy.transport, budgetChars)
  // [DECISION D30B-2 | 2026-11-22 | user ruling] Charge static discipline and its separator here. M6 has its own budget.
  const staticCost = cost(staticText)
  const lockedCost = locked.reduce((all, unit) => add(all, unit.cost), staticCost)
  let used = lockedCost
  let suffix = suffixText
  const take = text => {
    const next = add(used, cost(text))
    if (!fits(next, limit)) return false
    used = next
    return true
  }
  if (!take(suffix)) suffix = ''
  const head = normalized.filter(part => part.kind === 'frame-head' && take(part.text))
  const footer = normalized.filter(part => part.kind === 'frame-tail' && take(part.text))
  const reserved = add(staticCost, cost(joinParts(head, [], [], footer, suffix)))
  const selection = pickVariants(candidates, policy, phase, limit, locked, reserved, degradations)
  // [DECISION D30B-3 | 2026-11-22 | user ruling] Locked MEMORY windows survive budget overcommit.
  const overcommit = !fits(lockedCost, limit)
  const byId = new Map(selection.selected.map(unit => [unit.id, unit]))
  const selected = candidates.map(candidate => byId.get(identity(candidate.raw))).filter(Boolean)
  used = add(reserved, selection.cost)
  const optional = normalized.filter(part => !LOCKED_MODULES.includes(part.kind) && !ANCHOR_PARTS.has(part.kind))
  // [DECISION D30B-12 | 2026-11-22 | user ruling] Diagnostics stay optional and use the provider's bounded output.
  const extras = overcommit ? [] : optional.filter(part => (part.kind !== 'diagnostic' || policy.modules.diagnostics.enabled) && take(part.text))
  const text = joinParts(head, [...locked, ...selected], extras, footer, suffix)
  if (overcommit) degradations.push({ moduleId: 'frame', code: 'budgetOvercommit' })
  if (selection.deferred.length || extras.length < optional.length || suffix !== suffixText) {
    degradations.push({ moduleId: 'frame', code: 'frame-content-omitted' })
  }
  return { text, receipt: safeReceipt(degradations, selection, [...locked, ...selected], limit, staticText, text, overcommit, policy) }
}
