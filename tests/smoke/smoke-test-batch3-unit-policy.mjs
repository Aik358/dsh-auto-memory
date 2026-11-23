import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const REPO = process.env.U1_REPO_ROOT
  ? path.resolve(process.env.U1_REPO_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_DIR = process.env.U1_MUTATION_DIR || path.join(REPO, 'lib', 'injection')
const policyModule = await import(pathToFileURL(path.join(SOURCE_DIR, 'policy-v2.js')).href)
const unitModule = await import(pathToFileURL(path.join(SOURCE_DIR, 'unit-policy.js')).href)
const { PRESETS, MODULE_REGISTRY, validatePolicy, DeliveryPolicyError } = policyModule
const { UNIT_POLICY_VERSION, UnitPolicyError, selectUnits, unitPolicyKey } = unitModule

let passed = 0
let failed = 0
async function test(name, run) {
  try {
    await run()
    passed++
    console.log('PASS ' + name)
  } catch (error) {
    failed++
    console.log('FAIL ' + name + ' :: ' + (error && error.message || error))
  }
}

function expectCode(run, code) {
  assert.throws(run, error => error instanceof UnitPolicyError && error.code === code,
    'expected UnitPolicyError(' + code + ')')
}

function policyWith(moduleId, patch, base = PRESETS.human_full) {
  const raw = structuredClone(base)
  raw.modules[moduleId] = { ...raw.modules[moduleId], ...patch }
  return validatePolicy(raw)
}

function makeUnit(policy, options = {}) {
  const moduleId = options.moduleId || 'events'
  const unitKind = options.unitKind || 'event'
  const view = options.view || policy.modules[moduleId].view
  const sourceRef = options.sourceRef || 'source-1'
  const quotaKey = options.quotaKey === undefined ? '@unbounded' : options.quotaKey
  const text = options.text === undefined ? 'unit ' + sourceRef : options.text
  const priority = options.priority === undefined
    ? (policy.modules[moduleId] ? policy.modules[moduleId].priority : 100)
    : options.priority
  return {
    id: moduleId + ':' + unitKind + ':' + sourceRef,
    moduleId,
    unitKind,
    view,
    policyKey: unitPolicyKey({ moduleId, view }, quotaKey),
    priority,
    cost: options.cost || { jsChars: text === null ? 0 : text.length, utf8Bytes: text === null ? 0 : Buffer.byteLength(text, 'utf8') },
    text,
    pointer: options.pointer === undefined ? null : options.pointer,
    sourceRef,
  }
}

function select(policy, units, budget = {}, phase = 'run_full') {
  return selectUnits({ policy, units, budget, phase })
}

function quotaPolicy(strength, max, overflowAllowance) {
  const quota = { unit: 'event', scope: 'event', max, strength }
  if (strength === 'soft') quota.overflowAllowance = overflowAllowance
  return policyWith('events', { quotas: [quota] })
}

function adaptText(policy, text, sourceRef, adapterBudget) {
  const renderedText = text
  return makeUnit(policy, {
    sourceRef,
    text: renderedText,
    cost: { jsChars: renderedText.length, utf8Bytes: Buffer.byteLength(renderedText, 'utf8') },
  })
}

function ids(units) {
  return units.map(unit => unit.id)
}

assert.equal(UNIT_POLICY_VERSION, '1')
assert.equal(typeof MODULE_REGISTRY.events.views, 'object')

await test('P-01 same input gives byte-stable JSON output', () => {
  const policy = quotaPolicy('hard', 3)
  const input = { policy, units: Array.from({ length: 3 }, (_, i) => makeUnit(policy, { sourceRef: 'p01-' + i, quotaKey: 'event/event' })), budget: {}, phase: 'human_full' }
  assert.equal(JSON.stringify(selectUnits(input)), JSON.stringify(selectUnits(input)))
})

await test('P-02 input stays unchanged after selection', () => {
  const policy = quotaPolicy('soft', 2, 1)
  const input = { policy, units: Array.from({ length: 4 }, (_, i) => makeUnit(policy, { sourceRef: 'p02-' + i, quotaKey: 'event/event' })), budget: { jsChars: 1000 }, phase: 'run_slim' }
  const before = JSON.stringify(input)
  selectUnits(input)
  assert.equal(JSON.stringify(input), before)
})

await test('P-03 implementation contains no I/O, clock or random source', () => {
  const source = readFileSync(path.join(SOURCE_DIR, 'unit-policy.js'), 'utf8')
  assert.equal(/\b(?:fs|path|process|Date)\b|Math\s*\.\s*random/.test(source), false)
})

await test('P-04 stable order is priority desc, moduleId asc, id asc', () => {
  const policy = PRESETS.human_full
  const units = [
    makeUnit(policy, { moduleId: 'events', sourceRef: 'z' }),
    makeUnit(policy, { moduleId: 'rules', unitKind: 'rule', view: 'full', sourceRef: 'rule-2' }),
    makeUnit(policy, { moduleId: 'events', sourceRef: 'a' }),
  ]
  const expected = ['rules:rule:rule-2', 'events:event:a', 'events:event:z']
  const first = ids(select(policy, units).selected)
  const shuffled = ids(select(policy, [...units].reverse()).selected)
  assert.deepEqual(first, expected)
  assert.deepEqual(shuffled, expected)
})

await test('P-05 hard quota max 3 selects 3 of 5 and rejects the rest', () => {
  const policy = quotaPolicy('hard', 3)
  const result = select(policy, Array.from({ length: 5 }, (_, i) => makeUnit(policy, { sourceRef: 'p05-' + i, quotaKey: 'event/event' })))
  assert.equal(result.selected.length, 3)
  assert.equal(result.rejected.length, 2)
  assert.ok(result.rejected.every(entry => entry.reason === 'quota-exhausted'))
  assert.equal(result.truncatedBy, 'quota')
})

await test('P-06 soft quota max 3 plus allowance 2 selects 5 of 6', () => {
  const policy = quotaPolicy('soft', 3, 2)
  const result = select(policy, Array.from({ length: 6 }, (_, i) => makeUnit(policy, { sourceRef: 'p06-' + i, quotaKey: 'event/event' })))
  assert.equal(result.selected.length, 5)
  assert.equal(result.rejected.length, 1)
  assert.equal(result.rejected[0].reason, 'quota-exhausted')
})

await test('P-07 disabled module rejects its units before quota accounting', () => {
  const policy = policyWith('events', { enabled: false, quotas: [{ unit: 'event', scope: 'event', max: 0, strength: 'hard' }] })
  const result = select(policy, Array.from({ length: 3 }, (_, i) => makeUnit(policy, { sourceRef: 'p07-' + i, quotaKey: 'event/event' })))
  assert.equal(result.selected.length, 0)
  assert.deepEqual(result.rejected.map(entry => entry.reason), ['module-disabled', 'module-disabled', 'module-disabled'])
  assert.equal(result.truncatedBy, null)
})

await test('P-08 locked modules stay full, bypass quotas and count cost', () => {
  const policy = PRESETS.human_slim
  const locked = ['user-memory', 'project-notes'].map((moduleId, index) => makeUnit(policy, {
    moduleId,
    unitKind: 'memoryRecord',
    view: 'full',
    quotaKey: '@unbounded',
    priority: 100 - index,
    sourceRef: 'locked-' + index,
    text: 'locked-' + index,
  }))
  const result = select(policy, locked, { jsChars: 100, utf8Bytes: 100 })
  assert.equal(result.selected.length, 2)
  assert.deepEqual(result.selected.map(unit => unit.view), ['full', 'full'])
  assert.equal(result.cost.jsChars, locked.reduce((sum, unit) => sum + unit.cost.jsChars, 0))
  assert.equal(result.cost.utf8Bytes, locked.reduce((sum, unit) => sum + unit.cost.utf8Bytes, 0))
})

await test('P-09 pointer unit without pointer fails explicitly', () => {
  const policy = PRESETS.human_slim
  const unit = makeUnit(policy, { moduleId: 'rules', unitKind: 'rule', view: 'pointer', sourceRef: 'p09', pointer: '   ' })
  expectCode(() => select(policy, [unit]), 'no-pointer')
})

await test('F2 unregistered module view fails explicitly', () => {
  const policy = PRESETS.human_full
  const unit = makeUnit(policy, { sourceRef: 'f2' })
  unit.view = 'unknown-view'
  unit.policyKey = 'events:unknown-view:@unbounded'
  expectCode(() => select(policy, [unit]), 'view-not-allowed')
})

await test('P-10 duplicate unit id fails explicitly', () => {
  const policy = PRESETS.human_full
  const unit = makeUnit(policy, { sourceRef: 'duplicate' })
  expectCode(() => select(policy, [unit, { ...unit, cost: { ...unit.cost } }]), 'duplicate-id')
})

await test('P-11 negative cost fails explicitly', () => {
  const policy = PRESETS.human_full
  const unit = makeUnit(policy, { sourceRef: 'negative' })
  unit.cost.jsChars = -1
  expectCode(() => select(policy, [unit]), 'invalid-cost')
})

await test('P-12 budget defers whole units and preserves the full adapter text', () => {
  const policy = PRESETS.human_full
  const halfUnits = Array.from({ length: 4 }, (_, i) => makeUnit(policy, {
    sourceRef: 'p12-' + i,
    text: '0123456789',
    cost: { jsChars: 10, utf8Bytes: 10 },
  }))
  const half = select(policy, halfUnits, { jsChars: 20, utf8Bytes: 20 })
  assert.equal(half.selected.length, 2)
  assert.equal(half.deferred.length, 2)
  assert.equal(half.truncatedBy, 'budget')
  assert.ok(half.cost.jsChars <= 20 && half.cost.utf8Bytes <= 20)
  assert.ok(half.deferred.every(unit => unit.text === '0123456789' && unit.cost.jsChars === 10))

  const sourceText = 'complete-unit-text-that-must-not-be-cut'
  const adapted = adaptText(policy, sourceText, 'adapter-full', { jsChars: 2 })
  const deferred = select(policy, [adapted], { jsChars: 2, utf8Bytes: 2 })
  assert.equal(deferred.selected.length, 0)
  assert.equal(deferred.deferred[0].text, sourceText)
  assert.equal(deferred.deferred[0].cost.jsChars, sourceText.length)
})

await test('P-13 every rejected item has one of the six explicit reasons', () => {
  const policy = quotaPolicy('hard', 1)
  const result = select(policy, Array.from({ length: 3 }, (_, i) => makeUnit(policy, { sourceRef: 'p13-' + i, quotaKey: 'event/event' })))
  const allowed = new Set(['module-disabled', 'quota-exhausted', 'budget', 'view-not-allowed', 'no-pointer', 'duplicate-id'])
  assert.ok(result.rejected.length > 0)
  assert.ok(result.rejected.every(entry => typeof entry.reason === 'string' && allowed.has(entry.reason)))
})

await test('P-14 different views and quota keys do not share quota counts', () => {
  const policy = policyWith('events', { quotas: [
    { unit: 'event', scope: 'event', max: 1, strength: 'hard' },
    { unit: 'catalogEntry', scope: 'event', max: 1, strength: 'hard' },
  ] })
  const units = [
    makeUnit(policy, { sourceRef: 'p14-event', unitKind: 'event', view: 'cards', quotaKey: 'event/event' }),
    makeUnit(policy, { sourceRef: 'p14-catalog', unitKind: 'catalogEntry', view: 'cards+catalog', quotaKey: 'catalogEntry/event' }),
  ]
  const result = select(policy, units)
  assert.equal(result.selected.length, 2)
  assert.equal(result.rejected.length, 0)
})

await test('P-15 event and checkpoint unit kinds share the event quota key', () => {
  const policy = quotaPolicy('hard', 1)
  const units = [
    makeUnit(policy, { sourceRef: 'p15-event', unitKind: 'event', quotaKey: 'event/event' }),
    makeUnit(policy, { sourceRef: 'p15-checkpoint', unitKind: 'checkpoint', quotaKey: 'event/event' }),
  ]
  const result = select(policy, units)
  assert.equal(result.selected.length, 1)
  assert.equal(result.rejected.length, 1)
  assert.equal(result.rejected[0].reason, 'quota-exhausted')
})

await test('P-16 disabled module does not block another enabled module', () => {
  const policy = policyWith('events', { enabled: false })
  const result = select(policy, [
    makeUnit(policy, { moduleId: 'events', sourceRef: 'p16-disabled' }),
    makeUnit(policy, { moduleId: 'rules', unitKind: 'rule', view: 'full', sourceRef: 'p16-rules' }),
  ])
  assert.deepEqual(ids(result.selected), ['rules:rule:p16-rules'])
  assert.deepEqual(result.rejected.map(entry => entry.reason), ['module-disabled'])
})

await test('P-17 zero units returns an empty non-truncated result', () => {
  const result = select(PRESETS.human_full, [])
  assert.deepEqual(result.selected, [])
  assert.deepEqual(result.rejected, [])
  assert.deepEqual(result.deferred, [])
  assert.deepEqual(result.cost, { jsChars: 0, utf8Bytes: 0 })
  assert.equal(result.truncatedBy, null)
})

await test('P-18 one thousand units stays ordered and below 50ms', () => {
  const policy = PRESETS.human_full
  const units = Array.from({ length: 1000 }, (_, i) => makeUnit(policy, { sourceRef: 'p18-' + String(i).padStart(4, '0') }))
  select(policy, units)
  const start = performance.now()
  const result = select(policy, units)
  const elapsed = performance.now() - start
  assert.equal(result.selected.length, 1000)
  assert.deepEqual(ids(result.selected), [...ids(result.selected)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
  assert.ok(elapsed < 50, 'elapsed=' + elapsed.toFixed(2) + 'ms')
})

await test('P-19 locked overcommit passes locked and defers every ordinary unit', () => {
  const policy = PRESETS.human_full
  const locked = makeUnit(policy, {
    moduleId: 'user-memory', unitKind: 'memoryRecord', view: 'full', quotaKey: '@unbounded',
    sourceRef: 'p19-locked', text: 'locked', cost: { jsChars: 100, utf8Bytes: 100 },
  })
  const ordinary = makeUnit(policy, {
    sourceRef: 'p19-event', text: 'ordinary', cost: { jsChars: 10, utf8Bytes: 10 },
  })
  const result = select(policy, [ordinary, locked], { jsChars: 50, utf8Bytes: 50 })
  assert.deepEqual(ids(result.selected), [locked.id])
  assert.deepEqual(ids(result.deferred), [ordinary.id])
  assert.equal(result.truncatedBy, 'budget')
  assert.equal(result.budgetOvercommit, true)
  assert.deepEqual(result.cost, { jsChars: 100, utf8Bytes: 100 })
})

await test('P-20 locked cost reserves part of total budget for ordinary units', () => {
  const policy = PRESETS.human_full
  const locked = makeUnit(policy, {
    moduleId: 'user-memory', unitKind: 'memoryRecord', view: 'full', quotaKey: '@unbounded',
    sourceRef: 'p20-locked', text: 'locked', cost: { jsChars: 30, utf8Bytes: 30 },
  })
  const ordinary = makeUnit(policy, {
    sourceRef: 'p20-event', text: 'ordinary', cost: { jsChars: 10, utf8Bytes: 10 },
  })
  const result = select(policy, [ordinary, locked], { jsChars: 50, utf8Bytes: 50 })
  assert.deepEqual(ids(result.selected), [ordinary.id, locked.id].sort((a, b) => {
    const left = a === locked.id ? locked : ordinary
    const right = b === locked.id ? locked : ordinary
    return right.priority - left.priority || left.moduleId.localeCompare(right.moduleId) || left.id.localeCompare(right.id)
  }))
  assert.equal(result.deferred.length, 0)
  assert.equal(result.budgetOvercommit, false)
  assert.equal(result.cost.jsChars - locked.cost.jsChars, 10)
  assert.ok(result.cost.jsChars - locked.cost.jsChars <= 50 - locked.cost.jsChars)
})

await test('P-21 configured unitKind cannot claim @unbounded', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'event', scope: 'event', max: 1, strength: 'hard' }] })
  const unit = makeUnit(policy, { sourceRef: 'p21', unitKind: 'event', quotaKey: '@unbounded' })
  assert.throws(() => select(policy, [unit]), error => error instanceof UnitPolicyError
    && error.code === 'quota-bypass'
    && error.detail.moduleId === 'events'
    && error.detail.unitKind === 'event')
})

