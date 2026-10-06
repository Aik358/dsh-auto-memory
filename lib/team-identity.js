/**
 * 团队身份(team-identity)—— 把**宿主提供的登录态**映射成团队成员(actor)。
 *
 * 设计铁律:
 *  ① **不自建账号体系** —— 登录由宿主账号 seam 提供,插件不存账号、不存凭据;
 *  ② 插件只做三件事:**映射成员 / 产出 actor / 记录审计**;
 *  ③ 宿主未登录时插件**仍可单人使用** —— 本模块一律返回 null,绝不抛。
 *
 * 契约 createTeamIdentity({ ctx, engine, diag }):
 *  · currentMember() —— 读到身份返回 { id, name, role, teamId, source, at };未登录/读不到返回 **null**
 *  · describe()      —— **恒返回** { ok, memberId, role, source } 四键;任何情况都不抛
 *  · currentActor()  —— 给写入信封打 actor(未登录返回 null)
 *  · install()       —— 订阅宿主登录态变化;失败不影响本机
 *  · status()        —— 诊断快照
 *
 * 稳定 id 判据:**user.id || user.sub || user.email**,**不用显示名**(显示名可改)。
 * 账号 seam 读取顺序:ctx.deepauthAccount(权威名)→ ctx.deepseekAccount(设计文档兼容名);
 * 两者都读不到 = 未登录,不视为错误。
 */
// ★CR-7（2026-09-26 实测）：宿主 DSH 0.1.7-rc.2 **没有** deepauthAccount / deepseekAccount seam，
// 全库 .d.ts 扫 Context 接口 0 命中。`ctx.authorization` 确实存在（@deepseek-ai/dsh-authorization），
// 但它是**凭据流**服务（registerFlow/list/describe/cancel），**不回答「谁登录了」**。
// ⇒ 身份唯一真源改为**配置显式登记**（teamMemberId / teamMemberRole），
//   这符合「不自建账号体系」铁律：登记身份 ≠ 建账号，不存密码、不发凭证。
//   绝不从 authorization 编造 user.id（那是假的：AK 是机器级共享凭据）。
const CONFIG_MEMBER_ID = 'teamMemberId'
const CONFIG_MEMBER_ROLE = 'teamMemberRole'
const SOURCE_CONFIG = 'config'
const SOURCE_AUTHZ_PRESENT = 'authorization-present'
const SOURCE_NONE = 'none'
// ★2026-09-27 G-F2 权限门（用户裁定）：三角色 + **默认 administrator**。
//   用户原话：「你把这个 owner 权限改成 administrator 权限，这样的话，就是默认 admin 权限吧」。
//   ★「1 万个人用户」红线：「它主要还是供给个人使用，公司是顺带的……我怕是怕如果改出这个权限禁用
//     的话，会对个人用户造成影响」⇒ ① 默认角色 = administrator（未登记 = 全权限，个人用户零感知）；
//     ② 权限门只在 teamEnabled === true 时参与判定（canDo 的第一条短路）；
//     ③ 本模块自身不做拦截 —— 只回答「当前角色是什么 + 该角色能不能做」。
const ROLE_ADMINISTRATOR = 'administrator'
const ROLE_EDITOR = 'editor'
const ROLE_VIEWER = 'viewer'
const ROLE_DEFAULT = ROLE_ADMINISTRATOR
// 已知角色白名单。登记未知值时**不静默降权**，而是回落默认（administrator）——
//   与「本机不猜」纪律一致：猜错会锁死客户（误降 viewer），回落默认最安全。
const ROLE_KNOWN = [ROLE_ADMINISTRATOR, ROLE_EDITOR, ROLE_VIEWER]
// 能力名白名单（canDo 的 action）。未知 action ⇒ **拒绝**（fail-closed）。
const ACTIONS_READ = ['read-team']
const ACTIONS_WRITE = ['write-own-memory', 'write-calendar', 'edit-board']
const ACTIONS_ADMIN = ['approve-high-risk', 'edit-team-config', 'resolve-conflict']

