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
 *  2. **幂等**：同 kind + key + payload + eventId 重复 enqueue ⇒ no-op，返回 dup:true；同键新 payload
 *     （如 #280 A1 的 eventId 更新）**持久替换**为新版本，旧发送确认不得删掉新版本。
 *     去重瞄的是**精确复合键**（不是哈希），
 *     哈希只用于生成稳定 id。
 *  3. **有界**：超过 maxItems 丢**最旧**的，dropped 递增 + 记 diag，绝不无限涨。
 *  4. **同步返回**：enqueue() **同步返回** `{ok,...}`（调用点直接读 .ok/.dup/.size，
 *     改 async 会让它们读到 undefined —— 本仓已有 3 个既有套件正是这么红的）。
 *     写盘前取跨进程共享锁；锁忙返回可重试失败，不能无锁写入或阻塞同进程的异步锁所有者。
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
 * ★#307（2026-10-08）跨进程 read-modify-write：入队的落盘形态是「本进程内存队列的整份快照 → 磁盘」。
 *   原子 rename 只保证「读到的字节完整」，**不防旧快照覆盖** —— 两个 createTeamOutbox 实例各自
 *   load 到空队列后依次入队 A、B，双方都返回 ok:true，磁盘只剩 B（A 永久丢失）。故 enqueue 的写路径
 *   = 持**同步共享路径锁**（协议与 lib/shared-state-lock.js **互斥同形**：同一个 <canonical>.lock
 *   文件、同一条 openSync('wx') 认领、同一套死主判定 —— 但本模块的锁是**同步**的，理由见下）
 *   → **写入前重读磁盘** → 按复合键合并 → 落盘 → 释放。正确性来自「重读 + 合并」这一半，锁只负责
 *   不让两个「读-改-写」交叉（对端可能在本进程上次写盘之后追加过条目；只加锁不重读仍然会丢）。
 * ★#308（2026-10-08）落盘失败后的 dup：条目对象带 `persisted` 标记（**真正落盘成功**或**从磁盘
 *   读出**才为 true）。同键同负载的 dup 入队只有在 persisted 为 true 时才回 ok:true；否则必须
 *   **重试落盘**（旧实现无条件 ok:true ⇒ 首次落盘失败后该条永远只在内存里，磁盘一直空，重启即丢）。
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
 * #322：flush 在共享锁内重读并取发送快照，锁外等待网络；确认时再持锁重读，
 * 只删除已发送的精确 revision。eventId 是投递身份，revision 区分同身份删除后重建的 ABA。
 * 依赖：Node 内置模块及 shared-state-lock；变异副本须把共享锁导入解析到生产模块。
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { acquireSharedStateLockSync, withSharedStateLock } from './shared-state-lock.js'

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

// A synchronous producer cannot wait for an asynchronous owner in this event loop.
// Both entry points use the shared acquisition gate and canonical physical path.
function acquireLockSyncPre(file) {
  return acquireSharedStateLockSync(file, { timeoutMs: 0 })
}

/** 两条 entry 是否同内容（幂等判据的唯一来源：enqueue 的 dup 与 #307 的合并共用它）。 */
function sameEntryPre(a, b) {
  if (!a || !b) return false
  if (a.eventId !== b.eventId) return false
  if (safeJsonPre(a.payload) !== safeJsonPre(b.payload)) return false
  return !!(a.unserializable || a.serializable === false) === !!(b.unserializable || b.serializable === false)
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
  // ★#280 A1：调用方给出的**稳定 eventId** 原样带上（入队身份，重试保留同一 ID）。
  const eventId = isNonEmptyStrPre(raw.eventId) ? raw.eventId : ''
  return { kind, key, payload, at, serializable, eventId, revision: randomUUID() }
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
  return { kind: raw.kind, key: raw.key, payload, at, unserializable, eventId: isNonEmptyStrPre(raw.eventId) ? raw.eventId : '', revision: isNonEmptyStrPre(raw.revision) ? raw.revision : 'legacy:' + safeJsonPre(raw) }
}

