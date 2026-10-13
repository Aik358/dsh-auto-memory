import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { readConfigSnapshot } from './config-lock.js'
import { memoryWriteLockKey } from './memory-writer.js'

/**
 * ★#249 C02（AUDIT §2.1）：**生产文档 mutation 统一 admission**。
 *
 * 缺陷：迁移只 drain `_settingsNoteFlights` / `_settingsPlanFlights`（那是单条路由自己的
 * 屏障）；`memory_log` / `memory_user` / 沉淀 / 维护 / UI note 等**写者全部未登记** ⇒
 * 迁移窗口内它们照写旧根，迁完就「成功写入但新根不可见」。
 *
 * 本模块把同一判据挂到**所有**生产写盘通道的公共外门上（`writeFull` / `appendText` 及其 raw
 * 档经 MemoryDocumentStore 的 `mutationAdmission` / `mutationBoundary` 收口）：
 *   ① **受理时刻**（入队时，同步）判定迁移窗口 —— 窗口内新写**明确拒绝**
 *      （`SETTINGS_MIGRATION_ACTIVE` / 409），绝不写进正被搬空的旧根；
 *   ② 窗口**之前**已受理的写**照常完成**：受理当刻登记一条 flight，saveConfig 的迁移窗口
 *      `await Promise.all([...flights])` 会等它落盘后再拷贝 ⇒ 内容随迁移进新根
 *      （与 /note、白板既有的 drain 契约同口径）；
 *   ③ 写完成/失败后立即注销自己的 flight ⇒ 迁移不会永久等待，也不会有悬挂条目。
 *
 * 纪律：
 *   ① **零时间依赖**：判据＝「受理时刻标志 + flight 生命周期」，无墙钟超时。
 *   ② **不额外 IO、不取锁**：本边界全同步判定后直通 —— saveConfig 的迁移窗口全程持有
 *      config-lock，而它又要等这些写完成，写再取同一把锁即自我死锁。
 *   ③ 缺省行为与接线前**逐字节一致**：不传 admission/boundary 时是恒等直通。
 *   ④ **不引入 #179 领地**：目录名仍由 `projectDirOf` 的 `wsKey` 决定；本模块只登记
 *      「这次解析出来的目录属于哪个配置根」，不做前缀折叠或哈希改键。
 */
/**
 * ★#345（2026-10-13）：**受理身份的进程内作用域**。
 *
 * 为什么需要它：「本次写是否已受理」原来只能靠**全局集合是否存在 flight** 来推断 ——
 *   那是**授权粒度错误**：只要任意一条与本次写毫无关系的 note/PLAN flight 在窗口内存在，
 *   窗口**之后**才到达的写也会被判为「已受理」而放行，写进正在搬空的旧根。
 * 正解是让「已受理」有**本次请求自己的身份**，而不是全局集合非空。
 *
 * 本模块**不反向依赖任何路由**：身份由调用方（路由）显式登记，本模块只读。
 *   登记方式有两种，**未接线时行为与本模块接线前逐字节一致**（见 captureMemoryMutationPre）：
 *     ① 推荐：`withMemoryAdmissionScopePre(scope, job)` —— 把整段异步写路径包在 scope 里；
 *     ② 兼容：`markMemoryAdmissionPre(engine, {target, key})` 显式打标 + `release()` 注销
 *        （等价于仓库既有 `_settingsNoteFlights` / `_settingsPlanFlights` 的登记/注销生命周期）。
 * 作用域只影响「放行判据」，**不影响**既有 flight 的登记与 drain 语义（#320/#305 的修复不动）。
 */
const admissionScopePre = new AsyncLocalStorage()

/**
 * 在给定身份作用域内执行 job（推荐用法：整段写路径包进来）。
 * @param {{target?:string, key?:string}} scope 身份：target=物理目标、key=路由队列键
 * @param {function} job
 */
export function withMemoryAdmissionScopePre(scope, job) {
  const identity = normalizeAdmissionIdentityPre(scope)
  return admissionScopePre.run(identity, job)
}

/** 把 unaudited 的 scope 形状归一（target 一律走物理队列键，与写入器同口径）。 */
function normalizeAdmissionIdentityPre(scope) {
  const s = scope && typeof scope === 'object' ? scope : {}
  const rawTarget = typeof s.target === 'string' && s.target ? s.target : ''
  let key = ''
  try { key = rawTarget ? memoryWriteLockKey(rawTarget) : (typeof s.key === 'string' ? s.key : '') }
  catch (_) { key = typeof s.key === 'string' ? s.key : '' }
  return { key: key, target: rawTarget }
}

