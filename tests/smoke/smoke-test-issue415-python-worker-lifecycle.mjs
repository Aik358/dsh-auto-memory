import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { createPythonSidecarClientPre } from '../../lib/python-sidecar-client.js'

const home = fs.mkdtempSync(path.join(tmpdir(), 'dam-worker-lifecycle-'))
const worker = path.join(home, 'fixture.mjs')
fs.writeFileSync(worker, 'process.stdin.resume()\n')
let allowed = true
const client = createPythonSidecarClientPre({ command: process.execPath, scriptPath: worker, dshHome: home, canStart: () => allowed })
try {
  const pending = client.request('health', {}, { timeoutMs: 10000 })
  while (!client.isStarted()) await new Promise(resolve => setTimeout(resolve, 1))
  allowed = false
  client.restart('uninstall')
  assert.equal((await pending).code, 'restarted', 'old requests finish when their worker is stopped')
  assert.equal(client.currentEpoch(), null); assert.equal(client.isStarted(), false)
  assert.equal((await client.request('health', {})).code, 'engine-not-ready')
  assert.equal(client.isStarted(), false, 'uninstalled engines cannot revive through a query')
  allowed = true
  assert.equal(client.ensureStarted().ok, true, 'reinstallation can start a fresh lazy worker')
  assert.ok(client.currentEpoch())
  console.log('PASS #415 worker restart settles old work, blocks revival and permits reinstallation')
} finally { client.dispose(); fs.rmSync(home, { recursive: true, force: true }) }
