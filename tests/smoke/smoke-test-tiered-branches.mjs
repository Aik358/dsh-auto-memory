import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")
const S0 = SRC.indexOf("let tieredFullGranted = false")
const END = "return snap + engine.renderReflectionRequest()"
const body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)
const NL = String.fromCharCode(10), LB = String.fromCharCode(91), RB = String.fromCharCode(93)
const mkSnap = (n) => ["<memory_system>", LB + "最近 1 天工作日志(尾部)" + RB, LB + "2026-10-05" + RB + " 日志" + n, LB + "白板 PLAN.md" + RB, "</memory_system>"].join(NL)
const grab = (name) => {
  const i0 = SRC.indexOf("  " + name + "(agent) {")
  let d = 0, i1 = -1
  for (let i = SRC.indexOf("{", i0); i < SRC.length; i++) { const c = SRC[i]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { i1 = i + 1; break } } }
  return SRC.slice(i0, i1).replace(name + "(agent) {", "function (agent) {")
}
const seo = (s) => s.events
const callTk = new Function("agent","sessionEventsOf","return (" + grab("turnBoundaryKeyPre") + ")(agent)")
const callH  = new Function("agent","sessionEventsOf","return (" + grab("humanTurnObservedPre") + ")(agent)")
const callS  = new Function("agent","sessionEventsOf","return (" + grab("humanTurnSeqPre") + ")(agent)")
const evT = (seq, turn) => ({ seq, type: "turn/start", data: { turn } })
const evU = (seq, kind) => ({ seq, type: "user/message", data: { source: { kind } } })
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log("  ok - " + m) } else { fail++; console.log("  FAIL - " + m) } }
const mk = (cfg) => {
  const st = { _slimStep:0,_lastSlimCounted:0,_slimCount:0,_humanFullKey:undefined,_snapFp:undefined,_snapLogFp:"",_snapRound:0,_snapLastRound:0,_tk:"" }
  const engine = { stateFor:()=>st, runtimeFor:()=>({contextVersion:0}),
    turnBoundaryKeyPre:(a)=>callTk(a, seo), humanTurnObservedPre:(a)=>callH(a, seo), humanTurnSeqPre:(a)=>callS(a, seo),
    renderReflectionRequest:()=>"",
    config: Object.assign({ snapshotMinGapRounds:5, snapshotTieredInject:true, fullEverySlims:3, slimEveryRounds:3, snapshotReinjectOnCompact:true }, cfg||{}) }
  const F = new Function("engine","agent","gap","snap","slimText","diag","createHash","parseGapRoundsPre", body + ";")
  const agent = { session: { events: [] } }
  return { st, agent, run:(evs, snap, gap)=>{ agent.session.events = evs
    const o = F(engine, agent, gap===undefined?5:gap, snap, "<memory_system>SLIM</memory_system>", ()=>{}, createHash, (v,d)=>{const n=Number(v);return Number.isFinite(n)?n:d}) || ""
    return o.includes("SLIM") ? "精简" : (o.includes("白板 PLAN.md") ? "完整" : "空") } }
}
console.log("=== 分档 1：真人说话那一轮 ⇒ 完整版（本轮修的真缺陷）===")
{
  const E = mk()
  ok(E.run([evT(3158,16), evU(3162,"user")], mkSnap("A")) === "完整", "真人在场 turn 首次 ⇒ 完整")
  ok(E.run([evT(3158,16), evU(3162,"user"), evU(3163,"runtime-context"), evU(3172,"user")], mkSnap("B")) === "完整",
     "★turn 号滞后但真人消息已到 ⇒ 仍完整【修复前为精简】")
}
console.log("")
console.log("=== 分档 2：非真人（cron/接续）⇒ 受节流 ===")
{
  const E = mk()
  ok(E.run([evT(10,10)], mkSnap("A")) === "完整", "首次注入 ⇒ 完整")
  ok(E.run([evT(10,10)], mkSnap("B")) === "精简", "同 turn 后续 step ⇒ 精简")
  ok(E.run([evT(11,11)], mkSnap("C")) === "精简", "新 turn 但间距未到 ⇒ 精简（节流 n/5）")
}
console.log("")
console.log("=== 分档 3：攒够精简 ⇒ 门槛放行完整版 ===")
{
  const E = mk({ snapshotMinGapRounds: 999 })
  E.run([evT(1,1)], mkSnap("0"))
  let hit = -1
  for (let i = 1; i < 12; i++) { if (E.run([evT(i+1,i+1)], mkSnap(String(i))) === "完整") { hit = i; break } }
  ok(hit > 0, "攒够 fullEverySlims=3 次精简 ⇒ 自动放行（第 " + hit + " 次）")
}
console.log("")
console.log("=== 分档 4：间距到 ⇒ 放行完整版 ===")
{
  const E = mk({ fullEverySlims: 999 })
  E.run([evT(1,1)], mkSnap("0"))
  let hit = -1
  for (let i = 1; i < 12; i++) { if (E.run([evT(i+1,i+1)], mkSnap(String(i))) === "完整") { hit = i; break } }
  ok(hit === 5, "间距 gap=5 ⇒ 第 5 次放行（实测第 " + hit + " 次）")
}
console.log("")
console.log("=== 分档 5：【INJ-1 负路径】快照逐字节未变 ⇒ 也不得返回完整版 ===")
{
  // gap 必须显式传 999：本夹具 run() 缺省 gap=5，「间距已满足」会掩盖门槛语义（本轮踩过）。
  const E = mk({ snapshotMinGapRounds: 999, fullEverySlims: 999 })
  E.run([evT(1,1)], mkSnap("A"), 999)
  // 旧行为：此分支返回 38KB 完整版并声称「交宿主去重」，且跳过 countTieredSlim（门槛永不满足）。
  // 宿主去重粒度是「全部 context 面拼接后的整串」，本面单独不变不保证整串不变 ⇒ 该前提不成立。
  ok(E.run([evT(1,1)], mkSnap("A"), 999) === "精简", "★快照未变 ⇒ 精简版（负路径：不得再返回完整版）")
  ok(E.st._slimCount === 1, "★该路径也计数（旧实现跳过 countTieredSlim ⇒ 门槛永不满足；实测 " + E.st._slimCount + "）")
}
console.log("")
console.log("=== 分档 6：gap=0 ⇒ 节流关闭，恒完整版（有意义的用户设置）===")
{
  const E = mk({ snapshotMinGapRounds: 0 })
  ok(E.run([evT(1,1)], mkSnap("A"), 0) === "完整", "gap=0 首次 ⇒ 完整")
  ok(E.run([evT(1,1)], mkSnap("B"), 0) === "完整", "gap=0 且内容已变 ⇒ 仍完整")
}
console.log("")
console.log("=== 分档 7：同一步重复渲染 ⇒ 第二次降级且精简文本稳定 ===")
{
  // ★2026-10-06（INJ-1 · S1/S3 判据更新，同 human-turn-grant T4）：旧判据「两次同类」建立在
  //   「宿主按本面去重」的旧前提上；该前提在唤回面存在时不成立，已在 S1 收口。
  const E = mk()
  const evs = [evT(3169,17), evU(3172,"user")]
  ok(E.run(evs, mkSnap("A")) === "完整", "真人轮首次 ⇒ 完整")
  const b = E.run(evs, mkSnap("A"))
  ok(b === "精简", "★同快照紧随渲染 ⇒ 精简（负路径）")
  ok(E.run(evs, mkSnap("A")) === b, "精简文本逐字节稳定")
}
console.log("")
console.log("=== 分档 8：同一真人轮只强放一次（不刷屏）===")
{
  const E = mk()
  const evs = [evT(3169,17), evU(3172,"user")]
  ok(E.run(evs, mkSnap("A")) === "完整", "真人 turn 首次 ⇒ 完整")
  ok(E.run(evs, mkSnap("B")) === "精简", "同轮后续 step ⇒ 回到节流")
}
console.log("")
console.log("=== 分档 9：【INJ-1 · S2】计数单位 = 精简版实际投递次数（满 needFull 即放行，与 slimEveryRounds 无关）===")
{
  const E = mk({ snapshotMinGapRounds: 999, fullEverySlims: 5, slimEveryRounds: 99 })
  E.run([evT(1,1)], mkSnap("0"), 999)                // 首次注入 ⇒ 完整版
  let hit = -1
  for (let i = 1; i < 40; i++) { if (E.run([evT(i+1,i+1)], mkSnap(String(i)), 999) === "完整") { hit = i; break } }
  ok(hit === 6, "slimEveryRounds=99 仍满 5 次精简即放行（首帧后第 5 次精简的下一跳，第 " + hit + " 次调用）")
  // 全局共享状态：两个会话共享同一 hostStats（产线 _slimCount 存于 sharedStatsFor）
  ok(E.st._slimCount === 0, "放行后计数归零（实测 " + E.st._slimCount + "）")
  ok(E.st._slimStep === 5, "诊断计数器 _slimStep 每次精简投递 +1（实测 " + E.st._slimStep + "，纯诊断、不参与门控）")
}
console.log("")
console.log("=== 分档 10：【INJ-1 · S2】出厂默认值 = 10，且满 10 次精简才放行 ===")
{
  // 夹具参数取自产线 DEFAULT_CONFIG（避免夹具自带 3 与产线漂移：旧夹具默认 fullEverySlims=3，
  // 若写死 10 就只是测夹具自己的字面量，测不到出厂默认）。
  // ★INJ-2（2026-10-06）：`fullEverySlims` 现**引用常量** `DEFAULT_FULL_EVERY_SLIMS`
  //   （与容量键同风格、防双源漂移）⇒ 旧解析只认字面量数字会取到 NaN。
  //   改为「先取标识符、再解析该常量」，判据强度不变：仍测产线真实默认值。
  const DEF_FULL = (() => {
    const seg = SRC.slice(SRC.indexOf("const DEFAULT_CONFIG = {"))
    const m = seg.match(/(?:^|\n)\s*fullEverySlims:\s*([A-Za-z_$][\w$]*|\d+)/)
    if (!m) return NaN
    if (/^\d+$/.test(m[1])) return Number(m[1])
    const c = SRC.match(new RegExp('const ' + m[1] + ' = (\\d+)'))
    return c ? Number(c[1]) : NaN
  })()
  ok(DEF_FULL === 10, "★出厂默认 fullEverySlims = 10（用户拍板值；实测 " + DEF_FULL + "）")
  const E = mk({ snapshotMinGapRounds: 999, fullEverySlims: DEF_FULL })
  ok(E.run([evT(1,1)], mkSnap("0"), 999) === "完整", "首次注入 ⇒ 完整版（计数起点不计入连投）")
  let slims = 0
  for (let i = 1; i < 40; i++) {
    if (E.run([evT(i+1,i+1)], mkSnap(String(i)), 999) === "精简") slims++
    else break
  }
  ok(slims === DEF_FULL, "连续精简 " + DEF_FULL + " 次后放行完整版（实测精简 " + slims + " 次）")
}
console.log("")
console.log("=== 分档 11：【INJ-1 · S3】未获授路径一律计数（1 次调用 = 1 次精简投递）===")
{
  const E = mk({ snapshotMinGapRounds: 999, fullEverySlims: 999 })
  E.run([evT(1,1)], mkSnap("0"), 999)
  const n = 7
  for (let i = 1; i <= n; i++) E.run([evT(i+1,i+1)], mkSnap(String(i)), 999)
  ok(E.st._slimCount === n, "未获授 " + n + " 次精简 ⇒ 计数 = " + n + "（实测 " + E.st._slimCount + "）")
}
console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
