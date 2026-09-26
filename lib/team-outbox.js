/**
 * team-outbox.js —— 团队版同步的**出站队列**（客户端推送模型）。
 *
 * ## 背景
 * 团队版同步是「客户端推送 + 客户端拉取」，服务端**不主动推**。本模块只做一件事：
 * 把本机产生的「待同步变更」**持久化排队**，等心跳 tick 时批量发出（flush(sender)）。
 *
 * ## 设计约束（用户裁定 + 冻结书）
 *  1. **团队关闭 ⇒ 零行为**：createTeamOutbox() **不碰磁盘** —— 不建目录、不建文件、
 *     不读盘、不联网。只有显式调用 enqueue() / clear()（写）或 load()（读）才触及 IO。
 *  2. **幂等**：同 kind + key 重复 enqueue ⇒ 只留一条；第二次是 no-op（不改写已有条目的
 *     payload / at），返回 dup:true。去重瞄的是**精确复合键**（不是哈希），
 *     哈希只用于生成稳定 id。
 *  3. **有界**：超过 maxItems 丢**最旧**的，dropped 递增 + 记 diag，绝不无限涨。
 *  4. **不阻塞**：enqueue() 全同步（含落盘），实测目标 < 5ms。
 *  5. **原子写**：临时名 = <file>.<process.pid>.<seq>.tmp → rename。
 *     ⚠️ 本仓同型缺陷已出现 3 次（lib/config-io.js 的固定名 .dam-tmp，issue #82）：
 *     临时名**必须带 pid + 进程内自增序号**，否则对同一目标的并发写会互踩 ——
 *     先完成者把 tmp 改名走，后到者的 rename 找不到源文件而抛 ENOENT ⇒ 那次保存静默失败。
 *  6. **全部异常降级、绝不抛**：磁盘满 / 权限错 / JSON 坏 / sender 抛错 / payload 不可
 *     序列化 ⇒ 记 diag + 结构化返回 {ok:false, reason}；调用方无需 try/catch 本模块。
 *
 * ## 并发纪律（★TOCTOU）
 * flush() 的单飞闸门，**「检查 → 置位」之间不得插入 await**：
 *     if (flushing) return { sent: 0, failed: 0, skipped: true }
 *     flushing = true        // ← 必须紧贴上一行；中间一旦插 await，两个并发 flush 会同时
 *                            //   通过检查 ⇒ 同一条变更被发两次。
 *
 * ## 投递语义
 *  - **at-least-once**：发送成功、落盘删除前崩溃 ⇒ 下次 flush 重发（服务端按 kind+key 幂等兜底）。
 *  - ⚠️ **sender「不抛」即视为已发出**：`sent` 统计的是**发送器正常返回**的条数。若发送器因闸门/
 *    计划原因**选择不发**，必须 `throw`（或由调用方包一层把「不发」转成抛错），否则该条会被当作
 *    成功而出队。这是刻意选择的最简契约：队列只判断「发送器认不认这条」。
 *  - flush 期间新 enqueue 的条目会**合流保留**，不会被本次 flush 的收尾覆盖掉。
 *  - flush 在途期间同 kind+key 又被 enqueue ⇒ 该条**留在队列**、下个 tick 重发，
 *    避免「更新的变更被在途的旧推送吃掉」。
 *
 * 依赖：仅 node:fs / node:path（零 npm 依赖）。行尾 CRLF、无 BOM。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 队列文件名（落在调用方给定的 dir 下）。 */
export const TEAM_OUTBOX_FILENAME_PRE = 'team-outbox.json'
/** 默认上界（条）。 */
export const TEAM_OUTBOX_MAX_ITEMS_PRE = 500
/** 原子写临时文件后缀（与 lib/config-io.js 同族，便于排查时一眼认出）。 */
export const TEAM_OUTBOX_TMP_SUFFIX_PRE = '.tmp'

/** ★临时名唯一段：.<pid>.<seq>.tmp（见文件头第 5 条；issue #82 同型缺陷的预防）。 */
let _tmpSeqPre = 0
function tmpPathPre(file) {
  _tmpSeqPre = (_tmpSeqPre + 1) >>> 0
  return file + '.' + process.pid + '.' + _tmpSeqPre + TEAM_OUTBOX_TMP_SUFFIX_PRE
}

/** 幂等键的内部拼法（NUL 不会出现在正常字符串里，避免 kind/key 拼接歧义）。 */
function dedupeKeyPre(kind, key) {
  return kind + '\u0000' + key
}

/** 稳定 id：同 kind+key ⇒ 同 id（FNV-1a，供调用方对账；去重**不**依赖它）。 */
function entryIdPre(kind, key) {
  const s = kind + '\u0000' + key
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return kind + '-' + h.toString(16).padStart(8, '0')
}

