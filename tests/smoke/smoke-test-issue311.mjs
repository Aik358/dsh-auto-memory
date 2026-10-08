// Issue #311: real writer and engine paths, deterministic barriers, isolated home.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { parseAnchors, planMigration } from '../../lib/memory-anchor.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-issue311-'))
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = path.join(root, 'home')
fs.mkdirSync(process.env.DSH_HOME)
after(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  fs.rmSync(root, { recursive: true, force: true })
})

const seed = '# Original\n- preserved\n'
const methods = ['appendRaw', 'replaceRaw', 'append', 'replace', 'replaceSingle', 'applyPlan']
function fixture() {
  const dir = fs.mkdtempSync(path.join(root, 'case-'))
  const files = ['a', 'b', 'c'].map(name => path.join(dir, name, 'MEMORY.md'))
  for (const file of files) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, seed)
  }
  return { dir, files }
}
function mutate(store, method, file, text) {
  return method === 'applyPlan'
    ? store.applyPlan(file, planMigration(file, seed))
    : store[method](file, text)
}
function checkContent(method, file, text) {
  const actual = fs.readFileSync(file, 'utf8')
  if (method === 'applyPlan') {
    const parsed = parseAnchors(actual)
    assert.equal(parsed.status, 'clean')
    assert.ok(parsed.records.length > 0)
    assert.ok(parsed.records.every(record => record.kind === 'anchored'))
    assert.ok(actual.includes('- preserved'))
  } else {
    assert.ok(actual.includes(text), actual)
    if (method.startsWith('append')) assert.ok(actual.includes('- preserved'))
  }
}
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
async function arrived(barrier) {
  let timer
  try {
    await Promise.race([
      barrier.promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('read barrier not reached')), 5000) }),
    ])
  } finally { clearTimeout(timer) }
}
// Pause after the production read, so the snapshots and alias pins both exist.
function pauseReads(t, store, files) {
  const gates = files.map(() => ({ entered: deferred(), resume: deferred() }))
  const original = store._readState.bind(store)
  const pending = []
  store._readState = async file => {
    const state = await original(file)
    const index = files.indexOf(file)
    if (index >= 0 && !gates[index].used) {
      gates[index].used = true
      gates[index].entered.resolve()
      await gates[index].resume.promise
    }
    return state
  }
  t.after(async () => {
    gates.forEach(gate => gate.resume.resolve())
    await Promise.allSettled(pending)
  })
  return { gates, start: promise => { pending.push(promise); return promise } }
}

for (const method of methods) {
  for (const order of [[0, 1], [1, 0]]) {
    test(`${method}: different directories finish ${order.join(' then ')} without guard contamination`, async t => {
      const { files: [a, b, c] } = fixture()
      const store = new MemoryDocumentStore()
      const { gates, start } = pauseReads(t, store, [a, b])
      const flights = [start(mutate(store, method, a, 'write A'))]
      await arrived(gates[0].entered)
      flights.push(start(mutate(store, method, b, 'write B')))
      await arrived(gates[1].entered)
      const results = []
      for (const index of order) {
        gates[index].resume.resolve()
        results[index] = await flights[index]
      }
      for (const [index, file] of [a, b].entries()) {
        assert.equal(results[index].ok, true, JSON.stringify(results[index]))
        checkContent(method, file, index === 0 ? 'write A' : 'write B')
      }
      // A later directory must not inherit the guard of either finished task.
      assert.equal((await mutate(store, method, c, 'write C')).ok, true)
      checkContent(method, c, 'write C')
    })
  }
  test(`${method}: sequential different-directory control`, async () => {
    const { files } = fixture()
    const store = new MemoryDocumentStore()
    for (const [index, file] of files.entries()) {
      const text = 'sequential ' + index
      const result = await mutate(store, method, file, text)
      assert.equal(result.ok, true, JSON.stringify(result))
      checkContent(method, file, text)
    }
  })

  test(`${method}: a completed peer cannot disable a retargeted transaction's guard`, async t => {
    const { dir, files: [a, b] } = fixture()
    const admitted = path.dirname(b)
    const outside = path.join(dir, 'outside')
    const alias = path.join(dir, 'alias')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'MEMORY.md'), seed)
    fs.symlinkSync(admitted, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const target = path.join(alias, 'MEMORY.md')
    const store = new MemoryDocumentStore()
    const { gates, start } = pauseReads(t, store, [a, target])
    const first = start(store.appendRaw(a, 'normal peer'))
    await arrived(gates[0].entered)
    const second = start(mutate(store, method, target, 'must be rejected'))
    await arrived(gates[1].entered)
    gates[0].resume.resolve()
    const firstResult = await first
    fs.unlinkSync(alias)
    fs.symlinkSync(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')
    gates[1].resume.resolve()
    const result = await second
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.equal(result.fsCode, 'MEMORY_PATH_ESCAPED')
    assert.equal(firstResult.ok, true, JSON.stringify(firstResult))
    assert.equal(fs.readFileSync(b, 'utf8'), seed)
    assert.equal(fs.readFileSync(path.join(outside, 'MEMORY.md'), 'utf8'), seed)
    assert.deepEqual(fs.readdirSync(outside), ['MEMORY.md'])
  })
}

