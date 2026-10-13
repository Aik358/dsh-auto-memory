# 00 · AUDIT — 动效机会审计与证据

- **基线**：`4af2421` · `docs/landing/index.html` · 1,745 行 / 125,060 字节
- **审计方式**：静态扫描（`grep` 取证）+ 与 `transitions-motion` 的 `catalog.json`（43 条配方）按 `when` 用途匹配
- **审计者定位**：`improve-animations`（八类目 + 分级）/ `find-animation-opportunities`（四问闸门 + 否决清单）

---

## 1. Recon · 动效现状清单（全部为实测计数，非估计）

| 指标 | 实测 | 取证方式 |
|---|---|---|
| `@keyframes` 定义 | **3** | `blink`(L166) / `fill`(L186) / `cell-hit`(L205) |
| `transition:` 声明 | **6** | L62, L132, L297, L365, L388, L396, L562 |
| 其中时长 | 1× `0.55s`（入场）+ 5× `0.15s`（hover 换色） | — |
| `:hover` 规则 | **15** 处，**0 处**有设备门控 | 全页无 `@media (hover: hover)` |
| `:active` 规则 | **0** | 全页无按压反馈 |
| `prefers-reduced-motion` 块 | 1（L561–566），覆盖 `.js-reveal` + 3 个 keyframes | — |
| `IntersectionObserver` | 1（L1679–1690），入场用 | — |
| `requestAnimationFrame` | 0 | — |
| `will-change` | 0 | — |
| `@starting-style` | 0 | — |
| `env(safe-area-inset-*)` | 0 | 但 `viewpor-fit=cover` 已在 L5 |
| `touch-action` / `tap-highlight` / `user-select` / `overscroll` | 全部 **0** | — |
| `100vh` / `100dvh` | 0 / 0 | 页面不用视口高度，**无 bug** |
| `.reveal` 入场元素 | **32** 个 | L596…L1272（含 hero、4 个 stat-cell、12 个 feature、3 个 sec-head…） |
| 外部资源 | **0** | 单文件自包含 |

**结论**：这是一个**几乎没有动效的页面**。它的问题不是「动效乱」——是「该动的地方一动不动」。

---

## 2. 现有动效八类目体检

| 类目 | 判定 | 证据 |
|---|---|---|
| 1. 目的与频率 | ✅ 无违规 | 全页无高频/键盘触发动效 |
| 2. 缓动与时长 | ⚠️ **MEDIUM** | 入场用 `cubic-bezier(.2,.7,.2,1)` **0.55s** —— 曲线弱于 token 的 `--ease-smooth-out`，且 0.55s 超出 UI 预算（>300ms）；32 个元素**同一时刻整块入场**，无分级 |
| 3. 物理性与原点 | ✅ 无违规 | 页面无浮层/弹窗/下拉，不涉及 origin |
| 4. 可中断性 | ✅ 无违规 | 无快速连触发的动效 |
| 5. 性能 | ✅ 无违规 | 只动 `opacity` + `transform`；无布局属性动画 |
| 6. 无障碍 | ⚠️ **MEDIUM** | `prefers-reduced-motion` 已挂 ✅；但 15 处 `:hover` **全部无设备门控** ⇒ 触屏点按后 hover 态粘住 |
| 7. 一致性与 token | ⚠️ **MEDIUM** | 页面**零 motion token**，时长/缓动全是字面量；3 个 keyframes 各写各的曲线 |
| 8. 遗漏的机会 | ❌ **HIGH** | 见下节 |

---

## 3. 机会清单（通过四问闸门）

每条均已过闸：**频率**（这是营销页，非工具界面 ⇒ 低频，可动）/ **目的**（能落到 feedback·spatial·state·anti-jarring·explanation·delight 之一）/ **速度**（能在预算内）/ **功能**（不阻碍阅读）。

