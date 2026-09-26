/**
 * team-transport-http.js —— T2「涉密内网自建服务端」传输后端（独立模块；本文件不接线）。
 *
 * ## 定位
 * 'lib/team-transport.js' 是**唯一**通道接缝：上层同步语义只依赖 put / get / list 三个动词。
 * 本文件把该接缝落到 **T2 涉密内网自建服务端**：返回对象**恰好**含 put / get / list 三个
 * 自有可枚举键 —— 与 S3Backend / MemoryBackend **完全同形**（形式约束由 smoke 套件断言）。
 *
 * ★本模块**尚未接线**：'lib/team-transport.js' 里 transport: "http" 目前仍是**构造即抛**
 *   'transport-not-implemented: http（T2 涉密内网通道，未实装；不静默降级到 s3）'。
 *   接线（在 createTeamTransport 里分发到本模块）由 Lead 执行；本文件不碰单写者文件。
 *
 * ## 安全红线（涉密场景，实现级强制）
 *  1. ★**绝不静默降级到 S3**：本模块**不 import** 'team-transport.js'，不持有 bucket /
 *     region / accessKeyId / secretAccessKey 等任何 S3 配置 ⇒ 结构上不可能构造出 S3 请求。
 *     默认走 node:http / node:https（**不用 fetch**）；fetchImpl 只是**可选的替代传输**，
 *     不注入就一次都不调用（负路径 4 用「会抛的 fetch 桩 + 计数」证明）。
 *  2. ★**未配置 endpoint ⇒ 构造即抛** 'http-not-configured: endpoint'（与现存
 *     transport: "http" 的响亮失败语义一致）。与 s3 后端的差别是**故意**的：s3 是 T0/T1
 *     既成路径，缺配置只禁用该后端；T2 是涉密通道，「以为走内网、实际走了公网」是
 *     **安全事故级**缺陷 ⇒ 宁可抛，绝不静默降级。
 *  3. ★**运行期绝不外抛**：除构造期的配置检查外，一切异常（网络 / 超时 / JSON 解析 /
 *     非 2xx / 响应缺字段）一律收敛为 {ok:false, error} —— 与 team-sync「tick 绝不抛」同源。
 *  4. ★**非 2xx 一律失败**：401 / 403 / 500 全部 {ok:false}，**绝不把 401 或 500 当成功**。
 *  5. ★**成功判定不依赖响应体**：PUT 只认状态码 2xx；体只在「是 JSON 且带数字 bytes」时做
 *     长度交叉校验（不符 ⇒ http-put-len-mismatch）。理由：nginx 默认页等非 JSON 体在真机上
 *     很常见，若把解析失败当失败，**真实成功写入会被误判为失败**。
 *
 * ## T2 协议（本文件定义；服务端实现方须逐条对齐）
 *
 *  | 动词 | 请求                                              | 成功响应 |
 *  |------|---------------------------------------------------|----------|
 *  | put  | PUT <endpoint>/objects/<key>，body = 原始字节      | 2xx；体可空；体带数字 bytes 时须等于请求体长度 |
 *  | get  | GET <endpoint>/objects/<key>                       | 2xx，body = 原始字节（**二进制安全，不 base64**） |
 *  | list | GET <endpoint>/objects?prefix=<p>                  | 2xx，body = {"keys":["a/b.json",...]}（亦可裸数组） |
 *
 *  - 鉴权：配置了 token ⇒ 每个请求带 'Authorization: Bearer <token>'；未配置 ⇒ 不带该头。
 *  - 404：get ⇒ {ok:false, error:'not-found'}；put / list ⇒ {ok:false, error:'http-<动词>-status: 404'}。
 *  - 5xx：一律 {ok:false, error:'http-<动词>-status: <码>'}；get 的 500 **不得**被当成 not-found。
 *  - 编码：<key> 与 prefix 均 encodeURIComponent；服务端 decode 后即原键（故默认路径只解码一次，
 *    适配云 LB / 直连 IP / ssh 隧道；若服务端额外复解码，用 objectsPath 覆盖自适配）。
 *  - ★前缀语义：服务端必须在 decode **之后**做纯字符串前缀匹配（与 S3 ListObjectsV2、
 *    MemoryBackend 同语义）：list('team/a') 命中 'team/a.json' 与 'team/ab.json'，
 *    **不按 '/' 边界切分**；客户端不自作过滤，前缀由服务端权威执行。
 *  - objectsPath 缺省 '/objects'，可用同名字段覆盖（例：'/dam/objects'）。
 *
 * ## 键语义（团队前缀隔离）
 * withPrefix / withoutPrefix 在本文件内**等价实装**（team-transport.js 未导出这两个函数），
 * 与那里的实现**同语义**：存储键 = prefix + '/' + 去首尾斜杠的逻辑键，读回时剥回逻辑键。
 * 行为一致性由 smoke 套件的 EQ 组断言（memory / s3 / http 三后端产出逐字节相同）。
 */

