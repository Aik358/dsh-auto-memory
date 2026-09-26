#!/usr/bin/env node
/**
 * smoke-test-team-minio-live.mjs —— B13：S3 兼容层 **E3 级**真机验收（L3）。
 *
 * 与 B11b（smoke-test-team-transport.mjs，注入式假 fetch）互补：
 *   那个验证**签名形态**；这个验证**两个真实 MinIO 实例**能否被产线模块读写。
 *
 * ★CR-10 纪律：真 import lib/team-transport.js → 真 createS3Backend → 真 put/get/list
 *   → 断言返回值与**逐字节**内容；并含多条**负路径**。
 *
 * ★自门控（重要）：文件名虽含 `-live-`，但 tools/run-smoke.mjs **没有**按名字排除
 *   任何套件（listSuites 只认 --filter/--exclude）。真正让本套件不进默认回归的是
 *   下面这行环境变量门 —— 未设置即打印 SKIP 并 exit 0。
 *   与 smoke-test-fresh-download-live.mjs 的既有做法一致。
 *
 * 前置（由操作者准备，本套件不自起服务）：
 *   ① 两个真实 MinIO 实例：A=127.0.0.1:9000  B=127.0.0.1:9010
 *      （不同数据目录、不同 MINIO_ROOT_USER/PASSWORD）
 *   ② bucket **可以不存在** —— 本套件用**自实装 SigV4**（不 import lib 的签名代码，
 *      独立实现）自己建桶，避免「用被测代码给被测代码搭环境」。
 *
 * 运行：
 *   RUN_TEAM_MINIO_LIVE=1 node tests/smoke/smoke-test-team-minio-live.mjs
 *   可选 env：MINIO_A_ENDPOINT / MINIO_B_ENDPOINT / MINIO_BUCKET / MINIO_REGION
 *            / MINIO_A_ACCESS / MINIO_A_SECRET / MINIO_B_ACCESS / MINIO_B_SECRET
 */
import { createHash, createHmac } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB = path.resolve(HERE, '..', '..', 'lib')

/* ── 配置（env 可覆盖，默认对准本机已起的两个实例） ───────────── */
const A = {
  name: 'A',
  endpoint: process.env.MINIO_A_ENDPOINT || 'http://127.0.0.1:9000',
  accessKeyId: process.env.MINIO_A_ACCESS || 'b13userA',
  secretAccessKey: process.env.MINIO_A_SECRET || 'b13secretA123',
}
const B = {
  name: 'B',
  endpoint: process.env.MINIO_B_ENDPOINT || 'http://127.0.0.1:9010',
  accessKeyId: process.env.MINIO_B_ACCESS || 'b13userB',
  secretAccessKey: process.env.MINIO_B_SECRET || 'b13secretB456',
}
const REGION = process.env.MINIO_REGION || 'us-east-1'
const BUCKET = process.env.MINIO_BUCKET || 'b13-team'

/* ── 自门控：未显式开启即 SKIP（保证默认全量回归不连 MinIO） ────── */
if (process.env.RUN_TEAM_MINIO_LIVE !== '1') {
  console.log('[team-minio-live] SKIP: 需要两个真实 MinIO 实例 — set RUN_TEAM_MINIO_LIVE=1 to run (kept out of routine regression loops)')
  console.log('[team-minio-live] 目标：A=' + A.endpoint + '  B=' + B.endpoint + '  bucket=' + BUCKET)
  process.exit(0)
}

/* ── 断言台 ───────────────────────────────────────────────── */
let pass = 0, fail = 0
const failures = []
/** ★真正已知缺陷（断言编码的是「当前有缺陷的行为」，不是「功能正常」）。 */
const knownDefects = []
function ok(cond, name, got) {
  if (cond) { pass++; console.log('  ok - ' + name) } else {
    fail++
    const detail = name + (got === undefined ? '' : ' | got=' + JSON.stringify(got))
    failures.push(detail)
    console.log('  FAIL - ' + detail)
  }
}
function eq(actual, expected, name) { ok(actual === expected, name, { actual, expected }) }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
/** ★物理量一律用 utf8 字节数，绝不用 String.length（中文/emoji 会错）。 */
const byteLen = (s) => Buffer.byteLength(s, 'utf8')

