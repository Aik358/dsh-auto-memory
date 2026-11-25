#!/usr/bin/env node
/**
 * smoke-test-inj5-step-cadence —— 注入节奏「模型请求（step）」口径验收
 *
 * ★2026-10-18 用户裁定（权威口径）：
 *   「这里的『10 轮』是指 **10 次模型请求**，不要把它当做 10 个对话才注入一次」
 *   随后纠正：「不是 10 次工具调用，是 **10 次模型请求**」。
 *
 * 为什么必须单独一套：旧实现按 **turn** 计数（turnBoundaryKeyPre 返回 'turn:N'），
 *   而一个 turn 的中位 step 数是 10、均值 18.2、实测最大 150
 *   ⇒ 长 turn 里计数器恒定不变，「每 10 轮一次完整版」实际退化成「每 10 个对话轮」，
 *   长任务中间几乎拿不到完整版（用户原话：「怪不得中间没有东西」）。
 *
 * 本套件用**真实事件序列**驱动生产代码段（不是合成计数），断言：
 *   T1 单个 turn 内 25 个模型请求 ⇒ 完整版落在第 1/11/21 个（间隔恰 10）
 *   T2 第 7 个请求真人插话不产生额外完整版，仍按请求间隔计数
 *   T3 两个完整请求之间，每步仍提供精简正文
 *   T4 同一 step 内多次渲染 ⇒ 保持一致（不得被次帧精简版覆盖）
 *   T5 负路径：把计数单位改回 turn ⇒ 必须红
 *   T6 守卫：决策段内不得出现 turn 口径的计数器名
 *   T7 宿主 0.2.1 Session 形状（无 .events）下节奏不变（本轮生产根因固化）
 */
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { claimedHuman, deliveryRequestScope, isUserInput } from '../../lib/injection/request-scope.js'

const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")
const S0 = SRC.indexOf("let tieredFullGranted = false")
// ★2026-10-18（交付层根治配套）：决策段尾部已由 finalizePre 包裹，
//   旧锚点 "return snap + ..." 不再存在 ⇒ lastIndexOf 返回 -1 ⇒ body 被截半 ⇒ 函数无 return。
const END = "return finalizePre(snap + engine.renderReflectionRequest())"
if (S0 < 0) { console.log("FAIL - 找不到决策段"); process.exit(1) }
const body = SRC.slice(S0, SRC.lastIndexOf(END) + END.length)

// ★2026-10-18（交付层根治配套）：决策段现依赖 finalizePre（生产侧同源抽取）。
//   旧夹具只注入决策段 ⇒ new Function 抛 ReferenceError ⇒ 整套假红。
//   下列片段从源码**真实抽取** finalizePre，保证夹具与生产同源（不复制实现）。
const FIN_SRC = (function (SRC) {
  const A = "const finalizePre = (txt, hangGranted = false) => {"
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

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log("  ok - " + m) } else { fail++; console.log("  FAIL - " + m) } }

const FULL = "<memory_system>[规则 — 用户级硬性约束]x[最近 1 天工作日志(尾部)]y</memory_system>"
const SLIM = "<memory_system>[记忆系统 · 精简注入]</memory_system>"

