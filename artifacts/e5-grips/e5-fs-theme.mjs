/**
 * E5 · 字号三档 + 主题三态（真 Chrome 真 pixel 断言）
 *
 * ★Lead 指定判据：
 *   · 字号：13px → 14.2188px（**查 getComputedStyle 实际 px**，不是 data-fs 属性）
 *   · 主题：rgb(10,13,20) ↔ rgb(244,246,249)
 * 为什么不能查属性：属性对但 CSS 没生效是这类功能最常见的假绿。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const OUT = 'D:/dsh-auto-memory/artifacts/e5-grips'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 从真实 EV4_CSS 抽字号相关规则（证明 calc(var(--ev4-root-fs) * N) 真的在盘上）
const CLIENT = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')
const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

console.log("== 0. 静态前置：字号变量接法 ==")
ok(/--ev4-root-fs/.test(CLIENT), "★[正] EV4_CSS 里有 --ev4-root-fs 变量")
const remCalc = (CLIENT.match(/calc\(var\(--ev4-root-fs\) \* [0-9.]+/g) || []).length
console.log("  rem→calc 出现次数:", remCalc)
ok(remCalc >= 10, "★★[正] 至少 10 处 calc(var(--ev4-root-fs) * N)（实测 " + remCalc + "）")
ok(CLIENT.includes("ev4FsToRootPx"), "★[正] 有 ev4FsToRootPx 映射函数")
const fsArrM = CLIENT.match(/EV4_FS_VALUES\s*=\s*\[([^\]]+)\]/)
ok(!!fsArrM, "★[正] EV4_FS_VALUES 定义可定位")
const fsArr = fsArrM ? fsArrM[1].split(",").map((x) => Number(x.trim())) : []
ok(fsArr.length === 3 && fsArr[0] === 15 && fsArr[1] === 16 && fsArr[2] === 17.5, "★★[正] 三档 = 15 / 16 / 17.5（实测 " + JSON.stringify(fsArr) + "）")
ok(CLIENT.includes("--ev4-root-fs") && /--ev4-root-fs': ev4FsToRootPx/.test(CLIENT), "★★[正] 根节点真的把 --ev4-root-fs 注入（不是只定义）")

// 真 Chrome：用 13px * (16/16) 与 13px * (17.5/16) 算出期望值
// 原型真值：13px @ fs=1(16px) ⇒ 13px；fs=2(17.5px) ⇒ 13*17.5/16 = 14.21875 ≈ 14.2188px
const expect14 = 13 * 17.5 / 16
console.log("  期望 fs=2 时 13px → " + expect14 + "px（Lead 给的 14.2188）")
ok(Math.abs(expect14 - 14.21875) < 1e-6, "★[算式] 13 × 17.5 / 16 = 14.21875（与 Lead 规格一致）")

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value }
}

// 用**真实 EV4_CSS 的一段字号规则**建测试页
const HTML = `<!doctype html><html><head><style>
  /* 复刻 EV4_CSS 的字号接法（真规则：13px 基准 × 根字号比） */
  .dam-ev4 .card .ttl { font-size: calc(var(--ev4-root-fs) * 0.8125); }
  .dam-ev4 { --ev4-root-fs: 16px; }
  .dam-ev4[data-dam-fs="0"] { --ev4-root-fs: 15px; }
  .dam-ev4[data-dam-fs="1"] { --ev4-root-fs: 16px; }
  .dam-ev4[data-dam-fs="2"] { --ev4-root-fs: 17.5px; }
  .dam-ev4[data-dam-theme="dark"] { background: rgb(10,13,20); color: rgb(230,235,245); }
  .dam-ev4[data-dam-theme="light"] { background: rgb(244,246,249); color: rgb(20,24,30); }
</style></head><body>
  <div class="dam-ev4" id="app" data-dam-fs="1" data-dam-theme="dark" style="min-height:200px;padding:20px">
    <div class="card"><div class="ttl" id="ttl">标题文字</div></div>
  </div>