/* ── 独立 SigV4（故意不复用 lib/ 的签名代码）────────────────────────
 * 用「自己的」签名给被测代码搭环境，避免循环自证。
 * 只用它做两件事：建桶（PUT /<bucket>）与「错误密钥」探测。
 */
function hmac(key, data) { return createHmac('sha256', key).update(data).digest() }
function uriEnc(seg) {
  return encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}
function amzStamp(d) {
  const iso = d.toISOString()
  const dateStamp = iso.slice(0, 10).replace(/-/g, '')
  return { dateStamp, amzDate: dateStamp + 'T' + iso.slice(11, 19).replace(/:/g, '') + 'Z' }
}
/** 用独立实现的 V4 签名发一个请求；keyPath 为空表示操作桶本身。 */
async function sigv4Fetch(inst, method, keyPath, credOverride) {
  const cred = credOverride || inst
  const u = new URL(inst.endpoint)
  u.pathname = '/' + uriEnc(BUCKET) + (keyPath ? '/' + keyPath : '')
  u.search = ''
  const payloadHash = sha256(Buffer.alloc(0))
  const { dateStamp, amzDate } = amzStamp(new Date())
  const canonicalHeaders = ['host:' + u.host, 'x-amz-content-sha256:' + payloadHash, 'x-amz-date:' + amzDate, ''].join('\n')
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, u.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = dateStamp + '/' + REGION + '/s3/aws4_request'
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonicalRequest, 'utf8'))].join('\n')
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + cred.secretAccessKey, dateStamp), REGION), 's3'), 'aws4_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')
  const res = await fetch(u.toString(), {
    method,
    headers: {
      Authorization: 'AWS4-HMAC-SHA256 Credential=' + cred.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    },
  })
  const text = await res.text()
  return { status: res.status, text }
}

/**
 * 带正文的独立签名请求。hashMode 故意可选，用来做**反事实对照**：
 *   - 'correct'   : x-amz-content-sha256 = 对正文**真实字节**做哈希（AWS/S3 规范口径）
 *   - 'lib-style' : 复刻 lib/team-transport.js:344 的口径 payload.toString('binary') 后再哈希
 * 同一份正文只改这一项 ⇒ 可判定偏差是否来自本仓的哈希口径。
 */
async function sigv4FetchBody(inst, method, keyPath, bodyBuf, hashMode, credOverride) {
  const cred = credOverride || inst
  const body = bodyBuf || Buffer.alloc(0)
  const payloadHash = hashMode === 'lib-style' ? sha256(Buffer.from(body.toString('binary'), 'utf8')) : sha256(body)
  const u = new URL(inst.endpoint)
  u.pathname = '/' + uriEnc(BUCKET) + (keyPath ? '/' + keyPath : '')
  u.search = ''
  const { dateStamp, amzDate } = amzStamp(new Date())
  const canonicalHeaders = ['host:' + u.host, 'x-amz-content-sha256:' + payloadHash, 'x-amz-date:' + amzDate, ''].join('\n')
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [method, u.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = dateStamp + '/' + REGION + '/s3/aws4_request'
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(Buffer.from(canonicalRequest, 'utf8'))].join('\n')
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + cred.secretAccessKey, dateStamp), REGION), 's3'), 'aws4_request')
  const signature = hmac(kSigning, stringToSign).toString('hex')
  const res = await fetch(u.toString(), {
    method,
    headers: {
      Authorization: 'AWS4-HMAC-SHA256 Credential=' + cred.accessKeyId + '/' + scope + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    },
    body,
  })
  const text = await res.text()
  return { status: res.status, text }
}

/** 抽 MinIO 返回的 S3 错误码（<Code>...</Code>）；不是 XML 就退回空串。 */
function s3ErrorCode(text) {
  const m = /<Code>([\s\S]*?)<\/Code>/.exec(text || '')
  return m ? m[1] : ''
}

/** 确保桶存在（先 HEAD，非 2xx 再 PUT）。返回 {created, headStatus, putStatus}。 */
async function ensureBucket(inst) {
  const head = await sigv4Fetch(inst, 'HEAD', '')
  if (head.status >= 200 && head.status < 300) return { created: false, headStatus: head.status, putStatus: null }
  const put = await sigv4Fetch(inst, 'PUT', '')
  return { created: true, headStatus: head.status, putStatus: put.status }
}

