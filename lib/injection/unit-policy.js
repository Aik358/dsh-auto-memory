import { MODULE_REGISTRY, PRODUCER_IDS, LOCKED_MODULES } from './policy-v2.js'

export const UNIT_POLICY_VERSION = '1'

const PHASES = [
  'human_full', 'human_slim', 'run_full', 'run_slim', 'post_compact',
  'handoff_carry', 'hang_compensate', 'legacy',
]
export const EVENT_FAMILY = Object.freeze(['event', 'checkpoint', 'catalogEntry'])
const REASONS = [
  'module-disabled', 'quota-exhausted', 'budget', 'view-not-allowed',
  'no-pointer', 'duplicate-id',
]

export class UnitPolicyError extends Error {
  constructor(code, message, detail) {
    super(message)
    this.name = 'UnitPolicyError'
    this.code = code
    this.detail = detail || null
  }
}

function fail(code, message, detail) {
  throw new UnitPolicyError(code, message, detail)
}

export function quotaMatchesForUnitKind(quotas, unitKind) {
  return quotas.filter(quota => quota.unit === unitKind
    || (quota.scope === 'event' && EVENT_FAMILY.includes(unitKind)))
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value)))
}

function hasOnlyDataFields(value, allowed) {
  if (!plainObject(value) || Object.getOwnPropertySymbols(value).length) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return Object.entries(descriptors).every(([key, descriptor]) =>
    allowed.includes(key) && Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.enumerable)
}

function readQuotaKey(unit) {
  const prefix = unit.moduleId + ':' + unit.view + ':'
  if (typeof unit.policyKey !== 'string' || !unit.policyKey.startsWith(prefix)) {
    fail('invalid-unit', 'policyKey does not match moduleId and view')
  }
  return unit.policyKey.slice(prefix.length)
}

function validQuotaKey(value) {
  if (value === '@unbounded') return true
  if (typeof value !== 'string') return false
  const parts = value.split('/')
  return parts.length === 2 && parts.every(part => part.trim() === part && part.length > 0 && !part.includes(':'))
}

export function unitPolicyKey(unit, quotaKey) {
  if (!plainObject(unit)) fail('invalid-unit', 'expected a unit object')
  if (typeof unit.moduleId !== 'string' || !Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, unit.moduleId)) {
    fail('invalid-unit', 'moduleId has no unit registry', { moduleId: unit.moduleId })
  }
  const registry = MODULE_REGISTRY[unit.moduleId]
  if (!registry || !(PRODUCER_IDS.includes(unit.moduleId) || LOCKED_MODULES.includes(unit.moduleId))) {
    fail('invalid-unit', 'moduleId has no unit registry', { moduleId: unit.moduleId })
  }
  if (!registry.views.includes(unit.view)) {
    fail('view-not-allowed', 'view is not registered for moduleId', { moduleId: unit.moduleId, view: unit.view })
  }
  const selectedQuotaKey = quotaKey === undefined ? readQuotaKey(unit) : quotaKey
  if (!validQuotaKey(selectedQuotaKey)) fail('invalid-unit', 'quotaKey is invalid')
  return unit.moduleId + ':' + unit.view + ':' + selectedQuotaKey
}

