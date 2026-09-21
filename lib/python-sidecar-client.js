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
 *   - ★ #107 看门狗:连续超时(心跳缺失)达阈值 ⇒ **kill 旧进程 + 下次请求重生新进程**。旧实现
 *     超时只发 cancel 通知、从不 kill ⇒ 挂死的 worker 永远无人收尸,后续每个请求各自等到超时。
 *     stats 把「看门狗主动击杀」与「崩溃退出」分开记;熔断只由**终态成功**清零,段内进度帧
 *     (index_sync_begin / index_sync_page)的 ack 成功不清零 —— 否则每个 Segment 一次 begin 就把
 *     累计失败抹平,峰值恒 1、阈值 3 永不达,熔断形同虚设。
 *   - ★ #108 stderr 可见:exit/fatal 分支把 stderr 尾部**原样**落一条 diag(同一次退出只记一条,
 *     按行与字符双重截断防刷屏),并把截断后文本暴露为 stats.lastStderrTail /
 *     debugView().lastStderrTail;同时保留 stderrTailBytes 以区分「确实没输出」与「输出被截」。
 * 无 shell;无 HTTP;stdout 只进协议解析器;stderr 有界诊断 + 有界 diag 环形缓冲(不再只留字节数)。
 * ★ 影响面纪律:本模块是「JS 语义默认 / Python 发烧友可选」里**Python 那一侧**的传输层,不参与
 *   JS 语义路径;下述改动只影响 Python 档自身的行为,不改变 JS 端任何行为,也不让 python 侧的
 *   存在或健康度成为 JS 语义生效的前提(未启动时零进程零 IO,调用方按需 lazy start)。
 * UTF-8 无 BOM。
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

/**
 * 看门狗/诊断策略(**客户端本地策略量**,刻意不放进 M7_TRANSPORT_BUDGET_V1)。
 * 理由有二:①传输预算按契约冻结、变更须升协议版本,而「多久判挂死」是客户端自愈策略、不是 wire 契约;
 * ②wire 文件同期另有 PR(#122/#124)在改,本任务不去碰它以避开写域冲突。
 */
const SIDECAR_WATCHDOG_V1 = Object.freeze({
  stallThreshold: 3,      // 连续超时(心跳缺失)达此数 ⇒ 判定挂死,看门狗击杀旧进程
  stderrTailChars: 4096,  // stderr 环形尾部保留长度(既有语义,原为字面量 4096)
  diagRingCapacity: 16,   // diag 环形缓冲条数(超出丢最旧)
  diagTailLines: 8,       // 单条 diag 最多保留的 stderr 行数(防刷屏)
  diagTailChars: 1200,    // 单条 diag 最多保留的 stderr 字符数
})

/** 退出归因优先级:高优先级不被低优先级覆盖。 */
const EXIT_KIND_RANK_V1 = Object.freeze({ crash: 0, restart: 1, dispose: 1, fatal: 2, watchdog: 3 })

/**
 * ★ #107 熔断清零口径:只有「终态成功」才把累计失败清零。
 * index_sync_begin / index_sync_page 是**段内进度帧**(每个 Segment 都会 begin 一次),它们的 ack
 * 成功只证明 worker 读到并回了一行,不能证明它健康。旧实现无差别清零 ⇒ 每个 Segment 的 begin 一经
 * 成功就把累计失败抹平,峰值恒 1、阈值 3(breakerFailureThreshold)永不达,熔断形同虚设。
 * health / context_push / index_sync_commit 才是各自工作单元的终态应答。
 */
const TERMINAL_SUCCESS_TYPES_V1 = new Set(['health', 'context_push', 'index_sync_commit'])

/** 捆绑 fake worker 的默认绝对路径(python/worker_v1.py)。 */
export function defaultWorkerScriptPathPre() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'worker_v1.py')
  } catch (_) { return '' }
}

