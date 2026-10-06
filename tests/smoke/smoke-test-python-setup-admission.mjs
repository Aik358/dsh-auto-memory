import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { mkdtemp, writeFile, readFile, mkdir, access, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PassThrough } from 'node:stream'

const root = await mkdtemp(path.join(os.tmpdir(), 'dam-python-admission-'))
const keys = ['HOME', 'USERPROFILE', 'DSH_HOME']
const savedEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]))
for (const key of keys) process.env[key] = root
const originalExec = childProcess.execFile, originalFetch = globalThis.fetch
const childCalls = []
let releaseChild
let rejectPip = false
const childGate = new Promise(resolve => { releaseChild = resolve })
const marker = path.join(root, 'safe-child.txt')
// Exercise the production child-process boundary without running Python or pip.
// The replacement runs an actual Node child and creates only temporary fixtures.
childProcess.execFile = (file, args, options, callback) => {
  childCalls.push({ file, args })
  if (rejectPip && args[1] === 'pip') {
    setImmediate(() => callback(Object.assign(new Error('safe pip failure'), { stderr: 'fixture dependency failure' })))
    return { kill() { throw Error('setup must not be killed') } }
  }
  childGate.then(() => {
    const target = args[1] === 'venv'
      ? path.join(args[2], process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python') : marker
    originalExec(process.execPath, ['-e', 'const fs=require("fs"),p=require("path");fs.mkdirSync(p.dirname(process.argv[1]),{recursive:true});fs.writeFileSync(process.argv[1],"safe-child")', target], options, callback)
  })
  return { kill() { throw Error('admitted setup must not be killed') } }
}
syncBuiltinESMExports()
globalThis.fetch = async () => { throw Error('offline regression') }
const { apply, MemoryEngine, API, flushDiagnostics } = await import('../lib/audit-engine.mjs')
const { createPythonSetupPre } = await import('../../lib/python-setup.js')
const load = MemoryEngine.prototype.loadConfigSync
let engine
MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
const effects = [], routes = new Map()
const noop = () => () => {}
const ctx = {
  get: () => undefined, on: noop, effect: fn => effects.push(fn()),
  systemPrompt: { context: noop, section: noop }, tools: { register: noop },
  webServer: { register: route => { routes.set(route.path, route); return () => routes.delete(route.path) } },
}
const request = () => {
  const req = new PassThrough()
  req.method = 'POST'; req.socket = { remoteAddress: '127.0.0.1' }; req.headers = { host: '127.0.0.1:8080' }
  return req
}
const response = () => ({ writeHead(status) { this.status = status }, end(body) { this.body = JSON.parse(body) } })
try {
  await writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ globalBriefEnabled: false, externalSources: {}, memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user') }))
  apply(ctx, {})
  const retained = new Map(routes)
  const venvReq = request(), depsReq = request(), venvRes = response(), depsRes = response()
  const venvFlight = retained.get(API['py-setup-venv']).handler(venvReq, venvRes)
  const depsFlight = retained.get(API['py-setup-deps']).handler(depsReq, depsRes)
  await new Promise(resolve => setImmediate(resolve))
  for (const cleanup of effects) cleanup()
  assert.equal(engine._disposed, true)
  releaseChild() // A negative control must settle and fail assertions, not hang.
  venvReq.end(JSON.stringify({ python: 'safe-fixture-python' })); depsReq.end(JSON.stringify({ gpu: true }))
  await Promise.all([venvFlight, depsFlight])
  for (const res of [venvRes, depsRes]) {
    assert.equal(res.status, 500)
    assert.equal(res.body.error, 'plugin disposed')
  }
  assert.equal(childCalls.length, 0, 'late bodies cannot start venv or pip')
  assert.equal(existsSync(path.join(root, 'python-engine')), false, 'late admission cannot mkdir')
  // Retained callbacks are also unable to download, detect, or delete after unload.
  const sentinel = path.join(root, 'python-engine', 'keep.txt')
  await mkdir(path.dirname(sentinel), { recursive: true }); await writeFile(sentinel, 'preserved')
  for (const name of ['py-setup-detect', 'py-setup-model', 'py-setup-uninstall']) {
    const req = request(), res = response(); req.end('{}')
    await retained.get(API[name]).handler(req, res)
    assert.equal(res.status, 500, name)
    assert.equal(res.body.error, 'plugin disposed', name)
  }
  assert.equal(childCalls.length, 0)
  assert.equal(await readFile(sentinel, 'utf8'), 'preserved')
  console.log('PASS real host late-body and retained Python routes refuse all new side effects')

  let live = true
  const setup = createPythonSetupPre({ dshHome: path.join(root, 'admitted'), isLive: () => live })
  const admitted = setup.ensureVenv('safe-fixture-python')
  assert.equal(childCalls.length, 1, 'live setup reaches real child-process boundary')
  live = false
  releaseChild()
  const result = await admitted
  assert.equal(result.venvOk, true, 'already admitted venv settles normally after unload')
  assert.equal(result.phase, 'idle')
  await access(setup.venvPython())
  for (const run of [() => setup.detect(), () => setup.ensureVenv('other'), () => setup.ensureDeps({}), () => setup.downloadModel()]) {
    await assert.rejects(run, { code: 'PLUGIN_DISPOSED' })
  }
  assert.throws(() => setup.uninstall(), { code: 'PLUGIN_DISPOSED' })
  assert.equal(childCalls.length, 1)
  assert.doesNotThrow(() => setup.cancelDownload(), 'unload cleanup remains available')
  await access(setup.venvPython())
  console.log('PASS admitted child work settles; subsequent operations refuse; cleanup remains callable')

  // Keep the existing successful and failed pip transaction contracts. A new
  // owner may reuse the venv, and an admitted pip is not killed during unload.
  live = true
  const next = createPythonSetupPre({ dshHome: path.join(root, 'admitted'), isLive: () => live })
  await next.ensureVenv('safe-fixture-python')
  const pipFlight = next.ensureDeps({ gpu: true })
  live = false
  const pipResult = await pipFlight
  assert.equal(pipResult.phase, 'idle'); assert.equal(pipResult.depsOk, true)
  assert.equal(JSON.parse(await readFile(path.join(root, 'admitted/memory/semantic/embedding-config.json'), 'utf8')).gpu, true)
  assert.equal(await readFile(marker, 'utf8'), 'safe-child')
  live = true; rejectPip = true
  const failed = await next.ensureDeps({})
  assert.equal(failed.phase, 'error'); assert.equal(failed.depsOk, false)
  assert.match(failed.error, /fixture dependency failure/)
  assert.deepEqual(childCalls.slice(-2).map(call => call.args.slice(-2)), [['transformers', 'onnxruntime'], ['-i', 'https://pypi.tuna.tsinghua.edu.cn/simple']])
  console.log('PASS admitted pip settles and failed pip retains fallback and error reporting')
} finally {
  releaseChild()
  for (const cleanup of effects) cleanup()
  MemoryEngine.prototype.loadConfigSync = load
  childProcess.execFile = originalExec; syncBuiltinESMExports(); globalThis.fetch = originalFetch
  await flushDiagnostics()
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
