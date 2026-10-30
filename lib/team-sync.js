/**
 * team-sync.js —— 团队版同步的**心跳 / 传输层**（客户端推送模型）。
 *
 * ## 背景
 * 团队版同步 = 「客户端推送 + 客户端拉取」，服务端**不主动推**。本模块只做传输层：
 * 按固定节奏把 B3 出站队列里排队的变更**批量发出**。**下行合并 / 冲突裁决是 B6**，本模块不实现。
 *
 * ## 设计约束（用户裁定 + 冻结书）
 *  1. **团队关闭 ⇒ 零行为**：`start()` 直接返回 —— 不建定时器、不联网、不读盘。
 *     这是 G-A1「teamEnabled=false ⇒ 与基线逐字节一致」的一部分：**不是内部判断，而是根本不启动**。
 *  2. **定时器必须 unref()** —— 心跳绝不能让进程无法退出（宿主退不掉的严重缺陷）。
 *  3. **单飞**：`tick()` 在途时再次调用 ⇒ 直接返回 `{skipped:true}`。
 *     ⚠️ 「检查 → 置位」之间**不得插入 await**（TOCTOU，本仓已踩过两次）。
 *     所有早退路径经**幂等释放函数**统一释放。
 *  4. **退避**：连续失败按 `base * 2^n` 递增，**设硬上限**，成功后**重置**。
 *     退避值可从 `status().nextDelayMs` 观测（可测性要求）。
 *  5. **绝不抛**：`tick()` 内任何异常 ⇒ 记 diag + 计入失败，不向外抛。
 *  6. **stop() 后静止**：停表后不得再有网络/落盘（防「停表后仍在途」的幽灵写入）。
 *
 * ## ★sender 契约（B3 明确补充，必须遵守）
 * `outbox.flush(sender)` 中：**sender「正常返回」即视为已发出、该条会被出队；
 * 若选择不发，必须 `throw`** —— 否则消息被静默丢弃。投递语义 = **at-least-once**。
 */

const DEFAULT_INTERVAL_MS = 5000
const DEFAULT_BASE_DELAY_MS = 5000
const DEFAULT_MAX_DELAY_MS = 30000
/**
 * 上行端点。
 * ★2026-10-21：设计文档（04 卷 §3.1）写的是 `POST /v1/apply`，而代码一直是 `api/team/sync/push` ——
 *   这是**契约漂移**，谁照着文档写服务端都会踩。
 *   处置：**默认值保持不变**（已按旧名实现的服务端继续可用，零破坏），另开一个配置键
 *   `teamPushPath` 让服务端可以用任一名字；新实现建议走 `/v1/apply` 并配 `teamPushPath: 'v1/apply'`。
 */
const PUSH_PATH = 'api/team/sync/push'

export const TEAM_SYNC_DEFAULT_INTERVAL_MS_PRE = DEFAULT_INTERVAL_MS
export const TEAM_SYNC_BASE_DELAY_MS_PRE = DEFAULT_BASE_DELAY_MS
export const TEAM_SYNC_MAX_DELAY_MS_PRE = DEFAULT_MAX_DELAY_MS
export const TEAM_SYNC_PUSH_PATH_PRE = PUSH_PATH

function toText(value) {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try { return String(value) } catch (_) { return '' }
}

function safeGet(target, key) {
  try { return target === null || target === undefined ? undefined : target[key] } catch (_) { return undefined }
}

function safeDiag(diag, message) {
  try { if (typeof diag === 'function') diag(message) } catch (_) { /* diag 自身绝不外泄 */ }
}

function safeMessage(error) {
  if (error === null || error === undefined) return 'unknown'
  if (typeof error === 'string') return error
  try { return toText(safeGet(error, 'message')) || toText(error) } catch (_) { return 'unknown' }
}

function toPositiveInt(value, fallback) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

/** ★v4-U4（2026-10-25 用户裁定逐字）：双端记忆版本不一致 ⇒ **暂停同步**并汇报，
 *  「**直到用户更新到新版本并完成同步，双端才可再次同步**」。
 *
 *  本文件此前是**纯心跳传输层**（只发 outbox，payload 里没有任何版本字段），
 *  版本闸门全仓 0 处 ⇒ 本批新增 M1（上行带版本）/ M2（读对端版本）/ M3（三处闸门）。
 */

