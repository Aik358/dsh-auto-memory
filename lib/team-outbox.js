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
 *  2. **幂等**：同 kind + key + payload 重复 enqueue ⇒ no-op，返回 dup:true；同键新 payload
 *     （如 #280 A1 的 eventId 更新）**持久替换**为新版本，旧发送确认不得删掉新版本。
 *     去重瞄的是**精确复合键**（不是哈希），
 *     哈希只用于生成稳定 id。
 *  3. **有界**：超过 maxItems 丢**最旧**的，dropped 递增 + 记 diag，绝不无限涨。
 *  4. **同步返回、有界等待**：enqueue() **同步返回** `{ok,...}`（调用点直接读 .ok/.dup/.size，
 *     改 async 会让它们读到 undefined —— 本仓已有 3 个既有套件正是这么红的）。
 *     ★#307 起写盘前要取**跨进程共享锁**，故无竞争时开销=几次同步 syscall；锁被别的进程持有时
 *     最长等待 LOCK_TIMEOUT_MS_PRE（有界、Atomics.wait 睡眠不烧 CPU）。
 *     ★#342（2026-10-13，用户裁定方案 (a)）：**超时不再 fail-soft 降级**。
 *     旧契约「绝不因为锁让入队失败」已被推翻 —— 无锁降级写盘会与并发读-改-写交叉，
 *     双方都回 ok:true 而先写的事件被覆盖（丢事件却双双谎报成功）。现改为 fail-closed：
 *     拿不到锁 ⇒ 返回 ok:false / reason 可重试，**不发布快照、不清空、不确认、不落盘**，
 *     未提交数据原样留在内存队列里等下个 tick 重试。
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
 *  - ★#322：flush 的发送快照是**锁内从磁盘重读合并**出来的（不是本进程缓存），
 *    发送期间新 enqueue 的条目一律**合流保留**，不会被本次确认删除覆盖掉。
 *  - flush 在途期间同 kind+key 又被更新 ⇒ 确认删除按**版本身份**判据跳过该键，
 *    新版本**留在队列**、下个 tick 重发，旧确认绝不删掉新版本（#280 A1）。
 *    避免「更新的变更被在途的旧推送吃掉」。
 *
 * 依赖：仅 node:fs / node:path / node:os（零 npm 依赖，**不 import 其它 lib**：本模块会被测试
 * 搬家成孪生副本做变异取证，任何相对导入都会让副本直接加载失败）。行尾 LF、无 BOM。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

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

/** ★#307 共享锁的等待上限（ms）：拿不到就 fail-closed（#342 裁定 (a)，见文件头与 writeLockedPre）。 */
const LOCK_TIMEOUT_MS_PRE = 3000
/** 争锁时的重试间隔（ms）：用 Atomics.wait 真睡眠（本仓曾因忙等把整批回归卡死过）。 */
const LOCK_POLL_MS_PRE = 20

/**
 * ★#307 同步版共享锁。
 *
 * 为什么不用 lib/shared-state-lock.js：那个模块的 acquireSharedStateLock 是 **async** 的，
 * 而本模块 enqueue() 的公开契约是**同步返回** `{ok,...}`（调用点与既有回归套件都直接读返回值；
 * 改成 Promise 会让 .ok 变成 undefined —— 实测当场红 3 个既有套件）。
 *
 * 锁协议与 lib/shared-state-lock.js **同形**，因此两侧可互相排斥（同一个 <canonical>.lock 文件、
 * 同一条 openSync('wx') 认领原语、同一套 dead-owner 判定）：
 *   · 路径规范化照抄 canonicalSharedStatePath 的语义（realpath 到「最深存在的祖先」再拼回缺失后缀），
 *     否则同一个文件可能因大小写/短名/符号链接得到两把不同的锁；
 *   · 认领 = openSync(lock, 'wx')（原子创建，先到先得）；释放 = 关闭 + unlink；
 *   · 死主回收只认「同主机 + 正整数 pid + ESRCH」——崩溃进程留下的锁不会永久悬挂。
 * 拿不到锁 ⇒ 返回 null（绝不抛）。★#342 起调用方**不再**按「无锁继续」处理：
 *   writeLockedPre / wipeLockedPre / snapshotLockedPre 三处都改为 fail-closed（无锁不写盘、
 *   不擦除、不发布快照），ackLockedPre 早就是 fail-closed。
 */

/** 同 canonicalSharedStatePath：realpath 到最深存在祖先 + 拼回缺失后缀（同步版）。 */
function canonicalLockTargetPre(file) {
  let target = path.resolve(file)
  const suffix = []
  for (;;) {
    try { return path.join(fs.realpathSync.native(target), ...suffix) } catch (e) {
      if (!e || e.code !== 'ENOENT') return path.resolve(file)
      const parent = path.dirname(target)
      if (parent === target) return path.resolve(file)
      suffix.unshift(path.basename(target))
      target = parent
    }
  }
}

