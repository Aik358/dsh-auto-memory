#!/usr/bin/env node
/**
 * smoke-test-issue578-upgrade-wizard-deadlock.mjs —— #578 回归守卫（2026-11-24）
 *
 * ## 缺陷原文（issue #578）
 * 旧格式升级向导第 1 页点「开始整理」恒报「当前工作区不在工作区清单内，请在第 2 页改选…」，
 * 而**范围选择器只存在于第 2 页**、进第 2 页的前置校验（onGoP2）又在该情形直接 return
 * ⇒ 用户永远进不了第 2 页 = **死锁**。
 *
 * ## 真正的第一因（issue 方向对，但根因更靠前）
 * apiGet 的 sessionId 白名单**漏了 upgradeWorkspaces**（只列 external/file/eventList/upgradeStatus）
 * ⇒ 清单请求不带会话身份 ⇒ 后端解析不出 ws ⇒ 所有行 matchedWsKey=null ⇒ 前端误判并死锁。
 *
 * ## 本套件守什么
 * A. 真执行 apiGet：fetch 桩捕捉真实 URL，断言 upgradeWorkspaces 带 sessionId（正+对照+优先+变异）
 * B. 真调用 upgradeWizardGoP2GatePre：allow 恒 true（死锁解除）、warn 区分两种成因（语义错位修复）
 * C. 结构：onGoP2 先取 gate 再 setPage(p2)；ensureInventory 请求携带 ws；后端接受显式 ws
 * D. 变异反向验证：旧行为灌回 ⇒ A/B 必须变红（证明判据非恒真）
 */
import { readFileSync } from "node:fs"
import vm from "node:vm"

const SRC = readFileSync(new URL("../../lib/client.js", import.meta.url), "utf8")
const IX = readFileSync(new URL("../../lib/index.js", import.meta.url), "utf8")
let pass = 0, fail = 0
const ok = (cond, msg, extra) => {
  if (cond) { pass++; console.log("  ok   - " + msg + (extra ? " :: " + extra : "")) }
  else { fail++; console.log("  FAIL - " + msg + (extra ? " :: " + extra : "")) }
}
const NL = String.fromCharCode(10)

// ═══════ A. 真执行 apiGet：sessionId 白名单 ═══════
console.log("== A. 真执行 apiGet：sessionId 白名单 ==")
const APIX = {
  external: "/api/x/external", file: "/api/x/file", eventList: "/api/x/event-list",
  upgradeStatus: "/api/x/upgrade-status", upgradeWorkspaces: "/api/x/upgrade-workspaces",
  config: "/api/x/config", recall: "/api/x/recall",
}
function extractApiGet() {
  const a = SRC.indexOf("    async function apiGet(path, params, signal) {")
  const b = SRC.indexOf("    async function readHubActionResponsePre(", a)
  if (a < 0 || b < 0 || b <= a) return null
  return SRC.slice(a, b)
}
const APIGET_SRC = extractApiGet()
ok(!!APIGET_SRC, "A0 apiGet 函数体可抽取（段边界在场）")

function runApiGet(src, path, params, sid) {
  const calls = []
  const ctx = {
    console, API: APIX,
    currentSessionIdClient: function () { return sid },
    fetch: function (u) {
      calls.push(String(u))
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}) } })
    },
    pythonSetupRequestPre: function (p, f) { return f() },
    query: function (obj) {
      if (!obj) return ""
      const us = []
      Object.keys(obj).forEach(function (k) {
        const v = obj[k]
        if (v === undefined || v === null || v === "") return
        us.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v)))
      })
      return us.length ? "?" + us.join("&") : ""
    },
  }
  vm.createContext(ctx)
  vm.runInContext(src + NL + "globalThis.__apiGet = apiGet;", ctx)
  return ctx.__apiGet(path, params).then(function () { return String(calls[0] || "") })
}

