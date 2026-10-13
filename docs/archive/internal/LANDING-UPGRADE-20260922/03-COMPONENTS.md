# 03 · COMPONENTS — 轮播 / 面板 / 文案切换 / 指示器

- **Status**: TODO
- **Commit**: `4af2421`
- **Severity**: MEDIUM
- **Category**: 遗漏的机会 / 空间一致性 / 状态指示
- **Estimated scope**: 1 file，CSS 约 +40 行，JS 改 2 处共约 15 行
- **依赖**: `01-FOUNDATION.md`

---

## 0. 本计划范围内含一次**计划修正**（必读）

`00-AUDIT.md` §3 的机会 #3（统计数字计数动效）**经复核后降级为「不实施」**。证据（`L669–684` 实测）：

```html
<div class="v">0<span class="u" data-i18n="st.1.u">次</span></div>          <!-- 值是 0，无计数空间 -->
<div class="v">3<span class="u" data-i18n="st.2.u">级</span></div>          <!-- 3，计数无意义 -->
<div class="v">R@5 0.925</div>                                            <!-- 混合文本，不可计数 -->
<div class="v">100<span class="u">%</span></div>                          <!-- 唯一可计数 -->
```

四格里**只有一格**（`100`）能计数，另一格是 `3`（0→3 一闪而过，读起来像故障），还有一格是 `R@5 0.925`（数字嵌在文本里，卷轴/计数都无法表达）。

**否决理由**（`find-animation-opportunities` 闸门第 4 问）：这是**用户在读的功能性数据**，且只有 25% 的格子受益——为它引入 JS 计数逻辑是典型的高成本低回报。`.stat-cell` 已有入场（`02-SCROLL.md` 的依次浮起），**够了**。

> `00-AUDIT.md` 的对应行已同步改为「已否决」。执行者**不要**实现计数动效。

---

## Problem

### P1 — 里程碑详情面板瞬现瞬隐（`L306`、`L1733`、`L1738`）

```css
/* L306 — 当前 */
.m-detail{
  border-top:1px solid rgba(255,255,255,.18);
  background:rgba(255,255,255,.05);
}
.m-detail[hidden]{display:none}
```

```js
// L1733 — 打开
detail.hidden = false;
// L1738 — 关闭
mdClose.addEventListener('click', function(){ detail.hidden = true; current = null; });
```

点 `.mnode`（`L291`）展开里程碑详情时内容**直接出现**；关闭时**直接消失**。这个面板出现在深色 `.arch` 区块（`L276`）内部，是页面里唯一「局部展开」的界面，突变更显眼。

### P2 — 复制反馈是硬切文本（`L1644–1648`）

```js
  function flashCopied(btn){
    var old = btn.textContent;
    btn.textContent = 'copied';
    setTimeout(function(){ btn.textContent = old; }, 1100);
  }
```

`.copy-btn`（`L473`）与 `#install-btn`（`L602`）点按后，按钮文字**瞬间**从 `COPY` 变 `copied` 再变回。字号/字重有差异（`.copy-btn` 是 mono 10px 大写），硬切会看到宽度跳动。

### P3 — 语言切换无状态指示（`L85–92`、`L1604–1605`）

```css
/* L86 — 当前 */
.lang button{ border:0;background:transparent;color:var(--ink-2); font-family:var(--mono);font-size:11.5px;cursor:pointer; padding:6px 11px;letter-spacing:.06em; }
.lang button.on{background:var(--ink);color:var(--paper)}
```

中/EN 之间切换时，底色是**瞬间**从一格跳到另一格。这是 `tabs-sliding` 配方的标准场景（`catalog.json`: 「A segmented control / tab bar where the active pill slides between options」）。

### P4 — 轮播圆点无过渡（`L363–367`、`L1621`）

```css
/* L363 */
.promo-dots a{ width:10px;height:10px;border:1.5px solid var(--ink-3);display:block; transition:background .15s ease,border-color .15s ease; }
.promo-dots a:hover{border-color:var(--accent);background:var(--accent)}
```

