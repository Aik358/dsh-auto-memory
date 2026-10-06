/**
 * M8 记忆中枢（Memory Hub）持久化 IO —— **带健康度记账的 io 适配器**（#110，2026-09-22）。
 *
 * ── 背景（为什么需要这个模块）──
 * hub 三店（episodes / facts / procedures）的 `io` 由 index.js 内联的 `hubIo()` 提供，
 * 旧实现三个方法各自 `catch (_) {}` 把异常**吞在适配器这一层**：
 *
 *   1. 上层三店在 A-8 里写好的 `try { io.save(snapshot()) } catch (e) { … ok:false … }`
 *      **永远走不到 catch 分支** ⇒ store 照样返回 `{ ok:true, persisted:true }`，
 *      `persistFailures` 恒为 0、`lastPersistError` 恒为 null ⇒ 三条线全绿而磁盘没写上。
 *   2. 用户侧表现为「记忆看着存上了，重启清零」，日志、计数、面板三处都拿不到信号。
 *
 * 现在把这段逻辑从 index.js 提出来，语义收紧为三条：
 *   · `save` / `clear` 失败**照原样抛出**（把「写不进去就是写不进去」交还调用方，
 *     让 A-8 既有的 try/catch 真正生效），**同时**记一次健康度；
 *   · `load` 保持「无文件 / 损坏 → 返回 null（空启动）」的既有控制流不变，只追加可观测性；
 *   · 每次失败都写进 health（errno → 中文人话 + 累计计数 + 时间戳），由
 *     `hubIoHealthSnapshotPre()` 投影给 debugInfo / 诊断面板。
 *
 * 边界（与既有纪律一致）：
 *   · 只做记账与转发，**不改变** 落盘格式、原子性策略（tmp + rename）与任何调用方契约；
 *   · 不引入时钟依赖以外的副作用；`onError` 回调抛错不得影响主路径（自身 try/catch 包住）；
 *   · 不做 unlink/copy 回退：调用方各自保留自己的原子性策略（同 `fs-retry.js` 的边界声明）。
 */

