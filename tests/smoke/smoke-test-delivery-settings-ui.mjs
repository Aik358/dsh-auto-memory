#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'
import { PRESETS, MODULE_REGISTRY, legacyToPolicy } from '../../lib/injection/policy-v2.js'
import { effectiveTriggers } from '../../lib/injection/policy-runtime.js'
import { previewDelivery } from '../../lib/injection/preview.js'
import { readDiagnosticDigest } from '../../lib/injection/diagnostics.js'
import { PROMPT_SECTION_KEYS_PRE_V1, PROMPT_SECTION_MUST_PRE_V1 } from '../../lib/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = name => readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')
const policySource = read('skins/iter5/policy-settings.js')
const clientSource = read('lib/client.js')
const indexSource = read('lib/index.js')
const frozenSource = read('skins/legacy/iter5-325.js.frozen')
const classicSettingsSource = extractBetween(clientSource, 'function SettingsPage(props) {', '    // ───────────────────────── 插件挂载')
const nativePolicyControlSource = extractBetween(read('skins/iter5/ui.js'), 'function Iter5Icon(props) {', '    function Iter5Screws()')
const registrySnapshot = () => ({
  policy: JSON.parse(JSON.stringify(PRESETS.human_full)),
  capabilities: { schemaVersion: 2, presets: PRESETS, modules: MODULE_REGISTRY, previewPartial: true },
  promptSections: PROMPT_SECTION_KEYS_PRE_V1.slice(),
  promptSectionMust: PROMPT_SECTION_MUST_PRE_V1.slice(),
  config: {
    deliveryPolicy: null,
    promptSectionToggles: { 'rules-section': false },
    fullInjectWaterPct: '25,50',
    handoffPlanChars: 1400,
    externalInjectionChars: 1200,
    slimCheckpointCount: 3,
    slimPlanChars: 400,
    slimLedgerChars: 350,
  },
  diagnosticMeta: { path: 'local/diagnose.log', sizeText: '2 KB', lines: 12 },
})

