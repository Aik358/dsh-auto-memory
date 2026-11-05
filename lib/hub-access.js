/**
 * hub-access.js —— 跨工作区写权限的**纯决策层**（★#520 / 向导 P1）
 *
 * 【它解决什么】#520 实证：写工具的落点由会话头 cwd 决定，而整理子代理恒在中枢启动
 *   ⇒ 用户工作区永远写不进去。用户裁定：**记忆中枢工作区本身是完全权限**，
 *   子代理就该在中枢跑 ⇒ 缺的不是"位置"，而是"中枢会话的显式目标工作区写入通道"。
 *
 * 【判据只有一条，不得出现第二套】
 *   身份：会话 id ∈ 中枢会话集合（hUbSessionIds，当前+上期）
 *   目标：requestedWs 必须 ∈ manifest 白名单（引擎算，不接受草案/调用方自报）
 *   两者同时成立才放行；其余一律明确拒绝，**不得静默改写到别处**。
 *
 * 【为什么是纯函数】CR-10：必须能真 import→真构造→真调用并断言返回值。
 *   本模块零 IO、零副作用；路径解析由调用方注入（resolveWs）。
 */

/** 拒绝码（前端与提示词都按码分支，不要按文案匹配）。 */
export const WRITE_DENY = Object.freeze({
  /** 会话没有绑定工作区，且调用方也没指定目标 —— 无法判定落点。 */
  NO_BOUND: 'workspace-unbound',
  /** 非中枢会话尝试跨区写。 */
  NOT_HUB: 'cross-workspace-write-requires-hub',
  /** 请求的目标不在 manifest 白名单内。 */
  NOT_IN_SCOPE: 'workspace-not-in-manifest',
});

/**
 * 归一化工作区标识：目录名（wsKey）与绝对路径都接受。
 * 规则：去引号/空白、反斜杠→正斜杠、折叠重复分隔符、去尾分隔符、小写（Windows 大小写不敏感）。
 * 仅用于**比较**，不作为落盘路径使用（落盘路径由调用方用原值解析）。
 */
export function normalizeWsKeyPre(p) {
  let s = String(p == null ? '' : p).trim()
  if (!s) return ''
  s = s.replace(/^["']|["']$/g, '')
  s = s.replace(/\\/g, '/').replace(/\/+/g, '/')
  if (s.length > 1) s = s.replace(/\/+$/, '')
  return s.toLowerCase()
}

/** 会话是否属于中枢（当前/上期）。空集合 ⇒ 全否（fail closed，不猜）。 */
export function isHubSessionPre(hubSessionIds, sessionId) {
  const sid = String(sessionId == null ? '' : sessionId).trim()
  if (!sid) return false
  const list = Array.isArray(hubSessionIds) ? hubSessionIds : []
  for (const id of list) {
    if (String(id == null ? '' : id).trim() === sid) return true
  }
  return false
}

/**
 * 判定本次写入的目标工作区。
 *
 * @param {object} input
 * @param {string} input.sessionId      当前会话 id
 * @param {string[]} input.hubSessionIds 中枢会话 id 集合
 * @param {string} input.boundWs        会话绑定工作区（cwd 或目录名）
 * @param {string} [input.requestedWs]  调用方显式指定的目标（cwd 或目录名）
 * @param {string[]} [input.allowedWs]  manifest 白名单（cwd 或目录名）
 * @param {(ws:string)=>string} [input.resolveWs] 目录名→绝对路径的纯注入（可选）
 * @returns {{ok:true,target:string,redirected:boolean}|{ok:false,code:string,detail:object}}
 */
export function decideWriteTargetPre(input) {
  const o = input && typeof input === 'object' ? input : {}
  const resolve = typeof o.resolveWs === 'function' ? o.resolveWs : (x) => x
  const boundRaw = String(o.boundWs == null ? '' : o.boundWs).trim()
  const reqRaw = String(o.requestedWs == null ? '' : o.requestedWs).trim()

  // 未显式请求目标 ⇒ 走会话绑定（与既有行为逐字一致，零变化）。
  if (!reqRaw) {
    if (!boundRaw) return { ok: false, code: WRITE_DENY.NO_BOUND, detail: { sessionId: String(o.sessionId || '') } }
    return { ok: true, target: boundRaw, redirected: false }
  }

  // 显式请求目标 ⇒ 必须过身份门（非中枢一律拒绝，不静默忽略）。
  if (!isHubSessionPre(o.hubSessionIds, o.sessionId)) {
    return {
      ok: false,
      code: WRITE_DENY.NOT_HUB,
      detail: {
        sessionId: String(o.sessionId || ''),
        requested: reqRaw,
        hint: '跨工作区写仅限记忆中枢会话；请在目标工作区里新开会话，或从中枢发起升级流程',
      },
    }
  }

  // 白名单门：requested 的原值与解析值都要比对，任一命中即视为在清单内。
  const allowed = Array.isArray(o.allowedWs) ? o.allowedWs : []
  if (!allowed.length) {
    return { ok: false, code: WRITE_DENY.NOT_IN_SCOPE, detail: { requested: reqRaw, allowed: [], hint: '工作区清单为空，拒绝一切跨区写（fail closed）' } }
  }
  const reqNorm = normalizeWsKeyPre(reqRaw)
  let reqResolved = reqRaw
  try { reqResolved = String(resolve(reqRaw) || reqRaw) } catch (_) { reqResolved = reqRaw }
  const reqResolvedNorm = normalizeWsKeyPre(reqResolved)
  const hit = allowed.some((a) => {
    const an = normalizeWsKeyPre(a)
    if (!an) return false
    return an === reqNorm || an === reqResolvedNorm
  })
  if (!hit) {
    return {
      ok: false,
      code: WRITE_DENY.NOT_IN_SCOPE,
      detail: { requested: reqRaw, allowed: allowed.map((x) => String(x)), hint: '目标工作区不在本次 manifest 清单内' },
    }
  }

  const redirected = normalizeWsKeyPre(reqResolved) !== normalizeWsKeyPre(boundRaw)
  return { ok: true, target: reqResolved, redirected }
}
