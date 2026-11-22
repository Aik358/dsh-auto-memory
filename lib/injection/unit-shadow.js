import {
  adaptCalendar,
  adaptEvents,
  adaptHandoff,
  adaptPlan,
  adaptPortrait,
  adaptRules,
  bindUnits,
} from './unit-adapters.js'
import { selectUnits } from './unit-policy.js'
import { parseHandoffLedgerPre } from '../handoff-anchor.js'

export const UNIT_SHADOW_VERSION = 1

const COVERED = Object.freeze(['events', 'rules', 'plan', 'handoff', 'portrait', 'calendar'])
const MAX_UNIT_IDS = 40
const MAX_RECEIPT_BYTES = 4096
const HANDOFF_TITLES = Object.freeze([
  ['goal', '目标', ['目标', '目的']],
  ['doing', '任务状态', ['任务状态', '当前状态', '进行中']],
  ['deadend', '已试方案与失败原因', ['已试方案与失败原因', '失败与弯路', '失败原因', '已试方案']],
  ['next', '进度与下一步', ['进度与下一步', '下一步', '接下来']],
])

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
}

function stringValue(value) {
  return typeof value === 'string' ? value : ''
}

function safeBudget(value) {
  const source = isRecord(value) ? value : {}
  const safe = key => Number.isSafeInteger(source[key]) && source[key] >= 0 ? source[key] : 0
  return { jsChars: safe('jsChars'), utf8Bytes: safe('utf8Bytes') }
}

function safeCode(error) {
  return typeof error?.code === 'string' && /^[a-z0-9-]{1,64}$/i.test(error.code)
    ? error.code : 'shadow-computation-failed'
}

function safeMessage(error) {
  const value = typeof error?.message === 'string' ? error.message : 'Shadow projection failed'
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 120)
}

function makeReceipt(input) {
  const source = isRecord(input) ? input : {}
  const now = Number.isFinite(source.now) ? source.now : null
  const phase = typeof source.phase === 'string' ? source.phase.slice(0, 32) : null
  return {
    version: UNIT_SHADOW_VERSION,
    computed: false,
    at: now,
    assumed: {
      phase,
      budget: safeBudget(source.budget),
      reason: 'refresh-before-tier',
    },
    covered: COVERED.slice(),
    counts: { raw: 0, selected: 0, deferred: 0, rejected: 0 },
    cost: { jsChars: 0, utf8Bytes: 0 },
    truncatedBy: null,
    budgetOvercommit: false,
    unitIds: [],
    degradations: [],
  }
}

function trimReceipt(receipt, selected) {
  const ids = Array.isArray(selected) ? selected.map(unit => stringValue(unit && unit.id)).filter(Boolean) : []
  receipt.unitIds = []
  for (const id of ids.slice(0, MAX_UNIT_IDS)) {
    const next = [...receipt.unitIds, id]
    const serialized = JSON.stringify({ ...receipt, unitIds: next })
    if (Buffer.byteLength(serialized, 'utf8') > MAX_RECEIPT_BYTES) break
    receipt.unitIds.push(id)
  }
  return receipt
}

function recordDegradation(receipt, source, error, code) {
  receipt.degradations.push({
    source,
    code: code || safeCode(error),
    message: safeMessage(error),
  })
}

function hasRuleRevision(item) {
  return typeof item?.revision === 'string' && item.revision.trim() !== ''
}

function hasRuleIndex(item, key) {
  return Number.isSafeInteger(item && item[key]) && item[key] >= 0
}

function ruleRecord(item, category, index, fallbackRevision, noteSynthesis) {
  if (!isRecord(item)) throw Object.assign(new TypeError('Invalid rules item'), { code: 'invalid-source' })
  const revision = hasRuleRevision(item) ? item.revision : fallbackRevision
  const entryIndex = hasRuleIndex(item, 'entryIndex') ? item.entryIndex : index
  const itemIndex = hasRuleIndex(item, 'itemIndex') ? item.itemIndex : 0
  const segmentIndex = hasRuleIndex(item, 'segmentIndex') ? item.segmentIndex : itemIndex
  if (!hasRuleRevision(item) || !hasRuleIndex(item, 'entryIndex')
      || !hasRuleIndex(item, 'itemIndex') || !hasRuleIndex(item, 'segmentIndex')) noteSynthesis()
  const kind = category === 'rules' ? 'rule' : category === 'notes' ? 'note'
    : category === 'candidates' ? 'candidate' : 'reference'
  const id = typeof item.id === 'string' && item.id ? item.id : 'entry-' + index
  return {
    layer: item.layer,
    revision,
    entryIndex,
    itemIndex,
    segmentIndex,
    entryId: typeof item.parentId === 'string' && item.parentId ? item.parentId : id,
    itemId: typeof item.itemId === 'string' && item.itemId ? item.itemId : id,
    kind,
    status: 'current',
    text: item.text,
  }
}

