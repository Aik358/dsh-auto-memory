/**
 * 团队出站鉴权(team-auth)—— 团队请求的唯一出口。
 *
 * 设计铁律(与入站守卫 isLoopbackRequest **完全正交**,不改动入站):
 *  ① 所有出站都经此,**禁止各处裸 fetch**;
 *  ② **零抛出** —— 未配置 / 未登录 / 超时 / 非 2xx 四种情形一律返回 { ok:false, reason },
 *     出站失败绝不影响本机功能;
 *  ③ token 从宿主凭据 seam 取,**插件不落明文**;
 *  ④ 三件套头:authorization: Bearer <token> + x-dam-team(租户隔离)+ x-dam-client(版本兼容)。
 *
 * 契约 createTeamFetch({ ctx, engine, identity, diag, config }) 返回 async teamFetch(url, opts)。
 * opts 支持 { method, body, headers, timeoutMs, signal, fetchImpl };超时默认 10s。
 *
 * 已知 reason 取值(全部为稳定字符串,便于调用方分支与断言):
 *  · 'not-configured'   —— 团队未启用 / serverUrl 或 teamId 缺失
 *  · 'bad-url'          —— 地址无法解析为绝对 URL
 *  · 'not-authenticated'—— 拿不到成员 token
 *  · 'fetch-unavailable'—— 运行环境无 fetch 实现
 *  · 'timeout'          —— 本模块计时器触发的中止
 *  · 'aborted'          —— 调用方传入的 signal 中止
 *  · 'http-<status>'    —— 非 2xx(如 'http-401')
 *  · 'network-error'    —— fetch 抛错(断网 / DNS / TLS 等)
 *  · 'error'            —— 其余未预期异常(含中止原因不可判定)
 */
import { readFileSync } from 'node:fs'

const DEFAULT_TIMEOUT_MS = 10000
const CLIENT_HEADER = 'x-dam-client'
const CLIENT_NAME = 'dsh-auto-memory'
const TOKEN_KEYS = ['teamToken', 'team-token', 'damTeamToken']
const DETAIL_LIMIT = 500
/**
 * ★2026-10-21（线上 12GB / 进程 29GB 事故）：**响应体硬上限**。
 *
 * 事故形态：本模块只做 `await response.text()`，**没有任何字节上限** ⇒ 服务端一次返回整个变更史
 *   （事故现场 12GB）时，客户端把整份响应一次性读进一条字符串 ⇒ 客户端自己先 OOM。
 *   同一缺陷让「游标卡死」从「慢」升级成「必炸」。
 *
 * 取值理由：正常增量响应是几十 KB 量级，32MB 已是三个数量级的余量；超过它**必定是异常**
 *   （游标失效 / 服务端忽略 since / 全量端点误用），此时**明确失败**远好过静默吃内存。
 *   注意这不改变业务语义：超过即 { ok:false, reason:'response-too-large' }，调用方按可重试处理。
 */
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024

let cachedVersion = ''

/** 包版本:仅用于 x-dam-client;读不到就退化为 '0.0.0',绝不抛、不阻断出站。 */
function packageVersion() {
  if (cachedVersion) return cachedVersion
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    const parsed = JSON.parse(raw)
    cachedVersion = String((parsed && parsed.version) || '') || '0.0.0'
  } catch (_) { cachedVersion = '0.0.0' }
  return cachedVersion
}

function toText(value) {
  if (value === null || value === undefined) return ''
  try { return String(value).trim() } catch (_) { return '' }
}

function safeGet(holder, key) {
  try { return holder ? holder[key] : undefined } catch (_) { return undefined }
}

function safeDiag(diag, message) {
  try { if (typeof diag === 'function') diag(message) } catch (_) {}
}

function safeMessage(error) {
  return toText(error && error.message) || toText(error) || 'unknown-error'
}

function safeCall(fn, thisArg, args) {
  try { return typeof fn === 'function' ? fn.apply(thisArg, args) : undefined } catch (_) { return undefined }
}

