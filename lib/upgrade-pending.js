/**
 * upgrade-pending.js —— 记忆整理向导 · P6（2026-11-03）+ #549 / #548（2026-11-07）
 *
 * 依据：docs/internal/PLAN-UPGRADE-WIZARD-20261103.md §5（迁移期间的 memory 渠道）
 * 任务：迁移期用户写工具（memory_log / memory_note / memory_event）被**拒绝**时，
 *   被拒条目**不得静默丢弃**，必须落盘排队、迁移结束或下次启动自动补写（replay）。
 *
 * ★★#549（2026-11-07）：本模块原先只有「入队 + 纯函数回放器」，**生产侧零调用**
 *   且默认分支直接回 `no-apply` ⇒ 补写从未发生过。本批补三件事：
 *     ① **入队保存目标身份**（sessionId + 已解析的 {wsKey,projectDir,cwd}）——
 *        否则回放时无法确定该写回哪个原库（issue 原文「回放时无法确定原库」）；
 *     ② **决策层纯函数**（resolvePendingTargetPre / upgradeGateVerdictPre / hubAccessIdsPre）——
 *        CR-10：必须可真 import → 真构造 → 真调用断言，不与引擎实例耦合；
 *     ③ 回放**失败重试 + 幂等 + 可见状态**（attempts / lastError 落到条目里，失败绝不删文件）。
 *
 * 设计纪律（与 P2 applier 同族，但更简单：这里只碰队列文件，不碰记忆库）：
 *   ① **原子写**：先写 `.json.tmp` 再 rename —— 断电不会留下半个 JSON；
 *   ② **文件名即时间序**：`<ts 毫秒>-<rand>.json`，字典序 = 入队顺序 ⇒ replay 天然按时间回放；
 *   ③ **replay 失败绝不删源文件**：只有 apply 成功才 unlink，失败/抛错/解析失败一律留在盘上供下次重试
 *      （项目规约「不得静默永久丢弃已写入数据」，#489 同族教训）；
 *   ④ **不建空目录噪音**：读取类操作对 ENOENT 返回空，不 mkdir。
 *
 * 目录布局：`<root>/pending-writes/<runId>/<ts>-<rand>.json`
 * 文件形状：
 *   { schema, runId, queuedAt, attempts, lastError, entry:{tool,args,sessionId,target,at} }
 */

import { randomBytes } from 'node:crypto'
import { readFile, writeFile, rename, mkdir, unlink, readdir } from 'node:fs/promises'
import path from 'node:path'

/** 队列根目录名（与 PLAN §5 的 pending-writes 同源） */
export const PENDING_DIRNAME = 'pending-writes'
/** 单条记录 schema（★#549：升 v2 —— 新增 attempts/lastError 与 entry.target/sessionId） */
export const PENDING_SCHEMA = 'upgrade_pending_write_v2'
/** 可读的旧 schema（读路径需兼容；旧条目没有目标身份 ⇒ 回放时明确报错而非猜测） */
export const PENDING_SCHEMA_V1 = 'upgrade_pending_write_v1'
/** 队列文件名窗口：`<13 位毫秒>-<hex>.json`（测试按此正则断言） */
export const PENDING_FILE_RE = /^\d{13,}-[0-9a-z]+\.json$/i
/**
 * 单条最多重试几次（★#549「失败重试」）。
 * 取 3 的理由：迁移终态 + 下次启动 + 用户手动触发，三条自然机会之后仍失败，
 * 说明是权限/权限根/磁盘这类**需要人介入**的问题，继续自动重试只是噪音。
 * ★达到上限**不删文件**，只是不再自动重试（人工处置入口仍在盘上）。
 */
export const MAX_PENDING_ATTEMPTS = 3
/**
 * 可入队的工具白名单 —— 与写闸的 `UPGRADE_GATEABLE_TOOLS_PRE` **同一组**。
 * ★为什么放在本模块：入队校验与闸门判定必须同源，两处各写一份就会出现
 *   「闸拦了但队列不收」或「队列收了但没人拦」的半修形态。
 */
