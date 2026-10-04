import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildKanbanPre } from '../../lib/wb-sidecar.js'
// Source expressions are identical in LF/CRLF checkouts; normalize only line endings.
const client = (await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n')
function block(start) { const i = client.indexOf(start); assert.ok(i >= 0); const skip = start.includes('wbFullCache') ? client.indexOf('function useCardFull', i) + 20 : i + start.length; const end = client.indexOf('\n    function ', skip); return client.slice(i, end) }
const calls = []
const API = new Proxy({}, { get: (_, key) => String(key) })
const mount = new Function('useState','useEffect','h','t','API','fetch','apiGet', block('    function DebugCenter() {') + '\nreturn DebugCenter()')
mount(initial => [initial, () => {}], effect => effect(), () => null, key => key, API, async (url, opts) => { calls.push({ url, method: opts?.method || 'GET' }); return { status: 200, json: async () => ({}) } }, async url => { calls.push({ url, method: 'GET' }); return {} })
await new Promise(r => setImmediate(r))
assert.equal(calls.length, 1); assert.ok(calls.every(c => c.method === 'GET'))
assert.ok(!calls.some(c => ['greet','reflectAuto','summarize','recall'].includes(c.url)))
const ja = client.match(/"hubScopeCounts": (function[^\n]+),/)
assert.ok(ja); assert.equal(typeof new Function('return (' + ja[1] + ')')()(1,2), 'string')
let state, deps, effects = [], requests = 0, reply = { ok: true, full: 'first full body' }
const getCardFull = new Function('useState','useEffect','currentSessionIdClient','apiGet','API', block('    var wbFullCache = {}') + '\nreturn useCardFull')(
  initial => { if (state === undefined) state = typeof initial === 'function' ? initial() : initial; return [state, value => { state = value }] },
  (effect, next) => { if (JSON.stringify(next) !== JSON.stringify(deps)) { deps = next; effects.push(effect) } },
  () => 'isolated-session', async () => { requests++; return reply }, API)
async function render(card) { let value = getCardFull(card); for (const effect of effects.splice(0)) effect(); await new Promise(r => setImmediate(r)); return getCardFull(card) }
const card = { id: 'one', revision: 'revision1', preview: 'same', fullLen: 15, mtime: 1 }
assert.equal(await render(card), 'first full body')
reply = { ok: true, full: 'second new body' }
assert.equal(await render({ ...card, revision: 'revision2' }), 'second new body')
reply = { ok: false }; await render({ ...card, revision: 'retry' }); await render(null)
reply = { ok: true, full: 'retry success' }; assert.equal(await render({ ...card, revision: 'retry' }), 'retry success')
assert.equal(requests, 4)
const subscriptions = client.match(/      useEffect\(function \(\) \{\n        var changed = function \(\) \{ setNonce\(function \(n\) \{ return n \+ 1 \}\) \}\n        window.addEventListener\('dam-skin-changed', changed\)[\s\S]*?      \}, \[\]\)/g)
assert.equal(subscriptions?.length, 2)
for (const source of subscriptions) {
  const win = new EventTarget(); let nonce = 0, cleanup
  new Function('useEffect','window','setNonce',source)(f => { cleanup = f() },win,f => { nonce = f(nonce) })
  win.dispatchEvent(new Event('dam-skin-changed')); assert.equal(nonce,1)
  cleanup(); win.dispatchEvent(new Event('dam-skin-changed')); assert.equal(nonce,1)
}
const py = client.match(/var pyOk = (.+) && rt.depsOk !== false/)[1]
assert.equal(new Function('rt','return ' + py)({ state: 'verified-ok' }), true)
assert.equal(new Function('rt','return ' + py)({ state: 'missing' }), false)
// Revision changes even when title/preview/mtime/length stay identical.
const source = { id: 'one', title: 'same', body: 'x'.repeat(500) + 'a', tags: [], mtime: 1 }
const older = buildKanbanPre({ entries: [] }, { cards: [source] })
const newer = buildKanbanPre({ entries: [] }, { cards: [{ ...source, body: 'x'.repeat(500) + 'b' }] })
const cardsOf = x => Object.values(x.lanes).flatMap(l => l.cards || l)
assert.notEqual(cardsOf(older)[0].revision, cardsOf(newer)[0].revision)
console.log('PASS F02 F18 F19 F20 F21: debug mount, ja function, cache revision/retry, family events, health predicate')

// Preserve an explicit zero through each real settings onChange callback.
const setters = [...client.matchAll(/onChange: function \(e\) \{ set\('officialHeadroomTokens', ([^\n]+?)\) \}/g)]
assert.equal(setters.length, client.includes('function DamSharedSettings(') ? 1 : 3)
for (const [, expression] of setters) {
 const change = new Function('e', 'return ' + expression)
 assert.equal(change({ target: { value: '0' } }), 0)
 assert.equal(change({ target: { value: '' } }), 65536)
 assert.equal(change({ target: { value: 'invalid' } }), 65536)
}
// Mount only the shared surface effect: skin events must update it without a page view.
const surfaceEffects = [...client.matchAll(/(useEffect\(function \(\) \{\n[^]*?var damWantCss = null[^]*?\}, \[\]\))/g)]
const shared = surfaceEffects.map(m => m[1].slice(m[1].lastIndexOf('useEffect(function () {', m[1].indexOf('var damWantCss')))).filter(s => s.includes('dam-shared-ui-style'))
assert.equal(shared.length, 2)
for (const effect of shared) {
 let cleanup, css = 'legacy-css', ensured = 0
 const win = new EventTarget(), elements = new Map()
 const doc = { getElementById: id => elements.get(id), createElement: () => ({ dataset: {}, remove() { elements.delete(this.id) } }), head: { appendChild(el) { elements.set(el.id, el) } } }
 new Function('useEffect','document','window','damSharedSurfaceCss','damSkinEnsureCss',effect)(f => { cleanup = f() },doc,win,() => css,() => { ensured++ })
 assert.equal(elements.get('dam-shared-ui-style').textContent,'legacy-css')
 css = 'instrument-css';win.dispatchEvent(new Event('dam-skin-changed'))
 assert.equal(elements.get('dam-shared-ui-style').textContent,'instrument-css');assert.equal(ensured,2)
 cleanup();win.dispatchEvent(new Event('dam-skin-changed'));assert.equal(ensured,2)
}
