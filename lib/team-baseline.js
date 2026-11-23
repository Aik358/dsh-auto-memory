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
import { computeRevision, normalizeText, validateDocumentId, validateEventIds, DOCUMENT_MARKER } from '../lib/ledger-doc/protocol.js'

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

/**
 * **编码输入**体积上限（base64 字符串长度；base64 是 ASCII，字符数 = 字节数）。
 *
 * ★#488（2026-11-02）：64MiB 这条线原先只在 brotliDecompressSync **返回之后**才判，
 *   等于「先让 zip-bomb 把内存撑开、再回头说太大了」—— 实测 256MiB 明文包在
 *   「先完整解压」路径上吃掉 +512MiB arrayBuffers / +522.3MiB rss 才被拒绝。
 *   ⇒ 上限必须在**解压之前**生效，两道闸门缺一不可：
 *     ① 本上限：挡住「包体本身就是巨大的 base64 串」（解 base64 要先分配 3/4 那么大的 Buffer）；
 *     ② brotliDecompressSync 的 maxOutputLength：由 zlib 在**解压过程中**抛
 *        ERR_BUFFER_TOO_LARGE，堆上不会出现超过上限的输出缓冲。
 *   取值：合法包在 packBaselinePre 侧已被 MAX_RAW_BYTES 限制，brotli 对不可压数据至多
 *   只膨胀千分之几，再 base64 膨胀 4/3 ⇒ 用 4/3 比例 + 4 KiB 余量即可，不必放宽。
 */
export const TEAM_BASELINE_MAX_ENCODED_PRE =
  Math.ceil((TEAM_BASELINE_MAX_RAW_BYTES_PRE * 4) / 3) + 4096

