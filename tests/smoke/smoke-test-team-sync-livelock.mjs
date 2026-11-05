/**
 * 团队同步「游标卡死 / 无幂等键 / 响应无上限」回归锁 —— 2026-10-21 线上 12GB 事故。
 *
 * ## 事故形态（用户实报：records.jsonl 12GB，进程 RSS 29GB）
 * 服务端记录只增不减 + 客户端每 5s 重取全史 ⇒ 文件单调膨胀、单次响应越来越大、最终把两边打爆。
 * 三句话与代码事实逐条对应：
 *   · 「全打包」= 游标卡死导致每次 pull 重取全史（推送体其实只有 216 字节指针，不传文件内容）；
 *   · 「没有替换」= 线上推送体没有 eventId/idemKey/op 任何幂等键 ⇒ 服务端结构上只能 append；
 *   · 「直接炸了」= team-auth 读响应体没有字节上限 + 服务端全量载入内存。
 *
 * ## 本套件钉住的判据（①–⑥ 五条行为判据 + ⑦ 同批同类点；全部**真 import → 真构造 → 真调用 → 断言返回值**）
 *   ① 推送体**必须**带 idemKey（有 eventId 用 eventId；没有则回退 kind|key），且同一事件重试时**逐字节相同**；
 *   ② 游标接受**字符串形状**（契约 `c_0001250`）与数字形状；畸形值不写进游标；
 *   ③ 游标**跨进程持久化**（注入 loadCursor/saveCursor；重启后不归零）；
 *   ④ 服务端回抛「本次没请求的 kind」不得永久卡死游标（旧实现每 tick 都 deferred ⇒ 活锁）；
 *   ⑤ 响应体超过上限 ⇒ 明确 `response-too-large` 失败，且**在读取阶段**就停：只拉到
 *     首个越限块、`reader.cancel('response-too-large')` 真的调到、预检命中时释放 body。
 *     ★#534：旧套件用 `'x'.repeat(33MiB)` 字符串桩，替身自己先把 33 MiB 造完，
 *     被测算的 `response.text()` 只能走「整读回退」分支 ⇒ **流式路径根本不可观测**，
 *     「读完才判」的缺陷因此被钉成绿（假绿）。现改用真 `Response(ReadableStream)` 替身，
 *     统计 pull 次数与 cancel 调用。
 *   ⑦ 同批同类点：S3 的 `doRequest` 与 http 后端的 fetch 适配器也必须同上限
 *     （只修 team-auth 一条入口，另两条仍可 OOM）。
 *
 * 每条判据都带**负路径**（把修复退回旧写法 ⇒ 断言必须红），由文件末尾的变异子进程验证。
 *
 * 运行：node tests/smoke/smoke-test-team-sync-livelock.mjs
 * 退出码：有 FAIL 即 1。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const REAL_SYNC = path.join(ROOT, 'lib', 'team-sync.js')
const REAL_PULL = path.join(ROOT, 'lib', 'team-pull.js')
const REAL_AUTH = path.join(ROOT, 'lib', 'team-auth.js')
const CHILD = process.env.LIVELOCK_CHILD === '1'
const SYNC_PATH = process.env.SYNC_PATH ? path.resolve(process.env.SYNC_PATH) : REAL_SYNC
const PULL_PATH = process.env.PULL_PATH ? path.resolve(process.env.PULL_PATH) : REAL_PULL
// ★#534：⑦ 的两条读体入口同样要能被变异副本替换（否则只能断言、无法反向验证）。
const REAL_S3_TRANSPORT = path.join(ROOT, 'lib', 'team-transport.js')
const REAL_HTTP_TRANSPORT = path.join(ROOT, 'lib', 'team-transport-http.js')
const S3_TRANSPORT_PATH = process.env.S3_PATH ? path.resolve(process.env.S3_PATH) : REAL_S3_TRANSPORT
const HTTP_TRANSPORT_PATH = process.env.HTTP_PATH ? path.resolve(process.env.HTTP_PATH) : REAL_HTTP_TRANSPORT

let pass = 0
let fail = 0
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra))) }
}

const loadSync = () => import(pathToFileURL(SYNC_PATH).href)
const loadPull = () => import(pathToFileURL(PULL_PATH).href)
const loadAuth = () => import(pathToFileURL(REAL_AUTH).href)

/** 一次性临时目录（跑完必删；不写系统盘 —— 本机 TEMP 曾因残留吃满 51GB）。 */
function tmpDir(tag) {
  const base = path.join(ROOT, '..', '.dsh-smoke-tmp')
  try { fs.mkdirSync(base, { recursive: true }) } catch (_) {}
  return fs.mkdtempSync(path.join(base, 'livelock-' + tag + '-'))
}

function makeEngine(extra) {
  return Object.assign({ config: Object.assign({ teamEnabled: true, teamId: 'acme' }, extra || {}), _teamPaused: false, _teamDisposed: false, _teamEpoch: 0 }, {})
}