import http from 'node:http'
import https from 'node:https'

/** 缺省对象路径前缀（与协议的 PUT/GET /objects/<key> 对齐）。 */
const DEFAULT_OBJECTS_PATH = '/objects'
/** 缺省单请求超时（毫秒）。涉密内网延迟不可控，给足但不无限等。 */
const DEFAULT_TIMEOUT_MS = 15000
/** 单次响应体上限（防超大响应把内存吃光）。 */
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

/** 保守转字符串：任何异常都退回空串（不抛）。—— 与 team-transport.js 同形。 */
function toText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try { return String(value) } catch (_) { return '' }
}

/** 安全取属性：getter 抛错也不外抛。—— 与 team-transport.js 同形。 */
function safeGet(target, key) {
  try { return target === null || target === undefined ? undefined : target[key] } catch (_) { return undefined }
}

/** 安全取错误消息。—— 与 team-transport.js 同形。 */
function safeMessage(error) {
  try { return toText(safeGet(error, 'message')) || toText(error) } catch (_) { return '' }
}

/** 诊断钩子：失败不放大。—— 与 team-transport.js 同形。 */
function safeDiag(diag, message) {
  if (typeof diag !== 'function') return
  try { diag(toText(message)) } catch (_) { /* diag 自身异常不得影响主流程 */ }
}

/** 去掉首尾斜杠。—— 与 team-transport.js 同形。 */
function trimSlashes(value) {
  return toText(value).replace(/^\/+/, '').replace(/\/+$/, '')
}

/** ★与 team-transport.js 的 withPrefix **同语义**（该函数未导出，故此处等价实装）。 */
function withPrefix(prefix, key) {
  const k = trimSlashes(key)
  if (!prefix) return k
  if (!k) return prefix
  return prefix + '/' + k
}

/** ★与 team-transport.js 的 withoutPrefix **同语义**。 */
function withoutPrefix(prefix, stored) {
  if (!prefix) return stored
  const p = prefix + '/'
  return stored.indexOf(p) === 0 ? stored.slice(p.length) : stored
}

/** 值归一化为 Buffer（string / Buffer / TypedArray / 其它走 String）。—— 与 team-transport.js 同形。 */
function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  return Buffer.from(toText(value), 'utf8')
}

/** 全序比较器（码元序，非 localeCompare）—— 跨机收敛要求全序。—— 与 team-transport.js 同形。 */
function compareKeys(a, b) {
  const x = toText(a)
  const y = toText(b)
  if (x === y) return 0
  return x < y ? -1 : 1
}

/** 解析 JSON 体：空体 / 非 JSON 视为「无 JSON」（**不是错误**，见安全红线 5）。 */
function readJsonBytes(body) {
  const text = toText(body ? body.toString('utf8') : '').trim()
  if (!text) return { parsed: false, value: null }
  try { return { parsed: true, value: JSON.parse(text) } } catch (_) { return { parsed: false, value: null } }
}

/** 规范化 objectsPath：空 ⇒ 缺省值；保证「以 / 开头、无尾斜杠」。 */
function normalizeObjectsPath(raw) {
  const s = toText(raw)
  if (!s) return DEFAULT_OBJECTS_PATH
  if (s === '/') return ''
  const withLead = s.charAt(0) === '/' ? s : '/' + s
  return withLead.replace(/\/+$/, '')
}

