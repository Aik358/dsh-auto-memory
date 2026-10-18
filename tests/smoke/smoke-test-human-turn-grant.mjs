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
    renderReflectionRequest:()=>"", config:{snapshotMinGapRounds:5,snapshotTieredInject:true,slimEveryRounds:3,snapshotReinjectOnCompact:true} }
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
console.log("=== T4 同一 step 内续帧保真：完整版不被次帧精简版覆盖（2026-10-18 用户裁定）===")
{
  // 语义变更理由：宿主在同一 step 内会对 context 面多次调用 text()，但只有**最后一次**结果被投影。
  //   若首次给完整版、次帧降级为精简版，则完整版会被精简版覆盖 ⇒ 用户看到「人说话了但没注入」。
  //   宿主对**全部 context 面拼接后的整串**去重 ⇒ 同 step 返回逐字节相同的完整版不会真的重复投递。
  //   ⇒ 新判据：同 step 内必须保持一致（都给完整版）。
  const E = mk()
  // ★2026-10-18 夹具修正：原 evs 只有 turn/start + user/message、**没有 step/start**
  //   ⇒ 生产代码取不到 step 号 ⇒ stepScopeKey 为空串 ⇒ 「空 scope 不参与保真」守卫会跳过保真
  //   （T4-d 之所以原本就绿，正是因为它自己补了 step/start）。本档测的就是同 step 保真，
  //   夹具必须给出**真实存在的 step**（与 tiered-branches 分档 5、inj5 T7 同口径）。
  const evs = [evTurn(3169,17), evUser(3172,"user"),
               { seq: 3172.5, type: "step/start", data: { turn: 17, step: 1 } }]
  const a = E.run(evs, mkSnap("A"))
  const b = E.run(evs, mkSnap("A"))
  ok(a === "完整", "T4-a 真人在场首次 ⇒ 完整（实得 " + a + "）")
  ok(b === "完整", "T4-b ★同 step 续帧 ⇒ 仍完整（保真：不得被精简版覆盖；实得 " + b + "）")
  ok(E.run(evs, mkSnap("A")) === b, "T4-c 续帧文本逐字节稳定（不抖动）")
  // 跨 step 必须能重新决策，否则完整版会在整个 turn 内无限续命
  const crossStep = [evTurn(3169,17), evUser(3172,"user"), { seq: 3173, type: "step/start", data: { turn: 17, step: 2 } }]
  ok(E.run(crossStep, mkSnap("A")) === "精简", "T4-d ★跨 step ⇒ 重新决策为精简（保真不跨 step 续命）")
}

console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