/** 非空字符串判据。 */
function isNonEmptyStrPre(v) {
  return typeof v === 'string' && v.length > 0
}

/** 安全 diag：外部回调自身抛错也不得影响队列主流程。 */
function makeDiagPre(diag) {
  if (typeof diag !== 'function') return function () {}
  return function () {
    try { diag.apply(null, arguments) } catch (_) {}
  }
}

/** JSON.stringify 的安全包装（BigInt / 循环引用 / toJSON 抛错 ⇒ null，不抛）。 */
function safeJsonPre(v) {
  try {
    const s = JSON.stringify(v)
    return s === undefined ? null : s
  } catch (_) {
    return null
  }
}

/**
 * 归一化上行 entry。
 * @returns {{kind:string,key:string,payload:*,at:number,serializable:boolean}|null}
 *   不可用（缺 kind/key 或不是对象）⇒ null，调用方降级为 {ok:false}。
 */
function sanitizeEntryPre(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const kind = isNonEmptyStrPre(raw.kind) ? raw.kind : ''
  const key = isNonEmptyStrPre(raw.key) ? raw.key : ''
  if (!kind || !key) return null
  let payload = raw.payload === undefined ? null : raw.payload
  let serializable = true
  if (safeJsonPre(payload) === null) {
    // 存得下队列、发不出去 —— 不拒收（拒收等于变更静默丢失），改存 null + 留痕。
    serializable = false
    payload = null
  }
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : now
  return { kind, key, payload, at, serializable }
}

/**
 * 归一化磁盘上的一条。
 * payload 以 **文本**（payloadRaw）原样保留 ⇒ 能解析则还原对象；不能解析也绝不丢（标记 unserializable）。
 */
function sanitizeLoadedPre(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!isNonEmptyStrPre(raw.kind) || !isNonEmptyStrPre(raw.key)) return null
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : Date.now()
  let payload = null
  let unserializable = false
  if (isNonEmptyStrPre(raw.payloadRaw)) {
    try { payload = JSON.parse(raw.payloadRaw) } catch (_) { unserializable = true }
  } else if (raw.payload !== undefined) {
    payload = raw.payload === undefined ? null : raw.payload
    if (safeJsonPre(payload) === null) { payload = null; unserializable = true }
  }
  return { kind: raw.kind, key: raw.key, payload, at, unserializable }
}

/** 单条 → 磁盘形状（payload 存文本，避免二次序列化时被改写）。 */
function toDiskPre(item) {
  const s = safeJsonPre(item.payload)
  return { kind: item.kind, key: item.key, at: item.at, payloadRaw: s }
}

/** rename 的紧循环重试次数（不 sleep：enqueue 必须同步且不阻塞 5ms 预算）。 */
const RENAME_ATTEMPTS_PRE = 3

/**
 * 创建出站队列。
 *
 * ⚠️ **本函数不做任何 IO**（不建目录、不建文件、不读盘、不联网）—— 团队关闭时只要调用方
 * 不调 enqueue/load/flush/clear，就是**零行为**。
 *
 * @param {{dir?:string, maxItems?:number, diag?:Function}} options
 */
