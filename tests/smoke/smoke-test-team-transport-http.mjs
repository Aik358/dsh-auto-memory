#!/usr/bin/env node
/**
 * smoke-test-team-transport-http.mjs —— B11e T2「涉密内网自建服务端」后端 ★真执行验收（CR-10）。
 *
 * ★CR-10 纪律：本套件**真 import 模块、真构造后端、真调用三动词、断言返回值**，
 *   并由 node:http 真起一个**内存版协议服务器**（真 socket、真请求、真响应）。
 *   不以「读源码找字符串」充当功能验收。含**负路径**（该失败时必须失败），否则守卫恒真。
 *
 * ★覆盖范围：只覆盖**独立模块** 'lib/team-transport-http.js'（createHttpBackend）。
 *   本套件**不**触碰 lib/team-transport.js 的接线状态 —— 'transport: "http"' 目前仍是
 *   构造即抛（"未实装；不静默降级到 s3"），该行为归 B11b 的 smoke-test-team-transport.mjs 管。
 *
 * 覆盖：
 *  A. 接缝形式：返回对象恰好含 put/get/list 三个自有可枚举键（与产线动词表同集合）
 *  B. put→get 往返**逐字节相同**（含二进制 0x00/0xFF 与 CJK 多字节）；空值 / bad-key / not-found
 *  C. list 前缀过滤（服务端权威执行）+ 全序排序 + 前缀是**纯字符串**（跨 '/' 边界）
 *  D. ★负路径 1：401 ⇒ 明确失败（**不得**当成成功、**不得**误判成 not-found）+ 正对照（带对 token 成功）
 *  E. 键语义：withPrefix / withoutPrefix 与 team-transport.js（经 MemoryBackend）**产出逐字节相同**
 *  F. ★负路径 2：500（put / get / list 三路）⇒ {ok:false} 且 error 非空且**不**误判 not-found
 *  G. ★负路径 3：未配置 endpoint ⇒ **构造即抛**，且 **netCalls === 0**（零网络请求）
 *  H. ★负路径 4：**绝不 fallback 到 S3** —— 把全局 fetch 换成会抛的桩，三动词仍全部成功且
 *     fetchCalls === 0；再用「同样的桩 + 完整 S3 配置」做**正对照**证明该桩确实能抓住 S3 出网
 *  I. 传输面负路径：连接被拒 / 响应超时 ⇒ 收敛为 {ok:false} 且**不外抛**；零第三方依赖（import 面守卫）
 *  J. 请求形态物理量：Bearer 头逐字、URL 路径编码逐字（CJK 键）、objectsPath 覆盖、endpoint 带子路径
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createHttpBackend } from '../../lib/team-transport-http.js'
import { createMemoryBackend, createS3Backend, TEAM_TRANSPORT_VERBS } from '../../lib/team-transport.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODULE_PATH = path.resolve(HERE, '..', '..', 'lib', 'team-transport-http.js')

let pass = 0, fail = 0
const failures = []
function ok(cond, name, got) {
  if (cond) { pass++ } else { fail++; failures.push(name + (got === undefined ? '' : ' | got=' + JSON.stringify(got))) }
}
function eq(a, b, name) { ok(a === b, name, { actual: a, expected: b }) }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }

/**
 * startServer —— 内存版 T2 协议服务器（真 socket；无需数据库）。
 * 路由：PUT/GET /objects/<key>、GET /objects?prefix=<p>（子路径亦可，例 /api/objects/...）。
 * 选项：requireToken / failPut / failGet / failList / hangGet。
 */