import { mkdirSync, writeFileSync, renameSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { withConfigLockSync } from './config-lock.js'
import { pathKey } from './file-boundary.js'
import { copyProcedureSnapshotPre, mergeProcedureSnapshotPre, sameProcedureRowsPre } from './procedure-snapshot-transaction.js'
import path from 'node:path'

/** errno → 人话。口径：暴露给前端/工具的原因必须人能看懂，不能只甩机器码。 */
export const HUB_IO_ERRNO_MESSAGES_PRE_V1 = Object.freeze({
  EACCES: '权限被拒绝（目标目录不可写）',
  EPERM: '操作被系统拒绝（权限或安全策略拦截，Windows 下也常见于文件被占用）',
  ENOSPC: '磁盘空间不足',
  EROFS: '目标位于只读位置',
  EBUSY: '文件被其它进程占用',
  ENOENT: '路径不存在（父目录缺失）',
  EISDIR: '该名字被一个目录占着，不是文件',
  ENOTDIR: '路径中间有一段不是目录',
  EEXIST: '临时文件已存在',
  ENAMETOOLONG: '路径过长',
  EMFILE: '进程打开的文件过多',
  EIO: '底层读写错误（磁盘或驱动）',
})

/** 把任意异常翻成一句人话（带 errno 便于排障；无 code 时回落 message）。 */
export function explainHubIoErrorPre(e) {
  const code = e && e.code ? String(e.code) : ''
  const mapped = code ? HUB_IO_ERRNO_MESSAGES_PRE_V1[code] : ''
  if (mapped) return mapped + '（' + code + '）'
  if (code) return '文件系统错误 ' + code
  return String((e && e.message) || e || '未知错误')
}

/** 新建一份健康度台账（纯内存，零 IO）。 */
export function createHubIoHealthPre() {
  return { errors: 0, lastError: null, lastErrorAt: 0, saves: 0, loads: 0, clears: 0, byFile: {} }
}

/**
 * 记一次失败，并调用 `onError(key, message)`（节流由调用方决定，本模块不持有定时器）。
 * @returns {string} 人话原因
 */
function notePre(health, name, op, e, onError) {
  const now = Date.now()
  const human = explainHubIoErrorPre(e)
  health.errors += 1
  health.lastError = name + ' ' + op + ' 失败：' + human
  health.lastErrorAt = now
  const key = name + ':' + op
  const rec = health.byFile[key] || { count: 0, lastError: null, lastErrorAt: 0 }
  rec.count += 1
  rec.lastError = human
  rec.lastErrorAt = now
  health.byFile[key] = rec
  if (typeof onError === 'function') {
    try { onError(key, 'M8 hub 持久化失败 —— ' + health.lastError + '（累计 ' + health.errors + ' 次）') } catch (_) { /* 记账不得影响主路径 */ }
  }
  return human
}

/**
 * 造一个 hub io 适配器工厂。
 * @param {{dir:string, health?:object, onError?:Function, fsApi?:object}} opts
 *        `fsApi` 注入点仅供测试（故障注入），缺省用 node:fs 同步 API。
 * @returns {(name:string) => {save:Function, load:Function, clear:Function}}
 */
export function createHubIoPre(opts = {}) {
  const dir = String(opts.dir || '')
  const health = opts.health || createHubIoHealthPre()
  const onError = opts.onError
  const api = opts.fsApi || null
  const mk = (api && api.mkdirSync) || mkdirSync
  const wf = (api && api.writeFileSync) || writeFileSync
  const rn = (api && api.renameSync) || renameSync
  const rf = (api && api.readFileSync) || readFileSync
  const rm = (api && api.rmSync) || rmSync

  // ★#110（2026-09-22）：**批内合并落盘**（消除写放大）。
  //   背景：hub 一次喂数会连续写同一份快照 N 次（每行判据 upsert 一次 ⇒ 一次整份写盘）。
  //   做法：批内只记「最后一次的整份数据」，批末统一原子落盘。**语义无损**——每份快照都是全量，
  //   最后一次即最终状态；store 的内存态始终最新，落盘只是它的投影。
  //   明确声明的代价：批未落盘时进程被杀，本批持久化会丢。这批是「机器切出来的流程观察行」，
  //   源头 judgement-shadow 文件仍在、可重放，**不涉及用户数据**。
  //   失败**不静默**：逐文件记 health（含 errno 人话）并走 onError；返回值把 ok/written/errors 交出去。
  let batchDepth = 0
  const pendingWrites = new Map() // filePath → { name, data }

  function atomicWrite(file, name, data) {
    mk(dir, { recursive: true })
    const tmp = file + '.tmp'
    wf(tmp, JSON.stringify(data), 'utf8')
    rn(tmp, file)
  }
  function flushPendingPre() {
    let written = 0
    let ok = true
    for (const [file, rec] of pendingWrites) {
      // ★ 2026-10-02 审计修复批 issue #172：原 catch 为空 ⇒ 批末落盘失败既不记 health 也不走 onError，
      //   面板/健康度全盲、HTTP 面假成功（本模块 :104 契约明言「失败不静默」）。
      //   与非批 save 路径(:137)同口径：先 notePre 记健康度，再由 ok=false 交给调用方。
      try { atomicWrite(file, rec.name, rec.data); written++ } catch (e) { ok = false; notePre(health, rec.name, 'save', e, onError) }
    }
    pendingWrites.clear()
    return { ok, written, errors: health.errors }
  }

  const factory = (name) => {
    const file = path.join(dir, String(name))
    return {
      /**
       * 原子写（tmp + rename）。失败**记健康度后原样抛出** —— 上层 A-8 的 try/catch 依赖这一点。
       * 批内（beginBatch 之后 endBatch 之前）改为**只登记不落盘**，批末一次写。
       */
      save(data) {
        health.saves += 1
        if (batchDepth > 0) { pendingWrites.set(file, { name, data }); return }
        try {
          atomicWrite(file, name, data)
        } catch (e) {
          notePre(health, name, 'save', e, onError)
          throw e
        }
      },
      /**
       * 读取。保持既有语义：无文件 / 损坏一律返回 null（空启动，fail closed 幂等恢复）；
       * 只有「非 ENOENT 的读取失败」与「JSON 解析失败」才记健康度。
       */
      load() {
        health.loads += 1
        let raw
        try {
          raw = rf(file, 'utf8')
        } catch (e) {
          if (!(e && e.code === 'ENOENT')) notePre(health, name, 'load', e, onError)
          return null
        }
        try {
          return JSON.parse(raw)
        } catch (e) {
          notePre(health, name, 'parse', e, onError)
          return null
        }
      },
      /** 删除。失败**记健康度后原样抛出**（残留快照会在下次 load 时"复活"已清空的数据）。 */
      clear() {
        health.clears += 1
        // 批内 clear 必须先取消该文件的待写，否则批末会把刚删掉的快照又写回来。
        pendingWrites.delete(file)
        try { rm(file, { force: true }) } catch (e) { notePre(health, name, 'clear', e, onError); throw e }
      },
    }
  }
  // ── 批控制（挂在工厂函数上，调用方：`hubIo.beginBatch()` / `hubIo.endBatch()`）──
  factory.beginBatch = () => { batchDepth += 1; return batchDepth }
  factory.endBatch = () => {
    if (batchDepth > 0) batchDepth -= 1
    if (batchDepth > 0) return { ok: true, written: 0, errors: health.errors, deferred: true }
    return flushPendingPre()
  }
  factory.flushBatch = () => flushPendingPre()
  factory.batchPending = () => pendingWrites.size
  return factory
}

/**
 * 健康度只读投影（供 debugInfo / 诊断面板）。
 * 纪律：只出计数 + 人话原因 + 时间戳，**无路径、无原文**；任何异常都不得打断诊断。
 */
export function hubIoHealthSnapshotPre(health) {
  const empty = { errors: 0, lastError: null, lastErrorAt: null, saves: 0, loads: 0, clears: 0, byFile: {}, verdict: 'ok', summary: '三层记忆已正常落盘（本轮无写入失败）' }
  try {
    if (!health || typeof health !== 'object') return empty
    const byFile = {}
    const src = (health.byFile && typeof health.byFile === 'object') ? health.byFile : {}
    for (const k of Object.keys(src)) {
      const r = src[k] || {}
      byFile[k] = {
        count: Number(r.count) || 0,
        lastError: r.lastError ? String(r.lastError) : null,
        lastErrorAt: Number(r.lastErrorAt) || null,
      }
    }
    const errors = Number(health.errors) || 0
    return {
      errors,
      lastError: health.lastError ? String(health.lastError) : null,
      lastErrorAt: Number(health.lastErrorAt) || null,
      saves: Number(health.saves) || 0,
      loads: Number(health.loads) || 0,
      clears: Number(health.clears) || 0,
      byFile,
      verdict: errors === 0 ? 'ok' : 'io-error',
      summary: errors === 0
        ? '三层记忆已正常落盘（本轮无写入失败）'
        : '三层记忆有 ' + errors + ' 次落盘/读取失败，最近一次：' + String(health.lastError || '') + '。记忆可能只在内存里，重启会丢。',
    }
  } catch (_) {
    return empty
  }
}

/**
 * ★M8-B（2026-09-23 用户拍板，方案甲）：**procedure 双库 IO —— 合并读 + 按 scope 分派写**。
 *
 * ── 为什么单独做一层 ──
 * `createHubIoPre` 是**三店共用**的通用适配器（episodes / facts / procedures）。给它加作用域语义
 * 会顺带改变另两店行为。故作用域只在本层实现，**只给 procedures 用**；另两店仍走原路径，
 * 行为逐字节不变。
 *
 * ── 落点（与 migrate-pack 既有分层对齐）──
 *   · 通用库（跨工作区）   = `<globalDir>/<name>`（既有 55 条所在，原地不动）
 *   · 工作区库（本工作区） = `<resolveWorkspace().dir>/<name>`（新增）
 *
 * ── 三条硬约束 ──
 *   ① **工作区目录必须惰性解析**：hub 在**引擎构造期**就建好（index.js 的 hubDir 同为构造期常量），
 *      而工作区 state.ws 要等 _doRefresh 才赋值 ⇒ 构造期缓存会锁死空工作区，
 *      随后 save 就可能把**空集**写进工作区库（灾难性覆盖）。故每次调用都现算。
 *   ② **路径未知一律不写工作区库**：宁可这一轮不落盘（内存态仍完整、下轮再写），
 *      也绝不用空集/错集覆盖用户的工作区技能库。所有跳过都**可见**（返回值 + health 记账）。
 *   ③ **读坏过的文件不覆盖**：load 时「文件存在却解析失败」记入 corrupt 集，save 对这类文件**拒写**。
 *      既有实现在「快照损坏 → load 返回 null → 内存空 → 下次 save 整份覆盖」下会**静默清空全部条目**；
 *      双库把这一暴露面翻倍，故在此收紧为「宁可不写」。
 *
 * ── 明确声明的取舍 ──
 *   procedures 的 save **不参与** createHubIoPre 的批内合并（批深度由 hub 侧的通用工厂持有，
 *   本层看不到）⇒ 批内每次 persist 都是一次整份原子写。这是**刻意选择**：本轮刚因「机器定时回写」
 *   付出过代价，宁可多写几次也不引入新的延迟写盘通道；数据量有界（当前 55 条 / 约 100KB）。
 *   若日后实测写放大成问题，再单独评估合并策略 —— **不要顺手加定时器**。
 *
 * @param {object} opts
 * @param {string}   opts.globalDir                  通用库目录（必填）
 * @param {string}  [opts.name='procedures.json']     文件名
 * @param {function} opts.resolveWorkspace           () => {dir,key}；未知时给空串（必填）
 * @param {function} [opts.isWorkspaceScoped]        (entry) => boolean；缺省 scope==='workspace'
 * @param {object}  [opts.health]                    复用 createHubIoHealthPre() 台账
 * @param {function} [opts.onError]                  (key,msg) 失败回调
 * @param {object}  [opts.fsApi]                     测试注入（透传给 createHubIoPre）
 * @returns {{save:Function, load:Function, clear:Function, lastWrite:Function, isCorrupt:Function}}
 */
export function createScopedHubIoPre(opts = {}) {
  const globalDir = String(opts.globalDir || '')
  const fileName = String(opts.name || 'procedures.json')
  const health = opts.health || createHubIoHealthPre()
  const onError = opts.onError
  const resolveWorkspace = typeof opts.resolveWorkspace === 'function'
    ? opts.resolveWorkspace
    : () => ({ dir: '', key: '' })
  const isWs = typeof opts.isWorkspaceScoped === 'function'
    ? opts.isWorkspaceScoped
    : (e) => !!(e && e.scope === 'workspace')

  // 每目录一个既有工厂（复用其原子写与 health 记账；不新建第二套 IO 实现）
  const factories = new Map()
  function ioFor(dir) {
    let f = factories.get(dir)
    if (!f) { f = createHubIoPre({ dir, health, onError, fsApi: opts.fsApi }); factories.set(dir, f) }
    return f
  }
  const corrupt = new Set()
  const baselines = new Map()
  const baseKey = dir => pathKey(path.join(dir, fileName))
  const empty = () => ({ schemaVersion: 1, procedures: [] })
  const baseline = dir => baselines.get(baseKey(dir)) || empty()
  const remember = (dir, snapshot) => baselines.set(baseKey(dir), copyProcedureSnapshotPre(snapshot))
  function locks(dirs, job) {
    const files = [...new Map(dirs.filter(Boolean).map(dir => [baseKey(dir), path.join(dir, fileName)])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, file]) => file)
    const acquire = i => i === files.length ? job() : withConfigLockSync(files[i], () => acquire(i + 1), { reentrant: false })
    return acquire(0)
  }
  // ★A-1c①②（2026-10-06，#231）：**「本次迁移真改过哪些库」的凭据**。
  //   缺陷现场：rollbackBoth() 无条件把两库都按「迁移前快照」写回，而 readOne 对损坏库返回 null
  //   ⇒ snapOf(null) 得 null ⇒ 字面量 `{schemaVersion:1,procedures:[]}` 落地，**空库覆盖损坏原件**
  //   （原字节不可恢复），且因为绕过 scoped save 而绕过了 corrupt 拒写。
  //   现改为：只有本函数**真的写过**的库才进这个集合；回滚只回滚集合里的库 ⇒ 没碰过的库
  //   「一个字节都不动」（这是 #231 验收要的 sha256 逐字节不变）。
  const dirty = new Set()
  let last = {
    at: 0, wroteGlobal: false, wroteWorkspace: false,
    skippedUnknownWs: 0, skippedForeign: 0, refusedCorrupt: 0, foreignIds: [],
  }

  /** 取当前工作区 {dir,key}；任何异常都退化为「未知」⇒ 走约束②不写。 */
  function wsNow() {
    try {
      const r = resolveWorkspace() || {}
      return { dir: String(r.dir || ''), key: String(r.key || '') }
    } catch (e) {
      notePre(health, fileName, 'resolve-ws', e, onError)
      return { dir: '', key: '' }
    }
  }

  /** 读一份；「文件存在但解析失败 ⇒ null」记入 corrupt（供 save 拒写），并置 dirty=false。 */
  function readOne(dir) {
    const file = path.join(dir, fileName)
    const data = ioFor(dir)(fileName).load()
    let existed
    try { existed = existsSync(file) } catch (_) { existed = false }
    if (data === null && existed) corrupt.add(dir)
    else if (data !== null && (!data || data.schemaVersion !== 1 || !Array.isArray(data.procedures))) corrupt.add(dir)
    else corrupt.delete(dir)
    if (!existed) { try { dirty.delete(dir) } catch (_) {} }
    return data
  }

  function load(options = {}) {
    const w = wsNow()
    return locks([globalDir, w.dir], () => loadLocked(options, w))
  }

  function loadLocked(options, w) {
    const g = readOne(globalDir)
    const wsData = w.dir ? readOne(w.dir) : null
    if (corrupt.has(globalDir) || (w.dir && corrupt.has(w.dir))) throw Object.assign(new Error('library corrupt; reload refused'), { code: 'DAM-CORRUPT-LIBRARY' })
    const pending = options.pendingSnapshot
    const authority = new Set(options.authoritativeIds || [])
    const pendingFor = dir => {
      const selected = (pending?.procedures || []).filter(p => dir === globalDir ? !isWs(p) : isWs(p) && (!p.workspaceRef || !w.key || p.workspaceRef === w.key))
      // Scope migration owns these rows; do not replay an old pending copy.
      const old = baseline(dir)
      return { ...pending, procedures: selected.filter(p => !authority.has(p.procedureId)).concat((old.procedures || []).filter(p => authority.has(p.procedureId))) }
    }
    const mergedG = pending ? mergeProcedureSnapshotPre(baseline(globalDir), pendingFor(globalDir), g || empty()) : g
    const mergedW = pending && w.dir ? mergeProcedureSnapshotPre(baseline(w.dir), pendingFor(w.dir), wsData || empty()) : wsData
    remember(globalDir, g || empty())
    if (w.dir) remember(w.dir, wsData || empty())
    const gp = mergedG?.procedures || []
    const wp = mergedW?.procedures || []
    const foreign = (pending?.procedures || []).filter(p => isWs(p) && (!w.dir || (p.workspaceRef && w.key && p.workspaceRef !== w.key)) && !authority.has(p.procedureId))
    const any = g || wsData
    if (!any && !gp.length && !wp.length && !foreign.length) return null
    if (!gp.length && !wp.length && !foreign.length) return Object.assign({}, any, { procedures: [] })
    // 同 id 去重：**工作区优先**（更具体的一侧胜出）
    const byId = new Map()
    for (const p of gp) byId.set(String(p && p.procedureId), p)
    for (const p of wp) byId.set(String(p && p.procedureId), p)
    for (const p of foreign) byId.set(String(p.procedureId), p)
    return {
      schemaVersion: (g && g.schemaVersion) || (wsData && wsData.schemaVersion) || 1,
      namespace: (g && g.namespace) || (wsData && wsData.namespace) || undefined,
      policyVersion: (g && g.policyVersion) || (wsData && wsData.policyVersion) || undefined,
      savedAt: Date.now(),
      procedures: [...byId.values()],
    }
  }

  /**
   * ★A-1c③（2026-10-06，#231）：**受保护的单库写** —— scoped save 与迁移回滚共用这一条写路径。
   * 约束（两条都是 #231 直接要的）：① `corrupt` 库一律拒写（宁可不动，也绝不用空库覆盖原件）；
   * ② 失败记 health 后原样抛出，由调用方收口成 failures / 可见结果。
   * 为什么必须有它：`rollbackBoth` 此前直接调 `ioFor(dir)(fileName).save(...)`，是一条
   * **绕过 corrupt 拒写的第二裸写通道** —— 它既会把坏库原件覆盖成空库，又会在下一轮 `readOne`
   * 里因「文件已变成合法空库」把 corrupt 洗白（readOne 的 `corrupt.delete(dir)`）⇒ 拒写保护被永久解除。
   */
  function writeLibGuarded(dir, snapshot) {
    if (!dir) throw Object.assign(new Error('library dir unresolved'), { code: 'DAM-WS-UNKNOWN' })
    if (corrupt.has(dir)) throw Object.assign(new Error('library corrupt, write refused'), { code: 'DAM-CORRUPT-LIBRARY' })
    try {
      ioFor(dir)(fileName).save(snapshot)
    } catch (e) {
      try { (opts.fsApi?.rmSync || rmSync)(path.join(dir, fileName) + '.tmp', { force: true }) } catch (_) {}
      dirty.delete(dir)   // 写失败 ⇒ 本库未被本次流程改动 ⇒ 回滚不得碰它（这正是 #231 的损毁路径）
      throw e
    }
    dirty.add(dir)   // ★A-1c①：写成功才记「本库被本次流程改过」，回滚凭据只认它
  }

  function commitDelta(dir, local) {
    return locks([dir], () => {
      const fresh = readOne(dir) || empty()
      if (corrupt.has(dir)) throw Object.assign(new Error('library corrupt, write refused'), { code: 'DAM-CORRUPT-LIBRARY' })
      const merged = mergeProcedureSnapshotPre(baseline(dir), local, fresh)
      if (!sameProcedureRowsPre(merged, fresh)) writeLibGuarded(dir, merged)
      // The store retains its submitted snapshot. Remember that local view,
      // rather than teaching an absent remote row to the next save as a delete.
      remember(dir, local)
    })
  }

  function save(snapshot) {
    if (!snapshot || snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.procedures)) return { ok: false, error: 'invalid procedure snapshot; library preserved' }
    const all = (snapshot && Array.isArray(snapshot.procedures)) ? snapshot.procedures : []
    const w = wsNow()
    const globals = []
    const mine = []
    const foreign = []
    for (const p of all) {
      if (!isWs(p)) { globals.push(p); continue }
      const ref = String((p && p.workspaceRef) || '')
      // 归属本工作区；ref 缺失时按「当前库」保守处理（不丢用户刚写的条目）
      if (!ref || !w.key || ref === w.key) mine.push(p)
      else foreign.push(p)
    }
    // 约束③：读坏过的文件拒写（宁可不动，也不静默清空）
    let refused = 0
    // ★A-1a（2026-10-06，#227 第二层缺陷，逐 hunk 移植自 PR#230）：**写失败必须可见**。
    //   旧实现两处 `catch (_) { wroteX = false }` 把内层失败吞在适配器这一层，与
    //   createHubIoPre.save 的 :131 契约（「失败记健康度后原样抛出」）自相矛盾 ⇒
    //   上层 procedure-store 的 A-8 失败侦测（try/catch + persistFailures）**永不触发**，
    //   探针实测 ENOSPC 下 persistFailures 恒为 0、工具仍回「已写入」。
    //   现改为：逐库收集 failures，ok 由 failures 是否为空决定，error 给人话原因；
    //   procedure-store 侧据 `ok === false` 判定失败（见其 persist() 的同批改动）。
    const failures = []
    let wroteGlobal = false
    if (corrupt.has(globalDir)) {
      refused += globals.length
      failures.push({ scope: 'global', reason: 'corrupt-library' })
    } else {
      try {
        commitDelta(globalDir, Object.assign({}, snapshot, { procedures: globals }))
        wroteGlobal = true
      } catch (e) { failures.push({ scope: 'global', reason: 'write-failed', error: String((e && e.message) || e) }) }
    }
    let wroteWorkspace = false
    if (!w.dir) {
      // 约束②：路径未知 ⇒ 不写工作区库（不抛错，但必须可见）
      if (mine.length) {
        notePre(health, fileName, 'ws-unknown', new Error('工作区目录未解析：工作区库未写入，' + mine.length + ' 条留在内存，下轮再写'), onError)
        failures.push({ scope: 'workspace', reason: 'ws-unknown' })
      }
    } else if (corrupt.has(w.dir)) {
      refused += mine.length
      failures.push({ scope: 'workspace', reason: 'corrupt-library' })
    } else {
      try {
        commitDelta(w.dir, Object.assign({}, snapshot, { procedures: mine }))
        wroteWorkspace = true
      } catch (e) { failures.push({ scope: 'workspace', reason: 'write-failed', error: String((e && e.message) || e) }) }
    }
    // 归属别的库的条目（foreign-workspace）本次一件都没写：它是「跳过」而非「失败」的中间态，
    // 但**绝不能**因它让 ok 为真 —— 否则调用方会以为这一批全写进去了。
    if (foreign.length) failures.push({ scope: 'workspace', reason: 'foreign-workspace' })
    last = {
      at: Date.now(), wroteGlobal, wroteWorkspace,
      skippedUnknownWs: w.dir ? 0 : mine.length,
      skippedForeign: foreign.length,
      refusedCorrupt: refused,
      foreignIds: foreign.map((p) => String(p && p.procedureId)).slice(0, 5),
      failures,
    }
    const error = failures.map((f) => f.scope + ': ' + (f.error || f.reason)).join('; ')
    return Object.assign({ ok: failures.length === 0, ...(error ? { error } : {}) }, last)
  }

  function clear() {
    const w = wsNow()
    try {
      return locks([globalDir, w.dir], () => {
        const dirs = [...new Set([globalDir, w.dir].filter(Boolean))]
        // Whole-library clear is a compare-and-swap, not a stale bulk delete.
        for (const dir of dirs) {
          const fresh = readOne(dir) || empty()
          if (corrupt.has(dir) || !sameProcedureRowsPre(fresh, baseline(dir))) throw new Error('procedure-clear-conflict: reload the library before clearing')
        }
        for (const dir of dirs) ioFor(dir)(fileName).clear()
        for (const dir of dirs) { remember(dir, empty()); corrupt.delete(dir) }
        return { ok: true }
      })
    } catch (e) { notePre(health, fileName, 'clear', e, onError); return { ok: false, error: String(e.message || e) } }
  }


  /**
   * ★M8-B 第4步：**两阶段迁移**（写接收库 → 读回校验 → 写捐赠库 → 读回校验；任一失败整体回滚）。
   *
   * 为什么必须两阶段：跨文件移动**不是原子的**。写目标成功、删源失败 ⇒ 条目复制成两份；
   * 反序则更糟——删源成功、写目标失败 ⇒ **条目直接消失**。故这里定死两条：
   *   ① **先写接收库、后写捐赠库**——失败时最坏是「多留一份」而非「丢一份」，
   *      即 **fail toward duplication, never toward loss**（可见、可重试、可人工清理）。
   *   ② 每写一步就**读回校验**，不是写完就当成功（写盘函数的返回不等于内容真落对）。
   * 任一步校验不过：把两库恢复到**迁移前快照**，并如实返回 rolledBack。
   *
   * @param {Array<{procedureId:string, scope:string, workspaceRef?:string}>} entries 目标归属
   * @param {function} [onProgress] (done,total,item) —— 进度是两阶段提交的**可见化**
   * @returns {{ok:boolean,total:number,moved:number,failed:number,rolledBack:boolean,results:Array}}
   */
  function migrate(entries, onProgress) {
    const w = wsNow()
    try { return locks([globalDir, w.dir], () => migrateLocked(entries, onProgress)) }
    catch (e) { return { ok: false, total: Array.isArray(entries) ? entries.length : 1, moved: 0, failed: Array.isArray(entries) ? entries.length : 1, rolledBack: false, error: String(e.message || e), results: [] } }
  }

  function migrateLocked(entries, onProgress) {
    const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean)
    const total = list.length
    const results = []
    let moved = 0
    let failed = 0
    let rolledBack = false
    const w = wsNow()

    // 回滚凭据：两库**迁移前**的解析快照（null = 该库无文件/为空；损坏库已被 readOne 记入 corrupt）
    const globalBefore = readOne(globalDir)
    const wsBefore = w.dir ? readOne(w.dir) : null

    // ★A-1c④（2026-10-06，#231）：**入口整批拒绝** —— 任一库损坏 ⇒ 一条都不迁、一个字节都不写。
    //   为什么必须在入口拦：迁移是「写接收库 → 读回校验 → 写捐赠库」的两阶段流程，坏库一旦进入
    //   流程，失败回滚就会撞上「用空快照覆盖原件」这条数据损毁路径（见 rollbackBoth 的缺陷现场）。
    //   带上库名（库标识不是磁盘路径，前端据此显示「哪个库坏了」）便于用户先人工处置坏文件。
    {
      const bad = []
      if (corrupt.has(globalDir)) bad.push('global')
      if (w.dir && corrupt.has(w.dir)) bad.push('workspace')
      if (bad.length) {
        last = Object.assign({}, last, {
          at: Date.now(), migrated: 0, migrateFailed: total, rolledBack: false, corruptLibraries: bad,
        })
        return {
          ok: false, total, moved: 0, failed: total, rolledBack: false,
          refused: true, reason: 'library-corrupt', corruptLibraries: bad, results: [],
        }
      }
    }

    // 回滚凭据②：迁移会**真的写**两个库，故把它们登记为 dirty；写失败时 scoped save 内部已
    // 把失败的库移出 dirty ⇒ 回滚只覆盖「确实被改过」的那一个（未改动的库保持逐字节不变）。
    dirty.add(globalDir)
    if (w.dir) dirty.add(w.dir)
    // 深拷一份作为回滚源，避免后续 map 改动污染凭据
    const snapOf = (x) => (x && Array.isArray(x.procedures))
      ? Object.assign({}, x, { procedures: x.procedures.map((p) => Object.assign({}, p)) })
      : null

    /**
     * ★A-1c（2026-10-06，#231 四修）—— 回滚只做「还原」，绝不做「清空」：
     *   ① 只回滚 **dirty 集合里**的库（本次流程真写过的）—— 没碰过的库一个字节都不动；
     *   ② corrupt 库**拒绝回滚**（它是坏的，不是空的；宁可留坏文件等人工处置，也不覆盖成空库）；
     *   ③ 走 writeLibGuarded（= scoped save 的同一受保护写路径），受 corrupt 拒写与 health 记账约束；
     *   ④ 快照为 null（该库本就无文件）⇒ **拒绝**而非落空库：没有可还原的内容时，唯一安全的动作是什么都不做。
     *   返回 { ok, skipped }：ok=false 表示「有库没能还原」（调用方据此把 rolledBack 如实置假）；
     *   skipped 逐库说明为什么没动它 —— 失败必须可见，不许报虚假的 rolledBack:true。
     */
    function rollbackBoth() {
      let ok = true
      const skipped = []
      const restore = (dir, snap, label) => {
        if (!dir) return
        if (!dirty.has(dir)) { skipped.push(label + ':not-written'); return }
        if (corrupt.has(dir)) { skipped.push(label + ':corrupt'); ok = false; return }
        const s = snapOf(snap)
        if (!s) { skipped.push(label + ':no-snapshot'); ok = false; return }
        try { writeLibGuarded(dir, s) }
        catch (e) { ok = false; skipped.push(label + ':failed'); notePre(health, fileName, 'migrate-rollback-' + label, e, onError) }
      }
      restore(globalDir, globalBefore, 'global')
      if (w.dir) restore(w.dir, wsBefore, 'ws')
      return { ok, skipped }
    }

    // 以「迁移前快照」为工作副本，逐条改归属；两条目的条目集合由 scope 决定
    let gList = (globalBefore && Array.isArray(globalBefore.procedures)) ? globalBefore.procedures.map((p) => Object.assign({}, p)) : []
    let wList = (wsBefore && Array.isArray(wsBefore.procedures)) ? wsBefore.procedures.map((p) => Object.assign({}, p)) : []
    const findIn = (arr, id) => arr.findIndex((p) => String(p && p.procedureId) === String(id))

    for (let i = 0; i < list.length; i++) {
      const it = list[i] || {}
      const id = String(it.procedureId || '')
      const targetScope = it.scope === 'workspace' ? 'workspace' : 'global'
      const targetRef = String(it.workspaceRef || '')
      const tag = { procedureId: id, targetScope, targetRef }
      // 目标库落地检查：要进工作区库但工作区未知 ⇒ 明确失败（绝不猜一个目录写下去）
      if (targetScope === 'workspace' && (!w.dir || !w.key)) {
        failed++
        results.push(Object.assign({ ok: false, reason: 'ws-unknown' }, tag))
        if (onProgress) onProgress(i + 1, total, results[results.length - 1])
        continue
      }
      if (targetScope === 'workspace' && targetRef && targetRef !== w.key) {
        failed++
        results.push(Object.assign({ ok: false, reason: 'foreign-workspace' }, tag))
        if (onProgress) onProgress(i + 1, total, results[results.length - 1])
        continue
      }
      // 定位源（两库都找）
      let gi = findIn(gList, id)
      let wi = findIn(wList, id)
      // ★双库同 id：先按 `load()` 的**既有读优先级（工作区优先）**去重，维持「一个 id 只住在一个库」。
      //   不做这步的实测后果：接收库那条留着、又从捐赠库推一条进来 ⇒ 同一 id 两份
      //   —— 正是两阶段迁移专门要防的「复制成两份」，静态检查与语法检查都发现不了。
      if (gi >= 0 && wi >= 0) { gList.splice(gi, 1); gi = findIn(gList, id) }
      const src = gi >= 0 ? 'global' : (wi >= 0 ? 'workspace' : null)
      if (!src) {
        failed++
        results.push(Object.assign({ ok: false, reason: 'not-found' }, tag))
        if (onProgress) onProgress(i + 1, total, results[results.length - 1])
        continue
      }
      if (src === targetScope) {
        // 已在目标库：只把 workspaceRef 校正到位（幂等，不动位置）
        const arr = src === 'global' ? gList : wList
        const idx = src === 'global' ? gi : wi
        arr[idx].scope = targetScope
        if (targetScope === 'workspace') arr[idx].workspaceRef = w.key
        moved++
        results.push(Object.assign({ ok: true, noop: true, from: src, to: targetScope }, tag))
        if (onProgress) onProgress(i + 1, total, results[results.length - 1])
        continue
      }
      // 迁移：先改内存副本
      const entry = src === 'global' ? gList.splice(gi, 1)[0] : wList.splice(wi, 1)[0]
      entry.scope = targetScope
      entry.workspaceRef = targetScope === 'workspace' ? w.key : ''
      const receiving = targetScope === 'workspace' ? wList : gList
      const donating = targetScope === 'workspace' ? gList : wList
      receiving.push(entry)

      // 两阶段提交
      const recvDir = targetScope === 'workspace' ? w.dir : globalDir
      const donDir = targetScope === 'workspace' ? globalDir : w.dir
      const recvSnap = { schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: receiving }
      const donSnap = { schemaVersion: 1, namespace: 'dsh-auto-memory-pre', procedures: donating }
      let step = 'write-receiving'
      let stepOk = false
      try {
        // ★A-1c③：两阶段写一律走受保护的写路径（corrupt 拒写 + 失败移出 dirty + health 记账）。
        if (corrupt.has(recvDir)) throw new Error('receiving library corrupt: ' + recvDir)
        writeLibGuarded(recvDir, recvSnap)
        step = 'verify-receiving'
        const back = ioFor(recvDir)(fileName).load()
        const hit = back && Array.isArray(back.procedures) && back.procedures.some((p) => String(p.procedureId) === id && (p.scope || 'global') === targetScope)
        if (!hit) throw new Error('receiving verify failed')
        step = 'write-donating'
        if (corrupt.has(donDir)) throw new Error('donating library corrupt: ' + donDir)
        writeLibGuarded(donDir, donSnap)
        step = 'verify-donating'
        const back2 = ioFor(donDir)(fileName).load()
        const stillThere = back2 && Array.isArray(back2.procedures) && back2.procedures.some((p) => String(p.procedureId) === id)
        if (stillThere) throw new Error('donating verify failed (still present)')
        stepOk = true
      } catch (e) {
        notePre(health, fileName, 'migrate-' + step, e, onError)
        // ★A-1c（#231 加强项）：把「损坏前置拒绝」与「本条失败」在**返回体上**区分开。
        //   语义差别是实打实的：前者调用方不该重试（先修库文件），后者可以重试。
        //   这里只把可见性接上；真正的整批拒绝在 migrate 入口完成（任一库 corrupt ⇒ 直接 return）。
        const corruptReject = /corrupt/i.test(String((e && e.message) || e)) || (e && e.code === 'DAM-CORRUPT-LIBRARY')
        const rb = rollbackBoth()   // 回滚：只还原本次真改过的库；失败不谎报成功
        // ★A-1c：rolledBack 只代表「两库确实都还原到位」。回滚自己也失败时（如目标只读）
        //   置 false 并把 rollbackFailed/skipped 一并外显 —— 绝不报虚假的 rolledBack:true。
        if (!rb || rb.ok !== true) rolledBack = false
        else rolledBack = true
        gList = (globalBefore && Array.isArray(globalBefore.procedures)) ? globalBefore.procedures.map((p) => Object.assign({}, p)) : []
        wList = (wsBefore && Array.isArray(wsBefore.procedures)) ? wsBefore.procedures.map((p) => Object.assign({}, p)) : []
        failed++
        const row = Object.assign({ ok: false, reason: corruptReject ? 'library-corrupt' : 'phase-failed', step, error: String((e && e.message) || e) }, tag)
        if (rb && rb.ok === false) row.rollbackFailed = true
        if (rb && Array.isArray(rb.skipped) && rb.skipped.length) row.rollbackSkipped = rb.skipped.slice()
        results.push(row)
        if (onProgress) onProgress(i + 1, total, results[results.length - 1])
        continue
      }
      if (stepOk) {
        moved++
        results.push(Object.assign({ ok: true, from: src, to: targetScope, phase: 'committed' }, tag))
      }
      if (onProgress) onProgress(i + 1, total, results[results.length - 1])
    }

    last = {
      at: Date.now(), wroteGlobal: false, wroteWorkspace: false,
      skippedUnknownWs: 0, skippedForeign: 0, refusedCorrupt: 0, foreignIds: [],
      migrated: moved, migrateFailed: failed, rolledBack,
    }
    return { ok: failed === 0, total, moved, failed, rolledBack, results }
  }
  /**
   * ★M8-B 第6步（2026-09-23）：**只读**描述两库现状，供前端「双库视图」回答
   * 「当前是哪个库 / 各库各有多少条 / 能不能写工作区库」。
   *
   * 为什么不把路径给前端：前端不需要、也不该拿到真实磁盘路径（那是注入面与
   * 迁移包才关心的事）；这里只回**库标识与计数**，足够渲染归属徽标与禁用理由。
   * 读盘失败一律 fail-soft 记 -1（前端显示「不可读」），绝不让面板整个挂掉。
   */
  function describe() {
    const w = wsNow()
    const countIn = (dir) => {
      if (!dir) return -1
      try {
        const d = readOne(dir)
        return (d && Array.isArray(d.procedures)) ? d.procedures.length : 0
      } catch (_) { return -1 }
    }
    return {
      defaultScope: 'global',
      workspaceKey: w.key,
      workspaceReady: !!(w.dir && w.key),
      globalDirCorrupt: corrupt.has(String(globalDir || '')),
      workspaceDirCorrupt: w.dir ? corrupt.has(String(w.dir)) : false,
      globalCount: countIn(globalDir),
      // 工作区未知时不探盘：`countIn('')` 会回 -1，含义是「当前无法归属」而非「0 条」
      workspaceCount: countIn(w.dir),
    }
  }

  return {
    save, load, clear, migrate, describe,
    lastWrite: () => Object.assign({}, last),
    isCorrupt: (dir) => corrupt.has(String(dir || '')),
  }
}