```js
// L1621 — 当前用内联样式硬改
dots.forEach(function(d, k){ d.style.background = k === cur ? 'var(--accent)' : 'transparent'; });
```

**注意**：圆点**已有** `transition`（0.15s），所以它不属于「完全没有过渡」。真正的问题是 JS 同时设 `background` 与 `border-color`，而过渡只声明了这两个属性——**这其实是正确的**。⇒ **P4 判定为「已经对了，不动」**（`improve-animations` 硬规则 5：不重新审判已定决策；`transitions-motion` §B2：明确标出不该动的）。

> 保留此条是为了让执行者知道：**圆点不需要改**。看到这里请直接跳过 P4。

---

## Target

### T1 — 里程碑面板：`panel-reveal` 配方（进出不对称）

**1a.** 替换 `L306–310` 为：

```css
  .m-detail{
    border-top:1px solid rgba(255,255,255,.18);
    background:rgba(255,255,255,.05);
    /* 面板揭示：短位移 + 透明度 + 2px 掩护模糊（transitions-motion: panel-reveal）*/
    opacity:1;
    transform:translateY(0);
    filter:blur(0);
    transition:opacity var(--duration-slow) var(--ease-smooth-out),
               transform var(--duration-slow) var(--ease-smooth-out),
               filter var(--duration-slow) var(--ease-smooth-out);
  }
  .m-detail[hidden]{display:none}
  /* 关闭：更快、更安静（开 400ms / 关 350ms，不对称是刻意的）*/
  .m-detail.is-closing{
    opacity:0;
    transform:translateY(calc(var(--distance-base) * -1));
    filter:blur(var(--blur-small));
    transition-duration:var(--duration-medium);
  }
```

**1b.** 用 `@starting-style` 让「打开」有起点（现代浏览器原生支持，无 JS 也生效）：

```css
  @starting-style{
    .m-detail{ opacity:0; transform:translateY(var(--distance-base)); filter:blur(var(--blur-small)); }
  }
```

**1c.** 修 `L1721–1734` 的 `open()`，在显示前清掉关闭态：

```js
    function open(id, btn){
      var m = MILESTONES[id]; if (!m) return;
      var L = lang();
      if (current === id && !detail.hidden){ close(); return; }
      current = id;
      mdId.textContent = id;
      var lbl = btn.querySelector('span');
      mdTitle.textContent = lbl ? lbl.textContent : '';
      mdState.textContent = (MS_STATE_LABEL[m.state] || {})[L] || m.state;
      mdState.className = 'md-state ' + m.state;
      mdBody.textContent = m[L] || m.zh;
      detail.classList.remove('is-closing');   /* ← 新增：确保从静止态起播 */
      detail.hidden = false;
    }
```

**1d.** 新增 `close()`，替换 `L1738` 与 `L1724` 的关闭分支：

```js
    function close(){
      if (detail.hidden) return;
      current = null;
      if (matchMedia('(prefers-reduced-motion: reduce)').matches){ detail.hidden = true; return; }
      detail.classList.add('is-closing');
      /* 关闭动画走完再真正隐藏；时长与 CSS 的 --duration-medium 对齐 */
      setTimeout(function(){ detail.hidden = true; detail.classList.remove('is-closing'); }, 350);
    }
```

并把 `L1738` 改为：

```js
    mdClose.addEventListener('click', close);
```

> **为什么必须用 `setTimeout` 而不是 `transitionend`**：`hidden` 属性切换会让元素离开渲染树，`transitionend` 在某些中断路径下不触发，会永久卡在关闭态。`transitions-motion` 的官方 12 条常见错误第 1 条就是这个（「删掉关闭态清理 ⇒ 下次打开会从关闭缩放值起跳」）。
>
> **时长 350 必须与 CSS 的 `--duration-medium` 一致**。改 token 就要同改这里——这是本计划唯一的耦合点。