await test('P-22 unitKind without a matching quota may use @unbounded', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'catalogEntry', scope: 'delivery', max: 1, strength: 'hard' }] })
  const unit = makeUnit(policy, { sourceRef: 'p22', unitKind: 'event', quotaKey: '@unbounded' })
  const result = select(policy, [unit])
  assert.deepEqual(ids(result.selected), [unit.id])
  assert.equal(result.budgetOvercommit, false)
})

await test('P-23 unitKind may select any configured scope quota', () => {
  const policy = policyWith('events', { quotas: [
    { unit: 'event', scope: 'event', max: 1, strength: 'hard' },
    { unit: 'event', scope: 'delivery', max: 2, strength: 'hard' },
  ] })
  const unit = makeUnit(policy, { sourceRef: 'p23', unitKind: 'event', quotaKey: 'event/delivery' })
  assert.deepEqual(ids(select(policy, [unit]).selected), [unit.id])
})

await test('P-24 ordinary budget behavior remains unchanged and has no overcommit', () => {
  const policy = PRESETS.human_full
  const units = Array.from({ length: 4 }, (_, i) => makeUnit(policy, {
    sourceRef: 'p24-' + i,
    text: '0123456789',
    cost: { jsChars: 10, utf8Bytes: 10 },
  }))
  const result = select(policy, units, { jsChars: 20, utf8Bytes: 20 })
  assert.equal(result.selected.length, 2)
  assert.equal(result.deferred.length, 2)
  assert.equal(result.truncatedBy, 'budget')
  assert.equal(result.budgetOvercommit, false)
})

