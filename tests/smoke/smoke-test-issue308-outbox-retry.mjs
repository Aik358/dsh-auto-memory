import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Optional module path lets the identical assertions run against the base tree.
const moduleUrl = process.argv[2] ? pathToFileURL(path.resolve(process.argv[2])).href : new URL('../../lib/team-outbox.js', import.meta.url).href
const { createTeamOutbox } = await import(moduleUrl)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-issue308-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const entry = { kind: 'handoff', key: 'retry', payload: { v: 1 }, at: 123, eventId: 'event-1' }
let passed = 0, failed = 0

async function check(name, job) {
  try { await job(path.join(root, name)); passed++; console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + '\n' + e.stack) }
}

function disk(ob) { return JSON.parse(fs.readFileSync(ob.file, 'utf8')) }
function fresh(dir) {
  const ob = createTeamOutbox({ dir })
  assert.equal(ob.load().ok, true)
  return ob.list()
}

// Fault only this outbox's IO, leaving other filesystem operations untouched.
async function fault(ob, method, job) {
  const original = fs[method]
  let attempts = 0
  fs[method] = function (...args) {
    const target = method === 'renameSync' ? args[1] : args[0]
    if (target === ob.file || String(target).startsWith(ob.file + '.') || (method === 'mkdirSync' && target === path.dirname(ob.file))) {
      attempts++
      throw Object.assign(new Error('injected ' + method + ' EACCES'), { code: 'EACCES' })
    }
    return original.apply(this, args)
  }
  try { await job(() => attempts) } finally { fs[method] = original }
}

