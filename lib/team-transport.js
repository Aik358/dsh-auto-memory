/**
 * team-transport.js —— 团队版同步的**传输接缝**（★CR-8 双通道的落点）。
 *
 * ## 为什么存在这个文件
 * CR-8 裁定：同步走**双通道**，默认 S3 兼容（T0 公有云 / T1 内网 MinIO），
 * 自建 HTTP 服务端（T2 涉密内网）为兜底。但**双通道绝不写成两套代码** ——
 * 本文件是**唯一**的通道接缝：上层同步语义（outbox / merge / calendar / inject /
 * board / derived）只依赖这里的 `put` / `get` / `list` 三个动词，
 * **不得出现任何通道判断分支**。
 *
 * ## 设计约束（CR-8 / CR-9 / CR-10）
 *  1. **接缝只有三动词**：`createTeamTransport()` 返回的对象**恰好**含
 *     `put` / `get` / `list` 三个自有可枚举键 —— 这是可断言的形式约束。
 *  2. **零厂商专有 SDK**：只用 node 内置 `node:crypto` + 全局 `fetch`。
 *     S3 签名（AWS Signature V4）**自行实装**，不引 `ali-oss` / `cos-nodejs-sdk-v5`。
 *  3. ★**T2 绝不静默降级**（安全红线）：`transport: "http"` 现在**已接线**到
 *     `createHttpBackend`（T2 自建服务端）；但它**缺 endpoint 时构造即抛错**，
 *     **绝不回落到 s3**。涉密场景下「以为走内网、实际走公网」是**安全事故级**缺陷。
 *  4. **未配置 ⇒ 零网络**：s3 缺 endpoint/bucket/region/AK/SK 任一项，
 *     三个动词都返回 `{ok:false, error:"s3-not-configured: <字段>"}`，
 *     **一次 fetch 都不发**（负路径验收项）。
 *  5. **绝不抛（运行期）**：除构造期的「未实装通道」外，三个动词内部异常一律
 *     转成 `{ok:false, error}`，不外抛 —— 与 team-sync「tick 绝不抛」同源。
 *
 * ## 后端
 *  - `MemoryBackend`（`transport: "memory"`）：一个 Map。**不只是测试件** ——
 *    它同时是 B11d「接缝一致性测试」的**基准后端**（同一组操作跑两个后端，
 *    断言产出**逐字节相同**）。
 *  - `S3Backend`（`transport: "s3"`，默认）：阿里云 OSS / 腾讯云 COS / 华为云 OBS /
 *    AWS S3 / GCS 互通 —— 它们都说 S3 协议（「USB-C」）。
 *  - `http`（T2 自建服务端）：已接线到 `createHttpBackend`（独立模块 `team-transport-http.js`）。
 */

import { createHash, createHmac } from 'node:crypto'

/** 默认通道：s3 兼容（T0/T1 共用）。 */
const DEFAULT_TRANSPORT = 's3'
/** AWS 签名算法标识。 */
const S3_ALGO = 'AWS4-HMAC-SHA256'
/** 服务名（签名作用域用）。 */
const S3_SERVICE = 's3'

/** 保守转字符串：任何异常都退回空串（不抛）。 */
function toText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try { return String(value) } catch (_) { return '' }
}

/** 安全取属性：getter 抛错也不外抛。 */
function safeGet(target, key) {
  try { return target === null || target === undefined ? undefined : target[key] } catch (_) { return undefined }
}

/** 安全取错误消息。 */
function safeMessage(error) {
  try { return toText(safeGet(error, 'message')) || toText(error) } catch (_) { return '' }
}

/** 诊断钩子：失败不放大。 */
function safeDiag(diag, message) {
  if (typeof diag !== 'function') return
  try { diag(toText(message)) } catch (_) { /* diag 自身异常不得影响主流程 */ }
}

/** 去掉首尾斜杠。 */
function trimSlashes(value) {
  return toText(value).replace(/^\/+/, '').replace(/\/+$/, '')
}

