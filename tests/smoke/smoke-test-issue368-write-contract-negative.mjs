import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-368-'))
const checker = fileURLToPath(new URL('../../tools/check-write-contract.mjs', import.meta.url))
try {
  const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
  const mutant = source.replace('await engine.writeFull(p.userFile, r.text', 'engine.writeFull(p.userFile, r.text')
  assert.notEqual(mutant, source)
  const file = path.join(root, 'index.js')
  fs.writeFileSync(file, mutant)
  const bad = spawnSync(process.execPath, [checker, file], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /writeFull must be awaited or returned/)
  const good = spawnSync(process.execPath, [checker], { encoding: 'utf8' })
  assert.equal(good.status, 0, good.stderr)
  console.log('PASS #368 missing awaits fail the versioned write-contract gate')
} finally { fs.rmSync(root, { recursive: true, force: true }) }