let pass = 0
let fail = 0
function check(condition, message) {
  if (condition) { pass++; console.log('PASS ' + message) }
  else { fail++; console.error('FAIL ' + message) }
}
function count(text, needle) { return String(text).split(needle).length - 1 }
function extractBetween(text, start, end) {
  const i = text.indexOf(start)
  if (i < 0) return ''
  const j = text.indexOf(end, i + start.length)
  return j < 0 ? '' : text.slice(i, j)
}
function generatedV4(text) {
  const lines = text.split('\n')
  const frozenEnd = lines.findIndex(line => line === '    // ===== ITER5-LEGACY-GENERATED:END =====')
  const begin = lines.findIndex((line, index) => index > frozenEnd && line === '    // ITER5-GENERATED:BEGIN')
  const end = lines.findIndex((line, index) => index > begin && line === '    // ITER5-GENERATED:END')
  assert(begin >= 0 && end > begin, 'generated v4 block markers must be present')
  return lines.slice(begin, end + 1).join('\n')
}
function renderHarness() {
  const slots = []
  const pendingEffects = []
  let cursor = 0
  const h = (type, props, ...children) => ({ type,
    props: { ...(props || {}), ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) },
    children: children.flat(Infinity).filter(value => value !== null && value !== undefined && value !== false),
  })
  const useState = initial => {
    const index = cursor++
    if (!slots[index]) slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial }
    const cell = slots[index]
    return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next }]
  }
  const useRef = initial => {
    const index = cursor++
    if (!slots[index]) slots[index] = { kind: 'ref', current: initial }
    return slots[index]
  }
  const useEffect = (effect, deps) => {
    const index = cursor++
    const cell = slots[index]
    if (!cell) {
      slots[index] = { kind: 'effect', deps, effect, pending: true }
      pendingEffects.push(index)
    } else if (!Array.isArray(deps) || !Array.isArray(cell.deps)
      || deps.length !== cell.deps.length || deps.some((value, n) => value !== cell.deps[n])) {
      slots[index] = { kind: 'effect', deps, effect, pending: true, cleanup: cell.cleanup }
      pendingEffects.push(index)
    }
  }
  return { h, useState, useRef, useEffect,
    begin() { cursor = 0 },
    flushEffects() {
      for (const index of pendingEffects.splice(0)) {
        const cell = slots[index]
        if (!cell || cell.pending !== true) continue
        cell.pending = false
        if (typeof cell.cleanup === 'function') cell.cleanup()
        cell.cleanup = cell.effect()
      }
    },
  }
}
function componentFrom(source, overrides = {}) {
  const hooks = renderHarness()
  const { h, useState, useRef, useEffect } = hooks
  const React = { Fragment: Symbol('Fragment') }
  const env = {
    h(type, props, ...children) {
      if (type === Runtime.tabs || type === Runtime.icon) return type({ ...props, children })
      return h(type, props, ...children)
    },
    React, useState, useRef, useEffect,
    L: (_zh, en) => en,
    locale: 'en',
    PROMPT_SECTION_TEXT: {},
    apiGet: async () => { throw new Error('unexpected config request when a snapshot was supplied') },
    apiPost: async () => { throw new Error('unexpected API call') },
    API: { config: '/config', deliveryPreview: '/delivery-preview' },
    controller: { subscribe: () => () => {} },
    navigator: { clipboard: { writeText: async () => {} } },
    saveConfigPatch: async () => ({ ok: true }),
    setTimeout: () => 1,
    clearTimeout: () => {},
    ...overrides,
  }
  const names = Object.keys(env)
  const values = Object.values(env)
  assert(nativePolicyControlSource, 'native settings tabs and icons must be extractable')
  const Runtime = new Function(...names, nativePolicyControlSource + '\n' + source
    + '\nreturn { component: Iter5PolicySettings, createAdapter: createDeliveryPolicySettingsPre, tabs: Iter5Tabs, icon: Iter5Icon };')(...values)
  return {
    createAdapter: Runtime.createAdapter,
    render(props = { snapshot: registrySnapshot() }) {
      hooks.begin()
      return Runtime.component(props)
    },
    flushEffects: hooks.flushEffects,
  }
}
function walk(node, visit, parent = null) {
  if (Array.isArray(node)) { for (const child of node) walk(child, visit, parent); return }
  if (!node || typeof node !== 'object') return
  visit(node, parent)
  walk(node.children, visit, node)
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node !== 'object') return String(node)
  return textOf(node.children)
}
function nodes(node, predicate) {
  const result = []
  walk(node, current => { if (predicate(current)) result.push(current) })
  return result
}
function visibleNodes(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => visibleNodes(child, predicate))
  if (!tree || typeof tree !== 'object' || tree.props.hidden === true) return []
  return (predicate(tree) ? [tree] : []).concat(visibleNodes(tree.children, predicate))
}
function buttonFor(node, predicate) {
  return nodes(node, current => current.type === 'button' && predicate(current))[0]
}
function policyToggle(tree) {
  return buttonFor(tree, node => Object.hasOwn(node.props, 'data-dam-policy-toggle'))
}
function pageTab(node, label) {
  return buttonFor(node, current => current.props.role === 'tab' && textOf(current).trim() === label)
}
function openEditor(app, tree = app.tree) {
  const toggle = policyToggle(tree)
  assert(toggle && toggle.props['aria-expanded'] === false, 'policy entry is a collapsed disclosure')
  toggle.props.onClick()
  const expanded = app.rerender()
  assert.equal(policyToggle(expanded)?.props['aria-expanded'], true, 'policy disclosure opens through its actual button')
  return expanded
}
function switchPage(app, tree, label) {
  const tab = pageTab(tree, label)
  assert(tab, 'policy tab must be available: ' + label)
  tab.props.onClick()
  return app.rerender()
}
function openPage(app, label) {
  return switchPage(app, openEditor(app), label)
}
function policyInput(tree, field, type = 'input') {
  return nodes(tree, node => node.type === type && node.props.id?.endsWith('-' + field))[0]
}
async function boot(props, source = policySource, overrides = {}) {
  const fake = componentFrom(source, overrides)
  let tree = fake.render(props)
  fake.flushEffects()
  tree = fake.render(props)
  return { fake, tree, rerender(next = props) { tree = fake.render(next); fake.flushEffects(); tree = fake.render(next); return tree } }
}
function checkMountpoints(source, frozenText = frozenSource) {
  const classic = extractBetween(source, 'function SettingsPage(props) {', '    // ───────────────────────── 插件挂载')
  const variant = generatedV4(source)
  const frozenStart = frozenText.indexOf('function Iter5Settings(props) {')
  const frozen = frozenStart >= 0 ? frozenText.slice(frozenStart) : ''
  const frozenPage = extractBetween(frozenText, 'function Iter5Page(props) {', 'function Iter5Art(props) {')
  const marker = "'data-dam-policy-mountpoint':"
  const passThrough = "policySettings: page[0] === 'settings' ? props.policySettings : undefined"
  return classic && count(classic, marker) === 1
    && count(variant, marker) === 1
    && count(frozen, marker) === 1
    && count(frozenPage, passThrough) === 1
}
function singlePolicyPatch(patch) {
  return !!patch && Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, 'deliveryPolicy')
}
function controlsAreSeparate(tree) {
  const views = nodes(tree, n => n.props && n.props['data-policy-view-control'])
  const representations = nodes(tree, n => n.props && n.props['data-policy-representation-control'])
  return views.length > 0 && representations.length > 0
    && !nodes(tree, n => n.props && n.props['data-policy-view-control'] && n.props['data-policy-representation-control']).length
}
function lockedRowsHaveNoSwitch(tree) {
  for (const id of ['user-memory', 'project-notes']) {
    const row = nodes(tree, n => n.props && n.props['data-module-id'] === id)[0]
    if (!row) return false
    if (nodes(row, n => n.type === 'input' && n.props.type === 'checkbox').length) return false
  }
  return true
}
function oneLogsAliasRow(tree) {
  const recent = nodes(tree, n => n.props && n.props['data-module-id'] === 'recentLogs')
  const alias = nodes(tree, n => n.props && n.props['data-module-id'] === 'logs')
  return recent.length === 1 && alias.length === 0 && textOf(recent[0]).toLowerCase().includes('logs')
}
function waterDefaultsMatch(client, frozen, copy) {
  const inputFallback = source => source.includes("placeholder: '25'")
    && source.includes("fullInjectWaterPct === undefined ? '25' : String(cfg.fullInjectWaterPct)")
    && !source.includes("placeholder: '25,50'")
    && !source.includes("fullInjectWaterPct === undefined ? '25,50'")
  return inputFallback(client) && count(client, "field(t('fInjectWaterPct')") >= 3
    && inputFallback(frozen) && count(frozen, "field(t('fInjectWaterPct')") === 1
    && /默认\s*25/.test(copy) && /default\s*25/i.test(copy)
    && /填(?:写)?\s*['\u2018]?25,50/.test(copy) && /enter\s*25,50/i.test(copy)
}
function partialWithViolations(tree, code) {
  return textOf(tree).includes('Partial result') && textOf(tree).includes(code)
}
function sectionsUseServerOnly(tree, sections) {
  const list = nodes(tree, n => n.props && n.props.className === 'i5-policy-section-registry')[0]
  if (!Array.isArray(sections)) return !list && textOf(tree).includes('did not return the section/must registry')
  return !!list && sections.every(key => textOf(list).includes(key))
}

const snapshot = registrySnapshot()

// 1. Classic, generated v4 and frozen each have one mountpoint; a removed mount is detected.
const classicAnchor = clientSource.indexOf("'data-dam-policy-mountpoint': 'classic'")
const classicMutant = classicAnchor < 0 ? clientSource : clientSource.slice(0, classicAnchor)
  + clientSource.slice(classicAnchor).replace("'data-dam-policy-mountpoint': 'classic'", "'data-dam-policy-mountpoint-mutant': 'classic'")
const frozenPassThrough = "policySettings: page[0] === 'settings' ? props.policySettings : undefined"
const frozenPassMutant = frozenSource.replace(frozenPassThrough, 'policySettings: undefined')
check(checkMountpoints(clientSource) && !checkMountpoints(classicMutant)
  && frozenSource.includes(frozenPassThrough) && !checkMountpoints(clientSource, frozenPassMutant),
  '01 classic template/v4/frozen mount once; frozen page forwards props to settings; removal mutants are caught')

// 2. Run the real save handler and require its only field to be deliveryPolicy.
{
  let saved = null
  const fake = componentFrom(policySource, { saveConfigPatch: patch => { saved = patch; return Promise.resolve({ ok: true }) } })
  const adapter = fake.createAdapter()
  const props = { snapshot, onSave: adapter.onSave, onPreview: () => Promise.resolve(null) }
  let tree = fake.render(props)
  fake.flushEffects()
  tree = fake.render(props)
  const app = { tree, rerender(next = props) { tree = fake.render(next); fake.flushEffects(); tree = fake.render(next); return tree } }
  tree = openPage(app, 'Presets & cadence')
  const preset = policyInput(tree, 'preset', 'select')
  assert(preset)
  preset.props.onChange({ target: { value: 'human_slim' } })
  tree = app.rerender()
  const save = buttonFor(tree, n => textOf(n).includes('Save policy'))
  assert(save)
  const savedResult = save.props.onClick()
  await Promise.resolve(savedResult)
  await Promise.resolve()
  await Promise.resolve()
  assert(singlePolicyPatch(saved), 'real Save handler must send only the deliveryPolicy key')
  const oldKeyMutant = { deliveryPolicy: saved.deliveryPolicy, injectBudgetChars: 8000 }
  assert(!singlePolicyPatch(oldKeyMutant), 'negative mutation: legacy-key double write is rejected')
  check(singlePolicyPatch(saved) && !singlePolicyPatch(oldKeyMutant), '02 save round-trip path is single-key; old-key mutation is caught')
}

// 2b. A module switch, semantic view and number survive save plus a fresh config read.
{
  let saved = null
  const fake = componentFrom(policySource, { saveConfigPatch: patch => { saved = patch; return Promise.resolve({ ok: true }) } })
  const adapter = fake.createAdapter()
  const props = { snapshot, onSave: adapter.onSave, onPreview: adapter.onPreview }
  let tree = fake.render(props)
  fake.flushEffects()
  tree = fake.render(props)
  const app = { tree, rerender(next = props) { tree = fake.render(next); fake.flushEffects(); tree = fake.render(next); return tree } }
  tree = openPage(app, 'Modules')
  const eventRow = nodes(tree, node => node.props && node.props['data-module-id'] === 'events')[0]
  const enabled = nodes(eventRow, node => node.type === 'input' && node.props.type === 'checkbox')[0]
  const view = nodes(eventRow, node => node.type === 'select' && node.props['data-policy-view-control'] === 'events')[0]
  const priority = policyInput(eventRow, 'module-events-priority')
  assert(enabled && view && priority)
  enabled.props.onChange({ target: { checked: false } })
  tree = app.rerender()
  const refreshedRow = nodes(tree, node => node.props && node.props['data-module-id'] === 'events')[0]
  nodes(refreshedRow, node => node.type === 'select' && node.props['data-policy-view-control'] === 'events')[0]
    .props.onChange({ target: { value: 'cards' } })
  tree = app.rerender()
  const number = policyInput(tree, 'module-events-priority')
  number.props.onChange({ target: { value: '75' } })
  tree = app.rerender()
  await buttonFor(tree, node => textOf(node).includes('Save policy')).props.onClick()
  await Promise.resolve()
  assert(saved && saved.deliveryPolicy.modules.events.enabled === false)
  assert.equal(saved.deliveryPolicy.modules.events.view, 'cards')
  assert.equal(saved.deliveryPolicy.modules.events.priority, 75)
  assert.deepEqual(Object.keys(saved), ['deliveryPolicy'])
  const reloadedSnapshot = { ...snapshot, policy: saved.deliveryPolicy,
    config: { ...snapshot.config, deliveryPolicy: saved.deliveryPolicy } }
  const reloaded = await boot({ snapshot: reloadedSnapshot })
  const reloadedTree = openPage(reloaded, 'Modules')
  const row = nodes(reloadedTree, node => node.props && node.props['data-module-id'] === 'events')[0]
  assert.equal(nodes(row, node => node.type === 'input' && node.props.type === 'checkbox')[0].props.checked, false)
  assert.equal(nodes(row, node => node.type === 'select' && node.props['data-policy-view-control'] === 'events')[0].props.value, 'cards')
  assert.equal(policyInput(row, 'module-events-priority').props.value, 75)
  check(true, '02b enabled/view/number save through deliveryPolicy and reload without value drift')
}

// 2c. Invalid interactive values are rejected before the adapter writes anything.
{
  async function rejectedEdit(pageLabel, controlPredicate, nextValue) {
    let writes = 0
    const props = { snapshot, onSave: () => { writes++; return Promise.resolve({ ok: true }) }, onPreview: () => Promise.resolve(null) }
    const app = await boot(props)
    let tree = openPage(app, pageLabel)
    if (pageLabel === 'Modules' && controlPredicate === 'quota-unit') {
      const eventRow = nodes(tree, node => node.props && node.props['data-module-id'] === 'events')[0]
      buttonFor(eventRow, node => textOf(node).includes('Add quota')).props.onClick()
      tree = app.rerender()
      const unit = policyInput(tree, 'module-events-quota-0-unit', 'select')
      assert(unit)
      unit.props.onChange({ target: { value: nextValue } })
    } else {
      const target = nodes(tree, controlPredicate)[0]
      assert(target)
      target.props.onChange({ target: { value: nextValue } })
    }
    tree = app.rerender()
    const save = buttonFor(tree, node => textOf(node).includes('Save policy'))
    assert(save && save.props.disabled === true, 'invalid edit must disable Save: ' + String(nextValue))
    await save.props.onClick()
    assert.equal(writes, 0, 'invalid edit must not call save adapter')
  }
  await rejectedEdit('Modules', node => node.type === 'select' && node.props['data-policy-view-control'] === 'events', 'unknown-view')
  await rejectedEdit('Modules', node => node.type === 'input' && node.props.id?.endsWith('-module-events-priority'), '2.5')
  await rejectedEdit('Modules', 'quota-unit', 'unknown-unit')
  await rejectedEdit('Budget & overflow', node => node.type === 'input' && node.props.id?.endsWith('-transport-jsChars'), '-1')
  check(true, '02c unknown view/unit, fractional priority and negative budget are blocked before save')
}

// 3. Module view and unit representation are separate controls, not one merged enum.
{
  const app = await boot({ snapshot })
  const modulesPage = openPage(app, 'Modules')
  const viewNodes = nodes(modulesPage, n => n.props && n.props['data-policy-view-control'])
  assert(viewNodes.length > 0)
  const budgetPage = switchPage(app, modulesPage, 'Budget & overflow')
  const repNodes = nodes(budgetPage, n => n.props && n.props['data-policy-representation-control'])
  const mergedMutant = { type: 'select', props: { 'data-policy-view-control': 'events', 'data-policy-representation-control': 'preferred' }, children: [] }
  assert(!controlsAreSeparate([viewNodes[0], mergedMutant]), 'negative mutation: a combined view/representation select is rejected')
  check(controlsAreSeparate([modulesPage, budgetPage]) && !controlsAreSeparate([viewNodes[0], mergedMutant]), '03 view and representation controls stay distinct')
}

// 4. Locked memory sources are visible but cannot be toggled.
{
  const app = await boot({ snapshot })
  const tree = openPage(app, 'Modules')
  const mutant = JSON.parse(JSON.stringify(tree))
  let inserted = false
  walk(mutant, node => {
    if (!inserted && node.props && node.props['data-module-id'] === 'user-memory') {
      node.children.push({ type: 'input', props: { type: 'checkbox' }, children: [] })
      inserted = true
    }
  })
  assert(inserted)
  check(lockedRowsHaveNoSwitch(tree) && !lockedRowsHaveNoSwitch(mutant), '04 locked user-memory/project-notes have no switch; unlock mutant is caught')
}

// 5. logs is displayed as recentLogs alias only.
{
  const app = await boot({ snapshot })
  const tree = openPage(app, 'Modules')
  const alias = nodes(tree, n => n.props && n.props['data-module-id'] === 'recentLogs')[0]
  assert(alias)
  const duplicate = { type: 'div', props: { 'data-module-id': 'logs' }, children: ['Logs'] }
  check(oneLogsAliasRow(tree) && !oneLogsAliasRow([tree, duplicate]), '05 recentLogs owns the sole logs row; duplicate logs mutant is caught')
}

// 6. Default diagnostics preview is zero-injection and never reads the diagnostic file.
{
  let reads = 0
  let result = null
  const apiPreview = payload => {
    const sources = {}
    Object.defineProperty(sources, 'diagnostic', { enumerable: true, get() {
      return readDiagnosticDigest({ enabled: payload.policy.modules.diagnostics.enabled,
        file: 'fixture', now: 1_800_000_000_000, windowHours: 24, maxLines: 5,
        readFile: () => { reads++; return '' } })
    } })
    result = previewDelivery({ policy: payload.policy, sources, tier: payload.tier, isHuman: payload.isHuman, isFull: payload.isFull })
    return Promise.resolve(result)
  }
  const app = await boot({ snapshot, onPreview: apiPreview })
  let tree = openPage(app, 'Preview & receipt')
  const previewButton = buttonFor(tree, n => textOf(n).includes('Generate read-only preview'))
  assert(previewButton)
  await previewButton.props.onClick()
  tree = app.rerender()
  assert.equal(reads, 0)
  assert.equal(result.receipt.diagnosticInjections, 0)
  const disabledReads = reads
  const enabledSnapshot = JSON.parse(JSON.stringify(snapshot))
  enabledSnapshot.policy.modules.diagnostics.enabled = true
  const enabled = await boot({ snapshot: enabledSnapshot, onPreview: apiPreview })
  const enabledTree = openPage(enabled, 'Preview & receipt')
  const enabledButton = buttonFor(enabledTree, n => textOf(n).includes('Generate read-only preview'))
  await enabledButton.props.onClick()
  check(disabledReads === 0 && reads > disabledReads && result.receipt.diagnosticInjections === 0,
    '06 default diagnostics are zero-byte/no-read; enabling them exercises the reader')
}

// 7. Water strings are exact across all faces, default to 25, and preserve explicit 25,50.
{
  const copy = read('skins/iter5/settings-copy.js')
  const exactDefaults = waterDefaultsMatch(clientSource, frozenSource, copy)
  const mutated = clientSource.replace("placeholder: '25'", "placeholder: '25,50'")
  assert.notEqual(mutated, clientSource)
  assert(!waterDefaultsMatch(mutated, frozenSource, copy), 'negative mutation: 25,50 default placeholder must fail')
  const app = await boot({ snapshot })
  const tree = openPage(app, 'Triggers')
  const water = nodes(tree, n => n.type === 'input' && n.props['aria-label'] === 'Water percentage thresholds')[0]
  assert(water)
  assert.equal(water.props.value, '25')
  water.props.onChange({ target: { value: '25,50' } })
  const edited = app.rerender()
  assert(textOf(edited).includes('25,50'))
  check(exactDefaults && !waterDefaultsMatch(mutated, frozenSource, copy)
    && water.props.placeholder === '25' && textOf(edited).includes('25,50'), '07 default 25 and explicit 25,50 behavior are protected')
}

// 7b. Exercise incremental entry, fractional legacy values, and the empty list on the real save path.
{
  async function verifyWater(source) {
    const written = []
    const app = await boot({ snapshot, onSave: async policy => { written.push(policy.triggers.waterPct) } }, source)
    let tree = openPage(app, 'Triggers')
    function edit(value) {
      policyInput(tree, 'triggers-waterPct').props.onChange({ target: { value } })
      tree = app.rerender()
      assert.equal(policyInput(tree, 'triggers-waterPct').props.value, value, 'editing must preserve partial water text')
    }
    function saveButton() { return buttonFor(tree, node => textOf(node).trim() === 'Save policy') }
    edit('25.')
    edit('25.5')
    assert.equal(saveButton().props.disabled, false, 'fractional thresholds can be saved')
    edit('25.5,')
    assert.equal(saveButton().props.disabled, true, 'a final comma is not a complete list')
    edit('25.5,50')
    await saveButton().props.onClick()
    tree = app.rerender()
    assert.deepEqual(written, [[25.5, 50]])
    for (const invalid of ['25.555', '0', '100.01', '25.5,25.50']) {
      edit(invalid)
      assert.equal(saveButton().props.disabled, true, 'invalid threshold must disable save: ' + invalid)
      await saveButton().props.onClick()
      assert.equal(written.length, 1, 'invalid water policy must not reach the write handler')
    }
    edit('')
    await saveButton().props.onClick()
    assert.deepEqual(written, [[25.5, 50], []], 'blank saves an explicit empty threshold array')
  }
  await assert.rejects(verifyWater(replaceOnce(policySource, 'Math.round(pct * 100) / 100 !== pct', '!Number.isInteger(pct)')), /fractional thresholds can be saved/)
  await assert.rejects(verifyWater(replaceOnce(policySource, ' || Math.round(pct * 100) / 100 !== pct', '')), /invalid threshold must disable save: 25.555/)
  await assert.rejects(verifyWater(replaceOnce(policySource, "waterInput === null ? (triggers.waterPct || []).join(',') : waterInput", "(triggers.waterPct || []).join(',')")), /editing must preserve partial water text/)
  await verifyWater(policySource)
  check(true, '07b incremental water entry preserves decimals and lists; blank saves []; three input and validator mutants are detected')
}

// 8. A partial preview must expose both the status and unit-quota violations.
{
  const violation = { code: 'unit-quotas-not-executed', moduleId: 'events', message: 'Preview does not execute unit quota engines.' }
  const onPreview = () => Promise.resolve({ partial: true, text: 'sample', chars: { total: 6 }, receipt: { status: 'partial', contentTier: 'human_full', sourceTier: 'human_full', retained: [], counts: {}, omitted: [], violations: [violation] } })
  const app = await boot({ snapshot, onPreview })
  let tree = openPage(app, 'Preview & receipt')
  await buttonFor(tree, n => textOf(n).includes('Generate read-only preview')).props.onClick()
  tree = app.rerender()
  const hiddenMutant = JSON.parse(JSON.stringify(tree))
  walk(hiddenMutant, node => { if (node.props && node.props.className === 'i5-policy-violations') node.children = [] })
  let sent = null
  const adapterHarness = componentFrom(policySource, { apiPost: (route, payload) => { sent = { route, payload }; return Promise.resolve({ partial: true, text: 'x', receipt: { violations: [] } }) } })
  const adapterPreview = adapterHarness.createAdapter().onPreview
  await adapterPreview({ policy: snapshot.policy, tier: 'human_full', isHuman: true, isFull: true, extra: 'forbidden' })
  const previewRequestValid = sent.route === '/delivery-preview'
    && Object.keys(sent.payload).every(key => ['policy', 'tier', 'isHuman', 'isFull'].includes(key))
    && !Object.prototype.hasOwnProperty.call(sent.payload, 'extra')
  check(partialWithViolations(tree, 'unit-quotas-not-executed') && !partialWithViolations(hiddenMutant, 'unit-quotas-not-executed'),
    '08 partial:true displays its banner and unit-quota violation; hidden-violations mutant is caught')
  check(previewRequestValid, '08b real preview adapter posts only policy/tier/isHuman/isFull to the P1 route')
}

// 9. Section keys are sourced from /config; missing arrays have a visible fail-closed path.
{
  const app = await boot({ snapshot })
  const tree = openPage(app, 'Compatibility')
  const sectionList = nodes(tree, n => n.props && n.props.className === 'i5-policy-section-registry')[0]
  assert(sectionList)
  assert(PROMPT_SECTION_KEYS_PRE_V1.length === 13 && PROMPT_SECTION_MUST_PRE_V1.length === 2)
  assert(sectionsUseServerOnly(tree, PROMPT_SECTION_KEYS_PRE_V1))
  const missingSnapshot = { ...snapshot, promptSections: null, promptSectionMust: null }
  const missing = await boot({ snapshot: missingSnapshot })
  const fallbackTree = openPage(missing, 'Compatibility')
  const hardcodedMutant = JSON.parse(JSON.stringify(fallbackTree))
  const registry = { type: 'ul', props: { className: 'i5-policy-section-registry' }, children: ['rules-section'] }
  hardcodedMutant.children.push(registry)
  check(sectionsUseServerOnly(tree, PROMPT_SECTION_KEYS_PRE_V1)
    && sectionsUseServerOnly(fallbackTree, null)
    && !sectionsUseServerOnly(hardcodedMutant, null), '09 13/2 section lists come from response; missing fields show explicit fallback, hardcoded-list mutant is caught')
}

// 10. All host slots share the accessible policy component; detail slot rejects other bundles.
{
  const client = read('lib/client.js')
  const surfaces = read('skins/iter5/surfaces.js')
  const slots = ['settings.section', 'settings.plugins.tab', 'plugins.detail.section']
  const sameHost = slots.every(slot => client.includes("slots.inject('" + slot + "'"))
    && slots.every(slot => {
      const at = client.indexOf("slots.inject('" + slot + "'")
      return /return h\(Iter5HostSettings/.test(client.slice(at, at + 900))
    })
    && count(client, 'policySettings: createDeliveryPolicySettingsPre()') >= 1
    && surfaces.includes('policySettings: createDeliveryPolicySettingsPre()')
  const app = await boot({ snapshot })
  const accessible = textOf(policyToggle(app.tree)).includes('Configure policy')
    && visibleNodes(app.tree, n => n.props.role === 'tablist').length === 0
  assert(accessible, 'initial policy card exposes one accessible configuration entry before rendering tabs')
  const modulesTree = openPage(app, 'Modules')
  const nav = nodes(modulesTree, n => n.props.role === 'tablist' && n.props['aria-label'] === 'Delivery policy pages')[0]
  assert(nav)
  const detailAt = client.indexOf("slots.inject('plugins.detail.section'")
  const handler = /function \(props\) \{[\s\S]*?\n            \}\)/.exec(client.slice(detailAt))
  assert(handler, 'plugins.detail.section handler must be extractable for runtime negative path')
  const detailRenderer = new Function('h', 'Iter5HostSettings', 'return (' + handler[0].replace(/\)$/, '') + ')')(
    (type, props) => ({ type, props }), function Iter5HostSettings() { return 'claimed' })
  const ownPackage = detailRenderer({ subject: { kind: 'bundle', pkg: { name: '@a9i5k4/dsh-auto-memory' } } })
  const otherPackage = detailRenderer({ subject: { kind: 'bundle', pkg: { name: 'other-package' } } })
  const mutantHandler = handler[0].replace("subj.pkg.name !== '@a9i5k4/dsh-auto-memory'", "subj.pkg.name === '@a9i5k4/dsh-auto-memory'").replace(/\)$/, '')
  const mutant = new Function('h', 'Iter5HostSettings', 'return (' + mutantHandler + ')')(
    (type, props) => ({ type, props }), function Iter5HostSettings() { return 'claimed' })
  const mutantClaimsOther = mutant({ subject: { kind: 'bundle', pkg: { name: 'other-package' } } }) === 'claimed'
  check(sameHost && accessible && !!nav && ownPackage !== null
    && otherPackage === null && !mutantClaimsOther, '10 three slots share named policy settings; wrong-package detail claim is rejected at runtime')
}