/** 可达性探测：实例根本没起时给出明确失败，而不是让后续断言全红得莫名其妙。 */
async function reachable(inst) {
  try {
    const res = await fetch(inst.endpoint + '/minio/health/live', { method: 'GET' })
    return res.status
  } catch (e) { return 'ERR:' + (e && e.message) }
}

/* ── 主流程 ───────────────────────────────────────────────── */
async function main() {
  const t0 = Date.now()
  /* ★真 import 产线模块（CR-10：不是读源码找字符串） */
  const ttMod = await import(pathToFileURL(path.join(LIB, 'team-transport.js')).href)
  const createS3Backend = ttMod.createS3Backend
  ok(typeof createS3Backend === 'function', 'A0 真 import lib/team-transport.js 拿到 createS3Backend', typeof createS3Backend)
  console.log('[team-minio-live] A=' + A.endpoint + '  B=' + B.endpoint + '  bucket=' + BUCKET + '  region=' + REGION)

  /* ═══ A. 前置：两个实例真的可达（否则后面的红没有诊断价值） ═══ */
  const ha = await reachable(A)
  const hb = await reachable(B)
  console.log('[team-minio-live] health A=' + ha + '  B=' + hb)
  eq(ha, 200, 'A1 实例 A /minio/health/live = 200')
  eq(hb, 200, 'A2 实例 B /minio/health/live = 200')
  ok(A.endpoint !== B.endpoint, 'A3 两个实例 endpoint 不同（否则不是双实例）', { A: A.endpoint, B: B.endpoint })
  ok(A.accessKeyId !== B.accessKeyId, 'A4 两个实例凭据不同', { A: A.accessKeyId, B: B.accessKeyId })

  /* ═══ B. 建桶（用**自己的** SigV4，不借被测代码） ═══ */
  const mkA = await ensureBucket(A)
  const mkB = await ensureBucket(B)
  console.log('[team-minio-live] bucket A: created=' + mkA.created + ' head=' + mkA.headStatus + ' put=' + mkA.putStatus)
  console.log('[team-minio-live] bucket B: created=' + mkB.created + ' head=' + mkB.headStatus + ' put=' + mkB.putStatus)
  ok(mkA.created ? (mkA.putStatus === 200 || mkA.putStatus === 204) : (mkA.headStatus >= 200 && mkA.headStatus < 300), 'B1 bucket 在实例 A 上已就绪', mkA)
  ok(mkB.created ? (mkB.putStatus === 200 || mkB.putStatus === 204) : (mkB.headStatus >= 200 && mkB.headStatus < 300), 'B2 bucket 在实例 B 上已就绪', mkB)

  /* ═══ C. 唯一键空间（重复运行不互相污染） ═══ */
  const runId = 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const RUNDIR = 'b13/' + runId + '/'
  const K = {
    aAscii: RUNDIR + 'a-ascii.json',
    aCn: RUNDIR + 'a-cn.json',
    aEmoji: RUNDIR + 'a-emoji.json',
    bOnly: RUNDIR + 'b-only.json',
    aCnKey: RUNDIR + '键名-中文-🎯.json',
  }
  console.log('[team-minio-live] runId=' + runId + '  keyPrefix=' + RUNDIR)

  /* ═══ C1. ★对实例 A put → 对实例 A get，值逐字节相同 ═══ */
  const backendA = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, region: REGION, accessKeyId: A.accessKeyId, secretAccessKey: A.secretAccessKey })
  const backendB = createS3Backend({ endpoint: B.endpoint, bucket: BUCKET, region: REGION, accessKeyId: B.accessKeyId, secretAccessKey: B.secretAccessKey })
  ok(typeof backendA.put === 'function', 'C1 createS3Backend 真构造出三动词接缝', Object.keys(backendA).sort())

  const PAY_ASCII = '{"kind":"smoke","n":12345,"ok":true}'
  const p1 = await backendA.put(K.aAscii, PAY_ASCII)
  ok(p1.ok === true, 'C2 ★A put 成功', p1)
  eq(p1.bytes, byteLen(PAY_ASCII), 'C3 put 回显字节数 = Buffer.byteLength(utf8)')
  const g1 = await backendA.get(K.aAscii)
  ok(g1.ok === true, 'C4 ★A get 成功', g1)
  ok(Buffer.isBuffer(g1.value), 'C5 get.value 是 Buffer', typeof g1.value)
  eq(g1.value.toString('utf8'), PAY_ASCII, 'C6 ★★往返值逐字节相同（utf8 字符串全等）')
  eq(sha256(g1.value), sha256(Buffer.from(PAY_ASCII, 'utf8')), 'C7 ★★往返值 SHA256 相同')
  eq(g1.bytes, byteLen(PAY_ASCII), 'C8 get 回显字节数一致')
  eq(byteLen(PAY_ASCII), 36, 'C9 可复算物理量：该 payload = 36 B')

  /* ══════════════════════════════════════════════════════════════════
   * C2. ★★发现并锁定的**真实缺陷**：非 ASCII（多字节 UTF-8）正文 put 失败
   *
   * 现象：lib/team-transport.js 的 doRequest 用
   *         sha256Hex(payload.toString('binary'))
   *       （见 lib/team-transport.js:344）声明 x-amz-content-sha256。
   *       payload.toString('binary') 得到「每个字节一个码元」的字符串，
   *       再交给 createHash().update(string) 时会被**按 utf8 重新编码**
   *       ⇒ 多字节字符每个字节变成 2 个字节 ⇒ 声明哈希 ≠ 正文真实哈希。
   *
   * 后果：MinIO 返回 HTTP 400 / XAmzContentSHA256Mismatch。
   * 影响面：任何**非 ASCII 值**（中文/emoji/任意二进制）都写不进去；
   *        纯 ASCII 值不受影响（ASCII 下 binary↔utf8 是恒等映射）。
   *
   * 下面用**反事实对照**锁死归因：同一份正文，只改声明哈希的口径 ⇒ 200 vs 400。
   * ⚠ 本段断言的是**当前（有缺陷的）行为**，目的是可复现、可回归；
   *   修好 lib 后这些断言会翻红，届时把它们改成正面断言即可。
   * ══════════════════════════════════════════════════════════════════ */
  const PAY_CN = '{"团队":"同步","备注":"跨实例隔离验证","emoji":"🎯🇨🇳"}'
  const CN_BYTES = Buffer.from(PAY_CN, 'utf8')
  ok(byteLen(PAY_CN) !== PAY_CN.length, 'C10 反证：该 payload 字节数 ≠ String.length（故必须用 ByteLength）', { bytes: byteLen(PAY_CN), chars: PAY_CN.length })
  eq(byteLen(PAY_CN), 75, 'C11 可复算物理量：中文+emoji payload = 75 B')

  const pCn = await backendA.put(K.aCn, PAY_CN)
  /* ★2026-09-26 修复后：原为 KNOWN-DEFECT（必然 400），现翻转为正面断言。
     修复点 lib/team-transport.js 的 payload 哈希口径：sha256Hex(payload) 直接吃 Buffer，
     不再经 toString('binary')（那会让 createHash().update(string) 按 utf8 重编码）。 */
  ok(pCn.ok === true, 'C12 ★★非 ASCII put 现已成功（修复前必然失败）', pCn)
  const gCn = await backendA.get(K.aCn)
  eq(gCn.ok, true, 'C13 ★★非 ASCII 值往返成功', gCn)
  eq(gCn.value.toString('utf8'), PAY_CN, 'C13b ★★中文+emoji 值逐字节往返一致（75 B）')
  eq(gCn.value.length, 75, 'C13c 取回字节数 = 75（可复算物理量）')

  /* 反事实 ①：同一正文 + **正确**字节哈希 ⇒ 应当成功 */
  const okHash = await sigv4FetchBody(A, 'PUT', RUNDIR + 'cn-correct.json', CN_BYTES, 'correct')
  eq(okHash.status, 200, 'C14 ★★反事实：同一正文、声明哈希按真实字节算 ⇒ HTTP 200（MinIO 接受该正文）')
  /* 反事实 ②：同一正文 + lib 口径哈希 ⇒ 复现 400 与错误码 */
  const badHash = await sigv4FetchBody(A, 'PUT', RUNDIR + 'cn-libstyle.json', CN_BYTES, 'lib-style')
  eq(badHash.status, 400, 'C15 ★★反事实：同一正文、声明哈希按 lib 口径算 ⇒ HTTP 400')
  eq(s3ErrorCode(badHash.text), 'XAmzContentSHA256Mismatch', 'C16 ★★★MinIO 错误码 = XAmzContentSHA256Mismatch（归因锁定）')
  console.log('[team-minio-live] 缺陷归因：correct-hash=' + okHash.status + '  lib-style-hash=' + badHash.status + '  Code=' + s3ErrorCode(badHash.text))

  /* ★纯 ASCII 不受影响 —— 与上面的非 ASCII 失败形成对照 */
  const gAscii = await backendA.get(K.aAscii)
  eq(gAscii.ok, true, 'C17 ★对照：纯 ASCII 值同一路径完全正常（证明缺陷仅限多字节）')
  eq(gAscii.value.toString('utf8'), PAY_ASCII, 'C18 ★对照：ASCII 往返逐字节相同')

  /* ═══ C3. 非 ASCII **键名**（正文为 ASCII）——键走 percent-encoding，应与值无关 ═══ */
  const pKey = await backendA.put(K.aCnKey, PAY_ASCII)
  eq(pKey.ok, true, 'C19 ★非 ASCII 键名 + ASCII 正文 ⇒ put 成功（键名不受该缺陷影响）', pKey)
  const gKey = await backendA.get(K.aCnKey)
  eq(gKey.ok, true, 'C20 ★非 ASCII 键名 get 成功', gKey)
  eq(gKey.value.toString('utf8'), PAY_ASCII, 'C21 ★非 ASCII 键名往返值逐字节相同')
  const lKey = await backendA.list(RUNDIR)
  ok(lKey.keys.includes(K.aCnKey), 'C22 ★list 能列出非 ASCII 键名（percent-encoding 解码正确）', lKey.keys)

    /* ═══ D. ★跨实例隔离：对 B list ⇒ 拿不到 A 的数据 ═══ */
  const lb0 = await backendB.list(RUNDIR)
  ok(lb0.ok === true, 'D1 对实例 B list 成功', lb0)
  ok(!lb0.keys.includes(K.aAscii), 'D2 ★★B 看不到 A 刚写入的键（跨实例隔离）', lb0.keys)
  ok(!lb0.keys.includes(K.aCn), 'D3 ★★B 也看不到 A 的中文 payload 键', lb0.keys)
  eq(lb0.keys.filter((k) => k.indexOf(RUNDIR) === 0).length, 0, 'D4 ★本 run 前缀下 B 侧键数为 0')

  /* 反向：A 侧确实看得见自己（证明不是「两边都空」的假绿） */
  const la0 = await backendA.list(RUNDIR)
  ok(la0.ok === true, 'D5 对实例 A list 成功', la0)
  // 本 run 前缀下 A 侧共 3 个键：a-ascii、cn-correct（反事实用正确哈希写进去的那份）、非 ASCII 键名那份。
  // （a-cn 因已知缺陷未能落盘，故不计入。）
  /* ★2026-09-26 修复后：非 ASCII put 从「必然失败」变为「成功」⇒ A 侧键数 3→4。
   键构成：aAscii / aCnKey / aCn 各 1 + 另有 1。以实跑为准（见 C12/C13）。 */