/** 同 lib/shared-state-lock.js 的 isDead：只认「同主机 + 正整数 pid + 进程已消失(ESRCH)」。 */
function ownerIsDeadPre(owner) {
  if (!owner || owner.host !== os.hostname() || !Number.isInteger(owner.pid) || owner.pid <= 0) return false
  try { process.kill(owner.pid, 0); return false } catch (e) { return e.code === 'ESRCH' }
}

/** 同步睡眠（不烧 CPU）；极少数环境不支持 Atomics.wait 时退化为紧循环（有界）。 */
function sleepSyncPre(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (_) {
    const end = Date.now() + ms
    while (Date.now() < end) { /* 兜底自旋 */ }
  }
}

/**
 * 取同步共享锁。
 * @returns {null|function():void} 成功返回 release()；超时或打不开锁文件返回 null（降级）。
 */
function acquireLockSyncPre(file, timeoutMs = LOCK_TIMEOUT_MS_PRE) {
  const lock = canonicalLockTargetPre(file) + '.lock'
  try { fs.mkdirSync(path.dirname(lock), { recursive: true }) } catch (_) {}
  const deadline = Date.now() + timeoutMs
  for (;;) {
    let fd = -1
    try {
      fd = fs.openSync(lock, 'wx')   // ← 互斥原语（与 shared-state-lock 同一条）
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname() })) } catch (_) {}
      return function releaseLockPre() {
        try { fs.closeSync(fd) } catch (_) {}
        try { fs.unlinkSync(lock) } catch (_) {}
      }
    } catch (e) {
      if (fd !== -1) { try { fs.closeSync(fd) } catch (_) {} }
      if (!e || e.code !== 'EEXIST') return null   // 权限等其它错误 ⇒ 直接降级
      // 死主回收（与 shared-state-lock 同一判据）：不回收会让一次崩溃永久堵死所有入队
      try {
        const owner = JSON.parse(fs.readFileSync(lock, 'utf8'))
        if (ownerIsDeadPre(owner)) { try { fs.unlinkSync(lock) } catch (_) {} continue }
      } catch (_) {}
      if (Date.now() >= deadline) return null
      sleepSyncPre(LOCK_POLL_MS_PRE)
    }
  }
}

/** 两条 entry 是否同内容（幂等判据的唯一来源：enqueue 的 dup 与 #307 的合并共用它）。 */
function sameEntryPre(a, b) {
  if (!a || !b) return false
  if (safeJsonPre(a.payload) !== safeJsonPre(b.payload)) return false
  return !!(a.unserializable || a.serializable === false) === !!(b.unserializable || b.serializable === false)
}

/** 幂等键的内部拼法（NUL 不会出现在正常字符串里，避免 kind/key 拼接歧义）。 */
function dedupeKeyPre(kind, key) {
  return kind + '\u0000' + key
}

