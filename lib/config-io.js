/**
 * config-io.js —— 配置文件的**原子写**与**损坏隔离**（上游 issue #82 修复）。
 *
 * ## 背景（#82；已在 pre 线实跑核验：两条路径在优化后的版本里**仍然存在**）
 *
 * ① **写侧非原子**：配置落盘是裸 `writeFileSync`（同步路径）/ 裸 `writeFile`（异步路径）。
 *    进程写到一半被杀、或磁盘写满，会留下**半截 JSON**；下次启动 `JSON.parse` 抛错，
 *    于是直接回落出厂默认 ⇒ **用户此前的设置静默丢失**。
 *    同类裸写还出现在 `embedding-config.json`（语义引擎配置）。
 *
 * ② **读侧静默**：两个 load 函数的 catch 一律 `return _mergeConfigPre(null)`（出厂默认），
 *    错误只塞进 `this._readError` —— **用户看不到「我的配置坏了、已被重置」**。
 *    本仓铁律：fail-soft 必须返回**可观察**信号；静默回落等于「数据丢了但没人知道」。
 *
 * ## 本模块只做两件事，且**不改变既有语义**
 *
 * 1. `writeTextAtomicPreSync` / `writeTextAtomicPre`：写 tmp → `renameSync` 覆盖目标。
 *    同目录 rename 在同一文件系统上是**原子**的 ⇒ 读方永远只见「旧的完整版」或
 *    「新的完整版」，**永远不会看到半截文件**。
 * 2. `readJsonQuarantinePreSync`：解析失败时**先把坏文件改名留存**
 *    （`<name>.corrupt-<ts>`）再返回结构化失败。这样 ①用户数据没被覆盖
 *    ②诊断面能看见「曾经坏过、坏在哪」。
 *
 * ## 纪律
 *   - 零运行时依赖：只用 `node:fs` / `node:fs/promises` / `node:path`。
 *   - **fail-soft 但必须留痕**：任何一步失败都不抛，返回结构化结果让调用方处理。
 *   - CRLF、无 BOM。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** 临时文件后缀。与既有 hub 落盘的 `.tmp` 同族，便于排查时一眼认出。 */
export const ATOMIC_TMP_SUFFIX_V1 = '.tmp'

/** 损坏留存的默认后缀前缀。 */
export const CORRUPT_QUARANTINE_PREFIX_V1 = '.corrupt-'

/** 时间戳串（用于损坏留存命名）。绝不影响主流程。 */
function tsPre(now) {
  try {
    const d = typeof now === 'number' ? new Date(now) : new Date()
    const p = (n) => String(n).padStart(2, '0')
    return String(d.getFullYear()) + p(d.getMonth() + 1) + p(d.getDate())
      + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
  } catch (_) {
    return '0'
  }
}

/**
 * 把目标文件挪到同目录的旁路名（**不删除** —— 留证据）。
 * @returns {string} 旁路路径；失败返回空串（fail-soft，绝不抛）。
 */
export function quarantineFilePreSync(file, opts = {}) {
  try {
    const suffix = (opts && opts.suffix) || (CORRUPT_QUARANTINE_PREFIX_V1 + tsPre(opts && opts.now))
    const dest = file + suffix
    // 同一秒内坏两次 ⇒ 再加一段随机后缀，避免覆盖上一份证据
    const finalPath = existsSync(dest) ? dest + '.' + Math.random().toString(36).slice(2, 6) : dest
    renameSync(file, finalPath)
    return finalPath
  } catch (_) {
    return ''
  }
}

/**
 * **同步原子写**：tmp → rename。
 * @returns {{ok: boolean, path?: string, error?: string}} 结构化结果（fail-soft，不抛）。
 */
export function writeTextAtomicPreSync(file, text) {
  const tmp = file + ATOMIC_TMP_SUFFIX_V1
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(tmp, String(text), 'utf8')
    renameSync(tmp, file)
    return { ok: true, path: file }
  } catch (e) {
    // 失败时清掉临时文件，避免在目标目录留垃圾（清理失败也不抛）
    try { rmSync(tmp, { force: true }) } catch (_) {}
    return { ok: false, error: String((e && e.message) || e) }
  }
}

/**
 * **异步原子写**：tmp → rename。语义与同步版一致。
 *
 * 只把**可能较大**的正文写入交给异步 IO；rename 本身极快，保持同步调用。
 * 这样与既有 `persistConfigPre` 的异步口径对齐，不引入额外的 await 链。
 */
export async function writeTextAtomicPre(file, text) {
  const tmp = file + ATOMIC_TMP_SUFFIX_V1
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    await writeFile(tmp, String(text), 'utf8')
    renameSync(tmp, file)
    return { ok: true, path: file }
  } catch (e) {
    try { rmSync(tmp, { force: true }) } catch (_) {}
    return { ok: false, error: String((e && e.message) || e) }
  }
}

/**
 * **读 JSON + 损坏隔离**（同步）。
 *
 * 行为矩阵：
 *   - 文件不存在   ⇒ `{ ok:false, missing:true, reason:'ENOENT' }`（不算损坏，不留存）
 *   - 解析/读取失败 ⇒ **先留存**坏文件，再 `{ ok:false, corrupted:true, quarantined, reason }`
 *   - 正常         ⇒ `{ ok:true, value }`
 *
 * ⚠️ 与旧行为唯一的差别：**解析失败时多了一次 rename**（把原文件挪走）。
 *    之所以必须挪走而非原地不动，是因为调用方随后会回落出厂默认并**覆盖写回** ——
 *    不挪走的话坏文件当场被新配置盖掉，用户数据无从取证。
 */
export function readJsonQuarantinePreSync(file, opts = {}) {
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, missing: true, reason: 'ENOENT' }
    return { ok: false, corrupted: false, reason: String((e && e.message) || e) }
  }
  try {
    return { ok: true, value: JSON.parse(raw) }
  } catch (e) {
    const reason = String((e && e.message) || e)
    const quarantined = quarantineFilePreSync(file, opts)
    return { ok: false, corrupted: true, quarantined, reason }
  }
}

/**
 * 纯函数判据：一段文本是否**看起来像被截断的 JSON**。
 *
 * 用途：调用方先自行 readFileSync 再 parse、拿不到本模块的返回对象时，
 * 可用它给出更准确的诊断文案（「疑似写入被中断」而不是笼统的 parse 失败）。
 */
export function looksTruncatedJsonPre(text) {
  const s = String(text == null ? '' : text).trim()
  if (!s) return false
  if (s[0] !== '{' && s[0] !== '[') return false
  try { JSON.parse(s); return false } catch (_) { return true }
}

/** 是否是一个**非空**普通文件（区分「损坏但非空」与「空文件」用）。 */
export function isNonEmptyFilePreSync(file) {
  try {
    const st = statSync(file)
    return st.isFile() && st.size > 0
  } catch (_) {
    return false
  }
}