{
  const u = await runApiGet(APIGET_SRC, APIX.upgradeWorkspaces, { effort: "medium" }, "SID-abc")
  ok(u.indexOf("sessionId=SID-abc") >= 0, "A1【#578 核心】upgradeWorkspaces 请求带 sessionId", u)
}
{
  const u = await runApiGet(APIGET_SRC, APIX.upgradeStatus, undefined, "SID-abc")
  ok(u.indexOf("sessionId=SID-abc") >= 0, "A2 upgradeStatus 仍带 sessionId（既有行为未回归）", u)
}
{
  const u = await runApiGet(APIGET_SRC, APIX.config, undefined, "SID-abc")
  ok(u.indexOf("sessionId=") < 0, "A3 对照：非名单路由 config **不**带 sessionId（未被过度修改）", u)
}
{
  const u = await runApiGet(APIGET_SRC, APIX.upgradeWorkspaces, { effort: "m", sessionId: "EXPLICIT-1" }, "SID-abc")
  ok(u.indexOf("sessionId=EXPLICIT-1") >= 0 && u.indexOf("SID-abc") < 0, "A4 显式 sessionId 优先于默认值", u)
}

// ═══════ B. 真调用 gate：第 2 页入口不再被挡死 ═══════
console.log("== B. 真调用 gate：死锁已解 ==")
const BLOCK_HEAD = "    // ★★P4（2026-11-03）· 记忆整理向导（三页 + 进度卡）· 纯函数层 + 常量层"
const BLOCK_END = "    function EventView(props) {"
const i0 = SRC.indexOf(BLOCK_HEAD), i1 = SRC.indexOf(BLOCK_END)
ok(i0 > 0 && i1 > i0, "B0 向导段边界可定位")
const SEG = SRC.slice(i0, i1)
const gctx = { console, T: function (zh) { return String(zh) }, h: function () { return {} } }
vm.createContext(gctx)
vm.runInContext(SEG + NL + "globalThis.__gate = upgradeWizardGoP2GatePre;" + NL + "globalThis.__warn = upgradeWizardGoP2WarnTextPre;", gctx)
const gate = gctx.__gate, warnTxt = gctx.__warn
ok(typeof gate === "function" && typeof warnTxt === "function", "B0b 两个纯函数可从真实源码加载并导出")

const ROW_OK = { wsKey: "ws-a", matchedWsKey: "ws-a" }
const ROW_NO = { wsKey: "ws-b", matchedWsKey: null }
const ROW_ABSENT = { wsKey: "ws-c" }

{
  const r = gate("all", [ROW_NO], "")
  ok(r.allow === true && r.warn === "", "B1 scope=all ⇒ 放行且无告警", JSON.stringify(r))
}
{
  const r = gate("current", [ROW_OK, ROW_NO], "ws-a")
  ok(r.allow === true && r.warn === "", "B2 scope=current 且有匹配行 ⇒ 放行且无告警", JSON.stringify(r))
}
{
  const r = gate("current", [ROW_NO], "D:/proj-a")
  ok(r.allow === true, "B3【死锁已解】current 未匹配 ⇒ allow 仍为 true（能进第 2 页改选）", JSON.stringify(r))
  ok(r.warn === "no-current-matched", "B3b 已知 wsNow 但未匹配 ⇒ warn=no-current-matched（事实判定）", JSON.stringify(r))
}
{
  const r = gate("current", [ROW_NO, ROW_ABSENT], "")
  ok(r.allow === true && r.warn === "no-current-unresolved", "B4 wsNow 为空 ⇒ warn=no-current-unresolved（能力缺口，成因区分）", JSON.stringify(r))
}
{
  const tM = warnTxt("no-current-matched", "D:/proj-a")
  const tU = warnTxt("no-current-unresolved", "D:/proj-a")
  ok(tM !== tU, "B5 两种成因文案不同（不混报，语义错位已修）")
  ok(tU.indexOf("无法确定") >= 0, "B5b 解析不到 ⇒ 文案说「无法确定当前工作区」", tU)
  ok(tM.indexOf("没有匹配到") >= 0, "B5c 不在清单 ⇒ 文案说「没有匹配到」", tM)
  ok(tM.indexOf("第 2 页") < 0 && tU.indexOf("第 2 页") < 0, "B6 文案不再指引「去第 2 页」（此刻仍在第 1 页，该指引不可达）")
  ok(tM.indexOf("本页") >= 0 && tU.indexOf("本页") >= 0, "B6b 文案指向「本页」改选（可达出口）")
}
{
  const r = gate("", [ROW_NO], "D:/proj-a")
  ok(r.allow === true && r.warn === "", "B7 空 scope 不误报（非 current 分支直接放行）", JSON.stringify(r))
  const r2 = gate("current", null, "")
  ok(r2.allow === true && r2.warn === "no-current-unresolved", "B8 清单为 null 不抛错且归为 unresolved", JSON.stringify(r2))
}

