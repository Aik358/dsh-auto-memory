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
 * ══════════════════════════════════════════════════════════════════════════
 */

/** 阶段常量（顺序即执行顺序；测试与前端据此渲染进度）。 */
export const TEAM_UPGRADE_PHASES_PRE = Object.freeze([
  'idle', 'pausing', 'pulling', 'upgrading', 'verifying', 'done',
])

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
 * @param {() => Promise<{ok:boolean, error?:string}>} opts.pauseSync  暂停同步（应落盘）
 * @param {() => Promise<{ok:boolean, total?:number, error?:string}>} opts.pullAll  拉远端全量
 * @param {(item:object) => Promise<{ok:boolean, error?:string}>} [opts.upgradeLocal] 逐条升级
 * @param {() => Promise<{ok:boolean, remaining?:number, error?:string}>} [opts.verify] 校验
 * @param {(m:string)=>void} [opts.diag]  诊断回调
 * @param {(phase:string)=>void} [opts.onPhase] 阶段推进回调（调用方在此持久化）
 * @returns {{run: Function, phase: Function}}
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
   * @returns {Promise<{ok:boolean, phase:string, upgraded:number, remaining:number, error?:string}>}
   */
  async function run() {
    if (inflight) return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: 'inflight' }
    inflight = true
    try {
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
      if (!phaseReachedPre(phase, 'upgrading')) {
        setPhase('pulling')
        if (typeof o.pullAll !== 'function') {
          lastError = 'pull-unavailable'
          return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
        }
        const pr = await o.pullAll()
        if (!pr || pr.ok !== true) {
          lastError = 'pull-failed: ' + String((pr && pr.error) || 'unknown')
          return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
        }
        remaining = Number(pr.total) || 0
      }

      // ③ 逐条升级
      if (!phaseReachedPre(phase, 'verifying')) {
        setPhase('upgrading')
        if (typeof o.upgradeLocal === 'function') {
          // 调用方负责提供「待升级清单」；本模块不持有数据，只驱动
          const items = Array.isArray(o.pendingItems) ? o.pendingItems : []
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
      }

      // ④ 校验
      if (!phaseReachedPre(phase, 'done')) {
        setPhase('verifying')
        if (typeof o.verify === 'function') {
          const vr = await o.verify()
          if (!vr || vr.ok !== true) {
            lastError = 'verify-failed: ' + String((vr && vr.error) || ('remaining=' + String(vr && vr.remaining)))
            return { ok: false, phase: phase, upgraded: upgraded, remaining: remaining, error: lastError }
          }
          remaining = Number(vr.remaining) || 0
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