/** 记忆格式最低版本：低于它 ⇒ 视作旧版（与 U2 的 MEMORY_V4_MIN_VERSION 同值）。 */
export const TEAM_SYNC_MIN_PLUGIN_VERSION_PRE = '3.3.18'

/** 本插件当前支持的记忆格式标识（上行 payload 用）。 */
export const TEAM_SYNC_MEMORY_FORMAT_PRE = 'v4'

/**
 * 语义化版本比较（**纯函数、零依赖**；全仓原本 0 处，本批新增）。
 *
 * ★为什么不用字符串比较：`'3.3.9' > '3.3.18'` 在字典序下成立（'9' > '1'），但语义上 3.3.9 < 3.3.18。
 * ★预发布标签（`3.3.18-beta.1`）：核心段相等时，**有标签的视为更旧**（semver 惯例）。
 * ★非法输入：**保守判旧**（返回 -1），因为「拿不准」时更该暂停同步而不是继续混格式。
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} a<b ⇒ -1；a===b ⇒ 0；a>b ⇒ 1
 */
export function compareSemverPre(a, b) {
  const parse = (v) => {
    const t = toText(v).trim()
    if (!t) return null
    // 允许前导 v（v3.3.18）
    const body = t.charAt(0) === 'v' || t.charAt(0) === 'V' ? t.slice(1) : t
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(body)
    if (!m) return null
    return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' }
  }
  const pa = parse(a)
  const pb = parse(b)
  // 任一侧非法 ⇒ 保守判旧（-1）
  if (!pa || !pb) return -1
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1
  }
  // 核心段相等：无预发布标签的**更新**（3.3.18 > 3.3.18-beta.1）
  if (!pa.pre && pb.pre) return 1
  if (pa.pre && !pb.pre) return -1
  if (pa.pre === pb.pre) return 0
  return pa.pre < pb.pre ? -1 : 1
}

/**
 * ★v4-U4 M3：Teamwork 版本闸门（**纯函数**，便于单测）。
 *
 * 用户裁定（逐字）：「一定要注意，**如果有一个旧版本的记忆，这个同步功能应该暂停并且向用户汇报**。
 *   **直到用户更新到新版本并完成同步，双端才可再次同步**」
 *
 * @param {string} localVer 本机插件版本
 * @param {string} peerVer  对端插件版本（未知传空）
 * @returns {{ok:boolean, reason:string, older?:string, action?:string}}
 */
export function teamSyncGatePre(localVer, peerVer) {
  // ① 对端版本未知 ⇒ **不阻**（保守放行：不知道就不该误伤正常用户的同步）
  const peerText = toText(peerVer).trim()
  if (!peerText) return { ok: true, reason: 'peer-unknown' }
  // ② 本机版本未知 ⇒ 同样不阻（自己都没版本号时，拦下来只会让功能完全不可用）
  const localText = toText(localVer).trim()
  if (!localText) return { ok: true, reason: 'local-unknown' }
  // ③ 双方都在最低版本之上 ⇒ 放行（即使版本号不同，也都是新格式，可以互通）
  const minV = TEAM_SYNC_MIN_PLUGIN_VERSION_PRE
  const localNew = compareSemverPre(localText, minV) >= 0
  const peerNew = compareSemverPre(peerText, minV) >= 0
  if (localNew && peerNew) {
    const c0 = compareSemverPre(localText, peerText)
    return { ok: true, reason: c0 === 0 ? 'same' : 'both-new' }
  }
  // ④ 有一端低于最低版本 ⇒ 暂停（用户裁定的核心场景）
  const c = compareSemverPre(localText, peerText)
  const older = c === 0 ? (localNew ? 'peer' : 'local') : (c < 0 ? 'local' : 'peer')
  return {
    ok: false,
    reason: 'version-mismatch',
    older,
    localVersion: localText,
    peerVersion: peerText,
    minVersion: minV,
    action: older === 'local' ? 'update-this-machine' : 'update-other-machine',
  }
}