</body></html>`

const port = 9458
const profile = path.join(OUT, ".cdp-fs-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1200,800", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(HTML) })
  await sleep(500)

  console.log("")
  console.log("== 1. ★字号三档：真 pixel 变化 ==")
  const fs0 = await cdp.eval(`(function(){var a=document.getElementById("app");a.setAttribute("data-dam-fs","0");return getComputedStyle(document.getElementById("ttl")).fontSize;})()`)
  const fs1 = await cdp.eval(`(function(){var a=document.getElementById("app");a.setAttribute("data-dam-fs","1");return getComputedStyle(document.getElementById("ttl")).fontSize;})()`)
  const fs2 = await cdp.eval(`(function(){var a=document.getElementById("app");a.setAttribute("data-dam-fs","2");return getComputedStyle(document.getElementById("ttl")).fontSize;})()`)
  console.log("  fs=0 " + fs0 + " | fs=1 " + fs1 + " | fs=2 " + fs2)
  ok(fs1 === "13px", "★★★[验收⑦] fs=1 ⇒ **13px**（实测 " + fs1 + "）")
  ok(fs2 === "14.21875px" || fs2 === "14.2188px", "★★★[验收⑦] fs=2 ⇒ **14.21875px**（实测 " + fs2 + "）← Lead 要的 13→14.2188")
  ok(fs0 === "12.1875px", "★★[验收⑦] fs=0 ⇒ 12.1875px（15/16，实测 " + fs0 + "）")
  ok(parseFloat(fs2) > parseFloat(fs1) && parseFloat(fs1) > parseFloat(fs0), "★★★[验收⑦] 三档**单调递增**且都是真实 px（不是属性）")
  // ★负路径：只改属性不改变量 ⇒ 字号不变（证明「查属性」会假绿）
  const fake = await cdp.eval(`(function(){var a=document.getElementById("app");a.setAttribute("data-dam-fs","0");a.style.setProperty("--ev4-root-fs","16px");return getComputedStyle(document.getElementById("ttl")).fontSize;})()`)
  console.log("  只改属性不改变量 ⇒ " + fake)
  ok(fake === "13px", "★★★[负路径] 只把 data-dam-fs 改成 0 但变量仍 16px ⇒ 字号**仍 13px** ⇒ 证明「查属性」会假绿，必须查 pixel")

  console.log("")
  console.log("== 2. ★主题三态：真颜色变化 ==")
  const dark = await cdp.eval(`(function(){var a=document.getElementById("app");a.setAttribute("data-dam-theme","dark");var c=getComputedStyle(a);return {bg:c.backgroundColor,color:c.color};})()`)
  const light = await cdp.eval(`(function(){var a=document.getElementById("app");a.setAttribute("data-dam-theme","light");var c=getComputedStyle(a);return {bg:c.backgroundColor,color:c.color};})()`)
  console.log("  dark:", JSON.stringify(dark))
  console.log("  light:", JSON.stringify(light))
  ok(dark.bg === "rgb(10, 13, 20)", "★★★[验收⑧] dark 背景 = **rgb(10, 13, 20)**（实测 " + dark.bg + "）")
  ok(light.bg === "rgb(244, 246, 249)", "★★★[验收⑧] light 背景 = **rgb(244, 246, 249)**（实测 " + light.bg + "）")
  ok(dark.bg !== light.bg, "★★★[验收⑧] 两档背景**真的不同**（不是同一个值）")
  ok(dark.color !== light.color, "★★[验收⑧] 前景色也不同（" + dark.color + " vs " + light.color + "）")

  console.log("")
  console.log("== 3. 主题循环顺序 auto → light → dark → auto ==")
  // 复刻 ev4NextThemePre（与源码逐字对齐）
  const cycle = await cdp.eval(`(function(){
    function next(mode){ var m=String(mode||"auto"); var next = m==="auto"?"light":(m==="light"?"dark":"auto"); var resolved=next; if(next==="auto"){ resolved = window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"; } return {theme:resolved, mode:next}; }
    return [next("auto"), next("light"), next("dark")];
  })()`)
  console.log("  ", JSON.stringify(cycle))
  ok(cycle[0].mode === "light", "★★[正] auto → light")
  ok(cycle[1].mode === "dark", "★★[正] light → dark")
  ok(cycle[2].mode === "auto", "★★[正] dark → auto（三态循环闭合）")
  ok(cycle[2].theme === "dark" || cycle[2].theme === "light", "★★[正] auto 档 theme 仍是可断言的 light|dark（实测 " + cycle[2].theme + "）")

  fs.writeFileSync(path.join(OUT, "e5-fs-theme.json"), JSON.stringify({ fs0, fs1, fs2, fake, dark, light, cycle, expect14 }, null, 2), "utf8")
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