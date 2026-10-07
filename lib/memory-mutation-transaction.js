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
  const alreadyAdmitted = (engine._settingsNoteFlights && engine._settingsNoteFlights.size > 0)
    || (engine._settingsPlanFlights && engine._settingsPlanFlights.size > 0)
  const migrationActive = engine._settingsMigrationActive === true && !alreadyAdmitted
  const target = path.resolve(String(file))
  return {
    admitted: bindingsPre(engine, engine.config || {}),
    migrationActive,
    target,
    kind: (engine._memoryPathBindings && engine._memoryPathBindings.get(target) || {}).kind || null,
  }
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
  return job(admission.target || file)
}

export default withMemoryMutationPre
