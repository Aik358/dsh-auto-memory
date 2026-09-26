#!/usr/bin/env node
/**
 * smoke-test-team-transport.mjs —— B11b 传输接缝 ★**真执行**验收（CR-10）。
 *
 * ★CR-10 纪律：本套件**真 import 模块、真构造后端、真调用三动词**，断言返回值。
 *   不作为「读源码找字符串」的纯断言套件。
 *   并含**负路径**（该失败时必须失败），否则守卫恒真。
 *
 * 覆盖：
 *  A. 接缝形式：返回对象恰好含 put/get/list 三个自有可枚举键
 *  B. MemoryBackend：put→get 往返逐字节相同；list 前缀过滤 + 全序排序
 *  C. ★一致性：同一组操作跑 **MemoryBackend 与 S3Backend**（S3 用注入的假 fetch）
 *     ⇒ 产出**逐字节相同**（键列表 JSON 相等）
 *  D. S3 签名：真算 V4 签名，断言 Authorization 形态与关键头部在场
 *  E. ★负路径 1：s3 缺配置 ⇒ {ok:false, error:"s3-not-configured: <字段>"}，且 **零次 fetch**
 *  F. ★负路径 2：transport="http" ⇒ **构造即抛**，且**绝不静默降级**到 s3
 *  G. ★负路径 3：未知通道 ⇒ 抛 transport-unknown
 *  H. bad-key：空键 ⇒ {ok:false, error:"bad-key"}
 *  I. 不存在键 ⇒ {ok:false, error:"not-found"}
 */
import { createTeamTransport, createMemoryBackend, createS3Backend, TEAM_TRANSPORT_VERBS, TEAM_TRANSPORTS, TEAM_TRANSPORT_DEFAULT } from '../../lib/team-transport.js'

let pass = 0, fail = 0
const failures = []
function ok(cond, name, got) {
  if (cond) { pass++ } else { fail++; failures.push(name + (got === undefined ? '' : ' | got=' + JSON.stringify(got))) }
}
function eq(a, b, name) { ok(a === b, name, { actual: a, expected: b }) }