/**
 * ★B2（2026-10-31 · 用户裁定「版本不同就暂停同步，等全部更新完再开」）：**升级决策三态**。
 *
 * 与 `teamSyncGatePre` 的分工：
 *   · `teamSyncGatePre` 是**闸门**（ok / 不 ok），只管「能不能同步」。
 *   · 本函数是**决策**（ok / need-upgrade / unknown），还要回答「谁旧、该谁升级、有哪两条路」。
 *   ★为什么另开一个而不是改 gate：gate 已被 tick/start/status 三处消费，改它的返回形状会打断三处；
 *     且 gate 的 `ok:false` 语义是「停」，而 need-upgrade 还要驱动**弹窗**⇒ 语义不同，不该合并。
 *
 * 三态语义：
 *   ok          —— 双方都 ≥ 最低版本且记忆格式一致 ⇒ 正常同步。
 *   need-upgrade —— 有一端旧 / 格式不一致 ⇒ 暂停 + 弹窗，给出 side 与两条可选动作。
 *   unknown     —— 任一端版本未知 ⇒ **保守放行**（不知道就不误伤）。
 *
 * @param {{localVer?:string, peerVer?:string, localFormat?:string, peerFormat?:string}} input
 * @returns {{state:'ok'|'need-upgrade'|'unknown', reason:string, side?:string, actions?:string[]}}
 */
export function teamUpgradeDecisionPre(input) {
  const o = input || {}
  const localVer = toText(o.localVer).trim()
  const peerVer = toText(o.peerVer).trim()
  const localFormat = toText(o.localFormat).trim()
  const peerFormat = toText(o.peerFormat).trim()
  // ① 对端版本未知 ⇒ unknown（保守放行：不知道就不该误伤正常用户的同步）
  if (!peerVer) return { state: 'unknown', reason: 'peer-version-unknown' }
  // ② 本机版本未知 ⇒ unknown（自己都没版本号时拦下来只会让功能完全不可用）
  if (!localVer) return { state: 'unknown', reason: 'local-version-unknown' }
  // ③ 记忆格式不一致 ⇒ 必须升级（格式不同比版本号不同更硬：数据结构都对不上）
  //   ★格式判断是本函数**独有**的维度（gate 完全不管格式），不属于重复判据。
  const fmtMismatch = !!(localFormat && peerFormat && localFormat !== peerFormat)
  // ④ 版本维度**复用 teamSyncGatePre**，不在这里重写一遍比较逻辑。
  //   ★为什么必须复用：版本比较 + 「谁旧」的判定是本仓已有语义（在 gate 里），
  //     在本函数里再写一份 = 「同一语义多处判据」（用户规约明令禁止，会进入半修状态）。
  //   ★gate 的四种 reason 与本函数三态的映射关系是**唯一**需要新写的部分。
  const g = teamSyncGatePre(localVer, peerVer)
  // 版本未知 ⇒ unknown（不误伤：gate 在这两种情况下返回 ok:true，但语义是「拿不准」）
  if (g.reason === 'peer-unknown' || g.reason === 'local-unknown') {
    return { state: 'unknown', reason: g.reason, localVersion: localVer, peerVersion: peerVer }
  }
  // 双方都够新且格式一致 ⇒ ok
  if (g.ok === true && !fmtMismatch) {
    return { state: 'ok', reason: g.reason, localVersion: localVer, peerVersion: peerVer }
  }
  // 需要升级：side 一律取 gate 的 older —— gate 已按 semver 判完谁旧。
  //   ★格式不一致但两边版本都够新（gate 返回 ok:true、无 older）时怎么办：
  //     判 side='peer'（**把风险留给对端**）。理由：格式不一致意味着「对方那份是别的结构」，
  //     本机不主动去改远端数据，只提示用户「对方需要升级」—— 与用户裁定的
  //     「作为接收端等待对方整理好再拉」是同一个保守方向。
  //   ★不在这里再调一次版本比较函数：那会让本函数在 gate 之外多出一个比较点，
  //     正是 U4-7e 守卫要防的「重复实现」。
  const older = (g.ok === true) ? 'peer' : String(g.older || 'peer')
  return {
    state: 'need-upgrade',
    reason: fmtMismatch ? 'format-mismatch' : 'version-mismatch',
    side: older,
    // 给前端弹窗用的两个动作（用户裁定：主机主动整理 / 接收端等待）
    actions: older === 'peer'
      ? ['host-upgrade-remote', 'wait-remote-upgrade']
      : ['update-this-machine', 'wait-local-upgrade'],
    localVersion: localVer,
    peerVersion: peerVer,
    localFormat: localFormat,
    peerFormat: peerFormat,
    minVersion: TEAM_SYNC_MIN_PLUGIN_VERSION_PRE,
  }
}

