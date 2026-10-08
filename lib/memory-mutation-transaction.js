import path from 'node:path'

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
  const alreadyAdmitted = (engine._settingsNoteFlights && engine._settingsNoteFlights.size > 0)
    || (engine._settingsPlanFlights && engine._settingsPlanFlights.size > 0)
  const target = path.resolve(String(file))
  const migrationActive = engine._settingsMigrationActive === true && !alreadyAdmitted
  return {
    admitted: bindingsPre(engine, engine.config || {}),
    migrationActive,
    target,
    // ★#305：本次写的受理时刻是否已在迁移窗口内（放行判据只认它，不认全局 flight 存在性）。
    admittedAtWindow: engine._settingsMigrationActive === true,
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
  // ★#305：登记真实 mutation flight（受理时刻、同步），迁移窗口 await 它落盘后才拷新根。
  const reg = registerMemoryMutationFlightPre(engine, target)
  try {
    const out = await job(target)
    // ★#305：**提交时复核持久配置根** —— 受理用的绑定若在本次写期间被改（saveConfig 迁移），
    //   那么「写成功」只发生在**旧根**，而活动配置已指向新根 ⇒ 调用方会收到成功回执却查不到内容。
    //   这是报告者反例的最后一道缺口：drain 是尽力而为（有界，见 drainMemoryMutationFlightsPre），
    //   本复核是**确定性**的兜底 —— 只要根变了就如实报错，绝不给出「成功但内容在旧根」的回执。
    assertDurableRootUnchangedPre(engine, admission, target)
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

export default withMemoryMutationPre
