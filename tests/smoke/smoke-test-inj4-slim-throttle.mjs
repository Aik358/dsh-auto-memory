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
 * 判据纪律（"能失败"）：真执行 lib/index.js 的门控函数体；节流做对照与负路径验证。
 * 纯 Node、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// 支持 DAM_INDEX_JS 指向变异副本（变异反向验证用）
const SRC = readFileSync(process.env.DAM_INDEX_JS || new URL('../../lib/index.js', import.meta.url), 'utf8')
const S0 = SRC.indexOf('let tieredFullGranted = false')
const END = 'return snap + engine.renderReflectionRequest()'
if (S0 < 0 || SRC.lastIndexOf(END) < 0) {
  console.error('RED  - 门控函数体切片落空（签名变更后必须同步本套件）')
  process.exit(1)
}
let body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)
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
    config: Object.assign({ snapshotMinGapRounds: 10, snapshotTieredInject: true, fullEverySlims: 10, slimEveryRounds: 3, snapshotReinjectOnCompact: true }, over || {}),
  }
  const F = new Function('engine', 'agent', 'gap', 'snap', 'slimText', 'diag', 'createHash', 'parseGapRoundsPre', body + ';')
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
  let e = [evTurn(1000 + turnNo, turnNo)]
  if (o.human) e = e.concat([evUser(2000 + turnNo, 'user')])
  const r = []
  for (let k = 0; k < renders; k++) {
    r.push(E.run(e.slice(), mkSnap('t' + turnNo + 'k' + k)))
    e = e.concat([evUser(5000 + turnNo * 100 + k, 'runtime-context')])
  }
  return r
}

console.log('=== T1 人说话 => 该轮注入一次完整版（用户裁定第①条）===')
{
  const E = mk()
  eq(renderTurn(E, 1, 3, { human: true }).join(''), 'FS-', 'T1：真人轮首帧完整版；次帧精简版（节流首放）；第 3 帧被节流 ⇒ 不注入（旧行为为 FSS 全放行）')
}
console.log('')
console.log('=== T2 agent 自跑 => 每 10 轮一次完整版（用户裁定第②条）===')
{
  const E = mk()
  const out = []
  for (let t = 1; t <= 12; t++) out.push(renderTurn(E, t, 2)[0])
  const fulls = out.map((c, i) => (c === 'F' ? i + 1 : 0)).filter(Boolean)
  eq(fulls.join(','), '1,11', 'T2：12 轮无人轮里完整版落在 turn 1 与 11（间隔恰 10 轮）')
}
console.log('')
console.log('=== T3 精简版每 3 轮至多一次（用户裁定第 B 条）===')
{
  const E = mk()
  const t1 = renderTurn(E, 1, 4)
  const t2 = renderTurn(E, 2, 4)
  const t3 = renderTurn(E, 3, 4)
  const t4 = renderTurn(E, 4, 4)
  eq(t1.join(''), 'FS--', 'T3-a：turn1 首帧完整版，次帧精简版（节流首放）')
  eq(t2.join(''), '----', 'T3-b：turn2 距上次精简投递 1 轮 ⇒ 整轮不注入精简版')
  eq(t3.join(''), '----', 'T3-c：turn3 距上次 2 轮 ⇒ 仍不注入')
  eq(t4.join(''), 'S---', 'T3-d：turn4 距上次 3 轮 ⇒ 恢复一次精简版（粒度=3 轮）')
}
console.log('')
console.log('=== T4 单轮 35 帧不再灌 34 份精简版（量化，T61 形态）===')
{
  const E = mk()
  const r = renderTurn(E, 1, 35)
  const n = r.filter((c) => c === 'S').length
  ok(n <= 1, 'T4：单轮 35 帧精简版 <= 1 份（旧行为实测 34 份 x 6.2KB = 211KB/轮，现 ' + n + ' 份）')
}
console.log('')
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