const EXPECT_A_KEYS = 4
  ok(la0.keys.includes(K.aAscii) && la0.keys.includes(K.aCnKey), 'D6 ★A 侧能列出自己的键（隔离不是靠「都在空」实现）', la0.keys)
  eq(la0.keys.filter((k) => k.indexOf(RUNDIR) === 0).length, EXPECT_A_KEYS, 'D7 ★A 侧本 run 前缀下恰为 4 个键（修复后非 ASCII put 成功，故为 4）')

  /* ═══ E. 对 B put 后，各自 list 只看到自己的 ═══ */
  const PAY_B = '{"instance":"B","runId":' + JSON.stringify(runId) + '}'
  const pB = await backendB.put(K.bOnly, PAY_B)
  ok(pB.ok === true, 'E1 对实例 B put 成功', pB)
  const gB = await backendB.get(K.bOnly)
  eq(gB.ok, true, 'E2 B get 自己的键成功', gB)
  eq(gB.value.toString('utf8'), PAY_B, 'E3 B 往返逐字节相同')

  const la1 = await backendA.list(RUNDIR)
  const lb1 = await backendB.list(RUNDIR)
  eq(la1.keys.filter((k) => k.indexOf(RUNDIR) === 0).length, EXPECT_A_KEYS, 'E4 ★A list 仍是自己的 4 个（未被 B 污染）')
  eq(lb1.keys.filter((k) => k.indexOf(RUNDIR) === 0).length, 1, 'E5 ★B list 只有自己的 1 个')
  ok(!la1.keys.includes(K.bOnly), 'E6 ★★A 看不到 B 写入的键', la1.keys)
  ok(lb1.keys.includes(K.bOnly) && !lb1.keys.includes(K.aAscii), 'E7 ★★B 只看到自己的键', lb1.keys)

  /* 两侧键集求交 = 空 ⇒ 隔离的**可复算**表述 */
  const inter = la1.keys.filter((k) => lb1.keys.indexOf(k) >= 0)
  eq(inter.length, 0, 'E8 ★★A∩B 键集交集 = 0（同一 bucket 名、不同实例，数据不互通）', inter)

  /* ═══ F. ★pathStyle 语义实测（这是 teamPathStyle 配置键的真实语义） ═══ */
  const seenUrls = []
  const recorder = (url, init) => { seenUrls.push(String(url)); return fetch(url, init) }

  const psTrue = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, region: REGION, accessKeyId: A.accessKeyId, secretAccessKey: A.secretAccessKey, pathStyle: true, fetchImpl: recorder })
  const rTrue = await psTrue.get(K.aAscii)
  ok(rTrue.ok === true, 'F1 pathStyle:true ⇒ get 成功', rTrue)
  eq(rTrue.value.toString('utf8'), PAY_ASCII, 'F2 pathStyle:true 取回值逐字节相同')
  eq(seenUrls.length, 1, 'F3 pathStyle:true 恰发出 1 次请求')
  ok(seenUrls[0].indexOf('//127.0.0.1:9000/' + BUCKET + '/') > 0, 'F4 ★pathStyle:true ⇒ URL 形态为 path-style（host 后接 /bucket）', seenUrls[0])

  seenUrls.length = 0
  const psOmit = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, region: REGION, accessKeyId: A.accessKeyId, secretAccessKey: A.secretAccessKey, fetchImpl: recorder })
  const rOmit = await psOmit.get(K.aAscii)
  ok(rOmit.ok === true, 'F5 ★省略 pathStyle ⇒ get 成功（说明默认形态可用）', rOmit)
  eq(seenUrls.length, 1, 'F6 省略 pathStyle 恰发出 1 次请求')
  eq(seenUrls[0], 'http://127.0.0.1:9000/' + BUCKET + '/' + K.aAscii, 'F7 ★★省略 pathStyle 的 URL 与显式 true 完全一致 ⇒ 默认值就是 true')

  seenUrls.length = 0
  const psFalse = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, region: REGION, accessKeyId: A.accessKeyId, secretAccessKey: A.secretAccessKey, pathStyle: false, fetchImpl: recorder })
  const rFalse = await psFalse.get(K.aAscii)
  eq(seenUrls.length, 0, 'F8 ★★pathStyle:false 打 IP 端点 ⇒ 构造期即拒绝，**零 fetch**（修复前会发出 1 次并静默退化）')
  /* ★★第二处真实缺陷（行为取证，非推测）：
     lib 走 `u.host = <bucket> + '.' + u.host`（lib/team-transport.js:274），
     而 WHATWG URL 的 host setter 对「<label>.<IPv4>」形态会**静默拒绝**——赋值不生效、
     不抛错、url.host 保持原值。后果：pathStyle:false 打 IP 端点时 URL 退化为
     路径形态 `/b13/...`，而 virtual-hosted 分支本就不在 pathname 里拼 bucket
     ⇒ MinIO 把首段 `b13` 当桶名 ⇒ 404 NoSuchBucket ⇒ get 映射成 not-found。 */
  /* ★2026-09-26 修复后：原为 KNOWN-DEFECT（静默退化 ⇒ 误导性 not-found），
     现翻转为正面断言。修复点：buildUrl 在 vhost 分支加 isIpv4Literal 守卫，
     IP 端点 + pathStyle:false ⇒ 构造期即失败，**零 fetch**，错误信息自带修法提示。 */
  const uProbe = new URL(A.endpoint)
  const hostBefore = uProbe.host
  uProbe.host = BUCKET + '.' + uProbe.host
  eq(uProbe.host, hostBefore, 'F9 机制取证（规范层）：URL.host setter 对「<label>.<IPv4>」静默失效 —— 这正是必须显式守卫的原因')
  const vProbe = new URL('https://oss-cn-hangzhou.aliyuncs.com')
  vProbe.host = 'mybucket.oss-cn-hangzhou.aliyuncs.com'
  eq(vProbe.host, 'mybucket.oss-cn-hangzhou.aliyuncs.com', 'F10 ★对照：非 IP 域名下同一 setter 正常生效（故守卫只拦 IP）')
  eq(seenUrls.length, 0, 'F11 ★★修复后零 fetch —— 不再有「静默退化后的一次无效出网」')
  ok(rFalse.ok === false, 'F12 ★★pathStyle:false 打 IP 端点 ⇒ 明确失败（不是静默成功）', rFalse)
  ok(/virtual-host-on-ip/.test(String(rFalse.error)), 'F13 ★★错误码明示病因（s3-virtual-host-on-ip），不再退化成误导性 not-found', rFalse.error)
  ok(String(rFalse.error).indexOf('pathStyle') > 0, 'F14 ★★错误信息自带修法提示（改用 pathStyle: true）')
  console.log('[team-minio-live] pathStyle 结论：true/默认 ⇒ 通（get 逐字节一致）；false 打 IP 端点 ⇒ ' + rFalse.error)

  /* ═══ G. ★负路径 1：错误 secretAccessKey ⇒ 必须明确失败 ═══ */
  const badSecret = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, region: REGION, accessKeyId: A.accessKeyId, secretAccessKey: 'WRONG-SECRET-DELIBERATE', pathStyle: true })
  const nSecret = await badSecret.put(K.aAscii + '.neg', 'should-not-land')
  ok(nSecret.ok === false, 'G1 ★★错误密钥 put ⇒ ok:false（绝不静默成功）', nSecret)
  ok(typeof nSecret.error === 'string' && nSecret.error.indexOf('s3-put-status:') === 0, 'G2 ★错误文案形如 s3-put-status:<HTTP 码>', nSecret.error)
  eq(nSecret.error, 's3-put-status: 403', 'G3 ★★MinIO 对错误密钥返回 HTTP 403')
  const nSecretGet = await badSecret.get(K.aAscii)
  eq(nSecretGet.ok, false, 'G4 ★错误密钥 get ⇒ ok:false')
  eq(nSecretGet.error, 's3-get-status: 403', 'G5 ★错误密钥 get 也返回 403')

  /* ★用独立签名读回 MinIO 的**错误码 XML**（这是负路径的证据本体） */
  const rawBad = await sigv4Fetch(A, 'PUT', K.aAscii + '.neg', { accessKeyId: A.accessKeyId, secretAccessKey: 'WRONG-SECRET-DELIBERATE' })
  eq(rawBad.status, 403, 'G6 独立复核：错误密钥裸请求 HTTP = 403')
  eq(s3ErrorCode(rawBad.text), 'SignatureDoesNotMatch', 'G7 ★★MinIO 错误码 = SignatureDoesNotMatch')
  console.log('[team-minio-live] 负路径(错误密钥): HTTP ' + rawBad.status + ' / Code=' + s3ErrorCode(rawBad.text))

  /* ═══ H. ★负路径 2：错误 accessKeyId（不存在的用户） ═══ */
  const badAk = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, region: REGION, accessKeyId: 'b13-ghost-user', secretAccessKey: A.secretAccessKey, pathStyle: true })
  const nAk = await badAk.put(K.aAscii + '.neg2', 'should-not-land')
  ok(nAk.ok === false, 'H1 ★不存在的 accessKeyId ⇒ ok:false', nAk)
  eq(nAk.error, 's3-put-status: 403', 'H2 ★★HTTP 403')
  const rawAk = await sigv4Fetch(A, 'PUT', K.aAscii + '.neg2', { accessKeyId: 'b13-ghost-user', secretAccessKey: A.secretAccessKey })
  eq(s3ErrorCode(rawAk.text), 'InvalidAccessKeyId', 'H3 ★★MinIO 错误码 = InvalidAccessKeyId')
  console.log('[team-minio-live] 负路径(错误 AK):  HTTP ' + rawAk.status + ' / Code=' + s3ErrorCode(rawAk.text))

  /* ★反证：上面两次「失败」没有真的写进去 */
  const gNeg = await backendA.get(K.aAscii + '.neg')
  eq(gNeg.ok, false, 'H4 ★反证：错误密钥的 put 确实没落盘（get ⇒ not-found）', gNeg)
  eq(gNeg.error, 'not-found', 'H5 not-found 文案')

  /* ═══ I. ★负路径 3：bucket 不存在 ⇒ 404，而非静默成功 ═══ */
  const missB = createS3Backend({ endpoint: A.endpoint, bucket: 'b13-does-not-exist-xyz', region: REGION, accessKeyId: A.accessKeyId, secretAccessKey: A.secretAccessKey, pathStyle: true })
  const nBucket = await missB.put(K.aAscii, 'x')
  eq(nBucket.ok, false, 'I1 ★不存在的 bucket put ⇒ ok:false')
  eq(nBucket.error, 's3-put-status: 404', 'I2 ★★HTTP 404（NoSuchBucket）')
  const nBucketList = await missB.list('')
  eq(nBucketList.ok, false, 'I3 ★不存在的 bucket list ⇒ ok:false')
  eq(nBucketList.error, 's3-list-status: 404', 'I4 ★list 也是 404')

  /* ═══ J. ★负路径 4：缺配置 ⇒ 零网络 ═══ */
  let zeroFetches = 0
  const neverFetch = () => { zeroFetches++; return Promise.reject(new Error('should-never-be-called')) }
  const noCfg = createS3Backend({ endpoint: A.endpoint, bucket: BUCKET, fetchImpl: neverFetch })
  const nCfg = await noCfg.put('x', 'y')
  eq(nCfg.ok, false, 'J1 ★缺 region/AK/SK ⇒ ok:false')
  eq(nCfg.error, 's3-not-configured: region', 'J2 ★★错误文案 = s3-not-configured: region（首个缺项）')
  eq(zeroFetches, 0, 'J3 ★★一次 fetch 都没发（负路径：零网络）')

  /* ═══ K. ★负路径 5：键不存在 ⇒ not-found（且不是「空成功」） ═══ */
  const nMissing = await backendA.get(RUNDIR + 'never-written.json')
  eq(nMissing.ok, false, 'K1 ★不存在的键 get ⇒ ok:false')
  eq(nMissing.error, 'not-found', 'K2 ★文案 = not-found（区别于 403/404 桶错误）')

  /* ═══ L. ★跨实例同名键互不覆盖（最终一致性反证） ═══ */
  const SAME = RUNDIR + 'same-key.json'
  await backendA.put(SAME, 'from-A')
  await backendB.put(SAME, 'from-B')
  const ra = await backendA.get(SAME)
  const rb = await backendB.get(SAME)
  eq(ra.value.toString('utf8'), 'from-A', 'L1 ★同一键名在 A 上仍是 A 的值')
  eq(rb.value.toString('utf8'), 'from-B', 'L2 ★同一键名在 B 上是 B 的值（不同物理实例）')
  ok(ra.value.toString('utf8') !== rb.value.toString('utf8'), 'L3 ★★同名键在两实例上值不同 ⇒ 确为两个独立存储')

  console.log('[team-minio-live] 主流程完成，用时 ' + ((Date.now() - t0) / 1000).toFixed(2) + 's')
}

await main()

/* ═══ 汇总 ═══ */
console.log('')
console.log('================ SUMMARY (team-minio-live) ================')
console.log('PASS ' + pass + ' / FAIL ' + fail)
if (knownDefects.length) {
  console.log('')
  console.log('⚠ KNOWN DEFECTS（断言已锁定「当前有缺陷的行为」，非功能正常）:')
  for (const d of knownDefects) console.log('  - ' + d)
}
if (failures.length) {
  console.log('')
  console.log('failures:')
  for (const x of failures) console.log('  - ' + x)
}
console.log('==========================================================')
process.exit(fail ? 1 : 0)
