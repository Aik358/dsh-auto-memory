import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadIsolatedEngine } from './load-isolated-engine.mjs'
const dir = await mkdtemp(path.join(tmpdir(), 'dam-audit-module-'))
let internals
try {
  internals = await loadIsolatedEngine(dir, fileURLToPath(new URL('../../', import.meta.url)), process.env.DAM_AUDIT_ENGINE_SOURCE)
} finally { await rm(dir, { recursive: true, force: true }) }
export const { MemoryEngine, diag, flushDiagnostics, apply, API } = internals