/** 单条 → 磁盘形状（payload 存文本，避免二次序列化时被改写）。 */
function toDiskPre(item) {
  const s = safeJsonPre(item.payload)
  // ★#280 A1：eventId 随队列持久化 ⇒ 重试/重启后仍是同一个 ID。
  return Object.assign({ kind: item.kind, key: item.key, at: item.at, payloadRaw: s, revision: item.revision }, item.eventId ? { eventId: item.eventId } : {})
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
  let loaded = false
  let flushing = false          // ★单飞闸门（见文件头 TOCTOU 纪律）
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
  function writeNowPre(items = queue) {
    if (!dir) return { ok: false, reason: 'no-dir' }
    let text
    try {
      text = JSON.stringify({ v: 1, pid: process.pid, at: Date.now(), dropped, items: items.map(toDiskPre) })
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
      // ★#308：只有**真正落盘成功**才把条目标记为已持久（dup 入队据此决定要不要重试写盘）。
      for (const it of items) {
        if (it && typeof it === 'object') it.persisted = true
      }
      return { ok: true, path: file }
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }) } catch (_) {}   // 清理失败也不抛
      return failPre('write', (e && e.message) || e)
    }
  }

  function publishQueuePre(items) {
    queue.length = 0
    seen.clear()
    for (const item of items) {
      queue.push(item)
      seen.set(dedupeKeyPre(item.kind, item.key), item)
    }
    loaded = true
  }

  // ★#307/#308 闭包助手（在 api 之前声明；只在运行期被调用，届时 api 已初始化）。
  //   ★注意：写路径的**回滚**与**重读**都必须走 api.load()（磁盘真相），不得用 this.load()
  //   —— 助手的调用点是普通函数调用（this 为 undefined）。

  /**
   * #307 锁内重读：把磁盘现状读出来并**独立成表**（不触碰 live 队列）。
   * @returns {{ok:boolean, disk?:object|null, items?:Array, reason?:string}}
   */
  function mergeDiskPrePre() {
    if (!file) return { ok: false, reason: 'no-dir' }
    let parsed = null
    let raw = ''
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (e) {
      if (e && e.code === 'ENOENT') return { ok: true, disk: null, items: [] }
      return { ok: false, reason: (e && e.message) || String(e) }
    }
    try { parsed = JSON.parse(raw) } catch (e) { return failPre('parse', e.message) }
    const diskItems = parsed && Array.isArray(parsed.items) ? parsed.items : []
    const items = []
    const byKey = new Map()
    for (let i = 0; i < diskItems.length; i++) {
      let it = null
      try { it = sanitizeLoadedPre(diskItems[i]) } catch (_) { it = null }
      if (!it) continue
      const dk = dedupeKeyPre(it.kind, it.key)
      if (byKey.has(dk)) continue
      const ent = { kind: it.kind, key: it.key, payload: it.payload, at: it.at, eventId: it.eventId, revision: it.revision, persisted: true, fromDisk: true }
      if (it.unserializable) ent.unserializable = true
      byKey.set(dk, ent)
      items.push(ent)
    }
    return { ok: true, disk: parsed, items: items, byKey: byKey }
  }

  /**
   * ★#307/#308 的入队写路径：**持锁 → 重读磁盘 → 合并 → 落盘 → 释放**。
   *
   * 为什么不能只靠原子 rename：rename 保证的是「读到的字节完整」，不防「旧快照覆盖新快照」。
   * 两个实例各自 load 空队列后依次入队，谁后写谁赢 ⇒ 先入队的条目永久消失（issue #307）。
   *
   * 合并规则：**磁盘项优先**。理由：本进程内存里的是「上次写盘的候选」，而别的实例在本进程
   * 上次写盘之后写进去的条目才是最新事实；同一键两处都有时，磁盘上那份来自另一实例的读-改-写，
   * 它就是本轮并发的赢家（内存候选是更旧的快照，不得把它盖回去）。
   *
   * @param {Array} candidate 期望落盘的完整条目列表（内存队列的候选快照）
   */
  // Reuse the upstream merge algorithm for enqueue, fresh drain snapshots and ACK.
  // Callers must already own the shared path lock.
  function mergeCandidatePre(candidate) {
      const disk = mergeDiskPrePre()
      if (!disk.ok) return disk
      let merged = candidate
      if (disk.ok) {
        const candByKey = new Map()
        for (const mi of candidate) {
          const dk = dedupeKeyPre(mi.kind, mi.key)
          if (!candByKey.has(dk)) candByKey.set(dk, mi)
        }
        merged = []
        const taken = new Set()
        for (const di of disk.items) {
          const dk = dedupeKeyPre(di.kind, di.key)
          const ci = candByKey.get(dk)
          // ★同键冲突的裁决（#307 与 #280 A1 的交点，判据必须是**持久状态**而不是「谁在磁盘上」）：
          //   候选 persisted !== true ⇒ 它是本进程**刚写入/刚更新、还没确认落盘**的版本 ⇒ 采用候选
          //     （否则「同键更新 payload」会被磁盘上的旧版本静默回滚，#280 A1 直接破功）；
          //   候选 persisted === true ⇒ 它只是本进程**上一次写盘的旧快照** ⇒ 采用磁盘那份。
          if (ci && ci.persisted !== true) merged.push(ci)
          else merged.push(di)
          taken.add(dk)
        }
        for (const mi of candidate) {
          const dk = dedupeKeyPre(mi.kind, mi.key)
          if (taken.has(dk) || mi.persisted === true) continue
          taken.add(dk)
          merged.push(mi)
        }
        // ★有界：合并后可能顶过 maxItems（磁盘现有 + 本地新增），按「丢最旧」收束，绝不无界涨。
        if (merged.length > maxItems) {
          let evicted = 0
          while (merged.length > maxItems) { merged.shift(); evicted++ }
          if (evicted > 0) {
            dropped += evicted
            diag('team-outbox: bounded drop ' + evicted + ' oldest item(s) on merge (maxItems=' + maxItems + ')')
          }
        }
        // ★读-改-写的结果必须回到内存：否则本进程下一次写盘又拿旧快照把别人的条目盖掉。
        queue.length = 0
        for (let i = 0; i < merged.length; i++) queue.push(merged[i])
        seen.clear()
        for (let i = 0; i < queue.length; i++) seen.set(dedupeKeyPre(queue[i].kind, queue[i].key), queue[i])
        if (disk.disk && typeof disk.disk === 'object') {
          const d = Number(disk.disk.dropped)
          if (Number.isFinite(d) && d > dropped) dropped = Math.floor(d)
        }
      }
      return { ok: true, items: merged }
  }

  function writeLockedPre(candidate) {
    if (!file) return { ok: false, reason: 'no-dir' }
    let release
    try { release = acquireLockSyncPre(file) } catch (e) {
      return failPre('lock', String(e.message).startsWith('state-lock-timeout:') ? 'state-lock-busy' : e.message)
    }
    try {
      const merged = mergeCandidatePre(candidate)
      if (!merged.ok) return merged
      // Keep upstream #308's persisted flag and failed-write retry behavior.
      return writeNowPre(merged.items)
    } finally { release() }
  }

  /**
   * ★#307 同族的清空路径：**整份擦除**（不合并 —— 合并会让 clear 变成「什么都没清」）。
   * 仍持共享锁：避免与并发入队的「读-改-写」交叉（对方在我方擦除之后写入的条目不受影响，
   * 这是 clear 语义下应有的结果）。
   */
  function wipeLockedPre() {
    if (!file) return { ok: false, reason: 'no-dir' }
    let release
    try { release = acquireLockSyncPre(file) } catch (e) {
      return failPre('lock', String(e.message).startsWith('state-lock-timeout:') ? 'state-lock-busy' : e.message)
    }
    try {
      const saved = writeNowPre([])
      if (saved.ok) publishQueuePre([])
      return saved
    } finally { release() }
  }

  const api = {
    /**
     * **同步入队**：幂等 + 有界 + 立即落盘。
     *
     * ★同步返回是这个方法的**对外契约**（调用点直接读 .ok/.dup/.size；改成 Promise 会让它们读到
     * undefined）。#307 的跨进程串行化因此走**同步**锁（acquireLockSyncPre），锁被别的进程持有时的
     * 锁忙返回失败并保留未持久条目，等待异步锁所有者不会阻塞本事件循环。
     *
     * 成功回执的共同前提：该条**确实在磁盘上**（`persisted`）—— 落盘失败一律 ok:false（#308）。
     *
     * @returns {{ok:boolean, id:string|null, dup?:boolean, updated?:boolean, dropped?:number, size?:number, reason?:string}}
     *   幂等命中 ⇒ `{ok:true, dup:true}`（仅在**已持久**时才短路；未持久则重试落盘，见 #308）。
     */
    enqueue(entry) {
      if (!loaded) { const r = api.load(); if (!r.ok) return r }
      let item = null
      try { item = sanitizeEntryPre(entry, Date.now()) } catch (e) { item = null }
      if (!item) return Object.assign(failPre('enqueue', 'invalid entry (need {kind,key} as non-empty strings)'), { id: null })
      // ★#308：新条目的「已持久」标记**只能由真正落盘成功来置位**（见 writeNowPre）。
      //   这条标记是 dup 短路的前置条件——旧实现在落盘失败后仍让后续同条入队短路成 ok:true，
      //   于是磁盘永远空、重启恢复 0 条。
      item.persisted = false
      const dk = dedupeKeyPre(item.kind, item.key)
      const id = entryIdPre(item.kind, item.key)
      // ★#280 A1：去重改为**负载感知** —— 同 kind+key 且**负载相同**才算重复投递；
      //   同键但负载已变（如 eventId 更新）⇒ **原位替换为新版本**，绝不静默丢弃更新。
      //   持久 revision 保证跨实例旧确认不会删掉新版本。
      // ★#307：写路径 = 持共享路径锁 → **重读磁盘** → 按复合键合并 → 落盘 → 释放（见 writeLockedPre）。
      //   原子 rename 只保证「读到的字节完整」，不防旧快照覆盖 ⇒ 必须重读合并。
      const previous = seen.get(dk)
      if (previous) {
        // ★#308：dup 短路只对**已在磁盘上**的条目成立；未持久 ⇒ 落到下面的重试写盘分支。
        if (previous.persisted === true && sameEntryPre(previous, item)) {
          return { ok: true, id, dup: true, persisted: true, dropped: 0, size: queue.length }
        }
        const idx = queue.indexOf(previous)
        if (idx >= 0) queue[idx] = item
        seen.set(dk, item)
        const saved = writeLockedPre(queue.slice())
        if (!saved.ok) return { ok: false, id, dropped: 0, size: queue.length, reason: saved.reason }
        // 同内容（此前只是没落盘）⇒ still dup；内容变了 ⇒ updated（#280 A1 的原语义）
        return sameEntryPre(previous, item)
          ? { ok: true, id, dup: true, persisted: true, dropped: 0, size: queue.length }
          : { ok: true, id, updated: true, dropped: 0, size: queue.length }
      }
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
      const w = writeLockedPre(queue.slice())
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
          if (e && e.code === 'ENOENT') { loaded = true; queue.length = 0; seen.clear(); return { ok: true, size: 0, missing: true } }
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
          // ★#308：从磁盘读出来的 ⇒ 该条**确实在磁盘上**（persisted），dup 入队据此可安全短路。
          const item = { kind: it.kind, key: it.key, payload: it.payload, at: it.at, eventId: it.eventId, revision: it.revision, persisted: true }
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
        loaded = true
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
    async flush(sender, options = {}) {
      const cancelled = () => { try { return !!(options && typeof options.isCancelled === 'function' && options.isCancelled()) } catch (_) { return true } }
      if (!loaded) {
        const restored = api.load()
        if (!restored.ok) return { sent: 0, failed: 1, size: queue.length, reason: restored.reason || 'load-failed' }
      }
      // ★单飞闸门：检查 → 置位之间**不得插入 await**（TOCTOU，见文件头并发纪律）。
      if (flushing) return { sent: 0, failed: 0, skipped: true }
      flushing = true
      let ready = []
      const sentItems = []   // ★只有**发出成功**的才出队；失败的必须留在队列（下个 tick 重发）
      let sent = 0
      let failed = 0
      let persistError = ''
      const senderFn = typeof sender === 'function' ? sender : null
      if (!senderFn) {
        // 没给发送器 ⇒ 一条都不发，但必须释放闸门（否则队列永久卡死）
        flushing = false
        return { sent: 0, failed: 0, size: queue.length, dropped, reason: 'sender is not a function' }
      }
      try {
        if (!file) return { sent: 0, failed: 1, size: queue.length, reason: 'no-dir' }
        const restored = await withSharedStateLock(file, () => {
          if (cancelled()) return { ok: true }
          const merged = mergeCandidatePre(queue.slice())
          if (!merged.ok) return merged
          if (merged.items.some(item => item.persisted !== true)) {
            const saved = writeNowPre(merged.items)
            if (!saved.ok) return saved
          }
          ready = queue.slice()
          return merged
        })
        if (!restored.ok) return { sent: 0, failed: 1, size: queue.length, reason: restored.reason }
        for (let i = 0; i < ready.length; i++) {
          if (cancelled()) break
          const item = ready[i]
          const out = { kind: item.kind, key: item.key, payload: item.payload, at: item.at, id: entryIdPre(item.kind, item.key) }
          // ★#280 A1：把入队时的稳定 eventId 一并交给发送器（缺省回落为稳定 id）。
          if (item.eventId) out.eventId = item.eventId
          if (item.unserializable) out.unserializable = true
          try {
            await senderFn(out)
            if (cancelled()) break
            sent++
            sentItems.push(item)
          } catch (e) {
            // 该条**留在队列**（下个 tick 重发），不影响后续条目
            failed++
            failPre('send', (e && e.message) || e)
          }
        }
      } catch (e) {
        failed++
        persistError = failPre('transaction', e.message).reason
      } finally {
        if (!cancelled() && sentItems.length > 0) {
          try {
            const saved = await withSharedStateLock(file, () => {
              if (cancelled()) return { ok: true }
              const merged = mergeCandidatePre(queue.slice())
              if (!merged.ok) return merged
              const acknowledged = new Map(sentItems.map(item => [dedupeKeyPre(item.kind, item.key), item.revision]))
              const remaining = merged.items.filter(item => acknowledged.get(dedupeKeyPre(item.kind, item.key)) !== item.revision)
              const committed = writeNowPre(remaining)
              if (committed.ok) publishQueuePre(remaining)
              return committed
            })
            if (!saved.ok) persistError = saved.reason || 'outbox-persist-failed'
          } catch (e) { persistError = failPre('ack', e.message).reason }
        }
        flushing = false
      }
      return { sent: sent, failed: failed, size: queue.length, dropped: dropped, ...(persistError ? { persisted: false, persistError } : {}) }
    },

    /**
     * 清空并落盘。
     * ★#307 同族：清空是**越界于合并的破坏性操作**，故走 wipeLockedPre（持锁擦除，不合并）；
     * 若是「清空后又被别的实例写入」，那是 clear 语义下的正常结果，不是丢数据。
     * @returns {{ok:boolean, path?:string, reason?:string}}
     */
    clear() {
      return wipeLockedPre()
    },

    // ---- 只读观测（供心跳/设置页诊断用；不改变契约） ----
    get file() { return file },
    get maxItems() { return maxItems },
    get dropped() { return dropped },
    get lastError() { return lastError },
    get flushing() { return flushing }
  }
  return api
}
