import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE_DIR = process.env.U1_MUTATION_DIR || path.join(REPO, 'lib', 'injection')
const policyModule = await import(pathToFileURL(path.join(SOURCE_DIR, 'policy-v2.js')).href)
const unitModule = await import(pathToFileURL(path.join(SOURCE_DIR, 'unit-policy.js')).href)
const adapterModule = await import(pathToFileURL(path.join(SOURCE_DIR, 'unit-adapters.js')).href)
const { PRESETS, validatePolicy } = policyModule
const { UnitPolicyError, selectUnits, validateUnit } = unitModule
const { adaptEvents, adaptRules, adaptPlan, adaptHandoff, adaptPortrait, adaptCalendar, bindUnits } = adapterModule

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

function expectCode(run, code, adapterName) {
  assert.throws(run, error => error instanceof UnitPolicyError
    && error.code === code
    && (!adapterName || error.detail?.adapter === adapterName),
  'expected UnitPolicyError(' + code + ')')
}

function assertRawUnits(units, moduleId, unitKinds) {
  assert.ok(Array.isArray(units))
  assert.deepEqual(units.map(unit => unit.unitKind), unitKinds)
  for (const unit of units) {
    assert.deepEqual(Object.keys(unit).sort(), ['moduleId', 'pointer', 'sourceRef', 'text', 'unitKind'])
    assert.equal(unit.moduleId, moduleId)
    assert.equal(typeof unit.sourceRef, 'string')
    assert.ok(unit.sourceRef.trim())
    assert.equal(typeof unit.text, 'string')
    assert.ok(typeof unit.pointer === 'string' || unit.pointer === null)
    assert.ok(!('id' in unit) && !('cost' in unit))
  }
}

function rulesAggregate(overrides = {}) {
  return {
    dtoKind: 'RulesAggregate',
    schemaVersion: 1,
    rules: [], notes: [], candidates: [], references: [], retired: [],
    ...overrides,
  }
}

function ruleItem(kind, text, suffix = '1') {
  return {
    layer: 'project', entryIndex: 0, itemIndex: 0, segmentIndex: 0,
    entryId: 'entry-' + suffix, itemId: 'item-' + suffix,
    text, kind, revision: 'sha256:' + suffix, status: 'current', retired: false,
  }
}

const eventInput = {
  events: [
    { id: 'evt-active', name: 'Active event', status: 'active', summary: 'Active summary', sections: { goal: 'Goal' },
      checkpoints: [{ id: 'cp-1', text: 'Checkpoint body' }] },
    { id: 'evt-closed', name: 'Closed event', status: 'closed', summary: 'Closed summary' },
  ],
}
const handoffSections = [
  { title: '## 任务状态', body: ['type:state', 'State body'], weight: 0.15 },
  { title: '## 目标', body: ['type:goal', 'Goal body'], weight: 0.2 },
  { title: '## 已试方案与失败原因', body: ['type:dead-end', 'Dead-end body'], weight: 0.35 },
  { title: '## 进度与下一步', body: ['type:progress', 'Progress body'], weight: 0.3 },
]

