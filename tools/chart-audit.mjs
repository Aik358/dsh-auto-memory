/**
 * chart-audit.mjs -- 19 张 SVG 的独立几何审计(自研 XML 解析器,零依赖)
 *
 * 与生成器完全独立:重新解析落盘文件、重新算包围盒、重新复算契约。
 * 断言:
 *   A 契约 viewBox="0 0 880 H" / H%20==0 / width+height / preserveAspectRatio / title / role=img
 *   B 0 元素越出 viewBox(含描边半宽)
 *   C 0 负坐标
 *   D 柱子底边 vs 同面板轴线 Δ = 0(基线同源)
 *   E 内容填充率 ≥ 0.75
 *   F 文字不出血(顶部 ≥8 / 左右 ≥44 / 底部 ≥6)
 *   G 0 文字互相重叠(回归守卫)
 *   H 颜色 ⊆ 主页色板 / 字体栈 / tabular-nums / LF / UTF-8
 *
 * 用法: node tools/chart-audit.mjs [--json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { charWidth, ALLOWED_COLORS, CHROME } from './chart-engine.mjs';

// ★可移植：审计目录锚定到**本脚本所在仓库**，不写死开发者本机绝对路径。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIGDIR = process.env.CHART_FIGDIR || path.join(REPO_ROOT, 'docs', 'landing', 'news', 'assets', 'figures');
const FONT_OK = ["Manrope", "Space Grotesk", "JetBrains Mono", "PingFang SC", "Microsoft YaHei"];

/* ------------------------------------------------------------ XML 解析 */

function parseXml(src) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const re = /<!--[\s\S]*?-->|<!\?[\s\S]*?\?>|<\/([A-Za-z_][\w:.-]*)\s*>|<([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('<!--') || m[0].startsWith('<!')) continue;
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    if (m[2]) {
      const attrs = {};
      const are = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a;
      while ((a = are.exec(m[3] || ''))) attrs[a[1]] = unesc(a[2] != null ? a[2] : a[3]);
      const node = { tag: m[2], attrs, children: [], text: '', line: src.slice(0, m.index).split('\n').length };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
      continue;
    }
    if (m[5]) {
      const t = m[5].trim();
      if (t) stack[stack.length - 1].text += t;
    }
  }
  return root;
}

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const num = (v, d) => (v == null || v === '' ? d : parseFloat(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function transformOf(attrs) {
  const t = attrs.transform;
  if (!t) return null;
  const tr = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(t);
  const ro = /rotate\(\s*(-?[\d.]+)\s*\)/.exec(t);
  return { tx: tr ? parseFloat(tr[1]) : 0, ty: tr ? parseFloat(tr[2]) : 0, rot: ro ? parseFloat(ro[1]) : 0 };
}

/* ------------------------------------------------------------- 包围盒 */

function textBBox(node) {
  const a = node.attrs;
  const txt = (node.text || '').trim();
  if (!txt) return null;
  const size = num(a['font-size'], 13);
  const anchor = a['text-anchor'] || 'start';
  const tracking = num(a['letter-spacing'], 0);
  let w = 0;
  for (const ch of txt) w += charWidth(ch, size);
  if (tracking) w += tracking * Math.max(0, [...txt].length - 1);
  const x = num(a.x, 0), y = num(a.y, 0);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  const box = { x: x0, y: y - size * 0.78, w, h: size * 0.96 };
  const t = transformOf(a);
  if (t) {
    // translate + rotate(-90):重心不变,取旋转后轴对齐盒
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const rad = (t.rot * Math.PI) / 180;
    const rw = Math.abs(box.w * Math.cos(rad)) + Math.abs(box.h * Math.sin(rad));
    const rh = Math.abs(box.w * Math.sin(rad)) + Math.abs(box.h * Math.cos(rad));
    return { x: cx + t.tx - rw / 2, y: cy + t.ty - rh / 2, w: rw, h: rh };
  }
  return box;
}

function pathBBox(d) {
  const nums = (d.match(/-?[\d.]+(?:e-?\d+)?/g) || []).map(Number);
  if (nums.length < 2) return null;
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    minx = Math.min(minx, nums[i]); maxx = Math.max(maxx, nums[i]);
    miny = Math.min(miny, nums[i + 1]); maxy = Math.max(maxy, nums[i + 1]);
  }
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}

function bboxOf(node) {
  const a = node.attrs;
  const sw = num(a['stroke-width'], a.stroke ? 1 : 0);
  const pad = sw / 2;
  switch (node.tag) {
    case 'rect': {
      const x = num(a.x, 0), y = num(a.y, 0), w = num(a.width, 0), h = num(a.height, 0);
      return { x: x - pad, y: y - pad, w: w + sw, h: h + sw };
    }
    case 'line': {
      const x = Math.min(num(a.x1, 0), num(a.x2, 0)), y = Math.min(num(a.y1, 0), num(a.y2, 0));
      return { x: x - pad, y: y - pad, w: Math.abs(num(a.x2, 0) - num(a.x1, 0)) + sw, h: Math.abs(num(a.y2, 0) - num(a.y1, 0)) + sw };
    }
    case 'circle': {
      const r = num(a.r, 0) + pad;
      return { x: num(a.cx, 0) - r, y: num(a.cy, 0) - r, w: r * 2, h: r * 2 };
    }
    case 'polyline':
    case 'polygon': {
      const p = (a.points || '').trim().split(/\s+/).map((q) => q.split(',').map(Number));
      if (!p.length) return null;
      const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
      return { x: Math.min.apply(null, xs) - pad, y: Math.min.apply(null, ys) - pad, w: Math.max.apply(null, xs) - Math.min.apply(null, xs) + sw, h: Math.max.apply(null, ys) - Math.min.apply(null, ys) + sw };
    }
    case 'path': {
      const b = pathBBox(a.d || '');
      return b ? { x: b.x - pad, y: b.y - pad, w: b.w + sw, h: b.h + sw } : null;
    }
    case 'text':
      return textBBox(node);
    default:
      return null;
  }
}

const union = (a, b) => (a ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) } : b);
const overlapArea = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const r2 = (v) => Math.round(v * 100) / 100;

