import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createSemanticDownloaderPre } from '../../lib/semantic-js.js'

const root = fs.mkdtempSync(path.join(tmpdir(), 'dam-366-'))
let mode = 'headers', received = false
const server = createServer((req, res) => { received = true; if (mode === 'body') { res.writeHead(200); res.write('x') } else if (mode === 'done') res.end('ok') })
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const downloader = createSemanticDownloaderPre({ modelsRoot: root,
  manifest: { totalBytes: 2, files: [{ rel: 'fixture.bin', bytes: 2, sha256: createHash('sha256').update('ok').digest('hex') }] },
  fetchImpl: (_, opts) => fetch('http://127.0.0.1:' + server.address().port, opts) })
async function until(predicate) {
  const deadline = Date.now() + 1500
  while (!predicate()) { assert.ok(Date.now() < deadline, 'download must settle promptly'); await delay(10) }
}
try {
  for (mode of ['headers', 'body']) {
    received = false
    assert.equal(downloader.start('cn').ok, true)
    await until(() => received)
    assert.equal(downloader.cancel().ok, true)
    await until(() => downloader.state().phase === 'cancelled')
  }
  mode = 'done'
  assert.equal(downloader.start('cn').ok, true)
  await until(() => downloader.state().phase === 'done')
  assert.equal(fs.readFileSync(path.join(root, 'fixture.bin'), 'utf8'), 'ok')
  console.log('PASS #366 cancellation aborts pending headers/body and permits restart')
} finally { downloader.cancel(); server.closeAllConnections(); await new Promise((r) => server.close(r)); fs.rmSync(root, { recursive: true, force: true }) }
