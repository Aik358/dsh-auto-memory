/**
 * E6 · 暗色 token（真 Chrome + WCAG 对比度）
 *
 * ## 真缺陷（Lead 实测）
 *   #1f2937 on #151b26 = 1.18:1（门槛 4.5）← 用户说「看不清」的直接原因
 *   原型暗色 #e6eaf1 on #151b26 = 14.3:1
 *
 * ## 本轮查明的事实
 *   原型 §2 的暗色 token **E1 已经整块抄进 EV4_CSS 并作用域化**：
 *   实测 `.dam-ev4[data-theme="dark"]` 块内 **38 个 token**（不止 21 个，含状态色/shadow/edge）。
 *   E5 的根节点也已注入 data-dam-theme="dark"|"light"。
 *   ⇒ E6 的实质 = **验证这套暗色真的生效且不污染全局**，而不是再抄一遍。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawn } from 'node:child_process'

const OUT = 'D:/dsh-auto-memory/artifacts/e6-dark'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CLIENT = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')

const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

// ── 取真 EV4_CSS ──
const at = CLIENT.indexOf('var EV4_CSS = [')
const ob = CLIENT.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CLIENT.length; i++) { const c = CLIENT[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
const ectx = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CLIENT.slice(ob, cb + 1).replace(/\r/g, '') + ';', ectx)
const EV4_CSS = ectx.__A.join(String.fromCharCode(10))

// ── WCAG 对比度（真公式，自己实现，不引第三方）──
function srgbToLin (c) { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
function relLum (rgb) { return 0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2]) }
function contrast (a, b) { const la = relLum(a), lb = relLum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05) }
function parseRgb (s) { const m = String(s).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null }
function hexToRgb (h) { const m = String(h).replace("#", ""); const f = m.length === 3 ? m.split("").map((c) => c + c).join("") : m; return [parseInt(f.slice(0,2),16), parseInt(f.slice(2,4),16), parseInt(f.slice(4,6),16)] }

console.log("== 0. WCAG 公式自检（用手算样例证明公式对）==")
// 纯黑 vs 纯白 = 21:1（WCAG 理论极值）
ok(Math.abs(contrast([0,0,0],[255,255,255]) - 21) < 0.01, "★★[公式自检] 黑/白 = 21.0（实测 " + contrast([0,0,0],[255,255,255]).toFixed(2) + "）")
// Lead 给的实测样例：原型暗色 #e6eaf1 on #151b26 应为 ~14.3
const leadSample = contrast(hexToRgb("#e6eaf1"), hexToRgb("#151b26"))
console.log("  #e6eaf1 on #151b26 = " + leadSample.toFixed(2) + "（Lead 实测 14.3）")
ok(Math.abs(leadSample - 14.3) < 0.6, "★★★[公式自检] 复现 Lead 的 14.3（实测 " + leadSample.toFixed(2) + "）⇒ 公式与 Lead 同口径")
// Lead 给的反例：#1f2937 on #151b26 应 ~1.18
const badSample = contrast(hexToRgb("#1f2937"), hexToRgb("#151b26"))
console.log("  #1f2937 on #151b26 = " + badSample.toFixed(2) + "（Lead 实测 1.18）")
ok(Math.abs(badSample - 1.18) < 0.15, "★★★[公式自检] 复现 Lead 的 1.18（实测 " + badSample.toFixed(2) + "）")

console.log("")
console.log("== 7. ★21+ 个 token 全在 .dam-ev4[data-theme=dark] 块内 ==")
const darkM = EV4_CSS.match(/\.dam-ev4\[data-theme="dark"\]\{([^}]*)\}/)
ok(!!darkM, "★★[正] 暗色块可定位")
const darkBlock = darkM ? darkM[1] : ""
const darkToks = {}
darkBlock.split(";").forEach((d) => { const t = d.trim(); if (!t.startsWith("--")) return; const i = t.indexOf(":"); if (i < 0) return; darkToks[t.slice(0, i).trim()] = t.slice(i + 1).trim() })
const tokNames = Object.keys(darkToks)
console.log("  dark 块内 token 数:", tokNames.length)
ok(tokNames.length >= 21, "★★★[验收⑦] dark 块内 token >= 21（实测 " + tokNames.length + "）")
const lead21 = ["--bg","--bg2","--card","--card2","--card3","--ink","--ink2","--ink3","--muted","--line","--line2","--line3","--accent","--accent-ink"]
const missing = lead21.filter((k) => !(k in darkToks))
ok(missing.length === 0, "★★★[验收⑦] Lead 点名的 14 个基础 token 全在（缺：" + (missing.join(",") || "无") + "）")
const stateToks = ["--done","--active","--paused","--unknown"]
ok(stateToks.every((k) => k in darkToks), "★★[验收⑦] 4 个状态色全在（done/active/paused/unknown）")
// 逐值核对 Lead 给的 9 个关键值
const exact = { "--bg": "#0a0d14", "--bg2": "#0c111a", "--card": "#151b26", "--card2": "#1a212e", "--card3": "#111722", "--ink": "#e6eaf1", "--ink2": "#b6c0cf", "--ink3": "#929dae", "--muted": "#8794a6", "--line": "#232b39" }
let valMismatch = []
for (const k of Object.keys(exact)) { if (String(darkToks[k]).toLowerCase() !== exact[k]) valMismatch.push(k + "=" + darkToks[k] + "!=" + exact[k]) }
ok(valMismatch.length === 0, "★★★[验收⑦] 10 个关键值与 Lead 规格逐字一致（不符：" + (valMismatch.join("; ") || "无") + "）")

console.log("")
console.log("== 1/2. ★暗色对比度（用盘上真实 token 值算）==")
const dInk = hexToRgb(darkToks["--ink"])
const dCard = hexToRgb(darkToks["--card"])
const dBg = hexToRgb(darkToks["--bg"])
const dInk2 = hexToRgb(darkToks["--ink2"])
const dInk3 = hexToRgb(darkToks["--ink3"])
const dMuted = hexToRgb(darkToks["--muted"])
const cInk = contrast(dInk, dCard)
const cInk2 = contrast(dInk2, dCard)
const cInk3 = contrast(dInk3, dCard)
const cMuted = contrast(dMuted, dCard)
const cInkOnBg = contrast(dInk, dBg)
// ★手算一例（Lead 要求「把比值和手算一例贴出来」）
console.log("")
console.log("  ── 手算样例：--ink #e6eaf1 on --card #151b26 ──")
console.log("  sRGB→线性: R=" + srgbToLin(0xe6).toFixed(6) + " G=" + srgbToLin(0xea).toFixed(6) + " B=" + srgbToLin(0xf1).toFixed(6))
console.log("  L(ink)  = 0.2126*" + srgbToLin(0xe6).toFixed(6) + " + 0.7152*" + srgbToLin(0xea).toFixed(6) + " + 0.0722*" + srgbToLin(0xf1).toFixed(6) + " = " + relLum(dInk).toFixed(6))
console.log("  L(card) = 0.2126*" + srgbToLin(0x15).toFixed(6) + " + 0.7152*" + srgbToLin(0x1b).toFixed(6) + " + 0.0722*" + srgbToLin(0x26).toFixed(6) + " = " + relLum(dCard).toFixed(6))
console.log("  对比度 = (" + relLum(dInk).toFixed(6) + " + 0.05) / (" + relLum(dCard).toFixed(6) + " + 0.05) = " + cInk.toFixed(4) + " : 1")
ok(cInk >= 4.5, "★★★[验收①] --ink on --card = **" + cInk.toFixed(2) + " : 1** >= 4.5")
ok(cInk2 >= 4.5, "★★★[验收②] --ink2 on --card = **" + cInk2.toFixed(2) + " : 1** >= 4.5")
ok(cInk3 >= 4.5, "★★★[验收②] --ink3 on --card = **" + cInk3.toFixed(2) + " : 1** >= 4.5")
ok(cMuted >= 4.5, "★★[验收②] --muted on --card = **" + cMuted.toFixed(2) + " : 1** >= 4.5")
ok(cInkOnBg >= 4.5, "★★[验收②] --ink on --bg = **" + cInkOnBg.toFixed(2) + " : 1** >= 4.5")

console.log("")
console.log("== 3. ★浅色不得被牺牲 ==")
const lightM = EV4_CSS.match(/\.dam-ev4\[data-theme="light"\]\{([^}]*)\}/)
// 浅色是默认（.dam-ev4 根档），不是单独 light 块 —— 从根档取
const rootM = EV4_CSS.match(/\.dam-ev4\{([^}]*)\}/)
const rootBlock = rootM ? rootM[1] : ""
const lightToks = {}
rootBlock.split(";").forEach((d) => { const t = d.trim(); if (!t.startsWith("--")) return; const i = t.indexOf(":"); if (i < 0) return; lightToks[t.slice(0, i).trim()] = t.slice(i + 1).trim() })
console.log("  根档（浅色）token 数:", Object.keys(lightToks).length)
const lInk = hexToRgb(lightToks["--ink"] || "#12161d")
const lCard = hexToRgb(lightToks["--card"] || "#ffffff")
const lInk2 = hexToRgb(lightToks["--ink2"] || "#3f4855")
const lInk3 = hexToRgb(lightToks["--ink3"] || "#59636f")
const lcInk = contrast(lInk, lCard)
const lcInk2 = contrast(lInk2, lCard)
const lcInk3 = contrast(lInk3, lCard)
console.log("  浅色 --ink on --card = " + lcInk.toFixed(2) + " : 1")
ok(lcInk >= 4.5, "★★★[验收③] 浅色 --ink on --card = **" + lcInk.toFixed(2) + " : 1** >= 4.5（没被牺牲）")
ok(lcInk2 >= 4.5, "★★[验收③] 浅色 --ink2 = **" + lcInk2.toFixed(2) + " : 1** >= 4.5")
ok(lcInk3 >= 4.5, "★★[验收③] 浅色 --ink3 = **" + lcInk3.toFixed(2) + " : 1** >= 4.5")
// 变异 A：把 --ink 改回 #1f2937 ⇒ ① 必红
const mutInk = contrast(hexToRgb("#1f2937"), dCard)
console.log("")
console.log("  变异A：--ink 改回 #1f2937 ⇒ " + mutInk.toFixed(2) + " : 1")
ok(mutInk < 4.5, "★★★[验收⑤·变异A] #1f2937 on #151b26 = **" + mutInk.toFixed(2) + " : 1** < 4.5 ⇒ ① 必红（判据非恒真）")

console.log("")
console.log("== 4/6. ★全局 token 零污染（作用域配对验证）==")
// 4: 暗色块必须**全部**以 .dam-ev4 为前缀（没有裸 :root/html/body 的 dark 覆盖）
const bareDark = [...EV4_CSS.matchAll(/(^|[\r\n}])([^\r\n{}]*data-theme="dark"[^\r\n{}]*)\{/g)].map((m) => m[2].trim())
console.log("  含 data-theme=dark 的选择器共 " + bareDark.length + " 个：")
bareDark.forEach((s2) => console.log("    " + s2));
const notScoped = bareDark.filter((s2) => !s2.startsWith(".dam-ev4"))
ok(notScoped.length === 0, "★★★[验收④] 所有 dark 选择器**都以 .dam-ev4 开头**（未作用域：" + (notScoped.join(" | ") || "0 个") + "）")
// 6: 变异 B —— 去掉 .dam-ev4 前缀后，同一个选择器会匹配到宿主 root ⇒ 必然污染
const mutSel = bareDark.length ? bareDark[0].replace(".dam-ev4", "") : ""
ok(mutSel && !mutSel.startsWith(".dam-ev4"), "★★★[验收⑥·变异B] 去掉 .dam-ev4 前缀后选择器 = \"" + mutSel + "\" ⇒ 会匹配全局 root ⇒ 污染成立")

// ★真 Chrome：对比「有无 .dam-ev4 容器」时，宿主 --dam-* 是否被改写
const port = 9459
const profile = path.join(OUT, ".cdp-e6-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1400,900", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })
async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value }
}

const PAGE = "<!doctype html><html><head><style>" +
  ":root{--dam-card-bg:#ffffff;--dam-border:#e5e7eb;--dam-fg:#1f2328;--dam-space-s3:12px}" +
  "body{margin:0;padding:20px}" +
  EV4_CSS +
  "</style></head><body>" +
  "<div id=\"host\">HOST（设置页/团队页样本）</div>" +
  "<div class=\"dam-ev4\" id=\"app\" data-theme=\"dark\" data-dam-theme=\"dark\"><div class=\"card\"><div class=\"ttl\" id=\"ttl\">暗色标题</div></div></div>" +
  "</body></html>"

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(700)

  console.log("");
  console.log("== 5. ★真 Chrome：暗色真的生效 + 全局零污染 ==")
  const SAMPLES = ["--dam-card-bg", "--dam-border", "--dam-fg", "--dam-space-s3", "--dam-radius-md", "--dam-accent"]
  const probe = await cdp.eval("(function(){var out={host:{},app:{}};var hs=getComputedStyle(document.documentElement);var as=getComputedStyle(document.getElementById(\"app\"));var rm=getComputedStyle(document.getElementById(\"host\"));[" + JSON.stringify(SAMPLES) + "].forEach(function(k){out.host[k]=hs.getPropertyValue(k).trim();out.app[k]=as.getPropertyValue(k).trim()});out.hostInline={bg:rm.backgroundColor,color:rm.color,border:rm.borderColor};out.ttl={color:getComputedStyle(document.getElementById(\"ttl\")).color,bg:getComputedStyle(document.getElementById(\"app\")).backgroundColor};return out;})()")
  console.log("  host 全局 --dam-* :", JSON.stringify(probe.host))
  console.log("  .dam-ev4 内 --dam-* :", JSON.stringify(probe.app))
  const same = SAMPLES.every((k) => probe.host[k] === probe.app[k])
  ok(same, "★★★[验收④] 6 个 --dam-* 采样点在「全局」与「.dam-ev4 内」**逐字相同** ⇒ 全局未被改写")
  console.log("  暗色 ttl.color =", probe.ttl.color, "| app.bg =", probe.ttl.bg)
  const realInk = parseRgb(probe.ttl.color)
  const realBg = parseRgb(probe.ttl.bg)
  ok(!!realInk && !!realBg, "★[正] 能取到真实计算色（color=" + probe.ttl.color + " / bg=" + probe.ttl.bg + "）")
  if (realInk && realBg) {
    const realC = contrast(realInk, realBg)
    console.log("  真 Chrome 实测对比度 = " + realC.toFixed(2) + " : 1")
    ok(realC >= 4.5, "★★★[验收①·真浏览器] 暗色 .card .ttl 实测 **" + realC.toFixed(2) + " : 1** >= 4.5")
    ok(realInk[0] > 200 && realInk[1] > 200, "★★[验收①] 暗色正文确实是浅色（rgb " + realInk.join(",") + "）不是 #1f2937")
  }
  // 切浅色：对比度仍达标 + 全局仍不变
  await cdp.eval("document.getElementById(\"app\").setAttribute(\"data-theme\",\"light\")")
  await sleep(200)
  const lightProbe = await cdp.eval("(function(){var out={};var hs=getComputedStyle(document.documentElement);[" + JSON.stringify(SAMPLES) + "].forEach(function(k){out[k]=hs.getPropertyValue(k).trim()});var el=document.getElementById(\"ttl\");var c=getComputedStyle(el);var a=getComputedStyle(document.getElementById(\"app\"));return {toks:out,color:c.color,bg:a.backgroundColor};})()")
  const lInkReal = parseRgb(lightProbe.color), lBgReal = parseRgb(lightProbe.bg)
  console.log("  浅色 ttl.color =", lightProbe.color, "| app.bg =", lightProbe.bg)
  if (lInkReal && lBgReal) {
    const lcReal = contrast(lInkReal, lBgReal)
    console.log("  浅色实测对比度 = " + lcReal.toFixed(2) + " : 1")
    ok(lcReal >= 4.5, "★★★[验收③·真浏览器] 浅色实测 **" + lcReal.toFixed(2) + " : 1** >= 4.5")
    ok(JSON.stringify(lInkReal) !== JSON.stringify(realInk), "★★[验收③] 浅/暗两档颜色真的不同")
  }
  const lightSame = SAMPLES.every((k) => lightProbe.toks[k] === probe.host[k])
  ok(lightSame, "★★★[验收④·浅色档] 全局 --dam-* 仍逐字不变")
  // ★必须切回 dark —— 否则后面的变异 B 会在「浅色档」状态下读基线（本轮实测踩过）。
  await cdp.eval("document.getElementById(\"app\").setAttribute(\"data-theme\",\"dark\")")
  await sleep(200)
  const backDark = await cdp.eval("getComputedStyle(document.getElementById(\"app\")).getPropertyValue(\"--bg\").trim()")

  // ★⑥ 真 Chrome 变异：把 dark 规则脱离 .dam-ev4 ⇒ 污染
  //   ★两个必须踩准的点（本轮各踩一次）：
  //     ① 不能用 --dam-card-bg 做目标 —— 它在 :root 定义，属性选择器盖不动；
  //     ② 变异样式必须挂在**真的带 data-theme 属性的元素**上：documentElement 没有该属性，
  //        所以 [data-theme="dark"] 命中不到它 ⇒ hostTok 空 ⇒ 假红。
  //   正确做法：给 body 也打上 data-theme="dark"，此时「无前缀选择器」会命中 body，
  //   而 .dam-ev4 容器内的值仍由带前缀的那条决定 —— 这正是「污染 vs 不污染」的对照。
  const polluteProbe = await cdp.eval("(function(){" +
    "var appEl=document.getElementById('app');" +
    "var appBefore=getComputedStyle(appEl).getPropertyValue('--bg').trim();" +
    "document.body.setAttribute('data-theme','dark');" +
    "var bodyBefore=getComputedStyle(document.body).getPropertyValue('--bg').trim();" +
    "var st=document.createElement('style');" +
    "st.id='mut-style';" +
    "st.textContent='[data-theme=\"dark\"]{--bg:#deadbe;}';" +
    "document.head.appendChild(st);" +
    "var bodyPolluted=getComputedStyle(document.body).getPropertyValue('--bg').trim();" +
    "var appAfterPollute=getComputedStyle(appEl).getPropertyValue('--bg').trim();" +
    "st.remove();" +
    "document.body.removeAttribute('data-theme');" +
    "var bodyClean=getComputedStyle(document.body).getPropertyValue('--bg').trim();" +
    "return {appBefore:appBefore, bodyBefore:bodyBefore, bodyPolluted:bodyPolluted, appAfterPollute:appAfterPollute, bodyClean:bodyClean};" +
  "})()")
  console.log("  变异B 探测:", JSON.stringify(polluteProbe))
  ok(polluteProbe.appBefore === "#0a0d14", "★★[验收⑥·基线] 变异前 app 内 --bg = #0a0d14（实测 " + polluteProbe.appBefore + "）")
  ok(polluteProbe.bodyBefore === "", "★★[验收⑥·基线] 变异前 body 上 --bg 为空（body 不是 .dam-ev4）")
  ok(polluteProbe.bodyPolluted === "#deadbe", "★★★[验收⑥·变异B] 去掉 .dam-ev4 前缀 ⇒ **body 的 --bg 真被改成 #deadbe**（实测 " + polluteProbe.bodyPolluted + "）⇒ 污染成立")
  ok(polluteProbe.appAfterPollute === "#0a0d14", "★★★[验收⑥·关键] 同一时刻 app 内仍是 #0a0d14 未被污染 ⇒ 这正是 `.dam-ev4` 前缀的作用")
  ok(polluteProbe.bodyClean === "", "★★[验收⑥·还原] 移除变异后 body 恢复（空）")

  fs.writeFileSync(path.join(OUT, "e6-verify.json"), JSON.stringify({ darkToks, lightToks, cInk, cInk2, cInk3, cMuted, cInkOnBg, lcInk, mutInk, leadSample, badSample, notScoped, probe, lightProbe }, null, 2), "utf8")
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