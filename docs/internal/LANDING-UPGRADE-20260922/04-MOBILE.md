# 04 · MOBILE — 平台层基线（11 条中的 9 条适用）

- **Status**: TODO
- **Commit**: `4af2421`
- **Severity**: HIGH
- **Category**: 无障碍 / 平台适配
- **Estimated scope**: 1 file，`<head>` 约 +3 行，CSS 约 +20 行
- **依赖**: 无（可独立于 01 执行；但与 01 有 1 处交集，见 Steps 注）

---

## 0. 适用范围裁定（先读，避免照抄全部 11 条）

`mobile-native` skill 给了 11 条症状。逐条对本页实测**裁定是否适用**：

| # | 症状 | 本页实测 | 裁定 |
|---|---|---|---|
| 1 | 点按后 hover 粘住 | 15 处 `:hover`，**0 处门控** | ✅ **适用** → 已在 `01-FOUNDATION.md` T3 处理 |
| 2 | 点按蓝/灰高亮闪 | `-webkit-tap-highlight-color` 出现 **0** 次 | ✅ **适用** → 本计划 T1 |
| 3 | 高度用错单位 | `100vh` / `100dvh` 出现 **0** 次 | ❌ **不适用**（页面不依赖视口高度，无 bug） |
| 4 | 输入框聚焦缩放 | 全页 **0 个 `<input>` / `<textarea>` / `<select>`** | ❌ **不适用**（无表单） |
| 5 | 点按迟钝 | `touch-action` 出现 **0** 次 | ✅ **适用** → 本计划 T2 |
| 6 | 下拉刷新劫持滚动 | `overscroll-behavior` 出现 **0** 次 | ✅ **适用** → 本计划 T3 |
| 7 | 内容被刘海裁掉 | 有 `viewport-fit=cover`（`L5`），但 `env(safe-area-inset-*)` **0** 次 | ✅ **适用** → 本计划 T4（**半个 bug**：`viewport-fit=cover` 让页面进刘海区，却没有任何 inset padding 补回来） |
| 8 | 长按选中按钮文字 | `user-select` 出现 **0** 次 | ✅ **适用** → 本计划 T5 |
| 9 | 横向轮播纵向抖动 | 有横向滚动容器 `.promo-track`（`L346`） | ✅ **适用** → 本计划 T6 |
| 10 | 状态栏颜色不匹配 | 有 `theme-color`（`L8`），但**单一值** `#F4F1EB` | ⚠️ **部分适用** → 本计划 T7（页面 `color-scheme` 硬写 `light`（`L6`），**没有暗色模式**，故单值**是正确的**） |
| 11 | 桌面对、手机错 | 无真机证据 | ⚠️ **无法验证** → 见文末「真机交底」 |

**结论：9 条中，6 条适用、2 条不适用、1 条部分适用。**

---

## Problem

### P1 — 页面已声明 `viewport-fit=cover`，却没有安全区补偿

```html
<!-- L5 -->
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
```

`viewport-fit=cover` 的作用是**让页面延伸到刘海/灵动岛/Home 指示条下方**。本页有三个 `position` 定位/贴边的界面元素会因此被裁或被压：

- `.topbar`（`L65`）`position:sticky;top:0` ⇒ 顶到状态栏底下
- `footer`（`L503`）`padding:40px 0 48px` ⇒ 底部内容可能落在 Home 指示条区域
- `.m-detail` 的 `md-body`（`L330`）`max-height:150px;overflow-y:auto` ⇒ 内部滚动区

**当前状态**：`env(safe-area-inset-*)` 出现 **0** 次 ⇒ 声明了 cover 却没补 padding，等于**主动把内容推进刘海区**。

### P2 — 全页无点击高亮抑制

iOS Safari / Android Chrome 会给任何带 click 处理的元素盖一层半透明高亮。这是「这是网页不是 App」最响的信号（`mobile-native` 原文：「the single loudest 'this is a website' signal」）。它与 `01-FOUNDATION.md` 加的按压反馈**互相打架**——你设计了一个 97% 缩放，浏览器又盖一层灰。

### P3 — 全页无 `touch-action` ⇒ 300ms 点按延迟

浏览器在点按后要等一会儿判断「是不是双击缩放」，才敢派发 `click`。`touch-action: manipulation` 告诉它「这个元素不做双击缩放」，`click` 立刻触发。

### P4 — 全页无 `overscroll-behavior` ⇒ 顶部下拉触发浏览器刷新

本页是长文档（1,745 行、6 个 section），用户在顶部继续下拉会触发 Android Chrome 的 pull-to-refresh（整页重载）或 iOS 的橡皮筋。

