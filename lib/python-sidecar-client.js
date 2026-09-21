/**
 * M7-0 JS SidecarClient(docs/PYTHON-SIDECAR-CONTRACT.md §7,§13;handoff M7-1 第一项)。
 * no-shell spawn 标准库 Python fake worker;JSONL 单行帧;lazy start(仅在显式启用路径上被调用)。
 *
 * 纪律:
 *   - request() 永不 reject:结构化失败 {ok:false, code, reason}(Python 不可用不影响基础对话)。
 *   - workerEpoch:每次进程启动新 opaque epoch;入站帧 epoch 不匹配即丢弃(fail closed)。
 *   - 帧纪律:partial/multiple JSONL 行重组、单行 256KiB 上限(超限 fatal)、坏 JSON/坏 envelope/
 *     错误 epoch/未知 requestId/重复或过期 response 全部计账丢弃,绝不注入上层。
 *   - 四种身份不混用:requestId(transport)/observationId(M5)/activationId(M6)/syncId(index)。
 *   - timeout/AbortSignal(cancel 通知)/latest-wins(由上层 M5 bridge 驱动)/crash recovery/circuit breaker。
 * 无 shell;无 HTTP;stdout 只进协议解析器;stderr 仅有界诊断。UTF-8 无 BOM。
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateTransportFramePre, makeRequestFramePre, RESPONSE_TYPE_FOR_V1,
  M7_TRANSPORT_BUDGET_V1, PY_FRAME_TYPES_V1,
} from './m7-wire.js'

const B = M7_TRANSPORT_BUDGET_V1

/** 捆绑 fake worker 的默认绝对路径(python/worker_v1.py)。 */
export function defaultWorkerScriptPathPre() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'worker_v1.py')
  } catch (_) { return '' }
}

const FAILURE_CODES = new Set(['timeout', 'crashed', 'unavailable', 'protocol', 'line-oversize'])

/**
 * 超时看门狗阈值（issue #107）：连续多少次「请求超时」判定 worker 已 wedged ⇒ 杀掉重生。
 * 故意**不进** `M7_TRANSPORT_BUDGET_V1`：那份预算标注「冻结；变更必须升级协议版本」，
 * 而本阈值是 JS 侧的可用性策略（谁该被回收），不属跨语言传输契约。
 */
const WATCHDOG_TIMEOUTS_DEFAULT = 3

/**
 * 创建 SidecarClient。opts 可为值或 () => 值(启动时惰性求值):
 *   command('python') / scriptPath(捆绑 worker) / dshHome(''=worker 仅内存派生态) /
 *   requestTimeoutMs / maxLineBytes / breakerFailureThreshold / breakerCooldownMs / maxPendingRequests。
 */
