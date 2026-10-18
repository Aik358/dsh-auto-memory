import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")
const S0 = SRC.indexOf("let tieredFullGranted = false")
const END = "return finalizePre(snap + engine.renderReflectionRequest())"
const body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)

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
    // ★2026-10-18（与生产同源）：请求键在两帧之间恒定、每请求翻新。
    //   生产用「最近一次 step/end 的 seq」；本夹具以「step/start 的 seq 最大值」作稳定键
    //   （同一请求内不追加新 step/start ⇒ 键不变；新请求 ⇒ +1）。
    //   缺此方法 ⇒ 决策段抛错被 catch 吞 ⇒ 计数器停摆 ⇒ 本套件恒红。
    requestIdPre:(a)=>{ const evs=(a&&a.session&&Array.isArray(a.session.events))?a.session.events:[]
      let n=0; for(let k=0;k<evs.length;k++){const e=evs[k]; if(!e)continue
        if(e.type==="step/end"||e.type==="step/start"){const q=Number(e.seq); if(Number.isFinite(q)&&q>n)n=q}}
      return "k:"+n },
    config: CFG }
  const F = new Function("engine","agent","gap","snap","slimText","diag","createHash","parseGapRoundsPre", FIN_SRC + String.fromCharCode(10) + body + ";")
  const agent = { session: { events: [] } }
  // ★2026-10-18（与生产同源）：每次 run() = 一个新模型请求，必须追加本请求的 step/start
  //   （生产侧 requestIdPre 取「最近一次 step/end 的 seq」，夹具用递增 step/start seq 等价表达）。
  //   否则所有帧共用同一键 ⇒ 幂等闸把不同请求当成同一请求（夹具失真，非产品缺陷）。
  let _rk = 0
  let _lastBoundary = null
  return { st, agent, gapDef: GAP_DEF, run:(evs, snap, gap, sameReq)=>{ 
    // sameReq=true ⇒ 模拟「同一模型请求的后续帧」：不推进 step 边界（键不变 ⇒ 幂等闸复读）。
    // 否则视为新请求：追加递增 step/start 使 requestIdPre 翻新。
    if (!sameReq) {
      _rk += 1
      _lastBoundary = { seq: 700000 + _rk, type: "step/start", data: { turn: 1, step: _rk } }
    }
    agent.session.events = evs.concat(_lastBoundary ? [_lastBoundary] : [])
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
console.log("=== 分档 3：距上次完整版 ≥ fullGap 个模型请求 ⇒ 放行完整版（新节奏唯一真源）===")
{
  // ★2026-10-18（step 口径）：计数单位是**模型请求**（step），不是 turn。
  //   旧写法只改 turn 号 ⇒ 新代码的 _stepSeq 恒不推进 ⇒ 本档恒红（夹具过时，非缺陷）。
  //   现在每轮迭代都追加一条 step/start，推进一个模型请求。
  const E = mk({ snapshotMinGapRounds: 5 })
  const evs = [evT(1,1)]
  E.run(evs.slice(), mkSnap("0"))
  let hit = -1, stepNo = 1
  for (let i = 1; i < 15; i++) {
    stepNo += 1
    evs.push({ seq: 1000 + stepNo, type: "step/start", data: { turn: 1, step: stepNo } })
    if (E.run(evs.slice(), mkSnap(String(i))) === "完整") { hit = i; break }
  }
  ok(hit === 5, "距上次完整版 5 个模型请求 ⇒ 第 5 个请求放行（实测第 " + hit + " 个）")
  // ★2026-10-18（口径更新）：_lastFullStepSeq 现由 requestIdPre 驱动的 _stepSeq 写入，
  //   而夹具每个请求额外追加一条边界事件（初始 1 条 + 5 次追加）⇒ 放行时为 6。
  //   判据意图不变：它必须等于「放行当次的模型请求序号」，不是固定字面量 5。
  ok(E.st._lastFullStepSeq === 6, "放行时记录 _lastFullStepSeq = 放行当次模型请求序号（实测 " + E.st._lastFullStepSeq + "）")
}
console.log("")
console.log("=== 分档 4：默认每 10 个模型请求一次完整版 ===")
{
  const E = mk({ snapshotMinGapRounds: 10 })
  const evs = [evT(1,1)]
  E.run(evs.slice(), mkSnap("0"))
  let hit = -1, stepNo = 1
  for (let i = 1; i < 25; i++) {
    stepNo += 1
    evs.push({ seq: 2000 + stepNo, type: "step/start", data: { turn: 1, step: stepNo } })
    if (E.run(evs.slice(), mkSnap(String(i))) === "完整") { hit = i; break }
  }
  ok(hit === 10, "默认每 10 个模型请求一次完整版（实测第 " + hit + " 个）")
}
console.log("")
console.log("=== 分档 5：同一 step 内续帧保真 ⇒ 完整版不被次帧精简版覆盖 ===")
{
  const E = mk({ snapshotMinGapRounds: 999 })
  // ★2026-10-18 夹具修正：原写 [evT(1,1)] 只有 turn/start、**没有 step/start** ⇒ 生产代码取不到
  //   step 号 ⇒ stepScopeKey 为空串 ⇒ 「空 scope 不参与保真」守卫会跳过保真判定。
  //   本档测的正是「同 step 保真」，夹具必须给出**真实存在的 step**（与 inj5 T7 同口径）。
  const evs = [evT(1,1), { seq: 2, type: "step/start", data: { turn: 1, step: 1 } }]
  ok(E.run(evs, mkSnap("A")) === "完整", "首次注入 ⇒ 完整")
  // 同一 step（事件不再推进）多次渲染：必须保持完整版（宿主整串去重 ⇒ 不会重复投递）
  ok(E.run(evs, mkSnap("A"), undefined, true) === "完整", "★同 step 续帧 ⇒ 仍完整版（保真）")
  ok(E.run(evs, mkSnap("A"), undefined, true) === "完整", "★同 step 第三帧 ⇒ 仍完整版")
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
