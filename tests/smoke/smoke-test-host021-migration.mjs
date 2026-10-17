#!/usr/bin/env node
/**
 * smoke-test-host021-migration —— DSH 0.2.1 宿主 API 换代适配验收
 *
 * 背景（用户报「旧的 subagent 命令过时」+「语义检索编排库没有编译成功」）：
 *   ① DSH 0.2.1 把 `subagents.start()` 换成了 `startActivation()`：
 *      实测 SubagentRuntime 公开方法只有
 *        startActivation / waitForChildren / sendMessage / interrupt / drainDescendants
 *      旧调用必然 `TypeError: subagents.start is not a function`，被 catch 吞成一行 diag，
 *      表现为「记忆自动沉淀/折叠静默失效」。
 *   ② 语义索引的 `indexReady` 只依赖引擎切换状态机的 `phase==='ready' && published`，
 *      而 phase 只有**发生过切换**才会 ready ⇒ 从没切过引擎的安装永远显示「索引就绪：否」，
 *      并带出陈旧 error（实测 phase=idle / startedAt=0 / error=sync-in-progress，而 ncand=8 索引可用）。
 *
 * 判据纪律：真执行被测函数，不做纯源码静态断言。
 */
import { readFileSync } from "node:fs"

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log("  ok - " + m) } else { fail++; console.log("  FAIL - " + m) } }
const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")

