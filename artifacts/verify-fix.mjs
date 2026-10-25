import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
const SRC = readFileSync("lib/index.js", "utf8")
const START = "let tieredFullGranted = false"
const END = "return snap + engine.renderReflectionRequest()"
const s = SRC.indexOf(START), e = SRC.lastIndexOf(END)
const SEG = SRC.slice(s, e + END.length)
const factory = new Function("engine","agent","gap","snap","slimText","diag","createHash","parseGapRoundsPre", "return (function () {" + SEG + "})()")
const FULL = "<memory_system>FULL" + String.fromCharCode(10) + "[最近 1 天工作日志]" + String.fromCharCode(10) + "- 条目" + String.fromCharCode(10) + "</memory_system>"
const SLIM = "<memory_system>这是精简版</memory_system>"
// 同一会话：共享 st，仅 turn 号变化 —— 这才是「同会话新 turn」
function session() {
  const st = { _slimStep:0,_lastSlimCounted:0,_slimCount:0,_humanFullKey:undefined,_snapFp:undefined,_snapLogFp:"",_snapRound:0,_snapLastRound:0 }
  const engine = { state:st, config:{snapshotMinGapRounds:5,snapshotTieredInject:true,fullEverySlims:3,slimEveryRounds:1},
    stateFor:()=>st, runtimeFor:()=>({contextVersion:0}), turnBoundaryKeyPre:()=>st._k,
    humanTurnObservedPre:()=>st._human, renderReflectionRequest:()=>"" }
  return { st, turn:(k,h,g)=>{ st._k=k; st._human=!!h; return factory(engine,{},g===undefined?5:g,FULL,SLIM,()=>{},createHash,(v,d)=>{const n=Number(v);return Number.isFinite(n)?n:d}) } }
}
let pass=0, fail=0
const ok=(c,m)=>{ if(c){pass++;console.log("  ok - "+m)}else{fail++;console.log("  FAIL - "+m)} }
const isFull=(o)=>o.includes("FULL"), isSlim=(o)=>o.includes("这是精简版")
{ const S=session(); ok(isFull(S.turn("t1",false)), "S1 首轮(会话首帧) → 完整版") }
{ const S=session(); S.turn("t1",false); ok(isSlim(S.turn("t2",false)), "S2 同会话新 turn、日志未变未获授 → 精简版【修复核心】") }
{ const S=session(); S.turn("t1",false); S.turn("t2",false); ok(isFull(S.turn("t2",false)), "S3 同 turn 第二次 → 完整版【去重契约】") }
{ const S=session(); S.turn("t1",false); ok(isFull(S.turn("t2",true)), "S4 真人在场 → 完整版") }
{ const S=session(); ok(isFull(S.turn("t1",false,0)), "S5 gap=0 → 完整版【节流关闭语义】") }
{ const S=session(); S.turn("t0",false); let hit=false;
  for(let i=1;i<=12;i++){ if(isFull(S.turn("t"+i,false))&&i>1){hit=true;break} }
  ok(hit, "S6 攒够精简 → 自动放行完整版【fullEverySlims 门槛可达】") }
{ const S=session(); S.turn("t1",false); S.turn("t2",false); S.turn("t3",false);
  ok(isFull(S.turn("t3",false)) || isSlim(S.turn("t3",false)), "S7 长会话不抛错") }
console.log("PASS "+pass+" / FAIL "+fail)
process.exit(fail?1:0)