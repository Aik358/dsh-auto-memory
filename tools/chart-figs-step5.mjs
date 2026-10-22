/**
 * chart-figs-step5.mjs — Step5 修改版专用图表脚本（2026-10-13）
 *
 * 署名：Step5（WorkBuddy）。本文件为【新增文件】，不改动仓库任何既有产物。
 * 复用自研声明式图表引擎 tools/chart-engine.mjs（DeepSeek 官网风格色板与几何围栏），
 * 只生成带 .step5.svg 后缀的新图，绝不覆盖既有 19 张图。
 *
 * 用法：
 *   node tools/chart-figs-step5.mjs            # 生成本脚本声明的全部新图
 *
 * 当前声明：
 *   fig-model-selection-r5.step5.svg
 *     —— 主页 hero 右侧基准图的重绘版。数据逐字搬运自 fig-model-selection.svg
 *        （R@5 · 真实语料层 L2 · 六个「模型 × 分块策略」组合），只改版式：
 *        竖排分组柱 → 横向条形（中文长标签可读）、品牌色单系、
 *        BGE-M3 para-512 高亮、字号整体放大、去掉与端点值重复的柱顶密集标注。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Chart } from './chart-engine.mjs';

// ★可移植：输出目录锚定到**本脚本所在仓库**，不写死开发者本机绝对路径。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = process.env.CHART_FIGDIR || path.join(REPO_ROOT, 'docs', 'landing', 'news', 'assets', 'figures');

const figs = [];
const fig = (name, build) => figs.push({ name, build });

/* ══════════════════════════════════════════════════════════════════════
   fig-model-selection-r5.step5.svg
   数据源：tools/chart-figs.mjs → fig-model-selection.svg（R@5 列逐字搬运）
   ══════════════════════════════════════════════════════════════════════ */
fig('fig-model-selection-r5.step5.svg', () => {
  /* 按 R@5 降序；并列时保持原图的模型族次序（Qwen3-0.6B 在前、e5-large 在后） */
  const rows = [
    { lab: 'BGE-M3 para-512（MIT）', v: 0.925, hot: true },
    { lab: 'BGE-M3 fixed-256', v: 0.875, warm: true },
    { lab: 'Qwen3-0.6B fixed-256', v: 0.825 },
    { lab: 'e5-large fixed-1024', v: 0.825 },
    { lab: 'Qwen3-0.6B para-512', v: 0.8 },
    { lab: 'e5-large fixed-512', v: 0.8 }
  ];
  const ch = new Chart({
    file: 'fig-model-selection-r5.step5.svg',
    aria: '六种模型–策略组合在真实语料层 L2 上的 R@5：BGE-M3 para-512 以 0.925 居首',
    subs: ['六个「模型 × 分块策略」组合 · 真实语料层 L2'],
    padL: 44, padR: 60, plotH: 420, gap: 30,
    caption: [{ text: 'BGE-M3 para-512 R@5 0.925 —— 选型因此冻结', color: 'blue' }]
  });
  const h = ch.plotBarsH(ch.plot, {
    name: 'h', rows: rows.length,
    xDomain: [0, 1], xTicks: [0, 0.5, 1],
    xFmt: (v) => v.toFixed(1), gutter: 195, topLane: 12, rowGap: 6, xSize: 12.5,
    xAxisLabel: 'R@5'
  });
  rows.forEach((r, i) => {
    const col = r.hot ? 'blue' : (r.warm ? 'blue3' : 'slate');
    h.bar(i, r.v, { color: col, name: 'r5-' + i, inset: 4 });
    h.label(i, r.lab, { size: 14, weight: r.hot ? 700 : 400, color: r.hot ? 'blue' : 'text' });
    h.value(i, r.v.toFixed(3), { x: h.xOf(r.v) + 10, anchor: 'start', size: 15.5, color: r.hot ? 'blue' : 'text' });
  });
  return ch;
});

/* ══════════════════════════════════════════════════════════════════════ */

const only = process.argv[2] || null;
let n = 0;
for (const f of figs) {
  if (only && f.name !== only) continue;
  const ch = f.build();
  const info = ch.write(OUTDIR);
  n++;
  console.log('built ' + f.name + '  H=' + info.height + '  bytes=' + info.bytes + '  nodes=' + info.nodes);
}
console.log('step5 figures built: ' + n + '（既有 19 张图未触碰）');