export function createTeamSync(options = {}) {
  const engine = options.engine || null
  const identity = options.identity || null
  const outbox = options.outbox || null
  const teamFetch = options.teamFetch || null
  const diag = options.diag
  const nowFn = typeof options.now === 'function' ? options.now : function () { return Date.now() }

  // —— 状态（全部私有；外部只能经 status() 只读观测）——
  let running = false
  let stopped = false
  let generation = 0
  let inFlight = false
  let timer = null
  let consecutiveFailures = 0
  let lastAt = 0
  let lastOk = null
  let lastError = ''
  let ticks = 0
  let sent = 0
  let failed = 0

  function configOf() { return safeGet(engine, 'config') }

  /**
   * 是否允许同步。
   *
   * ★B1（2026-10-31）：暂停判定改为**双源**——内存态 `_teamPaused` **或** 配置 `teamPaused` 任一为真即停。
   *   旧实现只读内存 `_teamPaused`，而全仓**没有任何地方给它赋值** ⇒ 「暂停」这个机制一直是死的。
   *   为什么保留内存源：运行时临时暂停（如迁移进行中）不该每 tick 读盘；
   *   为什么加配置源：用户手动暂停必须**重启不丢**（内存态重启即恢复同步 = 最危险的那种「以为停了」。）
   */
  function pausedNow() {
    return safeGet(engine, '_teamPaused') === true || safeGet(configOf(), 'teamPaused') === true
  }

  function enabled() {
    return safeGet(configOf(), 'teamEnabled') === true && !pausedNow() && safeGet(engine, '_teamDisposed') !== true
  }

  function intervalMs() {
    return toPositiveInt(safeGet(configOf(), 'teamSyncIntervalMs'), DEFAULT_INTERVAL_MS)
  }

  /** ★v4-U4 M2：读对端版本（来自 teamState 响应 / 心跳响应，不新增路由）。 */
  function peerVersionOf() {
    try {
      const v = safeGet(engine, '_teamPeerVersion')
      return toText(v).trim()
    } catch (_) { return '' }
  }

  /** 本机插件版本（`options.pluginVersion` 优先，其次 engine 上的，最后退回最低版本常量）。 */
  function localVersionOf() {
    try {
      const v = toText(options.pluginVersion) || toText(safeGet(engine, 'pluginVersion'))
      return v.trim() || TEAM_SYNC_MIN_PLUGIN_VERSION_PRE
    } catch (_) { return TEAM_SYNC_MIN_PLUGIN_VERSION_PRE }
  }

  /**
   * ★★v4-U4 M3：**闸门判据**（三处共用这一个函数 —— 避免「同一条语义多处判据」）。
   * 用户裁定（逐字）：「**如果有一个旧版本的记忆，这个同步功能应该暂停并且向用户汇报**。
   *   **直到用户更新到新版本并完成同步，双端才可再次同步**」
   */
  function gate() {
    return teamSyncGatePre(localVersionOf(), peerVersionOf())
  }

  /** 退避：连续失败 n 次 ⇒ base * 2^(n-1)，封顶 max。成功 ⇒ 重置为 0（返回 base）。 */
  function nextDelayMs() {
    const base = intervalMs()
    if (consecutiveFailures <= 0) return base
    // ★ 2^n（不是 2^(n-1)）：首次失败就必须**看到**退避增长，否则 n=1 时等于基线、
    //   退避形同虚设（本断言实测抓到过）。上限 2^16 再封顶 MAX_DELAY。
    const factor = Math.pow(2, Math.min(consecutiveFailures, 16))
    const raw = base * factor
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_MAX_DELAY_MS
    return Math.min(raw, DEFAULT_MAX_DELAY_MS)
  }

  /** 幂等释放：无论从哪条早退路径离开 tick，都走这里。 */
  function release() { inFlight = false }

  /**
   * 组装 sender —— 逐条投递。
   * ★「不发」必须 throw，否则该条会被 outbox 当作成功而出队（丢消息）。
   */
  function makeSender() {
    return async function senderPre(entry) {
      // ★顺序：先本地前置条件（身份），再传输能力（teamFetch）。
      //   否则 teamFetch 缺失会掩盖真正的「未登记身份」，排障被指向错误方向。
      // 未登记身份 ⇒ 不发（必须 throw，不能静默出队）
      let member = null
      try {
        if (identity && typeof identity.currentMember === 'function') member = identity.currentMember()
      } catch (error) {
        throw new Error('identity-unavailable: ' + safeMessage(error))
      }
      // ★2026-09-27 修复（阻断性）：原判据 `member.ok !== true` 与本仓契约不符 ——
      //   `currentMember()` 的契约是「读到身份返回 {id,name,role,teamId,source,at}；未登记返回 null」
      //   （team-identity.js 头部注释逐字），**它没有也不该有 ok 字段**；`ok` 是 `describe()` 的字段。
      //   实测（真构造 identity + sync，已登记 administrator）：旧判据恒为 true ⇒ 每条变更都抛
      //   identity-not-registered ⇒ 同步发出请求 0 次（团队同步完全不可用）。
      //   现按 currentMember 的真实契约判定：非 null 即为已登记。
      if (!member) {
        throw new Error('identity-not-registered')
      }
      if (typeof teamFetch !== 'function') throw new Error('team-fetch-unavailable')
      // ★2026-10-21：端点可由 `teamPushPath` 覆盖（未配置 ⇒ 用上面的常量，行为与旧版逐字节相同）。
      const pushPath = (function () {
        try {
          const v = safeGet(configOf(), 'teamPushPath')
          const s = toText(v)
          return s || PUSH_PATH
        } catch (_) { return PUSH_PATH }
      })()
      // ★2026-10-21（线上 12GB 事故）：**必须带一个稳定幂等键**，否则服务端结构上无法去重/覆盖。
      //   实测旧体顶层只有 [kind,key,at,payload,member] —— 没有 eventId / idemKey / op 任何一样，
      //   服务端拿到后没有任何可比的稳定身份 ⇒ 只能 append ⇒ records 只增不减（用户报的「没有替换」）。
      //   键源**不新造状态**：outbox 已按 #280 A1 把 eventId 持久化到磁盘并原样交给 sender；
      //   缺失时退回 `kind|key`（与 outbox 的 dedupeKeyPre 同语义），保证**任何情况下都有键**。
      const eventId = toText(safeGet(entry, 'eventId'))
      const kindText = toText(safeGet(entry, 'kind'))
      const keyText = toText(safeGet(entry, 'key'))
      // ★v4-U4 M1（2026-10-25）：上行 payload **带版本**（原来 payload 里没有任何版本字段 ⇒ 服务端无从判断）
      const payload = {
        kind: kindText,
        key: keyText,
        // 幂等键：服务端凭它 UPSERT（同键视为同一条变更的新版本），而不是无脑追加。
        idemKey: eventId || (kindText + '|' + keyText),
        at: safeGet(entry, 'at'),
        payload: safeGet(entry, 'payload'),
        member: { id: toText(safeGet(member, 'id')), role: toText(safeGet(member, 'role')) },
      }
      // eventId 单独再带一份：老服务端只认这个字段名时也能幂等（两字段同值，不产生歧义）。
      if (eventId) payload.eventId = eventId
      // ★★v4-U4 M1（2026-10-25 用户裁定「双端版本不一致要暂停并汇报」）：
      //   每条上行都带**本机版本 + 记忆格式**，服务端/对端才能判「谁旧」。
      //   ★为什么不新增路由：用户要求路由恒 77 ⇒ 塞进现有 payload（teamState 响应侧读 M2）。
      payload.dataVersion = {
        pluginVersion: toText(options.pluginVersion) || TEAM_SYNC_MIN_PLUGIN_VERSION_PRE,
        memoryFormat: TEAM_SYNC_MEMORY_FORMAT_PRE,
      }
      const res = await teamFetch(pushPath, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: payload,
      })
      if (!res || res.ok !== true) {
        throw new Error('push-failed: ' + (toText(safeGet(res, 'reason')) || 'unknown'))
      }
      return true
    }
  }

  /**
   * 单次同步。**绝不抛**。
   * ★单飞：「检查 → 置位」之间**没有 await**（TOCTOU 纪律）。
   */
  async function tick() {
    if (!enabled() || stopped) return { skipped: true, reason: "team-disabled" }
    // ★★v4-U4 M3 闸门①（2026-10-25 用户裁定）：**版本不一致 ⇒ 直接 skipped，一个请求都不发**。
    //   ★必须在 `inFlight = true` **之前**：闸门拦下时不该占用单飞标志。
    //   ★也必须在任何 await 之前（TOCTOU 纪律：检查→置位之间不 await）。
    const _g = gate()
    if (!_g.ok) {
      lastError = 'version-mismatch: local=' + localVersionOf() + ' peer=' + peerVersionOf()
      return { skipped: true, reason: 'version-mismatch', gate: _g }
    }
    if (inFlight) return { skipped: true, reason: "in-flight" }
    inFlight = true // 紧贴检查、此处无 await
    ticks += 1
    lastAt = nowFn()
    try {
      if (!outbox || typeof outbox.flush !== "function") throw new Error("outbox-unavailable")
      const epoch = safeGet(engine, '_teamEpoch') || 0, runGeneration = generation
      const cancelled = () => stopped || generation !== runGeneration || !enabled() || (safeGet(engine, '_teamEpoch') || 0) !== epoch
      const result = await outbox.flush(makeSender(), { isCancelled: cancelled })
      if (cancelled()) return { skipped: true, reason: 'team-request-invalidated' }
      if (safeGet(result, 'persisted') === false) throw new Error('outbox-persist-failed: ' + (safeGet(result, 'persistError') || 'queue state not committed'))
      const sentN = toPositiveInt(safeGet(result, "sent"), 0)
      const failedN = toPositiveInt(safeGet(result, "failed"), 0)
      sent += sentN
      failed += failedN
      // ★★ 关键判据：`flush` **不抛**只代表队列服务正常，不代表投递成功。
      //   若 failed > 0（条目级失败），**必须计失败并让退避增长** —— 否则
      //   「每条都被对端拒绝」的场景下退避恒被重置，会以固定间隔死打网络。
      if (failedN > 0) {
        consecutiveFailures += 1
        lastOk = null
        lastError = "entries-failed:" + failedN
        safeDiag(diag, "team-sync partial failure: " + failedN + " entries (consecutive=" + consecutiveFailures + ")")
        return { skipped: false, sent: sentN, failed: failedN }
      }
      consecutiveFailures = 0 // 全部成功才重置退避
      lastOk = nowFn()
      lastError = ""
      return { skipped: false, sent: sentN, failed: failedN }
    } catch (error) {
      consecutiveFailures += 1
      lastOk = null
      lastError = safeMessage(error)
      safeDiag(diag, "team-sync tick failed (#" + consecutiveFailures + "): " + lastError)
      return { skipped: false, sent: 0, failed: 1, error: lastError }
    } finally {
      release() // 幂等释放：含 throw 在内的一切路径都经此
    }
  }

  /** 排下一次（退避值取自 nextDelayMs）。仅内部调用。 */
  function scheduleNext() {
    if (!running || stopped) return
    const delay = nextDelayMs()
    try {
      timer = setTimeout(function onTickPre() {
        timer = null
        Promise.resolve()
          .then(function () { return tick() })
          .catch(function (error) { safeDiag(diag, "team-sync loop: " + safeMessage(error)) })
          .then(function () { scheduleNext() })
      }, delay)
      if (timer && typeof timer.unref === "function") timer.unref() // 心跳不得阻止进程退出
    } catch (error) {
      safeDiag(diag, "team-sync schedule: " + safeMessage(error))
      timer = null
    }
  }

  /** 启动心跳。**幂等**；团队关闭 ⇒ 零行为（不建表、零 IO）。 */
  function start() {
    if (!enabled()) return { ok: false, reason: "team-disabled", running: false }
    // ★★v4-U4 M3 闸门②：版本不一致 ⇒ **不建定时器**（零行为，对齐「teamEnabled=false ⇒ 零行为」纪律）。
    //   ★为什么 start 也要拦：若只拦 tick，定时器仍会每 N 秒空转 + 反复记 lastError，
    //     用户看到「一直在转但什么都没同步」，比直接 red 更迷惑。
    {
      const _g0 = gate()
      if (!_g0.ok) return { ok: false, reason: 'version-mismatch', running: false, gate: _g0 }
    }
    if (running && timer) return { ok: true, reason: "already-running", running: true }
    stopped = false
    running = true
    scheduleNext()
    return { ok: true, running: true, intervalMs: intervalMs() }
  }

  /** 停表 + 清理。**幂等**；停后再 start 可恢复。 */
  function stop() {
    running = false
    stopped = true
    generation++
    if (timer) {
      try { clearTimeout(timer) } catch (_) { /* 忽略 */ }
      timer = null
    }
    return { ok: true, running: false, inFlight: inFlight }
  }

  /** 只读快照，**无副作用**。 */
  function status() {
    return {
      running: running,
      inFlight: inFlight,
      ticks: ticks,
      sent: sent,
      failed: failed,
      lastAt: lastAt,
      lastOk: lastOk,
      lastError: lastError,
      consecutiveFailures: consecutiveFailures,
      nextDelayMs: nextDelayMs(),
      intervalMs: intervalMs(),
      // ★★v4-U4 M3 闸门③：前端要能渲染「为什么暂停 / 谁是旧版 / 该更新哪台」
      gate: gate(),
      // ★B1：暂停可观测（前端要能显示「为什么停」，否则用户只看到同步不动）
      paused: pausedNow(),
      pausedReason: toText(safeGet(configOf(), 'teamPausedReason')),
      // ★B2：升级决策三态（前端弹窗据 state/side/actions 渲染「主机整理 / 接收端等待」二选一）
      upgrade: teamUpgradeDecisionPre({
        localVer: localVersionOf(),
        peerVer: peerVersionOf(),
        localFormat: TEAM_SYNC_MEMORY_FORMAT_PRE,
        peerFormat: toText(safeGet(engine, '_teamPeerFormat')).trim(),
      }),
      localVersion: localVersionOf(),
      peerVersion: peerVersionOf(),
    }
  }

  return { start: start, stop: stop, tick: tick, status: status }
}

