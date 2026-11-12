import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { redrawPlanAfterEventPre } from '../../lib/plan-redraw.js'
import { mergeDerivedPlanPre } from '../../lib/plan-derived.js'

const root = path.resolve('artifacts', '_batch2-2.5-redraw-lock-mutation')
await fs.rm(root, { recursive: true, force: true })
await fs.mkdir(root, { recursive: true })
const events = [{ id: 'evt_a1b2c3d4', name: '锁内重绘', status: 'active', sections: { goal: '目标', doing: '新进展', deadend: '', next: '下一步' }, checkpoints: [] }]
const initial = mergeDerivedPlanPre('', { text: (await import('../../lib/plan-render.js')).renderPlanFromEventsPre(events, { wsName: 'lock' }), eventIds: [events[0].id] }, { workspaceKey: 'lock' })
assert.equal(initial.ok, true)
const withNote = initial.text.replace('<!-- /model -->', '<!-- /model -->\n<!-- user -->人工新增备注\n<!-- /user -->')
let pass = 0
const check = (value, message) => { assert.ok(value, message); pass++ }
let existing = withNote
const committedHumanText = withNote.replace('人工新增备注', '并发人工备注')
let inside = false
const changedEvents = [{ ...events[0], sections: { ...events[0].sections, doing: '事件侧新进展' } }]
const redrawPromise = redrawPlanAfterEventPre({ projectDir: root, ws: root, events: changedEvents, writePlanSnapshot: async (_dir, merge) => {
  inside = true
  const merged = await merge(committedHumanText)
  assert.equal(merged.ok, true)
  return { ok: true, committed: true, final: merged.text }
} })
await new Promise((resolve) => setTimeout(resolve, 0))
check(inside, 'redraw merge executes within write callback')
const redraw = await redrawPromise
check(redraw.ok && redraw.final.includes('并发人工备注') && redraw.final.includes('锁内重绘'), 'latest human note and event state both survive')
// Same data and no rewrite path.
const unchanged = await redrawPlanAfterEventPre({ projectDir: root, events: changedEvents, writePlanSnapshot: async (_dir, merge) => {
  const merged = await merge(redraw.final)
  return { ok: true, committed: merged.changed, final: merged.text }
} })
check(unchanged.ok && unchanged.status === 'unchanged' && unchanged.committed === false, 'no-change redraw does not commit')
const outside = await redrawPlanAfterEventPre({ projectDir: root, events, writePlanSnapshot: async () => ({ ok: true, committed: true }) })
check(!outside.ok && outside.code === 'plan-redraw-lock-not-entered', 'merge outside callback is refused')
const failed = await redrawPlanAfterEventPre({ projectDir: root, events, writePlanSnapshot: async (_dir, merge) => { await merge(redraw.final); return { ok: false, error: 'EPERM synthetic' } } })
check(!failed.ok && failed.code === 'plan-redraw-write-failed' && failed.error === 'EPERM synthetic', 'formal writer failure remains separate')
const source = await fs.readFile('lib/plan-redraw.js', 'utf8')
const deps = ['plan-render.js','plan-derived.js','plan-store.js','wb-sidecar.js','file-boundary.js','event-store.js','event-render.js','event-write.js','shared-state-lock.js']
for (const dep of deps) await fs.copyFile(path.join('lib', dep), path.join(root, dep))
await fs.mkdir(path.join(root, 'ledger-doc'), { recursive: true })
await fs.copyFile('lib/ledger-doc/protocol.js', path.join(root, 'ledger-doc', 'protocol.js'))
const variants = [
  { name: 'lock-callback-removed', anchor: 'const merged = mergeDerivedPlanPre(existing, { text: rendered, eventIds }, { workspaceKey: key })', replacement: 'const merged = { ok: true, text: existing, changed: false, archivedIds: [] }' },
  { name: 'latest-read-bypassed', anchor: 'const merged = mergeDerivedPlanPre(existing, { text: rendered, eventIds }, { workspaceKey: key })', replacement: 'const merged = mergeDerivedPlanPre(rendered, { text: rendered, eventIds }, { workspaceKey: key })' },
]
for (const variant of variants) {
  check(source.split(variant.anchor).length - 1 === 1, 'mutation anchor exactly once: ' + variant.name)
  await fs.writeFile(path.join(root, 'plan-redraw.js'), source.replace(variant.anchor, variant.replacement))
  const module = await import(pathToFileURL(path.join(root, 'plan-redraw.js')).href + '?' + variant.name)
  const result = await module.redrawPlanAfterEventPre({ projectDir: root, events: changedEvents, writePlanSnapshot: async (_dir, merge) => {
    const merged = await merge(initial.text)
    return { ok: true, committed: merged.changed, final: merged.text }
  } })
  check(!result.ok || result.final !== redraw.final || result.committed !== false, 'mutation has discriminating behavior: ' + variant.name)
}
await fs.writeFile(path.join(root, 'plan-redraw.js'), source)
console.log('SUMMARY PASS ' + pass + ' / FAIL 0')
console.log('MUTATION CAUGHT ' + variants.length + ' / MISSED 0; RESTORED SOURCE')
