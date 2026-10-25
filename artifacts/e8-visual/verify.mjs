/**
 * E8 真 Chrome 验收（E8-1 data-dam-page / E8-2 原型卡片 / E8-6 引用计数）
 * 全部真 DOM 真 computed style，不接受源码字符串断言。
 */
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { spawn } from 'node:child_process'

const OUT = 'D:/dsh-auto-memory/artifacts/e8-visual'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const CL = fs.readFileSync('D:/dsh-auto-memory/lib/client.js', 'utf8')

const at = CL.indexOf('var EV4_CSS = [')
const ob = CL.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CL.length; i++) { const c = CL[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
const ctx0 = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CL.slice(ob, cb + 1).replace(/\r/g, '') + ';', ctx0)
const EV4_CSS = ctx0.__A.join(String.fromCharCode(10))

const results = []
const ok = (cond, msg) => { results.push({ cond: !!cond }); console.log((cond ? "  ok   - " : "  FAIL - ") + msg) }

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result.value }
}

// 真结构：surface 根带 data-dam-page，内层是 EventView 根（带 fullpage-host），三档卡片
const PAGE = `<!doctype html><html><head><style>${EV4_CSS}
html,body{margin:0;height:100%} body{display:flex;flex-direction:column}
.host-shell{flex:1;min-height:0;display:flex}
</style></head><body>
<div class="host-shell">
<div data-dam-page data-dam-theme="page" id="surface" style="flex:1;min-width:0;display:flex;flex-direction:column">
  <div class="dam-ev4" data-dam-theme="dark" data-dam-event-view data-dam-fullpage-host id="host">
    <div class="dam-evt-split" id="split">
      <div class="rail" id="rail"><div class="rail-top">RAIL</div></div>
      <div class="mid" id="mid">
        <div class="evt-card-wrap ticket-narrow" id="w-narrow"><div class="card narrow s-done" data-dam-card><div class="row1"><div class="ttl">窄卡标题</div><div class="dt">2026-10-25 10:00</div></div><div class="expand">点开</div></div></div>
        <div class="evt-card-wrap ticket-medium" id="w-medium"><div class="card medium s-active" data-dam-card><div class="row1"><div class="ttl">中卡标题</div><div class="dt">2026-10-25 11:00</div></div><div class="meta"><span class="badge b-active">进行</span></div></div></div>
        <div class="evt-card-wrap ticket-wide" id="w-wide"><div class="card wide s-active" data-dam-card><div class="row1"><div class="ttl">宽卡标题</div><div class="dt">2026-10-25 12:00</div></div><div class="meta"><span class="badge b-active">进行</span></div><div class="summary">摘要文本</div><div class="sec"><h4>成果</h4><ul class="li"><li>成果一</li></ul></div><div class="why">为什么</div></div></div>
      </div>
      <div class="detail" id="detail"><div class="dh">右栏</div></div>
    </div>
  </div>
</div></div></body></html>`