export function validateUnit(unit) {
  const fields = ['id', 'moduleId', 'unitKind', 'view', 'policyKey', 'priority', 'cost', 'text', 'pointer', 'sourceRef']
  if (!hasOnlyDataFields(unit, fields) || Object.keys(unit).length !== fields.length) {
    fail('invalid-unit', 'unit shape is invalid')
  }
  if (typeof unit.moduleId !== 'string' || !Object.prototype.hasOwnProperty.call(MODULE_REGISTRY, unit.moduleId)) {
    fail('invalid-unit', 'moduleId has no unit registry', { moduleId: unit.moduleId })
  }
  const registry = MODULE_REGISTRY[unit.moduleId]
  if (!registry || !(PRODUCER_IDS.includes(unit.moduleId) || LOCKED_MODULES.includes(unit.moduleId))) {
    fail('invalid-unit', 'moduleId has no unit registry', { moduleId: unit.moduleId })
  }
  if (!registry.views.includes(unit.view)) {
    fail('view-not-allowed', 'view is not registered for moduleId', { moduleId: unit.moduleId, view: unit.view })
  }
  if (!registry.units.includes(unit.unitKind)) fail('invalid-unit', 'unitKind is not registered')
  if (typeof unit.sourceRef !== 'string' || !unit.sourceRef.trim()
      || unit.id !== unit.moduleId + ':' + unit.unitKind + ':' + unit.sourceRef) {
    fail('invalid-unit', 'id and sourceRef are invalid')
  }
  if (typeof unit.priority !== 'number' || !Number.isSafeInteger(unit.priority) || unit.priority < 0) {
    fail('invalid-unit', 'priority must be a non-negative safe integer')
  }
  if (!hasOnlyDataFields(unit.cost, ['jsChars', 'utf8Bytes'])
      || Object.keys(unit.cost).length !== 2
      || !Number.isSafeInteger(unit.cost.jsChars) || unit.cost.jsChars < 0
      || !Number.isSafeInteger(unit.cost.utf8Bytes) || unit.cost.utf8Bytes < 0) {
    fail('invalid-cost', 'cost must contain non-negative safe integers')
  }
  if (!(typeof unit.text === 'string' || unit.text === null)
      || !(typeof unit.pointer === 'string' || unit.pointer === null)) {
    fail('invalid-unit', 'text and pointer must be strings or null')
  }
  if (unit.view === 'pointer' && (!unit.pointer || !unit.pointer.trim())) {
    fail('no-pointer', 'pointer view requires a non-empty pointer')
  }
  if (typeof unit.policyKey !== 'string' || unitPolicyKey(unit) !== unit.policyKey) {
    fail('invalid-unit', 'policyKey is invalid')
  }
  return unit
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareUnits(left, right) {
  return right.priority - left.priority
    || compareText(left.moduleId, right.moduleId)
    || compareText(left.id, right.id)
}

function copyUnit(unit) {
  return {
    id: unit.id,
    moduleId: unit.moduleId,
    unitKind: unit.unitKind,
    view: unit.view,
    policyKey: unit.policyKey,
    priority: unit.priority,
    cost: { jsChars: unit.cost.jsChars, utf8Bytes: unit.cost.utf8Bytes },
    text: unit.text,
    pointer: unit.pointer,
    sourceRef: unit.sourceRef,
  }
}

function copyBudget(budget) {
  if (budget === undefined) return {}
  if (!hasOnlyDataFields(budget, ['jsChars', 'utf8Bytes'])) fail('invalid-budget', 'budget shape is invalid')
  const copy = {}
  for (const metric of ['jsChars', 'utf8Bytes']) {
    if (Object.prototype.hasOwnProperty.call(budget, metric)) {
      if (!Number.isSafeInteger(budget[metric]) || budget[metric] < 0) {
        fail('invalid-budget', metric + ' must be a non-negative safe integer')
      }
      copy[metric] = budget[metric]
    }
  }
  return copy
}

function addCost(total, cost) {
  const jsChars = total.jsChars + cost.jsChars
  const utf8Bytes = total.utf8Bytes + cost.utf8Bytes
  if (!Number.isSafeInteger(jsChars) || !Number.isSafeInteger(utf8Bytes)) {
    fail('invalid-cost', 'selected cost total exceeds safe integer range')
  }
  return { jsChars, utf8Bytes }
}

function fitsBudget(total, unitCost, budget) {
  return ['jsChars', 'utf8Bytes'].every(metric => budget[metric] === undefined
    || total[metric] + unitCost[metric] <= budget[metric])
}

function makeRejected(unit, reason) {
  if (!REASONS.includes(reason)) fail('invalid-unit', 'unsupported rejection reason')
  return { id: unit.id, moduleId: unit.moduleId, view: unit.view, reason }
}

function freezeOutput(output) {
  for (const unit of [...output.selected, ...output.deferred]) {
    Object.freeze(unit.cost)
    Object.freeze(unit)
  }
  for (const entry of output.rejected) Object.freeze(entry)
  Object.freeze(output.selected)
  Object.freeze(output.rejected)
  Object.freeze(output.cost)
  Object.freeze(output.deferred)
  return Object.freeze(output)
}

export function selectUnits(input) {
  if (!plainObject(input)) fail('invalid-input', 'expected an input object')
  if (!plainObject(input.policy)) fail('invalid-policy', 'policy must be an object')
  if (!plainObject(input.policy.modules)) fail('invalid-policy', 'policy.modules must be an object')
  if (!Array.isArray(input.units)) fail('invalid-input', 'units must be an array')
  if (!PHASES.includes(input.phase)) fail('invalid-phase', 'phase is not supported', { phase: input.phase })
  const budget = copyBudget(input.budget)
  const policy = input.policy
  if (policy.enabled !== undefined && typeof policy.enabled !== 'boolean') {
    fail('invalid-policy', 'policy.enabled must be boolean')
  }

  const seen = new Set()
  const prepared = input.units.map(unit => {
    validateUnit(unit)
    if (seen.has(unit.id)) fail('duplicate-id', 'unit ids must be unique', { id: unit.id })
    seen.add(unit.id)
    const locked = LOCKED_MODULES.includes(unit.moduleId)
    if (locked) {
      if (unit.view !== 'full' || readQuotaKey(unit) !== '@unbounded') {
        fail('invalid-unit', 'locked units must use full and @unbounded')
      }
      return { unit: copyUnit(unit), locked, enabled: true, quota: null }
    }
    const modulePolicy = policy.modules[unit.moduleId]
    if (!plainObject(modulePolicy) || typeof modulePolicy.enabled !== 'boolean'
        || !Number.isSafeInteger(modulePolicy.priority) || !Array.isArray(modulePolicy.quotas)) {
      fail('invalid-policy', 'module policy is incomplete', { moduleId: unit.moduleId })
    }
    if (unit.priority !== modulePolicy.priority) {
      fail('invalid-unit', 'priority must match policy module priority', { moduleId: unit.moduleId })
    }
    const quotaKey = readQuotaKey(unit)
    let quota = null
    const unitQuotas = quotaMatchesForUnitKind(modulePolicy.quotas, unit.unitKind)
    if (unitQuotas.length && !unitQuotas.some(item => item.unit + '/' + item.scope === quotaKey)) {
      fail('quota-bypass', 'policyKey must select a configured quota for unitKind', {
        moduleId: unit.moduleId,
        unitKind: unit.unitKind,
      })
    }
    if (quotaKey !== '@unbounded') {
      quota = unitQuotas.find(item => item.unit + '/' + item.scope === quotaKey)
      if (!quota) fail('invalid-unit', 'policyKey does not match a configured quota', { moduleId: unit.moduleId, quotaKey })
    }
    return {
      unit: copyUnit(unit),
      locked: false,
      enabled: policy.enabled !== false && modulePolicy.enabled,
      quota,
    }
  }).sort((left, right) => compareUnits(left.unit, right.unit))

  const selected = []
  const rejected = []
  const deferred = []
  const quotaUse = new Map()
  let lockedCost = { jsChars: 0, utf8Bytes: 0 }
  let sawQuotaRejection = false
  let sawBudgetDeferral = false

  for (const entry of prepared) {
    if (!entry.locked) continue
    lockedCost = addCost(lockedCost, entry.unit.cost)
    selected.push(entry.unit)
  }

  const budgetOvercommit = ['jsChars', 'utf8Bytes'].some(metric =>
    budget[metric] !== undefined && lockedCost[metric] > budget[metric])
  let cost = { jsChars: lockedCost.jsChars, utf8Bytes: lockedCost.utf8Bytes }
  const ordinary = prepared.filter(entry => !entry.locked)

  if (budgetOvercommit) {
    for (const entry of ordinary) {
      if (!entry.enabled) {
        rejected.push(makeRejected(entry.unit, 'module-disabled'))
        continue
      }
      deferred.push(entry.unit)
    }
    sawBudgetDeferral = true
  } else {
    for (const entry of ordinary) {
      const { unit, enabled, quota } = entry
      if (!enabled) {
        rejected.push(makeRejected(unit, 'module-disabled'))
        continue
      }
      if (quota) {
        const used = quotaUse.get(unit.policyKey) || 0
        const limit = quota.strength === 'soft' ? quota.max + quota.overflowAllowance : quota.max
        if (used >= limit) {
          rejected.push(makeRejected(unit, 'quota-exhausted'))
          sawQuotaRejection = true
          continue
        }
      }
      if (!fitsBudget(cost, unit.cost, budget)) {
        deferred.push(unit)
        sawBudgetDeferral = true
        continue
      }
      cost = addCost(cost, unit.cost)
      selected.push(unit)
      if (quota) quotaUse.set(unit.policyKey, (quotaUse.get(unit.policyKey) || 0) + 1)
    }
  }

  selected.sort(compareUnits)
  return freezeOutput({
    selected,
    rejected,
    cost,
    deferred,
    truncatedBy: sawBudgetDeferral ? 'budget' : sawQuotaRejection ? 'quota' : null,
    budgetOvercommit,
  })
}
