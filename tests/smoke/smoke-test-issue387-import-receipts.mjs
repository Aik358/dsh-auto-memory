import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const client = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const fixture = () => {
  const imported = new Set(['local'])
  let fail = true, message = '', error = '', pending
  const sources = ['one', 'two', 'local'].map(id => ({ id, name: id, kind: 'markdown', enabled: true, importedNotes: id === 'local' }))
  sources.push({ id: 'session', kind: 'sessions' }, { id: 'disabled', enabled: false })
  return { imported, sources, ctx: { sources, Promise, API: { externalImport: 'import' }, L: (zh, en) => en, t: x => x,
    apiPost: async (_, body) => { if (body.source === 'two' && fail) throw Error('fixture read failed'); const skipped = imported.has(body.source); imported.add(body.source); return { ok: true, skipped } },
    setMsg: value => { message = value }, setErr: value => { error = value }, load: () => {},
    act: fn => { pending = fn() } },
    get message() { return message }, get error() { return error }, get pending() { return pending }, recover() { fail = false } }
}
const start = client.indexOf('      function importAll() {'), end = client.indexOf('      var cards = []', start)
const classic = fixture(); vm.createContext(classic.ctx); vm.runInContext(client.slice(start, end) + '\nthis.run=importAll;', classic.ctx)
await classic.ctx.run(); assert.equal(classic.message, 'Added / skipped / failed: 1 / 1 / 1'); assert.match(classic.error, /two: fixture read failed/)
classic.recover(); await classic.ctx.run(); assert.equal(classic.message, 'Added / skipped / failed: 1 / 2 / 0'); assert.equal(classic.error, '')
await classic.ctx.run(); assert.equal(classic.message, 'Added / skipped / failed: 0 / 3 / 0')
assert.deepEqual([...classic.imported].sort(), ['local', 'one', 'two'])
for (const file of ['../../skins/legacy/iter5-325.js.frozen', '../../skins/iter5/views.js']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const begin = source.indexOf('act(async function(){var rows=sources.filter(')
  assert.ok(begin >= 0, file)
  const finish = source.indexOf(')}},L(\'接入全部可用来源\'', begin)
  assert.ok(finish > begin, file)
  const action = source.slice(begin, finish + 1)
  const f = fixture(); vm.createContext(f.ctx); vm.runInContext('this.run=function(){' + action + '}', f.ctx)
  f.ctx.run(); let result = await f.pending; assert.match(result.result, /1 \/ 1 \/ 1/); assert.equal(result.partial, true)
  f.recover(); f.ctx.run(); result = await f.pending; assert.match(result.result, /1 \/ 2 \/ 0/); assert.equal(result.partial, false)
  f.ctx.run(); result = await f.pending; assert.match(result.result, /0 \/ 3 \/ 0/)
  assert.deepEqual([...f.imported].sort(), ['local', 'one', 'two'])
}
assert.ok(!client.includes('Import copies memory passages.'))
console.log('PASS #387 three source UIs count added/skipped/failed, retain partial failure and retry idempotently; copy explains links')
