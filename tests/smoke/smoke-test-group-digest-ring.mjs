// Execute the complete digest and the actual webhook producer. All HTTP and
// timers are local mocks; the production latest-400 view is exercised unchanged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'group-digest-ring-'))
const savedEnv = Object.fromEntries(['HOME', 'USERPROFILE', 'DSH_HOME'].map(key => [key, process.env[key]]))
Object.assign(process.env, { HOME: tmp, USERPROFILE: tmp, DSH_HOME: tmp })
const digestFile = process.env.DIGEST_RING_SOURCE || path.join(repo, '.github/scripts/group-digest.mjs')
const source = fs.readFileSync(digestFile, 'utf8').replace(/^#![^\n]*\n/, '')
  .replace(/^import .*\r?\n/gm, '').replaceAll('import.meta.url', JSON.stringify(pathToFileURL(digestFile).href))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('process', 'fetch', 'readFileSync', 'appendFileSync', 'existsSync', 'fileURLToPath', 'path', 'createHash', 'console', 'setTimeout', source)
const webhook = fs.readFileSync(path.join(repo, '.github/cloud/qq-webhook/index.js'), 'utf8')
const from = webhook.indexOf('async function gistAppend(line) {')
const to = webhook.indexOf('// 状态文件', from)
assert.ok(from >= 0 && to > from, 'actual producer extraction failed')
const response = (data, status = 200, link = null) => ({ ok: status < 400, status, headers: { get: () => link }, json: async () => data, text: async () => JSON.stringify(data) })
const row = i => JSON.stringify({ t: '2026-10-07T00:00:00Z', m: `feedback-${i}` })
let content = '', state = {}, sent = [], writes = [], ackStatus = 200, failAt = 0, duringSend = null
let comments = [], commentSeq = 0
let successfulRounds = 0
let producerRequest = false
const fetchMock = async (url, opts = {}) => {
  const u = String(url)
  if (u.includes('/gists/')) {
    if (u.includes('/comments')) {
      if (opts.method === 'POST') {
        const record = { id: ++commentSeq, body: JSON.parse(opts.body).body }
        comments.push(record)
        return response(record, 201)
      }
      const page = Number(new URL(u).searchParams.get('page') || 1)
      const last = Math.max(1, Math.ceil(comments.length / 100))
      return response(comments.slice((page - 1) * 100, page * 100), 200,
        last > 1 ? `<https://api.github.com/gists/fixture/comments?per_page=100&page=${last}>; rel="last"` : null)
    }
    if (opts.method === 'PATCH') {
      const files = JSON.parse(opts.body).files
      if (!producerRequest) writes.push(files)
      if (files['group-feedback.jsonl']) content = files['group-feedback.jsonl'].content
      if (files['group-issues.json'] && ackStatus === 200) state = JSON.parse(files['group-issues.json'].content)
      return response({}, files['group-issues.json'] ? ackStatus : 200)
    }
    return response({ files: { 'group-feedback.jsonl': { content }, 'group-issues.json': { content: JSON.stringify(state) } } })
  }
  if (u === 'https://fixture.invalid/delivery') {
    sent.push(JSON.parse(opts.body).text)
    if (duringSend) { const append = duringSend; duringSend = null; await append() }
    return response({}, sent.length === failAt ? 503 : 200)
  }
  if (u.includes('registry.npmjs')) return response({ version: 'fixture' })
  if (u.endsWith('/releases/latest')) return response(null, 404)
  if (u.endsWith('/repos/fixture/repo')) return response({ stargazers_count: 0 })
  return response([])
}
const append = new Function('gh', 'CFG', 'FEEDBACK_FILE', 'crypto', webhook.slice(from, to) + ';return gistAppend')(
  async (p, opts) => {
    producerRequest = true
    try {
      const r = await fetchMock('https://api.github.com' + p, opts)
      return { ok: r.ok, status: r.status, link: r.headers.get('link'), body: await r.json() }
    } finally { producerRequest = false }
  },
  { gistId: 'fixture' }, 'group-feedback.jsonl', { randomUUID })
const env = { REPO: 'fixture/repo', FEEDBACK_GIST_ID: 'fixture', FEEDBACK_GH_PAT: 'fixture', DIGEST_CHANNEL: 'generic',
  GENERIC_WEBHOOK_URL: 'https://fixture.invalid/delivery', SINCE_HOURS: '12', LLM_API_KEY: '' }
const silent = { log() {}, error() {}, warn() {} }
function reset() { content = ''; comments = []; state = {}; sent = []; writes = []; ackStatus = 200; failAt = 0; duringSend = null }
async function digest(expectedExit = 0) {
  sent = []; writes = []
  const proc = { env, argv: ['node', 'digest'], exitCode: 0, exit() { throw Error('unexpected exit') } }
  await run(proc, fetchMock, () => '', () => {}, () => false, fileURLToPath, path, createHash, silent, fn => { fn(); return 0 })
  assert.equal(proc.exitCode, expectedExit)
  if (!proc.exitCode) successfulRounds++
  const text = sent.join('')
  assert.ok(!text.includes('feedbackId'), 'internal producer identity leaked into group text')
  assert.ok(writes.every(files => Object.keys(files).join() === 'group-issues.json'), 'digest wrote raw feedback')
  const originals = text.split('▍本期群反馈原文')[1] || ''
  return { delivered: [...originals.matchAll(/feedback-(\d+)/g)].map(m => Number(m[1])), count: Number(originals.match(/^\((\d+)条\)/)?.[1] || 0), text }
}
try {
  // Upgrade with an already acknowledged legacy file: concurrent new records
  // are both delivered once without rewriting or replaying the old messages.
  content = row(0) + '\n' + row(1) + '\n'
  assert.deepEqual((await digest()).delivered, [0, 1])
  await Promise.all([append(row(2)), append(row(3))])
  assert.deepEqual((await digest()).delivered, [2, 3])
  assert.equal((await digest()).count, 0)
  assert.equal(content, row(0) + '\n' + row(1) + '\n')
  reset()
  // Drain the real ring, then deliver every low-rate arrival in its next run.
  for (let i = 0; i < 400; i++) await append(row(i))
  const initial = []
  for (let i = 0; i < 4; i++) initial.push(...(await digest()).delivered)
  assert.deepEqual(initial, Array.from({ length: 400 }, (_, i) => i))
  for (let i = 400; i <= 800; i++) {
    await append(row(i))
    const r = await digest()
    assert.deepEqual(r.delivered, [i], `full-ring arrival ${i} was replayed or delayed`)
    assert.equal(r.count, 1)
    assert.equal(comments.slice(-400).length, 400)
    assert.equal(content, '', 'producer must not overwrite the legacy file')
    assert.ok(state.feedbackCursor.acknowledgedHashes.length <= 400)
  }

  // Rotation while a backlog remains and again during delivery preserves order.
  reset()
  for (let i = 0; i < 400; i++) await append(row(i))
  assert.deepEqual((await digest()).delivered, Array.from({ length: 120 }, (_, i) => i))
  await append(row(400))
  duringSend = () => append(row(401))
  assert.deepEqual((await digest()).delivered, Array.from({ length: 120 }, (_, i) => i + 120))
  assert.deepEqual((await digest()).delivered, Array.from({ length: 120 }, (_, i) => i + 240))
  assert.deepEqual((await digest()).delivered, Array.from({ length: 42 }, (_, i) => i + 360))
  assert.equal((await digest()).count, 0)

  // Fully identical t/u/m and even a supplied identity remain distinct appends.
  reset()
  const identical = JSON.stringify({ t: '2026-10-07T00:00:00Z', u: 'fixture', m: 'same message', feedbackId: 'caller-selected' })
  for (let i = 0; i < 400; i++) await append(identical)
  const occurrences = comments.map(c => JSON.parse(c.body.split('\n')[1]).feedbackId)
  assert.equal(new Set(occurrences).size, 400)
  assert.ok(!occurrences.includes('caller-selected'))
  for (const expected of [120, 120, 120, 40]) assert.equal((await digest()).count, expected)
  await append(identical)
  assert.equal((await digest()).count, 1)
  assert.equal((await digest()).count, 0)

  // Ack failure after delivery retries every pending occurrence after rotation.
  await append(row(900))
  const beforeAck = JSON.stringify(state)
  ackStatus = 503
  assert.deepEqual((await digest(1)).delivered, [900])
  assert.equal(JSON.stringify(state), beforeAck)
  await append(row(901))
  ackStatus = 200
  assert.deepEqual((await digest()).delivered, [900, 901])

  // An incomplete multi-chunk delivery confirms nothing, including a concurrent
  // ring append; retry includes the entire long message and the arrival.
  const long = 'long-begin ' + '😀正文 '.repeat(2500) + ' long-end'
  await append(JSON.stringify({ t: '2026-10-07T00:00:00Z', m: long }))
  const beforeSend = JSON.stringify(state)
  failAt = 2
  duringSend = () => append(row(902))
  await digest(1)
  assert.equal(writes.filter(files => files['group-issues.json']).length, 0)
  assert.equal(JSON.stringify(state), beforeSend)
  failAt = 0
  const retried = await digest()
  assert.ok(retried.text.includes(long))
  assert.deepEqual(retried.delivered, [902])
  assert.equal(retried.count, 2)

  // Compaction that removes the confirmed prefix retains all pending rows.
  reset()
  for (let i = 0; i < 130; i++) await append(row(i))
  await digest()
  comments = comments.slice(120)
  assert.deepEqual((await digest()).delivered, Array.from({ length: 10 }, (_, i) => i + 120))
  content = ''
  comments = []
  await append(row(1000))
  assert.deepEqual((await digest()).delivered, [1000])

  // Existing count/prefixHash cursors migrate without unnecessary replay.
  reset()
  content = [row(0), row(1)].join('\n') + '\n'
  state = { feedbackCursor: { count: 1, prefixHash: createHash('sha256').update(row(0)).digest('hex') } }
  assert.deepEqual((await digest()).delivered, [1])
  assert.equal(state.feedbackCursor.version, 2)
  content = row(2) + '\n'
  assert.deepEqual((await digest()).delivered, [2])

  // Legacy repeated rows cannot establish a unique overlap: conservatively
  // replay the occurrences, without global text deduplication.
  reset()
  content = [row(0), row(0), row(1)].join('\n') + '\n'
  await digest()
  content = [row(0), row(1), row(2)].join('\n') + '\n'
  assert.deepEqual((await digest()).delivered, [2])
  reset()
  content = [row(0), row(0)].join('\n') + '\n'
  await digest()
  content = [row(0), row(0), row(1)].join('\n') + '\n'
  // Break the old prefix identity to simulate legacy rotation/edit uncertainty.
  state.feedbackCursor.prefixHash = 'untrusted-old-prefix'
  assert.deepEqual((await digest()).delivered, [0, 0, 1])
  const beforeInvalid = content
  await assert.rejects(append('[]'), /JSON 对象/)
  assert.equal(content, beforeInvalid)
  console.log(`PASS digest ring: ${successfulRounds} successful full-script rounds; 401 next-run arrivals, backlog/concurrent rotation, identical occurrences, ack/chunk failures, compaction/reset, legacy migration/ambiguity, raw-source read-only`)
} finally {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}
