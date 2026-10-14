import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const dir = await fs.mkdtemp(path.join(tmpdir(), 'dam-external-import-'))
const previous = process.env.DSH_HOME; process.env.DSH_HOME = dir
try {
  const { MemoryEngine } = await import('../lib/audit-engine.mjs')
  for (const anchored of [false, true]) {
    const engine = new MemoryEngine()
    const file = path.join(dir, 'notes-' + anchored + '.md')
    engine.config = { ...engine.config, memoryAnchorEnabled: anchored }
    engine._assertTeamActionPre = () => {}
    engine.resolvePaths = async () => ({ ws: dir, notesPath: file, userFile: path.join(dir, 'user.md') })
    engine.external.discover = async () => [{ id: 'fixture-source', kind: 'markdown', tool: 'fixture', name: 'Source', files: [{ path: '/fixture/source.md' }] }]
    const replies = await Promise.all([engine.external.importInto('fixture-source', 'project', engine), engine.external.importInto('fixture-source', 'project', engine)])
    const body = await fs.readFile(file, 'utf8')
    assert.equal(body.split('## 来自 fixture(Source)').length - 1, 1)
    assert.ok(replies.some((reply) => reply.includes('跳过')))
    const retry = await engine.external.importInto('fixture-source', 'project', engine)
    assert.match(retry, /跳过/); assert.equal(await fs.readFile(file, 'utf8'), body)
    engine.resolvePaths = async () => ({ notesPath: path.join(dir, 'other-workspace.md'), userFile: path.join(dir, 'absent-user.md') })
    const other = await engine.external.importStatus('fixture-source', engine)
    assert.equal(other.imported, false, 'an unrelated runtime cache cannot decide this workspace import status')
  }
  const source = await fs.readFile(new URL('../../lib/index.js', import.meta.url), 'utf8')
  for (const name of ['external-import', 'external-remove']) {
    const marker = source.indexOf("      path: API['" + name + "'],")
    const start = source.indexOf('handler: ', marker) + 9, end = source.indexOf('\n      },', start)
    let owner
    const engine = { resolvePathsForSession: async (sid) => ({ wsBound: sid === 'A', ws: '/fixture/A' }), agentForSessionId: () => null,
      withAgent: (agent, fn) => fn(), external: { importInto: async (_, __, ___, agent) => { owner = agent; return 'imported' },
        removeImported: async (_, __, agent) => { owner = agent; return 'removed' } } }
    const env = { engine, isLoopbackRequest: () => true, readJsonBody: async (req) => req.body, writeJson: (res, status, body) => Object.assign(res, { status, body }) }
    const handler = new Function(...Object.keys(env), 'return (' + source.slice(start, end) + '\n})')(...Object.values(env))
    for (const sessionId of ['', 'unknown', 'A']) { const res = {}; await handler({ method: 'POST', body: { sessionId, source: 'fixture', target: 'project' } }, res); assert.equal(res.status, sessionId === 'A' ? 200 : 400) }
    assert.equal(owner.session.id, 'A'); assert.equal(owner.session.header.cwd, '/fixture/A')
  }
  // The same guard must hold across independent processes in both writer modes.
  const module = new URL('../../lib/memory-writer.js', import.meta.url).href
  for (const anchored of [false, true]) {
    const file = path.join(dir, 'process-' + anchored + '.md')
    const code = `import {MemoryDocumentStore} from ${JSON.stringify(module)}; const store=new MemoryDocumentStore();const file=process.argv[1];const opts={ifAbsent:'fixture-marker'};const result=await store.${anchored ? 'append' : 'appendRaw'}(file,${JSON.stringify('fixture-marker\nsource link')},opts);if(!result.ok)throw Error(JSON.stringify(result));`
    const run = () => new Promise((resolve, reject) => { const child = spawn(process.execPath, ['--input-type=module', '-e', code, file], { stdio: ['ignore', 'ignore', 'pipe'] }); let error = ''; child.stderr.on('data', (data) => { error += data }); child.on('error', reject); child.on('exit', (status) => status ? reject(Error(error)) : resolve()) })
    await Promise.all([run(), run()])
    assert.equal((await fs.readFile(file, 'utf8')).split('fixture-marker').length - 1, 1)
  }
  console.log('PASS #387 real import and independent-process append retries create one source link in both modes')
} finally { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; await fs.rm(dir, { recursive: true, force: true }) }
