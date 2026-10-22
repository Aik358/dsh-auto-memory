/**
 * chart-engine.mjs -- 声明式 SVG 图表引擎(零依赖,手写 SVG)
 *
 * 设计目标:**把"画错"变成不可能事件**。
 *   1) 坐标系由引擎独占:调用方只给数据与画布意图,比例尺/基线/刻度全部由引擎算。
 *   2) 构建期几何围栏:任何元素包围盒落在所属区域(plot region)之外 -> 立即 throw,
 *      附带元素名与坐标。绝不静默产出越界 SVG。
 *   3) 基线同源:柱子底边与轴线由同一个变量(baselineY)算出,Δ 恒等于 0。
 *   4) 剩余空间再分布:topLane / 刻度 / band 宽度由引擎按数据包围盒重算,不留死区。
 *
 * 统一契约(viewBox / 安全边距 / 字体 / 色板 / tabular-nums)由 CHROME 常量锁定,
 * 并由 tools/chart-audit.mjs 对落盘文件独立复算。
 */

import fs from 'node:fs';
import path from 'node:path';

/* ------------------------------------------------------------------ 契约 */

export const PALETTE = Object.freeze({
  blue: '#2563eb',
  blue2: '#3b82f6',
  blue3: '#60a5fa',
  slate: '#94a3b8',
  slate2: '#cbd5e1',
  warn: '#c0504d',
  text: '#1e232c',
  text2: '#454545',
  white: '#ffffff'
});

export const ALLOWED_COLORS = new Set(Object.values(PALETTE));

export const FONT = Object.freeze({
  sans: "Manrope,'Space Grotesk','PingFang SC','Microsoft YaHei',system-ui,sans-serif",
  mono: "'JetBrains Mono','Space Grotesk',ui-monospace,Consolas,monospace"
});

export const CHROME = Object.freeze({
  W: 880,
  TOP: 84,
  BOTTOM: 56,
  EDGE: 44,
  MIN_INK_GAP: 6,
  REGION_SLACK: 1.0
});

/* -------------------------------------------------------------- 文本度量 */
/* 与 tools/chart-audit.mjs 共用同一实现,保证"引擎预算"与"审计复算"一致。 */

const NARROW = " .,:;!|'\u0060i[](){}/\\";
const THIN = 'fjtIrl';

export function charWidth(ch, size) {
  const cp = ch.codePointAt(0);
  if (cp >= 0x2e80 || cp === 0x203b || cp === 0x2103) return size;
  if (cp >= 0x2190 && cp <= 0x21ff) return size;
  if (cp >= 0x2000 && cp <= 0x206f) return size * 0.42;
  if (cp === 0xb7 || cp === 0x2022) return size * 0.36;
  if (NARROW.indexOf(ch) >= 0) return size * 0.31;
  if (THIN.indexOf(ch) >= 0) return size * 0.34;
  if ('mwMW@%'.indexOf(ch) >= 0) return size * 0.86;
  if (ch >= 'A' && ch <= 'Z') return size * 0.64;
  if (ch >= '0' && ch <= '9') return size * 0.57;
  return size * 0.55;
}

export function textWidth(str, size, tracking) {
  let w = 0;
  for (const ch of String(str)) w += charWidth(ch, size);
  if (tracking) w += tracking * Math.max(0, [...String(str)].length - 1);
  return w;
}

/** 文字墨迹包围盒(与审计同源):上行 0.78em,下行 0.18em。 */
export function textBox(x, y, str, size, anchor, tracking) {
  const w = textWidth(str, size, tracking);
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { x: x0, y: y - size * 0.78, w, h: size * 0.96 };
}

/* -------------------------------------------------------------- 小工具 */

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const round = (v, p) => {
  const f = Math.pow(10, p || 0);
  return Math.round(v * f) / f;
};

export const align20 = (v) => Math.ceil(v / 20) * 20;

export function niceCeil(v) {
  if (!(v > 0)) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / e;
  const step = m <= 1 ? 1 : m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 4 ? 4 : m <= 5 ? 5 : m <= 6 ? 6 : m <= 8 ? 8 : 10;
  return step * e;
}

export function niceTicks(max, count) {
  const n = count || 5;
  const raw = max / n;
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / e;
  const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * e;
  const ticks = [];
  for (let v = 0; v <= max + step * 1e-9; v += step) ticks.push(round(v, 10));
  if (ticks[ticks.length - 1] < max - step * 1e-9) ticks.push(round(ticks[ticks.length - 1] + step, 10));
  return ticks;
}

function contains(outer, inner, slack) {
  const s = slack || 0;
  return (
    inner.x >= outer.x - s &&
    inner.y >= outer.y - s &&
    inner.x + inner.w <= outer.x + outer.w + s &&
    inner.y + inner.h <= outer.y + outer.h + s
  );
}

