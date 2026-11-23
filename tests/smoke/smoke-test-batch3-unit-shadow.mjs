#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const INJECTION = path.join(REPO, 'lib', 'injection')
const SHADOW_PATH = path.join(INJECTION, 'unit-shadow.js')
const EVENT_STORE_PATH = path.join(REPO, 'lib', 'event-store.js')
const INDEX_PATH = path.join(REPO, 'lib', 'index.js')
const WORK = mkdtempSync(path.join(tmpdir(), 'dam-u3a2-shadow-'))
const HOME = path.join(WORK, 'dsh-home')
const WORKSPACE = path.join(WORK, 'workspace')
mkdirSync(HOME, { recursive: true })
mkdirSync(WORKSPACE, { recursive: true })

const oldHome = process.env.DSH_HOME
const oldFetch = globalThis.fetch
process.env.DSH_HOME = HOME
globalThis.fetch = async () => { throw Error('test network disabled') }

const { PRESETS, validatePolicy, legacyToPolicy } = await import(pathToFileURL(path.join(INJECTION, 'policy-v2.js')).href)
const { buildUnitShadow } = await import(pathToFileURL(SHADOW_PATH).href)
const { readDiagnosticDigest } = await import(pathToFileURL(path.join(INJECTION, 'diagnostics.js')).href)
const { previewDelivery } = await import(pathToFileURL(path.join(INJECTION, 'preview.js')).href)
const { extractRulesLayerPre } = await import(pathToFileURL(path.join(REPO, 'lib', 'rules-layer.js')).href)
const { DEFAULT_PROMPT_LAYERS } = await import(pathToFileURL(INDEX_PATH).href)
const { EVENT_STORE_FILENAME } = await import(pathToFileURL(EVENT_STORE_PATH).href)
const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs?u3a2=' + randomUUID())
const engine = new MemoryEngine()
engine.config = {
  ...engine.config,
  memoryRoot: path.join(HOME, 'memory', 'workspaces'),
  userMemoryDir: path.join(HOME, 'memory'),
  injectBudgetChars: 8000,
  rulesLayeringMode: 'self',
}
engine.configLoaded = true

const NOW = 1795171200000
const PLAN_NAMES = ['当前状态', '近期进展（按时间倒序）', '关键约束', '待办']
const PLAN_TEXT = [
  '# 项目白板 · U3a fixture',
  '',
  '## 当前状态',
  '正在验证影子投递。',
  '',
  '## 近期进展（按时间倒序）',
  '适配器与选择器已接好。',
  '',
  '## 关键约束',
  '正文保持不变。',
  '',
  '## 待办',
  '完成接线验收。',
].join('\n')
const HANDOFF_TEXT = [
  '# 交接账本',
  '',
  '## 目标',
  'type:goal',
  '验证 shadow 回执。',
  '',
  '## 任务状态',
  'type:state',
  'U3a-2 fixture。',
  '',
  '## 已试方案与失败原因',
  'type:dead-end',
  '没有失败方案。',
  '',
  '## 进度与下一步',
  'type:progress',
  '运行烟测。',
].join('\n')
const CALENDAR_TEXT = [
  '# 日历',
  '',
  '## 2026-11-22',
  '- [ ] 10:30 | Q1 | U3a shadow check | local fixture',
].join('\n')
const RULE_TEXT = [
  '# 用户记忆',
  '',
  '- 必须保持事件来源可追溯。',
].join('\n')

function policyWith({ diagnostics = false, eventQuotas } = {}) {
  const raw = structuredClone(PRESETS.human_full)
  raw.modules.diagnostics = { ...raw.modules.diagnostics, enabled: diagnostics }
  if (eventQuotas !== undefined) raw.modules.events.quotas = structuredClone(eventQuotas)
  return validatePolicy(raw)
}

function ruleItem(kind, text, suffix = 'u3a') {
  return {
    layer: 'project', entryIndex: 0, itemIndex: 0, segmentIndex: 0,
    entryId: 'entry-' + suffix, itemId: 'item-' + suffix,
    text, kind, revision: 'sha256:' + suffix, status: 'current', retired: false,
  }
}

function rulesAggregate() {
  return {
    dtoKind: 'RulesAggregate', schemaVersion: 1,
    rules: [ruleItem('rule', 'Keep the source identity.', 'rule')],
    notes: [], candidates: [], references: [], retired: [],
  }
}