/** 当前作用域内的受理身份（无作用域 ⇒ null）。只读，不产生副作用。 */
export function currentMemoryAdmissionPre() {
  try { return admissionScopePre.getStore() || null } catch (_) { return null }
}

/**
 * ★#345：调用方（路由）显式登记「本次请求自己的已受理身份」。
 *   返回的 release() 幂等；重复调用安全。登记集合挂在 engine 上（与既有 flight 集合同生命周期）。
 *   未调用过本 API 的调用方 ⇒ 集合为空 ⇒ 放行判据回落到接线前的旧语义（逐字不变）。
 */
export function markMemoryAdmissionPre(engine, scope) {
  const identity = normalizeAdmissionIdentityPre(scope)
  if (!identity.key) return { ok: false, reason: 'no-identity', release() {} }
  if (!engine._memoryAdmissionMarks) engine._memoryAdmissionMarks = new Map()
  const marks = engine._memoryAdmissionMarks
  let set = marks.get(identity.key)
  if (!set) { set = new Set(); marks.set(identity.key, set) }
  const token = { at: Date.now() }
  set.add(token)
  let released = false
  return {
    ok: true, key: identity.key,
    release() {
      if (released) return
      released = true
      try {
        const cur = marks.get(identity.key)
        if (cur) { cur.delete(token); if (cur.size === 0) marks.delete(identity.key) }
      } catch (_) { /* 注销绝不抛 */ }
    },
  }
}

/** ★#345：目标作用域内是否确有「本次请求身份」的受理登记（未接线 ⇒ 恒 false）。 */
function hasAdmissionForPre(engine, key) {
  try {
    if (!key) return false
    const marks = engine._memoryAdmissionMarks
    if (marks && marks.get(key) && marks.get(key).size > 0) return true
    return false
  } catch (_) { return false }
}

/** ★#345：路由自己的在途队列键（/note 的 _noteRouteQueues 按 memoryWriteLockKey(target) 键控）。 */
function routeQueueHoldsPre(engine, key) {
  try {
    if (!key) return false
    const q = engine._noteRouteQueues
    if (q && typeof q.get === 'function' && q.get(key)) return true
    return false
  } catch (_) { return false }
}

function bindingsPre(engine, config) {
  return {
    memoryRoot: engine.expandUserPath(config.memoryRoot) || '',
    userMemoryDir: engine.expandUserPath(config.userMemoryDir) || '',
    projectMemoryDir: path.isAbsolute(String(config.projectMemoryDir || '')) ? String(config.projectMemoryDir) : '',
  }
}

/**
 * 登记一个**由配置解析出来的**目的地目录（projectDirOf / userDirOf）。
 * 本仓既有 `wsKey` 语义不动 —— 这里只记录「该目录属于哪个配置根」，供迁移期归属复核与诊断。
 * @returns {string} 目录本身（调用方直接拿去拼文档路径，拼写不变）
 */
export function bindMemoryDirectoryPre(engine, dir, kind = 'project') {
  const abs = path.resolve(String(dir || ''))
  if (!engine._memoryPathBindings) engine._memoryPathBindings = new Map()
  engine._memoryPathBindings.delete(abs)
  engine._memoryPathBindings.set(abs, { kind: kind === 'user' ? 'user' : 'project' })
  while (engine._memoryPathBindings.size > 512) engine._memoryPathBindings.delete(engine._memoryPathBindings.keys().next().value)
  return dir
}

/**
 * 捕获一次 mutation 的 admission 快照（**受理时刻**，必须在同步段内调用）。
 * 未被拒绝的受理会登记一条 flight，并由返回的 `settle()` 在写完成后注销。
 */