/** Pure validation of optional documents/<documentId>.md entries; no IO. */
export function decodeBaselineDocumentPre(name, text) {
  if (typeof name !== 'string' || name !== name.toLowerCase() || !name.startsWith('documents/') || !name.endsWith('.md') || name.includes('\\') || name.includes('..') || pathSegmentsInvalid(name)) return { ok: false, reason: 'document-id-invalid' }
  const documentId = name.slice('documents/'.length, -3)
  if (!validateDocumentId(documentId).ok || documentId.includes('/') || name !== 'documents/' + documentId + '.md') return { ok: false, reason: 'document-id-invalid' }
  if (typeof text !== 'string') return { ok: false, reason: 'document-content-invalid' }
  const normalized = normalizeText(text)
  const lines = normalized.split(String.fromCharCode(10))
  if (!lines[0]?.startsWith('# ') || lines[1] !== DOCUMENT_MARKER) return { ok: false, reason: 'document-format-invalid' }
  const fields = {}
  for (const [index,key] of [[2,'documentId'],[3,'eventIds'],[4,'createdAt'],[5,'updatedAt'],[6,'revision']]) {
    if (!lines[index]?.startsWith(key + ': ')) return { ok: false, reason: 'document-format-invalid' }
    fields[key] = lines[index].slice(key.length + 2)
  }
  if (fields.documentId !== documentId) return { ok: false, reason: 'document-id-invalid' }
  const ids = validateEventIds(fields.eventIds.split(','))
  if (!ids.ok || ids.value.join(',') !== fields.eventIds) return { ok: false, reason: 'event-ids-invalid' }
  const revision = computeRevision(normalized)
  if (fields.revision !== revision) return { ok: false, reason: 'document-revision-mismatch' }
  if (!Number.isFinite(Date.parse(fields.createdAt)) || !Number.isFinite(Date.parse(fields.updatedAt))) return { ok: false, reason: 'document-clock-invalid' }
  return { ok: true, document: { documentId, revision, eventIds: ids.value } }
}
function pathSegmentsInvalid(name) { return name.startsWith('/') || name.split('/').some((part) => !part || part === '.' || part === '..') }
function documentsInFilesPre(files) {
  const documents = []
  for (const name of Object.keys(files).filter((item) => item.startsWith('documents/') || item.includes('\\')).sort()) {
    const decoded = decodeBaselineDocumentPre(name, files[name])
    if (!decoded.ok) return decoded
    documents.push(decoded.document)
  }
  return { ok: true, documents }
}

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
    if (i.documents !== undefined) {
      if (!Array.isArray(i.documents)) return { ok: false, reason: 'documents-invalid' }
      const seen = new Set()
      for (const entry of i.documents) {
        if (!entry || typeof entry.documentId !== 'string' || typeof entry.text !== 'string' || seen.has(entry.documentId)) return { ok: false, reason: 'duplicate-document' }
        if (Object.prototype.hasOwnProperty.call(rawFiles, 'documents/' + entry.documentId + '.md')) return { ok: false, reason: 'duplicate-document' }
        seen.add(entry.documentId)
        files['documents/' + entry.documentId + '.md'] = entry.text
      }
    }
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

    for (const name of Object.keys(rawFiles).filter((item) => item.startsWith('documents/') || item.includes('\\')).sort()) files[name] = String(rawFiles[name] == null ? '' : rawFiles[name])
    const checkedDocuments = documentsInFilesPre(files)
    if (!checkedDocuments.ok) return { ok: false, reason: checkedDocuments.reason }

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
    if (checkedDocuments.documents.length) payload.documents = checkedDocuments.documents
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
    // ★#488 闸门①：**编码输入**上限 —— 必须在 base64 解码**之前**判。
    //   放在解码之后就等于「先按 3/4 包体分配 Buffer，再说不该收」。
    if (body.length > TEAM_BASELINE_MAX_ENCODED_PRE) {
      return { ok: false, reason: 'body-too-large: ' + body.length + ' > ' + TEAM_BASELINE_MAX_ENCODED_PRE }
    }

    let buf = null
    try { buf = Buffer.from(body, 'base64') } catch (_) { return { ok: false, reason: 'base64-decode-failed' } }
    if (!buf || !buf.length) return { ok: false, reason: 'base64-empty' }

    let inner = null
    try {
      // ★#488 闸门②：maxOutputLength 让 zlib 在**解压过程中**就抛 ERR_BUFFER_TOO_LARGE；
      //   旧写法不带该选项 ⇒ 输出缓冲先被完整分配出来，64MiB 上限形同虚设。
      inner = zlib.brotliDecompressSync(buf, { maxOutputLength: TEAM_BASELINE_MAX_RAW_BYTES_PRE })
    } catch (e) {
      const code = String((e && e.code) || '')
      if (code === 'ERR_BUFFER_TOO_LARGE' || code === 'ERR_OUT_OF_RANGE') {
        // 解压阶段即被截停：**没有**任何超过上限的 Buffer 被分配出来
        return { ok: false, reason: 'unpacked-too-large(brotli-cap): ' + code }
      }
      return { ok: false, reason: 'brotli-decode-failed: ' + String((e && e.message) || e).slice(0, 120) }
    }
    // 兜底复核：闸门②生效后此分支不可达，保留以防 maxOutputLength 行为变化 ——
    //   无论如何都不把超限内容交给 JSON.parse。
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

    const checkedDocuments = documentsInFilesPre(files)
    if (!checkedDocuments.ok) return { ok: false, reason: checkedDocuments.reason }
    if (obj.documents !== undefined && JSON.stringify(obj.documents) !== JSON.stringify(checkedDocuments.documents)) return { ok: false, reason: 'document-manifest-mismatch' }
    if (p.documents !== undefined && JSON.stringify(p.documents) !== JSON.stringify(checkedDocuments.documents)) return { ok: false, reason: 'document-manifest-mismatch' }

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
        ...(checkedDocuments.documents.length ? { documents: checkedDocuments.documents } : {}),
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