function emptyRulesAggregate() {
  return { dtoKind: 'RulesAggregate', schemaVersion: 1, rules: [], notes: [], candidates: [], references: [], retired: [] }
}

function event(index, overrides = {}) {
  const id = 'evt_u3a2_' + String(index).padStart(3, '0')
  return {
    id,
    name: 'U3a event ' + index,
    summary: 'Event summary ' + index,
    status: 'active',
    sections: { goal: 'Goal ' + index, doing: 'Doing ' + index, deadend: '', next: 'Next ' + index },
    checkpoints: [],
    userPercept: [{ kind: 'preference', stage: 'accepted', text: 'Prefer traceable source ' + index,
      sourceRef: 'event:' + id + ':percept' }],
    ...overrides,
  }
}

function rawSources(overrides = {}) {
  return {
    events: [event(1), event(2), event(3)],
    rules: rulesAggregate(),
    planText: PLAN_TEXT,
    planSectionNames: PLAN_NAMES,
    handoffText: HANDOFF_TEXT,
    portraitItems: [{ kind: 'preference', stage: 'accepted', text: 'Prefer stable identifiers.',
      sourceRef: 'portrait:u3a2:preference' }],
    calendarEntries: [{ id: 'cal_u3a2', date: '2026-11-22', time: '10:30', quadrant: 'Q1',
      title: 'U3a shadow check', note: 'local fixture', done: false }],
    maintenance: 'Maintain the slim snapshot.',
    ...overrides,
  }
}

function agentFor(suffix) {
  return { session: { id: 'u3a2-' + suffix, header: { cwd: WORKSPACE } } }
}

async function prepareRefreshFixture({ diagnostics = false, events = [event(1), event(2), event(3)] } = {}) {
  const agent = agentFor(randomUUID())
  engine._lastAgent = agent
  engine.config = { ...engine.config, deliveryPolicy: policyWith({ diagnostics }) }
  const p = await engine.resolvePaths(agent)
  await Promise.all([
    fsPromises.mkdir(p.userDir, { recursive: true }),
    fsPromises.mkdir(p.projectDir, { recursive: true }),
    fsPromises.mkdir(p.handoffDir, { recursive: true }),
  ])
  const runtime = engine.runtimeFor(agent)
  const state = runtime.state
  Object.assign(state, {
    ws: WORKSPACE,
    userText: RULE_TEXT,
    notesText: '# Project notes\n\n- Keep the fixture local.\n',
    planText: PLAN_TEXT,
    latestHandoffText: HANDOFF_TEXT,
    calendarText: CALENDAR_TEXT,
    eventCardsText: '',
    eventCatalogText: '',
  })
  await fsPromises.writeFile(path.join(p.handoffDir, EVENT_STORE_FILENAME), JSON.stringify({ events }), 'utf8')
  const refresh = () => engine.withAgent(agent, () => engine.refreshEventStatePre(agent))
  return { agent, state, runtime, refresh }
}

const fsPromises = await import('node:fs/promises')
const sourceText = readFileSync(INDEX_PATH, 'utf8')
const counts = { pass: 0, fail: 0 }
async function check(name, run) {
  try {
    await run()
    counts.pass++
    console.log('PASS ' + name)
  } catch (error) {
    counts.fail++
    console.log('FAIL ' + name + ' :: ' + String(error && error.stack || error))
  }
}

async function callRefreshFixture(options) {
  const fixture = await prepareRefreshFixture(options)
  await fixture.refresh()
  return fixture
}

function renderFor(agent) {
  return engine.withAgent(agent, () => String(engine.renderMemoryDynamic({ agent }) || ''))
}

function parsePreviewHandler() {
  const marker = '      path: API.deliveryPreview,'
  const routeAt = sourceText.indexOf(marker)
  assert.notEqual(routeAt, -1, 'deliveryPreview route marker exists')
  const handlerAt = sourceText.indexOf('handler: ', routeAt)
  const start = handlerAt + 'handler: '.length
  const end = sourceText.indexOf('\n      },', start)
  assert.ok(handlerAt >= routeAt && end > start, 'preview handler bounds are valid')
  const environment = {
    engine,
    validatePolicy,
    legacyToPolicy,
    previewDelivery,
    extractRulesLayerPre,
    readDiagnosticDigest,
    DEFAULT_PROMPT_LAYERS,
    planSpecForTierPre: () => ({ sections: PLAN_NAMES }),
    readFileSync,
    diagLogFile: () => path.join(HOME, 'dsh-auto-memory-diagnose.log'),
    isLoopbackRequest: req => req.loopback !== false,
    panelAllowedHosts: [],
    forbiddenPanelPayloadPre: () => ({ error: 'forbidden: panel-access' }),
    readJsonBody: async req => req.body,
    writeJson: (res, status, body) => { res.status = status; res.body = body },
  }
  return new Function(...Object.keys(environment), 'return (' + sourceText.slice(start, end) + '\n})')
    (...Object.values(environment))
}

