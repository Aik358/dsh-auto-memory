import { MODULE_REGISTRY, PRODUCER_IDS } from './policy-v2.js'
import { SUMMARY_POINTER } from './render-rules.js'
import { UnitPolicyError, quotaMatchesForUnitKind, unitPolicyKey, validateUnit } from './unit-policy.js'

const EVENT_SECTIONS = ['goal', 'doing', 'deadend', 'next']
const CHECKPOINT_SECTIONS = ['goal', 'state', 'dead', 'next']
const PORTRAIT_STAGES = ['accepted', 'used']
const PORTRAIT_KINDS = ['preference', 'state', 'unfinished-goal', 'authorResponse']
const RULE_ARRAYS = ['rules', 'notes', 'candidates', 'references', 'retired']
const LEDGER_TAGS = {
  '目标': 'goal',
  '任务状态': 'state',
  '已试方案与失败原因': 'dead-end',
  '进度与下一步': 'progress',
}

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
}

function owns(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function sourceError(adapter, field, expected) {
  const detail = { adapter, field }
  if (expected) detail.expected = expected
  throw new UnitPolicyError('invalid-source', adapter + ' source is invalid at ' + field, detail)
}

function requireRecord(adapter, value, field) {
  if (!isRecord(value)) sourceError(adapter, field, 'object')
  return value
}

function requireArray(adapter, value, field) {
  if (!Array.isArray(value)) sourceError(adapter, field, 'array')
  return value
}

function optionalString(adapter, record, key, field) {
  if (!owns(record, key) || record[key] === undefined) return ''
  if (typeof record[key] !== 'string') sourceError(adapter, field, 'string')
  return record[key]
}

function requiredString(adapter, record, key, field) {
  const value = optionalString(adapter, record, key, field)
  if (!value.trim()) sourceError(adapter, field, 'non-empty string')
  return value
}

function addRaw(output, adapter, moduleId, unitKind, sourceRef, text, pointer = null) {
  if (!PRODUCER_IDS.includes(moduleId) || !MODULE_REGISTRY[moduleId]?.units.includes(unitKind)) {
    sourceError(adapter, 'unitKind', 'registered producer unit')
  }
  if (typeof sourceRef !== 'string' || !sourceRef.trim()) sourceError(adapter, 'sourceRef', 'non-empty string')
  if (typeof text !== 'string') sourceError(adapter, 'text', 'string')
  if (!text.trim()) return
  if (!(typeof pointer === 'string' || pointer === null)) sourceError(adapter, 'pointer', 'string or null')
  output.push(Object.freeze({ moduleId, unitKind, sourceRef, text, pointer }))
}

function checkedSections(adapter, value, keys, field) {
  if (value === undefined) return {}
  const sections = requireRecord(adapter, value, field)
  for (const key of keys) {
    if (owns(sections, key) && typeof sections[key] !== 'string') sourceError(adapter, field + '.' + key, 'string')
  }
  return sections
}

function sectionLines(sections, keys) {
  return keys.filter(key => typeof sections[key] === 'string' && sections[key].trim())
    .map(key => key + ': ' + sections[key])
}

function encodeRef(value) {
  return encodeURIComponent(String(value))
}

export function adaptEvents(input, { onCheckpoint } = {}) {
  const adapter = 'adaptEvents'
  requireRecord(adapter, input, 'input')
  const events = requireArray(adapter, input.events, 'events')
  const output = []
  events.forEach((value, eventIndex) => {
    const field = 'events[' + eventIndex + ']'
    const event = requireRecord(adapter, value, field)
    const id = requiredString(adapter, event, 'id', field + '.id')
    const status = requiredString(adapter, event, 'status', field + '.status')
    const name = optionalString(adapter, event, 'name', field + '.name')
    const summary = optionalString(adapter, event, 'summary', field + '.summary')
    const sections = checkedSections(adapter, event.sections === undefined ? event : event.sections,
      EVENT_SECTIONS, field + '.sections')
    if (event.checkpoints !== undefined && !Array.isArray(event.checkpoints)) {
      sourceError(adapter, field + '.checkpoints', 'array')
    }

    if (status === 'active') {
      const text = [name, summary, ...sectionLines(sections, EVENT_SECTIONS)].filter(part => part.trim()).join('\n')
      addRaw(output, adapter, 'events', 'event', 'event:' + encodeRef(id), text)
      for (let checkpointIndex = 0; checkpointIndex < (event.checkpoints || []).length; checkpointIndex++) {
        const cpField = field + '.checkpoints[' + checkpointIndex + ']'
        const checkpoint = requireRecord(adapter, event.checkpoints[checkpointIndex], cpField)
        const checkpointId = optionalString(adapter, checkpoint, 'id', cpField + '.id')
        const checkpointIdentity = optionalString(adapter, checkpoint, 'checkpointId', cpField + '.checkpointId')
        const checkpointSource = optionalString(adapter, checkpoint, 'sourceRef', cpField + '.sourceRef')
        const checkpointIdemKey = optionalString(adapter, checkpoint, 'idemKey', cpField + '.idemKey')
        const checkpointOpId = optionalString(adapter, checkpoint, 'opId', cpField + '.opId')
        const checkpointKind = optionalString(adapter, checkpoint, 'kind', cpField + '.kind')
        const checkpointText = optionalString(adapter, checkpoint, 'text', cpField + '.text')
        const checkpointAt = checkpoint.at
        if (checkpointAt !== undefined && (typeof checkpointAt !== 'number' || !Number.isFinite(checkpointAt))) {
          sourceError(adapter, cpField + '.at', 'finite number')
        }
        const cpSections = checkedSections(adapter, checkpoint.sections === undefined ? checkpoint : checkpoint.sections,
          CHECKPOINT_SECTIONS, cpField + '.sections')
        const text = checkpointText.trim()
          ? checkpointText
          : sectionLines(cpSections, CHECKPOINT_SECTIONS).join('\n')
        const identity = checkpointSource.trim() || checkpointIdentity.trim() || checkpointId.trim()
          || checkpointIdemKey.trim() || checkpointOpId.trim()
          || JSON.stringify([checkpointKind, checkpointAt ?? null, checkpointText, cpSections])
        const count = output.length
        addRaw(output, adapter, 'events', 'checkpoint', 'event:' + encodeRef(id) + ':checkpoint:' + encodeRef(identity), text)
        if (onCheckpoint && output.length > count) onCheckpoint(output[count], checkpoint)
      }
    } else {
      const title = name.trim() || summary.trim()
      const text = [title, '(' + id + ')', status].filter(Boolean).join(' · ')
      addRaw(output, adapter, 'events', 'catalogEntry', 'event:' + encodeRef(id), text)
    }
  })
  return output
}

function rulesSourceRef(adapter, item, category, itemIndex) {
  const layer = requiredString(adapter, item, 'layer', category + '[' + itemIndex + '].layer')
  if (!['user', 'project'].includes(layer)) sourceError(adapter, category + '[' + itemIndex + '].layer', 'user or project')
  const revision = requiredString(adapter, item, 'revision', category + '[' + itemIndex + '].revision')
  const entryIndex = item.entryIndex
  const itemIndexValue = item.itemIndex
  const segmentIndex = item.segmentIndex
  if (![entryIndex, itemIndexValue, segmentIndex].every(Number.isSafeInteger) || [entryIndex, itemIndexValue, segmentIndex].some(n => n < 0)) {
    sourceError(adapter, category + '[' + itemIndex + '].indices', 'non-negative safe integers')
  }
  const entry = typeof item.entryId === 'string' && item.entryId ? item.entryId : 'entry-' + entryIndex
  const part = typeof item.itemId === 'string' && item.itemId ? item.itemId : 'item-' + itemIndexValue
  return ['rules', layer, entry, part, segmentIndex, revision].map(encodeRef).join(':')
}

export function adaptRules(input) {
  const adapter = 'adaptRules'
  requireRecord(adapter, input, 'input')
  if (input.dtoKind !== 'RulesAggregate') sourceError(adapter, 'dtoKind', 'RulesAggregate')
  for (const key of RULE_ARRAYS) requireArray(adapter, input[key], key)
  const output = []
  const expectedKinds = { rules: 'rule', notes: 'note', candidates: 'candidate', references: 'reference' }
  for (const category of RULE_ARRAYS) {
    input[category].forEach((value, itemIndex) => {
      const field = category + '[' + itemIndex + ']'
      const item = requireRecord(adapter, value, field)
      const text = requiredString(adapter, item, 'text', field + '.text')
      if (category === 'retired') {
        if (item.retired !== true || !['superseded', 'retracted'].includes(item.status)) {
          sourceError(adapter, field + '.status', 'retired superseded/retracted entry')
        }
        rulesSourceRef(adapter, item, category, itemIndex)
        return
      }
      if (item.kind !== expectedKinds[category]) sourceError(adapter, field + '.kind', expectedKinds[category])
      const sourceRef = rulesSourceRef(adapter, item, category, itemIndex)
      if (category !== 'rules' && category !== 'notes') return
      if (item.retired === true || item.status !== 'current') sourceError(adapter, field + '.status', 'current active entry')
      addRaw(output, adapter, 'rules', 'rule', sourceRef, text, SUMMARY_POINTER)
    })
  }
  if (input.maintenance !== undefined && input.maintenance !== null) {
    const maintenance = requireRecord(adapter, input.maintenance, 'maintenance')
    const key = optionalString(adapter, maintenance, 'key', 'maintenance.key')
    if (!owns(maintenance, 'text') || typeof maintenance.text !== 'string') {
      sourceError(adapter, 'maintenance.text', 'string')
    }
    if (maintenance.text.trim()) {
      const stableKey = key || 'default'
      addRaw(output, adapter, 'rules', 'ruleModule', 'rules:maintenance:' + stableKey,
        maintenance.text, SUMMARY_POINTER)
    }
  }
  return output
}

function planSections(adapter, input) {
  const spec = input.planSpec === undefined ? input : requireRecord(adapter, input.planSpec, 'planSpec')
  if (Array.isArray(spec.sections)) {
    return spec.sections.map((value, index) => {
      const field = 'planSpec.sections[' + index + ']'
      const section = requireRecord(adapter, value, field)
      const key = optionalString(adapter, section, 'key', field + '.key')
        || optionalString(adapter, section, 'id', field + '.id')
        || optionalString(adapter, section, 'title', field + '.title')
      if (!key.trim()) sourceError(adapter, field + '.key', 'stable key, id or title')
      const text = requiredString(adapter, section, 'text', field + '.text')
      return { key, text }
    })
  }
  const keys = ['current', 'recent', 'constraints', 'todos']
  return keys.map(key => {
    if (!owns(spec, key) || typeof spec[key] !== 'string') sourceError(adapter, 'planSpec.' + key, 'string')
    return { key, text: spec[key] }
  })
}

export function adaptPlan(input) {
  const adapter = 'adaptPlan'
  requireRecord(adapter, input, 'input')
  const output = []
  for (const section of planSections(adapter, input)) {
    if (isEmptyPlanPlaceholder(section.key, section.text)) continue
    addRaw(output, adapter, 'plan', 'planSection', 'plan:' + encodeRef(section.key), section.text)
  }
  return output
}

function isEmptyPlanPlaceholder(key, text) {
  const value = text.trim()
  if (key === 'current') return value.includes('| （暂无 active 事件） | — | — |')
  const markers = { recent: '（暂无事件）', constraints: '（暂无约束）', todos: '（暂无待办）' }
  return markers[key] === value
}

function ledgerTag(title, body) {
  const normalized = title.replace(/^#{1,3}\s*/, '').trim()
  for (const [name, tag] of Object.entries(LEDGER_TAGS)) if (normalized === name) return tag
  for (const tag of Object.values(LEDGER_TAGS)) {
    if (title.includes('type:' + tag) || body.some(line => line.trim() === 'type:' + tag)) return tag
  }
  return ''
}

export function adaptHandoff(input) {
  const adapter = 'adaptHandoff'
  requireRecord(adapter, input, 'input')
  const sections = requireArray(adapter, input.sections, 'sections')
  const output = []
  sections.forEach((value, index) => {
    const field = 'sections[' + index + ']'
    const section = requireRecord(adapter, value, field)
    const title = requiredString(adapter, section, 'title', field + '.title')
    const body = requireArray(adapter, section.body, field + '.body')
    body.forEach((line, lineIndex) => {
      if (typeof line !== 'string') sourceError(adapter, field + '.body[' + lineIndex + ']', 'string')
    })
    const tag = ledgerTag(title, body)
    if (!tag) sourceError(adapter, field + '.title', 'one of the four handoff section titles')
    const text = [title, ...body].join('\n')
    addRaw(output, adapter, 'handoff', 'ledgerSection', 'handoff:type:' + tag, text)
  })
  return output
}

export function adaptPortrait(input) {
  const adapter = 'adaptPortrait'
  requireRecord(adapter, input, 'input')
  const items = requireArray(adapter, input.portraitItems, 'portraitItems')
  const output = []
  items.forEach((value, index) => {
    const field = 'portraitItems[' + index + ']'
    const item = requireRecord(adapter, value, field)
    const kind = requiredString(adapter, item, 'kind', field + '.kind')
    const stage = optionalString(adapter, item, 'stage', field + '.stage')
    const text = requiredString(adapter, item, 'text', field + '.text')
    const eligible = kind === 'authorResponse'
      || (PORTRAIT_STAGES.includes(stage) && PORTRAIT_KINDS.includes(kind))
    if (!eligible) return
    const sourceRef = optionalString(adapter, item, 'sourceRef', field + '.sourceRef')
    const at = item.at
    if (at !== undefined && (typeof at !== 'number' || !Number.isFinite(at))) sourceError(adapter, field + '.at', 'finite number')
    const eventId = optionalString(adapter, item, 'eventId', field + '.eventId')
    const identity = sourceRef.trim() || [eventId, kind, stage, at === undefined ? '' : at, text].map(encodeRef).join(':')
    addRaw(output, adapter, 'portrait', 'portraitItem', 'portrait:' + identity, text)
  })
  return output
}

export function adaptCalendar(input) {
  const adapter = 'adaptCalendar'
  requireRecord(adapter, input, 'input')
  const entries = requireArray(adapter, input.entries, 'entries')
  const output = []
  entries.forEach((value, index) => {
    const field = 'entries[' + index + ']'
    const entry = requireRecord(adapter, value, field)
    const date = requiredString(adapter, entry, 'date', field + '.date')
    const time = requiredString(adapter, entry, 'time', field + '.time')
    const quadrant = requiredString(adapter, entry, 'quadrant', field + '.quadrant')
    const title = requiredString(adapter, entry, 'title', field + '.title')
    const note = optionalString(adapter, entry, 'note', field + '.note')
    const id = optionalString(adapter, entry, 'id', field + '.id')
    if (typeof entry.done !== 'boolean') sourceError(adapter, field + '.done', 'boolean')
    const identity = id.trim() || JSON.stringify([date, time, quadrant, title, note, entry.done])
    const text = '- [' + (entry.done ? 'x' : ' ') + '] ' + date + ' ' + time
      + ' | ' + quadrant + ' | ' + title + (note ? ' | ' + note : '')
    addRaw(output, adapter, 'calendar', 'calendarEntry', 'calendar:' + encodeRef(identity), text)
  })
  return output
}

function requireRawUnit(raw, index) {
  const field = 'rawUnits[' + index + ']'
  if (!isRecord(raw)) sourceError('bindUnits', field, 'RawUnit object')
  const keys = ['moduleId', 'unitKind', 'sourceRef', 'text', 'pointer']
  const ownKeys = Object.keys(raw)
  if (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key))) {
    sourceError('bindUnits', field, 'exact RawUnit fields')
  }
  if (typeof raw.moduleId !== 'string' || !PRODUCER_IDS.includes(raw.moduleId)) sourceError('bindUnits', field + '.moduleId', 'producer id')
  if (typeof raw.unitKind !== 'string' || !MODULE_REGISTRY[raw.moduleId].units.includes(raw.unitKind)) {
    sourceError('bindUnits', field + '.unitKind', 'registered unit kind')
  }
  if (typeof raw.sourceRef !== 'string' || !raw.sourceRef.trim()) sourceError('bindUnits', field + '.sourceRef', 'non-empty string')
  if (typeof raw.text !== 'string') sourceError('bindUnits', field + '.text', 'string')
  if (!(typeof raw.pointer === 'string' || raw.pointer === null)) sourceError('bindUnits', field + '.pointer', 'string or null')
  return raw
}

