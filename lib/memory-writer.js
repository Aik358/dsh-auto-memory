/**
 * MemoryDocumentWriter — M3b-2 原子写入基础设施(契约 §8-§9,M-06 project/atomicWrite 对应层)。
 * 本阶段不接入真实写路径(M3b-3 才逐路径迁移)、不迁移真实 Markdown(memoryAnchorEnabled=false)。
 *
 * 组成:
 * 1) 纯渲染原语(无 fs、零副作用):applyMigrationPlan / appendAnchoredRecord / renderReplace,
 *    与 memory-anchor.js 的 parseAnchors 成对,保证 render→parse 幂等与身份稳定。
 * 2) atomicReplace(target, data, fs):同目录临时文件 + fsync + rename(Windows 覆盖须实测)。
 * 3) MemoryDocumentStore:per-file 串行 Promise 队列、digest precondition、backup、
 *    sidecar 落盘/重建(契约 §6 路径语义)、故障注入接口(fs 可注入)。
 *
 * 渲染规则:marker 独占一行(<!-- memory:mem_xxx -->);追加时 marker 后空行分隔内容;
 * 换行风格沿用目标文件既有风格(LF/CRLF 保持,契约 §10);输出从不含 BOM。
 */
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fsDefault, realpathSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'   // ★#311：别名基准按**任务**隔离，不再放实例字段
import {
  parseAnchors, buildSidecar, parseSidecar, newMemoryId, MEMORY_ID_RE, ANCHOR_PREFIX, detectNewline,
  MARKER_OPEN, checkReservedSyntaxInContent,
} from './memory-anchor.js'
import { INDEX_MAX_FILE_BYTES } from './memory-index.js'
import { retryRename } from './fs-retry.js'
// ★#263（P2a）：路径边界判据**唯一来源** —— 本模块不新起第五套，只用这两个导出。
import { canonPath, withinRoot } from './file-boundary.js'
// ★#306：跨进程文档锁**复用既有模块**（不另起第三套锁语义；该模块已在 lib/index.js 接续链生产使用）。
import { acquireSharedStateLock, acquireSharedStateLockSync } from './shared-state-lock.js'

function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

function toBuf(content) {
  return Buffer.isBuffer(content) ? content : Buffer.from(content == null ? '' : String(content), 'utf8')
}

/** 统一文本行尾风格:newline='crlf' 时全部 
,否则全部 
。 */
export function toEol(text, newline) {
  const s = String(text)
  return newline === 'crlf' ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n')
}

function markerBuf(memoryId, nl) {
  return Buffer.from('<!-- memory:' + memoryId + ' -->' + nl, 'utf8')
}

/**
 * issue #54 P1（可诊断性）：把 `parseAnchors` 的 conflicts 格式化为**带行号**的 reason。
 *
 * 旧实现统一 `.map(c => c.type)` ⇒ 丢掉 `line`/`byteStart`/`byteEnd`
 * （`memory-anchor.js:184` 其实已经算好了），报错只说"冲突"，
 * 使用者（和模型）无从定位是哪一行，也不知道是自己这次写入引入的还是文件本来就有。
 *
 * 保持 `conflict:` 前缀不变（既有测试断言 `reason.startsWith('conflict')`）。
 * @param {Array} conflicts parseAnchors 返回的冲突对象数组
 * @returns {string} 形如 `conflict:orphan-content@12`（多个以 `,` 连接）
 */
function formatConflicts(conflicts) {
  return 'conflict:' + (conflicts || [])
    .map((c) => c.type + (Number.isFinite(c.line) ? '@' + c.line : ''))
    .join(',')
}

/** issue #54 P0：写入路径统一的保留语法前置校验（复用 memory-anchor-pre 的同一判据）。 */
function reservedSyntaxGuard(text) {
  return checkReservedSyntaxInContent(text)
}

/** 逆序插入 marker 到指定行首位置(批次内部按 atByte 升序传入)。 */
function insertMarkers(buf, inserts, nl) {
  let out = buf
  for (let i = inserts.length - 1; i >= 0; i--) {
    const at = inserts[i].atByte
    out = Buffer.concat([out.subarray(0, at), markerBuf(inserts[i].memoryId, nl), out.subarray(at)])
  }
  return out
}

/**
 * 应用 dry-run 迁移计划(契约 §7 的应用器):在 legacy 块 byteStart 前插入 anchor marker。
 * 校验:计划 aborted/字段非法、expectedFileDigest 不匹配(整份 stale)、超限、
 * 当前文件含冲突、ID 重复、atByte 非升序、atByte 不是 legacy 块起点、非行首 —— 全部拒绝。
 * 已迁移文件(无 legacy 块)会因 not-legacy-start 拒绝重放,天然幂等。
 * @returns {{ok:true,text:Buffer,applied:number}|{ok:false,reason:string}}
 */