export function captureMemoryMutationPre(engine, file) {
  // ★既受理/未受理的区分：该写所属的**路由闸门**在窗口开启前就登记了 flight
  //   （/note 的 _settingsNoteFlights、白板的 _settingsPlanFlights）⇒ 这是"已受理"的写，
  //   照常完成并由 saveConfig 的既有 drain 拷入新根；窗口开启**之后**才到达的写没有这样的
  //   flight ⇒ 一律 409。
  //
  // ★#305（2026-10-08）：**「已受理」不能再靠「全局是否存在 note/PLAN flight」来推断。**
  //   旧判据两个方向都错：
  //     ① 普通 appendText（memory_log / 沉淀 / 维护 / UI note）**从不登记**自己的 flight，
  //        迁移只 drain 那两条路由的 flight ⇒ 已受理的追加没人等 ⇒ 它落在**旧根**，
  //        调用方拿到成功回执，而活动新根没有该内容（报告者的反例）。
  //     ② 反向：只要**任意**一条 note/PLAN flight 在窗口内存在，alreadyAdmitted 就为真 ⇒
  //        与本次写毫无关系的、窗口**之后**才到达的写也被放行 —— 授权粒度是全局的，不是本次写的。
  //   正解：受理时刻**为本次写登记一条真实的 mutation flight**（见 registerMemoryMutationFlightPre），
  //   迁移窗口 await 它们全部落盘；是否放行只看本次写自己的受理时刻（admittedAtWindow）。
  const target = path.resolve(String(file))
  // ★#345（2026-10-13）：「已受理」改成**本次请求自己的身份**，不再看「全局是否存在任意 flight」。
  //   旧判据两个方向都错（见上方 #305 段），#345 又把残留的第二半钉死：
  //     只要**任意一条**无关 note/PLAN flight 在窗口内存在，窗口**之后**才到达的写也被放行 ⇒
  //     它以「已受理」的名义写进正在搬空的旧根，而迁移不会 drain 它（它不是那条 flight 的请求）
  //     ⇒ 调用方拿到成功回执、活动新根里却没有这份内容。
  //   新判据三级（**只认本次请求身份**，且逐级更严格）：
  //     ① 调用方用 withMemoryAdmissionScopePre / markMemoryAdmissionPre 显式登记了身份 ⇒ 有身份才算已受理；
  //     ② 路由自己的在途队列（/note 的 _noteRouteQueues 正是按 memoryWriteLockKey(target) 键控）在本目标上在途
  //        ⇒ 说明本目标确有一条「窗口前发起、仍在途」的请求（该路由是**同步**登记 flight 的，等价身份）；
  //     ③ 都没有 ⇒ 回落到接线前的旧全局判据，**未接线时行为与改前逐字一致**（本仓既有套件仍绿）。
  const identity = currentMemoryAdmissionPre()
  const identityKey = identity && identity.key ? identity.key : ''
  const targetKey = memoryWriteLockKey(target)
  let scopedAdmitted = false
  if (identityKey && identityKey === targetKey) scopedAdmitted = true
  else if (hasAdmissionForPre(engine, targetKey)) scopedAdmitted = true
  else if (routeQueueHoldsPre(engine, targetKey)) scopedAdmitted = true
  const globalAdmitted = (engine._settingsNoteFlights && engine._settingsNoteFlights.size > 0)
    || (engine._settingsPlanFlights && engine._settingsPlanFlights.size > 0)
  // ★#345：**身份信号一旦可用，就不再回落到全局判据** —— 否则「任意无关 flight 存在」仍能放行
  //   一个毫不相干的写（正是本缺陷要消灭的那条路径）。信号可用 = 调用方登记了身份，或本进程确有
  //   在途路由队列/受理标记；都没有（**未接线**）⇒ 回落旧全局判据，行为与接线前逐字一致。
  const scopedSignalsAvailable = !!(identityKey
    || (engine._memoryAdmissionMarks && engine._memoryAdmissionMarks.size > 0)
    || (engine._noteRouteQueues && typeof engine._noteRouteQueues.size === 'number' && engine._noteRouteQueues.size > 0))
  const alreadyAdmitted = scopedSignalsAvailable ? scopedAdmitted : globalAdmitted
  const migrationActive = engine._settingsMigrationActive === true && !alreadyAdmitted
  return {
    admitted: bindingsPre(engine, engine.config || {}),
    migrationActive,
    target,
    // ★#305：本次写的受理时刻是否已在迁移窗口内（放行判据只认它，不认全局 flight 存在性）。
    admittedAtWindow: engine._settingsMigrationActive === true,
    // ★#345：本次放行靠的是「自己的身份」还是「旧全局判据」（供诊断/验收复算）。
    admittedBy: scopedAdmitted ? 'identity' : (globalAdmitted ? 'global-flight' : 'none'),
    kind: (engine._memoryPathBindings && engine._memoryPathBindings.get(target) || {}).kind || null,
  }
}

/**
 * ★#305：迁移窗口的**全局** drain 集合 —— 所有生产写通道（含普通 appendText）在受理时登记，
 * 落盘/失败后注销；saveConfig 迁移前 await 它们全部结束，杜绝「已受理的写落在旧根」。
 *
 * 与 _settingsNoteFlights / _settingsPlanFlights 的分工：那两条是**路由自己的**屏障（还承担
 * 「写者已在锁内等待」等别的语义）；本集合只表达「这次 mutation 还没落盘」，由 mutation 边界
 * **自动**登记，调用方无需配合 ⇒ 不会再有「忘了登记」的通道。
 *
 * 为什么存 promise 而不是计数器：drain 要在**已经受理但尚未落盘**的那一刻就能 await 到它，
 *   promise 天然满足；且 settle 幂等（重复调用不抛、不重复 resolve）。
 */
