import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { apply, MemoryEngine, flushDiagnostics } from '../lib/audit-engine.mjs'
import { createJsSemanticEnginePre, createSemanticDownloaderPre } from '../../lib/semantic-js.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'dam-host-dispose-'))
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(key => [key, process.env[key]]))
const timeout = globalThis.setTimeout, interval = globalThis.setInterval, fetch = globalThis.fetch
const load = MemoryEngine.prototype.loadConfigSync
let engine, cleanup
const workers = []
const delay = ms => new Promise(resolve => timeout(resolve, ms))
async function until(predicate, message = 'resource did not settle') {
  const deadline = Date.now() + 10000
  while (!await predicate()) { assert(Date.now() < deadline, message); await delay(10) }
}
function alive(pid) { try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error } }

try {
  for (const key of Object.keys(savedEnv)) process.env[key] = root
  globalThis.fetch = async () => { throw Error('network forbidden in offline host regression') }
  MemoryEngine.prototype.loadConfigSync = function () { engine = this; return load.call(this) }
  await writeFile(path.join(root, 'dsh-auto-memory.json'), JSON.stringify({ globalBriefEnabled: false, externalSources: {}, memoryRoot: path.join(root, 'memory'), userMemoryDir: path.join(root, 'user') }))
  const peer = path.join(root, 'peer'), models = path.join(root, 'models')
  await mkdir(peer)
  await mkdir(path.join(models, 'multilingual-e5-small', 'onnx'), { recursive: true })
  await writeFile(path.join(models, 'multilingual-e5-small', 'onnx', 'model_quantized.onnx'), 'offline fixture')
  await writeFile(path.join(peer, 'package.json'), JSON.stringify({ name: '@huggingface/transformers', type: 'module', main: './index.js', exports: { '.': './index.js' } }))
  await writeFile(path.join(peer, 'index.js'), `export const env = {}; export async function pipeline() { if(env.allowRemoteModels !== false) throw Error('offline policy missing'); return async () => { const data = new Float32Array(384); data[0] = 1; return {data} } }`)
  for (const phase of ['fetch', 'reader', 'fetch']) {
    const hooks = [], effects = []
    globalThis.setTimeout = globalThis.setInterval = () => ({ unref() {} })
    try {
      apply({ get: () => undefined, on: (event, fn) => { if (event === 'dispose') hooks.push(fn) }, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: fn => effects.push(fn()) }, {})
    } finally { globalThis.setTimeout = timeout; globalThis.setInterval = interval }
    cleanup = () => { for (const fn of hooks) fn(); for (const fn of effects) fn() }
    engine._jsSemantic.dispose()
    const semantic = createJsSemanticEnginePre({ pluginDir: path.join(root, 'plugin'), modelsDirCandidates: [models], peerDirCandidates: [peer] })
    engine._jsSemantic = semantic
    assert((await semantic.rank({ memoryIndexVersion: 'idx_pre_' + 'a'.repeat(32), records: [{ memoryId: 'A', text: 'offline passage' }] }, 'offline query')).scores instanceof Map)
    const pid = semantic.status().workerPid
    workers.push(pid)
    assert(alive(pid))
    let resolveFetch, signal, body, cancelled = 0, pythonCancels = 0
    const bytes = Buffer.from('late model bytes'), destination = path.join(root, 'download-' + workers.length)
    const downloader = createSemanticDownloaderPre({ modelsRoot: destination, manifest: { totalBytes: bytes.length, files: [{ rel: 'model.bin', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }] }, fetchImpl: async (url, options) => {
      signal = options.signal
      if (phase === 'fetch') return new Promise(resolve => { resolveFetch = resolve })
      body = new ReadableStream({ cancel() { cancelled++ } })
      return new Response(body)
    } })
    engine._jsDownload = downloader
    engine._pythonSetup = { cancelDownload() { pythonCancels++ } }
    assert.equal(downloader.start('intl').ok, true)
    await until(() => signal && (phase === 'fetch' ? resolveFetch : body.locked))
    // Start a real MemoryEngine call with a synthetic provider, then dispose
    // through the actual host effect. No model/network request is made.
    engine._workbenchReady = true
    engine._workbenchParent = { session: { id: 'fixture' }, ctx: { get: () => null } }
    engine._readWorkbench = async () => ({ sessionId: 'fixture', epoch: engine._workbenchEpoch(Date.now()), gen: {} })
    engine.bumpGenFor = async () => ({ ok: true })
    let subagentSignal, subagentDisposed = 0
    engine._subagents = { list: () => ['spawn'], start: async (_provider, request) => {
      subagentSignal = request.signal
      return { result: new Promise(resolve => request.signal.addEventListener('abort', () => resolve({ output: [{ type: 'text', text: 'late output' }] }), { once: true })), dispose: async () => { subagentDisposed++ } }
    } }
    const subagent = engine.runSubagent('offline disposal fixture', 'smart-kw', undefined, 1000)
    await until(() => subagentSignal)
    assert.equal(engine._subagentControllers.size, 1)
    cleanup(); cleanup(); cleanup = null
    assert.equal(engine._disposed, true)
    assert.equal(subagentSignal.aborted, true)
    assert.equal(await subagent, '')
    assert.equal(subagentDisposed, 1)
    assert.equal(engine._subagentControllers.size, 0)
    assert.equal(engine._subagentInflight, 0)
    await until(() => !alive(pid), 'semantic worker still alive after host unload')
    assert.equal(signal.aborted, true)
    assert.equal(pythonCancels, 1, 'host cleanup is idempotent')
    if (phase === 'fetch') resolveFetch(new Response(bytes))
    else assert.equal(cancelled, 1)
    await until(() => downloader.state().phase === 'cancelled')
    assert.equal(downloader.start('intl').reason, 'disposed')
    await assert.rejects(access(path.join(destination, 'model.bin')), { code: 'ENOENT' })
    await assert.rejects(semantic.embedQuery('after unload'), /disposed/i)
    console.log(`PASS host unload/reload: worker reaped, Python download cancelled, pending ${phase} cannot publish`)
  }
} finally {
  if (cleanup) cleanup()
  for (const pid of workers) if (alive(pid)) { process.kill(pid, 'SIGKILL'); await until(() => !alive(pid)) }
  globalThis.setTimeout = timeout; globalThis.setInterval = interval; globalThis.fetch = fetch
  MemoryEngine.prototype.loadConfigSync = load
  await flushDiagnostics()
  for (let attempt = 0; ; attempt++) {
    try { await rm(root, { recursive: true, force: true }); break }
    catch (error) { if (attempt === 9) throw error; await delay(100) }
  }
  for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
}
