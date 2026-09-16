/**
 * 引擎切换状态机（engine_switch_pre_v1）—— P2 / T2-9 切档隔离与进度条（V2-P2 卡 points 4/5）。
 *
 * 权威依据（评审 §3.5 采纳条目 + V2-P2 卡）：
 *   · **切档 = 强制全量重建 + 进度条**（用户裁定）：每次**实际切换**创建**新 rebuild generation**，
 *     目标重建**不复用旧代一二级缓存**（含 e5→BGE→e5）；完成后恢复日常增量。
 *   · **进度只能有一个真实所有者**：本模块持有唯一进度状态；`semantic-status` 与向导只**投影**它，
 *     不自行维护第二套计数（python-setup 的 status 只读投影，见 index.js semantic-status 接线）。
 *   · **保存后才启动切换**：调用方在配置落盘后调 `beginEngineSwitchPre`，不由下拉框未保存值驱动。
 *   · **进度只能来自实际完成量**：`done` 由 `reportScopeDone` 逐项累加；**manifest 发布前不得显示整体完成**
 *     （`phase` 未到 'ready' 前 `indexReady` 恒 false，即便 done==total 也须等 `publish`）。
 *   · **A 未完成又发起 B**：B 使 A 作废（superseded）；**A 迟到不能发布 B 的 ready**（switchId 校验）。
 *   · **同一 switchId 重试不重复编码**：已完成（ready）的同 id 再次 begin 直接返回现状，不重跑。
 *   · **编码中暂停 / 校验失败 / 发布失败 / 重启恢复**：状态可持久化（IO 注入），重启后 running → interrupted，
 *     `done` 保留（来自实际完成量），下次 begin 或 resume 继续。
 *
 * 状态字段（最小投影，不泄内容）：
 *   {switchId, generation, phase, fromIdentity, toIdentity, total, done, failed, error,
 *    startedAt, updatedAt, finishedAt, supersededBy, published}
 *   phase ∈ idle | running | interrupted | publishing | ready | failed | cancelled
 *
 * 零第三方依赖；IO 全注入（不传则纯内存）；UTF-8 无 BOM。
 */

export const ENGINE_SWITCH_VERSION = 'engine_switch_pre_v1'

/** 终态：到达后不再变化（除 begin 开新代）。 */
const TERMINAL = new Set(['ready', 'failed', 'cancelled'])

function nowOf(opts) { return typeof opts.now === 'function' ? Number(opts.now()) || 0 : Date.now() }

/**
 * @param {object} opts
 * @param {()=>number} [opts.now] 时间注入（测试确定性）
 * @param {{readJson?:(p:any)=>any, writeJson?:(p:any,o:any)=>void}} [opts.io] 持久化 IO（缺省纯内存）
 * @param {string} [opts.persistPath] 状态文件路径（提供且 io 可用时才落盘）
 * @param {(msg:string)=>void} [opts.diag]
 */
