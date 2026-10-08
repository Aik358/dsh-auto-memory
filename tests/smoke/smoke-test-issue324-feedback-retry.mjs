// Entire signed production webhook, with isolated transport and clock fixtures.
// Default: no sockets, full module in VM. --http: real child + local mock Gist.
// --entry=<upstream source> runs identical assertions as a negative control.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'
import http from 'node:http'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const entryArg = process.argv.find((v) => v.startsWith('--entry='))
const entry = entryArg ? path.resolve(entryArg.slice(8)) : path.join(root, '.github/cloud/qq-webhook/index.js')
const source = fs.readFileSync(entry, 'utf8')
const useHttp = process.argv.includes('--http')
const secret = 'fixture-secret-0123456789abcdef'
let seed = Buffer.from(secret)
while (seed.length < 32) seed = Buffer.concat([seed, seed])
const key = crypto.createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed.subarray(0, 32)]), format: 'der', type: 'pkcs8' })
const instances = []
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
const turn = () => new Promise((r) => setTimeout(r, useHttp ? 40 : 0))
const baseEnv = { QQ_APP_ID: 'fixture', QQ_APP_SECRET: secret, QQ_GROUP_OPENID: 'fixture', GH_TOKEN: 'fixture', GIST_ID: 'fixture', PORT: '0' }

function store() {
  let content = '', version = 0, pause = null
  const state = { gets: 0, patches: 0, conflicts: 0, failRead: false, failWrite: false, throwWrite: false, omitVersion: false }
  const response = (status, text, etag = '') => ({ ok: status >= 200 && status < 300, status, headers: { get: (name) => name === 'etag' ? etag : '' }, json: async () => ({ files: { 'group-feedback.jsonl': { content: text } } }) })
  const fetch = async (url, opts = {}) => {
    assert.equal(String(url), 'https://api.github.com/gists/fixture', 'fixture must never call other services')
    if (!opts.method) {
      state.gets++
      return response(state.failRead ? 503 : 200, content, state.omitVersion ? '' : `"v${version}"`)
    }
    assert.equal(opts.method, 'PATCH')
    state.patches++
    if (pause) { const gate = pause; pause = null; gate.entered.resolve(); await gate.resume.promise }
    if (state.throwWrite) throw new Error('fixture network failure')
    if (state.failWrite) return response(503, '')
    const headers = opts.headers
    if (headers['If-Match'] !== `"v${version}"`) { state.conflicts++; return response(412, '') }
    content = JSON.parse(opts.body).files['group-feedback.jsonl'].content
    version++
    return response(200, '')
  }
  return {
    state, fetch, content: () => content,
    holdNextWrite() { const gate = { entered: deferred(), resume: deferred() }; pause = gate; return gate },
  }
}