// ══════════════════════════════════════════════════════════════════════════════════
// ★★#479 / #486 / #491（2026-11-02）**家族 C：「不确定/失败」不得折叠成「确定结论」**
//
// 三条 issue 的**确定结论**各不相同，但折叠方式**完全相同** —— 所以判据只写一份：
//   · #479 应用基线失败 ⇒ 旧实现无条件回 `rolled-back`（其实只回滚了 1/4 文件）
//   · #486 远端搜索失败 ⇒ UI 显示「远端暂无可用基准」（其实只是本机没缓存）
//   · #491 宿主重启后磁盘写着 running ⇒ 回 `reused:true`（其实进程早就没了）
// 共同缺陷：**把「我不知道」当成「我知道了，而且答案是 NO」**。后果是用户按错误结论做
// 破坏性动作（#486 诱发错误上传、#479 让用户以为已复原、#491 让功能永久不可用）。
//
// ⇒ 统一判据：**只有拿到正向证据才允许给出确定结论**；证据缺失/失败 ⇒ 明确回
//    `indeterminate` 并带原因，调用方据此显示「未知/部分完成」，绝不显示「没有/已复原」。
// ══════════════════════════════════════════════════════════════════════════════════

/** 家族 C 的三种结论（调用方按此分支，不再各写一份字符串比较）。 */
export const TEAM_VERDICTS_PRE = Object.freeze(['ok', 'indeterminate', 'failed'])

/**
 * #479 的**写计划**：把「包内有哪些文件」与「每个文件写到哪」合成一张单一清单。
 *
 * 缺陷根因（L1 报告）：备份/回滚按「事件库是唯一被替换文件」写，写入循环按「包内四个文件」走 ——
 *   **两处对写集合的口径不一致**。修法是让写集合只有一个来源，备份/写入/回滚**都按它走**。
 *
 * 本函数还把「目标路径为空」从**静默 continue** 改成**直接失败**：
 *   旧代码 `if (!target) continue` + `String(bp.notesPath || '')` ⇒ 无项目笔记的工作区拿到空串，
 *   `writeTextAtomicPreSync('')` 抛错 ⇒ 落到「已回滚」分支 —— 这是 #479 最容易命中的默认路径。
 *
 * @param {object} files   包里要写入的文件 { [name]: string }
 * @param {object} targets 各文件的目标绝对路径 { [name]: string }
 * @returns {{ok:boolean, plan?:Array<{name:string,target:string}>, reason?:string, missingTargets?:string[]}}
 */
export function buildBaselineWritePlanPre(files, targets) {
  try {
    const f = (files && typeof files === 'object') ? files : null
    if (!f) return { ok: false, reason: 'files-missing' }
    const t = (targets && typeof targets === 'object') ? targets : {}
    const names = Object.keys(f).sort()
    if (!names.length) return { ok: false, reason: 'files-empty' }
    const plan = []
    const missing = []
    for (const name of names) {
      const target = String(t[name] == null ? '' : t[name]).trim()
      // ★不允许静默跳过：包里带了它，就必须有落点，否则「回滚集合」与「写入集合」又会分叉
      if (!target) { missing.push(name); continue }
      plan.push({ name: name, target: target })
    }
    if (missing.length) {
      return { ok: false, reason: 'target-missing: ' + missing.join(','), missingTargets: missing }
    }
    return { ok: true, plan: plan }
  } catch (e) {
    return { ok: false, reason: 'plan-threw: ' + String((e && e.message) || e) }
  }
}

/**
 * #479 的**回滚结论裁决**：回滚到不到底，必须如实区分。
 *
 * 旧实现：只回滚 event-store 一个文件，然后**无条件**返回 `write-failed-rolled-back` ⇒
 *   PLAN/项目笔记/用户级记忆仍是远端内容，用户却以为已复原（数据不可恢复 + 假回执）。
 *
 * 判据：**写计划里每一个文件都必须被处理过**（原有 ⇒ 从备份还原；原本不存在 ⇒ 删掉），
 *   只要有一个没处理成功 ⇒ `rollback-incomplete`（并列出是哪几个），绝不冒充 `rolled-back`。
 *
 * @param {object} input
 *   - planned   {string[]} 本次写计划里的全部文件名
 *   - restored  {string[]} 已从备份还原成功的文件名
 *   - removed   {string[]} 原本不存在、已成功删除的文件名
 *   - failed    {Array<{name:string,error?:string}>} 回滚失败的文件
 * @returns {{ok:false, verdict:string, reason:string, rolledBack:string[], failedItems:object[]}}
 */
