# 01 · FOUNDATION — 动效 token + 双闸门 + 按压基线

- **Status**: TODO
- **Commit**: `4af2421`
- **Severity**: HIGH
- **Category**: 一致性与 token / 无障碍 / 反馈
- **Estimated scope**: 1 file，`<style>` 内约 +55 行（纯新增，不改既有规则）

---

## Problem

### P1 — 页面零 motion token，所有时序都是字面量

`docs/landing/index.html:62`（唯一入场动效）：

```css
.js-reveal.in{opacity:1;transform:none;transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1)}
```

`:root`（`L20–34`）有配色、字体、栅格 token，**唯独没有时长/缓动/位移/缩放/模糊**。后果：每加一处动效就得再猜一次数值，页面必然越改越散。

### P2 — 15 处 `:hover` 全部无设备门控

触屏没有 hover，浏览器会「假装」一个：点按后 `:hover` 态**留在元素上**直到点别处。本页 15 处 hover 里有 8 处会改变可见外观（背景/颜色/位移），点按后会粘住。取证：

```bash
# 无门控证据：全页 0 处 @media (hover: hover)
grep -c "hover: hover" docs/landing/index.html   # → 0
grep -c ":hover"       docs/landing/index.html   # → 15
```

### P3 — 全页 0 处 `:active`，按钮没有按压反馈

`.btn`(`L126`) / `.promo-btn`(`L369`) / `.copy-btn`(`L473`) / `.link-chip`(`L493`) 只有 hover 变色，**按下瞬间没有任何反应**。触屏上更严重——没有 hover，点按等于完全无反馈。

Apple 的判据（`apple-design` §1）：反馈必须发生在 **pointer-down**，等到 `click`（手指抬起）才给反馈，读起来是「卡」。`emil-design-eng` 给的量级是 `scale(0.97)`、100–160ms。

---

## Target

### T1 — 在 `:root` 末尾追加动效 token（逐字抄，勿改数值）

**位置**：`L20` 的 `:root{` 与 `L34` 的 `}` 之间，接在 `--gutter:24px;` 之后。

```css
    /* ── 动效 token（用途优先：按「在做什么事」选，不按数值就近）── */
    --duration-stagger:40ms;      /* 逐项错开 */
    --duration-micro:80ms;        /* 意图延迟、小抖动 */
    --duration-quick:150ms;       /* 关闭、文字切换 */
    --duration-fast:250ms;        /* 打开、指示器滑动、图标切换 */
    --duration-medium:350ms;      /* 面板关闭 */
    --duration-slow:400ms;        /* 面板打开 */
    --duration-very-slow:500ms;   /* 强调时刻、文字/卡片揭示 */
    --ease-smooth-out:cubic-bezier(.22,1,.36,1);  /* 默认曲线：开/关、滑动、位移 */
    --ease-in-out:ease-in-out;                    /* 文字切换/揭示 */
    --distance-micro:4px;   /* 文字切换 */
    --distance-base:8px;    /* 页面前进、斜向揭示 */
    --distance-medium:12px; /* 文字揭示 */
    --scale-press:0.97;     /* 按压缩放（唯一允许的缩放） */
    --scale-enter:0.99;     /* 进入起点（禁 scale(0)） */
    --blur-small:2px;       /* 跨状态切换的掩护 */
```

**为什么不抄 `tokens.css` 全量**：那份含 `--ease-bounce` / `--ease-bounce-strong` / `--scale-large(0.96)` / `--blur-large(8px)`，与本页「无渐变、无圆角、无阴影堆砌」的现代主义语言冲突（见 `README.md §2`）。**只取本页需要的 15 条。**

### T2 — 全局双闸门（reduced-motion + hover 设备门控）

`L561–566` 现有的 reduced-motion 块**必须保留**（它守的是既有 3 个 keyframes）。在它**之前**插入一条新块：

```css
  /* ── 新增动效统一挂 reduced-motion 闸门：少而缓，不是零 ── */
  @media (prefers-reduced-motion: reduce){
    .js-reveal{transition-duration:1ms}
    .btn:active,.promo-btn:active,.copy-btn:active,.link-chip:active,.mnode:active{transform:none}
    .m-detail{transition-duration:1ms}
    .stat-cell .v{transition-duration:1ms}
  }
```

> **判据**（`animate` skill §7）：reduced motion 是「更少更轻」，**不是零**。保留 opacity/color 的过渡（帮助理解状态变化），去掉位移与缩放。所以这里是**按选择器归零**，不是 `* { transition: none }`。