### T2 — 文案切换：`text-states-swap`（旧字上出、新字下进）

**2a.** 在 `.copy-btn` 规则群（`L473–477`）之后追加：

```css
  /* 复制反馈：旧字上移模糊出，新字下方进（transitions-motion: text-states-swap）*/
  .copy-btn,.btn .copy{ position:relative; }
  .copy-btn .swap,.btn .copy .swap{
    display:inline-block;
    transition:opacity var(--duration-quick) var(--ease-in-out),
               transform var(--duration-quick) var(--ease-in-out),
               filter var(--duration-quick) var(--ease-in-out);
  }
  .copy-btn .swap.out,.btn .copy .swap.out{
    opacity:0;
    transform:translateY(calc(var(--distance-micro) * -1));
    filter:blur(var(--blur-small));
  }
```

**2b.** 替换 `flashCopied()`（`L1644–1648`）：

```js
  function flashCopied(btn){
    if (btn.getAttribute('data-flashing') === '1') return;   /* 连点不叠加 */
    btn.setAttribute('data-flashing','1');
    var label = btn.querySelector('.swap');
    if (!label){                                   /* 无 .swap 包裹时退回纯文本，保证不炸 */
      var old = btn.textContent;
      btn.textContent = 'copied';
      setTimeout(function(){ btn.textContent = old; btn.removeAttribute('data-flashing'); }, 1100);
      return;
    }
    var orig = label.getAttribute('data-label') || label.textContent;
    label.classList.add('out');                    /* 旧字出 */
    setTimeout(function(){
      label.textContent = (document.documentElement.getAttribute('data-lang') === 'en') ? 'copied' : '已复制';
      label.classList.remove('out');               /* 新字进 */
    }, 150);                                       /* 与 --duration-quick 对齐 */
    setTimeout(function(){
      label.classList.add('out');
      setTimeout(function(){
        label.textContent = orig;
        label.classList.remove('out');
        btn.removeAttribute('data-flashing');
      }, 150);
    }, 1100);
  }
```

**2c.** 给两个按钮的文字加 `.swap` 包裹（**这是本计划唯一允许的 HTML 改动**）：

- `L602` 区域：`<button class="btn primary" id="install-btn" type="button">` 内部的 `<span class="copy">` 内容包一层 `<span class="swap" data-label="…">`
- 其余 `.copy-btn`：按其现有 `textContent` 包一层 `<span class="swap">`，并把原文写进 `data-label`

> **若执行者无法安全确定某按钮的原文**（例如 `.copy-btn` 的内容由 i18n 字典驱动），**跳过该按钮**，让 2b 的 fallback 分支接管。宁可少一处动效，不可改错文案。

### T3 — 语言切换：滑块指示器

**3a.** 替换 `.lang` 组（`L85–92`）为：

```css
  .lang{display:inline-flex;position:relative;border:1px solid var(--line);margin-left:10px}
  /* 指示器：一块 --ink 底在两格之间滑动（transitions-motion: tabs-sliding 思路）*/
  .lang::before{
    content:"";position:absolute;top:0;bottom:0;left:0;width:50%;
    background:var(--ink);
    transition:transform var(--duration-fast) var(--ease-smooth-out);
    pointer-events:none;
  }
  .lang[data-active="en"]::before{transform:translateX(100%)}
  .lang button{
    position:relative;z-index:1;
    border:0;background:transparent;color:var(--ink-2);
    font-family:var(--mono);font-size:11.5px;cursor:pointer;
    padding:6px 11px;letter-spacing:.06em;
    transition:color var(--duration-fast) var(--ease-smooth-out);
  }
  .lang button.on{color:var(--paper)}
  .lang button:not(.on):hover{color:var(--ink)}
```

**3b.** 在 `applyLang()`（`L1602–1606` 区段）里给 `.lang` 容器打状态。找到设置 `zhBtn.classList` / `enBtn.classList` 的那段，**在其后追加一行**：