function adapterCases() {
  const longText = 'long-unit-content-' + 'x'.repeat(5000)
  return [
    {
      code: 'EV', name: 'events', fn: adaptEvents, moduleId: 'events',
      valid: eventInput, expectedKinds: ['event', 'checkpoint', 'catalogEntry'],
      empty: { events: [] }, invalid: { events: [{ status: 'active' }] },
      long: { events: [{ id: 'evt-long', status: 'active', summary: longText }] },
      closedCheck: true,
    },
    {
      code: 'RP', name: 'rules', fn: adaptRules, moduleId: 'rules',
      valid: rulesAggregate({
        rules: [ruleItem('rule', 'Keep this rule')],
        notes: [ruleItem('note', 'Keep this note', '2')],
        candidates: [ruleItem('candidate', 'Candidate stays out', '3')],
        references: [ruleItem('reference', 'Reference stays out', '4')],
        retired: [{ ...ruleItem('rule', 'Retired stays out', '5'), status: 'superseded', retired: true }],
      }),
      expectedKinds: ['rule', 'rule'],
      empty: rulesAggregate(), invalid: { dtoKind: 'RulesAggregate', rules: [] },
      long: rulesAggregate({ rules: [ruleItem('rule', longText)] }),
    },
    {
      code: 'PL', name: 'plan', fn: adaptPlan, moduleId: 'plan',
      valid: { planSpec: { current: 'Current state', recent: 'Recent progress', constraints: 'Constraints', todos: 'Next steps', eventIds: ['evt-1'] } },
      expectedKinds: ['planSection', 'planSection', 'planSection', 'planSection'],
      empty: { planSpec: { current: '| 事件名 | 状态 | 最近进展 |\n|---|---|---|\n| （暂无 active 事件） | — | — |',
        recent: '（暂无事件）', constraints: '（暂无约束）', todos: '（暂无待办）' } },
      invalid: { planSpec: { current: 'Only one field' } },
      long: { planSpec: { current: '', recent: longText, constraints: '', todos: '' } },
    },
    {
      code: 'HO', name: 'handoff', fn: adaptHandoff, moduleId: 'handoff',
      valid: { sections: handoffSections },
      expectedKinds: ['ledgerSection', 'ledgerSection', 'ledgerSection', 'ledgerSection'],
      empty: { sections: [] }, invalid: { sections: [{ title: '## 目标' }] },
      long: { sections: [{ title: '## 目标', body: [longText], weight: 0.2 }] },
    },
    {
      code: 'PT', name: 'portrait', fn: adaptPortrait, moduleId: 'portrait',
      valid: { portraitItems: [
        { kind: 'preference', stage: 'accepted', text: 'Prefers concise answers', sourceRef: 'evt-1/percept-1', at: 1 },
        { kind: 'authorResponse', text: 'That correction is useful', sourceRef: 'evt-2/percept-1', at: 2 },
      ] },
      expectedKinds: ['portraitItem', 'portraitItem'],
      empty: { portraitItems: [] }, invalid: { portraitItems: [{ kind: 'preference', stage: 'accepted' }] },
      long: { portraitItems: [{ kind: 'state', stage: 'used', text: longText, sourceRef: 'evt-long/percept' }] },
    },
    {
      code: 'CA', name: 'calendar', fn: adaptCalendar, moduleId: 'calendar',
      valid: { entries: [{ id: 'cal_0123456789abcdef0123456789abcdef', date: '2026-11-20', done: false,
        time: '14:30', quadrant: '重要不紧急', title: 'Review', note: 'Bring the report' }] },
      expectedKinds: ['calendarEntry'],
      empty: { entries: [] }, invalid: { entries: [{ date: '2026-11-20', time: '12:00', quadrant: 'x', title: 'No done flag' }] },
      long: { entries: [{ date: '2026-11-20', done: false, time: '14:30', quadrant: '未分类', title: 'Long', note: longText }] },
    },
  ].map(testCase => ({ ...testCase, longText }))
}