export const PENDING_TOOLS = Object.freeze(['memory_log', 'memory_note', 'memory_event'])

/** 目录名安全：runId 不允许路径分隔符/上跳，防写到 <root> 之外 */
function assertRunIdPre(runId) {
  const run = String(runId == null ? '' : runId)
  if (!run) throw new Error('upgrade-pending: 缺 runId')
  if (!/^[A-Za-z0-9._-]+$/.test(run) || run === '.' || run === '..') throw new Error('upgrade-pending: 非法 runId：' + run)
  return run
}

/** 队列目录：<root>/pending-writes/<runId> */
export function pendingRunDirPre(root, runId) {
  const base = String(root == null ? '' : root)
  if (!base) throw new Error('upgrade-pending: 缺 root')
  return path.join(base, PENDING_DIRNAME, assertRunIdPre(runId))
}

/** 队列文件名（导出以便套件断言命名契约） */
export function pendingFileNamePre(now, rand) {
  const t = Number(now) > 0 ? Math.floor(Number(now)) : Date.now()
  const r = String(rand || randomBytes(4).toString('hex'))
  return t + '-' + r + '.json'
}

// ══════════════════════════════════════════════════════════════════════════════
// ① 纯决策层（★CR-10：真 import → 真构造 → 真调用）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * ★#548①：中枢身份集合 = 父会话 + **已登记的整理子代理会话**。
 *
 * 【为什么必须有】实测：`hubSessionIdsPre` 只收 `_workbenchParent.session.id`，
 *   而写工具拿到的是**子代理自己的 session.id** ⇒ 恒判「不是中枢」⇒
 *   `cross-workspace-write-requires-hub`。整理子代理**本来就该有**跨区写权限
 *   （它就是被派来写各工作区的），身份判定必须认它。
 *
 * 【为什么是纯函数】集合合成本身无 IO；引擎侧只负责「哪些 sessionId 算整理子代理」。
 *
 * @param {{parentSessionIds?:string[], subagentSessionIds?:string[]}} p
 * @returns {string[]} 去空白、去重、父会话在前（顺序稳定 ⇒ 可断言）
 */
export function hubAccessIdsPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const out = []
  const seen = new Set()
  const push = (v) => {
    const s = String(v == null ? '' : v).trim()
    if (!s || seen.has(s)) return
    seen.add(s)
    out.push(s)
  }
  for (const x of (Array.isArray(o.parentSessionIds) ? o.parentSessionIds : [])) push(x)
  for (const x of (Array.isArray(o.subagentSessionIds) ? o.subagentSessionIds : [])) push(x)
  return out
}

/**
 * ★#548③：迁移期写闸的**判定**（拦不拦、入不入队、为什么）。
 *
 * 【修的是什么】旧实现只看 `phase === 'running'` 就拦，**没有身份区分** ⇒
 *   正在干活的整理子代理自己的 `memory_event(create)` 被暂存，
 *   于是它「写完却看不到效果」，报告里全是成功、库里一条没有。
 *
 * 【为什么不在这里判工具白名单】工具集合（哪些工具受闸）是**调用方**的接线事实
 *   （`UPGRADE_GATEABLE_TOOLS_PRE`），决策层只回答「这个身份在这种状态下该不该被拦」。
 *   把集合复制进决策层 = 同一语义两处各写一份，改一处漏一处就半修。
 *
 * @param {{state?:object, sessionId?:string, tool?:string}} p
 * @returns {{blocked:boolean, queued:boolean, reason:string, runId:string}}
 *   reason 取值：`not-running` / `upgrade-executor` / `no-run-id` / `concurrent-writer`
 */