function mkProbe(cfg = {}) {
  const st = { loadedAt: 1 }
  const history = []
  const session = cfg.__host021 ? { snapshotEvents: () => history.slice() } : { events: history }
  const agent = { session }
  const scope = () => deliveryRequestScope(session.events ?? session.snapshotEvents())
  const engine = {
    stateFor: () => st,
    runtimeFor: () => ({ contextVersion: 0 }),
    turnBoundaryKeyPre: () => 'turn:1',
    requestIdPre: () => scope().key,
    renderReflectionRequest: () => '',
    config: { snapshotMinGapRounds: 10, snapshotTieredInject: true, slimEveryRounds: 3, snapshotReinjectOnCompact: true, ...cfg },
  }
  const F = new Function('engine', 'agent', 'gap', 'snap', 'slimText', 'diag', 'createHash', 'parseGapRoundsPre', '_currentHumanRequestPre', FIN_SRC + '\n' + body)
  const emit = (type, data) => history.push({ type, data, seq: history.length + 1 })
  const seenInputs = new Set()
  let open
  emit('turn/start', { turn: 1 })
  function run(events, snap = FULL) {
    const pos = events.findLast(e => e.type === 'step/start').data
    if (!open || pos.step !== open.step || pos.turn !== open.turn) {
      if (open) emit('step/end', open)
      const fresh = events.filter(e => e.type === 'user/message' && !seenInputs.has(e.seq))
      st._deliveryClaimPre = { key: scope().key, position: pos.turn + ':' + pos.step, human: fresh.some(e => isUserInput(e.data)) }
      open = pos
      emit('step/start', open)
      for (const e of fresh) { seenInputs.add(e.seq); emit(e.type, e.data) }
    }
    const out = F(engine, agent, engine.config.snapshotMinGapRounds, snap, SLIM, () => {}, createHash,
      (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback, () => claimedHuman(scope(), st._deliveryClaimPre))
    if (typeof out !== 'string') throw Error('Expected projected snapshot text')
    return out.includes('精简注入') ? 'S' : 'F'
  }
  return { st, run }
}

// ── T1 单 turn 25 个模型请求 ────────────────────────────────────────
console.log("=== T1 单个 turn 内 25 个模型请求 ⇒ 完整版落在第 1/11/21 个 ===")
{
  const P = mkProbe()
  const evs = [{ seq: 1, type: "turn/start", data: { turn: 1 } }]
  let seq = 2
  const row = []
  for (let s = 1; s <= 25; s++) {
    evs.push({ seq: seq++, type: "step/start", data: { turn: 1, step: s } })
    row.push(P.run(evs.slice()))
  }
  const out = row.join("")
  ok(out === "FSSSSSSSSSFSSSSSSSSSFSSSS", "25 个模型请求的节奏为 F+9S+F+9S+F+4S（实测 " + out + "）")
  const fullAt = row.map((c, i) => (c === "F" ? i + 1 : 0)).filter(Boolean)
  ok(fullAt.join(",") === "1,11,21", "完整版落在第 1/11/21 个模型请求（实测 " + fullAt.join(",") + "）")
}

// ── T2 真人插话 ────────────────────────────────────────────────────
console.log("")
console.log("=== T2 第 7 个请求真人插话，完整帧仍按模型请求间隔 ===")
{
  const P = mkProbe()
  const evs = [{ seq: 1, type: "turn/start", data: { turn: 1 } }]
  let seq = 2
  const row = []
  for (let s = 1; s <= 20; s++) {
    if (s === 7) evs.push({ seq: seq++, type: "user/message", data: { role: "user", source: { kind: "user" } } })
    evs.push({ seq: seq++, type: "step/start", data: { turn: 1, step: s } })
    row.push(P.run(evs.slice()))
  }
  const fullAt = row.map((c, i) => (c === "F" ? i + 1 : 0)).filter(Boolean)
  // ★★2026-11-04 判据升级（H2/H3）：真人说话处**不再**强制完整版。
//   新语义：完整版只由首轮 / 压缩 / 水位三时机产生，节奏回到纯步数门槛。
ok(!fullAt.includes(7), "第 7 个请求（真人说话处）**不再**得完整版（实测完整版位置 " + fullAt.join(",") + "）")
  // ★2026-11-04 判据升级（H2/H3）：第 7 个不再授予完整版 ⇒ 「从第 7 个起重新计时」的前提消失。
//   节奏回到纯步数门槛：实测完整版落在 1,11（首轮 + 第 10 步）。
ok(fullAt.join(",") === "1,11", "节奏为准步数门槛 ⇒ 完整版落在 1,11（实测 " + fullAt.join(",") + "）")
}

// ── T3 精简版密度 ──────────────────────────────────────────────────
console.log("")
console.log("=== T3 完整请求之间的精简正文 ===")
{
  const P = mkProbe({ slimEveryRounds: 3 })
  const evs = [{ seq: 1, type: "turn/start", data: { turn: 1 } }]
  let seq = 2
  const row = []
  for (let s = 1; s <= 11; s++) {
    evs.push({ seq: seq++, type: "step/start", data: { turn: 1, step: s } })
    row.push(P.run(evs.slice()))
  }
  const slimBetween = row.slice(1, 10).filter((c) => c === "S").length
  ok(slimBetween === 9, "第 2–10 个请求共 9 次精简版（每请求都渲染，宿主整串去重兜底；实测 " + slimBetween + "）")
  ok(row[0] === "F" && row[10] === "F", "两端（第 1、11 个请求）各一次完整版")
}

// ── T4 同 step 内保真 ──────────────────────────────────────────────
console.log("")
console.log("=== T4 同一个 step 内多次渲染 ⇒ 保持一致（不得被次帧精简版覆盖）===")
{
  const P = mkProbe({ snapshotMinGapRounds: 999 })
  const evs = [{ seq: 1, type: "turn/start", data: { turn: 1 } }, { seq: 2, type: "step/start", data: { turn: 1, step: 1 } }]
  const a = P.run(evs.slice())
  const b = P.run(evs.slice())
  const c = P.run(evs.slice())
  ok(a === "F", "首帧 ⇒ 完整版（实测 " + a + "）")
  ok(b === "F" && c === "F", "同 step 续帧 ⇒ 仍完整版（实测 " + b + c + "）")
}

// ── T5 负路径：改回 turn 口径必红 ───────────────────────────────────
console.log("")
console.log("=== T5 负路径：若把计数单位改回 turn，T1 的节奏断言必须失败 ===")
{
  // 构造一个「turn 口径」的等价实现：step 号恒为 1（同一 turn 内不推进）
  const P = mkProbe()
  const evs = [{ seq: 1, type: "turn/start", data: { turn: 1 } }]
  let seq = 2
  const row = []
  for (let s = 1; s <= 25; s++) {
    evs.push({ seq: seq++, type: "step/start", data: { turn: 1, step: 1 } }) // 故意恒定 step=1
    row.push(P.run(evs.slice()))
  }
  const out = row.join("")
  ok(out !== "FSSSSSSSSSFSSSSSSSSSFSSSS", "step 号恒定时节奏不再成立（实测 " + out + "）⇒ 本套件非恒真")
}

// ── T6 守卫：决策段不得残留 turn 口径计数器 ────────────────────────
console.log("")
console.log("=== T6 守卫：决策段内不得残留 turn 口径的计数器名 ===")
{
  const stripped = body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  ok(!/_lastFullTurnSeq|_lastSlimTurnSeq|turnSeqNow|fullGapTurn|slimGapTurn/.test(stripped),
     "决策段代码（剥注释）零 turn 口径计数器残留")
  ok(/_stepSeq|_lastFullStepSeq/.test(stripped), "step 口径计数器在位")
  ok(/fullGapStep/.test(stripped) && /slimGapStep/.test(stripped), "阈值按 step 命名")
}

// ── T7 宿主 0.2.1 Session 形状（无 .events）下的节奏 ────────────────
console.log("")
console.log("=== T7 宿主 0.2.1（Session 只有 snapshotEvents，无 .events）⇒ 节奏必须仍为 F+9S+F+9S+F ===")
{
  // 背景：2026-10-18 生产实测 —— 决策段两处 step 键解析写成
  //   `Array.isArray(a.session.events) ? a.session.events : null`
  // 而 0.2.1 的 Session 已无 .events ⇒ evs 恒 null ⇒ step 键恒空串 ⇒ _stepSeq 永不推进
  //   ⇒ 完整版间隔判定退化（实测 _stepSeq=undefined、25 个请求全给完整版）。
  // 本项锁「探针必须覆盖当前生产宿主形状」，防止回归只在新形状下复发而套件仍绿。
  const P = mkProbe({ __host021: true })
  const evs = [{ seq: 1, type: "turn/start", data: { turn: 1 } }]
  let seq = 2
  const row = []
  for (let s = 1; s <= 25; s++) {
    evs.push({ seq: seq++, type: "step/start", data: { turn: 1, step: s } })
    row.push(P.run(evs.slice()))
  }
  const out = row.join("")
  ok(out === "FSSSSSSSSSFSSSSSSSSSFSSSS", "0.2.1 形状下节奏仍为 F+9S+F+9S+F（实测 " + out + "）")
  ok(P.st._stepSeq === 25, "step 计数器真实推进到 25（实测 " + P.st._stepSeq + "；旧实现此处为 undefined）")
  // 负路径：计数器必须不是 undefined —— 直接断言，防止「全给完整版」被误当正常
  ok(Number.isFinite(Number(P.st._stepSeq)), "计数器为有限数值（undefined/NaN 即判失败）")
}

console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