test('alias guard is rechecked after rename retry backoff', async () => {
  const { dir, files: [, b] } = fixture()
  const alias = path.join(dir, 'alias'), outside = path.join(dir, 'outside')
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'MEMORY.md'), seed)
  fs.symlinkSync(path.dirname(b), alias, linkType)
  const target = path.join(alias, 'MEMORY.md')
  let attempts = 0
  const store = new MemoryDocumentStore({
    fs: { ...fs.promises, async rename(from, to) {
      if (to === target && ++attempts === 1) throw Object.assign(new Error('retry'), { code: 'EPERM' })
      return fs.promises.rename(from, to)
    } },
    atomicOptions: { renameDelays: [0, 1], sleep: async () => {
      fs.unlinkSync(alias)
      fs.symlinkSync(outside, alias, linkType)
    } },
  })
  const result = await store.appendRaw(target, 'must be rejected')
  assert.equal(result.ok, false)
  assert.equal(result.fsCode, 'MEMORY_PATH_ESCAPED')
  assert.equal(attempts, 1, 'the second rename must be blocked before the fs call')
  assert.equal(fs.readFileSync(b, 'utf8'), seed)
  assert.equal(fs.readFileSync(path.join(outside, 'MEMORY.md'), 'utf8'), seed)
})

for (const enabled of [false, true]) {
  test(`MemoryEngine.appendText concurrent production path, anchors=${enabled}`, async t => {
    const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
    const { dir, files: [a, b] } = fixture()
    const engine = new MemoryEngine()
    engine.configLoaded = true
    Object.assign(engine.config, {
      memoryRoot: dir, userMemoryDir: path.join(dir, 'user'),
      memoryAnchorEnabled: enabled, teamEnabled: false, pythonBackendEnabled: false,
    })
    engine._configPath = path.join(process.env.DSH_HOME, 'config.json')
    const store = enabled ? engine.docStore : engine.rawDocStore
    const { gates, start } = pauseReads(t, store, [a, b])
    // Catch immediately: production appendText throws structured write failures.
    const outcome = promise => promise.then(value => ({ value }), error => ({ error }))
    const first = start(outcome(engine.appendText(a, 'engine A')))
    await arrived(gates[0].entered)
    const second = start(outcome(engine.appendText(b, 'engine B')))
    await arrived(gates[1].entered)
    gates[0].resume.resolve()
    const firstResult = await first
    gates[1].resume.resolve()
    const secondResult = await second
    await flushDiagnostics()
    assert.equal(firstResult.error, undefined, String(firstResult.error))
    assert.equal(secondResult.error, undefined, String(secondResult.error))
    assert.ok(fs.readFileSync(a, 'utf8').includes('engine A'))
    assert.ok(fs.readFileSync(b, 'utf8').includes('engine B'))
  })
}
