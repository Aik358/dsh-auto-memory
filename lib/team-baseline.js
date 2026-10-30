/**
 * team-baseline.js —— 团队版的「记忆基线」打包 / 校验 / 解包（纯函数模块）。
 *
 * ## 这是干什么的
 * 用户裁定（2026-10-31 原话要点）：
 *   「有一台机器更新到了最新版，然后上传到云端。其他的机器更新到新版后，就能自动把这台机器
 *    的版本作为基准下载下来，就不用每个机器都整理一遍。」
 * ⇒ 本模块负责「一份基线」的**编解码**，不负责传输、不碰磁盘、不联网。
 *
 * ## 为什么单独成模块
 * 打包/校验/解包是**纯数据变换**，可被 ①上传路径 ②下载路径 ③套件 三方共用。
 * 同一语义若在两条路径各写一份判据 ⇒ 本仓明令禁止的「半修」形态。
 *
 * ## 编码选型（实测数据，2026-10-31 本机）
 * 同一份真实记忆（event-store 1.7MB + 两个 MEMORY.md + PLAN.md）：
 *   | 编码              | HTTP 体积 |
 *   | 明文 JSON         | 1,838 KB  ← 超过 nginx 默认 1MB 上限，会 413 |
 *   | gzip + base64     |   699 KB  |
 *   | brotli + base64   |   322 KB  ← **选它**，距 1MB 上限有 3 倍余量 |
 * ⇒ 用 brotli(quality 11) + base64。
 *   代价：Node 的 zlib.brotliCompressSync 需要 Node ≥ 10.16（本仓要求远高于此）。
 *   ★payload 一律是**字符串**（base64），不是 Buffer —— 因为 outbox 会把它
 *     JSON.stringify 落盘，Buffer 会退化成 {type:'Buffer',data:[...]} 撑大数倍。
 *
 * ## 铁律
 *  1. **纯函数、零 IO**：不读盘、不写盘、不联网、不建目录 —— 全部入参/出参都在内存里。
 *  2. **绝不抛**：任何畸形输入都回 `{ok:false, reason}`，调用方无需 try/catch。
 *  3. **checksum 覆盖面 = 文件内容**（不是整个包）：这样无论编码怎么换、
 *     时间戳/作者怎么变，只要记忆本体没变，checksum 就一致 ⇒ 可跨版本比对。
 *  4. **解包必须验 checksum**：半包/截断/串包一律拒绝 —— 静默接受半个基线等于损坏记忆库。
 */

import zlib from 'node:zlib'
import crypto from 'node:crypto'

/** 基线格式版本（包结构变了就 +1；与 TEAM_SYNC_MEMORY_FORMAT_PRE 是两个维度）。 */
export const TEAM_BASELINE_FORMAT_PRE = 1

/** 一份基线**必须**包含的文件（少一个即视为不完整）。 */
export const TEAM_BASELINE_REQUIRED_PRE = Object.freeze(['event-store.json'])

/**
 * 可选文件白名单。
 * ★只允许这些：白名单外的文件**不入包**（防止把 prev-req-*.md 这类调试快照误传上去）。
 *   `index.json` 刻意**不在**此列 —— 它是检索索引，可从 event-store.json 重建，
 *   体积 6.3MB（比记忆本体大 3 倍），传它纯属浪费。
 */
export const TEAM_BASELINE_OPTIONAL_PRE = Object.freeze([
  'PLAN.md',
  'MEMORY.project.md',
  'MEMORY.user.md',
])

/** 解包后允许的最大明文体积（防 zip-bomb：畸形包解压后撑爆内存）。 */
export const TEAM_BASELINE_MAX_RAW_BYTES_PRE = 64 * 1024 * 1024