```js
    document.querySelector('.lang').setAttribute('data-active', lang === 'zh' ? 'zh' : 'en');
```

> **不改** `L85` 的 HTML 结构（`.lang` 里仍是两个 `<button>`），指示器是纯 CSS 伪元素。

---

## Repo conventions to follow

- **JS 必须 ES5 风格**：`var`、`function(){}`、不用箭头/模板串/`const`。范本 `L1595–1690`。
- **不加依赖**：`panel-reveal` / `text-states-swap` 在 `transitions-motion` 语料里都有 React 变体，**本页不用 React**，只取 `code.css` + `code.markup` 并改类名（`SKILL.md §3 步骤 4`：「替换类名、抽出 token、挂 reduced-motion」）。
- **属性只动 `transform` / `opacity` / `filter` / `color` / `background`**，不碰 `width`/`height`/`margin`/`padding`/`top`/`left`。
- 类名用 `.is-closing` / `.swap` / `.out` / `[data-active]` —— 与 `transitions-motion` 官方钩子命名一致（`is-closing` 是官方惯例）。

---

## Steps

1. 确认 `01-FOUNDATION.md` 完成。
2. T1：改 `L306–310` 的 `.m-detail`，追加 `@starting-style` 块（紧接其后）。
3. T1：改 `open()`（`L1721–1734`）——加 `classList.remove('is-closing')`；新增 `close()`；把 `L1738` 与 `L1724` 的关闭路径统一到 `close()`。
4. T2：在 `L477` 之后追加 CSS；替换 `flashCopied()`（`L1644–1648`）；给能安全确定的按钮加 `.swap` 包裹。
5. T3：替换 `.lang` CSS（`L85–92`）；在 `applyLang()` 里加 `data-active`。
6. 跑 `06-VERIFY.md`：确认 `mdTransition` 含 `--duration-slow`、`langActive` 跟随语言切换、`flashCopied` 存在 `data-flashing` 守卫。

---

## Boundaries

- **不实施**统计数字计数（见 §0 修正）。
- **不动** `.promo-dots a`（见 P4：它已经对了）。
- **不改** `MILESTONES` 数据、`MS_STATE_LABEL`、任何 `data-i18n` 键名（唯一例外是 T2c 包一层 `.swap`，且**不得改动原文案**）。
- **不改** `.promo-track` 的 scroll-snap 行为（`L346–357`）——原生滚动带物理惯性，手写替代只会更差（`mobile-native` §9 判据）。
- **不引入** `transition: all`（`animate` skill 明文禁令）。
- 若 `open()` / `flashCopied()` 与本文所示不符，**停下报告**。

---

## Verification

- **Mechanical**：探针输出 `mdTransition === 'opacity 400ms ..., transform 400ms ..., filter 400ms ...'`（或等价 token 展开）；`langHasActive === true`；`flashGuard === true`。
- **Mechanical**：全页 `transition: all` 出现次数 = **0**。
- **Feel check**：
  - 快速连点同一个 `.mnode` 五六次 → 面板**不闪不抖**，不出现「半透明残留」；停在打开态时是完整不透明的。
  - 点开 A 再点开 B → B 的详情**直接换成新内容**（面板保持打开，不重播揭示动画）——这是 `L1724` 的既有行为，**必须保住**。
  - 点 `.md-close` → 面板先淡出再消失（不是瞬间消失）；**连点两次**不会把面板永久卡成不可见。
  - 点复制按钮 → 文字是「上出下进」，且**连点 5 次**不会把 `copied` 叠成 `copiedcopied`。
  - 切中/EN → 深色底**滑过去**而不是跳过去；切到 EN 后指示器**确实在右格**。
  - Rendering → `prefers-reduced-motion: reduce` → 面板**瞬时**开合（`close()` 里的 `matchMedia` 分支生效），文案切换仍可见但不位移。
- **Done when**：面板进出不对称且不卡死、复制连点安全、语言指示器滑动正确、reduced-motion 全部降级。
