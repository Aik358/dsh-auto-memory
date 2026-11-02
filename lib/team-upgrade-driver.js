/**
 * team-upgrade-driver.js —— 团队**记忆库版本升级驱动器**（2026-10-31 · B3）。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 【要解决的问题（用户裁定，逐字）】
 *   「版本不同的话，就暂停同步，等到所有的更新完毕，远端机库也更新完毕之后，
 *     再开始同步，以免出现同步问题。可以加一个类似于弹窗的功能。当检测到远端共享
 *     记忆库是旧版时，提示选择：1. 作为主机，主动调用子代理的 memory upgrade 去整理
 *     远端的记忆库；2. 作为接收端，等到远端把记忆库整理好以后，再拉取新的记忆库内容。」
 *
 * 【本模块只做「主机侧」那一条路】（role=host）。
 *   接收端（role=receiver）不需要驱动器 —— 它只要保持暂停、等 host 完成后收到新版即可。
 *
 * 【纪律（与 team-pull.js 同款，结构上更强）】
 *   ① **不 import node:fs / node:path** ⇒ 结构上无法直接写盘
 *   ② **不发起网络** ⇒ 所有 IO 由调用方注入
 *   ③ **绝不抛**：任何异常降级为 {ok:false, phase, error}，调用方据此决定是否汇报
 *   ④ **幂等 + 可中断**：phase 由调用方持久化（本模块只计算与返回），
 *      重入时从传入的 phase 续跑，不从头来
 *   ⑤ **失败即停**：upgradeLocal 抛错 ⇒ 停在 upgrading，**绝不 resume**
 *      （用户要的是「升级好再开」，不是「升级失败也开」）
 *
 * 【phase 语义（线性，只能前进）】
 *   idle → pausing → pulling → upgrading → verifying → done
 *                                  ↘ (出错) 停在当前 phase，error 带原因
 *
 * ★#487（2026-11-02）**能力不可用**是第 7 种**回报态** `unavailable`，它**不在线性链上**：
 *   链上的 phase 表示「机器走到哪了」（会被调用方落盘、重启后续跑），
 *   而 unavailable 表示「这台机器现在根本没有跑这件事的能力」。
 *   两者混同会有实害（见 run() ⓪ 处的注释）⇒ 返回体里同时给出：
 *     · `phase: 'unavailable'`  —— 给人/前端看的诚实结论
 *     · `persistPhase: <机器真实所在 phase>` —— 调用方**应当**落盘的那个值
 *   ★调用方注意：本模块**不写盘**，落盘由调用方决定；请落 `persistPhase` 而不是 unavailable。
 * ══════════════════════════════════════════════════════════════════════════
 */

/** 阶段常量（顺序即执行顺序；测试与前端据此渲染进度）。 */
export const TEAM_UPGRADE_PHASES_PRE = Object.freeze([
  'idle', 'pausing', 'pulling', 'upgrading', 'verifying', 'done',
])

/** 跑完一次升级**必须**具备的能力（缺失即 unavailable，绝不静默跳过）。 */
export const TEAM_UPGRADE_REQUIRED_CAPS_PRE = Object.freeze([
  'pauseSync', 'pullAll', 'upgradeLocal', 'verify', 'pendingItems',
])

/**
 * 能力预检：返回**缺失项**名单（空数组 = 齐备）。
 * ★#487：旧实现把 upgradeLocal / verify 写成 `if (typeof o.x === 'function')`，
 *   缺失即「跳过该步」，最后照样 setPhase('done') —— 与文件头声称的 fail-closed 相反：
 *   **什么都没升级**却回报成功，调用方据此落盘 done，恢复闸门随之放行，用户以为已迁移完毕。
 *   ⇒ 判据前移到 run() ⓪，缺失即停在 unavailable。
 * @param {object} o 驱动器选项
 * @returns {string[]} 缺失的能力名
 */
export function inspectUpgradeCapsPre(o) {
  const opts = (o && typeof o === 'object') ? o : {}
  const missing = []
  for (const k of TEAM_UPGRADE_REQUIRED_CAPS_PRE) {
    if (k === 'pullAll') {
      // ★#487 第一层：拉取可以由**专门只读通道** pullDiscovery 代言（见 ② 的说明）。
      //   两者都没有才算缺能力。
      if (typeof opts.pullAll !== 'function' && typeof opts.pullDiscovery !== 'function') missing.push('pullAll')
      continue
    }
    if (k === 'pendingItems') {
      // 待升级清单是**数据**不是回调：不是数组同样视为能力缺失。
      //   旧写法 `Array.isArray(...) ? ... : []` 把「没给清单」吞成「清单是空的」。
      if (!Array.isArray(opts.pendingItems)) missing.push('pendingItems')
      continue
    }
    if (typeof opts[k] !== 'function') missing.push(k)
  }
  return missing
}