export function registerMemoryMutationFlightPre(engine, target) {
  if (!engine._memoryMutationFlights) engine._memoryMutationFlights = new Set()
  const flights = engine._memoryMutationFlights
  let settle
  const flight = new Promise((resolve) => { settle = resolve })
  flight.__damTarget = target
  flights.add(flight)
  return {
    flight,
    settle() {
      if (!flights.has(flight)) return
      flights.delete(flight)
      try { settle() } catch (_) { /* 已 settle 过 */ }
    },
  }
}

/**
 * ★#305：等待全部在途 mutation flight 结束（迁移窗口在拷贝新根**之前**调用）。
 *
 * **必须有界**（本仓既有教训：把通用 flight 并入迁移 drain 曾出现「互等不落地」）。
 *   迁移在持有 config-lock 期间调用本函数；若某条写在等 config-lock，硬等就是死锁。
 *   故加超时上限：超时后**不再等**并如实返回 {settled:false}，由调用方决定（迁移继续，
 *   但不会静默丢内容 —— 超时只可能发生在阻塞型宿主里，正常路径远小于该上限）。
 *   返回 {waited, settled}，settled=false 表示有写未在预算内落盘。
 */
export async function drainMemoryMutationFlightsPre(engine, { timeoutMs = 5000 } = {}) {
  const flights = engine._memoryMutationFlights
  if (!flights || flights.size === 0) return { waited: 0, settled: true }
  const pending = Array.from(flights)
  let timer
  // ★注意（本实现踩过）：这里**不能** unref()。unref 的定时器不维持事件循环 ⇒ 当在途写永远
  //   settle 不了时，Node 会在定时器触发前直接退出，drain 的 promise 永远不 resolve
  //   （实测症状：`Detected unsettled top-level await`）。正常收尾由 finally 里的 clearTimeout 保证，
  //   不会因此多留事件循环。
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs) })
  try {
    const out = await Promise.race([
      Promise.all(pending.map((p) => Promise.resolve(p).catch(() => {}))).then(() => 'settled'),
      timeout,
    ])
    return { waited: pending.length, settled: out === 'settled' }
  } finally { try { clearTimeout(timer) } catch (_) {} }
}

function migrationConflict() {
  return Object.assign(new Error('settings-migration-active'), {
    code: 'SETTINGS_MIGRATION_ACTIVE',
    statusCode: 409,
    details: 'Keep the content and retry after migration.',
  })
}

/**
 * 唯一 mutation 边界：受理时刻已在迁移窗口 ⇒ 明确拒绝（409）；否则执行写盘并在完成后注销 flight。
 * @param {object}   engine    引擎实例
 * @param {string}   file      目标文件
 * @param {function} job       实际写盘
 * @param {object}   admission captureMemoryMutationPre 的快照（缺省现取 —— 即"此刻受理"）
 */
export async function withMemoryMutationPre(engine, file, job, admission = captureMemoryMutationPre(engine, file)) {
  if (typeof engine._assertPluginLivePre === 'function') engine._assertPluginLivePre()
  if (admission.migrationActive) throw migrationConflict()
  const target = admission.target || file
  // ★#345：**写前**先复核一次磁盘配置根。为什么提交后只查一次不够：
  //   边界**包不住 job 内部的提交点**（job 自己做 read→render→rename）。若只在 job 之后复核，
  //   根已经变了的情况下内容**仍会先落进旧根**再抛错 —— 那是「写进了非活动根 + 报失败」，
  //   调用方重试时还得面对旧根里那份残留（本次实测：两条文档通道都留下了残留文本）。
  //   写前这道把「受理后、动手前根就变了」这种**主要形态**挡在写盘之前：一个字节都不落；
  //   写后那道继续负责「动手期间才变」的窄窗口，如实报错。两道缺一不可。
  assertDurableDiskRootUnchangedPre(engine, admission, target)
  // ★#305：登记真实 mutation flight（受理时刻、同步），迁移窗口 await 它落盘后才拷新根。
  const reg = registerMemoryMutationFlightPre(engine, target)
  try {
    const out = await job(target)
    // ★#305：**提交时复核持久配置根** —— 受理用的绑定若在本次写期间被改（saveConfig 迁移），
    //   那么「写成功」只发生在**旧根**，而活动配置已指向新根 ⇒ 调用方会收到成功回执却查不到内容。
    //   这是报告者反例的最后一道缺口：drain 是尽力而为（有界，见 drainMemoryMutationFlightsPre），
    //   本复核是**确定性**的兜底 —— 只要根变了就如实报错，绝不给出「成功但内容在旧根」的回执。
    assertDurableRootUnchangedPre(engine, admission, target)
    // ★#345（2026-10-13）：**第二道复核 —— 磁盘上的配置根**。
    //   上面那道比的是 `engine.config`（内存）。跨进程切根时，另一个进程 saveConfig **只改了磁盘**，
    //   本进程的内存 config 毫不知情 ⇒ 第一道复核恒判「未变」，在途追加照样写进旧根并回成功：
    //   记录滞留在旧目录，而活动配置（磁盘）已指向新根（#345 的报告症状）。
    //   故提交边界必须再读一次**磁盘配置**并比对受理时钉住的绑定；变了 ⇒ 与第一道同样抛 409，
    //   绝不谎报成功。读失败/读不到 ⇒ **不改判**（不能因为读不了配置就把正常写全拒了）。
    assertDurableDiskRootUnchangedPre(engine, admission, target)
    return out
  } finally {
    reg.settle()
  }
}