/** 拼团队前缀（两个后端共用 —— 键语义必须唯一）。 */
function withPrefix(prefix, key) {
  const k = trimSlashes(key)
  if (!prefix) return k
  if (!k) return prefix
  return prefix + '/' + k
}

/** 去团队前缀（两个后端共用）。 */
function withoutPrefix(prefix, stored) {
  if (!prefix) return stored
  const p = prefix + '/'
  return stored.indexOf(p) === 0 ? stored.slice(p.length) : stored
}

/** 解析实际使用的 fetch 实现（options 优先，其次全局）。 */
function resolveFetch(options) {
  const own = safeGet(options, 'fetchImpl')
  if (typeof own === 'function') return own
  const g = safeGet(globalThis, 'fetch')
  if (typeof g === 'function') return g
  return null
}

/** sha256 十六进制（同步、零依赖）。 */
function sha256Hex(input) {
  return createHash('sha256').update(input).digest('hex')
}

/** HMAC-SHA256，返回 Buffer（V4 派生链用）。 */
function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data).digest()
}

/** 十六进制小写。 */
function hexOf(buffer) {
  return buffer.toString('hex')
}

/** 取 UTC 时间戳：{amzDate: 20130524T000000Z, dateStamp: 20130524}。 */
function amzNow(now) {
  const d = now instanceof Date ? now : new Date()
  const iso = d.toISOString()
  const dateStamp = iso.slice(0, 10).replace(/-/g, '')
  const amzDate = dateStamp + 'T' + iso.slice(11, 19).replace(/:/g, '') + 'Z'
  return { amzDate: amzDate, dateStamp: dateStamp }
}

/**
 * AWS UriEncode：S3 规范要求除 A-Za-z0-9-_.~ 与 '/' 外全部百分号编码。
 * encodeURIComponent 会漏掉 ! ' ( ) * 五个字符 ⇒ 必须补编码（否则签名失配）。
 */
function uriEncodeSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase()
  })
}

/** 把对象键编码为规范 URI 路径（保留 / 分隔，逐段编码）。 */
function encodeKeyPath(key) {
  const raw = toText(key)
  const parts = raw.split('/')
  const out = []
  for (let i = 0; i < parts.length; i++) out.push(uriEncodeSegment(parts[i]))
  return out.join('/')
}

/** 全序比较器（码元序，非 localeCompare）—— 跨机收敛要求全序，键唯一即可满足。 */
function compareKeys(a, b) {
  const x = toText(a)
  const y = toText(b)
  if (x === y) return 0
  return x < y ? -1 : 1
}

/** 值归一化为 Buffer（string / Buffer / TypedArray / 其它走 String）。 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(toText(value), 'utf8')
}
/**
 * MemoryBackend —— 进程内 Map 后端。
 *
 * ★**不是只读测试件**：它是 B11d「接缝一致性测试」的**基准后端** ——
 * 同一组操作在 MemoryBackend 与 S3Backend 上跑，断言产出**逐字节相同**。
 * 也是 L1 层（零安装）唯一可用的后端。
 *
 * 契约（与 S3Backend 必须完全一致）：
 *  - `put(key, value)` → `{ok:true, key, bytes}`；key 空 ⇒ `{ok:false, error:"bad-key"}`
 *  - `get(key)`        → `{ok:true, key, value:Buffer, bytes}`；不存在 ⇒ `{ok:false, error:"not-found"}`
 *  - `list(prefix)`    → `{ok:true, keys:[...]}`；**键已按全序排序**；prefix 空 ⇒ 全部
 */