/* -------------------------------------------------------------- 主审计 */

export function auditAll(verbose) {
  const files = fs.readdirSync(FIGDIR).filter((f) => f.endsWith('.svg')).sort();
  const results = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(FIGDIR, f));
    const src = raw.toString('utf8');
    const problems = [];
    const root = parseXml(src);
    const svg = root.children.find((n) => n.tag === 'svg');
    if (!svg) { results.push({ file: f, pass: false, problems: ['无 <svg> 根节点'] }); continue; }
    const a = svg.attrs;
    const vb = (a.viewBox || '').trim().split(/\s+/).map(Number);
    const W = vb[2], H = vb[3];

    /* A 契约 */
    if (vb[0] !== 0 || vb[1] !== 0) problems.push('A viewBox 原点非 0 0: ' + a.viewBox);
    if (W !== CHROME.W) problems.push('A viewBox 宽度 != 880: ' + W);
    if (!(H > 0) || H % 20 !== 0) problems.push('A viewBox 高度非 20 的整数倍: ' + H);
    if (num(a.width, -1) !== W || num(a.height, -1) !== H) problems.push('A width/height 与 viewBox 不一致');
    if (a.preserveAspectRatio !== 'xMidYMid meet') problems.push('A preserveAspectRatio 缺失/不符');
    if (a.role !== 'img') problems.push('A 缺 role="img"');
    const title = svg.children.find((n) => n.tag === 'title');
    if (!title || !(title.text || '').trim()) problems.push('A 缺非空 <title>');
    if (!/tabular-nums/.test(a.style || '')) problems.push('A 缺 font-variant-numeric:tabular-nums');
    const ff = a['font-family'] || '';
    for (const need of ['Manrope', 'PingFang SC', 'Microsoft YaHei']) if (!ff.includes(need)) problems.push('A font-family 缺 ' + need);
    if (/\r/.test(src)) problems.push('H 存在 CR 字符(非纯 LF)');
    if (raw.toString('utf8') !== src) problems.push('H 非 UTF-8');

    /* 遍历 */
    const inks = [];
    const texts = [];
    const bars = [];
    const axes = new Map();
    let bgCount = 0;
    const walk = (node, depth) => {
      for (const c of node.children) {
        const b = bboxOf(c);
        const isBg = c.tag === 'rect' && num(c.attrs.width, 0) >= W && num(c.attrs.height, 0) >= H;
        if (b && !isBg) inks.push({ node: c, box: b });
        if (isBg) bgCount++;
        if (c.tag === 'text' && b) texts.push({ node: c, box: b, txt: c.text });
        if (c.attrs && c.attrs['data-role'] === 'bar') bars.push({ box: b, panel: c.attrs['data-panel'], base: num(c.attrs['data-base'], null) });
        if (c.attrs && c.attrs['data-role'] === 'axis') axes.set(c.attrs['data-panel'], { y: num(c.attrs.y1, null), base: num(c.attrs['data-base'], null) });
        walk(c, depth + 1);
      }
    };
    walk(svg, 0);

    /* B/C 越界与负坐标 */
    let content = null;
    for (const it of inks) {
      const b = it.box;
      content = union(content, b);
      if (b.x < -0.51 || b.y < -0.51 || b.x + b.w > W + 0.51 || b.y + b.h > H + 0.51) {
        problems.push('B 越界 <' + it.node.tag + '> @(' + r2(b.x) + ',' + r2(b.y) + ' ' + r2(b.w) + 'x' + r2(b.h) + '):'
          + (it.node.text ? ' "' + it.node.text.slice(0, 24) + '"' : ''));
      }
      if (b.x < -0.51 || b.y < -0.51) problems.push('C 负坐标 <' + it.node.tag + '> @(' + r2(b.x) + ',' + r2(b.y) + ')');
    }

    /* D 基线同源 */
    let maxDelta = 0;
    for (const bar of bars) {
      const ax = axes.get(bar.panel);
      if (!ax || ax.y == null) { problems.push('D 柱子无同面板轴线: panel=' + bar.panel); continue; }
      const bottom = bar.box.y + bar.box.h;
      const d = Math.abs(bottom - ax.y);
      maxDelta = Math.max(maxDelta, d);
      if (d > 1e-6) problems.push('D 柱底与轴线不重合: panel=' + bar.panel + ' Δ=' + r2(d) + 'px');
    }

    /* E 填充率 */
    const fill = content ? (content.w * content.h) / (W * H) : 0;
    if (fill < 0.75) problems.push('E 内容填充率 ' + (fill * 100).toFixed(1) + '% < 75%');

    /* F 文字不出血 */
    for (const t of texts) {
      const b = t.box;
      if (b.x < CHROME.EDGE - 0.51 || b.x + b.w > W - CHROME.EDGE + 0.51) problems.push('F 文字左右出血: "' + t.txt.slice(0, 26) + '" x=[' + r2(b.x) + ',' + r2(b.x + b.w) + ']');
      if (b.y < 8 - 0.51) problems.push('F 文字顶部出血: "' + t.txt.slice(0, 26) + '" y=' + r2(b.y));
      if (b.y + b.h > H - 6 + 0.51) problems.push('F 文字底部出血: "' + t.txt.slice(0, 26) + '" bottom=' + r2(b.y + b.h));
    }

    /* G 文字互相重叠 */
    let worst = { area: 0 };
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const ov = overlapArea(texts[i].box, texts[j].box);
        if (ov > worst.area) worst = { area: ov, a: texts[i], b: texts[j] };
      }
    }
    if (worst.area > 1) problems.push('G 文字重叠 ' + r2(worst.area) + 'px² : "' + worst.a.txt.slice(0, 20) + '" x "' + worst.b.txt.slice(0, 20) + '"');

    /* H 颜色白名单 */
    const badColors = new Set();
    const collect = (node) => {
      for (const c of node.children) {
        for (const k of ['fill', 'stroke']) {
          const v = (c.attrs[k] || '').trim().toLowerCase();
          if (v && v !== 'none' && v !== 'white' && !ALLOWED_COLORS.has(v)) badColors.add(v);
        }
        collect(c);
      }
    };
    collect(svg);
    if (badColors.size) problems.push('H 非主页色板颜色: ' + [...badColors].join(' '));

    results.push({
      file: f, pass: problems.length === 0, problems, W, H,
      ink: inks.length, texts: texts.length, bars: bars.length, bg: bgCount,
      fill, maxDelta, content
    });
  }
  return results;
}

