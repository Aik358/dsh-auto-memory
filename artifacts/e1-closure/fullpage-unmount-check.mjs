/**
 * data-dam-fullpage 卸载收口检查（E1 收口条件 · Lead 2026-10-25 指定）
 *
 * ## 为什么这条比浮窗更严重
 * `body[data-dam-fullpage] [data-composer-seat]{display:none!important}` 是**挂在 body 上的全局开关**。
 * 一旦卸载时没摘掉（或 IntersectionObserver 某个时序下没触发 cleanup），
 * **用户在「对话」页签就永远打不了字** —— 比浮窗坏严重得多。
 *
 * ## 判据（Lead 三条）
 * 1. 真 Chrome 正/负路径：挂载 → data-dam-fullpage 出现 → 卸载 → **必须消失**
 * 2. 负路径加强：卸载后 `getComputedStyle(seat).display !== "none"`（查**实际可见性**，不只查属性）
 * 3. 变异：把 cleanup 里的 `mark(false)` 删掉 ⇒ 断言必红
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CLIENT = 'D:/dsh-auto-memory/lib/client.js'
const OUT = 'D:/dsh-auto-memory/artifacts/e1-closure'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 从 client.js 抽出真实的 fullpage effect 源码（含 cleanup），真执行 ──
const src = fs.readFileSync(CLIENT, "utf8").replace(/\r\n/g, "\n")
const anchor = "if (on) document.body.setAttribute('data-dam-fullpage', 'true')"
const aIdx = src.indexOf(anchor)
if (aIdx < 0) { console.error("FATAL: 找不到 fullpage effect 锚点"); process.exit(2) }
// 向前找 useEffect(function () { 起点，向后找 }, [props.kind]) 终点
const effStart = src.lastIndexOf("useEffect(function () {", aIdx)
const effEndMark = "}, [props.kind])"
const effEnd = src.indexOf(effEndMark, aIdx) + effEndMark.length
const effectSrc = src.slice(effStart, effEnd)
console.log("=== 抽出的 effect 源码（" + effectSrc.length + " 字符） ===")
console.log(effectSrc.split("\n").map((l) => "  " + l).join("\n"))

// ── 构造 harness：把 effect 包成「可手工 mount/unmount」 ──
function buildHarness (effectCode, mutate) {
  let code = effectCode
  if (mutate) code = mutate(code)
  return `
(function(){
  var BOUNDARY = document.getElementById("boundary");
  var PROPS = { kind: "page" };
  var useEffect = function (fn, deps) { var r = fn(); window.__EFFECT_LOG = (window.__EFFECT_LOG||[]).concat([{ returned: typeof r }]); return r; };   // 真执行，拿到 cleanup
  var cleanup = null;
  var React = { useRef: function (v) { return { current: v }; } };
  function withRefs() {
    var boundary = { current: BOUNDARY };
    var props = PROPS;
    return ${code}
  }
  // 手工挂载 = 执行 effect 并保存 cleanup
  cleanup = withRefs();
  return {
    mounted: function () { return document.body.hasAttribute("data-dam-fullpage"); },
    unmount: function () { window.__EFFECT_LOG = (window.__EFFECT_LOG||[]).concat([{ unmountCalled: true, cleanupType: typeof cleanup }]); if (typeof cleanup === "function") cleanup(); cleanup = null; },
  };
})()
`
}

const HOST_HTML = `<!doctype html><html><head><style>
  [data-composer-seat]{height:120px;background:#eee}
  [data-composer-card]{height:80px;background:#ddd}
  body[data-dam-fullpage] [data-composer-seat],body[data-dam-fullpage] [data-composer-card]{display:none!important;}
</style></head><body>
  <div id="boundary" style="height:200px;background:#fafafa">surface boundary</div>
  <div data-composer-seat id="seat"><div data-composer-card id="card"><textarea></textarea></div></div>
</body></html>`

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result.value }
}

const port = 9453
const profile = path.join(OUT, ".cdp-fullpage-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1200,800", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })
const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(HOST_HTML) })
  await sleep(700)

  console.log("")
  console.log("== 1. 挂载前基线 ==")
  const base = await cdp.eval("({ tag: document.body.hasAttribute('data-dam-fullpage'), seat: getComputedStyle(document.getElementById('seat')).display })")
  console.log(JSON.stringify(base))
  ok(base.tag === false, "★[基线] 挂载前无 data-dam-fullpage")
  ok(base.seat !== "none", "★[基线] 挂载前 composer 可见（" + base.seat + "）")

  console.log("")
  console.log("== 2. ★真执行 effect 源码 → 挂载 ==")
  const harnessJs = buildHarness(effectSrc, null)
  await cdp.eval("window.__H = " + harnessJs + ";")
  // ★必须等待 IntersectionObserver 的**初始回调**完成 —— 实测它在 observe() 后异步触发两次
  //   （先 isIntersecting=false 再 true，取决于布局时序）。不等就会把「还没稳定」误判成「没生效」。
  //   判据：轮询到 tag 稳定为 true 才继续（最多 2s）。
  const waitStable = async (wantTag, maxMs = 2000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < maxMs) {
      const cur = await cdp.eval("document.body.hasAttribute('data-dam-fullpage')")
      if (cur === wantTag) return { ok: true, ms: Date.now() - t0 }
      await sleep(50)
    }
    return { ok: false, ms: maxMs }
  }
  const st1 = await waitStable(true)
  console.log('  等待挂载稳定 tag=true:', JSON.stringify(st1))
  const mounted = await cdp.eval("(function(){ var h=window.__H; return { tag: h.mounted(), seat: getComputedStyle(document.getElementById('seat')).display }; })()")
  console.log(JSON.stringify(mounted))
  ok(mounted.tag === true, "★★[正] 挂载后 data-dam-fullpage **出现**（" + mounted.tag + "）")
  ok(mounted.seat === "none", "★★[正] 挂载后 composer 实际隐藏（display=" + mounted.seat + "）")

  console.log("")
  console.log("== 3. ★★卸载 → 必须消失（本批核心）==")
  await cdp.eval("window.__H.unmount()")
  const effLog = await cdp.eval("window.__EFFECT_LOG")
  console.log('  effect 日志:', JSON.stringify(effLog))
  const st2 = await waitStable(false)
  console.log('  等待卸载稳定 tag=false:', JSON.stringify(st2))
  await sleep(100)
  const unmounted = await cdp.eval("(function(){ return { tag: document.body.hasAttribute('data-dam-fullpage'), seat: getComputedStyle(document.getElementById('seat')).display, card: getComputedStyle(document.getElementById('card')).display }; })()")
  console.log(JSON.stringify(unmounted))
  ok(unmounted.tag === false, "★★★[负路径·核心] 卸载后 data-dam-fullpage **必须消失**（实测 " + unmounted.tag + "）")
  ok(unmounted.seat !== "none", "★★★[负路径·加强] 卸载后 composer **实际可见**（display=" + unmounted.seat + "）⇒ 不能只查属性")
  ok(unmounted.card !== "none", "★★[负路径·加强] 卸载后 composer-card 实际可见（display=" + unmounted.card + "）")

  console.log("")
  console.log("== 4. ★变异：删掉 cleanup 里的 mark(false) ⇒ 断言必红 ==")
  // 变异：把「mark(false)」从 cleanup 里去掉（只改返回的 cleanup，不改 mark 定义）
  const mutFn = (code) => code.replace("return function () { try { io.disconnect() } catch (e) {} mark(false) }", "return function () { try { io.disconnect() } catch (e) {} }")
  const mutHarness = buildHarness(effectSrc, mutFn)
  ok(mutHarness !== harnessJs, "[变异] 成功删掉 cleanup 里的 mark(false)")
  // 重置 DOM
  await cdp.eval("document.body.removeAttribute('data-dam-fullpage')")
  await cdp.eval("window.__M = " + mutHarness + ";")
  await waitStable(true)
  const mutMounted = await cdp.eval("window.__M.mounted()")
  await cdp.eval("window.__M.unmount()")
  await sleep(400)
  const mutAfter = await cdp.eval("({ tag: document.body.hasAttribute('data-dam-fullpage'), seat: getComputedStyle(document.getElementById('seat')).display })")
  console.log("  变异版：挂载后 tag=" + mutMounted + " / 卸载后 " + JSON.stringify(mutAfter))
  ok(mutMounted === true, "[变异] 变异版挂载仍会打标（说明变异只影响 cleanup）")
  ok(mutAfter.tag === true, "★★[变异] 删掉 mark(false) 后，卸载**仍留着标记**（" + mutAfter.tag + "）⇒「卸载后必须消失」断言必红（判据非恒真）")
  ok(mutAfter.seat === "none", "★★[变异] 且 composer 仍被隐藏（" + mutAfter.seat + "）⇒ 这正是「用户永远打不了字」的真实事故形态")

  console.log("")
  console.log("== 5. 恢复对照：还原版再跑一遍 ==")
  await cdp.eval("document.body.removeAttribute('data-dam-fullpage')")
  await cdp.eval("window.__H2 = " + harnessJs + ";")
  await waitStable(true)
  await cdp.eval("window.__H2.unmount()")
  await waitStable(false)
  const restored = await cdp.eval("({ tag: document.body.hasAttribute('data-dam-fullpage'), seat: getComputedStyle(document.getElementById('seat')).display })")
  ok(restored.tag === false && restored.seat !== "none", "★★[还原] 未变异版卸载后标记消失且 composer 可见 ⇒ 正路径复绿")

  fs.writeFileSync(path.join(OUT, "fullpage-unmount-check.json"), JSON.stringify({ base, mounted, unmounted, mutMounted, mutAfter, restored }, null, 2), "utf8")
} catch (e) {
  console.log("ERROR: " + (e && e.message))
  results.push({ cond: false })
} finally {
  chrome.kill()
  const fail = results.filter((r) => !r.cond).length
  console.log("")
  console.log("SUMMARY  PASS " + (results.length - fail) + " / FAIL " + fail)
  process.exit(fail > 0 ? 1 : 0)
}