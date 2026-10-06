import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
// 支持 DAM_INDEX_JS 指向变异副本（变异反向验证：变异必红、还原复绿）
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
const sessionEventsOf = (s) => s.events
const callTk = new Function("agent", "sessionEventsOf", "return (" + grab("turnBoundaryKeyPre") + ")(agent)")
const callH = new Function("agent", "sessionEventsOf", "return (" + grab("humanTurnObservedPre") + ")(agent)")
const callSeq = new Function("agent", "sessionEventsOf", "return (" + grab("humanTurnSeqPre") + ")(agent)")
const evTurn = (seq, turn) => ({ seq, type: "turn/start", data: { turn } })
const evUser = (seq, kind) => ({ seq, type: "user/message", data: { source: { kind } } })
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log("  ok - " + m) } else { fail++; console.log("  FAIL - " + m) } }
const mk = () => {
  const st = { _slimStep:0,_lastSlimCounted:0,_slimCount:0,_humanFullKey:undefined,_snapFp:undefined,_snapLogFp:"",_snapRound:0,_snapLastRound:0,_tk:"" }
  const engine = { stateFor:()=>st, runtimeFor:()=>({contextVersion:0}),
    turnBoundaryKeyPre:(a)=>callTk(a, sessionEventsOf), humanTurnObservedPre:(a)=>callH(a, sessionEventsOf),
    humanTurnSeqPre:(a)=>callSeq(a, sessionEventsOf),
    renderReflectionRequest:()=>"", config:{snapshotMinGapRounds:5,snapshotTieredInject:true,fullEverySlims:3,slimEveryRounds:3,snapshotReinjectOnCompact:true} }
  const F = new Function("engine","agent","gap","snap","slimText","diag","createHash","parseGapRoundsPre", body + ";")
  const agent = { session: { events: [] } }
  return { st, agent, run:(evs, snap)=>{ agent.session.events = evs
    const o = F(engine, agent, 5, snap, "<memory_system>SLIM</memory_system>", ()=>{}, createHash, (v,d)=>{const n=Number(v);return Number.isFinite(n)?n:d}) || ""
    return o.includes("SLIM") ? "精简" : (o.includes("白板 PLAN.md") ? "完整" : "空") } }
}
console.log("=== T1 turn17 真人轮（turn 边界滞后）必须给完整版 ===")
{
  const E = mk()
  const turn16 = [evTurn(3158,16), evUser(3162,"user")]
  ok(E.run(turn16, mkSnap("A")) === "完整", "T1-a turn16 首次（真人）⇒ 完整")
  // 真实形态：新一轮的真人消息已落地（seq=3172），但 turn/start 尚未可见（仍是 turn:16）
  const lag = [evTurn(3158,16), evUser(3162,"user"), evUser(3163,"runtime-context"), evUser(3172,"user"), evUser(3173,"runtime-context")]
  const r2 = E.run(lag, mkSnap("B"))
  ok(r2 === "完整", "T1-b turn 边界滞后但真人消息已到 ⇒ 完整【修复前为精简】")
}
console.log("")
console.log("=== T2 非真人轮仍受节流（不可放宽）===")
{
  const E = mk()
  const cron = [evTurn(3158,16)]
  ok(E.run(cron, mkSnap("A")) === "完整", "T2-a 首次注入 ⇒ 完整")
  ok(E.run(cron, mkSnap("B")) === "精简", "T2-b 非真人且间距未到 ⇒ 精简")
}
console.log("")
console.log("=== T3 同一真人轮只强放一次（不刷屏）===")
{
  const E = mk()
  const evs = [evTurn(3169,17), evUser(3172,"user")]
  ok(E.run(evs, mkSnap("A")) === "完整", "T3-a 真人 turn 首次 ⇒ 完整")
  const r2 = E.run(evs, mkSnap("B"))
  ok(r2 === "精简", "T3-b 同 turn 后续 step ⇒ 回到节流【修复前为完整】")
}
console.log("")
console.log("=== T4 同一 step 内重复渲染：不得再逐字节等价地重投完整版 ===")
{
  // ★2026-10-06（INJ-1 · S1/S3 判据更新）：旧判据「两次调用同类（都完整）」的依据是
  //   「快照逐字节相同 ⇒ 宿主 project() 会去重」；该依据在唤回面存在时不成立
  //   （宿主去重粒度 = 全部 context 面拼接后的整串），第二次仍产完整版正是要修掉的浪费。
  //   新判据：①真人在场首次必得完整版；②紧随其后的同快照渲染必须降级为精简版；③精简文本稳定。
  const E = mk()
  const evs = [evTurn(3169,17), evUser(3172,"user")]
  const a = E.run(evs, mkSnap("A"))
  const b = E.run(evs, mkSnap("A"))
  ok(a === "完整", "T4-a 真人在场首次 ⇒ 完整（实得 " + a + "）")
  ok(b === "精简", "T4-b ★同快照紧随渲染 ⇒ 精简（负路径：不得再重投完整版；实得 " + b + "）")
  ok(E.run(evs, mkSnap("A")) === b, "T4-c 精简文本逐字节稳定（不抖动）")
}
console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
