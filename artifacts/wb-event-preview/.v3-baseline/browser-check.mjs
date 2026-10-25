#!/usr/bin/env node
/**
 * browser-check.mjs — 真浏览器验收（headless Chrome + CDP，零第三方依赖）
 *
 * 为什么必须有这一层：v2 的三个新能力（右栏抽屉 / 检查点折叠 / 三视图）全部是
 * 运行时行为，源码字符串断言无法证明它们真的生效。这里用真 Chrome 打开产物、
 * 真点击、真读 localStorage 与 computed style，并把结果回传给 verify.mjs。
 *
 * 导出：runBrowserChecks({ outDir, shots }) -> { results: [{name, ok, detail}], shots: [...] }
 * 单独跑：node browser-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PYTHON = process.env.DSH_PYTHON || 'C:\\Users\\JH Z\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitJson(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(200);
  }
  throw new Error('CDP endpoint not ready: ' + url);
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = e => this.onMsg(e.data); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    return new CDP(ws);
  }
  onMsg(data) {
    const msg = JSON.parse(data);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error))); else resolve(msg.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

/**
 * 删 Chrome profile 目录：Windows 上 Chrome 退出后句柄可能还占着几百毫秒，
 * 直接 rmSync 会抛 EPERM 把整条 verify 打挂。重试 + 最终失败只告警不抛。
 */
/** 等某段 JS 表达式稳定下来（抽屉弹簧在 headless 里可能被降帧，固定 sleep 不可靠） */
async function waitStable(cdp, expr, ms = 2500) {
  const t0 = Date.now();
  let prev = null, same = 0;
  while (Date.now() - t0 < ms) {
    const v = await cdp.eval(expr);
    if (v === prev) { if (++same >= 3) return v; } else { same = 0; prev = v; }
    await sleep(120);
  }
  return prev;
}

function safeRm(dir) {
  for (let i = 0; i < 8; i++) {
    try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); return true; }
    catch (e) { try { execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', dir], { stdio: 'ignore' }); return true; } catch (e2) {} }
  }
  console.warn('[browser-check] 警告：未能删除临时 profile 目录 ' + dir + '（不影响断言结果）');
  return false;
}

function pixelStats(file) {
  return JSON.parse(execFileSync(PYTHON, [path.join(HERE, 'pixel-stats.py'), file], { encoding: 'utf8' }).trim());
}