> ⚠️ **这里有一个判断题**：`mobile-native` 的原文说「**Drop `overscroll-behavior: none` from `html` if the app is a scrolling document where pull-to-refresh is welcome**」。
>
> **本页是营销落地页，不是 App** ⇒ 下拉刷新对落地页**并无害处**（用户下拉往往是「想回到顶部」或「刷新看重播」）。**但**有一个真实坏处：本页首屏 Hero 之后紧跟「管线」「功能」等长内容，用户读到中部往上猛划时，iOS 的橡皮筋会让整页跟着弹，**妨碍阅读**。
>
> **裁定**：`html,body` 上用 `overscroll-behavior-y: none`（只禁纵向链式滚动，不禁浏览器自身刷新），内部滚动容器用 `contain`。**理由取舍写明在此，执行者照做即可。**

### P5 — 长按会选中按钮文字

`.btn` / `.promo-btn` / `.copy-btn` / `.link-chip` / `.lang button` / `.mnode` 都是控件，长按不该出现「拷贝/查询」气泡，也不该高亮选中标签文字。**但正文必须保持可选中**（用户会复制安装命令、QQ 群号）。

---

## Target

### T1 — 抑制点击高亮（全局一次）

在 `L18`（`*,*::before,*::after{box-sizing:border-box}`）之后追加：

```css
  html{-webkit-tap-highlight-color:transparent}
```

> **配套要求**（`mobile-native` 明文）：设了这一条，就必须保证每个可点元素**自己**有 `:active` 反馈——否则就是「拿掉了浏览器唯一的反馈，却没给替代品」。这正是 `01-FOUNDATION.md` T3 做的事。**两个计划必须一起交付。**

### T2 — 消除 300ms 点按延迟

在 T1 之后追加：

```css
  a,button,[role="button"],.mnode,.promo-dots a,.link-chip{touch-action:manipulation}
```

### T3 — 滚动链与橡皮筋

```css
  html,body{overscroll-behavior-y:none}
  .md-body{overscroll-behavior:contain}   /* 详情面板内部滚动不传导到页面 */
  .promo-track{overscroll-behavior-x:contain}  /* 轮播横向滚动不传导 */
```

> **不要**用 `touchmove` + `preventDefault()` 实现（`mobile-native` 明文禁令：会彻底阻断滚动且让监听器变成非 passive，掉帧）。

### T4 — 安全区补偿

**4a.** 改 `.topbar`（`L65–69`）：

```css
  .topbar{
    position:sticky;top:0;z-index:50;
    background:var(--paper);
    border-bottom:1px solid var(--line);
    padding-top:env(safe-area-inset-top, 0px);
  }
```

**4b.** 改 `footer`（`L503`）：

```css
  footer{padding:40px 0 calc(48px + env(safe-area-inset-bottom, 0px))}
```

**4c.** 改 `.md-body`（`L330`）——面板内的滚动区避开底部指示条：

```css
  .md-body{
    padding:12px 14px;font-size:12px;line-height:1.7;color:rgba(232,228,220,.85);
    max-height:150px;overflow-y:auto;scrollbar-width:thin;
    padding-bottom:calc(12px + env(safe-area-inset-bottom, 0px));
  }
```

**4d.** 改 `.wrap`（`L57`）——横向安全区（横屏刘海）：

```css
  .wrap{max-width:var(--max);margin:0 auto;padding:0 max(var(--gutter), env(safe-area-inset-left, 0px))}
```

> **注意 4d 的写法**：用 `max()` 而非直接替换 `padding`，否则在无刘海设备上会把 24px gutter 压成 0。`env(..., 0px)` 的 fallback 是**必须**的——`mobile-native` 明文「Give env() a fallback when the value is used in a calc」。

### T5 — 控件不可选中，正文保持可选中

```css
  button,[role="button"],.lang,.mnode,.promo-btn,.copy-btn,.link-chip,.promo-dots a{
    -webkit-user-select:none;user-select:none;
    -webkit-touch-callout:none;
  }
```

> **硬禁令**：**绝不**给 `body` 加 `user-select:none`。用户需要复制：安装命令 `pnpm add @a9i5k4/dsh-auto-memory`（`L1669`）、QQ 群号（`L1230` 区段）、`.codebox pre` 内容。这是 `mobile-native` 的 Never Ship 表里的明文条目。

### T6 — 轮播横向手势归属

```css
  .promo-track{touch-action:pan-y}
```

> **判据**：`pan-y` 的语义是「浏览器你保留纵向平移，横向归我」。轮播是横向滚动容器，**纵向必须留给页面**——否则用户在轮播上往上划，页面不滚，体验像卡住。

