// Issue #325: directory aliases must share a queue before the synchronous lock.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MemoryDocumentStore } from '../../lib/memory-writer.js'
import { parseAnchors, planMigration } from '../../lib/memory-anchor.js'

const seed = '# Before\n- existing\n'
const linkType = process.platform === 'win32' ? 'junction' : 'dir'
const deferred = () => {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
async function bounded(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out: ' + label)), 5000)
    })])
  } finally { clearTimeout(timer) }
}
function pauseFirstRead(t, store) {
  const arrived = deferred(), resume = deferred()
  const read = store._readState.bind(store)
  let held = false
  store._readState = async file => {
    const state = await read(file)
    if (!held) { held = true; arrived.resolve(); await resume.promise }
    return state
  }
  t.after(() => resume.resolve())
  return { arrived, resume }
}
const outcome = promise => promise.then(result => ({ result }), error => ({ error }))
async function aliasedPair(t, firstStore, firstWrite, secondWrite) {
  const barrier = pauseFirstRead(t, firstStore)
  const first = outcome(firstWrite())
  let second, timer, timerReleased = false
  t.after(async () => {
    clearTimeout(timer); barrier.resume.resolve()
    await Promise.allSettled([first, second])
  })
  await bounded(barrier.arrived.promise, 'first read with the document lock held')
  // On the broken queue, the second synchronous lock blocks this callback until
  // its timeout. A shared queue lets the callback release the first transaction.
  timer = setTimeout(() => { timerReleased = true; barrier.resume.resolve() }, 10)
  second = outcome(secondWrite())
  const secondResult = await bounded(second, 'second alias write')
  clearTimeout(timer); barrier.resume.resolve()
  const firstResult = await bounded(first, 'first alias write')
  assert.equal(firstResult.error, undefined, String(firstResult.error))
  assert.equal(secondResult.error, undefined, String(secondResult.error))
  if (firstResult.result && typeof firstResult.result === 'object') {
    assert.equal(firstResult.result.ok, true, JSON.stringify(firstResult.result))
  }
  if (secondResult.result && typeof secondResult.result === 'object') {
    assert.equal(secondResult.result.ok, true, JSON.stringify(secondResult.result))
  }
  assert.equal(timerReleased, true, 'the second alias must not block the first transaction from releasing')
}

async function worker() {
  const [, , , file, label, hold] = process.argv
  const store = new MemoryDocumentStore({ lockTimeoutMs: 3000 })
  const send = message => new Promise((resolve, reject) => {
    process.send(message, error => error ? reject(error) : resolve())
  })
  if (hold === 'hold') {
    const read = store._readState.bind(store)
    let held = false
    store._readState = async file => {
      const state = await read(file)
      if (!held) {
        held = true
        const resume = new Promise(resolve => process.once('message', resolve))
        await send({ event: 'held' })
        await resume
      }
      return state
    }
  }
  await send({ event: 'started' })
  const result = await store.append(file, label)
  await send({ event: 'result', result })
  process.exitCode = result.ok ? 0 : 1
  process.disconnect()
}