/** 读容器的 name / get(name) / read(name) 形状;三种宿主写法都试,失败返回空串。 */
function readHolder(holder, key) {
  const direct = toText(safeGet(holder, key))
  if (direct) return direct
  if (!holder || typeof holder !== 'object') return ''
  for (const method of ['get', 'read', 'getToken']) {
    const fn = safeGet(holder, method)
    if (typeof fn !== 'function') continue
    const value = toText(safeCall(fn, holder, [key]))
    if (value) return value
  }
  return ''
}

/** 归一化超时:非法值(非有限 / <=0)一律回落到默认 10s。 */
function normalizeTimeout(value, fallback) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  return fallback
}

function detailOf(text) {
  const trimmed = toText(text)
  return trimmed.length > DETAIL_LIMIT ? trimmed.slice(0, DETAIL_LIMIT) : trimmed
}

/**
 * 响应体的**有界**读取（★#534，线上 12GB 事故第二现场）。
 *
 * 旧写法 `return toText(await response.text())` 是「先读完再判限」：`response.text()`
 *   一旦开始就把整份响应体读进内存，等到调用点再比字节数时，64 MiB 早已全部驻留 ——
 *   上限只是**结论**，不是**约束**（实测：bytes=67108864 / pulls=65 / cancelled=false）。
 *
 * 现在：优先 `body.getReader()` 逐块读，累计 `byteLength`，**首个越限块**立即
 *   `reader.cancel('response-too-large')`（释放底层连接、停止继续拉流）并返回实测已读字节数。
 *
 * 为什么合并后**一次性** decode：逐块 `decode(chunk)` 不带 `{stream:true}` 会把跨块的
 *   多字节字符切成两段 U+FFFD（中文/emoji 正文被静默损坏）。先拼 Uint8Array 再整段
 *   decode 一次，与 `response.text()` 的结果**逐字等价**。
 *
 * 无 body / 已被宿主消费 / 测试桩 / 204 / HEAD ⇒ 回退 `response.text()`，
 *   仍按 UTF-8 实测字节判限（结构上没有流可截，但结论一致）。
 *
 * @param {any} response fetch 的 Response（或等价桩）
 * @param {number} maxBytes 字节上限
 * @returns {Promise<{tooLarge:boolean, bytes:number, text:string}>}
 */
async function readBodyText(response, maxBytes) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_RESPONSE_BYTES
  const body = safeGet(response, 'body')
  let reader = null
  if (body && typeof body.getReader === 'function') {
    try { reader = body.getReader() } catch (_) { reader = null /* 已锁/已消费 ⇒ 走整读回退 */ }
  }
  if (!reader) {
    //  判限用**原始**文本的 UTF-8 字节数，与流式分支（按 chunk.byteLength 累计，未 trim）同口径：
    //  若先 trim 再计量，尾部空白很大的响应在两条分支上会得出不同结论（同一语义两套判据）。
    const source = await response.text()
    const bytes = utf8BytesOf(typeof source === 'string' ? source : String(source === null || source === undefined ? '' : source))
    if (bytes > limit) return { tooLarge: true, bytes: bytes, text: '' }
    return { tooLarge: false, bytes: bytes, text: toText(source) }
  }
  const chunks = []
  let total = 0
  try {
    for (;;) {
      const step = await reader.read()
      if (!step || step.done) break
      const value = step.value
      let chunk = null
      if (value instanceof Uint8Array) chunk = value
      else if (value && typeof value.byteLength === 'number') { try { chunk = new Uint8Array(value) } catch (_) { chunk = null } }
      if (!chunk) continue
      total += chunk.byteLength
      if (total > limit) {
        // 越限块**不保留**（省一份拷贝）；cancel 让底层停止拉流，而不是把余下几十 MiB 拉完再丢。
        try { await reader.cancel('response-too-large') } catch (_) { /* 取消失败不改变 tooLarge 结论 */ }
        return { tooLarge: true, bytes: total, text: '' }
      }
      chunks.push(chunk)
    }
  } finally {
    try { reader.releaseLock() } catch (_) { /* 已 cancel / 已释放时忽略 */ }
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (let i = 0; i < chunks.length; i++) {
    merged.set(chunks[i], offset)
    offset += chunks[i].byteLength
  }
  return { tooLarge: false, bytes: total, text: toText(decodeUtf8(merged)) }
}