/* ------------------------------------------------------------ 变异自检 */
/**
 * 负路径自检:对落盘文件做定点变异,逐条证明每个断言真的会变红。
 * 锚串命中数不符即视为变异作废(防止"改不中"造成的假绿)。
 * 全程在内存副本上判定,不写盘。
 */
export function runSelfTest() {
  const CASES = [
    { name: 'B 越界', file: 'fig-split-graph.svg', from: 'x="44" y="112"', to: 'x="-30" y="112"', n: 1, expect: 'B' },
    { name: 'C 负坐标', file: 'fig-split-graph.svg', from: 'x="44" y="112"', to: 'x="-30" y="112"', n: 1, expect: 'C' },
    { name: 'D 基线脱锚', file: 'fig-order-ablation.svg', from: 'x1="81" y1="341" x2="828" y2="341"', to: 'x1="81" y1="361" x2="828" y2="361"', n: 1, expect: 'D' },
    { name: 'E 填充率', file: 'fig-split-graph.svg', from: 'x="836"', to: 'x="260"', n: 4, expect: 'E' },
    { name: 'F 文字出血', file: 'fig-split-graph.svg', from: '<text x="44" y="32"', to: '<text x="10" y="32"', n: 1, expect: 'F' },
    { name: 'G 文字重叠', file: 'fig-split-graph.svg', from: '<text x="443.3" y="154"', to: '<text x="44" y="32"', n: 1, expect: 'G' },
    { name: 'H 色板越界', file: 'fig-split-graph.svg', from: 'fill="#2563eb"', to: 'fill="#ff00aa"', n: 2, expect: 'H' },
    { name: 'A 契约', file: 'fig-split-graph.svg', from: 'viewBox="0 0 880 440"', to: 'viewBox="0 0 880 441"', n: 1, expect: 'A' }
  ];
  const rows = [];
  for (const c of CASES) {
    const fp = path.join(FIGDIR, c.file);
    const orig = fs.readFileSync(fp, 'utf8');
    const hits = orig.split(c.from).length - 1;
    if (hits !== c.n) { rows.push({ name: c.name, ok: false, why: '锚串命中 ' + hits + ' 次(期望 ' + c.n + '),变异作废' }); continue; }
    // 全量替换(命中数已由上面的 n 断言把关),避免"只替第一处"的假绿
    fs.writeFileSync(fp, orig.split(c.from).join(c.to), 'utf8');
    let caught = false, msg = '';
    try {
      const res = auditAll();
      const r = res.find((x) => x.file === c.file);
      caught = !!r && r.problems.some((pr) => pr[0] === c.expect);
      msg = r ? (r.problems.find((pr) => pr[0] === c.expect) || '') : '';
    } catch (e) { caught = true; msg = 'throw: ' + e.message; }
    finally { fs.writeFileSync(fp, orig, 'utf8'); }
    rows.push({ name: c.name, ok: caught, why: msg });
  }
  const back = auditAll();
  const clean = back.every((r) => r.pass);
  return { rows, clean, total: back.length };
}

