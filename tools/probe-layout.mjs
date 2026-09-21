import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

/* 布局/可见性细查：把「点不了 / 看不到 / 比例不对」变成数字
   用法: node tools/probe-layout.mjs site/index.html */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PROBE = `
<script>
setTimeout(function () {
  function path(el) {
    var p = [];
    while (el && el.nodeType === 1 && p.length < 4) {
      var s = el.tagName.toLowerCase();
      if (el.id) { s += '#' + el.id; p.unshift(s); break; }
      if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.');
      p.unshift(s); el = el.parentElement;
    }
    return p.join('>');
  }
  function r(el) { var b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }

  var out = {};

  // 1) 每个 .reveal 的真实状态
  out.reveals = Array.prototype.map.call(document.querySelectorAll('.reveal'), function (el) {
    var cs = getComputedStyle(el);
    return { p: path(el), r: r(el), op: cs.opacity, hasIn: el.classList.contains('in') };
  });

  // 2) 全页所有 opacity<0.05 的元素（含非 reveal）
  out.hidden = Array.prototype.filter.call(document.querySelectorAll('body *'), function (el) {
    var cs = getComputedStyle(el);
    return parseFloat(cs.opacity) < 0.05 && cs.display !== 'none';
  }).slice(0, 40).map(function (el) {
    var cs = getComputedStyle(el);
    return { p: path(el), op: cs.opacity, r: r(el) };
  });

  // 3) 几何：hero 两栏 + 各图版
  var grid = document.querySelector('.hero-grid');
  if (grid) {
    out.heroGrid = { cols: getComputedStyle(grid).gridTemplateColumns, rect: r(grid) };
    out.heroKids = Array.prototype.map.call(grid.children, function (c) { return { p: path(c), r: r(c) }; });
  }
  var svg = document.getElementById('stageSvg');
  if (svg) out.stageSvg = { rect: r(svg), viewBox: svg.getAttribute('viewBox'), ratio: (r(svg)[2] / r(svg)[3]).toFixed(3) };
  var stage = document.querySelector('.stage');
  if (stage) out.stageFig = { rect: r(stage), css: getComputedStyle(stage).aspectRatio };

  out.sheets = Array.prototype.map.call(document.querySelectorAll('.sheet'), function (s) {
    return { id: s.id, r: r(s), headFont: getComputedStyle(s.querySelector('.sh-title') || s).fontSize };
  });

  out.imgs = Array.prototype.map.call(document.images, function (im) {
    var rr = r(im);
    return { src: im.getAttribute('src'), rect: rr, nat: [im.naturalWidth, im.naturalHeight],
      renderedRatio: (rr[2] / rr[3]).toFixed(3), naturalRatio: (im.naturalWidth / im.naturalHeight).toFixed(3),
      complete: im.complete, shown: rr[2] > 0 && rr[3] > 0 };
  });

  var cv = document.getElementById('termCanvas');
  if (cv) {
    var b = r(cv);
    out.termCanvas = { rect: b, attr: [cv.width, cv.height], dpr: devicePixelRatio,
      backingMatches: (cv.width === Math.round(b[2] * devicePixelRatio)) };
  }

  out.fonts = document.fonts ? document.fonts.status : 'n/a';
  out.h1 = (function () { var h = document.querySelector('h1'); return h ? { r: r(h), fs: getComputedStyle(h).fontSize } : null; })();
  out.bodyFont = getComputedStyle(document.body).fontFamily;
  out.docW = document.documentElement.scrollWidth;

  var pre = document.createElement('pre');
  pre.id = '__LAY__';
  pre.textContent = 'LAY' + '_START' + JSON.stringify(out) + 'LAY' + '_END';
  document.body.appendChild(pre);
}, 2600);
</script>
`;

const src = process.argv[2];
const VIEWPORTS = [[1440, 900], [1024, 768], [390, 844]];

const abs = resolve(src);
const tmp = dirname(abs) + '/_lay_tmp.html';
writeFileSync(tmp, readFileSync(abs, 'utf-8').replace('</body>', PROBE + '</body>'));
const url = 'file:///' + tmp.replace(/\\/g, '/');

for (const [w, h] of VIEWPORTS) {
  let dom = '';
  try {
    dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      `--window-size=${w},${h}`, '--virtual-time-budget=9000', '--dump-dom', url],
      { encoding: 'utf-8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { console.log(`${w}x${h} dump 失败`); continue; }
  const m = dom.match(/<pre id="__LAY__">([\s\S]*?)<\/pre>/);
  if (!m) { console.log(`${w}x${h} 探针未执行`); continue; }
  let pay = m[1].replace(/^LAY_START/, '').replace(/LAY_END$/, '').trim()
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  let d; try { d = JSON.parse(pay); } catch (e) { console.log(`${w}x${h} 解析失败 ${e.message}`); continue; }

  console.log(`\n══════ ${w}x${h} ══════`);
  console.log(`docWidth=${d.docW}  fonts=${d.fonts}  bodyFont=${String(d.bodyFont).slice(0, 40)}`);
  if (d.h1) console.log(`H1 ${d.h1.r.join(',')} fs=${d.h1.fs}`);
  if (d.heroGrid) console.log(`hero-grid cols="${d.heroGrid.cols}" rect=${d.heroGrid.rect.join(',')}`);
  if (d.heroKids) d.heroKids.forEach((k) => console.log(`   kid ${k.p}  rect=${k.r.join(',')}`));
  if (d.stageSvg) console.log(`stageSvg rect=${d.stageSvg.rect.join(',')} viewBox="${d.stageSvg.viewBox}" 宽高比=${d.stageSvg.ratio}`);
  if (d.stageFig) console.log(`figure.stage rect=${d.stageFig.rect.join(',')} aspect-ratio=${d.stageFig.css}`);
  console.log('— reveal 明细 (共 ' + d.reveals.length + ') —');
  d.reveals.forEach((x) => {
    const bad = x.op === '0' || !x.hasIn;
    console.log(`   ${bad ? '❌' : '✅'} in=${x.hasIn ? 'Y' : 'N'} op=${x.op} rect=${x.r.join(',')}  ${x.p}`);
  });
  console.log('— opacity<0.05 全部元素 (' + d.hidden.length + ') —');
  d.hidden.forEach((x) => console.log(`   op=${x.op} rect=${x.r.join(',')}  ${x.p}`));
  console.log('— sheet 高度 —');
  d.sheets.forEach((s) => console.log(`   #${s.id}  rect=${s.r.join(',')}  h=${s.r[3]}`));
  console.log('— 图片 —');
  d.imgs.forEach((i) => console.log(`   ${i.shown ? '✅' : '❌'} ${i.src} rect=${i.rect.join(',')} 自然=${i.nat.join('x')} 渲染比=${i.renderedRatio} 自然比=${i.naturalRatio} complete=${i.complete}`));
  if (d.termCanvas) console.log(`termCanvas rect=${d.termCanvas.rect.join(',')} attr=${d.termCanvas.attr.join('x')} dpr=${d.termCanvas.dpr} 后备匹配=${d.termCanvas.backingMatches}`);
}
try { unlinkSync(tmp); } catch (_) {}
