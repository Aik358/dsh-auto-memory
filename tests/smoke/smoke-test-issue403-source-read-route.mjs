import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../../lib/index.js', import.meta.url), 'utf8')
const route = source.indexOf('      path: API.file,')
const start = source.indexOf('handler: ', route) + 'handler: '.length
const end = source.indexOf('\n      },', start) + '\n      }'.length
let current, readCount = 0, response, unreadable = false
const root = path.resolve('/fixture/A')
const engine = {
  _lastAgent: { session: { id: 'B' } },
  resolvePathsForSession: async sid => ({ wsBound: sid === 'A', ws: root }), agentForSessionId: () => null,
  withAgent: async (agent, action) => { current = agent; try { return await action() } finally { current = null } },
  refresh: async agent => { assert.equal(agent.session.id, 'A') },
  resolvePaths: async agent => { assert.equal(agent.session.id, 'A'); return { projectDir: root } },
}
const handler = vm.runInNewContext('(' + source.slice(start, end) + ')', {
  engine, path, URL, String, isLoopbackRequest: () => true, panelAllowedHosts: [], forbiddenPanelPayloadPre: (req) => ({ error: 'forbidden: panel-access' }),
  memoryTreePathOf: (_, target) => { assert.equal(current.session.id, 'A'); return target.startsWith(root + path.sep) ? target : null },
  readFile: async () => { readCount++; if (unreadable) throw Object.assign(Error('fixture original unreadable'), { code: 'EACCES' }); return 'Complete original' },
  writeJson: (_, status, body) => { response = { status, body } },
})
const file = path.join(root, 'archive', 'example.md')
await handler({ url: '/?sessionId=A&path=' + encodeURIComponent(file) }, {})
assert.equal(response.status, 200); assert.equal(response.body.path, file); assert.equal(readCount, 1)
await handler({ url: '/?sessionId=unknown&path=' + encodeURIComponent(file) }, {})
assert.equal(response.status, 400); assert.equal(readCount, 1)
await handler({ url: '/?sessionId=A&path=' + encodeURIComponent(path.resolve('/fixture/B/other.md')) }, {})
assert.equal(response.status, 403); assert.equal(readCount, 1)
unreadable = true; await handler({ url: '/?sessionId=A&path=' + encodeURIComponent(file) }, {})
assert.equal(response.status, 500); assert.match(response.body.error, /unreadable/)
console.log('PASS #403 source reads bind the requesting workspace and preserve outside-tree and read-error guards')
