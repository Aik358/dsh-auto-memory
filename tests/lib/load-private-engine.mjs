// Test-only access to the actual class. Production exports are unchanged.
import { readFile, writeFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
export async function loadPrivateEngine() {
  const source = new URL('../../lib/index.js', import.meta.url)
  const temp = new URL('../../lib/.test-settings-' + randomUUID() + '.mjs', import.meta.url)
  try {
    await writeFile(temp, await readFile(source, 'utf8') + '\nexport {MemoryEngine, DEFAULT_CONFIG}\n')
    return await import(temp.href)
  } finally { await rm(temp, {force:true}) }
}