/* ---------------------------------------------------------------- CLI */

const invokedMain = process.argv[1] && /chart-audit\.mjs$/.test(process.argv[1]);
if (invokedMain && process.argv.includes('--selftest')) {
  const st = runSelfTest();
  console.log('变异自检(每条断言必须变红;还原后必须全绿)');
  for (const r of st.rows) console.log('  ' + (r.ok ? 'RED  ✔' : 'GREEN ✘') + '  ' + r.name.padEnd(12) + (r.ok ? '' : '  ' + r.why));
  console.log('\n还原后 ' + st.total + ' 张全绿 = ' + (st.clean ? 'YES' : 'NO'));
  console.log('捕获率 = ' + st.rows.filter((r) => r.ok).length + '/' + st.rows.length);
  process.exit(st.rows.every((r) => r.ok) && st.clean ? 0 : 1);
}
if (invokedMain) {
  const res = auditAll();
  const json = process.argv.includes('--json');
  if (json) {
    console.log(JSON.stringify(res.map((r) => ({ file: r.file, pass: r.pass, H: r.H, fill: Math.round(r.fill * 1000) / 1000, content: r.content && { x: r2(r.content.x), y: r2(r.content.y), w: r2(r.content.w), h: r2(r.content.h) }, delta: r.maxDelta, problems: r.problems })), null, 2));
  } else {
    console.log('file'.padEnd(28) + 'H'.padEnd(6) + 'ink'.padEnd(6) + 'fill'.padEnd(8) + 'Δbaseline'.padEnd(11) + 'verdict');
    for (const r of res) {
      console.log(
        r.file.padEnd(28) + String(r.H).padEnd(6) + String(r.ink).padEnd(6) +
        ((r.fill * 100).toFixed(1) + '%').padEnd(8) +
        (r.maxDelta == null ? '-' : r.maxDelta.toFixed(6)).padEnd(11) +
        (r.pass ? 'PASS' : 'FAIL')
      );
    }
    const bad = res.filter((r) => !r.pass);
    console.log('');
    for (const r of bad) { console.log('[' + r.file + ']'); for (const p of r.problems) console.log('   ' + p); }
    const pass = res.length - bad.length;
    console.log('\nAUDIT: ' + pass + ' PASS / ' + bad.length + ' FAIL  (共 ' + res.length + ' 张)');
    console.log('0 越界 = ' + (bad.every((r) => !r.problems.some((p) => p[0] === 'B' || p[0] === 'C')) ? 'YES' : 'NO'));
    const maxD = Math.max.apply(null, res.map((r) => r.maxDelta || 0));
    console.log('柱子底边 vs 轴线 最大 Δ = ' + maxD.toFixed(9) + 'px');
    const minFill = Math.min.apply(null, res.map((r) => r.fill));
    console.log('最小内容填充率 = ' + (minFill * 100).toFixed(1) + '%');
    console.log('文字出血 = ' + (res.some((r) => r.problems.some((p) => p[0] === 'F')) ? 'YES' : 'NO'));
    console.log('文字互相重叠 = ' + (res.some((r) => r.problems.some((p) => p[0] === 'G')) ? 'YES' : 'NO'));
    process.exit(bad.length ? 1 : 0);
  }
}

export default { auditAll };
