import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

/* 逐视口审计一个静态页：注入探针 → headless 渲染 → 读回硬数字
   回答四个问题：能不能点 / 看不看得见 / 有没有动画 / 比例对不对 */

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const PROBE = `
<script>
window.__errs = [];
window.addEventListener('error', function (e) { window.__errs.push(String(e.message)); });
window.addEventListener('unhandledrejection', function (e) { window.__errs.push('promise: ' + e.reason); });
setTimeout(function () {
  var sel = 'section,.reveal,.sheet,h1,h2,h3,p,a,button,figure,canvas,img,svg,[data-dam-anim]';
  var all = Array.prototype.slice.call(document.querySelectorAll(sel));
  var vis = 0, hid = [];
  all.forEach(function (el) {
    var cs = getComputedStyle(el);
    var op = parseFloat(cs.opacity), v = cs.visibility, d = cs.display;
    if (op < 0.05 || v === 'hidden' || d === 'none') {
      if (hid.length < 12) hid.push(el.tagName + '.' + String(el.className || '').slice(0, 34) + '|op=' + op);
    } else vis++;
  });
  var as = Array.prototype.slice.call(document.querySelectorAll('a'));
  var dead = as.filter(function (a) {
    var h = a.getAttribute('href');
    return !h || h === '#' || h === '';
  });
  var cs2 = document.querySelectorAll('canvas');
  var blank = 0;
  cs2.forEach(function (c) {
    try {
      var x = c.getContext('2d');
      if (x) { var d0 = x.getImageData(0, 0, Math.min(c.width,50), Math.min(c.height,50)).data;
        var nz = 0; for (var i = 3; i < d0.length; i += 4) if (d0[i] > 0) nz++;
        if (nz === 0) blank++; }
    } catch (e) { blank = -1; }
  });
  var out = {
    vw: innerWidth, vh: innerHeight,
    docH: document.documentElement.scrollHeight,
    bodyH: document.body ? document.body.scrollHeight : -1,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    scrollW: document.documentElement.scrollWidth,
    errs: window.__errs.slice(0, 6),
    total: all.length, visible: vis, hidden: hid.length, hiddenSamples: hid,
    sections: document.querySelectorAll('section').length,
    reveals: document.querySelectorAll('.reveal').length,
    revealsIn: document.querySelectorAll('.reveal.in').length,
    links: as.length, deadLinks: dead.length,
    deadHrefs: dead.slice(0, 5).map(function (a) { return (a.textContent || '').trim().slice(0, 14) + '→' + a.getAttribute('href'); }),
    anims: (document.getAnimations ? document.getAnimations().length : -1),
    canvases: cs2.length, blankCanvases: blank,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    textLen: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().length,
  };
  var pre = document.createElement('pre');
  pre.id = '__AUDIT__';
  pre.textContent = 'AUD' + '_START' + JSON.stringify(out) + 'AUD' + '_END';
  document.body.appendChild(pre);
}, 2500);
</script>
`;

const VIEWPORTS = [[1440, 900], [1024, 768], [610, 1046], [390, 844]];

function audit(srcPath, tag) {
  const abs = resolve(srcPath);
  const dir = dirname(abs);
  const auditPath = dir + '/_audit_tmp.html';
  let html = readFileSync(abs, 'utf-8');
  html = html.replace('</body>', PROBE + '</body>');
  writeFileSync(auditPath, html);

  const fileUrl = 'file:///' + auditPath.replace(/\\/g, '/');
  console.log(`\n════ ${tag}  (${basename(abs)}) ════`);

  for (const [w, h] of VIEWPORTS) {
    let dom = '';
    try {
      dom = execFileSync(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
        `--window-size=${w},${h}`, '--virtual-time-budget=9000', '--dump-dom', fileUrl,
      ], { encoding: 'utf-8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) { console.log(`  ${w}x${h}  ❌ dump 失败`); continue; }

    // 只认 <pre id="__AUDIT__"> 里的载荷；不能全文找 AUD_START，
    // 否则会先命中 <script> 源码里那串字面量
    const m = dom.match(/<pre id="__AUDIT__">([\s\S]*?)<\/pre>/);
    if (!m) { console.log(`  ${w}x${h}  ❌ 探针未执行（页面可能提前崩了）`); continue; }
    let payload = m[1].replace(/^AUD_START/, '').replace(/AUD_END$/, '').trim();
    payload = payload.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    let d;
    try { d = JSON.parse(payload); }
    catch (e) { console.log(`  ${w}x${h}  ❌ 载荷解析失败: ${e.message}`); continue; }
    const flag = (ok) => ok ? '✅' : '❌';

    console.log(`  ┌─ 视口 ${w}x${h} `);
    console.log(`  │ 滚动高 ${d.docH}px  横溢 ${flag(!d.overflowX)}${d.overflowX ? ' scrollW=' + d.scrollW : ''}  section ${d.sections}`);
    console.log(`  │ 可点链接 ${d.links}，死链 ${d.deadLinks} ${flag(d.deadLinks === 0)}  ${d.deadHrefs.join(' , ')}`);
    console.log(`  │ 元素 ${d.total}：可见 ${d.visible}  隐藏 ${d.hidden} ${flag(d.hidden === 0)}  ${d.hiddenSamples.slice(0, 4).join(' ; ')}`);
    console.log(`  │ .reveal ${d.reveals} 已入场 ${d.revealsIn} ${flag(d.reveals === 0 || d.revealsIn === d.reveals)}`);
    console.log(`  │ 运行中动画 ${d.anims} ${flag(d.anims > 0)}   canvas ${d.canvases} 空白 ${d.blankCanvases}`);
    console.log(`  │ 文字 ${d.textLen} 字   底色 ${d.bodyBg}  字色 ${d.bodyColor}`);
    if (d.errs.length) console.log(`  │ ⚠️ JS 错误: ${d.errs.join(' | ')}`);
    console.log(`  └─`);
  }
  try { unlinkSync(auditPath); } catch (_) {}
}

audit(process.argv[2], process.argv[3] || 'PAGE');