function sha256Pre(text) {
  try { return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex') } catch (_) { return '' }
}

/**
 * 计算**内容指纹**：对所有参与文件按「文件名排序 → 逐个喂 name + '\\0' + content」求 sha256。
 *
 * ★为什么带文件名：防止「两个文件内容互换」这种改动指纹不变。
 * ★为什么排序：JS 对象键序不保证稳定，不排序会让同一份内容算出不同指纹。
 *
 * @param {object} files { [name]: string }
 * @returns {string} 64 位 hex；入参非法时返回空串
 */
export function baselineChecksumPre(files) {
  try {
    if (!files || typeof files !== 'object') return ''
    const names = Object.keys(files).sort()
    if (!names.length) return ''
    const h = crypto.createHash('sha256')
    for (const n of names) {
      h.update(String(n), 'utf8')
      h.update('\u0000', 'utf8')
      h.update(String(files[n] == null ? '' : files[n]), 'utf8')
      h.update('\u0000', 'utf8')
    }
    return h.digest('hex')
  } catch (_) { return '' }
}

/**
 * 打包一份基线。
 *
 * @param {object} input
 *   - files   { [name]: string }  文件内容（**只接受白名单内的名字**）
 *   - by      { id?, name? }      谁打的包（前端气泡显示用）
 *   - memoryFormat  {string}      记忆格式版本（复用现有常量；缺失时不写该字段）
 *   - at      {number}            时间戳（缺省 now；测试可注入固定值）
 * @returns {{ok:boolean, payload?:object, reason?:string}}
 *   payload 可直接塞进 outbox 的 {kind:'baseline', key:'baseline:current', payload}
 */
export function packBaselinePre(input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    const rawFiles = (i.files && typeof i.files === 'object') ? i.files : null
    if (!rawFiles) return { ok: false, reason: 'files-missing' }

    // ① 只收白名单内的文件；必须项缺失即拒
    const allowed = TEAM_BASELINE_REQUIRED_PRE.concat(TEAM_BASELINE_OPTIONAL_PRE)
    const files = {}
    for (const name of allowed) {
      if (Object.prototype.hasOwnProperty.call(rawFiles, name)) {
        files[name] = String(rawFiles[name] == null ? '' : rawFiles[name])
      }
    }
    for (const need of TEAM_BASELINE_REQUIRED_PRE) {
      if (!Object.prototype.hasOwnProperty.call(files, need)) {
        return { ok: false, reason: 'required-file-missing:' + need }
      }
    }

    // ② 校验 event-store.json 至少是合法 JSON（防止把半个文件当基线传上去）
    try {
      const parsed = JSON.parse(files['event-store.json'])
      if (!parsed || typeof parsed !== 'object') return { ok: false, reason: 'event-store-not-object' }
      if (!Array.isArray(parsed.events)) return { ok: false, reason: 'event-store-no-events' }
    } catch (e) {
      return { ok: false, reason: 'event-store-bad-json: ' + String((e && e.message) || e).slice(0, 120) }
    }

    const checksum = baselineChecksumPre(files)
    if (!checksum) return { ok: false, reason: 'checksum-failed' }

    // ③ 整体压缩：{ v, at, by, memoryFormat, checksum, files } → brotli → base64
    const inner = JSON.stringify({ v: TEAM_BASELINE_FORMAT_PRE, checksum: checksum, files: files })
    const rawBytes = Buffer.byteLength(inner, 'utf8')
    if (rawBytes > TEAM_BASELINE_MAX_RAW_BYTES_PRE) {
      return { ok: false, reason: 'baseline-too-large: ' + rawBytes }
    }
    const packed = zlib
      .brotliCompressSync(Buffer.from(inner, 'utf8'), {
        params: (function () {
          const p = {}
          p[zlib.constants.BROTLI_PARAM_QUALITY] = 11
          p[zlib.constants.BROTLI_PARAM_SIZE_HINT] = rawBytes
          return p
        })(),
      })
      .toString('base64')

    // ④ 外层元数据（**不进 checksum**：它允许随每次上传变化而内容不变）
    const by = (i.by && typeof i.by === 'object') ? i.by : {}
    const payload = {
      v: TEAM_BASELINE_FORMAT_PRE,
      enc: 'br+base64',
      at: Number(i.at) || Date.now(),
      by: { id: String(by.id || ''), name: String(by.name || '') },
      checksum: checksum,
      rawBytes: rawBytes,
      packedBytes: packed.length,
      files: Object.keys(files).sort(),
      body: packed,
    }
    if (i.memoryFormat) payload.memoryFormat = String(i.memoryFormat)
    return { ok: true, payload: payload }
  } catch (e) {
    return { ok: false, reason: 'pack-threw: ' + String((e && e.message) || e) }
  }
}

/**
 * 解包 + 校验一份基线。
 *
 * ★**必须验 checksum**：半包/截断/串包一律拒绝。
 *   静默接受半个基线 = 直接把用户的记忆库替换成残缺版本，这是本模块存在的主要理由。
 *
 * @param {object} payload packBaselinePre 产出的 payload（或从远端拉回的同形状对象）
 * @returns {{ok:boolean, files?:object, meta?:object, reason?:string}}
 */
