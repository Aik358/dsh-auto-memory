import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const start = source.indexOf('    engine.l0IndexSyncTick =')
const end = source.indexOf('    // 资产探测(', start)
assert.ok(start > 0 && end > start)
let work = 0
const engine = { config: { l0IndexEnabled: true }, hasReliableSessionIdentity: () => true,
  syncL0IndexPre: async () => { work++ } }
vm.runInNewContext(source.slice(start, end), { engine })
const result = engine.l0IndexSyncTick({ session: { id: 'fixture' } })
assert.equal(work, 0, 'refresh cannot maintain indexes without a consumer')
assert.equal(result.reason, 'no-recall-consumer')
console.log('PASS #375 automatic L0 maintenance is stopped, including existing enabled configurations')
