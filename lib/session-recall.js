import { createRequire } from 'node:module'
import { SessionRecallQueue } from './session-recall-queue.js'

const { repository, version } = createRequire(import.meta.url)('../package.json')
const issueRepository = /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\.git$/.exec(repository?.url ?? '')?.[1]
const issueUrl = issueRepository ? 'https://github.com/' + issueRepository + '/issues/new/choose' : null
const MESSAGE_TYPES = ['user/message', 'assistant/message']
const SESSION_LIMIT = 10
const FALLBACK_LIMIT = 8
const FALLBACK_SEQ_LIMIT = 160
const CODE_PATTERN = /^(?:SESSION_QUERY_|SQLITE_)[A-Z0-9_]{1,56}$/
const LOCAL_CODES = new Set(['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ENOSPC', 'EIO', 'EINVAL', 'EMFILE', 'ENFILE', 'ETIMEDOUT'])
const INCIDENT_STAGES = new Set(['index', 'execution', 'drain', 'health'])

function visibleMessageFilters() {
  return [{ kind: 'type', values: [...MESSAGE_TYPES] }, { kind: 'surface', values: ['current'] }]
}

function authorizedHeader(header, caller) {
  return typeof header?.id === 'string' && header.id !== caller.id && header.cwd === caller.cwd
}

function visibleMessage(event, id) {
  return event?.sessionId === id && event.surface === 'current' && MESSAGE_TYPES.includes(event.type)
}

function cleanSnippet(value) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 300) : ''
}

function formatHits(items, caller, limit) {
  if (!Array.isArray(items)) return []
  return items.flatMap(item => {
    const { header, bestMatch } = item ?? {}
    if (!authorizedHeader(header, caller) || !visibleMessage(bestMatch, header.id)) return []
    const snippet = cleanSnippet(bestMatch.snippet)
    if (!snippet) return []
    const date = new Date(header.createdAt)
    const when = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '?'
    return ['· [' + when + '] ' + cleanSnippet(header.cwd) + '\n  ' + snippet]
  }).slice(0, limit)
}

function protectedCode(code) {
  // The queue only returns known codes. This check also constrains custom test and host adapters.
  return typeof code === 'string' && (CODE_PATTERN.test(code) || LOCAL_CODES.has(code)) ? code : ''
}

function durationBand(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  if (ms < 1000) return '<1s'
  if (ms < 10000) return '1–10s'
  return '>=10s'
}

function formatIncident(fault, code) {
  const kind = fault?.stage === 'drain' || /STALLED|BLOCKED|CANCEL_NOT_SETTLED/.test(code) ? '持续阻塞' : '引擎故障'
  const message = '已确认历史会话检索' + kind + '，该通道已熔断。本次未覆盖历史会话。请排查相关记忆引擎的问题。'
  if (!issueUrl) return message
  const stage = INCIDENT_STAGES.has(fault?.stage) ? fault.stage : 'history'
  const fields = ['插件版本 ' + version, '平台 ' + process.platform, '阶段 ' + stage,
    '错误码 ' + (code || 'unknown'), '耗时 ' + durationBand(fault?.elapsedMs)]
  return message + ' 非维护者可在 Auto Memory 仓库提交以下脱敏信息（Issue 未提交）：' + fields.join('，') + '。' + issueUrl
}

export function describeSessionRecall(result) {
  const status = result?.status
  const code = protectedCode(result?.code ?? result?.fault?.code)
  if (result?.page?.authorizedLexical === true) {
    const detail = result.page.partial ? '，部分会话未能读取或超出扫描范围' : ''
    const state = result.page.indexDisabled ? '未启用' : '未提供'
    return '宿主会话全文索引' + state + '。已通过宿主可见消息接口扫描当前工作区最近 ' + FALLBACK_LIMIT + ' 个会话的前 ' + FALLBACK_SEQ_LIMIT + ' 条记录' + detail + '。'
  }
  switch (status) {
    case 'hit': return ''
    case 'no-hit': return '宿主会话检索已完成，未命中。'
    case 'index-empty': return '宿主会话索引当前为空。'
    case 'index-building': return '宿主会话索引正在建立，历史会话覆盖尚不完整。'
    case 'index-stale': return '宿主会话索引正在更新，以下历史结果来自最近已提交版本。'
    case 'disabled': return '宿主会话全文检索未启用，本次没有可验证的历史结果。'
    case 'denied': return '本次无法确认历史会话查询的工作区授权，未返回历史会话。'
    case 'cancelled': return '本次历史会话查询已取消。'
    case 'queue-full': return '历史会话检索队列已满，本次未提交宿主查询。'
    case 'queue-timeout': return '本次历史会话查询在队列中等待超时，未提交宿主查询。'
    case 'timeout': return '本次等待宿主会话检索超时，已请求取消。'
    case 'recovering': return '历史会话检索正在验证恢复，本次没有可用的历史会话结果。'
    case 'breaker-open': return formatIncident(result.fault, code)
    case 'unavailable': return '宿主会话检索能力当前不可用，本次未检索历史会话。'
    default: return '本次宿主会话检索失败' + (code ? '（' + code + '）' : '') + '，未返回历史会话。'
  }
}

