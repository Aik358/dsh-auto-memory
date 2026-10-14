import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    async function pythonSetupRequestPre(')
let timer, milliseconds, cleared = 0, signal
const context = { API: { pyDetect: 'detect' }, Promise, AbortController, Error,
  setTimeout: (fn, ms) => { timer = fn; milliseconds = ms; return 1 }, clearTimeout: () => { cleared++ } }
vm.createContext(context)
vm.runInContext(source.slice(start, source.indexOf('    async function apiGet', start)), context)
const pending = context.pythonSetupRequestPre('detect', s => { signal = s; return new Promise(() => {}) })
assert.equal(milliseconds, 90000); timer()
await assert.rejects(pending, /timed out/); assert.equal(signal.aborted, true); assert.equal(cleared, 1)
assert.equal(await context.pythonSetupRequestPre('status', async () => 'fixture-complete'), 'fixture-complete')
assert.equal(milliseconds, 30000); assert.equal(cleared, 2)
console.log('PASS #381 hung setup requests end with an attributable timeout and release their timer')