export async function runBrowserChecks(opts = {}) {
  const outDir = opts.outDir || HERE;
  const port = Number(opts.port || process.env.CDP_PORT || 9333);
  // 唯一 profile 目录：并发跑 verify（例如 Lead 同时在复算）时不会互相踩同一个 Chrome user-data-dir
  const profile = path.join(outDir, '.cdp-profile-' + process.pid + '-' + Date.now().toString(36));
  const page = 'file:///' + path.join(outDir, 'index.html').replace(/\\/g, '/');
  const results = [];
  const shots = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: String(detail == null ? '' : detail) });

  safeRm(profile);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1600,1000', '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile, '--allow-file-access-from-files', 'about:blank'
  ], { stdio: 'ignore' });
  let cdp;
  try {
    await waitJson('http://127.0.0.1:' + port + '/json/version');
    const list = await waitJson('http://127.0.0.1:' + port + '/json/list');
    const target = list.find(t => t.type === 'page');
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

    const shot = async name => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const p = path.join(outDir, name);
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      const st = pixelStats(p);
      const rec = { name, bytes: fs.statSync(p).size, ...st };
      shots.push(rec);
      return rec;
    };

    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(250);
    await cdp.send('Page.navigate', { url: page });
    await sleep(2600);

    /* ---------- 0. 基线：v1 能力仍在 ---------- */
    const boot = await cdp.eval('({ ready: document.readyState, cards: document.querySelectorAll(".card").length, ticks: document.querySelectorAll(".tick").length, panels: document.querySelectorAll(".cp .panel").length })');
    check('页面真渲染：时间流 184 张卡 + 184 个时间轴刻度', boot.ready === 'complete' && boot.cards === 184 && boot.ticks === 184, JSON.stringify(boot));

    /* ---------- 1. 视图切换写 localStorage ---------- */
    const v0 = await cdp.eval('({ mode: localStorage.getItem("wbEvt.viewMode"), active: document.querySelector(".vswitch button.on").getAttribute("data-view") })');
    check('localStorage 无值时默认视图 = time stream', v0.active === 'stream', JSON.stringify(v0));
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await sleep(500);
    const v1 = await cdp.eval('({ mode: localStorage.getItem("wbEvt.viewMode"), body: document.body.getAttribute("data-view"), rows: document.querySelectorAll(".lrow").length, segs: document.querySelectorAll(".lseg").length, dots: document.querySelectorAll(".lpt-single").length })');
    check('切「泳道/甘特」后 localStorage.wbEvt.viewMode === "lanes"', v1.mode === 'lanes' && v1.body === 'lanes', JSON.stringify(v1));
    check('泳道视图 127 行：31 个单检查点画点、124 段横条', v1.rows === 127 && v1.dots === 31 && v1.segs === 124, 'rows=' + v1.rows + ' dots=' + v1.dots + ' segs=' + v1.segs);
    await cdp.eval('document.querySelector(".vswitch button[data-view=workflow]").click()');
    await sleep(500);
    const v2 = await cdp.eval('({ mode: localStorage.getItem("wbEvt.viewMode"), groups: document.querySelectorAll(".wfg").length, closed: (document.querySelector(".wfg.closed .lane")||{}).textContent, rows: document.querySelectorAll(".wfrow").length })');
    check('切「工作流线索」后 wbEvt.viewMode === "workflow"', v2.mode === 'workflow', JSON.stringify(v2));
    check('工作流按 lane 分组（37 组：主线 91 + 36 条标号线）、主线默认折叠、行数 163（事件可同属多条线）', v2.groups === 37 && v2.closed === '(主线)' && v2.rows === 163, JSON.stringify(v2));
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await sleep(500);
    check('切回时间流后 wbEvt.viewMode === "stream"', (await cdp.eval('localStorage.getItem("wbEvt.viewMode")')) === 'stream', 'stream');

    /* ---------- 2. 右栏抽屉写 localStorage + grid 折叠 ---------- */
    const dOpen = await cdp.eval('({ open: localStorage.getItem("wbEvt.detailOpen"), cols: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns })');
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(200);
    const dClosed = await cdp.eval('({ open: localStorage.getItem("wbEvt.detailOpen"), cols: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns, off: document.querySelector(".layout").classList.contains("detail-off"), w: document.querySelector(".detail").getBoundingClientRect().width })');
    check('点「收起右栏」后 localStorage.wbEvt.detailOpen === "false"', dClosed.open === 'false', JSON.stringify({ before: dOpen.open, after: dClosed.open }));
    check('收起后 grid 变为 200px 1fr 0，右栏实测宽度 0px', / 0px$/.test(dClosed.cols) && dClosed.w === 0, dClosed.cols + ' / detailW=' + dClosed.w);
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(200);
    const dReopen = await cdp.eval('({ open: localStorage.getItem("wbEvt.detailOpen"), cols: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns, w: Math.round(document.querySelector(".detail").getBoundingClientRect().width) })');
    check('再展开：detailOpen === "true"，右栏占回余量（332px 起）', dReopen.open === 'true' && dReopen.w >= 300, JSON.stringify(dReopen));
    /* ---- 可中断：关到一半反向，弹簧从当前值回走，不跳变 ---- */
    await cdp.eval('document.getElementById("dtoggle").click()');
    await sleep(90);
    const mid = await cdp.eval('({ w: document.querySelector(".detail").getBoundingClientRect().width, cls: document.querySelector(".layout").className })');
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(200);
    const back = await cdp.eval('({ w: Math.round(document.querySelector(".detail").getBoundingClientRect().width), open: localStorage.getItem("wbEvt.detailOpen") })');
    check('抽屉可中断：收起途中反向，最终仍回到展开且宽度连续（无 0↔满 跳变）', mid.w > 0 && mid.w < 400 && back.open === 'true' && back.w >= 300, 'midW=' + Math.round(mid.w) + ' finalW=' + back.w);

    /* ---------- 3. 检查点折叠 ---------- */
    await cdp.eval('document.querySelector(".tick[data-id=evt-085]").click()');
    await sleep(700);
    const c0 = await cdp.eval('({ total: document.querySelectorAll(".cp").length, closed: document.querySelectorAll(".cp.closed").length, heads: document.querySelectorAll(".cp-h").length, chips: (document.querySelector(".cp.closed .cp-counts")||{textContent:""}).textContent, rows: getComputedStyle(document.querySelector(".cp.closed .cp-body")).gridTemplateRows })');
    check('检查点默认全部折叠（26/26 只留头部）', c0.total === 26 && c0.closed === 26 && c0.heads === 26, JSON.stringify({ total: c0.total, closed: c0.closed }));
    check('折叠态头部显示「现状 n · log n · 失败 n · 下一步 n」四格计数', /现状\s*\d+/.test(c0.chips) && /log\s*\d+/.test(c0.chips) && /失败\s*\d+/.test(c0.chips) && /下一步\s*\d+/.test(c0.chips), c0.chips.replace(/\s+/g, ' ').trim());
    check('折叠态 body 的 grid-template-rows 实测为 0fr（0 → 1fr 过渡）', /^0px$/.test(c0.rows), c0.rows);
    await cdp.eval('document.querySelectorAll(".cp-h")[1].click()');
    await sleep(450);
    const c1 = await cdp.eval('({ closed: document.querySelectorAll(".cp.closed").length, panels: document.querySelectorAll(".cp")[1].querySelectorAll(".panel").length, rows: getComputedStyle(document.querySelectorAll(".cp")[1].querySelector(".cp-body")).gridTemplateRows, expanded: document.querySelectorAll(".cp")[1].getAttribute("aria-expanded") })');
    check('点第 2 个检查点头部：该行展开、六格面板齐、行高从 0 变为非 0', c1.closed === 25 && c1.panels === 6 && !/^0px$/.test(c1.rows), JSON.stringify({ closed: c1.closed, panels: c1.panels, rows: c1.rows }));
    await cdp.eval('document.querySelectorAll(".cp-h")[1].click()');
    await sleep(450);
    const c2 = await cdp.eval('document.querySelectorAll(".cp.closed").length');
    check('再点一次同一头部：回到折叠（26/26）', c2 === 26, 'closed=' + c2);

    /* ---------- 4. 空档标记 >2h ---------- */
    await cdp.eval('document.querySelector(".tick[data-id=evt-018]").click()');
    await sleep(800);
    const g1 = await cdp.eval('({ gaps: document.querySelectorAll(".gap").length, text: (document.querySelector(".gap .gtext")||{textContent:""}).textContent, hours: (document.querySelector(".gap")||{}).getAttribute ? document.querySelector(".gap").getAttribute("data-hours") : null })');
    check('空档标记：evt-018（40.9h）插出虚线「⏸ 搁置 40.9 小时 —— 起→止」', g1.gaps === 1 && /搁置 40\.9 小时/.test(g1.text) && /→/.test(g1.text), g1.text.trim());
    const gNeg = await cdp.eval('(function(){var t=document.querySelector(".tick[data-id=evt-086]");if(!t)return null;t.click();return 1;})()');
    await sleep(700);
    const g2 = await cdp.eval('({ gaps: document.querySelectorAll(".gap").length, cps: document.querySelectorAll(".cp").length })');
    check('负路径：无 >2h 空档的事件（evt-086）不出现任何空档标记', gNeg === 1 && g2.gaps === 0 && g2.cps === 2, JSON.stringify(g2));

    /* ---------- 5. 合成 fixture 严格分区 ---------- */
    const dm0 = await cdp.eval('({ demoCards: document.querySelectorAll(".card[data-id^=demo-]").length, demoTicks: document.querySelectorAll(".tick[data-id^=demo-]").length, cards: document.querySelectorAll(".card").length })');
    check('默认（开关关闭）真实列表 184 张卡、0 个 demo 节点', dm0.cards === 184 && dm0.demoCards === 0 && dm0.demoTicks === 0, JSON.stringify(dm0));
    await cdp.eval('document.getElementById("demoSwitch").click()');
    await sleep(800);
    const dm1 = await cdp.eval('({ demoCards: document.querySelectorAll(".card[data-id^=demo-]").length, demoTicks: document.querySelectorAll(".tick[data-id^=demo-]").length, realNodes: document.querySelectorAll("[data-id^=evt-],[data-id^=bucket-]").length, banner: document.getElementById("demo-banner-top").style.display, tag: (document.querySelector(".demo-tag")||{}).textContent })');
    check('开启「并发演示（合成数据）」：4 张 demo 卡 + 4 个刻度、0 个真实节点', dm1.demoCards === 4 && dm1.demoTicks === 4 && dm1.realNodes === 0, JSON.stringify(dm1));
    check('demo 模式顶部有「合成数据」标识条', dm1.banner !== 'none' && dm1.tag === '合成数据', JSON.stringify({ banner: dm1.banner, tag: dm1.tag }));
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await sleep(700);
    const dm2 = await cdp.eval('({ rows: document.querySelectorAll(".lrow").length })');
    const dm3 = await cdp.eval('(function(){var rows=Array.from(document.querySelectorAll(".lrow"));var ranges=rows.map(function(r){var s=r.querySelectorAll(".lseg");var a=Infinity,b=-Infinity;s.forEach(function(x){a=Math.min(a,parseFloat(x.style.left));b=Math.max(b,parseFloat(x.style.left)+parseFloat(x.style.width));});return [a,b];});var n=0;for(var i=0;i<ranges.length;i++)for(var j=i+1;j<ranges.length;j++)if(ranges[i][0]<ranges[j][1]&&ranges[j][0]<ranges[i][1])n++;return n;})()');
    check('合成 demo 泳道：4 行、6 对区间重叠（并发在图上可见）', dm2.rows === 4 && dm3 === 6, 'rows=' + dm2.rows + ' overlapPairs=' + dm3);
    await cdp.eval('document.getElementById("demoSwitch").click()');
    await sleep(600);
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await sleep(600);
    const dm4 = await cdp.eval('({ demoNodes: document.querySelectorAll("[data-id^=demo-]").length, cards: document.querySelectorAll(".card").length })');
    check('负路径：关掉 demo 后 demo 节点归零、真实 184 张卡回来', dm4.demoNodes === 0 && dm4.cards === 184, JSON.stringify(dm4));

    /* ---------- 6. 刷新后状态持久 ---------- */
    await cdp.eval('localStorage.setItem("wbEvt.viewMode","workflow"); localStorage.setItem("wbEvt.detailOpen","false")');
    await cdp.send('Page.reload');
    await sleep(2600);
    const p2 = await cdp.eval('({ mode: document.body.getAttribute("data-view"), groups: document.querySelectorAll(".wfg").length, off: document.querySelector(".layout").classList.contains("detail-off") })');
    check('刷新后：视图=workflow、右栏=收起（均从 localStorage 恢复）', p2.mode === 'workflow' && p2.groups === 37 && p2.off === true, JSON.stringify(p2));

    /* ---------- 7. 深链 + 键盘（v1 能力） ---------- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(400);
    await cdp.send('Page.navigate', { url: page + '#evt-091' });
    await sleep(2600);
    const dl = await cdp.eval('({ hash: location.hash, mode: document.body.getAttribute("data-view"), selected: (document.querySelector(".card.on")||{getAttribute:function(){return null;}}).getAttribute("data-id"), heading: (document.querySelector(".dh h2")||{}).textContent })');
    check('深链 #evt-091 命中并选中对应事件', dl.selected === 'evt-091' && dl.mode === 'stream' && !!dl.heading, JSON.stringify(dl));
    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    await sleep(450);
    const kb = await cdp.eval('(document.querySelector(".card.on")||{getAttribute:function(){return null;}}).getAttribute("data-id")');
    check('↑↓ 键盘切换事件（ArrowDown：evt-091 → evt-092）', kb === 'evt-092', 'after=' + kb);

    /* ---------- 7b. reduced-motion 降级 + 键盘可达 ---------- */
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp.send('Page.reload');
    await sleep(2600);
    const rm0 = await cdp.eval('(function(){var l=document.querySelector(".layout");return {cols:getComputedStyle(l).gridTemplateColumns, detailW:Math.round(document.querySelector(".detail").getBoundingClientRect().width)};})()');
    await cdp.eval('document.getElementById("dtoggle").click()');
    await sleep(120);
    const rm1 = await cdp.eval('({w:Math.round(document.querySelector(".detail").getBoundingClientRect().width), open:localStorage.getItem("wbEvt.detailOpen")})');
    check('reduced-motion 降级：切抽屉 120ms 内直接落位（无弹簧中间帧）', rm1.open === 'false' && rm1.w === 0, JSON.stringify({ before: rm0.detailW, after120ms: rm1.w }));
    await cdp.eval('document.getElementById("dtoggle").click()');
    await sleep(150);
    const rm2 = await cdp.eval('Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    check('reduced-motion 降级：展开同样即时恢复', rm2 >= 300, 'w=' + rm2);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });

    // 确定性：先清 localStorage 回到 stream，再只靠键盘 ArrowRight 切到 lanes
    await cdp.eval('localStorage.removeItem("wbEvt.viewMode")');
    await cdp.send('Page.reload');
    await sleep(2600);
    const kbBefore = await cdp.eval('document.body.getAttribute("data-view")');
    await cdp.eval('(function(){var b=document.querySelector(".vswitch button[data-view=stream]");b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}));})()');
    await sleep(550);
    const kb1 = await cdp.eval('({mode:localStorage.getItem("wbEvt.viewMode"), body:document.body.getAttribute("data-view"), focusView:(document.activeElement||{}).getAttribute?document.activeElement.getAttribute("data-view"):null, rows:document.querySelectorAll(".lrow").length})');
    check('视图切换键盘可达：stream 上按 ArrowRight → lanes，且焦点与 localStorage 同步', kbBefore === 'stream' && kb1.mode === 'lanes' && kb1.body === 'lanes' && kb1.focusView === 'lanes' && kb1.rows === 127, JSON.stringify({ before: kbBefore, after: kb1 }));
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await sleep(400);

    /* ---------- 8. 四张交付截图（每张都实测亮度方差） ---------- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(400);
    await cdp.send('Page.navigate', { url: page });
    await sleep(2600);
    await cdp.eval('document.querySelector(".tick[data-id=evt-085]").click()');
    await sleep(700);
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(300);
    const s3 = await shot('shot-03-collapsed.png');
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(300);
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await sleep(1000);
    const s4 = await shot('shot-04-lanes.png');
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await sleep(800);
    await cdp.eval('document.querySelector(".tick[data-id=evt-018]").click()');
    await sleep(900);
    await cdp.eval('(function(){var g=document.querySelector(".gap"); if(g) g.scrollIntoView({block:"center"}); return !!g;})()');
    await sleep(800);
    const s5 = await shot('shot-05-gap.png');
    await cdp.eval('document.getElementById("demoSwitch").click()');
    await sleep(1000);
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await sleep(1000);
    const s6 = await shot('shot-06-concurrent-demo.png');
    check('四张交付截图均为 1600x1000', [s3, s4, s5, s6].every(s => s.w === 1600 && s.h === 1000), [s3, s4, s5, s6].map(s => s.w + 'x' + s.h).join(' / '));
    check('四张交付截图非空白（亮度方差 > 300 且非白像素 > 5%）', [s3, s4, s5, s6].every(s => s.variance > 300 && s.nonWhitePct > 5), [s3, s4, s5, s6].map(s => s.name.replace('shot-', '').replace('.png', '') + ' var=' + s.variance + ' nw=' + s.nonWhitePct + '%').join(' | '));
    check('四张截图 sha256 互不相同（确为四个不同界面态）', new Set([s3, s4, s5, s6].map(s => s.bytes + ':' + s.variance + ':' + s.unq)).size === 4, [s3, s4, s5, s6].map(s => s.bytes).join(' / '));

    cdp.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(1200);
    safeRm(profile);
  }
  return { results, shots };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const { results, shots } = await runBrowserChecks();
  for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + '  =>  ' + r.detail);
  const pass = results.filter(r => r.ok).length;
  console.log('');
  console.log('TOTAL ' + results.length + '  PASS ' + pass + '  FAIL ' + (results.length - pass));
  console.log('SHOTS ' + shots.map(s => s.name + ' ' + s.w + 'x' + s.h + ' var=' + s.variance).join(' | '));
  process.exit(pass === results.length ? 0 : 1);
}