async function startServer(options) {
  const opts = options || {}
  const store = new Map()
  const requests = []
  const server = http.createServer(function (req, res) {
    const chunks = []
    req.on('data', function (c) { chunks.push(c) })
    req.on('end', function () {
      const body = Buffer.concat(chunks)
      const u = new URL(req.url, 'http://127.0.0.1')
      const idx = u.pathname.indexOf('/objects')
      const rest = idx >= 0 ? u.pathname.slice(idx + '/objects'.length) : null
      const isCollection = rest === '' || rest === '/'
      const key = (!isCollection && rest) ? decodeURIComponent(rest.slice(1)) : ''
      requests.push({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body: body })
      if (opts.hangGet && !isCollection && req.method === 'GET') return  /* 故意不响应：验超时 */
      if (opts.requireToken && u.searchParams.get('noauth') !== '1') {
        if (req.headers.authorization !== 'Bearer ' + opts.requireToken) {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end('{"error":"unauthorized"}')
          return
        }
      }
      if (opts.failPut && req.method === 'PUT') { res.writeHead(500); res.end('{"error":"boom"}'); return }
      if (opts.failGet && !isCollection && req.method === 'GET') { res.writeHead(500); res.end('{"error":"boom"}'); return }
      if (opts.failList && isCollection && req.method === 'GET') { res.writeHead(500); res.end('{"error":"boom"}'); return }
      if (isCollection && req.method === 'GET') {
        const p = u.searchParams.get('prefix') || ''
        const keys = []
        store.forEach(function (_v, k) { if (!p || k.indexOf(p) === 0) keys.push(k) })
        keys.sort()
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ keys: keys }))
        return
      }
      if (req.method === 'PUT') {
        store.set(key, body)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, bytes: body.length }))
        return
      }
      if (req.method === 'GET') {
        if (!store.has(key)) { res.writeHead(404); res.end('not found'); return }
        res.writeHead(200)
        res.end(store.get(key))
        return
      }
      res.writeHead(405); res.end()
    })
  })
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r) })
  return {
    base: 'http://127.0.0.1:' + server.address().port,
    store: store,
    requests: requests,
    close: function () {
      return new Promise(function (r) {
        try { if (typeof server.closeAllConnections === 'function') server.closeAllConnections() } catch (_) { }
        server.close(function () { r() })
      })
    },
  }
}

/**
 * isActualNetworkActivity —— 判据辅助：错误文案是否来自**真实网络活动**（DNS/连接/超时）。
 * 用途：证明「连接被拒」「超时」这类负路径不是本地配置早退（否则该负路径是恒真守卫）。
 */
function isActualNetworkActivity(errorText) {
  const t = String(errorText || '')
  return t.indexOf('http-request-failed') >= 0
    && (t.indexOf('ENOTFOUND') >= 0 || t.indexOf('ECONNREFUSED') >= 0 || t.indexOf('http-timeout') >= 0 || t.indexOf('ETIMEDOUT') >= 0 || t.indexOf('socket hang up') >= 0)
}

