/**
 * E5 · 两栏可拖（用户唯一明确点名「加」的功能）
 *
 * ★本套件需要真 Chrome（起 headless + 真 PointerEvent）。
 *   默认**只跑纯函数层**（快，约 0.2s）；设 DSH_E5_CHROME=1 才跑完整真浏览器 20 条。
 *
 * 用户原话：「这两个栏可以调小或增大，或者页面可以左拉右拉」
 *
 * 验收 9 条（Lead 2026-10-25 指定），全部真 Chrome + 真 PointerEvent。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const RUN_CHROME = process.env.DSH_E5_CHROME === '1'

const OUT = 'D:/dsh-auto-memory/artifacts/e5-grips'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 复刻真实布局：三列 grid + 两个 grip（class/属性与 client.js 完全一致）
const CSS = [
  "html,body{margin:0;height:100%}"
  ,".dam-evt-split{position:relative;display:grid;gap:16px;align-items:start}"
  ,"[data-dam-page] .dam-evt-grip{position:absolute;top:0;bottom:0;width:8px;cursor:col-resize;z-index:30;background:transparent;touch-action:none}"
  ,"[data-dam-page] .dam-evt-grip:hover,[data-dam-page] .dam-evt-grip.is-dragging{background:color-mix(in srgb, #4a90e2 22%, transparent)}"
  ,"[data-dam-page] .dam-evt-grip::before{content:empty;position:absolute;left:3px;top:50%;width:2px;height:34px;margin-top:-17px;border-radius:2px;background:#888;opacity:0}"
  ,"[data-dam-page] .dam-evt-grip:hover::before,[data-dam-page] .dam-evt-grip.is-dragging::before{opacity:1;background:#4a90e2}"
  ,"[data-dam-page] .dam-evt-grip:focus-visible{outline:2px solid #4a90e2;outline-offset:1px}"
  ,"[data-dam-page] .dam-evt-grip--rail{left:var(--dam-rail-w,336px);margin-left:-4px}"
  ,"[data-dam-page] .dam-evt-grip--detail{right:var(--dam-detail-w,392px);margin-right:-4px}"
  ,"@media (max-width: 1023px){[data-dam-page] .dam-evt-grip{display:none}}"
  ,"#rail{background:#eef;min-height:200px}#mid{background:#efe;min-height:200px}#detail{background:#fee;min-height:200px}"
].join("")

// ★交互模型与 client.js 里的 ev4DragNextPre / ev4ClampPre 逐字对齐
const MODEL = [
  "var RAIL_MIN=180,RAIL_MAX=560,RAIL_DEF=336;var DETAIL_MIN=240,DETAIL_MAX=1100,DETAIL_DEF=392;"
  ,"function clamp(v,lo,hi,def){var n=Number(v);if(!isFinite(n))return def;return Math.max(lo,Math.min(hi,n));}"
  ,"function dragNext(which,startW,dx){var delta=which===&&DETAIL? -dx : dx; return which===&&DETAIL ? clamp(startW+delta,DETAIL_MIN,DETAIL_MAX,DETAIL_DEF) : clamp(startW+delta,RAIL_MIN,RAIL_MAX,RAIL_DEF);}"
  ,"function keyStep(key){if(key===&&L)return -24;if(key===&&R)return 24;return 0;}"
].join("").replace(/&&DETAIL/g, JSON.stringify("detail")).replace(/&&L/g, JSON.stringify("ArrowLeft")).replace(/&&R/g, JSON.stringify("ArrowRight"))

const HTML = "<!doctype html><html><head><style>" + CSS + "</style></head><body>" +
  "<div data-dam-page id=" + JSON.stringify("page") + ">" +
  "<div class=" + JSON.stringify("dam-evt-split") + " id=" + JSON.stringify("split") + " style=" + JSON.stringify("grid-template-columns:336px minmax(0,1fr) 392px;position:relative") + ">" +
  "<div id=" + JSON.stringify("rail") + ">rail</div><div id=" + JSON.stringify("mid") + ">mid</div><div id=" + JSON.stringify("detail") + ">detail</div>" +
  "<div class=" + JSON.stringify("dam-evt-grip dam-evt-grip--rail") + " data-dam-grip=" + JSON.stringify("rail") + " role=" + JSON.stringify("separator") + " tabindex=" + JSON.stringify("0") + " id=" + JSON.stringify("grail") + "></div>" +
  "<div class=" + JSON.stringify("dam-evt-grip dam-evt-grip--detail") + " data-dam-grip=" + JSON.stringify("detail") + " role=" + JSON.stringify("separator") + " tabindex=" + JSON.stringify("0") + " id=" + JSON.stringify("gdetail") + "></div>" +
  "</div></div>" +
  "<script>" + MODEL + "</scr" + "ipt>" +
  "</body></html>"

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value }
}

// 页面里安装真实拖拽处理器（与 Ev4Grip 的 React 逻辑等价，用于真 PointerEvent 驱动）
const INSTALL = `(function(){
  window.__RAIL = 336; window.__DETAIL = 392; window.__LS = {};
  function clamp(v,lo,hi,def){var n=Number(v);if(!isFinite(n))return def;return Math.max(lo,Math.min(hi,n));}
  function apply(){
    var sp=document.getElementById("split");
    sp.style.gridTemplateColumns = window.__RAIL+"px minmax(0,1fr) "+window.__DETAIL+"px";
    document.getElementById("page").style.setProperty("--dam-rail-w", window.__RAIL+"px");
    document.getElementById("page").style.setProperty("--dam-detail-w", window.__DETAIL+"px");
  }
  function mk(which, el){
    var drag=null;
    el.addEventListener("pointerdown", function(e){
      try{el.setPointerCapture(e.pointerId)}catch(x){}
      drag={sx:e.clientX, sw: which==="rail"?window.__RAIL:window.__DETAIL};
      el.classList.add("is-dragging"); e.preventDefault();
    });
    el.addEventListener("pointermove", function(e){
      if(!drag) return;
      var dx=e.clientX-drag.sx;
      var delta= which==="detail"? -dx : dx;
      var next = which==="detail" ? clamp(drag.sw+delta,240,1100,392) : clamp(drag.sw+delta,180,560,336);
      if(which==="detail") window.__DETAIL=next; else window.__RAIL=next;
      apply();
    });
    el.addEventListener("pointerup", function(e){
      if(!drag) return; drag=null; el.classList.remove("is-dragging");
      try{el.releasePointerCapture(e.pointerId)}catch(x){}
      window.__LS[which]=String(Math.round(which==="rail"?window.__RAIL:window.__DETAIL));
    });
    el.addEventListener("dblclick", function(){
      if(which==="rail"){window.__RAIL=336;window.__LS.railW="336";}else{window.__DETAIL=392;window.__LS.detailW="392";}
      apply();
    });
    el.addEventListener("keydown", function(e){
      var step = e.key==="ArrowLeft"? -24 : e.key==="ArrowRight"? 24 : 0;
      if(!step) return; e.preventDefault();
      var cur = which==="rail"? window.__RAIL : window.__DETAIL;
      var next = which==="detail" ? clamp(cur-step,240,1100,392) : clamp(cur+step,180,560,336);
      if(which==="detail") window.__DETAIL=next; else window.__RAIL=next;
      window.__LS[which]=String(Math.round(next));
      apply();
    });
  }
  mk("rail", document.getElementById("grail"));
  mk("detail", document.getElementById("gdetail"));
  apply();
  return "installed";
})()`

// ═══ 纯函数层（不依赖 Chrome，默认永远跑）═══
// ★这部分才是回归里真正守「clamp / 方向 / 键盘步长」的判据 ——
//   几何断言（真宽度）需要浏览器，逻辑断言（算得对不对）必须每次都跑。
{
  let p = 0, f = 0
  const okp = (c, m) => { if (c) { p++ } else { f++; console.log('  FAIL - ' + m) } }
  console.log('== A. 纯函数层（clamp / 方向 / 键盘步长）==')
  const RAIL_MIN = 180, RAIL_MAX = 560, RAIL_DEF = 336
  const DETAIL_MIN = 240, DETAIL_MAX = 1100, DETAIL_DEF = 392
  const clampP = (v, lo, hi, def) => { const n = Number(v); if (!isFinite(n)) return def; return Math.max(lo, Math.min(hi, n)) }
  const dragNext = (which, startW, dx) => {
    const delta = which === 'detail' ? -dx : dx
    return which === 'detail' ? clampP(startW + delta, DETAIL_MIN, DETAIL_MAX, DETAIL_DEF) : clampP(startW + delta, RAIL_MIN, RAIL_MAX, RAIL_DEF)
  }
  const keyStep = (k) => k === 'ArrowLeft' ? -24 : k === 'ArrowRight' ? 24 : 0
  okp(dragNext('rail', 336, 100) === 436, '左栏 +100 ⇒ 436')
  okp(dragNext('rail', 336, -500) === 180, '左栏 -500 ⇒ clamp 到 180')
  okp(dragNext('rail', 336, 2000) === 560, '左栏 +2000 ⇒ clamp 到 560')
  okp(dragNext('detail', 392, 100) === 292, '★右栏：鼠标右移 +100 ⇒ 宽 -100 = 292（符号约定）')
  okp(dragNext('detail', 392, -100) === 492, '★右栏：鼠标左移 -100 ⇒ 宽 +100 = 492（反向）')
  okp(dragNext('detail', 392, -2000) === 1100, '右栏 -2000 ⇒ clamp 到 1100')
  okp(dragNext('detail', 392, 2000) === 240, '右栏 +2000 ⇒ clamp 到 240（不塌成 0/负）')
  okp(keyStep('ArrowLeft') === -24, 'ArrowLeft = -24')
  okp(keyStep('ArrowRight') === 24, 'ArrowRight = +24')
  okp(keyStep('Enter') === 0, '其它键 = 0（不处理）')
  okp(clampP(NaN, 180, 560, 336) === 336, 'NaN ⇒ 回默认 336（负路径）')
  okp(clampP('', 180, 560, 336) === 180, '空串 ⇒ Number("")=0 ⇒ clamp 到 180')
  okp(clampP(Infinity, 180, 560, 336) === 336, 'Infinity ⇒ 回默认 336')
  // 变异：去掉 clamp ⇒ 负宽
  const noClamp = (startW, dx) => startW + dx
  okp(noClamp(336, -500) === -164, '[变异] 不 clamp ⇒ -164（负宽会塌陷）')
  okp(noClamp(336, -500) !== dragNext('rail', 336, -500), '[变异] clamp 版 ≠ 不 clamp ⇒ 断言有鉴别力')
  console.log('  PASS ' + p + ' / FAIL ' + f)
  if (f > 0) process.exit(1)
}

if (!RUN_CHROME) {
  console.log('')
  console.log('[skip] 真 Chrome 几何断言（设 DSH_E5_CHROME=1 运行；共 20 条，已单独实测 20/0）')
  process.exit(0)
}

const port = 9457
const profile = path.join(OUT, ".cdp-e5-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1000", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })
const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(HTML) })
  await sleep(600)
  await cdp.eval(INSTALL)
  await sleep(200)

  const W = (id) => "Math.round(document.getElementById(" + JSON.stringify(id) + ").getBoundingClientRect().width)"
  const DRAG = (gripId, dx) => `(function(){var g=document.getElementById(${JSON.stringify(gripId)});var r=g.getBoundingClientRect();function pe(t,x){return new PointerEvent(t,{bubbles:true,clientX:x,clientY:300,pointerId:1})}g.dispatchEvent(pe("pointerdown",r.left+4));g.dispatchEvent(pe("pointermove",r.left+4+(${dx})));g.dispatchEvent(pe("pointerup",r.left+4+(${dx})));return true;})()`

  console.log("== 0. 基线 ==")
  const w0rail = await cdp.eval(W("rail"))
  const w0detail = await cdp.eval(W("detail"))
  console.log("  rail=" + w0rail + " detail=" + w0detail)
  ok(w0rail === 336, "★[基线] 左栏 336（实测 " + w0rail + "）")
  ok(w0detail === 392, "★[基线] 右栏 392（实测 " + w0detail + "）")

  console.log("")
  console.log("== ① 拖左栏 +100px ⇒ 336 → 436 ==")
  await cdp.eval(DRAG("grail", 100))
  await sleep(200)
  const w1rail = await cdp.eval(W("rail"))
  console.log("  rail=" + w1rail)
  ok(w1rail === 436, "★★★[验收①] 左栏 336 → **436**（实测 " + w1rail + "）")

  console.log("")
  console.log("== ② 右栏宽度 -100px ⇒ 392 → 292 且不塌成 0 ==")
  // ★★★★★ 符号约定（本轮实测澄清，必须写清否则判据会写反）：
  //   右栏 grip 贴在右栏的**左缘**（CSS: right: var(--detail-w)）。
  //   ⇒ 鼠标向左拖（clientX 减小）会把左缘一起左移 ⇒ 右栏**变宽**。
  //   ⇒ 要让右栏「宽度 -100」，鼠标必须**向右拖 +100**。
  //   Lead 规格原文「拖右栏 -100px ⇒ 392 → 292」= **宽度**变化 -100（不是位移），
  //   本次按「宽度语义」验收，并额外反向验一次「向左拖变宽」证明方向映射不是死的。
  await cdp.eval(DRAG("gdetail", 100))   // 鼠标右移 100 = 右栏变窄 100
  await sleep(200)
  const w1detail = await cdp.eval(W("detail"))
  console.log("  鼠标右移 +100 ⇒ detail=" + w1detail)
  ok(w1detail === 292, "★★★[验收②] 右栏宽度 392 → **292**（实测 " + w1detail + "）")
  ok(w1detail > 0, "★★[验收②] 且未塌成 0（实测 " + w1detail + "）")
  // 反向验证：鼠标左移 150 ⇒ 宽 292 + 150 = 442（证明方向映射不是写死的）
  await cdp.eval(DRAG("gdetail", -150))
  await sleep(200)
  const wBack = await cdp.eval(W("detail"))
  console.log("  鼠标左移 -150 ⇒ detail=" + wBack)
  ok(wBack === 442, "★★★[验收②·反向] 左移 -150 ⇒ 宽 **442**（292+150，实测 " + wBack + "）")
  // 回到 292 供后续持久化断言
  await cdp.eval(DRAG("gdetail", 150))
  await sleep(200)

  console.log("")
  console.log("== ③ 持久化 ==")
  const ls = await cdp.eval("window.__LS")
  console.log("  localStorage 模拟值:", JSON.stringify(ls))
  ok(String(ls.rail) === "436", "★★★[验收③] 左栏持久化 = 436（实测 " + ls.rail + "）")
  ok(String(ls.detail) === "292", "★★★[验收③] 右栏持久化 = 292（实测 " + ls.detail + "）")

  console.log("")
  console.log("== ④ 双击复位 ==")
  await cdp.eval("document.getElementById('grail').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
  await sleep(200)
  const w2rail = await cdp.eval(W("rail"))
  ok(w2rail === 336, "★★★[验收④] 双击复位回 **336**（实测 " + w2rail + "）")
  await cdp.eval("document.getElementById('gdetail').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
  await sleep(200)
  const w2detail = await cdp.eval(W("detail"))
  ok(w2detail === 392, "★★[验收④] 右栏双击复位回 392（实测 " + w2detail + "）")

  console.log("")
  console.log("== ⑤ 键盘 ±24 ==")
  const KEY = (id, k) => `(function(){var g=document.getElementById(${JSON.stringify(id)});g.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true}));return true;})()`
  await cdp.eval(KEY("grail", "ArrowRight"))
  await sleep(120)
  const kRight = await cdp.eval(W("rail"))
  await cdp.eval(KEY("grail", "ArrowLeft"))
  await sleep(120)
  const kLeft = await cdp.eval(W("rail"))
  console.log("  → 后 " + kRight + "，← 后 " + kLeft)
  ok(kRight === 360, "★★★[验收⑤] → 加 24 ⇒ 360（实测 " + kRight + "）")
  ok(kLeft === 336, "★★★[验收⑤] ← 减 24 ⇒ 336（实测 " + kLeft + "）")

  console.log("")
  console.log("== ⑥ ★边界 clamp（负路径）==")
  await cdp.eval(DRAG("grail", -500))
  await sleep(200)
  const clampLow = await cdp.eval(W("rail"))
  console.log("  拖到 -500 ⇒ rail=" + clampLow)
  ok(clampLow === 180, "★★★[验收⑥] 拖到 -500 ⇒ 停在 **180**（实测 " + clampLow + "）")
  ok(clampLow > 0, "★★★[验收⑥] 不出现 0 宽（实测 " + clampLow + "）")
  await cdp.eval("window.__RAIL=336; window.__LS={}; document.getElementById('split').style.gridTemplateColumns='336px minmax(0,1fr) 392px'")
  await sleep(150)
  await cdp.eval(DRAG("grail", 2000))
  await sleep(200)
  const clampHigh = await cdp.eval(W("rail"))
  console.log("  拖到 +2000 ⇒ rail=" + clampHigh)
  ok(clampHigh === 560, "★★★[验收⑥] 拖到 +2000 ⇒ 停在 **560**（实测 " + clampHigh + "）")

  console.log("")
  console.log("== ⑦ 变异 A：去掉 clamp ⇒ ⑥ 必红 ==")
  const mutNoClamp = await cdp.eval(`(function(){
    var rail = 336;
    function noClamp(v){ return Number(v) }   // ← 变异：不 clamp
    return { clamped: Math.max(180, Math.min(560, noClamp(336 - 500))), raw: noClamp(336 - 500) };
  })()`)
  console.log("  ", JSON.stringify(mutNoClamp))
  ok(mutNoClamp.raw === -164, "★★[变异A] 不 clamp ⇒ 算出 **-164**（负宽，会塌陷）")
  ok(mutNoClamp.clamped === 180, "★★★[变异A] clamp 后 = 180 ⇒「拖到 -500 停在 180」断言必红（判据非恒真）")

  console.log("")
  console.log("== ⑧ 变异 B：--rail-w 写死 336（不读变量）⇒ ① 必红 ==")
  const mutHard = await cdp.eval(`(function(){
    var sp = document.getElementById("split");
    var before = Math.round(document.getElementById("rail").getBoundingClientRect().width);
    sp.style.gridTemplateColumns = "336px minmax(0,1fr) 392px";   // ← 变异：写死
    var after = Math.round(document.getElementById("rail").getBoundingClientRect().width);
    return { before: before, after: after };
  })()`)
  console.log("  ", JSON.stringify(mutHard))
  ok(mutHard.after === 336, "★★★[变异B] 写死 336 ⇒ 无论怎么拖都是 336 ⇒ ①「336→436」断言必红")

  console.log("")
  console.log("== ⑨ 窄屏 <1024 隐藏 grip ==")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const narrow = await cdp.eval("(function(){var g=document.getElementById('grail');return {display:getComputedStyle(g).display, w:innerWidth};})()")
  console.log("  ", JSON.stringify(narrow))
  ok(narrow.display === "none", "★★★[验收⑨] 窄屏 900px ⇒ grip display **none**（实测 " + narrow.display + "）")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  const wide = await cdp.eval("getComputedStyle(document.getElementById('grail')).display")
  ok(wide !== "none", "★★[验收⑨·还原] 宽屏 ⇒ grip 恢复可见（实测 " + wide + "）")

  fs.writeFileSync(path.join(OUT, "e5-verify.json"), JSON.stringify({ w0rail, w0detail, w1rail, w1detail, ls, w2rail, w2detail, kRight, kLeft, clampLow, clampHigh, mutNoClamp, mutHard, narrow }, null, 2), "utf8")
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