export function applyMigrationPlan(content, plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.operations)) return { ok: false, reason: 'bad-plan' }
  if (plan.aborted) return { ok: false, reason: 'aborted:' + (plan.conflicts || []).map((c) => c.type).join(',') }
  const buf = toBuf(content)
  if (buf.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized' }
  if (plan.expectedFileDigest !== sha256Hex(buf)) return { ok: false, reason: 'stale-plan' }
  const parsed = parseAnchors(buf)
  if (parsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (parsed.status !== 'clean') return { ok: false, reason: formatConflicts(parsed.conflicts), conflicts: parsed.conflicts }
  const pending = plan.operations.filter((op) => op && op.kind === 'insert-anchor')
  if (!pending.length) return { ok: true, applied: 0, text: buf }
  const legacyStarts = new Set(parsed.records.filter((r) => r.kind === 'legacy').map((r) => r.byteStart))
  const seen = new Set()
  let prevByte = -1
  for (const op of pending) {
    if (typeof op.atByte !== 'number' || !Number.isInteger(op.atByte) || op.atByte < 0 || op.atByte > buf.length) return { ok: false, reason: 'bad-atByte' }
    if (typeof op.memoryId !== 'string' || !MEMORY_ID_RE.test(op.memoryId)) return { ok: false, reason: 'bad-id' }
    if (seen.has(op.memoryId)) return { ok: false, reason: 'duplicate-id' }
    seen.add(op.memoryId)
    if (op.atByte <= prevByte) return { ok: false, reason: 'out-of-order' }
    prevByte = op.atByte
    if (!legacyStarts.has(op.atByte)) return { ok: false, reason: 'not-legacy-start' }
    if (op.atByte > 0 && buf[op.atByte - 1] !== 0x0a) return { ok: false, reason: 'not-line-start' }
  }
  const nl = parsed.newline === 'crlf' ? '\r\n' : '\n'
  const text = insertMarkers(buf, pending.map((op) => ({ atByte: op.atByte, memoryId: op.memoryId })), nl)
  return { ok: true, text, applied: pending.length }
}

/**
 * 尾部追加一条 anchored 记录(契约粒度:一次写入事务 = 一个 memoryId)。
 * 渲染:尾部换行保证 + '<!-- marker -->' 独占行 + 空行 + 内容行 + 尾换行;行尾风格沿用文件。
 * 重复 memoryId/冲突文件/超限 → 拒绝。
 * @returns {{ok:true,text:Buffer,memoryId:string}|{ok:false,reason:string}}
 */
export function appendAnchoredRecord(content, { memoryId, text }) {
  if (typeof memoryId !== 'string' || !MEMORY_ID_RE.test(memoryId)) return { ok: false, reason: 'bad-id' }
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty-record' }
  // issue #54 P0:先校验**本次要写的正文**,再校验文件已有内容——顺序不可颠倒。
  const guard = reservedSyntaxGuard(text)
  if (!guard.ok) return { ok: false, reason: guard.reason, line: guard.line, detail: guard.detail }
  const buf = toBuf(content)
  if (buf.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized' }
  const parsed = parseAnchors(buf)
  if (parsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (parsed.status !== 'clean') return { ok: false, reason: formatConflicts(parsed.conflicts), conflicts: parsed.conflicts }
  if (parsed.records.some((r) => r.kind === 'anchored' && r.memoryId === memoryId)) return { ok: false, reason: 'duplicate-id' }
  const nl = parsed.newline === 'crlf' ? '\r\n' : '\n'
  const body = toEol(text, parsed.newline)
  let out = buf
  if (out.length && out[out.length - 1] !== 0x0a) out = Buffer.concat([out, Buffer.from(nl, 'utf8')])
  let block = '<!-- memory:' + memoryId + ' -->' + nl + nl + body
  if (!block.endsWith(nl)) block += nl
  out = Buffer.concat([out, Buffer.from(block, 'utf8')])
  return { ok: true, text: out, memoryId }
}

/**
 * 整篇替换(§9 语义,最高风险路径):解析 replacement 文档——
 * - 原有合法 anchor 保持原 ID(kept);未带 anchor 的新块分配新 ID(added);
 * - replacement 中带旧文档没有的 ID → 显式声明,保留(foreign,不做相似文本猜测);
 * - 旧文档中被省略的 ID → 返回 removed(视为删除);
 * - duplicate/malformed/orphan 冲突 → 拒绝(conflict)。
 * 输出 = replacement 字节最小扰动(仅 legacy 块前插入 marker 行),anchored 块原样保留。
 * @returns {{ok:true,text:Buffer,added:Array,kept:Array,foreign:Array,removed:Array}|{ok:false,reason:string,conflicts?:Array}}
 */
export function renderReplace(content, replacement, opts = {}) {
  const oldBuf = toBuf(content)
  if (oldBuf.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized' }
  const rep = toBuf(replacement)
  if (rep.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized-replacement' }
  const oldParsed = parseAnchors(oldBuf)
  if (oldParsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (oldParsed.status !== 'clean') return { ok: false, reason: formatConflicts(oldParsed.conflicts), conflicts: oldParsed.conflicts }
  const rp = parseAnchors(rep)
  if (rp.status === 'oversized') return { ok: false, reason: 'oversized-replacement' }
  if (rp.status !== 'clean') return { ok: false, reason: formatConflicts(rp.conflicts), conflicts: rp.conflicts }
  const oldIds = new Set(oldParsed.records.filter((r) => r.kind === 'anchored' && r.memoryId).map((r) => r.memoryId))
  const idFactory = (typeof opts.idFactory === 'function' ? opts.idFactory : newMemoryId)
  const used = new Set(oldIds)
  const added = []
  const kept = []
  const foreign = []
  const inserts = []
  for (const rec of rp.records) {
    if (rec.kind === 'legacy') {
      let id
      let tries = 0
      do {
        id = idFactory()
        tries += 1
      } while (used.has(id) && tries <= 100)
      if (tries > 100) return { ok: false, reason: 'id-exhausted' }
      used.add(id)
      added.push({ memoryId: id, anchorId: ANCHOR_PREFIX + id, lineStart: rec.lineStart, lineEnd: rec.lineEnd })
      inserts.push({ atByte: rec.byteStart, memoryId: id })
    } else {
      if (oldIds.has(rec.memoryId)) kept.push(rec.memoryId)
      else foreign.push(rec.memoryId)
    }
  }
  const removed = [...oldIds].filter((id) => !rp.records.some((r) => r.kind === 'anchored' && r.memoryId === id))
  const nl = rp.newline === 'crlf' ? '\r\n' : '\n'
  const text = inserts.length ? insertMarkers(rep, inserts, nl) : rep
  return { ok: true, text, added, kept, foreign, removed }
}

/**
 * 单记录整篇替换(契约 §3 粒度:"一次写入事务 = 一个 memoryId",用于 reflection 等单记录文档):
 * 全文以单个新 marker 开头、整体作为一条 anchored 记录;文本含保留 marker 语法 → 拒绝。
 * @returns {{ok:true,text:Buffer,memoryId:string}|{ok:false,reason:string}}
 */
export function replaceSingleRecord(content, text, opts = {}) {
  const body = typeof text === 'string' ? text : String(text == null ? '' : text)
  if (!body.trim()) return { ok: false, reason: 'empty-record' }
  // issue #54 P0:单记录写入的正文**整段都是内容**(marker 由本函数生成),故正文内出现保留语法必属误用 ⇒ 前置拒绝。
  const guard = reservedSyntaxGuard(body)
  if (!guard.ok) return { ok: false, reason: guard.reason, line: guard.line, detail: guard.detail }
  const oldBuf = toBuf(content)
  if (oldBuf.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized' }
  const oldParsed = parseAnchors(oldBuf)
  if (oldParsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (oldParsed.status !== 'clean') return { ok: false, reason: formatConflicts(oldParsed.conflicts), conflicts: oldParsed.conflicts }
  const idFactory = typeof opts.idFactory === 'function' ? opts.idFactory : newMemoryId
  const used = new Set(oldParsed.records.filter((r) => r.kind === 'anchored').map((r) => r.memoryId))
  let memoryId
  let tries = 0
  do {
    memoryId = idFactory()
    tries += 1
  } while (used.has(memoryId) && tries <= 100)
  if (tries > 100) return { ok: false, reason: 'id-exhausted' }
  const nl = detectNewline(oldBuf.length ? oldBuf : Buffer.from(body, 'utf8')) === 'crlf' ? '\r\n' : '\n'
  const candidate = Buffer.concat([markerBuf(memoryId, nl), Buffer.from(toEol(body, nl), 'utf8')])
  const check = parseAnchors(candidate)
  if (check.status !== 'clean') return { ok: false, reason: formatConflicts(check.conflicts), conflicts: check.conflicts }
  const anchored = check.records.filter((r) => r.kind === 'anchored')
  if (anchored.length !== 1 || anchored[0].memoryId !== memoryId) return { ok: false, reason: 'not-single-record' }
  return { ok: true, text: candidate, memoryId }
}

/**
 * 原子替换默认 fs 适配器之外的注入目标(测试故障注入/sidecar 目录等)。
 * 同目录临时文件 + fsync + **有界 rename 重试**(issue #48);替换失败保留完整候选快照,不覆盖回放。
 *
 * 2026-09-16 修正(issue #48):旧实现 rename 一次失败即硬失败并 unlink 临时文件,
 * 在 Windows 并发子代理下(DSH 仍持有目标句柄)会把本可成功的写入连残骸一起丢掉。
 * 现在:① 瞬时错误码(EPERM/EACCES/EBUSY)走退避重试;② 仍失败则把**完整候选快照**
 * 改名保留为 `.dam-failed-*.tmp` 并在错误上回传 `recoveryPath`,由调用方人工比对
 * (候选是**整篇快照**而非追加指令,绝不允许自动回放——期间可能有别的写入者推进了目标)。
 */
export async function atomicReplace(target, data, fsApi = fsDefault, opts = {}) {
  const dir = path.dirname(target)
  const nonce = randomUUID()
  // .tmp 后缀保证 待处理/恢复 快照不进入 *.md / *.json 扫描(见 issue #51 同类问题)
  const tmp = path.join(dir, '.dam-pre-tmp-' + nonce + '-' + path.basename(target) + '.tmp')
  await fsApi.mkdir(dir, { recursive: true })
  let handle = null
  let created = false
  let complete = false
  let stage = 'open'
  try {
    // 独占创建:碰撞时绝不截断/删除别人的临时文件
    handle = await fsApi.open(tmp, 'wx', 0o600)
    created = true
    stage = 'write'
    await handle.writeFile(data)
    stage = 'sync'
    await handle.sync()
    stage = 'close'
    await handle.close()
    handle = null
    complete = true
    stage = 'rename'
    // Recheck guarded writes on every rename attempt, including after retry backoff.
    const renameFs = opts.beforeRename ? { rename: async (from, to) => { await opts.beforeRename(); return fsApi.rename(from, to) } } : fsApi
    await retryRename(tmp, target, { fs: renameFs, delays: opts.renameDelays, sleep: opts.sleep })
  } catch (cause) {
    if (handle) { try { await handle.close() } catch (_) {} }
    const details = { stage, targetPath: target, recoveryComplete: false }
    // ★#263：越界拒绝**不保留失败快照** —— 那是把用户内容写到记忆根之外（诊断文件），
    //   与「保全用户数据」的初衷相反。临时文件按普通失败清理。
    if (created && complete && opts.preserveOnFailure !== false && !(cause && cause.code === 'MEMORY_PATH_ESCAPED')) {
      // 这是**整篇文档的候选快照**,不是追加指令 —— 绝不自动回放(别的写入者可能已推进目标)。
      let recoveryPath = tmp
      const failed = path.join(dir, '.dam-failed-' + Date.now() + '-' + nonce + '-' + path.basename(target) + '.tmp')
      try { await fsApi.rename(tmp, failed); recoveryPath = failed } catch (_) {
        // 恢复用的 rename 本身也可能被占用 ⇒ 保留原临时路径
      }
      try {
        const retained = await fsApi.stat(recoveryPath)
        if (!retained.isFile()) throw new Error('recovery snapshot is not a file')
        details.recoveryPath = recoveryPath
        details.recoveryComplete = true
      } catch (_) {
        // 快照可能已被扫描器/其它进程移走 —— 不能仅凭"本函数没 unlink"就宣称保全成功
        details.recoveryUnavailable = true
      }
    } else if (created) {
      try { await fsApi.unlink(tmp) } catch (cleanupError) {
        details.partialPath = tmp
        details.cleanupCode = cleanupError && cleanupError.code
      }
    }
    // 默认保留原始 fs 错误(含 code/errno/syscall/path/dest)。
    // 冻结/非 Error 抛出不得用 TypeError 掩盖真实写入失败。
    const error = cause instanceof Error && Object.isExtensible(cause)
      ? cause : new Error(cause && cause.message ? cause.message : String(cause), { cause })
    if (error !== cause && cause && typeof cause.code === 'string') error.code = cause.code
    Object.assign(error, details)
    throw error
  }
}

/**
 * per-file 串行写入事务(契约 §8 步骤 1-10):
 * 读当前字节 → parse 验证 → 生成新内容 → 无 BOM/anchor 唯一校验 → tmp+fsync →
 * backup → rename → 重读校验 digest → sidecar 重建(失败标记 dirty,不回滚 Markdown)。
 * expectedDigest 不匹配(外部编辑) → 拒绝且不写。同文件并发写经队列串行,不丢失。
 * fs/sidecarDir/backupDir 可注入(故障注入测试);sidecarDir 未配置则不做 sidecar 落盘。
 */
// 同一 fs 后端共享队列(注入的虚拟文件系统之间仍互相隔离)。**注意:这不是跨进程锁。**
const queuesByFs = new WeakMap()
function queuesFor(fsApi) {
  let queues = queuesByFs.get(fsApi)
  if (!queues) { queues = new Map(); queuesByFs.set(fsApi, queues) }
  return queues
}

/**
 * ★#263（P2a）：**目录别名改指检测** —— 受理时刻钉住的「目标物理父目录」，与写盘时的实时解析比对。
 *
 * 缺陷现场：准入与文件锁通过后，readFile → backup → tmp → rename → verify 各阶段都用
 * **lexical 路径**重新解析目录别名 ⇒ 期间把目录 junction 改指到根外，整篇写入落到根外
 * （报告者实测：admitted-root 一字未改，outside-root 多出一条记录）。
 *
 * ★判据为什么是「**不变性**」而不是「**包含于记忆根**」（本实现踩过两轮坑，写在此防回归）：
 *   · 包含式判据（withinRoot(受理根, 目标)）会**误杀合法写**：记忆文档并不总在配置的记忆根下
 *     （A1 套件的 compact 夹具就是自建目录）⇒ 收了口就是不兼容；
 *   · 且它在别名改指场景下**同时失效**：别名被改指后根与目标一起移动 ⇒ 包含式恒真。
 *   · 正解：钉「**受理时刻 target 的物理父目录**」，每次写盘前重新解析并比对，相同才继续。
 *     别名被改指 ⇒ 父目录变了 ⇒ 立刻拒绝；8.3 短名/大小写只是拼写差异、物理目录同一个
 *     ⇒ 两次解析结果相同 ⇒ 不误杀。
 *
 * @returns {{ok:boolean, guarded:boolean, physical?:string, reason?:string}}
 */
export function targetAliasStablePre(filePath, pin) {
  if (!pin || !pin.ok || !pin.physicalDir) return { ok: true, guarded: false }
  const current = physicalDirOfPre(filePath)
  if (!current) return { ok: true, guarded: false }   // 目录暂时不可解析 ⇒ 交给上层 IO 报错，不在此制造新错误面
  if (samePhysicalPathPre(current, pin.physicalDir)) return { ok: true, guarded: true, physical: current }
  return { ok: false, guarded: true, physical: current, reason: 'alias-retargeted' }
}

/** 受理时刻钉住 target 的物理父目录（别名改指检测的比较基准）。 */
export function pinTargetAliasPre(filePath) {
  const physicalDir = physicalDirOfPre(filePath)
  return physicalDir ? { ok: true, physicalDir } : { ok: false, physicalDir: '' }
}

/**
 * target 的**物理父目录**（不可解析 ⇒ 空串表示「不可比」）。
 *
 * ★只走 canonPath（本仓路径归一的唯一来源）：目录**尚未建立**时它给「最近存在祖先 + 缺失后缀」，
 *   目录建立后给完整 realpath。混用 `realpathSync` 会引入**两种拼写族**（8.3 短名 `JHZ~1`
 *   与长名 `JH Z` 各出现一次）⇒ 同一个目录在两次解析下字符串不等，合法写入被误判成
 *   「别名被改指」（m3b3 实测：先 pin 后建目录 ⇒ 假拒绝）。
 */
function physicalDirOfPre(filePath) {
  const dir = path.dirname(path.resolve(String(filePath || '')))
  if (!dir) return ''
  let real = ''
  try { real = canonPath(dir) } catch (_) { real = '' }
  return real ? normalizePhysicalPre(real) : ''
}

/** 物理路径比较键：NFKC + （win32）小写化。 */
function normalizePhysicalPre(p) {
  let s = String(p || '')
  try { s = s.normalize('NFKC') } catch (_) {}
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** 两个物理父目录是否同一个。 */
function samePhysicalPathPre(a, b) { return !!a && !!b && normalizePhysicalPre(a) === normalizePhysicalPre(b) }

/** ★#263：别名改指拒绝的结构化错误（供 atomicReplace 识别并跳过「失败快照保留」）。 */
export function memoryPathEscapedError(filePath, physical) {
  const error = new Error('memory-path-escaped: directory alias retargeted away from the admitted target')
  error.code = 'MEMORY_PATH_ESCAPED'
  error.statusCode = 409
  error.targetPath = filePath
  error.physicalPath = physical
  return error
}

/** 队列键:Windows 下大小写不敏感且需规范化,避免同一文件两条队列并行。 */
export function memoryWriteLockKey(filePath, platform = process.platform) {
  const resolved = (platform === 'win32' ? path.win32 : path.posix).resolve(filePath)
  return platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 把 store 的结构化写状态保留成 Error（issue #48）：写入失败不可降级为一句无信息的文案。 */
export function memoryWriteError(operation, result) {
  let message = 'memory-anchor-' + operation + '-failed:' + result.reason
  if (result.recoveryPath) {
    message += '; recoveryPath=' + JSON.stringify(result.recoveryPath) +
      '; recovery is a candidate snapshot, compare with current document before manual recovery'
  }
  if (result.partialPath) message += '; partialPath=' + JSON.stringify(result.partialPath) + '; incomplete, not safe to restore'
  if (result.written === true) message += '; written=true, verify current document before retrying'
  const error = new Error(message)
  error.code = result.errorCode || (result.written === true ? 'MEMORY_WRITE_VERIFY_FAILED' : 'MEMORY_WRITE_FAILED')
  error.fsCode = result.fsCode
  error.written = result.written === true
  error.recoveryPath = result.recoveryPath
  error.recoveryComplete = result.recoveryComplete === true
  error.partialPath = result.partialPath
  return error
}

export class MemoryDocumentStore {
  constructor(opts = {}) {
    this.fs = opts.fs || fsDefault
    this.sidecarDir = opts.sidecarDir || null
    this.backupDir = opts.backupDir || null
    this.now = opts.now || (() => Date.now())
    this.idFactory = opts.idFactory || newMemoryId
    this._locks = queuesFor(this.fs)
    this.atomicOptions = opts.atomicOptions || {}
    // ★#249 C02（AUDIT §2.1）：生产文档 mutation 的统一 admission ——
    //   本仓所有记忆写（append/appendRaw/replace/replaceRaw/replaceSingle/applyPlan）
    //   都经本方法排队 ⇒ 这里收口即可覆盖 memory_log / memory_user / 沉淀 / 维护 / UI note。
    //   缺省实现与接线前**逐字节一致**（不传即恒等直通）。
    // 缺省边界与接线前**逐字节一致**：`work()` 不传参 ⇒ job 用队列自己的 target（见 _queue 的兜底）。
    this.mutationBoundary = opts.mutationBoundary || ((file, work) => work(file))
    this.mutationAdmission = opts.mutationAdmission || (() => undefined)
    /**
     * ★#263（P2a）：**受理时刻的允许根**取用器（缺省 = 从本次 admission 快照里读）。
     *  为什么必须由边界传进来：只有边界知道「这次写是被哪一份配置受理的」。
     *  为什么不能自己读配置：本模块刻意不依赖引擎与配置（纯文档层），自行读盘会引入新的
     *  时序面（配置可能在写盘途中被改）——那正是本条缺陷的同类形状。
     */
    // 别名基准取用器（缺省 = 钉 target 的物理父目录；测试可注入固定值）。
    this.aliasPinOf = opts.aliasPinOf || ((target) => pinTargetAliasPre(target))
    // ★#311：别名稳定性校验的**任务私有**作用域（见 _rootGuard getter/setter 的说明）。
    //   每个 _queue 任务在自己的 `run()` 作用域里设 guard；实例回退槽只服务旧式显式赋值。
    this._rootGuardCtx = new AsyncLocalStorage()
    this._rootGuardFallback = null
    // ★#306：跨进程文档锁。旧实现的 `_locks` 只是**进程内** Map ⇒ 两个 Node 进程先读同一旧文件、
    //   各自提交，后写覆盖先写（报告者反例：A 的记录消失）。锁必须落在**物理路径**上、跨进程生效。
    //   默认开启；设 false 可退回旧行为（供不需要该保证的嵌入式调用方）。
    this.crossProcessLock = opts.crossProcessLock !== false
    this.lockTimeoutMs = Number.isFinite(opts.lockTimeoutMs) ? opts.lockTimeoutMs : 10000
  }

  /**
   * ★#306：把一次「读 → 改 → 校验 → 原子替换 → 回读 → sidecar」整体纳入**物理路径跨进程锁**。
   *
   * 为什么不能只靠 CAS 摘要：摘要只能在**提交瞬间**发现「文件已变」，发现时本次改动已经失败，
   *   调用方拿到的是拒绝而不是「两条记录都在」。跨进程场景下正确的语义是**串行化**——
   *   后到者进锁后重新读到先到者的结果，再做自己的追加。锁是事务，CAS 是它之上的额外保护。
   *
   * 锁文件位置 = `<文档路径>.lock`：与本仓既有约定一致（lib/index.js 的 writer 产物过滤
   *   已按 `.lock` / `.lock.acquire` 后缀排除，settings 迁移也按 entry-type 排除），不新起命名空间。
   *
   * 释放纪律：release 自身异常**不得**覆盖 job 的真实结果/错误（finally 里吞掉并留给超时回收）。
   * 获取失败：**fail closed** —— 拿不到锁就不写、返回结构化失败。绝不「拿不到锁就直接写」，
   *   那等于把本条缺陷原样保留（这正是「不能导致错误成功回执」的要求）。
   */
  async _withDocLock(filePath, job, opts = {}) {
    // ★acquireOnly（#306-fix）：**只取锁、不起手 job**，返回一个「锁到手后再同步起手 job」的 promise。
    //   存在的唯一理由是保住 _queue 的「不同文件不被全局串行化」契约 —— 详见 _queue 里的注释。
    //   语义等价：返回值与整段包住完全一样（含 fail-closed 失败形态与 release）。
    const acquireOnly = opts.acquireOnly === true
    if (this.crossProcessLock === false) {
      if (!acquireOnly) return job()
      // 无锁模式：仍需给调用方一个 promise；job 在下一微任务同步起手（与真实取锁路径同形）。
      let noopResolve
      const p = new Promise((resolve) => { noopResolve = resolve })
      void Promise.resolve().then(() => { try { noopResolve(job()) } catch (e) { noopResolve(Promise.reject(e)) } })
      return p
    }
    // ★#306-fix：取锁一律用**同步**版 —— 这样 `job` 能在**同一同步段**内起手，
    //   保住 `_queue` 的「不同文件不被全局串行化」契约（见上方注释与 issue48 的取证）。
    //   同步版与 async 版**协议同形**（同一个 .lock 文件、同一套死主判定）⇒ 两版互相排斥。
    let release = null
    try {
      release = acquireSharedStateLockSync(String(filePath) + '.lock', { timeoutMs: this.lockTimeoutMs, pollMs: this.lockPollMs })
    } catch (e) {
      return {
        ok: false,
        reason: 'lock-unavailable:' + ((e && e.message) || String(e)),
        errorCode: 'MEMORY_WRITE_FAILED',
        written: false,
        stage: 'lock',
      }
    }
    try { return await job() } finally { try { release() } catch (_) { /* 留给超时/死锁回收 */ } }
  }

  /**
   * ★#263（P2a）：**边界最终目标必须流进 job** —— 这是本条的根因。
   *
   * 旧写法：`this.mutationBoundary(target, () => job(target))` —— job 闭包**忽略**边界传入的路径，
   *   继续用 lexical 的 `target`。于是「准入 + 锁」通过之后的所有阶段（readFile/backup/tmp/rename/verify）
   *   都在拿 lexical 路径重新解析目录别名：期间把目录 junction 改指到记忆根之外，整篇写入落到根外。
   * 新写法：job 接收边界给出的路径；再加一道**写盘前复核**（见 _commit），两道都过才可能越界。
   */
  _queue(filePath, job) {
    // ★#249：admission 在**入队时**同步捕获（其后 job 与它同步紧邻，无跨 await 缝隙）。
    // ★#263：同一同步段里钉住 **target 的物理父目录** —— 这是「别名是否被改指」的比较基准。
    //   必须在同步段钉：异步之后再解析，别名可能已经被改指（那正是要检测的事件）。
    let admission, target, aliasPin
    try {
      admission = this.mutationAdmission(filePath)
      target = (admission && admission.target) || path.resolve(String(filePath))
      aliasPin = null   // ★#263：基准在**第一次拿到有效目标时**钉（见 within），不在同步段钉 lexical 路径
    } catch (error) { return Promise.reject(error) }
    const key = memoryWriteLockKey(target)
    const prev = this._locks.get(key) || Promise.resolve()
    // 队列只保证本进程内的次序；admission 边界负责与设置迁移（跨进程同一把锁）互斥。
    // 边界返回的目标可能被它自己改写（如根绑定复核后的新鲜目的地）⇒ 以它为准传给 job。
    // ★#263 分层（两层各守一段，缺一不可）：
    //   ① 边界层：校验**边界最终选定的**目标（`bound`）——只有它才是这次写真正会用的路径。
    //      为什么不校验 lexical 的 target：边界的职责正是「把目标改判到新鲜/物理目的地」（见 P1 的
    //      根绑定复核）；先拿 lexical 拦一道会把合法改判误杀。
    //   ② 提交层：`_commit` 在**每次 rename 前**复核（含退避重试）——覆盖「读盘/备份期间被重定向」，
    //      也就是报告者反例里那一段（边界早已放行，别名在写盘途中被改指）。
    const within = async (file) => {
      // ★#263：基准 = **边界最终选定的那个目标**的物理父目录，在写盘链**第一次**进入时钉住
      //   （此刻尚未 await 过任何 IO ⇒ 别名不可能已被改指；其后每次复核都与此基准比）。
      //   为什么不钉 lexical 的 target：边界可能把目标改判到它的物理/新鲜目的地（P1 根绑定复核），
      //   拿 lexical 当基准会把**合法改判**误判成「别名被改指」（m3b3 实测到的假拒绝）。
      if (!aliasPin) aliasPin = this.aliasPinOf(file)
      // 边界层：进写盘链之前先比一次（覆盖「入队到执行之间」被改指）。
      const guard = targetAliasStablePre(file, aliasPin)
      if (!guard.ok) throw memoryPathEscapedError(file, guard.physical)
      // 同一判据供 _commit 在**每次 rename 前**复核（含退避重试）——覆盖「readFile/backup 期间被改指」。
      // ★#311：**必须按任务隔离**（旧实现写实例字段 ⇒ 不同目录的并行写互相覆写基准：先进入者拿自己
      //   的 rename 去比别人的目录 ⇒ 假拒绝 MEMORY_PATH_ESCAPED；对称面是基准被摘掉后漏放行）。
      //   用 ALS.run 建立**本任务私有**作用域：guard 只在此异步链内可见，并发任务彼此不可见，
      //   且随 async 传播到 _commit → atomicReplace → beforeRename 的嵌套 await，无需层层传参。
      //   （这就是 `_rootGuard` getter 的取值来源；实例回退槽保持 null ⇒ 与本任务无关的写不受影响。）
      const guardFn = (f) => targetAliasStablePre(f, aliasPin)
      // ★#306：别名基准（#311 的 ALS 作用域）之内，再把**整个读改写事务**包进物理路径跨进程锁。
      //   锁必须在 job 之外、且包住 job 内所有阶段（_readState → 渲染 → _commit → 回读 → sidecar），
      //   否则「先读到旧内容、后提交」的窗口仍然敞开 —— 那正是报告者反例里 A 的记录消失的成因。
      //
      // ★#306-fix（2026-10-08，本轮自测抓到的真回归）：**取锁必须是同步的**。
      //   教训：`_queue` 的既有契约「different files are not globally serialized」依赖
      //   「`job` 在**同一同步段**内起手」—— 旧写法 `return await job(file)` 里 `job(file)` 是同步调用的。
      //   若在 job 之前插入**异步**取锁（lstat/realpath/mkdir 全要 await），job 的起手会被推迟若干微任务，
      //   两个不同文件的任务便同时在途 ⇒ **起手顺序变成竞态**。
      //   取证：`tests/smoke/smoke-test-issue48.mjs:194` 断言 `deepEqual(events,['a','b'])`，
      //   异步取锁版实测单独跑 **10 次红 6 次**（与本机负载正相关）；改同步取锁后复绿。
      //   故锁一律走 `acquireSharedStateLockSync`（协议与 async 版同形、互相排斥）。
      return await this._rootGuardCtx.run(guardFn, () => this._withDocLock(file, () => job(file)))
    }
    const run = prev.then(
      () => this.mutationBoundary(target, (bound) => within(bound || target), admission),
      () => this.mutationBoundary(target, (bound) => within(bound || target), admission),
    )
    const settled = run.then(() => {}, () => {})
    this._locks.set(key, settled)
    // 队列空闲即回收条目,避免长期运行 Map 无界增长;新任务到达时会重新建立链条
    settled.then(() => { if (this._locks.get(key) === settled) this._locks.delete(key) })
    return run
  }



  async _readState(filePath) {
    try {
      const buf = await this.fs.readFile(filePath)
      const parsed = parseAnchors(buf)
      // P1 步 3：状态版本（`expectedStateVersion`）取自 sidecar 的 `sourceVersion` + `epoch`。
      // 仅当 sidecarDir 配置且 sidecar 可读时才有值；否则为 null ⇒ 状态闸按 "(unknown)" 拒绝
      // （fail-closed：证明不了"同一版本"就不写，与身份门的既有口径一致）。
      let stateVersion = null
      if (this.sidecarDir) {
        const cur = await this.readSidecar(filePath)
        if (cur && cur.ok && cur.sidecar) {
          const sv = cur.sidecar.sourceVersion
          const ep = cur.sidecar.epoch
          if (sv != null) stateVersion = (ep != null ? String(ep) + ':' : '') + String(sv)
        }
      }
      return { buf, parsed, fileDigest: sha256Hex(buf), stateVersion }
    } catch (e) {
      if (e && e.code === 'ENOENT') return { buf: null, parsed: null, fileDigest: null, stateVersion: null }
      throw e
    }
  }

  /**
   * ★2026-09-15（P1 步 3 · 设计稿 §2.3）：**提交边界内**的版本校验（并发原子边界）。
   *
   * **为什么必须在这里、而不是调用方**：P1 卡明确 —— "两个写者都先读 D、都通过比较、再分别
   * 写 A 和 B ⇒ 后写者仍会覆盖前写者"。唯一正确的做法是让"读当前状态 → 比较 → 写"三步
   * **在同一个队列任务内**完成（`_queue` 按路径串行，见 `:235`）。本助手只被 `_queue(...)`
   * **内部**调用，因此天然满足该边界；绝不要在队列外用它做预检。
   *
   * 双闸（各自独立，都可单独启用）：
   *   - `expectedDigest`：字节级（防"用户改了文件"）—— 既有语义，保持不动。
   *   - `expectedStateVersion`：状态级（防"另一个窗口改了图/换了状态"）—— P1 新增。
   *
   * **兼容档（T1-8）**：两者都可缺省；缺省即不校验，行为与 P1 之前**逐字节一致**。
   * **可见冲突（T1-7C）**：拒绝时带 `expected/observed/target`，由调用方决定是否渲染成文本。
   *
   * ⚠️ 副作用零：只读 `state` 入参，不写盘、不改 state。
   */
  _checkCommitBoundary(filePath, state, opts) {
    const target = String(filePath || '')
    const wantsDigest = opts.expectedDigest !== undefined
    const wantsStateVersion = opts.expectedStateVersion != null
    // ① 字节闸（既有语义）：不匹配 ⇒ 拒绝且不写
    if (wantsDigest && state.fileDigest !== opts.expectedDigest) {
      return {
        ok: false,
        reason: 'conflict-external-edit',
        conflict: { kind: 'digest', target, expected: String(opts.expectedDigest), observed: state.fileDigest == null ? '(missing)' : String(state.fileDigest) },
      }
    }
    // ② 状态闸（P1 新增）：sidecar 的 sourceVersion 为状态版本；无 sidecar/无 prev 时视为 unknown
    if (wantsStateVersion) {
      const cur = state.stateVersion == null ? null : String(state.stateVersion)
      if (cur !== String(opts.expectedStateVersion)) {
        return {
          ok: false,
          reason: 'conflict-state-version',
          conflict: { kind: 'state-version', target, expected: String(opts.expectedStateVersion), observed: cur == null ? '(unknown)' : cur },
        }
      }
    }
    return { ok: true }
  }

  /** sidecar 路径:sidecarDir + '<sha256(canonicalSourcePath)>.json'(契约 §6;canonical=resolve+正斜杠+小写)。 */
  sidecarPath(filePath) {
    if (!this.sidecarDir) return null
    const canon = path.resolve(filePath).replace(/\\/g, '/').toLowerCase()
    const hash = createHash('sha256').update(canon, 'utf8').digest('hex')
    return path.join(this.sidecarDir, hash + '.json')
  }

  async _writeSidecar(filePath, sidecar) {
    const sp = this.sidecarPath(filePath)
    if (!sp) throw new Error('no-sidecar-dir')
    await this.fs.mkdir(path.dirname(sp), { recursive: true })
    // sidecar 是**可重建的派生数据**:失败时保留候选快照只会积累垃圾,故显式关闭 preserveOnFailure
    // (与 Markdown 正文档相反——正文档失败必须保住快照供人工比对)。
    await atomicReplace(sp, Buffer.from(JSON.stringify(sidecar, null, 2) + '\n', 'utf8'), this.fs, { ...this.atomicOptions, preserveOnFailure: false })
  }

  /** 读已落盘 sidecar;损坏返回 {ok:false,reason} 由调用方隔离并从 Markdown 重建。 */
  async readSidecar(filePath) {
    const sp = this.sidecarPath(filePath)
    if (!sp) return { ok: false, reason: 'no-sidecar-dir' }
    try {
      const text = await this.fs.readFile(sp, 'utf8')
      return parseSidecar(text)
    } catch (e) {
      return { ok: false, reason: e && e.code === 'ENOENT' ? 'missing' : 'io-error' }
    }
  }

  /**
   * ★#311（2026-10-08）：**别名稳定性校验按任务（async 上下文）隔离**。
   *
   * 缺陷现场：旧实现把它放成**实例字段** `this._rootGuard` —— 而队列是按**文件**分离的
   *   （`_locks` 的键 = memoryWriteLockKey(target)）。于是两个**不同目录**的文件并行写时：
   *   后进入的那个任务把 `this._rootGuard` 覆写成**自己的**基准，先进入的任务随即拿自己刚写的
   *   rename 去比**别人的**目录 ⇒ 明明没有任何别名改指，却报 MEMORY_PATH_ESCAPED（假拒绝）。
   *   更糟的对称面：A 的 guard 若被 B 摘掉，A 在「读盘/备份期间被改指」就**不再被拦**（漏放行）。
   *
   * 修法：用 AsyncLocalStorage 承载「本任务链的基准」。ALS 的语义正是「同一条异步执行链内可见、
   *   并发任务彼此不可见」，与 `_queue` 的 per-file 并行结构天然对齐；且它随 async 上下文传播，
   *   `_commit` 里 `atomicReplace → beforeRename` 的嵌套 await 也不必显式透传参数。
   *
   * 兼容：既有测试与外部调用点若仍写 `store._rootGuard = fn`（旧形态），这里保留 setter/getter ——
   *   getter 优先取本任务上下文，其次回落到实例上的显式设定值（旧语义在**单任务**场景下不变）。
   */
  get _rootGuard() {
    const scoped = this._rootGuardCtx && this._rootGuardCtx.getStore()
    if (scoped) return scoped
    return this._rootGuardFallback || null
  }

  set _rootGuard(fn) {
    // 只写「实例回退槽」，**绝不调用 enterWith**：enterWith 会改当前 async 上下文并可能把
    //   某个并发任务的基准泄露给后续任务 —— 那正是本缺陷的形态，不能在新实现里重演。
    //   队列路径一律由 _queue 用 _rootGuardCtx.run(...) 建立**任务私有**作用域（优先级更高）。
    this._rootGuardFallback = fn || null
  }

  /** 事务提交(步骤 4-10):校验无 BOM → backup → atomicReplace → 重读校验 → sidecar。 */
  async _commit(filePath, content, opts = {}) {
    const out = toBuf(content)
    if (out.length >= 3 && out[0] === 0xef && out[1] === 0xbb && out[2] === 0xbf) return { ok: false, reason: 'bom-rejected' }
    let existed = true
    try { await this.fs.stat(filePath) } catch (e) { if (e && e.code === 'ENOENT') existed = false; else throw e }
    if (this.backupDir && existed) {
      try {
        await this.fs.mkdir(this.backupDir, { recursive: true })
        const bakName = this.now().toString() + '-' + randomUUID().slice(0, 8) + '-' + path.basename(filePath)
        await this.fs.copyFile(filePath, path.join(this.backupDir, bakName))
      } catch (e) {
        return { ok: false, reason: 'backup-failed:' + (e && e.message ? e.message : String(e)) }
      }
    }
    try {
      await atomicReplace(filePath, out, this.fs, { ...this.atomicOptions, beforeRename: async () => {
        // ★#263（P2a）：**rename 前最后一次复核** —— 目录别名可能在读盘/备份/写 tmp 期间被重定向。
        //   放在 beforeRename 里是有意的：atomicReplace 的每一次 rename 尝试（含退避重试）都会重新调用它，
        //   所以「重试窗口内被改指」同样拦得住。
        if (this._rootGuard) {
          const guard = this._rootGuard(filePath)
          if (!guard.ok) throw memoryPathEscapedError(filePath, guard.physical)
        }
        if (this.atomicOptions.beforeRename) await this.atomicOptions.beforeRename()
        if (!Object.prototype.hasOwnProperty.call(opts, 'expectedDigest')) return
        const current = await this.fs.readFile(filePath).catch((e) => { if (e.code === 'ENOENT') return null; throw e })
        if ((current ? sha256Hex(current) : null) !== opts.expectedDigest) {
          const error = new Error('conflict-external-edit'); error.code = 'MEMORY_CONFLICT'; throw error
        }
      } })
    } catch (e) {
      // issue #48:结构化保留失败态(含 recoveryPath/partialPath),供上层给出可操作报错
      return {
        ok: false, reason: e && e.code === 'MEMORY_CONFLICT' ? 'conflict-external-edit' : 'write-failed:' + (e && e.message ? e.message : String(e)),
        errorCode: 'MEMORY_WRITE_FAILED', fsCode: e && e.code, written: false,
        recoveryPath: e && e.recoveryPath, recoveryComplete: !!(e && e.recoveryComplete),
        partialPath: e && e.partialPath, stage: e && e.stage,
        recoveryUnavailable: !!(e && e.recoveryUnavailable),
      }
    }
    let reread
    try { reread = await this.fs.readFile(filePath) } catch (e) { return { ok: false, reason: 'verify-read-failed', written: true } }
    const digest = sha256Hex(reread)
    // 契约 §8 步骤 8:重读内容必须与预期写入字节一致,否则视为写入后损坏(不回滚,显式报错)
    if (digest !== sha256Hex(out)) return { ok: false, reason: 'verify-mismatch', written: true }
    // sidecar 尽力落盘;失败标记 dirty,不回滚已成功写入的 Markdown(契约 §6)。
    // prev 优先用调用方传入;否则自动读已落盘 sidecar → digest 变化即 version+1、epoch 保持,
    // sidecar 缺失/损坏 → 视为无 prev → 新 epoch(契约 §6 重建语义)。
    let dirty = false
    let sidecar = null
    if (this.sidecarDir) {
      let prevSidecar = opts.prevSidecar
      if (!prevSidecar) {
        const cur = await this.readSidecar(filePath)
        if (cur.ok) prevSidecar = cur.sidecar
      }
      const sb = buildSidecar({ sourceFile: filePath, content: reread, prev: prevSidecar })
      if (sb.ok) {
        try { await this._writeSidecar(filePath, sb.sidecar); sidecar = sb.sidecar } catch (_) { dirty = true }
      } else {
        dirty = true
      }
    }
    return { ok: true, digest, dirty, sidecar, written: true }
  }

  /** 未启用锚点时仍与其他写入共享同文件队列及提交边界。 */
  replaceRaw(filePath, replacement, opts = {}) {
    // ★#263：**用队列给出的有效目标**（可能是边界改判后的物理路径），不再闭包 lexical filePath。
    return this._queue(filePath, async (file) => {
      const state = await this._readState(file)
      const gate = this._checkCommitBoundary(file, state, opts)
      if (!gate.ok) return gate
      return this._commit(file, replacement, { expectedDigest: state.fileDigest })
    })
  }

  appendRaw(filePath, text) {
    return this._queue(filePath, async (file) => {
      const state = await this._readState(file)
      const existing = state.buf ? state.buf.toString('utf8') : ''
      const body = existing ? existing.replace(/\s+$/, '') + '\n' + text : text
      return { ...await this._commit(file, body, { expectedDigest: state.fileDigest }), text: body }
    })
  }

  /** 尾部追加记录(事务);同文件串行。 */
  append(filePath, text, opts = {}) {
    return this._queue(filePath, async (file) => {
      const state = await this._readState(file)
      const gate = this._checkCommitBoundary(file, state, opts)
      if (!gate.ok) return gate
      const memoryId = opts.memoryId || this.idFactory()
      const app = appendAnchoredRecord(state.buf, { memoryId, text })
      if (!app.ok) return app
      const res = await this._commit(file, app.text, { prevSidecar: opts.prevSidecar, ...(opts.expectedDigest !== undefined ? { expectedDigest: state.fileDigest } : {}) })
      return { ...res, memoryId }
    })
  }

  /** 整篇替换(§9);同文件串行。 */
  replace(filePath, replacement, opts = {}) {
    return this._queue(filePath, async (file) => {
      const state = await this._readState(file)
      const gate = this._checkCommitBoundary(file, state, opts)
      if (!gate.ok) return gate
      const rr = renderReplace(state.buf, replacement, { idFactory: opts.idFactory || this.idFactory })
      if (!rr.ok) return rr
      const res = await this._commit(file, rr.text, { prevSidecar: opts.prevSidecar, ...(opts.expectedDigest !== undefined ? { expectedDigest: state.fileDigest } : {}) })
      return { ...res, added: rr.added, kept: rr.kept, foreign: rr.foreign, removed: rr.removed }
    })
  }

  /** 单记录整篇替换(reflection 等单记录文档,契约 §3 粒度);同文件串行。 */
  replaceSingle(filePath, text, opts = {}) {
    return this._queue(filePath, async (file) => {
      const state = await this._readState(file)
      const gate = this._checkCommitBoundary(file, state, opts)
      if (!gate.ok) return gate
      const rr = replaceSingleRecord(state.buf, text, { idFactory: opts.idFactory || this.idFactory })
      if (!rr.ok) return rr
      const res = await this._commit(file, rr.text, { prevSidecar: opts.prevSidecar, ...(opts.expectedDigest !== undefined ? { expectedDigest: state.fileDigest } : {}) })
      return { ...res, memoryId: rr.memoryId }
    })
  }

  /** 应用迁移计划(事务);同文件串行。 */
  applyPlan(filePath, plan, opts = {}) {
    return this._queue(filePath, async (file) => {
      const state = await this._readState(file)
      // P1 步 3：本方法同样写盘 ⇒ 必须走同一边界校验（此前它连 expectedDigest 都未检查）
      const gate = this._checkCommitBoundary(filePath, state, opts)
      if (!gate.ok) return gate
      const ap = applyMigrationPlan(state.buf, plan)
      if (!ap.ok) return ap
      const res = await this._commit(filePath, ap.text, { prevSidecar: opts.prevSidecar, ...(opts.expectedDigest !== undefined ? { expectedDigest: state.fileDigest } : {}) })
      return { ...res, applied: ap.applied }
    })
  }

  /** 只重建 sidecar(不改 Markdown);无 prev → 新 epoch + sourceVersion=1(契约 §6)。 */
  rebuildSidecar(filePath, prev) {
    return this._queue(filePath, async () => {
      const state = await this._readState(filePath)
      if (!state.buf) return { ok: false, reason: 'missing' }
      const sb = buildSidecar({ sourceFile: filePath, content: state.buf, prev: prev || undefined })
      if (!sb.ok) return sb
      await this._writeSidecar(filePath, sb.sidecar)
      return { ok: true, sidecar: sb.sidecar }
    })
  }
}

export { toBuf }