export function createMemoryBackend(options = {}) {
  const store = new Map()
  const diag = safeGet(options, 'diag')
  const prefix = trimSlashes(safeGet(options, 'prefix'))

  function put(key, value) {
    const k = toText(key)
    if (!k) return { ok: false, error: 'bad-key' }
    try {
      const buf = toBuffer(value)
      store.set(withPrefix(prefix, k), buf)
      return { ok: true, key: k, bytes: buf.length }
    } catch (error) {
      safeDiag(diag, 'memory.put 失败: ' + safeMessage(error))
      return { ok: false, error: 'put-failed: ' + safeMessage(error) }
    }
  }

  function get(key) {
    const k = toText(key)
    if (!k) return { ok: false, error: 'bad-key' }
    try {
      const stored = withPrefix(prefix, k)
      if (!store.has(stored)) return { ok: false, error: 'not-found' }
      const buf = store.get(stored)
      return { ok: true, key: k, value: buf, bytes: buf.length }
    } catch (error) {
      return { ok: false, error: 'get-failed: ' + safeMessage(error) }
    }
  }

  function list(prefixArg) {
    const p = trimSlashes(toText(prefixArg))
    try {
      // ★与 S3 ListObjectsV2 **同语义**：对「存储键」做纯字符串前缀匹配（不加斜杠），
      //   对外返回「逻辑键」（去掉团队前缀）。两个后端必须逐字节一致。
      const matchPrefix = withPrefix(prefix, p)
      const out = []
      store.forEach(function (_v, k) {
        if (!matchPrefix || k.indexOf(matchPrefix) === 0) out.push(withoutPrefix(prefix, k))
      })
      out.sort(compareKeys)
      return { ok: true, keys: out }
    } catch (error) {
      return { ok: false, error: 'list-failed: ' + safeMessage(error) }
    }
  }

  return { put: put, get: get, list: list }
}

/**
 * S3Backend —— S3 兼容对象存储（阿里云 OSS / 腾讯云 COS / 华为云 OBS / AWS S3 / GCS）。
 * 签名自实装（AWS Signature V4），**零厂商专有 SDK**。
 *
 * 配置项（全部来自 options，缺任一项 ⇒ 所有动词 `{ok:false, error:"s3-not-configured: <字段>"}`，
 * **且一次 fetch 都不发**）：
 *  - endpoint  例 https://oss-cn-hangzhou.aliyuncs.com
 *  - bucket    存储桶名
 *  - region    例 cn-hangzhou / us-east-1（阿里云 OSS 用 cn-<城市>）
 *  - accessKeyId / secretAccessKey
 *  - prefix    可选，键前缀（团队协作空间隔离用）
 *  - pathStyle 可选，true（默认）走 path-style，false 走 virtual-hosted-style
 */
