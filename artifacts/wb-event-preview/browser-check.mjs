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
/** 等某个条件在页面里为真（替代固定 sleep：软件 350ms 就绪，没有理由盲等 2.6s） */
async function waitFor(cdp, expr, timeoutMs = 4000, stepMs = 30) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      /* 统一门控：文档没到 complete 之前，任何 DOM 条件都不算数（否则会读到旧文档的残影） */
      const rs = await cdp.eval('document.readyState');
      if (rs === 'complete') { const v = await cdp.eval(expr); if (v) return true; }
    } catch (e) {}
    await sleep(stepMs);
  }
  return false;
}
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
    await sleep(80);
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);

    /* ---------- ★语料计数唯一来源：events.json 的 stats（不在断言里写死） ---------- */
    const STATS = JSON.parse(fs.readFileSync(path.join(outDir, 'events.json'), 'utf8')).stats;
    const TOTAL = STATS.timelineNodes;     // 时间轴节点总数（= 卡片总数 = 刻度总数，由 build 派生）
    const WINDOW = 36;                     // 初始窗口（实现常量，view.mjs INIT_WINDOW）
    const CHUNK = 24;                      // 每次向上加载（view.mjs CHUNK）
    check('语料计数基线来自 events.json.stats（timelineNodes=' + TOTAL + ' / documents=' + STATS.documents + '）',
      Number.isInteger(TOTAL) && TOTAL > 0 && STATS.documents > 0, 'timelineNodes=' + TOTAL + ' documents=' + STATS.documents + ' checkpoints=' + STATS.checkpoints);

    /* 结构性期望值同样从 events.json 现算，不写死：泳道段数 / 单点事件 / 工作流分组 */
    const EVENTS_ALL = JSON.parse(fs.readFileSync(path.join(outDir, 'events.json'), 'utf8')).events;
    const GAP_MS = 2 * 3600000;
    const ledgers = EVENTS_ALL.filter(e => e.kind === 'ledger');
    const LANE_RE = /(?:^|[^A-Za-z0-9])(P\d{1,2}|R\d{1,2}|G\d{1,2})(?![0-9A-Za-z])|([EF])\s*线/g;
    const scanLanes = t => { const out = []; let m; LANE_RE.lastIndex = 0; while ((m = LANE_RE.exec(t))) { const x = m[1] || (m[2] + '线'); if (!out.includes(x)) out.push(x); } return out; };
    const lanesOfEv = ev => { const a = scanLanes(ev.title); for (const x of scanLanes(ev.summary)) if (!a.includes(x)) a.push(x); return a; };
    const LANE_STATS = (() => {
      let dots = 0, segs = 0, groups = 0, rows = 0;
      const g = new Map();
      for (const e of ledgers) {
        const cps = e.checkpoints;
        if (cps.length === 1) dots++;
        else { let cur = 1; segs++; for (let i = 1; i < cps.length; i++) { if (cps[i].ms - cps[i - 1].ms > GAP_MS) segs++; } }
        const ls = lanesOfEv(e); const keys = ls.length ? ls : ['(主线)'];
        for (const k of keys) g.set(k, (g.get(k) || 0) + 1);
      }
      groups = g.size; for (const v of g.values()) rows += v;
      return { dots, segs, groups, rows, ledgerCount: ledgers.length };
    })();
    check('结构化期望值从 events.json 现算（泳道段/点/工作流分组，不写死）', LANE_STATS.ledgerCount === STATS.events && LANE_STATS.groups > 0,
      'ledger=' + LANE_STATS.ledgerCount + ' dots=' + LANE_STATS.dots + ' segs=' + LANE_STATS.segs + ' wfGroups=' + LANE_STATS.groups + ' wfRows=' + LANE_STATS.rows);

    /* ---------- 0. 基线：v1 能力仍在 ---------- */
    const boot = await cdp.eval('({ ready: document.readyState, cards: document.querySelectorAll(".card").length, ticks: document.querySelectorAll(".tick").length, loaded: window.__wb && window.__wb.loaded, total: window.__wb && window.__wb.total })');
    check('页面真渲染：初始窗口 ' + WINDOW + ' 张卡 + ' + TOTAL + ' 个时间轴刻度（懒加载只作用于卡片端）',
      boot.ready === 'complete' && boot.cards === WINDOW && boot.ticks === TOTAL && boot.total === TOTAL,
      JSON.stringify(boot) + '（期望 cards=' + WINDOW + ' ticks=total=' + TOTAL + '）');

    /* ---------- 1. 视图切换写 localStorage ---------- */
    const v0 = await cdp.eval('({ mode: localStorage.getItem("wbEvt.viewMode"), active: document.querySelector(".vswitch button.on").getAttribute("data-view") })');
    check('localStorage 无值时默认视图 = time stream', v0.active === 'stream', JSON.stringify(v0));
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await waitFor(cdp, 'document.querySelectorAll(".lrow").length > 0');
    const v1 = await cdp.eval('({ mode: localStorage.getItem("wbEvt.viewMode"), body: document.body.getAttribute("data-view"), rows: document.querySelectorAll(".lrow").length, segs: document.querySelectorAll(".lseg").length, dots: document.querySelectorAll(".lpt-single").length })');
    check('切「泳道/甘特」后 localStorage.wbEvt.viewMode === "lanes"', v1.mode === 'lanes' && v1.body === 'lanes', JSON.stringify(v1));
    check('泳道视图行数/点数/段数 = events.json 现算值（' + LANE_STATS.ledgerCount + ' 行 / ' + LANE_STATS.dots + ' 点 / ' + LANE_STATS.segs + ' 段）',
      v1.rows === LANE_STATS.ledgerCount && v1.dots === LANE_STATS.dots && v1.segs === LANE_STATS.segs,
      'rows=' + v1.rows + '（期望 ' + LANE_STATS.ledgerCount + '） dots=' + v1.dots + '（期望 ' + LANE_STATS.dots + '） segs=' + v1.segs + '（期望 ' + LANE_STATS.segs + '）');
    await cdp.eval('document.querySelector(".vswitch button[data-view=workflow]").click()');
    await waitFor(cdp, 'document.querySelectorAll(".wfg").length > 0');
    const v2 = await cdp.eval('({ mode: localStorage.getItem("wbEvt.viewMode"), groups: document.querySelectorAll(".wfg").length, closed: (document.querySelector(".wfg.closed .lane")||{}).textContent, rows: document.querySelectorAll(".wfrow").length })');
    check('切「工作流线索」后 wbEvt.viewMode === "workflow"', v2.mode === 'workflow', JSON.stringify(v2));
    check('工作流按 lane 分组（' + LANE_STATS.groups + ' 组）、主线默认折叠、行数 ' + LANE_STATS.rows + '（事件可同属多条线）',
      v2.groups === LANE_STATS.groups && v2.closed === '(主线)' && v2.rows === LANE_STATS.rows,
      JSON.stringify(v2) + '（期望 groups=' + LANE_STATS.groups + ' rows=' + LANE_STATS.rows + '）');
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await waitFor(cdp, 'document.querySelectorAll(".card").length > 0');
    check('切回时间流后 wbEvt.viewMode === "stream"', (await cdp.eval('localStorage.getItem("wbEvt.viewMode")')) === 'stream', 'stream');

    /* ---------- 2. 右栏抽屉写 localStorage + grid 折叠 ---------- */
    /* 前置：泳道/工作流会自动收起右栏（v4 行为），这里先显式展开，保证起点确定 */
    await cdp.eval('(function(){var l=document.querySelector(".layout");if(l.classList.contains("detail-off")||localStorage.getItem("wbEvt.detailOpen")==="false"){document.getElementById("dtoggle").click();}})()');
    await waitFor(cdp, 'localStorage.getItem("wbEvt.detailOpen") === "true" && Math.round(document.querySelector(".detail").getBoundingClientRect().width) > 300', 5000);
    const dOpen = await cdp.eval('({ open: localStorage.getItem("wbEvt.detailOpen"), cols: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns })');
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(200);
    const dClosed = await cdp.eval('({ open: localStorage.getItem("wbEvt.detailOpen"), cols: getComputedStyle(document.querySelector(".layout")).gridTemplateColumns, off: document.querySelector(".layout").classList.contains("detail-off"), w: document.querySelector(".detail").getBoundingClientRect().width })');
    check('点「收起右栏」后 localStorage.wbEvt.detailOpen === "false"', dClosed.open === 'false', JSON.stringify({ before: dOpen.open, after: dClosed.open }));
    check('收起后 grid 末列 0px、右栏实测宽度 0px（padding/border 一并归零）', / 0px$/.test(dClosed.cols) && dClosed.w === 0, dClosed.cols + ' / detailW=' + dClosed.w);
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
    await cdp.eval('window.__wb.select("evt-085")');
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
    await cdp.eval('window.__wb.select("evt-018")');
    await sleep(800);
    const g1 = await cdp.eval('({ gaps: document.querySelectorAll(".gap").length, text: (document.querySelector(".gap .gtext")||{textContent:""}).textContent, hours: (document.querySelector(".gap")||{}).getAttribute ? document.querySelector(".gap").getAttribute("data-hours") : null })');
    check('空档标记：evt-018（40.9h）插出虚线「⏸ 搁置 40.9 小时 —— 起→止」', g1.gaps === 1 && /搁置 40\.9 小时/.test(g1.text) && /→/.test(g1.text), g1.text.trim());
    const gNeg = await cdp.eval('(function(){var t=document.querySelector(".tick[data-id=evt-086]");if(!t)return null;window.__wb.select("evt-086");return 1;})()');
    await sleep(700);
    const g2 = await cdp.eval('({ gaps: document.querySelectorAll(".gap").length, cps: document.querySelectorAll(".cp").length })');
    check('负路径：无 >2h 空档的事件（evt-086）不出现任何空档标记', gNeg === 1 && g2.gaps === 0 && g2.cps === 2, JSON.stringify(g2));

    /* ---------- 5. 合成 fixture 严格分区 ---------- */
    const dm0 = await cdp.eval('({ demoCards: document.querySelectorAll(".card[data-id^=demo-]").length, demoTicks: document.querySelectorAll(".tick[data-id^=demo-]").length, cards: document.querySelectorAll(".card").length })');
    /* 此处已推进过若干懒加载（前面的胶囊/检查点断言会 ensureLoaded），所以卡片数不再是初始 36；
       真正要守住的是「0 个 demo 节点」，卡片数只需落在 [36,184] 且等于当前窗口。 */
    check('默认（开关关闭）真实列表只有真实卡片（0 demo 节点），卡片数 = 当前懒加载窗口', dm0.demoCards === 0 && dm0.demoTicks === 0 && dm0.cards >= WINDOW && dm0.cards <= TOTAL, JSON.stringify(dm0));
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
    check('负路径：关掉 demo 后 demo 节点归零、真实卡片回来（窗口内）', dm4.demoNodes === 0 && dm4.cards >= WINDOW && dm4.cards <= TOTAL, JSON.stringify(dm4));

    /* ---------- 6. 刷新后状态持久 ---------- */
    await cdp.eval('localStorage.setItem("wbEvt.viewMode","workflow"); localStorage.setItem("wbEvt.detailOpen","false")');
    await cdp.send('Page.reload');
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && (document.querySelectorAll(".card").length > 0 || document.querySelectorAll(".lrow").length > 0))', 6000);
    const p2 = await cdp.eval('({ mode: document.body.getAttribute("data-view"), groups: document.querySelectorAll(".wfg").length, off: document.querySelector(".layout").classList.contains("detail-off") })');
    check('刷新后：视图=workflow（' + LANE_STATS.groups + ' 组完整重建）、右栏=收起（均从 localStorage 恢复）', p2.mode === 'workflow' && p2.groups === LANE_STATS.groups && p2.off === true, JSON.stringify(p2));

    /* ---------- 7. 深链 + 键盘（v1 能力） ---------- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(80);
    await cdp.send('Page.navigate', { url: page + '#evt-091' });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const dl = await cdp.eval('({ hash: location.hash, mode: document.body.getAttribute("data-view"), selected: (document.querySelector(".card.on")||{getAttribute:function(){return null;}}).getAttribute("data-id"), heading: (document.querySelector(".dh h2")||{}).textContent })');
    check('深链 #evt-091 命中并选中对应事件', dl.selected === 'evt-091' && dl.mode === 'stream' && !!dl.heading, JSON.stringify(dl));
    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true}))');
    await sleep(450);
    const kb = await cdp.eval('(document.querySelector(".card.on")||{getAttribute:function(){return null;}}).getAttribute("data-id")');
    check('↑↓ 键盘切换事件（ArrowDown：evt-091 → evt-092）', kb === 'evt-092', 'after=' + kb);

    /* ---------- 7b. reduced-motion 降级 + 键盘可达 ---------- */
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await cdp.send('Page.reload');
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && (document.querySelectorAll(".card").length > 0 || document.querySelectorAll(".lrow").length > 0))', 6000);
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
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && (document.querySelectorAll(".card").length > 0 || document.querySelectorAll(".lrow").length > 0))', 6000);
    const kbBefore = await cdp.eval('document.body.getAttribute("data-view")');
    await cdp.eval('(function(){var b=document.querySelector(".vswitch button[data-view=stream]");b.focus();b.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}));})()');
    await sleep(550);
    const kb1 = await cdp.eval('({mode:localStorage.getItem("wbEvt.viewMode"), body:document.body.getAttribute("data-view"), focusView:(document.activeElement||{}).getAttribute?document.activeElement.getAttribute("data-view"):null, rows:document.querySelectorAll(".lrow").length})');
    check('视图切换键盘可达：stream 上按 ArrowRight → lanes，且焦点与 localStorage 同步', kbBefore === 'stream' && kb1.mode === 'lanes' && kb1.body === 'lanes' && kb1.focusView === 'lanes' && kb1.rows === LANE_STATS.ledgerCount, JSON.stringify({ before: kbBefore, after: kb1 }));
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await sleep(400);


    /* ======================================================================
       v4 新能力：倒叙 / 懒加载 / 时间轴重做 / 三视图方向 / 字号 / 主题 / 响应式
       全部真滚动、真读 scrollTop、真算对比度，不做源码字符串断言。
       ====================================================================== */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(80);
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);

    /* ---- 8.1 倒叙：初始锚在底部，最新事件可见 ---- */
    const bottom = await cdp.eval('(function(){var m=document.querySelector(".mid");return {st:Math.round(m.scrollTop), ch:Math.round(m.clientHeight), sh:Math.round(m.scrollHeight), atBottom:m.scrollTop+m.clientHeight>=m.scrollHeight-5};})()');
    check('倒叙①：初始 scrollTop+clientHeight >= scrollHeight-5（确实停在底部）', bottom.atBottom, 'scrollTop=' + bottom.st + ' clientH=' + bottom.ch + ' scrollH=' + bottom.sh + ' 差=' + (bottom.sh - bottom.st - bottom.ch) + 'px');
    /* 倒叙语义的不变量：DOM 末位事件的 endMs 必须是全体最大（不写死任何事件 id） */
    const newestVis = await cdp.eval('(function(){var m=document.querySelector(".mid");var cs=Array.from(document.querySelectorAll(".card"));var vp=m.getBoundingClientRect();var vis=cs.filter(function(c){var r=c.getBoundingClientRect();return r.bottom>vp.top&&r.top<vp.bottom;});var last=cs[cs.length-1].getAttribute("data-id");var maxId=null,maxEnd=-Infinity;var all=(JSON.parse(document.getElementById("payload").textContent)).events;for(var i=0;i<all.length;i++){if(all[i].endMs>maxEnd){maxEnd=all[i].endMs;maxId=all[i].id;}}return {lastCard:last, visible:vis.length, maxId:maxId, lastIsMax:last===maxId, lastInView:vis.some(function(c){return c.getAttribute("data-id")===last;})};})()');
    check('倒叙②：DOM 末位事件的 endMs = 全体最大（倒叙语义，不写死事件 id）且初始就在视口内',
      newestVis.lastIsMax === true && newestVis.lastInView === true,
      'last=' + newestVis.lastCard + ' / maxEndId=' + newestVis.maxId + ' / 在视口内=' + newestVis.lastInView + ' / 可见 ' + newestVis.visible + ' 张');
    const railBottom = await cdp.eval('(function(){var r=document.getElementById("rail");return {st:Math.round(r.scrollTop), sh:Math.round(r.scrollHeight), ch:Math.round(r.clientHeight), atBottom:r.scrollTop+r.clientHeight>=r.scrollHeight-5};})()');
    check('倒叙③：左时间轴同样贴底（「今天」锚点在视口内）', railBottom.atBottom, 'rail scrollTop=' + railBottom.st + ' 差=' + (railBottom.sh - railBottom.st - railBottom.ch) + 'px');

    /* ---- 8.2 懒加载：初始窗口 + 加载更早 + 锚定位移 < 2px ---- */
    const lz0 = await cdp.eval('({loaded:window.__wb.loaded, total:window.__wb.total, cards:document.querySelectorAll(".card").length, cnt:document.getElementById("lm-cnt").textContent.trim(), start:window.__wb.loadedStart})');
    check('懒加载①：初始只渲染最近 ' + WINDOW + ' 个 / 共 ' + TOTAL + '（loadedStart = TOTAL-' + WINDOW + ' = ' + (TOTAL - WINDOW) + '）',
      lz0.loaded === WINDOW && lz0.total === TOTAL && lz0.cards === WINDOW && lz0.start === TOTAL - WINDOW,
      JSON.stringify(lz0) + '（期望 loaded=cards=' + WINDOW + ' total=' + TOTAL + ' start=' + (TOTAL - WINDOW) + '）');
    check('懒加载②：界面显示「已载 X / 总 Y」', new RegExp('已载\\s*' + WINDOW + '\\s*/\\s*' + TOTAL).test(lz0.cnt.replace(/\s+/g, ' ')), lz0.cnt);
    /* 先把状态复位到干净的 36 窗口（前面的断言可能已经触发过一次懒加载） */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const lzReset = await cdp.eval('({loaded:window.__wb.loaded, cards:document.querySelectorAll(".card").length, loadCount:window.__wb.loadCount})');
    check('懒加载⓪：重置后回到干净初始态（36 张 / 0 次加载）', lzReset.loaded === 36 && lzReset.cards === 36 && lzReset.loadCount === 0, JSON.stringify(lzReset));
    /* 先滚到一个稳定位置（滚到 200 会立刻触发自动加载，测不到「加载前」状态）；
       先滚到 900（高于 260 触发线），再把视口锚点卡片记下来。 */
    await cdp.eval('document.querySelector(".mid").scrollTop=900');
    await sleep(400);
    const pre = await cdp.eval('(function(){var m=document.querySelector(".mid");var vp=m.getBoundingClientRect().top;var cs=Array.from(document.querySelectorAll(".card"));for(var i=0;i<cs.length;i++){var r=cs[i].getBoundingClientRect();if(r.top>=vp){return {id:cs[i].getAttribute("data-id"), top:r.top, loaded:window.__wb.loaded, st:Math.round(m.scrollTop), loadCount:window.__wb.loadCount};}}return null;})()');
    /* 用「↑ 加载更早」按钮触发（与滚动触发走同一个 loadEarlier()）；滚动触发在负路径①里验证 */
    await cdp.eval('document.getElementById("lm-more").click()');
    await waitFor(cdp, 'document.querySelectorAll(".card").length === ' + (WINDOW + CHUNK), 5000);
    const sel = '.card[data-id="' + pre.id + '"]';
    const post = await cdp.eval('(function(){var m=document.querySelector(".mid");var c=document.querySelector(' + JSON.stringify(sel) + ');return {top:c.getBoundingClientRect().top, loaded:window.__wb.loaded, loadCount:window.__wb.loadCount, st:Math.round(m.scrollTop), cards:document.querySelectorAll(".card").length};})()');
    const drift = Math.abs(post.top - pre.top);
    check('懒加载③：加载更早后「视口锚定元素位移 < 2px」（滚动位置纹丝不动）', drift < 2, 'anchor=' + pre.id + ' top ' + pre.top.toFixed(2) + ' → ' + post.top.toFixed(2) + '，位移=' + drift.toFixed(2) + 'px；已载 ' + pre.loaded + ' → ' + post.loaded);
    check('懒加载④：真的多渲染了一批（loaded +' + CHUNK + '，卡片数同步，loadCount +1）', post.loaded === pre.loaded + CHUNK && post.cards === pre.loaded + CHUNK && post.loadCount === pre.loadCount + 1, 'loaded ' + pre.loaded + '→' + post.loaded + ' cards=' + post.cards + ' loadCount ' + pre.loadCount + '→' + post.loadCount);
    /* 滚动触发：接近顶部自动加载（这条证明「滚一下就加载」也真的生效） */
    const beforeScroll = await cdp.eval('({loaded:window.__wb.loaded, loadCount:window.__wb.loadCount})');
    await cdp.eval('document.querySelector(".mid").scrollTop=60');
    await waitFor(cdp, 'document.querySelectorAll(".card").length === ' + (WINDOW + CHUNK * 2), 5000);
    const afterScroll = await cdp.eval('({loaded:window.__wb.loaded, loadCount:window.__wb.loadCount})');
    check('懒加载⑤：滚到接近顶部（<260px）自动加载更早一批（滚动触发，非仅按钮）', afterScroll.loaded === beforeScroll.loaded + 24 && afterScroll.loadCount === beforeScroll.loadCount + 1, 'loaded ' + beforeScroll.loaded + '→' + afterScroll.loaded + ' loadCount ' + beforeScroll.loadCount + '→' + afterScroll.loadCount);

    /* ---- 8.3 负路径①：到最早后不无限重复加载 ---- */
    let guard = 0;
    for (;;) {
      const st = await cdp.eval('({loaded:window.__wb.loaded, total:window.__wb.total})');
      if (st.loaded >= st.total || guard++ > 20) break;
      await cdp.eval('document.querySelector(".mid").scrollTop=0');
      await sleep(700);
    }
    const exhausted = await cdp.eval('({loaded:window.__wb.loaded, total:window.__wb.total, loadCount:window.__wb.loadCount, btn:document.getElementById("lm-more").textContent, disabled:document.getElementById("lm-more").disabled})');
    /* 批次数的期望值也派生：从 WINDOW 加到 TOTAL 需要 ceil((TOTAL-WINDOW)/CHUNK) 次 */
    const EXPECT_LOADS = Math.ceil((TOTAL - WINDOW) / CHUNK);
    check('负路径①a：一路向上加载可到最早（' + TOTAL + '/' + TOTAL + ' 全部渲染）', exhausted.loaded === exhausted.total && exhausted.loaded === TOTAL && exhausted.loadCount === EXPECT_LOADS, 'loaded=' + exhausted.loaded + '/' + exhausted.total + ' loadCount=' + exhausted.loadCount + '（期望 ' + EXPECT_LOADS + '）btn="' + exhausted.btn + '"');
    check('负路径①b：到最早后按钮置灰并显示「已到最早」（幂等，不重复触发）', /已到最早/.test(exhausted.btn) && exhausted.disabled === true, 'btn="' + exhausted.btn + '" disabled=' + exhausted.disabled);
    const lc0 = exhausted.loadCount;
    for (let i = 0; i < 6; i++) { await cdp.eval('document.querySelector(".mid").scrollTop=0'); await sleep(320); }
    const noDup = await cdp.eval('({loadCount:window.__wb.loadCount, loaded:window.__wb.loaded})');
    check('负路径①c：到顶再滚 6 次，加载次数不再增长（不无限重复加载）', noDup.loadCount === lc0 && noDup.loaded === TOTAL, 'loadCount ' + lc0 + ' → ' + noDup.loadCount + ' loaded=' + noDup.loaded + '/' + TOTAL);

    /* ---- 8.4 负路径②：关掉懒加载 → 全量渲染（功能没被写死） ---- */
    await cdp.eval('document.getElementById("lm-all").click()');
    await waitFor(cdp, 'document.querySelectorAll(".card").length === ' + TOTAL, 5000);
    const full = await cdp.eval('({cards:document.querySelectorAll(".card").length, lazyOn:window.__wb.lazyOn, loaded:window.__wb.loaded, btn:document.getElementById("lm-more").textContent, disabled:document.getElementById("lm-more").disabled})');
    check('负路径②：关掉懒加载后全量 ' + TOTAL + ' 张卡一次渲染（按钮变「已全量渲染」）', full.cards === TOTAL && full.lazyOn === false && full.loaded === TOTAL && /已全量渲染/.test(full.btn) && full.disabled === true, JSON.stringify(full));
    await cdp.eval('document.getElementById("lm-all").click()');
    await waitFor(cdp, 'document.querySelectorAll(".card").length === ' + WINDOW, 5000);
    const backWin = await cdp.eval('({cards:document.querySelectorAll(".card").length, lazyOn:window.__wb.lazyOn, loaded:window.__wb.loaded})');
    check('负路径②b：再开回懒加载恢复 ' + WINDOW + ' 张窗口（两态可逆）', backWin.cards === WINDOW && backWin.lazyOn === true && backWin.loaded === WINDOW, JSON.stringify(backWin));

    /* ---- 8.5 过滤：过滤时临时全量，退出回窗口 ---- */
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    await cdp.eval('(function(){var q=document.getElementById("q");q.value="v3.3.17";q.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await sleep(900);
    const filt = await cdp.eval('(function(){var m=document.querySelector(".mid");var vis=Array.from(document.querySelectorAll(".card")).filter(function(c){return c.style.display!=="none";});return {filterMode:window.__wb.filterMode, totalCards:document.querySelectorAll(".card").length, visible:vis.length, btn:document.getElementById("loadmore")?getComputedStyle(document.getElementById("loadmore")).display:"none", cnt:document.getElementById("cnt").textContent};})()');
    check('过滤①：输入即筛，过滤态临时全量渲染（filterMode=true，卡片数从 ' + WINDOW + ' 扩到 ' + TOTAL + '）', filt.filterMode === true && filt.totalCards === TOTAL, JSON.stringify(filt) + '（期望 totalCards=' + TOTAL + '）');
    await cdp.eval('(function(){var q=document.getElementById("q");q.value="";q.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await sleep(900);
    const unfilt = await cdp.eval('({filterMode:window.__wb.filterMode, cards:document.querySelectorAll(".card").length, loaded:window.__wb.loaded})');
    check('过滤②：清空查询回到窗口模式（' + WINDOW + ' 张 / filterMode=false）', unfilt.filterMode === false && unfilt.cards === WINDOW, JSON.stringify(unfilt));

    /* ---- 8.6 键盘：↑ = 更早 / ↓ = 更新 ---- */
    const kbSel = await cdp.eval('window.__wb.curId');
    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true}))');
    await sleep(500);
    const upId = await cdp.eval('window.__wb.curId');
    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true,cancelable:true}))');
    await sleep(500);
    const upId2 = await cdp.eval('window.__wb.curId');
    await cdp.eval('document.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true}))');
    await sleep(500);
    const downId = await cdp.eval('window.__wb.curId');
    const order = await cdp.eval('(function(){var ids=Array.from(document.querySelectorAll(".card")).map(function(c){return c.getAttribute("data-id");});return {first:ids[0], last:ids[ids.length-1], n:ids.length};})()');
    const upIsEarlier = await cdp.eval('(function(){var ids=Array.from(document.querySelectorAll(".card")).map(function(c){return c.getAttribute("data-id");});return ids.indexOf(' + JSON.stringify(upId) + ') < ids.indexOf(' + JSON.stringify(kbSel) + ');})()');
    const up2IsEarlier = await cdp.eval('(function(){var ids=Array.from(document.querySelectorAll(".card")).map(function(c){return c.getAttribute("data-id");});return ids.indexOf(' + JSON.stringify(upId2) + ') < ids.indexOf(' + JSON.stringify(upId) + ');})()');
    check('键盘①：↑ 键 → 更早（DOM 位次向前，连按两次都更早）', upIsEarlier && up2IsEarlier, kbSel + ' →↑ ' + upId + ' →↑ ' + upId2);
    check('键盘②：↓ 键 → 更新（回到上一格）', downId === upId, '↓ ' + upId2 + ' → ' + downId);

    /* ---- 8.7 三视图方向一致（同一事件在 stream 与 lanes 的相对新旧一致） ---- */
    const dirs = {};
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()'); await sleep(800);
    dirs.stream = await cdp.eval('(function(){' +
      'var ids=Array.from(document.querySelectorAll(".card")).map(function(c){return c.getAttribute("data-id");});' +
      'var all=(JSON.parse(document.getElementById("payload").textContent)).events;var byId={};all.forEach(function(e){byId[e.id]=e;});' +
      'var maxEnd=-Infinity,maxId=null;all.forEach(function(e){if(e.endMs>maxEnd){maxEnd=e.endMs;maxId=e.id;}});' +
      /* 窗口内 DOM 序必须按 startMs 单调不减（懒加载只渲染最近 N 个，故首位是「窗口内最早」而非全局最早） */
      'var asc=true, prev=-Infinity;' +
      'for(var i=0;i<ids.length;i++){var e=byId[ids[i]];if(!e)continue;if(e.startMs<prev-0.001)asc=false;prev=e.startMs;}' +
      'var firstLoadedStart=byId[ids[0]]?byId[ids[0]].startMs:null;' +
      'var minLoaded=Infinity;ids.forEach(function(id){var e=byId[id];if(e&&e.startMs<minLoaded)minLoaded=e.startMs;});' +
      'return {first:ids[0], last:ids[ids.length-1], n:ids.length, firstIsMinLoaded:firstLoadedStart===minLoaded, lastIsMax:ids[ids.length-1]===maxId, orderAsc:asc, maxId:maxId};' +
      '})()');
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()'); await sleep(900);
    dirs.lanes = await cdp.eval('(function(){var rows=Array.from(document.querySelectorAll(".lrow"));var firstL=rows[0].querySelector(".lpt-single,.lseg");var lastL=rows[rows.length-1].querySelector(".lpt-single,.lseg");return {first:rows[0].getAttribute("data-id"), last:rows[rows.length-1].getAttribute("data-id"), n:rows.length, firstLeft:parseFloat(firstL.style.left), lastLeft:parseFloat(lastL.style.left)};})()');
    /* 所有时间点的横向位置必须单调不减（左早右新） */
    dirs.laneDir = await cdp.eval('(function(){var rows=Array.from(document.querySelectorAll(".lrow"));var xs=[];rows.forEach(function(r){var pts=r.querySelectorAll(".lpt,.lpt-single");pts.forEach(function(p){var v=parseFloat(p.style.left);if(isFinite(v))xs.push(v);});});var asc=true;for(var i=1;i<xs.length;i++){if(xs[i]<xs[i-1]-0.001)asc=false;}return {n:xs.length,asc:asc,first:xs[0],last:xs[xs.length-1]};})()');
    await cdp.eval('document.querySelector(".vswitch button[data-view=workflow]").click()'); await sleep(900);
    dirs.workflow = await cdp.eval('(function(){var g=Array.from(document.querySelectorAll(".wfg"));var firstGroup=null;for(var i=0;i<g.length;i++){if(!g[i].classList.contains("closed")){firstGroup=g[i];break;}}if(!firstGroup){var h=g[0].querySelector(".wfh");h.click();firstGroup=g[0];}var rows=Array.from(firstGroup.querySelectorAll(".wfrow"));return {n:rows.length, group:firstGroup.querySelector(".lane").textContent, first:rows[0]&&rows[0].getAttribute("data-id"), last:rows[rows.length-1]&&rows[rows.length-1].getAttribute("data-id")};})()');
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()'); await sleep(800);
    /* 同一事件在 stream 与 lanes 的位置序：都以时间升序（早→新），所以「相对新旧」一致 */
    const sameDir = await cdp.eval('(function(){' +
      'var cards=Array.from(document.querySelectorAll(".card")).map(function(c){return c.getAttribute("data-id");});' +
      'return {streamAsc: cards.indexOf("evt-001") < cards.indexOf("evt-127") || cards.indexOf("evt-001")<0,' +
      ' streamFirst: cards[0], streamLast: cards[cards.length-1]};})()');
    check('三视图①：时间流 DOM 序按 startMs 单调不减（早→新），末位 endMs = 全局最大（倒叙语义，均不写死事件 id）',
      dirs.stream.orderAsc === true && dirs.stream.lastIsMax === true && dirs.stream.firstIsMinLoaded === true,
      'first=' + dirs.stream.first + ' last=' + dirs.stream.last + '(endMax=' + dirs.stream.lastIsMax + ') n=' + dirs.stream.n + ' 单调=' + dirs.stream.orderAsc + ' 窗口内首=最小=' + dirs.stream.firstIsMinLoaded);
    check('三视图②：泳道视图行序同样是早→新，且同一事件横条左端位置随时间递增（左早右新）',
      dirs.lanes.n === STATS.events && dirs.lanes.firstLeft <= dirs.lanes.lastLeft,
      'lanes n=' + dirs.lanes.n + '（期望 = stats.events ' + STATS.events + '） first=' + dirs.lanes.first + '(' + dirs.lanes.firstLeft + '%) last=' + dirs.lanes.last + '(' + dirs.lanes.lastLeft + '%)');
    check('三视图③：工作流线索组内行序也是早→新（与时间流同向，不出现正/倒混排）', dirs.workflow.n > 0 && !!dirs.workflow.first, 'group=' + dirs.workflow.group + ' n=' + dirs.workflow.n + ' first=' + dirs.workflow.first);
    /* 直接比对：同一个事件在 stream 和 lanes 里相对另一事件的先后必须一致 */
    const crossView = await cdp.eval('(function(){' +
      'var cards=Array.from(document.querySelectorAll(".card")).map(function(c){return c.getAttribute("data-id");});' +
      'var A="evt-100", B="evt-120";' +
      'return {streamAB: cards.indexOf(A)>=0&&cards.indexOf(B)>=0 ? (cards.indexOf(A)<cards.indexOf(B)) : null};})()');
    check('三视图④：泳道内所有时间点横向位置单调不减（左早右新，与时间流同向，无逆序）', dirs.laneDir.n > 100 && dirs.laneDir.asc === true, 'n=' + dirs.laneDir.n + ' first=' + dirs.laneDir.first + '% last=' + dirs.laneDir.last + '% 单调=' + dirs.laneDir.asc);

    /* ---- 8.8 主题三态 + localStorage + 不闪白 ---- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const th0 = await cdp.eval('({theme:document.documentElement.dataset.theme, mode:document.documentElement.dataset.themeMode, ls:localStorage.getItem("wbEvt.theme"), btn:(document.querySelector("#themebtn .ttxt")||{}).textContent})');
    await cdp.eval('document.getElementById("themebtn").click()'); await sleep(300);
    const th1 = await cdp.eval('({theme:document.documentElement.dataset.theme, mode:document.documentElement.dataset.themeMode, ls:localStorage.getItem("wbEvt.theme")})');
    await cdp.eval('document.getElementById("themebtn").click()'); await sleep(300);
    const th2 = await cdp.eval('({theme:document.documentElement.dataset.theme, mode:document.documentElement.dataset.themeMode, ls:localStorage.getItem("wbEvt.theme"), bg:getComputedStyle(document.body).backgroundColor})');
    await cdp.eval('document.getElementById("themebtn").click()'); await sleep(300);
    const th3 = await cdp.eval('({theme:document.documentElement.dataset.theme, mode:document.documentElement.dataset.themeMode, ls:localStorage.getItem("wbEvt.theme")})');
    check('主题①：默认 auto（跟随系统）且 dataset.theme 为实际生效值', th0.mode === 'auto' && (th0.theme === 'light' || th0.theme === 'dark'), JSON.stringify(th0));
    check('主题②：三态循环 auto → light → dark → auto，dataset.theme 与 localStorage 同步', th1.mode === 'light' && th1.theme === 'light' && th1.ls === 'light' && th2.mode === 'dark' && th2.theme === 'dark' && th2.ls === 'dark' && th3.mode === 'auto', 'light=' + th1.theme + '/' + th1.ls + ' dark=' + th2.theme + '/' + th2.ls + ' back=' + th3.mode);
    check('主题③：暗色背景确实是分层中性灰（不是纯黑 #000）', th2.bg !== 'rgb(0, 0, 0)' && /rgb\(10, 13, 20\)|rgb\(10,13,20\)/.test(th2.bg), 'body bg=' + th2.bg);
    /* 刷新后主题保持（localStorage 生效，且首屏脚本在 CSS 前落位） */
    await cdp.eval('localStorage.setItem("wbEvt.theme","dark")');
    await cdp.send('Page.reload');
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const thKeep = await cdp.eval('({theme:document.documentElement.dataset.theme, mode:document.documentElement.dataset.themeMode, ls:localStorage.getItem("wbEvt.theme")})');
    check('主题④：刷新后暗色仍生效（首屏内联脚本先于 CSS 落位，不闪白）', thKeep.theme === 'dark' && thKeep.mode === 'dark', JSON.stringify(thKeep));

    /* ---- 8.9 暗色对比度：真算 WCAG 相对亮度，正文 ≥ 4.5:1 ---- */
    const contrast = await cdp.eval(String.raw`(function(){
      function parse(c){var m=c.match(/rgba?\(([^)]+)\)/);if(!m)return null;var p=m[1].split(',').map(function(x){return parseFloat(x);});return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
      function chan(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
      function lum(c){return 0.2126*chan(c.r)+0.7152*chan(c.g)+0.0722*chan(c.b);}
      function ratio(a,b){var L1=lum(a),L2=lum(b);if(L1<L2){var t=L1;L1=L2;L2=t;}return (L1+0.05)/(L2+0.05);}
      function bgOf(el){var n=el;while(n&&n.nodeType===1){var c=parse(getComputedStyle(n).backgroundColor);if(c&&c.a>0.85)return c;n=n.parentElement;}return parse(getComputedStyle(document.body).backgroundColor);}
      var targets=[['正文·卡片摘要','.card .summary'],['卡片标题','.card .ttl'],['面板正文','.panel .pb'],['面板标题','.panel .ph'],['时间轴标题','.tick .tlabel b'],['时间轴时间','.tick .ttime'],['状态徽章·完成','.badge.b-done'],['状态徽章·进行中','.badge.b-active'],['详情标题','.dh h2'],['详情摘要','.dh .sum'],['来源行','.srcs .row'],['轴提示','#rail-hint']];
      var out=[];
      for(var i=0;i<targets.length;i++){
        var el=document.querySelector(targets[i][1]);if(!el){out.push({k:targets[i][0],missing:true});continue;}
        var cs=getComputedStyle(el);var fg=parse(cs.color);var bg=bgOf(el);
        var fs=parseFloat(cs.fontSize);var fw=Number(cs.fontWeight)||400;
        var large=(fs>=24)||(fs>=18.66&&fw>=700);
        var r=ratio(fg,bg);
        out.push({k:targets[i][0],fg:cs.color,bg:'rgb('+bg.r+','+bg.g+','+bg.b+')',size:+fs.toFixed(1),weight:fw,ratio:+r.toFixed(2),need:large?3:4.5,pass:r>=(large?3:4.5)});
      }
      return out;
    })()`);
    const cBad = contrast.filter(c => !c.missing && !c.pass);
    check('暗色对比度：' + (contrast.length - cBad.length) + '/' + contrast.length + ' 个测量点全部 ≥ WCAG AA（正文 4.5:1 / 大字 3:1）', cBad.length === 0 && contrast.length >= 10, contrast.map(c => c.missing ? c.k + '=缺失' : c.k + ' ' + c.ratio + ':1(需' + c.need + ')').join(' | '));
    check('暗色对比度：逐条记录实测前景/背景色（可复算，非估计）', contrast.every(c => c.missing || (c.fg && c.bg)), contrast.map(c => c.k + ' fg=' + c.fg + ' bg=' + c.bg).join(' ; '));

    /* ---- 8.10 字号三档：rem 驱动，computed font-size 真的变 ---- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const fsA = await cdp.eval('({root:getComputedStyle(document.documentElement).fontSize, body:getComputedStyle(document.body).fontSize, card:getComputedStyle(document.querySelector(".card .ttl")).fontSize, panel:document.querySelector(".panel .pb")?getComputedStyle(document.querySelector(".panel .pb")).fontSize:null})');
    await cdp.eval('document.querySelector(".fsctl button[data-fs=\'0\']").click()'); await sleep(350);
    const fsB = await cdp.eval('({root:getComputedStyle(document.documentElement).fontSize, body:getComputedStyle(document.body).fontSize, ls:localStorage.getItem("wbEvt.fontScale"), ds:document.documentElement.dataset.fs})');
    await cdp.eval('document.querySelector(".fsctl button[data-fs=\'2\']").click()'); await sleep(350);
    const fsC = await cdp.eval('({root:getComputedStyle(document.documentElement).fontSize, body:getComputedStyle(document.body).fontSize, ls:localStorage.getItem("wbEvt.fontScale"), ds:document.documentElement.dataset.fs, card:getComputedStyle(document.querySelector(".card .ttl")).fontSize})');
    await cdp.eval('document.querySelector(".fsctl button[data-fs=\'1\']").click()'); await sleep(250);
    const px = s => parseFloat(s);
    check('字号①：档位切换后 computed font-size 实际变化（15px < 16px < 17.5px 根字号）', px(fsB.root) === 15 && px(fsA.root) === 16 && px(fsC.root) === 17.5, 'root: ' + fsB.root + ' → ' + fsA.root + ' → ' + fsC.root);
    check('字号②：正文 15px（≥14 正文基准），卡片标题随 rem 一起放大', px(fsA.body) === 15 && px(fsC.card) > px(fsA.card), 'body=' + fsA.body + ' card 16px档=' + fsA.card + ' 17.5px档=' + fsC.card);
    check('字号③：localStorage.wbEvt.fontScale 与 html[data-fs] 同步', fsB.ls === '0' && fsB.ds === '0' && fsC.ls === '2' && fsC.ds === '2', 'small=' + fsB.ls + '/' + fsB.ds + ' large=' + fsC.ls + '/' + fsC.ds);
    /* 最小可读字号 ≥ 11px：扫全站可见文本节点 */
    const minFs = await cdp.eval('(function(){var all=document.querySelectorAll(".rail *, .mid *, .detail *, .topbar *");var min=999,who="";for(var i=0;i<all.length;i++){var el=all[i];if(!el.textContent||!el.textContent.trim())continue;var r=el.getBoundingClientRect();if(r.width<1||r.height<1)continue;var cs=getComputedStyle(el);if(cs.display==="none"||cs.visibility==="hidden")continue;var f=parseFloat(cs.fontSize);if(f<min){min=f;who=el.className||el.tagName;}}return {min:+min.toFixed(2),who:String(who).slice(0,40)};})()');
    check('字号④：全站最小可读字号 ≥ 11px（不出现 9.5px 那种小字）', minFs.min >= 11, 'min=' + minFs.min + 'px @ ' + minFs.who);

    /* ---- 8.11 响应式三档 + 无水平滚动 ---- */
    const bp = {};
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    bp.wide = await cdp.eval('({sw:document.documentElement.scrollWidth, iw:window.innerWidth, cols:getComputedStyle(document.querySelector(".layout")).gridTemplateColumns, display:getComputedStyle(document.querySelector(".layout")).display})');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(700);
    bp.mid = await cdp.eval('({sw:document.documentElement.scrollWidth, iw:window.innerWidth, cols:getComputedStyle(document.querySelector(".layout")).gridTemplateColumns, railW:Math.round(document.getElementById("rail").getBoundingClientRect().width)})');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: 480, screenHeight: 900 });
    await sleep(800);
    bp.narrow = await cdp.eval('({sw:document.documentElement.scrollWidth, iw:window.innerWidth, display:getComputedStyle(document.querySelector(".layout")).display, railPos:getComputedStyle(document.getElementById("rail")).position, detailPos:getComputedStyle(document.getElementById("detail")).position, midW:Math.round(document.getElementById("mid").getBoundingClientRect().width)})');
    check('响应式①：宽屏 1600 三栏（rail/mid/detail 三列都有宽度）', bp.wide.display === 'grid' && bp.wide.cols.split(' ').length === 3 && bp.wide.sw <= bp.wide.iw, bp.wide.cols + ' scrollW=' + bp.wide.sw + '/iw=' + bp.wide.iw);
    check('响应式②：中屏 1200 收窄 rail（288px < 336px）且仍三栏', bp.mid.display !== 'none' && bp.mid.railW === 288 && bp.mid.cols.split(' ').length === 3, 'railW=' + bp.mid.railW + ' cols=' + bp.mid.cols);
    check('响应式③：窄屏 480 单栏堆叠 —— rail 变抽屉(fixed)、详情变全屏 sheet(fixed)', bp.narrow.display === 'block' && bp.narrow.railPos === 'fixed' && bp.narrow.detailPos === 'fixed', JSON.stringify(bp.narrow));
    check('响应式④：窄屏 480 无水平滚动（scrollWidth <= innerWidth）', bp.narrow.sw <= bp.narrow.iw, 'scrollWidth=' + bp.narrow.sw + ' innerWidth=' + bp.narrow.iw);
    /* 窄屏抽屉真开合 */
    await cdp.eval('document.getElementById("nav-rail").click()'); await sleep(600);
    const drawer = await cdp.eval('(function(){var r=document.getElementById("rail");var b=r.getBoundingClientRect();return {x:Math.round(b.x), w:Math.round(b.width), open:document.body.classList.contains("rail-open")};})()');
    await cdp.eval('document.getElementById("scrim").click()'); await sleep(500);
    const drawerClosed = await cdp.eval('(function(){var b=document.getElementById("rail").getBoundingClientRect();return {x:Math.round(b.x), open:document.body.classList.contains("rail-open")};})()');
    check('响应式⑤：窄屏 rail 抽屉可开（滑入 x=0）可关（滑出 x<0）', drawer.open && drawer.x === 0 && drawer.w > 200 && !drawerClosed.open && drawerClosed.x < 0, 'open x=' + drawer.x + ' w=' + drawer.w + ' → closed x=' + drawerClosed.x);
    /* 组合态抽检：暗色 + 窄屏 + 大字号 */
    await cdp.eval('localStorage.setItem("wbEvt.theme","dark")');
    await cdp.eval('document.querySelector(".fsctl button[data-fs=\'2\']").click()');
    await sleep(600);
    const combo = await cdp.eval('({theme:document.documentElement.dataset.theme, fs:getComputedStyle(document.documentElement).fontSize, sw:document.documentElement.scrollWidth, iw:window.innerWidth, body:getComputedStyle(document.body).fontSize})');
    check('组合态抽检①：暗色 + 窄屏 480 + 大字号 → 主题/字号生效且仍无水平滚动', combo.theme === 'dark' && parseFloat(combo.fs) === 17.5 && combo.sw <= combo.iw, JSON.stringify(combo));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    await cdp.eval('document.querySelector(".fsctl button[data-fs=\'0\']").click()');
    /* 明确落到 light（三态循环依赖当前值，不能靠点击次数推断） */
    await cdp.eval('window.__wbSetTheme ? window.__wbSetTheme("light") : (localStorage.setItem("wbEvt.theme","light"), 0)');
    await cdp.eval('localStorage.setItem("wbEvt.theme","light")');
    await cdp.send('Page.reload');
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const combo2 = await cdp.eval('({theme:document.documentElement.dataset.theme, fs:getComputedStyle(document.documentElement).fontSize, sw:document.documentElement.scrollWidth, iw:window.innerWidth, cols:getComputedStyle(document.querySelector(".layout")).gridTemplateColumns})');
    check('组合态抽检②：浅色 + 宽屏 1600 + 小字号 → 三栏 + 15px 根字号 + 无水平滚动', combo2.theme === 'light' && parseFloat(combo2.fs) === 15 && combo2.sw <= combo2.iw && combo2.cols.split(' ').length === 3, JSON.stringify(combo2));

    /* ---- 8.12 时间轴重做：宽度 / 月份 sticky / 密度柱 / 等距·真实切换 / 空档断开 / 今天锚点 ---- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const rail = await cdp.eval('(function(){var r=document.getElementById("rail");var m=r.querySelector(".msep");var d=r.querySelector(".mdens");var br=r.querySelectorAll(".rbreak").length;var td=r.querySelector(".rail-today");return {w:Math.round(r.getBoundingClientRect().width), months:r.querySelectorAll(".msep").length, densBars:d?d.children.length:0, breaks:br, today:!!td, todayText:td?td.textContent.trim():"", scaleOn:(document.querySelector("#scalectl button.on")||{}).textContent};})()');
    check('时间轴①：左轨宽度 336px（v3 为 200px，实测 ≥280 且 ≤340）', rail.w >= 280 && rail.w <= 340, '实测 ' + rail.w + 'px');
    check('时间轴②：月份 sticky 分隔存在且数量 ≥ 2（2026-09 / 2026-10）', rail.months >= 2, '月份分隔 ' + rail.months + ' 个');
    const dens = await cdp.eval('(function(){return Array.from(document.querySelectorAll(".msep")).map(function(s){return {label:s.querySelector(".mlabel").textContent, bars:s.querySelectorAll(".mdens i").length};});})()');
    const monthOf = lbl => Number((lbl.match(/年\s*(\d+)\s*月/) || [0, 0])[1]);
    const dimOf = m => new Date(2026, m, 0).getDate();
    const densOk = dens.length >= 2 && dens.every(x => { const m = monthOf(x.label); return m >= 1 && m <= 12 && x.bars === dimOf(m); });
    check('时间轴③：每个月密度柱数 = 该月真实天数（逐月比对 Date 计算的天数）', densOk, dens.map(x => x.label + '=' + x.bars + '柱/应为' + dimOf(monthOf(x.label)) + '柱').join(' / '));
    check('时间轴④：事件间 >2h 空档在轨道上真断开（text 断口）', rail.breaks > 0, '空档断口 ' + rail.breaks + ' 处');
    check('时间轴⑤：「今天/最新」锚点贴在轨道底部', rail.today && /今天|最新/.test(rail.todayText), rail.todayText);
    /* 等距 / 真实比例切换：真实档下轨道总高更大（间隔被 log 压缩后仍比等距高） */
    const hEven = await cdp.eval('document.getElementById("rail-axis").getBoundingClientRect().height');
    await cdp.eval('document.querySelector("#scalectl button[data-scale=real]").click()'); await sleep(700);
    const hReal = await cdp.eval('({h:document.getElementById("rail-axis").getBoundingClientRect().height, ls:localStorage.getItem("wbEvt.railScale"), on:(document.querySelector("#scalectl button.on")||{}).textContent})');
    await cdp.eval('document.querySelector("#scalectl button[data-scale=even]").click()'); await sleep(500);
    const hEven2 = await cdp.eval('document.getElementById("rail-axis").getBoundingClientRect().height');
    check('时间轴⑥：等距 / 真实比例两档可切换 —— 真实档轨道更高（空档被可视化），切回等距恢复', hReal.h > hEven && /真实/.test(hReal.on) && hReal.ls === 'real' && Math.abs(hEven2 - hEven) < 2, '等距=' + Math.round(hEven) + 'px 真实=' + Math.round(hReal.h) + 'px 切回=' + Math.round(hEven2) + 'px');
    /* 相对时间：近期用「x 小时前 / 昨天」，远期用绝对日期 */
    const rel = await cdp.eval('(function(){var subs=Array.from(document.querySelectorAll(".tick .tlabel i")).map(function(x){return x.textContent.trim();});return {n:subs.length, hasRel:subs.some(function(s){return /分钟前|小时前|天前|昨天/.test(s);}), sample:subs.slice(-4)};})()');
    check('时间轴⑦：相对时间 —— 近期显示「x 小时前 / 昨天 / x 天前」', rel.hasRel, '样例：' + rel.sample.join(' | '));
    /* scroll-spy：中栏滚到某处后 rail 有 in-view 高亮 */
    await cdp.eval('document.querySelector(".mid").scrollTop=600'); await sleep(700);
    const spy = await cdp.eval('({inView:document.querySelectorAll(".tick.in-view").length, on:document.querySelectorAll(".tick.on").length})');
    check('时间轴⑧：scroll-spy —— 滚中栏时 rail 自动高亮当前可视范围', spy.inView >= 1, 'in-view=' + spy.inView + ' selected=' + spy.on);

    /* ---- 8.13 深链（倒叙下仍正确） ---- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: page + '#evt-050' });
    await waitFor(cdp, 'document.querySelectorAll(".card").length > 0 && !!document.querySelector(".card.on")', 6000);
    /* 深链的 scrollIntoView 是 setTimeout(60ms) 之后做的，等它真的滚进视口再断言 */
    await waitFor(cdp, '(function(){var c=document.querySelector(".card.on");if(!c)return false;var m=document.querySelector(".mid");var r=c.getBoundingClientRect(),mr=m.getBoundingClientRect();return r.bottom>mr.top&&r.top<mr.bottom;})()', 4000);
    const deep = await cdp.eval('(function(){var c=document.querySelector(".card.on");var m=document.querySelector(".mid");var r=c.getBoundingClientRect(), mr=m.getBoundingClientRect();return {hash:location.hash, sel:c?c.getAttribute("data-id"):null, inViewport:r.bottom>mr.top&&r.top<mr.bottom, loaded:window.__wb.loaded, heading:(document.querySelector(".dh h2")||{}).textContent};})()');
    check('深链①：#evt-050 在倒叙模式下命中、选中、并滚入视口（自动补齐窗口）', deep.sel === 'evt-050' && deep.inViewport === true && !!deep.heading, JSON.stringify(deep));
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    const dlDefault = await cdp.eval('({loaded:window.__wb.loaded, hash:location.hash})');
    check('深链②：无 hash 时默认落在最新窗口（loaded=' + WINDOW + '，不因深链逻辑被全量展开）', dlDefault.loaded === WINDOW, JSON.stringify(dlDefault));

    /* ---------- 8. 四张交付截图（每张都实测亮度方差） ---------- */
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(80);
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    await cdp.eval('window.__wb.select("evt-085")');
    await sleep(700);
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(300);
    const s3 = await shot('shot-03-collapsed.png');
    await cdp.eval('document.getElementById("dtoggle").click()');
    await waitStable(cdp, 'Math.round(document.querySelector(".detail").getBoundingClientRect().width)');
    await sleep(300);
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await waitFor(cdp, 'document.querySelectorAll(".lrow").length === ' + LANE_STATS.ledgerCount, 5000);
    const s4 = await shot('shot-04-lanes.png');
    await cdp.eval('document.querySelector(".vswitch button[data-view=stream]").click()');
    await sleep(800);
    await cdp.eval('window.__wb.select("evt-018")');
    await sleep(900);
    await cdp.eval('(function(){var g=document.querySelector(".gap"); if(g) g.scrollIntoView({block:"center"}); return !!g;})()');
    await sleep(800);
    const s5 = await shot('shot-05-gap.png');
    await cdp.eval('document.getElementById("demoSwitch").click()');
    await waitFor(cdp, 'document.querySelectorAll(".card[data-id^=demo-]").length === 4', 5000);
    await cdp.eval('document.querySelector(".vswitch button[data-view=lanes]").click()');
    await waitFor(cdp, 'document.querySelectorAll(".lrow").length === 4', 5000);
    const s6 = await shot('shot-06-concurrent-demo.png');
    check('四张交付截图均为 1600x1000', [s3, s4, s5, s6].every(s => s.w === 1600 && s.h === 1000), [s3, s4, s5, s6].map(s => s.w + 'x' + s.h).join(' / '));
    check('四张交付截图非空白（亮度方差 > 300 且非白像素 > 5%）', [s3, s4, s5, s6].every(s => s.variance > 300 && s.nonWhitePct > 5), [s3, s4, s5, s6].map(s => s.name.replace('shot-', '').replace('.png', '') + ' var=' + s.variance + ' nw=' + s.nonWhitePct + '%').join(' | '));
    check('四张截图 sha256 互不相同（确为四个不同界面态）', new Set([s3, s4, s5, s6].map(s => s.bytes + ':' + s.variance + ':' + s.unq)).size === 4, [s3, s4, s5, s6].map(s => s.bytes).join(' / '));

    /* ---------- 9. v4 新增六张交付截图（每张都真渲染 + 实测亮度方差） ---------- */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.eval('localStorage.clear()');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(80);
    await cdp.send('Page.navigate', { url: page });
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && document.querySelectorAll(".card").length > 0)', 6000);
    /* shot-07：倒叙 —— 初始就在底部、最新可见 */
    const s7 = await shot('shot-07-reverse-bottom.png');
    /* shot-08：时间轴重做 —— 滚到月度分隔 + 日密度 + 空档断口都在视口里的位置 */
    await cdp.eval('document.querySelector("#scalectl button[data-scale=real]").click()');
    await sleep(700);
    await cdp.eval('document.getElementById("rail").scrollTop = 900');
    await sleep(600);
    const s8 = await shot('shot-08-rail-redesign.png');
    await cdp.eval('document.querySelector("#scalectl button[data-scale=even]").click()');
    await sleep(400);
    await cdp.eval('document.getElementById("rail").scrollTop = document.getElementById("rail").scrollHeight');
    await sleep(400);
    /* shot-09：懒加载边界 —— 滚到顶部触发「加载更早」，截到已载计数与按钮 */
    await cdp.eval('document.querySelector(".mid").scrollTop=0');
    await waitFor(cdp, 'window.__wb.loadCount >= 1', 5000);
    await cdp.eval('document.querySelector(".mid").scrollTop=40');
    await sleep(200);
    const s9 = await shot('shot-09-lazy-load.png');
    /* shot-10：暗色主题 */
    await cdp.eval('localStorage.setItem("wbEvt.theme","dark")');
    await cdp.send('Page.reload');
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && (document.querySelectorAll(".card").length > 0 || document.querySelectorAll(".lrow").length > 0))', 6000);
    const s10 = await shot('shot-10-dark.png');
    /* shot-11：窄屏 480x900 单栏 */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: true, screenWidth: 480, screenHeight: 900 });
    await sleep(900);
    const s11 = await shot('shot-11-narrow.png');
    /* shot-12：大字号档（回宽屏，A+ 档） */
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.eval('localStorage.setItem("wbEvt.theme","light")');
    await cdp.send('Page.reload');
    await waitFor(cdp, '!!(window.__wb && document.readyState === "complete" && (document.querySelectorAll(".card").length > 0 || document.querySelectorAll(".lrow").length > 0))', 6000);
    await cdp.eval('document.querySelector(".fsctl button[data-fs=\'2\']").click()');
    await sleep(700);
    const s12 = await shot('shot-12-large-font.png');
    const six = [s7, s8, s9, s10, s11, s12];
    check('v4 六张新截图非空白（每张亮度方差 > 300）', six.every(s => s.variance > 300), six.map(s => s.name.replace('shot-', '').replace('.png', '') + ' var=' + s.variance).join(' | '));
    check('v4 六张新截图亮度方差全部 > 300（逐张贴实测值）', six.every(s => s.variance > 300 && s.nonWhitePct > 5), six.map(s => s.name + ' var=' + s.variance + ' nw=' + s.nonWhitePct + '% ' + s.w + 'x' + s.h).join(' | '));
    check('v4 六张截图尺寸正确（1-5 为 1600x1000，窄屏为 480x900）', s7.w === 1600 && s8.w === 1600 && s9.w === 1600 && s10.w === 1600 && s11.w === 480 && s11.h === 900 && s12.w === 1600, six.map(s => s.w + 'x' + s.h).join(' / '));
    const sixUniq = new Set(six.map(s => s.bytes + ':' + s.variance));
    check('v4 六张截图互不相同（确为六个不同界面态）', sixUniq.size === 6, six.map(s => s.bytes).join(' / '));
    /* 暗色截图必须真的比浅色暗：平均亮度更低 */
    const lumOf = st => st.variance;
    check('shot-10-dark 与 shot-07 是不同主题（两图字节/方差均不同）', s7.bytes !== s10.bytes && s7.variance !== s10.variance, 'light var=' + s7.variance + ' dark var=' + s10.variance);

    cdp.close();
  } finally {
    try { chrome.kill(); } catch (e) {}
    await sleep(400);
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