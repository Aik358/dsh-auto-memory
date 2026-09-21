import { readFileSync } from 'node:fs';

/* 主页结构自查：锚点、双语可折叠性、残留标记、组件计数
   用法: node tools/check-home.mjs site/index.html */

const file = process.argv[2] || 'site/index.html';
const h = readFileSync(file, 'utf8');
let fail = 0;
const say = (ok, label, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${label}${extra ? '  ' + extra : ''}`);
  if (!ok) fail++;
};

// 1 锚点完整性
const ids = [...h.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const hrefs = [...new Set([...h.matchAll(/href="#([A-Za-z0-9_-]+)"/g)].map((m) => m[1]))];
const missing = hrefs.filter((x) => !ids.includes(x));
say(missing.length === 0, `锚点目标（${hrefs.length} 个）`, missing.length ? '缺失: ' + missing.join(', ') : '');

// 2 data-en 元素自身的文本里不得含子元素（site.js 用 textContent 整体替换 ⇒ 子元素会被抹平）
//    必须按标签配对来取「自身内容」，正则跨标签匹配会误报
function ownText(hay, fromIdx) {
  const m = /^<([a-zA-Z][\w-]*)/.exec(hay.slice(fromIdx));
  if (!m) return null;
  const name = m[1];
  const open = new RegExp(`<${name}\\b`, 'gi');
  const close = new RegExp(`</${name}\\b`, 'gi');
  let depth = 0, i = fromIdx;
  while (i < hay.length) {
    open.lastIndex = i; close.lastIndex = i;
    const o = open.exec(hay), c = close.exec(hay);
    if (!c) return null;
    if (o && o.index < c.index) { depth++; i = o.index + 1; }
    else {
      depth--;
      if (depth === 0) return hay.slice(fromIdx, c.index + c[0].length);
      i = c.index + 1;
    }
  }
  return null;
}
const offenders = [];
const tagRe = /<[a-zA-Z][\w-]*\b[^>]*\sdata-en="/g;
let tm;
while ((tm = tagRe.exec(h))) {
  const inner = ownText(h, tm.index);
  if (!inner) continue;
  const body = inner.slice(inner.indexOf('>') + 1, inner.lastIndexOf('<'));
  if (/<[a-zA-Z]/.test(body)) offenders.push(body.replace(/\s+/g, ' ').slice(0, 60));
}
say(offenders.length === 0, 'data-en 元素内嵌子标签（会被语言切换抹平）',
  offenders.length ? `${offenders.length} 处: ${offenders.slice(0, 3).join(' | ')}` : '');

// 3 残留 markdown
const stars = (h.match(/\*\*/g) || []).length;
say(stars === 0, '残留 ** 标记', stars ? `${stars} 处` : '');

// 4 结构计数
const sections = (h.match(/<section/g) || []).length;
const links = (h.match(/<a\s/g) || []).length;
const svgs = (h.match(/<svg/g) || []).length;
const reveals = (h.match(/class="[^"]*\breveal\b/g) || []).length;
console.log(`\n统计: section ${sections} · a ${links} · svg ${svgs} · .reveal ${reveals} · ${h.length} B`);

// 以下是「主页专属」断言：对 lab 占位页等其它页面不适用
const isHome = /id="does"/.test(h);
if (!isHome) {
  console.log('\n（非主页，跳过功能节与法务层断言）');
  console.log(fail ? `\n${fail} 项待修` : '\n全部通过');
  process.exit(fail ? 1 : 0);
}

// 5 功能节序号连续
const feat = [...h.matchAll(/id="f(\d)"/g)].map((m) => m[1]).join('');
say(feat === '123456', '功能节 ①②③④⑤⑥ 齐全', `f${feat}`);

// 6 法务四段都在
for (const [k, re] of [['许可', /BSD-3-Clause/], ['上游署名', /LBEILC/], ['角色许可', /CC BY-NC-SA/], ['免责', /无隶属关系|not affiliated/i]]) {
  say(re.test(h), `法务层 · ${k}`);
}

console.log(fail ? `\n${fail} 项待修` : '\n全部通过');
process.exit(fail ? 1 : 0);