for (const testCase of adapterCases()) {
  await test('AD-' + testCase.code + '-x1 ' + testCase.name + ' maps its calculated source shape', () => {
    if (testCase.code === 'EV') {
      const source = readFileSync(path.join(SOURCE_DIR, 'unit-adapters.js'), 'utf8')
      assert.equal(/\b(?:fs|path|process|Date|console)\b|Math\s*\.\s*random/.test(source), false)
    }
    const units = testCase.fn(testCase.valid)
    assertRawUnits(units, testCase.moduleId, testCase.expectedKinds)
    if (testCase.code === 'RP') assert.ok(units.every(unit => typeof unit.pointer === 'string' && unit.pointer.trim()))
    if (testCase.closedCheck) {
      const closed = units.find(unit => unit.sourceRef === 'event:evt-closed')
      assert.equal(closed.unitKind, 'catalogEntry')
      assert.ok(!units.some(unit => unit.sourceRef === 'event:evt-closed' && unit.unitKind === 'event'))
    }
    assert.deepEqual(testCase.fn(testCase.valid).map(unit => unit.sourceRef), units.map(unit => unit.sourceRef))
  })
  await test('AD-' + testCase.code + '-x2 empty ' + testCase.name + ' source is []', () => {
    const result = testCase.fn(testCase.empty)
    assert.ok(Array.isArray(result))
    assert.deepEqual(result, [])
  })
  await test('AD-' + testCase.code + '-x3 malformed ' + testCase.name + ' source is explicit', () => {
    expectCode(() => testCase.fn(testCase.invalid), 'invalid-source', 'adapt' + testCase.name[0].toUpperCase() + testCase.name.slice(1))
  })
  await test('AD-' + testCase.code + '-x4 long ' + testCase.name + ' text is not truncated', () => {
    const units = testCase.fn(testCase.long)
    assert.ok(units.some(unit => unit.text.includes(testCase.longText)))
    assert.ok(units.every(unit => !('cost' in unit)))
  })
}

function policyWith(moduleId, patch) {
  const raw = structuredClone(PRESETS.human_full)
  raw.modules[moduleId] = { ...raw.modules[moduleId], ...patch }
  return validatePolicy(raw)
}

function rawUnit(moduleId, unitKind, sourceRef, text = 'Body') {
  return { moduleId, unitKind, sourceRef, text, pointer: null }
}

await test('B-01 binding takes view and priority from policy and validates Unit', () => {
  const policy = PRESETS.human_full
  const bound = bindUnits([rawUnit('events', 'event', 'evt-1', 'Event body')], policy)[0]
  assert.equal(bound.view, policy.modules.events.view)
  assert.equal(bound.priority, policy.modules.events.priority)
  assert.equal(bound.id, 'events:event:evt-1')
  assert.deepEqual(bound.cost, { jsChars: 10, utf8Bytes: 10 })
  assert.equal(bound.policyKey, 'events:' + policy.modules.events.view + ':@unbounded')
  assert.equal(validateUnit(bound), bound)
  const overridden = bindUnits([rawUnit('events', 'event', 'evt-priority')], policy,
    { assignPriority: (raw, defaultPriority) => defaultPriority + 1 })[0]
  assert.equal(overridden.priority, policy.modules.events.priority + 1)
  assert.equal(validateUnit(overridden), overridden)
  const rulesPolicy = PRESETS.human_slim
  const rule = bindUnits(adaptRules(rulesAggregate({ rules: [ruleItem('rule', 'Full rule text')] })), rulesPolicy)[0]
  assert.equal(rule.view, 'pointer')
  assert.ok(rule.pointer)
  assert.equal(validateUnit(rule), rule)
})

await test('B-02 invalid policy view fails at bind time', () => {
  const policy = structuredClone(PRESETS.human_full)
  policy.modules.events.view = 'not-a-view'
  expectCode(() => bindUnits([rawUnit('events', 'event', 'evt-1')], policy), 'view-not-allowed')
})

await test('B-03 one matching quota produces its exact policyKey', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'event', scope: 'event', max: 2, strength: 'hard' }] })
  const unit = bindUnits([rawUnit('events', 'event', 'evt-1')], policy)[0]
  assert.equal(unit.policyKey, 'events:' + policy.modules.events.view + ':event/event')
})

await test('B-04 multiple matching scopes fail as ambiguous', () => {
  const policy = policyWith('events', { quotas: [
    { unit: 'event', scope: 'event', max: 2, strength: 'hard' },
    { unit: 'event', scope: 'delivery', max: 3, strength: 'hard' },
  ] })
  expectCode(() => bindUnits([rawUnit('events', 'event', 'evt-1')], policy), 'ambiguous-quota-scope')
  const familyAmbiguous = policyWith('events', { quotas: [
    { unit: 'event', scope: 'event', max: 2, strength: 'hard' },
    { unit: 'checkpoint', scope: 'delivery', max: 3, strength: 'hard' },
  ] })
  expectCode(() => bindUnits([rawUnit('events', 'checkpoint', 'evt-1/cp-1')], familyAmbiguous), 'ambiguous-quota-scope')
})

