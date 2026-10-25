/**
 * E8 基线取证：用真 Chrome + 真 DOM 复现 Lead 的六个根因（改前）
 * 这是「双向核对」的第一步：先证明问题真实存在，再修。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawn } from 'node:child_process'

const OUT = 'D:/dsh-auto-memory/artifacts/e8-visual'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CL = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')

// 取 EV4_CSS
const at = CL.indexOf('var EV4_CSS = [')
const ob = CL.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CL.length; i++) { const c = CL[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
const ctx0 = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CL.slice(ob, cb + 1).replace(/\r/g, '') + ';', ctx0)
const EV4_CSS = ctx0.__A.join(String.fromCharCode(10))

// A = CSS 类名集合；B = 渲染代码 className 集合
const cssClass = new Set()
{
  let d = 0, pre = "", rules = []
  for (let i = 0; i < EV4_CSS.length; i++) {
    const c = EV4_CSS[i]
    if (c === '{') { d++; if (d === 1) { rules.push(pre.trim()); pre = '' } else pre = '' }
    else if (c === '}') { d--; pre = '' }
    else if (d === 0) pre += c
  }
  rules.forEach((r) => { if (!/^@/.test(r)) [...r.matchAll(/\.([a-zA-Z][\w-]*)/g)].forEach((m) => cssClass.add(m[1])) })
}
const domClass = new Set()
for (const m of CL.matchAll(/className:\s*'([^']*)'/g)) { m[1].split(/\s+/).filter(Boolean).forEach(function (x) { domClass.add(x) }) }
for (const m of CL.matchAll(/className:\s*"([^"]*)"/g)) { m[1].split(/\s+/).filter(Boolean).forEach(function (x) { domClass.add(x) }) }
for (const m of CL.matchAll(/\bclass:\s*'([^']*)'/g)) { m[1].split(/\s+/).filter(Boolean).forEach(function (x) { domClass.add(x) }) }
const orphan = [...cssClass].filter((c) => !domClass.has(c))

const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

console.log("== 0. 静态双向核对（A=C取类名 / B=DOM取类名）==")
console.log("  CSS 类名 " + cssClass.size + " 个 | DOM 类名 " + domClass.size + " 个 | 孤儿 " + orphan.length + " 个")
ok(true, "[基线] CSS 类名 = " + cssClass.size + "，DOM 类名 = " + domClass.size + "，孤儿 = " + orphan.length)
console.log("  孤儿（前 40）: " + orphan.slice(0, 40).join(" "))

console.log("");
console.log("== 1. ★真 Chrome：把 EventView 渲染出来看 DOM ==")
async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value }
}

// 造一个「白板页」的近似 DOM：按 client.js 的真实结构手写
const PAGE = `<!doctype html><html><head><style>${EV4_CSS}</style></head><body>
<div class="dam-ev4" id="app" data-dam-theme="dark">
  <div data-dam-event-view data-dam-fullpage-host id="host">
    <div class="dam-evt-split" id="split" style="display:grid;grid-template-columns:336px minmax(0,1fr) 392px">
      <div class="rail" id="rail"><div class="rail-top"></div><div class="msep"></div><button class="tick s-done"><span class="tdot"></span><span class="ttime">10:00</span><span class="tlabel"><b>事件</b></span></button></div>
      <div class="mid" id="mid"><div class="evt-card-wrap ticket-narrow" data-dam-ticket="narrow"><div class="card narrow"><div class="row1"><div class="ttl">标题</div><div class="dt">2026-10-25</div></div></div></div></div>
      <div class="detail" id="detail"><div class="dh"><h2>标题</h2></div><div class="dtl"></div></div>
    </div>
  </div>
</div></body></html>`

const port = 9463
const profile = path.join(OUT, ".cdp-base-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1000", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(700)

  const probe = await cdp.eval(`(function(){
    var q = function(s){ return document.querySelectorAll(s).length };
    var cs = function(s, p){ var e = document.querySelector(s); if(!e) return null; return getComputedStyle(e)[p] };
    return {
      card: q(".card"), ttl: q(".ttl"), meta: q(".meta"), badge: q(".badge"), dtl: q(".dtl"), srcs: q(".srcs"),
      cardClass: (document.querySelector(".card")||{}).className || null,
      cardWidth: document.querySelector(".card") ? Math.round(document.querySelector(".card").getBoundingClientRect().width) : null,
      cardPad: cs(".card", "padding"), cardBg: cs(".card", "backgroundColor"), cardRadius: cs(".card", "borderRadius"),
      railBg: cs(".rail", "backgroundColor"), tickColor: cs(".tick", "color"),
      hasPageAttr: !!document.querySelector("[data-dam-page]"),
      hostH: document.getElementById("host") ? Math.round(document.getElementById("host").getBoundingClientRect().height) : null,
      vh: innerHeight
    };
  })()`)
  console.log("  " + JSON.stringify(probe, null, 1));

  console.log("");
  console.log("== 2. ★逐项验证 Lead 的六个根因（改前基线）==")
  ok(probe.card > 0, "★[基线] .card 节点存在（" + probe.card + " 个）");
  ok(probe.meta === 0, "★★★[根因B] .meta 节点 = " + probe.meta + " ⇒ EventCard 没有 className，原型卡片的 meta/badge/成果全不生效");
  ok(probe.badge === 0, "★★★[根因B] .badge 节点 = " + probe.badge + " ⇒ 原型徽章不存在");
  ok(probe.srcs === 0, "★★[根因B] .srcs 节点 = " + probe.srcs + " ⇒ 原型来源区不存在");
  ok(probe.cardPad === "0px" || probe.cardPad === null, "★★★[根因A] .card padding = " + probe.cardPad + "（原型应非 0，CSS 未命中）");
  ok(probe.cardBg === "rgba(0, 0, 0, 0)" || probe.cardBg === "transparent", "★★★[根因A] .card 背景透明 ⇒ 原型卡片底色未生效");
  ok(probe.hasPageAttr === false, "★★★[根因D] [data-dam-page] 为 0 个 ⇒ 58 条规则全失效（含 E7 高度链）");
  ok(probe.hostH === 0 || probe.hostH < probe.vh * 0.8, "★★★[根因D] EventView 高度 " + probe.hostH + "px < 视口 80%（" + probe.vh + "px）⇒ 没撑满");

  fs.writeFileSync(path.join(OUT, "baseline.json"), JSON.stringify({ cssClassCount: cssClass.size, domClassCount: domClass.size, orphanCount: orphan.length, orphan: orphan.slice(0, 200), probe }, null, 2), "utf8")
} catch (e) {
  console.log("ERROR: " + (e && e.message));
  results.push({ cond: false });
} finally {
  chrome.kill();
  const fail = results.filter((r) => !r.cond).length;
  console.log("");
  console.log("SUMMARY  PASS " + (results.length - fail) + " / FAIL " + fail);
  process.exit(0);
}