async function makeInstance(storage, envExtra = {}) {
  const clock = { now: 1700000000000 }
  let handle
  let tmp, mockServer, child, childDone
  let log = ''
  const cleanup = async () => {
    if (child) { child.kill(); await childDone }
    if (mockServer?.listening) await new Promise((r) => mockServer.close(r))
    if (tmp) {
      const resolved = fs.realpathSync(tmp)
      assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep))
      fs.rmSync(resolved, { recursive: true, force: true })
    }
  }
  // Register before starting any resources, including a failed child startup.
  instances.push({ stop: cleanup })
  const logs = { log: (...v) => { log += v.join(' ') + '\n' }, error: (...v) => { log += v.join(' ') + '\n' }, warn: (...v) => { log += v.join(' ') + '\n' } }
  const env = { ...baseEnv, ...envExtra }
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])) }
    static now() { return clock.now }
  }
  let deliver
  if (!useHttp) {
    vm.runInNewContext(source, {
      require: (name) => {
        if (name === 'node:crypto') return crypto
        if (name === 'node:http') return { createServer: (callback) => { handle = callback; return { listen(port, ready) { ready() } } } }
        throw new Error('unexpected dependency: ' + name)
      },
      process: { env, exit: () => { throw new Error('unexpected production exit') } },
      fetch: storage.fetch, Buffer, URL, Date: ClockDate, setTimeout, console: logs,
    }, { filename: entry })
    deliver = async (payload, signed = true) => {
      const raw = JSON.stringify(payload), ts = 'fixture-ts'
      const req = new EventEmitter()
      Object.assign(req, { method: 'POST', url: '/', headers: signed ? { 'x-signature-timestamp': ts, 'x-signature-ed25519': crypto.sign(null, Buffer.from(ts + raw), key).toString('hex') } : {} })
      const done = deferred()
      let status
      const res = { writableEnded: false, writeHead: (code) => { status = code }, end(body) { res.writableEnded = true; done.resolve({ status, body }) } }
      handle(req, res)
      req.emit('data', Buffer.from(raw))
      req.emit('end')
      return await done.promise
    }
  } else {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-retry-324-'))
    const childEntry = path.join(tmp, 'index.cjs'), clockFile = path.join(tmp, 'clock.txt')
    fs.copyFileSync(entry, childEntry)
    assert.equal(sha(fs.readFileSync(childEntry)), sha(fs.readFileSync(entry)), 'child source bytes must match production')
    fs.writeFileSync(clockFile, String(clock.now))
    fs.writeFileSync(path.join(tmp, 'clock.cjs'), `const fs = require('node:fs'); const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [Number(fs.readFileSync(${JSON.stringify(clockFile)}, 'utf8'))])); } static now() { return Number(fs.readFileSync(${JSON.stringify(clockFile)}, 'utf8')); } };`)
    mockServer = http.createServer(async (req, res) => {
      try {
        assert.equal(req.url, '/gists/fixture')
        let body = ''
        for await (const chunk of req) body += chunk
        const opts = req.method === 'GET' ? {} : { method: req.method, body, headers: { 'If-Match': req.headers['if-match'] } }
        const r = await storage.fetch('https://api.github.com/gists/fixture', opts)
        const etag = r.headers.get('etag')
        res.writeHead(r.status, { 'Content-Type': 'application/json', ...(etag ? { ETag: etag } : {}) })
        res.end(JSON.stringify(await r.json()))
      } catch (e) { if (storage.state.throwWrite) res.destroy(); else { res.writeHead(500); res.end(JSON.stringify({ error: e.message })) } }
    })
    await new Promise((resolve, reject) => { mockServer.once('error', reject); mockServer.listen(0, '127.0.0.1', resolve) })
    const probe = net.createServer()
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve) })
    const port = probe.address().port
    await new Promise((r) => probe.close(r))
    child = spawn(process.execPath, ['--require', path.join(tmp, 'clock.cjs'), childEntry], {
      cwd: tmp, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DSH_HOME: path.join(tmp, 'isolated-home'), ...env, PORT: String(port), GITHUB_API_BASE: `http://127.0.0.1:${mockServer.address().port}` }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    childDone = new Promise((r) => child.once('close', r))
    child.on('error', (e) => { log += e.stack })
    child.stdout.on('data', (b) => { log += b })
    child.stderr.on('data', (b) => { log += b })
    for (let i = 0; i < 100 && !log.includes('监听'); i++) {
      if (child.exitCode !== null) throw new Error(log)
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.ok(log.includes('监听'), log)
    deliver = async (payload, signed = true) => {
      fs.writeFileSync(clockFile, String(clock.now))
      const body = JSON.stringify(payload), ts = 'fixture-ts'
      const response = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body, headers: signed ? { 'x-signature-timestamp': ts, 'x-signature-ed25519': crypto.sign(null, Buffer.from(ts + body), key).toString('hex') } : {}, signal: AbortSignal.timeout(10000) })
      return { status: response.status, body: await response.text() }
    }
  }
  const i = {
    clock, deliver, logs: () => log,
    event: (id, content = `反馈 ${id}`, user = 'fixture') => deliver({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { id, timestamp: new Date(clock.now).toISOString(), content, author: { username: user } } }),
    stop: cleanup,
  }
  return i
}

