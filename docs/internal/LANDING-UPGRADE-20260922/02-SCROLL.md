# 02 · SCROLL — 入场分级与错开

- **Status**: TODO
- **Commit**: `4af2421`
- **Severity**: MEDIUM
- **Category**: 缓动与时长 / 遗漏的机会
- **Estimated scope**: 1 file，CSS 改 1 行 + 新增约 12 行；JS 改约 10 行
- **依赖**: `01-FOUNDATION.md` 必须先完成（本计划引用其 token）

---

## Problem

`docs/landing/index.html:61–62`：

```css
  .js-reveal{opacity:0;transform:translateY(14px)}
  .js-reveal.in{opacity:1;transform:none;transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1)}
```

`docs/landing/index.html:1679–1690`（JS，给 32 个元素挂观察器）：

```js
  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var els = document.querySelectorAll('.reveal');
    if (els.length){
      els.forEach(function(el){ el.classList.add('js-reveal'); el.classList.remove('reveal'); });
      document.querySelectorAll('.js-reveal').forEach(function(el){ io.observe(el); });
    }
  }
```

### 问题 1 — 曲线弱、时长超预算

`cubic-bezier(.2,.7,.2,1)` 是手写的、比 `--ease-smooth-out` 更弱的缓出；`.55s` 超出 `animate` skill 的 UI 预算（>300ms）。营销页可以更长，但**不能更钝**——弱曲线 + 长时长 = 「拖沓」，不是「从容」。

### 问题 2 — 32 个元素同刻整块入场

`.reveal` 实测出现在 **32 处**（`L596` hero-copy、`L623` schematic、`L669/673/677/681` 四个 stat-cell、`L691` sec-head、`L699` pipe-flow、`L738` arch、`L781` promo、`L852–1111` 十二个 feature、`L1145` gallery-grid、`L1189` qs-grid、`L1230` ai-box、`L1259` comm-grid、`L1272` links-row…）。

其中 `L1145 .gallery-grid` 与 `L1189 .qs-grid` 内部各有多个子卡/子格。整块一起淡入，读起来像「一页纸被整体推上来」，没有任何节奏。

`emil-design-eng` 的判据：多个元素一起入场要 stagger（每项 30–80ms），**但总错开要控制在 ~300ms 内**，否则最后一项显得迟到。

### 问题 3 — 位移偏大且单调

`translateY(14px)` 对 84px 的大标题合适，对一个 4 格的 stat 带就偏大。`transitions-motion` 的刻度里 `--distance-medium:12px` 是「文字揭示」档。

---

## Target

### T1 — 曲线与时长对齐 token

替换 `L62` 整行为：

```css
  .js-reveal.in{opacity:1;transform:none;transition:opacity var(--duration-very-slow) var(--ease-smooth-out),transform var(--duration-very-slow) var(--ease-smooth-out)}
```

### T2 — 三档位移分级

替换 `L61` 整行为下面这一组（**原 `L61` 单行改成 4 行**）：

```css
  /* 入场分级：大块走得远一点，小件走得近一点 */
  .js-reveal{opacity:0;transform:translateY(var(--distance-medium))}
  .js-reveal.r-sm{transform:translateY(var(--distance-micro))}
  .js-reveal.r-lg{transform:translateY(18px)}
```

- **默认**（`--distance-medium:12px`）：feature、sec-head、arch、promo、表格类
- **`.r-sm`**（4px）：stat-cell、links-row、gallery 内的子卡
- **`.r-lg`**（18px）：hero-copy、schematic **——只此两处**

### T3 — 子项错开（stagger）

针对**容器内含子项**的三处（`.stats-grid`、`.gallery-grid`、`.qs-grid`），给子项加错开：

```css
  /* 容器内的子项依次入场（总错开 ≤ 300ms）*/
  .stats-grid .js-reveal:nth-child(1),
  .qs-grid   .js-reveal:nth-child(1),
  .gallery-grid .js-reveal:nth-child(1){transition-delay:0ms}
  .stats-grid .js-reveal:nth-child(2),
  .qs-grid   .js-reveal:nth-child(2),
  .gallery-grid .js-reveal:nth-child(2){transition-delay:var(--duration-stagger)}
  .stats-grid .js-reveal:nth-child(3),
  .qs-grid   .js-reveal:nth-child(3),
  .gallery-grid .js-reveal:nth-child(3){transition-delay:80ms}
  .stats-grid .js-reveal:nth-child(4),
  .qs-grid   .js-reveal:nth-child(4),
  .gallery-grid .js-reveal:nth-child(4){transition-delay:120ms}
```

> **判据**：`40ms × 4 = 160ms`，加 500ms 时长最晚 660ms 结束，**在可接受范围内**。**不要**给 12 个 feature 也加错开——它们不同时进入视口，`IntersectionObserver` 天然会错开，再叠 delay 会让人以为是卡顿。