export function classifyBaselineRollbackPre(input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    const planned = Array.isArray(i.planned) ? i.planned.map(String) : []
    const restored = Array.isArray(i.restored) ? i.restored.map(String) : []
    const removed = Array.isArray(i.removed) ? i.removed.map(String) : []
    const failed = Array.isArray(i.failed) ? i.failed.filter(Boolean) : []

    const done = new Set()
    for (const n of restored) done.add(n)
    for (const n of removed) done.add(n)
    // 写了但回滚没处理的项 = 计划里有、既没还原也没删除
    const untouched = planned.filter((n) => !done.has(n))
    const failedItems = failed.slice()
    for (const n of untouched) if (!failedItems.some((x) => String(x && x.name) === n)) failedItems.push({ name: n, error: 'not-restored' })

    const rolledBack = planned.filter((n) => done.has(n) && !failedItems.some((x) => String(x && x.name) === n))
    if (failedItems.length || rolledBack.length !== planned.length) {
      return {
        ok: false,
        verdict: 'indeterminate',
        reason: 'rollback-incomplete: ' + (failedItems.length ? failedItems.map((x) => String(x && x.name)).join(',') : 'unplanned'),
        rolledBack: rolledBack,
        failedItems: failedItems,
      }
    }
    // 全部处理过 ⇒ 才能说「已回滚」
    return { ok: false, verdict: 'failed', reason: 'rolled-back', rolledBack: rolledBack, failedItems: [] }
  } catch (e) {
    return { ok: false, verdict: 'indeterminate', reason: 'rollback-classify-threw: ' + String((e && e.message) || e), rolledBack: [], failedItems: [] }
  }
}

/**
 * #486 的**远端搜索结论裁决**：三态，不是两态。
 *
 * 缺陷：UI 把「本机缓存有没有」表述成「远端有没有」—— `readBaselineOfferPre` 只读本地
 *   `baseline-offer.json`、**零网络**，返回空就说「远端暂无可用基准」。
 *   而升级期间同步是暂停的（`_teamPaused`），根本不会去拉 ⇒ 这条提示在用户三步设计的
 *   **默认状态**下恒定出现，并诱发「自己整理并上传」→ 覆盖别的机器的有效基准。
 *
 * 判据：**只有「这次真的问到远端了，且远端明确说没有」才允许 `absent`**。
 *   请求失败 / 离线 / 被暂停挡住 ⇒ `unknown`，UI 必须显示「未知（可能离线或暂停中）」。
 *
 * @param {object} input
 *   - attempted  {boolean} 本次是否真的发起了远端查询（false ⇒ 一定是 unknown）
 *   - ok         {boolean} 查询是否成功拿到响应
 *   - error      {string}  失败原因（诊断用，不回显给用户）
 *   - hasBaseline{boolean} 远端**明确**回了一个可用基线
 *   - paused     {boolean} 当前是否处于同步暂停（暂停期间的「没有」不可信）
 * @returns {{verdict:string, ok:boolean, reason:string, mayClaimAbsent:boolean}}
 */
export function judgeBaselineSearchResultPre(input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    // 没发起过查询 ⇒ 无从判断（旧实现就是在这个状态下说了「远端没有」）
    if (i.attempted !== true) {
      return { verdict: 'indeterminate', ok: false, reason: 'not-attempted', mayClaimAbsent: false }
    }
    if (i.ok !== true) {
      return { verdict: 'indeterminate', ok: false, reason: 'search-failed: ' + String(i.error || 'unknown'), mayClaimAbsent: false }
    }
    if (i.hasBaseline === true) {
      return { verdict: 'ok', ok: true, reason: 'baseline-available', mayClaimAbsent: false }
    }
    // 暂停期间收到的「空」不足以证明远端没有：同步停着，本来就不会有新 offer 进来
    if (i.paused === true) {
      return { verdict: 'indeterminate', ok: false, reason: 'paused', mayClaimAbsent: false }
    }
    return { verdict: 'ok', ok: true, reason: 'baseline-absent', mayClaimAbsent: true }
  } catch (e) {
    return { verdict: 'indeterminate', ok: false, reason: 'search-classify-threw: ' + String((e && e.message) || e), mayClaimAbsent: false }
  }
}

