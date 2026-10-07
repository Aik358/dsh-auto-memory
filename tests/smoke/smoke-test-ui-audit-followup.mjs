import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { completeClient } from '../lib/complete-client.mjs'
import { normalizeLayoutConfig } from '../../lib/layout-config.js'

// Execute the entire shipped factory with controlled hooks, timers and HTTP.
// No real host, network, personal memory or browser geometry is exercised.
const source = await fs.readFile(process.env.DAM_CLIENT_AUDIT_SOURCE || new URL('../../lib/client.js', import.meta.url), 'utf8')
const marker = '    return module.exports'
assert.ok(source.includes(marker), 'factory export boundary exists')
const exposedSource = source.replace(marker, `    NotesTab.repairProbe = { RulesEditPanel, ConnectTab, DebugCenter, AutoContinueHost, MemoryPageView,
      regions: applyLayoutRegionsPre, slots: applyLayoutSlotsPre,
      openSession: function (fn) { sessions.open = fn }, SettingsPage,
      migrationNotice: typeof WorkspaceMigrationNotice === 'function' ? WorkspaceMigrationNotice : null }
${marker}`)
const client = async fetch => completeClient({ source: exposedSource, fetch })
const response = data => ({ ok: true, status: 200, json: async () => data })
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const text = node => {
  if (node == null) return ''
  if (Array.isArray(node)) return node.map(text).join(' ')
  if (typeof node !== 'object') return String(node)
  return text(node.props?.children)
}

async function rules() {
  const posts = [], pending = []
  const c = await client(async (url, options) => {
    if (options?.method === 'POST') {
      const d = deferred(); pending.push(d); posts.push(JSON.parse(options.body)); return d.promise
    }
    return response({ path: '/synthetic/USER.md', revision: 'r1', items: [], preview: '' })
  })
  const form = () => {
    const tree = c.render(c.audit.NotesTab.repairProbe.RulesEditPanel)
    return { tree, input: c.nodes(tree, n => n.type === 'textarea')[0], add: c.nodes(tree, n => n.type === 'button').find(n => text(n).includes('添加')) }
  }
  form(); await c.spin()
  let f = form()
  const type = value => { f.input.props.onInput({ target: { value } }); f = form() }
  type('keep draft after rejected request'); f.add.props.onClick(); f = form()
  assert.equal(f.input.props.value, 'keep draft after rejected request', 'draft remains while request is pending')
  // Even a retained handler cannot queue a duplicate request while busy.
  f.add.props.onClick(); assert.equal(posts.length, 1)
  pending.shift().reject(Error('synthetic offline')); await c.spin(); f = form()
  assert.equal(f.input.props.value, 'keep draft after rejected request', 'network failure preserves draft')
  f.add.props.onClick(); pending.shift().resolve(response({ error: 'synthetic revision conflict' })); await c.spin(); f = form()
  assert.equal(f.input.props.value, 'keep draft after rejected request', 'server rejection preserves draft')
  type('first submitted rule'); f.add.props.onClick(); f = form(); type('new unsent rule')
  pending.shift().resolve(response({ path: '/synthetic/USER.md', revision: 'r2', items: [], preview: '', result: 'ok' })); await c.spin(); f = form()
  assert.equal(f.input.props.value, 'new unsent rule', 'late success does not clear newer input')
  f.add.props.onClick(); pending.shift().resolve(response({ path: '/synthetic/USER.md', revision: 'r3', items: [], preview: '', result: 'ok' })); await c.spin(); f = form()
  assert.equal(f.input.props.value, '', 'unchanged successfully submitted draft clears')
  type('ABA draft'); f.add.props.onClick(); f = form(); type('intermediate edit'); type('ABA draft')
  pending.shift().resolve(response({ path: '/synthetic/USER.md', revision: 'r4', items: [], preview: '', result: 'ok' })); await c.spin(); f = form()
  assert.equal(f.input.props.value, 'ABA draft', 'input identity uses edit version even when text returns to submitted value')
  const retainedAdd = f.add.props.onClick
  type('latest owner draft'); retainedAdd()
  assert.equal(posts.at(-1).text, 'latest owner draft', 'retained add handler submits the current owner draft')
  pending.shift().resolve(response({ path: '/synthetic/USER.md', revision: 'r5', items: [], preview: '', result: 'ok' })); await c.spin()
  retainedAdd()
  assert.equal(pending.length, 0, 'retained handler cannot resubmit a successfully cleared draft before rendering')
  f = form(); assert.equal(f.input.props.value, '')
  assert.equal(posts[0].text, 'keep draft after rejected request')
  c.reset()
}