async function postPreview(handler, body) {
  const res = {}
  await handler({ method: 'POST', body, loopback: true }, res)
  return res
}

function mutateShadowSource(label, mutate, runMutant) {
  return (async () => {
    const source = readFileSync(SHADOW_PATH, 'utf8')
    const changed = mutate(source)
    assert.notEqual(changed, source, label + ' mutation anchor must change source')
    const temp = path.join(WORK, 'mutant-' + label + '-' + randomUUID() + '.mjs')
    const rewrittenImports = changed.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_all, _q, relative) => {
      const target = path.resolve(path.dirname(SHADOW_PATH), relative)
      return 'from ' + JSON.stringify(pathToFileURL(target).href)
    })
    writeFileSync(temp, rewrittenImports, 'utf8')
    try {
      const mutant = await import(pathToFileURL(temp).href + '?v=' + randomUUID())
      return await runMutant(mutant)
    } finally {
      try { rmSync(temp, { force: true }) } catch {}
    }
  })()
}

const basePolicy = policyWith()
const baseInput = {
  rawSources: rawSources(),
  policy: basePolicy,
  phase: 'human_full',
  budget: { jsChars: 8000, utf8Bytes: 24000 },
  now: NOW,
}

await check('S-01 disabled diagnostics leaves no shadow receipt after real refresh', async () => {
  const fixture = await prepareRefreshFixture({ diagnostics: false })
  fixture.state._unitShadowPre = { computed: true, stale: true }
  await fixture.refresh()
  assert.equal(Object.hasOwn(fixture.state, '_unitShadowPre'), false)
})

await check('S-02 enabled diagnostics computes from a real event-store refresh', async () => {
  const fixture = await callRefreshFixture({ diagnostics: true })
  const receipt = fixture.state._unitShadowPre
  assert.ok(receipt && receipt.computed, JSON.stringify(receipt))
  assert.ok(receipt.counts.raw > 0, JSON.stringify(receipt.counts))
  assert.ok(receipt.counts.selected > 0, JSON.stringify(receipt.counts))
  assert.deepEqual(receipt.covered, ['events', 'rules', 'plan', 'handoff', 'portrait', 'calendar'])
  assert.match(fixture.state.eventCardsText, /U3a event/)
})

await check('S-03 diagnostics toggle does not change rendered prompt bytes', async () => {
  const fixture = await callRefreshFixture({ diagnostics: true })
  assert.ok(fixture.state._unitShadowPre?.computed)
  const enabledPolicy = engine.config.deliveryPolicy
  engine.config.deliveryPolicy = policyWith({ diagnostics: false })
  const offText = renderFor(fixture.agent)
  engine.config.deliveryPolicy = enabledPolicy
  const onText = renderFor(fixture.agent)
  assert.equal(onText, offText)
})

await check('S-04 invalid event source degrades shadow but keeps refresh output', async () => {
  const fixture = await callRefreshFixture({ diagnostics: true, events: [event(1), { id: 22, status: 'active', name: 'bad-source', sections: 'invalid' }] })
  const receipt = fixture.state._unitShadowPre
  assert.ok(receipt && receipt.computed === false, JSON.stringify(receipt))
  assert.ok(receipt.degradations.some(item => item.source === 'events'), JSON.stringify(receipt.degradations))
  assert.match(fixture.state.eventCardsText, /U3a event 1/)
})

await check('S-05 budget and explicit assumed phase are reflected in the receipt', async () => {
  const receipt = buildUnitShadow(baseInput)
  assert.equal(receipt.assumed.phase, 'human_full')
  assert.equal(receipt.assumed.reason, 'refresh-before-tier')
  assert.equal(receipt.assumed.budget.jsChars, baseInput.budget.jsChars)
  assert.equal(receipt.assumed.budget.utf8Bytes, baseInput.budget.utf8Bytes)
  assert.ok(receipt.cost.jsChars <= receipt.assumed.budget.jsChars || receipt.budgetOvercommit)
})

