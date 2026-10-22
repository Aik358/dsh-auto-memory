# 图表工具包（CHART-KIT）

> 面向：写技术报告 / 调研报告 / 白皮书的作者。
> 一句话：**别手写 SVG 坐标**——把数据交给引擎，它替你算比例尺、基线、刻度和版面，并当场拦住画错的图。

这四个脚本最初是为本仓 news 站的 20 张配图写的，但它们是**零依赖的通用图表引擎**，
和数据无关、和本插件无关。你可以整套拷进自己的仓库直接用。

---

## 一、四个文件是什么

| 文件 | 行数 | 角色 | 什么时候改它 |
|---|---|---|---|
| `tools/chart-engine.mjs` | 751 | **引擎**。声明式 SVG 图表核心：坐标系、比例尺、基线、刻度、版面分配全在这里 | 基本不用改。要新图元（如箱线图）才动 |
| `tools/chart-figs.mjs` | 746 | **图目录**。19 张图的「数据 + 版式意图」声明，单点真源 | 要加/改图就照抄一张，改数据 |
| `tools/chart-figs-step5.mjs` | 76 | **重绘示例**。同一份数据换成横向条形版式的完整范例（含"不覆盖既有图"的做法） | 当模板读，或加自己的新图 |
| `tools/chart-audit.mjs` | 351 | **独立审计器**。重新解析落盘文件、重新算包围盒、独立复算契约，含变异自检 | 不用改。当验收闸门用 |

引擎与审计器是**两套独立实现**：引擎"预算"、审计器"复算"。
一份改动只在两边都过，才算真的对——这是本工具包最值钱的地方。

---

## 二、为什么用它（解决了什么）

手写 SVG 图表会稳定地踩这几个坑，而且**都不报错**：

| 坑 | 症状 | 本工具包怎么处理 |
|---|---|---|
| 元素越出画布 | 图被裁掉一角，导出后才看见 | 引擎在每个图元落盘前算包围盒，越界**当场 throw**，附元素名与坐标 |
| 柱子底边与轴线不齐 | 视觉上"飘"，差 1–2px 说不清哪错 | 两者由**同一个变量** `baselineY` 算出，Δ 恒等于 0 |
| 文字互相压住 | 中文标签一长就重叠 | 文本度量按字符宽度累加，审计器逐对检查重叠 |
| 文字出血 | 顶部标签被 `viewBox` 切掉 | 安全边距由 `CHROME` 常量统一锁定并复审 |
| 颜色跑出品牌色板 | 又多一个近似蓝 | 色板白名单，越界即报 |
| 版面留大片死区 | 内容只占画布 40% | 剩余空间再分布，审计器断言填充率 ≥ 0.75 |

**核心设计：把"画错"变成不可能事件**，而不是靠事后肉眼检查。

---

## 三、快速上手

### 3.1 依赖

无。只用 `node:fs` / `node:path` / `node:url`，Node 18+ 即可。

### 3.2 输出目录

四个脚本默认写到 **本脚本所在仓库** 的：

```
<repo>/docs/landing/news/assets/figures/
```

不需要改代码即可覆盖：

```bash
# 写到别处（比如你自己的 docs/figures/）
CHART_FIGDIR=/abs/path/to/your/figures node tools/chart-figs.mjs
```

> 早期版本把绝对路径写死在源码里，换台机器就跑不了。现已改为
> `fileURLToPath(import.meta.url)` 向上取仓库根 + `CHART_FIGDIR` 可覆盖，**零配置可移植**。

### 3.3 跑一遍

```bash
# 生成全部图
node tools/chart-figs.mjs

# 只生成一张
node tools/chart-figs.mjs fig-cover.svg

# 独立审计（人读格式）
node tools/chart-audit.mjs

# 独立审计（JSON，便于接 CI）
node tools/chart-audit.mjs --json

# 变异自检：故意把图改坏，验证审计器**真的能抓到**
node tools/chart-audit.mjs --selftest
```

`--selftest` 是本工具包的验收核心：它对 8 条断言逐条注入一个真实缺陷
（越界 / 负坐标 / 基线脱锚 / 填充率不足 / 文字出血 / 文字重叠 / 色板越界 / 契约违反），
要求**每条都变红**，然后还原并要求**全部转绿**。

实测输出（20 张图）：

```
变异自检(每条断言必须变红;还原后必须全绿)
  RED  ✔  B 越界
  RED  ✔  C 负坐标
  RED  ✔  D 基线脱锚
  RED  ✔  E 填充率
  RED  ✔  F 文字出血
  RED  ✔  G 文字重叠
  RED  ✔  H 色板越界
  RED  ✔  A 契约

还原后 20 张全绿 = YES
捕获率 = 8/8
```

> ⚠️ `--selftest` 会**临时改写**被审计的 SVG 并在 `finally` 里还原。
> 它只应作用在你自己的图目录；不要指向只读或受版本控制的共享目录跑。

---

## 四、写一张自己的图

### 4.1 最小可跑示例

```js
import { Chart, PALETTE as C } from './chart-engine.mjs';

const ch = new Chart({
  file: 'fig-demo.svg',                          // 必填：输出文件名
  aria: '三种方案的召回率对比',                    // <title>，无障碍必填
  title: '方案对比',                              // 图内大标题
  subs: ['同一测试集，5 次取均值'],                // 副标题（最多 2 行）
  legend: [{ label: 'recall', color: 'blue' }],   // 图例
  padL: 56, padR: 56, plotH: 320, gap: 40,       // 版面意图（不写坐标）
  caption: [{ text: '方案 B 高 3.2 个点', color: 'warn' }]  // 图注
});

const p = ch.plotArea(ch.plot, {
  name: 'p',
  yTicks: [0, 0.25, 0.5, 0.75, 1],
  yFmt: (v) => v.toFixed(2),
  bandCount: 3,                                  // 3 根柱
  topLane: 30, rightPad: 8,
  xLabels: ['A', 'B', 'C'].map((t, i) => ({ i, lines: [{ text: t }] }))
});

[0.61, 0.78, 0.66].forEach((v, i) => {
  ch.bar('p', i, v, { color: 'blue', w: 62, name: 'bar' + i });
  ch.text(p.bandX(i), p.y(v) - 8, v.toFixed(2),
    { region: 'p', anchor: 'middle', size: 12.5, weight: 700, color: 'blue' });
});

ch.write('docs/figures');   // 落盘，返回 { file, bytes, fillRatio, height, nodes }
```