// 11. Diagnostics uses only the existing API.debug metadata projection when its page opens.
{
  const calls = []
  const apiGet = path => {
    calls.push(path)
    return Promise.resolve({ logs: { path: 'local/diagnose.log', sizeText: '2 KB', lines: 12, exists: true, body: 'must not be read' } })
  }
  const app = await boot({ snapshot }, policySource, { apiGet, API: { config: '/config', debug: '/debug', deliveryPreview: '/delivery-preview' } })
  assert.deepEqual(calls, [])
  let tree = openPage(app, 'Diagnostics')
  await Promise.resolve()
  tree = app.rerender()
  assert.deepEqual(calls, ['/debug'])
  assert(textOf(tree).includes('local/diagnose.log') && textOf(tree).includes('2 KB') && textOf(tree).includes('12'))
  assert(!textOf(tree).includes('must not be read'))
  check(calls.length === 1 && calls[0] === '/debug' && textOf(tree).includes('local/diagnose.log')
    && !textOf(tree).includes('must not be read'), '11 diagnostics reads only API.debug metadata on demand; log body is not rendered')
}

function replaceOnce(source, from, to) {
  assert.equal(count(source, from), 1, 'mutation/exposure anchor must match once: ' + from.slice(0, 100))
  return source.replace(from, () => to)
}

