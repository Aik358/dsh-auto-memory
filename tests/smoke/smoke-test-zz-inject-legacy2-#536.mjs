import { apply, MemoryEngine } from '../lib/state-engine.mjs'
const load = MemoryEngine.prototype.loadConfigSync
globalThis.setInterval = globalThis.setTimeout = () => ({ unref() {} })
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
MemoryEngine.prototype.loadConfigSync = function () { return load.call(this) }
apply({ get: () => undefined, on: () => () => {}, systemPrompt: { context: () => () => {}, section: () => () => {} }, tools: { register: () => () => {} }, webServer: { register: () => () => {} }, effect: (f) => { f() } }, {})
globalThis.setInterval = NOT_DEFINED_LEGACY2
process.exit(0)