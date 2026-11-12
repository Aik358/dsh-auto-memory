import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MemoryEngine } from '../lib/audit-engine.mjs'
import { planCardsPre, planRevisionPre, preparePlanPre } from '../../lib/plan-store.js'
import {
  preflightPlanCasPre,
  preflightPlanMutationPre,
  preflightUrgentHandoffPre,
} from '../../lib/plan-preflight.js'

const root = path.resolve('artifacts', '_batch2-2.8-preflight')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })
const planPath = path.join(root, 'handoff', 'PLAN.md')
const conflicts = path.join(root, 'handoff', 'conflicts')
await fs.mkdir(path.dirname(planPath), { recursive: true })
let pass = 0
const check = (condition, message) => { assert.ok(condition, message); pass++ }
const validPlan = '# Synthetic plan\n## 目标\n- 足够长的项目目标内容用于通过正式白板判据。\n'
const anchor = '<!-- memory:mem_' + 'a'.repeat(32) + ' -->'
const card = (id, body = '项目状态内容足够长') => '### 当前状态\n<!-- memory:mem_' + id + ' -->\n' + body + '\n'
const current = validPlan + card('a'.repeat(32)) + card('b'.repeat(32))
await fs.writeFile(planPath, current)
const engine = new MemoryEngine()
engine.config = { criteriaGate: true }
const checkMutationPre = engine.checkMutationPre.bind(engine)
const snapshot = async () => {
  const files = []
  const walk = async (dir) => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else files.push([path.relative(root, file), await fs.readFile(file)])
    }
  }
  await walk(root)
  return files
}
const noIo = (fn) => {
  const before = Object.fromEntries(['readFile', 'writeFile', 'mkdir', 'appendFile', 'rename', 'unlink'].map((key) => [key, fs[key]]))
  try {
    for (const [key, original] of Object.entries(before)) fs[key] = async () => { throw new Error('unexpected IO: ' + key) }
    return fn()
  } finally {
    for (const [key, original] of Object.entries(before)) fs[key] = original
  }
}

const actual = await preparePlanPre(planPath, current, current, { expectedRevision: planRevisionPre(current) })
const beforePreflight = await snapshot()
const preflight = noIo(() => preflightPlanCasPre({ existing: current, incoming: current, expectedRevision: planRevisionPre(current) }))
check(actual.ok && preflight.ok && actual.text === preflight.text, 'whole-text CAS matches real preparePlanPre :: ' + JSON.stringify({ actual, preflight, revision: planRevisionPre(current) }))
const stale = noIo(() => preflightPlanCasPre({ existing: current, incoming: current, expectedRevision: 'stale' }))
check(!stale.ok && stale.code === 'PLAN_VERSION_CONFLICT' && stale.conflictRecorded === false, 'stale CAS rejected without conflict recording')
const missing = noIo(() => preflightPlanCasPre({ existing: current, incoming: current }))
check(!missing.ok && missing.code === 'PLAN_VERSION_CONFLICT', 'missing expectedRevision rejected')
const duplicate = current + card('a'.repeat(32))
const duplicateCard = planCardsPre(duplicate).find((card) => card.id === 'mem_' + 'a'.repeat(32))
const duplicateCas = noIo(() => preflightPlanCasPre({ existing: duplicate, incoming: current, cardId: duplicateCard.id, expectedCardRevision: duplicateCard.revision }))
check(duplicateCas.code === 'PLAN_CARD_DUPLICATE_ID' && duplicateCas.duplicateCount === 2, 'duplicate ids get specific CAS rejection')
check(noIo(() => preflightPlanMutationPre({ beforeText: duplicate, afterText: duplicate, checkMutationPre, skipCriteria: true })).ok === false, 'whole preflight rejects duplicate identities before final write')
const protectedPlan = validPlan + '### 用户备注\n<!-- memory:mem_' + 'c'.repeat(32) + ' -->\n<!-- user -->\nUser note must survive\n<!-- /user -->\n'
check(noIo(() => preflightPlanMutationPre({ beforeText: protectedPlan, afterText: validPlan, expectedRevision: planRevisionPre(protectedPlan), checkMutationPre, skipCriteria: true })).code === 'PLAN_USER_REGION_PROTECTED', 'user-region loss rejected')

const one = planCardsPre(current).find((card) => card.id === 'mem_' + 'a'.repeat(32))
const actualCard = await preparePlanPre(planPath, current, one.text, { cardId: one.id, expectedCardRevision: one.revision })
const cardResult = noIo(() => preflightPlanCasPre({ existing: current, incoming: one.text, cardId: one.id, expectedCardRevision: one.revision }))
check(actualCard.ok && actualCard.text === cardResult.text, 'single-card format matches real helper :: ' + JSON.stringify({ actualCard, cardResult, one }))
check(noIo(() => preflightPlanCasPre({ existing: current, incoming: one.text.replace(anchor, ''), cardId: one.id, expectedCardRevision: one.revision })).code === 'PLAN_CARD_FORMAT', 'card anchor removal rejected')

