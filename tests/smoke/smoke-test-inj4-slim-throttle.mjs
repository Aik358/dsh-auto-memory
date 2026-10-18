/**
 * smoke-test-inj4-slim-throttle —— 精简版节流 + 完整版 10 轮节奏的行为级验收（2026-10-13）。
 *
 * 用户裁定（本轮原话）：
 *   「正常运行时候，每次人说话注入一次；agent 自己运行时候每 10 轮注入一次完整版，其余时候精简版」
 *   +「B. 精简版节流粒度 每 3 轮」+「唤回内容追加在精简版/完整版之后，精简版和唤回是解耦的」。
 *
 * 两条修复（lib/index.js）：
 *   ① DEFAULT_CONFIG.snapshotMinGapRounds 5 → 10，并配套强制覆盖迁移 upgradeSnapshotGapDefaultPre()
 *      （用户原话「这是强制改动，所有更新的用户默认覆盖」）。
 *   ② slimEveryRounds 自 2026-10-06 起是死键（全仓无判据读取）⇒ 精简版每个 step 都发一份。
 *      实测 T61 单轮 35 帧中 30+ 帧为同一份 6.2KB 精简版（约 190KB/轮）。现按 turn 边界真正门控。
 *
 * ★2026-10-18（R113 · 用户报「所有上下文注入都没用了」的归因修复）：**节流语义已改**。
 *   旧实现：节流帧 `return engine.renderReflectionRequest()` ⇒ 无待办反思时返回**空串** ⇒
 *   整个 dsh:auto-memory-pre 面为空、被宿主 .filter(text.length>0) 丢弃 ⇒ 「零注入」。
 *   实测取证：本会话 821 次渲染决策中 808 次走节流分支 ⇒ 模型连续多轮完全看不到记忆系统状态。
 *   现实现：节流帧仍返回 slimText（状态行+检索指引+唤回通知，约 0.7k 字符），但**不计数**
 *   （不调 markSlimEmitPre/countTieredSlim）⇒ 完整版门槛 fullEverySlims 的口径不变。
 *   因此本套件原 T1/T3/T4 的期望值 `-`（=不注入）统一改为 `S`（=给精简版）。
 *   节流仍然真实存在：它的可观测效果从「这一帧什么都不给」变为「这一帧不给完整版、且不计入门槛」。
 *
 * 判据纪律（"能失败"）：真执行 lib/index.js 的门控函数体；节流做对照与负路径验证。
 * 纯 Node、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// 支持 DAM_INDEX_JS 指向变异副本（变异反向验证用）
const SRC = readFileSync(process.env.DAM_INDEX_JS || new URL('../../lib/index.js', import.meta.url), 'utf8')
const S0 = SRC.indexOf('let tieredFullGranted = false')
const END = 'return finalizePre(snap + engine.renderReflectionRequest())'
if (S0 < 0 || SRC.lastIndexOf(END) < 0) {
  console.error('RED  - 门控函数体切片落空（签名变更后必须同步本套件）')
  process.exit(1)
}
let body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)

// ★2026-10-18（交付层根治配套）：决策段现依赖 finalizePre（生产侧同源抽取）。
//   旧夹具只注入决策段 ⇒ new Function 抛 ReferenceError ⇒ 整套假红。
const FIN_SRC = (function (SRC) {
  const A = "const finalizePre = (txt) => {"
  const i0 = SRC.indexOf(A)
  if (i0 < 0) throw new Error("finalizePre not found in source")
  let depth = 0
  for (let i = i0; i < SRC.length; i++) {
    const c = SRC[i]
    if (c === "{") depth++
    else if (c === "}") { depth--; if (depth === 0) return SRC.slice(i0, i + 1) + ";" }
  }
  throw new Error("finalizePre body unbalanced")
})(SRC)
// 切片起点在 slimGap 声明之后 ⇒ 切片内缺该局部量，必须补回。
// 缺了它节流会恒放行（本套件第一版就因此把"未生效"误判成"生效"，实测 34/34 全放行）。
if (!/const slimGap =/.test(body)) {
  body = 'const slimGap = parseGapRoundsPre(engine.config.slimEveryRounds, 3)' + String.fromCharCode(10) + '          ' + body
}

let pass = 0
let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const NL = String.fromCharCode(10), LB = '[', RB = ']'
const mkSnap = (n) => ['<memory_system>', LB + '最近 1 天工作日志(尾部)' + RB, LB + '2026-10-05' + RB + ' 日志' + n, LB + '白板 PLAN.md' + RB, '</memory_system>'].join(NL)
const evTurn = (seq, turn) => ({ seq, type: 'turn/start', data: { turn } })
const evUser = (seq, kind) => ({ seq, type: 'user/message', data: { source: { kind } } })
const turnOf = (ev) => (ev.data && ev.data.turn !== undefined) ? Number(ev.data.turn) : NaN
const kindOf = (ev) => (ev.data && ev.data.source) ? String(ev.data.source.kind || '') : ''

function mk(over) {
  const st = { _slimStep: 0, _lastSlimCounted: 0, _slimCount: 0, _humanFullKey: undefined, _snapFp: undefined, _snapLogFp: 0, _snapRound: 0,
    _snapLastRound: 0, _snapPendingSnap: null, _snapPendingLogFp: null, _snapCv: 0 }
  st._snapLogFp = ''
  const engine = {
    stateFor: () => st,
    runtimeFor: () => ({ contextVersion: 0 }),
    turnBoundaryKeyPre: (a) => { const e = a.session.events; for (let k = e.length - 1; k >= 0; k--) { const t = turnOf(e[k]); if (Number.isFinite(t)) return 'turn:' + t } return '' },
    humanTurnObservedPre: (a) => { const e = a.session.events; let cur = NaN
      for (let k = e.length - 1; k >= 0; k--) { const t = turnOf(e[k]); if (Number.isFinite(t)) { cur = t; break } }
      for (let k = e.length - 1; k >= 0; k--) { const x = e[k]; const t = turnOf(x); if (Number.isFinite(t) && Number.isFinite(cur) && t !== cur) break
        if (x.type !== 'user/message') continue; const kd = kindOf(x); if (!kd || kd === 'user') return true }
      return false },
    humanTurnSeqPre: (a) => { const e = a.session.events; let cur = NaN
      for (let k = e.length - 1; k >= 0; k--) { const t = turnOf(e[k]); if (Number.isFinite(t)) { cur = t; break } }
      for (let k = e.length - 1; k >= 0; k--) { const x = e[k]; const t = turnOf(x); if (Number.isFinite(t) && Number.isFinite(cur) && t !== cur) break
        if (x.type !== 'user/message') continue; const kd = kindOf(x); if (!kd || kd === 'user') return x.seq }
      return null },
    renderReflectionRequest: () => '',

    // ★2026-10-18（与生产同源）：请求键在两帧之间恒定、每请求翻新。
    //   生产用「最近一次 step/end 的 seq」；本夹具每次 run 追加一条 step/start，
    //   因此用其条数作稳定键即可（同一请求内不追加 ⇒ 键不变；新请求 ⇒ +1）。
    requestIdPre: (a) => {
      const evs = (a && a.session && Array.isArray(a.session.events)) ? a.session.events : []
      let n = 0
      for (let k = 0; k < evs.length; k++) {
        const e = evs[k]
        if (!e) continue
        if (e.type === "step/end") n = Math.max(n, Number(e.seq) || 0)
        else if (e.type === "step/start") n = Math.max(n, Number(e.seq) || 0)
      }
      return "k:" + n
    },
    config: Object.assign({ snapshotMinGapRounds: 10, snapshotTieredInject: true, fullEverySlims: 10, slimEveryRounds: 3, snapshotReinjectOnCompact: true }, over || {}),
  }
  const F = new Function('engine', 'agent', 'gap', 'snap', 'slimText', 'diag', 'createHash', 'parseGapRoundsPre', FIN_SRC + String.fromCharCode(10) + body + ';')
  const agent = { session: { events: [] } }
  const run = (evs, snap) => {
    agent.session.events = evs
    const o = F(engine, agent, Number(engine.config.snapshotMinGapRounds), snap, '<memory_system>SLIM</memory_system>', () => {}, createHash,
      (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 })
    return o.includes('SLIM') ? 'S' : (o.includes('白板 PLAN.md') ? 'F' : (o === '' ? '-' : '?'))
  }
  return { st, run }
}

function renderTurn(E, turnNo, renders, opts) {
  const o = opts || {}
  // ★2026-10-18（step 口径）：计数单位 = **模型请求**（step）。
  //   stepPerFrame=true（默认）时每帧推进一个 step —— 这才对应真实宿主：
  //   每一帧 context 渲染都发生在**新的模型请求**之前，所以帧数 == 模型请求数。
  //   旧夹具假设「同 turn 内多帧共享一个 turn 计数」，在 step 口径下不再成立。
  const stepPerFrame = o.stepPerFrame !== false
  const e = [evTurn(1000 + turnNo, turnNo)]
  if (o.human) e.push(evUser(2000 + turnNo, "user"))
  const r = []
  let stepNo = 0
  for (let k = 0; k < renders; k++) {
    if (stepPerFrame) stepNo += 1
    e.push({ seq: 3000 + turnNo * 1000 + k, type: "step/start", data: { turn: turnNo, step: stepNo || 1 } })
    r.push(E.run(e.slice(), mkSnap("t" + turnNo + "k" + k)))
  }
  return r
}

console.log('=== T1 人说话 => 该轮注入一次完整版（用户裁定第①条）===')
{
  const E = mk()
  eq(renderTurn(E, 1, 3, { human: true }).join(''), 'FSS', 'T1：真人轮首帧完整版；次帧精简版（节流首放）；第 3 帧被节流 ⇒ 仍给精简版但**不计门槛**（R113 语义：节流≠零注入）')
}
console.log('')
console.log('=== T2 agent 自跑 => 每 10 个模型请求一次完整版（用户裁定第②条 + step 口径）===')
{
  const E = mk()
  // renderTurn 每帧推进 1 个 step ⇒ 12 turn × 2 帧 = 24 个模型请求。
  // 完整版应落在第 1、11、21 个模型请求上。
  const out = []
  for (let t = 1; t <= 12; t++) out.push(...renderTurn(E, t, 2))
  const fulls = out.map((c, i) => (c === 'F' ? i + 1 : 0)).filter(Boolean)
  eq(fulls.join(','), '1,11,21', 'T2：24 个模型请求里完整版落在第 1、11、21 个（间隔恰 10 个请求）')
}

console.log('=== T3 精简版节奏：每 3 个模型请求一次（窗内仍给内容，只是不计门槛）===')
{
  const E = mk()
  // 每帧 = 1 个模型请求；slimEveryRounds=3 ⇒ 距上次精简 ≥3 个请求才「正式放行」。
  const t1 = renderTurn(E, 1, 4)
  eq(t1.join(''), 'FSSS', 'T3-a：请求1 完整版；请求2–4 精简版（首个精简在请求2 放行，其余窗内）')
  const t2 = renderTurn(E, 2, 4)
  eq(t2.join(''), 'SSSS', 'T3-b：请求5–8 全精简（距上次完整版仍 <10）')
  // 请求 11 会触发第 2 次完整版（距请求 1 满 10 个）
}

console.log('=== T4 单 turn 35 个模型请求：完整版按 10 的间隔出现（step 口径）===')
{
  const E = mk()
  // ★2026-10-18（step 口径重写）：一帧 = 一次模型请求。35 帧 = 35 个模型请求，
  //   按「每 10 个请求一次完整版」⇒ 完整版应出现在请求 1、11、21、31，共 4 份。
  //   旧断言「单轮 35 帧只准 1 份完整版」建立在「计数单位是 turn」的旧口径上，已作废。
  const r = renderTurn(E, 1, 35)
  const nFull = r.filter((c) => c === 'F').length
  const fullIdx = r.map((c, i) => (c === 'F' ? i + 1 : 0)).filter(Boolean)
  ok(nFull === 4, 'T4-a：35 个模型请求内完整版恰 4 份（实测 ' + nFull + ' 份）')
  ok(fullIdx.join(',') === '1,11,21,31', 'T4-b：完整版落在第 1/11/21/31 个模型请求（实测 ' + fullIdx.join(',') + '）')
  // 精简版：其余 31 帧，其中「正式放行」的那些计入 _slimCount（仅供诊断，不再参与门控）
  ok(E.st._slimCount >= 1, 'T4-c：精简版确实计入诊断计数（实测 ' + E.st._slimCount + '）')
}

console.log('=== T5 负路径：节流关闭时退回旧行为（证明本节流真的在拦）===')
{
  const E = mk({ slimEveryRounds: 0 })
  const r = renderTurn(E, 1, 35)
  const n = r.filter((c) => c === 'S').length
  ok(n >= 30, 'T5：slimEveryRounds=0 ⇒ 节流关闭、每帧都发（实测 ' + n + ' 份）—— 与 T4 构成对照')
}
console.log('')
console.log('=== T6 负路径：缺 turn 键时 fail-open（宁可多发，不得静默停注入）===')
{
  const E = mk()
  const a = E.run([], mkSnap('z1'))
  const b = E.run([], mkSnap('z2'))
  ok(a === 'F' || a === 'S', 'T6-a：无 turn 键时不抛错（got=' + a + '）')
  ok(b === 'S' || b === 'F', 'T6-b：后续帧仍继续注入（fail-open，got=' + b + '）')
}
console.log('')
console.log('=== T7 守卫：修复标记必须在位（防回退）===')
{
  ok(/const slimGap = parseGapRoundsPre\(engine\.config\.slimEveryRounds/.test(SRC), 'T7-a：slimGap 从配置读取（节流判据入口在位）')
  ok(/slimThrottleOkPre|markSlimEmitPre/.test(SRC), 'T7-b：节流原语在位')
  ok(/snapshotMinGapRounds: DEFAULT_SNAPSHOT_MIN_GAP_ROUNDS,/.test(SRC), 'T7-c：默认值引用常量（非硬编码 5）')
  ok(/upgradeSnapshotGapDefaultPre\(rawCfg\) \{/.test(SRC), 'T7-d：强制覆盖迁移方法在位')
  ok(/this\.upgradeSnapshotGapDefaultPre\(parsed\)/.test(SRC), 'T7-e：迁移已接进配置加载链（否则恒不执行）')
}
console.log('')
console.log('[inj4-slim-throttle] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
