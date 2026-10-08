// Real shared/exclusive settings locks, IPC barriers, isolated files, no mock lock.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { withConfigLock, withConfigLockSync, withConfigReadLock } from '../../lib/config-lock.js'
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const mode = process.argv[2]
if (mode === '--reader') {
  await withConfigReadLock(process.argv[3], async () => {
    process.send('entered')
    const message = await new Promise(resolve => process.once('message', resolve))
    if (message === 'crash') process.exit(0)
  })
  process.disconnect()
} else {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-root-leases-'))
  const file = path.join(home, 'settings.json')
  const tasks = [], children = [], gates = []
  const track = promise => { promise.catch(() => {}); tasks.push(promise); return promise }
  const gate = () => { const d = deferred(); gates.push(d); return d }
  const entered = async promise => {
    let timer
    try { await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('barrier not reached')), 3000) })]) }
    finally { clearTimeout(timer) }
  }
  const leaseFiles = async () => (await fs.readdir(home)).filter(name => name.startsWith('settings.json.reader-') && name.endsWith('.lock'))
  function child() {
    const proc = fork(fileURLToPath(import.meta.url), ['--reader', file], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    children.push(proc)
    const ready = deferred()
    let output = ''
    proc.stdout.on('data', data => { output += data }); proc.stderr.on('data', data => { output += data })
    proc.once('message', message => { if (message === 'entered') ready.resolve() })
    const done = track(new Promise((resolve, reject) => {
      proc.once('error', reject)
      proc.once('exit', code => code === 0 ? resolve() : reject(new Error('worker exit ' + code + ': ' + output)))
    }))
    return { proc, ready: ready.promise, done }
  }
  try {
    await fs.writeFile(file, '{}')
    const a = gate(), b = gate(), releaseA = gate(), releaseB = gate()
    const first = track(withConfigReadLock(file, async () => { a.resolve(); await releaseA.promise }))
    await entered(a.promise)
    const second = track(withConfigReadLock(file, async () => { b.resolve(); await releaseB.promise }))
    await entered(b.promise)
    assert.equal((await leaseFiles()).length, 2, 'independent root readers enter concurrently')
    assert.throws(() => withConfigLockSync(file, () => assert.fail('exclusive startup must not enter')), { code: 'CONFIG_LOCK_BUSY' })
    let saved = false
    const saving = track(withConfigLock(file, async () => { saved = true; await fs.writeFile(file, '{"new":true}') }))
    await delay(40)
    assert.equal(saved, false)
    releaseA.resolve(); await first
    await delay(40); assert.equal(saved, false)
    releaseB.resolve(); await second; await saving
    assert.equal((await leaseFiles()).length, 0)
    console.log('PASS concurrent readers; exclusive save waits for both; sync startup defers')

    // A pending exclusive retry must never hold the lock against a queued reader.
    const outerReady = gate(), resumeOuter = gate(), peerReady = gate(), releasePeer = gate()
    const outer = track(withConfigReadLock(file, async () => { outerReady.resolve(); await resumeOuter.promise }))
    await entered(outerReady.promise)
    let cutOver = false
    const cutover = track(withConfigLock(file, () => { cutOver = true }))
    const peer = track(withConfigReadLock(file, async () => { peerReady.resolve(); await releasePeer.promise }))
    await entered(peerReady.promise)
    assert.equal(cutOver, false)
    releasePeer.resolve(); await peer
    resumeOuter.resolve(); await outer; await cutover
    console.log('PASS exclusive retry releases its claim while readers exist; queued peer enters without a wait cycle')

    await assert.rejects(withConfigReadLock(file, () => withConfigLock(file, () => {})), { code: 'CONFIG_LOCK_UPGRADE' })
    await assert.rejects(withConfigReadLock(file, async () => { throw new Error('injected read-job failure') }), /injected read-job failure/)
    assert.equal((await leaseFiles()).length, 0)
    console.log('PASS upgrade fails visibly; failed reader releases its durable lease')

    const live = child(); await entered(live.ready)
    let externalSaved = false
    const externalSave = track(withConfigLock(file, () => { externalSaved = true }))
    await delay(40); assert.equal(externalSaved, false)
    live.proc.send('release'); await live.done; await externalSave
    assert.equal((await leaseFiles()).length, 0)
    const dead = child(); await entered(dead.ready)
    dead.proc.send('crash'); await dead.done
    assert.equal((await leaseFiles()).length, 1, 'crashed process leaves its real reader receipt')
    assert.equal(withConfigLockSync(file, () => 'recovered'), 'recovered')
    assert.equal((await leaseFiles()).length, 0)
    console.log('PASS other-process reader excludes cutover; dead PID lease recovers under the acquisition gate')
  } finally {
    gates.forEach(g => g.resolve())
    for (const proc of children) if (proc.connected) proc.send('release')
    await Promise.allSettled(tasks)
    await fs.rm(home, { recursive: true, force: true })
  }
}