### T7 — `color-scheme` 与 `theme-color` 复核（**结论：不动**）

现状 `L6` + `L8`：

```html
<meta name="color-scheme" content="light" />
<meta name="theme-color" content="#F4F1EB" />
```

**裁定：正确，不要改成双值。**

理由：页面**没有暗色模式**（`color-scheme` 硬写 `light`，全页 CSS 无 `prefers-color-scheme` 分支）。`mobile-native` skill 说「One `theme-color` for both schemes」是错的——但**前提是应用支持双 scheme**。本页是纸色单一主题，给暗色用户一个 `#0a0a0a` 状态栏反而会让「状态栏黑、页面纸白」产生割裂。

⇒ **保留单值 `#F4F1EB`，不改。**

---

## Repo conventions to follow

- CSS 一律内联在唯一 `<style>`（`L10–567`）；`<head>` 的 meta 只加不加删。
- **安全区 `env()` 必须带 fallback**（`env(safe-area-inset-top, 0px)`）。理由：不带 fallback 时，在**不支持该环境变量**的浏览器上整条声明会被判无效并丢弃。
- 本页响应式断点只有两个：`max-width:1024px`（`L520`）与 `max-width:640px`（`L541`）。**本计划的规则是全局的，不要塞进断点里**——平台能力与屏幕宽度无关（`mobile-native` 硬规则 3：「Touch and mouse are not exclusive」）。

---

## Steps

> **与 `01-FOUNDATION.md` 的顺序**：两个计划都改全局 CSS，但**改的是不同规则**（01 改 `:root` / `.js-reveal` / 按钮 / hover；04 改 `html`/`body`/`.topbar`/`footer`/`.wrap`/`.md-body`/`.promo-track`）。**顺序无关**，只要不同时改同一行。若并行执行，请先跑 01（它加 token），04 不需要 token。

1. T1 + T2 + T3 + T5 + T6：在 `L18` 之后、`L20`（`:root`）之前，插入一整块平台层规则（按 T1→T2→T3→T5→T6 顺序，附注释标题）。
2. T4a：改 `L65–69` 的 `.topbar`，加 `padding-top`。
3. T4b：改 `L503` 的 `footer`。
4. T4c：改 `L330` 的 `.md-body`（**注意**：这条若与 `03-COMPONENTS.md` T1 的 `.m-detail` 改动相邻，先做本计划再做 03，避免行号漂移）。
5. T4d：改 `L57` 的 `.wrap`。
6. T6：给 `.promo-track`（`L346`）加 `touch-action:pan-y` 与 `overscroll-behavior-x:contain`。
7. 跑 `06-VERIFY.md`：确认 `tapHighlight === 'transparent'`、`touchAction` 生效、`topbarPaddingTop === 'env(safe-area-inset-top, 0px)'`（或计算后的 `0px`）。

---

## Boundaries

- **不加** `user-scalable=no` / `maximum-scale=1`（`mobile-native` 硬规则 4：这是无障碍失败）。
- **不改** `L5` 的 viewport meta——`viewport-fit=cover` 已在，**不要**加 `interactive-widget=resizes-content`（本页无输入框，加了没意义）。
- **不引入** `100dvh` / `100svh`（本页无满屏容器，见 §0 裁定 #3）。
- **不改** `theme-color` 为双值（见 T7）。
- **不删** `html{scroll-behavior:smooth}`（`L35`）。
- **不给 `body` 加** `user-select:none`。

---

## Verification

- **Mechanical**：探针输出 `tapHighlight === 'transparent'`；`overScrollY === 'none'`；`promoTouchAction === 'pan-y'`；`userSelectBtn === 'none'` 且 `userSelectBody !== 'none'`。
- **Emulation 层（可做）**：DevTools Device Toolbar → iPhone 14 Pro → 检查 `.topbar` 的 computed `padding-top` 是否含 `env()`；横向旋转后 `.wrap` 左右 padding ≥ 24px。
- **⚠️ 真机交底（必读）**：
  下面 5 项**在 Chrome 设备模拟里完全不生效**，`mobile-native` 的核心判据是「Emulation cannot reproduce sticky hover, tap delay, rubber-banding, safe areas, or the keyboard」。执行者**不得**凭模拟器截图宣称这几条已修好：
  1. 点按后 hover 是否粘住
  2. 点击高亮是否真的消失
  3. 点按是否真的变快（300ms 延迟）
  4. 下拉橡皮筋/刷新是否被抑制
  5. 安全区 inset 的实际数值（模拟器给的是假值）

  **这几条必须由用户在真机上确认。** 施工单只保证代码层面正确。
- **Done when**：机械断言全绿，且「真机待确认清单」已明确交付给用户。
