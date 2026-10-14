import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
function extract(marker) { const start = source.indexOf(marker); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n    }', start) + 6) }
const receipt = extract('    function migrationReceiptPre(result) {')
const pick = extract('    function migPickFilePre(')
const env = { L: (s) => s }
vm.createContext(env); vm.runInContext(receipt, env)
const failure = { ok: false, error: 'write-failed', detail: 'fixture disk error', written: [{ path: 'MEMORY.md' }], backup: '/fixture/backup', cleanupErrors: [{ file: 'PLAN.md', error: 'cleanup fixture' }] }
const summary = env.migrationReceiptPre(failure)
assert.equal(summary.partial, true)
for (const detail of ['已写入 1', 'MEMORY.md', '/fixture/backup', 'fixture disk error', 'cleanup fixture']) assert.ok(summary.text.includes(detail), detail)
assert.ok(!summary.text.includes('[object Object]'))
assert.equal(env.migrationReceiptPre({ ok: true, written: 1, userFilesSkipped: ['CALENDAR.md(error:fixture)'] }).partial, true)
let pos = 0, checked = 0
while ((pos = source.indexOf('function migFail(', pos)) >= 0) {
  const indent = source.slice(source.lastIndexOf('\n', pos) + 1, pos)
  const close = source.indexOf('\n' + indent + '}', pos)
  const end = close + indent.length + 2
  let message = '', result
  const fixture = { L: (s) => s, migrationReceiptPre: env.migrationReceiptPre, setMigResult: (r) => { result = r }, setMigErr: (s) => { message = s } }
  vm.runInNewContext(source.slice(pos, end) + '\nmigFail("import",null,{message:"network",response:response})', { ...fixture, response: failure })
  assert.ok(message.includes('/fixture/backup')); assert.ok(message.includes('MEMORY.md')); assert.equal(result, failure)
  checked++; pos = end
}
assert.equal(checked, 3)
for (const choice of ['cancel', 'file', 'error']) {
  let input, selected = 'original-pack', busy = false, error = ''
  const context = { L: (s) => s, encodeURIComponent, API: { migrateUpload: '/upload' },
    document: { body: { appendChild() {} }, createElement: () => (input = { style: {}, handlers: {}, addEventListener(name, fn) { this.handlers[name] = fn }, click() {}, remove() {} }) },
    fetch: async () => ({ ok: choice !== 'error', json: async () => choice === 'error' ? { error: 'upload unavailable' } : { ok: true, path: '/fixture/verified.dam-pack' } }) }
  vm.createContext(context); vm.runInContext(pick, context)
  context.migPickFilePre((value) => { selected = value }, (value) => { busy = value }, { current: true }, () => {}, (value) => { error = value })
  assert.equal(input.type, 'file'); assert.equal(input.accept, '.dam-pack,.dam-pack.gz')
  if (choice === 'cancel') input.handlers.cancel()
  else { input.files = [{ name: 'fixture.dam-pack' }]; await input.handlers.change() }
  assert.equal(busy, false); assert.equal(selected, choice === 'file' ? '/fixture/verified.dam-pack' : 'original-pack')
  assert.equal(!!error, choice === 'error')
}
console.log('PASS #396/#397 all shipped receipt callbacks and file picker distinguish partial, cancellation and failure')