/** 解析超时配置：非数字或 <= 0 ⇒ 缺省值；0 显式表示「不超时」。 */
function normalizeTimeout(raw) {
  if (raw === 0) return 0
  const n = typeof raw === 'number' ? raw : Number(toText(raw))
  if (!isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return n
}

/**
 * baseRequest —— 最小 HTTP 客户端（node:http / node:https，**零第三方依赖**）。
 * 成功 ⇒ resolve({status, headers, body:Buffer})；失败 ⇒ reject(Error)。
 * 注意：本函数**不**使用全局 fetch —— T2 默认传输必须完全落在 node 内置的 http/https 上。
 */
function baseRequest(input, init) {
  return new Promise(function (resolve, reject) {
    let u = null
    try { u = new URL(toText(input)) } catch (error) {
      reject(new Error('http-bad-url: ' + safeMessage(error)))
      return
    }
    const secure = u.protocol === 'https:'
    if (!secure && u.protocol !== 'http:') {
      reject(new Error('http-bad-url: 协议仅支持 http/https，实得 ' + u.protocol))
      return
    }
    const mod = secure ? https : http
    const opts = {
      method: toText(init.method) || 'GET',
      hostname: u.hostname,
      port: u.port || undefined,
      path: (u.pathname || '/') + (u.search || ''),
      headers: init.headers || {},
    }
    if (init.agent) opts.agent = init.agent
    let settled = false
    let timer = null
    function done(error, value) {
      if (settled) return
      settled = true
      if (timer) { clearTimeout(timer); timer = null }
      if (error) reject(error); else resolve(value)
    }
    const req = mod.request(opts, function (res) {
      const chunks = []
      let total = 0
      res.on('data', function (chunk) {
        total += chunk.length
        if (total > MAX_RESPONSE_BYTES) {
          try { req.destroy() } catch (_) { /* 破坏失败不影响结论 */ }
          done(new Error('http-response-too-large: > ' + MAX_RESPONSE_BYTES + ' bytes'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', function () {
        done(null, { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })
      })
      res.on('error', function (error) {
        done(new Error(safeMessage(error)))
      })
    })
    req.on('error', function (error) {
      done(new Error(safeMessage(error)))
    })
    const timeoutMs = init.timeoutMs
    if (timeoutMs > 0) {
      timer = setTimeout(function () {
        try { req.destroy() } catch (_) { /* 破坏失败不影响结论 */ }
        done(new Error('http-timeout: ' + timeoutMs + 'ms'))
      }, timeoutMs)
      if (timer && typeof timer.unref === 'function') timer.unref()
    }
    try {
      if (init.body !== null && init.body !== undefined) req.write(init.body)
      req.end()
    } catch (error) {
      done(new Error('write-failed: ' + safeMessage(error)))
    }
  })
}

/**
 * fetchRequest —— fetchImpl 适配器（**可选的替代传输**，不注入则一次都不调用）。
 * 与 baseRequest 归一为同一形状 {status, body}，故上层判定逻辑完全共用。
 */
function fetchRequest(fetchImpl, input, init) {
  const options = { method: init.method, headers: init.headers }
  if (init.body !== null && init.body !== undefined) options.body = init.body
  return Promise.resolve(fetchImpl(input, options)).then(function (res) {
    const status = safeGet(res, 'status')
    return Promise.resolve(res.arrayBuffer()).then(function (buf) {
      return { status: status, body: Buffer.from(buf) }
    })
  })
}

/**
 * createHttpBackend —— T2「涉密内网自建服务端」后端（接缝与 S3Backend / MemoryBackend 完全同形）。
 *
 * @param {object} options
 *   - endpoint      : **必填**。服务端基址，例 'http://10.0.0.7:8080'（**未配置 ⇒ 构造即抛**）
 *   - token         : 可选。配置后每个请求带 'Authorization: Bearer <token>'
 *   - prefix        : 可选。团队键前缀（隔离用）
 *   - objectsPath   : 可选。对象路径，缺省 '/objects'
 *   - timeoutMs     : 可选。单请求超时，缺省 15000；显式 0 = 不超时
 *   - fetchImpl     : 可选。注入即改用该 fetch（测试用）；**不注入则完全不碰 fetch**
 *   - agent         : 可选。node:http/https 的 Agent（内网 mTLS / 连接池）
 *   - diag          : 可选。诊断钩子
 *
 * 构造期抛错（**响亮失败，绝不静默降级到 s3**）：
 *   - 缺 endpoint        ⇒ Error('http-not-configured: endpoint')
 *   - endpoint 非法/非 http(s) 协议 ⇒ Error('http-bad-endpoint: <值>')
 * 除以上两条外，运行期**绝不外抛**：一切异常收敛为 {ok:false, error}。
 */
export function createHttpBackend(options = {}) {
  const rawEndpoint = toText(safeGet(options, 'endpoint'))
  const endpoint = trimSlashes(rawEndpoint)
  if (!endpoint || !rawEndpoint.trim()) throw new Error('http-not-configured: endpoint')
  let endpointUrl = null
  try { endpointUrl = new URL(endpoint) } catch (_) { endpointUrl = null }
  if (!endpointUrl || (endpointUrl.protocol !== 'http:' && endpointUrl.protocol !== 'https:')) {
    throw new Error('http-bad-endpoint: ' + endpoint)
  }
  const token = toText(safeGet(options, 'token'))
  const prefix = trimSlashes(safeGet(options, 'prefix'))
  const objectsPath = normalizeObjectsPath(safeGet(options, 'objectsPath'))
  const timeoutMs = normalizeTimeout(safeGet(options, 'timeoutMs'))
  const diag = safeGet(options, 'diag')
  const fetchImpl = safeGet(options, 'fetchImpl')
  const hasFetchImpl = typeof fetchImpl === 'function'
  const agent = safeGet(options, 'agent')
  const origin = endpointUrl.protocol + '//' + endpointUrl.host
  const basePath = trimSlashes(endpointUrl.pathname)

  /** 拼路径（各段去首尾斜杠后用 '/' 连接，恒以 '/' 开头）。 */
  function joinPath() {
    const parts = []
    for (let i = 0; i < arguments.length; i++) {
      const s = trimSlashes(toText(arguments[i]))
      if (s) parts.push(s)
    }
    return '/' + parts.join('/')
  }

  /** 完整对象键（含团队前缀）—— 与 MemoryBackend / S3Backend 共用同一套语义。 */
  function fullKey(key) { return withPrefix(prefix, key) }

  /** 单对象 URL：PUT/GET <endpoint><objectsPath>/<encodeURIComponent(存储键)>。 */
  function objectUrl(stored) {
    return origin + joinPath(basePath, objectsPath, encodeURIComponent(stored))
  }

  /** 列表 URL：GET <endpoint><objectsPath>?prefix=<encodeURIComponent(存储前缀)>。 */
  function listUrl(fullPrefix) {
    const url = origin + joinPath(basePath, objectsPath)
    return fullPrefix ? url + '?prefix=' + encodeURIComponent(fullPrefix) : url
  }

  /** 请求头（含 Bearer 与 Content-Length）。 */
  function requestHeaders(bodyLen) {
    const headers = { Accept: 'application/json' }
    if (bodyLen !== null && bodyLen !== undefined) {
      headers['Content-Type'] = 'application/octet-stream'
      headers['Content-Length'] = String(bodyLen)
    }
    if (token) headers.Authorization = 'Bearer ' + token
    return headers
  }

  /** 统一请求执行器：异常收敛为 {ok:false, error}，返回 {ok:true, status, body}。 */
  function doRequest(method, url, body) {
    const hasBody = body !== null && body !== undefined
    const init = {
      method: method,
      headers: requestHeaders(hasBody ? body.length : null),
      body: hasBody ? body : null,
      timeoutMs: timeoutMs,
      agent: agent,
    }
    let promise = null
    try {
      promise = hasFetchImpl ? fetchRequest(fetchImpl, url, init) : baseRequest(url, init)
    } catch (error) {
      safeDiag(diag, 'http ' + method + ' 失败: ' + safeMessage(error))
      return Promise.resolve({ ok: false, error: 'http-request-failed: ' + safeMessage(error) })
    }
    return promise.then(function (res) {
      return { ok: true, status: safeGet(res, 'status'), body: safeGet(res, 'body') }
    }, function (error) {
      safeDiag(diag, 'http ' + method + ' 失败: ' + safeMessage(error))
      return { ok: false, error: 'http-request-failed: ' + safeMessage(error) }
    })
  }

  /**
   * put(key, value) ⇒ {ok:true, key, bytes}
   * 成功判定**只看状态码 2xx**；响应体仅在「是 JSON 且带数字 bytes」时做长度交叉校验。
   */
  function put(key, value) {
    const k = toText(key)
    if (!k) return Promise.resolve({ ok: false, error: 'bad-key' })
    const body = toBuffer(value)
    return doRequest('PUT', objectUrl(fullKey(k)), body).then(function (r) {
      if (!r.ok) return r
      if (r.status < 200 || r.status >= 300) return { ok: false, error: 'http-put-status: ' + r.status }
      const parsed = readJsonBytes(r.body)
      if (parsed.parsed && parsed.value && typeof parsed.value.bytes === 'number' && parsed.value.bytes !== body.length) {
        return { ok: false, error: 'http-put-len-mismatch: ' + parsed.value.bytes + ' != ' + body.length }
      }
      return { ok: true, key: k, bytes: body.length }
    })
  }

  /**
   * get(key) ⇒ {ok:true, key, value:Buffer, bytes}
   * 404 ⇒ {ok:false, error:'not-found'}；其它非 2xx（含 401/403/500）⇒ {ok:false, error:'http-get-status: <码>'}。
   */
  function get(key) {
    const k = toText(key)
    if (!k) return Promise.resolve({ ok: false, error: 'bad-key' })
    return doRequest('GET', objectUrl(fullKey(k)), null).then(function (r) {
      if (!r.ok) return r
      if (r.status === 404) return { ok: false, error: 'not-found' }
      if (r.status < 200 || r.status >= 300) return { ok: false, error: 'http-get-status: ' + r.status }
      const buf = Buffer.isBuffer(r.body) ? r.body : Buffer.alloc(0)
      return { ok: true, key: k, value: buf, bytes: buf.length }
    })
  }

  /**
   * list(prefixArg) ⇒ {ok:true, keys:[逻辑键]}
   * ★前缀过滤由**服务端权威执行**（与 S3 ListObjectsV2 / MemoryBackend 同语义：纯字符串
   *   前缀匹配，不按 '/' 边界切分）；客户端只做「去团队前缀 + 全序排序」。
   * 键列表形状：{"keys":[...]}（亦接受裸数组）；非 JSON ⇒ http-list-bad-json；非上述形状 ⇒ http-list-bad-shape。
   */
  function list(prefixArg) {
    const p = trimSlashes(toText(prefixArg))
    const fullPrefix = withPrefix(prefix, p)
    return doRequest('GET', listUrl(fullPrefix), null).then(function (r) {
      if (!r.ok) return r
      if (r.status < 200 || r.status >= 300) return { ok: false, error: 'http-list-status: ' + r.status }
      const parsed = readJsonBytes(r.body)
      if (!parsed.parsed) return { ok: false, error: 'http-list-bad-json' }
      let raw = null
      if (Array.isArray(parsed.value)) raw = parsed.value
      else if (parsed.value && Array.isArray(parsed.value.keys)) raw = parsed.value.keys
      if (!raw) return { ok: false, error: 'http-list-bad-shape' }
      const out = []
      for (let i = 0; i < raw.length; i++) {
        const stored = toText(raw[i])
        if (!stored) continue
        out.push(withoutPrefix(prefix, stored))
      }
      out.sort(compareKeys)
      return { ok: true, keys: out }
    })
  }

  return { put: put, get: get, list: list }
}