// Render the shipped factory under a minimal host and record its actual config POST.
function legacyHost(client, frozen, initialConfig) {
  const h = renderHarness().h
  const parentHooks = new Map()
  const editorHooks = new Map()
  let activeHooks
  function hooksFor(mounts, name) {
    if (!mounts.has(name)) mounts.set(name, renderHarness())
    return mounts.get(name)
  }
  const React = {
    Fragment: Symbol('Fragment'), Component: function Component() {}, createElement: h,
    cloneElement(node, props) { return { ...node, props: { ...node.props, ...props } } },
    useState: (...args) => activeHooks.useState(...args),
    useRef: (...args) => activeHooks.useRef(...args),
    useEffect: (...args) => activeHooks.useEffect(...args),
    useReducer(reducer, initial) {
      const [value, set] = activeHooks.useState(initial)
      return [value, action => set(previous => reducer(previous, action))]
    },
  }
  const values = new Map()
  const localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    get length() { return values.size },
  }
  const document = {
    documentElement: { getAttribute: () => '', style: { setProperty() {} }, classList: { contains: () => false } },
    querySelector: () => null, getElementById: () => null, addEventListener() {}, removeEventListener() {},
  }
  let exposed
  const legacySetKeys = []
  const window = {
    localStorage, addEventListener() {}, removeEventListener() {}, confirm: () => true,
    setTimeout, clearTimeout, __ModuleLoader__: { load(def) {
      exposed = def.factory(name => { if (name === 'react') return React; throw new Error('Unexpected module: ' + name) }).__deliveryGuard
    } },
  }
  const sandbox = vm.createContext({ window, document, localStorage, navigator: { language: 'en-US' },
    console: { log() {}, warn() {}, info() {}, error() {} }, URL, URLSearchParams, AbortController,
    requestAnimationFrame: fn => fn(), setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    fetch: () => { throw new Error('Unexpected raw fetch') },
    recordLegacySet: key => legacySetKeys.push(key),
  })
  const traceSet = source => source.replaceAll('function set(key, value) {', 'function set(key, value) { recordLegacySet(key);')
  const legacyReturn = 'return { page: Iter5Page, css: ITER5_CSS + LEGACY_OVERLAY_EXTRA }'
  const injectable = replaceOnce(client, legacyReturn,
    'return { page: Iter5Page, css: ITER5_CSS + LEGACY_OVERLAY_EXTRA, settings: Iter5Settings, tabs: Iter5Tabs }')
  vm.runInContext(replaceOnce(traceSet(injectable), '    return module.exports\n', `
    const frozenGuard = (function () {
${traceSet(frozen)}
      return { settings: Iter5Settings, tabs: Iter5Tabs }
    })()
    exports.__deliveryGuard = {
      faces: {
        classic: { settings: SettingsPage }, v4: { settings: Iter5Settings, tabs: Iter5Tabs },
        embedded: LEGACY_SKIN_NS, frozen: frozenGuard,
      },
      makePolicySettings: createDeliveryPolicySettingsPre,
      policyTabs: Iter5Tabs,
      managedKeys: typeof ITER5_POLICY_MANAGED_LEGACY_KEYS === 'undefined' ? [] : ITER5_POLICY_MANAGED_LEGACY_KEYS,
      settingsSheet: damSharedSurfaceCss,
      setLocale: applyLocalePref,
      emit: emit,
      config: API.config,
      transport: function (get, post) { apiGet = get; apiPost = post },
    }
    return module.exports
`), sandbox, { filename: 'delivery-settings-client.vm.js' })
  let config = { locale: 'en', ...initialConfig }
  exposed.setLocale(config.locale)
  const posts = []
  const managedKeys = Array.from(exposed.managedKeys)
  const envelope = () => ({ config: structuredClone(config), deliveryPolicy: legacyToPolicy(config),
    deliveryPolicyCapabilities: { schemaVersion: 2, presets: PRESETS, modules: MODULE_REGISTRY, previewPartial: true },
    promptSections: PROMPT_SECTION_KEYS_PRE_V1, promptSectionMust: PROMPT_SECTION_MUST_PRE_V1 })
  let delayedReads = null
  const delayedWrites = []
  function delay() {
    let release, reject
    const pending = new Promise((resolve, fail) => { release = resolve; reject = fail })
    return { pending, release, reject }
  }
  function applyPatch(patch) {
    config = { ...config, ...patch }
    if (patch.deliveryPolicy === null) delete config.deliveryPolicy
  }
  exposed.transport(async url => {
    if (url !== exposed.config) return {}
    const snapshot = envelope()
    if (delayedReads) {
      const held = delayedReads
      held.count += 1
      await held.pending
    }
    return snapshot
  }, async (url, patch) => {
    assert.equal(url, exposed.config)
    const submitted = structuredClone(patch)
    posts.push(submitted)
    const held = delayedWrites.shift()
    if (held) await held.pending
    applyPatch(submitted)
    return { config: structuredClone(config) }
  })
  function render(face) {
    activeHooks = hooksFor(parentHooks, face)
    activeHooks.begin()
    const tree = exposed.faces[face].settings({ intent: { group: 'memory' }, policySettings: exposed.makePolicySettings() })
    activeHooks.flushEffects()
    return tree
  }
  function renderPolicy(tree, instance = 'single') {
    const mount = nodes(tree, node => Object.hasOwn(node.props, 'data-dam-policy-mountpoint'))[0]
    const child = mount?.children[0]
    assert(child && typeof child.type === 'function', 'the real settings face mounts the shared policy component')
    const previous = activeHooks
    const childHooks = hooksFor(editorHooks, instance)
    activeHooks = childHooks
    childHooks.begin()
    let content
    try {
      content = child.type(child.props)
      childHooks.flushEffects()
    } finally {
      activeHooks = previous
    }
    return expandTabs(content)
  }
  function expandTabs(node) {
    if (Array.isArray(node)) return node.map(expandTabs)
    if (!node || typeof node !== 'object') return node
    if (node.type === exposed.policyTabs) return exposed.policyTabs(node.props)
    return { ...node, children: expandTabs(node.children) }
  }
  return {
    posts,
    legacySetKeys,
    managedKeys,
    config: () => structuredClone(config),
    refresh: exposed.emit,
    renderPolicy,
    pauseReads() {
      assert(!delayedReads, 'only one config read batch may be held')
      const held = { ...delay(), count: 0 }
      delayedReads = held
      return { count: () => held.count, allowNext() { delayedReads = null }, release: held.release }
    },
    pauseWrite() {
      const held = delay()
      delayedWrites.push(held)
      return held
    },
    settingsSheet(skin, variant) {
      if (skin) localStorage.setItem('dam-skin', skin)
      else localStorage.removeItem('dam-skin')
      if (variant) localStorage.setItem('dam-skin-style', variant)
      else localStorage.removeItem('dam-skin-style')
      return exposed.settingsSheet()
    },
    async mount(face) {
      render(face)
      await new Promise(resolve => setImmediate(resolve))
      return render(face)
    },
    render,
    selectGroup(face, tree, group) {
      const tabs = exposed.faces[face].tabs
      if (!tabs) return tree
      const tabSet = nodes(tree, node => node.type === tabs)[0]
      const tab = buttonFor(tabs(tabSet.props), node => node.props.id === tabSet.props.id + '-tab-' + group)
      assert(tab, face + ': settings group ' + group + ' is selectable')
      tab.props.onClick()
      return render(face)
    },
    async save(tree) {
      const before = posts.length
      legacySaveButton(tree).props.onClick()
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(posts.length, before + 1, 'legacy Save issues one config POST')
      return posts[before]
    },
  }
}

function legacySaveButton(tree) {
  const saveBar = nodes(tree, node => Object.hasOwn(node.props, 'data-dam-savebar'))[0]
  const button = buttonFor(saveBar, node => node.props['data-dirty'] === 'true')
  assert(button && button.props.disabled !== true, 'legacy Save is enabled after the edit')
  return button
}

const legacyEdits = {
  injectEnabled: true, injectBudgetChars: '9001', tier0CatalogEnabled: false, tier0MaxTokens: '625',
  tier0BudgetShare: '0.35', injectExcludeSources: 'fixture-log\n  fixture-note  ', recentDaysInjected: '4',
  snapshotMinGapRounds: '37', slimEveryRounds: '14', fullInjectWaterPct: '25,50', fullInjectSemanticChars: '925',
  snapshotReinjectOnCompact: false, snapshotTieredInject: false, handoffEnabled: false, handoffLedgerChars: '950',
}
const legacySettingsSignature = 'function Iter5Settings(props) {'
const storageSignature = 'function Iter5Storage(props) {'
const embeddedLegacy = extractBetween(clientSource, '    // ===== ITER5-LEGACY-GENERATED:BEGIN =====', '    // ===== ITER5-LEGACY-GENERATED:END =====')
const legacyFaces = {
  classic: classicSettingsSource,
  v4: extractBetween(generatedV4(clientSource), legacySettingsSignature, storageSignature),
  frozen: extractBetween(frozenSource, legacySettingsSignature, storageSignature),
  embedded: extractBetween(embeddedLegacy, legacySettingsSignature, storageSignature),
}
function editFace(face, change) {
  const original = legacyFaces[face]
  assert(original, 'missing settings body for ' + face)
  const revised = change(original)
  return face === 'frozen' ? [clientSource, replaceOnce(frozenSource, original, revised)]
    : [replaceOnce(clientSource, original, revised), frozenSource]
}
function visibleControls(tree, key) {
  if (Array.isArray(tree)) return tree.flatMap(child => visibleControls(child, key))
  if (!tree || typeof tree !== 'object' || tree.props.hidden === true) return []
  const control = ['input', 'textarea', 'select'].includes(tree.type)
    && typeof tree.props.onChange === 'function' && String(tree.props.onChange).includes("set('" + key + "'")
  return control ? [tree] : visibleControls(tree.children, key)
}
function editableControl(tree, key) {
  return visibleControls(tree, key).find(control => control.props.disabled !== true && control.props.readOnly !== true
    && control.props['aria-disabled'] !== true && control.props['aria-disabled'] !== 'true')
}

// 12. The 15 effective legacy controls still save while live delivery uses them.
{
  async function verifyLegacyEdits(face, host) {
    let tree = await host.mount(face)
    const expected = {}
    for (const group of ['memory', 'behavior', 'appearance']) {
      tree = host.selectGroup(face, tree, group)
      for (const [key, input] of Object.entries(legacyEdits)) {
        if (Object.hasOwn(expected, key)) continue
        const control = editableControl(tree, key)
        if (!control) continue
        assert.equal(control.props.type === 'checkbox', typeof input === 'boolean', face + ': control type ' + key)
        const target = typeof input === 'boolean' ? { checked: input } : { value: input }
        control.props.onChange({ target })
        expected[key] = key === 'injectExcludeSources' ? ['fixture-log', 'fixture-note'] : control.props.type === 'number' ? Number(input) : input
        tree = host.render(face)
      }
    }
    assert.deepEqual(Object.keys(legacyEdits).filter(key => !Object.hasOwn(expected, key)), [], face + ': missing editable controls')
    assert.deepEqual(JSON.parse(JSON.stringify(await host.save(tree))), expected, face + ': config POST must contain all 15 effective edits and no historical keys')
  }
  for (const face of Object.keys(legacyFaces)) {
    const disabled = "field(t('fInject'), h('input', { type: 'checkbox',"
    const edited = editFace(face, source => replaceOnce(source, disabled, disabled + ' disabled: true,'))
    await assert.rejects(verifyLegacyEdits(face, legacyHost(...edited)), error => {
      assert.match(error.message, new RegExp(face + ': missing editable controls'))
      assert.deepEqual(error.actual, ['injectEnabled'], 'the mutant breaks only the disabled control')
      return true
    })
    await verifyLegacyEdits(face, legacyHost(clientSource, frozenSource))
  }
  check(true, '12 each settings body writes 15 effective legacy keys via its real Save; disabling a control makes the same guard fail on each face')
}

