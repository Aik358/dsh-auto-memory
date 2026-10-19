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
import os from 'node:os'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateTransportFramePre, makeRequestFramePre, RESPONSE_TYPE_FOR_PRE_V1,
  M7_TRANSPORT_BUDGET_PRE_V1, PY_FRAME_TYPES_PRE_V1,
} from './m7-wire.js'

const B = M7_TRANSPORT_BUDGET_PRE_V1

/**
 * 看门狗/诊断策略(**客户端本地策略量**,刻意不放进 M7_TRANSPORT_BUDGET_PRE_V1)。
 * 理由有二:①传输预算按契约冻结、变更须升协议版本,而「多久判挂死」是客户端自愈策略、不是 wire 契约;
 * ②wire 文件同期另有 PR(#122/#124)在改,本任务不去碰它以避开写域冲突。
 */
const SIDECAR_WATCHDOG_PRE_V1 = Object.freeze({
  stallThreshold: 3,      // 连续超时(心跳缺失)达此数 ⇒ 判定挂死,看门狗击杀旧进程
  stderrTailChars: 4096,  // stderr 环形尾部保留长度(既有语义,原为字面量 4096)
  diagRingCapacity: 16,   // diag 环形缓冲条数(超出丢最旧)
  diagTailLines: 8,       // 单条 diag 最多保留的 stderr 行数(防刷屏)
  diagTailChars: 1200,    // 单条 diag 最多保留的 stderr 字符数
})

/** 退出归因优先级:高优先级不被低优先级覆盖。 */
const EXIT_KIND_RANK_PRE_V1 = Object.freeze({ crash: 0, restart: 1, dispose: 1, fatal: 2, watchdog: 3 })

/**
 * ★ #107 熔断清零口径:只有「终态成功」才把累计失败清零。
 * index_sync_begin / index_sync_page 是**段内进度帧**(每个 Segment 都会 begin 一次),它们的 ack
 * 成功只证明 worker 读到并回了一行,不能证明它健康。旧实现无差别清零 ⇒ 每个 Segment 的 begin 一经
 * 成功就把累计失败抹平,峰值恒 1、阈值 3(breakerFailureThreshold)永不达,熔断形同虚设。
 * health / context_push / index_sync_commit 才是各自工作单元的终态应答。
 */
const TERMINAL_SUCCESS_TYPES_PRE_V1 = new Set(['health', 'context_push', 'index_sync_commit'])

/** 捆绑 fake worker 的默认绝对路径(python/worker_v1.py)。
 *  ★2026-09-28 去 pre：这里原本写 `worker_pre_v1.py`，而包内只有裸名 `worker_v1.py`
 *  ⇒ 默认路径是死链（`pythonBackendWorkerPath` 出厂为空，一律落到此处）⇒ sidecar spawn
 *  ENOENT → 静默降级 `unavailable`，用户在 python 档下感知不到、功能悄悄退回词法档。
 *  源码名即发布名（发布线不再改名），故此处必须写裸名。
 *
 *  ⚠️ 本函数是**协议级 fake worker**（`deterministic fake`，无 dense_search）。
 *  它只用于契约测试与「Python 档但未指定 worker」的历史兼容；**语义检索必须用
 *  `semanticWorkerScriptPathPre()`** —— 两者不可互换（2026-09-29 事故：自愈误落到本函数，
 *  把用户的语义 worker 换成了 fake，Python 档会"进程起来了但检索退化"）。 */
export function defaultWorkerScriptPathPre() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', 'worker_v1.py')
  } catch (_) { return '' }
}

/** 真语义 worker（含 dense_search / ONNX 推理）的裸名。发布清单 pyMust 同源。 */
export const SEMANTIC_WORKER_BASENAME_PRE_V1 = 'worker_semantic_v1.py'

/**
 * ★2026-09-29：**语义 worker** 的默认绝对路径（`python/worker_semantic_v1.py`）。
 * 与 `defaultWorkerScriptPathPre()`（fake worker）严格区分：**Python 档的语义检索走本函数**。
 * 存在性由调用方按需判定；本函数只负责拼出规范路径（零 IO）。
 */
export function semanticWorkerScriptPathPre() {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'python', SEMANTIC_WORKER_BASENAME_PRE_V1)
  } catch (_) { return '' }
}

/** 历史命名：去 pre 之前叫这个（`_pre_` 中缀）。用户配置里可能仍留着死路径。 */
const LEGACY_WORKER_NAME_RE = /_pre_v1\.py$|^worker_pre_/

