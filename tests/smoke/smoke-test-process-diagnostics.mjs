import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { auditTemp, mountAuditHost } from '../lib/audit-host-fixture.mjs'

if (process.argv[2] === '--child') {
  const root = process.argv[3], mode = process.argv[4]
  const original = { fatal: process.listenerCount('uncaughtException'), rejection: process.listenerCount('unhandledRejection'),
    monitor: process.listenerCount('uncaughtExceptionMonitor'), exit: process.listenerCount('exit') }
  const host = await mountAuditHost(root)
  assert.equal(process.listenerCount('uncaughtException'), original.fatal)
  assert.equal(process.listenerCount('unhandledRejection'), original.rejection)
  if (mode === 'lifecycle') {
    const second = await mountAuditHost(root)
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), original.monitor + 1)
    host.dispose(); host.dispose()
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), original.monitor + 1)
    second.dispose()
    assert.equal(process.listenerCount('uncaughtExceptionMonitor'), original.monitor)
    assert.equal(process.listenerCount('exit'), original.exit)
    let called = false
    const hostOwned = () => { called = true }
    process.on('uncaughtException', hostOwned)
    const third = await mountAuditHost(root)
    third.dispose()
    process.emit('uncaughtException', new Error('HOST_OWNED_FIXTURE'))
    assert.equal(called, true)
    process.removeListener('uncaughtException', hostOwned)
    console.log('PASS lifecycle observers and host-owned listeners')
  } else {
    if (mode.startsWith('disposed')) host.dispose()
    setTimeout(() => console.log('UNSAFE_SURVIVAL'), 80)
    if (mode.endsWith('rejection')) Promise.reject(new Error('UNRELATED_REJECTION_FIXTURE'))
    else setImmediate(() => { throw new Error('UNRELATED_FATAL_FIXTURE') })
  }
} else {
  const root = await auditTemp('dam-process-diag-')
  try {
    for (const mode of ['mounted-fatal', 'disposed-fatal', 'mounted-rejection', 'disposed-rejection', 'lifecycle']) {
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--child', root, mode],
        { encoding: 'utf8', timeout: 15000 })
      assert.ifError(result.error)
      if (mode === 'lifecycle') assert.equal(result.status, 0, result.stderr + result.stdout)
      else {
        assert.notEqual(result.status, 0, mode + ' must preserve the fatal exit')
        assert.match(result.stderr, /UNRELATED_(FATAL|REJECTION)_FIXTURE/)
        assert.ok(!result.stdout.includes('UNSAFE_SURVIVAL'))
      }
    }
    console.log('PASS fatal exits before/after unload, rejection exits and idempotent lifecycle')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
}
