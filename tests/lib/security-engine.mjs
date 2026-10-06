import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'

export const securityRepo = process.env.DSH_SECURITY_REPO || fileURLToPath(new URL('../../', import.meta.url))
export const securityModule = name => import(pathToFileURL(path.join(securityRepo, 'lib', name)).href)
export async function loadSecurityEngine() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-security-engine-'))
  try {
    const url = pathToFileURL(path.join(securityRepo, 'lib/index.js'))
    let source = await fs.readFile(url, 'utf8')
    source = source.replace(/from '(\.\/[^']+)'/g, (_, rel) => 'from ' + JSON.stringify(new URL(rel, url).href))
    await fs.writeFile(path.join(dir, 'engine.mjs'), source + '\nexport { MemoryEngine, DEFAULT_CONFIG, stripSensitiveSections };\n')
    return await import(pathToFileURL(path.join(dir, 'engine.mjs')).href)
  } finally { await fs.rm(dir, { recursive: true, force: true }) }
}