/**
 * ★2026-09-29 修（「去 pre」静默失效第二现场 —— 配置文件里的旧路径）：
 *
 * 病症（真机取证）：配置 `pythonBackendWorkerPath` 指向
 * `D:/dsh-auto-memory/python/worker_semantic_pre_v1.py`，而该文件**不存在**（去 pre 后裸名）。
 * 配置值优先于本模块的默认值 ⇒ spawn ENOENT ⇒ sidecar 恒 `unavailable` ⇒ C3 语义臂全程
 * 静默失效，`engineSwitch.failed` 一路累到 4112（连续 8 天，每天上千次重试）。
 * **为什么会静默**：`unavailable` 是 fail-soft 的正常降级码（Python 未装时合法），
 * 所以它不会报错、UI 也只显示"Python 未启用" —— 与"用户根本没配 Python"无法区分。
 *
 * 处方（**不猜测、只纠正可判定的死链**）：仅当调用方给的路径**不存在**、且其文件名
 * 属历史命名形态（`*_pre_v1.py` / `worker_pre_*`）时：
 *   ① 优先改判为**同目录下的裸名语义 worker**（保住"语义"语义 —— 原值本就是语义 worker）；
 *   ② 同目录没有则退到**包内语义 worker**（`semanticWorkerScriptPathPre`）；
 *   ③ 两者都没有才原样返回（让既有诊断照常报告，不掩盖真缺失）。
 * ⚠️ 绝不回落 `defaultWorkerScriptPathPre()`（那是 **fake** worker）—— 2026-09-29 首版曾
 *   误落该处，把用户语义 worker 静默换成 fake（进程起得来但检索退化），本函数已修正。
 * ⇒ 用户配的合法自定义 worker 永不被覆盖；只有"旧命名 + 文件确实不在"这一种情形被救。
 *
 * @param {string} configured 调用方给的路径（可空）
 * @param {string} fallbackDefault `defaultWorkerScriptPathPre()` 的结果（兼容旧签名；**仅当它
 *        指向语义 worker 时才用作末位兜底**，否则忽略 —— 见上方 ⚠️）
 * @returns {string} 可用路径（纠正后的或原样的）
 */