/** FNV-1a 32 位（与 entryIdPre 同一算法，供「操作身份」做稳定短 id）。 */
function hashStrPre(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h = (h ^ s.charCodeAt(i)) >>> 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * ★#489（2026-11-02）**事件增量的操作身份**。
 *
 * 缺陷：`enqueueEventChangePre`（lib/index.js）恒以 `{kind:'event', key:eventId}` 入队，而 payload
 * 装的是**增量操作**（create / append / set），不是完整快照。而本模块的去重键是「kind+key」、
 * 命中后 `queue[idx] = item` **原位替换** —— 那个语义对「完整快照」正确（fact / baseline 靠它），
 * 对「增量」致命：同一次 flush 前的 create → append(A) → append(B) 只剩最后一条，
 * 而 append 在接收端要求事件已存在 ⇒ **变更永久丢失且不可从后续增量重建**。
 *
 * 修法：给 event 增量算一个**由操作内容决定的稳定操作 ID**，并入身份键。
 *   · 两条**不同操作**（payload 不同）⇒ 不同操作 ID ⇒ 队列里各自成条（#489 的修复点）；
 *   · 同一个操作**重试**（payload 逐字节相同）⇒ 同一操作 ID ⇒ 仍然去重（保留幂等语义）。
 *   ⚠️ 不做「按 eventId 合并成最新快照」：append 是 append-only，
 *      A、B 两个检查点必须在接收端各落一条，合并即丢数据。
 *   ⚠️ 计算放在本模块（而不是让调用方传 opKey）：调用点是 lib/index.js 的 enqueueEventChangePre，
 *      在生产装配里是**唯一**入口；在这里派生可保证「无论谁调 enqueue 都成立」，不再依赖调用方记得传。
 *
 * @param {string} kind 变更类型
 * @param {*} payload 变更负载
 * @returns {string} 空串 = 不需要操作身份（非 event 类，保持原「完整快照替换」语义）
 */
function opKeyOfPre(kind, payload) {
  if (kind !== 'event') return ''
  const s = safeJsonPre(payload)
  // 不可序列化的负载拿不到稳定身份 ⇒ 退回空串（仍按 eventId 去重，与旧行为一致，绝不静默丢条目）
  return s === null ? '' : 'op-' + hashStrPre(s)
}

/**
 * ★P1-1b（2026-11-02 · #511/#512）**操作身份的唯一裁决点**。
 *
 * 判据：操作身份必须是**操作实例**，不是**内容指纹**。
 *   · 内容指纹做不到的事：set X → set Y → set X 的第三次与第一次内容全等
 *     ⇒ 被当成「同一操作的重试」而丢弃（#512 实测：队列只剩 2 条）。
 *   · 操作实例 ID 才能同时满足两条相反要求：**不同操作各自成条**、**同一操作重试仍去重**。
 *
 * 采用顺序（**调用方优先，内容哈希兜底**）：
 *   ① 调用方显式给了非空字符串 opKey ⇒ 直接用（操作实例 ID，形如 eventId:op:seq）；
 *   ② 否则回退 opKeyOfPre 的内容哈希 ⇒ **旧调用点、旧磁盘文件的行为逐字不变**。
 *
 * ★为什么兜底必须保留：lib/index.js 的 enqueueEventChangePre 在本批里**尚未**传 opKey
 *   （Lead 后续会传）。在它传之前，全仓行为必须与改动前完全一致 —— 否则这次改动本身就成了
 *   一次「半修」：改了队列层却让未传 opKey 的路径更早失效。
 * ★纯函数：同一 (opKey, kind, payload) 永远得同一个结果，可安全重复调用。
 *
 * @param {string} opKey   调用方给的操作实例 ID（可为空/undefined）
 * @param {string} kind    变更类型
 * @param {*} payload      变更负载
 * @returns {string} 空串 = 无操作身份（非 event 类 / 不可序列化），语义同改动前
 */
function resolveOpKeyPre(opKey, kind, payload) {
  if (isNonEmptyStrPre(opKey)) return opKey
  return opKeyOfPre(kind, payload)
}

/**
 * ★#489 **身份键**（去重的唯一来源）：非 event 类 = kind+key（完整快照替换，逐字不变）；
 * event 增量 = kind+key+opKey（不同操作各自成条，同一操作重试仍去重）。
 */
function identityKeyPre(item) {
  const base = dedupeKeyPre(item.kind, item.key)
  return item.opKey ? base + '\u0000' + item.opKey : base
}

/** 稳定 id：同身份 ⇒ 同 id（FNV-1a，供调用方对账；去重**不**依赖它）。 */
function entryIdPre(kind, key, opKey) {
  const s = kind + '\u0000' + key + (opKey ? '\u0000' + opKey : '')
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
  // ★P1-1b（#511/#512）：**调用方给的 opKey 优先**，缺失才回退内容哈希。
  //   旧调用点（不传 opKey）走回退分支 ⇒ 行为与改动前逐字相同。
  const opKey = resolveOpKeyPre(raw.opKey, kind, payload)
  return { kind, key, payload, at, serializable, eventId, opKey }
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
  // ★P1-1b（#511/#512）：**磁盘上的 opKey 优先**；读不到才回退内容哈希。
  //   为什么必须落盘：内容哈希区分不了「set X→Y→X」的第三次，只有操作实例 ID 能。
  //   旧队列文件（无 opKey 字段）走回退分支 ⇒ 行为与改动前逐字相同（向前兼容）。
  return { kind: raw.kind, key: raw.key, payload, at, unserializable, eventId: isNonEmptyStrPre(raw.eventId) ? raw.eventId : '', opKey: resolveOpKeyPre(raw.opKey, raw.kind, payload) }
}

/** 单条 → 磁盘形状（payload 存文本，避免二次序列化时被改写）。 */
function toDiskPre(item) {
  const s = safeJsonPre(item.payload)
  // ★#280 A1：eventId 随队列持久化 ⇒ 重试/重启后仍是同一个 ID。
  // ★P1-1b（#511/#512）：opKey 也落盘（**可选字段**）—— 操作实例 ID 无法从 payload 重建，
  //   不落盘就等于重启后丢掉「这是第几次操作」。为空时**不写该字段** ⇒ 旧格式文件逐字不变。
  return Object.assign(
    { kind: item.kind, key: item.key, at: item.at, payloadRaw: s },
    item.eventId ? { eventId: item.eventId } : {},
    item.opKey ? { opKey: item.opKey } : {},
  )
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
  // ★#307：同步入队的锁等待上限（可配置）。默认 3000ms；在意「入队延迟预算」的调用方可以收紧。
  //   ★#342（用户裁定 (a)）：超时**不再** fail-soft 降级 —— 返回 ok:false 由调用方重试，
  //   内存队列原样保留，绝不会把入队挂死、也绝不无锁写盘。
  let lockTimeoutMs = Number(opts.lockTimeoutMs)
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0) lockTimeoutMs = LOCK_TIMEOUT_MS_PRE
  lockTimeoutMs = Math.floor(lockTimeoutMs)

  const queue = []              // 队首 = 最旧
  const seen = new Map()        // 复合去重键 → 队列中那条 item（O(1) 幂等判据）
  let loaded = false
  let flushing = false          // ★单飞闸门（见文件头 TOCTOU 纪律）
  let dropped = 0
  let lastError = ''
  let lastDiagMsg = ''

  /** 记一次失败：写 lastError + 同一条只 diag 一次（避免刷日志）。返回结构化失败 {ok:false, reason}。
   *  ★#342 起，锁相关失败也是**真失败**（不再是「降级但照常成功」），调用方据此重试。 */
  function failPre(where, reason) {
    const msg = where + ': ' + String(reason)
    lastError = msg
    if (msg !== lastDiagMsg) {
      lastDiagMsg = msg
      diag('team-outbox: ' + where + ' failed: ' + String(reason))
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

  /**
   * 合并裁决（#307 与 #280 A1 的交点）——**入队、取 drain 快照、确认删除三处共用这一份实现**。
   * 同一语义若分散在各处各写一份判据，改一处漏一处就成「半修」，症状看起来像新 bug。
   *
   * 判据是**持久状态**而不是「谁在磁盘上」：
   *   候选 persisted !== true ⇒ 本进程刚写入/刚更新、**还没确认落盘**的版本 ⇒ 采用候选
   *     （否则同键的 payload/eventId 更新会被磁盘上的旧版本静默回滚，#280 A1 直接破功）；
   *   候选 persisted === true ⇒ 它只是本进程上一次写盘的旧快照 ⇒ 采用磁盘那份。
   * 纯函数：不读写内存队列。
   */
  function mergeItemsPre(candidate, diskItems) {
    // ★#489：合并/去重一律按 identityKeyPre（event 增量带操作身份；其余 = kind+key 逐字不变）
    const candByKey = new Map()
    for (const mi of candidate) {
      const dk = identityKeyPre(mi)
      if (!candByKey.has(dk)) candByKey.set(dk, mi)
    }
    const merged = []
    const taken = new Set()
    for (const di of diskItems) {
      const dk = identityKeyPre(di)
      const ci = candByKey.get(dk)
      merged.push(ci && ci.persisted !== true ? ci : di)
      taken.add(dk)
    }
    for (const mi of candidate) {
      const dk = identityKeyPre(mi)
      if (taken.has(dk)) continue
      taken.add(dk)
      merged.push(mi)
    }
    return merged
  }

  /** 有界收束（**纯函数**：只作用在候选数组上，不碰内存队列/不给 dropped 记账）。 */
  function boundPre(items) {
    if (items.length <= maxItems) return { items: items, evicted: 0 }
    const out = items.slice()
    let evicted = 0
    while (out.length > maxItems) { out.shift(); evicted++ }
    return { items: out, evicted: evicted }
  }

  /**
   * ★原子化地「收束 + 落盘 + 提交内存」——**写盘成功才改内存**。
   *
   * 这条顺序是本缺陷与既有契约的交点（#322 × issue174）：
   *   旧实现先改内存、再落盘 ⇒ rename 失败时内存已被清空，界面/同步层看到 size=0、queue=0，
   *   而磁盘上事件还在 ⇒ 「HTTP 已 ACK 但没落盘」被谎报成成功。
   *   正确顺序 = **先写盘、成功后才提升内存**；失败时内存与磁盘**双双保持原样**，由调用方如实上报。
   */
  function applyMemoryPre(boundedItems, evicted) {
    if (evicted > 0) {
      dropped += evicted
      diag('team-outbox: bounded drop ' + evicted + ' oldest item(s) on merge (maxItems=' + maxItems + ')')
    }
    // ★读-改-写的结果必须回到内存：否则本进程下一次写盘又拿旧快照把别人的条目盖掉（#307 的根部）。
    queue.length = 0
    for (let i = 0; i < boundedItems.length; i++) queue.push(boundedItems[i])
    seen.clear()
    // ★#489：seen 表的键 = 身份键（event 增量按操作身份，其余按 kind+key）
    for (let i = 0; i < queue.length; i++) seen.set(identityKeyPre(queue[i]), queue[i])
  }

  function commitPre(items) {
    const bounded = boundPre(items)
    const saved = writeNowPre(bounded.items)
    if (!saved.ok) return saved
    applyMemoryPre(bounded.items, bounded.evicted)
    return saved
  }

  /** 同一条目的「版本身份」判据（payload + eventId + 可序列化标记）：确认删除用它，不用对象引用。 */
  function sameVersionPre(a, b) {
    if (!a || !b) return false
    // ★#489：操作身份也进版本判据 —— 同一 eventId 的两个不同 append 是**两个版本**，
    //   确认删除绝不能用一个的 ACK 把另一个删掉。
    if ((a.opKey || '') !== (b.opKey || '')) return false
    if (safeJsonPre(a.payload) !== safeJsonPre(b.payload)) return false
    if ((a.eventId || '') !== (b.eventId || '')) return false
    return !!(a.unserializable || a.serializable === false) === !!(b.unserializable || b.serializable === false)
  }

  /**
   * ★#322 drain 准备（**锁内**）：把磁盘现状与本地候选合并成「此刻真正待发的事件」，
   * 顺带把本地还没落盘的条目重试落盘（#308 的持久重试不许丢）。
   *
   * 为什么快照必须从磁盘取：本实例空闲期间别的实例入队的事件、或别的实例替换过的新版本，
   * 在本进程缓存里根本不存在 —— 旧实现直接发 queue.slice()，于是「该发的一条都不发」，
   * 收尾还拿这份旧缓存写盘（报告人实测：空缓存实例永远发不出别人的事件）。
   *
   * ⚠️ 只在**取快照**时持锁；随后的 await sender() 全程不持锁（持锁等网络会让别的进程
   * 入队全部超时失败 —— 这条由回归锁的负路径钉死）。
   */
  function snapshotLockedPre() {
    if (!file) return { ok: false, items: queue.slice(), reason: 'no-dir' }
    let release = null
    try { release = acquireLockSyncPre(file, lockTimeoutMs) } catch (e) { release = null }
    // ★#342（用户裁定 (a)）：**门在调度序列最前面** —— 取不到互斥锁 ⇒ 立即 fail-closed：
    //   既不发布快照（items 不交给调用方），也**绝不允许** release 为空时继续走到
    //   commitPre(merged) 那条「未持久条目重试落盘」的写出口（旧实现正是这样无锁写盘的）。
    //   调用方据此第 ① 步就不发（拿不到持久保证的发送只是徒劳），队列原样保留、下个 tick 重试。
    if (!release) return { ok: false, items: [], reason: 'state-lock-busy', persisted: false, persistError: 'state-lock-busy' }
    try {
      const disk = mergeDiskPrePre()
      if (!disk.ok) return { ok: false, items: queue.slice(), reason: disk.reason || 'read-failed' }
      const merged = mergeItemsPre(queue.slice(), disk.items)
      if (disk.disk && typeof disk.disk === 'object') {
        const d = Number(disk.disk.dropped)
        if (Number.isFinite(d) && d > dropped) dropped = Math.floor(d)
      }
      // ★#308：本地还有 persisted !== true 的条目 ⇒ 先把它落盘（重试语义），否则它会被当成
      //   「已发出」却从未持久，重启即丢。
      // ★全部已持久 ⇒ **一个字节都不写**：磁盘上本来就有这些条目，再写一次只是徒增 IO，
      //   还会破坏「确认失败时磁盘逐字节未变」这一可观测不变量（回归锁按字节比对）。
      if (merged.some((it) => it.persisted !== true)) {
        const saved = commitPre(merged)
        // 连快照都落不下盘 ⇒ **不发**（拿不回持久保证的发送只是徒劳），并按既有失败契约上报：
        //   persisted:false 让同步层抛 outbox-persist-failed ⇒ 界面 phase=offline、队列原样保留。
        if (!saved.ok) {
          return {
            ok: false, items: [], failed: 1,
            reason: saved.reason || 'drain-persist-failed',
            persisted: false, persistError: saved.reason || 'drain-persist-failed',
          }
        }
      } else {
        const bounded = boundPre(merged)
        applyMemoryPre(bounded.items, bounded.evicted)
        return { ok: true, items: bounded.items.slice() }
      }
      return { ok: true, items: merged.slice() }
    } finally {
      if (release) { try { release() } catch (_) {} }
    }
  }

  /**
   * 确认删除（**锁内**）：重读磁盘 → 按身份剔除本次已发出的那些 → 落盘。
   *
   * @param {Map<string,object>} ackMap 复合键 → 本次**真正发出**且此刻内存里未变版本的条目
   * @returns {{ok:boolean, reason?:string}}
   */
  function ackLockedPre(ackMap) {
    if (!file) return { ok: false, reason: 'no-dir' }
    let release = null
    try { release = acquireLockSyncPre(file, lockTimeoutMs) } catch (e) { release = null }
    // ★锁拿不到 ⇒ **不删除**并如实上报；绝不允许「超时后无锁写盘」（那正是 #322 的降级形态）
    if (!release) return { ok: false, reason: 'state-lock-busy' }
    try {
      const disk = mergeDiskPrePre()
      if (!disk.ok) return { ok: false, reason: disk.reason || 'ack-read-failed' }
      // ★判据用「键 + 版本身份」而**不是对象身份**：
      //   上一版按 seen.get(dk) === item 收集确认集，但合并规则在候选已持久时会改用**磁盘读出的
      //   新对象** ⇒ 身份恒不相等 ⇒ 确认集永远为空 ⇒ 已发出的事件永远删不掉（实测：size 不减、
      //   磁盘不变、却回 sent:1）。版本判据同时天然覆盖 #280 A1 的 eventId 更新与 ABA 覆盖。
      const keep = []
      const keptKeys = new Set()
      // ★#489：确认集的键必须是**身份键**（含操作身份），否则两个不同 append 会互相顶掉。
      const isAckedVersion = (it) => {
        const dk = identityKeyPre(it)
        const acked = ackMap.get(dk)
        return !!acked && sameVersionPre(it, acked)
      }
      for (const di of disk.items) {
        const dk = identityKeyPre(di)
        if (isAckedVersion(di)) continue   // 磁盘上那份就是「已发出且未变」的版本 ⇒ 删除
        keep.push(di)
        keptKeys.add(dk)
      }
      // ★内存里还有「磁盘上没有」的条目（本进程刚更新、还没落盘的新版本）⇒ 必须**继续保留**，
      //   否则确认删除会把发送期间产生的更新一起吞掉（#308 的同族形态：未持久 == 不能丢）。
      for (const mi of queue.slice()) {
        const dk = identityKeyPre(mi)
        if (keptKeys.has(dk)) continue
        if (isAckedVersion(mi)) continue  // 已发出且内存里仍是同一版本 ⇒ 该键彻底出队
        keep.push(mi)
        keptKeys.add(dk)
      }
      // ★commitPre 是原子化的「收束+落盘+提交内存」：写盘失败 ⇒ 内存与磁盘都保持原样
      //   （issue174 的契约：HTTP 已 ACK 但落盘失败时，队列必须**原样保留**待重试）
      const saved = commitPre(keep)
      return saved.ok ? { ok: true } : { ok: false, reason: saved.reason || 'outbox-persist-failed' }
    } finally {
      if (release) { try { release() } catch (_) {} }
    }
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
    try { parsed = JSON.parse(raw) } catch (_) { parsed = null }   // 坏 JSON ⇒ 当空（与 load 同口径，不删数据）
    const diskItems = parsed && Array.isArray(parsed.items) ? parsed.items : []
    const items = []
    const byKey = new Map()
    for (let i = 0; i < diskItems.length; i++) {
      let it = null
      try { it = sanitizeLoadedPre(diskItems[i]) } catch (_) { it = null }
      if (!it) continue
      const dk = identityKeyPre(it)
      if (byKey.has(dk)) continue
      // ★#489：磁盘条目**必须带上从 payload 重算出的 opKey**，否则身份键退化为 kind+key，
      //   与内存里那条（有 opKey）对不上 ⇒ 同一条被当成两条重复保留（实测：1 条变 3 条）。
      const ent = { kind: it.kind, key: it.key, payload: it.payload, at: it.at, eventId: it.eventId, opKey: it.opKey, persisted: true, fromDisk: true }
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
   * 入队写路径（#307）：**持锁 → 重读磁盘 → 合并 → 落盘 → 释放**。
   * 有界收束、合并裁决、写回内存三件事都走 commitPre / mergeItemsPre 这一份实现（见上）。
   *
   * ★#342（2026-10-13，用户裁定方案 (a)）：**取不到互斥锁 ⇒ 明确失败，不发布任何结果**。
   *   旧实现是 fail-soft：拿不到锁只把原因记进 lastError，然后照样「重读 + 合并 + 落盘」。
   *   那个降级**根本不安全** —— 它退化成的正是 #307 要修的形状「后写者覆盖先写者」：
   *   两个进程同时写，谁都以为自己重读过了，但两次读-改-写交叉 ⇒ 先写的事件被后写者抹掉，
   *   而**两边的调用方都拿到 ok:true**（丢事件却双双谎报成功，正是 #342 的报告症状）。
   *   「重读 + 合并」只有**在锁内**才是正确的：锁负责不让两个读-改-写交叉，重读负责看到对端的追加。
   *   二者缺一不可 ⇒ 拿不到锁时的正确动作是**失败并让调用方重试**，而不是降级写盘。
   *
   * @param {Array} candidate 期望落盘的完整条目列表（内存队列的候选快照）
   */
  function writeLockedPre(candidate) {
    if (!file) return { ok: false, reason: 'no-dir' }
    let release = null
    try {
      release = acquireLockSyncPre(file, lockTimeoutMs)
    } catch (e) {
      release = null
    }
    // ★#342：无锁 ⇒ fail-closed。内存队列**不动**（未提交数据保留，调用方重试即可），磁盘**不写**。
    if (!release) return failPre('lock', 'lock unavailable or timeout ' + lockTimeoutMs + 'ms (fail-closed: nothing published, retry)')
    try {
      const disk = mergeDiskPrePre()
      let merged = candidate
      if (disk.ok) {
        merged = mergeItemsPre(candidate, disk.items)
        if (disk.disk && typeof disk.disk === 'object') {
          const d = Number(disk.disk.dropped)
          if (Number.isFinite(d) && d > dropped) dropped = Math.floor(d)
        }
      }
      const saved = commitPre(merged)
      // ★#308：写**失败**时**不回滚内存**。理由就是这条缺陷的处方本身 ——「未持久条目的重复 enqueue
      //   必须重试写盘」的前提是该条目还在队列里：若在这里 load() 回滚，条目会被磁盘真相挤掉，
      //   后续同键入队走的是「新增」而不是「重试」，重试语义无从谈起。
      //   内存与磁盘的短暂分叉由 persisted 标记如实表达（磁盘读入=true／本地未落盘=false），
      //   任何后续写路径都会把它再带进去重试；调用方拿到的是 ok:false，不存在「谎报已保存」。
      return saved
    } finally {
      if (release) { try { release() } catch (_) {} }
    }
  }

  /**
   * ★#307 同族的清空路径：**整份擦除**（不合并 —— 合并会让 clear 变成「什么都没清」）。
   * 仍持共享锁：避免与并发入队的「读-改-写」交叉（对方在我方擦除之后写入的条目不受影响，
   * 这是 clear 语义下应有的结果）。
   */
  function wipeLockedPre() {
    if (!file) return { ok: false, reason: 'no-dir' }
    let release = null
    try {
      release = acquireLockSyncPre(file, lockTimeoutMs)
    } catch (e) {
      release = null
    }
    // ★#342（用户裁定 (a)）：无锁 ⇒ **不清空、不落盘**。擦除是破坏性操作，无锁擦除会与
    //   并发入队的「读-改-写」交叉 ⇒ 对方刚写入的条目会被整份空数组抹掉（丢事件）。
    if (!release) return failPre('lock', 'lock unavailable or timeout ' + lockTimeoutMs + 'ms (fail-closed: nothing cleared, retry)')
    try {
      const saved = writeNowPre([])
      if (!saved.ok) { try { api.load() } catch (_) {} }
      return saved
    } finally {
      if (release) { try { release() } catch (_) {} }
    }
  }

  const api = {
    /**
     * **同步入队**：幂等 + 有界 + 立即落盘。
     *
     * ★同步返回是这个方法的**对外契约**（调用点直接读 .ok/.dup/.size；改成 Promise 会让它们读到
     * undefined）。#307 的跨进程串行化因此走**同步**锁（acquireLockSyncPre），锁被别的进程持有时的
     * 等待有界（LOCK_TIMEOUT_MS_PRE，Atomics.wait 睡眠）；★#342 起超时返回 ok:false（可重试），
     * 绝不无锁写盘、绝不把入队挂住。
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
      // ★★#489（2026-11-02）：去重键由 `kind+key` 改为 **identityKeyPre**。
      //   对 event 增量，身份键含「操作身份」（payload 的稳定哈希）⇒ 同一事件的 create / append(A) /
      //   append(B) 是**三条不同条目**，各自成条、按序发出；同一操作重试仍是同一条目 ⇒ 幂等不变。
      //   对 fact / baseline / handoff 等**完整快照**类，opKeyOfPre 返回空串 ⇒ 身份键逐字等于
      //   kind+key ⇒ 「同键新版本原位替换」的既有语义（#280 A1）**完全不变**。
      const dk = identityKeyPre(item)
      const id = entryIdPre(item.kind, item.key, item.opKey)
      // ★#280 A1：去重改为**负载感知** —— 同 kind+key 且**负载相同**才算重复投递；
      //   同键但负载已变（如 eventId 更新）⇒ **原位替换为新版本**，绝不静默丢弃更新。
      //   确认删除走 ackLockedPre 的**版本身份**判据（payload + eventId 都没变才删）：
      //   旧发送确认既删不掉新版本，也删不掉别的实例换上的同键新版本（#322 + #280 A1）。
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
        seen.delete(identityKeyPre(evicted))
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
          const dk = identityKeyPre(it)   // ★#489：event 增量按操作身份，不同操作不互顶
          if (nextSeen.has(dk)) { skipped++; continue }   // 磁盘上有重键 ⇒ 保第一份（更旧）
          // ★#308：从磁盘读出来的 ⇒ 该条**确实在磁盘上**（persisted），dup 入队据此可安全短路。
          // ★#489：同上 —— 载入到内存的条目也必须带 opKey（sanitizeLoadedPre 已从 payload 重算）
          const item = { kind: it.kind, key: it.key, payload: it.payload, at: it.at, eventId: it.eventId, opKey: it.opKey, persisted: true }
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
     * ★#322 四段结构（旧实现三个缺陷都在这里）：
     *   ① **锁内重读**取 drain 快照（snapshotLockedPre）—— 发「此刻磁盘+本地真正待发的事件」，
     *      不再发本进程的旧缓存（旧实现：空闲实例永远发不出别的实例入队的事件）；
     *   ② `await sender()` 全程**锁外** —— 持锁等网络会让别的进程入队全部超时（负路径钉死）；
     *   ③ 确认删除走 ackLockedPre：**锁内重读 + 按版本身份删**（含 eventId 更新与 ABA），
     *      锁拿不到 ⇒ 不删除并如实上报，**绝不超时后无锁写盘**；
     *   ④ 取消/发送失败/确认失败 ⇒ 事件**留在队列**等下个 tick 重发（at-least-once）。
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
      const acked = new Map()   // 复合键 → 本次真正发出、且此刻内存里**仍是同一版本**的条目
      let sent = 0
      let failed = 0
      let persistError = ''
      let drain = { ok: true, items: [] }
      const senderFn = typeof sender === 'function' ? sender : null
      try {
        if (!senderFn) {
          // 没给发送器 ⇒ 一条都不发（但闸门必须在 finally 里释放，否则队列永久卡死）
          return { sent: 0, failed: 0, size: queue.length, dropped, reason: 'sender is not a function' }
        }
        // ① 锁内重读取快照（失败 ⇒ 本次不发，避免拿旧缓存做「无依据的删除」）
        drain = snapshotLockedPre()
        if (!drain.ok) {
          // ★与既有「持久失败」契约同形：persisted:false ⇒ 同步层将其视为**持久化失败**并上报
          //   （message 含 outbox-persist-failed），界面 phase=offline、队列条数原样保留。
          //   failed 计 1：本次 tick 确实失败了（老契约里 failed 是 tick 级失败计数）。
          //   注意这里**不发**：拿不到可持久化的快照就发，等于让调用方以为这些变更已经安全。
          return {
            sent: 0, failed: 1, size: queue.length, dropped,
            persisted: false, persistError: drain.reason || 'drain-snapshot-failed',
          }
        }
        // ② 锁外发送
        for (const item of drain.items) {
          if (cancelled()) break
          // ★#489：id 也带操作身份 ⇒ 同一 eventId 的多条增量各有唯一 id（对账时不会混为一条）
          const out = { kind: item.kind, key: item.key, payload: item.payload, at: item.at, id: entryIdPre(item.kind, item.key, item.opKey) }
          // ★P1-1b（#511/#512）：把操作身份一并交给发送器 —— 发送层凭它构造 idemKey。
          //   为空时不写该字段（保持 out 的旧形状逐字不变，既有套件按对象断言不会红）。
          if (item.opKey) out.opKey = item.opKey
          // ★#280 A1：把入队时的稳定 eventId 一并交给发送器（缺省回落为稳定 id）。
          if (item.eventId) out.eventId = item.eventId
          if (item.unserializable) out.unserializable = true
          try {
            await senderFn(out)
            if (cancelled()) break
            sent++
            // ★ 进确认集的是「本次真正发出」的条目；**是否真的删**由 ackLockedPre 在锁内用
            //   「键 + 版本身份」裁决：发送期间同键被换成新版本 ⇒ 磁盘/内存里已不是这个版本 ⇒
            //   确认落空、新版本保留（#280 A1）。这样判据只有一处，不再依赖对象身份。
            acked.set(identityKeyPre(item), item)   // ★#489：身份键（含操作身份）
          } catch (e) {
            // 该条**留在队列**（下个 tick 重发），不影响后续条目
            failed++
            failPre('send', (e && e.message) || e)
          }
        }
      } finally {
        // ③ 确认：只有「全程未取消、且真发出过条目」才去删；删除是锁内的读-改-写
        if (!cancelled() && acked.size > 0) {
          const saved = ackLockedPre(acked)
          if (!saved.ok) persistError = saved.reason || 'outbox-persist-failed'
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
      // ★#342（用户裁定 (a)）：**先落盘成功、再清内存** —— 与 commitPre 的「写盘成功才提交内存」
      //   同一纪律。旧实现在这里先 queue.length = 0 / seen.clear()：一旦无锁擦除被拒（或写盘失败），
      //   内存队列已被清空而磁盘上的事件还在 ⇒ 本进程后续同键入队会被当成「新增」，
      //   dup 短路与合并裁决都拿不到正确的 in-memory 版本，未提交数据实质被丢弃。
      const saved = wipeLockedPre()
      if (!saved.ok) return saved
      queue.length = 0
      seen.clear()
      return saved
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