export function upgradeGateVerdictPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const st = o.state && typeof o.state === 'object' ? o.state : null
  const phase = String((st && st.phase) || '')
  const runId = String((st && (st.runId || st.jobId)) || '')
  if (phase !== 'running') return { blocked: false, queued: false, reason: 'not-running', runId }
  const sid = String(o.sessionId == null ? '' : o.sessionId).trim()
  const executors = Array.isArray(st && st.subagentSessionIds) ? st.subagentSessionIds : []
  for (const x of executors) {
    if (String(x == null ? '' : x).trim() === sid && sid) {
      return { blocked: false, queued: false, reason: 'upgrade-executor', runId }
    }
  }
  if (!runId) return { blocked: true, queued: false, reason: 'no-run-id', runId: '' }
  return { blocked: true, queued: true, reason: 'concurrent-writer', runId }
}

/**
 * ★#548②：把「请求的目标」解析成**确定落点**。
 *
 * 【修的是什么】旧 `resolveWriteTargetPre` 三处连乘出 issue 描述的症状：
 *   ① 白名单项取 `wsPath`（**记忆存储目录**）；
 *   ② 命中后把这个存储目录当 `cwd` 喂回 `resolvePaths`；
 *   ③ `resolvePaths` → `projectDirOf(ws)` = `root + wsKey(ws)` ⇒ **对存储目录再编码一次**，
 *      得到 `root/--...--memory--workspaces----X----` 这个**另一个目录**。
 *   ⇒ 于是「传原 cwd/wsKey 被拒；传清单里的存储路径能通过，但写进另一个目录」。
 *
 * 【修法（不动 wsPath 语义）】落点**直接取清单行的 wsPath**，绝不再过 projectDirOf；
 *   cwd 由 wsKey 反查（调用方注入 cwdOfWsKey），反查不到就回落 wsKey 并标
 *   `wsUnresolved:true` —— 回落而不拒绝，因为没进 workspaceRegistry 的工作区也应可写，
 *   但必须让人看得见「这个 cwd 不是真 cwd」。
 *
 * @param {{requestedWs?:string, inventory?:Array<{wsKey:string,wsPath:string}>, cfg:object}} p
 *   cfg: { wsKeyOf?(p):string, cwdOfWsKey?(key):string, caseSensitive?:boolean }
 * @returns {{ok:true, wsKey:string, projectDir:string, cwd:string, wsUnresolved:boolean, matchedBy:string}
 *          |{ok:false, code:string, detail?:object}}
 */
