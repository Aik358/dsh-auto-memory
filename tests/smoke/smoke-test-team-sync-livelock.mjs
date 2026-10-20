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
 * ## 本套件钉住的五条判据（全部**真 import → 真构造 → 真调用 → 断言返回值**）
 *   ① 推送体**必须**带 idemKey（有 eventId 用 eventId；没有则回退 kind|key），且同一事件重试时**逐字节相同**；
 *   ② 游标接受**字符串形状**（契约 `c_0001250`）与数字形状；畸形值不写进游标；
 *   ③ 游标**跨进程持久化**（注入 loadCursor/saveCursor；重启后不归零）；
 *   ④ 服务端回抛「本次没请求的 kind」不得永久卡死游标（旧实现每 tick 都 deferred ⇒ 活锁）；
 *   ⑤ 响应体超过上限 ⇒ 明确 `response-too-large` 失败，且**不把响应读进内存**。
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

  // ══════════════ ⑤ 响应体上限 ══════════════
  {
    const { createTeamFetch } = await loadAuth()
    const tf = createTeamFetch({ config: { teamEnabled: true, serverUrl: 'https://t.invalid/', teamId: 'x', teamToken: 'x' } })

    let readCalled = false
    const rDeclared = await tf('p', { fetchImpl: async () => ({ status: 200, headers: { get: () => String(64 * 1024 * 1024) }, text: async () => { readCalled = true; return 'x' } }) })
    ok(rDeclared.ok === false && rDeclared.reason === 'response-too-large', '⑤ ★★content-length 超限 ⇒ 明确失败 response-too-large', { ok: rDeclared.ok, reason: rDeclared.reason })
    ok(readCalled === false, '⑤ ★★超限时**根本不读响应体**（旧实现无条件 text() 把整份读进内存）', readCalled)
    ok(rDeclared.maxBytes === 32 * 1024 * 1024, '⑤ 上限取值 = 32MB（可复算）', rDeclared.maxBytes)

    const big = 'x'.repeat(33 * 1024 * 1024)
    const rActual = await tf('p', { fetchImpl: async () => ({ status: 200, text: async () => big }) })
    ok(rActual.ok === false && rActual.reason === 'response-too-large' && rActual.bytes > 32 * 1024 * 1024,
      '⑤ ★无 content-length 时按实测字节兜底拒绝', { ok: rActual.ok, bytes: rActual.bytes })

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

  // ══════════════ 变异反向验证（父进程） ══════════════
  if (!CHILD) {
    const syncSrc = fs.readFileSync(REAL_SYNC, 'utf8').replace(/\r\n/g, '\n')
    const pullSrc = fs.readFileSync(REAL_PULL, 'utf8').replace(/\r\n/g, '\n')
    const authSrc = fs.readFileSync(REAL_AUTH, 'utf8').replace(/\r\n/g, '\n')

    const muts = [
      ['M1 幂等键退回旧写法', syncSrc, "        idemKey: eventId || (kindText + '|' + keyText),", ''],
      ['M2 游标退回只认数字', pullSrc, "  if (typeof raw === 'string') {", "  if (false) {"],
      ['M3 游标不落盘', pullSrc, "        persistCursorPre()\n", "\n"],
      ['M4 no-applier 一律 transient', pullSrc, "      const wantedPre = !requestedKinds || requestedKinds.indexOf(kind) >= 0\n      return { ok: false, transient: wantedPre, code: 'no-applier' }", "      return { ok: false, transient: true, code: 'no-applier' }"],
      ['M5 响应体上限失效', authSrc, "      if (declaredBytes !== null && declaredBytes > MAX_RESPONSE_BYTES) {", "      if (false) {"],
    ]
    for (const [label, base, from, to] of muts) {
      const hits = base.split(from).length - 1
      ok(hits === 1, '变异定位:' + label + ' 锚点恰命中 1 次', { hits })
      if (hits !== 1) continue
      const isAuth = label.indexOf('M5') === 0
      const target = isAuth ? REAL_AUTH : (label.indexOf('M1') === 0 ? REAL_SYNC : REAL_PULL)
      const mp = path.join(os.tmpdir(), 'mut-livelock-' + label.replace(/[^a-z0-9]/gi, '') + path.extname(target))
      fs.writeFileSync(mp, base.replace(from, to))
      const syn = spawnSync(process.execPath, ['--check', mp], { encoding: 'utf8' })
      ok(syn.status === 0, '变异文件语法可用(' + label + ')', String(syn.stderr || '').slice(0, 160))
      const env = Object.assign({}, process.env, { LIVELOCK_CHILD: '1' })
      if (label.indexOf('M1') === 0) env.SYNC_PATH = mp
      else if (label.indexOf('M5') === 0) env.AUTH_MUT = mp   // M5 走真实 team-auth 副本不会被 import，改为源码断言
      else env.PULL_PATH = mp

      if (isAuth) {
        // team-auth 副本不在 import 路径上 ⇒ 用「同源行为探针」证明变异必红：
        // 变异体里预检被关掉，此时超大响应会**真的被读取**（readCalled 变 true）。用子进程真跑一遍。
        const probe = path.join(os.tmpdir(), 'mut-livelock-m5-probe.mjs')
        fs.writeFileSync(probe, [
          "import { createTeamFetch } from " + JSON.stringify(pathToFileURL(mp).href),
          "let readCalled = false",
          "const tf = createTeamFetch({ config: { teamEnabled: true, serverUrl: 'https://t.invalid/', teamId: 'x', teamToken: 'x' } })",
          "const r = await tf('p', { fetchImpl: async () => ({ status: 200, headers: { get: () => String(64*1024*1024) }, text: async () => { readCalled = true; return 'x' } }) })",
          "console.log(JSON.stringify({ ok: r.ok, reason: r.reason, readCalled }))",
        ].join('\n'))
        const r = spawnSync(process.execPath, [probe], { encoding: 'utf8', maxBuffer: 1 << 24 })
        const out = String(r.stdout || '') + String(r.stderr || '')
        ok(out.indexOf('"readCalled":true') >= 0, '★变异必红(' + label + '):关掉上限后确实把 64MB 响应读了进来', out.trim().slice(0, 200))
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