/** ★#305：提交边界复核「这次写用的根」是否仍是当前持久配置的根；变了 ⇒ 结构化 409（不静默成功）。 */
function assertDurableRootUnchangedPre(engine, admission, target) {
  const admitted = admission && admission.admitted
  if (!admitted) return
  let now
  try { now = bindingsPre(engine, engine.config || {}) } catch (_) { return }   // 读配置失败 ⇒ 不改判，交给既有路径
  const changed = ['memoryRoot', 'userMemoryDir', 'projectMemoryDir'].some((k) => String(admitted[k] || '') !== String(now[k] || ''))
  if (!changed) return
  throw Object.assign(new Error('settings-root-changed'), {
    code: 'SETTINGS_ROOT_CHANGED',
    statusCode: 409,
    details: 'The memory root changed while this write was in flight; the content was not committed to the active root. Retry after migration finishes.',
    target,
  })
}

/**
 * ★#345：提交边界复核「**磁盘上的**配置根」是否仍是受理时钉住的那一份。
 *
 * 与 assertDurableRootUnchangedPre 的分工：那道比内存 `engine.config`（同进程 saveConfig 会改它），
 *   本道比**磁盘配置**（跨进程 saveConfig 只改盘，内存毫不知情）。两者都要，缺一即留下
 *   「进程内切根已挡住、跨进程切根仍谎报成功」的半修形态。
 *
 * 纪律：
 *   · **只读、不取锁** —— 迁移全程持有 config-lock，而它又要等本次写完成（drain 本函数的 flight），
 *     此处若去取同一把锁就是自我死锁（与文件头第 ② 条同一理由）。readConfigSnapshot 正是为此存在的
 *     无锁读入口（config-lock.js:110）。
 *   · **读不到/解析失败 ⇒ 不改判**（返回，交给既有路径）：不能因为配置暂时读不了就把正常写全拒了。
 *   · 比对口径与受理时**逐字一致**：同一 bindingsPre（expandUserPath 展开后的 memoryRoot / userMemoryDir /
 *     projectMemoryDir），否则 DSH_HOME 别名会把「物理同根」误判成「换了根」（#222 的老教训）。
 */
function assertDurableDiskRootUnchangedPre(engine, admission, target) {
  const admitted = admission && admission.admitted
  if (!admitted) return
  let disk = null
  try {
    const p = engine && engine._configPath
    if (!p) return
    disk = readConfigSnapshot(p)
  } catch (_) { return }        // 读失败/损坏 ⇒ 不改判（交给既有路径如实报错）
  if (!disk || typeof disk !== 'object') return
  let now
  try {
    // 磁盘配置可能缺键（另一进程只写了 patch）⇒ 用本进程的内存 config 补全后再比对，
    //   与 saveConfig「DEFAULT_CONFIG + durable + 内存」的合并口径同源（index.js:3217）。
    now = bindingsPre(engine, Object.assign({}, engine.config || {}, disk))
  } catch (_) { return }
  const changed = ['memoryRoot', 'userMemoryDir', 'projectMemoryDir'].some((k) => String(admitted[k] || '') !== String(now[k] || ''))
  if (!changed) return
  throw Object.assign(new Error('settings-root-changed-on-disk'), {
    code: 'SETTINGS_ROOT_CHANGED',
    statusCode: 409,
    details: 'The persisted memory root changed (another process migrated it) while this write was in flight; the content was not committed to the active root. Retry after migration finishes.',
    target,
    source: 'disk',
  })
}

export default withMemoryMutationPre
