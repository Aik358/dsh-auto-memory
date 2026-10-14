import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import vm from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import { startRecallHost, writeRecallFixture } from '../lib/pr420-host.mjs'

const root = await fs.mkdtemp(path.join(tmpdir(), 'dam-420-http-'))
let host
try {
  host = await startRecallHost(root, { semanticEngineMode: 'python' })
  const { engine, agent, paths } = host
  const ids = await writeRecallFixture(host)
  let pyCalls = 0, jsCalls = 0, lastCorpus
  // Replace only inference. The HTTP route, recall, mode selector and JS gate are production code.
  engine._pySemanticRank = async corpus => { pyCalls++; lastCorpus = corpus; return { scores: new Map([[ids.Workspace, 0.9]]) } }
  engine._jsSemantic.rank = async () => { jsCalls++; return { scores: new Map([[ids.Workspace, 0.9]]) } }
  const body = { query: 'nonlexical-fixture-query', scope: 'current', sessionId: agent.session.id }
  let response = await host.request('recall', body)
  assert.equal(response.status, 200)
  assert.equal(pyCalls, 1, 'HTTP full recall must use the production Python-first selector')
  assert.equal(jsCalls, 0)
  assert.match(response.data.result, new RegExp(ids.Workspace))
  assert.equal(lastCorpus.pyPaths.ws, paths.ws)
  const fullIds = lastCorpus.records.map(record => record.memoryId).sort()
  await engine.recall(body.query, 8, agent, 'current', { format: 'l0' })
  assert.deepEqual(lastCorpus.records.map(record => record.memoryId).sort(), fullIds, 'full and L0 authorize the same local corpus')

  const hit = response.data.hits.find(hit => hit.memoryId === ids.Workspace)
  assert.equal(hit.sourcePath, paths.notesPath)
  assert.equal(hit.status, 'retracted'); assert.ok(hit.mark)
  assert.ok(hit.lineStart > 0 && hit.lineEnd >= hit.lineStart, 'semantic hits retain original body coordinates')
  const source = await fs.readFile(new URL('../../skins/iter5/native-search.js', import.meta.url), 'utf8')
  const start = source.indexOf('    function iter5SearchEntries('), end = source.indexOf('    function Iter5Search(', start)
  const entries = vm.runInNewContext(source.slice(start, end) + '\niter5SearchEntries', { L: text => text })(response.data, 'recall')
  assert.ok(entries.some(entry => entry.sourcePath === paths.notesPath), 'actual pure semantic response exposes its source to the shared skin parser')
  const original = await host.request('file', null, '?sessionId=' + agent.session.id + '&path=' + encodeURIComponent(hit.sourcePath))
  assert.equal(original.status, 200); assert.match(original.data.content, /Original body/)
  const client = await fs.readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
  assert.match(client, /setResult\(d\)/, 'classic search retains the structured response')
  assert.match(client, /response: result, mode: 'recall'/)
  const legacy = await fs.readFile(new URL('../../skins/legacy/iter5-325.js.frozen', import.meta.url), 'utf8')
  assert.match(legacy, /SearchSourceActionsPre,\{response:result\[0\]/, 'legacy search shares source actions')
  assert.match(source, /chosen\.sourcePath/, 'variant search consumes the same structured source')

  // Render the shipped source actions with the actual HTTP response, then follow
  // their click through the real file route. Shared variants use Iter5Search.
  const semanticResponse = response.data
  function find(node, match) {
    if (!node || typeof node !== 'object') return null
    if (match(node)) return node
    for (const child of (node.children || []).flat(Infinity)) { const result = find(child, match); if (result) return result }
    return null
  }
  function uiContext() {
    const boxes = []
    let cursor = 0, fileRead
    const env = { React: { Fragment: 'fragment' }, L: text => text, t: key => key,
      h: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: value => { const i = cursor++; if (!boxes[i]) boxes[i] = { value }; return [boxes[i].value, v => { boxes[i].value = v }] },
      useRef: value => { const i = cursor++; if (!boxes[i]) boxes[i] = { current: value }; return boxes[i] }, useEffect() {},
      iter5Identity: () => 'fixture', currentSessionIdClient: () => agent.session.id, currentWs: () => paths.ws,
      API: { recall: '/recall', smartRecall: '/smart', file: '/file' }, navigator: { clipboard: { writeText: async () => {} } },
      apiPost: async () => semanticResponse, apiGet: (_, params) => (fileRead = host.request('file', null,
        '?sessionId=' + params.sessionId + '&path=' + encodeURIComponent(params.path)).then(response => {
          assert.equal(response.status, 200); assert.equal(params.path, paths.notesPath); return response.data
        })),
      Iter5Screws() {}, Iter5Icon() {}, Iter5Error() {}, Iter5Empty() {}, Loading() {}, Card() {}, requestAnimationFrame() {} }
    vm.createContext(env)
    vm.runInContext(source, env)
    return { env, render: action => { cursor = 0; return action() }, fileRead: () => fileRead }
  }
  for (const skin of ['instrument', 'editorial', 'water']) {
    const ui = uiContext()
    let tree = ui.render(() => ui.env.Iter5Search({ intent: { query: body.query }, variant: skin }))
    find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await setImmediate()
    tree = ui.render(() => ui.env.Iter5Search({ variant: skin }))
    const button = find(tree, node => node.type === 'button' && node.children.includes('打开原文'))
    assert.ok(button, skin + ' renders an original-source button for a pure semantic response')
    button.props.onClick(); await ui.fileRead(); await setImmediate()
    tree = ui.render(() => ui.env.Iter5Search({ variant: skin }))
    assert.ok(find(tree, node => typeof node.props.text === 'string' && node.props.text.includes('Original body')))
  }
  for (const skin of ['classic', 'legacy']) {
    const ui = uiContext()
    const actionsStart = client.indexOf('    function SearchSourceActionsPre(')
    const actionsEnd = client.indexOf('    function SearchTab(', actionsStart)
    vm.runInContext(client.slice(actionsStart, actionsEnd), ui.env)
    const tree = ui.render(() => ui.env.SearchSourceActionsPre({ response: semanticResponse, mode: 'recall' }))
    const button = find(tree, node => node.type === 'button' && node.children.some(child => String(child).startsWith('打开原文：')))
    assert.ok(button, skin + ' exposes the same structured source')
    button.props.onClick(); await ui.fileRead()
  }

  engine.config.semanticEngineMode = 'auto'
  pyCalls = jsCalls = 0
  response = await host.request('recall', body)
  assert.equal(pyCalls, 1); assert.equal(jsCalls, 0, 'auto full recall prefers Python')
  engine._pySemanticRank = async () => null
  engine.semanticAssetProbe = async () => ({ ready: true, filesReady: true })
  response = await host.request('recall', body)
  assert.equal(jsCalls, 1, 'HTTP uses healthy C2 when Python cannot rank')
  engine.config.semanticEngineMode = 'lexical'
  pyCalls = jsCalls = 0
  response = await host.request('recall', body)
  assert.equal(pyCalls + jsCalls, 0)
  assert.deepEqual(response.data.hits, [])
  await engine.recall(body.query, 8, agent, 'archive', { format: 'full' })
  await engine.recall(body.query, 8, agent, 'sessions', { format: 'full' })
  assert.equal(pyCalls + jsCalls, 0, 'archive and sessions never enter the local semantic arm')
  assert.equal((await host.request('recall', { ...body, sessionId: 'unknown' })).status, 400)
  console.log('PASS PR420 HTTP full/L0 selector, lexical/scope gates and actual semantic source actions across skins')
} finally {
  if (host) await host.close()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
