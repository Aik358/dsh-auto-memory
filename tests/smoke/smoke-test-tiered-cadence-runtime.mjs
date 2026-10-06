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
const END = "return snap + engine.renderReflectionRequest()"
const s0 = SRC.indexOf(START)
const s1 = SRC.lastIndexOf(END) + END.length
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
  const engine = {
    stateFor: function () { return st },
    runtimeFor: function () { return { contextVersion: 0 } },
    turnBoundaryKeyPre: function () { return st._tk },
    humanTurnObservedPre: function () { return !!opts.human },
    renderReflectionRequest: function () { return "" },
    config: Object.assign({ snapshotMinGapRounds: 5, snapshotTieredInject: true,
      fullEverySlims: 3, slimEveryRounds: 3, snapshotReinjectOnCompact: true }, opts.cfg || {})
  }
  const F = new Function("engine", "agent", "gap", "snap", "slimText", "diag", "createHash", "parseGapRoundsPre", SEG + ";")
  const run = function (tk, snap, gap) {
    st._tk = tk
    return F(engine, {}, gap === undefined ? 5 : gap, snap, "<memory_system>SLIM</memory_system>",
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
  ok(isSlim(E.run("turn:1", mkSnap("日志B"))), "T3 日志已变且间距未到 ⇒ 精简版")
}

// T4 间距放行：连续日志变化达 gap 轮必须出现一次完整版（旧正则必红的判别器）
{
  const E = mkEngine({ human: false, cfg: { fullEverySlims: 999 } })
  let sawFull = false, at = -1
  for (let i = 0; i < 12; i++) {
    const out = E.run("turn:" + i, mkSnap("日志" + i))
    if (i > 0 && isFull(out)) { sawFull = true; at = i; break }
  }
  ok(sawFull, "T4 连续日志变化达 gap 轮 ⇒ 周期性放行完整版（第 " + at + " 轮）【旧正则必红】")
  ok(at >= 5 && at <= 8, "T4-b 放行位置符合 gap=5 语义（实测第 " + at + " 轮）")
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

// T7 攒够精简 ⇒ 门槛放行完整版（门槛可达）
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999 } })
  let sawFull = false
  for (let i = 1; i < 30; i++) { if (isFull(E.run("turn:" + i, mkSnap("日志" + i)))) { sawFull = true; break } }
  ok(sawFull, "T7 攒够 fullEverySlims 次精简 ⇒ 自动放行完整版")
}

// T8【INJ-1 · S1 负路径】快照逐字节未变 ⇒ 也必须给精简版（旧分支在此返回 38KB 完整版）
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999, fullEverySlims: 999 } })
  E.run("turn:1", mkSnap("日志A"))                      // 首次注入 ⇒ 完整版
  const o1 = E.run("turn:1", mkSnap("日志A"))           // 快照逐字节相同
  ok(isSlim(o1), "★T8 快照未变 ⇒ 精简版（负路径：不得再走「交宿主去重」返回完整版）")
  ok(E.st._slimCount === 1, "★T8-b 该路径也计数（旧实现跳过 countTieredSlim ⇒ 门槛永不满足；实测 " + E.st._slimCount + "）")
}

// T9【INJ-1 · S2】计数单位 = 精简版实际投递次数：slimEveryRounds 不再是折算因子
{
  // gap 显式 999：mkEngine.run 缺省 gap=5，「间距已满足」分支会掩盖门槛语义（本轮踩过）。
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999, fullEverySlims: 5, slimEveryRounds: 99 } })
  ok(isFull(E.run("turn:0", mkSnap("日志0"), 999)), "T9-a 首次注入 ⇒ 完整版（计数起点不计入连投）")
  let slims = 0
  for (let i = 1; i <= 20; i++) {
    if (isSlim(E.run("turn:" + i, mkSnap("日志" + i), 999))) slims++
    else break
  }
  ok(slims === 5, "T9 slimEveryRounds=99 下仍「满 5 次精简」即放行（实测精简 " + slims + " 次）")
}

// T10【INJ-1 · S2】出厂默认 10：连续自主步在满 10 次精简前不得出现完整版
{
  // 夹具参数取自产线 DEFAULT_CONFIG，避免「只测夹具自己的字面量」。
  // ★INJ-2（2026-10-06）：`fullEverySlims` 在 DEFAULT_CONFIG 里改为**引用常量**
  //   （`DEFAULT_FULL_EVERY_SLIMS`，与容量键同风格、防双源漂移）⇒ 旧解析只认字面量数字，
  //   会取到 NaN，症状是「出厂默认 = NaN」（离真因很远）。现按「先取标识符、再解析该常量」两级求值，
  //   判据强度不变：仍然测的是**产线真实默认值**，不是夹具自己的字面量。
  const DEF_FULL = (() => {
    const m = SRC.match(/(?:^|\n)\s*fullEverySlims:\s*([A-Za-z_$][\w$]*|\d+)/)
    if (!m) return NaN
    if (/^\d+$/.test(m[1])) return Number(m[1])
    const c = SRC.match(new RegExp('const ' + m[1] + ' = (\\d+)'))
    return c ? Number(c[1]) : NaN
  })()
  ok(DEF_FULL === 10, "T10-a ★出厂默认 fullEverySlims = 10（实测 " + DEF_FULL + "）")
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999, fullEverySlims: DEF_FULL } })
  ok(isFull(E.run("turn:0", mkSnap("日志0"), 999)), "T10-b 首次注入 ⇒ 完整版（计数起点不计入连投）")
  let slimRun = 0, sawEarlyFull = false
  for (let i = 1; i <= 30; i++) {
    const out = E.run("turn:" + i, mkSnap("日志" + i), 999)
    if (isSlim(out)) slimRun++
    else { if (slimRun < DEF_FULL) sawEarlyFull = true; break }
  }
  ok(!sawEarlyFull, "T10 满 " + DEF_FULL + " 次精简投递前不出现完整版（实测连投精简 " + slimRun + " 次）")
  ok(slimRun === DEF_FULL, "T10-c 恰好 " + DEF_FULL + " 次后放行（实测 " + slimRun + "）")
}

console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)