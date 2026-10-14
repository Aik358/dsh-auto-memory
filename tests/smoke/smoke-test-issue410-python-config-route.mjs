import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
let repaired = 0, detects = 0, probes = 0, response, fail = false
const engine = {
  _pythonSetup: {
    repairConfig: async () => { repaired++; if (fail) throw Error('fixture locked configuration'); return { modelReady: true, configOk: true } },
    detect: async () => { detects++; return { configOk: true } },
  },
  probePythonRuntime: async opts => { assert.equal(opts.withWorker, true); assert.equal(opts.refresh, true); probes++; return { state: 'verified-ok' } },
}
function handler(name) {
  const route = source.indexOf("path: API['" + name + "']", source.indexOf("path: API['py-setup-status']"))
  const start = source.indexOf('handler: async ', route) + 'handler: '.length
  const end = source.indexOf('\n      },', start) + '\n      }'.length
  return vm.runInNewContext('(' + source.slice(start, end) + ')', {
    engine, String, isLoopbackRequest: req => req.loopback !== false,
    writeJson: (_, code, body) => { response = { code, body } },
  })
}
const repair = handler('py-setup-config')
await repair({ loopback: false }, {}); assert.equal(response.code, 403); assert.equal(repaired, 0)
await repair({ method: 'GET' }, {}); assert.equal(response.code, 405); assert.equal(repaired, 0)
await repair({ method: 'POST' }, {}); assert.equal(response.code, 200); assert.equal(repaired, 1)
assert.equal(response.body.configOk, true)
fail = true; await repair({ method: 'POST' }, {}); assert.equal(response.code, 500); assert.match(response.body.error, /locked configuration/)
await handler('py-setup-detect')({ method: 'GET' }, {})
assert.equal(detects, 1); assert.equal(probes, 1); assert.equal(response.body.runtime.state, 'verified-ok')
console.log('PASS #410 configuration-only recovery route and explicit full detection keep method and loopback guards')
