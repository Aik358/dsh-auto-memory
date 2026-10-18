#!/usr/bin/env node
/**
 * smoke-test-tiered-cadence-runtime —— 分级注入节奏「真执行」验收（2026-10-05 重写）
 *
 * 为什么重写：上一版用合成夹具（日志正文是普通行），因此漏掉真根因 ——
 * 真实快照的日志正文每行都以「左方括号+日期」开头，旧指纹正则的前瞻会命中的正是这些日期行
 * ⇒ 惰性匹配立刻收尾 ⇒ 指纹只覆盖标题行（实测 16/769 ≈ 2%）⇒ 指纹恒等
 * ⇒ 节流整段被跳过 ⇒ 每轮都投递完整版。
 *
 * 本套件夹具含日期行；T4 是「旧正则必红」的判别器。
 * 可用 DAM_INDEX_JS 指向变异副本做反向验证（变异必红、还原复绿）。
 *
 * 判据纪律（本仓 CR-10）：真执行被测决策段，不用「源码含某字符串」当功能验收。
 */
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const SRC_PATH = process.env.DAM_INDEX_JS || path.join(ROOT, "lib", "index.js")
const SRC = readFileSync(SRC_PATH, "utf8")

let pass = 0, fail = 0
function ok(cond, msg) { if (cond) { pass++; console.log("  ok - " + msg) } else { fail++; console.log("  FAIL - " + msg) } }
const NL = String.fromCharCode(10)
const LB = String.fromCharCode(91), RB = String.fromCharCode(93)

const START = "let tieredFullGranted = false"
const END = "return finalizePre(snap + engine.renderReflectionRequest())"
const s0 = SRC.indexOf(START)
const s1 = SRC.lastIndexOf(END) + END.length

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
if (s0 < 0 || s1 <= s0) { console.log("  FAIL - 找不到决策段"); process.exit(1) }
const SEG = SRC.slice(s0, s1)

// 真实结构夹具：日志正文以「左方括号+YYYY-MM-DD」开头（旧正则的命门）
function mkSnap(logTail) {
  const parts = [
    "<memory_system>",
    "自动记忆已启用。工作区: D:/dsh-auto-memory | 日期: 2026-10-05",
    LB + "规则 — 用户级硬性约束" + RB,
    "- 规则一",
    LB + "最近 1 天工作日志(尾部)" + RB,
    LB + "2026-10-05" + RB + " " + logTail,
    LB + "最近反思 2026-10-03" + RB,
    "- 反思内容",
    LB + "白板 PLAN.md — 项目全貌快照" + RB,
    "dsh-auto-memory —— DSH 的记忆插件",
    "</memory_system>"
  ]
  return parts.join(NL)
}

function mkEngine(opts) {
  opts = opts || {}
  const st = { _slimStep: 0, _lastSlimCounted: 0, _slimCount: 0, _humanFullKey: undefined,
    _snapFp: undefined, _snapLogFp: "", _snapRound: 0, _snapLastRound: 0, _tk: "" }
  const agent = { session: { events: [] } }
  const engine = {
    stateFor: function () { return st },
    runtimeFor: function () { return { contextVersion: 0 } },
    turnBoundaryKeyPre: function () { return st._tk },
    humanTurnObservedPre: function () { return !!opts.human },
    renderReflectionRequest: function () { return "" },

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
    config: Object.assign({ snapshotMinGapRounds: 5, snapshotTieredInject: true,
      slimEveryRounds: 3, snapshotReinjectOnCompact: true }, opts.cfg || {})
  }
  const GAP_DEF = (function () { const n = Number(engine.config.snapshotMinGapRounds); return Number.isFinite(n) && n >= 0 ? n : 5 })()
  const F = new Function("engine", "agent", "gap", "snap", "slimText", "diag", "createHash", "parseGapRoundsPre", FIN_SRC + String.fromCharCode(10) + SEG + ";")
  // ★2026-10-18（step 口径）：计数单位改为**模型请求**（step），不是 turn。
  //   旧夹具只改 st._tk（turn 键）⇒ 新代码的 _stepSeq 不推进 ⇒ T4/T7 恒红（这属夹具过时，不是缺陷）。
  //   现在每次 run 都追加一条 step/start 事件，让 step 键真实推进（与生产事件流同形）。
  let stepNo = 0
  const run = function (tk, snap, gap, sameStep) {
    st._tk = tk
    // sameStep=true ⇒ 复用同一 step（模拟宿主在**同一个 step 内**多次调用 text()）
    if (!sameStep) { stepNo += 1 }
    agent.session.events.push({ seq: stepNo * 10 + (sameStep ? 1 : 0), type: "step/start", data: { turn: 1, step: stepNo } })
    return F(engine, agent, gap === undefined ? GAP_DEF : gap, snap, "<memory_system>SLIM</memory_system>",
      function () {}, createHash, function (v, d) { const n = Number(v); return Number.isFinite(n) ? n : d })
  }
  return { st: st, run: run }
}
const isFull = (o) => !!o && o.includes("白板 PLAN.md")
const isSlim = (o) => !!o && o.includes("SLIM")