/**
 * normalizeRole —— 任意输入 → 已知角色之一；未知/空 ⇒ ROLE_DEFAULT（administrator）。
 * ★纪律：「本机不猜」——但猜错的代价不对称：把客户误降成 viewer 会**锁死他**，
 *   误升成 administrator 只是少了一层保护。故未知值一律**回落默认**，不静默降权。
 * 纯函数、永不抛。
 */
function normalizeRole(value) {
  const s = toText(value).toLowerCase()
  return ROLE_KNOWN.indexOf(s) >= 0 ? s : ROLE_DEFAULT
}

/**
 * capabilityOf —— 角色 → 能力集（纯函数，无副作用）。
 * 矩阵（与 docs/teamwork-impl/38 卷一致）：
 *   administrator ：读 + 写自己 + 改白板 + 审批高风险 + 改团队配置 + 裁决冲突（全部）
 *   editor        ：读 + 写自己 + 改白板
 *   viewer        ：仅读
 */
function capabilityOf(role) {
  const r = normalizeRole(role)
  if (r === ROLE_ADMINISTRATOR) return ACTIONS_READ.concat(ACTIONS_WRITE, ACTIONS_ADMIN)
  if (r === ROLE_EDITOR) return ACTIONS_READ.concat(ACTIONS_WRITE)
  return ACTIONS_READ.slice()
}

function toText(value) {
  if (value === null || value === undefined) return ''
  try { return String(value).trim() } catch (_) { return '' }
}

/** 安全取值:宿主 seam 可能带 getter 或已损坏,读属性一律不得抛。 */
function safeGet(holder, key) {
  try { return holder ? holder[key] : undefined } catch (_) { return undefined }
}

/** 审计回调可缺省;审计自身失败不得影响本职。 */
function safeDiag(diag, message) {
  try { if (typeof diag === 'function') diag(message) } catch (_) {}
}

function safeMessage(error) {
  return toText(error && error.message) || toText(error) || 'unknown-error'
}

/**
 * 找到账号 seam:权威名优先,兼容名兜底,都没有则视为未登录。
 * **读取出错不在此吞掉** —— 交给 currentMember 的统一降级路径记 diag 后返回 null。
 */
/**
 * ★CR-7 修正：宿主**没有**用户身份 seam。
 * 因此这里不再「探测账号 seam」，而是读取**显式登记**的成员身份。
 *
 * 返回值 source 的语义：
 *   'config'                 —— 已登记（唯一可信来源）
 *   'authorization-present'  —— 未登记，但宿主存在 ctx.authorization（**仅作存在性提示**，
 *                              绝不从中编造 user.id：AK 是机器级共享凭据，反推出的「人」是假的）
 *   'none'                   —— 未登记且无 authorization
 */
function readAccountSeam(ctx, engine) {
  // ① 唯一真源：配置显式登记
  let cfg = null
  try { cfg = (engine && engine.config) || null } catch (_) { cfg = null }
  const id = toText(safeGet(cfg, CONFIG_MEMBER_ID))
  if (id) {
    return {
      seam: { id, role: normalizeRole(toText(safeGet(cfg, CONFIG_MEMBER_ROLE))) },
      source: SOURCE_CONFIG,
    }
  }
  // ② 未登记：只报存在性，不编造身份
  const authz = ctx ? safeGet(ctx, 'authorization') : null
  if (authz && typeof authz === 'object') return { seam: null, source: SOURCE_AUTHZ_PRESENT }
  return { seam: null, source: SOURCE_NONE }
}

/** 读 seam.state();seam 缺失 / 返回非对象当"读不到";**抛错不在此吞** —— 由上层统一记 diag 后降级。 */
function readAccountState(seam) {
  if (!seam || typeof seam.state !== 'function') return null
  const state = seam.state()
  return state && typeof state === 'object' ? state : null
}