export function bindUnits(rawUnits, policy, options = {}) {
  if (!Array.isArray(rawUnits)) sourceError('bindUnits', 'rawUnits', 'array')
  if (!isRecord(policy) || !isRecord(policy.modules)) {
    throw new UnitPolicyError('invalid-policy', 'bindUnits requires a policy with modules')
  }
  if (!isRecord(options)) sourceError('bindUnits', 'options', 'object')
  const output = []
  rawUnits.forEach((value, index) => {
    const raw = requireRawUnit(value, index)
    const modulePolicy = policy.modules[raw.moduleId]
    if (!isRecord(modulePolicy) || !Array.isArray(modulePolicy.quotas)) {
      throw new UnitPolicyError('invalid-policy', 'module policy is missing or incomplete', { moduleId: raw.moduleId })
    }
    const view = modulePolicy.view
    if (!MODULE_REGISTRY[raw.moduleId].views.includes(view)) {
      throw new UnitPolicyError('view-not-allowed', 'view is not registered for moduleId', { moduleId: raw.moduleId, view })
    }
    const byQuotaKey = new Map()
    for (const quota of quotaMatchesForUnitKind(modulePolicy.quotas, raw.unitKind)) {
      byQuotaKey.set(quota.unit + '/' + quota.scope, quota)
    }
    const matches = [...byQuotaKey.values()]
    if (matches.length > 1) {
      throw new UnitPolicyError('ambiguous-quota-scope', 'multiple quotas match unitKind', {
        moduleId: raw.moduleId,
        unitKind: raw.unitKind,
        scopes: matches.map(quota => quota.scope),
      })
    }
    const quotaKey = matches.length === 1 ? matches[0].unit + '/' + matches[0].scope : '@unbounded'
    const priority = typeof options.assignPriority === 'function'
      ? options.assignPriority(raw, modulePolicy.priority)
      : (options.assignPriority === undefined ? modulePolicy.priority : options.assignPriority)
    const unit = {
      id: raw.moduleId + ':' + raw.unitKind + ':' + raw.sourceRef,
      moduleId: raw.moduleId,
      unitKind: raw.unitKind,
      view,
      policyKey: unitPolicyKey({ moduleId: raw.moduleId, view }, quotaKey),
      priority,
      cost: { jsChars: raw.text.length, utf8Bytes: Buffer.byteLength(raw.text, 'utf8') },
      text: raw.text,
      pointer: raw.pointer,
      sourceRef: raw.sourceRef,
    }
    validateUnit(unit)
    output.push(Object.freeze({ ...unit, cost: Object.freeze(unit.cost) }))
  })
  return output
}