export function resolvePendingTargetPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const cfg = o.cfg && typeof o.cfg === 'object' ? o.cfg : {}
  const reqRaw = String(o.requestedWs == null ? '' : o.requestedWs).trim()
  const inv = Array.isArray(o.inventory) ? o.inventory : []
  const caseSensitive = typeof cfg.caseSensitive === 'boolean' ? cfg.caseSensitive : (process.platform !== 'win32')
  if (!reqRaw) return { ok: false, code: 'workspace-required', detail: { hint: '缺目标工作区' } }
  if (!inv.length) return { ok: false, code: 'workspace-not-in-manifest', detail: { requested: reqRaw, allowed: [], hint: '工作区清单为空，拒绝一切跨区写（fail closed）' } }

  // 归一化：目录名与绝对路径都按同一语义比较（win32 大小写不敏感）
  const norm = (x) => {
    let s = String(x == null ? '' : x).trim().replace(/^["']|["']$/g, '')
    if (!s) return ''
    s = s.replace(/\\/g, '/').replace(/\/+/g, '/')
    if (s.length > 1) s = s.replace(/\/+$/, '')
    return caseSensitive ? s : s.toLowerCase()
  }
  const want = norm(reqRaw)
  const cwdOf = typeof cfg.cwdOfWsKey === 'function' ? cfg.cwdOfWsKey : () => ''
  const keyOf = typeof cfg.wsKeyOf === 'function' ? cfg.wsKeyOf : null

  // 命中顺序：① 存储路径（wsPath）② 目录名（wsKey）③ 真实 cwd（wsKeyOf 反算）
  let hit = null
  let matchedBy = ''
  for (const row of inv) {
    if (!row || !row.wsPath) continue
    if (norm(row.wsPath) === want) { hit = row; matchedBy = 'wsPath'; break }
  }
  if (!hit) {
    for (const row of inv) {
      if (!row || !row.wsKey) continue
      if (norm(row.wsKey) === want) { hit = row; matchedBy = 'wsKey'; break }
    }
  }
  if (!hit && keyOf) {
    for (const row of inv) {
      if (!row || !row.wsKey) continue
      let rowCwd = ''
      try { rowCwd = String(cwdOf(row.wsKey) || '') } catch (_) { rowCwd = '' }
      if (rowCwd && norm(rowCwd) === want) { hit = row; matchedBy = 'cwd'; break }
      // 也可能是传了真实 cwd，而清单行只存 wsKey：用 wsKeyOf 正算一次
      try {
        if (norm(keyOf(reqRaw)) === norm(row.wsKey)) { hit = row; matchedBy = 'cwd-computed'; break }
      } catch (_) {}
    }
  }
  if (!hit) {
    return {
      ok: false,
      code: 'workspace-not-in-manifest',
      detail: { requested: reqRaw, allowed: inv.map((r) => String((r && r.wsPath) || (r && r.wsKey) || '')) },
    }
  }

  // ★落点 = 清单行 wsPath 原值（**绝不再过 projectDirOf**）
  const projectDir = String(hit.wsPath)
  let cwd = ''
  try { cwd = String(cwdOf(hit.wsKey) || '') } catch (_) { cwd = '' }
  const wsUnresolved = !cwd
  if (!cwd) cwd = String(hit.wsKey)
  return { ok: true, wsKey: String(hit.wsKey), projectDir, cwd, wsUnresolved, matchedBy }
}

/**
 * ★#549：构造一条待补写条目（**入队前**调用，确保目标身份一起落盘）。
 * @param {{tool:string,args:object,sessionId?:string,target?:object,at?:number}} p
 */
export function buildPendingEntryPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const t = o.target && typeof o.target === 'object' ? o.target : null
  return {
    schema: PENDING_SCHEMA,
    tool: String(o.tool == null ? '' : o.tool),
    args: (o.args && typeof o.args === 'object') ? o.args : {},
    sessionId: String(o.sessionId == null ? '' : o.sessionId),
    target: t ? {
      wsKey: String(t.wsKey == null ? '' : t.wsKey),
      projectDir: String(t.projectDir == null ? '' : t.projectDir),
      cwd: String(t.cwd == null ? '' : t.cwd),
    } : null,
    at: Number(o.at) > 0 ? Math.floor(Number(o.at)) : Date.now(),
    attempts: 0,
  }
}

/**
 * ★#549 负路径②：条目校验 —— **缺目标身份必须明确报错**，不得静默丢弃、也不得静默成功。
 * （issue 原文：入队时保存目标身份；否则回放时无法确定原库）
 * @returns {{ok:true}|{ok:false, code:string, error:string}}
 */
export function validatePendingEntryPre(entry) {
  const e = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : null
  if (!e) return { ok: false, code: 'not-an-object', error: '待补写条目必须是对象' }
  const tool = String(e.tool == null ? '' : e.tool).trim()
  if (!tool) return { ok: false, code: 'missing-tool', error: '条目缺 tool：无法知道该重放哪个写工具' }
  if (!PENDING_TOOLS.includes(tool)) {
    return { ok: false, code: 'tool-not-gateable', error: '工具 ' + tool + ' 不在可入队白名单（' + PENDING_TOOLS.join('/') + '）：只读工具不需要补写' }
  }
  if (!e.args || typeof e.args !== 'object' || Array.isArray(e.args)) {
    return { ok: false, code: 'missing-args', error: '条目缺 args：无法重放原始写入参数' }
  }
  const t = e.target && typeof e.target === 'object' ? e.target : null
  if (!t) return { ok: false, code: 'missing-target', error: '条目缺 target：回放时无法确定原始目标库（旧版条目的已知缺陷）' }
  if (!String(t.projectDir == null ? '' : t.projectDir).trim()) {
    return { ok: false, code: 'missing-target', error: '条目 target 缺 projectDir：回放时无法确定原始目标库' }
  }
  return { ok: true }
}