/**
 * #491 的**在跑判定**：磁盘上写着 `running` ≠ 任务还在跑。四态，不是两态。
 *
 * 缺陷（L1 报告）：`upgrade-state.json` 是**持久文件**，而 running 的**解除**只依赖进程内
 *   Promise 回调 ⇒ 宿主崩溃/重启后文件永驻 `running`：`startUpgradeJobPre` 见 running 就回
 *   `reused:true`（假称在跑），`canUpgrade` 又排除 running ⇒ 按钮永久不可点，
 *   唯一出路是手改 JSON。**默认路径**（长任务被强杀很常见）。
 *
 * 判据：**只有「同一进程世代 + jobId 在本进程的在飞集合里」才算真的在跑**。
 *   世代不同（换了进程）⇒ 判孤儿任务，调用方应改写成 failed 并**正常启动新任务**（不是复用）。
 *   ⚠️ 刻意**不做「超时判死」**：会把正常的长任务误杀（作者已否决，本车道同意）。
 *
 * @param {object} input
 *   - diskPhase   {string}  磁盘上的 phase
 *   - diskJobId   {string}  磁盘上的 jobId
 *   - diskEpoch   {string}  磁盘上的进程世代标识（旧状态文件没有 ⇒ 空）
 *   - currentEpoch{string}  本进程世代标识
 *   - inflightIds {string[]|Set} 本进程在飞集合里的 jobId
 * @returns {{verdict:string, ok:boolean, reuse:boolean, orphan:boolean, reason:string, action:string}}
 *   verdict: 'idle'（不在跑） / 'running'（真的在跑，可复用） /
 *            'orphan'（磁盘说在跑，但持有者已不在 ⇒ 应改写成 failed 并重启任务） /
 *            'unverifiable'（拿不到世代信息，无法判定 ⇒ **不假装在跑，也不假装没在跑**）
 *   action:  'start' | 'reuse' | 'restart' | 'inspect'
 */
export function judgeUpgradeJobRecoveryPre(input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    const phase = String(i.diskPhase || '').trim()
    if (phase !== 'running') {
      return { verdict: 'idle', ok: true, reuse: false, orphan: false, reason: 'phase-' + (phase || 'empty'), action: 'start' }
    }
    const jobId = String(i.diskJobId || '').trim()
    // 写着 running 却没有 jobId ⇒ 状态本身就是坏的，不能拿它证明「在跑」
    if (!jobId) {
      return { verdict: 'unverifiable', ok: false, reuse: false, orphan: false, reason: 'running-without-jobid', action: 'inspect' }
    }
    const curEpoch = String(i.currentEpoch || '').trim()
    const diskEpoch = String(i.diskEpoch || '').trim()
    // 拿不到任一侧的世代 ⇒ 无从判断（旧状态文件没有 epoch 字段就是这一支）
    if (!curEpoch || !diskEpoch) {
      return { verdict: 'unverifiable', ok: false, reuse: false, orphan: false, reason: 'epoch-missing', action: 'inspect' }
    }
    if (diskEpoch !== curEpoch) {
      // ★核心：#491 的修复点 —— 世代不同 ⇒ 孤儿任务，调用方应写 failed 并**重新启动**
      return { verdict: 'orphan', ok: false, reuse: false, orphan: true, reason: 'epoch-mismatch', action: 'restart' }
    }
    const ids = Array.isArray(i.inflightIds) ? i.inflightIds.map(String)
      : (i.inflightIds && typeof i.inflightIds.has === 'function' ? Array.from(i.inflightIds).map(String) : [])
    if (ids.indexOf(jobId) < 0) {
      // 世代相同但不在在飞集合里 ⇒ 同样是孤儿（同进程内状态被外部改写/提前落盘）
      return { verdict: 'orphan', ok: false, reuse: false, orphan: true, reason: 'jobid-not-inflight', action: 'restart' }
    }
    return { verdict: 'running', ok: true, reuse: true, orphan: false, reason: 'genuinely-running', action: 'reuse' }
  } catch (e) {
    return { verdict: 'unverifiable', ok: false, reuse: false, orphan: false, reason: 'recovery-judge-threw: ' + String((e && e.message) || e), action: 'inspect' }
  }
}

