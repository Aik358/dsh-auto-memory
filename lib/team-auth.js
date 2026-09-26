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

/** 等价的 "静默读体":body 已被消费 / 读失败都当空串,绝不能因此抛。 */
async function readBodyText(response) {
  try { return toText(await response.text()) } catch (_) { return '' }
}

/**
 * @param {{ctx?:object, engine?:object, identity?:object, diag?:Function, config?:object}} [deps]
 *   config 可显式传入;缺省读 engine.config(键:teamEnabled / serverUrl / teamServerUrl / teamId / timeoutMs)
 * @returns {Function} async teamFetch(url, opts)
 */
export function createTeamFetch({ ctx, engine, identity, diag, config } = {}) {
  const cfg = config || safeGet(engine, 'config') || {}

  function serverUrlOf() {
    return toText(safeGet(cfg, 'serverUrl')) || toText(safeGet(cfg, 'teamServerUrl'))
  }

  function teamIdOf() {
    return toText(safeGet(cfg, 'teamId'))
  }

  function defaultTimeoutMs() {
    return normalizeTimeout(safeGet(cfg, 'timeoutMs'), DEFAULT_TIMEOUT_MS)
  }

  /** 取成员 token:identity 注入优先,其次宿主凭据/授权 seam,最后配置里的显式 token。 */
  async function readToken() {
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
      const target = toText(url)
      if (!target) return { ok: false, reason: 'bad-url' }

      if (safeGet(cfg, 'teamEnabled') === false) return { ok: false, reason: 'not-configured' }
      const serverUrl = serverUrlOf()
      const teamId = teamIdOf()
      if (!serverUrl || !teamId) return { ok: false, reason: 'not-configured' }

      let endpoint = null
      try { endpoint = new URL(target, serverUrl) } catch (_) { return { ok: false, reason: 'bad-url' } }

      const token = await readToken()
      if (!token) return { ok: false, reason: 'not-authenticated' }

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
      callerSignal = options.signal || null
      if (callerSignal && typeof callerSignal.addEventListener === 'function') {
        onCallerAbort = () => { callerAborted = true; try { controller.abort() } catch (_) {} }
        if (callerSignal.aborted) onCallerAbort()
        else callerSignal.addEventListener('abort', onCallerAbort)
      }
      const timeoutMs = normalizeTimeout(options.timeoutMs, defaultTimeoutMs())
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

      const status = Number(safeGet(response, 'status')) || 0
      const raw = await readBodyText(response)
      if (status < 200 || status > 299) {
        return { ok: false, reason: 'http-' + status, status, detail: detailOf(raw) }
      }

      let data = null
      let text = ''
      if (raw) {
        try { data = JSON.parse(raw) } catch (_) { data = null; text = raw }
      }
      return { ok: true, status, data, text }
    } catch (error) {
      // 兜底:任何未预期异常都不得逃逸到调用方(出站失败不影响本机)。
      if (timedOut) return { ok: false, reason: 'timeout' }
      safeDiag(diag, 'team-auth unexpected: ' + safeMessage(error))
      return { ok: false, reason: 'error', detail: safeMessage(error) }
    } finally {
      if (timer) { try { clearTimeout(timer) } catch (_) {} }
      if (callerSignal && onCallerAbort && typeof callerSignal.removeEventListener === 'function') {
        try { callerSignal.removeEventListener('abort', onCallerAbort) } catch (_) {}
      }
    }
  }

  /** 团队出站是否具备基本条件(未登录不算未配置:两者语义不同,调用方需分别提示)。 */
  function describe() {
    try {
      const serverUrl = serverUrlOf()
      const teamId = teamIdOf()
      const configured = safeGet(cfg, 'teamEnabled') !== false && !!serverUrl && !!teamId
      return { configured, serverUrlConfigured: !!serverUrl, teamIdConfigured: !!teamId, timeoutMs: defaultTimeoutMs() }
    } catch (error) {
      safeDiag(diag, 'team-auth describe: ' + safeMessage(error))
      return { configured: false, serverUrlConfigured: false, teamIdConfigured: false, timeoutMs: DEFAULT_TIMEOUT_MS }
    }
  }

  teamFetch.describe = describe
  teamFetch.readToken = readToken
  return teamFetch
}