// ═══════ C. 接线结构守卫 ═══════
console.log("== C. 接线结构守卫 ==")
{
  const gi = SRC.indexOf("var gate = upgradeWizardGoP2GatePre(scope, d.workspaces, wsNow)")
  ok(gi > 0, "C1 onGoP2 调用纯函数 gate")
  const pi = SRC.indexOf("setPage('p2')", gi)
  ok(gi > 0 && pi > gi, "C2 setPage(p2) 在 gate 之后（可达）", "gate@" + gi + " p2@" + pi)
}
{
  // 负路径：旧死锁形态 = 未匹配分支在 setPage(p2) 之前 return
  const ni = SRC.indexOf("if (!c && scope === 'current')")
  ok(ni < 0, "C3 不存在「未匹配 ⇒ 旧内联 return」形态（已改为 gate + 恒放行）", "idx=" + ni)
}
{
  ok(SRC.indexOf("apiGet(API.upgradeWorkspaces, { effort: eff, ws: String(wsNow || '') })") > 0,
     "C4 ensureInventory 请求携带弹窗已知的 ws")
}
{
  ok(IX.indexOf("const _wsExplicit = String((q.get('ws') || '')).trim()") > 0, "C5 后端读取显式 ws 入参")
  ok(IX.indexOf("const _wsNow = _wsExplicit || _wsResolved") > 0, "C6 显式 ws 优先、否则回落到会话解析结果")
}
{
  // 附带观察：工作区总览的「已发现」必须诚实标注取样上限（两处标签都要改 = 防半修）
  const lim = (SRC.split("data.sampleLimit").length - 1)
  ok(lim >= 2, "C7 两处「已发现工作区」标签都接了 sampleLimit（防半修）", "hits=" + lim)
  ok(IX.indexOf("sampleLimit: 8, discoveredTotal:") > 0, "C8 后端 payload 给出 sampleLimit 与 discoveredTotal")
}

// ═══════ D. 变异反向验证 ═══════
console.log("== D. 变异反向验证 ==")
{
  const mutated = APIGET_SRC.replace(" || path === API.upgradeWorkspaces", "")
  ok(mutated !== APIGET_SRC, "D1 [变异] 白名单删除动作确实生效")
  const u = await runApiGet(mutated, APIX.upgradeWorkspaces, { effort: "m" }, "SID-abc")
  ok(u.indexOf("sessionId=") < 0, "D2 [变异] 删掉 upgradeWorkspaces ⇒ 请求不再带 sessionId（A1 会红）", u)
  const u2 = await runApiGet(APIGET_SRC, APIX.upgradeWorkspaces, { effort: "m" }, "SID-abc")
  ok(u2.indexOf("sessionId=") >= 0, "D3 [还原] 原源码仍带 sessionId（A1 有区分力）", u2)
}
{
  const OLD_RET = "      return { allow: true, warn: ws ? 'no-current-matched' : 'no-current-unresolved' }"
  const mutGate = SEG.replace(OLD_RET, OLD_RET.replace("allow: true", "allow: false"))
  ok(mutGate !== SEG, "D4a [变异] gate 改动动作生效")
  const mctx = { console, T: function (zh) { return String(zh) }, h: function () { return {} } }
  vm.createContext(mctx)
  vm.runInContext(mutGate + NL + "globalThis.__g = upgradeWizardGoP2GatePre;", mctx)
  const mr = mctx.__g("current", [ROW_NO], "D:/proj-a")
  ok(mr.allow === false, "D5 [变异] 灌回旧行为 allow:false ⇒ B3 的 allow 断言会红", JSON.stringify(mr))
  ok(gate("current", [ROW_NO], "D:/proj-a").allow === true, "D6 [还原] 原实现 allow 为 true（B3 有区分力）")
}

console.log("")
console.log("[issue578] " + pass + " PASS / " + fail + " FAIL")
process.exit(fail === 0 ? 0 : 1)
