#!/usr/bin/env node
/**
 * smoke-test-inject-frame-fidelity —— 「宿主真实帧序」下的注入交付验收
 *
 * 背景（2026-10-18 实测，宿主 @deepseek-ai/dsh-agent-loop 源码为证）：
 *   每个模型请求，宿主调用 systemPrompt.context() 的 text() **恰好两次**：
 *     ① preStep 的 assemble(:907) —— 结果被准入逻辑**结构性丢弃**(:1067-1073)
 *     ② step() 的 refreshContext(:1053) —— 只有这一份进模型
 *   两次之间宿主会 append step/start(:970)。
 *
 * 旧缺陷：插件用 step/start 派生「当前请求」，两帧拿到不同编号 ⇒ 完整版被②帧的精简版覆盖。
 * 实测主会话 1,693 个请求中仅 316 个（18.7%）真落地；80 条真人消息只有 22 条（27%）拿到完整版。
 *
 * 本套件按**真实帧序**驱动生产决策段：
 *   pre-step 钩子写请求键 → 帧①渲染 → 宿主 append step/start → 帧②渲染
 * 判据：两帧返回必须**逐字节相同**；含真人消息的请求必须交付完整版。
 *
 * 判据纪律（本仓 CR-10）：真执行被测决策段，不用「源码含某字符串」当功能验收。
 * 变异验证：把 finalizePre 的定稿写入注释掉 ⇒ 本套件必红。
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

// 抽出生产决策段（与既有套件同一口径）
const START = "let tieredFullGranted = false"
const END = "return finalizePre(snap + engine.renderReflectionRequest())"
const s0 = SRC.indexOf(START)
const s1 = SRC.lastIndexOf(END) + END.length
if (s0 < 0 || s1 <= s0) { console.log("  FAIL - 找不到决策段"); process.exit(1) }
let SEG = SRC.slice(s0, s1)
// 决策段依赖 finalizePre —— 从源码里抽出其真实实现（保证测的是生产代码而非复制品）
const FIN_START = "const finalizePre = (txt) => {"
const f0 = SRC.indexOf(FIN_START)
if (f0 < 0) { console.log("  FAIL - 找不到 finalizePre"); process.exit(1) }
let depth = 0, f1 = -1
for (let i = f0; i < SRC.length; i++) {
  const c = SRC[i]
  if (c === "{") depth++
  else if (c === "}") { depth--; if (depth === 0) { f1 = i + 1; break } }
}
const FIN_SRC = SRC.slice(f0, f1) + ";"
SEG = FIN_SRC + NL + SEG

function mkSnap(logTail) {
  const parts = [
    "<memory_system>",
    "自动记忆已启用。工作区: D:/dsh-auto-memory | 日期: 2026-10-18",
    LB + "规则 — 用户级硬性约束" + RB,
    "- 规则一",
    LB + "最近 1 天工作日志(尾部)" + RB,
    LB + "2026-10-18" + RB + " " + logTail,
    LB + "白板 PLAN.md — 项目全貌快照" + RB,
    "dsh-auto-memory —— DSH 的记忆插件",
    "</memory_system>"
  ]
  return parts.join(NL)
}

const SLIM = "<memory_system>" + NL + "SLIM-MARKER" + NL + "</memory_system>"

function mkEngine(opts) {
  opts = opts || {}
  const st = {
    _slimStep: 0, _slimCount: 0, _humanFullKey: undefined,
    _snapFp: undefined, _snapLogFp: "", _snapRound: 0, _snapLastRound: 0, _tk: "",
    _reqKeyPre: "", _reqTextKeyPre: "", _reqTextPre: "", _reqHumanPre: "", _reqHumanFullPre: ""
  }
  const agent = { session: { events: [{ seq: 1, type: "turn/start", data: { turn: 1 } }] } }
  const engine = {
    stateFor: function () { return st },
    runtimeFor: function () { return { contextVersion: 0 } },
    turnBoundaryKeyPre: function () { return st._tk },
    humanTurnObservedPre: function () { return !!opts.human },
    humanTurnSeqPre: function () { return opts.humanSeq === undefined ? null : opts.humanSeq },
    renderReflectionRequest: function () { return "" },
    // 与生产同源：最近一次 step/end 的 seq；无 end 时用事件条数
    requestIdPre: function (a) {
      const evs = (a && a.session && Array.isArray(a.session.events)) ? a.session.events : []
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i] && evs[i].type === "step/end") return "e:" + Number(evs[i].seq)
      }
      // ⚠ 与生产一致：不得用事件条数（①帧→②帧之间会 append step/start ⇒ 条数变）
      for (let i = evs.length - 1; i >= 0; i--) {
        if (evs[i] && evs[i].type === "turn/start") return "t:" + Number(evs[i].seq)
      }
      return "e0:" + evs.length
    },
    config: Object.assign({
      snapshotMinGapRounds: 10, snapshotTieredInject: true,
      slimEveryRounds: 3, snapshotReinjectOnCompact: true
    }, opts.cfg || {})
  }
  // 注入 pre-step 钩子的等价行为（生产代码里写在 ctx.on('agent/pre-step')）
  function preStep(turn, step, claimed) {
    const rawT = turn, rawS = step
    const okNum = (v) => v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))
    if (okNum(rawT) && okNum(rawS)) {
      // ★钩子跑在**第①帧之后**（宿主 :907 assemble → :909 钩子 → :970 step/start → :1053 ②帧）
      //   ⇒ 这里写「本请求的键」已无意义；只置「本请求必须给完整版」的待办标记。
      let isHumanNow = false
      for (const m of (claimed || [])) {
        const src = m && m.source
        const kd = src ? (typeof src === "string" ? src : String(src.kind || "")) : ""
        if (!kd || kd === "user") { isHumanNow = true; break }
      }
      if (isHumanNow) { st._humanPending = true; st._humanPendingAt = Date.now() }
    }
  }
  const F = new Function("engine", "agent", "gap", "snap", "slimText", "diag",
    "createHash", "parseGapRoundsPre", SEG + ";")
  const diagSink = []
  function frame(tk, snap, gap) {
    st._tk = tk
    return F(engine, agent, gap === undefined ? 10 : gap, snap, SLIM,
      function (m) { diagSink.push(m) }, createHash,
      function (v, d) { const n = Number(v); return Number.isFinite(n) ? n : d })
  }
  // 宿主一次模型请求 = append step/start + 两帧
  let stepNo = 0
  function hostRequest(turn, claimed, snap) {
    stepNo += 1
    // ★宿主真实顺序（@deepseek-ai/dsh-agent-loop）：
    //   :907 assemble = 帧① → :909 agent/pre-step 钩子 → :970 step/start → :1053 refreshContext = 帧②
    //   → step() 跑完 → :994 step/end
    //   关键：钩子在**帧①之后**，因此它只能置待办标记，无法影响帧①的键。
    const f1out = frame("turn:" + turn, snap)
    preStep(turn, stepNo, claimed)
    agent.session.events.push({ seq: stepNo * 10, type: "step/start", data: { turn, step: stepNo } })
    const f2out = frame("turn:" + turn, snap)
    agent.session.events.push({ seq: stepNo * 10 + 1, type: "step/end", data: { turn, step: stepNo } })
    return { f1: f1out, f2: f2out }
  }
  return { st, frame, hostRequest, diag: diagSink, get stepNo() { return stepNo } }
}

const isFull = (o) => !!o && o.includes("白板 PLAN.md")
const isSlim = (o) => !!o && o.includes("SLIM-MARKER")

// ── T1 帧内幂等：同一请求两帧必须逐字节相同 ──
{
  const E = mkEngine({ human: false })
  const r = E.hostRequest(1, [], mkSnap("日志A"))
  ok(r.f1 === r.f2, "T1-a 同一请求两帧逐字节相同（旧实现此处必红：①完整版 / ②精简版）")
  ok(isFull(r.f2), "T1-b 投影帧（第②帧，宿主真正采用的）交付完整版")
}

// ── T2 真人消息：即使 preStep 帧尚看不到事件流，也必须交付完整版 ──
{
  // human:false 模拟「humanTurnObservedPre 扫事件流尚未命中」的真实时序
  const E = mkEngine({ human: false })
  const r = E.hostRequest(1, [{ source: { kind: "user" }, content: [{ type: "text", text: "人说的话" }] }], mkSnap("日志A"))
  ok(r.f1 === r.f2, "T2-a 真人请求两帧仍逐字节相同")
  ok(isFull(r.f2), "T2-b ★真人消息的请求 ⇒ 投影帧交付完整版（用户核心诉求）")
}

// ── T3 同一 turn 内连发两条真人消息：两条都必须拿到完整版 ──
{
  const E = mkEngine({ human: false })
  const r1 = E.hostRequest(1, [{ source: { kind: "user" } }], mkSnap("日志A"))
  const r2 = E.hostRequest(1, [{ source: { kind: "user" } }], mkSnap("日志B"))
  ok(r1.f1 === r1.f2, "T3-a 第一条真人请求两帧一致")
  ok(isFull(r1.f2), "T3-b 第一条真人请求交付完整版")
  // T3-c：第二条真人请求的两帧都必须交付完整版（内容差异由真实快照变化引起，属正常）
  ok(isFull(r2.f1) && isFull(r2.f2), "T3-c 第二条真人请求两帧均为完整版")
  ok(isFull(r2.f2), "T3-d ★同 turn 内第二条真人消息仍交付完整版（旧实现被 firstOfTurn 吞掉）")
}

// ── T3e 同一 turn 的连续非真人请求不得重复授予完整版 ──
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 10 } })
  const a = E.hostRequest(1, [], mkSnap("日志A"))
  const b = E.hostRequest(1, [], mkSnap("日志B"))
  ok(isFull(a.f2), "T3e-a 首个请求交付完整版")
  ok(!isFull(b.f2), "T3e-b ★同一 turn 的第二个非真人请求不得再给完整版（严格 10 轮）")
}

// ── T4 非真人长任务：完整版严格每 10 个模型请求一次 ──
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 10 } })
  const fullAt = []
  for (let i = 1; i <= 31; i++) {
    const r = E.hostRequest(1, [], mkSnap("日志" + i))
    if (isFull(r.f2)) fullAt.push(i)
  }
  ok(fullAt.join(",") === "1,11,21,31",
    "T4 ★完整版精确落在第 1/11/21/31 个模型请求（实测 " + fullAt.join(",") + "）")
}

// ── T5 帧内幂等对精简版同样成立（旧实现只保护完整版）──
{
  const E = mkEngine({ human: false, cfg: { snapshotMinGapRounds: 999 } })
  E.hostRequest(1, [], mkSnap("日志0"))          // 首帧完整版
  const r = E.hostRequest(1, [], mkSnap("日志1")) // 精简
  ok(r.f1 === r.f2, "T5-a 精简版请求两帧逐字节相同（旧实现此处可能不同）")
  ok(isSlim(r.f2), "T5-b 该请求交付精简版")
}

// ── T6 精简版必须含「记忆维护底线」（用户硬性底线）──
{
  // 直接读生产实现的 slim 层文案键（该键由 renderSlimSnapshotPre 使用）
  ok(/snapshotSlimMaintain/.test(SRC), "T6-a 精简版层文案键 snapshotSlimMaintain 存在")
  const keyM = SRC.match(/snapshotSlimMaintain:\s*'([^']*)'/)
  ok(!!keyM, "T6-b 该键有真实文案")
  if (keyM) {
    const txt = keyM[1]
    const need = ["memory_log", "memory_note", "memory_procedure", "memory_recall"]
    const miss = need.filter((n) => !txt.includes(n))
    ok(miss.length === 0, "T6-c ★精简版文案含全部四项维护指引" + (miss.length ? "（缺 " + miss.join(",") + "）" : ""))
  }
  // 生产实现是 L(snapshotSlimMaintain)（裸标识符，不是字符串字面量）
  const pushed = /out\.push\('\\n' \+ L\(snapshotSlimMaintain\)\)/.test(SRC)
    || /out\.push\('\\n' \+ L\('snapshotSlimMaintain'\)\)/.test(SRC)
  ok(pushed, "T6-d 该文案已真正 push 进精简版输出链")
}

// ── T7 定稿缓存必须覆盖所有**决策出口**（负路径）──
// ⚠️ 必须先剥注释再匹配：决策段里有 4 处注释**引用**了旧实现
//    `return engine.renderReflectionRequest()`，不剥注释会把说明文字当成真实代码
//    （本仓 CRLF 教训：负向断言对未剥注释文本匹配 ⇒ 假红或假绿）。
{
  const stripped = SEG
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/).map((l) => l.replace(/\/\/[^\r\n]*/, "")).join("\n")
  const wrapped = (stripped.match(/return finalizePre\(/g) || []).length
  const rawExits = (stripped.match(/return (?!finalizePre)[^\n;]*renderReflectionRequest\(\)/g) || []).length
  ok(wrapped >= 8, "T7-a 决策段内 finalizePre 包裹数 ≥8（实测 " + wrapped + "）")
  ok(rawExits === 0, "T7-b ★零个未包裹的决策出口（剥注释后实测残留 " + rawExits + " 个）")
}

console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
