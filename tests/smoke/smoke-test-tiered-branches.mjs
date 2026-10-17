import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")
const S0 = SRC.indexOf("let tieredFullGranted = false")
const END = "return snap + engine.renderReflectionRequest()"
const body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)
// 产线 DEFAULT_CONFIG 的**原始文本**切片（不 eval：块内引用模块级常量，eval 会 ReferenceError）
const DEFAULT_CFG_TEXT = (() => {
  const a = SRC.indexOf("const DEFAULT_CONFIG = {")
  if (a < 0) return ""
  let d = 0, b = -1
  for (let k = SRC.indexOf("{", a); k < SRC.length; k++) { const c = SRC[k]; if (c === "{") d++; else if (c === "}") { d--; if (d === 0) { b = k + 1; break } } }
  return SRC.slice(SRC.indexOf("{", a), b)
})()
const cfgHasKey = (k) => new RegExp("(?:^|[{,\\s])" + k + ":\\s*[^,}\\n]+").test(DEFAULT_CFG_TEXT)
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
  const CFG = Object.assign({ snapshotMinGapRounds:5, snapshotTieredInject:true, slimEveryRounds:3, snapshotReinjectOnCompact:true }, cfg||{})
  const GAP_DEF = Number(CFG.snapshotMinGapRounds) >= 0 ? Number(CFG.snapshotMinGapRounds) : 5
  const engine = { stateFor:()=>st, runtimeFor:()=>({contextVersion:0}),
    turnBoundaryKeyPre:(a)=>callTk(a, seo), humanTurnObservedPre:(a)=>callH(a, seo), humanTurnSeqPre:(a)=>callS(a, seo),
    renderReflectionRequest:()=>"",
    config: CFG }
  const F = new Function("engine","agent","gap","snap","slimText","diag","createHash","parseGapRoundsPre", body + ";")
  const agent = { session: { events: [] } }
  return { st, agent, gapDef: GAP_DEF, run:(evs, snap, gap)=>{ agent.session.events = evs
    const o = F(engine, agent, gap===undefined?GAP_DEF:gap, snap, "<memory_system>SLIM</memory_system>", ()=>{}, createHash, (v,d)=>{const n=Number(v);return Number.isFinite(n)?n:d}) || ""
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
console.log("=== 分档 3：距上次完整版 ≥ fullGap 轮 ⇒ 放行完整版（新节奏唯一真源）===")
{
  const E = mk({ snapshotMinGapRounds: 5 })
  E.run([evT(1,1)], mkSnap("0"))
  let hit = -1
  for (let i = 1; i < 15; i++) { if (E.run([evT(i+1,i+1)], mkSnap(String(i))) === "完整") { hit = i; break } }
  ok(hit === 5, "距上次完整版 5 轮 ⇒ 第 5 个新 turn 放行（实测第 " + hit + " 个）")
  ok(E.st._lastFullTurnSeq === 6, "放行时记录 _lastFullTurnSeq = 当前 turnSeq（实测 " + E.st._lastFullTurnSeq + "）")
}
console.log("")
console.log("=== 分档 4：默认 fullGap=10 ⇒ 每 10 轮一次完整版 ===")
{
  const E = mk({ snapshotMinGapRounds: 10 })
  E.run([evT(1,1)], mkSnap("0"))
  let hit = -1
  for (let i = 1; i < 25; i++) { if (E.run([evT(i+1,i+1)], mkSnap(String(i))) === "完整") { hit = i; break } }
  ok(hit === 10, "默认每 10 轮一次完整版（实测第 " + hit + " 个新 turn）")
}
console.log("")
console.log("=== 分档 5：同一 step 内续帧保真 ⇒ 完整版不被次帧精简版覆盖 ===")
{
  const E = mk({ snapshotMinGapRounds: 999 })
  const evs = [evT(1,1)]
  ok(E.run(evs, mkSnap("A")) === "完整", "首次注入 ⇒ 完整")
  // 同一 step（事件不再推进）多次渲染：必须保持完整版（宿主整串去重 ⇒ 不会重复投递）
  ok(E.run(evs, mkSnap("A")) === "完整", "★同 step 续帧 ⇒ 仍完整版（保真）")
  ok(E.run(evs, mkSnap("A")) === "完整", "★同 step 第三帧 ⇒ 仍完整版")
  // 进入新 step 后允许重新决策
  ok(E.run([evT(1,1), { seq: 2, type: "step/start", data: { turn: 1, step: 2 } }], mkSnap("A")) === "精简",
     "★跨 step ⇒ 重新决策为精简版（保真不跨 step 无限续命）")
}
console.log("")
console.log("=== 分档 6：gap=0 ⇒ 节流关闭，恒完整版（有意义的用户设置）===")
{
  const E = mk({ snapshotMinGapRounds: 0 })
  ok(E.run([evT(1,1)], mkSnap("A"), 0) === "完整", "gap=0 首次 ⇒ 完整")
  ok(E.run([evT(1,1)], mkSnap("B"), 0) === "完整", "gap=0 且内容已变 ⇒ 仍完整")
}
console.log("")
console.log("=== 分档 7：同一真人轮只强放一次（不刷屏）===")
{
  const E = mk()
  const evs = [evT(3169,17), evU(3172,"user")]
  ok(E.run(evs, mkSnap("A")) === "完整", "真人 turn 首次 ⇒ 完整")
  ok(E.run([evT(3169,17), evU(3172,"user"), { seq: 3173, type: "step/start", data: { turn: 17, step: 2 } }], mkSnap("B")) === "精简",
     "同轮后续 step ⇒ 回到节流")
}
console.log("")
console.log("=== 分档 8：精简版节奏 = 每 slimEveryRounds 轮一次 ===")
{
  const E = mk({ snapshotMinGapRounds: 999, slimEveryRounds: 3 })
  E.run([evT(1,1)], mkSnap("0"))                    // 首次 ⇒ 完整
  const tags = []
  for (let i = 1; i <= 9; i++) tags.push(E.run([evT(i+1,i+1)], mkSnap(String(i))) === "完整" ? "F" : "S")
  ok(tags[0] === "S", "第 1 轮 ⇒ 精简（首次精简）")
  ok(tags[1] === "S" && tags[2] === "S", "第 2–3 轮：精简版被节流（距上次 < 3 轮）")
  ok(tags[3] === "S", "第 4 轮 ⇒ 精简版放行（距上次 3 轮）")
  ok(tags.join("") === "SSSSSSSSS", "9 轮内全部为精简版（fullGap=999 不放行完整版；实测 " + tags.join("") + "）")
}
console.log("")
console.log("=== 分档 9：fullEverySlims 已从配置与决策段彻底移除 ===")
{
  ok(!cfgHasKey("fullEverySlims"), "★DEFAULT_CONFIG 不再含 fullEverySlims")
  ok(!/fullEverySlims/.test(body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")),
     "★决策段代码（剥注释后）零 fullEverySlims 引用")
  ok(!cfgHasKey("fullEverySlimsDefaultsVersion"), "★DEFAULT_CONFIG 不再含 fullEverySlimsDefaultsVersion")
  ok(SRC.indexOf("upgradeFullEverySlimsDefaultPre") < 0 || !/upgradeFullEverySlimsDefaultPre\s*\(\s*parsed\s*\)/.test(SRC),
     "★迁移方法调用点已移除")
}
console.log("")
console.log("=== 分档 10：真人轮每轮都必得完整版（用户原话：人说话必须投完整版）===")
{
  const E = mk({ snapshotMinGapRounds: 999 })
  let seq = 100
  const rows = []
  for (let t = 1; t <= 4; t++) {
    const evs = [{ seq: seq, type: "turn/start", data: { turn: t } }, { seq: ++seq, type: "user/message", data: { source: { kind: "user" } } }]
    seq++
    rows.push(E.run(evs, mkSnap("T" + t)) === "完整" ? "F" : "S")
  }
  ok(rows.join("") === "FFFF", "连续 4 个真人轮，每轮都拿到完整版（实测 " + rows.join("") + "）")
}
console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
