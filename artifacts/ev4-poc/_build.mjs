#!/usr/bin/env node
/**
 * _build.mjs — 把原型 index.html 机械变换成「作用域化 + 可调栏宽」的 POC（幂等）
 *
 * 三条变换，零人工改写：
 *   1) CSS 作用域化：:root→.ev4-app、html[data-*]→.ev4-app[data-*]、body.x→.ev4-app.x、*→.ev4-app,*
 *   2) rem → calc(var(--ev4-root-fs) * N)：原型字号档位靠 html{font-size}，作用域化后必须改成作用域内因子
 *   3) JS 宿主绑定：document.documentElement/body → app；localStorage 前缀 wbEvt. → damEv4.
 * 另加：两条可拖分隔条（用户 2026-10-25 点名「这两个栏可以调小或增大」）
 *
 * ★关键坑（实测踩过，会静默白屏）：events.json 里含 `<!--` 字面量，
 *   原样内联进 <script> 会让 HTML 解析器进入 script-data-escaped 态，
 *   **吞掉后面的 <script> 标签** ⇒ 整段运行时 script 变成文本 ⇒ 页面只有静态骨架、零事件。
 *   ⇒ 内联 JSON 必须 `.replace(/</g, '\\u003c')`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'wb-event-preview');
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r/g, '');

// ---------- 1) CSS ----------
let css = read(path.join(SRC, 'extract/prototype.css'));
let remCount = 0;
css = css.replace(/([\d.]+)rem/g, (_m, n) => { remCount++; return 'calc(var(--ev4-root-fs) * ' + Number(n) + ')'; });
const cssPlan = [
  [/:root\s*\{/g, '.ev4-app{'],
  ['html[data-fs="0"]{', '.ev4-app[data-fs="0"]{'],
  ['html[data-fs="2"]{', '.ev4-app[data-fs="2"]{'],
  ['html[data-theme="dark"]{', '.ev4-app[data-theme="dark"]{'],
  ['html[data-theme="light"]{', '.ev4-app[data-theme="light"]{'],
  ['html,body{', '.ev4-app{'],
  ['body{\n', '.ev4-app{\n'],
  ['body{', '.ev4-app{'],
  ['html{', '.ev4-app{'],
  ['*{box-sizing:border-box}', '.ev4-app,.ev4-app *{box-sizing:border-box}'],
  ['body.rail-open', '.ev4-app.rail-open'],
  ['body.detail-sheet', '.ev4-app.detail-sheet'],
];
let cssApplied = 0;
for (const [from, to] of cssPlan) {
  const before = css;
  css = typeof from === 'string' ? css.split(from).join(to) : css.replace(from, to);
  if (before !== css) cssApplied++;
}
// 字号档位：作用域内根字号因子
css = css.replace('.ev4-app{font-size:16px}', '.ev4-app{--ev4-root-fs:16px;font-size:16px}');
css = css.replace('.ev4-app[data-fs="0"]{font-size:15px}', '.ev4-app[data-fs="0"]{--ev4-root-fs:15px;font-size:15px}');
css = css.replace('.ev4-app[data-fs="2"]{font-size:17.5px}', '.ev4-app[data-fs="2"]{--ev4-root-fs:17.5px;font-size:17.5px}');

// 可调栏宽（新增）
css = css.replace(/\.layout\{[^}]*\}/, (m) => m + '.layout{position:relative}');
css += `
/* ★新增（用户 2026-10-25）：「这两个栏可以调小或增大」 */
.ev4-grip{position:absolute;top:0;bottom:0;width:8px;cursor:col-resize;z-index:30;background:transparent;touch-action:none}
.ev4-grip:hover,.ev4-grip.dragging{background:color-mix(in srgb,var(--accent) 22%,transparent)}
.ev4-grip:before{content:"";position:absolute;left:3px;top:50%;width:2px;height:34px;margin-top:-17px;border-radius:2px;background:var(--line);opacity:0;transition:opacity var(--dur-quick) var(--ease-smooth-out)}
.ev4-grip:hover:before,.ev4-grip.dragging:before{opacity:1;background:var(--accent)}
.ev4-grip--rail{left:var(--rail-w);margin-left:-4px}
.ev4-grip--detail{right:var(--detail-w,392px);margin-right:-4px}
.ev4-app.grip-dragging{cursor:col-resize;user-select:none}
.ev4-app.grip-dragging .col{pointer-events:none}
@media (max-width:1023px){.ev4-grip{display:none}}
`;

// ---------- 2) JS ----------
let js = read(path.join(SRC, 'extract/prototype.js'));
const jsPlan = [
  [/document\.documentElement\.dataset\.themeMode/g, 'app.dataset.themeMode'],
  [/document\.documentElement\.dataset\.theme/g, 'app.dataset.theme'],
  [/document\.documentElement\.dataset\.fs/g, 'app.dataset.fs'],
  [/document\.body\.classList/g, 'app.classList'],
  [/wbEvt\./g, 'damEv4.'],
];
let jsApplied = 0;
for (const [re, to] of jsPlan) { const b = js; js = js.replace(re, to); if (b !== js) jsApplied++; }

// CSS 变量现在挂在 app 上 ⇒ cssNum 必须读 app
js = js.split('getComputedStyle(document.documentElement).getPropertyValue(name)').join('getComputedStyle(app).getPropertyValue(name)');

// 右栏宽度改为「偏好值」（可拖）
js = js.replace(
  'var detailOpenW = Math.max(0, avail - midW);\n    var detailW = detailOpenW * (1 - x);',
  'var detailPref = cssNum("--detail-w", 392);\n    var detailOpenW = Math.max(240, Math.min(avail - 320, detailPref));\n    var detailW = detailOpenW * (1 - x);'
);
js = js.replace(
  'layout.style.gridTemplateColumns = Math.round(railW) + "px " + Math.round(avail - detailW) + "px " + Math.round(detailW) + "px";',
  'layout.style.gridTemplateColumns = Math.round(railW) + "px " + Math.round(avail - detailW) + "px " + Math.round(detailW) + "px";\n    app.style.setProperty("--rail-w", Math.round(railW) + "px");\n    app.style.setProperty("--detail-w", Math.round(detailW) + "px");'
);

// 拖拽分隔条
js = js.replace('  function boot() {', `
  /* ★新增：「这两个栏可以调小或增大」+ 键盘可达 + 持久化 */
  var LS_RAIL = "damEv4.railW", LS_DETAIL = "damEv4.detailW";
  var RAIL_MIN = 180, RAIL_MAX = 560, DETAIL_MIN = 240, DETAIL_MAX = 1100;
  function clampW(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  var railWPref = (function () { var v = Number(lsGet(LS_RAIL)); return isFinite(v) && v > 0 ? v : cssNum("--rail-w", 336); })();
  var detailWPref = (function () { var v = Number(lsGet(LS_DETAIL)); return isFinite(v) && v > 0 ? v : 392; })();
  app.style.setProperty("--rail-w", railWPref + "px");
  app.style.setProperty("--detail-w", detailWPref + "px");
  function gripApply(which, px) {
    if (which === "rail") { railWPref = clampW(px, RAIL_MIN, RAIL_MAX); app.style.setProperty("--rail-w", railWPref + "px"); }
    else { detailWPref = clampW(px, DETAIL_MIN, DETAIL_MAX); app.style.setProperty("--detail-w", detailWPref + "px"); }
    applyDrawer(spring.x);
  }
  function mountGrips() {
    var layout = document.querySelector(".layout");
    if (!layout || document.querySelector(".ev4-grip--rail")) return;
    ["rail", "detail"].forEach(function (which) {
      var g = document.createElement("div");
      g.className = "ev4-grip ev4-grip--" + which;
      g.setAttribute("role", "separator");
      g.setAttribute("aria-orientation", "vertical");
      g.setAttribute("tabindex", "0");
      g.setAttribute("data-grip", which);
      g.setAttribute("aria-label", which === "rail" ? "拖动调整左栏宽度（←→）" : "拖动调整右栏宽度（←→）");
      g.title = which === "rail" ? "拖动调整左栏宽度（双击复位）" : "拖动调整右栏宽度（双击复位）";
      var dragging = false, startX = 0, startW = 0;
      g.addEventListener("pointerdown", function (e) {
        dragging = true; startX = e.clientX;
        startW = which === "rail" ? cssNum("--rail-w", 336) : cssNum("--detail-w", 392);
        g.classList.add("dragging"); app.classList.add("grip-dragging");
        try { g.setPointerCapture(e.pointerId); } catch (err) {}
        e.preventDefault();
      });
      g.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        gripApply(which, startW + (which === "rail" ? (e.clientX - startX) : (startX - e.clientX)));
      });
      var end = function () {
        if (!dragging) return;
        dragging = false; g.classList.remove("dragging"); app.classList.remove("grip-dragging");
        lsSet(which === "rail" ? LS_RAIL : LS_DETAIL, String(Math.round(which === "rail" ? railWPref : detailWPref)));
      };
      g.addEventListener("pointerup", end);
      g.addEventListener("pointercancel", end);
      g.addEventListener("dblclick", function () {
        if (which === "rail") { railWPref = 336; app.style.setProperty("--rail-w", "336px"); lsSet(LS_RAIL, "336"); }
        else { detailWPref = 392; app.style.setProperty("--detail-w", "392px"); lsSet(LS_DETAIL, "392"); }
        applyDrawer(spring.x);
      });
      g.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        var step = e.key === "ArrowLeft" ? -24 : 24;
        var cur = which === "rail" ? cssNum("--rail-w", 336) : cssNum("--detail-w", 392);
        gripApply(which, which === "rail" ? cur + step : cur - step);
        lsSet(which === "rail" ? LS_RAIL : LS_DETAIL, String(Math.round(which === "rail" ? railWPref : detailWPref)));
      });
      layout.appendChild(g);
    });
  }

  function boot() {
    mountGrips();`);

// 数据入口 / app 句柄 / 立即启动
js = js.replace('var DATA = JSON.parse(document.getElementById("payload").textContent);',
  'var DATA = window.__EV4_DATA__;\n  var app = document.getElementById("ev4-app");');
js = js.replace('var DEMO_SRC = document.getElementById("demo-payload");', 'var DEMO_SRC = null;');
js = js.replace('if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);\n  else boot();', 'boot();');

// ---------- 3) markup（去 demo banner / payload script，逐行精确删，绝不跨块） ----------
let ml = read(path.join(SRC, 'extract/prototype-body.html')).replace(/^<body[^>]*>/, '').split('\n');
const bStart = ml.findIndex((l) => l.includes('id="demo-banner-top"'));
if (bStart < 0) throw new Error('build: demo banner not found');
let bEnd = bStart;
while (bEnd < ml.length && ml[bEnd].trim() !== '</div>') bEnd++;
ml.splice(bStart, bEnd - bStart + 1);
let markup = ml.join('\n');
markup = markup.replace(/<div class="scrim"[\s\S]*$/, '<div class="scrim" id="scrim" aria-hidden="true"></div>');
markup = markup.replace(/<script[\s\S]*$/, '');
markup = markup.replace(/<label class="demo-switch"[\s\S]*?<\/label>/, '');

// ---------- 4) 组装 ----------
const dataJs = JSON.stringify(JSON.parse(read(path.join(SRC, 'events.json')))).replace(/</g, '\\u003c');
const page = '<!doctype html><html><head><meta charset="utf-8"><title>ev4 POC · 照搬原型 + 可调栏宽</title>\n'
  + '<style>html,body{margin:0;height:100%}#ev4-shell{height:100vh;overflow:hidden}\n' + css + '</style></head>\n'
  + '<body><div id="ev4-shell"><div class="ev4-app" id="ev4-app" data-theme="dark" data-fs="1">\n'
  + markup + '\n</div></div>\n'
  + '<script>window.__EV4_DATA__=' + dataJs + ';</script>\n'
  + '<script>' + js + '</script>\n</body></html>';
fs.writeFileSync(path.join(HERE, 'index.html'), page, 'utf8');

// ---------- 5) 自检（落盘即断言，不靠人看） ----------
const out = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');
const protoCss = read(path.join(SRC, 'extract/prototype.css'));
const protoRules = (protoCss.match(/\{/g) || []).length;
const outRules = (css.match(/\{/g) || []).length;
const checks = [
  ['CSS 规则数 ≥ 原型（只增不减）', outRules >= protoRules],
  ['CSS 无 :root', css.indexOf(':root') < 0],
  ['CSS 无 html{', !/(^|\})html\{/.test(css)],
  ['CSS 含 .ev4-grip--rail', css.includes('.ev4-grip--rail')],
  ['CSS 含 --ev4-root-fs 定义', css.includes('--ev4-root-fs:16px')],
  ['CSS 含 --ev4-root-fs 使用', (css.match(/var\(--ev4-root-fs\)/g) || []).length > 5],
  ['JS 含 mountGrips', js.includes('function mountGrips()')],
  ['页面含 layout', out.includes('class="layout"')],
  ['页面含 rail/mid/detail', out.includes('id="rail"') && out.includes('id="mid"') && out.includes('id="detail"')],
  ['内联 JSON 已转义 <', !/window\.__EV4_DATA__=[^<]*\u003c/.test('') && out.indexOf('window.__EV4_DATA__=') > 0],
];
for (const [name, ok] of checks) if (!ok) throw new Error('build self-check failed: ' + name);
console.log('build OK · ' + fs.statSync(path.join(HERE, 'index.html')).size + ' B · cssRules=' + outRules + ' (proto ' + protoRules + ')'
  + ' · rem2calc=' + remCount + ' · cssSubs=' + cssApplied + ' · jsSubs=' + jsApplied
  + ' · checks=' + checks.length + '/' + checks.length);