await test('P-25 disabled module is rejected during locked budget overcommit', () => {
  const policy = policyWith('events', { enabled: false })
  const locked = makeUnit(policy, {
    moduleId: 'user-memory', unitKind: 'memoryRecord', view: 'full', quotaKey: '@unbounded',
    sourceRef: 'p25-locked', text: 'locked', cost: { jsChars: 100, utf8Bytes: 100 },
  })
  const disabled = makeUnit(policy, { sourceRef: 'p25-disabled' })
  const result = select(policy, [locked, disabled], { jsChars: 50, utf8Bytes: 50 })
  assert.deepEqual(ids(result.selected), [locked.id])
  assert.deepEqual(result.rejected.map(entry => entry.reason), ['module-disabled'])
  assert.deepEqual(result.deferred, [])
  assert.equal(result.truncatedBy, 'budget')
  assert.equal(result.budgetOvercommit, true)
})

await test('P-26 overcommit rejects disabled units and defers enabled units', () => {
  const policy = policyWith('events', { enabled: false })
  const locked = makeUnit(policy, {
    moduleId: 'user-memory', unitKind: 'memoryRecord', view: 'full', quotaKey: '@unbounded',
    sourceRef: 'p26-locked', text: 'locked', cost: { jsChars: 100, utf8Bytes: 100 },
  })
  const disabled = makeUnit(policy, { sourceRef: 'p26-disabled' })
  const enabled = makeUnit(policy, { moduleId: 'rules', unitKind: 'rule', view: 'full', sourceRef: 'p26-enabled' })
  const result = select(policy, [locked, disabled, enabled], { jsChars: 50, utf8Bytes: 50 })
  assert.deepEqual(result.rejected.map(entry => entry.reason), ['module-disabled'])
  assert.deepEqual(ids(result.deferred), [enabled.id])
  assert.deepEqual(ids(result.selected), [locked.id])
  assert.equal(result.truncatedBy, 'budget')
  assert.equal(result.budgetOvercommit, true)
})