/**
 * 判断某个 phase 是否「已经越过」另一 phase（用于续跑时跳过已完成步骤）。
 * @param {string} cur 当前 phase
 * @param {string} want 想判断的 phase
 * @returns {boolean} cur 已 >= want
 */
export function phaseReachedPre(cur, want) {
  const a = TEAM_UPGRADE_PHASES_PRE.indexOf(String(cur || ''))
  const b = TEAM_UPGRADE_PHASES_PRE.indexOf(String(want || ''))
  if (a < 0 || b < 0) return false
  return a >= b
}

/**
 * 创建升级驱动器。
 *
 * @param {object} opts
 * ★#487：前四项是**必需能力**（旧版把后两项标成可选 ⇒ 缺失即静默跳过到 done）。
 * @param {() => Promise<{ok:boolean, error?:string}>} opts.pauseSync  暂停同步（应落盘）
 * @param {() => Promise<{ok:boolean, total?:number, error?:string}>} [opts.pullAll]  常规拉取通道
 * @param {() => Promise<{ok:boolean, total?:number, error?:string}>} [opts.pullDiscovery]
 *   升级期间的**受控只读**拉取通道（优先于 pullAll；见 run() ② 的说明）
 * @param {(item:object) => Promise<{ok:boolean, error?:string}>} opts.upgradeLocal 逐条升级
 * @param {() => Promise<{ok:boolean, remaining?:number, error?:string}>} opts.verify 校验
 * @param {object[]} opts.pendingItems 待升级清单（**必须是数组**；缺失 = 能力缺失）
 * @param {(m:string)=>void} [opts.diag]  诊断回调
 * @param {(phase:string)=>void} [opts.onPhase] 阶段推进回调（调用方在此持久化）
 * @returns {{run: Function, status: Function}}
 */