/**
 * ★#549「失败重试」：按 queuedAt 升序给出**本轮要回放**的条目。
 * 已达 MAX_PENDING_ATTEMPTS 的条目不参与自动回放（**但仍留在盘上**，供人工处置）。
 * @param {Array<{file:string,queuedAt?:number,attempts?:number}>} rows
 */
export function pendingReplayOrderPre(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((x) => x && typeof x === 'object')
  const usable = list.filter((x) => {
    const n = Math.floor(Number(x.attempts) || 0)
    return n < MAX_PENDING_ATTEMPTS
  })
  return usable.slice().sort((a, b) => {
    const ta = Number(a.queuedAt) || 0, tb = Number(b.queuedAt) || 0
    if (ta !== tb) return ta - tb
    return String(a.file).localeCompare(String(b.file))
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// ② 队列文件 IO
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 入队一条被拒的用户写入。**原子写**（tmp → rename）后才返回 ok。
 *
 * @param {{root:string, runId:string, entry:object, now?:number, rand?:string}} p
 * @returns {Promise<{ok:boolean, file?:string, id?:string, bytes?:number, runId?:string, code?:string, error?:string}>}
 */
export async function enqueuePendingWritePre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  if (!o.entry || typeof o.entry !== 'object' || Array.isArray(o.entry)) {
    return { ok: false, code: 'bad-entry', error: 'entry 必须是对象（用户写入的完整参数）' }
  }
  let dir
  let runId
  try {
    runId = assertRunIdPre(o.runId)
    dir = pendingRunDirPre(o.root, runId)
  } catch (e) {
    return { ok: false, code: 'bad-args', error: String((e && e.message) || e) }
  }
  const now = Number(o.now) > 0 ? Math.floor(Number(o.now)) : Date.now()
  // ★#549：条目自带 schema/attempts 时保留（重试计数不能被入队覆盖）；缺省补 v2 形状。
  const entry = Object.assign({}, o.entry)
  const rec = {
    schema: String(entry.schema || PENDING_SCHEMA),
    runId,
    queuedAt: now,
    attempts: Math.max(0, Math.floor(Number(entry.attempts) || 0)),
    lastError: entry.lastError && typeof entry.lastError === 'object' ? entry.lastError : null,
    lastAttemptAt: Number(entry.lastAttemptAt) || 0,
    entry: o.entry,
  }
  const body = JSON.stringify(rec, null, 2)
  const name = pendingFileNamePre(now, o.rand)
  const file = path.join(dir, name)
  const tmp = path.join(dir, name + '.tmp')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(tmp, body, 'utf8')
    await rename(tmp, file)
  } catch (e) {
    try { await unlink(tmp) } catch (_) {}
    return { ok: false, code: 'write-failed', error: String((e && e.message) || e) }
  }
  return { ok: true, file, id: name.replace(/\.json$/i, ''), bytes: Buffer.byteLength(body, 'utf8'), runId, queuedAt: now }
}

/**
 * 把「回放失败」写回条目文件（attempts+1、lastError、lastAttemptAt）——**原子写**。
 * ★失败可见性（issue 要求「可见状态」）：不写回的话，失败条目每次都从 attempts=0 重来，
 *   重试上限永远不生效，且用户/引擎都看不到它失败过几次。
 * ★本函数失败**不抛**（它是记账，不是主流程）；但会如实回 {ok:false}。
 */
export async function markPendingAttemptPre(file, err) {
  const target = String(file == null ? '' : file)
  if (!target) return { ok: false, code: 'no-file' }
  let rec = null
  try { rec = JSON.parse(await readFile(target, 'utf8')) } catch (e) { return { ok: false, code: 'unreadable' } }
  if (!rec || typeof rec !== 'object') return { ok: false, code: 'bad-record' }
  rec.attempts = Math.max(0, Math.floor(Number(rec.attempts) || 0)) + 1
  rec.lastAttemptAt = Date.now()
  rec.lastError = {
    code: String((err && err.code) || 'apply-failed'),
    error: String((err && err.error) || (err && err.message) || err || '').slice(0, 300),
  }
  const tmp = target + '.tmp'
  try {
    await writeFile(tmp, JSON.stringify(rec, null, 2), 'utf8')
    await rename(tmp, target)
  } catch (e) {
    try { await unlink(tmp) } catch (_) {}
    return { ok: false, code: 'write-failed' }
  }
  return { ok: true, attempts: rec.attempts }
}

/**
 * 列某 run 的队列文件（**只认 .json**，忽略 .tmp 残留）。不存在 ⇒ []。
 * 返回绝对路径，按文件名排序（= 入队时间序）。
 */
export async function listPendingWritesPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  let dir
  try { dir = pendingRunDirPre(o.root, o.runId) } catch (_) { return [] }
  let names = []
  try { names = await readdir(dir) } catch (e) { if (e && e.code === 'ENOENT') return []; throw e }
  return names.filter((n) => /\.json$/i.test(n) && !/\.tmp$/i.test(n)).sort().map((n) => path.join(dir, n))
}