const FAILURE_CODES = new Set(['timeout', 'crashed', 'unavailable', 'protocol', 'line-oversize'])

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
  // ---- #107 看门狗 / #108 stderr 可见:状态 ----
  let genSeq = 0                       // 世系序号发生器
  let generation = 0                   // 当前世系号(0 = 从未启动过)
  let consecutiveTimeouts = 0          // 连续超时(心跳缺失)计数
  let halfOpenPending = false          // 熔断冷却到期后待用 health() 探活
  let respawnPending = false           // 看门狗击杀后待重生(下次 spawn 计一次 watchdog.respawns)
  let lastStderr = { tail: '', bytes: 0, truncated: false, at: 0, generation: 0, totalLines: 0, keptLines: 0 }
  let lastExitDiagKey = ''             // 「同一次退出只记一条」去重键 = 世系号 + 退出种类
  let lastExitDiagRef = null           // 该条 diag 记录引用(供 exit 之后迟到的 stderr 就地刷新)
  let lastExitGen = 0                  // 最近一次退出的世系号
  const genOfProc = new WeakMap()      // ChildProcess -> 世系号
  const exitKindByGen = new Map()      // 世系号 -> 退出种类(crash/restart/dispose/fatal/watchdog)
  const diagRing = []                  // 有界 diag 环形缓冲(给人看的诊断,含中文归因)
  const breaker = { consecutiveFailures: 0, openUntil: 0 }
  const stats = {
    starts: 0, exits: 0, framesIn: 0, requests: 0, succeeded: 0, activationsReceived: 0,
    cancelNotifications: 0, restarts: 0,
    dropped: { badJson: 0, badEnvelope: 0, staleEpoch: 0, unknownRequest: 0, typeMismatch: 0, duplicateActivation: 0 },
    failed: { timeout: 0, crashed: 0, aborted: 0, circuitOpen: 0, unavailable: 0, backpressure: 0, protocol: 0, workerError: 0, disposed: 0 },
    lastExit: null, lastFatal: null,
    // ★ #107 看门狗:把「主动重启」与「崩溃退出」分开记,不再混在一个 exits 计数里。
    watchdog: { kills: 0, respawns: 0, lastReason: null, lastAt: 0, lastDetail: null },
    exitKinds: { crash: 0, restart: 0, dispose: 0, fatal: 0, watchdog: 0, spawnError: 0 },
    breakerProbes: { attempted: 0, ok: 0, failed: 0 },
    lastExitNote: null,
    // ★ #108 stderr:lastStderrTail 是**截断后可读文本**(不再只有字节数);
    //   stderrTailBytes 仍在 debugView 上,用来区分「没输出」与「输出被截」。
    lastStderrTail: '',
    lastStderrTailBytes: 0,
    lastStderrTailTruncated: false,
    lastStderrTailAt: 0,
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

  function breakerOpen() { return Date.now() < breaker.openUntil }

  // ============ #107 看门狗 / #108 stderr 可见:诊断与自愈 ============
  // 说明:以下全部只服务 Python 侧车自身的自愈与可观测性,不参与 JS 语义路径。

  /** 有界 diag 环形缓冲:落一条**给人看**的中文诊断;opts.onDiag 在场时同步外发一份。 */
  function pushDiag(level, text) {
    const rec = { at: Date.now(), level, sidecar: 'python-sidecar-pre', generation, message: String(text) }
    diagRing.push(rec)
    while (diagRing.length > Math.max(1, Number(opt('diagRingCapacity', SIDECAR_WATCHDOG_V1.diagRingCapacity)))) diagRing.shift()
    const sink = resolveOpt('onDiag')
    if (typeof sink === 'function') { try { sink({ at: rec.at, level: rec.level, generation, message: rec.message }) } catch (_) {} }
    return rec
  }

  /**
   * 把 stderr 尾部整理成可读文本:保留尾 N 行(默认 8)且不超过 M 字符(默认 1200)。
   * 被截断时在正文前留一行说明 —— 避免读者误以为「这就是全部输出」。
   */
  function tailForDiag(raw) {
    const NL = String.fromCharCode(10)
    const CR = String.fromCharCode(13)
    const src = String(raw == null ? '' : raw)
    const bytes = src.length
    // 刻意不用正则字面量:本仓所有 .js 均为 CRLF,避免任何转义歧义。
    const all = src.split(NL).map((l) => (l.endsWith(CR) ? l.slice(0, -1) : l))
    while (all.length && all[all.length - 1] === '') all.pop()
    const maxLines = Math.max(1, Number(opt('diagTailLines', SIDECAR_WATCHDOG_V1.diagTailLines)))
    const maxChars = Math.max(1, Number(opt('diagTailChars', SIDECAR_WATCHDOG_V1.diagTailChars)))
    const kept = all.slice(-maxLines)
    let truncated = kept.length < all.length
    let text = kept.join(NL)
    if (text.length > maxChars) { text = text.slice(-maxChars); truncated = true }
    const head = truncated ? '…[已按行/字符截断,下面不是全部输出]…' + NL : ''
    return { text: head + text, truncated, keptLines: kept.length, totalLines: all.length, bytes }
  }

  /** 退出归因中文说明(回答「哪一侧车、哪一代、怎么退的、退出码多少」)。 */
  function humanExitNote(gen, kind, code, signalName) {
    const why = kind === 'watchdog' ? '被看门狗主动击杀(连续超时=心跳缺失达阈值,判定挂死)'
      : kind === 'fatal' ? '因协议致命错误被就地击杀(帧纪律违规)'
        : kind === 'restart' ? '被 restart() 主动重启(刻意换代,不是故障)'
          : kind === 'dispose' ? '随 dispose() 收尾关闭(刻意关闭,不是故障)'
            : '自行退出(非看门狗击杀)——即「崩溃退出」'
    const c = (code === null || code === undefined) ? 'null' : String(code)
    const s = signalName ? String(signalName) : 'null'
    return '第 ' + gen + ' 代 Python 语义侧车' + why + ':退出码 code=' + c + ',signal=' + s
  }

  /** 退出归因写入(优先级 watchdog > fatal > dispose/restart > crash;低优先级不覆盖高优先级)。 */
  function markExitKind(gen, kind) {
    if (!gen) return
    const cur = exitKindByGen.get(gen) || 'crash'
    if ((EXIT_KIND_RANK_V1[kind] || 0) < (EXIT_KIND_RANK_V1[cur] || 0)) return
    exitKindByGen.set(gen, kind)
    while (exitKindByGen.size > 64) exitKindByGen.delete(exitKindByGen.keys().next().value)
  }

  /**
   * ★ #108 关键修复:把 stderr 尾部**原样**落一条 diag。
   * 旧实现只把 4KB 尾部收进 `stderrTail` 变量、对外仅暴露 `stderrTailBytes` 一个整数,
   * **内容没有任何读者** ⇒ Python traceback 永远看不到,用户只能看到「字节数非 0」。
   * 同一次退出只记一条:以「世系号 + 退出种类」为键,命中则**就地刷新**(退出之后 stdio 往往
   * 还在排空,close 晚于 exit、尾字节会迟到;就地刷新既补全内容又不新开第二条)。
   */
  function logExitDiag(gen, kind, reasonText) {
    const t = tailForDiag(stderrTail)
    lastStderr = { tail: t.text, bytes: t.bytes, truncated: t.truncated, at: Date.now(), generation: gen, totalLines: t.totalLines, keptLines: t.keptLines }
    stats.lastStderrTail = t.text
    stats.lastStderrTailBytes = t.bytes
    stats.lastStderrTailTruncated = t.truncated
    stats.lastStderrTailAt = lastStderr.at
    const note = t.bytes === 0
      ? 'stderr 零输出(确实没打印,不是被截断)'
      : (t.truncated
        ? 'stderr 尾部累计 ' + t.bytes + ' 字符 / ' + t.totalLines + ' 行,此处只保留最后 ' + t.keptLines + ' 行共 ' + t.text.length + ' 字符(已按行与字符双重截断,防刷屏)'
        : 'stderr 尾部累计 ' + t.bytes + ' 字符 / ' + t.totalLines + ' 行,已全部保留')
    const NL = String.fromCharCode(10)
    const body = String(reasonText) + ';' + note + (t.text ? NL + '—— stderr 原文 ——' + NL + t.text : '')
    const key = gen + ':' + kind
    const level = (kind === 'crash' || kind === 'watchdog' || kind === 'fatal') ? 'error' : 'info'
    if (lastExitDiagKey === key && lastExitDiagRef) {
      lastExitDiagRef.message = body
      lastExitDiagRef.at = lastStderr.at
      lastExitDiagRef.level = level
      return lastExitDiagRef
    }
    lastExitDiagKey = key
    lastExitGen = gen
    lastExitDiagRef = pushDiag(level, body)
    return lastExitDiagRef
  }

  /**
   * ★ #107 看门狗:判定侧车挂死 ⇒ **kill 旧进程 + 下次请求重生新进程**。
   * 旧实现在超时分支只 `notify('cancel')`、从不 kill ⇒ 挂死的 worker 永远无人收尸,后续每个
   * 请求各自等到自己的超时、再各自发一条无用的 cancel;对用户的表现是「Python 档语义静默失效」。
   * 刻意不在此处立即 spawn:避免在熔断打开期制造进程(既有套件断言「打开期零 spawn」);
   * 重建交给下一次 ensureStarted() —— 那里必然带新 epoch,index 重同步也随之触发。
   */
  function disarmHungChild(trigger, detail) {
    const proc = child
    consecutiveTimeouts = 0
    if (!proc) return
    markExitKind(generation, 'watchdog')
    child = null
    epoch = null
    buffer = Buffer.alloc(0)
    respawnPending = true
    stats.watchdog.kills++
    stats.watchdog.lastReason = trigger
    stats.watchdog.lastAt = Date.now()
    stats.watchdog.lastDetail = detail || null
    const thr = Math.max(1, Number(opt('watchdogStallThreshold', SIDECAR_WATCHDOG_V1.stallThreshold)))
    pushDiag('error', '第 ' + generation + ' 代 Python 语义侧车连续 ' + thr + ' 次心跳缺失(' + trigger + ')⇒ 看门狗主动击杀旧进程;下次请求将重生新进程(新 epoch),未经确认的旧 in-flight 请求按 crashed 结算。')
    logExitDiag(generation, 'watchdog', humanExitNote(generation, 'watchdog', null, null))
    try { proc.stdin.destroy() } catch (_) {}
    try { proc.kill() } catch (_) {}
    rejectAll('crashed')
  }

  /** 心跳缺失证据:只把「超时」算挂死(abort 是调用方主动取消,不构成挂死证据)。 */
  function noteStall(type, requestId, timeoutMs) {
    consecutiveTimeouts++
    const thr = Math.max(1, Number(opt('watchdogStallThreshold', SIDECAR_WATCHDOG_V1.stallThreshold)))
    if (consecutiveTimeouts < thr) return
    disarmHungChild('连续超时', { type: String(type), requestId: String(requestId), timeoutMs: Number(timeoutMs), consecutiveTimeouts })
  }

  /**
   * ★ #107 熔断半开探测:冷却到期后不放行盲发,先用 health()(有界)自证 worker 活着再放行。
   * 这是 health() 在仓内的**唯一真实调用点**。type==='health' 不入此分支 ⇒ 不会递归,
   * 也不会把探针自身的失败再算作一次新的挂死证据。
   */
  async function probeThenSend(type, payload, rOpts) {
    halfOpenPending = false
    stats.breakerProbes.attempted++
    const probeTimeout = Math.min(Math.max(1, Number(opt('requestTimeoutMs', B.requestTimeoutMs))), 2000)
    const probe = await request('health', {}, { timeoutMs: probeTimeout })
    if (probe && probe.ok) {
      stats.breakerProbes.ok++
      breaker.consecutiveFailures = 0
      consecutiveTimeouts = 0
      return request(type, payload, rOpts)
    }
    stats.breakerProbes.failed++
    breaker.openUntil = Date.now() + Number(opt('breakerCooldownMs', B.breakerCooldownMs))
    halfOpenPending = true
    stats.failed.circuitOpen++
    pushDiag('error', '熔断半开探测未通过:Python 语义侧车 health 探针返回 ' + String((probe && probe.code) || 'unknown') + ' ⇒ 重新打开熔断 ' + Number(opt('breakerCooldownMs', B.breakerCooldownMs)) + 'ms;本次请求按 circuit-open 返回。')
    return { ok: false, code: 'circuit-open', retryInMs: breaker.openUntil - Date.now() }
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
    generation = ++genSeq
    genOfProc.set(proc, generation)
    exitKindByGen.set(generation, 'crash')
    stderrTail = ''          // ★ #108:stderr 尾部按**世系**隔离,避免把上代 traceback 误挂到本代
    consecutiveTimeouts = 0
    if (respawnPending) { stats.watchdog.respawns++; respawnPending = false }
    proc.stdout.on('data', (chunk) => { try { feed(chunk) } catch (_) { fatal('protocol') } })
    proc.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString('utf8'))
        .slice(-Math.max(256, Number(opt('stderrTailChars', SIDECAR_WATCHDOG_V1.stderrTailChars))))
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
      const gen = genOfProc.get(proc) || 0
      const kind = exitKindByGen.get(gen) || 'crash'
      // ★ #107:无论是否当前世系都先记账 —— 「哪一侧车、第几代、怎么退的、退出码多少」
      //   stats.exits 仍是总退出数;active 的归因细分在 stats.exitKinds。
      stats.exits++
      stats.exitKinds[kind] = (stats.exitKinds[kind] || 0) + 1
      stats.lastExit = { code, signal: signalName, generation: gen, kind }
      stats.lastExitNote = humanExitNote(gen, kind, code, signalName)
      logExitDiag(gen, kind, stats.lastExitNote)
      if (child !== proc) return
      child = null
      epoch = null
      buffer = Buffer.alloc(0)
      rejectAll('crashed')
    })
    return { ok: true }
  }

  function rejectAll(code) {
    for (const [, entry] of pending) settle(entry, { ok: false, code })
    // ★ #107:不再在循环外额外 noteFailure(code) —— settle() 已按每个失败请求各计一次,
    //   旧实现在此重复计数 ⇒ 崩溃时挂 K 个请求会被算成 K+1 次失败,熔断阈值提前触发(假熔断)。
  }

  function fatal(kind) {
    stats.lastFatal = kind
    buffer = Buffer.alloc(0) // 丢弃残留半帧,防止污染重生进程的解析流
    // ★ #108:致命分支同样把 stderr 尾部原样落一条 diag;与随后 exit 同键(世系号+fatal)
    //   ⇒ 同一次退出只记一条。
    logExitDiag(generation, 'fatal', humanExitNote(generation, 'fatal', null, null) + ' 触发原因=' + String(kind))
    if (child) {
      markExitKind(generation, 'fatal')
      try { child.stdin.destroy() } catch (_) {}
      try { child.kill() } catch (_) {}
    }
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
      // ★ #107 熔断清零口径:只有「终态成功」清零累计失败;段内进度帧(index_sync_begin /
      //   index_sync_page)的 ack 成功**不清零** —— 否则每个 Segment 一次 begin 就把累计失败
      //   抹平,峰值恒 1、阈值 3 永不达,熔断形同虚设。
      if (TERMINAL_SUCCESS_TYPES_V1.has(entry.type)) {
        breaker.consecutiveFailures = 0
        consecutiveTimeouts = 0
        halfOpenPending = false
      }
    }
    else {
      const bucket = stats.failed[result.code]
      if (bucket === undefined) stats.failed.protocol++
      else stats.failed[result.code]++
      noteFailure(result.code)
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
    // ★ #107 熔断半开探测:冷却到期后不放行盲发,先用 health()(有界)自证 worker 活着再放行。
    //   这是 health() 在仓内的**唯一真实调用点** —— 旧实现 health() 全仓零调用,文件里那句
    //   「health 探针(breaker half-open 用;有界响应)」是空头承诺。type==='health' 不入此分支
    //   ⇒ 不会递归,也不会把探针本身的失败再算作一次挂死证据。
    if (halfOpenPending && type !== 'health') return probeThenSend(type, payload, rOpts)
    return sendNow(type, payload, rOpts)
  }

  /**
   * 真正的建帧 + 入队。与旧 request() 同体,刻意保持「调用后同步可见 _lastFrameForTest()」
   * 的既有契约(既有套件靠它在 await 之前做帧级断言)。
   */
  function sendNow(type, payload, rOpts = {}) {
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
      const entry = { requestId, type, expectedType: RESPONSE_TYPE_FOR_V1[type], resolve, settled: false, timer: null, signal: rOpts.signal || null, onAbort: null }
      pending.set(requestId, entry)
      stats.requests++
      const written = writeFrame(mf.frame)
      if (!written) { settle(entry, { ok: false, code: 'unavailable' }); return }
      const timeoutMs = Math.max(1, Number(rOpts.timeoutMs) || Number(opt('requestTimeoutMs', B.requestTimeoutMs)))
      entry.timer = setTimeout(() => {
        settle(entry, { ok: false, code: 'timeout', timeoutMs })
        notify('cancel', { requestId })
        // ★ #107:旧实现到此为止(只发 cancel,不 kill)⇒ 挂死的 worker 无人收尸。
        //   这里补上心跳缺失证据的累计与看门狗收尸(达阈值才动,避免偶发慢帧被误杀)。
        noteStall(type, requestId, timeoutMs)
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
    markExitKind(generation, 'restart')
    breaker.consecutiveFailures = 0
    consecutiveTimeouts = 0
    pushDiag('info', 'restart() 主动重启 Python 语义侧车:旧进程已击杀、新 epoch 待下次请求重生(原因:' + String(reason === undefined || reason === null ? '未给' : reason) + ')。')
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
      generation,
      // ★ #108:stderrTailBytes 保留原语义(当前世系累计保留的尾部长度)——0 表示确实没输出,
      //   非 0 且 lastStderrTailTruncated=true 表示有输出但被截断。文本本体见 lastStderrTail。
      stderrTailBytes: stderrTail.length,
      lastStderrTail: lastStderr.tail,
      lastStderrTailBytes: lastStderr.bytes,
      lastStderrTailTruncated: lastStderr.truncated,
      lastStderrTailAt: lastStderr.at,
      consecutiveTimeouts,
      halfOpenProbePending: halfOpenPending,
      watchdog: JSON.parse(JSON.stringify(stats.watchdog)),
      recentDiag: diagRing.slice(-4).map((d) => ({ at: d.at, level: d.level, message: d.message })),
      stats: JSON.parse(JSON.stringify(stats)),
    }
  }

  function dispose(reason) {
    if (disposed) return
    disposed = true
    markExitKind(generation, 'dispose')
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
    _diagRingForTest: diagRing,
  }
}
