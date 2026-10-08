/**
 * smoke-test-la3-continuation-criteria —— 批 A-1 后端接续判据验收（#285 / #286，2026-10-08）。
 *
 * #285：硬信号可 arm，但前端确认卡按普通比例门过滤 ⇒ 已 armed 却无入口。
 *   本道只做**后端**：把硬触发身份（hard / hardReason / hardAt）带进 arm 快照与状态投影，
 *   让协议**透出足够信息**（前端那半属 A-2 车道）。非硬信号路径行为必须逐字节不变。
 *
 * #286：awaitIdle 用**跨会话 30s 全局活动窗**当忙闲判据 ⇒ 静默长工具被误判空闲并 cancel。
 *   本道改为读宿主**按会话**权威状态 `ctx.agents.get(sid).status`（'idle' | 'running'）；
 *   取不到 ⇒ unknown ⇒ **继续等待**（保守侧），绝不当作空闲；保留 5 次×20s 有界封顶。
 *
 * 判据纪律：全部**真构造产线 MemoryEngine → 真调产线方法 → 断言返回值/副作用**；
 *   负路径用 `DAM_AUDIT_ENGINE_SOURCE` 接缝载入**定点变异**的 index.js，断言必红、还原必绿。
 *
 * 纯 Node、零依赖、不联网。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok - ' + name) } else { fail++; console.error('  FAIL - ' + name) } }
const eq = (a, b, name) => { const ja = JSON.stringify(a), jb = JSON.stringify(b); ok(ja === jb, name + (ja === jb ? '' : ' got=' + ja + ' want=' + jb)) }

const tmps = []
const mkroot = (t) => { const d = mkdtempSync(path.join(tmpdir(), 'dam-la3-' + t + '-')); tmps.push(d); return d }
let seq = 0
async function loadEngine(mutations = []) {
  const shim = path.join(ROOT, 'tests', 'lib', 'audit-engine.mjs')
  if (!mutations.length) { delete process.env.DAM_AUDIT_ENGINE_SOURCE; return await import(pathToFileURL(shim).href + '?v=' + (++seq)) }
  let src = readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  for (const [from, to] of mutations) {
    const hits = src.split(from).length - 1
    assert.equal(hits, 1, 'mutation anchor must hit exactly once: ' + JSON.stringify(from.slice(0, 70)) + ' hits=' + hits)
    src = src.replace(from, to)
  }
  const dir = mkroot('mut')
  const f = path.join(dir, 'idx-' + (++seq) + '.mjs')
  writeFileSync(f, src, 'utf8')
  process.env.DAM_AUDIT_ENGINE_SOURCE = f
  const m = await import(pathToFileURL(shim).href + '?v=' + (++seq))
  delete process.env.DAM_AUDIT_ENGINE_SOURCE
  return m
}
function isolate(tag) {
  const root = mkroot(tag), home = path.join(root, 'home')
  mkdirSync(home, { recursive: true })
  const saved = {}
  for (const k of ['HOME', 'USERPROFILE', 'DSH_HOME']) { saved[k] = process.env[k]; process.env[k] = home }
  return { root, home, restore: () => { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } } }
}

/** 造一个可用的引擎 + 一个「源会话」agent（arm 需要可靠会话身份）。 */
function mkEngine (mod, home) {
  const eng = new mod.MemoryEngine()
  eng.config = Object.assign({}, eng.config, {
    autoContinueEnabled: true, autoContinueThreshold: 0.75, autoContinueCooldownMinutes: 1,
    autoContinueConfirmSeconds: 35,
  })
  eng.state.ws = home
  const agent = { session: { id: 'src-1', header: { id: 'src-1', cwd: home } } }
  return { eng, agent }
}
// 形状与产线两处 arm 调用点一致（:5076 / :15586 均传 hardReason: rt2.waterLevelHardTrigger）。
const WL_HARD = { ratio: 0.4954176, hard: true, hardReason: 'compaction', tokens: 495417, window: 1000000, source: 'auto', modelKnown: true }
const WL_SOFT = { ratio: 0.8, hard: false, hardReason: '', tokens: 800000, window: 1000000, source: 'auto', modelKnown: true }
console.log('[A] #285：硬触发身份必须进入 arm 快照与状态投影（协议透出）')
{
  const iso = isolate('285')
  try {
    const mod = await loadEngine()
    const { eng, agent } = mkEngine(mod, iso.home)
    // 真跑：硬信号 arm
    eng.armAutoContinue(agent, WL_HARD)
    const st = eng._autoContState
    ok(!!st.armed, '★ 硬信号真执行 arm（st.armed 已建立）')
    eq(st.armed.hard, true, '★ arm 快照 hard=true（旧实现无此字段）')
    eq(st.armed.hardAt > 0, true, '★ arm 快照带 hardAt 时间戳（供前端对时）')
    ok(typeof st.armed.hardReason === 'string' && st.armed.hardReason.length > 0, '★ arm 快照带 hardReason（既有信号 waterLevelHardTrigger，实=' + JSON.stringify(st.armed.hardReason) + '）')

    // 真跑状态投影（前端实际消费的那份协议）
    const view = eng.autoContinueState('src-1')
    ok(!!view.armed, 'autoContinueState 透出 armed')
    eq(view.armed.hard, true, '★ 状态投影 armed.hard=true')
    ok(view.armed.hardReason && view.armed.hardReason.length > 0, '★ 状态投影 armed.hardReason 非空（实=' + JSON.stringify(view.armed.hardReason) + '）')
    eq(view.armed.hardAt > 0, true, '★ 状态投影 armed.hardAt > 0')
    // 兜底路径：调用方未传 hardReason（旧形态）时退回 state 单值
    const { eng: eb, agent: ab } = mkEngine(mod, iso.home)
    eb.state.waterLevelHardTrigger = 'wall'
    eb.armAutoContinue(ab, { ratio: 0.4, hard: true, tokens: 400000, window: 1000000, source: 'auto', modelKnown: true })
    eq(eb._autoContState.armed.hardReason, 'wall', '★ 调用方未传 hardReason ⇒ 退回 state.waterLevelHardTrigger 兜底（兼容旧调用形态）')

    // 关键：低比例硬信号确实低于普通阈值 —— 这正是前端原判据会隐藏卡片的场景
    ok(view.armed.ratio < view.threshold, '★ 实测低比例硬触发：armed.ratio(' + view.armed.ratio + ') < threshold(' + view.threshold + ') ⇒ 仅凭 ratio 前端必然隐藏（故必须看 hard）')
  } finally { iso.restore() }
}