| # | 位置 | 现状 | 目的 | 频率 | 建议动效 |
|---|---|---|---|---|---|
| 1 | `.btn`(L126) / `.promo-btn`(L369) / `.copy-btn`(L473) / `.link-chip`(L493) / `.promo-dots a`(L363) | 无 `:active` | **Feedback** | 每次点击 | `transform: scale(0.97)`，`transition: transform var(--duration-quick) var(--ease-smooth-out)`，100–160ms 区间 |
| 2 | `.js-reveal`(L62) | 32 元素同刻入场，0.55s 弱曲线 | **防止跳变** | 每次滚动 | 曲线换 `--ease-smooth-out`，时长降到 `--duration-very-slow (500ms)`；按层级分 3 档（见 02） |
| ~~3~~ | ~~`.stat-cell .v`(L230)~~ | — | — | — | **❌ 已否决，见 §4 否决清单**（四格中仅一格可计数） |
| 4 | `.m-detail`(L306，`hidden` 切换) | 里程碑详情**瞬间出现/消失** | **Spatial consistency** | 偶尔 | `panel-reveal` 配方：`translateY(8px)` + `opacity` + `blur(2px)`，开 `--duration-slow` / 关 `--duration-medium` |
| 5 | `.copy-btn`(L473) / `#install-btn`(L602) | 文案直接换成 `copied` | **Feedback** | 偶尔 | `text-states-swap`：旧字上移模糊出、新字下方进，`--duration-quick (150ms)` |
| 6 | `.lang button`(L86) | 中/EN 硬切 | **State indication** | 偶尔 | 滑块指示器（`tabs-sliding` 思路）：1.5px 边框内衬一块 `--ink` 底，`--duration-fast (250ms)` |
| 7 | `.promo-dots a`(L363) | 圆点靠 `style.background` 硬切 | **State indication** | 偶尔 | 同上：`transition: background var(--duration-quick), border-color ...`，**保留 JS 现有写法**，只补 CSS 过渡 |
| 8 | `.g-card img`(L449) | `filter: grayscale(18%)` → `none` 硬切 | **Feedback** | 悬停 | `transition: filter var(--duration-fast) var(--ease-smooth-out)`（**必须门控在 hover 媒体查询内**） |
| 9 | 整页 | 无 `touch-action` / tap-highlight / safe-area | 平台层 | — | 见 `04-MOBILE.md`，属 HIGH（非动效类目） |

---

## 4. 否决清单（**必填** —— 这是本审计的核心产出）

以下候选**看起来可以动，但被闸门否决**。执行者若擅自加上，按「未完成」处理。

