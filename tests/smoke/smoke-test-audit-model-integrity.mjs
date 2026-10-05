import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createPythonSetupPre } from '../../lib/python-setup.js'

const expectedBytes = 568456694
let failed = 0
async function check(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dam-model-integrity-'))
  const originalFetch = globalThis.fetch
  try { await fn(root); console.log('PASS ' + name) }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message) }
  finally { globalThis.fetch = originalFetch; fs.rmSync(root, { recursive: true, force: true }) }
}
// Sparse fixture tests artifact validation and state transitions, not ONNX inference.
function fixture(target, bytes = expectedBytes, invalidJson = false) {
  if (target.endsWith('.onnx')) {
    const fd = fs.openSync(target, 'w')
    try { fs.ftruncateSync(fd, bytes) } finally { fs.closeSync(fd) }
  } else fs.writeFileSync(target, invalidJson && target.endsWith('.json') ? 'not-json' : target.endsWith('.json') ? '{"fixture":true}' : 'fixture sentencepiece')
}
const configPath = root => path.join(root, 'memory', 'semantic', 'embedding-config.json')

await check('F6 full fetch/stream/rename path rejects cleanly terminated short model responses', async root => {
  const bytes = 101 * 1024 * 1024
  globalThis.fetch = async url => {
    if (!String(url).endsWith('.onnx')) return new Response('not-json')
    let n = 0
    const chunk = new Uint8Array(1024 * 1024)
    return new Response(new ReadableStream({ pull(controller) {
      if (n++ === 101) return controller.close()
      controller.enqueue(chunk)
    } }), { headers: { 'content-length': String(bytes) } })
  }
  const setup = createPythonSetupPre({ dshHome: root })
  const state = await setup.downloadModel()
  assert.equal(state.phase, 'error')
  assert.equal(state.modelReady, false)
  assert.equal(state.configOk, false)
  assert.equal(fs.existsSync(setup.modelPath()), false)
  assert.equal(fs.existsSync(configPath(root)), false)
})

await check('F6 valid-sized sparse artifact with malformed tokenizer JSON never becomes ready', async root => {
  const setup = createPythonSetupPre({ dshHome: root, download: async (_url, target) => fixture(target, expectedBytes, true) })
  const state = await setup.downloadModel()
  assert.equal(state.phase, 'error')
  assert.equal(state.modelReady, false)
  assert.equal(state.configOk, false)
  assert.equal(fs.existsSync(path.join(path.dirname(setup.modelPath()), 'config.json')), false)
  assert.equal(fs.existsSync(configPath(root)), false)
})

await check('F6 mirror retries after integrity failure and publishes config only after all validations', async root => {
  let calls = 0
  const setup = createPythonSetupPre({ dshHome: root, download: async (url, target) => {
    calls++
    fixture(target, url.includes('hf-mirror.com') ? expectedBytes - 1 : expectedBytes)
  } })
  const state = await setup.downloadModel()
  assert.equal(state.phase, 'ready')
  assert.equal(state.modelReady, true)
  assert.equal(state.configOk, true)
  assert.equal(state.modelBytes, expectedBytes)
  assert.equal(state.dl.mirror, 'intl')
  assert.equal(calls, 7, 'one bad model, then a model and five tokenizer files')
  const config = JSON.parse(fs.readFileSync(configPath(root), 'utf8'))
  assert.equal(config.provider, 'bge-m3-onnx-int8-pre-v1')
  assert.equal(config.onnxFile, 'model_int8.onnx')
})

await check('F6 cancellation never publishes successful model/config state', async root => {
  let setup
  setup = createPythonSetupPre({ dshHome: root, download: async (_url, target) => {
    fixture(target); setup.cancelDownload()
  } })
  const state = await setup.downloadModel()
  assert.equal(state.phase, 'idle')
  assert.equal(state.modelReady, false)
  assert.equal(state.configOk, false)
  assert.equal(fs.existsSync(configPath(root)), false)
})
if (failed) process.exitCode = 1
