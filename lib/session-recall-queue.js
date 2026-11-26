const DEADLINE_CODE = 'SESSION_QUERY_DEADLINE_EXCEEDED'
const BLOCKED_CODE = 'SESSION_QUERY_CHANNEL_BLOCKED'
const SQLITE_FAULT_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB'])
const HOST_STATUSES = new Map([
  ['SESSION_QUERY_SEARCH_DISABLED', 'disabled'],
  ['SESSION_QUERY_TOOL_UNAUTHORIZED', 'denied'],
  ['SESSION_QUERY_ABORTED', 'cancelled'],
  ['ABORT_ERR', 'cancelled'],
])
const INDEX_ERROR_WRAPPERS = new Set(['SESSION_QUERY_INDEX_FAILED', 'SESSION_QUERY_PERSISTENCE_FAILED'])
const LOCAL_ERROR_CODES = new Set([
  'SESSION_QUERY_INVALID_QUERY', 'SESSION_QUERY_STALE_CURSOR',
  'EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ENOSPC', 'EIO', 'EINVAL', 'EMFILE', 'ENFILE', 'ETIMEDOUT',
])

// The registered host is the authority. Inspect only typed metadata, never error text.
function field(value, key) {
  try { return value?.[key] } catch { return undefined }
}

function sqliteFault(error) {
  // Only follow a bounded cause chain through ordinary errors and known storage wrappers.
  for (let depth = 0; error && depth < 4; depth++) {
    if (field(error, 'name') === 'AbortError') return undefined
    const code = field(error, 'code')
    if (SQLITE_FAULT_CODES.has(code)) return code
    if (code === 'ERR_SQLITE_ERROR') {
      const errcode = field(error, 'errcode')
      if (!Number.isInteger(errcode) || errcode < 1 || errcode > 0x7fffffff) return undefined
      const primary = errcode & 0xff
      if (primary === 11) return 'SQLITE_CORRUPT'
      if (primary === 26) return 'SQLITE_NOTADB'
      return undefined
    }
    if (code != null && !INDEX_ERROR_WRAPPERS.has(code)) return undefined
    error = field(error, 'cause')
  }
  return undefined
}

function classifyFailure(error) {
  const code = field(error, 'code')
  if (HOST_STATUSES.has(code)) return { status: HOST_STATUSES.get(code), code }
  if (field(error, 'name') === 'AbortError') return { status: 'cancelled', code: 'SESSION_QUERY_ABORTED' }
  return {
    status: 'request-failed',
    code: INDEX_ERROR_WRAPPERS.has(code) || LOCAL_ERROR_CODES.has(code) ? code : 'SESSION_QUERY_UNKNOWN',
  }
}

function classifyPage(page) {
  const indexStatus = field(page, 'indexStatus')
  if (indexStatus === 'unavailable') return { status: 'unavailable' }
  if (indexStatus === 'building' || indexStatus === 'stale') {
    const status = indexStatus === 'building' ? 'index-building' : 'index-stale'
    return Array.isArray(field(page, 'items')) ? { status, page } : { status }
  }
  const items = field(page, 'items')
  if ((indexStatus !== undefined && indexStatus !== 'ready') || !Array.isArray(items)) {
    return { status: 'request-failed', code: 'SESSION_QUERY_INVALID_RESPONSE' }
  }
  if (items.length) return { status: 'hit', page }

  // Prefer explicit index counts, with the older host's total/count as fallbacks.
  const stats = field(page, 'stats')
  const count = [field(page, 'indexedSessions'), field(page, 'totalSessions'), field(stats, 'indexedSessions'),
    field(page, 'total'), field(page, 'count'), field(stats, 'total')]
    .find(value => Number.isSafeInteger(value) && value >= 0)
  return { status: count === 0 ? 'index-empty' : 'no-hit', page }
}

