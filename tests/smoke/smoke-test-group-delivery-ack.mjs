// Full automation scripts with local fetch mocks; no HTTP/QQ/GitHub traffic.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tmp = mkdtempSync(path.join(tmpdir(), 'group-delivery-ack-'))
let serial = 0
function run(name, setup, source, tail, args = []) {
  const file = path.join(tmp, `${serial++}-${name}.mjs`)
  writeFileSync(file, setup + '\n' + source.replace(/^#![^\n]*\n/, '') + '\n' + tail)
  const env = { ...process.env, GITHUB_TOKEN: '', GH_TOKEN: 'fixture', FEEDBACK_GH_PAT: 'fixture', FEEDBACK_GIST_ID: 'fixture',
    LLM_API_KEY: '', SINCE_HOURS: '12', GITHUB_EVENT_NAME: 'manual', GITHUB_STEP_SUMMARY: '',
    DIGEST_CHANNEL: 'generic', GENERIC_WEBHOOK_URL: 'https://fixture.invalid/delivery',
    DISCORD_WEBHOOK_URL: 'https://fixture.invalid/delivery', FEISHU_WEBHOOK_URL: 'https://fixture.invalid/delivery',
    DINGTALK_WEBHOOK_URL: 'https://fixture.invalid/delivery', TG_BOT_TOKEN: 'fixture', TG_CHAT_ID: 'fixture',
    NAPCAT_HTTP_URL: 'https://fixture.invalid', NAPCAT_GROUP_ID: '1', NAPCAT_TOKEN: 'fixture',
    QQ_API_BASE: 'https://fixture.invalid', QQ_MSG_ID: 'fixture',
    QQ_APP_ID: 'fixture', QQ_APP_SECRET: 'fixture', QQ_GROUP_OPENID: 'fixture', STATE_FILE: path.join(tmp, 'state.json') }
  const result = spawnSync(process.execPath, [file, ...args], { env, encoding: 'utf8', timeout: 10000 })
  assert.ifError(result.error)
  const match = result.stdout.match(/FIXTURE_RESULT (.+)/)
  assert.ok(match, `${name}: ${result.stderr}\n${result.stdout}`)
  return { ...JSON.parse(match[1]), exit: result.status }
}
const digest = readFileSync(path.join(root, '.github/scripts/group-digest.mjs'), 'utf8')
const line = JSON.stringify({ t: '2026-10-07T00:00:00Z', m: 'notes fail to open' })
const arrival = JSON.stringify({ t: '2026-10-07T01:00:00Z', m: 'new feedback during send' })
function digestSetup({ content = line, state = {}, sendStatus = 200, ackStatus = 200, append = '', channel, failAt = 0, llm = false } = {}) {
  return `
const fixture = { content: ${JSON.stringify(content)}, state: ${JSON.stringify(state)}, writes: [], sent: [], payloads: [], llmCalls: 0 }
${channel ? `process.env.DIGEST_CHANNEL = ${JSON.stringify(channel)}` : ''}
${llm ? "process.env.LLM_API_KEY = 'fixture'; process.env.LLM_BASE_URL = 'https://fixture.invalid/llm'" : ''}
const nativeTimer = globalThis.setTimeout
globalThis.setTimeout = (fn, ms, ...args) => nativeTimer(fn, Math.min(ms, 1), ...args)
globalThis.fetch = async (url, opts = {}) => {
  const method = opts.method || 'GET'
  if (url === 'https://fixture.invalid/delivery' || url === 'https://fixture.invalid/send_group_msg' ||
      url === 'https://fixture.invalid/v2/groups/fixture/messages' || url === 'https://api.telegram.org/botfixture/sendMessage') {
    const payload = JSON.parse(opts.body)
    fixture.payloads.push(payload)
    fixture.sent.push(typeof payload.text === 'string' ? payload.text : typeof payload.content === 'string' ? payload.content :
      payload.content?.text || payload.text?.content || payload.message?.[0]?.data?.text)
    ${append ? `if (fixture.sent.length === 1) fixture.content += '\\n' + ${JSON.stringify(append)}` : ''}
    return Response.json({ ok: true, code: 0, errcode: 0, data: { message_id: 1 } }, { status: fixture.sent.length === ${failAt} ? 503 : ${sendStatus} })
  }
  if (url === 'https://bots.qq.com/app/getAppAccessToken') return Response.json({ access_token: 'fixture' })
  if (url === 'https://fixture.invalid/llm/chat/completions') {
    fixture.llmCalls++
    return Response.json({ choices: [{ message: { content: fixture.llmCalls === 1 ? '• unrelated topic —— summary omits original details' : JSON.stringify({ issues: [], resolved_titles: [] }) } }] })
  }
  if (url.startsWith('https://api.github.com/gists/fixture/comments?')) return Response.json([])
  if (url === 'https://api.github.com/gists/fixture') {
    if (method === 'PATCH') {
      const files = JSON.parse(opts.body).files
      fixture.writes.push(files)
      if (${ackStatus} === 200) fixture.state = JSON.parse(files['group-issues.json'].content)
      return new Response('{}', { status: ${ackStatus} })
    }
    return Response.json({ files: { 'group-feedback.jsonl': { content: fixture.content }, 'group-issues.json': { content: JSON.stringify(fixture.state) } } })
  }
  if (method !== 'GET') throw Error('Unexpected mocked write ' + url)
  if (url.startsWith('https://registry.npmjs.org/')) return Response.json({ version: 'fixture' })
  if (url.startsWith('https://raw.githubusercontent.com/')) return new Response('')
  if (url.startsWith('https://api.github.com/repos/')) return Response.json(url.includes('/issues?') || url.includes('/pulls?') || url.includes('/commits?') ? [] : {})
  throw Error('Unexpected fetch ' + url)
}`
}
const digestTail = "console.log('FIXTURE_RESULT ' + JSON.stringify(fixture))"
try {
  for (const args of [['--print'], ['--no-send']]) {
    const r = run('preview', digestSetup(), digest, digestTail, args)
    assert.equal(r.exit, 0); assert.equal(r.writes.length, 0); assert.equal(r.sent.length, 0)
  }
  const none = run('none', digestSetup({ channel: 'none' }), digest, digestTail)
  assert.equal(none.writes.length, 0)
  const failed = run('failed', digestSetup({ sendStatus: 503 }), digest, digestTail)
  assert.equal(failed.exit, 1); assert.equal(failed.writes.length, 0); assert.equal(failed.content, line)
  const success = run('success', digestSetup({ append: arrival }), digest, digestTail)
  assert.equal(success.exit, 0); assert.equal(success.writes.length, 1)
  assert.deepEqual(Object.keys(success.writes[0]), ['group-issues.json'])
  assert.equal(success.content, line + '\n' + arrival)
  const next = run('next', digestSetup({ content: success.content, state: success.state }), digest, digestTail)
  assert.ok(next.sent[0].includes('new feedback during send')); assert.ok(!next.sent[0].includes('notes fail to open'))
  const duplicate = run('identical', digestSetup({ content: line + '\n' + line, state: success.state }), digest, digestTail)
  assert.ok(duplicate.sent[0].includes('notes fail to open')); assert.equal(duplicate.state.feedbackCursor.count, 2)
  const done = run('identical-done', digestSetup({ content: duplicate.content, state: duplicate.state }), digest, digestTail)
  assert.ok(!done.sent[0].includes('notes fail to open')); assert.equal(done.writes.length, 0)
  const rotated = run('rotated', digestSetup({ content: arrival, state: success.state }), digest, digestTail)
  assert.ok(rotated.sent[0].includes('new feedback during send'))
  const ackFailed = run('ack-failed', digestSetup({ ackStatus: 503 }), digest, digestTail)
  assert.equal(ackFailed.exit, 1); assert.deepEqual(ackFailed.state, {}); assert.equal(ackFailed.content, line)

  // Every acknowledged row must appear in the successfully sent text, even
  // when a fallback/AI summary shows only a subset of the batch.
  const batchOf = (n) => Array.from({ length: n }, (_, i) => JSON.stringify({ t: '2026-10-07T00:00:00Z', m: `[feedback-${i}] body`, headers: 'fixture-private-metadata' })).join('\n')
  for (const count of [9, 120]) {
    const batch = batchOf(count)
    const r = run('batch-' + count, digestSetup({ content: batch }), digest, digestTail)
    assert.equal(r.exit, 0); assert.equal(r.state.feedbackCursor.count, count)
    const delivered = r.sent.join('')
    for (let i = 0; i < count; i++) assert.ok(delivered.includes(`[feedback-${i}] body`), `Unsent row ${i} was acknowledged`)
    assert.ok(!delivered.includes('fixture-private-metadata'))
    const after = run('batch-after-' + count, digestSetup({ content: batch, state: r.state }), digest, digestTail)
    assert.ok(!after.sent.join('').includes('[feedback-'))
  }
  const longMessage = 'start-of-long-message ' + '😀正文 '.repeat(2500) + ' end-of-long-message'
  const longBatch = JSON.stringify({ t: '2026-10-07T00:00:00Z', m: longMessage }) + '\n' + batchOf(119)
  assert.ok(longBatch.length > 20000, 'LLM input clipping boundary must be exercised')
  for (const channel of ['generic', 'discord', 'telegram', 'napcat', 'feishu', 'dingtalk', 'qq_official']) {
    const r = run('long-' + channel, digestSetup({ content: longBatch, channel, llm: channel === 'discord',
      state: { issues: [{ title: 'unrelated tracked issue', detail: 'summary-only', status: 'open', last_seen: new Date().toISOString() }] } }), digest, digestTail)
    assert.equal(r.exit, 0); assert.equal(r.state.feedbackCursor.count, 120)
    const delivered = r.sent.join('')
    assert.ok(delivered.includes(longMessage), `${channel} truncated a long row`)
    for (let i = 0; i < 119; i++) assert.ok(delivered.includes(`[feedback-${i}] body`))
    assert.ok(r.sent.length > 1)
    const limit = channel === 'telegram' ? 4000 : channel === 'discord' ? 1990 : 2000
    for (const chunk of r.sent) {
      assert.ok(chunk.length <= limit)
      assert.ok(!/[\uD800-\uDBFF]$/.test(chunk), 'split high surrogate')
      assert.ok(!/^[\uDC00-\uDFFF]/.test(chunk), 'split low surrogate')
    }
    if (channel === 'qq_official') assert.deepEqual(r.payloads.map(p => p.msg_seq), r.payloads.map((_, i) => i + 1))
    if (channel === 'discord') assert.equal(r.llmCalls, 2)
  }
  const midway = run('midway-failure', digestSetup({ content: longBatch, channel: 'discord', failAt: 2, append: arrival }), digest, digestTail)
  assert.equal(midway.exit, 1); assert.equal(midway.writes.length, 0); assert.equal(midway.sent.length, 2)
  const retry = run('midway-retry', digestSetup({ content: midway.content, state: midway.state, channel: 'discord' }), digest, digestTail)
  assert.equal(retry.exit, 0); assert.equal(retry.state.feedbackCursor.count, 120)
  assert.ok(retry.sent.join('').includes(longMessage))
  const pendingArrival = run('midway-arrival', digestSetup({ content: retry.content, state: retry.state, channel: 'discord' }), digest, digestTail)
  assert.ok(pendingArrival.sent.join('').includes('new feedback during send'))
  assert.equal(pendingArrival.state.feedbackCursor.count, 121)
  const longAckFail = run('long-ack-fail', digestSetup({ content: longBatch, ackStatus: 503, channel: 'telegram' }), digest, digestTail)
  assert.equal(longAckFail.exit, 1); assert.deepEqual(longAckFail.state, {})
  assert.ok(longAckFail.sent.join('').includes(longMessage))

  const listener = readFileSync(path.join(root, '.github/scripts/group-listener.mjs'), 'utf8')
    .replace(/connect\(\)\.catch\(\(e\) => \{ console\.error\('\[listener\] 启动失败:'[^\n]+/, '')
  assert.ok(!listener.includes("console.error('[listener] 启动失败:'"))
  const listenerSetup = `
const fixture = { creates: 0, fail: true, barrier: null, sendFail: false }
globalThis.fetch = async (url, opts = {}) => {
  if (url.endsWith('/labels/group-report')) return Response.json({})
  if (url.endsWith('/issues')) {
    fixture.creates++
    if (fixture.barrier) await fixture.barrier
    return Response.json(fixture.fail ? {} : { number: 1 }, { status: fixture.fail ? 503 : 201 })
  }
  if (url === 'https://bots.qq.com/app/getAppAccessToken') return Response.json({ access_token: 'fixture' })
  if (url.includes('/v2/groups/')) return Response.json({}, { status: fixture.sendFail ? 503 : 200 })
  throw Error('Unexpected fetch ' + url)
}`
  const listenerTail = `
const msg = { id: 'retryable', content: 'bug notes fail', author: { openid: 'fixture' } }
await handleGroupMessage(msg)
if (seen.has(msg.id)) throw Error('Failed creation advanced seen')
fixture.fail = false
fixture.sendFail = true
await handleGroupMessage(msg)
await handleGroupMessage(msg)
if (fixture.creates !== 2 || !seen.has(msg.id)) throw Error('Success was duplicated or not acknowledged')
let release
fixture.barrier = new Promise(r => { release = r })
const first = handleGroupMessage({ ...msg, id: 'concurrent' })
await Promise.resolve()
const duplicate = handleGroupMessage({ ...msg, id: 'concurrent' })
release(); await Promise.all([first, duplicate])
if (fixture.creates !== 3 || pending.size !== 0) throw Error('Concurrent duplicate was not guarded')
console.log('FIXTURE_RESULT ' + JSON.stringify(fixture))
`
  const listened = run('listener', listenerSetup, listener, listenerTail)
  assert.equal(listened.exit, 0); assert.equal(listened.creates, 3)
  console.log('PASS group delivery: previews, full 9/120-row batches, full long/Unicode/AI/tracked messages on seven channels, partial failure/retry, prefix cursor, arrivals, identical messages, rotation, ack failure, listener dedup')
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
