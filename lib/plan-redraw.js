import fs from 'node:fs/promises'
import path from 'node:path'
import { renderPlanFromEventsPre, renderPlanEventIdsPre } from './plan-render.js'
import { mergeDerivedPlanPre } from './plan-derived.js'

/**
 * Default-off post-success projection. The event store is input; latest PLAN is read inside the existing write lock.
 * A snapshot change that conflicts with another writer is reported as redraw failure, never as event-write failure.
 */
export async function redrawPlanAfterEventPre({ projectDir, ws, events, store, writePlanSnapshot, workspaceKey } = {}) {
  if (typeof writePlanSnapshot !== 'function') throw new TypeError('writePlanSnapshot is required')
  const rows = Array.isArray(events) ? events : (Array.isArray(store?.events) ? store.events : null)
  if (!rows) return { ok: false, code: 'plan-redraw-store-missing', error: 'event store has no events array' }
  if (!rows.length) return { ok: true, status: 'skipped-empty', changed: false, archivedIds: [] }
  if (!projectDir) return { ok: false, code: 'plan-redraw-path-missing', error: 'projectDir is required' }
  const wsName = String(ws ? path.basename(String(ws)) : '') || path.basename(String(projectDir)) || 'workspace'
  const rendered = renderPlanFromEventsPre(rows, { wsName })
  if (!String(rendered || '').trim()) return { ok: false, code: 'plan-redraw-render-empty', error: 'event renderer returned empty plan' }
  const eventIds = renderPlanEventIdsPre(rows)
  const key = workspaceKey || path.basename(String(projectDir)) || 'workspace'
  let captured = false
  const result = await writePlanSnapshot(projectDir, async (existing) => {
    captured = true
    const merged = mergeDerivedPlanPre(existing, { text: rendered, eventIds }, { workspaceKey: key })
    if (!merged.ok) return { ok: false, code: merged.error || 'plan-redraw-merge-failed', error: merged.error || 'derived merge failed', changed: false }
    return { ok: true, text: merged.text, changed: merged.changed, archivedIds: merged.archivedIds || [], inherited: merged.inherited || [], frozenIds: merged.frozenIds || [], cardCount: merged.cardCount, revision: merged.revision }
  }, { derivedFromEvents: true })
  if (!captured) return { ok: false, code: 'plan-redraw-lock-not-entered', error: 'derived merge did not run inside PLAN lock', changed: false }
  if (!result || result.ok !== true) return { ...result, ok: false, code: result?.code || 'plan-redraw-write-failed', error: result?.error || 'plan write failed', changed: false }
  return { ok: true, status: result.committed ? 'redrawn' : 'unchanged', ...result, sidecar: result.indexStale ? 'stale' : 'fresh' }
}

/** Optional bounded file-backed harness used by isolated acceptance; production uses writePlanSnapshot above. */
export async function redrawPlanFileForTestPre({ handoffDir, ws, store, withLock, readText, writeText, workspaceKey } = {}) {
  if (typeof withLock !== 'function' || typeof readText !== 'function' || typeof writeText !== 'function') throw new TypeError('isolated lock/read/write dependencies are required')
  const write = async (_projectDir, merge, _opts) => withLock(path.join(handoffDir, 'PLAN.md'), async () => {
    const current = await readText(path.join(handoffDir, 'PLAN.md'))
    const merged = await merge(current)
    if (!merged.ok) return merged
    if (!merged.changed) return { ok: true, committed: false, final: current }
    const saved = await writeText(path.join(handoffDir, 'PLAN.md'), merged.text)
    return saved && saved.ok === false ? saved : { ok: true, committed: true, final: merged.text, revision: merged.revision }
  })
  return redrawPlanAfterEventPre({ projectDir: handoffDir, ws, store, writePlanSnapshot: write, workspaceKey })
}

/** Expose the exact event-order helper to integration tests without changing the string renderer API. */
export function planRenderOrderForTestPre(events) { return renderPlanEventIdsPre(events) }

/** For test diagnostics only: no writes and no ambient store discovery. */
export async function planSourceDigestForTestPre(file) { return Buffer.from(await fs.readFile(file)) }