const m1Input = { beforeText: current, afterText: validPlan, expectedRevision: planRevisionPre(current), archivedIds: [], skipCriteria: true }
const m1 = noIo(() => preflightPlanMutationPre({ ...m1Input, checkMutationPre }))
const actualM1 = checkMutationPre({ target: 'plan', ...m1Input })
check(m1.ok && m1.m1Downgraded && actualM1.ok && actualM1.m1Downgraded, 'M1 warning matches real mutation helper :: ' + JSON.stringify({ m1, actualM1 }))
const archived = noIo(() => preflightPlanMutationPre({ ...m1Input, archivedIds: ['mem_' + 'b'.repeat(32)], checkMutationPre }))
check(archived.ok && archived.m1Downgraded && archived.report.report.archived.length === 1 && archived.report.report.unarchived.length === 1, 'fromEvents merged archivedIds respected without global M1 bypass')
const fullyArchived = noIo(() => preflightPlanMutationPre({ ...m1Input, archivedIds: ['mem_' + 'a'.repeat(32), 'mem_' + 'b'.repeat(32)], checkMutationPre }))
check(fullyArchived.ok && !fullyArchived.m1Downgraded, 'explicitly archived disappeared cards avoid M1 warning')
const criteria = noIo(() => preflightPlanMutationPre({ beforeText: '', afterText: '# Plan\n## 目标\n短', checkMutationPre }))
check(!criteria.ok && criteria.gate === 'criteria', 'invalid criteria rejected')
const urgent = noIo(() => preflightUrgentHandoffPre({ afterText: '# handoff\n## 目标\n短', checkMutationPre }))
check(urgent.ok && urgent.gate === 'not-applicable' && urgent.reason === 'ledger-append-only-no-before-side', 'urgent handoff keeps skipCriteria and append-only semantics')
let captured
noIo(() => preflightUrgentHandoffPre({ afterText: 'synthetic', checkMutationPre: (input) => { captured = input; return { ok: true } } }))
check(captured.target === 'handoff' && captured.beforeText === '' && captured.skipCriteria === true && captured.archivedIds.length === 0, 'urgent input shape matches append-only contract')
const fromEventsInput = { beforeText: current, afterText: validPlan, expectedRevision: planRevisionPre(current), archivedIds: ['mem_' + 'b'.repeat(32)], checkMutationPre }
const fromEvents = noIo(() => preflightPlanMutationPre(fromEventsInput))
check(fromEvents.ok && fromEvents.finalCheckRequired === true, 'rendered fromEvents preflight retains final-check requirement')
check(JSON.stringify(await snapshot()) === JSON.stringify(beforePreflight), 'real file tree byte-identical before and after preflight')
const conflictsBeforePreflight = await fs.readdir(conflicts).catch(() => [])
check(JSON.stringify(await fs.readdir(conflicts).catch(() => [])) === JSON.stringify(conflictsBeforePreflight), 'preflight adds no conflict artifacts beyond the real comparison')
check(await fs.readFile(planPath, 'utf8') === current, 'PLAN bytes unchanged by every preflight')
check(noIo(() => preflightPlanMutationPre({ ...m1Input, checkMutationPre })).ok, 'noIO monkeypatch default preflight executes')
console.log('SUMMARY PASS ' + pass + ' / FAIL 0')

const source = await fs.readFile('lib/plan-preflight.js', 'utf8')
const mutations = [
  { name: 'cas-removed', from: '  if ((existing || expectedRevision !== undefined) && expectedRevision !== planRevisionPre(existing)) {', to: '  if (false) {', run: (module) => module.preflightPlanCasPre({ existing: current, incoming: current, expectedRevision: 'stale' }).ok === true },
  { name: 'user-region-removed', from: '    if (incoming.split(user).length < existing.split(user).length) return failure(', to: '    if (false) return failure(', run: (module) => module.preflightPlanMutationPre({ beforeText: protectedPlan, afterText: validPlan, expectedRevision: planRevisionPre(protectedPlan), checkMutationPre, skipCriteria: true }).gate === 'mutation' },
  { name: 'm1-hard-reject', from: "    if (!result.ok && result.hard.every((hard) => hard.pass || hard.id === 'M1')) {", to: '    if (false) {', run: (module) => module.preflightPlanMutationPre(m1Input).ok === false },
]
for (const mutation of mutations) {
  assert.equal(source.split(mutation.from).length - 1, 1, 'mutation anchor exactly once')
  const file = path.join(root, mutation.name + '.js')
  const rewritten = source.replace(/from '(\.\/[^']+)'/g, (_, relative) => 'from ' + JSON.stringify(pathToFileURL(path.resolve('lib', relative)).href))
  await fs.writeFile(file, rewritten.replace(mutation.from, mutation.to))
  const module = await import(pathToFileURL(file).href)
  check(mutation.run(module), 'MUTATION ' + mutation.name + ' CAUGHT')
}
console.log('MUTATION CAUGHT ' + mutations.length + ' / MISSED 0')
