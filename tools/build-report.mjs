/**
 * build-report.mjs —— 把正文拼进官方文章外壳，产出一篇可上主页的技术报告。
 *
 * 做法：以 2026-10-15-relational-memory.html 为模板，
 *   保留 <head>（含全部 CSS/字体/主题脚本）、导航、页脚，
 *   只替换 <header class="phero"> 里的标题/摘要、<main> 正文、<aside> 目录、
 *   以及末尾「相关报告」卡片。
 *
 * 纪律：
 *   · 不碰 assets/prose.css 与 step5-motion.css（外壳样式零改动）
 *   · 正文里的图表全部引用已有 assets/figures/*.svg（由 chart-figs-2026-10-29.mjs 生成）
 *   · 输出前跑一遍结构自检（章节数 / 图数 / 表格数 / 锚点齐全）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEWS = path.join(REPO, 'docs', 'landing', 'news');
const TPL = path.join(NEWS, '2026-10-15-relational-memory.html');
const BODY = process.argv[2] || 'D:/dam-exp/report-body.html';
const OUT = path.join(NEWS, '2026-10-29-memory-compliance.html');

const tpl = fs.readFileSync(TPL, 'utf8');
const body = fs.readFileSync(BODY, 'utf8');

// ─── 1. 抽目录（h2 + h3）──────────────────────────────────────────────
const headings = [];
for (const m of body.matchAll(/<(h2|h3)\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
  const text = m[3].replace(/<[^>]+>/g, '').trim();
  headings.push({ level: m[1], id: m[2], text });
}
const toc = headings
  .map(h => `        <li${h.level === 'h3' ? ' class="sub"' : ''}><a href="#${h.id}">${h.text}</a></li>`)
  .join('\n');

// ─── 2. 标题 / 摘要 / 元信息 ──────────────────────────────────────────
const TITLE_HTML = '记忆遵循能力调查<br>从校验契约到通道选择';
const TITLE_PLAIN = '记忆遵循能力调查：从校验契约到通道选择';
const SUB = '一次全量记忆面的实测，以及它推翻的三个结论';
const ABSTRACT = `      <div class="pabstract">
        <p><strong>摘要</strong>　长期 Agent 的记忆系统通常会同时提供日志、事件、共识、承诺、用户画像与日历。设计假设是：把工具定义好、把提示词写清楚，模型就会按预期使用它们。本文用 120 次隔离实验会话与 551 个真实会话作对照，检验这个假设。</p>
        <p>结论分三层：<strong>表达层</strong>（给了明确指令能否按格式写对）与<strong>察觉层</strong>（不给指令会不会自己想起要记）都是 100%；但<strong>通道层</strong>——模型是否使用结构化感知字段——在真实数据里是 <strong>0/162</strong>。模型会写、也想得到要记，但它几乎总是走日志与用户级记忆，而不走 <code>userPercept</code> / <code>sharedGround</code> / <code>commitment</code>。</p>
        <p>核心命题是：<strong>当一条能力存在多条写入通道时，它的实际使用率由「哪条通道最容易走」决定，而不是由「提示词说没说」决定。</strong></p>
      </div>`;

// ─── 3. 替换 head 里的标题 / 描述 / 元信息 ────────────────────────────
let html = tpl;

html = html.replace(
  /<title>[\s\S]*?<\/title>/,
  `<title>${TITLE_PLAIN} — dsh-auto-memory</title>`
);
html = html.replace(
  /<meta name="description"[^>]*>/,
  `<meta name="description" content="三层实测：表达 100%、察觉 100%、结构化感知通道 0/162。一次全量记忆面的遵循能力调查，以及它推翻的三个既有结论。">`
);

// ─── 4. 替换 hero ─────────────────────────────────────────────────────
const heroRe = /<header class="phero">[\s\S]*?<\/header>/;
const NEW_HERO = `<header class="phero">
  <div class="pwrap">
    <div class="phero-in">
      <h1 class="ptitle font-display">${TITLE_HTML}</h1>
      <p class="psub">${SUB}</p>
      <div class="pmeta">
        <span class="tagline">实测调查</span><span class="dot"></span>
        <span>2026-10-29</span><span class="dot"></span>
        <span>约 120 次隔离实验 + 551 个真实会话</span>
      </div>
${ABSTRACT}
    </div>
  </div>
</header>`;
if (!heroRe.test(html)) throw new Error('模板里找不到 phero，结构变了');
html = html.replace(heroRe, NEW_HERO);

// ─── 5. 替换目录 + 正文 ────────────────────────────────────────────────
const gridRe = /(<div class="pgrid">\s*<aside class="ptoc">[\s\S]*?<\/aside>\s*)<main class="particle prose">[\s\S]*?<\/main>/;
const NEW_GRID = `$1<main class="particle prose">${body}</main>`;
if (!gridRe.test(html)) throw new Error('模板里找不到 pgrid/main，结构变了');
html = html.replace(gridRe, NEW_GRID);

// 目录也要换
html = html.replace(
  /(<aside class="ptoc">\s*<ul class="ptoc-list">)[\s\S]*?(<\/ul>)/,
  `$1\n${toc}\n    $2`
);

// ─── 6. 替换末尾「相关报告」卡片 ──────────────────────────────────────
const relatedRe = /<section class="prelated">[\s\S]*?<\/section>/;
if (relatedRe.test(html)) {
  const NEW_RELATED = `<section class="prelated">
  <div class="pwrap">
    <h2>相关报告</h2>
    <div class="pcards">
      <a class="pcard" href="2026-10-15-relational-memory.html">
        <div class="kind">研究综述</div>
        <h3>面向持续人机交流的情境化主动记忆</h3>
        <p>宿主侧记忆使用政策的概念综述与研究议程：记忆不只决定「何时想起」，还要决定「以什么分寸参与回应」。</p>
        <span class="go">阅读 →</span>
      </a>
      <a class="pcard" href="2026-08-25-echo-trap.html">
        <div class="kind">技术报告</div>
        <h3>从语义相关到唤起必要：回声陷阱的发现、度量与修正</h3>
        <p>检索层的结论是「什么材料进入候选」；这篇回答的是「此刻是否应该打断」。</p>
        <span class="go">阅读 →</span>
      </a>
      <a class="pcard" href="index.html">
        <div class="kind">索引</div>
        <h3>全部技术报告</h3>
        <p>全部报告的完整索引与关键结论速查表。</p>
        <span class="go">阅读 →</span>
      </a>
    </div>
  </div>
</section>`;
  html = html.replace(relatedRe, NEW_RELATED);
}

// ─── 7. 清掉 i18n 属性（本文档是单语，不接双语切换）──────────────────
html = html.replace(/\s+data-i18n-(?:hash|zh|en)="[^"]*"/g, '');

// 语言切换按钮对本页无效，直接隐藏，避免点了没反应
html = html.replace(
  '<span class="lang-switch" role="group" aria-label="语言">',
  '<span class="lang-switch" role="group" aria-label="语言" hidden>'
);

// ─── 8. 结构自检 ──────────────────────────────────────────────────────
const checks = [];
const count = (re) => (html.match(re) || []).length;
checks.push(['章节 h2 = 9', count(/<h2 id="s\d"/g) === 9]);
checks.push(['h3 小节 ≥ 6', count(/<h3 id="/g) >= 6]);
checks.push(['图 = 6', count(/<figure>/g) === 6]);
checks.push(['图表 SVG 引用 = 6', count(/assets\/figures\/fig-[a-z-]+\.svg/g) === 6]);
checks.push(['表格 ≥ 6', count(/<table>/g) >= 6]);
checks.push(['目录项 = 标题数', count(/<li[^>]*><a href="#/g) === headings.length]);
checks.push(['无残留 i18n 属性', !/data-i18n-/.test(html)]);
checks.push(['标题已换', html.includes(TITLE_PLAIN)]);
checks.push(['正文已换', html.includes('三个层次的遵循能力')]);
checks.push(['相关报告已换', html.includes('2026-08-25-echo-trap.html')]);
checks.push(['单 <main>', count(/<main /g) === 1]);

let bad = 0;
console.log('=== 结构自检 ===');
for (const [label, ok] of checks) {
  if (!ok) bad++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}`);
}

// 图文件是否都存在
console.log('');
console.log('=== 图片存在性 ===');
const figs = [...new Set([...html.matchAll(/assets\/figures\/(fig-[a-z0-9-]+\.svg)/g)].map(m => m[1]))];
for (const f of figs) {
  const p = path.join(NEWS, 'assets', 'figures', f);
  const exists = fs.existsSync(p);
  if (!exists) bad++;
  console.log(`  ${exists ? '✓' : '✗'} ${f}`);
}

if (bad) {
  console.error(`\n✗ ${bad} 项未通过，未写入`);
  process.exit(1);
}

fs.writeFileSync(OUT, html, 'utf8');
console.log('');
console.log('✓ 已写入 ' + OUT);
console.log('  大小 ' + fs.statSync(OUT).size + ' 字节');
console.log('  目录 ' + headings.length + ' 项 · 图 ' + figs.length + ' 张');