await check('S-06 61 selected units keep counts exact and receipt within 4 KB', async () => {
  const manySources = rawSources({
    events: Array.from({ length: 61 }, (_, index) => event(index + 1)),
    rules: emptyRulesAggregate(), planText: '', handoffText: '', portraitItems: [], calendarEntries: [], maintenance: '',
  })
  const policy = policyWith({ eventQuotas: [] })
  const receipt = buildUnitShadow({ ...baseInput, rawSources: manySources, policy,
    budget: { jsChars: 1000000, utf8Bytes: 3000000 } })
  assert.equal(receipt.computed, true)
  assert.equal(receipt.counts.selected, 61)
  assert.equal(receipt.unitIds.length, 40)
  assert.ok(Buffer.byteLength(JSON.stringify(receipt), 'utf8') <= 4096)
})

await check('S-07 deterministic input is pure, deep-equal, and source has no IO/time/random calls', async () => {
  const before = structuredClone(baseInput.rawSources)
  const first = buildUnitShadow(baseInput)
  const second = buildUnitShadow(baseInput)
  assert.deepEqual(second, first)
  assert.deepEqual(baseInput.rawSources, before)
  const code = readFileSync(SHADOW_PATH, 'utf8')
  assert.doesNotMatch(code, /node:(?:fs|path)|from\s+['"](?:fs|path)['"]|Date\.now\s*\(|Math\.random\s*\(/)
})

await check('S-08 preview response and debugInfo expose only the cached current receipt', async () => {
  const fixture = await callRefreshFixture({ diagnostics: true })
  engine._lastAgent = fixture.agent
  const receipt = fixture.state._unitShadowPre
  const handler = parsePreviewHandler()
  const response = await postPreview(handler, { policy: policyWith({ diagnostics: false }), tier: 'human_full' })
  assert.equal(response.status, 200, JSON.stringify(response.body))
  assert.deepEqual(response.body.unitShadow, receipt)
  const debug = await engine.debugInfo()
  assert.deepEqual(debug.unitShadow, receipt)
  engine.config.deliveryPolicy = policyWith({ diagnostics: false })
  await fixture.refresh()
  assert.equal(Object.hasOwn(fixture.state, '_unitShadowPre'), false)
  const disabled = await postPreview(handler, { policy: policyWith({ diagnostics: false }), tier: 'human_full' })
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body))
  assert.equal(disabled.body.unitShadow, null)
})

await check('S-09 event-family quota is applied by bindUnits/selectUnits', async () => {
  const quota = [{ unit: 'event', scope: 'event', max: 1, strength: 'hard' }]
  const policy = policyWith({ eventQuotas: quota })
  const receipt = buildUnitShadow({ ...baseInput,
    rawSources: rawSources({ events: [event(1), event(2), event(3)] }), policy })
  assert.equal(receipt.computed, true)
  const eventUnits = receipt.unitIds.filter(id => id.startsWith('events:event:') || id.startsWith('events:checkpoint:'))
  assert.equal(eventUnits.length, 1, JSON.stringify(receipt))
  assert.ok(receipt.counts.rejected >= 2, JSON.stringify(receipt.counts))
  assert.equal(receipt.truncatedBy, 'quota')
  assert.deepEqual(receipt.degradations, [])
})

await check('S-10 warmed buildUnitShadow call stays under 15 ms', async () => {
  for (let index = 0; index < 3; index++) buildUnitShadow(baseInput)
  const start = performance.now()
  const receipt = buildUnitShadow(baseInput)
  const elapsed = performance.now() - start
  assert.ok(receipt.computed)
  assert.ok(elapsed < 15, 'elapsed=' + elapsed.toFixed(2) + 'ms')
})

const realIdentityEvent = () => event(90, { checkpoints: [
  { id: 'cp-real-1', checkpointId: 'checkpoint-real-1', sourceRef: 'source:real-1', text: 'first checkpoint' },
  { id: 'cp-real-2', checkpointId: 'checkpoint-real-2', sourceRef: 'source:real-2', text: 'second checkpoint' },
  { id: 'cp-real-3', checkpointId: 'checkpoint-real-3', sourceRef: 'source:real-3', text: 'third checkpoint' },
] })