### T4 — JS：给 `.reveal` 打分级标记

**只改 `L1679–1690` 这一个 `if` 块**，保持原有判断逻辑不变，仅追加分级赋值：

```js
  if ('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(e){
        if (e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    var els = document.querySelectorAll('.reveal');
    if (els.length){
      els.forEach(function(el){
        el.classList.add('js-reveal');
        el.classList.remove('reveal');
        /* 入场分级：只影响位移距离，不改时序体系 */
        if (el.classList.contains('hero-copy') || el.classList.contains('schematic')) el.classList.add('r-lg');
        else if (el.classList.contains('stat-cell') || el.classList.contains('links-row') || el.classList.contains('g-card')) el.classList.add('r-sm');
      });
      document.querySelectorAll('.js-reveal').forEach(function(el){ io.observe(el); });
    }
  }
```

> **注意**：`.g-card` 上**没有** `.reveal`（32 处清单里没有它），所以这条分支实际只对 `stat-cell` / `links-row` 生效。保留 `.g-card` 判断是为了将来对齐，**不得**为了让它生效而去给 `.g-card` 加 `.reveal`（那会改变 DOM 结构，超出本计划范围）。

### T5 — 子项也要成为入场主体

T3 的 `:nth-child` 选择器要求子项本身带 `.js-reveal`。实测四个 `.stat-cell` 各自**已带** `.reveal`（`L669/673/677/681`）⇒ 它们已经是独立入场主体，T3 直接生效。

**.gallery-grid / .qs-grid 的子项当前不带 `.reveal`** ⇒ T3 中针对它们的 `:nth-child` 规则**不会生效，也不会报错**（安全）。**不要为此改 HTML**——那属于结构变更。T3 保留这两组选择器，是为了在将来（若用户要求）对齐时零成本启用。

---

## Repo conventions to follow

- 页面 JS 是 **ES5 风格**（`var`、`function(){}`、无箭头函数、无模板串）。新增代码**必须同风格**——`L1595–1689` 全段可作范本。
- 分级类名用 **`r-sm` / `r-lg`** 前缀（`r` = reveal），避免与既有语义类名冲突。页面已用的独立前缀：`.js-`（JS 增强）、`.f-`（feature）、`.pf-`（pipe-flow）、`.qs-`（quick-start）、`.ft-`（footer）、`.sch-`（schematic）、`.arch-`、`.promo-`、`.g-`（gallery）。
- 注释语言与体例对齐既有：中文 + `/* ── x ── */`。

---

## Steps

1. 确认 `01-FOUNDATION.md` 已完成（`:root` 里能读到 `--duration-very-slow` / `--ease-smooth-out` / `--distance-medium` / `--distance-micro` / `--duration-stagger`）。
2. 替换 `L62` 为 **T1**。
3. 替换 `L61` 为 **T2** 的 4 行。
4. 在 `.js-reveal` 组之后（即 T2 那 4 行下面）追加 **T3** 的错开块。
5. 按 **T4** 修改 `L1679–1690` 的 `els.forEach` 回调。
6. 跑 `06-VERIFY.md`：确认探针里 `revealOnScroll === 32` 且分级类计数为 `r-lg=2` / `r-sm≥5`。

---

## Boundaries

- **不改** `IntersectionObserver` 的 `rootMargin` / `threshold`——现有 `-8%` / `0.08` 手感没问题。
- **不改** 任何元素的 `.reveal` 归属（即：不给新元素加 `.reveal`，也不删现有的），T5 已说明理由。
- **不引入** 滚动驱动的连续动画（禁用清单，`README.md §2.3`）。
- **不用** `@keyframes` —— 入场必须保留「可中断、可重定向」的 transition 特性（`animate` skill §6）。
- 若 `.js-reveal` 相关行号与本文不符，**停下报告**。

---

## Verification

- **Mechanical**：探针输出 `revealTotal === 32`；`r-lgCount === 2`；`r-smCount >= 5`；`jsRevealRule` 字符串含 `--duration-very-slow` 且**不含** `.55s`。
- **Feel check**：
  - 慢慢向下滚过「十二个能力」一节：每个 feature 触发时**只有它自己**动，不是整屏一起动。
  - 滚到首屏统计带：四个数字格**依次**（非同时）浮起。
  - 快速上下滚动：入场**不重播**（`io.unobserve` 保住了），且已入场的元素**不回退**。
  - DevTools → Animations 面板把播放速度调到 10%，确认曲线是「快起慢收」，开场没有停顿（有停顿说明写成了 `ease-in`）。
  - Rendering → `prefers-reduced-motion: reduce`：元素直接可见（`01-FOUNDATION.md` 的 T2 把 duration 归零到 1ms），**不得**出现「元素消失」。
- **Done when**：三档位移生效、统计带依次入场、reduced-motion 下无元素丢失。