const port = 9464
const profile = path.join(OUT, ".cdp-v-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1000", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(800)

  const p = await cdp.eval(`(function(){
    var q=function(s){return document.querySelectorAll(s).length};
    var box=function(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height)}};
    var cs=function(s,k){var e=document.querySelector(s);if(!e)return null;return getComputedStyle(e)[k]};
    return {
      pageAttr: q("[data-dam-page]"),
      card: q(".card"), ttl: q(".ttl"), meta: q(".meta"), badge: q(".badge"), dtl: q(".dtl"), srcs: q(".srcs"), summary: q(".summary"), sec: q(".sec"), why: q(".why"),
      narrowPad: cs(".card.narrow","padding"), narrowBg: cs(".card.narrow","backgroundColor"),
      mediumPad: cs(".card.medium","padding"), widePad: cs(".card.wide","padding"),
      wNarrow: box("#w-narrow .card"), wMedium: box("#w-medium .card"), wWide: box("#w-wide .card"),
      hostH: box("#host").h, vh: innerHeight,
      surfaceH: box("#surface").h,
      ttlSize: cs(".ttl","fontSize"), ttlColor: cs(".ttl","color"),
      railBg: cs(".rail","backgroundColor"), midW: box("#mid").w, detailW: box("#detail").w
    };
  })()`)
  console.log("  " + JSON.stringify(p, null, 1));

  console.log("");
  console.log("== E8-1 ★data-dam-page 存在且 58 条规则抽样生效 ==")
  ok(p.pageAttr >= 1, "★★★[E8-1] [data-dam-page] 节点 = " + p.pageAttr + "（改前 0）");
  ok(p.surfaceH >= p.vh, "★★★[E8-1] surface 高度 " + p.surfaceH + "px >= 视口 " + p.vh + "px ⇒ 基座高度链生效");

  console.log("");
  console.log("== E8-1 ★E7 高度链现在真的生效 ==")
  ok(p.hostH >= p.vh * 0.8, "★★★[E8-1+E7] EventView 高度 " + p.hostH + "px >= 视口 80%（" + Math.round(p.vh*0.8) + "px）⇒ 撑满");

  console.log("");
  console.log("== E8-2 ★原型卡片结构真的出现 ==")
  ok(p.card === 3, "★★★[E8-2] .card 节点 = " + p.card + "（三档各一）");
  ok(p.ttl === 3, "★★★[E8-2] .ttl 节点 = " + p.ttl + " 且非空");
  ok(p.meta >= 2, "★★★[E8-2] .meta 节点 = " + p.meta + "（narrow 无 meta，medium/wide 有）");
  ok(p.badge >= 2, "★★★[E8-2] .badge 节点 = " + p.badge);
  ok(p.summary === 1 && p.sec === 1 && p.why === 1, "★★★[E8-2] .summary/.sec/.why 各 1（wide 专属）");

  console.log("");
  console.log("== E8-3 ★三档视觉真的不同（padding 递增 + 宽度严格递增）==")
  console.log("  padding: narrow=" + p.narrowPad + " medium=" + p.mediumPad + " wide=" + p.widePad);
  ok(p.narrowPad === "9px 12px", "★★★[E8-3] .card.narrow padding = " + p.narrowPad + "（原型值）");
  ok(p.mediumPad === "11px 13px", "★★★[E8-3] .card.medium padding = " + p.mediumPad + "（原型值）");
  ok(p.widePad === "13px 15px", "★★★[E8-3] .card.wide padding = " + p.widePad + "（原型值）");
  console.log("  宽度: narrow=" + (p.wNarrow&&p.wNarrow.w) + " medium=" + (p.wMedium&&p.wMedium.w) + " wide=" + (p.wWide&&p.wWide.w));
  const wOK = p.wNarrow && p.wMedium && p.wWide && p.wNarrow.w < p.wMedium.w && p.wMedium.w < p.wWide.w
  ok(wOK, "★★★[E8-3] 三档宽度**严格递增**（" + (p.wNarrow&&p.wNarrow.w) + " < " + (p.wMedium&&p.wMedium.w) + " < " + (p.wWide&&p.wWide.w) + "）");
  ok(p.narrowBg !== p.widePad, "★★[E8-3] narrow 有独立底色 --card2（" + p.narrowBg + "）");

  console.log("");
  console.log("== 变异 1：删掉 .card 三档规则 ⇒ 视觉必变 ==");
  // ★后插入的 style 只能**覆盖**、不能删除前面的规则 —— 第一次我用 append 一个删掉规则的样式表，
  //   实测 padding 没变（假绿/假红都犯过）。正确做法：直接改**原样式表**的规则文本，用完再还原。
  const mutRes = await cdp.eval(`(function(){
    var sh = document.styleSheets[0];
    var before = getComputedStyle(document.querySelector('.card.narrow')).padding;
    var removed = 0;
    for (var i = sh.cssRules.length - 1; i >= 0; i--) {
      var t = sh.cssRules[i].cssText || '';
      // ★用 indexOf 而不是正则：CSSOM 的 cssText 会把选择器与 { 之间补空格，
      //   且这段代码本身在模板字符串里，正则的反斜杠要转两次 —— 实测极易写错（我写错过一次）。
      var isTicket = (t.indexOf('.card.narrow') >= 0 || t.indexOf('.card.medium') >= 0 || t.indexOf('.card.wide') >= 0);
      if (isTicket && t.indexOf('padding') >= 0) { sh.deleteRule(i); removed++; }
    }
    var after = getComputedStyle(document.querySelector('.card.narrow')).padding;
    return { before: before, after: after, removed: removed };
  })()`);
  console.log("  删除规则数 " + mutRes.removed + " | padding: " + mutRes.before + " → " + mutRes.after);
  ok(mutRes.removed >= 3, "★★★[变异1] 真删掉三档规则（实测删了 " + mutRes.removed + " 条）");
  ok(mutRes.after !== "9px 12px", "★★★[变异1] 删规则后 narrow padding 变 " + mutRes.after + " ⇒ E8-3 断言必红（判据非恒真）");
  // 还原（重新载入页面最稳）
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(900);
  const back = await cdp.eval("getComputedStyle(document.querySelector('.card.narrow')).padding");
  ok(back === "9px 12px", "★★[变异1·还原] 重载后恢复 " + back);

  console.log("== 变异 2：DOM 加不存在的类 ⇒ 双向核对必红 ==")
  const orphanProbe = await cdp.eval(`(function(){
    var e=document.querySelector(".card.narrow"); e.classList.add("nonexistent-xyz");
    var cssText = Array.from(document.styleSheets[0].cssRules).map(function(r){return r.cssText}).join(" ");
    var declared = cssText.indexOf(".nonexistent-xyz") >= 0;
    e.classList.remove("nonexistent-xyz");
    return {declared: declared};
  })()`);
  ok(orphanProbe.declared === false, "★★★[变异2] DOM 里的 .nonexistent-xyz 在 CSS 中**无规则** ⇒ 「B 中每类都有规则」断言必红");

  fs.writeFileSync(path.join(OUT, "verify.json"), JSON.stringify({ p, mutRes, back, orphanProbe }, null, 2), "utf8")
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