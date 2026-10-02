import { readFile } from 'node:fs/promises'
const indexUrl = new URL('../../lib/index.js', import.meta.url)
// Keep the complete production module scope; expose internals only in this test copy.
const source = (await readFile(indexUrl, 'utf8')).replace(/from '(\.\/[^']+)'/g,
  (_, relative) => 'from ' + JSON.stringify(new URL(relative, indexUrl).href))
export const { MemoryEngine, diag, flushDiagnostics } = await import('data:text/javascript;base64,' +
  Buffer.from(source + '\nexport { MemoryEngine, diag }; export const flushDiagnostics = () => _diagChain;').toString('base64'))