function rulesInput(source, maintenance) {
  if (!isRecord(source)) throw Object.assign(new TypeError('Rules aggregate is missing'), { code: 'invalid-source' })
  // extractRulesLayerPre has no document revision or segment tuple; use a refresh-local identity only for this shadow pass.
  const fallbackRevision = 'refresh-local-v' + String(Number.isSafeInteger(source.version) ? source.version : 1)
  let identitySynthesized = false
  const noteSynthesis = () => { identitySynthesized = true }
  const sourceRules = Array.isArray(source.rules) ? source.rules : []
  const rules = sourceRules.filter(item => item && item.kind !== 'note')
    .map((item, index) => ruleRecord(item, 'rules', index, fallbackRevision, noteSynthesis))
  const notes = [
    ...sourceRules.filter(item => item && item.kind === 'note'),
    ...(Array.isArray(source.notes) ? source.notes : []),
  ].map((item, index) => ruleRecord(item, 'notes', index, fallbackRevision, noteSynthesis))
  const candidates = (Array.isArray(source.candidates) ? source.candidates : [])
    .map((item, index) => ruleRecord(item, 'candidates', index, fallbackRevision, noteSynthesis))
  const references = (Array.isArray(source.references) ? source.references : [])
    .map((item, index) => ruleRecord(item, 'references', index, fallbackRevision, noteSynthesis))
  const retired = (Array.isArray(source.retired) ? source.retired : []).map((item, index) => {
    if (!isRecord(item)) throw Object.assign(new TypeError('Invalid retired rules item'), { code: 'invalid-source' })
    const itemIndex = hasRuleIndex(item, 'itemIndex') ? item.itemIndex : 0
    const entryIndex = hasRuleIndex(item, 'entryIndex') ? item.entryIndex : index
    const segmentIndex = hasRuleIndex(item, 'segmentIndex') ? item.segmentIndex : itemIndex
    if (!hasRuleRevision(item) || !hasRuleIndex(item, 'entryIndex')
        || !hasRuleIndex(item, 'itemIndex') || !hasRuleIndex(item, 'segmentIndex')) noteSynthesis()
    return {
      ...item,
      revision: hasRuleRevision(item) ? item.revision : fallbackRevision,
      entryIndex,
      itemIndex,
      segmentIndex,
      entryId: typeof item.parentId === 'string' && item.parentId ? item.parentId : (item.id || 'entry-' + index),
      itemId: typeof item.itemId === 'string' && item.itemId ? item.itemId : (item.id || 'item-' + index),
      retired: true,
    }
  })
  const output = { dtoKind: 'RulesAggregate', rules, notes, candidates, references, retired }
  if (maintenance !== undefined && maintenance !== null && maintenance !== '') {
    output.maintenance = typeof maintenance === 'string'
      ? { key: 'refresh-maintenance', text: maintenance }
      : maintenance
  }
  return { input: output, identitySynthesized }
}