/**
 * @param {{ctx?:object, engine?:object, diag?:Function}} [deps] 宿主 seam 与依赖注入(全部可缺省)
 * @returns {{currentMember:Function, describe:Function, currentActor:Function, install:Function, status:Function}}
 */
// ★能力矩阵的**单一真源**（导出给前端/文档消费，避免各处再抄一份）。
export const CAPABILITY_MATRIX_PRE = {
  [ROLE_ADMINISTRATOR]: ACTIONS_READ.concat(ACTIONS_WRITE, ACTIONS_ADMIN),
  [ROLE_EDITOR]: ACTIONS_READ.concat(ACTIONS_WRITE),
  [ROLE_VIEWER]: ACTIONS_READ.slice(),
}
export const ROLE_NAMES_PRE = [ROLE_ADMINISTRATOR, ROLE_EDITOR, ROLE_VIEWER]
export const ROLE_DEFAULT_PRE = ROLE_DEFAULT

export function createTeamIdentity({ ctx, engine, diag } = {}) {
  let lastError = ''

  /** 团队总开关（缺省 false）。canDo 的第①条短路依赖它。 */
  function teamEnabledOf() {
    try { return safeGet(safeGet(engine, 'config'), 'teamEnabled') === true } catch (_) { return false }
  }

  function teamIdOf() {
    return toText(safeGet(safeGet(engine, 'config'), 'teamId'))
  }

  /** 统一降级:记错、记审计、返回 null。 */
  function degrade(error) {
    lastError = safeMessage(error)
    safeDiag(diag, 'team-identity: ' + lastError)
    return null
  }

  /** 宿主登录态 → 团队成员映射;任何异常都降级为 null。 */
  function currentMember() {
    try {
      const account = readAccountSeam(ctx, engine)
      if (!account.seam) return null
      // ★CR-7：身份只来自**显式登记**（config.teamMemberId / teamMemberRole）。
      //   宿主 DSH 0.1.7-rc.2 没有用户身份 seam，这里不再解析 state.user。
      const id = toText(safeGet(account.seam, 'id'))
      if (!id) return null
      const name = id
      const teamId = teamIdOf()
      // Local role comes from the current explicit registration, then the approved
      // administrator fallback. There is no authenticated server role cache here.
      //   ⇒ 个人用户与未配置的公司用户全权限（与改动前行为一致）；只有公司**主动登记**
      //     为 editor / viewer 时，权限门才生效。
      const registered = normalizeRole(toText(safeGet(account.seam, 'role')))
      const role = registered // No server role cache exists; observe same-member config changes immediately.
      return { id, name, role, teamId, source: account.source, at: Date.now() }
    } catch (error) {
      return degrade(error)
    }
  }

  /** 给每次写入打 actor;未登录返回 null。 */
  function currentActor(agent) {
    try {
      const member = currentMember()
      if (!member) return null
      let device = ''
      try {
        const deviceIdPre = safeGet(engine, 'deviceIdPre')
        if (typeof deviceIdPre === 'function') device = toText(deviceIdPre.call(engine))
      } catch (_) { device = '' }
      const header = safeGet(safeGet(agent, 'session'), 'header')
      return {
        id: member.id,
        name: member.name,
        role: member.role,
        teamId: member.teamId,
        source: member.source,
        device,
        ws: toText(safeGet(header, 'cwd')),
      }
    } catch (error) {
      safeDiag(diag, 'team-identity actor: ' + safeMessage(error))
      return null
    }
  }

  /** 恒返回四键形状的诊断视图;绝不抛。 */
  function describe() {
    try {
      const member = currentMember()
      if (!member) {
        // ★CR-7：未登记时**如实回报**探测到的来源（authorization-present / none），
        //   便于前端区分「宿主连 authorization 都没有」与「有 authorization 但未登记成员」。
        const probe = readAccountSeam(ctx, engine)
        return { ok: false, memberId: '', role: '', source: probe.source }
      }
      return { ok: true, memberId: member.id, role: member.role, source: member.source }
    } catch (error) {
      safeDiag(diag, 'team-identity describe: ' + safeMessage(error))
      return { ok: false, memberId: '', role: '', source: SOURCE_NONE }
    }
  }

  /**
   * canDo —— ★权限门本体（G-F2）。**绝不抛**，恒返回 { ok, reason?, role?, action? }。
   *
   * ★★个人用户红线（用户裁定，2026-09-27）：
   *   `teamEnabled !== true` ⇒ **短路放行**（ok:true, reason:'team-disabled'），
   *   不读 role、不读配置、不记日志。理由：本插件主要供给**个人使用**（1 万存量用户），
   *   团队是顺带的；若权限门在非团队路径上生效，个人用户会被自己的默认角色卡住。
   *
   * 判定顺序（**先短路，后判定**）：
   *   ① 团队关闭 ⇒ 放行（红线段言）
   *   ② 未登记身份（currentMember() === null）⇒ 放行（个人/未登记 = 全权限）
   *   ③ 未知 action ⇒ **拒绝**（fail-closed；未知动作不该被默认允许）
   *   ④ 按能力集判定
   */
  function canDo(action) {
    try {
      // ① 红线段言：团队关闭 ⇒ 恒放行（不读 role）
      if (teamEnabledOf() !== true) return { ok: true, reason: 'team-disabled' }
      // ② 未登记身份 ⇒ 放行（默认 administrator 语义）
      const member = currentMember()
      if (!member) return { ok: true, reason: 'identity-not-registered' }
      const role = normalizeRole(member.role)
      const act = toText(action)
      // ③ 未知 action ⇒ fail-closed
      const all = ACTIONS_READ.concat(ACTIONS_WRITE, ACTIONS_ADMIN)
      if (all.indexOf(act) < 0) return { ok: false, reason: 'unknown-action', role: role, action: act }
      // ④ 按能力集判定
      const caps = capabilityOf(role)
      if (caps.indexOf(act) >= 0) return { ok: true, role: role, action: act }
      return { ok: false, reason: 'forbidden', role: role, action: act }
    } catch (error) {
      // 权限门自身出错 ⇒ **放行**（fail-open）：本模块铁律是「绝不因身份模块阻断本机功能」
      safeDiag(diag, 'team-identity canDo: ' + safeMessage(error))
      return { ok: true, reason: 'gate-error' }
    }
  }

  /** 只读便利：当前角色 + 能力集（供前端渲染「你能做什么」）。绝不抛。 */
  function capabilities() {
    try {
      const member = currentMember()
      const role = member ? normalizeRole(member.role) : ROLE_DEFAULT
      return { role: role, actions: capabilityOf(role), teamEnabled: teamEnabledOf() === true }
    } catch (_) { return { role: ROLE_DEFAULT, actions: capabilityOf(ROLE_DEFAULT), teamEnabled: false } }
  }

  function resetCache() {
    lastError = ''
  }

  /** 订阅宿主登录态变化;宿主未提供事件通道时返回 false,不影响本机使用。 */
  function install() {
    const on = safeGet(ctx, 'on')
    if (typeof on !== 'function') return false
    let bound = false
    for (const event of ['deepauth/account-changed', 'deepauth/signed-out', 'deepseek-account/signed-out']) {
      try {
        on.call(ctx, event, resetCache)
        bound = true
      } catch (_) { /* 该事件宿主未必提供:逐条容错,不阻断其余订阅 */ }
    }
    return bound
  }

  /** 诊断快照。 */
  function status() {
    try {
      return { member: currentMember(), error: lastError }
    } catch (error) {
      return { member: null, error: safeMessage(error) }
    }
  }

  return { currentMember, describe, currentActor, install, status, canDo, capabilities, capabilitiesMatrix: CAPABILITY_MATRIX_PRE }
}
