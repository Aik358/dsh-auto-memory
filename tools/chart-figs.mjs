/**
 * chart-figs.mjs -- 19 张 news 配图的声明式声明(single source of truth)
 *
 * 全部数据数字逐字搬运自既有 SVG,只重建几何 —— 数据是神圣的。
 * 几何全部由 chart-engine.mjs 计算:比例尺 / 基线 / 刻度 / 版面分配,调用方不写坐标。
 *
 * 用法:
 *   node tools/chart-figs.mjs            # 生成全部
 *   node tools/chart-figs.mjs fig-x.svg  # 只生成一张
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chart, PALETTE as C, round as r2 } from './chart-engine.mjs';

// ★可移植：输出目录锚定到**本脚本所在仓库**，不写死开发者本机绝对路径。
//   社区作者把 tools/ 拷进自己的仓也能直接跑（此前写死 D:/dsh-auto-memory/... ⇒ 换机即崩）。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIGDIR = process.env.CHART_FIGDIR || path.join(REPO_ROOT, 'docs', 'landing', 'news', 'assets', 'figures');

export const FIGS = Object.create(null);
const fig = (name, build) => { FIGS[name] = build; };

/* 便捷:多点折线的点集 */
const pts = (xs, ys) => xs.map((x, i) => [x, ys[i]]);

/* ============================================================ 1 封面 */
fig('fig-cover.svg', () => {
  const ch = new Chart({
    file: 'fig-cover.svg',
    aria: '双层语料基准:分块粒度偏好在 L1 合成层与 L2 真实层之间发生反转',
    title: '双层语料基准',
    subs: ['同一套实验,两层语料给出相反的结论'],
    legend: [{ label: 'L1 合成压力层', color: 'blue3' }, { label: 'L2 真实语料层', color: 'blue' }],
    padding: 0, padL: 44, padR: 44, plotH: 258, gap: 40,
    caption: [{ text: '在合成语料上得到的调参结论,换一层语料就可能完全相反', color: 'warn' }]
  });
  const cols = ch.splitCols(ch.plot, 2, 40);
  const sizes = ['256', '512', '1024'];
  const sets = [
    { vals: [0.989, 0.966, 0.955], title: 'L1 合成压力层', sub: '偏好小窗 → 256 最优', color: 'blue3' },
    { vals: [0.875, 0.925, 0.925], title: 'L2 真实语料层', sub: '偏好大窗 → 512 / 1024 并列', color: 'blue' }
  ];
  cols.forEach((col, ci) => {
    const s = sets[ci];
    ch.headBand(col, { title: s.title, sub: s.sub }, 'canvas');
    const p = ch.plotArea(col, {
      name: 'p' + ci,
      yTicks: [0.80, 0.85, 0.90, 0.95, 1.00], ySize: 11,
      yFmt: (v) => v.toFixed(2),
      bandCount: 3, topLane: 68, rightPad: 6,
      xLabels: sizes.map((t, i) => ({ i, lines: [{ text: t, size: 13 }] }))
    });
    s.vals.forEach((v, i) => {
      ch.bar('p' + ci, i, v, { color: s.color, w: 62, name: 'bar' + ci + '-' + i });
      ch.text(p.bandX(i), p.y(v) - 8, v.toFixed(3), { region: 'p' + ci, anchor: 'middle', size: 12.5, weight: 700, color: s.color });
    });
  });
  return ch;
});

/* ============================================================ 2 依赖图形态 */
fig('fig-split-graph.svg', () => {
  const ch = new Chart({
    file: 'fig-split-graph.svg',
    aria: '依赖图 110 个模块中 68 个没有出边',
    title: '110 个模块中,68 个没有出边',
    subs: ['依赖图 110 节点 / 158 边;出边最多的是 index.js(78 条),整体呈星形拓扑'],
    padL: 44, padR: 44, plotH: 300, gap: 30,
    caption: [{ text: '叶子模块可整组搬进子包 —— 真正难拆的是那个 10,852 行的单类', color: 'blue' }]
  });
  const x0 = ch.plot.x, x1 = ch.plot.x + ch.plot.w;
  const W1 = 383.3, W2 = 236.7; // 数据:68 : 42 的既有分割宽度
  const barY = ch.plot.y + 28, barH = 72;
  ch.rect(x0, barY, W1, barH, { fill: 'blue', name: 'leaf-bar', region: 'canvas' });
  ch.rect(x0 + W1, barY, W2, barH, { fill: 'slate2', name: 'rest-bar', region: 'canvas' });
  ch.text(x0 + 16, barY + barH / 2 + 6, '叶子模块 68(61.8%)', { region: 'canvas', size: 15, weight: 700, color: 'white' });
  ch.text(x0 + W1 + 16, barY + barH / 2 + 6, '其余 42', { region: 'canvas', size: 15, weight: 700 });
  const rows = [
    ['file-boundary.js / datadir.js / dsh-home.js', '被引 5 / 5 / 7,零出边'],
    ['config-io.js / config-lock.js / shared-state-lock.js', '零出边'],
    ['semantic-js.js / shadow-retrieval.js / python-sidecar-client.js', '零出边'],
    ['wb-sidecar.js / wb-contract.js / board-mode.js', '零出边']
  ];
  rows.forEach((r, i) => {
    const y = barY + barH + 30 + i * 28;
    ch.text(x0, y, r[0], { region: 'canvas', size: 13, weight: 700 });
    ch.text(x1, y, r[1], { region: 'canvas', size: 12.5, anchor: 'end', color: 'text2' });
  });
  return ch;
});