await test('B-05 no matching unitKind quota binds @unbounded', () => {
  const policy = policyWith('events', { quotas: [] })
  const unit = bindUnits([rawUnit('events', 'event', 'evt-1')], policy)[0]
  assert.equal(unit.policyKey, 'events:' + policy.modules.events.view + ':@unbounded')
})

await test('B-06 bind cost uses UTF-16 chars and UTF-8 bytes', () => {
  const text = '中文😀'
  const unit = bindUnits([rawUnit('events', 'event', 'evt-utf8', text)], PRESETS.human_full)[0]
  assert.equal(unit.cost.jsChars, text.length)
  assert.equal(unit.cost.utf8Bytes, Buffer.byteLength(text, 'utf8'))
  assert.equal(unit.cost.jsChars, 4)
  assert.equal(unit.cost.utf8Bytes, 10)
})

await test('B-07 duplicate raw sourceRef creates duplicate id for selector to reject', () => {
  const policy = PRESETS.human_full
  const bound = bindUnits([
    rawUnit('events', 'event', 'same-source', 'First text'),
    rawUnit('events', 'event', 'same-source', 'Second text'),
  ], policy)
  assert.equal(bound[0].id, bound[1].id)
  expectCode(() => selectUnits({ policy, units: bound, budget: {}, phase: 'run_full' }), 'duplicate-id')
})

await test('B-08 bound adapter output feeds selector and selects content', () => {
  const policy = PRESETS.human_full
  const units = bindUnits(adaptPlan({ planSpec: { current: 'Current', recent: '', constraints: '', todos: '' } }), policy)
  const result = selectUnits({ policy, units, budget: {}, phase: 'human_full' })
  assert.ok(result.selected.length > 0)
  assert.equal(result.selected[0].text, 'Current')
})

await test('B-09 event-family quota binds checkpoint to event/event', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'event', scope: 'event', max: 2, strength: 'hard' }] })
  const unit = bindUnits([rawUnit('events', 'checkpoint', 'evt-1/cp-1')], policy)[0]
  assert.equal(unit.policyKey, 'events:' + policy.modules.events.view + ':event/event')
})

await test('B-10 event-family quota binds catalogEntry to event/event', () => {
  const policy = policyWith('events', { quotas: [{ unit: 'event', scope: 'event', max: 2, strength: 'hard' }] })
  const unit = bindUnits([rawUnit('events', 'catalogEntry', 'evt-closed')], policy)[0]
  assert.equal(unit.policyKey, 'events:' + policy.modules.events.view + ':event/event')
})

await test('B-11 maintenance produces one ruleModule unit only when non-empty', () => {
  const aggregate = rulesAggregate()
  const without = adaptRules(aggregate)
  assert.ok(without.every(unit => unit.unitKind !== 'ruleModule'))
  const units = adaptRules({ ...aggregate, maintenance: { key: 'snapshot-slim', text: 'Maintain the slim snapshot.' } })
  const maintenance = units.filter(unit => unit.unitKind === 'ruleModule')
  assert.equal(maintenance.length, 1)
  assert.equal(maintenance[0].sourceRef, 'rules:maintenance:snapshot-slim')
  assert.equal(maintenance[0].text, 'Maintain the slim snapshot.')
  const defaultKey = adaptRules({ ...aggregate, maintenance: { text: 'Default maintenance identity.' } })
    .find(unit => unit.unitKind === 'ruleModule')
  assert.equal(defaultKey.sourceRef, 'rules:maintenance:default')
  assert.equal(adaptRules({ ...aggregate, maintenance: { text: '   ' } }).some(unit => unit.unitKind === 'ruleModule'), false)
})

console.log('RESULT ' + passed + ' PASS / ' + failed + ' FAIL')
if (failed) process.exitCode = 1