const collapsedIdentityEvent = () => event(91, { checkpoints: [
  { checkpointId: 'unknown', text: 'same collapsed checkpoint' },
  { checkpointId: 'unknown', text: 'same collapsed checkpoint' },
] })

await check('S-11 duplicate real checkpoint identity makes shadow computation fail', async () => {
  const receipt = buildUnitShadow({ ...baseInput,
    rawSources: rawSources({ events: [collapsedIdentityEvent()] }) })
  assert.equal(receipt.computed, false, JSON.stringify(receipt))
  assert.equal(receipt.counts.selected, null, 'selection result is unknown after selector throws')
  assert.ok(receipt.degradations.some(item => item.source === 'selection' && item.code === 'duplicate-id'),
    JSON.stringify(receipt.degradations))
})

await check('S-12 event, portrait and calendar identity fields reach adapters unchanged', async () => {
  const sourceEvent = realIdentityEvent()
  const portrait = { kind: 'preference', stage: 'accepted', text: 'Use actual portrait source',
    sourceRef: 'real:portrait:source' }
  const calendar = { id: 'cal_real_identity', date: '2026-11-22', time: '10:30', quadrant: 'Q1',
    title: 'Actual calendar identity', note: '', done: false }
  const receipt = buildUnitShadow({ ...baseInput, rawSources: rawSources({ events: [sourceEvent],
    portraitItems: [portrait], calendarEntries: [calendar] }) })
  const checkpointIds = receipt.unitIds.filter(id => id.startsWith('events:checkpoint:'))
  assert.equal(receipt.computed, true, JSON.stringify(receipt))
  assert.equal(checkpointIds.length, sourceEvent.checkpoints.length, JSON.stringify(receipt.unitIds))
  assert.ok(checkpointIds.every(id => !id.includes('shadow-')), JSON.stringify(checkpointIds))
  for (const checkpoint of sourceEvent.checkpoints) {
    const expectedSuffix = ':event:' + encodeURIComponent(sourceEvent.id) + ':checkpoint:'
      + encodeURIComponent(checkpoint.sourceRef)
    assert.ok(checkpointIds.some(id => id.endsWith(expectedSuffix)),
      'checkpoint sourceRef identity retained: ' + checkpoint.sourceRef)
  }
  assert.ok(receipt.unitIds.some(id => id.endsWith(':' + portrait.sourceRef)))
  assert.ok(receipt.unitIds.some(id => id.includes(encodeURIComponent(calendar.id))))
})

await check('S-13 normal multi-source path keeps all real checkpoints and no duplicate-id degradation', async () => {
  const sourceEvent = realIdentityEvent()
  const receipt = buildUnitShadow({ ...baseInput, rawSources: rawSources({ events: [sourceEvent] }) })
  assert.equal(receipt.computed, true, JSON.stringify(receipt))
  assert.ok(receipt.counts.raw >= sourceEvent.checkpoints.length, JSON.stringify(receipt.counts))
  assert.equal(receipt.degradations.some(item => item.code === 'duplicate-id'), false,
    JSON.stringify(receipt.degradations))
})

await check('S-14 synthesized rules revision or segment identity is disclosed without failing computation', async () => {
  const rules = rulesAggregate()
  rules.rules[0].revision = ''
  const receipt = buildUnitShadow({ ...baseInput, rawSources: rawSources({ rules }) })
  assert.equal(receipt.computed, true, JSON.stringify(receipt))
  assert.ok(receipt.degradations.some(item => item.source === 'rules' && item.code === 'rules-identity-synthesized'
    && item.message === 'rules revision/segment tuple synthesized for shadow'), JSON.stringify(receipt.degradations))
})

let mutationCaught = 0
let mutationMissed = 0
async function mutation(name, change, redCheck) {
  try {
    const mutant = await mutateShadowSource(name, change, async module => module)
    const caught = await redCheck(mutant)
    if (caught) { mutationCaught++; console.log('PASS ' + name + ' mutation is detected') }
    else { mutationMissed++; console.log('FAIL ' + name + ' mutation was missed') }
  } catch (error) {
    mutationMissed++
    console.log('FAIL ' + name + ' mutation setup :: ' + String(error && error.message || error))
  }
}

