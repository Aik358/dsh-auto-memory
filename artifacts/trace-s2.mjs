import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const SRC = readFileSync("lib/index.js", "utf8")
const START = "let tieredFullGranted = false"
const END = "return snap + engine.renderReflectionRequest()"
const s = SRC.indexOf(START), e = SRC.lastIndexOf(END)
const SEG = SRC.slice(s, e + END.length)
const factory = new Function("engine","agent","gap","snap","slimText","diag","createHash","parseGapRoundsPre", "return (function () {" + SEG + "})()")
const FULL = "<memory_system>FULL" + String.fromCharCode(10) + "[最近 1 天工作日志]" + String.fromCharCode(10) + "- 条目" + String.fromCharCode(10) + "</memory_system>"
const SLIM = "SLIM"
const st = { _slimStep:0,_lastSlimCounted:0,_slimCount:0,_humanFullKey:undefined,_snapFp:undefined,_snapLogFp:"",_snapRound:0,_snapLastRound:0 }
const logs = []
const engine = { state:st, config:{snapshotMinGapRounds:5,snapshotTieredInject:true,fullEverySlims:3,slimEveryRounds:1},
  stateFor:()=>st, runtimeFor:()=>({contextVersion:0}), turnBoundaryKeyPre:()=>globalThis.K,
  humanTurnObservedPre:()=>false, renderReflectionRequest:()=>"" }
const run = (g)=>factory(engine,{},g,FULL,SLIM,(m)=>logs.push(m),createHash,(v,d)=>{const n=Number(v);return Number.isFinite(n)?n:d})
globalThis.K = "t1";
console.log("run1 =", JSON.stringify(run(5)))
console.log("state after run1:", JSON.stringify({snapFp: st._snapFp===FULL, logFp: st._snapLogFp, round: st._snapRound, lastRound: st._snapLastRound}))
globalThis.K = "t2";
console.log("run2 =", JSON.stringify(run(5)))
console.log("state after run2:", JSON.stringify({logFp: st._snapLogFp, round: st._snapRound, lastRound: st._snapLastRound, pending: !!st._snapPendingSnap}))
console.log("diag:", JSON.stringify(logs))