export function createTeamOutbox(options = {}) {
  const opts = options && typeof options === 'object' ? options : {}
  const diag = makeDiagPre(opts.diag)
  const dir = typeof opts.dir === 'string' && opts.dir.length > 0 ? opts.dir : ''
  const file = dir ? path.join(dir, TEAM_OUTBOX_FILENAME_PRE) : ''
  let maxItems = Number(opts.maxItems)
  if (!Number.isFinite(maxItems) || maxItems < 1) maxItems = TEAM_OUTBOX_MAX_ITEMS_PRE
  maxItems = Math.floor(maxItems)

  const queue = []              // 队首 = 最旧
  const seen = new Map()        // 复合去重键 → 队列中那条 item（O(1) 幂等判据）
  const inflight = new Map()    // 复合键 → 投递中的 gen（见 flush：期间被更新则保留新副本）
  let flushing = false          // ★单飞闸门（见文件头 TOCTOU 纪律）
  let flushGen = 0              // 投递代号：每次 flush 独占一代，用于识别「在途期间被更新的条目」
  let dropped = 0
  let lastError = ''
  let lastDiagMsg = ''

  /** 记一次降级：写 lastError + 同一条只 diag 一次（避免刷日志）。返回结构化失败。 */
  function failPre(where, reason) {
    const msg = where + ': ' + String(reason)
    lastError = msg
    if (msg !== lastDiagMsg) {
      lastDiagMsg = msg
      diag('team-outbox: ' + where + ' failed (fail-soft): ' + String(reason))
    }
    return { ok: false, reason: msg }
  }

  /** 确保目录存在（失败降级，不抛）。 */
  function ensureDirPre() {
    if (!dir) return { ok: false, reason: 'no-dir' }
    try {
      fs.mkdirSync(dir, { recursive: true })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String((e && e.message) || e) }
    }
  }

  /**
   * **整份队列快照的同步原子写**（tmp.<pid>.<seq> → rename）。
   * 失败 ⇒ 内存队列保持不变，返回 {ok:false,reason}（绝不抛）。
   */
  function writeNowPre() {
    if (!dir) return { ok: false, reason: 'no-dir' }
    let text
    try {
      text = JSON.stringify({ v: 1, pid: process.pid, at: Date.now(), dropped, items: queue.map(toDiskPre) })
    } catch (e) {
      return failPre('serialize', (e && e.message) || e)
    }
    if (typeof text !== 'string') return failPre('serialize', 'stringify did not return a string')
    const d = ensureDirPre()
    if (!d.ok) return failPre('mkdir', d.reason)
    const tmp = tmpPathPre(file)   // ★必须带 pid + 序号（issue #82 同型缺陷已 3 次）
    try {
      fs.writeFileSync(tmp, text, 'utf8')
      let renamed = false
      let lastErr = null
      for (let attempt = 0; attempt < RENAME_ATTEMPTS_PRE && !renamed; attempt++) {
        // Windows 上目标被别的进程持有句柄时会 EPERM/EACCES/EBUSY，属瞬时错误 ⇒ 紧循环重试
        try { fs.renameSync(tmp, file); renamed = true } catch (e) { lastErr = e }
      }
      if (!renamed) throw (lastErr || new Error('rename failed'))
      return { ok: true, path: file }
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }) } catch (_) {}   // 清理失败也不抛
      return failPre('write', (e && e.message) || e)
    }
  }

  /**
   * ★并发 flush 的**同步收尾**（不得在「检查→置位」之间插入 await —— TOCTOU）。
   * 语义：只把**本次真正发出**的条目出队；flush 期间新增/更新的条目一律保留。
   */
  function finalizePre(gen, ready) {
    try {
      for (const item of ready) {
        const dk = dedupeKeyPre(item.kind, item.key)
        if (inflight.get(dk) !== gen) continue
        if (seen.get(dk) !== item) continue   // 同键已被更新的副本替换 ⇒ 旧副本不出队
        const i = queue.indexOf(item)
        if (i >= 0) queue.splice(i, 1)
        seen.delete(dk)
      }
    } catch (e) {
      failPre('finalize', (e && e.message) || e)
    }
    inflight.clear()
  }

  return {
    /**
     * **同步入队**：幂等 + 有界 + 立即落盘（须在 5ms 预算内返回）。
     *
     * @returns {{ok:boolean, id:string|null, dup?:boolean, dropped?:number, size?:number, reason?:string}}
     *   幂等命中 ⇒ `{ok:true, dup:true}`（不改写已有条目的 payload/at，也不重复写盘）。
     */
    enqueue(entry) {
      let item = null
      try { item = sanitizeEntryPre(entry, Date.now()) } catch (e) { item = null }
      if (!item) return Object.assign(failPre('enqueue', 'invalid entry (need {kind,key} as non-empty strings)'), { id: null })
      const dk = dedupeKeyPre(item.kind, item.key)
      const id = entryIdPre(item.kind, item.key)
      if (seen.has(dk)) return { ok: true, id, dup: true, dropped: 0, size: queue.length }
      queue.push(item)
      seen.set(dk, item)
      let droppedNow = 0
      while (queue.length > maxItems) {
        const evicted = queue.shift()
        if (!evicted) break
        seen.delete(dedupeKeyPre(evicted.kind, evicted.key))
        dropped++
        droppedNow++
      }
      if (droppedNow > 0) diag('team-outbox: bounded drop ' + droppedNow + ' oldest item(s) (maxItems=' + maxItems + ')')
      const w = writeNowPre()
      if (!w.ok) return { ok: false, id, dropped: droppedNow, size: queue.length, reason: w.reason }
      return { ok: true, id, dropped: droppedNow, size: queue.length }
    },

    /** 当前条数。 */
    size() { return queue.length },

    /** **浅拷贝**数组（调用方改动不影响队列）。 */
    list() { return queue.slice() },

    /**
     * **从磁盘恢复**（整份替换内存队列）。
     *   - 文件不存在 ⇒ 空队列（不是错误）
     *   - JSON 坏    ⇒ **当空队列** + 记 diag；**不删用户数据**（文件原样留在磁盘，等下次写入覆盖）
     *   - 条目坏     ⇒ 跳过该条并计数（不因一条坏数据丢掉整个队列）
     * @returns {{ok:boolean,size:number,missing?:boolean,corrupted?:boolean,skipped?:number,reason?:string}}
     */
    load() {
      try {
        if (!file) return { ok: false, reason: 'no-dir', size: 0 }
        let raw = ''
        try {
          raw = fs.readFileSync(file, 'utf8')
        } catch (e) {
          if (e && e.code === 'ENOENT') { queue.length = 0; seen.clear(); return { ok: true, size: 0, missing: true } }
          return Object.assign(failPre('load', (e && e.message) || e), { size: queue.length })
        }
        let parsed = null
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          queue.length = 0
          seen.clear()
          const f = failPre('parse', (e && e.message) || e)
          return { ok: false, corrupted: true, size: 0, reason: f.reason }
        }
        const diskItems = parsed && Array.isArray(parsed.items) ? parsed.items : []
        const nextQueue = []
        const nextSeen = new Map()
        let skipped = 0
        let unserializable = 0
        for (let i = 0; i < diskItems.length && nextQueue.length < maxItems; i++) {
          let it = null
          try { it = sanitizeLoadedPre(diskItems[i]) } catch (e) { it = null }
          if (!it) { skipped++; continue }
          const dk = dedupeKeyPre(it.kind, it.key)
          if (nextSeen.has(dk)) { skipped++; continue }   // 磁盘上有重键 ⇒ 保第一份（更旧）
          const item = { kind: it.kind, key: it.key, payload: it.payload, at: it.at }
          if (it.unserializable) { item.unserializable = true; unserializable++ }
          nextQueue.push(item)
          nextSeen.set(dk, item)
        }
        queue.length = 0
        for (let i = 0; i < nextQueue.length; i++) queue.push(nextQueue[i])
        seen.clear()
        nextSeen.forEach(function (v, k) { seen.set(k, v) })
        if (parsed && typeof parsed === 'object') {
          const d = Number(parsed.dropped)
          if (Number.isFinite(d) && d > dropped) dropped = Math.floor(d)
        }
        if (skipped > 0) diag('team-outbox: load skipped ' + skipped + ' invalid or duplicate item(s)')
        if (unserializable > 0) diag('team-outbox: load kept ' + unserializable + ' item(s) with unparsable payloadRaw (payload=null)')
        return { ok: true, size: queue.length, skipped }
      } catch (e) {
        // 兜底：load 的契约是「绝不抛」，任何意外都降级为结构化失败
        return Object.assign(failPre('load', (e && e.message) || e), { size: queue.length })
      }
    },

    /**
     * **批量发出**。逐条 `await sender(entry)`：成功的从队列删除，失败的留在队列继续下一条。
     *
     * @param {(entry:{kind:string,key:string,payload:*,at:number,id:string}) => Promise<*>|*} sender
     * @returns {Promise<{sent:number, failed:number, skipped?:boolean, size?:number, dropped?:number, reason?:string}>}
     *   并发调用 ⇒ 第二次直接 `{ sent: 0, failed: 0, skipped: true }`（单飞）。
     */
    async flush(sender) {
      // ★单飞闸门：检查 → 置位之间**不得插入 await**（TOCTOU，见文件头并发纪律）。
      if (flushing) return { sent: 0, failed: 0, skipped: true }
      flushing = true
      const gen = ++flushGen
      const ready = queue.slice()
      const sentItems = []   // ★只有**发出成功**的才出队；失败的必须留在队列（下个 tick 重发）
      let sent = 0
      let failed = 0
      const senderFn = typeof sender === 'function' ? sender : null
      if (!senderFn) {
        // 没给发送器 ⇒ 一条都不发，但必须释放闸门（否则队列永久卡死）
        finalizePre(gen, [])
        flushing = false
        return { sent: 0, failed: 0, size: queue.length, dropped, reason: 'sender is not a function' }
      }
      try {
        for (let i = 0; i < ready.length; i++) {
          const item = ready[i]
          const dk = dedupeKeyPre(item.kind, item.key)
          inflight.set(dk, gen)
          const out = { kind: item.kind, key: item.key, payload: item.payload, at: item.at, id: entryIdPre(item.kind, item.key) }
          if (item.unserializable) out.unserializable = true
          try {
            await senderFn(out)
            sent++
            sentItems.push(item)
          } catch (e) {
            // 该条**留在队列**（下个 tick 重发），不影响后续条目
            failed++
            failPre('send', (e && e.message) || e)
          }
        }
      } finally {
        // 收尾必须**同步**，且在释放闸门之前不得再有 await
        finalizePre(gen, sentItems)
        if (ready.length > 0) writeNowPre()
        flushing = false
      }
      return { sent: sent, failed: failed, size: queue.length, dropped: dropped }
    },

    /** 清空并落盘（返回原子写结果）。 */
    clear() {
      queue.length = 0
      seen.clear()
      return writeNowPre()
    },

    // ---- 只读观测（供心跳/设置页诊断用；不改变契约） ----
    get file() { return file },
    get maxItems() { return maxItems },
    get dropped() { return dropped },
    get lastError() { return lastError },
    get flushing() { return flushing }
  }
}
