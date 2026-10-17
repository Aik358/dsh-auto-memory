/**
 * smoke-test-inj3-same-turn-dedup —— 注入节奏两处修复的**行为级**验收（2026-10-13）。
 *
 * 修复内容（lib/index.js）：
 *   ① 同轮重复授予完整版：原 `turnKey = (isHuman && humanKey) ? humanKey : tk` 在同一 turn 内翻转
 *      （humanSeq 由 null 变为有值）⇒ 两键先后写入 `_humanFullKey` 时互不相等 ⇒ `firstOfTurn` 二次为真。
 *      本机实测：60 轮 / 88 次完整版中 32 次为同轮重复，占完整版字节 36.8%。
 *      修法：叠加「键降级不重复」精判据（区分 turn 边界滞后升级 vs 真的来了新真人消息）。
 *   ② gap 单位错配：`_snapRound` 原按**注入次数**推进，而配置键名 `snapshotMinGapRounds` 是「轮」
 *      ⇒ 同轮内多次日志变化即可满足 gap（实测每轮日志变化 1.6 次）。修法：改为**按 turn 推进**。
 *
 * ★2026-10-18（R116）：T1 期望 FSS → FFS。见该断言上方归因 —— 旧期望固化的是「人说话被吞」缺陷，
 *   本次修复（未授予不得登记授予去重键）让真人消息落地后能正确拿到完整版。
 *   不变量未变：同一 turn 内**真人完整版只授予一次**（由 T1 帧3 与 T5 继续保证）。
 *
 * 判据纪律（"能失败"）：本套件由**真执行** lib/index.js 的注入门控函数体验证行为，
 * 并对两处修复各做**变异反向验证**（变异必红、还原复绿）。禁止以源码含某字符串充当功能验收。
 * 纯 Node、零依赖、不联网、不启宿主。
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// 支持 DAM_INDEX_JS 指向变异副本（变异反向验证用）
const SRC = readFileSync(process.env.DAM_INDEX_JS || new URL('../../lib/index.js', import.meta.url), 'utf8')
const S0 = SRC.indexOf('let tieredFullGranted = false')
const END = 'return snap + engine.renderReflectionRequest()'
if (S0 < 0 || SRC.lastIndexOf(END) < 0) {
  console.error('RED  - 注入门控函数体切片落空（签名变更后必须同步本套件）')
  process.exit(1)
}
const body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)

let pass = 0
let fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ok   - ' + name) } else { fail++; console.error('  RED  - ' + name) } }
const eq = (got, want, name) => ok(got === want, name + ' got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))

const NL = String.fromCharCode(10), LB = '[', RB = ']'
const mkSnap = (n) => ['<memory_system>', LB + '最近 1 天工作日志(尾部)' + RB, LB + '2026-10-05' + RB + ' 日志' + n, LB + '白板 PLAN.md' + RB, '</memory_system>'].join(NL)
const evTurn = (seq, turn) => ({ seq, type: 'turn/start', data: { turn } })
const evUser = (seq, kind) => ({ seq, type: 'user/message', data: { source: { kind } } })

function mk(over) {
  const st = { _slimStep: 0, _lastSlimCounted: 0, _slimCount: 0, _humanFullKey: undefined, _snapFp: undefined, _snapLogFp: '', _snapRound: 0, _snapLastRound: 0, _snapPendingSnap: null, _snapPendingLogFp: null, _snapCv: 0 }
  const turnOf = (ev) => { const t = ev.turn !== undefined ? ev.turn : (ev.data && ev.data.turn !== undefined ? ev.data.turn : undefined); return t === undefined ? NaN : Number(t) }
  const engine = {
    stateFor: () => st,
    runtimeFor: () => ({ contextVersion: 0 }),
    turnBoundaryKeyPre: (a) => { const e = a.session.events; for (let k = e.length - 1; k >= 0; k--) { const t = turnOf(e[k]); if (Number.isFinite(t)) return 'turn:' + t } return '' },
    humanTurnObservedPre: (a) => { const e = a.session.events; let cur = NaN
      for (let k = e.length - 1; k >= 0; k--) { const t = turnOf(e[k]); if (Number.isFinite(t)) { cur = t; break } }
      for (let k = e.length - 1; k >= 0; k--) { const x = e[k]; const t = turnOf(x); if (Number.isFinite(t) && Number.isFinite(cur) && t !== cur) break
        if (x.type !== 'user/message') continue; const kd = x.data && x.data.source ? x.data.source.kind : ''; if (!kd || kd === 'user') return true }
      return false },
    humanTurnSeqPre: (a) => { const e = a.session.events; let cur = NaN
      for (let k = e.length - 1; k >= 0; k--) { const t = turnOf(e[k]); if (Number.isFinite(t)) { cur = t; break } }
      for (let k = e.length - 1; k >= 0; k--) { const x = e[k]; const t = turnOf(x); if (Number.isFinite(t) && Number.isFinite(cur) && t !== cur) break
        if (x.type !== 'user/message') continue; const kd = x.data && x.data.source ? x.data.source.kind : ''; if (!kd || kd === 'user') return x.seq }
      return null },
    renderReflectionRequest: () => '',
    config: Object.assign({ snapshotMinGapRounds: 5, snapshotTieredInject: true, fullEverySlims: 10, slimEveryRounds: 3, snapshotReinjectOnCompact: true }, over),
  }
  const F = new Function('engine', 'agent', 'gap', 'snap', 'slimText', 'diag', 'createHash', 'parseGapRoundsPre', body + ';')
  const agent = { session: { events: [] } }
  const run = (evs, snap) => {
    agent.session.events = evs
    const o = F(engine, agent, 5, snap, '<memory_system>SLIM</memory_system>', () => {}, createHash, (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 })
    return o.includes('SLIM') ? 'S' : (o.includes('白板 PLAN.md') ? 'F' : '-')
  }
  return { st, run }
}

console.log('=== T1 ★同轮重复授予已消除（首帧真人不可见 → 次帧可见）===')
{
  const E = mk()
  const r = []
  r.push(E.run([evTurn(1, 5)], mkSnap('B1')))
  r.push(E.run([evTurn(1, 5), evUser(100, 'user')], mkSnap('B2')))
  r.push(E.run([evTurn(1, 5), evUser(100, 'user'), evUser(101, 'runtime-context')], mkSnap('B3')))
  // ★2026-10-18（R116 · 判据更新）：本场景期望由 FSS 改为 **FFS**，理由是「首帧那两个 F 性质不同」：
  //   · 帧1 的 F = **「完整版（首次注入）」** —— 来自 `_snapFp === undefined` 的独立分支
  //     （index.js 16978），只在会话生命周期**第一次**渲染时触发一次，与 firstOfTurn 无关。
  //   · 帧2 的 F = **「完整版（human:100 · 真人在场）」** —— 真人消息落地后的正确授予。
  //   旧期望 FSS 反映的是**缺陷**：旧代码在首帧「未授予」时也写 `_humanFullKey = turnKey`（原 16934 行），
  //   导致真人消息落地时 `_upgradeFromFallback = (last === tk) = true` ⇒ firstOfTurn=false ⇒ 授予被吞。
  //   症状即用户报的「人说话不给完整版」。修法见 index.js 16940-16950（未授予改记 _tieredSeenTurnKey）。
  //   本套件真正要守的不变量是「**同一轮不得给两次真人完整版**」，由帧3=S 保证 —— 该断言未变。
  //   实测 diag 佐证：帧1=「完整版（首次注入）」/ 帧2=「完整版（human:100 · 真人在场）」/ 帧3=「精简版(节流 0/5)」。
  eq(r.join(''), 'FFS', 'T1：首帧(首次注入)F不占用真人名额 ⇒ 真人消息落地后仍须授予完整版；同轮第三帧回到精简【旧期望 FSS 反映"人说话被吞"缺陷】')
}
console.log('')
console.log('=== T2 真人轮语义不变：still 每轮首次给完整版 ===')
{
  const E = mk()
  const r = []
  const e = [evTurn(1, 5), evUser(100, 'user')]
  r.push(E.run(e.slice(), mkSnap('A1')))
  r.push(E.run(e.concat([evUser(101, 'runtime-context')]), mkSnap('A2')))
  r.push(E.run(e.concat([evUser(102, 'runtime-context')]), mkSnap('A3')))
  eq(r.join(''), 'FSS', 'T2：真人轮首次完整版、后续回到节流')
}
console.log('')
console.log('=== T3 ★turn 边界滞后保护未被破坏（2026-10-05 修复项）===')
{
  const E = mk()
  const r = []
  r.push(E.run([evTurn(1, 16), evUser(100, 'user')], mkSnap('E1')))
  r.push(E.run([evTurn(1, 16), evUser(100, 'user'), evUser(101, 'runtime-context'), evUser(102, 'user'), evUser(103, 'runtime-context')], mkSnap('E2')))
  eq(r.join(''), 'FF', 'T3：turn 号滞后但新的真人消息已到 ⇒ 仍给完整版（不得被 T1 的修复误伤）')
}
console.log('')
console.log('=== T4 ★gap 单位对齐为「轮」（无人轮不再轮内续发）===')
{
  const E = mk()
  const r = []
  let e = [evTurn(1, 5), evUser(100, 'runtime-context')]
  for (let k = 0; k < 8; k++) { r.push(E.run(e.slice(), mkSnap('D' + k))); e = e.concat([evUser(101 + k, 'runtime-context')]) }
  eq(r.join(''), 'FSSSSSSS', 'T4：无人轮 8 次渲染（日志逐变）内不得超过 1 次完整版【修复前 FSSSSFSS】')
}
console.log('')
console.log('=== T5 跨轮恢复：进入新 turn 后 gap 才可满足 ===')
{
  const E = mk()
  const r = []
  let e = [evTurn(1, 5), evUser(100, 'runtime-context')]
  for (let k = 0; k < 5; k++) { r.push(E.run(e.slice(), mkSnap('X' + k))); e = e.concat([evUser(110 + k, 'runtime-context')]) }
  const before = r.join('')
  for (let t = 2; t <= 6; t++) { e = e.concat([evTurn(900 + t, t)]); r.push(E.run(e.slice(), mkSnap('Y' + t))) }
  const after = r.slice(5).join('')
  eq(before, 'FSSSS', 'T5-a：turn1 内只 1 次完整版')
  ok(after.includes('F'), 'T5-b：跨到新 turn 后 gap 可满足 ⇒ 出现完整版（单位是「轮」而非「次」）')
}
console.log('')
console.log('=== T6 守卫：修复标记必须在位（防回退）===')
{
  ok(/const firstOfTurn = !!\(turnKey && [^\n]*_lastFullKey !== turnKey/.test(SRC), 'T6-a：firstOfTurn 经持久键比较（去重键未被绕过）')
  ok(/_upgradeFromFallback|_snapRoundTurnKey/.test(SRC), 'T6-b：两处修复标记至少一处可见（本套件与实现同源）')
}
console.log('')
console.log('[inj3-same-turn-dedup] pass=' + pass + ' fail=' + fail)
process.exit(fail ? 1 : 0)