function canonicalHandoffTitle(title) {
  const normalized = String(title || '').replace(/^#{1,3}\s*/, '').trim()
  const tagged = normalized.match(/\btype:(goal|state|dead-end|progress)\b/i)
  const bracketed = normalized.match(/\[(goal|state|dead-end|progress)\]/i)
  const tag = (tagged || bracketed)?.[1]?.toLowerCase()
  const taggedTitle = tag === 'goal' ? '目标' : tag === 'state' ? '任务状态'
    : tag === 'dead-end' ? '已试方案与失败原因' : tag === 'progress' ? '进度与下一步' : ''
  if (taggedTitle) return taggedTitle
  for (const [, canonical, aliases] of HANDOFF_TITLES) {
    if (aliases.some(alias => normalized === alias || normalized.startsWith(alias + ' ') || normalized.startsWith(alias + '（'))) {
      return canonical
    }
  }
  return normalized
}

function handoffInput(text) {
  const source = stringValue(text)
  if (!source.trim()) return { sections: [] }
  const parsed = parseHandoffLedgerPre(source)
  if (!parsed || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw Object.assign(new TypeError('Handoff has no parseable sections'), { code: 'invalid-source' })
  }
  const sections = parsed.sections.map(section => ({
    title: canonicalHandoffTitle(section && section.title),
    body: section && Array.isArray(section.body) ? section.body : [],
  }))
  return { sections }
}

function planInput(text, names) {
  const source = stringValue(text)
  if (!source.trim()) return { input: { sections: [] }, degraded: false }
  const keys = Array.isArray(names) ? [...new Set(names.filter(value => typeof value === 'string' && value.trim()))] : []
  const lines = source.split(/\r?\n/)
  const matches = []
  for (let index = 0; index < lines.length; index++) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(lines[index])
    if (!heading) continue
    const title = heading[1].trim()
    const key = keys.filter(value => title === value || title.startsWith(value + '（') || title.startsWith(value + '(') || title.startsWith(value + ' '))
      .sort((a, b) => b.length - a.length)[0]
    if (key) matches.push({ index, key })
  }
  const seen = new Set()
  let duplicate = false
  for (const match of matches) {
    if (seen.has(match.key)) duplicate = true
    seen.add(match.key)
  }
  if (!matches.length || duplicate) {
    return { input: { sections: [{ key: 'whole-plan', text: source }] }, degraded: true }
  }
  const sections = matches.map((match, offset) => {
    const end = offset + 1 < matches.length ? matches[offset + 1].index : lines.length
    const start = offset === 0 ? 0 : match.index
    return { key: match.key, text: lines.slice(start, end).join('\n').trim() }
  }).filter(section => section.text)
  return sections.length
    ? { input: { sections }, degraded: false }
    : { input: { sections: [{ key: 'whole-plan', text: source }] }, degraded: true }
}

export function buildUnitShadow(input) {
  const receipt = makeReceipt(input)
  const source = isRecord(input?.rawSources) ? input.rawSources : {}
  const policy = input?.policy
  const phase = input?.phase
  const budget = receipt.assumed.budget
  const rawUnits = []
  let failed = false
  let selection = null
  const adapt = (sourceId, callback) => {
    try { rawUnits.push(...callback()) } catch (error) {
      failed = true
      recordDegradation(receipt, sourceId, error)
    }
  }

  try {
    adapt('events', () => adaptEvents({ events: source.events }))
    adapt('rules', () => {
      const prepared = rulesInput(source.rules, source.maintenance)
      if (prepared.identitySynthesized) {
        receipt.degradations.push({ source: 'rules', code: 'rules-identity-synthesized',
          message: 'rules revision/segment tuple synthesized for shadow' })
      }
      return adaptRules(prepared.input)
    })
    adapt('plan', () => {
      const prepared = planInput(source.planText, source.planSectionNames)
      if (prepared.degraded) {
        recordDegradation(receipt, 'plan', null, 'plan-granularity-degraded')
        receipt.degradations[receipt.degradations.length - 1].message = 'Plan headings could not be split; using one whole-plan unit'
      }
      return adaptPlan(prepared.input)
    })
    adapt('handoff', () => adaptHandoff(handoffInput(source.handoffText)))
    adapt('portrait', () => adaptPortrait({ portraitItems: source.portraitItems }))
    adapt('calendar', () => adaptCalendar({ entries: source.calendarEntries }))
  } catch (error) {
    failed = true
    recordDegradation(receipt, 'sources', error)
  }

  receipt.counts.raw = rawUnits.length
  try {
    const units = bindUnits(rawUnits, policy)
    selection = selectUnits({ policy, units, budget, phase })
    receipt.counts.selected = selection.selected.length
    receipt.counts.deferred = selection.deferred.length
    receipt.counts.rejected = selection.rejected.length
    receipt.cost = { jsChars: selection.cost.jsChars, utf8Bytes: selection.cost.utf8Bytes }
    receipt.truncatedBy = selection.truncatedBy
    receipt.budgetOvercommit = selection.budgetOvercommit
    receipt.computed = !failed
  } catch (error) {
    failed = true
    receipt.computed = false
    receipt.counts.selected = null
    recordDegradation(receipt, 'selection', error)
  }
  if (failed) receipt.computed = false
  return trimReceipt(receipt, selection && selection.selected)
}
