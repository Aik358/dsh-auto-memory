/** 子代理痕迹回收(pre 线,2026-09-08)。
 *
 * 背景(实测 2026-09-08):DSH 会为每个子代理创建持久化会话
 * `~/.dsh/sessions/<工作区>/<裸 uuid>/session.jsonl.zstd`,header 形如
 * `{origin:'subagent', parentSession, delegationDepth}`;一次性委派结束后文件仍留在磁盘。
 * 本插件的 auto-memory-* 子代理(自动沉淀 / 时段总结 / 问候 / 蒸馏 / 关键词)高频产生:
 * 实测全机 686 个子代理会话(302MB)中 638 个(93%)来自本插件,数量上千后拖慢会话列表
 * 与投影缓存加载,并可能触发子代理目录诊断报错。
 *
 * 本模块只做两件事,边界清晰、可单测:
 *   1) 扫描:识别「本插件产生的、已结束的一次性子代理会话」
 *      (origin==='subagent' && descriptor.label 以 auto-memory- 开头 && descriptor.mode==='one-shot');
 *   2) 回收:把会话目录 + 投影缓存文件**移动**到备份目录(不做不可逆删除,可整体回滚)。
 *
 * 安全边界:
 *   - 绝不触碰普通会话(目录名以 session- 开头 / header.origin !== 'subagent');
 *   - continuable 子代理(可续聊)一律跳过;
 *   - keepMs 之内新产生的会话跳过(避免与运行中的子代理竞争);
 *   - 任一步失败只记录,不抛错(调用方 fail-soft)。
 */

import { readdir, stat, rename, mkdir, access } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { zstdDecompressSync } from 'node:zlib'
import path from 'node:path'

/** 本插件 spawn 的子代理 label 前缀(runSubagent 的 label 参数)。 */
export const PLUGIN_LABEL_PREFIX = 'auto-memory-'

/** 默认保留时长:3 天(兜底 GC 用;任务结束即删路径不受此限制)。 */
export const DEFAULT_KEEP_MS = 3 * 24 * 60 * 60 * 1000

/**
 * 按块头定位多帧 zstd 文件的每个帧区间。
 * 会话日志是逐事件追加的独立 zstd 帧,单次 zstdDecompressSync 只解第一帧。
 * @param {Buffer} buf - 原始文件内容。
 * @returns {{start:number,end:number}[]} 帧区间。
 */
export function scanZstdFrames(buf) {
  const frames = []
  let off = 0
  while (off + 4 <= buf.length && buf.readUInt32LE(off) === 0xfd2fb528) {
    const start = off
    const fhd = buf.readUInt8(off + 4)
    const fcsFlag = fhd >> 6
    const single = (fhd >> 5) & 1
    const dictFlag = fhd & 3
    const cksum = (fhd >> 2) & 1
    let p = off + 5
    if (!single) p += 1
    if (dictFlag === 1) p += 1
    else if (dictFlag === 2) p += 2
    else if (dictFlag === 3) p += 4
    if (fcsFlag === 0) { if (single) p += 1 }
    else if (fcsFlag === 1) p += 2
    else if (fcsFlag === 2) p += 4
    else p += 8
    off = p
    let broken = false
    for (;;) {
      if (off + 3 > buf.length) { broken = true; break }
      const bh = buf.readUIntLE(off, 3)
      off += 3
      const last = bh & 1
      const btype = (bh >> 1) & 3
      let bsize = bh >>> 3
      if (btype === 1) bsize = 1
      else if (btype === 3) { broken = true; break }
      off += bsize
      if (last) break
    }
    if (cksum) off += 4
    if (broken && off > buf.length) break
    frames.push({ start, end: Math.min(off, buf.length) })
    if (off >= buf.length) break
  }
  return frames
}

/**
 * 多帧 zstd 全量解压为文本(单帧文件同样适用)。
 * @param {Buffer} buf - 原始文件内容。
 * @returns {string} 解压文本(坏帧跳过)。
 */