/** 列出所有有待补写队列的 runId（下次启动时用；不存在 ⇒ []） */
export async function listPendingRunIdsPre(root) {
  const base = path.join(String(root == null ? '' : root), PENDING_DIRNAME)
  let ents
  try { ents = await readdir(base, { withFileTypes: true }) } catch (e) { if (e && e.code === 'ENOENT') return []; throw e }
  return ents.filter((d) => d && d.isDirectory()).map((d) => String(d.name)).sort()
}

/** 队列计数（回执「补写 N 条」用） */
export async function countPendingWritesPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const runIds = o.runId ? [String(o.runId)] : await listPendingRunIdsPre(o.root)
  let total = 0
  const perRun = {}
  for (const rid of runIds) {
    let n = 0
    try { n = (await listPendingWritesPre({ root: o.root, runId: rid })).length } catch (_) {}
    perRun[rid] = n
    total += n
  }
  return { total, perRun }
}

/**
 * ★补写回放：逐条读队列 → apply(entry, meta)。
 *
 * 成功判据（fail-closed 口径）：
 *   · apply 正常返回，且**不**是 false / {ok:false} ⇒ 成功 → unlink 源文件；
 *   · apply 抛错 / 返回 false / {ok:false} / 文件损坏 ⇒ **失败，源文件保留**，并写回 attempts/lastError。
 *
 * @param {{root:string, runId?:string, apply:(entry:object, meta:{file:string,runId:string,queuedAt:number,attempts:number})=>any}} p
 *        runId 省略 ⇒ 回放全部 run（下次启动场景）
 * @returns {Promise<{ok:boolean, replayed:number, failed:number, remaining:number, skipped:number, results:object[], runIds:string[]}>}
 */