/**
 * ★B4（2026-10-31 · 用户裁定）：**恢复同步的放行闸门**。
 *
 * 用户原话：「版本不同的话，就暂停同步，等到所有的更新完毕，远端机库也更新完毕之后，
 *   再开始同步，以免出现同步问题」。
 *
 * ⇒ 「再开始同步」这个动作**必须带条件**。否则用户随手点「恢复」，整个升级流程就被绕过。
 *
 * 放行条件（全部满足才 ok）：
 *   ① `upgrade.state === 'ok'`：双方版本都 ≥ 最低版本 且 记忆格式一致。
 *      · `unknown`（对端版本未知）**不放行** —— 恢复是有风险的动作，
 *        在「拿不准」时应当保守（与 gate 在同步路径上的保守放行方向相反，因为动作性质不同：
 *        同步时拿不准就放过以免误伤；**恢复时拿不准就拦住以免脏数据**）。
 *   ② `teamUpgradePhase` 为 `idle` 或 `done`：没有半途而废的迁移。
 *      · `upgrading` / `verifying` ⇒ 迁移还在跑，此时开同步会边迁边同步。
 *      · `pausing` / `pulling` ⇒ 同样在流程中。
 *
 * ★纪律：本函数是**纯判定**，不写任何状态。拒绝路径的「无副作用」由调用方保证
 *   （先判后写：所有拒绝都在 saveConfig 之前 return）。
 *
 * @param {object} engine 引擎实例（只读其配置与团队配件）
 * @returns {{ok:boolean, reason:string, detail?:string}}
 */