// ── T1 适配函数存在且是 async ─────────────────────────────────────
console.log("=== T1 startActivation 适配层存在 ===")
{
  ok(/async function callSubagentStartPre\(/.test(SRC), "适配函数 callSubagentStartPre 已定义")
  ok(/typeof subagents\.startActivation === "function"/.test(SRC), "识别 0.2.x 的 startActivation")
  ok(/typeof subagents\.start === "function"/.test(SRC), "保留 0.1.x 的 start 兼容分支")
  // 两处调用点都必须走适配层
  const callSites = (SRC.match(/await callSubagentStartPre\(/g) || []).length
  ok(callSites === 2, "两处调用点都改走适配层（实测 " + callSites + " 处）")
  // 不得再有**裸 start 调用**：适配函数内部的 0.1.x 兼容分支本身会写 subagents.start(，
  //   那是唯一合法位置 ⇒ 判据是「除适配函数体之外，剥注释后零 subagents.start(」。
  const stripped = SRC.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
  const fnStart = stripped.indexOf("async function callSubagentStartPre(")
  let d2 = 0, fnEnd = -1
  for (let k = stripped.indexOf("{", fnStart); k < stripped.length; k++) {
    if (stripped[k] === "{") d2++
    else if (stripped[k] === "}") { d2--; if (d2 === 0) { fnEnd = k + 1; break } }
  }
  const outside = stripped.slice(0, fnStart) + stripped.slice(fnEnd)
  ok(!/subagents\.start\(/.test(outside), "适配函数之外无裸 subagents.start() 调用（实测 " + (outside.match(/subagents\.start\(/g) || []).length + " 处）")
  ok((stripped.match(/subagents\.start\(/g) || []).length === 1, "全文件仅适配函数内的 1 处 0.1.x 兼容调用")
}

// ── T2 适配层真执行：0.2.x 分支 ───────────────────────────────────
console.log("")
console.log("=== T2 适配层真执行：0.2.x（提供 startActivation）===")
{
  // 抽出函数体真跑
  const i = SRC.indexOf("async function callSubagentStartPre(")
  let depth = 0, end = -1
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") depth++
    else if (SRC[k] === "}") { depth--; if (depth === 0) { end = k + 1; break } }
  }
  ok(end > i, "适配函数体可完整抽取")
  const fnSrc = SRC.slice(i, end)
  const factory = new Function("return (" + fnSrc.replace("async function callSubagentStartPre(", "async function (") + ")")
  const call = factory()

  let seenSpec = null
  const fakeActivation = { childId: "child-1", messageId: "msg-1", result: Promise.resolve({ output: [{ type: "text", text: "hi" }] }), dispose: () => {} }
  const v02 = { startActivation: async (spec) => { seenSpec = spec; return fakeActivation } }
  const run02 = await call(v02, "spawn", { label: "L", prompt: [{ type: "text", text: "p" }], parent: { session: { id: "s" } } })
  ok(!!run02, "0.2.x 返回 run 对象")
  ok(run02.childId === "child-1", "run.childId 透传（实测 " + run02.childId + "）")
  ok(typeof run02.dispose === "function", "run.dispose 存在（finally 清理可用）")
  const res = await run02.result
  ok(res && res.output && res.output[0].text === "hi", "run.result 可 await 并拿到输出")
  ok(seenSpec && seenSpec.provider === "spawn", "spec.provider 正确")
  ok(seenSpec && seenSpec.label === "L", "spec.label 正确")
  ok(seenSpec && seenSpec.delivery === "parent", "spec.delivery='parent'（照抄官方工具）")
  ok(seenSpec && seenSpec.request && Array.isArray(seenSpec.request.prompt), "request.prompt 为数组")
  ok(seenSpec && seenSpec.request.parent && seenSpec.request.parent.session.id === "s", "request.parent 透传")
}

// ── T3 适配层：0.1.x 兼容分支 ─────────────────────────────────────
console.log("")
console.log("=== T3 适配层真执行：0.1.x（只有 start）===")
{
  const i = SRC.indexOf("async function callSubagentStartPre(")
  let depth = 0, end = -1
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") depth++
    else if (SRC[k] === "}") { depth--; if (depth === 0) { end = k + 1; break } }
  }
  const fnSrc = SRC.slice(i, end)
  const call = new Function("return (" + fnSrc.replace("async function callSubagentStartPre(", "async function (") + ")")()
  const legacyRun = { result: Promise.resolve({ output: [] }), dispose: () => {} }
  const v01 = { start: async (name, opts) => legacyRun }
  const r = await call(v01, "spawn", { label: "L", prompt: [{ type: "text", text: "p" }] })
  ok(r === legacyRun, "0.1.x 原样返回旧 run 对象（不破坏旧宿主）")
}

// ── T4 两者都缺 ⇒ 明确报错而非静默 ────────────────────────────────
console.log("")
console.log("=== T4 负路径：两个方法都不存在 ⇒ 明确抛错 ===")
{
  const i = SRC.indexOf("async function callSubagentStartPre(")
  let depth = 0, end = -1
  for (let k = SRC.indexOf("{", i); k < SRC.length; k++) {
    if (SRC[k] === "{") depth++
    else if (SRC[k] === "}") { depth--; if (depth === 0) { end = k + 1; break } }
  }
  const call = new Function("return (" + SRC.slice(i, end).replace("async function callSubagentStartPre(", "async function (") + ")")()
  let threw = ""
  try { await call({}, "spawn", { label: "L", prompt: [] }) } catch (e) { threw = String(e && e.message || e) }
  ok(/neither startActivation|nor start/.test(threw), "两者皆无时抛出可辨认错误（实测 " + threw.slice(0, 80) + "）")
}

// ── T5 indexReady 不再只依赖状态机 ───────────────────────────────
console.log("")
console.log("=== T5 indexReady 兼容「从未切换过引擎」的安装 ===")
{
  ok(/_idxUsable/.test(SRC), "新增 _idxUsable 可用性判据")
  // 最终形态：状态机为主出处，仅「从未开代」时用静态可用性兜底
  ok(SRC.indexOf("indexReady = (_switchInFlight") >= 0, "发布前恒 false（P2 核心不变量）")
  ok(SRC.indexOf("engineSwitch.phase === " + String.fromCharCode(34) + "idle") >= 0, "只在 idle/ready 时清 error（不擦在飞错误）")
  ok(SRC.indexOf("ph === " + String.fromCharCode(34) + "failed") >= 0, "failed/cancelled 时不得冒充就绪")
  ok(SRC.indexOf("hasUsableIndex") >= 0, "支持宿主 hasUsableIndex 探针")
  ok(SRC.indexOf("indexedRecords") >= 0, "兜底：jsSemantic.indexedRecords > 0 视为可用")
  ok(SRC.indexOf("staleError") >= 0, "陈旧 error 会被摘掉并记入 staleError")
}

console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)
