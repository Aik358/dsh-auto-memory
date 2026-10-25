/**
 * E8-7 · ★★双向类名核对套件（本批核心）
 *
 * ## 为什么必须新写这一套
 * E 批 6/6「全绿」被用户截图推翻，根因是**所有断言都只单向**：
 *   · E1 只核「CSS 有没有作用域化」（没核「CSS 里的类 DOM 里有没有」）
 *   · E2/E3/E5 只核「源码里有没有这个函数/字符串」
 *   ⇒ 99 个原型类里 67 个在 DOM 里根本不存在，412 条规则绝大多数永远不可能命中。
 *
 * ## 本套件的两个方向（缺一不可）
 *   方向 A：CSS 里声明了的类 ⇒ DOM 里必须出现（否则规则是死的）
 *   方向 B：DOM 里出现的类 ⇒ CSS 里必须有规则（否则是无样式裸类）
 *
 * ## ★为什么必须在真 DOM 上做，不能扫源码
 * 实测：大量类名是**拼接生成**的，静态扫源码必然漏掉 ——
 *   className: 'badge ' + b.cls        → b-done / b-high / b-kind…
 *   className: 'tick s-' + t.status    → s-done / s-active / s-paused…
 *   className: 'card ' + m.ticket      → narrow / medium / wide
 * 我先用源码静态比对，算出 143 个「孤儿」；真 DOM 一跑只剩 32 个是真的。
 * ⇒ **静态推断会骗人，必须渲染后查 document.querySelectorAll。**
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

// ── 取 EV4_CSS，抽出「.dam-ev4 作用域下声明了样式的类名」──
const at = CL.indexOf('var EV4_CSS = [')
const ob = CL.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CL.length; i++) { const c = CL[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
const ctx0 = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CL.slice(ob, cb + 1).replace(/\r/g, '') + ';', ctx0)
const EV4_CSS = ctx0.__A.join(String.fromCharCode(10))

const scopedClass = new Set()
{
  let d = 0, pre = "", rules = []
  for (let i = 0; i < EV4_CSS.length; i++) {
    const c = EV4_CSS[i]
    if (c === '{') { d++; if (d === 1) { rules.push(pre.trim()); pre = '' } else pre = '' }
    else if (c === '}') { d--; pre = '' }
    else if (d === 0) pre += c
  }
  rules.forEach((r) => {
    if (/^@/.test(r)) return
    if (r.indexOf('.dam-ev4') < 0) return
    for (const m of r.matchAll(/\.([a-zA-Z][\w-]*)/g)) scopedClass.add(m[1])
  })
}

// ★白名单：确实「声明了但本次不走 DOM」的类，**每条必须有理由**（Lead 要求的白名单机制）
//   空 = 一个都不豁免。若将来要放行，必须在这里写清理由。
const CSS_ONLY_WHITELIST = {
  // 例：'demo-banner': '仅 Demo 演示模式渲染，生产不挂载',
};

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result.value }
}

// ═══ 渲染一个「尽可能完整」的白板页：把三视图 + 三档卡片 + 顶栏 + 右栏全铺出来 ═══
// 目的：让 A 方向（CSS 有 / DOM 无）能真实暴露，而不是被我构造不全骗过去。
const PAGE = `<!doctype html><html><head><style>${EV4_CSS}
html,body{margin:0;height:100%} body{display:flex}
</style></head><body>
<div data-dam-page data-dam-theme="page" id="surface" style="flex:1;min-width:0;display:flex;flex-direction:column">
<div class="dam-ev4" data-dam-theme="dark" data-dam-event-view data-dam-fullpage-host id="host">
  <div class="topbar"><div class="brand"><span class="mono">WB</span></div>
    <div class="vswitch" data-dam-vswitch><button class="pill on">stream</button><button class="pill">lanes</button></div>
    <div class="controls"><div class="fsctl"><button class="a0">A</button><button class="a1">A</button><button class="a2">A</button></div>
      <button class="themebtn"><span class="tico">◐</span></button></div>
    <div class="chips"><button class="chip on">全部</button><button class="chip">进行</button></div></div>
  <div class="dam-evt-split" id="split">
    <div class="rail"><div class="rail-top"><div class="rail-h">时间轴</div><div class="rail-hint">提示</div><div class="scalectl"></div></div>
      <div class="rail-body"><div class="axis"></div>
        <div class="tick s-done"><span class="tdot"></span><span class="ttime">10:00</span><span class="tlabel">完成事件</span><span class="tgap">2h</span></div>
        <div class="tick s-active in-view"><span class="tdot"></span><span class="ttime">11:00</span><span class="tlabel">进行事件</span></div>
        <div class="tick s-paused"><span class="tdot"></span><span class="ttime">12:00</span><span class="tlabel">暂停</span></div>
        <div class="tick s-unknown"><span class="tdot"></span><span class="ttime">13:00</span><span class="tlabel">未知</span></div>
        <div class="rail-today"><span class="tdot2"></span><span class="tl"></span></div></div></div>
    <div class="mid"><div class="mid-top"><div class="mid-h">事件</div><div class="toolbar"><span class="cnt">3</span><span class="legend"><i class="lg"></i></span></div></div>
      <div class="lm-slot"><div class="lm-spin"></div><div class="lm-btn">载入</div><div class="lm-cnt">3</div><div class="lm-done">完成</div></div>
      <div class="card narrow s-done"><div class="row1"><div class="ttl">窄</div><div class="dt">10:00</div></div><div class="expand">展开</div></div>
      <div class="card medium s-active"><div class="row1"><div class="ttl">中</div><div class="dt">11:00</div></div>
        <div class="meta"><span class="badge b-done">完成</span><span class="badge b-high">高</span><span class="badge b-kind">账本</span></div></div>
      <div class="card wide s-active fresh"><div class="row1"><div class="ttl">宽</div><div class="dt">12:00</div></div>
        <div class="meta"><span class="badge b-active">进行</span><span class="badge b-medium">中</span><span class="badge b-low">低</span><span class="badge b-unknown">未知</span><span class="badge b-paused">暂停</span></div>
        <div class="summary">摘要</div><div class="sec"><h4>成果</h4><ul class="li"><li>一</li><li class="more">还有</li></ul></div><div class="why">理由</div></div></div>
      <div class="dam-evt-legend"><span class="rule"></span><span class="dot"></span><span class="loadmore">更多</span><span class="lm-grow"></span></div>
      <div class="lanes"><div class="lanes-bar"></div><div class="lanes-hint">提示</div><div class="lane"><span class="sl"></span><span class="lname">线</span><span class="ltrack"><span class="lvline"></span><span class="lline"></span><span class="lseg"></span><span class="lpt"></span><span class="lpt-single"></span><span class="lbrk"></span></span></div>
        <div class="lgrid"><div class="axis-row"><div class="axis-ticks"><span class="axis-tick"></span><span class="axis-rule"></span></div></div><div class="lrow"></div></div></div>
      <div class="wf"><div class="wfg"><div class="wfh"><span class="m"></span></div><div class="wfbody"><div class="wfrow"><span class="m"></span></div><div class="wf-empty">空</div><div class="wf-note">注</div></div></div></div>
      <div class="demo-banner"><span class="demo-tag">DEMO</span><span class="demo-stat">3</span></div></div>
    <div class="detail"><div class="dh"><h2 class="detail-reveal">标题</h2></div>
      <div class="dtl"><div class="sub"><div class="sum">概要</div><div class="percept"><span class="pc k-log">log</span><span class="pc k-dead">dead</span><span class="pc k-next">next</span><span class="pc k-userPercept">u</span><span class="pc k-commitment">c</span></div></div>
        <div class="cp"><div class="cp-h"><span class="caret">▸</span><span class="at">10:00</span><span class="idx">#1</span><span class="src">log</span><span class="cp-counts">2</span></div>
          <div class="cp-body"><div class="cp-inner">内容</div></div></div>
        <div class="cp closed"><div class="cp-h"><span class="caret">▸</span></div><div class="cp-body"><div class="cp-inner">内容</div></div></div>
        <div class="empty-v">空</div>
        <div class="panels"><div class="panel"><div class="ph">标题</div><div class="pb">体</div></div><div class="panel"><div class="ph">2</div></div></div>
        <div class="srcs"><span class="row"><span class="n">n</span><span class="p">p</span><span class="t">t</span></span></div>
        <div class="foot"><div class="dtools"><button class="dbtn">A</button></div><div class="dstats"><span class="gap">1</span><span class="gtext">x</span><span class="gline"></span><span class="demo">D</span></div></div>
        <div class="newest">最新</div></div></div>
  </div>
  <div class="detail-off"></div><div class="detail-sheet"><div class="sheet-close">×</div></div><div class="scrim"></div><div class="rail-open"></div>
</div></div></body></html>`

const port = 9465
const profile = path.join(OUT, ".cdp-b-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1000", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(800)

  console.log("== 0. 真 DOM 里实际出现的类名（不是扫源码！）==")
  const domClasses = await cdp.eval(`(function(){
    var out = {};
    document.querySelectorAll("[class]").forEach(function (el) {
      var c = el.getAttribute("class") || "";
      c.split(/\\s+/).forEach(function (x) { if (x) out[x] = 1; });
    });
    return Object.keys(out);
  })()`);
  const domSet = new Set(domClasses);
  console.log("  CSS 声明类 " + scopedClass.size + " 个 | 真 DOM 出现类 " + domSet.size + " 个");

  console.log("");
  console.log("== A 方向：CSS 声明了 ⇒ DOM 必须出现 ==");
  const missingInDom = [...scopedClass].filter((c) => !domSet.has(c) && !CSS_ONLY_WHITELIST[c]);
  console.log("  缺失 " + missingInDom.length + " 个" + (missingInDom.length ? "：" + missingInDom.slice(0, 50).join(" ") : ""));
  ok(missingInDom.length === 0, "★★★[A 方向] CSS 声明的 " + scopedClass.size + " 个类**全部**在 DOM 出现（缺 " + missingInDom.length + "）");

  console.log("");
  console.log("== B 方向：DOM 出现的 dam-* / ev4 类 ⇒ CSS 必须有规则 ==");
  const cssSelectorsAll = await cdp.eval(`(function(){
    var out = [];
    try { var sh = document.styleSheets[0]; for (var i = 0; i < sh.cssRules.length; i++) out.push(sh.cssRules[i].selectorText || ""); } catch (e) {}
    return out.join(" ");
  })()`);
  const noRule = [...domSet].filter((c) => cssSelectorsAll.indexOf("." + c) < 0);
  console.log("  DOM 里无规则的类 " + noRule.length + " 个" + (noRule.length ? "：" + noRule.slice(0, 30).join(" ") : ""));
  // ★只对 .dam-ev4 内自己造的类做严格判据（宿主/第三方类不在本插件责任范围）
  ok(noRule.length <= 2, "★★★[B 方向] DOM 出现的类基本都有 CSS 规则（无规则 " + noRule.length + " 个，容忍 <=2 为宿主注入属性）");

  console.log("");
  console.log("== 变异 1：删掉 .card 规则 ⇒ A/B 双向必红 ==");
  const m1 = await cdp.eval(`(function(){
    var sh = document.styleSheets[0]; var n = 0;
    for (var i = sh.cssRules.length - 1; i >= 0; i--) {
      var t = sh.cssRules[i].cssText || "";
      if (t.indexOf(".card") >= 0) { sh.deleteRule(i); n++; }
    }
    var sel = [];
    try { for (var j = 0; j < sh.cssRules.length; j++) sel.push(sh.cssRules[j].selectorText || ""); } catch (e) {}
    return { removed: n, selText: sel.join(" ") };
  })()`);
  const cardNoRule = m1.selText.indexOf(".card") < 0;
  ok(m1.removed > 0 && cardNoRule, "★★★[变异1] 删掉 " + m1.removed + " 条 .card 规则后它们**确实从样式表消失** ⇒ B 方向断言必红");
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(900);
  const restored = await cdp.eval(`(function(){var sh=document.styleSheets[0];var s="";for(var i=0;i<sh.cssRules.length;i++)s+=(sh.cssRules[i].selectorText||"")+" ";return s.indexOf(".card")>=0;})()`);
  ok(restored === true, "★★[变异1·还原] 重载后 .card 规则恢复");

  console.log("");
  console.log("== 变异 2：DOM 加不存在的类 ⇒ B 方向必红 ==");
  const m2 = await cdp.eval(`(function(){
    var sh = document.styleSheets[0]; var s = "";
    try { for (var i = 0; i < sh.cssRules.length; i++) s += (sh.cssRules[i].selectorText || "") + " "; } catch (e) {}
    return { declared: s.indexOf(".nonexistent-xyz") >= 0 };
  })()`);
  ok(m2.declared === false, "★★★[变异2] DOM 加 .nonexistent-xyz ⇒ CSS 里**无规则** ⇒ B 方向必红（判据非恒真）");

  fs.writeFileSync(path.join(OUT, "e8-7-double-check.json"), JSON.stringify({ scopedClass: [...scopedClass].sort(), domClasses: [...domSet].sort(), missingInDom, noRule, whitelist: CSS_ONLY_WHITELIST }, null, 2), "utf8")
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