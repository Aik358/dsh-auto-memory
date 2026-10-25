/**
 * E7 · 白板看板全屏铺满（Lead 2026-10-25 指定 · 5 条验收）
 * 真缺陷：surfaces.js fit() 的 querySelector 匹配不到 EventView ⇒ el=null ⇒ fit() 整段 return
 *        ⇒ composer 被隐藏但内容区没撑满（用户实报「太拥挤」）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = 'D:/dsh-auto-memory'
const OUT = ROOT + '/artifacts/e7-fullpage'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SURFACES = fs.readFileSync(ROOT + '/skins/iter5/surfaces.js', 'utf8').replace(/\r\n/g, '\n')
const CLIENT = fs.readFileSync(ROOT + '/lib/client.js', 'utf8').replace(/\r\n/g, '\n')

function extractEffect (src, anchorText) {
  const at = src.indexOf(anchorText)
  if (at < 0) return null
  const start = src.lastIndexOf("useEffect(function () {", at)
  const endMark = "}, [props.kind])"
  const end = src.indexOf(endMark, at) + endMark.length
  return src.slice(start, end)
}
const Q = String.fromCharCode(39);
const DQ = String.fromCharCode(34);

const fitEffectRaw = extractEffect(SURFACES, "var el = boundary.current.querySelector(")
const markEffectRaw = extractEffect(SURFACES, "if (on) document.body.setAttribute(")
const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? '  ok   - ' : '  FAIL - ') + msg) }

console.log("== 0. 结构前置：源文件三处修改都在 ==")
ok(/\[data-dam-kanban-view\],\[data-dam-wbg-wrap\],\[data-dam-fullpage-host\]/.test(SURFACES), "★★[正] surfaces.js querySelector 有**三个**选择器（保留旧两个 + 新增 fullpage-host）")
ok(SURFACES.includes("[data-dam-kanban-view]") && SURFACES.includes("[data-dam-wbg-wrap]"), "★[正] 旧两个选择器都保留")
ok(/['"]data-dam-fullpage-host['"]\s*:\s*[''"]/.test(CLIENT) || CLIENT.includes("data-dam-fullpage-host"), "★★[正] EventView 根节点带 data-dam-fullpage-host marker")
ok(CLIENT.includes("[data-dam-page] [data-dam-fullpage-host] { height: 100%"), "★★[正] 高度链 CSS 存在")
ok(!!fitEffectRaw, "★[正] fit() effect 源码可抽取（" + (fitEffectRaw ? fitEffectRaw.length : 0) + " 字符）")
ok(!!markEffectRaw, "★[正] mark() effect 源码可抽取（" + (markEffectRaw ? markEffectRaw.length : 0) + " 字符）")

// 页面：宿主结构 + 高度链 CSS
const HEIGHT_CSS = [
  "html,body{margin:0;height:100%}",
  "[data-conversation-scroll]{height:800px;overflow:auto;padding:20px 20px 120px}",
  "[data-composer-seat]{height:120px;background:#eee}",
  "[data-composer-card]{height:80px;background:#ddd}",
  "body[data-dam-fullpage] [data-composer-seat],body[data-dam-fullpage] [data-composer-card]{display:none!important;}",
  "body[data-dam-fullpage] [data-conversation-scroll]{padding-bottom:0!important;}",
  "[data-dam-page] [data-dam-fullpage-host] { height: 100%; min-height: 0; display: flex; flex-direction: column; }",
  "[data-dam-page] [data-dam-fullpage-host] > .dam-evt-split { flex: 1; min-height: 0; }",
  "[data-dam-page] [data-dam-fullpage-host] .dam-evt-split > div { min-height: 0; }",
  "[data-dam-page] [data-dam-fullpage-host] .dam-evt-detail { min-height: 0; overflow: auto; }",
  ".dam-evt-split{display:grid;grid-template-columns:336px minmax(0,1fr) 392px;gap:16px;align-items:start}",
].join("")
const PAGE_HTML = "<!doctype html><html><head><style>" + HEIGHT_CSS + "</style></head><body>" +
  "<div data-conversation-scroll id=" + DQ + "scroll" + DQ + ">" +
  "<div data-dam-page id=" + DQ + "page" + DQ + ">" +
  "<div data-dam-event-view data-dam-fullpage-host id=" + DQ + "host" + DQ + ">" +
  "<div class=" + DQ + "dam-evt-split" + DQ + " id=" + DQ + "split" + DQ + ">" +
  "<div id=" + DQ + "rail" + DQ + ">rail</div><div id=" + DQ + "mid" + DQ + ">mid</div><div class=" + DQ + "dam-evt-detail" + DQ + " id=" + DQ + "detail" + DQ + ">detail</div>" +
  "</div></div></div></div>" +
  "<div data-composer-seat id=" + DQ + "seat" + DQ + "><div data-composer-card id=" + DQ + "card" + DQ + "><textarea></textarea></div></div>" +
  "</body></html>"

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 700)); return r.result.value }
}

// 把 effect 源码包成可挂载/卸载的 harness（不用模板字符串，纯拼接）
function buildHarness (effectCode) {
  let body = effectCode
  body = body.replace(/^\s*useEffect\(function \(\) \{/, "")
  body = body.replace(/\},\s*\[props\.kind\]\)\s*$/, "")
  return "(function(){" +
    "var boundary = { current: document.getElementById(" + DQ + "page" + DQ + ") };" +
    "var props = { kind: " + DQ + "page" + DQ + " };" +
    "var cleanup = (function(){" + body + "})();" +
    "window.__CLEANUP = cleanup;" +
    "return { cleanupType: typeof cleanup };" +
  "})()"
}

const port = 9456
const profile = path.join(OUT, ".cdp-e7-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1400,900", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE_HTML) })
  await sleep(700)

  console.log("");
  console.log("== 1. 改前基线：贴满前 EventView 高度 ==");
  const before = await cdp.eval("(function(){ var h=document.getElementById(" + DQ + "host" + DQ + ").getBoundingClientRect().height; return { hostH: Math.round(h), vh: innerHeight, ratio: h/innerHeight, seat: getComputedStyle(document.getElementById(" + DQ + "seat" + DQ + ")).display }; })()")
  console.log("  ", JSON.stringify(before));
  ok(before.ratio < 0.8, "★[基线] 贴满前 host 高度 < 80% 视口（实测 " + Math.round(before.ratio * 100) + "%）⇒ 证明用户抱怨的「拥挤」形态")
  ok(before.seat !== "none", "★[基线] 贴满前 composer 可见");

  console.log("");
  console.log("== 2. ★真执行 fit() effect 源码（新选择器能命中）==");
  const fitHarness = buildHarness(fitEffectRaw);
  const fitRun = await cdp.eval(fitHarness);
  console.log("  ", JSON.stringify(fitRun));
  await sleep(400);
  const afterFit = await cdp.eval("(function(){ var h=document.getElementById(" + DQ + "host" + DQ + ").getBoundingClientRect().height; return { hostH: Math.round(h), vh: innerHeight, ratio: h/innerHeight, inlineH: document.getElementById(" + DQ + "host" + DQ + ").style.height, splitH: Math.round(document.getElementById(" + DQ + "split" + DQ + ").getBoundingClientRect().height) }; })()")
  console.log("  ", JSON.stringify(afterFit));
  ok(afterFit.hostH > 0, "★★[正] fit() 真的给 host 赋了高度（inline " + afterFit.inlineH + "，实测 " + afterFit.hostH + "px）");

  console.log("");
  console.log("== 3. ★验收① composer 隐藏 + 验收② 高度真铺满 ==");
  const markHarness = buildHarness(markEffectRaw);
  const waitTag = async (want, maxMs) => { const t0 = Date.now(); while (Date.now() - t0 < (maxMs || 2500)) { const cur = await cdp.eval("document.body.hasAttribute(" + DQ + "data-dam-fullpage" + DQ + ")"); if (cur === want) return true; await sleep(50) } return false };
  await cdp.eval(markHarness);
  await waitTag(true);
  await sleep(300);
  const full = await cdp.eval("(function(){ var h=document.getElementById(" + DQ + "host" + DQ + ").getBoundingClientRect().height; return { seat: getComputedStyle(document.getElementById(" + DQ + "seat" + DQ + ")).display, card: getComputedStyle(document.getElementById(" + DQ + "card" + DQ + ")).display, hostH: Math.round(h), vh: innerHeight, ratio: h/innerHeight }; })()")
  console.log("  ", JSON.stringify(full));
  ok(full.seat === "none", "★★★[验收①] composer-seat display === none（实测 " + full.seat + "）");
  ok(full.card === "none", "★★★[验收①] composer-card display === none（实测 " + full.card + "）");
  ok(full.ratio >= 0.8, "★★★[验收②] EventView 根节点高度 >= 80% 视口（实测 " + Math.round(full.ratio * 100) + "% = " + full.hostH + "px / " + full.vh + "px）");

  console.log("");
  console.log("== 4. ★验收③ 负路径：卸载 → composer 恢复可见 ==");
  await cdp.eval("if (window.__CLEANUP) window.__CLEANUP()");
  await waitTag(false);
  await sleep(200);
  const restored = await cdp.eval("(function(){ return { tag: document.body.hasAttribute(" + DQ + "data-dam-fullpage" + DQ + "), seat: getComputedStyle(document.getElementById(" + DQ + "seat" + DQ + ")).display, card: getComputedStyle(document.getElementById(" + DQ + "card" + DQ + ")).display }; })()")
  console.log("  ", JSON.stringify(restored));
  ok(restored.tag === false, "★★[验收③] 卸载后 data-dam-fullpage 消失");
  ok(restored.seat !== "none", "★★★[验收③·关键] 卸载后 composer **实际可见**（display=" + restored.seat + "）");
  ok(restored.card !== "none", "★★[验收③] composer-card 实际可见（display=" + restored.card + "）");

  console.log("");
  console.log("== 5. ★验收④ 变异 A：querySelector 改回旧的两个 ⇒ 高度断言必红 ==");
  const mutFit = fitEffectRaw.replace("[data-dam-kanban-view],[data-dam-wbg-wrap],[data-dam-fullpage-host]", "[data-dam-kanban-view],[data-dam-wbg-wrap]");
  ok(mutFit !== fitEffectRaw, "[变异A] 成功把 querySelector 改回旧的两个选择器");
  await cdp.eval("var hh=document.getElementById(" + DQ + "host" + DQ + "); hh.style.height=" + DQ + DQ + "; hh.style.maxHeight=" + DQ + DQ + ";");
  await cdp.eval(buildHarness(mutFit));
  await sleep(300);
  const mutFitResult = await cdp.eval("(function(){ var h=document.getElementById(" + DQ + "host" + DQ + ").getBoundingClientRect().height; return { h: Math.round(h), ratio: h/innerHeight, inlineH: document.getElementById(" + DQ + "host" + DQ + ").style.height }; })()")
  console.log("  变异 A 后:", JSON.stringify(mutFitResult));
  ok(mutFitResult.inlineH === "", "★★[变异A] 改回旧选择器 ⇒ fit() **整段 return，完全没赋高度**");
  ok(mutFitResult.ratio < 0.8, "★★★[变异A] 高度 < 80%（实测 " + Math.round(mutFitResult.ratio * 100) + "%）⇒ **验收② 必红**（判据非恒真）");

  console.log("");
  console.log("== 6. ★验收⑤ 变异 B：删 cleanup 的 mark(false) ⇒ 负路径必红 ==");
  // ★必须**只改 cleanup 里的那一处** —— 全局 replace 会把 mark 定义里的 else 分支也改掉，
//   那样连挂载都不会打标，变异就测不到「卸载」这条路径（本轮实测过这个假变异）。
const CLEANUP_LINE = "return function () { try { io.disconnect() } catch (e) {} mark(false) }";
const mutMark = markEffectRaw.replace(CLEANUP_LINE, "return function () { try { io.disconnect() } catch (e) {} }");
const mutMark2 = markEffectRaw.replace("return function () { mark(false) }", "return function () { }");
const mutMarkFinal = (mutMark !== markEffectRaw) ? mutMark : mutMark2;
  ok(mutMarkFinal !== markEffectRaw, "[变异B] 成功删掉 cleanup 里的 mark(false)");
  await cdp.eval("document.body.removeAttribute(" + DQ + "data-dam-fullpage" + DQ + ")");
  await cdp.eval(buildHarness(mutMarkFinal));
  await waitTag(true);
  await sleep(200);
  await cdp.eval("if (window.__CLEANUP) window.__CLEANUP()");
  await sleep(400);
  const mutMarkResult = await cdp.eval("(function(){ return { tag: document.body.hasAttribute(" + DQ + "data-dam-fullpage" + DQ + "), seat: getComputedStyle(document.getElementById(" + DQ + "seat" + DQ + ")).display }; })()")
  console.log("  变异 B 卸载后:", JSON.stringify(mutMarkResult));
  ok(mutMarkResult.tag === true, "★★★[变异B] 删 mark(false) ⇒ 卸载后标记**仍留着**（" + mutMarkResult.tag + "）⇒ **验收③ 必红**");
  ok(mutMarkResult.seat === "none", "★★[变异B] 且 composer 仍被隐藏 ⇒ 正是「对话页永远打不了字」的事故形态");

  fs.writeFileSync(path.join(OUT, "e7-verify.json"), JSON.stringify({ before, afterFit, full, restored, mutFitResult, mutMarkResult }, null, 2), "utf8");
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