async function main() {
  /* ═══ A. 接缝形式（与产线动词表同集合） ═══ */
  const srvA = await startServer({})
  const a = createHttpBackend({ endpoint: srvA.base })
  eq(Object.keys(a).sort().join(','), 'get,list,put', 'A1 接缝恰好三动词（自有可枚举键）')
  eq(Object.keys(a).sort().join(','), TEAM_TRANSPORT_VERBS.slice().sort().join(','), 'A2 ★与 team-transport.js 的动词表同集合（接缝同形）')
  eq(typeof a.put, 'function', 'A3 put 是函数')
  eq(typeof a.get, 'function', 'A4 get 是函数')
  eq(typeof a.list, 'function', 'A5 list 是函数')

  /* ═══ B. put→get 真往返（逐字节） ═══ */
  const TEXT = 'hello-团队-2026'
  const b1 = await a.put('team/a.json', TEXT)
  ok(b1.ok === true, 'B1 put 成功', b1)
  eq(b1.key, 'team/a.json', 'B1b put 回显键')
  eq(b1.bytes, Buffer.byteLength(TEXT, 'utf8'), 'B1c ★put 回显字节数（utf8 字节，非 String.length）')
  const b2 = await a.get('team/a.json')
  ok(b2.ok === true, 'B2 get 成功', b2)
  eq(sha256(b2.value), sha256(Buffer.from(TEXT, 'utf8')), 'B3 ★★往返逐字节相同（sha256 相等）')
  eq(b2.bytes, Buffer.byteLength(TEXT, 'utf8'), 'B3b get 回显字节数一致')

  const BIN = Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff, 0xfe, 0x0a, 0x0d])
  const b3 = await a.put('team/bin', BIN)
  eq(b3.bytes, 8, 'B4 二进制 put 字节数 = 8')
  const b4 = await a.get('team/bin')
  ok(b4.ok === true, 'B5 二进制 get 成功', b4)
  eq(sha256(b4.value), sha256(BIN), 'B6 ★★二进制（含 0x00/0xFF）往返逐字节相同')
  eq(b4.value.length, 8, 'B6b 二进制长度 8（未被截断/转义）')

  const CJK_KEY = '团队/键-中文.json'
  await a.put(CJK_KEY, '值')
  const b5 = await a.get(CJK_KEY)
  eq(b5.ok === true && b5.value.toString('utf8'), '值', 'B7 ★CJK 键往返成功（URL 编码正确）')

  const b6 = await a.put('team/empty', '')
  eq(b6.ok, true, 'B8 空值 put 成功')
  eq(b6.bytes, 0, 'B8b 空值字节数 = 0')
  const b7 = await a.get('team/empty')
  eq(b7.ok, true, 'B9 空值 get 成功')
  eq(b7.bytes, 0, 'B9b 空值 get 字节数 = 0（不是 not-found）')

  const b8 = await a.put('', 'x')
  eq(b8.ok, false, 'B10 空键 put ⇒ ok:false')
  eq(b8.error, 'bad-key', 'B10b ★错误文案 = bad-key（与 S3/Memory 逐字对齐）')
  const b9 = await a.get('')
  eq(b9.error, 'bad-key', 'B10c 空键 get ⇒ bad-key')
  const b10 = await a.get('team/none.json')
  eq(b10.ok, false, 'B11 不存在的键 ⇒ ok:false')
  eq(b10.error, 'not-found', 'B11b ★错误文案 = not-found（与 S3/Memory 逐字对齐）')

  /* ═══ C. list 前缀过滤（服务端权威执行） ═══ */
  const srvC = await startServer({})
  const c = createHttpBackend({ endpoint: srvC.base })
  await c.put('team/a.json', 'A')
  await c.put('team/ab.json', 'AB')
  await c.put('team/sub/c.json', 'C')
  await c.put('other/x.json', 'X')
  const c1 = await c.list('team/')
  ok(c1.ok === true, 'C1 list 成功', c1)
  eq(JSON.stringify(c1.keys), JSON.stringify(['team/a.json', 'team/ab.json', 'team/sub/c.json']), 'C2 ★list 前缀过滤 + 全序排序')
  const c2 = await c.list('team/a')
  eq(JSON.stringify(c2.keys), JSON.stringify(['team/a.json', 'team/ab.json']), 'C3 ★前缀是纯字符串匹配（跨 / 边界命中 a.json 与 ab.json）')
  const c3 = await c.list('team/sub/')
  eq(JSON.stringify(c3.keys), JSON.stringify(['team/sub/c.json']), 'C4 二级前缀过滤正确')
  const c4 = await c.list('')
  eq(c4.keys.length, 4, 'C5 空前缀 ⇒ 全部 4 条')
  const c5 = await c.list('nope/')
  eq(JSON.stringify(c5.keys), '[]', 'C6 无命中前缀 ⇒ 空数组（ok 仍为 true）')
  eq(c5.ok, true, 'C6b 无命中 ≠ 失败')
  const c6 = await c.list('other/')
  eq(JSON.stringify(c6.keys), JSON.stringify(['other/x.json']), 'C7 另一前缀只取自己那棵子树')
  eq(srvC.requests.filter(function (r) { return r.method === 'GET' && r.search.indexOf('prefix=') >= 0 }).length >= 1, true, 'C8 前缀确实作为查询参数发给了服务端（不由客户端本地过滤）')

  /* ═══ D. ★负路径 1：401 必须响亮失败 ═══ */
  const srvD = await startServer({ requireToken: 'sekret' })
  const dNo = createHttpBackend({ endpoint: srvD.base })
  const d1 = await dNo.put('k', 'v')
  eq(d1.ok, false, 'D1 ★无 token ⇒ put 失败（401 不得当成成功）')
  ok(typeof d1.error === 'string' && d1.error.length > 0, 'D1b error 非空', d1)
  ok(d1.error.indexOf('401') >= 0, 'D1c 错误文案点明 401', d1.error)
  const d2 = await dNo.get('k')
  eq(d2.ok, false, 'D2 ★无 token ⇒ get 失败')
  eq(d2.error, 'http-get-status: 401', 'D2b ★401 ≠ not-found（逐字文案）')
  ok(d2.error !== 'not-found', 'D2c ★不得把 401 误判成 not-found')
  const d3 = await dNo.list('')
  eq(d3.ok, false, 'D3 ★无 token ⇒ list 失败')
  eq(d3.error, 'http-list-status: 401', 'D3b list 的 401 文案')
  const dGood = createHttpBackend({ endpoint: srvD.base, token: 'sekret' })
  const d4 = await dGood.put('k', 'v')
  eq(d4.ok, true, 'D4 ★正对照：带对 token ⇒ put 成功（失败不是恒真守卫）')
  const d5 = await dGood.get('k')
  eq(d5.ok === true && d5.value.toString('utf8'), 'v', 'D5 正对照：带对 token ⇒ 往返正确')
  const authSeen = srvD.requests.filter(function (r) { return r.headers.authorization === 'Bearer sekret' })
  eq(authSeen.length >= 2, true, 'D6 ★Authorization: Bearer <token> 确实发出（服务端实收）')
  const d6 = await dGood.list('')
  eq(d6.ok, true, 'D7 正对照：带 token 的 list 成功')
  const dBad = createHttpBackend({ endpoint: srvD.base, token: 'wrong' })
  const d7 = await dBad.get('k')
  eq(d7.error, 'http-get-status: 401', 'D8 ★错 token 同样响亮失败（不是静默空结果）')

  /* ═══ E. 键语义：与 team-transport.js **同语义**（逐字节比对） ═══ */
  const srvE = await startServer({})
  const httpPrefixed = createHttpBackend({ endpoint: srvE.base, prefix: 'teamX' })
  const memPrefixed = createMemoryBackend({ prefix: 'teamX' })
  const OPS = [
    ['/a.json', 'A'],
    ['b.json', 'B'],
    ['/sub//c.json', 'C'],
    ['edge//x/', 'D'],
  ]
  for (let i = 0; i < OPS.length; i++) {
    await httpPrefixed.put(OPS[i][0], OPS[i][1])
    await memPrefixed.put(OPS[i][0], OPS[i][1])
  }
  const e1 = JSON.stringify((await httpPrefixed.list('')).keys)
  const e2 = JSON.stringify((await memPrefixed.list('')).keys)
  eq(e1, e2, 'E1 ★★withPrefix 同语义：带前缀时 http 与 memory 的 list 产出逐字节相同')
  eq(e1, JSON.stringify(['a.json', 'b.json', 'edge//x', 'sub//c.json']), 'E1b 逻辑键回显（去首尾斜杠，内部 // 原样保留）')
  for (let i = 0; i < OPS.length; i++) {
    const h = await httpPrefixed.get(OPS[i][0])
    const m = await memPrefixed.get(OPS[i][0])
    eq(h.ok === true && m.ok === true && h.value.toString('utf8') === m.value.toString('utf8'), true, 'E2.' + i + ' ★带前缀时 get 往返值与 memory 相同')
  }
  const storedKeys = Array.from(srvE.store.keys()).sort()
  eq(JSON.stringify(storedKeys), JSON.stringify(['teamX/a.json', 'teamX/b.json', 'teamX/edge//x', 'teamX/sub//c.json']), 'E3 ★前缀落到存储键上，且首尾斜杠被完全剔除（trimSlashes 同语义）')
  const e3 = await memPrefixed.get('nope')
  const e4 = await httpPrefixed.get('nope')
  eq(e4.error, e3.error, 'E4 ★不存在键的 error 文案与 memory 后端逐字节相同')
  const e5 = await httpPrefixed.put('', 'x')
  const e6 = await memPrefixed.put('', 'x')
  eq(e5.error, e6.error, 'E5 ★bad-key 文案与 memory 后端逐字节相同')

  /* ═══ F. ★负路径 2：服务端 500 ═══ */
  const srvF = await startServer({ failPut: true, failGet: true, failList: true })
  const f = createHttpBackend({ endpoint: srvF.base })
  const f1 = await f.put('k', 'v')
  eq(f1.ok, false, 'F1 ★500 ⇒ put ok:false')
  ok(typeof f1.error === 'string' && f1.error.length > 0, 'F1b put error 非空', f1)
  eq(f1.error, 'http-put-status: 500', 'F1c put 500 文案（可复算）')
  const f2 = await f.get('k')
  eq(f2.ok, false, 'F2 ★500 ⇒ get ok:false')
  eq(f2.error, 'http-get-status: 500', 'F2b ★500 ≠ not-found')
  ok(f2.error !== 'not-found', 'F2c ★不得把 500 误判成 not-found')
  const f3 = await f.list('')
  eq(f3.ok, false, 'F3 ★500 ⇒ list ok:false')
  eq(f3.error, 'http-list-status: 500', 'F3b list 500 文案')
  let fThrew = null
  try { await f.get('k') } catch (err) { fThrew = err }
  eq(fThrew, null, 'F4 ★三动词在 500 下全部不外抛（异常已收敛为 {ok:false}）')
  ok([f1.error, f2.error, f3.error].every(function (e) { return typeof e === 'string' && e.length > 0 }), 'F4b ★三条 error 均非空（明确失败）', [f1.error, f2.error, f3.error])

  /* ═══ G. ★负路径 3：未配置 ⇒ 构造即抛 + 零网络 ═══ */
  let gThrew = null
  try { createHttpBackend({}) } catch (err) { gThrew = err }
  ok(gThrew !== null, 'G1 ★未配置 endpoint ⇒ 构造即抛（响亮失败）')
  eq(gThrew ? gThrew.message : '', 'http-not-configured: endpoint', 'G2 ★抛错文案逐字 = http-not-configured: endpoint')
  let gThrew2 = null
  try { createHttpBackend({ endpoint: '   ' }) } catch (err) { gThrew2 = err }
  ok(gThrew2 !== null, 'G3 ★空白 endpoint 同样抛（不是默认值兜底）')
  eq(gThrew2 ? gThrew2.message : '', 'http-not-configured: endpoint', 'G4 空白 endpoint 文案')
  let gThrew3 = null
  try { createHttpBackend({ endpoint: 'ftp://10.0.0.7:2121' }) } catch (err) { gThrew3 = err }
  ok(gThrew3 !== null, 'G5 ★非 http(s) 协议 ⇒ 抛')
  ok(gThrew3 && /^http-bad-endpoint: /.test(gThrew3.message), 'G6 非法 endpoint 文案 = http-bad-endpoint: <值>', gThrew3 && gThrew3.message)
  let gThrew4 = null
  try { createHttpBackend({ endpoint: 'http://[bad' }) } catch (err) { gThrew4 = err }
  ok(gThrew4 !== null, 'G7 ★不可解析的 URL ⇒ 抛')
  let netCalls = 0
  const countingFetch = function () { netCalls++; return Promise.reject(new Error('stub network must not be reached')) }
  let gThrew5 = null
  try { createHttpBackend({ fetchImpl: countingFetch }) } catch (err) { gThrew5 = err }
  ok(gThrew5 !== null, 'G8 ★未配置时即使注入了 fetch 也构造即抛')
  eq(netCalls, 0, 'G9 ★★netCalls === 0：未配置 ⇒ 零网络请求（无构造期探测、无隐式回退）')

  /* ═══ H. ★负路径 4：绝不 fallback 到 S3 ═══ */
  const S3_ENDPOINT = 'https://oss-cn-hangzhou.aliyuncs.com'
  const srvH = await startServer({})
  const realFetch = globalThis.fetch
  const fetchLog = []
  let fetchCalls = 0
  globalThis.fetch = function (url) {
    fetchCalls++
    fetchLog.push(String(url))
    const err = new Error('S3-NETWORK-FORBIDDEN: ' + String(url))
    err.s3Attempt = true
    return Promise.reject(err)
  }
  try {
    const h = createHttpBackend({ endpoint: srvH.base })
    const h1 = await h.put('team/h.json', 'H')
    const h2 = await h.get('team/h.json')
    const h3 = await h.list('team/')
    eq(h1.ok, true, 'H1 ★S3 通道被毒化(全局 fetch 会抛)时，http put 仍成功')
    eq(h2.ok === true && h2.value.toString('utf8'), 'H', 'H2 ★往返仍正确')
    eq(JSON.stringify(h3.keys), JSON.stringify(['team/h.json']), 'H3 ★list 仍正确')
    eq(h1.bytes, 1, 'H4 回显字节数 = 1')
    eq(fetchCalls, 0, 'H5 ★★fetchCalls === 0：http 后端一次都没碰 fetch/S3 通道')
    eq(fetchLog.length, 0, 'H6 fetch 调用日志为空（零公网请求）')
    // H7-H10：正对照 —— 同样的毒化 fetch 必须能抓住 S3 后端（否则 H5 是恒真守卫）
    const s3 = createS3Backend({ endpoint: S3_ENDPOINT, bucket: 'b', region: 'r', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: globalThis.fetch })
    const h5 = await s3.put('team/a.json', 'X')
    eq(h5.ok, false, 'H7 ★正对照：S3 后端在毒化 fetch 下失败（证明该桩确实抓得住 S3 出网）')
    eq(fetchCalls, 1, 'H8 ★fetchCalls === 1：S3 确实走了 fetch（H5 因此不是恒真守卫）')
    ok(h5.error.indexOf('S3-NETWORK-FORBIDDEN') >= 0, 'H9 S3 报错里带得上毒化标记', h5.error)
    eq(String(h5.error).indexOf(S3_ENDPOINT) >= 0, true, 'H9b ★S3 失败信息里带 S3 endpoint（确证失败发生在 S3 通道，无跨通道串线）', h5.error)
    ok(String(fetchLog[0]).indexOf(S3_ENDPOINT) === 0, 'H10 ★S3 请求确实指向 S3 endpoint（公网域）', fetchLog[0])
    const hAfterS3Fail = await h.put('team/h2.json', 'H2')
    eq(hAfterS3Fail.ok, true, 'H11 ★S3 失败后 http 后端仍独立成功（无共享状态、无降级耦合）')
    eq(fetchCalls, 1, 'H12 fetch 调用数仍是 1（http 后端全程未碰）')
  } finally {
    globalThis.fetch = realFetch
  }
  eq(globalThis.fetch === realFetch, true, 'H13 全局 fetch 已还原')

  /* ═══ I. 传输面负路径 + 零第三方依赖守卫 ═══ */
  const srvI1 = await startServer({})
  const deadPort = srvI1.base.split(':')[2]
  await srvI1.close()
  const dead = createHttpBackend({ endpoint: 'http://127.0.0.1:' + deadPort, timeoutMs: 4000 })
  let iThrew = null
  let i1 = null
  try { i1 = await dead.get('k') } catch (err) { iThrew = err }
  eq(iThrew, null, 'I1 ★连接失败不外抛（收敛为返回值）')
  eq(i1 ? i1.ok : null, false, 'I1b ★连接被拒 ⇒ ok:false')
  ok(i1 && typeof i1.error === 'string' && i1.error.length > 0, 'I1c error 非空', i1)
  eq(isActualNetworkActivity(i1 ? i1.error : ''), true, 'I1d ★确实发起了真实网络活动（连接被拒，非本地早退）', i1 && i1.error)
  const deadList = await dead.list('a/')
  eq(deadList.ok, false, 'I2 ★list 同样收敛为 ok:false（且不回退全量列举）')
  const srvI2 = await startServer({ hangGet: true })
  const slow = createHttpBackend({ endpoint: srvI2.base, timeoutMs: 300 })
  const i3 = await slow.get('k')
  eq(i3.ok, false, 'I3 ★超时 ⇒ ok:false')
  ok(i3.error.indexOf('http-timeout') >= 0, 'I3b 超时文案含 http-timeout', i3.error)
  await srvI2.close()
  const src = fs.readFileSync(MODULE_PATH, 'utf8')
  const imports = src.match(/^import .*$/gm) || []
  eq(imports.length, 2, 'I4 ★import 面恰好 2 条')
  eq(imports.join(' | '), "import http from 'node:http' | import https from 'node:https'", 'I4b ★★零第三方依赖（两条 import 均为 node: 内置；不含 fetch / 不含 team-transport）')
  eq(/\bfetch\s*\(/.test(src.replace(/fetchImpl\(/g, '')), false, 'I5 ★源码里不直接调用 fetch（默认传输走 node:http/https）')

  /* ═══ J. 请求形态物理量 ═══ */
  const srvJ = await startServer({})
  const j = createHttpBackend({ endpoint: srvJ.base, token: 'tok-123' })
  await j.put('团队/键-中文.json', '值')
  const jPut = srvJ.requests.filter(function (r) { return r.method === 'PUT' }).pop()
  eq(jPut.headers['content-length'], String(Buffer.byteLength('值', 'utf8')), 'J1 ★Content-Length = 3（utf8 字节数，非 String.length=1）')
  eq(jPut.headers.authorization, 'Bearer tok-123', 'J2 ★Authorization 头逐字正确')
  eq(jPut.path, '/objects/' + encodeURIComponent('团队/键-中文.json'), 'J3 ★CJK 键按 encodeURIComponent 编码进路径（服务端解码后 = 原键）')
  eq(decodeURIComponent(jPut.path.slice('/objects/'.length)), '团队/键-中文.json', 'J3b 服务端解码即原键（不双重编码/解码）')
  await j.list('团队/')
  const jList = srvJ.requests.filter(function (r) { return r.method === 'GET' && r.path === '/objects' }).pop() || { search: '<no-list-request>' }
  eq(jList.search, '?prefix=' + encodeURIComponent('团队'), 'J4 ★list 的 prefix 编码正确（尾斜杠按 trimSlashes 语义剔除，与 team-transport 一致）')
  const noTok = createHttpBackend({ endpoint: srvJ.base })
  await noTok.put('plain.json', 'p')
  const jPut2 = srvJ.requests.filter(function (r) { return r.method === 'PUT' }).pop()
  eq(jPut2.headers.authorization, undefined, 'J5 ★未配置 token ⇒ 不带 Authorization 头（不是空 Bearer）')
  const srvJ3 = await startServer({})
  const custom = createHttpBackend({ endpoint: srvJ3.base + '/api', objectsPath: '/dam/objects' })
  eq(JSON.stringify(await custom.put('c.json', 'C')), JSON.stringify({ ok: true, key: 'c.json', bytes: 1 }), 'J6 ★objectsPath + endpoint 子路径可覆盖，返回形状与默认一致')
  const jCustom = srvJ3.requests.filter(function (r) { return r.method === 'PUT' }).pop()
  eq(jCustom.path, '/api/dam/objects/c.json', 'J6b ★自定义路径拼接逐字正确')
  eq(JSON.stringify((await custom.list('')).keys), JSON.stringify(['c.json']), 'J6c ★自定义路径下 list 仍可用')
  const srvJ2 = await startServer({})
  const slashy = createHttpBackend({ endpoint: srvJ2.base + '/' })
  await slashy.put('s.json', 'S')
  const jPut3 = srvJ2.requests.filter(function (r) { return r.method === 'PUT' }).pop()
  eq(jPut3.path, '/objects/s.json', 'J7 ★endpoint 带尾斜杠不产生双斜杠路径')
  const jGetBack = await j.get('团队/键-中文.json')
  eq(jGetBack.ok === true && jGetBack.value.toString('utf8'), '值', 'J8 ★CJK 键 get 往返正确（路径编码双向一致）')
  const jObjGets = srvJ.requests.filter(function (r) { return r.method === 'GET' && r.path.indexOf('/objects/') === 0 })
  eq(jObjGets.length, 1, 'J8b 确有 1 条 GET 对象请求到达服务端（上述形态断言基于实收请求）')

  /* ═══ 收尾：关服务器 + 输出 ═══ */
  await Promise.all([srvA.close(), srvC.close(), srvD.close(), srvE.close(), srvF.close(), srvH.close(), srvJ.close(), srvJ2.close(), srvJ3.close()])
  console.log('  team-transport-http 真执行: ' + pass + ' PASS / ' + fail + ' FAIL')
  if (fail > 0) {
    console.log('  失败项:')
    failures.forEach(function (f) { console.log('    ✗ ' + f) })
    process.exit(1)
  }
}

main().catch(function (e) {
  console.error('  ✗ 套件异常(非断言失败): ' + (e && e.message))
  console.error(e && e.stack)
  process.exit(1)
})