console.log('[B] #285：非硬信号路径行为**逐字节不变**（hard=false，不带 reason）')
{
  const iso = isolate('285soft')
  try {
    const mod = await loadEngine()
    const { eng, agent } = mkEngine(mod, iso.home)
    eng.armAutoContinue(agent, WL_SOFT)
    const st = eng._autoContState
    ok(!!st.armed, '普通信号（ratio 0.8 ≥ 0.75）照常 arm')
    eq(st.armed.hard, false, '★ 非硬信号 hard=false（前端仍走原比例门）')
    eq(st.armed.hardReason, '', '★ 非硬信号 hardReason 为空串（不污染既有语义）')
    eq(st.armed.hardAt, 0, '★ 非硬信号 hardAt=0')
    const view = eng.autoContinueState('src-1')
    eq(view.armed.hard, false, '投影 hard=false')
    eq(view.armed.hardReason, '', '投影 hardReason=""')
    // 阈值以下且非硬 ⇒ 仍不 arm（原门未放宽）
    const eng2 = mkEngine(mod, iso.home).eng
    const agent2 = mkEngine(mod, iso.home).agent
    eng2.armAutoContinue(agent2, { ratio: 0.5, hard: false, tokens: 500000, window: 1000000, source: 'auto', modelKnown: true })
    ok(!(eng2._autoContState && eng2._autoContState.armed), '★ 非硬 + 低于阈值 ⇒ 仍不 arm（原有守卫未被放宽）')
  } finally { iso.restore() }
}
console.log('[C] #286：忙闲判据必须读源会话权威回合状态（真执行 tick + 真 agents 替身）')
{
  const iso = isolate('286')
  try {
    const mod = await loadEngine()
    /** 造引擎：hostAutoContinue 换替身计数；_agentSvc 按 statusOf 给权威状态。 */
    const setup = (statusOf) => {
      const { eng, agent } = mkEngine(mod, iso.home)
      eng.hostAutoContinueCalls = 0
      eng.hostAutoContinue = async function () { this.hostAutoContinueCalls++ }
      eng._agentSvc = { get: (id) => (id === 'src-1' ? { status: statusOf(id) } : undefined) }
      eng.armAutoContinue(agent, WL_HARD, { awaitIdle: true })
      eng._autoContState.armed.expiresAt = Date.now() - 1 // 已到期
      return eng
    }

    // ① running ⇒ 必须继续等（旧实现在这里会 cancel）
    const running = setup(() => 'running')
    await running.tickAutoContinue()
    eq(running.hostAutoContinueCalls, 0, '★ status=running ⇒ 不执行接续（长工具不再被误判空闲）')
    eq(running._autoContState.armed.deferCount, 1, '★ 推迟计数 +1')
    ok(running._autoContState.armed.expiresAt > Date.now(), '★ 到期时间被顺延 20s（有界重试保留）')

    // ② idle ⇒ 必须执行（不误挡）
    const idle = setup(() => 'idle')
    await idle.tickAutoContinue()
    eq(idle.hostAutoContinueCalls, 1, '★ status=idle ⇒ 立即执行接续（不过度保守）')

    // ③ 状态未知 / 接口不可用 / agent 取不到 ⇒ 保守继续等，绝不当空闲
    for (const [label, svc] of [
      ['_agentSvc 缺失', undefined],
      ['get 非函数', { get: 42 }],
      ['agent 取不到(undefined)', { get: () => undefined }],
      ['status 非已知值', { get: () => ({ status: 'wat' }) }],
      ['status 缺失', { get: () => ({}) }],
    ]) {
      const { eng, agent } = mkEngine(mod, iso.home)
      eng.hostAutoContinueCalls = 0
      eng.hostAutoContinue = async function () { this.hostAutoContinueCalls++ }
      if (svc !== undefined) eng._agentSvc = svc
      eng.armAutoContinue(agent, WL_HARD, { awaitIdle: true })
      eng._autoContState.armed.expiresAt = Date.now() - 1
      await eng.tickAutoContinue()
      eq(eng.hostAutoContinueCalls, 0, '★ ' + label + ' ⇒ 保守继续等（不当作空闲）')
    }

    // ④ 有界性：5 次封顶后仍放行（保留既有兜底）
    const capped = setup(() => 'running')
    for (let i = 0; i < 5; i++) { capped._autoContState.armed.expiresAt = Date.now() - 1; await capped.tickAutoContinue() }
    eq(capped.hostAutoContinueCalls, 0, '前 5 次仍推迟')
    capped._autoContState.armed.expiresAt = Date.now() - 1
    await capped.tickAutoContinue()
    eq(capped.hostAutoContinueCalls, 1, '★ 第 6 次（deferCount 达 5）⇒ 放行，有界性保留（避免长任务里永不接续）')

    // ⑤ 其它会话活动**不再**影响判定（旧实现的第二个病灶）
    const other = setup(() => 'idle')
    other._globalLastActiveAt = Date.now() // 别的会话刚刚活跃
    other._autoContState.armed.deferCount = 0
    other._autoContState.armed.expiresAt = Date.now() - 1
    await other.tickAutoContinue()
    eq(other.hostAutoContinueCalls, 1, '★ 其它会话的活动不再挡住本会话（旧实现此处必推迟）')

    // ⑥ 反向：无其它活动但源回合 running ⇒ 仍等（证明不是靠时间窗）
    const silent = setup(() => 'running')
    silent._globalLastActiveAt = Date.now() - 60000 // 60s 无任何活动
    silent._autoContState.armed.deferCount = 0
    silent._autoContState.armed.expiresAt = Date.now() - 1
    await silent.tickAutoContinue()
    eq(silent.hostAutoContinueCalls, 0, '★ 静默 60s 但源回合 running ⇒ 仍等（旧实现此处必 cancel）')
  } finally { iso.restore() }
}
console.log('[D] 负路径（变异必红 → 还原必绿）')
{
  const iso = isolate('mut')
  try {
    // D1：#285 —— 去掉 arm 快照的 hard 透出 ⇒ 状态投影里 hard 必须消失（协议退回旧形态）
    const m1 = await loadEngine([[
      '        hard: !!wl.hard,',
      '        hard: undefined,',
    ]])
    const e1 = mkEngine(m1, iso.home)
    e1.eng.armAutoContinue(e1.agent, WL_HARD)
    const v1 = e1.eng.autoContinueState('src-1')
    ok(!v1.armed.hard, 'D1 变异（arm 不写 hard）⇒ 投影 hard 为假 ⇒ 前端无从分辨硬触发：缺陷复现')

    // D2：#286 —— 把忙闲判据退回「全局 30s 时间窗」⇒ 静默长工具又被误判空闲
    const m2 = await loadEngine([[
      "        const turnStatus = this._sourceTurnStatusPre(st.armed.sessionId)",
      "        const turnStatus = (Date.now() - (Number(this._globalLastActiveAt) || 0) < 30000) ? 'running' : 'idle'",
    ]])
    const { eng: e2, agent: a2 } = mkEngine(m2, iso.home)
    e2.hostAutoContinueCalls = 0
    e2.hostAutoContinue = async function () { this.hostAutoContinueCalls++ }
    e2._agentSvc = { get: () => ({ status: 'running' }) } // 源回合**真在跑**
    e2._globalLastActiveAt = Date.now() - 60000          // 但静默 60s（长工具）
    e2.armAutoContinue(a2, WL_HARD, { awaitIdle: true })
    e2._autoContState.armed.expiresAt = Date.now() - 1
    await e2.tickAutoContinue()
    eq(e2.hostAutoContinueCalls, 1, 'D2 变异（退回全局时间窗）⇒ 静默长工具被当作空闲并执行接续：缺陷复现')

    // D3：#286 —— 把 unknown 当作空闲 ⇒ 接口不可用时不再等待
    const m3 = await loadEngine([[
      "      return s === 'running' ? 'running' : (s === 'idle' ? 'idle' : 'unknown')",
      "      return s === 'running' ? 'running' : 'idle'",
    ]])
    const { eng: e3, agent: a3 } = mkEngine(m3, iso.home)
    e3.hostAutoContinueCalls = 0
    e3.hostAutoContinue = async function () { this.hostAutoContinueCalls++ }
    // 必须让执行**走到被变异的那一行**：服务在、get 在、agent 在，只是 status 不是已知值。
    //（若整条服务缺失，会命中更早的 `if (!agentSvc ...) return 'unknown'` 早返回，变异就测不到。）
    e3._agentSvc = { get: () => ({ status: 'weird' }) }
    e3.armAutoContinue(a3, WL_HARD, { awaitIdle: true })
    e3._autoContState.armed.expiresAt = Date.now() - 1
    await e3.tickAutoContinue()
    eq(e3.hostAutoContinueCalls, 1, 'D3 变异（unknown 当空闲）⇒ 状态取不到时不再保守等待：缺陷复现')
  } finally { iso.restore() }
}

console.log('[E] 还原必绿：未变异实现在同一批场景下全部正确')
{
  const iso = isolate('restore')
  try {
    const mod = await loadEngine()
    const { eng, agent } = mkEngine(mod, iso.home)
    eng.hostAutoContinueCalls = 0
    eng.hostAutoContinue = async function () { this.hostAutoContinueCalls++ }
    eng._agentSvc = { get: () => ({ status: 'running' }) }
    eng._globalLastActiveAt = Date.now() - 60000
    eng.armAutoContinue(agent, WL_HARD, { awaitIdle: true })
    eng._autoContState.armed.expiresAt = Date.now() - 1
    await eng.tickAutoContinue()
    eq(eng.hostAutoContinueCalls, 0, '★ 还原：静默长工具 + 源回合 running ⇒ 继续等（必绿）')
    const v = eng.autoContinueState('src-1')
    eq(v.armed.hard, true, '★ 还原：投影 hard=true（必绿）')
  } finally { iso.restore() }
}

console.log('')
console.log('L-A3 smoke: ' + pass + ' PASS / ' + fail + ' FAIL')
for (const d of tmps) { try { rmSync(d, { recursive: true, force: true, maxRetries: 5 }) } catch (_) {} }
if (fail > 0) process.exit(1)