export function createS3Backend(options = {}) {
  const endpoint = toText(safeGet(options, 'endpoint'))
  const bucket = toText(safeGet(options, 'bucket'))
  const region = toText(safeGet(options, 'region'))
  const accessKeyId = toText(safeGet(options, 'accessKeyId'))
  const secretAccessKey = toText(safeGet(options, 'secretAccessKey'))
  const prefix = trimSlashes(safeGet(options, 'prefix'))
  const pathStyle = safeGet(options, 'pathStyle') !== false
  const diag = safeGet(options, 'diag')
  const fetchImpl = resolveFetch(options)
  const nowFn = typeof safeGet(options, 'now') === 'function' ? safeGet(options, 'now') : null

  /** 启动期一次性判定缺哪一项（顺序固定 ⇒ 报错文案可断言、可复算）。 */
  function missingField() {
    if (!endpoint) return 'endpoint'
    if (!bucket) return 'bucket'
    if (!region) return 'region'
    if (!accessKeyId) return 'accessKeyId'
    if (!secretAccessKey) return 'secretAccessKey'
    return null
  }

  /** 完整对象键（含团队前缀）—— 与 MemoryBackend 共用同一套语义。 */
  function fullKey(key) { return withPrefix(prefix, key) }

  /** 去掉团队前缀，返回对调用方可见的逻辑键。 */
  function logicalKey(stored) { return withoutPrefix(prefix, stored) }

  /** 解析 endpoint 为 {scheme, host, port}（非 URL 或非法 ⇒ null）。 */
  function parseEndpoint() {
    try {
      const u = new URL(endpoint)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
      return u
    } catch (_) { return null }
  }

  /** buildUrl 的失败原因（供 doRequest 生成可断言的错误码）。 */
  let urlError = null

  /** host 是否为 IPv4 字面量（含可选端口）。virtual-hosted 风格对 IP 端点**物理不可行**：
   *  WHATWG URL 的 host setter 对「<label>.<IPv4>」静默拒绝（不是我们不写，是规范不允许），
   *  而 DNS 也无法解析 b13.127.0.0.1 ⇒ 必须显式报错，绝不静默退化。 */
  function isIpv4Literal(host) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(toText(host))
    if (!m) return false
    for (let i = 1; i <= 4; i++) { if (Number(m[i]) > 255) return false }
    return true
  }

  /** 构造请求 URL：path-style 或 virtual-hosted-style。失败 ⇒ null 且 urlError 已置。 */
  function buildUrl(url, keyPath) {
    const u = parseEndpoint()
    if (!u) { urlError = 's3-bad-endpoint'; return null }
    urlError = null
    const encodedBucket = uriEncodeSegment(bucket)
    let host = u.host
    let pathname
    if (pathStyle) {
      pathname = '/' + encodedBucket + (keyPath ? '/' + keyPath : '')
    } else {
      if (isIpv4Literal(u.host)) {
        /* ★2026-09-26 B13 真机验收修复：此前这里直接 u.host = bucket + '.' + u.host，
           而 setter 对 IP 端点静默失效 ⇒ URL 退化为 /<bucket>/... ⇒ 404 NoSuchBucket
           ⇒ 上层收敛成**误导性的 not-found**（排查成本极高）。改为显式报错。 */
        urlError = 's3-virtual-host-on-ip: ' + toText(u.host) + '（virtual-hosted 风格无法用于 IP 端点，请设 pathStyle: true）'
        return null
      }
      host = encodedBucket + '.' + u.host
      pathname = keyPath ? '/' + keyPath : '/'
    }
    u.host = host
    u.pathname = pathname
    u.search = ''
    u.hash = ''
    return u
  }

  /** 规范化查询串（按键名码元排序；本模块只用 list-type 等少数参数）。 */
  function canonicalQuery(params) {
    const keys = Object.keys(params || {}).sort(compareKeys)
    const parts = []
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]
      const v = safeGet(params, k)
      parts.push(uriEncodeSegment(k) + '=' + uriEncodeSegment(toText(v)))
    }
    return parts.join('&')
  }

  /** 计算 V4 签名并返回请求头（Authorization / x-amz-*）。 */
  function signRequest(method, url, canonicalUri, query, payloadHash, amzDate, dateStamp) {
    const canonicalHeaders = [
      'host:' + url.host,
      'x-amz-content-sha256:' + payloadHash,
      'x-amz-date:' + amzDate,
      ''
    ].join('\n')
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [
      method,
      canonicalUri,
      query,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')
    const scope = dateStamp + '/' + region + '/' + S3_SERVICE + '/aws4_request'
    const stringToSign = [
      S3_ALGO,
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join('\n')
    const kDate = hmacSha256('AWS4' + secretAccessKey, dateStamp)
    const kRegion = hmacSha256(kDate, region)
    const kService = hmacSha256(kRegion, S3_SERVICE)
    const kSigning = hmacSha256(kService, 'aws4_request')
    const signature = hexOf(hmacSha256(kSigning, stringToSign))
    const authorization = S3_ALGO + ' Credential=' + accessKeyId + '/' + scope
      + ', SignedHeaders=' + signedHeaders + ', Signature=' + signature
    return {
      Authorization: authorization,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    }
  }

  /** 统一请求执行器：负责缺配置早退、异常收敛、返回 {status, text}。 */
  async function doRequest(method, keyPath, queryParams, bodyBuffer) {
    const missing = missingField()
    if (missing) return { ok: false, error: 's3-not-configured: ' + missing }
    if (typeof fetchImpl !== 'function') return { ok: false, error: 's3-no-fetch' }
    const u = buildUrl(null, keyPath)
    if (!u) return { ok: false, error: urlError || 's3-bad-endpoint' }
    const query = canonicalQuery(queryParams)
    if (query) u.search = query
    const payload = bodyBuffer || Buffer.alloc(0)
    /* ★2026-09-26 B13 真机验收修复：哈希必须吃 Buffer 本身。
       原写法 payload.toString('binary') 得到「每字节一码元」的字符串，再交
       createHash().update(string) 会被**按 utf8 重编码**（34 B → 50 B）
       ⇒ 声明哈希 ≠ 正文真实哈希 ⇒ MinIO/S3 返回 400 XAmzContentSHA256Mismatch。
       后果：任何非 ASCII 值（中文/emoji/二进制）都写不进去；纯 ASCII 下两种
       编码恒等故一直未暴露。反事实对照已锁定归因（同一 75 B 正文：
       correct-hash → 200、lib-style-hash → 400）。 */
    const payloadHash = sha256Hex(payload)
    const stamp = amzNow(nowFn ? nowFn() : new Date())
    const headers = signRequest(method, u, u.pathname, query, payloadHash, stamp.amzDate, stamp.dateStamp)
    try {
      const res = await fetchImpl(u.toString(), {
        method: method,
        headers: headers,
        body: method === 'GET' || method === 'HEAD' ? undefined : payload,
      })
      const status = safeGet(res, 'status')
      const text = await res.text()
      return { ok: true, status: status, text: text }
    } catch (error) {
      safeDiag(diag, 's3 ' + method + ' 失败: ' + safeMessage(error))
      return { ok: false, error: 's3-request-failed: ' + safeMessage(error) }
    }
  }

  function put(key, value) {
    const k = toText(key)
    if (!k) return Promise.resolve({ ok: false, error: 'bad-key' })
    const body = toBuffer(value)
    return doRequest('PUT', encodeKeyPath(fullKey(k)), null, body).then(function (r) {
      if (!r.ok) return r
      if (r.status >= 200 && r.status < 300) return { ok: true, key: k, bytes: body.length }
      return { ok: false, error: 's3-put-status: ' + r.status }
    })
  }

  function get(key) {
    const k = toText(key)
    if (!k) return Promise.resolve({ ok: false, error: 'bad-key' })
    return doRequest('GET', encodeKeyPath(fullKey(k)), null, null).then(function (r) {
      if (!r.ok) return r
      if (r.status === 404) return { ok: false, error: 'not-found' }
      if (r.status >= 200 && r.status < 300) {
        const buf = Buffer.from(toText(r.text), 'utf8')
        return { ok: true, key: k, value: buf, bytes: buf.length }
      }
      return { ok: false, error: 's3-get-status: ' + r.status }
    })
  }

  /**
   * 列出键。S3 ListObjectsV2：GET /?list-type=2&prefix=<p>&continuation-token=<t>。
   * 逐页取回，最多 maxPages 页（防超大桶把内存吃光）。
   */
  function list(prefixArg) {
    const p = trimSlashes(toText(prefixArg))
    const fullPrefix = fullKey(p)
    const maxPages = 50
    const out = []
    let token = null
    let page = 0
    function step() {
      if (page >= maxPages) {
        out.sort(compareKeys)
        return Promise.resolve({ ok: true, keys: out, truncated: true })
      }
      page += 1
      const params = { 'list-type': '2' }
      if (fullPrefix) params.prefix = fullPrefix
      if (token) params['continuation-token'] = token
      return doRequest('GET', '', params, null).then(function (r) {
        if (!r.ok) return r
        if (r.status < 200 || r.status >= 300) return { ok: false, error: 's3-list-status: ' + r.status }
        const body = toText(r.text)
        const re = /<Key>([\s\S]*?)<\/Key>/g
        let m
        while ((m = re.exec(body)) !== null) {
          const stored = decodeXmlEntities(m[1])
          out.push(logicalKey(stored))
        }
        const tc = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(body)
        const nt = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(body)
        if (tc && nt) { token = decodeXmlEntities(nt[1]); return step() }
        out.sort(compareKeys)
        return { ok: true, keys: out }
      })
    }
    return step()
  }

  return { put: put, get: get, list: list }
}

/** 解析 XML 实体（ListObjectsV2 的 Key 里可能含 &amp; 等）。 */
function decodeXmlEntities(text) {
  return toText(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}
/**
 * createTeamTransport —— **唯一通道接缝**。
 *
 * 返回对象**恰好**含 `put` / `get` / `list` 三个自有可枚举键。
 * 上层同步语义只依赖这三者，**不得**出现 `if (transport === "s3")` 这类分支。
 *
 * @param {object} options
 *   - `transport`   : 's3'（默认）| 'memory' | 'http'
 *   - `endpoint` / `bucket` / `region` / `accessKeyId` / `secretAccessKey` : s3 用
 *   - `prefix`      : 可选键前缀（团队空间隔离）
 *   - `pathStyle`   : 可选，默认 true
 *   - `fetchImpl`   : 可选，注入 fetch（测试用；不注入则用全局 fetch）
 *   - `store`       : 可选，memory 后端复用同一个 Map（测试断言用）
 *   - `diag`        : 可选诊断钩子
 *   - `createHttpBackend` : 可选，装配层注入的 T2 后端工厂（见 lib/team-transport-http.js）
 *
 * ★**安全红线**：`transport: "http"`（T2 自建服务端）**缺 endpoint ⇒ 构造即抛**，
 *   **绝不静默降级到 s3**。涉密场景下「以为走内网、实际走公网」是安全事故级缺陷。
 *   调用方必须显式处理这个抛错（UI 上标注「未验证通道」）。
 *
 * ★**B11e 接线方式**：http 后端由**装配层注入** `options.createHttpBackend`
 *   （`lib/team-transport-http.js` 的 `createHttpBackend`）。
 *   未注入 ⇒ 保持响亮失败（`transport-not-implemented`），**不降级**。
 */
export function createTeamTransport(options = {}) {
  const transport = toText(safeGet(options, 'transport')) || DEFAULT_TRANSPORT

  if (transport === 'memory') {
    return createMemoryBackend(options)
  }

  if (transport === 's3') {
    return createS3Backend(options)
  }

  if (transport === 'http') {
    // ★CR-8 / B11e：T2 自建服务端**已接线**。
    //   ★安全红线不变：**缺 endpoint 时构造即抛**（由 createHttpBackend 负责），
    //   **绝不回落到 s3** —— 涉密场景下「以为走内网、实际走公网」是安全事故级缺陷。
    //   本次接线**不改安全语义**：原来抛的是「未实装」，现在抛的是「未配置 endpoint」，
    //   两者都是构造期响亮失败，都不降级。
    //
    //   ★为何用**动态 require 式注入**而不是顶层 import：
    //   team-transport-http.js 与 team-transport.js **互相引用**（前者复用后者的
    //   withPrefix / trimSlashes 等纯函数）。ESM 循环 import 在提升期会产生 TDZ，
    //   顶层 `import { createHttpBackend }` 在本插件的手写模块加载器下不可靠。
    //   故由 **index.js 装配时注入**（见 options.createHttpBackend），
    //   未注入时按「未实装」处理 —— 保持响亮失败，仍是安全默认。
    const factory = safeGet(options, 'createHttpBackend')
    if (typeof factory === 'function') {
      return factory(options)
    }
    throw new Error('transport-not-implemented: http（T2 涉密内网通道未注入工厂；请在装配层传 options.createHttpBackend）')
  }

  throw new Error('transport-unknown: ' + transport)
}

/** 传输接缝的三个动词名（形式约束的可断言出口）。 */
export const TEAM_TRANSPORT_VERBS = ['put', 'get', 'list']

/** 已知通道枚举（值域可断言）。 */
export const TEAM_TRANSPORTS = ['s3', 'memory', 'http']

/** 默认通道（与 DEFAULT_CONFIG.teamSyncTransport 的默认值必须一致）。 */
export const TEAM_TRANSPORT_DEFAULT = DEFAULT_TRANSPORT
