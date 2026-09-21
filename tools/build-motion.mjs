import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/* 从 skill 语料直接生成动效页 —— CSS 逐字取自 references/items/*.json，
   不做任何改写（skill §10 第 2 条："逐字照贴，不要重写选择器"）。
   只做一件事：把项目 :root token 拼在前面。 */

const SK = '.dsh/skills/transitions-motion/references';
const tokens = readFileSync(SK + '/tokens.css', 'utf-8');
const bundle = JSON.parse(readFileSync('artifacts/_transitions/bundle.json', 'utf-8'));

const USE = [
  'texts-reveal', 'skeleton-loader-and-reveal', 'notification-badge',
  'tabs-sliding', 'accordion', 'icon-swap', 'success-check',
  'error-state-shake', 'toast-open-close', 'thinking-states',
  'streaming-text', 'matrix-dot-loader', 'spinner-check-morph',
];

/* 每个动画的触发方式，取自各自 JSON 的 Usage 注释 */
const TRIGGER = {
  'texts-reveal': 'toggle .is-shown',
  'skeleton-loader-and-reveal': 'toggle .is-revealed',
  'notification-badge': 'toggle .is-shown',
  'tabs-sliding': 'click 药丸',
  'accordion': 'toggle [data-open]',
  'icon-swap': 'toggle .is-shown',
  'success-check': 'data-state="in"',
  'error-state-shake': '移除→reflow→重加 .is-shaking',
  'toast-open-close': 'toggle .is-shown',
  'thinking-states': '轮播',
  'streaming-text': '逐词 .is-in',
  'matrix-dot-loader': '自动',
  'spinner-check-morph': '自动',
};

let css = tokens + '\n\n';
let sections = '';
for (const slug of USE) {
  const it = bundle[slug];
  if (!it) continue;
  css += `\n/* ══ ${slug}（verbatim from references/items/${slug}.json）══ */\n` + it.css + '\n';
  const when = (it.meta?.when || '').replace(/&[a-z]+;/g, ' ').slice(0, 150);
  sections += `
  <section class="demo-card" data-slug="${slug}">
    <header><code>${slug}</code> <span class="trig">${TRIGGER[slug] || ''}</span></header>
    <p class="when">${when}</p>
    <div class="demo-stage">${it.markup}</div>
  </section>`;
}

const js = `
/* 按 skill 的触发纪律驱动：只做类切换 + reflow，不动 CSS */
document.querySelectorAll('.demo-card').forEach(function (card) {
  var slug = card.dataset.slug;
  card.addEventListener('click', function () {
    var r = card.querySelector('.demo-stage');
    if (slug === 'error-state-shake') {
      var el = r.querySelector('.is-error, [data-proto]') || r.firstElementChild;
      if (el) { el.classList.remove('is-shaking'); void el.offsetWidth; el.classList.add('is-shaking'); }
      return;
    }
    if (slug === 'success-check') {
      var sc = r.querySelector('[data-state]');
      if (sc) { sc.setAttribute('data-state', 'out'); void sc.offsetWidth; sc.setAttribute('data-state', 'in'); }
      return;
    }
    if (slug === 'accordion') {
      var acc = r.querySelector('[data-open]');
      if (acc) acc.setAttribute('data-open', acc.getAttribute('data-open') === 'true' ? 'false' : 'true');
      return;
    }
    if (slug === 'streaming-text') {
      var w = r.querySelectorAll('.t-stream-w, [data-proto] span');
      w.forEach(function (s, i) { s.classList.remove('is-in'); });
      void r.offsetWidth;
      w.forEach(function (s, i) { setTimeout(function () { s.classList.add('is-in'); }, i * 60); });
      return;
    }
    r.querySelectorAll('.is-shown').forEach(function (e) { e.classList.remove('is-shown'); });
    void r.offsetWidth;
    r.querySelectorAll('[class*="t-"]').forEach(function (e) { e.classList.add('is-shown'); });
  });
});
/* thinking-states 轮播 */
var think = document.querySelector('[data-slug="thinking-states"] .demo-stage');
if (think) {
  var lines = think.querySelectorAll('[class*="line"], [data-proto] > *');
  if (lines.length > 1) { var i = 0; setInterval(function () { lines.forEach(function (l, k) { l.classList.toggle('is-shown', k === i); }); i = (i + 1) % lines.length; }, 2000); }
}
`;

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transitions · 真实动画库（本地语料直出）</title>
<style>
:root{--bg:#0a0a0a;--fg:#fff;--muted:hsla(0,0%,100%,.56);--brand:#6799fe;--line:hsla(0,0%,100%,.08)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.6 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  padding:clamp(20px,4vw,56px)}
h1{font-size:clamp(24px,3.4vw,40px);font-weight:300;letter-spacing:-.02em;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 36px;font-size:14px}
.grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.demo-card{border:1px solid var(--line);border-radius:16px;padding:18px;
  background:hsla(0,0%,100%,.03);cursor:pointer;transition:border-color 250ms cubic-bezier(.22,1,.36,1)}
.demo-card:hover{border-color:hsla(228,99%,65%,.4)}
.demo-card header{display:flex;gap:10px;align-items:baseline;margin-bottom:6px}
.demo-card code{color:var(--brand);font-size:13px;font-weight:600}
.trig{color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.when{color:var(--muted);font-size:12px;margin:0 0 16px;line-height:1.5}
.demo-stage{min-height:96px;display:flex;align-items:center;justify-content:center;
  padding:16px;border-radius:10px;background:hsla(0,0%,100%,.02);overflow:hidden;position:relative}
.note{margin-top:36px;padding:14px 16px;border-left:2px solid var(--brand);
  background:hsla(228,99%,65%,.06);color:var(--muted);font-size:13px;border-radius:0 8px 8px 0}
/* 让 skill 的 t-* 组件在本页可见（它们自带颜色/尺寸） */
.demo-stage .t-success-check,.demo-stage [class*="t-badge"]{color:var(--fg)}
</style>
</head>
<body>
<h1>真实动画库</h1>
<p class="sub">CSS 逐字取自 <code>.dsh/skills/transitions-motion/references/items/*.json</code> —— 零改写。点击任意卡片重放。</p>
<div class="grid">${sections}</div>
<div class="note">
  本页由 <code>tools/build-motion.mjs</code> 生成：读 skill 语料 → 注入 verbatim CSS → 出静态页。<br>
  token 刻度来自 <code>references/tokens.css</code>，未改动一个数值。
</div>
<style>${css}</style>
<script>${js}</script>
</body>
</html>`;

mkdirSync('site/preview', { recursive: true });
writeFileSync('site/preview/motion.html', html);
console.log(`✓ site/preview/motion.html  ${(html.length / 1024).toFixed(0)} KB`);
console.log(`  收录动画 ${USE.length} 个，CSS 全部 verbatim`);