export function createTeamUpgradeDriver(opts = {}) {
  const o = opts || {}
  const diag = typeof o.diag === 'function' ? o.diag : function () {}
  const onPhase = typeof o.onPhase === 'function' ? o.onPhase : function () {}
  let phase = String(o.initialPhase || 'idle')
  let upgraded = 0
  let remaining = 0
  let lastError = ''
  let inflight = false

  function setPhase(p) {
    phase = p
    try { onPhase(p) } catch (_) { /* 持久化失败不该打断迁移 */ }
    try { diag('team-upgrade phase → ' + p) } catch (_) {}
  }

  /**
   * 跑完整流程。**幂等 + 可续跑**：已越过的阶段直接跳过。
   *
   * 「没跑成」有**两种**不同含义，返回体里分开表达（★#487）：
   *   · 跑到半路出错 ⇒ `phase` = 停住的那个**链上**阶段（机器状态），可直接落盘续跑；
   *   · 能力缺失     ⇒ `phase` = `'unavailable'`，另给 `persistPhase` = 机器真实所在阶段。
   *     调用方落盘**必须**用 `persistPhase`：unavailable 不是链上的阶段。
   *
   * @returns {Promise<{ok:boolean, phase:string, upgraded:number, remaining:number,
   *                    error?:string, persistPhase?:string, missing?:string[]}>}
   */
  async function run() {
    if (inflight) return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: 'inflight' }
    inflight = true
    try {
      // ⓪ ★#487 能力预检（**必须在第一处副作用之前**）。
      //   旧实现把缺失能力当成「本机不需要做这一步」，一路静默跳过到 done；
      //   换成在 pausing 之后才回报，则一次「缺能力的请求」会把用户的普通同步**暂停掉**
      //   却什么也没做（fail-closed 停在 pulling），用户要手工恢复 —— 比坏结果更坏的副作用。
      //   ⇒ 预检放在 pauseSync 之前，unavailable 分支**零副作用**。
      const missingCaps = inspectUpgradeCapsPre(o)
      if (missingCaps.length) {
        const code = 'missing-' + String(missingCaps[0])
        lastError = code
        return {
          ok: false,
          phase: 'unavailable',
          persistPhase: phase,   // 机器真实所在阶段，调用方**只应落盘这个**
          upgraded: upgraded,
          remaining: remaining,
          error: code,
          missing: missingCaps,
        }
      }

      // ① 暂停同步（**永远先做**：哪怕之前已暂停，重设一次也无害，且能纠正「配置被改回去」）
      if (!phaseReachedPre(phase, 'pulling')) {
        setPhase('pausing')
        if (typeof o.pauseSync === 'function') {
          const r = await o.pauseSync()
          if (!r || r.ok !== true) {
            lastError = 'pause-failed: ' + String((r && r.error) || 'unknown')
            return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
          }
        }
      }

      // ② 拉远端全量
      //   ★#487 第一层（**前置阻断**）：本流程 ① 一定会把 _teamPaused 置真（这是升级的前置条件，
      //   不是可选步骤），而团队下行 pullOnce 的第一道闸门就是 `_teamPaused === true ⇒ team-paused`。
      //   于是「先暂停、再拉取」在产线上**互斥**：旧驱动器跑一次必定停在 pulling、reason=team-paused，
      //   一次都走不过去。修法不是解除暂停（那会绕过用户设的同步暂停，是把安全机制拆了），
      //   而是让「升级过程中这一次**受控只读**」走一条**单独注入**的通道：
      //     · pullDiscovery —— 由装配层提供，只做 discovery（服务端零写入），
      //       且在「升级已暂停」这一前提下**有意**跳过 team-paused 门；
      //     · pullAll       —— 常规通道，保留给未注入 pullDiscovery 的调用方。
      //   ★边界不变：本模块仍不 import fs / 不联网，通道是**注入的回调**，不是内部直连。
      //   ★为什么只影响「这一次读取」：pullDiscovery 只由本驱动器在自己的 pulling 阶段调用，
      //     普通心跳/手动同步仍走 pullOnce 的暂停门 —— 用户的「暂停同步」对别的路径照旧生效。
      if (!phaseReachedPre(phase, 'upgrading')) {
        setPhase('pulling')
        const puller = typeof o.pullDiscovery === 'function' ? o.pullDiscovery : o.pullAll
        const pr = await puller()
        if (!pr || pr.ok !== true) {
          lastError = 'pull-failed: ' + String((pr && pr.error) || 'unknown')
          return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
        }
        remaining = Number(pr.total) || 0
      }

      // ③ 逐条升级（能力已在 ⓪ 预检过：走到这里 upgradeLocal 必定是函数）
      if (!phaseReachedPre(phase, 'verifying')) {
        setPhase('upgrading')
        // 调用方负责提供「待升级清单」；本模块不持有数据，只驱动
        const items = o.pendingItems
        for (let i = 0; i < items.length; i++) {
          const ur = await o.upgradeLocal(items[i])
          if (!ur || ur.ok !== true) {
            lastError = 'upgrade-failed@' + i + ': ' + String((ur && ur.error) || 'unknown')
            // ★关键：失败**绝不 resume**，停在 upgrading
            return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
          }
          upgraded += 1
          remaining = Math.max(0, remaining - 1)
        }
      }

      // ④ 校验（能力已在 ⓪ 预检过：走到这里 verify 必定是函数）
      //   ★#487 第二层：旧实现只在 ok!==true 时拦，把 `ok:true, remaining:5` 当成通过 ⇒
      //     「还有 5 条没迁完」照样 setPhase('done')，恢复闸门随即放行。
      //     现在 remaining>0 **一律不 done**，停在 verifying（与 verify-failed 同一收口语义）。
      if (!phaseReachedPre(phase, 'done')) {
        setPhase('verifying')
        const vr = await o.verify()
        if (!vr || vr.ok !== true) {
          lastError = 'verify-failed: ' + String((vr && vr.error) || ('remaining=' + String(vr && vr.remaining)))
          return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
        }
        const left = Number(vr.remaining) || 0
        remaining = left
        if (left > 0) {
          lastError = 'verify-incomplete: remaining=' + left
          return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
        }
      }

      setPhase('done')
      lastError = ''
      return { ok: true, phase: phase, upgraded: upgraded, remaining: remaining }
    } catch (e) {
      lastError = 'threw: ' + String((e && e.message) || e)
      try { diag(lastError) } catch (_) {}
      return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
    } finally {
      inflight = false
    }
  }

  function status() {
    return { phase: phase, upgraded: upgraded, remaining: remaining, lastError: lastError, inflight: inflight }
  }

  return { run: run, status: status };
}