/**
 * ★★B3（2026-10-31 · 用户裁定）· 团队线的「基线发布 / 订阅」弹窗口径。
 *
 * 用户原话：
 *   「有一台机器更新到了最新版，然后上传到云端。其他的机器更新到新版后，就能自动把这台机器
 *    的版本作为基准下载下来，就不用每个机器都整理一遍……弹窗按钮应该可以选择两种操作：
 *     ① 在远端（团队端）搜索 —— 搜索远端是否存在新款的白板（同事/管理员是否已上传新版本）；
 *     ② 自己整理并上传 —— 若远端没有有效版本，就把当前记忆基准作为整理后的版本上传，
 *        作为其他人的基准。」
 *
 * ★三条硬边界（同一条用户裁定）：
 *   ① 这个弹窗**仅在团队开启时**出现；个人使用仍走原来的 memory upgrade 弹窗流程（不合并、不改动）。
 *   ② 团队模式下**不另起一套 upgrade**：② 走的仍是同一个 `startUpgradeJobPre(agent)`。
 *   ③ 推荐项由「远端到底有没有可用基线」决定，而不是靠猜。
 *
 * ★为什么做成纯函数：本口径会被**路由**（回给前端决定弹什么）与**驱动器**（决定能否自动走）两处消费。
 *   同一语义两处各写一份判据 = 本仓明令禁止的半修形态 ⇒ 单一判据集中在此。
 *
 * @param {object} input { teamEnabled, peerBaselineOk, phase }
 * @returns {{mode:'personal'|'team', actions:string[], recommended:string, reason:string}}
 */