async function connect() {
  const requests = [], sources = [{ id: 'a', name: 'Alpha', tool: 'test', kind: 'markdown' }, { id: 'b', name: 'Beta', tool: 'test', kind: 'markdown' }]
  const c = await client(async url => {
    const u = new URL(url, 'http://fixture.invalid')
    if (u.pathname.endsWith('/external-view')) {
      const d = deferred(); requests.push({ source: u.searchParams.get('source'), ...d }); return d.promise
    }
    return response({ sources })
  })
  const render = () => c.render(c.audit.NotesTab.repairProbe.ConnectTab)
  const views = tree => c.nodes(tree, n => n.type === 'button' && n.props.title === '只读查看该来源的内容')
  const click = (tree, index) => { views(tree)[index].props.onClick(); return render() }
  render(); await c.spin(); let tree = render()
  tree = click(tree, 0); tree = click(tree, 1)
  assert.equal(requests.length, 2)
  requests[0].resolve(response({ content: 'stale Alpha content' })); await c.spin()
  requests[1].resolve(response({ content: 'Beta content' })); await c.spin(); tree = render()
  assert.match(text(tree), /Beta content/)
  tree = click(tree, 0)
  assert.equal(requests.length, 3, 'reopening invalidated Alpha performs a fresh read')
  requests[2].resolve(response({ content: 'fresh Alpha content' })); await c.spin(); tree = render()
  assert.match(text(tree), /fresh Alpha content/)
  assert.doesNotMatch(text(tree), /stale Alpha content/)
  tree = click(tree, 1)
  assert.equal(requests.length, 3, 'merging Alpha does not overwrite previously completed Beta cache')
  assert.match(text(tree), /Beta content/)
  c.reset()

  // Close a pending source, then reopen: old replies cannot finish the new request.
  const pending = []
  const c2 = await client(async url => {
    if (String(url).includes('/external-view')) { const d = deferred(); pending.push(d); return d.promise }
    return response({ sources })
  })
  const render2 = () => c2.render(c2.audit.NotesTab.repairProbe.ConnectTab)
  render2(); await c2.spin(); let t = render2()
  views(t)[0].props.onClick(); t = render2(); views(t)[0].props.onClick(); t = render2(); views(t)[0].props.onClick(); t = render2()
  assert.equal(pending.length, 2, 'closed in-flight preview can be reopened')
  pending[0].resolve(response({ content: 'obsolete completion' })); await c2.spin(); t = render2()
  assert.doesNotMatch(text(t), /obsolete completion/)
  pending[1].reject(Error('synthetic view failure')); await c2.spin(); t = render2()
  assert.match(text(t), /synthetic view failure/)
  views(t)[0].props.onClick(); t = render2(); views(t)[0].props.onClick(); t = render2()
  assert.equal(pending.length, 3, 'reopening failed preview retries')
  c2.reset(); pending[2].resolve(response({ content: 'late unmounted completion' })); await c2.spin()
}