// T1 指纹的判别力（直接调用被抽出的真实实现）
{
  const anchor = "const snapshotLogFpPre = (s) => {"
  const i0 = SEG.indexOf(anchor)
  ok(i0 >= 0, "T1-a 决策段内含 snapshotLogFpPre 实现")
  if (i0 >= 0) {
    let depth = 0, i1 = -1
    for (let i = i0; i < SEG.length; i++) {
      const c = SEG[i]
      if (c === "{") depth++
      else if (c === "}") { depth--; if (depth === 0) { i1 = i + 1; break } }
    }
    ok(i1 > i0, "T1-b 助手函数体可完整抽取")
    const fpPre = new Function("createHash", SEG.slice(i0, i1) + "; return snapshotLogFpPre")(createHash)
    const a = fpPre(mkSnap("本日的日志正文甲"))
    const b = fpPre(mkSnap("本日的日志正文乙"))
    ok(typeof a === "string" && a.length === 16, "T1-c 指纹为 16 位 hex")
    ok(a !== b, "T1-d 日志正文不同 ⇒ 指纹不同【旧正则在此恒等 ⇒ 必红】")
    ok(fpPre(mkSnap("本日的日志正文甲")) === a, "T1-e 日志正文相同 ⇒ 指纹稳定")
  }
}

// T2 首次注入 ⇒ 完整版
{
  const E = mkEngine({ human: false })
  ok(isFull(E.run("turn:1", mkSnap("日志A"))), "T2 首次注入 ⇒ 完整版")
}

// T3 日志已变但间距未到 ⇒ 精简版
{
  const E = mkEngine({ human: false })
  E.run("turn:1", mkSnap("日志A"))
  ok(isSlim(E.run("turn:2", mkSnap("日志B"))), "T3 日志已变且间距未到 ⇒ 精简版")
}

// T4 间距放行：turn 推进达 gap 轮必须出现一次完整版（旧正则必红的判别器）
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 5 } })
  let sawFull = false, at = -1
  for (let i = 0; i < 12; i++) {
    const out = E.run("turn:" + i, mkSnap("日志" + i))
    if (i > 0 && isFull(out)) { sawFull = true; at = i; break }
  }
  ok(sawFull, "T4 连续 turn 推进达 gap 轮 ⇒ 周期性放行完整版（第 " + at + " 轮）【旧正则必红】")
  ok(at === 5, "T4-b 放行位置符合 gap=5 语义（实测第 " + at + " 轮）")
}

// T5 真人在场 ⇒ turn 首次给完整版
{
  const E = mkEngine({ human: true })
  ok(isFull(E.run("turn:1", mkSnap("日志A"))), "T5 真人在场 turn 首次 ⇒ 完整版")
}

// T6 gap=0 ⇒ 节流关闭，恒完整版（有意义的用户设置，不可降级）
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 0 } })
  ok(isFull(E.run("turn:1", mkSnap("日志A"), 0)), "T6 gap=0 ⇒ 完整版")
  ok(isFull(E.run("turn:1", mkSnap("日志B"), 0)), "T6-b gap=0 且日志已变 ⇒ 仍完整版")
}

// T7 默认节奏：fullGap=10 ⇒ 每 10 轮一个完整版
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 10 } })
  E.run("turn:0", mkSnap("日志0"))                      // 首帧 ⇒ 完整版（计数起点）
  let at = -1
  for (let i = 1; i < 20; i++) { if (isFull(E.run("turn:" + i, mkSnap("日志" + i)))) { at = i; break } }
  ok(at === 10, "T7 默认每 10 轮一次完整版（实测第 " + at + " 轮）")
}

// T8 同 step 续帧保真：宿主在**同一个 step 内**多次调用 text() ⇒ 必须保持一致（不得被次帧精简版覆盖）
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999 } })
  ok(isFull(E.run("turn:1", mkSnap("日志A"))), "T8-a 首次注入 ⇒ 完整版")
  // sameStep=true ⇒ 不推进 stepNo，模拟宿主同一 step 内重复调用
  ok(isFull(E.run("turn:1", mkSnap("日志A"), undefined, true)), "★T8-b 同 step 续帧 ⇒ 仍完整版（保真）")
  ok(isFull(E.run("turn:1", mkSnap("日志A"), undefined, true)), "★T8-c 同 step 第三帧 ⇒ 仍完整版")
}

// T9 精简版节奏：每 slimEveryRounds 轮一次
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999, slimEveryRounds: 3 } })
  E.run("turn:0", mkSnap("日志0"))
  const tags = []
  for (let i = 1; i <= 9; i++) tags.push(isSlim(E.run("turn:" + i, mkSnap("日志" + i))) ? "S" : "F")
  ok(tags.join("") === "SSSSSSSSS", "T9 fullGap=999 下 9 轮全为精简版（实测 " + tags.join("") + "）")
}

// T10 fullEverySlims 已从产线与决策段移除
{
  const START_SEG = "let tieredFullGranted = false"
  const a = SRC.indexOf(START_SEG)
  const b = SRC.lastIndexOf("return finalizePre(snap + engine.renderReflectionRequest())") + "return finalizePre(snap + engine.renderReflectionRequest())".length
  const stript = SRC.slice(a, b).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  ok(!/fullEverySlims/.test(stript), "★T10-a 决策段（剥注释）零 fullEverySlims 引用")
  ok(SRC.indexOf("upgradeFullEverySlimsDefaultPre(parsed)") < 0, "★T10-b 迁移调用点已移除")
  ok(!/(?:^|\n)\s*fullEverySlims:\s*/.test(SRC), "★T10-c DEFAULT_CONFIG 不再含 fullEverySlims 键")
}

console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)