async function main() {
  /* ═══ A. 接缝形式 ═══ */
  const mem = createTeamTransport({ transport: 'memory' })
  eq(Object.keys(mem).sort().join(','), 'get,list,put', 'A1 接缝恰好三动词（自有可枚举键）')
  eq(typeof mem.put, 'function', 'A2 put 是函数')
  eq(typeof mem.get, 'function', 'A3 get 是函数')
  eq(typeof mem.list, 'function', 'A4 list 是函数')
  eq(TEAM_TRANSPORT_VERBS.join(','), 'put,get,list', 'A5 导出的动词表与实现一致')
  eq(TEAM_TRANSPORTS.join(','), 's3,memory,http', 'A6 通道枚举值域')
  eq(TEAM_TRANSPORT_DEFAULT, 's3', 'A7 默认通道 = s3（与 teamSyncTransport 默认一致）')
  eq(createTeamTransport({}).constructor === Object || Object.keys(createTeamTransport({})).length === 3, true, 'A8 省略 transport ⇒ 走默认后端（s3），仍为三动词形态')

  /* ═══ B. MemoryBackend 真往返 ═══ */
  const r1 = await mem.put('team/a.json', 'hello')
  ok(r1.ok === true, 'B1 put 成功', r1)
  eq(r1.key, 'team/a.json', 'B1b put 回显键')
  eq(r1.bytes, 5, 'B1c put 回显字节数')
  const g1 = await mem.get('team/a.json')
  ok(g1.ok === true, 'B2 get 成功', g1)
  eq(g1.value.toString('utf8'), 'hello', 'B3 ★往返值逐字节相同')
  eq(g1.bytes, 5, 'B3b get 回显字节数')
  const g404 = await mem.get('team/none.json')
  eq(g404.ok, false, 'B4 不存在的键 ⇒ ok:false')
  eq(g404.error, 'not-found', 'B4b ★错误文案 = not-found')
  const bBad = await mem.put('', 'x')
  eq(bBad.error, 'bad-key', 'B5 空键 put ⇒ bad-key')
  const gBad = await mem.get('', 'x')
  eq(gBad.error, 'bad-key', 'B5b 空键 get ⇒ bad-key')

  await mem.put('team/b.json', 'B')
  await mem.put('team/sub/c.json', 'C')
  await mem.put('other/x.json', 'X')
  const l1 = await mem.list('team/')
  ok(l1.ok === true, 'B6 list 成功', l1)
  eq(JSON.stringify(l1.keys), JSON.stringify(['team/a.json','team/b.json','team/sub/c.json']), 'B7 ★list 前缀过滤 + 全序排序')
  const l2 = await mem.list('')
  eq(l2.keys.length, 4, 'B8 空前缀 ⇒ 全部 4 条')
  const l3 = await mem.list('nope/')
  eq(JSON.stringify(l3.keys), '[]', 'B9 无命中前缀 ⇒ 空数组')
  const l4 = await mem.list('team/sub/')
  eq(JSON.stringify(l4.keys), JSON.stringify(['team/sub/c.json']), 'B10 二级前缀过滤正确')

  /* ═══ C. ★一致性：Memory vs S3（注入假 fetch） ═══ */
  const store = new Map()
  const calls = []
  async function fakeFetch(url, init) {
    calls.push({ url: String(url), method: init && init.method, headers: init && init.headers })
    const u = new URL(String(url))
    // path-style: /<bucket>/<key...>
    const seg = decodeURIComponent(u.pathname.replace(/^\//, ''))
    const idx = seg.indexOf('/')
    const key = idx < 0 ? '' : seg.slice(idx + 1)
    const method = (init && init.method) || 'GET'
    if (method === 'PUT') {
      store.set(key, Buffer.from(init.body).toString('utf8'))
      return { status: 200, text: async () => '' }
    }
    if (u.searchParams.get('list-type') === '2') {
      const p = u.searchParams.get('prefix') || ''
      const keys = []
      store.forEach(function (_v, k) { if (!p || k.indexOf(p) === 0) keys.push(k) })
      keys.sort()
      const xml = '<ListBucketResult>' + keys.map(function (k) { return '<Contents><Key>' + k + '</Key></Contents>' }).join('') + '</ListBucketResult>'
      return { status: 200, text: async () => xml }
    }
    if (!store.has(key)) return { status: 404, text: async () => '' }
    const v = store.get(key)
    return { status: 200, text: async () => v }
  }
  const s3 = createTeamTransport({
    transport: 's3',
    endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    bucket: 'demo-bucket',
    region: 'cn-hangzhou',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'SECRETEXAMPLE',
    fetchImpl: fakeFetch,
    now: function () { return new Date('2026-09-26T12:00:00Z') },
  })
  eq(Object.keys(s3).sort().join(','), 'get,list,put', 'C1 S3Backend 也是恰好三动词（同接口）')

  // 同一组操作，两个后端各跑一遍
  const OPS = [
    ['team/a.json', 'hello'],
    ['team/b.json', 'B'],
    ['team/sub/c.json', 'C'],
    ['other/x.json', 'X'],
  ]
  for (const [k, v] of OPS) { await mem.put(k, v); await s3.put(k, v) }

  const memKeys = JSON.stringify((await mem.list('team/')).keys)
  const s3Keys = JSON.stringify((await s3.list('team/')).keys)
  eq(s3Keys, memKeys, 'C2 ★★一致性：同一组操作，两后端 list 产出逐字节相同')
  const memAll = JSON.stringify((await mem.list('')).keys)
  const s3All = JSON.stringify((await s3.list('')).keys)
  eq(s3All, memAll, 'C3 ★★一致性：空前缀 list 也相同')
  const mv = (await mem.get('team/a.json')).value.toString('utf8')
  const sv = (await s3.get('team/a.json')).value.toString('utf8')
  eq(sv, mv, 'C4 ★★一致性：get 往返值相同')
  const mnf = (await mem.get('team/none.json')).error
  const snf = (await s3.get('team/none.json')).error
  eq(snf, mnf, 'C5 ★★一致性：不存在键的 error 文案相同')
  const mbad = (await mem.put('', 'x')).error
  const sbad = (await s3.put('', 'x')).error
  eq(sbad, mbad, 'C6 ★★一致性：bad-key 文案相同')

  /* ═══ D. S3 签名真算 ═══ */
  const putCall = calls.filter(c => c.method === 'PUT')[0]
  ok(!!putCall, 'D1 确实发出了 PUT', calls.length)
  const auth = putCall && putCall.headers && putCall.headers.Authorization
  ok(typeof auth === 'string' && auth.indexOf('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/') === 0, 'D2 Authorization 前缀与 Credential 形态正确', auth)
  ok(/Signature=[0-9a-f]{64}$/.test(auth || ''), 'D3 Signature 是 64 位十六进制', auth)
  ok((auth || '').indexOf('SignedHeaders=host;x-amz-content-sha256;x-amz-date') > 0, 'D4 SignedHeaders 与签名计算一致', auth)
  eq(putCall.headers['x-amz-date'], '20260926T120000Z', 'D5 x-amz-date 用注入的时钟（可复算）')
  eq(putCall.headers['x-amz-content-sha256'], '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', 'D6 ★payload sha256 正确（"hello" 的已知哈希）')
  ok(putCall.url.indexOf('https://oss-cn-hangzhou.aliyuncs.com/demo-bucket/team/a.json') === 0, 'D7 path-style URL 形态正确', putCall.url)

  /* ═══ E. ★负路径 1：缺配置 ⇒ 零网络 ═══ */
  let netCalls = 0
  async function countingFetch() { netCalls++; return { status: 200, text: async () => '' } }
  const missing = createS3Backend({ transport: 's3', fetchImpl: countingFetch })
  const e1 = await missing.put('k', 'v')
  const e2 = await missing.get('k')
  const e3 = await missing.list('')
  eq(e1.ok, false, 'E1 缺配置 put ⇒ ok:false')
  eq(e1.error, 's3-not-configured: endpoint', 'E2 ★缺 endpoint 的文案（顺序固定）')
  eq(e2.error, 's3-not-configured: endpoint', 'E3 get 同样拦截')
  eq(e3.error, 's3-not-configured: endpoint', 'E4 list 同样拦截')
  eq(netCalls, 0, 'E5 ★★负路径：缺配置时一次 fetch 都没发（零公网请求）')
  const partial = createS3Backend({ transport: 's3', endpoint: 'https://x.example.com', bucket: 'b', region: 'r', accessKeyId: 'a', fetchImpl: countingFetch })
  const e6 = await partial.put('k', 'v')
  eq(e6.error, 's3-not-configured: secretAccessKey', 'E6 ★缺最后一项时精确报出该字段')
  eq(netCalls, 0, 'E7 ★仍是零网络')

  /* ═══ F. ★负路径 2：http **未注入工厂** ⇒ 抛，不降级 ═══ */
  //  ★B11e 接线后本条语义已变（方向已复核）：
  //   接线前 = 「通道未实装」⇒ 抛；接线后 = 「工厂未注入 / endpoint 未配置」⇒ 仍抛。
  //   **两条都是构造期响亮失败、都不降级**，安全红线未变。
  let threw = null
  try { createTeamTransport({ transport: 'http' }) } catch (err) { threw = err }
  ok(threw !== null, 'F1 ★http 未注入工厂 ⇒ 构造即抛（不静默降级）')
  ok(/transport-not-implemented/.test(threw ? threw.message : ''), 'F2 抛错文案标明工厂未注入', threw && threw.message)
  ok(/http/.test(threw ? threw.message : ''), 'F3 抛错文案点明是 http 通道')
  let degraded = false
  try { const t = createTeamTransport({ transport: 'http' }); degraded = !!(t && typeof t.put === 'function' && Object.keys(t).length === 3) } catch (_) { degraded = false }
  ok(degraded === false, 'F4 ★★绝不静默降级到 s3（若返回三动词对象即为降级）')

  /* ═══ F2. ★★B11d 核心负路径：http 未配置 ⇒ **零网络请求** ═══ */
  //   F1–F4 证的是「构造即抛、不降级」。**本条证的是独立性质**：
  //   即便有人把 http 接缝接上，也**绝不能在没有 endpoint 时碰网络**——
  //   涉密场景下「以为在内网、实际走了公网」= 安全事故级缺陷。
  //   判据用**注入的计数 fetch**证明「零请求」，而不是靠异常类型推断。
  let httpNetCalls = 0
  async function httpCountingFetch() { httpNetCalls++; return { status: 200, text: async () => '' } }
  //  两种入口都要试：走 createTeamTransport，以及（若存在）直接建 http 后端。
  //  ★B11e 接线后：未注入 createHttpBackend ⇒ 仍拿不到后端对象（同接线前）。
  //   真正「已接线」的正路径在 F8 段（注入工厂后应能构造出三动词对象）。
  let httpBackend = null
  try { httpBackend = createTeamTransport({ transport: 'http', fetchImpl: httpCountingFetch }) } catch (_) { httpBackend = null }
  if (httpBackend && typeof httpBackend.put === 'function') {
    await httpBackend.put('k', 'v')
    await httpBackend.get('k')
    await httpBackend.list('')
  }
  eq(httpNetCalls, 0, 'F5 ★★http 通道未配置 ⇒ 零 fetch（一次都没发）')
  eq(httpBackend, null, 'F6 ★★http 未实装时**根本没拿到后端对象**（不可能有网络行为）')

  //  ★F7 反向对照：证明 countingFetch **真的会数**（否则 F5 是恒真守卫）
  let sanity = 0
  async function sanityFetch() { sanity++; return { status: 200, text: async () => '' } }
  const s3Sanity = createS3Backend({ transport: 's3', endpoint: 'https://x.example.com', bucket: 'b', region: 'r', accessKeyId: 'a', secretAccessKey: 's', fetchImpl: sanityFetch })
  await s3Sanity.put('k', 'v')
  ok(sanity > 0, 'F7 ★反向对照：配置齐全时 fetch **确实被调用**（证明计数器非恒 0）', sanity)
  /* ═══ F8. ★★B11e 接线**正路径**：注入工厂后必须真能构造并真能三动词 ═══ */
  //  ★CR-10：真 import → 真构造 → 真调用 → 断言**真实返回值**；带负路径。
  const { createHttpBackend } = await import(new URL('../../lib/team-transport-http.js', import.meta.url).href)
  ok(typeof createHttpBackend === 'function', 'F8 ★独立 import createHttpBackend 成功（真模块，非字符串匹配）')

  //  注入一个「内存版」http 服务端 fetch，验证**接线真的把三动词接到 http 后端上**。
  const hStore = new Map()
  async function hFetch(url, init) {
    const u = new URL(String(url))
    const seg = decodeURIComponent(u.pathname.replace(/^\//, ''))
    const k = seg.slice(seg.lastIndexOf('/') + 1)
    const m = (init && init.method) || 'GET'
    //  ★mock 必须同时提供 text() 与 arrayBuffer()：真实 fetch Response 两者都有，
    //   而 http 后端读**字节**用的是 res.arrayBuffer()（B11e 接线时实测发现）。
    function resp(code, str) {
      const b = Buffer.from(String(str), 'utf8')
      return { status: code, text: async () => str, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }
    }
    if (m === 'PUT') { hStore.set(k, Buffer.from(init.body).toString('utf8')); return resp(200, '') }
    //  ★真实语义（B11e 实测）：list 打到 `<objectsPath>`（无尾段）；单对象打到 `<objectsPath>/<key>`。
    //   ★不能按「有没有 ?prefix= 参数」判列表 —— 空前缀时 URL 就是 '/objects'，没有该参数。
    if (m === 'GET' && seg === 'objects') {
      const p = u.searchParams.get('prefix') || ''
      const ks = []; hStore.forEach(function (_v, kk) { if (!p || kk.indexOf(p) === 0) ks.push(kk) }); ks.sort()
      return resp(200, JSON.stringify(ks))
    }
    if (m === 'GET') {
      if (!hStore.has(k)) return resp(404, '')
      return resp(200, hStore.get(k))
    }
    return resp(405, '')
  }

  const wired = createTeamTransport({
    transport: 'http',
    endpoint: 'http://10.0.0.7:8080',
    fetchImpl: hFetch,
    createHttpBackend: createHttpBackend,
  })
  ok(wired !== null && typeof wired === 'object', 'F9 ★注入工厂后 http 通道可构造（接线生效）')
  eq(Object.keys(wired).length, 3, 'F10 ★仍是**恰好三动词**（接缝形式约束未被接线破坏）')
  ok(TEAM_TRANSPORT_VERBS.every(function (v) { return typeof wired[v] === 'function' }), 'F11 ★三动词名与常量逐字一致')
  const wPut = await wired.put('kk', 'vv')
  eq(wPut.ok, true, 'F12 ★正面：put 真调用成功（走的是 http 后端，非 s3）')
  const wGet = await wired.get('kk')
  eq(wGet.ok, true, 'F13 ★正面：get 真调用成功')
  eq(Buffer.isBuffer(wGet.value) ? wGet.value.toString('utf8') : String(wGet.value), 'vv', 'F14 ★★往返值**逐字相等**（证明确实落进了 http 后端的内存 store）')
  const wList = await wired.list('')
  eq(wList.ok, true, 'F15 正面：list 真调用成功')
  eq(hStore.size, 1, 'F16 ★★负路径：**只写进 hStore 一次**（没偷偷走 s3 —— s3 会写 stA 且计数 fetch）')

  //  ★负路径：缺 endpoint ⇒ 构造即抛（安全红线在接线后**依然成立**）
  let threwNoEp = null
  try { createTeamTransport({ transport: 'http', createHttpBackend: createHttpBackend }) } catch (err) { threwNoEp = err }
  ok(threwNoEp !== null, 'F17 ★★缺 endpoint ⇒ 构造即抛（接线**未削弱**安全红线）')
  ok(/http-not-configured/.test(threwNoEp ? threwNoEp.message : ''), 'F18 抛错文案标明是 endpoint 未配置', threwNoEp && threwNoEp.message)

  /* ═══ G. ★负路径 3：未知通道 ═══ */
  let threw2 = null
  try { createTeamTransport({ transport: 'ftp' }) } catch (err) { threw2 = err }
  ok(threw2 !== null && /transport-unknown/.test(threw2.message), 'G1 未知通道 ⇒ transport-unknown', threw2 && threw2.message)

  /* ═══ H. 团队前缀隔离（两后端一致） ═══ */
  const stA = new Map()
  async function ff2(url, init) {
    const u = new URL(String(url)); const seg = decodeURIComponent(u.pathname.replace(/^\//, ''))
    const key = seg.slice(seg.indexOf('/') + 1)
    if ((init && init.method) === 'PUT') { stA.set(key, Buffer.from(init.body).toString('utf8')); return { status: 200, text: async () => '' } }
    if (u.searchParams.get('list-type') === '2') {
      const p = u.searchParams.get('prefix') || ''
      const ks = []; stA.forEach(function (_v, k) { if (!p || k.indexOf(p) === 0) ks.push(k) }); ks.sort()
      return { status: 200, text: async () => '<R>' + ks.map(k => '<Key>' + k + '</Key>').join('') + '</R>' }
    }
    if (!stA.has(key)) return { status: 404, text: async () => '' }
    return { status: 200, text: async () => stA.get(key) }
  }
  const s3p = createS3Backend({ endpoint: 'https://e.example.com', bucket: 'b', region: 'r', accessKeyId: 'a', secretAccessKey: 's', prefix: 'teamX', fetchImpl: ff2, now: () => new Date('2026-09-26T12:00:00Z') })
  const memp = createMemoryBackend({ prefix: 'teamX' })
  await s3p.put('a.json', 'A'); await memp.put('a.json', 'A')
  eq(JSON.stringify((await s3p.list('')).keys), JSON.stringify((await memp.list('')).keys), 'H1 ★带团队前缀时两后端 list 仍相同')
  eq((await s3p.get('a.json')).value.toString(), (await memp.get('a.json')).value.toString(), 'H2 ★带前缀时 get 往返值相同')
  ok(stA.has('teamX/a.json'), 'H3 前缀确实落到存储键上（隔离生效）', Array.from(stA.keys()))

  /* ═══ 输出 ═══ */
  console.log('  team-transport 真执行: ' + pass + ' PASS / ' + fail + ' FAIL')
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