if (process.argv[2] === '--worker') {
  await worker()
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-issue325-'))
  const previousHome = process.env.DSH_HOME
  let flushEngineDiagnostics
  process.env.DSH_HOME = path.join(root, 'home')
  fs.mkdirSync(process.env.DSH_HOME)
  after(async () => {
    if (flushEngineDiagnostics) await flushEngineDiagnostics()
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    fs.rmSync(root, { recursive: true, force: true })
  })
  function fixture({ missing = false } = {}) {
    const dir = fs.mkdtempSync(path.join(root, 'case-'))
    const physical = path.join(dir, 'physical')
    fs.mkdirSync(physical)
    const aliases = ['alias-a', 'alias-b'].map(name => path.join(dir, name))
    for (const alias of aliases) fs.symlinkSync(physical, alias, linkType)
    const file = path.join(physical, 'MEMORY.md')
    if (!missing) fs.writeFileSync(file, seed)
    return { dir, physical, file, aliases, targets: aliases.map(alias => path.join(alias, 'MEMORY.md')) }
  }
  const newStore = () => new MemoryDocumentStore({ lockTimeoutMs: 150 })
  const read = file => fs.readFileSync(file, 'utf8')
  const methods = ['appendRaw', 'append', 'replaceRaw', 'replace', 'replaceSingle', 'applyPlan']
  for (const method of methods) {
    for (const order of [[0, 1], [1, 0]]) {
      test(`Store ${method}: two aliases, order ${order.join(' then ')}`, async t => {
        const { file, targets } = fixture()
        const store = newStore()
        const first = () => method === 'applyPlan'
          ? store.applyPlan(targets[order[0]], planMigration(file, seed))
          : store[method](targets[order[0]], 'first record')
        await aliasedPair(t, store, first, () => store.append(targets[order[1]], 'second record'))
        const text = read(file)
        assert.ok(text.includes('second record'))
        assert.ok(text.includes(method === 'applyPlan' ? '- existing' : 'first record'))
      })
    }
  }
  for (const method of ['appendRaw', 'append']) {
    for (const order of [[0, 1], [1, 0]]) {
      test(`two Stores ${method}: two aliases, order ${order.join(' then ')}`, async t => {
        const { file, targets } = fixture()
        const firstStore = newStore(), secondStore = newStore()
        await aliasedPair(t, firstStore,
          () => firstStore[method](targets[order[0]], 'first record'),
          () => secondStore[method](targets[order[1]], 'second record'))
        assert.ok(read(file).includes('first record'))
        assert.ok(read(file).includes('second record'))
      })
    }
    test(`${method}: sequential aliases and physical path control`, async () => {
      const { file, targets } = fixture()
      const store = newStore()
      for (const [index, target] of [...targets, file].entries()) {
        assert.equal((await store[method](target, 'sequential ' + index)).ok, true)
      }
      for (const index of [0, 1, 2]) assert.ok(read(file).includes('sequential ' + index))
    })
  }
  test('missing document under aliased parent shares the creation queue', async t => {
    const { file, targets } = fixture({ missing: true })
    const store = newStore()
    await aliasedPair(t, store, () => store.appendRaw(targets[0], 'first record'),
      () => store.appendRaw(targets[1], 'second record'))
    assert.equal(read(file), 'first record\nsecond record')
  })
  for (const enabled of [false, true]) {
    for (const order of [[0, 1], [1, 0]]) {
      test(`two Engines: production appendText, anchors=${enabled}, order ${order.join(' then ')}`, async t => {
        const { MemoryEngine, flushDiagnostics } = await import('../lib/audit-engine.mjs')
        flushEngineDiagnostics = flushDiagnostics
        const { dir, file, targets } = fixture()
        const engines = [0, 1].map(index => {
          const engine = new MemoryEngine()
          engine.configLoaded = true
          Object.assign(engine.config, { memoryRoot: dir, userMemoryDir: path.join(dir, 'user'),
            memoryAnchorEnabled: enabled, teamEnabled: false, pythonBackendEnabled: false })
          engine._configPath = path.join(dir, 'config-' + index + '.json')
          const store = enabled ? engine.docStore : engine.rawDocStore
          store.lockTimeoutMs = 150
          return engine
        })
        const firstStore = enabled ? engines[0].docStore : engines[0].rawDocStore
        await aliasedPair(t, firstStore,
          () => engines[0].appendText(targets[order[0]], 'engine first'),
          () => engines[1].appendText(targets[order[1]], 'engine second'))
        await flushDiagnostics()
        assert.ok(read(file).includes('engine first'))
        assert.ok(read(file).includes('engine second'))
      })
    }
  }
  test('different physical documents remain parallel across Stores', async t => {
    const firstFixture = fixture(), secondFixture = fixture()
    const firstStore = newStore(), secondStore = newStore()
    const barrier = pauseFirstRead(t, firstStore)
    const first = outcome(firstStore.append(firstFixture.targets[0], 'held first'))
    t.after(async () => { barrier.resume.resolve(); await first })
    await bounded(barrier.arrived.promise, 'first independent document')
    const second = await bounded(secondStore.append(secondFixture.targets[1], 'independent second'), 'independent document')
    assert.equal(second.ok, true, JSON.stringify(second))
    assert.ok(read(secondFixture.file).includes('independent second'))
    barrier.resume.resolve()
    assert.equal((await first).result.ok, true)
  })
  test('canonical queue key preserves the original alias retarget guard', async t => {
    const { dir, file, targets, aliases } = fixture()
    const outside = path.join(dir, 'outside')
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'MEMORY.md'), seed)
    const store = newStore(), barrier = pauseFirstRead(t, store)
    const pending = outcome(store.appendRaw(targets[0], 'must be rejected'))
    t.after(async () => { barrier.resume.resolve(); await pending })
    await bounded(barrier.arrived.promise, 'retarget read')
    fs.unlinkSync(aliases[0]); fs.symlinkSync(outside, aliases[0], linkType)
    barrier.resume.resolve()
    const { result, error } = await pending
    assert.equal(error, undefined, String(error))
    assert.equal(result.ok, false)
    assert.equal(result.fsCode, 'MEMORY_PATH_ESCAPED')
    assert.equal(read(file), seed)
    assert.equal(read(path.join(outside, 'MEMORY.md')), seed)
    assert.deepEqual(fs.readdirSync(outside), ['MEMORY.md'])
  })
  function child(t, file, label, hold = '') {
    const proc = fork(fileURLToPath(import.meta.url), ['--worker', file, label, hold], {
      execArgv: [], silent: true, windowsHide: true,
    })
    const events = new Map(['started', 'held', 'result'].map(name => [name, deferred()]))
    let stderr = ''
    proc.stdout.resume()
    proc.stderr.on('data', chunk => { stderr += chunk })
    proc.on('message', message => events.get(message.event)?.resolve(message))
    const exited = new Promise(resolve => proc.once('exit', (code, signal) => resolve({ code, signal })))
    t.after(async () => { if (proc.exitCode === null && proc.signalCode === null) proc.kill(); await exited })
    return { proc, exited, wait: name => bounded(Promise.race([
      events.get(name).promise,
      exited.then(exit => { throw new Error('child exited before ' + name + ': ' + JSON.stringify(exit) + ' ' + stderr) }),
    ]), 'child ' + name) }
  }
  for (const order of [[0, 1], [1, 0]]) {
    test(`cross-process aliases still use the shared document lock, order ${order.join(' then ')}`, async t => {
      const { file, targets } = fixture()
      const first = child(t, targets[order[0]], 'process first', 'hold')
      await first.wait('held')
      const second = child(t, targets[order[1]], 'process second')
      await second.wait('started')
      first.proc.send({ resume: true })
      const [a, b] = await Promise.all([first.wait('result'), second.wait('result')])
      assert.equal(a.result.ok, true, JSON.stringify(a.result))
      assert.equal(b.result.ok, true, JSON.stringify(b.result))
      assert.equal((await first.exited).code, 0)
      assert.equal((await second.exited).code, 0)
      const text = read(file)
      assert.ok(text.includes('process first'))
      assert.ok(text.includes('process second'))
      assert.equal(parseAnchors(text).records.filter(record => record.kind === 'anchored').length, 2)
    })
  }
}