export function resolveWorkerScriptPathPre(configured, fallbackDefault) {
  const cfg = String(configured || '').trim()
  if (!cfg) {
    // 空配置：优先语义 worker（Python 档的本意就是语义检索）；不存在才退回调用方给的默认
    const sem = semanticWorkerScriptPathPre()
    if (sem && existsSync(sem)) return sem
    return String(fallbackDefault || '')
  }
  try {
    if (existsSync(cfg)) return cfg
    // 死链：仅历史命名的同目录裸名可救（严格形态判定，不做模糊匹配）
    const base = path.basename(cfg)
    if (!LEGACY_WORKER_NAME_RE.test(base)) return cfg
    // ① 同目录裸名语义 worker（最贴近用户原意：就地改名前后）
    const sibling = path.join(path.dirname(cfg), SEMANTIC_WORKER_BASENAME_PRE_V1)
    if (existsSync(sibling)) return sibling
    // ② 本包捆绑的语义 worker（用户搬过目录 / 配置来自旧安装位）
    //    ⚠️ 必须用 semanticWorkerScriptPathPre()，**不得**回落 defaultWorkerScriptPathPre()
    //    （后者是 fake worker —— 2026-09-29 首版误落此处，语义 worker 被静默换成 fake）。
    const bundledSem = semanticWorkerScriptPathPre()
    if (bundledSem && existsSync(bundledSem)) return bundledSem
    // ③ 都不在：原样返回，让既有诊断照常报告真缺失（不猜测、不掩盖）
    return cfg
  } catch (_) { return cfg }
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
  /**
   * ★2026-10-19 P0：**取函数本体**，不调用它。
   *   `opt()` 的契约是「函数值即惰性求值 thunk」，对 command/scriptPath/dshHome 这类配置项正好；
   *   但 `resolveCommand` / `canStart` 本身就是**要被调用的函数**，用 opt() 取会当场执行一次
   *   （async 的还会拿到 Promise）⇒ 断言 `typeof resolver !== 'function'` 恒真 ⇒ 验证闸永远失败。
   *   实测踩坑：a29 的 B1 用例因此拿到 interpreter-unverified。
   */
  const rawOpt = (k, dflt) => { const v = opts[k]; return v === undefined ? dflt : v }
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
  /**
   * ★2026-10-19 P0（根因修复）：**spawn 前必须先拿到「已验证」的解释器**。
   *
   * 病症（真机取证）：活跃侧车 PID 56780 的 cmdline 是裸 `python ...worker_semantic_v1.py`，
   *   实际落到 C:\Python314\python.exe（系统 python，**没有 transformers**）⇒ worker 的
   *   `_init_embedding` 抛 ModuleNotFoundError ⇒ `self.embedder = None` ⇒ `dense_search()`
   *   第一步 `return []` ⇒ 候选恒空 ⇒ shadow 决策 256/256 全 `suppress_low_signal`
   *   （实测 fv2-debug.log 164187 行里 26055 行 ncand=0、188 段交替抖动）。
   *
   * 为什么探不到：侧车的 command 选项此前是 `engine.resolvedPythonCommand() || 'python'` ——
   *   **探测缓存（TTL 60s）没命中时就静默回落裸 `python`**。而 context_push 热路径
   *   （context-host → bridge → sink → sidecar.request）**从不调用 preparePythonRecallPre**，
   *   所以「重启后第一次语义请求」必然踩在「缓存为空」的窗口里 ⇒ 每轮启动都以系统 python 起进程，
   *   此后终身残废（进程不崩、也不自愈：本机 stats.starts=1 / exits=0 / exitKinds 全 0）。
   *
   * 判据（fail-closed，绝不猜）：
   *   · 未显式要求验证的旧调用点（Tests/fixture）保持既有契约（允许 `'python'` 回落），不破坏存量套件；
   *   · `requireVerifiedCommand: true` 时，拿不到已验证命令 ⇒ **不起进程**，返回结构化
   *     `interpreter-unverified`，由上层如实显示「语义引擎未就绪」，而不是拿一个坏进程冒充可用。
   *   · 解析器（`resolveCommand`）只允许在**首次 spawn 之前**跑一次；已有进程时沿用当前世系，
   *     避免热路径每帧都付探测成本。
   */
  let commandResolveInFlight = null       // 首次 spawn 前的解析飞行（并发请求共用一次）
  let commandResolveCount = 0             // 解析次数（诊断用；>1 说明缓存没兜住）
  let commandResolveFailures = 0          // 解析失败次数（拿不到已验证命令）
  let lastCommandSource = ''              // 'cache' | 'probe' | 'configured' | ''（诊断用）
  let lastSpawnedCommand = ''             // 最近一次真实 spawn 用的命令（诊断用；debug.interpreter.command）
  let healthInFlight = false              // 长驻 health 巡检重入闸
  let healthTimer = null                  // 周期巡检定时器
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
    dropped: { badJson: 0, badEnvelope: 0, staleEpoch: 0, unknownRequest: 0, typeMismatch: 0, duplicateActivation: 0, stdinError: 0 },
    failed: { timeout: 0, crashed: 0, aborted: 0, circuitOpen: 0, unavailable: 0, backpressure: 0, protocol: 0, workerError: 0, disposed: 0 },
    lastExit: null, lastFatal: null,
    // ★ #107 看门狗:把「主动重启」与「崩溃退出」分开记,不再混在一个 exits 计数里。
    watchdog: { kills: 0, respawns: 0, lastReason: null, lastAt: 0, lastDetail: null },
    exitKinds: { crash: 0, restart: 0, dispose: 0, fatal: 0, watchdog: 0, spawnError: 0 },
    breakerProbes: { attempted: 0, ok: 0, failed: 0 },
    // ★2026-10-19 P0：stderr 增量告警条数（"活着但残废"的可观测证据）。
    stderrAlerts: 0,
    // ★2026-10-19 P0：**长驻进程**健康巡检账本（区别于短命探针；面板该看这一组）。
    health: { checks: 0, failed: 0, degraded: 0, recovered: 0, lastAt: 0, lastCode: '', lastHealthSeen: null, lastEmbedderOk: null, lastVectorReady: null, lastEmbeddingError: '', lastProvider: '' },
    lastExitNote: null,
    // ★ #108 stderr:lastStderrTail 是**截断后可读文本**(不再只有字节数);
    //   stderrTailBytes 仍在 debugView 上,用来区分「没输出」与「输出被截」。
    lastStderrTail: '',
    lastStderrTailBytes: 0,
    lastStderrTailTruncated: false,
    lastStderrTailAt: 0,
  }

  function resolveOpt(k) { return opt(k, null) }

  /**
   * ★#444：**当前代进程**判据。
   * 背景：只有 exit handler 有 `child !== proc` 守卫；error / stdout / stderr 三个 handler
   * 此前无条件生效 ⇒ 重启后旧进程迟到的事件会抹掉**新进程**引用、误拒新代在途请求、并给熔断计数 +1。
   * 判据同时校验「引用身份」与「世系号」（genOfProc 在 spawn 时登记），两者缺一都不算当前代。
   */
  function isCurrentProc(p) { return !!p && p === child && (genOfProc.get(p) || 0) === generation }

  /**
   * ★2026-10-19 P0（可观测性）：stderr **增量**诊断 —— 不依赖进程退出。
   *
   * 背景：worker 的致命失败有两种形态 —— ①崩掉（旧的 exit 分支能抓到）；
   *   ②**活着但残废**（本机事故：embedding 初始化失败 ⇒ embedder=None ⇒ 检索恒空，
   *   进程 stays up、exits=0）。形态②下旧代码永不落 diag，用户在面板上什么也看不到。
   *
   * 判据：按行匹配「错误特征」，每代每条模式只记一次（避免每帧刷屏）；
   *   只落**经过裁剪的单行**（≤200 字符，去掉 traceback 噪声），不做全文转储。
   */
  const stderrSeenPatterns = new Map()   // 世系号 -> Set<patternKey>
  const STDERR_ALERT_PATTERNS_PRE_V1 = [
    /embedding-init-failed/i,
    /ModuleNotFoundError|No module named/i,
    /ImportError/i,
    /Traceback \(most recent call last\)/i,
    /MemoryError/i,
    /OSError|CUDA|onnxruntime/i,
  ]
  function noteStderrLines(proc, chunk) {
    const gen = genOfProc.get(proc) || generation
    let seen = stderrSeenPatterns.get(gen)
    if (!seen) { seen = new Set(); stderrSeenPatterns.set(gen, seen); if (stderrSeenPatterns.size > 64) stderrSeenPatterns.delete(stderrSeenPatterns.keys().next().value) }
    const text = String(chunk && chunk.toString ? chunk.toString('utf8') : '')
    if (!text) return
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      for (const re of STDERR_ALERT_PATTERNS_PRE_V1) {
        if (!re.test(line)) continue
        const key = re.source
        if (seen.has(key)) continue
        seen.add(key)
        stats.stderrAlerts++
        const body = line.slice(0, 200)
        const t = tailForDiag(stderrTail)
        const tailText = t && t.text ? String(t.text).split(/\r?\n/).filter(Boolean).slice(-4).join(' / ').slice(0, 400) : ''
        pushDiag('error', '第 ' + gen + ' 代 Python 语义侧车 stderr 报错（进程仍在运行，这是「活着但残废」的现场，不等退出）:' + body + (tailText ? ';最近 stderr: ' + tailText : ''))
        break
      }
    }
  }

  /** ★#444：**进程退役清理**的唯一实现 —— error 与 exit 共用，杜绝两份清理逻辑各自漂移。 */
  function retireProc(code) {
    child = null
    epoch = null
    buffer = Buffer.alloc(0)
    rejectAll(code)
  }

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
    const rec = { at: Date.now(), level, sidecar: 'python-sidecar', generation, message: String(text) }
    diagRing.push(rec)
    while (diagRing.length > Math.max(1, Number(opt('diagRingCapacity', SIDECAR_WATCHDOG_PRE_V1.diagRingCapacity)))) diagRing.shift()
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
    const maxLines = Math.max(1, Number(opt('diagTailLines', SIDECAR_WATCHDOG_PRE_V1.diagTailLines)))
    const maxChars = Math.max(1, Number(opt('diagTailChars', SIDECAR_WATCHDOG_PRE_V1.diagTailChars)))
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
    if ((EXIT_KIND_RANK_PRE_V1[kind] || 0) < (EXIT_KIND_RANK_PRE_V1[cur] || 0)) return
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
    const thr = Math.max(1, Number(opt('watchdogStallThreshold', SIDECAR_WATCHDOG_PRE_V1.stallThreshold)))
    pushDiag('error', '第 ' + generation + ' 代 Python 语义侧车连续 ' + thr + ' 次心跳缺失(' + trigger + ')⇒ 看门狗主动击杀旧进程;下次请求将重生新进程(新 epoch),未经确认的旧 in-flight 请求按 crashed 结算。')
    logExitDiag(generation, 'watchdog', humanExitNote(generation, 'watchdog', null, null))
    try { proc.stdin.destroy() } catch (_) {}
    try { proc.kill() } catch (_) {}
    rejectAll('crashed')
  }

  /** 心跳缺失证据:只把「超时」算挂死(abort 是调用方主动取消,不构成挂死证据)。 */
  function noteStall(type, requestId, timeoutMs) {
    consecutiveTimeouts++
    const thr = Math.max(1, Number(opt('watchdogStallThreshold', SIDECAR_WATCHDOG_PRE_V1.stallThreshold)))
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
  /**
   * ★2026-10-19 P0：**解析**真正要用的解释器命令（不 spawn、不写状态）。
   *
   * 语义边界（与 ensureStarted 的分工）：
   *   · 本函数只负责「拿一个可信的命令」，失败一律返回结构化原因；
   *   · `requireVerifiedCommand !== true` 时保持旧行为（`command` 选项 → 裸 `python`），
   *     因为存量 smoke / fixture 明确依赖 `engine-not-ready` 与裸命令语义（见 issue415）；
   *   · `requireVerifiedCommand === true`（宿主生产接线）时**只认** resolveCommand 的结论：
   *     拿不到就 fail-closed，绝不用裸 `python` 顶上。
   *
   * 为什么要 async：宿主侧的 resolveCommand 走探测链（实测本机 8207ms 全链，
   *   首次命中 dev-venv 约 1.9s）。热路径绝不能同步阻塞，故这里只允许**首次 spawn 前** await 一次。
   */
  async function resolveCommandForSpawn() {
    const sync = String(resolveOpt('command') || '').trim()
    const requireVerified = resolveOpt('requireVerifiedCommand') === true
    const resolver = rawOpt('resolveCommand', null)
    if (typeof resolver !== 'function') {
      if (requireVerified) {
        commandResolveFailures++
        return { ok: false, code: 'interpreter-unverified', reason: 'requireVerifiedCommand 已开启但未提供 resolveCommand' }
      }
      return { ok: true, command: sync || 'python', source: sync ? 'configured' : 'fallback' }
    }
    // 非验证模式：显式配置的命令优先（保持旧语义：配置即权威）
    if (!requireVerified && sync) return { ok: true, command: sync, source: 'configured' }
    commandResolveCount++
    try {
      const r = await resolver()
      const cmd = String((r && r.command) || '').trim()
      if (cmd) { lastCommandSource = String((r && r.source) || 'probe'); return { ok: true, command: cmd, source: lastCommandSource } }
      commandResolveFailures++
      return { ok: false, code: 'interpreter-unverified', reason: String((r && r.reason) || '解释器探测未给出可用命令') }
    } catch (e) {
      commandResolveFailures++
      return { ok: false, code: 'interpreter-unverified', reason: String((e && e.message) || e).slice(0, 200) }
    }
  }

  function ensureStarted() {
    if (disposed) return { ok: false, code: 'disposed' }
    if (typeof opts.canStart === 'function' && !opts.canStart()) return { ok: false, code: 'engine-not-ready' }
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
    // ★2026-10-19 P0：走到这里说明需要**新起一个进程**。
    //   验证模式（宿主生产接线）必须异步解析解释器 ⇒ 交还 needs-async-start，由 sendNow 走异步分支；
    //   其余（存量套件/fixture 显式给 command）保持**同步 spawn**，不改变 _lastFrameForTest 契约。
    if (resolveOpt('requireVerifiedCommand') === true) return { ok: false, code: 'needs-async-start' }
    const syncCommand = String(resolveOpt('command') || '').trim()
    if (syncCommand) return spawnWithCommand(syncCommand)
    return { ok: false, code: 'needs-async-start' }
  }

  /**
   * ★2026-10-19 P0：异步启动（验证模式下唯一允许的 spawn 入口）。
   *
   * 并发纪律：首次请求常有多帧同时到达（context_push + index_sync 并发）。**解析只做一次**：
   *   后来者 await 同一飞行；解析失败后飞行即结束，下一次请求可重试（探测链自身有 60s 缓存，
   *   重复失败不会变成每帧一次的探测风暴）。
   */
  function ensureStartedAsync() {
    if (child) return Promise.resolve({ ok: true })
    if (commandResolveInFlight) return commandResolveInFlight
    commandResolveInFlight = (async () => {
      try {
        const r = await resolveCommandForSpawn()
        if (!r.ok) {
          pushDiag('error', '解释器未通过验证，拒绝启动 Python 语义侧车（不使用裸 python 兜底）:' + String(r.reason || r.code))
          return r
        }
        if (disposed) return { ok: false, code: 'disposed' }
        if (child) return { ok: true }
        const started = spawnWithCommand(r.command)
        if (started.ok) {
          pushDiag('info', 'Python 语义侧车第 ' + generation + ' 代已用已验证解释器启动:' + String(r.command) + '（来源 ' + String(r.source || 'probe') + '）')
        }
        return started
      } catch (e) {
        return { ok: false, code: 'interpreter-unverified', reason: String((e && e.message) || e).slice(0, 200) }
      } finally {
        commandResolveInFlight = null
      }
    })()
    return commandResolveInFlight
  }

  /** 已有命令时的实际 spawn（从原 ensureStarted 尾部原样抽出，语义不变）。 */
  function spawnWithCommand(command) {
    // ★2026-09-29：「去 pre」遗留的用户配置死链在此被纠正（见 resolveWorkerScriptPathPre 头注）。
    //   仅当配置路径不存在且属历史命名（*_pre_v1.py）时改判同目录/包内裸名语义 worker；
    //   合法自定义路径与真缺失情形一律原样透传，不掩盖既有诊断。
    const scriptPath = resolveWorkerScriptPathPre(resolveOpt('scriptPath'), defaultWorkerScriptPathPre())
    const dshHome = String(resolveOpt('dshHome') || '')
    epoch = 'wk_pre_' + randomBytes(16).toString('hex')
    const args = [scriptPath, '--expect-epoch', epoch]
    if (dshHome) args.push('--dsh-home', dshHome)
    let proc
    // ★2026-10-18（用户报「语义引擎全 suppress / 依赖明明装了却导入失败」的根治）：
    //   宿主在某些启动路径（尤其从打包 Electron 拉起）会给插件进程一个**被裁剪过的环境**，
    //   实测 USERPROFILE / HOME / APPDATA 三者全为 undefined。Python 的 site.py 用它们推导
    //   用户级 site-packages：拿不到 ⇒ site.USER_BASE 退化成字面量 '~\\Python'（'~' 不展开）
    //   ⇒ user site-packages 不在 sys.path ⇒ 用户**明明已安装**的 onnxruntime 导入失败
    //   ⇒ worker._init_embedding 捕获异常后置 embedder=None ⇒ dense_search 恒返回 []
    //   ⇒ 候选恒空 ⇒ 全部决策 suppress（实测 256/256、intentProb 均值 0.9942）。
    //   修法：**显式补回用户目录三件套**（仅当缺失时），使 user site-packages 恢复可达。
    //   判据：补回后 C:\Python314 能 import 到 C:\Users\<user>\AppData\Roaming\Python\Python314\site-packages。
    const childEnv = (() => {
      try {
        const env = { ...process.env }
        // ★复核（实测）：插件进程的 process.env 可能是**完全空对象**（0 个键），
        //   此时 env.USERPROFILE/HOME 全无 ⇒ 必须回落到 os.homedir()。
        //   实测 os.homedir() 在该环境下仍能正确返回 C:\\Users\\<user>（Windows 走 SHGetKnownFolderPath，
        //   不依赖环境变量）⇒ 它是可靠基准。
        let home = env.USERPROFILE || env.HOME || ''
        if (!home) { try { home = os.homedir() || '' } catch (_) {} }
        if (!home) return env          // 无基准可推，保持原样（不制造错误路径）
        if (!env.USERPROFILE) env.USERPROFILE = home
        if (!env.HOME) env.HOME = home
        if (!env.APPDATA) env.APPDATA = path.join(home, 'AppData', 'Roaming')
        if (!env.LOCALAPPDATA) env.LOCALAPPDATA = path.join(home, 'AppData', 'Local')
        return env
      } catch (_) { return process.env }
    })()
    lastSpawnedCommand = String(command)
    try {
      proc = spawn(command, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv })
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
    // ★#444：stdio 三个 handler 都必须做**代次判定**（exit 早就有 `child !== proc` 守卫，
    //   而 stdout/stderr 此前无条件写入 ⇒ 旧进程迟到的半帧会污染新进程的解析 buffer、
    //   旧代 traceback 会被挂到新代 stderrTail 上）。丢弃计入既有 dropped.staleEpoch 桶。
    proc.stdout.on('data', (chunk) => {
      if (!isCurrentProc(proc)) { stats.dropped.staleEpoch++; return }
      try { feed(chunk) } catch (_) { fatal('protocol') }
    })
    proc.stderr.on('data', (chunk) => {
      if (!isCurrentProc(proc)) { stats.dropped.staleEpoch++; return }
      stderrTail = (stderrTail + chunk.toString('utf8'))
        .slice(-Math.max(256, Number(opt('stderrTailChars', SIDECAR_WATCHDOG_PRE_V1.stderrTailChars))))
      // ★2026-10-19 P0（可观测性）：**stderr 增量落盘，不等退出**。
      //   旧实现只在进程 exit/fatal 时把 stderr 尾部记一条 diag；而本机事故里进程**从不退出**
      //   （starts=1 / exits=0），于是 stderr 里那句 `embedding-init-failed: No module named
      //   'transformers'`（67 字节）在界面上完全不可见 —— debug 视图只有 stderrTailBytes=67，
      //   文本字段 lastStderrTailBytes=0。排查时看不出「活着但残废」。
      //   现口径：按行扫描，命中错误特征即落 diag（同一条只记一次；每代各自去重）。
      try { noteStderrLines(proc, chunk) } catch (_) {}
    })
    // ★#444：stdin 也必须挂 error 监听。EPIPE（子进程已退出/管道断开）按 Node 默认
    //   「无监听 ⇒ 抛成未捕获异常」处理，默认策略下直接终止宿主（同 #269 在健康探测里的范式）。
    //   这里只记账 + diag 不外抛：请求侧仍由 writeFrame 的 false / 超时路径结构化结算。
    proc.stdin.on('error', (err) => {
      stats.dropped.stdinError++
      pushDiag('warn', '第 ' + generation + ' 代 Python 语义侧车 stdin 管道错误(' + String((err && err.code) || err || 'unknown') + ');该帧作废,请求按既有结构化路径结算,不抛出。')
    })
    proc.on('error', (err) => {
      // spawn 失败(ENOENT 等)/管道 EPIPE:结构化失败,不计崩溃重启
      // ★#444：**非当前代**的迟到 error 一律忽略 —— 旧实现无条件 child=null + rejectAll，
      //   会把新进程引用抹掉、把新代在途请求误拒、并给熔断计数 +1（unavailable 在 FAILURE_CODES 内）。
      if (!isCurrentProc(proc)) {
        pushDiag('warn', '第 ' + (genOfProc.get(proc) || 0) + ' 代 Python 语义侧车迟到 error 已忽略(当前第 ' + generation + ' 代):' + String((err && err.message) || err || 'unknown'))
        return
      }
      stats.exitKinds.spawnError = (stats.exitKinds.spawnError || 0) + 1
      retireProc('unavailable')
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
      if (!isCurrentProc(proc)) return
      retireProc('crashed')
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
    //   新判据：**epoch 为空 ⇒ 一律丢弃**。理由：spawn 时同步赋 epoch（:91 `epoch = 'wk_pre_' + …` 在
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
      if (TERMINAL_SUCCESS_TYPES_PRE_V1.has(entry.type)) {
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
    if (!RESPONSE_TYPE_FOR_PRE_V1[type]) return Promise.resolve({ ok: false, code: 'unsupported-frame' })
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
      // ★2026-10-19 P0：需要异步解析解释器时不当作失败结算，转异步分支后照常建帧。
      if (started.code === 'needs-async-start') return sendNowAsync(type, payload, rOpts)
      stats.failed[started.code] = (stats.failed[started.code] || 0) + 1
      return Promise.resolve({ ok: false, code: started.code })
    }
    return enqueueFrame(type, payload, rOpts)
  }

  /** ★2026-10-19 P0：异步启动完成后再入队（与 sendNow 尾部逐行同构，不复制语义）。 */
  async function sendNowAsync(type, payload, rOpts = {}) {
    const started = await ensureStartedAsync()
    if (!started.ok) {
      stats.failed[started.code] = (stats.failed[started.code] || 0) + 1
      return { ok: false, code: started.code, reason: started.reason }
    }
    if (disposed) return { ok: false, code: 'disposed' }
    return enqueueFrame(type, payload, rOpts)
  }

  /** 建帧 + 入队（原 sendNow 的主体，逐行保留）。 */
  function enqueueFrame(type, payload, rOpts = {}) {
    const maxPending = Number(opt('maxPendingRequests', B.maxPendingRequests))
    if (pending.size >= maxPending) { stats.failed.backpressure++; return Promise.resolve({ ok: false, code: 'backpressure' }) }
    const requestId = 'req_pre_' + randomBytes(9).toString('hex') + (++reqCounter).toString(36)
    const sentAt = Date.now()
    const mf = makeRequestFramePre({ type, payload, requestId, workerEpoch: epoch, sentAt })
    if (!mf.ok) { stats.failed.protocol++; return Promise.resolve({ ok: false, code: 'protocol', reason: mf.reason }) }
    return new Promise((resolve) => {
      const entry = { requestId, type, expectedType: RESPONSE_TYPE_FOR_PRE_V1[type], resolve, settled: false, timer: null, signal: rOpts.signal || null, onAbort: null }
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
    if (disposed || !PY_FRAME_TYPES_PRE_V1) return
    if (!child) return
    const requestId = 'ntf_pre_' + randomBytes(6).toString('hex')
    const sentAt = Date.now()
    const mf = makeRequestFramePre({ type, payload, requestId, workerEpoch: epoch, sentAt })
    if (mf.ok) { if (writeFrame(mf.frame)) stats.cancelNotifications++ }
  }

  /** health 探针(breaker half-open 用;有界响应)。 */
  function health(rOpts = {}) { return request('health', {}, rOpts) }

  /**
   * ★2026-10-19 P0（核心可观测性）：**对正在服务的那个进程**做健康体检。
   *
   * 旧实现的致命盲区：仓内唯一的 health 调用点是 `_probeWorkerHealthOnce`，它**另起一个短命
   *   进程**探活 —— 面板上的「已实测启动 ✓」描述的是那个临时进程，与真正在跑的长驻 worker
   *   毫无关系。本机事故里长驻进程 embedder=None（检索恒空），而面板一路绿灯、直到今天。
   *
   * 判据（与短命探针同源，避免两份判据漂移）：
   *   · healthSeen     —— 有应答（进程活着且协议通）
   *   · embedderOk     —— payload.embedding.enabled===true 且无 error（模型真加载成功）
   *   · vectorReady    —— 向量非 stale 且有 entry（另一维，不混入 embedderOk）
   * 只有 healthSeen && embedderOk 才算健康；否则计入 degraded 并落 diag。
   *
   * 纪律：有界（默认 8s）、绝不抛、不重入（上一轮未完成则跳过本轮）。
   */
  async function checkHealthOnce(rOpts = {}) {
    if (disposed || !child) return { ok: false, code: 'not-started' }
    if (healthInFlight) return { ok: false, code: 'busy' }
    healthInFlight = true
    try {
      const res = await request('health', {}, { timeoutMs: Number(rOpts.timeoutMs) || 8000 })
      if (!res || !res.ok) {
        stats.health.checks++
        stats.health.failed++
        stats.health.lastAt = Date.now()
        stats.health.lastCode = String((res && res.code) || 'unknown')
        return { ok: false, code: 'request-failed', reason: stats.health.lastCode }
      }
      const p = (res.frame && res.frame.payload) || {}
      const emb = p.embedding || {}
      const embedderOk = emb.enabled === true && !emb.error
      const healthSeen = true
      stats.health.checks++
      stats.health.lastAt = Date.now()
      stats.health.lastHealthSeen = healthSeen
      stats.health.lastEmbedderOk = embedderOk
      stats.health.lastVectorReady = emb.ready === true
      stats.health.lastEmbeddingError = String(emb.error || '')
      stats.health.lastProvider = String(emb.provider || '')
      if (!embedderOk) {
        stats.health.degraded++
        pushDiag('error', '长驻 Python 语义侧车**活着但残废**：health 有应答但 embedding 未就绪（' + String(emb.error || emb.reason || 'unknown') + '）⇒ 该进程的 dense_search 恒返回空、全部决策会落到 suppress。建议重启引擎或检查解释器/模型。')
        return { ok: false, code: 'embedder-degraded', reason: String(emb.error || emb.reason || '') }
      }
      if (stats.health.degraded > 0) stats.health.recovered++
      return { ok: true, healthSeen, embedderOk, vectorReady: emb.ready === true }
    } catch (e) {
      stats.health.failed++
      return { ok: false, code: 'threw', reason: String((e && e.message) || e).slice(0, 160) }
    } finally {
      healthInFlight = false
    }
  }

  /** 启动周期性 health 巡检（engine 侧显式调用；返回停止函数）。 */
  function startHealthPolling(intervalMs) {
    stopHealthPolling()
    const iv = Math.max(60000, Number(intervalMs) || 300000)
    healthTimer = setInterval(() => { void checkHealthOnce() }, iv)
    if (healthTimer && typeof healthTimer.unref === 'function') healthTimer.unref()
    return stopHealthPolling
  }
  function stopHealthPolling() {
    if (healthTimer) { clearInterval(healthTimer); healthTimer = null }
  }

  /** 刻意重启:旧 epoch 作废,旧 in-flight 全部 rejected;下次请求以新 epoch 重生。 */
  function restart(reason) {
    rejectAll('restarted')
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
      // ★2026-10-19 P0（可观测性）：暴露**实际在跑的**解释器与命令解析状态。
      //   此前 debug 视图只吐 started/epoch/stats —— 现场排查时必须去 PowerShell 查进程命令行
      //   才能发现「跑的是系统 python」。这三个字段让它一眼可查。
      interpreter: {
        command: String(lastSpawnedCommand || ''),
        source: String(lastCommandSource || ''),
        resolveCount: commandResolveCount,
        resolveFailures: commandResolveFailures,
        requireVerified: resolveOpt('requireVerifiedCommand') === true,
      },
      stderrAlerts: stats.stderrAlerts || 0,
      // ★2026-10-19 P0：长驻进程健康（不是短命探针！面板/诊断应读这一组）。
      health: JSON.parse(JSON.stringify(stats.health)),
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
    stopHealthPolling()
    markExitKind(generation, 'dispose')
    if (child) { try { child.kill() } catch (_) {} }
    child = null
    epoch = null
    for (const [, entry] of [...pending]) settle(entry, { ok: false, code: 'disposed' })
    activationHandlers.clear()
    void reason
  }

  return {
    kind: 'python-sidecar',
    request, notify, health, restart, dispose, debugView,
    // ★2026-10-19 P0：长驻进程健康体检 + 周期巡检（宿主在 engine 装配时接线）。
    checkHealthOnce, startHealthPolling, stopHealthPolling,
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
