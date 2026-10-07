import { readFileSync } from "node:fs"

// 方案 B（冷启动预热）验收：断言 restoreLastAgent 恢复成功后**确实发起了一次 refresh**。
// 真执行口径：从源码抽出预热判据片段，放进 new Function 里跑，用假 engine 记录 refresh 调用。
// 变异反向验证：删掉 void this.refresh(a) ⇒ B1 必红。
const SRC = readFileSync(process.env.DAM_INDEX_JS || "lib/index.js", "utf8")
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log("  ok - " + m) } else { fail++; console.log("  FAIL - " + m) } }

console.log("=== B0 预热已接线，且不得 await（await 会拖慢 15s 心跳）===")
const iRla = SRC.indexOf("  restoreLastAgent() {")
const seg = SRC.slice(iRla, iRla + 4600)
ok(iRla > 0, "定位到 restoreLastAgent 函数体（" + seg.length + " 字符）")
ok(seg.includes("rla:prewarm"), "预热成功留痕存在")
ok(!/await\s+this\.refresh\(/.test(seg), "★预热不得 await refresh")
ok(/void\s+this\.refresh\(a\)/.test(seg), "★预热以 void 发起 refresh(a)")

console.log("")
console.log("=== B1/B2 真执行预热判据：未就绪必预热、已就绪不预热 ===")
const iNeed = seg.indexOf("const rtPre = this.runtimeFor(a)")
const iEnd = seg.indexOf("} catch (_) {}", iNeed)
ok(iNeed > 0 && iEnd > iNeed, "取到预热判据片段（" + (iEnd - iNeed) + " 字符）")
const judge = seg.slice(iNeed, iEnd)
const runJudge = (loadedAt) => {
  const calls = []
  const rt = { state: { loadedAt: loadedAt } }
  const engine = { runtimeFor: () => rt, refresh: (ag) => { calls.push(ag && ag.id); return Promise.resolve() } }
  const body = "const self = engine; const diagThrottled = function(){}; const a = agent; " + judge.split("this.").join("self.") + "; return calls"
  const f = new Function("engine", "agent", "calls", body)
  f(engine, { id: "session-x" }, calls)
  return calls
}
{
  const calls = runJudge(0)
  ok(calls.length === 1 && calls[0] === "session-x", "未就绪 ⇒ 发起 1 次 refresh（实得 " + calls.length + " 次）")
}
{
  const calls = runJudge(Date.now())
  ok(calls.length === 0, "已就绪 ⇒ 不预热（幂等，实得 " + calls.length + " 次）")
}

console.log("")
console.log("=== B3 每个宿主进程只预热一次（受 !_lastAgent 门控）===")
{
  const iTick = SRC.indexOf("if (!this._lastAgent) this.restoreLastAgent()")
  ok(iTick > 0, "调用点仍受 !this._lastAgent 门控 ⇒ 恢复成功后后续 tick 不再进入")
}

console.log("")
console.log("PASS " + pass + " / FAIL " + fail)
process.exit(fail ? 1 : 0)