export function teamUpgradePopupModePre(input) {
  try {
    const i = (input && typeof input === 'object') ? input : {}
    // ① 团队没开 ⇒ 一律走个人流程（用户裁定：弹窗仅在团队开启时出现）
    if (i.teamEnabled !== true) {
      return { mode: 'personal', actions: [], recommended: '', reason: 'team-disabled' }
    }
    // ② 团队开着：给两个按钮，并按「远端有没有可用基线」给出推荐项
    const hasPeer = i.peerBaselineOk === true
    return {
      mode: 'team',
      actions: ['search-remote-baseline', 'self-upgrade-and-upload'],
      recommended: hasPeer ? 'search-remote-baseline' : 'self-upgrade-and-upload',
      reason: hasPeer ? 'peer-baseline-available' : 'no-peer-baseline',
    }
  } catch (e) {
    // 判据异常 ⇒ 退回个人流程（宁可少弹一个团队窗，也不能把升级流程卡死）
    return { mode: 'personal', actions: [], recommended: '', reason: 'decision-threw' }
  }
}

export function teamResumeGatePre(engine) {
  try {
    const e = engine || {}
    const cfg = safeGet(e, 'config') || {}
    // ① 迁移阶段必须已收口
    const phase = toText(safeGet(cfg, 'teamUpgradePhase') || 'idle').trim() || 'idle'
    if (phase !== 'idle' && phase !== 'done') {
      return {
        ok: false,
        reason: 'upgrade-in-progress',
        detail: '迁移阶段为 ' + phase + '，请等升级完成后再恢复同步',
      }
    }
    // ② 版本决策必须 ok
    const sync = safeGet(e, '_teamSync')
    let st = null
    try { st = sync && typeof sync.status === 'function' ? sync.status() : null } catch (_) { st = null }
    const up = st ? st.upgrade : null
    // 拿不到 sync/upgrade 状态 ⇒ 视为未知 ⇒ 保守拒绝（恢复是有风险动作）
    if (!up || typeof up !== 'object') {
      return { ok: false, reason: 'upgrade-state-unavailable', detail: '拿不到版本状态，无法确认双方一致' }
    }
    if (up.state === 'unknown') {
      return { ok: false, reason: 'upgrade-state-unknown', detail: String(up.reason || '对端版本未知') }
    }
    if (up.state !== 'ok') {
      return {
        ok: false,
        reason: 'upgrade-required',
        detail: up.side ? ('需要先升级：' + up.side) : String(up.reason || '版本不一致'),
      }
    }
    return { ok: true, reason: 'ok' }
  } catch (e) {
    return { ok: false, reason: 'gate-threw', detail: String((e && e.message) || e) }
  }
}