export async function replayPendingWritesPre(p = {}) {
  const o = p && typeof p === 'object' ? p : {}
  const empty = { ok: true, replayed: 0, failed: 0, remaining: 0, skipped: 0, results: [], runIds: [] }
  if (typeof o.apply !== 'function') {
    return Object.assign({}, empty, { ok: false, code: 'no-apply', error: 'replayPendingWritesPre 需要 apply(entry) 回调' })
  }
  let runIds = []
  try {
    runIds = o.runId ? [assertRunIdPre(o.runId)] : await listPendingRunIdsPre(o.root)
  } catch (e) {
    return Object.assign({}, empty, { ok: false, code: 'bad-args', error: String((e && e.message) || e) })
  }

  let replayed = 0
  let failed = 0
  let skipped = 0
  const results = []
  for (const rid of runIds) {
    let files = []
    try {
      files = await listPendingWritesPre({ root: o.root, runId: rid })
    } catch (e) {
      failed++
      results.push({ runId: rid, file: '', ok: false, code: 'list-failed', error: String((e && e.message) || e) })
      continue
    }
    // ★先读全部记录，再按 queuedAt 升序 + 重试上限筛（顺序不能靠文件名猜）
    const rows = []
    for (const file of files) {
      let rec = null
      try { rec = JSON.parse(await readFile(file, 'utf8')) } catch (e) {
        failed++
        results.push({ runId: rid, file, ok: false, code: 'unreadable', error: String((e && e.message) || e).slice(0, 200) })
        continue
      }
      rows.push({ file, queuedAt: Number((rec && rec.queuedAt) || 0) || 0, attempts: Math.floor(Number(rec && rec.attempts) || 0), rec })
    }
    const usable = pendingReplayOrderPre(rows)
    for (const r of rows) {
      if (!usable.some((u) => u.file === r.file)) {
        skipped++
        results.push({ runId: rid, file: r.file, ok: false, code: 'retry-exhausted', attempts: r.attempts })
      }
    }
    for (const it of usable) {
      const rec = it.rec
      const entry = (rec && typeof rec === 'object' && rec.entry && typeof rec.entry === 'object') ? rec.entry : rec
      const meta = { file: it.file, runId: rid, queuedAt: it.queuedAt, attempts: it.attempts }
      let res
      try {
        res = await o.apply(entry, meta)
      } catch (e) {
        const err = { code: 'apply-threw', error: String((e && e.message) || e).slice(0, 300) }
        const mk = await markPendingAttemptPre(it.file, err)
        failed++
        results.push({ runId: rid, file: it.file, ok: false, code: err.code, error: err.error, attempts: mk && mk.attempts })
        continue // ★不删除源文件
      }
      const rejected = res === false || (res && typeof res === 'object' && res.ok === false)
      if (rejected) {
        const err = { code: String((res && res.code) || 'apply-rejected'), error: String((res && res.error) || '') }
        const mk = await markPendingAttemptPre(it.file, err)
        failed++
        results.push({ runId: rid, file: it.file, ok: false, code: err.code, error: err.error.slice(0, 300), attempts: mk && mk.attempts })
        continue // ★不删除源文件
      }
      try {
        await unlink(it.file)
      } catch (e) {
        failed++
        results.push({ runId: rid, file: it.file, ok: false, code: 'unlink-failed', error: String((e && e.message) || e) })
        continue
      }
      replayed++
      results.push({ runId: rid, file: it.file, ok: true })
    }
  }

  let remaining = 0
  for (const rid of runIds) {
    try { remaining += (await listPendingWritesPre({ root: o.root, runId: rid })).length } catch (_) {}
  }
  return { ok: failed === 0, replayed, failed, remaining, skipped, results, runIds }
}

export default {
  PENDING_DIRNAME,
  PENDING_SCHEMA,
  PENDING_SCHEMA_V1,
  PENDING_FILE_RE,
  PENDING_TOOLS,
  MAX_PENDING_ATTEMPTS,
  hubAccessIdsPre,
  upgradeGateVerdictPre,
  resolvePendingTargetPre,
  buildPendingEntryPre,
  validatePendingEntryPre,
  pendingReplayOrderPre,
  pendingRunDirPre,
  pendingFileNamePre,
  enqueuePendingWritePre,
  markPendingAttemptPre,
  listPendingWritesPre,
  listPendingRunIdsPre,
  countPendingWritesPre,
  replayPendingWritesPre,
}
