import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const liveModule = new URL('../../lib/index.js', import.meta.url)
const roots = []
const oldHome = process.env.DSH_HOME

async function readDebug(moduleUrl) {
  const root = await mkdtemp(path.join(tmpdir(), 'dam-batch4-debug-'))
  roots.push(root)
  const user = path.join(root, 'user')
  const summaries = path.join(user, 'summaries')
  const home = path.join(root, 'profile')
  await mkdir(home)
  await writeFile(path.join(home, 'dsh-auto-memory.json'), JSON.stringify({
    userMemoryDir: user, memoryRoot: path.join(root, 'workspaces'), externalSources: {},
  }))
  process.env.DSH_HOME = home
  const { apply, API } = await import(moduleUrl)
  const routes = []
  const cleanup = []
  const noop = () => () => {}
  apply({
    get: () => undefined, on: noop, systemPrompt: { section: noop, context: noop },
    tools: { register: noop },
    webServer: { register(route) { routes.push(route); return noop() } },
    effect(run) { const dispose = run(); if (typeof dispose === 'function') cleanup.push(dispose) },
  }, {})
  const debug = routes.find(route => route.path === API.debug)
  assert.ok(debug, 'debug route must be registered')
  async function get() {
    let status, payload
    await debug.handler({ method: 'GET', url: API.debug, headers: { host: '127.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }, {
      writeHead(value) { status = value },
      end(value) { payload = JSON.parse(value) },
    })
    assert.equal(status, 200, JSON.stringify(payload))
    return payload.memoryFiles.summariesDir
  }
  try {
    await mkdir(path.join(user, 'summaries-pre'), { recursive: true })
    await writeFile(path.join(user, 'summaries-pre', 'old.json'), Buffer.alloc(509))
    await mkdir(summaries)
    const files = [17, 41, 113].map((_, i) => path.join(summaries, '2026-11-23-' + i + '.json'))
    await Promise.all(files.map((file, i) => writeFile(file, Buffer.alloc([17, 41, 113][i]))))
    const expected = (await Promise.all(files.map(file => stat(file)))).reduce((total, file) => total + file.size, 0)
    const actual = await get()
    assert.deepEqual(actual, { exists: true, size: expected, mtime: (await stat(summaries)).mtimeMs }, 'debug must count the real summary bytes')
    await rm(summaries, { recursive: true })
    const missing = await get()
    assert.deepEqual(missing, { exists: false }, 'missing main directory must not use summaries-pre')
    return { actual, missing, expected }
  } finally {
    for (const dispose of cleanup.reverse()) dispose()
  }
}

try {
  const live = await readDebug(liveModule.href)
  console.log('PASS /debug summary files 17 + 41 + 113 = ' + live.expected + ' B; HTTP 200 ' + JSON.stringify(live.actual))
  console.log('PASS missing main directory, adjacent 509 B retained: ' + JSON.stringify(live.missing))
  const mutation = new URL('./.batch4-summary-diagnostics-mutant-' + process.pid + '.mjs', liveModule)
  const source = await readFile(liveModule, 'utf8')
  const anchor = "summariesDir: await sizeMtime(this.globalPaths().summariesDir, true)"
  assert.equal(source.split(anchor).length, 2)
  try {
    await writeFile(mutation, source.replace(anchor, "summariesDir: await sizeMtime(this.globalPaths().summariesDir + '-pre', true)"), { flag: 'wx' })
    await assert.rejects(() => readDebug(mutation.href), /debug must count the real summary bytes/)
    console.log('CAUGHT adjacent directory mutation')
  } finally {
    await rm(mutation, { force: true })
  }
  await readDebug(liveModule.href)
  console.log('PASS restored production route; 3 PASS / 0 FAIL, 1 mutation caught')
} finally {
  if (oldHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = oldHome
  for (const root of roots) await rm(root, { recursive: true, force: true })
}
