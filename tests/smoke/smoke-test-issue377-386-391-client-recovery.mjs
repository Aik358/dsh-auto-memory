import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function apiPost(')
const post = source.slice(start, source.indexOf('    /**', start))
for (const body of [null, 'not-an-object', [], { ok: false, error: 'rejected' }, { ok: true }]) {
  const env = { fetch: async () => ({ ok: true, json: async () => { if (body === null) throw Error('truncated'); return body } }), API: {}, emit() {} }
  vm.createContext(env); vm.runInContext(post, env)
  if (body && body.ok) assert.equal((await env.apiPost('/fixture', {})).ok, true)
  else await assert.rejects(env.apiPost('/fixture', {}), 'unconfirmed saves must fail')
}
const marker = source.indexOf('// 打开即自动检测语义引擎')
const timerStart = source.indexOf('      setTimeout(function () {', marker)
const timer = source.slice(timerStart, source.indexOf('      }, 12000)', timerStart) + '      }, 12000)'.length)
for (const [mode, snooze, expectedPrompt] of [['lexical', 0, false], ['auto', Date.now() + 100000, false], ['auto', 0, true]]) {
  let posts = 0, prompts = 0
  const env = { setTimeout: (fn) => fn(), Date, localStorage: { getItem: () => snooze },
    API: { config: '/config', semanticDeepDetect: '/detect', semanticDownload: '/download' },
    apiGet: async (url) => url === '/config' ? { semanticEngineMode: mode } : { ready: false, recommendation: 'download-model' },
    apiPost: async () => { posts++ }, openDialog: () => { prompts++ } }
  vm.runInNewContext(timer, env); await setImmediate(); await setImmediate()
  assert.equal(posts, 0, 'startup requires an explicit download action')
  assert.equal(prompts > 0, expectedPrompt)
}
let pos = 0, checked = 0
while ((pos = source.indexOf('function openModels() {', pos)) >= 0) {
  const callback = source.slice(pos, source.indexOf('function browseTo(', pos))
  const pending = [], values = []
  const env = { mdlData: { unsupported: true }, modelsRequest: { current: 0 }, settingsAlive: { current: true },
    setMdlOpen() {}, setMdlErr() {}, setMdlLoading() {}, setMdlData: (d) => values.push(d.tag), API: { models: '/models' },
    apiGet: () => new Promise((resolve) => pending.push(resolve)) }
  vm.createContext(env); vm.runInContext(callback, env)
  env.openModels(); env.openModels()
  assert.equal(pending.length, 2, 'reopening refreshes even a failed cached catalog')
  pending[1]({ tag: 'new' }); await setImmediate()
  pending[0]({ tag: 'old' }); await setImmediate()
  assert.deepEqual(values, ['new'], 'late catalogs cannot overwrite refreshed models')
  checked++; pos += callback.length
}
assert.equal(checked, 3)
console.log('PASS #377/#386/#391 startup consent, unconfirmed saves and model catalog recovery')
