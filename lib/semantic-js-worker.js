/**
 * JS semantic inference process. Never import this file into the DSH host.
 * A worker_thread shares native DLLs with its parent; a forked process does not.
 * All model loading and inference stay local. No prompts are written to disk.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// ★批次 G（#207·4，审计 §G2）：把 onnxruntime-web 的 .wasm 路径固定到本包 dist。
//   transformers v3 在 Node 下也会把 env.backends.onnx.wasm.wasmPaths 指到 jsDelivr CDN
//   （实测 3.8.1 = https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/），
//   Node/离线环境取不到 ⇒ 一旦走到 wasm 后端即初始化失败。本地化后离线可用。
import { applyLocalWasmPathsPre } from './wasm-paths.js'

const MODEL = 'multilingual-e5-small'
let extractor = null
let queue = Promise.resolve()

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1200)
}

async function importPeerTransformers(pluginDir, peerDirs) {
  const entries = new Set()
  // Resolve without evaluating in the host; execute the resolved Node entry here.
  try {
    entries.add(createRequire(path.join(pluginDir, 'noop.js')).resolve('@huggingface/transformers'))
  } catch (_) {}
  for (const dir of Array.isArray(peerDirs) ? peerDirs : []) {
    try {
      const pkgPath = path.join(dir, 'package.json')
      if (!existsSync(pkgPath)) continue
      try { entries.add(createRequire(pkgPath).resolve('@huggingface/transformers')) } catch (_) {}
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      const entry = path.resolve(dir, String(pkg.main || 'dist/transformers.js'))
      if (existsSync(entry)) entries.add(entry)
    } catch (_) {}
  }
  let loadError = null
  for (const entry of entries) {
    try {
      const imported = await import(pathToFileURL(entry).href)
      const mod = typeof imported.pipeline === 'function' ? imported : imported.default
      if (!mod || typeof mod.pipeline !== 'function' || !mod.env) throw new Error('invalid transformers exports')
      return { mod, entry }
    } catch (error) { loadError = error }
  }
  const error = new Error(loadError
    ? 'js-semantic-engine: optional peer load failed: ' + String(loadError.message || loadError)
    : 'js-semantic-engine: optional peer @huggingface/transformers not installed; tier stays disabled')
  error.code = loadError ? 'JS_SEMANTIC_PEER_LOAD_FAILED' : 'JS_SEMANTIC_PEER_MISSING'
  throw error
}

async function embed(prefix, text) {
  if (!extractor) throw new Error('js-semantic-engine: worker not initialized')
  const result = await extractor(prefix + clean(text), { pooling: 'mean', normalize: true, truncation: true })
  const vector = Float32Array.from(result.data)
  if (vector.length !== 384 || !vector.every(Number.isFinite)) {
    throw new Error('js-semantic-engine: invalid embedding vector (expected 384 finite values)')
  }
  return vector
}

async function handle(method, payload) {
  if (method === 'init') {
    if (extractor) throw new Error('js-semantic-engine: worker already initialized')
    const { mod: peer, entry } = await importPeerTransformers(payload.pluginDir, payload.peerDirs)
    const { pipeline, env } = peer
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = payload.modelsDir
    // ★批次 G（#207·4）：wasm 资产本地化（开关 localWasmPaths: auto|off，默认 auto=本地有资产才改）。
    const wasm = applyLocalWasmPathsPre(env, path.dirname(entry), payload.localWasmPaths)
    if (!wasm.applied && wasm.reason && wasm.reason !== 'no-local-wasm') {
      console.error('[dsh-auto-memory] semantic wasm paths not localized: ' + wasm.reason)
    }
    extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
    const probe = await embed('query: ', 'semantic self-test 探针')
    let sum = 0
    for (const value of probe) sum += value * value
    const norm = Math.sqrt(sum)
    if (!(norm > 0.9 && norm < 1.1)) {
      throw new Error('js-semantic-engine: self-test degenerate output (norm=' + norm.toFixed(3) + ')')
    }
    return { model: MODEL + '/q8', pid: process.pid }
  }
  if (method === 'embedQuery') return embed('query: ', payload.text)
  if (method === 'embedPassages') {
    if (!Array.isArray(payload.texts) || payload.texts.length > 64) throw new Error('js-semantic-engine: invalid passage batch')
    const vectors = []
    for (const text of payload.texts) vectors.push(await embed('passage: ', text))
    return vectors
  }
  throw new Error('js-semantic-engine: unknown worker method')
}

function reply(message) {
  if (!process.connected || typeof process.send !== 'function') return
  try { process.send(message, (error) => { if (error) process.exit(1) }) } catch (_) { process.exit(1) }
}

process.on('disconnect', () => process.exit(0))
process.on('message', (message) => {
  if (!message || message.type !== 'request' || !Number.isSafeInteger(message.id) || message.id < 1) return
  // One ONNX pipeline, serialized work; IDs preserve concurrent caller correlation.
  queue = queue.then(async () => {
    try {
      const result = await handle(message.method, message.payload || {})
      reply({ type: 'response', id: message.id, ok: true, result })
    } catch (error) {
      reply({ type: 'response', id: message.id, ok: false,
        error: { message: String(error && error.message || error).slice(0, 4000), code: String(error && error.code || '') } })
    }
  })
})
