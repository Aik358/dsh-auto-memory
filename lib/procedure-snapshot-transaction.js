import { isDeepStrictEqual } from 'node:util'
import { createProcedureStorePre } from './procedure-store.js'

const rows = snapshot => copyProcedureSnapshotPre(snapshot).procedures || []
const rawById = snapshot => new Map(rows(snapshot).map(row => [String(row.procedureId), row]))
const byId = snapshot => {
  // restore performs legacy/session normalization. Compare that same logical
  // shape on all three sides; merely loading an old row is not a user edit.
  const original = rawById(snapshot), store = createProcedureStorePre()
  store.restore({ schemaVersion: 1, procedures: [...original.values()] })
  const normalized = rawById(store.snapshot())
  // Unsupported rows are preserved byte-for-JSON, never silently filtered out.
  return new Map([...original].map(([id, row]) => [id, normalized.get(id) || row]))
}
export const copyProcedureSnapshotPre = snapshot => JSON.parse(JSON.stringify(snapshot || { schemaVersion: 1, procedures: [] }))

// Apply only this writer's changes to a fresh locked snapshot. An unchanged
// stale row is never an instruction to resurrect or overwrite that row.
export function mergeProcedureSnapshotPre(base, local, fresh) {
  const before = byId(base), wanted = byId(local), diskRows = byId(fresh)
  const current = rawById(fresh), localRows = rawById(local)
  for (const id of new Set([...before.keys(), ...wanted.keys()])) {
    const old = before.get(id), next = wanted.get(id), disk = diskRows.get(id)
    if (isDeepStrictEqual(old, next)) continue
    if (!isDeepStrictEqual(disk, old) && !isDeepStrictEqual(disk, next)) {
      throw Object.assign(new Error('procedure-conflict: reload before editing ' + id), { code: 'DAM-PROCEDURE-CONFLICT', procedureId: id })
    }
    if (next === undefined) current.delete(id)
    else current.set(id, localRows.get(id))
  }
  return { ...fresh, ...local, procedures: [...current.values()] }
}

export function sameProcedureRowsPre(a, b) {
  return isDeepStrictEqual(byId(a), byId(b))
}