const MB = 1024 * 1024
/** 团队出站/传输三处的响应体上限（与各 lib 模块的常量逐字一致，可复算）。 */
const AUTH_MAX_RESPONSE_BYTES = 32 * MB   // lib/team-auth.js  MAX_RESPONSE_BYTES
const TRANSPORT_MAX_RESPONSE_BYTES = 32 * MB   // lib/team-transport.js MAX_RESPONSE_BYTES
const HTTP_MAX_RESPONSE_BYTES = 64 * MB   // lib/team-transport-http.js MAX_RESPONSE_BYTES

/**
 * ★#534 测试装置：**真 ReadableStream** 响应体替身（不是字符串桩）。
 *
 * 为什么必须换掉旧装置：旧用例用 `'x'.repeat(33MiB)` 配 `text()` 桩 —— 替身自己先把
 * 33 MiB 造完，被测算的 `response.text()` 只能走「无流回退」分支，**流式路径不可观测**
 * （拉了几块、有没有 cancel 全看不到），于是「读完才判」的缺陷被钉成绿。
 *
 * 本装置暴露三个可观测物理量：pulls（底层被拉几次）/ cancelled+cancelReason（cancel 是否
 * 真调到）/ produced（实际吐了多少字节）。用真 Response 包装，与线上 fetch 同一形状。
 */
function makeStreamBody(totalBytes, chunkSize, fill) {
  const stats = { pulls: 0, cancelled: false, produced: 0, cancelReason: null }
  const stream = new ReadableStream({
    pull(controller) {
      stats.pulls += 1
      if (stats.produced >= totalBytes) { controller.close(); return }
      const n = Math.min(chunkSize, totalBytes - stats.produced)
      stats.produced += n
      controller.enqueue(new Uint8Array(n).fill(fill === undefined ? 0x78 : fill))
    },
    cancel(reason) { stats.cancelled = true; stats.cancelReason = String(reason) },
  })
  return { stream: stream, stats: stats }
}

/**
 * 变异探针源码（team-auth 专用）：变异的 team-auth 副本**不在 import 路径上**
 * （loadAuth 永远指向真文件），所以必须另起子进程真 import 变异体，把三形态响应体的
 * 可观测物理量（pulls / cancel / 解出的 JSON 值）打回父进程，由父进程断言「必须翻转」。
 * __MODULE__ 由父进程替换成变异体的 file:// URL。
 */
const AUTH_MUT_PROBE_SOURCE = [
  "import { createTeamFetch } from __MODULE__",
  "const MB = 1024 * 1024",
  "function stream(total, chunk) {",
  "  const stats = { pulls: 0, cancelled: false, produced: 0, reasons: [] }",
  "  const s = new ReadableStream({",
  "    pull(controller) {",
  "      stats.pulls += 1",
  "      if (stats.produced >= total) { controller.close(); return }",
  "      const n = Math.min(chunk, total - stats.produced)",
  "      stats.produced += n",
  "      controller.enqueue(new Uint8Array(n).fill(0x78))",
  "    },",
  "    cancel(reason) { stats.cancelled = true; stats.reasons.push(String(reason)) },",
  "  })",
  "  return { stream: s, stats: stats }",
  "}",
  "const tf = createTeamFetch({ config: { teamEnabled: true, serverUrl: 'https://t.invalid/', teamId: 'x', teamToken: 'x' } })",
  "const out = {}",
  "{",
  "  const b = stream(64 * MB, MB)",
  "  const r = await tf('p', { fetchImpl: async () => new Response(b.stream, { status: 200, headers: { 'content-length': String(64 * MB) } }) })",
  "  out.declared = { ok: r.ok, reason: r.reason, bytes: r.bytes, pulls: b.stats.pulls, cancelled: b.stats.cancelled }",
  "}",
  "{",
  "  const b = stream(64 * MB, MB)",
  "  const r = await tf('p', { fetchImpl: async () => new Response(b.stream, { status: 200 }) })",
  "  out.stream = { ok: r.ok, reason: r.reason, bytes: r.bytes, pulls: b.stats.pulls, cancelled: b.stats.cancelled }",
  "}",
  "{",
  "  const bytes = Buffer.from(JSON.stringify({ v: '中文✓😀' }), 'utf8')",
  "  let i = 0",
  "  const body = new ReadableStream({ pull(controller) { if (i >= bytes.length) { controller.close(); return } controller.enqueue(new Uint8Array([bytes[i]])); i += 1 } })",
  "  const r = await tf('p', { fetchImpl: async () => new Response(body, { status: 200 }) })",
  "  out.multiByte = { ok: r.ok, value: r.data ? r.data.v : null, textLen: typeof r.text === 'string' ? r.text.length : 0 }",
  "}",
  "console.log(JSON.stringify(out))",
].join('\n')