要点：**调用方只给数据与版式意图，不写任何 x/y 坐标**。
坐标由 `plotArea` / `bandX` / `y()` 给出——这正是"画不错"的来源。

### 4.2 主要 API

**画布级**

| 方法 | 作用 |
|---|---|
| `new Chart(spec)` | `file` 必填；可给 `title` / `subs` / `legend` / `caption` / `padL` / `padR` / `plotH` / `gap` |
| `splitCols(rect, n, gap)` | 横向切 n 列，列间空隙自动注册为空区（防内容溢入） |
| `headBand(rect, {title, sub}, region)` | 在 rect 顶部划标题带，返回其下剩余 rect |
| `write(dir)` | 落盘并返回 `{file, bytes, fillRatio, height, nodes}` |

**绘图区**（`plotArea` 返回对象）

| 字段 / 方法 | 作用 |
|---|---|
| `y(v)` / `x(v)` | 值 → 像素 |
| `bandX(i)` / `bandW` | 第 i 个分组的中心 / 带宽 |
| `baselineY` | 基线 y（与柱子底边同源） |
| `bar(i, v, opts)` | 第 i 组柱；`opts` 支持 `color` / `w` / `cx` / `minH` / `name` |
| `text/line/rect/circle/path/polyline` | 图元，自动带上 `region` |

**横向条形**（`plotBarsH(rect, opts)`）——中文长标签更友好：

```js
const h = ch.plotBarsH(ch.plot, {
  name: 'h',
  xDomain: [0, 1], xTicks: [0, 0.5, 1],
  rows: 6, gutter: 150,
  xFmt: (v) => v.toFixed(1)
});
rows.forEach((r, i) => {
  h.bar(i, r.v, { color: r.hot ? 'blue' : 'slate' });
  h.label(i, r.name);
  h.value(i, r.v.toFixed(3), { x: h.xOf(r.v) + 10, anchor: 'start' });
});
```

### 4.3 契约常量（改之前先想清楚）

```js
CHROME = { W: 880, TOP: 84, BOTTOM: 56, EDGE: 44, MIN_INK_GAP: 6, REGION_SLACK: 1.0 }
```

画布宽恒为 880，高度由 `plotH` 推出并 **align 到 20 的整数倍**——这是审计器 A 组断言的前提。
色板是白名单（`ALLOWED_COLORS`），加色要同时改 `PALETTE` 与 `chart-audit.mjs` 的 `ALLOWED_COLORS`，
否则 H 组必红。

---

## 五、审计器的 8 组断言

| 组 | 断言 | 失败含义 |
|---|---|---|
| A | `viewBox="0 0 880 H"` / H%20==0 / width+height / preserveAspectRatio / title / role=img | 契约被破坏，缩放行为不可预期 |
| B | 0 元素越出 viewBox（含描边半宽） | 图被裁 |
| C | 0 负坐标 | 内容跑到画布外 |
| D | 柱子底边 vs 同面板轴线 Δ = 0 | 基线不同源 |
| E | 内容填充率 ≥ 0.75 | 版面死区过大 |
| F | 文字不出血（顶 ≥8 / 左右 ≥44 / 底 ≥6） | 标签被切 |
| G | 0 文字互相重叠 | 中文长标签压字 |
| H | 颜色 ⊆ 色板 / 字体栈 / tabular-nums / LF / UTF-8 | 视觉或编码漂移 |

---

## 六、接进 CI

```yaml
- name: 图表契约审计
  run: |
    node tools/chart-figs.mjs
    node tools/chart-audit.mjs
    node tools/chart-audit.mjs --selftest
```

三步缺一不可：**生成**证明能跑、**审计**证明产物合规、**自检**证明审计器没退化成恒绿。
只跑前两步的话，审计器本身被改坏也照样"全绿"——这正是本工具包要防的那类失守。

`--json` 输出可直接喂给报告生成器。

---

## 七、可复现验收基线

本仓 20 张图（19 张正式 + 1 张 step5 重绘版）的实测值：

```
AUDIT: 20 PASS / 0 FAIL
0 越界 = YES
柱子底边 vs 轴线 最大 Δ = 0.000000000px
最小内容填充率 = 78.4%
文字出血 = NO
文字互相重叠 = NO
```

在你自己的仓库里跑，数字会不同——**要验的是 FAIL 为 0，以及自检捕获率 8/8**，
不是这几个具体数值。

---

## 八、已知限制

1. **只画 SVG**，不导出 PNG/PDF。需要位图就在报告里引用 SVG（现代浏览器与 Word 都支持）。
2. **不支持交互**。这是为静态报告设计的，没有 tooltip / hover。
3. **中文字宽度用估算表**（`charWidth`），不是真字体度量。极端窄体/艺术字会偏；
   要精确请改 `charWidth` 或换成真排版库。
4. **图元种类有限**：柱、横条、折线、散点、任意 path。没有箱线图、热力图、桑基图。
5. **`--selftest` 会临时改写目标 SVG**（有 `finally` 还原，但进程被强杀会留下改动）。
