/**
 * recall-stats S4j 收口 · 真 Chrome 验证「800ms → token 后视觉逐像素不变」
 *
 * 判据：getComputedStyle(.lm-spin).animationDuration === "0.8s"
 * 变异：token 改 100ms ⇒ 变 "0.1s" ⇒ 断言必红
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawn } from 'node:child_process'

const OUT = 'D:/dsh-auto-memory/artifacts/recall-stats-fix'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CLIENT = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')

const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

// 取真 EV4_CSS
const at = CLIENT.indexOf('var EV4_CSS = [')
const ob = CLIENT.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CLIENT.length; i++) { const c = CLIENT[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
const ectx = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CLIENT.slice(ob, cb + 1).replace(/\r/g, '') + ';', ectx)
const EV4_CSS = ectx.__A.join(String.fromCharCode(10))

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value }
}

const PAGE = "<!doctype html><html><head><style>" + EV4_CSS + "</style></head><body>" +
  "<div class=\"dam-ev4\" id=\"app\"><div class=\"lm-spin\" id=\"spin\"></div></div>" +
  "</body></html>"

const port = 9462
const profile = path.join(OUT, ".cdp-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=900,600", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(700)

  console.log("== 1. ★真 Chrome：animationDuration 必须仍是 0.8s ==")
  const probe = await cdp.eval("(function(){var el=document.getElementById(\"spin\");var cs=getComputedStyle(el);return {dur:cs.animationDuration, name:cs.animationName, timing:cs.animationTimingFunction, iter:cs.animationIterationCount, w:Math.round(el.getBoundingClientRect().width), h:Math.round(el.getBoundingClientRect().height)};})()")
  console.log("  ", JSON.stringify(probe))
  ok(probe.dur === "0.8s", "★★★[验收] .lm-spin animationDuration = **0.8s**（实测 " + probe.dur + "）⇒ 视觉逐像素不变")
  ok(probe.name === "ev4-lm-spin", "★★[验收] animationName = ev4-lm-spin（实测 " + probe.name + "）")
  ok(probe.iter === "infinite", "★★[验收] iterationCount = infinite（实测 " + probe.iter + "）")
  ok(probe.w === 11 && probe.h === 11, "★★[验收] 尺寸仍 11×11（实测 " + probe.w + "×" + probe.h + "）")

  console.log("")
  console.log("== 2. ★变异：token 改 100ms ⇒ 必红 ==")
  const mutCss = EV4_CSS.replace(/--ev4-dur-spin:\s*800ms/, "--ev4-dur-spin:100ms")
  ok(mutCss !== EV4_CSS, "[变异] 成功把 token 改成 100ms")
  await cdp.eval("(function(){var s=document.createElement(\"style\");s.id=\"mut\";s.textContent=" + JSON.stringify(mutCss) + ";document.head.appendChild(s);})()")
  await sleep(300)
  const mutProbe = await cdp.eval("(function(){var cs=getComputedStyle(document.getElementById(\"spin\"));return {dur:cs.animationDuration};})()")
  console.log("  变异后:", JSON.stringify(mutProbe))
  ok(mutProbe.dur === "0.1s", "★★★[变异] token 改 100ms ⇒ animationDuration 变 **0.1s**（实测 " + mutProbe.dur + "）⇒ 「必须 0.8s」断言必红（判据非恒真）")
  await cdp.eval("var m=document.getElementById(\"mut\"); if(m) m.remove()")
  await sleep(200)
  const afterProbe = await cdp.eval("getComputedStyle(document.getElementById(\"spin\")).animationDuration")
  ok(afterProbe === "0.8s", "★★[还原] 移除变异后恢复 0.8s（实测 " + afterProbe + "）")

  fs.writeFileSync(path.join(OUT, "s4j-verify.json"), JSON.stringify({ probe, mutProbe, afterProbe }, null, 2), "utf8")
} catch (e) {
  console.log("ERROR: " + (e && e.message))
  results.push({ cond: false });
} finally {
  chrome.kill();
  const fail = results.filter((r) => !r.cond).length;
  console.log("");
  console.log("SUMMARY  PASS " + (results.length - fail) + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
}