export function historyRecallLines(result, caller, limit) {
  const lines = caller ? formatHits(result?.page?.items, caller, limit) : []
  let diagnostic = describeSessionRecall(result)
  if (!lines.length && (result?.status === 'hit' || result?.status === 'index-stale')) {
    diagnostic = '宿主会话查询尚无符合当前可见性和工作区范围的结果。' + (result.status === 'index-stale' ? '索引正在更新。' : '')
  }
  return Object.assign(lines, { diagnostic })
}

async function lexicalFromHost(service, request, caller, signal, indexDisabled) {
  const coverage = { authorizedLexical: true, indexDisabled }
  // Keep the literal OR semantics while using only the host's visible message projection.
  const terms = request.query.toLowerCase().split(/[\s,，、;；。:：]+/).filter(term => term.length >= 2).slice(0, 8)
  if (!terms.length) return { items: [], ...coverage, partial: true }
  const records = await service.filterSessions(request.sessionFilters, signal)
  signal?.throwIfAborted()
  if (!Array.isArray(records)) throw new TypeError('Invalid session listing')
  const candidates = records.filter(record => authorizedHeader(record?.header, caller))
  const matches = []
  let attempted = 0
  let missed = false
  for (const { header } of candidates.slice(0, FALLBACK_LIMIT)) {
    signal?.throwIfAborted()
    attempted++
    try {
      const docs = await service.filterEvents(header.id, [...visibleMessageFilters(), { kind: 'seq', to: FALLBACK_SEQ_LIMIT - 1 }])
      signal?.throwIfAborted()
      if (!Array.isArray(docs)) throw new TypeError('Invalid session event projection')
      const event = docs.find(doc => Number.isSafeInteger(doc?.seq) && doc.seq >= 0 && doc.seq < FALLBACK_SEQ_LIMIT
        && visibleMessage(doc, header.id) && typeof doc.text === 'string'
        && terms.some(term => doc.text.toLowerCase().includes(term)))
      if (event) matches.push({ header, bestMatch: { sessionId: event.sessionId, type: event.type, surface: event.surface, snippet: cleanSnippet(event.text) } })
      if (matches.length >= request.limit) break
    } catch (error) {
      signal?.throwIfAborted()
      if (error?.code === 'SESSION_QUERY_TOOL_UNAUTHORIZED' || error?.code === 'EACCES' || error?.code === 'EPERM') throw error
      missed = true
    }
  }
  if (!matches.length) return { items: [], ...coverage, partial: missed || attempted < candidates.length }
  const current = await service.filterSessions([...request.sessionFilters, { kind: 'id', values: matches.map(item => item.header.id) }], signal)
  signal?.throwIfAborted()
  if (!Array.isArray(current)) throw new TypeError('Invalid session authorization result')
  const allowed = new Set(current.filter(record => authorizedHeader(record?.header, caller)).map(record => record.header.id))
  const items = matches.filter(item => allowed.has(item.header.id))
  return { items, ...coverage, partial: missed || attempted < candidates.length || items.length !== matches.length }
}

async function verifyStoredScope(service, request, callerId, signal) {
  const filters = [...request.sessionFilters, { kind: 'id', values: [callerId] }]
  const records = typeof service.filterSessions === 'function' ? await service.filterSessions(filters, signal) : []
  signal?.throwIfAborted()
  if (Array.isArray(records) && records.some(record => record?.header?.id === callerId
    && record.header.cwd === request.sessionFilters[0].values[0])) return
  throw Object.assign(new Error('Stored caller work directory could not be verified'), { code: 'SESSION_QUERY_TOOL_UNAUTHORIZED' })
}

