import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../test_audit_python_delivery.py', import.meta.url))
const candidates = [...new Set([process.env.PYTHON, process.platform === 'win32' ? 'python' : 'python3', 'python'].filter(Boolean))]
let result
for (const python of candidates) {
  result = spawnSync(python, ['-B', script], { encoding: 'utf8', timeout: 30000 })
  if (result.error?.code !== 'ENOENT') break
}
assert.ifError(result.error)
process.stdout.write(result.stdout)
process.stdout.write(result.stderr)
assert.equal(result.status, 0, 'Python worker framing/model-input regressions failed')
console.log('PASS audit Python delivery (stdlib-only, no models or network)')
