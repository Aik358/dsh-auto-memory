import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-issue312-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = root
const { memoryDir } = await import('../../lib/datadir.js')
const { createHubIoPre } = await import('../../lib/hub-io.js')

after(() => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  fs.rmSync(root, { recursive: true, force: true })
})

const legacy = { facts: [{ factId: 'legacy', text: 'preserved history' }] }
function fixture(name) {
  const home = path.join(root, name)
  const old = path.join(home, 'memory', 'hub-pre')
  const next = path.join(home, 'memory', 'hub')
  fs.mkdirSync(old, { recursive: true })
  fs.writeFileSync(path.join(old, 'facts.json'), JSON.stringify(legacy))
  return { home, old, next, resolve: () => memoryDir('hub', () => home) }
}
// Use the same IO adapter as the production hub, with the returned data directory.
const load = (dir, name = 'facts.json') => createHubIoPre({ dir })(name).load()
const denied = () => Object.assign(new Error('injected EACCES'), { code: 'EACCES' })
function withFsMethod(name, replacement, job) {
  const original = fs[name]
  fs[name] = replacement
  try { return job(original) } finally { fs[name] = original }
}

test('first copy failure preserves readable history; same-process retry migrates it', () => {
  const f = fixture('first-failure')
  withFsMethod('copyFileSync', () => { throw denied() }, () => {
    const first = f.resolve()
    assert.equal(first, f.old)
    assert.deepEqual(load(first), legacy)
    assert.equal(fs.existsSync(path.join(f.next, 'facts.json')), false)
  })
  const retry = f.resolve()
  assert.equal(retry, f.next)
  assert.deepEqual(load(retry), legacy)
  assert.deepEqual(load(f.old), legacy)
})

test('every failed retry returns readable legacy data until copying recovers', () => {
  const f = fixture('repeated-failure')
  let attempts = 0
  withFsMethod('copyFileSync', () => { attempts++; throw denied() }, () => {
    for (let i = 0; i < 3; i++) {
      const dir = f.resolve()
      assert.equal(dir, f.old)
      assert.deepEqual(load(dir), legacy)
    }
  })
  assert.equal(attempts, 3)
  assert.deepEqual(load(f.resolve()), legacy)
  assert.equal(f.resolve(), f.next)
})

test('partial migration retries the missing file and preserves completed copies', () => {
  const f = fixture('partial-failure')
  const procedures = { procedures: [{ procedureId: 'legacy-procedure' }] }
  fs.writeFileSync(path.join(f.old, 'procedures.json'), JSON.stringify(procedures))
  const original = fs.copyFileSync
  let copied = 0
  withFsMethod('copyFileSync', (...args) => {
    if (++copied === 2) throw denied()
    return original(...args)
  }, () => {
    assert.equal(f.resolve(), f.old)
    assert.deepEqual(load(f.old), legacy)
    assert.deepEqual(load(f.old, 'procedures.json'), procedures)
  })
  assert.equal(fs.readdirSync(f.next).length, 1)
  const completed = fs.readdirSync(f.next)[0]
  const completedBytes = fs.readFileSync(path.join(f.next, completed))
  assert.equal(f.resolve(), f.next)
  assert.deepEqual(load(f.next), legacy)
  assert.deepEqual(load(f.next, 'procedures.json'), procedures)
  assert.deepEqual(fs.readFileSync(path.join(f.next, completed)), completedBytes)
  assert.deepEqual(load(f.old), legacy)
  assert.deepEqual(load(f.old, 'procedures.json'), procedures)
})

test('directory creation failure is retried after recovery', () => {
  const f = fixture('mkdir-failure')
  withFsMethod('mkdirSync', () => { throw denied() }, () => {
    assert.equal(f.resolve(), f.old)
    assert.deepEqual(load(f.old), legacy)
    assert.equal(fs.existsSync(f.next), false)
  })
  assert.equal(f.resolve(), f.next)
  assert.deepEqual(load(f.next), legacy)
})

test('existing real target data is preserved and empty shells are repaired', () => {
  const f = fixture('existing-target')
  const active = { facts: [{ factId: 'active', text: 'keep current data' }] }
  const procedures = { procedures: [{ procedureId: 'old-procedure' }] }
  fs.mkdirSync(f.next)
  fs.writeFileSync(path.join(f.next, 'facts.json'), JSON.stringify(active))
  fs.writeFileSync(path.join(f.next, 'procedures.json'), '{"procedures":[]}')
  fs.writeFileSync(path.join(f.old, 'procedures.json'), JSON.stringify(procedures))
  assert.equal(f.resolve(), f.next)
  assert.deepEqual(load(f.next), active)
  assert.deepEqual(load(f.next, 'procedures.json'), procedures)
  assert.deepEqual(load(f.old), legacy)
})

test('successful migration is cached and subsequent calls have no copy or log side effects', () => {
  const f = fixture('successful-cache')
  assert.equal(f.resolve(), f.next)
  const log = path.join(f.home, 'memory', 'datadir-migration.log')
  const before = fs.readFileSync(log)
  withFsMethod('readdirSync', () => { throw new Error('unexpected second migration scan') }, () => {
    assert.equal(f.resolve(), f.next)
    assert.deepEqual(load(f.next), legacy)
  })
  assert.deepEqual(fs.readFileSync(log), before)
  assert.deepEqual(load(f.old), legacy)
})

test('normal fresh homes remain isolated through the default DSH_HOME resolver', () => {
  const fresh = path.join(root, 'fresh-home')
  process.env.DSH_HOME = fresh
  try {
    assert.equal(memoryDir('hub'), path.join(fresh, 'memory', 'hub'))
    assert.equal(fs.existsSync(path.join(fresh, 'memory', 'hub-pre')), false)
    const f = fixture('different-home')
    assert.equal(f.resolve(), f.next)
    assert.deepEqual(load(f.next), legacy)
    assert.equal(fs.existsSync(path.join(fresh, 'memory', 'hub')), false)
  } finally { process.env.DSH_HOME = root }
})