// F5. Keep saved historical values visible without an input or a save path.
{
  const defaults = { externalInjectionChars: 1400, handoffPlanChars: 1200 }
  const saved = { externalInjectionChars: 1633, handoffPlanChars: 0 }
  async function verifyHistoricalValues(face, host, values, label = 'Currently ineffective (historical key)') {
    let tree = await host.mount(face)
    const seen = new Set()
    for (const group of ['memory', 'behavior']) {
      tree = host.selectGroup(face, tree, group)
      for (const [key, value] of Object.entries(values)) {
        assert(!editableControl(tree, key), face + ': historical key is editable: ' + key)
        const rows = visibleNodes(tree, node => Object.hasOwn(node.props, 'data-dam-settings-row'))
          .filter(row => nodes(row, node => node.props['data-dam-legacy-readonly'] === key).length > 0)
        if (!rows.length || seen.has(key)) continue
        assert.equal(rows.length, 1, face + ': one historical row for ' + key)
        const [readout] = nodes(rows[0], node => node.props['data-dam-legacy-readonly'] === key)
        assert.equal(textOf(readout), String(value), face + ': retained value for ' + key)
        assert(textOf(rows[0]).includes(label), face + ': missing historical label for ' + key)
        assert.equal(nodes(rows[0], node => ['input', 'select', 'textarea', 'button'].includes(node.type)
          || [true, '', 'true', 'plaintext-only'].includes(node.props.contentEditable)).length, 0, face + ': historical row is not static: ' + key)
        seen.add(key)
      }
    }
    assert.deepEqual([...seen].sort(), Object.keys(values).sort(), face + ': both historical values remain visible')
    assert.equal(host.posts.length, 0, face + ': reading historical values never writes config')
  }
  for (const face of Object.keys(legacyFaces)) {
    await verifyHistoricalValues(face, legacyHost(clientSource, frozenSource, saved), saved)
    for (const [key, fallback] of Object.entries(defaults)) {
      const [client, frozen] = editFace(face, source => replaceOnce(source,
        `h('span', { 'data-dam-legacy-readonly': '${key}' }, String(cfg.${key} === undefined ? ${fallback} : cfg.${key}))`,
        `h('input', { 'data-dam-legacy-readonly': '${key}', type: 'number', value: cfg.${key}, onChange: function (e) { set('${key}', Number(e.target.value)) } })`))
      await assert.rejects(verifyHistoricalValues(face, legacyHost(client, frozen, saved), saved),
        new RegExp(face + ': historical key is editable: ' + key))
    }
    await verifyHistoricalValues(face, legacyHost(clientSource, frozenSource, { locale: 'zh' }), defaults, '当前无效（历史键）')
  }
  check(true, 'F5 both historical keys render saved values (including zero) or defaults as text; restoring either input makes each face fail')
}

// 13. Keep live and preview-only scope distinct in both languages, including save and rollback.
{
  const locales = [
    { locale: 'en', old: 'live delivery uses the original settings', active: 'The saved policy controls connected settings.',
      saved: 'Policy saved.', save: 'Save policy', remove: 'Remove policy and roll back to legacy adapter',
      preview: 'Preview only; live trigger behavior is unchanged.', savedLimits: 'Modules, representation and count quotas remain preview only.',
      pages: [
        ['preset', 'Presets & cadence', 'dynamic delivery switch and slim/full intervals', 'special-tier mappings are preview only'],
        ['modules', 'Modules', 'module switches, views, unit representation and count quotas do not control live delivery'],
        ['budget', 'Budget & overflow', 'whole-frame hard ceilings and soft budgets', 'Module budgets and unit representation are preview only'],
        ['triggers', 'Triggers', 'water thresholds, tiered cadence and unattended compensation', 'Human, compaction, first-frame and handoff options are preview only'],
        ['diagnostics', 'Diagnostics', 'diagnostic digest switch, time window and line limit'],
        ['preview', 'Preview & receipt', 'Read-only preview and receipt'],
        ['compatibility', 'Compatibility', 'restores the original settings for connected fields'],
      ] },
    { locale: 'zh', old: '真实投递仍使用原设置', active: '已保存的策略控制已接入项。',
      saved: '策略已保存。', save: '保存策略', remove: '删除策略并回滚到旧键适配',
      preview: '仅供预览；真实触发保持原行为。', savedLimits: '模块、表示与数量配额仍仅供预览。',
      pages: [
        ['preset', '预设与节奏', '动态投递总开关、精简与完整帧间隔', '特殊档映射仅供预览'],
        ['modules', '模块', '模块开关、视图、单元表示和数量配额尚未接入真实投递'],
        ['budget', '预算与超额', '整帧硬顶与软预算', '模块级预算和单元表示仅供预览'],
        ['triggers', '触发', '水位、分层节奏和挂机补偿', '真人、压缩、首帧及交接选项仅供预览'],
        ['diagnostics', '诊断', '诊断摘要开关、时间范围与条数'],
        ['preview', '预览与回执', '只读预览与回执'],
        ['compatibility', '兼容', '已接入项恢复使用原设置'],
      ] },
  ]
  async function verifyScope(source, fixture) {
    const writes = []
    let resolveWrite
    const app = await boot({ snapshot, onSave: policy => {
      writes.push(policy)
      return new Promise(resolve => { resolveWrite = resolve })
    } }, source, { locale: fixture.locale, L: (zh, en) => fixture.locale === 'zh' ? zh : en })
    let tree = openEditor(app)
    function expectScope(parent, location, ...text) {
      const banners = visibleNodes(parent, node => node.props['data-dam-policy-scope'] === location)
      assert(banners.length === 1 && text.every(part => textOf(banners[0]).includes(part)), fixture.locale + ': missing ' + location + ' scope warning')
    }
    expectScope(tree, 'header', fixture.old)
    for (const [page, label, ...text] of fixture.pages) {
      tree = switchPage(app, tree, label)
      expectScope(visibleNodes(tree, node => node.props.role === 'tabpanel')[0], page, ...text)
    }
    tree = switchPage(app, tree, fixture.pages.find(([page]) => page === 'triggers')[1])
    for (const name of ['human', 'postCompact', 'firstFrame', 'handoff']) {
      const row = nodes(tree, node => Object.hasOwn(node.props, 'data-dam-settings-row') && nodes(node, child => child.props.id?.endsWith('-triggers-' + name)).length > 0)[0]
      assert(row && textOf(row).includes(fixture.preview), 'missing preview-only field warning: ' + name)
    }
    const water = policyInput(tree, 'triggers-waterPct')
    assert(water, 'trigger edit control is rendered')
    water.props.onChange({ target: { value: '25,50' } })
    tree = app.rerender()
    const save = buttonFor(tree, node => textOf(node).trim() === fixture.save)
    assert(save && save.props.disabled !== true, 'policy save is enabled after changing triggers')
    const saving = save.props.onClick()
    expectScope(app.rerender(), 'header', fixture.old)
    resolveWrite({ ok: true })
    await saving
    tree = app.rerender()
    assert.equal(writes.length, 1, 'save must run before testing the success message')
    assert.deepEqual(writes[0].triggers.waterPct, [25, 50])
    expectScope(tree, 'header', fixture.active)
    const receipt = nodes(tree, node => node.props.role === 'status' && node.props.className === 'i5-policy-notice')[0]
    assert(receipt && textOf(receipt).includes(fixture.saved + ' ' + fixture.active + ' ' + fixture.savedLimits), fixture.locale + ': missing save-success scope warning')
    tree = switchPage(app, tree, fixture.pages.find(([page]) => page === 'compatibility')[1])
    const remove = buttonFor(tree, node => textOf(node).trim() === fixture.remove)
    assert(remove, 'rollback must be visible after the first successful save')
    const removing = remove.props.onClick()
    assert.equal(writes[1], null, 'rollback uses the backend removal marker')
    expectScope(app.rerender(), 'header', fixture.active)
    resolveWrite({ ok: true })
    await removing
    tree = app.rerender()
    expectScope(tree, 'header', fixture.old)
    assert(!buttonFor(tree, node => textOf(node).trim() === fixture.remove), 'successful rollback hides the remove action')
  }
  const noHeader = replaceOnce(policySource, "renderPolicyScope('header')", 'null')
  const noSaveScope = replaceOnce(policySource, " + ' ' + activePolicyText + ' ' + L('模块、表示与数量配额仍仅供预览。', 'Modules, representation and count quotas remain preview only.')", '')
  const savedSnapshot = /setSnapshot\(function \(current\) \{ return current && Object\.assign\(\{\}, current, \{ persistedPolicy: (\w+) \}\) \}\)/.exec(policySource)
  assert(savedSnapshot, 'saved strategy publishes the confirmed stored state')
  const noTransition = replaceOnce(policySource, savedSnapshot[0], 'void ' + savedSnapshot[1])
  const noCompactionHint = replaceOnce(policySource, 'next.triggers.postCompact = event.target.value })\n        }), previewTrigger, false)', 'next.triggers.postCompact = event.target.value })\n        }), null, false)')
  for (const fixture of locales) {
    await assert.rejects(verifyScope(noHeader, fixture), /missing header scope warning/)
    for (const [page] of fixture.pages) {
      const missing = replaceOnce(policySource, 'renderPolicyScope(page),', `(page === '${page}' ? null : renderPolicyScope(page)),`)
      await assert.rejects(verifyScope(missing, fixture), new RegExp('missing ' + page + ' scope warning'))
    }
    await assert.rejects(verifyScope(noSaveScope, fixture), /missing save-success scope warning/)
    await assert.rejects(verifyScope(noTransition, fixture), /missing header scope warning/)
    await assert.rejects(verifyScope(noCompactionHint, fixture), /missing preview-only field warning: postCompact/)
    await verifyScope(policySource, fixture)
  }
  async function verifyRollbackReload(source) {
    let persisted = JSON.parse(JSON.stringify(snapshot.policy))
    persisted.triggers.waterPct = [50]
    const app = await boot({ onSave: async policy => { persisted = policy } }, source, { apiGet: async () => {
      const config = { ...snapshot.config, deliveryPolicy: persisted }
      if (persisted === null) delete config.deliveryPolicy
      return { ...snapshot, policy: persisted || snapshot.policy, config }
    } })
    let tree = switchPage(app, openEditor(app, app.rerender()), 'Triggers')
    assert.equal(policyInput(tree, 'triggers-waterPct').props.value, '50')
    policyInput(tree, 'triggers-waterPct').props.onChange({ target: { value: '35' } })
    tree = switchPage(app, app.rerender(), 'Compatibility')
    const remove = buttonFor(tree, node => textOf(node).trim() === 'Remove policy and roll back to legacy adapter')
    await remove.props.onClick()
    tree = switchPage(app, app.rerender(), 'Triggers')
    assert.equal(policyInput(tree, 'triggers-waterPct')?.props.value, '25', 'rollback must reload the legacy draft even when local edits were dirty')
  }
  const noDraftReset = replaceOnce(policySource, '      dirtyRef.current = false\n', '')
  await assert.rejects(verifyRollbackReload(noDraftReset), /rollback must reload the legacy draft/)
  await verifyRollbackReload(policySource)
  check(true, '13 both languages show seven scoped pages, preview-only triggers, save activation and rollback; scope and dirty-rollback mutants are detected')
}