function isAuthorized(authorize) {
  if (authorize === undefined) return true
  try {
    const allowed = authorize()
    // The authorization contract is synchronous. Reject asynchronous decisions safely.
    if (allowed instanceof Promise) void allowed.catch(() => {})
    return allowed === true
  } catch { return false }
}

function boundedInteger(name, value, min = 0) {
  if (!Number.isInteger(value) || value < min || value > 0x7fffffff) {
    throw new RangeError(name + ' must be a bounded integer')
  }
  return value
}

/** One FIFO and one host-call slot per registered service/configuration generation. */
export class SessionRecallQueue {
  #service
  #searchSessions
  #committed
  #onFault
  #queueMs
  #executionMs
  #drainMs
  #cooldownMs
  #maxQueued
  #maxSubscribers
  #now
  #setTimer
  #clearTimer
  #pending = []
  #shared = new Map()
  #active = null
  #incident = null
  #disposed = false

  constructor(service, {
    onFault,
    queueMs = 1500,
    executionMs = 6000,
    drainMs = 4000,
    cooldownMs = 60000,
    maxQueued = 8,
    maxSubscribers = 8,
    now = () => performance.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.#service = service
    this.#searchSessions = field(service, 'searchSessions')
    this.#committed = field(service, 'committedSearchVersion') === 1
    this.#onFault = onFault
    this.#queueMs = boundedInteger('queueMs', queueMs)
    this.#executionMs = boundedInteger('executionMs', executionMs)
    this.#drainMs = boundedInteger('drainMs', drainMs)
    this.#cooldownMs = boundedInteger('cooldownMs', cooldownMs)
    this.#maxQueued = boundedInteger('maxQueued', maxQueued)
    this.#maxSubscribers = boundedInteger('maxSubscribers', maxSubscribers, 1)
    this.#now = now
    this.#setTimer = setTimer
    this.#clearTimer = clearTimer
  }

  /** Keep the request stable while queued. A key covers its authorized scope, query and mode. */
  async submit(request, { key, signal, authorize } = {}) {
    const admissionRestriction = this.#restrictSubscriber({ authorize, signal })
    if (admissionRestriction) return admissionRestriction
    if (typeof this.#searchSessions !== 'function') return { status: 'unavailable' }

    const shared = key == null ? undefined : this.#shared.get(key)
    if (shared) {
      if (shared.subscribers.size >= this.#maxSubscribers) return { status: 'queue-full' }
      return this.#subscribe(shared, signal, authorize)
    }
    if (this.#incident) {
      if (this.#active?.probe && !this.#active.done) return this.#faultResult('recovering')
      if (this.#active || this.#now() < this.#incident.retryAt) return this.#faultResult('breaker-open')
    }
    if (this.#active && this.#pending.length >= this.#maxQueued) return { status: 'queue-full' }

    const job = {
      request, key, subscribers: new Set(), done: false,
      blockedBy: this.#active,
      queueDeadline: this.#active ? this.#now() + this.#queueMs : undefined,
    }
    if (key != null) this.#shared.set(key, job)
    this.#pending.push(job)
    const result = this.#subscribe(job, signal, authorize)
    if (!job.done && job.queueDeadline !== undefined) this.#armQueueTimer(job)
    this.#dispatchNext()
    return result
  }

  dispose() {
    if (this.#disposed) return
    this.#disposed = true
    const cancelled = { status: 'cancelled' }
    for (const job of this.#pending.splice(0)) this.#finish(job, cancelled)
    const active = this.#active
    this.#active = null
    this.#incident = null
    if (active) {
      this.#finish(active, cancelled)
      active.controller?.abort()
    }
  }

  #subscribe(job, signal, authorize) {
    return new Promise(resolve => {
      const subscriber = { signal, authorize, resolve }
      subscriber.cancel = () => {
        this.#resolve(job, subscriber, { status: 'cancelled' })
        if (job.done || job.subscribers.size) return
        if (job === this.#active && job.controller) {
          this.#interrupt(job, { status: 'cancelled' })
        } else {
          this.#removeQueued(job)
          this.#finish(job, { status: 'cancelled' })
          if (job === this.#active) this.#release(job)
        }
      }
      job.subscribers.add(subscriber)
      signal?.addEventListener('abort', subscriber.cancel, { once: true })
      if (signal?.aborted) subscriber.cancel()
    })
  }

  #resolve(job, subscriber, result) {
    if (!job.subscribers.delete(subscriber)) return
    subscriber.signal?.removeEventListener('abort', subscriber.cancel)
    subscriber.resolve({ ...result })
  }

  #restrictSubscriber(subscriber) {
    if (this.#disposed || subscriber.signal?.aborted) return { status: 'cancelled' }
    const allowed = isAuthorized(subscriber.authorize)
    if (this.#disposed || subscriber.signal?.aborted) return { status: 'cancelled' }
    if (!allowed) return { status: 'denied' }
    return undefined
  }

  #pruneUnauthorized(job) {
    for (const subscriber of job.subscribers) {
      const restriction = this.#restrictSubscriber(subscriber)
      if (restriction) this.#resolve(job, subscriber, restriction)
    }
  }

  #finish(job, result) {
    if (job.done) return
    job.done = true
    if (this.#shared.get(job.key) === job) this.#shared.delete(job.key)
    this.#clearJobTimer(job, 'queueTimer')
    this.#clearJobTimer(job, 'executionTimer')
    job.request = undefined
    job.blockedBy = null
    // Revalidate immediately before exposing a page or an outcome that could allow fallback.
    for (const subscriber of job.subscribers) {
      const restriction = result.status === 'cancelled' ? undefined : this.#restrictSubscriber(subscriber)
      this.#resolve(job, subscriber, restriction ?? result)
    }
  }

  #clearJobTimer(job, key) {
    if (job[key] !== undefined) this.#clearTimer(job[key])
    job[key] = undefined
  }

  #removeQueued(job) {
    const index = this.#pending.indexOf(job)
    if (index !== -1) this.#pending.splice(index, 1)
  }

  #armQueueTimer(job) {
    job.queueTimer = this.#setTimer(() => this.#expireQueued(job), Math.ceil(Math.max(0, job.queueDeadline - this.#now())))
  }

  #expireQueued(job) {
    if (job.done || job === this.#active) return
    if (this.#now() < job.queueDeadline) {
      this.#armQueueTimer(job)
      return
    }

    const active = this.#active
    if (active && active === job.blockedBy && active.controller) {
      // A revoked or cancelled waiter cannot be evidence of channel blocking.
      this.#pruneUnauthorized(job)
      if (job.subscribers.size && !this.#incident && this.#active === active) {
        const healthCode = this.#confirmedHealthCode()
        if (healthCode && this.#active === active) {
          this.#openBreaker(active, healthCode, 'health', true)
          return
        }
        const sameKey = job.key != null && (job.key === active.key || Object.is(job.key, active.key))
        if (!this.#committed && !sameKey && active.stoppedAt !== undefined
          && job.queueDeadline >= active.stoppedAt + this.#drainMs) {
          this.#openBreaker(active, BLOCKED_CODE, 'drain', true)
          return
        }
      }
    }
    this.#removeQueued(job)
    this.#finish(job, { status: 'queue-timeout' })
  }

  #dispatchNext() {
    if (this.#disposed || this.#active || this.#pending.length === 0) return
    const job = this.#pending.shift()
    this.#active = job
    job.probe = this.#incident !== null
    job.blockedBy = null
    this.#clearJobTimer(job, 'queueTimer')
    // Reserve the slot now. The caller can still cancel before the host sees the request.
    queueMicrotask(() => this.#start(job))
  }

  #start(job) {
    if (job !== this.#active || job.done) return
    if (job.queueDeadline !== undefined && this.#now() >= job.queueDeadline) {
      this.#finish(job, { status: 'queue-timeout' })
      this.#release(job)
      return
    }
    this.#pruneUnauthorized(job)
    if (job !== this.#active || job.done) return
    if (!job.subscribers.size) {
      this.#finish(job, { status: 'denied' })
      this.#release(job)
      return
    }

    const request = job.request
    job.request = undefined
    job.controller = new AbortController()
    job.startedAt = this.#now()
    job.executionDeadline = job.startedAt + this.#executionMs
    this.#armExecutionTimer(job)
    const options = { signal: job.controller.signal }
    if (this.#committed) options.consistency = 'committed'
    try {
      const pending = this.#searchSessions.call(this.#service, request, options)
      Promise.resolve(pending).then(
        page => this.#settled(job, true, page),
        error => this.#settled(job, false, error),
      )
    } catch (error) {
      this.#settled(job, false, error)
    }
  }

  #armExecutionTimer(job) {
    job.executionTimer = this.#setTimer(() => {
      if (this.#active !== job || job.done) return
      if (this.#now() < job.executionDeadline) {
        this.#armExecutionTimer(job)
        return
      }
      const healthCode = this.#confirmedHealthCode()
      if (healthCode) this.#openBreaker(job, healthCode, 'health', true)
      else this.#interrupt(job, { status: 'timeout', code: DEADLINE_CODE })
    }, Math.ceil(Math.max(0, job.executionDeadline - this.#now())))
  }

  #interrupt(job, result) {
    // The caller budget can expire before the host promise settles. Release only in #settled.
    job.stoppedAt = this.#now()
    this.#deferProbe(job)
    this.#finish(job, result)
    job.controller.abort()
  }

  #settled(job, succeeded, value) {
    if (job !== this.#active) return
    if (!job.done) {
      if (this.#now() >= job.executionDeadline) {
        this.#interrupt(job, { status: 'timeout', code: DEADLINE_CODE })
      } else if (succeeded) {
        const result = classifyPage(value)
        const healthCode = result.status === 'unavailable' ? this.#confirmedHealthCode() : undefined
        if (healthCode) this.#openBreaker(job, healthCode, 'health')
        else {
          if (result.page) this.#incident = null
          else this.#deferProbe(job)
          this.#finish(job, result)
        }
      } else {
        const code = sqliteFault(value)
        if (code) this.#openBreaker(job, code, 'execution')
        else {
          this.#deferProbe(job)
          this.#finish(job, classifyFailure(value))
        }
      }
    }
    this.#release(job)
  }

  #release(job) {
    if (job !== this.#active) return
    this.#active = null
    this.#dispatchNext()
  }

  #deferProbe(job) {
    if (job.probe && this.#incident) this.#incident.retryAt = this.#now() + this.#cooldownMs
  }

  #confirmedHealthCode() {
    // The sync health hook reports terminal failures independently of the search queue.
    // Refresh phases and progress do not establish a terminal failure.
    try {
      const health = this.#service?.getSearchHealth?.()
      if (health instanceof Promise) {
        void health.catch(() => {})
        return undefined
      }
      const code = field(field(health, 'terminalFailure'), 'code')
      if (SQLITE_FAULT_CODES.has(code)) return code
    } catch { /* Optional observation is best effort. */ }
    return undefined
  }

  #faultResult(status) {
    return { status, code: this.#incident.fault.code, fault: this.#incident.fault }
  }

  #openBreaker(job, code, stage, abort = false) {
    if (job !== this.#active || this.#disposed) return
    const now = this.#now()
    const opened = this.#incident === null
    this.#incident ??= { fault: Object.freeze({ code, stage, elapsedMs: Math.floor(now - job.startedAt) }) }
    this.#incident.retryAt = now + this.#cooldownMs
    const result = this.#faultResult('breaker-open')
    this.#finish(job, result)
    for (const pending of this.#pending.splice(0)) this.#finish(pending, result)
    if (abort) job.controller.abort()
    if (opened && !this.#disposed) {
      try { void Promise.resolve(this.#onFault?.(result.fault)).catch(() => {}) } catch { /* Best effort. */ }
    }
  }
}
