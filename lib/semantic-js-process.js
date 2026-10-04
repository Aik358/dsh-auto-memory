/**
 * Process-only boundary for JS semantic inference (#156).
 * This module must never import transformers/sharp, even as a fallback.
 */
import { fork } from 'node:child_process'

function boundedText(text) {
  // Preserve one look-ahead character: clean/trim then slice(1200) is not idempotent
  // when character 1200 is a space. The worker owns the final model-input cutoff.
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 1201)
}

function workerError(message, code = 'JS_SEMANTIC_WORKER_FAILED') {
  const error = new Error('js-semantic-engine: ' + message)
  error.code = code
  return error
}

export function createJsSemanticProcessPre(opts = {}) {
  let child = null
  let stopped = false
  let failure = null
  let sequence = 0
  const pending = new Map()
  const timeout = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback

  function references() {
    if (!child) return
    if (pending.size) { child.ref(); if (child.channel) child.channel.ref() }
    else { child.unref(); if (child.channel) child.channel.unref() }
  }

  function stop(error, notify) {
    if (stopped) return
    stopped = true
    failure = error
    process.removeListener('exit', onParentExit)
    process.removeListener('beforeExit', onParentBeforeExit)
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error) }
    pending.clear()
    if (child) {
      try { child.kill('SIGKILL') } catch (_) {}
      references()
    }
    if (notify && typeof opts.onFailure === 'function') {
      try { opts.onFailure(error) } catch (_) {}
    }
  }

  function onParentBeforeExit() {
    // Natural exit can wait for the killed child to be reaped. The exit hook below
    // remains a synchronous fallback for an explicit process.exit().
    stop(workerError('parent exiting', 'JS_SEMANTIC_DISPOSED'), false)
    if (child) {
      child.ref()
      child.once('close', () => child.unref())
    }
  }

  function onParentExit() {
    if (child) { try { child.kill('SIGKILL') } catch (_) {} }
  }

  function request(method, payload, timeoutMs) {
    if (stopped) return Promise.reject(failure)
    if (!child || !child.connected) {
      const error = workerError('worker IPC is disconnected', 'JS_SEMANTIC_WORKER_DISCONNECTED')
      stop(error, true)
      return Promise.reject(error)
    }
    if (pending.size >= 64) return Promise.reject(workerError('worker request queue full', 'JS_SEMANTIC_WORKER_BUSY'))
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => stop(workerError('worker ' + method + ' timed out', 'JS_SEMANTIC_WORKER_TIMEOUT'), true), timeoutMs)
      pending.set(id, { resolve, reject, timer })
      references()
      try {
        child.send({ type: 'request', id, method, payload }, (error) => {
          if (error) stop(workerError('worker IPC send failed: ' + error.message), true)
        })
      } catch (error) { stop(workerError('worker IPC send failed: ' + error.message), true) }
    })
  }

  function spawn() {
    if (child || stopped) return
    try {
      child = fork(new URL('./semantic-js-worker.js', import.meta.url), [], {
        // Do not inherit host --inspect/--eval/loader flags. Advanced IPC preserves Float32Array.
        execArgv: [],
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      })
      child.on('message', (message) => {
        if (stopped || !message || message.type !== 'response') return
        const item = pending.get(message.id)
        if (!item) return
        if (message.ok !== true) {
          stop(workerError(String(message.error && message.error.message || 'worker request failed'),
            String(message.error && message.error.code || 'JS_SEMANTIC_WORKER_FAILED')), true)
          return
        }
        pending.delete(message.id)
        clearTimeout(item.timer)
        references()
        item.resolve(message.result)
      })
      child.on('error', (error) => stop(workerError('worker process error: ' + error.message), true))
      child.on('disconnect', () => stop(workerError('worker IPC disconnected', 'JS_SEMANTIC_WORKER_DISCONNECTED'), true))
      child.on('exit', (code, signal) => stop(workerError('worker exited (code=' + code + ', signal=' + signal + ')'), true))
      process.once('exit', onParentExit)
      process.once('beforeExit', onParentBeforeExit)
      references()
    } catch (error) { stop(workerError('worker spawn failed: ' + error.message), true) }
  }

  const requestMs = timeout(opts.requestTimeoutMs, 120000)
  return {
    model: 'multilingual-e5-small/q8',
    async initialize() {
      spawn()
      return request('init', { pluginDir: opts.pluginDir, modelsDir: opts.modelsDir, peerDirs: opts.peerDirs, localWasmPaths: opts.localWasmPaths },
        timeout(opts.startupTimeoutMs, 120000))
    },
    embedQuery(text) {
      return request('embedQuery', { text: boundedText(text) }, requestMs)
    },
    async embedPassages(texts) {
      if (stopped) throw failure
      const input = Array.isArray(texts) ? texts : []
      const vectors = []
      // Bound IPC payloads and timeouts per batch, including large index rebuilds.
      for (let offset = 0; offset < input.length; offset += 64) {
        const batch = input.slice(offset, offset + 64).map(boundedText)
        const result = await request('embedPassages', { texts: batch }, requestMs)
        if (!Array.isArray(result) || result.length !== batch.length) {
          const error = workerError('worker returned an invalid passage batch')
          stop(error, true)
          throw error
        }
        vectors.push(...result)
      }
      return vectors
    },
    status() { return { pid: child && !stopped ? child.pid : null, pending: pending.size, stopped } },
    dispose() { stop(workerError('engine disposed', 'JS_SEMANTIC_DISPOSED'), false) },
  }
}
