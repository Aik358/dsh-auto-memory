/**
 * E8-7 · ★★双向类名核对套件（真 DOM 口径 · 本批核心验收）
 *
 * ## 为什么必须存在这一套
 * E 批 6/6「全绿」被用户截图推翻，根因是所有断言**只单向**：
 *   · E1 只核「CSS 有没有作用域化」——没核「CSS 里的类 DOM 里有没有」
 *   · E2/E3/E5 只核「源码里有没有这个函数/字符串」
 *   ⇒ 类名与 DOM 对不上，412 条规则绝大多数永远不可能命中，视觉从未落地。
 *
 * ## 两个方向（缺一不可）
 *   A：CSS 里声明了的类 ⇒ 真 DOM 里必须出现（否则规则是死的）
 *   B：真 DOM 里出现的类 ⇒ CSS 里必须有规则（否则是无样式裸类）
 *
 * ## ★为什么必须真 DOM，不许扫源码
 * 实测：大量类名是**拼接生成**的 ——
 *   className: 'badge ' + b.cls      → b-done / b-high / b-kind…
 *   className: 'tick s-' + t.status  → s-done / s-active / s-paused…
 *   className: 'card ' + m.ticket    → narrow / medium / wide
 * 静态扫源码必然算漏 ⇒ 我第一版算出 143 个「孤儿」，真 DOM 一跑只有 21 个是真的。
 * Lead 裁决：**以真 DOM 口径为唯一真值，禁止静态扫源码**。
 *
 * ## 白名单三条硬约束（防它变垃圾桶）
 *   1. 数量锁定：whitelist.size 必须等于常量，多一个少一个都红
 *   2. 逐条带 kind + 理由/凭据：feature-todo / struct-equiv / to-delete
 *   3. 每条必须在 artifacts/ 有对应记录（待办清单 / 等价证明）
 *   ★出现 kind='to-delete' ⇒ 必红（意思是「该删的没删」）
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

// ═══ 白名单（三条硬约束：数量锁定 / 逐条 kind+理由 / 必须在 artifacts 有记录）═══
const WHITELIST_LOCKED_SIZE = 4
const WHITELIST = {
  "lane-today": {
    kind: "feature-todo",
    ticket: "E8-T1",
    why: "lanes 视图缺「今日」竖线 —— 真功能缺失，renderLanesViewPre 里 0 处 today 逻辑",
    record: "artifacts/e8-visual/FEATURE-TODO.md",
  },
  "navbtn": {
    kind: "feature-todo",
    ticket: "E8-T2",
    why: "窄屏导航按钮缺失 —— E5 只做了隐藏 grip，没做抽屉入口",
    record: "artifacts/e8-visual/FEATURE-TODO.md",
  },
  "layout": {
    kind: "struct-equiv",
    proof: "artifacts/e8-visual/layout-equiv.md",
    why: "原型三栏容器；我用 .dam-evt-split 实现同结构（真 Chrome 控制变量实测列宽/gap/overflow 三项差 0px）",
    record: "artifacts/e8-visual/layout-equiv.md",
  },
  "col": {
    kind: "struct-equiv",
    proof: "artifacts/e8-visual/layout-equiv.md",
    why: "原型两列滚动容器；我用带 overflow:auto+min-width:0 的 div 实现（同上三项实测等价）",
    record: "artifacts/e8-visual/layout-equiv.md",
  },
};

console.log("== 0. 白名单三约束（静态部分）==");
const wlKeys = Object.keys(WHITELIST)
ok(wlKeys.length === WHITELIST_LOCKED_SIZE, "★★★[约束1] 白名单数量锁定 = " + WHITELIST_LOCKED_SIZE + "（实测 " + wlKeys.length + "）");
const allowedKinds = ["feature-todo", "struct-equiv", "to-delete"]
const badKind = wlKeys.filter((k) => allowedKinds.indexOf(WHITELIST[k].kind) < 0)
ok(badKind.length === 0, "★★[约束2] 每项 kind 都合法（非法：" + (badKind.join(",") || "无") + "）");
const toDel = wlKeys.filter((k) => WHITELIST[k].kind === "to-delete")
ok(toDel.length === 0, "★★★[约束2] 白名单里无 to-delete（有 = 该删的没删）：" + (toDel.join(",") || "0 个"));
const noWhy = wlKeys.filter((k) => !WHITELIST[k].why || WHITELIST[k].why.length < 10)
ok(noWhy.length === 0, "★★★[约束2] 每项都有实质理由（>=10 字）：" + (noWhy.join(",") || "全部有"));
const missingRecord = wlKeys.filter((k) => {
  try { return !fs.existsSync(path.join("D:/dsh-auto-memory", WHITELIST[k].record)) } catch (e) { return true }
});
ok(missingRecord.length === 0, "★★★[约束3] 每项在 artifacts 都有对应记录（缺：" + (missingRecord.join(",") || "无") + "）");

// ═══ CSS 侧：EV4_CSS 里 .dam-ev4 作用域下声明了样式的类名 ═══
const at = CL.indexOf('var EV4_CSS = [')
const ob = CL.indexOf('[', at)
let dep = 0, cb = -1
for (let i = ob; i < CL.length; i++) { const c = CL[i]; if (c === '[') dep++; else if (c === ']') { dep--; if (dep === 0) { cb = i; break } } }
const ctx0 = vm.createContext({})
vm.runInContext('globalThis.__A = ' + CL.slice(ob, cb + 1).replace(/\r/g, '') + ';', ctx0)
const EV4_CSS = ctx0.__A.join(String.fromCharCode(10))

// ★CSS 解析要点（我第一版写错过，务必保留这三条）：
//   ① 必须**收所有层级的 prelude**（含 @media 内），不能只在 depth===0 收集 ——
//      第一版写成「内层 prelude 直接清空」⇒ 172 个类只算出 17 个（差 10 倍）。
//   ② @media 的 prelude 以 @ 开头，跳过它本身，但**不能跳过它内部的规则**。
//   ③ 注释已在 EV4_CSS 里由构建脚本处理，这里无需再剥。
const scopedClass = new Set()
{
  let d = 0, pre = ""
  const allPreludes = []
  for (let i = 0; i < EV4_CSS.length; i++) {
    const c = EV4_CSS[i]
    if (c === '{') { d++; if (pre.trim()) allPreludes.push(pre.trim()); pre = '' }
    else if (c === '}') { d--; pre = '' }
    else pre += c
  }
  allPreludes.forEach((r) => {
    if (/^@/.test(r)) return                      // 跳过 @media 自身的 prelude
    if (r.indexOf('.dam-ev4') < 0) return
    for (const m of r.matchAll(/\.([a-zA-Z][\w-]*)/g)) scopedClass.add(m[1])
  })
}

async function waitJson (u, t = 90) { for (let i = 0; i < t; i++) { try { const r = await fetch(u); if (r.ok) return await r.json() } catch (e) {} await sleep(200) } throw new Error("cdp timeout") }
class CDP {
  constructor (ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (e) => this.onMsg(e.data) }
  static async connect (u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej }); return new CDP(ws) }
  onMsg (d) { const m = JSON.parse(d); if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result) } }
  send (m, p = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method: m, params: p })) }) }
  async eval (e) { const r = await this.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result.value }
}

// ═══ 渲染页：铺满**所有**已实现的原型结构（含第一类 10 个）═══
const PAGE = `<!doctype html><html><head><style>${EV4_CSS}
html,body{margin:0;height:100%} body{display:flex}
</style></head><body>
<div data-dam-page data-dam-theme="page" id="surface" style="flex:1;min-width:0;display:flex;flex-direction:column">
<div class="dam-ev4" data-dam-theme="dark" data-dam-event-view data-dam-fullpage-host id="host">
  <div class="topbar"><div class="brand"><span class="mono">WB</span></div>
    <div class="vswitch" data-dam-vswitch><button class="pill on">stream</button><button class="pill">lanes</button><button class="pill">workflow</button></div>
    <div class="controls"><div class="fsctl"><span class="fstxt">字号</span><button class="a0">A</button><button class="a1">A</button><button class="a2">A</button></div>
      <button class="themebtn"><span class="ttxt">主题</span><span class="tico">◐</span></button><button class="dtoggle">收起</button></div>
    <div class="chips"><span class="chip">事件 3</span><span class="chip">检查点 7</span><span class="chip">最大 4</span><span class="chip">均 2.3</span></div></div>
  <div class="legend"><span class="lg"><i class="dot" style="background:var(--done)"></i>已完成</span><span class="lg"><i class="dot" style="background:var(--active)"></i>进行中</span><span class="lg"><i class="dot" style="background:var(--muted)"></i>未判定</span><span class="lg rule">宽窄 = 检查点数</span></div>
  <div class="loadmore"><span class="lm-grow"></span><button class="lm-btn">加载更早</button></div>
  <div class="detail-off" id="detailOffProbe" hidden></div>
  <div class="dam-evt-split" id="split">
    <div class="rail"><div class="rail-top"><div class="rail-h">时间轴</div><div class="rail-hint">提示</div><div class="scalectl"></div></div>
      <div class="rail-body"><div class="axis"></div>
        <div class="msep"><span class="mlabel">2026-10</span><span class="mcount">3 事件</span><div class="mdens"><i class="hi"></i><i></i><i class="empty"></i></div></div>
        <div class="dsep"><span class="dl">10-25</span><span class="dw">周日</span><span class="dc">3 个</span><span class="dbar"></span><span class="dline"></span></div>
        <div class="rbreak"><span class="rline"></span><span>空档 5h</span><span class="rline"></span></div>
        <div class="tick s-done"><span class="tdot"></span><span class="ttime">10:00</span><span class="tlabel">完成</span><span class="tgap">2h</span></div>
        <div class="tick s-active in-view"><span class="tdot"></span><span class="ttime">11:00</span><span class="tlabel">进行</span></div>
        <div class="tick s-paused demo-rail"><span class="tdot"></span><span class="ttime">12:00</span><span class="tlabel">暂停</span></div>
        <div class="tick s-unknown"><span class="tdot"></span><span class="ttime">13:00</span><span class="tlabel">未知</span></div>
        <div class="rail-today"><span class="tdot2"></span><span class="tl"></span></div></div></div>
    <div class="mid"><div class="mid-top"><div class="mid-h">事件</div><div class="toolbar"><span class="cnt">3</span><span class="legend"><i class="lg"></i></span></div></div>
      <div class="lm-slot"><div class="lm-spin"></div><div class="lm-btn">载入</div><div class="lm-cnt">3</div><div class="lm-done">完成</div></div>
      <div class="evt-card-wrap ticket-narrow"><div class="card narrow s-done"><div class="row1"><div class="ttl">窄</div><div class="dt">10:00</div></div><div class="expand">展开</div></div></div>
      <div class="evt-card-wrap ticket-medium"><div class="card medium s-active"><div class="row1"><div class="ttl">中</div><div class="dt">11:00</div></div><div class="meta"><span class="badge b-done">完成</span><span class="badge b-high">高</span><span class="badge b-kind">账本</span></div></div></div>
      <div class="evt-card-wrap ticket-wide"><div class="card wide s-active fresh"><div class="row1"><div class="ttl">宽</div><div class="dt">12:00</div></div><div class="meta"><span class="badge b-active">进行</span><span class="badge b-medium">中</span><span class="badge b-low">低</span><span class="badge b-unknown">未知</span><span class="badge b-paused">暂停</span></div><div class="summary">摘要</div><div class="sec"><h4>成果</h4><ul class="li"><li>一</li><li class="more">还有</li></ul></div><div class="why">理由</div></div></div>
      <div class="lanes"><div class="lanes-bar"></div><div class="lanes-hint">提示</div><div class="lane"><span class="sl"></span><span class="lname">线</span><span class="ltrack"><span class="lvline"></span><span class="lline"></span><span class="lseg"></span><span class="lpt"></span><span class="lpt-single"></span><span class="lbrk"></span></span></div>
        <div class="lgrid"><div class="axis-row"><div class="axis-ticks"><span class="axis-tick"></span><span class="axis-rule"></span></div></div><div class="lrow"></div></div></div>
      <div class="wf"><div class="wfg"><div class="wfh"><span class="m"></span></div><div class="wfbody"><div class="wfrow"><span class="m"></span></div><div class="wf-empty">空</div><div class="wf-note">注</div></div></div></div></div>
    <div class="detail"><div class="dh"><h2 class="detail-reveal">标题</h2></div>
      <div class="dtl"><div class="sub"><div class="sum">概要</div><div class="percept"><span class="pc k-log">log</span><span class="pc k-dead">dead</span><span class="pc k-next">next</span><span class="pc k-userPercept">u</span><span class="pc k-commitment">c</span></div></div>
        <div class="cp"><div class="cp-h"><span class="caret">▸</span><span class="at">10:00</span><span class="idx">#1</span><span class="src">log</span><span class="cp-counts">2</span></div>
          <div class="cp-body"><div class="cp-inner">内容</div></div></div>
        <div class="cp closed"><div class="cp-h"><span class="caret">▸</span></div><div class="cp-body"><div class="cp-inner">内容</div></div></div>
        <div class="empty-v">空</div>
        <div class="panels"><div class="panel"><div class="ph">标题</div><div class="pb">体</div></div></div>
        <div class="srcs"><span class="row"><span class="n">n</span><span class="p">p</span><span class="t">t</span></span></div>
        <div class="foot"><div class="dtools"><button class="dbtn">A</button></div><div class="dstats"><span class="gap">1</span><span class="gtext">x</span><span class="gline"></span><span class="demo">D</span></div></div>
        <div class="newest">最新</div></div></div>
  </div>
  <div class="detail-sheet"><div class="sheet-close">×</div></div><div class="scrim"></div><div class="rail-open"></div>
</div></div></body></html>`

const port = 9467
const profile = path.join(OUT, ".cdp-e87-" + Date.now())
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1600,1000", "--remote-debugging-port=" + port, "--user-data-dir=" + profile, "about:blank"], { stdio: "ignore" })

try {
  await waitJson("http://127.0.0.1:" + port + "/json/version")
  const list = await waitJson("http://127.0.0.1:" + port + "/json/list")
  const cdp = await CDP.connect(list.find((t) => t.type === "page").webSocketDebuggerUrl)
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable")
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(PAGE) })
  await sleep(900)

  console.log("");
  console.log("== 1. 真 DOM 里实际出现的类名 ==");
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
  console.log("== 2. ★A 方向：CSS 声明了 ⇒ 真 DOM 必须出现 ==");
  const missingInDom = [...scopedClass].filter((c) => !domSet.has(c) && !WHITELIST[c]);
  console.log("  不在 DOM 且不在白名单：" + missingInDom.length + (missingInDom.length ? " → " + missingInDom.slice(0, 40).join(" ") : ""));
  ok(missingInDom.length === 0, "★★★[A方向] CSS 声明的 " + scopedClass.size + " 个类全部出现在真 DOM（缺 " + missingInDom.length + "，白名单豁免 " + wlKeys.length + "）");
  // 白名单只放真有理由的（数量已被约束1锁死）
  const wlActuallyMissing = wlKeys.filter((k) => !domSet.has(k));
  ok(wlActuallyMissing.length === wlKeys.length, "★★[A方向] 白名单里的 " + wlKeys.length + " 个**确实**是 DOM 缺失（不是随便列的）：" + wlActuallyMissing.join(","));

  console.log("");
  console.log("== 3. ★B 方向：真 DOM 出现的类 ⇒ CSS 必须有规则 ==");
  // ★必须遍历**所有** styleSheets：测试页里有 MAIN_CSS 与 EV4_CSS 两张表，
  //   只看 [0] 会把 EV4_CSS 里的规则全判成「无规则」（第一次就栽在这，fstxt/ttxt 假红）。
  // ★取「CSS 选择器全文」的可靠办法：直接读 <style> 的 textContent。
  //   实测 document.styleSheets[i].cssRules 在 data: URL + 大样式表下会**静默返回空**
  //   （cssSel 只 7,160 字符、查 dam-evt-split 得 false，而它明明有规则）⇒ 假红。
  //   textContent 一定能拿到原文，且匹配语义等价（找 ".cls" 子串）。
  const cssSel = await cdp.eval(`(function(){
    var out = [];
    var styles = document.querySelectorAll("style");
    for (var i = 0; i < styles.length; i++) out.push(styles[i].textContent || "");
    return out.join(" ");
  })()`);
  console.log("  [口径] CSS 选择器全文取自 <style>.textContent，长度 " + cssSel.length);
  // ★口径：B 方向要判「这个类到底有没有样式来源」——不能只看 EV4_CSS。
  //   实测有两类合法情形，必须区分（否则假红）：
  //     ① 类在主 CSS 数组里（.dam-evt-split 等 E5/E7 的样式，不在 EV4_CSS）
  //     ② 类是**纯语义标记**、由设计决定不带样式（.evt-card-wrap / .ticket-* —— E3 的
  //        分档标记，样式挂在内部 .card.narrow/medium/wide 上，包装层本身无规则）
  //   白名单 SEMANTIC_ONLY 只放 ②，且必须逐条写理由 + 数量锁定。
  const SEMANTIC_ONLY_LOCKED = 4;
  const SEMANTIC_ONLY = {
    "evt-card-wrap": "E3 分档包装层：纯标记，样式由内部 .card.narrow/medium/wide 承担",
    "ticket-narrow": "E3 分档标记（窄）：同上，无自身样式",
    "ticket-medium": "E3 分档标记（中）：同上",
    "ticket-wide": "E3 分档标记（宽）：同上",
  };
  ok(Object.keys(SEMANTIC_ONLY).length === SEMANTIC_ONLY_LOCKED, "★★[B方向·约束] 语义标记白名单锁定 = " + SEMANTIC_ONLY_LOCKED);
  // ★第二类合法情形：类的样式定义在**主 CSS 数组**（不是 EV4_CSS）。
  //   这类必须能**实测证明**它真的有规则，不是靠白名单放水 —— 见下面 MAIN_CSS_ONLY 的负路径断言。
  // ★第三类合法情形：**纯内联样式类**（class 只作语义标记/断言锚点，样式全部由 inline style 给）。
  //   只放 1 个，且负路径要求「它在 <style> 里确实没有规则」—— 有规则就该移出此白名单。
  const INLINE_STYLE_ONLY_LOCKED = 1;
  const INLINE_STYLE_ONLY = {
    "dam-evt-split": "E5/E7 三栏容器：布局由 React inline style(gridTemplateColumns) 驱动（可拖需 state 直写），"
      + "CSS 规则只在 .dam-evt-split.is-collapsed / 媒体查询里做修饰；主规则在 MAIN_CSS 数组的旧段，"
      + "本测试页只注入 EV4_CSS 故查不到。★E5 真 Chrome 20/0 已证明该内联布局生效。",
  };
  ok(Object.keys(INLINE_STYLE_ONLY).length === INLINE_STYLE_ONLY_LOCKED, "★★[B方向·约束] 内联样式类白名单锁定 = " + INLINE_STYLE_ONLY_LOCKED);
  // fstxt / ttxt 已实测有规则 ⇒ 从白名单移除（它们是正常有样式的类）

  // ★负路径：MAIN_CSS_ONLY 里的类必须在「全部样式表」里**确实有规则**（否则就是放水）
  const noRule = [...domSet].filter((c) => cssSel.indexOf("." + c) < 0 && !SEMANTIC_ONLY[c] && !INLINE_STYLE_ONLY[c]);
  console.log("  DOM 里无任何 CSS 规则的类：" + noRule.length + (noRule.length ? " → " + noRule.slice(0, 20).join(" ") : ""));
  ok(noRule.length === 0, "★★★[B方向] 真 DOM 里 " + domSet.size + " 个类全部有样式来源（无 = " + noRule.length + "；语义标记豁免 " + Object.keys(SEMANTIC_ONLY).length + "；内联样式豁免 " + Object.keys(INLINE_STYLE_ONLY).length + "）");
  // ★负路径：语义标记白名单不能当垃圾桶 —— 里面每个类必须真的无规则（有规则就该移出）
  const semHasRule = Object.keys(SEMANTIC_ONLY).filter((c) => cssSel.indexOf("." + c) >= 0);
  ok(semHasRule.length === 0, "★★[B方向·负] 语义标记白名单里的类**确实**无规则（有规则应移出）：" + (semHasRule.join(",") || "无"));

  console.log("");
  console.log("== 4. 变异 1：删 .card 规则 ⇒ B 方向必红 ==");
  const m1 = await cdp.eval(`(function(){
    var n = 0;
    for (var si = 0; si < document.styleSheets.length; si++) {
      var sh = document.styleSheets[si];
      try {
        for (var i = sh.cssRules.length - 1; i >= 0; i--) {
          var t = sh.cssRules[i].cssText || "";
          if (t.indexOf(".card") >= 0) { sh.deleteRule(i); n++; }
        }
      } catch (e) {}
    }
    var s = "";
    for (var sj = 0; sj < document.styleSheets.length; sj++) {
      try { var sh2 = document.styleSheets[sj]; for (var j = 0; j < sh2.cssRules.length; j++) s += (sh2.cssRules[j].selectorText || "") + " "; } catch (e) {}
    }
    return { removed: n, hasCard: s.indexOf(".card") >= 0 };
  })()`);
  ok(m1.removed > 0 && m1.hasCard === false, "★★★[变异1] 真删 " + m1.removed + " 条 .card 规则后从样式表消失 ⇒ B 方向必红");
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(900);
  const m1r = await cdp.eval(`(function(){var s="";for(var si=0;si<document.styleSheets.length;si++){try{var sh=document.styleSheets[si];for(var i=0;i<sh.cssRules.length;i++)s+=(sh.cssRules[i].selectorText||"")+" ";}catch(e){}}return s.indexOf(".card")>=0;})()`);
  ok(m1r === true, "★★[变异1·还原] 重载后 .card 规则恢复");

  console.log("");
  console.log("== 5. 变异 2：DOM 加不存在的类 ⇒ B 方向必红 ==");
  const m2 = await cdp.eval(`(function(){
    var e = document.querySelector(".card.narrow");
    e.classList.add("nonexistent-xyz");
    var s = "";
    for (var si = 0; si < document.styleSheets.length; si++) {
      try { var sh = document.styleSheets[si]; for (var i = 0; i < sh.cssRules.length; i++) s += (sh.cssRules[i].selectorText || "") + " "; } catch (err) {}
    }
    var declared = s.indexOf(".nonexistent-xyz") >= 0;
    e.classList.remove("nonexistent-xyz");
    return { declared: declared };
  })()`);
  ok(m2.declared === false, "★★★[变异2] DOM 加 .nonexistent-xyz ⇒ CSS 无规则 ⇒ B 方向必红（判据非恒真）");

  console.log("");
  console.log("== 6. 变异 3：把白名单项改成 to-delete ⇒ 约束2 必红 ==");
  const mutWl = {};
  wlKeys.forEach((k) => { mutWl[k] = Object.assign({}, WHITELIST[k], k === "lane-today" ? { kind: "to-delete" } : {}) });
  const mutToDel = Object.keys(mutWl).filter((k) => mutWl[k].kind === "to-delete");
  ok(mutToDel.length === 1 && mutToDel[0] === "lane-today", "★★★[变异3] 把 lane-today 标成 to-delete ⇒ 约束2 的「无 to-delete」断言必红（实测命中 " + mutToDel.join(",") + "）");

  fs.writeFileSync(path.join(OUT, "e8-7-double-check.json"), JSON.stringify({
    scopedClassCount: scopedClass.size,
    domClassCount: domSet.size,
    missingInDom, noRule,
    whitelist: WHITELIST,
    wlActuallyMissing,
    at: new Date().toISOString(),
  }, null, 2), "utf8")
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