/**
 * ★#481（家族 A · **异步未等待**）**打包入队门**：只允许在「整理真的完成之后」打包。
 *
 * 缺陷（L1 报告，HEAD 实测）：前端 `onSelfUpgrade` 先调 `onStart()`（**不 await、不消费返回值**），
 *   紧接着就 `POST {action:'upload'}`；而后端 `uploadBaselinePre` 是**当场同步读盘**。
 *   ⇒ 入队的是整理前/整理中的快照；整理**启动失败**（plugin-disposed / subagents-unavailable）
 *   也照样入队。UI 文案「整理完成后会一并同步给团队」是**假承诺**。
 *
 * 根因：把「启动了一个异步任务」当成「任务已完成」；打包动作挂在**点击事件**上，
 *   而不是挂在**任务完成回调**上。
 *
 * 本函数就是那条判据的单一真源（放在纯模块里，两端共用，避免「前端一份、后端一份」的半修）：
 *   · 没请求整理 ⇒ 直接允许（老路径行为不变）；
 *   · 请求了整理 ⇒ **只有 phase==='done' 才允许打包**；
 *     running/unavailable/failed/空 ⇒ 一律拒绝，并给出「等完成」或「整理失败，不打包」的明确语义。
 *
 * @param {object} input
 *   - upgradeRequested {boolean} 本次是否要求「先整理再上传」
 *   - upgradePhase     {string}  整理任务当前阶段（idle/pausing/pulling/upgrading/verifying/done/unavailable）
 *   - upgradeJobId     {string}  整理任务 id（诊断用，不参与判定）
 *   - hasLocalEventStore {boolean} 本地事件库是否存在（打包的前置，缺了不该白跑一次整理）
 * @returns {{ok:boolean, allowed:boolean, reason:string, wait:boolean, blocksUpload:boolean}}
 *   allowed=false 且 wait=true  ⇒ 调用方应**等待完成回调**再打包（不是失败，是还没到）
 *   allowed=false 且 wait=false ⇒ 本次打包**永久不会成立**（整理失败/不可用），不得重试成成功
 */
export function judgeBaselineUploadGatePre(input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    // 本地压根没有事件库 ⇒ 打包必失败，先如实拒绝（不制造「空包已上传」的假象）
    if (i.hasLocalEventStore === false) {
      return { ok: false, allowed: false, reason: 'event-store-missing', wait: false, blocksUpload: true }
    }
    // 没请求整理 ⇒ 直接上传（既有路径逐字不变）
    if (i.upgradeRequested !== true) {
      return { ok: true, allowed: true, reason: 'no-upgrade-requested', wait: false, blocksUpload: false }
    }
    const phase = String(i.upgradePhase || '').trim()
    if (phase === 'done') {
      // ★唯一允许点：整理真完成了，此刻读盘读到的才是「整理后」的内容
      return { ok: true, allowed: true, reason: 'upgrade-completed', wait: false, blocksUpload: false }
    }
    if (phase === 'unavailable' || phase === 'failed') {
      // 整理失败/不可用 ⇒ **永远不打包**（旧实现照样打包，这是假承诺的根源）
      return { ok: false, allowed: false, reason: 'upgrade-not-completed: ' + phase, wait: false, blocksUpload: true }
    }
    // running / 各中间阶段 / 空 ⇒ 还没到，等完成回调
    return { ok: false, allowed: false, reason: 'upgrade-pending: ' + (phase || 'idle'), wait: true, blocksUpload: true }
  } catch (e) {
    // 判据自身异常 ⇒ **不放行**（打包是错误版本的扩散源，拿不准就拦住）
    return { ok: false, allowed: false, reason: 'upload-gate-threw: ' + String((e && e.message) || e), wait: false, blocksUpload: true }
  }
}