/** 整段 decode：**只有这一处**做 UTF-8 解码，保证跨块多字节字符不被拆坏（★#534）。 */
function decodeUtf8(bytes) {
  try { return new TextDecoder('utf-8').decode(bytes) } catch (_) { return '' }
}

/** 释放响应体（预检命中时用）：ReadableStream 有 cancel；只有 getReader 的宿主则 cancel 后放锁。 */
async function cancelBody(response, reason) {
  try {
    const body = safeGet(response, 'body')
    if (!body) return
    if (typeof body.cancel === 'function') { await body.cancel(reason); return }
    if (typeof body.getReader !== 'function') return
    const reader = body.getReader()
    try { await reader.cancel(reason) } catch (_) { /* 取消失败不影响失败结论 */ }
    try { reader.releaseLock() } catch (_) { /* 同上 */ }
  } catch (_) { /* 清理动作：形状不可预期时静默，不改变判定 */ }
}

/**
 * ★2026-10-21：读体**之前**先用 content-length 拦一次（真实 fetch 一定带 headers）。
 *   预检的价值（★#534 之后依然成立）：能省掉一次流式读的全部开销 —— 连第一块都不拉，
 *   直接 cancel 释放底层连接。**它不再是唯一防线**：无该头 / 分块传输 / 头谎报时，
 *   由 readBodyText 在**读取阶段**按已读字节截断（先读后判等于没判，见线上 12GB 事故）。
 *   桩/无 headers/无该字段 ⇒ 返回 null（交给读取阶段判限，不因取不到头就判失败）。
 * @returns {number|null} 声明的字节数；未声明返回 null
 */
function declaredBytesOf(response) {
  try {
    const headers = response && response.headers
    const raw = headers && typeof headers.get === 'function' ? headers.get('content-length') : null
    if (raw === null || raw === undefined || raw === '') return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  } catch (_) { return null }
}

/** 文本的 UTF-8 字节数（不用 Buffer，避免本模块再多一条 node: 依赖）。 */
function utf8BytesOf(text) {
  try { return new TextEncoder().encode(text).length } catch (_) { return text.length }
}

/**
 * @param {{ctx?:object, engine?:object, identity?:object, diag?:Function, config?:object}} [deps]
 *   config 可显式传入;缺省读 engine.config(键:teamEnabled / serverUrl / teamServerUrl / teamId / timeoutMs)
 * @returns {Function} async teamFetch(url, opts)
 */
