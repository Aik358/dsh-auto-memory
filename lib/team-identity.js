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
const ROLE_MINIMAL = 'member'

/** 任意值 → 去空白字符串;永不抛。 */
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
      seam: { id, role: toText(safeGet(cfg, CONFIG_MEMBER_ROLE)) || ROLE_MINIMAL },
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
export function createTeamIdentity({ ctx, engine, diag } = {}) {
  let cachedId = ''
  let cachedTeamId = ''
  let cachedRole = ''
  let lastError = ''

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
      // 角色由团队服务端下发;未同步到时给最小权限(本机不猜)
      // 角色：登记值优先；团队服务端下发值可覆盖（缓存）；都没有则最小权限（本机不猜）
      const registered = toText(safeGet(account.seam, 'role'))
      const role = cachedId === id && cachedTeamId === teamId && cachedRole ? cachedRole : (registered || ROLE_MINIMAL)
      cachedId = id
      cachedTeamId = teamId
      cachedRole = role
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

  function resetCache() {
    cachedId = ''
    cachedTeamId = ''
    cachedRole = ''
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

  return { currentMember, describe, currentActor, install, status }
}
