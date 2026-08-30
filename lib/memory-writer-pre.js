/**
 * MemoryDocumentWriter — M3b-2 原子写入基础设施(契约 §8-§9,M-06 project/atomicWrite 对应层)。
 * 本阶段不接入真实写路径(M3b-3 才逐路径迁移)、不迁移真实 Markdown(memoryAnchorEnabled=false)。
 *
 * 组成:
 * 1) 纯渲染原语(无 fs、零副作用):applyMigrationPlan / appendAnchoredRecord / renderReplace,
 *    与 memory-anchor-pre.js 的 parseAnchors 成对,保证 render→parse 幂等与身份稳定。
 * 2) atomicReplace(target, data, fs):同目录临时文件 + fsync + rename(Windows 覆盖须实测)。
 * 3) MemoryDocumentStore:per-file 串行 Promise 队列、digest precondition、backup、
 *    sidecar 落盘/重建(契约 §6 路径语义)、故障注入接口(fs 可注入)。
 *
 * 渲染规则:marker 独占一行(<!-- memory:mem_xxx -->);追加时 marker 后空行分隔内容;
 * 换行风格沿用目标文件既有风格(LF/CRLF 保持,契约 §10);输出从不含 BOM。
 */
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fsDefault } from 'node:fs'
import {
  parseAnchors, buildSidecar, parseSidecar, newMemoryId, MEMORY_ID_RE, ANCHOR_PREFIX, detectNewline,
} from './memory-anchor-pre.js'
import { INDEX_MAX_FILE_BYTES } from './memory-index-pre.js'

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
  if (parsed.status !== 'clean') return { ok: false, reason: 'conflict:' + parsed.conflicts.map((c) => c.type).join(',') }
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
  const buf = toBuf(content)
  if (buf.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized' }
  const parsed = parseAnchors(buf)
  if (parsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (parsed.status !== 'clean') return { ok: false, reason: 'conflict:' + parsed.conflicts.map((c) => c.type).join(',') }
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
  if (oldParsed.status !== 'clean') return { ok: false, reason: 'conflict:' + oldParsed.conflicts.map((c) => c.type).join(',') }
  const rp = parseAnchors(rep)
  if (rp.status === 'oversized') return { ok: false, reason: 'oversized-replacement' }
  if (rp.status !== 'clean') return { ok: false, reason: 'conflict:' + rp.conflicts.map((c) => c.type).join(','), conflicts: rp.conflicts }
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
  const oldBuf = toBuf(content)
  if (oldBuf.length > INDEX_MAX_FILE_BYTES) return { ok: false, reason: 'oversized' }
  const oldParsed = parseAnchors(oldBuf)
  if (oldParsed.status === 'oversized') return { ok: false, reason: 'oversized' }
  if (oldParsed.status !== 'clean') return { ok: false, reason: 'conflict:' + oldParsed.conflicts.map((c) => c.type).join(',') }
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
  if (check.status !== 'clean') return { ok: false, reason: 'conflict:' + check.conflicts.map((c) => c.type).join(','), conflicts: check.conflicts }
  const anchored = check.records.filter((r) => r.kind === 'anchored')
  if (anchored.length !== 1 || anchored[0].memoryId !== memoryId) return { ok: false, reason: 'not-single-record' }
  return { ok: true, text: candidate, memoryId }
}

/**
 * 原子替换默认 fs 适配器之外的注入目标(测试故障注入/sidecar 目录等)。
 * 同目录临时文件 + fsync + rename;任何失败清理临时文件并抛出。
 */
export async function atomicReplace(target, data, fsApi = fsDefault) {
  const dir = path.dirname(target)
  const tmp = path.join(dir, '.dam-pre-tmp-' + randomUUID().slice(0, 8) + '-' + path.basename(target))
  await fsApi.mkdir(dir, { recursive: true })
  let handle = null
  try {
    handle = await fsApi.open(tmp, 'w')
    await handle.writeFile(data)
    await handle.sync()
    await handle.close()
    handle = null
    await fsApi.rename(tmp, target)
  } catch (e) {
    if (handle) { try { await handle.close() } catch (_) {} }
    try { await fsApi.unlink(tmp) } catch (_) {}
    throw e
  }
}

/**
 * per-file 串行写入事务(契约 §8 步骤 1-10):
 * 读当前字节 → parse 验证 → 生成新内容 → 无 BOM/anchor 唯一校验 → tmp+fsync →
 * backup → rename → 重读校验 digest → sidecar 重建(失败标记 dirty,不回滚 Markdown)。
 * expectedDigest 不匹配(外部编辑) → 拒绝且不写。同文件并发写经队列串行,不丢失。
 * fs/sidecarDir/backupDir 可注入(故障注入测试);sidecarDir 未配置则不做 sidecar 落盘。
 */
export class MemoryDocumentStore {
  constructor(opts = {}) {
    this.fs = opts.fs || fsDefault
    this.sidecarDir = opts.sidecarDir || null
    this.backupDir = opts.backupDir || null
    this.now = opts.now || (() => Date.now())
    this.idFactory = opts.idFactory || newMemoryId
    this._locks = new Map()
  }

  _queue(filePath, job) {
    const key = path.resolve(filePath)
    const prev = this._locks.get(key) || Promise.resolve()
    const run = prev.then(job, job)
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
      return { buf, parsed, fileDigest: sha256Hex(buf) }
    } catch (e) {
      if (e && e.code === 'ENOENT') return { buf: null, parsed: null, fileDigest: null }
      throw e
    }
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
    await atomicReplace(sp, Buffer.from(JSON.stringify(sidecar, null, 2) + '\n', 'utf8'), this.fs)
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
      await atomicReplace(filePath, out, this.fs)
    } catch (e) {
      return { ok: false, reason: 'write-failed:' + (e && e.message ? e.message : String(e)) }
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

  /** 尾部追加记录(事务);同文件串行。 */
  append(filePath, text, opts = {}) {
    return this._queue(filePath, async () => {
      const state = await this._readState(filePath)
      if (opts.expectedDigest != null && state.fileDigest !== opts.expectedDigest) return { ok: false, reason: 'conflict-external-edit' }
      const memoryId = opts.memoryId || this.idFactory()
      const app = appendAnchoredRecord(state.buf, { memoryId, text })
      if (!app.ok) return app
      const res = await this._commit(filePath, app.text, { prevSidecar: opts.prevSidecar })
      return { ...res, memoryId }
    })
  }

  /** 整篇替换(§9);同文件串行。 */
  replace(filePath, replacement, opts = {}) {
    return this._queue(filePath, async () => {
      const state = await this._readState(filePath)
      if (opts.expectedDigest != null && state.fileDigest !== opts.expectedDigest) return { ok: false, reason: 'conflict-external-edit' }
      const rr = renderReplace(state.buf, replacement, { idFactory: opts.idFactory || this.idFactory })
      if (!rr.ok) return rr
      const res = await this._commit(filePath, rr.text, { prevSidecar: opts.prevSidecar })
      return { ...res, added: rr.added, kept: rr.kept, foreign: rr.foreign, removed: rr.removed }
    })
  }

  /** 单记录整篇替换(reflection 等单记录文档,契约 §3 粒度);同文件串行。 */
  replaceSingle(filePath, text, opts = {}) {
    return this._queue(filePath, async () => {
      const state = await this._readState(filePath)
      if (opts.expectedDigest != null && state.fileDigest !== opts.expectedDigest) return { ok: false, reason: 'conflict-external-edit' }
      const rr = replaceSingleRecord(state.buf, text, { idFactory: opts.idFactory || this.idFactory })
      if (!rr.ok) return rr
      const res = await this._commit(filePath, rr.text, { prevSidecar: opts.prevSidecar })
      return { ...res, memoryId: rr.memoryId }
    })
  }

  /** 应用迁移计划(事务);同文件串行。 */
  applyPlan(filePath, plan, opts = {}) {
    return this._queue(filePath, async () => {
      const state = await this._readState(filePath)
      const ap = applyMigrationPlan(state.buf, plan)
      if (!ap.ok) return ap
      const res = await this._commit(filePath, ap.text, { prevSidecar: opts.prevSidecar })
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