async function layout() {
  const c = await client()
  c.context.localStorage.getItem = key => key === 'dam-skin' ? 'classic' : null
  const api = c.audit.NotesTab.repairProbe
  const tree = c.render(api.MemoryPageView)
  const header = c.nodes(tree, n => n.type === 'header' && n.props['data-dam-region'] === 'page')[0]
  assert.equal(header?.props['data-dam-slot'], 'head', 'actual page header has both production anchors')
  const node = { style: {}, getAttribute: key => header.props[key] ?? null }
  c.context.document.querySelectorAll = () => [node]
  const apply = raw => { const cfg = normalizeLayoutConfig(raw); assert.equal(cfg.ok, true); api.regions(cfg); api.slots(cfg) }
  apply({ regions: { page: { hidden: true, order: 2 } }, slots: { head: { order: 5 } } })
  assert.equal(node.style.display, 'none', 'slot ordering does not reveal hidden region')
  assert.equal(node.style.order, '5', 'explicit slot order retains precedence')
  apply({ regions: { page: { order: 2 } }, slots: { head: { hidden: true } } })
  assert.equal(node.style.display, 'none', 'slot hidden remains effective with visible region')
  assert.equal(node.style.order, '2', 'visibility-only slot preserves region ordering')
  apply({ regions: { page: { hidden: true, order: 2 } } })
  assert.equal(node.style.display, 'none', 'removing slot configuration preserves region hiding')
  assert.equal(node.style.order, '2', 'removing slot configuration restores region ordering')
  apply({})
  assert.equal(node.style.display, '', 'removing both configurations clears owned hiding')
  assert.equal(node.style.order, '', 'removing both configurations clears owned ordering')
  apply({ slots: { head: { order: 7 } } })
  assert.equal(node.style.display, '', 'slot-only ordering keeps default visibility')
  assert.equal(node.style.order, '7')
  c.reset()
}

async function debug() {
  const healthy = { host: { version: 'synthetic-version', pid: 1 }, autoConsolidate: { pendingQueue: 0, stats: {}, consolidating: false }, memoryFiles: { user: {}, notes: {}, log: {} }, subagents: { available: false, providers: [] } }
  for (const failure of ['fetch', 'json']) {
    let calls = 0
    const c = await client(async () => {
      calls++
      if (calls === 1) {
        if (failure === 'fetch') throw Error('synthetic initial offline')
        return { ok: true, status: 200, json: async () => { throw Error('synthetic initial JSON failure') } }
      }
      return response(healthy)
    })
    const render = () => c.render(c.audit.NotesTab.repairProbe.DebugCenter)
    render(); await c.spin(); let tree = render()
    assert.match(text(tree), /synthetic initial/, failure + ' failure renders its cause')
    const retry = c.nodes(tree, n => n.type === 'button')[0]
    assert.ok(retry && !retry.props.disabled, failure + ' failure exposes enabled retry')
    retry.props.onClick(); tree = render()
    assert.equal(c.nodes(tree, n => n.type === 'button')[0].props.disabled, true, 'retry shows busy state')
    await c.spin(); tree = render()
    assert.equal(calls, 2)
    assert.match(text(tree), /synthetic-version/, 'successful retry renders actual diagnostic fields')
    assert.doesNotMatch(text(tree), /synthetic initial/, 'successful retry clears the previous error')
    c.reset()
  }
}

async function autocont() {
  let lastOk = { at: Date.now(), sessionId: 'synthetic-successor-1', fromSid: 'synthetic-source', model: 'synthetic-model' }
  const callbacks = new Map(), opened = []
  let nextId = 0
  const c = await client(async url => {
    if (String(url).endsWith('/config')) return response({ config: { autoContinueEnabled: true, autoContinueThreshold: 0.75 } })
    if (String(url).includes('/auto-continue-state')) return response({ lastOk })
    throw Error('unexpected HTTP ' + url)
  })
  c.context.setInterval = callback => { const id = ++nextId; callbacks.set(id, callback); return id }
  c.context.clearInterval = id => callbacks.delete(id)
  c.audit.session('synthetic-source', '/synthetic/workspace')
  c.audit.NotesTab.repairProbe.openSession(id => opened.push(id))
  const render = () => c.render(c.audit.NotesTab.repairProbe.AutoContinueHost)
  render(); await c.spin(); render(); await c.spin(); let tree = render()
  assert.match(tree.props.status, /已自动接续/)
  assert.deepEqual(opened, ['synthetic-successor-1'], 'production component navigates once to successor')
  tree.props.onDismiss(); assert.equal(render(), null)
  const poll = async () => { for (const callback of [...callbacks.values()]) callback(); await c.spin(); return render() }
  for (let i = 0; i < 3; i++) assert.equal(await poll(), null, 'same completed result stays dismissed on ordinary polls')
  assert.deepEqual(opened, ['synthetic-successor-1'], 'dismissal preserves navigation deduplication')
  lastOk = { ...lastOk, sessionId: 'synthetic-successor-2', at: lastOk.at + 1 }
  tree = await poll(); assert.match(tree.props.status, /已自动接续/, 'new completed continuation is shown')
  assert.deepEqual(opened, ['synthetic-successor-1', 'synthetic-successor-2'], 'distinct successor navigation still runs')
  tree.props.onDismiss(); assert.equal(await poll(), null)
  lastOk = { ...lastOk, at: lastOk.at + 1 }
  tree = await poll(); assert.match(tree.props.status, /已自动接续/, 'new completion timestamp is a distinct result even for same target')
  c.reset(); assert.equal(callbacks.size, 0, 'polling stops after unmount')
}