export function createEngineSwitchPre(opts = {}) {
  const io = opts.io || null
  const persistPath = opts.persistPath ? String(opts.persistPath) : ''
  const diagFn = typeof opts.diag === 'function' ? opts.diag : () => {}
  const safeDiag = (m) => { try { diagFn(String(m).slice(0, 200)) } catch (_) {} }

  let generation = 0
  let state = {
    switchId: '', generation: 0, phase: 'idle',
    fromIdentity: '', toIdentity: '', total: 0, done: 0, failed: 0,
    error: '', supersededBy: '', published: false,
    startedAt: 0, updatedAt: 0, finishedAt: 0,
  }
  // 同代内"已处理单元"集合：同 switchId 重试/恢复时跳过（不重复编码）
  let doneUnits = new Set()

  function snapshot() {
    return {
      ...state,
      doneUnits: doneUnits.size,
      indexReady: state.phase === 'ready' && state.published === true,
      version: ENGINE_SWITCH_VERSION,
    }
  }

  function persist() {
    if (!persistPath || !io || typeof io.writeJson !== 'function') return
    try {
      io.writeJson(persistPath, {
        version: ENGINE_SWITCH_VERSION,
        generation, state: { ...state },
        doneUnits: [...doneUnits],
      })
    } catch (e) { safeDiag('engine-switch persist fail: ' + ((e && e.message) || e)) }
  }

  /** 启动恢复：running → interrupted（进度保留 = 实际完成量）；ready 保持。 */
  function restore() {
    if (!persistPath || !io || typeof io.readJson !== 'function') return
    let raw = null
    try { raw = io.readJson(persistPath) } catch (_) { return }
    if (!raw || typeof raw !== 'object') return
    try {
      const st = raw.state && typeof raw.state === 'object' ? raw.state : null
      if (!st) return
      generation = Number(raw.generation) || 0
      state = {
        switchId: String(st.switchId || ''), generation: Number(st.generation) || generation,
        phase: String(st.phase || 'idle'),
        fromIdentity: String(st.fromIdentity || ''), toIdentity: String(st.toIdentity || ''),
        total: Number(st.total) || 0, done: Number(st.done) || 0, failed: Number(st.failed) || 0,
        error: String(st.error || ''), supersededBy: String(st.supersededBy || ''),
        published: st.published === true,
        startedAt: Number(st.startedAt) || 0, updatedAt: Number(st.updatedAt) || 0, finishedAt: Number(st.finishedAt) || 0,
      }
      if (Array.isArray(raw.doneUnits)) doneUnits = new Set(raw.doneUnits.map(String))
      // ★T2-9c 重启恢复：**未完成的 running 一律降级为 interrupted**（进程已换代），
      // 进度保持"实际完成量"，不假装完成；indexReady 仍为 false（published 未置位）。
      if (state.phase === 'running' || state.phase === 'publishing') {
        state.phase = 'interrupted'
        state.error = state.error || 'interrupted-by-restart'
        state.updatedAt = nowOf(opts)
        persist()
      }
    } catch (e) { safeDiag('engine-switch restore fail: ' + ((e && e.message) || e)) }
  }
  restore()

  /**
   * 开始一次**实际**引擎切换（保存配置之后调用）。
   * @returns {{ok:boolean, switchId:string, generation:number, reason?:string, resumed?:boolean}}
   *  - 同一 switchId 且已 ready → 直接返回现状（**不重复编码**，T2-9b 幂等）。
   *  - 同一 switchId 且 running/interrupted → 恢复续跑（done 保留）。
   *  - 新 switchId → generation+1，作废旧的在飞切换（supersededBy），清空进度重新计。
   */
  function beginEngineSwitchPre(input = {}) {
    const switchId = String(input.switchId || '').trim()
    const toIdentity = String(input.toIdentity || '').trim()
    const fromIdentity = String(input.fromIdentity || state.toIdentity || '').trim()
    const total = Number(input.total) > 0 ? Math.floor(Number(input.total)) : 0
    if (!switchId) return { ok: false, switchId: '', generation, reason: 'no-switch-id' }
    if (!/^engid_pre_[0-9a-f]{32}$/.test(toIdentity)) return { ok: false, switchId, generation, reason: 'bad-identity' }
    // 幂等：同 id 已完成 → 不重跑
    if (state.switchId === switchId && state.phase === 'ready' && state.toIdentity === toIdentity) {
      return { ok: true, switchId, generation: state.generation, reason: 'already-ready' }
    }
    // 续跑：同 id 未完成 → 保留 done/doneUnits
    if (state.switchId === switchId && (state.phase === 'running' || state.phase === 'interrupted')) {
      state.phase = 'running'
      if (total > 0) state.total = total
      state.updatedAt = nowOf(opts)
      persist()
      return { ok: true, switchId, generation: state.generation, resumed: true }
    }
    // 新切换：作废旧代（A 迟到不得发布 B 的 ready）
    const prevSwitchId = state.switchId
    if (prevSwitchId && !TERMINAL.has(state.phase)) state.supersededBy = switchId
    generation = (Number(state.generation) || generation) + 1
    doneUnits = new Set()
    const t = nowOf(opts)
    state = {
      switchId, generation, phase: 'running',
      fromIdentity, toIdentity, total, done: 0, failed: 0,
      error: '', supersededBy: '', published: false,
      startedAt: t, updatedAt: t, finishedAt: 0,
    }
    persist()
    return { ok: true, switchId, generation, fresh: true, superseded: prevSwitchId || '' }
  }

  /**
   * 报告一批实际完成的单元（由索引侧在**真实完成编码/同步**后调用）。
   * 幂等：同一 unitKey 重复上报不重复计数（同一 switchId 重试不重复编码）。
   */
  function reportDone(switchId, unitKeys, opts2 = {}) {
    if (state.switchId !== switchId) return { ok: false, reason: 'stale-switch' } // A 迟到不算数
    if (state.phase !== 'running' && state.phase !== 'publishing') return { ok: false, reason: 'not-running' }
    const keys = (Array.isArray(unitKeys) ? unitKeys : [unitKeys]).map(String).filter(Boolean)
    let added = 0
    for (const k of keys) { if (!doneUnits.has(k)) { doneUnits.add(k); added++ } }
    state.done = doneUnits.size
    if (Number(opts2.total) > 0) state.total = Math.floor(Number(opts2.total))
    state.updatedAt = nowOf(opts)
    persist()
    return { ok: true, done: state.done, added }
  }

  /** 记录失败单元数（不影响 done；T2-9d：失败要让词法仍可用 + 原因可见）。 */
  function reportFailed(switchId, n = 1, reason = '') {
    if (state.switchId !== switchId) return { ok: false, reason: 'stale-switch' }
    state.failed += Math.max(0, Math.floor(Number(n) || 0))
    if (reason) state.error = String(reason).slice(0, 160)
    state.updatedAt = nowOf(opts)
    persist()
    return { ok: true, failed: state.failed }
  }

  /**
   * 发布 manifest → 进入 ready（**整体完成只能在这里之后显示**）。
   * A 迟到发布：如果当前 state.switchId 不是它，直接拒绝（T2-9b）。
   */
  function publishReady(switchId) {
    if (state.switchId !== switchId) return { ok: false, reason: 'stale-switch' }
    if (state.phase !== 'running' && state.phase !== 'publishing' && state.phase !== 'interrupted') {
      return { ok: false, reason: 'bad-phase' }
    }
    state.phase = 'ready'
    state.published = true
    state.updatedAt = nowOf(opts)
    state.finishedAt = state.updatedAt
    persist()
    return { ok: true, indexReady: true }
  }

  /** 校验失败 / 发布失败：进入 failed，原因可见（词法侧不受影响）。 */
  function failSwitch(switchId, reason = '') {
    if (state.switchId !== switchId) return { ok: false, reason: 'stale-switch' }
    state.phase = 'failed'
    state.error = String(reason || 'failed').slice(0, 160)
    state.published = false
    state.updatedAt = nowOf(opts)
    state.finishedAt = state.updatedAt
    persist()
    return { ok: true }
  }

  /** 用户取消（或切档前放弃）：进入 cancelled；进度保留在读数里可审计。 */
  function cancelEngineSwitchPre(switchId) {
    const id = String(switchId || state.switchId || '')
    if (!id || state.switchId !== id) return { ok: false, reason: 'stale-switch' }
    if (TERMINAL.has(state.phase) && state.phase !== 'ready') return { ok: false, reason: 'bad-phase' }
    state.phase = 'cancelled'
    state.published = false
    state.updatedAt = nowOf(opts)
    state.finishedAt = state.updatedAt
    persist()
    return { ok: true }
  }

  /** 计划总量（调用方在拿到冻结快照后设定；只影响进度分母）。 */
  function setTotal(switchId, total) {
    if (state.switchId !== switchId) return { ok: false, reason: 'stale-switch' }
    state.total = Math.max(0, Math.floor(Number(total) || 0))
    if (state.total && state.done > state.total) state.done = doneUnits.size = Math.min(doneUnits.size, state.total)
    state.updatedAt = nowOf(opts)
    persist()
    return { ok: true }
  }

  function getEngineSwitchStatusPre() { return snapshot() }

  /** 当前代是否要求"强制全量重建"（running/interrupted 时 true；ready/cancelled/idle 时 false）。 */
  function requiresFullRebuild() { return state.phase === 'running' || state.phase === 'interrupted' }

  return {
    version: ENGINE_SWITCH_VERSION,
    beginEngineSwitchPre,
    cancelEngineSwitchPre,
    getEngineSwitchStatusPre,
    reportDone,
    reportFailed,
    publishReady,
    failSwitch,
    setTotal,
    requiresFullRebuild,
    _stateForTest: () => state,
    _doneUnitsForTest: () => doneUnits,
  }
}