export function unionBox(boxes) {
  const xs = boxes.filter(Boolean);
  if (!xs.length) return null;
  const x0 = Math.min.apply(null, xs.map((b) => b.x));
  const y0 = Math.min.apply(null, xs.map((b) => b.y));
  const x1 = Math.max.apply(null, xs.map((b) => b.x + b.w));
  const y1 = Math.max.apply(null, xs.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const intersectArea = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/* ---------------------------------------------------------------- 错误 */

export class ChartGeometryError extends Error {
  constructor(msg, detail) {
    super(msg);
    this.name = 'ChartGeometryError';
    this.detail = detail || null;
  }
}

/* ---------------------------------------------------------------- Chart */

export class Chart {
  constructor(spec) {
    const s = spec || {};
    if (!s.file) throw new Error('Chart: file 必填');
    this.file = s.file;
    this.aria = s.aria || s.file;
    this.title = s.title || null;
    this.subs = s.subs ? (Array.isArray(s.subs) ? s.subs.slice() : [s.subs]) : [];
    this.legend = s.legend || [];
    this.caption = s.caption || null;
    this.padL = Math.max(CHROME.EDGE, s.padL || 56);
    this.padR = Math.max(CHROME.EDGE, s.padR || 56);
    this.plotH = s.plotH || 320;
    this.gap = s.gap || 40;

    this.H = align20(CHROME.TOP + this.plotH + CHROME.BOTTOM);
    this.W = CHROME.W;
    this.plot = {
      x: this.padL,
      y: CHROME.TOP,
      w: this.W - this.padL - this.padR,
      h: this.H - CHROME.TOP - CHROME.BOTTOM
    };
    this.capLines = s.caption ? (Array.isArray(s.caption) ? s.caption.slice() : [s.caption]) : [];

    this.nodes = [];
    this.regions = new Map();
    this.panels = new Map();
    this.axisY = new Map();
    this.bars = [];
    this.notes = [];

    this.region('canvas', { x: 0, y: 0, w: this.W, h: this.H }, null, true);
    this.head();
  }

  /* ------------------------------------------------------------ 注册 */

  region(name, box, parent, silent) {
    this.regions.set(name, { name, box, parent: parent || null });
    if (!silent && parent) {
      const p = this.regions.get(parent);
      if (p && !contains(p.box, box, CHROME.REGION_SLACK)) {
        throw new ChartGeometryError(
          '[' + this.file + '] 区域越界: region "' + name + '" 超出父区域 "' + parent + '"',
          { region: box, parent: p.box }
        );
      }
    }
    return box;
  }

  add(node) {
    const n = Object.assign({ region: null, role: 'ink' }, node);
    if (n.slack == null) n.slack = CHROME.REGION_SLACK;
    if (n.region) {
      const r = this.regions.get(n.region);
      if (!r) throw new Error('[' + this.file + '] 未注册区域: ' + n.region);
      if (!contains(r.box, n.box, n.slack)) {
        throw new ChartGeometryError(
          '[' + this.file + '] 元素越界: <' + n.name + '> 包围盒超出区域 "' + n.region + '"',
          {
            element: n.name,
            box: n.box,
            region: n.region,
            regionBox: r.box,
            overflow: {
              left: round(r.box.x - n.box.x, 2),
              top: round(r.box.y - n.box.y, 2),
              right: round(n.box.x + n.box.w - (r.box.x + r.box.w), 2),
              bottom: round(n.box.y + n.box.h - (r.box.y + r.box.h), 2)
            }
          }
        );
      }
    }
    if (n.box.w < -1e-9 || n.box.h < -1e-9) {
      throw new ChartGeometryError('[' + this.file + '] 负尺寸元素: <' + n.name + '>', { box: n.box });
    }
    this.nodes.push(n);
    return n;
  }

  /* --------------------------------------------------------- 版面切分 */

  /** 顶部标题区(slot: 32 / 54 / 76)。 */
  head() {
    const slots = [32, 54, 76];
    let i = 0;
    const w = this.plot.w;
    if (this.title) {
      const y = slots[i++];
      this.add({
        name: 'title', role: 'head', region: 'canvas',
        box: textBox(this.plot.x, y, this.title, 17.5, 'start'),
        svg: '<text x="' + round(this.plot.x, 2) + '" y="' + y + '" font-size="17.5" font-weight="700" fill="' + PALETTE.text + '">' + esc(this.title) + '</text>'
      });
    }
    for (const sub of this.subs) {
      if (i >= slots.length) break;
      const y = slots[i++];
      this.add({
        name: 'sub', role: 'head', region: 'canvas',
        box: textBox(this.plot.x, y, sub, 12.5, 'start'),
        svg: '<text x="' + round(this.plot.x, 2) + '" y="' + y + '" font-size="12.5" fill="' + PALETTE.text2 + '">' + esc(sub) + '</text>'
      });
    }
    if (this.legend.length && i < slots.length) {
      const y = slots[i++];
      let x = this.plot.x;
      const parts = [];
      for (const item of this.legend) {
        const label = item.label;
        const size = 12.5;
        parts.push('<rect x="' + round(x, 2) + '" y="' + (y - 10) + '" width="22" height="13" fill="' + (PALETTE[item.color] || item.color) + '"/>');
        x += 22 + 9;
        parts.push('<text x="' + round(x, 2) + '" y="' + y + '" font-size="' + size + '" font-weight="700" fill="' + PALETTE.text + '">' + esc(label) + '</text>');
        x += textWidth(label, size) + 26;
      }
      this.add({
        name: 'legend', role: 'head', region: 'canvas',
        box: { x: this.plot.x, y: y - 10, w: x - 26 - this.plot.x, h: 14 },
        svg: parts.join('')
      });
    }
    if (this.capLines.length) {
      const n = this.capLines.length;
      const y0 = this.H - 20 - (n - 1) * 18;
      this.capLines.forEach((line, k) => {
        const txt = typeof line === 'string' ? line : line.text;
        const col = typeof line === 'string' ? PALETTE.blue : (PALETTE[line.color] || line.color || PALETTE.blue);
        const size = typeof line === 'string' ? 13.5 : (line.size || 13.5);
        const y = y0 + k * 18;
        this.add({
          name: 'caption', role: 'head', region: 'canvas',
          box: textBox(this.plot.x, y, txt, size, 'start'),
          svg: '<text x="' + round(this.plot.x, 2) + '" y="' + y + '" font-size="' + size + '" font-weight="700" fill="' + col + '">' + esc(txt) + '</text>'

        });
      });
    } else {
      this.add({
        name: 'foot-rule', role: 'head', region: 'canvas',
        box: { x: this.plot.x, y: this.H - 44, w: 60, h: 2 },
        svg: '<rect x="' + round(this.plot.x, 2) + '" y="' + (this.H - 44) + '" width="60" height="2" fill="' + PALETTE.slate2 + '"/>'
      });
    }
  }

  /** 横向切成 n 列,返回每列的 rect;列间空隙单独注册为空区,防止内容溢入。 */
  splitCols(rect, n, gap) {
    const g = gap == null ? this.gap : gap;
    const cw = (rect.w - g * (n - 1)) / n;
    if (cw <= 0) throw new ChartGeometryError('[' + this.file + '] 列宽为负: rect.w=' + rect.w + ' n=' + n + ' gap=' + g);
    const cols = [];
    for (let i = 0; i < n; i++) cols.push({ x: rect.x + i * (cw + g), y: rect.y, w: cw, h: rect.h });
    for (let i = 0; i < n - 1; i++) {
      this.region('gap' + i, { x: cols[i].x + cols[i].w, y: rect.y, w: g, h: rect.h }, null, true);
    }
    return cols;
  }

  /** 在 rect 顶部划出标题带,返回其下的 rect(标题墨迹注册进父区域)。 */
  headBand(rect, opts, regionName) {
    const title = opts.title || null;
    const sub = opts.sub || null;
    let h = 0;
    if (title) h += 22;
    if (sub) h += 18;
    if (h === 0) return rect;
    if (title) {
      this.add({
        name: 'panel-title', role: 'head', region: regionName,
        box: textBox(rect.x, rect.y + 15, title, 15, 'start'),
        svg: '<text x="' + round(rect.x, 2) + '" y="' + round(rect.y + 15, 2) + '" font-size="15" font-weight="700" fill="' + PALETTE.text + '">' + esc(title) + '</text>'
      });
    }
    if (sub) {
      const y = rect.y + (title ? 33 : 15);
      this.add({
        name: 'panel-sub', role: 'head', region: regionName,
        box: textBox(rect.x, y, sub, 12, 'start'),
        svg: '<text x="' + round(rect.x, 2) + '" y="' + round(y, 2) + '" font-size="12" fill="' + PALETTE.text2 + '">' + esc(sub) + '</text>'
      });
    }
    return { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
  }

  /* ------------------------------------------------------------ 绘图区 */

  /**
   * 核心:把一块 rect 变成带刻度的绘图区。
   * 返回 { rect(内区), panel(外区), y(v), x(v), bandX(i), bandW, baselineY, ... }
   */
  plotArea(rect, opts) {
    const o = opts || {};
    const name = o.name || 'p';
    const yTicks = o.yTicks.slice();
    const d0 = o.yDomain ? o.yDomain[0] : yTicks[0];
    const d1 = o.yDomain ? o.yDomain[1] : yTicks[yTicks.length - 1];
    if (!(d1 > d0)) throw new ChartGeometryError('[' + this.file + '] yDomain 非法: ' + d0 + '..' + d1);
    const yFmt = o.yFmt || ((v) => String(v));
    const ySize = o.ySize || 12;
    const tickFmtW = yTicks.length ? Math.max.apply(null, yTicks.map((t) => textWidth(yFmt(t), ySize))) : 0;
    const yLabelW = o.yAxisLabel ? 26 : 0;
    const leftGutter = o.leftGutter != null ? o.leftGutter : Math.ceil(tickFmtW) + 12 + yLabelW;
    const rightPad = o.rightPad == null ? 10 : o.rightPad;

    const xLabels = o.xLabels || [];
    let maxLines = 1;
    for (const l of xLabels) maxLines = Math.max(maxLines, l.lines.length);
    const xLabelBlockH = xLabels.length ? maxLines * 17 : 0;
    const hasBottomInk = xLabels.length > 0 || !!o.xAxisLabel;
    const bottomGutter = (hasBottomInk ? 20 + xLabelBlockH + (o.xAxisLabel ? 21 : 0) + 6 : 0) + (o.bottomExtra || 0);

    const topLane = o.topLane == null ? 24 : o.topLane;
    const q2 = (v) => Math.round(v * 100) / 100;
    const inner = {
      x: q2(rect.x + leftGutter),
      y: q2(rect.y + topLane),
      w: q2(rect.w - leftGutter - rightPad),
      h: q2(rect.h - topLane - bottomGutter)
    };
    if (inner.w <= 40 || inner.h <= 40) {
      throw new ChartGeometryError('[' + this.file + '] 绘图区过小: ' + round(inner.w, 1) + 'x' + round(inner.h, 1), { rect, inner, leftGutter, bottomGutter });
    }
    this.region(name, rect, o.parent || 'canvas');

    const y = (v) => inner.y + (1 - (v - d0) / (d1 - d0)) * inner.h;
    const bandW = o.bandW || (inner.w / (o.bandCount || 1));
    const bandX = (i) => inner.x + bandW * (i + 0.5);
    this.panels.set(name, { name, rect, inner, bandW, bandX });
    this.bindScale(name, y);

    if (o.panelTitle) {
      if (topLane < 30) throw new ChartGeometryError('[' + this.file + '] 面板含标题时 topLane 必须 ≥ 30(现为 ' + topLane + ')');
      const ty = rect.y + 20;
      const tb = textBox(rect.x, ty, o.panelTitle, 15, 'start');
      this.add({
        name: name + '-panel-title', role: 'head', region: name, box: tb,
        svg: '<text x="' + round(rect.x, 2) + '" y="' + round(ty, 2) + '" font-size="15" font-weight="700" fill="' + PALETTE.text + '">' + esc(o.panelTitle) + '</text>'
      });
    }
    const x = (v) => inner.x + ((v - (o.xDomain ? o.xDomain[0] : 0)) / ((o.xDomain ? o.xDomain[1] : 1) - (o.xDomain ? o.xDomain[0] : 0))) * inner.w;

    const gridTo = o.gridTo == null ? rect.x + rect.w : o.gridTo;
    const gridFrom = o.gridFrom == null ? inner.x : o.gridFrom;
    const baselineY = o.baselineY == null ? q2(y(d0)) : q2(o.baselineY);
    this.axisY.set(name, { y: baselineY, x1: gridFrom, x2: gridTo, hasLine: o.axisLine !== false });

    const parts = [];
    const boxes = [];
    for (let i = 0; i < yTicks.length; i++) {
      const t = yTicks[i];
      const ty = y(t);
      if (o.axisLine !== false && Math.abs(ty - baselineY) < 0.01) continue;
      parts.push('<line x1="' + round(gridFrom, 2) + '" y1="' + round(ty, 2) + '" x2="' + round(gridTo, 2) + '" y2="' + round(ty, 2) + '" stroke="' + PALETTE.slate2 + '" stroke-width="1" stroke-dasharray="4 5"/>');
      const tb = textBox(inner.x - 12, ty + ySize * 0.36, yFmt(t), ySize, 'end');
      boxes.push(tb);
      parts.push('<text x="' + round(inner.x - 12, 2) + '" y="' + round(ty + ySize * 0.36, 2) + '" text-anchor="end" font-size="' + ySize + '" font-weight="700" fill="' + PALETTE.text + '">' + esc(yFmt(t)) + '</text>');
      if (ty > baselineY + 0.01) {
        this.region(name + '-grid' + i, { x: gridFrom, y: ty, w: Math.max(0, gridTo - gridFrom), h: Math.max(0, baselineY - ty) }, name, true);
      }
    }
    if (Math.abs(inner.y - baselineY) > 0.01) {
      const topTick = yTicks.reduce((a, b) => (Math.abs(y(b) - inner.y) < Math.abs(y(a) - inner.y) ? b : a));
      const tb = textBox(inner.x - 12, y(topTick) + ySize * 0.36, yFmt(topTick), ySize, 'end');
      if (!boxes.some((b) => Math.abs(b.y - tb.y) < 0.01)) {
        boxes.push(tb);
        parts.push('<text x="' + round(inner.x - 12, 2) + '" y="' + round(y(topTick) + ySize * 0.36, 2) + '" text-anchor="end" font-size="' + ySize + '" font-weight="700" fill="' + PALETTE.text + '">' + esc(yFmt(topTick)) + '</text>');
      }
    }
    if (o.axisLine !== false) {
      parts.push('<line x1="' + round(gridFrom, 2) + '" y1="' + round(baselineY, 2) + '" x2="' + round(gridTo, 2) + '" y2="' + round(baselineY, 2) + '" stroke="' + (PALETTE[o.axisColor] || o.axisColor || PALETTE.slate) + '" stroke-width="' + (o.axisWidth || 1.4) + '"' + (o.axisDash ? ' stroke-dasharray="' + o.axisDash + '"' : '') + ' data-role="axis" data-orient="h" data-panel="' + name + '" data-base="' + round(baselineY, 3) + '"/>');
      if (o.axisLabel) {
        const ax = gridTo + 9;
        const ay = baselineY + (o.ySize || 12) * 0.36;
        const ab = textBox(ax, ay, o.axisLabel, o.axisSize || 12.5, 'start');
        boxes.push(ab);
        parts.push('<text x="' + round(ax, 2) + '" y="' + round(ay, 2) + '" font-size="' + (o.axisSize || 12.5) + '" font-weight="700" fill="' + (PALETTE[o.axisLabelColor] || o.axisLabelColor || PALETTE.warn) + '">' + esc(o.axisLabel) + '</text>');
      }
    }
    if (o.yAxisLabel) {
      const cx = rect.x + 13;
      const cy = inner.y + inner.h / 2;
      const tw = textWidth(o.yAxisLabel, o.ySize || 12);
      parts.push('<text transform="translate(' + round(cx, 2) + ' ' + round(cy, 2) + ') rotate(-90)" text-anchor="middle" font-size="' + (o.ySize || 12) + '" font-weight="700" fill="' + PALETTE.text + '">' + esc(o.yAxisLabel) + '</text>');
      boxes.push({ x: cx - (o.ySize || 12) * 0.8, y: cy - tw / 2, w: (o.ySize || 12) * 1.6, h: tw });
    }
    for (const l of xLabels) {
      const lx = l.px != null ? l.px : (l.at != null ? x(l.at) : bandX(l.i));
      const anchor = l.anchor || 'middle';
      l.lines.forEach((line, k) => {
        const lo = typeof line === 'string' ? { text: line } : line;
        const size = lo.size || l.size || 13;
        const ly = baselineY + 20 + k * 17;
        const b = textBox(lx, ly, lo.text, size, anchor, l.tracking);
        boxes.push(b);
        parts.push('<text x="' + round(lx, 2) + '" y="' + round(ly, 2) + '" text-anchor="' + anchor + '" font-size="' + size + '" font-weight="' + (lo.weight || l.weight || 700) + '" fill="' + (PALETTE[lo.color] || lo.color || PALETTE[l.color] || l.color || PALETTE.text) + '">' + esc(lo.text) + '</text>');
      });
    }
    if (o.xAxisLabel) {
      const yx = baselineY + 20 + xLabelBlockH + (xLabels.length ? 6 : 0);
      const b = textBox(inner.x + inner.w / 2, yx, o.xAxisLabel, 13.5, 'middle');
      boxes.push(b);
      parts.push('<text x="' + round(inner.x + inner.w / 2, 2) + '" y="' + round(yx, 2) + '" text-anchor="middle" font-size="13.5" fill="' + PALETTE.text2 + '">' + esc(o.xAxisLabel) + '</text>');
    }
    const axisBox = unionBox(boxes);
    this.add({ name: name + '-axes', role: 'axis', region: name, box: axisBox, svg: parts.join('') });

    return {
      name, rect, inner, region: name,
      y, x, bandX, bandW,
      y0: inner.y, y1: inner.y + inner.h,
      baselineY, gridFrom, gridTo, leftGutter, rightPad, topLane, bottomGutter,
      ySize,
      bar: (i, value, opts2) => this.bar(name, i, value, opts2),
      text: (px, py, str, opts2) => this.text(px, py, str, Object.assign({ region: name }, opts2)),
      line: (x1, y1, x2, y2, opts2) => this.line(x1, y1, x2, y2, Object.assign({ region: name }, opts2)),
      circle: (cx, cy, r, opts2) => this.circle(cx, cy, r, Object.assign({ region: name }, opts2)),
      rect: (x, yy, w, h, opts2) => this.rect(x, yy, w, h, Object.assign({ region: name }, opts2)),
      path: (d, box, opts2) => this.path(d, box, Object.assign({ region: name }, opts2)),
      polyline: (pts, opts2) => this.polyline(pts, Object.assign({ region: name }, opts2)),
      region2: name
    };
  }

  /* ------------------------------------------------------------ 图元 */

  text(x, y, str, o) {
    const opts = o || {};
    const size = opts.size || 13;
    const anchor = opts.anchor || 'start';
    const box = textBox(x, y, str, size, anchor, opts.tracking);
    if (opts.backing) {
      this.add({
        name: (opts.name || ('t:' + str).slice(0, 30)) + ':mask', role: 'mask', region: opts.region,
        slack: opts.slack,
        box: { x: box.x - 3, y: box.y - 2, w: box.w + 6, h: box.h + 4 },
        svg: '<rect x="' + round(box.x - 3, 2) + '" y="' + round(box.y - 2, 2) + '" width="' + round(box.w + 6, 2) + '" height="' + round(box.h + 4, 2) + '" fill="' + PALETTE.white + '"/>'
      });
    }
    return this.add({
      name: opts.name || ('t:' + str).slice(0, 40), role: 'text', region: opts.region, box, slack: opts.slack,
      svg:
        '<text x="' + round(x, 2) + '" y="' + round(y, 2) + '"' +
        (anchor === 'start' ? '' : ' text-anchor="' + anchor + '"') +
        ' font-size="' + size + '"' +
        (opts.weight ? ' font-weight="' + opts.weight + '"' : '') +
        (opts.family === 'mono' ? ' font-family="' + FONT.mono + '"' : '') +
        (opts.tracking ? ' letter-spacing="' + opts.tracking + '"' : '') +
        ' fill="' + (PALETTE[opts.color] || opts.color || PALETTE.text) + '">' + esc(str) + '</text>'
    });
  }

  rect(x, y, w, h, o) {
    const opts = o || {};
    return this.add({
      name: opts.name || 'rect', role: opts.role || 'ink', region: opts.region,
      box: { x, y, w, h }, slack: opts.slack,
      svg:
        '<rect x="' + round(x, 2) + '" y="' + round(y, 2) + '" width="' + round(w, 2) + '" height="' + round(h, 2) + '"' +
        ' fill="' + (PALETTE[opts.fill] || opts.fill || 'none') + '"' +
        (opts.opacity ? ' opacity="' + opts.opacity + '"' : '') +
        (opts.data ? ' ' + opts.data : '') + '/>'
    });
  }

  line(x1, y1, x2, y2, o) {
    const opts = o || {};
    const w = Math.max(opts.width || 1.4, 0.1);
    return this.add({
      name: opts.name || 'line', role: opts.role || 'ink', region: opts.region,
      box: { x: Math.min(x1, x2) - w / 2, y: Math.min(y1, y2) - w / 2, w: Math.abs(x2 - x1) + w, h: Math.abs(y2 - y1) + w },
      slack: opts.slack,
      svg:
        '<line x1="' + round(x1, 2) + '" y1="' + round(y1, 2) + '" x2="' + round(x2, 2) + '" y2="' + round(y2, 2) + '"' +
        ' stroke="' + (PALETTE[opts.stroke] || opts.stroke || PALETTE.slate) + '" stroke-width="' + w + '"' +
        (opts.dash ? ' stroke-dasharray="' + opts.dash + '"' : '') +
        (opts.data ? ' ' + opts.data : '') + '/>'
    });
  }

  circle(cx, cy, r, o) {
    const opts = o || {};
    const rr = r + (opts.strokeWidth || 0) / 2;
    return this.add({
      name: opts.name || 'circle', role: opts.role || 'ink', region: opts.region,
      box: { x: cx - rr, y: cy - rr, w: rr * 2, h: rr * 2 }, slack: opts.slack,
      svg:
        '<circle cx="' + round(cx, 2) + '" cy="' + round(cy, 2) + '" r="' + round(r, 2) + '"' +
        ' fill="' + (PALETTE[opts.fill] || opts.fill || 'none') + '"' +
        (opts.stroke ? ' stroke="' + (PALETTE[opts.stroke] || opts.stroke) + '" stroke-width="' + (opts.strokeWidth || 1.5) + '"' : '') + '/>'
    });
  }

  path(d, box, o) {
    const opts = o || {};
    return this.add({
      name: opts.name || 'path', role: opts.role || 'ink', region: opts.region,
      box, slack: opts.slack,
      svg: '<path d="' + d + '" fill="' + (PALETTE[opts.fill] || opts.fill || 'none') + '"' +
        (opts.opacity ? ' opacity="' + opts.opacity + '"' : '') +
        (opts.stroke ? ' stroke="' + (PALETTE[opts.stroke] || opts.stroke) + '" stroke-width="' + (opts.width || 1.5) + '"' : '') +
        (opts.dash ? ' stroke-dasharray="' + opts.dash + '"' : '') + '/>'
    });
  }

  polyline(pts, o) {
    const opts = o || {};
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const w = opts.width || 2.4;
    const box = { x: Math.min.apply(null, xs) - w / 2, y: Math.min.apply(null, ys) - w / 2, w: Math.max.apply(null, xs) - Math.min.apply(null, xs) + w, h: Math.max.apply(null, ys) - Math.min.apply(null, ys) + w };
    return this.add({
      name: opts.name || 'polyline', role: 'ink', region: opts.region, box, slack: opts.slack,
      svg: '<polyline points="' + pts.map((p) => round(p[0], 2) + ',' + round(p[1], 2)).join(' ') + '" fill="none" stroke="' + (PALETTE[opts.stroke] || opts.stroke || PALETTE.blue) + '" stroke-width="' + w + '"' + (opts.dash ? ' stroke-dasharray="' + opts.dash + '"' : '') + ' stroke-linejoin="round" stroke-linecap="round"/>'
    });
  }

  /* --------------------------------------------------- 柱子(基线同源) */

  /**
   * 柱子:x/y 由引擎算;底边恒等于绘图区基线 baselineY(与轴线同一变量)。
   * value 为 null/undefined 时不画柱。
   */
  bar(panel, i, value, o) {
    const opts = o || {};
    const p = this.panels.get(panel);
    if (!p) throw new Error('[' + this.file + '] bar: 未知面板 ' + panel);
    const ax = this.axisY.get(panel);
    let base = opts.baselineY == null ? ax.y : opts.baselineY;
    const bw = opts.w || 34;
    const cx = opts.cx == null ? p.inner.x + (opts.bandW || p.bandW) * (i + 0.5) : opts.cx;
    const top = opts.top == null ? null : opts.top;
    if (value == null && top == null) return null;
    const yTop = Math.round((top == null ? this.scaleYOf(panel, value) : top) * 100) / 100;
    base = Math.round(base * 100) / 100;
    let h = base - yTop;
    if (h < 0) throw new ChartGeometryError('[' + this.file + '] 柱高为负: <' + (opts.name || 'bar' + i) + '> value=' + value + ' base=' + round(base, 2) + ' top=' + round(yTop, 2));
    if (opts.minH && h < opts.minH) h = opts.minH; // 渲染下限,底边仍锚在 baseline
    const topY = base - h;
    const node = this.add({
      name: opts.name || ('bar' + i), role: 'bar', region: panel,
      box: { x: cx - bw / 2, y: topY, w: bw, h },
      svg: '<rect x="' + round(cx - bw / 2, 2) + '" y="' + round(topY, 2) + '" width="' + round(bw, 2) + '" height="' + round(h, 2) + '" fill="' + (PALETTE[opts.color] || opts.color || PALETTE.blue) + '" data-role="bar" data-panel="' + panel + '" data-base="' + round(base, 3) + '" data-value="' + value + '"/>'
    });
    this.bars.push({ panel, i, x: cx - bw / 2, y: topY, w: bw, h, base: base, value });
    return node;
  }

  scaleYOf(panel, v) {
    const p = this.panels.get(panel);
    const s = this._scale;
    if (!s || s[panel] == null) throw new Error('[' + this.file + '] scaleYOf: 面板 ' + panel + ' 尚未建立比例尺');
    return s[panel].y(v);
  }

  bindScale(panel, fn) {
    this._scale = this._scale || {};
    this._scale[panel] = { y: fn };
  }

  /**
   * 横向条形面板:值轴在底部(水平刻度),柱子自 originX 向右伸出。
   * 行高/基线/刻度位置全部由引擎算,文字要么在左侧留白列、要么在右侧留白列,不与柱体交叠。
   */
  plotBarsH(rect, opts) {
    const o = opts || {};
    const name = o.name || 'h';
    const rows = o.rows;
    const d0 = o.xDomain[0];
    const d1 = o.xDomain[1];
    if (!(d1 > d0)) throw new ChartGeometryError('[' + this.file + '] xDomain 非法');
    const gutter = o.gutter || 120;
    const fmt = o.xFmt || String;
    const tickHalf = (o.xTicks || []).length ? Math.max.apply(null, o.xTicks.map((t) => textWidth(fmt(t), o.xSize || 12))) / 2 : 0;
    const rightPad = Math.max(o.rightPad == null ? 10 : o.rightPad, tickHalf + 3);
    const topLane = o.topLane == null ? 26 : o.topLane;
    const axisGap = o.axisGap == null ? 12 : o.axisGap;
    const bottomGutter = axisGap + 21 + (o.xAxisLabel ? 21 : 0) + 6;
    const q2 = (v) => Math.round(v * 100) / 100;
    const inner = {
      x: q2(rect.x + gutter),
      y: q2(rect.y + topLane),
      w: q2(rect.w - gutter - rightPad),
      h: q2(rect.h - topLane - bottomGutter)
    };
    if (inner.w <= 40 || inner.h <= 40) throw new ChartGeometryError('[' + this.file + '] 横向面板过小', { inner });
    this.region(name, rect, o.parent || 'canvas');
    const rowGap = o.rowGap == null ? 7 : o.rowGap;
    const rowH = Math.round(((inner.h - rowGap * (rows - 1)) / rows) * 100) / 100;
    if (rowH <= 8) throw new ChartGeometryError('[' + this.file + '] 行高过小: ' + round(rowH, 2), { rows, innerH: inner.h, rowGap });
    const x = (v) => inner.x + ((v - d0) / (d1 - d0)) * inner.w;
    const rowTop = (i) => inner.y + i * (rowH + rowGap);
    const axisY = Math.round((inner.y + inner.h + axisGap) * 100) / 100;
    const parts = [];
    const boxes = [];
    for (const t of (o.xTicks || [])) {
      const tx = x(t);
      const ty0 = o.gridFrom == null ? inner.y : o.gridFrom;
      parts.push('<line x1="' + round(tx, 2) + '" y1="' + round(ty0, 2) + '" x2="' + round(tx, 2) + '" y2="' + round(axisY, 2) + '" stroke="' + PALETTE.slate2 + '" stroke-width="1" stroke-dasharray="4 5"/>');
      const tb = textBox(tx, axisY + 19, fmt(t), o.xSize || 12, 'middle');
      boxes.push(tb);
      parts.push('<text x="' + round(tx, 2) + '" y="' + round(axisY + 19, 2) + '" text-anchor="middle" font-size="' + (o.xSize || 12) + '" font-weight="700" fill="' + PALETTE.text2 + '">' + esc(fmt(t)) + '</text>');
      if (t > d0) this.region(name + '-col' + t, { x: tx, y: ty0, w: Math.max(0, x(d1) - tx), h: rowTop(rows - 1) + rowH - ty0 }, name, true);
    }
    parts.push('<line x1="' + round(inner.x, 2) + '" y1="' + round(axisY, 2) + '" x2="' + round(inner.x + inner.w, 2) + '" y2="' + round(axisY, 2) + '" stroke="' + PALETTE.slate + '" stroke-width="1.4" data-role="axis" data-orient="h" data-panel="' + name + '" data-base="' + round(axisY, 3) + '" data-origin="' + round(inner.x, 3) + '"/>');
    if (o.xAxisLabel) {
      const lb = textBox(inner.x + inner.w / 2, axisY + 40, o.xAxisLabel, 13, 'middle');
      boxes.push(lb);
      parts.push('<text x="' + round(inner.x + inner.w / 2, 2) + '" y="' + round(axisY + 40, 2) + '" text-anchor="middle" font-size="13" fill="' + PALETTE.text2 + '">' + esc(o.xAxisLabel) + '</text>');
    }
    this.add({ name: name + '-axis', role: 'axis', region: name, box: unionBox(boxes), svg: parts.join('') });
    const vlines = (o.vlines || []).map((v) => {
      const name2 = name + '-vline' + v;
      this.region(name2, { x: x(v), y: inner.y, w: Math.max(0, inner.x + inner.w - x(v)), h: inner.h }, name, true);
      return { v, x: x(v) };
    });
    return {
      name, rect, inner, rowTop, rowH, axisY, xOf: x, x0: inner.x, x1: inner.x + inner.w, vlines,
      bar: (i, v, o2) => {
        const opts2 = o2 || {};
        const bw = opts2.w == null ? x(Math.min(v, d1)) - inner.x : opts2.w;
        const x0 = opts2.x0 == null ? inner.x : opts2.x0;
        const top = rowTop(i) + (opts2.inset || 0);
        const h = opts2.h == null ? rowH - (opts2.inset || 0) * 2 : opts2.h;
        return this.add({
          name: opts2.name || ('hbar' + i), role: 'bar', region: name, slack: opts2.slack,
          box: { x: x0, y: top, w: Math.max(0, bw), h },
          svg: '<rect x="' + round(x0, 2) + '" y="' + round(top, 2) + '" width="' + round(Math.max(0, bw), 2) + '" height="' + round(h, 2) + '" fill="' + (PALETTE[opts2.color] || opts2.color || PALETTE.blue) + '" data-role="hrow"/>'
        });
      },
      label: (i, str, o2) => this.text(inner.x - 12, rowTop(i) + rowH / 2 + (o2 && o2.dy || 4.5), str, Object.assign({ region: name, anchor: 'end', size: 13 }, o2)),
      value: (i, str, o2) => this.text(o2 && o2.x != null ? o2.x : rect.x + rect.w - 6, rowTop(i) + rowH / 2 + (o2 && o2.dy || 4.5), str, Object.assign({ region: name, anchor: 'end', size: 13, weight: 700 }, o2)),
      track: (i, v, o2) => this.add({
        name: (o2 && o2.name) || ('track' + i), role: 'ink', region: name,
        box: { x: inner.x, y: rowTop(i), w: x(Math.min(v, d1)) - inner.x, h: rowH },
        svg: '<rect x="' + round(inner.x, 2) + '" y="' + round(rowTop(i), 2) + '" width="' + round(x(Math.min(v, d1)) - inner.x, 2) + '" height="' + round(rowH, 2) + '" fill="' + (PALETTE[(o2 && o2.fill) || 'slate2']) + '" opacity="0.45"/>'
      })
    };
  }

  /* ------------------------------------------------------------ 输出 */

  validate() {
    const W = this.W;
    const H = this.H;
    for (const n of this.nodes) {
      const b = n.box;
      if (![b.x, b.y, b.w, b.h].every((v) => Number.isFinite(v))) {
        throw new ChartGeometryError('[' + this.file + '] 非有限坐标: <' + n.name + '>', b);
      }
      if (n.role === 'bg') continue;
      if (!contains({ x: 0, y: 0, w: W, h: H }, b, 0)) {
        throw new ChartGeometryError('[' + this.file + '] 越出 viewBox: <' + n.name + '>', { box: b, viewBox: { x: 0, y: 0, w: W, h: H } });
      }
      const isText = n.role === 'text' || n.role === 'head';
      const slack = isText ? 0.5 : CHROME.REGION_SLACK;
      if (!contains({ x: CHROME.EDGE, y: CHROME.MIN_INK_GAP, w: W - CHROME.EDGE * 2, h: H - CHROME.MIN_INK_GAP * 2 }, b, slack)) {
        throw new ChartGeometryError('[' + this.file + '] 侵入安全边距(' + (isText ? '文字' : '图形') + '): <' + n.name + '>', { box: b, minGap: CHROME.EDGE });
      }
    }
    return true;
  }

  contentBox() {
    return unionBox(this.nodes.filter((n) => n.role !== 'bg' && n.role !== 'head').map((n) => n.box));
  }

  fillRatio() {
    const c = this.contentBox();
    return c ? (c.w * c.h) / (this.W * this.H) : 0;
  }

  render() {
    this.validate();
    const out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + this.W + ' ' + this.H + '" width="' + this.W + '" height="' + this.H + '" preserveAspectRatio="xMidYMid meet" role="img" style="font-variant-numeric:tabular-nums" font-family="' + FONT.sans + '">');
    out.push('<title>' + esc(this.aria) + '</title>');
    out.push('<rect width="' + this.W + '" height="' + this.H + '" fill="' + PALETTE.white + '"/>');
    for (const r of this.regions.values()) {
      out.push('<!--region ' + r.name + ' ' + round(r.box.x, 2) + ' ' + round(r.box.y, 2) + ' ' + round(r.box.w, 2) + ' ' + round(r.box.h, 2) + '-->');
    }
    for (const n of this.nodes) out.push(n.svg);
    out.push('</svg>');
    out.push('');
    return out.join('\n');
  }

  write(dir) {
    const svg = this.render();
    const file = path.join(dir, this.file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, svg, { encoding: 'utf8' });
    return { file, bytes: Buffer.byteLength(svg, 'utf8'), fillRatio: this.fillRatio(), height: this.H, nodes: this.nodes.length };
  }
}

export default { Chart, PALETTE, ALLOWED_COLORS, FONT, CHROME, textWidth, textBox, esc, round, align20, niceCeil, niceTicks, ChartGeometryError };
