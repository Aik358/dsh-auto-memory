import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork, execFileSync } from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = process.argv[2] === 'worker' ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-307-'))
if (root) process.env.DSH_HOME = path.join(root, 'home')
let moduleURL = process.env.OUTBOX_TEST_MODULE || new URL('../../lib/team-outbox.js', import.meta.url).href
if (process.argv.includes('--baseline') || process.argv.includes('--upstream')) {
  const file = path.join(root, 'baseline-outbox.mjs')
  const ref = process.argv.includes('--upstream') ? 'bda0dad8fa9f7219e1f725e2f828e76e29da7fe4' : '448e49fdaad22c9f69b1fa6738ba4857ff8c9508'
  fs.writeFileSync(file, execFileSync('git', ['show', ref + ':lib/team-outbox.js']))
  moduleURL = pathToFileURL(file).href
}
const { createTeamOutbox } = await import(moduleURL)
const { withSharedStateLock } = await import('../../lib/shared-state-lock.js')
const entry = (key, v = 1, eventId = '') => ({ kind: 'handoff', key, payload: { v }, eventId })
if (process.argv[2] === 'worker') {
  const outbox = createTeamOutbox({ dir: process.argv[3] })
  outbox.load()
  process.on('message', async ({ op, value }) => {
    if (op === 'enqueue') process.send({ result: outbox.enqueue(value) })
    if (op === 'flush') {
      const result = await outbox.flush(async item => {
        process.send({ sending: item })
        await new Promise(resolve => process.once('message', resolve))
      })
      process.send({ result })
    }
    if (op === 'hold') {
      await withSharedStateLock(outbox.file, async () => {
        process.send({ held: true })
        await new Promise(resolve => process.once('message', resolve))
      })
      process.send({ result: { ok: true } })
    }
  })
  process.send({ ready: true })
} else {
  let pass = 0, fail = 0
  const workers = []
  const run = async (name, job) => {
    try { await job(); pass++; console.log('PASS ' + name) }
    catch (error) { fail++; console.error('FAIL ' + name + ': ' + error.message) }
  }
  const box = name => createTeamOutbox({ dir: path.join(root, name) })
  const keys = ob => { assert.equal(ob.load().ok, true); return ob.list().map(it => it.key).sort() }
  const next = child => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker timeout')), 10000)
    child.once('message', message => { clearTimeout(timer); resolve(message) })
  })
  const worker = async (name, dir = path.join(root, name)) => {
    const child = fork(fileURLToPath(import.meta.url), ['worker', dir], {
      env: { ...process.env, OUTBOX_TEST_MODULE: moduleURL }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true
    })
    workers.push(child)
    assert.equal((await next(child)).ready, true)
    return child
  }
  const call = (child, op, value) => { const result = next(child); child.send({ op, value }); return result }
  try {
    await run('normal duplicate, failed delivery, bounded queue and zero constructor IO', async () => {
      const ob = createTeamOutbox({ dir: path.join(root, 'normal'), maxItems: 2 })
      assert.equal(fs.existsSync(path.dirname(ob.file)), false)
      assert.equal(ob.enqueue(entry('A')).ok, true)
      assert.equal(ob.enqueue(entry('A')).dup, true)
      assert.equal((await ob.flush(() => { throw new Error('offline') })).failed, 1)
      assert.deepEqual(keys(ob), ['A'])
      ob.enqueue(entry('B')); ob.enqueue(entry('C'))
      assert.deepEqual(keys(ob), ['B', 'C'])
      assert.ok(ob.dropped >= 1)
      assert.equal((await ob.flush(() => {})).sent, 2)
      assert.deepEqual(keys(ob), [])
    })
    await run('two stale instances preserve both successful enqueues', () => {
      const a = box('instances'), b = box('instances')
      a.load(); b.load()
      assert.equal(a.enqueue(entry('A')).ok, true)
      assert.equal(b.enqueue(entry('B')).ok, true)
      assert.deepEqual(keys(box('instances')), ['A', 'B'])
    })
    await run('later enqueue cannot resurrect a version already drained by another instance', async () => {
      const a = box('resurrect'), b = box('resurrect')
      assert.equal(a.enqueue(entry('A')).ok, true)
      assert.equal((await b.flush(() => {})).sent, 1)
      assert.equal(a.enqueue(entry('B')).ok, true)
      assert.deepEqual(keys(box('resurrect')), ['B'])
    })
    await run('idle instance drains current disk instead of cached empty queue', async () => {
      const a = box('idle'), b = box('idle'); a.load(); b.load()
      b.enqueue(entry('B'))
      const sent = []
      await a.flush(it => sent.push(it.key))
      assert.deepEqual(sent, ['B'])
      assert.deepEqual(keys(box('idle')), [])
    })
    await run('ack preserves other instance additions and same-key new version', async () => {
      const a = box('ack'), b = box('ack'); a.enqueue(entry('same', 1, 'old')); b.load()
      const flushed = await a.flush(() => {
        assert.equal(b.enqueue(entry('same', 2, 'new')).ok, true)
        assert.equal(b.enqueue(entry('B')).ok, true)
      })
      assert.equal(flushed.failed, 0)
      const restored = box('ack')
      assert.deepEqual(keys(restored), ['B', 'same'])
      assert.equal(restored.list().find(it => it.key === 'same').eventId, 'new')
      assert.equal((await restored.flush(() => {})).sent, 2)
    })
    await run('identical payload with new eventId is a new version', async () => {
      const a = box('event'), b = box('event'); a.enqueue(entry('same', 1, 'old'))
      let result
      const flushed = await a.flush(() => { result = b.enqueue(entry('same', 1, 'new')) })
      assert.equal(flushed.failed, 0)
      assert.equal(result.updated, true)
      const restored = box('event')
      assert.deepEqual(keys(restored), ['same'])
      assert.equal(restored.list()[0].eventId, 'new')
    })
    await run('ABA reenqueued identical event survives earlier ack', async () => {
      const a = box('aba'), b = box('aba'); a.enqueue(entry('same'))
      const flushed = await a.flush(async () => {
        await b.flush(() => {})
        assert.equal(b.enqueue(entry('same')).ok, true)
      })
      assert.equal(flushed.failed, 0)
      assert.deepEqual(keys(box('aba')), ['same'])
    })
    await run('failed local enqueue is retained alongside remote enqueue during flush', async () => {
      const a = box('pending'), b = box('pending'); a.load(); b.load()
      const rename = fs.renameSync
      try {
        fs.renameSync = (from, to) => { if (to === a.file) throw new Error('injected rename failure'); return rename(from, to) }
        assert.equal(a.enqueue(entry('A')).ok, false)
      } finally { fs.renameSync = rename }
      assert.equal(b.enqueue(entry('B')).ok, true)
      await a.flush(() => { throw new Error('offline') })
      assert.deepEqual(keys(box('pending')), ['A', 'B'])
    })
    await run('preserve upstream issue308 durable duplicate retry receipt', () => {
      const a = box('durable-dup')
      const rename = fs.renameSync
      try {
        fs.renameSync = (from, to) => { if (to === a.file) throw new Error('injected duplicate rename failure'); return rename(from, to) }
        assert.equal(a.enqueue(entry('A')).ok, false)
        assert.equal(a.enqueue(entry('A')).ok, false)
      } finally { fs.renameSync = rename }
      assert.equal(a.enqueue(entry('A')).ok, true)
      assert.deepEqual(keys(box('durable-dup')), ['A'])
    })
    await run('repeated disk failures keep local pending retry set bounded', async () => {
      const a = createTeamOutbox({ dir: path.join(root, 'pending-bound'), maxItems: 2 })
      const rename = fs.renameSync
      try {
        fs.renameSync = (from, to) => { if (to === a.file) throw new Error('injected pending rename failure'); return rename(from, to) }
        for (let i = 0; i < 10; i++) assert.equal(a.enqueue(entry(String(i))).ok, false)
      } finally { fs.renameSync = rename }
      assert.equal(a.size(), 2)
      assert.equal(a.dropped, 8)
      const sent = []
      await a.flush(it => sent.push(it.key))
      assert.deepEqual(sent, ['8', '9'])
      assert.deepEqual(keys(a), [])
    })
    await run('two preloaded Node processes preserve both enqueues', async () => {
      const a = await worker('process-enqueue'), b = await worker('process-enqueue')
      assert.equal((await call(a, 'enqueue', entry('A'))).result.ok, true)
      assert.equal((await call(b, 'enqueue', entry('B'))).result.ok, true)
      assert.deepEqual(keys(box('process-enqueue')), ['A', 'B'])
    })
    await run('cross-process sender pause then remote update does not lose versions', async () => {
      const a = await worker('process-ack'), b = await worker('process-ack')
      assert.equal((await call(a, 'enqueue', entry('same', 1, 'old'))).result.ok, true)
      const sending = await call(a, 'flush')
      assert.equal(sending.sending.eventId, 'old')
      assert.equal((await call(b, 'enqueue', entry('same', 2, 'new'))).result.ok, true)
      assert.equal((await call(b, 'enqueue', entry('B'))).result.ok, true)
      await call(a, 'resume')
      assert.deepEqual(keys(box('process-ack')), ['B', 'same'])
    })
    await run('directory aliases and explicit lock contention preserve successful transactions', async () => {
      const dir = path.join(root, 'physical'), alias = path.join(root, 'alias')
      fs.mkdirSync(dir)
      fs.symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
      const owner = await worker('physical'), other = await worker('alias', alias)
      assert.equal((await call(owner, 'enqueue', entry('A'))).result.ok, true)
      assert.equal((await call(owner, 'hold')).held, true)
      const busy = (await call(other, 'enqueue', entry('B'))).result
      await call(owner, 'resume')
      assert.equal(busy.ok, false)
      assert.match(busy.reason, /state-lock-busy/)
      assert.deepEqual(keys(box('physical')), ['A'])
      assert.equal((await call(other, 'enqueue', entry('B'))).result.ok, true)
      assert.deepEqual(keys(box('physical')), ['A', 'B'])
    })
    await run('ack write failure retains sent and concurrently enqueued events for retry', async () => {
      const a = box('ack-fail'), b = box('ack-fail')
      a.enqueue(entry('A'))
      const rename = fs.renameSync
      let result
      try {
        result = await a.flush(() => {
          b.enqueue(entry('B'))
          fs.renameSync = (from, to) => { if (to === a.file) throw new Error('injected ack rename failure'); return rename(from, to) }
        })
      } finally { fs.renameSync = rename }
      assert.equal(result.persisted, false)
      assert.deepEqual(keys(a), ['A', 'B'])
      assert.equal((await a.flush(() => {})).sent, 2)
      assert.deepEqual(keys(box('ack-fail')), [])
    })
    await run('cancellation while ack waits for a remote lock retains the disk queue', async () => {
      const a = box('cancel-lock'), owner = await worker('cancel-lock')
      a.enqueue(entry('A'))
      let cancelled = false
      const open = fs.openSync
      let attempted
      const ackAttempt = new Promise(resolve => { attempted = resolve })
      const flush = a.flush(async () => {
        assert.equal((await call(owner, 'hold')).held, true)
        fs.openSync = (file, ...args) => {
          try { return open(file, ...args) } finally {
            if (String(file).toLowerCase() === (a.file + '.lock').toLowerCase()) attempted()
          }
        }
        syncBuiltinESMExports()
      }, { isCancelled: () => cancelled })
      try {
        // Baseline never attempts this lock: its completed flush is the alternate barrier.
        await Promise.race([ackAttempt, flush])
        cancelled = true
        await call(owner, 'resume')
        await flush
      } finally { fs.openSync = open; syncBuiltinESMExports() }
      assert.deepEqual(keys(box('cancel-lock')), ['A'])
    })
    await run('legacy revision-less disk entry drains and clear failures preserve pending updates', async () => {
      const a = box('legacy')
      fs.mkdirSync(path.dirname(a.file))
      fs.writeFileSync(a.file, JSON.stringify({ v: 1, items: [{ kind: 'handoff', key: 'old', payloadRaw: '{"v":1}', at: 1 }] }))
      assert.equal((await a.flush(() => {})).sent, 1)
      assert.deepEqual(keys(a), [])
      a.enqueue(entry('A'))
      const rename = fs.renameSync
      try {
        fs.renameSync = (from, to) => { if (to === a.file) throw new Error('injected clear failure'); return rename(from, to) }
        assert.equal(a.clear().ok, false)
        assert.equal(a.size(), 1)
      } finally { fs.renameSync = rename }
      assert.deepEqual(keys(a), ['A'])
      assert.equal(a.clear().ok, true)
      assert.deepEqual(keys(a), [])
    })
  } finally {
    for (const child of workers) child.kill()
    await Promise.all(workers.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve))))
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(root, { recursive: true, force: true })
  }
  console.log(`issue307: ${pass} PASS / ${fail} FAIL`)
  if (fail) process.exitCode = 1
}
