import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { startRecallHost } from '../lib/pr420-host.mjs'
import { embeddingConfigFilePre, createDefaultEmbeddingConfigPre, updateEmbeddingConfigPre, readEffectiveEmbeddingConfigPre } from '../../lib/embedding-config.js'

async function fixture(override, mode, run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dam-emit-effective-'))
  const previous = process.env.DSH_M7_EMBEDDING_CONFIG
  if (override) process.env.DSH_M7_EMBEDDING_CONFIG = path.join(home, 'custom', 'embedding.json')
  else delete process.env.DSH_M7_EMBEDDING_CONFIG
  const file = readEffectiveEmbeddingConfigPre(home).file
  const host = await startRecallHost(home, { semanticEngineMode: mode })
  try { await run(host, file, home) }
  finally {
    await host.close()
    if (previous === undefined) delete process.env.DSH_M7_EMBEDDING_CONFIG
    else process.env.DSH_M7_EMBEDDING_CONFIG = previous
    await fs.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}
for (const override of [false, true]) await test('emit writes and status reads use the effective file; override=' + override, async () => {
  await fixture(override, 'lexical', async ({ engine, request }, file, home) => {
    const identity = { provider: 'custom-provider', modelDir: '/explicit', onnxFile: 'custom.onnx', dimension: 12 }
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ ...identity, unknown: { keep: 1 }, activationEmitMode: 'shadow' }))
    for (const mode of ['active', 'shadow']) {
      const response = await request('semantic-emit', { mode })
      assert.equal(response.status, 200)
      assert.equal(readEffectiveEmbeddingConfigPre(home).config.activationEmitMode, mode)
      for (const [key, value] of Object.entries(identity)) assert.equal(JSON.parse(await fs.readFile(file))[key], value)
      const status = await request('semantic-status')
      assert.equal(status.data.activationEmitMode, mode)
      engine._jsEmitCache.at = 0
      assert.equal(engine.jsEmitMode(), mode)
    }
    if (override) await assert.rejects(fs.stat(path.join(home, 'memory', 'semantic', 'embedding-config.json')), { code: 'ENOENT' })
    await fs.writeFile(file, '{broken')
    assert.equal((await request('semantic-emit', { mode: 'active' })).status, 500)
    assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  })
})
for (const mode of ['python', 'js']) await test('first emit save initializes the selected engine: ' + mode, async () => {
  await fixture(false, mode, async ({ request }, file, home) => {
    assert.equal((await request('semantic-emit', { mode: 'active' })).status, 200)
    const cfg = readEffectiveEmbeddingConfigPre(home)
    assert.equal(cfg.config.provider, mode === 'python' ? 'bge-m3-onnx-int8-pre-v1' : 'js-e5-small-q8-pre-v1')
    assert.equal(cfg.config.dimension, mode === 'python' ? 1024 : 384)
    if (mode === 'python') assert.equal(cfg.modelPath, path.join(home, 'python-engine', 'models', 'model_int8.onnx'))
    assert.equal(cfg.config.activationEmitMode, 'active')
    const before = await fs.readFile(file, 'utf8')
    await request('semantic-emit', { mode: 'shadow', createOnly: true })
    assert.equal(await fs.readFile(file, 'utf8'), before)
  })
})

await test('emit save reloads the worker mode without a runtime cache', async () => {
  await fixture(false, 'python', async ({ engine, request }, file, home) => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify({ provider: 'hash-pre-v1', activationEmitMode: 'shadow' }))
    const worker = path.join(home, 'waiting-worker.mjs')
    await fs.writeFile(worker, `
import fs from 'node:fs'
import { createInterface } from 'node:readline'
const mode = JSON.parse(fs.readFileSync(${JSON.stringify(file)}, 'utf8')).activationEmitMode
createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line)
  if (req.type !== 'health') return
  process.stdout.write(JSON.stringify({
    protocolVersion: 'm7_wire_pre_v1', frameId: 'f-' + req.requestId,
    requestId: req.requestId, workerEpoch: req.workerEpoch,
    type: 'health_result', payload: { mode }, sentAt: Date.now(),
  }) + '\\n')
})
`)

    engine.config.pythonBackendWorkerPath = worker
    engine.resolvePythonCommandForSpawn = async () => ({ command: process.execPath })
    const client = engine._pythonSidecar
    const initial = await client.request('health', {}, { timeoutMs: 5000 })
    assert.equal(initial.ok, true)
    assert.equal(initial.frame.payload.mode, 'shadow')
    const initialEpoch = client.currentEpoch()
    await fs.writeFile(file, '{broken')
    assert.equal((await request('semantic-emit', { mode: 'active' })).status, 500)
    assert.equal(client.currentEpoch(), initialEpoch, 'a failed save must preserve the worker')
    await fs.writeFile(file, JSON.stringify({ provider: 'hash-pre-v1', activationEmitMode: 'shadow' }))
    for (const mode of ['active', 'shadow', 'canary-explicit', 'active', 'canary-explicit', 'shadow']) {
      const pending = client.request('context_push', {}, { timeoutMs: 10000 })
      const epoch = client.currentEpoch()
      const generation = engine._pyRtGeneration
      assert.equal((await request('semantic-emit', { mode: 'shadow', createOnly: true })).status, 200)
      assert.equal(client.currentEpoch(), epoch, 'createOnly must leave the running worker alone when no file is written')
      assert.equal((await request('semantic-emit', { mode })).status, 200)
      assert.equal(client.isStarted(), false, 'saving a mode must stop the worker that loaded the old mode')
      assert.equal(client.currentEpoch(), null)
      assert.equal((await pending).code, 'restarted')
      assert.equal(engine._pyRtGeneration, generation + 1)
      assert.equal(engine._pyRtCache, null)
      assert.equal(readEffectiveEmbeddingConfigPre(home).config.activationEmitMode, mode)
      const health = await client.request('health', {}, { timeoutMs: 5000 })
      assert.equal(health.ok, true)
      assert.equal(health.frame.payload.mode, mode, 'the replacement worker must load the saved mode')
      assert.notEqual(client.currentEpoch(), epoch)
    }
  })
})

await test('download completion uses the same effective path and selected Python identity', async () => {
  await fixture(true, 'python', async (_, file, home) => {
    const source = (await fs.readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
    const start = source.indexOf('    try {\n      const _dlStart = engine._jsDownload.start.bind')
    const end = source.indexOf('    // ─────────── 三层检索契约', start)
    assert.ok(start > 0 && end > start)
    let tick
    const engine = { config: { semanticEngineMode: 'python' }, _jsDownload: { start: () => ({ ok: true }), state: () => ({ phase: 'done' }) } }
    vm.runInNewContext(source.slice(start, end), { engine, embeddingConfigFilePre, createDefaultEmbeddingConfigPre, updateEmbeddingConfigPre,
      resolveDshHomePre: () => home, diag() {}, setInterval: fn => { tick = fn; return { unref() {} } }, clearInterval() {} })
    engine._jsDownload.start('auto'); tick()
    assert.equal(readEffectiveEmbeddingConfigPre(home).config.provider, 'bge-m3-onnx-int8-pre-v1')
    assert.equal(readEffectiveEmbeddingConfigPre(home).file, file)
    await assert.rejects(fs.stat(path.join(home, 'memory', 'semantic', 'embedding-config.json')), { code: 'ENOENT' })
  })
})