function bindService(service) {
  const lexicalAvailable = typeof service.filterSessions === 'function' && typeof service.filterEvents === 'function'
  async function search(request, options, callerId) {
    const hasIndex = typeof service.searchSessions === 'function'
    if (hasIndex) {
      try { return await service.searchSessions(request, options) } catch (error) {
        if (error?.code !== 'SESSION_QUERY_SEARCH_DISABLED' || !lexicalAvailable) throw error
      }
    }
    if (!lexicalAvailable) return { items: [], indexStatus: 'unavailable' }
    options?.signal?.throwIfAborted()
    const caller = { id: callerId, cwd: request.sessionFilters[0].values[0] }
    return lexicalFromHost(service, request, caller, options?.signal, hasIndex)
  }
  return {
    get committedSearchVersion() { return service.committedSearchVersion },
    ...(typeof service.getSearchHealth === 'function' ? { getSearchHealth: () => service.getSearchHealth() } : {}),
    async searchSessions(request, options) {
      const { callerId, verifyStoredCaller, ...hostRequest } = request
      if (verifyStoredCaller) await verifyStoredScope(service, hostRequest, callerId, options?.signal)
      const page = await search(hostRequest, options, callerId)
      if (verifyStoredCaller) await verifyStoredScope(service, hostRequest, callerId, options?.signal)
      return page
    },
  }
}

export class SessionRecallReader {
  constructor({ getService, getLiveSession = null, onFault, queueOptions }) {
    Object.assign(this, { getService, getLiveSession, onFault, queueOptions })
  }

  async search(query, limit, { agent, signal, allowStoredCaller = false } = {}) {
    if (signal?.aborted || this.closed) return historyRecallLines({ status: 'cancelled' })
    const service = this.getService()
    if (this.service !== service) {
      this.queue?.dispose()
      this.queue = undefined
      this.service = service
    }
    if (!service) return historyRecallLines({ status: 'unavailable' })
    const session = agent?.session
    const caller = { id: session?.id, cwd: session?.header?.cwd }
    const authorize = () => {
      if (this.closed || this.getService() !== service) return false
      if (agent?.session?.id !== caller.id || agent?.session?.header?.cwd !== caller.cwd) return false
      if (!this.getLiveSession) return true
      const live = this.getLiveSession(caller.id)
      if (live == null) return allowStoredCaller
      return live.id === caller.id && live.header?.cwd === caller.cwd
    }
    if (typeof caller.id !== 'string' || !caller.id || typeof caller.cwd !== 'string' || !caller.cwd || !authorize()) {
      return historyRecallLines({ status: 'denied' })
    }
    const requested = Number.isFinite(limit) ? Math.min(SESSION_LIMIT, Math.max(1, Math.floor(limit))) : 8
    const text = String(query || '').trim()
    const request = {
      query: text,
      limit: Math.min(requested + 1, SESSION_LIMIT),
      sessionFilters: [{ kind: 'cwd', values: [caller.cwd] }],
      eventFilters: visibleMessageFilters(),
      callerId: caller.id,
      verifyStoredCaller: allowStoredCaller,
    }
    this.queue ??= new SessionRecallQueue(bindService(service), { onFault: this.onFault, ...this.queueOptions })
    const key = JSON.stringify([caller.id, caller.cwd, allowStoredCaller, service.committedSearchVersion ?? 0, text, requested])
    const result = await this.queue.submit(request, { key, signal, authorize })
    return historyRecallLines(result, caller, requested)
  }

  dispose() {
    this.closed = true
    this.queue?.dispose()
  }
}

export function bindRecallResponseCancellation(req, res) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  const onClose = () => { if (!res.writableFinished) controller.abort() }
  req.on?.('aborted', onAbort)
  res.on?.('close', onClose)
  if (req.aborted || res.destroyed && !res.writableFinished) controller.abort()
  return {
    signal: controller.signal,
    release() {
      req.removeListener?.('aborted', onAbort)
      res.removeListener?.('close', onClose)
    },
  }
}