### T3 — 按压反馈（`:active`），并给现有 hover 加门控

在 `.btn` 规则群之后（`L139` 附近，`.meta-line` 之前）插入：

```css
  /* ── 按压反馈：pointer-down 即响应（Apple §1）── */
  .btn,.promo-btn,.copy-btn,.link-chip,.promo-dots a,.mnode,.md-close{
    transition:transform var(--duration-quick) var(--ease-smooth-out),
               background var(--duration-quick) var(--ease-smooth-out),
               color var(--duration-quick) var(--ease-smooth-out),
               border-color var(--duration-quick) var(--ease-smooth-out);
  }
  .btn:active,.promo-btn:active,.copy-btn:active,.link-chip:active,.mnode:active,.md-close:active{
    transform:scale(var(--scale-press));
  }
  .promo-dots a:active{transform:scale(0.9)}
  /* ── hover 只在真指针设备生效（触屏点按后 hover 会粘住）── */
  @media (hover: hover) and (pointer: fine){
    .g-card img{transition:filter var(--duration-fast) var(--ease-smooth-out)}
    .g-card:hover img{filter:none}
  }
```

**注意**：`.g-card:hover img{filter:none}` 原本在 `L450`，**必须把它整体移进**上面的媒体查询，否则触屏点按图片会永久去灰。移入后 `L450` 原处删除该行。

---

## Repo conventions to follow

- **新增 CSS 一律内联进本文件唯一的 `<style>`**（`L10–567`）。页面零外部依赖是硬约束（`README.md §0.1`）。
- **注释用「── 标题 ──」形式**，与既有风格一致（如 `L56  /* ── 通用骨架 ── */`、`L64 /* ── 顶栏 ── */`）。
- **token 命名对齐 `transitions-motion` 的 `tokens.css`**（`--duration-*` / `--ease-*` / `--distance-*`），便于后续维护者一眼认出体系来源。
- 参照物：`L20–34` 的 `:root` 就是本项目声明 token 的唯一位置，**不要新建第二个 `:root`**。

---

## Steps

1. 读 `docs/landing/index.html`，确认 `:root` 在 `L20–34`、`--gutter:24px;` 在 `L33`。
2. 在 `L33` 后、`L34` 的 `}` 前，插入 **T1** 的 15 条 token。
3. 在 `L450` 处删除 `.g-card:hover img{filter:none}`，稍后并入第 5 步的媒体查询。
4. 在 `L139` 之后插入 **T3** 的按压反馈块 + 媒体查询（含上一步移入的 `.g-card` 规则）。
5. 在 `L561` 的 `@media (prefers-reduced-motion: reduce){` **之前**插入 **T2** 的块。
6. 跑 `06-VERIFY.md` 的探针，确认无语法错误、`getComputedStyle(document.documentElement).getPropertyValue('--duration-quick')` 返回 `150ms`。

---

## Boundaries

- **不改** `L62` 的 `.js-reveal` 时序——那是 `02-SCROLL.md` 的范围。
- **不改** `L561–566` 既有 reduced-motion 块的任何一行，只在其**前面**新增。
- **不删**任何既有 `@keyframes`（`blink` / `fill` / `cell-hit`）。
- **不加** `--ease-bounce*` / `--blur-large` / `--scale-large`（见 `README.md §2` 三条禁令）。
- **不动** `<head>`、`<body>` 结构与全部 JS。
- 若 `:root` 内容与本文不符（说明已被改动），**停下报告**，不要自行寻找替代位置。

---

## Verification

- **Mechanical**：跑 `06-VERIFY.md` 探针 → `probe.cssVarsOk === true`（15 条 token 全部可读且值一致）。
- **Mechanical**：探针统计 `@media (hover: hover)` 出现次数 = **1**；`:hover` 规则总数不变（15，未删）。
- **Feel check**（DevTools）：
  - 按住任一按钮不放 → 立刻缩到 97%，**松手前就已缩**（若抬指才缩，说明写成了 `click` 而非 `:active`）。
  - 在 Device Toolbar 切到 iPhone，点一次 `.link-chip` → 背景**不残留**深色。
  - Rendering 面板勾 `prefers-reduced-motion: reduce` → 按压缩放**消失**，但 hover 换色**仍在**。
- **Done when**：token 可读、门控计数正确、按压在 pointer-down 生效、reduced-motion 下缩放归零而换色保留。