/* ============================================================ 3 注入成本 */
fig('fig-inject-cost.svg', () => {
  const items = [
    ['规则段', 7634, '41.7%', '每轮必到'],
    ['框架头 + 定位', 227, '1.2%', ''],
    ['Tier-0 索引', 1249, '6.8%', '每轮必到'],
    ['项目笔记', 1706, '9.3%', ''],
    ['用户级记忆', 1670, '9.1%', ''],
    ['铭文', 1137, '6.2%', ''],
    ['白板', 1112, '6.1%', ''],
    ['外部记忆', 817, '4.5%', ''],
    ['账本', 782, '4.3%', ''],
    ['日志', 780, '4.3%', ''],
    ['日历', 648, '3.5%', ''],
    ['反思', 529, '2.9%', '']
  ];
  const ch = new Chart({
    file: 'fig-inject-cost.svg',
    aria: '完整版注入块逐段成本,总计 18,291 字符,为预算 8,000 的 228.6%',
    title: '每一轮都在送出的固定前缀',
    subs: [
      '完整版 18,291 字符 = 预算(8,000)的 228.6%;精简版 9,886 字符 = 123.6%',
      '实测来源:会话记录里真实发给模型的 messages,逐段量长,非估算'
    ],
    padL: 44, padR: 44, plotH: 520, gap: 30,
    caption: [{ text: '规则段一段就占 41.7%,且按设计每轮无条件注入、不参与裁剪', color: 'warn' }]
  });
  const total = 18291, budget = 8000;
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: items.length,
    xDomain: [0, 20000], xTicks: [0, 5000, 10000, 15000, 20000],
    xFmt: (v) => (v === 0 ? '0' : (v / 1000) + 'k'),
    gutter: 190, topLane: 26, rowGap: 3, xSize: 11,
    xAxisLabel: '每轮注入字符数(红线 = 配置预算 8,000)'
  });
  ch.rect(h.xOf(budget), h.inner.y, 2.2, h.inner.h, { fill: 'warn', name: 'budget-line', region: 'h' });
  items.forEach((it, i) => {
    const v = it[1];
    const over = v > budget;
    h.bar(i, v, { color: over ? 'blue' : 'slate', name: 'seg' + i, inset: 0 });
    h.label(i, it[0], { size: 13 });
    if (it[3]) h.label(i, it[3], { size: 10.5, color: 'blue', dy: 16, anchor: 'end' });
    h.value(i, v.toLocaleString('en-US'), { size: 12, dy: 4.5 });
    const mid = h.x0 + (h.xOf(v) - h.x0) / 2;
    ch.text(mid, h.rowTop(i) + h.rowH / 2 + 4.5, it[2], { region: 'h', anchor: 'middle', size: 11, weight: 700, color: v > budget ? 'white' : 'text' });
  });
  ch.text(h.xOf(total) - 6, h.inner.y + 12, '18,291', { region: 'h', anchor: 'end', size: 14, weight: 700, color: 'blue' });
  // 预算刻度文字
  ch.text(h.xOf(budget) + 7, h.axisY - 6, 'injectBudgetChars = 8,000', { region: 'h', size: 11.5, weight: 700, color: 'warn' });
  return ch;
});