await mutation('MV-01-assumed-phase', source => {
  const next = source.replace("const phase = typeof source.phase === 'string' ? source.phase.slice(0, 32) : null", "const phase = 'auto'")
  assert.notEqual(next, source, 'assumed phase anchor')
  return next
}, mutant => {
  const receipt = mutant.buildUnitShadow(baseInput)
  return receipt.assumed.phase !== 'human_full'
})

await mutation('MV-02-selected-count', source => {
  const next = source.replace('receipt.counts.selected = selection.selected.length', 'receipt.counts.selected = 0')
  assert.notEqual(next, source, 'selected count anchor')
  return next
}, mutant => {
  const receipt = mutant.buildUnitShadow(baseInput)
  return receipt.counts.selected !== buildUnitShadow(baseInput).counts.selected
})

await mutation('MV-03-unit-id-bound', source => {
  const next = source.replace('const MAX_UNIT_IDS = 40', 'const MAX_UNIT_IDS = 61')
  assert.notEqual(next, source, 'unitIds bound anchor')
  return next
}, mutant => {
  const policy = policyWith({ eventQuotas: [] })
  const many = { ...baseInput, policy, rawSources: rawSources({ events: Array.from({ length: 61 }, (_, i) => event(i + 1)),
    rules: emptyRulesAggregate(), planText: '', handoffText: '', portraitItems: [], calendarEntries: [], maintenance: '' }),
    budget: { jsChars: 1000000, utf8Bytes: 3000000 } }
  return mutant.buildUnitShadow(many).unitIds.length > 40
})

await mutation('MV-04-quota-result', source => {
  const next = source.replace('receipt.truncatedBy = selection.truncatedBy', 'receipt.truncatedBy = null')
  assert.notEqual(next, source, 'truncatedBy anchor')
  return next
}, mutant => {
  const policy = policyWith({ eventQuotas: [{ unit: 'event', scope: 'event', max: 1, strength: 'hard' }] })
  const input = { ...baseInput, policy, rawSources: rawSources({ events: [event(1), event(2), event(3)] }) }
  return mutant.buildUnitShadow(input).truncatedBy !== buildUnitShadow(input).truncatedBy
})

await mutation('MV-05-real-checkpoint-identity', source => {
  const anchor = "adapt('events', () => adaptEvents({ events: source.events }))"
  const replacement = "adapt('events', () => adaptEvents({ events: source.events.map((event, eventIndex) => ({ ...event, checkpoints: (event.checkpoints || []).map((checkpoint, checkpointIndex) => ({ ...checkpoint, id: 'shadow-checkpoint-' + eventIndex + '-' + checkpointIndex, checkpointId: '', sourceRef: '', idemKey: '', opId: '' })) })) }))"
  const next = source.replace(anchor, replacement)
  assert.notEqual(next, source, 'real event identity callsite anchor')
  return next
}, mutant => {
  const receipt = mutant.buildUnitShadow({ ...baseInput,
    rawSources: rawSources({ events: [collapsedIdentityEvent()] }) })
  return receipt.computed === true || !receipt.degradations.some(item => item.code === 'duplicate-id')
})

await mutation('MV-06-rules-synthesis-disclosure', source => {
  const block = "      if (prepared.identitySynthesized) {\n        receipt.degradations.push({ source: 'rules', code: 'rules-identity-synthesized',\n          message: 'rules revision/segment tuple synthesized for shadow' })\n      }\n"
  const next = source.replace(block, '')
  assert.notEqual(next, source, 'rules synthesis disclosure anchor')
  return next
}, mutant => {
  const rules = rulesAggregate()
  rules.rules[0].revision = ''
  const receipt = mutant.buildUnitShadow({ ...baseInput, rawSources: rawSources({ rules }) })
  return !receipt.degradations.some(item => item.code === 'rules-identity-synthesized')
})

try {
  await flushDiagnostics()
  if (typeof engine.dispose === 'function') await engine.dispose()
} catch {}
try { rmSync(WORK, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch {}
if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome
globalThis.fetch = oldFetch

console.log('SUMMARY PASS ' + counts.pass + ' / FAIL ' + counts.fail)
console.log('MUTATION ' + mutationCaught + ' CAUGHT / ' + mutationMissed + ' MISSED')
if (counts.pass !== 14 || counts.fail !== 0 || mutationCaught < 6 || mutationMissed !== 0) process.exitCode = 1
