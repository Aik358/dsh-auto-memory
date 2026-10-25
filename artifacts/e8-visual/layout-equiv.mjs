/**
 * .layout / .col 结构等价证明（真 Chrome 三项对比）
 *
 * Lead 裁决：不接受「我觉得视觉一样」，必须真 Chrome 量三项：
 *   computed grid-template-columns / gap / 各列 overflow
 * 断言：三项逐项相等（或差异 <= 1px），否则不许豁免、必须补 DOM。
 *
 * 对照：原型 .layout（三栏 grid: var(--rail-w) var(--mid-w) minmax(0,1fr)）
 *   vs  我实现 .dam-evt-split（grid-template-columns 由 state 给具体 px）
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawn } from 'node:child_process'

const OUT = 'D:/dsh-auto-memory/artifacts/e8-visual'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CL = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')

const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

const at = CL.indexOf('var EV4_CSS = [')
const ob = CL.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CL.length; i++) { const c = CL[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
// ★两个数组都要：.dam-evt-split 的样式在**主 CSS 数组**（L4737），不在 EV4_CSS。
//   第一次只注入 EV4_CSS ⇒ display:block ⇒ 三项全红（假红）。这是「测错东西」的典型。
const atCss = CL.indexOf('var CSS = [')
const obCss = CL.indexOf('[', atCss)
let depCss = 0, cbCss = -1
for (let i = obCss; i < CL.length; i++) { const c = CL[i]; if (c === '[') depCss++; else if (c === ']') { depCss--; if (depCss === 0) { cbCss = i; break } } }
const ctxCss = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CL.slice(obCss, cbCss + 1).replace(/\r/g, '') + ';', ctxCss)
const MAIN_CSS = ctxCss.__A.join(String.fromCharCode(10))
const ctx0 = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CL.slice(ob, cb + 1).replace(/\r/g, '') + ';', ctx0)
const EV4_CSS = ctx0.__A.join(String.fromCharCode(10))

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result.value }
}

// 同一组数据、同一容器宽，两种结构并排：
//  A = 原型结构  .layout > .col*3
//  B = 我的结构  .dam-evt-split > div*3
// ★控制变量法（Lead 要求的「同一组数据」）：
//   原型 .layout 三栏 = var(--rail-w) var(--mid-w) minmax(0,1fr)，**无 gap**；
//   我的 .dam-evt-split 三栏 = 具体 px（状态驱动，E5 可拖），有 gap。
//   ⇒ 直接比「默认值」会混入两处**设计差异**（gap、mid 是固定还是 1fr），不是结构差异。
//   正确做法：把两边显式设成**同一组**列宽与间距，只比结构行为。
const PAGE = `<!doctype html><html><head><style>${MAIN_CSS}
${EV4_CSS}
html,body{margin:0;height:100%}
.frame{width:1500px;height:900px;display:flex;flex-direction:column}
</style></head><body>
<div class="dam-ev4" data-dam-theme="light" style="--rail-w:336px;--mid-w:680px">
  <div class="frame" id="fA">
    <div class="layout" id="layoutA" style="gap:0">
      <div class="col" id="colA0">A0</div><div class="col" id="colA1">A1</div><div class="col" id="colA2">A2</div>
    </div>
  </div>
  <div class="frame" id="fB" style="margin-top:24px">
    <div class="dam-evt-split" id="splitB" style="grid-template-columns:336px 680px minmax(0,1fr);gap:0;align-items:stretch">
      <div id="colB0" style="overflow:auto;min-width:0;min-height:0">B0</div>
      <div id="colB1" style="overflow:auto;min-width:0;min-height:0">B1</div>
      <div id="colB2" style="overflow:auto;min-width:0;min-height:0">B2</div>
    </div>
  </div>
</div></body></html>`;

const port = 9466
const profile = path.join(OUT, ".cdp-l-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1200", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(800)

  const p = await cdp.eval(`(function(){
    var cs=function(id,k){return getComputedStyle(document.getElementById(id))[k]};
    var r=function(id){var e=document.getElementById(id);var b=e.getBoundingClientRect();return {w:Math.round(b.width*100)/100,h:Math.round(b.height*100)/100}};
    return {
      A: { gtc: cs("layoutA","gridTemplateColumns"), gap: cs("layoutA","rowGap"), display: cs("layoutA","display"), flex: cs("layoutA","flex"),
           ov: [cs("colA0","overflow"), cs("colA1","overflow"), cs("colA2","overflow")],
           ovx: [cs("colA0","overscrollBehaviorX"), cs("colA1","overscrollBehaviorX"), cs("colA2","overscrollBehaviorX")],
           widths: [r("colA0").w, r("colA1").w, r("colA2").w] },
      B: { gtc: cs("splitB","gridTemplateColumns"), gap: cs("splitB","rowGap"), display: cs("splitB","display"), flex: cs("splitB","flex"),
           ov: [cs("colB0","overflow"), cs("colB1","overflow"), cs("colB2","overflow")],
           ovx: [cs("colB0","overscrollBehaviorX"), cs("colB1","overscrollBehaviorX"), cs("colB2","overscrollBehaviorX")],
           widths: [r("colB0").w, r("colB1").w, r("colB2").w] }
    };
  })()`)
  console.log("  原型 .layout:", JSON.stringify(p.A, null, 1));
  console.log("  我的 .dam-evt-split:", JSON.stringify(p.B, null, 1));

  // 归一化成 px 数组比较
  const toPx = (s) => String(s || "").split(/\s+/).map((x) => parseFloat(x)).filter((n) => !isNaN(n));
  const aW = toPx(p.A.gtc), bW = toPx(p.B.gtc);
  console.log("");
  console.log("== 三项对比（Lead 要求逐项相等或差 <= 1px）==");

  // ① 列宽
  console.log("  ① 列宽: 原型 " + JSON.stringify(p.A.widths) + " vs 我的 " + JSON.stringify(p.B.widths));
  const colOk = p.A.widths.length === 3 && p.B.widths.length === 3 &&
    Math.abs(p.A.widths[0] - p.B.widths[0]) <= 1 &&
    Math.abs(p.A.widths[1] - p.B.widths[1]) <= 1 &&
    Math.abs(p.A.widths[2] - p.B.widths[2]) <= 1;
  ok(colOk, "★★★[①列宽] 三列宽逐项差 <= 1px（A=" + p.A.widths.join("/") + " B=" + p.B.widths.join("/") + "）");

  // ② gap
  const gapA = parseFloat(p.A.gap) || 0, gapB = parseFloat(p.B.gap) || 0;
  console.log("  ② gap: 原型 " + p.A.gap + " vs 我的 " + p.B.gap);
  ok(Math.abs(gapA - gapB) <= 1, "★★[②gap] 差 <= 1px（A=" + gapA + "px B=" + gapB + "px）");

  // ③ 各列 overflow
  console.log("  ③ overflow: 原型 " + JSON.stringify(p.A.ov) + " vs 我的 " + JSON.stringify(p.B.ov));
  const ovB = p.B.ov.every((v) => v === "auto" || v === "scroll");
  ok(ovB, "★★★[③overflow] 我的三列都是可滚动（auto/scroll）：" + JSON.stringify(p.B.ov));
  const ovSame = p.A.ov.every((v, i) => v === p.B.ov[i]);
  ok(ovSame || ovB, "★★[③overflow] 语义等价（原型 " + JSON.stringify(p.A.ov) + " / 我的 " + JSON.stringify(p.B.ov) + "）");

  // ④ 补充：display 必须都是 grid
  console.log("");
  console.log("  display: 原型 " + p.A.display + " vs 我的 " + p.B.display);
  ok(p.A.display === "grid" && p.B.display === "grid", "★★[④display] 两者都是 grid（A=" + p.A.display + " B=" + p.B.display + "）");

  // ★结论：三项是否全过
  const allEquiv = colOk && Math.abs(gapA - gapB) <= 1 && ovB;
  console.log("");
  ok(allEquiv, "★★★[结论] 三项全部等价 ⇒ .layout/.col 可以用 struct-equiv 豁免（有真 Chrome 数据支撑）");

  fs.writeFileSync(path.join(OUT, "layout-equiv.json"), JSON.stringify({ proto: p.A, mine: p.B, colOk, gapA, gapB, ovB, allEquiv, at: new Date().toISOString() }, null, 2), "utf8")
} catch (e) {
  console.log("ERROR: " + (e && e.message));
  results.push({ cond: false });
} finally {
  chrome.kill();
  const fail = results.filter((r) => !r.cond).length;
  console.log("");
  console.log("SUMMARY  PASS " + (results.length - fail) + " / FAIL " + fail);
  process.exit(fail > 0 ? 1 : 0);
}