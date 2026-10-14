import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    function PySetupWizard(props) {')
const body = source.slice(start, source.indexOf('    function OverviewTab(', start))
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const API = { pyStatus: 'status', pyDetect: 'detect', pyConfig: 'config', pyDeps: 'deps', pyModel: 'model', pyUninstall: 'uninstall' }
function harness(initial, failStatus = false) {
  const slots = [], dependencies = [], cleanups = []
  let index = 0, effects = [], timer, current = initial, posts = [], disposed = false, lateUpdates = 0
  const env = { API, Object, Math, String, L: s => s, t: s => s,
    h: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat() }),
    localStorage: { getItem: () => '1', setItem() {} }, window: { confirm: () => true },
    useState: value => { const n = index++; if (!(n in slots)) slots[n] = typeof value === 'function' ? value() : value; return [slots[n], v => { if (disposed) lateUpdates++; slots[n] = typeof v === 'function' ? v(slots[n]) : v }] },
    useRef: value => { const n = index++; if (!(n in slots)) slots[n] = { current: value }; return slots[n] },
    useEffect: (fn, deps) => { const n = index++; if (!dependencies[n] || deps.some((d, i) => dependencies[n][i] !== d)) { dependencies[n] = deps; effects.push(() => { if (cleanups[n]) cleanups[n](); cleanups[n] = fn() }) } },
    setInterval: fn => { timer = fn; return 1 }, clearInterval: () => { timer = null },
    apiGet: async () => { if (failStatus) throw Error('fixture status unavailable'); return current },
    apiPost: async (api, payload) => { posts.push({ api, payload }); return current },
  }
  vm.createContext(env); vm.runInContext(body, env)
  const render = () => { index = 0; effects = []; const tree = env.PySetupWizard({}); effects.forEach(fn => fn()); return tree }
  const nodes = tree => [tree, ...(tree && tree.children || []).filter(c => c && typeof c === 'object').flatMap(nodes)]
  const text = tree => JSON.stringify(tree, (k, v) => typeof v === 'function' ? undefined : v)
  return { render, nodes, text, posts, update: v => { current = v }, recover: () => { failStatus = false }, poll: async () => { if (timer) timer(); await flush() }, close: () => { disposed = true; cleanups.forEach(fn => fn && fn()) }, late: () => lateUpdates }
}
const idle = { phase: 'idle', activeOperation: '', venvOk: true, depsOk: true, modelReady: true, configOk: false, wantGpu: false, pythons: [], dl: {} }
const failed = harness(idle, true)
failed.render(); await flush()
let tree = failed.render()
assert.match(failed.text(tree), /fixture status unavailable/)
assert.ok(failed.nodes(tree).some(n => n.tag === 'button' && n.children.includes('retry')))
failed.recover(); await failed.nodes(tree).find(n => n.tag === 'button').props.onClick(); await flush()
tree = failed.render()
assert.ok(!failed.text(tree).includes('pyWizDone'), 'verified model alone is not all-ready')
const repair = failed.nodes(tree).find(n => n.tag === 'button' && n.children.includes('修复引擎配置'))
assert.ok(repair); repair.props.onClick(); await flush()
assert.equal(failed.posts.at(-1).api, 'config'); assert.ok(!failed.posts.some(p => p.api === 'model'))
tree = failed.render()
const gpu = failed.nodes(tree).find(n => n.tag === 'input' && n.props.type === 'checkbox')
assert.equal(gpu.props.checked, false, 'persisted GPU preference wins over stale browser preference')
gpu.props.onChange({ target: { checked: true } }); tree = failed.render()
failed.nodes(tree).find(n => n.tag === 'button' && n.children.includes('应用 CPU/GPU 选择')).props.onClick(); await flush()
assert.equal(failed.posts.at(-1).api, 'deps'); assert.equal(failed.posts.at(-1).payload.gpu, true)
failed.close(); assert.equal(failed.late(), 0)
const active = harness({ ...idle, phase: 'deps', activeOperation: 'deps' })
active.render(); await flush(); tree = active.render()
assert.equal(active.posts.length, 0, 'reopening an active task does not start detect or install')
assert.ok(active.nodes(tree).filter(n => n.tag === 'button').every(n => n.props.disabled === true))
active.update(idle); await active.poll(); tree = active.render()
assert.equal(active.nodes(tree).find(n => n.children.includes('修复引擎配置')).props.disabled, false)
active.close(); await active.poll(); assert.equal(active.late(), 0)
let cards = 0, pos = 0
while ((pos = source.indexOf("var isJs = guide === 'js'", pos)) >= 0) {
  const end = source.indexOf('var fmtMB', pos)
  const compute = source.slice(pos, end)
  for (const phase of ['downloading', 'ready']) {
    const sem = { loaded: true, pythonInt8Present: true, pythonSetup: { phase, modelReady: phase === 'ready', configOk: false, dl: { bytesDone: 50, bytesTotal: 100 } } }
    const result = vm.runInNewContext('(function(){' + compute + ';return {progress,ready,stateTxt,dlActive}})()', { guide: 'python', sem, L: s => s, t: s => s, Math, Object })
    assert.equal(result.ready, false)
    assert.equal(result.progress, phase === 'ready' ? 100 : 50)
    assert.equal(result.dlActive, phase === 'downloading')
    assert.ok(!result.stateTxt.includes('已就绪'))
  }
  cards++; pos = end
}
assert.equal(cards, 3)
console.log('PASS #381/#408/#409/#410/#411 wizard recovery, task ownership, config-only repair and all three progress cards')
