/**
 * chart-figs-2026-10-29.mjs — 记忆遵循能力调查报告配图（2026-10-29）
 *
 * 用法：
 *   node tools/chart-figs-2026-10-29.mjs               # 全部
 *   node tools/chart-figs-2026-10-29.mjs fig-x.svg     # 单张
 *
 * 数据来源：D:\dam-exp\raw\*.json（本仓实验原始数据，可复算）
 * 版式意图与色板沿用 tools/chart-engine.mjs（DeepSeek 官网风格），不手写坐标。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chart } from './chart-engine.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = process.env.CHART_FIGDIR || path.join(REPO_ROOT, 'docs', 'landing', 'news', 'assets', 'figures');

const figs = [];
const fig = (name, build) => figs.push({ name, build });

/* ══════════════════════════════════════════════════════════════════════════
   图 1 · 三个层次：表达 / 察觉 / 通道
   结论：能力没问题，缺口在"走哪个通道"
   数据：表达层 40/40 + 60/60；察觉层 10/10；通道层 0/162
   ══════════════════════════════════════════════════════════════════════════ */
fig('fig-tier-compliance.svg', () => {
  const rows = [
    { lab: '表达层 · 按格式写对', v: 1.00, note: '100/100 次通过', hot: true },
    { lab: '察觉层 · 自己想起要记', v: 1.00, note: '10/10 次通过', hot: true },
    { lab: '通道层 · 走结构化感知', v: 0.00, note: '0 / 162 次', fail: true },
  ];
  const ch = new Chart({
    file: 'fig-tier-compliance.svg',
    aria: '三个层次的遵循能力：表达层与察觉层均为 100%，但通道层（使用结构化感知参数）为 0/162',
    title: '能力分三层，缺口只在第三层',
    subs: ['表达 100/100 · 察觉 10/10 · 结构化感知 0/162'],
    padL: 44, padR: 44, plotH: 300, gap: 34,
    caption: [
      { text: '模型会写、也想得到要记 —— 但它几乎从不使用 userPercept / sharedGround / commitment', color: 'warn' },
    ],
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: rows.length,
    xDomain: [0, 1.34], xTicks: [0, 0.5, 1],
    xFmt: (v) => (v * 100).toFixed(0) + '%',
    gutter: 226, topLane: 14, rowGap: 14, xSize: 12.5,
    xAxisLabel: '通过率',
  });
  rows.forEach((r, i) => {
    const col = r.fail ? 'warn' : 'blue';
    // 值标签放在柱右；因 xDomain 留到 1.34 倍，柱长 1.0 时标签仍有空间
    h.bar(i, Math.max(r.v, 0.008), { color: col, name: 'tier-' + i, inset: 4, minH: 3 });
    h.label(i, r.lab, { size: 13.5, weight: 600, color: 'text' });
    h.value(i, r.note, { x: h.xOf(Math.max(r.v, 0.008)) + 12, anchor: 'start', size: 13, color: r.fail ? 'warn' : 'blue' });
  });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════════
   图 2 · 提示词压缩的代价曲线：合规率不动，token 也不动
   数据：交接账本 8 版本；token 三组实测
   ══════════════════════════════════════════════════════════════════════════ */
fig('fig-prompt-compression.svg', () => {
  const pts = [
    { chars: 45,   label: 'V3 极简', pass: 1.00, tok: 2774 },
    { chars: 127,  label: 'V1 最小集', pass: 1.00, tok: null },
    { chars: 177,  label: 'V4 +回执', pass: 1.00, tok: null },
    { chars: 198,  label: 'V2 禁后缀', pass: 1.00, tok: null },
    { chars: 1149, label: '默认/V0', pass: 1.00, tok: 2651 },
  ];
  const ch = new Chart({
    file: 'fig-prompt-compression.svg',
    aria: '提示词从 1149 字符压缩到 45 字符，合规率保持 100% 不变；实测 token 也从 2651 到 2774，变化落在采样噪声内',
    title: '删掉 96% 的提示词，合规率不动、token 也不动',
    subs: ['交接账本 8 个版本 × 5 任务 = 40 次；token 为同口径 3 次均值'],
    legend: [
      { label: '合规率（左轴）', color: 'blue' },
      { label: 'inputTokens（右轴，仅三点实测）', color: 'slate' },
    ],
    padL: 56, padR: 74, plotH: 330, gap: 42,
    caption: [
      { text: '合规率恒为 100%：删提示词没有代价，也没有收益', color: 'blue' },
      { text: 'token 2,651→2,774：同配置三次就分布在 2,439–2,958，变化淹没在噪声里', color: 'warn' },
    ],
  });
  const p = ch.plotArea(ch.plot, {
    name: 'p',
    yDomain: [0, 1.05], yTicks: [0, 0.25, 0.5, 0.75, 1],
    yFmt: (v) => (v * 100).toFixed(0) + '%',
    bandCount: pts.length, topLane: 26, rightPad: 8,
    xLabels: pts.map((t, i) => ({ i, lines: [{ text: String(t.chars) }, { text: t.label, size: 10.5 }] })),
  });
  pts.forEach((t, i) => {
    p.bar(i, t.pass, { color: 'blue', w: 54, name: 'pass-' + i, minH: 4 });
    ch.text(p.bandX(i), p.y(t.pass) - 10, '100%',
      { region: 'p', anchor: 'middle', size: 12.5, weight: 700, color: 'blue' });
  });
  // 底部说明放在 x 轴标签下方（用 inner 计算，不用不存在的 p.plot）
  ch.text(p.inner.x, p.inner.y + p.inner.h + p.bottomGutter - 4,
    '提示词层字符数 →（越往右越长）',
    { region: 'p', anchor: 'start', size: 11.5, color: 'text2' });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════════
   图 3 · 接续仪式：有事件时反而做不成
   数据：empty 12 次完成 11；hasEvent 13 次完成 2
   ══════════════════════════════════════════════════════════════════════════ */
fig('fig-ritual-worlds.svg', () => {
  const rows = [
    { lab: '空库世界（无事件可查）', done: 11, n: 12, hot: true },
    { lab: '有事件世界（3 个活跃事件）', done: 2, n: 13, fail: true },
  ];
  const ch = new Chart({
    file: 'fig-ritual-worlds.svg',
    aria: '接续仪式的完成率：事件库为空时 11/12 完成（92%），已有 3 个事件时只有 2/13 完成（15%）',
    title: '接续仪式：事件越多，越做不成',
    subs: ['4 个提示词版本 × 2 个世界，共 25 次真调工具运行'],
    padL: 44, padR: 44, plotH: 260, gap: 34,
    caption: [
      { text: '根因不是提示词措辞 —— R0/R1/R2/R3 四个版本都救不了', color: 'warn' },
      { text: '瓶颈在 memory_recall(scope=events) 是词法匹配：模型必须猜中关键词', color: 'text2' },
    ],
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: rows.length,
    xDomain: [0, 1.36], xTicks: [0, 0.5, 1],
    xFmt: (v) => (v * 100).toFixed(0) + '%',
    gutter: 250, topLane: 12, rowGap: 18, xSize: 12.5,
    xAxisLabel: '完整完成率',
  });
  rows.forEach((r, i) => {
    const rate = r.done / r.n;
    const col = r.fail ? 'warn' : 'blue';
    h.bar(i, rate, { color: col, name: 'rit-' + i, inset: 4, minH: 3 });
    h.label(i, r.lab, { size: 13.5, weight: 600, color: 'text' });
    h.value(i, r.done + '/' + r.n + '（' + Math.round(rate * 100) + '%）',
      { x: h.xOf(rate) + 12, anchor: 'start', size: 13.5, weight: 700, color: col });
  });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════════
   图 4 · 真实语料：流水账 vs 关系记忆
   数据：551 会话 / 71393 次调用；memory_log 514、handoff 162、感知参数 0
   ══════════════════════════════════════════════════════════════════════════ */
fig('fig-real-channels.svg', () => {
  const rows = [
    { lab: '今日日志 memory_log', v: 514, hot: true },
    { lab: '交接账本 memory_note(handoff)', v: 162 },
    { lab: '事件 memory_event', v: 62 },
    { lab: '技能库 memory_procedure', v: 13 },
    { lab: '日历 calendar_add', v: 1, fail: true },
    { lab: 'userPercept 参数', v: 1, fail: true },
    { lab: 'agentTrace 参数', v: 3, fail: true },
    { lab: 'sharedGround 参数', v: 0, fail: true },
    { lab: 'commitment 参数', v: 0, fail: true },
  ];
  const ch = new Chart({
    file: 'fig-real-channels.svg',
    aria: '真实 551 个会话中各记忆通道的调用次数：日志 514 次最多，而四类感知参数合计只有 4 次，共识与承诺为 0',
    title: '真实使用：流水账写满，关系记忆几乎为零',
    subs: ['551 个真实会话 · 71,393 次工具调用'],
    padL: 44, padR: 44, plotH: 400, gap: 30,
    caption: [
      { text: '四类感知参数合计 4 次，共识与承诺各 0 次 —— 而日志有 514 次', color: 'warn' },
    ],
  });
  const max = 514;
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: rows.length,
    xDomain: [0, max * 1.08], xTicks: [0, 200, 400],
    xFmt: (v) => String(v),
    gutter: 268, topLane: 12, rowGap: 4, xSize: 12,
    xAxisLabel: '调用次数',
  });
  rows.forEach((r, i) => {
    const col = r.fail ? 'warn' : (r.hot ? 'blue' : 'slate');
    h.bar(i, Math.max(r.v, max * 0.004), { color: col, name: 'ch-' + i, inset: 3, minH: 2 });
    h.label(i, r.lab, { size: 12.5, weight: r.hot ? 700 : 400, color: r.hot ? 'blue' : 'text' });
    h.value(i, String(r.v), { x: h.xOf(Math.max(r.v, max * 0.004)) + 9, anchor: 'start', size: 12.5, weight: 600, color: col });
  });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════════
   图 5 · 隐性触发：模型其实都记住了，只是走了别的通道
   数据：10 个场景，标注每个场景实际走的通道
   ══════════════════════════════════════════════════════════════════════════ */
fig('fig-implicit-channels.svg', () => {
  const rows = [
    { lab: '强共识「定了，不用再讨论」', via: 'sharedGround', v: 1.0, hot: true },
    { lab: '明确承诺「我答应你」', via: 'commitment', v: 1.0, hot: true },
    { lab: '明确 deadline', via: 'calendar', v: 1.0, hot: true },
    { lab: '相对时间「明天十点」', via: 'calendar', v: 1.0, hot: true },
    { lab: '弱共识「行，就这么办」', via: '日志', v: 0.62 },
    { lab: '软承诺「我下次注意」', via: '硬性规则', v: 0.62 },
    { lab: '用户偏好「以后别用…」', via: '用户级 MEMORY', v: 0.62 },
    { lab: '用户纠正错误结论', via: '日志+已推翻标记', v: 0.62 },
  ];
  const ch = new Chart({
    file: 'fig-implicit-channels.svg',
    aria: '隐性触发实验：8 个应写场景全部记住了，但只有 4 个走结构化通道，另 4 个写进日志、硬性规则或用户级记忆',
    title: '模型都记住了，只是没走结构化通道',
    subs: ['场景不提任何记忆工具名 · 10/10 全部通过'],
    legend: [
      { label: '走结构化感知通道', color: 'blue' },
      { label: '走其他通道（日志/规则/用户级记忆）', color: 'slate' },
    ],
    padL: 44, padR: 44, plotH: 360, gap: 30,
    caption: [
      { text: '8 个应写场景全部记住了 —— 但 4 个写进了日志/规则/用户级记忆，只有 4 个用了结构化字段', color: 'blue' },
    ],
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: rows.length,
    xDomain: [0, 1.42], xTicks: [0, 0.5, 1],
    xFmt: (v) => (v * 100).toFixed(0) + '%',
    gutter: 252, topLane: 12, rowGap: 6, xSize: 12,
    xAxisLabel: '是否记住',
  });
  rows.forEach((r, i) => {
    const col = r.hot ? 'blue' : 'slate';
    h.bar(i, r.v, { color: col, name: 'imp-' + i, inset: 4 });
    h.label(i, r.lab, { size: 12.5, color: 'text' });
    h.value(i, r.via, { x: h.xOf(r.v) + 10, anchor: 'start', size: 12, weight: 600, color: col });
  });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════════
   图 6 · 四类感知的校验强度（只有 stage 一个字段有校验）
   ══════════════════════════════════════════════════════════════════════════ */
fig('fig-percept-validation.svg', () => {
  const rows = [
    { lab: 'userPercept.stage', v: 1, note: '枚举校验' },
    { lab: 'userPercept.text', v: 0, note: '空字符串也收', fail: true },
    { lab: 'userPercept.kind', v: 0, note: '任意字符串', fail: true },
    { lab: 'agentTrace.action', v: 0, note: '空也收', fail: true },
    { lab: 'sharedGround.claim', v: 0, note: '空也收', fail: true },
    { lab: 'commitments.promise', v: 0, note: '空也收', fail: true },
    { lab: 'commitments.state', v: 0, note: '枚举只是文档约定', fail: true },
    { lab: 'calendar.date / time', v: 0, note: '任意字符串', fail: true },
  ];
  const ch = new Chart({
    file: 'fig-percept-validation.svg',
    aria: '四类感知与日历的字段校验强度：只有 userPercept.stage 有枚举校验，其余七个字段完全不校验',
    title: '四类感知：只有 1 个字段有校验',
    subs: ['对照：交接账本有 H1–H4 四组硬判据'],
    padL: 44, padR: 44, plotH: 360, gap: 30,
    caption: [
      { text: '当前数据质量靠提示词与 schema 描述维持，不是靠校验兜底', color: 'warn' },
    ],
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: rows.length,
    xDomain: [0, 1.55], xTicks: [0, 1],
    xFmt: (v) => (v ? '有' : '无'),
    gutter: 250, topLane: 12, rowGap: 6, xSize: 12,
    xAxisLabel: '是否有校验',
  });
  rows.forEach((r, i) => {
    const col = r.fail ? 'warn' : 'blue';
    h.bar(i, r.v, { color: col, name: 'val-' + i, inset: 4, minH: 3 });
    h.label(i, r.lab, { size: 12.5, color: 'text' });
    h.value(i, r.note, { x: h.xOf(Math.max(r.v, 0.02)) + 10, anchor: 'start', size: 12, color: col });
  });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════════ */

const only = process.argv[2] || null;
let n = 0;
for (const f of figs) {
  if (only && f.name !== only) continue;
  const ch = f.build();
  const info = ch.write(OUTDIR);
  n++;
  console.log('built ' + f.name + '  H=' + info.height + '  bytes=' + info.bytes + '  fill=' + (info.fillRatio || 0).toFixed(2) + '  nodes=' + info.nodes);
}
console.log('2026-10-29 figures built: ' + n);
