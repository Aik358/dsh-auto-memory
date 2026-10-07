import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

// Copy only the entrypoint to an already-isolated test home. Relative imports
// keep using the selected checkout; its private class remains test-only.
export async function loadIsolatedEngine(home, repo = process.env.AUDIT_TEST_REPO, sourcePath) {
  const root = repo || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const sourceUrl = pathToFileURL(path.join(root, 'lib', 'index.js'))
  const source = (await readFile(sourcePath || sourceUrl, 'utf8')).replace(
    /(from\s*|import\s*\()(['"])(\.\/[^'"]+)\2/g,
    (_, prefix, quote, relative) => prefix + quote + new URL(relative, sourceUrl).href + quote)
  const fixture = path.join(home, 'engine-extract.mjs')
  await writeFile(fixture, source + '\nexport { MemoryEngine, DEFAULT_CONFIG, diag }; export const flushDiagnostics = () => _diagChain;\n')
  return import(pathToFileURL(fixture).href)
}