/** 逐字节吐出的流：用于验证「跨块多字节字符不得被逐块 decode 拆坏」。 */
function makeBytewiseBody(buffer) {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= buffer.length) { controller.close(); return }
      controller.enqueue(new Uint8Array([buffer[i]]))
      i += 1
    },
  })
}

async function main() {
  console.log('=== 团队同步活锁/幂等/上限 行为级回归' + (CHILD ? ' [变异子进程模式]' : '') + ' ===')

  // ══════════════ ① 推送体必须带幂等键 ══════════════
  {
    const { createTeamSync } = await loadSync()
    const { createTeamOutbox } = await import(pathToFileURL(path.join(ROOT, 'lib', 'team-outbox.js')).href)
    const dir = tmpDir('idem')
    try {
      const outbox = createTeamOutbox({ dir, file: path.join(dir, 'outbox.json'), maxItems: 50, diag: () => {} })
      outbox.load()
      const bodies = []
      const sync = createTeamSync({
        engine: makeEngine(), identity: { currentMember: () => ({ id: 'u1', role: 'admin' }) },
        outbox, teamFetch: async (p, o) => { bodies.push(o.body); return { ok: true } }, diag: () => {},
      })
      // 有 eventId ⇒ 用它当 idemKey
      outbox.enqueue({ kind: 'handoff', key: 'brief:/ws/MEMORY.md', eventId: 'evt-STABLE-1', payload: { path: '/ws/MEMORY.md' } })
      await sync.tick()
      ok(bodies.length === 1, '① 一条变更发出 1 个请求', bodies.length)
      ok(bodies[0] && bodies[0].idemKey === 'evt-STABLE-1', '① ★★推送体带幂等键（取 outbox 已持久化的 eventId）', bodies[0] && bodies[0].idemKey)
      ok(bodies[0] && bodies[0].eventId === 'evt-STABLE-1', '① eventId 同时单独带一份（老服务端只认该字段名也能幂等）', bodies[0] && bodies[0].eventId)
      ok(bodies[0] && bodies[0].payload && bodies[0].payload.path === '/ws/MEMORY.md', '① payload 仍是纯指针（不含文件正文）', JSON.stringify(bodies[0] && bodies[0].payload))
      ok(Buffer.byteLength(JSON.stringify(bodies[0]), 'utf8') < 512, '① 单条推送体 <512 字节（旧版 216B，加键后仍远小于 1KB）', Buffer.byteLength(JSON.stringify(bodies[0]), 'utf8'))

      // 没有 eventId ⇒ 回退 kind|key（**任何情况下都有键**）
      outbox.enqueue({ kind: 'fact', key: 'k-no-eventid', payload: { v: 1 } })
      await sync.tick()
      ok(bodies.length === 2 && bodies[1].idemKey === 'fact|k-no-eventid', '① ★无 eventId 时回退 kind|key（结构上不可能没有键）', bodies[1] && bodies[1].idemKey)

      // 失败重试：同一条事件两次发出的体必须逐字节相同（否则服务端无法按 idemKey 去重）
      let fail1 = true
      const retries = []
      const dir2 = tmpDir('retry')
      const ob2 = createTeamOutbox({ dir: dir2, file: path.join(dir2, 'outbox.json'), maxItems: 50, diag: () => {} })
      ob2.load()
      ob2.enqueue({ kind: 'fact', key: 'k-retry', eventId: 'evt-R1', payload: { v: 9 } })
      const sync2 = createTeamSync({
        engine: makeEngine(), identity: { currentMember: () => ({ id: 'u1' }) }, outbox: ob2,
        teamFetch: async (p, o) => { retries.push(JSON.stringify(o.body)); if (fail1) throw new Error('boom'); return { ok: true } }, diag: () => {},
      })
      await sync2.tick(); fail1 = false; await sync2.tick()
      ok(retries.length === 2 && retries[0] === retries[1], '① ★★重试时推送体逐字节相同（服务端可凭 idemKey 去重）', retries)
      try { fs.rmSync(dir2, { recursive: true, force: true }) } catch (_) {}
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (_) {} }
  }

  // ══════════════ ② 游标形状：字符串 / 数字都认；畸形不写 ══════════════
  {
    const { createTeamPuller, normalizeCursorPre } = await loadPull()
    ok(typeof normalizeCursorPre === 'function', '② 导出 normalizeCursorPre（可单测的纯函数）', typeof normalizeCursorPre)

    // 纯函数层
    ok(normalizeCursorPre('c_0001250').ok === true && normalizeCursorPre('c_0001250').cursor === 'c_0001250',
      '② ★纯函数接受契约字符串游标 c_0001250', normalizeCursorPre('c_0001250'))
    ok(normalizeCursorPre(42).ok === true && normalizeCursorPre(42).cursor === 42, '② 纯函数接受数字游标', normalizeCursorPre(42))
    for (const bad of ['NaN', 'Infinity', '', null, undefined, {}, [], 'a b', 'x'.repeat(201)]) {
      const labelText = (function () { try { const j = JSON.stringify(bad); return j === undefined ? String(bad) : j } catch (_) { return String(bad) } })().slice(0, 24)
      ok(normalizeCursorPre(bad).ok === false, '② ★畸形游标被拒: ' + labelText, normalizeCursorPre(bad))
    }

    // 行为层：字符串游标必须真前进（旧实现 Number.isFinite 恒假 ⇒ since 永远 0）
    const reqs = []
    const puller = createTeamPuller({
      engine: makeEngine(), appliers: { fact: () => ({ ok: true }) },
      fetchJson: async (u) => { reqs.push(u); return { ok: true, data: { cursor: 'c_0001250', changes: [] } } }, diag: () => {},
    })
    await puller.pullOnce(); await puller.pullOnce()
    ok(reqs[0].indexOf('since=0') >= 0, '② 首次请求 since=0', reqs[0])
    ok(reqs[1].indexOf('since=c_0001250') >= 0, '② ★★第二次请求带上了字符串游标（旧实现恒 since=0 ⇒ 每 5s 全量重放）', reqs[1])
    ok(puller.status().since === 'c_0001250', '② status().since 是字符串游标', puller.status().since)

    // 畸形游标 ⇒ 游标不动、URL 不被污染
    const reqs2 = []
    const p2 = createTeamPuller({
      engine: makeEngine(), appliers: { fact: () => ({ ok: true }) },
      fetchJson: async (u) => { reqs2.push(u); return { ok: true, data: { cursor: 'NaN', changes: [] } } }, diag: () => {},
    })
    await p2.pullOnce(); await p2.pullOnce()
    ok(p2.status().since === 0, '② ★畸形游标 NaN ⇒ 游标保持 0（旧实现也不写 NaN，但会静默不前进）', p2.status().since)
    ok(reqs2.every(u => u.indexOf('since=0') >= 0), '② 畸形游标不污染请求 URL', reqs2)
  }

  // ══════════════ ③ 游标跨进程持久化 ══════════════
  {
    const { createTeamPuller } = await loadPull()
    let stored = null
    let saves = 0
    const mk = () => createTeamPuller({
      engine: makeEngine(), appliers: { fact: () => ({ ok: true }) },
      fetchJson: async () => ({ ok: true, data: { cursor: 'c_42', changes: [] } }),
      loadCursor: () => stored,
      saveCursor: (c) => { saves++; stored = c; return { ok: true } },
      diag: () => {},
    })
    const a = mk()
    ok(a.status().since === 0, '③ 首次构造：无落盘游标 ⇒ since=0', a.status().since)
    await a.pullOnce()
    ok(stored === 'c_42', '③ ★★游标真前进后**落盘**（旧实现只在内存）', stored)
    ok(saves === 1, '③ 只落盘一次（并列值不重复写盘）', saves)
    await a.pullOnce()
    ok(saves === 1, '③ ★游标没变化时**不重复落盘**（避免每 tick 写盘放大 IO）', saves)

    // 等价重启：新实例从落盘值恢复
    const b = mk()
    ok(b.status().since === 'c_42', '③ ★★新实例（等价进程重启）从落盘游标恢复，不归零重拉全史', b.status().since)
    ok(b.status().cursorPersisted === true, '③ status 暴露 cursorPersisted（可观测）', b.status().cursorPersisted)

    // reset 也要落盘
    const r = b.reset()
    ok(r.ok === true && stored === 0, '③ ★reset 复位同样落盘（否则重启后又从旧游标继续）', { r, stored })

    // loadCursor 抛错 ⇒ 构造不炸、since 保持 0
    let cTor = null
    try {
      cTor = createTeamPuller({ engine: makeEngine(), appliers: {}, fetchJson: async () => ({ ok: true, data: {} }), loadCursor: () => { throw new Error('boom') }, diag: () => {} })
    } catch (e) { cTor = null }
    ok(cTor && cTor.status().since === 0, '③ ★loadCursor 抛错 ⇒ 构造不炸且 since=0（fail-soft）', cTor && cTor.status().since)
  }

  // ══════════════ ④ 回抛未请求 kind 不得永久卡死游标 ══════════════
  {
    const { createTeamPuller } = await loadPull()
    // 真实装配形状：requestKinds=['fact']，appliers 只有 fact；服务端忽略 kinds 回全量（含 handoff）
    const serverChanges = [
      { kind: 'handoff', key: 'brief:/ws/MEMORY.md', payload: { path: '/ws/MEMORY.md' } },
      { kind: 'fact', key: 'f1', payload: { v: 1 } },
    ]
    const reqs = []
    const applied = []
    const puller = createTeamPuller({
      engine: makeEngine(), requestKinds: ['fact'],
      appliers: { fact: (payload, ch) => { applied.push(ch.key); return { ok: true } } },
      fetchJson: async (u) => { reqs.push(u); const since = Number(new URL('http://x' + u).searchParams.get('since')) || 0; return { ok: true, data: { cursor: since + 2, changes: since >= 2 ? [] : serverChanges } } },
      diag: () => {},
    })
    const r1 = await puller.pullOnce()
    ok(r1.ok === true, '④ ★★回抛未请求 kind ⇒ 不再判成临时失败（旧实现 ok:false + retryable）', { ok: r1.ok, deferred: r1.deferred, rejected: r1.rejected })
    ok(r1.deferred === 0 && r1.rejected === 1, '④ 计数：1 rejected（不该应用）/ 0 deferred（不是临时失败）', { deferred: r1.deferred, rejected: r1.rejected })
    ok(r1.applied === 1 && applied[0] === 'f1', '④ 本次请求的 fact 照常应用', { applied: r1.applied })
    ok(puller.status().since === 2, '④ ★游标前进了（旧实现永久卡在 0）', puller.status().since)
    const r2 = await puller.pullOnce()
    ok(reqs[1].indexOf('since=2') >= 0 && r2.total === 0, '④ ★第二次只拿到增量（不再重放全史）', { req: reqs[1], total: r2.total })

    // ★#364 语义必须保留：**本次请求内**缺 applier ⇒ 仍然 transient（游标别前进，等能力补上）
    const p364 = createTeamPuller({
      engine: makeEngine(), requestKinds: ['fact'], appliers: {},
      fetchJson: async () => ({ ok: true, data: { cursor: 99, changes: [{ kind: 'fact', key: 'k', payload: {} }] } }),
      diag: () => {},
    })
    const r364 = await p364.pullOnce()
    ok(r364.ok === false && r364.retryable === true, '④ ★负路径：请求内缺 applier ⇒ 仍 transient（#364 语义不许退回）', { ok: r364.ok, retryable: r364.retryable })
    ok(p364.status().since === 0, '④ ★#364 语义：此时游标不前进（能力补齐后可重放）', p364.status().since)
  }

  // ══════════════ ⑤ 响应体上限（★#534：上限**必须在读取阶段**生效） ══════════════
  {
    const { createTeamFetch } = await loadAuth()
    const tf = createTeamFetch({ config: { teamEnabled: true, serverUrl: 'https://t.invalid/', teamId: 'x', teamToken: 'x' } })

    // ⑤a content-length 预检：连第一块都不拉，并且**必须释放 body**
    const decl = makeStreamBody(64 * MB, MB)
    const rDeclared = await tf('p', { fetchImpl: async () => new Response(decl.stream, { status: 200, headers: { 'content-length': String(64 * MB) } }) })
    ok(rDeclared.ok === false && rDeclared.reason === 'response-too-large', '⑤ ★★content-length 超限 ⇒ 明确失败 response-too-large', { ok: rDeclared.ok, reason: rDeclared.reason })
    ok(decl.stats.pulls <= 1, '⑤ ★★超限时**根本不读响应体**（旧实现无条件 text() 把整份读进内存）', decl.stats.pulls)
    ok(decl.stats.cancelled === true, '⑤ ★★预检命中后**释放 body**（旧实现 return 前不 cancel，12GB 响应体继续被拉）', { cancelled: decl.stats.cancelled, reason: decl.stats.cancelReason })
    ok(rDeclared.maxBytes === AUTH_MAX_RESPONSE_BYTES, '⑤ 上限取值 = 32MB（可复算）', rDeclared.maxBytes)

    // ⑤b ★核心：**没有** content-length 的 64 MiB 流式响应 —— 上限必须在 read() 循环里生效。
    //    旧实现先 `await response.text()` 再比字节数 ⇒ 64 MiB 全部驻留、pulls=65、cancel 未触发。
    const live = makeStreamBody(64 * MB, MB)
    const rActual = await tf('p', { fetchImpl: async () => new Response(live.stream, { status: 200 }) })
    ok(rActual.ok === false && rActual.reason === 'response-too-large', '⑤ ★★无 content-length 时同样明确失败', { ok: rActual.ok, reason: rActual.reason })
    ok(typeof rActual.bytes === 'number' && rActual.bytes > AUTH_MAX_RESPONSE_BYTES && rActual.bytes <= AUTH_MAX_RESPONSE_BYTES + MB,
      '⑤ ★★bytes 是**首个越限块**的已读字节（32MiB+1 块），不是全量 64MiB', rActual.bytes)
    //  32 块判限 + 1 判定块 + ≤1 块流内预取 = 34（实测）；旧实现满读需 65 次 pull。
    ok(live.stats.pulls <= 34, '⑤ ★★只拉了 ≤34 块就停（旧实现满读 65 次 pull）', live.stats.pulls)
    ok(live.stats.cancelled === true && live.stats.cancelReason === 'response-too-large',
      '⑤ ★★reader.cancel("response-too-large") 真的调到了底层流（旧实现 cancelled=false）', { cancelled: live.stats.cancelled, reason: live.stats.cancelReason })

    // ⑤c 无流回退（只有 text() 的桩 / 204 / HEAD）：结论一致，只是拦不住峰值
    const big = 'x'.repeat(33 * MB)
    const rNoStream = await tf('p', { fetchImpl: async () => ({ status: 200, text: async () => big }) })
    ok(rNoStream.ok === false && rNoStream.reason === 'response-too-large' && rNoStream.bytes > AUTH_MAX_RESPONSE_BYTES,
      '⑤ 无流可读的桩：回退整读但仍按实测字节拒绝', { ok: rNoStream.ok, bytes: rNoStream.bytes })

    // ⑤d ★跨块多字节字符：1 字节一块地喂 JSON —— 逐块 decode 会得到 U+FFFD
    const jsonBytes = Buffer.from(JSON.stringify({ v: '中文✓😀' }), 'utf8')
    const rMulti = await tf('p', { fetchImpl: async () => new Response(makeBytewiseBody(jsonBytes), { status: 200 }) })
    ok(rMulti.ok === true && rMulti.data && rMulti.data.v === '中文✓😀',
      '⑤ ★★跨块多字节字符不被拆坏（合并后一次性 decode，不是逐块 decode）', { ok: rMulti.ok, v: rMulti.data && rMulti.data.v })

    // ⑤e ★读体改成流式后，#370 的超时/中止语义必须原样保留：
    //    流永不吐数据时，只能靠本模块计时器中止 —— reader.read() 必须能被 abort 打断。
    const slowStart = Date.now()
    const rTimeout = await tf('p', {
      timeoutMs: 50,
      fetchImpl: async (u, o) => new Response(new ReadableStream({
        start(c) { o.signal.addEventListener('abort', () => { try { c.error(new Error('aborted')) } catch (_) {} }) },
        pull() { /* 永不吐数据 */ },
      }), { status: 200 }),
    })
    ok(rTimeout.ok === false && rTimeout.reason === 'timeout',
      '⑤ ★★流式读体期间的超时仍判 timeout（#370 错误传播不回退）', { ok: rTimeout.ok, reason: rTimeout.reason, ms: Date.now() - slowStart })

    // 负路径：正常小体 / 头畸形 / 204 空体都不得被误判
    const rSmall = await tf('p', { fetchImpl: async () => ({ status: 200, headers: { get: () => '2' }, text: async () => '{}' }) })
    ok(rSmall.ok === true, '⑤ ★负路径：正常小响应不受影响', { ok: rSmall.ok, status: rSmall.status })
    const rBadHeader = await tf('p', { fetchImpl: async () => ({ status: 200, headers: { get: () => 'not-a-number' }, text: async () => '{"ok":true}' }) })
    ok(rBadHeader.ok === true, '⑤ ★负路径：content-length 头畸形 ⇒ 退回实测，不误判', { ok: rBadHeader.ok })
    const r204 = await tf('p', { fetchImpl: async () => ({ status: 204, text: async () => '' }) })
    ok(r204.ok === true, '⑤ ★负路径：204 空体仍算成功', { ok: r204.ok })
  }

  // ══════════════ ⑥ 分页参数（服务端可忽略） ══════════════
  {
    const { createTeamPuller } = await loadPull()
    const reqs = []
    const p = createTeamPuller({
      engine: makeEngine(), appliers: { fact: () => ({ ok: true }) }, pageLimit: 200,
      fetchJson: async (u) => { reqs.push(u); return { ok: true, data: { cursor: 1, changes: [] } } }, diag: () => {},
    })
    await p.pullOnce()
    ok(reqs[0].indexOf('limit=200') >= 0, '⑥ 配置 pageLimit ⇒ 请求带 limit（服务端可忽略，老服务端零影响）', reqs[0])
    const p0 = createTeamPuller({ engine: makeEngine(), appliers: {}, pageLimit: 0, fetchJson: async (u) => { reqs.push(u); return { ok: true, data: {} } }, diag: () => {} })
    await p0.pullOnce()
    ok(reqs[1].indexOf('limit=') < 0, '⑥ pageLimit=0 ⇒ 不带 limit 参数（显式关闭）', reqs[1])
  }

  // ══════════════ ⑦ 同批同类点（★#534 家族）：另外两条「读体入口」也必须同上限 ══════════════
  //   只修 team-auth 一条入口，另两条仍可 OOM（同一缺陷三处实例，必须一次改全）。
  {
    // ⑦a lib/team-transport.js 的 S3 doRequest：旧实现 `const text = await res.text()` 全程无上限
    {
      const { createS3Backend } = await import(pathToFileURL(S3_TRANSPORT_PATH).href)
      const live = makeStreamBody(64 * MB, MB)
      const be = createS3Backend({
        endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', bucket: 'b', region: 'cn-hangzhou',
        accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'SECRETEXAMPLE',
        fetchImpl: async () => new Response(live.stream, { status: 200 }),
      })
      const r = await be.get('team/k.json')
      ok(r.ok === false && /s3-response-too-large/.test(String(r.error)),
        '⑦ ★★S3 get：超大响应明确失败（旧实现整份读入内存并返回 ok:true）', { ok: r.ok, error: r.error })
      ok(typeof r.bytes === 'number' && r.bytes > TRANSPORT_MAX_RESPONSE_BYTES && r.bytes <= TRANSPORT_MAX_RESPONSE_BYTES + MB,
        '⑦ S3 失败带**首个越限块**的已读字节（可复算）', r.bytes)
      ok(live.stats.pulls <= 34 && live.stats.cancelled === true,
        '⑦ ★★S3 在读取阶段截断并 cancel（旧实现满读 65 次 pull、cancel 未触发）', { pulls: live.stats.pulls, cancelled: live.stats.cancelled })
    }

    // ⑦b lib/team-transport-http.js 的 fetch 适配器：旧实现裸用 res.arrayBuffer()（无界），
    //    而同文件 baseRequest 早有上限 ⇒ 一旦注入 fetchImpl，同一条上限立刻失守。
    {
      const { createHttpBackend } = await import(pathToFileURL(HTTP_TRANSPORT_PATH).href)
      //  96 MiB / 12 MiB 一块：第 6 块（72 MiB）越 64 MiB 上限 ⇒ 余下 24 MiB 必须不被拉。
      //  （若总量刚好等于上限+1 块，越限块就是最后一块，cancel 已无内容可取消 ⇒ 观察不到早停。）
      const live = makeStreamBody(96 * MB, 12 * MB)
      const be = createHttpBackend({ endpoint: 'http://10.0.0.7:8080', fetchImpl: async () => new Response(live.stream, { status: 200 }) })
      const r = await be.get('team/k.json')
      ok(r.ok === false && /http-response-too-large/.test(String(r.error)),
        '⑦ ★★http(get, 注入 fetchImpl)：超大响应明确失败（旧实现裸用 arrayBuffer() 无界）', { ok: r.ok, error: r.error })
      ok(live.stats.pulls <= 7, '⑦ ★★只拉了 ≤7 块（12MiB/块）就停', live.stats.pulls)
      ok(live.stats.cancelled === true, '⑦ ★★fetch 适配器也 cancel 了底层流（旧实现 cancel 未触发）', live.stats.cancelled)
      ok(live.stats.produced < 96 * MB, '⑦ 余下响应体确实没被读（produced < 96MiB）', live.stats.produced)
      ok(HTTP_MAX_RESPONSE_BYTES === 64 * MB, '⑦ http 后端上限常量 = 64MiB（与 baseRequest 同一常量，可复算）', HTTP_MAX_RESPONSE_BYTES)
    }
  }

  // ══════════════ 变异反向验证（父进程） ══════════════
  if (!CHILD) {
    const syncSrc = fs.readFileSync(REAL_SYNC, 'utf8').replace(/\r\n/g, '\n')
    const pullSrc = fs.readFileSync(REAL_PULL, 'utf8').replace(/\r\n/g, '\n')
    const authSrc = fs.readFileSync(REAL_AUTH, 'utf8').replace(/\r\n/g, '\n')
    const s3Src = fs.readFileSync(REAL_S3_TRANSPORT, 'utf8').replace(/\r\n/g, '\n')
    const httpSrc = fs.readFileSync(REAL_HTTP_TRANSPORT, 'utf8').replace(/\r\n/g, '\n')

    const muts = [
      // ★#511（2026-11-02）：判据过期重钉 —— idemKey 已改为三形态（eventId → kind|key|opKey → kind|key），
      //   原锚串逐字失配（hits:0）。变异目标改为「去掉 opKey 片段」，判据意图不变：
      //   幂等键不再携带操作身份 ⇒ 同事件不同操作的 idemKey 全部退化成 event|evt_X ⇒ 必红。
      ['M1 幂等键缺失', syncSrc, "        idemKey: eventId || (kindText + '|' + keyText + (opKey ? '|' + opKey : '')),\n", ''],
      ['M2 游标退回只认数字', pullSrc, "  if (typeof raw === 'string') {", "  if (false) {"],
      ['M3 游标不落盘', pullSrc, "        persistCursorPre()\n", "\n"],
      ['M4 no-applier 一律 transient', pullSrc, "      const wantedPre = !requestedKinds || requestedKinds.indexOf(kind) >= 0\n      return { ok: false, transient: wantedPre, code: 'no-applier' }", "      return { ok: false, transient: true, code: 'no-applier' }"],
      ['M5 预检上限失效', authSrc, "      if (declaredBytes !== null && declaredBytes > MAX_RESPONSE_BYTES) {", "      if (false) {"],
      // ★#534：M5 只覆盖 content-length 预检；真正拦住 64 MiB 的是 readBodyText 里的**流式判限**，
      //   以及「合并后一次性 decode」。两条都必须有各自的反向验证，否则「预检在」就能掩盖流式缺陷。
      ['M6 流式判限失效', authSrc, "      if (total > limit) {", "      if (false) {"],
      ['M7 逐块 decode', authSrc, "  return { tooLarge: false, bytes: total, text: toText(decodeUtf8(merged)) }",
        "  return { tooLarge: false, bytes: total, text: toText(chunks.map(function (c) { return decodeUtf8(c) }).join('')) }"],
      // ★#534 同批同类点：S3 与 http-fetch 两条读体入口各有自己的判限行，必须各自反向验证 ——
      //   否则「改回无界」只会让 ⑦ 红而 ⑤ 仍绿，无法定位是哪条入口失守。
      ['M8 S3 读体上限失效', s3Src, "        if (total > limit) {", "        if (false) {"],
      ['M9 http fetch 读体上限失效', httpSrc, "      if (total > limit) {", "      if (false) {"],
    ]
    for (const [label, base, from, to] of muts) {
      const hits = base.split(from).length - 1
      ok(hits === 1, '变异定位:' + label + ' 锚点恰命中 1 次', { hits })
      if (hits !== 1) continue
      const isAuth = /^M[567] /.test(label)
      const isS3Mut = label.indexOf('M8') === 0
      const isHttpMut = label.indexOf('M9') === 0
      const target = isAuth ? REAL_AUTH : isS3Mut ? REAL_S3_TRANSPORT : isHttpMut ? REAL_HTTP_TRANSPORT
        : (label.indexOf('M1') === 0 ? REAL_SYNC : REAL_PULL)
      const mp = path.join(os.tmpdir(), 'mut-livelock-' + label.replace(/[^a-z0-9]/gi, '') + path.extname(target))
      fs.writeFileSync(mp, base.replace(from, to))
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 160))
      const env = Object.assign({}, process.env, { LIVELOCK_CHILD: '1' })
      if (label.indexOf('M1') === 0) env.SYNC_PATH = mp
      else if (isS3Mut) env.S3_PATH = mp
      else if (isHttpMut) env.HTTP_PATH = mp
      else if (!isAuth) env.PULL_PATH = mp

      if (isAuth) {
        // team-auth 的变异副本**不在 import 路径上**（loadAuth 永远指向真文件）⇒ 用子进程真跑探针：
        //   探针真 import 变异体，跑三形态响应体（预检 / 流式 / 跨块多字节），把 pulls、cancel、
        //   解出的 JSON 值打回父进程；父进程断言「对应的可观测物理量必须翻转」。
        const probe = path.join(os.tmpdir(), 'mut-livelock-auth-probe.mjs')
        fs.writeFileSync(probe, AUTH_MUT_PROBE_SOURCE.replace('__MODULE__', JSON.stringify(pathToFileURL(mp).href)))
        const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', maxBuffer: 1 << 27 })
        const out = String(r.stdout || '')
        let obs = null
        try { obs = JSON.parse(out.trim().split('\n').pop()) } catch (_) { obs = null }
        ok(!!obs, '★变异探针可解析(' + label + ')', out.trim().slice(0, 200))
        if (label.indexOf('M5') === 0) {
          ok(!!obs && obs.declared && obs.declared.pulls > 2,
            '★变异必红(' + label + '):关掉预检后确实开始拉流（修后此处 pulls<=1）', obs && obs.declared)
        } else if (label.indexOf('M6') === 0) {
          ok(!!obs && obs.stream && obs.stream.pulls > 40 && obs.stream.cancelled === false,
            '★变异必红(' + label + '):关掉流式判限 ⇒ 64MiB 全读入且 cancel 未触发', obs && obs.stream)
        } else {
          ok(!!obs && obs.multiByte && obs.multiByte.value !== '中文✓😀',
            '★变异必红(' + label + '):逐块 decode 把跨块多字节字符拆成 U+FFFD', obs && obs.multiByte)
        }
        console.log('  [变异取证] ' + label + ' -> ' + JSON.stringify(obs))
        try { fs.rmSync(probe, { force: true }) } catch (_) {}
        try { fs.rmSync(mp, { force: true }) } catch (_) {}
        continue
      }

      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env, encoding: 'utf8', maxBuffer: 1 << 26 })
      const out = String(r.stdout || '') + String(r.stderr || '')
      const m = out.match(/pass=(\d+) fail=(\d+)/)
      ok(r.status !== 0, '★变异必红(' + label + '):子进程退出码非 0', { status: r.status })
      ok(/FAIL - /.test(out), '★变异必红(' + label + '):是断言红不是崩溃', out.slice(-260))
      ok(!!m && Number(m[2]) > 0, '★变异必红(' + label + '):fail>0', m ? m[0] : '(未取到计数)')
      console.log('  [变异取证] ' + label + ' -> ' + (m ? m[0] : '?') + ' exit=' + r.status)
      try { fs.rmSync(mp, { force: true }) } catch (_) {}
    }
  }

  console.log('pass=' + pass + ' fail=' + fail)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error('套件自身异常:', (e && e.stack) || e)
  process.exit(1)
})