await test('P-27 event-family quota rejects unbounded checkpoint bypass', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'event', scope: 'event', max: 1, strength: 'hard' }] })
  const checkpoint = makeUnit(policy, { unitKind: 'checkpoint', sourceRef: 'p27-checkpoint', quotaKey: '@unbounded' })
  expectCode(() => select(policy, [checkpoint]), 'quota-bypass')
})

await test('P-28 event-family quota rejects unbounded catalogEntry bypass', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'event', scope: 'event', max: 1, strength: 'hard' }] })
  const catalogEntry = makeUnit(policy, { unitKind: 'catalogEntry', sourceRef: 'p28-catalog', quotaKey: '@unbounded' })
  expectCode(() => select(policy, [catalogEntry]), 'quota-bypass')
})

await test('F3-01 duplicate unit/scope is rejected with the indexed error path', () => {
  const raw = structuredClone(PRESETS.human_full)
  raw.modules.events.quotas = [
    { unit: 'event', scope: 'event', max: 1, strength: 'hard' },
    { unit: 'event', scope: 'event', max: 2, strength: 'hard' },
  ]
  assert.throws(() => validatePolicy(raw), error => error instanceof DeliveryPolicyError
    && error.message.includes('duplicate-quota-scope')
    && error.message.includes('modules.events.quotas[1]'))
})

await test('F3-02 distinct scopes and all four presets remain valid', () => {
  for (const preset of Object.values(PRESETS)) validatePolicy(preset)
  const valid = policyWith('events', { quotas: [
    { unit: 'event', scope: 'event', max: 1, strength: 'hard' },
    { unit: 'event', scope: 'module', max: 2, strength: 'hard' },
  ] })
  assert.equal(valid.modules.events.quotas.length, 2)
})

await test('phase accepts taskbook legacy and rejects invalid phase and policy', () => {
  assert.deepEqual(select(PRESETS.run_slim, [], {}, 'legacy').selected, [])
  expectCode(() => selectUnits({ policy: PRESETS.run_slim, units: [], budget: {}, phase: 'unknown' }), 'invalid-phase')
  expectCode(() => selectUnits({ policy: null, units: [], budget: {}, phase: 'legacy' }), 'invalid-policy')
})

console.log('RESULT ' + passed + ' PASS / ' + failed + ' FAIL')
if (failed) process.exitCode = 1