export function createTeamFetch({ ctx, engine, identity, diag, config } = {}) {
  // Resolve current configuration on every request; saveConfig replaces engine.config.
  const configOf = () => config || safeGet(engine, 'config') || {}
  let disposed = false
  const active = new Set()

  function serverUrlOf(cfg = configOf()) {
    return toText(safeGet(cfg, 'serverUrl')) || toText(safeGet(cfg, 'teamServerUrl'))
  }

  function teamIdOf(cfg = configOf()) {
    return toText(safeGet(cfg, 'teamId'))
  }

  function defaultTimeoutMs(cfg = configOf()) {
    return normalizeTimeout(safeGet(cfg, 'timeoutMs'), DEFAULT_TIMEOUT_MS)
  }

  /** 取成员 token:identity 注入优先,其次宿主凭据/授权 seam,最后配置里的显式 token。 */
  async function readToken(cfg = configOf()) {
    try {
      const fromIdentity = safeGet(identity, 'getToken')
      if (typeof fromIdentity === 'function') {
        const value = toText(await fromIdentity.call(identity))
        if (value) return value
      }
      const identityToken = toText(safeGet(identity, 'token'))
      if (identityToken) return identityToken

      const credentials = safeGet(ctx, 'credentials')
      for (const key of TOKEN_KEYS) {
        const value = readHolder(credentials, key)
        if (value) return value
      }

      const authorization = safeGet(ctx, 'authorization')
      for (const key of TOKEN_KEYS) {
        const value = readHolder(authorization, key)
        if (value) return value
      }
      const bearer = readHolder(authorization, 'token') || readHolder(authorization, 'bearer')
      if (bearer) return bearer

      for (const key of TOKEN_KEYS) {
        const value = toText(safeGet(cfg, key))
        if (value) return value
      }
      return ''
    } catch (error) {
      safeDiag(diag, 'team-auth token: ' + safeMessage(error))
      return ''
    }
  }

  /**
   * 团队请求出口。**任何失败都以 { ok:false, reason } 返回,绝不抛。**
   * @param {string} url 绝对地址,或相对 serverUrl 的路径
   * @param {{method?:string, body?:any, headers?:object, timeoutMs?:number, signal?:AbortSignal, fetchImpl?:Function}} [opts]
   */
  async function teamFetch(url, opts) {
    const options = opts && typeof opts === 'object' ? opts : {}
    let timer = null
    let controller = null
    let callerSignal = null
    let onCallerAbort = null
    let timedOut = false
    let callerAborted = false
    try {
      if (disposed || safeGet(engine, '_teamDisposed')) return { ok: false, reason: 'disposed' }
      const epoch = safeGet(engine, '_teamEpoch') || 0
      const cfg = configOf()
      const target = toText(url)
      if (!target) return { ok: false, reason: 'bad-url' }

      if (safeGet(cfg, 'teamEnabled') === false) return { ok: false, reason: 'not-configured' }
      const serverUrl = serverUrlOf(cfg)
      const teamId = teamIdOf(cfg)
      if (!serverUrl || !teamId) return { ok: false, reason: 'not-configured' }

      let endpoint = null
      try { endpoint = new URL(target, serverUrl) } catch (_) { return { ok: false, reason: 'bad-url' } }

      const token = await readToken(cfg)
      if (!token) return { ok: false, reason: 'not-authenticated' }
      if (disposed || safeGet(engine, '_teamDisposed') || safeGet(engine, '_teamPaused') || safeGet(configOf(), 'teamEnabled') === false || (safeGet(engine, '_teamEpoch') || 0) !== epoch) return { ok: false, reason: 'invalidated' }

      const fetchImpl = options.fetchImpl || safeGet(cfg, 'fetchImpl') || safeGet(globalThis, 'fetch')
      if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch-unavailable' }

      const method = toText(options.method) || 'GET'
      const headers = {
        'content-type': 'application/json',
        'authorization': 'Bearer ' + token,
        'x-dam-team': teamId,
        [CLIENT_HEADER]: CLIENT_NAME + '/' + packageVersion(),
      }
      const extra = options.headers
      if (extra && typeof extra === 'object') {
        for (const key of Object.keys(extra)) headers[key] = extra[key]
      }

      // 超时:本模块自己的 AbortController;调用方 signal 额外联动(不覆盖、二选一优先)。
      controller = new AbortController()
      active.add(controller)
      callerSignal = options.signal || null
      if (callerSignal && typeof callerSignal.addEventListener === 'function') {
        onCallerAbort = () => { callerAborted = true; try { controller.abort() } catch (_) {} }
        if (callerSignal.aborted) onCallerAbort()
        else callerSignal.addEventListener('abort', onCallerAbort)
      }
      const timeoutMs = normalizeTimeout(options.timeoutMs, defaultTimeoutMs(cfg))
      // ★ 计时器**不能 unref**:超时若成为唯一待决句柄,事件循环会先于超时退出
      //   (await 中的调用方被挂死 / 测试里表现为 unsettled top-level await)。
      //   泄漏风险由 finally 的 clearTimeout 兜住 —— 成功路径同样会清掉计时器。
      timer = setTimeout(() => { timedOut = true; try { controller.abort() } catch (_) {} }, timeoutMs)

      let response = null
      try {
        response = await fetchImpl(endpoint, {
          method,
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        })
      } catch (error) {
        if (timedOut) return { ok: false, reason: 'timeout', timeoutMs }
        if (callerAborted) return { ok: false, reason: 'aborted' }
        safeDiag(diag, 'team-auth fetch: ' + safeMessage(error))
        return { ok: false, reason: 'network-error', detail: safeMessage(error) }
      }

      if (disposed || safeGet(engine, '_teamDisposed') || safeGet(engine, '_teamPaused') || safeGet(configOf(), 'teamEnabled') === false || (safeGet(engine, '_teamEpoch') || 0) !== epoch) return { ok: false, reason: 'invalidated' }
      const status = Number(safeGet(response, 'status')) || 0
      // ★2026-10-21：先看 content-length（能拦住绝大多数异常大响应，不必先把它读进内存）
      const declaredBytes = declaredBytesOf(response)
      if (declaredBytes !== null && declaredBytes > MAX_RESPONSE_BYTES) {
        safeDiag(diag, 'team-auth response-too-large(declared): ' + declaredBytes)
        // ★#534：早退前**必须**释放 body —— 否则「声明超限」只拒绝了结论，响应体仍在被拉，
        //   内存照涨（实测旧版 cancelled=false）。取消失败不影响失败结论。
        await cancelBody(response, 'response-too-large')
        return { ok: false, status: status, reason: 'response-too-large', bytes: declaredBytes, maxBytes: MAX_RESPONSE_BYTES }
      }
      const read = await readBodyText(response, MAX_RESPONSE_BYTES)
      // ★#534：上限**已在读取阶段**执行（流式逐块判限 / 无流回退的实测字节判限）。
      //   这里不再做「读后再判」：那既拦不住峰值内存（读都读完了），又会对整份文本
      //   再 allocate 一份 TextEncoder 副本。同一语义只留一个执行点，避免两条判据半修。
      if (read.tooLarge) {
        safeDiag(diag, 'team-auth response-too-large(stream): ' + read.bytes)
        return { ok: false, status: status, reason: 'response-too-large', bytes: read.bytes, maxBytes: MAX_RESPONSE_BYTES }
      }
      const raw = read.text
      if (timedOut) return { ok: false, reason: 'timeout' }
      if (callerAborted || controller.signal.aborted) return { ok: false, reason: 'aborted' }
      if (disposed || safeGet(engine, '_teamDisposed') || safeGet(engine, '_teamPaused') || safeGet(configOf(), 'teamEnabled') === false || (safeGet(engine, '_teamEpoch') || 0) !== epoch) return { ok: false, reason: 'invalidated' }
      if (status < 200 || status > 299) {
        return { ok: false, reason: 'http-' + status, status, detail: detailOf(raw) }
      }

      let data = null
      let text = ''
      if (raw) {
        try { data = JSON.parse(raw) } catch (_) { data = null; text = raw }
      }
      if (data && (data.ok === false || data.error)) return { ok: false, status, reason: toText(data.reason || data.error) || 'business-rejected', data }
      return { ok: true, status, data, text }
    } catch (error) {
      // 兜底:任何未预期异常都不得逃逸到调用方(出站失败不影响本机)。
      if (timedOut) return { ok: false, reason: 'timeout' }
      if (callerAborted) return { ok: false, reason: 'aborted' }
      safeDiag(diag, 'team-auth unexpected: ' + safeMessage(error))
      return { ok: false, reason: 'error', detail: safeMessage(error) }
    } finally {
      if (controller) active.delete(controller)
      if (timer) { try { clearTimeout(timer) } catch (_) {} }
      if (callerSignal && onCallerAbort && typeof callerSignal.removeEventListener === 'function') {
        try { callerSignal.removeEventListener('abort', onCallerAbort) } catch (_) {}
      }
    }
  }

  /** 团队出站是否具备基本条件(未登录不算未配置:两者语义不同,调用方需分别提示)。 */
  function describe() {
    try {
      const cfg = configOf()
      const serverUrl = serverUrlOf(cfg)
      const teamId = teamIdOf(cfg)
      const configured = safeGet(cfg, 'teamEnabled') !== false && !!serverUrl && !!teamId
      return { configured, serverUrlConfigured: !!serverUrl, teamIdConfigured: !!teamId, timeoutMs: defaultTimeoutMs(cfg) }
    } catch (error) {
      safeDiag(diag, 'team-auth describe: ' + safeMessage(error))
      return { configured: false, serverUrlConfigured: false, teamIdConfigured: false, timeoutMs: DEFAULT_TIMEOUT_MS }
    }
  }

  teamFetch.describe = describe
  teamFetch.readToken = readToken
  teamFetch.dispose = () => { disposed = true; for (const controller of active) controller.abort(); active.clear() }
  return teamFetch
}