// 14. Test the real displayed fallback, then clear both cadence inputs and inspect their posted values.
{
  const fallbackByKey = { snapshotMinGapRounds: [40, 20], slimEveryRounds: [15, 8] }
  const defaults = Object.fromEntries(Object.entries(fallbackByKey).map(([key, [fallback]]) => [key, fallback]))
  async function verifyCadence(face, host) {
    let tree = await host.mount(face)
    for (const [key, fallback] of Object.entries(defaults)) {
      const control = editableControl(tree, key)
      assert(control, face + ': cadence editor ' + key + ' is available')
      assert.equal(control.props.value, fallback, face + ': displayed cadence fallback ' + key)
      control.props.onChange({ target: { value: '' } })
      tree = host.render(face)
    }
    assert.deepEqual(JSON.parse(JSON.stringify(await host.save(tree))), defaults, face + ': posted cadence fallback')
  }
  for (const face of Object.keys(legacyFaces)) {
    for (const [key, [fallback, old]] of Object.entries(fallbackByKey)) {
      const display = editFace(face, source => replaceOnce(source,
        `cfg.${key} === undefined ? ${fallback} : cfg.${key}`, `cfg.${key} === undefined ? ${old} : cfg.${key}`))
      const handler = editFace(face, source => replaceOnce(source,
        `set('${key}', normalizeGapRounds(e.target.value, ${fallback}))`, `set('${key}', normalizeGapRounds(e.target.value, ${old}))`))
      await assert.rejects(verifyCadence(face, legacyHost(...display)), new RegExp('displayed cadence fallback ' + key))
      await assert.rejects(verifyCadence(face, legacyHost(...handler)), /posted cadence fallback/)
    }
    await verifyCadence(face, legacyHost(clientSource, frozenSource))
    const explicit = await legacyHost(clientSource, frozenSource, { snapshotMinGapRounds: 0, slimEveryRounds: 1 }).mount(face)
    assert.equal(editableControl(explicit, 'snapshotMinGapRounds')?.props.value, 0, face + ': configured full gap stays 0')
    assert.equal(editableControl(explicit, 'slimEveryRounds')?.props.value, 1, face + ': configured slim interval stays 1')
  }
  check(true, '14 cadence controls display and POST 40/15; mutating either path back to 20/8 is detected on each face')
}

// 15. Mount the policy section next to continuation, with the same native grouping in every shipped face.
{
  const isMount = node => Object.hasOwn(node.props, 'data-dam-policy-mountpoint')
  const isPolicySection = node => Object.hasOwn(node.props, 'data-dam-settings-group') && node.props.id?.endsWith('-policy')
  function checkPolicySection(face, tree) {
    const content = nodes(tree, node => Object.hasOwn(node.props, 'data-dam-settings-content'))[0]
    const sections = (content?.children || []).filter(node => node && Object.hasOwn(node.props || {}, 'data-dam-settings-group'))
    const policyIndex = sections.findIndex(isPolicySection)
    const nextSection = sections[policyIndex + 1]
    assert(policyIndex >= 0 && nextSection?.props.id?.endsWith('-handoff'), face + ': policy section is in the settings content immediately before continuation')
    const [mount] = nodes(sections[policyIndex], isMount)
    assert(mount && nodes(tree, isMount).length === 1, face + ': one policy mount lives inside its section')
    assert.equal(mount.children.length, 1, face + ': slot forwards the policy component')
    return mount.children[0]
  }
  async function verifyGrouping(face, host) {
    let tree = await host.mount(face)
    const policy = checkPolicySection(face, tree)
    if (face === 'classic') return
    for (const group of ['behavior', 'engine', 'memory', 'appearance', 'behavior']) {
      tree = host.selectGroup(face, tree, group)
      const next = checkPolicySection(face, tree)
      assert.equal(next.type, policy.type, face + ': group switch preserves the policy component type')
      assert.equal(next.props.key, policy.props.key, face + ': group switch preserves the policy component key')
      assert.equal(visibleNodes(tree, isMount).length, Number(group === 'behavior'), face + ': policy visibility in ' + group)
      if (group === 'behavior') {
        assert.equal(visibleNodes(tree, node => Object.hasOwn(node.props, 'data-dam-settings-group'))[0].props.id.endsWith('-policy'), true,
          face + ': policy is the first Behavior & maintenance section')
      }
    }
  }
  for (const face of Object.keys(legacyFaces)) {
    if (face !== 'classic') {
      const [mutantClient, mutantFrozen] = editFace(face, source => {
        const groups = /var i5GroupsDef = \{ engine: \['engine'\],.*behavior: \[[^\]]*\] \}/.exec(source)?.[0]
        assert(groups && groups.includes("behavior: ['policy',"), 'policy group mutation must match the actual mapping')
        return replaceOnce(source, groups, groups.replace("engine: ['engine']", "engine: ['engine', 'policy']").replace("behavior: ['policy',", 'behavior: ['))
      })
      await assert.rejects(verifyGrouping(face, legacyHost(mutantClient, mutantFrozen)), /policy visibility in behavior/)
    }
    await verifyGrouping(face, legacyHost(clientSource, frozenSource))
  }
  check(true, '15 native settings keep the single policy mount in Behavior & maintenance; a wrong-group mutant is detected')
}

// 16. The overview is one disclosure and the expanded editor is a native seven-tab group.
{
  const labels = ['Presets & cadence', 'Modules', 'Budget & overflow', 'Triggers', 'Diagnostics', 'Preview & receipt', 'Compatibility']
  function assertCollapsed(tree) {
    const visibleButtons = visibleNodes(tree, node => node.type === 'button')
    assert.equal(visibleButtons.length, 1, 'collapsed policy card exposes one action')
    assert.equal(visibleButtons[0], policyToggle(tree), 'collapsed action is the policy disclosure')
    assert.equal(visibleButtons[0].props['aria-expanded'], false, 'collapsed policy disclosure is announced correctly')
    assert.equal(visibleNodes(tree, node => node.props.role === 'tablist').length, 0, 'collapsed policy card must not show the tabs')
  }
  const app = await boot({ snapshot, onSave: async () => assert.fail('collapsing the editor must not save its draft') })
  assertCollapsed(app.tree)
  const extraButton = { type: 'button', props: { type: 'button' }, children: ['Open modules'] }
  assert.throws(() => assertCollapsed([app.tree, extraButton]), /collapsed policy card exposes one action/)
  let tree = openEditor(app)
  const [nativeTabs] = visibleNodes(tree, node => node.props.role === 'tablist')
  assert(nativeTabs && nativeTabs.props.className === 'i5-tabs', 'policy editor uses the same tab renderer as settings')
  const tabs = visibleNodes(nativeTabs, node => node.props.role === 'tab')
  assert.deepEqual(tabs.map(tab => textOf(tab).trim()), labels)
  assert.equal(tabs[0].props['aria-selected'], true, 'first tab is selected when opening the editor')
  const panel = visibleNodes(tree, node => node.props.role === 'tabpanel')[0]
  assert(panel && tabs.every(tab => tab.props['aria-controls'] === panel.props.id) && panel.props['aria-labelledby'] === tabs[0].props.id)
  assert(visibleNodes(tree, node => node.props.id === policyToggle(tree).props['aria-controls']).length === 1, 'disclosure points to the editor')
  tree = switchPage(app, tree, 'Triggers')
  policyInput(tree, 'triggers-waterPct').props.onChange({ target: { value: '25,50' } })
  tree = app.rerender()
  policyToggle(tree).props.onClick()
  tree = app.rerender()
  assertCollapsed(tree)
  tree = switchPage(app, openEditor(app, tree), 'Triggers')
  assert.equal(policyInput(tree, 'triggers-waterPct').props.value, '25,50', 'draft survives collapse and reopen')
  check(true, '16 collapsed policy has one action; native tabs have valid accessible relationships and preserve the unsaved draft')
}

// 17. The real settings style selector must supply the shared layout on both skin families.
{
  const policySheet = read('skins/iter5/policy-settings.css').trim()
  assert(policySheet.includes('.i5-policy-settings') && policySheet.includes('.i5-policy-entry'), 'shared policy sheet contains component layout')
  function verifySettingsSheet(host) {
    for (const [name, skin, variant] of [
      ['default Frozen'], ['classic', 'classic'], ['variant', 'v4', 'instrument'],
    ]) {
      assert.equal(count(host.settingsSheet(skin, variant), policySheet), 1, name + ' must load the shared policy layout exactly once')
    }
  }
  const overlay = /^    var LEGACY_OVERLAY_EXTRA = (.+)$/m.exec(clientSource)
  assert(overlay, 'generated Frozen overlay sheet is extractable')
  const overlayCss = JSON.parse(overlay[1])
  const omitLegacyOverlay = replaceOnce(clientSource, overlay[0], '    var LEGACY_OVERLAY_EXTRA = '
    + JSON.stringify(replaceOnce(overlayCss, policySheet, '')))
  assert.throws(() => verifySettingsSheet(legacyHost(omitLegacyOverlay, frozenSource)), /default Frozen must load the shared policy layout/)
  verifySettingsSheet(legacyHost(clientSource, frozenSource))
  check(true, '17 the selected default Frozen, classic and variant stylesheets all include the shared policy layout; omitting it from Frozen is detected')
}