| 位置 | 否决原因 |
|---|---|
| **顶栏 `.topbar`(L65) 加吸顶阴影/缩放** | **功能**：它已 `position: sticky`，滚动全程可见 ⇒ 属高频视觉元素；再叠加动效会与正文抢注意力。**保持静态。** |
| **`.topnav a`(L78) 加下划线滑入** | **频率**：导航是每页使用多次的元素；且已有 `border-left-color` 变化作为反馈，**够了**。 |
| **整页加视差 / 滚动驱动动画** | **功能**：这是编辑部式文档版式，正文在阅读中不得位移。已在 README §2 列为明文禁令。 |
| **`.lane .bar`(L176) / `.store .cell`(L197) 加更多 keyframes** | **功能**：它们是**系统示意图**，语义是「数据在管线中流动」，已有 `fill` 6s 循环 + 4 档 delay 完整表达。加装饰会稀释语义。 |
| **数字计数用 `spinning-counter` 卷轴配方** | **已实证失败**（2026-09-22，`docs/CONTRIBUTORS.html`）：该配方要求「祖先渐变 + 子层裁剪 + 列级 `overflow`」，与本页 L230 的 `.stat-cell .v` 样式体系天然冲突。**本页另有一个更强否决理由**：本页 `.v` 内还有 `<span class="u">` 单位（L234），卷轴只能卷纯数字。⇒ **只用计数滚动**。 |
| **数字计数动效（`.stat-cell .v`）** | **功能 + 收益**：实测四格内容为 `0` / `3` / `R@5 0.925` / `100`（`L669–684`）。**只有 `100` 一格可计数**；`0` 无计数空间、`3` 会一闪而过像故障、`R@5 0.925` 是数字嵌在文本里无法计数。为 25% 的格子引入 JS 计数逻辑 = 高成本低回报。**`.stat-cell` 已有依次入场（02-SCROLL），够了。** |
| **`.promo-dots a`(L363) 加过渡** | **已经是正确状态**：它**已有** `transition:background .15s ease,border-color .15s ease`，且 JS（`L1621`）只改这两个属性 ⇒ 完全匹配。**这正是「不该动的」样本**，保留在此提醒执行者。 |
| **`.promo-track`(L346) 手写拖拽/吸附替代 scroll-snap** | **功能**：原生 `scroll-snap-type:x mandatory` + `scroll-snap-stop:always` 自带浏览器级物理惯性，手写替代必然更差（`mobile-native` §9 判据原文：「the browser's own physics beat a hand-rolled spring」）。 |
| **`.hero` 加鼠标跟随 3D 倾斜（`3d-tilt`）** | **功能**：Hero 左侧是正文（标题+副标题+CTA），让**用户正在读的文字**随指针倾斜属于「装饰阻碍功能」。3D tilt 适合产品卡/封面，不适合正文块。 |
| **给所有元素加 `will-change`** | **性能**：`will-change` 是「即将动画」的提示，全页铺开会让浏览器长期持有大量合成层，反而降帧。只在真正连续动画的元素上临时加。 |
| **给 `html` 加 `scroll-behavior: smooth` 之外的滚动动效** | 已存在（L35），且 reduced-motion 下已正确降为 `auto`（L565）。**不动。** |
| **`.topbar` 加 `backdrop-filter` 毛玻璃** | **设计系统**：页面明文「无渐变、无圆角卡片、无阴影堆砌」，纸色顶栏是版式的一部分；毛玻璃属另一套语言。**不动。** |
| **中文标题加逐字 `texts-reveal` 拆分** | **速度/功能**：`h1` 是 `clamp(44px,6.2vw,84px)` 的大字 + `<br/>` 手动断行（L598），逐字拆分会破坏断行且首屏拖慢。**只做整体淡入上移。** |

---

## 5. 与 `catalog.json` 的配方映射（执行时按此取源码）

`transitions-motion` 的语料在 `D:\dsh-auto-memory\.dsh\skills\transitions-motion\references\items\<slug>.json`，字段 `code.css` / `code.react` / `code.js` / `code.markup`。

| 用途 | slug | 用它的哪个字段 |
|---|---|---|
| 里程碑详情面板开合 | `panel-reveal` | `css` + `markup` |
| 复制按钮文案切换 | `text-states-swap` | `css` + `markup` |
| 语言切换指示器 | `tabs-sliding` | `css`（**忽略其 JS**，本页保持现有 `classList` 写法） |
| 统计数字计数 | `number-pop-in` | 仅借其**节奏**；实现用本单 03 的零结构计数（见否决清单） |
| 卡片图片去灰 | 无对应配方 | 手写 1 条 `transition`，token 取自 `tokens.css` |

> **纪律**：`SKILL.md §6` 明文「先查语料再动手，绝不凭记忆编动画代码」。执行者若发现上表 slug 与 `catalog.json` 的 `when` 描述不符，**以 `when` 为准**。

---

## 6. 审计交底（诚实边界）

- **能静态判定的**：时长 / 缓动 / `:active` 缺失 / 门控缺失 / token 缺失 —— 全部有 `file:line` 证据。
- **不能静态判定的**：动效落地的**手感**。因此每个计划都带「feel check」（`06-VERIFY.md`），必须靠 headless 截图 + 真机复核，不得凭代码正确就宣称完成。
- **未覆盖**：真机触感（本机无法验证 iOS/Android 的 tap delay、rubber-band、安全区实际 inset）——这部分**必须由用户在手机上确认**，施工单只能保证代码层面正确（见 `04-MOBILE.md` 末尾）。
