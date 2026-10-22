import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'

const host = readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
for (const name of ['recall', 'smartRecall']) {
  const marker = host.indexOf('      path: API.' + name + ',')
  const start = host.indexOf('handler: ', marker) + 9, end = host.indexOf('\n      },', start)
  const calls = []
  const engine = { configLoaded: true, _lastAgent: { session: { id: 'B' } },
    resolvePathsForSession: async (sid) => ({ wsBound: sid === 'A', ws: '/fixture/A' }), agentForSessionId: () => null,
    withAgent: (agent, fn) => fn(), recall: async (...args) => { calls.push(args); return 'A result' },
    smartRecall: async (...args) => { calls.push(args); return { answer: 'A result', hits: [] } } }
  const env = { engine, isLoopbackRequest: () => true, panelAllowedHosts: [], forbiddenPanelPayloadPre: (req) => ({ error: 'forbidden: panel-access' }), readJsonBody: async (req) => req.body,
    writeJson: (res, status, body) => Object.assign(res, { status, body }) }
  const handler = new Function(...Object.keys(env), 'return (' + host.slice(start, end) + '\n})')(...Object.values(env))
  for (const sessionId of ['', 'unknown', 'A']) {
    const res = {}; await handler({ method: 'POST', body: { query: 'alpha', sessionId, scope: 'archive' } }, res)
    assert.equal(res.status, sessionId === 'A' ? 200 : 400)
  }
  const agent = calls[0][name === 'recall' ? 2 : 1]
  assert.equal(agent.session.id, 'A'); assert.equal(agent.session.header.cwd, '/fixture/A')
  if (name === 'recall') assert.equal(calls[0][3], 'archive')
}
const source = readFileSync(new URL('../../skins/iter5/native-search.js', import.meta.url), 'utf8')
const boxes = [], payloads = [], copied = []
let cursor = 0
const env = { React: { Fragment: 'fragment' }, L: (s) => s, h: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (value) => { const i = cursor++; if (!boxes[i]) boxes[i] = { value }; return [boxes[i].value, (v) => { boxes[i].value = v }] },
  useRef: (value) => { const i = cursor++; if (!boxes[i]) boxes[i] = { current: value }; return boxes[i] }, useEffect: () => {}, iter5Identity: () => 'A', currentSessionIdClient: () => 'A',
  API: { recall: '/recall', smartRecall: '/smart', file: '/file' }, navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
  apiPost: async (_, payload) => { payloads.push(payload); return { hits: [{ sourcePath: '/fixture/A/archive/MEMORY.md', where: '/fixture/A/MEMORY.md:17 [mem_fixture]', line: 'alpha evidence', mark: '⚠已撤回' }] } },
  apiGet: async (_, params) => { assert.equal(params.sessionId, 'A'); assert.equal(params.path, '/fixture/A/archive/MEMORY.md'); return { path: params.path, content: 'Complete original and later condition' } },
  Iter5Screws() {}, Iter5Icon() {}, Iter5Error() {}, Iter5Empty() {}, Loading() {}, requestAnimationFrame() {} }
vm.createContext(env); vm.runInContext(source, env)
function render() { cursor = 0; return env.Iter5Search({ intent: { query: 'alpha' } }) }
function find(node, match) { if (!node || typeof node !== 'object') return null; if (match(node)) return node; for (const child of (node.children || []).flat(Infinity)) { const result = find(child, match); if (result) return result } return null }
let tree = render()
const scope = find(tree, (n) => n.props['aria-label'] === '检索范围')
assert.ok(scope, 'archive must be reachable from the rendered GUI')
scope.props.onChange({ target: { value: 'archive' } }); tree = render()
find(tree, (n) => n.type === 'form').props.onSubmit({ preventDefault() {} }); await setImmediate()
assert.equal(payloads[0].sessionId, 'A'); assert.equal(payloads[0].scope, 'archive')
tree = render(); find(tree, (n) => n.type === 'button' && n.children.includes('复制当前内容')).props.onClick(); await setImmediate()
assert.match(copied[0], /MEMORY.md:17/); assert.match(copied[0], /⚠已撤回/)
find(tree, (n) => n.type === 'button' && n.children.includes('打开原文')).props.onClick(); await setImmediate(); tree = render()
find(tree, (n) => n.type === 'button' && n.children.includes('复制当前内容')).props.onClick(); await setImmediate()
assert.match(copied[1], /Complete original and later condition/); assert.match(copied[1], /MEMORY.md:17/)
console.log('PASS #379/#403/#406 shipped search routes and rendered GUI preserve scope and copied provenance')