export function createPythonSidecarClientPre(opts = {}) {
  const opt = (k, dflt) => {
    const v = opts[k]
    return typeof v === 'function' ? v() : (v === undefined ? dflt : v)
  }
  let disposed = false
  let child = null
  let epoch = null
  let buffer = Buffer.alloc(0)
  let stderrTail = ''
  let reqCounter = 0
  const pending = new Map()
  const activationHandlers = new Set()
  const seenActivationIds = []
  const seenActivationIdSet = new Set()
  let writeChain = Promise.resolve()
  let lastSentFrame = null
  const diagOf = typeof opts.diag === 'function' ? opts.diag : () => {}
  // `probing` = 熔断冷却已过、下一次成功即闭合（半开探测；契约见 PYTHON-SIDECAR-CONTRACT 与 m70 G6）
  const breaker = { consecutiveFailures: 0, openUntil: 0, probing: false }
  let successStreak = 0
  let consecutiveTimeouts = 0
  const stats = {
    starts: 0, exits: 0, framesIn: 0, requests: 0, succeeded: 0, activationsReceived: 0,
    cancelNotifications: 0, restarts: 0, watchdogKills: 0,
    dropped: { badJson: 0, badEnvelope: 0, staleEpoch: 0, unknownRequest: 0, typeMismatch: 0, duplicateActivation: 0 },
    failed: { timeout: 0, crashed: 0, aborted: 0, circuitOpen: 0, unavailable: 0, backpressure: 0, protocol: 0, workerError: 0, disposed: 0 },
    lastExit: null, lastFatal: null,
  }

  function resolveOpt(k) { return opt(k, null) }

  function noteFailure(code) {
    if (FAILURE_CODES.has(code)) {
      breaker.consecutiveFailures++
      if (breaker.consecutiveFailures >= Number(opt('breakerFailureThreshold', B.breakerFailureThreshold))) {
        breaker.openUntil = Date.now() + Number(opt('breakerCooldownMs', B.breakerCooldownMs))
      }
    }
  }

  function breakerOpen() {
    if (Date.now() < breaker.openUntil) return true
    // 冷却已过 ⇒ 进入半开：放行一次真实探测，探测成功即整体归零。
    if (breaker.openUntil !== 0) { breaker.openUntil = 0; breaker.probing = true }
    return false
  }

  /** worker stderr 尾部（去尾空白 + 限长）。issue #108：内容必须可见，不能只报字节数。 */
  function stderrTailForDiag() {
    try { return String(stderrTail).replace(/\s+$/, '').slice(-1200) } catch (_) { return '' }
  }

  /**
   * 看门狗（issue #107）。旧实现里 `health()` / `restart()` 是「有实现、零调用方」：worker 一旦
   * wedged（stdin 还在、永不回帧），超时分支只发一帧 `cancel`（它连 cancel 都不听），于是熔断
   * 冷却 30s 后又把同一具尸体拿出来重试 ⇒ 每帧白等 5s，直到进程结束。
   */
  function maybeWatchdog() {
    const th = Number(opt('watchdogTimeouts', WATCHDOG_TIMEOUTS_DEFAULT))
    const limit = Number.isFinite(th) && th > 0 ? th : WATCHDOG_TIMEOUTS_DEFAULT
    if (consecutiveTimeouts < limit || !child) return
    const tail = stderrTailForDiag()
    const reason = 'watchdog:' + consecutiveTimeouts + '-timeouts'
    consecutiveTimeouts = 0
    stats.watchdogKills++
    diagOf('[sidecar] ★ 看门狗触发：连续 ' + limit + ' 次请求超时 ⇒ 判定 worker wedged，杀掉并重生（' + reason
      + '; stderr 尾部 ' + tail.length + ' 字节）' + (tail ? '\n' + tail : ''))
    restart(reason)
  }

  /** lazy start:no-shell spawn;仅由显式启用的调用路径触达。 */
  function ensureStarted() {
    if (disposed) return { ok: false, code: 'disposed' }
    if (child && (child.killed || (child.stdin && child.stdin.destroyed))) {
      // 上一个进程正在收尾(exit 事件未到):按已死处理,允许立即重生
      // ★ issue #72 修复（2026-09-19）：此处必须**同时清空共享 buffer**。
      //   旧实现只置 `epoch = null`（等 `:121` 的 exit 事件去清 buffer），但这条分支的前提正是
      //   **exit 尚未到达** ⇒ 旧 worker 残留在 `buffer` 里的**无换行尾字节**会被新 worker 的首帧
      //   `concat` 进去 ⇒ 该行 badJson ⇒ 应答被吞、请求白等到超时（默认 5000ms）。
      try { child.kill() } catch (_) {}
      child = null
      epoch = null
      buffer = Buffer.alloc(0)   // ★ 丢弃旧代残尾,避免污染新 worker 首帧
    }
    if (child) return { ok: true }
    const scriptPath = String(resolveOpt('scriptPath') || defaultWorkerScriptPathPre())
    const command = String(resolveOpt('command') || 'python')
    const dshHome = String(resolveOpt('dshHome') || '')
    epoch = 'wk_' + randomBytes(16).toString('hex')
    const args = [scriptPath, '--expect-epoch', epoch]
    if (dshHome) args.push('--dsh-home', dshHome)
    let proc
    try {
      proc = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (_) {
      epoch = null
      noteFailure('unavailable')
      return { ok: false, code: 'unavailable' }
    }
    child = proc
    stats.starts++
    proc.stdout.on('data', (chunk) => { try { feed(chunk) } catch (_) { fatal('protocol') } })
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096)
    })
    proc.on('error', () => {
      // spawn 失败(ENOENT 等):结构化失败,不计崩溃重启
      const wasChild = child
      child = null
      epoch = null
      void wasChild
      rejectAll('unavailable')
      noteFailure('unavailable')
    })
    proc.on('exit', (code, signalName) => {
      if (child !== proc) return
      child = null
      epoch = null
      buffer = Buffer.alloc(0)
      stats.exits++
      const tail = stderrTailForDiag()
      stats.lastExit = { code, signal: signalName, stderrTailBytes: stderrTail.length }
      // issue #108：Python 的 traceback 只走 stderr，而旧实现收下 4KB 尾巴后**全仓无一处读内容**，
      // 对外只有 stderrTailBytes ⇒ 「起即退」类故障唯一定位信息被静默丢弃。
      stats.lastStderrTail = tail
      diagOf('[sidecar] worker 退出 code=' + String(code) + ' signal=' + String(signalName)
        + (tail ? '; stderr 尾部:\n' + tail : '; stderr 无输出'))
      rejectAll('crashed')
    })
    return { ok: true }
  }

  function rejectAll(code) {
    for (const [, entry] of pending) settle(entry, { ok: false, code })
    noteFailure(code)
  }

  function fatal(kind) {
    stats.lastFatal = kind
    buffer = Buffer.alloc(0) // 丢弃残留半帧,防止污染重生进程的解析流
    if (child) { try { child.stdin.destroy() } catch (_) {} try { child.kill() } catch (_) {} }
    rejectAll('protocol')
  }

  function feed(chunk) {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk
    const cap = Number(opt('maxLineBytes', B.maxLineBytes))
    for (;;) {
      const idx = buffer.indexOf(10)
      if (idx === -1) {
        if (buffer.length > cap) fatal('line-oversize')
        return
      }
      const line = buffer.subarray(0, idx)
      buffer = buffer.subarray(idx + 1)
      if (line.length > cap) { fatal('line-oversize'); return }
      handleLine(line)
    }
  }

  function handleLine(line) {
    stats.framesIn++
    let obj
    try { obj = JSON.parse(line.toString('utf8')) } catch (_) { stats.dropped.badJson++; return }
    const v = validateTransportFramePre(obj, { direction: 'in' })
    if (!v.ok) { stats.dropped.badEnvelope++; return }
    const frame = v.frame
    // ★ issue #72 修复（2026-09-19）：把入站 epoch 门从 **fail-open 改为 fail-closed**，与文件头 :7 的承诺一致。
    //   旧写法 `if (epoch !== null && frame.workerEpoch !== epoch)`：**`epoch === null` 时整条门失效**，
    //   任何合法 envelope 的帧都会穿透到 handler。epoch 为 null 的窗口是真实存在的
    //   （未启动 / `exit` 事件已置 null 但旧 stdio 尚未排空 / restart 后到新 spawn 之间），
    //   而 `activation_request` 上游 `context-host` **无二次校验**（同 activationId 有 dedup 兜底，
    //   但**新 activationId 可穿透**）⇒ 幽灵激活。
    //   新判据：**epoch 为空 ⇒ 一律丢弃**。理由：spawn 时同步赋 epoch（:91 `epoch = 'wk_' + …` 在
    //   `spawn()` **之前**执行），出站帧也就带上了 epoch；对端 worker 以 `--expect-epoch` 自证身份后才回帧
    //   ⇒ **正常路径不存在"帧先于 epoch"**，丢弃不会误伤任何合法流量。
    if (!epoch || frame.workerEpoch !== epoch) { stats.dropped.staleEpoch++; return }
    if (frame.type === 'activation_request') {
      const activation = frame.payload && frame.payload.activation
      const aid = activation && activation.activationId
      if (!aid) { stats.dropped.badEnvelope++; return }
      if (seenActivationIdSet.has(aid)) { stats.dropped.duplicateActivation++; return }
      seenActivationIdSet.add(aid)
      seenActivationIds.push(aid)
      while (seenActivationIds.length > B.activationIdsCapacity) seenActivationIdSet.delete(seenActivationIds.shift())
      stats.activationsReceived++
      for (const h of activationHandlers) {
        try { h({ frame, activation, requestId: frame.requestId, workerEpoch: frame.workerEpoch }) } catch (_) {}
      }
      return
    }
    const entry = pending.get(frame.requestId)
    if (frame.type === 'error') {
      // error 帧是对该 requestId 的终局答复,先于类型匹配检查(error ≠ expectedType 恒成立)
      if (!entry) { stats.dropped.unknownRequest++; return }
      settle(entry, { ok: false, code: 'worker-error', reason: String((frame.payload && frame.payload.reason) || 'error'), detail: frame.payload || {} })
      return
    }
    if (!entry) { stats.dropped.unknownRequest++; return }
    if (frame.type !== entry.expectedType) { stats.dropped.typeMismatch++; return }
    settle(entry, { ok: true, frame })
  }

  function settle(entry, result) {
    if (entry.settled) return
    entry.settled = true
    if (entry.timer) clearTimeout(entry.timer)
    if (entry.onAbort) { try { entry.signal.removeEventListener('abort', entry.onAbort) } catch (_) {} }
    pending.delete(entry.requestId)
    if (result.ok) {
      stats.succeeded++
      consecutiveTimeouts = 0
      successStreak += 1
      // issue #107：闭合态不再「任一成功即清零」。index_sync 是**分段序列**（每段 begin 帧必先成功
      // 一帧），旧口径使 consecutiveFailures 峰值恒为 1 ⇒ 阈值 3 永不触发、熔断形同不存在。
      // 半开探测仍是一次成功即闭合（保持既有契约与 m70 G6）。
      if (breaker.probing || successStreak >= 2) { breaker.consecutiveFailures = 0; breaker.probing = false; successStreak = 0 }
    } else {
      successStreak = 0
      if (result.code === 'timeout') consecutiveTimeouts += 1
      const bucket = stats.failed[result.code]
      if (bucket === undefined) stats.failed.protocol++
      else stats.failed[result.code]++
      noteFailure(result.code)
      if (result.code === 'timeout') maybeWatchdog()
    }
    entry.resolve(result)
  }

  function writeFrame(frame) {
    lastSentFrame = frame
    if (!child || !child.stdin || child.stdin.destroyed) return false
    const line = Buffer.from(JSON.stringify(frame) + '\n', 'utf8')
    // ★ issue #75 CC-9 修复（2026-09-19）：**建帧时捕获当时的 child 引用**，flush 时校验身份。
    //   旧实现：`writeChain.then(...)` 回调里解引用**当时的**模块级 `child` 变量。
    //   若 writeChain 排队期间发生 respawn（`ensureStarted` 的收尾中重生 / `restart()`），
    //   回调会读到**新** child，把**旧 epoch 的帧**写进新 worker 的 stdin ⇒ 对端回帧 epoch-mismatch
    //   ⇒ 被判 `staleEpoch` 丢弃 ⇒ 该请求挂满自身超时（默认 5000ms）。
    //   现改为闭包捕获 `sentTo`，且 flush 时 `child !== sentTo` 即视为该帧已随旧进程作废。
    const sentTo = child
    const sentStdin = child.stdin
    writeChain = writeChain.then(() => new Promise((done) => {
      if (child !== sentTo) { done(); return }   // 已换代：本帧作废，不得写入新 worker
      if (!sentStdin || sentStdin.destroyed) { done(); return }
      sentStdin.write(line, () => done())
    }))
    writeChain = writeChain.catch(() => {})
    return true
  }

  /**
   * 结构化请求:resolve({ok:true, frame}) 或 resolve({ok:false, code, reason?});永不 reject。
   * opts: {timeoutMs, signal}。signal 中止 → 结构化 aborted + 向 worker 发 cancel 通知。
   */
  function request(type, payload, rOpts = {}) {
    if (disposed) return Promise.resolve({ ok: false, code: 'disposed' })
    if (!RESPONSE_TYPE_FOR_V1[type]) return Promise.resolve({ ok: false, code: 'unsupported-frame' })
    if (breakerOpen()) {
      stats.failed.circuitOpen++
      return Promise.resolve({ ok: false, code: 'circuit-open', retryInMs: breaker.openUntil - Date.now() })
    }
    const started = ensureStarted()
    if (!started.ok) {
      stats.failed[started.code] = (stats.failed[started.code] || 0) + 1
      return Promise.resolve({ ok: false, code: started.code })
    }
    const maxPending = Number(opt('maxPendingRequests', B.maxPendingRequests))
    if (pending.size >= maxPending) { stats.failed.backpressure++; return Promise.resolve({ ok: false, code: 'backpressure' }) }
    const requestId = 'req_' + randomBytes(9).toString('hex') + (++reqCounter).toString(36)
    const sentAt = Date.now()
    const mf = makeRequestFramePre({ type, payload, requestId, workerEpoch: epoch, sentAt })
    if (!mf.ok) { stats.failed.protocol++; return Promise.resolve({ ok: false, code: 'protocol', reason: mf.reason }) }
    return new Promise((resolve) => {
      const entry = { requestId, expectedType: RESPONSE_TYPE_FOR_V1[type], resolve, settled: false, timer: null, signal: rOpts.signal || null, onAbort: null }
      pending.set(requestId, entry)
      stats.requests++
      const written = writeFrame(mf.frame)
      if (!written) { settle(entry, { ok: false, code: 'unavailable' }); return }
      const timeoutMs = Math.max(1, Number(rOpts.timeoutMs) || Number(opt('requestTimeoutMs', B.requestTimeoutMs)))
      entry.timer = setTimeout(() => {
        settle(entry, { ok: false, code: 'timeout', timeoutMs })
        notify('cancel', { requestId })
      }, timeoutMs)
      if (entry.signal) {
        if (entry.signal.aborted) {
          settle(entry, { ok: false, code: 'aborted' })
          notify('cancel', { requestId })
          return
        }
        entry.onAbort = () => {
          settle(entry, { ok: false, code: 'aborted' })
          notify('cancel', { requestId })
        }
        entry.signal.addEventListener('abort', entry.onAbort, { once: true })
      }
    })
  }

  /** fire-and-forget 帧(cancel/close_session;契约上无响应帧)。 */
  function notify(type, payload) {
    if (disposed || !PY_FRAME_TYPES_V1) return
    if (!child) return
    const requestId = 'ntf_' + randomBytes(6).toString('hex')
    const sentAt = Date.now()
    const mf = makeRequestFramePre({ type, payload, requestId, workerEpoch: epoch, sentAt })
    if (mf.ok) { if (writeFrame(mf.frame)) stats.cancelNotifications++ }
  }

  /** health 探针(breaker half-open 用;有界响应)。 */
  function health(rOpts = {}) { return request('health', {}, rOpts) }

  /** 刻意重启:旧 epoch 作废,旧 in-flight 全部 rejected;下次请求以新 epoch 重生。 */
  function restart(reason) {
    if (child) { try { child.kill() } catch (_) {} }
    child = null
    epoch = null
    // ★ issue #72 修复：restart 同样要清 buffer（kill 后 exit 事件可能滞后，
    //   旧代残尾会污染新 worker 首帧 ⇒ 该行 badJson ⇒ 请求白等到超时）。
    buffer = Buffer.alloc(0)
    stats.restarts++
    void reason
  }

  function currentEpoch() { return epoch }
  function isStarted() { return !!child }
  function processForTest() { return child }

  function debugView() {
    return {
      started: !!child,
      epoch: epoch ? epoch.slice(0, 12) + '…' : null,
      pending: pending.size,
      breaker: { open: breakerOpen(), consecutiveFailures: breaker.consecutiveFailures, cooldownMs: Number(opt('breakerCooldownMs', B.breakerCooldownMs)) },
      stderrTailBytes: stderrTail.length,
      stats: JSON.parse(JSON.stringify(stats)),
    }
  }

  function dispose(reason) {
    if (disposed) return
    disposed = true
    if (child) { try { child.kill() } catch (_) {} }
    child = null
    epoch = null
    for (const [, entry] of [...pending]) settle(entry, { ok: false, code: 'disposed' })
    activationHandlers.clear()
    void reason
  }

  return {
    kind: 'python-sidecar-pre',
    request, notify, health, restart, dispose, debugView,
    ensureStarted, isStarted, currentEpoch, processForTest, breakerOpenForTest: breakerOpen,
    // 测试钩子:确定性 framing 注入(partial/multiple/bad JSON/oversize/伪造帧)与最后出站帧检查
    _feedForTest(chunk) { feed(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk) },
    _lastFrameForTest() { return lastSentFrame },
    onActivation(handler) { activationHandlers.add(handler); return () => activationHandlers.delete(handler) },
    _statsForTest: stats,
    _pendingForTest: pending,
  }
}