export function unpackBaselinePre(payload) {
  try {
    const p = (payload && typeof payload === 'object') ? payload : null
    if (!p) return { ok: false, reason: 'payload-missing' }
    if (Number(p.v) !== TEAM_BASELINE_FORMAT_PRE) {
      return { ok: false, reason: 'format-mismatch: got ' + String(p.v) + ' want ' + TEAM_BASELINE_FORMAT_PRE }
    }
    if (String(p.enc || '') !== 'br+base64') return { ok: false, reason: 'unknown-encoding: ' + String(p.enc || '') }
    const body = String(p.body || '')
    if (!body) return { ok: false, reason: 'body-missing' }

    let buf = null
    try { buf = Buffer.from(body, 'base64') } catch (_) { return { ok: false, reason: 'base64-decode-failed' } }
    if (!buf || !buf.length) return { ok: false, reason: 'base64-empty' }

    let inner = null
    try { inner = zlib.brotliDecompressSync(buf) } catch (e) {
      return { ok: false, reason: 'brotli-decode-failed: ' + String((e && e.message) || e).slice(0, 120) }
    }
    // ★zip-bomb 防护：**先看解压后大小**再解析
    if (inner.length > TEAM_BASELINE_MAX_RAW_BYTES_PRE) {
      return { ok: false, reason: 'unpacked-too-large: ' + inner.length }
    }

    let obj = null
    try { obj = JSON.parse(inner.toString('utf8')) } catch (e) {
      return { ok: false, reason: 'json-parse-failed: ' + String((e && e.message) || e).slice(0, 120) }
    }
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'inner-not-object' }
    if (Number(obj.v) !== TEAM_BASELINE_FORMAT_PRE) return { ok: false, reason: 'inner-format-mismatch' }

    const files = (obj.files && typeof obj.files === 'object') ? obj.files : null
    if (!files) return { ok: false, reason: 'inner-files-missing' }
    for (const need of TEAM_BASELINE_REQUIRED_PRE) {
      if (!Object.prototype.hasOwnProperty.call(files, need)) {
        return { ok: false, reason: 'inner-required-file-missing:' + need }
      }
    }

    // ★核心校验：重算 checksum，必须与包里声明的一致
    const want = String(p.checksum || '')
    const got = baselineChecksumPre(files)
    if (!want) return { ok: false, reason: 'checksum-missing' }
    if (want !== got) return { ok: false, reason: 'checksum-mismatch: want ' + want.slice(0, 16) + ' got ' + got.slice(0, 16) }

    // event-store 必须是合法 JSON 且有 events 数组
    try {
      const ev = JSON.parse(String(files['event-store.json'] || ''))
      if (!ev || typeof ev !== 'object' || !Array.isArray(ev.events)) {
        return { ok: false, reason: 'event-store-invalid-shape' }
      }
    } catch (e) {
      return { ok: false, reason: 'event-store-bad-json: ' + String((e && e.message) || e).slice(0, 120) }
    }

    return {
      ok: true,
      files: files,
      meta: {
        v: obj.v,
        checksum: got,
        at: Number(p.at) || 0,
        by: (p.by && typeof p.by === 'object') ? { id: String(p.by.id || ''), name: String(p.by.name || '') } : { id: '', name: '' },
        memoryFormat: String(p.memoryFormat || ''),
        names: Object.keys(files).sort(),
      },
    }
  } catch (e) {
    return { ok: false, reason: 'unpack-threw: ' + String((e && e.message) || e) }
  }
}

/**
 * 比较两份基线：**同一份内容**吗？（只看内容指纹，不看时间戳/作者）
 *
 * 用于「远端已有基准」判断 —— 本机已经和远端一致时不必下载。
 *
 * @param {object} a 基线 payload
 * @param {object} b 基线 payload
 * @returns {{ok:boolean, same?:boolean, reason?:string}}
 */
export function baselineSamePre(a, b) {
  try {
    const ca = String((a && a.checksum) || '')
    const cb = String((b && b.checksum) || '')
    if (!ca || !cb) return { ok: false, reason: 'checksum-missing' }
    return { ok: true, same: ca === cb }
  } catch (e) {
    return { ok: false, reason: 'compare-threw: ' + String((e && e.message) || e) }
  }
}