async function migration() {
  const blocked = { blocked: true, code: 'WORKSPACE_LEGACY_OWNER_REQUIRED', message: 'synthetic ownership recovery required', legacyDir: '/synthetic/original', targetDir: '/synthetic/target' }
  let status = blocked, requests = 0, shouldFail = false
  const c = await client(async url => {
    assert.ok(String(url).includes('/state'), 'notice uses existing state endpoint')
    requests++
    if (shouldFail) throw Error('synthetic recovery status unavailable')
    return response({ workspaceMigration: status })
  })
  c.audit.session('synthetic-session', '/synthetic/workspace')
  const notice = c.audit.NotesTab.repairProbe.migrationNotice
  assert.equal(typeof notice, 'function')
  const render = () => c.render(notice, { nonce: 0 })
  render(); await c.spin(); let tree = render()
  assert.equal(tree.props.role, 'alert')
  for (const expected of [blocked.message, blocked.code, blocked.legacyDir, blocked.targetDir, '.workspace-identity.json', 'schemaVersion: 1', 'workspace:']) assert.ok(text(tree).includes(expected), 'recovery notice shows ' + expected)
  assert.equal(c.nodes(tree, n => n.type === 'button').length, 1, 'one explicit refresh action, no automatic recovery write')
  shouldFail = true
  c.nodes(tree, n => n.type === 'button')[0].props.onClick(); render(); await c.spin(); tree = render()
  assert.match(text(tree), /synthetic recovery status unavailable/)
  assert.match(text(tree), /synthetic ownership recovery required/, 'failed refresh preserves recovery information')
  shouldFail = false; status = null
  c.nodes(tree, n => n.type === 'button')[0].props.onClick(); render(); await c.spin(); tree = render()
  assert.equal(tree, null, 'confirmed recovery removes notice')
  assert.equal(requests, 3)
  c.reset()

  const c2 = await client(async url => response(String(url).includes('/config') ? { config: {} } : {}))
  const api = c2.audit.NotesTab.repairProbe
  c2.context.localStorage.getItem = key => key === 'dam-skin' ? 'classic' : null
  let page = c2.render(api.MemoryPageView)
  assert.equal(c2.nodes(page, n => n.type === api.migrationNotice).length, 1, 'actual MemoryPage mounts notice outside skin body')
  c2.reset()
  c2.render(api.SettingsPage); await c2.spin(); page = c2.render(api.SettingsPage)
  assert.equal(c2.nodes(page, n => n.type === api.migrationNotice).length, 1, 'actual SettingsPage mounts recovery notice')
  c2.reset()

  const waiting = []
  const c3 = await client(async () => { const d = deferred(); waiting.push(d); return d.promise })
  const n3 = c3.audit.NotesTab.repairProbe.migrationNotice
  c3.audit.session('first', '/synthetic/workspace-a'); c3.render(n3)
  c3.audit.session('second', '/synthetic/workspace-b'); c3.render(n3)
  waiting[0].resolve(response({ workspaceMigration: blocked })); await c3.spin()
  assert.equal(c3.render(n3), null, 'late previous-workspace status cannot appear in current workspace')
  waiting[1].resolve(response({ workspaceMigration: null })); await c3.spin()
  assert.equal(c3.render(n3), null)
  c3.reset()
}

const cases = { rules, connect, layout, debug, autocont, migration }
const selected = process.argv.find(arg => arg.startsWith('--case='))?.slice(7)
if (selected) assert.ok(cases[selected], 'unknown case: ' + selected)
for (const [name, run] of Object.entries(cases)) {
  if (selected && selected !== name) continue
  await run()
  console.log('PASS UI audit followup: ' + name)
}