/* ============================================================ 4 缓存间隔 */
fig('fig-cache-interval.svg', () => {
  const groups = [
    { lab: '0–10 秒', n: 'n=24 / 158', a: 84.8, b: 99.5 },
    { lab: '10–20 秒', n: 'n=62 / 325', a: 60.4, b: 99.0 },
    { lab: '20–30 秒', n: 'n=25 / 95', a: 43.5, b: 82.8 },
    { lab: '30–60 秒', n: 'n=38 / 79', a: 66.6, b: 34.6 }
  ];
  const ch = new Chart({
    file: 'fig-cache-interval.svg',
    aria: '相邻请求间隔与缓存命中率,四个间隔分组的双通道对照',
    legend: [{ label: 'DeepSeek V4.1 Flash', color: 'blue' }, { label: 'GLM 5.3 Flash(同站同时段对照)', color: 'slate2' }],
    subs: ['若为 TTL 所致,间隔越短命中应越高。实测 0–10 秒内仍有 15.2% 未命中。'],
    padL: 52, padR: 52, plotH: 304, gap: 30,
    caption: [{ text: '任何 TTL 都无法解释 5–20 秒内的缓存失效', color: 'warn' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 20, 40, 60, 80, 100], ySize: 11.5,
    yFmt: (v) => v + '%', bandCount: 4, topLane: 30, rightPad: 8,
    xLabels: groups.map((g, i) => ({ i, lines: [{ text: g.lab, size: 13 }, { text: g.n, size: 11, weight: 400, color: 'text2' }] }))
  });
  const half = p.bandW / 2;
  const bw = Math.min(56, (p.bandW - 46) / 2);
  groups.forEach((g, i) => {
    const c0 = p.inner.x + p.bandW * i + half / 2;
    const c1 = c0 + half;
    [[c0, g.a, 'blue', 'a'], [c1, g.b, 'slate2', 'b']].forEach(([cx, v, col, tag]) => {
      ch.bar('p', i, v, { cx, w: bw, color: col, name: 'bar' + i + tag });
      ch.text(cx, p.y(v) - 7, v + '%', { region: 'p', anchor: 'middle', size: 12, weight: 700, color: col === 'slate2' ? 'text' : 'blue' });
    });
  });
  return ch;
});

/* ============================================================ 5 缓存天花板 */
fig('fig-cache-ceiling.svg', () => {
  const reqs = [
    ['105k', 105000], ['160k', 160000], ['173k', 173000], ['264k', 264000],
    ['427k', 427000], ['661k', 661000], ['662k', 662000], ['660k', 660000]
  ];
  const CACHE = 36186;
  const ch = new Chart({
    file: 'fig-cache-ceiling.svg',
    aria: '八条请求的输入规模相差六倍,读到的缓存量分毫不差,恒为 36,186',
    title: '八条请求的 prompt 天差地别,读到的缓存却分毫不差',
    subs: ['GLM 通道 674 条请求中出现 36,186 的次数为 0'],
    legend: [{ label: 'prompt', color: 'blue3' }, { label: 'cache_read', color: 'blue' }],
    padL: 76, padR: 52, plotH: 300, gap: 30,
    caption: [{ text: 'prompt 从 10 万涨到 66 万,读到的一直是同一个 3.6 万 —— 缓存里只剩系统提示与工具定义', color: 'warn' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 100000, 200000, 300000, 400000, 500000, 600000, 700000], ySize: 11.5,
    yFmt: (v) => (v === 0 ? '0' : v / 1000 + 'k'),
    bandCount: 8, topLane: 28, rightPad: 6,
    xAxisLabel: '八条请求(按 prompt 升序)'
  });
  const half = p.bandW / 2;
  const bw = Math.min(46, (p.bandW - 22) / 2);
  reqs.forEach((r, i) => {
    const c0 = p.inner.x + p.bandW * i + half / 2;
    const c1 = c0 + half;
    ch.bar('p', i, r[1], { cx: c0, w: bw, color: 'blue3', name: 'prompt' + i });
    ch.text(c0, p.y(r[1]) - 7, r[0], { region: 'p', anchor: 'middle', size: 11, weight: 700, color: 'text2' });
    ch.bar('p', i, CACHE, { cx: c1, w: bw, color: 'blue', name: 'cache' + i });
    ch.text(c1, p.y(CACHE) - 7, '36.2k', { region: 'p', anchor: 'middle', size: 11, weight: 700, color: 'blue' });
  });
  return ch;
});

/* ============================================================ 6 回声陷阱 */
fig('fig-echo-trap.svg', () => {
  const rows = [
    { name: 'Activate', n: 'n=38', lo: 0.28, hi: 0.5914, mx: 0.5914 },
    { name: 'Prefetch', n: 'n=29', lo: 0.315, hi: 0.43, mx: 0.43 },
    { name: 'Suppress', n: 'n=19', lo: 0.255, hi: 0.651, mx: 0.651 }
  ];
  const ch = new Chart({
    file: 'fig-echo-trap.svg',
    aria: '86 条人工金标的语义分数分布:抑制类最高分越过阈值线,激活类上限反在其下',
    title: 'v1 语义分数分布 · 86 条人工金标',
    subs: ['横条 = 该类分数的实测区间　圆点 = 该类最高分'],
    padL: 44, padR: 60, plotH: 240, gap: 30,
    caption: [{ text: 'Suppress 的最高分 0.651 > Activate 的最高分 0.5914 —— 阈值以上的样本全是回声', color: 'warn' }]
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: 3,
    xDomain: [0.2, 0.72], xTicks: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    xFmt: (v) => v.toFixed(2), gutter: 128, topLane: 34, rowGap: 8, xSize: 11.5,
    xAxisLabel: '语义分数(阈值 tOn = 0.62 / tOff = 0.52)'
  });
  rows.forEach((r, i) => {
    const cy = h.rowTop(i) + h.rowH / 2;
    h.track(i, r.hi, { fill: 'slate2', name: 'track' + i, opacity: 0.35 });
    ch.rect(h.xOf(r.lo), cy - 4, h.xOf(r.hi) - h.xOf(r.lo), 8, { fill: 'blue3', name: 'range' + i, region: 'h' });
    ch.circle(h.xOf(r.mx), cy, 6, { fill: 'blue', name: 'max' + i, region: 'h' });
    h.label(i, r.name, { size: 15 });
    h.label(i, r.n, { size: 11.5, color: 'text2', dy: 17 });
    ch.text(h.xOf(r.mx) + 13, cy + 4.5, 'max ' + r.mx, { region: 'h', size: 13, weight: 700, color: 'blue' });
    ch.text(h.xOf(r.lo) - 8, cy + 4, String(r.lo), { region: 'h', anchor: 'end', size: 11.5, color: 'text2' });
  });
  return ch;
});

/* ============================================================ 7 四路径 */
fig('fig-pr-paths.svg', () => {
  const ch = new Chart({
    file: 'fig-pr-paths.svg',
    aria: '四条激活路径的精确率与召回率权衡',
    title: '四条路径的精确率–召回率权衡',
    subs: ['最终路径在统一口径下取得 precision 1.000 / recall 0.289'],
    padL: 62, padR: 58, plotH: 380, gap: 30,
    caption: [{ text: '回声否决的位置决定了最终形态:门必须放在主动车道之内', color: 'blue' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p',
    yTicks: [0, 0.25, 0.5, 0.75, 1], ySize: 11.5,
    yFmt: (v) => v.toFixed(2),
    xDomain: [0, 1], bandCount: 1, topLane: 22, rightPad: 4,
    xAxisLabel: 'Activation recall', xLabels: [],
    yAxisLabel: 'Activation precision'
  });
  // 随机基线
  const base = [[0, 0], [0.289, 0.289], [0.818, 0.818], [1, 1]];
  ch.polyline(base.map((d) => [p.x(d[0]), p.y(d[1])]), { dash: '6 6', width: 1.6, stroke: 'slate', region: 'p', name: 'random-base' });
  ch.text(p.x(0.62), p.y(0.62) - 8, 'y = x', { region: 'p', size: 11.5, anchor: 'middle', color: 'text2' });
  // v3a 曲线
  // 由旧图 polyline points(487.9,131.8 …) 按旧坐标系反算,y 轴 1.00@60 / 0.00@490,x 轴 0.0@76 / 1.0@680
  const v3a = [[0.682, 0.833], [0.720, 0.760], [0.750, 0.686], [0.800, 0.600], [0.850, 0.500]];
  ch.polyline(v3a.map((d) => [p.x(d[0]), p.y(d[1])]), { dash: '7 5', width: 2.4, stroke: 'blue3', region: 'p', name: 'v3a-curve' });
  v3a.forEach((d, i) => ch.circle(p.x(d[0]), p.y(d[1]), 4, { fill: 'blue3', region: 'p', name: 'v3a-p' + i }));
  ch.text(p.x(0.850) + 2, p.y(0.500) + 19, 'v3a 可部署特征', { region: 'p', anchor: 'end', size: 12, color: 'blue3', backing: true, name: 'v3a-label' });
  // v1
  ch.circle(p.x(0), p.y(0), 6, { fill: 'blue', region: 'p', name: 'v1' });
  ch.text(p.x(0) + 12, p.y(0) + 5, 'v1 单阈值 (0, 0)', { region: 'p', size: 12.5, weight: 700, color: 'blue', name: 'v1-label' });
  // v2
  ch.circle(p.x(0.5), p.y(1), 6, { fill: 'blue2', region: 'p', name: 'v2' });
  ch.text(p.x(0.5) + 12, p.y(1) + 5, 'v2 规则级联 (0.5, 1)', { region: 'p', size: 12.5, weight: 700, color: 'blue2', name: 'v2-label' });
  // 纯学习
  ch.circle(p.x(0.818), p.y(0.516), 6, { fill: 'slate', region: 'p', name: 'pure' });
  ch.text(p.x(0.818) - 12, p.y(0.516) + 4, '纯学习·无门 (0.818, 0.516)', { region: 'p', anchor: 'end', size: 12.5, weight: 700, color: 'slate', backing: true, name: 'pure-label' });
  // 缺陷顺序(旧图标注即为 (0.237, 0.818))
  ch.circle(p.x(0.237), p.y(0.818), 6, { fill: 'slate2', region: 'p', name: 'bad' });
  ch.text(p.x(0.237) + 12, p.y(0.818) + 5, '缺陷顺序 (0.237, 0.818)', { region: 'p', size: 12.5, weight: 700, color: 'text2', backing: true, name: 'bad-label' });
  // 最终路径
  ch.circle(p.x(0.289), p.y(1), 7, { fill: 'blue', stroke: 'white', strokeWidth: 1.5, region: 'p', name: 'final' });
  ch.text(p.x(0.289) - 13, p.y(1) + 5, '最终路径 (0.289, 1.000)', { region: 'p', anchor: 'end', size: 12.5, weight: 700, color: 'blue', name: 'final-label' });
  return ch;
});

/* ============================================================ 8 系数 */
fig('fig-coefficients.svg', () => {
  const items = [
    ['mark', 2.04, 2.04, '疑问/回忆标记', 'blue'],
    ['containment', 1.58, 1.58, '词面覆盖', 'blue'],
    ['intentProb', 0.32, 0.32, '校准意图头', 'blue3'],
    ['margin', 0.26, 0.26, '融合分数差', 'blue3'],
    ['denseTop', 0.06, 0.06, '稠密相似度', 'slate2'],
    ['nCand', 0.00, 0.00, '候选数', 'slate2']
  ];
  const ch = new Chart({
    file: 'fig-coefficients.svg',
    aria: '可部署特征的逻辑回归系数,mark 的权重是 denseTop 的 34 倍',
    title: '逻辑回归系数(可部署特征)',
    subs: ['数值取自重拟合工件,非论文早期版本'],
    padL: 44, padR: 44, plotH: 300, gap: 30,
    caption: [{ text: '「是否在问」的权重是「有多像」的 34 倍', color: 'blue' }]
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: items.length,
    xDomain: [0, 2.2], xTicks: [0, 0.6, 1.1, 1.7, 2.2],
    xFmt: (v) => v.toFixed(1), gutter: 118, rightPad: 178, topLane: 34, rowGap: 4, xSize: 11.5,
    xAxisLabel: '逻辑回归系数'
  });
  const noteRight = ch.plot.x + ch.plot.w;
  items.forEach((it, i) => {
    h.bar(i, it[1], { color: it[4], inset: 0, name: 'coef' + i });
    h.label(i, it[0], { size: 12.5, weight: 700, family: 'mono' });
    h.value(i, '+' + it[1].toFixed(2), { x: h.x1 + 58, size: 12.5, color: it[4] === 'blue' ? 'blue' : 'text' });
    ch.text(noteRight, h.rowTop(i) + h.rowH / 2 + 4.5, it[3], { region: 'h', anchor: 'end', size: 12, weight: 700, color: 'text2' });
  });
  return ch;
});

/* ============================================================ 9 校准 */
fig('fig-calibration.svg', () => {
  const ch = new Chart({
    file: 'fig-calibration.svg',
    aria: 'Platt 校准把准确率从 0.744 提到 0.872,把 Brier 分数从 0.227 降到 0.131',
    title: 'Platt 校准的收益',
    subs: ['准确率 +12.8 个百分点;Brier 分数减半'],
    padL: 44, padR: 44, plotH: 280, gap: 44,
    caption: [{ text: 'Platt 校准是「免费」收益:阈值策略直接消费概率,校准本身不改变排序', color: 'blue' }]
  });
  const cols = ch.splitCols(ch.plot, 2, 44);
  const specs = [
    { name: 'p0', title: '准确率 @0.5', ticks: [0, 0.33, 0.67, 1], fmt: (v) => v.toFixed(2), vals: [0.744, 0.872], labs: ['原始 LR', 'Platt 校准'], cols: ['slate2', 'blue'] },
    { name: 'p1', title: 'Brier 分数(越低越好)', ticks: [0, 0.1, 0.2, 0.3], fmt: (v) => v.toFixed(3), vals: [0.227, 0.131], labs: ['原始 LR', 'Platt 校准'], cols: ['slate2', 'blue'] }
  ];
  cols.forEach((col, ci) => {
    const s = specs[ci];
    const body = ch.headBand(col, { title: s.title }, 'canvas');
    const p = ch.plotArea(body, {
      name: s.name, yTicks: s.ticks, ySize: 11.5, yFmt: s.fmt,
      bandCount: 2, topLane: 34, rightPad: 6,
      xLabels: s.labs.map((t, i) => ({ i, lines: [{ text: t }] }))
    });
    s.vals.forEach((v, i) => {
      ch.bar(s.name, i, v, { color: s.cols[i], w: 92, name: 'b' + ci + i });
      ch.text(p.bandX(i), p.y(v) - 9, v.toFixed(3), { region: s.name, anchor: 'middle', size: 14.5, weight: 700, color: s.cols[i] });
    });
  });
  return ch;
});

/* ============================================================ 10 词法覆盖 */
fig('fig-containment.svg', () => {
  const rows = [
    { name: '回声·抑制类', n: '弱词面覆盖', total: 0.273, echo: 0.115 },
    { name: '激活类', n: '强词面覆盖', total: 0.462, echo: 0.0 }
  ];
  const ch = new Chart({
    file: 'fig-containment.svg',
    aria: '词法覆盖率中位数:激活类高于应抑制的回声类',
    subs: ['方向与直觉相反:应为回声的抑制类更低,真正该召回的激活类更高'],
    padL: 44, padR: 44, plotH: 260, gap: 30,
    caption: [{ text: '方向是反的 ⇒ 任何「词法覆盖硬封顶」的规则都会先砍掉真正该召回的那一类', color: 'warn' }]
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: 2,
    xDomain: [0, 0.5], xTicks: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
    xFmt: (v) => v.toFixed(1), gutter: 82, topLane: 34, rowGap: 46, xSize: 11.5,
    xAxisLabel: '词法覆盖率中位数'
  });
  rows.forEach((r, i) => {
    const cy = h.rowTop(i) + h.rowH / 2;
    h.bar(i, r.total, { x0: h.x0, w: h.xOf(r.total) - h.x0, inset: 13, color: 'slate2', name: 'base' + i });
    if (r.echo > 0) h.bar(i, r.echo, { x0: h.xOf(r.total) - h.xOf(r.echo), w: h.xOf(r.echo) - h.x0, inset: 13, color: 'blue3', name: 'echo' + i });
    else h.track(i, r.total, { fill: 'blue3', name: 'outline' + i });
    h.label(i, r.name, { size: 13 });
    h.label(i, r.n, { size: 11, color: 'text2', dy: 17 });
    ch.text(h.xOf(r.total) + 11, cy + 5, r.total.toFixed(3), { region: 'h', size: 15, weight: 700, color: r.echo > 0 ? 'blue3' : 'blue' });
  });
  return ch;
});

/* ============================================================ 11 顺序消融 */
fig('fig-order-ablation.svg', () => {
  const groups = [
    { lab: '激活精确率', a: 0.818, b: 1.0, aLab: '0.818', bLab: '1.000' },
    { lab: '激活召回率', a: 0.237, b: 0.289, aLab: '0.237', bLab: '0.289' },
    { lab: '抑制越界数', a: 1.0, b: 0.0, aLab: '1.000', bLab: '0.000', norm: true }
  ];
  const ch = new Chart({
    file: 'fig-order-ablation.svg',
    aria: '只调整判断顺序:越界数从 1 降到 0,精确率从 0.818 升到 1.000',
    legend: [{ label: '缺陷顺序(回声否决全局前置)', color: 'warn' }, { label: '修正顺序(回声否决仅作用于主动车道)', color: 'blue' }],
    padL: 52, padR: 52, plotH: 300, gap: 30,
    caption: [{ text: '只调整判断顺序:越界从 1 降到 0,精确率从 0.818 升到 1.000', color: 'blue' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], ySize: 11.5,
    yFmt: (v) => v.toFixed(1), bandCount: 3, topLane: 30, rightPad: 8,
    xLabels: groups.map((g, i) => ({ i, lines: [{ text: g.lab, size: 13 }] }))
  });
  const half = p.bandW / 2;
  const bw = Math.min(64, (p.bandW - 46) / 2);
  groups.forEach((g, i) => {
    const c0 = p.inner.x + p.bandW * i + half / 2;
    const c1 = c0 + half;
    [[c0, g.a, 'warn', g.aLab, 'a'], [c1, g.b, 'blue', g.bLab, 'b']].forEach(([cx, v, col, lab, tag]) => {
      ch.bar('p', i, v, { cx, w: bw, color: col, name: 'bar' + i + tag, minH: v === 0 ? 3 : 0 });
      ch.text(cx, p.y(v) - (v === 0 ? 8 : 9), lab, { region: 'p', anchor: 'middle', size: 14, weight: 700, color: col });
    });
  });
  return ch;
});

/* ============================================================ 12 重排成本 */
fig('fig-rerank-cost.svg', () => {
  const ch = new Chart({
    file: 'fig-rerank-cost.svg',
    aria: '重排的质量收益与延迟代价:质量提升 13% MRR,代价是 p50 延迟从 129ms 升到 26–33 秒',
    title: '重排的边际分析',
    subs: ['左:质量(MRR);右:代价(每查询 p50 延迟,ms)'],
    padL: 56, padR: 56, plotH: 330, gap: 48,
    caption: [{ text: '质量提升 13% MRR 的代价,是 p50 延迟从 129ms 升至 26–33 秒(超预算 52.2× / 65.7×)', color: 'warn' }]
  });
  const cols = ch.splitCols(ch.plot, 2, 48);
  const ql = [['不重排', 'L1'], ['不重排', 'L2'], ['重排', 'L1'], ['重排', 'L2']];
  const xLabels = ql.map((l, i) => ({ i, lines: [{ text: l[0], size: 12.5 }, { text: l[1], size: 11.5, weight: 400, color: 'text2' }] }));
  // 左:质量
  const p0 = ch.plotArea(cols[0], {
    name: 'q', yTicks: [0, 0.25, 0.5, 0.75, 1], ySize: 11.5, yFmt: (v) => v.toFixed(2),
    bandCount: 4, topLane: 30, rightPad: 6, xLabels,
    panelTitle: '质量:MRR'
  });
  const q = [0.837, 0.866, 0.947, 0.892];
  q.forEach((v, i) => {
    ch.bar('q', i, v, { color: i < 2 ? 'slate2' : 'blue', w: 52, name: 'q' + i });
    ch.text(p0.bandX(i), p0.y(v) - 8, v.toFixed(3), { region: 'q', anchor: 'middle', size: 12.5, weight: 700, color: i < 2 ? 'text' : 'blue' });
  });
  // 右:代价
  const p1 = ch.plotArea(cols[1], {
    name: 't', yTicks: [0, 11000, 23000, 34000, 45000], ySize: 11.5, yFmt: (v) => (v === 0 ? '0k' : v / 1000 + 'k'),
    bandCount: 4, topLane: 30, rightPad: 6, xLabels,
    panelTitle: '代价:每查询 p50 延迟(ms,红线 = 500ms 预算)'
  });
  const t = [129, 129, 26100, 32900];
  const BUD = 500;
  const by = p1.y(BUD);
  ch.line(p1.inner.x, by, p1.inner.x + p1.inner.w, by, { stroke: 'warn', width: 1.6, dash: '7 5', region: 't', name: 'budget' });
  // 面板标题已含预算说明;此处不再重复标注,避免与柱体同色叠加
  t.forEach((v, i) => {
    ch.bar('t', i, v, { color: i < 2 ? 'slate2' : 'warn', w: 52, name: 't' + i, minH: 3 });
    const top = v < BUD ? by : p1.y(v);
    ch.text(p1.bandX(i), top - 8, v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v), { region: 't', anchor: 'middle', size: 12.5, weight: 700, color: i < 2 ? 'text' : 'warn' });
  });
  return ch;
});

/* ============================================================ 13 模型选型 */
fig('fig-model-selection.svg', () => {
  const groups = [
    { lab: ['BGE-M3', 'para-512', '(MIT)'], v: [0.925, 0.793, 0.837] },
    { lab: ['BGE-M3', 'fixed-256', ''], v: [0.875, 0.765, 0.83] },
    { lab: ['Qwen3-0.6B', 'fixed-256', ''], v: [0.825, 0.693, 0.746] },
    { lab: ['Qwen3-0.6B', 'para-512', ''], v: [0.8, 0.682, 0.721] },
    { lab: ['e5-large', 'fixed-1024', ''], v: [0.825, 0.7, 0.758] },
    { lab: ['e5-large', 'fixed-512', ''], v: [0.8, 0.698, 0.749] }
  ];
  const ch = new Chart({
    file: 'fig-model-selection.svg',
    aria: '六种嵌入模型的 R@5 / MRR / nDCG@10 对比,BGE-M3 para-512 三项同时最高',
    legend: [{ label: 'R@5', color: 'blue' }, { label: 'MRR', color: 'blue3' }, { label: 'nDCG@10', color: 'slate' }],
    padL: 52, padR: 52, plotH: 340, gap: 30,
    caption: [{ text: 'BGE-M3 para-512 三项指标同时最高 —— 选型因此冻结', color: 'blue' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], ySize: 11.5, yFmt: (v) => v.toFixed(1),
    bandCount: 6, topLane: 34, rightPad: 8,
    xLabels: groups.map((g, i) => ({
      i, lines: [
        { text: g.lab[0], size: 12.5 },
        { text: g.lab[1], size: 12.5 },
        g.lab[2] ? { text: g.lab[2], size: 11, weight: 400, color: 'text2' } : null
      ].filter(Boolean)
    })),
    yAxisLabel: 'R@5(真实语料层 L2)'
  });
  const bw = Math.min(26, (p.bandW - 24) / 3);
  groups.forEach((g, i) => {
    const base = p.inner.x + p.bandW * i + p.bandW / 2;
    g.v.forEach((v, k) => {
      const cx = base + (k - 1) * (bw + 5);
      ch.bar('p', i, v, { cx, w: bw, color: ['blue', 'blue3', 'slate'][k], name: 'm' + i + k });
      ch.text(cx, p.y(v) - 7, String(v), { region: 'p', anchor: 'middle', size: 11.5, weight: 700, color: 'text' });
    });
  });
  return ch;
});

/* ============================================================ 14 分块反转 */
fig('fig-chunk-reversal.svg', () => {
  const groups = [
    { lab: '256', v: [0.989, 0.875] },
    { lab: '512', v: [0.966, 0.925] },
    { lab: '1024', v: [0.955, 0.925] }
  ];
  const ch = new Chart({
    file: 'fig-chunk-reversal.svg',
    aria: '分块粒度偏好在 L1 合成层与 L2 真实层之间反转',
    legend: [{ label: 'L1 合成语料层', color: 'blue3' }, { label: 'L2 真实语料层', color: 'blue' }],
    subs: ['合成层 256 最优(0.989);真实层 512 / 1024 并列(0.925)'],
    padL: 52, padR: 52, plotH: 320, gap: 30,
    caption: [{ text: '在合成语料上得到的调参结论,换一层语料就可能完全相反', color: 'warn' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], ySize: 11.5, yFmt: (v) => v.toFixed(1),
    bandCount: 3, topLane: 30, rightPad: 8,
    xLabels: groups.map((g, i) => ({ i, lines: [{ text: g.lab, size: 14 }] })),
    xAxisLabel: '分块粒度(tokens)', yAxisLabel: 'R@5'
  });
  const half = p.bandW / 2;
  const bw = Math.min(56, (p.bandW - 46) / 2);
  groups.forEach((g, i) => {
    const c0 = p.inner.x + p.bandW * i + half / 2;
    const c1 = c0 + half;
    [[c0, g.v[0], 'blue3'], [c1, g.v[1], 'blue']].forEach(([cx, v, col]) => {
      ch.bar('p', i, v, { cx, w: bw, color: col, name: 'b' + i + col });
      ch.text(cx, p.y(v) - 8, v.toFixed(3), { region: 'p', anchor: 'middle', size: 12.5, weight: 700, color: col });
    });
  });
  return ch;
});

/* ============================================================ 15 通道消融 */
fig('fig-channel-ablation.svg', () => {
  const groups = [
    { lab: ['dense', ''], v: 0.774 },
    { lab: ['lexical', ''], v: 0.787 },
    { lab: ['bm25s', ''], v: 0.767 },
    { lab: ['融合', 'w=0.3'], v: 0.833, hot: true },
    { lab: ['融合', 'w=0.5'], v: 0.85, hot: true },
    { lab: ['融合', 'w=0.7'], v: 0.866, hot: true },
    { lab: ['dense', '+模型稀疏'], v: 0.846 }
  ];
  const ch = new Chart({
    file: 'fig-channel-ablation.svg',
    aria: '真实语料层的通道消融,加权融合 w=0.7 达到最高 MRR 0.866',
    legend: [{ label: 'L2 MRR', color: 'blue' }],
    padL: 52, padR: 52, plotH: 330, gap: 30,
    caption: [{ text: '加权融合 w=0.7 达到最高 MRR 0.866,较纯稠密提升 11.9%', color: 'blue' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], ySize: 11.5, yFmt: (v) => v.toFixed(1),
    bandCount: 7, topLane: 30, rightPad: 8,
    xLabels: groups.map((g, i) => ({
      i, lines: [g.lab[0], g.lab[1] || ''].filter((s) => s !== undefined).map((t, k) => ({ text: t, size: 12.5, weight: k === 1 ? 400 : 700, color: k === 1 ? 'text2' : undefined }))
    })),
    yAxisLabel: 'MRR(L2 真实语料层)'
  });
  const bw = Math.min(38, p.bandW - 30);
  groups.forEach((g, i) => {
    ch.bar('p', i, g.v, { w: bw, color: 'blue', name: 'b' + i });
    ch.text(p.bandX(i), p.y(g.v) - 8, String(g.v), { region: 'p', anchor: 'middle', size: 12, weight: 700, color: 'blue' });
  });
  return ch;
});

/* ============================================================ 16 资源对照 */
fig('fig-resource.svg', () => {
  const ch = new Chart({
    file: 'fig-resource.svg',
    aria: '三种嵌入模型的权重体积、加载时间与峰值 RSS 对照',
    legend: [{ label: 'BGE-M3', color: 'blue' }, { label: 'Qwen3 0.6B', color: 'blue3' }, { label: 'E5-Large', color: 'slate' }],
    padL: 44, padR: 44, plotH: 340, gap: 36,
    caption: [{ text: 'Qwen3 峰值 RSS 4.65 GB ≈ 空闲内存的 47% —— 常驻形态下不可接受', color: 'warn' }]
  });
  const cols = ch.splitCols(ch.plot, 3, 36);
  const specs = [
    { title: '权重体积 (GB)', max: 3, ticks: [0, 1, 2, 3], fmt: (v) => v.toFixed(1), vals: [2.29, 1.21, 2.26], labs: ['BGE-M3', 'Qwen3 0.6B', 'E5-Large'] },
    { title: '加载时间 (s)', max: 4, ticks: [0, 1.3, 2.7, 4], fmt: (v) => v.toFixed(1), vals: [2.75, 1.15, 3.15], labs: ['BGE-M3', 'Qwen3 0.6B', 'E5-Large'] },
    { title: '峰值 RSS (GB)', max: 10, ticks: [0, 2, 4, 6, 8, 10], fmt: (v) => v.toFixed(1), vals: [2.2, 4.65, 3.85], labs: ['BGE-M3', 'Qwen3 0.6B', 'E5-Large'] }
  ];
  cols.forEach((col, ci) => {
    const s = specs[ci];
    const body = ch.headBand(col, { title: s.title }, 'canvas');
    const p = ch.plotArea(body, {
      name: 'r' + ci, yTicks: s.ticks, ySize: 11, yFmt: s.fmt,
      bandCount: 3, topLane: 30, rightPad: 4,
      xLabels: s.labs.map((t, i) => ({ i, lines: [{ text: t, size: 12 }] }))
    });
    if (ci === 2) {
      const ty = p.y(10);
      ch.line(p.gridFrom, ty, p.gridTo, ty, { stroke: 'warn', width: 1.6, dash: '7 5', region: 'r2', name: 'ram-line' });
      ch.text(p.gridTo - 2, ty - 7, '本机空闲 RAM 10 GB', { region: 'r2', anchor: 'end', size: 11.5, weight: 700, color: 'warn' });
    }
    s.vals.forEach((v, i) => {
      ch.bar('r' + ci, i, v, { color: ['blue', 'blue3', 'slate'][i], w: Math.min(58, p.bandW - 16), name: 'b' + ci + i });
      ch.text(p.bandX(i), p.y(v) - 8, String(v), { region: 'r' + ci, anchor: 'middle', size: 12.5, weight: 700, color: 'text' });
    });
  });
  return ch;
});

/* ============================================================ 17 延迟 */
fig('fig-latency.svg', () => {
  const groups = [
    { lab: ['BGE-M3', ''], v: [120, 190] },
    { lab: ['Qwen3-Emb', '0.6B'], v: [283, 415] },
    { lab: ['M-E5-Large', ''], v: [155, 255] }
  ];
  const ch = new Chart({
    file: 'fig-latency.svg',
    aria: '三种嵌入模型的 p50 与 p95 查询延迟,Qwen3 的 p95 已越 500ms 预算线',
    legend: [{ label: 'p50', color: 'blue3' }, { label: 'p95', color: 'blue' }],
    padL: 52, padR: 52, plotH: 320, gap: 30,
    caption: [{ text: 'Qwen3 的 p95 已压线越线 —— 这是它从「候选」降为「备选」的决定性理由', color: 'warn' }]
  });
  const BUD = 500;
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 104, 208, 312, 416, 520], ySize: 11.5, yFmt: String,
    bandCount: 3, topLane: 34, rightPad: 8,
    xLabels: groups.map((g, i) => ({
      i, lines: [g.lab[0], g.lab[1]].filter(Boolean).map((t, k) => ({ text: t, size: 12.5, weight: k === 1 ? 400 : 700, color: k === 1 ? 'text2' : undefined }))
    })),
    yAxisLabel: '查询延迟(ms)'
  });
  const by = p.y(BUD);
  ch.line(p.gridFrom, by, p.gridTo, by, { stroke: 'warn', width: 1.6, dash: '7 5', region: 'p', name: 'budget' });
  ch.text(p.gridTo - 2, by + 15, '500ms 查询预算', { region: 'p', anchor: 'end', size: 11.5, weight: 700, color: 'warn' });
  const half = p.bandW / 2;
  const bw = Math.min(58, (p.bandW - 46) / 2);
  groups.forEach((g, i) => {
    const c0 = p.inner.x + p.bandW * i + half / 2;
    const c1 = c0 + half;
    [[c0, g.v[0], 'blue3'], [c1, g.v[1], 'blue']].forEach(([cx, v, col]) => {
      ch.bar('p', i, v, { cx, w: bw, color: v > BUD ? 'warn' : col, name: 'b' + i + col });
      ch.text(cx, p.y(v) - 8, String(v), { region: 'p', anchor: 'middle', size: 13, weight: 700, color: v > BUD ? 'warn' : col });
    });
  });
  return ch;
});

/* ============================================================ 18 档位曲线 */
fig('fig-tier-curve.svg', () => {
  // 双面板:左 = R@5 曲线;右 = 三档常驻内存(自由刻度,不共用 0–1 轴)
  const ch = new Chart({
    file: 'fig-tier-curve.svg',
    aria: 'Recall@5 随算力档位变化(0 / 118 / 563 MB 对应 0.200 / 0.850 / 0.925),以及三档的常驻内存',
    title: '三档算力下的召回率与常驻内存',
    subs: ['Recall@5 0.200 → 0.850 → 0.925;代价是常驻内存 0 → 118 → 563 MB'],
    padL: 52, padR: 44, plotH: 250, gap: 40,
    caption: [{ text: '收益递减而内存陡增:第二档多花 118 MB 换来 65.0 个百分点,第三档多花 445 MB 只换来 7.5 个', color: 'warn' }]
  });
  // 由旧图 polyline points(78,275.6 / 336,105.3 / 594,85.6) 按旧坐标系反算:y 轴 0@328 / 1@66
  const xs = [0, 118, 563];
  const ys = [0.200, 0.850, 0.925];
  const cols = ch.splitCols(ch.plot, 2, 40);
  const p = ch.plotArea(cols[0], {
    name: 'p', yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], ySize: 11, yFmt: (v) => (v === 1 ? '1' : v.toFixed(1)),
    xDomain: [0, 563], bandCount: 1, topLane: 30, rightPad: 28, bottomExtra: 4,
    xLabels: xs.map((v, i) => ({ at: v, lines: [{ text: (v === 0 ? '0' : v) + ' MB', size: 12 }] })),
    yAxisLabel: 'R@5'
  });
  const px = (v) => p.x(v);
  const ptsA = xs.map((v, i) => [px(v), p.y(ys[i])]);
  ch.path('M' + r2(px(0)) + ',' + r2(p.y(0)) + ' L' + ptsA.map((q) => r2(q[0]) + ',' + r2(q[1])).join(' L') + ' L' + r2(px(563)) + ',' + r2(p.y(0)) + ' Z',
    { x: px(0), y: p.y(0.925), w: px(563) - px(0), h: p.y(0) - p.y(0.925) }, { fill: 'blue', opacity: 0.07, region: 'p', name: 'area' });
  ch.polyline(ptsA, { stroke: 'blue', width: 3, region: 'p', name: 'curve' });
  xs.forEach((v, i) => {
    ch.circle(px(v), p.y(ys[i]), 4.5, { fill: 'blue', stroke: 'white', strokeWidth: 1.5, region: 'p', name: 'pt' + i });
    ch.text(px(v), p.y(ys[i]) - 10, ys[i].toFixed(3), { region: 'p', anchor: i === 1 ? 'middle' : (i === 0 ? 'start' : 'end'), size: 12, weight: 700, color: 'blue' });
  });
  const q = ch.plotArea(cols[1], {
    name: 'q', yTicks: [0, 200, 400, 600], ySize: 11, yFmt: String,
    bandCount: 3, topLane: 30, rightPad: 10, bottomExtra: 4,
    xLabels: xs.map((v, i) => ({ i, lines: [{ text: (v === 0 ? '0' : v) + ' MB', size: 12 }] })),
    yAxisLabel: '常驻内存 MB'
  });
  xs.forEach((v, i) => {
    ch.bar('q', i, v, { w: 56, color: i === 2 ? 'warn' : (i === 1 ? 'blue2' : 'slate2'), name: 'm' + i, minH: v === 0 ? 3 : 0 });
    ch.text(q.bandX(i), q.y(v) - 9, String(v), { region: 'q', anchor: 'middle', size: 12.5, weight: 700, color: i === 2 ? 'warn' : 'text' });
  });
  return ch;
});

/* ============================================================ 19 空锚 */
fig('fig-echo-pr.svg', () => {
  const groups = [
    { lab: ['基线', '单阈值'], v: [0, 0] },
    { lab: ['纯规则', '级联'], v: [1, 0.5] },
    { lab: ['纯学习', '无完整性门'], v: [0.516, 0.421] },
    { lab: ['最终路径', '+完整性门'], v: [0.818, 0.237] }
  ];
  const ch = new Chart({
    file: 'fig-echo-pr.svg',
    aria: '四条路径的 precision / recall 分数对照',
    legend: [{ label: 'precision', color: 'blue' }, { label: 'recall', color: 'blue3' }],
    padL: 52, padR: 52, plotH: 320, gap: 30,
    caption: [{ text: '加完整性门之后 precision 从 0.516 升到 0.818,recall 随之下降到 0.237', color: 'blue' }]
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p', yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], ySize: 11.5, yFmt: (v) => v.toFixed(1),
    bandCount: 4, topLane: 30, rightPad: 8,
    xLabels: groups.map((g, i) => ({ i, lines: g.lab.map((t) => ({ text: t, size: 12.5 })) })),
    yAxisLabel: '分数'
  });
  const half = p.bandW / 2;
  const bw = Math.min(58, (p.bandW - 46) / 2);
  groups.forEach((g, i) => {
    const c0 = p.inner.x + p.bandW * i + half / 2;
    const c1 = c0 + half;
    [[c0, g.v[0], 'blue'], [c1, g.v[1], 'blue3']].forEach(([cx, v, col]) => {
      ch.bar('p', i, v, { cx, w: bw, color: col, name: 'b' + i + col, minH: v === 0 ? 3 : 0 });
      ch.text(cx, p.y(v) - (v === 0 ? 8 : 8), String(v), { region: 'p', anchor: 'middle', size: 12.5, weight: 700, color: col });
    });
  });
  return ch;
});

/* ============================================================ 生成 */

export function buildAll(only) {
  const out = [];
  for (const [name, build] of Object.entries(FIGS)) {
    if (only && only !== name) continue;
    const ch = build();
    const info = ch.write(FIGDIR);
    out.push({ name, H: info.height, bytes: info.bytes, nodes: info.nodes });
  }
  return out;
}

const invoked = process.argv[1] && /chart-figs\.mjs$/.test(process.argv[1]);
if (invoked) {
  const only = process.argv[2] || null;
  const res = buildAll(only);
  console.log('built ' + res.length + ' figures');
  for (const r of res) console.log('  ' + r.name.padEnd(28) + ' H=' + String(r.H).padEnd(5) + ' bytes=' + String(r.bytes).padEnd(7) + ' nodes=' + r.nodes);
}