async function main() {
  console.log(`source=${entry} sha256=${sha(fs.readFileSync(entry))} transport=${useHttp ? 'child HTTP' : 'full-module VM'}`)
  // Identical assertions run against bda0dad to prove the baseline fails.
  const failed = store(), warm = await makeInstance(failed)
  failed.state.failWrite = true
  const first = await warm.event('retry')
  assert.equal(first.status, 503, 'durable feedback failure must not acknowledge HTTP 200')
  assert.match(first.body, /feedback_persistence_failed/)
  assert.equal(failed.content(), '')
  failed.state.failWrite = false
  assert.equal((await warm.event('retry')).status, 200)
  assert.equal((await warm.event('retry')).status, 200)
  assert.equal(failed.state.patches, 2, 'failed + recovered write; completed retry must dedup')
  assert.match(failed.content(), /反馈 retry/)
  console.log('PASS durable failure/recovery in same warm instance')

  for (const failureKey of ['failRead', 'omitVersion', 'throwWrite']) {
    const s = store(), i = await makeInstance(s)
    s.state[failureKey] = true
    assert.equal((await i.event(failureKey)).status, 503)
    s.state[failureKey] = false
    assert.equal((await i.event(failureKey)).status, 200)
    assert.match(s.content(), new RegExp(`反馈 ${failureKey}`))
  }
  console.log('PASS read/version/network failures all remain retryable')

  for (const failWrite of [false, true]) {
    const s = store(), i = await makeInstance(s)
    s.state.failWrite = failWrite
    const gate = s.holdNextWrite()
    const a = i.event('same-id')
    await gate.entered.promise
    let bDone = false
    const b = i.event('same-id').then((r) => { bDone = true; return r })
    await turn()
    assert.equal(bDone, false, 'same-id duplicate must await durable result')
    assert.equal(s.state.patches, 1)
    gate.resume.resolve()
    assert.deepEqual((await Promise.all([a, b])).map((r) => r.status), failWrite ? [503, 503] : [200, 200])
    assert.equal(s.state.patches, 1, 'same-id flight must not double write')
    if (failWrite) { s.state.failWrite = false; assert.equal((await i.event('same-id')).status, 200); assert.equal(s.state.patches, 2) }
  }
  console.log('PASS same event singleflight shares success/failure; failure clears admission')

  for (const failWrite of [false, true]) {
    const s = store(), i = await makeInstance(s)
    s.state.failWrite = failWrite
    const gate = s.holdNextWrite()
    const a = i.event('semantic-owner', '反馈 identical')
    await gate.entered.promise
    let bDone = false, cDone = false
    const b = i.event('semantic-alias', '反馈 identical').then((r) => { bDone = true; return r })
    await turn()
    // An alias's same event ID must remain singleflight even if its resent
    // payload differs while it is awaiting the semantic owner's durable result.
    const c = i.event('semantic-alias', '反馈 changed-payload').then((r) => { cDone = true; return r })
    await turn()
    assert.equal(bDone || cDone, false)
    assert.equal(s.state.patches, 1)
    gate.resume.resolve()
    assert.deepEqual((await Promise.all([a, b, c])).map((r) => r.status), failWrite ? [503, 503, 503] : [200, 200, 200])
    assert.equal(s.state.patches, 1)
    if (failWrite) {
      s.state.failWrite = false
      assert.equal((await i.event('semantic-alias', '反馈 identical')).status, 200)
      assert.equal(s.state.patches, 2)
    } else {
      assert.equal((await i.event('recent-alias', '反馈 identical')).status, 200)
      assert.equal(s.state.patches, 1, 'a new ID with the same author/content is deduped inside 60s')
      i.clock.now += 60000
      assert.equal((await i.event('semantic-alias', '反馈 identical')).status, 200)
      assert.equal(s.state.patches, 1, 'successful alias ID remains seen after content window expires')
      assert.equal((await i.event('recent-alias', '反馈 identical')).status, 200)
      assert.equal(s.state.patches, 1, 'completed semantic aliases also retain event-ID dedup')
      assert.equal((await i.event('new-window-id', '反馈 identical')).status, 200)
      assert.equal(s.state.patches, 2, 'new ID is admitted after the 60s semantic window')
    }
  }
  console.log('PASS semantic singleflight, alias IDs, failed retry and 60s window behavior')

  const independent = store(), i = await makeInstance(independent)
  const gate = independent.holdNextWrite()
  const held = i.event('held', '反馈 same-text', 'author-A')
  await gate.entered.promise
  assert.equal((await i.event('other', '反馈 same-text', 'author-B')).status, 200)
  assert.match(independent.content(), /author-B/)
  gate.resume.resolve()
  assert.equal((await held).status, 200)
  assert.match(independent.content(), /author-A/)
  assert.match(independent.content(), /author-B/)
  assert.equal(independent.state.conflicts, 1, 'existing CAS still resolves independent event interleaving')
  console.log('PASS unrelated events progress independently and retain CAS behavior')

  const plain = store(), controls = await makeInstance(plain)
  const unconfigured = store(), optional = await makeInstance(unconfigured, { GIST_ID: '' })
  assert.equal((await optional.event('not-configured')).status, 200)
  assert.equal((await optional.event('not-configured')).status, 200)
  assert.equal(unconfigured.state.gets + unconfigured.state.patches, 0, 'optional unconfigured collection keeps existing no-network behavior')
  assert.equal((await controls.event('plain', 'ordinary text')).status, 200)
  assert.equal((await controls.event('plain', 'ordinary text')).status, 200)
  assert.equal(plain.state.gets + plain.state.patches, 0)
  const invalid = await controls.deliver({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { id: 'unsigned', content: '反馈 unsigned' } }, false)
  assert.equal(invalid.status, 401)
  assert.equal(plain.state.gets + plain.state.patches, 0)
  assert.equal((await controls.deliver({ op: 0, t: 'IGNORED_EVENT' })).status, 200)
  const handshake = await controls.deliver({ op: 13, d: { plain_token: 'fixture', event_ts: 'fixture' } }, false)
  assert.equal(handshake.status, 200)
  const handshakeBody = JSON.parse(handshake.body)
  assert.equal(handshakeBody.plain_token, 'fixture')
  assert.equal(crypto.verify(null, Buffer.from('fixturefixture'), crypto.createPublicKey(key), Buffer.from(handshakeBody.signature, 'hex')), true)
  console.log('PASS non-feedback, signature rejection, unrelated events and op13 handshake controls')
}

try { await main() }
catch (e) { console.error(e.stack); process.exitCode = 1 }
finally { await Promise.all(instances.map((i) => i.stop())) }