try {
  await check('normal-duplicate-no-io', async dir => {
    const ob = createTeamOutbox({ dir })
    assert.equal(fs.existsSync(dir), false, 'construction is lazy')
    assert.equal(ob.enqueue(entry).ok, true)
    const before = fs.readFileSync(ob.file, 'utf8')
    await fault(ob, 'renameSync', attempts => {
      const duplicate = ob.enqueue({ ...entry, at: 456 })
      assert.equal(duplicate.ok, true)
      assert.equal(duplicate.dup, true)
      assert.equal(attempts(), 0)
    })
    const loaded = createTeamOutbox({ dir })
    assert.equal(loaded.load().ok, true)
    await fault(loaded, 'writeFileSync', attempts => {
      assert.equal(loaded.enqueue(entry).ok, true)
      assert.equal(attempts(), 0)
    })
    assert.equal(fs.readFileSync(ob.file, 'utf8'), before)
    assert.equal(ob.list()[0].at, entry.at)
  })

  await check('failed-rename-recovery-process-restart', async dir => {
    const ob = createTeamOutbox({ dir })
    await fault(ob, 'renameSync', attempts => {
      assert.equal(ob.enqueue(entry).ok, false)
      assert.equal(attempts(), 3)
    })
    assert.equal(fresh(dir).length, 0)
    const retry = ob.enqueue({ ...entry, at: 456 })
    assert.equal(retry.ok, true)
    assert.equal(retry.dup, true)
    const child = spawnSync(process.execPath, ['--input-type=module', '-e',
      "const {createTeamOutbox}=await import(process.argv[1]);const ob=createTeamOutbox({dir:process.argv[2]});if(!ob.load().ok)process.exit(2);console.log(JSON.stringify(ob.list()))",
      moduleUrl, dir], { encoding: 'utf8', env: { ...process.env, DSH_HOME: root }, timeout: 10000 })
    assert.equal(child.status, 0, child.stderr || String(child.error))
    assert.deepEqual(JSON.parse(child.stdout), [entry])
    assert.deepEqual(fs.readdirSync(dir), ['team-outbox.json'], 'failed temporary files cleaned')
  })

  await check('persistent-rename-failure', async dir => {
    const ob = createTeamOutbox({ dir })
    await fault(ob, 'renameSync', attempts => {
      for (let i = 1; i <= 4; i++) {
        const result = ob.enqueue(entry)
        assert.equal(result.ok, false, 'no success while disk is unavailable')
        assert.match(result.reason, /injected renameSync/)
        assert.equal(attempts(), i * 3)
        assert.equal(ob.size(), 1)
        assert.equal(fresh(dir).length, 0)
      }
    })
    assert.equal(ob.enqueue(entry).ok, true)
    assert.deepEqual(fresh(dir), [entry])
  })

  await check('failed-replacement-retry', async dir => {
    const ob = createTeamOutbox({ dir })
    assert.equal(ob.enqueue(entry).ok, true)
    const updated = { ...entry, payload: { v: 2 }, eventId: 'event-2', at: 789 }
    await fault(ob, 'renameSync', () => {
      assert.equal(ob.enqueue(updated).ok, false)
      assert.deepEqual(fresh(dir), [entry], 'failed replace keeps old durable version')
      assert.equal(ob.enqueue(updated).ok, false)
    })
    assert.equal(ob.enqueue(updated).ok, true)
    assert.deepEqual(fresh(dir), [updated])
  })

  for (const method of ['writeFileSync', 'mkdirSync']) {
    await check('persistent-' + method + '-failure', async dir => {
      const ob = createTeamOutbox({ dir })
      await fault(ob, method, attempts => {
        assert.equal(ob.enqueue(entry).ok, false)
        assert.equal(ob.enqueue(entry).ok, false)
        assert.equal(attempts(), 2)
      })
      assert.equal(ob.enqueue(entry).ok, true)
      assert.deepEqual(fresh(dir), [entry])
    })
  }

  await check('other-enqueue-persists-pending-snapshot', async dir => {
    const ob = createTeamOutbox({ dir })
    await fault(ob, 'renameSync', () => assert.equal(ob.enqueue(entry).ok, false))
    assert.equal(ob.enqueue({ ...entry, key: 'other' }).ok, true)
    await fault(ob, 'renameSync', attempts => {
      assert.equal(ob.enqueue(entry).ok, true)
      assert.equal(attempts(), 0, 'successful whole snapshot marks pending entry durable')
    })
    assert.deepEqual(fresh(dir).map(item => item.key), ['retry', 'other'])
  })

  await check('explicit-load-replaces-pending-snapshot', async dir => {
    const ob = createTeamOutbox({ dir })
    assert.equal(ob.enqueue(entry).ok, true)
    await fault(ob, 'renameSync', () => assert.equal(ob.enqueue({ ...entry, payload: { v: 2 } }).ok, false))
    assert.equal(ob.load().ok, true, 'explicit load discards unsaved memory under existing contract')
    await fault(ob, 'renameSync', attempts => {
      assert.equal(ob.enqueue(entry).ok, true)
      assert.equal(attempts(), 0, 'loaded durable duplicate stays a no-op')
    })
  })

  await check('flush-recovery-and-failed-dequeue', async dir => {
    const ob = createTeamOutbox({ dir })
    await fault(ob, 'renameSync', () => assert.equal(ob.enqueue(entry).ok, false))
    const retained = await ob.flush(() => { throw new Error('mock sender unavailable') })
    assert.equal(retained.failed, 1)
    assert.deepEqual(fresh(dir), [entry])
    await fault(ob, 'renameSync', async attempts => {
      assert.equal(ob.enqueue(entry).ok, true)
      assert.equal(attempts(), 0, 'successful flush persisted the pending snapshot')
      assert.equal((await ob.flush(() => {})).persisted, false)
      assert.equal(ob.enqueue(entry).ok, false, 'failed dequeue cannot clear persistence retry state')
    })
    assert.equal(ob.enqueue(entry).ok, true)
    assert.deepEqual(fresh(dir), [entry])
    assert.equal((await ob.flush(() => {})).size, 0)
    assert.equal(fresh(dir).length, 0)
  })

  await check('bounded-retry-preserves-drop-count', async dir => {
    const ob = createTeamOutbox({ dir, maxItems: 1 })
    assert.equal(ob.enqueue({ ...entry, key: 'old' }).ok, true)
    await fault(ob, 'renameSync', () => assert.equal(ob.enqueue(entry).ok, false))
    assert.equal(ob.dropped, 1)
    const retry = ob.enqueue(entry)
    assert.equal(retry.ok, true)
    assert.equal(retry.dup, true)
    assert.equal(ob.dropped, 1)
    assert.equal(disk(ob).dropped, 1)
    assert.deepEqual(fresh(dir), [entry])
  })
} finally {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  fs.rmSync(root, { recursive: true, force: true })
}
console.log('issue308: PASS ' + passed + ' / FAIL ' + failed)
if (failed) process.exitCode = 1