export function decodeZstdFrames(buf) {
  const parts = []
  for (const fr of scanZstdFrames(buf)) {
    try { parts.push(zstdDecompressSync(buf.subarray(fr.start, fr.end))) } catch (e) { /* 坏帧跳过 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * 头帧解码:仅解压前 maxFrames 帧(或累计超 maxBytes 即停)。
 *
 * 背景(实测 2026-09-11,DSH Desktop 0.5.10 / Electron 内置 Node 22.22.1):
 * Node 22 的实验性 `node:zlib` zstd 在解压巨型会话文件(数 MB 压缩、数万帧)
 * 时会令整个宿主进程直接崩溃(crashpad not connected,无 JS 异常可捕获);
 * 同样的文件在 Node 24 下正常。扫描会话头(header + subagent descriptor)
 * 只需要最前面几帧,因此扫描路径一律改用本函数,避免全量解压巨型旧会话。
 * @param {Buffer} buf - 原始文件内容。
 * @param {number} [maxFrames=8] - 最多解压的帧数。
 * @param {number} [maxBytes=4*1024*1024] - 解压结果累计上限(字节),超出即停。
 * @returns {string} 前若干帧解压文本(坏帧跳过)。
 */
export function decodeZstdFramesHead(buf, maxFrames = 8, maxBytes = 4 * 1024 * 1024) {
  const parts = []
  let frames = 0
  let bytes = 0
  for (const fr of scanZstdFrames(buf)) {
    if (frames >= maxFrames || bytes >= maxBytes) break
    try {
      const part = zstdDecompressSync(buf.subarray(fr.start, fr.end))
      parts.push(part)
      frames++
      bytes += part.length
    } catch (e) { /* 坏帧跳过 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * 从会话日志文本里取首帧 header 与 subagent descriptor。
 * @param {string} text - 解压后的 JSONL 文本。
 * @returns {{header:object|null,descriptor:{label?:string,mode?:string}|null,eventCount:number}}
 */
export function parseSessionHead(text) {
  let header = null
  let descriptor = null
  let eventCount = 0
  for (const ln of String(text).split('\n')) {
    if (!ln) continue
    let ev = null
    try { ev = JSON.parse(ln) } catch (e) { continue }
    eventCount++
    if (ev.type === 'session' && header === null) header = ev
    else if (ev.type === 'subagent/descriptor' && descriptor === null && ev.data && typeof ev.data === 'object') {
      descriptor = { label: ev.data.label, mode: ev.data.mode }
    }
    if (header !== null && descriptor !== null) break
  }
  return { header, descriptor, eventCount }
}

/**
 * 判定一个会话目录是否属于「本插件产生的一次性子代理痕迹」。
 * @param {{header:object|null,descriptor:object|null}} head - parseSessionHead 的结果。
 * @param {{labelPrefix?:string,keepMs?:number,now?:number,mtimeMs?:number}} opts - 判据。
 * @returns {{hit:boolean,reason:string,label:string,mode:string}}
 */
export function isPluginOneShotSubagent(head, opts = {}) {
  const labelPrefix = opts.labelPrefix || PLUGIN_LABEL_PREFIX
  const keepMs = Number.isFinite(opts.keepMs) ? Number(opts.keepMs) : DEFAULT_KEEP_MS
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now()
  const header = head && head.header
  const descriptor = head && head.descriptor
  const label = String((descriptor && descriptor.label) || '')
  const mode = String((descriptor && descriptor.mode) || '')
  if (!header) return { hit: false, reason: 'no-header', label, mode }
  if (header.origin !== 'subagent') return { hit: false, reason: 'not-subagent', label, mode }
  if (header.parentSession === undefined || header.parentSession === null || header.parentSession === '') {
    return { hit: false, reason: 'no-parent', label, mode }
  }
  if (label === '' || !label.startsWith(labelPrefix)) return { hit: false, reason: 'foreign-label', label, mode }
  if (mode === 'continuable') return { hit: false, reason: 'continuable', label, mode }
  if (mode !== 'one-shot') return { hit: false, reason: 'unknown-mode', label, mode }
  const mt = Number(opts.mtimeMs || 0)
  if (keepMs > 0 && mt > 0 && now - mt < keepMs) return { hit: false, reason: 'too-recent', label, mode }
  return { hit: true, reason: 'hit', label, mode }
}

/**
 * 扫描会话根目录,列出可回收的本插件子代理会话。
 * @param {{sessionsRoot:string,labelPrefix?:string,keepMs?:number,now?:number,maxEntries?:number}} opts - 扫描参数。
 * @returns {Promise<{candidates:object[],scanned:number,subagents:number,bytes:number,reasons:Record<string,number>}>}
 */
export async function scanPluginSubagentSessions(opts = {}) {
  const sessionsRoot = opts.sessionsRoot
  if (!sessionsRoot) throw new Error('scanPluginSubagentSessions: sessionsRoot required')
  const labelPrefix = opts.labelPrefix || PLUGIN_LABEL_PREFIX
  const keepMs = Number.isFinite(opts.keepMs) ? Number(opts.keepMs) : DEFAULT_KEEP_MS
  const now = Number.isFinite(opts.now) ? Number(opts.now) : Date.now()
  const maxEntries = Number(opts.maxEntries || 20000)
  const out = { candidates: [], scanned: 0, subagents: 0, bytes: 0, reasons: {} }
  const bump = (r) => { out.reasons[r] = (out.reasons[r] || 0) + 1 }
  let wsDirs = []
  try { wsDirs = await readdir(sessionsRoot, { withFileTypes: true }) } catch (e) { return out }
  for (const ws of wsDirs) {
    if (!ws.isDirectory()) continue
    const wsDir = ws.name
    let entries = []
    try { entries = await readdir(path.join(sessionsRoot, wsDir), { withFileTypes: true }) } catch (e) { continue }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue
      if (out.scanned >= maxEntries) break
      out.scanned++
      const sid = ent.name
      const dir = path.join(sessionsRoot, wsDir, sid)
      // 2.3.1:DSH 0.1.5 起会话格式迁移到 session.v3.jsonl.zstd(旧名前缀保留但停止更新);
      // 按 mtime 取最新存在的文件,兼容两代命名。
      let file = ''
      let st = null
      for (const name of ['session.v3.jsonl.zstd', 'session.jsonl.zstd']) {
        const cand = path.join(dir, name)
        try {
          const s = await stat(cand)
          if (s.isFile() && (!st || s.mtimeMs > st.mtimeMs)) { st = s; file = cand }
        } catch (e) {}
      }
      if (!st) { bump('no-file'); continue }
      let text = ''
      try { text = decodeZstdFramesHead(await readFile(file)) } catch (e) { bump('decode-error'); continue }
      const head = parseSessionHead(text)
      if (!head.header) { bump('no-header'); continue }
      if (head.header.origin === 'subagent') out.subagents++
      const verdict = isPluginOneShotSubagent(head, { labelPrefix, keepMs, now, mtimeMs: st.mtimeMs })
      bump(verdict.reason)
      if (!verdict.hit) continue
      out.candidates.push({
        wsDir,
        sid,
        dir,
        file,
        label: verdict.label,
        mode: verdict.mode,
        parentSession: String(head.header.parentSession || ''),
        delegationDepth: Number(head.header.delegationDepth || 0),
        sizeBytes: st.size,
        mtimeMs: st.mtimeMs,
      })
      out.bytes += st.size
    }
  }
  out.candidates.sort((a, b) => a.mtimeMs - b.mtimeMs)
  return out
}

/** 目标路径是否已存在。 */
async function exists(p) {
  try { await access(p); return true } catch (e) { return false }
}

/**
 * 把候选会话移动到备份目录(可回滚),并顺带移走对应的投影缓存文件。
 * 不做任何删除;同名冲突时跳过并记录。
 * @param {{candidates:object[],backupRoot:string,projcacheRoot?:string,apply?:boolean}} opts - 回收参数。
 * @returns {Promise<{moved:object[],skipped:object[],failed:object[],bytes:number,applied:boolean}>}
 */
export async function recycleSessions(opts = {}) {
  const apply = opts.apply === true
  const backupRoot = opts.backupRoot
  const projcacheRoot = opts.projcacheRoot || ''
  const out = { moved: [], skipped: [], failed: [], bytes: 0, applied: apply }
  if (!backupRoot) throw new Error('recycleSessions: backupRoot required')
  for (const c of opts.candidates || []) {
    const destDir = path.join(backupRoot, c.wsDir || '_', c.sid)
    try {
      if (await exists(destDir)) { out.skipped.push({ sid: c.sid, reason: 'backup-exists' }); continue }
      if (!apply) { out.moved.push({ sid: c.sid, label: c.label, sizeBytes: c.sizeBytes, to: destDir, dryRun: true }); out.bytes += c.sizeBytes; continue }
      await mkdir(path.dirname(destDir), { recursive: true })
      // Windows 下 rename 对被占用目录抛 EPERM(宿主/杀软句柄未释放)→ 短退避重试,仍失败则跳过等下次
      let renamed = false
      let lastErr = null
      for (const delay of [0, 250, 800, 2000]) {
        if (delay) await new Promise((r) => setTimeout(r, delay))
        try { await rename(c.dir, destDir); renamed = true; break } catch (e) { lastErr = e }
      }
      if (!renamed) throw lastErr
      out.moved.push({ sid: c.sid, label: c.label, sizeBytes: c.sizeBytes, to: destDir })
      out.bytes += c.sizeBytes
      if (projcacheRoot) {
        const cacheFile = path.join(projcacheRoot, c.sid)
        if (await exists(cacheFile)) {
          const cacheDest = path.join(backupRoot, '_projcache', c.sid)
          await mkdir(path.dirname(cacheDest), { recursive: true })
          await rename(cacheFile, cacheDest).catch(() => {})
        }
      }
    } catch (e) {
      out.failed.push({ sid: c.sid, error: e && e.message ? e.message : String(e) })
    }
  }
  return out
}