// Extract the old-key fallbacks paired with saved policy reads in the actual dynamic callback.
// The water fallback takes a local alias, so trace the alias to its config property first.
function backendManagedKeys(index) {
  const source = extractBetween(index, '  const disposeContext = ctx.systemPrompt.context({', '  const disposeSection = ctx.systemPrompt.section({')
    .replace(/^\s*\/\/.*$/gm, '')
  assert(source, 'production dynamic callback must be extractable')
  const pairs = new Map()
  for (const [, field, key] of source.matchAll(/_(?:deliveryTriggers|stepTriggers)Pre\?\.(\w+)\s*\?\?\s*(?:\(Number\(|parseGapRoundsPre\()?\s*(?:engine\.config|_cfgNow)\.(\w+)/g)) {
    if (pairs.has(field)) assert.equal(pairs.get(field), key, field + ': all real reads use the same legacy fallback')
    pairs.set(field, key)
  }
  const alias = /_stepTriggersPre\?\.waterPct\s*\?\?\s*parseWaterPctThresholdsPre\((\w+)\)/.exec(source)?.[1]
  const waterKey = new RegExp('const ' + alias + ' = engine\\.config \\? engine\\.config\\.(\\w+) : undefined').exec(source)?.[1]
  assert(waterKey, 'water threshold has a saved read paired with a legacy key')
  pairs.set('waterPct', waterKey)
  assert.deepEqual([...pairs.keys()].sort(), Object.keys(effectiveTriggers({ deliveryPolicy: PRESETS.human_full })).sort(),
    'all saved trigger fields have a concrete production read')
  const total = /_savedPolicyPre\s*\?\s*_savedPolicyPre\.enabled\s*===\s*false\s*:\s*engine\.config\s*&&\s*engine\.config\.(\w+)\s*===\s*false/.exec(source)?.[1]
  assert(total, 'saved master switch bypasses precisely one legacy gate')
  return [total, ...pairs.values()].sort()
}

const a1bKeys = backendManagedKeys(indexSource)
const verifyOwnership = managedKeys => assert.deepEqual([...managedKeys].sort(), a1bKeys, 'frozen keys must equal production takeover')
{
  const decl = /\b(?:var|const|let) ITER5_POLICY_MANAGED_LEGACY_KEYS\s*=\s*(?:Object\.freeze\()?\s*\[[^\]]*\]/.exec(policySource)?.[0]
  assert(decl, 'the shared freeze set is declared in the policy settings source')
  assert.equal(count(clientSource, 'ITER5_POLICY_MANAGED_LEGACY_KEYS ='), 1, 'factory shares one freeze list')
  assert.equal(count(frozenSource, 'ITER5_POLICY_MANAGED_LEGACY_KEYS ='), 0, 'Frozen receives the shared list')
  const loaded = legacyHost(clientSource, frozenSource)
  verifyOwnership(loaded.managedKeys)
  assert.equal(a1bKeys.length, 7)
  const added = replaceOnce(clientSource, decl, decl.replace(/\]$/, ", 'snapshotReinjectOnCompact']").replace(/,\s*,/, ','))
  assert.throws(() => verifyOwnership(legacyHost(added, frozenSource).managedKeys), /frozen keys must equal production takeover/)
  const fewer = replaceOnce(clientSource, decl, decl.replace(/,\s*['"]hangCompensateTokens['"]|['"]hangCompensateTokens['"]\s*,/, ''))
  assert.notEqual(fewer, clientSource, 'omitted-key mutation changes the shared source')
  assert.throws(() => verifyOwnership(legacyHost(fewer, frozenSource).managedKeys), /frozen keys must equal production takeover/)
  const backendMutant = replaceOnce(indexSource, 'engine.config ? engine.config.fullInjectWaterPct : undefined',
    'engine.config ? engine.config.waterLevelThreshold : undefined')
  assert.throws(() => assert.deepEqual(loaded.managedKeys.slice().sort(), backendManagedKeys(backendMutant)), { code: 'ERR_ASSERTION' })
  verifyOwnership(loaded.managedKeys)
  check(true, '18 the shared seven-key freeze set matches real production reads; added, omitted and backend-key drift mutants are detected')
}

const a1bConfig = {
  injectEnabled: true, snapshotMinGapRounds: 37, slimEveryRounds: 14, fullInjectWaterPct: '25,50',
  snapshotTieredInject: false, hangCompensateEnabled: true, hangCompensateTokens: 322222,
  injectBudgetChars: 8000, promptSectionToggles: { 'rules-section': false },
}
const legacyAfterRollback = { injectEnabled: false, snapshotMinGapRounds: 39, slimEveryRounds: 16, fullInjectWaterPct: '25.5',
  snapshotTieredInject: true, hangCompensateEnabled: false, hangCompensateTokens: 330000 }
const flushUi = () => new Promise(resolve => setImmediate(resolve))
const isManagedRow = node => Object.hasOwn(node.props, 'data-dam-policy-legacy-readonly')
const managedGroups = ['memory', 'behavior']

function collectLegacyState(host, face) {
  const editable = new Map(), inputs = new Map(), frozen = new Map(), texts = [], groups = []
  for (const group of face === 'classic' ? ['memory'] : managedGroups) {
    const tree = host.selectGroup(face, host.render(face), group)
    groups.push({ group, tree })
    const rows = visibleNodes(tree, isManagedRow)
    if (rows.length) texts.push(textOf(tree))
    for (const item of rows) {
      const field = item.props['data-dam-policy-legacy-readonly']
      assert(!frozen.has(field), face + ': read-only legacy field repeats: ' + field)
      frozen.set(field, item)
    }
    for (const key of a1bKeys) {
      const controls = visibleControls(tree, key)
      if (controls.length) inputs.set(key, controls)
      const control = editableControl(tree, key)
      if (control) editable.set(key, control)
    }
  }
  return { editable, inputs, frozen, texts, groups }
}

function assertLegacyState(host, face, saved, locale = 'en') {
  const view = collectLegacyState(host, face)
  if (!saved) {
    assert.deepEqual([...view.editable.keys()].sort(), a1bKeys, face + ': all seven legacy keys are editable without saved policy')
    assert.equal(view.frozen.size, 0, face + ': legacy view does not show frozen rows')
  } else {
    assert.deepEqual([...view.frozen.keys()].sort(), a1bKeys, face + ': the saved policy freezes exactly seven legacy rows')
    assert.equal(view.inputs.size, 0, face + ': frozen controls have no legacy input handlers')
    assert(view.texts.every(text => text.includes(locale === 'zh' ? '已由投递策略接管' : 'Controlled by delivery policy')),
      face + ': the read-only state is explained')
    for (const key of Object.keys(legacyEdits).filter(key => !a1bKeys.includes(key))) {
      assert(view.groups.some(({ tree }) => editableControl(tree, key)), face + ': unowned legacy setting remains editable: ' + key)
    }
    for (const key of a1bKeys) {
      const original = a1bConfig[key]
      const expected = typeof original === 'boolean' && locale === 'zh' ? (original ? '开启' : '关闭')
        : typeof original === 'boolean' ? (original ? 'On' : 'Off') : String(original)
      const actual = nodes(view.frozen.get(key), node => node.type === 'strong')[0]
      assert.equal(textOf(actual), expected, face + ': the frozen row shows its original legacy value: ' + key)
    }
  }
  return view
}

function legacyControlIn(host, face, key) {
  for (const group of face === 'classic' ? ['memory'] : managedGroups) {
    const tree = host.selectGroup(face, host.render(face), group)
    const control = editableControl(tree, key)
    if (control) return control
  }
  assert.fail(face + ': legacy control is editable: ' + key)
}

function changeLegacyControl(control, value) {
  const target = typeof value === 'boolean' ? { checked: value } : { value: String(value) }
  control.props.onChange({ target })
}

function goToPolicy(host, face, view, page, label) {
  const origin = view.groups.find(item => buttonFor(item.tree, n => n.props['data-dam-policy-open'] === page))
  assert(origin, face + ': missing navigation action to ' + page)
  const fresh = host.selectGroup(face, host.render(face), origin.group)
  buttonFor(fresh, n => n.props['data-dam-policy-open'] === page).props.onClick()
  let parent = host.render(face)
  assert.equal(visibleNodes(parent, n => Object.hasOwn(n.props, 'data-dam-policy-mountpoint')).length, 1,
    face + ': navigation lands at the visible Behavior policy mount')
  host.renderPolicy(parent)
  parent = host.render(face)
  const editor = host.renderPolicy(parent)
  assert.equal(pageTab(editor, label)?.props['aria-selected'], true, face + ': the actual policy editor opens on ' + page)
  return editor
}

function openSections(host, face) {
  const tree = host.selectGroup(face, host.render(face), 'memory')
  const launch = buttonFor(tree, node => String(node.props.onClick).includes('setPsecOpen('))
  assert(launch, face + ': the section editor has a live entry')
  launch.props.onClick()
  const panel = visibleNodes(host.render(face), n => Object.hasOwn(n.props, 'data-dam-prompt-sections'))[0]
  assert(panel, face + ': the section editor is visible during freeze')
  const toggles = visibleNodes(panel, node => node.type === 'input' && Object.hasOwn(node.props, 'data-dam-pswitch'))
  assert.deepEqual(toggles.map(node => node.props['data-dam-pswitch']), PROMPT_SECTION_KEYS_PRE_V1)
  assert(toggles.every(n => typeof n.props.onChange === 'function' && !n.props.disabled), face + ': every section toggle remains editable')
  assert(buttonFor(panel, node => textOf(node).trim() === 'Restore all'), face + ': section reset is available')
  return toggles
}

async function exerciseFreeze(face, host) {
  const draw = () => host.renderPolicy(host.render(face))
  const react = async () => { draw(); await flushUi(); return draw() }
  await host.mount(face)
  await react()
  assert.equal(host.config().deliveryPolicy, undefined)
  const before = assertLegacyState(host, face, false)
  changeLegacyControl(before.editable.get('snapshotMinGapRounds'), 31)
  legacyControlIn(host, face, 'injectBudgetChars').props.onChange({ target: { value: '9100' } })
  assert.equal(host.posts.length, 0)

  host.selectGroup(face, host.render(face), 'behavior')
  let editor = await react()
  const toggle = policyToggle(editor)
  assert(toggle && toggle.props['aria-expanded'] === false)
  toggle.props.onClick()
  editor = draw()
  policyInput(editor, 'enabled').props.onChange({ target: { checked: false } })
  const save = () => buttonFor(draw(), n => textOf(n).trim() === 'Save policy')
  const failed = host.pauseWrite()
  const failedSave = save().props.onClick()
  await flushUi()
  assertLegacyState(host, face, false)
  failed.reject(new Error('fixture rejected save'))
  assert.equal(await failedSave, false)
  assertLegacyState(host, face, false)

  const heldSave = host.pauseWrite()
  assert.equal(save().props.disabled, false, face + ': retry is available after a failed save')
  const saving = save().props.onClick()
  await flushUi()
  assertLegacyState(host, face, false)
  const obsoleteLegacy = host.pauseReads()
  host.refresh()
  await react()
  assert(obsoleteLegacy.count() > 0, face + ': a real pre-save legacy response is held')
  obsoleteLegacy.allowNext()
  heldSave.release()
  await saving
  await react()
  assert.equal(host.posts.length, 2)
  for (const post of host.posts) assert.deepEqual(Object.keys(post), ['deliveryPolicy'])
  assert.equal(host.config().deliveryPolicy.enabled, false, face + ': disabled saved policy still owns the legacy settings')

  let frozen = assertLegacyState(host, face, true)
  obsoleteLegacy.release()
  await react()
  frozen = assertLegacyState(host, face, true)
  goToPolicy(host, face, frozen, 'preset', 'Presets & cadence')
  // Simulate queued input events using the handlers captured before the server confirmed the policy.
  const setCount = host.legacySetKeys.length
  for (const [key, value] of Object.entries(legacyAfterRollback)) changeLegacyControl(before.editable.get(key), value)
  assert.deepEqual(host.legacySetKeys.slice(setCount), [], face + ': stale handlers must not call set after save')
  const toggles = openSections(host, face)
  toggles.find(n => n.props['data-dam-pswitch'] === 'calendar').props.onChange({ target: { checked: false } })
  const legacyPatch = await host.save(host.render(face))
  assert.deepEqual(legacyPatch, { injectBudgetChars: 9100, promptSectionToggles: { 'rules-section': false, calendar: false } },
    face + ': only still-editable drafts are written by the legacy Save')
  assert.equal(host.config().snapshotMinGapRounds, a1bConfig.snapshotMinGapRounds)

  const pinned = assertLegacyState(host, face, true)
  goToPolicy(host, face, pinned, 'compatibility', 'Compatibility')
  const rollback = () => buttonFor(draw(), n => textOf(n).trim() === 'Remove policy and roll back to legacy adapter')
  assert(rollback(), face + ': real rollback button is visible')
  const failedRemoval = host.pauseWrite()
  const removalFailure = rollback().props.onClick()
  await flushUi()
  failedRemoval.reject(new Error('fixture rejected delete'))
  assert.equal(await removalFailure, false)
  assertLegacyState(host, face, true)
  goToPolicy(host, face, pinned, 'compatibility', 'Compatibility')

  const heldRemoval = host.pauseWrite()
  const removing = rollback().props.onClick()
  await flushUi()
  assertLegacyState(host, face, true)
  const obsoleteSaved = host.pauseReads()
  host.refresh()
  await react()
  assert(obsoleteSaved.count() > 0, face + ': a real pre-delete saved response is held')
  obsoleteSaved.allowNext()
  heldRemoval.release()
  await removing
  await react()
  assert.deepEqual(host.posts.at(-1), { deliveryPolicy: null })
  assert(!Object.hasOwn(host.config(), 'deliveryPolicy'))
  assertLegacyState(host, face, false)
  obsoleteSaved.release()
  await react()
  assertLegacyState(host, face, false)

  assert.equal(legacyControlIn(host, face, 'snapshotMinGapRounds').props.value, a1bConfig.snapshotMinGapRounds,
    face + ': stale managed draft did not revive after rollback')
  for (const [key, value] of Object.entries(legacyAfterRollback)) changeLegacyControl(legacyControlIn(host, face, key), value)
  assert.deepEqual(await host.save(host.render(face)), legacyAfterRollback, face + ': all seven legacy controls can write after rollback')
}

{
  const savedSource = "return !!config && Object.prototype.hasOwnProperty.call(config, 'deliveryPolicy') && config.deliveryPolicy != null"
  const alwaysFrozen = replaceOnce(clientSource, savedSource, 'return !!config')
  await assert.rejects(exerciseFreeze('classic', legacyHost(alwaysFrozen, frozenSource, a1bConfig)),
    /all seven legacy keys are editable without saved policy/)

  const readGate = 'return Promise.resolve(apiGet(API.config)).then(function (data) {\n      if (!alive.current || request !== sequence.current) return null'
  const allowObsolete = replaceOnce(clientSource, readGate, readGate.replace(' || request !== sequence.current', ''))
  await assert.rejects(exerciseFreeze('classic', legacyHost(allowObsolete, frozenSource, a1bConfig)),
    /the saved policy freezes exactly seven legacy rows/)

  const [unguardedClient, unguardedFrozen] = editFace('classic', source => replaceOnce(source,
    "if (!policyOwnsLegacy('snapshotMinGapRounds')) set('snapshotMinGapRounds'", "set('snapshotMinGapRounds'"))
  await assert.rejects(exerciseFreeze('classic', legacyHost(unguardedClient, unguardedFrozen, a1bConfig)),
    /stale handlers must not call set after save/)

  for (const face of Object.keys(legacyFaces)) {
    await exerciseFreeze(face, legacyHost(clientSource, frozenSource, a1bConfig))
    const explicitlySaved = legacyToPolicy({ ...a1bConfig, injectEnabled: false })
    for (const [initial, owns, lang] of [
      [{ ...a1bConfig, deliveryPolicy: null }, false, 'en'],
      [{ ...a1bConfig, deliveryPolicy: explicitlySaved, locale: 'zh' }, true, 'zh'],
    ]) {
      const host = legacyHost(clientSource, frozenSource, initial)
      await host.mount(face)
      host.renderPolicy(host.render(face))
      await flushUi()
      assertLegacyState(host, face, owns, lang)
      assert.equal(host.posts.length, 0)
    }
  }
  check(true, '19 settings faces confirm save/delete, ignore late GETs, protect seven old fields and keep 13 segment toggles editable. Premature freeze, obsolete response and stale handler mutants are detected')
}

// Two mounted settings share the real factory and the server, with separate component state.
async function exerciseOtherEntrySave(face, host, { startLegacySaveBeforePolicy = false } = {}) {
  const writer = face === 'classic' ? 'v4' : 'classic'
  const drawEditor = entry => host.renderPolicy(host.render(entry), entry)
  await host.mount(face)
  drawEditor(face)
  await flushUi()
  const oldEditor = assertLegacyState(host, face, false)
  changeLegacyControl(oldEditor.editable.get('snapshotMinGapRounds'), 38)
  changeLegacyControl(legacyControlIn(host, face, 'injectBudgetChars'), 9101)

  await host.mount(writer)
  host.selectGroup(writer, host.render(writer), 'behavior')
  drawEditor(writer)
  await flushUi()
  policyToggle(drawEditor(writer)).props.onClick()
  policyInput(drawEditor(writer), 'enabled').props.onChange({ target: { checked: false } })
  const savePolicy = buttonFor(drawEditor(writer), node => textOf(node).trim() === 'Save policy')
  assert(savePolicy && !savePolicy.props.disabled, 'policy draft in the other entry is ready to save')
  const commit = host.pauseWrite()
  const saving = savePolicy.props.onClick()
  await flushUi()
  assert.equal(host.posts.length, 1)
  assert.deepEqual(Object.keys(host.posts[0]), ['deliveryPolicy'])

  const obsolete = host.pauseReads()
  if (startLegacySaveBeforePolicy) legacySaveButton(host.render(face)).props.onClick()
  await flushUi()
  if (startLegacySaveBeforePolicy) assert.equal(obsolete.count(), 1, 'Classic preflight read is held before policy save')
  host.refresh()
  await flushUi()
  assert(obsolete.count() >= 2, 'both mounted editors have pending readbacks of the old config')
  obsolete.allowNext()

  const fresh = host.pauseReads()
  try {
    commit.release()
    assert.equal(await saving, true)
    await flushUi()
    assert(fresh.count() >= 2, 'new readbacks are still pending in both mounted editors')
    assert.equal(host.config().deliveryPolicy.enabled, false)

    const assertFrozenBeforeGet = () => {
      const view = collectLegacyState(host, face)
      assert.deepEqual([...view.frozen.keys()].sort(), a1bKeys, face + ': confirmed sibling save must freeze before the new GET returns')
      assert.equal(view.inputs.size, 0)
    }
    assertFrozenBeforeGet()
    const oldSetCount = host.legacySetKeys.length
    for (const [key, value] of Object.entries(legacyAfterRollback)) changeLegacyControl(oldEditor.editable.get(key), value)
    assert.deepEqual(host.legacySetKeys.slice(oldSetCount), [], face + ': old handlers in the sibling entry must not call set')

    obsolete.release()
    await flushUi()
    assertFrozenBeforeGet()
    if (startLegacySaveBeforePolicy) {
      assert.deepEqual(host.posts.at(-1), { injectBudgetChars: 9101 }, 'Classic must discard the managed key even if its preflight GET was obsolete')
    } else {
      legacySaveButton(host.render(face)).props.onClick()
    }
    fresh.allowNext()
    fresh.release()
    await flushUi()
    assert.equal(host.posts.length, 2, face + ': the real settings Save submits the surviving unowned draft')
    assert.deepEqual(host.posts[1], { injectBudgetChars: 9101 }, face + ': sibling legacy Save only writes the unowned draft')
    assert.equal(host.config().snapshotMinGapRounds, a1bConfig.snapshotMinGapRounds)
    assert.equal(host.config().injectBudgetChars, 9101)
    assertLegacyState(host, face, true)
  } finally {
    obsolete.release()
    fresh.allowNext()
    fresh.release()
  }
}

async function exerciseOtherEntryRollback(host) {
  const drawEditor = face => host.renderPolicy(host.render(face), face)
  for (const face of ['classic', 'v4']) {
    await host.mount(face)
    drawEditor(face)
    await flushUi()
  }
  assertLegacyState(host, 'classic', true)
  changeLegacyControl(legacyControlIn(host, 'classic', 'injectBudgetChars'), 9101)
  const saveLegacy = legacySaveButton(host.render('classic'))

  host.selectGroup('v4', host.render('v4'), 'behavior')
  policyToggle(drawEditor('v4')).props.onClick()
  pageTab(drawEditor('v4'), 'Compatibility').props.onClick()
  const rollback = buttonFor(drawEditor('v4'), node => textOf(node).trim() === 'Remove policy and roll back to legacy adapter')
  assert(rollback, 'the other entry can delete the saved policy')
  const commit = host.pauseWrite()
  const deleting = rollback.props.onClick()
  await flushUi()
  assert.deepEqual(host.posts, [{ deliveryPolicy: null }])

  const obsolete = host.pauseReads()
  saveLegacy.props.onClick()
  await flushUi()
  assert.equal(obsolete.count(), 1, 'Classic preflight still saw the saved policy')
  obsolete.allowNext()
  const fresh = host.pauseReads()
  try {
    commit.release()
    assert.equal(await deleting, true)
    await flushUi()
    assert(fresh.count() >= 2, 'refresh after sibling deletion is pending')
    assert.equal(collectLegacyState(host, 'classic').frozen.size, 0, 'confirmed sibling deletion unlocks without waiting for GET')
    obsolete.release()
    await flushUi()
    assert.deepEqual(host.posts[1], { injectBudgetChars: 9101 }, 'Classic stale draft must not resubmit the deleted policy')
    assert.equal(host.posts.length, 2)
    assert(!Object.hasOwn(host.config(), 'deliveryPolicy'))
  } finally {
    obsolete.release()
    fresh.allowNext()
    fresh.release()
  }
  await flushUi()
  assertLegacyState(host, 'classic', false)
}

{
  const adapterSave = extractBetween(policySource, '    onSave: function (policy) {', '\n    onPreview: function (input) {')
  assert(adapterSave, 'production strategy save is extractable for mutation')
  const suppressConfirmation = replaceOnce(clientSource, adapterSave,
    "    onSave: function (policy) { return saveConfigPatch({ deliveryPolicy: policy }) },")
  await assert.rejects(exerciseOtherEntrySave('v4', legacyHost(suppressConfirmation, frozenSource, a1bConfig)),
    /confirmed sibling save must freeze before the new GET returns/)
  for (const face of Object.keys(legacyFaces)) {
    await exerciseOtherEntrySave(face, legacyHost(clientSource, frozenSource, a1bConfig))
  }
  await exerciseOtherEntrySave('classic', legacyHost(clientSource, frozenSource, a1bConfig), { startLegacySaveBeforePolicy: true })
  const savedConfig = { ...a1bConfig, deliveryPolicy: PRESETS.human_full }
  const permitPolicyWrite = replaceOnce(clientSource, "if (k !== 'deliveryPolicy' && !iter5PolicyOwnsLegacyPre(remote, k)",
    'if (!iter5PolicyOwnsLegacyPre(remote, k)')
  await assert.rejects(exerciseOtherEntryRollback(legacyHost(permitPolicyWrite, frozenSource, savedConfig)),
    /Classic stale draft must not resubmit the deleted policy/)
  await exerciseOtherEntryRollback(legacyHost(clientSource, frozenSource, savedConfig))
  check(true, '20 sibling settings apply saved and deleted policy before delayed GETs finish, preserving only the unowned draft. Missing publish and rollback resurrection mutants are detected')
}

console.log('Delivery settings UI guards: ' + pass + ' PASS / ' + fail + ' FAIL')
process.exitCode = fail === 0 ? 0 : 1
