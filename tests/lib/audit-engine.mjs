import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const indexUrl = new URL('../../lib/index.js', import.meta.url)
// Keep the complete production scope; expose internals only in this test copy.
const source = (await readFile(process.env.DAM_AUDIT_ENGINE_SOURCE || indexUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g,
  (_, relative) => 'from ' + JSON.stringify(new URL(relative, indexUrl).href))
const dir = await mkdtemp(path.join(tmpdir(), 'dam-audit-module-'))
let internals
try {
  const file = path.join(dir, 'engine.mjs')
  await writeFile(file, source + '\nexport { MemoryEngine, diag }; export const flushDiagnostics = () => _diagChain;')
  internals = await import(pathToFileURL(file).href)
} finally { await rm(dir, { recursive: true, force: true }) }
export const { MemoryEngine, diag, flushDiagnostics, apply, API } = internals
