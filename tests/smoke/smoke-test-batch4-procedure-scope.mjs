import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(path.join(tmpdir(), 'dam-batch4-procedure-'))
const home = path.join(dir, 'profile')
const workspace = path.join(dir, 'workspace-a')
const secondWorkspace = path.join(dir, 'workspace-b')
const originalHome = process.env.DSH_HOME
const originalFetch = globalThis.fetch
const globalFile = path.join(home, 'memory', 'hub', 'procedures.json')
const keyOf = ws => '--' + ws.replace(/[\\/:*?"<>|]/g, '-') + '--'
const workspaceFile = ws => path.join(home, 'memory', 'workspaces', keyOf(ws), 'hub', 'procedures.json')
const rows = filename => JSON.parse(readFileSync(filename, 'utf8')).procedures
const agent = (id, ws) => ({ session: { id, header: { cwd: ws } } })
const success = /已写入|已并入/
let pass = 0
function check(label, fn) {
  fn()
  pass++
  console.log('PASS ' + label)
}

try {
  for (const folder of [home, workspace, secondWorkspace]) mkdirSync(folder, { recursive: true })
  process.env.DSH_HOME = home
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) })
  const config = {
    memoryRoot: path.join(dir, 'project-memory'), userMemoryDir: path.join(dir, 'user-memory'),
    externalSources: {},
  }
  writeFileSync(path.join(home, 'dsh-auto-memory.json'), JSON.stringify(config))
  const source = process.env.DAM_BATCH4_PROCEDURE_MODULE
  const { apply } = await import(source ? pathToFileURL(source).href : '../../lib/index.js')
  const tools = new Map()
  apply({
    get() {}, on() { return () => {} }, effect() { return () => {} },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register(tool) { tools.set(tool.name, tool); return () => {} } },
    webServer: { register() { return () => {} } },
  }, {})
  const writer = tools.get('memory_procedure')
  const reader = tools.get('memory_procedure_list')
  check('registered writer accepts workspace and global', () => {
    assert.deepEqual(writer.parameters.properties.scope.enum, ['workspace', 'global'])
  })
  const a = agent('fixture-a', workspace)
  const b = agent('fixture-b', secondWorkspace)
  const same = { title: 'Scoped fixture procedure', steps: 'Run the fixture', successCriteria: 'Fixture passed' }
  const write = (args, boundAgent) => writer.execute({ action: 'write', ...args }, { agent: boundAgent })
  const global = await write({ ...same, scope: 'global' })
  const omitted = await write({ ...same, title: 'Default fixture procedure' })
  check('explicit and omitted scope are durable global rows', () => {
    assert.match(String(global), success)
    assert.match(String(omitted), success)
    assert.deepEqual(rows(globalFile).map(p => [p.title, p.scope]), [[same.title, 'global'], ['Default fixture procedure', 'global']])
  })
  const globalBytes = readFileSync(globalFile)
  const first = await write({ ...same, scope: 'workspace' }, a)
  check('workspace routes to its own file and keeps identical global content', () => {
    assert.match(String(first), /已写入/)
    assert.ok(existsSync(workspaceFile(workspace)), 'workspace file missing')
    assert.equal(rows(workspaceFile(workspace))[0].workspaceRef, keyOf(workspace))
    assert.equal(rows(workspaceFile(workspace))[0].scope, 'workspace')
    assert.notEqual(rows(workspaceFile(workspace))[0].procedureId, rows(globalFile)[0].procedureId)
    assert.deepEqual(readFileSync(globalFile), globalBytes)
  })
  const again = await write({ ...same, scope: 'workspace' }, a)
  const conflicting = await write({ ...same, steps: 'Use a different workflow', scope: 'workspace' }, a)
  check('within one library exact repeats merge and different same-title writes are rejected', () => {
    assert.match(String(again), /已并入/)
    assert.match(String(conflicting), /疑似重复/)
    assert.equal(rows(workspaceFile(workspace)).length, 1)
  })
  const second = await write({ ...same, scope: 'workspace' }, b)
  check('a saved foreign row does not block writing in a second workspace', () => {
    assert.match(String(second), /已写入/)
    assert.equal(rows(workspaceFile(secondWorkspace)).length, 1)
    assert.notEqual(rows(workspaceFile(workspace))[0].procedureId, rows(workspaceFile(secondWorkspace))[0].procedureId)
    assert.deepEqual(readFileSync(globalFile), globalBytes)
  })
  const merged = String(await reader.execute({ scope: 'all', query: same.title }, { agent: a }))
  check('same-title rows survive real merged read and foreign workspace stays hidden', () => {
    const ids = [...merged.matchAll(/id=(proc_pre_[a-f0-9]{11})/g)].map(x => x[1]).sort()
    assert.deepEqual(ids, [rows(globalFile)[0].procedureId.slice(0, 20), rows(workspaceFile(workspace))[0].procedureId.slice(0, 20)].sort())
  })
  const [left, right] = await Promise.all([
    write({ ...same, title: 'Parallel fixture procedure', scope: 'workspace' }, a),
    write({ ...same, title: 'Parallel fixture procedure', scope: 'workspace' }, b),
  ])
  check('concurrent tools bind writes to the calling sessions', () => {
    assert.match(String(left), /已写入/)
    assert.match(String(right), /已写入/)
    for (const target of [workspace, secondWorkspace]) {
      const latest = rows(workspaceFile(target)).filter(p => p.title === 'Parallel fixture procedure')
      assert.equal(latest.length, 1)
      assert.equal(latest[0].workspaceRef, keyOf(target))
    }
    assert.deepEqual(readFileSync(globalFile), globalBytes)
  })
  const watched = [globalFile, workspaceFile(workspace), workspaceFile(secondWorkspace)]
  const before = watched.map(file => readFileSync(file))
  const bad = await write({ ...same, scope: 'bogus' }, a)
  const unknown = await write({ ...same, scope: 'workspace' }, agent('fixture-unknown', ''))
  const unbound = await write({ ...same, scope: 'workspace' })
  check('invalid scope and unidentified workspace are explicitly rejected without writes', () => {
    assert.match(String(bad), /scope 只能是 workspace 或 global/)
    assert.match(String(unknown), /无法确定调用会话的工作区/)
    assert.match(String(unbound), /无法确定调用会话的工作区/)
    assert.deepEqual(watched.map(file => readFileSync(file)), before)
  })
  console.log('FILES', JSON.stringify(watched.map(file => ({ file, bytes: statSync(file).size }))))
  console.log('PASS ' + pass + ' / FAIL 0')
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  globalThis.fetch = originalFetch
  rmSync(dir, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 })
}
